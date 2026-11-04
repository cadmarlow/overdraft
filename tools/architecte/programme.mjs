// His work programme: a subject and its steps (a place, what to look at, what he looks for), carried out by his body
// while his mind is free. At each step the body goes there, sets the hour and the weather if asked (alone), takes the
// photos, and only then calls the mind with them, to judge. The programme lives in his session memory: it survives a
// restart of the server, and the next thought always knows where it stands.

const STEP_WAIT = 240; // seconds at most to reach a step
const cancelled = () => new DOMException('Programme interrompu.', 'AbortError');
const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(cancelled()); return; }
  const abort = () => { clearTimeout(timer); reject(cancelled()); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});
const untilCancelled = (promise, signal) => {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(cancelled()); return; }
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
};

class Programme {
  /**
   * @param {object} o - brain, game, memoire, log(kind, text, data), notify(kind, data)
   */
  constructor({ brain, game, memoire, log, notify, clock = () => Date.now(), sleep = wait }) {
    Object.assign(this, { brain, game, memoire, log, notify });
    this.clock = clock;
    this.sleep = sleep;
    this.stepping = false;
    this.stepAbort = null;
    this.retryAt = 0;
  }

  get current() { return this.memoire.seance.programme; }
  get active() { return this.current?.etat === 'en_cours'; }
  get running() { return this.active; }

  summary() {
    const p = this.current;
    if (!p) return null;
    return {
      id: p.id, sujet: p.sujet, categorie: p.categorie, etat: p.etat, active: p.etat === 'en_cours', etape: Math.min(p.i + 1, p.etapes.length), total: p.etapes.length,
      enCours: this.stepping ? (this.phase || 'en route') : this.waitReason || null,
      restent: p.etapes.slice(p.i).map((s) => `${s.quoi}${s.label ? ` (${s.label})` : ''}`),
      etapes: p.etapes.map((s, i) => ({ quoi: s.quoi, label: s.label || '', x: s.x, z: s.z, fait: i < p.i, photos: s.photos || [], resultat: s.resultat || '' })),
      origine: p.origine || 'modele', verification_de: p.verification_de || null
    };
  }

  place(step) {
    if (step.lieu) {
      const p = this.brain.places.find((q) => q.id === step.lieu);
      if (p) return { x: p.x, z: p.z, label: p.label };
    }
    if (Number.isFinite(step.x) && Number.isFinite(step.z)) return { x: step.x, z: step.z, label: '' };
    return null;
  }

  start(input) {
    const steps = (input.etapes || []).slice(0, 8).map((s) => ({ ...s, ...(this.place(s) || {}) }));
    if (!steps.length) return { ok: false, texte: 'Un programme a besoin d’au moins une étape.' };
    const state = this.game.state || {};
    const alone = state.architecte?.spectating, pl = state.joueur;
    if (!alone && pl) {
      const far = steps.filter((s) => Number.isFinite(s.x) && Math.hypot(s.x - pl.x, s.z - pl.z) > 350);
      if (far.length) return { ok: false, texte: `Refusé : mode Ensemble, et ${far.length} étape(s) sont à plus de 350 m du joueur (${far.map((s) => s.label || `${Math.round(s.x)}, ${Math.round(s.z)}`).join(', ')}). Garde tes étapes près de lui, ou attends le mode Seul.` };
    }
    this.archive('remplacé');
    const p = { id: this.clock().toString(36), sujet: String(input.sujet).slice(0, 120), categorie: input.categorie || 'art', raison: input.raison || '', etapes: steps, i: 0, etat: 'en_cours', debut: this.clock(), origine: input.origine || 'modele', verification_de: input.verification_de || null };
    this.retryAt = 0;
    this.memoire.seance.programme = p;
    this.memoire.saveSoon();
    this.notify('programme', this.summary());
    return { ok: true, texte: `Programme « ${p.sujet} » lancé : ${steps.length} étape(s). Ton corps s’y met ; tu seras rappelé à chaque étape avec ses photos.` };
  }

  abort(reason = '') {
    if (!this.active) return { ok: true, texte: 'Pas de programme en cours.' };
    this.brain.autonomie?.exclude(this.current.etapes[this.current.i]);
    this.current.resultat = reason;
    this.archive('abandonné');
    this.notify('programme', this.summary());
    return { ok: true, texte: 'Programme arrêté.' };
  }

  archive(etat) {
    const p = this.current;
    if (!p || p.etat !== 'en_cours') return;
    this.suspend();
    p.etat = etat;
    p.fin = this.clock();
    const list = (this.memoire.seance.programmes ??= []);
    list.push({ sujet: p.sujet, categorie: p.categorie, etat, debut: p.debut, fin: p.fin, etapes: p.etapes.length, faites: p.i });
    if (list.length > 40) list.shift();
    this.memoire.saveSoon();
  }

  // End the in-flight step promptly, but keep its index for a pause or a conversation. A replacement can start on
  // the next tick instead of waiting up to four minutes for a trip belonging to the previous programme.
  suspend() {
    const signal = this.stepAbort?.signal;
    if (!signal || signal.aborted) return;
    this.stepAbort.abort();
    const a = this.game.state?.architecte;
    if (this.phase === 'en route' && this.game.connected && a?.present && !a.fighting) {
      this.game.command('s_arreter', { raison: 'Programme interrompu.' }).catch(() => {});
    }
  }

  workProblem(step = this.current?.etapes[this.current?.i]) {
    const a = this.game.state?.architecte, pl = this.game.state?.joueur;
    if (!this.game.connected || this.brain.paused || this.brain.chantier?.settings.allume === false) return 'En attente : jeu déconnecté ou cerveau en pause.';
    if (!a?.present || !a.alive || a.fighting) return 'En attente : hors service ou en combat.';
    if (!a.spectating) {
      if (![pl?.x, pl?.z, a.x, a.z].every(Number.isFinite)) return 'En attente : position du joueur inconnue.';
      if (Math.hypot(a.x - pl.x, a.z - pl.z) > 350 || (Number.isFinite(step?.x) && Number.isFinite(step?.z) && Math.hypot(step.x - pl.x, step.z - pl.z) > 350)) {
        return 'En attente : donne-lui la caméra pour poursuivre hors de la zone du joueur.';
      }
      if (Number.isFinite(step?.heure) || step?.meteo) return 'En attente : cette étape règle l’atmosphère et nécessite sa caméra.';
    }
    return null;
  }

  // Every second: the next step, when his body is free and well
  async tick() {
    if (this.active) {
      const problem = this.workProblem();
      if (problem || this.brain.talking || this.brain.talkQueue?.length) {
        this.suspend();
        if (this.waitReason !== problem) { this.waitReason = problem; this.notify('programme', this.summary()); }
        return;
      }
      this.waitReason = null;
    }
    // his body waits for his mind: no key, paused or over budget, the programme holds where it is
    if (!this.active || this.stepping || this.clock() < this.retryAt || !this.game.connected || !this.brain.ready || this.brain.paused || this.brain.busy || this.brain.talking || this.brain.talkQueue?.length) return;
    const a = this.game.state?.architecte;
    if (!a?.present || !a.alive || a.fighting) return;
    this.stepping = true;
    const controller = this.stepAbort = new AbortController();
    try { await this.runStep(controller.signal); } catch (e) {
      if (e.name !== 'AbortError' && !this.brain.paused) {
        this.log('systeme', `Programme : ${e.message}`);
        this.retryAt = this.clock() + 20_000;
        this.brain.fail?.(e);
      }
    } finally {
      if (this.stepAbort === controller) this.stepAbort = null;
      this.stepping = false; this.phase = null; this.notify('programme', this.summary());
    }
  }

  async runStep(signal) {
    const p = this.current, step = p.etapes[p.i];
    // switched off mid-step: stop here without counting the step, it starts again when he is back
    const still = () => !signal?.aborted && this.current === p && p.etat === 'en_cours' && !this.workProblem(step) && !this.brain.talking && !this.brain.talkQueue?.length;
    if (!still()) return;
    this.log('action', `Programme « ${p.sujet} », étape ${p.i + 1}/${p.etapes.length} : ${step.quoi}`);
    this.phase = 'en route';
    this.notify('programme', this.summary());
    let arrivee = '';
    if (Number.isFinite(step.x)) {
      const r = await untilCancelled(this.move(step, signal), signal);
      arrivee = r.texte;
      if (!still()) return;
      if (!r.ok) { this.brain.autonomie?.exclude(step); this.finishStep(p, step, r.texte); return; }
    }
    if ((Number.isFinite(step.heure) || step.meteo) && this.game.state?.architecte?.spectating) {
      await untilCancelled(this.game.command('regler_heure_meteo', { heure: step.heure, meteo: step.meteo }), signal);
      await this.sleep(1500, signal); // the light settles
    }
    if (!still()) return;
    this.phase = 'photographie';
    this.notify('programme', this.summary());
    const shots = [], mesures = [];
    if (step.experience && this.game.state?.architecte?.spectating) {
      this.phase = 'expérience';
      const result = await untilCancelled(this.brain.experimentTool({ ...step.experience, raison: step.quoi }), signal);
      if (!still()) return;
      if (result.ok) {
        mesures.push(result.texte);
        const record = this.brain.chantier.experience(result.experience);
        for (const id of record?.photos || []) {
          const base64 = this.brain.chantier.photoBase64(id);
          if (base64) shots.push({ id, base64, lieu: this.brain.chantier.photoMeta(id), note: 'Expérience mesurée.' });
        }
      }
    }
    for (const look of shots.length ? [] : step.regarder || []) {
      if (!still()) return;
      const shot = await untilCancelled(this.brain.photo({ ...look, raison: step.quoi }, { sujet: p.categorie }), signal);
      if (shot.id) shots.push(shot);
      if (!still()) return;
    }
    if (step.mesure && ['sonder_sol', 'mesurer_performances', 'mesurer_vehicule'].includes(step.mesure) && still()) {
      this.phase = 'mesure';
      const result = await untilCancelled(this.game.command(step.mesure, step.mesure === 'mesurer_vehicule' ? { cible: 'le_mien', duree: 3 } : { duree: 3 }, 20000), signal);
      if (!still()) return;
      if (result.ok && result.texte) mesures.push(result.texte);
    }
    step.photos = shots.map((s) => s.id);
    if (!shots.length && !mesures.length) {
      step.rates = (step.rates || 0) + 1;
      step.resultat = 'Aucune photo ou mesure nouvelle : aucun appel de pensée.';
      if (step.rates >= 2) { this.brain.autonomie?.exclude(step); this.finishStep(p, step, step.resultat); }
      return;
    }
    this.phase = 'juge';
    this.notify('programme', this.summary());
    for (let i = 0; i < 120 && (this.brain.busy || this.brain.talking); i++) await this.sleep(500, signal);
    if (!still()) return;
    const judged = await untilCancelled(this.brain.think('etape', { step, index: p.i, total: p.etapes.length, sujet: p.sujet, shots, mesures, verification: p.verification_de, lieu: shots[0]?.lieu, arrivee, signal }), signal);
    if (!still()) return;
    if (!judged) {
      step.rates = (step.rates || 0) + 1;
      if (step.rates >= 2) { this.brain.autonomie?.exclude(step); this.finishStep(p, step, 'Jugement incomplet après deux essais : autre point de prospection.'); }
      return;
    }
    this.finishStep(p, step, step.resultat || 'Observation jugée ; poursuite sur le prochain sujet.');
  }

  finishStep(p, step, resultat) {
    if (this.current !== p || p.etat !== 'en_cours') return;
    step.resultat = resultat;
    p.i++;
    this.brain.autonomie?.mark('etape');
    this.memoire.saveSoon();
    if (p.i >= p.etapes.length) {
      this.stepAbort = null;
      this.archive('fini');
      this.log('action', `Programme terminé : ${p.sujet}. La prospection peut continuer sans pensée de fin supplémentaire.`);
      this.notify('programme', this.summary());
    }
  }

  async recover(step = this.current?.etapes[this.current?.i], raison = 'Déplacement sans progrès : reprise du trajet.') {
    if (!this.active || this.workProblem(step) || ![step?.x, step?.z].every(Number.isFinite)) return { ok: false, texte: 'Reprise impossible dans les conditions présentes.' };
    const a = this.game.state.architecte;
    const distance = Math.hypot(step.x - a.x, step.z - a.z);
    const moyen = distance < 260 ? 'pied' : step.moyen || 'auto';
    const result = await this.game.command('aller_a', { x: step.x, z: step.z, moyen, reprendre: true, raison });
    this.brain.autonomie?.mark('relance');
    this.log('action', `Watchdog : ${raison}${result.ok ? '' : ` ${result.texte || 'Trajet refusé.'}`}`);
    return result;
  }

  // Go to a step's place: on foot or driving when it is near (or when he plays with the player), an architect's jump
  // when alone and far. Done once he stands within 25 m of it with nothing left of the trip.
  async move(step, signal) {
    const state = () => this.game.state?.architecte || {};
    const a = state();
    const far = Math.hypot(step.x - a.x, step.z - a.z);
    if (far < 15) return { ok: true, texte: 'Tu y étais déjà.' };
    const jump = a.spectating && far > 350 && (!step.moyen || step.moyen === 'auto');
    if (signal?.aborted || this.workProblem(step)) throw cancelled();
    const r = await untilCancelled(this.game.command(jump ? 'se_teleporter' : 'aller_a', { x: step.x, z: step.z, moyen: step.moyen || 'auto', raison: step.quoi }), signal);
    if (!r.ok) return { ok: false, texte: `Trajet refusé : ${r.texte}` };
    const limit = this.clock() + Math.min(STEP_WAIT, 40 + far / 3) * 1000;
    let best = far, progressed = this.clock(), retries = 0;
    while (this.clock() < limit) {
      await this.sleep(1000, signal);
      const s = state();
      if (this.workProblem(step)) return { ok: false, texte: 'Trajet interrompu (pause, changement de caméra ou hors service).' };
      const remaining = Math.hypot(step.x - s.x, step.z - s.z);
      if (remaining < 25 && !s.trip) return { ok: true, texte: `Arrivé${jump ? ' (téléporté)' : ''} : ${s.address || ''}.` };
      if (remaining < best - 4) { best = remaining; progressed = this.clock(); this.brain.autonomie?.mark('déplacement'); }
      if (this.clock() - progressed > 18_000) {
        if (retries++) return { ok: false, texte: 'Point inaccessible après reprise réelle du trajet : abandon de ce point, sans inventer de défaut.' };
        const resumed = await untilCancelled(this.recover(step), signal);
        if (!resumed.ok) return resumed;
        progressed = this.clock(); best = remaining;
      }
    }
    const s = state();
    return { ok: false, texte: `Pas arrivé à temps : encore ${Math.round(Math.hypot(step.x - s.x, step.z - s.z))} m. Photos prises là où tu es (${s.address || '?'}).` };
  }
}

export { Programme };
