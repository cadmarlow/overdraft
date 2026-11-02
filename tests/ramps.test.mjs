import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Only the maths: the module's scene half needs a browser
const source = readFileSync(new URL('../js/ramps.js', import.meta.url), 'utf8').replace(/^import .*$/m, '').replace(/^export .*$/m, 'return { rampRise, ramps };');
const { rampRise, ramps } = new Function('document', source)({});

test('a ramp rises from nothing to its full height along its length, and only there', () => {
  const r = ramps[0], hit = {};
  const at = (d, side = 0) => rampRise(r.x + r.dx * d + r.dz * side, r.z + r.dz * d - r.dx * side, hit);
  assert.equal(at(-0.5), 0);
  assert.ok(at(0.5) < 0.2);
  assert.ok(Math.abs(at(9.9) - 2.18) < 0.02);
  assert.equal(at(10.5), 0);
  assert.equal(at(5, 3.5), 0);
});

test('its normal leans back against the way up it', () => {
  const r = ramps[0], hit = {};
  rampRise(r.x + r.dx * 5, r.z + r.dz * 5, hit);
  assert.ok(hit.ny > 0.9);
  assert.ok(hit.nx * r.dx + hit.nz * r.dz < -0.1);
});
