#!/usr/bin/env node
// Node 22+, no dependencies. Connect only to a deliberately launched QA Chrome.
// A new blank tab is instrumented before navigation so boot-time pipeline errors cannot escape the report.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CAR_CATALOG } from '../../js/car-catalog.js';

const args = process.argv.slice(2), options = { port: 9334, url: 'http://localhost:5174/?qa=1&quality=balanced&architecte=0', output: null };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help') {
    console.log('Usage : node tools/cars/qa-browser.mjs [--port 9334] [--url URL] [--output DOSSIER]\nChrome de test doit déjà tourner avec son propre --user-data-dir et --remote-debugging-port.\nLe script crée et ferme uniquement son onglet. --output enregistre rapport.json et les captures PNG.');
    process.exit(0);
  }
  if (!['--port', '--url', '--output'].includes(arg) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Argument invalide : ${arg}`);
  options[arg.slice(2)] = args[++i];
}
options.port = Number(options.port);
if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('Port CDP invalide.');
const pageURL = new URL(options.url);
if (!['http:', 'https:'].includes(pageURL.protocol)) throw new Error('Une URL HTTP(S) du jeu est requise.');
pageURL.searchParams.set('qa', '1');
pageURL.searchParams.set('architecte', '0');
const endpoint = `http://127.0.0.1:${options.port}`;
const output = options.output ? resolve(options.output) : null;
const report = { url: pageURL.href, startedAt: new Date().toISOString(), status: 'running', checks: [], vehicles: [], diagnostics: [], screenshots: [],
  imageReview: 'Les captures sont fournies pour une revue visuelle humaine ; aucune validation automatique des pixels.' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let target = null, socket = null, sequence = 0, stage = 'boot';
const pending = new Map();
const diagnostic = (source, level, text) => {
  const shaderFailure = /\[compile\]|webgpu|wgsl|gpuvalidation|shader|pipeline|varying|inter.stage/i.test(text) && /error|invalid|fail|exceed|limit|not compatible/i.test(text);
  report.diagnostics.push({ stage, source, level, fatal: level === 'error' || level === 'exception' || shaderFailure, text: String(text).slice(0, 12000) });
};
async function http(path, method = 'GET') {
  const response = await fetch(`${endpoint}${path}`, { method, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`CDP HTTP ${response.status} : ${path}`);
  return response;
}
function call(method, params = {}, timeout = 20000) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP délai dépassé : ${method}`)); }, timeout);
    pending.set(id, { resolve, reject, timer });
    try { socket.send(JSON.stringify({ id, method, params })); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 5000 });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function until(expression, label, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const errors = report.diagnostics.filter(e => e.fatal);
    if (errors.length) throw new Error(`${label} : ${errors.at(-1).text}`);
    try { if (await evaluate(expression)) return; }
    catch (error) {
      if (!/execution context was destroyed|cannot find context|inspected target navigated/i.test(String(error))) throw error;
    }
    await sleep(100);
  }
  throw new Error(`Délai dépassé : ${label} (${timeout / 1000} s).`);
}
async function key(code, type) {
  const letter = code.slice(3);
  await call('Input.dispatchKeyEvent', { type, code, key: letter.toLowerCase(), windowsVirtualKeyCode: letter.charCodeAt(0) });
}
async function hold(code, milliseconds) {
  await key(code, 'keyDown');
  try { await sleep(milliseconds); } finally { await key(code, 'keyUp'); }
}
async function click(expression) {
  const point = await evaluate(`(() => { const element = (${expression}); if (!element) throw new Error('Bouton absent');
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = element.getBoundingClientRect(); if (!r.width || !r.height) throw new Error('Bouton invisible');
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
async function screenshot(name) {
  if (!output) return;
  const { data } = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const path = resolve(output, `${name}.png`);
  await writeFile(path, Buffer.from(data, 'base64'));
  report.screenshots.push(path);
}
function check(condition, label, detail = null) {
  report.checks.push({ label, passed: !!condition, detail });
  if (!condition) throw new Error(label);
}

async function driveSample(milliseconds) {
  const before = await evaluate(`(() => { const c = window.__game.car;
    return { x: c.position.x, z: c.position.z, heading: c.heading, speed: c.speed }; })()`);
  await key('KeyW', 'keyDown');
  const drivingAt = Date.now();
  try {
    await sleep(milliseconds);
    const vehicle = await evaluate(`(() => { const c = window.__game.car, b = c.body;
      const finite = [c.position.x,c.position.y,c.position.z,c.speed,c.heading,b?.vx,b?.vy,b?.vz,b?.rpm,
        ...(b?.q || []),...(b?.wheels || []).flatMap(w => [w.travel,w.spin,w.slip,w.load])].every(Number.isFinite);
      let bodyVisible = !!c.bodyMesh && c.bodyMesh.geometry.attributes.position.count > 0;
      for (let p = c.bodyMesh; p; p = p.parent) bodyVisible &&= p.visible;
      return { kind: c.kind, finite, body: !!b, meshVisible: c.mesh.visible, bodyVisible,
        contacts: b?.wheels.filter(w => w.hasGround).length, position: { x:c.position.x,y:c.position.y,z:c.position.z },
        speedKmh: Math.hypot(b.vx,b.vz)*3.6, forwardSpeed: c.speed, throttle: b.throttle,
        rpm:b.rpm, gear:b.gear+1, profile:window.__profile?.summary || null }; })()`);
    const dx = vehicle.position.x - before.x, dz = vehicle.position.z - before.z;
    vehicle.keyHeldMs = Date.now() - drivingAt;
    vehicle.distance = Math.hypot(dx, dz);
    vehicle.forwardDistance = dx * Math.sin(before.heading) + dz * Math.cos(before.heading);
    vehicle.speedGainKmh = (vehicle.forwardSpeed - before.speed) * 3.6;
    return vehicle;
  } finally {
    await key('KeyW', 'keyUp');
  }
}

const accelerated = v => v.throttle > 0.5 && v.forwardDistance > 0.15 && v.speedGainKmh > 1;

async function driveClearFixture() {
  // This avenue segment has room for the fleet to launch. During this retry only, ignore contact with moving ambient
  // traffic, while retaining the road, buildings, parked cars, real keyboard inputs and normal vehicle simulation.
  // The browser target and its storage are isolated. Restore traffic interaction before returning to normal gameplay.
  await evaluate(`(() => { const g = window.__game, traffic = g.traffic;
    g.controllers.teleportActiveTo(3.6, 380, 0);
    g.camera.resetForTeleport();
    const update = traffic.update;
    traffic.update = (dt, elapsed, focus, player, mode, camera) => update(dt, elapsed, focus, null, mode, camera);
    window.__restoreTrafficForDriveQA = () => { traffic.update = update; };
  })()`);
  try {
    await until('window.__game.car.body?.wheels.filter(w => w.hasGround).length === 4', 'quatre roues au sol sur la voie de contrôle');
    return await driveSample(850);
  } finally {
    await evaluate('window.__restoreTrafficForDriveQA(); delete window.__restoreTrafficForDriveQA;');
  }
}

try {
  if (output) await mkdir(output, { recursive: true });
  // Never attach to, navigate, reload or close an existing target.
  target = await (await http(`/json/new?${encodeURIComponent('about:blank')}`, 'PUT')).json();
  report.targetId = target.id;
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Connexion CDP expirée.')), 10000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Connexion CDP impossible.')); }, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result || {});
      return;
    }
    const p = message.params;
    if (message.method === 'Runtime.exceptionThrown') diagnostic('Runtime.exceptionThrown', 'exception', p.exceptionDetails.exception?.description || p.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'warn'].includes(p.type)) {
      diagnostic('Runtime.consoleAPICalled', p.type === 'error' ? 'error' : 'warning', p.args.map(a => a.value ?? a.description ?? a.type).join(' '));
    }
    if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(p.entry.level)) diagnostic(`Log.${p.entry.source}`, p.entry.level, p.entry.text);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Connexion CDP fermée.')); }
    pending.clear();
  });
  await Promise.all([call('Runtime.enable'), call('Log.enable'), call('Page.enable')]);
  await call('Page.bringToFront');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  // Keep QA saves and preferences in this tab only, including pagehide saves. Existing browser storage is untouched.
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const values = new Map();
    const storage = { getItem: k => values.has(String(k)) ? values.get(String(k)) : null,
      setItem: (k, v) => values.set(String(k), String(v)), removeItem: k => values.delete(String(k)),
      clear: () => values.clear(), key: i => [...values.keys()][i] ?? null, get length() { return values.size; } };
    Object.defineProperty(window, 'localStorage', { get: () => storage });
  })();` });
  const navigation = await call('Page.navigate', { url: pageURL.href });
  if (navigation.errorText) throw new Error(navigation.errorText);
  await until(`!!window.__game && !!window.__render && !!document.querySelector('#loading-overlay.hidden')`, 'chargement et précompilation', 180000);
  check(await evaluate('window.__render.renderer.backend.isWebGPUBackend === true'), 'Rendu WebGPU actif');
  // A newly activated headless target can receive a late blur during startup. Resume through the real button,
  // never through game state mutation, and record every retry so an input failure remains diagnosable.
  report.startup = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    await call('Page.bringToFront');
    const state = await evaluate(`(() => { const g=window.__game, b=document.getElementById('play-button');
      return { playing:g.playing, paused:g.paused, intro:g.intro, active:g.active, focused:document.hasFocus(),
        menuVisible:!!b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden' }; })()`);
    report.startup.push(state);
    if (state.playing && !state.intro && state.active) break;
    if (state.menuVisible && (!state.playing || state.paused)) await click(`document.getElementById('play-button')`);
    await hold('KeyW', 150);
    try {
      await until('window.__game.playing && !window.__game.intro && window.__game.active', 'entrée dans la ville');
      break;
    } catch (error) {
      if (attempt === 2 || !String(error).includes('Délai dépassé : entrée dans la ville')) throw error;
    }
  }
  check(await evaluate('window.__game.playing && !window.__game.intro && window.__game.active'), 'Partie active après entrée ou reprise par clic');
  await evaluate(`(() => { const g = window.__game; g.atmosphere.setHour(12); g.atmosphere.setWeather('clear', true);
    g.atmosphere.running = false; g.atmosphere.lockWeather = true; g.camera.setCameraPreset('chase', true); return true; })()`);
  await sleep(300);
  stage = 'garage';
  await hold('KeyG', 80);
  await until('window.__game.garage.open', 'ouverture du garage');
  const tiles = await evaluate(`Array.from(document.querySelectorAll('#garage-panel > button'), (b, index) => ({ index, model: b.querySelector('span')?.textContent || '' }))`);
  check(tiles.length === 21, 'Le garage présente 21 choix', tiles.length);
  await screenshot('garage');
  for (const [order, entry] of CAR_CATALOG.entries()) {
    stage = entry.kind;
    if (order) { await hold('KeyG', 80); await until('window.__game.garage.open', 'réouverture du garage'); }
    const tile = tiles.find(t => t.model === entry.model);
    check(!!tile, `Choix ${entry.brand} ${entry.model} présent`);
    await click(`document.querySelectorAll('#garage-panel > button')[${tile.index}]`);
    await until(`window.__game.state === 'driving' && window.__game.car.kind === ${JSON.stringify(entry.kind)} && !window.__game.garage.open`, `sélection ${entry.kind}`);
    await sleep(300);
    const normalLaunch = await driveSample(600);
    const validCar = v => v.kind === entry.kind && v.finite && v.body && v.meshVisible && v.bodyVisible;
    check(validCar(normalLaunch), `État physique et visibilité de ${entry.kind} après la sortie du garage`, normalLaunch);
    const needsClearLane = normalLaunch.contacts !== 4 || !accelerated(normalLaunch);
    const vehicle = needsClearLane ? await driveClearFixture() : normalLaunch;
    report.vehicles.push({ ...vehicle, garageIndex: tile.index, ...(needsClearLane ? { normalLaunch, clearLane: true } : {}) });
    check(validCar(vehicle) && vehicle.contacts === 4 && accelerated(vehicle), `Accélération de ${entry.kind} par la touche Z/W`, vehicle);
    await screenshot(`${String(order + 1).padStart(2, '0')}-${entry.kind}`);
  }
  await sleep(250);
  check(report.vehicles.length === 15 && new Set(report.vehicles.map(v => v.kind)).size === 15, 'Les quinze modèles ont été conduits');
  check(!report.diagnostics.some(e => e.fatal), 'Aucune erreur JavaScript ou validation WebGPU au chargement et sur les quinze modèles');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error?.stack || error);
  try { if (socket?.readyState === WebSocket.OPEN) await screenshot('echec'); } catch { /* Preserve the original error. */ }
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await key('KeyW', 'keyUp'); await key('KeyG', 'keyUp'); } catch { /* Target may have crashed. */ }
  }
  if (target?.id) { try { await http(`/json/close/${encodeURIComponent(target.id)}`); } catch (error) { report.cleanupError = String(error); report.status = 'failed'; } }
  socket?.close();
  report.finishedAt = new Date().toISOString();
  const json = JSON.stringify(report, null, 2);
  if (output) await writeFile(resolve(output, 'rapport.json'), `${json}\n`);
  console.log(json);
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
