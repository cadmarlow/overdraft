import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFlight, placeAircraft } from '../js/flight.js';
import { flightTelemetry } from '../js/flight-instruments.js';

// What the pilot's panel shows (js/flight-instruments.js), read from the flight model's own numbers

const craft = (kind, at) => placeAircraft({ kind, position: { x: 0, y: 0, z: 0 }, flight: createFlight(kind), hp: 100 }, at);

test('the panel reads the flight model: speed in km/h, height, climb, load, heading', () => {
  const a = craft('jet', { y: 500, heading: 0, speed: 100, pitch: 0.2, roll: 0.3 });
  a.flight.agl = 480; a.flight.gSmooth = 3.2; a.flight.vy = 12.5;
  const t = flightTelemetry(a);
  assert.equal(t.speed, 360);
  assert.equal(t.altitude, 500);
  assert.equal(t.height, 480);
  assert.equal(t.climb, 12.5);
  assert.equal(t.g, 3.2);
  assert.ok(Math.abs(t.pitch - 0.2) < 1e-6 && Math.abs(t.roll - 0.3) < 1e-6);
  assert.equal(t.jet, true);
  assert.equal(t.onGround, false);
  assert.equal(t.health, 1);
});

test('the compass is true: downtown along the avenues reads 209, uptown 029, and it turns the right way', () => {
  assert.equal(flightTelemetry(craft('classic', { y: 300, heading: 0, speed: 40 })).heading, 209);
  assert.equal(flightTelemetry(craft('classic', { y: 300, heading: Math.PI, speed: 40 })).heading, 29);
  // +X is east of the avenues' axis: turning the nose towards it (heading up) is a turn to the left, the compass falls
  assert.equal(flightTelemetry(craft('classic', { y: 300, heading: Math.PI / 2, speed: 40 })).heading, 119);
  assert.equal(flightTelemetry(craft('classic', { y: 300, heading: -Math.PI / 2, speed: 40 })).heading, 299);
});

test('the lamps: undercarriage up, travelling, down or fixed; reheat; airbrake; a dead engine', () => {
  const jet = craft('jet', { y: 500, speed: 150 });
  assert.equal(flightTelemetry(jet).gear, 'up');
  jet.flight.gear = 0.5;
  assert.equal(flightTelemetry(jet).gear, 'moving');
  jet.flight.gear = 1;
  assert.equal(flightTelemetry(jet).gear, 'down');
  assert.equal(flightTelemetry(craft('classic', { y: 300, speed: 40 })).gear, 'fixed');
  jet.flight.ab = 0.8; jet.flight.brake = 1; jet.flight.damage.engine = 1; jet.hp = 20;
  const t = flightTelemetry(jet);
  assert.equal(t.reheat, 0.8);
  assert.equal(t.brake, true);
  assert.equal(t.dead, true);
  assert.equal(t.health, 0.2);
});

test('the warnings: a stall only in the air, the ground only when it is coming up faster than it can be avoided', () => {
  const a = craft('jet', { y: 500, speed: 60 });
  a.flight.stall = 0.9;
  assert.equal(flightTelemetry(a).stall, true);
  a.flight.onGround = true;
  assert.equal(flightTelemetry(a).stall, false, 'slow on the runway is not a stall');
  const dive = craft('jet', { y: 100, speed: 200, pitch: -0.5 });
  dive.flight.agl = 100; dive.flight.vy = -90;
  assert.equal(flightTelemetry(dive).pullUp, true);
  dive.flight.agl = 900;
  assert.equal(flightTelemetry(dive).pullUp, false, 'the same dive from high up has room');
  // a normal approach, wheels down, sinking gently: no shouting
  const approach = craft('jet', { y: 30, speed: 70 });
  approach.flight.agl = 30; approach.flight.vy = -4; approach.flight.gear = 1;
  assert.equal(flightTelemetry(approach).pullUp, false);
});

test('everything the panel moves is moved by transform or opacity (no layout in flight)', () => {
  const css = readFileSync(new URL('../css/flight.css', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../js/flight-instruments.js', import.meta.url), 'utf8');
  // what the code writes every frame
  const written = [...source.matchAll(/\.style\.(\w+) =/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(written)].sort(), ['fontSize', 'transform'], 'only transforms (and the ladder scale when the lens changes)');
  // animations of the stylesheet only animate opacity
  for (const [, body] of css.matchAll(/@keyframes [\w-]+\{([^@]+?\})\}/g)) {
    for (const [, property] of body.matchAll(/([\w-]+):/g)) assert.equal(property, 'opacity', `keyframes animate ${property}`);
  }
});
