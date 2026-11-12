import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import * as plan from '../js/wasteland-plan.js';
import { crossingHeld, crossingStops, gapToStopLine } from '../js/highway-driving.js';
import { loadModule } from './helpers/module.cjs';

// The second wave of the Wasteland: the ships the water left on the bed (js/wasteland-wrecks.js) and the level
// crossing where the road of the western gate cuts across the West Side Highway (js/highway-driving.js).

const { WEST_GATE, insideCity, saltLandAt, saltRoadAt, sampleSalt } = plan;
const surfaces = plan.createFrontierSurfaces();

// What mergeGeometries does for the hulls: the positions end to end (nothing here needs the other attributes)
function mergeGeometries(list) {
  const flat = list.flatMap(g => Array.from((g.index ? g.toNonIndexed() : g).attributes.position.array));
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
  return merged;
}
const wrecks = loadModule(readFileSync(new URL('../js/wasteland-wrecks.js', import.meta.url), 'utf8'), {
  imports: { 'three/webgpu': THREE, 'three/addons/utils/BufferGeometryUtils.js': { mergeGeometries }, './wasteland-plan.js': plan },
  globals: { Float32Array, Math }, filename: 'wasteland-wrecks.js'
});

test('every hull lies on dry ground outside the city, clear of the roads and of the other hulls', () => {
  const { FLEET, KINDS } = wrecks;
  assert.ok(FLEET.length >= 12);
  const road = {};
  for (const spec of FLEET) {
    const { L, B } = KINDS[spec.kind], cs = Math.cos(spec.yaw), sn = Math.sin(spec.yaw);
    for (const t of [-0.5, -0.25, 0, 0.25, 0.5]) {
      const x = spec.x + t * L * cs, z = spec.z - t * L * sn;
      assert.ok(saltLandAt(x, z) && !surfaces.wetAt(x, z) && !insideCity(x, z), `${spec.kind} at ${spec.x}, ${spec.z}: ${t} of its length is not dry ground`);
      if (saltRoadAt(x, z, road)) assert.ok(road.distance > road.half + B / 2, `${spec.kind} at ${spec.x}, ${spec.z} lies across ${road.kind}`);
    }
  }
  for (let i = 0; i < FLEET.length; i++) for (let j = i + 1; j < FLEET.length; j++) {
    const a = FLEET[i], b = FLEET[j], gap = Math.hypot(a.x - b.x, a.z - b.z);
    assert.ok(gap > (KINDS[a.kind].B + KINDS[b.kind].B) / 2 + 12, `${a.kind} and ${b.kind} at ${gap.toFixed(0)} m`);
  }
});

// Is the point (x, z) at height y inside one of these colliders?
const inside = (colliders, x, y, z) => colliders.some(c => {
  if (y < c.minY || y > c.maxY) return false;
  const { cx, cz, cs, sn, hx, hz } = c.obb, dx = x - cx, dz = z - cz;
  return Math.abs(dx * cs - dz * sn) < hx && Math.abs(dx * sn + dz * cs) < hz;
});
const at = (spec, u, s) => { const cs = Math.cos(spec.yaw), sn = Math.sin(spec.yaw); return [spec.x + u * cs + s * sn, spec.z - u * sn + s * cs]; };

test('a hull is sunk into the bed, stands well above it and stops a car', () => {
  const { FLEET, KINDS, wreck } = wrecks;
  for (const spec of FLEET) {
    const { geometry, colliders } = wreck(spec), kind = KINDS[spec.kind], bed = sampleSalt(spec.x, spec.z);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    assert.ok(box.min.y < bed - 0.3, `${spec.kind}: keel at ${box.min.y.toFixed(1)}, bed at ${bed.toFixed(1)}`);
    assert.ok(box.max.y > bed + kind.D * 0.6, `${spec.kind} stands ${(box.max.y - bed).toFixed(1)} m`);
    assert.ok(Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) > kind.L * 0.85, 'all of its length is there, broken or not');
    assert.ok(colliders.length >= 4);
    for (const c of colliders) {
      assert.ok(c.minX < c.maxX && c.minZ < c.maxZ && c.maxY > bed + 2, spec.kind);
      assert.ok(Math.abs(Math.hypot(c.obb.cs, c.obb.sn) - 1) < 1e-9);
      assert.ok(Math.hypot(c.obb.cx - spec.x, c.obb.cz - spec.z) < kind.L / 2 + kind.B);
    }
    // bow and stern stop a car whatever she is
    for (const t of [0.08, 0.93]) { const [x, z] = at(spec, (t - 0.5) * kind.L, 0); assert.ok(inside(colliders, x, bed + 1, z), `${spec.kind} at ${t}`); }
  }
});

test('a ship with her back broken leaves a way through between the two halves', () => {
  const { FLEET, KINDS, wreck } = wrecks;
  const broken = FLEET.filter(s => s.broken && (s.gap ?? 0) >= 12);
  assert.ok(broken.length >= 2);
  for (const spec of broken) {
    const kind = KINDS[spec.kind], { colliders } = wreck(spec), bed = sampleSalt(spec.x, spec.z);
    for (const s of [-kind.B * 0.4, 0, kind.B * 0.4]) {
      const [x, z] = at(spec, (spec.broken - 0.5) * kind.L, s);
      assert.equal(inside(colliders, x, bed + 1, z), false, `${spec.kind}: the break is closed at ${s}`);
    }
    const [x, z] = at(spec, (spec.broken - 0.5) * kind.L + spec.gap / 2 + 6, 0);
    assert.ok(inside(colliders, x, bed + 1, z), 'and each half is solid right behind its break');
  }
});

test('a hold is entered through its door at ground level, walled all round and decked over', () => {
  const { FLEET, KINDS, wreck } = wrecks;
  const holds = FLEET.filter(s => s.hold);
  assert.equal(holds.length, 3);
  for (const spec of holds) {
    const kind = KINDS[spec.kind], { L, B, D } = kind, built = wreck(spec), { colliders } = built, bed = sampleSalt(spec.x, spec.z);
    const [h0, h1] = spec.hold, [d0, d1, side] = spec.door, sink = spec.sink;
    assert.ok(!spec.broken && Math.abs(spec.roll) < 0.08, 'she sits upright enough to walk in');
    assert.ok(sink >= D * 0.15, 'the sill of the door is at or under the ground');
    assert.ok(D * 0.45 - sink > 3, `a car goes under the lintel: ${(D * 0.45 - sink).toFixed(1)} m`);
    assert.ok((d1 - d0) * L > 9, 'and through the width of it');
    const u = ((d0 + d1) / 2 - 0.5) * L;
    for (const s of [B / 2 + 3, B / 2 - 0.5, B / 2 - 4]) { const [x, z] = at(spec, u, side * s); assert.equal(inside(colliders, x, bed + 1, z), false, `door blocked ${s} m from the centre line`); }
    const [wx, wz] = at(spec, u, -side * (B / 2 - 0.5));
    assert.ok(inside(colliders, wx, bed + 1, wz), 'the far side is plated');
    for (const t of [h0 + 0.04, (h0 + h1) / 2, h1 - 0.04]) {
      const [x, z] = at(spec, (t - 0.5) * L, 0);
      assert.equal(inside(colliders, x, bed + 1, z), false, 'the floor of the hold is clear');
      assert.ok(inside(colliders, x, bed - sink + D - 0.2, z), 'and the deck above carries a body');
    }
    for (const t of [h0 - 0.03, h1 + 0.03]) { const [x, z] = at(spec, (t - 0.5) * L, 0); assert.ok(inside(colliders, x, bed + 1, z), 'a bulkhead closes each end'); }
    // the crew's fire burns inside, by the door
    assert.equal(built.fires.length, 1);
    const [fx, , fz] = built.fires[0];
    assert.equal(inside(colliders, fx, bed + 1, fz), false);
    assert.ok(Math.hypot(fx - spec.x, fz - spec.z) < L / 2 && built.props.length > 8);
    for (const prop of built.props) assert.equal(inside(colliders, prop.x, bed + 0.5, prop.z), false, `${prop.name} is in a wall`);
  }
});

// Two carriageways along z, as the West Side Highway by the gate: one lane each way, one underground, one far away
function lane(x, z0, z1, y = 0) {
  const pts = [], cum = [];
  const n = 50;
  for (let i = 0; i <= n; i++) { pts.push({ x, y, z: z0 + (z1 - z0) * i / n }); cum.push(Math.abs(z1 - z0) * i / n); }
  return { pts, cum, len: Math.abs(z1 - z0) };
}

test('each lane through the crossing gets a stop line short of it, in its own direction of travel', () => {
  const south = lane(40, 0, 1000), north = lane(50, 1000, 0), tunnel = lane(45, 0, 1000, -4.5), elsewhere = lane(400, 0, 1000), short = lane(40, 0, 300);
  const stops = crossingStops([south, north, tunnel, elsewhere, short], { x: 0, z: 500, half: 14 });
  assert.deepEqual(stops.map(s => s.lane), [south, north]);
  for (const stop of stops) assert.ok(Math.abs(stop.u - (500 - 17)) < 1e-9, `stop line at ${stop.u}`);
  // on the real gate: the default reach covers the park between the seawall and the carriageway
  assert.equal(crossingStops([lane(WEST_GATE.x + 38, 0, 2000), lane(WEST_GATE.x + 50, 2000, 0)], WEST_GATE).length, 2);
});

test('the crossing is held for a body on the gate road, from far enough for the traffic to stop', () => {
  const gate = { x: 0, z: 500 };
  assert.equal(crossingHeld(gate, null), false);
  assert.ok(crossingHeld(gate, { x: 45, y: 0.4, z: 500 }), 'on the carriageway');
  assert.ok(crossingHeld(gate, { x: 160, y: 0.4, z: 503 }), 'coming down the street');
  assert.ok(crossingHeld(gate, { x: -70, y: -4.2, z: 498 }), 'coming up the ramp from the bed');
  assert.equal(crossingHeld(gate, { x: 45, y: 0.4, z: 540 }), false, 'driving along the highway');
  assert.equal(crossingHeld(gate, { x: 400, y: 0.4, z: 500 }), false);
  assert.equal(crossingHeld(gate, { x: 45, y: 60, z: 500 }), false, 'flying over');
  // a highway car at 17.5 m/s braking at 9 m/s² stops in 17 m: the player is seen from farther than they cover meanwhile
  const stopping = 17.5 ** 2 / (2 * 9), seen = 170 - 55; // the carriageway lies up to 55 m east of the gate
  assert.ok(seen / 45 > 17.5 / 9, `${seen} m of warning at 160 km/h, ${stopping.toFixed(0)} m to stop`);
});

test('a car short of a held line stops at it; one already over it, or following a nearer leader, carries on', () => {
  const s0 = 2;
  assert.ok(Math.abs(gapToStopLine(483, 400, 4.6, Infinity, s0) - (83 - 2.3 + s0)) < 1e-9);
  assert.equal(gapToStopLine(483, 400, 4.6, 30, s0), 30, 'its own leader is nearer');
  assert.equal(gapToStopLine(483, 490, 4.6, 120, s0), 120, 'over the line: it clears the crossing');
  assert.ok(gapToStopLine(483, 481, 4.6, 120, s0) < s0 + 0.01, 'at the line: it stays');
  // integrated with the same car-following law as the highway, a car comes to rest with its nose at the line
  const D = { a: 1.6, b: 2.6, T: 1.1, s0 }, brake = 2 * Math.sqrt(D.a * D.b);
  let u = 300, v = 17.5;
  for (let step = 0; step < 60 * 40; step++) {
    const gap = gapToStopLine(483, u, 4.6, Infinity, D.s0), dv = gap === Infinity ? 0 : v;
    const sStar = D.s0 + Math.max(0, v * D.T + (v * dv) / brake);
    v = Math.max(0, v + Math.max(-9, D.a * (1 - (v / 17.5) ** 4 - (sStar / Math.max(gap, 0.1)) ** 2)) / 60);
    u += v / 60;
  }
  assert.ok(v < 0.2 && u + 2.3 < 483 + 1.5 && u + 2.3 > 483 - 4, `stopped at ${u.toFixed(1)} going ${v.toFixed(2)}`);
});
