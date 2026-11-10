#!/usr/bin/env node
// Node 22+, no dependencies. Use only a separately launched QA Chrome; never attach to an existing tab.
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { GEO } from '../js/nyc-geodata.js';

const options = { port: 9334, url: 'http://localhost:5174/?qa=1&quality=balanced&architecte=0', output: resolve(tmpdir(), `overdraft-pause-${Date.now()}`) };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--help') {
    console.log('Usage : node tools/qa-pause-menu.mjs [--port 9334] [--url URL] [--output DOSSIER]\nChrome QA doit déjà tourner avec son propre --user-data-dir et --remote-debugging-port.\nCrée et ferme uniquement ses onglets (jeu + onglet blanc temporaire pour la pause automatique).\nStockage en mémoire réhydraté après navigation ; captures destinées à une revue humaine. Aucun Chrome n’est lancé par ce script.');
    process.exit(0);
  }
  if (!['--port', '--url', '--output'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Argument invalide : ${args[i]}`);
  options[args[i].slice(2)] = args[++i];
}
options.port = Number(options.port);
if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('Port CDP invalide.');
const url = new URL(options.url);
if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Une URL HTTP(S) du jeu est requise.');
url.searchParams.set('qa', '1'); url.searchParams.set('architecte', '0');
const output = resolve(options.output), endpoint = `http://127.0.0.1:${options.port}`;
const report = { startedAt: new Date().toISOString(), url: url.href, output, status: 'running', checks: [], diagnostics: [], navigation: [], screenshots: [], states: [],
  storage: 'Fixture QA dans une Map propre à cet onglet, réhydratée via window.name ; aucun localStorage existant lu ou modifié.',
  imageReview: 'Captures fournies pour revue humaine ; aucune analyse automatique des pixels.' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Map();
const auxiliaryTargets = new Set();
let socket, target, sequence = 0, stage = 'boot';

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
function noErrors() {
  const error = report.diagnostics.find(e => e.fatal);
  if (error) throw new Error(`${stage} : ${error.text}`);
}
async function until(expression, label, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    noErrors();
    try { if (await evaluate(expression)) return; }
    catch (error) { if (!/execution context was destroyed|cannot find context|inspected target navigated/i.test(String(error))) throw error; }
    await sleep(100);
  }
  throw new Error(`Délai dépassé : ${label} (${timeout / 1000} s).`);
}
function check(passed, label, detail = null) {
  report.checks.push({ stage, passed: !!passed, label, detail });
  if (!passed) throw new Error(label);
}
const keys = { Escape: ['Escape', 27], Tab: ['Tab', 9], Enter: ['Enter', 13], Space: [' ', 32],
  ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40], Home: ['Home', 36], End: ['End', 35] };
async function key(code, type, modifiers = 0) {
  const [name, virtual] = keys[code] ?? [code.slice(3).toLowerCase(), code.charCodeAt(3)];
  // nativeVirtualKeyCode is intentionally absent: Windows virtual codes must not be interpreted as macOS scan codes.
  await call('Input.dispatchKeyEvent', { type, code, key: name, windowsVirtualKeyCode: virtual, modifiers });
}
async function tap(code, milliseconds = 60, modifiers = 0) {
  await key(code, 'keyDown', modifiers);
  try { await sleep(milliseconds); } finally { await key(code, 'keyUp', modifiers); }
}
async function click(selector) {
  const point = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw new Error('Élément absent : '+${JSON.stringify(selector)});
    e.scrollIntoView({block:'center',inline:'nearest'}); const r=e.getBoundingClientRect();
    if(!r.width||!r.height||getComputedStyle(e).visibility==='hidden'||e.disabled) throw new Error('Élément inaccessible : '+${JSON.stringify(selector)});
    const x=r.x+r.width/2,y=r.y+r.height/2,top=document.elementFromPoint(x,y);
    if(!e.contains(top)) throw new Error('Élément masqué : '+${JSON.stringify(selector)}); return {x,y}; })()`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
async function capture(name) {
  const { data } = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const path = resolve(output, `${name}.png`);
  await writeFile(path, Buffer.from(data, 'base64')); report.screenshots.push(path);
}
async function snapshot(label) {
  const state = await evaluate(`(() => {const g=window.__game; return {playing:g.playing,paused:g.paused,active:g.active,intro:!!g.intro,
    mapOpen:g.map.isFullMapOpen,modal:g.modal,focused:document.hasFocus(),focus:document.activeElement?.id,
    pointerLocked:!!document.pointerLockElement,fullscreen:!!document.fullscreenElement,
    audio:{enabled:g.audio.enabled,supported:g.audio.supported,context:g.audio.context?.state??null},
    hour:g.atmosphere.hour,weather:g.atmosphere.weather,weatherMode:g.weatherMode??null,lockWeather:!!g.atmosphere.lockWeather,
    clockRunning:g.atmosphere.running,player:g.person.position.toArray(),
    progress:{money:g.money,debt:g.debt,health:g.health,armor:g.armor,distance:g.distance,stolen:g.stolen,weaponId:g.weaponId,
      weapons:g.weapons,missionsDone:g.missionsDone,fleet:g.fleet.filter(c=>!c.pooled&&!c.mode).map(c=>({kind:c.kind,paint:c.paint,hp:c.hp}))},
    quality:new URL(location.href).searchParams.get('quality'),storedQuality:localStorage.getItem('overdraft:quality'),
    save:JSON.parse(localStorage.getItem('overdraft:save:2')),location:location.href,documentStarted:performance.timeOrigin};})()`);
  report.states.push({ label, ...state }); return state;
}
async function ready() {
  await until('!!window.__game && !!window.__render && !!document.querySelector("#loading-overlay.hidden")', 'chargement et précompilation', 180000);
  check(await evaluate('window.__render.renderer.backend.isWebGPUBackend === true'), 'Rendu WebGPU actif');
}
async function start() {
  for (let attempt = 0; attempt < 3; attempt++) {
    await call('Page.bringToFront');
    if (await evaluate('window.__game.playing && !window.__game.intro && window.__game.active')) return;
    const visible = await evaluate('!window.__game.playing || window.__game.paused');
    if (visible) {
      if (await evaluate('document.getElementById("pm-panel-session").hidden')) await click('[data-pause-tab="session"]');
      await click('#play-button');
    }
    await tap('KeyW', 150);
    try { await until('window.__game.playing && !window.__game.intro && window.__game.active', 'entrée dans la ville'); return; }
    catch (error) { if (attempt === 2 || !String(error).includes('Délai dépassé')) throw error; }
  }
}
async function pause() {
  await tap('Escape');
  await until('window.__game.paused && !document.getElementById("game-menu").hidden', 'menu pause ouvert');
  await sleep(300);
}

async function responsiveReview() {
  // Exercise native wheel scrolling; a hidden overflow must not pass merely because DOM scrolling can force a target into view.
  const layout = () => evaluate(`(() => {
    const root=document.getElementById('game-menu'),scroll=root.querySelector('.pm-scroll'),r=scroll.getBoundingClientRect();
    const buttons=Array.from(root.querySelectorAll('button')).filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
    return {width:innerWidth,height:innerHeight,scrollTop:scroll.scrollTop,maxScroll:Math.max(0,scroll.scrollHeight-scroll.clientHeight),
      wheel:{x:r.x+r.width/2,y:r.y+r.height/2,deltaY:Math.max(80,r.height*.6),deltaX:0},
      horizontalOverflow:[document.documentElement,root,root.querySelector('.pm-shell'),scroll,...buttons].filter(e=>e.scrollWidth>e.clientWidth+2)
        .map(e=>({id:e.id||e.className,width:e.clientWidth,scrollWidth:e.scrollWidth})),
      buttons:buttons.map((e,i)=>{const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;
        return {id:e.id||Object.entries(e.dataset).map(([k,v])=>k+'='+v).join(';')||'button-'+i,
          reachable:x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&e.contains(document.elementFromPoint(x,y))};})};
  })()`);
  report.responsive = [];
  for (const [width, height] of [[1280,720],[900,600],[390,844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:false });
    await sleep(250);
    for (const tab of ['session','graphics','world','controls']) {
      await click(`[data-pause-tab="${tab}"]`); await sleep(180);
      const first=await layout(), reached=new Set(), overflows=[], scrolls=[], applyVisibility=[];
      const visit=state=>{state.buttons.filter(b=>b.reachable).forEach(b=>reached.add(b.id));overflows.push(...state.horizontalOverflow);scrolls.push(state.scrollTop);
        if(tab==='graphics')applyVisibility.push(state.buttons.find(b=>b.id==='pm-quality-apply')?.reachable===true);};
      visit(first); await capture(`responsive-${width}x${height}-${tab}`);
      let state=first;
      for(let attempt=0;attempt<40&&state.scrollTop<state.maxScroll-1;attempt++) {
        await call('Input.dispatchMouseEvent',{type:'mouseWheel',...state.wheel}); await sleep(90);
        const next=await layout();visit(next);
        if(next.scrollTop<=state.scrollTop+.5) throw new Error(`Défilement bloqué : ${width}×${height}, ${tab}`);
        state=next;
      }
      const missing=first.buttons.filter(b=>!reached.has(b.id)).map(b=>b.id);
      const item={width,height,tab,scrolls,buttons:first.buttons.length,missing,horizontalOverflow:overflows,applyVisibility};report.responsive.push(item);
      check(!overflows.length, `Aucun débordement horizontal : ${width}×${height}, ${tab}`, overflows);
      check(state.scrollTop>=state.maxScroll-1, `Le bas du panneau est accessible : ${width}×${height}, ${tab}`);
      check(!missing.length, `Tous les boutons sont accessibles par défilement : ${width}×${height}, ${tab}`, missing);
      if(tab==='graphics')check(applyVisibility.every(Boolean), `Appliquer reste visible avant et pendant le défilement : ${width}×${height}`, applyVisibility);
      if(first.maxScroll>1) await capture(`responsive-${width}x${height}-${tab}-bas`);
    }
  }
  await call('Emulation.setDeviceMetricsOverride', { width:1440, height:900, deviceScaleFactor:1, mobile:false });
  await sleep(250); await click('[data-pause-tab="session"]');
}

// Seed a non-empty, valid save to make unintended resets or lost progress observable.
const z = GEO.streets.find(s => s.n === 37).z - 26;
const fixture = { version: 2, state: 'onFoot', player: { x: -12.2, y: 0.22, z, heading: 0 }, active: 0,
  money: 7321, debt: 243210, stolen: 2, distance: 137.25, firstEntry: false, health: 87, armor: 23, held: [],
  weapons: { fists: { mag: 0, ammo: 0 }, pistol: { mag: 8, ammo: 32 } }, weaponId: 'fists', missionsDone: [], radio: 1,
  atmosphere: { hour: 12, weather: 'clear', day: 3 },
  fleet: [['muscle', 0x12305c, 6], ['suv', 0x163c36, 24], ['taxi', 0xffbd22, -12]].map(([kind, paint, offset]) =>
    ({ kind, paint, position: { x: -8.15, y: 0, z: z + offset }, heading: 0, stolen: false, hp: 92 })) };
const storageSource = `(() => {
  const prefix='OVERDRAFT_PAUSE_QA:',seed=${JSON.stringify([['overdraft:save:2', JSON.stringify(fixture)], ['nyc-sound', 'off']])};
  let entries=seed; try {if(window.name.startsWith(prefix)) entries=JSON.parse(window.name.slice(prefix.length));}catch{}
  const values=new Map(entries),persist=()=>{window.name=prefix+JSON.stringify([...values]);};
  const storage={getItem:k=>values.has(String(k))?values.get(String(k)):null,setItem:(k,v)=>{values.set(String(k),String(v));persist();},
    removeItem:k=>{values.delete(String(k));persist();},clear:()=>{values.clear();persist();},key:i=>[...values.keys()][i]??null,get length(){return values.size;}};
  Object.defineProperty(window,'localStorage',{get:()=>storage});persist();
})();`;

async function runChecks() {
  const selectedTab = () => evaluate('document.querySelector("[data-pause-tab][aria-selected=true]")?.dataset.pauseTab');
  const chosenQuality = () => evaluate('document.querySelector("[data-quality][aria-checked=true]")?.dataset.quality');
  const disabled = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled === true`);
  const pressed = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed') === 'true'`);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const stableSave = save => Object.fromEntries(['money','debt','stolen','distance','health','armor','weapons','weaponId','missionsDone',
    'stats','held','radio','safehouses','firstEntry'].map(k => [k, save?.[k]]));
  const boot = await snapshot('menu-initial');
  check(boot.progress.money === fixture.money && boot.progress.debt === fixture.debt && boot.progress.distance === fixture.distance,
    'La progression QA non nulle est restaurée dès le chargement');
  check(!boot.audio.enabled, 'La préférence son coupé est restaurée');
  await capture('01-menu-initial');
  await start(); await pause();
  const paused = await snapshot('pause');
  check(!paused.active && !paused.pointerLocked, 'Pause active et pointeur libéré');
  const initialNavigation = report.navigation.length, initialDocument = paused.documentStarted;
  const activeQuality = await chosenQuality();
  check(['high','balanced','fluid'].includes(activeQuality), 'Le mode graphique actif est sélectionné', activeQuality);

  stage = 'clavier';
  await click('[data-pause-tab="graphics"]');
  await tap('ArrowRight');
  check(await selectedTab() === 'world', 'Flèche droite change réellement d’onglet');
  await tap('Home'); check(await selectedTab() === 'session', 'Début sélectionne le premier onglet');
  await tap('End'); check(await selectedTab() === 'controls', 'Fin sélectionne le dernier onglet');
  await capture('02-commandes');
  await tap('ArrowLeft'); check(await selectedTab() === 'world', 'Flèche gauche revient à Ambiance');
  const tabStates = await evaluate(`Array.from(document.querySelectorAll('[data-pause-tab]'), e => ({id:e.dataset.pauseTab,selected:e.getAttribute('aria-selected'),
    panelHidden:document.getElementById('pm-panel-'+e.dataset.pauseTab)?.hidden}))`);
  check(tabStates.length === 4 && tabStates.every(t => t.panelHidden === (t.selected !== 'true')), 'Un seul panneau accessible est affiché', tabStates);
  for (let i = 0; i < 28; i++) {
    await tap('Tab', 20);
    check(await evaluate('!!document.activeElement?.closest("#game-menu")'), `Tab reste dans le menu (${i + 1})`);
  }
  await tap('Tab', 20, 8);
  check(await evaluate('!!document.activeElement?.closest("#game-menu")'), 'Maj+Tab reste dans le menu');
  await tap('KeyM');
  check(await evaluate('!window.__game.map.isFullMapOpen'), 'M n’ouvre pas la carte derrière le menu');
  await tap('KeyW', 200);
  check(same(paused.player, await evaluate('window.__game.person.position.toArray()')), 'Les touches du menu ne déplacent pas le joueur');
  await capture('02-ambiance-clavier');

  stage = 'selection-graphique';
  await click('[data-pause-tab="graphics"]');
  check(await disabled('#pm-quality-apply'), 'Appliquer est désactivé sans changement');
  await click('[data-quality="fluid"]');
  await tap('ArrowRight'); check(await chosenQuality() === 'balanced', 'Les flèches sélectionnent le mode graphique');
  await tap('End'); check(await chosenQuality() === 'high', 'Fin sélectionne Haute');
  await tap('Home'); check(await chosenQuality() === 'fluid', 'Début sélectionne Fluide');
  const differentQuality = activeQuality === 'fluid' ? 'high' : 'fluid';
  await click(`[data-quality="${differentQuality}"]`);
  await sleep(300);
  let state = await snapshot('qualite-en-attente');
  check(report.navigation.length === initialNavigation && state.documentStarted === initialDocument,
    'Choisir la qualité ne recharge pas la page');
  check(state.storedQuality === paused.storedQuality && state.quality === paused.quality,
    'La sélection différée ne modifie ni préférence persistée ni URL');
  check(!await disabled('#pm-quality-apply'), 'Appliquer est activé pour un changement');
  await capture('03-graphismes-en-attente');
  await click('#pm-quality-reset');
  check(await chosenQuality() === activeQuality && await disabled('#pm-quality-apply'), 'Annuler rétablit le mode actif sans navigation');
  await click(`[data-quality="${differentQuality}"]`);
  await tap('Escape');
  await until('window.__game.active && !window.__game.paused', 'Échap reprend depuis les réglages');
  await pause(); await click('[data-pause-tab="graphics"]');
  check(await chosenQuality() === activeQuality && await disabled('#pm-quality-apply'), 'Échap abandonne le mode graphique non appliqué');

  stage = 'tailles-ecran';
  await responsiveReview();

  stage = 'ambiance';
  await click('[data-pause-tab="world"]');
  check(await pressed('[data-sound="off"]'), 'Le bouton Son coupé reflète l’état réel');
  await click('[data-sound="on"]');
  await until('window.__game.audio.enabled && (!window.__game.audio.supported || window.__game.audio.context?.state === "running")', 'activation audio directe');
  check(await pressed('[data-sound="on"]'), 'Son activé sélectionné');
  await click('[data-sound="off"]');
  await until('!window.__game.audio.enabled && (!window.__game.audio.context || window.__game.audio.context.state === "suspended")', 'coupure audio directe');
  check(await evaluate('localStorage.getItem("nyc-sound") === "off"'), 'Son coupé mémorisé');
  await click('[data-clock="hold"]');
  await click('[data-game-time="golden"]');
  check(await evaluate('window.__game.atmosphere.hour === 18 && !window.__game.atmosphere.running'), 'Heure fixe appliquée directement');
  await click('[data-weather="rain"]');
  check(await evaluate('window.__game.atmosphere.weather === "rain" && window.__game.atmosphere.lockWeather'), 'Pluie appliquée et verrouillée directement');
  check(await pressed('[data-weather="rain"]'), 'Pluie sélectionnée dans le panneau');
  await capture('04-ambiance-pluie');
  await click('[data-weather="auto"]');
  check(await evaluate('!window.__game.atmosphere.lockWeather'), 'Météo automatique libérée');
  await click('[data-weather="clear"]'); await click('[data-game-time="midday"]');
  await click('[data-clock="run"]'); check(await evaluate('window.__game.atmosphere.running'), 'Horloge relancée directement');
  await click('[data-clock="hold"]');
  state = await snapshot('ambiance-appliquee');
  check(report.navigation.length === initialNavigation && state.documentStarted === initialDocument, 'Les réglages d’ambiance ne rechargent pas');

  stage = 'confirmation-reset';
  await click('[data-pause-tab="session"]');
  // Enter pause again through the UI so its save includes all direct ambience changes before byte comparison.
  await click('#pm-resume'); await until('window.__game.active', 'reprise avant contrôle de sauvegarde'); await pause();
  const beforeCancel = await evaluate('localStorage.getItem("overdraft:save:2")');
  await click('#new-session');
  await until('document.getElementById("pm-reset-dialog").open', 'confirmation nouvelle partie');
  check(await evaluate('window.__game.paused && !window.__game.resetting'), 'Ouvrir la confirmation ne réinitialise rien');
  await capture('05-confirmation-nouvelle-partie');
  await tap('Escape'); await until('!document.getElementById("pm-reset-dialog").open', 'Échap ferme uniquement la confirmation');
  check(await evaluate('window.__game.paused && !window.__game.active'), 'Échap du dialogue conserve la pause');
  await click('#new-session'); await click('#pm-reset-cancel');
  check(await evaluate('!document.getElementById("pm-reset-dialog").open && !window.__game.resetting'), 'Annuler ferme la confirmation sans reset');
  check(await evaluate('localStorage.getItem("overdraft:save:2")') === beforeCancel && report.navigation.length === initialNavigation,
    'Les deux annulations préservent la sauvegarde et ne naviguent pas');

  stage = 'credits';
  await click('#credits-button'); await until('document.getElementById("credits-dialog").open', 'crédits ouverts par clic');
  await capture('06-credits');
  await tap('Escape'); await until('!document.getElementById("credits-dialog").open', 'Échap ferme les crédits');
  check(await evaluate('window.__game.paused && !window.__game.active'), 'Fermer les crédits conserve la pause');
  check(await evaluate('document.activeElement === document.getElementById("credits-button")'), 'Le focus revient au bouton Crédits');

  stage = 'carte';
  await click('#pm-map');
  await until('window.__game.map.isFullMapOpen && document.getElementById("game-menu").hidden', 'carte ouverte depuis pause');
  await capture('06-carte-depuis-pause');
  await tap('Escape');
  await until('!window.__game.map.isFullMapOpen && window.__game.paused && !document.getElementById("game-menu").hidden', 'retour carte vers pause');
  await click('#pm-resume'); await until('window.__game.active', 'reprise par bouton');
  await tap('KeyM'); await until('window.__game.map.isFullMapOpen', 'carte depuis jeu');
  await tap('Escape'); await sleep(350);
  check(await evaluate('window.__game.active && !window.__game.paused && !window.__game.map.isFullMapOpen'), 'Échap ferme la carte en jeu sans ouvrir la pause');

  stage = 'telephone-pause-automatique';
  await tap('KeyP'); await until('window.__game.phone.open && window.__game.modal', 'téléphone ouvert par P');
  const phoneBefore = await evaluate('({sel:window.__game.phone.sel,stack:window.__game.phone.stack.map(s=>s[0]),money:window.__game.money,debt:window.__game.debt})');
  // A second blank QA tab produces a real visibility change. It is the only additional target we may activate or close.
  const cover = await (await http(`/json/new?${encodeURIComponent('about:blank')}`, 'PUT')).json();
  auxiliaryTargets.add(cover.id); report.coverTargetId=cover.id;
  try {
    await http(`/json/activate/${encodeURIComponent(cover.id)}`);
    await until('document.hidden && window.__game.paused', 'pause automatique lorsque le téléphone est masqué');
    await http(`/json/activate/${encodeURIComponent(target.id)}`); await call('Page.bringToFront');
    await until('!document.hidden && window.__game.paused && window.__game.phone.open', 'retour au jeu en pause avec téléphone conservé');
  } finally {
    await http(`/json/close/${encodeURIComponent(cover.id)}`); auxiliaryTargets.delete(cover.id);
  }
  await click('[data-pause-tab="session"]'); await tap('ArrowRight');
  check(await selectedTab()==='graphics', 'Le menu reçoit les flèches pendant que le téléphone attend derrière');
  check(same(phoneBefore,await evaluate('({sel:window.__game.phone.sel,stack:window.__game.phone.stack.map(s=>s[0]),money:window.__game.money,debt:window.__game.debt})')),
    'La navigation du menu ne change ni le téléphone ni les comptes');
  await click('#credits-button'); await until('document.getElementById("credits-dialog").open', 'crédits au-dessus du téléphone en pause');
  await tap('Escape'); await until('!document.getElementById("credits-dialog").open', 'fermeture native non interceptée par le téléphone');
  check(await evaluate('window.__game.paused && window.__game.phone.open'), 'Échap du dialogue préserve téléphone et pause');
  await capture('07-telephone-en-pause');
  await tap('Escape'); await until('!window.__game.paused && window.__game.phone.open', 'reprise vers le téléphone');
  await tap('Escape'); await until('window.__game.active && !window.__game.phone.open', 'Échap ferme ensuite le téléphone');
  check(true,'Le téléphone retrouve ses commandes après la reprise');

  stage = 'pointer-lock';
  const supportsPointerLock = await evaluate('typeof window.__game.camera.domElement.requestPointerLock === "function"');
  if (supportsPointerLock) {
    await click('#canvas-container > canvas');
    await until('!!document.pointerLockElement', 'verrouillage pointeur par vrai clic');
    await tap('Escape');
    await until('!document.pointerLockElement && window.__game.paused', 'Échap libère le pointeur et ouvre pause');
    await sleep(400);
    check(await evaluate('window.__game.paused'), 'Une seule transition de pause après perte de pointeur');
  } else { report.checks.push({stage,skipped:true,label:'Pointer Lock indisponible dans ce navigateur'}); await pause(); }

  stage = 'plein-ecran';
  await click('[data-pause-tab="world"]');
  const supportsFullscreen = await evaluate('document.fullscreenEnabled && !document.getElementById("fullscreen-toggle").hidden');
  if (supportsFullscreen) {
    await click('#fullscreen-toggle'); await until('!!document.fullscreenElement', 'entrée plein écran par clic');
    check(await evaluate('window.__game.paused'), 'Le plein écran conserve la pause');
    await click('#fullscreen-toggle'); await until('!document.fullscreenElement', 'sortie plein écran par clic');
    check(await evaluate('window.__game.paused'), 'Sortir du plein écran conserve la pause');
  } else report.checks.push({stage,skipped:true,label:'Plein écran indisponible dans ce navigateur'});

  stage = 'appliquer-graphismes';
  await click('[data-pause-tab="graphics"]'); await click(`[data-quality="${differentQuality}"]`);
  const beforeApply = await snapshot('avant-application');
  const navigationBeforeApply = report.navigation.length;
  await click('#pm-quality-apply');
  await until(`performance.timeOrigin !== ${beforeApply.documentStarted}`, 'navigation graphique');
  await ready(); await sleep(300);
  const applied = await snapshot('apres-application');
  check(report.navigation.length === navigationBeforeApply + 1, 'Appliquer effectue exactement une navigation', report.navigation.slice(navigationBeforeApply));
  check(applied.quality === differentQuality && applied.storedQuality === differentQuality, 'Le mode appliqué correspond à l’URL et la préférence');
  check(same(stableSave(beforeApply.save), stableSave(applied.save)), 'La progression sauvegardée est conservée après rechargement',
    {before:stableSave(beforeApply.save),after:stableSave(applied.save)});
  check(same(beforeApply.progress, applied.progress), 'La progression et la flotte sont réellement restaurées dans le jeu');
  check(!applied.audio.enabled && await pressed('[data-sound="off"]'), 'Le son coupé survit au rechargement');
  await click('[data-pause-tab="graphics"]');
  check(await chosenQuality() === differentQuality && await disabled('#pm-quality-apply'), 'Le nouveau mode est actif sans changement en attente');
  await capture('07-mode-applique');
  await start(); await pause(); await tap('Escape');
  await until('window.__game.active && !window.__game.paused', 'reprise finale par Échap');
  check(report.navigation.length === navigationBeforeApply + 1, 'Aucune seconde navigation différée');
  await capture('08-jeu-apres-reprise');
}

try {
  await mkdir(output, { recursive: true });
  target = await (await http(`/json/new?${encodeURIComponent('about:blank')}`, 'PUT')).json();
  report.targetId = target.id;
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Connexion CDP expirée.')), 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Connexion CDP impossible.')); }, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), p = message.params;
    if (message.id) {
      const request = pending.get(message.id); if (!request) return;
      clearTimeout(request.timer); pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result || {}); return;
    }
    if (message.method === 'Page.frameNavigated' && !p.frame.parentId) report.navigation.push({ stage, url: p.frame.url, loaderId: p.frame.loaderId });
    let level, source, text;
    if (message.method === 'Runtime.exceptionThrown') { level='exception';source=message.method;text=p.exceptionDetails.exception?.description||p.exceptionDetails.text; }
    if (message.method === 'Runtime.consoleAPICalled' && ['error','warning','warn'].includes(p.type)) {
      level=p.type==='error'?'error':'warning';source=message.method;text=p.args.map(a=>a.value??a.description??a.type).join(' ');
    }
    if (message.method === 'Log.entryAdded' && ['error','warning'].includes(p.entry.level)) {level=p.entry.level;source=`Log.${p.entry.source}`;text=p.entry.text;}
    if (source) {
      const gpu=/webgpu|wgsl|gpuvalidation|shader|pipeline|varying|\[compile\]/i.test(text)&&/error|invalid|fail|exceed|limit|not compatible/i.test(text);
      report.diagnostics.push({stage,source,level,fatal:level==='error'||level==='exception'||gpu,text:String(text).slice(0,12000)});
    }
  });
  socket.addEventListener('close', () => {for(const r of pending.values()){clearTimeout(r.timer);r.reject(new Error('Connexion CDP fermée.'));}pending.clear();});
  await Promise.all([call('Runtime.enable'),call('Log.enable'),call('Page.enable')]);
  await call('Page.bringToFront');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:storageSource});
  const navigation=await call('Page.navigate',{url:url.href}); if(navigation.errorText) throw new Error(navigation.errorText);
  await ready(); await runChecks(); await sleep(250); noErrors();
  check(true,'Aucune erreur JavaScript ou WebGPU depuis le chargement'); report.status='passed';
} catch(error) {
  report.status='failed';report.error=String(error?.stack||error);
  try {if(socket?.readyState===WebSocket.OPEN){await snapshot('echec');await capture('echec');}} catch {/* Preserve original error. */}
} finally {
  if(socket?.readyState===WebSocket.OPEN){try{for(const code of ['KeyW','Escape','Tab','ArrowRight','ArrowDown','Enter','Space'])await key(code,'keyUp');}catch{}}
  for(const id of auxiliaryTargets){try{await http(`/json/close/${encodeURIComponent(id)}`);}catch(error){report.cleanupError=String(error);report.status='failed';}}
  if(target?.id){try{await http(`/json/close/${encodeURIComponent(target.id)}`);}catch(error){report.cleanupError=String(error);report.status='failed';}}
  socket?.close();report.finishedAt=new Date().toISOString();
  const json=JSON.stringify(report,null,2);await writeFile(resolve(output,'rapport.json'),`${json}\n`);console.log(json);
  process.exitCode=report.status==='passed'?0:1;
}
