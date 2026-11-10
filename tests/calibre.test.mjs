import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { CALIBRE, PLAN, calibrePoint, calibreLocal, planCalibre, carveCalibrePolygon, carveCalibreColliders, calibreWallPanels, calibreFixtures, calibreZone, roomFits } from '../js/calibre-plan.js';
import { polygonContains, polygonContact } from '../js/building-collision.js';
import { planStorefronts, wallKey } from '../js/storefront-plan.js';
import { SHOP_TYPES } from '../js/storefront-types.js';
import { ISLAND_BOUNDS, getIslandBoundsAtZ } from '../js/city-config.js';

async function data(file, name) {
  const root = new URL('../js/', import.meta.url);
  const code = readFileSync(new URL(file, root), 'utf8').replace('import.meta.url', JSON.stringify('https://test.invalid/js/' + file))
    .replace(/^export (const|\{[^}]*\};)/m, (_, k) => k === 'const' ? 'const' : '');
  return new Script(`(async()=>{${code}\nreturn ${name};})()`).runInNewContext({ URL, Response, DecompressionStream, Uint8Array, DataView, Float32Array, Error, Array,
    fetch: async url => new Response(readFileSync(new URL(url.href.split('/js/')[1], root))) });
}
const buildings = await data('building-geodata.js', 'REAL_BUILDINGS');
const registry = await data('storefront-geodata.js', 'STOREFRONTS');
const frontage = planStorefronts(buildings, registry, SHOP_TYPES);
const bounds = { ...ISLAND_BOUNDS, shoreAt: getIslandBoundsAtZ };
const sites = planCalibre(frontage.shops, buildings, 48, bounds);

test('48 real storefronts form a stable, separated network from the Battery to Harlem', () => {
  assert.equal(sites.length, 48);
  assert.equal(new Set(sites.map(s => s.id)).size, 48);
  assert.equal(new Set(sites.map(s => s.record)).size, 48);
  assert.ok(Math.min(...sites.map(s => s.z)) < -6500);
  assert.ok(Math.max(...sites.map(s => s.z)) > 5800);
  assert.ok(Math.hypot(sites[0].x + 12, sites[0].z - 380) < 250);
  for (const s of sites) for (const other of sites) if (s !== other) assert.ok(Math.hypot(s.x - other.x, s.z - other.z) >= 350);
  assert.deepEqual(planCalibre(frontage.shops, buildings, 48, bounds).map(s => s.id), sites.map(s => s.id));
});

test('each room and its approach have usable space, with no building boundary through the room', () => {
  for (const site of sites) {
    assert.ok(roomFits(site, site.polygon), site.id);
    for (let x = -4.2; x <= 4.2; x += 0.4) for (let z = -0.1; z >= -CALIBRE.depth + 0.1; z -= 0.4) {
      const p = calibrePoint(site, x, z);
      assert.ok(polygonContains(site.polygon, p.x, p.z), `${site.id}: ${x},${z}`);
    }
    const outside = calibrePoint(site, 0, 1.5);
    assert.ok(!polygonContains(site.polygon, outside.x, outside.z));
  }
});

test('carved footprints admit the player through the doorway but keep back, side and upper walls solid', () => {
  for (const site of sites) {
    const original = site.polygon, saved = JSON.stringify(original);
    const carved = carveCalibrePolygon(original, site);
    assert.equal(JSON.stringify(original), saved, 'the source footprint must not change');
    for (let z = 2; z > -CALIBRE.depth + 0.6; z -= 0.15) {
      const p = calibrePoint(site, 0, z);
      assert.ok(!polygonContact(carved, p.x, p.z, { radius: 0.35 }), site.id + ': central aisle blocked');
    }
    const behind = calibrePoint(site, 0, -CALIBRE.depth - 0.3);
    if (polygonContains(original, behind.x, behind.z)) assert.ok(polygonContains(carved, behind.x, behind.z));
    const colliders = [{ polygon: original, minY: 0, maxY: 20, roof: true }];
    carveCalibreColliders(colliders, [site]);
    assert.equal(colliders[1].polygon, original);
    assert.equal(colliders[1].minY, CALIBRE.height);
    assert.equal(colliders[1].roof, true);
    // what stands in a walker's way (a lintel above the head does not)
    const fixtures = calibreFixtures(site).filter(c => c.minY < 1.9);
    const blocked = (x, z, radius = 0.3) => {
      const p = calibrePoint(site, x, z);
      return fixtures.some(c => { const o = c.obb, dx = p.x - o.cx, dz = p.z - o.cz; return Math.abs(dx * o.cs - dz * o.sn) < o.hx + radius && Math.abs(dx * o.sn + dz * o.cs) < o.hz + radius; });
    };
    assert.ok(blocked(0, PLAN.counter.z), 'counter is solid');
    assert.ok(!blocked(0, 0), 'doorway stays clear');
    // the customer's way: door, central aisle, along the right wall, through the partition, to every booth
    const door = PLAN.partition.door, mid = (door.x0 + door.x1) / 2;
    for (let z = 0; z > -6.2; z -= 0.2) assert.ok(!blocked(0, z), site.id + ': central aisle at ' + z.toFixed(1));
    for (let x = 0; x < mid; x += 0.2) assert.ok(!blocked(x, -6.1), site.id + ': in front of the counter at ' + x.toFixed(1));
    for (let z = -6.1; z > -13; z -= 0.2) assert.ok(!blocked(mid, z, 0.28), site.id + ': passage to the range at ' + z.toFixed(1));
    for (const lane of PLAN.lanes.slice(1)) {
      for (let x = mid; x > lane; x -= 0.2) assert.ok(!blocked(x, -12.6), site.id + ': briefing area at ' + x.toFixed(1));
      assert.ok(!blocked(lane, -13.9), site.id + ': booth');
      assert.ok(blocked(lane, PLAN.line.z), site.id + ': nobody walks down range');
    }
    // the staff side and the partition are closed to the customer
    assert.ok(blocked(PLAN.gate.x, -9), 'staff gate');
    assert.ok(blocked(0, PLAN.partition.z), 'partition');
    assert.equal(calibreZone(0, -3), 'shop'); assert.equal(calibreZone(1, -20), 'range');
    assert.equal(calibreZone(0, 1), null); assert.equal(calibreZone(5, -3), null); assert.equal(calibreZone(0, -CALIBRE.depth - 1), null);
  }
});

test('facade openings preserve upper-storey walls and never remove an unrelated wall', () => {
  for (const site of sites) {
    const ring = site.polygon.outer;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], width = Math.hypot(b.x-a.x,b.z-a.z);
      if (!width) continue;
      const panels = calibreWallPanels(site.record,a.x,a.z,b.x,b.z,.22,20);
      const area = panels.reduce((sum,[lo,hi,y0,y1])=>sum+(hi-lo)*(y1-y0),0);
      const removed = wallKey(a.x,a.z,b.x,b.z) === site.wall ? CALIBRE.width*(CALIBRE.height-.22) : 0;
      assert.ok(Math.abs(area-(width*19.78-removed)) < 1e-5);
      for (const [lo,hi] of panels) assert.ok(lo >= -1e-5 && hi <= width+1e-5);
    }
    for (const [x,z] of [[0,0],[2,-6],[-3,-9]]) {
      const p=calibrePoint(site,x,z), q=calibreLocal(site,p.x,p.z);
      assert.ok(Math.abs(q.x-x)<1e-9 && Math.abs(q.z-z)<1e-9);
    }
  }
});
