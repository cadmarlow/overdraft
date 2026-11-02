// Driving worth a mention: a car brushed past at speed, a long slide, a big jump. Each pays a little, tops the nitro up, and
// chains into the next while the chain lasts.

const CHAIN = 4.5; // seconds before a run of tricks is over
const MISS_GAP = 1.15; // metres of air between two bodies that still counts as close
const MISS_SPEED = 14;

class StuntScore {
  constructor(game) {
    this.game = game;
    this.chain = 0;
    this.chainT = 0;
    this.drift = 0;
    this.driftHold = 0;
    this.lastHit = -10;
    this.clock = 0;
    this.best = {};
  }

  crashed() { this.lastHit = this.clock; this.chain = 0; this.drift = 0; }

  award(title, money, detail = '') {
    const g = this.game;
    this.chain = this.chainT > 0 ? this.chain + 1 : 1;
    this.chainT = CHAIN;
    const amount = Math.round(money * Math.min(5, this.chain));
    g.addMoney(amount);
    g.hud.stunt(title, detail, amount, this.chain);
    g.car.nitro = Math.min(1, g.car.nitro + 0.1);
    g.audio.ui?.('cash', 0.3);
  }

  // One other vehicle at (x, z): passing it close at speed
  passing(item, x, z, halfW, car, sin, cos, closing) {
    const dx = x - car.position.x, dz = z - car.position.z;
    if (Math.abs(dx) > 9 || Math.abs(dz) > 9) { item._ahead = undefined; return; }
    const ahead = dx * sin + dz * cos, side = dx * cos - dz * sin;
    const was = item._ahead;
    item._ahead = ahead;
    if (was === undefined || was <= 0 || ahead > 0) return;
    const gap = Math.abs(side) - halfW - car.halfW;
    if (gap < 0.05 || gap > MISS_GAP || closing < 6 || this.clock - this.lastHit < 1) return;
    this.award('FRÔLEMENT', 20 + closing * 2, `${gap.toFixed(1).replace('.', ',')} m`);
  }

  update(dt) {
    const g = this.game, car = g.car;
    this.clock += dt;
    if (this.chainT > 0) this.chainT -= dt;
    if (g.state !== 'driving' || !car.body) { this.drift = 0; return; }
    const b = car.body, speed = Math.hypot(b.vx, b.vz);
    const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
    if (speed > MISS_SPEED) {
      for (const v of g.traffic.vehicles) {
        if (!v.edge) continue;
        this.passing(v, v.x, v.z, v.halfWidth ?? 0.9, car, sin, cos, speed - v.speed * Math.cos((v.yaw ?? 0) - car.heading));
      }
      for (const c of g.highway?.cars ?? []) if (c.placed && !c.hidden) this.passing(c, c.x, c.z, c.halfW, car, sin, cos, speed - c.v * Math.cos(c.yaw - car.heading));
    }
    // A slide: sideways with the wheels on the road, for long enough to be meant
    const lateral = Math.hypot(car.vx, car.vz);
    const sliding = b.grounded >= 2 && speed > 8 && lateral > 3.2 && Math.atan2(lateral, Math.abs(car.speed)) > 0.22;
    if (sliding) { this.drift += speed * dt; this.driftHold = 0.5; }
    else if (this.drift > 0) {
      this.driftHold -= dt;
      if (this.driftHold <= 0) {
        if (this.drift > 18) this.award('DÉRAPAGE', this.drift * 1.4, `${Math.round(this.drift)} m`);
        this.drift = 0;
      }
    }
    // A jump is judged as it lands, and the top of a big one is worth a moment in the air
    if (b.airborne > 0.05) {
      b.flight = (b.flight ?? 0) + dt; b.flightFrom ??= [car.position.x, car.position.z];
      if (b.flight > 0.3 && !b.flightSlowed && speed > 18 && b.vy < 2.6) {
        b.flightSlowed = true;
        if (!g.slowMo) g.slowMo = 0.7;
      }
    }
    else if (b.flight > 0) {
      if (b.flight > 0.8) {
        const far = Math.hypot(car.position.x - b.flightFrom[0], car.position.z - b.flightFrom[1]);
        this.award(b.r[4] > 0.7 ? 'SAUT' : 'CASCADE', far * 4 + b.flight * 40, `${Math.round(far)} m`);
      }
      b.flight = 0; b.flightFrom = null; b.flightSlowed = false;
    }
  }
}

export { StuntScore };
