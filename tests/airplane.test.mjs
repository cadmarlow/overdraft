import test from 'node:test';
import assert from 'node:assert/strict';
import { stepPlane, STALL_SPEED, ROTATE_SPEED } from '../js/flight.js';

const LEVEL = { pitch: 0, roll: 0, throttle: 0 };
const flatWorld = (hit = () => false) => ({ ground: () => 0, water: () => false, hit });

function plane(overrides = {}) {
  return { position: { x: 0, y: 300, z: 0 }, heading: 0, speed: 62, verticalSpeed: 0, pitch: 0, roll: 0, throttle: 0.6, onGround: false, crashed: false, ...overrides };
}

function fly(p, input, seconds, env = flatWorld()) {
  for (let t = 0; t < seconds; t += 1 / 60) stepPlane(p, input, 1 / 60, env);
  return p;
}

test('level flight holds its height and settles at a cruising speed', () => {
  const p = fly(plane(), LEVEL, 30);
  assert.ok(Math.abs(p.position.y - 300) < 5, `height ${p.position.y}`);
  assert.ok(p.speed > 55 && p.speed < 80, `speed ${p.speed}`);
  assert.equal(p.crashed, false);
});

test('banking left turns left, quickly enough to come round within half a minute', () => {
  const p = fly(plane(), { ...LEVEL, roll: 1 }, 6);
  assert.ok(p.heading > 0.7, `heading ${p.heading}`);
  assert.ok(p.roll > 0.9);
});

test('climbing bleeds speed; with the throttle shut the plane stalls, drops its nose and falls', () => {
  const p = fly(plane({ throttle: 0 }), { ...LEVEL, pitch: 1 }, 12);
  assert.ok(p.speed < STALL_SPEED + 6, `speed ${p.speed}`);
  const y = p.position.y;
  fly(p, LEVEL, 3);
  assert.ok(p.position.y < y, 'it loses height');
  assert.ok(p.pitch < 0.3, `pitch ${p.pitch}`);
});

test('a flat, gentle approach lands and the brakes bring the plane to a stop', () => {
  const p = plane({ position: { x: 0, y: 6, z: 0 }, speed: 40, pitch: -0.08, throttle: 0.1 });
  fly(p, LEVEL, 3);
  assert.equal(p.onGround, true);
  assert.equal(p.crashed, false);
  fly(p, { ...LEVEL, throttle: -1 }, 12);
  assert.equal(p.speed, 0);
});

test('a dive into the ground is a crash, and so is the water, however gentle', () => {
  const dive = fly(plane({ position: { x: 0, y: 40, z: 0 }, pitch: -0.8 }), LEVEL, 2);
  assert.equal(dive.crashed, true);
  const env = { ...flatWorld(), water: () => true };
  const ditch = fly(plane({ position: { x: 0, y: 6, z: 0 }, speed: 40, pitch: -0.08, throttle: 0.1 }), LEVEL, 3, env);
  assert.equal(ditch.crashed, true);
});

test('from a standstill the plane rolls, rotates past its lift-off speed and climbs away', () => {
  const p = plane({ position: { x: 0, y: 0, z: 0 }, speed: 0, onGround: true, throttle: 1 });
  fly(p, LEVEL, 8);
  assert.equal(p.onGround, true, 'no lift-off without the stick');
  assert.ok(p.speed > ROTATE_SPEED);
  fly(p, { ...LEVEL, pitch: 1 }, 4);
  assert.equal(p.onGround, false);
  assert.ok(p.position.y > 10, `height ${p.position.y}`);
});

test('a building stops a taxiing plane but destroys a flying one', () => {
  const wall = flatWorld(() => true);
  const rolling = plane({ position: { x: 0, y: 0, z: 0 }, speed: 5, onGround: true, throttle: 0 });
  stepPlane(rolling, LEVEL, 1 / 60, wall);
  assert.equal(rolling.crashed, false);
  assert.equal(rolling.speed, 0);
  const flying = plane();
  stepPlane(flying, LEVEL, 1 / 60, wall);
  assert.equal(flying.crashed, true);
});
