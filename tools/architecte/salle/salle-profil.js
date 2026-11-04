import { $, S, chip, command, el, emit, fill, money, on, toast } from './salle-core.js';

// Who he is: his card (version, record), his mission and character, what guides him, the Creator's tastes as he
// understood them (editable: a rule he got wrong is deleted here), his brain's settings, his tools.

let editing = null; // the rules being edited, or null

const MODEL_SHORT = { vif: 'Haiku', equilibre: 'Sonnet', maximal: 'Opus' };
const EFFORT_SHORT = { low: 'Bas', medium: 'Moyen', high: 'Haut', xhigh: 'Très haut', max: 'Max' };
const ROLE_HINT = { pensee: 'Son travail : regarder, juger, décider.', parole: 'Ses réponses quand tu lui parles.', relecture: 'Sa relecture de chaque ticket avant qu’il te le montre.' };

function render() {
  const p = S.profil;
  if (!p) return;
  const c = p.chiffres || {};
  const since = p.depuis ? new Date(p.depuis).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : null;
  fill($('prof-id'),
    el('span', { class: 'avatar', 'aria-hidden': 'true' }, 'A'),
    el('div', {}, el('h1', {}, 'L’Architecte'), el('p', { class: 'muted', style: 'margin-top: 4px' }, p.presentation)),
    el('div', { class: 'kv' },
      el('span', {}, 'Version'), el('span', {}, `v${p.version}${since ? `, depuis le ${since}` : ''}`),
      el('span', {}, 'Séances'), el('span', {}, c.seances ?? '—'),
      el('span', {}, 'Tickets'), el('span', {}, `${c.tickets ?? 0} proposé${c.tickets > 1 ? 's' : ''}, ${c.clos ?? 0} vérifié${c.clos > 1 ? 's' : ''}`),
      el('span', {}, 'Photos'), el('span', {}, c.photos ?? 0),
      el('span', {}, 'Dépense'), el('span', {}, `${money(c.depense)} au total`)),
    el('button', { class: 'btn', onclick: () => emit('show', 'memoire') }, 'Voir sa mémoire'));

  fill($('prof-main'),
    section('Sa mission', el('p', {}, p.mission)),
    section('Son caractère', el('p', {}, p.caractere)),
    section('Ce qui le guide', el('ol', { class: 'list' }, (p.principes || []).map((x) => el('li', {}, x)))),
    tastes(),
    brain(),
    section('Ses outils', el('div', { class: 'tools' }, (p.outils || []).map((x) => chip('', x)))));
}

const section = (label, ...content) => el('div', { class: 'section' }, el('span', { class: 'label' }, label), content);

// The Creator's tastes: read, or edited rule by rule
function tastes() {
  const rules = S.gouts?.regles || [];
  if (!editing) {
    return section('Tes goûts, tels qu’il les a compris',
      rules.length ? el('ol', { class: 'list' }, rules.map((r) => el('li', {}, r))) : el('p', { class: 'dim' }, 'Pas encore de règle. Il en tire une quand tu valides ou rejettes un ticket en donnant ta raison.'),
      el('div', { class: 'row' }, el('button', { class: 'btn sm', onclick: () => { editing = [...rules]; render(); } }, rules.length ? 'Corriger ses règles' : 'Écrire une règle')));
  }
  return section('Tes goûts : corriger ses règles',
    el('div', { class: 'rules-edit' }, editing.map((r, i) => el('div', { class: 'rule' },
      el('input', { value: r, 'aria-label': `Règle ${i + 1}`, oninput: (e) => { editing[i] = e.target.value; } }),
      el('button', { class: 'btn sm ghost', onclick: () => { editing.splice(i, 1); render(); } }, 'Retirer')))),
    el('div', { class: 'row' },
      el('button', { class: 'btn sm', onclick: () => { editing.push(''); render(); $('prof-main').querySelector('.rules-edit .rule:last-child input')?.focus(); } }, 'Ajouter une règle'),
      el('button', { class: 'btn sm primary', onclick: save }, 'Enregistrer'),
      el('button', { class: 'btn sm ghost', onclick: () => { editing = null; render(); } }, 'Annuler')));
}

async function save() {
  const regles = editing.map((r) => r.trim()).filter(Boolean);
  await command({ action: 'gouts', regles });
  S.gouts = { ...(S.gouts || {}), regles };
  editing = null;
  render();
  toast('Ses règles sont corrigées : il les suit dès sa prochaine réflexion.');
}

// His brain: a model and a depth of reasoning for each of his three roles, the ceiling, the switches
function brain() {
  const c = S.cerveau || {}, s = S.settings || {};
  return section('Son cerveau',
    el('div', { class: 'brain' }, Object.entries(S.roles || {}).map(([role, label]) => {
      const r = c.roles?.[role] || s.cerveaux?.[role] || {};
      return [
        el('div', {}, el('b', {}, label), el('p', { class: 'dim small' }, ROLE_HINT[role] || '')),
        el('div', { class: 'seg sm', role: 'group', 'aria-label': `${label} : modèle` }, Object.keys(S.modeles || {}).map((k) => el('button', { class: r.modele === k ? 'on' : '', title: S.modeles[k].nom, onclick: () => command({ action: 'cerveau', role, modele: k }) }, MODEL_SHORT[k] || S.modeles[k].label))),
        el('div', { class: 'seg sm', role: 'group', 'aria-label': `${label} : raisonnement` }, Object.keys(S.efforts || {}).map((k) => el('button', { class: r.effort === k ? 'on' : '', onclick: () => command({ action: 'cerveau', role, effort: k }) }, EFFORT_SHORT[k] || S.efforts[k])))
      ];
    }), el('p', { class: 'dim small hint' }, 'Un changement compte dès sa prochaine réflexion. Haiku coûte environ 20 fois moins que Sonnet, Opus 2 fois plus ; un raisonnement plus haut réfléchit plus, plus lentement.')),
    el('div', { class: 'set' }, el('span', {}, 'Plafond de dépense par séance'),
      el('span', { class: 'row' }, el('input', { type: 'number', min: 0, max: 200, step: 0.5, value: s.plafond ?? 3, 'aria-label': 'Plafond en dollars', onchange: (e) => command({ action: 'plafond', plafond: Number(e.target.value) }) }), el('span', { class: 'mono' }, '$'))),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!s.voix, onchange: (e) => command({ action: 'voix', voix: e.target.checked }) }), 'Sa voix dans le jeu'),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!s.vue, onchange: (e) => command({ action: 'vue', vue: e.target.checked }) }), 'L’image en direct dans cette salle'),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!s.atelier, onchange: (e) => command({ action: 'atelier', auto: e.target.checked }) }), 'L’atelier corrige seul chaque ticket que tu valides'));
}

function wire() {
  on('view', (v) => { if (v === 'profil') render(); });
  on('profil', () => { if (S.view === 'profil' && !editing) render(); });
}

export { render, wire };
