import { hasCreatorApproval } from './ticket-policy.mjs';

// The body always has useful work while its mind is available. No model call is needed to choose the next place.
const THEMES = [
  { categorie: 'art', sujet: 'Façades, vitrines et lumière', regarder: [{ direction: 'devant', cadrage: 'facade' }, { direction: 'gauche', cadrage: 'haut' }] },
  { categorie: 'bug', sujet: 'Sols, obstacles et contacts', regarder: [{ direction: 'devant', cadrage: 'sol' }, { direction: 'droite', cadrage: 'rue' }], mesure: 'sonder_sol' },
  { categorie: 'gameplay', sujet: 'Circulation et vie de rue', regarder: [{ direction: 'devant', cadrage: 'rue' }, { direction: 'derriere', cadrage: 'rue' }] },
  { categorie: 'performance', sujet: 'Ville dense et fluidité', regarder: [{ direction: 'devant', cadrage: 'rue' }, { direction: 'gauche', cadrage: 'facade' }], mesure: 'mesurer_performances' }
];
const CONDITIONS = [{ heure: 13, meteo: 'clear', cle: 'jour' }, { heure: 23, meteo: 'clear', cle: 'nuit' }, { heure: 16, meteo: 'rain', cle: 'pluie' }];
const keyOf = (p) => `${Math.round(p.x / 50)},${Math.round(p.z / 50)}`;

function prospectionPlan({ state, places = [], coveredNear = () => ({}), history = {}, round = 0, now = Date.now() }) {
  const a = state?.architecte, pl = state?.joueur;
  if (![a?.x, a?.z].every(Number.isFinite)) return null;
  const alone = !!a.spectating;
  if (!alone && ![pl?.x, pl?.z].every(Number.isFinite)) return null;
  const origin = alone ? a : pl;
  const modes = (a.capacites?.deplacements || ['pied']).filter((mode) => ['pied', 'voiture', 'helico'].includes(mode) && (alone || mode !== 'helico'));
  if (!modes.length) return null;
  const moyen = modes[round % modes.length];
  const points = places.filter((p) => [p.x, p.z].every(Number.isFinite)).map((p) => ({ ...p, known: true }));
  // Nearby street-scale alternatives keep Ensemble productive even when the named places are far away.
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4, radius = alone ? 140 : 180;
    points.push({ x: origin.x + Math.cos(angle) * radius, z: origin.z + Math.sin(angle) * radius, label: 'Rues voisines', known: false });
  }
  const candidates = [];
  for (const p of points) {
    const distance = Math.hypot(p.x - a.x, p.z - a.z), fromPlayer = alone ? 0 : Math.hypot(p.x - pl.x, p.z - pl.z);
    if ((!alone && fromPlayer > 330) || distance < 55) continue;
    const previous = history[keyOf(p)];
    if (previous?.bloqueJusqua > now) continue;
    const cover = coveredNear(p.x, p.z, 90) || {};
    const conditions = alone ? [...CONDITIONS].sort((x, y) => (cover[x.cle] || 0) - (cover[y.cle] || 0) || ((CONDITIONS.indexOf(x) - round % 3 + 3) % 3) - ((CONDITIONS.indexOf(y) - round % 3 + 3) % 3))[0] : null;
    const maximum = moyen === 'pied' ? 350 : moyen === 'voiture' ? 2600 : 20000;
    if (distance > maximum) continue;
    const recent = previous && now - previous.t < 15 * 60_000 ? 100 + previous.n * 10 : 0;
    const score = (conditions ? cover[conditions.cle] || 0 : cover.n || 0) * 30 + recent + distance / maximum - (p.known ? 3 : 0);
    candidates.push({ p, conditions, score });
  }
  candidates.sort((x, y) => x.score - y.score);
  const selected = candidates[0];
  if (!selected) return null;
  const theme = moyen === 'helico' ? { categorie: 'art', sujet: 'Toits et silhouettes de Manhattan', regarder: [{ direction: 'devant', cadrage: 'sol' }, { direction: 'gauche', cadrage: 'rue' }] } : THEMES[round % THEMES.length], target = selected.p;
  const step = { x: target.x, z: target.z, label: target.label || target.id || 'Nouvelle zone', moyen,
    quoi: `${theme.sujet} : observer ce lieu sans présumer d’un défaut.`, regarder: theme.regarder,
    ...(selected.conditions ? { heure: selected.conditions.heure, meteo: selected.conditions.meteo } : {}),
    ...(theme.mesure ? { mesure: theme.mesure } : {}) };
  return { origine: 'prospection', sujet: `${theme.sujet} · ${step.label}`, categorie: theme.categorie,
    raison: 'Poursuivre une observation indépendante pendant que les autres tickets suivent leur cycle.', etapes: [step] };
}

class Autonomie {
  constructor(brain) { this.brain = brain; this.pending = false; this.nextAttempt = 0; this.lastReload = 0; }
  get memory() {
    return (this.brain.memoire.seance.autonomie ??= { programmes: 0, relances: 0, pointsEcartes: 0, destinations: {}, verifications: {}, derniereProgression: 0 });
  }
  status() {
    const m = this.memory;
    return { etat: this.etat || 'prêt', raison: this.raison || '', programmes: m.programmes, relances: m.relances, pointsEcartes: m.pointsEcartes, derniereProgression: m.derniereProgression };
  }
  mark(kind, now = Date.now()) {
    const m = this.memory;
    if (kind === 'relance') m.relances++;
    if (kind === 'ecarte') m.pointsEcartes++;
    m.derniereProgression = now;
    this.brain.memoire.saveSoon();
  }
  exclude(step, now = Date.now()) {
    if (![step?.x, step?.z].every(Number.isFinite)) return;
    const m = this.memory, key = keyOf(step);
    m.destinations[key] = { ...(m.destinations[key] || { n: 0 }), t: now, bloqueJusqua: now + 10 * 60_000 };
    this.mark('ecarte', now);
  }
  tick(now = Date.now()) {
    const b = this.brain, p = b.programme, a = b.game.state?.architecte, tab = b.game.state?.onglet;
    if (!p || !b.awake() || !b.canRequest() || a.fighting || (tab && (!tab.lance || tab.pause || (!tab.visible && !a.spectating)))) return false;
    if (b.busy || b.talking || b.talkQueue.length || this.pending || now < this.nextAttempt) return false;
    // Returning the camera is not a request for the Architect to stop working: bring him back physically, then work
    // nearby. Camera ownership always stays with the Creator.
    const pl = b.game.state.joueur;
    if (!a.spectating && [pl?.x, pl?.z, a.x, a.z].every(Number.isFinite) && Math.hypot(a.x - pl.x, a.z - pl.z) > 350) {
      this.etat = 'retour'; this.raison = 'Retour dans la zone du joueur, sans prendre sa caméra.';
      const previous = this.returnProgress;
      const moved = previous && Math.hypot(a.x - previous.x, (a.y || 0) - previous.y, a.z - previous.z) >= 5;
      if (moved) this.returnProgress = { x: a.x, y: a.y || 0, z: a.z, t: now };
      if (previous && now - this.returnProgress.t < 30_000) {
        this.nextAttempt = now + 5000;
        return false;
      }
      this.returnProgress = { x: a.x, y: a.y || 0, z: a.z, t: now };
      this.nextAttempt = now + 20_000;
      this.pending = true;
      b.game.command('suivre_joueur', { raison: this.raison }).catch(() => {}).finally(() => { this.pending = false; });
      return true;
    }
    this.returnProgress = null;
    if (p.active && p.workProblem()) {
      p.abort('Changement de conditions : reprise sur un sujet accessible.');
      this.mark('relance', now);
    }
    if (p.active) { this.etat = 'travail'; this.raison = 'Programme en cours ; les tickets en attente ne le bloquent pas.'; return false; }
    // Only an accepted delivery is a verification job. Awaiting validation, workshop failures and old session ids
    // never turn exploration into a wait loop.
    const verify = b.chantier.listTickets().find((t) => t.statut === 'corrige' && t.livraison && t.lieu && hasCreatorApproval(t)
      && now - (this.memory.verifications[t.id] || 0) > 5 * 60_000
      && (a.spectating || ([t.lieu.x, t.lieu.z, pl?.x, pl?.z].every(Number.isFinite) && Math.hypot(t.lieu.x - pl.x, t.lieu.z - pl.z) <= 330 && !t.experience)));
    const stale = b.code?.staleSince(b.game.loadedAt) || [];
    if (verify && stale.length && a.spectating && !b.workshop?.()?.enCours && now - this.lastReload > 3 * 60_000) {
      this.lastReload = now; this.pending = true; this.etat = 'rechargement'; this.raison = 'Charger la livraison avant de la vérifier.';
      b.game.command('recharger_le_jeu', { raison: this.raison }).catch(() => {}).finally(() => { this.pending = false; });
      return true;
    }
    let plan = null;
    if (verify && !stale.length) {
      const original = verify.experience ? b.chantier.experience(verify.experience) : null;
      if (!verify.experience || original?.validite === 'valide') {
        plan = { origine: 'verification', verification_de: verify.id, sujet: `Livraison #${verify.id} : ${verify.titre}`, categorie: verify.categorie || 'bug', raison: 'Correction réellement livrée, à vérifier avec des preuves nouvelles.',
          etapes: [{ x: verify.lieu.x, z: verify.lieu.z, moyen: 'auto', quoi: `Juger la livraison #${verify.id}, puis conclure seulement si les preuves suffisent.`,
            regarder: [{ direction: verify.lieu.oeil?.direction || 'devant', cadrage: verify.lieu.oeil?.cadrage || 'rue', zoom: verify.lieu.oeil?.zoom || 'normal' }],
            ...(a.spectating ? { heure: verify.lieu.heure, meteo: verify.lieu.meteo } : {}), ...(original ? { experience: { type: original.type, refaire: original.id } } : {}) }] };
        this.memory.verifications[verify.id] = now;
      }
    }
    plan ??= prospectionPlan({ state: b.game.state, places: b.places, coveredNear: (...args) => b.memoire.coveredNear(...args), history: this.memory.destinations, round: this.memory.programmes, now });
    if (!plan) { this.etat = 'attente'; this.raison = 'Aucun point accessible : aucun appel de pensée sans nouvelle preuve.'; this.nextAttempt = now + 10_000; return false; }
    const result = p.start(plan);
    if (!result.ok) { this.nextAttempt = now + 10_000; this.etat = 'attente'; this.raison = result.texte; return false; }
    const target = plan.etapes[0], key = keyOf(target), previous = this.memory.destinations[key];
    this.memory.destinations[key] = { t: now, n: (previous?.n || 0) + 1 };
    const entries = Object.entries(this.memory.destinations);
    if (entries.length > 256) delete this.memory.destinations[entries.sort((x, y) => x[1].t - y[1].t)[0][0]];
    this.memory.programmes++; this.mark('programme', now);
    this.etat = plan.origine; this.raison = plan.sujet;
    b.log('action', `Autonomie : ${plan.sujet}. ${plan.raison}`);
    return true;
  }
}

export { Autonomie, CONDITIONS, THEMES, keyOf, prospectionPlan };
