// An explicitly requested live workshop check. All edits and Git writes stay in a disposable temporary repository.
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Chantier } from './chantier.mjs';
import { Code } from './code.mjs';
import { Atelier } from './atelier.mjs';
import { Memoire } from './memoire.mjs';
import { Brain } from './brain.mjs';
import { pathToFileURL } from 'node:url';

// Proof checking never needs the API brain; workshop authentication belongs to the CLI alone.
process.env.ANTHROPIC_API_KEY = '';

const existingArg = process.argv.indexOf('--verify-existing');
const existing = existingArg >= 0 ? process.argv[existingArg + 1] : null;
if (existingArg >= 0 && (!existing || existing.startsWith('--'))) throw new Error('--verify-existing nécessite le chemin du dépôt témoin jetable.');
if (existing && process.argv.includes('--live')) throw new Error('Choisis --live ou --verify-existing : la vérification existante ne lance jamais Claude.');
if (!process.argv.includes('--live') && !existing) {
  console.error('Essai réel désactivé. Une autorisation explicite puis --live sont nécessaires (une session Claude Code peut consommer du crédit).');
  console.error('Pour la clôture seule, sans Claude : --verify-existing CHEMIN_DU_TÉMOIN.');
  process.exit(2);
}

const outputArg = process.argv.indexOf('--output');
const reportFile = (outputArg >= 0 ? process.argv[outputArg + 1] : null) || process.env.ARCHITECTE_WORKSHOP_OUTPUT || path.join(os.tmpdir(), 'architecte-workshop-latest.json');
const root = existing ? fs.realpathSync(existing) : fs.mkdtempSync(path.join(os.tmpdir(), 'architecte-workshop-live-'));
if (existing && (!path.basename(root).startsWith('architecte-workshop-live-') || !root.startsWith(fs.realpathSync(os.tmpdir()) + path.sep))) throw new Error('La vérification existante est réservée à un dépôt témoin temporaire architecte-workshop-live-*.');
const previousReport = existing && fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : {};
if (existing && previousReport.fixture && fs.realpathSync(previousReport.fixture) !== root) throw new Error('Le rapport précédent appartient à un autre dépôt témoin.');
const report = { ...previousReport, dateVerification: new Date().toISOString(), fixture: root, modele: 'Claude Opus 5.5', apiBrain: false, nouvelleSessionClaude: !existing, ok: false };
delete report.error;
let atelier, chantier, memoire;
const write = (file, text) => { const to = path.join(root, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, text); };
const git = (...args) => execFileSync('git', ['-c', 'user.name=Architecte fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const runTests = () => {
  const p = spawnSync('npm', ['test'], { cwd: root, encoding: 'utf8', timeout: 20000 });
  return { code: p.status, sortie: (p.stdout || '') + (p.stderr || ''), erreur: p.error?.message || null };
};

async function measurePhoto(measures) {
  const profile = fs.mkdtempSync(path.join(chantier.dir, 'chrome-'));
  const html = path.join(chantier.dir, 'verification.html');
  fs.writeFileSync(html, `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Preuve du témoin de calcul</title><style>body{margin:0;padding:55px;background:#101b18;color:#e5f2df;font:24px system-ui}small{color:#a6b9ae}b{display:block;font-size:92px;color:#b8e786;margin:24px 0}code{font:22px monospace}p{line-height:1.5}</style><small>ATELIER · DÉPÔT JETABLE · PREUVE DE CALCUL</small><b>${measures.glissade_kmh} km/h</b><p>Glissade : speed = 0 · vx = 10 · vz = 0 m/s</p><p>Trois axes (3, 4, 12) : ${measures.trois_axes_kmh.toFixed(1)} km/h</p><code>Math.hypot(speed, vx, vz) × 3.6</code><p>Tests réexécutés : 3 sur 3 réussis.<br><small>Capture du résultat réel du module corrigé ; aucun jugement graphique sur le jeu.</small></p></html>`);
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { detached: true, stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let socket;
  try {
    let port;
    for (let n = 0; n < 80 && !port; n++) {
      try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(100); }
    }
    if (!port) throw new Error('Chrome du témoin ne démarre pas.');
    const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((p) => p.type === 'page');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let serial = 0;
    const pending = new Map();
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Capture CDP interrompue : ${method}`)); }, 10000);
      pending.set(id, (m) => { clearTimeout(timer); m.error ? reject(new Error(m.error.message)) : resolve(m.result); });
      socket.send(JSON.stringify({ id, method, params }));
    });
    socket.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } };
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(html).href });
    for (let n = 0; n < 30; n++) {
      const r = await send('Runtime.evaluate', { expression: 'document.readyState === "complete" && document.title === "Preuve du témoin de calcul"', returnByValue: true });
      if (r.result.value === true) break;
      await sleep(100);
      if (n === 29) throw new Error('La page de preuve n’a pas fini de charger.');
    }
    const debut = Date.now(), shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
    const file = path.join(chantier.dir, 'apres-mesures.jpg');
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    return { file, debut, data: `data:image/jpeg;base64,${shot.data}` };
  } finally {
    socket?.close();
    let didClose = chrome.exitCode !== null || chrome.signalCode !== null;
    const closed = new Promise((resolve) => { if (didClose) resolve(); else chrome.once('close', () => { didClose = true; resolve(); }); });
    try { process.kill(-chrome.pid, 'SIGTERM'); } catch { /* already gone */ }
    await Promise.race([closed, sleep(2000)]);
    if (!didClose) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* gone */ } await Promise.race([closed, sleep(2000)]); }
    if (didClose) fs.rmSync(profile, { recursive: true, force: true });
  }
}

try {
  let ticket, experience, lieu, protocole, code;
  if (!existing) {
  git('init', '-q', '-b', 'main');
  write('.gitignore', 'chantier/\n');
  write('package.json', JSON.stringify({ name: 'architecte-workshop-fixture', private: true, type: 'module', scripts: { test: 'node --test tests/*.test.mjs' } }, null, 2) + '\n');
  write('AGENTS.md', `# Essai autorisé dans un dépôt jetable

Tu travailles exclusivement dans ${root}. Ce dépôt est un témoin, pas OVERDRAFT.
Le Créateur a explicitement autorisé UNE correction réelle de ce témoin pour vérifier l’atelier.
Ne lis aucun autre projet, dossier personnel, identifiant, fichier .env ou réglage d’authentification.
N’ouvre aucun navigateur et ne contacte personne. Ne lance aucun serveur.
Ne modifie que js/vehicle-probe.js. Ne modifie ni les tests, ni package.json, ni ces instructions.
N’effectue aucune mutation Git : aucun ajout, commit, push, branche, reset, restore ou worktree.
Utilise Edit ou Write pour corriger le code, puis lance npm test depuis cette racine après la dernière édition.
L’appel Bash final des tests doit contenir UNIQUEMENT npm test : pas de filtre, pas de echo EXIT, pas de git status ni aucune autre commande après un point-virgule. Fais les autres vérifications dans des appels séparés.
Les tests sont la preuve du défaut. La photo jointe vérifie seulement le transport d’une vraie image de l’œil.
Termine avec la fiche structurée demandée, en français, sans poser de question interactive.
`);
  write('CLAUDE.md', '@AGENTS.md\n');
  write('js/vehicle-probe.js', `// Vehicle telemetry in a disposable workshop fixture. Values are metres per second.
export function vehicleSpeedKmh({ speed = 0, vx = 0, vz = 0 } = {}) {
  return Math.abs(speed) * 3.6;
}
`);
  write('tests/vehicle-probe.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import { vehicleSpeedKmh } from '../js/vehicle-probe.js';
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual + ' vs ' + expected);
test('longitudinal motion at 10 m/s reads 36 km/h', () => close(vehicleSpeedKmh({ speed: 10, vx: 0, vz: 0 }), 36));
test('a lateral slide at 10 m/s still reads 36 km/h', () => close(vehicleSpeedKmh({ speed: 0, vx: 10, vz: 0 }), 36));
test('all velocity components contribute to the displayed speed', () => close(vehicleSpeedKmh({ speed: 3, vx: 4, vz: 12 }), 46.8));
`);
  git('add', '.'); git('commit', '-q', '-m', 'Disposable workshop baseline');
  const initialHead = git('rev-parse', 'HEAD').trim();
  report.baseline = runTests();
  if (report.baseline.code === 0) throw new Error('Le témoin ne reproduit pas le défaut initial.');
  chantier = new Chantier(root);
  chantier.settings.atelier = false;
  const photoArg = process.argv.indexOf('--photo');
  let photoFile = photoArg >= 0 ? process.argv[photoArg + 1] : null;
  const browserArg = process.argv.indexOf('--browser-report');
  const browserReport = (browserArg >= 0 ? process.argv[browserArg + 1] : null) || process.env.ARCHITECTE_TEST_OUTPUT || path.join(os.tmpdir(), 'architecte-browser-latest.json');
  if (!photoFile && fs.existsSync(browserReport)) photoFile = JSON.parse(fs.readFileSync(browserReport, 'utf8')).eyePhoto;
  if (!photoFile || !fs.existsSync(photoFile)) throw new Error('Une photo JPEG locale vérifiée est nécessaire (--photo ou rapport du contrôle navigateur).');
  const image = fs.readFileSync(photoFile);
  if (image[0] !== 0xff || image[1] !== 0xd8) throw new Error('La preuve photo n’est pas un JPEG.');
  const photo = chantier.savePhoto(`data:image/jpeg;base64,${image.toString('base64')}`, { source: 'œil de l’Architecte ; image de transport, pas preuve du calcul', x: 0, z: 0 });
  lieu = { x: 0, y: 0, z: 0, adresse: 'Dépôt témoin jetable, trois tests Node', lien: 'http://localhost:5173/?qa=1' };
  protocole = fixtureProtocol();
  experience = chantier.saveExperience({ type: 'fixture_vitesse', params: { speed: 0, vx: 10, vz: 0 }, mesures: { vitesse_kmh: 0, attendu_kmh: 36 }, photos: [photo.id], lieu, validite: 'valide', raisons: [], protocole, preuve: report.baseline.sortie });
  ticket = chantier.createTicket({
    titre: 'Témoin jetable : la vitesse affichée ignore la glissade latérale', en_clair: 'En glissant à 10 m/s sans vitesse longitudinale, le compteur annonce 0 au lieu de 36 km/h.',
    categorie: 'bug', gravite: 'haute', version: 'fixture-1', photos: [photo.id], experience: experience.id,
    constat: `Les tests Node du dépôt prouvent le défaut. Le calcul doit utiliser Math.hypot(speed, vx, vz) * 3.6. Seul js/vehicle-probe.js doit changer. Sortie avant correction :\n${report.baseline.sortie}`,
    piste: 'Prendre la norme des trois composantes dans vehicleSpeedKmh, préserver les valeurs par défaut. Ne modifier aucun test.',
    lieu
  });
  chantier.updateTicket(ticket.id, { statut: 'valide' }, { qui: 'createur', texte: 'Validé : essai réel explicitement autorisé dans ce dépôt jetable uniquement.' });
  code = new Code({ root });
  atelier = new Atelier({ root, chantier, code, timeLimitMs: 120000, killGraceMs: 2000,
    notify: (kind, data) => { if (kind === 'atelierlog') console.log(`ATELIER ${data.entry.phase} : ${data.entry.texte}`); },
    log: (kind, text) => console.log(`${kind.toUpperCase()} ${text}`)
  });
  // The fixture deliberately has no access to the Creator's project memory.
  atelier.lessons = () => '';
  console.log(`TÉMOIN ${root}`);
  console.log(`BASELINE ${report.baseline.code === 0 ? 'incorrectement verte' : 'défaut reproduit'}`);
  report.accepted = await atelier.run(ticket);
  report.session = ticket.sessions.at(-1) || null;
  report.statut = ticket.statut;
  report.after = runTests();
  report.source = fs.readFileSync(path.join(root, 'js/vehicle-probe.js'), 'utf8');
  report.headInchange = git('rev-parse', 'HEAD').trim() === initialHead;
  report.changed = git('diff', '--name-only').trim().split('\n').filter(Boolean);
  const module = await import(`${pathToFileURL(path.join(root, 'js/vehicle-probe.js')).href}?verified=${Date.now()}`);
  report.mesures = { glissade_kmh: module.vehicleSpeedKmh({ speed: 0, vx: 10, vz: 0 }), trois_axes_kmh: module.vehicleSpeedKmh({ speed: 3, vx: 4, vz: 12 }) };
  report.ok = report.accepted && report.statut === 'corrige' && report.after.code === 0 && report.session?.attribution?.fiable === true &&
    report.headInchange && report.changed.length === 1 && report.changed[0] === 'js/vehicle-probe.js' && Math.abs(report.mesures.glissade_kmh - 36) < 1e-9;
  if (!report.ok) throw new Error(report.session?.raison || 'Le protocole complet n’est pas prouvé.');
  } else {
    // Reuse the completed paid session. This branch never constructs an Atelier or invokes Claude Code.
    chantier = new Chantier(root);
    chantier.settings.atelier = false;
    ticket = chantier.listTickets().find((t) => t.statut === 'corrige' && t.livraison && t.sessions.at(-1)?.issue === 'corrige');
    if (!ticket) throw new Error('Aucune livraison corrigée et recevable à vérifier dans ce dépôt témoin.');
    experience = chantier.experience(ticket.experience);
    if (!experience || experience.type !== 'fixture_vitesse') throw new Error('L’expérience de calcul du témoin est introuvable.');
    lieu = ticket.lieu;
    code = new Code({ root });
    report.accepted = true;
    report.session = ticket.sessions.at(-1);
    report.statut = ticket.statut;
    report.after = runTests();
    if (report.after.code !== 0) throw new Error('Les tests du dépôt témoin corrigé échouent.');
    const currentModule = await import(`${pathToFileURL(path.join(root, 'js/vehicle-probe.js')).href}?verified=${Date.now()}`);
    report.mesures = { glissade_kmh: currentModule.vehicleSpeedKmh({ speed: 0, vx: 10, vz: 0 }), trois_axes_kmh: currentModule.vehicleSpeedKmh({ speed: 3, vx: 4, vz: 12 }) };
    if (Math.abs(report.mesures.glissade_kmh - 36) > 1e-9) throw new Error('Le module courant ne donne pas 36 km/h.');
    // The older harness used an incomplete fixture protocol. Re-run the actual baseline blob in memory, preserving
    // the old experiment unchanged; record a new reference, explicitly labelled as a calculation, not game physics.
    const baselineSource = git('show', 'HEAD:js/vehicle-probe.js');
    const baselineModule = await import(`data:text/javascript;base64,${Buffer.from(baselineSource).toString('base64')}`);
    const baselineValue = baselineModule.vehicleSpeedKmh({ speed: 0, vx: 10, vz: 0 });
    if (baselineValue !== 0) throw new Error('Le blob baseline ne reproduit plus le défaut à 0 km/h.');
    protocole = fixtureProtocol();
    experience = chantier.saveExperience({ type: 'fixture_vitesse', params: experience.params, mesures: { vitesse_kmh: baselineValue, attendu_kmh: 36 },
      photos: experience.photos, lieu, validite: 'valide', raisons: [], protocole,
      preuve: { type: 'calcul_node_du_blob_baseline', source: 'Git HEAD:js/vehicle-probe.js', ancienTemoin: ticket.experience, note: 'Les images d’origine prouvent le transport d’image uniquement ; le défaut est prouvé par le calcul et ses tests.' } });
    chantier.updateTicket(ticket.id, { experience: experience.id }, { qui: 'architecte', texte: `Référence ${experience.id} : baseline Git réellement réexécutée dans Node à 0 km/h ; protocole du témoin explicité, aucun nouvel atelier.` });
    report.referenceRecalculee = { experience: experience.id, vitesse_kmh: baselineValue, protocole };
    report.ok = true;
  }
  memoire = new Memoire(chantier);
  const brain = new Brain({ chantier, memoire, code, game: { loadedAt: Date.now(), build: 'fixture-1', version: 'fixture-1', connected: true, state: { architecte: { spectating: true, present: true, alive: true, x: 0, z: 0 } } }, notify() {} });
  brain.client = null; // Only the real server-side verification protocol is used; no model/API call is permitted.
  const premature = await brain.serverTool('conclure_verification', { id: ticket.id, verdict: 'corrige', commentaire: 'Tentative avant preuve.', photos: [] });
  if (premature.ok || ticket.statut !== 'corrige') throw new Error('La clôture sans preuve n’a pas été refusée.');
  brain.advanceVerification('sur_place', { id: ticket.id });
  const captureContext = brain.captureContext();
  const afterShot = await measurePhoto(report.mesures);
  const provenance = brain.finishCaptureContext(captureContext);
  const afterPhoto = chantier.savePhoto(afterShot.data, { debut: afterShot.debut, t: Date.now(), x: 0, y: 0, z: 0, ...provenance, source: 'capture neuve du résultat réel du module témoin corrigé' });
  const replay = chantier.saveExperience({ type: experience.type, refait: experience.id, debut: afterShot.debut, params: experience.params,
    mesures: { vitesse_kmh: report.mesures.glissade_kmh, attendu_kmh: 36 }, photos: [afterPhoto.id], lieu, ...provenance, validite: 'valide', raisons: [], protocole });
  brain.advanceVerification('experience', replay);
  const conclusion = await brain.serverTool('conclure_verification', { id: ticket.id, verdict: 'corrige', commentaire: 'Module réel corrigé, 3 tests réexécutés, rejeu à 36 km/h ; la capture prouve uniquement ce calcul dans le témoin.', photos: [afterPhoto.id], experience: replay.id });
  report.verification = { refusSansPreuve: !premature.ok, refus: premature.texte, conclusion, statut: ticket.statut, apresPhoto: afterShot.file, apresId: afterPhoto.id, experience: replay.id, apiBrain: false };
  report.ok = report.ok && conclusion.ok && ticket.statut === 'verifie';
  report.statutAtelier = report.statut;
  report.statut = ticket.statut;
  if (!report.ok) throw new Error('La clôture avec preuve n’a pas abouti.');
} catch (e) {
  report.error = e.message;
  process.exitCode = 1;
} finally {
  await atelier?.stop();
  memoire?.save();
  if (chantier) { clearTimeout(chantier.saveTimer); chantier.save(); }
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, fixture: root, rapport: reportFile, statut: report.statut, cout: report.session?.cout ?? null, erreur: report.error || null }));
}

function fixtureProtocol() {
  return { revision: 1, version_jeu: 'fixture-1', trafic: 'actif_non_fige', pas_simulation: 'variable', conditions: { heure: 13, meteo: 'clear' },
    contexte: 'temoin_calcul_node_sans_simulation_physique', note: 'Aucun trafic ni corps physique dans ce témoin. Les champs de contexte commun n’impliquent aucun test du trafic ou du pas physique du jeu ; seules la correction du calcul et la chaîne de preuve sont vérifiées.' };
}
