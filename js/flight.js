// An aircraft as a rigid body in the air. The wing lifts by its angle of attack and lets go past the stall, drag grows
// with lift, the engine pushes along the nose, and the undercarriage is three sprung wheels that roll, steer and brake.
// So speed is energy: a climb spends it, a dive buys it back, a hard turn bleeds it, and too slow the wing stops flying.
// The stick does not turn the aircraft directly: it asks for an angle of attack (pitch), a roll rate (ailerons) and a
// sideslip (rudder), and the airframe answers with the authority the air gives it at that speed.
//
// What makes a keyboard enough: hands off, the aircraft holds its path (it trims itself for the lift a straight line
// needs, banked or not) and rolls its wings level; the stick stops short of the stall and of the airframe's g limit;
// the rudder keys alone fly a gentle banked turn. Everything else is the pilot's.
//
// Nothing here touches three.js. Frame: +X left, +Y up, +Z forward; heading turns forward (+Z) towards +X. Gameplay
// reads the legacy fields left on the aircraft by every step (heading, pitch, roll, speed, verticalSpeed, onGround,
// crashed). An aircraft's origin (a.position) is its centre of gravity.

const G = 9.81;
const RHO0 = 1.225;
const SOUND = 340;
const STEP = 1 / 200;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// What makes one aircraft fly differently from another. SI units, angles in radians.
//   wing        area, span, lift slope per radian, zero-lift angle, stall angle, what a stalled plate still lifts
//   drag        cd0 clean, induced factor (cd = k cl²), gear, flaps, airbrake, the plate a stalled wing becomes
//   engine      'prop': shaft power and static thrust; 'jet': dry thrust and what the afterburner adds; spool in 1/s
//   stick       alphaMax/alphaMin it can ask for, g limits, roll rate, sideslip the rudder holds, wind-up in 1/s
//   response    pitch/yaw as a spring and damper on the angle (k in 1/s², d in 1/s), roll as a rate follower (1/s)
//   qRef        dynamic pressure at which the controls have their full authority
//   wash        how much of that authority the propeller's wash keeps on the tail at full power, standing still
//   gear        wheels: x left, y below the centre of gravity (tyre bottom, strut extended), z forward
//   hull        points that must not touch anything: nose, tail, wing tips, belly, fin
const BASE = {
  alpha0: -0.02, clSlope: 4.8, stall: 0.28, clPlate: 1.0,
  cd0: 0.03, induced: 0.06, cdGear: 0.02, cdFlaps: 0.04, cdBrake: 0.05, cdPlate: 1.7, cdSide: 0.25,
  flapLift: 0.45, flapStall: -0.03, sideSlope: 0.45,
  idle: 0.06, spoolUp: 2.5, spoolDown: 2.5, lapse: 1,
  alphaMax: 0.25, alphaMin: -0.14, gMax: 5.5, gMin: -2.5,
  rollRate: 2.4, rollK: 9, level: 1.5, dihedral: 0.5, lean: 0.75,
  pitchK: 46, pitchD: 11, pitchDamp: 0.8,
  yawK: 16, yawD: 6.5, yawDamp: 0.9, rudderSlip: 0.2, rudderPower: 1.6, adverse: 0,
  stickRate: 4.5, stickBack: 7, stickRoll: 4,
  wash: 0, torque: 0, pfactor: 0, wave: 0, waveHigh: 0, ram: 0,
  turbulence: 1,
  gearTime: 0, gearSink: 5.5, crashSink: 9, strikeSpeed: 16, crashSpeed: 38,
  muLat: 0.9, muRoll: 0.025, muBrake: 0.55, muScrape: 0.5,
  vRotate: 30, alphaClimb: 0.14, alphaGround: 0
};

const AIRCRAFT = {
  // A 1930s radial-engined biplane: light on its wings, flies at a jog, turns inside a city block, floats onto an avenue.
  // The big propeller swings the nose with power, the ailerons drag the nose the wrong way, and the tail sits on a wheel.
  classic: {
    engine: 'prop', mass: 1150, area: 27.6, span: 9.8, length: 7.7,
    alpha0: -0.035, clSlope: 4.6, stall: 0.295, clPlate: 1.05,
    cd0: 0.052, induced: 0.062, cdGear: 0, cdFlaps: 0, flapLift: 0, cdPlate: 1.8,
    power: 335000, staticThrust: 5600, propEff: 0.8, disc: 0.9, spoolUp: 3.2, spoolDown: 3.6, idle: 0.03, lapse: 1,
    alphaMax: 0.262, alphaMin: -0.16, gMax: 5.2, gMin: -3,
    rollRate: 2.5, rollK: 8, level: 1.7, dihedral: 0.9,
    pitchK: 40, pitchD: 10, yawK: 13, yawD: 5.2, rudderSlip: 0.13, rudderPower: 1.3, adverse: 0.5,
    qRef: 560, wash: 0.5, torque: 0.5, pfactor: 0.07, turbulence: 1.6, sideSlope: 0.55,
    stickRate: 4.2, stickBack: 6.5, stickRoll: 4,
    kx: 1.5, ky: 2.3, kz: 1.9,
    tail: true, vRotate: 24, alphaClimb: 0.15, alphaGround: 0.184, alphaRun: 0.035,
    gearSink: 7.5, crashSink: 10.5, strikeSpeed: 14,
    gear: [
      // measured on the model (assets/aircraft/classic.bin `points`; tests/aircraft-fit.test.mjs holds them together)
      { x: 0.78, y: -1.52, z: 0.95, hz: 2.6, damp: 0.5, travel: 0.22, brake: true },
      { x: -0.78, y: -1.52, z: 0.95, hz: 2.6, damp: 0.5, travel: 0.22, brake: true },
      { x: 0, y: -0.4, z: -5.07, hz: 3.4, damp: 0.6, travel: 0.1, steer: -1, castor: 0.55 }
    ],
    hull: [
      { kind: 'nose', x: 0, y: 0.03, z: 2.2 }, { kind: 'prop', x: 0, y: -1.24, z: 2 }, { kind: 'tail', x: 0, y: 0.55, z: -5.45 },
      { kind: 'tipL', x: 4.85, y: 1.09, z: -0.2 }, { kind: 'tipR', x: -4.85, y: 1.09, z: -0.2 },
      { kind: 'tipL', x: 4.85, y: -0.49, z: -0.2 }, { kind: 'tipR', x: -4.85, y: -0.49, z: -0.2 },
      { kind: 'belly', x: 0, y: -0.63, z: -0.08 }, { kind: 'fin', x: 0, y: 1.28, z: -4.96 }
    ]
  },
  // A single-engine fighter: heavy for its wing, quick only when it is fast, with a reheat that pushes harder than it
  // weighs. It turns on g, not on rudder: nine tonnes carving at 28° a second, and the speed pays for every degree.
  jet: {
    engine: 'jet', mass: 9200, area: 28, span: 5.93, length: 16.7,
    alpha0: 0, clSlope: 3.9, stall: 0.44, clPlate: 1.15,
    cd0: 0.06, induced: 0.105, cdGear: 0.045, cdFlaps: 0.05, cdBrake: 0.12, cdPlate: 1.5,
    flapLift: 0.4, sideSlope: 0.35,
    thrust: 45000, afterburner: 85000, spoolUp: 0.9, spoolDown: 1.3, idle: 0.08, lapse: 0.75,
    alphaMax: 0.4, alphaMin: -0.17, gMax: 8, gMin: -3,
    rollRate: 4.6, rollK: 11, level: 1.2, dihedral: 0.15, lean: 1,
    pitchK: 62, pitchD: 13.5, yawK: 22, yawD: 8, rudderSlip: 0.08, rudderPower: 1.2,
    qRef: 3600, turbulence: 0.45, muBrake: 0.8,
    stickRate: 5, stickBack: 8, stickRoll: 3,
    kx: 3.6, ky: 4.4, kz: 1.7,
    wave: 0.5, waveHigh: 8.5, ram: 0.9, gearTime: 2.4, vRotate: 68, alphaClimb: 0.2, alphaGround: 0,
    gearSink: 8, crashSink: 11, strikeSpeed: 18,
    gear: [
      // measured on the model (assets/aircraft/jet.bin `points`)
      { x: 1.284, y: -1.95, z: -0.85, hz: 2.4, damp: 0.55, travel: 0.3, brake: true },
      { x: -1.284, y: -1.95, z: -0.85, hz: 2.4, damp: 0.55, travel: 0.3, brake: true },
      { x: 0, y: -1.968, z: 3.93, hz: 2.6, damp: 0.6, travel: 0.25, steer: 1 }
    ],
    hull: [
      { kind: 'nose', x: 0, y: -0.68, z: 9.5 }, { kind: 'tail', x: 0, y: 1.59, z: -7.05 },
      { kind: 'tipL', x: 2.96, y: -0.885, z: -0.92 }, { kind: 'tipR', x: -2.96, y: -0.885, z: -0.92 },
      { kind: 'belly', x: 0, y: -1.16, z: 1.03 }, { kind: 'belly', x: 0, y: -1.55, z: -1.85 }, { kind: 'fin', x: 0, y: 1.83, z: -5.85 }
    ]
  }
};

const makeTune = (kind, overrides = null) => {
  const t = { ...BASE, ...(AIRCRAFT[kind] || AIRCRAFT.classic), ...overrides, kind };
  const weight = t.mass * G;
  t.clMax = t.clSlope * (t.stall - t.alpha0);
  // the speed the wing stops flying at, clean and in landing configuration, at sea level
  t.vStall = Math.sqrt(2 * weight / (RHO0 * t.area * t.clMax));
  t.vStallLanding = Math.sqrt(2 * weight / (RHO0 * t.area * (t.clMax + t.flapLift)));
  t.vCorner = t.vStall * Math.sqrt(t.gMax);
  return t;
};

function createFlight(kind, overrides = null) {
  const t = makeTune(kind, overrides);
  return {
    kind, tune: t,
    q: [0, 0, 0, 1], r: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
    throttle: 0.7, power: 0.7, ab: 0,
    gear: 1, gearTarget: 1, flaps: 0, brake: 0, wheelBrake: 0,
    stickPitch: 0, stickRoll: 0, stickYaw: 0,
    alpha: 0, beta: 0, airspeed: 0, mach: 0, g: 1, gSmooth: 1, stall: 0, buffet: 0, agl: 1000, groundY: 0,
    onGround: false, wheelsDown: 0, ditched: false, sonic: false,
    wheels: t.gear.map((w) => ({ ...w, comp: 0, load: 0, contact: false, spin: 0, angle: 0, gy: 0 })),
    hull: t.hull.map((p) => ({ ...p, contact: false })),
    damage: { wingL: 0, wingR: 0, engine: 0, gear: 0 },
    windX: 0, windY: 0, windZ: 0, gustT: 0, gx: 0, gy: 0, gz: 0,
    path: null, pathT: 0, // the slope it holds hands off (sine of it), and how long the stick has been let go
    thrust: 0, lift: 0, drag: 0,
    events: []
  };
}

// The body's axes in the world, from its quaternion: r[0..2] left, r[3..5] up, r[6..8] forward
function refreshAxes(b) {
  const [x, y, z, w] = b.q, r = b.r;
  r[0] = 1 - 2 * (y * y + z * z); r[1] = 2 * (x * y + z * w); r[2] = 2 * (x * z - y * w);
  r[3] = 2 * (x * y - z * w); r[4] = 1 - 2 * (x * x + z * z); r[5] = 2 * (y * z + x * w);
  r[6] = 2 * (x * z + y * w); r[7] = 2 * (y * z - x * w); r[8] = 1 - 2 * (x * x + y * y);
}

// Heading, then pitch (nose up positive), then roll (left wing down positive) to a quaternion
function attitude(heading, pitch = 0, roll = 0) {
  const cy = Math.cos(heading / 2), sy = Math.sin(heading / 2);
  const cp = Math.cos(-pitch / 2), sp = Math.sin(-pitch / 2);
  const cr = Math.cos(-roll / 2), sr = Math.sin(-roll / 2);
  // q = yaw(Y) * pitch(X) * roll(Z)
  const ax = cy * sp, ay = sy * cp, az = -sy * sp, aw = cy * cp;
  return [ax * cr + ay * sr, ay * cr - ax * sr, az * cr + aw * sr, aw * cr - az * sr];
}

// Puts an aircraft somewhere, flying or standing: { x, y, z, heading, speed, pitch, roll, throttle, onGround }
function placeAircraft(a, at = {}) {
  const b = a.flight, t = b.tune;
  const heading = at.heading ?? a.heading ?? 0, pitch = at.pitch ?? 0, roll = at.roll ?? 0, speed = at.speed ?? 0;
  if (at.x !== undefined) { a.position.x = at.x; a.position.z = at.z; }
  if (at.y !== undefined) a.position.y = at.y;
  b.q = attitude(heading, pitch, roll);
  refreshAxes(b);
  b.vx = b.r[6] * speed; b.vy = b.r[7] * speed; b.vz = b.r[8] * speed;
  b.wx = b.wy = b.wz = 0;
  b.airspeed = speed; b.mach = speed / SOUND; b.alpha = b.beta = 0; b.g = b.gSmooth = 1; b.stall = b.buffet = 0;
  b.throttle = b.power = at.throttle ?? 0.7;
  b.ab = 0;
  b.stickPitch = b.stickRoll = b.stickYaw = 0;
  b.ditched = false; b.sonic = false; b.gearHold = 0; b.line = null; b.path = null; b.pathT = 0;
  b.damage.wingL = b.damage.wingR = b.damage.engine = b.damage.gear = 0;
  const grounded = !!at.onGround;
  b.gear = b.gearTarget = grounded || !t.gearTime ? 1 : 0;
  b.flaps = grounded ? 0.5 : 0;
  b.onGround = grounded; b.wheelsDown = 0;
  for (const w of b.wheels) { w.comp = 0; w.load = 0; w.contact = false; }
  for (const p of b.hull) p.contact = false;
  b.events.length = 0;
  a.crashed = false;
  if (grounded) {
    // standing on its wheels: the centre of gravity as high as the main gear is long, in the attitude the gear gives
    const rest = restAttitude(t);
    b.q = attitude(heading, rest.pitch, 0);
    refreshAxes(b);
    a.position.y = (at.y ?? 0) + rest.height;
    b.vx = b.r[6] * speed; b.vy = 0; b.vz = b.r[8] * speed;
  }
  syncOut(a);
  return a;
}

// How an aircraft stands on level ground: the pitch its wheels give it and the height of its centre of gravity
function restAttitude(t) {
  const main = t.gear[0], third = t.gear[2];
  // nose-up pitch that puts the main wheels and the third one at the same height
  const pitch = Math.atan((third.y - main.y) / (main.z - third.z));
  const sag = G / ((Math.PI * 2 * main.hz) ** 2);
  const height = -(main.y * Math.cos(pitch) + main.z * Math.sin(pitch)) - sag;
  return { pitch, height };
}

function liftCoefficient(t, alpha, flaps) {
  const a = alpha - t.alpha0 + flaps * 0.02;
  const stall = t.stall - t.alpha0 + flaps * t.flapStall;
  const sign = a < 0 ? -1 : 1, m = Math.abs(a);
  // a cambered wing lets go sooner upside down
  const limit = sign > 0 ? stall : stall * 0.8;
  const linear = t.clSlope * Math.min(m, limit) + flaps * t.flapLift * (sign > 0 ? 1 : 0.3);
  const plate = t.clPlate * Math.sin(2 * m);
  const s = smooth(limit, limit + 0.14, m);
  return sign * lerp(linear, plate, s);
}

const _c = { nx: 0, ny: 1, nz: 0, depth: 0 };
const _w = { x: 0, y: 0, z: 0 };

// The undercarriage lever (1 down, 0 up). By hand, the aircraft leaves it alone for a while afterwards.
function setGear(a, down, byHand = true) {
  const b = a.flight;
  if (!b.tune.gearTime || b.damage.gear >= 1) return false;
  if (!down && b.onGround) return false; // not while standing on it
  if (b.gearTarget === (down ? 1 : 0)) return false;
  b.gearTarget = down ? 1 : 0;
  if (byHand) b.gearHold = 20;
  b.events.push({ type: down ? 'gearDown' : 'gearUp' });
  return true;
}

/**
 * One frame of flight. `input`: pitch (+1 pulls the nose up), roll (+1 rolls left), yaw (+1 nose left), throttle
 * (+1 opens the lever, -1 closes it), boost (afterburner, or full power), brake (wheel brakes and airbrake).
 * `env`: ground(x, z, y) the surface at or below y; water(x, z); waterLevel; solid(x, y, z, out) a building in the way,
 * its outward normal in out.nx/nz; wind(x, y, z, out) optional; gust 0..1 how rough the air is.
 * Sets a.crashed on a fatal contact and leaves what happened in a.flight.events for the frame.
 */
function stepAircraft(a, input, dt, env) {
  const b = a.flight, t = b.tune;
  if (!(dt > 0) || a.crashed) return;
  dt = Math.min(dt, 0.1);
  b.events.length = 0;

  // ---- The hands: keys wind the stick on and let it spring back; an analogue stick is followed closely
  const wind = (now, want, on = t.stickRate) => {
    const rate = Math.abs(want) > Math.abs(now) || want * now < 0 ? on : t.stickBack;
    return now + clamp(want - now, -rate * dt, rate * dt);
  };
  b.stickPitch = wind(b.stickPitch, clamp(input.pitch || 0, -1, 1));
  b.stickRoll = wind(b.stickRoll, clamp(input.roll || 0, -1, 1), t.stickRoll);
  b.stickYaw = wind(b.stickYaw, clamp(input.yaw || 0, -1, 1));
  b.throttle = clamp(b.throttle + (input.throttle || 0) * 0.6 * dt, 0, 1);
  if (input.boost) b.throttle = Math.min(1, b.throttle + dt * 1.6);
  const dead = b.damage.engine >= 1;
  const want = dead ? 0 : b.throttle;
  b.power += clamp(want - b.power, -t.spoolDown * dt, t.spoolUp * dt);
  const reheat = t.afterburner && input.boost && !dead && b.power > 0.9 ? 1 : 0;
  b.ab += clamp(reheat - b.ab, -5 * dt, 3.5 * dt);
  // the airbrake comes out with the brakes once the lever is shut; the wheel brakes with it on the ground
  const braking = input.brake || ((input.throttle || 0) < 0 && b.throttle <= 0.001) ? 1 : 0;
  b.brake += clamp(braking - b.brake, -4 * dt, 4 * dt);
  // standing with the lever shut, the parking brake holds it
  b.wheelBrake = braking || (b.throttle < 0.02 && b.onGround && b.airspeed < 4) ? 1 : 0;
  // The undercarriage looks after itself unless the pilot has just worked the lever: up once climbing away, down
  // when slow, low and throttled back. Flaps come with it.
  if (t.gearTime) {
    b.gearHold = Math.max(0, (b.gearHold || 0) - dt);
    if (!b.gearHold && !b.onGround) {
      // (the two never both hold: an approach is slow and throttled back, a departure is neither)
      // (coming in hot with the lever shut is still an approach: the wheels are worth having as brakes)
      const landing = b.agl < 110 && b.throttle < 0.55 && b.vy < 2
        && (b.airspeed < t.vStall * 1.75 || (b.throttle < 0.25 && b.agl < 75 && b.airspeed < t.vStall * 2.4));
      const leaving = b.agl > 14 && (b.airspeed > t.vStall * 2 || b.agl > 170 || (b.throttle > 0.65 && b.vy > 1 && b.airspeed > t.vStallLanding * 1.2));
      if (b.gearTarget && leaving && !landing) setGear(a, 0, false);
      else if (!b.gearTarget && landing) setGear(a, 1, false);
    }
    b.gear += clamp(b.gearTarget - b.gear, -dt / t.gearTime, dt / t.gearTime);
  } else b.gear = 1;
  const slow = smooth(t.vStall * 1.9, t.vStall * 1.25, b.airspeed);
  const flapsWant = !t.gearTime || b.gearTarget > 0.5 ? slow : 0;
  b.flaps += clamp(flapsWant - b.flaps, -dt * 0.5, dt * 0.5);

  // ---- The air around: wind, and the rough air between buildings (env.gust in m/s)
  if (env.wind) { env.wind(a.position.x, a.position.y, a.position.z, _w); b.windX = _w.x; b.windY = _w.y; b.windZ = _w.z; }
  const gust = (env.gust ?? 0) * t.turbulence;
  if (gust > 0) {
    b.gustT += dt;
    const k = 1 - Math.exp(-dt * 2.2), p = b.gustT;
    b.gx += (Math.sin(p * 1.7) * Math.sin(p * 0.43 + 1) + Math.sin(p * 4.1 + 2) * 0.5 - b.gx) * k;
    b.gy += (Math.sin(p * 1.3 + 4) * Math.sin(p * 0.61) + Math.sin(p * 3.7) * 0.5 - b.gy) * k;
    b.gz += (Math.sin(p * 2.1 + 2.5) * Math.sin(p * 0.37 + 3) - b.gz) * k;
  } else b.gx = b.gy = b.gz = 0;

  // ---- What is under it
  b.groundY = env.ground(a.position.x, a.position.z, a.position.y);
  b.agl = a.position.y - b.groundY;
  const reach = Math.max(t.span, t.length) * 0.5 + 3;
  const near = b.agl < reach + Math.abs(b.vy) * 0.4 + 2;
  const wasGrounded = b.onGround;

  const n = Math.max(1, Math.ceil(dt / STEP)), h = dt / n;
  let load = 0;
  for (let i = 0; i < n && !a.crashed; i++) load += substep(a, b, t, h, env, near, gust);
  b.g = load / n;
  b.gSmooth += (b.g - b.gSmooth) * (1 - Math.exp(-dt * 6));

  if (!a.crashed) solidContacts(a, b, t, env);
  if (!a.crashed && env.water) waterContact(a, b, t, env, dt);
  // through the sound barrier and back
  const sonic = b.mach >= 1;
  if (sonic !== b.sonic) { b.sonic = sonic; b.events.push({ type: sonic ? 'boom' : 'subsonic' }); }
  if (b.onGround !== wasGrounded) b.events.push({ type: b.onGround ? 'landed' : 'airborne', speed: b.airspeed });
  syncOut(a);
}

function substep(a, b, t, h, env, near, gust) {
  const r = b.r, p = a.position;
  refreshAxes(b);
  const lx = r[0], ly = r[1], lz = r[2], ux = r[3], uy = r[4], uz = r[5], fx = r[6], fy = r[7], fz = r[8];
  const rho = RHO0 * Math.exp(-Math.max(0, p.y) / 8500);

  // ---- Air data
  const ax = b.vx - b.windX - b.gx * gust, ay = b.vy - b.windY - b.gy * gust, az = b.vz - b.windZ - b.gz * gust;
  const V = Math.hypot(ax, ay, az);
  const vl = ax * lx + ay * ly + az * lz, vu = ax * ux + ay * uy + az * uz, vf = ax * fx + ay * fy + az * fz;
  const qbar = 0.5 * rho * V * V;
  const moving = smooth(3, 12, V);
  const alpha = V > 0.5 ? Math.atan2(-vu, vf) : 0;
  const beta = V > 0.5 ? Math.asin(clamp(vl / V, -1, 1)) : 0;
  const alphaRate = wrap(alpha - b.alpha) / h * moving, betaRate = (beta - b.beta) / h * moving;
  b.alpha = alpha; b.beta = beta; b.airspeed = V; b.mach = V / SOUND;

  // ---- Wing
  const span = t.span, effect = b.agl < span ? (1 - b.agl / span) ** 2 : 0; // ground effect: a cushion under the wing
  const hurt = Math.max(b.damage.wingL, b.damage.wingR);
  let cl = liftCoefficient(t, alpha, b.flaps) * (1 + 0.14 * effect) * (1 - 0.18 * hurt);
  const deep = smooth(t.stall - t.alpha0, t.stall - t.alpha0 + 0.14, Math.abs(alpha - t.alpha0));
  // the wall of drag around Mach 1, and the climb of it beyond
  const wave = t.wave ? t.wave * Math.exp(-(((b.mach - 1.02) / 0.09) ** 2)) + t.waveHigh * Math.max(0, b.mach - 1.05) ** 2 : 0;
  const sa = Math.sin(alpha), sb = vl / Math.max(V, 0.5);
  const cd = t.cd0 * (1 + wave) + t.induced * (1 - 0.45 * effect) * cl * cl * (1 - deep) + t.cdPlate * sa * sa * deep
    + b.gear * t.cdGear + b.flaps * t.cdFlaps + b.brake * t.cdBrake + t.cdSide * sb * sb + hurt * 0.03;
  const L = qbar * t.area * cl, D = qbar * t.area * cd, Y = -qbar * t.area * t.sideSlope * sb;
  // lift stands square to the airflow in the plane of symmetry
  let nx = 0, ny = 0, nz = 0, dx = 0, dy = 0, dz = 0;
  if (V > 0.5) {
    dx = ax / V; dy = ay / V; dz = az / V;
    nx = dy * lz - dz * ly; ny = dz * lx - dx * lz; nz = dx * ly - dy * lx;
    const m = Math.hypot(nx, ny, nz);
    if (m > 1e-4) { nx /= m; ny /= m; nz /= m; } else { nx = ux; ny = uy; nz = uz; }
  }

  // ---- Engine
  let thrust;
  const lapse = (rho / RHO0) ** t.lapse;
  if (t.engine === 'prop') {
    const open = t.idle + (1 - t.idle) * b.power;
    const shaft = t.power * open * lapse * (1 - 0.6 * b.damage.engine);
    thrust = Math.min(t.staticThrust * open ** 0.7 * lapse, t.propEff * shaft / Math.max(vf, 1));
    // a propeller at idle is a disc of drag
    if (b.power < 0.25 && vf > 6) thrust -= qbar * t.disc * (1 - b.power / 0.25);
  } else {
    // the reheat feeds on rammed air: the faster, the harder it pushes
    thrust = (t.thrust * (t.idle + (1 - t.idle) * b.power) + t.afterburner * b.ab * (1 + t.ram * b.mach * b.mach)) * lapse * (1 - 0.6 * b.damage.engine);
  }
  b.thrust = thrust; b.lift = L; b.drag = D;

  let Fx = L * nx - D * dx + Y * lx + thrust * fx;
  let Fy = L * ny - D * dy + Y * ly + thrust * fy - t.mass * G;
  let Fz = L * nz - D * dz + Y * lz + thrust * fz;
  // torque from contacts, in world axes
  let Tx = 0, Ty = 0, Tz = 0;

  // ---- Controls: what the air lets the surfaces do
  const auth = clamp(qbar / t.qRef, 0, 1.3);
  const tail = Math.max(auth, t.wash * b.power * (1 - 0.5 * auth));
  const weight = t.mass * G, qS = Math.max(qbar * t.area, 1);
  const onWheels = b.onGround;

  // pitch: the stick asks for an angle of attack between what the g limits and the stall allow
  const flapA = b.flaps * 0.02, a0 = t.alpha0 - flapA;
  const upper = Math.min(t.alphaMax + b.flaps * t.flapStall, a0 + t.gMax * weight / qS / t.clSlope);
  const lower = Math.max(t.alphaMin, a0 + t.gMin * weight / qS / t.clSlope);
  let trim;
  if (onWheels) {
    // on its wheels: run with the tail up, lift off once fast enough with the power on, sit down with it off
    const going = b.throttle > 0.45;
    // (a tail-dragger keeps its tail up while the wing could still fly, or it skips back into the air)
    const run = t.alphaRun ?? t.alphaGround;
    trim = going ? (V > t.vRotate ? t.alphaClimb : run) : V > t.vStall * 0.85 ? run : t.alphaGround;
    b.path = null; b.pathT = 0;
  } else {
    // hands off it holds its path: the lift a straight line needs, shared by however the wings are banked
    const cg = V > 1 ? Math.sqrt(Math.max(0, 1 - dy * dy)) : 1; // cos of the path's slope
    // how much of the lift direction points up, square to the path
    let c = 1;
    if (V > 1 && cg > 0.05) c = (ny - dy * (nx * dx + ny * dy + nz * dz)) / cg;
    const share = c >= 0.5 ? 1 / c : c > 0 ? c * 4 : c * 0.6;
    // left alone in a dive it eases out of it; left alone too slow in a climb it lowers its nose to keep flying
    const ease = dy < 0 && c > 0 ? clamp(-dy * 1.3, 0, 0.65) : 0;
    const sag = dy > 0 ? smooth(t.vStall * 1.35, t.vStall * 1.05, V) * 0.7 : 0;
    // and it keeps the slope it was left on: what a turn, a slip and the lag of the nose take from the lift is given
    // back (flown with the rudder alone, a turn lost forty metres in eight seconds and went on sinking afterwards)
    let fix = 0;
    // (not on the way up from the runway: left alone there, the climb goes on steepening until it clears the roofs)
    const leaving = b.agl < 25 && b.offT < 6;
    if (Math.abs(b.stickPitch) > 0.05 || c < 0.3 || V < t.vStall * 0.8 || leaving) { b.path = null; b.pathT = 0; }
    else if (b.path === null) { if ((b.pathT += h) > 0.4) b.path = dy; } // the nose settles first
    else {
      // the slope held follows what the aircraft does by itself: out of a dive, down from a climb it cannot keep
      const pace = G / Math.max(V, 20) * h;
      if (b.path < 0) b.path = Math.min(0, b.path + clamp(-b.path * 1.3, 0, 0.65) * pace);
      else if (sag > 0) b.path = Math.max(0, b.path - sag * pace);
      fix = clamp((b.path - dy) * clamp(V / 12, 4, 22), -0.35, 0.5);
    }
    trim = a0 + clamp((cg + fix) * share + ease - sag, -1.2, 2.2) * weight / qS / t.clSlope;
  }
  trim = clamp(trim, lower, upper * 0.94);
  const s = b.stickPitch;
  const want = s >= 0 ? lerp(trim, Math.max(trim, upper), s) : lerp(trim, Math.min(trim, lower), -s);
  // nose-up acceleration; the stalled wing shakes the stick loose
  // (hands off, the damping lets through the turning of the nose that the path itself asks for: without it the nose
  // lags in every turn and the wing gives a tenth less than it was asked)
  const follow = onWheels || V < 8 ? 0
    : (1 - smooth(0.05, 0.4, Math.abs(s))) * clamp((Fx * nx + Fy * ny + Fz * nz) / t.mass / V, -0.6, 0.6);
  let pitchAcc = t.pitchK * tail * wrap(want - alpha) * moving - t.pitchD * Math.min(1, tail + 0.1) * alphaRate
    - t.pitchDamp * (-b.wx - follow) * (1 + 2 * (1 - moving));

  // roll: a rate, plus the wing's own wish to fly level when nobody is asking
  const stalled = smooth(t.stall - 0.03, t.stall + 0.08, Math.abs(alpha));
  const bite = Math.min(1, auth) * (1 - 0.6 * stalled);
  let rollCmd = -b.stickRoll * t.rollRate * bite * (1 - 0.5 * hurt);
  if (!onWheels) {
    const bank = Math.atan2(ly, uy); // positive: right wing down
    const steep = 1 - smooth(0.75, 0.95, Math.abs(fy));
    const free = (1 - smooth(0.04, 0.3, Math.abs(b.stickRoll))) * (1 - smooth(0.12, 0.45, Math.abs(b.stickPitch)));
    // the rudder alone flies a gentle banked turn
    const lean = -b.stickYaw * t.lean * (1 - smooth(0.04, 0.3, Math.abs(b.stickRoll)));
    const to = Math.abs(b.stickYaw) > 0.05 ? lean : 0;
    const assist = Math.abs(b.stickYaw) > 0.05 ? (1 - smooth(0.04, 0.3, Math.abs(b.stickRoll))) : free;
    rollCmd += clamp(-(bank - to) * t.level, -1.1, 1.1) * assist * steep * Math.min(1, auth * 1.5);
  }
  let rollAcc = t.rollK * (rollCmd - b.wz) + t.dihedral * auth * 9 * beta
    // a torn wing lifts less: the aircraft wants to roll onto it
    - (b.damage.wingL - b.damage.wingR) * auth * 1.4
    // a stalled wing drops: whichever way it is already going
    + stalled * moving * (Math.sin(b.gustT * 5.3 + p.y) * 0.9 + clamp(b.wy * 3, -1.2, 1.2));
  if (t.torque) rollAcc += t.torque * b.power * (1 - Math.min(1, auth)) * (onWheels ? 0 : 1);

  // yaw: the fin points it into the air it meets; the rudder holds a slip
  // (flown with the rudder alone the turn is the bank's, nearly co-ordinated: a full slip held in a bank drags the
  // nose down; with the ailerons in hand the rudder is a rudder again, for slips and flat turns)
  const alone = 1 - smooth(0.04, 0.3, Math.abs(b.stickRoll));
  const slip = -b.stickYaw * t.rudderSlip * (onWheels ? 0 : 1 - 0.8 * alone);
  // (on its wheels the tyres hold the line: a crosswind must not swing it round on the take-off run)
  const vane = onWheels ? 0.15 : 1;
  let yawAcc = (t.yawK * Math.min(1, auth) * (beta - slip) + t.yawD * Math.min(1, auth + 0.05) * betaRate) * vane - t.yawDamp * b.wy
    + b.stickYaw * t.rudderPower * tail * (onWheels ? 1 : 0.25)
    - t.adverse * b.stickRoll * bite
    + (t.pfactor ? t.pfactor * b.power * (1 - smooth(0.25, 1, auth)) : 0);
  // rolling with the feet off the pedals, it is held straight: the swing of the propeller is felt, not suffered
  // and the feet off the pedals too, the roll keeps the line it was on (an avenue leaves a wing a metre to spare)
  if (onWheels && Math.abs(b.stickYaw) < 0.05 && Math.abs(b.stickRoll) < 0.05 && V > 2) {
    const heading = Math.atan2(fx, fz);
    if (b.line === null || b.line === undefined) b.line = heading;
    yawAcc += clamp(wrap(b.line - heading) * 9, -2.5, 2.5) - b.wy * 4.5;
  } else b.line = null;

  // ---- Wheels and hull against the ground
  let wheels = 0;
  if (near) {
    const k2 = t.mass * G;
    const ix = t.mass * t.kx * t.kx, iy = t.mass * t.ky * t.ky, iz = t.mass * t.kz * t.kz;
    // angular velocity in world axes, for the velocity of each contact point
    const Wx = b.wx * lx + b.wy * ux + b.wz * fx, Wy = b.wx * ly + b.wy * uy + b.wz * fy, Wz = b.wx * lz + b.wy * uz + b.wz * fz;
    const hl = Math.hypot(fx, fz) || 1, hfx = fx / hl, hfz = fz / hl; // the nose's direction along the ground
    const steerIn = clamp(b.stickYaw + b.stickRoll * (1 - Math.min(1, auth)), -1, 1);
    const push = (Px, Py, Pz, rx, ry, rz) => {
      Fx += Px; Fy += Py; Fz += Pz;
      Tx += ry * Pz - rz * Py; Ty += rz * Px - rx * Pz; Tz += rx * Py - ry * Px;
    };
    if (b.gear > 0.95 && b.damage.gear < 1) {
      for (const w of b.wheels) {
        const rx = w.x * lx + w.y * ux + w.z * fx, ry = w.x * ly + w.y * uy + w.z * fy, rz = w.x * lz + w.y * uz + w.z * fz;
        const wxp = p.x + rx, wyp = p.y + ry, wzp = p.z + rz;
        const gy = env.ground(wxp, wzp, wyp + 1.2);
        w.gy = gy;
        const pen = gy - wyp;
        const was = w.contact;
        if (pen <= 0 || uy < 0.2) { w.contact = false; w.load = 0; w.comp = 0; continue; }
        const cvx = b.vx + Wy * rz - Wz * ry, cvy = b.vy + Wz * rx - Wx * rz, cvz = b.vz + Wx * ry - Wy * rx;
        if (!was) {
          const sink = -cvy;
          b.events.push({ type: 'touchdown', sink, speed: Math.hypot(cvx, cvz), x: wxp, y: gy, z: wzp });
          if (sink > t.gearSink) { b.damage.gear = 1; b.events.push({ type: 'gearCollapse', sink }); break; }
        }
        w.contact = true;
        wheels++;
        // each wheel carries its share of the weight at about half its travel
        const share = w.brake ? 0.46 : 0.12;
        const omega = Math.PI * 2 * w.hz, ks = share * t.mass * omega * omega, cs = 2 * w.damp * share * t.mass * omega;
        const comp = Math.min(pen, w.travel * 1.8);
        w.comp = comp;
        const N = clamp(ks * comp - cs * cvy + (pen > w.travel * 1.8 ? (pen - w.travel * 1.8) * ks * 6 : 0), 0, k2 * 4);
        w.load = N;
        // rolling direction: the nose's, turned by the steered wheel
        let wfx = hfx, wfz = hfz;
        if (w.steer) {
          // full lock at a walk, a few degrees on the take-off run
          const lock = (w.castor ?? 0.5) * steerIn * w.steer / (1 + (V / 7) ** 2);
          w.angle = lock;
          const cs2 = Math.cos(lock), sn2 = Math.sin(lock);
          wfx = hfx * cs2 + hfz * sn2; wfz = hfz * cs2 - hfx * sn2;
        }
        const sx = wfz, sz = -wfx; // the wheel's left
        const vlong = cvx * wfx + cvz * wfz, vlat = cvx * sx + cvz * sz;
        // brakes ease off when the tail comes up, so a tail-dragger does not stand on its nose
        const over = t.tail ? smooth(0.0, -0.1, Math.asin(clamp(fy, -1, 1))) : 0;
        const grip = w.brake ? b.wheelBrake * t.muBrake * (1 - 0.85 * over) : 0;
        const Flong = -N * (t.muRoll + grip) * clamp(vlong / 0.8, -1, 1);
        const Flat = -N * t.muLat * clamp(vlat / 2.2, -1, 1);
        push(wfx * Flong + sx * Flat, N, wfz * Flong + sz * Flat, rx, ry, rz);
        w.spin += vlong * h / 0.3;
      }
    }
    const down = b.gear > 0.95 && b.damage.gear < 1;
    for (const c of b.hull) {
      const rx = c.x * lx + c.y * ux + c.z * fx, ry = c.x * ly + c.y * uy + c.z * fy, rz = c.x * lz + c.y * uz + c.z * fz;
      const cxp = p.x + rx, cyp = p.y + ry, czp = p.z + rz;
      const gy = env.ground(cxp, czp, cyp + 1.2);
      const pen = gy - cyp;
      if (pen <= 0) { c.contact = false; continue; }
      const cvx = b.vx + Wy * rz - Wz * ry, cvy = b.vy + Wz * rx - Wx * rz, cvz = b.vz + Wx * ry - Wy * rx;
      const speed = Math.hypot(cvx, cvz);
      if (!c.contact) {
        c.contact = true;
        const hit = -cvy;
        // nose first, or too hard: that is the end of it
        const nose = (c.kind === 'nose' || c.kind === 'prop') && speed > 22 && fy < -0.2;
        // (on its back at speed too: the fin is the first thing to touch; a wing tip dragging is only a wing tip)
        if (hit > t.crashSink || nose || (speed > 45 && c.kind === 'fin')) {
          a.crashed = true; b.events.push({ type: 'crash', cause: 'ground', speed: Math.hypot(b.vx, b.vy, b.vz), x: cxp, y: gy, z: czp });
          return 1;
        }
        b.events.push({ type: 'scrape', kind: c.kind, hit, speed, x: cxp, y: gy, z: czp, first: true });
      } else if (speed > 3) b.events.push({ type: 'scrape', kind: c.kind, hit: 0, speed, x: cxp, y: gy, z: czp, dt: h });
      const omega = Math.PI * 2 * 5, ks = 0.5 * t.mass * omega * omega, cs = 2 * 0.7 * 0.5 * t.mass * omega;
      const N = clamp(ks * pen - cs * cvy, 0, k2 * 5);
      const f = speed > 0.01 ? -N * t.muScrape * Math.min(1, speed / 1.5) / speed : 0;
      push(cvx * f, N, cvz * f, rx, ry, rz);
      if (c.kind === 'belly') wheels += 2; // on its belly it is on the ground all the same
    }
    // contact torques turn the body through its inertia (world torque to body axes)
    const tx = Tx * lx + Ty * ly + Tz * lz, ty = Tx * ux + Ty * uy + Tz * uz, tz = Tx * fx + Ty * fy + Tz * fz;
    b.wx += tx / ix * h; b.wy += ty / iy * h; b.wz += tz / iz * h;
  } else {
    for (const w of b.wheels) { w.contact = false; w.load = 0; w.comp = 0; }
    for (const c of b.hull) c.contact = false;
  }
  b.wheelsDown = wheels;
  // a skip off the runway is still a landing: airborne only once the wheels have been off it for a moment
  b.offT = wheels >= 2 ? 0 : (b.offT || 0) + h;
  b.onGround = wheels >= 2 || (b.onGround && b.offT < 0.3 && b.agl < 4);

  // ---- Integrate
  b.wx += -pitchAcc * h; b.wy += yawAcc * h; b.wz += rollAcc * h;
  const inv = 1 / t.mass;
  b.vx += Fx * inv * h; b.vy += Fy * inv * h; b.vz += Fz * inv * h;
  p.x += b.vx * h; p.y += b.vy * h; p.z += b.vz * h;
  const q = b.q, qx = q[0], qy = q[1], qz = q[2], qw = q[3], hx = b.wx * h * 0.5, hy = b.wy * h * 0.5, hz = b.wz * h * 0.5;
  q[0] = qx + qw * hx + qy * hz - qz * hy;
  q[1] = qy + qw * hy + qz * hx - qx * hz;
  q[2] = qz + qw * hz + qx * hy - qy * hx;
  q[3] = qw - qx * hx - qy * hy - qz * hz;
  const m = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= m; q[1] /= m; q[2] /= m; q[3] /= m;

  // what the pilot feels: the wing's pull along the body's up, in g
  const felt = (L * (nx * ux + ny * uy + nz * uz) - D * (dx * ux + dy * uy + dz * uz)) / weight
    + (onWheels || wheels ? Math.max(0, uy) * (1 - Math.min(1, L / weight)) : 0);
  b.stall = Math.max(stalled, smooth(1.12, 0.98, V / (b.flaps > 0.3 ? t.vStallLanding : t.vStall)) * (b.onGround ? 0 : 1));
  b.buffet = Math.max(smooth(t.stall - 0.07, t.stall + 0.02, Math.abs(alpha)) * moving, wave * 0.4);
  return felt;
}

// Buildings: a wing tip can be lost and flown home; the nose cannot
function solidContacts(a, b, t, env) {
  if (!env.solid) return;
  const r = b.r, p = a.position, speed = Math.hypot(b.vx, b.vy, b.vz);
  for (const c of b.hull) {
    const x = p.x + c.x * r[0] + c.y * r[3] + c.z * r[6], y = p.y + c.x * r[1] + c.y * r[4] + c.z * r[7], z = p.z + c.x * r[2] + c.y * r[5] + c.z * r[8];
    if (!env.solid(x, y, z, _c)) continue;
    const closing = -(b.vx * _c.nx + b.vz * _c.nz);
    const tip = c.kind === 'tipL' || c.kind === 'tipR';
    if (speed < t.strikeSpeed) {
      // taxiing into a wall: pushed back out, stopped (and bent, if it was going at any pace)
      p.x += _c.nx * _c.depth; p.z += _c.nz * _c.depth;
      const into = b.vx * _c.nx + b.vz * _c.nz;
      if (into < 0) { b.vx -= _c.nx * into; b.vz -= _c.nz * into; }
      b.vx *= 0.6; b.vz *= 0.6;
      b.events.push({ type: 'bump', kind: c.kind, speed, closing, x, y, z });
      continue;
    }
    const side = c.kind === 'tipL' ? 'wingL' : 'wingR';
    if (tip && b.damage[side] < 1 && closing < speed * 0.75) {
      // a wing tip torn off against a wall: the aircraft slews towards it and flies on, crooked
      b.damage[side] = 1;
      p.x += _c.nx * (_c.depth + 0.4); p.z += _c.nz * (_c.depth + 0.4);
      const into = b.vx * _c.nx + b.vz * _c.nz;
      if (into < 0) { b.vx -= _c.nx * into * 1.2; b.vz -= _c.nz * into * 1.2; }
      b.vx *= 0.86; b.vy *= 0.86; b.vz *= 0.86;
      b.wy += (c.kind === 'tipL' ? 1 : -1) * 1.4;
      b.wz += (c.kind === 'tipL' ? -1 : 1) * 1.1;
      b.events.push({ type: 'strike', kind: c.kind, speed, x, y, z, nx: _c.nx, nz: _c.nz });
      continue;
    }
    if (speed < t.crashSpeed && b.agl < 6) {
      // run into something on the ground at a roll, not a flight: the aircraft is a write-off, the pilot is not
      p.x += _c.nx * (_c.depth + 0.2); p.z += _c.nz * (_c.depth + 0.2);
      const into = b.vx * _c.nx + b.vz * _c.nz;
      if (into < 0) { b.vx -= _c.nx * into; b.vz -= _c.nz * into; }
      b.vx *= 0.3; b.vz *= 0.3; b.vy = Math.min(b.vy, 0);
      b.damage.engine = 1;
      b.throttle = 0;
      b.events.push({ type: 'wreck', kind: c.kind, speed, closing, x, y, z, nx: _c.nx, nz: _c.nz });
      continue;
    }
    a.crashed = true;
    b.events.push({ type: 'crash', cause: 'building', speed, x, y, z, nx: _c.nx, nz: _c.nz });
    return;
  }
}

// Water: a flat, slow, gentle arrival is a ditching, the aircraft stops and floats; anything else breaks it up
function waterContact(a, b, t, env, dt) {
  // env.water says how high the water stands at a point (a river, a lake up in a park), or just that there is some
  const p = a.position, wet = env.water(p.x, p.z);
  if (wet === false || wet === null || wet === undefined) return;
  const level = typeof wet === 'number' ? wet : env.waterLevel ?? 0;
  const belly = p.y - 0.9;
  if (belly > level) return;
  const r = b.r, speed = Math.hypot(b.vx, b.vz);
  if (!b.ditched) {
    const gentle = -b.vy < 5 && speed < t.vStall * 2.1 && Math.abs(r[1]) < 0.3 && r[7] > -0.12 && r[7] < 0.42 && r[4] > 0.5;
    if (!gentle) {
      a.crashed = true;
      b.events.push({ type: 'crash', cause: 'water', speed: Math.hypot(b.vx, b.vy, b.vz), x: p.x, y: level, z: p.z });
      return;
    }
    b.ditched = true;
    b.damage.engine = 1;
    b.events.push({ type: 'ditch', speed, x: p.x, y: level, z: p.z });
  }
  // afloat: the water takes the speed in a few lengths and levels the wings
  const k = Math.exp(-dt * 1.6);
  b.vx *= k; b.vz *= k; b.vy = Math.max(b.vy, 0) * 0.5 + (level + 0.75 - p.y) * 2.5;
  b.wx *= k; b.wy *= k; b.wz *= k;
  b.wz += -Math.atan2(r[1], r[4]) * 3 * dt; b.wx += Math.asin(clamp(r[7], -1, 1)) * 3 * dt;
  b.events.push({ type: 'wake', speed, x: p.x, y: level, z: p.z, dt });
}

// The planar fields the rest of the game reads
function syncOut(a) {
  const b = a.flight, r = b.r;
  refreshAxes(b);
  const flat = Math.hypot(r[6], r[8]);
  // nose straight up or down: the belly says which way the aircraft is going
  a.heading = flat > 1e-3 ? Math.atan2(r[6], r[8]) : Math.atan2(-r[3] * Math.sign(r[7]), -r[5] * Math.sign(r[7]));
  a.pitch = Math.asin(clamp(r[7], -1, 1));
  a.roll = Math.atan2(-r[1], r[4]);
  a.speed = b.vx * r[6] + b.vy * r[7] + b.vz * r[8];
  a.verticalSpeed = b.vy;
  a.onGround = b.onGround;
  a.throttle = b.throttle;
}

export { AIRCRAFT, attitude, createFlight, liftCoefficient, makeTune, placeAircraft, refreshAxes, restAttitude, setGear, stepAircraft, syncOut };
