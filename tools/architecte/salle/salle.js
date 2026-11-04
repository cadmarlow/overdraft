import { $, S, chip, clock, command, el, emit, fill, lightbox, money, on, photoUrl, seconds, toast, withToken } from './salle-core.js';
import { drawMap, ticketAt } from './salle-carte.js';
import * as tickets from './salle-tickets.js';
import * as atelier from './salle-atelier.js';
import * as profil from './salle-profil.js';
import * as memoire from './salle-memoire.js';

// The control room. The top bar: who he is, the switch (on, off), the five pages, the game and the spending. Direct:
// what he is doing now in one sentence and who holds the camera, then what he sees, his programme, his feed, the
// conversation, what waits for the Creator, the workshop and the map. Everything comes from the server's event stream
// (/salle/flux); the Creator's words and decisions go back as small posts.

const KINDS = { pensee: 'pense', action: 'action', mesure: 'mesure', parole: 'dit', photo: 'photo', evenement: 'jeu', ticket: 'ticket', createur: 'toi', atelier: 'atelier', code: 'code', systeme: 'système', memoire: 'mémoire' };
const MODEL_SHORT = { vif: 'Haiku', equilibre: 'Sonnet', maximal: 'Opus' };
let filter = null;
let mapZoom = 'pres';
let mapView = null;

// ---- The stream -------------------------------------------------------------------------------------------------------
function connect() {
  const es = new EventSource(withToken('/salle/flux'));
  const sub = (type, fn) => es.addEventListener(type, (e) => fn(JSON.parse(e.data)));
  sub('snapshot', (s) => {
    Object.assign(S, { settings: s.settings, modeles: s.modeles, efforts: s.efforts, roles: s.roles, statuts: s.statuts, cerveau: s.cerveau, programme: s.programme,
      jeu: s.jeu, etat: s.etat, atelier: s.atelier, sessions: s.sessions, code: s.code, conversation: s.conversation, depenses: s.depenses, seance: s.seance,
      lieux: s.lieux, carte: s.carte, profil: s.profil, gouts: s.gouts, connected: true });
    S.tickets = new Map(s.tickets.map((t) => [t.id, t]));
    S.bounds = null;
    $('journal').replaceChildren();
    S.journal = [];
    for (const e of s.journal) addEntry(e);
    if (s.live) showLive(s.live);
    renderAll();
    memoire.load().then(() => drawDirectMap());
  });
  sub('journal', (e) => { if (e) addEntry(e); });
  sub('statut', (c) => { S.cerveau = c; S.programme = c.programme ?? S.programme; renderTop(); renderNow(); renderTalkState(); emit('profil'); });
  sub('reglages', (s) => { S.settings = s; renderTop(); renderNow(); atelier.render(); emit('profil'); });
  sub('etat', (etat) => { S.etat = etat; renderTop(); renderNow(); renderLive(); drawDirectMap(); });
  sub('live', ({ n }) => showLive(n));
  sub('ticket', (t) => { S.tickets.set(t.id, t); emit('tickets'); emit('ticket', t); drawDirectMap(); });
  sub('atelier', (a) => { S.atelier = a; emit('atelier'); });
  sub('atelierlog', ({ id, entry }) => {
    const t = S.tickets.get(id);
    if (!t) return;
    t.atelierLog = [...(t.atelierLog || []), entry];
    emit('ticket', t);
    if (S.view === 'atelier') atelier.render();
  });
  sub('session', (s) => { S.sessions = [s, ...(S.sessions || []).filter((x) => x.id !== s.id)]; atelier.render(); });
  sub('code', (c) => { S.code = c; emit('code'); });
  sub('jeu', (j) => { S.jeu = { ...S.jeu, ...j }; if (!j.connected) S.etat = null; renderTop(); renderNow(); renderLive(); });
  sub('carte', ({ lieux, carte }) => { S.lieux = lieux; S.carte = carte; S.bounds = null; drawDirectMap(); });
  sub('conversation', (e) => { if (!e) return; S.conversation = [...S.conversation, e].slice(-200); renderTalk(); });
  sub('programme', (p) => { S.programme = p; renderNow(); drawDirectMap(); });
  sub('gouts', (g) => { S.gouts = g; emit('profil'); });
  sub('memoire', () => memoire.refresh());
  sub('couverture', () => memoire.refresh());
  sub('experience', () => memoire.refresh());
  es.onerror = () => { S.connected = false; renderTop(); };
  es.onopen = () => { S.connected = true; };
}

function renderAll() {
  renderTop(); renderNow(); renderLive(); renderTalk(); renderTalkState();
  tickets.renderList(); atelier.render(); drawDirectMap();
  if (S.view === 'profil') profil.render();
}

const isOn = () => !!S.settings?.allume;

// ---- The top bar and what stops him ------------------------------------------------------------------------------------
function renderTop() {
  const a = S.etat?.architecte, j = S.jeu || {}, c = S.cerveau || {};
  const role = c.roles?.pensee;
  $('who-sub').textContent = `v${S.profil?.version || 2}${role ? ` · ${MODEL_SHORT[role.modele] || role.modeleLabel}, ${role.effortLabel.toLowerCase()}` : ''}`;
  const power = $('power');
  power.classList.toggle('on', isOn());
  power.setAttribute('aria-pressed', String(isOn()));
  $('power-label').textContent = isOn() ? 'Allumé' : 'Éteint';
  power.disabled = !S.connected;
  const voice = $('voice-toggle');
  voice.textContent = S.settings.voix ? 'Couper la voix' : 'Voix coupée';
  voice.setAttribute('aria-pressed', String(!!S.settings.voix));
  voice.title = S.settings.voix ? 'Couper immédiatement la voix de l’Architecte' : 'Activer la voix de l’Architecte';
  voice.disabled = !S.connected;
  fill($('meta-jeu'), el('i', { class: `dot ${!S.connected ? 'err' : j.connected ? 'ok' : 'warn'}` }), !S.connected ? 'Serveur injoignable' : j.connected ? `Jeu relié${S.etat?.monde?.fps ? `, ${S.etat.monde.fps} i/s` : ''}` : 'Jeu non relié');
  const uncertain = c.depense_estimee || 0, reserved = c.reserve || 0;
  $('meta-depense').textContent = `${money(c.depense)} / ${money(c.plafond)}${uncertain ? ` + ${money(uncertain)} incertains` : ''}${reserved ? ` · ${money(reserved)} réservés` : ''}`;
  $('meta-depense').title = 'La dépense mesurée, les requêtes interrompues dont le coût est inconnu et les réserves des appels en cours comptent tous pour le plafond.';
  // one line, only when something stops him, with the way out
  const tab = S.etat?.onglet;
  let text = '', action = null;
  if (!S.connected) text = 'Le serveur de l’Architecte ne répond plus : relance-le dans son terminal (npm run architecte).';
  else if (!c.cle) text = 'Sa clé API est absente : colle-la dans .env.local à la racine du jeu, puis relance le serveur.';
  else if (isOn() && !j.connected) text = 'Aucun jeu n’est relié : ouvre le jeu avec ?architecte_port= suivi du port de ce serveur dans l’adresse.';
  else if (isOn() && c.pause?.startsWith('plafond')) { text = `${c.pause}. Dépense mesurée ${money(c.depense)}${uncertain ? `, jusqu’à ${money(uncertain)} incertains` : ''}.`; action = el('button', { class: 'btn sm', onclick: () => show('profil') }, 'Voir le budget'); }
  else if (isOn() && tab && !tab.visible && !a?.spectating) { text = 'L’onglet du jeu est caché : la partie est en pause, lui aussi. Donne-lui la caméra pour qu’il continue sans toi.'; action = el('button', { class: 'btn sm', onclick: () => setCamera('lui') }, 'Lui donner la caméra'); }
  else if (isOn() && tab && !tab.lance) text = 'Le jeu est sur l’écran titre : clique ENTRER DANS LA VILLE.';
  else if (isOn() && tab?.pause) text = 'Le jeu est sur le menu pause : tout est arrêté.';
  fill($('alert'), el('span', {}, text), action);
  $('alert').hidden = !text;
}

// ---- What he is doing now, in words a person would use ------------------------------------------------------------------
const short = (place) => String(place || '').split(' · ')[0];
const VERB = { 'à pied': 'Il marche vers', voiture: 'Il roule vers', 'hélico': 'Il vole vers' };

function nowSentence(a, p) {
  if (!a?.alive) return a?.respawnIn != null ? `Il est hors service : il revient dans ${a.respawnIn} s` : 'Il entre dans la partie…';
  if (a.fighting) return a.intent === 'Te prend en chasse' ? 'Il te prend en chasse' : 'Il riposte : tu l’as attaqué';
  if (p?.active) {
    const step = p.etapes?.[p.etape - 1];
    const what = step ? step.quoi.charAt(0).toLowerCase() + step.quoi.slice(1) : '';
    if (p.enCours === 'photographie') return `Il photographie ${step?.label ? `${step.label} : ` : ''}${what}`;
    if (p.enCours === 'juge') return `Il regarde ses photos : ${what}`;
    if (p.enCours === 'en route' && step) return `${VERB[a.mode] || 'Il va vers'} ${step.label || short(a.address)} : ${what}`;
  }
  const i = a.intent || '';
  let m;
  if (i === 'Te suit') return 'Il te suit';
  if ((m = /^En route vers (.+?) (à pied|en voiture|en hélico)$/.exec(i))) return `${{ 'à pied': 'Il marche vers', 'en voiture': 'Il roule vers', 'en hélico': 'Il vole vers' }[m[2]]} ${short(m[1])}`;
  if ((m = /^Inspecte (.+)$/.exec(i))) return `Il inspecte ${short(m[1])}`;
  if ((m = /^Expérience : (.+)$/.exec(i))) return `Il fait une expérience : ${m[1]}`;
  return `Il observe les alentours${a.address ? `, ${short(a.address)}` : ''}`;
}

function renderNow() {
  const on = isOn();
  $('off').hidden = on;
  $('on').hidden = !on;
  const a = S.etat?.architecte, c = S.cerveau || {}, p = S.programme, w = S.etat?.monde, j = S.jeu || {};
  if (!on) {
    $('off-note').textContent = !S.connected ? 'Le serveur ne répond pas.' : j.connected ? 'Un jeu est relié : il y entrera dès que tu l’allumes.' : 'Aucun jeu n’est relié pour l’instant : il entrera dans le prochain que tu ouvres.';
    $('b-on').disabled = !S.connected;
    $('talk-text').disabled = true;
    $('talk-text').placeholder = 'Allume-le pour lui parler.';
    return;
  }
  $('talk-text').disabled = false;
  $('talk-text').placeholder = 'Écris-lui…';
  const h1 = $('now');
  h1.className = '';
  const tab = S.etat?.onglet;
  if (!j.connected) h1.textContent = 'Il attend qu’un jeu se relie';
  else if (tab && !tab.lance) h1.textContent = 'Il entrera dès que tu lanceras la partie';
  else if (tab?.pause && !a?.alive) h1.textContent = 'Il entrera dès que tu reprendras la partie';
  else if (!a?.present) h1.textContent = 'Il entre dans la partie…';
  else h1.textContent = nowSentence(a, p);
  fill($('now-chips'),
    tab?.pause ? chip('warn', 'partie en pause') : null,
    c.parle ? chip('him', 'il te répond') : c.occupe ? chip('him', 'il réfléchit') : null,
    !c.actif && c.cle && !c.pause?.startsWith('plafond') && c.pause !== 'éteint' ? chip('warn', `en pause${c.pause ? ` : ${c.pause}` : ''}`) : null,
    p?.active && c.cle ? chip('lime', `Programme · étape ${p.etape} sur ${p.total}`) : null,
    a?.present && a.address ? chip('', short(a.address)) : null,
    w ? chip('', `${w.heure} · ${w.meteo.toLowerCase()}`) : null);
  // who holds the camera
  const him = !!a?.spectating;
  for (const b of $('cam').children) {
    b.classList.toggle('on', (b.dataset.qui === 'lui') === him);
    b.disabled = !j.connected || !a?.present;
  }
  $('cam-note').textContent = !a?.present ? 'Il doit d’abord être dans la partie.' : him ? 'Il va où il veut dans la ville. Ton personnage l’attend à l’abri, intouchable.' : 'Tu joues. Il travaille à moins de 350 m de toi et ne te gêne pas.';
  // his programme
  const steps = p?.etapes || [];
  const here = p?.active ? p.etape - 1 : steps.length;
  $('prog-subject').textContent = p?.sujet || '';
  $('prog-subject').hidden = !steps.length || !p?.sujet;
  fill($('prog-steps'), steps.map((s, i) => el('li', { class: i < here ? 'done' : i === here ? 'here' : '' },
    el('span', { class: 'ic' }, i < here ? '✓' : i + 1), el('span', {}, s.quoi),
    el('small', {}, i === here && p.enCours ? { 'en route': 'il s’y rend', photographie: 'il photographie', juge: 'il juge' }[p.enCours] || '' : s.photos?.length ? `${s.photos.length} photo${s.photos.length > 1 ? 's' : ''}` : s.label || ''))));
  $('prog-empty').hidden = !!steps.length;
  $('prog-steps').hidden = !steps.length;
  $('b-prog-stop').hidden = !p?.active;
}

async function setPower(on) {
  $('power').disabled = true;
  const r = await command({ action: 'allumer', on });
  if (r?.ok === false) { $('power').disabled = false; toast(r.texte || r.erreur || 'Le changement a échoué.'); return; }
  toast(on ? 'Allumé : il entre dans ta partie.' : 'Éteint : il quitte ta partie et ne lance plus de requête.');
}

async function setCamera(qui) {
  const r = await command({ action: 'camera', qui });
  if (r && r.ok === false) toast(r.texte || 'Le jeu a refusé.');
}

// ---- What he sees -----------------------------------------------------------------------------------------------------
function showLive(n) {
  const img = new Image();
  img.onload = () => {
    const live = $('live');
    live.src = img.src;
    live.hidden = false;
    live.classList.remove('stale');
    $('live-empty').hidden = true;
    S.lastLive = Date.now();
  };
  img.src = withToken(`/salle/live.jpg?n=${n}`);
}
setInterval(() => { if (S.lastLive && Date.now() - S.lastLive > 6000) $('live').classList.add('stale'); }, 2000);

function renderLive() {
  const a = S.etat?.architecte, w = S.etat?.monde;
  $('live-where').textContent = a?.present ? `${a.spectating ? 'Sa caméra' : 'Ta caméra'} · ${short(a.address)}` : '';
  $('live-where').hidden = !a?.present;
  $('live-fps').textContent = w ? `${w.fps} i/s` : '';
  $('live-fps').hidden = !w;
}

// ---- His feed -----------------------------------------------------------------------------------------------------------
function addEntry(e) {
  S.journal.push(e);
  if (S.journal.length > 600) S.journal.shift();
  const list = $('journal');
  list.prepend(entry(e));
  while (list.children.length > 600) list.lastChild.remove();
  if (e.kind === 'ticket' || e.kind === 'atelier' || e.kind === 'code') tickets.renderList();
}

function entry(e) {
  const ticket = e.data?.id && /^\d{4}$/.test(e.data.id) ? e.data.id : null;
  const li = el('li', { class: `${e.kind}${ticket ? ' clickable' : ''}`, 'data-kind': e.kind, onclick: ticket ? () => tickets.openTicket(ticket) : null },
    el('time', {}, seconds(e.t)), el('span', { class: 'k' }, KINDS[e.kind] || e.kind));
  const t = el('div', { class: 't' }, e.text);
  const photos = e.data?.id && /^p\d{5}$/.test(e.data.id) ? [e.data.id] : e.data?.photos || [];
  if (photos.length) t.append(el('div', { class: 'thumbs' }, photos.map((p) => el('img', { src: photoUrl(p), alt: p, loading: 'lazy', onclick: (ev) => { ev.stopPropagation(); lightbox(ev.target.src); } }))));
  const more = e.data?.rapport || e.data?.resultat;
  if (more && more !== e.text) t.append(el('details', {}, el('summary', {}, e.data.rapport ? 'compte rendu' : 'résultat'), el('p', {}, more)));
  li.append(t);
  if (filter && !filter.includes(e.kind)) li.hidden = true;
  return li;
}

function applyFilter() {
  for (const li of $('journal').children) li.hidden = !!filter && !filter.includes(li.dataset.kind);
}

// ---- The conversation -------------------------------------------------------------------------------------------------
function renderTalk() {
  const list = $('talk-thread');
  const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  // the photos he names in an answer are shown with it
  const shots = (e) => (e.qui === 'architecte' ? [...new Set(String(e.texte).match(/\bp\d{5}\b/g) || [])].slice(0, 4) : []);
  fill(list, S.conversation.slice(-80).map((e) => el('div', { class: `msg ${e.qui}` },
    el('div', { class: 'who2' }, e.qui === 'createur' ? 'Toi' : 'Lui', el('small', {}, `${clock(e.t)}${e.canal === 'jeu' ? ' · jeu' : ''}`)),
    el('div', { class: 'text' }, e.texte, shots(e).length ? el('div', { class: 'shots' }, shots(e).map((p) => el('img', { src: photoUrl(p), alt: p, loading: 'lazy', onclick: (ev) => lightbox(ev.target.src) }))) : null))));
  if (!S.conversation.length) list.append(el('p', { class: 'dim small' }, 'Écris-lui ici, ou dans le jeu avec la touche K. Il te répond en quelques secondes, même s’il est occupé.'));
  if (stick || !list.dataset.seen) { list.scrollTop = list.scrollHeight; list.dataset.seen = '1'; }
}

function renderTalkState() {
  const c = S.cerveau || {};
  const s = $('talk-state');
  s.textContent = c.parle ? 'il écrit' : 'il répond en quelques secondes';
  s.className = `small ${c.parle ? 'typing' : 'dim'}`;
  s.style.color = c.parle ? 'var(--him)' : '';
}

async function sendTalk() {
  const area = $('talk-text');
  const text = area.value.trim();
  if (!text || area.disabled) return;
  area.value = '';
  area.style.height = '';
  const r = await command({ action: 'message', texte: text });
  if (r?.ok === false) { area.value = text; toast(r.texte || r.erreur || 'Le message n’a pas été envoyé.'); }
}

// ---- The map ------------------------------------------------------------------------------------------------------------
function drawDirectMap() {
  if (S.view !== 'direct' || !isOn()) return;
  mapView = drawMap($('map'), { zoom: mapZoom, cover: true, programme: true });
}

// ---- Pages ----------------------------------------------------------------------------------------------------------------
const VIEWS = ['direct', 'tickets', 'atelier', 'profil', 'memoire'];
function show(view) {
  S.view = view;
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.view === view);
  for (const v of VIEWS) $(`v-${v}`).hidden = v !== view;
  if (view === 'direct') drawDirectMap();
  if (view === 'atelier') atelier.render();
  if (view === 'tickets') tickets.renderList();
  emit('view', view);
  window.scrollTo(0, 0);
  try { localStorage.setItem('salle:vue', view); } catch { /* storage off */ }
}

// ---- Wiring --------------------------------------------------------------------------------------------------------------
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => show(b.dataset.view));
$('power').addEventListener('click', () => setPower(!isOn()));
$('b-on').addEventListener('click', () => setPower(true));
$('voice-toggle').addEventListener('click', async () => {
  const on = !S.settings.voix;
  $('voice-toggle').disabled = true;
  const r = await command({ action: 'voix', voix: on });
  if (r?.ok === false) { renderTop(); toast(r.texte || 'Le réglage de la voix a échoué.'); return; }
  S.settings.voix = on;
  renderTop();
  toast(on ? 'Voix activée.' : 'Voix coupée ; les sous-titres restent visibles.');
});
for (const b of $('cam').children) b.addEventListener('click', () => { if (!b.classList.contains('on')) setCamera(b.dataset.qui); });
$('feed-filters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kinds]');
  if (!b) return;
  filter = b.dataset.kinds === 'all' ? null : b.dataset.kinds.split(',');
  for (const x of $('feed-filters').children) x.classList.toggle('on', x === b);
  applyFilter();
});
$('talk-form').addEventListener('submit', (e) => { e.preventDefault(); sendTalk(); });
$('talk-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendTalk(); } });
$('talk-text').addEventListener('input', (e) => { e.target.style.height = ''; e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`; });
$('b-prog-stop').addEventListener('click', async () => { await command({ action: 'programme', arreter: true }); toast('Programme arrêté : il en choisira un autre.'); });
$('map-zoom').addEventListener('click', (e) => {
  const b = e.target.closest('[data-zoom]');
  if (!b) return;
  mapZoom = b.dataset.zoom;
  for (const x of $('map-zoom').children) x.classList.toggle('on', x === b);
  drawDirectMap();
});
$('map').addEventListener('click', (e) => { const t = ticketAt(mapView, e, $('map')); if (t) tickets.openTicket(t.id); });
$('s-close').addEventListener('click', () => { $('sheet').hidden = true; });
$('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') $('sheet').hidden = true; });
$('lightbox').addEventListener('click', () => { $('lightbox').hidden = true; });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('lightbox').hidden) $('lightbox').hidden = true;
  else if (!$('sheet').hidden) $('sheet').hidden = true;
});
window.addEventListener('resize', drawDirectMap);
on('map', drawDirectMap);
on('tickets', drawDirectMap);
on('show', show);

tickets.wire();
atelier.wire();
profil.wire();
memoire.wire();
try { const v = localStorage.getItem('salle:vue'); if (VIEWS.includes(v)) show(v); } catch { /* storage off */ }
connect();
