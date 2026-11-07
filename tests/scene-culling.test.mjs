import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import { loadModule } from './helpers/module.cjs';

const source = readFileSync(new URL('../js/scene-culling.js', import.meta.url), 'utf8');
const { setupSceneCulling, updateSceneCulling } = loadModule(source, { imports: { 'three/webgpu': THREE } });

test('small pre-partitioned instance batches obey their explicit reach and return after travel', () => {
  const scene = new THREE.Scene(), root = new THREE.Group();
  root.position.set(400, 0, -200);
  scene.add(root);
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 3);
  for (let i = 0; i < 3; i++) mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 4, 0, 0));
  mesh.userData.cullDistance = 170;
  root.add(mesh);
  const original = mesh.instanceMatrix.array.slice();
  setupSceneCulling(scene, [root], null, { cull: 0.72 });
  scene.updateMatrixWorld(true);
  const drawn = () => { let visible = true; mesh.traverseAncestors(o => { visible &&= o.visible; }); return visible && mesh.visible; };
  updateSceneCulling(new THREE.Vector3(404, 2, -200));
  assert.equal(drawn(), true);
  updateSceneCulling(new THREE.Vector3(900, 2, -200));
  assert.equal(drawn(), false, 'a batch of fewer than 64 props must not survive across the city');
  updateSceneCulling(new THREE.Vector3(510, 2, -200));
  assert.equal(drawn(), true, 'quality-scaled reach still includes the near props');
  assert.deepEqual(mesh.instanceMatrix.array, original, 'interactive prop indices and transforms stay intact');
  assert.deepEqual(mesh.getWorldPosition(new THREE.Vector3()).toArray(), [400, 0, -200]);
});

test('the batch sphere protects its nearest instance at the distance boundary', () => {
  const scene = new THREE.Scene(), root = new THREE.Group();
  scene.add(root);
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 2);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 0));
  mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(200, 0, 0));
  mesh.userData.cullDistance = 170;
  root.add(mesh);
  setupSceneCulling(scene, [root]);
  updateSceneCulling(new THREE.Vector3(350, 0, 0));
  assert.equal(mesh.visible, true, 'the closest prop is only 150 metres away');
  updateSceneCulling(new THREE.Vector3(390, 0, 0));
  assert.equal(mesh.parent.visible && mesh.visible, false);
});

test('an explicit reach still partitions an island-wide batch before distance culling', () => {
  const scene = new THREE.Scene(), root = new THREE.Group();
  scene.add(root);
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 16);
  for (let i = 0; i < 16; i++) mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 700, 0, 0));
  mesh.userData.cullDistance = 300;
  root.add(mesh);
  setupSceneCulling(scene, [root]);
  updateSceneCulling(new THREE.Vector3(0, 2, 0));
  let drawn = 0;
  scene.traverseVisible(o => { if (o.isInstancedMesh) drawn += o.count; });
  assert.equal(drawn, 1, 'the global sphere must not keep the other fifteen props alive');
  updateSceneCulling(new THREE.Vector3(10500, 2, 0));
  drawn = 0;
  scene.traverseVisible(o => { if (o.isInstancedMesh) drawn += o.count; });
  assert.equal(drawn, 1, 'the other end of the island remains reachable');
});
