import test from 'node:test';
import assert from 'node:assert/strict';
import { simplifyCarSurface } from '../tools/cars/import-cars.mjs';
let simplifier;
try { ({ MeshoptSimplifier: simplifier } = await import('../tools/cars/node_modules/meshoptimizer/index.module.js')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

test('traffic simplification preserves adjacent paint and glass atlas tiles across disconnected source faces', {
  skip: !simplifier && 'Offline tools/cars dependencies are not installed'
}, async () => {
  await simplifier.ready;
  const positions = [], attributes = [], indices = [];
  // A dense panel exported with duplicated corners: the shared edge separates two distant atlas tiles.
  for (let x = 0; x < 32; x++) for (let y = 0; y < 16; y++) {
    const base = positions.length / 3, glass = x >= 16;
    for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      positions.push((x + dx) / 16 - 1, (y + dy) / 16, 0);
      attributes.push(0, 0, 1, glass ? 0.85 : 0.1, glass ? 0.85 : 0.1, glass ? 6 : 0);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const result = simplifyCarSurface(simplifier, Uint32Array.from(indices), Float32Array.from(positions), Float32Array.from(attributes), 128, 0.03);
  assert.ok(result.length < indices.length / 4, 'the traffic mesh is substantially lighter');
  assert.ok(result.length >= 12, 'both panel halves survive');
  const observed = new Set();
  for (let i = 0; i < result.length; i += 3) {
    const triangle = Array.from(result.subarray(i, i + 3));
    const flags = triangle.map(v => attributes[v * 6 + 5]);
    assert.ok(flags.every(f => f === flags[0]), 'no triangle interpolates between paint and glass');
    observed.add(flags[0]);
    const uv = triangle.map(v => attributes[v * 6 + 3]);
    assert.ok(Math.max(...uv) - Math.min(...uv) < 0.01, 'no triangle crosses unrelated atlas tiles');
  }
  assert.deepEqual([...observed].sort(), [0, 6]);
});
