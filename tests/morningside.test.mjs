import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import * as TSL from '../vendor/three/build/three.tsl.js';
import { loadModule } from './helpers/module.cjs';
import { BLOCKS, blockAt } from '../js/city-config.js';
import * as plan from '../js/morningside-plan.js';
import * as groundSurfaces from '../js/ground-surfaces.js';
import * as parkPlan from '../js/park-plan.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const { mergeGeometries } = loadModule(read('vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), { imports: { three: THREE } });
const districtGeometry = loadModule(read('js/district-geometry.js'), {
  imports: { 'three/webgpu': THREE, 'three/addons/utils/BufferGeometryUtils.js': { mergeGeometries } }
});
const material = () => new THREE.MeshStandardNodeMaterial();
const context = { fillRect() {}, strokeRect() {}, fillText() {} };
const { buildCathedralClose, buildMorningsidePark } = loadModule(read('js/morningside-ground.js'), {
  imports: {
    'three/webgpu': THREE,
    'three/tsl': TSL,
    './district-geometry.js': districtGeometry,
    './park-plan.js': parkPlan,
    './tree-assets.js': { trees: { foliage: null } },
    './park-materials.js': { createGroundLawnMaterial: material, createGroundRockMaterial: material },
    './tsl-materials.js': { createDressedStoneMaterial: material, createParkPavingMaterial: material, createParkWallMaterial: material },
    './ground-surfaces.js': groundSurfaces,
    './morningside-plan.js': plan
  },
  globals: { document: { createElement: () => ({ getContext: () => context }) } }
});

function fixture() {
  const scene = new THREE.Scene(), colliders = [], trees = [];
  const ground = groundSurfaces.createGroundSurfaces();
  return { scene, ground, colliders, trees, addTree: site => trees.push(site), addBench() {}, addLamp() {} };
}
function heightAt(ground, { x, z }) {
  const hit = {};
  assert.ok(ground.sample(x, z, hit), `ground at ${x}, ${z}`);
  return hit.y;
}
function includes({ polygon }, point) {
  let inside = false;
  const pts = polygon.outer;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j], b = pts[i];
    if ((a.z > point.z) !== (b.z > point.z) &&
      point.x < a.x + (b.x - a.x) * (point.z - a.z) / (b.z - a.z)) inside = !inside;
  }
  return inside;
}

test('the garden paths meet their public entrances without cutting across the fence or fountain', () => {
  const f = fixture();
  const visits = buildCathedralClose(f.scene, f);
  assert.equal(visits.length, 4);
  assert.ok(f.trees.length >= 35);
  for (const { gate, route, seat } of visits) {
    assert.equal(blockAt(gate.x, gate.z), plan.closeBlock);
    const walk = [gate, ...route, seat];
    for (let i = 1; i < walk.length; i++) {
      const a = walk[i - 1], b = walk[i];
      const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.4);
      for (let j = 1; j < n; j++) {
        const t = j / n, p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        assert.ok(!f.colliders.some(c => c.maxY > 0.9 && includes(c, p)), `route crosses an obstacle at ${p.x}, ${p.z}`);
      }
    }
  }
  assert.equal(f.colliders.some(c => includes(c, plan.closePoint(14, 0))), false);
  assert.equal(f.colliders.some(c => includes(c, plan.closePoint(14, 10))), true);
  assert.ok(heightAt(f.ground, plan.closePoint(29, -83)) - heightAt(f.ground, plan.closePoint(22, -83)) > 1.3);
});

test('the park ridge and flight of steps are physical terrain', () => {
  const f = fixture(), block = BLOCKS.find(b => b.parkName === plan.MORNINGSIDE_PARK);
  buildMorningsidePark(f.scene, block, f);
  const z = block.maxZ - 137;
  const hit = [];
  for (let i = 0, j = block.poly.length - 1; i < block.poly.length; j = i++) {
    const a = block.poly[j], b = block.poly[i];
    if ((a.z > z) !== (b.z > z)) hit.push(a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z));
  }
  const west = Math.min(...hit) + 4.4, east = Math.max(...hit) - 4.4;
  const yAt = u => heightAt(f.ground, { x: west + (east - west) * u, z });
  const yHigh = yAt(0.23), yLow = yAt(0.55);
  assert.ok(yHigh - yLow > 5);
  const h = Array.from({ length: 230 }, (_, i) => yAt(0.225 + 0.322 * i / 229));
  for (let i = 1; i < h.length; i++) assert.ok(h[i] <= h[i - 1] + 0.03 && h[i - 1] - h[i] < 0.23, `tread ${i}`);
  assert.ok(f.trees.some(t => t.y > 8), 'the canopy follows the raised ground');
  assert.ok(f.colliders.every(c => Number.isFinite(c.maxY) && c.minY <= c.maxY));
});

test('the city survey supplies exactly one footprint for the authored cathedral', async () => {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async url => new Response(readFileSync(url));
  try {
    const { REAL_BUILDINGS } = await import('../js/building-geodata.js');
    const matches = REAL_BUILDINGS.filter(plan.isCathedral);
    assert.equal(matches.length, 1);
    const [cathedral] = matches;
    assert.equal(blockAt(cathedral.cx, cathedral.cz), plan.closeBlock);
    assert.equal(cathedral.height, 51);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});
