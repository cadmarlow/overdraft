// Flying bodies (0.9.1): the wingsuit, a small and draggy glider steered by its angle of attack and its bank, and the
// paraglider, a ram-air wing flown with two brake toggles and a speed bar. Both move through moving air: a breeze with
// gusts that strengthens with height, the lift that wind makes rising up the windward face of a tower, and the churn in
// the lee of one. Pure functions over plain objects: no rendering, no DOM (vertical.js flies them, tests check them).
//
// Units: metres, seconds, radians, newtons. y is up; heading follows the game (x += sin h, z += cos h); a positive bank
// lowers the right wing and turns right.

const G = 9.81;
const RHO = 1.2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---- The air --------------------------------------------------------------------------------------------------------
// Mean wind by weather (m/s at street level) and how gusty it is
const WEATHER_WIND = { clear: [3.5, 0.25], cloudy: [5.5, 0.3], rain: [7.5, 0.35], storm: [12, 0.45] };

class Wind {
  constructor(seed = 1) {
    this.dir = (seed * 2.399) % (Math.PI * 2); // where it blows towards
    this.base = WEATHER_WIND.clear[0];
    this.gust = WEATHER_WIND.clear[1];
    this.t = 0;
  }

  // The weather sets the strength; the direction wanders slowly
  update(dt, weather = 'clear') {
    this.t += dt;
    const [base, gust] = WEATHER_WIND[weather] ?? WEATHER_WIND.clear;
    this.base += (base - this.base) * (1 - Math.exp(-dt / 20));
    this.gust += (gust - this.gust) * (1 - Math.exp(-dt / 20));
    this.dir += Math.sin(this.t * 0.013) * 0.004 * dt;
  }

  // Air velocity at a point (written to out): stronger with height, gusting in time and across the city
  at(x, y, z, out) {
    const t = this.t, height = 1 + Math.min(1.6, Math.max(0, y) / 160);
    const g = 1 + this.gust * (Math.sin(t * 0.71 + x * 0.013) * 0.55 + Math.sin(t * 1.93 + z * 0.021) * 0.3 + Math.sin(t * 4.1 + (x + z) * 0.05) * 0.15);
    const swing = Math.sin(t * 0.37 + z * 0.004) * 0.25 * this.gust;
    const s = this.base * height * g;
    out.x = Math.sin(this.dir + swing) * s;
    out.z = Math.cos(this.dir + swing) * s;
    out.y = 0;
    return out;
  }
}

/**
 * Vertical air beside the buildings. `cast(x, y, z, dx, dz, max)` returns { d, top } for the first building along a
 * horizontal ray (d = Infinity when none). Downwind of the body, a facade the wind runs into sends the air up its face
 * (up to the roof and a little over it); upwind, a taller building leaves churning, sinking air in its lee.
 */
function buildingLift(x, y, z, wind, cast) {
  const speed = Math.hypot(wind.x, wind.z);
  if (speed < 0.5) return 0;
  const ux = wind.x / speed, uz = wind.z / speed;
  let lift = 0;
  const face = cast(x, y, z, ux, uz, 45);
  if (face.d < 45 && y < face.top + 30) {
    const near = 1 - face.d / 45, below = y < face.top ? 1 : 1 - (y - face.top) / 30;
    lift += speed * 0.95 * near * below;
  }
  const lee = cast(x, y, z, -ux, -uz, 60);
  if (lee.d < 60 && y < lee.top) lift -= speed * 0.35 * (1 - lee.d / 60);
  return lift;
}

// ---- The wingsuit -----------------------------------------------------------------------------------------------------
// A pilot of 90 kg in a suit with about 1.4 m² of wing. Lift and drag are written as areas (C × S): lift grows with the
// angle of attack up to a stall, drag is a profile part plus a part induced by lift.
const SUIT = {
  mass: 90,
  lift: 4.2, // m² of lift area per radian of attack
  drag0: 0.15,
  induced: 0.1,
  alphaMax: 0.44, // past this the suit stalls: lift collapses, drag jumps
  trim: 0.13, // the angle it flies at, hands off: about 3 to 1 near 180 km/h
  bite: 1400, // Pa: while the suit fills with air it lifts as if already at about 175 km/h, fading over its first seconds
  rollRate: 2.4, // rad/s
  bankMax: 1.35,
  // a body flies its turns with the arms too, not just the bank: a direct turn rate per unit of sin(bank), in rad/s
  carve: 0.45
};

function suitAreas(alpha) {
  const over = alpha - SUIT.alphaMax;
  const stalled = over > 0;
  const lift = stalled ? Math.max(0.22, SUIT.lift * SUIT.alphaMax * (1 - over * 4)) : SUIT.lift * Math.max(0, alpha);
  const drag = SUIT.drag0 + SUIT.induced * lift * lift + (stalled ? 0.35 * Math.min(1, over * 6) : 0);
  return { lift, drag, stalled };
}

// The lift direction for a velocity v̂ and a bank: the body's "up" square to the flight, turned about it. That up leans
// towards where the body faces (hx, hz): flying level it is the sky, falling straight down it is the way the head
// points, which is how a body falling flat starts to glide forward
function liftAxis(vx, vy, vz, bank, out, hx = 0, hz = 0) {
  const Rx = hx * 0.6, Ry = 1, Rz = hz * 0.6;
  const along = Rx * vx + Ry * vy + Rz * vz;
  let ux = Rx - along * vx, uy = Ry - along * vy, uz = Rz - along * vz;
  const l = Math.hypot(ux, uy, uz);
  if (l < 1e-4) { ux = hx; uy = 0; uz = hz; if (Math.abs(hx) + Math.abs(hz) < 1e-6) uz = 1; } else { ux /= l; uy /= l; uz /= l; }
  // right = v̂ × up
  const rx = vy * uz - vz * uy, ry = vz * ux - vx * uz, rz = vx * uy - vy * ux;
  const c = Math.cos(bank), s = Math.sin(bank);
  out.x = ux * c + rx * s; out.y = uy * c + ry * s; out.z = uz * c + rz * s;
  out.rx = rx; out.ry = ry; out.rz = rz;
  return out;
}

const _air = { x: 0, y: 0, z: 0 };
const _up = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };

/**
 * One step of the suit. s = { x, y, z, vx, vy, vz, alpha, bank } (+ speed, airspeed, stalled, gload written back);
 * c = { alpha: target angle of attack, bank: target bank }; air = { x, y, z } the air's own velocity there.
 */
function stepSuit(s, c, air, dt) {
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.alpha += (clamp(c.alpha, -0.05, 0.6) - s.alpha) * (1 - Math.exp(-h * 7));
    const db = clamp(c.bank, -SUIT.bankMax, SUIT.bankMax) - s.bank;
    s.bank += clamp(db, -SUIT.rollRate * h, SUIT.rollRate * h);
    const ax = s.vx - air.x, ay = s.vy - air.y, az = s.vz - air.z;
    const V = Math.max(0.5, Math.hypot(ax, ay, az));
    const vx = ax / V, vy = ay / V, vz = az / V;
    const { lift, drag, stalled } = suitAreas(s.alpha);
    const q = 0.5 * RHO * V * V;
    liftAxis(vx, vy, vz, s.bank, _up, Math.sin(c.heading ?? 0), Math.cos(c.heading ?? 0));
    // a suit just opened bites the air as if already flying, for its first seconds: a base jump off a 150 m roof flies
    s.t = (s.t || 0) + h;
    const qLift = Math.max(q, SUIT.bite * Math.max(0, 1 - s.t / 4.5));
    const L = qLift * lift / SUIT.mass, D = q * drag / SUIT.mass;
    s.vx += (_up.x * L - vx * D) * h;
    s.vy += (_up.y * L - vy * D - G) * h;
    s.vz += (_up.z * L - vz * D) * h;
    // the carve: the horizontal velocity swung round with the bank (asymmetric arms and legs)
    const turn = -SUIT.carve * Math.sin(s.bank) * Math.min(1, V / 40) * h, ct = Math.cos(turn), st = Math.sin(turn);
    const hx = s.vx * ct + s.vz * st, hz = -s.vx * st + s.vz * ct;
    s.vx = hx; s.vz = hz;
    // and the pitch the pilot puts in with the whole body (S up, Z down): the flight path swung up or down at once,
    // its speed kept, so a pull answers the moment it is asked for
    if (c.pitchRate) {
      const V2 = Math.hypot(s.vx, s.vy, s.vz);
      if (V2 > 2) {
        const nx = s.vx / V2, ny = s.vy / V2, nz = s.vz / V2;
        let px = -ny * nx, py = 1 - ny * ny, pz = -ny * nz; // up, square to the flight
        const pl = Math.hypot(px, py, pz);
        if (pl > 1e-3 && !(c.pitchRate > 0 && ny > 0.6)) {
          px /= pl; py /= pl; pz /= pl;
          const a = c.pitchRate * Math.min(1, V2 / 30) * h, ca = Math.cos(a), sa = Math.sin(a);
          s.vx = (nx * ca + px * sa) * V2; s.vy = (ny * ca + py * sa) * V2; s.vz = (nz * ca + pz * sa) * V2;
        }
      }
    }
    s.x += s.vx * h; s.y += s.vy * h; s.z += s.vz * h;
    s.airspeed = V;
    s.stalled = stalled;
    s.gload = L / G;
  }
  s.speed = Math.hypot(s.vx, s.vy, s.vz);
  return s;
}

/**
 * Stick to surfaces: what the pilot's hands and body do to fly where they look. `aim` = { yaw, pitch } is where the
 * camera points; keys = { dive, flare, left, right } (0..1) nudge it. Returns { alpha, bank } targets for stepSuit.
 */
function suitControl(s, aim, keys, out = {}) {
  const V = Math.max(1, Math.hypot(s.vx, s.vy, s.vz)), flat = Math.hypot(s.vx, s.vz);
  const yaw = Math.atan2(s.vx, s.vz), pitch = Math.asin(clamp(s.vy / V, -1, 1));
  // bank towards the aimed heading (the aim on the right: a right bank), harder the further it is; not before the suit
  // flies forward (a body still falling straight has no heading to bank from)
  const flying = clamp((flat - 6) / 10, 0, 1);
  const dyaw = wrap(aim.yaw - yaw);
  let bank = clamp(-dyaw * 2.4, -1.05, 1.05) * flying;
  bank += (keys.right - keys.left) * 1.2 * Math.max(0.3, flying);
  out.heading = flying > 0.5 ? yaw + clamp(dyaw, -0.4, 0.4) : aim.yaw;
  // attack to hold the aimed climb or dive, plus a little for what the bank takes away from holding the suit up
  const dpitch = clamp(aim.pitch - pitch, -0.9, 0.9);
  // slow, the suit needs all its attack to bend the fall into a glide; fast, a touch holds the line
  const gain = 0.4 + 0.5 * clamp(1 - V / 35, 0, 1);
  let alpha = SUIT.trim + dpitch * gain + Math.min(0.08, (1 / Math.max(0.3, Math.cos(s.bank)) - 1) * 0.08);
  // S pulls up hard (all the attack the suit has, short of a stall); Z noses down
  if (keys.flare > 0) alpha = alpha + (SUIT.alphaMax - 0.01 - alpha) * keys.flare;
  if (keys.dive > 0) alpha = alpha + (0.03 - alpha) * keys.dive;
  // nothing the pilot does stalls the suit: too slow, it mushes and the nose drops until it flies again
  out.alpha = clamp(alpha, 0.02, SUIT.alphaMax - 0.01);
  out.pitchRate = keys.flare * 0.65 - keys.dive * 0.45;
  out.bank = clamp(bank, -SUIT.bankMax, SUIT.bankMax);
  return out;
}

// The suit opening on a body already falling at (vx, vy, vz)
function openSuit(s, x, y, z, vx, vy, vz) {
  const speed = Math.hypot(vx, vy, vz);
  Object.assign(s, { x, y, z, vx, vy, vz, alpha: 0.12, bank: 0, speed, airspeed: speed, stalled: false, gload: 1, t: 0 });
  return s;
}

// What meeting the ground at this velocity is: 'land' (run it out), 'roll' (tumble, unhurt) or 'crash'
function suitTouchdown(vx, vy, vz) {
  const flat = Math.hypot(vx, vz), down = -vy;
  if (down < 6 && flat < 22) return 'land';
  if (down < 10 && flat < 36) return 'roll';
  return 'crash';
}

// ---- The paraglider ---------------------------------------------------------------------------------------------------
// A small, fast wing (a speed-flying glider): 45 km/h and 2.6 m/s of sink hands up, 60 km/h on the speed bar, slower
// and flatter on the brakes, a turn for a pull on one side that steepens into a spiral, and the flare: brakes pulled
// fast swing the wing up over the pilot and trade speed for a few seconds of almost no sink.
const WING = {
  trim: 12.5, bar: 4.5, brakeSlow: 6, // m/s of airspeed
  sink: 2.6, barSink: 1.6, // m/s
  turn: 0.75, // rad/s of turn per unit of brake difference, at trim speed
  stall: 0.92 // both brakes past this: the wing stalls
};

/**
 * One step of the wing. w = { x, y, z, heading, airspeed, vy, bank, brakeL, brakeR, bar, surge, open } ;
 * c = { left, right (0..1 brake), bar (0..1) }; air = the air's velocity; lift = rising air (m/s).
 */
function stepWing(w, c, air, lift, dt) {
  const k = 1 - Math.exp(-dt * 5);
  const prevBrake = (w.brakeL + w.brakeR) / 2;
  w.brakeL += (clamp(c.left, 0, 1) - w.brakeL) * k;
  w.brakeR += (clamp(c.right, 0, 1) - w.brakeR) * k;
  w.bar += (clamp(c.bar, 0, 1) * (1 - Math.max(w.brakeL, w.brakeR)) - w.bar) * k;
  const brake = (w.brakeL + w.brakeR) / 2, diff = w.brakeR - w.brakeL;
  // held right down for more than a second, both brakes stall the wing (a flare is quicker than that)
  w.deep = Math.min(w.brakeL, w.brakeR) > WING.stall ? (w.deep || 0) + dt : 0;
  const stalled = w.deep > 1.2;
  const target = stalled ? 4 : WING.trim + WING.bar * w.bar - WING.brakeSlow * brake * brake;
  // the flare: speed lost to the brakes swings into lift for a moment
  const before = w.airspeed;
  w.airspeed += (target - w.airspeed) * (1 - Math.exp(-dt * 1.6));
  const shed = Math.max(0, before - w.airspeed);
  if (brake > prevBrake) w.surge = Math.min(5, (w.surge || 0) + shed * 2.4);
  w.surge = (w.surge || 0) * Math.exp(-dt * 0.9);
  // turning, and the bank that comes with it
  const rate = WING.turn * diff * (w.airspeed / WING.trim) * (1 + Math.abs(diff) * 0.6);
  w.heading -= rate * dt;
  const bank = Math.atan(w.airspeed * rate / G);
  w.bank += (bank - w.bank) * (1 - Math.exp(-dt * 3));
  // sink: trim, the bar, the brakes (a little flatter, then mushing), the bank (a spiral sinks fast), a stall
  let sink = WING.sink + WING.barSink * w.bar - 0.5 * brake + Math.max(0, brake - 0.75) * 3;
  sink += (1 / Math.max(0.25, Math.cos(w.bank)) - 1) * 7;
  if (stalled) sink = 7.5;
  const vy = -sink + lift + w.surge;
  w.vy += (vy - w.vy) * (1 - Math.exp(-dt * 2.2));
  w.vx = Math.sin(w.heading) * w.airspeed + air.x;
  w.vz = Math.cos(w.heading) * w.airspeed + air.z;
  w.x += w.vx * dt; w.y += w.vy * dt; w.z += w.vz * dt;
  w.stalled = stalled;
  return w;
}

// The wing bursting open over a falling body: speed comes down over a second and a half, with a jolt
function openWing(w, x, y, z, heading, vx, vy, vz) {
  const flat = Math.hypot(vx, vz);
  Object.assign(w, { x, y, z, heading: flat > 3 ? Math.atan2(vx, vz) : heading, airspeed: Math.min(30, Math.max(WING.trim, flat)), vy,
    bank: 0, brakeL: 0, brakeR: 0, bar: 0, surge: 0, deep: 0, open: 0, stalled: false });
  return w;
}

function wingTouchdown(w) {
  const down = -w.vy, flat = Math.hypot(w.vx, w.vz);
  if (down < 3.6 && flat < 11) return 'land';
  if (down < 7) return 'roll';
  return 'crash';
}

// Brake and bar to fly where the camera looks; keys (0..1) override: left / right brake, both, bar
function wingControl(w, aim, keys, out = {}) {
  const dyaw = wrap(aim.yaw - w.heading);
  const steer = clamp(-dyaw * 0.9, -0.85, 0.85);
  out.left = clamp(Math.max(0, -steer) + keys.left + keys.brake, 0, 1);
  out.right = clamp(Math.max(0, steer) + keys.right + keys.brake, 0, 1);
  out.bar = keys.bar;
  return out;
}

export { Wind, buildingLift, SUIT, WING, suitAreas, liftAxis, stepSuit, suitControl, openSuit, suitTouchdown, stepWing, openWing, wingTouchdown, wingControl, smooth };
