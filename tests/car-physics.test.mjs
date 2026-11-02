import test from 'node:test';
import assert from 'node:assert/strict';
import { createBody, makeTune, settleBody, stepCar, impactBody } from '../js/car-physics.js';

const SHAPE = { halfW: 0.92, halfL: 2.3, height: 1.42, wheelX: 0.8, wheelZf: 1.42, wheelZr: -1.42, wheelRadius: 0.34 };
function makeCar(kind = 'sedan', over = {}) {
  const tune = makeTune(kind, { ...SHAPE, ...over });
  return { tune, body: createBody(tune), position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, vx: 0, vz: 0, angularVel: 0, steerAngle: 0 };
}
const flat = (y = () => 0, grip = 1) => ({
  grip,
  ground(x, z, hit) { hit.y = y(x, z); hit.nx = 0; hit.ny = 1; hit.nz = 0; hit.grip = 1; hit.rough = 0; hit.curb = false; }
});
const STILL = { throttle: 0, steer: 0, handbrake: false };
function run(c, input, seconds, world = flat(), each) {
  for (let t = 0; t < seconds; t += 1 / 60) { stepCar(c, input, 1 / 60, world); each?.(c, t); }
  return c;
}
const roadSpeed = (c) => Math.hypot(c.speed, c.vx, c.vz);
const kmh = (v) => v * 3.6;
function timeTo(c, speed, limit = 30) {
  let t = 0;
  while (c.speed < speed && t < limit) { stepCar(c, { ...STILL, throttle: 1 }, 1 / 60, flat()); t += 1 / 60; }
  return t;
}

test('a parked car settles on its springs and stays put', () => {
  const c = run(makeCar(), STILL, 3);
  assert.ok(Math.abs(c.position.y) < 0.03, `height ${c.position.y}`);
  assert.ok(Math.abs(c.position.x) + Math.abs(c.position.z) < 0.01);
  assert.ok(roadSpeed(c) < 0.05);
  const load = c.body.wheels.reduce((n, w) => n + w.load, 0);
  assert.ok(Math.abs(load - c.tune.mass * 9.81) < 300, `load ${load}`);
});

test('full power is quick off the line, and the fast classes are far quicker than the slow ones', () => {
  const sedan = timeTo(makeCar('sedan'), 100 / 3.6), muscle = timeTo(makeCar('muscle'), 100 / 3.6), sup = timeTo(makeCar('super'), 100 / 3.6), van = timeTo(makeCar('van'), 100 / 3.6);
  assert.ok(sedan < 8.5 && sedan > 4.5, `sedan ${sedan}`);
  assert.ok(sup < 3.6, `super ${sup}`);
  assert.ok(muscle < sedan, `muscle ${muscle} sedan ${sedan}`);
  assert.ok(van > sedan, `van ${van}`);
});

test('the gearbox climbs through its gears and holds the revs under the limiter', () => {
  const c = makeCar('sedan');
  const seen = new Set();
  run(c, { ...STILL, throttle: 1 }, 26, flat(), (car) => { seen.add(car.body.gear); assert.ok(car.body.rpm < car.tune.redline * 1.05); });
  assert.ok(seen.size >= 5, `gears ${[...seen]}`);
  assert.ok(kmh(c.speed) > 170 && kmh(c.speed) < 260, `top ${kmh(c.speed)}`);
});

test('the supercar passes 280 km/h, the van never reaches 200', () => {
  assert.ok(kmh(run(makeCar('super'), { ...STILL, throttle: 1 }, 40).speed) > 280);
  assert.ok(kmh(run(makeCar('van'), { ...STILL, throttle: 1 }, 40).speed) < 200);
});

test('heavy braking stops from 100 km/h inside 45 m, nose down', () => {
  const c = makeCar();
  timeTo(c, 100 / 3.6);
  let dive = 0;
  const from = c.position.z;
  for (let t = 0; t < 6 && c.speed > 0.3; t += 1 / 60) {
    stepCar(c, { ...STILL, throttle: -1 }, 1 / 60, flat());
    dive = Math.max(dive, c.body.wheels[0].comp - c.body.wheels[2].comp);
  }
  assert.ok(c.position.z - from < 45, `stopped in ${c.position.z - from} m`);
  assert.ok(dive > 0.03, `dive ${dive}`);
});

test('backing off the brakes at rest, the same key reverses', () => {
  const c = run(makeCar(), { ...STILL, throttle: -1 }, 4);
  assert.ok(c.speed < -5, `reverse ${c.speed}`);
  assert.equal(c.body.reversing, true);
});

test('a hard corner pulls around a g with the body leaning out of it, on a stable line', () => {
  const c = makeCar();
  run(c, { ...STILL, throttle: 1 }, 7);
  const v = roadSpeed(c);
  let peak = 0, roll = 0, turned = 0;
  run(c, { throttle: 0.5, steer: 1, handbrake: false }, 4, flat(), (car, t) => {
    turned += car.angularVel / 60;
    if (t > 1) peak = Math.max(peak, Math.abs(car.angularVel) * roadSpeed(car));
    roll = Math.max(roll, Math.abs(car.body.wheels[0].comp - car.body.wheels[1].comp));
    assert.ok(car.body.r[4] > 0.85, 'stays on its wheels');
  });
  assert.ok(turned > 1, `turned ${turned} from ${v}`);
  assert.ok(peak > 8 && peak < 15, `lateral ${peak}`);
  assert.ok(roll > 0.04, `roll ${roll}`);
});

test('the handbrake at speed throws the tail out and turns the car much faster than the wheel alone', () => {
  const swing = (handbrake) => {
    const c = makeCar();
    run(c, { ...STILL, throttle: 1 }, 6);
    let turned = 0;
    run(c, { throttle: 0, steer: 1, handbrake }, 1, flat(), (car) => { turned += car.angularVel / 60; });
    return { turned, car: c };
  };
  const plain = swing(false), slid = swing(true);
  assert.ok(slid.turned > plain.turned * 1.4, `${slid.turned} vs ${plain.turned}`);
  assert.ok(slid.car.body.skid > 2, `skid ${slid.car.body.skid}`);
});

test('a slide can be held: full throttle and opposite lock keep it pointing near the road', () => {
  const c = makeCar('muscle');
  run(c, { ...STILL, throttle: 1 }, 5);
  run(c, { throttle: 0.6, steer: 1, handbrake: true }, 0.5);
  run(c, { throttle: 1, steer: -0.4, handbrake: false }, 2.2);
  assert.ok(Math.abs(Math.atan2(Math.hypot(c.vx, c.vz), Math.abs(c.speed))) < 1.2, 'not spinning backwards');
  assert.ok(c.speed > 5, `speed ${c.speed}`);
});

test('too much throttle from rest spins up the muscle car\'s rear wheels', () => {
  const c = makeCar('muscle');
  let spin = 0;
  run(c, { ...STILL, throttle: 1 }, 1.5, flat(), (car) => { spin = Math.max(spin, car.body.axle[1].slip); });
  assert.ok(spin > 3, `slip ${spin}`);
});

test('a car driven off a drop flies, lands, and comes back to rest on its wheels', () => {
  const ledge = (x, z) => (z < 30 ? 3 : 0);
  const c = makeCar();
  c.position.y = 3;
  run(c, { ...STILL, throttle: 1 }, 2.4, flat(ledge));
  let air = 0;
  run(c, { ...STILL, throttle: 1 }, 4, flat(ledge), (car) => { if (!car.body.grounded) air++; });
  assert.ok(air > 12, `air ${air}`);
  run(c, STILL, 4, flat(ledge));
  assert.ok(c.body.r[4] > 0.9, `up ${c.body.r[4]}`);
  assert.equal(c.body.grounded, 4);
});

test('a car on its roof slides, sparks and gets back on its wheels', () => {
  const c = makeCar();
  c.position.y = 2.2;
  c.body.q[0] = 1; c.body.q[3] = 0; // upside down
  c.body.vz = 12;
  let sparks = 0;
  run(c, STILL, 9, flat(), (car) => { if (car.body.scrape) sparks++; });
  assert.ok(sparks > 3, `sparks ${sparks}`);
  run(c, STILL, 3);
  assert.ok(c.body.r[4] > 0.85, `up ${c.body.r[4]}`);
});

test('a kerb jolts the car without stopping it', () => {
  const kerb = (x, z) => (z > 40 && z < 44 ? 0.22 : 0);
  const c = makeCar();
  run(c, { ...STILL, throttle: 1 }, 2.5, flat(kerb));
  const v = c.speed;
  let jolt = 0;
  run(c, { ...STILL, throttle: 1 }, 2, flat(kerb), (car) => { jolt = Math.max(jolt, Math.abs(car.body.vy)); });
  assert.ok(c.speed > v * 0.9, `speed ${c.speed}`);
  assert.ok(jolt > 0.25, `jolt ${jolt}`);
});

test('a low car hitting a kerb flat out stays near the ground', () => {
  const kerb = (x, z) => (z > 90 ? 0.22 : 0);
  const c = makeCar('sport', { sill: 0.12 });
  run(c, { ...STILL, throttle: 1 }, 5, flat());
  c.position.z = 80;
  let top = 0;
  run(c, { ...STILL, throttle: 1 }, 2.5, flat(kerb), (car) => { top = Math.max(top, car.position.y); });
  assert.ok(top < 1.8, `rose to ${top}`);
});

test('a head-on wall takes the speed away; a glancing one mostly turns it', () => {
  const blow = (nx, nz, spot) => {
    const c = makeCar();
    c.body.vz = 30; c.speed = 30;
    stepCar(c, STILL, 1 / 120, flat());
    impactBody(c, spot[0], 0.55, spot[1], nx, 0, nz);
    return c.body;
  };
  const head = blow(0, -1, [0, 2.3]);
  const glance = blow(-0.26, -0.96, [0.9, 2.3]);
  assert.ok(Math.abs(head.vz) < 8, `after ${head.vz}`);
  assert.ok(Math.abs(glance.wy) > 0.3, `spin ${glance.wy}`);
});

test('whatever the display rate, the car runs the same road', () => {
  const lap = (dt) => {
    const c = makeCar();
    for (let t = 0; t < 6; t += dt) stepCar(c, { throttle: 1, steer: t > 3 ? 0.4 : 0, handbrake: false }, dt, flat());
    return c.position;
  };
  const a = lap(1 / 120), b = lap(1 / 30);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 8, `${a.x},${a.z} vs ${b.x},${b.z}`);
});

test('a teleport in the middle of a slide leaves a car standing level', () => {
  const c = makeCar();
  run(c, { throttle: 1, steer: 1, handbrake: true }, 2);
  c.position.x = 100; c.position.y = 0;
  settleBody(c, 1);
  run(c, STILL, 1);
  assert.ok(roadSpeed(c) < 0.1);
  assert.ok(Math.abs(c.heading - 1) < 1e-3);
});
