import {
  ELLIS_ISLAND_POLYGON, GOVERNORS_ISLAND_POLYGON, ISLAND_BOUNDS, LIBERTY_ISLAND_POLYGON, MANHATTAN_COASTLINE, WATERFRONT_PIERS
} from './city-config.js';
import {
  FRONTIER_BRIDGES, HEIGHT_MIN, HEIGHT_RANGE, MACRO_H, MACRO_STEP, MACRO_W, MASK_H, MASK_STEP, MASK_W, MOAT_SEED, ROAD_HALF, SALT_LOOP,
  SALT_MAX_X, SALT_MAX_Z, SALT_MIN_X, SALT_MIN_Z, SALT_PLACES, SALT_ROUTES, SALT_STEP, SALT_WATER, TRACK_HALF, WALL_Z
} from './wasteland-design.js';

// The Wasteland's ground as the game reads it: the baked relief (tools/wasteland/build-terrain.mjs), the 8 m lattice
// that the picture and the wheels share, what is dry, what is moat and what is city, the roads and the way through.
export {
  FRONTIER_BRIDGES, SALT_LOOP, SALT_ROUTES, SALT_PLACES, SALT_STEP, SALT_WATER, SALT_MIN_X, SALT_MAX_X, SALT_MIN_Z, SALT_MAX_Z,
  MACRO_STEP, MACRO_W, MACRO_H, MASK_STEP, MASK_W, MASK_H
};
export { WEST_GATE, NORTH_GATE, WALL_Z, DAMS, BREACHES, PADS, ROAD_HALF, TRACK_HALF } from './wasteland-design.js';

const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
export const CHUNK = 64; // lattice cells along one side of a ground chunk (512 m)
export const LATTICE_W = (SALT_MAX_X - SALT_MIN_X) / SALT_STEP, LATTICE_H = (SALT_MAX_Z - SALT_MIN_Z) / SALT_STEP;
const RATIO = MACRO_STEP / SALT_STEP;

// ---- The baked relief -----------------------------------------------------------------------------------------------
async function readTerrain() {
  const url = new URL('./wasteland-terrain.bin.gz', import.meta.url);
  let body;
  if (url.protocol === 'file:') {
    const fs = await import(/* node only */ 'node:fs');
    body = new Uint8Array(fs.readFileSync(url));
  } else {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Wasteland relief request failed: ${response.status}`);
    body = new Uint8Array(await response.arrayBuffer());
  }
  // Servers that send .gz files as Content-Encoding: gzip hand over bytes the browser has already inflated
  if (body[0] === 0x1f && body[1] === 0x8b) body = new Uint8Array(await new Response(new Response(body).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const headerLength = view.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + headerLength)));
  if (header.version !== 2 || header.w !== MACRO_W || header.h !== MACRO_H || header.maskW !== MASK_W) throw new Error('Wasteland relief does not match this build: run tools/wasteland/build-terrain.mjs');
  const n = MACRO_W * MACRO_H;
  let at = 4 + headerLength;
  const low = body.subarray(at, at + n), high = body.subarray(at + n, at + 2 * n); at += 2 * n;
  const height = new Float32Array(n);
  for (let j = 0; j < MACRO_H; j++) {
    let value = 0;
    for (let i = 0; i < MACRO_W; i++) {
      const k = j * MACRO_W + i;
      value = (value + low[k] + (high[k] << 8)) & 65535;
      height[k] = HEIGHT_MIN + value / 65535 * HEIGHT_RANGE;
    }
  }
  const zone = body.slice(at, at + n); at += n;
  const calm = body.slice(at, at + n); at += n;
  const masks = body.slice(at, at + MASK_W * MASK_H * 4); at += MASK_W * MASK_H * 4;
  const profiles = new Float32Array(body.slice(at).buffer);
  return { header, height, zone, calm, masks, profiles };
}
const terrain = await readTerrain();
const macro = terrain.height, zoneGrid = terrain.zone, calmGrid = terrain.calm, maskGrid = terrain.masks;
export const SALT_TERRAIN = terrain;
export function prepareSaltGround() { /* the relief is read when this module loads */ }

// ---- Where the city stands ------------------------------------------------------------------------------------------
// The seawall of city-grid.js: the surveyed coastline pushed out by its 6 m coping
export const CITY_RING = MANHATTAN_COASTLINE.map(p => ({
  x: p.x + (p.x < -100 ? -6 : (p.x > 100 ? 6 : 0)),
  z: p.z + (p.z > 1350 ? 6 : (p.z < -1550 ? -6 : 0))
}));
function indexRing(ring, step = 8) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of ring) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const rows = Array.from({ length: Math.ceil((maxZ - minZ) / step) + 1 }, () => []);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (a.z === b.z) continue;
    const j0 = Math.floor((Math.min(a.z, b.z) - minZ) / step), j1 = Math.floor((Math.max(a.z, b.z) - minZ) / step);
    for (let j = j0; j <= j1; j++) rows[j].push(a.x, a.z, b.x, b.z);
  }
  return { minX, maxX, minZ, maxZ, step, rows: rows.map(r => Float64Array.from(r)) };
}
function insideRing(index, x, z) {
  if (x < index.minX || x > index.maxX || z < index.minZ || z > index.maxZ) return false;
  const edges = index.rows[Math.floor((z - index.minZ) / index.step)];
  let inside = false;
  for (let k = 0; k < edges.length; k += 4) {
    const az = edges[k + 1], bz = edges[k + 3];
    if ((az > z) !== (bz > z) && x < edges[k] + (edges[k + 2] - edges[k]) * (z - az) / (bz - az)) inside = !inside;
  }
  return inside;
}
const cityIndex = indexRing(CITY_RING);
export const insideCity = (x, z) => insideRing(cityIndex, x, z);
// The harbour islands on the dry side keep their own level ground (boroughs.js draws them)
const PLATEAUS = [[GOVERNORS_ISLAND_POLYGON, 0.45], [LIBERTY_ISLAND_POLYGON, 0.6], [ELLIS_ISLAND_POLYGON, 0.6]]
  .filter(([ring]) => ring?.length > 2).map(([ring, top]) => ({ index: indexRing(ring), level: top - 0.03 }));
const plateauAt = (x, z) => { for (const p of PLATEAUS) if (insideRing(p.index, x, z)) return p.level; return null; };
const PIERS = (WATERFRONT_PIERS ?? []).map(p => ({ cx: p.cx, cz: p.cz, ux: Math.cos(p.angle), uz: Math.sin(p.angle), hl: p.length / 2 + 4, hw: p.width / 2 + 4, r: Math.hypot(p.length, p.width) / 2 + 6 }));
export function onPier(x, z) {
  for (const p of PIERS) {
    const dx = x - p.cx, dz = z - p.cz;
    if (Math.abs(dx) > p.r || Math.abs(dz) > p.r) continue;
    if (Math.abs(dx * p.ux + dz * p.uz) < p.hl && Math.abs(dz * p.ux - dx * p.uz) < p.hw) return true;
  }
  return false;
}

// ---- Roads and tracks ----------------------------------------------------------------------------------------------
export function bridgeFrameAt(spec, x, z) {
  const dx = spec.b.x - spec.a.x, dz = spec.b.z - spec.a.z;
  const length = Math.hypot(dx, dz), ux = dx / length, uz = dz / length;
  const rx = x - spec.a.x, rz = z - spec.a.z;
  return { u: rx * ux + rz * uz, v: rz * ux - rx * uz, length, ux, uz };
}
export const SALT_LINES = [{ id: 'ceinture', kind: 'road', path: SALT_LOOP, closed: true, spec: null }, ...SALT_ROUTES];
{
  let at = 0;
  if (terrain.header.routes.length !== SALT_LINES.length) throw new Error('Wasteland relief was baked for other roads: run tools/wasteland/build-terrain.mjs');
  SALT_LINES.forEach((line, k) => {
    const { id, count } = terrain.header.routes[k];
    if (id !== line.id || count !== line.path.length) throw new Error('Wasteland relief was baked for other roads: run tools/wasteland/build-terrain.mjs');
    line.levels = terrain.profiles.subarray(at, at + count); at += count;
    line.half = line.kind === 'road' ? ROAD_HALF : TRACK_HALF;
  });
}
const ROUTE_CELL = 128, ROUTE_REACH = 180;
const segments = new Map();
const cellKey = (x, z) => (x + 512) * 4096 + z + 512;
for (const line of SALT_LINES) {
  const { path, levels } = line;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (length < 0.001) continue;
    const segment = { a, dx, dz, length, y0: levels[i - 1], y1: levels[i], landing: line.spec?.b ?? null, half: line.half, kind: line.kind, line };
    const minX = Math.floor((Math.min(a.x, b.x) - ROUTE_REACH) / ROUTE_CELL), maxX = Math.floor((Math.max(a.x, b.x) + ROUTE_REACH) / ROUTE_CELL);
    const minZ = Math.floor((Math.min(a.z, b.z) - ROUTE_REACH) / ROUTE_CELL), maxZ = Math.floor((Math.max(a.z, b.z) + ROUTE_REACH) / ROUTE_CELL);
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const id = cellKey(x, z);
      if (!segments.has(id)) segments.set(id, []);
      segments.get(id).push(segment);
    }
  }
}
// The road or track nearest (x, z), within 180 m: distance to its centre line, side, level, half width, kind
export function saltRoadAt(x, z, out) {
  const list = segments.get(cellKey(Math.floor(x / ROUTE_CELL), Math.floor(z / ROUTE_CELL)));
  let best = ROUTE_REACH * ROUTE_REACH, found = false;
  if (list) for (let k = 0; k < list.length; k++) {
    const s = list[k], px = x - s.a.x, pz = z - s.a.z;
    const t = Math.max(0, Math.min(1, (px * s.dx + pz * s.dz) / (s.length * s.length)));
    const ex = px - s.dx * t, ez = pz - s.dz * t, d2 = ex * ex + ez * ez;
    if (d2 >= best) continue;
    best = d2; found = true;
    out.side = (ez * s.dx - ex * s.dz) / s.length;
    out.landing = s.landing ? Math.hypot(x - s.landing.x, z - s.landing.z) : Infinity;
    out.level = s.y0 + (s.y1 - s.y0) * t; out.half = s.half; out.kind = s.kind;
  }
  out.distance = Math.sqrt(best);
  return found;
}

// ---- The lattice: baked relief, small dunes and stones added, roads levelled -------------------------------------------
function hash2(ix, iz, seed) {
  let k = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed + 1, 1442695041);
  k = Math.imul(k ^ (k >>> 13), 1274126177);
  return ((k ^ (k >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm2 = (x, z, seed) => (vnoise(x, z, seed) + 0.5 * vnoise(x * 2.03 + 11.7, z * 2.03 - 5.3, seed + 17)) / 1.5;
// Small transverse dunes: long windward slope, short slip face
function ripple(x, z, wavelength, seed) {
  const along = (x * 0.94 + z * 0.34) / wavelength + 2.2 * (vnoise(x / (wavelength * 2.7), z / (wavelength * 2.7), seed) - 0.5);
  const t = along - Math.floor(along);
  return (t < 0.72 ? sm(0, 0.72, t) : 1 - sm(0.72, 1, t)) * sm(0.3, 0.6, vnoise(x / (wavelength * 5.2), z / (wavelength * 5.2), seed + 3));
}
const CUBIC = [0, 0.25, 0.5, 0.75].map(t => [-0.5 * t ** 3 + t * t - 0.5 * t, 1.5 * t ** 3 - 2.5 * t * t + 1, -1.5 * t ** 3 + 2 * t * t + 0.5 * t, 0.5 * t ** 3 - 0.5 * t * t]);
function macroAt(ix, iz) {
  const mi = Math.floor(ix / RATIO), mj = Math.floor(iz / RATIO), fi = ix - mi * RATIO, fj = iz - mj * RATIO;
  if (fi === 0 && fj === 0) return macro[Math.max(0, Math.min(MACRO_H - 1, mj)) * MACRO_W + Math.max(0, Math.min(MACRO_W - 1, mi))];
  const wx = CUBIC[fi], wz = CUBIC[fj];
  let sum = 0;
  for (let b = 0; b < 4; b++) {
    const row = Math.max(0, Math.min(MACRO_H - 1, mj + b - 1)) * MACRO_W;
    let line = 0;
    for (let a = 0; a < 4; a++) line += wx[a] * macro[row + Math.max(0, Math.min(MACRO_W - 1, mi + a - 1))];
    sum += wz[b] * line;
  }
  return sum;
}
function gridAt(grid, ix, iz) {
  const fx = Math.max(0, Math.min(MACRO_W - 1.001, ix / RATIO)), fz = Math.max(0, Math.min(MACRO_H - 1.001, iz / RATIO));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, o = j * MACRO_W + i;
  return (grid[o] * (1 - u) * (1 - v) + grid[o + 1] * u * (1 - v) + grid[o + MACRO_W] * (1 - u) * v + grid[o + MACRO_W + 1] * u * v) / 255;
}
// The four masks at a world point: [dune sand, cracked mud, salt crust, bare rock], each 0..1
export function saltMasksAt(x, z, out) {
  const fx = Math.max(0, Math.min(MASK_W - 1.001, (x - SALT_MIN_X) / MASK_STEP)), fz = Math.max(0, Math.min(MASK_H - 1.001, (z - SALT_MIN_Z) / MASK_STEP));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, o = (j * MASK_W + i) * 4, row = MASK_W * 4;
  for (let c = 0; c < 4; c++) out[c] = (maskGrid[o + c] * (1 - u) * (1 - v) + maskGrid[o + 4 + c] * u * (1 - v) + maskGrid[o + row + c] * (1 - u) * v + maskGrid[o + row + 4 + c] * u * v) / 255;
  return out;
}
const maskScratch = [0, 0, 0, 0], roadScratch = {};
// Height of lattice vertex (ix, iz), computed from scratch. saltVertex() is the cached way to ask.
export function latticeHeight(ix, iz) {
  const x = SALT_MIN_X + ix * SALT_STEP, z = SALT_MIN_Z + iz * SALT_STEP;
  const m = macroAt(ix, iz);
  let h = m;
  const lively = 1 - gridAt(calmGrid, ix, iz);
  if (lively > 0.004) {
    const [dune, , salt, rock] = saltMasksAt(x, z, maskScratch);
    let detail = (fbm2(x / 41, z / 41, 5) - 0.5) * 0.7;
    if (dune > 0.02) detail += dune * (1.25 * ripple(x, z, 52, 21) + 1.7 * ripple(x * 0.83 - z * 0.2, z * 0.9 + x * 0.17, 118, 27));
    detail *= 1 - 0.9 * salt;
    if (rock > 0.02) detail += rock * 1.3 * (fbm2(x / 37, z / 37, 9) - 0.5);
    h += detail * lively;
  }
  const onRoad = saltRoadAt(x, z, roadScratch);
  if (onRoad) {
    const edge = roadScratch.distance - roadScratch.half;
    if (edge < 26) h = mix(roadScratch.level, h, sm(9, 26, edge));
  }
  if (PLATEAUS.length) { const level = plateauAt(x, z); if (level !== null) h = level; }
  // Under the streets the ground stays buried, except where a drift has come over the wall or a road runs out of a gate
  if (m <= 0 && !(onRoad && roadScratch.distance < roadScratch.half + 2) && insideCity(x, z)) h = Math.min(h, m);
  return h;
}

const chunks = new Map();
const CHUNKS_X = LATTICE_W / CHUNK, CHUNKS_Z = LATTICE_H / CHUNK, SIDE = CHUNK + 1;
// The 65 x 65 vertex heights of ground chunk (cx, cz), shared by the picture and by everything that stands on it
export function saltChunk(cx, cz) {
  const id = cz * CHUNKS_X + cx;
  let heights = chunks.get(id);
  if (heights) return heights;
  heights = new Float32Array(SIDE * SIDE);
  const ix0 = cx * CHUNK, iz0 = cz * CHUNK;
  for (let j = 0; j < SIDE; j++) for (let i = 0; i < SIDE; i++) heights[j * SIDE + i] = latticeHeight(ix0 + i, iz0 + j);
  if (chunks.size > 900) chunks.delete(chunks.keys().next().value);
  chunks.set(id, heights);
  return heights;
}
export function saltVertex(ix, iz) {
  const cx = Math.max(0, Math.min(CHUNKS_X - 1, Math.floor(ix / CHUNK))), cz = Math.max(0, Math.min(CHUNKS_Z - 1, Math.floor(iz / CHUNK)));
  return saltChunk(cx, cz)[(iz - cz * CHUNK) * SIDE + ix - cx * CHUNK];
}
export function insideSaltGrid(x, z) {
  return x >= SALT_MIN_X && x < SALT_MAX_X && z >= SALT_MIN_Z && z < SALT_MAX_Z;
}

// The diagonal is shared with the render indices so a wheel lands on the visible triangle.
export function sampleSalt(x, z, out = null) {
  if (!insideSaltGrid(x, z)) return null;
  const fx = (x - SALT_MIN_X) / SALT_STEP, fz = (z - SALT_MIN_Z) / SALT_STEP;
  const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
  const cx = Math.floor(ix / CHUNK), cz = Math.floor(iz / CHUNK), heights = saltChunk(cx, cz), o = (iz - cz * CHUNK) * SIDE + ix - cx * CHUNK;
  const a = heights[o], b = heights[o + 1], c = heights[o + SIDE], d = heights[o + SIDE + 1];
  const upper = u + v >= 1;
  const dx = upper ? d - c : b - a, dz = upper ? d - b : c - a;
  const y = upper ? d + (u - 1) * dx + (v - 1) * dz : a + u * dx + v * dz;
  if (!out) return y;
  const norm = Math.hypot(dx, SALT_STEP, dz);
  out.y = y; out.nx = -dx / norm; out.ny = SALT_STEP / norm; out.nz = -dz / norm;
  out.curb = false; out.deck = false;
  if (saltRoadAt(x, z, roadScratch) && roadScratch.distance < roadScratch.half + 1) {
    const road = roadScratch.kind === 'road';
    out.grip = road ? 0.94 : 0.84; out.rough = road ? 0.009 : 0.017;
  } else {
    const [dune, crack, salt, rock] = saltMasksAt(x, z, maskScratch);
    out.grip = Math.max(0.56, 0.74 - 0.16 * dune + 0.08 * crack + 0.1 * salt + 0.1 * rock);
    out.rough = Math.max(0.01, 0.024 + 0.014 * dune - 0.012 * salt + 0.02 * rock - 0.006 * crack);
  }
  return y;
}

// ---- Dry, wet, or the city's --------------------------------------------------------------------------------------
function moatZone(x, z) {
  const i = Math.max(0, Math.min(MACRO_W - 1, Math.round((x - SALT_MIN_X) / MACRO_STEP))), j = Math.max(0, Math.min(MACRO_H - 1, Math.round((z - SALT_MIN_Z) / MACRO_STEP)));
  return zoneGrid[j * MACRO_W + i] === 1;
}
// Water the dams still hold: the East River and the lower Harlem River
export function saltWetAt(x, z) {
  return insideSaltGrid(x, z) && moatZone(x, z) && sampleSalt(x, z) < SALT_WATER + 0.12;
}
// Dry ground of the Wasteland: neither the city's own ground nor the moat
export function saltLandAt(x, z) {
  if (!insideSaltGrid(x, z) || insideCity(x, z)) return false;
  return !(moatZone(x, z) && sampleSalt(x, z) < SALT_WATER + 0.12);
}

// Bands of moat for the map: [x0, z, x1] runs of wet ground on rows 16 m apart
let moatRuns = null;
export function saltMoatRuns() {
  if (moatRuns) return moatRuns;
  moatRuns = [];
  const STEP = 16;
  let minI = MACRO_W, maxI = 0, minJ = MACRO_H, maxJ = 0;
  for (let j = 0; j < MACRO_H; j++) for (let i = 0; i < MACRO_W; i++) if (zoneGrid[j * MACRO_W + i] === 1) { minI = Math.min(minI, i); maxI = Math.max(maxI, i); minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j); }
  const x0 = SALT_MIN_X + (minI - 1) * MACRO_STEP, x1 = SALT_MIN_X + (maxI + 1) * MACRO_STEP;
  for (let z = SALT_MIN_Z + (minJ - 1) * MACRO_STEP; z <= SALT_MIN_Z + (maxJ + 1) * MACRO_STEP; z += STEP) {
    let start = null;
    for (let x = x0; x <= x1 + STEP; x += STEP) {
      // under the city's piers and seawall the map shows water too
      const wet = x <= x1 && moatZone(x, z) && macroAt(Math.round((x - SALT_MIN_X) / SALT_STEP), Math.round((z - SALT_MIN_Z) / SALT_STEP)) < SALT_WATER + 0.12;
      if (wet && start === null) start = x;
      else if (!wet && start !== null) { moatRuns.push([start - STEP / 2, z, x - STEP / 2]); start = null; }
    }
  }
  return moatRuns;
}

const REGIONS = [
  ['Les Os de Harlem', (x, z) => z < WALL_Z && z > -10800 && x > -2300 && x < 900],
  ['La Rade', (x, z) => z > 6500 && z < 13200 && x > -2300 && x < 2200],
  ['Le Lit de l’Hudson', (x, z, y) => x < -100 && x > -3350 && z < 7000 && y < 0],
  ['Le Haut-Sel', (x, z, y) => x < -3300 && y > 30],
  ['La Corniche', (x) => x < -3000],
  ['Les Terrasses', (x, z) => z < -6800 && x >= 900],
  ['La Traverse', (x, z) => x > 1500 && z < 800],
  ['Les Sables de Brooklyn', (x) => x > 1200],
  ['La Mer de Dunes', (x, z) => z >= 13200]
];
export function saltLocation(x, z) {
  if (!saltLandAt(x, z)) return null;
  let nearest = null, best = 520 ** 2;
  for (const place of SALT_PLACES) {
    const d = (x - place.x) ** 2 + (z - place.z) ** 2;
    if (d < best) { best = d; nearest = place; }
  }
  if (nearest) return nearest.name;
  const y = sampleSalt(x, z);
  for (const [name, test] of REGIONS) if (test(x, z, y)) return name;
  return 'Le Wasteland';
}

// ---- What a body stands on ----------------------------------------------------------------------------------------
const DRIFT_STEP = 0.26; // sand thinner than a curb is only seen; deeper, it carries feet and wheels
const UNDER_DECK = -1.2; // below this a body is under the piers and the streets, down on the bed
export function createFrontierSurfaces(decks) {
  const indexed = decks.filter(d => FRONTIER_BRIDGES.some(b => b.id === d.id)).map(d => ({
    ...d,
    minX: Math.min(d.ax, d.ax + d.ux * d.L) - d.half,
    maxX: Math.max(d.ax, d.ax + d.ux * d.L) + d.half,
    minZ: Math.min(d.az, d.az + d.uz * d.L) - d.half,
    maxZ: Math.max(d.az, d.az + d.uz * d.L) + d.half
  }));
  const scratch = {};

  function deckAt(x, z, maxY = Infinity, out = null) {
    for (const d of indexed) {
      if (x < d.minX || x > d.maxX || z < d.minZ || z > d.maxZ) continue;
      const px = x - d.ax, pz = z - d.az;
      const u = px * d.ux + pz * d.uz, v = pz * d.ux - px * d.uz;
      if (u < 0 || u > d.L || Math.abs(v) > d.half - 1.1) continue;
      const t = u / d.L, y = d.profile(t);
      if (y > maxY || y < .018) continue;
      if (out) {
        const slope = (d.profile(Math.min(1, (u + .5) / d.L)) - d.profile(Math.max(0, (u - .5) / d.L)));
        const scale = 1 / Math.hypot(slope, 1);
        Object.assign(out, { y, nx: -slope * d.ux * scale, ny: scale, nz: -slope * d.uz * scale, grip: .94, rough: .01, curb: false, deck: true });
      }
      return true;
    }
    return false;
  }

  // The Wasteland's ground under (x, z) for a body no higher than maxY, or false where the city's own ground rules
  function sample(x, z, maxY, out) {
    if (deckAt(x, z, maxY, out)) return true;
    if (!insideSaltGrid(x, z)) return false;
    if (insideCity(x, z)) {
      // a drift that came over the wall, or a body down on the bed against the foot of the wall
      const y = sampleSalt(x, z);
      if (y <= DRIFT_STEP && maxY > UNDER_DECK) return false;
    } else {
      if (maxY > UNDER_DECK && onPier(x, z)) return false;
      if (moatZone(x, z) && sampleSalt(x, z) < SALT_WATER + 0.12) return false;
    }
    sampleSalt(x, z, out ?? scratch);
    return true;
  }

  // Outside the city's seawall: the dry country, the moat and the piers over them
  const exterior = (x, z) => !insideCity(x, z);

  function confine(pos) {
    pos.x = Math.max(SALT_MIN_X + 2, Math.min(SALT_MAX_X - 2, pos.x));
    pos.z = Math.max(SALT_MIN_Z + 2, Math.min(SALT_MAX_Z - 2, pos.z));
  }

  // Manhattan stands on a wall: nothing down on the bed walks in under the streets
  function wall(pos, fromX, fromZ) {
    if (pos.y > UNDER_DECK - 0.3 || !insideCity(pos.x, pos.z)) return false;
    if (sampleSalt(pos.x, pos.z) > pos.y - 1.2 && sampleSalt(pos.x, pos.z) > -1.6) return false; // on a drift that climbs the wall
    if (!insideCity(pos.x, fromZ)) pos.z = fromZ;
    else if (!insideCity(fromX, pos.z)) pos.x = fromX;
    else if (!insideCity(fromX, fromZ)) { pos.x = fromX; pos.z = fromZ; }
    else return false;
    return true;
  }

  // Open water of the moat nearest (x, z)
  function coastWaterNear(x, z, afloat) {
    const ci = Math.round((x - SALT_MIN_X) / MACRO_STEP), cj = Math.round((z - SALT_MIN_Z) / MACRO_STEP);
    for (let r = 0; r < 220; r++) {
      for (let k = -r; k <= r; k++) for (const [i, j] of r === 0 ? [[ci, cj]] : [[ci + k, cj - r], [ci + k, cj + r], [ci - r, cj + k], [ci + r, cj + k]]) {
        if (i < 0 || j < 0 || i >= MACRO_W || j >= MACRO_H || zoneGrid[j * MACRO_W + i] !== 1 || macro[j * MACRO_W + i] > SALT_WATER - 1.6) continue;
        const px = SALT_MIN_X + i * MACRO_STEP, pz = SALT_MIN_Z + j * MACRO_STEP;
        if (afloat(px, pz) && afloat(px + 7, pz + 7) && afloat(px - 7, pz - 7)) return { x: px, z: pz };
      }
    }
    return { x: MOAT_SEED.x, z: MOAT_SEED.z };
  }

  return { deckAt, sample, exterior, confine, wall, landAt: saltLandAt, wetAt: saltWetAt, coastWaterNear };
}

// ---- The way through ------------------------------------------------------------------------------------------------
const navPoints = [], navEdges = [], gateways = [];
const metres = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function link(a, b) {
  const d = metres(navPoints[a], navPoints[b]);
  navEdges[a].push([b, d]); navEdges[b].push([a, d]);
}
const node = p => { navPoints.push(p); navEdges.push([]); return navPoints.length - 1; };
const loopCount = SALT_LOOP.length - 1;
for (let i = 0; i < loopCount; i++) node(SALT_LOOP[i]);
for (let i = 0; i < loopCount; i++) link(i, (i + 1) % loopCount);
function nearestNode(point, limit = navPoints.length) {
  let best = Infinity, result = 0;
  for (let i = 0; i < limit; i++) {
    const d = (point.x - navPoints[i].x) ** 2 + (point.z - navPoints[i].z) ** 2;
    if (d < best) { best = d; result = i; }
  }
  return result;
}
const lineNodes = [];
for (const { spec, path, id } of SALT_ROUTES) {
  const ids = path.map(node);
  for (let i = 1; i < ids.length; i++) link(ids[i - 1], ids[i]);
  lineNodes.push(ids);
  // From the city: over the bridge to its landing, or straight through the gate
  if (spec) { const gate = node(spec.a); link(gate, ids[0]); gateways.push(gate); }
  else if (id === 'pumps' || id === 'nord') gateways.push(ids[0]);
}
// Every line joins whatever passes within 60 m of its ends
SALT_ROUTES.forEach((route, r) => {
  for (const end of [lineNodes[r][0], lineNodes[r].at(-1)]) {
    let best = 60, other = -1;
    for (let i = 0; i < navPoints.length; i++) {
      if (lineNodes[r].includes(i)) continue;
      const d = metres(navPoints[i], navPoints[end]);
      if (d < best) { best = d; other = i; }
    }
    if (other >= 0) link(end, other);
  }
});

// Routing is requested by the map at bounded intervals. Entering from the city considers every crossing.
export function routeThroughSalt(from, to) {
  const sourceOutside = saltLandAt(from.x, from.z);
  const targetOutside = saltLandAt(to.x, to.z);
  if (!sourceOutside && !targetOutside) return null;
  const starts = sourceOutside ? [nearestNode(from)] : gateways;
  const ends = targetOutside ? [nearestNode(to)] : gateways;
  const endSet = new Set(ends);
  const distance = new Float64Array(navPoints.length).fill(Infinity);
  const parent = new Int32Array(navPoints.length).fill(-1);
  const visited = new Uint8Array(navPoints.length);
  for (const i of starts) distance[i] = metres(from, navPoints[i]);
  let arrival = -1, best = Infinity;
  for (;;) {
    let current = -1, cost = best;
    for (let i = 0; i < navPoints.length; i++) if (!visited[i] && distance[i] < cost) { current = i; cost = distance[i]; }
    if (current < 0) break;
    visited[current] = 1;
    if (endSet.has(current) && cost + metres(to, navPoints[current]) < best) {
      best = cost + metres(to, navPoints[current]); arrival = current;
    }
    for (const [next, step] of navEdges[current]) if (cost + step < distance[next]) {
      distance[next] = cost + step; parent[next] = current;
    }
  }
  if (arrival < 0) return null;
  const points = [to];
  for (let current = arrival; current !== -1; current = parent[current]) points.push(navPoints[current]);
  points.push(from);
  return points.reverse();
}
