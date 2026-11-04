// The control room's shared state and small tools: the server's data as it streams in (S), a tiny event bus between
// the spaces, formatting, the posts back to the server, and the pieces every space draws (chips, card headers, diffs,
// sheets, the lightbox, the toast).

const params = new URLSearchParams(location.search);
const jeton = params.get('jeton') || '';
const withToken = (url) => (jeton ? `${url}${url.includes('?') ? '&' : '?'}jeton=${encodeURIComponent(jeton)}` : url);
const $ = (id) => document.getElementById(id);

const S = {
  settings: {}, modeles: {}, efforts: {}, roles: {}, statuts: {}, cerveau: {}, programme: null, jeu: {}, etat: null,
  tickets: new Map(), atelier: {}, sessions: [], code: null, conversation: [], journal: [], depenses: {}, seance: {},
  lieux: [], carte: null, memoire: null, profil: null, gouts: null, view: 'direct', lastLive: 0
};

// ---- A small bus: one space tells the others what changed ------------------------------------------------------------
const handlers = new Map();
const on = (name, fn) => { (handlers.get(name) || handlers.set(name, []).get(name)).push(fn); };
const emit = (name, data) => { for (const fn of handlers.get(name) || []) fn(data); };

// ---- Formatting --------------------------------------------------------------------------------------------------------
const clock = (t) => (t ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
const seconds = (t) => (t ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
const day = (t) => new Date(t).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const money = (v) => `${(v || 0).toFixed(2).replace('.', ',')} $`;
function ago(t) {
  if (!t) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
}
function span(s) {
  if (!Number.isFinite(s)) return '—';
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m < 60 ? `${m} min${r ? ` ${String(r).padStart(2, '0')}` : ''}` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

// ---- Words for the server's codes ---------------------------------------------------------------------------------------
const STATUS = { a_valider: 'À valider', plus: 'Précisions demandées', rejete: 'Rejeté', valide: 'Validé', atelier: 'À l’atelier', corrige: 'Corrigé, à vérifier', verifie: 'Vérifié', echec: 'Atelier en échec' };
const STATUS_TONE = { a_valider: 'warn', plus: 'warn', valide: 'info', atelier: 'info', corrige: 'him', verifie: 'ok', rejete: 'err', echec: 'err' };
const CATEGORY = { bug: 'Bug', art: 'Art', performance: 'Performance', gameplay: 'Gameplay', son: 'Son', outil: 'Ses outils' };
const ISSUE = { corrige: 'Corrigé', echec: 'Échec', arrete: 'Arrêté', decision: 'Décision demandée' };
const ISSUE_TONE = { corrige: 'ok', echec: 'err', arrete: '', decision: 'warn' };

// ---- Element building ------------------------------------------------------------------------------------------------
// el('li', { class: 'x', onclick }, 'text', child...): empty slots (null, false, '') are left out
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false && c !== '') node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

// replaceChildren, leaving out the empty slots (nested lists are flattened)
function fill(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== ''));
  return node;
}

const chip = (tone, text) => el('span', { class: `chip ${tone || ''}` }, text);
const statusChip = (statut) => chip(STATUS_TONE[statut], STATUS[statut] || statut);
const gravityChip = (g) => chip(g === 'critique' ? 'err' : g === 'haute' ? 'warn' : '', `gravité ${g}`);
const issueChip = (issue) => chip(ISSUE_TONE[issue], ISSUE[issue] || issue);
// a card's header strip: its label on the left, whatever follows on the right
const head = (label, ...right) => el('header', {}, el('span', { class: 'label' }, label), right.length ? el('div', { class: 'row' }, right) : null);

// ---- Posts back to the server ----------------------------------------------------------------------------------------
async function post(path, body) {
  try {
    const r = await fetch(withToken(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json();
  } catch { return { ok: false, texte: 'Le serveur de l’Architecte ne répond pas.' }; }
}
const command = (body) => post('/salle/commande', body);
async function getJson(path) {
  try { return await (await fetch(withToken(path))).json(); } catch { return null; }
}
async function getText(path) {
  try { return await (await fetch(withToken(path))).text(); } catch { return ''; }
}

let toastTimer = null;
function toast(text, ms = 4500) {
  if (!text) return;
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---- Photos, sheets, diffs ---------------------------------------------------------------------------------------------
const photoUrl = (id) => withToken(`/photos/${id}.jpg`);
const ticketPhoto = (t, p) => withToken(`/tickets/${encodeURIComponent(t.dir)}/${p}.jpg`);

function lightbox(src) { const l = $('lightbox'); l.querySelector('img').src = src; l.hidden = false; }

function sheet(title, body) {
  $('s-title').textContent = title;
  fill($('s-body'), body);
  $('sheet').hidden = false;
}

// A unified diff, coloured line by line
function diffView(text) {
  const pre = el('pre', { class: 'diff' });
  if (!text.trim()) { pre.append(el('span', {}, 'Aucune différence.')); return pre; }
  for (const line of text.replace(/\n$/, '').split('\n')) {
    if (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    const cls = line.startsWith('diff --git') ? 'f' : line.startsWith('@@') ? 'h' : line.startsWith('+') ? 'a' : line.startsWith('-') ? 'd' : '';
    pre.append(el('span', { class: cls }, line.startsWith('diff --git') ? line.replace(/^diff --git a\/(\S+) b\/\S+$/, '$1') : line || ' '));
  }
  return pre;
}

async function showDiff(file, session = null) {
  const text = await getText(`/salle/diff?fichier=${encodeURIComponent(file || '')}${session ? `&session=${session}` : ''}`);
  sheet(session ? `${file || 'Tous les fichiers'} : ce que la session a changé` : `${file} : ce qui n’est pas commité`, diffView(text));
}

// The name of a process from its command line ("Google Chrome", not "Google")
const processName = (command) => /\/([^/]+)\.app\//.exec(command)?.[1] || command.split(' ')[0].split('/').pop();

export {
  $, CATEGORY, ISSUE, S, STATUS, ago, chip, clock, command, day, diffView, el, emit, fill, getJson, getText, gravityChip, head, issueChip, jeton,
  lightbox, money, on, photoUrl, post, processName, seconds, sheet, showDiff, span, statusChip, ticketPhoto, toast, withToken
};
