import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { TRAFFIC_LEVELS, readTrafficDensity, saveTrafficDensity, trafficSubset, resizeHighwayTraffic } from '../js/traffic-density.js';

test('traffic preferences preserve the original density by default and tolerate unavailable storage', () => {
  let stored = null;
  globalThis.localStorage = { getItem: () => stored, setItem(key, value) { assert.equal(key, 'overdraft:traffic'); stored = value; } };
  try {
    assert.equal(readTrafficDensity(), 'high');
    for (const id of Object.keys(TRAFFIC_LEVELS)) { saveTrafficDensity(id); assert.equal(readTrafficDensity(), id); }
    saveTrafficDensity('invalid'); assert.equal(stored, 'high');
    stored = 'corrupt'; assert.equal(readTrafficDensity(), 'high');
    globalThis.localStorage = { getItem() { throw Error('denied'); }, setItem() { throw Error('full'); } };
    assert.equal(readTrafficDensity(), 'high');
    assert.doesNotThrow(() => saveTrafficDensity('none'));
  } finally { delete globalThis.localStorage; }
});

test('all levels reduce the actual simulation pool, with nested selections and buses included', () => {
  const pool = Array.from({ length: 200 }, (_, i) => ({ i }));
  const expected = { none: 0, low: 50, medium: 100, high: 200 };
  for (const [id, profile] of Object.entries(TRAFFIC_LEVELS)) {
    const subset = trafficSubset(pool, profile.scale);
    assert.equal(subset.length, expected[id]);
    assert.equal(trafficSubset(pool.slice(0, 20), profile.scale).length, expected[id] / 10);
    assert.equal(new Set(subset).size, subset.length);
  }
  assert.ok(trafficSubset(pool, 0.25).every(car => trafficSubset(pool, 0.5).includes(car)));
});

function highwayLane() {
  const pool = Array.from({ length: 40 }, (_, i) => ({ u: i * 50, len: 4 + i % 3, placed: true, seg: 0, v: 12 }));
  return { cars: [...pool], carPool: pool, len: 2000, cum: [0, 1000, 2000], speedProfile: [12, 8],
    pts: [{ x: 0, z: 0 }, { x: 1000, z: 0 }, { x: 2000, z: 0 }] };
}

test('enabling highway traffic leaves space around the player instead of spawning on their car', () => {
  const lane = highwayLane();
  resizeHighwayTraffic(lane, 0);
  resizeHighwayTraffic(lane, 1, { x: 1000, z: 0 });
  assert.ok(lane.cars.length >= 38);
  assert.ok(lane.cars.every(car => Math.abs(car.u - 1000) >= 30));
});

test('highway changes preserve survivors and array references, mute removed cars and leave no ghost leaders', () => {
  const lane = highwayLane(), reference = lane.cars;
  resizeHighwayTraffic(lane, 0.25);
  assert.equal(lane.cars, reference);
  assert.equal(lane.cars.length, 10);
  assert.ok(lane.cars.every((car, i) => car.u === i * 200));
  assert.ok(lane.carPool.filter(car => !lane.cars.includes(car)).every(car => !car.placed));
  const survivors = new Map(lane.cars.map(car => [car, car.u]));
  // Dormant positions are deliberately occupied now: reactivation must find new gaps.
  for (const car of lane.carPool) if (!survivors.has(car)) car.u = 0;
  resizeHighwayTraffic(lane, 1);
  assert.equal(lane.cars.length, 40);
  for (const [car, u] of survivors) assert.equal(car.u, u);
  for (let i = 0; i < lane.cars.length; i++) {
    const a = lane.cars[i], b = lane.cars[(i + 1) % lane.cars.length];
    const gap = b.u - a.u + (i === lane.cars.length - 1 ? lane.len : 0) - (a.len + b.len) / 2;
    assert.ok(gap > 8, `safe following gap: ${gap}`);
  }
  resizeHighwayTraffic(lane, 0);
  assert.equal(reference.length, 0);
  assert.ok(lane.carPool.every(car => !car.placed));
});

test('repeated highway disable/enable cycles reuse the pool with finite, ordered, reset vehicle states', () => {
  const lane = highwayLane();
  for (let cycle = 0; cycle < 4; cycle++) {
    resizeHighwayTraffic(lane, 0);
    for (const car of lane.carPool) Object.assign(car, { hidden: 30, stunned: 9, ox: 12, kvx: 7 });
    for (const scale of [0.25, 0.5, 1]) {
      resizeHighwayTraffic(lane, scale);
      assert.equal(lane.cars.length, 40 * scale);
      for (let i = 0; i < lane.cars.length; i++) {
        const car = lane.cars[i];
        assert.ok(car.u >= 0 && car.u < lane.len);
        assert.ok(i === 0 || lane.cars[i - 1].u < car.u);
        assert.equal(car.v, lane.speedProfile[car.seg]);
        for (const key of ['hidden', 'stunned', 'ox', 'kvx']) assert.equal(car[key], 0);
      }
    }
  }
});

test('street density releases crossing reservations and service jobs without touching independent vehicles', () => {
  const source = readFileSync(new URL('../js/traffic.js', import.meta.url), 'utf8');
  const setter = source.match(/  function setDensity\(id\) \{[^]*?\n  \}/)[0];
  const cars = Array.from({ length: 200 }, () => ({ edge: {}, conn: {}, move: {}, claimed: true, serving: {}, hazard: true }));
  const buses = Array.from({ length: 20 }, () => ({ edge: {}, claimed: true, serving: {} }));
  const vehicles = [...cars, ...buses], ref = vehicles;
  const extraBodies = [{ player: true }, { pursuit: true }];
  let occupancyUpdates = 0;
  const ctx = { density: 'high', vehicleCursor: 219, TRAFFIC_LEVELS, trafficSubset, vehicles, cars, buses,
    vehiclePool: [...vehicles], extraBodies,
    removeVehicle(v) { v.edge = v.conn = v.move = null; }, buildOccupancy() { occupancyUpdates++; } };
  const setDensity = vm.runInNewContext(`(${setter.trim()})`, ctx);
  setDensity('low');
  assert.equal(vehicles, ref); assert.equal(vehicles.length, 55); assert.equal(ctx.vehicleCursor, 0);
  assert.ok(cars.filter(car => !vehicles.includes(car)).every(car => !car.edge && !car.claimed && !car.serving && !car.hazard));
  setDensity('none'); assert.equal(vehicles.length, 0);
  assert.ok([...cars, ...buses].every(car => !car.edge));
  setDensity('none'); setDensity('invalid'); assert.equal(occupancyUpdates, 2);
  setDensity('medium'); assert.equal(vehicles.length, 110);
  setDensity('high'); assert.equal(vehicles.length, 220);
  assert.deepEqual(extraBodies, [{ player: true }, { pursuit: true }]);
});
