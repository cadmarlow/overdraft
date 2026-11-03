import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The data modules fetch their .bin.gz next to them: hand them the files
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => (String(url).startsWith('file:') ? new Response(readFileSync(new URL(String(url)))) : nativeFetch(url, ...rest));
const { REAL_BUILDINGS } = await import('../js/building-geodata.js');
const { BUILDING_FACTS } = await import('../js/building-styles.js');
globalThis.fetch = nativeFetch;
const { TYPES, dressBuilding, styleAttributes, classify, SURFACES, windowsOf, FLAG } = await import('../js/building-types.js');
const { insetRing, signedArea, zoningSetbacks, parapetHeight } = await import('../js/building-massing.js');

test('every surveyed building has its facts, most from their own tax lot', () => {
  assert.equal(BUILDING_FACTS.length, REAL_BUILDINGS.length);
  const known = BUILDING_FACTS.filter((f) => f.cls).length;
  assert.ok(known > REAL_BUILDINGS.length * 0.9, `${known} with a building class`);
  const tiered = BUILDING_FACTS.filter((f) => f.parts.length).length;
  assert.ok(tiered > 1000, `${tiered} stepped towers`);
  for (const f of BUILDING_FACTS) {
    assert.ok(!f.year || (f.year > 1600 && f.year < 2030), `year ${f.year}`);
    for (const p of f.parts) {
      assert.ok(p.top > p.base && p.base >= 0 && p.top < 600, `part ${p.base}..${p.top}`);
      assert.ok(p.ring.length >= 3 && Math.abs(signedArea(p.ring)) >= 4);
    }
  }
});

const dressed = REAL_BUILDINGS.map((b, i) => dressBuilding(b, BUILDING_FACTS[i]));

test('the island is mostly brick walk-ups and row houses, with every kind of building somewhere', () => {
  const count = {};
  for (const s of dressed) count[s.type] = (count[s.type] || 0) + 1;
  for (const t of TYPES) assert.ok(count[t.id] > 50, `${t.id}: ${count[t.id]}`);
  assert.ok(count.tenement + count.rowhouse > REAL_BUILDINGS.length * 0.4);
  const glass = dressed.filter((s) => s.glass).length;
  assert.ok(glass < REAL_BUILDINGS.length * 0.08, `${glass} curtain walls`);
});

test('a dress is a pure function of its building, and packs into four finite vec4s', () => {
  REAL_BUILDINGS.slice(0, 3000).forEach((b, i) => {
    const s = dressed[i];
    assert.deepEqual(dressBuilding(b, BUILDING_FACTS[i]), s);
    const a = styleAttributes(s);
    assert.equal(a.length, 16);
    assert.ok(a.every(Number.isFinite), `${s.type}: ${a}`);
    if (!s.glass) {
      assert.ok(SURFACES.includes(s.surface));
      assert.ok(s.ratioX > 0.3 && s.ratioX < 0.9 && s.ratioY > 0.3 && s.ratioY < 0.9);
      assert.ok(s.floor > 2.6 && s.floor < 5.3 && s.bay > 1.5 && s.bay < 4.5, `${s.type} storey ${s.floor} bay ${s.bay}`);
    }
  });
});

test('PLUTO classes read as the buildings they are', () => {
  const box = (h) => ({ height: h, year: 0, cx: 0, cz: 0, polygons: [{ outer: [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 30 }, { x: 0, z: 30 }], holes: [] }] });
  const facts = (cls, floors, year, district = '') => ({ cls, floors, year, district, material: '', colour: -1, parts: [] });
  assert.equal(classify(box(14), facts('A4', 4, 1890, 'Upper West Side / Central Park West Historic District')), 'rowhouse');
  assert.equal(classify(box(18), facts('C4', 5, 1905)), 'tenement');
  assert.equal(classify(box(40), facts('D4', 12, 1927)), 'prewar');
  assert.equal(classify(box(25), facts('K4', 6, 1880, 'SoHo-Cast Iron Historic District')), 'loft');
  assert.equal(classify(box(180), facts('O4', 50, 1931)), 'deco');
  assert.equal(classify(box(150), facts('O4', 40, 1965)), 'midcentury');
  assert.equal(classify(box(200), facts('O4', 50, 2005)), 'glass');
  assert.equal(classify(box(20), facts('M1', 0, 1880)), 'civic');
});

test('an inset ring stands the same distance in from every side, or is refused when it would fold', () => {
  const rect = [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }, { x: 0, z: 20 }];
  for (const ring of [rect, [...rect].reverse()]) {
    const r = insetRing(ring, 3);
    const xs = r.map((p) => p.x), zs = r.map((p) => p.z);
    assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)].map((v) => Math.round(v * 1000) / 1000), [3, 37, 3, 17]);
  }
  assert.equal(insetRing(rect, 11), null);
  // An L: its inner corner moves out with the rest
  const l = [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 10 }, { x: 10, z: 10 }, { x: 10, z: 30 }, { x: 0, z: 30 }];
  const r = insetRing(l, 2);
  assert.ok(r && Math.abs(signedArea(r)) < Math.abs(signedArea(l)));
});

test('zoning setbacks rise in tiers, each inside the footprint and above the last', () => {
  let stepped = 0;
  REAL_BUILDINGS.forEach((b, i) => {
    const z = zoningSetbacks(b, dressed[i], BUILDING_FACTS[i].year || b.year);
    if (!z) return;
    stepped++;
    assert.ok(z.podium >= 22 && z.podium < b.height);
    let base = z.podium, area = Math.abs(signedArea(b.polygons[0].outer));
    for (const t of z.tiers) {
      assert.ok(Math.abs(t.base - base) < 1e-6 && t.top > t.base, `${t.base}..${t.top} after ${base}`);
      const a = Math.abs(signedArea(t.ring));
      assert.ok(a < area, 'each tier is smaller than the one under it');
      base = t.top; area = a;
    }
  });
  assert.ok(stepped > 100, `${stepped} buildings stepped back`);
});

test('3D window dressings sit on the openings the shader draws: in from the piers, above the ground floor, under the top', () => {
  const style = { ...dressed.find((s) => s.type === 'tenement' && !(s.flags & FLAG.attic)), floor: 3.2, bay: 2.2, ratioX: 0.46, ratioY: 0.6 };
  const wall = { ax: 0, az: 0, bx: 20, bz: 0, nx: 0, nz: -1, width: 20, bottom: 0.22, top: 16.22 };
  const windows = windowsOf({ style, kitWalls: [wall] });
  // 20 m less two 1.2 m piers: 8 bays of 2.2 m; storeys 1 to 4 (the fifth would end over the top)
  const pier = 1.2, bays = Math.floor((20 - 2 * pier) / 2.2 + 0.5), bayW = (20 - 2 * pier) / bays;
  assert.equal(windows.length, bays * 4);
  for (const w of windows) {
    assert.ok(w.n >= 1 && (w.n + 1) * 3.2 <= wall.top + 0.05, `storey ${w.n}`);
    assert.ok(w.x - w.width / 2 >= pier - 1e-6 && w.x + w.width / 2 <= 20 - pier + 1e-6);
    const k = (w.x - pier) / bayW - 0.5;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6, 'centred in its bay');
    assert.ok(Math.abs(w.width - 0.46 * bayW) < 1e-6 && w.y1 - w.y0 > 1.8);
  }
  // A tier standing on a podium has no windows below its own wall
  assert.ok(windowsOf({ style, kitWalls: [{ ...wall, bottom: 9 }] }).every((w) => w.y0 >= 9.1));
});

test('a parapet caps roofs without a cornice', () => {
  const s = dressed.find((d) => d.cornice !== 'none');
  assert.equal(parapetHeight(s), 0);
  assert.ok(parapetHeight(dressed.find((d) => d.glass)) > 1);
});
