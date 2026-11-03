// Generate js/building-styles.bin.gz: what each surveyed building really is, for js/building-types.js to dress it.
//
// Sources:
// - NYC Department of City Planning, PLUTO (NYC Open Data 64uk-42ks): every tax lot's building class, number of
//   floors, year built, historic district and landmark status, at the lot's centroid.
// - © OpenStreetMap contributors (ODbL): building parts with their own heights (the setbacks of the towers), and the
//   colour, material and roof shape mappers recorded for buildings and parts.
//
// The raw downloads stay outside the repository, in the folder given on the command line.
// Usage: node tools/buildings/build-styles.mjs <folder> [--fetch]
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { toWorld } from '../geo-base.mjs';

const folder = process.argv[2];
if (!folder || folder.startsWith('--')) throw new Error('Usage: node tools/buildings/build-styles.mjs <folder> [--fetch]');
fs.mkdirSync(folder, { recursive: true });
const PLUTO_FILE = path.join(folder, 'pluto_manhattan.json');
const PARTS_FILE = path.join(folder, 'osm_parts.json');
const TAGS_FILE = path.join(folder, 'osm_buildings.json');
const OUTPUT = new URL('../../js/building-styles.bin.gz', import.meta.url);
const BBOX = '40.698,-74.022,40.882,-73.906';

if (process.argv.includes('--fetch')) {
  const pluto = new URL('https://data.cityofnewyork.us/resource/64uk-42ks.json');
  pluto.searchParams.set('$select', 'bbl,bldgclass,numfloors,yearbuilt,histdist,landmark,latitude,longitude,bldgarea,unitsres');
  pluto.searchParams.set('$where', "borough='MN'");
  pluto.searchParams.set('$limit', '60000');
  const lots = await (await fetch(pluto)).json();
  if (!Array.isArray(lots) || lots.length < 40000) throw new Error('PLUTO download looks incomplete');
  fs.writeFileSync(PLUTO_FILE, JSON.stringify(lots));
  const overpass = async (query, file) => {
    for (const ep of ['https://overpass-api.de/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter']) {
      const r = await fetch(ep, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'User-Agent': 'overdraft-city-build/1.0' } });
      if (!r.ok) continue;
      const json = await r.json();
      if (Array.isArray(json.elements) && !json.remark) return fs.writeFileSync(file, JSON.stringify(json));
    }
    throw new Error('Overpass download failed');
  };
  await overpass(`[out:json][timeout:220];(way["building:part"](${BBOX});relation["building:part"](${BBOX}););out geom tags;`, PARTS_FILE);
  const tagged = ['building:colour', 'building:material', 'roof:shape', 'roof:colour']
    .map((k) => `way["building"]["${k}"](${BBOX});`).join('');
  await overpass(`[out:json][timeout:220];(${tagged});out center tags;`, TAGS_FILE);
  console.log('downloaded', lots.length, 'lots');
}

// The game's own buildings, read from the generated module with a fetch that reads files
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => String(url).startsWith('file:')
  ? new Response(fs.readFileSync(new URL(String(url)))) : nativeFetch(url, ...rest);
const { REAL_BUILDINGS } = await import('../../js/building-geodata.js');
globalThis.fetch = nativeFetch;

const lots = JSON.parse(fs.readFileSync(PLUTO_FILE, 'utf8'));
const parts = JSON.parse(fs.readFileSync(PARTS_FILE, 'utf8')).elements;
const tagged = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf8')).elements;

// Spatial index of the buildings by 64 m cells
const CELL = 64;
const cells = new Map();
REAL_BUILDINGS.forEach((b, i) => {
  for (let x = Math.floor(b.minX / CELL); x <= Math.floor(b.maxX / CELL); x++) {
    for (let z = Math.floor(b.minZ / CELL); z <= Math.floor(b.maxZ / CELL); z++) {
      const key = x + ',' + z;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(i);
    }
  }
});
function inRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z)) inside = !inside;
  }
  return inside;
}
const inBuilding = (b, x, z) => b.polygons.some((p) => inRing(p.outer, x, z) && !p.holes.some((h) => inRing(h, x, z)));
function buildingAt(x, z, reach = 0) {
  const here = cells.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL)) || [];
  for (const i of here) if (inBuilding(REAL_BUILDINGS[i], x, z)) return i;
  if (!reach) return -1;
  // Nearest wall within reach
  let best = -1, bestD = reach;
  for (let cx = Math.floor((x - reach) / CELL); cx <= Math.floor((x + reach) / CELL); cx++) {
    for (let cz = Math.floor((z - reach) / CELL); cz <= Math.floor((z + reach) / CELL); cz++) {
      for (const i of cells.get(cx + ',' + cz) || []) {
        for (const p of REAL_BUILDINGS[i].polygons) {
          const r = p.outer;
          for (let k = 0; k < r.length; k++) {
            const a = r[k], c = r[(k + 1) % r.length];
            const dx = c.x - a.x, dz = c.z - a.z, l2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
            const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
            if (d < bestD) { bestD = d; best = i; }
          }
        }
      }
    }
  }
  return best;
}

// Building classes as one number: letter and digit (D4 = 4 * 32 + 4 ... kept readable: 'D'.code * 10 + digit)
const classCode = (s) => (s && /^[A-Z][0-9A-Z]$/.test(s) ? (s.charCodeAt(0) - 64) * 40 + parseInt(s[1], 36) + 1 : 0);
const districts = [];
const districtCode = (name) => {
  if (!name) return 0;
  let i = districts.indexOf(name);
  if (i < 0) { districts.push(name); i = districts.length - 1; }
  return i + 1;
};
const NAMED = { black: 0x222222, white: 0xf2f0ea, beige: 0xd8c8a8, tan: 0xc9a87c, brown: 0x7a5236, red: 0x9e3b2c, maroon: 0x6b2a22,
  gray: 0x8c8c8c, grey: 0x8c8c8c, silver: 0xb8bcc0, yellow: 0xd8c070, cream: 0xe8dcc0, orange: 0xc07040, green: 0x4a6a4a,
  blue: 0x4a6080, darkgray: 0x505050, darkgrey: 0x505050, lightgray: 0xc0c0c0, lightgrey: 0xc0c0c0, pink: 0xd0a0a0,
  ivory: 0xeee8d8, sandybrown: 0xd4a060, burlywood: 0xdeb887, wheat: 0xf5deb3, gold: 0xc8a040, bronze: 0x6a5030 };
function colourCode(text) {
  if (!text) return 0;
  const t = text.trim().toLowerCase().replace(/[\s_-]/g, '');
  let rgb = NAMED[t];
  const hex = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/.exec(t);
  if (hex) rgb = parseInt(hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1], 16);
  return rgb === undefined ? 0 : rgb + 1;
}
const MATERIALS = ['', 'brick', 'glass', 'stone', 'limestone', 'concrete', 'metal', 'plaster', 'marble', 'sandstone', 'granite', 'wood', 'masonry'];
const materialCode = (text) => Math.max(0, MATERIALS.indexOf((text || '').split(';')[0].trim().toLowerCase()));
const ROOFS = ['', 'flat', 'gabled', 'pyramidal', 'skillion', 'hipped', 'dome', 'mansard', 'round', 'onion', 'cone'];
const roofCode = (text) => Math.max(0, ROOFS.indexOf((text || '').trim().toLowerCase()));
function metres(text) {
  if (!text) return NaN;
  const m = /^\s*([\d.]+)\s*(m|ft|'|feet)?/.exec(String(text));
  if (!m) return NaN;
  return parseFloat(m[1]) * (m[2] && m[2] !== 'm' ? 0.3048 : 1);
}

// What each building is: the PLUTO lot whose centroid it holds (the biggest building on it wins), or the nearest
const facts = REAL_BUILDINGS.map(() => ({ cls: 0, floors: 0, year: 0, hist: 0, landmark: 0, units: 0, area: -1,
  colour: 0, material: 0, roof: 0, roofColour: 0, parts: [] }));
let lotHits = 0, lotNear = 0;
for (const lot of lots) {
  const lon = +lot.longitude, lat = +lot.latitude;
  if (!lon || !lat) continue;
  const [x, z] = toWorld(lon, lat);
  let i = buildingAt(x, z);
  if (i >= 0) lotHits++;
  else if ((i = buildingAt(x, z, 18)) >= 0) lotNear++;
  else continue;
  const f = facts[i], area = +lot.bldgarea || 0;
  if (area <= f.area) continue;
  Object.assign(f, { cls: classCode(lot.bldgclass), floors: Math.round(+lot.numfloors || 0), year: +lot.yearbuilt || 0,
    hist: districtCode(lot.histdist), landmark: lot.landmark ? 1 : 0, units: Math.min(4000, +lot.unitsres || 0), area });
}
// Buildings no lot centroid fell in take the lot of their nearest neighbour on the block
let borrowed = 0;
REAL_BUILDINGS.forEach((b, i) => {
  if (facts[i].cls) return;
  let best = -1, bestD = 30;
  for (const j of cells.get(Math.floor(b.cx / CELL) + ',' + Math.floor(b.cz / CELL)) || []) {
    const d = Math.hypot(REAL_BUILDINGS[j].cx - b.cx, REAL_BUILDINGS[j].cz - b.cz);
    if (j !== i && facts[j].cls && d < bestD && facts[j].area >= 0) { bestD = d; best = j; }
  }
  if (best < 0) return;
  const s = facts[best];
  Object.assign(facts[i], { cls: s.cls, floors: 0, year: s.year, hist: s.hist, units: 0 });
  borrowed++;
});

// Colours, materials and roofs mappers recorded on whole buildings
for (const e of tagged) {
  if (!e.center) continue;
  const [x, z] = toWorld(e.center.lon, e.center.lat);
  const i = buildingAt(x, z, 4);
  if (i < 0) continue;
  const t = e.tags || {}, f = facts[i];
  f.colour ||= colourCode(t['building:colour']);
  f.material ||= materialCode(t['building:material']);
  f.roof ||= roofCode(t['roof:shape']);
  f.roofColour ||= colourCode(t['roof:colour']);
}

// Building parts: their own outline between their own heights
let partsKept = 0;
const ringArea = (r) => Math.abs(r.reduce((n, a, k) => { const c = r[(k + 1) % r.length]; return n + a.x * c.z - c.x * a.z; }, 0)) / 2;
for (const e of parts) {
  const t = e.tags || {};
  const rings = e.type === 'way' ? [e.geometry] : (e.members || []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry);
  let top = metres(t.height), base = metres(t.min_height);
  if (!(top > 0) && t['building:levels']) top = +t['building:levels'] * 3.6 + (+t['building:min_level'] || 0) * 3.6;
  if (!(base >= 0)) base = t['building:min_level'] ? +t['building:min_level'] * 3.6 : 0;
  if (!(top > base + 0.5)) continue;
  for (const geom of rings) {
    if (!geom || geom.length < 4) continue;
    const ring = geom.map((g) => { const [x, z] = toWorld(g.lon, g.lat); return { x: Math.round(x * 2) / 2, z: Math.round(z * 2) / 2 }; });
    if (ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].z === ring[ring.length - 1].z) ring.pop();
    if (ring.length < 3 || ringArea(ring) < 4) continue;
    const cx = ring.reduce((n, p) => n + p.x, 0) / ring.length, cz = ring.reduce((n, p) => n + p.z, 0) / ring.length;
    let i = buildingAt(cx, cz);
    if (i < 0) i = ring.map((p) => buildingAt(p.x * 0.9 + cx * 0.1, p.z * 0.9 + cz * 0.1)).find((k) => k >= 0) ?? -1;
    if (i < 0) continue;
    facts[i].parts.push({ ring, base: Math.max(0, base), top, colour: colourCode(t['building:colour']), roof: roofCode(t['roof:shape']),
      material: materialCode(t['building:material']), area: ringArea(ring) });
    partsKept++;
  }
}
// Parts only stand in for a building whose footprint they cover, roughly at its height
let tiered = 0, partsUsed = 0;
REAL_BUILDINGS.forEach((b, i) => {
  const f = facts[i];
  if (!f.parts.length) return;
  const area = b.polygons.reduce((n, p) => n + ringArea(p.outer) - p.holes.reduce((m, h) => m + ringArea(h), 0), 0);
  const groundCover = f.parts.filter((p) => p.base < 1).reduce((n, p) => n + p.area, 0);
  const tallest = Math.max(...f.parts.map((p) => p.top));
  const ok = groundCover > area * 0.75 && groundCover < area * 1.6 && tallest > b.height * 0.8 && tallest < b.height * 1.35 + 6;
  if (!ok || f.parts.length < 2) { f.parts = []; return; }
  tiered++; partsUsed += f.parts.length;
});

// NBS1: header (magic, count, checksum of the buildings it was made for), then varints
const bytes = [];
const uint = (v) => { v = Math.max(0, Math.round(v)); do { let b = v & 127; v = Math.floor(v / 128); if (v) b |= 128; bytes.push(b); } while (v); };
const sint = (v) => uint(v < 0 ? -2 * v - 1 : 2 * v);
let check = 0;
for (const b of REAL_BUILDINGS) check = (check * 31 + Math.round(b.polygons[0].outer[0].x * 2) + Math.round(b.polygons[0].outer[0].z * 2) * 7) >>> 0;
uint(districts.length);
const names = Buffer.from(JSON.stringify(districts), 'utf8');
uint(names.length); for (const c of names) bytes.push(c);
for (const f of facts) {
  uint(f.cls); uint(f.floors); uint(f.year); uint(f.hist); uint(f.landmark); uint(f.units);
  uint(f.colour); uint(f.material); uint(f.roof); uint(f.roofColour);
  uint(f.parts.length);
  for (const p of f.parts) {
    uint(p.base * 10); uint(p.top * 10); uint(p.colour); uint(p.roof); uint(p.material);
    uint(p.ring.length);
    let px = 0, pz = 0;
    for (const q of p.ring) { sint(q.x * 2 - px); sint(q.z * 2 - pz); px = q.x * 2; pz = q.z * 2; }
  }
}
const header = Buffer.alloc(12);
header.writeUInt32LE(0x3153424e, 0); header.writeUInt32LE(REAL_BUILDINGS.length, 4); header.writeUInt32LE(check, 8);
const out = gzipSync(Buffer.concat([header, Buffer.from(bytes)]), { level: 9 });
fs.writeFileSync(OUTPUT, out);
const n = REAL_BUILDINGS.length;
console.log(`buildings ${n}: lot inside ${lotHits}, lot near ${lotNear}, borrowed ${borrowed}, unknown ${facts.filter((f) => !f.cls).length}`);
console.log(`colour ${facts.filter((f) => f.colour).length}, material ${facts.filter((f) => f.material).length}, parts kept ${partsKept}, tiered buildings ${tiered} (${partsUsed} parts)`);
console.log(`districts ${districts.length}; ${out.length} bytes`);
