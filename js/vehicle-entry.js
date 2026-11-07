// Getting into and out of a car the way a person does it (gameplay.js wires it to the protagonist): a walk up to the
// driver's door, the right hand on the handle, the door pulled open, a step into the opening, the body lowered into the
// seat with the head ducked under the roof, the right leg in first then the left, the door pulled shut by the left hand;
// the mirror image on the way out. Everything here is a pure function of time in the car's own frame (metres; +X the
// driver's side, +Z forward, Y up, the car's origin on the ground), with no three.js: gameplay.js turns the targets into
// the world. tests/vehicle-entry.test.cjs checks the timing and the continuity of every target.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// A limb swung from rest to rest with the least peak speed: a quarter of the time accelerating, half cruising, a quarter
// slowing (peak 1.33 x the average, against 1.5 x for a smoothstep)
function trapezoid(u) {
  u = clamp(u, 0, 1);
  const a = 0.25, vp = 1 / (1 - a);
  if (u < a) return vp * u * u / (2 * a);
  if (u > 1 - a) return 1 - vp * (1 - u) * (1 - u) / (2 * a);
  return vp * a / 2 + vp * (u - a);
}
// 0 before t0, 1 after t1
const span = (t, t0, t1) => clamp((t - t0) / (t1 - t0), 0, 1);

const DEG = Math.PI / 180;
export const DOOR_OPEN = 60 * DEG; // the door against its check strap: its top corner stays within reach of the left hand
export const FAST = 0.7; // pace of the whole choreography when the player is in a hurry
// The seat point under a standing 1.75 m person: PersonRig.drive sits the pelvis joint 0.06 m above the seat it is
// given, and the standing pelvis joint is 0.9575 m up (PersonRig.standingHeight: ankle, legs, hips)
const PELVIS_STAND = 0.8975;
const SEAT_LIFT = 0.06;
const ANKLE = 0.08;
const STANCE = 0.11; // each foot this far from the body's line
// The opening door: a tug on the handle, then the door swinging free and stopping at the strap
const openCurve = (u) => 0.65 * u ** 1.6 + 0.35 * smooth(u);
const TUG = 0.27; // how far into the swing the hand lets go of the handle (the door is at about 10 degrees)
// A door pushed shut from outside: slow to start, slamming into the latch
const slamCurve = (u) => 1 - clamp(u, 0, 1) ** 2;
const PUSH = 0.27; // how far into the slam the hand leaves the door's edge

/**
 * What the choreography needs of a car: car-assets.js describe() (halfW, height, doors) and car-cabin.js cabinLayout()
 * (seat, roof, recline, wheel, pedals, radius, tilt). `s` is the person's scale (height / 1.75 m).
 */
export function carFrame(spec, layout, s = 1) {
  const front = spec.doors[0], rear = spec.doors[1], hingeX = spec.halfW * 0.92;
  return {
    s, halfW: spec.halfW, height: spec.height, front, rear, L: front - rear, hingeX, panel: spec.halfW - hingeX,
    zFront: spec.zFront ?? spec.wheelZf + 0.9, zRear: spec.zRear ?? spec.wheelZr - 0.9,
    seat: layout.seat, roof: layout.roof, recline: layout.recline, wheel: layout.wheel, pedals: layout.pedals,
    radius: layout.radius ?? 0.18, tilt: layout.tilt ?? 0.42,
    handleY: clamp(spec.height * 0.64, 0.72, 1.1),
    topY: Math.min(spec.height * 0.92, layout.roof + 0.05) - 0.08
  };
}

// A point riding on the door (gameplay.js splitDoor: hinged at the front edge, rotation.y = -angle): `u` metres from
// the hinge along the door, `v` outwards from the panel, `h` above the ground
export function doorPoint(f, angle, u, v, h, out) {
  const px = f.panel + v, c = Math.cos(angle), sn = Math.sin(angle);
  out.x = f.hingeX + px * c + u * sn;
  out.y = h;
  out.z = f.front + px * sn - u * c;
  return out;
}
export const handle = (f, angle, out) => doorPoint(f, angle, f.L - 0.14, 0.04, f.handleY, out);
export const innerPull = (f, angle, out) => doorPoint(f, angle, f.L * 0.55, -0.07, f.handleY - 0.12, out);
export const doorEdge = (f, angle, out) => doorPoint(f, angle, f.L - 0.05, 0.02, f.handleY + 0.08, out);
// The door's top corner by its free edge (the left hand holds it while the body goes in)
export const doorTop = (f, angle, out) => doorPoint(f, angle, f.L - 0.2, 0, f.topY, out);
// The B-pillar at shoulder height (the right hand steadies the body on it)
export const pillar = (f, out) => { out.x = f.halfW - 0.08; out.y = Math.min(f.roof - 0.1, 1.3); out.z = f.rear + 0.06; return out; };
// Where PersonRig.drive puts the hands (ten to two on the rim) and the ankles (the ball of the foot on the pedal, toes up)
export function wheelGrip(f, side, out) {
  const a = side * 1.05, up = Math.cos(a) * f.radius;
  out.x = f.wheel[0] + Math.sin(a) * f.radius;
  out.y = f.wheel[1] + up * Math.cos(f.tilt);
  out.z = f.wheel[2] + up * Math.sin(f.tilt) - 0.02;
  return out;
}
export function pedalAnkle(f, side, out) {
  const ty = -0.06 * f.s - 0.012, tz = 0.135 * 0.85 * f.s, a = -0.3;
  out.x = f.pedals[0] + side * 0.12;
  out.y = f.pedals[1] - (ty * Math.cos(a) - tz * Math.sin(a));
  out.z = f.pedals[2] - (ty * Math.sin(a) + tz * Math.cos(a));
  return out;
}
// A planted foot beside the body's line (yaw relative to the car; +1 the left foot)
function stance(st, side, groundY, s, out) {
  out.x = st.x + Math.cos(st.yaw) * side * STANCE * s;
  out.y = groundY + ANKLE * s;
  out.z = st.z - Math.sin(st.yaw) * side * STANCE * s;
  return out;
}
// A hand hanging by the hip
function restHand(pelvis, yaw, side, s, out) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  out.x = pelvis.x + fz * side * 0.3 * s + fx * 0.03 * s;
  out.y = pelvis.y - 0.01 * s;
  out.z = pelvis.z - fx * side * 0.3 * s + fz * 0.03 * s;
  return out;
}
// The virtual steering wheel that puts PersonRig.drive's hands where restHand hangs them (in the frame of a seat point
// placed under the pelvis, facing the body's way): wheel = (0, y * s, z * s + zFixed), radius * s
export const REST_WHEEL = { y: -0.168, z: -0.04, radius: 0.346, zFixed: 0.02 };
// The pedal point that stands PersonRig.drive's feet on the ground under that seat point (the ankles 0.12 m apart)
export function restPedals(s, out) {
  const ty = -0.06 * s - 0.012, tz = 0.135 * 0.85 * s, a = -0.3;
  out.x = 0;
  out.y = -(PELVIS_STAND - ANKLE) * s + (ty * Math.cos(a) - tz * Math.sin(a));
  out.z = ty * Math.sin(a) + tz * Math.cos(a);
  return out;
}

// The reusable answer of sampleEntry / sampleExit
export function createSample() {
  const point = () => ({ x: 0, y: 0, z: 0 });
  return {
    t: 0, done: false,
    pose: false, // false: the person walks (x, z, yaw); true: the body is scripted (pelvis, feet, hands)
    door: 0, glass: 0, camera: 0, seated: 0,
    x: 0, z: 0, yaw: 0,
    pelvis: point(), bodyYaw: 0, recline: 0, duck: 0, look: 0,
    feet: [{ x: 0, y: 0, z: 0, yaw: 0, w: 0, flat: 1 }, { x: 0, y: 0, z: 0, yaw: 0, w: 0, flat: 1 }],
    hands: [{ x: 0, y: 0, z: 0, w: 0, px: 0, py: -1, pz: 0 }, { x: 0, y: 0, z: 0, w: 0, px: 0, py: -1, pz: 0 }]
  };
}

const _a = { x: 0, y: 0, z: 0 }, _b = { x: 0, y: 0, z: 0 }, _c = { x: 0, y: 0, z: 0 };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const CATCH = DOOR_OPEN * 0.5; // the closing door meets the hand half way, at its fastest
const mix = (out, a, b, k) => { out.x = lerp(a.x, b.x, k); out.y = lerp(a.y, b.y, k); out.z = lerp(a.z, b.z, k); return out; };
// A foot swung from `a` to `b` over [t0, t1], lifted `lift` on the way
function swing(out, a, b, t, t0, t1, lift) {
  const u = span(t, t0, t1), k = trapezoid(u);
  mix(out, a, b, k);
  out.y += lift * Math.sin(Math.PI * u);
  return out;
}
const setHand = (h, p, w, px, py, pz) => { h.x = p.x; h.y = p.y; h.z = p.z; h.w = w; h.px = px; h.py = py; h.pz = pz; };
const setFoot = (ft, p, yaw, w, flat) => { ft.x = p.x; ft.y = p.y; ft.z = p.z; ft.yaw = yaw; ft.w = w; ft.flat = flat; };
// The left of a body facing `yaw` (relative to the car)
const leftX = (yaw) => Math.cos(yaw), leftZ = (yaw) => -Math.sin(yaw);
const turnTo = (from, to, k) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k;

// The stations of the choreography, in the car's frame
function stations(f) {
  const opening = { x: f.halfW + 0.3, z: clamp(f.seat[2], f.rear + 0.15, f.rear + 0.55), yaw: -0.55 };
  // a step back and out from the opening, as far as it takes to be clear of the door's sweep (a van's long door, hinged
  // well ahead of its seat, sweeps further back than a sedan's)
  const dx = 0.48 / 0.5127, dz = -0.18 / 0.5127;
  let step = 0.51;
  while (step < 1.3 && Math.hypot(opening.x + dx * step - f.hingeX, opening.z + dz * step - f.front) < f.L + 0.12) step += 0.05;
  return {
    // beside the handle, out of the door's sweep, turned towards it
    grab: { x: f.halfW + 0.42, z: f.rear - 0.22, yaw: -1.05 },
    // in the opening behind the open door, level with the seat, turned towards it
    opening,
    // facing forward, the door's edge at arm's length
    clear: { x: opening.x + dx * step, z: opening.z + dz * step, yaw: -0.2 }
  };
}

// The pelvis lowered from the opening into the seat (u = 0 standing at the opening, 1 sat down): in and down first,
// back into the seat last, the torso ducked under the roof rail on the way
function sitPath(plan, u, out) {
  const f = plan.frame, o = plan.opening;
  out.x = lerp(o.x, f.seat[0], smooth(u));
  out.y = lerp(plan.pelvisStand, f.seat[1], smooth((u - 0.08) / 0.72));
  out.z = lerp(o.z, f.seat[2], smooth((u - 0.25) / 0.75));
  return out;
}
const sitYaw = (plan, u) => lerp(plan.opening.yaw, 0, smooth((u - 0.3) / 0.7));
// Forward lean (negative recline): deepest half way, when the head passes under the roof rail
const sitLean = (plan, u) => u < 0.45 ? lerp(0, -plan.duckLean, smooth(u / 0.45)) : lerp(-plan.duckLean, plan.frame.recline, smooth((u - 0.45) / 0.55));
const sitDuck = (plan, u) => 0.55 * Math.sin(Math.PI * clamp(u / 0.9, 0, 1));

function base(f, groundY, pace) {
  const st = stations(f), s = f.s;
  const pelvisStand = groundY + PELVIS_STAND * s;
  // the pelvis crosses the sill about half way down: the torso leans until the head top clears the roof rail there
  const yCross = lerp(pelvisStand, f.seat[1], 0.55);
  const duckLean = Math.max(0.55, Math.acos(clamp((f.roof - 0.08 - yCross) / ((0.82 + SEAT_LIFT) * s), 0, 1)));
  // a high seat (vans, SUVs) is a climb and a low one (sports cars) a deep squat: the legs get more time
  const climb = clamp((Math.abs(f.seat[1] - 0.55) - 0.05) * 0.9, 0, 0.45) * pace;
  return { frame: f, pace, groundY, s, pelvisStand, duckLean, climb, ...st, footwell: [
    { x: f.seat[0] + 0.2, y: f.pedals[1] + 0.05, z: f.seat[2] + 0.4 },
    { x: f.seat[0] - 0.06, y: f.pedals[1] + 0.05, z: f.seat[2] + 0.42 }
  ] };
}

/**
 * The walk from `start` ({ x, z } in the car's frame) to the handle and the entry from there. `groundY` is the ground
 * beside the door in the car's frame, `pace` 1 or FAST. Phases after the walk: pull [0, pull], sit [pull, pull + sit],
 * the door shut over `close` from 72 % of the way down.
 */
export function planEntry(frame, start, { groundY = 0, pace = 1 } = {}) {
  const plan = base(frame, groundY, pace), f = frame;
  // The way to the handle: straight when already on the driver's side, round the nearer end of the car otherwise
  const path = [{ x: start.x, z: start.z }];
  const side = f.halfW + 0.55;
  if (start.x < f.halfW + 0.15) {
    const nearFront = start.z > (f.zFront + f.zRear) / 2;
    const endZ = nearFront ? f.zFront + 0.5 : f.zRear - 0.5;
    if (start.x < -f.halfW - 0.15) path.push({ x: start.x, z: endZ });
    else if (start.z > f.zRear - 0.2 && start.z < f.zFront + 0.2) path.push({ x: side, z: clamp(start.z, f.zRear - 0.2, f.zFront + 0.2) });
    if (start.x < -f.halfW - 0.15 || start.z > f.zFront + 0.2 || start.z < f.zRear - 0.2) path.push({ x: side, z: endZ });
  }
  path.push({ x: plan.grab.x, z: plan.grab.z });
  let length = 0;
  const legs = [];
  for (let i = 1; i < path.length; i++) {
    const d = Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    legs.push(d); length += d;
  }
  // a brisk walk when close, a jog when the door is a few metres off
  const speed = clamp(length / 0.46, 2, 6);
  plan.path = path; plan.legs = legs; plan.length = length;
  plan.approach = length < 0.02 ? 0 : length / speed;
  // the step from the handle into the opening takes its time when the seat is well ahead of the door's edge
  const step = Math.hypot(plan.opening.x - plan.grab.x, plan.opening.z - plan.grab.z);
  plan.pull = 0.42 * pace * clamp(step / 0.42, 1, 1.8);
  // the reach from the door's top corner down to its pull, as long as it needs
  plan.reach = Math.max(0.36, dist(doorTop(f, DOOR_OPEN, _a), innerPull(f, CATCH, _b)) / 1.8) * pace;
  plan.sit = 0.58 * pace + plan.climb;
  plan.close = 0.46 * pace;
  plan.closeAt = plan.pull + 0.66 * plan.sit;
  plan.scripted = plan.closeAt + plan.close + 0.07 * pace;
  plan.duration = plan.approach + plan.scripted;
  return plan;
}

export function sampleEntry(plan, t, out) {
  const f = plan.frame, P = plan.pace, s = plan.s, tA = plan.approach, g = plan.grab, o = plan.opening, gy = plan.groundY, fw = plan.footwell;
  out.t = t; out.done = t >= plan.duration; out.seated = 0;
  out.camera = smooth(t / plan.duration);
  if (t < tA) {
    // ---- The walk: along the path, slowing into the grab station, the right hand reaching for the handle
    out.pose = false; out.door = 0; out.glass = 0;
    const u = t / tA, along = plan.length * (1 - (1 - u) ** 1.7);
    let left = along, i = 0;
    while (i < plan.legs.length - 1 && left > plan.legs[i]) { left -= plan.legs[i]; i++; }
    const a = plan.path[i], b = plan.path[i + 1], k = plan.legs[i] > 1e-6 ? clamp(left / plan.legs[i], 0, 1) : 1;
    out.x = lerp(a.x, b.x, k); out.z = lerp(a.z, b.z, k);
    const dir = plan.legs[i] > 1e-6 ? Math.atan2(b.x - a.x, b.z - a.z) : g.yaw;
    out.yaw = turnTo(dir, g.yaw, smooth(span(t, tA - 0.15 * P, tA)));
    out.pelvis.x = out.x; out.pelvis.y = plan.pelvisStand; out.pelvis.z = out.z; out.bodyYaw = out.yaw;
    out.recline = 0; out.duck = 0; out.look = 0;
    setHand(out.hands[0], restHand(out.pelvis, out.yaw, 1, s, _a), 0, 0, -1, 0);
    setHand(out.hands[1], handle(f, 0, _a), smooth(span(t, tA - 0.12 * P, tA)), -leftX(g.yaw) * 0.7, -0.7, -leftZ(g.yaw) * 0.7);
    out.feet[0].w = out.feet[1].w = 0;
    return out;
  }
  // ---- Scripted: the pull, the step into the opening, the seat, the door
  const T = t - tA, T1 = plan.pull, T2 = plan.sit, tSit = T1, tClose = plan.closeAt, T3 = plan.close;
  out.pose = true;
  const open = openCurve(span(T, 0.1 * T1, T1)), close = 1 - smooth(span(T, tClose, tClose + T3));
  out.door = DOOR_OPEN * open * close;
  const sit = span(T, tSit, tSit + T2);
  out.glass = smooth(span(sit, 0.15, 0.8));
  out.seated = smooth(sit);
  const step = smooth(span(T, 0.3 * T1, T1));
  if (sit <= 0) {
    out.pelvis.x = lerp(g.x, o.x, step); out.pelvis.z = lerp(g.z, o.z, step); out.pelvis.y = plan.pelvisStand;
    out.bodyYaw = lerp(g.yaw, o.yaw, step); out.recline = 0; out.duck = 0;
  } else {
    sitPath(plan, sit, out.pelvis);
    out.bodyYaw = sitYaw(plan, sit); out.recline = sitLean(plan, sit); out.duck = sitDuck(plan, sit);
  }
  out.look = 0;
  out.x = out.pelvis.x; out.z = out.pelvis.z; out.yaw = out.bodyYaw;
  const end = plan.scripted, fade = 1 - smooth(span(T, end - 0.12 * P, end)); // the last of it is PersonRig.drive's own driving pose
  // Feet: the step into the opening (left foot first), the right leg into the footwell, the left one after it
  const L = out.feet[0], R = out.feet[1];
  const lStep0 = 0.22 * T1, lStep1 = 0.68 * T1, rStep0 = 0.48 * T1, rStep1 = 0.98 * T1;
  const rIn0 = tSit + 0.02 * T2, rIn1 = tSit + 0.86 * T2, rPedal0 = tSit + 0.88 * T2, rPedal1 = tSit + 1.24 * T2;
  const lIn0 = tSit + 0.44 * T2, lIn1 = tSit + 1.18 * T2, lPedal0 = lIn1 + 0.02 * P, lPedal1 = lIn1 + 0.24 * P;
  if (T < lStep0) setFoot(L, stance(g, 1, gy, s, _a), g.yaw + 0.08, 1, 1);
  else if (T < lIn0) setFoot(L, swing(_a, stance(g, 1, gy, s, _b), stance(o, 1, gy, s, _c), T, lStep0, lStep1, 0.07), turnTo(g.yaw, o.yaw, trapezoid(span(T, lStep0, lStep1))) + 0.08, 1, 1);
  else if (T < lPedal0) setFoot(L, swing(_a, stance(o, 1, gy, s, _b), fw[0], T, lIn0, lIn1, 0.17), lerp(o.yaw + 0.08, -0.1, trapezoid(span(T, lIn0, lIn1))), 1, 1);
  else setFoot(L, swing(_a, fw[0], pedalAnkle(f, 1, _b), T, lPedal0, lPedal1, 0.03), lerp(-0.1, 0, smooth(span(T, lPedal0, lPedal1))), fade, fade);
  if (T < rStep0) setFoot(R, stance(g, -1, gy, s, _a), g.yaw - 0.08, 1, 1);
  else if (T < rIn0) setFoot(R, swing(_a, stance(g, -1, gy, s, _b), stance(o, -1, gy, s, _c), T, rStep0, rStep1, 0.07), turnTo(g.yaw, o.yaw, trapezoid(span(T, rStep0, rStep1))) - 0.08, 1, 1);
  else if (T < rPedal0) setFoot(R, swing(_a, stance(o, -1, gy, s, _b), fw[1], T, rIn0, rIn1, 0.17), lerp(o.yaw - 0.08, -0.1, trapezoid(span(T, rIn0, rIn1))), 1, 1);
  else setFoot(R, swing(_a, fw[1], pedalAnkle(f, -1, _b), T, rPedal0, rPedal1, 0.03), lerp(-0.1, 0, smooth(span(T, rPedal0, rPedal1))), fade, fade);
  // Right hand: the tug on the handle, then the B-pillar while the body goes in, then the wheel
  const hR = out.hands[1], hL = out.hands[0];
  const release = 0.1 * T1 + TUG * 0.9 * T1;
  if (T < release) setHand(hR, handle(f, out.door, _a), 1, -leftX(out.bodyYaw) * 0.7, -0.7, -leftZ(out.bodyYaw) * 0.7);
  else {
    mix(_a, handle(f, DOOR_OPEN * openCurve(TUG), _a), pillar(f, _b), smooth(span(T, release, T1)));
    setHand(hR, _a, 1 - smooth(span(T, tSit + 0.85 * T2, tSit + 0.85 * T2 + 0.2 * P)), -leftX(out.bodyYaw) * 0.6, -0.8, -leftZ(out.bodyYaw) * 0.6);
  }
  // Left hand: hanging, then up on the open door's top corner as the body lowers, then down to meet the door's pull
  // and bring it in
  const tCatch = tClose + 0.5 * T3, reach0 = tCatch - plan.reach, letGo = tClose + 0.87 * T3, catchAngle = CATCH;
  const top0 = 0.3 * T1, top1 = Math.min(tSit + 0.4 * T2, reach0 - 0.02 * P);
  if (T < top0) setHand(hL, restHand(out.pelvis, out.bodyYaw, 1, s, _a), 1, -Math.sin(out.bodyYaw) * 0.6 + leftX(out.bodyYaw) * 0.5, -0.4, -Math.cos(out.bodyYaw) * 0.6 + leftZ(out.bodyYaw) * 0.5);
  else if (T < reach0) {
    // from where it hung at the handle (the arm trails the step into the opening) up to the door's top corner
    _c.x = g.x; _c.y = plan.pelvisStand; _c.z = g.z;
    mix(_a, restHand(_c, g.yaw, 1, s, _a), doorTop(f, DOOR_OPEN, _b), smooth(span(T, top0, top1)));
    setHand(hL, _a, 1, leftX(out.bodyYaw) * 0.5, -0.8, leftZ(out.bodyYaw) * 0.5);
  } else {
    // the door comes to the hand: it meets the pull half way shut and follows it to the latch
    if (T < tCatch) mix(_a, doorTop(f, DOOR_OPEN, _a), innerPull(f, catchAngle, _b), smooth(span(T, reach0, tCatch)));
    else innerPull(f, Math.min(out.door, catchAngle), _a);
    setHand(hL, _a, 1 - smooth(span(T, letGo, end)), leftX(out.bodyYaw) * 0.3, -1, leftZ(out.bodyYaw) * 0.3);
  }
  return out;
}

/**
 * The way out: the door pushed open, the legs out, up and a step clear, the door pushed shut. Phases: the hand to the
 * pull [0, reach], the door open from just before that, rise [riseAt, + rise], step [stepAt, + step], the door shut
 * over `close` from 0.18 s into the step.
 */
export function planExit(frame, { groundY = 0, pace = 1 } = {}) {
  const plan = base(frame, groundY, pace);
  plan.approach = 0;
  // the left hand from the wheel to the door's pull, as long as it needs (a van's wheel is far forward)
  plan.reach = Math.max(0.17, dist(wheelGrip(frame, 1, _a), innerPull(frame, 0, _b)) / 1.9) * pace;
  plan.openAt = plan.reach - 0.07 * pace;
  plan.riseAt = plan.reach + 0.18 * pace;
  plan.rise = 0.5 * pace + plan.climb;
  plan.stepAt = plan.riseAt + plan.rise;
  const stride = Math.hypot(plan.clear.x - plan.opening.x, plan.clear.z - plan.opening.z);
  plan.step = Math.max(0.28, stride / 1.8) * pace;
  plan.closeAt = plan.stepAt + Math.max(0.18 * pace, plan.step - 0.1 * pace);
  plan.close = 0.24 * pace;
  plan.scripted = plan.duration = plan.closeAt + plan.close;
  return plan;
}

export function sampleExit(plan, t, out) {
  const f = plan.frame, P = plan.pace, s = plan.s, o = plan.opening, c = plan.clear, gy = plan.groundY, fw = plan.footwell;
  const T = t, tRise = plan.riseAt, T2 = plan.rise, tStep = plan.stepAt, T3 = plan.step, tClose = plan.closeAt, T4 = plan.close, end = plan.duration;
  out.t = t; out.done = t >= end; out.pose = true;
  out.camera = 1 - smooth(t / end);
  const tOpen = plan.openAt, tReach = plan.reach;
  const open = smooth(span(T, tOpen, tOpen + 0.4 * P)), close = slamCurve(span(T, tClose, tClose + T4));
  out.door = DOOR_OPEN * open * close;
  // The body: up out of the seat (the sit path backwards), then a step clear of the door
  const rise = span(T, tRise, tRise + T2), step = smooth(span(T, tStep, tStep + T3));
  out.glass = 1 - smooth(span(rise, 0.1, 0.7));
  out.seated = 1 - smooth(rise);
  if (rise < 1) {
    sitPath(plan, 1 - rise, out.pelvis);
    out.bodyYaw = sitYaw(plan, 1 - rise); out.recline = sitLean(plan, 1 - rise); out.duck = sitDuck(plan, 1 - rise);
  } else {
    out.pelvis.x = lerp(o.x, c.x, step); out.pelvis.z = lerp(o.z, c.z, step); out.pelvis.y = plan.pelvisStand;
    out.bodyYaw = lerp(o.yaw, c.yaw, step); out.recline = -0.12 * smooth(span(T, tClose - 0.08 * P, tClose + 0.06 * P)); out.duck = 0;
  }
  // the head turns to the door as the hand goes to it, then back ahead as the body turns out
  out.look = 0.7 * smooth(span(T, 0, tReach + 0.13 * P)) * (1 - smooth(span(rise, 0.3, 0.9)));
  out.x = out.pelvis.x; out.z = out.pelvis.z; out.yaw = out.bodyYaw;
  const L = out.feet[0], R = out.feet[1];
  // Feet: the left foot off its pedal and out onto the ground, the right in one long step out past it
  const lOff0 = tRise - 0.14 * P, lOff1 = tRise + 0.18 * T2, lOut1 = tRise + T2, lClear0 = tStep + 0.03 * P, lClear1 = tStep + T3 + 0.04 * P;
  const rOff0 = tRise, rOff1 = tRise + 0.42 * T2, rOut1 = end - 0.02 * P;
  if (T < lOff1) { const k = smooth(span(T, lOff0, lOff1)); setFoot(L, swing(_a, pedalAnkle(f, 1, _a), fw[0], T, lOff0, lOff1, 0.03), lerp(0, -0.1, k), 1, k); }
  else if (T < lClear0) setFoot(L, swing(_a, fw[0], stance(o, 1, gy, s, _b), T, lOff1, lOut1, 0.18), lerp(-0.1, o.yaw + 0.08, trapezoid(span(T, lOff1, lOut1))), 1, 1);
  else setFoot(L, swing(_a, stance(o, 1, gy, s, _b), stance(c, 1, gy, s, _c), T, lClear0, lClear1, 0.06), turnTo(o.yaw, c.yaw, trapezoid(span(T, lClear0, lClear1))) + 0.08, 1, 1);
  if (T < rOff1) { const k = smooth(span(T, rOff0, rOff1)); setFoot(R, swing(_a, pedalAnkle(f, -1, _a), fw[1], T, rOff0, rOff1, 0.03), lerp(0, -0.1, k), 1, k); }
  else setFoot(R, swing(_a, fw[1], stance(c, -1, gy, s, _b), T, rOff1, rOut1, 0.18), lerp(-0.1, c.yaw - 0.08, trapezoid(span(T, rOff1, rOut1))), 1, 1);
  // Left hand: the inner pull pushed out, held while the body climbs out, then the door's edge pushed shut
  const hL = out.hands[0], hR = out.hands[1];
  const edge0 = tStep + 0.02 * P, edge1 = tClose + 0.02 * P, letGo = tClose + PUSH * T4, track1 = tReach + 0.25 * P;
  if (T < tReach) {
    mix(_a, wheelGrip(f, 1, _a), innerPull(f, out.door, _b), smooth(span(T, 0, tReach)));
    setHand(hL, _a, 1, 0.3, -1, 0);
  } else if (T < track1) setHand(hL, innerPull(f, out.door, _a), 1, 0.3, -1, 0);
  else if (T < edge0) {
    // the pull slips on to the door's open position as the door reaches the strap; the hand climbs to the door's top
    // corner as the body stands up
    mix(_a, innerPull(f, Math.min(out.door, DOOR_OPEN * smooth(span(track1, tOpen, tOpen + 0.4 * P))), _a), innerPull(f, DOOR_OPEN, _b), smooth(span(T, track1, track1 + 0.13 * P)));
    mix(_a, _a, doorTop(f, DOOR_OPEN, _b), smooth(span(T, Math.max(tRise + 0.25 * T2, track1 + 0.14 * P), edge0)));
    setHand(hL, _a, 1, leftX(out.bodyYaw) * 0.5, -0.9, leftZ(out.bodyYaw) * 0.5);
  } else {
    if (T < letGo) mix(_a, doorTop(f, DOOR_OPEN, _a), doorEdge(f, out.door, _b), smooth(span(T, edge0, edge1)));
    else doorEdge(f, DOOR_OPEN * slamCurve(PUSH), _a);
    setHand(hL, _a, 1 - smooth(span(T, letGo, end)), leftX(out.bodyYaw) * 0.6, -0.7, leftZ(out.bodyYaw) * 0.6);
  }
  // Right hand: on the wheel until the body rises, then let go to hang
  setHand(hR, wheelGrip(f, -1, _a), 1 - smooth(span(T, tRise + 0.2 * T2, tRise + 0.65 * T2)), -0.8, -0.3, -0.3);
  return out;
}

export { clamp, lerp, smooth, trapezoid, span, stations };
