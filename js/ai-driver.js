// AI driving for gameplay cars (police pursuers, mission couriers, fleeing targets): a road route from the street
// graph followed by pure pursuit (a steering point slid along the route ahead of the car), speed planned from the bends
// ahead, traffic in the corridor steered round, and a reverse-and-retry when wedged. Uses the shared car physics.

const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

class AIDriver {
  /**
   * @param {object} opts - maxSpeed (m/s), corner (m/s through a right-angle turn), traffic (array of traffic vehicles),
   *   repath (s between route searches), avoid (steer round traffic)
   */
  constructor(controllers, nav, car, { maxSpeed = 30, corner = 9, traffic = null, repath = 2.2, avoid = true } = {}) {
    Object.assign(this, { controllers, nav, car, maxSpeed, corner, traffic, repathEvery: repath, avoid });
    this.path = null;
    this.seg = 0;
    this.repathT = 0;
    this.goalX = 0; this.goalZ = 0;
    this.stuckT = 0;
    this.reverseT = 0;
    this.throttle = 0;
    this.steer = 0;
    this.aim = { x: 0, z: 0 };
    this.arrived = false;
  }

  // Route to (x, z), searched again when the goal has moved or the route has aged
  setGoal(x, z, force = false) {
    const moved = Math.hypot(x - this.goalX, z - this.goalZ);
    this.goalX = x; this.goalZ = z;
    if (force || !this.path || moved > 25) this.repathT = 0;
  }

  replan() {
    const c = this.car.position;
    const route = this.nav.route(c.x, c.z, this.goalX, this.goalZ, 8000);
    this.path = route ? [{ x: c.x, z: c.z }, ...route] : [{ x: c.x, z: c.z }, { x: this.goalX, z: this.goalZ }];
    this.seg = 0;
    this.repathT = this.repathEvery;
  }

  // Closest point on the route from the current segment a few segments on; advances this.seg
  project(x, z) {
    const p = this.path;
    let best = Infinity, bestSeg = this.seg, bestT = 0;
    for (let i = this.seg; i < Math.min(p.length - 1, this.seg + 5); i++) {
      const a = p[i], b = p[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
      const d = (a.x + dx * t - x) ** 2 + (a.z + dz * t - z) ** 2;
      if (d < best) { best = d; bestSeg = i; bestT = t; }
    }
    this.seg = bestSeg;
    return { seg: bestSeg, t: bestT, dist: Math.sqrt(best) };
  }

  // The point `distance` metres along the route from (seg, t)
  along(seg, t, distance, out) {
    const p = this.path;
    let i = seg;
    let a = p[i], b = p[i + 1];
    let rest = distance + t * Math.hypot(b.x - a.x, b.z - a.z);
    while (i < p.length - 1) {
      a = p[i]; b = p[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (rest <= len || i === p.length - 2) {
        const k = len > 0 ? Math.min(1, rest / len) : 1;
        out.x = a.x + (b.x - a.x) * k;
        out.z = a.z + (b.z - a.z) * k;
        return out;
      }
      rest -= len;
      i++;
    }
    out.x = p[p.length - 1].x; out.z = p[p.length - 1].z;
    return out;
  }

  /**
   * One driving step towards the goal.
   * @param {object} o - direct (aim straight at the goal), stopAt (metres from the goal to stop in), speedCap
   */
  update(dt, { direct = false, stopAt = 0, speedCap = Infinity } = {}) {
    const car = this.car;
    const pos = car.position;
    const speed = car.speed;
    this.repathT -= dt;
    if (!direct && (!this.path || this.repathT <= 0)) this.replan();
    const goalD = Math.hypot(this.goalX - pos.x, this.goalZ - pos.z);
    this.arrived = goalD < Math.max(4, stopAt);

    // Steering point and the bend ahead
    let target = this.maxSpeed;
    const aim = this.aim;
    if (direct || !this.path) {
      aim.x = this.goalX; aim.z = this.goalZ;
    } else {
      const pr = this.project(pos.x, pos.z);
      if (pr.dist > 30) this.repathT = 0; // knocked off the route
      const look = clamp(5 + Math.abs(speed) * 0.55, 5, 24);
      this.along(pr.seg, pr.t, look, aim);
      // heading change between here and further along: plan the speed to take it
      const far = this.along(pr.seg, pr.t, clamp(14 + Math.abs(speed) * 1.6, 14, 60), { x: 0, z: 0 });
      const near = this.along(pr.seg, pr.t, 4, { x: 0, z: 0 });
      const h1 = Math.atan2(near.x - pos.x, near.z - pos.z), h2 = Math.atan2(far.x - near.x, far.z - near.z);
      const bend = Math.abs(angleTo(h1, h2));
      target = Math.min(target, this.corner + (this.maxSpeed - this.corner) * clamp(1 - bend / 1.3, 0, 1));
    }

    // Traffic in the corridor ahead: steer round it, ease off when it fills the lane
    const sinH = Math.sin(car.heading), cosH = Math.cos(car.heading);
    let blocked = Infinity, shift = 0;
    if (this.avoid) {
      const reach = 6 + Math.abs(speed) * 1.1;
      const consider = (x, z) => {
        const dx = x - pos.x, dz = z - pos.z;
        if (Math.abs(dx) > reach + 4 || Math.abs(dz) > reach + 4) return;
        const ahead = dx * sinH + dz * cosH, side = dx * cosH - dz * sinH;
        if (ahead < 1.5 || ahead > reach || Math.abs(side) > 2.7) return;
        blocked = Math.min(blocked, ahead);
        shift += (side >= 0 ? -1 : 1) * (2.9 - Math.abs(side));
      };
      if (this.traffic) for (const v of this.traffic) if (v.edge) consider(v.x, v.z);
      // other gameplay cars (cruisers, parked or wrecked cars)
      if (this.others) for (const c of this.others) if (c !== car && c.mesh?.visible) consider(c.position.x, c.position.z);
      // round the obstacle on the side it leaves free, by most of a lane
      if (shift) { const k = Math.sign(shift) * Math.min(4.5, Math.abs(shift) * 1.8); aim.x += cosH * k; aim.z -= sinH * k; }
    }

    const desired = Math.atan2(aim.x - pos.x, aim.z - pos.z);
    const delta = angleTo(car.heading, desired);
    let steer = clamp(delta * 2.3, -1, 1);
    if (Math.abs(delta) > 0.6) target = Math.min(target, this.corner * (Math.abs(delta) > 1.4 ? 0.6 : 1));
    if (blocked < 12) target = Math.min(target, Math.max(7, blocked * 1.1));
    if (stopAt > 0) target = Math.min(target, Math.max(0, (goalD - stopAt) * 0.8));
    target = Math.min(target, speedCap);

    let throttle = speed < target - 0.5 ? 1 : speed > target + 2 ? -clamp((speed - target) / 6, 0.3, 1) : 0.15;
    if (target <= 0.1 && Math.abs(speed) < 0.6) throttle = 0;

    // Wedged: back out with the wheel the other way, then try again
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      throttle = -1;
      steer = -steer;
    } else if (target > 2 && throttle > 0.5 && Math.abs(speed) < 1) {
      this.stuckT += dt;
      if (this.stuckT > 1.2) { this.reverseT = 0.9 + Math.random() * 0.6; this.stuckT = 0; this.repathT = 0.5; }
    } else {
      this.stuckT = Math.max(0, this.stuckT - dt);
    }
    this.throttle = throttle;
    this.steer = steer;
    this.blocked = blocked;
    this.target = target;
    this.controllers.simulateCar(car, throttle, steer, target <= 0.1 && Math.abs(speed) < 3, dt);
    car.mesh.position.copy(car.position);
    car.mesh.rotation.y = car.heading;
  }

  // Next point of the route (for off-screen catch-up warps)
  nextPoint() {
    if (!this.path || this.seg >= this.path.length - 1) return null;
    return { p: this.path[this.seg + 1], q: this.path[Math.min(this.path.length - 1, this.seg + 2)] };
  }
}

export { AIDriver };
