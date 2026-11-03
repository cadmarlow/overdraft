// Generate js/storefront-geodata.bin.gz: every ground-floor storefront the city registers in Manhattan, placed in the
// game frame with the street its address faces, and given a kind of shop (js/storefront-types.js).
//
// Sources (NYC Open Data):
// - Storefronts Reported Vacant or Not (Local Law 157), reporting year 2025: one row per storefront, with the
//   property's position, the storefront's street address and whether it was vacant. Its business activity labels
//   are unusable from 2023 on (Manhattan's top activity becomes "educational services", food services all but
//   vanish), so each property's mix of activities comes from the 2021-2022 filings, whose labels are sound.
// - DOHMH Restaurant Inspection Results: every restaurant at its own position, with its cuisine, so a pizzeria
//   stands where a pizzeria stands. Names are never used: every shop name in the game is invented.
//
// Usage: node tools/shops/build-storefronts.mjs [--fetch]
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import { toWorld } from '../geo-base.mjs';
import { GEO } from '../../js/nyc-geodata.js';
import { SHOP_TYPES, SHOP_TYPE_INDEX } from '../../js/storefront-types.js';

const REGISTRY = 'https://data.cityofnewyork.us/resource/92iy-9c3n.json';
const RESTAURANTS = 'https://data.cityofnewyork.us/resource/43nn-pn8j.json';
const YEAR = '2025';
const CACHE_REGISTRY = new URL('../data/storefronts_manhattan.json', import.meta.url);
const CACHE_ACTIVITIES = new URL('../data/storefronts_manhattan_2021.json', import.meta.url);
const CACHE_RESTAURANTS = new URL('../data/restaurants_manhattan.json', import.meta.url);
const CSCL = new URL('../data/cscl_manhattan.json', import.meta.url);
const OUTPUT = new URL('../../js/storefront-geodata.bin.gz', import.meta.url);

async function download(base, params) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`${base}: HTTP ${response.status}`);
  return response.json();
}

let registry, activities, restaurants;
if (process.argv.includes('--fetch')) {
  const rows = await download(REGISTRY, { $where: `borough='MANHATTAN' AND reporting_year='${YEAR}'`, $limit: '60000' });
  if (rows.length < 10000 || rows.length >= 60000) throw new Error(`Unexpected registry size ${rows.length}`);
  registry = {
    source: REGISTRY, year: YEAR, retrieved: new Date().toISOString().slice(0, 10),
    rows: rows.map((r) => [r.bbl, r.property_street_address_or || '', r.property_street || '', r.primary_business_activity || '',
      r.vacant_on_12_31 || '', Number(r.latitude), Number(r.longitude), r.nbhd || ''])
  };
  fs.writeFileSync(CACHE_REGISTRY, JSON.stringify(registry) + '\n');
  const older = await download(REGISTRY, {
    $select: 'bbl,primary_business_activity,vacant_on_12_31',
    $where: "borough='MANHATTAN' AND reporting_year='2021 and 2022'", $limit: '60000'
  });
  if (older.length < 10000 || older.length >= 60000) throw new Error(`Unexpected 2021-2022 registry size ${older.length}`);
  activities = { source: REGISTRY, year: '2021 and 2022', retrieved: registry.retrieved,
    rows: older.map((r) => [r.bbl, r.primary_business_activity || '', r.vacant_on_12_31 || '']) };
  fs.writeFileSync(CACHE_ACTIVITIES, JSON.stringify(activities) + '\n');
  const food = await download(RESTAURANTS, {
    $select: 'camis,cuisine_description,latitude,longitude,street',
    $where: "boro='Manhattan'",
    $group: 'camis,cuisine_description,latitude,longitude,street',
    $limit: '60000'
  });
  if (food.length < 5000 || food.length >= 60000) throw new Error(`Unexpected restaurant count ${food.length}`);
  restaurants = {
    source: RESTAURANTS, retrieved: registry.retrieved,
    rows: food.map((r) => [r.camis, r.cuisine_description || '', Number(r.latitude), Number(r.longitude), r.street || ''])
  };
  fs.writeFileSync(CACHE_RESTAURANTS, JSON.stringify(restaurants) + '\n');
} else {
  registry = JSON.parse(fs.readFileSync(CACHE_REGISTRY, 'utf8'));
  activities = JSON.parse(fs.readFileSync(CACHE_ACTIVITIES, 'utf8'));
  restaurants = JSON.parse(fs.readFileSync(CACHE_RESTAURANTS, 'utf8'));
}

// ---- Street names: the registry, the inspections and the centreline spell them three different ways ---------------
const NUMBER_WORDS = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6, SEVENTH: 7, EIGHTH: 8, NINTH: 9,
  TENTH: 10, ELEVENTH: 11, TWELFTH: 12 };
const WORDS = { AVENUE: 'AVE', AV: 'AVE', STREET: 'ST', PLACE: 'PL', BOULEVARD: 'BLVD', DRIVE: 'DR', ROAD: 'RD',
  SQUARE: 'SQ', PLAZA: 'PLZ', TERRACE: 'TER', LANE: 'LN', PARKWAY: 'PKWY', SLIP: 'SLIP' };
function streetKey(raw) {
  let s = String(raw).toUpperCase().replace(/[.,']/g, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\b(\d+)(ST|ND|RD|TH)\b/g, '$1');
  s = s.split(' ').map((w) => NUMBER_WORDS[w] ?? WORDS[w] ?? w).join(' ');
  s = s.replace(/^(EAST|E) (\d)/, 'E $2').replace(/^(WEST|W) (\d)/, 'W $2').replace(/^SAINT /, 'ST ');
  if (/^(AVE OF THE AMER|6 AVE$)/.test(s)) s = 'AVE OF THE AMERICAS';
  if (/^ADAM C(LAYTON)? POWELL/.test(s)) s = 'ADAM CLAYTON POWELL JR BLVD';
  if (s === 'LENOX AVE') s = 'MALCOLM X BLVD';
  if (s === 'MALCOLM X AVE') s = 'MALCOLM X BLVD';
  if (s === 'W END AVE') s = 'W END AVE';
  return s;
}
// A storefront's own address ("777 3 AVENUE", "156-A MOTT ST") without its house number
const addressStreet = (address) => address.replace(/^[0-9A-Z/-]*[0-9][0-9A-Z/-]*\s+/i, '');

// ---- The centreline, by street ---------------------------------------------------------------------------------------
const segmentsByKey = new Map();
const allSegments = [];
for (const s of JSON.parse(fs.readFileSync(CSCL, 'utf8'))) {
  if (!s.the_geom || s.rw_type !== '1') continue;
  const lines = s.the_geom.type === 'MultiLineString' ? s.the_geom.coordinates : [s.the_geom.coordinates];
  const key = streetKey(s.full_street_name);
  for (const line of lines) {
    const pts = line.map(([lon, lat]) => toWorld(lon, lat));
    for (let i = 0; i + 1 < pts.length; i++) {
      const seg = { ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1], key };
      allSegments.push(seg);
      if (!segmentsByKey.has(key)) segmentsByKey.set(key, []);
      segmentsByKey.get(key).push(seg);
      // Numbered streets also answer to their bare number, whichever side of 5th Ave the address says
      const bare = key.replace(/^[EW] (\d)/, '$1');
      if (bare !== key) {
        if (!segmentsByKey.has(bare)) segmentsByKey.set(bare, []);
        segmentsByKey.get(bare).push(seg);
      }
    }
  }
}
function nearestOn(segments, x, z, maxDist) {
  let best = null, bestD = maxDist * maxDist;
  for (const s of segments) {
    const dx = s.bx - s.ax, dz = s.bz - s.az, len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / len2));
    const px = s.ax + dx * t, pz = s.az + dz * t, d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bestD) { bestD = d; best = [px, pz]; }
  }
  return best;
}
// Segment grid for the fallback search
const CELL = 100;
const grid = new Map();
for (const s of allSegments) {
  const x0 = Math.floor(Math.min(s.ax, s.bx) / CELL), x1 = Math.floor(Math.max(s.ax, s.bx) / CELL);
  const z0 = Math.floor(Math.min(s.az, s.bz) / CELL), z1 = Math.floor(Math.max(s.az, s.bz) / CELL);
  for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
    const k = i + ',' + j;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  }
}
function segmentsNear(x, z, r) {
  const out = new Set();
  for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
    for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++)
      for (const s of grid.get(i + ',' + j) || []) out.add(s);
  return [...out];
}
function streetPoint(key, x, z) {
  const named = segmentsByKey.get(key) || segmentsByKey.get(key.replace(/^[EW] (\d)/, '$1'));
  const local = named && named.filter((s) => Math.min(Math.abs(s.ax - x) + Math.abs(s.az - z), Math.abs(s.bx - x) + Math.abs(s.bz - z)) < 2000);
  const hit = local && local.length ? nearestOn(local, x, z, 160) : null;
  if (hit) return { point: hit, named: true };
  return { point: nearestOn(segmentsNear(x, z, 120), x, z, 120), named: false };
}

// ---- On the detailed island only --------------------------------------------------------------------------------------
function onIsland(x, z) {
  if (z < GEO.frame.cutZ) return false;
  const ring = GEO.manhattan;
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[j], az = ring[j + 1], bx = ring[i], bz = ring[i + 1];
    if ((az > z) !== (bz > z) && x < ax + (z - az) * (bx - ax) / (bz - az)) inside = !inside;
  }
  return inside;
}

// ---- Deterministic choices ----------------------------------------------------------------------------------------------
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(weights, r) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((n, [, w]) => n + w, 0);
  let t = r * total;
  for (const [id, w] of entries) { t -= w; if (t <= 0) return id; }
  return entries[entries.length - 1][0];
}

// ---- What a registered activity becomes, street by street ----------------------------------------------------------------
const CUISINE = (c) => {
  if (/^Pizza/.test(c)) return 'pizza';
  if (/Coffee|Tea/.test(c)) return 'cafe';
  if (/Bakery|Donut|Bagel|Pancake|Waffle/.test(c)) return 'bakery';
  if (/Juice|Frozen|Bottled|Smoothie/.test(c)) return 'juice';
  if (/Japanese/.test(c)) return 'sushi';
  if (/Chinese|Asian|Southeast|Thai|Korean|Filipino|Vietnam/.test(c)) return 'takeout';
  if (/Mexican|Latin|Tex-Mex|Caribbean|Spanish|Peruvian|Brazilian|Chilean|Dominican|Puerto/.test(c)) return 'latin';
  if (/Irish|Bar|Pub|Beer|Wine/.test(c)) return 'bar';
  if (/Hamburger|Chicken|Sandwich|Salad|Soul|Hotdog|Diner|Jewish|Kosher|Soups/.test(c)) return 'diner';
  if (/American/.test(c)) return null; // decided below: a bar, a diner or a restaurant
  if (c) return 'restaurant';
  return null;
};
const FOOD_DEFAULT = { restaurant: 30, pizza: 12, cafe: 15, takeout: 14, bar: 12, diner: 10, bakery: 6, latin: 6, juice: 3 };
const AMERICAN = { restaurant: 40, bar: 32, diner: 28 };

const RETAIL_DEFAULT = { bodega: 22, boutique: 18, phones: 8, pharmacy: 6, shoes: 6, liquor: 6, florist: 4, hardware: 5,
  books: 3, jewelry: 4, luxury: 1, souvenir: 1 };
const RETAIL_BY_AREA = [
  [/Times Square/, { souvenir: 18, phones: 10, boutique: 15, shoes: 8, luxury: 4, jewelry: 8, bodega: 14, pharmacy: 6 }],
  [/SoHo|Tribeca/, { boutique: 40, luxury: 14, shoes: 12, jewelry: 6, books: 4, florist: 3, bodega: 6 }],
  [/Upper East Side/, { boutique: 26, luxury: 10, jewelry: 6, florist: 7, pharmacy: 7, bodega: 12, shoes: 6, liquor: 6, books: 3, hardware: 3 }],
  [/Chinatown/, { bodega: 26, jewelry: 12, phones: 12, pharmacy: 6, boutique: 10, shoes: 6, florist: 2, hardware: 4, souvenir: 4 }],
  [/East Village|Lower East Side/, { bodega: 24, boutique: 16, books: 7, liquor: 8, phones: 6, shoes: 5, florist: 4, hardware: 4, jewelry: 2 }],
  [/West Village|Greenwich/, { boutique: 26, books: 7, florist: 6, bodega: 16, liquor: 7, jewelry: 4, shoes: 5, luxury: 3, pharmacy: 4 }],
  [/Harlem|Washington Heights|Inwood|Hamilton|Manhattanville|Morningside/, { bodega: 34, phones: 12, shoes: 10, pharmacy: 8, boutique: 10, liquor: 6, hardware: 6, jewelry: 3, florist: 2 }],
  [/Financial|Battery/, { bodega: 18, pharmacy: 12, boutique: 12, phones: 8, souvenir: 8, shoes: 6, liquor: 4, jewelry: 4, luxury: 2 }],
  [/Chelsea|Flatiron|Union Square/, { boutique: 26, shoes: 8, phones: 8, bodega: 14, books: 4, florist: 6, hardware: 4, pharmacy: 6, luxury: 3, gallery: 6 }]
];
const SERVICE = { laundromat: 24, cleaners: 26, barber: 20, salon: 26, office: 4 };
const OTHER = { bodega: 14, boutique: 14, salon: 10, office: 16, restaurant: 8, phones: 7, laundromat: 5, cleaners: 6, barber: 6,
  cafe: 4, pharmacy: 3 };

function retailWeights(nbhd, key, x, z) {
  const fifth = 0, sixth = -296;
  // The diamond district: West 47th Street between 5th and 6th Avenues
  if (/^W 47 ST$/.test(key) && x < fifth + 10 && x > sixth - 10) return { jewelry: 85, boutique: 5, bodega: 5, phones: 5 };
  // Fifth Avenue's flagships from 49th to 60th Street, and Madison Avenue uptown
  if (key === '5 AVE' && z < -500 && z > -1420) return { luxury: 58, jewelry: 14, boutique: 22, shoes: 6 };
  if (key === 'MADISON AVE' && z < -1300 && z > -3400) return { luxury: 34, boutique: 30, jewelry: 10, shoes: 8, florist: 6, books: 2 };
  for (const [re, weights] of RETAIL_BY_AREA) if (re.test(nbhd)) return weights;
  return RETAIL_DEFAULT;
}

function foodType(cuisine, nbhd, rand) {
  if (cuisine) {
    const kind = CUISINE(cuisine);
    if (kind) return kind;
    if (/American/.test(cuisine)) return pick(AMERICAN, rand());
  }
  if (/Chinatown/.test(nbhd)) return pick({ takeout: 50, bakery: 14, restaurant: 18, cafe: 8, juice: 10 }, rand());
  return pick(FOOD_DEFAULT, rand());
}

// Anything but food (restaurants come from the inspections): what an activity becomes on this street
function otherType(activity, nbhd, key, x, z, rand) {
  if (/^RETAIL/.test(activity)) {
    // Chelsea's west side is where the galleries are
    if (/Chelsea/.test(nbhd) && x < -1100 && rand() < 0.55) return 'gallery';
    return pick(retailWeights(nbhd, key, x, z), rand());
  }
  if (/MISCELLANEOUS OTHER SERVICE/.test(activity)) return pick(SERVICE, rand());
  if (/HEALTH/.test(activity)) return pick({ pharmacy: 45, office: 45, salon: 10 }, rand());
  if (/FINANCE/.test(activity)) return pick({ bank: 62, office: 38 }, rand());
  if (/REAL ESTATE|LEGAL|ACCOUNTING|PUBLISHING|INFORMATION|BROADCASTING|MOVIES|EDUCATIONAL/.test(activity)) {
    if (/SoHo|Chelsea|Tribeca/.test(nbhd) && rand() < 0.3) return 'gallery';
    return 'office';
  }
  if (/WHOLESALE|MANUFACTURING/.test(activity)) return pick({ boutique: 36, office: 26, hardware: 16, phones: 10, shoes: 12 }, rand());
  if (/Chelsea/.test(nbhd) && x < -1100 && rand() < 0.4) return 'gallery';
  // No usable activity: what the neighbourhood's shops mostly are
  if (rand() < 0.5) return pick(retailWeights(nbhd, key, x, z), rand());
  return pick(OTHER, rand());
}

// ---- Restaurants, at their own positions ------------------------------------------------------------------------------
const restaurantGrid = new Map();
const allRestaurants = [];
for (const [camis, cuisine, lat, lon, street] of restaurants.rows) {
  if (!(lat > 40 && lon < -73)) continue;
  const [x, z] = toWorld(lon, lat);
  if (!onIsland(x, z)) continue;
  const k = Math.floor(x / 50) + ',' + Math.floor(z / 50);
  if (!restaurantGrid.has(k)) restaurantGrid.set(k, []);
  const r = { camis, cuisine, x, z, key: streetKey(street), used: false };
  restaurantGrid.get(k).push(r);
  allRestaurants.push(r);
}
// The nearest restaurant not placed yet, on the same street if there is one
function takeRestaurant(x, z, key, reach = 45) {
  let best = null, bestD = reach * reach;
  for (let i = Math.floor(x / 50) - 1; i <= Math.floor(x / 50) + 1; i++)
    for (let j = Math.floor(z / 50) - 1; j <= Math.floor(z / 50) + 1; j++)
      for (const r of restaurantGrid.get(i + ',' + j) || []) {
        if (r.used) continue;
        const d = (r.x - x) ** 2 + (r.z - z) ** 2 + (r.key === key ? 0 : 600);
        if (d < bestD) { bestD = d; best = r; }
      }
  if (best) best.used = true;
  return best;
}

// ---- Each property's mix of activities, from the filings whose labels are sound ----------------------------------------
const pools = new Map();
for (const [bbl, activity, vacant] of activities.rows) {
  if (vacant === 'YES' || !activity || /NO BUSINESS/.test(activity)) continue;
  if (!pools.has(bbl)) pools.set(bbl, []);
  pools.get(bbl).push(activity);
}

// ---- Build ----------------------------------------------------------------------------------------------------------------
const out = [];
let unnamed = 0, offIsland = 0, noStreet = 0, standalone = 0, matchedFood = 0;
const counts = {};
function emit(x, z, key, type) {
  const found = streetPoint(key, x, z);
  if (!found.point) { noStreet++; return; }
  if (!found.named) unnamed++;
  counts[type] = (counts[type] || 0) + 1;
  out.push({ x, z, sx: found.point[0], sz: found.point[1], type: SHOP_TYPE_INDEX[type] });
}
const rows = registry.rows.filter((r) => r[5] > 40 && r[6] < -73);
// Stable order: by property then address, so the hashed choices don't shift when the city adds a row elsewhere
rows.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
const left = new Map(); // what is left of each property's 2021-2022 mix
rows.forEach((row, index) => {
  const [bbl, address, street, , vacant, lat, lon, nbhd] = row;
  const [x, z] = toWorld(lon, lat);
  if (!onIsland(x, z)) { offIsland++; return; }
  const key = streetKey(addressStreet(address) || street);
  const rand = mulberry32(hashString(bbl + '|' + address + '|' + index));
  if (vacant === 'YES') { emit(x, z, key, 'vacant'); return; }
  if (!left.has(bbl)) left.set(bbl, [...(pools.get(bbl) || [])]);
  const pool = left.get(bbl);
  const activity = pool.length ? pool.splice(Math.floor(rand() * pool.length), 1)[0] : '';
  const food = /FOOD/.test(activity) || (!activity && rand() < 0.28);
  if (food) {
    const r = takeRestaurant(x, z, key);
    if (r) matchedFood++;
    emit(x, z, key, foodType(r && r.cuisine, nbhd, rand));
    return;
  }
  emit(x, z, key, otherType(activity, nbhd, key, x, z, rand));
});
// Restaurants the registry doesn't list (not every property has to file) stand on their own
for (const r of allRestaurants) {
  if (r.used) continue;
  standalone++;
  emit(r.x, r.z, r.key, foodType(r.cuisine, '', mulberry32(hashString(r.camis))));
}

// NYS1: magic, count, then int16 x, z, street x, street z (0.5 m) and a uint8 type per storefront
const n = out.length;
const buffer = Buffer.alloc(8 + n * 9);
buffer.writeUInt32LE(0x3153594e, 0);
buffer.writeUInt32LE(n, 4);
const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 2)));
out.forEach((s, i) => {
  buffer.writeInt16LE(q(s.x), 8 + i * 2);
  buffer.writeInt16LE(q(s.z), 8 + n * 2 + i * 2);
  buffer.writeInt16LE(q(s.sx), 8 + n * 4 + i * 2);
  buffer.writeInt16LE(q(s.sz), 8 + n * 6 + i * 2);
  buffer.writeUInt8(s.type, 8 + n * 8 + i);
});
fs.writeFileSync(OUTPUT, gzipSync(buffer, { level: 9 }));
console.log(`[storefronts] ${n} storefronts, ${matchedFood} registry food slots matched to a restaurant, ${standalone} restaurants on their own (${offIsland} beyond the detailed island, ${noStreet} with no street, ` +
  `${unnamed} facing the nearest street instead of their own) -> ${fs.statSync(OUTPUT).size} bytes`);
console.log('[storefronts]', SHOP_TYPES.map((t) => `${t.id} ${counts[t.id] || 0}`).join(', '));
