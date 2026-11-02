import * as THREE from 'three/webgpu';
import { attribute, float, floor, fract, fwidth, mix, positionLocal, sin, smoothstep, step, uniform, varying, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roundedBox } from './vehicles.js';

// Boats: a planing hull lofted from a few sections, driven by the shared car input. It climbs onto its plane with speed, leans
// into its turns, rides the swell and slams back down off a crest. Runs on the planar speed/vx/vz fields like a motorbike.

const WATER = -2.2;
const PART = { HULL: 0, PAINT: 1, DECK: 2, DARK: 3, METAL: 4, SEAT: 5, BOTTOM: 6 };
const smooth = (a, b, t) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };

// Half-breadth and heights along the hull, 0 at the transom to 1 at the stem
function section(t, L, B) {
  const nose = 1 - Math.pow(t, 2.6);
  const beam = (B / 2) * Math.pow(Math.max(0, nose), 0.62);
  const sheer = 0.96 + 0.5 * Math.pow(t, 2.2);
  const keel = 0.02 + 0.82 * Math.pow(t, 4);
  const chine = keel + 0.22 + 0.28 * t;
  return { z: -L / 2 + t * L, beam, sheer, keel, chine };
}

function hullGeometry(L, B) {
  const stations = 30, pos = [], parts = [], index = [];
  const across = 9; // keel to sheer to keel, over the bottom
  for (let i = 0; i <= stations; i++) {
    const t = i / stations, s = section(t, L, B);
    const right = [[0, s.keel], [s.beam * 0.5, s.keel + (s.chine - s.keel) * 0.42], [s.beam * 0.86, s.chine], [s.beam * 0.97, s.chine + 0.16], [s.beam, s.sheer]];
    const ring = [...right.slice().reverse().map(([x, y]) => [-x, y]), ...right.slice(1)];
    for (const [k, [x, y]] of ring.entries()) {
      pos.push(x, y, s.z);
      // Gloss topsides, a white boot line at the water, antifouling red under it
      parts.push(y > s.chine + 0.02 ? PART.PAINT : y > s.keel + (s.chine - s.keel) * 0.9 ? PART.HULL : PART.BOTTOM);
      void k;
    }
  }
  for (let i = 0; i < stations; i++) for (let k = 0; k < across - 1; k++) {
    const a = i * across + k, b = a + 1, c = a + across, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('part', new THREE.Float32BufferAttribute(parts, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// The deck between the sheer lines, the transom, the cockpit floor sunk into it
function deckGeometry(L, B) {
  const stations = 24, pos = [], parts = [], index = [];
  for (let i = 0; i <= stations; i++) {
    const t = i / stations, s = section(t, L, B);
    const y = s.sheer - 0.01;
    pos.push(-s.beam, y, s.z, s.beam, y, s.z);
    parts.push(PART.DECK, PART.DECK);
  }
  for (let i = 0; i < stations; i++) { const a = i * 2; index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const s0 = section(0, L, B);
  const base = pos.length / 3;
  pos.push(-s0.beam, s0.sheer, s0.z, s0.beam, s0.sheer, s0.z, -s0.beam * 0.86, s0.chine, s0.z, s0.beam * 0.86, s0.chine, s0.z);
  parts.push(PART.HULL, PART.HULL, PART.HULL, PART.HULL);
  index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('part', new THREE.Float32BufferAttribute(parts, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const tag = (g, id) => {
  const n = g.index ? g.toNonIndexed() : g;
  n.setAttribute('part', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count).fill(id), 1));
  return n;
};
const box = (w, h, d, x, y, z, rx = 0, id = PART.DARK) => tag(new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z), id);

// A mahogany runabout: long varnished foredeck, cream leather, chrome along the sheer, the engine under the sun pad
function runaboutGeometry(L, B) {
  const hull = hullGeometry(L, B).toNonIndexed(), deck = deckGeometry(L, B).toNonIndexed();
  const s = section(0.4, L, B), aft = section(0.1, L, B);
  const floor = s.sheer - 0.46, parts = [hull, deck];
  const soft = (hw, hh, depth, r, x, y, z, rx = 0, id = PART.SEAT) => tag(roundedBox(hw, hh, depth, r, 0.03).rotateX(rx).translate(x, y, z), id);
  parts.push(box(B * 0.74, 0.03, L * 0.3, 0, floor, -L * 0.1, 0, PART.DARK));
  // Bench and split front seats, deep and rounded
  parts.push(soft(B * 0.33, 0.13, 0.62, 0.1, 0, floor + 0.3, -L * 0.2), soft(B * 0.33, 0.3, 0.17, 0.08, 0, floor + 0.66, -L * 0.2 - 0.33, -0.14));
  for (const side of [-1, 1]) {
    parts.push(soft(0.3, 0.1, 0.56, 0.08, side * 0.46, floor + 0.3, L * 0.02), soft(0.3, 0.27, 0.15, 0.07, side * 0.46, floor + 0.66, L * 0.02 - 0.31, -0.14));
    // Chrome rubbing strake along the sheer, stern to stem
    const rail = [];
    for (let i = 0; i <= 26; i++) {
      const a = section(i / 26 * 0.97, L, B);
      rail.push(new THREE.Vector3(side * (a.beam + 0.012), a.sheer - 0.02, a.z));
    }
    parts.push(tag(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail), 34, 0.022, 5).toNonIndexed(), PART.METAL));
    parts.push(box(0.03, 0.2, 0.03, side * (aft.beam - 0.1), aft.sheer + 0.09, aft.z, 0, PART.METAL));
  }
  // Dash, wheel, engine hatch, flagstaff
  const dashY = section(0.54, L, B).sheer - 0.12, dashZ = section(0.54, L, B).z - 0.22;
  parts.push(box(B * 0.66, 0.34, 0.1, 0, dashY, dashZ, -0.28, PART.DECK));
  parts.push(tag(new THREE.TorusGeometry(0.19, 0.017, 6, 22).rotateX(-0.5).translate(0.46, dashY + 0.14, dashZ - 0.24), PART.METAL));
  parts.push(box(0.05, 0.05, 0.3, 0.46, dashY + 0.06, dashZ - 0.14, -0.5, PART.METAL));
  parts.push(box(B * 0.76, 0.12, L * 0.24, 0, aft.sheer + 0.04, -L * 0.38, 0, PART.DECK));
  const flag = section(0, L, B);
  parts.push(box(0.022, 0.8, 0.022, 0, flag.sheer + 0.4, flag.z + 0.08, -0.25, PART.METAL));
  return mergeGeometries(parts.map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); n.computeVertexNormals(); return n; }));
}

function screenGeometry(L, B) {
  const s = section(0.56, L, B), segments = 10, pos = [], index = [];
  const halfW = s.beam * 0.92, foot = s.sheer + 0.02, top = foot + 0.56, z = s.z;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments - 0.5) * 2, x = a * halfW;
    const sweep = -(a * a) * 0.9;
    pos.push(x, foot, z + sweep, x * 0.96, top, z + sweep - 0.42);
  }
  for (let i = 0; i < segments; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function boatMaterial(paint) {
  const mat = new THREE.MeshStandardNodeMaterial();
  const colour = uniform(new THREE.Color(paint));
  const part = varying(attribute('part', 'float'));
  const is = (id) => step(id - 0.5, part).mul(step(part, id + 0.5));
  const white = vec3(0.86, 0.87, 0.85);
  // Varnished planks with their pale caulking, the grain running fore and aft
  const planks = positionLocal.x.mul(7).add(0.5);
  // Fine lines fade with distance rather than shimmer
  const seam = smoothstep(0.05, 0.0, fract(planks).sub(0.5).abs().sub(0.45).abs()).mul(smoothstep(0.45, 0.12, fwidth(planks)));
  const grain = sin(positionLocal.z.mul(3.1).add(floor(planks).mul(7.3))).mul(sin(positionLocal.z.mul(17).add(positionLocal.x.mul(41)))).mul(0.5).add(0.5);
  const tone = fract(floor(planks).mul(0.37)).mul(0.5).add(0.75);
  const wood = mix(vec3(0.075, 0.024, 0.01), vec3(0.17, 0.058, 0.02), grain).mul(tone);
  const deck = mix(wood, vec3(0.5, 0.45, 0.34), seam.mul(0.8));
  const c = white.mul(is(PART.HULL)).add(colour.mul(is(PART.PAINT))).add(deck.mul(is(PART.DECK))).add(vec3(0.03, 0.03, 0.035).mul(is(PART.DARK)))
    .add(vec3(0.72, 0.74, 0.78).mul(is(PART.METAL))).add(vec3(0.74, 0.68, 0.56).mul(is(PART.SEAT))).add(vec3(0.34, 0.05, 0.04).mul(is(PART.BOTTOM)));
  mat.colorNode = c;
  mat.roughnessNode = float(0.16).add(is(PART.DARK).mul(0.6)).add(is(PART.SEAT).mul(0.32)).add(is(PART.BOTTOM).mul(0.5));
  mat.metalnessNode = is(PART.METAL).mul(0.95).add(is(PART.PAINT).mul(0.3));
  mat.side = THREE.DoubleSide;
  mat.userData.paint = colour;
  return mat;
}

const LENGTH = 8.2, BEAM = 2.7;
const SPEC = { name: 'boat', zFront: LENGTH / 2, zRear: -LENGTH / 2, wheelZ: 1, wheelX: 0, wheelRadius: 0.3, doors: [0.6, -0.6], halfW: BEAM / 2, height: 2 };
const shared = {};

function createBoat(scene, { paint = 0x0c1f33 } = {}) {
  shared.hull ??= runaboutGeometry(LENGTH, BEAM);
  shared.screen ??= screenGeometry(LENGTH, BEAM);
  shared.glass ??= new THREE.MeshStandardNodeMaterial({ color: 0x0a1014, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
  const root = new THREE.Group();
  root.name = 'Boat';
  const hullPivot = new THREE.Group();
  root.add(hullPivot);
  const material = boatMaterial(paint);
  const body = new THREE.Mesh(shared.hull, material);
  body.castShadow = true;
  body.receiveShadow = true;
  hullPivot.add(body, new THREE.Mesh(shared.screen, shared.glass));
  scene.add(root);
  return {
    type: 'car', kind: 'boat', boat: true, spec: SPEC, paint, mesh: root, chassisPivot: hullPivot, carState: null, headLights: [], wheels: [],
    bodyMesh: body, paintMaterial: material, halfW: BEAM / 2, halfL: LENGTH / 2, label: 'Hauturier · Mouette',
    position: new THREE.Vector3(), prevX: 0, prevZ: 0, heading: 0, speed: 0, vx: 0, vz: 0, angularVel: 0, steerAngle: 0,
    pitchVel: 0, rollVel: 0, heaveY: 0, heaveVel: 0, lastCollisionSpark: null, wheelSpin: 0,
    pitch: 0, roll: 0, heave: 0, plane: 0, slam: 0, drive: { speed: 31, reverseSpeed: 5 },
    sound: { rpm: 900, throttle: 0, shift: 0, nitro: 0, skid: 0, scrape: 0, wall: 0, backfire: 0, landed: 0, vx: 0, vy: 0, vz: 0, grounded: 4,
      wheels: [0, 1, 2, 3].map(() => ({ rough: 0.03, grip: 1, hasGround: false })) },
    tune: null, audioTune: { redline: 5800 },
    seat: { y: 1.0, z: -0.9 }, bars: { y: 1.4, z: -0.2 }, pegs: { y: 0.55, z: -0.5 },
    cameraTargetOffset: new THREE.Vector3(0, 1.1, 0), chaseDistance: 10.5, chaseHeight: 3.1
  };
}

// The river's swell, the same for everything afloat
function swell(x, z, t) {
  return 0.16 * Math.sin(x * 0.11 + t * 0.9) + 0.12 * Math.sin(z * 0.17 - t * 1.1) + 0.07 * Math.sin((x + z) * 0.31 + t * 1.7);
}

const TOP = 31, ACCELERATION = 9.5, REVERSE = 4, MAX_YAW = 1.15;

/**
 * One boat's step.
 * @param {object} world - afloat(x, z): is this open water; clock: seconds, for the swell
 * @returns {number} closing speed if it just ran aground
 */
function stepBoat(c, throttle, steer, dt, world) {
  if (dt <= 0) return 0;
  c.prevX = c.position.x; c.prevZ = c.position.z;
  const sin0 = Math.sin(c.heading), cos0 = Math.cos(c.heading);
  let forward = c.speed, wvx = c.vx, wvz = c.vz;
  const lateral = wvx * cos0 - wvz * sin0;
  if (throttle > 0) forward += ACCELERATION * throttle * Math.max(0, 1 - (forward / TOP) ** 2) * dt;
  else if (throttle < 0) forward += (forward > 1 ? 7 : REVERSE) * throttle * dt;
  forward *= Math.exp(-dt * (throttle ? 0.05 : 0.42));
  if (forward < -6) forward = -6;
  // The hull carries its way through a turn before the water takes it back: a boat skids, it does not corner
  const yawTarget = steer * MAX_YAW * smooth(0, 7, Math.abs(forward)) * (1 - 0.4 * smooth(16, 30, forward)) * (forward < 0 ? -1 : 1);
  c.angularVel += (yawTarget - c.angularVel) * (1 - Math.exp(-dt * 2.6));
  c.heading += c.angularVel * dt;
  c.steerAngle = steer * 0.4;
  const slip = lateral * Math.exp(-dt * 1.5);
  const sin = Math.sin(c.heading), cos = Math.cos(c.heading);
  // Turning the bow does not turn the momentum at once
  const worldX = sin0 * forward + cos0 * slip, worldZ = cos0 * forward - sin0 * slip;
  c.speed = worldX * sin + worldZ * cos;
  c.vx = worldX - sin * c.speed;
  c.vz = worldZ - cos * c.speed;
  const nx = c.position.x + worldX * dt, nz = c.position.z + worldZ * dt;
  const bowX = nx + sin * c.halfL, bowZ = nz + cos * c.halfL;
  let aground = 0;
  if (world.afloat(bowX, bowZ) && world.afloat(nx, nz)) { c.position.x = nx; c.position.z = nz; }
  else {
    aground = Math.abs(c.speed);
    c.speed = -c.speed * 0.25; c.vx *= 0.3; c.vz *= 0.3;
    c.angularVel += (Math.random() - 0.5) * 0.8;
  }

  // On its plane the hull lifts and levels; on the way there it stands on its stern
  const v = Math.abs(c.speed);
  c.plane = smooth(7, 15, v);
  const hump = smooth(3, 8, v) * (1 - smooth(9, 16, v));
  const t = world.clock;
  const slope = (swell(c.position.x + sin * 3, c.position.z + cos * 3, t) - swell(c.position.x - sin * 3, c.position.z - cos * 3, t)) / 6;
  const targetPitch = -(0.15 * hump + 0.035 * c.plane + Math.max(0, throttle) * 0.03) + slope * (1 - c.plane * 0.5) * 1.4;
  c.pitchVel += ((targetPitch - c.pitch) * 16 - c.pitchVel * 5) * dt;
  c.pitch += c.pitchVel * dt;
  const targetRoll = -steer * Math.min(1, v / 12) * 0.3 + (swell(c.position.x + cos * 1.5, c.position.z - sin * 1.5, t) - swell(c.position.x - cos * 1.5, c.position.z + sin * 1.5, t)) * 0.4;
  c.rollVel += ((targetRoll - c.roll) * 14 - c.rollVel * 5) * dt;
  c.roll += c.rollVel * dt;
  // A fast hull leaves the crests: it comes back down with a slam
  const surface = swell(c.position.x, c.position.z, t) * (1 + c.plane * 0.6);
  const rest = surface + 0.12 + c.plane * 0.24;
  c.heaveVel -= 9.81 * dt;
  c.heave += c.heaveVel * dt;
  if (c.heave < rest) {
    const hit = -c.heaveVel;
    if (hit > 2.2) c.slam = Math.min(1, hit / 6);
    c.heave += (rest - c.heave) * Math.min(1, dt * 9);
    c.heaveVel = Math.max(c.heaveVel, (rest - c.heave) * 9 + (surface - (c.lastSurface ?? surface)) / dt * (0.6 + c.plane * 0.9));
  }
  c.lastSurface = surface;
  c.position.y = WATER - 0.3 + c.heave;
  c.chassisPivot.rotation.x = c.pitch;
  c.chassisPivot.rotation.z = c.roll;
  const sound = c.sound;
  if (sound) {
    sound.throttle = Math.abs(throttle);
    sound.rpm += ((900 + Math.max(0, throttle) * 2200 + Math.min(1, v / TOP) * 2700) - sound.rpm) * Math.min(1, dt * 5);
    sound.vx = worldX; sound.vz = worldZ;
    if (c.slam > 0.3) sound.landed = c.slam;
  }
  return aground;
}

// A boat that hunts, or runs: a pilot steering for the bow to bear, a gunner shooting whenever it does
function driveBoatAI(c, dt, target, world) {
  const ai = c.boatAI;
  const dx = target.x - c.position.x, dz = target.z - c.position.z, d = Math.hypot(dx, dz);
  let aim = Math.atan2(dx, dz), throttle = d > 26 ? 1 : 0.55;
  if (ai.flee) { aim += Math.PI; throttle = 1; }
  if (ai.gaveUp) { aim += Math.PI; throttle = 0.7; }
  // Feeling for the shore a good way ahead
  const delta = Math.atan2(Math.sin(aim - c.heading), Math.cos(aim - c.heading));
  let steer = Math.max(-1, Math.min(1, delta * 2));
  for (const side of [0, -0.6, 0.6]) {
    const look = c.heading + side, reach = 40 + Math.abs(c.speed) * 1.4;
    if (!world.afloat(c.position.x + Math.sin(look) * reach, c.position.z + Math.cos(look) * reach)) steer = side > 0 ? -1 : 1;
  }
  world.simulate(c, throttle, steer, dt);
  if (!ai.flee && !ai.gaveUp && d < 70 && (ai.gunT -= dt) <= 0) {
    ai.gunT = 0.5 + Math.random() * 0.8;
    world.shoot(c.position.x, c.position.y + 1.6, c.position.z, 0.3 * (1 - d / 95), 10);
  }
}

// A long white motor yacht for the money to hide on
function createYacht(scene, { paint = 0xe8e8e4 } = {}) {
  const L = 34, B = 7.4;
  const root = new THREE.Group();
  root.name = 'Yacht';
  const mat = boatMaterial(0x1a2a3a);
  const hull = new THREE.Mesh(mergeGeometries([hullGeometry(L, B).toNonIndexed(), deckGeometry(L, B).toNonIndexed()].map((g) => { g.scale?.(1, 2.4, 1); g.computeVertexNormals(); return g; })), mat);
  hull.castShadow = true;
  root.add(hull);
  const white = new THREE.MeshStandardNodeMaterial({ color: paint, roughness: 0.3 });
  const glass = new THREE.MeshStandardNodeMaterial({ color: 0x0b1218, roughness: 0.08, metalness: 0.5 });
  const piece = (w, h, d, x, y, z, m = white) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; root.add(b); return b; };
  piece(B * 0.72, 2.2, L * 0.46, 0, 4.4, -2);
  piece(B * 0.725, 0.9, L * 0.44, 0, 4.5, -2, glass);
  piece(B * 0.56, 1.9, L * 0.26, 0, 6.4, -3);
  piece(B * 0.565, 0.8, L * 0.24, 0, 6.5, -3, glass);
  piece(0.3, 2.6, 0.3, 0, 8.6, -3);
  root.position.y = WATER;
  scene.add(root);
  return root;
}

export { WATER, createBoat, createYacht, driveBoatAI, stepBoat, swell };
