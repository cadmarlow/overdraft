import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { planCalibre, carveCalibrePolygon, carveCalibreColliders, calibreWallPanels, roomFits } from '../js/calibre-plan.js';
import { SPECS, PLANS, SEATS, SPOTS, WAYS, planEateries, eateryPoint, eateryLocal, eateryZone, eateryFixtures, eateryReserves, route } from '../js/eatery-plan.js';
import { BRANDS, BRAND_IDS, SNACK_MAX, menuItem, brandOpenAt } from '../js/eatery-brands.js';
import { menuLines } from '../js/eatery-counter.js';
import { polygonContains, polygonContact } from '../js/building-collision.js';
import { planStorefronts, wallKey } from '../js/storefront-plan.js';
import { SHOP_TYPES } from '../js/storefront-types.js';
import { ISLAND_BOUNDS, getIslandBoundsAtZ } from '../js/city-config.js';

// The restaurants (BULLION, TRANCHE): where they go in the real city, the plan of their rooms, what they sell.

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
// in the game's order: the gun shops first, the restaurants take what is left
const calibre = planCalibre(frontage.shops, buildings, 48, bounds);
const eateries = planEateries(frontage.shops, buildings, bounds);

test('both franchises cover the island, each branch in a building of its own', () => {
  assert.equal(eateries.bullion.length, SPECS.bullion.count);
  assert.equal(eateries.tranche.length, SPECS.tranche.count);
  assert.equal(eateries.all.length, eateries.bullion.length + eateries.tranche.length);
  const records = new Set([...calibre, ...eateries.all].map((s) => s.record));
  assert.equal(records.size, calibre.length + eateries.all.length, 'no building holds two rooms');
  for (const brand of BRAND_IDS) {
    const sites = eateries[brand];
    assert.equal(new Set(sites.map((s) => s.id)).size, sites.length);
    assert.ok(Math.min(...sites.map((s) => s.z)) < -6000 && Math.max(...sites.map((s) => s.z)) > 5500, `${brand} from the Battery to Harlem`);
    assert.ok(Math.hypot(sites[0].x + 12, sites[0].z - 380) < 250, `${brand}: a branch by the opening`);
    for (const s of sites) {
      assert.equal(s.brand, brand); assert.equal(s.spec, SPECS[brand]); assert.equal(s.shop.eatery, s); assert.equal(s.shop.interior, s);
      for (const o of sites) if (s !== o) assert.ok(Math.hypot(s.x - o.x, s.z - o.z) >= SPECS[brand].spacing);
    }
  }
  // the pizzerias the city already has are taken over first
  const pizzerias = eateries.tranche.filter((s) => SHOP_TYPES[s.shop.type].id === 'pizza').length;
  assert.ok(pizzerias >= 20, `${pizzerias} branches of TRANCHE where a pizzeria stood`);
  assert.deepEqual(planEateries(frontage.shops, buildings, bounds).all.map((s) => s.id), eateries.all.map((s) => s.id), 'the same city every time');
});

test('every room fits its building and opens on the sidewalk', () => {
  for (const site of eateries.all) {
    const S = site.spec, P = PLANS[site.brand];
    assert.ok(roomFits(site, site.polygon), site.id);
    for (let x = -P.half; x <= P.half; x += 0.5) for (let z = -0.1; z >= -S.depth + 0.1; z -= 0.5) {
      const p = eateryPoint(site, x, z);
      assert.ok(polygonContains(site.polygon, p.x, p.z), `${site.id}: ${x},${z}`);
    }
    const outside = eateryPoint(site, S.entry, 1.5);
    assert.ok(!polygonContains(site.polygon, outside.x, outside.z));
    // carved: the doorway lets a walker through, the walls above stay
    const carved = carveCalibrePolygon(site.polygon, site);
    for (let z = 2; z > -S.depth + 0.6; z -= 0.3) { const p = eateryPoint(site, S.entry, z); assert.ok(!polygonContact(carved, p.x, p.z, { radius: 0.35 }), `${site.id}: way in blocked at ${z}`); }
    const colliders = [{ polygon: site.polygon, minY: 0, maxY: 20, roof: true }];
    carveCalibreColliders(colliders, [site]);
    assert.equal(colliders[1].minY, S.height); assert.equal(colliders[1].polygon, site.polygon);
    // the facade loses exactly the room's opening
    const ring = site.polygon.outer;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], width = Math.hypot(b.x - a.x, b.z - a.z);
      if (!width) continue;
      const area = calibreWallPanels(site.record, a.x, a.z, b.x, b.z, 0.22, 20).reduce((sum, [lo, hi, y0, y1]) => sum + (hi - lo) * (y1 - y0), 0);
      const removed = wallKey(a.x, a.z, b.x, b.z) === site.wall ? S.width * (S.height - 0.22) : 0;
      assert.ok(Math.abs(area - (width * 19.78 - removed)) < 1e-5);
    }
    const p = eateryPoint(site, 1.2, -3.4), q = eateryLocal(site, p.x, p.z);
    assert.ok(Math.abs(q.x - 1.2) < 1e-9 && Math.abs(q.z + 3.4) < 1e-9);
    assert.ok(eateryReserves(site).length >= 1);
  }
});

test('the furniture is solid and leaves every way, seat and spot of the room free', () => {
  for (const brand of BRAND_IDS) {
    const site = eateries[brand][0], P = PLANS[brand], S = SPECS[brand];
    const fixtures = eateryFixtures(site).filter((c) => c.minY < 1.2);
    const blocked = (x, z, radius = 0.25) => {
      const p = eateryPoint(site, x, z);
      return fixtures.some((c) => { const o = c.obb, dx = p.x - o.cx, dz = p.z - o.cz; return Math.abs(dx * o.cs - dz * o.sn) < o.hx + radius && Math.abs(dx * o.sn + dz * o.cs) < o.hz + radius; });
    };
    assert.ok(!blocked(S.entry, 0), `${brand}: doorway`);
    assert.ok(blocked(S.entry + P.half * 0.9 * (brand === 'bullion' ? 1 : -1), 0, 0.1), `${brand}: the glazed front is solid`);
    if (brand === 'bullion') { assert.ok(blocked(-2, P.counter.z)); assert.ok(blocked((P.gate.x0 + P.gate.x1) / 2, P.gate.z, 0.1), 'the gate keeps customers out of the kitchen'); }
    else { assert.ok(blocked(-0.1, -3)); assert.ok(blocked(-1.0, P.gate.z, 0.1)); assert.ok(blocked(-1, 0, 0.1), 'nobody walks through the hatch'); }
    // the customers' lines
    const W = WAYS[brand];
    for (const [a, b, staff] of W.edges) {
      if (staff) continue;
      const [ax, az] = W.nodes[a], [bx, bz] = W.nodes[b];
      for (let t = 0; t <= 1; t += 0.05) { const x = ax + (bx - ax) * t, z = az + (bz - az) * t; if (z < 0.3) assert.ok(!blocked(x, z, brand === 'bullion' && a === 'br' && b === 'gate' ? 0.05 : 0.22), `${brand}: ${a}-${b} at ${x.toFixed(2)},${z.toFixed(2)}`); }
    }
    for (const seat of SEATS[brand]) {
      assert.ok(!blocked(seat.from.x, seat.from.z, 0.2), `${seat.id}: where one stands before sitting`);
      assert.equal(eateryZone(brand, seat.x, seat.z), 'dining');
      assert.ok(Math.hypot(seat.tray.x - seat.x, seat.tray.z - seat.z) < 0.75, `${seat.id}: the tray within arm's reach`);
      assert.ok(Math.abs(Math.hypot(...seat.face) - 1) < 1e-9);
      // sitting faces the table
      assert.ok((seat.tray.x - seat.x) * seat.face[0] + (seat.tray.z - seat.z) * seat.face[1] > 0.25, seat.id);
    }
    const Sp = SPOTS[brand];
    for (const spot of [...Sp.order, ...Sp.queue, ...Sp.wait, Sp.pickup, Sp.trash]) { assert.ok(!blocked(spot.x, spot.z, 0.2), `${brand}: a customer's spot at ${spot.x},${spot.z}`); assert.equal(eateryZone(brand, spot.x, spot.z), 'dining'); }
    for (const spot of [...Sp.cashiers, Sp.handover]) { assert.ok(!blocked(spot.x, spot.z, 0.18), `${brand}: a post at ${spot.x},${spot.z}`); assert.equal(eateryZone(brand, spot.x, spot.z), 'kitchen'); }
    assert.equal(eateryZone(brand, S.entry, 1), null); assert.equal(eateryZone(brand, P.half + 1, -3), null); assert.equal(eateryZone(brand, 0, -S.depth - 1), null);
  }
});

test('the ways lead from the door to every seat and back, the crew stays behind the counter', () => {
  for (const brand of BRAND_IDS) {
    const Sp = SPOTS[brand];
    for (const seat of SEATS[brand]) {
      const there = route(brand, Sp.out, seat.from, false), back = route(brand, seat.from, Sp.out, false);
      assert.ok(there.length >= 2 && there.length < 12 && back.length >= 2, seat.id);
      const end = there[there.length - 1];
      assert.ok(Math.hypot(end.x - seat.from.x, end.z - seat.from.z) < 1e-6, `${seat.id}: the way ends at the seat`);
      const length = there.reduce((sum, p, i) => sum + Math.hypot(p.x - (i ? there[i - 1].x : Sp.out.x), p.z - (i ? there[i - 1].z : Sp.out.z)), 0);
      assert.ok(length < 26, `${seat.id}: ${length.toFixed(1)} m from the door`);
    }
    for (const spot of [...Sp.queue, ...Sp.order, Sp.pickup, Sp.trash]) assert.ok(route(brand, Sp.out, spot, false).length >= 1);
    // behind the counter, from one post to the other, without ever stepping out
    const a = Sp.cashiers[0], b = Sp.handover;
    for (const p of route(brand, a, b, true)) assert.equal(eateryZone(brand, p.x, p.z), 'kitchen', `${brand}: ${p.x},${p.z}`);
  }
});

test('the menus are sound: prices, what each thing gives, lines for whoever serves', () => {
  for (const brand of BRAND_IDS) {
    const B = BRANDS[brand];
    assert.ok(B.name === B.name.toUpperCase() && B.tagline.length > 5);
    assert.ok(B.menu.length >= 5 && new Set(B.menu.map((i) => i.id)).size === B.menu.length);
    for (const item of B.menu) {
      assert.ok(item.price > 0 && item.price < 40 && item.heal > 0 && item.heal <= 100, item.id);
      assert.ok(item.meal || item.slice || item.snack, `${item.id}: a tray, a plate or a pocket`);
      assert.equal(menuItem(brand, item.id), item);
      if (item.meal) assert.ok(item.tray.length >= 2 && item.fed > 0);
    }
    for (const kind of ['greet', 'counter', 'sold', 'ready', 'bag', 'broke', 'full', 'busy', 'bye', 'police', 'robbed', 'bagged', 'queue', 'tray', 'clean', 'cook']) assert.ok(B.lines[kind]?.length, `${brand}: ${kind}`);
    assert.ok(B.crew.length >= 6);
    assert.ok(brandOpenAt(brand, 13) && brandOpenAt(brand, 1) && !brandOpenAt(brand, 5));
  }
  assert.ok(!brandOpenAt('tranche', 8) && brandOpenAt('bullion', 8));
});

test('the counter knows what can be ordered with full hands, a pending order or full pockets', () => {
  const g = { money: 100, snacks: [], health: 50 };
  const here = menuLines(g, 'bullion', false);
  assert.ok(here.find((l) => l.item.id === 'dividende').here && here.every((l) => l.enabled));
  assert.ok(!here.find((l) => l.item.id === 'lingot').here, 'a single burger goes to the pocket');
  assert.ok(menuLines(g, 'bullion', true).every((l) => !l.here));
  const busy = menuLines(g, 'bullion', false, { pending: true });
  assert.ok(!busy.find((l) => l.item.id === 'dividende').enabled && busy.find((l) => l.item.id === 'lingot').enabled);
  assert.ok(!menuLines(g, 'tranche', false, { holding: true }).find((l) => l.item.id === 'margherita').enabled);
  g.snacks = new Array(SNACK_MAX - 2).fill({});
  const full = menuLines(g, 'tranche', true);
  assert.ok(full.find((l) => l.item.id === 'soda').enabled && !full.find((l) => l.item.id === 'entiere').enabled, 'four slices do not fit in two pockets');
  assert.equal(full.find((l) => l.item.id === 'entiere').count, 4);
});
