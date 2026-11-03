// A car as a rigid body on four sprung wheels. Each wheel looks for the ground under its own mount, carries its own share
// of the weight through a spring and a damper, and grips through a tyre whose limit moves with that load, so braking dives,
// power squats, corners lean, and a car can leave the ground, land, roll over and slide on its roof. The engine turns
// through a gearbox into driven axles that can spin up past the road speed (burnouts) and the rear can be locked by the
// handbrake (slides). Nothing here touches three.js: gameplay reads the legacy planar fields (speed, vx, vz, angularVel,
// heading) that syncOut leaves on the car and any change it makes to them comes back in syncIn.
//
// Frame: +X left, +Y up, +Z forward; heading turns forward (+Z) towards +X. A car's origin (car.position) is on the ground
// under the middle of the car when it stands at rest.

const G = 9.81;
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;

// What makes one car drive differently from another. Forces in N, speeds in m/s; `top` is what the engine reaches on a long
// enough straight, for the AI and the dials.
// The driver aids are what make a keyboard enough: the wheel winds on over `wind` seconds at a standstill and `windHigh`
// at speed and comes back `unwind` times quicker; the stability aid holds the yaw the wheel asks for (`yawAid` against
// too much rotation, `yawHelp` for too little) and brings the nose back once the body slips past `slipMax` (rad); after
// the handbrake it comes back over `recover` seconds; `brakeSteer` is how much grip the brakes leave the tyres for
// turning at full lock. `leanRoll`/`leanPitch` (rad at 1 g) are how far the body is drawn leaning on its springs, on top
// of what the physics rolls it.
const BASE = {
  mass: 1500, cg: 0.54, bias: 0.53, hz: 1.6, damp: 0.33, rebound: 1.35, arb: 0.2, travel: 0.13, droop: 0.2,
  grip: 1.12, traction: 1.3, slide: 0.74, balance: 1.12, stiffness: 11, shape: 1.45, tc: 0.8, esc: 1,
  torque: 400, peak: 4200, redline: 6600, idle: 780, gears: [3.4, 2.15, 1.5, 1.14, 0.9, 0.72], reverse: 3.2, final: 3.7, rear: 1,
  shift: 0.17, spinMass: 230, brake: 12, handbrake: 0.42, cd: 0.42, down: 0, lock: 0.62, cornering: 11, steer: 6,
  roll: 0.85, pitch: 0.85, assist: 0.9, top: 58, nitro: 1,
  wind: 0.1, windHigh: 0.32, unwind: 1.8, yawAid: 9, yawHelp: 2.5, slipMax: 0.22, recover: 0.6, brakeSteer: 0.45, pivot: 5,
  leanRoll: 0.06, leanPitch: 0.035
};

const CLASSES = {
  sedan: { },
  taxi: { mass: 1650, cg: 0.56, hz: 1.55, damp: 0.3, torque: 320, gears: [3.2, 2.05, 1.42, 1.04, 0.8], grip: 1.04, roll: 0.9, top: 52, leanRoll: 0.07, leanPitch: 0.04 },
  suv: { mass: 2150, cg: 0.74, hz: 1.5, damp: 0.32, arb: 0.3, torque: 480, final: 3.4, grip: 1.0, rear: 0.5, roll: 0.85, cd: 0.56, top: 54, slipMax: 0.16, yawAid: 10, leanRoll: 0.085, leanPitch: 0.045 },
  offroad: { mass: 1900, cg: 0.76, hz: 1.35, damp: 0.3, travel: 0.2, droop: 0.26, torque: 430, gears: [3.6, 2.2, 1.45, 1.05, 0.8], grip: 1.02, rear: 0.5, roll: 0.85, cd: 0.62, top: 47, slipMax: 0.2, leanRoll: 0.09, leanPitch: 0.05 },
  pickup: { mass: 2200, cg: 0.72, bias: 0.57, hz: 1.45, damp: 0.3, torque: 520, grip: 0.98, balance: 1.03, tc: 0.5, esc: 0.9, final: 3.3, roll: 0.85, cd: 0.6, top: 53, slipMax: 0.2, leanRoll: 0.08, leanPitch: 0.045 },
  van: { mass: 2400, cg: 0.86, bias: 0.55, hz: 1.45, damp: 0.3, torque: 400, final: 3.9, gears: [3.3, 2.0, 1.4, 1.0, 0.76], grip: 0.92, roll: 0.8, cd: 0.72, lock: 0.56, cornering: 8.5, top: 44, slipMax: 0.16, yawAid: 10, leanRoll: 0.085, leanPitch: 0.045 },
  minivan: { mass: 1950, cg: 0.68, hz: 1.6, torque: 350, rear: 0, grip: 0.98, roll: 0.85, cd: 0.56, top: 50, leanRoll: 0.08, leanPitch: 0.04 },
  truck: { mass: 4600, cg: 1.0, bias: 0.5, hz: 1.5, damp: 0.34, torque: 900, final: 4.3, gears: [4.2, 2.6, 1.7, 1.2, 0.86], redline: 3800, peak: 2200, idle: 650, shift: 0.3, grip: 0.86, brake: 8.5, roll: 0.8, cd: 1.0, lock: 0.54, cornering: 7, spinMass: 500, top: 34, slipMax: 0.14, yawAid: 11, leanRoll: 0.07, leanPitch: 0.04 },
  hatch: { mass: 1250, cg: 0.5, bias: 0.58, hz: 1.95, torque: 300, redline: 7000, rear: 0, final: 3.9, grip: 1.14, roll: 0.78, top: 56 },
  compact: { mass: 1100, cg: 0.5, bias: 0.58, hz: 1.9, torque: 210, rear: 0, final: 4.1, redline: 6800, grip: 1.08, roll: 0.85, cd: 0.4, top: 48 },
  wagon: { mass: 1650, cg: 0.56, hz: 1.7, torque: 380, rear: 1, roll: 0.88, top: 58 },
  // Too much engine for its tyres: it squats, lights up the rear and kicks out on the throttle
  muscle: { mass: 1620, cg: 0.5, bias: 0.55, hz: 1.7, damp: 0.3, torque: 760, peak: 3600, redline: 6200, gears: [2.9, 1.95, 1.42, 1.08, 0.85, 0.66], final: 3.55, grip: 1.14, balance: 0.98, slide: 0.76, tc: 0.3, esc: 0.75, roll: 0.85, pitch: 1, cd: 0.42, top: 71, slipMax: 0.45, yawAid: 6, pivot: 4.5, leanRoll: 0.065, leanPitch: 0.055 },
  sport: { mass: 1320, cg: 0.42, bias: 0.46, hz: 2.3, damp: 0.38, arb: 0.34, torque: 700, peak: 5400, redline: 8200, gears: [3.1, 2.2, 1.68, 1.32, 1.06, 0.86, 0.72], final: 3.55, shift: 0.1, grip: 1.36, balance: 1.03, slide: 0.78, tc: 0.55, esc: 0.85, roll: 0.6, cd: 0.42, down: 0.5, lock: 0.56, top: 88, slipMax: 0.3, yawAid: 8, pivot: 3.5, leanRoll: 0.04, leanPitch: 0.025 },
  // Glued down by its tyres and its underbody, and it never stops pulling
  super: { mass: 1380, cg: 0.4, bias: 0.44, hz: 2.5, damp: 0.42, arb: 0.4, travel: 0.1, droop: 0.15, torque: 980, peak: 5800, redline: 9000, gears: [3.0, 2.3, 1.85, 1.55, 1.3, 1.12, 1.0], final: 3.35, rear: 0.68, shift: 0.07, grip: 1.5, balance: 1.06, slide: 0.8, stiffness: 13, tc: 0.75, esc: 0.9, roll: 0.5, cd: 0.5, down: 1.05, lock: 0.54, brake: 15, top: 96, slipMax: 0.2, pivot: 3.5, leanRoll: 0.028, leanPitch: 0.018 },
  cruiser: { mass: 1850, cg: 0.54, hz: 1.95, damp: 0.4, arb: 0.34, torque: 640, peak: 4000, redline: 6600, final: 3.7, grip: 1.26, balance: 1.1, slide: 0.8, roll: 0.78, brake: 13.5, top: 68 }
};

const makeTune = (kind, geometry) => ({ ...BASE, ...(CLASSES[kind] || CLASSES.sedan), ...geometry });

// Everything derived from a tune once: spring rates for a resting sag common to all four corners, inertia of a filled box
function createBody(tune, spawnHeading = 0) {
  const t = tune, r = t.wheelRadius;
  const wheelbase = t.wheelZf - t.wheelZr;
  const cgZ = t.wheelZr + wheelbase * t.bias;
  const axles = [t.mass * t.bias * 0.5, t.mass * (1 - t.bias) * 0.5];
  const omega = TAU * t.hz;
  const sag = G / (omega * omega);
  const spring = axles.map((m) => m * omega * omega);
  const damper = axles.map((m) => 2 * t.damp * Math.sqrt(m * m * omega * omega));
  const h = t.height, w = t.halfW * 2, l = t.halfL * 2;
  const body = {
    q: [0, Math.sin(spawnHeading / 2), 0, Math.cos(spawnHeading / 2)],
    vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
    r: new Float64Array(9),
    cgZ, sag, spring, damper, heading: spawnHeading, speed: 0, svx: 0, svz: 0, syaw: 0,
    ix: t.mass * (h * h + l * l) / 12 * 0.8, iy: t.mass * (w * w + l * l) / 12 * 0.9, iz: t.mass * (w * w + h * h) / 12 * 0.9,
    wheels: [[1, t.wheelZf, 0], [-1, t.wheelZf, 0], [1, t.wheelZr, 1], [-1, t.wheelZr, 1]].map(([side, z, axle]) => ({
      side, z, axle, x: side * t.wheelX, y: r, front: axle === 0,
      gy: 0, ready: false, travel: 0, comp: sag, load: 0, contact: false, hasGround: false,
      nx: 0, ny: 1, nz: 0, px: 0, py: 0, pz: 0, roll: side * 7 + z, grip: 1, rough: 0, ox: 0, oz: 0,
      spin: 0, angle: 0, slip: 0, lock: false, vLong: 0, vLat: 0
    })),
    axle: [{ spin: 0, slip: 0 }, { spin: 0, slip: 0 }],
    gear: 0, shift: 0, rpm: t.idle, throttle: 0, brake: 0, steer: 0, reversing: false,
    steerIn: 0, aid: 1, lockNow: t.lock, beta: 0, exit: 0, peakSlip: Math.tan(Math.PI * 0.5 / t.shape) / t.stiffness,
    airborne: 0, grounded: 0, scrape: 0, flipT: 0, hard: 0, landed: 0, skid: 0, smoke: 0, nitro: 0, kick: 0,
    hull: hullPoints(t), scrapeX: 0, scrapeY: 0, scrapeZ: 0, shiftUp: 0, backfire: 0
  };
  return body;
}

function hullPoints(t) {
  // The low points sit above kerb height: a sill on a sidewalk edge scrapes, it does not act as a ramp
  const hw = t.halfW * 0.97, hl = t.halfL * 0.97, low = Math.max(t.sill ?? 0.26, 0.3), top = t.height * 0.97, roofW = t.halfW * 0.78, roofL = t.halfL * 0.5;
  return [[hw, low, hl], [-hw, low, hl], [hw, low, -hl], [-hw, low, -hl],
    [roofW, top, roofL], [-roofW, top, roofL], [roofW, top, -roofL * 1.2], [-roofW, top, -roofL * 1.2],
    [hw, top * 0.6, hl * 0.9], [-hw, top * 0.6, hl * 0.9], [hw, top * 0.62, -hl * 0.9], [-hw, top * 0.62, -hl * 0.9]];
}

function refreshAxes(b) {
  const [x, y, z, w] = b.q, r = b.r;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  // Columns: the body's +X, +Y, +Z in the world
  r[0] = 1 - 2 * (yy + zz); r[1] = 2 * (xy + wz); r[2] = 2 * (xz - wy);
  r[3] = 2 * (xy - wz); r[4] = 1 - 2 * (xx + zz); r[5] = 2 * (yz + wx);
  r[6] = 2 * (xz + wy); r[7] = 2 * (yz - wx); r[8] = 1 - 2 * (xx + yy);
}

// Forces gathered during a step (about the centre of mass)
const sum = { fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0 };
function force(fx, fy, fz, rx, ry, rz) {
  sum.fx += fx; sum.fy += fy; sum.fz += fz;
  sum.tx += ry * fz - rz * fy;
  sum.ty += rz * fx - rx * fz;
  sum.tz += rx * fy - ry * fx;
}

// Angular velocity change for a torque-like (world) vector, through the body's inertia
function applyAngular(b, tx, ty, tz, scale) {
  const r = b.r;
  const ax = (r[0] * tx + r[1] * ty + r[2] * tz) / b.ix;
  const ay = (r[3] * tx + r[4] * ty + r[5] * tz) / b.iy;
  const az = (r[6] * tx + r[7] * ty + r[8] * tz) / b.iz;
  b.wx += (r[0] * ax + r[3] * ay + r[6] * az) * scale;
  b.wy += (r[1] * ax + r[4] * ay + r[7] * az) * scale;
  b.wz += (r[2] * ax + r[5] * ay + r[8] * az) * scale;
}

const hit = { y: 0, nx: 0, ny: 1, nz: 0, grip: 1, rough: 0, curb: false };

// Peak then fall-off of a tyre's sideways force against its slip angle
function lateralCurve(alpha, stiffness, shape, slide) {
  const a = Math.abs(alpha), top = Math.PI * 0.5 / shape, x = Math.atan(stiffness * a);
  const force = x < top ? Math.sin(shape * x) : lerp(1, slide, clamp((x - top) / 0.42, 0, 1));
  return alpha < 0 ? -force : force;
}

function torqueAt(t, rpm) {
  const x = rpm / t.peak;
  const shape = x < 1 ? 0.62 + 0.38 * Math.sin(x * Math.PI / 2) : 1 - 0.34 * ((x - 1) / (t.redline / t.peak - 1 || 1)) ** 2;
  return t.torque * shape;
}

// The gearbox and the two axles: engine force into each driven axle, wheelspin, the shift points
function driveline(c, input, h, axleV, axleGrip) {
  const b = c.body, t = c.tune;
  const r = t.wheelRadius;
  const forwardSpeed = (axleV[0] + axleV[1]) * 0.5;
  const wantsReverse = input.throttle < 0 && forwardSpeed < 1;
  const wantsForward = input.throttle > 0 && forwardSpeed > -1;
  if (wantsReverse && !b.reversing) { b.reversing = true; b.gear = 0; }
  else if (wantsForward && b.reversing) { b.reversing = false; b.gear = 0; }
  const pedal = (b.reversing ? wantsReverse : wantsForward) ? Math.abs(input.throttle) : 0;
  b.throttle += (pedal - b.throttle) * (1 - Math.exp(-h * (pedal > b.throttle ? 16 : 26)));
  const ratio = (b.reversing ? -t.reverse : t.gears[b.gear]) * t.final;
  const rear = t.rear, front = 1 - rear;
  const driven = (b.axle[0].spin * front + b.axle[1].spin * rear) || 0;
  const wheelRpm = Math.abs(driven / r * ratio) * 60 / TAU;
  const launching = wheelRpm < t.idle * 2.2;
  const clutchRpm = launching ? lerp(t.idle, Math.min(t.peak * 0.75, t.idle + 2600), b.throttle) : 0;
  const target = clamp(Math.max(wheelRpm, clutchRpm, t.idle), t.idle, t.redline * 1.03);
  b.rpm += (target - b.rpm) * (1 - Math.exp(-h * (b.shift > 0 ? 12 : 30)));
  let engine = 0;
  if (b.shift > 0) b.shift -= h;
  else {
    const limiter = b.rpm >= t.redline ? 0.15 : 1;
    engine = torqueAt(t, b.rpm) * b.throttle * limiter * (b.nitro > 0 ? 1.55 : 1) * (b.power ?? 1);
    if (input.throttle === 0 || !pedal) engine -= t.torque * 0.2 * (b.rpm / t.redline) ** 2 * Math.min(1, Math.abs(driven) * 0.25) * (b.handbraking ? 0 : 1);
  }
  let force = engine * ratio / r * 0.9;
  // Traction control eases the engine off a spinning axle and out of a slide, as far as this car has any
  const worst = Math.max(Math.abs(b.axle[0].slip) * front, Math.abs(b.axle[1].slip) * rear);
  force *= 1 - t.tc * clamp((worst - 1.6) / 2.4, 0, 1);
  // and the stability control takes power away from a car sliding past its drift angle
  if (!b.reversing && forwardSpeed > 4) force *= 1 - 0.75 * clamp((Math.abs(b.beta) - t.slipMax * 0.7) / 0.35, 0, 1) * b.aid * t.esc * (1 - b.exit * 0.8);
  // Automatic box: up near the limiter once the tyres have hooked up, down early with the foot in
  const top = t.gears.length - 1;
  const spinning = Math.abs(b.axle[1].slip) > 3 && rear > 0.4;
  if (!b.reversing && b.shift <= 0) {
    if (b.gear < top && b.rpm > t.redline * 0.965 && !spinning && wheelRpm > t.redline * 0.9) {
      b.gear++; b.shift = t.shift; b.shiftUp = 1; b.backfire = b.throttle > 0.7 ? 1 : b.backfire; b.kick = 1;
    } else if (b.gear > 0) {
      const lower = wheelRpm * t.gears[b.gear - 1] / t.gears[b.gear];
      if (lower < t.redline * (0.62 + 0.26 * b.throttle) && wheelRpm < t.peak * (0.62 + 0.3 * b.throttle)) {
        b.gear--; b.shift = t.shift * 0.5;
        b.backfire = b.throttle < 0.2 && forwardSpeed > 12 ? 0.6 : b.backfire;
      }
    }
  }
  // Each axle is a mass spun by its share of the force and held back by the road
  for (let i = 0; i < 2; i++) {
    const axle = b.axle[i], share = i === 0 ? front : rear;
    const grip = axleGrip[i], road = axleV[i];
    if (!(grip > 0)) {
      axle.spin += (share ? force * share / t.spinMass : -axle.spin * 0.8) * h;
      axle.spin += (road - axle.spin) * (share ? 0 : 1 - Math.exp(-h * 2));
      axle.slip = axle.spin - road;
      axle.force = 0;
      continue;
    }
    const locked = i === 1 && b.handbraking;
    if (locked) { axle.spin = 0; axle.slip = -road; axle.force = -Math.sign(road) * grip * t.slide; continue; }
    if (!share) { axle.spin = road; axle.slip = 0; axle.force = 0; continue; }
    const slip = axle.spin - road, s = slip / 1.3, abs = Math.abs(s);
    const curve = (abs < 1 ? Math.sin(s * Math.PI / 2) : Math.sign(s) * lerp(1, t.slide, clamp((abs - 1) / 4, 0, 1)));
    axle.force = grip * curve;
    const rate = 1 / (t.spinMass * share);
    axle.spin += (force * share - axle.force) * rate * h;
    // Stiff at the top of the curve: a step must not carry the axle past the slip at which the road holds the engine (it
    // would ring about it); it settles there. Settling on no slip at all, whatever the engine pushed, once held a car
    // still for good with its foot down.
    if (Math.abs(force * share) < grip) {
      const settle = Math.asin(force * share / grip) * 2 / Math.PI * 1.3;
      if ((slip - settle) * (axle.spin - road - settle) < 0) axle.spin = road + settle;
    }
    axle.slip = axle.spin - road;
  }
}

function steerStep(c, input, h, vLongBody, vLatBody) {
  const b = c.body, t = c.tune;
  const v = Math.abs(vLongBody);
  // A key is all or nothing: the wheel winds on over a time that grows with speed, so a tap is a small correction and a
  // held key a full turn, and comes back to the centre (or over to the other side) quicker. An AI's input is its own.
  const want = clamp(input.steer || 0, -1, 1);
  if (c.ai) b.steerIn = want;
  else {
    const back = Math.abs(want) < Math.abs(b.steerIn) || want * b.steerIn < 0;
    const rate = (back ? t.unwind : 1) / lerp(t.wind, t.windHigh, clamp(v / 30, 0, 1));
    b.steerIn = clamp(want, b.steerIn - rate * h, b.steerIn + rate * h);
  }
  // At speed the wheels go no further than what brings the front tyres to their best grip: past it they only scrub
  const wheelbase = t.wheelZf - t.wheelZr;
  const road = Math.atan(wheelbase * t.cornering / Math.max(v * v, 1));
  const grip = Math.min(t.lock, road + b.peakSlip * 0.9);
  // With the handbrake on the wheel is free to go further: that is what swings the car round
  const lock = b.lockNow = lerp(Math.min(t.lock, grip + 0.3), grip, b.aid);
  let target = b.steerIn * lock;
  // The wheels follow the way the car is travelling: a slide catches itself. Not while the handbrake swings the tail.
  if (vLongBody > 3) target += clamp(Math.atan2(vLatBody, vLongBody) * t.assist * (0.35 + 0.65 * b.aid) * (1 - b.exit), -t.lock * 0.8, t.lock * 0.8);
  b.steer = clamp(target, b.steer - t.steer * h, b.steer + t.steer * h);
  c.steerAngle = b.steer;
}

function substep(c, input, h, world) {
  const b = c.body, t = c.tune, p = c.position, r = b.r, wheels = b.wheels;
  refreshAxes(b);
  sum.fx = sum.fy = sum.fz = sum.tx = sum.ty = sum.tz = 0;
  const ax = r[0], ay = r[1], az = r[2], ux = r[3], uy = r[4], uz = r[5], fx = r[6], fy = r[7], fz = r[8];
  // Centre of mass relative to the origin
  const ox = ux * t.cg + fx * b.cgZ, oy = uy * t.cg + fy * b.cgZ, oz = uz * t.cg + fz * b.cgZ;
  const cx = p.x + ox, cy = p.y + oy, cz = p.z + oz;
  const vLongBody = b.vx * fx + b.vy * fy + b.vz * fz, vLatBody = b.vx * ax + b.vy * ay + b.vz * az;
  steerStep(c, input, h, vLongBody, vLatBody);
  const wr = t.wheelRadius, grip0 = world.grip ?? 1;
  const cosS = Math.cos(b.steer), sinS = Math.sin(b.steer);
  const axleV = axleSpeed, axleGrip = axleLimit;
  axleV[0] = axleV[1] = 0; axleGrip[0] = axleGrip[1] = 0;
  let touching = 0, axleCount0 = 0, axleCount1 = 0;

  // 1. Springs: each wheel finds its ground, the spring pushes along the ground's normal
  for (const w of wheels) {
    const hx = p.x + ax * w.x + ux * w.y + fx * w.z;
    const hy = p.y + ay * w.x + uy * w.y + fy * w.z;
    const hz = p.z + az * w.x + uz * w.y + fz * w.z;
    world.ground(hx, hz, hit);
    w.ox = hx; w.oz = hz;
    if (!w.ready) { w.gy = hit.y; w.ready = true; }
    // A tyre rides up a step rather than teleporting onto it: quicker the faster it is rolling
    const climb = (hit.ny < 0.999 ? 40 : Math.min(4.5, 2.2 + Math.abs(vLongBody) * 0.9)) * h;
    w.gy = hit.y > w.gy ? Math.min(hit.y, w.gy + climb) : Math.max(hit.y, w.gy - climb * 2.5);
    w.nx = hit.nx; w.ny = hit.ny; w.nz = hit.nz; w.grip = hit.grip * grip0; w.rough = hit.rough; w.curb = hit.curb;
    const d = Math.abs(vLongBody) * h;
    w.roll += d;
    const bump = hit.rough ? hit.rough * (Math.sin(w.roll * 1.9) + 0.6 * Math.sin(w.roll * 5.3 + w.side) + 0.35 * Math.sin(w.roll * 13.1)) : 0;
    const upright = uy > 0.2;
    const distance = upright ? (hy - w.gy - bump) / Math.max(uy, 0.2) : 99;
    const comp = b.sag + wr - distance;
    w.contact = upright && distance < wr + t.droop;
    w.hasGround = w.contact && comp > 0;
    w.travel += (clamp(wr - distance, -t.droop, t.travel + 0.05) - w.travel) * (w.contact ? 1 : 1 - Math.exp(-h * 14));
    if (!w.contact) w.travel = Math.max(w.travel - h * 1.1, -t.droop);
    let load = 0;
    if (w.hasGround) {
      const rate = clamp((comp - w.comp) / h, -4, 4);
      const damper = b.damper[w.axle] * (rate > 0 ? 1 : t.rebound) * rate;
      load = b.spring[w.axle] * comp + damper;
      const bottomed = comp - b.sag - t.travel;
      if (bottomed > 0) load += b.spring[w.axle] * bottomed * 14 + Math.max(0, rate) * b.damper[w.axle] * 3.5;
      // A wheel driven deep into the ground by a blow must not throw the car over the rooftops
      load = Math.min(load, t.mass * G * 2.4);
      w.comp = comp;
    } else w.comp = Math.max(comp, 0);
    w.load = load;
    if (w.contact) touching++;
    w.px = hx - ux * distance; w.py = hy - uy * distance; w.pz = hz - uz * distance;
  }
  // Anti-roll bars tie the two sides of each axle
  for (const [l, rr, k] of [[wheels[0], wheels[1], b.spring[0]], [wheels[2], wheels[3], b.spring[1]]]) {
    if (!l.hasGround || !rr.hasGround) continue;
    const f = (l.comp - rr.comp) * k * t.arb;
    l.load = Math.max(0, l.load + f); rr.load = Math.max(0, rr.load - f);
  }
  const nominal = t.mass * G * 0.25;
  const brakeInput = (input.throttle < 0 && vLongBody > 0.8 && !b.reversing) || (input.throttle > 0 && vLongBody < -0.8) ? Math.abs(input.throttle) : 0;
  b.brake = brakeInput;
  b.handbraking = !!input.handbrake;
  for (const w of wheels) {
    if (!w.contact || !w.hasGround) continue;
    const n = hit;
    const sx = w.front ? cosS : 1, sy = w.front ? sinS : 0;
    // The tyre's forward and sideways directions on the ground
    let tx = fx * sx + ax * sy, ty = fy * sx + ay * sy, tz = fz * sx + az * sy;
    const dot = tx * w.nx + ty * w.ny + tz * w.nz;
    tx -= w.nx * dot; ty -= w.ny * dot; tz -= w.nz * dot;
    const len = Math.hypot(tx, ty, tz) || 1;
    tx /= len; ty /= len; tz /= len;
    w.tx = tx; w.ty = ty; w.tz = tz;
    const rx = w.px - cx, ry = w.py - cy, rz = w.pz - cz;
    const vx = b.vx + b.wy * rz - b.wz * ry, vy = b.vy + b.wz * rx - b.wx * rz, vz = b.vz + b.wx * ry - b.wy * rx;
    w.vLong = vx * tx + vy * ty + vz * tz;
    w.lx = w.ny * tz - w.nz * ty; w.ly = w.nz * tx - w.nx * tz; w.lz = w.nx * ty - w.ny * tx;
    w.vLat = vx * w.lx + vy * w.ly + vz * w.lz;
    w.limit = w.load * t.grip * (w.axle === 1 ? t.balance : 1) * w.grip * Math.max(0.72, 1 - 0.1 * (w.load / nominal - 1)) * (w.burst ? 0.4 : 1);
    axleV[w.axle] += w.vLong; axleGrip[w.axle] += w.limit * t.traction;
    if (w.axle === 0) axleCount0++; else axleCount1++;
  }
  axleV[0] = axleCount0 ? axleV[0] / axleCount0 : b.axle[0].spin;
  axleV[1] = axleCount1 ? axleV[1] / axleCount1 : b.axle[1].spin;
  b.beta = Math.abs(vLongBody) > 2 ? Math.atan2(vLatBody, Math.abs(vLongBody)) : 0;
  driveline(c, input, h, axleV, axleGrip);

  // 2. Tyres: what the driveline and the brakes ask of each one, within a friction circle shared with cornering
  let skid = 0;
  for (const w of wheels) {
    if (!w.hasGround) { w.slip *= Math.exp(-h * 12); w.spin = w.axle === 0 && !t.rear ? b.axle[0].spin / wr : w.spin + (b.axle[w.axle].spin / wr - w.spin) * 0.2; continue; }
    const rx = w.px - cx, ry = w.py - cy, rz = w.pz - cz;
    const axle = b.axle[w.axle], share = axleGrip[w.axle] > 0 ? w.limit * t.traction / axleGrip[w.axle] : 0;
    let fLong = (axle.force || 0) * share;
    // Brakes, front biased, with an ABS that never quite locks
    if (brakeInput) {
      const wanted = t.mass * t.brake * brakeInput * (w.front ? 0.31 : 0.19);
      const stop = Math.abs(w.vLong) * t.mass * 0.25 / h * 0.4;
      // Braking with the wheel turned, the ABS leaves the tyres the grip to steer: the car turns as it slows
      const keep = 1 - t.brakeSteer * Math.min(1, Math.abs(b.steerIn)) * (w.front ? 1 : 0.7);
      fLong -= Math.sign(w.vLong) * Math.min(wanted, stop, w.limit * t.traction * 0.98 * keep);
    }
    const alpha = Math.atan2(w.vLat, Math.abs(w.vLong) + 1.1);
    // A tyre travelling sideways cannot push along its own axis: the road's force lies along the slide
    const reach = w.limit * t.traction * Math.max(0.15, Math.cos(alpha));
    fLong = clamp(fLong, -reach, reach);
    const room = Math.sqrt(Math.max(0.04, 1 - (fLong / (reach || 1)) ** 2));
    let fLat = -w.limit * room * lateralCurve(alpha, t.stiffness, t.shape, t.slide);
    if (!w.front && b.handbraking) fLat *= t.handbrake;
    const wheelSlip = Math.abs(axle.slip) > 2 ? Math.abs(axle.slip) : 0;
    const sideSlip = Math.abs(alpha) > 0.16 ? Math.abs(w.vLat) : 0;
    const braking = brakeInput && Math.abs(w.vLong) > 6 ? Math.max(0, w.load / nominal - 0.6) * 2 : 0;
    w.lock = !w.front && b.handbraking && Math.abs(w.vLong) > 1;
    w.slip = Math.max(wheelSlip * (w.axle === 1 ? t.rear : 1 - t.rear) * 1.2, sideSlip, w.lock ? Math.abs(w.vLong) : 0, braking);
    skid = Math.max(skid, w.slip);
    w.spin = w.lock ? 0 : axle.spin / wr;
    // Normal force at the patch; tyre forces act nearer the centre of mass, which is what keeps a car from rolling in a turn
    const nf = w.load;
    force(w.nx * nf, w.ny * nf, w.nz * nf, rx, ry, rz);
    const up = ry * uy + rx * ux + rz * uz;
    const hl = up * (1 - t.roll), hp = up * (1 - t.pitch);
    force(w.lx * fLat, w.ly * fLat, w.lz * fLat, rx - ux * hl, ry - uy * hl, rz - uz * hl);
    force(w.tx * fLong, w.ty * fLong, w.tz * fLong, rx - ux * hp, ry - uy * hp, rz - uz * hp);
  }
  b.skid += (skid - b.skid) * (1 - Math.exp(-h * 18));
  b.grounded = touching;
  for (const w of wheels) w.angle = (w.angle + (w.spin || 0) * h) % TAU;

  // 3. The air: drag, the underbody at speed, gravity
  const speed = Math.hypot(b.vx, b.vy, b.vz);
  const drag = t.cd * speed;
  sum.fx -= b.vx * drag; sum.fy -= b.vy * drag; sum.fz -= b.vz * drag;
  if (t.down && touching) {
    const down = t.down * speed * speed;
    sum.fx -= ux * down; sum.fy -= uy * down; sum.fz -= uz * down;
  }
  sum.fy -= t.mass * G;
  if (b.nitro > 0) {
    const push = t.mass * 4.2 * t.nitro;
    sum.fx += fx * push; sum.fy += fy * push; sum.fz += fz * push;
  }
  // Pursuers out of the player's sight close the gap (wanted.js); nothing to see, no flames
  if (b.chase > 0 && touching) {
    const push = t.mass * b.chase;
    sum.fx += fx * push; sum.fz += fz * push;
  }
  // In the water: it floats a moment, then the river comes in
  if (world.waterLevel !== undefined && cy < world.waterLevel + 0.4) {
    const under = clamp((world.waterLevel + 0.4 - cy) / 1.4, 0, 1);
    sum.fy += t.mass * G * 0.94 * under;
    const drag = Math.exp(-h * 2.4 * under);
    b.vx *= drag; b.vy *= drag; b.vz *= drag; b.wx *= drag; b.wy *= drag; b.wz *= drag;
    b.throttle = 0;
  }
  // Rolling resistance, and a parked car stays parked
  if (touching) {
    const roll = 0.016 * t.mass * G / Math.max(speed, 1.5);
    sum.fx -= b.vx * roll; sum.fz -= b.vz * roll;
  }

  // 4. Bodywork on the ground: sills on a kerb, a roof sliding along the road
  let scrape = 0;
  if (touching < 4 || uy < 0.97) {
    const hull = b.hull;
    const stiff = t.mass * 240, drip = t.mass * 26;
    for (const point of hull) {
      const px = point[0], py = point[1], pz = point[2] - 0;
      const wx = p.x + ax * px + ux * py + fx * pz, wy = p.y + ay * px + uy * py + fy * pz, wz = p.z + az * px + uz * py + fz * pz;
      if (wy > 1.5 + p.y && wy > 2.5) continue;
      world.ground(wx, wz, hit);
      const depth = hit.y - wy;
      if (depth <= 0) continue;
      const rx = wx - cx, ry = wy - cy, rz = wz - cz;
      const vx = b.vx + b.wy * rz - b.wz * ry, vy = b.vy + b.wz * rx - b.wx * rz, vz = b.vz + b.wx * ry - b.wy * rx;
      const n = Math.min(t.mass * G * 3, Math.max(0, stiff * Math.min(depth, 0.25) - drip * vy));
      const slide = Math.hypot(vx, vz) || 1;
      const mu = (uy > 0.5 ? 0.16 : hit.grip < 0.7 ? 0.5 : 0.36) * n / slide;
      force(-vx * mu, n, -vz * mu, rx, ry, rz);
      if (slide > 2.5 && slide > scrape) { scrape = slide; b.scrapeX = wx; b.scrapeY = hit.y + 0.03; b.scrapeZ = wz; }
    }
  }
  b.scrape = scrape;

  // 5. Steering the body in the air, and a helping hand back onto the wheels when it stops on its side or its roof
  if (!touching) {
    b.airborne += h;
    const stick = t.mass * 3.1;
    sum.tx += (ax * input.throttle * stick * 1.1 - fx * input.steer * stick);
    sum.ty += (ay * input.throttle * stick * 1.1 - fy * input.steer * stick) + input.steer * stick * 0.5;
    sum.tz += (az * input.throttle * stick * 1.1 - fz * input.steer * stick);
    const damp = Math.exp(-h * 0.5);
    b.wx *= damp; b.wy *= damp; b.wz *= damp;
    // A car in the air settles level, the way cars do on screen: it lands on its wheels unless something sent it spinning
    if (uy > 0.35) {
      const level = t.mass * 6;
      sum.tx -= uz * level; sum.tz += ux * level;
      const still = Math.exp(-h * 1.6);
      b.wx *= still; b.wz *= still;
    }
  } else if (b.airborne > 0) {
    b.landed = Math.max(b.landed, b.airborne);
    b.airborne = 0;
  }
  if (uy < 0.45 && speed < 3.5) {
    b.flipT += h;
    if (b.flipT > 1 && !c.parked) {
      const k = t.mass * 8 * Math.min(1, b.flipT - 1);
      let ex = -uz, ez = ux;
      if (Math.abs(ex) + Math.abs(ez) < 0.05) { ex = fx; ez = fz; }
      const len = Math.hypot(ex, ez) || 1;
      sum.tx += ex / len * k * 1.3; sum.tz += ez / len * k * 1.3;
      sum.fy += t.mass * 6;
    }
  } else if (uy > 0.8) b.flipT = 0;
  // Stability control. It holds the yaw the wheel asks for, no more than the tyres can give: rotating past it (or the
  // wrong way) is braked hard, short of it gets a gentle push. Past this car's drift angle the nose is brought back round
  // to where the car is going. Off while the handbrake is held, it comes back as the car is driven out of the slide.
  // Letting go of the handbrake with the car swung round: it keeps the way it now points and the slide comes round to
  // follow it, rather than the nose swinging back to where the car was going (that undid every handbrake turn)
  const slipNow = Math.atan2(vLatBody, Math.abs(vLongBody));
  if (b.held && !input.handbrake && Math.abs(slipNow) > 0.25 && speed > 3) b.exit = 1;
  b.held = !!input.handbrake;
  b.exit = Math.max(0, b.exit - h / 1.1);
  b.aid = input.handbrake ? Math.max(0, b.aid - h * 6) : Math.min(1, b.aid + h / t.recover);
  if (touching >= 2 && speed > 1.5) {
    const aid = b.aid * t.esc;
    const wheelbase = t.wheelZf - t.wheelZr;
    // A handbrake turn may spin the car as quick as a pivot allows, and no quicker: it stays a turn the wheel holds
    const most = Math.max(t.grip * G * 1.05 / speed, (1 - b.aid) * 1.7);
    const want = clamp(vLongBody * Math.tan(b.steerIn * b.lockNow) / wheelbase, -most, most);
    const yaw = b.wx * ux + b.wy * uy + b.wz * uz;
    const err = yaw - want;
    const over = yaw * want < 0 ? Math.abs(yaw) > 0.05 : Math.abs(yaw) > Math.abs(want);
    const torque = over ? -err * b.iy * t.yawAid : -clamp(err, -0.5, 0.5) * b.iy * t.yawHelp;
    const cap = t.mass * (over ? 11 : 3);
    const k = clamp(torque, -cap, cap) * Math.max(aid, b.exit * t.esc, input.handbrake ? 0.55 : 0);
    sum.tx += ux * k; sum.ty += uy * k; sum.tz += uz * k;
    const slip = Math.atan2(vLatBody, Math.abs(vLongBody));
    const past = clamp((Math.abs(slip) - t.slipMax) / 0.3, 0, 1);
    if (past) sum.ty += Math.sign(slip) * past * t.mass * 12 * aid * (1 - b.exit);
    if (b.exit > 0 && Math.abs(slip) > 0.1) {
      const side = clamp(-vLatBody * t.mass * 4, -t.mass * G * 0.9, t.mass * G * 0.9) * b.exit;
      sum.fx += ax * side; sum.fy += ay * side; sum.fz += az * side;
    }
    // A handbrake turn: the locked rear lets go and the car pivots the way the wheel points, as quick as the speed allows
    if (input.handbrake && Math.abs(b.steerIn) > 0.1 && Math.abs(yaw) < 1.8) sum.ty += b.steerIn * t.mass * t.pivot * clamp(speed / 12, 0, 1) * Math.sign(vLongBody);
  }

  // 6. Integrate
  const im = h / t.mass;
  b.vx += sum.fx * im; b.vy = Math.min(b.vy + sum.fy * im, 13); b.vz += sum.fz * im;
  applyAngular(b, sum.tx, sum.ty, sum.tz, h);
  // Stopped with nothing pushing: hold still rather than creep on tiny forces
  if (touching === 4 && input.throttle === 0 && Math.abs(b.vx) + Math.abs(b.vz) < 0.12 && Math.abs(b.wy) < 0.05) { b.vx = b.vz = 0; b.wy = 0; }
  const [qx, qy, qz, qw] = b.q;
  const half = h * 0.5, wx = b.wx * half, wy = b.wy * half, wz = b.wz * half;
  const nx = qx + wx * qw + wy * qz - wz * qy;
  const ny = qy - wx * qz + wy * qw + wz * qx;
  const nz = qz + wx * qy - wy * qx + wz * qw;
  const nw = qw - wx * qx - wy * qy - wz * qz;
  const nl = Math.hypot(nx, ny, nz, nw) || 1;
  b.q[0] = nx / nl; b.q[1] = ny / nl; b.q[2] = nz / nl; b.q[3] = nw / nl;
  // The centre of mass moved; the origin hangs off it
  refreshAxes(b);
  p.x = cx + b.vx * h - (r[3] * t.cg + r[6] * b.cgZ);
  p.y = cy + b.vy * h - (r[4] * t.cg + r[7] * b.cgZ);
  p.z = cz + b.vz * h - (r[5] * t.cg + r[8] * b.cgZ);
}
const axleSpeed = [0, 0], axleLimit = [0, 0];

// Legacy planar state in: the rest of the game edits speed/vx/vz/angularVel directly
function syncIn(c) {
  const b = c.body;
  if (Math.abs(c.heading - b.heading) > 1e-9) {
    // Teleported or spawned to a new heading: stands level on it
    const yaw = c.heading * 0.5;
    b.q[0] = 0; b.q[1] = Math.sin(yaw); b.q[2] = 0; b.q[3] = Math.cos(yaw);
    b.vy = b.wx = b.wz = 0;
    for (const w of b.wheels) w.ready = false;
  }
  takePlanar(c);
}

// What gameplay did to the planar velocity since the body last wrote it (a contact just resolved, a blast) goes into the
// body, once
function takePlanar(c) {
  const b = c.body;
  if (c.speed !== b.speed || c.vx !== b.svx || c.vz !== b.svz) {
    const sin = Math.sin(c.heading), cos = Math.cos(c.heading);
    b.vx = sin * c.speed + (c.vx || 0);
    b.vz = cos * c.speed + (c.vz || 0);
  }
  b.wy += (c.angularVel || 0) - b.syaw;
  b.speed = c.speed; b.svx = c.vx; b.svz = c.vz; b.syaw = c.angularVel || 0;
}

function syncOut(c) {
  const b = c.body;
  refreshAxes(b);
  const fx = b.r[6], fz = b.r[8];
  if (fx * fx + fz * fz > 0.04) c.heading = Math.atan2(fx, fz);
  b.heading = c.heading;
  const sin = Math.sin(c.heading), cos = Math.cos(c.heading);
  c.speed = b.vx * sin + b.vz * cos;
  c.vx = b.vx - sin * c.speed;
  c.vz = b.vz - cos * c.speed;
  c.angularVel = b.wy;
  b.speed = c.speed; b.svx = c.vx; b.svz = c.vz; b.syaw = c.angularVel;
}

/**
 * Advances a car by dt.
 * @param {object} input - throttle in [-1, 1] (backwards brakes, then reverses), steer in [-1, 1] (+ left), handbrake, nitro
 * @param {object} world - ground(x, z, hit) fills hit.y, hit.nx/ny/nz, hit.grip, hit.rough; grip: weather factor; collide(car)
 */
function stepCar(c, input, dt, world) {
  if (dt <= 0) return;
  syncIn(c);
  const steps = Math.min(16, Math.ceil(dt * (c.ai ? 120 : 200)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    substep(c, input, h, world);
    if (world.collide) {
      syncOut(c);
      world.collide(c);
      syncIn(c);
    }
  }
  syncOut(c);
}

// A world contact at (px, py, pz) with a horizontal normal. Returns the closing speed it removed.
function impactBody(c, px, py, pz, nx, ny, nz, restitution = 0.14, friction = 0.32) {
  const b = c.body, t = c.tune, p = c.position;
  refreshAxes(b);
  const r = b.r;
  const ox = r[3] * t.cg + r[6] * b.cgZ, oy = r[4] * t.cg + r[7] * b.cgZ, oz = r[5] * t.cg + r[8] * b.cgZ;
  const rx = px - p.x - ox, ry = py - p.y - oy, rz = pz - p.z - oz;
  const vx = b.vx + b.wy * rz - b.wz * ry, vy = b.vy + b.wz * rx - b.wx * rz, vz = b.vz + b.wx * ry - b.wy * rx;
  const vn = vx * nx + vy * ny + vz * nz;
  if (vn >= 0) return 0;
  const k = (ax, ay, az) => {
    // Inverse effective mass of the point along (ax, ay, az)
    const cx = ry * az - rz * ay, cy = rz * ax - rx * az, cz = rx * ay - ry * ax;
    const lx = (r[0] * cx + r[1] * cy + r[2] * cz), ly = (r[3] * cx + r[4] * cy + r[5] * cz), lz = (r[6] * cx + r[7] * cy + r[8] * cz);
    return 1 / t.mass + lx * lx / b.ix + ly * ly / b.iy + lz * lz / b.iz;
  };
  const j = -(1 + restitution) * vn / k(nx, ny, nz);
  const apply = (ax, ay, az, m) => {
    b.vx += ax * m / t.mass; b.vy += ay * m / t.mass; b.vz += az * m / t.mass;
    applyAngular(b, (ry * az - rz * ay) * m, (rz * ax - rx * az) * m, (rx * ay - ry * ax) * m, 1);
  };
  apply(nx, ny, nz, j);
  // Panels scraping: friction against the sliding direction, bounded by the blow
  let tx = vx - vn * nx, ty = vy - vn * ny, tz = vz - vn * nz;
  const slide = Math.hypot(tx, ty, tz);
  if (slide > 0.01) {
    tx /= slide; ty /= slide; tz /= slide;
    apply(tx, ty, tz, -Math.min(friction * j, slide / k(tx, ty, tz)));
  }
  return -vn;
}

// A kick from outside (another car, a blast): impulse (N·s) at a world point. It adds to whatever the planar velocity was
// just given: a contact resolved on speed/vx/vz a moment before must not be undone by the kick that follows it.
function kickBody(c, px, py, pz, jx, jy, jz) {
  const b = c.body, t = c.tune, p = c.position;
  if (!b) return;
  takePlanar(c);
  refreshAxes(b);
  const r = b.r;
  const rx = px - p.x - (r[3] * t.cg + r[6] * b.cgZ), ry = py - p.y - (r[4] * t.cg + r[7] * b.cgZ), rz = pz - p.z - (r[5] * t.cg + r[8] * b.cgZ);
  b.vx += jx / t.mass; b.vy += jy / t.mass; b.vz += jz / t.mass;
  applyAngular(b, ry * jz - rz * jy, rz * jx - rx * jz, rx * jy - ry * jx, 1);
  c.speed = b.vx * Math.sin(c.heading) + b.vz * Math.cos(c.heading);
  c.vx = b.vx - Math.sin(c.heading) * c.speed; c.vz = b.vz - Math.cos(c.heading) * c.speed;
  c.angularVel = b.wy;
  b.speed = c.speed; b.svx = c.vx; b.svz = c.vz; b.syaw = c.angularVel;
}

// A shunt from another car (impulse in N·s, at the contact point x, z): the body jolts up on its springs, leaning a
// little towards the side that was hit. The push goes up near the centre of mass and only into a car standing on its
// wheels: pushed up at the bumper itself, a car tips over, and kicked again on every frame of a long contact one stood
// on its tail in a Times Square jam and took off over the traffic.
const SHUNT = { lift: 0.05, most: 1, lean: 0.3 };
function shuntBody(c, x, z, impulse) {
  const b = c.body, t = c.tune, p = c.position;
  if (!b || !(impulse > 0)) return 0;
  refreshAxes(b);
  const r = b.r;
  if (b.grounded < 2 || r[4] < 0.9) return 0;
  const lift = Math.min(impulse * SHUNT.lift, t.mass * SHUNT.most);
  const cx = p.x + r[3] * t.cg + r[6] * b.cgZ, cy = p.y + r[4] * t.cg + r[7] * b.cgZ, cz = p.z + r[5] * t.cg + r[8] * b.cgZ;
  kickBody(c, cx + (x - cx) * SHUNT.lean, cy, cz + (z - cz) * SHUNT.lean, 0, lift, 0);
  return lift;
}

// A car rammed out of the traffic (gameplay.js takedown) by a blow of `impulse` N·s at (x, z): its struck end pops up
// off its springs and it comes back down on its wheels. Pushed up at the bumper with a fifth of the blow, up to 6.5 m/s,
// cars stood on their nose and flipped at city speeds.
const POP = { lift: 0.1, most: 2.5, lean: 0.6 };
function popBody(c, x, z, impulse) {
  const p = c.position;
  if (!c.body || !(impulse > 0)) return;
  kickBody(c, p.x + (x - p.x) * POP.lean, p.y + 0.25, p.z + (z - p.z) * POP.lean, 0, Math.min(impulse * POP.lift, c.tune.mass * POP.most), 0);
}

// Puts a car down at rest on the spot (teleports, respawns, a car summoned from the garage)
function settleBody(c, heading = c.heading) {
  const b = c.body;
  c.heading = heading; b.heading = heading;
  b.q[0] = 0; b.q[1] = Math.sin(heading / 2); b.q[2] = 0; b.q[3] = Math.cos(heading / 2);
  b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
  b.flipT = 0; b.airborne = 0; b.rpm = c.tune.idle; b.gear = 0; b.shift = 0; b.chase = 0;
  b.axle[0].spin = b.axle[1].spin = 0;
  c.speed = c.vx = c.vz = c.angularVel = 0;
  b.speed = b.svx = b.svz = b.syaw = 0;
  for (const w of b.wheels) { w.ready = false; w.comp = b.sag; w.travel = 0; w.load = 0; w.slip = 0; }
  refreshAxes(b);
}

export { CLASSES, createBody, impactBody, kickBody, makeTune, popBody, refreshAxes, settleBody, shuntBody, stepCar, torqueAt };
