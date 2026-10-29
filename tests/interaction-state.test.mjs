import test from 'node:test';
import assert from 'node:assert/strict';
import { canInteract, doorPosition, angleDelta, validPosition } from '../js/interaction-state.js';

test('enter and exit requests are rejected during transitions and while moving', () => {
  assert.equal(canInteract('onFoot'), true);
  assert.equal(canInteract('entering'), false);
  assert.equal(canInteract('exiting'), false);
  assert.equal(canInteract('driving', 0), true);
  assert.equal(canInteract('driving', 4), false);
  assert.equal(canInteract('driving', -4), false);
});

test('vehicle door coordinates rotate with the car rather than with the world', () => {
  const car = { position: { x: 10, z: 20 }, heading: 0, spec: { doors: [1, -1] } };
  assert.deepEqual(doorPosition(car), { x: 11.4, z: 20 });
  car.heading = Math.PI / 2;
  const door = doorPosition(car);
  assert.ok(Math.abs(door.x - 10) < 1e-9);
  assert.ok(Math.abs(door.z - 18.6) < 1e-9);
});

test('character turns follow the short arc across the heading boundary', () => {
  assert.ok(Math.abs(angleDelta(Math.PI - 0.1, -Math.PI + 0.1) - 0.2) < 1e-9);
});

test('invalid or corrupted saved positions cannot enter the world', () => {
  assert.equal(validPosition({ x: 12, y: 0, z: -150 }), true);
  for (const p of [null, { x: NaN, y: 0, z: 0 }, { x: 1, y: -100, z: 0 }, { x: 1e9, y: 0, z: 0 }]) {
    assert.ok(!validPosition(p));
  }
});
