import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLASSES, makeTune, createBody, settleBody, stepCar } from '../js/car-physics.js';

// Use the shipped silhouettes: a tall delivery van and a wide supercar must be tested on their real wheelbase/track.
const fleet = JSON.parse(readFileSync(new URL('../assets/cars/models.json', import.meta.url), 'utf8'));
const DT = 1 / 60;
const STILL = { throttle: 0, steer: 0, handbrake: false };
const POWER = { ...STILL, throttle: 1 };
const BRAKE = { ...STILL, throttle: -1 };
function makeCar(kind = 'sedan') {
  const s = fleet[kind].spec;
  const tune = makeTune(kind, { ...s, halfL: Math.max(s.zFront, -s.zRear), wheelX: (s.wheelX + s.wheelXr) / 2 });
  return { kind, tune, body: createBody(tune), position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, vx: 0, vz: 0, angularVel: 0, steerAngle: 0 };
}
function road(grip = 1, height = () => 0) {
  return { grip, ground(x, z, hit) { Object.assign(hit, { y: height(x, z), nx: 0, ny: 1, nz: 0, grip: 1, rough: 0, curb: false }); } };
}
function run(c, input, seconds, world = road(), each) {
  for (let i = 0, frames = Math.round(seconds / DT); i < frames; i++) { stepCar(c, input, DT, world); each?.(c, i * DT); }
  return c;
}
function accelerate(c, speed = 100 / 3.6) {
  const world = road();
  let time = 0;
  while (c.speed < speed && time < 30) { stepCar(c, POWER, DT, world); time += DT; }
  assert.ok(c.speed >= speed, `${c.kind} failed to reach ${speed * 3.6} km/h`);
  return time;
}
function stop(c, world = road()) {
  const from = { ...c.position };
  let time = 0, abs = 0, dive = 0;
  while (c.speed > 0.8 && time < 12) {
    stepCar(c, BRAKE, DT, world); time += DT;
    abs = Math.max(abs, c.body.abs);
    dive = Math.max(dive, c.body.wheels[0].comp - c.body.wheels[2].comp);
  }
  assert.ok(c.speed <= 0.8, `${c.kind} failed to stop`);
  return { distance: Math.hypot(c.position.x - from.x, c.position.z - from.z), abs, dive };
}

test('every shipped car has its own tune and can launch, brake and support its real body', () => {
  assert.equal(Object.keys(fleet).length, 15);
  for (const kind of Object.keys(fleet)) {
    assert.ok(Object.hasOwn(CLASSES, kind), `${kind} fell back to sedan handling`);
    const c = makeCar(kind), launch = accelerate(c), braking = stop(c);
    assert.ok(launch > 1.8 && launch < 16, `${kind}: 0–100 in ${launch} s`);
    assert.ok(braking.distance > 25 && braking.distance < 60, `${kind}: braking in ${braking.distance} m`);
    assert.ok(braking.dive > 0.005, `${kind} never transferred load to the front`);
    assert.ok(c.body.r[4] > 0.97, `${kind} tipped over under braking`);
    for (const wheel of c.body.wheels) assert.ok(wheel.load >= 0, `${kind}: a tyre pulled the car down`);
  }
});

test('the delivery van is a loaded front-drive diesel, not the sedan fallback', () => {
  const c = makeCar('delivery');
  assert.equal(c.tune.rear, 0);
  assert.ok(c.tune.mass >= 1700 && c.tune.mass <= 2100);
  assert.ok(c.tune.redline < 5000);
  run(c, POWER, 1.5);
  assert.ok(c.body.axle[0].force > 1000);
  assert.equal(c.body.axle[1].force, 0);
});

test('the inside front wheel steers further and the outside wheels cover more distance', () => {
  const c = run(makeCar(), { ...STILL, throttle: 0.3, steer: 1 }, 4);
  const [frontIn, frontOut, rearIn, rearOut] = c.body.wheels;
  assert.ok(frontIn.steer > frontOut.steer + 0.07);
  assert.ok(frontIn.steer > c.body.steer && frontOut.steer < c.body.steer);
  assert.ok(frontOut.spin > frontIn.spin + 1);
  assert.ok(rearOut.spin > rearIn.spin + 1);
  assert.ok(Math.abs(c.body.steer) <= c.tune.lock, 'countersteer exceeded the steering rack');
  assert.equal(rearIn.steer, 0);
  assert.equal(rearOut.steer, 0);
});

test('a light pedal shifts early without hunting; a full pedal kicks down', () => {
  const c = makeCar(), shifts = [];
  run(c, { ...STILL, throttle: 0.25 }, 20, road(), (car) => {
    const previous = shifts.at(-1)?.gear ?? 0;
    if (car.body.gear !== previous) shifts.push({ gear: car.body.gear, rpm: car.body.rpm });
  });
  assert.ok(shifts.length >= 3, 'the automatic kept shouting in a low gear');
  assert.ok(shifts.every((shift, i) => shift.gear === i + 1), 'the gearbox hunted between adjacent gears');
  assert.ok(shifts.every((shift) => shift.rpm < c.tune.redline * 0.5));
  const cruisingGear = c.body.gear, cruisingSpeed = c.speed;
  run(c, POWER, 0.6);
  assert.ok(c.body.gear < cruisingGear, `did not kick down from ${cruisingGear + 1}`);
  assert.ok(c.speed > cruisingSpeed + 0.5);
});

test('full throttle uses the power band and a gear change interrupts the actual engine load', () => {
  const c = makeCar('sport');
  let previousGear = 0, shiftedAt = 0, loadDuringShift = 1, revJump = 0, previousRpm = c.body.rpm;
  run(c, POWER, 5, road(), (car) => {
    if (car.body.gear > previousGear) shiftedAt = Math.max(shiftedAt, previousRpm / car.tune.redline);
    if (car.body.shift > car.tune.shift * 0.3 && car.body.shift < car.tune.shift * 0.6) loadDuringShift = Math.min(loadDuringShift, car.body.engineLoad);
    revJump = Math.max(revJump, Math.abs(car.body.rpm - previousRpm));
    previousGear = car.body.gear; previousRpm = car.body.rpm;
  });
  assert.ok(shiftedAt > 0.92, `short-shifted at ${shiftedAt}`);
  assert.ok(loadDuringShift < 0.65, `torque never unloaded (${loadDuringShift})`);
  assert.ok(revJump < 1500, `rpm teleported by ${revJump}`);
});

test('wet-road ABS lengthens the stop while leaving the tyres rotating and the car steerable', () => {
  const dry = makeCar(), wet = makeCar();
  accelerate(dry); accelerate(wet);
  const a = stop(dry), b = stop(wet, road(0.45));
  assert.ok(b.distance > a.distance * 1.4, `${b.distance} vs ${a.distance}`);
  assert.ok(b.abs > a.abs + 0.2, `${b.abs} vs ${a.abs}`);
  const steerable = makeCar(); accelerate(steerable);
  let minSpin = Infinity;
  run(steerable, { ...BRAKE, steer: 0.7 }, 2, road(0.45), (c) => {
    if (c.speed > 8) minSpin = Math.min(minSpin, ...c.body.wheels.slice(0, 2).map((w) => Math.abs(w.spin)));
  });
  assert.ok(steerable.heading > 0.2, 'braking removed steering authority');
  assert.ok(minSpin > 2, `ABS locked the front wheels (${minSpin})`);
});

test('all fifteen cars corner on dry and wet roads, and wet tyres provide less lateral force', () => {
  for (const kind of Object.keys(fleet)) {
    const lateral = [];
    for (const grip of [1, 0.65]) {
      const c = makeCar(kind); accelerate(c);
      let g = 0, slip = 0;
      run(c, { ...STILL, throttle: 0.5, steer: 1 }, 4, road(grip), (car, time) => {
        if (time > 1) g = Math.max(g, Math.abs(car.body.lateralG));
        slip = Math.max(slip, Math.atan2(Math.hypot(car.vx, car.vz), Math.abs(car.speed)));
        assert.ok(car.body.r[4] > 0.9, `${kind} rolled on grip ${grip}`);
      });
      assert.ok(slip < (kind === 'muscle' ? 0.75 : 0.4), `${kind} spun on grip ${grip}: ${slip}`);
      lateral.push(g);
    }
    assert.ok(lateral[1] < lateral[0] * 0.8, `${kind}: wet ${lateral[1]} g vs dry ${lateral[0]} g`);
  }
});

test('tyre forces build progressively and the telemetry follows actual acceleration, braking and contact', () => {
  const c = makeCar(); accelerate(c, 60 / 3.6);
  assert.ok(c.body.longG > 0.15);
  stepCar(c, { ...POWER, steer: 1 }, DT, road());
  const front = c.body.wheels[0], instantaneous = Math.atan2(front.vLat, Math.abs(front.vLong) + 1.1);
  assert.ok(Math.abs(front.alpha) > 0 && Math.abs(front.alpha) < Math.abs(instantaneous), 'the carcass did not build slip progressively');
  run(c, { ...STILL, steer: 0.5 }, 1);
  assert.ok(c.body.lateralG > 0.1);
  assert.ok(c.body.wheels.some((w) => w.utilization > 0.3));
  run(c, BRAKE, 0.4);
  assert.ok(c.body.longG < -0.3);
  assert.ok(c.body.tyreLoad > 0.9 && c.body.tyreLoad < 1.2);
});

test('a background-tab hitch cannot explode the suspension or move the car for the entire paused interval', () => {
  for (const kind of Object.keys(fleet)) {
    const c = makeCar(kind); accelerate(c, 80 / 3.6);
    const previous = { ...c.position };
    stepCar(c, { ...POWER, steer: 1 }, 1.5, road());
    assert.ok(Math.hypot(c.position.x - previous.x, c.position.z - previous.z) < 4, kind);
    assert.ok(Number.isFinite(c.position.y) && Math.abs(c.position.y) < 0.2, kind);
    assert.ok(c.body.r[4] > 0.98, kind);
  }
});

test('reverse remains manoeuvrable without giving the high-powered cars motorway speed backwards', () => {
  for (const kind of Object.keys(fleet)) {
    const c = makeCar(kind);
    let fastest = 0;
    run(c, { ...STILL, throttle: -1 }, 8, road(), (car) => { fastest = Math.max(fastest, -car.speed); });
    assert.ok(fastest > 5, `${kind} cannot back away`);
    assert.ok(fastest < c.tune.reverseTop + 1, `${kind} reversed at ${fastest * 3.6} km/h`);
    const speed = c.speed;
    run(c, STILL, 0.5);
    assert.ok(c.speed > speed, `${kind} gained energy with the throttle released`);
  }
});

test('recalling a car clears tyre relaxation, driver aids, load and transmission state', () => {
  const c = run(makeCar('muscle'), { ...POWER, steer: 1 }, 3);
  run(c, BRAKE, 0.3, road(0.4));
  assert.ok(c.body.abs > 0 || c.body.longG !== 0);
  settleBody(c, 0);
  for (const field of ['engineLoad', 'clutch', 'longG', 'lateralG', 'abs', 'tractionControl', 'tyreLoad', 'shiftCooldown']) assert.equal(c.body[field], 0, field);
  for (const w of c.body.wheels) for (const field of ['alpha', 'steer', 'utilization', 'abs', 'brakeSlip', 'longitudinalForce', 'lateralForce']) assert.equal(w[field], 0, field);
  assert.equal(c.body.surfaceGrip, 1);
});
