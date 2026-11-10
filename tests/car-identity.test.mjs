import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import * as TSL from '../vendor/three/build/three.tsl.js';
const require = createRequire(import.meta.url), { loadModule } = require('./helpers/module.cjs');
const sourceURL = new URL('../js/car-assets.js', import.meta.url);
const { identityPlacement, bodySurfaceAt, createSourcePartMaterial } = loadModule(fs.readFileSync(sourceURL, 'utf8').replaceAll('import.meta.url', JSON.stringify(sourceURL.href)), {
  imports: { 'three/webgpu': { ...THREE, ImageBitmapLoader: class { setOptions() { return this; } } }, 'three/tsl': TSL, './tsl-materials.js': { cityUniforms: {} }, './urban-light.js': {}, './car-cabin.js': {}, './car-cabin-clearance.js': {} }, globals: { URL }
});
const manifest = JSON.parse(fs.readFileSync(new URL('../assets/cars/models.json', import.meta.url)));

test('source steering and calipers reuse a material without body-space damage or panel projections', () => {
  const model = { id: 'source-mechanism-test', map: new THREE.Texture(), surface: new THREE.Texture(), normalTexture: new THREE.Texture() };
  const material = createSourcePartMaterial(model);
  assert.equal(createSourcePartMaterial(model), material, 'garage reuse must not allocate or compile another material');
  assert.equal(material.userData.shared, true);
  assert.equal(material.positionNode, null, 'local mechanisms must not use the body dent deformation');
  assert.equal(material.userData.dents, undefined);
  assert.equal(material.colorNode.node.value, model.map, 'source albedo is used directly without a body-space registration decal');
  assert.ok(material.normalNode, 'source surface relief survives');
});
function modelOf(id) {
  const info = manifest[id], bytes = fs.readFileSync(new URL(`../assets/cars/${id}.bin`, import.meta.url));
  const array = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), n = info.vertices;
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.BufferAttribute(new Float32Array(array, 0, n * 3), 3));
  const NormalArray = info.normalFormat === 'snorm16' ? Int16Array : Int8Array;
  body.setAttribute('normal', new THREE.BufferAttribute(new NormalArray(array, n * 12, n * 4), 4, true));
  const indices = new Uint32Array(array, n * (info.normalFormat === 'snorm16' ? 25 : 21) + (4 - n % 4) % 4, info.indices);
  body.setIndex(new THREE.BufferAttribute(indices.subarray(info.ranges[0], info.ranges[1]), 1));
  return { id, spec: info.spec, body };
}

test('original plates project onto supported exterior panels across the real fleet', () => {
  for (const id of Object.keys(manifest)) {
    const model = modelOf(id), placement = identityPlacement(model);
    assert.ok(placement.rear, `${id} has a rear registration plate`);
    for (const [name, p] of Object.entries(placement)) {
      if (!p) continue;
      assert.ok(Number.isFinite(p.y) && Number.isFinite(p.z), `${id} ${name}`);
      const centre = bodySurfaceAt(model, 0, p.y, p.side);
      assert.ok(centre && Math.abs(centre.z - p.z) < 0.001, `${id} ${name} sits on actual body geometry`);
      for (const x of [-p.width / 2, p.width / 2]) for (const dy of [-p.height / 2, p.height / 2]) {
        const corner = bodySurfaceAt(model, x, p.y + dy, p.side);
        assert.ok(corner && Math.abs(corner.z - p.z) <= 0.13, `${id} ${name} does not bridge empty bodywork`);
      }
      if (name === 'badge') assert.ok(p.y - p.height / 2 >= placement.rear.y + placement.rear.height / 2 + 0.03, `${id} badge does not cover its plate`);
    }
  }
});


test('the sports registration stays inside the new body’s continuous lower recess', () => {
  const model = modelOf('sport'), p = identityPlacement(model).rear;
  assert.ok(p.y > 0.45 && p.y < 0.55 && p.width < 0.4);
  for (let row = 0; row <= 8; row++) for (let col = 0; col <= 6; col++) {
    const x = (col / 6 - 0.5) * p.width, y = p.y + (row / 8 - 0.5) * p.height;
    const hit = bodySurfaceAt(model, x, y, -1);
    assert.ok(hit, 'registration never crosses an open bumper step');
    assert.ok(hit.facing > 0.7, 'registration never crosses an inward-facing chamfer');
    assert.ok(Math.abs(hit.z - p.z) < 0.04, 'registration remains on the same shallow panel');
  }
});

test('the wagon registration covers its real tailgate mount without duplicating onto the stepped bumper', () => {
  const model = modelOf('wagon'), plate = identityPlacement(model).rear;
  assert.ok(plate.y - plate.height / 2 > 0.63, 'the entire print stays above the bumper seam');
  assert.ok(plate.y - plate.height / 2 < 0.698 && plate.y + plate.height / 2 > 0.770, 'the original blank plate is covered');
  for (let row = 0; row <= 8; row++) for (let col = 0; col <= 6; col++) {
    const hit = bodySurfaceAt(model, (col / 6 - 0.5) * plate.width, plate.y + (row / 8 - 0.5) * plate.height, -1);
    assert.ok(hit && hit.facing > 0.7 && Math.abs(hit.z - plate.z) < 0.04, 'the print stays on one continuous tailgate panel');
  }
});
