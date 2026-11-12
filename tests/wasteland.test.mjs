import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCKS, CITY_BLOCKS, CITY_LANDMARKS, CITY_ROADS, MANHATTAN_COASTLINE, WATERFRONT_PIERS } from '../js/city-config.js';
import { CITY_RING, cityBoundsAt, cityContainsBox, insideCity } from '../js/city-frontier.js';
import {
  CROSSINGS, SALT_LINES, SALT_LOOP, SALT_MIN_X, SALT_MIN_Z, SALT_PLACES, SALT_STEP, SALT_TERRAIN, SALT_WATER,
  createFrontierSurfaces, routeThroughSalt, saltLandAt, saltLocation, saltVertex, sampleSalt
} from '../js/wasteland-plan.js';
import { ACT3, PLACES3, SALT_SPRINT } from '../js/missions-act3.js';

const surfaces = createFrontierSurfaces();
const area = ring => Math.abs(ring.reduce((sum, a, i) => {
  const b = ring[(i + 1) % ring.length];
  return sum + a.x * b.z - a.z * b.x;
}, 0)) / 2;

test('the playable city keeps the original scale with at least one third less urban ground', () => {
  assert.ok(area(CITY_RING) / area(MANHATTAN_COASTLINE) < 2 / 3);
  assert.ok(CITY_BLOCKS.length > 1600 && CITY_BLOCKS.length < BLOCKS.length * 2 / 3);
  for (const b of CITY_BLOCKS) assert.ok(cityContainsBox(b.minX, b.maxX, b.minZ, b.maxZ, 2));
  for (const r of CITY_ROADS) {
    assert.equal(r.highway, false);
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      assert.ok(insideCity((a.x + b.x) / 2, (a.z + b.z) / 2), r.name);
    }
  }
  for (const id of ['centralpark', 'timessquare', 'owtc', 'wallst', 'columbia']) assert.ok(CITY_LANDMARKS.some(p => p.id === id));
  for (const id of ['brooklynbr', 'queensborobr', 'east_river_park', 'asphalt', 'onu']) assert.ok(CITY_LANDMARKS.every(p => p.id !== id));
});

test('the relief has no water cells and every exterior surface supports a body', () => {
  const { header, height, zone } = SALT_TERRAIN;
  assert.equal(header.version, 3);
  assert.equal(height.length, header.w * header.h);
  assert.ok(header.low > header.min && header.high < header.min + header.range);
  assert.equal(header.routes.length, SALT_LINES.length);
  assert.ok(zone.every(value => value === 0 || value === 2));
  const oldPier = WATERFRONT_PIERS.find(p => p.side === 'west' && p.length > 200);
  for (const [x, z] of [
    [-2700, 0], [-2600, -4000], [1650, 800], [1420, -5200], [2200, -6350], [1810, -2030],
    [795, 7685], [-1234, 8849], [2850, 3500], [150, 9150], [oldPier.cx, oldPier.cz]
  ]) {
    assert.ok(saltLandAt(x, z), [x, z]);
    assert.equal(surfaces.wetAt(x, z), false);
    const hit = {};
    assert.ok(surfaces.sample(x, z, 1, hit));
    assert.equal(hit.y, sampleSalt(x, z));
    assert.equal(hit.deck, false);
  }
  assert.ok(sampleSalt(-2700, 0) < SALT_WATER, 'the dry Hudson retains its lower ground');
  assert.equal(surfaces.sample(-585, 0, 1, {}), false);
});

test('the five road crossings and the shoulders meet the asphalt at grade', () => {
  assert.equal(CROSSINGS.length, 5);
  for (const g of CROSSINGS) {
    const inside = [g.x - 5 * g.dx, g.z - 5 * g.dz], outside = [g.x + 5 * g.dx, g.z + 5 * g.dz];
    assert.ok(insideCity(...inside), g.id);
    assert.ok(saltLandAt(...outside), g.id);
    assert.ok(Math.abs(sampleSalt(...outside)) < 0.12, g.id);
    assert.ok(SALT_LINES.find(line => line.id === g.id).path.some(p => insideCity(p.x, p.z)), g.id);
  }
  for (let z = -6250; z < 5950; z += 65) {
    const { westX, eastX } = cityBoundsAt(z);
    for (const x of [westX - 1, eastX + 1]) assert.ok(Math.abs(sampleSalt(x, z)) < 0.12, [x, z]);
  }
});

test('every road and track remains driveable on regular suspension', () => {
  assert.deepEqual(SALT_LOOP[0], SALT_LOOP.at(-1));
  for (const line of SALT_LINES) {
    const path = line.path.filter(p => !insideCity(p.x, p.z));
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], length = Math.hypot(a.x - b.x, a.z - b.z);
      for (let n = 0; n <= 4; n++) assert.ok(saltLandAt(a.x + (b.x - a.x) * n / 4, a.z + (b.z - a.z) * n / 4), line.id);
      const grade = Math.abs(sampleSalt(a.x, a.z) - sampleSalt(b.x, b.z)) / length;
      assert.ok(grade < 0.14, `${line.id}: grade ${grade} near ${a.x}, ${a.z}`);
    }
  }
});

test('wheels and planes sample exactly the triangles used to draw the ground', () => {
  const ix = 1313, iz = 2320;
  const a = saltVertex(ix, iz), b = saltVertex(ix + 1, iz), c = saltVertex(ix, iz + 1), d = saltVertex(ix + 1, iz + 1);
  const hit = {};
  for (const [u, v] of [[.25, .20], [.70, .60], [.42, .58]]) {
    const y = sampleSalt(SALT_MIN_X + (ix + u) * SALT_STEP, SALT_MIN_Z + (iz + v) * SALT_STEP, hit);
    const expected = u + v <= 1 ? a * (1 - u - v) + b * u + c * v : d * (u + v - 1) + b * (1 - v) + c * (1 - u);
    assert.ok(Math.abs(y - expected) < 1e-4);
    assert.ok(Math.abs(Math.hypot(hit.nx, hit.ny, hit.nz) - 1) < 1e-8);
    assert.ok(hit.grip > 0.5 && hit.grip <= 1 && hit.rough > 0);
  }
});

test('all named places have dry ground and a route in both directions', () => {
  const city = { x: -585, z: 0 };
  for (const p of SALT_PLACES) {
    assert.ok(saltLandAt(p.x, p.z), p.name);
    assert.equal(saltLocation(p.x, p.z), p.name);
    const out = routeThroughSalt(city, p), back = routeThroughSalt(p, city);
    assert.ok(out?.length > 5 && back?.length > 5, p.name);
    assert.deepEqual(out.at(-1), p);
    assert.deepEqual(back.at(-1), city);
  }
  assert.equal(routeThroughSalt(city, { x: 300, z: 300 }), null);
});

test('land contracts preserve existing story IDs and place the sprint outside the city', () => {
  assert.deepEqual(ACT3.map(m => m.id), ['opa', 'cazal', 'liberty', 'prise']);
  assert.ok(Object.values(PLACES3).every(p => insideCity(p.x, p.z)));
  assert.ok(saltLandAt(SALT_SPRINT.place.x, SALT_SPRINT.place.z));
});
