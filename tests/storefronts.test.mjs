import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { SHOP_TYPES, SHOP_TYPE_INDEX, shopOpenAt } from '../js/storefront-types.js';
import { planStorefronts, wallKey, shopLayout, shopColliders, MIN_WIDTH } from '../js/storefront-plan.js';
import { shopIdentity, encodeText, NAMES } from '../js/storefront-signs.js';
import { GLYPHS } from '../js/storefront-glyphs.js';

const root = new URL('../js/', import.meta.url);
// The generated data modules fetch their .bin.gz with top-level await: run them with a fetch that reads the file
async function loadData(file, name) {
  const source = readFileSync(new URL(file, root), 'utf8')
    .replace('import.meta.url', JSON.stringify('https://example.test/js/' + file))
    .replace(/^export (const|\{[^}]*\};)/m, (m, k) => (k === 'const' ? 'const' : ''));
  return new Script(`(async () => { ${source}\nreturn ${name}; })()`).runInNewContext({
    URL, Response, DecompressionStream, Uint8Array, DataView, Float32Array, Error, Array,
    fetch: async (url) => new Response(readFileSync(new URL(url.href.split('/js/')[1], root)))
  });
}
const storefronts = await loadData('storefront-geodata.js', 'STOREFRONTS');
const buildings = await loadData('building-geodata.js', 'REAL_BUILDINGS');

test('the registry data holds every storefront on the island with a known kind of shop', () => {
  assert.ok(storefronts.count > 25000, `count ${storefronts.count}`);
  for (let i = 0; i < storefronts.count; i++) {
    assert.ok(storefronts.type[i] < SHOP_TYPES.length);
    assert.ok(storefronts.x[i] > -2200 && storefronts.x[i] < 2600 && storefronts.z[i] > -7100 && storefronts.z[i] < 6600);
    // The street its address faces is within a block of it
    assert.ok(Math.hypot(storefronts.streetX[i] - storefronts.x[i], storefronts.streetZ[i] - storefronts.z[i]) < 170);
  }
  const counts = new Map();
  for (const t of storefronts.type) counts.set(t, (counts.get(t) || 0) + 1);
  for (const id of ['vacant', 'bodega', 'pizza', 'restaurant', 'laundromat', 'bank', 'luxury', 'gallery']) {
    assert.ok(counts.get(SHOP_TYPE_INDEX[id]) > 50, `${id}: ${counts.get(SHOP_TYPE_INDEX[id])}`);
  }
});

const plan = planStorefronts(buildings, storefronts, SHOP_TYPES);

test('shops go on outer walls, side by side without overlapping, at least a shop wide', () => {
  assert.ok(plan.shops.length > 20000, `${plan.shops.length} shops`);
  assert.ok(plan.unplaced < storefronts.count * 0.05, `${plan.unplaced} unplaced`);
  const byWall = new Map();
  for (const s of plan.shops) {
    assert.ok(s.width >= MIN_WIDTH - 0.011, `width ${s.width}`);
    assert.ok(Math.abs(Math.hypot(s.ux, s.uz) - 1) < 1e-6 && Math.abs(Math.hypot(s.nx, s.nz) - 1) < 1e-6);
    assert.ok(Math.abs(s.ux * s.nx + s.uz * s.nz) < 1e-6, 'normal across the wall');
    // The normal points out of the building: a step out is not inside its footprint
    const mx = s.x + s.ux * s.width / 2 + s.nx * 0.5, mz = s.z + s.uz * s.width / 2 + s.nz * 0.5;
    const inside = s.record.polygons.some(({ outer }) => {
      let c = false;
      for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
        const a = outer[i], b = outer[j];
        if ((a.z > mz) !== (b.z > mz) && mx < a.x + (mz - a.z) * (b.x - a.x) / (b.z - a.z)) c = !c;
      }
      return c;
    });
    assert.ok(!inside, 'shop faces out of its building');
    if (!byWall.has(s.wall)) byWall.set(s.wall, []);
    byWall.get(s.wall).push(s);
  }
  for (const list of byWall.values()) {
    const spans = list.map((s) => { const t = s.x * s.ux + s.z * s.uz; return [t, t + s.width]; }).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1] - 1e-3, 'shops overlap on a wall');
  }
  // Every wall holding shops is listed for the facade shader under its building
  for (const s of plan.shops) assert.ok(plan.wallsByRecord.get(s.record)?.has(s.wall));
});

test('wall keys ignore which way round a wall is walked', () => {
  assert.equal(wallKey(1.04, 2, 5, 6.01), wallKey(5, 6.01, 1.04, 2));
  assert.notEqual(wallKey(0, 0, 5, 0), wallKey(0, 0, 0, 5));
});

test('each front stands out from its wall no further than its collider, which covers its frontage', () => {
  const sample = plan.shops.slice(0, 2000);
  const colliders = shopColliders(sample, SHOP_TYPES);
  sample.forEach((s, i) => {
    const layout = shopLayout(s, SHOP_TYPES);
    assert.deepEqual(shopLayout(s, SHOP_TYPES), layout, 'layout is a function of the shop');
    assert.ok(layout.depth >= layout.front && layout.depth < 0.9);
    const c = colliders[i];
    // Both ends of the frontage, a hair out from the wall, are inside the oriented box
    for (const t of [0.05, s.width - 0.05]) {
      const x = s.x + s.ux * t + s.nx * 0.05, z = s.z + s.uz * t + s.nz * 0.05;
      const dx = x - c.obb.cx, dz = z - c.obb.cz;
      const lx = dx * c.obb.cs - dz * c.obb.sn, lz = dx * c.obb.sn + dz * c.obb.cs;
      assert.ok(Math.abs(lx) <= c.obb.hx + 1e-6 && Math.abs(lz) <= c.obb.hz + 1e-6);
      assert.ok(x >= c.minX - 1e-6 && x <= c.maxX + 1e-6 && z >= c.minZ - 1e-6 && z <= c.maxZ + 1e-6);
    }
  });
});

// Real chains and brands that must never appear on a sign
const BRANDS = ['DUANE', 'READE', 'STARBUCK', 'MCDONALD', 'SUBWAY', 'CVS', 'WALGREEN', 'RITE AID', 'CHASE', 'CITIBANK', 'WELLS FARGO',
  'DUNKIN', 'APPLE', 'NIKE', 'GUCCI', 'PRADA', 'CHANEL', 'TIFFANY', 'ZARA', 'SEPHORA', 'KFC', 'BURGER KING', 'DOMINO', 'PAPA JOHN',
  'POPEYES', 'CHIPOTLE', 'SHAKE SHACK', 'T-MOBILE', 'VERIZON', 'AT&T', 'BEST BUY', 'HOME DEPOT', 'ACE HARDWARE', 'GRISTEDES',
  'KEY FOOD', 'C-TOWN', 'I LOVE NY', 'I ♥ NY', 'COCA', 'PEPSI', '7-ELEVEN', 'PANDA EXPRESS', "RAY'S", 'GRAY', 'ARMANI', 'VALENTINO',
  'HERMÈS', 'HERMES', 'CARTIER', 'ROLEX', 'BLOOMINGDALE', "MACY", 'SAKS', 'BARNES', 'GAP '];

test('names are invented, readable with the sign glyphs, and stable for a shop', () => {
  const chars = new Set(GLYPHS.chars);
  for (const type of SHOP_TYPES) {
    for (let i = 0; i < 400; i++) {
      const seed = (i * 0.6180339887 + type.id.length * 0.13) % 1;
      const id = shopIdentity(type.id, seed);
      assert.deepEqual({ ...shopIdentity(type.id, seed), r: null }, { ...id, r: null });
      for (const text of [id.name, id.tagline]) {
        // The city's nickname is no computer maker
        const upper = text.toUpperCase().replace('BIG APPLE', '');
        // Whole words only: PHARMACY is no MACY'S
        for (const brand of BRANDS) assert.ok(!new RegExp(`(^|[^A-Z])${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\        for (const brand of BRANDS) assert.ok(!upper.includes(brand), `${type.id}: "${text}" names ${brand}`);')}`).test(upper), `${type.id}: "${text}" names ${brand}`);
        for (const ch of text) assert.ok(chars.has(ch) || chars.has(ch.toUpperCase()), `${type.id}: "${ch}" in "${text}" has no glyph`);
      }
      assert.ok(id.name.length > 0 && id.name.length <= 24, `${type.id}: "${id.name}"`);
    }
  }
  for (const type of SHOP_TYPES) assert.ok(NAMES[type.id], `${type.id} has names`);
});

test('sign text packs two glyphs a float and measures its width in ems', () => {
  const font = 0;
  const { codes, width, count } = encodeText('TONY’S PIZZA'.replace('’', "'"), font, 0.02);
  const decoded = [];
  for (const f of codes) decoded.push(f % 128, Math.floor(f / 128));
  const text = decoded.filter((c) => c > 0).map((c) => GLYPHS.chars[c - 1]).join('');
  assert.equal(text, "TONY'S PIZZA");
  assert.equal(count, 12);
  const advances = [..."TONY'S PIZZA"].reduce((n, ch) => n + GLYPHS.fonts[font].advances[GLYPHS.chars.indexOf(ch)], 0);
  assert.ok(Math.abs(width - (advances + 11 * 0.02)) < 1e-4);
});

test('opening hours wrap past midnight, a bodega never shuts, a vacant shop never opens', () => {
  const t = (id) => SHOP_TYPES[SHOP_TYPE_INDEX[id]];
  assert.ok(shopOpenAt(t('bodega'), 3.5));
  assert.ok(shopOpenAt(t('bar'), 1.5) && !shopOpenAt(t('bar'), 10));
  assert.ok(shopOpenAt(t('bank'), 10) && !shopOpenAt(t('bank'), 18));
  assert.ok(!shopOpenAt(t('vacant'), 12));
});
