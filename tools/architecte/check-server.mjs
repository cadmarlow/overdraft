// Real HTTP/SSE integration checks on an isolated port and disposable workshop. No model or dev-agent requests.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const PORT = 7785;
const base = `http://127.0.0.1:${PORT}`;
const reportFile = path.resolve(process.env.ARCHITECTE_SERVER_REPORT || '/tmp/architecte-server-check-latest.json');
const allowedReports = [os.tmpdir(), '/tmp', '/private/tmp'].map((dir) => path.resolve(dir) + path.sep);
if (!allowedReports.some((dir) => reportFile.startsWith(dir))) throw new Error('Le rapport de cet essai doit rester dans un dossier temporaire.');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'architecte-server-check-'));
const report = { date: new Date().toISOString(), port: PORT, api: false, atelier: false, checks: [], ok: false };
const clients = [];
let server, exitPromise, startupError = null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(nom, condition, details = undefined) {
  report.checks.push({ nom, ok: !!condition, ...(details === undefined ? {} : { details }) });
  assert.ok(condition, nom);
}

async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(`Délai dépassé : ${label}.`)), ms); })]);
  } finally { clearTimeout(timer); }
}

async function json(route, body) {
  const response = await fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000)
  });
  assert.equal(response.status, 200, `${route} doit répondre 200`);
  return response.json();
}

async function assertPortFree() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(PORT, '127.0.0.1', resolve); });
  await new Promise((resolve) => probe.close(resolve));
}

class FakeGame {
  constructor() {
    this.messages = [];
    this.waiters = [];
    this.closed = false;
    this.ready = new Promise((resolve, reject) => {
      this.request = http.get(base + '/jeu/flux', { agent: false }, (response) => {
        this.response = response;
        if (response.statusCode !== 200) { reject(new Error(`Flux SSE : HTTP ${response.statusCode}.`)); return; }
        response.setEncoding('utf8');
        let buffer = '';
        response.on('data', (chunk) => {
          buffer += chunk.replace(/\r\n/g, '\n');
          for (let end; (end = buffer.indexOf('\n\n')) >= 0;) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
            if (!data) continue;
            const message = JSON.parse(data);
            const index = this.waiters.findIndex((waiter) => waiter.matches(message));
            if (index >= 0) {
              const [waiter] = this.waiters.splice(index, 1);
              clearTimeout(waiter.timer); waiter.resolve(message);
            } else this.messages.push(message);
          }
        });
        response.once('end', () => { this.closed = true; });
        resolve();
      });
      this.request.once('error', (error) => { if (!this.closed) reject(error); });
    });
  }

  next(matches, label) {
    const index = this.messages.findIndex(matches);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { matches, resolve, reject };
      waiter.timer = setTimeout(() => { this.waiters = this.waiters.filter((item) => item !== waiter); reject(new Error(`Commande SSE absente : ${label}.`)); }, 1800);
      this.waiters.push(waiter);
    });
  }

  close() {
    this.closed = true;
    this.response?.destroy(); this.request?.destroy();
    for (const waiter of this.waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(new Error('Le faux jeu a fermé son flux.')); }
  }
}

try {
  // Refuse to start rather than touch a server that might already own the dedicated test port.
  await assertPortFree();
  await import('@anthropic-ai/sdk'); // Do not let the server install dependencies during this check.
  fs.mkdirSync(path.join(fixture, 'chantier'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'chantier', 'etat.json'), JSON.stringify({ settings: { allume: false, atelier: false, vue: false, voix: false } }));
  const missingEnv = path.join(fixture, 'absent.env');
  server = spawn(process.execPath, [path.join(import.meta.dirname, 'server.mjs')], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: { ...process.env, ANTHROPIC_API_KEY: '', ARCHITECTE_ENV: missingEnv, ARCHITECTE_CHANTIER_ROOT: fixture, ARCHITECTE_PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  // The startup banner contains a disposable LAN token: it is deliberately neither read nor reported.
  server.stderr.on('data', () => {});
  server.once('error', (error) => { startupError = error; });
  exitPromise = new Promise((resolve) => server.once('close', (code, signal) => resolve({ code, signal })));
  let initial;
  for (let n = 0; n < 100; n++) {
    if (startupError) throw startupError;
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('Le serveur isolé s’est arrêté avant son démarrage.');
    try { initial = await json('/salle/etat'); break; } catch { await sleep(50); }
  }
  check('Serveur isolé sans clé, sans atelier et initialement éteint', initial && !initial.cerveau.cle && !initial.settings.allume && !initial.atelier.auto);
  check('Aucun fichier de clé n’a été créé ou lu par cet essai', !fs.existsSync(missingEnv));
  const emptySession = await json('/salle/commande', { action: 'seance' });
  check('Clore une séance vide signale le refus au lieu d’annoncer un faux rapport', emptySession.ok === false && /pas encore/.test(emptySession.texte));

  const first = new FakeGame(); clients.push(first); await bounded(first.ready, 2000, 'premier flux');
  await json('/jeu/bonjour', { build: '0.9.4', charge: Date.now(), lieux: [] });
  await json('/jeu/etat', { architecte: { present: true, alive: true, spectating: false, x: 0, y: 0.22, z: 0 }, joueur: { x: 0, z: 0 }, onglet: { visible: true } });
  let actualPresence = true;
  async function power(on, label) {
    const pending = json('/salle/commande', { action: 'allumer', on });
    const command = await first.next((message) => message.type === 'cmd' && message.name === 'presence' && message.input.on === on, label);
    actualPresence = command.input.on;
    await json('/jeu/resultat', { id: command.id, ok: true, texte: 'Présence appliquée par le faux jeu.' });
    assert.equal((await pending).ok, true);
    return command;
  }
  await power(true, 'premier allumage');
  const cached = await json('/salle/etat');
  assert.equal(cached.settings.allume, true); assert.equal(cached.etat.architecte.present, true);
  await power(true, 'allumage malgré le cache déjà vrai');
  check('Allumer renvoie présence même si le serveur et son état en cache sont déjà allumés', actualPresence === true);
  actualPresence = false; // A local J press that has not reached POST /jeu/etat yet.
  await power(true, 'rappel après extinction locale non transmise');
  check('Un J local non transmis est corrigé par un nouvel ordre Allumer', actualPresence === true);
  await power(false, 'extinction explicite');
  await power(false, 'extinction répétée malgré le cache encore présent');
  check('Éteindre répété applique aussi la présence, sans attendre un état actualisé', actualPresence === false);

  const requestGame = () => json('/salle/commande', { action: 'jeu', commande: 's_arreter', input: { raison: 'Essai HTTP isolé.' } });
  const oldPending = requestGame();
  const oldCommand = await first.next((message) => message.type === 'cmd' && message.name === 's_arreter', 'ordre avant remplacement');
  const replacementStarted = performance.now();
  const second = new FakeGame(); clients.push(second); await bounded(second.ready, 2000, 'flux de remplacement');
  const replaced = await bounded(oldPending, 1000, 'résolution de l’ancien ordre');
  const replaceMs = Math.round(performance.now() - replacementStarted);
  check('Le remplacement SSE fait échouer immédiatement l’ordre de l’ancienne connexion', replaced.ok === false && /remplac/i.test(replaced.texte) && replaceMs < 1000, { delaiMs: replaceMs });
  check('La fermeture de l’ancien flux ne déconnecte pas son remplaçant', (await json('/salle/etat')).jeu.connected);

  let nextSettled = false;
  const nextPending = requestGame().then((result) => { nextSettled = true; return result; });
  const nextCommand = await second.next((message) => message.type === 'cmd' && message.name === 's_arreter', 'ordre après remplacement');
  check('Les identifiants de commande ne sont pas réutilisés après reconnexion', nextCommand.id > oldCommand.id);
  await json('/jeu/resultat', { id: oldCommand.id, ok: true, texte: 'Ancienne réponse arrivée en retard.' });
  await sleep(100);
  check('Une réponse tardive de l’ancienne page ne résout pas le nouvel ordre', !nextSettled);
  await json('/jeu/resultat', { id: nextCommand.id, ok: true, texte: 'Réponse de la nouvelle connexion.' });
  const nextResult = await bounded(nextPending, 1000, 'réponse du nouvel ordre');
  check('Seule la réponse portant le nouvel identifiant acquitte le nouvel ordre', nextResult.ok && nextResult.texte === 'Réponse de la nouvelle connexion.');

  const disconnectedPending = requestGame();
  await second.next((message) => message.type === 'cmd' && message.name === 's_arreter', 'ordre avant déconnexion');
  const disconnectStarted = performance.now(); second.close();
  const disconnected = await bounded(disconnectedPending, 1000, 'résolution après déconnexion');
  const disconnectMs = Math.round(performance.now() - disconnectStarted);
  check('Une déconnexion fait échouer immédiatement les ordres en attente', disconnected.ok === false && /déconnect/i.test(disconnected.texte) && disconnectMs < 1000, { delaiMs: disconnectMs });
  const final = await json('/salle/etat');
  check('État final : jeu déconnecté, aucune clé et aucun atelier automatique', !final.jeu.connected && !final.cerveau.cle && !final.atelier.auto);
  report.ok = true;
} catch (error) {
  report.error = error.stack || error.message;
  process.exitCode = 1;
} finally {
  for (const client of clients) client.close();
  let stopped = !server;
  if (server) {
    stopped = server.exitCode !== null || server.signalCode !== null;
    if (!stopped) {
      server.kill('SIGTERM');
      await Promise.race([exitPromise.then(() => { stopped = true; }), sleep(3000)]);
    }
    if (!stopped) {
      server.kill('SIGKILL');
      await Promise.race([exitPromise.then(() => { stopped = true; }), sleep(2000)]);
    }
  }
  fs.rmSync(fixture, { recursive: true, force: true });
  report.nettoyage = { serveurArrete: stopped, chantierSupprime: !fs.existsSync(fixture) };
  if (!stopped) { report.ok = false; process.exitCode = 1; }
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`${report.ok ? 'RÉUSSI' : 'ÉCHEC'} — ${report.checks.filter((item) => item.ok).length}/${report.checks.length} contrôles HTTP/SSE. Rapport : ${reportFile}`);
}
