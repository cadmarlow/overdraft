const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const { stepBoat, swell, driveBoatAI, WATER } = loadModule(readFileSync(join(__dirname, '../js/boat.js'), 'utf8'), {
  imports: { 'three/webgpu': {}, 'three/tsl': {}, 'three/addons/utils/BufferGeometryUtils.js': {}, './vehicles.js': {} }
});

const boat = (over = {}) => ({ position: { x: 0, y: WATER, z: 0 }, heading: 0, speed: 0, vx: 0, vz: 0, angularVel: 0, steerAngle: 0, halfL: 4.1, prevX: 0, prevZ: 0,
  pitch: 0, roll: 0, heave: 0, plane: 0, slam: 0, pitchVel: 0, rollVel: 0, heaveVel: 0, chassisPivot: { rotation: { x: 0, z: 0 } }, ...over });
const open = { clock: 0, afloat: () => true };
function run(c, throttle, steer, seconds, world = open) {
  for (let t = 0; t < seconds; t += 1 / 60) { world.clock = t; stepBoat(c, throttle, steer, 1 / 60, world); }
  return c;
}

test('full throttle climbs onto the plane and tops out near 100 km/h', () => {
  const c = run(boat(), 1, 0, 14);
  assert.ok(c.speed * 3.6 > 90 && c.speed * 3.6 < 125, `speed ${c.speed}`);
  assert.ok(c.plane > 0.9);
});

test('off the plane the bow stands up, on it the hull levels out', () => {
  const c = boat();
  let bowUp = 0;
  for (let t = 0; t < 2; t += 1 / 60) { stepBoat(c, 1, 0, 1 / 60, open); bowUp = Math.min(bowUp, c.pitch); }
  run(c, 1, 0, 8);
  assert.ok(bowUp < -0.08, `bow ${bowUp}`);
  assert.ok(Math.abs(c.pitch) < Math.abs(bowUp), `pitch ${c.pitch}`);
});

test('it turns only with way on, and skids through the turn', () => {
  const still = run(boat(), 0, 1, 3);
  assert.ok(Math.abs(still.heading) < 0.1, `turned at rest ${still.heading}`);
  const c = run(boat(), 1, 0, 6);
  run(c, 1, 1, 1);
  assert.ok(c.heading > 0.4, `heading ${c.heading}`);
  assert.ok(Math.hypot(c.vx, c.vz) > 2, 'carries its way sideways');
  assert.ok(c.roll < -0.05, `leans ${c.roll}`);
});

test('the shore stops it and reports how hard', () => {
  const world = { clock: 0, afloat: (x, z) => z < 60 };
  const c = boat();
  let hit = 0;
  for (let t = 0; t < 8; t += 1 / 60) hit = Math.max(hit, stepBoat(c, 1, 0, 1 / 60, world));
  assert.ok(c.position.z < 60);
  assert.ok(hit > 8, `hit ${hit}`);
});

test('the swell is bounded and moves with time', () => {
  for (let i = 0; i < 200; i++) assert.ok(Math.abs(swell(i * 13, i * 7, i * 0.1)) < 0.4);
  assert.notEqual(swell(10, 10, 0), swell(10, 10, 1));
});

test('a hunter steers for its target and fires inside its range; a fugitive runs from it', () => {
  const calls = [];
  const world = { clock: 0, afloat: () => true, simulate: (c, throttle, steer) => calls.push({ throttle, steer }), shoot: () => calls.push('shot') };
  const hunter = boat({ boatAI: { gunT: 0, flee: false, gaveUp: false } });
  driveBoatAI(hunter, 1 / 60, { x: 40, z: 10 }, world);
  assert.ok(calls[0].steer > 0.5);
  assert.ok(calls.includes('shot'));
  calls.length = 0;
  const runner = boat({ boatAI: { gunT: 0, flee: true, gaveUp: false } });
  driveBoatAI(runner, 1 / 60, { x: 0, z: 40 }, world);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].throttle, 1);
});
