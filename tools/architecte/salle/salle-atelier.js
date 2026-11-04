import { $, ISSUE, S, ago, chip, clock, command, day, el, emit, fill, head, issueChip, money, on, post, processName, sheet, showDiff, span, statusChip, toast } from './salle-core.js';
import { sessionList, sessionCommands, sessionFileReview } from './salle-sessions.js';

// The workshop: the session at work (its phase, its files, its tests, its steps as they come), the queue, the code as
// Git sees it (the branch, what is not committed, file by file and ticket by ticket, with diffs), the commit message it
// all adds up to, every session before; and a small status of it all for the Direct page.

const PHASES = [
  { label: 'Prépare', match: ['prépare', 'démarre'] },
  { label: 'Lit', match: ['lit', 'cherche', 'organise', 'délègue'] },
  { label: 'Modifie', match: ['modifie'] },
  { label: 'Teste', match: ['teste', 'lance'] },
  { label: 'Rend compte', match: ['rend compte'] }
];
let reached = { session: null, i: 0 };
let openSessionId = null;

const allSessions = () => sessionList(S.sessions, S.atelier?.enCours);
const sessionIssue = (session) => session.active ? chip('info', 'En cours') : issueChip(session.issue);

async function copyCommand(text) {
  try { await navigator.clipboard.writeText(text); toast('Commande copiée.'); }
  catch { toast('Sélectionne la commande ci-dessous pour la copier.'); }
}

function sessionAccess(id, active) {
  const commands = sessionCommands(id, location.port || '7780');
  if (!commands) return null;
  const text = active ? commands.suivre : commands.reprendre;
  return el('div', { class: 'session-access' },
    el('div', { class: 'row' }, el('b', {}, active ? 'Suivre dans le Terminal' : 'Reprendre dans Claude Code'),
      el('button', { class: 'btn sm', onclick: () => copyCommand(text) }, active ? 'Copier la commande de suivi' : 'Copier claude --resume')),
    el('pre', { class: 'session-command', tabindex: '0', 'aria-label': active ? 'Commande de suivi en lecture seule' : 'Commande de reprise Claude Code' }, text),
    el('p', { class: 'dim small' }, active
      ? 'À coller depuis la racine de gta-slop. Suit les étapes en lecture seule ; Ctrl-C quitte le suivi et laisse la correction continuer.'
      : 'À coller depuis la racine de gta-slop. Reprend cette conversation dans une nouvelle session interactive.'),
    active ? el('p', { class: 'dim small' }, 'Claude Code travaille sans interface interactive. Le suivi affiche ses étapes, outils et tests résumés ; la reprise sera disponible à la fin.') : null);
}

// The furthest phase the session in progress has reached (it never goes back on the screen)
function phase(now) {
  if (reached.session !== now.session) reached = { session: now.session, i: 0 };
  const i = /fiche de livraison/.test(now.derniere || '') ? 4 : PHASES.findIndex((p) => p.match.includes(now.phase));
  reached.i = Math.max(reached.i, i < 0 ? 0 : i);
  return reached.i;
}

function render() {
  renderNow();
  renderQueue();
  renderCode();
  renderCommit();
  renderHistory();
  if (openSessionId && !$('sheet').hidden && $('s-body').querySelector('[data-workshop-session]')) showSession(openSessionId);
  renderMini();
  const a = S.atelier || {};
  $('n-atelier').hidden = !a.enCours && !a.file?.length;
  $('n-atelier').textContent = a.enCours ? '1' : a.file?.length || '';
}

// The Direct page's small version: is it working, on what, where is it at
function renderMini() {
  const a = S.atelier || {}, now = a.enCours;
  if (!now) {
    const last = S.sessions?.[0];
    fill($('ws-mini'), head('Atelier', chip('', a.auto ? 'au repos' : 'manuel')),
      el('div', { class: 'body muted' }, a.file?.length ? `${a.file.length} ticket(s) attendent leur tour.` : a.auto ? 'Il corrigera seul chaque ticket que tu valides.' : 'Les tickets validés attendent : active l’atelier dans le Profil.',
        last ? el('p', { class: 'dim small', style: 'margin-top: 6px' }, `Dernière correction : #${last.ticket}, ${(ISSUE[last.issue] || last.issue).toLowerCase()} ${ago(last.fin)}.`) : null));
    return;
  }
  const i = phase(now);
  fill($('ws-mini'), head('Atelier', chip('info', 'au travail')),
    el('div', { class: 'body' }, el('b', {}, `#${now.id} ${now.titre}`),
      el('div', { class: 'progress' }, el('i', { style: `width: ${Math.round(((i + 0.5) / PHASES.length) * 100)}%` })),
      el('p', { class: 'muted small' }, `${PHASES[i].label}, depuis ${span((Date.now() - now.depuis) / 1000)}${now.tests ? `, tests ${now.tests.pass}/${now.tests.total}` : ''}. `, el('a', { href: '#', onclick: (e) => { e.preventDefault(); emit('show', 'atelier'); } }, 'Suivre'))));
}

function renderNow() {
  const a = S.atelier || {}, now = a.enCours;
  if (!now) {
    const last = S.sessions?.[0];
    fill($('ws-now'), head('En cours', el('button', { class: 'btn sm', onclick: () => command({ action: 'atelier', auto: !a.auto }) }, a.auto ? 'Passer en manuel' : 'Activer l’atelier')),
      el('div', { class: 'body' }, el('p', { class: 'big-line' }, 'L’atelier est au repos.'),
        el('p', { class: 'muted', style: 'margin-top: 4px' }, a.auto ? `Il prend seul chaque ticket que tu valides (${a.modele || 'Claude Opus 5.5'}, effort ${a.effort || 'xhigh'}). Il ne commite jamais.` : 'Mode manuel : les tickets validés attendent que tu l’actives.'),
        last ? el('p', { class: 'dim small', style: 'margin-top: 8px' }, `Dernière session : #${last.ticket} ${last.titre || ''}, ${(ISSUE[last.issue] || last.issue).toLowerCase()} ${ago(last.fin)}, en ${span(last.duree)}.`) : null));
    return;
  }
  const i = phase(now);
  const t = S.tickets.get(now.id);
  const files = now.fichiers || [];
  const tests = now.tests;
  fill($('ws-now'),
    head('En cours',
      el('button', { class: 'btn sm', onclick: () => emit('open-ticket', now.id) }, 'Voir le ticket'),
      el('button', { class: 'btn sm', onclick: () => showSession(now.session) }, 'Voir la session'),
      el('button', { class: 'btn sm danger', onclick: async () => { if (confirm(`Arrêter la session sur le ticket #${now.id} ? Ce qu’elle a déjà modifié reste sur le disque.`)) toast((await post('/salle/atelier', { action: 'arreter' })).ok ? 'Session arrêtée.' : 'Rien à arrêter.'); } }, 'Arrêter la session')),
    el('div', { class: 'body' },
      el('p', { class: 'big-line' }, `#${now.id} ${now.titre}`),
      el('p', { class: 'muted small', style: 'margin-top: 4px' }, `${a.modele || 'Claude Opus 5.5'}, effort ${a.effort || 'xhigh'}. ${now.derniere || ''}`),
      sessionAccess(now.session, true),
      el('div', { class: 'phases' }, PHASES.map((p, k) => el('div', { class: k < i ? 'done' : k === i ? 'here' : '' }, p.label))),
      el('div', { class: 'figs' },
        el('div', { class: 'fig' }, el('span', {}, 'Depuis'), el('b', { id: 'ws-elapsed' }, span((Date.now() - now.depuis) / 1000))),
        el('div', { class: 'fig' }, el('span', {}, 'Actions'), el('b', {}, now.outils || 0)),
        el('div', { class: 'fig' }, el('span', {}, 'Fichiers'), el('b', {}, files.length)),
        el('div', { class: `fig ${tests ? (tests.fail ? 'bad' : 'ok') : ''}` }, el('span', {}, 'Tests'), el('b', {}, tests ? `${tests.pass}/${tests.total}` : '—'))),
      el('div', { class: 'split' },
        el('div', {}, el('h4', {}, 'Fichiers qu’il modifie'), files.length ? el('ul', { class: 'files' }, files.map((f) => el('li', {}, el('code', {}, f), el('button', { class: 'btn sm', onclick: () => showDiff(f) }, 'Diff')))) : el('p', { class: 'dim small' }, 'Pas encore de modification.')),
        el('div', {}, el('h4', {}, 'Ce qu’il fait'), el('ol', { class: 'ticker' }, (t?.atelierLog || []).slice(-80).reverse().map((s) => el('li', {}, el('time', {}, clock(s.t)), el('span', {}, s.texte))))))));
}

function renderQueue() {
  const a = S.atelier || {};
  const queued = new Set((a.file || []).map((q) => q.id));
  const waiting = [...S.tickets.values()].filter((t) => t.statut === 'valide' && !queued.has(t.id) && a.enCours?.id !== t.id);
  fill($('ws-queue'), head('File d’attente'),
    el('div', { class: 'body' },
      a.file?.length ? el('ul', { class: 'queue' }, a.file.map((q, i) => el('li', {},
        el('span', {}, `${i + 1}. #${q.id} ${q.titre}`),
        el('button', { class: 'btn sm', 'aria-label': 'Monter', disabled: i === 0, onclick: () => post('/salle/atelier', { action: 'monter', id: q.id }) }, '↑'),
        el('button', { class: 'btn sm', 'aria-label': 'Descendre', disabled: i === a.file.length - 1, onclick: () => post('/salle/atelier', { action: 'descendre', id: q.id }) }, '↓'),
        el('button', { class: 'btn sm ghost', onclick: () => post('/salle/atelier', { action: 'retirer', id: q.id }) }, 'Retirer')))) : el('p', { class: 'dim small' }, a.enCours ? 'Rien après la session en cours.' : 'La file est vide.'),
      waiting.length ? el('div', { class: 'group' }, el('h4', {}, 'Validés, hors de la file'), el('ul', { class: 'queue' }, waiting.map((t) => el('li', {}, el('span', {}, `#${t.id} ${t.titre}`), el('button', { class: 'btn sm', onclick: () => post('/salle/atelier', { action: 'lancer', id: t.id }) }, 'Mettre en file'))))) : null));
}

// The code: the branch, then the uncommitted files grouped by the ticket whose session changed them
function renderCode() {
  const c = S.code;
  if (!c) { fill($('ws-code'), head('Le code'), el('p', { class: 'empty' }, 'Lecture de Git…')); return; }
  const files = c.fichiers || [];
  const byTicket = new Map();
  const loose = [];
  for (const f of files) {
    if (f.tickets?.length) for (const id of f.tickets) (byTicket.get(id) || byTicket.set(id, []).get(id)).push(f);
    else loose.push(f);
  }
  const fileRow = (f) => el('li', {}, el('code', {}, f.path), el('span', { class: 'meta2' }, f.statut), f.apres ? el('span', { class: 'meta2' }, 'puis modifié hors atelier') : null, el('button', { class: 'btn sm', onclick: () => showDiff(f.path) }, 'Diff'));
  const upstream = c.amont ? `${c.enAvance ? `${c.enAvance} commit(s) non poussé(s)` : 'à jour'} avec ${c.amont}${c.enRetard ? `, ${c.enRetard} en retard` : ''}` : 'branche locale';
  fill($('ws-code'), head('Le code', chip(files.length ? 'warn' : 'ok', files.length ? `${files.length} non commité(s)` : 'tout est commité')),
    el('div', { class: 'body' },
      el('div', { class: 'branch' }, chip('him', c.branche || '?'), chip('', c.head || ''), el('span', { class: 'dim small' }, upstream)),
      c.perime?.length ? el('p', { class: 'plain', style: 'margin-bottom: 14px' }, `Le jeu tourne sur du code périmé : ${c.perime.length} fichier(s) ont changé depuis son chargement (${c.perime.slice(0, 4).join(', ')}${c.perime.length > 4 ? '…' : ''}). Un rechargement l’applique.`) : null,
      [...byTicket].map(([id, list]) => {
        const t = S.tickets.get(id);
        return el('div', { class: 'group' }, el('h4', {}, el('a', { onclick: () => emit('open-ticket', id) }, `#${id} ${t?.titre || ''}`), t ? statusChip(t.statut) : null), el('ul', { class: 'files' }, list.map(fileRow)));
      }),
      loose.length ? el('div', { class: 'group' }, el('h4', {}, 'Hors atelier (toi ou une autre session)'), el('ul', { class: 'files' }, loose.map(fileRow))) : null,
      el('div', { class: 'group' }, el('h4', {}, 'Derniers commits'), el('ul', { class: 'commits' }, (c.commits || []).slice(0, 8).map((k) => el('li', {}, el('code', {}, k.sha), el('span', {}, k.sujet), el('span', {}, k.tickets?.length ? k.tickets.map((x) => `#${x}`).join(' ') : ago(k.t))))))));
}

// What the uncommitted work adds up to, as a commit message to copy (the Creator commits)
function commitMessage() {
  const c = S.code;
  if (!c?.fichiers?.length) return '';
  const ids = [...new Set(c.fichiers.flatMap((f) => f.tickets || []))].sort();
  const loose = c.fichiers.filter((f) => !f.tickets?.length);
  const lines = [ids.length ? `Corrections de l’Architecte : ${ids.map((id) => `#${id}`).join(', ')}` : 'Modifications en cours', ''];
  for (const id of ids) {
    const t = S.tickets.get(id);
    lines.push(`- #${id} ${t?.titre || ''}${t?.livraison?.resume ? ` : ${t.livraison.resume}` : ''}`, `  (${c.fichiers.filter((f) => f.tickets?.includes(id)).map((f) => f.path).join(', ')})`);
  }
  if (loose.length) lines.push(`- Autres fichiers : ${loose.map((f) => f.path).join(', ')}`);
  return lines.join('\n');
}

function renderCommit() {
  const text = commitMessage();
  const area = el('textarea', { class: 'commit-msg', 'aria-label': 'Message de commit proposé' });
  area.value = text;
  fill($('ws-commit'), head('Message de commit proposé', text ? el('button', { class: 'btn sm', onclick: () => navigator.clipboard?.writeText(area.value).then(() => toast('Message copié.'), () => toast('Copie impossible : sélectionne le texte.')) }, 'Copier') : null),
    el('div', { class: 'body' }, text ? area : el('p', { class: 'dim small' }, 'Rien à commiter.'), el('p', { class: 'dim small', style: 'margin-top: 8px' }, 'L’atelier ne commite jamais : c’est toi qui commites.')));
}

function renderHistory() {
  const list = allSessions(), active = list.filter(s => s.active).length;
  fill($('ws-history'), head('Sessions', chip(active ? 'info' : '', `${list.length} au total${active ? ` · ${active} en cours` : ''}`)),
    list.length ? el('div', { style: 'overflow-x: auto' }, el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, [['Quand', 'hide-s'], ['Ticket', ''], ['Issue', ''], ['Durée', 'num'], ['Coût', 'num'], ['Tests', 'num'], ['Fichiers', 'num']].map(([h, c]) => el('th', { class: c }, h)))),
      el('tbody', {}, list.map((s) => el('tr', { class: 'click', onclick: () => showSession(s.id) },
        el('td', { class: 'hide-s' }, day(s.debut)), el('td', {}, `#${s.ticket} ${s.titre || ''}`), el('td', {}, sessionIssue(s)),
        el('td', { class: 'num' }, span(s.duree)), el('td', { class: 'num' }, s.cout != null ? money(s.cout) : '—'),
        el('td', { class: 'num' }, s.tests ? `${s.tests.pass}/${s.tests.total}` : '—'), el('td', { class: 'num' }, sessionFileReview(s).known ? (s.fichiers || []).length : 'Non relevé')))))) : el('p', { class: 'empty' }, 'Aucune session lancée pour le moment.'));
}

function showSession(id) {
  const s = allSessions().find((x) => x.id === id) || [...S.tickets.values()].flatMap((t) => t.sessions || []).find((x) => x.id === id);
  if (!s) return;
  openSessionId = id;
  const t = S.tickets.get(s.ticket);
  const review = sessionFileReview(s);
  const report = s.rapport || t?.fil.filter((f) => f.qui === 'atelier' && f.t >= s.debut - 1000 && (!s.fin || f.t <= s.fin + 1000)).at(-1)?.texte || '';
  sheet(`Session ${s.active ? 'en cours ' : ''}sur le ticket #${s.ticket} ${s.titre || ''}`, el('div', { class: 'prose', 'data-workshop-session': id },
    el('div', { class: 'row' }, sessionIssue(s), chip('', day(s.debut)), chip('', span(s.duree)), s.cout != null ? chip('', money(s.cout)) : null, s.tests ? chip(s.tests.fail ? 'warn' : 'ok', `tests ${s.tests.pass}/${s.tests.total}`) : null),
    sessionAccess(id, s.active),
    s.active ? el('div', {}, el('span', { class: 'label' }, 'Étapes en direct'), el('ol', { class: 'ticker' }, (t?.atelierLog || []).slice(-80).reverse().map(e => el('li', {}, el('time', {}, clock(e.t)), el('span', {}, e.texte))))) : null,
    s.raison ? el('p', { class: 'muted' }, s.raison) : null,
    !s.active && s.attribution?.fiable !== true ? el('p', { class: 'plain' }, 'Attribution non prouvée : les fichiers ci-dessous sont les variations observées pendant la session. Ils peuvent inclure des modifications du Créateur.') : null,
    s.attribution?.conflits?.length ? el('p', { class: 'muted' }, s.attribution.conflits.join('\n')) : null,
    s.releve?.etat === 'partiel' ? el('p', { class: 'plain' }, `Relevé partiel : ${s.releve.raison || 'ces variations sont conservées pour examen, sans validation automatique.'}`) : null,
    s.refus ? el('p', { class: 'muted' }, `Écriture refusée : ${s.refus.outil} → ${s.refus.fichier}. ${s.refus.motif || ''}`) : null,
    s.resume ? el('p', { style: 'font-size: 16px' }, s.resume) : null,
    s.verifier ? el('p', { class: 'muted' }, `À vérifier : ${s.verifier.etapes}\nAttendu : ${s.verifier.attendu}`) : null,
    s.non_verifie ? el('p', { class: 'dim small' }, `Pas vérifié : ${s.non_verifie}`) : null,
    s.processus?.length ? el('p', { class: 'dim small' }, `Processus laissés et arrêtés : ${s.processus.map((p) => processName(p.commande)).join(', ')}.`) : null,
    el('span', { class: 'label' }, 'Fichiers'),
    (s.fichiers || []).length ? el('ul', { class: 'files' }, s.fichiers.map((f) => el('li', {}, el('code', {}, f.path), !s.active && Number.isFinite(f.plus) ? el('span', { class: 'plus' }, `+${f.plus}`) : null, !s.active && Number.isFinite(f.moins) ? el('span', { class: 'minus' }, `−${f.moins}`) : null, el('button', { class: 'btn sm', onclick: () => showDiff(f.path, s.active ? null : s.id) }, s.active ? 'Diff actuel' : 'Diff')))) : el('p', { class: 'dim small' }, review.empty),
    el('div', { class: 'row' },
      !s.active && (s.fichiers || []).length ? el('button', { class: 'btn', onclick: () => showDiff('', s.id) }, 'Tout le diff') : null,
      !s.active ? el('button', { class: 'btn', onclick: async () => toast((await post('/salle/session', { id: s.ticket, session: s.id })).texte) }, 'Rouvrir dans le Terminal') : null),
    !s.active && report ? el('span', { class: 'label' }, 'Compte rendu') : null,
    !s.active && report ? el('p', {}, report) : null));
}

function wire() {
  on('atelier', render);
  on('code', () => { renderCode(); renderCommit(); });
  on('tickets', render);
  on('session', showSession);
  setInterval(() => {
    const now = S.atelier?.enCours, e = $('ws-elapsed');
    if (now && e) e.textContent = span((Date.now() - now.depuis) / 1000);
    if (now) renderMini();
    if (now && S.view === 'atelier') renderHistory();
  }, 1000);
}

export { render, renderMini, wire };
