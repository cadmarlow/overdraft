// The trees themselves: each species grown, meshed at two levels of detail, and photographed from all round into the
// impostor frames it wears far away (so a distant tree is the near one, pixel for pixel, not a stand-in).
//   node tools/trees/build-trees.mjs [--assets dir] [--only id,id]
// Needs the foliage atlas (build-foliage.mjs) and the bark photographs in the assets folder. Writes there:
//   trees.bin.gz      header (JSON) + vertex and index data of every tree and level
//   impostors_c.webp  colour + coverage of every frame;  impostors_n.webp  r g: normal in the frame's own axes, b: sky occlusion
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { SPECIES } from './lib/species.mjs';
import { growTree } from './lib/grow.mjs';
import { buildLevel } from './lib/mesh.mjs';
import { Raster, dilate } from './lib/raster.mjs';
import { loadTextures, drawTree, viewFrom, lit, barkTint } from './lib/draw.mjs';
import { LEAF_KINDS } from './lib/foliage.mjs';
import { toSRGB, writeWebp } from './lib/image.mjs';
import { V } from './lib/util.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const ASSETS = flag('--assets', new URL('../../assets/trees/', import.meta.url).pathname);
const ONLY = flag('--only', null)?.split(',');

// --- Impostor frames: rings of bearings at rising elevations, then straight down from the top
export const RINGS = [
  { el: 0.07, n: 16 },
  { el: 0.52, n: 8 },
  { el: 1.05, n: 4 },
  { el: Math.PI / 2, n: 1 }
];
const GRID = [6, 5]; // frames across and down a tree's layer
const ATLAS = [4096, 2560]; // grown trees in 1024 px layers (two rows of four), young ones in 512 px layers (one row of eight)
const layerOf = (index) => {
  const variant = index % 2, slot = index >> 1;
  return variant === 0 ? { x: (slot % 4) * 1024, y: (slot >> 2) * 1024, size: 1024 } : { x: slot * 512, y: 2048, size: 512 };
};

const stats = JSON.parse(fs.readFileSync(new URL('./lib/foliage-stats.json', import.meta.url), 'utf8'));
const textures = await loadTextures(ASSETS, [...new Set(SPECIES.map((s) => s.bark))]);
const foliageOf = (sp) => ({ row: LEAF_KINDS.findIndex((k) => k.id === sp.leaf), tiles: stats[sp.leaf] });

const color = Buffer.alloc(ATLAS[0] * ATLAS[1] * 4);
const normal = Buffer.alloc((ATLAS[0] / 2) * (ATLAS[1] / 2) * 3, 128);

// Mean sunlit colour and coverage of a level, over a few bearings: what the two levels must agree on
function measure(gb, sp, center, half) {
  let cover = 0, light = 0, n = 0;
  for (const az of [0.3, 2.4, 4.5]) {
    const raster = new Raster(96, 96, 2, 8);
    drawTree(raster, gb, viewFrom(az, 0.1, center, half), textures, sp);
    const res = raster.resolve();
    const bytes = lit(res, V.norm([0.45, 0.75, 0.5]), [0, 0, 0]);
    for (let i = 0; i < 96 * 96; i++) {
      cover += res.coverage[i];
      if (res.coverage[i] > 0.5 && res.out[i * 8 + 7] > 0) { light += bytes[i * 3 + 1] / res.coverage[i]; n++; }
    }
  }
  return { cover: cover / (3 * 96 * 96), light: light / Math.max(1, n) };
}

const types = [];
const chunks = [];
let offset = 0;
const push = (typed) => {
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const pad = (4 - (buf.length % 4)) % 4;
  chunks.push(buf);
  if (pad) chunks.push(Buffer.alloc(pad));
  const at = offset;
  offset += buf.length + pad;
  return at;
};

for (const [index, sp] of SPECIES.entries()) {
  if (ONLY && !ONLY.includes(sp.id)) { types.push(null); continue; }
  const t0 = Date.now();
  const seed = 1 + index * 7919;
  const tree = growTree(sp, seed);
  const foliage = foliageOf(sp);
  const near = buildLevel(tree, 0, foliage, seed);

  // The frame every view of this tree is taken in: a sphere on the trunk's axis that holds all of it
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < near.pos.length; i += 3) { lo = Math.min(lo, near.pos[i]); hi = Math.max(hi, near.pos[i]); }
  const cy = (Math.min(0, lo) + hi) / 2;
  let radius = 0;
  for (let i = 0; i < near.pos.length; i += 3) radius = Math.max(radius, Math.hypot(near.pos[i], near.pos[i + 1] - cy, near.pos[i + 2]));
  const center = [0, cy, 0];
  const half = radius * 1.03;

  // Level 1 fills the same outline as level 0 and comes out as bright: its clusters are sized until it does
  const want = measure(near, sp, center, half);
  let scale = sp.foliage.massScale, far, got;
  for (let pass = 0; pass < 5; pass++) {
    far = buildLevel({ ...tree, species: { ...sp, foliage: { ...sp.foliage, massScale: scale } } }, 1, foliage, seed);
    got = measure(far, sp, center, half);
    const ratio = want.cover / Math.max(1e-4, got.cover);
    if (Math.abs(ratio - 1) < 0.025) break;
    scale *= Math.pow(ratio, 0.8);
  }
  // (measured in the game, level 1 still comes out 7 % brighter than this estimate says: its big cards shade less of each other)
  const gain = Math.min(1.2, Math.max(0.7, Math.pow(want.light / Math.max(1, got.light), 2.2) * 0.93));

  const levels = [near, far].map((gb) => {
    const n = gb.vertices;
    const nrm = new Int8Array(n * 4);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) nrm[i * 4 + c] = Math.round(Math.max(-1, Math.min(1, gb.nrm[i * 3 + c])) * 127);
    const bytes = (list) => Uint8Array.from(list, (v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
    const wide = n > 65535;
    return {
      vertices: n, triangles: gb.triangles, cards: gb.cards, wide,
      position: push(new Float32Array(gb.pos)), normal: push(nrm), uv: push(new Float32Array(gb.uv)),
      wind: push(bytes(gb.wind)), shade: push(bytes(gb.shade)), index: push(wide ? new Uint32Array(gb.idx) : new Uint16Array(gb.idx))
    };
  });

  // Impostor frames
  const layer = layerOf(index);
  const frame = Math.floor(layer.size / GRID[0]);
  const ss = frame > 100 ? 3 : 4;
  let slot = 0;
  for (const ring of RINGS) {
    for (let k = 0; k < ring.n; k++, slot++) {
      const view = viewFrom((k / ring.n) * Math.PI * 2, ring.el, center, half);
      const raster = new Raster(frame, frame, ss, 8);
      drawTree(raster, near, view, textures, sp);
      const res = raster.resolve();
      dilate(res.out, res.coverage, frame, frame, 8, 6);
      const fx = layer.x + (slot % GRID[0]) * frame, fy = layer.y + Math.floor(slot / GRID[0]) * frame;
      for (let y = 0; y < frame; y++) for (let x = 0; x < frame; x++) {
        const i = y * frame + x, o = ((fy + y) * ATLAS[0] + fx + x) * 4;
        const edge = Math.min(x, y, frame - 1 - x, frame - 1 - y);
        // colour multiplied by coverage: mipmaps and blends between frames then never mix in the colour of nothing
        const k = edge < 1 ? 0 : res.coverage[i];
        color[o] = toSRGB(res.out[i * 8] * k); color[o + 1] = toSRGB(res.out[i * 8 + 1] * k); color[o + 2] = toSRGB(res.out[i * 8 + 2] * k);
        color[o + 3] = Math.round(k * 255);
      }
      // normals at half size, in the frame's own axes (right, up; the third always faces the eye)
      const hf = frame >> 1;
      for (let y = 0; y < hf; y++) for (let x = 0; x < hf; x++) {
        let nx = 0, ny = 0, ao = 0, w = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const i = (y * 2 + dy) * frame + x * 2 + dx;
          const k2 = res.coverage[i] + 0.02;
          const n = [res.out[i * 8 + 3], res.out[i * 8 + 4], res.out[i * 8 + 5]];
          nx += V.dot(n, view.right) * k2; ny += V.dot(n, view.up) * k2; ao += res.out[i * 8 + 6] * k2; w += k2;
        }
        const o = (((fy >> 1) + y) * (ATLAS[0] / 2) + (fx >> 1) + x) * 3;
        normal[o] = Math.round(Math.max(0, Math.min(1, (nx / w) * 0.5 + 0.5)) * 255);
        normal[o + 1] = Math.round(Math.max(0, Math.min(1, (ny / w) * 0.5 + 0.5)) * 255);
        normal[o + 2] = Math.round(Math.max(0, Math.min(1, ao / w)) * 255);
      }
    }
  }

  const trunk = tree.branches[0];
  let breast = 0;
  while (breast < trunk.pts.length - 1 && trunk.pts[breast][1] < 1.3) breast++;
  types.push({
    id: sp.id, kind: sp.kind, variant: index % 2, leaf: foliage.row, bark: sp.bark, barkTint: barkTint(textures, sp).map((v) => +v.toFixed(4)),
    height: +hi.toFixed(2), crownRadius: sp.radius, crownBase: sp.crownBase, dbh: sp.dbh, trunkRadius: +trunk.rad[breast].toFixed(3),
    sphere: { y: +cy.toFixed(3), radius: +radius.toFixed(3) }, gain: +gain.toFixed(3), levels,
    impostor: { x: layer.x, y: layer.y, size: layer.size, frame, half: +half.toFixed(3) }
  });
  console.log(sp.id.padEnd(10), `L0 ${near.triangles} tris | L1 ${far.triangles} tris (clusters x${scale.toFixed(2)}, gain ${gain.toFixed(2)}, cover ${want.cover.toFixed(3)} / ${got.cover.toFixed(3)})`,
    `| ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (!ONLY) {
  const header = Buffer.from(JSON.stringify({
    version: 1, atlas: ATLAS, grid: GRID, rings: RINGS.map((r) => ({ el: +r.el.toFixed(4), n: r.n })), types
  }));
  const pad = (4 - (header.length % 4)) % 4;
  const head = Buffer.alloc(8);
  head.write('OTR1', 0, 'latin1');
  head.writeUInt32LE(header.length + pad, 4);
  const raw = Buffer.concat([head, header, Buffer.alloc(pad, 0x20), ...chunks]);
  const gz = zlib.gzipSync(raw, { level: 9 });
  gz[9] = 255; // the OS byte, so that the file is the same wherever it is built
  fs.writeFileSync(path.join(ASSETS, 'trees.bin.gz'), gz);
  await writeWebp(path.join(ASSETS, 'impostors_c.webp'), color, ATLAS[0], ATLAS[1], 4, { quality: 88, alphaQuality: 92 });
  await writeWebp(path.join(ASSETS, 'impostors_n.webp'), normal, ATLAS[0] / 2, ATLAS[1] / 2, 3, { quality: 90 });
  console.log(`trees.bin.gz ${(gz.length / 1e6).toFixed(2)} MB (${(raw.length / 1e6).toFixed(2)} MB raw)`);
}
