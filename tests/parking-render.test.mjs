import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import { loadModule } from './helpers/module.cjs';

function fixture() {
  const geometry = new THREE.BoxGeometry(2, 1.4, 4);
  geometry.setAttribute('flag', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
  const plan = { count: 3, x: new Float32Array([5, 120, 280]), z: new Float32Array(3), yaw: new Float32Array(3),
    kind: new Uint8Array(3), seed: new Float32Array([0, 0.5, 0.9]) };
  const material = new THREE.MeshBasicMaterial(), spec = { halfW: 1, zFront: 2, zRear: -2, height: 1.4 };
  const { createParking } = loadModule(readFileSync(new URL('../js/parking.js', import.meta.url), 'utf8'), {
    imports: {
      'three/webgpu': THREE,
      './car-assets.js': { carModels: { sedan: { far: geometry } }, carSpecs: { sedan: spec }, withWheels: () => geometry, trafficMaterial: () => material, LAMPS_OFF: 256 },
      './tsl-materials.js': { createContactShadowMaterial: () => material },
      './traffic.js': { FLEET_STYLES: { sedan: [{ col: new THREE.Color(0xff0000), style: 1 }, { col: new THREE.Color(0x0033ff), style: 2 }] } },
      './city-config.js': { blockAt: () => false, districtAt: () => 'midtown' },
      './parking-plan.js': { KINDS: ['sedan'], planSlots: () => plan, occupied: () => true }
    }, globals: { performance, console: { info() {} } }
  });
  const scene = new THREE.Scene(), parking = createParking(scene, { edges: [] });
  const colliders = new Set();
  parking.attach({ addCollider: c => colliders.add(c), removeCollider: c => colliders.delete(c) });
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 2, 0);
  const update = () => { for (let i = 0; i < 3; i++) parking.update(camera, 12, 0, 0.016); };
  update();
  return { scene, parking, camera, colliders, update };
}

test('parking picks detail per car inside one cell and keeps pools stable through travel', () => {
  const { parking, camera, colliders, update } = fixture();
  const pool = parking.group.children.slice();
  assert.equal(parking.stats().near, 1);
  assert.equal(parking.stats().far, 1, 'the car 120 m away must not inherit the close car’s detailed mesh');
  assert.equal(parking.stats().drawn, 2, 'the car beyond 230 m is not submitted');
  assert.equal(colliders.size, 3, 'render distance does not delete nearby collision data');
  camera.position.set(125, 2, 0); update();
  assert.equal(parking.stats().near, 1);
  assert.equal(parking.stats().far, 2);
  const close = pool.find(m => m.name.endsWith('_near'));
  assert.equal(close.instanceMatrix.array[12], 120);
  assert.equal(close.geometry.attributes.carState.array[3], 258, 'paint and style travel with their car after sorting');
  assert.deepEqual(parking.group.children, pool, 'driving creates no render objects, geometry or materials');
  camera.position.set(125, 300, 0); update();
  assert.equal(parking.stats().drawn, 0, 'altitude participates in detail and distance decisions');
});

test('taking a parked car removes its drawing and collider, including after a detail change', () => {
  const { parking, camera, colliders, update } = fixture();
  camera.position.x = 125; update();
  const car = parking.release(1);
  assert.equal(car.x, 120);
  assert.equal(parking.release(1), null, 'a slot cannot be taken twice');
  const close = parking.group.children.find(m => m.name.endsWith('_near'));
  assert.equal(close.instanceMatrix.array[0], 0, 'the previous instance vanishes immediately');
  assert.equal(colliders.size, 2);
  update();
  assert.equal(parking.stats().near, 0);
  assert.equal(parking.stats().drawn, 2);
  camera.position.x = 0; update();
  assert.equal(parking.stats().drawn, 1, 'driving back cannot respawn a taken car in a still-loaded cell');
  parking.ban(5, 0, 2); update();
  assert.equal(parking.stats().drawn, 0);
  assert.equal(colliders.size, 1);
});
