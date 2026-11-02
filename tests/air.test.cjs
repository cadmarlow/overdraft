const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const A = loadModule(readFileSync(join(__dirname, '../js/air-physics.js'), 'utf8'));
const still = { x: 0, y: 0, z: 0 };
const keys = (o = {}) => ({ dive: 0, flare: 0, left: 0, right: 0, ...o });
const fly = (s, aim, k, seconds) => { const c = {}; for (let t = 0; t < seconds; t += 1 / 60) { A.suitControl(s, aim(s), k, c); A.stepSuit(s, c, still, 1 / 60); } return s; };
const along = (s) => ({ yaw: Math.atan2(s.vx, s.vz), pitch: -0.3 });
const glider = () => fly(A.openSuit({}, 0, 2000, 0, 0, -20, 20), (s) => ({ yaw: 0, pitch: -0.3 }), keys(), 20);

test('the wingsuit glides about three to one near 180 km/h', () => {
  const s = glider();
  const ratio = Math.hypot(s.vx, s.vz) / -s.vy;
  assert.ok(s.speed > 45 && s.speed < 56, `speed ${s.speed * 3.6} km/h`);
  assert.ok(ratio > 2.6 && ratio < 3.6, `glide ratio ${ratio}`);
});

test('diving buys speed and pulling up trades it back for height', () => {
  const s = fly(glider(), (q) => ({ yaw: 0, pitch: -1.2 }), keys({ dive: 1 }), 8);
  assert.ok(s.speed > 68, `dive ${s.speed * 3.6} km/h`);
  fly(s, () => ({ yaw: 0, pitch: 0.45 }), keys(), 3.5);
  assert.ok(s.vy > 0, `the swoop climbs (vy ${s.vy})`);
});

test('the suit turns towards where the player looks, and the way it banks', () => {
  const s = glider(), h0 = Math.atan2(s.vx, s.vz);
  fly(s, (q) => ({ yaw: h0 - Math.PI / 2, pitch: -0.3 }), keys(), 3);
  const turned = Math.atan2(s.vx, s.vz) - h0;
  assert.ok(turned < -0.9, `looking right turns right (${turned})`);
  const k = glider(), k0 = Math.atan2(k.vx, k.vz);
  fly(k, along, keys({ left: 1 }), 2);
  assert.ok(Math.atan2(k.vx, k.vz) - k0 > 0.6, 'Q turns left');
});

test('S pulls the suit up hard and never stalls it', () => {
  const s = fly(glider(), () => ({ yaw: 0, pitch: -0.3 }), keys(), 2);
  const before = s.vy;
  fly(s, () => ({ yaw: 0, pitch: -0.3 }), keys({ flare: 1 }), 1.2);
  assert.ok(s.vy > before + 8, `pulled up (vy ${before} -> ${s.vy})`);
  fly(s, () => ({ yaw: 0, pitch: 0.45 }), keys({ flare: 1 }), 12);
  assert.equal(s.stalled, false);
});

test('a body falling straight down glides off towards where it faces', () => {
  const s = A.openSuit({}, 0, 500, 0, 0, -10, 0);
  fly(s, () => ({ yaw: Math.PI / 2, pitch: -0.4 }), keys(), 4);
  assert.ok(s.vx > 8 && Math.abs(s.vz) < s.vx * 0.3, `forward along +x (vx ${s.vx}, vz ${s.vz})`);
  assert.ok(500 - s.y < 75, `it flies within 75 m (${500 - s.y})`);
});

test('touchdowns: slow lands, fast and flat rolls, steep or fast crashes', () => {
  assert.equal(A.suitTouchdown(15, -4, 0), 'land');
  assert.equal(A.suitTouchdown(30, -8, 0), 'roll');
  assert.equal(A.suitTouchdown(40, -12, 0), 'crash');
  assert.equal(A.suitTouchdown(10, -15, 0), 'crash');
});

const wing = () => A.openWing({}, 0, 300, 0, 0, 0, -5, 0);
const glide = (w, k, seconds, lift = 0) => { const c = {}; for (let t = 0; t < seconds; t += 1 / 60) { A.wingControl(w, { yaw: w.heading }, k, c); A.stepWing(w, c, still, lift, 1 / 60); } return w; };
const hands = (o = {}) => ({ left: 0, right: 0, brake: 0, bar: 0, ...o });

test('the paraglider: 45 km/h hands up, faster on the bar, a spiral on one brake', () => {
  const w = glide(wing(), hands(), 8);
  assert.ok(Math.abs(w.airspeed * 3.6 - 45) < 2 && w.vy < -2 && w.vy > -3.2, `trim ${w.airspeed * 3.6} km/h, ${w.vy} m/s`);
  const bar = glide({ ...w }, hands({ bar: 1 }), 6);
  assert.ok(bar.airspeed > w.airspeed + 3 && bar.vy < w.vy);
  const right = { ...w }, h0 = right.heading;
  glide(right, hands({ right: 1 }), 3);
  assert.ok(h0 - right.heading > 2, 'a full right brake turns hard right');
  assert.ok(right.bank > 0.4 && right.vy < -4, 'banked, and sinking fast');
});

test('the flare: brakes pulled from full speed hold the wing up for a moment', () => {
  const w = glide(wing(), hands({ bar: 1 }), 6);
  let best = -Infinity;
  for (let t = 0; t < 2; t += 1 / 60) { glide(w, hands({ brake: 1 }), 1 / 60); best = Math.max(best, w.vy); }
  assert.ok(best > -0.8, `best sink in the flare ${best}`);
});

test('rising air lifts the wing; the wind carries it', () => {
  const up = glide(wing(), hands(), 6, 3.2);
  assert.ok(up.vy > 0, 'it climbs in 3.2 m/s of lift');
  const w = wing(), c = {};
  for (let t = 0; t < 4; t += 1 / 60) { A.wingControl(w, { yaw: 0 }, hands(), c); A.stepWing(w, c, { x: 5, y: 0, z: 0 }, 0, 1 / 60); }
  assert.ok(w.x > 15, 'drifted downwind');
});

test('wind runs up a facade it meets, and sinks behind a taller building', () => {
  const face = (x, y, z, dx) => (dx > 0.5 ? { d: 15, top: 120 } : { d: Infinity, top: 0 });
  assert.ok(A.buildingLift(0, 60, 0, { x: 6, y: 0, z: 0 }, face) > 2.5);
  assert.equal(A.buildingLift(0, 200, 0, { x: 6, y: 0, z: 0 }, face), 0, 'far above the roof, nothing');
  const lee = (x, y, z, dx) => (dx < -0.5 ? { d: 20, top: 150 } : { d: Infinity, top: 0 });
  assert.ok(A.buildingLift(0, 60, 0, { x: 6, y: 0, z: 0 }, lee) < 0);
});

test('the wind blows harder up high and keeps to its weather', () => {
  const wind = new A.Wind(3), low = {}, high = {};
  for (let i = 0; i < 600; i++) wind.update(1, 'storm');
  wind.at(0, 0, 0, low); wind.at(0, 250, 0, high);
  assert.ok(Math.hypot(high.x, high.z) > Math.hypot(low.x, low.z) * 1.5);
  assert.ok(Math.hypot(low.x, low.z) > 4);
});
