import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// The Architect's memory, in layers (chantier/memoire/):
// - the session (seance.json): what he saw, concluded and planned since he was switched on; a pause of more than an hour
//   and a half closes it, and its report becomes the next session's briefing;
// - the conversation with the Creator (conversation.jsonl), kept whole, the oldest exchanges folded into a summary;
// - the Creator's tastes (gouts.json): rules distilled from every decision on a ticket, always in his mind;
// - what he has covered (couverture.json): every photo marks a 100 m cell, by day, night and rain;
// - what changed in the world (changements.jsonl): commits, deliveries from the workshop, the Creator's decisions;
// - the session reports (rapports/).
// Each thought starts from these rather than from a long raw conversation: small, cheap, and it survives a restart.

const SESSION_GAP = 90 * 60 * 1000;
const CELL = 100;
const KEEP_TALK = 30; // exchanges kept word for word in his mind; the older ones live in the summary
const KEEP_SEEN = 40; // observations of the session kept in his mind

const stamp = (t) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const clock = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const isNight = (hour) => Number.isFinite(hour) && (hour < 6.5 || hour > 19.5);

class Memoire {
  constructor(chantier) {
    this.chantier = chantier;
    this.dir = path.join(chantier.dir, 'memoire');
    this.reportsDir = path.join(this.dir, 'rapports');
    this.sessionsDir = path.join(this.dir, 'seances');
    for (const d of [this.dir, this.reportsDir, this.sessionsDir]) fs.mkdirSync(d, { recursive: true });
    this.files = {
      seance: path.join(this.dir, 'seance.json'),
      talk: path.join(this.dir, 'conversation.jsonl'),
      talkSummary: path.join(this.dir, 'conversation-resume.json'),
      tastes: path.join(this.dir, 'gouts.json'),
      cover: path.join(this.dir, 'couverture.json'),
      changes: path.join(this.dir, 'changements.jsonl')
    };
    this.seance = read(this.files.seance) || this.freshSession();
    this.talk = readLines(this.files.talk);
    this.talkSummary = read(this.files.talkSummary) || { texte: '', jusqua: 0 };
    this.tastes = read(this.files.tastes) || { regles: [], maj: 0 };
    this.cover = read(this.files.cover) || {};
    this.changes = readLines(this.files.changes).slice(-300);
    this.closed = null; // the session that the last call to touch() closed, waiting for its report
    // No old process is left to return usage for these requests. Their durable reservations remain a ceiling charge.
    const abandoned = Object.values(this.seance.appelsEnVol || {}).reduce((sum, r) => sum + (Number.isFinite(r.montant) && r.montant > 0 ? r.montant : 0), 0);
    if (abandoned) {
      this.seance.stats.depense_estimee = (this.seance.stats.depense_estimee || 0) + abandoned;
      this.seance.appelsEnVol = {};
      this.save();
    }
  }

  // ---- The session ------------------------------------------------------------------------------------------------------
  freshSession() {
    const now = Date.now();
    return { id: `${new Date(now).toISOString().replace(/\D/g, '')}-${randomUUID().slice(0, 8)}`, debut: now, derniere: now, observations: [], conclusions: [], programme: null, programmes: [], briefing: true, stats: { pensees: 0, photos: 0, tickets: [], depense: 0 } };
  }

  // He is awake: a long silence since the last sign of life means a new session (the old one is set aside for its report)
  touch(now = Date.now()) {
    if (now - this.seance.derniere > SESSION_GAP && !this.hasPendingCalls()) {
      this.closed = this.seance;
      atomicWrite(path.join(this.sessionsDir, `${this.closed.id}.json`), JSON.stringify(this.closed));
      this.seance = this.freshSession();
      this.seance.depuis = this.closed.derniere; // what changed while he was away goes in his briefing
    }
    this.seance.derniere = now;
    this.saveSoon();
    return this.seance;
  }

  // The Creator closes the session from the control room: its report is written, a new one begins
  closeNow() {
    if (this.hasPendingCalls()) return null;
    if (!this.seance.stats.pensees && !this.seance.observations.length) return null;
    this.touch(this.seance.derniere + SESSION_GAP + 1);
    this.seance.derniere = Date.now();
    this.seance.debut = Date.now();
    return this.closed;
  }

  // What he saw (in his own words), with the photos and the place
  observe({ texte, photos = [], lieu = null, sujet = '' }) {
    if (!texte) return;
    this.seance.observations.push({ t: Date.now(), texte: String(texte).slice(0, 500), photos, lieu, sujet });
    if (this.seance.observations.length > 400) this.seance.observations.shift();
    this.saveSoon();
  }

  // The last words of a thought: what he made of it and what he does next
  conclude(texte) {
    if (!texte) return;
    this.seance.conclusions.push({ t: Date.now(), texte: String(texte).slice(0, 600) });
    if (this.seance.conclusions.length > 200) this.seance.conclusions.shift();
    this.saveSoon();
  }

  count(field, value = 1) {
    const s = this.seance.stats;
    if (field === 'tickets') { if (!s.tickets.includes(value)) s.tickets.push(value); } else s[field] = (s[field] || 0) + value;
    this.saveSoon();
  }

  hasPendingCalls() { return Object.keys(this.seance.appelsEnVol || {}).length > 0; }

  reserveCall(montant) {
    const id = randomUUID();
    (this.seance.appelsEnVol ??= {})[id] = { montant, depuis: Date.now() };
    // This must reach disk before sending the request, including before the first heartbeat has saved anything.
    try { this.save(); } catch (e) { delete this.seance.appelsEnVol[id]; throw e; }
    return id;
  }

  releaseCall(id) {
    delete this.seance.appelsEnVol?.[id];
    // Usage or uncertainty has already been counted: persist it in the same replacement as the reservation removal.
    this.save();
  }

  recentSeen(n = KEEP_SEEN) { return this.seance.observations.slice(-n); }
  recentConclusions(n = 6) { return this.seance.conclusions.slice(-n); }

  // ---- The conversation with the Creator ------------------------------------------------------------------------------
  /** @param {'createur'|'architecte'} qui @param {'jeu'|'salle'} canal */
  say(qui, texte, canal = 'salle') {
    const e = { t: Date.now(), qui, canal, texte: String(texte).slice(0, 2000) };
    this.talk.push(e);
    fs.appendFileSync(this.files.talk, JSON.stringify(e) + '\n');
    return e;
  }

  recentTalk(n = KEEP_TALK) { return this.talk.slice(-n); }

  // Exchanges too old to stay word for word, not yet in the summary
  talkToFold() {
    const keepFrom = this.talk.length - KEEP_TALK;
    if (keepFrom - this.talkSummary.jusqua < 30) return null;
    return { from: this.talkSummary.jusqua, to: keepFrom, entries: this.talk.slice(this.talkSummary.jusqua, keepFrom) };
  }

  setTalkSummary(texte, jusqua) {
    this.talkSummary = { texte: String(texte).slice(0, 4000), jusqua, maj: Date.now() };
    atomicWrite(this.files.talkSummary, JSON.stringify(this.talkSummary, null, 2));
  }

  // ---- The Creator's tastes ---------------------------------------------------------------------------------------------
  setTastes(regles) {
    this.tastes = { regles: regles.map((r) => String(r).trim()).filter(Boolean).slice(0, 30), maj: Date.now() };
    atomicWrite(this.files.tastes, JSON.stringify(this.tastes, null, 2));
  }

  // ---- What he has covered ----------------------------------------------------------------------------------------------
  cell(x, z) { return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; }

  markCovered({ x, z, heure, meteo, sujet = '', adresse = '' }) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const key = this.cell(x, z);
    const c = (this.cover[key] ??= { x: (Math.floor(x / CELL) + 0.5) * CELL, z: (Math.floor(z / CELL) + 0.5) * CELL, n: 0, jour: 0, nuit: 0, pluie: 0, sujets: {}, adresse: '' });
    c.n++;
    c.t = Date.now();
    if (isNight(heure)) c.nuit++; else c.jour++;
    if (meteo === 'rain' || meteo === 'storm') c.pluie++;
    if (sujet) c.sujets[sujet] = (c.sujets[sujet] || 0) + 1;
    if (adresse) c.adresse = adresse;
    this.saveSoon();
  }

  coveredNear(x, z, radius = 250) {
    let n = 0, jour = 0, nuit = 0, pluie = 0;
    const sujets = {};
    for (const c of Object.values(this.cover)) {
      if (Math.hypot(c.x - x, c.z - z) > radius) continue;
      n += c.n; jour += c.jour; nuit += c.nuit; pluie += c.pluie;
      for (const [k, v] of Object.entries(c.sujets)) sujets[k] = (sujets[k] || 0) + v;
    }
    return { n, jour, nuit, pluie, sujets };
  }

  // A few lines for his mind: where he has been a lot, where never
  coverageSummary(places = []) {
    const cells = Object.values(this.cover);
    if (!cells.length) return 'Tu n’as encore rien photographié : toute la ville est à découvrir.';
    const seen = [], never = [];
    for (const p of places) {
      const c = this.coveredNear(p.x, p.z);
      if (c.n) seen.push({ p, c }); else never.push(p);
    }
    seen.sort((a, b) => b.c.n - a.c.n);
    const lines = [`${cells.length} zones de 100 m photographiées (${cells.reduce((s, c) => s + c.n, 0)} photos).`];
    if (seen.length) lines.push(`Déjà vus : ${seen.slice(0, 8).map(({ p, c }) => `${p.label} (${c.n} photos${c.nuit ? `, dont ${c.nuit} de nuit` : ', jamais de nuit'}${c.pluie ? `, ${c.pluie} sous la pluie` : ''}${Object.keys(c.sujets).length ? ` ; sujets : ${Object.keys(c.sujets).join(', ')}` : ''})`).join(' ; ')}.`);
    if (never.length) lines.push(`Jamais vus : ${never.slice(0, 12).map((p) => p.label).join(', ')}.`);
    return lines.join('\n');
  }

  coverCells() { return Object.values(this.cover); }

  // ---- What changed in the world ----------------------------------------------------------------------------------------
  /** @param {string} kind - commit | livraison | decision | rechargement | code */
  change(kind, texte, data = undefined) {
    const e = { t: Date.now(), kind, texte };
    if (data !== undefined) e.data = data;
    this.changes.push(e);
    if (this.changes.length > 300) this.changes.shift();
    fs.appendFileSync(this.files.changes, JSON.stringify(e) + '\n');
    return e;
  }

  changesSince(t) { return this.changes.filter((c) => c.t > t); }

  // ---- Session reports --------------------------------------------------------------------------------------------------
  saveReport(seance, texte) {
    const file = path.join(this.reportsDir, `${seance.id}.md`);
    atomicWrite(file, texte);
    return file;
  }

  // A failed reread must not promote an unreviewed ticket or discard its evidence.
  saveReviewDraft(draft, photos, raison, etat = 'en_attente') {
    const dir = path.join(this.dir, 'relectures');
    fs.mkdirSync(dir, { recursive: true });
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    atomicWrite(path.join(dir, `${id}.json`), JSON.stringify({ id, t: Date.now(), etat, draft, photos, raison }));
    this.observe({ texte: `Relecture ${etat === 'en_attente' ? 'en attente' : 'écartée'} (${id}) : ${draft.titre}. ${raison}`, photos, sujet: 'relecture' });
    return id;
  }

  reports(n = 10) {
    try {
      return fs.readdirSync(this.reportsDir).filter((f) => f.endsWith('.md')).sort().slice(-n).reverse()
        .map((f) => ({ id: f.replace(/\.md$/, ''), texte: fs.readFileSync(path.join(this.reportsDir, f), 'utf8') }));
    } catch { return []; }
  }

  lastReport() { return this.reports(1)[0] || null; }

  // The facts of a session, before any words of his: what a report is built on
  facts(seance = this.seance) {
    const tickets = seance.stats.tickets.map((id) => this.chantier.tickets.get(id)).filter(Boolean);
    const places = [...new Set(seance.observations.map((o) => o.lieu?.adresse).filter(Boolean))];
    return {
      debut: seance.debut, fin: seance.derniere, duree: Math.round((seance.derniere - seance.debut) / 60000),
      pensees: seance.stats.pensees || 0, photos: seance.stats.photos || 0, depense: +(seance.stats.depense || 0).toFixed(3),
      tickets: tickets.map((t) => `#${t.id} ${t.titre} (${t.statut})`), lieux: places.slice(0, 20),
      programmes: (seance.programmes || []).map((p) => `${p.sujet} (${p.etat})`),
      observations: seance.observations.slice(-60).map((o) => `${clock(o.t)} ${o.lieu?.adresse ? `[${o.lieu.adresse}] ` : ''}${o.texte}`),
      conversation: this.talk.filter((e) => e.t >= seance.debut && e.t <= seance.derniere + 1000).slice(-30).map((e) => `${e.qui === 'createur' ? 'Créateur' : 'Moi'} : ${e.texte}`)
    };
  }

  // A report written from the facts alone (when no brain is there to write the summary)
  factualReport(seance, bilan = '') {
    const f = this.facts(seance);
    return [
      `# Séance du ${stamp(f.debut)} (${f.duree} min)`,
      '',
      bilan ? `## Bilan\n\n${bilan}\n` : null,
      '## Les faits', '',
      `- ${f.pensees} pensées, ${f.photos} photos, ${f.depense.toFixed(2).replace('.', ',')} $ dépensés`,
      `- Tickets : ${f.tickets.join(' ; ') || 'aucun'}`,
      `- Programmes : ${f.programmes.join(' ; ') || 'aucun'}`,
      `- Lieux : ${f.lieux.join(', ') || '—'}`,
      ''
    ].filter((l) => l !== null).join('\n');
  }

  // ---- Searching his memory ---------------------------------------------------------------------------------------------
  search(words, limit = 14) {
    const terms = String(words || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (!terms.length) return [];
    const hits = [];
    const match = (text) => { const l = String(text).toLowerCase(); return terms.filter((w) => l.includes(w)).length; };
    const add = (t, where, texte) => { const score = match(texte); if (score) hits.push({ t, where, texte: String(texte).slice(0, 300), score }); };
    const sessions = [this.seance];
    try { for (const f of fs.readdirSync(this.sessionsDir).sort().slice(-8)) { const s = read(path.join(this.sessionsDir, f)); if (s) sessions.push(s); } } catch { /* none */ }
    for (const s of sessions) for (const o of s.observations || []) add(o.t, `vu${o.lieu?.adresse ? ` à ${o.lieu.adresse}` : ''}`, o.texte);
    for (const e of this.talk) add(e.t, e.qui === 'createur' ? 'le Créateur m’a dit' : 'j’ai dit au Créateur', e.texte);
    for (const n of this.chantier.notes(200)) add(0, 'carnet', n);
    for (const c of this.changes) add(c.t, c.kind, c.texte);
    return hits.sort((a, b) => b.score - a.score || b.t - a.t).slice(0, limit);
  }

  // ---- Disk --------------------------------------------------------------------------------------------------------------
  saveSoon() {
    // A heartbeat arrives every second: debounce would postpone this forever.
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.save(), 1500);
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    atomicWrite(this.files.seance, JSON.stringify(this.seance));
    atomicWrite(this.files.cover, JSON.stringify(this.cover));
  }
}

function atomicWrite(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp);
  }
}

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function readLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export { CELL, Memoire, SESSION_GAP, isNight, stamp, clock };
