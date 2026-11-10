// The foliage atlas: scanned leaves (ambientCG and Poly Haven, CC0) set in three dimensions along twigs, each leaf
// tilted, folded and drooping on its own, then seen from the side the leaves face and baked into the cards the trees
// wear. Usage: node tools/trees/build-foliage.mjs <folder of fetch.mjs> [--out dir] [--preview dir] [--only id]
//   assets/trees/foliage_c.webp  colour (sRGB) + coverage
//   assets/trees/foliage_n.webp  r g: the leaves' normals in the card's frame; b: how thin the foliage is there
//                                (1 = one leaf the sun shines through, 0 = wood or leaves on leaves)
import fs from 'node:fs';
import path from 'node:path';
import { rng, V, clamp, lerp, noise1 } from './lib/util.mjs';
import { Raster, dilate } from './lib/raster.mjs';
import { cutSet, cutLeaves, gradeLeaves, fanLeaf } from './lib/leaves.mjs';
import { toSRGB, writeWebp, writePng } from './lib/image.mjs';
import { LEAF_KINDS, TILE, COLS, GUTTER, FOOT, TILE_SIZE, ATLAS_W, ATLAS_H } from './lib/foliage.mjs';

const args = process.argv.slice(2);
const RAW = args[0];
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const OUT = flag('--out', new URL('../../assets/trees/', import.meta.url).pathname);
const PREVIEW = flag('--preview', null);
const ONLY = flag('--only', null);
const SS = 4;
if (!RAW) { console.error('usage: node build-foliage.mjs <folder of fetch.mjs> [--out dir] [--preview dir]'); process.exit(1); }

// ---------------------------------------------------------------------------------------------------------------------
// A spray in three dimensions. x across, y along the twig, z toward whoever looks at the card.
// ---------------------------------------------------------------------------------------------------------------------
const K = 12; // varyings per vertex: u v | normal | tint | z | wood | pad
class Model {
  constructor() { this.tris = []; }

  // A leaf: stalk end at `base`, pointing along `axis`, its upper face toward `normal`
  leaf(leaf, base, axis, normal, length, kind, r) {
    const side = V.norm(V.cross(axis, normal));
    const up = V.norm(V.cross(side, axis));
    const width = length * leaf.aspect;
    const tone = 0.8 + r() * 0.34;
    const warm = r() * 0.16 - 0.06;
    const tint = [tone * (1 + warm), tone, tone * (1 - warm * 1.4)];
    const fold = kind.fold * (0.5 + r()), droop = kind.droop * (0.4 + r() * 0.9), twist = (r() - 0.5) * 0.5;
    const ROWSN = 4;
    const grid = [];
    for (let j = 0; j <= ROWSN; j++) {
      const t = j / ROWSN;
      // the blade bends down toward its tip and twists a little along its length
      const sag = -droop * t * t * length * 0.5;
      const tw = twist * t;
      const s2 = V.norm(V.mad(V.scale(side, Math.cos(tw)), up, Math.sin(tw)));
      const u2 = V.norm(V.cross(s2, axis));
      const mid = V.mad(V.mad(base, axis, t * length * (1 - 0.12 * droop * t)), up, sag);
      for (let i = 0; i <= 2; i++) {
        const s = i / 2 - 0.5;
        // both halves fold up from the midrib
        const p = V.mad(V.mad(mid, s2, s * width), u2, Math.abs(s) * width * fold);
        const n = V.norm(V.mad(V.mad(u2, s2, -Math.sign(s) * fold * 1.6), axis, droop * t * 0.8));
        grid.push({ p, n, u: i / 2, v: 1 - t });
      }
    }
    for (let j = 0; j < ROWSN; j++) for (let i = 0; i < 2; i++) {
      const a = grid[j * 3 + i], b = grid[j * 3 + i + 1], c = grid[(j + 1) * 3 + i], d = grid[(j + 1) * 3 + i + 1];
      this.tris.push({ leaf, side, axis, tint, v: [a, b, d] }, { leaf, side, axis, tint, v: [a, d, c] });
    }
  }

  // A shoot as a ribbon turned to the viewer, round in its shading
  wood(points, color) {
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i], b = points[i + 1];
      const dir = V.norm(V.sub(b.p, a.p));
      const side = V.norm(V.cross(dir, [0, 0, 1]));
      const quad = [
        { p: V.mad(a.p, side, -a.r), n: V.norm(V.mad([0, 0, 0.55], side, -1)), u: 0, v: 0 },
        { p: V.mad(a.p, side, a.r), n: V.norm(V.mad([0, 0, 0.55], side, 1)), u: 1, v: 0 },
        { p: V.mad(b.p, side, -b.r), n: V.norm(V.mad([0, 0, 0.55], side, -1)), u: 0, v: 1 },
        { p: V.mad(b.p, side, b.r), n: V.norm(V.mad([0, 0, 0.55], side, 1)), u: 1, v: 1 }
      ];
      this.tris.push({ leaf: null, tint: color, v: [quad[0], quad[1], quad[3]] }, { leaf: null, tint: color, v: [quad[0], quad[3], quad[2]] });
    }
  }

  // The model moved: turned round z by `yaw`, tipped out of the plane by `pitch` round x, scaled, then shifted
  placed(yaw, pitch, scale, offset) {
    const turn = (p) => {
      let [x, y, z] = p;
      [y, z] = [y * Math.cos(pitch) - z * Math.sin(pitch), y * Math.sin(pitch) + z * Math.cos(pitch)];
      [x, y] = [x * Math.cos(yaw) - y * Math.sin(yaw), x * Math.sin(yaw) + y * Math.cos(yaw)];
      return [x, y, z];
    };
    const out = new Model();
    for (const t of this.tris) {
      out.tris.push({
        ...t,
        side: t.side && turn(t.side), axis: t.axis && turn(t.axis),
        v: t.v.map((q) => ({ ...q, p: V.add(V.scale(turn(q.p), scale), offset), n: turn(q.n) }))
      });
    }
    return out;
  }

  merge(other) { for (const t of other.tris) this.tris.push(t); return this; }
}

// A shoot from p0 along dir: its line (thinning to the tip), bending by `bend` radians over its length
function shootLine(p0, dir, length, radius, bend, r, wander) {
  const steps = Math.max(4, Math.round(length / 0.04));
  const pts = [{ p: p0, r: radius, d: dir }];
  let d = dir, p = p0;
  const axis = [0, 0, 1];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    d = V.norm(V.add(V.rotate(d, axis, bend / steps + wander(t * 5) * 0.035), [0, 0, (r() - 0.5) * 0.03]));
    p = V.mad(p, d, length / steps);
    pts.push({ p, r: radius * (1 - 0.72 * t), d });
  }
  return pts;
}

const pointAt = (line, t) => {
  const f = clamp(t) * (line.length - 1), i = Math.min(line.length - 2, Math.floor(f)), k = f - i;
  return { p: V.lerp(line[i].p, line[i + 1].p, k), d: V.norm(V.lerp(line[i].d, line[i + 1].d, k)) };
};

// Leaves along a shoot, as the kind wears them
function dress(model, line, length, kind, leaves, r, sizeScale = 1) {
  const leafAt = (at, side, spin, scale) => {
    const angle = lerp(kind.angle[0], kind.angle[1], r());
    // off the shoot to one side, in the plane of the spray, then rolled out of it
    let axis = V.rotate(at.d, [0, 0, 1], side * angle);
    axis = V.norm(V.add(axis, [0, 0, (r() - 0.5) * kind.tilt * 0.9 + spin]));
    let normal = V.norm(V.sub([0, 0, 1], V.scale(axis, axis[2])));
    normal = V.rotate(normal, axis, (r() - 0.5) * kind.tilt * 1.6);
    const size = kind.leaf * sizeScale * scale * (1 - kind.vary / 2 + r() * kind.vary);
    model.leaf(r.pick(leaves), at.p, axis, normal, size, kind, r);
  };
  const n = Math.max(2, Math.round(length / kind.spacing));
  if (kind.habit === 'tuft') {
    // a few leaves along the shoot, and a rosette of them at its end
    for (let i = 0; i < n; i++) {
      if (r() < 0.45) continue;
      leafAt(pointAt(line, (i + 0.6) / n), i % 2 ? 1 : -1, 0, 0.9);
    }
    const end = pointAt(line, 1);
    const count = 4 + Math.floor(r() * 3);
    for (let i = 0; i < count; i++) {
      const a = ((i + r() * 0.6) / count) * 2 - 1; // -1 .. 1 round the tip
      leafAt({ p: end.p, d: V.rotate(end.d, [0, 0, 1], a * 0.5) }, Math.sign(a) || 1, (r() - 0.5) * 0.5, 1.05);
    }
    return;
  }
  for (let i = 0; i < n; i++) {
    const at = pointAt(line, (i + 0.55 + r() * 0.3) / n);
    const taper = 1.05 - 0.3 * (i / n);
    if (kind.habit === 'opposite') { leafAt(at, 1, 0, taper); leafAt(at, -1, 0, taper); }
    else leafAt(at, i % 2 ? 1 : -1, 0, taper);
  }
  // and one at the very end, pointing on
  const end = pointAt(line, 1);
  model.leaf(r.pick(leaves), end.p, V.norm(V.add(end.d, [0, 0, (r() - 0.5) * 0.3])), [0, 0, 1], kind.leaf * sizeScale * (0.9 + r() * 0.2), kind, r);
}

// A twig with its side shoots. `reach` is its length in metres.
function spray(kind, leaves, seed, reach, shoots = kind.shoots) {
  const r = rng(seed);
  const model = new Model();
  const wander = noise1(seed * 3 + 1);
  const main = shootLine([0, 0, 0], V.norm([(r() - 0.5) * 0.16, 1, 0]), reach, 0.0045 + reach * 0.003, (r() - 0.5) * 0.5, r, wander);
  const lines = [{ line: main, length: reach }];
  for (let i = 0; i < shoots; i++) {
    const t = lerp(0.08, 0.84, (i + r() * 0.7) / shoots);
    const at = pointAt(main, t);
    const side = i % 2 ? 1 : -1;
    const dir = V.norm(V.add(V.rotate(at.d, [0, 0, 1], side * lerp(0.62, 0.98, r())), [0, 0, (r() - 0.5) * 0.5]));
    // longest low down, so the spray comes to a point
    const length = reach * lerp(0.62, 0.22, t) * (0.8 + r() * 0.4);
    const line = shootLine(at.p, dir, length, 0.0028, side * (r() * 0.5 - 0.1), r, noise1(seed * 7 + i));
    lines.push({ line, length });
    // a long shoot carries shoots of its own
    for (let j = 0; length > reach * 0.3 && j < 2; j++) {
      const sub = pointAt(line, lerp(0.3, 0.72, (j + r() * 0.6) / 2));
      const turn = (j % 2 ? 1 : -1) * side * lerp(0.7, 1.0, r());
      const subDir = V.norm(V.add(V.rotate(sub.d, [0, 0, 1], turn), [0, 0, (r() - 0.5) * 0.6]));
      const subLength = length * lerp(0.5, 0.34, j / 2) * (0.8 + r() * 0.4);
      lines.push({ line: shootLine(sub.p, subDir, subLength, 0.002, (r() - 0.5) * 0.5, r, noise1(seed * 11 + i * 3 + j)), length: subLength });
    }
  }
  // the furthest back first makes no difference to a depth buffer, but shoots are drawn before their leaves
  for (const { line } of lines) model.wood(line, kind.wood);
  for (const { line, length } of lines) dress(model, line, length, kind, leaves, r);
  return model;
}

// A branch end: sprays fanning out of a forking stem, some toward the viewer, some away: a full, round clump
function mass(kind, leaves, seed, size) {
  const r = rng(seed);
  const model = new Model();
  const trunk = shootLine([0, 0, -0.12], V.norm([(r() - 0.5) * 0.2, 1, 0]), size * 0.34, 0.013, (r() - 0.5) * 0.3, r, noise1(seed));
  const stems = [trunk];
  for (const side of [-1, 1]) {
    const at = pointAt(trunk, 0.25 + r() * 0.2);
    stems.push(shootLine(at.p, V.rotate(at.d, [0, 0, 1], side * (0.75 + r() * 0.3)), size * 0.3, 0.009, -side * 0.35, r, noise1(seed + side)));
  }
  for (const stem of stems) model.wood(stem, kind.wood);
  const count = 24;
  for (let i = 0; i < count; i++) {
    const stem = stems[i % stems.length];
    const f = ((i / stems.length) | 0) / Math.ceil(count / stems.length - 1);
    const at = pointAt(stem, lerp(0.15, 1, Math.pow(f, 0.75)));
    const lean = Math.atan2(at.d[0], at.d[1]);
    const yaw = lean + (i % 2 ? 1 : -1) * lerp(1.15, 0.15, f) * (0.6 + r() * 0.6) + (r() - 0.5) * 0.4;
    const pitch = (r() - 0.5) * 1.5;
    const reach = size * lerp(0.36, 0.3, f) * (0.85 + r() * 0.3);
    const one = spray(kind, leaves, seed * 31 + i * 17, reach, Math.max(3, kind.shoots - 3));
    model.merge(one.placed(-yaw, pitch, 1, V.add(at.p, [0, 0, (r() - 0.5) * 0.2])));
  }
  return model;
}

// ---------------------------------------------------------------------------------------------------------------------
// Baking a model into a tile
// ---------------------------------------------------------------------------------------------------------------------
// The square that holds the model with a little air round it: its side in metres, and how far up it the twig's foot
// sits (leaves hang below the foot of a spray, a branch end spreads well under its stem)
function frame(model) {
  let x = 0, top = 0, low = 0;
  for (const t of model.tris) for (const q of t.v) { x = Math.max(x, Math.abs(q.p[0])); top = Math.max(top, q.p[1]); low = Math.min(low, q.p[1]); }
  const size = Math.max(2 * x, top - low) / 0.93;
  return { size, foot: Math.max(FOOT, (-low) / size + 0.035) };
}

function bake(model, size, foot) {
  const raster = new Raster(TILE, TILE, SS, 8);
  const texel = new Float32Array(6), tmp = new Float32Array(6);
  const sampleStep = size / (TILE * SS); // metres per sample
  const v0 = new Float32Array(K), v1 = new Float32Array(K), v2 = new Float32Array(K);
  const fill = (dst, q, tint) => {
    dst[0] = q.u; dst[1] = q.v; dst[2] = q.n[0]; dst[3] = q.n[1]; dst[4] = q.n[2];
    dst[5] = tint[0]; dst[6] = tint[1]; dst[7] = tint[2]; dst[8] = q.p[2];
  };
  const sx = (p) => (p[0] / size + 0.5) * TILE, sy = (p) => (1 - foot - p[1] / size) * TILE;
  for (const t of model.tris) {
    const [a, b, c] = t.v;
    fill(v0, a, t.tint); fill(v1, b, t.tint); fill(v2, c, t.tint);
    let shade;
    if (t.leaf) {
      const tex = t.leaf.tex, side = t.side, axis = t.axis;
      // texels of the leaf per sample of the tile, from this triangle's size on both
      const texels = (p, q) => Math.hypot((q.u - p.u) * tex.w, (q.v - p.v) * tex.h) / Math.max(1e-6, V.dist(p.p, q.p) / sampleStep);
      const lod = Math.max(0, Math.log2(Math.max(texels(a, b), texels(a, c))));
      shade = (vary, out, threshold) => {
        tex.sample(vary[0], vary[1], lod, texel, tmp);
        if (texel[3] <= threshold * 0.96 + 0.02) return false;
        let nx = vary[2] + (side[0] * texel[4] + axis[0] * texel[5]) * 0.9;
        let ny = vary[3] + (side[1] * texel[4] + axis[1] * texel[5]) * 0.9;
        let nz = vary[4] + (side[2] * texel[4] + axis[2] * texel[5]) * 0.9;
        if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.hypot(nx, ny, nz) || 1;
        out[0] = texel[0] * vary[5]; out[1] = texel[1] * vary[6]; out[2] = texel[2] * vary[7];
        out[3] = nx / l; out[4] = ny / l; out[5] = nz / l; out[6] = 1; out[7] = vary[8];
        return true;
      };
    } else {
      shade = (vary, out) => {
        const l = Math.hypot(vary[2], vary[3], vary[4]) || 1;
        const grain = 0.82 + 0.3 * Math.abs(Math.sin(vary[1] * 40));
        out[0] = vary[5] * grain; out[1] = vary[6] * grain; out[2] = vary[7] * grain;
        out[3] = vary[2] / l; out[4] = vary[3] / l; out[5] = Math.abs(vary[4]) / l; out[6] = 0; out[7] = vary[8];
        return true;
      };
    }
    raster.tri(sx(a.p), sy(a.p), -a.p[2], sx(b.p), sy(b.p), -b.p[2], sx(c.p), sy(c.p), -c.p[2], v0, v1, v2, K, shade);
  }
  return raster.resolve();
}

// A baked tile into the two atlases
function place(tile, row, col, color, normal) {
  const { coverage, out, layers } = tile;
  const C = 8, n = TILE * TILE;
  // How deep each texel lies under the front of the spray: leaves under leaves sit in their shade
  let zTop = -Infinity, zLow = Infinity;
  for (let i = 0; i < n; i++) if (coverage[i] > 0.5) { zTop = Math.max(zTop, out[i * C + 7]); zLow = Math.min(zLow, out[i * C + 7]); }
  const span = Math.max(0.05, zTop - zLow);
  const solid = dilate(out, coverage, TILE, TILE, C, 10);
  const stats = { cover: 0, mean: [0, 0, 0] };
  const fill = [0, 0, 0];
  let filled = 0;
  for (let i = 0; i < n; i++) if (coverage[i] > 0.5) { fill[0] += out[i * C]; fill[1] += out[i * C + 1]; fill[2] += out[i * C + 2]; filled++; }
  // texels nothing reached take the tile's mean colour, so that far mipmaps never darken the edge of a leaf
  for (let i = 0; i < n; i++) if (!solid[i]) for (let c = 0; c < 3; c++) out[i * C + c] = fill[c] / Math.max(1, filled);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const i = y * TILE + x, o = (row * TILE + y) * ATLAS_W + col * TILE + x;
    const edge = Math.min(x, y, TILE - 1 - x, TILE - 1 - y);
    const a = edge < GUTTER ? 0 : coverage[i];
    const depth = clamp((zTop - out[i * C + 7]) / span);
    const shade = 1 - 0.42 * Math.pow(depth, 0.8);
    const rgb = [out[i * C] * shade, out[i * C + 1] * shade, out[i * C + 2] * shade];
    color[o * 4] = toSRGB(rgb[0]); color[o * 4 + 1] = toSRGB(rgb[1]); color[o * 4 + 2] = toSRGB(rgb[2]);
    color[o * 4 + 3] = Math.round(a * 255);
    normal[o * 3] = Math.round(clamp(out[i * C + 3] * 0.5 + 0.5) * 255);
    normal[o * 3 + 1] = Math.round(clamp(out[i * C + 4] * 0.5 + 0.5) * 255);
    // thin where one leaf stands alone, thick where leaves pile up or wood shows
    const piled = layers[i] / Math.max(0.05, coverage[i]);
    normal[o * 3 + 2] = Math.round(clamp(out[i * C + 6] * clamp(1.35 - 0.4 * piled) * (1 - 0.5 * depth)) * 255);
    if (a > 0) { stats.cover += a; for (let c = 0; c < 3; c++) stats.mean[c] += rgb[c] * a; }
  }
  stats.mean = stats.mean.map((v) => v / Math.max(1e-6, stats.cover));
  stats.cover /= n;
  return stats;
}

// ---------------------------------------------------------------------------------------------------------------------
async function leavesOf(kind) {
  let leaves;
  if (kind.set === 'jacaranda') {
    const base = path.join(RAW, 'jacaranda_tree', 'jacaranda_tree_leaves_');
    leaves = await cutLeaves({ color: `${base}diff_2k.jpg`, opacity: `${base}alpha_2k.jpg`, normal: `${base}nor_gl_2k.jpg`, stem: 'narrow', minShare: 0.02, maxLength: 1024 });
  } else if (kind.set === 'ginkgo') {
    const source = await cutSet(RAW, 'LeafSet009');
    leaves = source.slice(0, 6).map((leaf, i) => fanLeaf(leaf, i + 1));
  } else leaves = await cutSet(RAW, kind.set);
  if (!leaves.length) throw new Error(`no leaves cut from ${kind.set}`);
  return gradeLeaves(leaves, kind.color, { contrast: 0.85 });
}

const color = Buffer.alloc(ATLAS_W * ATLAS_H * 4);
const normal = Buffer.alloc(ATLAS_W * ATLAS_H * 3, 128);
const report = {};
for (const [row, kind] of LEAF_KINDS.entries()) {
  if (ONLY && kind.id !== ONLY) continue;
  const t0 = Date.now();
  const leaves = await leavesOf(kind);
  const tiles = [
    spray(kind, leaves, 101 + row * 13, TILE_SIZE[0] * 0.88),
    spray(kind, leaves, 211 + row * 17, TILE_SIZE[1] * 0.88),
    spray(kind, leaves, 307 + row * 19, TILE_SIZE[2] * 0.86, 3),
    mass(kind, leaves, 401 + row * 23, TILE_SIZE[3] * 0.9)
  ];
  report[kind.id] = tiles.map((model, col) => {
    const { size, foot } = frame(model);
    const stats = place(bake(model, size, foot), row, col, color, normal);
    return { size: +size.toFixed(3), foot: +foot.toFixed(4), cover: +stats.cover.toFixed(3), mean: stats.mean.map((v) => +v.toFixed(4)) };
  });
  console.log(kind.id.padEnd(8), `${leaves.length} leaves`, report[kind.id].map((s) => `${s.size} m ${Math.round(s.cover * 100)}%`).join(' | '), `${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

fs.mkdirSync(OUT, { recursive: true });
if (!ONLY) {
  await writeWebp(path.join(OUT, 'foliage_c.webp'), color, ATLAS_W, ATLAS_H, 4, { quality: 90, alphaQuality: 96 });
  await writeWebp(path.join(OUT, 'foliage_n.webp'), normal, ATLAS_W, ATLAS_H, 3, { quality: 90 });
  // what the tree builder needs to know about the tiles: how much of each is leaf, and its mean colour (linear)
  fs.writeFileSync(new URL('./lib/foliage-stats.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
}
if (PREVIEW) {
  fs.mkdirSync(PREVIEW, { recursive: true });
  const flat = Buffer.alloc(ATLAS_W * ATLAS_H * 3);
  for (let i = 0; i < ATLAS_W * ATLAS_H; i++) {
    const a = color[i * 4 + 3] / 255;
    flat[i * 3] = color[i * 4] * a + 70 * (1 - a); flat[i * 3 + 1] = color[i * 4 + 1] * a + 84 * (1 - a); flat[i * 3 + 2] = color[i * 4 + 2] * a + 110 * (1 - a);
  }
  await writePng(path.join(PREVIEW, 'foliage-color.png'), flat, ATLAS_W, ATLAS_H, 3);
  await writePng(path.join(PREVIEW, 'foliage-normal.png'), normal, ATLAS_W, ATLAS_H, 3);
}
