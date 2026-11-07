// Generate js/street-geodata.bin.gz: where Manhattan's real street furniture stands, one kind of object per dataset
// (hydrants, bus shelters and stops, newsstands, bike racks, benches, LinkNYC kiosks, parking meters, active sidewalk
// sheds, outdoor dining), in game metres (tools/geo-base.mjs toWorld), on the detailed island only.
//
// Sources: NYC Open Data (data.cityofnewyork.us) and the MTA on Open NY (data.ny.gov), both public Socrata APIs that
// need no account. See tools/street/README.md for what each dataset holds and how it is filtered.
//
// File layout (then gzipped, level 9):
//   uint32 LE  n, the byte length of the JSON header (spaces included)
//   n bytes    UTF-8 JSON { version, frame: 'game metres', retrieved, kinds: { name: { offset, stride, count, fields } },
//              sources: [{ kind, name, agency, id, url, retrieved, licence }] }, space-padded so 4 + n is a multiple of 4
//   then       one little-endian Float32 block per kind, in header order; kind k starts at float index
//              kinds[k].offset of this section (byte 4 + n + 4 * offset) and holds count * stride floats
//   Positions are x, z in metres (x = grid east, z = grid south), rounded to 1/16 m; strides are fixed per kind.
//
// Usage: node tools/street/build-street-data.mjs [--fetch] [<work dir>]
//   --fetch     download every dataset again (a dataset that fails keeps its previous cache), then build
//   <work dir>  where caches larger than 3 MB are kept instead of tools/data (none is, today)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { toWorld } from '../geo-base.mjs';
import { GEO } from '../../js/nyc-geodata.js';
import { ISLAND_BOUNDS } from '../../js/city-config.js';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const OUTPUT = fileURLToPath(new URL('../../js/street-geodata.bin.gz', import.meta.url));
const FETCH = process.argv.includes('--fetch');
const WORK = process.argv.slice(2).find((a) => !a.startsWith('--'));
const MAX_REPO_CACHE = 3 * 1024 * 1024;
const TODAY = new Date().toISOString().slice(0, 10);
const NYC = 'data.cityofnewyork.us';
const NYS = 'data.ny.gov';
const NYC_TERMS = 'NYC Open Data Terms of Use (https://data.cityofnewyork.us/stories/s/Terms-of-Use/k9k7-3cje)';
const NYS_TERMS = 'Open NY Terms of Use (https://data.ny.gov/download/77gx-ii52/application%2Fpdf); MTA data terms ' +
  '(https://www.mta.info/developers/terms-and-conditions)';
const log = (...a) => console.log('[street]', ...a);

// ---- Row helpers ----------------------------------------------------------------------------------------------------
const round7 = (v) => Math.round(v * 1e7) / 1e7;
const round6 = (v) => Math.round(v * 1e6) / 1e6;
// The dataset's own point geometry first (the frame of the city's other layers), its latitude/longitude columns next
function lonLat(r, geom, lat = 'latitude', lon = 'longitude') {
  const c = r[geom]?.coordinates;
  const p = c && c.length >= 2 ? [Number(c[0]), Number(c[1])] : [Number(r[lon]), Number(r[lat])];
  return p[0] > -74.3 && p[0] < -73.6 && p[1] > 40.4 && p[1] < 41 ? [round7(p[0]), round7(p[1])] : null;
}
// A shed's length when its filing states it: "+/- 122 LINEAR FEET OF TEMPORARY SIDEWALK SHED", "60LF NEW SIDEWALK
// SHED", "SIDEWALK SHED APPROXIMATELY 421' LONG". Lengths of fences and scaffolds in the same text are not taken.
const UNIT = String.raw`(?:L\.?\s?F\.?|LIN(?:EAR|\.)?\s*(?:FT|FEET|FOOT)\.?|FT\.?|FEET|FOOT|')`;
const FILL = String.raw`(?:(?:OF|THE|A|AN|NEW|TEMPORARY|TEMP\.?|HEAVY[- ]?DUTY|LIGHT[- ]?DUTY|STANDARD|PROPOSED|DOT|APPROVED|-|\(|\))\s*)*`;
const SHED_BEFORE = new RegExp(String.raw`(\d{1,4}(?:\.\d+)?)\s*${UNIT}\s*${FILL}(?:SIDEWALK\s*|CONSTRUCTION\s+(?:EQUIPMENT\s+)?)?SHED`, 'g');
const SHED_AFTER = new RegExp(String.raw`SIDEWALK\s+SHED\s*(?:=|:|-|\(|OF|APPROX\.?|APPROXIMATELY|\+\/-|\s)*\s*(\d{1,4}(?:\.\d+)?)\s*${UNIT}`, 'g');
function shedFeet(description) {
  const d = String(description || '').toUpperCase().replace(/\s+/g, ' ');
  const found = [...d.matchAll(SHED_BEFORE), ...d.matchAll(SHED_AFTER)].map((m) => Number(m[1])).filter((f) => f >= 4 && f <= 3000);
  return found.length ? Math.max(...found) : 0;
}

// ---- The datasets -----------------------------------------------------------------------------------------------------
// query: the SoQL filter; row: the cache row (identifier first, then lon, lat, then the kind's own columns); min/max:
// the plausible size of the download, outside which it is refused and the previous cache kept.
const SOURCES = [
  {
    kind: 'hydrant', stride: 2, fields: ['x', 'z'], name: 'Hydrants', agency: 'NYC Department of Environmental Protection (DEP)',
    domain: NYC, id: '5bgh-vtsn', min: 8000, max: 30000, columns: ['unitid', 'lon', 'lat'],
    query: { $select: 'unitid,the_geom,latitude,longitude', $where: 'boro=1' },
    row: (r) => [r.unitid || '', ...(lonLat(r, 'the_geom') || [null, null])]
  },
  {
    kind: 'shelter', stride: 2, fields: ['x', 'z'], name: 'Bus Stop Shelters', agency: 'NYC Department of Transportation (DOT)',
    domain: NYC, id: 't4f2-8md7', min: 500, max: 3000, columns: ['shelter_id', 'busstopid', 'lon', 'lat'],
    query: { $select: 'shelter_id,busstopid,longitude,latitude', $where: "upper(boro_name)='MANHATTAN'" },
    row: (r) => [r.shelter_id || '', r.busstopid || '', ...(lonLat(r, 'location1') || [null, null])]
  },
  {
    kind: 'busstop', stride: 2, fields: ['x', 'z'], name: 'MTA Bus Stops', agency: 'Metropolitan Transportation Authority (MTA)',
    domain: NYS, id: '2ucp-7wg5', min: 1500, max: 8000, columns: ['stop_id', 'lon', 'lat'],
    // One row per stop, route, direction and schedule bundle: the stops of the bundles in effect, around the island
    query: {
      $select: 'stop_id,latitude,longitude', $group: 'stop_id,latitude,longitude',
      $where: "in_effect='true' AND revenue_stop='1' AND latitude between 40.68 and 40.89 AND longitude between -74.03 and -73.90"
    },
    row: (r) => [r.stop_id || '', ...(lonLat(r, null) || [null, null])]
  },
  {
    kind: 'newsstand', stride: 2, fields: ['x', 'z'], name: 'Newsstands', agency: 'NYC Department of Transportation (DOT)',
    domain: NYC, id: 'w9zq-xm8b', min: 50, max: 1000, columns: ['news_stand_', 'lon', 'lat'],
    query: { $select: 'news_stand_,the_geom,latitude,longitude', $where: "upper(boro_name)='MANHATTAN'" },
    row: (r) => [r.news_stand_ || '', ...(lonLat(r, 'the_geom') || [null, null])]
  },
  {
    kind: 'bikerack', stride: 3, fields: ['x', 'z', 'racks'], name: 'Bicycle Parking', agency: 'NYC Department of Transportation (DOT)',
    domain: NYC, id: '592z-n7dk', min: 3000, max: 40000, columns: ['site_id', 'lon', 'lat'],
    // One row per rack (a corral lists each of its racks at its own position)
    query: { $select: 'site_id,the_geom,latitude,longitude', $where: "boroname='Manhattan'" },
    row: (r) => [r.site_id || '', ...(lonLat(r, 'the_geom') || [null, null])]
  },
  {
    kind: 'bench', stride: 2, fields: ['x', 'z'], name: 'Seating Locations', agency: 'NYC Department of Transportation (DOT)',
    domain: NYC, id: 'esmy-s8q5', min: 300, max: 5000, columns: ['siteid', 'lon', 'lat'],
    // Leaning bars are seating too, but not benches
    query: { $select: 'siteid,the_geom,latitude,longitude', $where: "boroname='Manhattan' AND (asset_subtype IS NULL OR asset_subtype != 'LEANING BAR')" },
    row: (r) => [r.siteid || '', ...(lonLat(r, 'the_geom') || [null, null])]
  },
  {
    kind: 'linknyc', stride: 2, fields: ['x', 'z'], name: 'LinkNYC Kiosk Locations', agency: 'NYC Office of Technology and Innovation (OTI)',
    domain: NYC, id: 's4kf-3yrf', min: 500, max: 4000, columns: ['link_site_id', 'lon', 'lat'],
    // Live kiosks only; the few old payphones the programme keeps are not kiosks
    query: { $select: 'link_site_id,latitude,longitude', $where: "boro='Manhattan' AND link_installation_status='Live' AND planned_kiosk_type != 'Public Payphones'" },
    row: (r) => [r.link_site_id || '', ...(lonLat(r, null) || [null, null])]
  },
  {
    kind: 'meter', stride: 2, fields: ['x', 'z'], name: 'Parking Meters Locations and Status', agency: 'NYC Department of Transportation (DOT)',
    domain: NYC, id: '693u-uax6', min: 1500, max: 15000, columns: ['meter_number', 'lon', 'lat'],
    // Active kerbside meters (pay stations): municipal lots are left out
    query: { $select: 'meter_number,location,lat,long', $where: "borough='Manhattan' AND upper(status)='ACTIVE' AND (facility IS NULL OR upper(facility)='ON STREET')" },
    row: (r) => [r.meter_number || '', ...(lonLat(r, 'location', 'lat', 'long') || [null, null])]
  },
  {
    kind: 'shed', stride: 3, fields: ['x', 'z', 'length'], name: 'DOB NOW: Build – Approved Permits (Sidewalk Shed)',
    agency: 'NYC Department of Buildings (DOB)', domain: NYC, id: 'rbx6-tga4', min: 1500, max: 12000, footprints: true,
    columns: ['job_filing_number', 'bin', 'lon', 'lat', 'feet', 'expires'],
    // A shed stands while its permit is issued, not signed off and not expired. The borough is spelled both ways.
    query: {
      $select: 'job_filing_number,bin,latitude,longitude,expired_date,job_description',
      $where: `work_type='Sidewalk Shed' AND upper(borough)='MANHATTAN' AND permit_status='Permit Issued' AND expired_date>='${TODAY}'`
    },
    row: (r) => [r.job_filing_number || '', r.bin || '', ...(lonLat(r, null) || [null, null]), shedFeet(r.job_description),
      String(r.expired_date || '').slice(0, 10)]
  },
  {
    kind: 'dining', stride: 2, fields: ['x', 'z'], name: 'Dining Out NYC Locations', agency: 'NYC Department of Transportation (DOT)',
    domain: NYC, id: 'fpeh-f7ci', min: 300, max: 6000, footprints: true, columns: ['bin', 'type', 'lon', 'lat'],
    // Licensed sidewalk (S) and roadway (R) cafés, located by the restaurant's address, not by the structure
    query: { $select: 'bin,license_type,location,latitude,longitude', $where: "borough='Manhattan' AND license_status='Issued'" },
    row: (r) => [String(r.bin || ''), r.license_type === 'Roadway' ? 'R' : 'S', ...(lonLat(r, 'location') || [null, null])]
  }
];

// ---- Download -----------------------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Socrata answers 503 now and then under load: retry, then give up on this dataset
async function getJSON(url) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (response.ok) return await response.json();
      last = new Error(`HTTP ${response.status}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      last = error;
    }
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(`${url.origin}${url.pathname}: ${last.message}`);
}
async function download(source) {
  const rows = [];
  const PAGE = 50000;
  for (let offset = 0; ; offset += PAGE) {
    const url = new URL(`https://${source.domain}/resource/${source.id}.json`);
    for (const [k, v] of Object.entries(source.query)) url.searchParams.set(k, v);
    url.searchParams.set('$order', source.query.$group ? source.query.$group : ':id');
    url.searchParams.set('$limit', String(PAGE));
    url.searchParams.set('$offset', String(offset));
    const page = await getJSON(url);
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}
// The outer walls of the buildings some filings name, from NYC Building Footprints by BIN (flat lon, lat rings).
// 1000000 is the placeholder BIN of a lot without a building of its own.
const FOOTPRINTS = { name: 'Building Footprints', agency: 'NYC Office of Technology and Innovation (OTI)', id: '5zhs-2jue' };
async function downloadFootprints(bins) {
  const list = [...new Set(bins.filter((bin) => /^1\d{6}$/.test(bin) && bin !== '1000000'))].sort();
  const out = {};
  for (let i = 0; i < list.length; i += 150) {
    const url = new URL(`https://${NYC}/resource/${FOOTPRINTS.id}.json`);
    url.searchParams.set('$select', 'bin,the_geom');
    url.searchParams.set('$where', `bin in (${list.slice(i, i + 150).join(',')})`);
    url.searchParams.set('$limit', '5000');
    for (const r of await getJSON(url)) {
      const g = r.the_geom;
      const polygons = g?.type === 'MultiPolygon' ? g.coordinates : g?.type === 'Polygon' ? [g.coordinates] : [];
      const bin = String(Number(r.bin));
      for (const polygon of polygons) (out[bin] ||= []).push(polygon[0].flatMap(([lon, lat]) => [round6(lon), round6(lat)]));
    }
  }
  return out;
}

const cacheName = (kind) => `street_${kind}.json`;
function readCache(kind) {
  for (const dir of [DATA, WORK].filter(Boolean)) {
    const file = path.join(dir, cacheName(kind));
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return null;
}
function writeCache(kind, cache) {
  const text = JSON.stringify(cache) + '\n';
  const inRepo = path.join(DATA, cacheName(kind));
  if (Buffer.byteLength(text) <= MAX_REPO_CACHE) {
    fs.writeFileSync(inRepo, text);
    return inRepo;
  }
  if (!WORK) throw new Error(`the ${kind} cache is ${(Buffer.byteLength(text) / 1e6).toFixed(1)} MB: pass a work directory`);
  fs.mkdirSync(WORK, { recursive: true });
  const outside = path.join(WORK, cacheName(kind));
  fs.writeFileSync(outside, text);
  fs.rmSync(inRepo, { force: true });
  return outside;
}

// ---- On the detailed island only (the ring js/nyc-geodata.js draws, south of its cut) ----------------------------------
function onIsland(x, z) {
  if (z < GEO.frame.cutZ) return false;
  if (x < ISLAND_BOUNDS.minX || x > ISLAND_BOUNDS.maxX || z < ISLAND_BOUNDS.minZ || z > ISLAND_BOUNDS.maxZ) return false;
  const ring = GEO.manhattan;
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[j], az = ring[j + 1], bx = ring[i], bz = ring[i + 1];
    if ((az > z) !== (bz > z) && x < ax + (z - az) * (bx - ax) / (bz - az)) inside = !inside;
  }
  return inside;
}

// ---- Build ------------------------------------------------------------------------------------------------------------------
const failures = [];
const caches = new Map();
for (const source of SOURCES) {
  if (FETCH) {
    try {
      const raw = await download(source);
      if (raw.length < source.min || raw.length > source.max) throw new Error(`unexpected size ${raw.length} (expected ${source.min}..${source.max})`);
      const rows = raw.map(source.row);
      const cache = { source: `https://${source.domain}/resource/${source.id}.json`, name: source.name, retrieved: TODAY,
        where: source.query.$where, columns: source.columns, rows };
      if (source.footprints) {
        const iBin = source.columns.indexOf('bin');
        cache.footprints = await downloadFootprints(rows.map((r) => r[iBin]));
        cache.footprintSource = `https://${NYC}/resource/${FOOTPRINTS.id}.json`;
      }
      const file = writeCache(source.kind, cache);
      log(`${source.kind}: ${raw.length} rows from ${source.id}${cache.footprints ? `, ${Object.keys(cache.footprints).length} building footprints` : ''}` +
        ` -> ${path.relative(process.cwd(), file)}`);
    } catch (error) {
      failures.push(`${source.kind}: ${error.message}`);
      log(`${source.kind}: download failed (${error.message}), keeping the previous cache if there is one`);
    }
  }
  const cache = readCache(source.kind);
  if (cache) caches.set(source.kind, cache);
  else if (!FETCH) failures.push(`${source.kind}: no cache (run with --fetch)`);
}

// Positions in game metres, kept on the island
const col = (cache, name) => cache.columns.indexOf(name);
function points(cache) {
  const iLon = col(cache, 'lon'), iLat = col(cache, 'lat');
  const out = [];
  let north = 0, offIsland = 0, invalid = 0;
  for (const row of cache.rows) {
    const lon = row[iLon], lat = row[iLat];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) { invalid++; continue; }
    const [x, z] = toWorld(lon, lat);
    if (z < GEO.frame.cutZ) { north++; continue; }
    if (!onIsland(x, z)) { offIsland++; continue; }
    out.push({ x, z, row });
  }
  return { out, north, offIsland, invalid };
}
// The point of a building's walls nearest to (x, z), or null when the building is not within reach
function nearestWall(rings, x, z, reach) {
  let best = null, bestD = reach * reach;
  for (const ring of rings) {
    for (let i = 0; i + 3 < ring.length; i += 2) {
      const ax = ring[i], az = ring[i + 1], dx = ring[i + 2] - ax, dz = ring[i + 3] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const px = ax + dx * t, pz = az + dz * t, d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < bestD) { bestD = d; best = [px, pz]; }
    }
  }
  return best;
}
// Shed and dining filings are geocoded on the street, a metre or two off its centreline on the address side and
// somewhere along the block face: stand each one on the wall of its own building (BIN footprint) nearest to that
// point, which faces the address street. Filings whose building has no footprint, or lies over 100 m away, stay put.
function anchorToWalls(list, cache) {
  const iBin = col(cache, 'bin');
  const world = new Map();
  const moves = [];
  for (const p of list) {
    const bin = p.row[iBin];
    if (!world.has(bin)) {
      world.set(bin, (cache.footprints?.[bin] || []).map((ring) => {
        const out = [];
        for (let i = 0; i + 1 < ring.length; i += 2) out.push(...toWorld(ring[i], ring[i + 1]));
        return out;
      }));
    }
    const wall = nearestWall(world.get(bin), p.x, p.z, 100);
    if (wall) { moves.push(Math.hypot(wall[0] - p.x, wall[1] - p.z)); p.x = wall[0]; p.z = wall[1]; }
  }
  moves.sort((a, b) => a - b);
  const at = (f) => (moves[Math.floor(moves.length * f)] ?? 0).toFixed(1);
  return `${moves.length} stood on their building's wall (moved ${at(0.5)} m, 90% under ${at(0.9)} m)`;
}
// Rounded to 1/16 m (exact in float32, and it gzips better); several rows at one spot (a building's two shed
// filings, a duplicated record) become one point
const q16 = (v) => Math.round(v * 16) / 16;
function merge(list, combine) {
  const byKey = new Map();
  for (const p of list) {
    p.x = q16(p.x); p.z = q16(p.z);
    const key = Math.round(p.x * 4) + ',' + Math.round(p.z * 4);
    const seen = byKey.get(key);
    if (seen) combine?.(seen, p);
    else byKey.set(key, p);
  }
  return [...byKey.values()];
}

const built = [];
for (const source of SOURCES) {
  const cache = caches.get(source.kind);
  if (!cache) continue;
  const { out, north, offIsland, invalid } = points(cache);
  let list = out;
  const notes = [];
  if (source.kind === 'busstop') {
    // One point per stop: a stop served by several routes may be listed at slightly different spots
    const byId = new Map();
    for (const p of list) if (!byId.has(p.row[0])) byId.set(p.row[0], p);
    list = [...byId.values()];
  }
  if (source.footprints) notes.push(anchorToWalls(list, cache));
  if (source.kind === 'bikerack') {
    for (const p of list) p.extra = 1;
    list = merge(list, (a, b) => { a.extra += b.extra; });
  } else if (source.kind === 'shed') {
    // Feet to metres; filings for the same address land on the same spot: keep the longest stated length
    const iFeet = col(cache, 'feet');
    for (const p of list) p.extra = Math.round(p.row[iFeet] * 0.3048 * 4) / 4;
    list = merge(list, (a, b) => { a.extra = Math.max(a.extra, b.extra); });
    notes.push(`${list.filter((p) => p.extra > 0).length} with a stated length`);
  } else {
    list = merge(list);
  }
  list.sort((a, b) => a.z - b.z || a.x - b.x);
  const values = new Float32Array(list.length * source.stride);
  list.forEach((p, i) => {
    values[i * source.stride] = p.x;
    values[i * source.stride + 1] = p.z;
    if (source.stride === 3) values[i * source.stride + 2] = p.extra;
  });
  built.push({ source, cache, values, count: list.length });
  log(`${source.kind}: ${list.length} points (${cache.rows.length} rows, ${north} north of the detailed island, ${offIsland} off its shore, ` +
    `${invalid} without coordinates` +
    `${notes.length ? ', ' + notes.join(', ') : ''})`);
}
if (!built.length) throw new Error('No street furniture dataset available.');

// ---- Write ------------------------------------------------------------------------------------------------------------------
const kinds = {};
let offset = 0;
for (const { source, values, count } of built) {
  kinds[source.kind] = { offset, stride: source.stride, count, fields: source.fields };
  offset += values.length;
}
const header = {
  version: 1,
  frame: 'game metres',
  retrieved: built.map((b) => b.cache.retrieved).sort().at(-1),
  kinds,
  sources: built.flatMap(({ source, cache }) => [
    { kind: source.kind, name: source.name, agency: source.agency, id: source.id,
      url: `https://${source.domain}/d/${source.id}`, retrieved: cache.retrieved, licence: source.domain === NYS ? NYS_TERMS : NYC_TERMS },
    ...(cache.footprints ? [{ kind: source.kind, name: `${FOOTPRINTS.name} (the walls its points stand on)`, agency: FOOTPRINTS.agency,
      id: FOOTPRINTS.id, url: `https://${NYC}/d/${FOOTPRINTS.id}`, retrieved: cache.retrieved, licence: NYC_TERMS }] : [])
  ])
};
let json = Buffer.from(JSON.stringify(header));
json = Buffer.concat([json, Buffer.alloc((4 - ((4 + json.length) % 4)) % 4, 0x20)]);
const body = Buffer.alloc(4 + json.length + offset * 4);
body.writeUInt32LE(json.length, 0);
json.copy(body, 4);
let at = 4 + json.length;
for (const { values } of built) for (const v of values) { body.writeFloatLE(v, at); at += 4; }
fs.writeFileSync(OUTPUT, gzipSync(body, { level: 9 }));
log(`${path.relative(process.cwd(), OUTPUT)}: ${built.map((b) => `${b.source.kind} ${b.count}`).join(', ')} -> ${fs.statSync(OUTPUT).size} bytes`);
for (const failure of failures) log(`missing or stale: ${failure}`);
