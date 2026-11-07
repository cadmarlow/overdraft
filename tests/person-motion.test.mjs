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
const { BodyDriver, HOLD } = load('person-motion.js', { 'three/webgpu': THREE, './mocap.js': capture, './human-skeleton.js': human, './person-body.js': bodies });
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
    rig.combatReady = true;
    for (let i = 0; i < 60; i++) driver.update(1 / 60, rig, kind);
    const barrel = new THREE.Vector3(0, 0, 1).applyQuaternion(driver.gunQ);
    const target = new THREE.Vector3(rig.aim.x, rig.aim.y, rig.aim.z).sub(driver.gunP).normalize();
    assert.ok(barrel.dot(target) > 0.999, `${kind}: barrel points at sight`);
    const muzzle = driver.muzzle(HOLD[kind], new THREE.Vector3());
    const palm = new THREE.Vector3(...HOLD[kind].grip).applyQuaternion(driver.gunQ).add(driver.gunP);
    assert.ok(muzzle.clone().sub(palm).dot(barrel) > 0.15, `${kind}: muzzle in front of grip`);
    assert.ok(driver.body.wp.every(Number.isFinite));
    assert.ok(muzzle.y > 1.2 && muzzle.y < 1.9, `${kind}: shouldered at human height`);
  }
});

test('reload takes the support hand to the belt and returns it, without displacing the shooting hand from the weapon', () => {
  const rig = new PersonRig(), driver = new BodyDriver(sk);
  rig.reset(0, 0, 0, () => 0);
  rig.aim = { x: 0, y: 1.5, z: 30 }; rig.combatReady = true;
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
  rig.aim = { x: -0.9 * shoulder, y: 0.22, z: 16, shoulder }; rig.combatReady = true;
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
  const camera = new THREE.Vector3(-0.9 * shoulder, 0.22 + 1.48 + Math.sin(0.09) * 1.75, -Math.cos(0.09) * 1.75);
  const muzzle = driver.muzzle(HOLD[kind], new THREE.Vector3());
  const ray = new THREE.Raycaster(camera, muzzle.clone().sub(camera).normalize(), 0, camera.distanceTo(muzzle) - 0.01);
  assert.equal(ray.intersectObject(jacket).length, 0, `${kind}, shoulder ${shoulder}: the character must not occlude the firearm in gameplay framing`);
  geometry.dispose(); jacket.material.dispose();
  }
});
