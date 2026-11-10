import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import * as TSL from '../vendor/three/build/three.tsl.js';
const require = createRequire(import.meta.url);
const { loadModule } = require('./helpers/module.cjs');
const { brakeLayout, brakeTemperature, buildCarDetails, poseCarDetails } = loadModule(
  fs.readFileSync(new URL('../js/car-details.js', import.meta.url), 'utf8'),
  { imports: { 'three/webgpu': THREE, 'three/tsl': TSL } }
);
const manifest = JSON.parse(fs.readFileSync(new URL('../assets/cars/models.json', import.meta.url)));
function modelOf(id) {
  const info = manifest[id], bytes = fs.readFileSync(new URL(`../assets/cars/${id}.bin`, import.meta.url));
  const array = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const position = new THREE.BufferAttribute(new Float32Array(array, 0, info.vertices * 3), 3);
  const indices = new Uint32Array(array, info.vertices * (info.normalFormat === 'snorm16' ? 25 : 21) + (4 - info.vertices % 4) % 4, info.indices);
  const wheels = [0, 1, 2, 3].map((i) => {
    const g = new THREE.BufferGeometry();g.setAttribute('position', position);
    g.setIndex(new THREE.BufferAttribute(indices.subarray(info.ranges[6 + i * 2], info.ranges[6 + i * 2] + info.ranges[7 + i * 2]), 1));return g;
  });
  return { id, spec: info.spec, wheels };
}
function rig(model) {
  const wheels = model.spec.wheels.map(([x, y, z], i) => {
    const steerPivot = new THREE.Group();steerPivot.position.set(x, y, z);
    return { steerPivot, isFront: i < 2, tire: { rotation: { x: 0 } } };
  });
  return buildCarDetails(model, new THREE.Group(), wheels);
}

test('brakes fit behind every real wheel in the fifteen-model fleet', () => {
  for (const id of Object.keys(manifest)) {
    const model = modelOf(id);
    for (let i = 0; i < 4; i++) {
      const L = brakeLayout(model, i);
      assert.ok(L.radius > 0.25 && L.radius < 0.5, id);
      assert.ok(L.rotor * L.radius < L.radius * 0.7, `${id} disc stays inside the tyre`);
      assert.ok(L.offset > 0 && L.offset < 0.13, `${id} brake behind rim face`);
      // and behind the spokes: the outer friction face stays inside the faces the wheel shows over the disc
      const p = model.wheels[i].attributes.position, reach = L.rotor * L.radius, fronts = new Map();
      for (const v of model.wheels[i].index.array) {
        const r = Math.hypot(p.getY(v), p.getZ(v));
        if (r > reach || r < reach * 0.45) continue;
        const cell = Math.floor(p.getY(v) / reach * 10) * 100 + Math.floor(p.getZ(v) / reach * 10);
        fronts.set(cell, Math.max(fronts.get(cell) ?? -Infinity, p.getX(v) * L.side));
      }
      const depths = [...fronts.values()].sort((a, b) => a - b);
      if (depths.length > 40) assert.ok(L.offset + 0.039 * L.radius <= Math.max(0.018 + 0.039 * L.radius, depths[Math.floor(depths.length * 0.9)]), `${id} wheel ${i}: the disc does not stand in front of the spokes`);
      assert.equal(L.side, i % 2 ? -1 : 1);
    }
    const details = rig(model);
    assert.equal(details.mesh.count, 4);
    assert.ok(details.mesh.geometry.attributes.position.count / 3 < 1000, `${id} bounded geometry cost`);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      details.mesh.getMatrixAt(i, m);m.decompose(p, q, scale);
      assert.ok(Math.abs(p.y - model.spec.wheels[i][1]) < 1e-6, `${id} brake follows its wheel centre`);
      assert.ok(Math.abs(scale.x - model.spec.wheels[i][3]) < 1e-6, `${id} brake fits wheel radius`);
    }
  }
});

test('calipers steer and travel with the suspension without spinning with the tyre', () => {
  const details = rig(modelOf('sport'));
  details.wheels[0].steerPivot.position.y += 0.1;
  details.wheels[0].steerPivot.rotation.y = 0.35;
  details.wheels[1].steerPivot.rotation.y = 0.29;
  const body = { steer: 0.32, speed: 12, brake: 0 };
  poseCarDetails(details, body, 1 / 60);
  const first = Array.from(details.mesh.instanceMatrix.array);
  details.wheels[0].tire.rotation.x = 4;
  poseCarDetails(details, body, 1 / 60);
  assert.deepEqual(Array.from(details.mesh.instanceMatrix.array), first, 'tyre spin cannot rotate a caliper');
  assert.ok(Math.abs(first[13] - details.wheels[0].steerPivot.position.y) < 1e-6);
  assert.ok(Math.abs(first[2]) > 0.03, 'front brake assembly follows steering');
});

test('temperatures belong to each car, warm under braking and cool in airflow', () => {
  const one = rig(modelOf('super')), two = rig(modelOf('super'));
  assert.equal(one.mesh.material, two.mesh.material, 'shared GPU pipeline');
  assert.equal(one.mesh.geometry.attributes.position, two.mesh.geometry.attributes.position, 'shared static geometry');
  assert.notEqual(one.heat, two.heat, 'per-car thermal state');
  for (let i = 0; i < 600; i++) poseCarDetails(one, { speed: 50, brake: 1 }, 1 / 60);
  assert.ok(one.temperatures[0] > 550, 'hard repeated braking can heat the front discs visibly');
  assert.ok(one.temperatures[0] > one.temperatures[2], 'front brake bias');
  assert.ok(one.heat.array[0] > 0 && two.heat.array[0] === 0, 'heat is not shared between cars');
  const hot = one.temperatures[0];
  for (let i = 0; i < 600; i++) poseCarDetails(one, { speed: 50, brake: 0 }, 1 / 60);
  assert.ok(one.temperatures[0] < hot - 100);
  assert.equal(brakeTemperature(20, 0, 1, 0.1), 20, 'holding a stationary car never heats the brakes');
  assert.ok(brakeTemperature(900, 100, 1, 100) <= 900, 'long paused frames remain bounded');
});
