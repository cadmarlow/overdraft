import { CITY_NORTH, CITY_RING, CITY_SOUTH, cityBoundsAt, cityEdgeDistance, insideCity } from './city-frontier.js';
import { FRONTIER_SITES } from './frontier-districts.js';
import {
  FRONTIER_BRIDGES, HEIGHT_MIN, HEIGHT_RANGE, MACRO_H, MACRO_STEP, MACRO_W, MASK_H, MASK_STEP, MASK_W, ROAD_HALF, SALT_LOOP,
  SALT_MAX_X, SALT_MAX_Z, SALT_MIN_X, SALT_MIN_Z, SALT_PLACES, SALT_ROUTES, SALT_STEP, SALT_WATER, TRACK_HALF, WALL_Z
} from './wasteland-design.js';

// The Wasteland's ground as the game reads it: the baked relief (tools/wasteland/build-terrain.mjs), the 8 m lattice
// that the picture and the wheels share, the urban edge, and the roads through the Wasteland.
export {
  FRONTIER_BRIDGES, SALT_LOOP, SALT_ROUTES, SALT_PLACES, SALT_STEP, SALT_WATER, SALT_MIN_X, SALT_MAX_X, SALT_MIN_Z, SALT_MAX_Z,
  MACRO_STEP, MACRO_W, MACRO_H, MASK_STEP, MASK_W, MASK_H
};
export { CROSSINGS, WEST_GATE, NORTH_GATE, WALL_Z, PADS, ROAD_HALF, TRACK_HALF } from './wasteland-design.js';

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
  if (header.version !== 3 || header.w !== MACRO_W || header.h !== MACRO_H || header.maskW !== MASK_W) throw new Error('Wasteland relief does not match this build: run tools/wasteland/build-terrain.mjs');
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
const macro = terrain.height, calmGrid = terrain.calm, maskGrid = terrain.masks;
export const SALT_TERRAIN = terrain;
export { CITY_RING, insideCity };
export function prepareSaltGround() { /* the relief is read when this module loads */ }

// ---- Roads and tracks ----------------------------------------------------------------------------------------------
export function bridgeFrameAt(spec, x, z) {
  const dx = spec.b.x - spec.a.x, dz = spec.b.z - spec.a.z;
  const length = Math.hypot(dx, dz), ux = dx / length, uz = dz / length;
  const rx = x - spec.a.x, rz = z - spec.a.z;
  return { u: rx * ux + rz * uz, v: rz * ux - rx * uz, length, ux, uz };
}
export const SALT_LINES = [{ id: 'ceinture', kind: 'road', path: SALT_LOOP, closed: true }, ...SALT_ROUTES];
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
    const segment = { a, dx, dz, length, y0: levels[i - 1], y1: levels[i], half: line.half, kind: line.kind, line };
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
  // Keep terrain triangles just beneath the asphalt on both sides of the exact city edge.
  if (z > CITY_NORTH - 64 && z < CITY_SOUTH + 64 && x > -1820 && x < 1360) {
    const { westX, eastX } = cityBoundsAt(z);
    const nearSide = Math.min(Math.abs(x - westX), Math.abs(x - eastX)) < 64;
    if (nearSide || Math.min(Math.abs(z - CITY_NORTH), Math.abs(z - CITY_SOUTH)) < 64) {
      const d = cityEdgeDistance(x, z);
      h = mix(-0.055, h, sm(14, 56, d));
    }
    if (insideCity(x, z)) h = Math.min(h, -0.055);
  }
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

// Outside the inhabited footprint, even the old channels are dry.
export const saltLandAt = (x, z) => insideSaltGrid(x, z) && !insideCity(x, z);

const REGIONS = [
  ['Les Os de Harlem', (x, z) => z < WALL_Z && z > -10800 && x > -2300 && x < 900],
  ['La Rade Blanche', (x, z) => z > 6200 && z < 13200 && x > -2300 && x < 2200],
  ['Le Lit de l’Hudson', (x, z, y) => x < -100 && x > -3350 && z < 7000 && y < 0],
  ['Le Haut-Sel', (x, z, y) => x < -3300 && y > 30],
  ['La Corniche', (x) => x < -3000],
  ['Les Terrasses', (x, z) => z < -6800 && x >= 900],
  ['Les Failles', (x, z) => x > 1150 && x < 2800 && z > 2400 && z < 4600],
  ['Les Terres du Levant', (x, z) => x > 900 && z < 1800],
  ['Les Sables de Brooklyn', (x) => x > 1200],
  ['La Mer de Dunes', (x, z) => z >= 13200]
];
export function saltLocation(x, z) {
  if (!saltLandAt(x, z)) return null;
  const settlement = FRONTIER_SITES.find(site => (x - site.x) ** 2 + (z - site.z) ** 2 < 55 ** 2);
  if (settlement) return settlement.name;
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

// The city deck and the surrounding ground meet at grade.
export function createFrontierSurfaces() {
  return {
    sample(x, z, _maxY, out) {
      if (!saltLandAt(x, z)) return false;
      sampleSalt(x, z, out);
      return true;
    },
    exterior: (x, z) => !insideCity(x, z),
    confine(pos) {
      pos.x = Math.max(SALT_MIN_X + 2, Math.min(SALT_MAX_X - 2, pos.x));
      pos.z = Math.max(SALT_MIN_Z + 2, Math.min(SALT_MAX_Z - 2, pos.z));
    },
    landAt: saltLandAt,
    wetAt: () => false
  };
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
for (const { gate, path } of SALT_ROUTES) {
  const ids = path.map(node);
  for (let i = 1; i < ids.length; i++) link(ids[i - 1], ids[i]);
  lineNodes.push(ids);
  if (gate) gateways.push(ids[0]);
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

// The Ceinture as a ring: the index of its point nearest (x, z), and the road from a point of it on, `length` metres
// of it, going round with the list (direction 1) or against it (-1). The convoys of the Wasteland run on these.
export function saltLoopNearest(x, z) {
  const ring = SALT_LINES[0].path, n = ring.length - 1;
  let best = Infinity, index = 0;
  for (let i = 0; i < n; i++) {
    const d = (ring[i].x - x) ** 2 + (ring[i].z - z) ** 2;
    if (d < best) { best = d; index = i; }
  }
  return { index, distance: Math.sqrt(best) };
}
export function saltLoopAhead(index, direction, length) {
  const ring = SALT_LINES[0].path, n = ring.length - 1, out = [];
  let i = ((index % n) + n) % n, run = 0;
  out.push({ x: ring[i].x, z: ring[i].z, index: i });
  while (run < length && out.length <= n) {
    const next = (i + direction + n) % n;
    run += Math.hypot(ring[next].x - ring[i].x, ring[next].z - ring[i].z);
    i = next;
    out.push({ x: ring[i].x, z: ring[i].z, index: i });
  }
  return out;
}

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
