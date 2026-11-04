import { $, S, chip, clock, command, day, el, emit, fill, getJson, head, lightbox, money, on, photoUrl, sheet, toast } from './salle-core.js';
import { drawMap } from './salle-carte.js';

// His memory, laid open: the session in progress (what he saw, his conclusions), what he photographed of the city, his
// session reports, his experiments, what changed in the world as he heard it, his notebook. Read from /salle/memoire
// when the page opens and when he learns something.

let loading = null;

async function load() {
  if (loading) return loading;
  loading = getJson('/salle/memoire').then((m) => { if (m) S.memoire = m; loading = null; return m; });
  return loading;
}

const coverMap = () => drawMap($('cover-map'), { zoom: 'couverture', cover: true, programme: false });

async function render() {
  await load();
  const m = S.memoire;
  if (!m) return;
  const s = m.seance, st = s.stats || {};
  fill($('mem-seance'),
    head('La séance en cours', el('button', { class: 'btn sm', onclick: async () => { if (confirm('Clore la séance ? Il écrit son rapport, puis une nouvelle séance commence.')) { const result = await command({ action: 'seance' }); if (!result?.ok) { toast(result?.texte || 'La séance n’a pas été close.'); return; } toast('Séance close : son rapport s’écrit.'); setTimeout(refresh, 1500); } } }, 'Clore la séance')),
    el('div', { class: 'body' }, el('div', { class: 'figs', style: 'margin-bottom: 0' },
      el('div', { class: 'fig' }, el('span', {}, 'Depuis'), el('b', {}, clock(s.debut))),
      el('div', { class: 'fig' }, el('span', {}, 'Pensées'), el('b', {}, st.pensees || 0)),
      el('div', { class: 'fig' }, el('span', {}, 'Photos'), el('b', {}, st.photos || 0)),
      el('div', { class: 'fig' }, el('span', {}, 'Dépense'), el('b', {}, money(st.depense))))),
    s.observations?.length ? el('ol', { class: 'seen' }, s.observations.slice().reverse().map((o) => el('li', {},
      el('time', {}, clock(o.t)), o.lieu?.adresse ? el('span', { class: 'place' }, `${o.lieu.adresse} : `) : null, o.texte,
      o.photos?.length ? el('div', { class: 'shots' }, o.photos.slice(0, 4).map((p) => el('img', { src: photoUrl(p), alt: p, onclick: (e) => lightbox(e.target.src) }))) : null))) : el('p', { class: 'empty' }, 'Rien encore : ce qu’il voit s’inscrit ici à chaque étape de son programme.'));

  fill($('mem-rapports'), head('Rapports de séance'),
    m.rapports?.length ? el('ul', { class: 'reports' }, m.rapports.map((r) => el('li', { onclick: () => sheet(`Rapport de la séance ${r.id}`, el('div', { class: 'prose' }, r.texte)) }, r.texte.split('\n')[0].replace(/^#\s*/, '')))) : el('p', { class: 'empty' }, 'Son premier rapport s’écrit à la fin de cette séance (après une heure et demie sans activité, ou avec « Clore la séance »).'));

  fill($('mem-experiences'), head('Expériences'),
    m.experiences?.length ? el('ul', { class: 'reports' }, m.experiences.map((e) => el('li', { onclick: () => showExperience(e) },
      el('div', { class: 'row' }, chip('', e.id), el('b', {}, ({ crash: 'Crash', explosion: 'Explosion', bordure: 'Bordure', nuit: 'Nuit' })[e.type] || e.type), chip(e.validite === 'valide' ? 'ok' : 'warn', ({ valide: 'Valide', perturbee: 'Perturbée', incomplete: 'Incomplète' })[e.validite] || 'Référence ancienne'), el('span', { class: 'dim small' }, `${day(e.t)}${e.refait ? `, rejoue ${e.refait}` : ''}`)),
      el('ul', { class: 'measures' }, Object.entries(e.mesures || {}).slice(0, 5).map(([k, v]) => el('li', {}, `${k.replace(/_/g, ' ')} `, el('b', {}, String(v)))))))) : el('p', { class: 'empty' }, 'Aucune expérience : il en lance quand il tient la caméra, pour prouver un défaut de voiture, d’explosion ou de trottoir.'));

  fill($('mem-changes'), head('Ce qu’il a appris du monde'),
    m.changements?.length ? el('ol', { class: 'seen' }, m.changements.map((c) => el('li', {}, el('time', {}, day(c.t)), c.texte))) : el('p', { class: 'empty' }, 'Rien encore : tes commits, les livraisons de l’atelier et tes décisions s’inscrivent ici.'));

  fill($('mem-carnet'), head('Son carnet'),
    m.carnet?.length ? el('ol', { class: 'seen' }, m.carnet.slice().reverse().map((n) => el('li', {}, n.replace(/^- /, '')))) : el('p', { class: 'empty' }, 'Carnet vide.'));

  const cells = m.couverture || [];
  $('cover-legend').textContent = cells.length ? `${cells.length} zones de 100 m, ${cells.reduce((a, c) => a + c.n, 0)} photos dont ${cells.reduce((a, c) => a + c.nuit, 0)} de nuit. Plus c’est vif, plus il y est passé ; le coin blanc marque la nuit.` : 'Il n’a encore rien photographié.';
  coverMap();
}

function showExperience(e) {
  sheet(`Expérience ${e.id} : ${e.type}`, el('div', { class: 'prose' },
    chip(e.validite === 'valide' ? 'ok' : 'warn', ({ valide: 'Preuve valide', perturbee: 'À reprendre : mesure perturbée', incomplete: 'À reprendre : expérience incomplète' })[e.validite] || 'Ancienne référence : protocole à rétablir'),
    e.raisons?.length ? el('p', { class: 'muted' }, e.raisons.join('\n')) : null,
    el('p', {}, e.resume || ''),
    el('ul', { class: 'measures' }, Object.entries(e.mesures || {}).map(([k, v]) => el('li', {}, `${k.replace(/_/g, ' ')} `, el('b', {}, String(v))))),
    e.photos?.length ? el('div', { class: 'row' }, e.photos.map((p) => el('img', { src: photoUrl(p), alt: p, style: 'width: 240px; border-radius: 6px; cursor: zoom-in', onclick: (ev) => lightbox(ev.target.src) }))) : null,
    el('p', { class: 'dim small' }, `Réglages : ${JSON.stringify(e.params)}`),
    e.protocole ? el('p', { class: 'dim small' }, `Protocole : ${JSON.stringify(e.protocole)}`) : null));
}

let timer = null;
function refresh() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    S.memoire = null;
    if (S.view === 'memoire') render(); else { await load(); emit('map'); }
  }, 800);
}

function wire() {
  on('memoire', refresh);
  on('view', (v) => { if (v === 'memoire') render(); });
  window.addEventListener('resize', () => { if (S.view === 'memoire') coverMap(); });
}

export { load, refresh, render, wire };
