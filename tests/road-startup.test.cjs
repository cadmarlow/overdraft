const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const source = file => readFileSync(join(__dirname, '../js', file + '.js'), 'utf8');
const { polygonBoxOverlaps } = loadModule(source('building-collision'));

function harness(onPolygon = () => {}) {
  return loadModule(source('road-network'), { imports: {
    './city-config.js': { ALL_AVENUES: [], ALL_STREETS: [], BLOCKS: [], ISLAND_BOUNDS: { minZ: -100, maxZ: 100 }, getIslandBoundsAtZ: () => ({ westX: -1000, eastX: 1000 }) },
    './nyc-geodata.js': { GEO: {} },
    './road-layout.js': loadModule(source('road-layout')),
    './building-collision.js': { polygonBoxOverlaps: (...args) => { onPolygon(args[0]); return polygonBoxOverlaps(...args); } }
  } }).buildRoadNetwork;
}
const rect = (minX, maxX, minZ, maxZ, extra = {}) => ({ minX, maxX, minZ, maxZ, ...extra });
const polygon = { outer: [{ x: -35, z: -35 }, { x: 35, z: -35 }, { x: 35, z: 35 }, { x: -35, z: 35 }],
  holes: [[{ x: -8, z: -8 }, { x: 8, z: -8 }, { x: 8, z: 8 }, { x: -8, z: 8 }]] };
const overlaps = (r, x, z, pad) => r.minX < x + pad && r.maxX > x - pad && r.minZ < z + pad && r.maxZ > z - pad && (!r.polygon || polygonBoxOverlaps(r.polygon, x, z, pad, pad));

test('typed road indexes preserve exact curb, pedestrian and obstacle queries across cell boundaries', () => {
  const layout = [rect(-80, 80, -80, 80)];
  const curbs = [rect(-35, 35, -35, 35, { polygon })];
  const obstacles = [rect(-70, -60, -60, 60), rect(20, 28, -60, 60, { pedestrianOnly: true }),
    rect(-40, 40, -90, -30), rect(42, 55, 25, 50, { curb: true }), rect(-50, -40, 0, 40, { layout: true })];
  const build = harness(), network = build(layout, obstacles, [], curbs);
  const all = [...layout.map(r => ({ ...r, layout: true })), ...curbs.map(r => ({ ...r, curb: true })), ...obstacles];
  for (let x = -96; x < 96; x += 1.5) for (let z = -96; z < 96; z += 1.5) {
    assert.equal(network.onSidewalk(x, z), all.some(r => r.curb && overlaps(r, x, z, 0)));
    assert.equal(network.walkable(x - 0.6, x + 0.6, z - 0.6, z + 0.6), !all.some(r => !r.layout && !r.curb && overlaps(r, x, z, 0.6)));
    assert.equal(network.isRoadClear(x, z, 1.2), !all.some(r => (r.curb || (!r.layout && !r.curb && !r.pedestrianOnly && (r.maxX - r.minX < 50 || r.maxZ - r.minZ < 50))) && overlaps(r, x, z, 1.2)));
  }
  assert.equal(network.walkable(61, 63, 61, 63), true);
  assert.equal(network.isRoadClear(62, 62), true);
  network.addObstacle(rect(60, 64, 60, 64));
  assert.equal(network.walkable(61, 63, 61, 63), false, 'late furniture updates pedestrian clearance');
  assert.equal(network.isRoadClear(62, 62), false, 'late furniture updates street clearance');
});

test('a curb lookup does not inspect unrelated building and prop polygons', () => {
  let checks = 0;
  const network = harness(() => checks++)([], [rect(-35, 35, -35, 35, { polygon })], [], []);
  checks = 0;
  for (let x = -30; x <= 30; x++) assert.equal(network.onSidewalk(x, 0), false);
  assert.equal(checks, 0, 'irrelevant polygons must not enter the narrow-phase query');
  assert.equal(network.walkable(19, 21, -1, 1), false);
  assert.ok(checks > 0, 'the same building still blocks a pedestrian');
});
