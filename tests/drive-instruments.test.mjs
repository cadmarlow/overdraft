import test from 'node:test';
import assert from 'node:assert/strict';
import { drivingTelemetry } from '../js/drive-instruments.js';
import { createBody, makeTune } from '../js/car-physics.js';
import { CAR_CATALOG, CAR_NAMES } from '../js/car-catalog.js';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../assets/cars/models.json', import.meta.url)));
test('the garage covers every imported car with one original identity and matching drivetrain', () => {
  assert.deepEqual(CAR_CATALOG.map(c => c.kind).sort(), Object.keys(manifest).sort());
  assert.equal(new Set(CAR_CATALOG.map(c => c.model)).size, CAR_CATALOG.length);
  for (const c of CAR_CATALOG) {
    assert.equal(CAR_NAMES[c.kind][0], c.brand);
    const tune = makeTune(c.kind, {});
    if (c.drive === 'TRACTION') assert.equal(tune.rear, 0, c.kind);
    if (c.drive.includes('PROPULSION')) assert.equal(tune.rear, 1, c.kind);
    if (c.drive === 'INTÉGRALE') assert.ok(tune.rear > 0 && tune.rear < 1, c.kind);
    assert.ok(Number.isInteger(c.paint) && c.paint >= 0 && c.paint <= 0xffffff);
  }
});

test('the speedometer follows ground velocity during a slide and reports the real gearbox', () => {
  const car = { speed: 12, hp: 70, nitro: 0.8, tune: { redline: 8000 }, body: { vx: 6, vz: 8, rpm: 6040, gear: 3 } };
  const t = drivingTelemetry(car);
  assert.equal(t.speed, 36);
  assert.equal(t.gear, '4');
  assert.equal(t.rpm, 6050);
  assert.equal(t.revs, 0.755);
  assert.equal(t.health, 0.7);
  assert.equal(t.nitro, 0.8);
  car.body.reversing = true;
  assert.equal(drivingTelemetry(car).gear, 'R');
});

test('ABS, traction control, pedals and g meter are physical signals, safely bounded', () => {
  const target = {};
  const car = { body: { vx: 0, vz: 0, rpm: 16000, throttle: 2, brake: -1, abs: 0.4, tractionControl: 0.4, longG: 8, lateralG: -8 }, tune: { redline: 8000 }, hp: -100, nitro: 8 };
  assert.equal(drivingTelemetry(car, target), target);
  assert.equal(target.abs, true); assert.equal(target.tc, true);
  assert.equal(target.throttle, 1); assert.equal(target.brake, 0);
  assert.equal(target.revs, 1); assert.equal(target.health, 0); assert.equal(target.nitro, 1);
  assert.equal(target.longG, 1.6); assert.equal(target.lateralG, -1.6);
  assert.ok(Number.isFinite(Number(target.g)));
});

test('other vehicles retain a simple speed and altitude display without engine telemetry', () => {
  const t = drivingTelemetry({ speed: 20, air: true, position: { y: 120.4 } });
  assert.equal(t.speed, 72); assert.equal(t.gear, '120 M');
  assert.equal(t.physical, false); assert.equal(t.nitro, 0);
  assert.equal(drivingTelemetry({ speed: -4 }).gear, 'R');
  assert.equal(drivingTelemetry({ speed: 0 }).gear, 'N');
});

test('a fresh fleet car produces a finite instrument packet before its first simulation step', () => {
  for (const c of CAR_CATALOG) {
    const s = manifest[c.kind].spec;
    const tune = makeTune(c.kind, { ...s, halfL: Math.max(s.zFront, -s.zRear) });
    const car = { speed: 0, tune, body: createBody(tune), hp: 100, nitro: 1 };
    for (const [key, value] of Object.entries(drivingTelemetry(car))) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${c.kind}: ${key}`);
  }
});
