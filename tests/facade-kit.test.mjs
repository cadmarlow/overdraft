import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import * as types from '../js/building-types.js';
import { loadModule } from './helpers/module.cjs';
const { dressingsOf } = loadModule(readFileSync(new URL('../js/facade-kit.js', import.meta.url), 'utf8'), {
  imports: { 'three/webgpu': THREE, 'three/tsl': {}, './tsl-materials.js': {}, './building-types.js': types }
});

test('window surrounds and mouldings track the surveyed wall on either street axis', () => {
  for (const [nx, nz] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
    const wall = { ax: -nz * 6, az: nx * 6, bx: nz * 6, bz: -nx * 6, nx, nz, width: 12, bottom: 0.22, top: 30 };
    const record = { cx: 0, cz: 0, height: 30, kitWalls: [wall], style: { type: 'prewar', trim: 0xb4a48c,
      corniceColour: 0xb4a48c, window: types.WINDOW.oneOverOne, flags: 0, floor: 3.5, bay: 3, ratioX: 0.5, ratioY: 0.6, baseFloors: 2, belt: 3 } };
    const pieces = dressingsOf(record).stone;
    const matrices = pieces.filter((_, i) => i % 2 === 0);
    assert.ok(matrices.length > types.windowsOf(record).length * 2, 'window sides and lintels give the near wall real relief');
    for (const m of matrices) {
      assert.ok(m.every(Number.isFinite));
      assert.ok(m[12] * nx + m[14] * nz > 0, 'stone projects out of its own wall, regardless of its axis');
      assert.ok(m[13] > wall.bottom && m[13] < wall.top);
    }
    const courses = matrices.filter(m => Math.hypot(m[0], m[2]) > 11.9);
    assert.equal(courses.length, 8, 'base, first-storey band and both upper belt courses have two moulding lips');
    assert.ok(courses.some(m => Math.abs(m[13] - (5 * 3.5 - 0.12)) < 1e-5));
  }
});
