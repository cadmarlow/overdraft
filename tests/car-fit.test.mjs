import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCarFit } from '../tools/cars/fit-car.mjs';

const spec = (rear, front, halfW, height, rearZ, frontZ, rearTrack, frontTrack, rearY, frontY) => ({
  zRear: rear, zFront: front, halfW, height,
  wheels: [[frontTrack, frontY, frontZ, frontY], [-frontTrack, frontY, frontZ, frontY],
    [rearTrack, rearY, rearZ, rearY], [-rearTrack, rearY, rearZ, rearY]]
});
const source = spec(-2.1, 2.3, 0.95, 1.48, -1.25, 1.35, 0.76, 0.73, 0.34, 0.32);
const target = spec(-2.45, 2.4, 1.02, 1.64, -1.48, 1.4, 0.79, 0.85, 0.37, 0.36);
const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} differs from ${b}`);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const subtract = (a, b) => a.map((v, i) => v - b[i]);

test('retargeting holds bumpers, all axle centres, roof and body width without changing either spec', () => {
  const oldSource = structuredClone(source), oldTarget = structuredClone(target), fit = createCarFit(source, target);
  for (const [a, b] of [[source.zRear, target.zRear], [source.zFront, target.zFront]]) close(fit.point([0, 0, a])[2], b);
  for (let i = 0; i < 4; i++) fit.point(source.wheels[i].slice(0, 3)).forEach((v, j) => close(v, target.wheels[i][j]));
  for (let i = 0; i <= 40; i++) {
    const z = source.zRear + (source.zFront - source.zRear) * i / 40;
    close(fit.point([source.halfW, source.height, z])[0], target.halfW);
    close(fit.point([-source.halfW, source.height, z])[0], -target.halfW);
    close(fit.point([0, source.height, z])[1], target.height);
    close(fit.point([0, 0, z])[1], 0);
  }
  assert.deepEqual(source, oldSource); assert.deepEqual(target, oldTarget);
});

test('nonlinear fitting remains ordered and continuous across axles and track anchors', () => {
  const fit = createCarFit(source, target);
  for (let axis = 0; axis < 3; axis++) {
    const low = [-1.2, -0.1, -2.5][axis], high = [1.2, 1.8, 2.6][axis];
    let previous = -Infinity;
    for (let i = 0; i <= 1000; i++) {
      const p = [0.82, 0.6, 0.1]; p[axis] = low + (high - low) * i / 1000;
      const value = fit.point(p)[axis]; assert.ok(value > previous, `axis ${axis} folds at ${i}`); previous = value;
    }
  }
  for (const z of [source.zRear, source.wheels[2][2], source.wheels[0][2], source.zFront]) {
    const h = 1e-5, p = fit.point([0.8, 0.7, z]);
    const left = subtract(p, fit.point([0.8, 0.7, z - h])).map((v) => v / h);
    const right = subtract(fit.point([0.8, 0.7, z + h]), p).map((v) => v / h);
    left.forEach((v, i) => close(v, right[i], 2e-4));
  }
});

test('fitted surface normals stay perpendicular to independent transformed tangents, including changing tracks', () => {
  const fit = createCarFit(source, target), u = [0.4, 0.7, 0.2], v = [-0.6, 0.1, 0.8], n = cross(u, v);
  for (const z of [-2, -1.25, -0.5, 0, 0.7, 1.35, 2.2]) for (const x of [-0.9, -0.4, 0.4, 0.9]) {
    const p = [x, 0.83, z], normal = fit.normal(n, p), h = 1e-5;
    for (const t of [u, v]) {
      const a = fit.point(p.map((q, i) => q - h * t[i])), b = fit.point(p.map((q, i) => q + h * t[i]));
      const tangent = subtract(b, a).map((q) => q / (2 * h));
      close(dot(normal, tangent), 0, 3e-5);
    }
    close(Math.hypot(...normal), 1);
  }
});

test('wheel fitting preserves the contact circle and respects lateral clearance independently', () => {
  const s = { ...source, wheelWidths: [0.31, 0.31, 0.36, 0.36] }, fit = createCarFit(s, target);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 32; j++) {
    const a = j * Math.PI / 16, local = fit.wheelPoint([0, Math.sin(a) * s.wheels[i][3], Math.cos(a) * s.wheels[i][3]], i);
    close(Math.hypot(local[1], local[2]), target.wheels[i][3]);
    const side = fit.wheelPoint([s.wheelWidths[i] / 2, 0, 0], i)[0];
    assert.ok(side + Math.abs(target.wheels[i][0]) <= target.halfW + 0.0200001);
  }
  close(fit.wheelPoint([0, -s.wheels[0][3], 0], 0)[1] + target.wheels[0][1], 0);
  const normal = fit.wheelNormal([1, 1, 0], 0), tangent = fit.wheelPoint([1, -1, 0], 0);
  close(dot(normal, tangent), 0); close(Math.hypot(...normal), 1);
});

test('identity fitting is a no-op, including the shipped fourteen car specifications', () => {
  const models = JSON.parse(readFileSync(new URL('../assets/cars/models.json', import.meta.url), 'utf8'));
  for (const [id, model] of Object.entries(models)) {
    if (id === 'super') continue;
    const fit = createCarFit(model.spec, model.spec);
    for (const p of [[0, 0, 0], [model.spec.halfW, model.spec.height, model.spec.zRear], ...model.spec.wheels.map((w) => w.slice(0, 3))]) {
      fit.point(p).forEach((v, i) => close(v, p[i]));
      const n = fit.normal([0.6, 0, 0.8], p); n.forEach((v, i) => close(v, [0.6, 0, 0.8][i], 2e-8));
    }
  }
});

test('mesh helpers preserve UV/topology references and never overwrite source attributes', () => {
  const data = { pos: new Float32Array([0.3, 0.8, 0.4]), nor: new Float32Array([0, 1, 0]), uv: new Float32Array([0.2, 0.6]), index: [0], flag: [0] };
  const before = structuredClone(data), fit = createCarFit(source, target);
  for (const result of [fit.body(data), fit.wheel(data, 0)]) {
    assert.notEqual(result.pos, data.pos); assert.notEqual(result.nor, data.nor);
    assert.equal(result.uv, data.uv); assert.equal(result.index, data.index); assert.equal(result.flag, data.flag);
    close(Math.hypot(...result.nor), 1);
  }
  assert.deepEqual(data, before);
});

test('invalid anchors fail before geometry export instead of generating folded or nonfinite surfaces', () => {
  assert.throws(() => createCarFit({ ...source, zRear: 0 }, target), /axles/);
  assert.throws(() => createCarFit(source, { ...target, height: 0.2 }), /dimensions/);
  assert.throws(() => createCarFit(source, { ...target, halfW: NaN }), /dimensions/);
  assert.throws(() => createCarFit(source, { ...target, wheels: [] }), /four grounded/);
  const fit = createCarFit(source, target);
  assert.throws(() => fit.wheelPoint([0, 0, 0], 4), /Wheel index/);
  assert.throws(() => fit.normal([0, 0, 0], [0, 0, 0]), /invalid normal/);
});
