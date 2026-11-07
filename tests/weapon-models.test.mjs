import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import { loadModule } from './helpers/module.cjs';

const geometryUtils = loadModule(readFileSync(new URL('../vendor/three/examples/jsm/utils/BufferGeometryUtils.js', import.meta.url), 'utf8'), { imports: { three: THREE } });
const models = loadModule(readFileSync(new URL('../js/weapon-models.js', import.meta.url), 'utf8'), {
  imports: { 'three/webgpu': { ...THREE, MeshStandardNodeMaterial: THREE.MeshStandardMaterial }, 'three/addons/utils/BufferGeometryUtils.js': geometryUtils }
});

test('weapon meshes have finite bevels, metre-scale silhouettes and a bounded draw/triangle cost', () => {
  const lengths = { pistol: [0.21, 0.26], smg: [0.56, 0.62], shotgun: [0.84, 0.9], rifle: [0.80, 0.87] };
  for (const [kind, [min, max]] of Object.entries(lengths)) {
    const model = models.createWeaponModel(kind), bounds = new THREE.Box3().setFromObject(model);
    const length = bounds.max.z - bounds.min.z;
    assert.ok(length >= min && length <= max, `${kind}: length ${length}`);
    let draws = 0, triangles = 0;
    model.traverse(o => {
      if (!o.isMesh) return;
      draws++; triangles += o.geometry.attributes.position.count / 3;
      for (const name of ['position', 'normal', 'color']) assert.ok(o.geometry.attributes[name].array.every(Number.isFinite), `${kind} ${name}`);
      assert.ok(o.castShadow && o.receiveShadow);
    });
    assert.ok(draws <= 6, `${kind}: ${draws} draws`);
    assert.ok(triangles < 13000, `${kind}: ${triangles} triangles`);
  }
});

test('weapon switches and new actors reuse GPU geometry and materials but own their animation transforms', () => {
  for (const kind of ['pistol', 'smg', 'shotgun', 'rifle']) {
    const a = models.createWeaponModel(kind), b = models.createWeaponModel(kind);
    assert.equal(a.children[0].geometry, b.children[0].geometry);
    assert.equal(a.children[0].material, b.children[0].material);
    assert.notEqual(a.userData.action, b.userData.action);
    models.animateWeapon(a, kind, kind === 'shotgun' ? 0.26 : 0, -1);
    assert.ok(a.userData.action.position.z < -0.025);
    assert.equal(b.userData.action.position.z, 0);
    models.animateWeapon(a, kind, 2, -1);
    assert.ok(Math.abs(a.userData.action.position.z) < 1e-7);
  }
});

test('reload removes the magazine, seats it before firing and resets on cancellation', () => {
  for (const kind of ['pistol', 'smg', 'rifle']) {
    const model = models.createWeaponModel(kind), magazine = model.userData.magazine;
    models.animateWeapon(model, kind, 10, 0.23);
    assert.ok(magazine.position.y < -0.1 && magazine.visible);
    models.animateWeapon(model, kind, 10, 0.42);
    assert.equal(magazine.visible, false);
    models.animateWeapon(model, kind, 10, 0.85);
    assert.equal(magazine.visible, true);
    assert.equal(Math.abs(magazine.position.y), 0);
    assert.ok(model.userData.action.position.z < -0.02);
    models.animateWeapon(model, kind, 10, -1);
    assert.equal(magazine.visible, true);
    assert.equal(Math.abs(magazine.position.y), 0);
  }
});
