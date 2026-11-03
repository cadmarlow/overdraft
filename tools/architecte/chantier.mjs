import fs from 'node:fs';
import path from 'node:path';

// The Architect's workshop on disk (chantier/ at the root of the project, ignored by git): tickets with their photos,
// the journal of each day, his notebook (his memory from one session to the next) and the settings. Everything a
// session leaves behind for the next one and for the Creator.

const STATUS = {
  a_valider: 'À valider',
  plus: 'Le Créateur demande plus',
  rejete: 'Rejeté',
  valide: 'Validé',
  atelier: 'À l’atelier',
  corrige: 'Corrigé, à vérifier',
  verifie: 'Vérifié, clos',
  echec: 'L’atelier a échoué'
};
const CATEGORIES = { bug: 'Bug', art: 'Art', performance: 'Performance', gameplay: 'Gameplay', son: 'Son' };
const DEFAULTS = { cerveau: 'equilibre', plafond: 3, voix: true, atelier: true, vue: true };
// What the Creator asked for first (ARCHITECTE.md): his entrance exam
const FIRST_NOTES = [
  'Premiers chantiers du Créateur : les boutiques et vitrines (niveau d’un jeu des années 1990), les explosions incohérentes, le joueur qui s’enfonce dans le trottoir, les bugs de voiture.',
  'Le capteur « enfoncé » compare la position au sol calculé par le jeu : le bug du trottoir est sans doute un écart entre le trottoir dessiné et ce sol. Il faut le voir de ses yeux.'
];

const today = () => new Date().toISOString().slice(0, 10);
const slug = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ticket';
const stamp = (t) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

class Chantier {
  constructor(root) {
    this.root = root;
    this.dir = path.join(root, 'chantier');
    this.ticketsDir = path.join(this.dir, 'tickets');
    this.photosDir = path.join(this.dir, 'photos');
    this.journalDir = path.join(this.dir, 'journal');
    for (const d of [this.dir, this.ticketsDir, this.photosDir, this.journalDir]) fs.mkdirSync(d, { recursive: true });
    this.settingsFile = path.join(this.dir, 'etat.json');
    const saved = this.readJson(this.settingsFile) || {};
    this.settings = { ...DEFAULTS, ...saved.settings };
    this.counters = { ticket: 0, photo: 0, ...saved.counters };
    this.spending = saved.spending || {}; // dollars per day
    this.carnetFile = path.join(this.dir, 'carnet.md');
    if (!fs.existsSync(this.carnetFile)) {
      fs.writeFileSync(this.carnetFile, '# Carnet de l’Architecte\n\nSa mémoire d’une session à l’autre : ce qu’il a appris, ce que le Créateur aime et n’aime pas.\n\n');
      for (const n of FIRST_NOTES) this.addNote(n, 'Créateur');
    }
    this.tickets = new Map();
    for (const name of fs.readdirSync(this.ticketsDir)) {
      const t = this.readJson(path.join(this.ticketsDir, name, 'ticket.json'));
      if (t) this.tickets.set(t.id, t);
    }
    this.journal = [];
    this.journalSerial = 0;
    // the end of today's journal, for a control room that opens mid-session
    const file = this.journalFile();
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').slice(-300);
      for (const line of lines) { try { const e = JSON.parse(line); this.journal.push(e); this.journalSerial = Math.max(this.journalSerial, e.id || 0); } catch { /* a torn line */ } }
    }
  }

  readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  }

  save() {
    fs.writeFileSync(this.settingsFile, JSON.stringify({ settings: this.settings, counters: this.counters, spending: this.spending }, null, 2));
  }

  addSpending(dollars) {
    const d = today();
    this.spending[d] = (this.spending[d] || 0) + dollars;
    this.saveSoon();
  }

  saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 2000);
  }

  // ---- Journal: everything he thinks, does and sees, one JSON line each -------------------------------------------
  journalFile() { return path.join(this.journalDir, `${today()}.jsonl`); }

  /** @param {string} kind - pensee | action | parole | evenement | ticket | createur | atelier | systeme | photo */
  log(kind, text, data = undefined) {
    const entry = { id: ++this.journalSerial, t: Date.now(), kind, text };
    if (data !== undefined) entry.data = data;
    this.journal.push(entry);
    if (this.journal.length > 400) this.journal.shift();
    // written at once: a line is never lost when the server stops
    fs.appendFileSync(this.journalFile(), JSON.stringify(entry) + '\n');
    return entry;
  }

  recent(n = 12, kinds = null) {
    const list = kinds ? this.journal.filter((e) => kinds.includes(e.kind)) : this.journal;
    return list.slice(-n);
  }

  // ---- Photos -------------------------------------------------------------------------------------------------------
  savePhoto(dataUrl, meta = {}) {
    const base64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, '');
    const id = `p${String(++this.counters.photo).padStart(5, '0')}`;
    fs.writeFileSync(path.join(this.photosDir, `${id}.jpg`), Buffer.from(base64, 'base64'));
    fs.writeFileSync(path.join(this.photosDir, `${id}.json`), JSON.stringify(meta));
    this.saveSoon();
    return { id, base64 };
  }

  photoFile(id) {
    if (!/^p\d{5}$/.test(id)) return null;
    const file = path.join(this.photosDir, `${id}.jpg`);
    return fs.existsSync(file) ? file : null;
  }

  photoBase64(id) {
    const file = this.photoFile(id);
    return file ? fs.readFileSync(file).toString('base64') : null;
  }

  // ---- Tickets ------------------------------------------------------------------------------------------------------
  ticketDir(t) { return path.join(this.ticketsDir, t.dir); }

  /**
   * @param {object} draft - titre, categorie, gravite, constat, piste, photos (ids), lieu { x, y, z, adresse, lien }, version
   */
  createTicket(draft) {
    const n = ++this.counters.ticket;
    const id = String(n).padStart(4, '0');
    const t = {
      id, dir: `${id}-${slug(draft.titre)}`, statut: 'a_valider', ouvert: Date.now(), maj: Date.now(),
      titre: draft.titre, categorie: draft.categorie, gravite: draft.gravite, constat: draft.constat, piste: draft.piste,
      lieu: draft.lieu, version: draft.version, photos: [], apres: [], fil: []
    };
    fs.mkdirSync(this.ticketDir(t), { recursive: true });
    for (const p of draft.photos || []) {
      const file = this.photoFile(p);
      if (!file) continue;
      fs.copyFileSync(file, path.join(this.ticketDir(t), `${p}.jpg`));
      t.photos.push(p);
    }
    t.fil.push({ qui: 'architecte', t: Date.now(), texte: 'Ticket ouvert.' });
    this.tickets.set(id, t);
    this.writeTicket(t);
    this.save();
    return t;
  }

  addPhotos(t, ids, key = 'photos') {
    for (const p of ids) {
      const file = this.photoFile(p);
      if (!file || t[key].includes(p)) continue;
      fs.copyFileSync(file, path.join(this.ticketDir(t), `${p}.jpg`));
      t[key].push(p);
    }
  }

  updateTicket(id, patch = {}, note = null) {
    const t = this.tickets.get(id);
    if (!t) return null;
    Object.assign(t, patch, { maj: Date.now() });
    if (note) t.fil.push({ t: Date.now(), ...note });
    this.writeTicket(t);
    return t;
  }

  writeTicket(t) {
    fs.writeFileSync(path.join(this.ticketDir(t), 'ticket.json'), JSON.stringify(t, null, 2));
    fs.writeFileSync(path.join(this.ticketDir(t), 'ticket.md'), this.markdown(t));
  }

  markdown(t) {
    const who = { architecte: 'Architecte', createur: 'Créateur', atelier: 'Atelier' };
    const l = t.lieu || {};
    return [
      `# #${t.id} · ${CATEGORIES[t.categorie] || t.categorie} · Gravité ${t.gravite} · ${STATUS[t.statut] || t.statut}`,
      '',
      `**${t.titre}**`,
      '',
      `- Où : ${l.adresse || '?'} (${[l.x, l.y, l.z].map((v) => Math.round(v ?? 0)).join(', ')})`,
      l.lien ? `- Voir dans le jeu : ${l.lien}` : null,
      `- Version : ${t.version || '?'}`,
      `- Ouvert le ${stamp(t.ouvert)} par l’Architecte`,
      '',
      '## Constat', '', t.constat || '', '',
      '## Piste', '', t.piste || '', '',
      '## Photos', '', ...t.photos.map((p) => `![${p}](${p}.jpg)`), '',
      ...(t.apres.length ? ['## Après correction', '', ...t.apres.map((p) => `![${p}](${p}.jpg)`), ''] : []),
      '## Fil', '', ...t.fil.map((f) => `- ${stamp(f.t)} · ${who[f.qui] || f.qui} : ${String(f.texte).replace(/\n+/g, ' ')}`), ''
    ].filter((line) => line !== null).join('\n');
  }

  listTickets() {
    return [...this.tickets.values()].sort((a, b) => b.ouvert - a.ouvert);
  }

  // ---- His notebook ---------------------------------------------------------------------------------------------------
  addNote(text, who = 'Architecte') {
    fs.appendFileSync(this.carnetFile, `- ${stamp(Date.now())} · ${who} : ${text.replace(/\n+/g, ' ')}\n`);
  }

  notes(n = 30) {
    try {
      return fs.readFileSync(this.carnetFile, 'utf8').split('\n').filter((l) => l.startsWith('- ')).slice(-n);
    } catch { return []; }
  }
}

export { CATEGORIES, Chantier, STATUS };
