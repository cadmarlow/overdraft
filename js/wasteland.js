import * as THREE from 'three/webgpu';
import {
  CHUNK, CROSSINGS, LATTICE_H, LATTICE_W, MACRO_H, MACRO_STEP, MACRO_W, MASK_H, MASK_W, SALT_LINES, SALT_MAX_X, SALT_MAX_Z,
  SALT_MIN_X, SALT_MIN_Z, SALT_STEP, SALT_TERRAIN, createFrontierSurfaces, insideCity, latticeHeight, saltChunk, sampleSalt
} from './wasteland-plan.js';
import { createSaltGroundMaterial, createSaltRoadMaterial, saltTints, saltUniforms } from './wasteland-materials.js';
import { FRONTIER_BLEND_OUT, FRONTIER_SITES, frontierDistance, frontierGroves } from './frontier-districts.js';
import { saltRoadAt } from './wasteland-plan.js';
import { SaltScatter } from './wasteland-scatter.js';
import { buildWastelandWorks } from './wasteland-works.js';

// The Wasteland as it is drawn: the ground in levels of detail around the camera and the routes that cross it. Every height comes from wasteland-plan.js, so the picture is what the wheels roll on.

const TILE_CHUNKS = 4, TILE = CHUNK * TILE_CHUNKS;
const CHUNKS_X = LATTICE_W / CHUNK, CHUNKS_Z = LATTICE_H / CHUNK;
const TILES_X = Math.ceil(CHUNKS_X / TILE_CHUNKS), TILES_Z = Math.ceil(CHUNKS_Z / TILE_CHUNKS);
const clampI = (v, max) => Math.max(0, Math.min(max, v));

// ---- Maps the ground shader reads -----------------------------------------------------------------------------------
function dataTexture(data, width, height, format, type) {
  const map = new THREE.DataTexture(data, width, height, format, type);
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.magFilter = map.minFilter = THREE.LinearFilter;
  map.generateMipmaps = false; map.needsUpdate = true;
  return map;
}
function buildMaps() {
  // Rows padded to a multiple of four texels: two-byte texels on an odd width come out sheared on some back ends
  const HW = Math.ceil(MACRO_W / 4) * 4, heights = new Uint16Array(HW * MACRO_H);
  for (let j = 0; j < MACRO_H; j++) for (let i = 0; i < HW; i++) heights[j * HW + i] = THREE.DataUtils.toHalfFloat(SALT_TERRAIN.height[j * MACRO_W + Math.min(i, MACRO_W - 1)]);
  // Roads and tracks at 16 m: R coverage, G asphalt (1) or beaten earth (0)
  const STEP = 16, W = (SALT_MAX_X - SALT_MIN_X) / STEP + 1, H = (SALT_MAX_Z - SALT_MIN_Z) / STEP + 1;
  const lines = new Uint8Array(W * H * 4);
  for (const line of SALT_LINES) {
    const road = line.kind === 'road', half = line.half;
    for (let k = 1; k < line.path.length; k++) {
      const a = line.path[k - 1], b = line.path[k], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      const reach = half + 20;
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - SALT_MIN_X) / STEP)), i1 = Math.min(W - 1, Math.ceil((Math.max(a.x, b.x) + reach - SALT_MIN_X) / STEP));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach - SALT_MIN_Z) / STEP)), j1 = Math.min(H - 1, Math.ceil((Math.max(a.z, b.z) + reach - SALT_MIN_Z) / STEP));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = SALT_MIN_X + i * STEP, z = SALT_MIN_Z + j * STEP;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)), d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
        const amount = Math.round(255 * Math.max(0, Math.min(1, 1 - (d - half) / 18))), o = (j * W + i) * 4;
        if (amount > lines[o]) { lines[o] = amount; lines[o + 1] = road ? 255 : 0; }
      }
    }
  }
  return {
    masks: dataTexture(SALT_TERRAIN.masks, MASK_W, MASK_H, THREE.RGBAFormat, THREE.UnsignedByteType),
    heights: dataTexture(heights, HW, MACRO_H, THREE.RedFormat, THREE.HalfFloatType), heightW: HW, heightH: MACRO_H, heightStep: MACRO_STEP,
    lines: dataTexture(lines, W, H, THREE.RGBAFormat, THREE.UnsignedByteType), lineW: W, lineH: H, lineStep: STEP
  };
}

// ---- One rectangle of ground ----------------------------------------------------------------------------------------
// Cells [ix0, ix0 + cellsX] x [iz0, iz0 + cellsZ] at one vertex every `stride` lattice steps. The triangles of each
// `blockCells` square are kept together, so that a block can be left out when finer ground stands in for it; a skirt
// hangs from the rim to close whatever gap a coarser neighbour leaves.
function buildPatch(ix0, iz0, cellsX, cellsZ, stride, heightAt, blockCells = 0) {
  const nx = cellsX / stride, nz = cellsZ / stride, hw = nx + 3, side = nx + 1;
  const hs = new Float32Array(hw * (nz + 3));
  for (let j = -1; j <= nz + 1; j++) for (let i = -1; i <= nx + 1; i++) hs[(j + 1) * hw + i + 1] = heightAt(clampI(ix0 + i * stride, LATTICE_W), clampI(iz0 + j * stride, LATTICE_H));
  const count = side * (nz + 1), rim = 2 * side + 2 * (nz + 1), step = stride * SALT_STEP;
  const position = new Float32Array((count + rim) * 3), normal = new Float32Array((count + rim) * 3);
  let minY = Infinity, maxY = -Infinity;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const o = (j * side + i) * 3, y = hs[(j + 1) * hw + i + 1];
    position[o] = SALT_MIN_X + (ix0 + i * stride) * SALT_STEP; position[o + 1] = y; position[o + 2] = SALT_MIN_Z + (iz0 + j * stride) * SALT_STEP;
    const dx = hs[(j + 1) * hw + i] - hs[(j + 1) * hw + i + 2], dz = hs[j * hw + i + 1] - hs[(j + 2) * hw + i + 1], k = 1 / Math.hypot(dx, 2 * step, dz);
    normal[o] = dx * k; normal[o + 1] = 2 * step * k; normal[o + 2] = dz * k;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const index = [], blocks = [];
  const bq = blockCells ? blockCells / stride : Math.max(nx, nz);
  for (let bz = 0; bz < nz; bz += bq) for (let bx = 0; bx < nx; bx += bq) {
    const start = index.length;
    for (let j = bz; j < Math.min(bz + bq, nz); j++) for (let i = bx; i < Math.min(bx + bq, nx); i++) {
      const a = j * side + i;
      index.push(a, a + side, a + 1, a + 1, a + side, a + side + 1);
    }
    blocks.push([start, index.length - start]);
  }
  const skirtStart = index.length, drop = 3 + step * 0.55;
  let v = count;
  const hang = (list) => {
    const first = v;
    for (const a of list) {
      position[v * 3] = position[a * 3]; position[v * 3 + 1] = position[a * 3 + 1] - drop; position[v * 3 + 2] = position[a * 3 + 2];
      normal[v * 3] = normal[a * 3]; normal[v * 3 + 1] = normal[a * 3 + 1]; normal[v * 3 + 2] = normal[a * 3 + 2];
      v++;
    }
    for (let k = 0; k + 1 < list.length; k++) {
      const a = list[k], b = list[k + 1], c = first + k, d = first + k + 1;
      index.push(a, b, c, b, d, c, a, c, b, b, c, d); // seen from both sides
    }
  };
  const row = (j) => Array.from({ length: side }, (_, i) => j * side + i), column = (i) => Array.from({ length: nz + 1 }, (_, j) => j * side + i);
  hang(row(0)); hang(row(nz)); hang(column(0)); hang(column(nx));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(index), 1));
  const x0 = SALT_MIN_X + ix0 * SALT_STEP, z0 = SALT_MIN_Z + iz0 * SALT_STEP, w = cellsX * SALT_STEP, d = cellsZ * SALT_STEP;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(x0 + w / 2, (minY + maxY - drop) / 2, z0 + d / 2), Math.hypot(w, d, maxY - minY + drop) / 2);
  return { geometry, blocks, skirtStart, source: blockCells ? Uint16Array.from(index) : null };
}

class SaltGround {
  constructor(parent, material, frontierMaterial) {
    this.material = material;
    this.frontierMaterial = frontierMaterial;
    this.group = new THREE.Group(); this.group.name = 'Sol du Wasteland';
    parent.add(this.group);
    this.chunks = new Map();
    // Chunks nobody will ever see: buried under the streets
    const { height, zone } = SALT_TERRAIN, per = CHUNK * SALT_STEP / MACRO_STEP;
    this.dead = new Uint8Array(CHUNKS_X * CHUNKS_Z);
    for (let cz = 0; cz < CHUNKS_Z; cz++) for (let cx = 0; cx < CHUNKS_X; cx++) {
      let city = true;
      for (let j = cz * per - 1; j <= (cz + 1) * per + 1 && city; j++) for (let i = cx * per - 1; i <= (cx + 1) * per + 1; i++) {
        const o = clampI(j, MACRO_H - 1) * MACRO_W + clampI(i, MACRO_W - 1);
        if (zone[o] !== 2 || height[o] > -0.4) city = false;
      }
      this.dead[cz * CHUNKS_X + cx] = city ? 1 : 0;
    }
    this.tiles = [];
    for (let tz = 0; tz < TILES_Z; tz++) for (let tx = 0; tx < TILES_X; tx++) {
      const tile = { tx, tz, stride: 0, mesh: null, mask: -1, blocks: null, source: null, skirtStart: 0 };
      tile.cells = Math.min(TILE, LATTICE_H - tz * TILE);
      tile.cx = SALT_MIN_X + (tx + 0.5) * TILE * SALT_STEP; tile.cz = SALT_MIN_Z + (tz * TILE + tile.cells / 2) * SALT_STEP;
      tile.allDead = true;
      for (let k = 0; k < 16; k++) if (!this.blockDead(tile, k)) tile.allDead = false;
      this.tiles.push(tile);
      if (!tile.allDead) this.buildTile(tile, 16);
    }
    this.stats = { chunks: 0, built: 0 };
  }

  blockDead(tile, k) {
    const cx = tile.tx * TILE_CHUNKS + (k & 3), cz = tile.tz * TILE_CHUNKS + (k >> 2);
    return cz >= CHUNKS_Z || this.dead[cz * CHUNKS_X + cx] === 1;
  }

  materialAt(cx, cz, width, depth) {
    // Signed distance cannot vary by more than the radius of the patch.
    const radius = Math.hypot(width, depth) * 0.5;
    return Math.abs(frontierDistance(cx, cz)) <= radius + FRONTIER_BLEND_OUT + SALT_STEP
      ? this.frontierMaterial : this.material;
  }

  buildTile(tile, stride) {
    const patch = buildPatch(tile.tx * TILE, tile.tz * TILE, TILE, tile.cells, stride, latticeHeight, CHUNK);
    if (tile.mesh) { this.group.remove(tile.mesh); tile.mesh.geometry.dispose(); }
    tile.mesh = new THREE.Mesh(patch.geometry, this.materialAt(tile.cx, tile.cz, TILE * SALT_STEP, tile.cells * SALT_STEP));
    tile.mesh.name = 'Sol lointain'; tile.mesh.receiveShadow = true; tile.mesh.matrixAutoUpdate = false;
    tile.stride = stride; tile.blocks = patch.blocks; tile.source = patch.source; tile.skirtStart = patch.skirtStart; tile.mask = -1;
    this.group.add(tile.mesh);
    tile.mesh.updateMatrixWorld();
    this.maskTile(tile);
  }

  // Leave out the blocks that finer chunks, or the city stand in for
  maskTile(tile) {
    let mask = 0;
    const rows = tile.cells / CHUNK;
    for (let bz = 0; bz < rows; bz++) for (let bx = 0; bx < TILE_CHUNKS; bx++) {
      const k = bz * 4 + bx, id = (tile.tz * TILE_CHUNKS + bz) * CHUNKS_X + tile.tx * TILE_CHUNKS + bx;
      if (this.dead[id] || this.chunks.has(id)) mask |= 1 << k;
    }
    if (mask === tile.mask) return;
    tile.mask = mask;
    const index = tile.mesh.geometry.index, array = index.array;
    let n = 0;
    for (let bz = 0; bz < rows; bz++) for (let bx = 0; bx < TILE_CHUNKS; bx++) {
      if (mask & (1 << (bz * 4 + bx))) continue;
      const [start, count] = tile.blocks[bz * TILE_CHUNKS + bx];
      array.set(tile.source.subarray(start, start + count), n); n += count;
    }
    array.set(tile.source.subarray(tile.skirtStart), n); n += tile.source.length - tile.skirtStart;
    index.needsUpdate = true;
    tile.mesh.geometry.setDrawRange(0, n);
  }

  buildChunk(cx, cz, stride) {
    const id = cz * CHUNKS_X + cx, old = this.chunks.get(id);
    const ix0 = cx * CHUNK, iz0 = cz * CHUNK;
    let heightAt = latticeHeight;
    if (stride === 1) {
      const hs = saltChunk(cx, cz);
      heightAt = (ix, iz) => (ix >= ix0 && ix <= ix0 + CHUNK && iz >= iz0 && iz <= iz0 + CHUNK ? hs[(iz - iz0) * (CHUNK + 1) + ix - ix0] : latticeHeight(ix, iz));
    }
    const { geometry } = buildPatch(ix0, iz0, CHUNK, CHUNK, stride, heightAt);
    const span = CHUNK * SALT_STEP;
    const material = this.materialAt(SALT_MIN_X + (cx + 0.5) * span, SALT_MIN_Z + (cz + 0.5) * span, span, span);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Sol proche'; mesh.receiveShadow = true; mesh.castShadow = stride === 1; mesh.matrixAutoUpdate = false;
    if (old) { this.group.remove(old.mesh); old.mesh.geometry.dispose(); }
    this.group.add(mesh);
    mesh.updateMatrixWorld();
    this.chunks.set(id, { mesh, stride, cx, cz });
    this.stats.built++;
  }

  update(camera) {
    const span = CHUNK * SALT_STEP, lift = Math.max(0, camera.y - 90) * 0.7;
    const ccx = Math.floor((camera.x - SALT_MIN_X) / span), ccz = Math.floor((camera.z - SALT_MIN_Z) / span);
    const reach = (x0, z0, w, d) => Math.hypot(Math.max(x0 - camera.x, 0, camera.x - x0 - w), Math.max(z0 - camera.z, 0, camera.z - z0 - d), lift);
    // Near ground: 8 m lattice close by, 16 m to a kilometre and a half
    let best = null, bestD = Infinity;
    const wanted = new Set();
    for (let cz = ccz - 4; cz <= ccz + 4; cz++) for (let cx = ccx - 4; cx <= ccx + 4; cx++) {
      if (cx < 0 || cz < 0 || cx >= CHUNKS_X || cz >= CHUNKS_Z) continue;
      const id = cz * CHUNKS_X + cx;
      if (this.dead[id]) continue;
      const d = reach(SALT_MIN_X + cx * span, SALT_MIN_Z + cz * span, span, span), have = this.chunks.get(id);
      const stride = d < (have?.stride === 1 ? 660 : 560) ? 1 : d < (have ? 1560 : 1400) ? 2 : 0;
      if (!stride) continue;
      wanted.add(id);
      if (have?.stride !== stride && d < bestD) { bestD = d; best = [cx, cz, stride]; }
    }
    // Each chunk that comes or goes changes what its far tile must draw in its place
    const dirty = this.dirty ??= new Set();
    const tileOf = (cx, cz) => this.tiles[Math.floor(cz / TILE_CHUNKS) * TILES_X + Math.floor(cx / TILE_CHUNKS)];
    for (const [id, chunk] of this.chunks) if (!wanted.has(id)) { this.group.remove(chunk.mesh); chunk.mesh.geometry.dispose(); this.chunks.delete(id); dirty.add(tileOf(chunk.cx, chunk.cz)); }
    if (best) { this.buildChunk(...best); dirty.add(tileOf(best[0], best[1])); }
    // Far ground: 2 km tiles at 32, 64 or 128 m
    let tile = null, tileD = Infinity, tileStride = 0;
    for (const t of this.tiles) {
      if (t.allDead) continue;
      const w = TILE * SALT_STEP, d = reach(t.cx - w / 2, t.cz - t.cells * SALT_STEP / 2, w, t.cells * SALT_STEP);
      const stride = d < (t.stride === 4 ? 4300 : 3800) ? 4 : d < (t.stride <= 8 ? 9400 : 8500) ? 8 : 16;
      if (stride !== t.stride && d < tileD) { tileD = d; tile = t; tileStride = stride; }
    }
    if (tile) this.buildTile(tile, tileStride);
    for (const t of dirty) if (t?.mesh) this.maskTile(t);
    dirty.clear();
    this.stats.chunks = this.chunks.size;
  }
}

// ---- Roads ---------------------------------------------------------------------------------------------------------
function densify(path, spacing) {
  const result = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / spacing);
    for (let j = 1; j <= n; j++) result.push({ x: a.x + (b.x - a.x) * j / n, z: a.z + (b.z - a.z) * j / n });
  }
  return result;
}
function clip(poly, distance) {
  if (!poly.length) return poly;
  const result = [];
  let a = poly.at(-1), da = distance(a);
  for (const b of poly) {
    const db = distance(b);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      result.push(a.map((value, i) => value + (b[i] - value) * t));
    }
    if (db >= 0) result.push(b);
    a = b; da = db;
  }
  return result;
}
// Cut a flat ribbon along the lattice's own triangles, so that it lies exactly on the ground
function conformRoad(position, coord, index) {
  const vertices = [], road = [], triangles = [];
  for (let i = 0; i < index.length; i += 3) {
    const triangle = [index[i], index[i + 1], index[i + 2]].map(j => [position[j * 3], position[j * 3 + 2], coord[j * 3], coord[j * 3 + 1], coord[j * 3 + 2]]);
    const xs = triangle.map(v => v[0]), zs = triangle.map(v => v[1]);
    const x0 = Math.floor((Math.min(...xs) - SALT_MIN_X) / SALT_STEP), x1 = Math.floor((Math.max(...xs) - SALT_MIN_X) / SALT_STEP);
    const z0 = Math.floor((Math.min(...zs) - SALT_MIN_Z) / SALT_STEP), z1 = Math.floor((Math.max(...zs) - SALT_MIN_Z) / SALT_STEP);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const x = SALT_MIN_X + ix * SALT_STEP, z = SALT_MIN_Z + iz * SALT_STEP;
      let cell = clip(triangle, p => p[0] - x);
      cell = clip(cell, p => x + SALT_STEP - p[0]);
      cell = clip(cell, p => p[1] - z);
      cell = clip(cell, p => z + SALT_STEP - p[1]);
      for (const sign of [-1, 1]) {
        const half = clip(cell, p => sign * (x + z + SALT_STEP - p[0] - p[1]));
        if (half.length < 3) continue;
        const start = vertices.length / 3;
        for (const [px, pz, across, metres, wear] of half) {
          vertices.push(px, sampleSalt(px, pz) + 0.04, pz);
          road.push(across, metres, wear);
        }
        for (let j = 1; j + 1 < half.length; j++) triangles.push(start, start + j, start + j + 1);
      }
    }
  }
  return [vertices, road, triangles];
}
function ribbon(material, path, from, to, halfWidth, metre, deckHeight = null) {
  const position = [], coord = [], index = [];
  for (let i = from; i <= to; i++) {
    const p = path[i], a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz) || 1;
    if (i > from) metre += Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z);
    for (const s of [-1, -0.5, 0, 0.5, 1]) {
      position.push(p.x - dz / length * halfWidth * s, deckHeight ? deckHeight(i) + 0.085 : 0, p.z + dx / length * halfWidth * s);
      coord.push(s, metre, deckHeight ? 0 : 0.5);
    }
    if (i > from) {
      const j = (i - from - 1) * 5;
      for (let k = 0; k < 4; k++) index.push(j + k, j + k + 1, j + k + 5, j + k + 1, j + k + 6, j + k + 5);
    }
  }
  const [vertices, coordinates, triangles] = deckHeight ? [position, coord, index] : conformRoad(position, coord, index);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('roadCoord', new THREE.Float32BufferAttribute(coordinates, 3));
  geometry.setIndex(triangles); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Route du Wasteland'; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
  return { mesh, metre };
}

class SaltRoads {
  constructor(parent, material) {
    this.parent = parent; this.material = material;
    this.sectors = [];
    const SECTOR = 56; // points of 8 m: about 450 m of road each
    for (const line of SALT_LINES) {
      if (line.kind !== 'road') continue;
      let path = densify(line.path, 8);
      // The asphalt inside the city already has its own material.
      let first = 0;
      while (first < path.length - 2 && insideCity(path[first].x, path[first].z)) first++;
      path = path.slice(Math.max(0, first - 1));
      for (let from = 0; from < path.length - 1; from += SECTOR) {
        const to = Math.min(from + SECTOR, path.length - 1), mid = path[(from + to) >> 1];
        this.sectors.push({ path, from, to, half: line.half, x: mid.x, z: mid.z, mesh: null });
      }
    }
  }

  update(camera) {
    let nearest = null, best = 1500;
    for (const s of this.sectors) {
      const d = Math.hypot(s.x - camera.x, s.z - camera.z);
      if (s.mesh) s.mesh.visible = d < 1900;
      else if (d < best) { best = d; nearest = s; }
    }
    if (!nearest) return;
    const { mesh } = ribbon(this.material, nearest.path, nearest.from, nearest.to, nearest.half, nearest.from * 8);
    nearest.mesh = mesh;
    this.parent.add(mesh); mesh.updateMatrixWorld();
  }
}

export function buildWasteland(scene, { surfaces, kit }) {
  const group = new THREE.Group(); group.name = 'Wasteland';
  const maps = buildMaps();
  const ground = new SaltGround(group, createSaltGroundMaterial(surfaces, maps), createSaltGroundMaterial(surfaces, maps, { frontier: true }));
  const roads = new SaltRoads(group, createSaltRoadMaterial(surfaces));
  const works = buildWastelandWorks(group, surfaces);
  const scatter = new SaltScatter(group, kit);
  const road = {};
  const trees = frontierGroves().filter(({ x, z }) =>
    (!saltRoadAt(x, z, road) || road.distance > road.half + 5) &&
    FRONTIER_SITES.every(site => Math.hypot(x - site.x, z - site.z) > site.width * 0.65 + 9)
  ).map(site => ({ ...site, y: sampleSalt(site.x, site.z) }));
  scene.add(group);
  group.updateMatrixWorld(true);
  const update = (camera, time) => {
    saltUniforms.uTime.value = time;
    ground.update(camera);
    roads.update(camera);
    scatter.update(camera);
  };
  // The rocks and wrecks near the camera are given to the colliders as it moves
  const attach = (controllers) => { scatter.controllers = controllers; };
  return { group, ground, roads, scatter, works, trees, attach, maps, tints: saltTints, uniforms: saltUniforms, colliders: works.colliders, surfaces: createFrontierSurfaces(),
    approachReserves: CROSSINGS.map(({ x, z }) => ({ minX: x - 17, maxX: x + 17, minZ: z - 17, maxZ: z + 17, minY: 0, maxY: 12 })), update };
}
