import * as THREE from 'three/webgpu';
import { BRANDS } from './eatery-brands.js';
import { brandEmblem, brandWordmark, brandLockup } from './eatery-logos.js';

// The food of the two franchises and what it is served in: BULLION's burgers, fries and cups, TRANCHE's pies, slices
// and boxes. Everything is made here, nothing is downloaded: the shapes are built from rings, sheets and boxes, and one
// atlas is painted on a canvas (colour, plus roughness/metalness and a normal map drawn from a painted relief).
//
//   await loadFoodKit()      paints the atlas and builds every geometry, once
//   FOOD.material            the one material every item is drawn with (opaque, front faces only)
//   FOOD.geometry[name]      indexed BufferGeometry: position, normal, uv. Metres, origin at the centre of the base,
//                            resting on y = 0, front towards +z. Meant for one InstancedMesh per kind of item
//   FOOD.info[name]          { w, h, d, grip: [x, y, z], triangles, budget, brand }: its box and where a hand takes it
//   FOOD.maps                { color, orm, normal }: orm is roughness in green and metalness in blue
//   buildFoodMeshes()        the same shapes as plain typed arrays, without a canvas or a renderer (tests)
//
// The textures are not flipped (v runs down the canvas) and the normal map's green follows three.js, which derives the
// bitangent down the image.

const ATLAS = 2048;   // the colour atlas, in pixels
const DETAIL = 1024;  // roughness/metalness and normals
const GUTTER = 6;     // painted margin round every tile, so the mipmaps do not bleed
const TAU = Math.PI * 2;
const B = BRANDS.bullion.colors, T = BRANDS.tranche.colors;

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The atlas' tiles: name, width, height in colour pixels. Packed once, the same way everywhere (no canvas needed)
// ---------------------------------------------------------------------------------------------------------------
const TILE_LIST = [
  ['pieMargherita', 640, 640], ['piePepperoni', 640, 640], ['pieBianca', 640, 640], ['pieRaw', 448, 448],
  ['boxTop', 448, 448], ['boxInside', 224, 224], ['boxSide', 320, 40],
  ['aluTray', 320, 320], ['plate', 288, 288], ['crustUnder', 256, 256], ['sliceCut', 256, 32],
  ['dough', 256, 256], ['wood', 384, 192], ['can', 320, 192], ['canTop', 80, 80],
  ['shakerOregano', 80, 160], ['shakerChili', 80, 160], ['shakerCheese', 80, 160], ['shakerTop', 96, 96],
  ['cutter', 128, 128], ['plateEdge', 128, 40], ['ricotta', 64, 64], ['basil', 40, 64],
  ['liner', 512, 372], ['trayPlastic', 128, 128], ['bunTop', 256, 256], ['bunSide', 256, 48], ['bunCut', 128, 128],
  ['pattySide', 256, 40], ['pattySideRaw', 256, 40], ['pattyTop', 160, 160], ['pattyTopRaw', 160, 160],
  ['cheese', 96, 96], ['lettuce', 256, 48], ['tomato', 128, 24], ['bacon', 128, 40], ['onions', 128, 48],
  ['burgerCut', 256, 192], ['foilOpen', 256, 256], ['foilWrap', 256, 256],
  ['fry', 96, 128], ['friesPile', 128, 128], ['cartonFront', 128, 128], ['cartonBack', 128, 128], ['cartonIn', 64, 64],
  ['cupWrap', 384, 192], ['cupLid', 192, 192], ['straw', 24, 128], ['paper', 64, 64],
  ['bagFront', 256, 320], ['kraft', 128, 256], ['bagHandle', 96, 24], ['bagInside', 64, 64],
  ['sauceRed', 64, 160], ['sauceYellow', 64, 160], ['steel', 160, 128], ['napkinFace', 160, 112], ['napkin', 64, 64], ['wire', 128, 128]
];

function packTiles(list) {
  const free = [{ x: 0, y: 0, w: ATLAS, h: ATLAS }], out = {};
  const sorted = [...list].sort((a, b) => b[2] - a[2] || b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (const [name, w, h] of sorted) {
    const W = w + 2 * GUTTER, H = h + 2 * GUTTER;
    let best = -1, score = Infinity;
    for (let i = 0; i < free.length; i++) {
      const f = free[i];
      if (f.w < W || f.h < H) continue;
      const s = Math.min(f.w - W, f.h - H);
      if (s < score) { score = s; best = i; }
    }
    if (best < 0) throw new Error(`food atlas: no room left for ${name}`);
    const f = free.splice(best, 1)[0];
    out[name] = { x: f.x + GUTTER, y: f.y + GUTTER, w, h };
    if (f.w - W > f.h - H) free.push({ x: f.x + W, y: f.y, w: f.w - W, h: f.h }, { x: f.x, y: f.y + H, w: W, h: f.h - H });
    else free.push({ x: f.x, y: f.y + H, w: f.w, h: f.h - H }, { x: f.x + W, y: f.y, w: f.w - W, h: H });
  }
  return out;
}
const TILES = packTiles(TILE_LIST);
// A part of a tile, in its own 0..1 coordinates
const part = (tile, s0, t0, s1, t1) => ({ x: tile.x + s0 * tile.w, y: tile.y + t0 * tile.h, w: (s1 - s0) * tile.w, h: (t1 - t0) * tile.h });

// ---------------------------------------------------------------------------------------------------------------
// Geometry kit. Vertices carry a smoothing group: normals are averaged between the faces of one group that meet at
// one place, so a seam in the texture stays smooth and a new group makes a hard edge.
// ---------------------------------------------------------------------------------------------------------------
class Geo {
  constructor() { this.p = []; this.t = []; this.g = []; this.i = []; this.group = 1; }
  get count() { return this.g.length; }
  smooth() { return ++this.group; }
  v(x, y, z, u, w) { this.p.push(x, y, z); this.t.push(u, w); this.g.push(this.group); return this.g.length - 1; }
  tri(a, b, c) { if (a !== b && b !== c && a !== c) this.i.push(a, b, c); }
  // a triangle turned to face the direction (nx, ny, nz)
  toward(a, b, c, nx, ny, nz) {
    const p = this.p, ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2], vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    if ((uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz < 0) this.tri(a, c, b); else this.tri(a, b, c);
  }
  // moves every vertex made since `from`
  move(from, fn) {
    const p = this.p;
    for (let k = from * 3; k < p.length; k += 3) { const q = fn(p[k], p[k + 1], p[k + 2]); p[k] = q[0]; p[k + 1] = q[1]; p[k + 2] = q[2]; }
  }
  // a copy of another shape, moved
  add(other, fn) {
    const base = this.count, shift = this.group;
    for (let k = 0; k < other.count; k++) {
      const q = fn ? fn(other.p[k * 3], other.p[k * 3 + 1], other.p[k * 3 + 2]) : [other.p[k * 3], other.p[k * 3 + 1], other.p[k * 3 + 2]];
      this.p.push(q[0], q[1], q[2]); this.t.push(other.t[k * 2], other.t[k * 2 + 1]); this.g.push(other.g[k] + shift);
    }
    for (const k of other.i) this.i.push(k + base);
    this.group += other.group + 1;
  }
  finish() {
    const { p, t, g } = this, n = this.count, sum = new Map(), keys = new Array(n), keep = [];
    const key = (k) => keys[k] || (keys[k] = `${g[k]}|${Math.round(p[k * 3] * 2e4)}|${Math.round(p[k * 3 + 1] * 2e4)}|${Math.round(p[k * 3 + 2] * 2e4)}`);
    for (let f = 0; f < this.i.length; f += 3) {
      const ia = this.i[f], ib = this.i[f + 1], ic = this.i[f + 2], a = ia * 3, b = ib * 3, c = ic * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * nx + ny * ny + nz * nz < 4e-20) continue; // no area: a pole, or two rings that met
      keep.push(ia, ib, ic);
      for (const k of [ia, ib, ic]) {
        const s = sum.get(key(k));
        if (s) { s[0] += nx; s[1] += ny; s[2] += nz; } else sum.set(key(k), [nx, ny, nz]);
      }
    }
    const remap = new Int32Array(n).fill(-1);
    let m = 0;
    for (const k of keep) if (remap[k] < 0) remap[k] = m++;
    const position = new Float32Array(m * 3), normal = new Float32Array(m * 3), uv = new Float32Array(m * 2), index = new Uint16Array(keep.length);
    for (let k = 0; k < n; k++) {
      const j = remap[k];
      if (j < 0) continue;
      const s = sum.get(key(k)), l = Math.hypot(s[0], s[1], s[2]) || 1;
      position[j * 3] = p[k * 3]; position[j * 3 + 1] = p[k * 3 + 1]; position[j * 3 + 2] = p[k * 3 + 2];
      normal[j * 3] = s[0] / l; normal[j * 3 + 1] = s[1] / l; normal[j * 3 + 2] = s[2] / l;
      uv[j * 2] = t[k * 2]; uv[j * 2 + 1] = t[k * 2 + 1];
    }
    for (let f = 0; f < keep.length; f++) index[f] = remap[keep[f]];
    return { position, normal, uv, index };
  }
}

const put = (g, tile, x, y, z, s, t) => g.v(x, y, z, (tile.x + s * tile.w) / ATLAS, (tile.y + t * tile.h) / ATLAS);

// A flat face seen from its front: top left, top right, bottom right, bottom left
function face(g, tile, tl, tr, br, bl) {
  g.smooth();
  const a = put(g, tile, tl[0], tl[1], tl[2], 0, 0), b = put(g, tile, tr[0], tr[1], tr[2], 1, 0);
  const c = put(g, tile, br[0], br[1], br[2], 1, 1), d = put(g, tile, bl[0], bl[1], bl[2], 0, 1);
  g.tri(a, d, c); g.tri(a, c, b);
}

// A box; `tiles` is one tile or { front, back, left, right, top, bottom, all }; `skip` names the faces left out,
// `turned` those whose tile is laid a quarter turn round
function box(g, x0, y0, z0, x1, y1, z1, tiles, skip = '', turned = '') {
  const side = (name, tl, tr, br, bl) => {
    if (skip.includes(name)) return;
    const tile = tiles.w !== undefined ? tiles : tiles[name] || tiles.all;
    if (turned.includes(name)) face(g, tile, bl, tl, tr, br); else face(g, tile, tl, tr, br, bl); // turned: the tile's width runs up the face
  };
  side('front', [x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]);
  side('back', [x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]);
  side('right', [x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]);
  side('left', [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]);
  side('top', [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]);
  side('bottom', [x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]);
}

// A sheet of nu by nv cells. fn(s, t) gives [x, y, z] (and, if wanted, its own s and t in the tile) for s across and
// t down as seen from the front. `back`: a tile for the other side
function patch(g, tile, nu, nv, fn, back = null) {
  const pts = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const s = i / nu, t = j / nv, q = fn(s, t); pts.push([q[0], q[1], q[2], q[3] ?? s, q[4] ?? t]); }
  const lay = (use, flip) => {
    g.smooth();
    const first = g.count, at = (i, j) => first + j * (nu + 1) + i;
    for (const q of pts) put(g, use, q[0], q[1], q[2], q[3], q[4]);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      if (flip) { g.tri(at(i, j), at(i + 1, j + 1), at(i, j + 1)); g.tri(at(i, j), at(i + 1, j), at(i + 1, j + 1)); }
      else { g.tri(at(i, j), at(i, j + 1), at(i + 1, j + 1)); g.tri(at(i, j), at(i + 1, j + 1), at(i + 1, j)); }
    }
  };
  lay(tile, false);
  if (back) lay(back, true);
}

// Rings of points [x, y, z, s, t, cut] joined into a skin. Walked from the first ring to the last, with the points
// of a ring turning from +z towards +x, the skin faces outwards: a wall built from the bottom up, a top built from
// the rim to the centre. Triangles whose three corners are `cut` (eaten) are left out.
function loft(g, tile, rings, flip = false) {
  g.smooth();
  const ids = rings.map((ring) => ring.map((q) => put(g, tile, q[0], q[1], q[2], q[3], q[4])));
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < rings[i].length - 1; j++) {
    const a = ids[i][j], b = ids[i][j + 1], c = ids[i + 1][j + 1], d = ids[i + 1][j];
    const ca = rings[i][j][5], cb = rings[i][j + 1][5], cc = rings[i + 1][j + 1][5], cd = rings[i + 1][j][5];
    if (!(ca && cb && cc)) { if (flip) g.tri(a, c, b); else g.tri(a, b, c); }
    if (!(ca && cc && cd)) { if (flip) g.tri(a, d, c); else g.tri(a, c, d); }
  }
}

// n + 1 angles round the axis (0 is the front, +z; a quarter turn is +x); the seam of a whole turn is at the back
const turn = (n, a0 = -Math.PI, a1 = Math.PI) => Array.from({ length: n + 1 }, (_, j) => a0 + (a1 - a0) * j / n);

// The height of a profile at a radius: on its upper branch (the rows after its widest one) or its lower one
function profileY(rows, crest, upper, rad) {
  if (upper) {
    for (let i = crest; i < rows.length - 1; i++) { const a = rows[i], b = rows[i + 1]; if (a.r !== b.r && (a.r - rad) * (b.r - rad) <= 0) return a.y + (b.y - a.y) * (a.r - rad) / (a.r - b.r); }
    return rows[rows.length - 1].y;
  }
  for (let i = crest; i > 0; i--) { const a = rows[i], b = rows[i - 1]; if (a.r !== b.r && (a.r - rad) * (b.r - rad) <= 0) return a.y + (b.y - a.y) * (a.r - rad) / (a.r - b.r); }
  return rows[0].y;
}
// How far along the profile (from its first row) that radius is reached, on the same branch
function profileLength(rows, len, crest, upper, rad) {
  if (upper) {
    for (let i = crest; i < rows.length - 1; i++) { const a = rows[i], b = rows[i + 1]; if (a.r !== b.r && (a.r - rad) * (b.r - rad) <= 0) return len[i] + (len[i + 1] - len[i]) * (a.r - rad) / (a.r - b.r); }
    return len[len.length - 1];
  }
  for (let i = crest; i > 0; i--) { const a = rows[i], b = rows[i - 1]; if (a.r !== b.r && (a.r - rad) * (b.r - rad) <= 0) return len[i] + (len[i - 1] - len[i]) * (a.r - rad) / (a.r - b.r); }
  return len[0];
}
const crestOf = (rows) => { let c = 0; for (let i = 1; i < rows.length; i++) if (rows[i].r > rows[c].r + 1e-9) c = i; return c; };

/**
 * A profile of rows { r, y } swept round the y axis through the angles `cols`.
 *   mode 'wrap'  : the tile is rolled round the axis, its middle at the front, its top at the last row (row.v overrides)
 *   mode 'polar' : the tile is laid flat seen from above, the profile unrolled from the axis outwards (row.q overrides,
 *                  0 at the centre of the tile and 1 at its edge); `planar` projects it straight down instead
 *   wobble(a, i, row) scales a radius, lift(a, i, row) raises a point
 *   bite(x) is a bite into the side: what lies in front of the line z = bite(x) is gone, and the points that were
 *   there are brought back onto that line; floor(a) is a bite into the point of a slice: the smallest radius left
 */
function polar(g, tile, rows, cols, o = {}) {
  const { mode = 'wrap', flip = false, wobble = null, lift = null, bite = null, floor = null, cx = 0, cz = 0, rot = 0, u0 = 0, u1 = 1, v0 = 0, v1 = 1, planar = false, qScale = 1 } = o;
  const len = [0];
  for (let i = 1; i < rows.length; i++) len.push(len[i - 1] + Math.hypot(rows[i].r - rows[i - 1].r, rows[i].y - rows[i - 1].y));
  const total = len[len.length - 1] || 1, crest = crestOf(rows), widest = rows[crest].r || 1;
  const inward = rows[rows.length - 1].r < rows[0].r;
  const rings = rows.map((row, i) => cols.map((a, j) => {
    let r = row.r * (wobble ? wobble(a, i, row) : 1), y = row.y + (lift ? lift(a, i, row) : 0), cut = false;
    let floored = false, bitten = false, x = cx + r * Math.sin(a), z = cz + r * Math.cos(a);
    if (floor) { const least = floor(a); if (r < least) { r = least; cut = floored = true; x = cx + r * Math.sin(a); z = cz + r * Math.cos(a); } }
    if (bite && z > bite(x)) {
      z = bite(x); r = Math.min(Math.hypot(x - cx, z - cz), widest); a = Math.atan2(x - cx, z - cz);
      y = profileY(rows, crest, i > crest, r); cut = bitten = true;
    }
    let s, t;
    if (mode === 'wrap') { s = u0 + (u1 - u0) * j / (cols.length - 1); t = row.v ?? v1 + (v0 - v1) * len[i] / total; }
    else {
      // (a floored point lies on the flat near the axis, where the unrolled profile is the radius itself)
      let q;
      if (floored) q = planar ? r / widest : r / total;
      else if (bitten) q = planar ? r / widest : (inward ? total - profileLength(rows, len, crest, i > crest, r) : profileLength(rows, len, crest, i > crest, r)) / total;
      else q = (row.q ?? (planar ? row.r / widest : (inward ? total - len[i] : len[i]) / total)) * (row.r > 0 ? r / row.r : 0);
      s = 0.5 + 0.5 * q * qScale * Math.sin(a + rot); t = 0.5 + 0.5 * q * qScale * Math.cos(a + rot);
    }
    return [x, y, z, s, t, cut];
  }));
  loft(g, tile, rings, flip);
}

// A flat fan over a closed outline of [x, z] turning from +z towards +x (it faces up; `down` turns it over).
// The tile is laid over the box [-hw, hw] x [-hd, hd]
function fan(g, tile, pts, y, hw, hd, down = false) {
  g.smooth();
  const c = put(g, tile, 0, y, 0, 0.5, 0.5);
  const ids = pts.map(([x, z]) => put(g, tile, x, y, z, 0.5 + 0.5 * x / hw, 0.5 + 0.5 * z / hd));
  for (let j = 0; j < pts.length - 1; j++) { if (down) g.tri(c, ids[j + 1], ids[j]); else g.tri(c, ids[j], ids[j + 1]); }
}

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// A tube along a path. The tile's height runs along the path (its top at the path's end), its width round the tube
function tube(g, tile, pts, radius, sides, { cap = false, flat = false } = {}) {
  const rings = [];
  let before = null;
  for (let k = 0; k < pts.length; k++) {
    const d = norm3(sub3(pts[Math.min(pts.length - 1, k + 1)], pts[Math.max(0, k - 1)]));
    let n = before ? sub3(before, d.map((c) => c * (before[0] * d[0] + before[1] * d[1] + before[2] * d[2]))) : cross3(d, Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]);
    n = norm3(n);
    before = n;
    const bn = cross3(d, n), rad = typeof radius === 'function' ? radius(k / (pts.length - 1)) : radius;
    rings.push(Array.from({ length: sides + 1 }, (_, j) => {
      const a = j / sides * TAU, c = Math.cos(a) * rad, s = Math.sin(a) * rad;
      return [pts[k][0] + n[0] * c + bn[0] * s, pts[k][1] + n[1] * c + bn[1] * s, pts[k][2] + n[2] * c + bn[2] * s, j / sides, 1 - k / (pts.length - 1)];
    }));
  }
  if (flat) {
    for (let j = 0; j < sides; j++) loft(g, tile, rings.map((ring) => [ring[j], ring[j + 1]]));
  } else loft(g, tile, rings);
  if (cap) {
    g.smooth();
    const last = rings[rings.length - 1], end = pts[pts.length - 1];
    const c = put(g, tile, end[0], end[1], end[2], 0.5, 0.02);
    const ids = last.map((q) => put(g, tile, q[0], q[1], q[2], q[3], 0.02));
    for (let j = 0; j < sides; j++) g.tri(c, ids[j], ids[j + 1]);
  }
}

// The outline of a rectangle with round corners, as [x, z] turning from +z towards +x, closed (first point repeated)
function roundRect(hw, hd, rad, seg) {
  const pts = [];
  const corners = [[hw - rad, hd - rad, 0], [hw - rad, -(hd - rad), 0.25], [-(hw - rad), -(hd - rad), 0.5], [-(hw - rad), hd - rad, 0.75]];
  for (const [cx, cz, start] of corners) for (let k = 0; k <= seg; k++) { const a = (start + 0.25 * k / seg) * TAU; pts.push([cx + rad * Math.sin(a), cz + rad * Math.cos(a)]); }
  pts.push(pts[0]);
  return pts;
}

// ---------------------------------------------------------------------------------------------------------------
// The items. item(name, brand, budget, grip, build): build(g) fills a Geo; it is then set down on y = 0
// ---------------------------------------------------------------------------------------------------------------
const ITEMS = {};
function item(name, brand, budget, grip, build) { ITEMS[name] = { brand, budget, grip, build }; }
// other names for the same shape
const ALIAS = { sauceBottle: 'sauceRed' };

// ---- BULLION: the tray ----------------------------------------------------------------------------------------
const TRAY = { w: 0.44, d: 0.32, h: 0.02 };
function trayShell(g, { seg = 4, floor = true, under = true, inside = true } = {}) {
  const hw = TRAY.w / 2, hd = TRAY.d / 2, tile = TILES.trayPlastic;
  const ring = (inset, rad, y) => roundRect(hw - inset, hd - inset, rad, seg).map(([x, z]) => [x, y, z, 0.5 + 0.46 * x / hw, 0.5 + 0.46 * z / hw]);
  const rings = [ring(0.013, 0.022, 0), ring(0, 0.032, 0.017), ring(0.0015, 0.031, TRAY.h)];
  if (inside) rings.push(ring(0.0075, 0.026, 0.0185));
  if (floor) rings.push(ring(0.021, 0.016, 0.0035));
  loft(g, tile, rings);
  if (floor) {
    g.smooth();
    const edge = rings[rings.length - 1], c = g.v(0, 0.0035, 0, ...uvAt(tile, 0.5, 0.5));
    const ids = edge.map((q) => put(g, tile, q[0], q[1], q[2], q[3], q[4]));
    for (let j = 0; j < edge.length - 1; j++) g.tri(c, ids[j], ids[j + 1]);
  }
  if (under) {
    g.smooth();
    const edge = rings[0], c = g.v(0, 0, 0, ...uvAt(tile, 0.5, 0.5));
    const ids = edge.map((q) => put(g, tile, q[0], q[1], q[2], q[3], q[4]));
    for (let j = 0; j < edge.length - 1; j++) g.tri(c, ids[j + 1], ids[j]);
  }
}
function uvAt(tile, s, t) { return [(tile.x + s * tile.w) / ATLAS, (tile.y + t * tile.h) / ATLAS]; }

item('tray', 'bullion', 220, [0.205, 0.012, 0], (g) => {
  trayShell(g);
  // the paper liner, a touch askew
  const hw = 0.192, hd = 0.132, y = 0.0042, c = Math.cos(0.02), s = Math.sin(0.02);
  const at = (x, z) => [x * c + z * s + 0.002, y, -x * s + z * c];
  face(g, TILES.liner, at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd));
});

item('trayStack', 'bullion', 600, [0, 0.04, 0.15], (g) => {
  const rnd = seeded(71);
  for (let k = 0; k < 6; k++) {
    const one = new Geo();
    trayShell(one, { seg: 3, floor: k === 5, under: k === 0, inside: k === 5 });
    const a = (rnd() - 0.5) * 0.05, c = Math.cos(a), s = Math.sin(a), dx = (rnd() - 0.5) * 0.006, dz = (rnd() - 0.5) * 0.006, y = k * 0.0105;
    g.add(one, (x, py, z) => [x * c + z * s + dx, py + y, -x * s + z * c + dz]);
  }
});

// ---- BULLION: the burgers ----------------------------------------------------------------------------------------
const BUN_R = 0.054, PATTY_R = 0.0565;
// What is stacked, from the paper up
function burgerStack(kind) {
  const parts = kind === 'triple'
    ? [['bunBottom', 0.017], ['patty', 0.013], ['cheese', 0.002], ['patty', 0.013], ['cheese', 0.002], ['bacon', 0.004], ['patty', 0.013], ['cheese', 0.002], ['onions', 0.008], ['bunTop', 0.04]]
    : [['bunBottom', 0.017], ['patty', 0.0115], ['cheese', 0.002], ['patty', 0.0115], ['cheese', 0.002], ['lettuce', 0.003], ['tomato', 0.0045], ['bunTop', 0.036]];
  let y = 0.0012;
  return parts.map(([type, h], k) => { const layer = { type, y0: y, y1: y + h, k }; y += h; return layer; });
}
const stackHeight = (stack) => stack[stack.length - 1].y1;

const bunBottomRows = (y0, y1, R = BUN_R) => [{ r: R - 0.007, y: y0 }, { r: R, y: y0 + 0.007 }, { r: R - 0.0015, y: y1 - 0.002 }, { r: R - 0.007, y: y1 }];
const bunTopRows = (y0, y1, R = BUN_R) => {
  const h = y1 - y0;
  return [{ r: R - 0.006, y: y0 }, { r: R, y: y0 + h * 0.13 }, { r: R + 0.001, y: y0 + h * 0.3 }, { r: R - 0.005, y: y0 + h * 0.56 }, { r: R - 0.017, y: y0 + h * 0.8 }, { r: R - 0.034, y: y0 + h * 0.95 }, { r: 0, y: y1 }];
};
const pattyRows = (y0, y1, R = PATTY_R) => [{ r: R - 0.005, y: y0 + 0.0008 }, { r: R, y: y0 + 0.004 }, { r: R + 0.0004, y: y1 - 0.0035 }, { r: R - 0.006, y: y1 }];
const pattyWobble = (k) => (a) => 1 + 0.022 * Math.sin(3 * a + k * 1.7) + 0.014 * Math.sin(7 * a + k * 2.9) + 0.008 * Math.sin(13 * a + k);
// A cheese slice's edge seen from the axis: a square with soft corners, turned by `rot`
const cheeseEdge = (a, rot, half = 0.052) => half / Math.pow(Math.pow(Math.abs(Math.cos(a - rot)), 8) + Math.pow(Math.abs(Math.sin(a - rot)), 8), 0.125);

function burgerLayers(g, stack, { cols, colsFine = cols, bite = null, seed = 1 }) {
  const rnd = seeded(seed);
  let under = pattyWobble(0), patties = 0, slices = 0;
  for (const L of stack) {
    if (L.type === 'bunBottom') polar(g, TILES.bunSide, bunBottomRows(L.y0, L.y1), cols, { bite });
    else if (L.type === 'patty') {
      under = pattyWobble(++patties + seed);
      polar(g, TILES.pattySide, pattyRows(L.y0, L.y1), cols, { bite, wobble: under, u0: patties % 2, u1: 1 - patties % 2 });
    } else if (L.type === 'cheese') {
      // draped over the patty under it: lying on its top, bent over its edge, the corners hanging down its side
      const rot = 0.5 + slices++ * 0.9 + rnd() * 0.4, top = L.y1, bend = 0.0032, tile = TILES.cheese;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const point = (a, r, y, reach) => {
        const x = r * Math.sin(a), z = r * Math.cos(a);
        if (bite && z > bite(x)) { const zb = bite(x); return [x, top, zb, 0.5 + 0.5 * (x * cr - zb * sr) / 0.074, 0.5 + 0.5 * (zb * cr + x * sr) / 0.074, true]; }
        return [x, y, z, 0.5 + 0.5 * reach / 0.074 * Math.sin(a - rot), 0.5 + 0.5 * reach / 0.074 * Math.cos(a - rot), false];
      };
      const rings = [[], [], []];
      for (const a of colsFine) {
        const edge = PATTY_R * under(a) - 0.0006, reach = cheeseEdge(a, rot) * (1 + 0.03 * Math.sin(5 * a + rot));
        const drape = (over) => { // over: how far past the patty's edge, along the sheet
          const th = Math.min(over / bend, Math.PI / 2);
          return [edge + bend * Math.sin(th), top - bend * (1 - Math.cos(th)) - Math.max(0, over - bend * Math.PI / 2) * 0.96];
        };
        const over = Math.max(0, reach - edge), inner = Math.min(reach, edge) - 0.008;
        const rows = [[...drape(over), edge + over], [...drape(over * 0.45), edge + over * 0.45], [inner, top, inner]];
        rows.forEach(([r, y, flat], i) => rings[i].push(point(a, r, y, flat)));
      }
      loft(g, tile, rings);
    } else if (L.type === 'tomato') {
      const R = 0.0508;
      polar(g, TILES.tomato, [{ r: R - 0.003, y: L.y0 }, { r: R + 0.0004, y: (L.y0 + L.y1) / 2 }, { r: R - 0.004, y: L.y1 + 0.0004 }], cols, { bite, cx: 0.0035, cz: 0.003 });
    } else if (L.type === 'lettuce') {
      const ph = rnd() * 6, ruffle = (a) => Math.sin(9 * a + ph) * 0.6 + Math.sin(17 * a + ph * 2) * 0.4;
      const rows = [{ r: 0.0625, y: L.y0 - 0.0035, v: 0.04 }, { r: 0.0545, y: L.y0 + 0.0014, v: 0.5 }, { r: 0.043, y: L.y1 + 0.0006, v: 0.96 }];
      polar(g, TILES.lettuce, rows, colsFine, { bite, wobble: (a, i) => (i === 0 ? 1 + 0.06 * Math.sin(5 * a + ph) + 0.035 * ruffle(a) : 1), lift: (a, i) => (i === 0 ? 0.0046 * ruffle(a) : i === 1 ? 0.0014 * ruffle(a + 0.2) : 0) });
    } else if (L.type === 'bacon') {
      const yc = (L.y0 + L.y1) / 2;
      for (const [rot, off, len] of [[-0.5, -0.02, 0.15], [0.12, 0.012, 0.14], [0.85, 0.0, 0.146]]) {
        const c = Math.cos(rot), s = Math.sin(rot), ph = rnd() * 6, from = g.count;
        patch(g, TILES.bacon, 8, 1, (u, v) => {
          const x = (u - 0.5) * len, z = (v - 0.5) * 0.024 + off, out = Math.max(0, Math.abs(x) - PATTY_R + 0.004);
          return [x, yc + 0.0016 * Math.sin(u * 19 + ph) - out * 0.55 + 0.001, z + 0.003 * Math.sin(u * 7 + ph)];
        }, TILES.bacon);
        g.move(from, (x, y, z) => [x * c + z * s, y, -x * s + z * c]);
      }
    } else if (L.type === 'onions') {
      const ph = rnd() * 6, lump = (a, k) => Math.sin(a * 5 + ph + k) * 0.5 + Math.sin(a * 11 + ph * 2 + k * 3) * 0.5;
      const rows = [{ r: 0.0585, y: L.y0 - 0.001, v: 0.98 }, { r: 0.055, y: L.y0 + 0.005, v: 0.6 }, { r: 0.045, y: L.y1 + 0.001, v: 0.3 }, { r: 0.034, y: L.y1, v: 0.04 }];
      polar(g, TILES.onions, rows, cols, { bite, wobble: (a, i) => 1 + (i < 2 ? 0.05 : 0.02) * lump(a, i), lift: (a, i) => (i === 1 || i === 2 ? 0.002 * lump(a, i + 4) : 0) });
    } else if (L.type === 'bunTop') polar(g, TILES.bunTop, bunTopRows(L.y0, L.y1), colsFine, { bite, mode: 'polar', qScale: 0.97 });
  }
}

// The opened wrapper the burger sits on: flat under it, rumpled and rising towards its edges
function burgerPaper(g, size = 0.092, seed = 5) {
  const rnd = seeded(seed), n = 6, jit = [];
  for (let k = 0; k < (n + 1) * (n + 1); k++) jit.push([rnd() - 0.5, rnd() - 0.5, rnd()]);
  const c = Math.cos(0.3), s = Math.sin(0.3);
  patch(g, TILES.foilOpen, n, n, (u, v) => {
    const k = Math.round(v * n) * (n + 1) + Math.round(u * n), [jx, jz, jy] = jit[k];
    const edge = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2, rim = edge > 0.99 ? 1 : 0;
    const x0 = (u - 0.5) * 2 * size * (1 - 0.1 * rim * jy) + jx * 0.008 * (edge > 0.3 ? 1 : 0), z0 = (v - 0.5) * 2 * size * (1 - 0.1 * rim * jy) + jz * 0.008 * (edge > 0.3 ? 1 : 0);
    const rise = edge > 0.62 ? (edge - 0.62) * (edge - 0.62) * 0.11 * (0.4 + 1.2 * jy) + (edge - 0.62) * 0.006 : 0;
    return [x0 * c + z0 * s, 0.0006 + rise + (edge > 0.3 ? jy * 0.0016 : 0), -x0 * s + z0 * c];
  });
}

// The bite: what is left of the burger lies behind the line z = biteLine(x): three arcs of teeth side by side,
// a point of bread between each
const BITE = { z: 0.011, w: 0.036, r: 0.024 };
const biteLine = (x) => { const d = (((x / BITE.w + 0.5) % 1 + 1) % 1 - 0.5) * BITE.w; return BITE.z - Math.sqrt(BITE.r * BITE.r - d * d) + Math.sqrt(BITE.r * BITE.r - BITE.w * BITE.w / 4); };

// The cut the bites leave: one wall along that line, from the paper to the dome, showing the layers (tile burgerCut)
function biteWall(g, stack) {
  const H = stackHeight(stack), tile = TILES.burgerCut;
  const dome = bunTopRows(stack[stack.length - 1].y0, stack[stack.length - 1].y1), crest = crestOf(dome), y0 = stack[0].y0;
  const xs = [-0.0562];
  for (let arc = -1; arc <= 1; arc++) for (let k = arc === -1 ? 0 : 1; k <= 6; k++) xs.push((arc - 0.5 + k / 6) * BITE.w);
  xs.push(0.0562);
  const pts = xs.map((x) => { const z = biteLine(x); return { x, z, top: profileY(dome, crest, true, Math.min(Math.hypot(x, z), dome[crest].r)) }; });
  let length = 0;
  const along = pts.map((p, k) => (k ? (length += Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z)) : 0));
  // the wall faces +z; x runs to the viewer's right
  for (let k = 0; k < pts.length - 1; k++) {
    if (k === 0 || (k - 1) % 6 === 0) g.smooth(); // a new arc: the point between two bites stays sharp
    const p = pts[k], q = pts[k + 1], s0 = 0.02 + 0.96 * along[k] / length, s1 = 0.02 + 0.96 * along[k + 1] / length;
    const a = put(g, tile, p.x, y0, p.z, s0, 1 - y0 / H), b = put(g, tile, q.x, y0, q.z, s1, 1 - y0 / H);
    const c = put(g, tile, q.x, q.top, q.z, s1, 1 - q.top / H), d = put(g, tile, p.x, p.top, p.z, s0, 1 - p.top / H);
    g.tri(a, b, c); g.tri(a, c, d);
  }
}

item('burger', 'bullion', 900, [0, 0.045, 0], (g) => {
  burgerPaper(g);
  burgerLayers(g, burgerStack('double'), { cols: turn(16), colsFine: turn(20), seed: 3 });
});
item('burgerTall', 'bullion', 1100, [0, 0.06, 0], (g) => {
  burgerPaper(g, 0.092, 9);
  burgerLayers(g, burgerStack('triple'), { cols: turn(16), colsFine: turn(20), seed: 8 });
});
item('burgerHalf', 'bullion', 900, [0, 0.045, -0.02], (g) => {
  burgerPaper(g);
  const stack = burgerStack('double');
  burgerLayers(g, stack, { cols: turn(28), bite: biteLine, seed: 3 });
  biteWall(g, stack);
});
item('burgerWrapped', 'bullion', 220, [0, 0.035, 0], (g) => {
  const rnd = seeded(12), ph = rnd() * 6;
  const rows = [{ r: 0.036, y: 0 }, { r: 0.054, y: 0.007 }, { r: 0.059, y: 0.024 }, { r: 0.057, y: 0.046 }, { r: 0.046, y: 0.063 }, { r: 0.024, y: 0.071 }, { r: 0, y: 0.072 }];
  polar(g, TILES.foilWrap, rows, turn(14), { mode: 'polar', qScale: 0.92, wobble: (a, i) => 1 + (i > 0 && i < 5 ? 0.035 * Math.sin(4 * a + ph + i) + 0.025 * Math.sin(9 * a + ph * 3) : 0), lift: (a, i) => (i >= 4 ? 0.0025 * Math.sin(3 * a + ph) : 0) });
});

// the loose parts of the kitchen
item('pattyRaw', 'bullion', 150, [0, 0.007, 0], (g) => patty(g, 0.0575, 0.014, TILES.pattySideRaw, TILES.pattyTopRaw, 21));
item('pattyDone', 'bullion', 150, [0, 0.006, 0], (g) => patty(g, 0.0545, 0.012, TILES.pattySide, TILES.pattyTop, 22));
function patty(g, R, h, side, top, seed) {
  const wob = pattyWobble(seed), cols = turn(16);
  polar(g, side, [{ r: R - 0.004, y: 0 }, { r: R, y: 0.004 }, { r: R, y: h - 0.0035 }, { r: R - 0.005, y: h }], cols, { wobble: wob, v0: 0.3, v1: 1 });
  polar(g, top, [{ r: R - 0.005, y: h }, { r: R * 0.5, y: h + 0.0006 }, { r: 0, y: h + 0.0004 }], cols, { wobble: wob, mode: 'polar', planar: true, qScale: 0.9 });
}
item('bunTop', 'bullion', 150, [0, 0.02, 0], (g) => {
  const cols = turn(14), rows = bunTopRows(0, 0.036);
  rows.splice(4, 1);
  polar(g, TILES.bunTop, rows, cols, { mode: 'polar', qScale: 0.97 });
  polar(g, TILES.bunCut, [{ r: 0, y: 0.0004 }, { r: BUN_R - 0.006, y: 0 }], cols, { mode: 'polar', planar: true, qScale: 0.94 });
});
item('bunBottom', 'bullion', 150, [0, 0.009, 0], (g) => {
  const cols = turn(16);
  polar(g, TILES.bunSide, bunBottomRows(0, 0.017), cols, { v0: 0.24 });
  polar(g, TILES.bunCut, [{ r: BUN_R - 0.007, y: 0.017 }, { r: 0, y: 0.0166 }], cols, { mode: 'polar', planar: true, qScale: 0.94 });
});
item('cheese', 'bullion', 150, [0, 0.002, 0], (g) => {
  const h = 0.0028, s = 0.046, edge = part(TILES.cheese, 0.1, 0.02, 0.9, 0.08);
  box(g, -s, 0, -s, s, h, s, { top: part(TILES.cheese, 0.08, 0.08, 0.92, 0.92), all: edge }, 'bottom');
});

// ---- BULLION: fries ----------------------------------------------------------------------------------------------
// One fry: a square stick from `base` to `tip`
function fry(g, base, tip, wid, dep, spin, variant) {
  const d = norm3(sub3(tip, base));
  let u = norm3(cross3(d, Math.abs(d[0]) > 0.9 ? [0, 0, 1] : [1, 0, 0]));
  let w = cross3(u, d);
  const c = Math.cos(spin), s = Math.sin(spin);
  [u, w] = [[u[0] * c + w[0] * s, u[1] * c + w[1] * s, u[2] * c + w[2] * s], [w[0] * c - u[0] * s, w[1] * c - u[1] * s, w[2] * c - u[2] * s]];
  const corner = (p, k) => { const su = k === 0 || k === 1 ? 1 : -1, sw = k === 0 || k === 3 ? 1 : -1; return [p[0] + u[0] * wid * su + w[0] * dep * sw, p[1] + u[1] * wid * su + w[1] * dep * sw, p[2] + u[2] * wid * su + w[2] * dep * sw]; };
  const tile = part(TILES.fry, variant / 3 + 0.03, 0.08, (variant + 1) / 3 - 0.03, 0.98), end = part(TILES.fry, variant / 3 + 0.08, 0.0, (variant + 1) / 3 - 0.08, 0.07);
  for (let k = 0; k < 4; k++) face(g, tile, corner(tip, k), corner(tip, (k + 1) % 4), corner(base, (k + 1) % 4), corner(base, k));
  face(g, end, corner(tip, 3), corner(tip, 2), corner(tip, 1), corner(tip, 0));
}

// The carton: two bowed panels joined at their sides, the back one taller. `inside` adds what shows when it empties
const CARTON = { frontTop: (s) => 0.068 + 0.016 * (2 * s - 1) * (2 * s - 1), backTop: (s) => 0.104 - 0.02 * (2 * s - 1) * (2 * s - 1) };
function fryCarton(g, inside) {
  const half = (y) => 0.027 + 0.0165 * y / 0.09, deep = (y) => 0.0125 + 0.0085 * y / 0.09;
  const bow = (s) => Math.pow(Math.max(0, 1 - (2 * s - 1) * (2 * s - 1)), 0.55);
  const front = (s, t, inset = 0) => { const y = (1 - t) * CARTON.frontTop(s); return [(2 * s - 1) * half(y), y, deep(y) * bow(s) - inset]; };
  const back = (s, t, inset = 0) => { const y = (1 - t) * CARTON.backTop(1 - s); return [(1 - 2 * s) * half(y), y, -deep(y) * bow(s) + inset]; };
  patch(g, TILES.cartonFront, 6, 3, front);
  patch(g, TILES.cartonBack, 6, 3, back);
  // inner faces: the back one always shows above the fries
  patch(g, TILES.cartonIn, 6, inside ? 3 : 1, (s, t) => { const q = back(1 - s, inside ? t : t * 0.4, 0.0006); return [q[0], q[1], q[2]]; });
  if (inside) patch(g, TILES.cartonIn, 6, 3, (s, t) => { const q = front(1 - s, t, 0.0006); return [q[0], q[1], q[2]]; });
  // the bottom
  const pts = [];
  for (let k = 0; k <= 5; k++) pts.push([half(0) * (1 - 2 * k / 5), deep(0) * bow(k / 5) * -1]);
  for (let k = 1; k <= 5; k++) pts.push([half(0) * (-1 + 2 * k / 5), deep(0) * bow(k / 5)]);
  pts.push(pts[0]);
  fan(g, TILES.trayPlastic, pts, 0, 0.06, 0.06, true);
}
// A layer of fries seen from above, inside the carton at height y
function fryBed(g, y) {
  const half = 0.027 + 0.0165 * y / 0.09 - 0.001, deep = 0.0125 + 0.0085 * y / 0.09 - 0.001;
  patch(g, TILES.friesPile, 4, 2, (s, t) => {
    const x = (2 * s - 1) * half, zmax = deep * Math.pow(Math.max(0, 1 - (2 * s - 1) * (2 * s - 1)), 0.55);
    return [x, y + 0.004 * Math.sin(s * 9) * Math.sin(t * 3.1), (2 * t - 1) * zmax, 0.5 + 0.48 * (2 * s - 1), 0.5 + 0.3 * (2 * t - 1)];
  });
}

item('fries', 'bullion', 520, [0, 0.045, 0], (g) => {
  fryCarton(g, false);
  fryBed(g, 0.064);
  const rnd = seeded(31);
  for (let k = 0; k < 36; k++) {
    const row = k % 3, x = (rnd() - 0.5) * 0.066, z = (row - 1) * 0.008 + (rnd() - 0.5) * 0.004;
    const lean = x / 0.033 * 0.3 + (rnd() - 0.5) * 0.24, tip = row === 2 && rnd() < 0.3 ? 0.22 + rnd() * 0.2 : (rnd() - 0.5) * 0.3 - (1 - row) * 0.1;
    const len = 0.062 + rnd() * 0.036 + (row === 0 ? 0.014 : row === 2 ? -0.012 : 0), base = [x * 0.8, 0.036, z];
    const dir = norm3([lean, 1, tip]);
    fry(g, base, [base[0] + dir[0] * len, base[1] + dir[1] * len, base[2] + dir[2] * len], 0.0036 + rnd() * 0.0008, 0.0034 + rnd() * 0.0012, rnd() * 1.5, (rnd() * 3) | 0);
  }
});
item('friesHalf', 'bullion', 520, [0, 0.045, 0], (g) => {
  fryCarton(g, true);
  fryBed(g, 0.02);
  const rnd = seeded(37);
  for (let k = 0; k < 13; k++) {
    const x = (rnd() - 0.5) * 0.05, z = (rnd() - 0.5) * 0.012, len = 0.05 + rnd() * 0.035, base = [x * 0.7, 0.012 + rnd() * 0.01, z];
    const dir = norm3([x / 0.025 * 0.45 + (rnd() - 0.5) * 0.3, 1, (rnd() - 0.5) * 0.35 - 0.1]);
    fry(g, base, [base[0] + dir[0] * len, base[1] + dir[1] * len, base[2] + dir[2] * len], 0.0036 + rnd() * 0.0008, 0.0034 + rnd() * 0.0012, rnd() * 1.5, (rnd() * 3) | 0);
  }
});

// ---- BULLION: the cup --------------------------------------------------------------------------------------------
const CUP = { r0: 0.03, r1: 0.045, h: 0.136 };
const lidRows = () => [{ r: 0.0462, y: 0.128 }, { r: 0.0472, y: 0.1345 }, { r: 0.0458, y: 0.1385 }, { r: 0.0425, y: 0.1405 }, { r: 0.038, y: 0.149 }, { r: 0.029, y: 0.1565 }, { r: 0.016, y: 0.1598 }, { r: 0, y: 0.16 }];
item('cup', 'bullion', 360, [0, 0.075, 0], (g) => {
  polar(g, TILES.cupWrap, [{ r: CUP.r0 - 0.0012, y: 0 }, { r: CUP.r0, y: 0.002 }, { r: CUP.r1, y: CUP.h }], turn(20));
  polar(g, TILES.paper, [{ r: 0, y: 0.004 }, { r: CUP.r0 - 0.003, y: 0.004 }, { r: CUP.r0 - 0.0012, y: 0 }], turn(12), { mode: 'polar', planar: true, qScale: 0.9 });
  polar(g, TILES.cupLid, lidRows(), turn(16), { mode: 'polar', qScale: 0.97 });
  tube(g, TILES.straw, [[0.004, 0.15, -0.004], [0.007, 0.19, -0.007], [0.0105, 0.228, -0.0105]], 0.0034, 6, { cap: true });
});
item('cupStack', 'bullion', 420, [0, 0.1, 0], (g) => {
  // ten cups one in another, mouth up: the lowest whole, then nine rims
  const cols = turn(14), step = 0.0125, top = part(TILES.cupWrap, 0, 0, 1, 0.14);
  polar(g, TILES.cupWrap, [{ r: CUP.r0 - 0.0012, y: 0 }, { r: CUP.r0, y: 0.002 }, { r: CUP.r1, y: CUP.h }, { r: CUP.r1 + 0.0012, y: CUP.h + 0.0012 }], cols);
  for (let k = 1; k < 10; k++) {
    const y = CUP.h + k * step;
    polar(g, top, [{ r: CUP.r1 - 0.0012, y: y - step + 0.0012 }, { r: CUP.r1 + 0.001, y: y + 0.0012 }], turn(14, -Math.PI + k * 0.9, Math.PI + k * 0.9));
  }
  const y = CUP.h + 9 * step + 0.0012;
  polar(g, TILES.paper, [{ r: CUP.r1 + 0.0012, y }, { r: CUP.r1 - 0.001, y: y - 0.0005 }, { r: CUP.r0 + 0.004, y: y - 0.1 }, { r: 0, y: y - 0.1 }], cols, { mode: 'polar', planar: true, qScale: 0.9 });
});

// ---- BULLION: the takeaway bag ---------------------------------------------------------------------------------
item('bag', 'bullion', 160, [0, 0.3, 0], (g) => {
  const hw = 0.13, hd = 0.07, h = 0.32, tuck = 0.026;
  const bulge = (s, t) => 0.006 * Math.sin(Math.PI * s) * Math.sin(Math.PI * Math.min(1, t * 1.15));
  patch(g, TILES.bagFront, 2, 3, (s, t) => [(2 * s - 1) * hw, h * (1 - t), hd + bulge(s, t)]);
  patch(g, TILES.bagFront, 2, 3, (s, t) => [(1 - 2 * s) * hw, h * (1 - t), -hd - bulge(s, t)]);
  // gusseted sides: folded in at the top, flat at the bottom
  for (const side of [1, -1]) {
    const x = side * hw, fold = (t) => tuck * Math.max(0, 1 - t * 1.6);
    patch(g, TILES.kraft, 2, 2, (s, t) => { const z = side * hd * (1 - 2 * s); return [x - side * fold(t) * (1 - Math.abs(2 * s - 1)), h * (1 - t), z]; });
  }
  face(g, part(TILES.kraft, 0.1, 0.1, 0.9, 0.5), [-hw, 0, hd], [hw, 0, hd], [hw, 0, -hd], [-hw, 0, -hd]);
  // the mouth: the inside, dark
  const y = h - 0.05, inn = TILES.bagInside, e = 0.0015;
  face(g, inn, [hw - e, h, hd - e], [-hw + e, h, hd - e], [-hw + e, y, hd - e], [hw - e, y, hd - e]);
  face(g, inn, [-hw + e, h, -hd + e], [hw - e, h, -hd + e], [hw - e, y, -hd + e], [-hw + e, y, -hd + e]);
  face(g, part(inn, 0.2, 0.6, 0.8, 0.95), [-hw + e, y, -hd + e], [hw - e, y, -hd + e], [hw - e, y, hd - e], [-hw + e, y, hd - e]);
  // twisted paper handles, folded down against the faces
  for (const side of [1, -1]) {
    const pts = [];
    for (let k = 0; k <= 6; k++) { const a = Math.PI * k / 6, x = -0.05 * Math.cos(a) * side; pts.push([x, h - 0.022 - 0.085 * Math.sin(a), side * (hd + 0.0045 + bulge(0.5 + x / (2 * hw), 0.2))]); }
    tube(g, TILES.bagHandle, pts, 0.0028, 3);
  }
});

// ---- BULLION: sauces, napkins, the fryer basket ----------------------------------------------------------------
function sauceBottle(g, tile) {
  const rows = [{ r: 0.024, y: 0 }, { r: 0.0275, y: 0.004 }, { r: 0.0275, y: 0.118 }, { r: 0.021, y: 0.14 }, { r: 0.0125, y: 0.148 }, { r: 0.0115, y: 0.156 }, { r: 0.0035, y: 0.192 }, { r: 0, y: 0.193 }];
  polar(g, tile, rows, turn(10));
}
item('sauceRed', 'bullion', 150, [0, 0.08, 0], (g) => sauceBottle(g, TILES.sauceRed));
item('sauceYellow', 'bullion', 150, [0, 0.08, 0], (g) => sauceBottle(g, TILES.sauceYellow));

item('napkins', 'bullion', 150, [0, 0.07, 0], (g) => {
  // the diner's steel dispenser: an arched box, a window on each long side
  const hw = 0.092, prof = [[0.047, 0], [0.049, 0.085], [0.042, 0.108], [0.026, 0.123], [0, 0.129], [-0.026, 0.123], [-0.042, 0.108], [-0.049, 0.085], [-0.047, 0]];
  let len = 0;
  const along = prof.map((p, k) => (k ? (len += Math.hypot(p[0] - prof[k - 1][0], p[1] - prof[k - 1][1])) : 0));
  // the two windows are flat faces of their own; the arch between them is smooth
  face(g, TILES.napkinFace, [-hw, 0.085, 0.049], [hw, 0.085, 0.049], [hw, 0, 0.047], [-hw, 0, 0.047]);
  face(g, TILES.napkinFace, [hw, 0.085, -0.049], [-hw, 0.085, -0.049], [-hw, 0, -0.047], [hw, 0, -0.047]);
  const arch = part(TILES.steel, 0, 0, 1, 0.62);
  loft(g, arch, prof.slice(1, 8).map(([z, y], k) => [[-hw, y, z, 0, (along[k + 1] - along[1]) / (along[7] - along[1])], [hw, y, z, 1, (along[k + 1] - along[1]) / (along[7] - along[1])]]));
  for (const side of [1, -1]) {
    g.smooth();
    const tile = part(TILES.steel, 0.05, 0.62, 0.95, 1), c = put(g, tile, side * hw, 0.06, 0, 0.5, 0.5);
    const ids = prof.map(([z, y]) => put(g, tile, side * hw, y, z, 0.5 + z / 0.1 * side, 1 - y / 0.13));
    for (let k = 0; k < prof.length; k++) { const a = ids[k], b = ids[(k + 1) % prof.length]; if (side > 0) g.tri(c, b, a); else g.tri(c, a, b); }
  }
  // a napkin pulled half out of each window
  for (const side of [1, -1]) patch(g, TILES.napkin, 2, 2, (s, t) => [(s - 0.5) * 0.105 * side, 0.066 - t * 0.04, side * (0.049 + 0.012 * Math.sin(Math.PI * t) + 0.003 * Math.sin(s * 6))]);
});

item('friesBasket', 'bullion', 520, [0, 0.19, 0.3], (g) => {
  const hw = 0.075, hd = 0.14, h = 0.115, wire = TILES.wire, steel = part(TILES.steel, 0.1, 0.1, 0.9, 0.3), e = 0.002;
  // wire walls, outside and inside, and the floor
  box(g, -hw, 0, -hd, hw, h, hd, { all: wire, front: part(wire, 0, 0, 0.55, 0.8), back: part(wire, 0, 0, 0.55, 0.8) }, 'top');
  face(g, wire, [hw - e, h, hd - e], [-hw + e, h, hd - e], [-hw + e, 0.07, hd - e], [hw - e, 0.07, hd - e]);
  face(g, wire, [-hw + e, h, -hd + e], [hw - e, h, -hd + e], [hw - e, 0.07, -hd + e], [-hw + e, 0.07, -hd + e]);
  face(g, wire, [hw - e, h, -hd + e], [hw - e, h, hd - e], [hw - e, 0.07, hd - e], [hw - e, 0.07, -hd + e]);
  face(g, wire, [-hw + e, h, hd - e], [-hw + e, h, -hd + e], [-hw + e, 0.07, -hd + e], [-hw + e, 0.07, hd - e]);
  // the rim and the handle: square steel bar
  const bar = 0.004;
  box(g, -hw - bar, h - bar, hd - bar, hw + bar, h + bar, hd + bar, steel);
  box(g, -hw - bar, h - bar, -hd - bar, hw + bar, h + bar, -hd + bar, steel);
  box(g, hw - bar, h - bar, -hd, hw + bar, h + bar, hd, steel, 'front back');
  box(g, -hw - bar, h - bar, -hd, -hw + bar, h + bar, hd, steel, 'front back');
  tube(g, steel, [[0, h, hd], [0, h + 0.035, hd + 0.05], [0, h + 0.075, hd + 0.15], [0, h + 0.085, hd + 0.3]], 0.006, 4, { cap: true, flat: true });
  // the fries: a heap, and sticks lying on it
  patch(g, TILES.friesPile, 4, 5, (s, t) => [(2 * s - 1) * (hw - e), 0.078 + 0.016 * Math.sin(Math.PI * s) * Math.sin(Math.PI * t) + 0.004 * Math.sin(s * 11 + t * 7), (2 * t - 1) * (hd - e)]);
  const rnd = seeded(43);
  for (let k = 0; k < 26; k++) {
    const x = (rnd() - 0.5) * 2 * (hw - 0.02), z = (rnd() - 0.5) * 2 * (hd - 0.03), a = rnd() * TAU, len = 0.05 + rnd() * 0.04, up = (rnd() - 0.3) * 0.5;
    const y = 0.082 + 0.016 * Math.cos(x / hw * 1.57) * Math.cos(z / hd * 1.57) + rnd() * 0.008;
    const dir = norm3([Math.cos(a), up, Math.sin(a)]);
    fry(g, [x - dir[0] * len / 2, y - dir[1] * len / 2, z - dir[2] * len / 2], [x + dir[0] * len / 2, y + dir[1] * len / 2, z + dir[2] * len / 2], 0.0038, 0.0038, rnd() * 1.5, (rnd() * 3) | 0);
  }
});

// ---- TRANCHE: the pies -------------------------------------------------------------------------------------------
// The 18-inch pie's profile from the crust's foot, over its puffed rim, to the centre. The tile is this profile
// unrolled from the centre: q is how far along it a row sits (0 centre, 1 foot)
function unrolled(rows) {
  const len = [0];
  for (let i = 1; i < rows.length; i++) len.push(len[i - 1] + Math.hypot(rows[i].r - rows[i - 1].r, rows[i].y - rows[i - 1].y));
  const total = len[len.length - 1];
  return { rows, total, q: len.map((l) => (total - l) / total) };
}
const PIE = { ...unrolled([{ r: 0.2285, y: 0.0012 }, { r: 0.231, y: 0.0075 }, { r: 0.2265, y: 0.015 }, { r: 0.217, y: 0.0185 }, { r: 0.2075, y: 0.0155 }, { r: 0.2, y: 0.009 }, { r: 0.193, y: 0.0062 }, { r: 0.105, y: 0.0058 }, { r: 0, y: 0.0058 }]),
  scale: 0.972, flat: 0.193, base: 0.0012, top: 0.0058 };
const SLICE_ROWS = [...PIE.rows.slice(0, 7), { r: 0.15, y: 0.0058 }, { r: 0.105, y: 0.0058 }, { r: 0.07, y: 0.0058 }, { r: 0.035, y: 0.0058 }, { r: 0, y: 0.0058 }];
const RAW = unrolled([{ r: 0.2275, y: 0.0008 }, { r: 0.23, y: 0.005 }, { r: 0.226, y: 0.0092 }, { r: 0.217, y: 0.011 }, { r: 0.2075, y: 0.0095 }, { r: 0.2, y: 0.0062 }, { r: 0.193, y: 0.0048 }, { r: 0.105, y: 0.0044 }, { r: 0, y: 0.0044 }]);
const pieBubble = (a) => 0.5 * Math.sin(7 * a + 1) + 0.3 * Math.sin(13 * a + 2.2) + 0.2 * Math.sin(23 * a + 0.4);
const pieWobble = (a, i) => (i <= 5 ? 1 + 0.011 * Math.sin(5 * a + 0.7) + 0.007 * Math.sin(11 * a + 2) : 1);
const pieLift = (a, i) => (i >= 2 && i <= 4 ? 0.003 * pieBubble(a) : i === 7 ? 0.0011 * Math.sin(3 * a + 1) : 0);
const SLICE = TAU / 8;
const inArc = (a, a0, a1) => (((a - a0) % TAU) + TAU) % TAU <= a1 - a0;

// Where the toppings sit (the painter and the shapes agree): angle, distance from the centre, turn, size.
// Those that stand up from the pie keep clear of the eight cuts
const TOPPINGS = (() => {
  const rnd = seeded(77);
  const spots = (n, far, gap, near = 0.02, clear = 0) => {
    const out = [];
    for (let k = 0; k < 6000 && out.length < n; k++) {
      const a = (rnd() * 2 - 1) * Math.PI, r = near + Math.sqrt(rnd()) * (far - near), x = r * Math.sin(a), z = r * Math.cos(a);
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < gap)) continue;
      if (clear) { const off = ((a % (SLICE)) + SLICE) % SLICE; if (r * Math.sin(Math.min(off, SLICE - off)) < clear) continue; }
      out.push({ a, r, x, z, turn: rnd() * TAU, size: 0.85 + rnd() * 0.3 });
    }
    return out;
  };
  return { pepperoni: spots(50, 0.176, 0.041), sausage: spots(34, 0.172, 0.03), mozzarella: spots(26, 0.168, 0.052), basil: spots(11, 0.16, 0.075, 0.045, 0.02), ricotta: spots(9, 0.158, 0.082, 0.05, 0.026), garlic: spots(40, 0.17, 0.03) };
})();

// The face a cut leaves along the radius at the angle a, looking the way `dir` turns (tile sliceCut)
function pieWall(g, rows, a, dir, wobble, lift, least = 0) {
  const tile = TILES.sliceCut, yb = PIE.base, sx = Math.sin(a), sz = Math.cos(a), nx = dir * sz, nz = -dir * sx;
  const at = (r, y) => put(g, tile, r * sx, y, r * sz, Math.min(0.995, r / 0.2345), Math.max(0.01, Math.min(0.99, 1 - (y - yb) / 0.0208)));
  g.smooth();
  const top = rows.map((row, i) => ({ r: Math.max(row.r * wobble(a, i), least), y: row.y + lift(a, i) }));
  const ids = top.map((p) => at(p.r, p.y)), low = top.map((p) => at(p.r, yb));
  for (let i = 3; i < rows.length - 1; i++) { g.toward(ids[i], ids[i + 1], low[i + 1], nx, 0, nz); g.toward(ids[i], low[i + 1], low[i], nx, 0, nz); }
  for (let i = 0; i < 3; i++) g.toward(low[3], ids[i], ids[i + 1], nx, 0, nz);
}

const PIE_TILE = { margherita: 'pieMargherita', pepperoni: 'piePepperoni', bianca: 'pieBianca', raw: 'pieRaw' };
// A pie, or the part of one between two angles, in the pie's own space (centre on the axis, lying on y = 0)
function pieWedge(g, kind, a0, a1, n, { walls = true, floor = null, under = false, slice = false } = {}) {
  const rows = kind === 'raw' ? RAW.rows : slice ? SLICE_ROWS : PIE.rows, cols = turn(n, a0, a1), least = floor || (() => 0);
  const lift = kind === 'raw' ? (a, i) => pieLift(a, i) * 0.5 : slice ? (a, i) => (i >= 2 && i <= 4 ? pieLift(a, i) : 0) : pieLift;
  polar(g, TILES[PIE_TILE[kind]], rows, cols, { mode: 'polar', qScale: PIE.scale, wobble: pieWobble, lift, floor });
  if (walls) { pieWall(g, rows, a0, -1, pieWobble, lift, least(a0)); pieWall(g, rows, a1, 1, pieWobble, lift, least(a1)); }
  if (under) polar(g, TILES.crustUnder, [{ r: 0, y: PIE.base }, { r: 0.07, y: PIE.base }, { r: 0.15, y: PIE.base }, { r: rows[0].r, y: PIE.base }], cols, { mode: 'polar', planar: true, qScale: 0.96, wobble: (a) => pieWobble(a, 0), floor });
  if (floor) {
    // where the teeth went: a wall across the slice
    g.smooth();
    const tile = TILES.sliceCut, ids = cols.map((a, j) => { const r = floor(a), s = 0.12 + 0.5 * j / n; return [put(g, tile, r * Math.sin(a), PIE.base, r * Math.cos(a), s, 0.99), put(g, tile, r * Math.sin(a), PIE.top, r * Math.cos(a), s, 0.79)]; });
    for (let j = 0; j < n; j++) { g.tri(ids[j][0], ids[j][1], ids[j + 1][1]); g.tri(ids[j][0], ids[j + 1][1], ids[j + 1][0]); }
  }
  const here = (t) => inArc(t.a, a0, a1) && t.r > least(t.a) + 0.03;
  if (kind === 'bianca') for (const t of TOPPINGS.ricotta.filter(here)) {
    const R = 0.0185 * t.size, h = 0.0115 * t.size;
    polar(g, TILES.ricotta, [{ r: R, y: PIE.top - 0.0006 }, { r: R * 0.74, y: PIE.top + h * 0.62 }, { r: 0, y: PIE.top + h }], turn(5, t.turn, t.turn + TAU), { mode: 'polar', cx: t.x, cz: t.z, qScale: 0.84, wobble: (a, i) => 1 + 0.12 * Math.sin(2 * a + t.turn) * (i < 2 ? 1 : 0) });
  }
  if (kind === 'margherita' || kind === 'raw') for (const t of TOPPINGS.basil.filter(here).filter((_, k) => k % 2 === 0 || kind === 'raw')) {
    const L = 0.036 * t.size, W = 0.021 * t.size, c = Math.cos(t.turn), s = Math.sin(t.turn), y0 = (kind === 'raw' ? RAW.rows[8].y : PIE.top) + 0.0012;
    patch(g, TILES.basil, 2, 2, (u, v) => {
      const along = (v - 0.5) * L, wide = Math.pow(Math.sin(Math.PI * (0.1 + 0.8 * v)), 0.8) * W, across = (u - 0.5) * wide;
      return [t.x + across * c + along * s, y0 + 0.0032 * (2 * u - 1) * (2 * u - 1) + 0.002 * (2 * v - 1) * (2 * v - 1), t.z - across * s + along * c];
    });
  }
}
function pieTray(g) {
  polar(g, TILES.aluTray, [{ r: 0.251, y: 0 }, { r: 0.2535, y: 0.0042 }, { r: 0.2478, y: 0.0048 }, { r: 0, y: 0.0016 }], turn(36), { mode: 'polar', planar: true, qScale: 0.97 });
}
for (const kind of ['margherita', 'pepperoni', 'bianca']) {
  const Name = kind[0].toUpperCase() + kind.slice(1);
  item(`pie${Name}`, 'tranche', 900, [0.25, 0.004, 0], (g) => {
    pieTray(g);
    const from = g.count;
    pieWedge(g, kind, -Math.PI, Math.PI, 36, { walls: false });
    g.move(from, (x, y, z) => [x, y + 0.0034, z]);
  });
  // three slices gone, from the front round to the right
  item(`pie${Name}Part`, 'tranche', 900, [0.25, 0.004, 0], (g) => {
    pieTray(g);
    const from = g.count;
    pieWedge(g, kind, 0.75 * Math.PI, TAU, 23);
    g.move(from, (x, y, z) => [x, y + 0.0034, z]);
  });
}
item('pieRaw', 'tranche', 900, [0.22, 0.004, 0], (g) => pieWedge(g, 'raw', -Math.PI, Math.PI, 32, { walls: false }));

// ---- TRANCHE: the paper plate and the slices -------------------------------------------------------------------
const PLATE = { R: 0.115, rows: [{ r: 0.115, y: 0.0135 }, { r: 0.108, y: 0.0128 }, { r: 0.078, y: 0.0022 }, { r: 0, y: 0.0018 }] };
function paperPlate(g, n = 18) {
  polar(g, TILES.plate, PLATE.rows, turn(n), { mode: 'polar', qScale: 0.975 });
  polar(g, TILES.paper, [{ r: 0.074, y: 0 }, { r: 0.115, y: 0.0125 }], turn(n), { mode: 'polar', planar: true, qScale: 0.9 });
}
// the height of the plate's upper face at a distance from its axis; past its edge, what hangs over droops
const plateY = (d) => (d < 0.078 ? 0.002 : d < 0.108 ? 0.0022 + (d - 0.078) / 0.03 * 0.0106 : d < 0.115 ? 0.0128 + (d - 0.108) / 0.007 * 0.0007 : 0.0135 - (d - 0.115) * 0.22 - (d - 0.115) * (d - 0.115) * 9);
item('plate', 'tranche', 150, [0.1, 0.012, 0], (g) => paperPlate(g, 20));
item('plateStack', 'tranche', 220, [0.1, 0.03, 0], (g) => {
  const n = 20, rise = 0.04;
  polar(g, TILES.paper, [{ r: 0.074, y: 0 }, { r: 0.115, y: 0.0125 }], turn(n), { mode: 'polar', planar: true, qScale: 0.9 });
  polar(g, TILES.plateEdge, [{ r: 0.115, y: 0.0125 }, { r: 0.1152, y: 0.0135 + rise }], turn(n));
  const from = g.count;
  polar(g, TILES.plate, PLATE.rows, turn(n), { mode: 'polar', qScale: 0.975 });
  g.move(from, (x, y, z) => [x, y + rise, z]);
});

const SLICE_SECTOR = { margherita: 2, pepperoni: 5, bianca: 1 };
// One slice out of the pie's tile, moved so that it lies along z, its point at z = tip and its crust behind
function sliceOf(g, kind, tip, options) {
  const a0 = SLICE_SECTOR[kind] * SLICE, mid = a0 + SLICE / 2, c = Math.cos(mid), s = Math.sin(mid), from = g.count;
  const floor = options.bitten ? (a) => 0.05 + 0.021 * Math.sqrt(Math.max(0, 1 - Math.pow((a - mid) / (SLICE / 2), 2) * 0.86)) : null;
  pieWedge(g, kind, a0, a0 + SLICE, options.under ? 8 : 6, { under: options.under, floor, slice: true });
  g.move(from, (x, y, z) => [-(x * c - z * s), y - PIE.base, -(x * s + z * c) + tip]);
  return from;
}
for (const kind of ['margherita', 'pepperoni', 'bianca']) {
  const Name = kind[0].toUpperCase() + kind.slice(1);
  // on its paper plate: the crust up on the far rim, the point over the near one
  item(`slice${Name}`, 'tranche', 320, [0.1, 0.012, 0], (g) => {
    paperPlate(g);
    const from = sliceOf(g, kind, 0.142, {});
    g.move(from, (x, y, z) => [x, y + plateY(Math.hypot(x, z)) + 0.0004, z]);
  });
  // in the hand, folded lengthwise; the origin is at the crust
  item(`slice${Name}Hand`, 'tranche', 320, [0, 0.02, 0.03], (g) => foldSlice(g, sliceOf(g, kind, 0.231, { under: true })));
}
item('sliceBitten', 'tranche', 320, [0, 0.02, 0.03], (g) => foldSlice(g, sliceOf(g, 'pepperoni', 0.231, { under: true, bitten: true })));
// The New York fold: the slice bent into a gutter along its length, its point sagging a little
function foldSlice(g, from) {
  const L = 0.231;
  g.move(from, (x, y, z) => {
    const curve = 0.098 + 0.09 * z / L, bend = Math.abs(x) / curve, side = Math.sign(x), sag = Math.max(0, (z / L - 0.42) / 0.58);
    return [side * (curve * Math.sin(bend) - y * Math.sin(bend)), curve * (1 - Math.cos(bend)) + y * Math.cos(bend) - 0.016 * sag * sag, z];
  });
}

// ---- TRANCHE: boxes ----------------------------------------------------------------------------------------------
const BOX = { s: 0.18, h: 0.045, lid: 0.004 };
function boxClosed(g) {
  const { s, h, lid } = BOX, side = TILES.boxSide;
  box(g, -s, 0, -s, s, h - lid, s, { all: part(side, 0, 0.3, 1, 1), bottom: part(TILES.boxInside, 0.05, 0.05, 0.95, 0.95) }, 'top');
  box(g, -s - 0.0012, h - lid, -s - 0.0012, s + 0.0012, h, s + 0.0012, { all: part(side, 0, 0, 1, 0.3), top: TILES.boxTop }, 'bottom');
}
item('box', 'tranche', 80, [0.18, 0.022, 0], (g) => boxClosed(g));
item('boxStack', 'tranche', 120, [0.18, 0.11, 0], (g) => {
  const rnd = seeded(91);
  for (let k = 0; k < 5; k++) {
    const one = new Geo(), a = (rnd() - 0.5) * 0.16, c = Math.cos(a), s = Math.sin(a), dx = (rnd() - 0.5) * 0.014, dz = (rnd() - 0.5) * 0.014;
    boxClosed(one);
    g.add(one, (x, y, z) => [x * c + z * s + dx, y + k * BOX.h, -x * s + z * c + dz]);
  }
});
item('boxOpen', 'tranche', 480, [0.18, 0.022, 0], (g) => {
  const { s, h, lid } = BOX, e = 0.003, y1 = h - lid, y0 = 0.003, side = part(TILES.boxSide, 0, 0.3, 1, 1), inner = TILES.boxInside, wall = part(inner, 0.03, 0.03, 0.97, 0.16), edge = part(TILES.boxSide, 0.02, 0.02, 0.98, 0.14);
  box(g, -s, 0, -s, s, y1, s, { all: side, bottom: part(inner, 0.05, 0.05, 0.95, 0.95) }, 'top');
  face(g, wall, [s - e, y1, s - e], [-s + e, y1, s - e], [-s + e, y0, s - e], [s - e, y0, s - e]);
  face(g, wall, [-s + e, y1, -s + e], [s - e, y1, -s + e], [s - e, y0, -s + e], [-s + e, y0, -s + e]);
  face(g, wall, [s - e, y1, -s + e], [s - e, y1, s - e], [s - e, y0, s - e], [s - e, y0, -s + e]);
  face(g, wall, [-s + e, y1, s - e], [-s + e, y1, -s + e], [-s + e, y0, -s + e], [-s + e, y0, s - e]);
  face(g, inner, [-s + e, y0, -s + e], [s - e, y0, -s + e], [s - e, y0, s - e], [-s + e, y0, s - e]);
  // the walls' thickness, seen from above
  face(g, edge, [-s, y1, s - e], [s, y1, s - e], [s, y1, s], [-s, y1, s]);
  face(g, edge, [-s, y1, -s], [s, y1, -s], [s, y1, -s + e], [-s, y1, -s + e]);
  face(g, edge, [s - e, y1, s], [s - e, y1, -s], [s, y1, -s], [s, y1, s]);
  face(g, edge, [-s, y1, s], [-s, y1, -s], [-s + e, y1, -s], [-s + e, y1, s]);
  // the lid, hinged along the back, thrown open past the vertical; its three flaps stand out of it
  const open = 100 * Math.PI / 180, co = Math.cos(open), si = Math.sin(open), top = new Geo(), flap = 0.04, f = 0.0012;
  box(top, -s, 0, 0, s, lid, 2 * s, { top: TILES.boxTop, bottom: inner, all: edge }, 'back');
  const paper = part(inner, 0.05, 0.75, 0.95, 0.97);
  face(top, paper, [-s + 0.012, 0, 2 * s - f], [s - 0.012, 0, 2 * s - f], [s - 0.02, -flap, 2 * s - f], [-s + 0.02, -flap, 2 * s - f]);
  face(top, paper, [s - 0.012, 0, 2 * s - f], [-s + 0.012, 0, 2 * s - f], [-s + 0.02, -flap, 2 * s - f], [s - 0.02, -flap, 2 * s - f]);
  for (const sd of [1, -1]) {
    const x = sd * (s - f), a = [x, 0, 0.02], b = [x, 0, 2 * s - 0.012], c2 = [x, -flap, 2 * s - 0.03], d = [x, -flap, 0.035];
    face(top, paper, a, b, c2, d); face(top, paper, b, a, d, c2);
  }
  g.add(top, (x, y, z) => [x, y1 + z * si + y * co, -s + z * co - y * si]);
  // the pie inside: a smaller one
  const pie = new Geo();
  pieWedge(pie, 'margherita', -Math.PI, Math.PI, 24, { walls: false });
  g.add(pie, (x, y, z) => [x * 0.72, y * 0.9 + y0 - 0.0005, z * 0.72]);
});

// ---- TRANCHE: the dough and the tools ------------------------------------------------------------------------
item('doughBall', 'tranche', 150, [0, 0.03, 0], (g) => {
  polar(g, TILES.dough, [{ r: 0.034, y: 0 }, { r: 0.051, y: 0.006 }, { r: 0.057, y: 0.021 }, { r: 0.05, y: 0.041 }, { r: 0.029, y: 0.054 }, { r: 0, y: 0.059 }], turn(12), { mode: 'polar', qScale: 0.93, wobble: (a, i) => 1 + 0.03 * Math.sin(2 * a + 0.6) + (i > 2 ? 0.02 * Math.sin(3 * a + i) : 0) });
});
item('doughDisc', 'tranche', 150, [0.13, 0.006, 0], (g) => {
  polar(g, TILES.dough, [{ r: 0.149, y: 0.0008 }, { r: 0.151, y: 0.0065 }, { r: 0.141, y: 0.0105 }, { r: 0.123, y: 0.0052 }, { r: 0, y: 0.0042 }], turn(20), { mode: 'polar', qScale: 0.92,
    wobble: (a, i) => 1 + 0.035 * Math.sin(2 * a + 0.4) + 0.02 * Math.sin(3 * a + 2) + 0.012 * Math.sin(7 * a), lift: (a, i) => (i === 2 ? 0.0018 * Math.sin(5 * a + 1) : 0) });
});
item('peel', 'tranche', 150, [0, 0.012, 0.12], (g) => {
  // the origin is the end of the handle; the blade is 1 m further along +z
  const blade = part(TILES.wood, 0.5, 0, 1, 1), right = [[0.017, 1], [0.05, 1.012], [0.118, 1.045], [0.157, 1.088], [0.165, 1.14], [0.165, 1.3], [0.151, 1.336], [0.1, 1.349]];
  const outline = [[0, 1.353], ...right.slice().reverse(), ...right.map(([x, z]) => [-x, z]), [0, 1.353]];
  const thick = (z) => (z < 1.2 ? 0.012 : 0.012 - (z - 1.2) / 0.153 * 0.0085), uv = (x, z) => [0.5 + x / 0.34, (z - 0.995) / 0.36];
  g.smooth();
  const c = put(g, blade, 0, 0.012, 1.17, ...uv(0, 1.17)), up = outline.map(([x, z]) => put(g, blade, x, thick(z), z, ...uv(x, z)));
  for (let k = 0; k < outline.length - 1; k++) g.tri(c, up[k], up[k + 1]);
  g.smooth();
  const c2 = put(g, blade, 0, 0, 1.17, ...uv(0, 1.17)), down = outline.map(([x, z]) => put(g, blade, x, 0, z, ...uv(x, z)));
  for (let k = 0; k < outline.length - 1; k++) g.tri(c2, down[k + 1], down[k]);
  const rim = part(TILES.wood, 0.02, 0.52, 0.48, 0.6);
  loft(g, rim, [outline.map(([x, z], k) => [x, 0, z, k / (outline.length - 1), 1]), outline.map(([x, z], k) => [x, thick(z), z, k / (outline.length - 1), 0])]);
  const handle = (t0, t1) => part(TILES.wood, 0.02, t0, 0.48, t1);
  box(g, -0.017, 0.001, 0, 0.017, 0.021, 1.004, { top: handle(0.04, 0.16), bottom: handle(0.2, 0.32), left: handle(0.36, 0.44), right: handle(0.36, 0.44), back: part(TILES.wood, 0.02, 0.64, 0.1, 0.74) }, 'front', 'top bottom');
});
item('cutter', 'tranche', 150, [0, 0.012, 0.07], (g) => {
  // lying on its side: the wheel behind, the handle towards the hand
  const wz = -0.058, R = 0.05, y = 0.0125, cols = turn(16), disc = part(TILES.cutter, 0, 0, 0.75, 0.75);
  polar(g, disc, [{ r: R, y: y + 0.0003 }, { r: R * 0.9, y: y + 0.001 }, { r: 0, y: y + 0.001 }], cols, { mode: 'polar', planar: true, qScale: 0.97, cz: wz });
  polar(g, disc, [{ r: 0, y: y - 0.001 }, { r: R, y: y - 0.0003 }], cols, { mode: 'polar', planar: true, qScale: 0.97, cz: wz });
  const steel = part(TILES.cutter, 0.02, 0.8, 0.72, 0.98);
  box(g, -0.008, y - 0.005, wz - 0.012, 0.008, y + 0.005, wz + 0.064, steel);
  const grip = part(TILES.cutter, 0.79, 0.02, 0.98, 0.98), pts = [[0, y, wz + 0.058], [0, y, wz + 0.075], [0, y, wz + 0.11], [0, y, wz + 0.15], [0, y, wz + 0.172]];
  tube(g, grip, pts, (t) => [0.008, 0.0118, 0.0125, 0.0115, 0.007][Math.round(t * 4)], 6, { cap: true });
});
function shaker(g, tile) {
  const cols = turn(12);
  polar(g, tile, [{ r: 0.027, y: 0 }, { r: 0.0325, y: 0.006 }, { r: 0.0305, y: 0.078 }, { r: 0.029, y: 0.092 }], cols);
  polar(g, TILES.shakerTop, [{ r: 0.03, y: 0.092 }, { r: 0.03, y: 0.105 }, { r: 0.021, y: 0.1195 }, { r: 0, y: 0.124 }], cols, { mode: 'polar', qScale: 0.96 });
}
item('shakerOregano', 'tranche', 150, [0, 0.06, 0], (g) => shaker(g, TILES.shakerOregano));
item('shakerChili', 'tranche', 150, [0, 0.06, 0], (g) => shaker(g, TILES.shakerChili));
item('shakerCheese', 'tranche', 150, [0, 0.06, 0], (g) => shaker(g, TILES.shakerCheese));
item('can', 'tranche', 150, [0, 0.06, 0], (g) => {
  const cols = turn(13);
  polar(g, TILES.can, [{ r: 0.025, y: 0 }, { r: 0.033, y: 0.009 }, { r: 0.033, y: 0.106 }, { r: 0.0272, y: 0.1195 }, { r: 0.0272, y: 0.122 }], cols);
  polar(g, TILES.canTop, [{ r: 0.0272, y: 0.122 }, { r: 0.0252, y: 0.1202 }, { r: 0, y: 0.1202 }], cols, { mode: 'polar', planar: true, qScale: 0.96 });
});

// ---------------------------------------------------------------------------------------------------------------
// Building: plain arrays first (no canvas, no renderer), BufferGeometry on top
// ---------------------------------------------------------------------------------------------------------------
function buildFoodMeshes() {
  const meshes = {}, info = {};
  for (const [name, def] of Object.entries(ITEMS)) {
    const g = new Geo();
    def.build(g);
    const mesh = g.finish(), p = mesh.position;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < p.length; k += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], p[k + c]); hi[c] = Math.max(hi[c], p[k + c]); }
    for (let k = 1; k < p.length; k += 3) p[k] -= lo[1]; // set down on y = 0
    meshes[name] = mesh;
    const r = (v) => Math.round(v * 1e4) / 1e4;
    info[name] = { w: r(hi[0] - lo[0]), h: r(hi[1] - lo[1]), d: r(hi[2] - lo[2]), min: [r(lo[0]), 0, r(lo[2])], max: [r(hi[0]), r(hi[1] - lo[1]), r(hi[2])],
      grip: def.grip, triangles: mesh.index.length / 3, budget: def.budget, brand: def.brand };
  }
  for (const [alias, name] of Object.entries(ALIAS)) { meshes[alias] = meshes[name]; info[alias] = info[name]; }
  return { meshes, info };
}

function buildFoodGeometries() {
  const { meshes, info } = buildFoodMeshes(), geometry = {};
  for (const [name, mesh] of Object.entries(meshes)) {
    if (ALIAS[name]) { geometry[name] = geometry[ALIAS[name]]; continue; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normal, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(mesh.uv, 2));
    geo.setIndex(new THREE.BufferAttribute(mesh.index, 1));
    geo.name = `food/${name}`;
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    geometry[name] = geo;
  }
  return { geometry, info };
}

// ---------------------------------------------------------------------------------------------------------------
// Painting. Three canvases share the tiles: colour, `m` (roughness in green, metalness in blue) and `h` (relief, grey:
// the normal map is drawn from it). The last two are half the size; their contexts are scaled so every painter works
// in colour pixels, inside its tile.
// ---------------------------------------------------------------------------------------------------------------
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (h, a = 1) => { const c = typeof h === 'string' ? hex(h) : h; return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
const orm = (rough, metal = 0, a = 1) => `rgba(0,${Math.round(rough * 255)},${Math.round(metal * 255)},${a})`;
const grey = (v, a = 1) => { const k = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgba(${k},${k},${k},${a})`; };
const pick = (rnd, list) => list[(rnd() * list.length) | 0];

function wash(c, w, h, style) { c.fillStyle = style; c.fillRect(-GUTTER, -GUTTER, w + 2 * GUTTER, h + 2 * GUTTER); }
// the ground of a tile on the three canvases
function ground(P, w, h, colour, rough, metal = 0, height = 0.5) { wash(P.c, w, h, colour); wash(P.m, w, h, orm(rough, metal)); wash(P.h, w, h, grey(height)); }
function dot(c, x, y, r, style) { c.fillStyle = style; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
// a soft round stain, opaque `a` at its heart
function haze(c, x, y, r, colour, a) {
  const k = c.createRadialGradient(x, y, 0, x, y, r);
  k.addColorStop(0, rgba(colour, a)); k.addColorStop(1, rgba(colour, 0));
  c.fillStyle = k; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
}
// n dots or stains thrown over the tile
function scatter(c, rnd, w, h, n, styles, r0, r1, a0 = 1, a1 = a0, soft = false) {
  for (let k = 0; k < n; k++) {
    const x = -GUTTER + rnd() * (w + 2 * GUTTER), y = -GUTTER + rnd() * (h + 2 * GUTTER), r = r0 + (r1 - r0) * rnd(), a = a0 + (a1 - a0) * rnd(), s = pick(rnd, styles);
    if (soft) haze(c, x, y, r, s, a); else { c.globalAlpha = a; dot(c, x, y, r, typeof s === 'string' ? s : rgba(s)); }
  }
  c.globalAlpha = 1;
}
// relief grain: dots lighter and darker than the middle grey
function grain(P, rnd, w, h, n, r0, r1, depth) {
  for (let k = 0; k < n; k++) { P.h.globalAlpha = 0.55; dot(P.h, -GUTTER + rnd() * (w + 2 * GUTTER), -GUTTER + rnd() * (h + 2 * GUTTER), r0 + (r1 - r0) * rnd(), grey(0.5 + (rnd() - 0.5) * 2 * depth)); }
  P.h.globalAlpha = 1;
}
function vertical(c, w, h, stops) {
  const k = c.createLinearGradient(0, 0, 0, h);
  for (const [at, colour] of stops) k.addColorStop(at, colour);
  wash(c, w, h, k);
}
function radial(c, w, h, cx, cy, r, stops) {
  const k = c.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [at, colour] of stops) k.addColorStop(at, colour);
  wash(c, w, h, k);
}
// a closed lumpy outline round (x, y)
function blob(c, rnd, x, y, r, { n = 9, jitter = 0.25, squash = 1, rot = 0 } = {}) {
  const cs = Math.cos(rot), sn = Math.sin(rot), pts = [];
  for (let k = 0; k < n; k++) { const a = k / n * TAU, q = r * (1 - jitter + 2 * jitter * rnd()), px = Math.cos(a) * q, py = Math.sin(a) * q * squash; pts.push([x + px * cs - py * sn, y + px * sn + py * cs]); }
  c.beginPath();
  c.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
  for (let k = 0; k < n; k++) { const a = pts[k], b = pts[(k + 1) % n]; c.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
  c.closePath();
}
// crumpled foil or paper: flat facets tilted every which way
function facets(P, rnd, w, h, n, size, light, dark, relief) {
  for (let k = 0; k < n; k++) {
    const x = rnd() * w, y = rnd() * h, r = size * (0.5 + rnd()), a = rnd() * TAU, pts = [];
    for (let j = 0; j < 3; j++) { const b = a + j * TAU / 3 + (rnd() - 0.5) * 1.2; pts.push([x + Math.cos(b) * r * (0.6 + rnd() * 0.6), y + Math.sin(b) * r * (0.6 + rnd() * 0.6)]); }
    const shade = rnd();
    for (const [c, style] of [[P.c, shade > 0.5 ? rgba(light, (shade - 0.5) * 0.5) : rgba(dark, (0.5 - shade) * 0.42)], [P.h, grey(0.5 + (shade - 0.5) * relief, 0.6)]]) {
      c.fillStyle = style; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); c.lineTo(pts[1][0], pts[1][1]); c.lineTo(pts[2][0], pts[2][1]); c.closePath(); c.fill();
    }
  }
}
function line(c, x0, y0, x1, y1, style, width = 1) { c.strokeStyle = style; c.lineWidth = width; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
const SERIF = 'Georgia, "Times New Roman", serif', SANS = '"Helvetica Neue", Arial, sans-serif';
function text(c, str, x, y, font, style, { align = 'center', spacing = 0 } = {}) {
  c.font = font; c.fillStyle = style; c.textAlign = align; c.textBaseline = 'middle';
  c.letterSpacing = `${spacing}px`;
  c.fillText(str, x, y);
  c.letterSpacing = '0px';
}

const PAINT = {};

// ---- BULLION -------------------------------------------------------------------------------------------------------
PAINT.liner = (P, w, h, rnd) => {
  ground(P, w, h, B.cream, 0.86);
  scatter(P.c, rnd, w, h, 900, ['#e6d9bb', '#fbf4e2'], 0.5, 1.6, 0.35);
  // a field of small ingots, pale gold
  P.c.fillStyle = rgba(B.gold, 0.42);
  for (let j = 0; j < 9; j++) for (let i = -1; i < 13; i++) {
    const x = i * 44 + (j % 2) * 22 + 10, y = j * 44 + 18;
    P.c.beginPath(); P.c.moveTo(x - 9, y + 5); P.c.lineTo(x - 6, y - 5); P.c.lineTo(x + 6, y - 5); P.c.lineTo(x + 9, y + 5); P.c.closePath(); P.c.fill();
  }
  P.c.strokeStyle = rgba(B.goldDeep, 0.85); P.c.lineWidth = 2.5; P.c.strokeRect(13, 13, w - 26, h - 26);
  P.c.lineWidth = 1; P.c.strokeRect(19, 19, w - 38, h - 38);
  // the centre: a cream cartouche, the mark, the line
  P.c.fillStyle = B.cream; P.c.beginPath(); P.c.roundRect(w / 2 - 190, h / 2 - 82, 380, 164, 18); P.c.fill();
  P.c.strokeStyle = rgba(B.goldDeep, 0.8); P.c.lineWidth = 1.5; P.c.stroke();
  brandLockup(P.c, 'bullion', w / 2, h / 2 - 22, 40);
  text(P.c, '« La valeur refuge. »', w / 2, h / 2 + 36, `italic 21px ${SERIF}`, B.black);
  text(P.c, 'BURGERS EN BARRES DEPUIS 1971', w / 2, h / 2 + 62, `700 9.5px ${SANS}`, rgba(B.oxblood, 0.95), { spacing: 2.2 });
  // the day's quotes along the bottom, small emblems in the corners
  text(P.c, 'BŒUF ▲ +4,2 %   ·   PÉPITES ▲ +1,8 %   ·   FAIM ▼ −100 %', w / 2, h - 36, `700 10px ${SANS}`, rgba(B.black, 0.82), { spacing: 1.4 });
  text(P.c, 'COTATION DU JOUR', w / 2, 38, `700 9px ${SANS}`, rgba(B.black, 0.6), { spacing: 3 });
  for (const [x, y] of [[52, 54], [w - 52, 54], [52, h - 62], [w - 52, h - 62]]) brandEmblem(P.c, 'bullion', x, y, 34);
  // a few grease spots
  for (let k = 0; k < 5; k++) { const x = rnd() * w, y = rnd() * h, r = 8 + rnd() * 16; haze(P.c, x, y, r, '#c9a86a', 0.3); haze(P.m, x, y, r, [0, 110, 0], 0.7); }
};

PAINT.trayPlastic = (P, w, h, rnd) => {
  ground(P, w, h, '#1b1917', 0.46);
  scatter(P.c, rnd, w, h, 500, ['#24211e', '#141210'], 0.5, 1.4, 0.6);
  scatter(P.m, rnd, w, h, 500, [orm(0.6), orm(0.36)], 0.6, 1.5, 0.6);
  grain(P, rnd, w, h, 1400, 0.4, 0.8, 0.1);
  for (let k = 0; k < 14; k++) { const x = rnd() * w, y = rnd() * h, a = rnd() * TAU, l = 10 + rnd() * 40; line(P.c, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, rgba('#5a554f', 0.35), 0.7); }
};

PAINT.bunTop = (P, w, h, rnd) => {
  const cx = w / 2, cy = h / 2, R = w / 2;
  ground(P, w, h, '#ecd2a0', 0.6);
  radial(P.c, w, h, cx, cy, R, [[0, '#b8702a'], [0.4, '#c5822f'], [0.66, '#d79843'], [0.84, '#e5b66d'], [1, '#edd3a0']]);
  radial(P.m, w, h, cx, cy, R, [[0, orm(0.4)], [0.7, orm(0.5)], [1, orm(0.68)]]);
  for (let k = 0; k < 70; k++) { const a = rnd() * TAU, r = Math.sqrt(rnd()) * R * 0.74; haze(P.c, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 8 + rnd() * 22, pick(rnd, ['#9f5a1c', '#a8621f', '#dfa550']), 0.1 + rnd() * 0.14); }
  scatter(P.c, rnd, w, h, 1400, ['#a8621f', '#dba456', '#8f4f18'], 0.4, 1.1, 0.22);
  grain(P, rnd, w, h, 600, 0.8, 2, 0.12);
  // sesame seeds, thinning towards the edge
  const seeds = [];
  for (let k = 0; k < 900 && seeds.length < 96; k++) {
    const a = rnd() * TAU, r = (0.04 + 0.7 * Math.pow(rnd(), 0.7)) * R, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (seeds.some((s) => Math.hypot(s[0] - x, s[1] - y) < 9.5)) continue;
    seeds.push([x, y, rnd() * TAU, 0.85 + rnd() * 0.35]);
  }
  for (const [x, y, rot, k] of seeds) {
    const seed = (c, grow, style) => { c.save(); c.translate(x, y); c.rotate(rot); c.fillStyle = style; c.beginPath(); c.moveTo(-4.4 * k - grow, 0); c.bezierCurveTo(-2 * k, -2.5 * k - grow, 2.6 * k, -2.1 * k - grow, 4.2 * k + grow, 0); c.bezierCurveTo(2.6 * k, 2.1 * k + grow, -2 * k, 2.5 * k + grow, -4.4 * k - grow, 0); c.fill(); c.restore(); };
    seed(P.c, 1.3, rgba('#7a4212', 0.38));
    seed(P.c, 0, pick(rnd, ['#f3e4ba', '#eedcab', '#f7ecc8']));
    seed(P.h, 0.6, grey(0.9, 0.9));
    seed(P.m, 0, orm(0.72));
    P.c.save(); P.c.translate(x, y); P.c.rotate(rot); P.c.fillStyle = rgba('#fffbe8', 0.6); P.c.beginPath(); P.c.ellipse(0.4 * k, -0.5 * k, 2 * k, 0.8 * k, 0, 0, TAU); P.c.fill(); P.c.restore();
  }
};

PAINT.bunSide = (P, w, h, rnd) => {
  ground(P, w, h, '#dba458', 0.72);
  vertical(P.c, w, h, [[0, '#f0deb4'], [0.16, '#ead0a0'], [0.24, '#c58a45'], [0.32, '#d99f52'], [0.7, '#e7bd7c'], [0.9, '#d8a25a'], [1, '#b67a3a']]);
  scatter(P.c, rnd, w, h, 500, ['#c98f48', '#f2dcae', '#b97c3a'], 0.4, 1.3, 0.25);
  for (let k = 0; k < 40; k++) dot(P.c, rnd() * w, rnd() * h * 0.2, 0.8 + rnd() * 1.6, rgba('#d3b27c', 0.7));
  grain(P, rnd, w, h, 300, 0.7, 1.6, 0.14);
};

PAINT.bunCut = (P, w, h, rnd) => {
  const cx = w / 2, cy = h / 2, R = w / 2;
  ground(P, w, h, '#c2863f', 0.88);
  radial(P.c, w, h, cx, cy, R, [[0, '#f3e4bf'], [0.6, '#efd9aa'], [0.86, '#e2b876'], [0.95, '#c98d47'], [1, '#b67a3a']]);
  for (let k = 0; k < 420; k++) { const a = rnd() * TAU, r = Math.sqrt(rnd()) * R * 0.93; dot(P.c, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.7 + rnd() * 2, rgba(pick(rnd, ['#c9903f', '#b97a30', '#dcae68']), 0.3 + rnd() * 0.3)); }
  for (let k = 0; k < 90; k++) { const a = rnd() * TAU, r = Math.sqrt(rnd()) * R * 0.9, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, s = 1 + rnd() * 2.4; dot(P.c, x, y, s, rgba('#cfae78', 0.75)); dot(P.h, x, y, s, grey(0.2, 0.8)); }
  grain(P, rnd, w, h, 500, 0.7, 1.8, 0.2);
};

function searedMeat(P, w, h, rnd, n) {
  scatter(P.c, rnd, w, h, n, ['#6e442b', '#2c1a0f', '#5a3622', '#7b4f33', '#3a2314'], 1.2, 5, 0.3, 0.6);
  scatter(P.c, rnd, w, h, n * 0.12, ['#1b100a'], 1.5, 4.5, 0.4, 0.75);
  for (let k = 0; k < n * 0.3; k++) { const x = rnd() * w, y = rnd() * h, r = 0.5 + rnd() * 1.1; dot(P.c, x, y, r, rgba('#caa070', 0.45)); dot(P.m, x, y, r + 0.8, orm(0.2, 0, 0.9)); }
  for (let k = 0; k < n * 0.05; k++) haze(P.m, rnd() * w, rnd() * h, 6 + rnd() * 14, [0, 70, 0], 0.6);
  grain(P, rnd, w, h, n * 1.6, 0.9, 3.2, 0.42);
}
PAINT.pattySide = (P, w, h, rnd) => {
  ground(P, w, h, '#4a2c1c', 0.56);
  vertical(P.c, w, h, [[0, '#33200f'], [0.3, '#412616'], [0.5, '#5a3521'], [0.8, '#4a2b1a'], [1, '#33200f']]);
  searedMeat(P, w, h, rnd, 520);
};
PAINT.pattyTop = (P, w, h, rnd) => {
  ground(P, w, h, '#33200f', 0.5);
  radial(P.c, w, h, w / 2, h / 2, w / 2, [[0, '#5c3823'], [0.75, '#4a2b1a'], [1, '#2f1c10']]);
  searedMeat(P, w, h, rnd, 900);
};
function rawMeat(P, w, h, rnd, n) {
  P.c.lineCap = 'round';
  for (let k = 0; k < n; k++) {
    const x = rnd() * w, y = rnd() * h, a = rnd() * TAU, l = 3 + rnd() * 7;
    P.c.strokeStyle = rgba(pick(rnd, ['#d47670', '#b84d4c', '#e0908a', '#a94444', '#c96560']), 0.75); P.c.lineWidth = 1.6 + rnd() * 1.8;
    P.c.beginPath(); P.c.moveTo(x, y); P.c.quadraticCurveTo(x + Math.cos(a + 0.7) * l * 0.6, y + Math.sin(a + 0.7) * l * 0.6, x + Math.cos(a) * l, y + Math.sin(a) * l); P.c.stroke();
  }
  scatter(P.c, rnd, w, h, n * 0.16, ['#f1dcd2', '#ecc9bd'], 0.6, 1.6, 0.6, 0.9);
  grain(P, rnd, w, h, n, 1, 3, 0.3);
}
PAINT.pattySideRaw = (P, w, h, rnd) => { ground(P, w, h, '#c4605c', 0.42); rawMeat(P, w, h, rnd, 520); };
PAINT.pattyTopRaw = (P, w, h, rnd) => { ground(P, w, h, '#c4605c', 0.42); rawMeat(P, w, h, rnd, 1300); };

PAINT.cheese = (P, w, h, rnd) => {
  ground(P, w, h, '#f5a51f', 0.34);
  for (let k = 0; k < 26; k++) haze(P.c, rnd() * w, rnd() * h, 8 + rnd() * 22, pick(rnd, ['#ffc04a', '#ee9717', '#fbb233']), 0.22);
  // melted: thinner and deeper at the edge
  const k = P.c.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.72);
  k.addColorStop(0, rgba('#e58a12', 0)); k.addColorStop(1, rgba('#dd7f0e', 0.55));
  wash(P.c, w, h, k);
  for (let j = 0; j < 9; j++) haze(P.c, rnd() * w, rnd() * h, 5 + rnd() * 9, '#ffe08a', 0.3);
};

PAINT.lettuce = (P, w, h, rnd) => {
  ground(P, w, h, '#7fb23a', 0.5);
  vertical(P.c, w, h, [[0, '#bfe07c'], [0.1, '#a3cf58'], [0.35, '#84b93e'], [0.75, '#6ea233'], [1, '#93bf58']]);
  scatter(P.c, rnd, w, h, 60, ['#5c9428', '#c0e07a', '#4f8a22'], 6, 16, 0.12, 0.25, true);
  for (let k = 0; k < 70; k++) {
    const x = rnd() * w, bend = (rnd() - 0.5) * 22;
    for (const [c, style, width] of [[P.c, rgba('#d6eaa6', 0.5), 1.1], [P.h, grey(0.78, 0.8), 1.6]]) { c.strokeStyle = style; c.lineWidth = width; c.beginPath(); c.moveTo(x, h + 2); c.quadraticCurveTo(x + bend * 0.3, h * 0.5, x + bend, -2); c.stroke(); }
  }
  for (let x = -6; x < w + 6; x += 9 + rnd() * 9) { const g = P.h.createLinearGradient(x, 0, x + 12, 0); g.addColorStop(0, grey(0.5, 0)); g.addColorStop(0.5, grey(rnd() < 0.5 ? 0.25 : 0.8, 0.5)); g.addColorStop(1, grey(0.5, 0)); P.h.fillStyle = g; P.h.fillRect(x, -GUTTER, 12, h * 0.6); }
};

PAINT.tomato = (P, w, h, rnd) => {
  ground(P, w, h, '#c22a1a', 0.3);
  vertical(P.c, w, h, [[0, '#e8644a'], [0.3, '#dc4a32'], [0.5, '#c62c1b'], [1, '#a82216']]);
  scatter(P.c, rnd, w, h, 30, ['#f08a6a', '#b0200f'], 2, 6, 0.2, 0.35, true);
  line(P.c, -6, h * 0.42, w + 6, h * 0.42, rgba('#ff9a80', 0.45), 1.2);
};

PAINT.bacon = (P, w, h, rnd) => {
  ground(P, w, h, '#8e2f25', 0.42);
  for (let j = 0; j < 5; j++) {
    const y0 = (j + 0.5) / 5 * h, ph = rnd() * 6, fat = j % 2 === 1;
    for (const [c, style] of [[P.c, fat ? rgba('#eccfa8', 0.95) : rgba(pick(rnd, ['#a23b2b', '#7d261e']), 0.9)], [P.h, grey(fat ? 0.68 : 0.42, 0.9)]]) {
      c.strokeStyle = style; c.lineWidth = fat ? 3 + rnd() * 2.5 : 6; c.beginPath();
      for (let x = -8; x <= w + 8; x += 6) { const y = y0 + Math.sin(x * 0.09 + ph) * 2.6; if (x === -8) c.moveTo(x, y); else c.lineTo(x, y); }
      c.stroke();
    }
  }
  scatter(P.c, rnd, w, h, 160, ['#5a1c14', '#b8503a', '#3f120d'], 0.6, 2, 0.3, 0.6);
  vertical(P.c, w, h, [[0, rgba('#3f120d', 0.7)], [0.14, rgba('#3f120d', 0)], [0.86, rgba('#3f120d', 0)], [1, rgba('#3f120d', 0.7)]]);
  grain(P, rnd, w, h, 200, 0.8, 2, 0.25);
};

PAINT.onions = (P, w, h, rnd) => {
  ground(P, w, h, '#a8691f', 0.62);
  P.c.lineCap = 'round'; P.h.lineCap = 'round';
  for (let k = 0; k < 420; k++) {
    const x = rnd() * w, y = rnd() * h, a = rnd() * TAU, l = 4 + rnd() * 9, bend = (rnd() - 0.5) * 8, lw = 1.6 + rnd() * 2.2, tone = rnd();
    for (const [c, style] of [[P.c, rgba(pick(rnd, ['#d99a45', '#ebbd6b', '#b9772e', '#8a4a17', '#f0cc85']), 0.95)], [P.h, grey(0.3 + tone * 0.6, 0.9)]]) {
      c.strokeStyle = style; c.lineWidth = lw; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a + 1.2) * bend, y + Math.sin(a + 1.2) * bend, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    }
  }
};

// The layers a bite shows, drawn to the stack's own heights
PAINT.burgerCut = (P, w, h, rnd) => {
  const stack = burgerStack('double'), H = stackHeight(stack), Y = (y) => h * (1 - y / H);
  ground(P, w, h, '#f1e2bc', 0.88);
  const crumb = (y0, y1) => {
    P.c.fillStyle = '#f2e4c0'; P.c.fillRect(-GUTTER, y1, w + 2 * GUTTER, y0 - y1);
    for (let k = 0; k < (y0 - y1) * 3; k++) haze(P.c, rnd() * w, y1 + rnd() * (y0 - y1), 5 + rnd() * 12, pick(rnd, ['#e6d2a4', '#faf0d6']), 0.3);
    for (let k = 0; k < (y0 - y1) * 9; k++) {
      const x = rnd() * w, y = y1 + rnd() * (y0 - y1), r = 0.5 + rnd() * rnd() * 3, rot = rnd() * 3;
      P.c.fillStyle = rgba(pick(rnd, ['#dcc698', '#e4d0a4', '#d4bc8c']), 0.45); P.c.beginPath(); P.c.ellipse(x, y, r * 1.5, r, rot, 0, TAU); P.c.fill();
      P.c.fillStyle = rgba('#fff8e4', 0.5); P.c.beginPath(); P.c.ellipse(x + 0.5, y + r * 0.7, r * 1.2, r * 0.35, rot, 0, TAU); P.c.fill();
      P.h.fillStyle = grey(0.42, 0.3); P.h.beginPath(); P.h.ellipse(x, y, r * 1.5, r, rot, 0, TAU); P.h.fill();
    }
  };
  for (const L of stack) {
    const y0 = Y(L.y0), y1 = Y(L.y1), band = (colour, rough) => { P.c.fillStyle = colour; P.c.fillRect(-GUTTER, y1, w + 2 * GUTTER, y0 - y1); P.m.fillStyle = orm(rough); P.m.fillRect(-GUTTER, y1, w + 2 * GUTTER, y0 - y1); };
    if (L.type === 'bunBottom') {
      crumb(y0 + GUTTER, y1);
      vertical(P.c, w, h, [[0, rgba('#c58a45', 0)], [(y0 - 5) / h, rgba('#c58a45', 0)], [(y0 - 1.5) / h, rgba('#c08440', 0.95)], [1, '#b67a3a']]);
      P.c.fillStyle = rgba('#cf9a52', 0.85); P.c.fillRect(-GUTTER, y1, w + 12, 2.2);
    } else if (L.type === 'bunTop') {
      crumb(y0, -GUTTER);
      P.c.fillStyle = rgba('#cf9a52', 0.85); P.c.fillRect(-GUTTER, y0 - 2.4, w + 12, 2.4);
      // the house sauce pressed out under the crown
      P.c.fillStyle = '#e9a070';
      for (let x = -6; x < w + 6; x += 5 + rnd() * 9) { P.c.beginPath(); P.c.ellipse(x, y0 - 0.5, 3 + rnd() * 5, 1.2 + rnd() * 1.6, 0, 0, TAU); P.c.fill(); }
    } else if (L.type === 'patty') {
      band('#7b5241', 0.55);
      const k = P.c.createLinearGradient(0, y1, 0, y0);
      k.addColorStop(0, rgba('#2f1c10', 0.95)); k.addColorStop(0.16, rgba('#4a2c1c', 0.5)); k.addColorStop(0.32, rgba('#b07c6c', 0.35)); k.addColorStop(0.5, rgba('#bb8676', 0.6)); k.addColorStop(0.68, rgba('#b07c6c', 0.35)); k.addColorStop(0.84, rgba('#4a2c1c', 0.5)); k.addColorStop(1, rgba('#2f1c10', 0.95));
      P.c.fillStyle = k; P.c.fillRect(-GUTTER, y1, w + 12, y0 - y1);
      for (let j = 0; j < 380; j++) {
        const x = rnd() * w, y = y1 + 2 + rnd() * (y0 - y1 - 4), r = 0.7 + rnd() * 2;
        blob(P.c, rnd, x, y, r, { jitter: 0.5, n: 6, squash: 0.7 }); P.c.fillStyle = rgba(pick(rnd, ['#5a3626', '#946454', '#86584a', '#a87868', '#6a4232']), 0.42); P.c.fill();
        P.h.globalAlpha = 0.35; dot(P.h, x, y, r, grey(0.3 + rnd() * 0.4)); P.h.globalAlpha = 1;
      }
      for (let j = 0; j < 26; j++) { const x = rnd() * w, y = y1 + 3 + rnd() * (y0 - y1 - 6); dot(P.c, x, y, 0.8, rgba('#e8c8b8', 0.6)); dot(P.m, x, y, 2, orm(0.25)); }
    } else if (L.type === 'cheese') {
      band('#f4a51f', 0.33);
      P.c.fillStyle = rgba('#ffc85a', 0.7); P.c.fillRect(-GUTTER, y1, w + 12, 1.2);
      for (let x = rnd() * 20; x < w; x += 14 + rnd() * 30) { P.c.fillStyle = '#f4a51f'; P.c.beginPath(); P.c.roundRect(x, y0 - 1, 3 + rnd() * 4, 3 + rnd() * 6, 2); P.c.fill(); }
    } else if (L.type === 'tomato') {
      band('#cf3a24', 0.3);
      P.c.fillStyle = rgba('#e8684a', 0.75); P.c.fillRect(-GUTTER, y1 + (y0 - y1) * 0.26, w + 12, (y0 - y1) * 0.48);
      for (let x = rnd() * 16; x < w; x += 18 + rnd() * 26) {
        const cw = 6 + rnd() * 5;
        P.c.fillStyle = rgba('#f3a070', 0.85); P.c.beginPath(); P.c.ellipse(x, (y0 + y1) / 2, cw, (y0 - y1) * 0.26, 0, 0, TAU); P.c.fill();
        for (let j = 0; j < 3; j++) dot(P.c, x + (rnd() - 0.5) * cw * 1.3, (y0 + y1) / 2 + (rnd() - 0.5) * 2, 0.8, '#f3e2a0');
      }
      P.c.fillStyle = rgba('#a82216', 0.9); P.c.fillRect(-GUTTER, y1, w + 12, 1); P.c.fillRect(-GUTTER, y0 - 1, w + 12, 1);
    } else if (L.type === 'lettuce') {
      band('#7fb23a', 0.5);
      for (const [off, col, lw] of [[0.3, '#c6e481', 1.4], [0.7, '#5c9428', 1.2]]) {
        P.c.strokeStyle = col; P.c.lineWidth = lw; P.c.beginPath();
        for (let x = -6; x < w + 6; x += 2) { const y = y1 + (y0 - y1) * off + Math.sin(x * 0.33 + off * 9) * (y0 - y1) * 0.22; if (x === -6) P.c.moveTo(x, y); else P.c.lineTo(x, y); }
        P.c.stroke();
      }
    }
  }
};

PAINT.foilOpen = (P, w, h, rnd) => {
  ground(P, w, h, '#e9cd84', 0.36, 0.5);
  facets(P, rnd, w, h, 260, 22, '#fff6d2', '#8f6d1c', 0.9);
  for (let k = 0; k < 46; k++) {
    const x = rnd() * w, y = rnd() * h, a = rnd() * TAU, l = 20 + rnd() * 70, dx = Math.cos(a) * l, dy = Math.sin(a) * l;
    line(P.c, x, y, x + dx, y + dy, rgba('#fff3c4', 0.5), 1); line(P.c, x + 1.2, y + 1.2, x + dx + 1.2, y + dy + 1.2, rgba('#8f6d1c', 0.35), 1);
    line(P.h, x, y, x + dx, y + dy, grey(0.95, 0.7), 2);
  }
  for (let k = 0; k < 7; k++) { const x = w / 2 + (rnd() - 0.5) * w * 0.5, y = h / 2 + (rnd() - 0.5) * h * 0.5, r = 14 + rnd() * 30; haze(P.c, x, y, r, '#b98a2a', 0.22); haze(P.m, x, y, r, [0, 60, 100], 0.5); }
};
PAINT.foilWrap = (P, w, h, rnd) => {
  const cx = w / 2, cy = h / 2;
  ground(P, w, h, '#d9a636', 0.34, 0.6);
  facets(P, rnd, w, h, 300, 20, '#ffeeb0', '#7a5a14', 1);
  // the folds gathered underneath
  for (let k = 0; k < 34; k++) {
    const a = rnd() * TAU, r0 = w * (0.3 + rnd() * 0.08), r1 = w * 0.52;
    line(P.c, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, rgba(k % 2 ? '#fff0b8' : '#7a5a14', 0.5), 1.4);
    line(P.h, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, grey(k % 2 ? 0.9 : 0.15, 0.7), 2.4);
  }
  // the stamp
  brandEmblem(P.c, 'bullion', cx, cy - 8, 74, { tone: 'ink', color: B.black });
  brandWordmark(P.c, 'bullion', cx, cy + 40, 13, { tone: 'ink', color: B.black });
  P.m.fillStyle = orm(0.6, 0.1, 0.7); P.m.beginPath(); P.m.arc(cx, cy, 44, 0, TAU); P.m.fill();
};

PAINT.fry = (P, w, h, rnd) => {
  ground(P, w, h, '#ecbe5c', 0.62);
  for (let v = 0; v < 3; v++) {
    const x0 = v * w / 3, cw = w / 3, deep = pick(rnd, ['#d49a3c', '#cf9236', '#dba646']);
    const k = P.c.createLinearGradient(x0, 0, x0 + cw, 0);
    k.addColorStop(0, deep); k.addColorStop(0.2, '#ecbe5c'); k.addColorStop(0.5, v === 1 ? '#f8dc8a' : '#f4d279'); k.addColorStop(0.8, '#ecbe5c'); k.addColorStop(1, deep);
    P.c.fillStyle = k; P.c.fillRect(x0, -GUTTER, cw, h + 2 * GUTTER);
    const t = P.c.createLinearGradient(0, 0, 0, h);
    t.addColorStop(0, rgba('#b0722a', 0.8)); t.addColorStop(0.07, rgba('#c08432', 0.3)); t.addColorStop(0.22, rgba('#c08432', 0)); t.addColorStop(0.9, rgba('#b97a2a', 0)); t.addColorStop(1, rgba('#a8691f', 0.5));
    P.c.fillStyle = t; P.c.fillRect(x0, -GUTTER, cw, h + 2 * GUTTER);
    for (let j = 0; j < 46; j++) { const x = x0 + rnd() * cw, y = rnd() * h, r = 0.6 + rnd() * 2; dot(P.c, x, y, r, rgba(pick(rnd, ['#f8e09a', '#b9782a', '#f2cd72', '#a8691f']), 0.4 + rnd() * 0.3)); }
    for (let j = 0; j < 30; j++) { const x = x0 + rnd() * cw, y = rnd() * h; dot(P.c, x, y, 0.5, rgba('#fffdf4', 0.75)); } // salt
  }
  grain(P, rnd, w, h, 500, 0.8, 2.2, 0.3);
};

// fries heaped, seen from above
PAINT.friesPile = (P, w, h, rnd) => {
  ground(P, w, h, '#6a3f12', 0.62);
  for (let k = 0; k < 90; k++) {
    const x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI, l = 30 + rnd() * 50, wd = 8 + rnd() * 3, lift = k / 90;
    for (const [c, mode] of [[P.c, 0], [P.h, 1]]) {
      c.save(); c.translate(x, y); c.rotate(a);
      if (mode === 0) {
        c.fillStyle = rgba('#3d2409', 0.55); c.fillRect(-l / 2 - 1, -wd / 2 + 2, l + 2, wd + 2);
        const k2 = c.createLinearGradient(0, -wd / 2, 0, wd / 2);
        k2.addColorStop(0, '#c88d31'); k2.addColorStop(0.3, '#eec061'); k2.addColorStop(0.7, '#e3ad47'); k2.addColorStop(1, '#b97a2a');
        c.fillStyle = k2; c.beginPath(); c.roundRect(-l / 2, -wd / 2, l, wd, 1.6); c.fill();
        c.fillStyle = rgba('#a8691f', 0.6); c.fillRect(-l / 2, -wd / 2, 4, wd); c.fillRect(l / 2 - 4, -wd / 2, 4, wd);
      } else { c.fillStyle = grey(0.3 + lift * 0.6); c.beginPath(); c.roundRect(-l / 2, -wd / 2, l, wd, 1.6); c.fill(); }
      c.restore();
    }
  }
  scatter(P.c, rnd, w, h, 160, ['#fffdf4'], 0.4, 0.8, 0.7);
};

PAINT.cartonFront = (P, w, h, rnd) => {
  ground(P, w, h, '#17130f', 0.5);
  scatter(P.c, rnd, w, h, 200, ['#221d18', '#0f0c0a'], 0.6, 2, 0.5);
  brandEmblem(P.c, 'bullion', w / 2, h * 0.5, 58);
  brandWordmark(P.c, 'bullion', w / 2, h * 0.8, 11.5);
  line(P.c, 18, h * 0.9, w - 18, h * 0.9, rgba(B.gold, 0.9), 1.4);
  P.m.fillStyle = orm(0.38, 0.35); P.m.beginPath(); P.m.arc(w / 2, h * 0.5, 30, 0, TAU); P.m.fill();
};
PAINT.cartonBack = (P, w, h, rnd) => {
  ground(P, w, h, '#17130f', 0.5);
  scatter(P.c, rnd, w, h, 200, ['#221d18', '#0f0c0a'], 0.6, 2, 0.5);
  for (let x = 10; x < w; x += 12) line(P.c, x, -6, x, h + 6, rgba(B.gold, 0.16), 1);
  P.c.fillStyle = '#17130f'; P.c.fillRect(8, h * 0.44, w - 16, 40);
  text(P.c, 'PÉPITES', w / 2, h * 0.53, `900 19px "Arial Black", ${SANS}`, B.gold, { spacing: 3 });
  text(P.c, 'dorées à la graisse de bœuf', w / 2, h * 0.69, `italic 8.5px ${SERIF}`, B.goldPale);
};
PAINT.cartonIn = (P, w, h, rnd) => {
  ground(P, w, h, '#d6cdbc', 0.8);
  scatter(P.c, rnd, w, h, 14, ['#b89e68', '#c7b083'], 5, 14, 0.25, 0.5, true);
  scatter(P.m, rnd, w, h, 10, [[0, 90, 0]], 5, 12, 0.6, 0.8, true);
  scatter(P.c, rnd, w, h, 60, ['#fffdf4', '#b98a3a'], 0.4, 1, 0.8);
  vertical(P.c, w, h, [[0, rgba('#000000', 0)], [1, rgba('#3a2a12', 0.5)]]);
};

PAINT.cupWrap = (P, w, h, rnd) => {
  ground(P, w, h, '#17130f', 0.5);
  scatter(P.c, rnd, w, h, 300, ['#211c17', '#100d0b'], 0.6, 2, 0.5);
  for (const y of [9, h - 10]) { line(P.c, -6, y, w + 6, y, B.gold, 2.2); line(P.c, -6, y + (y < 20 ? 5 : -5), w + 6, y + (y < 20 ? 5 : -5), rgba(B.gold, 0.6), 0.8); line(P.m, -6, y, w + 6, y, orm(0.36, 0.4), 3); }
  brandEmblem(P.c, 'bullion', w / 2, h * 0.42, 84);
  brandWordmark(P.c, 'bullion', w / 2, h * 0.76, 21);
  P.m.fillStyle = orm(0.38, 0.35); P.m.beginPath(); P.m.ellipse(w / 2, h * 0.5, 70, 62, 0, 0, TAU); P.m.fill();
  // round the back, across the seam
  for (const x of [0, w]) { text(P.c, '« La valeur refuge. »', x, h * 0.46, `italic 19px ${SERIF}`, B.goldPale); text(P.c, 'DEPUIS 1971', x, h * 0.62, `700 9px ${SANS}`, rgba(B.gold, 0.9), { spacing: 3 }); }
  line(P.c, w * 0.2, -6, w * 0.2, h + 6, rgba('#000000', 0.5), 1); line(P.h, w * 0.2, -6, w * 0.2, h + 6, grey(0.7), 2);
};

PAINT.cupLid = (P, w, h, rnd) => {
  const cx = w / 2, cy = h / 2, R = w / 2;
  ground(P, w, h, '#f1f0ec', 0.3);
  radial(P.c, w, h, cx, cy, R, [[0, '#f6f5f2'], [0.5, '#f1f0ec'], [0.74, '#e4e3df'], [0.82, '#f4f3f0'], [1, '#e6e5e1']]);
  const ring = (q, dark, lw = 2) => {
    P.c.strokeStyle = rgba(dark ? '#aeaca6' : '#ffffff', dark ? 0.7 : 0.9); P.c.lineWidth = lw; P.c.beginPath(); P.c.arc(cx, cy, q * R, 0, TAU); P.c.stroke();
    P.h.strokeStyle = grey(dark ? 0.2 : 0.85, 0.9); P.h.lineWidth = lw + 1; P.h.beginPath(); P.h.arc(cx, cy, q * R, 0, TAU); P.h.stroke();
  };
  ring(0.2, true); ring(0.225, false, 1.4); ring(0.5, true, 1.6); ring(0.74, true, 2.4); ring(0.775, false, 1.6); ring(0.93, true, 1.6);
  // the straw's slot and three push buttons
  dot(P.c, cx, cy, 6, '#8a8882'); dot(P.c, cx, cy, 4, '#3a3833');
  for (let k = 0; k < 3; k++) {
    const a = 0.6 + k * TAU / 3, x = cx + Math.cos(a) * R * 0.36, y = cy + Math.sin(a) * R * 0.36;
    dot(P.c, x, y, 7.5, rgba('#b9b7b1', 0.8)); dot(P.c, x - 0.8, y - 0.8, 6, '#f7f6f3'); dot(P.h, x, y, 7.5, grey(0.86)); dot(P.h, x, y, 5, grey(0.95));
  }
  scatter(P.m, rnd, w, h, 60, [[0, 110, 0]], 3, 9, 0.2, 0.4, true);
};

PAINT.straw = (P, w, h) => {
  ground(P, w, h, B.cream, 0.4);
  P.c.fillStyle = B.oxblood;
  for (let y = -40; y < h + 40; y += 22) { P.c.beginPath(); P.c.moveTo(-8, y); P.c.lineTo(w + 8, y + 26); P.c.lineTo(w + 8, y + 37); P.c.lineTo(-8, y + 11); P.c.closePath(); P.c.fill(); }
};
PAINT.paper = (P, w, h, rnd) => { ground(P, w, h, '#f1eee6', 0.9); scatter(P.c, rnd, w, h, 160, ['#e6e2d8', '#faf8f2'], 0.5, 1.6, 0.5); };

function kraft(P, w, h, rnd) {
  ground(P, w, h, '#c39a63', 0.9);
  vertical(P.c, w, h, [[0, rgba('#d3ab74', 0.5)], [1, rgba('#a8824e', 0.45)]]);
  P.c.lineCap = 'round';
  for (let k = 0; k < w * h / 55; k++) {
    const x = rnd() * w, y = rnd() * h, a = (rnd() - 0.5) * 0.7 + (rnd() < 0.5 ? 0 : Math.PI / 2), l = 3 + rnd() * 9;
    line(P.c, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, rgba(pick(rnd, ['#dcb983', '#a47c48', '#b68c56', '#e3c594']), 0.35), 0.7);
  }
  scatter(P.c, rnd, w, h, w * h / 220, ['#8f6a3a', '#e6cb9c'], 0.4, 1, 0.5);
}
function crease(P, x0, y0, x1, y1, strength = 1) {
  line(P.c, x0, y0, x1, y1, rgba('#8a6534', 0.5 * strength), 1.2); line(P.c, x0 + 1.4, y0 + 1.4, x1 + 1.4, y1 + 1.4, rgba('#e8cfa2', 0.55 * strength), 1);
  line(P.h, x0, y0, x1, y1, grey(0.15, 0.9 * strength), 2.4);
}
PAINT.bagFront = (P, w, h, rnd) => {
  kraft(P, w, h, rnd);
  crease(P, -6, h * 0.66, w + 6, h * 0.66, 0.8); crease(P, w * 0.06, -6, w * 0.06, h + 6, 0.5); crease(P, w * 0.94, -6, w * 0.94, h + 6, 0.5);
  // the paper patch that holds the handle
  P.c.fillStyle = rgba('#b08a55', 0.9); P.c.fillRect(w * 0.24, 6, w * 0.52, 26);
  P.c.strokeStyle = rgba('#8a6534', 0.5); P.c.lineWidth = 1; P.c.strokeRect(w * 0.24, 6, w * 0.52, 26);
  const ink = rgba(B.black, 0.9);
  P.c.globalAlpha = 0.9;
  brandEmblem(P.c, 'bullion', w / 2, h * 0.4, 118, { tone: 'ink', color: B.black });
  brandWordmark(P.c, 'bullion', w / 2, h * 0.645, 31, { tone: 'ink', color: B.black });
  P.c.globalAlpha = 1;
  text(P.c, '« La valeur refuge. »', w / 2, h * 0.76, `italic 17px ${SERIF}`, ink);
  line(P.c, w * 0.3, h * 0.82, w * 0.7, h * 0.82, ink, 1.2);
  text(P.c, 'À EMPORTER · BURGERS EN BARRES DEPUIS 1971', w / 2, h * 0.87, `700 7.5px ${SANS}`, ink, { spacing: 1.1 });
  // grease coming through at the bottom
  for (let k = 0; k < 4; k++) { const x = w * (0.2 + rnd() * 0.6), y = h * (0.9 + rnd() * 0.08), r = 10 + rnd() * 16; haze(P.c, x, y, r, '#8f6a3a', 0.4); haze(P.m, x, y, r, [0, 120, 0], 0.7); }
};
PAINT.kraft = (P, w, h, rnd) => { kraft(P, w, h, rnd); crease(P, w / 2, -6, w / 2, h + 6); crease(P, -6, h * 0.66, w + 6, h * 0.66, 0.7); };
PAINT.bagHandle = (P, w, h, rnd) => {
  ground(P, w, h, '#b88f58', 0.9);
  for (let x = -20; x < w + 20; x += 7) { line(P.c, x, -6, x + 12, h + 6, rgba('#7d5c30', 0.7), 1.6); line(P.c, x + 3, -6, x + 15, h + 6, rgba('#e0c08c', 0.6), 1.2); line(P.h, x, -6, x + 12, h + 6, grey(0.15, 0.9), 2.4); }
};
PAINT.bagInside = (P, w, h) => { ground(P, w, h, '#4a3520', 0.95); vertical(P.c, w, h, [[0, '#8a683e'], [0.35, '#5a4026'], [1, '#20150b']]); };

function squeezeBottle(P, w, h, rnd, body, light, dark) {
  ground(P, w, h, body, 0.36);
  const k = P.c.createLinearGradient(0, 0, w, 0);
  k.addColorStop(0, rgba(dark, 0.4)); k.addColorStop(0.3, rgba(light, 0.55)); k.addColorStop(0.42, rgba(light, 0)); k.addColorStop(0.8, rgba(dark, 0)); k.addColorStop(1, rgba(dark, 0.4));
  wash(P.c, w, h, k);
  vertical(P.c, w, h, [[0, rgba(light, 0.25)], [0.22, rgba(light, 0)], [0.9, rgba(dark, 0)], [1, rgba(dark, 0.5)]]);
  // where the cap screws on, and the dried sauce at the tip
  line(P.c, -6, h * 0.19, w + 6, h * 0.19, rgba(dark, 0.8), 1.6); line(P.c, -6, h * 0.235, w + 6, h * 0.235, rgba(dark, 0.6), 1.2);
  line(P.h, -6, h * 0.19, w + 6, h * 0.19, grey(0.15), 2); line(P.h, -6, h * 0.235, w + 6, h * 0.235, grey(0.2), 2);
  P.c.fillStyle = rgba(dark, 0.75); P.c.fillRect(-6, -6, w + 12, 9 + rnd() * 3);
  scatter(P.m, rnd, w, h, 20, [[0, 130, 0]], 4, 10, 0.2, 0.4, true);
}
PAINT.sauceRed = (P, w, h, rnd) => squeezeBottle(P, w, h, rnd, '#c2281a', '#f0705c', '#6e120b');
PAINT.sauceYellow = (P, w, h, rnd) => squeezeBottle(P, w, h, rnd, '#e2ad1f', '#f8dc7a', '#946a0c');

PAINT.steel = (P, w, h, rnd) => {
  ground(P, w, h, '#b9bcbe', 0.3, 0.6);
  vertical(P.c, w, h, [[0, '#e6e8e9'], [0.18, '#b4b8ba'], [0.4, '#f1f2f2'], [0.56, '#989da0'], [0.62, '#c3c6c8'], [0.8, '#d9dbdc'], [1, '#a7abad']]);
  for (let k = 0; k < 260; k++) { const y = rnd() * h; line(P.c, -6, y, w + 6, y, rgba(rnd() < 0.5 ? '#ffffff' : '#50555a', 0.07), 0.6); }
  for (let k = 0; k < 60; k++) { const y = rnd() * h; line(P.m, -6, y, w + 6, y, orm(0.2 + rnd() * 0.25, 0.6, 0.4), 1); }
};
PAINT.napkinFace = (P, w, h, rnd) => {
  ground(P, w, h, '#c3c6c8', 0.3, 0.6);
  vertical(P.c, w, h, [[0, '#dfe1e2'], [0.5, '#c0c4c6'], [1, '#a2a6a9']]);
  for (let k = 0; k < 160; k++) { const y = rnd() * h; line(P.c, -6, y, w + 6, y, rgba(rnd() < 0.5 ? '#ffffff' : '#50555a', 0.07), 0.6); }
  // the window: napkins seen through it
  const x0 = 20, y0 = 26, ww = w - 40, wh = h - 50;
  for (const [c, style] of [[P.c, '#5c6063'], [P.m, orm(0.9, 0)], [P.h, grey(0.2)]]) { c.fillStyle = style; c.beginPath(); c.roundRect(x0 - 2, y0 - 2, ww + 4, wh + 4, 9); c.fill(); }
  P.c.fillStyle = '#f3f1ec'; P.c.beginPath(); P.c.roundRect(x0, y0, ww, wh, 8); P.c.fill();
  const k = P.c.createLinearGradient(0, y0, 0, y0 + wh);
  k.addColorStop(0, rgba('#000000', 0.45)); k.addColorStop(0.22, rgba('#000000', 0.06)); k.addColorStop(1, rgba('#000000', 0));
  P.c.fillStyle = k; P.c.beginPath(); P.c.roundRect(x0, y0, ww, wh, 8); P.c.fill();
  for (let y = y0 + 9; y < y0 + wh - 2; y += 5) line(P.c, x0 + 3, y, x0 + ww - 3, y, rgba('#a9a59c', 0.55), 0.8);
  P.c.strokeStyle = rgba('#ffffff', 0.8); P.c.lineWidth = 1.2; P.c.beginPath(); P.c.roundRect(x0 - 3, y0 - 3, ww + 6, wh + 6, 10); P.c.stroke();
  text(P.c, 'BULLION', w / 2, 13, `900 8px "Arial Black", ${SANS}`, rgba('#3a3d40', 0.8), { spacing: 2 });
};
PAINT.napkin = (P, w, h, rnd) => {
  ground(P, w, h, '#f5f3ee', 0.92);
  for (let y = 4; y < h; y += 5) for (let x = 4 + (y % 10 ? 0 : 2.5); x < w; x += 5) { dot(P.c, x, y, 0.7, rgba('#d9d5cb', 0.8)); dot(P.h, x, y, 1.1, grey(0.25, 0.8)); }
  line(P.c, -6, h * 0.5, w + 6, h * 0.5, rgba('#cfcbc0', 0.9), 1); line(P.h, -6, h * 0.5, w + 6, h * 0.5, grey(0.2), 2);
};
PAINT.wire = (P, w, h, rnd) => {
  // a fryer basket's side: the fries behind, the wires in front
  ground(P, w, h, '#4a300f', 0.6);
  for (let k = 0; k < 70; k++) {
    const x = rnd() * w, y = h * 0.28 + rnd() * h * 0.8, a = rnd() * Math.PI, l = 22 + rnd() * 36;
    P.c.save(); P.c.translate(x, y); P.c.rotate(a); P.c.fillStyle = rgba('#2a1906', 0.6); P.c.fillRect(-l / 2, -3, l, 9);
    P.c.fillStyle = pick(rnd, ['#d9a440', '#c8912f', '#e6b552', '#b98026']); P.c.beginPath(); P.c.roundRect(-l / 2, -4, l, 8, 1.5); P.c.fill(); P.c.restore();
  }
  vertical(P.c, w, h, [[0, rgba('#1a1208', 0.9)], [0.3, rgba('#1a1208', 0.55)], [0.42, rgba('#1a1208', 0)], [1, rgba('#1a1208', 0.25)]]);
  for (let k = 0; k <= 16; k++) {
    const q = k / 16;
    for (const [x0, y0, x1, y1] of [[q * w, -6, q * w, h + 6], [-6, q * h, w + 6, q * h]]) {
      line(P.c, x0 + 0.8, y0 + 0.8, x1 + 0.8, y1 + 0.8, rgba('#1a1208', 0.7), 2.2); line(P.c, x0, y0, x1, y1, '#b9bdc0', 1.7); line(P.c, x0 - 0.4, y0 - 0.4, x1 - 0.4, y1 - 0.4, rgba('#f4f5f5', 0.8), 0.6);
      line(P.m, x0, y0, x1, y1, orm(0.3, 0.6), 2.4); line(P.h, x0, y0, x1, y1, grey(0.95), 2.4);
    }
  }
};

// ---- TRANCHE -------------------------------------------------------------------------------------------------------
// A place on a pie's tile: q along the unrolled profile (0 the centre, 1 the crust's foot) at the angle a
const pieSpot = (w, a, q) => [w / 2 + w / 2 * PIE.scale * q * Math.sin(a), w / 2 + w / 2 * PIE.scale * q * Math.cos(a)];
// a wavy closed ring round the centre, the same on every canvas it is traced on
function ringOf(w, q, rnd, wave = 0.008) {
  const R = w / 2 * PIE.scale, ph = [rnd() * 6, rnd() * 6, rnd() * 6, rnd() * 6, rnd() * 6];
  return (c) => {
    c.beginPath();
    for (let k = 0; k <= 200; k++) {
      const a = k / 200 * TAU, r = R * (q + wave * (Math.sin(2 * a + ph[4]) * 0.3 + Math.sin(5 * a + ph[0]) * 0.3 + Math.sin(9 * a + ph[1]) * 0.2 + Math.sin(17 * a + ph[2]) * 0.12 + Math.sin(31 * a + ph[3]) * 0.08));
      if (k === 0) c.moveTo(w / 2 + r * Math.sin(a), w / 2 + r * Math.cos(a)); else c.lineTo(w / 2 + r * Math.sin(a), w / 2 + r * Math.cos(a));
    }
    c.closePath();
  };
}
const inDisc = (rnd, w, q) => { const a = rnd() * TAU, r = Math.sqrt(rnd()) * q; return pieSpot(w, a, r); };

// The crust: pale at its foot, browned over the top, blistered black where the oven caught it
function paintCrust(P, w, h, rnd, raw) {
  const c = w / 2, R = c * PIE.scale, q = PIE.q;
  ground(P, w, h, raw ? '#e6d5ae' : '#ead0a0', raw ? 0.9 : 0.86);
  radial(P.c, w, h, c, c, R, raw
    ? [[0, '#ead9b2'], [q[6], '#eadab2'], [q[4], '#f1e5c6'], [q[3], '#f3e8cb'], [q[1], '#ebdcb8'], [1, '#e0cda2']]
    : [[0, '#d6a157'], [q[6] - 0.02, '#cf9549'], [q[5], '#d9a55a'], [q[4], '#d29648'], [q[3], '#bf813b'], [q[2], '#d39c52'], [q[1], '#e7c589'], [1, '#edd6a8']]);
  const onRim = (lo, hi) => pieSpot(w, rnd() * TAU, lo + rnd() * (hi - lo));
  if (raw) {
    for (let k = 0; k < 260; k++) { const [x, y] = onRim(q[6], 1); haze(P.c, x, y, 5 + rnd() * 12, pick(rnd, ['#f8f0dc', '#dcc898']), 0.25); }
    for (let k = 0; k < 1500; k++) { const [x, y] = onRim(q[6], 1); dot(P.c, x, y, 0.4 + rnd() * 0.9, rgba('#fffaf0', 0.6)); }
    return;
  }
  for (let k = 0; k < 520; k++) { const [x, y] = onRim(q[6] - 0.01, 1); haze(P.c, x, y, 4 + rnd() * 12, pick(rnd, ['#b4722e', '#ebca90', '#a5642a', '#dcae66']), 0.1 + rnd() * 0.16); }
  // the big bubbles of the rim
  for (let k = 0; k < 30; k++) {
    const [x, y] = onRim(q[4], q[2]), r = 10 + rnd() * 13;
    haze(P.h, x, y, r, [255, 255, 255], 0.55); haze(P.c, x, y, r * 0.8, '#f2d59c', 0.22);
    if (rnd() < 0.6) { blob(P.c, rnd, x, y, r * 0.45, { jitter: 0.35 }); P.c.fillStyle = rgba('#3a1f0c', 0.7); P.c.fill(); haze(P.c, x, y, r * 0.9, '#6e3d16', 0.35); }
  }
  // leopard spots: in clusters where a bubble met the flame, freckles everywhere else
  for (let k = 0; k < 64; k++) {
    const a = rnd() * TAU, qq = q[4] - 0.012 + rnd() * (q[2] + 0.028 - q[4]), n = 2 + (rnd() * 7 | 0), spread = 4 + rnd() * 12;
    for (let j = 0; j < n; j++) {
      const [x0, y0] = pieSpot(w, a, qq), x = x0 + (rnd() - 0.5) * 2 * spread, y = y0 + (rnd() - 0.5) * 2 * spread, r = 1.2 + rnd() * rnd() * 8;
      haze(P.c, x, y, r * 2.6, '#8a5220', 0.34);
      blob(P.c, rnd, x, y, r, { jitter: 0.45, n: 8, squash: 0.6 + rnd() * 0.4, rot: rnd() * 3 }); P.c.fillStyle = rgba('#5a3414', 0.5 + rnd() * 0.25); P.c.fill();
      if (r > 2.6) { blob(P.c, rnd, x, y, r * 0.6, { jitter: 0.45, n: 7 }); P.c.fillStyle = rgba('#2c180a', 0.45 + rnd() * 0.3); P.c.fill(); }
      haze(P.h, x, y, r * 1.5, [255, 255, 255], 0.35);
    }
  }
  for (let k = 0; k < 420; k++) { const [x, y] = onRim(q[5], q[1]), r = 0.7 + rnd() * 1.8; haze(P.c, x, y, r * 2.2, pick(rnd, ['#7a441a', '#96602a']), 0.3 + rnd() * 0.25); }
  for (let k = 0; k < 900; k++) { const [x, y] = onRim(q[3], 1); dot(P.c, x, y, 0.4 + rnd() * 0.8, rgba('#fbf1da', 0.45)); } // flour
  for (let k = 0; k < 1600; k++) { const [x, y] = onRim(q[6], 1); dot(P.c, x, y, 0.4 + rnd() * 0.9, rgba(pick(rnd, ['#9a5c26', '#f0d6a2']), 0.25)); P.h.globalAlpha = 0.5; dot(P.h, x, y, 0.8 + rnd() * 1.4, grey(0.5 + (rnd() - 0.5) * 0.5)); P.h.globalAlpha = 1; }
}

function paintSauce(P, w, rnd, raw) {
  const ring = ringOf(w, PIE.q[6] + 0.014, rnd, 0.007), c = w / 2, R = c * PIE.scale;
  ring(P.c); P.c.strokeStyle = rgba(raw ? '#b02a16' : '#d0702c', raw ? 0.3 : 0.4); P.c.lineWidth = 7; P.c.stroke(); // oil creeping up the crust
  ring(P.c); P.c.fillStyle = raw ? '#c93620' : '#a82a15'; P.c.fill();
  ring(P.m); P.m.fillStyle = orm(raw ? 0.36 : 0.4); P.m.fill();
  ring(P.h); P.h.fillStyle = grey(0.44); P.h.fill();
  P.c.save(); ring(P.c); P.c.clip();
  for (let k = 0; k < 420; k++) { const [x, y] = inDisc(rnd, w, PIE.q[6] + 0.02); haze(P.c, x, y, 5 + rnd() * 16, pick(rnd, raw ? ['#dd4a2c', '#b52a14', '#e65a36'] : ['#c63f22', '#8a1e0d', '#cf5026', '#9b2410', '#7a1a0b']), 0.14 + rnd() * 0.16); }
  for (let k = 0; k < 900; k++) { const [x, y] = inDisc(rnd, w, PIE.q[6] + 0.02); dot(P.c, x, y, 0.5 + rnd() * 1.2, rgba(pick(rnd, ['#e8683c', '#7a180a', '#f0a070']), 0.3)); }
  P.c.restore();
  if (!raw) { ring(P.c); P.c.strokeStyle = rgba('#6e180a', 0.55); P.c.lineWidth = 3.5; P.c.stroke(); }
}

// Melted mozzarella the New York way: nearly edge to edge, pale where it lies thick, deep gold where the fat ran,
// bubbled all over, blistered brown where a bubble met the heat
function paintCheese(P, w, rnd, { edge, base, pale, gold, deep, holes, blisters, oil = 1 }) {
  const ring = ringOf(w, edge, rnd, 0.05), R = w / 2 * PIE.scale;
  ring(P.c); P.c.strokeStyle = rgba('#b9742c', 0.75); P.c.lineWidth = 5; P.c.stroke();
  ring(P.c); P.c.fillStyle = base; P.c.fill();
  ring(P.m); P.m.fillStyle = orm(0.34); P.m.fill();
  ring(P.h); P.h.fillStyle = grey(0.52); P.h.fill();
  for (const c of [P.c, P.m, P.h]) { c.save(); ring(c); c.clip(); }
  const any = (most = edge + 0.03) => inDisc(rnd, w, most);
  for (let k = 0; k < 70 * oil; k++) { const [x, y] = any(); haze(P.c, x, y, 26 + rnd() * 46, deep, 0.2 + rnd() * 0.2); }
  for (let k = 0; k < 110; k++) { const [x, y] = any(); haze(P.c, x, y, 12 + rnd() * 30, pale, 0.3 + rnd() * 0.3); }
  for (let k = 0; k < 260; k++) { const [x, y] = any(); haze(P.c, x, y, 5 + rnd() * 15, pick(rnd, [gold, gold, deep, pale]), 0.2 + rnd() * 0.2); }
  for (let k = 0; k < 110 * oil; k++) { const [x, y] = any(), r = 6 + rnd() * 20; haze(P.c, x, y, r, '#e06e22', 0.12 + rnd() * 0.14); haze(P.m, x, y, r, [0, 34, 0], 0.6); }
  // the swell of the melt
  for (let k = 0; k < 120; k++) { const [x, y] = any(), r = 8 + rnd() * 20; haze(P.h, x, y, r, rnd() < 0.5 ? [255, 255, 255] : [0, 0, 0], 0.24); }
  // small bubbles: a darker rim, a pale skin
  for (let k = 0; k < 1100; k++) {
    const [x, y] = any(), r = 1.3 + rnd() * 3.4;
    P.c.strokeStyle = rgba('#c0802e', 0.22 + rnd() * 0.2); P.c.lineWidth = 0.9; P.c.beginPath(); P.c.arc(x, y, r, 0, TAU); P.c.stroke();
    dot(P.c, x - r * 0.2, y - r * 0.2, r * 0.6, rgba('#fbeab4', 0.22));
    haze(P.h, x, y, r * 1.3, [255, 255, 255], 0.3);
  }
  // sauce showing through
  for (let k = 0; k < holes; k++) {
    const [x, y] = pieSpot(w, rnd() * TAU, edge * (0.25 + 0.75 * Math.pow(rnd(), 0.45))), r = 3 + rnd() * 10;
    haze(P.c, x, y, r * 2, '#c2441c', 0.4); blob(P.c, rnd, x, y, r, { jitter: 0.5, squash: 0.5 + rnd() * 0.5, rot: rnd() * 3 }); P.c.fillStyle = rgba('#a52c15', 0.7); P.c.fill();
    haze(P.h, x, y, r * 1.3, [0, 0, 0], 0.4);
  }
  // blisters
  for (let k = 0; k < blisters; k++) {
    const [x, y] = any(edge), r = 1.6 + rnd() * rnd() * 9;
    haze(P.c, x, y, r * 2.4, '#d08a36', 0.36);
    blob(P.c, rnd, x, y, r, { jitter: 0.4, n: 8, squash: 0.65 + rnd() * 0.35, rot: rnd() * 3 }); P.c.fillStyle = rgba('#b46c26', 0.55 + rnd() * 0.2); P.c.fill();
    if (r > 2.4) { blob(P.c, rnd, x, y, r * 0.6, { jitter: 0.45, n: 7 }); P.c.fillStyle = rgba('#8a4a17', 0.55); P.c.fill(); }
    if (r > 4.5) { blob(P.c, rnd, x, y, r * 0.32, { jitter: 0.45, n: 6 }); P.c.fillStyle = rgba('#4f280c', 0.6); P.c.fill(); }
    haze(P.h, x, y, r * 1.8, [255, 255, 255], 0.5); haze(P.m, x, y, r * 1.2, [0, 160, 0], 0.8);
  }
  for (let k = 0; k < 520; k++) { const [x, y] = any(edge); dot(P.c, x, y, 0.5 + rnd() * 0.8, rgba(pick(rnd, ['#4a5a22', '#6b4a1e', '#3a3a1a']), 0.5)); } // oregano
  for (const c of [P.c, P.m, P.h]) c.restore();
}

function paintPepperoni(P, rnd, x, y, r) {
  haze(P.c, x, y, r * 1.75, '#e8702a', 0.3); haze(P.m, x, y, r * 1.6, [0, 36, 0], 0.6);
  blob(P.c, rnd, x + 1, y + 1.2, r * 1.04, { jitter: 0.05, n: 14 }); P.c.fillStyle = rgba('#6a2a0c', 0.28); P.c.fill();
  blob(P.c, rnd, x, y, r, { jitter: 0.055, n: 14 });
  const k = P.c.createRadialGradient(x, y, 0, x, y, r), crisp = rnd();
  k.addColorStop(0, crisp > 0.6 ? '#a23a1e' : '#b4482a'); k.addColorStop(0.55, crisp > 0.6 ? '#93301a' : '#a53a20'); k.addColorStop(0.84, '#832815'); k.addColorStop(1, '#6a2110');
  P.c.fillStyle = k; P.c.fill();
  for (let j = 0; j < 9; j++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * r * 0.75; haze(P.c, x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.15 + rnd() * 0.2), pick(rnd, ['#c9603a', '#7a2210', '#be5230', '#d87a4a']), 0.35); }
  // the edge that curled up and charred
  const a0 = rnd() * TAU;
  P.c.strokeStyle = rgba('#3a1006', 0.5); P.c.lineWidth = r * 0.13; P.c.beginPath(); P.c.arc(x, y, r * 0.93, a0, a0 + 1.4 + rnd() * 2.4); P.c.stroke();
  for (let j = 0; j < 14; j++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * r * 0.8; dot(P.c, x + Math.cos(a) * d, y + Math.sin(a) * d, 0.6 + rnd() * 1.3, rgba(pick(rnd, ['#de8068', '#e9a088', '#6a160c']), 0.5)); }
  // oil pooled in the cup, and its glint
  const ox = x + (rnd() - 0.5) * r * 0.5, oy = y + (rnd() - 0.5) * r * 0.5;
  haze(P.c, ox, oy, r * 0.55, '#e8823a', 0.34);
  P.c.fillStyle = rgba('#ffe6c4', 0.4); P.c.beginPath(); P.c.ellipse(ox - r * 0.12, oy - r * 0.16, r * 0.15, r * 0.06, -0.6, 0, TAU); P.c.fill();
  dot(P.m, x, y, r, orm(0.4)); dot(P.m, ox, oy, r * 0.45, orm(0.16));
  dot(P.h, x, y, r * 1.02, grey(0.44)); P.h.strokeStyle = grey(0.74, 0.9); P.h.lineWidth = r * 0.24; P.h.beginPath(); P.h.arc(x, y, r * 0.87, 0, TAU); P.h.stroke();
}

function paintLeaf(P, x, y, len, wid, rot, dark, mid, rib, baked) {
  for (const c of [P.c, P.m, P.h]) { c.save(); c.translate(x, y); c.rotate(rot); }
  const shape = (c, grow = 0) => { c.beginPath(); c.moveTo(0, -len / 2 - grow); c.bezierCurveTo(wid * 0.78 + grow, -len * 0.26, wid * 0.6 + grow, len * 0.32, 0, len / 2 + grow); c.bezierCurveTo(-wid * 0.6 - grow, len * 0.32, -wid * 0.78 - grow, -len * 0.26, 0, -len / 2 - grow); };
  if (baked) { shape(P.c, 2.5); P.c.fillStyle = rgba('#3a2a0a', 0.3); P.c.fill(); }
  shape(P.c);
  const k = P.c.createLinearGradient(-wid * 0.6, 0, wid * 0.6, 0);
  k.addColorStop(0, dark); k.addColorStop(0.45, mid); k.addColorStop(0.55, mid); k.addColorStop(1, dark);
  P.c.fillStyle = k; P.c.fill();
  P.c.strokeStyle = rgba(rib, 0.8); P.c.lineWidth = 1; P.c.beginPath(); P.c.moveTo(0, -len / 2); P.c.lineTo(0, len / 2);
  for (let j = -3; j <= 3; j++) { if (!j) continue; const yy = j * len / 9; P.c.moveTo(0, yy); P.c.lineTo(wid * 0.45, yy - len * 0.09); P.c.moveTo(0, yy); P.c.lineTo(-wid * 0.45, yy - len * 0.09); }
  P.c.stroke();
  shape(P.m); P.m.fillStyle = orm(baked ? 0.4 : 0.48); P.m.fill();
  shape(P.h); P.h.fillStyle = grey(0.66); P.h.fill(); P.h.strokeStyle = grey(0.3); P.h.lineWidth = 1.6; P.h.beginPath(); P.h.moveTo(0, -len / 2); P.h.lineTo(0, len / 2); P.h.stroke();
  for (const c of [P.c, P.m, P.h]) c.restore();
}

// the eight cuts of the wheel
function paintCuts(P, w, rnd) {
  for (let k = 0; k < 4; k++) {
    const a = k * SLICE, n = 40, pts = [];
    for (let j = 0; j <= n; j++) { const q = -0.995 + 1.99 * j / n, [x, y] = pieSpot(w, a, q), off = Math.sin(j * 0.9 + k * 2) * 0.7; pts.push([x + Math.cos(a) * off, y - Math.sin(a) * off]); }
    const trace = (c, dx = 0, dy = 0) => { c.beginPath(); pts.forEach(([x, y], j) => (j ? c.lineTo(x + dx, y + dy) : c.moveTo(x + dx, y + dy))); c.stroke(); };
    P.c.strokeStyle = rgba('#5a2408', 0.42); P.c.lineWidth = 1.7; trace(P.c);
    P.c.strokeStyle = rgba('#fff1cf', 0.22); P.c.lineWidth = 1; trace(P.c, 1.3, 1.3);
    P.h.strokeStyle = grey(0.08, 0.9); P.h.lineWidth = 2.8; trace(P.h);
    P.m.strokeStyle = orm(0.3, 0, 0.6); P.m.lineWidth = 2; trace(P.m);
  }
}
const pixelsPerMetre = (w) => w / 2 * PIE.scale / PIE.total;

PAINT.piePepperoni = (P, w, h, rnd) => {
  const ppm = pixelsPerMetre(w), spot = (t) => pieSpot(w, t.a, t.r / PIE.total);
  paintCrust(P, w, h, rnd, false);
  paintSauce(P, w, rnd, false);
  paintCheese(P, w, rnd, { edge: PIE.q[6] - 0.022, base: '#edc874', pale: '#f9eab6', gold: '#e4ac4a', deep: '#dd8f34', holes: 56, blisters: 250 });
  for (const t of TOPPINGS.sausage) {
    const [x, y] = spot(t), r = 0.0062 * t.size * ppm;
    haze(P.c, x, y, r * 2, '#b9702a', 0.3);
    blob(P.c, rnd, x, y, r, { jitter: 0.4, n: 8 }); P.c.fillStyle = '#7d4a2b'; P.c.fill();
    for (let j = 0; j < 7; j++) dot(P.c, x + (rnd() - 0.5) * r * 1.4, y + (rnd() - 0.5) * r * 1.4, 0.6 + rnd(), rgba(pick(rnd, ['#4a2814', '#a8704a', '#c79068']), 0.7));
    haze(P.h, x, y, r * 1.4, [255, 255, 255], 0.75); dot(P.m, x, y, r, orm(0.6));
  }
  for (const t of TOPPINGS.pepperoni) { const [x, y] = spot(t); paintPepperoni(P, rnd, x, y, 0.0158 * t.size * ppm); }
  paintCuts(P, w, rnd);
};

PAINT.pieMargherita = (P, w, h, rnd) => {
  const ppm = pixelsPerMetre(w), spot = (t) => pieSpot(w, t.a, t.r / PIE.total);
  paintCrust(P, w, h, rnd, false);
  paintSauce(P, w, rnd, false);
  // a thin veil of grated cheese melted into the sauce, then the rounds of fresh mozzarella
  for (let k = 0; k < 260; k++) { const [x, y] = inDisc(rnd, w, PIE.q[6] - 0.03), r = 6 + rnd() * 16; haze(P.c, x, y, r, pick(rnd, ['#e9a04a', '#f0c070', '#de8a3a']), 0.16 + rnd() * 0.14); }
  for (let k = 0; k < 90; k++) { const [x, y] = inDisc(rnd, w, PIE.q[6] - 0.02), r = 8 + rnd() * 18; haze(P.m, x, y, r, [0, 46, 0], 0.5); haze(P.c, x, y, r * 0.6, '#f0803a', 0.12); }
  for (const t of TOPPINGS.mozzarella) {
    const [x, y] = spot(t), r = 0.0235 * t.size * ppm;
    haze(P.c, x, y, r * 1.5, '#f3cf8c', 0.6);
    const lump = (c, k, style) => { blob(c, seeded(Math.round(t.turn * 1000)), x, y, r * k, { jitter: 0.24, n: 11 }); c.fillStyle = style; c.fill(); };
    lump(P.c, 1, '#f6ecd2'); lump(P.c, 0.72, '#fbf6e6'); lump(P.m, 1, orm(0.34)); 
    haze(P.h, x, y, r * 1.25, [255, 255, 255], 0.5);
    for (let j = 0; j < 5; j++) { const a = rnd() * TAU, d = rnd() * r * 0.8, s = 1.5 + rnd() * 4; haze(P.c, x + Math.cos(a) * d, y + Math.sin(a) * d, s * 2, '#d99a45', 0.4); if (rnd() < 0.5) { blob(P.c, rnd, x + Math.cos(a) * d, y + Math.sin(a) * d, s, { jitter: 0.4, n: 7 }); P.c.fillStyle = rgba('#a8672a', 0.55); P.c.fill(); haze(P.h, x + Math.cos(a) * d, y + Math.sin(a) * d, s * 1.6, [255, 255, 255], 0.5); } }
    haze(P.c, x - r * 0.2, y - r * 0.25, r * 0.5, '#ffffff', 0.35);
  }
  for (let k = 0; k < 400; k++) { const [x, y] = inDisc(rnd, w, PIE.q[6] - 0.02); dot(P.c, x, y, 0.5 + rnd() * 0.9, rgba(pick(rnd, ['#f6e7b8', '#3f5a22', '#f2d28a']), 0.55)); }
  for (const t of TOPPINGS.basil) { const [x, y] = spot(t); paintLeaf(P, x, y, 0.036 * t.size * ppm, 0.021 * t.size * ppm, -t.turn, '#23451f', '#3b6a30', '#7fa862', true); }
  paintCuts(P, w, rnd);
};

PAINT.pieBianca = (P, w, h, rnd) => {
  const ppm = pixelsPerMetre(w), spot = (t) => pieSpot(w, t.a, t.r / PIE.total);
  paintCrust(P, w, h, rnd, false);
  // no sauce: oil and garlic under the cheese
  const ring = ringOf(w, PIE.q[6] + 0.012, rnd, 0.007);
  ring(P.c); P.c.fillStyle = '#dcbf7c'; P.c.fill(); ring(P.m); P.m.fillStyle = orm(0.34); P.m.fill();
  paintCheese(P, w, rnd, { edge: PIE.q[6] - 0.008, base: '#f1dfa8', pale: '#fcf5dc', gold: '#e8c070', deep: '#dba651', holes: 0, blisters: 420, oil: 0.5 });
  for (const t of TOPPINGS.garlic) {
    const [x, y] = spot(t), r = 0.006 * t.size * ppm;
    P.c.save(); P.c.translate(x, y); P.c.rotate(t.turn); P.c.fillStyle = rgba('#c9a25a', 0.8); P.c.beginPath(); P.c.ellipse(0, 0, r * 1.25, r * 0.8, 0, 0, TAU); P.c.fill();
    P.c.fillStyle = '#f4e6bd'; P.c.beginPath(); P.c.ellipse(0, 0, r, r * 0.6, 0, 0, TAU); P.c.fill(); P.c.restore();
    dot(P.h, x, y, r, grey(0.7, 0.7));
  }
  for (const t of TOPPINGS.ricotta) {
    const [x, y] = spot(t), r = 0.0195 * t.size * ppm;
    haze(P.c, x, y, r * 1.7, '#b8944e', 0.4);
    blob(P.c, seeded(Math.round(t.turn * 999)), x, y, r, { jitter: 0.16, n: 10 }); P.c.fillStyle = '#f9f5e8'; P.c.fill();
    haze(P.c, x - r * 0.2, y - r * 0.2, r * 0.6, '#ffffff', 0.5); dot(P.m, x, y, r, orm(0.55));
  }
  for (let k = 0; k < 700; k++) { const [x, y] = inDisc(rnd, w, PIE.q[6] - 0.02), a = rnd() * TAU; line(P.c, x, y, x + Math.cos(a) * 2.2, y + Math.sin(a) * 2.2, rgba(pick(rnd, ['#3f6a22', '#5c8a30', '#2f4f1a']), 0.75), 1.1); } // parsley
  for (let k = 0; k < 420; k++) { const [x, y] = inDisc(rnd, w, PIE.q[6] - 0.02); dot(P.c, x, y, 0.5 + rnd() * 0.7, rgba('#2a2018', 0.7)); } // pepper
  paintCuts(P, w, rnd);
};

PAINT.pieRaw = (P, w, h, rnd) => {
  const ppm = pixelsPerMetre(w), spot = (t) => pieSpot(w, t.a, t.r / PIE.total);
  paintCrust(P, w, h, rnd, true);
  paintSauce(P, w, rnd, true);
  // torn mozzarella, not yet melted
  for (const t of TOPPINGS.mozzarella) {
    const [x, y] = spot(t), r = 0.019 * t.size * ppm, shape = (c, dx, dy, style) => { blob(c, seeded(Math.round(t.turn * 777)), x + dx, y + dy, r, { jitter: 0.3, n: 9, squash: 0.75, rot: t.turn }); c.fillStyle = style; c.fill(); };
    shape(P.c, 1.5, 2, rgba('#7a1c0c', 0.35)); shape(P.c, 0, 0, '#f4efe2'); shape(P.m, 0, 0, orm(0.5)); shape(P.h, 0, 0, grey(0.78));
    haze(P.c, x - r * 0.2, y - r * 0.2, r * 0.7, '#ffffff', 0.5);
  }
  for (const t of TOPPINGS.basil) { const [x, y] = spot(t); paintLeaf(P, x, y, 0.036 * t.size * ppm, 0.021 * t.size * ppm, -t.turn, '#2f7a34', '#4c9c46', '#a6d090', false); }
};

PAINT.basil = (P, w, h) => {
  ground(P, w, h, '#2a5024', 0.42);
  paintLeaf(P, w / 2, h / 2, h * 1.12, w * 0.78, 0, '#23451f', '#3d6e31', '#86ad68', false);
};
PAINT.ricotta = (P, w, h, rnd) => {
  ground(P, w, h, '#f8f4e6', 0.55);
  scatter(P.c, rnd, w, h, 40, ['#e6dcc0', '#ffffff'], 4, 10, 0.2, 0.45, true);
  scatter(P.h, rnd, w, h, 50, [[255, 255, 255], [0, 0, 0]], 3, 8, 0.2, 0.4, true);
  for (let k = 0; k < 5; k++) haze(P.c, w / 2 + (rnd() - 0.5) * 14, h / 2 + (rnd() - 0.5) * 14, 3 + rnd() * 4, '#d9ae62', 0.5);
  scatter(P.c, rnd, w, h, 26, ['#2a2018', '#4a6a26'], 0.5, 1, 0.7);
  radial(P.c, w, h, w / 2, h / 2, w / 2, [[0, rgba('#b99a5a', 0)], [0.8, rgba('#b99a5a', 0)], [1, rgba('#a8843e', 0.5)]]);
};

PAINT.aluTray = (P, w, h, rnd) => {
  const c = w / 2, R = c * 0.97;
  ground(P, w, h, '#b6b9bb', 0.42, 0.72);
  const k = P.c.createConicGradient(0.5, c, c);
  for (const [at, col] of [[0, '#dadcdd'], [0.11, '#a7abae'], [0.24, '#e7e9e9'], [0.38, '#b1b5b7'], [0.5, '#dddfe0'], [0.63, '#a3a7aa'], [0.76, '#eaebeb'], [0.89, '#aeb2b4'], [1, '#dadcdd']]) k.addColorStop(at, col);
  wash(P.c, w, h, k);
  for (let j = 0; j < 220; j++) { P.c.strokeStyle = rgba(rnd() < 0.5 ? '#ffffff' : '#4a4f54', 0.07); P.c.lineWidth = 0.7; P.c.beginPath(); P.c.arc(c, c, rnd() * R, 0, TAU); P.c.stroke(); }
  for (const [q, col, lw] of [[0.955, rgba('#6f7478', 0.6), 2], [0.975, rgba('#f6f7f7', 0.85), 2], [0.995, rgba('#7b8084', 0.6), 1.5]]) { P.c.strokeStyle = col; P.c.lineWidth = lw; P.c.beginPath(); P.c.arc(c, c, R * q, 0, TAU); P.c.stroke(); }
  // the wheel's scratches, years of them
  for (let j = 0; j < 90; j++) {
    const a = rnd() * Math.PI, off = (rnd() - 0.5) * R * 0.5, l = R * (0.5 + rnd() * 0.4), x = c + Math.cos(a + 1.57) * off, y = c + Math.sin(a + 1.57) * off;
    line(P.c, x - Math.cos(a) * l, y - Math.sin(a) * l, x + Math.cos(a) * l, y + Math.sin(a) * l, rgba(rnd() < 0.6 ? '#f2f3f3' : '#6a6f73', 0.3), 0.7);
    line(P.h, x - Math.cos(a) * l, y - Math.sin(a) * l, x + Math.cos(a) * l, y + Math.sin(a) * l, grey(0.25, 0.5), 1.4);
  }
  // what a pie leaves: oil, crumbs, semolina
  for (let j = 0; j < 26; j++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * R * 0.88, r = 8 + rnd() * 30, x = c + Math.cos(a) * d, y = c + Math.sin(a) * d; haze(P.c, x, y, r, pick(rnd, ['#b88a34', '#c9a04a', '#a8742a']), 0.26); haze(P.m, x, y, r, [0, 46, 120], 0.7); }
  for (let j = 0; j < 700; j++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * R * 0.9; dot(P.c, c + Math.cos(a) * d, c + Math.sin(a) * d, 0.5 + rnd() * 0.6, rgba('#f0dca0', 0.7)); }
  for (let j = 0; j < 170; j++) {
    const a = rnd() * TAU, d = Math.sqrt(rnd()) * R * 0.9, x = c + Math.cos(a) * d, y = c + Math.sin(a) * d, r = 0.9 + rnd() * rnd() * 4;
    blob(P.c, rnd, x + 0.8, y + 0.8, r, { jitter: 0.4, n: 6 }); P.c.fillStyle = rgba('#3a3020', 0.35); P.c.fill();
    blob(P.c, rnd, x, y, r, { jitter: 0.4, n: 6 }); P.c.fillStyle = pick(rnd, ['#c9964e', '#a8672a', '#e3c58f', '#5a3414', '#d8ae66']); P.c.fill();
    dot(P.m, x, y, r + 0.5, orm(0.85, 0)); dot(P.h, x, y, r, grey(0.9));
  }
};

PAINT.plate = (P, w, h, rnd) => {
  const c = w / 2, R = c * 0.975;
  ground(P, w, h, '#efede6', 0.92);
  radial(P.c, w, h, c, c, R, [[0, '#f6f4ee'], [0.6, '#f4f2eb'], [0.665, '#e4e1d8'], [0.71, '#f3f1ea'], [0.93, '#eeece5'], [0.955, '#fcfbf8'], [1, '#e6e3db']]);
  for (let k = 0; k < 110; k++) {
    const a = k / 110 * TAU, x0 = c + Math.sin(a) * R * 0.7, y0 = c + Math.cos(a) * R * 0.7, x1 = c + Math.sin(a) * R * 0.99, y1 = c + Math.cos(a) * R * 0.99;
    line(P.c, x0, y0, x1, y1, rgba(k % 2 ? '#ffffff' : '#b9b5a8', 0.5), 2); line(P.h, x0, y0, x1, y1, grey(k % 2 ? 0.9 : 0.1, 0.9), 3);
  }
  scatter(P.c, rnd, w, h, 500, ['#e2dfd6', '#fbfaf6'], 0.5, 1.4, 0.4);
  // the grease a slice leaves: its shadow in oil, a few drops, crumbs
  const k = R / 0.1168, tri = [[0, 0.1], [0.082, -0.068], [-0.082, -0.068]];
  for (let j = 0; j < 90; j++) {
    let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const x = c + (tri[0][0] + (tri[1][0] - tri[0][0]) * u + (tri[2][0] - tri[0][0]) * v) * k, y = c + (tri[0][1] + (tri[1][1] - tri[0][1]) * u + (tri[2][1] - tri[0][1]) * v) * k, r = 12 + rnd() * 18;
    haze(P.c, x, y, r, pick(rnd, ['#d2b560', '#c9a84e', '#dcc27a']), 0.13); haze(P.m, x, y, r, [0, 96, 0], 0.4);
  }
  for (let j = 0; j < 12; j++) { const x = c + (rnd() - 0.5) * R * 0.9, y = c + (rnd() - 0.5) * R * 0.9, r = 2.5 + rnd() * 5; haze(P.c, x, y, r * 1.6, '#e0962e', 0.5); dot(P.m, x, y, r, orm(0.2)); }
  for (let j = 0; j < 26; j++) { const x = c + (rnd() - 0.5) * R * 1.1, y = c + (rnd() - 0.5) * R * 1.1, r = 0.8 + rnd() * 2.6; blob(P.c, rnd, x, y, r, { jitter: 0.4, n: 6 }); P.c.fillStyle = pick(rnd, ['#c9964e', '#a8672a', '#e3c58f', '#5a3414']); P.c.fill(); dot(P.h, x, y, r, grey(0.9)); }
};
PAINT.plateEdge = (P, w, h) => {
  ground(P, w, h, '#f0eee7', 0.92);
  for (let y = 0.8; y < h + 4; y += 1.62) { line(P.c, -6, y, w + 6, y, rgba('#b4b0a4', 0.75), 0.6); line(P.h, -6, y, w + 6, y, grey(0.15, 0.8), 0.9); }
  vertical(P.c, w, h, [[0, rgba('#000000', 0)], [1, rgba('#6a6558', 0.25)]]);
};

PAINT.crustUnder = (P, w, h, rnd) => {
  ground(P, w, h, '#d9b272', 0.9);
  radial(P.c, w, h, w / 2, h / 2, w / 2, [[0, '#dcb777'], [0.8, '#d4a964'], [0.95, '#c9964e'], [1, '#e2c48e']]);
  scatter(P.c, rnd, w, h, 380, ['#b9843f', '#e8cf9a', '#a8702f', '#caa05a'], 4, 14, 0.12, 0.3, true);
  for (let k = 0; k < 420; k++) { const x = rnd() * w, y = rnd() * h, r = 0.8 + rnd() * rnd() * 5; blob(P.c, rnd, x, y, r, { jitter: 0.4, n: 6 }); P.c.fillStyle = rgba(pick(rnd, ['#6a3c16', '#8f5a25', '#3a2010']), 0.6); P.c.fill(); }
  scatter(P.c, rnd, w, h, 2200, ['#f6ead0', '#f0dca6'], 0.4, 1, 0.5);
  grain(P, rnd, w, h, 1600, 0.8, 2.2, 0.3);
};

// The side of a cut: u from the centre of the pie to the crust's foot, v from the top of the rim down to the tray
PAINT.sliceCut = (P, w, h, rnd) => {
  ground(P, w, h, '#edd9a8', 0.86);
  // the flat of the slice: baked base, crumb, sauce, cheese, in the lowest fifth
  const y0 = h * (1 - (PIE.top - PIE.base) / 0.0208), x1 = w * 0.84;
  P.c.fillStyle = '#f0cc74'; P.c.fillRect(-6, -6, x1 + 6, y0 + 8);
  P.c.fillStyle = '#ecd9a8'; P.c.fillRect(-6, y0 + 2.2, w + 12, h - y0 + 6);
  P.c.fillStyle = '#b3341b'; P.c.fillRect(-6, y0 + 1.2, x1 + 6, 1.4);
  P.c.fillStyle = '#c08a42'; P.c.fillRect(-6, h - 1.6, w + 12, 8);
  P.m.fillStyle = orm(0.38); P.m.fillRect(-6, -6, x1 + 6, y0 + 8);
  // the rim: an airy crumb under a brown skin
  P.c.fillStyle = '#f1e0b2'; P.c.fillRect(x1 - 6, -6, w - x1 + 12, h + 4);
  for (let k = 0; k < 70; k++) {
    const x = x1 - 4 + rnd() * (w - x1 + 6), y = rnd() * (h - 3), r = 0.8 + rnd() * 3;
    P.c.fillStyle = rgba(pick(rnd, ['#cfae74', '#dcc088', '#b99558']), 0.85); P.c.beginPath(); P.c.ellipse(x, y, r * 1.4, r, rnd() * 3, 0, TAU); P.c.fill();
    P.h.fillStyle = grey(0.15, 0.85); P.h.beginPath(); P.h.ellipse(x, y, r * 1.4, r, 0, 0, TAU); P.h.fill();
  }
  for (let k = 0; k < 60; k++) dot(P.c, rnd() * x1, y0 + 3 + rnd() * (h - y0 - 5), 0.5 + rnd(), rgba('#cdb078', 0.8));
  const sk = P.c.createLinearGradient(w - 9, 0, w + 4, 0);
  sk.addColorStop(0, rgba('#b97a34', 0)); sk.addColorStop(1, rgba('#a8672a', 0.95));
  P.c.fillStyle = sk; P.c.fillRect(w - 9, -6, 16, h + 12);
};

PAINT.boxTop = (P, w, h, rnd) => {
  ground(P, w, h, T.cream, 0.88);
  for (let x = 0; x < w; x += 6) { line(P.c, x, -6, x, h + 6, rgba('#c9b792', 0.13), 2); line(P.h, x, -6, x, h + 6, grey(0.62, 0.35), 2.5); }
  scatter(P.c, rnd, w, h, 1400, ['#e9dcc0', '#fffaf0', '#d9c8a4'], 0.5, 1.5, 0.35);
  // checkered bands down both sides
  const sq = 13;
  for (const x0 of [26, w - 26 - 2 * sq]) for (let j = 0; j * sq < h - 52; j++) { P.c.fillStyle = T.tomato; P.c.fillRect(x0 + (j % 2) * sq, 26 + j * sq, sq, Math.min(sq, h - 52 - j * sq)); }
  P.c.strokeStyle = T.tomato; P.c.lineWidth = 3; P.c.strokeRect(14, 14, w - 28, h - 28);
  P.c.lineWidth = 1; P.c.strokeRect(20, 20, w - 40, h - 40);
  text(P.c, 'PIZZA À LA PART  ·  FOUR À SOLE', w / 2, h * 0.115, `700 11.5px ${SANS}`, T.basil, { spacing: 3 });
  brandEmblem(P.c, 'tranche', w / 2, h * 0.375, 196);
  brandWordmark(P.c, 'tranche', w / 2, h * 0.675, 58);
  text(P.c, '« Prenez votre part. »', w / 2, h * 0.805, `italic 28px ${SERIF}`, T.tomato);
  line(P.c, w * 0.3, h * 0.86, w * 0.7, h * 0.86, T.basil, 1.5);
  text(P.c, 'CHAUD DEVANT !  ·  TENIR À PLAT  ·  NE PAS RETOURNER', w / 2, h * 0.905, `700 8.5px ${SANS}`, rgba(T.charcoal, 0.8), { spacing: 1.6 });
  // steam vents and the grease that comes through
  for (const [x, y] of [[w * 0.2, h * 0.2], [w * 0.8, h * 0.2]]) { for (const c of [P.c, P.h]) { c.fillStyle = c === P.c ? '#2a2018' : grey(0.1); c.beginPath(); c.ellipse(x, y, 7, 3, 0, 0, TAU); c.fill(); } }
  for (let k = 0; k < 6; k++) { const x = w * (0.25 + rnd() * 0.5), y = h * (0.3 + rnd() * 0.5), r = 14 + rnd() * 30; haze(P.c, x, y, r, '#c9a65e', 0.2); haze(P.m, x, y, r, [0, 130, 0], 0.5); }
};
PAINT.boxSide = (P, w, h, rnd) => {
  ground(P, w, h, T.cream, 0.88);
  scatter(P.c, rnd, w, h, 300, ['#e9dcc0', '#fffaf0', '#d9c8a4'], 0.5, 1.4, 0.4);
  // the lid's edge: two liners and the flute between them
  const e = h * 0.3;
  P.c.fillStyle = '#8f7650'; P.c.fillRect(-6, 1.6, w + 12, e - 3.4);
  P.c.strokeStyle = '#e7d5ae'; P.c.lineWidth = 2; P.c.beginPath();
  for (let x = -6; x <= w + 6; x += 1) { const y = e / 2 + Math.sin(x * 0.9) * (e / 2 - 2.6); if (x === -6) P.c.moveTo(x, y); else P.c.lineTo(x, y); }
  P.c.stroke();
  for (let x = -6; x <= w + 6; x += 7) { P.h.fillStyle = grey(0.15, 0.9); P.h.fillRect(x, 2, 3.5, e - 4); }
  line(P.c, -6, 1, w + 6, 1, '#d9c7a0', 2.2); line(P.c, -6, e - 1, w + 6, e - 1, '#d9c7a0', 2.2);
  vertical(P.c, w, h, [[0, rgba('#000000', 0)], [0.3, rgba('#000000', 0)], [0.31, rgba('#3a2a12', 0.5)], [0.48, rgba('#3a2a12', 0)], [1, rgba('#3a2a12', 0.12)]]);
  brandWordmark(P.c, 'tranche', w / 2, h * 0.68, 13);
  for (const x of [w * 0.2, w * 0.8]) text(P.c, 'PIZZA À LA PART', x, h * 0.68, `700 6.5px ${SANS}`, T.basil, { spacing: 1.5 });
};
PAINT.boxInside = (P, w, h, rnd) => {
  ground(P, w, h, '#c9a56e', 0.92);
  for (let x = 0; x < w; x += 6) { line(P.c, x, -6, x, h + 6, rgba('#a8824c', 0.25), 2); line(P.h, x, -6, x, h + 6, grey(0.65, 0.4), 2.5); }
  scatter(P.c, rnd, w, h, 700, ['#b8905a', '#dcbc88', '#a47c48'], 0.5, 1.6, 0.4);
  // the ring a hot pie steams and sweats into the board
  for (let k = 0; k < 120; k++) { const a = rnd() * TAU, d = w * (0.28 + rnd() * 0.12), x = w / 2 + Math.cos(a) * d, y = h * 0.52 + Math.sin(a) * d * 0.82, r = 8 + rnd() * 16; haze(P.c, x, y, r, '#8f6a34', 0.14); haze(P.m, x, y, r, [0, 120, 0], 0.4); }
  scatter(P.c, rnd, w, h, 30, ['#e3c58f', '#a8672a'], 0.8, 2, 0.8);
};

PAINT.dough = (P, w, h, rnd) => {
  ground(P, w, h, '#ecdcb6', 0.84);
  scatter(P.c, rnd, w, h, 200, ['#f6ecd0', '#e0cc9c', '#f2e4c0'], 10, 34, 0.12, 0.28, true);
  scatter(P.h, rnd, w, h, 70, [[255, 255, 255], [0, 0, 0]], 12, 30, 0.1, 0.22, true);
  // bubbles under the skin
  for (let k = 0; k < 16; k++) { const x = rnd() * w, y = rnd() * h, r = 4 + rnd() * 9; haze(P.h, x, y, r, [255, 255, 255], 0.6); haze(P.c, x - 1, y - 1, r * 0.8, '#fbf4e0', 0.35); }
  // flour: drifts of it and loose specks
  scatter(P.c, rnd, w, h, 60, ['#fffcf4'], 10, 30, 0.14, 0.34, true);
  scatter(P.m, rnd, w, h, 60, [[0, 245, 0]], 10, 30, 0.3, 0.6, true);
  scatter(P.c, rnd, w, h, 2600, ['#fffdf6'], 0.4, 1.1, 0.55);
};

PAINT.wood = (P, w, h, rnd) => {
  ground(P, w, h, '#c59a60', 0.7);
  for (let k = 0; k < 420; k++) {
    const y = rnd() * h, x0 = rnd() * w, l = 60 + rnd() * 240, bend = (rnd() - 0.5) * 6;
    P.c.strokeStyle = rgba(pick(rnd, ['#a87c44', '#dcb680', '#b78a50', '#96692f']), 0.3); P.c.lineWidth = 0.7 + rnd() * 1.3;
    P.c.beginPath(); P.c.moveTo(x0, y); P.c.quadraticCurveTo(x0 + l / 2, y + bend, x0 + l, y + bend * 0.4); P.c.stroke();
  }
  grain(P, rnd, w, h, 500, 0.6, 1.4, 0.12);
  // the blade (right half): flour, scorch at the lip (bottom of the tile), a smear of sauce
  const bx = w / 2;
  P.c.save(); P.c.beginPath(); P.c.rect(bx, -6, w / 2 + 6, h + 12); P.c.clip();
  for (let k = 0; k < 40; k++) haze(P.c, bx + rnd() * w / 2, rnd() * h, 10 + rnd() * 28, '#fffaf0', 0.18 + rnd() * 0.16);
  for (let k = 0; k < 1200; k++) dot(P.c, bx + rnd() * w / 2, rnd() * h, 0.4 + rnd() * 0.9, rgba('#fffdf6', 0.6));
  for (let k = 0; k < 26; k++) haze(P.c, bx + rnd() * w / 2, h * (0.86 + rnd() * 0.16), 8 + rnd() * 20, '#4a2c12', 0.22);
  for (let k = 0; k < 3; k++) haze(P.c, bx + w * (0.1 + rnd() * 0.3), h * (0.3 + rnd() * 0.4), 5 + rnd() * 8, '#a8301a', 0.4);
  P.c.restore();
  // the handle (left half): darkened by hands towards its end
  const k = P.c.createLinearGradient(0, 0, bx, 0);
  k.addColorStop(0, rgba('#5a3a1a', 0.05)); k.addColorStop(1, rgba('#5a3a1a', 0.3));
  P.c.fillStyle = k; P.c.fillRect(-6, -6, bx + 6, h * 0.5);
  P.m.fillStyle = orm(0.5); P.m.fillRect(-6, -6, bx + 6, h * 0.5);
  // end grain
  P.c.fillStyle = '#b98c52'; P.c.fillRect(0, h * 0.62, w * 0.12, h * 0.14);
  for (let j = 0; j < 6; j++) { P.c.strokeStyle = rgba('#8a6030', 0.6); P.c.lineWidth = 0.8; P.c.beginPath(); P.c.arc(w * 0.06, h * 0.69 + 8, 4 + j * 3, Math.PI, TAU); P.c.stroke(); }
};

PAINT.can = (P, w, h, rnd) => {
  const red = '#c5271a', cream = T.cream, neck = h * 0.135, foot = h * 0.9;
  ground(P, w, h, red, 0.3, 0.5);
  // a cream band that swells where the name sits
  const band = (c, style) => { c.fillStyle = style; c.beginPath(); c.moveTo(-6, h * 0.5); for (let x = -6; x <= w + 6; x += 4) c.lineTo(x, h * 0.56 - 12 - 10 * Math.cos((x / w - 0.5) * TAU)); for (let x = w + 6; x >= -6; x -= 4) c.lineTo(x, h * 0.56 + 12 + 10 * Math.cos((x / w - 0.5) * TAU)); c.closePath(); c.fill(); };
  band(P.c, cream);
  for (const x of [w / 2, 0, w]) {
    P.c.save(); P.c.translate(x, h * 0.565); P.c.transform(1, 0, -0.18, 1, 0, 0);
    text(P.c, 'SODA', 0, 0, `900 ${x === w / 2 ? 34 : 24}px "Arial Black", ${SANS}`, red, { spacing: 3 });
    P.c.restore();
  }
  // the pie-chart mark: a disc with one share pulled out
  const mark = (x, y, r, col) => { P.c.fillStyle = col; P.c.beginPath(); P.c.moveTo(x, y); P.c.arc(x, y, r, -0.3, TAU - 1.25); P.c.closePath(); P.c.fill(); P.c.beginPath(); P.c.moveTo(x + r * 0.2, y - r * 0.22); P.c.arc(x + r * 0.2, y - r * 0.22, r, TAU - 1.13, TAU - 0.42); P.c.closePath(); P.c.fill(); };
  mark(w / 2, h * 0.265, 15, cream); mark(w * 0.12, h * 0.8, 6, cream); mark(w * 0.88, h * 0.8, 6, cream);
  text(P.c, 'BIEN FRAIS  ·  SANS DIVIDENDE', w / 2, h * 0.8, `700 8px ${SANS}`, cream, { spacing: 1.6 });
  text(P.c, '33 cl', w * 0.27, h * 0.27, `700 9px ${SANS}`, cream); text(P.c, 'BOISSON GAZEUSE', w * 0.75, h * 0.27, `700 6.5px ${SANS}`, cream, { spacing: 1 });
  for (const y of [neck + 7, foot - 7]) line(P.c, -6, y, w + 6, y, cream, 1.4);
  for (let k = 0; k < 40; k++) dot(P.c, rnd() * w, h * (0.34 + rnd() * 0.08), 0.8 + rnd() * 1.8, rgba(cream, 0.5)); // bubbles
  // bare aluminium at the neck and the foot
  for (const [y0, y1] of [[-6, neck], [foot, h + 6]]) {
    const k = P.c.createLinearGradient(0, y0, 0, y1);
    k.addColorStop(0, '#d6d8d9'); k.addColorStop(0.5, '#a9adb0'); k.addColorStop(1, '#c9cccd');
    P.c.fillStyle = k; P.c.fillRect(-6, y0, w + 12, y1 - y0); P.m.fillStyle = orm(0.3, 0.8); P.m.fillRect(-6, y0, w + 12, y1 - y0);
  }
  // one long highlight down the can, where a lamp would catch it
  const g2 = P.c.createLinearGradient(0, 0, w, 0);
  g2.addColorStop(0.3, rgba('#ffffff', 0)); g2.addColorStop(0.36, rgba('#ffffff', 0.16)); g2.addColorStop(0.42, rgba('#ffffff', 0)); g2.addColorStop(0.8, rgba('#000000', 0)); g2.addColorStop(0.9, rgba('#000000', 0.12)); g2.addColorStop(1, rgba('#000000', 0));
  wash(P.c, w, h, g2);
};
PAINT.canTop = (P, w, h, rnd) => {
  const c = w / 2, R = c * 0.96;
  ground(P, w, h, '#b9bcbe', 0.3, 0.8);
  const k = P.c.createConicGradient(1, c, c);
  for (const [at, col] of [[0, '#dfe1e2'], [0.2, '#a4a8ab'], [0.45, '#e9eaea'], [0.7, '#9da1a4'], [1, '#dfe1e2']]) k.addColorStop(at, col);
  wash(P.c, w, h, k);
  for (const [q, col, lw, hv] of [[0.92, rgba('#5f6468', 0.8), 2.5, 0.1], [0.97, rgba('#f8f9f9', 0.9), 1.6, 0.9], [0.8, rgba('#7b8084', 0.5), 1.2, 0.3]]) { P.c.strokeStyle = col; P.c.lineWidth = lw; P.c.beginPath(); P.c.arc(c, c, R * q, 0, TAU); P.c.stroke(); P.h.strokeStyle = grey(hv); P.h.lineWidth = lw + 1; P.h.beginPath(); P.h.arc(c, c, R * q, 0, TAU); P.h.stroke(); }
  // the scored mouth and the tab
  P.c.strokeStyle = rgba('#5f6468', 0.8); P.c.lineWidth = 1.2; P.c.beginPath(); P.c.ellipse(c, c + R * 0.36, R * 0.24, R * 0.3, 0, 0, TAU); P.c.stroke();
  for (const [cc, style] of [[P.c, '#8d9194'], [P.h, grey(0.9)]]) { cc.fillStyle = style; cc.beginPath(); cc.roundRect(c - R * 0.2, c - R * 0.5, R * 0.4, R * 0.66, R * 0.18); cc.fill(); }
  P.c.fillStyle = '#d5d7d8'; P.c.beginPath(); P.c.roundRect(c - R * 0.15, c - R * 0.45, R * 0.3, R * 0.56, R * 0.14); P.c.fill();
  P.c.fillStyle = '#4a4f54'; P.c.beginPath(); P.c.ellipse(c, c - R * 0.27, R * 0.085, R * 0.11, 0, 0, TAU); P.c.fill();
  dot(P.c, c, c + R * 0.02, R * 0.06, '#74797d');
};

// A glass shaker, painted: what is in it up to the fill line, bare glass above, the flutes of the glass, two long
// reflections. (The material is opaque: the "glass" is the picture of it.)
function paintShaker(P, w, h, rnd, base, flakes, fine) {
  const fill = h * 0.24;
  ground(P, w, h, base, 0.14);
  vertical(P.c, w, h, [[0, '#aab8b2'], [0.12, '#c6d1cc'], [fill / h - 0.005, '#9fb0a9'], [fill / h, base], [1, base]]);
  for (let k = 0; k < (fine ? 2600 : 1300); k++) {
    const x = rnd() * w, y = fill + rnd() * (h - fill), r = fine ? 0.5 + rnd() * 0.9 : 0.8 + rnd() * 2.2, col = pick(rnd, flakes);
    if (fine) dot(P.c, x, y, r, rgba(col, 0.8)); else { blob(P.c, rnd, x, y, r, { jitter: 0.5, n: 5, squash: 0.6, rot: rnd() * 3 }); P.c.fillStyle = rgba(col, 0.9); P.c.fill(); }
  }
  // the heap's own shade: darker at the bottom and against the fill line
  vertical(P.c, w, h, [[0, rgba('#000000', 0)], [fill / h, rgba('#000000', 0)], [fill / h + 0.01, rgba('#000000', 0.22)], [fill / h + 0.07, rgba('#000000', 0)], [0.88, rgba('#000000', 0)], [1, rgba('#000000', 0.3)]]);
  // flutes of the pressed glass
  for (let k = 0; k < 12; k++) {
    const x = (k + 0.5) / 12 * w;
    line(P.c, x, h * 0.3, x, h * 0.95, rgba('#ffffff', 0.22), 1.2); line(P.c, x + 2, h * 0.3, x + 2, h * 0.95, rgba('#10201a', 0.2), 1.2);
    line(P.h, x, h * 0.3, x, h * 0.95, grey(0.9, 0.8), 2.4);
  }
  // reflections and the thick foot
  const g2 = P.c.createLinearGradient(0, 0, w, 0);
  for (const [at, col] of [[0.1, rgba('#ffffff', 0)], [0.16, rgba('#ffffff', 0.5)], [0.2, rgba('#ffffff', 0.1)], [0.26, rgba('#ffffff', 0)], [0.62, rgba('#ffffff', 0)], [0.66, rgba('#ffffff', 0.26)], [0.7, rgba('#ffffff', 0)], [0.9, rgba('#000000', 0)], [0.97, rgba('#06120e', 0.25)], [1, rgba('#000000', 0)]]) g2.addColorStop(at, col);
  wash(P.c, w, h, g2);
  vertical(P.c, w, h, [[0, rgba('#ffffff', 0)], [0.93, rgba('#ffffff', 0)], [0.95, rgba('#e6efe9', 0.55)], [0.985, rgba('#7f918a', 0.5)], [1, rgba('#e6efe9', 0.4)]]);
  line(P.c, -6, fill, w + 6, fill, rgba('#ffffff', 0.35), 1);
}
PAINT.shakerOregano = (P, w, h, rnd) => paintShaker(P, w, h, rnd, '#5f6b33', ['#8a9a4a', '#4a5a26', '#a8a868', '#39451d', '#75803c', '#6a5a30'], false);
PAINT.shakerChili = (P, w, h, rnd) => paintShaker(P, w, h, rnd, '#a9321a', ['#d4532a', '#8a1f10', '#e6a046', '#c23c1e', '#f0c878', '#6e160c'], false);
PAINT.shakerCheese = (P, w, h, rnd) => paintShaker(P, w, h, rnd, '#e6d595', ['#f6ecc4', '#d6c27c', '#fbf5da', '#c9b468'], true);
PAINT.shakerTop = (P, w, h, rnd) => {
  const c = w / 2, R = c * 0.96;
  ground(P, w, h, '#b9bcbe', 0.24, 0.7);
  const k = P.c.createConicGradient(2, c, c);
  for (const [at, col] of [[0, '#eceded'], [0.14, '#9a9ea1'], [0.3, '#f4f5f5'], [0.5, '#a8acaf'], [0.66, '#e4e6e6'], [0.84, '#8f9396'], [1, '#eceded']]) k.addColorStop(at, col);
  wash(P.c, w, h, k);
  // the threaded band of the cap, then its perforated dome
  for (let j = 0; j < 80; j++) { const a = j / 80 * TAU; line(P.c, c + Math.cos(a) * R * 0.74, c + Math.sin(a) * R * 0.74, c + Math.cos(a) * R, c + Math.sin(a) * R, rgba(j % 2 ? '#ffffff' : '#3a3f44', 0.3), 1.2); line(P.h, c + Math.cos(a) * R * 0.74, c + Math.sin(a) * R * 0.74, c + Math.cos(a) * R, c + Math.sin(a) * R, grey(j % 2 ? 0.85 : 0.15, 0.8), 1.6); }
  P.c.strokeStyle = rgba('#5a5f64', 0.7); P.c.lineWidth = 1.6; P.c.beginPath(); P.c.arc(c, c, R * 0.72, 0, TAU); P.c.stroke();
  for (let ring = 0; ring < 3; ring++) for (let j = 0; j < (ring ? ring * 6 : 1); j++) {
    const a = j / (ring * 6 || 1) * TAU + ring * 0.3, d = ring * R * 0.2, x = c + Math.cos(a) * d, y = c + Math.sin(a) * d;
    dot(P.c, x + 0.5, y + 0.5, 3.1, rgba('#ffffff', 0.6)); dot(P.c, x, y, 2.7, '#1c1e20'); dot(P.m, x, y, 3.2, orm(0.8, 0)); dot(P.h, x, y, 3.4, grey(0.05));
  }
};

PAINT.cutter = (P, w, h, rnd) => {
  ground(P, w, h, '#b4b8ba', 0.3, 0.7);
  // the wheel: top-left three quarters
  const c = w * 0.375, R = c * 0.97;
  const k = P.c.createConicGradient(0.8, c, c);
  for (const [at, col] of [[0, '#e9eaeb'], [0.13, '#9da1a4'], [0.27, '#f3f4f4'], [0.45, '#a9adb0'], [0.6, '#e0e2e3'], [0.8, '#94989b'], [1, '#e9eaeb']]) k.addColorStop(at, col);
  P.c.fillStyle = k; P.c.fillRect(-6, -6, w * 0.75 + 6, h * 0.75 + 6);
  for (let j = 0; j < 60; j++) { P.c.strokeStyle = rgba(rnd() < 0.5 ? '#ffffff' : '#3a3f44', 0.09); P.c.lineWidth = 0.7; P.c.beginPath(); P.c.arc(c, c, rnd() * R, 0, TAU); P.c.stroke(); }
  P.c.strokeStyle = rgba('#fbfcfc', 0.9); P.c.lineWidth = 3; P.c.beginPath(); P.c.arc(c, c, R * 0.95, 0, TAU); P.c.stroke(); // the ground bevel
  P.c.strokeStyle = rgba('#6a6f73', 0.6); P.c.lineWidth = 1; P.c.beginPath(); P.c.arc(c, c, R * 0.89, 0, TAU); P.c.stroke();
  dot(P.c, c, c, R * 0.2, '#6f7478'); dot(P.c, c, c, R * 0.13, '#c9cccd'); dot(P.c, c, c, R * 0.05, '#4a4f54');
  for (let j = 0; j < 14; j++) haze(P.c, c + (rnd() - 0.5) * R * 1.6, c + (rnd() - 0.5) * R * 1.6, 3 + rnd() * 6, pick(rnd, ['#b0321a', '#e8b860']), 0.3); // sauce and cheese dried on
  // the handle: black plastic, ribbed
  for (const [cc, style] of [[P.c, '#1c1c1d'], [P.m, orm(0.5, 0)]]) { cc.fillStyle = style; cc.fillRect(w * 0.77, -6, w * 0.23 + 6, h + 12); }
  for (let y = 8; y < h * 0.7; y += 7) { line(P.c, w * 0.77, y, w + 6, y, rgba('#4a4a4c', 0.8), 1.2); line(P.h, w * 0.77, y, w + 6, y, grey(0.1), 2.5); }
  const g2 = P.c.createLinearGradient(w * 0.77, 0, w, 0);
  g2.addColorStop(0.2, rgba('#ffffff', 0)); g2.addColorStop(0.4, rgba('#ffffff', 0.16)); g2.addColorStop(0.6, rgba('#ffffff', 0));
  P.c.fillStyle = g2; P.c.fillRect(w * 0.77, -6, w * 0.23 + 6, h + 12);
  // the arm that holds the wheel: brushed steel (bottom-left)
  vertical(P.c, w, h, [[0, rgba('#000000', 0)], [0.77, rgba('#000000', 0)], [0.78, rgba('#ffffff', 0.25)], [0.9, rgba('#000000', 0.12)], [1, rgba('#ffffff', 0.1)]]);
};

// ---------------------------------------------------------------------------------------------------------------
// The atlas
// ---------------------------------------------------------------------------------------------------------------
function paintAtlas() {
  const make = (size) => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = size; return canvas; };
  const color = make(ATLAS), rough = make(DETAIL), relief = make(DETAIL);
  const P = { c: color.getContext('2d'), m: rough.getContext('2d'), h: relief.getContext('2d', { willReadFrequently: true }) };
  P.c.fillStyle = '#808080'; P.c.fillRect(0, 0, ATLAS, ATLAS);
  P.m.fillStyle = orm(0.7); P.m.fillRect(0, 0, DETAIL, DETAIL);
  P.h.fillStyle = grey(0.5); P.h.fillRect(0, 0, DETAIL, DETAIL);
  const k = DETAIL / ATLAS;
  P.m.setTransform(k, 0, 0, k, 0, 0); P.h.setTransform(k, 0, 0, k, 0, 0);
  let seed = 100;
  for (const [name] of TILE_LIST) {
    const tile = TILES[name], paint = PAINT[name];
    seed += 17;
    if (!paint) continue;
    for (const c of [P.c, P.m, P.h]) { c.save(); c.beginPath(); c.rect(tile.x - GUTTER, tile.y - GUTTER, tile.w + 2 * GUTTER, tile.h + 2 * GUTTER); c.clip(); c.translate(tile.x, tile.y); }
    paint(P, tile.w, tile.h, seeded(seed));
    for (const c of [P.c, P.m, P.h]) c.restore();
  }
  // the normal map, from the relief
  const src = P.h.getImageData(0, 0, DETAIL, DETAIL).data, normal = make(DETAIL), nc = normal.getContext('2d'), out = nc.createImageData(DETAIL, DETAIL), o = out.data;
  const H = (x, y) => src[((y < 0 ? 0 : y >= DETAIL ? DETAIL - 1 : y) * DETAIL + (x < 0 ? 0 : x >= DETAIL ? DETAIL - 1 : x)) * 4];
  const strength = 2.6 / 255;
  for (let y = 0; y < DETAIL; y++) for (let x = 0; x < DETAIL; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1)) * 0.25 * strength;
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1)) * 0.25 * strength;
    const l = 1 / Math.hypot(dx, dy, 1), i = (y * DETAIL + x) * 4;
    o[i] = (-dx * l * 0.5 + 0.5) * 255; o[i + 1] = (-dy * l * 0.5 + 0.5) * 255; o[i + 2] = (l * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  nc.putImageData(out, 0, 0);
  return { color, rough, normal, relief };
}

function atlasTexture(canvas, name, srgb) {
  const map = new THREE.CanvasTexture(canvas);
  map.name = `food/${name}`;
  map.flipY = false;
  map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = 8;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

const FOOD = { ready: false, material: null, geometry: {}, info: {}, maps: null, tiles: TILES, atlas: ATLAS };
let loading = null;

function loadFoodKit() {
  if (!loading) loading = (async () => {
    const { geometry, info } = buildFoodGeometries();
    const canvases = paintAtlas();
    FOOD.maps = { color: atlasTexture(canvases.color, 'colour', true), orm: atlasTexture(canvases.rough, 'orm', false), normal: atlasTexture(canvases.normal, 'normal', false) };
    FOOD.material = new THREE.MeshStandardNodeMaterial({ map: FOOD.maps.color, normalMap: FOOD.maps.normal, roughnessMap: FOOD.maps.orm, metalnessMap: FOOD.maps.orm, roughness: 1, metalness: 1 });
    FOOD.material.name = 'food';
    Object.assign(FOOD.geometry, geometry);
    Object.assign(FOOD.info, info);
    FOOD.ready = true;
    return FOOD;
  })();
  return loading;
}

function foodGeometry(name) { return FOOD.geometry[name] || null; }

export { loadFoodKit, FOOD, foodGeometry, buildFoodGeometries, buildFoodMeshes };
