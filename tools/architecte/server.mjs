// The Architect's server (`npm run architecte`): his brain (Claude, with the Creator's API key from .env.local), his
// tickets and journal (chantier/), the workshop that fixes validated tickets, and the control room, at
// http://localhost:7780. The game (js/architect-link.js) connects to it: commands flow to the game over Server-Sent
// Events, everything the game sees and does comes back as JSON posts. A local tool: it listens on this machine and its
// network only, and anything that does not come from this machine needs the token printed at start.

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
const BODY_LIMIT = 8 * 1024 * 1024;

const envFile = path.join(root, '.env.local');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.ANTHROPIC_API_KEY?.trim()) delete process.env.ANTHROPIC_API_KEY;

// The one dependency (the Anthropic SDK), installed on first run
try { await import('@anthropic-ai/sdk'); } catch {
  console.log('Installation du SDK Anthropic (une seule fois)…');
  spawnSync('npm', ['install', '--prefix', here, '--no-audit', '--no-fund'], { stdio: 'inherit' });
}
const { Chantier } = await import('./chantier.mjs');
const { Brain, MODELS } = await import('./brain.mjs');
const { Atelier } = await import('./atelier.mjs');

// the tickets live in chantier/ at the project's root (elsewhere for a test run: ARCHITECTE_CHANTIER_ROOT)
const chantier = new Chantier(process.env.ARCHITECTE_CHANTIER_ROOT || root);
chantier.settings.jeton ??= crypto.randomBytes(9).toString('base64url');
chantier.save();

// ---- The game, at the other end of the line ------------------------------------------------------------------------
const game = {
  connected: false, stream: null, state: null, places: [], carte: null, build: null, version: version(),
  pending: new Map(), serial: 0,
  send(message) { this.stream?.write(`data: ${JSON.stringify(message)}\n\n`); },
  // A command the game carries out; resolves with { ok, texte, image?, lieu? }
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

const notify = (kind, data) => {
  if (kind === 'atelier' && data?.ticket) { atelier.enqueue(data.ticket); return; }
  if (kind === 'corrige') {
    const t = chantier.tickets.get(data.id);
    brain.push('corrige', data.ok ? `L’atelier a corrigé le ticket #${data.id} (${t?.titre}) : à vérifier sur place.` : `L’atelier a échoué sur le ticket #${data.id}.`);
  }
  broadcast(kind, data);
};
const brain = new Brain({ chantier, game, notify });
const atelier = new Atelier({ root, chantier, notify, log: (kind, text, data) => notify('journal', chantier.log(kind, text, data)) });

function snapshot() {
  return {
    settings: { ...chantier.settings, jeton: undefined }, modeles: Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, { label: m.label, id: m.id }])),
    cerveau: brain.status(), jeu: { connected: game.connected, version: game.version, build: game.build }, etat: game.state,
    journal: chantier.recent(200), tickets: chantier.listTickets(), atelier: atelier.status(), lieux: game.places, carte: game.carte,
    live: live.n, depenseDuJour: +(chantier.spending[new Date().toISOString().slice(0, 10)] || 0).toFixed(3)
  };
}

// ---- What the Creator decides in the control room ------------------------------------------------------------------
function decideTicket({ id, action, texte = '' }) {
  const t = chantier.tickets.get(id);
  if (!t) return { ok: false, erreur: 'ticket introuvable' };
  const why = String(texte).trim();
  if (action === 'valider') {
    chantier.updateTicket(id, { statut: 'valide' }, { qui: 'createur', texte: why ? `Validé : ${why}` : 'Validé.' });
    brain.push('ticket', `Le Créateur a validé ton ticket #${id} (${t.titre}).${why ? ` Il ajoute : « ${why} »` : ''}`);
    if (chantier.settings.atelier) atelier.enqueue(id);
  } else if (action === 'rejeter') {
    chantier.updateTicket(id, { statut: 'rejete' }, { qui: 'createur', texte: why ? `Rejeté : ${why}` : 'Rejeté.' });
    chantier.addNote(`Le Créateur a rejeté le ticket #${id} « ${t.titre} »${why ? ` : ${why}` : ' sans raison donnée'}. À retenir pour ses goûts.`, 'Créateur');
    brain.push('ticket', `Le Créateur a rejeté ton ticket #${id} (${t.titre})${why ? ` : « ${why} »` : ''}. C’est noté dans ton carnet.`);
  } else if (action === 'plus') {
    chantier.updateTicket(id, { statut: 'plus' }, { qui: 'createur', texte: `Demande plus : ${why || 'précise et rephotographie.'}` });
    brain.push('demande', `Le Créateur veut plus sur ton ticket #${id} (${t.titre}) : « ${why || 'précise et rephotographie'} ». Retourne à l’endroit exact (retourner_au_ticket), photographie, puis complète-le (completer_ticket).`);
  } else if (action === 'atelier') {
    atelier.enqueue(id);
  } else return { ok: false, erreur: 'action inconnue' };
  const e = chantier.log('createur', `Ticket #${id} : ${{ valider: 'validé', rejeter: 'rejeté', plus: 'plus demandé', atelier: 'envoyé à l’atelier' }[action]}${why ? ` (« ${why} »)` : ''}`, { id });
  broadcast('journal', e);
  broadcast('ticket', chantier.tickets.get(id));
  return { ok: true };
}

async function roomCommand(body) {
  const s = chantier.settings;
  switch (body.action) {
    case 'cerveau': if (MODELS[body.cerveau]) { s.cerveau = body.cerveau; brain.push('systeme', `Le Créateur a réglé ton cerveau sur ${MODELS[body.cerveau].label}.`); } break;
    case 'pause': brain.setPaused(!!body.pause, body.pause ? 'mis en pause par le Créateur' : ''); break;
    case 'plafond': {
      const v = Number(body.plafond);
      if (Number.isFinite(v) && v >= 0) { s.plafond = Math.min(200, v); if (brain.paused && brain.pauseReason.startsWith('plafond') && brain.session.dollars < s.plafond) brain.setPaused(false); }
      break;
    }
    case 'voix': s.voix = !!body.voix; updateLive(); break;
    case 'vue': s.vue = !!body.vue; updateLive(); break;
    case 'atelier': s.atelier = !!body.auto; if (s.atelier) atelier.resume(); break;
    case 'message': {
      const text = String(body.texte || '').trim().slice(0, 500);
      if (!text) break;
      broadcast('journal', chantier.log('createur', `« ${text} »`));
      brain.push('message_joueur', `Le Créateur t’écrit depuis la salle de contrôle : « ${text} »`);
      waitingNote();
      break;
    }
    case 'jeu': return game.command(body.commande, body.input || {}, 8000);
    default: return { ok: false, erreur: 'commande inconnue' };
  }
  chantier.save();
  broadcast('statut', brain.status());
  broadcast('reglages', { ...s, jeton: undefined });
  broadcast('atelier', atelier.status());
  return { ok: true };
}

// The workshop's conversation on a ticket, reopened in a Terminal window (claude --resume), once it has finished
function openSession({ id }) {
  const t = chantier.tickets.get(id);
  if (!t?.session || !/^[0-9a-f-]{36}$/.test(t.session)) return { ok: false, texte: 'Ce ticket n’a pas de session d’atelier.' };
  if (atelier.current?.id === id) return { ok: false, texte: 'L’atelier travaille encore sur ce ticket : suis-le ici, la session s’ouvrira quand il aura fini.' };
  const dir = path.join(chantier.dir, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ticket-${t.id}.command`);
  fs.writeFileSync(file, `#!/bin/zsh\n# La session de l’atelier sur le ticket #${t.id} : ${t.titre.replace(/\n/g, ' ')}\ncd ${JSON.stringify(root)}\nexec claude --resume ${t.session}\n`, { mode: 0o755 });
  execFile('open', [file], () => {});
  return { ok: true, texte: 'Session ouverte dans le Terminal.' };
}

// A message he cannot read at once: say why, so nobody waits in silence
function waitingNote() {
  const a = game.state?.architecte, tab = game.state?.onglet;
  let why = null;
  if (!game.connected) why = 'le jeu n’est pas connecté';
  else if (tab && !tab.visible) why = 'l’onglet du jeu est caché (Chrome le met en pause)';
  else if (!a?.present) why = 'il n’est pas dans la partie (J ou menu pause → ARCHITECTE)';
  else if (!a.alive) why = `il est hors service${a.respawnIn ? `, retour dans ${a.respawnIn} s` : ''}`;
  else if (brain.paused) why = `son cerveau est en pause (${brain.pauseReason})`;
  if (why) broadcast('journal', chantier.log('systeme', `Message en attente : ${why}. Il le lira dès que possible.`));
}

// Everything he does, also in the terminal where the server runs
const LABELS = { pensee: 'pense', action: 'action', parole: 'il dit', photo: 'photo', evenement: 'jeu', ticket: 'ticket', createur: 'toi', atelier: 'atelier', systeme: 'système' };
const COLORS = { pensee: 35, action: 32, parole: 1, photo: 36, evenement: 33, ticket: 33, createur: 92, atelier: 36, systeme: 90 };
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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

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
  const page = req.method === 'GET' && ['/', '/index.html', '/salle.js', '/salle.css'].includes(url.pathname);
  if (!page && !loopback(req) && (url.searchParams.get('jeton') || req.headers['x-jeton']) !== chantier.settings.jeton) { send(res, 403, { erreur: 'jeton manquant' }); return; }
  const route = `${req.method} ${url.pathname}`;
  try {
    // The control room
    if (route === 'GET /' || route === 'GET /index.html') return sendFile(res, path.join(here, 'salle', 'index.html'));
    if (req.method === 'GET' && /^\/salle\.(js|css)$/.test(url.pathname)) return sendFile(res, path.join(here, 'salle', url.pathname.slice(1)));
    if (route === 'GET /salle/flux') {
      openStream(req, res);
      res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
      rooms.add(res);
      updateLive();
      req.on('close', () => { rooms.delete(res); updateLive(); });
      return;
    }
    if (route === 'GET /salle/etat') return send(res, 200, snapshot());
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

    // The game
    if (route === 'GET /jeu/flux') {
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
        broadcast('journal', chantier.log('systeme', 'Le jeu s’est déconnecté.'));
      });
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/jeu/')) {
      const body = await readBody(req);
      switch (url.pathname) {
        case '/jeu/bonjour':
          game.build = body.build;
          game.places = body.lieux || [];
          game.carte = body.carte || null;
          game.version = `${body.build || '?'}${version().replace(/^[^ ]*/, '')}`;
          brain.system = null; // rebuilt with this game's places
          broadcast('carte', { lieux: game.places, carte: game.carte });
          broadcast('journal', chantier.log('systeme', `Le jeu est connecté (version ${game.version}).`));
          break;
        case '/jeu/etat':
          game.state = { ...body, version: game.version };
          broadcast('etat', game.state);
          break;
        case '/jeu/evenement':
          brain.push(body.kind, body.text, body.data);
          broadcast('journal', chantier.log('evenement', body.text, body.data));
          break;
        case '/jeu/message': {
          const text = String(body.texte || '').trim().slice(0, 500);
          if (text) {
            broadcast('journal', chantier.log('createur', `Dans le jeu : « ${text} »`));
            brain.push('message_joueur', `Le joueur te parle dans le jeu : « ${text} »`);
            waitingNote();
          }
          break;
        }
        case '/jeu/resultat': {
          const resolve = game.pending.get(body.id);
          game.pending.delete(body.id);
          resolve?.({ ok: body.ok !== false, texte: body.texte, image: body.image?.replace(/^data:image\/\w+;base64,/, ''), lieu: body.lieu });
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

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  const m = MODELS[chantier.settings.cerveau];
  console.log(`\nL’Architecte est prêt.\n`);
  console.log(`  Salle de contrôle   http://localhost:${PORT}`);
  if (lan) console.log(`  Sur ton iPhone      http://${lan}:${PORT}/?jeton=${chantier.settings.jeton}   (même Wi-Fi)`);
  console.log(`  Cerveau             ${m.label} (${m.id}) · plafond ${chantier.settings.plafond} $ par séance`);
  console.log(`  Clé API             ${brain.ready ? 'trouvée' : 'ABSENTE : colle-la dans .env.local, puis relance'}`);
  console.log(`  Atelier             ${chantier.settings.atelier ? 'automatique (tickets validés)' : 'manuel'}`);
  console.log(`\nOuvre le jeu (npm run dev, http://localhost:5173), puis menu pause → ARCHITECTE.\n`);
  broadcast('journal', chantier.log('systeme', `Serveur démarré. Cerveau ${m.label}, clé ${brain.ready ? 'trouvée' : 'absente'}.`));
  atelier.resume();
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Le port ${PORT} est déjà pris : l’Architecte tourne peut-être déjà (ou un autre programme l’utilise : lsof -nP -iTCP:${PORT}).` : e.message);
  process.exit(1);
});

setInterval(() => brain.heartbeat(), 1000);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { atelier.stop(); chantier.save(); process.exit(0); });
