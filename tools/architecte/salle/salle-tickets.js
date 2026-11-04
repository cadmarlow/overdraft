import { $, CATEGORY, S, STATUS, ago, chip, clock, day, el, emit, fill, gravityChip, issueChip, lightbox, money, on, post, showDiff, span, statusChip, ticketPhoto, toast } from './salle-core.js';

// Tickets: one list filtered by stage (to validate, at the workshop, to check, closed), the short list of what waits for
// the Creator on the Direct page, and the review of one ticket in full: its photos large (before and after side by side
// once it is fixed), its plain words, then the decision bar (what happens now and the moves that fit this stage, always
// in view), then the facts, the workshop's delivery, the commits and the thread. Like a triage queue: V validates, R and D
// open the reason, Enter confirms, and the next ticket waiting opens by itself.

const STAGES = [
  { id: 'valider', label: 'À valider', statuts: ['a_valider', 'plus'], empty: 'Rien à valider. Ses tickets arrivent ici pour que tu les valides.' },
  { id: 'atelier', label: 'À l’atelier', statuts: ['valide', 'atelier', 'echec'], empty: 'Aucun ticket à l’atelier.' },
  { id: 'verifier', label: 'À vérifier', statuts: ['corrige'], empty: 'Rien à vérifier : quand l’atelier corrige un ticket, il va le revoir sur place.' },
  { id: 'clos', label: 'Clos', statuts: ['verifie', 'rejete'], empty: 'Aucun ticket clos.' }
];
const PENDING = ['a_valider', 'plus'];
const R = { open: null, photo: 0, compare: false, stage: 'valider', compose: null };

// What the Creator can do at each stage: the state in words, then the moves, the main one first
function moves(t) {
  const auto = !!S.settings?.atelier;
  switch (t.statut) {
    case 'a_valider': return { pending: true, state: ['À toi de décider.', auto ? 'Valider l’envoie à l’atelier, qui le corrige aussitôt sans rien commiter.' : 'Valider le met dans la file de l’atelier.'], acts: ['valider', 'rejeter', 'plus'] };
    case 'plus': return { pending: true, state: ['Il retourne sur place pour préciser.', 'Tu peux déjà trancher.'], acts: ['valider', 'rejeter'] };
    case 'valide': return { state: ['Validé.', auto ? 'Il attend son tour à l’atelier.' : 'L’atelier est en manuel : lance-le quand tu veux.'], acts: [auto ? 'voir' : 'atelier', 'rejeter'] };
    case 'atelier': return { state: ['À l’atelier.', S.atelier?.enCours?.id === t.id ? 'Il le corrige en ce moment.' : 'Dans la file.'], acts: ['voir'] };
    case 'echec': return { state: ['L’atelier n’a pas réussi.', 'Relance-le, ou rejette le ticket.'], acts: ['atelier', 'rejeter'] };
    case 'corrige': return { state: ['Corrigé.', 'Il va le revérifier sur place, puis le clore.'], acts: ['atelier'] };
    case 'verifie': return { state: ['Vérifié et clos.', 'La correction tient.'], acts: ['rouvrir'] };
    case 'rejete': return { state: ['Rejeté.', 'Rouvre-le si tu changes d’avis.'], acts: ['rouvrir'] };
    default: return { state: [STATUS[t.statut] || t.statut, ''], acts: [] };
  }
}
const ACT = {
  valider: { label: 'Valider', key: 'V' },
  rejeter: { label: 'Rejeter', key: 'R' },
  plus: { label: 'Demander des précisions', key: 'D' },
  atelier: { label: (t) => ({ valide: 'Lancer l’atelier', corrige: 'Renvoyer à l’atelier' })[t.statut] || 'Relancer l’atelier' },
  rouvrir: { label: 'Rouvrir' },
  voir: { label: 'Voir l’atelier' }
};
// the two moves that ask for words first
const COMPOSE = {
  rejeter: { confirm: 'Rejeter le ticket', cls: 'reject', placeholder: 'Pourquoi ? Une phrase suffit, il en tire une règle sur tes goûts (facultatif).', hint: 'Entrée pour rejeter' },
  plus: { confirm: 'Envoyer la demande', cls: 'primary', placeholder: 'Que doit-il préciser ou rephotographier ?', hint: 'Entrée pour envoyer', required: true }
};
const DONE = {
  valider: (t) => `#${t.id} validé : ${S.settings?.atelier ? 'l’atelier le prend.' : 'il attend dans la file de l’atelier.'}`,
  rejeter: (t, why) => `#${t.id} rejeté.${why ? ' Il en tire une règle sur tes goûts.' : ''}`,
  plus: (t) => `#${t.id} : il retourne sur place.`,
  atelier: (t) => `#${t.id} envoyé à l’atelier.`,
  rouvrir: (t) => `#${t.id} rouvert : à toi de décider.`
};

function row(t, big = false) {
  const first = t.photos[0];
  const pending = PENDING.includes(t.statut);
  return el('div', { class: `trow click${big ? ' big' : ''}`, title: 'Ouvrir le ticket', onclick: () => openTicket(t.id) },
    first ? el('img', { src: ticketPhoto(t, first), alt: '', loading: 'lazy' }) : el('img', { alt: '' }),
    el('div', {},
      el('b', {}, t.titre),
      el('p', {}, t.en_clair || t.constat || ''),
      big ? el('div', { class: 'chips' }, chip('', `#${t.id}`), statusChip(t.statut), gravityChip(t.gravite), chip('', CATEGORY[t.categorie] || t.categorie), chip('', ago(t.maj))) : null),
    el('div', { class: 'acts', onclick: (e) => e.stopPropagation() },
      pending ? [
        el('button', { class: 'btn sm primary', onclick: () => decide('valider', t.id) }, 'Valider'),
        el('button', { class: 'btn sm reject', onclick: () => openTicket(t.id, 'rejeter') }, 'Rejeter')
      ] : el('button', { class: 'btn sm', onclick: () => openTicket(t.id) }, 'Ouvrir')));
}

// What waits for the Creator, oldest first (Direct)
function renderDecide() {
  const list = [...S.tickets.values()].filter((t) => PENDING.includes(t.statut)).sort((a, b) => a.ouvert - b.ouvert);
  fill($('decide-count'), list.length ? chip('warn', `${list.length} ticket${list.length > 1 ? 's' : ''}`) : null);
  fill($('decide-list'), list.length ? list.slice(0, 5).map((t) => row(t)) : el('p', { class: 'empty' }, 'Rien en attente. Quand il trouve un défaut, il te le propose ici.'));
}

function renderList() {
  const all = [...S.tickets.values()].sort((a, b) => b.ouvert - a.ouvert);
  const waiting = all.filter((t) => PENDING.includes(t.statut)).length;
  $('n-tickets').textContent = waiting;
  $('n-tickets').hidden = !waiting;
  fill($('ticket-filters'), STAGES.map((s) => {
    const n = all.filter((t) => s.statuts.includes(t.statut)).length;
    return el('button', { class: R.stage === s.id ? 'on' : '', onclick: () => { R.stage = s.id; renderList(); } }, s.label, n ? el('b', {}, n) : null);
  }));
  const stage = STAGES.find((s) => s.id === R.stage);
  const list = all.filter((t) => stage.statuts.includes(t.statut));
  fill($('ticket-list'), list.length ? list.map((t) => row(t, true)) : el('p', { class: 'empty' }, stage.empty));
  renderDecide();
}

// ---- The review -------------------------------------------------------------------------------------------------------
function openTicket(id, compose = null) {
  const t = S.tickets.get(id);
  if (!t) return;
  if (R.open !== id) $('r-text').value = '';
  R.open = id; R.photo = 0; R.compare = !!t.apres?.length; R.compose = compose;
  renderReview();
  $('review').hidden = false;
  if (compose) $('r-text').focus();
}

function closeTicket() { $('review').hidden = true; R.open = null; R.compose = null; }

const block = (label, ...content) => el('section', {}, el('span', { class: 'label' }, label), content);

function renderReview() {
  const t = S.tickets.get(R.open);
  if (!t) return;
  const shots = [...t.photos.map((p) => ({ p, when: 'avant' })), ...(t.apres || []).map((p) => ({ p, when: 'apres' }))];
  R.photo = Math.max(0, Math.min(R.photo, shots.length - 1));
  const figure = (s) => el('figure', {}, el('img', { src: ticketPhoto(t, s.p), alt: s.p, onclick: (e) => lightbox(e.target.src) }), el('figcaption', {}, chip(s.when === 'apres' ? 'ok' : '', s.when === 'apres' ? 'Après' : 'Avant')));
  if (R.compare && t.apres?.length && t.photos.length) fill($('r-stage'), figure(shots[0]), figure(shots.filter((s) => s.when === 'apres').at(-1)));
  else fill($('r-stage'), shots.length ? figure(shots[R.photo]) : el('p', { class: 'empty' }, 'Pas de photo.'));
  fill($('r-thumbs'), shots.map((s, i) => [
    i === t.photos.length && t.apres?.length ? chip('ok', 'Après') : null,
    el('img', { src: ticketPhoto(t, s.p), alt: s.p, class: !R.compare && i === R.photo ? 'on' : '', onclick: () => { R.photo = i; R.compare = false; renderReview(); } })
  ]), t.apres?.length ? el('button', { class: 'btn sm', onclick: () => { R.compare = !R.compare; renderReview(); } }, R.compare ? 'Une photo à la fois' : 'Avant / après') : null);

  fill($('r-chips'), chip('', `#${t.id}`), statusChip(t.statut), gravityChip(t.gravite), chip('', CATEGORY[t.categorie] || t.categorie), t.regression_de ? chip('err', `régression du #${t.regression_de}`) : null);
  $('r-title').textContent = t.titre;
  $('r-plain').textContent = t.en_clair || '';
  renderDecision(t);

  const l = t.lieu || {};
  const running = S.atelier?.enCours?.id === t.id;
  const d = t.livraison;
  fill($('r-sections'),
    block('Ce qu’il a constaté', el('p', {}, t.constat || '—')),
    block('Sa piste', el('p', {}, t.piste || '—')),
    block('Où', el('p', {}, `${l.adresse || '?'}, ouvert ${ago(t.ouvert)}, version ${t.version || '?'}. `, l.lien ? el('a', { href: l.lien, target: '_blank', rel: 'noopener' }, 'Revoir l’endroit dans le jeu') : null)),
    t.experience ? block('Son expérience', el('p', {}, `${t.experience} : il la rejouera pour vérifier la correction.`)) : null,
    d ? block('Ce que l’atelier a fait', el('p', {}, d.resume || ''),
      d.fichiers?.length ? el('ul', { class: 'files' }, d.fichiers.map((f) => el('li', {}, el('code', {}, f), d.session ? el('button', { class: 'btn sm', onclick: () => showDiff(f, d.session) }, 'Diff') : null))) : null,
      d.verifier ? el('p', { class: 'muted' }, `À vérifier : ${d.verifier.etapes}\nAttendu : ${d.verifier.attendu}`) : null,
      d.non_verifie ? el('p', { class: 'dim small' }, `Pas vérifié par l’atelier : ${d.non_verifie}`) : null) : null,
    t.statut === 'corrige' && t.verification ? block('Sa vérification', el('p', {}, { retourner: 'Il doit retourner sur place.', photographier: 'Il est sur place et rephotographie.', experience: 'Il rejoue l’expérience.', conclure: 'Photos d’après prises : il conclut.' }[t.verification.etape] || t.verification.etape)) : null,
    t.commits?.length ? block('Commits', el('ul', { class: 'commits' }, t.commits.map((c) => el('li', {}, el('code', {}, c.sha.slice(0, 7)), el('span', {}, c.sujet), el('span', {}, c.nomme ? 'cité' : 'ses fichiers'))))) : null,
    t.sessions?.length ? block('Sessions de l’atelier', el('ul', { class: 'commits' }, t.sessions.map((s) => el('li', {}, issueChip(s.issue), el('span', {}, `${day(s.debut)}, ${span(s.duree)}${s.cout != null ? `, ${money(s.cout)}` : ''}${s.tests ? `, tests ${s.tests.pass}/${s.tests.total}` : ''}`), el('a', { href: '#', onclick: (e) => { e.preventDefault(); emit('session', s.id); } }, 'Détail'))))) : null,
    t.atelierLog?.length ? block(running ? 'L’atelier, en direct' : 'Les étapes de l’atelier', el('ol', { class: 'ticker' }, t.atelierLog.slice(-120).map((s) => el('li', {}, el('time', {}, clock(s.t)), el('span', {}, s.texte))))) : null,
    block('Fil', el('ol', { class: 'fil' }, t.fil.map((f) => el('li', {}, el('b', {}, `${clock(f.t)} ${{ architecte: 'lui', createur: 'toi', atelier: 'atelier', code: 'code' }[f.qui] || f.qui}  `), String(f.texte).slice(0, 4000))))));
}

// The decision bar. The reason field is a fixed element, so what the Creator types survives the ticket's live updates.
function renderDecision(t) {
  const m = moves(t);
  if (R.compose && !m.acts.includes(R.compose)) R.compose = null;
  $('r-decide').classList.toggle('pending', !!m.pending);
  fill($('r-state'), el('b', {}, m.state[0]), m.state[1]);
  fill($('r-actions'),
    m.acts.map((name, i) => {
      const a = ACT[name];
      const cls = name === 'rejeter' ? 'reject' : i === 0 ? 'primary' : '';
      return el('button', { type: 'button', class: `btn ${cls}`, 'aria-expanded': COMPOSE[name] ? String(R.compose === name) : null, onclick: () => act(name) },
        typeof a.label === 'function' ? a.label(t) : a.label, a.key ? el('kbd', {}, a.key) : null);
    }),
    t.session ? el('button', { type: 'button', class: 'btn ghost', onclick: () => emit('session', t.session) }, 'Voir sa session de coding') : null);
  const c = R.compose && COMPOSE[R.compose];
  $('r-compose').hidden = !c;
  if (c) {
    $('r-text').placeholder = c.placeholder;
    $('r-confirm').textContent = c.confirm;
    $('r-confirm').className = `btn ${c.cls}`;
    $('r-hint').textContent = c.hint;
  }
}

function act(name) {
  if (name === 'voir') { closeTicket(); emit('show', 'atelier'); return; }
  if (COMPOSE[name]) {
    R.compose = R.compose === name ? null : name;
    renderDecision(S.tickets.get(R.open));
    if (R.compose) $('r-text').focus();
    return;
  }
  decide(name);
}

// One decision, from the review (with the reason typed there) or straight from a row of the list
async function decide(action, id = R.open) {
  const t = S.tickets.get(id);
  if (!t) return;
  const fromReview = id === R.open && !$('review').hidden;
  const texte = fromReview && R.compose === action ? $('r-text').value.trim() : '';
  if (COMPOSE[action]?.required && !texte) { $('r-text').focus(); return; }
  const r = await post('/salle/ticket', { id, action, texte });
  if (r && r.ok === false) { toast(r.texte || r.erreur || 'Décision refusée.'); return; }
  toast(DONE[action](t, texte));
  if (!fromReview) return;
  $('r-text').value = '';
  R.compose = null;
  // a triage queue: after a verdict, the next ticket waiting opens by itself
  const next = [...S.tickets.values()].filter((x) => x.id !== id && PENDING.includes(x.statut)).sort((a, b) => a.ouvert - b.ouvert)[0];
  if (['valider', 'rejeter', 'plus'].includes(action) && next) openTicket(next.id);
  else if (action === 'rouvrir') renderReview();
  else closeTicket();
}

function wire() {
  $('r-close').addEventListener('click', closeTicket);
  $('review').addEventListener('click', (e) => { if (e.target.id === 'review') closeTicket(); });
  $('r-decide').addEventListener('submit', (e) => { e.preventDefault(); if (R.compose) decide(R.compose); });
  $('r-cancel').addEventListener('click', () => { R.compose = null; renderDecision(S.tickets.get(R.open)); });
  $('r-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (R.compose) decide(R.compose); }
  });
  document.addEventListener('keydown', (e) => {
    if ($('review').hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (R.compose) { R.compose = null; renderDecision(S.tickets.get(R.open)); } else closeTicket();
      return;
    }
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    const t = S.tickets.get(R.open);
    const can = t ? moves(t).acts : [];
    const key = e.key.toLowerCase();
    if (e.key === 'ArrowLeft') { R.photo--; R.compare = false; renderReview(); }
    else if (e.key === 'ArrowRight') { R.photo++; R.compare = false; renderReview(); }
    else if (key === 'v' && can.includes('valider')) decide('valider');
    else if (key === 'r' && can.includes('rejeter')) { e.preventDefault(); act('rejeter'); }
    else if (key === 'd' && can.includes('plus')) { e.preventDefault(); act('plus'); }
  });
  on('tickets', () => { renderList(); if (R.open) renderReview(); });
  on('ticket', (t) => { if (R.open === t.id) renderReview(); });
  on('open-ticket', openTicket);
}

export { openTicket, renderDecide, renderList, wire };
