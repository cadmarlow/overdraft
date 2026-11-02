import * as THREE from 'three/webgpu';
import { createTreeMaterial } from './tsl-materials.js';
import { polygonBoxOverlaps } from './building-collision.js';
import { nature } from './nature-assets.js';

// Seeded street and park trees with four geometry levels, regrouped by spatial cell as the camera moves. Up close a tree
// is a real one: photographed bark on its limbs, thousands of scanned leaves set along twigs on its cards (the atlas comes
// from tools/nature/build-foliage.mjs). Crown normals, occlusion and wind weights are baked into the geometry
// (see createTreeMaterial).

const V3 = THREE.Vector3;

// Seeded PRNG (mulberry32): every species, variant and level grows the same tree on every load
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// =====================================================================================================================
// 1. LEAF ATLAS: 4 x 4 tiles of real leaves, one row per species (js/nature-assets.js): two sprays, a clump, the dense mass
//    of the far canopy. Cards are as wide in metres as the spray was laid out (SPECIES.card)
// =====================================================================================================================
const GRID = 4;
const TILE_SPRAY = 0, TILE_CLUMP = 2, TILE_FAR = 3;
const GUTTER = 12 / 1024; // of a tile: what the atlas keeps clear round it

// =====================================================================================================================
// 2. SPECIES: trunk / leader (radius, top, lean), scaffold limbs (count, heights up the leader, tilt off vertical and
//    length blended from the lowest to the highest limb), branches & twigs (count, span along the parent, angle off it,
//    length as a share of the parent or in metres), bending per metre (up: toward the sky, out: away from the trunk,
//    droop: down, growing toward the tips), leaf cards per twig (scale, droop) and the per-tree foliage tints (sRGB).
//    Scale 1 is a mature park tree; street trees are planted smaller.
// =====================================================================================================================
const SPECIES = [
  { // 0: London plane: tall clear trunk and leader with heavy ascending limbs, a broad rounded crown of big leaves
    name: 'plane', row: 0, card: 1.7,
    trunk: { r: 0.3, top: 8.6, lean: 0.04, segs: 8 },
    limbs: { n: 7, y: [3.4, 7.8], tilt: [1.0, 0.36], len: [4.8, 3.0], r: 0.62, up: 0.07, out: 0, droop: 0, jitter: 0.07, segs: 6 },
    branches: { n: 5, t: [0.25, 0.98], angle: [0.55, 0.95], len: [0.62, 0.42], up: 0.06, out: 0.02, droop: 0, jitter: 0.1, segs: 4 },
    twigs: { n: 5, t: [0.2, 1.0], angle: [0.6, 1.05], len: [1.25, 0.8], up: 0.02, out: 0, droop: 0.04, jitter: 0.12, segs: 2 },
    cards: { perTwig: 4, scale: [0.78, 1.08], droop: 0.05 },
    tints: [[1, 1, 1], [1.06, 1.02, 0.84], [0.88, 0.96, 0.9]]
  },
  { // 1: Honey locust: slim trunk forking into spreading, zigzag limbs, an open layered crown of feathery fronds
    name: 'locust', row: 1, card: 1.5,
    trunk: { r: 0.19, top: 5.4, lean: 0.07, segs: 7 },
    limbs: { n: 6, y: [2.6, 5.0], tilt: [1.12, 0.55], len: [4.4, 3.0], r: 0.68, up: 0.04, out: 0, droop: 0, jitter: 0.16, segs: 6 },
    branches: { n: 5, t: [0.25, 0.98], angle: [0.6, 1.05], len: [0.6, 0.42], up: 0.03, out: 0.03, droop: 0.02, jitter: 0.16, segs: 4 },
    twigs: { n: 4, t: [0.25, 1.0], angle: [0.55, 1.0], len: [1.1, 0.7], up: 0, out: 0, droop: 0.06, jitter: 0.14, segs: 2 },
    cards: { perTwig: 5, scale: [0.85, 1.15], droop: 0.1 },
    tints: [[1, 1, 1], [1.08, 1.02, 0.86], [0.92, 0.98, 0.94]]
  },
  { // 2: American elm: trunk forking low into upright limbs that arch outward, a tall vase with drooping twigs
    name: 'elm', row: 2, card: 1.5,
    trunk: { r: 0.28, top: 4.3, lean: 0.03, segs: 6 },
    limbs: { n: 6, y: [3.3, 4.1], tilt: [0.36, 0.22], len: [7.6, 7.2], r: 0.6, up: 0, out: 0.075, droop: 0, jitter: 0.06, segs: 7 },
    branches: { n: 6, t: [0.3, 1.0], angle: [0.5, 0.85], len: [0.44, 0.3], up: 0, out: 0.05, droop: 0.07, jitter: 0.1, segs: 4 },
    twigs: { n: 4, t: [0.25, 1.0], angle: [0.5, 0.95], len: [1.4, 0.9], up: 0, out: 0, droop: 0.16, jitter: 0.12, segs: 2 },
    cards: { perTwig: 4, scale: [0.8, 1.1], droop: 0.4 },
    tints: [[1, 1, 1], [1.05, 1.03, 0.86], [0.86, 0.95, 0.92]]
  },
  { // 3: Oak: short heavy trunk, limbs spreading wide and low, a broad dense dome (the parks' big old trees)
    name: 'oak', row: 3, card: 1.6,
    trunk: { r: 0.4, top: 5.2, lean: 0.05, segs: 7 },
    limbs: { n: 8, y: [2.6, 5.0], tilt: [1.2, 0.5], len: [6.4, 4.0], r: 0.56, up: 0.05, out: 0, droop: 0.01, jitter: 0.14, segs: 7 },
    branches: { n: 5, t: [0.25, 0.98], angle: [0.6, 1.1], len: [0.56, 0.4], up: 0.05, out: 0.02, droop: 0.01, jitter: 0.14, segs: 4 },
    twigs: { n: 5, t: [0.2, 1.0], angle: [0.6, 1.1], len: [1.2, 0.8], up: 0.02, out: 0, droop: 0.03, jitter: 0.16, segs: 2 },
    cards: { perTwig: 4, scale: [0.8, 1.1], droop: 0.06 },
    tints: [[1, 1, 1], [1.06, 1, 0.8], [0.84, 0.94, 0.88]]
  }
];

// =====================================================================================================================
// 3. SKELETON
// =====================================================================================================================

// Unit vector `angle` off `dir`, turned `azimuth` round it
function deflect(dir, angle, azimuth) {
  const ref = Math.abs(dir.y) < 0.95 ? new V3(0, 1, 0) : new V3(1, 0, 0);
  const u = new V3().crossVectors(dir, ref).normalize();
  const w = new V3().crossVectors(dir, u);
  return dir.clone().multiplyScalar(Math.cos(angle))
    .addScaledVector(u, Math.sin(angle) * Math.cos(azimuth))
    .addScaledVector(w, Math.sin(angle) * Math.sin(azimuth))
    .normalize();
}

// A branch as a polyline from p0 along dir, len metres in segs steps (or at the given length fractions), bending per
// metre toward the sky (up), away from the trunk axis (out) and downward toward its tip (droop), with some wander
function growBranch(p0, dir, len, r0, r1, segs, bend, rng, level, schedule = null) {
  const ts = schedule || Array.from({ length: segs + 1 }, (_, i) => i / segs);
  const pts = [p0.clone()];
  const rad = [r0];
  const d = dir.clone();
  const p = p0.clone();
  const out = new V3();
  for (let i = 1; i < ts.length; i++) {
    const t = ts[i];
    const step = (t - ts[i - 1]) * len;
    out.set(p.x, 0, p.z);
    if (out.lengthSq() > 1e-6) out.normalize();
    d.x += out.x * bend.out * step + (rng() - 0.5) * bend.jitter;
    d.y += (bend.up - bend.droop * t * 2.0) * step + (rng() - 0.5) * bend.jitter * 0.6;
    d.z += out.z * bend.out * step + (rng() - 0.5) * bend.jitter;
    d.normalize();
    p.addScaledVector(d, step);
    pts.push(p.clone());
    rad.push(r0 + (r1 - r0) * Math.pow(t, 0.8));
  }
  return { pts, rad, len, level, ts };
}

// Point, direction & radius at length fraction t of a branch
function along(b, t) {
  const ts = b.ts;
  let i = 0;
  while (i < ts.length - 2 && ts[i + 1] < t) i++;
  const k = Math.min(1, Math.max(0, (t - ts[i]) / (ts[i + 1] - ts[i])));
  return {
    p: b.pts[i].clone().lerp(b.pts[i + 1], k),
    d: b.pts[i + 1].clone().sub(b.pts[i]).normalize(),
    r: lerp(b.rad[i], b.rad[i + 1], k)
  };
}

function growTree(sp, seed) {
  const rng = mulberry32(seed);
  const R = (a, b) => a + (b - a) * rng();
  const branches = [];
  const still = { up: 0, out: 0, droop: 0, jitter: 0.025 };

  // Trunk & leader: leaning a little, flaring at the root (dense rings at the base), tapering to a slim top
  const T = sp.trunk;
  const lean = R(0, Math.PI * 2);
  const trunkDir = new V3(Math.cos(lean) * T.lean, 1, Math.sin(lean) * T.lean).normalize();
  const schedule = [0, 0.03, 0.08];
  for (let i = 1; i <= T.segs; i++) schedule.push(0.08 + (0.92 * i) / T.segs);
  const trunk = growBranch(new V3(0, 0, 0), trunkDir, T.top, T.r, T.r * 0.3, T.segs, still, rng, 0, schedule);
  trunk.rad = trunk.rad.map((r, i) => r * (1 + 0.75 * Math.exp(-(trunk.ts[i] * T.top) / 0.28)));
  branches.push(trunk);

  // Scaffold limbs spiralling up the leader by the golden angle; branches along each limb; twigs along each branch
  const L = sp.limbs;
  const B = sp.branches;
  const W = sp.twigs;
  let az = R(0, Math.PI * 2);
  for (let i = 0; i < L.n; i++) {
    const f = L.n > 1 ? i / (L.n - 1) : 0;
    const y = lerp(L.y[0], L.y[1], f) + R(-0.25, 0.25);
    const base = along(trunk, Math.min(0.98, y / T.top));
    az += 2.39996 + R(-0.35, 0.35);
    const tilt = lerp(L.tilt[0], L.tilt[1], f) + R(-0.08, 0.08);
    const dir = new V3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
    const len = lerp(L.len[0], L.len[1], f) * R(0.88, 1.1);
    const limb = growBranch(base.p, dir, len, base.r * L.r, 0.035, L.segs, L, rng, 1);
    branches.push(limb);

    const nb = B.n + (rng() < 0.5 ? 1 : 0);
    let baz = R(0, Math.PI * 2);
    for (let j = 0; j < nb; j++) {
      const bt = lerp(B.t[0], B.t[1], (j + R(0.15, 0.85)) / nb);
      const a = along(limb, bt);
      baz += 2.39996 + R(-0.4, 0.4);
      const bdir = deflect(a.d, R(B.angle[0], B.angle[1]), baz);
      const outw = new V3(a.p.x, 0, a.p.z).normalize();
      if (bdir.dot(outw) < -0.15) bdir.addScaledVector(outw, 0.7).normalize(); // keep out of the crown core
      const blen = len * lerp(B.len[0], B.len[1], bt) * R(0.85, 1.12);
      const br = growBranch(a.p, bdir, blen, Math.max(0.022, a.r * 0.62), 0.014, B.segs, B, rng, 2);
      br.parentT = bt;
      branches.push(br);

      const nw = W.n + (rng() < 0.4 ? 1 : 0);
      let taz = R(0, Math.PI * 2);
      for (let k = 0; k < nw; k++) {
        const tt = lerp(W.t[0], W.t[1], (k + R(0.2, 0.8)) / nw);
        const ta = along(br, tt);
        taz += 2.39996 + R(-0.5, 0.5);
        const tdir = deflect(ta.d, R(W.angle[0], W.angle[1]), taz);
        const tw = growBranch(ta.p, tdir, lerp(W.len[0], W.len[1], tt) * R(0.8, 1.2), Math.max(0.012, ta.r * 0.7), 0.006, W.segs, W, rng, 3);
        tw.parentT = tt;
        branches.push(tw);
      }
    }
  }
  return branches;
}

// =====================================================================================================================
// 4. GEOMETRY: bark tubes & leaf cards of one species / variant at one level of detail
// =====================================================================================================================
class TreeGeometryBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.attr = [];
    this.idx = [];
  }

  vertex(p, n, u, v, leaf, ao, sway, rnd) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.attr.push(leaf, ao, sway, rnd);
    return this.pos.length / 3 - 1;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aTree', new THREE.Float32BufferAttribute(this.attr, 4));
    const vCount = this.pos.length / 3;
    g.setIndex(vCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Tapered tube along a branch with parallel-transported rings (every `stride`-th skeleton point); uv in metres
function addTube(gb, b, radial, stride, aoAt, swayAt) {
  const n = b.pts.length;
  const keep = [];
  for (let i = 0; i < n; i += stride) keep.push(i);
  if (keep[keep.length - 1] !== n - 1) keep.push(n - 1);
  const tangent = (i) => {
    const a = b.pts[Math.max(0, i - 1)];
    const c = b.pts[Math.min(n - 1, i + 1)];
    return c.clone().sub(a).normalize();
  };
  let T = tangent(keep[0]);
  let N = Math.abs(T.y) < 0.9 ? new V3(0, 1, 0).cross(T).normalize() : new V3(1, 0, 0).cross(T).normalize();
  const q = new THREE.Quaternion();
  const around = 2 * Math.PI * Math.max(b.rad[0], 0.02);
  let vLen = 0;
  const base = gb.pos.length / 3;
  const dir = new V3();
  const p = new V3();
  keep.forEach((i, ki) => {
    if (ki > 0) {
      const T2 = tangent(i);
      q.setFromUnitVectors(T, T2);
      N.applyQuaternion(q).normalize();
      T = T2;
      vLen += b.pts[i].distanceTo(b.pts[keep[ki - 1]]);
    }
    const Bn = new V3().crossVectors(T, N);
    const t = b.ts[i];
    const ao = aoAt(b.pts[i]);
    const sway = swayAt(b, t);
    // the foot of a trunk spreads into buttresses, gone within a metre or two
    const foot = b.level === 0 ? Math.exp(-b.pts[i].y / 0.75) : 0;
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      dir.copy(N).multiplyScalar(Math.cos(ang)).addScaledVector(Bn, Math.sin(ang));
      const lobes = 1 + foot * (0.2 * Math.sin(5 * ang + 1.3) + 0.12 * Math.sin(3 * ang + 0.4));
      p.copy(b.pts[i]).addScaledVector(dir, b.rad[i] * lobes);
      gb.vertex(p, dir, (j / radial) * around, vLen, 0, ao * (1 - 0.35 * foot), sway, 0);
    }
  });
  // Rings run counter-clockwise round the tangent, so (a, a + 1, c) is counter-clockwise seen from outside: the front
  // faces point out along the normals (the material drops the bark's back faces)
  for (let k = 0; k < keep.length - 1; k++) {
    for (let j = 0; j < radial; j++) {
      const a = base + k * (radial + 1) + j;
      const c = a + radial + 1;
      gb.idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
}

// Leaf card: bottom edge centred on `at`, rising along `up`, facing `face`; uv over atlas tile (column, row), mirrored or not
function addCard(gb, at, up, face, size, tile, row, mirror, rnd, crown) {
  const side = new V3().crossVectors(up, face).normalize();
  const nrm = new V3().crossVectors(side, up).normalize();
  let u0 = (tile + GUTTER) / GRID;
  let u1 = (tile + 1 - GUTTER) / GRID;
  if (mirror) [u0, u1] = [u1, u0];
  const vTop = (row + GUTTER) / GRID;
  const vBot = (row + 1 - GUTTER) / GRID;
  const corners = [
    [-0.5, 0, u0, vBot],
    [0.5, 0, u1, vBot],
    [0.5, 1, u1, vTop],
    [-0.5, 1, u0, vTop]
  ];
  const base = gb.pos.length / 3;
  const p = new V3();
  for (const [sx, sy, u, v] of corners) {
    p.copy(at).addScaledVector(side, sx * size).addScaledVector(up, sy * size);
    const { n, ao } = crown.shade(p, nrm);
    gb.vertex(p, n, u, v, 1, ao, lerp(0.8, 1.0, sy), rnd);
  }
  gb.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// Crown ellipsoid (from the foliage) for shell normals & interior occlusion
function makeCrown(points) {
  const box = new THREE.Box3().setFromPoints(points);
  const C = box.getCenter(new V3());
  const Rr = box.getSize(new V3()).multiplyScalar(0.5).max(new V3(0.5, 0.5, 0.5));
  const tmp = new V3();
  const sn = new V3();
  return {
    C,
    R: Rr,
    bottom: box.min.y,
    // Shell normal (out from the centre, a little skyward) blended with the card face (turned to agree with it)
    shade(p, face) {
      tmp.copy(p).sub(C).divide(Rr);
      const e = tmp.length();
      sn.copy(tmp).normalize();
      sn.y += 0.22;
      sn.normalize();
      const f = face.dot(sn) < 0 ? face.clone().negate() : face.clone();
      const n = sn.clone().multiplyScalar(0.72).addScaledVector(f, 0.28).normalize();
      const top = Math.min(1, Math.max(-1, (p.y - C.y) / Rr.y));
      const ao = (0.22 + 0.78 * smooth(0.15, 1.0, e)) * (0.86 + 0.14 * top);
      return { n, ao };
    },
    // Bark: open below the crown, darker the deeper inside it
    barkAO(p) {
      if (p.y < box.min.y) return 0.9;
      tmp.copy(p).sub(C).divide(Rr);
      return lerp(0.32, 0.8, smooth(0.2, 1.0, tmp.length()));
    }
  };
}

// Sway weight along the hierarchy: 0 on the trunk (whole-tree bend is height based), rising to 1 at the twig tips
function swayWeight(b, t) {
  switch (b.level) {
    case 0: return 0;
    case 1: return 0.18 * t;
    case 2: return 0.18 + 0.4 * t;
    default: return 0.58 + 0.4 * t;
  }
}

// Cards of one level: leaf sprays along every twig (0), bigger ones along the branches (1), clumps round the crown (2), the
// few whole-crown cards of the far level (3)
function placeCards(sp, branches, lod, rng, crown) {
  const R = (a, b) => a + (b - a) * rng();
  const cards = [];
  const outward = (p) => new V3(p.x - crown.C.x, (p.y - crown.C.y) * 0.6, p.z - crown.C.z).normalize();
  const orient = (p, d, droop) => {
    const o = outward(p);
    const up = d.clone().multiplyScalar(0.55).addScaledVector(o, 0.45)
      .add(new V3(R(-0.3, 0.3), R(-0.2, 0.3), R(-0.3, 0.3)));
    up.y -= droop;
    up.normalize();
    let face = o.clone().add(new V3(R(-0.9, 0.9), R(-0.6, 0.9), R(-0.9, 0.9))).normalize();
    face.addScaledVector(up, -face.dot(up));
    if (face.lengthSq() < 1e-4) face = new V3(0, 1, 0).cross(up);
    return { up, face: face.normalize() };
  };
  const spray = () => TILE_SPRAY + (rng() < 0.5 ? 0 : 1);
  const card = sp.card;
  if (lod === 0) {
    for (const b of branches) {
      if (b.level !== 3) continue;
      const n = sp.cards.perTwig;
      for (let k = 0; k < n; k++) {
        const a = along(b, lerp(0.15, 1.0, (k + R(0.2, 0.9)) / n));
        const { up, face } = orient(a.p, a.d, sp.cards.droop);
        cards.push({ at: a.p, up, face, size: card * R(sp.cards.scale[0], sp.cards.scale[1]), tile: spray() });
      }
    }
    // every branch ends in a spray, and clumps fill the crown behind them
    for (const b of branches) {
      if (b.level !== 2) continue;
      const end = along(b, 1);
      const o = orient(end.p, end.d, sp.cards.droop);
      cards.push({ at: end.p, ...o, size: card * R(0.95, 1.2), tile: spray() });
      const mid = along(b, R(0.45, 0.8));
      const f = orient(mid.p, mid.d, 0);
      const size = card * R(1.15, 1.45);
      cards.push({ at: mid.p.clone().addScaledVector(f.up, -size * 0.5), ...f, size, tile: TILE_CLUMP });
    }
  } else if (lod === 1) {
    for (const b of branches) {
      if (b.level !== 2) continue;
      for (const t of [0.3, 0.62, 1.0]) {
        const a = along(b, Math.min(1, t + R(-0.06, 0.04)));
        const { up, face } = orient(a.p, a.d, sp.cards.droop);
        const at = a.p.clone().addScaledVector(outward(a.p), 0.3);
        cards.push({ at, up, face, size: card * R(1.7, 2.1), tile: t > 0.8 ? spray() : TILE_CLUMP });
      }
    }
  } else if (lod === 2) {
    for (const b of branches) {
      if (b.level !== 2 || rng() > 0.45) continue;
      const a = along(b, R(0.5, 1));
      const { up, face } = orient(a.p, a.d, 0);
      const size = card * R(2.8, 3.4);
      cards.push({ at: a.p.clone().addScaledVector(up, -size * 0.5), up, face, size, tile: TILE_CLUMP });
    }
  } else {
    // Fibonacci directions over the crown, fewer underneath; cards centred just inside the shell, facing out
    const n = 16;
    const meanR = (crown.R.x + crown.R.y + crown.R.z) / 3;
    const s = Math.max(meanR * 1.3, 2.4);
    for (let i = 0; i < n; i++) {
      const y = 1 - (i + 0.5) / n * 1.55; // 1 .. -0.55
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const ph = i * 2.39996 + R(-0.2, 0.2);
      const dir = new V3(Math.cos(ph) * r, y, Math.sin(ph) * r);
      const center = crown.C.clone().add(dir.clone().multiply(crown.R).multiplyScalar(0.58));
      const face = dir.clone().add(new V3(R(-0.25, 0.25), R(-0.25, 0.25), R(-0.25, 0.25))).normalize();
      let up = new V3(0, 1, 0).addScaledVector(face, -face.y);
      if (up.lengthSq() < 1e-3) up = new V3(1, 0, 0);
      up.normalize().applyAxisAngle(face, R(-0.5, 0.5));
      const at = center.clone().addScaledVector(up, -s * 0.5);
      cards.push({ at, up, face, size: s, tile: TILE_FAR });
    }
  }
  return cards;
}

// Bark of each level: [sides, every how many rings] by branch level (trunk, limbs, branches, twigs), null to leave it out
const BARK_DETAIL = [
  [[12, 1], [7, 1], [4, 2], [3, 2]],
  [[8, 2], [5, 2], [3, 3], null],
  [[6, 3], [3, 4], null, null],
  [[4, 99], [3, 99], null, null]
];

// One species / variant: [lod0 .. lod3] geometries.
function buildTreeGeometries(speciesIndex, variant) {
  const sp = SPECIES[speciesIndex];
  const seed = 7919 * (speciesIndex + 1) + 104729 * (variant + 1);
  const branches = growTree(sp, seed);

  // Crown from the full-detail foliage: card anchors pushed out by half a card
  const rngC = mulberry32(seed ^ 0x5bd1e995);
  const tips = [];
  for (const b of branches) if (b.level === 3) tips.push(b.pts[b.pts.length - 1]);
  const roughCrown = makeCrown(tips);
  const cards0 = placeCards(sp, branches, 0, rngC, roughCrown);
  const pts = [];
  for (const c of cards0) {
    pts.push(c.at.clone().addScaledVector(c.up, c.size * 0.5));
    pts.push(c.at.clone().addScaledVector(c.up, c.size));
  }
  const crown = makeCrown(pts);

  const geos = [];
  for (let lod = 0; lod < 4; lod++) {
    const gb = new TreeGeometryBuilder();
    const rng = mulberry32(seed + lod * 31337);
    const aoAt = (p) => crown.barkAO(p);
    for (const b of branches) {
      const detail = BARK_DETAIL[lod][b.level];
      if (detail) addTube(gb, b, detail[0], detail[1], aoAt, swayWeight);
    }
    const cards = (lod === 0 ? cards0 : placeCards(sp, branches, lod, rng, crown))
      .map((c) => ({ ...c, mirror: rng() < 0.5, random: rng() }));
    for (const c of cards) addCard(gb, c.at, c.up, c.face, c.size, c.tile, sp.row, c.mirror, c.random, crown);
    const g = gb.build();
    g.userData = { species: sp.name, variant, lod, cards: cards.length, triangles: gb.idx.length / 3 };
    geos[lod] = g;
  }
  return geos;
}

// =====================================================================================================================
// 5. TREE FIELD: per-tree level of detail, with spatial cells culled separately in the view and shadow passes
// =====================================================================================================================
const TREE_CELL_SIZE = 200;
// How far each level reaches (m): full trees, then coarser cards, then crown clumps; beyond, whole-crown cards. Scaled by
// the graphics level (setTreeDetail)
const LOD_BANDS = [52, 130, 340];
const LOD_HYSTERESIS = 6;
let treeDetail = 1;
function setTreeDetail(k) { treeDetail = k; }

const LEVELS = LOD_BANDS.length + 1;
const FAREST = LEVELS - 1;
const MAX_DIST = [3000, 1600, 950];
const LOW_CUTOFF = 1150;

function hashPos(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// Placement checks run once, against nearby buildings and bridge structures.
function createTreeClearance(colliders) {
  const cellSize = 64;
  const cells = new Map();
  for (const c of colliders) {
    for (let x = Math.floor(c.minX / cellSize); x <= Math.floor(c.maxX / cellSize); x++) {
      for (let z = Math.floor(c.minZ / cellSize); z <= Math.floor(c.maxZ / cellSize); z++) {
        const key = `${x},${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(c);
      }
    }
  }
  return (bounds) => {
    const { min, max } = bounds;
    for (let x = Math.floor(min.x / cellSize); x <= Math.floor(max.x / cellSize); x++) {
      for (let z = Math.floor(min.z / cellSize); z <= Math.floor(max.z / cellSize); z++) {
        for (const c of cells.get(`${x},${z}`) || []) {
          if (min.y >= c.maxY || max.y <= (c.minY ?? 0)
            || min.x >= c.maxX || max.x <= c.minX || min.z >= c.maxZ || max.z <= c.minZ) continue;
          if (c.polygon && !polygonBoxOverlaps(c.polygon, (min.x + max.x) / 2, (min.z + max.z) / 2,
            (max.x - min.x) / 2, (max.z - min.z) / 2)) continue;
          if (c.obb) {
            const o = c.obb;
            const dx = (min.x + max.x) * 0.5 - o.cx, dz = (min.z + max.z) * 0.5 - o.cz;
            const hx = (max.x - min.x) * 0.5, hz = (max.z - min.z) * 0.5;
            // Also test the building's axes, so its enclosing box doesn't block an angled sidewalk.
            if (Math.abs(dx * o.cs - dz * o.sn) >= o.hx + hx * Math.abs(o.cs) + hz * Math.abs(o.sn)
              || Math.abs(dx * o.sn + dz * o.cs) >= o.hz + hx * Math.abs(o.sn) + hz * Math.abs(o.cs)) continue;
          }
          return false;
        }
      }
    }
    return true;
  };
}

/**
 * Builds the instanced tree field for `sites` ({ x, y, z, scale, species, yaw?, sx?, sz?, tier? }). Call
 * `update(cameraPosition)` from the frame loop to keep each tree's level of detail up to date. Returns
 * { group, material, atlas, sites (accepted placements), update(cameraPosition) }.
 */
function createTreeField(_scene, sites, colliders = []) {
  const group = new THREE.Group();
  group.name = 'Trees';
  const materials = SPECIES.map((_, s) => createTreeMaterial({
    leaves: nature.leaves, leavesNormal: nature.leavesNormal, bark: nature.bark[s], barkNormal: nature.barkNormal[s]
  }));

  // Geometries: [species][variant][lod]
  const geos = SPECIES.map((_, s) => [0, 1].map((v) => buildTreeGeometries(s, v)));
  const clearOfBuildings = createTreeClearance(colliders);
  const treeBounds = geos.map((variants) => variants.map((levels) => {
    const bounds = new THREE.Box3();
    for (const g of levels) bounds.union(g.boundingBox);
    const height = Math.max(Math.abs(bounds.min.y), Math.abs(bounds.max.y));
    // Maximum wind sway, with clearance for flutter and facade trim.
    const margin = Math.hypot(0.2, 0.06) * Math.hypot(0.86, 0.51) * (height / 11) ** 2 + 0.5;
    return { bounds, margin };
  }));
  const worldBounds = new THREE.Box3();
  const plantedSites = new Set();
  const trunks = []; // what cars and people run into

  // Allocate for candidate sites; N counts only trees clear of buildings.
  const capacity = sites.length;
  let N = 0;
  const mats = new Float32Array(capacity * 16);
  const data = new Float32Array(capacity * 4);
  const px = new Float32Array(capacity);
  const py = new Float32Array(capacity);
  const pz = new Float32Array(capacity);
  const meshOf = new Int32Array(capacity * LEVELS); // mesh index per level
  const tier = new Uint8Array(capacity);
  const lod = new Uint8Array(capacity).fill(255);

  // Shared geometry types per species, variant and level.
  const types = [];
  const makeType = (geo, name, species) => {
    const height = Math.max(Math.abs(geo.boundingBox.min.y), Math.abs(geo.boundingBox.max.y));
    // The material adds wind after the instance transform: height-squared lean/rock, plus bob and flutter.
    const windPadding = Math.hypot(0.2, 0.06) * Math.hypot(0.86, 0.51) * (height / 11) ** 2 + 2;
    const type = { geo, name, species, windPadding, meshes: [] };
    types.push(type);
    return type;
  };
  const meshIndex = SPECIES.map((sp, s) => [0, 1].map((v) => [0, 1, 2, 3].map((l) => makeType(geos[s][v][l], `Trees_${sp.name}_v${v}_lod${l}`, s))));
  const cells = new Map();
  const meshes = [];
  const counts = [];

  const dummy = new THREE.Object3D();
  sites.forEach((t) => {
    const r1 = hashPos(t.x, 1.3, t.z);
    // the parks' elms are as often old oaks
    const sp = !t.pitRot && t.species === 2 && hashPos(t.z, 2.7, t.x) < 0.55 ? 3 : Math.min(SPECIES.length - 1, Math.max(0, t.species || 0));
    const r2 = hashPos(t.z, 7.1, t.x);
    const r3 = hashPos(t.x + t.z, 3.3, 0.7);
    const variant = hashPos(t.x, 5.9, t.z) < 0.5 ? 0 : 1;
    const s = t.scale * (0.9 + r1 * 0.2);
    dummy.position.set(t.x, t.y || 0, t.z);
    dummy.rotation.set(0, t.yaw ?? r2 * Math.PI * 2, 0);
    dummy.scale.set(s * (0.9 + r3 * 0.2) * (t.sx || 1), s * (0.88 + r1 * 0.24), s * (0.9 + r2 * 0.2) * (t.sz || 1));
    dummy.updateMatrix();
    const tree = treeBounds[sp][variant];
    worldBounds.copy(tree.bounds).applyMatrix4(dummy.matrix).expandByScalar(tree.margin);
    if (!clearOfBuildings(worldBounds)) return;
    const i = N++;
    plantedSites.add(t);
    trunks.push({ x: t.x, y: t.y || 0, z: t.z, radius: SPECIES[sp].trunk.r * s * 1.1, height: 7 * s });
    dummy.matrix.toArray(mats, i * 16);
    const hue = SPECIES[sp].tints[Math.floor(r3 * 2.999)], tone = 0.84 + r1 * 0.32;
    data.set([hue[0] * tone, hue[1] * tone, hue[2] * tone, sp + r2 * 0.999], i * 4);
    px[i] = t.x;
    py[i] = (t.y || 0) + 6 * s;
    pz[i] = t.z;
    tier[i] = Math.min(2, t.tier || 0);
    const cellX = Math.floor(t.x / TREE_CELL_SIZE);
    const cellZ = Math.floor(t.z / TREE_CELL_SIZE);
    const cellKey = (cellX + 32768) * 65536 + (cellZ + 32768);
    let cell = cells.get(cellKey);
    if (!cell) {
      const label = `${cellX},${cellZ}`;
      const cellGroup = new THREE.Group();
      cellGroup.name = `TreeCell_${label}`;
      cellGroup.visible = false;
      group.add(cellGroup);
      cell = { group: cellGroup, label, trees: [], meshes: new Map() };
      cells.set(cellKey, cell);
    }
    cell.trees.push(i);
    for (let l = 0; l < LEVELS; l++) {
      const type = meshIndex[sp][variant][l];
      let index = cell.meshes.get(type);
      if (index === undefined) {
        index = meshes.length;
        meshes.push({ type, cell, name: `${type.name}_${cell.label}`, capacity: 0 });
        cell.meshes.set(type, index);
      }
      meshOf[i * LEVELS + l] = index;
      meshes[index].capacity++;
    }
  });

  // Finalize per-cell 3D bounding spheres, tier cutoffs, and typed index arrays for cell-hierarchical LOD checks.
  const cellList = Array.from(cells.values(), (cell) => {
    const trees = Int32Array.from(cell.trees);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let maxCutoffAloft = 0;
    let minCutoffAloft = Infinity;
    for (let k = 0; k < trees.length; k++) {
      const i = trees[k];
      const x = px[i], y = py[i], z = pz[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      const td = MAX_DIST[tier[i]];
      if (td > maxCutoffAloft) maxCutoffAloft = td;
      if (td < minCutoffAloft) minCutoffAloft = td;
    }
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    let maxR2 = 0;
    for (let k = 0; k < trees.length; k++) {
      const i = trees[k];
      const dx = px[i] - cx, dy = py[i] - cy, dz = pz[i] - cz;
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 > maxR2) maxR2 = r2;
    }
    cell.trees = trees;
    cell.meshIndices = Int32Array.from(cell.meshes.values());
    cell.cx = cx;
    cell.cy = cy;
    cell.cz = cz;
    cell.radius = Math.sqrt(maxR2) + 1e-3;
    cell.maxCutoffAloft = maxCutoffAloft;
    cell.maxCutoffLow = Math.min(maxCutoffAloft, LOW_CUTOFF);
    cell.minCutoffAloft = minCutoffAloft;
    cell.minCutoffLow = Math.min(minCutoffAloft, LOW_CUTOFF);
    cell.uniformLod = 255;
    return cell;
  });

  const instanced = meshes.map((m) => {
    const geo = new THREE.BufferGeometry();
    for (const name of Object.keys(m.type.geo.attributes)) geo.setAttribute(name, m.type.geo.attributes[name]);
    geo.setIndex(m.type.geo.index);
    geo.boundingSphere = m.type.geo.boundingSphere;
    geo.boundingBox = m.type.geo.boundingBox;
    const cap = m.capacity;
    // Static usage on purpose: three.js re-uploads a DynamicDrawUsage attribute in every render pass of every frame
    // (both shadow cascades + the scene pass, ~7 MB/frame here). rebuild() uploads just the instances in use, and only
    // when the levels change.
    const treeData = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    geo.setAttribute('aTreeData', treeData);
    const mesh = new THREE.InstancedMesh(geo, materials[m.type.species], cap);
    mesh.name = m.name;
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    m.cell.group.add(mesh);
    m.type.meshes.push(mesh);
    counts.push(0);
    return mesh;
  });

  // Repack only cells whose trees changed level; the meshes and their buffer capacities stay fixed.
  const dirtyCells = new Set();
  function rebuild() {
    for (const cell of dirtyCells) {
      const mIndices = cell.meshIndices;
      if (cell.uniformLod === 255) {
        for (let m = 0; m < mIndices.length; m++) {
          const mi = mIndices[m];
          counts[mi] = 0;
          const mesh = instanced[mi];
          mesh.count = 0;
          mesh.visible = false;
        }
        cell.group.visible = false;
        continue;
      }
      for (let m = 0; m < mIndices.length; m++) counts[mIndices[m]] = 0;
      const trees = cell.trees;
      for (let k = 0; k < trees.length; k++) {
        const i = trees[k];
        const l = lod[i];
        if (l === 255) continue;
        const mi = meshOf[i * LEVELS + l];
        const mesh = instanced[mi];
        const c = counts[mi]++;
        const dstM = mesh.instanceMatrix.array;
        const srcM = i * 16;
        const dstMOff = c * 16;
        for (let j = 0; j < 16; j++) dstM[dstMOff + j] = mats[srcM + j];
        const dstD = mesh.geometry.attributes.aTreeData.array;
        const srcD = i * 4;
        const dstDOff = c * 4;
        dstD[dstDOff] = data[srcD];
        dstD[dstDOff + 1] = data[srcD + 1];
        dstD[dstDOff + 2] = data[srcD + 2];
        dstD[dstDOff + 3] = data[srcD + 3];
      }
      let visible = false;
      for (let m = 0; m < mIndices.length; m++) {
        const mi = mIndices[m];
        const mesh = instanced[mi];
        const n = counts[mi];
        mesh.count = n;
        mesh.visible = n > 0;
        if (n > 0) {
          visible = true;
          // main.js swaps instanceMatrix for a storage attribute: look it up here on every changed cell.
          for (const attr of [mesh.instanceMatrix, mesh.geometry.attributes.aTreeData]) {
            attr.clearUpdateRanges();
            attr.addUpdateRange(0, n * attr.itemSize);
            attr.needsUpdate = true;
          }
          mesh.computeBoundingSphere();
          mesh.boundingSphere.radius += meshes[mi].type.windPadding;
        }
      }
      // Hidden cells avoid traversing all their dormant species/variant/LOD meshes in every render pass.
      cell.group.visible = visible;
    }
    dirtyCells.clear();
  }

  // Squared LOD and hysteresis thresholds eliminate per-tree Math.sqrt and temporary array allocations.
  const BANDS = LOD_BANDS.map((d) => d * treeDetail);
  const BAND_SQ = BANDS.map((d) => d * d);
  const BAND_LO_SQ = BANDS.map((d) => (d - LOD_HYSTERESIS) * (d - LOD_HYSTERESIS));
  const BAND_HI_SQ = BANDS.map((d) => (d + LOD_HYSTERESIS) * (d + LOD_HYSTERESIS));
  const MAX_DIST_LOW = MAX_DIST.map((d) => Math.min(d, LOW_CUTOFF));
  const MAX_SQ_ALOFT = MAX_DIST.map((d) => d * d);
  const MAX_LO_SQ_ALOFT = MAX_DIST.map((d) => (d - LOD_HYSTERESIS) * (d - LOD_HYSTERESIS));
  const MAX_HI_SQ_ALOFT = MAX_DIST.map((d) => (d + LOD_HYSTERESIS) * (d + LOD_HYSTERESIS));
  const MAX_SQ_LOW = MAX_DIST_LOW.map((d) => d * d);
  const MAX_LO_SQ_LOW = MAX_DIST_LOW.map((d) => (d - LOD_HYSTERESIS) * (d - LOD_HYSTERESIS));
  const MAX_HI_SQ_LOW = MAX_DIST_LOW.map((d) => (d + LOD_HYSTERESIS) * (d + LOD_HYSTERESIS));

  function setCellUniformLod(cell, target) {
    if (cell.uniformLod === target) return false;
    const trees = cell.trees;
    let cellChanged = false;
    for (let k = 0; k < trees.length; k++) {
      const i = trees[k];
      if (lod[i] !== target) {
        lod[i] = target;
        cellChanged = true;
      }
    }
    cell.uniformLod = target;
    if (cellChanged) dirtyCells.add(cell);
    return cellChanged;
  }

  // Cell-hierarchical LOD update (3D distance to mid-crown) with exact hysteresis at every boundary.
  const last = new V3(Infinity, Infinity, Infinity);
  const cam = new V3();
  function update(position) {
    cam.copy(position);
    if (cam.distanceToSquared(last) < 16) return false;
    last.copy(cam);
    const camX = cam.x, camY = cam.y, camZ = cam.z;
    const low = camY < 40;
    const maxSq = low ? MAX_SQ_LOW : MAX_SQ_ALOFT;
    const maxLoSq = low ? MAX_LO_SQ_LOW : MAX_LO_SQ_ALOFT;
    const maxHiSq = low ? MAX_HI_SQ_LOW : MAX_HI_SQ_ALOFT;
    let changed = false;

    for (let ci = 0; ci < cellList.length; ci++) {
      const cell = cellList[ci];
      const cdx = cell.cx - camX;
      const cdy = cell.cy - camY;
      const cdz = cell.cz - camZ;
      const centerDist = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz);
      const minD = centerDist - cell.radius;
      const maxDCell = centerDist + cell.radius;
      const cellMaxCutoff = low ? cell.maxCutoffLow : cell.maxCutoffAloft;

      // Fast-path cells lying wholly outside the cutoff or wholly inside a single interior LOD band.
      if (minD >= cellMaxCutoff + LOD_HYSTERESIS) {
        if (setCellUniformLod(cell, 255)) changed = true;
        continue;
      }
      const cellMinCutoff = low ? cell.minCutoffLow : cell.minCutoffAloft;
      let band = -1;
      for (let b = 0; b < BANDS.length && band < 0; b++) {
        if (minD >= (b ? BANDS[b - 1] + LOD_HYSTERESIS : -Infinity) && maxDCell < BANDS[b] - LOD_HYSTERESIS) band = b;
      }
      if (band < 0 && minD >= BANDS[BANDS.length - 1] + LOD_HYSTERESIS && maxDCell < cellMinCutoff - LOD_HYSTERESIS) band = FAREST;
      if (band >= 0) {
        if (setCellUniformLod(cell, band)) changed = true;
        continue;
      }

      // Only cells straddling an LOD / hysteresis boundary evaluate per-tree squared distances.
      const trees = cell.trees;
      let cellChanged = false;
      let firstLod = 0;
      let allSame = true;
      for (let k = 0; k < trees.length; k++) {
        const i = trees[k];
        const dx = px[i] - camX;
        const dy = py[i] - camY;
        const dz = pz[i] - camZ;
        const d2 = dx * dx + dy * dy + dz * dz;
        const t = tier[i];
        const cur = lod[i];
        const curL = cur === 255 ? LEVELS : cur;
        let nextL = d2 < BAND_SQ[0] ? 0 : d2 < BAND_SQ[1] ? 1 : d2 < BAND_SQ[2] ? 2 : d2 < maxSq[t] ? FAREST : LEVELS;
        if (nextL - curL === 1) {
          if (d2 < (curL < FAREST ? BAND_HI_SQ[curL] : maxHiSq[t])) nextL = curL;
        } else if (curL - nextL === 1) {
          if (d2 > (nextL < FAREST ? BAND_LO_SQ[nextL] : maxLoSq[t])) nextL = curL;
        }
        const next = nextL === LEVELS ? 255 : nextL;
        if (next !== cur) {
          lod[i] = next;
          cellChanged = true;
        }
        if (k === 0) firstLod = next;
        else if (next !== firstLod) allSame = false;
      }
      cell.uniformLod = allSame ? firstLod : -1;
      if (cellChanged) {
        dirtyCells.add(cell);
        changed = true;
      }
    }

    if (changed) rebuild();
    return changed;
  }

  // Levels for the start-up view (Midtown, 5th Ave), so the precompile pass sees the tree meshes
  update(new V3(0, 10, 140));

  // Precompile one visible representative per geometry; the other cells use exactly the same pipeline.
  for (const type of types) {
    const representative = type.meshes.find((mesh) => mesh.visible) || type.meshes[0];
    for (const mesh of type.meshes) if (mesh !== representative) mesh.userData.sharesPipelineWith = representative;
  }

  // Tree placements are world-space instance matrices; the field, cells and meshes keep identity transforms.
  // Freezing both avoids recomputing thousands of dormant objects in every view and shadow pass.
  group.traverse((object) => {
    object.matrixAutoUpdate = false;
    object.matrixWorldAutoUpdate = false;
  });

  const stats = {
    trees: N,
    triangles: geos.map((v) => v.map((l) => l.map((g) => g && g.userData.triangles))),
    cards: geos.map((v) => v.map((l) => l.map((g) => g && g.userData.cards)))
  };
  return { group, materials, update, meshes: instanced, stats, sites: plantedSites, trunks };
}

export { createTreeField, buildTreeGeometries, setTreeDetail, SPECIES as TREE_SPECIES };
