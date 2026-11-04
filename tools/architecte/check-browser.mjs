// Exercises the real game and control room in a private headless Chrome, always in a temporary workshop with code
// editing disabled. No API key by default; --live-autonomy explicitly enables the server's key with a $0.50 ceiling.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Chantier } from './chantier.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const buildVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'architecte-browser-'));
const port = Number(process.env.ARCHITECTE_TEST_PORT || 7783);
const deep = process.argv.includes('--deep');
const published = process.argv.includes('--published');
const lightingCheck = process.argv.includes('--lighting');
const liveAutonomy = process.argv.includes('--live-autonomy');
const autonomyCheck = liveAutonomy || process.argv.includes('--autonomy');
const output = process.env.ARCHITECTE_TEST_OUTPUT || path.join(os.tmpdir(), published ? 'architecte-browser-published-latest.json' : liveAutonomy ? 'architecte-live-autonomy-latest.json' : autonomyCheck ? 'architecte-autonomy-latest.json' : 'architecte-browser-latest.json');
const staticRoot = published ? path.join(root, 'dist') : root;
const report = { date: new Date().toISOString(), mode: published ? 'publication' : autonomyCheck ? 'autonomie' : deep ? 'approfondi' : 'standard', api: liveAutonomy, checks: [], screenshots: [], errors: [] };
const c = new Chantier(temp);
c.settings.atelier = false;
c.settings.allume = false;
if (liveAutonomy) {
  c.settings.plafond = .5;
  c.settings.cerveaux.relecture = { modele: 'vif', effort: 'low' };
}
if (autonomyCheck) for (const stage of ['a_valider', 'echec', 'atelier']) {
  const ticket = c.createTicket({ titre: `Témoin en ${stage}`, categorie: 'bug', gravite: 'basse', photos: [], lieu: { x: 1051, z: 716 }, version: buildVersion });
  if (stage !== 'a_valider') {
    c.updateTicket(ticket.id, { statut: 'valide' }, { qui: 'createur', texte: 'Validé pour le banc isolé.' });
    c.updateTicket(ticket.id, { statut: 'atelier' }, { qui: 'atelier', texte: 'État fictif du banc, aucun agent de code lancé.' });
    if (stage === 'echec') c.updateTicket(ticket.id, { statut: 'echec' }, { qui: 'atelier', texte: 'Échec fictif.' });
  }
}
if (deep) for (let n = 1; n <= 3; n++) c.createTicket({ titre: `Essai isolé ${n}`, en_clair: 'Ticket fictif du banc de test.', categorie: 'outil', gravite: 'mineur', constat: 'Exercice du parcours de décision.', piste: '', photos: [], lieu: { x: 0, y: 0, z: 0, adresse: 'Banc isolé' }, version: buildVersion });
c.save();
const serverLog = fs.openSync(path.join(temp, 'serveur.log'), 'w');
const env = { ...process.env, ANTHROPIC_API_KEY: '', ARCHITECTE_ENV: liveAutonomy ? path.join(root, '.env.local') : path.join(temp, 'absent.env'), ARCHITECTE_CHANTIER_ROOT: temp, ARCHITECTE_PORT: String(port) };
// Node's env-file loader does not replace an existing variable, even an empty one. Let only the server load its key.
if (liveAutonomy) delete env.ANTHROPIC_API_KEY;
const startServer = () => spawn(process.execPath, [path.join(root, 'tools/architecte/server.mjs')], { cwd: root, env, stdio: ['ignore', serverLog, serverLog] });
let server = startServer();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.gz': 'application/octet-stream' };
const staticServer = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  const file = path.resolve(staticRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(staticRoot + path.sep) || pathname.split('/').some(p => p.startsWith('.'))) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(data); });
});
await new Promise(r => staticServer.listen(0, '127.0.0.1', r));
const origin = `http://${published ? 'overdraft-review.test' : '127.0.0.1'}:${staticServer.address().port}`;
const gameUrl = `${origin}/?qa=1&stats=1&quality=balanced&architecte_port=${port}`;
const profile = path.join(temp, 'chrome');
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--enable-unsafe-webgpu', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--window-size=1440,900',
  ...(published ? ['--no-proxy-server', '--host-resolver-rules=MAP overdraft-review.test 127.0.0.1', `--unsafely-treat-insecure-origin-as-secure=${origin}`] : []), 'about:blank'
], { stdio: 'ignore' });
const wait = ms => new Promise(r => setTimeout(r, ms));
const sockets = [];
let endpoint;
const roomUrl = `http://127.0.0.1:${port}`;

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(ws);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let serial = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') report.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') report.errors.push(m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') report.errors.push(m.params.entry.text);
    if (m.method === 'Network.requestWillBeSent') {
      const url = new URL(m.params.request.url);
      if (/\/(?:architect[\w-]*|repro-link)\.(?:js|css)$/.test(url.pathname) || url.port === String(port)) (report.architectRequests ??= []).push(url.href);
    }
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) report.errors.push(`${m.params.response.status} ${m.params.response.url}`);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 150000);
    pending.set(id, m => { clearTimeout(timer); m.error ? reject(Error(m.error.message)) : resolve(m.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const click = async selector => {
    const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  const tap = async (code, key) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }); };
  const shot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(temp, `${name}.png`); fs.writeFileSync(file, Buffer.from(data, 'base64')); report.screenshots.push(file);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return { send, evaluate, click, tap, shot };
}

function check(name, ok, details) {
  report.checks.push({ name, ok: !!ok, details });
  console.log(`${ok ? 'OK' : 'ÉCHEC'} ${name}`, details ?? '');
  if (!ok) throw Error(`Échec : ${name}`);
}

const command = async body => (await fetch(roomUrl + '/salle/commande', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
async function waitFor(fn, seconds = 10) {
  for (let n = 0; n < seconds * 5; n++) { const value = await fn(); if (value) return value; await wait(200); }
  return false;
}

async function deepGame(game) {
  await game.evaluate(`__game.atmosphere.setHour(17);__game.atmosphere.setWeather('clear',true);__game.atmosphere.update(0,false);window.__world=(()=>{const a=__game.atmosphere;return {hour:a.hour,weather:a.weather,grip:__game.controllers.gripFactor,flash:a.flash,nextFlash:a.nextFlash,thunder:JSON.stringify(a.thunderQueue)}})();__game.save();window.__saved=JSON.stringify(localStorage);window.__storm=__game.architect.lab.run({type:'explosion',conditions:{heure:13,meteo:'storm'}});true`);
  await wait(250);
  check('Sauvegarde suspendue pendant le laboratoire', await game.evaluate(`__game.save();JSON.stringify(localStorage)===window.__saved`));
  const restored = await game.evaluate(`(()=>{__game.architect.lab.cancel('Annulation du banc météo');const a=__game.atmosphere,w=window.__world;return {weather:a.weather,grip:__game.controllers.gripFactor,hour:a.hour,flash:a.flash,nextFlash:a.nextFlash,thunder:JSON.stringify(a.thunderQueue),before:w}})()`);
  check('Annulation : météo et adhérence restaurées immédiatement', restored.weather === restored.before.weather && restored.grip === restored.before.grip && restored.flash === restored.before.flash && restored.thunder === restored.before.thunder && restored.nextFlash === restored.before.nextFlash && Math.abs(restored.hour - restored.before.hour) < .05, restored);
  await game.evaluate('window.__storm');
  for (const type of ['explosion', 'crash', 'bordure']) {
    console.log('EXPÉRIENCE', type);
    const result = await game.evaluate(`__game.architect.lab.run({type:${JSON.stringify(type)},vitesse:50,conditions:{heure:13,meteo:'clear'}})`);
    report.experiments ??= [];
    report.experiments.push({ type, ok: result.ok, validite: result.validite, raisons: result.raisons, mesures: result.mesures, params: result.params, photos: result.images?.length || 0, texte: result.texte });
    check(`Expérience complète : ${type}`, result.ok && ['valide', 'perturbee'].includes(result.validite), report.experiments.at(-1));
    check(`Nettoyage après ${type}`, await game.evaluate(`!__game.architect.lab.running&&__game.architect.lab.hooks.size===0&&!__game.fleet.some(c=>c.mission&&c.locked&&c.kind==='sedan'&&c.paint===0x8a8f96)`));
  }
  const cancel = await game.evaluate(`window.__measure=__game.architect.measurePerformance(8);setTimeout(()=>__game.architect.dismiss(),150);window.__measure`);
  check('Extinction annule une mesure passive', !cancel.ok, cancel.texte);
  check('Aucun collecteur après annulation', await game.evaluate(`__game.architect.measurements.size===0&&__game.architect.performanceProbes.size===0`));
  for (let n = 0; n < 3; n++) {
    await command({ action: 'allumer', on: true });
    check(`Rallumage ${n + 1}`, await waitFor(() => game.evaluate(`__game.architect.present&&__game.architect.alive`)));
    if (n < 2) { await command({ action: 'allumer', on: false }); await wait(150); }
  }
  const restricted = await game.evaluate(`Promise.all([['lancer_experience',{type:'nuit'}],['regler_heure_meteo',{heure:0,meteo:'storm'}],['se_teleporter',{x:0,z:0}],['aller_a',{x:__game.player.x+1000,z:__game.player.z}]].map(async([name,input])=>({name,...await __game.architect.link.execute(name,input)})))`);
  check('Mode Ensemble : monde et périmètre protégés', restricted.every(r => !r.ok), restricted);
  await game.tap('KeyL', 'l'); await wait(300);
  await game.evaluate(`window.__photoCancelled=__game.architect.link.photo({direction:'devant',cadrage:'rue'});true`);
  await game.tap('KeyL', 'l');
  const shot = await game.evaluate(`window.__photoCancelled`);
  check('Reprise caméra pendant préparation photo', !shot.ok, shot.texte);
  await game.tap('KeyL', 'l'); await wait(300);
  const pos = await game.evaluate(`({x:__game.person.position.x,z:__game.person.position.z})`);
  await game.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'z', windowsVirtualKeyCode: 90 }); await wait(700);
  await game.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'z', windowsVirtualKeyCode: 90 });
  check('Mode Seul : commandes joueur neutralisées', await game.evaluate(`Math.hypot(__game.person.position.x-${pos.x},__game.person.position.z-${pos.z})<.05`));
}

async function deepRoom(game, room) {
  await room.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await room.click('[data-view="tickets"]');
  await room.click('#ticket-list .trow');
  const title = await room.evaluate(`document.getElementById('r-title').textContent`);
  await room.tap('KeyR', 'r');
  check('R ouvre le motif de rejet', await room.evaluate(`!document.getElementById('r-compose').hidden`));
  await room.send('Input.insertText', { text: 'Faux positif du banc isolé.' });
  await room.tap('Escape', 'Escape');
  check('Échap annule le motif sans fermer le ticket', await room.evaluate(`document.getElementById('r-compose').hidden&&!document.getElementById('review').hidden`));
  await room.tap('KeyD', 'd');
  await room.send('Input.insertText', { text: 'Reprendre une photo de jour.' });
  await room.tap('Enter', 'Enter'); await wait(350);
  let state = await (await fetch(roomUrl + '/salle/etat')).json();
  check('Entrée enregistre la demande de précisions', state.tickets.some(t => t.titre === title && t.statut === 'plus' && t.fil.at(-1).texte.includes('Reprendre une photo')));
  const nextTitle = await room.evaluate(`document.getElementById('r-title').textContent`);
  await room.tap('KeyV', 'v'); await wait(350);
  state = await (await fetch(roomUrl + '/salle/etat')).json();
  check('V donne une validation durable sans lancer en manuel', state.tickets.some(t => t.titre === nextTitle && t.statut === 'valide' && t.validation?.par === 'createur') && !state.atelier?.enCours);
  await room.tap('KeyR', 'r'); await room.send('Input.insertText', { text: 'Rejet du banc isolé.' }); await room.tap('Enter', 'Enter'); await wait(350);
  state = await (await fetch(roomUrl + '/salle/etat')).json();
  check('R puis Entrée enregistre le rejet', state.tickets.some(t => t.statut === 'rejete' && t.fil.at(-1).texte.includes('Rejet du banc isolé')));
  await room.tap('Escape', 'Escape');
  await command({ action: 'gouts', regles: ['Préférer les preuves de jour.', 'Aucun ticket sans mesure.'] });
  await command({ action: 'plafond', plafond: 2.25 });
  const previousCharge = state.jeu.charge;
  const stopped = new Promise(resolve => server.once('close', resolve)); server.kill('SIGTERM'); await stopped;
  server = startServer();
  check('Salle reconnectée après redémarrage du serveur', await waitFor(() => room.evaluate(`document.getElementById('r-title')!==null`).catch(() => false)) && await waitFor(() => game.evaluate(`__game.architect.link.connected`), 20));
  state = await (await fetch(roomUrl + '/salle/etat')).json();
  const memory = await (await fetch(roomUrl + '/salle/memoire')).json();
  check('Réglages et tickets conservés après redémarrage', state.settings.plafond === 2.25 && state.tickets.filter(t => ['valide', 'rejete', 'plus'].includes(t.statut)).length === 3 && state.jeu.charge === previousCharge, { plafond: state.settings.plafond, statuts: state.tickets.map(t => t.statut), charge: state.jeu.charge, previousCharge });
  check('Goûts conservés après redémarrage', JSON.stringify(memory).includes('Préférer les preuves de jour.'));
  // Bringing a real second tab to the front triggers Chromium's real visibility lifecycle.
  await game.send('Page.bringToFront'); await wait(300);
  await command({ action: 'camera', qui: 'lui' }); await wait(300);
  const start = await game.evaluate(`__game.clock`);
  await room.send('Page.bringToFront'); await wait(3500);
  const hidden = await game.evaluate(`({hidden:document.hidden,clock:__game.clock,ticking:__game.architect.ticking,seul:__game.architect.spectating})`);
  report.hiddenTab = hidden;
  check('Onglet masqué : le mode Seul continue réellement', hidden.hidden && hidden.ticking && hidden.seul && hidden.clock > start + .8, { ...hidden, start });
  await command({ action: 'camera', qui: 'toi' }); await wait(800);
  const frozen = await game.evaluate(`__game.clock`); await wait(1500);
  check('Onglet masqué : Ensemble respecte la pause', await game.evaluate(`!__game.architect.spectating&&__game.paused&&__game.clock-${frozen}<.15`));
  await command({ action: 'camera', qui: 'lui' }); await wait(3500);
  const resumed = await game.evaluate(`({hidden:document.hidden,ticking:__game.architect.ticking,seul:__game.architect.spectating,clock:__game.clock})`);
  check('Donner la caméra quand l’onglet est déjà masqué', resumed.hidden && resumed.ticking && resumed.seul && resumed.clock > frozen + .8, resumed);
  await command({ action: 'camera', qui: 'toi' });
  check('Reprendre la caméra masquée arrête immédiatement le Worker', await game.evaluate(`__game.paused&&!__game.architect.ticking&&!__game.architect.spectating`));
  await game.send('Page.bringToFront');
  await game.evaluate(`__game.setPaused(false)`);
}

// With --autonomy, only the judgement is a stub: the real scheduler, programme, photos, traffic and vehicle physics
// run against the private game. --live-autonomy instead uses the real server mind, capped at $0.50 in its own session.
async function testAutonomy(game) {
  await command({ action: 'allumer', on: true }); await command({ action: 'pause', pause: true });
  check('Corps présent pour la prospection', await waitFor(() => game.evaluate(`__game.architect.alive&&__game.architect.present`)));
  await game.tap('KeyL', 'l');
  check('Caméra humaine donnée à la prospection', await game.evaluate(`__game.architect.spectating`));
  const places = await game.evaluate(`(()=>{const a=__game.architect,f=a.focus(),seen=new Set();return __game.traffic.network.edges.flatMap(e=>[e.from,e.to]).filter(p=>p&&Math.hypot(p.x-f.x,p.z-f.z)>60&&Math.hypot(p.x-f.x,p.z-f.z)<240).filter(p=>{const k=p.x+','+p.z;if(seen.has(k))return false;seen.add(k);return true}).slice(0,20).map((p,i)=>({id:'temoin-'+i,label:'Rue témoin '+i,x:p.x,z:p.z}))})()`);
  check('Lieux réels accessibles pour le banc', places.length >= 3, places.length);
  let snapshot = await (await fetch(roomUrl + '/salle/etat')).json();
  await fetch(roomUrl + '/jeu/bonjour', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ build: buildVersion, charge: snapshot.jeu.charge, lieux: places }) });
  let brain, memoire, programme, localChantier, judgements = 0;
  if (!liveAutonomy) {
    const [{ Brain }, { Programme }, { Memoire }] = await Promise.all([import('./brain.mjs'), import('./programme.mjs'), import('./memoire.mjs')]);
    localChantier = new Chantier(path.join(temp, 'prospection')); localChantier.settings.allume = true;
    for (const source of snapshot.tickets) localChantier.tickets.set(source.id, structuredClone(source));
    memoire = new Memoire(localChantier);
    const bridge = { connected: true, state: snapshot.etat, loadedAt: snapshot.jeu.charge, build: buildVersion,
      command: (name, input) => command({ action: 'jeu', commande: name, input }) };
    brain = new Brain({ chantier: localChantier, memoire, game: bridge, code: { staleSince: () => [], state: () => ({ branche: 'main', head: 'temoin', fichiers: [] }) }, notify() {} });
    brain.client = { messages: { create() { throw Error('Appel API interdit dans ce banc.'); } } };
    brain.places = places;
    brain.think = async (reason, ctx) => {
      check('Chaque jugement suit une nouvelle preuve', reason === 'etape' && (ctx.shots?.length || ctx.mesures?.length));
      judgements++;
      memoire.observe({ texte: 'Observation témoin, sans ouvrir de ticket.', photos: ctx.shots.map(s => s.id), lieu: ctx.lieu, sujet: ctx.sujet });
      return true;
    };
    programme = brain.programme = new Programme({ brain, game: bridge, memoire, log: (...args) => brain.log(...args), notify() {} });
  } else {
    check('Cerveau réel relié, plafond isolé de 0,50 $', snapshot.cerveau.cle && snapshot.settings.plafond === .5, { cleDisponible: snapshot.cerveau.cle, plafond: snapshot.settings.plafond });
    await command({ action: 'pause', pause: false });
  }
  const modes = new Set(), traces = [], deadline = Date.now() + 210000;
  let lastProgram = null;
  try {
    while (Date.now() < deadline) {
      snapshot = await (await fetch(roomUrl + '/salle/etat')).json();
      const a = snapshot.etat?.architecte;
      if (a?.mode) modes.add(a.mode);
      if (brain) {
        Object.assign(brain.game, { state: snapshot.etat, loadedAt: snapshot.jeu.charge });
        brain.heartbeat(); programme.tick().catch(e => report.errors.push(e.stack));
      }
      const p = brain ? programme.summary() : snapshot.programme;
      const count = brain ? judgements : snapshot.cerveau.pensees;
      if (p?.id !== lastProgram) { lastProgram = p?.id; traces.push({ programme: p?.sujet, origine: p?.origine, x: a?.x, z: a?.z, mode: a?.mode, jugements: count }); console.log('PROSPECTION', traces.at(-1)); }
      if (liveAutonomy ? count >= 1 && (snapshot.cerveau.autonomie?.programmes || 0) >= 2 : judgements >= 3 && modes.has('voiture') && modes.has('hélico')) break;
      if (liveAutonomy && snapshot.cerveau.pause) break;
      await wait(500);
    }
    const status = brain ? brain.autonomie.status() : snapshot.cerveau.autonomie;
    const count = brain ? judgements : snapshot.cerveau.pensees;
    report.autonomy = { status, judgements: count, modes: [...modes], traces, depense: snapshot.cerveau.depense, plafond: snapshot.settings.plafond,
      pensees: liveAutonomy ? snapshot.journal.filter(e => e.kind === 'pensee').map(e => e.text) : [] };
    check('Prospection poursuivie malgré attente, échec et ancien atelier', (status?.programmes || 0) >= (liveAutonomy ? 2 : 3) && count >= (liveAutonomy ? 1 : 3), report.autonomy);
    if (!liveAutonomy) {
      check('Marche, voiture et hélico réellement observés', modes.has('à pied') && modes.has('voiture') && modes.has('hélico'), [...modes]);
      check('Photos neuves conservées à chaque observation', localChantier.counters.photo >= 6, localChantier.counters.photo);
      check('Aucune fausse validation ou livraison', [...localChantier.tickets.values()].every(t => !['corrige', 'verifie'].includes(t.statut)));
    } else check('Plafond de test API respecté', snapshot.cerveau.depense + (snapshot.cerveau.depense_estimee || 0) <= .5, report.autonomy);
    await game.shot(liveAutonomy ? 'prospection-cerveau-reel' : 'prospection-trois-modes');
  } finally {
    if (brain) { brain.setPaused(true); programme.suspend(); await wait(100); memoire.save(); localChantier.save(); }
    await command({ action: 'pause', pause: true }); await command({ action: 'allumer', on: false });
  }
  check('Prospection : aucune erreur navigateur ou ressource', report.errors.length === 0, report.errors);
}

try {
  for (let i = 0; i < 100 && !endpoint; i++) { try { endpoint = 'http://127.0.0.1:' + fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {} await wait(100); }
  if (!endpoint) throw Error('Chrome indisponible');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(roomUrl + '/salle/etat')).ok) break; } catch {} await wait(100); }
  const target = (await (await fetch(endpoint + '/json/list')).json()).find(t => t.type === 'page');
  const game = await connect(target);
  await game.send('Page.navigate', { url: gameUrl });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    await wait(1000);
    const r = await game.evaluate(`({ready:!!window.__render&&document.getElementById('loading-overlay')?.classList.contains('hidden'),text:document.getElementById('loading-status')?.textContent})`);
    if (i % 15 === 0) console.log('CHARGEMENT', r.text);
    if (r.ready) { ready = true; break; }
  }
  check(`Jeu chargé en WebGPU sur ${buildVersion}`, ready && await game.evaluate(`__game.buildVersion===${JSON.stringify(buildVersion)}&&__render.renderer.backend.constructor.name==='WebGPUBackend'`));
  await game.click('#play-button');
  await game.evaluate(`__game.atmosphere.setHour(13);__game.atmosphere.setWeather('clear',true)`);
  if (published) {
    check('Domaine public : Architecte absent du jeu et de l’interface', await game.evaluate(`!__game.architect&&!document.getElementById('architect-toggle')&&!document.getElementById('architect-watch')`));
    const position = await game.evaluate(`({x:__game.person.position.x,z:__game.person.position.z})`);
    await game.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'z', windowsVirtualKeyCode: 90 }); await wait(1000);
    await game.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'z', windowsVirtualKeyCode: 90 });
    const walked = await game.evaluate(`Math.hypot(__game.person.position.x-${position.x},__game.person.position.z-${position.z})`);
    check('Build publié : marche AZERTY réelle', walked > .5, { metres: walked });
    await game.tap('KeyL', 'l');
    check('Build publié : L ne charge aucun outil local', !report.architectRequests?.length, report.architectRequests || []);
    const death = await game.evaluate(`(()=>{__game.money=10000;__game.lastHitBy=null;__game.die('shot');const spared=__game.spared;__game.respawn();return {spared,money:__game.money,state:__game.state,health:__game.health}})()`);
    check('Build publié : mort normale et soins facturés', death.spared === false && death.money === 9200 && death.state === 'onFoot' && death.health === 100, death);
    await game.shot('build-public-jour');
    if (lightingCheck) {
      await game.evaluate(`__game.teleportPlayer(-561,-35);__game.invulnerable=1e9;__game.atmosphere.setHour(23);__game.atmosphere.setWeather('rain',true);__game.atmosphere.running=false`);
      await wait(6000);
      const night = await game.evaluate(`({hour:__game.atmosphere.hour,night:__game.lighting?.activePresetId,pietons:__game.traffic.peds.filter(p=>p.placed&&!p.dead).length,version:__game.buildVersion,profil:window.__profile?.summary})`);
      check('Build publié : foule présente dans la scène de nuit', night.pietons > 10 && night.hour === 23, night);
      await game.shot('build-public-foule-nuit');
      await game.evaluate(`__game.atmosphere.setHour(13);__game.atmosphere.setWeather('clear',true)`); await wait(2500);
      await game.shot('build-public-foule-jour');
    }
    check('Build publié : aucune erreur JavaScript ou ressource manquante', report.errors.length === 0, report.errors);
    report.ok = true;
  } else if (autonomyCheck) {
    await testAutonomy(game);
    report.ok = true;
  } else {
  const start = await (await fetch(roomUrl + '/salle/commande', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'allumer', on: true }) })).json();
  check('Allumage depuis la salle', start.ok);
  await wait(1800);
  check('Présence et connexion', await game.evaluate(`__game.architect.present&&__game.architect.alive&&__game.architect.link.connected`));
  check('Voix coupée par défaut', await game.evaluate(`__game.architect.link.voice===false`));
  await game.evaluate(`window.__cancelVoiceCount=0;window.__cancelVoiceOriginal=speechSynthesis.cancel.bind(speechSynthesis);speechSynthesis.cancel=()=>{window.__cancelVoiceCount++;window.__cancelVoiceOriginal()}`);
  await command({ action: 'voix', voix: true });
  check('Voix activable depuis le serveur', await waitFor(() => game.evaluate(`__game.architect.link.voice===true`)));
  await command({ action: 'voix', voix: false });
  check('Coupure vocale immédiate transmise au vrai jeu', await waitFor(() => game.evaluate(`__game.architect.link.voice===false&&window.__cancelVoiceCount>0`)));
  await game.evaluate(`speechSynthesis.cancel=window.__cancelVoiceOriginal`);
  await game.tap('KeyL', 'l'); await wait(1500);
  check('Caméra donnée par une vraie touche', await game.evaluate(`__game.architect.spectating`));
  await game.shot('architecte-jour');
  await wait(11000);
  const perf = await game.evaluate(`__game.architect.measurePerformance(2)`);
  check('Mesure après remplissage du buffer', perf.ok, perf.texte);
  check('Compteurs issus de vraies images rendues', perf.mesures?.appels_dessin_moyens > 0 && perf.mesures?.triangles_moyens > 0 && perf.mesures?.images_rendues >= 5, perf.mesures);
  const photo = await game.evaluate(`__game.architect.link.execute('photographier',{direction:'devant',cadrage:'haut',zoom:'serre',raison:'Examen de cadrage'})`);
  check('Photo indépendante à 25 degrés', photo.ok && !!photo.image, photo.texte);
  if (photo.image) { const file = path.join(temp, 'oeil.jpg'); fs.writeFileSync(file, Buffer.from(photo.image.replace(/^data:image\/\w+;base64,/, ''), 'base64')); report.eyePhoto = file; }
  check('Identification sur la photo', (await game.evaluate(`__game.architect.eye.identify(0.5,0.5)`)).ok);
  const fov = await game.evaluate(`(()=>{const c=__game.camera.camera,old=c.fov;__render.view(c.position.x,c.position.y,c.position.z,0,20,0,25);__game.qaFrozen=true;__game.renderForQA();const photo=c.fov;__render.view();__game.qaFrozen=false;return {old,photo,restored:c.fov}})()`);
  check('FOV appliqué puis restauré', fov.photo === 25 && fov.restored === fov.old, fov);
  await game.evaluate(`window.__examFleet=__game.fleet.filter(c=>c!==__game.architect.car&&c!==__game.architect.heli);window.__examLab=__game.architect.lab.run({type:'explosion'});true`);
  await wait(300); await game.tap('KeyL', 'l');
  const cancel = await game.evaluate(`window.__examLab`);
  check('Reprise caméra annule une expérience', !cancel.ok && cancel.validite === 'incomplete', cancel.texte);
  const cleaned = await game.evaluate(`(()=>{const a=__game.architect,f=__game.fleet.filter(c=>c!==a.car&&c!==a.heli);return {fleet:f.length,before:window.__examFleet.length,same:f.length===window.__examFleet.length&&window.__examFleet.every(c=>f.includes(c)),hooks:a.lab.hooks.size,running:a.lab.running}})()`);
  check('Nettoyage des objets temporaires', cleaned.same && cleaned.hooks === 0 && !cleaned.running, cleaned);
  await game.tap('KeyL', 'l'); await wait(800);
  const before = await game.evaluate(`({hour:__game.atmosphere.hour,weather:__game.atmosphere.weather})`);
  const night = await game.evaluate(`__game.architect.lab.run({type:'nuit'})`);
  check('Expérience jour/nuit terminée avec protocole', night.ok && night.validite === 'valide' && night.protocole?.version_jeu === buildVersion, { texte: night.texte, validite: night.validite, protocole: night.protocole });
  const after = await game.evaluate(`({hour:__game.atmosphere.hour,weather:__game.atmosphere.weather})`);
  check('Heure et météo restaurées', Math.abs(before.hour - after.hour) < 0.15 && before.weather === after.weather, { before, after });
  if (deep) await deepGame(game);
  const roomTarget = await (await fetch(endpoint + '/json/new?' + encodeURIComponent(roomUrl), { method: 'PUT' })).json();
  const room = await connect(roomTarget); await wait(1200);
  for (const view of ['direct', 'tickets', 'atelier', 'profil', 'memoire']) {
    await room.click(`[data-view="${view}"]`); await wait(150);
    check(`Salle : ${view}`, await room.evaluate(`!document.getElementById('v-${view}').hidden`));
  }
  await room.shot('salle-bureau');
  await room.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  for (const view of ['direct', 'tickets', 'atelier', 'profil', 'memoire']) {
    await room.click(`[data-view="${view}"]`); await wait(150);
    check(`Salle mobile : ${view}`, await room.evaluate(`document.documentElement.scrollWidth<=innerWidth`));
  }
  await room.shot('salle-mobile');
  if (deep) await deepRoom(game, room);
  const off = await (await fetch(roomUrl + '/salle/commande', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'allumer', on: false }) })).json();
  check('Extinction depuis la salle', off.ok);
  check('Aucune erreur navigateur ou ressource manquante', report.errors.length === 0, report.errors);
  report.ok = true;
  }
} catch (error) { report.ok = false; report.error = error.stack; console.error(error.stack); process.exitCode = 1; }
finally {
  for (const ws of sockets) ws.close();
  chrome.kill('SIGTERM');
  staticServer.close();
  const closed = new Promise(resolve => server.once('close', resolve));
  server.kill('SIGTERM');
  await Promise.race([closed, wait(10000)]);
  if (server.exitCode === null) server.kill('SIGKILL');
  fs.closeSync(serverLog);
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log('RAPPORT', output);
}
