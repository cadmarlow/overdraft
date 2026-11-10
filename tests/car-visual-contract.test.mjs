import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTune } from '../js/car-physics.js';

const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));
const baseline = read('./fixtures/car-handling-capital-gains.json');
const models = read('../assets/cars/models.json');

test('visual replacement keeps the fifteen established physical rigs and handling tunes', () => {
  for (const [id, reference] of Object.entries(baseline)) {
    const s = models[id].spec;
    assert.deepEqual(s, reference.spec, `${id}: visual assets cannot silently move contacts or collision dimensions`);
    const tune = makeTune(id, {
      halfW: s.halfW, halfL: Math.max(s.zFront, -s.zRear), height: s.height, sill: s.sill,
      wheelX: (s.wheelX + s.wheelXr) / 2, wheelZf: s.wheelZf, wheelZr: s.wheelZr, wheelRadius: s.wheelRadius
    });
    assert.deepEqual(tune, reference.tune, `${id}: visual update must preserve established driving behaviour`);
  }
});

test('optional source parts and normal atlases obey the shared vertex and index layout', () => {
  for (const [id, m] of Object.entries(models)) {
    const file = new URL(`../assets/cars/${id}.bin`, import.meta.url);
    const bytes = fs.readFileSync(file), buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const n = m.vertices, indexAt = n * (m.normalFormat === 'snorm16' ? 25 : 21) + (4 - n % 4) % 4;
    const indices = new Uint32Array(buffer, indexAt, m.indices);
    // 8 to 11 name the four wheels of a street car once body and wheels are one mesh (FLAG.WHEEL in car-assets.js)
    assert.ok(new Uint8Array(buffer, n * (m.normalFormat === 'snorm16' ? 24 : 20), n).every((flag) => flag < 8), `${id}: no stored vertex takes a wheel's flag`);
    if (m.normalTexture) {
      assert.match(m.normalTexture, /^[a-z]+_n\.webp$/);
      const normals = fs.readFileSync(new URL(`../assets/cars/${m.normalTexture}`, import.meta.url));
      assert.equal(normals.toString('ascii', 0, 4), 'RIFF', `${id}: normal map must be a real image`);
    }
    const ranges = [...(m.calipers || []), ...(m.steering ? [m.steering.range] : []),
      ...(m.trafficShell ? [m.trafficShell] : []), ...(m.trafficWheels || []), ...(m.midShell ? [m.midShell] : []), ...(m.midWheels || [])];
    for (const [start, count] of ranges) {
      assert.ok(Number.isInteger(start) && Number.isInteger(count) && start >= 0 && count > 0 && count % 3 === 0);
      assert.ok(start + count <= m.indices, `${id}: valid source part range`);
      for (const i of indices.subarray(start, start + count)) assert.ok(i < n, `${id}: valid source part vertex`);
    }
    if (m.steering) {
      assert.equal(m.steering.position.length, 3);
      assert.ok(m.steering.position.every(Number.isFinite));
    }
  }
});

// tools/cars/build-lods.mjs
test('every car ships the levels the street draws, each within what a browser can afford', () => {
  const triangles = ([, count]) => count / 3;
  for (const [id, m] of Object.entries(models)) {
    assert.ok(m.midShell && m.midWheels?.length === 4 && m.trafficShell && m.trafficWheels?.length === 4, `${id}: mid and traffic levels`);
    const near = (m.ranges[1] + m.ranges[3]) / 3 + [0, 1, 2, 3].reduce((n, w) => n + m.ranges[7 + w * 2] / 3, 0);
    const mid = triangles(m.midShell) + m.midWheels.reduce((n, w) => n + triangles(w), 0);
    const traffic = triangles(m.trafficShell) + m.trafficWheels.reduce((n, w) => n + triangles(w), 0);
    assert.deepEqual(m.lod, { near, mid, traffic, far: m.ranges[5] / 3 }, `${id}: the manifest states what the file holds`);
    assert.ok(near <= 110000, `${id}: the driven car stays under 110 000 triangles (${near})`);
    assert.ok(mid <= 40000, `${id}: a car a few steps away stays under 40 000 (${mid})`);
    assert.ok(traffic <= 21000 && traffic <= mid, `${id}: a car down the street stays under 21 000 (${traffic})`);
    for (const w of m.midWheels) assert.ok(triangles(w) <= 3600, `${id}: a wheel of the street is not heavier than the bodywork deserves (${triangles(w)})`);
  }
});

test('wheels are round and sit square on their axles', () => {
  // A wheel stored steered, cambered or stretched wobbles at every turn once the game spins it about the car's axle
  // (two sources came steered, one cambered, and one as an egg 49 cm by 26).
  for (const [id, m] of Object.entries(models)) {
    const bytes = fs.readFileSync(new URL(`../assets/cars/${id}.bin`, import.meta.url));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const n = m.vertices, positions = new Float32Array(buffer, 0, n * 3);
    const indices = new Uint32Array(buffer, n * (m.normalFormat === 'snorm16' ? 25 : 21) + (4 - n % 4) % 4, m.indices);
    for (let w = 0; w < 4; w++) {
      const own = [...new Set(indices.subarray(m.ranges[6 + w * 2], m.ranges[6 + w * 2] + m.ranges[7 + w * 2]))];
      const width = (dx, dy, dz) => {
        let lo = Infinity, hi = -Infinity;
        for (const i of own) { const v = positions[i * 3] * dx + positions[i * 3 + 1] * dy + positions[i * 3 + 2] * dz; if (v < lo) lo = v; if (v > hi) hi = v; }
        return hi - lo;
      };
      // round: the same across in every direction of its plane
      let least = Infinity, most = 0;
      for (let k = 0; k < 12; k++) { const d = width(0, Math.sin(k * Math.PI / 12), Math.cos(k * Math.PI / 12)); least = Math.min(least, d); most = Math.max(most, d); }
      assert.ok(most / least < 1.06, `${id} wheel ${w}: ${(least / 2).toFixed(3)} to ${(most / 2).toFixed(3)} m of radius`);
      assert.ok(Math.abs(most / 2 - m.spec.wheels[w][3]) < 0.03, `${id} wheel ${w}: the radius the car rolls on`);
      // square: nowhere narrower than straight across the car
      const straight = width(1, 0, 0), tilt = Math.sin(4 * Math.PI / 180), level = Math.cos(4 * Math.PI / 180);
      for (const [dy, dz] of [[tilt, 0], [-tilt, 0], [0, tilt], [0, -tilt]]) {
        assert.ok(width(level, dy, dz) > straight * 0.985, `${id} wheel ${w}: its axle lies across the car`);
      }
    }
  }
});
