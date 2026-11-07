import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.webgpu.js';

const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

test('offscreen garage bodies are eligible for colour and shadow warmup, then recover their original culling', () => {
  const start = source.indexOf('  const warmupCarMeshes =');
  const end = source.indexOf('  // Props, bodies and cars', start);
  const drawStart = source.indexOf('    if (!warmedUp) {');
  const drawEnd = source.indexOf("    // the Architect's own eye", drawStart);
  assert.ok(start > 0 && end > start && drawStart > end && drawEnd > drawStart);
  const scene = new THREE.Scene();
  scene.matrixWorldAutoUpdate = false;
  const root = new THREE.Group(); root.position.set(20000, -100, 20000);
  const body = new THREE.Mesh(), glass = new THREE.Mesh(), tyre = new THREE.Mesh(), brake = new THREE.Mesh();
  body.castShadow = tyre.castShadow = true;
  brake.frustumCulled = false;
  const pivot = new THREE.Group(); pivot.add(body, glass, tyre, brake); root.add(pivot); scene.add(root);
  const city = new THREE.Mesh(); scene.add(city);
  let draws = 0;
  const context = {
    gameplay: { rides: [{ body: {}, mesh: root }] }, scene, warmedUp: false, markInit() {},
    renderPipeline: { render() {
      draws++;
      for (const object of [body, glass, tyre, brake]) assert.equal(object.frustumCulled, false, 'pooled meshes must reach every warmup pass');
      assert.equal(city.frustumCulled, true, 'the city retains distance and view culling');
      for (const object of [body, glass, tyre]) assert.equal(object.matrixWorld.elements[12], 20000, 'parked transforms are current before compilation');
    } }
  };
  vm.runInNewContext(`${source.slice(start, end)}\n${source.slice(drawStart, drawEnd)}`, context);
  assert.equal(draws, 1);
  for (const object of [body, glass, tyre]) assert.equal(object.frustumCulled, true);
  assert.equal(brake.frustumCulled, false, 'a native nonculled mesh must not have its behavior changed');
  assert.equal(root.position.x, 20000, 'warmup never relocates pooled cars into the playable scene');
});
