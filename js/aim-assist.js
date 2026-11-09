// Assisted aim, made for a trackpad: raising the sights near an enemy carries them onto him, follows him for a moment,
// then lets go. Lowering and raising again goes to the next one, the rhythm of every console crime game. A deliberate
// move of the view always wins: the assist never fights the hand.
// Pure state and angles, no rendering: the camera's yaw turns about +Y from +Z, its pitch is positive looking down.

const wrap = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

/**
 * Whom the sights go to: the candidate closest to the view's axis, nearer ones first at equal angle.
 * @param {{x,y,z}} eye - the camera
 * @param {number} yaw, pitch - where it looks
 * @param {Array<{x,y,z}>} candidates - points to aim at (a chest), anything else on them is kept
 * @param {object} o - cone (rad), range (m), clear(candidate) → nothing solid in between, skip (a candidate to pass over)
 */
function pickTarget(eye, yaw, pitch, candidates, { cone = 0.36, range = 75, clear = () => true, skip = null } = {}) {
  const fx = Math.sin(yaw) * Math.cos(pitch), fy = -Math.sin(pitch), fz = Math.cos(yaw) * Math.cos(pitch);
  let best = null, bestScore = Infinity;
  for (const c of candidates) {
    if (c === skip || c.ref && skip && c.ref === skip.ref) continue;
    const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1.2 || d > range) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dy * fy + dz * fz) / d)));
    // close up, a man fills the view: the cone opens so that he is not missed for standing a step aside
    if (angle > cone + Math.atan2(0.6, d)) continue;
    const score = angle + d * 0.0025;
    if (score < bestScore && clear(c)) { best = c; bestScore = score; }
  }
  return best;
}

class AimAssist {
  constructor() {
    this.enabled = true;
    this.target = null; // the candidate held, if any
    this.t = 0; // seconds since it was taken
    this.wasAiming = false;
    this.yaw = this.pitch = null; // where the assist left the view last frame
    this.cooldown = 0;
    this.result = { yaw: 0, pitch: 0, locked: false };
  }

  release() { this.target = null; this.t = 0; }

  /**
   * @param {number} dt
   * @param {boolean} aiming
   * @param {{x,y,z}} eye - camera position
   * @param {number} yaw, pitch - the view now (after this frame's input)
   * @param {Array} candidates - see pickTarget; each may carry `ref` (identity across frames) and `dead`
   * @param {Function} clear - line of sight to a candidate
   * @returns {?{yaw, pitch, locked}} where the view should look, or null to leave it alone
   */
  update(dt, aiming, eye, yaw, pitch, candidates, clear) {
    const hand = this.yaw === null ? 0 : Math.abs(wrap(yaw - this.yaw)) + Math.abs(pitch - this.pitch);
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!aiming || !this.enabled) {
      this.release();
      this.wasAiming = aiming;
      this.yaw = this.pitch = null;
      return null;
    }
    if (!this.wasAiming && this.cooldown <= 0) {
      this.target = pickTarget(eye, yaw, pitch, candidates, { clear });
      this.t = 0;
    }
    this.wasAiming = true;
    let held = this.target;
    if (held) {
      // the same person this frame (candidates are rebuilt every frame)
      const now = held.ref ? candidates.find((c) => c.ref === held.ref) : held;
      this.t += dt;
      // let go: he fell, he went behind a wall, the hand pulled away, or the moment has passed
      if (!now || now.dead || this.t > 1.15 || (this.t > 0.22 && hand > 0.012 + dt * 0.5) || (this.t > 0.3 && !clear(now))) {
        if (now && !now.dead && this.t <= 1.15) this.cooldown = 0.25;
        this.release();
        held = null;
      } else held = this.target = now;
    }
    if (!held) { this.yaw = yaw; this.pitch = pitch; return null; }
    const dx = held.x - eye.x, dy = held.y - eye.y, dz = held.z - eye.z;
    const wantYaw = Math.atan2(dx, dz), wantPitch = -Math.atan2(dy, Math.hypot(dx, dz));
    // onto him at once, then a hold that slackens until the hand has the sights again
    const k = 1 - Math.exp(-dt * (this.t < 0.28 ? 17 : 7 * (1 - (this.t - 0.28) / 0.87)));
    const r = this.result;
    r.yaw = yaw + wrap(wantYaw - yaw) * k;
    r.pitch = pitch + (wantPitch - pitch) * k;
    r.locked = true;
    this.yaw = r.yaw;
    this.pitch = r.pitch;
    return r;
  }
}

export { AimAssist, pickTarget };
