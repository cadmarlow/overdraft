const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// The sidewalk kit's pure side: the atlas layout and the parts' geometries, built with the real three.js.
const source = readFileSync(join(__dirname, '../js/sidewalk-kit.js'), 'utf8');
async function loadKit() {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const TSL = await import('../vendor/three/build/three.tsl.js');
  const utils = loadModule(readFileSync(join(__dirname, '../vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), 'utf8'), { imports: { three: THREE }, filename: 'BufferGeometryUtils.js' });
  return loadModule(source, { imports: { 'three/webgpu': THREE, 'three/tsl': TSL, 'three/addons/utils/BufferGeometryUtils.js': utils, './tsl-materials.js': { cityUniforms: {} } }, filename: 'sidewalk-kit.js' });
}
const triangles = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const size = (g) => { const b = g.boundingBox; return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]; };
const near = (a, b, eps = 0.03) => Math.abs(a - b) <= eps;

test('sidewalk-kit: the atlas is 8 x 8 tiles, every tile named once, the site tiles among them', async () => {
  const { TILES, SITE, GRID } = await loadKit();
  assert.equal(GRID, 8);
  const tall = new Set(['busflag', 'ad', 'screen']); // two tiles high
  const used = new Map([['0,0', 'swatches']]);
  for (const [name, [x, y]] of Object.entries(TILES)) {
    assert.ok(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < GRID && y < GRID, `${name} inside the atlas`);
    for (const dy of tall.has(name) ? [0, 1] : [0]) {
      const key = `${x},${y + dy}`;
      assert.ok(!used.has(key), `${name} overlaps ${used.get(key)} at ${key}`);
      used.set(key, name);
    }
  }
  for (const name of ['plywood', 'timber', 'planks', 'steelRust', 'steelGreen', 'steelBlue', 'carting', 'concrete', 'looWall', 'looDoor', 'looWall2', 'looDoor2', 'cone', 'debris']) assert.ok(TILES[name], `tile ${name}`);
  // the per-instance looks shift onto painted tiles, the toilet's wall and door together
  const at = ([x, y], [dx, dy]) => used.get(`${x + dx},${y + dy}`);
  // (Array.from: the kit's arrays come from another realm)
  assert.deepEqual(Array.from(SITE.dumpster, (o) => at(TILES.steelRust, o)), ['steelRust', 'steelGreen', 'steelBlue']);
  assert.deepEqual(Array.from(SITE.portaloo, (o) => at(TILES.looWall, o)), ['looWall', 'looWall2']);
  assert.deepEqual(Array.from(SITE.portaloo, (o) => at(TILES.looDoor, o)), ['looDoor', 'looDoor2']);
  assert.deepEqual(Array.from(SITE.band, (o) => at(TILES.carting, [Math.floor(o[0]), Math.floor(o[1])])), ['carting', 'carting']);
});

test('sidewalk-kit: the site parts have the sizes of the real things and stay light', async () => {
  const { createKitParts } = await loadKit();
  const P = createKitParts();
  const SITE_PARTS = ['dumpster', 'portaloo', 'cone', 'jersey', 'shedBoard', 'shedBay', 'diningShed', 'barrierFence'];
  for (const [name, part] of Object.entries(P)) {
    const g = part.geometry;
    if (SITE_PARTS.includes(name)) assert.ok(triangles(g) <= 400, `${name}: ${triangles(g)} triangles`);
    for (const v of g.attributes.position.array) assert.ok(Number.isFinite(v), `${name}: finite positions`);
    assert.ok(g.attributes.uv && g.attributes.color, `${name}: uv and colour`);
    for (let i = 0; i < g.attributes.uv.count; i++) {
      const u = g.attributes.uv.getX(i), v = g.attributes.uv.getY(i);
      assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1, `${name}: uv inside the atlas`);
    }
  }
  // the roll-off container: 6 x 2.2 m, standing 1.6-1.7 m with the hook frame 0.3 m proud of the front
  const dumpster = size(P.dumpster.geometry);
  assert.ok(near(dumpster[0], 6.4, 0.1) && near(dumpster[1], 1.7, 0.05) && near(dumpster[2], 2.32, 0.05), `dumpster ${dumpster}`);
  assert.equal(P.dumpster.material, 'site');
  assert.equal(P.dumpster.attr.name, 'tiles'); assert.equal(P.dumpster.attr.size, 4);
  const plates = new Set(P.dumpster.geometry.attributes.plate.array);
  assert.deepEqual(Array.from(plates).sort(), [0, 1, 2], 'own swatches, the steel and the band');
  // the toilet: 1.1 m square (1.18 roof), 2.6 m to the vent, the door's handle on +z
  const loo = size(P.portaloo.geometry);
  assert.ok(near(loo[0], 1.18) && near(loo[1], 2.63) && near(loo[2], 1.18), `portaloo ${loo}`);
  assert.equal(P.portaloo.material, 'site');
  assert.ok(P.portaloo.geometry.boundingBox.max.z > 0.57, 'the handle stands off the door');
  // shed boards: a unit cube from the ground up, mapped by the plywood material from the instance scale
  const board = P.shedBoard.geometry.boundingBox;
  assert.ok(near(board.min.y, 0) && near(board.max.y, 1) && near(board.min.x, -0.5) && near(board.max.z, 0.5));
  assert.equal(P.shedBoard.material, 'plywood');
  assert.equal(P.shedBoard.attr.name, 'board'); assert.equal(P.shedBoard.attr.size, 3); assert.equal(P.shedBoard.attr.scale, true);
  // the Jersey barrier's real profile: 2 m long, 0.81 m high, 0.61 m at the foot
  const jersey = size(P.jersey.geometry);
  assert.ok(near(jersey[0], 2.0) && near(jersey[1], 0.81) && near(jersey[2], 0.61), `jersey ${jersey}`);
  // the cone: 0.7 m on a 0.36 m base
  const cone = size(P.cone.geometry);
  assert.ok(near(cone[0], 0.36) && near(cone[1], 0.7), `cone ${cone}`);
  // the dining shed keeps its footprint (its collider is 6.1 x 2.3)
  const dining = size(P.diningShed.geometry);
  assert.ok(near(dining[0], 6.3) && near(dining[2], 2.5), `dining shed ${dining}`);
});
