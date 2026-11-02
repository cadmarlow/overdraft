const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const { roofAt, roofColliderAt } = loadModule(readFileSync(join(__dirname, '../js/building-collision.js'), 'utf8'));

const ring = (points) => points.map(([x, z]) => ({ x, z }));
const box = (x0, z0, x1, z1, maxY, extra = {}) => ({
  minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY: 0, maxY, roof: true,
  polygon: { outer: ring([[x0, z0], [x1, z0], [x1, z1], [x0, z1]]), holes: [] }, ...extra
});

test('a roof is under the feet only from its own height up, and the tallest one reachable wins', () => {
  const low = box(0, 0, 20, 20, 12), tower = box(10, 10, 20, 20, 60);
  const pole = { minX: 4, maxX: 5, minZ: 4, maxZ: 5, maxY: 8, round: 0.2 }; // street furniture has no roof
  const list = [low, tower, pole];
  assert.equal(roofAt(list, 5, 5, 0.2), 0, 'in the street below');
  assert.equal(roofAt(list, 5, 5, 12), 12, 'standing on the low roof');
  assert.equal(roofAt(list, 5, 5, 11.6), 12, 'a small step up is taken');
  assert.equal(roofAt(list, 5, 5, 11), 0, 'a full storey below it is not');
  assert.equal(roofAt(list, 15, 15, 12), 12, 'beside the tower, still on the low roof');
  assert.equal(roofAt(list, 15, 15, 60), 60, 'on top of the tower');
  assert.equal(roofAt(list, 25, 25, 100), 0, 'past both footprints');
  assert.equal(roofAt(list, 4.5, 4.5, 8), 0, 'a pole is never stood on');
  assert.equal(roofColliderAt(list, 15, 15, 60), tower);
  assert.equal(roofColliderAt(list, 15, 15, 30), low);
});

test('roofs follow the footprint, courtyards included', () => {
  const yard = { ...box(0, 0, 30, 30, 25), polygon: { outer: ring([[0, 0], [30, 0], [30, 30], [0, 30]]), holes: [ring([[10, 10], [20, 10], [20, 20], [10, 20]])] } };
  assert.equal(roofAt([yard], 5, 5, 25), 25);
  assert.equal(roofAt([yard], 15, 15, 25), 0, 'the courtyard is open to the street');
});
