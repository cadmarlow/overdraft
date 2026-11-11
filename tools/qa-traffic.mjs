// Run only against a dedicated QA Chrome with its own user-data-dir and uncapped frame rate.
// node tools/qa-traffic.mjs [CDP port] [output directory] [high|balanced]
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const port = Number(process.argv[2] || 9347);
const output = resolve(process.argv[3] || '/tmp/overdraft-traffic-qa');
const quality = process.argv[4] || 'high';
if (!Number.isInteger(port) || port < 1024 || !['high', 'balanced'].includes(quality)) throw Error('Arguments invalides');
const host = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const target = await (await fetch(`${host}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
const pending = new Map(), report = { quality, checks: [], samples: [], errors: [], screenshots: [] };
let sequence = 0;
socket.addEventListener('message', e => {
  const message = JSON.parse(e.data), request = pending.get(message.id);
  if (message.method === 'Runtime.exceptionThrown') report.errors.push(message.params.exceptionDetails);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') report.errors.push(message.params.args.map(a => a.value || a.description));
  if (!request) return;
  pending.delete(message.id); clearTimeout(request.timer);
  if (message.error) request.reject(Error(message.error.message)); else request.resolve(message.result);
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject, timer: setTimeout(() => { pending.delete(id); reject(Error(`${method}: timeout`)); }, 45000) });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function until(expression, ms = 10000) {
  const deadline = Date.now() + ms;
  while (!await evaluate(expression)) { if (Date.now() > deadline) throw Error(`Délai dépassé : ${expression}`); await sleep(250); }
}
function check(value, label) { if (!value) throw Error(label); report.checks.push(label); console.log(label); }
async function click(selector) {
  const point = await evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...point });
}
async function tap(code, key = code, virtual = 27, duration = 60) {
  await call('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: virtual });
  await sleep(duration);
  await call('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: virtual });
}
async function capture(name) {
  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  const file = `${output}/${name}.png`;
  await writeFile(file, Buffer.from(data, 'base64')); report.screenshots.push(file);
}
async function pause() {
  if (!await evaluate('__game.paused')) { await tap('Escape'); await until('__game.paused'); }
  await click('[data-pause-tab="world"]');
}
async function choose(id) {
  await pause();
  await click(`[data-traffic="${id}"]`);
  check(await evaluate(`__game.traffic.density==='${id}' && __game.highway.density==='${id}' && document.querySelector('[data-traffic="${id}"]').getAttribute('aria-pressed')==='true'`), `Choix ${id} appliqué aux deux réseaux`);
  await click('#pm-resume'); await until('__game.active');
}
async function ready() {
  await until('!!window.__game && document.querySelector("#opening-screen")?.dataset.state === "ready"', 240000);
  check(await evaluate('__render.renderer.backend.isWebGPUBackend'), 'WebGPU actif');
  await click('#play-button'); await until('__game.active');
  await evaluate(`__game.atmosphere.setHour(13); __game.atmosphere.running=false; __game.atmosphere.setWeather('clear',true); __game.atmosphere.lockWeather=true;`);
}
async function instrument() {
  await evaluate(`(() => {
    const p=__render.pacer; p.setScale(1); p.adapt=()=>{};
    window.__trafficMeasure={frames:0,street:0,highway:0,draws:0,tris:0};
    for (const [system,key] of [[__game.traffic,'street'],[__game.highway,'highway']]) {
      const update=system.update;
      system.update=function(...args){const t=performance.now();const result=update.apply(this,args);__trafficMeasure[key]+=performance.now()-t;return result;};
    }
    const submit=p.submitted;
    p.submitted=function(now){__trafficMeasure.frames++;const r=__render.renderer.info.render;__trafficMeasure.draws+=r.drawCalls;__trafficMeasure.tris+=r.triangles;return submit.call(this,now);};
  })()`);
}
async function sample(id, zone) {
  await choose(id);
  await sleep(3500);
  await evaluate(`Object.assign(__trafficMeasure,{start:performance.now(),frames:0,street:0,highway:0,draws:0,tris:0})`);
  await sleep(8000);
  const result = await evaluate(`(() => {const m=__trafficMeasure,n=m.frames;return {ms:performance.now()-m.start,frames:n,fps:n*1000/(performance.now()-m.start),streetMs:m.street/n,highwayMs:m.highway/n,draws:m.draws/n,triangles:m.tris/n,scale:__render.pacer.scale,street:__game.traffic.vehicles.length,placed:__game.traffic.vehicles.filter(v=>v.edge).length,highway:__game.highway.cars.length,active:__game.active,camera:__game.camera.camera.position.toArray()};})()`);
  check(result.active && result.frames > 0, `Mesure active ${zone}/${id}`);
  report.samples.push({ zone, id, ...result }); console.log(JSON.stringify(report.samples.at(-1)));
  await capture(`${zone}-${id}-${report.samples.length}`);
}
try {
  await mkdir(output, { recursive: true });
  await call('Page.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await call('Emulation.setFocusEmulationEnabled', { enabled: true });
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `navigator.getGamepads=()=>[];localStorage.setItem('nyc-sound','off');` });
  await call('Page.navigate', { url: `http://localhost:5173/?qa=1&stats=1&quality=${quality}&spawn=fdr&architecte=0` });
  await ready();
  const origin = await evaluate('performance.timeOrigin');
  await instrument();
  await pause(); await capture('menu-circulation');
  await click('[data-traffic="none"]');
  await tap('ArrowRight', 'ArrowRight', 39);
  check(await evaluate('__game.traffic.density === "low"'), 'Sélection du trafic au clavier');
  await click('[data-traffic="none"]');
  await click('#pm-resume'); await until('__game.active'); await sleep(750);
  check(await evaluate('__game.traffic.vehicles.length===0 && __game.traffic.cars.every(v=>!v.edge) && __game.traffic.buses.every(v=>!v.edge) && __game.highway.cars.length===0 && __game.highway.lanes.every(l=>l.cars.length===0)'), 'Zéro voiture et zéro bus ambiants, voies libérées');
  check(await evaluate('__game.highway.group.children.filter(m=>m.isInstancedMesh).every(m=>m.count===0 && !m.visible)'), 'Aucune instance routière invisible encore rendue');
  const before = await evaluate('__game.car.position.toArray()');
  await tap('KeyW', 'z', 90, 700);
  const after = await evaluate('__game.car.position.toArray()');
  check(Math.hypot(before[0] - after[0], before[2] - after[2]) > 0.1, 'Conduite réelle au clavier avec trafic coupé');
  // Keep the actual gameplay camera pose fixed during comparisons, even if passing traffic bumps the car.
  await evaluate(`(async()=>{const {settleBody}=await import('/js/car-physics.js');settleBody(__game.car,__game.car.heading);})()`);
  await sleep(600);
  await evaluate(`(() => {const c=__game.camera.camera,p=c.position,d=c.getWorldDirection(new __render.THREE.Vector3());__render.view(p.x,p.y,p.z,p.x+d.x,p.y+d.y,p.z+d.z,c.fov);})()`);
  for (const id of ['high', 'none', 'low', 'medium', 'none', 'high']) await sample(id, 'fdr');
  check(await evaluate(`performance.timeOrigin===${origin}`), 'Aucun rechargement pendant les changements');
  await choose('none');
  check(await evaluate('localStorage.getItem("overdraft:traffic")==="none"'), 'Préférence mémorisée');
  await call('Page.reload'); await ready();
  check(await evaluate('__game.traffic.density==="none" && __game.highway.density==="none" && __game.traffic.vehicles.length===0 && __game.highway.cars.length===0'), 'Zéro trafic restauré après rechargement');
  await choose('high'); await sleep(2000);
  check(await evaluate('__game.traffic.vehicles.length===220 && __game.highway.cars.length>500'), 'Trafic réactivé après un démarrage à zéro');
  await pause();
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await capture('menu-1280-720');
  check(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Menu sans débordement horizontal à 1280 × 720');
  check(report.errors.length === 0, 'Aucune erreur JavaScript ou WebGPU');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack || error); console.error(report.error);
  try { await capture('echec'); } catch { /* Preserve the first error. */ }
} finally {
  await writeFile(`${output}/rapport.json`, JSON.stringify(report, null, 2));
  await fetch(`${host}/json/close/${target.id}`); socket.close();
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
