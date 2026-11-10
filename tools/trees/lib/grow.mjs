// Grows a tree's skeleton: trunk, limbs, branches and the sites where its twigs carry leaves.
//
// A tree is described by its outline (how wide its crown is at each height) and by how each order of branch leaves
// its parent: how many, where along it, at what angle, how long, and which way it bends as it grows (toward the
// light, outward, or down under its own weight). Branches stop where the outline says the crown ends, so the
// silhouette is the species' own, while what happens inside stays irregular. Thickness then follows from what each
// branch carries (the pipe model: a limb is as thick as the sum of what grows out of it).

import { rng, V, clamp, lerp, smooth, noise1 } from './util.mjs';

// Crown outlines: relative radius at t = 0 (foot of the crown) .. 1 (top)
const bump = (t, peak, sharp) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(clamp(t), Math.log(0.5) / Math.log(peak)))), sharp);
export const SHAPES = {
  round: (t) => bump(t, 0.5, 0.55),
  oval: (t) => bump(t, 0.48, 0.7),
  dome: (t) => bump(t, 0.36, 0.45), // broad, widest low: plane, oak, locust
  // narrow below, widening steadily to a broad rounded top: elm, zelkova
  vase: (t) => Math.min(1, 0.3 + 1.15 * t) * (t > 0.62 ? Math.sqrt(Math.max(0, 1 - ((t - 0.62) / 0.38) ** 2)) : 1),
  cone: (t) => bump(t, 0.24, 0.6) * (1 - 0.25 * t), // widest near the foot, a pointed top: pin oak, linden
  drop: (t) => bump(t, 0.4, 0.8), // an upright egg: pear
  spire: (t) => bump(t, 0.34, 0.9) // narrow and tall: ginkgo
};

/** The crown's outline as a function: how far a point is from the trunk axis relative to the crown's edge there. */
export function makeEnvelope(sp, seed) {
  const lumps = noise1(seed * 5 + 3), lumps2 = noise1(seed * 7 + 11);
  const top = sp.height, base = sp.crownBase;
  const shape = SHAPES[sp.shape];
  // the edge, at height y and bearing a: the outline, pushed in and out by a few broad lobes
  const radius = (y, a) => {
    // under the crown's foot the outline keeps the width it has there: limbs leave the trunk below it and rise into it
    const t = Math.max(0.07, (y - base) / (top - base));
    if (t >= 1) return 0;
    const lobes = 1 + sp.lumps * (0.65 * lumps((a / (Math.PI * 2)) * 5 + y * 0.11) + 0.35 * lumps2((a / (Math.PI * 2)) * 11 + y * 0.23));
    return sp.radius * shape(t) * lobes;
  };
  return {
    top, base, radius,
    // 0 on the axis, 1 on the crown's edge, more outside
    depth(p) {
      const r = radius(p[1], Math.atan2(p[2], p[0]));
      if (r <= 0) return 9;
      return Math.hypot(p[0], p[2]) / r;
    }
  };
}

/**
 * One branch as a polyline grown step by step.
 * bend: { up, out, flat, droop, wander } per metre: toward the sky, away from the trunk axis, toward the horizontal,
 * down toward the tip (weight), and how much it meanders.
 */
function growLine({ start, dir, length, step, bend, envelope, stop = 1, floor = 0, seed }) {
  const pts = [start];
  const wx = noise1(seed), wy = noise1(seed + 1);
  let d = dir, p = start, run = 0;
  const steps = Math.max(2, Math.round(length / step));
  const ds = length / steps;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const out = V.norm([p[0], 0, p[2]]);
    const side = V.perp(d), other = V.cross(d, side);
    const flat = V.norm([d[0], 0, d[2]]);
    let nd = d;
    nd = V.mad(nd, [0, 1, 0], (bend.up - bend.droop * t * 2) * ds);
    nd = V.mad(nd, out, bend.out * ds);
    if (bend.flat) nd = V.mad(nd, flat, bend.flat * ds);
    nd = V.mad(nd, side, wx(run * 0.9) * bend.wander * ds);
    nd = V.mad(nd, other, wy(run * 0.9) * bend.wander * ds);
    // never down into the clearance kept under the crown
    if (p[1] < floor + 0.6 && nd[1] < 0.1) nd = V.mad(nd, [0, 1, 0], 0.5);
    d = V.norm(nd);
    p = V.mad(p, d, ds);
    run += ds;
    pts.push(p);
    if (envelope && i > 1 && envelope.depth(p) > stop) break;
  }
  return pts;
}

function finish(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + V.dist(pts[i - 1], pts[i]));
  return { pts, cum, length: cum[cum.length - 1] };
}

/** Point and direction at arc length fraction t of a branch */
export function along(b, t) {
  const s = clamp(t) * b.length;
  let i = 0;
  while (i < b.cum.length - 2 && b.cum[i + 1] < s) i++;
  const span = b.cum[i + 1] - b.cum[i] || 1;
  const k = clamp((s - b.cum[i]) / span);
  return { p: V.lerp(b.pts[i], b.pts[i + 1], k), d: V.norm(V.sub(b.pts[i + 1], b.pts[i])), i, k };
}

// How far a ray from p along d travels before it leaves the crown (marching, coarse on purpose)
function reach(envelope, p, d, limit, stop = 1) {
  const ds = 0.4;
  for (let s = ds; s < limit; s += ds) if (envelope.depth(V.mad(p, d, s)) > stop) return s;
  return limit;
}

/**
 * Grows a tree. Returns { branches, sites, envelope, species }:
 * branches: [{ pts, cum, length, level, parent, parentT, rad[] }], trunk first, parents before children
 * sites: [{ p, d, branch, t, size }] where twigs carry leaves
 */
export function growTree(sp, seed) {
  const r = rng(seed);
  const envelope = makeEnvelope(sp, seed);
  const branches = [];
  const add = (pts, level, parent, parentT) => {
    const b = { ...finish(pts), level, parent, parentT, index: branches.length };
    branches.push(b);
    return b;
  };

  // --- Trunk: to the top for a tree with a leader, to its fork otherwise
  const T = sp.trunk;
  const leanAz = r() * Math.PI * 2;
  const trunkTop = sp.leader ? sp.height * 0.96 : sp.fork;
  const trunk = add(growLine({
    start: [0, 0, 0], dir: V.norm([Math.cos(leanAz) * T.lean, 1, Math.sin(leanAz) * T.lean]), length: trunkTop, step: 0.3,
    bend: { up: 0.02, out: 0, droop: 0, wander: T.wander }, seed: seed * 13 + 1
  }), 0, -1, 0);

  // --- Branches of each order off the one before
  const grow = (parent, L, order) => {
    const kids = [];
    const span = parent.length * (L.t[1] - L.t[0]);
    const n = L.n ? L.n + (L.nVary && r() < 0.5 ? 1 : 0) : Math.max(1, Math.round(span / L.spacing));
    let roll = r() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const f = n > 1 ? (i + (L.n ? 0.5 * r() : r() * 0.8)) / (L.n ? n - 0.5 : n) : 0.5;
      const t = lerp(L.t[0], L.t[1], clamp(f));
      const at = along(parent, t);
      // which way round the parent: a spiral up an upright stem, left and right in layers along a leaning one
      let dir;
      const angle = lerp(L.angle[0], L.angle[1], f) * (1 + (r() - 0.5) * 0.3);
      const upright = Math.abs(at.d[1]) > 0.8 || L.roll === 'spiral';
      if (upright) {
        roll += (L.n ? (Math.PI * 2) / n : 2.39996) + (r() - 0.5) * 0.7;
        dir = V.deflect(at.d, angle, roll);
      } else {
        const side = V.norm(V.cross(at.d, [0, 1, 0]));
        const tip = (r() - 0.5) * 1.1 + (L.lift || 0); // out of the layer, a little toward the sky
        const lateral = V.norm(V.mad(V.scale(side, i % 2 ? 1 : -1), V.cross(side, at.d), tip));
        dir = V.norm(V.mad(V.scale(at.d, Math.cos(angle)), lateral, Math.sin(angle)));
      }
      // not back into the middle of the crown
      const out = V.norm([at.p[0], 0, at.p[2]]);
      if (order > 1 && V.dot(dir, out) < -0.1 && Math.hypot(at.p[0], at.p[2]) > 0.8) dir = V.norm(V.mad(dir, out, 0.9));
      const room = reach(envelope, at.p, dir, 30, L.stop || 1);
      let length = L.len ? lerp(L.len[0], L.len[1], f) : room;
      if (L.share) length = Math.min(length, Math.max(L.min || 0.6, parent.length * (1 - t) * L.share + (L.min || 0.6)));
      length = Math.min(length, room * 1.05) * (0.85 + r() * 0.3);
      if (length < (L.min || 0.5) * 0.6) continue;
      const pts = growLine({
        start: at.p, dir, length, step: L.step || 0.3, bend: L.bend, envelope, stop: (L.stop || 1) * (0.94 + r() * 0.12),
        floor: sp.clearance, seed: seed * 31 + branches.length * 7
      });
      if (pts.length < 3) continue;
      kids.push(add(pts, order, parent.index, t));
    }
    return kids;
  };

  let parents = [trunk];
  sp.orders.forEach((L, k) => {
    const next = [];
    for (const parent of parents) {
      // short stubs carry nothing further
      if (k > 0 && parent.length < (L.need || 1.2)) continue;
      next.push(...grow(parent, L, k + 1));
    }
    // a tree with a leader keeps growing its top out of the trunk itself: the trunk's tip counts as a limb
    parents = next;
  });

  // --- Where twigs carry leaves: along the fine branches and at every tip, out where the light is
  const sites = [];
  const F = sp.foliage;
  const lastOrder = sp.orders.length;
  for (const b of branches) {
    if (b.level === 0 && !sp.leader) continue;
    const fine = b.level >= lastOrder - (F.reachUp || 1);
    if (!fine && !(b.level === 0)) continue;
    const from = b.level === lastOrder ? F.t[0] : Math.max(F.t[0], 0.45);
    const n = Math.max(1, Math.round((b.length * (1 - from)) / F.spacing));
    for (let i = 0; i <= n; i++) {
      const t = i === n ? 1 : lerp(from, 1, (i + r() * 0.7) / n);
      const at = along(b, t);
      const depth = envelope.depth(at.p);
      if (at.p[1] < sp.clearance) continue;
      // the heart of the crown is bare: leaves live where light reaches
      if (depth < F.core && r() < 0.9) continue;
      if (depth < F.core + 0.18 && r() < 0.45) continue;
      let d;
      if (i === n) d = at.d;
      else {
        const side = V.norm(V.cross(at.d, [0, 1, 0]));
        const lateral = V.norm(V.mad(V.scale(side, i % 2 ? 1 : -1), [0, 1, 0], 0.25 + r() * 0.5));
        d = V.norm(V.mad(V.scale(at.d, 0.55 + r() * 0.3), lateral, 0.8));
      }
      const out = V.norm([at.p[0], (at.p[1] - (envelope.base + envelope.top) / 2) * 0.5, at.p[2]]);
      if (V.dot(d, out) < 0) d = V.norm(V.mad(d, out, 1.0));
      d = V.norm(V.add(d, [0, F.lift - F.droop, 0]));
      sites.push({ p: at.p, d, branch: b.index, t, size: (0.82 + r() * 0.36) * (i === n ? 1.08 : 1), depth });
    }
  }

  setRadii(branches, sites, sp);
  return { branches, sites, envelope, species: sp };
}

/** Thickness along every branch from what it carries, then scaled so the trunk has the species' diameter. */
function setRadii(branches, sites, sp) {
  const tip = sp.twig || 0.006;
  const power = sp.pipe || 2.3;
  const kidsOf = branches.map(() => []);
  for (const b of branches) if (b.parent >= 0) kidsOf[b.parent].push(b);
  const sitesOn = branches.map(() => []);
  for (const s of sites) sitesOn[s.branch].push(s.t);
  // children first: branches are listed parents first
  for (let k = branches.length - 1; k >= 0; k--) {
    const b = branches[k];
    const n = b.pts.length;
    const flow = new Float64Array(n);
    // what joins at each point, walking from the tip down
    const joins = kidsOf[k].map((c) => ({ t: c.parentT, flow: Math.pow(c.rad[0], power) }));
    for (const t of sitesOn[k]) joins.push({ t, flow: Math.pow(tip, power) * 0.5 });
    let carry = Math.pow(tip, power);
    for (let i = n - 1; i >= 0; i--) {
      const t0 = b.cum[i] / b.length, t1 = i + 1 < n ? b.cum[i + 1] / b.length : 2;
      for (const j of joins) if (j.t >= t0 && j.t < t1) carry += j.flow;
      // wood thickens a little with every metre even where nothing joins
      if (i + 1 < n) carry += Math.pow(tip, power) * (b.cum[i + 1] - b.cum[i]) * 1.2;
      flow[i] = carry;
    }
    b.rad = Array.from(flow, (f) => Math.pow(f, 1 / power));
  }
  // The trunk at breast height gets the species' diameter; everything else keeps its proportion, tips stay tips
  const trunk = branches[0];
  let at = 0;
  while (at < trunk.pts.length - 1 && trunk.pts[at][1] < 1.3) at++;
  const have = trunk.rad[at], want = sp.dbh / 2;
  const scale = (x) => tip + (x - tip) * ((want - tip) / Math.max(1e-6, have - tip));
  for (const b of branches) b.rad = b.rad.map((x) => Math.max(tip, scale(x)));
  // A child is never thicker than the parent it leaves
  for (const b of branches) {
    if (b.parent < 0) continue;
    const p = branches[b.parent];
    const here = along(p, b.parentT);
    const limit = lerp(p.rad[here.i], p.rad[here.i + 1], here.k) * 0.86;
    if (b.rad[0] > limit) { const k = limit / b.rad[0]; b.rad = b.rad.map((x) => Math.max(tip, x * k)); }
  }
  // the trunk's foot flares into the ground
  trunk.rad = trunk.rad.map((x, i) => x * (1 + 0.55 * Math.exp(-trunk.pts[i][1] / 0.35)));
}
