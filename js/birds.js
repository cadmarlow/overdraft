import * as THREE from 'three/webgpu';
import {
  attribute, positionGeometry, normalGeometry, positionLocal, normalLocal, positionPrevious, instanceColor,
  normalView, positionViewDirection, vec3, vec4, float, sin, cos, mix, smoothstep, step, abs, normalize, max, min,
  floor, fract, dot, sign, varying, Fn
} from 'three/tsl';
import { createBirdSim } from './birds-flock.js';

// The animals of the street, drawn: one instanced mesh each for the pigeons, the gulls and the rats (three draws), all
// low-poly geometry built here. The wings are two articulated panels each (arm and hand), beaten, held in a glide or
// folded along the flanks in the vertex shader from a per-instance (phase, amplitude, fold, head) attribute; the head
// nods about the neck the same way (pecking), a bird's legs tuck up in flight, a rat's tail waves and its legs stride.
// Plumage is the instance colour; the parts (beak, feet, eyes, iridescent neck, wing bars, tail band, a gull's grey
// mantle and black wingtips) are painted per vertex, and white pigeons are speckled. birds-flock.js decides everything
// they do. The meshes stay at the origin: their instance matrices are all there is to update.

// ---- Geometry -------------------------------------------------------------------------------------------------------
// Parts (birdPart.x): 0 body, 1 head (nods about its hinge), 2 bird tail, 3 inner wing, 4 outer wing, 5 rat tail,
// 6 bird legs (tucked in flight), 7 rat legs (stride). birdPart = (part, side, paint, extra): extra is the outer wing's
// rest angle, the rat tail's coordinate along it, or a rat leg's phase. birdHinge = (pivot xyz, wrist distance).
// birdFold = where the vertex goes when the wing is folded (or the leg tucked).
// Paints (birdPart.z): 0 plumage, 1 head, 2 iridescent neck, 3 black, 4 dark beak, 5 yellow beak, 6 coral feet,
// 7 pink feet, 8 light (rump, belly, underwing), 9 gull mantle, 10 rat skin, 11 black eye, 12 orange eye,
// 13 primaries, 14 plain (never speckled), 20 + t wing coverts (bars at t), 21 + t tail (band at its end).
const PAINT_FIXED = {
  3: [0.035, 0.035, 0.04], 4: [0.1, 0.09, 0.09], 5: [0.86, 0.66, 0.14], 6: [0.62, 0.2, 0.2], 7: [0.74, 0.55, 0.52],
  9: [0.5, 0.55, 0.6], 10: [0.46, 0.34, 0.33], 11: [0.015, 0.015, 0.015], 12: [0.85, 0.36, 0.06]
};

class ShapeBuilder {
  constructor() {
    this.pos = [];
    this.part = [];
    this.hinge = [];
    this.fold = [];
    this.index = [];
  }

  vertex(p, info, paint, extra = info.extra ?? 0, folded = null) {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.part.push(info.part, info.side ?? 0, paint, extra);
    const h = info.hinge || [0, 0, 0, 0];
    this.hinge.push(h[0], h[1], h[2], h[3] ?? 0);
    const f = folded || (info.fold ? info.fold(p) : p);
    this.fold.push(f[0], f[1], f[2]);
    return i;
  }

  // A tube along a path in the y-z plane: rings of `sides` (radii rx across, ry in the path's plane), closed by cone
  // tips at either end. paint(stationIndex, angle) colours each vertex; extra(stationIndex) feeds birdPart.w.
  loft(stations, { sides, start = null, end = null, info, paint = () => 0, extra = null }) {
    const rings = [];
    for (let s = 0; s < stations.length; s++) {
      const c = stations[s].c;
      const a = stations[Math.max(0, s - 1)].c, b = stations[Math.min(stations.length - 1, s + 1)].c;
      let ty = b[1] - a[1], tz = b[2] - a[2];
      const tl = Math.hypot(ty, tz) || 1;
      ty /= tl; tz /= tl;
      // N = T x X with X = (1, 0, 0): (0, tz, -ty)
      const ny = tz, nz = -ty;
      const ring = [];
      for (let k = 0; k < sides; k++) {
        const ang = (k / sides) * Math.PI * 2;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const p = [c[0] + stations[s].rx * ca, c[1] + ny * stations[s].ry * sa, c[2] + nz * stations[s].ry * sa];
        ring.push(this.vertex(p, info, paint(s, ang), extra ? extra(s) : info.extra ?? 0));
      }
      rings.push(ring);
    }
    for (let s = 0; s < rings.length - 1; s++) {
      for (let k = 0; k < sides; k++) {
        const a = rings[s][k], b = rings[s][(k + 1) % sides], c = rings[s + 1][k], d = rings[s + 1][(k + 1) % sides];
        this.index.push(a, b, c, b, d, c);
      }
    }
    if (start) {
      const tip = this.vertex(start.p, info, start.paint ?? 0, start.extra ?? info.extra ?? 0);
      for (let k = 0; k < sides; k++) this.index.push(tip, rings[0][(k + 1) % sides], rings[0][k]);
    }
    if (end) {
      const tip = this.vertex(end.p, info, end.paint ?? 0, end.extra ?? info.extra ?? 0);
      const last = rings[rings.length - 1];
      for (let k = 0; k < sides; k++) this.index.push(tip, last[k], last[(k + 1) % sides]);
    }
  }

  // A flat convex polygon facing `facing` (and its back, facing away, when `back` paints are given). Points:
  // { p, paint, backPaint, fold, extra }.
  panel(points, info, facing, twoSided = true) {
    const [a, b, c] = points.map((q) => q.p);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const flip = n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2] < 0;
    const front = points.map((q) => this.vertex(q.p, info, q.paint, q.extra ?? info.extra ?? 0, q.fold));
    for (let k = 1; k < front.length - 1; k++) {
      if (flip) this.index.push(front[0], front[k + 1], front[k]);
      else this.index.push(front[0], front[k], front[k + 1]);
    }
    if (!twoSided) return;
    const back = points.map((q) => this.vertex(q.p, info, q.backPaint ?? q.paint, q.extra ?? info.extra ?? 0, q.backFold ?? q.fold));
    for (let k = 1; k < back.length - 1; k++) {
      if (flip) this.index.push(back[0], back[k], back[k + 1]);
      else this.index.push(back[0], back[k + 1], back[k]);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.index);
    g.computeVertexNormals();
    g.setAttribute('birdPart', new THREE.Float32BufferAttribute(this.part, 4));
    g.setAttribute('birdHinge', new THREE.Float32BufferAttribute(this.hinge, 4));
    g.setAttribute('birdFold', new THREE.Float32BufferAttribute(this.fold, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// Half width of an elliptic body section (centre cy, radii rx, ry) at height y
const halfWidth = (sec, y) => sec.rx * Math.sqrt(Math.max(0, 1 - ((y - sec.cy) / sec.ry) ** 2));
function bodySection(stations, z) {
  for (let s = 0; s < stations.length - 1; s++) {
    const a = stations[s], b = stations[s + 1];
    if (z >= a.c[2] && z <= b.c[2]) {
      const t = (z - a.c[2]) / (b.c[2] - a.c[2] || 1);
      return { cy: a.c[1] + (b.c[1] - a.c[1]) * t, rx: a.rx + (b.rx - a.rx) * t, ry: a.ry + (b.ry - a.ry) * t };
    }
  }
  const e = z < stations[0].c[2] ? stations[0] : stations[stations.length - 1];
  return { cy: e.c[1], rx: e.rx * 0.6, ry: e.ry };
}

// Rock pigeon, 32 cm, origin at its feet, facing +z
function pigeonGeometry() {
  const g = new ShapeBuilder();
  const body = [
    { c: [0, 0.112, -0.095], rx: 0.026, ry: 0.022 },
    { c: [0, 0.103, -0.045], rx: 0.05, ry: 0.048 },
    { c: [0, 0.102, 0.005], rx: 0.058, ry: 0.062 },
    { c: [0, 0.115, 0.05], rx: 0.05, ry: 0.058 }
  ];
  g.loft(body, {
    sides: 8, info: { part: 0 },
    start: { p: [0, 0.111, -0.125], paint: 8 }, end: { p: [0, 0.133, 0.085], paint: 0 },
    paint: (s, a) => (s === 0 && Math.sin(a) > 0.3 ? 8 : 0) // a pale rump
  });
  const pivot = [0, 0.125, 0.045];
  const headInfo = { part: 1, hinge: [...pivot, 0] };
  g.loft([
    { c: [0, 0.13, 0.05], rx: 0.033, ry: 0.03 },
    { c: [0, 0.165, 0.068], rx: 0.026, ry: 0.026 },
    { c: [0, 0.19, 0.08], rx: 0.023, ry: 0.024 },
    { c: [0, 0.197, 0.098], rx: 0.019, ry: 0.019 },
    { c: [0, 0.192, 0.111], rx: 0.006, ry: 0.005 }
  ], {
    sides: 6, info: headInfo, end: { p: [0, 0.188, 0.127], paint: 4 },
    paint: (s) => (s < 2 ? 2 : s < 4 ? 1 : 4) // iridescent neck, slate head, dark beak
  });
  for (const side of [-1, 1]) {
    const x = side * 0.0228, y = 0.194, z = 0.086, e = 0.0055;
    g.panel([{ p: [x, y + e, z], paint: 12 }, { p: [x, y, z + e], paint: 12 }, { p: [x, y - e, z], paint: 12 }, { p: [x, y, z - e], paint: 12 }],
      headInfo, [side, 0, 0], false);
  }
  // tail: a flat fan with some thickness at its root, the dark band near its end
  g.loft([{ c: [0, 0.112, -0.085], rx: 0.022, ry: 0.009 }, { c: [0, 0.1, -0.212], rx: 0.042, ry: 0.003 }], {
    sides: 4, info: { part: 2 }, end: { p: [0, 0.1, -0.218], paint: 21.98 }, paint: (s) => 21 + s * 0.98
  });
  // wings, spread level at rest. Folded, the arm (in two strips, so it follows the body's curve) lies along the upper
  // flank with its bars across it, and the hand runs back over the rump to cross its fellow above the tail.
  const S = { x: 0.034, y: 0.127, z: 0.035 }, wrist = 0.131;
  for (const side of [-1, 1]) {
    const fold = (u, v, layer) => {
      const wu = Math.min(u, 0.4), hand = Math.max(0, u - 0.4);
      const z = S.z + 0.028 - wu * 0.1 - v * 0.052 - hand * 0.27;
      const y = S.y - 0.038 + v * 0.046 - wu * 0.03 + hand * 0.03;
      const sec = bodySection(body, z);
      const w = Math.max(0.012, (halfWidth(sec, y) + 0.008) * (1 - hand * 1.25));
      return [side * (w + (hand ? 0.004 : 0) - layer * 0.003), y, z];
    };
    const pt = (x, z, u, v, top, bottom) => ({ p: [side * x, S.y, z], paint: top, backPaint: bottom, fold: fold(u, v, 0), backFold: fold(u, v, 1) });
    const hinge = [side * S.x, S.y, S.z, wrist];
    const arm = { part: 3, side, hinge };
    g.panel([pt(0.034, 0.068, 0, 0, 20, 8), pt(0.165, 0.06, 0.4, 0, 20, 8), pt(0.165, 0.0025, 0.4, 0.5, 20.49, 8), pt(0.034, -0.001, 0, 0.5, 20.49, 8)], arm, [0, 1, 0]);
    g.panel([pt(0.034, -0.001, 0, 0.5, 20.49, 8), pt(0.165, 0.0025, 0.4, 0.5, 20.49, 8), pt(0.165, -0.055, 0.4, 0.98, 20.98, 8), pt(0.034, -0.07, 0, 0.98, 20.98, 8)], arm, [0, 1, 0]);
    g.panel([pt(0.165, 0.06, 0.4, 0, 13, 8), pt(0.29, 0.02, 0.8, 0.1, 13, 8), pt(0.335, -0.03, 1, 0.5, 13, 8), pt(0.25, -0.075, 0.75, 1, 13, 8), pt(0.165, -0.055, 0.4, 1, 13, 8)],
      { part: 4, side, hinge, extra: 0 }, [0, 1, 0]);
  }
  // short coral legs and toes, tucked up into the belly in flight
  for (const side of [-1, 1]) {
    const x = side * 0.016;
    const legInfo = { part: 6, side, hinge: [x, 0.06, 0, 0], fold: (p) => [p[0] * 0.8, 0.07 + p[1] * 0.15, p[2] - 0.025] };
    g.loft([{ c: [x, 0.062, 0], rx: 0.0055, ry: 0.0055 }, { c: [x, 0.008, 0.01], rx: 0.0042, ry: 0.0042 }], { sides: 3, info: legInfo, paint: () => 6 });
    const toe = (dx, dz) => ({ p: [x + dx, 0.004, 0.01 + dz], paint: 6 });
    g.panel([toe(-0.012, -0.004), toe(0.012, -0.004), toe(0, 0.03)], legInfo, [0, 1, 0]);
  }
  return g.build();
}

// Herring gull, 1.3 m across, origin at its centre; never lands here, so no legs
function gullGeometry() {
  const g = new ShapeBuilder();
  g.loft([
    { c: [0, 0.012, -0.15], rx: 0.03, ry: 0.026 },
    { c: [0, 0.0, -0.06], rx: 0.06, ry: 0.055 },
    { c: [0, 0.005, 0.03], rx: 0.065, ry: 0.065 },
    { c: [0, 0.02, 0.1], rx: 0.05, ry: 0.055 }
  ], {
    sides: 8, info: { part: 0 }, start: { p: [0, 0.01, -0.2], paint: 14 }, end: { p: [0, 0.035, 0.15], paint: 14 },
    paint: (s, a) => (s >= 1 && s <= 2 && Math.sin(a) > 0.6 ? 9 : 14)
  });
  const headInfo = { part: 1, hinge: [0, 0.03, 0.11, 0] };
  g.loft([
    { c: [0, 0.03, 0.11], rx: 0.04, ry: 0.04 },
    { c: [0, 0.055, 0.15], rx: 0.032, ry: 0.032 },
    { c: [0, 0.07, 0.175], rx: 0.03, ry: 0.03 },
    { c: [0, 0.072, 0.2], rx: 0.022, ry: 0.022 },
    { c: [0, 0.066, 0.215], rx: 0.009, ry: 0.012 }
  ], { sides: 6, info: headInfo, end: { p: [0, 0.058, 0.27], paint: 5 }, paint: (s) => (s === 4 ? 5 : 14) });
  for (const side of [-1, 1]) {
    const x = side * 0.0295, y = 0.078, z = 0.182, e = 0.006;
    g.panel([{ p: [x, y + e, z], paint: 11 }, { p: [x, y, z + e], paint: 11 }, { p: [x, y - e, z], paint: 11 }, { p: [x, y, z - e], paint: 11 }],
      headInfo, [side, 0, 0], false);
  }
  const tp = (x, y, z) => ({ p: [x, y, z], paint: 14 });
  g.panel([tp(-0.04, 0.015, -0.16), tp(0.04, 0.015, -0.16), tp(0.055, 0.008, -0.27), tp(-0.055, 0.008, -0.27)], { part: 2 }, [0, 1, 0]);
  const S = { x: 0.05, y: 0.03, z: 0.05 };
  for (const side of [-1, 1]) {
    const hinge = [side * S.x, S.y, S.z, 0.25];
    const pt = (x, z, top, bottom) => ({ p: [side * x, S.y, z], paint: top, backPaint: bottom });
    g.panel([pt(0.05, 0.085, 9, 14), pt(0.3, 0.07, 9, 14), pt(0.3, -0.085, 9, 14), pt(0.05, -0.11, 9, 14)], { part: 3, side, hinge }, [0, 1, 0]);
    // the hand angled down from the wrist: the gull's M
    g.panel([pt(0.3, 0.07, 9, 14), pt(0.52, 0.0, 3, 14), pt(0.64, -0.09, 3, 3), pt(0.5, -0.12, 9, 14), pt(0.3, -0.085, 9, 14)],
      { part: 4, side, hinge, extra: -0.28 }, [0, 1, 0]);
  }
  return g.build();
}

// Brown rat, 25 cm without its tail, origin on the ground under it
function ratGeometry() {
  const g = new ShapeBuilder();
  g.loft([
    { c: [0, 0.048, -0.095], rx: 0.028, ry: 0.028 },
    { c: [0, 0.05, -0.04], rx: 0.042, ry: 0.04 },
    { c: [0, 0.048, 0.02], rx: 0.038, ry: 0.036 },
    { c: [0, 0.044, 0.055], rx: 0.03, ry: 0.028 }
  ], {
    sides: 8, info: { part: 0 }, start: { p: [0, 0.045, -0.115], paint: 0 }, end: { p: [0, 0.045, 0.075], paint: 0 },
    paint: (s, a) => (Math.sin(a) < -0.5 ? 8 : 0)
  });
  const headInfo = { part: 1, hinge: [0, 0.045, 0.06, 0] };
  g.loft([
    { c: [0, 0.046, 0.065], rx: 0.026, ry: 0.024 },
    { c: [0, 0.044, 0.095], rx: 0.02, ry: 0.019 },
    { c: [0, 0.037, 0.125], rx: 0.01, ry: 0.01 }
  ], { sides: 6, info: headInfo, end: { p: [0, 0.032, 0.145], paint: 10 } });
  for (const side of [-1, 1]) {
    const x = side * 0.0195, y = 0.05, z = 0.1, e = 0.004;
    g.panel([{ p: [x, y + e, z], paint: 11 }, { p: [x, y, z + e], paint: 11 }, { p: [x, y - e, z], paint: 11 }, { p: [x, y, z - e], paint: 11 }],
      headInfo, [side, 0, 0], false);
    const ex = side * 0.014;
    g.panel([{ p: [ex - side * 0.004, 0.058, 0.078], paint: 10 }, { p: [ex + side * 0.01, 0.077, 0.082], paint: 10 }, { p: [ex + side * 0.012, 0.06, 0.093], paint: 10 }],
      headInfo, [side, 0.3, 0.6]);
  }
  const tail = [
    { c: [0, 0.04, -0.105], rx: 0.009, ry: 0.009 },
    { c: [0, 0.032, -0.16], rx: 0.007, ry: 0.007 },
    { c: [0, 0.022, -0.22], rx: 0.005, ry: 0.005 },
    { c: [0, 0.014, -0.28], rx: 0.0035, ry: 0.0035 }
  ];
  g.loft(tail, {
    sides: 3, info: { part: 5, hinge: [0, 0.04, -0.105, 0] }, paint: () => 10,
    extra: (s) => s / 4, end: { p: [0, 0.01, -0.33], paint: 10, extra: 1 }
  });
  // legs: diagonal pairs stride together
  for (const [x, z, phase] of [[0.028, 0.04, 0], [-0.028, 0.04, Math.PI], [0.03, -0.06, Math.PI], [-0.03, -0.06, 0]]) {
    const info = { part: 7, side: Math.sign(x), hinge: [x, 0.04, z, 0], extra: phase };
    g.panel([{ p: [x, 0.04, z - 0.008], paint: 0 }, { p: [x, 0.04, z + 0.008], paint: 0 }, { p: [x, 0.0, z + 0.012], paint: 10 }, { p: [x, 0.0, z - 0.006], paint: 10 }],
      info, [Math.sign(x), 0, 0]);
  }
  return g.build();
}

// ---- Material ---------------------------------------------------------------------------------------------------------
const isPart = (id, k) => float(1).sub(min(abs(id.sub(k)), 1));
const rotX = (v, c, s) => vec3(v.x, v.y.mul(c).sub(v.z.mul(s)), v.y.mul(s).add(v.z.mul(c)));
const rotY = (v, c, s) => vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));
const rotZ = (v, c, s) => vec3(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)), v.z);

// The parts move before the instance transform (as three.js's own Line2NodeMaterial reshapes positionLocal), so the
// instance matrix places the bent bird and turns its normals as usual. The bending depends on vertex attributes only:
// the three species share one shader.
class BirdNodeMaterial extends THREE.MeshStandardNodeMaterial {
  static get type() {
    return 'BirdNodeMaterial';
  }

  setupPosition(builder) {
    const part = attribute('birdPart', 'vec4');
    const hinge = attribute('birdHinge', 'vec4');
    const folded = attribute('birdFold', 'vec3');
    const anim = attribute('birdAnim', 'vec4');
    const id = part.x, side = part.y, extra = part.w, pivot = hinge.xyz;
    const phase = anim.x, amp = anim.y, fold = anim.z, nod = anim.w;
    const p = positionGeometry, n = normalGeometry;

    // wings: the hand about the wrist (lagging the beat, plus its rest angle), then the whole wing about the shoulder
    const outer = isPart(id, 4);
    const wing = isPart(id, 3).add(outer);
    const wrist = pivot.add(vec3(side.mul(hinge.w), 0, 0));
    const a2 = extra.add(amp.mul(0.75).mul(sin(phase.sub(0.9)))).mul(outer).mul(side);
    const c2 = cos(a2), s2 = sin(a2);
    const q = rotZ(p.sub(wrist), c2, s2).add(wrist);
    const nq = rotZ(n, c2, s2);
    const a1 = amp.mul(sin(phase)).mul(side);
    const c1 = cos(a1), s1 = sin(a1);
    const flapped = rotZ(q.sub(pivot), c1, s1).add(pivot);
    const wingFold = smoothstep(0.35, 1.0, fold);
    const pWing = mix(flapped, folded, wingFold);
    const nWing = mix(rotZ(nq, c1, s1), vec3(side.mul(0.75), sign(n.y).mul(0.66), 0), wingFold);
    // head: a nod about the neck
    const head = isPart(id, 1);
    const ch = cos(nod), sh = sin(nod);
    const pHead = rotX(p.sub(pivot), ch, sh).add(pivot);
    const nHead = rotX(n, ch, sh);
    // a bird's legs fold up into the belly in flight (the first part of `fold`; the wings take the rest)
    const legs = isPart(id, 6);
    const pLegs = mix(folded, p, smoothstep(0.0, 0.35, fold));
    // a rat's tail waves down its length; its legs swing fore and aft
    const tail = isPart(id, 5);
    const wave = sin(phase.sub(extra.mul(3.0))).mul(amp.mul(0.45).add(0.22)).mul(extra);
    const ct = cos(wave), st = sin(wave);
    const pTail = rotY(p.sub(pivot), ct, st).add(pivot);
    const nTail = rotY(n, ct, st);
    const stride = isPart(id, 7);
    const swing = amp.mul(0.9).mul(sin(phase.add(extra)));
    const cs = cos(swing), ss = sin(swing);
    const pStride = rotX(p.sub(pivot), cs, ss).add(pivot);
    const nStride = rotX(n, cs, ss);

    const rest = float(1).sub(wing).sub(head).sub(legs).sub(tail).sub(stride);
    const position = p.mul(rest).add(pWing.mul(wing)).add(pHead.mul(head)).add(pLegs.mul(legs)).add(pTail.mul(tail)).add(pStride.mul(stride));
    const normal = n.mul(rest.add(legs)).add(nWing.mul(wing)).add(nHead.mul(head)).add(nTail.mul(tail)).add(nStride.mul(stride));
    positionLocal.assign(position);
    normalLocal.assign(normalize(normal));
    if (builder.needsPreviousData()) positionPrevious.assign(position);
    return super.setupPosition(builder);
  }
}

// Paint, per vertex then per pixel. three.js multiplies the colour node by the instance colour: what this returns is
// the wanted colour divided by it.
function birdColorNode() {
  const paint = attribute('birdPart', 'vec4').z;
  const code = floor(paint.add(0.001));
  const is = (k) => isPart(code, k);
  let fixed = vec3(0), fixedMix = float(0);
  for (const [k, c] of Object.entries(PAINT_FIXED)) {
    fixed = fixed.add(vec3(...c).mul(is(+k)));
    fixedMix = fixedMix.add(is(+k));
  }
  const shade = float(1).sub(is(1).mul(0.24)).add(is(8).mul(0.28)).sub(is(13).mul(0.32)).sub(is(2).mul(0.3));
  const speckle = float(1).sub(is(14)).sub(fixedMix);
  const tone = varying(vec4(shade, is(2), fixedMix, speckle), 'vBirdTone');
  const fixedColor = varying(fixed, 'vBirdFixed');
  const pattern = varying(paint, 'vBirdPaint');
  return Fn(() => {
    const base = instanceColor;
    const c = base.mul(tone.x).toVar();
    // the neck shifts between green and purple with the angle it is seen at
    const facing = abs(dot(normalView, positionViewDirection));
    const sheen = mix(vec3(0.34, 0.12, 0.38), vec3(0.1, 0.38, 0.22), facing);
    c.assign(mix(c, c.mul(0.72).add(sheen.mul(0.3)), tone.y));
    // two black bars across the coverts, a dark band at the end of the tail
    const t = fract(pattern);
    const bars = step(19.5, pattern).mul(step(pattern, 20.995));
    const bar = smoothstep(0.47, 0.51, t).sub(smoothstep(0.59, 0.63, t)).add(smoothstep(0.71, 0.75, t).sub(smoothstep(0.83, 0.87, t)));
    const tailBand = step(20.995, pattern).mul(step(pattern, 21.995)).mul(smoothstep(0.74, 0.8, t));
    c.mulAssign(float(1).sub(bars.mul(bar).mul(0.8)).sub(tailBand.mul(0.82)));
    // white pigeons: patches of grey-brown
    const light = smoothstep(0.74, 0.8, dot(base, vec3(0.3, 0.59, 0.11)));
    const cell = floor(positionGeometry.mul(24));
    const h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719)).add(base.r.mul(311.7))).mul(43758.5453));
    c.assign(mix(c, c.mul(vec3(0.42, 0.38, 0.36)), light.mul(step(0.6, h)).mul(tone.w)));
    c.assign(mix(c, fixedColor, tone.z));
    return c.div(max(base, vec3(0.02)));
  })();
}

function speciesMesh(name, geometry, capacity, roughness) {
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  anim.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('birdAnim', anim);
  const material = new BirdNodeMaterial({ roughness, metalness: 0 });
  material.colorNode = birdColorNode();
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  // one degenerate instance until warmed up, so the pipeline compiles behind the loading screen
  mesh.count = 1;
  mesh.instanceMatrix.array.fill(0);
  mesh.instanceMatrix.array[15] = 1;
  return { mesh, anim, colorVersion: -1 };
}

// Instance matrix of a body at (x, y, z), turned to yaw, pitched (nose down +) and rolled (YXZ), scaled by s
function compose(e, o, x, y, z, yaw, pitch, roll, s) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  e[o] = (cy * cr + sy * sp * sr) * s; e[o + 1] = cp * sr * s; e[o + 2] = (-sy * cr + cy * sp * sr) * s; e[o + 3] = 0;
  e[o + 4] = (-cy * sr + sy * sp * cr) * s; e[o + 5] = cp * cr * s; e[o + 6] = (sy * sr + cy * sp * cr) * s; e[o + 7] = 0;
  e[o + 8] = sy * cp * s; e[o + 9] = -sp * s; e[o + 10] = cy * cp * s; e[o + 11] = 0;
  e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
}

function writeSpecies(entry, species, puff, warm) {
  const { mesh, anim } = entry;
  const e = mesh.instanceMatrix.array, a = anim.array;
  const top = species.top;
  const st = species.state, sx = species.x, sy = species.y, sz = species.z, yaw = species.yaw, pitch = species.pitch, roll = species.roll;
  const scale = species.scale, ph = species.phase, amp = species.amp, fold = species.fold, head = species.head;
  for (let i = 0; i < top; i++) {
    const o = i * 16;
    if (!st[i]) {
      for (let k = 0; k < 16; k++) e[o + k] = 0;
      e[o + 15] = 1;
      continue;
    }
    compose(e, o, sx[i], sy[i], sz[i], yaw[i], pitch[i], roll[i], scale[i] * (puff ? 1 + 0.1 * puff[i] : 1));
    const q = i * 4;
    a[q] = ph[i]; a[q + 1] = amp[i]; a[q + 2] = fold[i]; a[q + 3] = head[i];
  }
  if (entry.colorVersion !== species.colorVersion && top) {
    entry.colorVersion = species.colorVersion;
    const c = mesh.instanceColor;
    c.array.set(species.color.subarray(0, top * 3));
    c.clearUpdateRanges();
    c.addUpdateRange(0, top * 3);
    c.needsUpdate = true;
  }
  const count = top || (warm ? 1 : 0);
  mesh.count = Math.max(1, count);
  mesh.visible = count > 0;
  if (top) {
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, top * 16);
    mesh.instanceMatrix.needsUpdate = true;
    anim.clearUpdateRanges();
    anim.addUpdateRange(0, top * 4);
    anim.needsUpdate = true;
  }
}

/**
 * Pigeons, gulls and rats around the camera.
 * @param {THREE.Scene} scene
 * @param {{
 *   groundHeight?: (x: number, z: number) => number,
 *   onSidewalk?: (x: number, z: number) => boolean,
 *   perches?: { x: Float32Array, z: Float32Array, y: Float32Array },
 *   trashPiles?: { x: Float32Array, z: Float32Array },
 *   nearWater?: (x: number, z: number) => boolean,
 *   quality?: 'high' | 'balanced' | 'fluid',
 *   onFlush?: (x: number, z: number, count: number) => void // optional: a flock goes up (wing clatter)
 * }} options
 */
function createBirds(scene, options = {}) {
  const sim = createBirdSim(options);
  const group = new THREE.Group();
  group.name = 'StreetAnimals';
  group.matrixAutoUpdate = false;
  const pigeons = speciesMesh('Pigeons', pigeonGeometry(), sim.pigeons.capacity, 0.86);
  const gulls = speciesMesh('Gulls', gullGeometry(), sim.gulls.capacity, 0.72);
  const rats = speciesMesh('Rats', ratGeometry(), sim.rats.capacity, 0.68);
  group.add(pigeons.mesh, gulls.mesh, rats.mesh);
  group.updateMatrixWorld(true);
  if (scene && typeof scene.add === 'function') scene.add(group);

  const view = { x: 0, y: 0, z: 0, fx: 0, fz: 1 };
  let updates = 0;

  function update(dt, camera, world = {}) {
    updates++;
    const p = camera && camera.position;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      view.x = p.x; view.y = p.y; view.z = p.z;
    } else if (world && world.player && Number.isFinite(world.player.x) && Number.isFinite(world.player.z)) {
      view.x = world.player.x; view.z = world.player.z;
    }
    // looking along -z of the camera
    const q = camera && camera.quaternion;
    if (q && Number.isFinite(q.w)) {
      const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
      if (Math.hypot(fx, fz) > 1e-3) { view.fx = fx; view.fz = fz; }
    }
    sim.step(dt, view, world || {});
    const warm = updates <= 3;
    writeSpecies(pigeons, sim.pigeons, sim.pigeons.puff, warm);
    writeSpecies(gulls, sim.gulls, null, warm);
    writeSpecies(rats, sim.rats, null, warm);
  }

  return {
    group,
    update,
    scatter: (x, z, radius) => sim.scatter(x, z, radius),
    stats: () => sim.stats(),
    // pigeons about (x, z), 0..1: the ambience's cooing (audio-ambience.js, through gameplay.birds)
    near: (x, z, radius) => sim.near(x, z, radius)
  };
}

export { createBirds };
