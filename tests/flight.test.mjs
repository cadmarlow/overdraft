import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRCRAFT, attitude, createFlight, liftCoefficient, makeTune, placeAircraft, restAttitude, setGear, stepAircraft } from '../js/flight.js';

const KINDS = Object.keys(AIRCRAFT);
const NONE = { pitch: 0, roll: 0, yaw: 0, throttle: 0, boost: false, brake: false };
const world = (over = {}) => ({ ground: () => 0, water: () => false, waterLevel: -2.2, solid: () => false, gust: 0, ...over });
const craft = (kind, at) => placeAircraft({ position: { x: 0, y: 0, z: 0 }, flight: createFlight(kind) }, at);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Flies `seconds` at `hz`; `input` may be a function of (time, aircraft); returns every event seen
function fly(a, input, seconds, env = world(), hz = 60, each = null) {
  const dt = 1 / hz, events = [];
  for (let t = 0; t < seconds - 1e-9 && !a.crashed; t += dt) {
    stepAircraft(a, typeof input === 'function' ? input(t, a) : input, dt, env);
    for (const e of a.flight.events) events.push(e);
    each?.(t, a);
  }
  return events;
}

test('the two aircraft are different machines: a biplane that flies at a jog, a fighter that needs 200 km/h', () => {
  const c = makeTune('classic'), j = makeTune('jet');
  assert.ok(c.vStall * 3.6 > 60 && c.vStall * 3.6 < 90, `classic stalls at ${c.vStall * 3.6} km/h`);
  assert.ok(j.vStall * 3.6 > 180 && j.vStall * 3.6 < 220, `jet stalls at ${j.vStall * 3.6} km/h`);
  assert.ok(j.vCorner > c.vCorner * 2.5);
  assert.ok(j.gMax > c.gMax && j.rollRate > c.rollRate);
  assert.equal(c.engine, 'prop'); assert.equal(j.engine, 'jet');
  assert.ok(j.afterburner > j.thrust, 'the reheat is more than the dry thrust');
});

test('the wing lifts with its angle, lets go past the stall and still holds something flat-on', () => {
  for (const kind of KINDS) {
    const t = makeTune(kind);
    assert.ok(liftCoefficient(t, t.stall * 0.5, 0) > liftCoefficient(t, t.stall * 0.25, 0));
    const peak = liftCoefficient(t, t.stall, 0);
    assert.ok(Math.abs(peak - t.clMax) < 0.15, `${kind} peak ${peak} vs ${t.clMax}`);
    assert.ok(liftCoefficient(t, t.stall + 0.3, 0) < peak, 'less lift past the stall');
    assert.ok(liftCoefficient(t, Math.PI / 2, 0) < 0.2, 'none flat against the air');
    assert.ok(liftCoefficient(t, -0.2, 0) < 0, 'negative angle, negative lift');
  }
});

test('attitude and the planar fields agree: heading turns the nose towards +X, pitch lifts it, roll lowers the left wing', () => {
  const a = craft('classic', { y: 300, heading: 0.7, pitch: 0.3, roll: 0.5, speed: 40 });
  assert.ok(Math.abs(a.heading - 0.7) < 1e-6 && Math.abs(a.pitch - 0.3) < 1e-6 && Math.abs(a.roll - 0.5) < 1e-6);
  const r = a.flight.r;
  assert.ok(r[7] > 0, 'nose above the horizon');
  assert.ok(r[1] < 0, 'left wing down');
  assert.ok(Math.abs(r[6] - Math.sin(0.7) * Math.cos(0.3)) < 1e-6);
  assert.ok(Math.abs(Math.hypot(...attitude(1, 2, 3)) - 1) < 1e-9);
  assert.ok(Math.abs(a.speed - 40) < 1e-6);
});

test('hands off, each aircraft flies on: wings level, no stall, near the height it had', () => {
  for (const kind of KINDS) {
    const t = makeTune(kind), a = craft(kind, { y: 500, speed: t.vStall * 2, throttle: 0.7 });
    fly(a, NONE, 30);
    assert.equal(a.crashed, false);
    assert.ok(Math.abs(a.roll) < 0.02, `${kind} roll ${a.roll}`);
    assert.ok(Math.abs(a.position.y - 500) < 260, `${kind} height ${a.position.y}`);
    assert.ok(a.flight.airspeed > t.vStall * 1.3, `${kind} speed ${a.flight.airspeed}`);
    assert.ok(Math.abs(a.flight.g - 1) < 0.15, `${kind} g ${a.flight.g}`);
  }
});

test('rolling left rolls left; let go, the wings come back level; on its back it rights itself', () => {
  for (const kind of KINDS) {
    const t = makeTune(kind), a = craft(kind, { y: 800, speed: t.vStall * 2, throttle: 0.7 });
    fly(a, { ...NONE, roll: 1 }, 0.4);
    assert.ok(a.roll > 0.3, `${kind} banked ${a.roll}`);
    fly(a, NONE, 4);
    assert.ok(Math.abs(a.roll) < 0.12, `${kind} levelled ${a.roll}`);
    const b = craft(kind, { y: 800, speed: t.vStall * 2, throttle: 0.7, roll: Math.PI });
    fly(b, NONE, 6);
    assert.ok(Math.abs(b.roll) < 0.2 && b.flight.r[4] > 0.9, `${kind} upright again (${b.roll})`);
    assert.equal(b.crashed, false);
  }
});

test('a held roll goes all the way round, the fighter twice as fast', () => {
  const turned = {};
  for (const kind of KINDS) {
    const t = makeTune(kind), a = craft(kind, { y: 800, speed: t.vCorner, throttle: 1 });
    let total = 0, last = a.roll;
    fly(a, { ...NONE, roll: 1 }, 2, world(), 60, (_, p) => { total += Math.abs(wrap(p.roll - last)); last = p.roll; });
    turned[kind] = total;
    assert.ok(total > Math.PI, `${kind} rolled ${total}`);
  }
  assert.ok(turned.jet > turned.classic * 1.5);
});

test('pulling turns the path up to the g limit and never past the stall; the biplane turns far tighter', () => {
  const rate = {};
  for (const kind of KINDS) {
    const t = makeTune(kind), a = craft(kind, { y: 1500, speed: t.vCorner, throttle: 1 });
    let peak = 0, alpha = 0, heading = a.heading, total = 0;
    fly(a, (_, p) => ({ ...NONE, roll: clamp((1.35 - p.roll) * 3, -1, 1), pitch: p.roll > 0.8 ? 1 : 0, boost: true }), 8, world(), 60, (_, p) => {
      peak = Math.max(peak, p.flight.g); alpha = Math.max(alpha, p.flight.alpha);
      total += wrap(p.heading - heading); heading = p.heading;
    });
    assert.ok(peak > t.gMax * 0.8 && peak < t.gMax * 1.1, `${kind} peak ${peak} g`);
    assert.ok(alpha < t.stall, `${kind} alpha ${alpha} under the stall ${t.stall}`);
    assert.ok(total > 0, 'a left bank turns left');
    rate[kind] = total / 8;
    assert.equal(a.crashed, false);
  }
  assert.ok(rate.classic > 0.7, `classic ${rate.classic} rad/s`);
  assert.ok(rate.jet > 0.35 && rate.jet < rate.classic, `jet ${rate.jet} rad/s`);
});

test('the stick held back closes a loop, the fighter needing six times the sky', () => {
  const height = {};
  for (const kind of KINDS) {
    const t = makeTune(kind), a = craft(kind, { y: 600, speed: t.vCorner * 1.05, throttle: 1 });
    let top = 0, inverted = false, closed = null;
    fly(a, { ...NONE, pitch: 1, boost: true }, 30, world(), 60, (time, p) => {
      top = Math.max(top, p.position.y);
      if (p.flight.r[4] < -0.5) inverted = true;
      if (inverted && closed === null && p.flight.r[4] > 0.9 && Math.abs(p.pitch) < 0.25) closed = time;
    });
    assert.ok(closed !== null, `${kind} closed its loop`);
    height[kind] = top - 600;
    assert.equal(a.crashed, false);
  }
  assert.ok(height.classic > 50 && height.classic < 200, `classic loop ${height.classic} m`);
  assert.ok(height.jet > height.classic * 4, `jet loop ${height.jet} m`);
});

test('too slow, the wing stops flying: it warns, sinks, lowers its nose, and flies again', () => {
  for (const kind of KINDS) {
    const t = makeTune(kind), a = craft(kind, { y: 1200, speed: t.vStall * 1.5, throttle: 0 });
    let warned = false, slowest = 1e9, lowestNose = 1;
    fly(a, { ...NONE, pitch: 1, throttle: -1 }, 16, world(), 60, (_, p) => {
      warned ||= p.flight.stall > 0.5; slowest = Math.min(slowest, p.flight.airspeed); lowestNose = Math.min(lowestNose, p.pitch);
    });
    assert.ok(warned, `${kind} warned of the stall`);
    assert.ok(slowest < t.vStall * 1.05, `${kind} slowed to ${slowest}`);
    assert.ok(a.position.y < 1200, 'it lost height');
    assert.equal(a.crashed, false);
    assert.ok(Number.isFinite(a.position.y + a.flight.airspeed));
  }
});

test('left alone in a dive it eases out; straight up with no speed left it falls, turns over and flies away', () => {
  for (const kind of KINDS) {
    const t = makeTune(kind);
    const dive = craft(kind, { y: 1500, speed: t.vCorner, throttle: 0.5, pitch: -0.7 });
    fly(dive, NONE, 14);
    assert.ok(dive.pitch > -0.25, `${kind} dive eased to ${dive.pitch}`);
    assert.equal(dive.crashed, false);
    const zoom = craft(kind, { y: 400, speed: t.vCorner, throttle: 1, pitch: Math.PI / 2 - 0.02 });
    fly(zoom, NONE, 45);
    assert.equal(zoom.crashed, false, `${kind} recovered from the zoom`);
    assert.ok(zoom.flight.airspeed > t.vStall, 'flying again');
    assert.ok(zoom.flight.r[4] > 0.5, 'the right way up');
  }
});

test('the rudder alone flies a gentle banked turn and gives the wings back', () => {
  for (const kind of KINDS) {
    const t = makeTune(kind), a = craft(kind, { y: 800, speed: t.vStall * 2, throttle: 0.7 });
    let heading = a.heading, total = 0;
    fly(a, { ...NONE, yaw: 1 }, 8, world(), 60, (_, p) => { total += wrap(p.heading - heading); heading = p.heading; });
    assert.ok(total > 0.5, `${kind} turned left ${total}`);
    assert.ok(a.roll > 0.4 && a.roll < 1.1, `${kind} banked ${a.roll}`);
    assert.ok(Math.abs(a.position.y - 800) < 90, `${kind} kept its height (${a.position.y})`);
    fly(a, NONE, 4);
    assert.ok(Math.abs(a.roll) < 0.1);
  }
});

test('energy: a climb costs speed, a dive buys it back, a hard turn bleeds it', () => {
  for (const kind of KINDS) {
    const t = makeTune(kind);
    const climb = craft(kind, { y: 500, speed: t.vStall * 2.5, throttle: 0.3, pitch: 0.6 });
    fly(climb, NONE, 4);
    assert.ok(climb.flight.airspeed < t.vStall * 2.5 - 3, `${kind} slowed in the climb`);
    const dive = craft(kind, { y: 3000, speed: t.vStall * 2, throttle: 0.3, pitch: -0.6 });
    fly(dive, { ...NONE, pitch: -0.15 }, 4);
    assert.ok(dive.flight.airspeed > t.vStall * 2 + 5, `${kind} gained in the dive`);
  }
  const jet = craft('jet', { y: 2000, speed: 160, throttle: 0.6 });
  fly(jet, (_, p) => ({ ...NONE, roll: clamp((1.3 - p.roll) * 3, -1, 1), pitch: p.roll > 0.8 ? 1 : 0 }), 8);
  assert.ok(jet.flight.airspeed < 135, `the jet bled to ${jet.flight.airspeed}`);
});

test('the reheat takes the fighter through the sound barrier, once, with a bang; shut, it comes back down', () => {
  const a = craft('jet', { y: 1500, speed: 200, throttle: 1 });
  const events = fly(a, { ...NONE, boost: true }, 40);
  assert.equal(events.filter((e) => e.type === 'boom').length, 1);
  assert.ok(a.flight.mach > 1 && a.flight.mach < 1.4, `mach ${a.flight.mach}`);
  assert.ok(a.flight.ab > 0.9);
  const dry = craft('jet', { y: 1500, speed: 200, throttle: 1 });
  fly(dry, NONE, 60);
  assert.ok(dry.flight.mach < 0.75, `dry top ${dry.flight.airspeed} m/s`);
  assert.equal(dry.flight.ab, 0);
  const after = fly(a, { ...NONE, throttle: -1 }, 30);
  assert.ok(after.some((e) => e.type === 'subsonic'));
  // the biplane has no reheat: the same key is only full power
  const c = craft('classic', { y: 500, speed: 40, throttle: 0.2 });
  fly(c, { ...NONE, boost: true }, 3);
  assert.equal(c.flight.ab, 0);
  assert.ok(c.flight.throttle > 0.95);
});

test('standing on its wheels it stays where it is parked, the tail-dragger nose high', () => {
  for (const kind of KINDS) {
    const t = makeTune(kind), a = craft(kind, { y: 0, throttle: 0, onGround: true });
    fly(a, NONE, 10);
    assert.equal(a.onGround, true);
    assert.ok(Math.hypot(a.position.x, a.position.z) < 1.5, `${kind} crept ${Math.hypot(a.position.x, a.position.z)} m`);
    const rest = restAttitude(t);
    assert.ok(Math.abs(a.pitch - rest.pitch) < 0.04, `${kind} sits at ${a.pitch}, expected ${rest.pitch}`);
    assert.ok(Math.abs(a.position.y - rest.height) < 0.15, `${kind} stands ${a.position.y} high`);
    assert.equal(a.crashed, false);
    assert.ok(a.flight.wheels.every((w) => w.load > 0), 'all three wheels carry it');
  }
  assert.ok(restAttitude(makeTune('classic')).pitch > 0.1);
  assert.ok(Math.abs(restAttitude(makeTune('jet')).pitch) < 0.02);
});

test('full throttle and nothing else: it runs, lifts off and climbs away; the fighter tucks its wheels up', () => {
  for (const kind of KINDS) {
    const t = makeTune(kind), a = craft(kind, { y: 0, throttle: 0, onGround: true });
    fly(a, NONE, 1);
    let off = null, run = 0;
    const events = fly(a, { ...NONE, throttle: 1, boost: !!t.afterburner }, 35, world(), 60, (time, p) => {
      if (off === null && !p.onGround && p.flight.agl > 3) { off = time; run = Math.hypot(p.position.x, p.position.z); }
    });
    assert.ok(off !== null && off < 15, `${kind} left the ground at ${off} s`);
    assert.ok(run < (kind === 'jet' ? 450 : 220), `${kind} ran ${run} m`);
    assert.ok(a.position.y > 80, `${kind} climbed to ${a.position.y}`);
    assert.equal(a.crashed, false);
    assert.ok(events.some((e) => e.type === 'airborne'));
    if (t.gearTime) { assert.ok(events.some((e) => e.type === 'gearUp')); assert.equal(a.flight.gear, 0); }
    else assert.equal(a.flight.gear, 1);
  }
});

test('on the ground the rudder steers and the brakes stop it', () => {
  for (const kind of KINDS) {
    const a = craft(kind, { y: 0, throttle: 0, onGround: true });
    fly(a, NONE, 1);
    fly(a, { ...NONE, throttle: 1 }, 1.2);
    fly(a, { ...NONE, yaw: 1 }, 5);
    assert.ok(wrap(a.heading) > 0.4, `${kind} turned left to ${a.heading}`);
    assert.equal(a.crashed, false);
    assert.ok(Math.abs(a.roll) < 0.2, 'it did not tip over');
    fly(a, { ...NONE, throttle: -1, brake: true }, 14);
    assert.ok(a.flight.airspeed < 0.6, `${kind} stopped (${a.flight.airspeed})`);
  }
});

// A small autopilot standing in for a pilot's hands on the approach
const approach = (t) => (_, p) => {
  const b = p.flight;
  if (p.onGround) return { ...NONE, throttle: -1, brake: true };
  const sink = b.agl > 15 ? -4 : -1 - b.agl * 0.2;
  return { ...NONE, pitch: clamp((sink - p.verticalSpeed) * 0.25, -0.6, 1), throttle: clamp((t.vStallLanding * 1.3 - b.airspeed) * 0.5, -1, 1) };
};

test('a flared approach lands, rolls out and stops; a dropped one breaks the gear; a dive is the end', () => {
  for (const kind of KINDS) {
    const t = makeTune(kind);
    const a = craft(kind, { y: 60, speed: t.vStallLanding * 1.4, throttle: 0.25, pitch: -0.05 });
    if (t.gearTime) { setGear(a, 1); a.flight.gear = 1; }
    const events = fly(a, approach(t), 90);
    assert.equal(a.crashed, false, `${kind} landed`);
    assert.equal(a.onGround, true);
    assert.ok(a.flight.airspeed < 0.6, `${kind} stopped`);
    const first = events.find((e) => e.type === 'touchdown');
    assert.ok(first && first.sink < 3, `${kind} touched at ${first?.sink} m/s`);
    assert.ok(events.some((e) => e.type === 'landed'));
    assert.equal(a.flight.damage.gear, 0);

    const hard = craft(kind, { y: restAttitude(t).height + 2.5, speed: t.vStallLanding * 1.25, throttle: 0, pitch: 0.02 });
    if (t.gearTime) { setGear(hard, 1); hard.flight.gear = 1; }
    hard.flight.vy = -(t.gearSink + 2.5);
    const dropped = fly(hard, { ...NONE, throttle: -1 }, 4);
    assert.ok(dropped.some((e) => e.type === 'gearCollapse') || hard.crashed, `${kind} hard landing broke something`);

    const dive = craft(kind, { y: 80, speed: t.vCorner, throttle: 0.5, pitch: -0.9 });
    const end = fly(dive, NONE, 4);
    assert.equal(dive.crashed, true);
    assert.equal(end.at(-1).type, 'crash');
    assert.equal(end.at(-1).cause, 'ground');
  }
});

test('wheels up, the fighter can be slid onto its belly and walked away from', () => {
  const t = makeTune('jet'), a = craft('jet', { y: 50, speed: t.vStallLanding * 1.4, throttle: 0.25, pitch: -0.05 });
  a.flight.gearHold = 600; // the pilot has put the lever up: the aircraft leaves it alone
  const events = fly(a, approach(t), 90);
  assert.equal(a.flight.gear, 0);
  assert.equal(a.crashed, false);
  assert.ok(events.some((e) => e.type === 'scrape' && e.kind === 'belly'));
  assert.ok(a.flight.airspeed < 1);
});

test('the undercarriage lever: not on the ground, not on a fixed gear, and the aircraft minds it by itself', () => {
  const parked = craft('jet', { y: 0, throttle: 0, onGround: true });
  fly(parked, NONE, 1);
  assert.equal(setGear(parked, 0), false, 'never retracted while standing on it');
  assert.equal(setGear(craft('classic', { y: 300, speed: 40 }), 0), false, 'the biplane has no lever');
  // slow, low and throttled back, it comes down on its own
  const t = makeTune('jet'), low = craft('jet', { y: 70, speed: t.vStall * 1.5, throttle: 0.3 });
  assert.equal(low.flight.gear, 0);
  const events = fly(low, NONE, 4);
  assert.ok(events.some((e) => e.type === 'gearDown'));
  assert.ok(low.flight.gear > 0.99);
  assert.ok(low.flight.flaps > 0.3, 'flaps with it');
});

test('the river: a flat, gentle arrival is a ditching and the aircraft floats; anything else breaks it up', () => {
  const river = world({ ground: () => -40, water: () => true });
  for (const kind of KINDS) {
    const t = makeTune(kind);
    const a = craft(kind, { y: 8, speed: t.vStall * 1.35, throttle: 0, pitch: 0.06 });
    if (t.gearTime) setGear(a, 0);
    const events = fly(a, (_, p) => ({ ...NONE, throttle: -1, pitch: clamp((-1.5 - p.verticalSpeed) * 0.3, -0.3, 1) }), 20, river);
    assert.equal(a.crashed, false, `${kind} ditched`);
    assert.equal(a.flight.ditched, true);
    assert.ok(events.some((e) => e.type === 'ditch'));
    assert.ok(a.flight.airspeed < 3, 'the water stopped it');
    assert.ok(a.position.y > river.waterLevel - 0.5 && a.position.y < river.waterLevel + 2.5, `afloat at ${a.position.y}`);
    assert.equal(a.flight.damage.engine, 1);
    const dive = craft(kind, { y: 60, speed: t.vCorner, throttle: 0.5, pitch: -0.7 });
    const end = fly(dive, NONE, 4, river);
    assert.equal(dive.crashed, true);
    assert.equal(end.at(-1).cause, 'water');
  }
});

test('a building: the nose into it is the end; a wing tip is lost and flown home; taxiing into it just stops', () => {
  for (const kind of KINDS) {
    const t = makeTune(kind);
    // a wall across the path, 60 m ahead
    const wall = world({ solid: (x, y, z, out) => { if (z < 60) return false; out.nx = 0; out.nz = -1; out.depth = z - 60; return true; } });
    const a = craft(kind, { y: 100, speed: t.vStall * 2, throttle: 0.7 });
    const events = fly(a, NONE, 4, wall);
    assert.equal(a.crashed, true);
    assert.equal(events.at(-1).cause, 'building');

    // a wall alongside that only the left wing tip reaches
    const tipX = t.hull.find((p) => p.kind === 'tipL').x;
    const side = world({ solid: (x, y, z, out) => { if (x < tipX - 0.4) return false; out.nx = -1; out.nz = 0; out.depth = x - (tipX - 0.4); return true; } });
    const b = craft(kind, { y: 100, speed: t.vStall * 2, throttle: 0.7 });
    const struck = fly(b, NONE, 0.5, side);
    assert.equal(b.crashed, false, `${kind} survived the wing strike`);
    assert.ok(struck.some((e) => e.type === 'strike' && e.kind === 'tipL'));
    assert.equal(b.flight.damage.wingL, 1);
    // it flies on, crooked, clear of the wall
    fly(b, { ...NONE, roll: -0.4 }, 3, world());
    assert.equal(b.crashed, false);
    assert.ok(b.flight.airspeed > t.vStall);

    const taxi = craft(kind, { y: 0, throttle: 0, onGround: true });
    fly(taxi, NONE, 1);
    const stop = world({ solid: (x, y, z, out) => { if (z < 12) return false; out.nx = 0; out.nz = -1; out.depth = z - 12; return true; } });
    const bumps = fly(taxi, (time) => ({ ...NONE, throttle: time < 0.8 ? 1 : 0 }), 8, stop);
    assert.equal(taxi.crashed, false, `${kind} taxied into the wall`);
    assert.ok(bumps.some((e) => e.type === 'bump'));
    assert.ok(taxi.position.z < 14);
  }
});

test('a dead engine makes a glider of it, not a stone', () => {
  for (const kind of KINDS) {
    const t = makeTune(kind), a = craft(kind, { y: 600, speed: t.vStall * 2, throttle: 0.8 });
    a.flight.damage.engine = 1;
    fly(a, NONE, 12);
    assert.equal(a.crashed, false);
    assert.ok(a.flight.power < 0.05, 'no power');
    assert.ok(a.position.y < 600 && a.position.y > 200, `${kind} glided down to ${a.position.y}`);
    assert.ok(a.flight.airspeed > t.vStall * 0.95, 'still flying');
  }
});

test('rough air shakes the biplane more than the fighter and never breaks the model', () => {
  const wobble = {};
  for (const kind of KINDS) {
    const t = makeTune(kind), a = craft(kind, { y: 500, speed: t.vStall * 2, throttle: 0.7 });
    let sum = 0, n = 0;
    fly(a, NONE, 20, world({ gust: 3, wind: (x, y, z, out) => { out.x = 4; out.y = 0; out.z = -2; return out; } }), 60, (_, p) => { sum += Math.abs(p.flight.g - 1); n++; });
    wobble[kind] = sum / n;
    assert.equal(a.crashed, false);
    assert.ok(Number.isFinite(a.position.x + a.position.y + a.position.z));
  }
  assert.ok(wobble.classic > wobble.jet, `classic ${wobble.classic} vs jet ${wobble.jet}`);
});

test('the same flight at 30, 60 and 144 frames a second ends in the same place', () => {
  for (const kind of KINDS) {
    const t = makeTune(kind), ends = [];
    for (const hz of [30, 60, 144]) {
      const a = craft(kind, { y: 800, speed: t.vCorner, throttle: 0.8 });
      // a climbing turn: a moderate bank, a firm pull, then hands off
      fly(a, (time) => ({ ...NONE, roll: time < 0.25 ? 1 : 0, pitch: time > 0.25 && time < 2.5 ? 0.6 : 0 }), 6, world(), hz);
      ends.push(a);
    }
    // within a twentieth of the distance flown
    const slack = Math.max(15, t.vCorner * 6 * 0.05);
    for (const a of ends.slice(1)) {
      assert.ok(Math.abs(a.position.y - ends[0].position.y) < slack, `${kind} height ${a.position.y} vs ${ends[0].position.y}`);
      assert.ok(Math.abs(a.flight.airspeed - ends[0].flight.airspeed) < 6, `${kind} speed`);
      assert.ok(Math.abs(wrap(a.heading - ends[0].heading)) < 0.25, `${kind} heading`);
    }
  }
});

test('placing an aircraft clears whatever happened to the last flight', () => {
  const a = craft('jet', { y: 300, speed: 150 });
  a.flight.damage.wingL = 1; a.flight.damage.engine = 1; a.flight.ditched = true; a.crashed = true;
  placeAircraft(a, { x: 10, y: 400, z: 20, heading: 1, speed: 160 });
  assert.equal(a.crashed, false);
  assert.deepEqual({ ...a.flight.damage }, { wingL: 0, wingR: 0, engine: 0, gear: 0 });
  assert.equal(a.flight.ditched, false);
  assert.equal(a.flight.gear, 0, 'in the air the fighter arrives clean');
  assert.equal(a.onGround, false);
  placeAircraft(a, { x: 0, y: 0, z: 0, onGround: true, throttle: 0 });
  assert.equal(a.flight.gear, 1);
  assert.ok(a.position.y > 1.5);
});
