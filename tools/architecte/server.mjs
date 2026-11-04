// The Architect's server (`npm run architecte`): his brain (Claude, with the Creator's API key from .env.local), his
// memory, his tickets and journal (chantier/), the watch on the game's code (Git), the workshop that fixes validated
// tickets, and the control room, at http://localhost:7780. The game (js/architect-link.js) connects to it: commands
// flow to the game over Server-Sent Events, everything the game sees and does comes back as JSON posts. A local tool:
// it listens on this machine and its network only, and anything that does not come from this machine needs the token
// printed at start.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
// away from the 5173+ ports Vite dev servers take (another project held 5180)
const PORT = Number(process.env.ARCHITECTE_PORT || 7780);
const BODY_LIMIT = 16 * 1024 * 1024;

// the key: .env.local at the root (another file for a run from a worktree: ARCHITECTE_ENV)
const envFile = process.env.ARCHITECTE_ENV || path.join(root, '.env.local');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.ANTHROPIC_API_KEY?.trim()) delete process.env.ANTHROPIC_API_KEY;

// The one dependency (the Anthropic SDK), installed on first run
try { await import('@anthropic-ai/sdk'); } catch {
  console.log('Installation du SDK Anthropic (une seule fois)…');
  spawnSync('npm', ['install', '--prefix', here, '--no-audit', '--no-fund'], { stdio: 'inherit' });
}
const { Chantier, EFFORTS, ROLES, STATUS } = await import('./chantier.mjs');
const { Memoire } = await import('./memoire.mjs');
const { Code } = await import('./code.mjs');
const { Brain, MODELS, PROFILE, SELF } = await import('./brain.mjs');
const { Programme } = await import('./programme.mjs');
const { Atelier } = await import('./atelier.mjs');
const { createTicketActions } = await import('./ticket-actions.mjs');

// the tickets live in chantier/ at the project's root (elsewhere for a test run: ARCHITECTE_CHANTIER_ROOT)
const chantier = new Chantier(process.env.ARCHITECTE_CHANTIER_ROOT || root);
chantier.settings.jeton ??= crypto.randomBytes(9).toString('base64url');
chantier.save();
const memoire = new Memoire(chantier);

// ---- The game, at the other end of the line ------------------------------------------------------------------------
const game = {
  connected: false, stream: null, state: null, places: [], carte: null, build: null, version: version(), loadedAt: null,
  pending: new Map(), serial: 0,
  send(message) { this.stream?.write(`data: ${JSON.stringify(message)}\n\n`); },
  // A command the game carries out; resolves with { ok, texte, image?, images?, lieu?, mesures? }
  command(name, input = {}, timeout = 15000) {
    if (!this.connected) return Promise.resolve({ ok: false, texte: 'Le jeu n’est pas connecté.' });
    const id = ++this.serial;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ ok: false, texte: 'Le jeu n’a pas répondu à temps.' }); }, timeout);
      this.pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
      this.send({ type: 'cmd', id, name, input });
    });
  }
};

function version() {
  let v = '?';
  try { v = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; } catch { /* keep ? */ }
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'js', 'css', 'index.html', 'assets'], { cwd: root }).toString().trim();
    v += ` (${sha}${dirty ? ', modifié' : ''})`;
  } catch { /* not a repository */ }
  return v;
}

// ---- The control room's live feed ----------------------------------------------------------------------------------
const rooms = new Set();
let live = { n: 0, jpeg: null };
function broadcast(type, data) {
  if (type === 'journal') print(data);
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of rooms) res.write(line);
}
function updateLive() {
  game.send({ type: 'config', live: rooms.size > 0 && chantier.settings.vue, every: 1500, voix: chantier.settings.voix });
}

const log = (kind, text, data) => { const e = chantier.log(kind, text, data); broadcast('journal', e); return e; };

// ---- The code, watched -----------------------------------------------------------------------------------------------
let codeTimer = null;
const code = new Code({
  root,
  onCommit(c) {
    const linked = new Set(c.tickets);
    // a commit that carries the files the workshop changed for a ticket is that ticket's
    for (const t of chantier.listTickets()) if (['corrige', 'verifie'].includes(t.statut) && (t.livraison?.fichiers || []).some((f) => c.fichiers.includes(f))) linked.add(t.id);
    const ids = [...linked].filter((id) => chantier.tickets.has(id));
    for (const id of ids) {
      const t = chantier.tickets.get(id);
      if (t.commits.some((k) => k.sha === c.sha)) continue;
      chantier.updateTicket(id, { commits: [...t.commits, { sha: c.sha, sujet: c.sujet, t: c.t, nomme: c.tickets.includes(id) }] }, { qui: 'code', texte: `Commit ${c.sha.slice(0, 7)} : ${c.sujet}` });
      broadcast('ticket', chantier.tickets.get(id));
    }
    const text = `Le Créateur a commité ${c.sha.slice(0, 7)} « ${c.sujet} » (${c.fichiers.length} fichier(s)${ids.length ? `, tickets ${ids.map((i) => `#${i}`).join(', ')}` : ''}).`;
    memoire.change('commit', text, { sha: c.sha, tickets: ids });
    brain.push('commit', text);
    log('code', text, { sha: c.sha, tickets: ids });
  },
  onChange() {
    clearTimeout(codeTimer);
    codeTimer = setTimeout(() => broadcast('code', codeState()), 400);
  }
});

// Each uncommitted file, with the workshop sessions that touched it (and whether it moved since)
function codeState() {
  const s = code.state();
  const sessions = chantier.listTickets().flatMap((t) => (t.sessions || []).filter((x) => x.attribution?.fiable === true).map((x) => ({ ...x, ticket: t.id, titre: t.titre })));
  for (const f of s.fichiers) {
    const by = sessions.filter((x) => (x.fichiers || []).some((y) => y.path === f.path)).sort((a, b) => b.fin - a.fin);
    f.tickets = [...new Set(by.map((x) => x.ticket))];
    f.session = by[0]?.id || null;
    f.apres = by[0] && f.depuis && f.depuis > by[0].fin + 3000; // changed again after the workshop
  }
  return { ...s, perime: game.connected ? code.staleSince(game.loadedAt) : [] };
}

// ---- The mind, its programme and the workshop --------------------------------------------------------------------------
const notify = (kind, data) => {
  if (kind === 'atelier' && data?.ticket) { atelier.enqueue(data.ticket); return; }
  if (kind === 'corrige') {
    const t = chantier.tickets.get(data.id);
    const text = data.ok
      ? `L’atelier a corrigé le ticket #${data.id} (${t?.titre}) : ${data.livraison?.resume || ''} Fichiers : ${(data.changes || []).map((c) => c.path).join(', ') || '—'}. À vérifier sur place.`
      : `L’atelier n’a pas corrigé le ticket #${data.id} (${t?.titre}) : ${{ arrete: 'arrêté', decision: 'une décision du Créateur est nécessaire', echec: 'échec' }[data.issue] || data.issue}.`;
    memoire.change('livraison', text, { id: data.id, ok: data.ok });
    brain.push('corrige', text);
  }
  if (kind === 'conversation' || kind === 'statut' || kind === 'programme') { broadcast(kind, kind === 'statut' ? brain.status() : data); return; }
  if (kind === 'memoire' || kind === 'couverture') { broadcast(kind, null); return; }
  broadcast(kind, data);
};
const brain = new Brain({ chantier, memoire, code, game, notify });
if (!chantier.settings.allume) brain.setPaused(true, 'éteint');
const programme = new Programme({ brain, game, memoire, log, notify });

// The Creator's switch: on, he comes into the game and his mind works; off, he leaves and his mind rests. Calling him
// or sending him away from the game itself (J, the pause menu) moves the switch too, so there is one truth.
async function setPower(on, { fromGame = false } = {}) {
  const s = chantier.settings;
  if (s.allume === on && !fromGame) {
    // A local J/menu change may not have reached the one-second state feed yet. Always apply the Creator's explicit
    // command to the body; a cached `present` value must not swallow a rapid switch back on (or off).
    if (game.connected) { game.lastPresent = undefined; await game.command('presence', { on }).catch(() => {}); }
    return;
  }
  s.allume = on;
  chantier.save();
  if (on) { if (brain.paused && !brain.pauseReason.startsWith('plafond')) brain.setPaused(false); } else { brain.setPaused(true, 'éteint'); brain.halt(); }
  if (!fromGame && game.connected) { game.lastPresent = undefined; await game.command('presence', { on }).catch(() => {}); }
  log('createur', on ? 'L’Architecte est allumé.' : 'L’Architecte est éteint.');
  broadcast('reglages', { ...s, jeton: undefined });
  broadcast('statut', brain.status());
}

// What the Profile shows: who he is, what guides him, his tools, his record
function profile() {
  const all = chantier.listTickets();
  let sessions = 1;
  try { sessions += fs.readdirSync(memoire.sessionsDir).filter((f) => f.endsWith('.json')).length; } catch { /* the first */ }
  return {
    ...PROFILE, version: SELF.version, depuis: chantier.settings.versionArchitecteDepuis || null,
    chiffres: { seances: sessions, tickets: all.length, clos: all.filter((t) => t.statut === 'verifie').length, photos: chantier.counters.photo || 0, depense: +Object.values(chantier.spending).reduce((a, b) => a + b, 0).toFixed(2) }
  };
}
brain.programme = programme;
const atelier = new Atelier({ root, chantier, code, notify, log });
brain.workshop = () => atelier.status();
const { decideTicket, workshopCommand } = createTicketActions({ chantier, atelier, brain, memoire, log, broadcast });

function snapshot() {
  const day = new Date().toISOString().slice(0, 10);
  return {
    settings: { ...chantier.settings, jeton: undefined },
    modeles: Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, { label: m.label, id: m.id, nom: m.nom }])), efforts: EFFORTS, roles: ROLES, statuts: STATUS,
    cerveau: brain.status(), programme: programme.summary(),
    jeu: { connected: game.connected, version: game.version, build: game.build, charge: game.loadedAt }, etat: game.state,
    journal: chantier.recent(200), tickets: chantier.listTickets(), atelier: atelier.status(), sessions: atelier.history(30), code: codeState(),
    lieux: game.places, carte: game.carte, live: live.n,
    depenses: { jour: +(chantier.spending[day] || 0).toFixed(3), detail: chantier.spendingDetail[day] || null, jours: chantier.spending },
    conversation: memoire.recentTalk(60), seance: { id: memoire.seance.id, debut: memoire.seance.debut, stats: memoire.seance.stats },
    profil: profile(), gouts: memoire.tastes
  };
}

function memorySnapshot() {
  return {
    gouts: memoire.tastes, carnet: chantier.notes(80), couverture: memoire.coverCells(),
    seance: { ...memoire.seance, observations: memoire.seance.observations.slice(-80), conclusions: memoire.seance.conclusions.slice(-30) },
    rapports: memoire.reports(12).map((r) => ({ id: r.id, texte: r.texte })), resume: memoire.talkSummary, changements: memoire.changes.slice(-60).reverse(),
    experiences: chantier.listExperiences(30)
  };
}

// ---- What the Creator decides in the control room ------------------------------------------------------------------
async function roomCommand(body) {
  const s = chantier.settings;
  switch (body.action) {
    case 'cerveau': {
      // one role's model and depth of reasoning, from the next call on
      const role = ROLES[body.role] ? body.role : 'pensee';
      const r = s.cerveaux[role];
      if (MODELS[body.modele]) r.modele = body.modele;
      if (EFFORTS[body.effort]) r.effort = body.effort;
      brain.push('systeme', `Le Créateur a réglé ${ROLES[role].toLowerCase()} sur ${MODELS[r.modele].label} (${MODELS[r.modele].nom}), raisonnement ${EFFORTS[r.effort].toLowerCase()}.`);
      break;
    }
    case 'allumer': await setPower(!!body.on); return { ok: true };
    // who holds the camera, set rather than toggled
    case 'camera': {
      const r = await game.command('camera-set', { qui: body.qui === 'lui' ? 'lui' : 'toi' }, 8000);
      if (r.ok && body.qui === 'lui' && !s.allume) await setPower(true);
      return r;
    }
    case 'gouts': {
      memoire.setTastes((Array.isArray(body.regles) ? body.regles : []).map((r) => String(r).slice(0, 300)));
      log('createur', `Tu as corrigé ses règles de goût (${memoire.tastes.regles.length}).`);
      broadcast('memoire', null);
      broadcast('gouts', memoire.tastes);
      return { ok: true };
    }
    case 'pause': brain.setPaused(!!body.pause, body.pause ? 'mis en pause par le Créateur' : ''); break;
    case 'plafond': {
      const v = Number(body.plafond);
      if (Number.isFinite(v) && v >= 0) { s.plafond = Math.min(200, v); if (brain.paused && brain.pauseReason.startsWith('plafond') && (memoire.seance.stats.depense || 0) < s.plafond) brain.setPaused(false); }
      break;
    }
    case 'voix': s.voix = !!body.voix; updateLive(); break;
    case 'vue': s.vue = !!body.vue; updateLive(); break;
    case 'atelier': s.atelier = !!body.auto; if (s.atelier) atelier.resume(); break;
    case 'message': {
      const text = String(body.texte || '').trim().slice(0, 1000);
      if (!text) break;
      log('createur', `« ${text} »`);
      brain.hear(text, 'salle');
      waitingNote();
      break;
    }
    case 'programme': if (body.arreter) programme.abort('arrêté par le Créateur'); break;
    case 'seance': {
      const closed = memoire.closeNow();
      if (!closed) return { ok: false, texte: memoire.hasPendingCalls() ? 'Un appel est encore en cours : attends sa fin avant de clore la séance.' : 'Cette séance ne contient pas encore de pensée ni d’observation à résumer.' };
      brain.writeReport(closed).catch(() => {}); log('systeme', 'Séance close par le Créateur : son rapport s’écrit, une nouvelle séance commence.');
      break;
    }
    case 'jeu': return game.command(body.commande, body.input || {}, { lancer_experience: 90000, mesurer_performances: 20000, mesurer_vehicule: 20000, sonder_sol: 20000 }[body.commande] || 8000);
    default: return { ok: false, erreur: 'commande inconnue' };
  }
  chantier.save();
  broadcast('statut', brain.status());
  broadcast('reglages', { ...s, jeton: undefined });
  broadcast('atelier', atelier.status());
  return { ok: true };
}

// The workshop's conversation on a ticket, reopened in a Terminal window (claude --resume), once it has finished
function openSession({ id, session }) {
  const t = chantier.tickets.get(id);
  const sid = session || t?.session;
  if (!sid || !/^[0-9a-f-]{36}$/.test(sid)) return { ok: false, texte: 'Ce ticket n’a pas de session d’atelier.' };
  if (atelier.live?.session === sid) return { ok: false, texte: 'L’atelier travaille encore sur ce ticket : suis-le ici, la session s’ouvrira quand il aura fini.' };
  const dir = path.join(chantier.dir, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `session-${sid}.command`);
  fs.writeFileSync(file, `#!/bin/zsh\n# La session de l’atelier sur le ticket #${t?.id || '?'} : ${(t?.titre || '').replace(/\n/g, ' ')}\ncd ${JSON.stringify(root)}\nexec claude --resume ${sid}\n`, { mode: 0o755 });
  execFile('open', [file], () => {});
  return { ok: true, texte: 'Session ouverte dans le Terminal.' };
}

// A message he cannot read at once: say why, so nobody waits in silence
function waitingNote() {
  const a = game.state?.architecte, tab = game.state?.onglet;
  let why = null;
  if (!brain.ready) why = 'la clé API est absente';
  else if (!chantier.settings.allume) why = 'il est éteint : allume-le pour qu’il te réponde';
  else if (!game.connected) why = 'le jeu n’est pas connecté';
  else if (tab && !tab.visible && !a?.spectating) why = 'l’onglet du jeu est caché (Chrome le met en pause)';
  else if (!a?.present) why = 'il n’est pas dans la partie (J ou menu pause → ARCHITECTE)';
  else if (brain.paused) why = `son cerveau est en pause (${brain.pauseReason})`;
  if (why) log('systeme', `Message en attente : ${why}. Il le lira dès que possible.`);
}

// Everything he does, also in the terminal where the server runs
const LABELS = { pensee: 'pense', action: 'action', parole: 'il dit', photo: 'photo', evenement: 'jeu', ticket: 'ticket', createur: 'toi', atelier: 'atelier', systeme: 'système', mesure: 'mesure', memoire: 'mémoire', code: 'code' };
const COLORS = { pensee: 35, action: 32, parole: 1, photo: 36, evenement: 33, ticket: 33, createur: 92, atelier: 36, systeme: 90, mesure: 34, memoire: 95, code: 94 };
function print(e) {
  if (!e) return;
  const time = new Date(e.t).toLocaleTimeString('fr-FR');
  const text = String(e.text || '').replace(/\s+/g, ' ');
  const width = Math.max(40, (process.stdout.columns || 120) - 22);
  console.log(`\x1b[90m${time}\x1b[0m \x1b[${COLORS[e.kind] || 0}m${(LABELS[e.kind] || e.kind).padEnd(8)}\x1b[0m ${text.length > width ? `${text.slice(0, width - 1)}…` : text}`);
}

// ---- HTTP ----------------------------------------------------------------------------------------------------------
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.local|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;
const loopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.patch': 'text/plain; charset=utf-8' };
const ROOM_FILE = /^\/([\w-]+\.(?:js|css))$/;

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > BODY_LIMIT) { reject(new Error('trop gros')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function sendFile(res, file) {
  fs.readFile(file, (err, data) => err ? send(res, 404, { erreur: 'introuvable' }) : send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream'));
}

function openStream(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => clearInterval(ping));
}

async function sessionDiff(id, file) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return '';
  const patch = path.join(atelier.dir, id, 'diff.patch');
  if (!fs.existsSync(patch)) return '';
  const text = fs.readFileSync(patch, 'utf8');
  if (!file) return text;
  // the part of the patch about one file
  return text.split(/^(?=diff --git )/m).filter((chunk) => chunk.startsWith(`diff --git a/${file} `)).join('');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const origin = req.headers.origin;
  if (origin && LOCAL_ORIGIN.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Jeton');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  // the page itself holds nothing: its data, photos and commands need the token from another device
  const page = req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html' || ROOM_FILE.test(url.pathname));
  if (!page && !loopback(req) && (url.searchParams.get('jeton') || req.headers['x-jeton']) !== chantier.settings.jeton) { send(res, 403, { erreur: 'jeton manquant' }); return; }
  const route = `${req.method} ${url.pathname}`;
  try {
    // The control room
    if (route === 'GET /' || route === 'GET /index.html') return sendFile(res, path.join(here, 'salle', 'index.html'));
    if (req.method === 'GET' && ROOM_FILE.test(url.pathname)) return sendFile(res, path.join(here, 'salle', ROOM_FILE.exec(url.pathname)[1]));
    if (route === 'GET /salle/flux') {
      openStream(req, res);
      res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
      rooms.add(res);
      updateLive();
      req.on('close', () => { rooms.delete(res); updateLive(); });
      return;
    }
    if (route === 'GET /salle/etat') return send(res, 200, snapshot());
    if (route === 'GET /salle/memoire') return send(res, 200, memorySnapshot());
    if (route === 'GET /salle/code') return send(res, 200, codeState());
    if (route === 'GET /salle/diff') {
      const file = url.searchParams.get('fichier') || '';
      const sid = url.searchParams.get('session');
      const text = sid ? await sessionDiff(sid, file) : await code.diffNow(file);
      return send(res, 200, text || '', 'text/plain; charset=utf-8');
    }
    if (route === 'GET /salle/sessions') return send(res, 200, atelier.history(60));
    if (route === 'GET /salle/live.jpg') return live.jpeg ? send(res, 200, live.jpeg, 'image/jpeg') : send(res, 404, { erreur: 'pas encore d’image' });
    if (req.method === 'GET' && /^\/photos\/p\d{5}\.jpg$/.test(url.pathname)) { const f = chantier.photoFile(path.basename(url.pathname, '.jpg')); return f ? sendFile(res, f) : send(res, 404, {}); }
    if (req.method === 'GET' && url.pathname.startsWith('/tickets/')) {
      const file = path.resolve(chantier.ticketsDir, decodeURIComponent(url.pathname.slice('/tickets/'.length)));
      if (!file.startsWith(chantier.ticketsDir + path.sep) || !/\.(jpg|md)$/.test(file)) return send(res, 403, {});
      return sendFile(res, file);
    }
    if (route === 'POST /salle/commande') return send(res, 200, await roomCommand(await readBody(req)));
    if (route === 'POST /salle/ticket') return send(res, 200, decideTicket(await readBody(req)));
    if (route === 'POST /salle/session') return send(res, 200, openSession(await readBody(req)));
    if (route === 'POST /salle/atelier') return send(res, 200, workshopCommand(await readBody(req)));

    // The game
    if (route === 'GET /jeu/flux') {
      // Results requested from the previous page must never satisfy work sent to its replacement.
      for (const resolve of game.pending.values()) resolve({ ok: false, texte: 'Le jeu a remplacé sa connexion.' });
      game.pending.clear();
      game.stream?.end();
      openStream(req, res);
      game.stream = res;
      game.connected = true;
      updateLive();
      broadcast('jeu', { connected: true, version: game.version });
      req.on('close', () => {
        if (game.stream !== res) return;
        game.stream = null;
        game.connected = false;
        for (const resolve of game.pending.values()) resolve({ ok: false, texte: 'Le jeu s’est déconnecté.' });
        game.pending.clear();
        broadcast('jeu', { connected: false });
        log('systeme', 'Le jeu s’est déconnecté.');
      });
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/jeu/')) {
      const body = await readBody(req);
      switch (url.pathname) {
        case '/jeu/bonjour': {
          const reload = game.loadedAt && body.charge && body.charge !== game.loadedAt;
          game.build = body.build;
          game.places = body.lieux || [];
          game.carte = body.carte || null;
          game.loadedAt = body.charge || Date.now();
          game.version = `${body.build || '?'}${version().replace(/^[^ ]*/, '')}`;
          brain.places = game.places; // his instructions are rebuilt with this game's places, at his next call
          broadcast('carte', { lieux: game.places, carte: game.carte });
          broadcast('jeu', { connected: true, version: game.version, charge: game.loadedAt });
          broadcast('code', codeState());
          if (reload) memoire.change('rechargement', 'Le jeu a été rechargé : il tourne maintenant sur le code du disque.');
          log('systeme', `Le jeu est connecté (version ${game.version}).`);
          // switched on: he comes into this game at once
          game.lastPresent = undefined;
          if (chantier.settings.allume) setTimeout(() => game.command('presence', { on: true }).catch(() => {}), 600);
          break;
        }
        case '/jeu/etat': {
          game.state = { ...body, version: game.version };
          broadcast('etat', game.state);
          // called or sent away from the game itself: the switch follows
          const present = !!body.architecte?.present;
          if (game.lastPresent !== undefined && present !== game.lastPresent && present !== !!chantier.settings.allume) setPower(present, { fromGame: true }).catch(() => {});
          game.lastPresent = present;
          break;
        }
        case '/jeu/evenement': {
          // an accident comes with its burst of photos
          const data = { ...(body.data || {}) };
          if (Array.isArray(body.photos) && body.photos.length) {
            data.photos = body.photos.slice(0, 4).map((img, i) => {
              const saved = chantier.savePhoto(img, { ...(body.lieu || {}), raison: `rafale : ${String(body.text).slice(0, 80)} (${i + 1})`, t: Date.now() });
              memoire.count('photos');
              return saved.id;
            });
          }
          const kind = data.photos?.length ? 'rafale' : body.kind;
          brain.push(kind, body.text, data);
          log('evenement', body.text, data);
          break;
        }
        case '/jeu/message': {
          const text = String(body.texte || '').trim().slice(0, 1000);
          if (text) {
            log('createur', `Dans le jeu : « ${text} »`);
            brain.hear(text, 'jeu');
            waitingNote();
          }
          break;
        }
        case '/jeu/resultat': {
          const resolve = game.pending.get(body.id);
          game.pending.delete(body.id);
          const strip = (s) => String(s || '').replace(/^data:image\/\w+;base64,/, '');
          resolve?.({ ...body, ok: body.ok !== false, image: body.image ? strip(body.image) : undefined, images: (body.images || []).map(strip) });
          break;
        }
        case '/jeu/image':
          live = { n: live.n + 1, jpeg: Buffer.from(String(body.jpeg || '').replace(/^data:image\/\w+;base64,/, ''), 'base64') };
          broadcast('live', { n: live.n });
          break;
        default: return send(res, 404, { erreur: 'route inconnue' });
      }
      return send(res, 200, { ok: true });
    }
    send(res, 404, { erreur: 'introuvable' });
  } catch (e) {
    send(res, 500, { erreur: e.message });
  }
});

server.listen(PORT, '0.0.0.0', async () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  await code.start().catch(() => {});
  const p = brain.status().roles;
  console.log(`\nL’Architecte est prêt.\n`);
  console.log(`  Salle de contrôle   http://localhost:${PORT}`);
  if (lan) console.log(`  Sur ton iPhone      http://${lan}:${PORT}/?jeton=${chantier.settings.jeton}   (même Wi-Fi)`);
  console.log(`  Pensées             ${p.pensee.modeleLabel} · raisonnement ${p.pensee.effortLabel.toLowerCase()}`);
  console.log(`  Conversation        ${p.parole.modeleLabel} · raisonnement ${p.parole.effortLabel.toLowerCase()}`);
  console.log(`  Relecture           ${p.relecture.modeleLabel} · raisonnement ${p.relecture.effortLabel.toLowerCase()}`);
  console.log(`  Plafond             ${chantier.settings.plafond} $ par séance`);
  console.log(`  Clé API             ${brain.ready ? 'trouvée' : 'ABSENTE : colle-la dans .env.local, puis relance'}`);
  console.log(`  Code                ${code.branch || '?'} (${code.head?.slice(0, 7) || '?'})`);
  console.log(`  Atelier             ${chantier.settings.atelier ? 'automatique (tickets validés)' : 'manuel'}`);
  console.log(PORT === 7780
    ? `\nOuvre le jeu (npm run dev, http://localhost:5173), puis menu pause → ARCHITECTE.\n`
    : `\nOuvre le jeu avec ?architecte_port=${PORT} dans son adresse (par exemple http://localhost:5173/?architecte_port=${PORT}), puis J ou menu pause → ARCHITECTE.\n`);
  log('systeme', `Serveur démarré. Clé ${brain.ready ? 'trouvée' : 'absente'}, code sur ${code.branch || '?'}.`);
  // a new version of himself: he hears what changed in him
  if (chantier.settings.versionArchitecte !== SELF.version) {
    memoire.change('outils', SELF.changes, { version: SELF.version });
    chantier.settings.versionArchitecte = SELF.version;
    chantier.settings.versionArchitecteDepuis = Date.now();
    chantier.save();
  }
  atelier.resume();
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Le port ${PORT} est déjà pris : l’Architecte tourne peut-être déjà (ou un autre programme l’utilise : lsof -nP -iTCP:${PORT}).` : e.message);
  process.exit(1);
});

const heartbeatTimer = setInterval(() => { brain.heartbeat(); programme.tick(); }, 1000);
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeatTimer);
  clearTimeout(codeTimer);
  brain.setPaused(true, 'arrêt du serveur');
  brain.halt();
  code.stop();
  for (const resolve of game.pending.values()) resolve({ ok: false, texte: 'Le serveur s’arrête.' });
  game.pending.clear();
  game.stream?.end();
  for (const room of rooms) room.end();
  try { await atelier.stop(); }
  finally {
    chantier.save();
    memoire.save();
    server.close();
    process.exit(0);
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { shutdown().catch((e) => { console.error(`Arrêt incomplet : ${e.message}`); process.exitCode = 1; }); });
