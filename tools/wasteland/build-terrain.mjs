#!/usr/bin/env node
// The relief of the Wasteland, baked once: real shorelines of the harbour (js/city-config.js), the dry bed of the
// Hudson, the filled East River, the Palisades, mesas, dune fields, and rain that never came back but left
// its gullies. Output: js/wasteland-terrain.bin.gz, read by js/wasteland-plan.js.
//   node tools/wasteland/build-terrain.mjs [--preview <folder>] [--no-erosion]
// File (gzip): uint32 LE header length, JSON header (space-padded to 4 bytes), then
//   height   uint16 per macro vertex, rows delta-coded, low bytes then high bytes
//   zone     uint8 per macro vertex (0 dry, 2 under the city)
//   calm     uint8 per macro vertex (255 = no run-time detail: roads, pads, the city edge)
//   masks    RGBA8 per mask vertex (64 m): R dune sand, G cracked mud, B salt crust, A bare rock
//   profiles float32 per route vertex: the level of every road and track along its line (the circuit first)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as C from '../../js/city-config.js';
import * as D from '../../js/wasteland-design.js';
import { CITY_RING, insideCity } from '../../js/city-frontier.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const PREVIEW = args.includes('--preview') ? args[args.indexOf('--preview') + 1] : null;
const ERODE = !args.includes('--no-erosion');
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const S = D.MACRO_STEP, W = D.MACRO_W, H = D.MACRO_H;
const F = 16; // the raster the shores are drawn on
const FW = (D.SALT_MAX_X - D.SALT_MIN_X) / F + 1, FH = (D.SALT_MAX_Z - D.SALT_MIN_Z) / F + 1;
const X0 = D.SALT_MIN_X, Z0 = D.SALT_MIN_Z;
const clamp01 = v => Math.max(0, Math.min(1, v));
const sm = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// ---- Noise ----------------------------------------------------------------------------------------------------------
function hash2(ix, iz, seed) {
  let k = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed + 1, 1442695041);
  k = Math.imul(k ^ (k >>> 13), 1274126177);
  return ((k ^ (k >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, octaves, seed, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) { sum += amp * vnoise(x, z, seed + o * 17); norm += amp; x = x * 2.03 + 11.7; z = z * 2.03 - 5.3; amp *= gain; }
  return sum / norm;
}
function ridged(x, z, octaves, seed) {
  let sum = 0, amp = 1, norm = 0, prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(vnoise(x, z, seed + o * 31) * 2 - 1);
    n *= n;
    sum += n * amp * prev; norm += amp; prev = n;
    x = x * 2.07 + 3.1; z = z * 2.07 + 7.9; amp *= 0.5;
  }
  return sum / norm;
}

// ---- The shores, drawn on a 16 m raster ----------------------------------------------------------------------------
const NJ = 1, BROOKLYN = 2, QUEENS = 3, BRONX = 4, UPPER = 5, STATEN = 6, MINOR = 7, CITY = 11;
const land = new Uint8Array(FW * FH);
function fill(points, id) {
  if (!points || points.length < 3) return;
  let zMin = Infinity, zMax = -Infinity;
  for (const p of points) { zMin = Math.min(zMin, p.z); zMax = Math.max(zMax, p.z); }
  const j0 = Math.max(0, Math.ceil((zMin - Z0) / F)), j1 = Math.min(FH - 1, Math.floor((zMax - Z0) / F));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const z = Z0 + j * F + 0.01;
    xs.length = 0;
    for (let i = 0, n = points.length; i < n; i++) {
      const a = points[i], b = points[(i + 1) % n];
      if ((a.z > z) !== (b.z > z)) xs.push(a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - X0) / F)), i1 = Math.min(FW - 1, Math.floor((xs[k + 1] - X0) / F));
      for (let i = i0; i <= i1; i++) land[j * FW + i] = id;
    }
  }
}
fill(C.NASSAU_POLYGON, QUEENS); fill(C.WESTCHESTER_POLYGON, BRONX);
fill(C.NJ_SHORELINE_POLYGON, NJ);
fill(C.LONG_ISLAND_POLYGONS[0], BROOKLYN); fill(C.LONG_ISLAND_POLYGONS[1], QUEENS);
fill(C.BRONX_POLYGON, BRONX); fill(C.STATEN_ISLAND_POLYGON, STATEN);
for (const rings of [C.BROOKLYN_POLYGONS, C.QUEENS_POLYGONS, C.BRONX_POLYGONS]) {
  if (!rings?.length) continue;
  const main = rings.reduce((a, r) => (r.length > a.length ? r : a), rings[0]);
  for (const r of rings) if (r !== main) fill(r, MINOR);
}
fill(C.UPPER_MANHATTAN_POLYGON, UPPER);
fill(CITY_RING, CITY);
log('shores drawn');

// Exact Euclidean distance (in metres) to the nearest cell where `inside` is true
function distanceTo(inside) {
  const INF = 1e12, n = Math.max(FW, FH);
  const g = new Float64Array(FW * FH), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < g.length; i++) g[i] = inside(i) ? 0 : INF;
  const pass = (len, get, set) => {
    for (let q = 0; q < len; q++) f[q] = get(q);
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      for (;;) {
        const p = v[k];
        s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
        if (s > z[k]) break;
        k--;
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[p]; }
    for (let q = 0; q < len; q++) set(q, d[q]);
  };
  for (let i = 0; i < FW; i++) pass(FH, j => g[j * FW + i], (j, val) => { g[j * FW + i] = val; });
  for (let j = 0; j < FH; j++) pass(FW, i => g[j * FW + i], (i, val) => { g[j * FW + i] = val; });
  const out = new Float32Array(FW * FH);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(g[i]) * F;
  return out;
}
const isFar = id => id >= NJ && id <= MINOR;
const dCity = distanceTo(i => land[i] === CITY); // to Manhattan's seawall
const dFar = distanceTo(i => isFar(land[i])); // to the far banks
const dWater = distanceTo(i => land[i] === 0); // inside any land, to the nearest old water
log('distances measured');

// ---- The Palisades: the real cliff line and heights (same survey as js/boroughs.js) ---------------------------------
const njShoreX = new Float32Array(FH); // the easternmost New Jersey ground on each row facing the Hudson
for (let j = 0; j < FH; j++) {
  let x = -6000;
  for (let i = Math.round((500 - X0) / F); i >= 0; i--) if (land[j * FW + i] === NJ) { x = X0 + i * F; break; }
  njShoreX[j] = x;
}
const shoreXAt = z => njShoreX[Math.max(0, Math.min(FH - 1, Math.round((z - Z0) / F)))];
const RIDGE_KEYS = [
  { z: -60000, h: 150, cw: 120, set: 260 }, { z: -26000, h: 160, cw: 120, set: 260 }, { z: -20000, h: 140, cw: 110, set: 250 },
  { z: -15000, h: 115, cw: 100, set: 230 }, { z: -12200, h: 92, cw: 90, set: 210 }, { z: -11300, h: 78, cw: 75, set: 190 },
  { z: -10650, h: 66, cw: 60, set: 150 }, { z: -9900, h: 76, cw: 80, set: 200 }, { z: -8700, h: 80, cw: 90, set: 300 },
  { z: -7300, h: 80, cw: 95, set: 440 }, { z: -5500, h: 76, cw: 95, set: 470 }, { z: -4000, h: 70, cw: 90, set: 470 },
  { z: -2800, h: 62, cw: 85, set: 380 }, { z: -1000, h: 58, cw: 80, set: 420 }, { z: 0, h: 55, cw: 80, set: 380 },
  { z: 700, h: 52, cw: 90, set: 560 }, { z: 1700, h: 48, cw: 110, x: -4150 }, { z: 2900, h: 46, cw: 130, x: -4230 },
  { z: 4300, h: 43, cw: 160, x: -4420 }, { z: 5500, h: 40, cw: 200, x: -4650 }, { z: 7200, h: 33, cw: 240, x: -4900 },
  { z: 9200, h: 24, cw: 260, x: -5050 }, { z: 11200, h: 15, cw: 260, x: -5100 }, { z: 12800, h: 7, cw: 260, x: -5000 },
  { z: 14000, h: 0, cw: 260, x: -4900 }
].map(k => ({ ...k, foot: k.x ?? null }));
// The cliff foot follows the shore where the survey gives a setback; smoothed so that it never zigzags with the piers
const footRow = new Float32Array(FH), cliffH = new Float32Array(FH), cliffW = new Float32Array(FH);
{
  const raw = new Float32Array(FH);
  for (let j = 0; j < FH; j++) {
    const z = Z0 + j * F;
    let k = 0;
    while (k < RIDGE_KEYS.length - 2 && RIDGE_KEYS[k + 1].z < z) k++;
    const a = RIDGE_KEYS[k], b = RIDGE_KEYS[k + 1], t = clamp01((z - a.z) / (b.z - a.z));
    const fa = a.foot ?? shoreXAt(z) - a.set, fb = b.foot ?? shoreXAt(z) - b.set;
    raw[j] = mix(fa, fb, t); cliffH[j] = mix(a.h, b.h, t); cliffW[j] = mix(a.cw, b.cw, t);
  }
  const R = 22;
  for (let j = 0; j < FH; j++) {
    let sum = 0, n = 0;
    for (let k = -R; k <= R; k++) { const q = j + k; if (q >= 0 && q < FH) { sum += raw[q]; n++; } }
    footRow[j] = sum / n;
  }
}

// ---- Road levels are fixed after the first relief, then the relief is graded to them ---------------------------------
const ROUTES = [{ id: 'ceinture', kind: 'road', path: D.SALT_LOOP, closed: true }, ...D.SALT_ROUTES];

// Uneven shelves on both sides of the old Delancey corridor. Each lobe falls away to a driveable apron.
const FAULTS = [
  [1340, 3470, 95, 74, 20], [1460, 3430, 113, 85, 32], [1595, 3385, 120, 91, 36],
  [1755, 3330, 138, 88, 37], [1885, 3345, 108, 96, 28], [1995, 3410, 94, 70, 25],
  [1510, 3805, 93, 65, 18], [1640, 3720, 114, 79, 26], [1755, 3685, 118, 72, 28],
  [1890, 3765, 109, 92, 24], [2020, 3815, 108, 82, 18]
];

// ---- First relief ---------------------------------------------------------------------------------------------------
const height = new Float32Array(W * H);
const kind = new Uint8Array(W * H); // land id at the macro vertex
const fi = (i, j) => (j * 2) * FW + i * 2;
const islandCentre = z => { const s = C.getIslandBoundsAtZ(Math.max(C.ISLAND_BOUNDS.minZ, Math.min(C.ISLAND_BOUNDS.maxZ, z))); return (s.westX + s.eastX) / 2; };
const harbourAt = z => sm(5600, 7200, z) * (1 - sm(12400, 13800, z));

// Mesas and buttes: stepped, flat-topped, with warped outlines
function mesas(x, z, seed, scale) {
  const wx = x + 520 * (fbm(x / 900, z / 900, 3, seed + 5) - 0.5), wz = z + 520 * (fbm(x / 900 + 31, z / 900 - 17, 3, seed + 9) - 0.5);
  const m = fbm(wx / scale, wz / scale, 4, seed);
  return 74 * sm(0.545, 0.562, m) + 58 * sm(0.605, 0.619, m) + 46 * sm(0.664, 0.676, m) + 30 * sm(0.712, 0.722, m);
}
// Transverse dunes: long windward slope, short slip face, crests that wander
function dunes(x, z, wavelength, seed) {
  const warp = 0.9 * (fbm(x / (wavelength * 3.1), z / (wavelength * 3.1), 3, seed) - 0.5);
  const along = (x * 0.94 + z * 0.34) / wavelength + warp * 2.6;
  const t = along - Math.floor(along);
  const profile = t < 0.72 ? sm(0, 0.72, t) : 1 - sm(0.72, 1, t);
  const field = sm(0.38, 0.62, fbm(x / (wavelength * 7), z / (wavelength * 7), 3, seed + 3));
  return profile * field;
}

for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const x = X0 + i * S, z = Z0 + j * S, f = fi(i, j);
  const id = land[f];
  kind[j * W + i] = id;
  let h;
  if (id === CITY) h = D.UNDER_CITY;
  else if (id === 0) {
    const shore = dFar[f];
    const west = z < 7400 && x < (z >= C.CUT_Z ? islandCentre(z) : -1300);
    const canyon = !west && z < -7150 && x > -1400 && x < 2600;
    const bank = sm(8, 240, shore); // 0 on the far shore, 1 well out on the bed
    if (west) {
      // The Hudson: deep under Manhattan's wall, a wandering low channel, shoals toward New Jersey
      const u = dCity[f] / (dCity[f] + dFar[f] + 1);
      const wander = 0.38 + 0.13 * Math.sin(z / 1150 + 1.3) + 0.06 * Math.sin(z / 410);
      const thalweg = 2.6 * Math.exp(-(((u - wander) / 0.16) ** 2));
      h = -1.2 - 5.6 * bank - thalweg * bank;
      // Wind from the west: sand banks up against the wall, and in bars across the bed
      h += 3.4 * dunes(x, z, 310, 41) * sm(60, 260, dCity[f]) * bank;
      h += (0.6 + 2.4 * fbm(z / 520, 3.3, 3, 77)) * Math.exp(-dCity[f] / 85) * bank;
      const north = sm(-7200, -9500, z); // the bed narrows and fills toward the great bridge
      h += north * 2.2;
    } else if (canyon) h = -1.2 - 4.6 * bank;
    else {
      // Broad dry flats with dune ridges running into the districts lost on the eastern side.
      const basin = sm(50, 390, dCity[f]);
      const channel = 1840 + 290 * Math.sin(z / 1400) + 125 * Math.sin(z / 520);
      const flats = Math.exp(-(((x - channel) / 310) ** 2));
      const banks = 5 + 20 * dunes(x + z * 0.18, z, 405, 55);
      h = -0.6 + basin * (banks * (1 - 0.86 * flats) - 2.1 * flats);
      const shoulder = Math.exp(-(((x - 1960) / 810) ** 2 + ((z - 3170) / 1330) ** 2));
      h += basin * shoulder * (15 + 22 * ridged(x / 340, z / 460, 3, 813));
    }
    // The harbour: a dead-level white pan from the Battery to the Narrows
    const pan = Math.max(-3.3, -1.2 - 1.9 * bank + 0.5 * (fbm(x / 800, z / 800, 3, 12) - 0.5) * bank);
    h = mix(h, pan, harbourAt(z));
    // The dune sea of the lower bay
    const rise = sm(13200, 17500, z);
    h = mix(h, -3.0 + rise * 16 + (6 + 46 * rise) * dunes(x, z, 520, 23) + 12 * rise * dunes(x + 300, z, 190, 29), sm(12400, 13800, z));
  } else {
    // Far land: a low bank, then each country's own relief
    const inland = dWater[f];
    h = -1.2 + 3.9 * sm(0, 80, inland);
    if (id === NJ) {
      const row = Math.max(0, Math.min(FH - 1, j * 2));
      const d = footRow[row] - x, hc = cliffH[row], cw = cliffW[row];
      if (d > 0) {
        const t = clamp01(d / cw);
        const wall = hc * (0.4 * sm(0, 0.62, t) + 0.56 * sm(0.55, 0.95, t));
        const back = Math.max(0, d - cw);
        // The plateau behind the crest, buttes on it, and the mountains that close the west
        const plateau = hc * 0.96 + 0.012 * Math.min(back, 2500) + 16 * (fbm(x / 700, z / 700, 3, 201) - 0.5) * sm(0, 400, back);
        const buttes = mesas(x, z, 211, 2300) * sm(350, 1300, back);
        const range = sm(4200, 9800, back) * (90 + 330 * ridged(x / 5200, z / 5200, 5, 223));
        h = Math.max(h, d < cw ? wall : plateau + buttes + range);
      } else {
        // Hoboken and Jersey City: flats of rubble and low dunes in front of the cliff
        h += 2.2 * fbm(x / 560, z / 560, 3, 231) * sm(40, 300, inland) + 3.2 * dunes(x, z, 240, 233) * sm(120, 500, inland);
      }
    } else if (id === BROOKLYN || id === QUEENS) {
      const east = sm(600, 2600, inland);
      h += 2.0 * fbm(x / 560, z / 560, 3, 301) * sm(40, 300, inland);
      h += east * (5 + 13 * fbm(x / 1700, z / 1700, 4, 303));
      h += 8.5 * dunes(x, z, 330, 307) * sm(350, 1500, inland);
      h += mesas(x, z, 311, 2500) * sm(1100, 2500, inland) * 1.25;
      h += sm(7000, 12500, x) * (60 + 260 * ridged(x / 5600, z / 5600, 5, 317));
    } else if (id === BRONX) {
      const back = sm(150, 1300, inland);
      h += back * (7 + 52 * Math.pow(fbm(x / 1500, z / 1500, 4, 401), 1.5));
      h -= back * 20 * Math.pow(ridged(x / 1300, z / 1300, 3, 407), 3); // dry canyons
      h += mesas(x, z, 411, 2100) * sm(800, 2000, inland) * 0.9;
      h += sm(-10500, -15500, z) * (80 + 300 * ridged(x / 5000, z / 5000, 5, 419));
    } else if (id === UPPER) {
      // Harlem's bones lie low behind the Wall; the heights rise further up the island
      const north = sm(D.WALL_Z - 420, D.WALL_Z - 1900, z);
      const spine = Math.exp(-(((x + 1750 + (z + 9000) * 0.05) / 420) ** 2));
      h += 1.6 * fbm(x / 520, z / 520, 3, 501) + north * (10 + 52 * spine + 14 * fbm(x / 600, z / 600, 3, 503));
      h = mix(0.1, h, sm(0, 240, D.WALL_Z - z)); // level with the streets at the foot of the Wall
    } else if (id === STATEN) {
      h += sm(100, 900, inland) * (14 + 60 * fbm(x / 1900, z / 1900, 4, 601)) + mesas(x, z, 607, 2200) * sm(900, 2200, inland);
    } else h += 4 + 7 * sm(30, 160, inland); // Rikers and the lesser islands: low tables
  }
  if (id !== CITY && x > 1200 && x < 2170 && z > 3180 && z < 3970) {
    let ridge = 0;
    const waviness = 0.8 + fbm(x / 56, z / 56, 3, 1430) * 0.38;
    for (const [cx, cz, w, d, top] of FAULTS) {
      const r = Math.hypot((x - cx) / w, (z - cz) / d);
      ridge = Math.max(ridge, top * (1 - sm(0.38, 1.34, r)));
    }
    h += ridge * waviness;
  }
  // Rim: the world ends in high country on every side
  const rim = Math.max(Math.abs(x) / 14336, z < 0 ? -z / 17408 : z / 18432);
  if (id !== CITY) h += sm(0.80, 1.0, rim) * (70 + 240 * ridged(x / 4300, z / 4300, 4, 701));
  // Ranges stack up where a country's own mountains meet the rim: a soft ceiling keeps the peaks distinct
  if (h > 330) h = 330 + 170 * Math.tanh((h - 330) / 170);
  height[j * W + i] = h;
}
log('first relief');

// Level ground for what will be built
const calm = new Float32Array(W * H);
for (const [px, pz, r, feather] of D.PADS) {
  const i0 = Math.max(0, Math.floor((px - r - feather - X0) / S)), i1 = Math.min(W - 1, Math.ceil((px + r + feather - X0) / S));
  const j0 = Math.max(0, Math.floor((pz - r - feather - Z0) / S)), j1 = Math.min(H - 1, Math.ceil((pz + r + feather - Z0) / S));
  let sum = 0, n = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot(X0 + i * S - px, Z0 + j * S - pz) < r) { sum += height[j * W + i]; n++; }
  const level = sum / Math.max(1, n);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const w = 1 - sm(r, r + feather, Math.hypot(X0 + i * S - px, Z0 + j * S - pz));
    if (w <= 0 || kind[j * W + i] === CITY) continue;
    height[j * W + i] = mix(height[j * W + i], level, w);
    calm[j * W + i] = Math.max(calm[j * W + i], w);
  }
}

// ---- Rain that fell long ago: gullies under every crest, fans at their feet ------------------------------------------
const sediment = new Float32Array(W * H);
function sampleH(x, z) {
  const fx = clamp01((x - X0) / S / (W - 1)) * (W - 1), fz = clamp01((z - Z0) / S / (H - 1)) * (H - 1);
  const i = Math.min(W - 2, Math.floor(fx)), j = Math.min(H - 2, Math.floor(fz)), u = fx - i, v = fz - j, o = j * W + i;
  return height[o] * (1 - u) * (1 - v) + height[o + 1] * u * (1 - v) + height[o + W] * (1 - u) * v + height[o + W + 1] * u * v;
}
if (ERODE) {
  const erodible = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) erodible[k] = isFar(kind[k]) && height[k] > 9 && calm[k] < 0.05 ? 1 : 0;
  let state = 987654321;
  const rand = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const DROPS = 420000, LIFE = 70, INERTIA = 0.06, CAPACITY = 9, DEPOSIT = 0.28, ERODE_RATE = 0.32, EVAPORATE = 0.018, GRAVITY = 20, RADIUS = 2;
  const brush = [];
  let brushSum = 0;
  for (let dj = -RADIUS; dj <= RADIUS; dj++) for (let di = -RADIUS; di <= RADIUS; di++) {
    const w = Math.max(0, RADIUS - Math.hypot(di, dj));
    if (w > 0) { brush.push([di, dj, w]); brushSum += w; }
  }
  const K = 1; // heights stay in metres; a fall is divided by the cell size where a slope is meant
  for (let n = 0; n < DROPS; n++) {
    let px = 2 + rand() * (W - 5), pz = 2 + rand() * (H - 5), dx = 0, dz = 0, speed = 1, water = 1, load = 0;
    if (!erodible[Math.floor(pz) * W + Math.floor(px)]) continue;
    for (let life = 0; life < LIFE; life++) {
      const i = Math.floor(px), j = Math.floor(pz), u = px - i, v = pz - j, o = j * W + i;
      const h00 = height[o] * K, h10 = height[o + 1] * K, h01 = height[o + W] * K, h11 = height[o + W + 1] * K;
      const gx = (h10 - h00) * (1 - v) + (h11 - h01) * v, gz = (h01 - h00) * (1 - u) + (h11 - h10) * u;
      const here = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
      dx = dx * INERTIA - gx * (1 - INERTIA); dz = dz * INERTIA - gz * (1 - INERTIA);
      const len = Math.hypot(dx, dz);
      if (len < 1e-9) break;
      dx /= len; dz /= len;
      px += dx; pz += dz;
      if (px < 2 || pz < 2 || px >= W - 3 || pz >= H - 3) break;
      // what the gullies carried is spread thin over the flats below: it never buries them
      if (!erodible[Math.floor(pz) * W + Math.floor(px)]) break;
      const ni = Math.floor(px), nj = Math.floor(pz), nu = px - ni, nv = pz - nj, no = nj * W + ni;
      const there = (height[no] * (1 - nu) * (1 - nv) + height[no + 1] * nu * (1 - nv) + height[no + W] * (1 - nu) * nv + height[no + W + 1] * nu * nv) * K;
      const dh = there - here;
      const capacity = Math.max(-dh / S * speed * water * CAPACITY, 0.02);
      if (load > capacity || dh > 0) {
        const drop = dh > 0 ? Math.min(dh, load) : (load - capacity) * DEPOSIT;
        load -= drop;
        const m = drop / K;
        height[o] += m * (1 - u) * (1 - v); height[o + 1] += m * u * (1 - v); height[o + W] += m * (1 - u) * v; height[o + W + 1] += m * u * v;
        sediment[o] += m;
      } else {
        const take = Math.min((capacity - load) * ERODE_RATE, -dh, 0.5);
        for (const [di, dj, w] of brush) {
          const q = (j + dj) * W + i + di;
          if (!erodible[q] || height[q] < 8) continue;
          const part = take * w / brushSum / K;
          height[q] -= part; sediment[q] -= part;
        }
        load += take;
      }
      speed = Math.min(8, Math.sqrt(Math.max(0, speed * speed - dh / S * GRAVITY)));
      water *= 1 - EVAPORATE;
      if (!erodible[no] && load < 0.002) break;
    }
  }
  // Loose slopes slump to their angle of rest (about 34 degrees), which lays the talus under the cliffs
  const REST = Math.tan(34 * Math.PI / 180) * S;
  for (let pass = 0; pass < 6; pass++) {
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
      const o = j * W + i;
      if (!erodible[o]) continue;
      for (const q of [o + 1, o + W]) {
        if (!erodible[q]) continue;
        const d = height[o] - height[q];
        // only the lower third of a cliff slumps: its upper face stays sheer
        const soft = fbm((i * S + X0) / 180, (j * S + Z0) / 180, 2, 811) < 0.42;
        if (Math.abs(d) > REST * (soft ? 1 : 2.4)) {
          const move = (Math.abs(d) - REST * (soft ? 1 : 2.4)) * 0.22 * Math.sign(d);
          height[o] -= move; height[q] += move;
        }
      }
    }
  }
  // A droplet leaves its grain on every vertex it crossed: on gentle ground that reads as a quilt of 32 m squares.
  // One soft pass takes the grain off the slopes a wheel can climb and leaves the cliffs alone.
  {
    const smooth = new Float32Array(height);
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
      const o = j * W + i;
      if (!erodible[o]) continue;
      const steep = Math.hypot(height[o + 1] - height[o - 1], height[o + W] - height[o - W]) / (2 * S);
      const mean = (height[o - 1] + height[o + 1] + height[o - W] + height[o + W]) * 0.17 + (height[o - W - 1] + height[o - W + 1] + height[o + W - 1] + height[o + W + 1]) * 0.08;
      smooth[o] = mix(height[o], mean, 0.7 * (1 - sm(0.22, 0.5, steep)));
    }
    height.set(smooth);
  }
  log('eroded');
}

// ---- Roads and tracks: fix each line's levels, then grade the relief to them -------------------------------------------
function profileOf(route) {
  const p = route.path, n = p.length, y = new Float32Array(n), pinned = new Uint8Array(n);
  for (let k = 0; k < n; k++) y[k] = sampleH(p[k].x, p[k].z);
  const pin = (k, v) => { y[k] = v; pinned[k] = 1; };
  if (route.gate) {
    for (let k = 0; k < n; k++) {
      const { x, z } = p[k];
      if (insideCity(x, z) || Math.hypot(x - route.gate.x, z - route.gate.z) < 64) pin(k, -0.055);
    }
  }
  const passes = route.kind === 'track' ? 50 : 110;
  const tmp = new Float32Array(n);
  for (let it = 0; it < passes; it++) {
    for (let k = 0; k < n; k++) {
      const a = route.closed ? (k + n - 2) % (n - 1) : Math.max(0, k - 1), b = route.closed ? (k + 1) % (n - 1) : Math.min(n - 1, k + 1);
      tmp[k] = pinned[k] ? y[k] : 0.25 * y[a] + 0.5 * y[k] + 0.25 * y[b];
    }
    y.set(tmp);
    if (route.closed) y[n - 1] = y[0];
  }
  // never steeper than 9 %
  const MAX = 0.09;
  for (let sweep = 0; sweep < 6; sweep++) {
    for (let k = 1; k < n; k++) { const len = Math.hypot(p[k].x - p[k - 1].x, p[k].z - p[k - 1].z), lim = len * MAX; if (!pinned[k]) y[k] = Math.max(y[k - 1] - lim, Math.min(y[k - 1] + lim, y[k])); }
    for (let k = n - 2; k >= 0; k--) { const len = Math.hypot(p[k].x - p[k + 1].x, p[k].z - p[k + 1].z), lim = len * MAX; if (!pinned[k]) y[k] = Math.max(y[k + 1] - lim, Math.min(y[k + 1] + lim, y[k])); }
  }
  route.pinned = pinned;
  return y;
}
const profiles = ROUTES.map(profileOf);
// Tracks that leave the circuit take its level where they meet it
for (let r = 1; r < ROUTES.length; r++) {
  const p = ROUTES[r].path, y = profiles[r];
  for (const end of [0, p.length - 1]) {
    let best = 90, level = null;
    for (let q = 0; q < ROUTES.length; q++) {
      if (q === r) continue;
      const path = ROUTES[q].path;
      for (let k = 0; k < path.length; k++) { const d = Math.hypot(path[k].x - p[end].x, path[k].z - p[end].z); if (d < best) { best = d; level = profiles[q][k]; } }
    }
    if (level === null) continue;
    const span = Math.min(p.length - 1, 14);
    // never at the cost of a landing or a gate: what is pinned stays where it was put
    for (let k = 0; k <= span; k++) { const at = end === 0 ? k : p.length - 1 - k, w = 1 - sm(0, span, k); if (!ROUTES[r].pinned[at]) y[at] = mix(y[at], level, w); }
  }
}
{
  const best = new Float32Array(W * H).fill(1e9), level = new Float32Array(W * H);
  for (let r = 0; r < ROUTES.length; r++) {
    const p = ROUTES[r].path, y = profiles[r];
    for (let k = 1; k < p.length; k++) {
      const a = p[k - 1], b = p[k];
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - 130 - X0) / S)), i1 = Math.min(W - 1, Math.ceil((Math.max(a.x, b.x) + 130 - X0) / S));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - 130 - Z0) / S)), j1 = Math.min(H - 1, Math.ceil((Math.max(a.z, b.z) + 130 - Z0) / S));
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = X0 + i * S, z = Z0 + j * S;
        const t = clamp01(((x - a.x) * dx + (z - a.z) * dz) / l2), d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t), o = j * W + i;
        if (d < best[o]) { best[o] = d; level[o] = mix(y[k - 1], y[k], t); }
      }
    }
  }
  for (let o = 0; o < W * H; o++) {
    if (best[o] > 125 || kind[o] === CITY) continue;
    const w = 1 - sm(38, 125, best[o]);
    // cut and fill, across the dry basin
    height[o] = mix(height[o], level[o], w);
    calm[o] = Math.max(calm[o], 1 - sm(24, 70, best[o]));
  }
}
// A continuous apron below the asphalt hides the mesh seam. The exact edge is enforced on the game lattice.
const zone = new Uint8Array(W * H);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const o = j * W + i, f = fi(i, j);
  if (kind[o] === CITY) {
    zone[o] = 2;
    calm[o] = 1;
  } else {
    const d = dCity[f];
    height[o] = mix(-0.055, height[o], sm(24, 145, d));
    calm[o] = Math.max(calm[o], 1 - sm(32, 120, d));
  }
}
log('roads graded');

const MW = D.MASK_W, MH = D.MASK_H, MS = D.MASK_STEP;
const masks = new Uint8Array(MW * MH * 4);
const slopeAt = (i, j) => {
  const a = height[j * W + Math.max(0, i - 1)], b = height[j * W + Math.min(W - 1, i + 1)], c = height[Math.max(0, j - 1) * W + i], d = height[Math.min(H - 1, j + 1) * W + i];
  return Math.hypot(b - a, d - c) / (2 * S);
};
for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
  const mi = i * 2, mj = j * 2, o = mj * W + mi, f = fi(mi, mj), x = X0 + i * MS, z = Z0 + j * MS;
  const id = kind[o], h = height[o], slope = slopeAt(mi, mj);
  const flat = 1 - sm(0.10, 0.34, slope);
  let dune = 0, crack = 0, salt = 0, rock = 0;
  const bed = id === 0;
  const patch = fbm(x / 900, z / 900, 4, 1201);
  if (bed) {
    // dry river bed: cracked mud in the lows, sand on the bars, a white line where the water last stood
    const low = sm(-4.6, -7.0, h);
    crack = 0.35 + 0.65 * low;
    dune = sm(0.25, 0.6, 1 - low) * sm(0.36, 0.58, patch);
    salt = 0.6 * sm(-8.3, -9.4, h) + 0.22 * sm(0.56, 0.72, fbm(x / 300, z / 300, 3, 1207)) * low;
    // the harbour pan is salt from shore to shore, the lower bay a sea of sand
    const pan = harbourAt(z), sea = sm(12400, 13800, z);
    salt = mix(salt, 0.55 + 0.45 * sm(0.3, 0.6, patch), pan); crack = mix(crack, 0.35, pan); dune = mix(dune, 0, pan);
    salt = mix(salt, 0, sea); crack = mix(crack, 0, sea); dune = mix(dune, 1, sea);
  } else if (id !== CITY) {
    const sandy = sm(0.42, 0.64, fbm(x / 1300, z / 1300, 4, 1211));
    dune = sandy * flat * (id === BROOKLYN || id === QUEENS ? 1 : 0.7);
    crack = (1 - sandy) * flat * sm(0.5, 0.7, fbm(x / 700, z / 700, 3, 1213)) * 0.8;
    rock = Math.max(sm(0.16, 0.42, slope), 0.5 * sm(38, 70, h) * sm(0.45, 0.6, fbm(x / 420, z / 420, 3, 1217)));
    // fans of washed gravel read as bare ground too
    rock = Math.max(rock, 0.4 * sm(0.3, 2.5, sediment[o]));
    if (id === UPPER) { dune = Math.max(dune, 0.45); }
  } else dune = 1;
  dune *= 1 - rock * 0.85;
  const at = (j * MW + i) * 4;
  masks[at] = Math.round(clamp01(dune) * 255); masks[at + 1] = Math.round(clamp01(crack) * 255);
  masks[at + 2] = Math.round(clamp01(salt) * 255); masks[at + 3] = Math.round(clamp01(rock) * 255);
}

// ---- Write ----------------------------------------------------------------------------------------------------------
let lo = Infinity, hi = -Infinity;
for (const h of height) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
if (lo < D.HEIGHT_MIN || hi > D.HEIGHT_MIN + D.HEIGHT_RANGE) throw new Error(`relief ${lo.toFixed(1)} .. ${hi.toFixed(1)} m leaves the stored range`);
const q16 = new Uint16Array(W * H);
for (let k = 0; k < W * H; k++) q16[k] = Math.round((height[k] - D.HEIGHT_MIN) / D.HEIGHT_RANGE * 65535);
const loBytes = new Uint8Array(W * H), hiBytes = new Uint8Array(W * H);
for (let j = 0; j < H; j++) {
  let previous = 0;
  for (let i = 0; i < W; i++) { const k = j * W + i, d = (q16[k] - previous) & 65535; previous = q16[k]; loBytes[k] = d & 255; hiBytes[k] = d >> 8; }
}
const calm8 = new Uint8Array(W * H);
for (let k = 0; k < W * H; k++) calm8[k] = Math.round(clamp01(calm[k]) * 255);
const profileFloats = new Float32Array(profiles.reduce((n, p) => n + p.length, 0));
{ let o = 0; for (const p of profiles) { profileFloats.set(p, o); o += p.length; } }
const header = {
  version: 3, w: W, h: H, step: S, maskW: MW, maskH: MH, maskStep: MS, min: D.HEIGHT_MIN, range: D.HEIGHT_RANGE,
  routes: ROUTES.map((r, k) => ({ id: r.id, count: profiles[k].length })), low: +lo.toFixed(2), high: +hi.toFixed(2)
};
let json = JSON.stringify(header);
while ((json.length + 4) % 4) json += ' ';
const head = Buffer.alloc(4); head.writeUInt32LE(json.length, 0);
const raw = Buffer.concat([head, Buffer.from(json), Buffer.from(loBytes), Buffer.from(hiBytes), Buffer.from(zone), Buffer.from(calm8), Buffer.from(masks),
  Buffer.from(profileFloats.buffer)]);
const out = path.join(HERE, '../../js/wasteland-terrain.bin.gz');
fs.writeFileSync(out, zlib.gzipSync(raw, { level: 9 }));
log(`wrote ${out}: ${(raw.length / 1e6).toFixed(1)} MB raw, ${(fs.statSync(out).size / 1e6).toFixed(2)} MB gzip; relief ${lo.toFixed(1)} .. ${hi.toFixed(1)} m`);

// ---- Pictures to judge it by ---------------------------------------------------------------------------------------
if (PREVIEW) {
  const { createRequire } = await import('node:module');
  let sharp = null;
  for (const root of [HERE, path.join(HERE, '../world'), '/Users/ulik/Desktop/Games/GTA/gta-slop/tools/world']) {
    try { sharp = createRequire(path.join(root, 'package.json'))('sharp'); break; } catch { /* next */ }
  }
  if (!sharp) throw new Error('sharp is needed for the preview (npm install in tools/world)');
  fs.mkdirSync(PREVIEW, { recursive: true });
  const shade = (x0, x1, z0, z1, px, file) => {
    const w = Math.round((x1 - x0) / px), h = Math.round((z1 - z0) / px), img = Buffer.alloc(w * h * 3);
    const maskAt = (x, z, c) => {
      const fx = clamp01((x - X0) / MS / (MW - 1)) * (MW - 1), fz = clamp01((z - Z0) / MS / (MH - 1)) * (MH - 1);
      const i = Math.min(MW - 2, Math.floor(fx)), j = Math.min(MH - 2, Math.floor(fz)), u = fx - i, v = fz - j, o = (j * MW + i) * 4 + c;
      return (masks[o] * (1 - u) * (1 - v) + masks[o + 4] * u * (1 - v) + masks[o + MW * 4] * (1 - u) * v + masks[o + MW * 4 + 4] * u * v) / 255;
    };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = x0 + i * px, z = z0 + j * px, y = sampleH(x, z);
      const e = Math.max(px, 24), gx = (sampleH(x + e, z) - sampleH(x - e, z)) / (2 * e), gz = (sampleH(x, z + e) - sampleH(x, z - e)) / (2 * e);
      const nl = 1 / Math.hypot(gx, 1, gz);
      const light = clamp01((-gx * -0.62 + 1 * 0.55 + -gz * -0.56) * nl); // sun low in the north-west
      const mi = Math.round((x - X0) / S), mj = Math.round((z - Z0) / S), o = Math.max(0, Math.min(H - 1, mj)) * W + Math.max(0, Math.min(W - 1, mi));
      let r, g, b;
      if (zone[o] === 2 && y <= 0.02) { r = 88; g = 90; b = 96; }

      else {
        const dune = maskAt(x, z, 0), crack = maskAt(x, z, 1), salt = maskAt(x, z, 2), rock = maskAt(x, z, 3);
        r = 150; g = 118; b = 84;
        r = mix(r, 214, dune); g = mix(g, 172, dune); b = mix(b, 112, dune);
        r = mix(r, 128, crack * 0.8); g = mix(g, 104, crack * 0.8); b = mix(b, 84, crack * 0.8);
        r = mix(r, 236, salt); g = mix(g, 230, salt); b = mix(b, 216, salt);
        r = mix(r, 140, rock); g = mix(g, 70, rock); b = mix(b, 46, rock);
        const k = 0.35 + 1.1 * light;
        r *= k; g *= k; b *= k;
      }
      const at = (j * w + i) * 3;
      img[at] = Math.min(255, r); img[at + 1] = Math.min(255, g); img[at + 2] = Math.min(255, b);
    }
    const dot = (x, z, rgb, size = 2) => {
      const ci = Math.round((x - x0) / px), cj = Math.round((z - z0) / px);
      for (let dj = -size; dj <= size; dj++) for (let di = -size; di <= size; di++) {
        const i = ci + di, j = cj + dj;
        if (i >= 0 && j >= 0 && i < w && j < h) { const at = (j * w + i) * 3; img[at] = rgb[0]; img[at + 1] = rgb[1]; img[at + 2] = rgb[2]; }
      }
    };
    for (const route of ROUTES) for (const p of route.path) dot(p.x, p.z, route.kind === 'road' ? [30, 30, 34] : [96, 60, 40], px < 20 ? 1 : 0);
    for (const p of D.SALT_PLACES) dot(p.x, p.z, [255, 40, 40], 3);
    return sharp(img, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toFile(path.join(PREVIEW, file));
  };
  await shade(D.SALT_MIN_X, D.SALT_MAX_X, D.SALT_MIN_Z, D.SALT_MAX_Z, 24, 'relief-world.jpg');
  await shade(-6400, 6400, -10400, 10000, 10, 'relief-near.jpg');
  await shade(-4600, -1700, -1800, 2000, 3, 'relief-pumps.jpg');
  log('previews in', PREVIEW);
}
