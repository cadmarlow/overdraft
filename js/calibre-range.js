import { PLAN } from './calibre-plan.js';

// The shooting range behind every CALIBRE: three booths for the customer, paper targets on ceiling carriers, and a
// course of six stages shot with one's own weapon, the house paying for the ammunition. Six scoring hits a stage; what
// counts is where they land, how fast the stage is cleared and how few rounds were wasted. Medals (bronze, silver, gold,
// per weapon) pay once in cash and lower every price at the counter for good.
//
// Pure rules first (scoring, stages, medals), then the session that runs them in a branch.

// The paper, metres: the print `target` of calibre-prints.js on a 0.48 x 0.878 m sheet, rings centred on the sheet
const PAPER = Object.freeze({ w: 0.48, h: 0.878, ring: [0.155, 0.219], head: [0, 0.289, 0.047, 0.058], torso: [0.187, -0.348, 0.228] });

// What a hole at (x, y) from the middle of the sheet is worth: { points, zone } or null off the paper
function scoreHit(x, y) {
  if (Math.abs(x) > PAPER.w / 2 || Math.abs(y) > PAPER.h / 2) return null;
  const r = Math.hypot(x / PAPER.ring[0], y / PAPER.ring[1]);
  if (r < 0.07) return { points: 12, zone: 'PLEIN CENTRE' };
  if (r < 0.17) return { points: 10, zone: '10' };
  if (r < 0.415) return { points: 9, zone: '9' };
  if (r < 0.7) return { points: 8, zone: '8' };
  if (r < 1) return { points: 7, zone: '7' };
  const [hx, hy, hrx, hry] = PAPER.head;
  if (Math.hypot((x - hx) / hrx, (y - hy) / hry) < 1) return { points: 10, zone: 'TÊTE' };
  const [half, low, high] = PAPER.torso;
  if (Math.abs(x) < half && y > low && y < high) return { points: 5, zone: 'SILHOUETTE' };
  return { points: 1, zone: 'PAPIER' };
}

// The course. `d`: metres from the firing line; `move`: what the carrier does during the stage
const STAGES = [
  { name: 'CIBLE FIXE', d: 6, time: 9, move: 'still' },
  { name: 'CIBLE FIXE', d: 10, time: 9, move: 'still' },
  { name: 'CIBLE MOBILE', d: 8, time: 11, move: 'sway' },
  { name: 'LONGUE DISTANCE', d: 12, time: 10, move: 'still' },
  { name: 'ELLE AVANCE', d: 12, to: 5, time: 9, move: 'advance' },
  { name: 'CIBLE PIVOTANTE', d: 9, time: 11, move: 'flip' }
];
const HITS_PER_STAGE = 6;
const MEDALS = [{ id: 'bronze', name: 'BRONZE', score: 190, cash: 250 }, { id: 'argent', name: 'ARGENT', score: 300, cash: 600 }, { id: 'or', name: 'OR', score: 400, cash: 1500 }];
const RANGE_WEAPONS = ['pistol', 'smg', 'shotgun', 'rifle'];
const MAX_DISCOUNT = 0.15;

// 0 (none) to 3 (gold) for a final score
function medalFor(score) {
  let n = 0;
  for (const m of MEDALS) if (score >= m.score) n++;
  return n;
}
// What the counter takes off its prices for the medals held ({ pistol: 0..3, ... })
function rangeDiscount(medals) {
  let n = 0;
  for (const id of RANGE_WEAPONS) n += Math.min(3, Math.max(0, medals?.[id] | 0));
  return MAX_DISCOUNT * n / (RANGE_WEAPONS.length * 3);
}
// The final score: the points, two for every second left on each stage's clock, up to 60 for rounds well spent
function finalScore(points, secondsLeft, shots, hits) {
  const accuracy = shots > 0 ? Math.min(1, hits / shots) : 0;
  return Math.round(points + secondsLeft * 2 + accuracy * 60);
}

// Where the carrier is, `t` seconds into a stage: { d (metres from the line), x (sideways), turn (0 facing, 1 edge-on) }
function carrierAt(stage, t) {
  const u = Math.min(1, Math.max(0, t / stage.time));
  if (stage.move === 'sway') return { d: stage.d, x: Math.sin(t * 1.5) * 0.55, turn: 0 };
  if (stage.move === 'advance') return { d: stage.d + (stage.to - stage.d) * u * u, x: 0, turn: 0 };
  if (stage.move === 'flip') {
    // faces the shooter 1.3 s out of every 2.3, swinging round in a fifth of a second
    const phase = t % 2.3, open = phase < 1.3 ? Math.min(1, phase / 0.2, (1.3 - phase) / 0.2) : 0;
    return { d: stage.d, x: 0, turn: 1 - open };
  }
  return { d: stage.d, x: 0, turn: 0 };
}

const LINE = PLAN.line.z + 0.5; // where the shooter's toes are, local z

class CalibreRange {
  /**
   * @param {object} game
   * @param {object} world - createCalibreWorld's: `targets` (one per lane: place(d, x, turn), hole(x, y), clear())
   */
  constructor(game, world) {
    this.game = game; this.world = world;
    this.session = null; this.result = null; this.resultT = 0;
    this.practice = 0; // seconds a free shot's score stays on screen
    const el = (tag, cls, parent, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; parent?.append(n); return n; };
    this.panel = el('div', 'calibre-range', document.body);
    this.panel.hidden = true;
    this.title = el('strong', null, this.panel);
    this.stage = el('span', 'cr-stage', this.panel);
    const row = el('div', 'cr-row', this.panel);
    this.score = el('em', null, row, '0');
    this.pips = el('div', 'cr-pips', row);
    this.pipEls = Array.from({ length: HITS_PER_STAGE }, () => el('i', null, this.pips));
    this.clock = el('div', 'cr-clock', this.panel);
    this.clockFill = el('b', null, this.clock);
    this.call = el('p', 'cr-call', this.panel);
    this.card = el('div', 'calibre-result', document.body);
    this.card.hidden = true;
  }

  get medals() { return this.game.range.medals; }
  discount() { return rangeDiscount(this.medals); }

  // The booth the player stands in: 1..3 (lane 0 is the regular's), or -1
  booth(local) {
    const B = PLAN.booths;
    if (local.z > B.z0 + 0.15 || local.z < PLAN.line.z + PLAN.line.depth / 2 - 0.05) return -1;
    for (let i = 1; i < PLAN.lanes.length; i++) if (Math.abs(local.x - PLAN.lanes[i]) < 0.98) return i;
    return -1;
  }

  // The firearm a session would be shot with: the one in hand, else the one held last
  weaponFor() {
    const g = this.game;
    if (RANGE_WEAPONS.includes(g.weaponId)) return g.weaponId;
    const last = g.arsenal?.previous;
    return RANGE_WEAPONS.includes(last) && g.weapons[last] ? last : g.weapons.pistol ? 'pistol' : null;
  }

  start(lane) {
    const g = this.game, id = this.weaponFor();
    if (!id || this.session) return false;
    if (g.weaponId !== id) g.selectWeapon(id);
    const slot = g.weapons[id];
    this.session = { lane, weapon: id, saved: { mag: slot.mag, ammo: slot.ammo }, stage: -1, t: 0, wait: 2.4, points: 0, left: 0, shots: 0, hits: 0, stageHits: 0, streak: 0 };
    this.result = null; this.card.hidden = true;
    this.world.targets[lane].clear();
    this.world.targets[lane].place(STAGES[0].d, 0, 0);
    this.panel.hidden = false;
    this.title.textContent = `STAND DE TIR · ${g.weapon.name}`;
    this.stage.textContent = 'PRÊT ?';
    this.call.textContent = 'Munitions offertes. Six impacts par cible : visez le centre.';
    this.pipEls.forEach((p) => { p.className = ''; });
    this.score.textContent = '0';
    g.audio.ui('start');
    return true;
  }

  // Ends the session: `done` when the course was shot to the end
  stop(done = false) {
    const s = this.session, g = this.game;
    if (!s) return;
    this.session = null;
    const slot = g.weapons[s.weapon];
    if (slot) { slot.mag = Math.min(s.saved.mag, g.weapon.mag ?? s.saved.mag); slot.ammo = s.saved.ammo; }
    this.panel.hidden = true;
    this.world.targets[s.lane].place(STAGES[0].d, 0, 0);
    if (!done) { g.toast('Séance interrompue', 'Revenez au pas de tir pour recommencer.'); return; }
    const score = finalScore(s.points, s.left, s.shots, s.hits), medal = medalFor(score), before = this.medals[s.weapon] | 0;
    let cash = 0;
    for (let i = before; i < medal; i++) cash += MEDALS[i].cash;
    if (medal > before) this.medals[s.weapon] = medal;
    g.range.best[s.weapon] = Math.max(g.range.best[s.weapon] | 0, score);
    if (cash) g.addMoney(cash);
    g.audio.ui(medal > before ? 'pass' : medal ? 'checkpoint' : 'fail');
    this.result = { score, medal, cash, accuracy: s.shots ? Math.round(100 * s.hits / s.shots) : 0, weapon: s.weapon, fresh: medal > before };
    this.resultT = 9;
    this.showResult();
    g.calibre.say(medal >= 3 ? 'gold' : medal > 0 ? 'medal' : 'nomedal');
    g.save();
  }

  showResult() {
    const r = this.result, g = this.game, c = this.card;
    c.replaceChildren();
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; c.append(n); return n; };
    el('span', 'cr-kicker', `STAND DE TIR · ${g.weapon.name}`);
    el('strong', r.medal ? `medal m${r.medal}` : 'medal', r.medal ? `MÉDAILLE ${['', 'DE BRONZE', 'D’ARGENT', 'D’OR'][r.medal]}` : 'PAS DE MÉDAILLE');
    el('em', null, `${r.score} points`);
    el('span', null, `Précision ${r.accuracy} % · bronze ${MEDALS[0].score} · argent ${MEDALS[1].score} · or ${MEDALS[2].score}`);
    if (r.cash) el('span', 'cr-prize', `Prime : ${r.cash.toLocaleString('fr-FR')} $ · remise au comptoir : −${Math.round(this.discount() * 100)} %`);
    else if (r.medal && !r.fresh) el('span', null, 'Médaille déjà acquise avec cette arme.');
    c.hidden = false;
  }

  // A bullet of the player's through the branch: `o`, `d` the ray in the branch's frame (y above the floor), `reach`
  // how far it flies before it meets something solid. Marks the paper it crosses and scores it.
  shot(o, d, reach) {
    const targets = this.world.targets, s = this.session;
    let best = null;
    for (let i = 0; i < targets.length; i++) {
      const hit = targets[i].cross(o, d, reach);
      if (hit && (!best || hit.t < best.t)) best = { ...hit, lane: i };
    }
    if (!best) return null;
    const mark = scoreHit(best.x, best.y);
    if (!mark) return null;
    targets[best.lane].hole(best.x, best.y);
    if (s && best.lane === s.lane && s.stage >= 0 && s.stageHits < HITS_PER_STAGE) {
      s.pendingHit = !s.pendingHit || mark.points > s.pendingHit.points ? mark : s.pendingHit; // a shotgun's pattern counts once, at its best
    } else if (!s && best.lane > 0) {
      this.practice = 2.2;
      this.game.hud.say('', `${mark.zone === 'PAPIER' ? 'Dans le papier' : mark.zone} · ${mark.points} point${mark.points > 1 ? 's' : ''}`, 1.6);
    }
    return mark;
  }

  // Called once per trigger pull of the player's while a session runs (after its pellets went through `shot`)
  fired() {
    const s = this.session;
    if (!s || s.stage < 0) return;
    s.shots++;
    const mark = s.pendingHit; s.pendingHit = null;
    if (!mark) { s.streak = 0; this.call.textContent = 'Manqué.'; return; }
    s.hits++; s.streak++;
    const bonus = s.streak >= 3 && mark.points >= 9 ? 2 : 0;
    s.points += mark.points + bonus;
    this.pipEls[s.stageHits].className = mark.points >= 10 ? 'on best' : mark.points >= 7 ? 'on good' : 'on';
    s.stageHits++;
    this.call.textContent = `${mark.zone} · +${mark.points + bonus}${bonus ? ' · série' : ''}`;
    this.score.textContent = String(s.points);
    this.game.audio.ui(mark.points >= 10 ? 'headshot' : 'hitConfirm');
  }

  next() {
    const s = this.session;
    if (s.stage >= 0) s.left += Math.max(0, STAGES[s.stage].time - s.t);
    s.stage++; s.t = 0; s.stageHits = 0;
    if (s.stage >= STAGES.length) { this.stop(true); return; }
    this.world.targets[s.lane].clear();
    this.pipEls.forEach((p) => { p.className = ''; });
    const st = STAGES[s.stage];
    this.stage.textContent = `${s.stage + 1} / ${STAGES.length} · ${st.name} · ${st.to ? `${st.d} → ${st.to}` : st.d} m`;
    this.game.audio.ui('checkpoint');
  }

  /**
   * @param {number} dt
   * @param {object|null} local - the player in the nearest branch's frame, null when not in its range
   */
  update(dt, local) {
    const g = this.game, s = this.session;
    if (this.resultT > 0 && (this.resultT -= dt) <= 0) this.card.hidden = true;
    if (!s) return;
    const slot = g.weapons[s.weapon], spec = g.weapon;
    // the house pays: the reserve never runs dry while the course lasts
    if (slot) slot.ammo = Math.max(slot.ammo, spec.mag * 2);
    if (!local || this.booth(local) !== s.lane || g.weaponId !== s.weapon || g.state !== 'onFoot' || g.wanted.level > 0) { this.stop(false); return; }
    if (s.wait > 0) {
      s.wait -= dt;
      this.stage.textContent = s.wait > 1.6 ? 'PRÊT ?' : s.wait > 0.8 ? 'EN JOUE…' : 'FEU !';
      this.clockFill.style.transform = 'scaleX(1)';
      if (s.wait <= 0) this.next();
      return;
    }
    s.t += dt;
    const st = STAGES[s.stage], c = carrierAt(st, s.t);
    this.world.targets[s.lane].place(c.d, c.x, c.turn);
    this.clockFill.style.transform = `scaleX(${Math.max(0, 1 - s.t / st.time)})`;
    if (s.stageHits >= HITS_PER_STAGE || s.t >= st.time) this.next();
  }
}

export { CalibreRange, PAPER, STAGES, MEDALS, HITS_PER_STAGE, RANGE_WEAPONS, LINE, scoreHit, medalFor, rangeDiscount, finalScore, carrierAt };
