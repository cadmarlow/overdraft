// Turns a grown skeleton into geometry at two levels of detail:
//   0  every branch as a tube, a pair of leaf-spray cards on every twig (cupped and drooping, never flat)
//   1  the thick wood only, and one cluster of three crossed cards per branch end
// Vertex layout (shared by both, and by the runtime):
//   position (3 f32, metres, tree frame), normal (3 f32), uv (2 f32: leaf atlas on cards, bark repeats on wood)
//   wind  (4 x 0..1): limb weight, limb phase, twig weight, twig phase
//   shade (4 x 0..1): sky occlusion, height / tree height, per-card random, 1 on leaves / 0 on wood

import { rng, V, clamp, lerp, smooth, hash01 } from './util.mjs';
import { along } from './grow.mjs';
import { tileUV } from './foliage.mjs';

export const BARK_METRES = 1.4; // what one repeat of a bark photograph covers

class Builder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.wind = []; this.shade = []; this.idx = []; this.cards = 0; }
  vertex(p, n, u, v, wind, shade) {
    this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.uv.push(u, v);
    this.wind.push(wind[0], wind[1], wind[2], wind[3]); this.shade.push(shade[0], shade[1], shade[2], shade[3]);
    return this.pos.length / 3 - 1;
  }
  get vertices() { return this.pos.length / 3; }
  get triangles() { return this.idx.length / 3; }
}

// ---------------------------------------------------------------------------------------------------------------------
// Sky occlusion: the crown as a grid of leaf density, and how much sky each point still sees through it
// ---------------------------------------------------------------------------------------------------------------------
const CELL = 0.7;
const RAYS = (() => {
  const dirs = [];
  for (const [el, n, off] of [[0.3, 5, 0], [0.8, 5, 0.6], [1.35, 3, 0.2]]) {
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + off; dirs.push([Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)]); }
  }
  return dirs;
})();

export function makeOcclusion(tree, leafArea) {
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const s of tree.sites) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], s.p[c] - 2); max[c] = Math.max(max[c], s.p[c] + 2); }
  const n = [0, 1, 2].map((c) => Math.max(1, Math.ceil((max[c] - min[c]) / CELL)));
  const grid = new Float32Array(n[0] * n[1] * n[2]);
  const cell = (p) => {
    const x = Math.floor((p[0] - min[0]) / CELL), y = Math.floor((p[1] - min[1]) / CELL), z = Math.floor((p[2] - min[2]) / CELL);
    return x < 0 || y < 0 || z < 0 || x >= n[0] || y >= n[1] || z >= n[2] ? -1 : (z * n[1] + y) * n[0] + x;
  };
  // each twig's leaves, spread over the cells its spray crosses
  for (const s of tree.sites) {
    for (let k = 0; k < 4; k++) {
      const i = cell(V.mad(s.p, s.d, (k + 0.5) * 0.25 * s.size));
      if (i >= 0) grid[i] += (leafArea * s.size * s.size) / 4;
    }
  }
  const density = 0.5 / (CELL * CELL); // leaf area in a cell to what a ray loses crossing it
  return (p) => {
    let open = 0;
    for (const d of RAYS) {
      let through = 0;
      for (let s = CELL * 0.75; s < 9; s += CELL) {
        const i = cell(V.mad(p, d, s));
        if (i < 0) break;
        through += grid[i] * density;
        if (through > 4) break;
      }
      open += Math.exp(-through);
    }
    return open / RAYS.length;
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Wind: every branch knows the limb it belongs to (the scaffold that left the trunk) and how far out along it it is
// ---------------------------------------------------------------------------------------------------------------------
export function windFrames(tree) {
  const { branches } = tree;
  const info = branches.map(() => ({ limb: -1, start: 0 }));
  for (const b of branches) {
    if (b.parent < 0) continue;
    const p = branches[b.parent];
    if (p.level === 0) info[b.index] = { limb: b.index, start: 0 };
    else info[b.index] = { limb: info[p.index].limb, start: info[p.index].start + p.length * b.parentT };
  }
  const reach = new Map();
  for (const b of branches) if (info[b.index].limb >= 0) reach.set(info[b.index].limb, Math.max(reach.get(info[b.index].limb) || 0, info[b.index].start + b.length));
  return {
    // limb weight and phase at fraction t of branch b
    at(b, t) {
      const f = info[b.index];
      if (f.limb < 0) return [0, 0];
      return [clamp((f.start + b.length * t) / (reach.get(f.limb) + 0.8)), hash01(f.limb, 77)];
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Wood
// ---------------------------------------------------------------------------------------------------------------------
const SIDES = [
  (r) => (r >= 0.24 ? 12 : r >= 0.12 ? 8 : r >= 0.05 ? 6 : r >= 0.022 ? 4 : 3),
  (r) => (r >= 0.24 ? 9 : r >= 0.1 ? 6 : r >= 0.04 ? 4 : 3)
];

function addTube(gb, tree, b, lod, occlusion, wind, lastOrder) {
  const minRadius = lod === 0 ? 0 : 0.028;
  if (b.rad[0] < minRadius) return;
  const sides = SIDES[lod](b.rad[0]);
  const H = tree.species.height;
  // Rings: where the branch turns, thins, or has run long enough; a thinned-out branch of level 1 ends in a point
  const keep = [0];
  const turnLimit = lod === 0 ? 0.22 : 0.36, runLimit = lod === 0 ? 1.4 : 2.6;
  let last = 0;
  for (let i = 1; i < b.pts.length - 1; i++) {
    if (b.rad[i] < minRadius) { keep.push(i); break; }
    const d0 = V.norm(V.sub(b.pts[i], b.pts[last])), d1 = V.norm(V.sub(b.pts[i + 1], b.pts[i]));
    const low = b.level === 0 && b.pts[i][1] < 1.2; // the flare at the foot needs its rings
    if (low || Math.acos(clamp(V.dot(d0, d1), -1, 1)) > turnLimit || b.cum[i] - b.cum[last] > runLimit || b.rad[i] < b.rad[last] * 0.72) { keep.push(i); last = i; }
  }
  const end = keep[keep.length - 1];
  if (end < b.pts.length - 1 && b.rad[end] >= minRadius) keep.push(b.pts.length - 1);
  if (keep.length < 2) return;
  const pointed = b.rad[keep[keep.length - 1]] <= Math.max(minRadius, 0.012);

  const repeats = Math.max(1, Math.round((2 * Math.PI * b.rad[0]) / BARK_METRES));
  const twig = b.level >= lastOrder;
  const phase = hash01(b.index, 5);
  const tangent = (k) => V.norm(V.sub(b.pts[Math.min(b.pts.length - 1, keep[Math.min(keep.length - 1, k + 1)])], b.pts[keep[Math.max(0, k - 1)]]));
  let T = tangent(0);
  let N = V.perp(T);
  const base = gb.vertices;
  // the foot of a branch sits inside its parent, wider there like a collar
  const parent = b.parent >= 0 ? tree.branches[b.parent] : null;
  keep.forEach((i, k) => {
    if (k > 0) {
      const T2 = tangent(k);
      const axis = V.cross(T, T2), s = V.len(axis);
      if (s > 1e-6) N = V.norm(V.rotate(N, V.scale(axis, 1 / s), Math.asin(clamp(s, -1, 1))));
      T = T2;
    }
    const B = V.cross(T, N);
    let p = b.pts[i], r = b.rad[i];
    const t = b.cum[i] / b.length;
    if (k === 0 && parent) {
      const at = along(parent, b.parentT);
      p = V.mad(p, T, -lerp(parent.rad[at.i], parent.rad[at.i + 1], at.k) * 0.6);
      r *= 1.18;
    }
    if (k === keep.length - 1 && pointed) r = Math.min(r, 0.004);
    const ao = occlusion(p);
    const [w1, ph1] = wind.at(b, t);
    const w2 = twig ? 0.3 * t : 0;
    const foot = b.level === 0 ? Math.exp(-p[1] / 0.5) : 0;
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const dir = V.add(V.scale(N, Math.cos(a)), V.scale(B, Math.sin(a)));
      // buttresses where the trunk meets the ground
      const lobes = 1 + foot * (0.16 * Math.sin(5 * a + 1.3) + 0.1 * Math.sin(3 * a + 0.4));
      gb.vertex(V.mad(p, dir, r * lobes), dir, (j / sides) * repeats, b.cum[i] / BARK_METRES,
        [w1, ph1, w2, phase], [ao * (1 - 0.3 * foot), clamp(p[1] / H), phase, 0]);
    }
  });
  for (let k = 0; k < keep.length - 1; k++) for (let j = 0; j < sides; j++) {
    const a = base + k * (sides + 1) + j, c = a + sides + 1;
    gb.idx.push(a, a + 1, c, a + 1, c + 1, c);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A card: a `cols` x `rows` grid standing on `foot`, running along `f`, across along `right`, facing `n`.
 * cup lets its sides fall away from the face, droop its far end; `shell` is the normal the crown would have there.
 */
function addCard(gb, { at, f, right, n, size, uv, footShare, mirror, cup, droop, cols, rows, wind, twigPhase, random, occlusion, shellAt, H, flatten = 0.55, weight = [0.35, 1], inset = 0 }) {
  const base = gb.vertices;
  const heart = V.mad(at, f, (0.5 - footShare) * size);
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const u = i / cols - 0.5, v = j / rows;
    const y = (v - footShare) * size;
    const sag = -(cup * 4 * u * u + droop * Math.max(0, v - footShare) ** 2) * size * 0.5;
    const p = V.add(V.add(V.mad(at, f, y), V.scale(right, u * size)), V.scale(n, sag));
    // the bent surface's own normal, turned to the crown's outside, then eased toward the crown's shell
    let g = V.norm(V.add(V.add(n, V.scale(right, cup * 4 * u)), V.scale(f, droop * Math.max(0, v - footShare))));
    const shell = shellAt(p);
    if (V.dot(g, shell) < 0) g = V.scale(g, -1);
    const normal = V.norm(V.lerp(g, shell, flatten));
    const uu = lerp(uv.u0, uv.u1, mirror ? 1 - (u + 0.5) : u + 0.5), vv = lerp(uv.v1, uv.v0, v);
    gb.vertex(p, normal, uu, vv, [wind[0], wind[1], lerp(weight[0], weight[1], v), twigPhase], [occlusion(inset ? V.lerp(p, heart, inset) : p), clamp(p[1] / H), random, 1]);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = base + j * (cols + 1) + i, c = a + cols + 1;
    gb.idx.push(a, a + 1, c + 1, a, c + 1, c);
  }
  gb.cards++;
}

/**
 * The geometry of one level of detail.
 * foliage: { row (of the leaf atlas), tiles: [{ size, foot, cover }] from build-foliage, scale }
 */
export function buildLevel(tree, lod, foliage, seed) {
  const sp = tree.species, F = sp.foliage;
  const gb = new Builder();
  const r = rng(seed * 97 + lod * 13 + 5);
  const lastOrder = sp.orders.length;
  const wind = windFrames(tree);
  const sprayArea = foliage.tiles[0].size ** 2 * foliage.tiles[0].cover * 2;
  const occlusion = makeOcclusion(tree, sprayArea * (F.scale || 1) ** 2);
  const H = sp.height;
  const mid = [0, (tree.envelope.base + tree.envelope.top) * 0.5, 0];
  const shellAt = (p) => V.norm([p[0] - mid[0], (p[1] - mid[1]) * 0.7 + 0.25 * sp.radius, p[2] - mid[2]]);

  for (const b of tree.branches) addTube(gb, tree, b, lod, occlusion, wind, lastOrder);

  const frame = (d) => {
    // the face of a spray looks at the sky, leaning to the crown's outside
    let n = V.sub([0, 1, 0], V.scale(d, d[1]));
    if (V.len(n) < 0.15) n = V.perp(d);
    return V.norm(n);
  };

  if (lod === 0) {
    for (const s of tree.sites) {
      const b = tree.branches[s.branch];
      const w = wind.at(b, s.t);
      const out = shellAt(s.p);
      let n = V.norm(V.add(V.scale(frame(s.d), 0.8), V.scale(V.sub(out, V.scale(s.d, V.dot(out, s.d))), 0.45)));
      n = V.rotate(n, s.d, (r() - 0.5) * 0.9);
      const right = V.norm(V.cross(s.d, n));
      const tile = r() < 0.5 ? 0 : 1;
      const size = foliage.tiles[tile].size * s.size * (F.scale || 1);
      const phase = r(), random = r();
      addCard(gb, {
        at: s.p, f: s.d, right, n, size, uv: tileUV(foliage.row, tile), footShare: foliage.tiles[tile].foot, mirror: r() < 0.5,
        cup: F.cup * (0.6 + r() * 0.8), droop: F.droopCard * (0.5 + r()), cols: 2, rows: 2, wind: w, twigPhase: phase, random, occlusion, shellAt, H
      });
      // a second one across it, so the twig has body from the side
      const other = 1 - tile;
      const turn = (r() < 0.5 ? 1 : -1) * (1.2 + r() * 0.6);
      const n2 = V.rotate(n, s.d, turn), right2 = V.norm(V.cross(s.d, n2));
      addCard(gb, {
        at: s.p, f: s.d, right: right2, n: n2, size: foliage.tiles[other].size * s.size * (F.scale || 1) * 0.88, uv: tileUV(foliage.row, other),
        footShare: foliage.tiles[other].foot, mirror: r() < 0.5, cup: 0, droop: 0, cols: 1, rows: 1, wind: w, twigPhase: phase, random: r(), occlusion, shellAt, H
      });
      // and at a tip, a sprig facing along it: a twig seen end on is not a pair of lines
      if (s.t === 1) {
        const up = frame(s.d), side = V.norm(V.cross(up, s.d));
        const sprig = foliage.tiles[2].size * s.size * (F.scale || 1) * 1.15;
        addCard(gb, {
          at: V.mad(s.p, s.d, size * 0.45), f: up, right: side, n: s.d, size: sprig, uv: tileUV(foliage.row, 2), footShare: 0.5, mirror: r() < 0.5,
          cup: 0.1, droop: 0, cols: 1, rows: 1, wind: w, twigPhase: phase, random: r(), occlusion, shellAt, H, weight: [0.8, 0.8]
        });
      }
    }
  } else {
    // Level 1: twigs gathered by the branch that carries them, each gathering one cluster of crossed cards
    const groups = new Map();
    for (const s of tree.sites) {
      let b = tree.branches[s.branch];
      while (b.level > Math.max(1, lastOrder - 1) && b.parent >= 0) b = tree.branches[b.parent];
      if (!groups.has(b.index)) groups.set(b.index, []);
      groups.get(b.index).push(s);
    }
    const clusters = [];
    const split = (list) => {
      if (list.length <= F.cluster) { clusters.push(list); return; }
      // cut across the longest extent
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const s of list) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], s.p[c]); hi[c] = Math.max(hi[c], s.p[c]); }
      const axis = [0, 1, 2].sort((a, b2) => hi[b2] - lo[b2] - (hi[a] - lo[a]))[0];
      const sorted = list.slice().sort((a, b2) => a.p[axis] - b2.p[axis]);
      split(sorted.slice(0, sorted.length >> 1));
      split(sorted.slice(sorted.length >> 1));
    };
    for (const list of groups.values()) split(list);
    const massSize = foliage.tiles[3].size, spraySize = foliage.tiles[0].size * (F.scale || 1);
    for (const list of clusters) {
      let c = [0, 0, 0], d = [0, 0, 0];
      for (const s of list) { c = V.add(c, V.mad(s.p, s.d, spraySize * 0.45)); d = V.add(d, s.d); }
      c = V.scale(c, 1 / list.length);
      d = V.norm(d);
      let spread = 0;
      for (const s of list) spread += V.dist(V.mad(s.p, s.d, spraySize * 0.45), c) ** 2;
      spread = Math.sqrt(spread / list.length);
      const size = clamp((spread * 2 + spraySize) * F.massScale, massSize * 0.55, massSize * 1.9);
      const b = tree.branches[list[0].branch];
      const w = wind.at(b, list[0].t);
      const phase = r();
      const n = V.rotate(frame(d), d, (r() - 0.5) * 0.8);
      const right = V.norm(V.cross(d, n));
      const common = { size, uv: tileUV(foliage.row, 3), cup: 0, droop: 0, cols: 1, rows: 1, wind: w, twigPhase: phase, occlusion, shellAt, H, weight: [0.5, 0.9], inset: 0.6, flatten: 0.9 };
      const foot = V.mad(c, d, -size * 0.5);
      addCard(gb, { ...common, at: foot, f: d, right, n, footShare: 0, mirror: r() < 0.5, random: r() });
      addCard(gb, { ...common, at: foot, f: d, right: n, n: V.scale(right, -1), footShare: 0, mirror: r() < 0.5, random: r() });
      addCard(gb, { ...common, at: V.mad(c, n, -size * 0.5), f: n, right, n: V.scale(d, -1), footShare: 0, mirror: r() < 0.5, random: r() });
    }
  }
  return gb;
}

/** Bounding sphere over a builder's vertices: { center, radius } */
export function boundsOf(gb) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < gb.pos.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], gb.pos[i + c]); hi[c] = Math.max(hi[c], gb.pos[i + c]); }
  const center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  let radius = 0;
  for (let i = 0; i < gb.pos.length; i += 3) radius = Math.max(radius, Math.hypot(gb.pos[i] - center[0], gb.pos[i + 1] - center[1], gb.pos[i + 2] - center[2]));
  return { center, radius, lo, hi };
}
