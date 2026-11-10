import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CLASSES, makeTune } from '../js/car-physics.js';

const models = JSON.parse(fs.readFileSync(new URL('../assets/cars/models.json', import.meta.url)));
const ids = Object.keys(models);

test('every car the game names has a model, a texture pair and a handling class', () => {
  for (const id of ['sedan', 'suv', 'taxi', 'pickup', 'van', 'minivan', 'hatch', 'compact', 'wagon', 'offroad', 'muscle', 'sport', 'super', 'truck', 'delivery']) {
    assert.ok(models[id], id);
    for (const suffix of ['.bin', '_c.webp', '_m.webp']) assert.ok(fs.existsSync(new URL(`../assets/cars/${id}${suffix}`, import.meta.url)), id + suffix);
    if (id !== 'delivery') assert.ok(CLASSES[id], id);
  }
});

test('models are real-world sized, front wheels ahead, sitting on the ground', () => {
  for (const id of ids) {
    const s = models[id].spec;
    assert.ok(s.zFront - s.zRear > 3.5 && s.zFront - s.zRear < 7, `${id} length`);
    assert.ok(s.halfW > 0.7 && s.halfW < 1.25, `${id} width ${s.halfW}`);
    assert.ok(s.wheelZf > 0 && s.wheelZr < 0, `${id} axles`);
    for (const [, y, , r] of s.wheels) assert.ok(Math.abs(y - r) < 0.03, `${id} wheel on the ground`);
    assert.equal(s.wheels.length, 4);
  }
});

test('the binary holds exactly what the manifest promises', () => {
  for (const id of ids) {
    const m = models[id], n = m.vertices;
    const size = n * 12 + n * (m.normalFormat === 'snorm16' ? 8 : 4) + n * 4 + n + (4 - n % 4) % 4 + m.indices * 4;
    assert.equal(fs.statSync(new URL(`../assets/cars/${id}.bin`, import.meta.url)).size, size, id);
    assert.equal(m.ranges.length, 14, id);
  }
});

test('a body built from any model gets a usable tune', () => {
  for (const id of ids) {
    const s = models[id].spec;
    const t = makeTune(id, { halfW: s.halfW, halfL: s.zFront, height: s.height, wheelX: s.wheelX, wheelZf: s.wheelZf, wheelZr: s.wheelZr, wheelRadius: s.wheelRadius });
    assert.ok(t.mass > 800 && t.top > 30 && t.gears.length >= 5, id);
  }
});
