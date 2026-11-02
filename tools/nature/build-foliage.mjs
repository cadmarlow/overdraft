// The foliage atlas: real scanned leaves (ambientCG, CC0) set along twigs, into leaf sprays the tree cards show.
// 4 x 4 tiles: one row per species, three sprays then the dense mass of the far canopy.
// Usage: node build-foliage.mjs <folder with LeafSetXXX directories> [--out dir]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const RAW = args[0];
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : new URL('../../assets/nature/', import.meta.url).pathname;
const TILE = 1024;
const GRID = 4;
const ATLAS = TILE * GRID;
const GUTTER = 12;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function gray(file) {
  const { data, info } = await sharp(file).removeAlpha().toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}
async function rgb(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

// Every leaf of a sheet, cut out of its opacity map: stem at the bottom of its box, as they were laid out to be scanned
async function cutLeaves(id) {
  const base = path.join(RAW, id, `${id}_2K-JPG_`);
  const [color, opacity, normal] = await Promise.all([rgb(`${base}Color.jpg`), gray(`${base}Opacity.jpg`), rgb(`${base}NormalGL.jpg`)]);
  const { width: W, height: H } = opacity;
  const stride = opacity.channels;
  const seen = new Uint8Array(W * H);
  const leaves = [];
  for (let start = 0; start < W * H; start += 7) {
    if (seen[start] || opacity.data[start * stride] < 128) continue;
    const stack = [start];
    seen[start] = 1;
    let area = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, y = (i / W) | 0;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        if (j >= 0 && j < W * H && !seen[j] && opacity.data[j * stride] >= 128) { seen[j] = 1; stack.push(j); }
      }
    }
    if (area < W * H * 0.006) continue;
    leaves.push({ color, opacity, normal, stride, W, H, x0, y0, x1, y1, h: y1 - y0 + 1 });
  }
  return leaves;
}

function createTile() {
  return {
    color: new Float32Array(TILE * TILE * 3),
    alpha: new Float32Array(TILE * TILE),
    normal: new Float32Array(TILE * TILE * 2)
  };
}

const sample = (img, stride, x, y, c) => {
  const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy, W = img.width, d = img.data;
  const at = (a, b) => d[(b * W + a) * stride + c];
  return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
};

// One leaf on the tile: its stem at (px, py), `size` pixels long, turned by `angle` (0 = pointing up the tile)
function stamp(tile, leaf, px, py, size, angle, tint, shade = 0.72) {
  const k = leaf.h / size; // source pixels per tile pixel
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const cx = (leaf.x0 + leaf.x1) / 2, by = leaf.y1;
  const half = (Math.max(leaf.x1 - leaf.x0, leaf.h) / k) * 1.1;
  const x0 = Math.max(1, (px - half) | 0), x1 = Math.min(TILE - 2, (px + half) | 0);
  const y0 = Math.max(1, (py - half) | 0), y1 = Math.min(TILE - 2, (py + half) | 0);
  const op = leaf.opacity, S = leaf.stride;
  // what lies under it falls into its shadow, a little down and to the right
  const dropX = size * 0.05, dropY = size * 0.07;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x - dropX - px, dy = y - dropY - py;
    const u = (dx * cs + dy * sn) * k + cx, v = (-dx * sn + dy * cs) * k + by;
    if (u < leaf.x0 || u >= leaf.x1 || v < leaf.y0 || v >= leaf.y1) continue;
    const a = sample(op, S, u, v, 0) / 255;
    if (a <= 0.02) continue;
    const i = y * TILE + x;
    const m = 1 - (1 - shade) * a;
    tile.color[i * 3] *= m; tile.color[i * 3 + 1] *= m; tile.color[i * 3 + 2] *= m;
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x - px, dy = y - py;
    const u = (dx * cs + dy * sn) * k + cx, v = (-dx * sn + dy * cs) * k + by;
    if (u < leaf.x0 || u >= leaf.x1 || v < leaf.y0 || v >= leaf.y1) continue;
    const a = sample(op, S, u, v, 0) / 255;
    if (a <= 0.02) continue;
    const i = y * TILE + x;
    const l = 1 - a;
    for (let c = 0; c < 3; c++) tile.color[i * 3 + c] = tile.color[i * 3 + c] * l + (sample(leaf.color, 3, u, v, c) / 255) * tint[c] * a;
    tile.alpha[i] = Math.max(tile.alpha[i], a);
    // the leaf's normal turns with it
    const nx = sample(leaf.normal, 3, u, v, 0) / 127.5 - 1, ny = 1 - sample(leaf.normal, 3, u, v, 1) / 127.5;
    const rx = nx * cs - ny * sn, ry = nx * sn + ny * cs;
    tile.normal[i * 2] = tile.normal[i * 2] * l + rx * a;
    tile.normal[i * 2 + 1] = tile.normal[i * 2 + 1] * l + ry * a;
  }
}

// A stem as a chain of soft dabs, in pixels
function stroke(tile, pts, width, tone) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay, ar] = pts[i], [bx, by, br] = pts[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, r = ((ar ?? 1) + ((br ?? 1) - (ar ?? 1)) * t) * width;
      for (let py = Math.floor(y - r - 1); py <= y + r + 1; py++) for (let px = Math.floor(x - r - 1); px <= x + r + 1; px++) {
        if (px < 1 || py < 1 || px >= TILE - 1 || py >= TILE - 1) continue;
        const d = Math.hypot(px - x, py - y);
        const a = Math.min(1, Math.max(0, r + 0.5 - d));
        if (a <= 0) continue;
        const i2 = py * TILE + px;
        const lit = 0.85 + 0.3 * ((px - x) / (r + 1)); // lit from one side, round
        for (let c = 0; c < 3; c++) tile.color[i2 * 3 + c] = tile.color[i2 * 3 + c] * (1 - a) + tone[c] * lit * a;
        tile.alpha[i2] = Math.max(tile.alpha[i2], a);
      }
    }
  }
}

// A curving stem in tile pixels, from (x, y) heading `angle`
function stemPath(x, y, angle, length, bend, r, steps = 14) {
  const pts = [[x, y, 1]];
  let a = angle;
  for (let i = 1; i <= steps; i++) {
    a += bend / steps + (r() - 0.5) * 0.09;
    x += Math.sin(a) * (length / steps);
    y -= Math.cos(a) * (length / steps);
    pts.push([x, y, 1 - (0.75 * i) / steps, a]);
  }
  return pts;
}

const tintOf = (r, depth, base) => {
  const v = (0.74 + r() * 0.34) * depth;
  const warm = r() * 0.12 - 0.04;
  return [base[0] * v * (1 + warm), base[1] * v, base[2] * v * (1 - warm)];
};

// A twig with its leaves, set alternately along it
function twig(tile, sp, leaves, r, x, y, angle, length, bend, pxPerM, depth = 1, stemWidth = 5) {
  const pts = stemPath(x, y, angle, length, bend, r);
  stroke(tile, pts, stemWidth, sp.stem);
  const n = Math.max(3, Math.round(length / pxPerM / sp.spacing));
  for (let i = 0; i < n; i++) {
    const t = 0.1 + (0.9 * (i + 0.5)) / n;
    const p = pts[Math.min(pts.length - 1, Math.floor(t * (pts.length - 1)))];
    const side = i % 2 ? 1 : -1;
    const leaf = leaves[Math.floor(r() * leaves.length)];
    const size = sp.leaf * pxPerM * (0.72 + r() * 0.5) * (1.05 - 0.3 * t);
    const off = (0.45 + r() * 0.6) * side;
    stamp(tile, leaf, p[0], p[1], size, (p[3] ?? angle) + off, tintOf(r, depth, sp.tint));
  }
  const end = pts[pts.length - 1];
  stamp(tile, leaves[Math.floor(r() * leaves.length)], end[0], end[1], sp.leaf * pxPerM * 0.9, end[3] ?? angle, tintOf(r, depth, sp.tint));
}

// A compound leaf: pairs of leaflets along a thin rachis, as on a honey locust
function frond(tile, sp, leaves, r, x, y, angle, length, bend, pxPerM, depth) {
  const pts = stemPath(x, y, angle, length, bend, r, 12);
  stroke(tile, pts, 2.2, sp.stem);
  const n = Math.round(length / pxPerM / sp.spacing);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.7) / n;
    const p = pts[Math.min(pts.length - 1, Math.floor(t * (pts.length - 1)))];
    for (const side of [-1, 1]) {
      const leaf = leaves[Math.floor(r() * leaves.length)];
      stamp(tile, leaf, p[0], p[1], sp.leaf * pxPerM * (0.8 + r() * 0.35) * (1.1 - 0.35 * t), (p[3] ?? angle) + side * (1.0 + r() * 0.3), tintOf(r, depth, sp.tint), 0.82);
    }
  }
}

function spray(tile, sp, leaves, seed) {
  const r = rng(seed);
  const pxPerM = TILE / sp.card;
  const cx = TILE / 2;
  if (sp.frond) {
    // fronds off a twig, darkest behind
    const stem = stemPath(cx + (r() - 0.5) * 60, TILE - 30, (r() - 0.5) * 0.3, TILE * 0.7, (r() - 0.5) * 0.5, r);
    stroke(tile, stem, 4.5, sp.stem);
    for (let i = 0; i < 16; i++) {
      const p = stem[1 + Math.floor(r() * (stem.length - 1))];
      const a = (p[3] ?? 0) + (i % 2 ? 1 : -1) * (0.4 + r() * 0.75);
      frond(tile, sp, leaves, r, p[0], p[1], a, sp.frond * pxPerM * (0.65 + r() * 0.5), (r() - 0.5) * 0.7, pxPerM, 0.72 + (i / 16) * 0.36);
    }
    return;
  }
  // a main twig with side twigs, the ones behind drawn first and darker
  const main = stemPath(cx + (r() - 0.5) * 70, TILE - 26, (r() - 0.5) * 0.35, TILE * 0.72, (r() - 0.5) * 0.6, r);
  const sides = [];
  for (let i = 0; i < 9; i++) {
    const p = main[2 + Math.floor((i / 9) * (main.length - 3))];
    const dir = (i % 2 ? 1 : -1) * (0.55 + r() * 0.5);
    sides.push([p[0], p[1], (p[3] ?? 0) + dir, TILE * (0.28 + r() * 0.22), dir * 0.35]);
  }
  sides.sort(() => r() - 0.5);
  sides.forEach(([x, y, a, l, b], i) => twig(tile, sp, leaves, r, x, y, a, l, b, pxPerM, 0.74 + (i / sides.length) * 0.3, 3.5));
  stroke(tile, main, 6.5, sp.stem);
  twig(tile, sp, leaves, r, main[6][0], main[6][1], main[6][3] ?? 0, TILE * 0.5, (r() - 0.5) * 0.5, pxPerM, 1.04, 4);
}

// Leaves all over the tile: the filling of a crown, no stems in sight
function clump(tile, sp, leaves, seed, count, scale, lit = false) {
  const r = rng(seed);
  const pxPerM = TILE / sp.card;
  const R = TILE * 0.46;
  for (let i = 0; i < count; i++) {
    const t = i / count; // back to front
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R * (0.5 + 0.5 * (1 - t * 0.2));
    const x = TILE / 2 + Math.cos(a) * d, y = TILE / 2 + Math.sin(a) * d;
    const leaf = leaves[Math.floor(r() * leaves.length)];
    // seen from afar a crown is a volume: lit from above, dark below
    const light = lit ? 0.5 + 0.62 * (1 - y / TILE) + 0.1 * (x / TILE) : 1;
    stamp(tile, leaf, x, y, sp.leaf * pxPerM * scale * (0.75 + r() * 0.5), r() * Math.PI * 2, tintOf(r, (0.66 + 0.42 * t) * light, sp.tint), 0.8);
  }
}

const SPECIES = [
  // London plane: big lobed leaves. Sizes in metres
  { set: 'LeafSet010', card: 1.7, leaf: 0.2, spacing: 0.11, tint: [0.62, 0.76, 0.5], stem: [0.2, 0.15, 0.09] },
  // Honey locust: tiny leaflets in feathery fronds
  { set: 'LeafSet013', card: 1.5, leaf: 0.062, spacing: 0.03, frond: 0.4, tint: [0.9, 0.98, 0.56], stem: [0.23, 0.2, 0.12] },
  // American elm: small toothed leaves close together
  { set: 'LeafSet014', card: 1.5, leaf: 0.115, spacing: 0.065, tint: [0.62, 0.8, 0.5], stem: [0.17, 0.13, 0.09] },
  // Oak: lobed leaves in tufts
  { set: 'LeafSet016', card: 1.6, leaf: 0.15, spacing: 0.08, tint: [0.62, 0.76, 0.46], stem: [0.19, 0.15, 0.1] }
];

const atlasColor = Buffer.alloc(ATLAS * ATLAS * 4);
const atlasNormal = Buffer.alloc((ATLAS / 2) * (ATLAS / 2) * 3);
function place(tile, col, row) {
  // clear pixels keep the colour of their neighbours, or mipmaps pull leaf edges towards black
  const solid = new Uint8Array(TILE * TILE);
  for (let i = 0; i < solid.length; i++) solid[i] = tile.alpha[i] > 0.02 ? 1 : 0;
  // normalise colours under partial coverage first
  for (let pass = 0; pass < 10; pass++) {
    const next = solid.slice();
    for (let y = 1; y < TILE - 1; y++) for (let x = 1; x < TILE - 1; x++) {
      const i = y * TILE + x;
      if (solid[i]) continue;
      for (const j of [i - 1, i + 1, i - TILE, i + TILE]) if (solid[j]) {
        tile.color[i * 3] = tile.color[j * 3]; tile.color[i * 3 + 1] = tile.color[j * 3 + 1]; tile.color[i * 3 + 2] = tile.color[j * 3 + 2];
        next[i] = 1;
        break;
      }
    }
    solid.set(next);
  }
  let sum = [0, 0, 0], n = 0;
  for (let i = 0; i < solid.length; i++) if (tile.alpha[i] > 0.5) { sum[0] += tile.color[i * 3]; sum[1] += tile.color[i * 3 + 1]; sum[2] += tile.color[i * 3 + 2]; n++; }
  const mean = sum.map((v) => v / Math.max(1, n));
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const i = y * TILE + x, o = ((row * TILE + y) * ATLAS + col * TILE + x) * 4;
    // nothing reaches the edges of a tile, so mipmaps of one never bleed into the next
    const edge = Math.min(x, y, TILE - 1 - x, TILE - 1 - y);
    const a = edge < GUTTER ? 0 : tile.alpha[i];
    for (let c = 0; c < 3; c++) atlasColor[o + c] = Math.min(255, Math.round((solid[i] ? tile.color[i * 3 + c] : mean[c]) * 255));
    atlasColor[o + 3] = Math.round(a * 255);
  }
  for (let y = 0; y < TILE / 2; y++) for (let x = 0; x < TILE / 2; x++) {
    const i = y * 2 * TILE + x * 2, o = ((row * (TILE / 2) + y) * (ATLAS / 2) + col * (TILE / 2) + x) * 3;
    const nx = tile.normal[i * 2], ny = tile.normal[i * 2 + 1];
    atlasNormal[o] = Math.round((nx * 0.5 + 0.5) * 255);
    atlasNormal[o + 1] = Math.round((0.5 - ny * 0.5) * 255);
    atlasNormal[o + 2] = 255;
  }
}

for (const [row, sp] of SPECIES.entries()) {
  const leaves = await cutLeaves(sp.set);
  console.log(sp.set, leaves.length, 'leaves');
  for (let k = 0; k < 2; k++) {
    const tile = createTile();
    spray(tile, sp, leaves, 1000 * row + k + 11);
    place(tile, k, row);
  }
  const filling = createTile();
  clump(filling, sp, leaves, 7000 + row, sp.frond ? 1700 : 300, sp.frond ? 1.25 : 1);
  place(filling, 2, row);
  const far = createTile();
  clump(far, sp, leaves, 9000 + row, sp.frond ? 5200 : 1700, sp.frond ? 0.8 : 0.42, true);
  place(far, 3, row);
}

fs.mkdirSync(OUT, { recursive: true });
await sharp(atlasColor, { raw: { width: ATLAS, height: ATLAS, channels: 4 } }).webp({ quality: 86, alphaQuality: 92, effort: 5, exact: true }).toFile(path.join(OUT, 'leaves_c.webp'));
await sharp(atlasNormal, { raw: { width: ATLAS / 2, height: ATLAS / 2, channels: 3 } }).webp({ quality: 88, effort: 5 }).toFile(path.join(OUT, 'leaves_n.webp'));
// a look at it, for whoever builds it
await sharp(atlasColor, { raw: { width: ATLAS, height: ATLAS, channels: 4 } }).resize(1400).flatten({ background: '#8a97a8' }).jpeg({ quality: 80 }).toFile(path.join(process.env.PREVIEW ?? OUT, 'leaves-preview.jpg')).catch(() => {});
console.log('atlas', ATLAS, SPECIES.map((s) => s.card).join(' '));
