import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import { loadModule } from './helpers/module.cjs';

// Execute the production rig, capture sampler and skinning math with the shipped avatars, without a GPU.
const load = (file, imports, globals = {}) => loadModule(readFileSync(new URL('../js/' + file, import.meta.url), 'utf8'), { imports, globals, filename: file });
const fetchBuffer = async name => {
  const b = readFileSync(new URL('../assets/people/' + name, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const human = load('human-skeleton.js', {});
const capture = load('mocap.js', { './people-assets.js': { fetchBuffer } }, { TextDecoder });
await capture.loadMocap();
const bodies = load('person-body.js', { 'three/webgpu': THREE, './mocap.js': capture });
const { BodyDriver, HOLD, SLOTS } = load('person-motion.js', { 'three/webgpu': THREE, './mocap.js': capture, './human-skeleton.js': human, './person-body.js': bodies });
const { PersonRig } = load('pedestrians.js', {
  'three/webgpu': THREE, 'three/tsl': {}, 'three/addons/utils/BufferGeometryUtils.js': {}, './human-skeleton.js': human,
  './human-assets.js': { crowd: {} }, './human-crowd.js': { MALE_BODIES: 12, FEMALE_BODIES: 12 }, './person-lighting.js': {}
});
const { CrowdMotion, loadCrowdMotion } = load('crowd-motion.js', { './people-assets.js': { fetchBuffer }, './human-skeleton.js': human }, { TextDecoder });
await loadCrowdMotion();

async function avatar(name) {
  const b = await fetchBuffer(name + '.bin'), n = new DataView(b).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(b, 4, n)));
  let offset = (4 + n + 3) & ~3;
  const types = [Float32Array, Float32Array, Float32Array, Uint8Array, Uint8Array, Uint32Array, Float32Array];
  const arrays = header.sections.map((size, i) => {
    const a = new types[i](b, offset, size / types[i].BYTES_PER_ELEMENT);
    offset = (offset + size + 3) & ~3;
    return a;
  });
  const [position, , , index, weight, faces, bind] = arrays;
  const shoes = [];
  for (let i = 0; i < position.length / 3; i++) if (position[i * 3 + 1] < 0.16) shoes.push(i);
  return { ...header, position, index, weight, faces, bind, shoes };
}
const hero = await avatar('hero'), sk = new bodies.Skeleton(hero);
const male = await avatar('crowd-m01'), female = await avatar('crowd-f01');
const q = new THREE.Quaternion(), v = new THREE.Vector3(), p = new THREE.Vector3(), s = new THREE.Vector3();

function heroSole(body, surface = () => 0) {
  const matrices = sk.inverse.map((inv, b) => new THREE.Matrix4().compose(p.fromArray(body.wp, b * 3), q.fromArray(body.wq, b * 4), s.setScalar(body.scale)).multiply(inv));
  let minimum = Infinity;
  for (const i of hero.shoes) {
    let x = 0, y = 0, z = 0;
    for (let j = 0; j < 4; j++) {
      const w = hero.weight[i * 4 + j] / 255;
      if (w) {
        v.fromArray(hero.position, i * 3).applyMatrix4(matrices[hero.index[i * 4 + j]]);
        x += v.x * w; y += v.y * w; z += v.z * w;
      }
    }
    minimum = Math.min(minimum, y - surface(x, z));
  }
  return minimum;
}

function crowdSole(rig, model) {
  let minimum = Infinity;
  for (const i of model.shoes) {
    let y = 0;
    for (let j = 0; j < 4; j++) {
      const w = model.weight[i * 4 + j] / 255, at = model.index[i * 4 + j] * 8;
      if (w) y += (v.fromArray(model.position, i * 3).applyQuaternion(q.fromArray(rig.pose, at)).y * rig.pose[at + 7] + rig.pose[at + 5]) * w;
    }
    minimum = Math.min(minimum, y);
  }
  return minimum;
}

test('the real hero walk and run do not inherit the procedural pelvis dip, including at 20 fps', () => {
  for (const fps of [20, 30, 60]) for (const speed of [1.4, 3.8, 7]) {
    const rig = new PersonRig(), driver = new BodyDriver(sk);
    let minimum = Infinity;
    for (let f = 0; f < fps * 4; f++) {
      rig.update(1 / fps, 0, speed * f / fps, 0, () => 0.22);
      driver.update(1 / fps, rig, null);
      if (f > fps / 2) minimum = Math.min(minimum, heroSole(driver.body) - 0.22);
    }
    assert.ok(minimum > -0.04, `${fps} fps, ${speed} m/s: shoe ${minimum.toFixed(3)} m below the pavement`);
    assert.ok(Math.abs(driver.body.root[1] - 0.22) < 1e-5, 'the root follows the support, not the second gait');
  }
});

test('male and female pedestrians keep their captured feet above the pavement through walking and running', () => {
  for (const [isFemale, model] of [[false, male], [true, female]]) for (const speed of [1.4, 3.8, 7]) {
    const rig = new PersonRig({ female: isFemale }); rig.motion = new CrowdMotion(rig);
    let minimum = Infinity;
    for (let f = 0; f < 120; f++) {
      rig.update(1 / 30, 0, speed * f / 30, 0, () => 0.22);
      if (f > 20) minimum = Math.min(minimum, crowdSole(rig, model) - 0.22);
    }
    assert.ok(minimum > -0.045, `${isFemale ? 'female' : 'male'}, ${speed} m/s: sole ${minimum.toFixed(3)} m below pavement`);
  }
});

test('capture follows ground changes and teleports, while airborne poses retain their lift', () => {
  const rig = new PersonRig(), driver = new BodyDriver(sk);
  for (const y of [0, 0.22, 12, 0]) {
    rig.reset(20, 30, 0, () => y);
    driver.update(1 / 60, rig, null);
    assert.ok(Math.abs(driver.body.root[1] - y) < 1e-5);
  }
  rig.update(1 / 60, 20, 30, 0, () => 12, null, 1.5);
  driver.update(1 / 60, rig, null);
  assert.ok(Math.min(...sk.bone.foot.map(b => driver.body.wp[b * 3 + 1])) > 13, 'jumping must not get pinned to the support');
});

test('the hero steps onto and off a 22 cm curb without burying the leading shoe', () => {
  for (const speed of [1.4, 3.8, 7]) for (const heading of [0, Math.PI]) {
    const rig = new PersonRig(), driver = new BodyDriver(sk);
    const surface = (_x, z) => z >= 2 ? 0.22 : 0;
    let minimum = Infinity;
    for (let f = 0; f < 120; f++) {
      const z = heading === 0 ? -2 + speed * f / 30 : 6 - speed * f / 30;
      rig.update(1 / 30, 0, z, heading, (_owner, x, z) => surface(x, z));
      driver.update(1 / 30, rig, null);
      if (f > 15) minimum = Math.min(minimum, heroSole(driver.body, surface));
    }
    assert.ok(minimum > -0.045, `${speed} m/s, heading ${heading}: shoe ${minimum.toFixed(3)} m below curb`);
  }
});

test('gait selection and cycle distance account for the displayed body size', () => {
  const phases = [], crowdPhases = [];
  for (const scale of [0.85, 1.15]) {
    const rig = new PersonRig({ scale }), driver = new BodyDriver(sk);
    const speed = 2 * scale * 0.92 / sk.legLength;
    const passer = new PersonRig({ scale }); passer.motion = new CrowdMotion(passer);
    for (let f = 0; f < 120; f++) {
      rig.update(1 / 60, 0, speed * f / 60, 0, () => 0); driver.update(1 / 60, rig, null);
      passer.update(1 / 60, 0, 2 * scale * f / 60, 0, () => 0);
    }
    phases.push(driver.phase); crowdPhases.push(passer.motion.phase);
  }
  assert.ok(Math.abs(phases[0] - phases[1]) < 1e-5);
  assert.ok(Math.abs(crowdPhases[0] - crowdPhases[1]) < 1e-5);
});

test('feet keep their support while capture fades back in after a curb drop', () => {
  const rig = new PersonRig(), driver = new BodyDriver(sk);
  rig.reset(0, 0, Math.PI / 2, () => 0.22);
  for (let i = 0; i < 6; i++) {
    rig.update(1 / 30, i * 7.8 / 30, 0, Math.PI / 2, () => 0, null, 0.22);
    driver.update(1 / 30, rig, null);
  }
  for (let i = 6; i < 36; i++) {
    rig.update(1 / 30, i * 7.8 / 30, 0, Math.PI / 2, () => 0);
    driver.update(1 / 30, rig, null);
    assert.ok(heroSole(driver.body) > -0.04, `landing blend ${i}: soles must not wait for the fade to finish`);
  }
});

test('all four firearms shoulder toward the target, retain finite bones and put the muzzle in front of the hands', () => {
  for (const kind of ['pistol', 'smg', 'shotgun', 'rifle']) for (const yaw of [0, 1.7, -2.2]) {
    const rig = new PersonRig(), driver = new BodyDriver(sk);
    rig.reset(12, 30, yaw, () => 0.22);
    rig.aim = { x: 12 + Math.sin(yaw) * 30, y: 1.75, z: 30 + Math.cos(yaw) * 30 };
    rig.gunReady = true;
    driver.snapWeapon(kind);
    for (let i = 0; i < 60; i++) driver.update(1 / 60, rig, kind);
    const barrel = new THREE.Vector3(0, 0, 1).applyQuaternion(driver.gunQ);
    const target = new THREE.Vector3(rig.aim.x, rig.aim.y, rig.aim.z).sub(driver.gunP).normalize();
    assert.ok(barrel.dot(target) > 0.999, `${kind}: barrel points at sight`);
    const muzzle = driver.muzzle(HOLD[kind], new THREE.Vector3());
    const palm = new THREE.Vector3(...HOLD[kind].grip).applyQuaternion(driver.gunQ).add(driver.gunP);
    assert.ok(muzzle.clone().sub(palm).dot(barrel) > 0.12, `${kind}: muzzle in front of grip`);
    assert.ok(driver.body.wp.every(Number.isFinite));
    assert.ok(muzzle.y > 1.2 && muzzle.y < 1.9, `${kind}: shouldered at human height`);
  }
});

test('reload takes the support hand to the belt and returns it, without displacing the shooting hand from the weapon', () => {
  const rig = new PersonRig(), driver = new BodyDriver(sk);
  rig.reset(0, 0, 0, () => 0);
  rig.aim = { x: 0, y: 1.5, z: 30 }; rig.gunReady = true;
  driver.snapWeapon('rifle');
  for (let i = 0; i < 60; i++) driver.update(1 / 60, rig, 'rifle');
  const support = sk.bone.hand[0] * 3;
  const readyHeight = driver.body.wp[support + 1];
  rig.reloading = 0.4; driver.update(0, rig, 'rifle');
  assert.ok(driver.body.wp[support + 1] < readyHeight - 0.25, 'support hand reaches the belt for a magazine');
  assert.ok(driver.body.wp.every(Number.isFinite));
  rig.reloading = -1; driver.update(0, rig, 'rifle');
  assert.ok(Math.abs(driver.body.wp[support + 1] - readyHeight) < 0.02, 'support hand returns to the fore-end');
});

test('the actual skinned jacket does not hide firearm barrels from either shoulder camera', () => {
  for (const shoulder of [-1, 1]) for (const kind of ['pistol', 'smg', 'shotgun', 'rifle']) {
  const rig = new PersonRig(), driver = new BodyDriver(sk);
  rig.reset(0, 0, 0, () => 0.22);
  rig.aim = { x: -0.68 * shoulder, y: 0.22, z: 16, shoulder }; rig.gunReady = true;
  driver.snapWeapon(kind);
  for (let i = 0; i < 60; i++) driver.update(1 / 60, rig, kind);
  const body = driver.body;
  const matrices = sk.inverse.map((inv, b) => new THREE.Matrix4().compose(p.fromArray(body.wp, b * 3), q.fromArray(body.wq, b * 4), s.setScalar(body.scale)).multiply(inv));
  const vertices = new Float32Array(hero.position.length);
  for (let i = 0; i < hero.position.length / 3; i++) for (let j = 0; j < 4; j++) {
    const weight = hero.weight[i * 4 + j] / 255;
    if (!weight) continue;
    v.fromArray(hero.position, i * 3).applyMatrix4(matrices[hero.index[i * 4 + j]]);
    vertices[i * 3] += v.x * weight; vertices[i * 3 + 1] += v.y * weight; vertices[i * 3 + 2] += v.z * weight;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(hero.faces, 1));
  const jacket = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  jacket.updateMatrixWorld();
  // the aimed gameplay framing of cameras.js: 0.68 m aside, 2.25 m back from a pivot 1.62 m up
  const camera = new THREE.Vector3(-0.68 * shoulder, 0.22 + 1.62 + Math.sin(0.09) * 2.25, -Math.cos(0.09) * 2.25);
  const muzzle = driver.muzzle(HOLD[kind], new THREE.Vector3());
  const ray = new THREE.Raycaster(camera, muzzle.clone().sub(camera).normalize(), 0, camera.distanceTo(muzzle) - 0.01);
  assert.equal(ray.intersectObject(jacket).length, 0, `${kind}, shoulder ${shoulder}: the character must not occlude the firearm in gameplay framing`);
  geometry.dispose(); jacket.material.dispose();
  }
});

// ---- Carrying, drawing and stowing -----------------------------------------------------------------------------------
const stand = (yaw = 0) => {
  const rig = new PersonRig(), driver = new BodyDriver(sk);
  rig.reset(0, 0, yaw, () => 0);
  return { rig, driver };
};
const joint = (driver, b) => new THREE.Vector3().fromArray(driver.body.wp, b * 3);

test('a weapon is drawn from the body into the hands in its own time and cannot fire on the way', () => {
  for (const kind of ['pistol', 'smg', 'shotgun', 'rifle']) {
    const { rig, driver } = stand();
    rig.gunReady = true;
    for (let i = 0; i < 30; i++) driver.update(1 / 60, rig, null);
    assert.equal(driver.gunKind, null);
    assert.equal(driver.armed, false);
    const slot = new THREE.Vector3(), q0 = new THREE.Quaternion();
    driver.update(1 / 60, rig, kind);
    driver.slotPose(kind, slot, q0);
    assert.equal(driver.gunKind, kind);
    assert.ok(driver.gunP.distanceTo(slot) < 0.02, `${kind}: it starts where it is stowed`);
    let frames = 1;
    while (!driver.armed && frames < 200) { driver.update(1 / 60, rig, kind); frames++; assert.ok(driver.body.wp.every(Number.isFinite)); }
    assert.ok(Math.abs(frames / 60 - HOLD[kind].draw) < 0.06, `${kind}: drawn in ${frames} frames`);
    const grip = new THREE.Vector3(...HOLD[kind].grip).applyQuaternion(driver.gunQ).add(driver.gunP);
    assert.ok(grip.distanceTo(joint(driver, sk.bone.hand[1])) < 0.16, `${kind}: the right hand holds its grip`);
    assert.ok(grip.z > 0.1, `${kind}: in front of the body once drawn`);
  }
});

test('changing weapons puts the first away before the second comes out, and a change of mind turns round', () => {
  const { rig, driver } = stand();
  driver.snapWeapon('pistol');
  const seen = [];
  for (let i = 0; i < 120; i++) {
    driver.update(1 / 60, rig, 'rifle');
    if (seen.at(-1) !== driver.gunKind) seen.push(driver.gunKind);
    if (driver.gunKind !== 'rifle') assert.equal(driver.armed, false);
  }
  assert.deepEqual(seen, ['pistol', null, 'rifle']);
  assert.equal(driver.armed, true);
  // half-way into the holster, the player wants it back: it comes back without touching the holster
  driver.snapWeapon('pistol');
  for (let i = 0; i < 6; i++) driver.update(1 / 60, rig, null);
  const half = driver.swap;
  assert.ok(half > 0.3 && half < 0.9);
  driver.update(1 / 60, rig, 'pistol');
  assert.ok(driver.swap > half);
  for (let i = 0; i < 40; i++) driver.update(1 / 60, rig, 'pistol');
  assert.equal(driver.armed, true);
});

test('stowed weapons sit on the body: a pistol low on the right thigh, long guns across the back with a clear right shoulder', () => {
  const { rig, driver } = stand();
  for (let i = 0; i < 20; i++) driver.update(1 / 60, rig, null);
  const P = new THREE.Vector3(), Q = new THREE.Quaternion(), at = (kind, point) => new THREE.Vector3(...point).applyQuaternion(Q).add(P);
  const hip = joint(driver, sk.bone.thigh[1]), knee = joint(driver, sk.bone.calf[1]), shoulder = joint(driver, sk.bone.upper[1]), spine = joint(driver, sk.bone.spine2);
  driver.slotPose('pistol', P, Q);
  const grip = at('pistol', HOLD.pistol.grip), muzzle = at('pistol', HOLD.pistol.muzzle);
  assert.ok(grip.x < hip.x - 0.05 && grip.x > hip.x - 0.2, 'outside the right thigh');
  assert.ok(grip.y < hip.y && grip.y > knee.y && muzzle.y < grip.y, 'between hip and knee, muzzle down');
  for (const kind of ['shotgun', 'rifle']) {
    driver.slotPose(kind, P, Q);
    const butt = at(kind, HOLD[kind].butt), end = at(kind, HOLD[kind].muzzle);
    for (const p of [butt, end]) assert.ok(p.z < spine.z - 0.08 && p.z > spine.z - 0.34, `${kind}: against the back, not inside it nor floating`);
    assert.ok(end.y > butt.y + 0.4 && end.x > 0.1, `${kind}: muzzle up over the left shoulder`);
    assert.ok(butt.x < 0 && butt.y < spine.y - 0.2, `${kind}: grip low behind the right hip, where the right hand finds it`);
    // sample the whole weapon: nothing may stand on the right shoulder, which is where the aiming camera looks past
    for (let t = 0; t <= 1; t += 0.05) {
      const p = butt.clone().lerp(end, t);
      assert.ok(!(p.x < shoulder.x + 0.12 && p.y > shoulder.y - 0.02), `${kind}: clear of the right shoulder at ${t.toFixed(2)}`);
    }
  }
  assert.equal(SLOTS[HOLD.smg.slot].hidden, true, 'the SMG lives under the jacket');
});

test('a long gun carried in one hand keeps its muzzle low and ahead at every pace', () => {
  for (const kind of ['shotgun', 'rifle', 'smg', 'pistol']) for (const speed of [0, 1.6, 3.9, 7.5]) {
    const { rig, driver } = stand();
    driver.snapWeapon(kind);
    rig.gunReady = false;
    let z = 0;
    for (let i = 0; i < 150; i++) {
      z += speed / 60;
      rig.update(1 / 60, 0, z, 0, () => 0);
      driver.update(1 / 60, rig, kind);
      if (i < 40) continue;
      const barrel = new THREE.Vector3(0, 0, 1).applyQuaternion(driver.gunQ);
      const muzzle = driver.muzzle(HOLD[kind], new THREE.Vector3());
      // a handgun follows the pumping arm of a sprint more freely than a long gun hangs
      assert.ok(barrel.y < (kind === 'pistol' ? -0.1 : -0.3), `${kind} at ${speed} m/s: the muzzle points at the ground ahead (${barrel.y.toFixed(2)})`);
      assert.ok(barrel.z > -0.2, `${kind} at ${speed} m/s: never back at their own legs`);
      assert.ok(muzzle.y > 0.02, `${kind} at ${speed} m/s: clear of the pavement (${muzzle.y.toFixed(2)})`);
      if (kind !== 'pistol') assert.ok(muzzle.y < 1, `${kind} at ${speed} m/s: carried low`);
    }
  }
});

test('ready and aimed, both hands are on the weapon; relaxed, the support hand lets go', () => {
  for (const kind of ['pistol', 'smg', 'shotgun', 'rifle']) {
    const { rig, driver } = stand();
    driver.snapWeapon(kind);
    const hands = () => {
      const grip = new THREE.Vector3(...HOLD[kind].grip).applyQuaternion(driver.gunQ).add(driver.gunP);
      const fore = new THREE.Vector3(...(HOLD[kind].fore || HOLD[kind].grip)).applyQuaternion(driver.gunQ).add(driver.gunP);
      // the support hand may take a long fore-end nearer the receiver when the arm is too short for its middle
      const back = fore.clone().addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(driver.gunQ), HOLD[kind].fore ? -0.16 : 0);
      const wrist = joint(driver, sk.bone.hand[0]);
      return [grip.distanceTo(joint(driver, sk.bone.hand[1])), new THREE.Line3(back, fore).closestPointToPoint(wrist, true, new THREE.Vector3()).distanceTo(wrist)];
    };
    rig.gunReady = false;
    for (let i = 0; i < 60; i++) driver.update(1 / 60, rig, kind);
    assert.ok(hands()[0] < 0.16 && hands()[1] > 0.25, `${kind} carried: one hand`);
    rig.gunReady = true;
    for (let i = 0; i < 60; i++) driver.update(1 / 60, rig, kind);
    assert.ok(hands()[0] < 0.16 && hands()[1] < 0.2, `${kind} ready: two hands (${hands().map((d) => d.toFixed(2))})`);
    const barrel = new THREE.Vector3(0, 0, 1).applyQuaternion(driver.gunQ);
    assert.ok(barrel.y < -0.3 && barrel.z > 0.5, `${kind} ready: muzzle low and forward`);
    rig.aim = { x: 0, y: 1.6, z: 30 };
    for (let i = 0; i < 60; i++) driver.update(1 / 60, rig, kind);
    assert.ok(hands()[0] < 0.16 && hands()[1] < 0.2, `${kind} aimed: two hands`);
  }
});

test('recoil comes back to rest, identical at any frame rate, and a burst stays bounded', () => {
  const peak = (hz, shots = 1) => {
    const { rig, driver } = stand();
    driver.snapWeapon('rifle');
    rig.aim = { x: 0, y: 1.6, z: 30 };
    for (let i = 0; i < 90; i++) driver.update(1 / 60, rig, 'rifle');
    // the spring is read directly: the body breathes and sways under the sights, which is not recoil
    let most = 0;
    for (let s = 0; s < shots; s++) {
      driver.kick(1);
      for (let i = 0; i < Math.round(hz * 0.11); i++) { driver.update(1 / hz, rig, 'rifle'); most = Math.max(most, driver.kickS.x); }
    }
    for (let i = 0; i < hz; i++) driver.update(1 / hz, rig, 'rifle');
    assert.ok(Math.abs(driver.kickS.x) < 1e-3 && Math.abs(driver.rock.x) < 1e-3, `${hz} Hz: back on the sights`);
    return most;
  };
  const a = peak(30), b = peak(60), c = peak(144);
  assert.ok(b > 0.8 && b < 1.05, `one shot reaches this weapon's own kick (${b.toFixed(3)})`);
  assert.ok(Math.abs(a - b) < 0.2 && Math.abs(c - b) < 0.06, `frame-rate independent: ${a.toFixed(3)} ${b.toFixed(3)} ${c.toFixed(3)}`);
  assert.ok(peak(60, 30) < 2.4, 'a magazine emptied on automatic does not walk the rifle away');
  // and it shows: the weapon is back in the shoulder at the peak, the muzzle up
  const { rig, driver } = stand();
  driver.snapWeapon('shotgun');
  rig.aim = { x: 0, y: 1.6, z: 30 };
  for (let i = 0; i < 90; i++) driver.update(1 / 60, rig, 'shotgun');
  const rest = driver.muzzle(HOLD.shotgun, new THREE.Vector3());
  driver.kick(1);
  for (let i = 0; i < 4; i++) driver.update(1 / 60, rig, 'shotgun');
  const fired = driver.muzzle(HOLD.shotgun, new THREE.Vector3());
  assert.ok(fired.z < rest.z - 0.02 && fired.y > rest.y + 0.03, 'a shotgun blast drives the weapon back and the muzzle up');
});

test('a body that falls lets go of the weapon and takes it back out once on its feet', () => {
  const { rig, driver } = stand();
  driver.snapWeapon('pistol');
  driver.update(1 / 60, rig, 'pistol');
  assert.equal(driver.armed, true);
  rig.riding = true;
  driver.update(1 / 60, rig, 'pistol');
  assert.equal(driver.gunKind, null);
  assert.equal(driver.gunOut, false);
  rig.riding = false;
  for (let i = 0; i < 90; i++) driver.update(1 / 60, rig, 'pistol');
  assert.equal(driver.armed, true);
});

test('the points the hands are told to hold lie on the shipped weapon models', () => {
  for (const kind of ['pistol', 'smg', 'shotgun', 'rifle']) {
    const b = readFileSync(new URL(`../assets/weapons/${kind}.bin`, import.meta.url));
    const n = b.readUInt32LE(0), header = JSON.parse(b.subarray(4, 4 + n).toString('utf8'));
    const P = new Float32Array(b.buffer.slice(b.byteOffset + ((4 + n + 3) & ~3), b.byteOffset + ((4 + n + 3) & ~3) + header.sections[0]));
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i++) { lo[i % 3] = Math.min(lo[i % 3], P[i]); hi[i % 3] = Math.max(hi[i % 3], P[i]); }
    const hold = HOLD[kind];
    const inside = (p, slack = 0.02) => p.every((v, c) => v >= lo[c] - slack && v <= hi[c] + slack);
    for (const name of ['grip', 'fore', 'butt', 'muzzle', 'port', 'magazine', 'stow']) if (hold[name]) assert.ok(inside(hold[name]), `${kind}.${name} ${hold[name]} is on the model (${lo.map((v) => v.toFixed(2))} .. ${hi.map((v) => v.toFixed(2))})`);
    assert.ok(Math.abs(hold.muzzle[2] - hi[2]) < 0.012, `${kind}: the muzzle point is the end of the barrel`);
    if (hold.butt) assert.ok(Math.abs(hold.butt[2] - lo[2]) < 0.012, `${kind}: the butt point is the end of the stock`);
    assert.ok(hold.grip[2] < hold.muzzle[2] - 0.1 && hold.grip[1] < hold.muzzle[1], `${kind}: the grip is behind and below the bore`);
    assert.ok(hold.sight > hold.muzzle[1] && hold.sight <= hi[1] + 0.01, `${kind}: the sights stand over the bore`);
    assert.ok(Math.abs(hold.grip[0]) < 1e-9 && Math.abs(hold.muzzle[0]) < 1e-9, `${kind}: held in its mid-plane`);
    assert.ok(hold.port[0] <= 0, `${kind}: brass leaves by the right or the top`);
  }
});

test('a jump keeps the weapon in the hand that holds it: nothing is put away and drawn again on landing', () => {
  for (const kind of ['pistol', 'rifle']) {
    const { rig, driver } = stand();
    driver.snapWeapon(kind);
    for (let i = 0; i < 30; i++) driver.update(1 / 60, rig, kind);
    for (let i = 0; i < 30; i++) {
      rig.air = 0.6; // off the ground: the body is posed by the rig
      driver.update(1 / 60, rig, kind);
      assert.equal(driver.gunKind, kind);
      assert.equal(driver.armed, true);
      assert.equal(driver.gunOut, true);
      const grip = new THREE.Vector3(...HOLD[kind].grip).applyQuaternion(driver.gunQ).add(driver.gunP);
      assert.ok(grip.distanceTo(joint(driver, sk.bone.hand[1])) < 0.16, `${kind}: in the right hand in the air`);
    }
    rig.air = 0;
    driver.update(1 / 60, rig, kind);
    assert.equal(driver.armed, true, `${kind}: still in hand on landing`);
  }
});
