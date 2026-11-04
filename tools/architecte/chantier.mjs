import fs from 'node:fs';
import path from 'node:path';
import { canTransition, migrateValidation } from './ticket-policy.mjs';

// The Architect's workshop on disk (chantier/ at the root of the project, ignored by git): tickets with their photos,
// the journal of each day, his notebook, his experiments and the settings. Everything a session leaves behind for the
// next one and for the Creator. His memory proper (the session, the conversation, the Creator's tastes, what he has
// covered) lives in memoire.mjs, under chantier/memoire/.

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
const CATEGORIES = { bug: 'Bug', art: 'Art', performance: 'Performance', gameplay: 'Gameplay', son: 'Son', outil: 'Outil de l’Architecte' };
// The three roles his mind plays, each with its own model and depth of reasoning, changed at any time
const ROLES = { pensee: 'Ses pensées', parole: 'Sa conversation avec toi', relecture: 'La relecture des tickets' };
const EFFORTS = { low: 'Bas', medium: 'Moyen', high: 'Haut', xhigh: 'Très haut', max: 'Maximum' };
const BRAINS = { vif: 'Vif', equilibre: 'Équilibré', maximal: 'Maximal' };
const DEFAULT_BRAINS = {
  pensee: { modele: 'equilibre', effort: 'low' },
  parole: { modele: 'equilibre', effort: 'low' },
  relecture: { modele: 'maximal', effort: 'medium' }
};
// allume: the Creator's switch. On, he comes into the game and his mind works; off, he is gone and costs nothing
const DEFAULTS = { plafond: 3, voix: false, atelier: true, vue: true, allume: false };
// What the Creator asked for first (ARCHITECTE.md): his entrance exam
const FIRST_NOTES = [
  'Premiers chantiers du Créateur : les boutiques et vitrines (niveau d’un jeu des années 1990), les explosions incohérentes, le joueur qui s’enfonce dans le trottoir, les bugs de voiture.',
  'Le capteur « enfoncé » compare la position au sol calculé par le jeu : le bug du trottoir est sans doute un écart entre le trottoir dessiné et ce sol. Il faut le voir de ses yeux (sonder_sol, expérience bordure).'
];

const today = () => new Date().toISOString().slice(0, 10);
const slug = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ticket';
const stamp = (t) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

// Settings saved by an earlier version: one brain for everything (`cerveau`), the ticket reread by the tier above
function migrateBrains(saved = {}) {
  const brains = structuredClone(DEFAULT_BRAINS);
  if (saved.cerveaux) {
    for (const role of Object.keys(ROLES)) {
      const r = saved.cerveaux[role];
      if (BRAINS[r?.modele]) brains[role].modele = r.modele;
      if (EFFORTS[r?.effort]) brains[role].effort = r.effort;
    }
  } else if (BRAINS[saved.cerveau]) {
    brains.pensee.modele = brains.parole.modele = saved.cerveau;
    brains.relecture.modele = { vif: 'equilibre', equilibre: 'maximal', maximal: 'maximal' }[saved.cerveau];
  }
  return brains;
}

class Chantier {
  constructor(root) {
    this.root = root;
    this.dir = path.join(root, 'chantier');
    this.ticketsDir = path.join(this.dir, 'tickets');
    this.photosDir = path.join(this.dir, 'photos');
    this.journalDir = path.join(this.dir, 'journal');
    this.experiencesDir = path.join(this.dir, 'experiences');
    for (const d of [this.dir, this.ticketsDir, this.photosDir, this.journalDir, this.experiencesDir]) fs.mkdirSync(d, { recursive: true });
    this.settingsFile = path.join(this.dir, 'etat.json');
    const saved = this.readJson(this.settingsFile) || {};
    const { cerveau, cerveaux, ...rest } = saved.settings || {};
    this.settings = { ...DEFAULTS, ...rest, cerveaux: migrateBrains(saved.settings) };
    this.counters = { ticket: 0, photo: 0, experience: 0, ...saved.counters };
    this.spending = saved.spending || {}; // dollars per day
    this.spendingDetail = saved.spendingDetail || {}; // per day: per role and per model
    this.carnetFile = path.join(this.dir, 'carnet.md');
    if (!fs.existsSync(this.carnetFile)) {
      fs.writeFileSync(this.carnetFile, '# Carnet de l’Architecte\n\nSa mémoire d’une session à l’autre : ce qu’il a appris, ce que le Créateur aime et n’aime pas.\n\n');
      for (const n of FIRST_NOTES) this.addNote(n, 'Créateur');
    }
    this.tickets = new Map();
    for (const name of fs.readdirSync(this.ticketsDir)) {
      const t = this.readJson(path.join(this.ticketsDir, name, 'ticket.json'));
      if (t) this.tickets.set(t.id, normalize(t));
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
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    writeJson(this.settingsFile, { settings: this.settings, counters: this.counters, spending: this.spending, spendingDetail: this.spendingDetail });
  }

  /** @param {string} role - pensee | parole | relecture | atelier ; @param {string} model - its label */
  addSpending(dollars, role = 'pensee', model = '?') {
    const d = today();
    this.spending[d] = (this.spending[d] || 0) + dollars;
    const day = (this.spendingDetail[d] ??= { roles: {}, modeles: {} });
    day.roles[role] = (day.roles[role] || 0) + dollars;
    day.modeles[model] = (day.modeles[model] || 0) + dollars;
    this.saveSoon();
  }

  saveSoon() {
    if (!this.saveTimer) this.saveTimer = setTimeout(() => this.save(), 2000);
  }

  // ---- Journal: everything he thinks, does and sees, one JSON line each -------------------------------------------
  journalFile() { return path.join(this.journalDir, `${today()}.jsonl`); }

  /** @param {string} kind - pensee | action | parole | evenement | ticket | createur | atelier | systeme | photo | code */
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
    writeJson(path.join(this.photosDir, `${id}.json`), { ...meta, t: meta.t ?? Date.now() });
    this.save(); // photo IDs must not be reused after a crash
    return { id, base64 };
  }

  photoFile(id) {
    if (!/^p\d{5}$/.test(id)) return null;
    const file = path.join(this.photosDir, `${id}.jpg`);
    return fs.existsSync(file) ? file : null;
  }

  photoMeta(id) {
    return /^p\d{5}$/.test(id) ? this.readJson(path.join(this.photosDir, `${id}.json`)) : null;
  }

  photoBase64(id) {
    const file = this.photoFile(id);
    return file ? fs.readFileSync(file).toString('base64') : null;
  }

  // ---- Experiments: a scripted test the body ran, its measures and photos, rerun to verify a fix --------------------
  saveExperience(record) {
    const id = `e${String(++this.counters.experience).padStart(4, '0')}`;
    const e = { ...record, id, t: Date.now() };
    writeJson(path.join(this.experiencesDir, `${id}.json`), e);
    this.save();
    return e;
  }

  experience(id) {
    return /^e\d{4}$/.test(String(id)) ? this.readJson(path.join(this.experiencesDir, `${id}.json`)) : null;
  }

  listExperiences(n = 30) {
    try {
      return fs.readdirSync(this.experiencesDir).filter((f) => /^e\d{4}\.json$/.test(f)).sort().slice(-n).reverse()
        .map((f) => this.readJson(path.join(this.experiencesDir, f))).filter(Boolean);
    } catch { return []; }
  }

  // ---- Tickets ------------------------------------------------------------------------------------------------------
  ticketDir(t) { return path.join(this.ticketsDir, t.dir); }

  /**
   * @param {object} draft - titre, en_clair, categorie, gravite, constat, piste, photos (ids), lieu { x, y, z, adresse, lien },
   *   version, regression_de (a closed ticket it brings back), experience (the experiment that proves it)
   */
  createTicket(draft) {
    const n = ++this.counters.ticket;
    const id = String(n).padStart(4, '0');
    const t = normalize({
      id, dir: `${id}-${slug(draft.titre)}`, statut: 'a_valider', ouvert: Date.now(), maj: Date.now(),
      titre: draft.titre, en_clair: draft.en_clair || '', categorie: draft.categorie, gravite: draft.gravite, constat: draft.constat, piste: draft.piste,
      lieu: draft.lieu, version: draft.version, regression_de: draft.regression_de || null, experience: draft.experience || null
    });
    fs.mkdirSync(this.ticketDir(t), { recursive: true });
    for (const p of draft.photos || []) {
      const file = this.photoFile(p);
      if (!file) continue;
      fs.copyFileSync(file, path.join(this.ticketDir(t), `${p}.jpg`));
      t.photos.push(p);
    }
    t.fil.push({ qui: 'architecte', t: Date.now(), texte: draft.regression_de ? `Ticket ouvert : régression du #${draft.regression_de}.` : 'Ticket ouvert.' });
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
    if (Object.hasOwn(patch, 'validation')) throw new Error('La validation humaine se modifie seulement par une décision du Créateur.');
    if (patch.statut && !canTransition(t, patch.statut, note?.qui)) throw new Error(`Transition refusée : ${t.statut} → ${patch.statut}.`);
    if (patch.statut && note?.qui === 'createur') {
      t.validation = patch.statut === 'valide' ? { par: 'createur', t: Date.now() } : null;
    }
    Object.assign(t, patch, { maj: Date.now() });
    if (note) t.fil.push({ t: Date.now(), ...note });
    this.writeTicket(t);
    return t;
  }

  writeTicket(t) {
    writeJson(path.join(this.ticketDir(t), 'ticket.json'), t);
    fs.writeFileSync(path.join(this.ticketDir(t), 'ticket.md'), this.markdown(t));
  }

  markdown(t) {
    const who = { architecte: 'Architecte', createur: 'Créateur', atelier: 'Atelier', code: 'Code' };
    const l = t.lieu || {};
    const d = t.livraison;
    return [
      `# #${t.id} · ${CATEGORIES[t.categorie] || t.categorie} · Gravité ${t.gravite} · ${STATUS[t.statut] || t.statut}`,
      '',
      `**${t.titre}**`,
      '',
      t.en_clair ? `> En clair : ${t.en_clair}` : null,
      t.en_clair ? '' : null,
      `- Où : ${l.adresse || '?'} (${[l.x, l.y, l.z].map((v) => Math.round(v ?? 0)).join(', ')})`,
      l.lien ? `- Voir dans le jeu : ${l.lien}` : null,
      `- Version : ${t.version || '?'}`,
      `- Ouvert le ${stamp(t.ouvert)} par l’Architecte`,
      t.regression_de ? `- Régression du ticket #${t.regression_de}` : null,
      t.experience ? `- Expérience qui le prouve : ${t.experience}` : null,
      '',
      '## Constat', '', t.constat || '', '',
      '## Piste', '', t.piste || '', '',
      '## Photos', '', ...t.photos.map((p) => `![${p}](${p}.jpg)`), '',
      ...(t.apres.length ? ['## Après correction', '', ...t.apres.map((p) => `![${p}](${p}.jpg)`), ''] : []),
      ...(d ? ['## Livraison de l’atelier', '', d.resume || '', '', `Fichiers : ${(d.fichiers || []).join(', ') || '—'}`, '', `À vérifier : ${d.verifier?.etapes || '—'}`, `Attendu : ${d.verifier?.attendu || '—'}`, ''] : []),
      ...(t.commits.length ? ['## Commits', '', ...t.commits.map((c) => `- ${c.sha.slice(0, 7)} ${c.sujet}`), ''] : []),
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

// A ticket written by an earlier version gets the fields it lacks
function normalize(t) {
  t.photos ??= []; t.apres ??= []; t.fil ??= []; t.commits ??= []; t.sessions ??= [];
  t.en_clair ??= '';
  t.regression_de ??= null; t.experience ??= null; t.livraison ??= null; t.verification ??= null;
  t.validation = migrateValidation(t);
  return t;
}

function writeJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

export { BRAINS, CATEGORIES, Chantier, DEFAULT_BRAINS, EFFORTS, ROLES, STATUS, migrateBrains };
