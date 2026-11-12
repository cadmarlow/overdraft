import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { saltLandAt, sampleSalt } from './wasteland-plan.js';

// The ships the water left behind: lofted hulls lying on the bed of the Hudson and on the harbour pan, listing, sunk
// to their bilges in the mud, some with their backs broken wide enough to drive through, three with a hold that can
// be entered through a hole in the side. Each is one mesh of painted steel gone to rust.

const PAINT = {
  fouling: [0.20, 0.06, 0.04], black: [0.035, 0.035, 0.04], navy: [0.04, 0.07, 0.12], green: [0.05, 0.10, 0.07], grey: [0.19, 0.19, 0.185],
  oxide: [0.22, 0.08, 0.045], white: [0.42, 0.40, 0.36], deck: [0.15, 0.12, 0.10], buff: [0.40, 0.27, 0.12]
};
// length, beam, depth of hull; `house`: [from, to (fractions of the length, stern = 0), height, width (fraction of the beam)]
const KINDS = {
  freighter: { L: 150, B: 22, D: 13, house: [[0.1, 0.25, 14, 0.82]], funnels: [0.17], hatches: [0.36, 0.5, 0.64, 0.78], posts: [0.43, 0.71] },
  tanker: { L: 210, B: 32, D: 17, house: [[0.06, 0.17, 17, 0.86]], funnels: [0.1], hatches: [], posts: [0.5], spine: true },
  liner: { L: 236, B: 29, D: 17, house: [[0.16, 0.8, 9, 0.9], [0.24, 0.7, 15, 0.74]], funnels: [0.4, 0.55], hatches: [], posts: [0.9] },
  coaster: { L: 72, B: 12, D: 7.5, house: [[0.08, 0.26, 8, 0.8]], funnels: [0.16], hatches: [0.5, 0.72], posts: [0.61] },
  tug: { L: 32, B: 9.5, D: 5, house: [[0.4, 0.66, 5.5, 0.6]], funnels: [0.42], hatches: [], posts: [] }
};

function part(geometry, paint) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const colours = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colours.length; i += 3) { colours[i] = paint[0]; colours[i + 1] = paint[1]; colours[i + 2] = paint[2]; }
  g.setAttribute('paint', new THREE.BufferAttribute(colours, 3));
  g.deleteAttribute('uv');
  return g;
}
const box = (u, y, s, lu, h, ws, paint) => part(new THREE.BoxGeometry(lu, h, ws).translate(u, y + h / 2, s), paint);

const half = (kind, t) => (kind.B / 2) * (t < 0.12 ? 0.72 + 0.28 * (t / 0.12) : t < 0.7 ? 1 : Math.max(0.03, 1 - ((t - 0.7) / 0.3) ** 2.3));
const rise = (kind, t) => kind.D * 0.22 * Math.max(0, (t - 0.84) / 0.16) ** 2;
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/**
 * The hull between two fractions of its length (a broken ship is two of these), stern at -L / 2, keel on y = 0.
 * @param {object} cut - door: [t0, t1, side] plating torn out from the turn of the bilge up to mid height on that side;
 *   open: [[t0, t1], ...] hatches with their covers gone, the deck cut through over them
 */
function loft(kind, from, to, hullPaint, { door = null, open = [] } = {}) {
  const { L, B, D } = kind, N = Math.max(4, Math.round(22 * (to - from)));
  const ring = [[1, 1], [1, 0.45], [0.93, 0.15], [0.6, 0.02], [0, 0], [-0.6, 0.02], [-0.93, 0.15], [-1, 0.45], [-1, 1]];
  const position = [], colour = [], index = [];
  for (let i = 0; i <= N; i++) {
    const t = from + (to - from) * i / N, b = half(kind, t), keel = rise(kind, t);
    for (const [s, y] of ring) {
      position.push((t - 0.5) * L, keel + (D - keel) * y, s * b);
      colour.push(...(y < 0.42 ? PAINT.fouling : hullPaint));
    }
  }
  const R = ring.length, torn = door ? (door[2] > 0 ? 1 : 6) : -1;
  for (let i = 0; i < N; i++) {
    const mid = from + (to - from) * (i + 0.5) / N;
    for (let k = 0; k + 1 < R; k++) {
      if (k === torn && mid > door[0] && mid < door[1]) continue;
      const a = i * R + k, b = a + 1, c = a + R, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const skin = new THREE.BufferGeometry();
  skin.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  skin.setAttribute('paint', new THREE.Float32BufferAttribute(colour, 3));
  skin.setIndex(index); skin.computeVertexNormals();
  // the weather deck: a strip down each side, and the middle wherever no open hatch has taken it
  const flat = [];
  const quad = (t0, t1, s0, s1) => {
    const a = [(t0 - 0.5) * L, D, s1(t0)], b = [(t0 - 0.5) * L, D, s0(t0)], c = [(t1 - 0.5) * L, D, s1(t1)], d = [(t1 - 0.5) * L, D, s0(t1)];
    flat.push(...a, ...c, ...b, ...b, ...c, ...d);
  };
  for (let i = 0; i < N; i++) {
    const t0 = from + (to - from) * i / N, t1 = from + (to - from) * (i + 1) / N, mid = (t0 + t1) / 2;
    const hatch = (t) => Math.min(half(kind, t), B * 0.28);
    quad(t0, t1, t => -half(kind, t), t => -hatch(t));
    quad(t0, t1, hatch, t => half(kind, t));
    if (!open.some(([a, b]) => mid > a && mid < b)) quad(t0, t1, t => -hatch(t), hatch);
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
  deck.computeVertexNormals();
  return [skin.toNonIndexed(), part(deck, PAINT.deck)];
}

// Where her back broke: the decks inside, torn off at different lengths, and the bulkhead that closes what is left
function section(kind, t, inward, random) {
  const { L, D } = kind, b = half(kind, t), u = (t - 0.5) * L, list = [];
  for (let y = 3.1; y < D - 1; y += 3.1) {
    const wide = y / D > 0.45 ? 1 : y / D > 0.15 ? 0.93 : 0.62;
    for (const side of [-1, 1]) {
      const depth = 4 + random() * 11;
      list.push(box(u + inward * depth / 2, y - 0.12, side * b * wide / 2, depth, 0.24, b * wide - 0.12, PAINT.deck));
    }
    // a stanchion or two left standing on the edge of each deck
    if (random() < 0.7) list.push(box(u + inward * 0.6, y, (random() - 0.5) * b * wide * 1.6, 0.22, 3.1, 0.22, PAINT.oxide));
  }
  list.push(box(u + inward * 16.5, 0.5, 0, 0.3, D - 1, 2 * b - 0.4, PAINT.black));
  return list;
}

const world = (spec, u, s) => { const cs = Math.cos(spec.yaw), sn = Math.sin(spec.yaw); return [spec.x + u * cs + s * sn, spec.z - u * sn + s * cs]; };

// What a hull stops: solid where she is whole, two walls and a deck where a hold can be entered
function hullColliders(spec, kind, bed, cuts) {
  const { L, D } = kind, sink = spec.sink ?? 1.6, out = [];
  const cs = Math.cos(spec.yaw), sn = Math.sin(spec.yaw), top = bed - sink + D * (spec.hold ? 1 : 0.82);
  const obb = (t0, t1, s, hz, minY, maxY, roof) => {
    if (t1 - t0 < 1e-4) return;
    const hx = (t1 - t0) * L / 2, [cx, cz] = world(spec, ((t0 + t1) / 2 - 0.5) * L, s);
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    out.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY, maxY, roof, obb: { cx, cz, cs, sn, hx, hz } });
  };
  const solid = (a, b) => {
    const n = Math.max(1, Math.ceil((b - a) / 0.2));
    for (let i = 0; i < n; i++) {
      const t0 = a + (b - a) * i / n, t1 = a + (b - a) * (i + 1) / n;
      obb(t0, t1, 0, Math.max(1.2, half(kind, (t0 + t1) / 2) * 0.9), bed - 2, top, true);
    }
  };
  for (const [from, to] of cuts) {
    if (!spec.hold) { solid(from, to); continue; }
    const [h0, h1] = spec.hold, [d0, d1, side] = spec.door, b = kind.B / 2;
    solid(from, h0); solid(h1, to);
    obb(h0, h1, -side * (b - 0.5), 1, bed - 2, top, false);
    obb(h0, d0, side * (b - 0.5), 1, bed - 2, top, false);
    obb(d1, h1, side * (b - 0.5), 1, bed - 2, top, false);
    obb(h0, h1, 0, b, top - 0.5, top, true); // the deck over the hold
  }
  return out;
}

function wreck(spec) {
  const kind = KINDS[spec.kind], { L, B, D } = kind, hull = PAINT[spec.paint];
  const gap = (spec.gap ?? 5) / 2 / L, random = rng(Math.round(spec.x * 31 + spec.z * 17));
  const cuts = spec.broken ? [[0, spec.broken - gap], [spec.broken + gap, 1]] : [[0, 1]];
  const props = [], fires = [];
  // a hold her crew can get into: the covers are off all hatches over it but the last
  const open = spec.hold ? kind.hatches.filter(t => t > spec.hold[0] && t < spec.hold[1]).slice(0, -1).map(t => [t - 0.045, t + 0.045]) : [];
  const pieces = cuts.map(([from, to], n) => {
    const list = loft(kind, from, to, hull, { door: spec.door, open });
    const mid = (from + to) / 2, inside = (t) => t > from && t < to;
    if (from > 0) list.push(...section(kind, from, 1, random));
    if (to < 1) list.push(...section(kind, to, -1, random));
    for (const [a, b, h, w] of kind.house) {
      const a1 = Math.max(a, from), b1 = Math.min(b, to);
      if (b1 - a1 < 0.02) continue;
      list.push(box(((a1 + b1) / 2 - 0.5) * L, D, 0, (b1 - a1) * L, h, B * w, PAINT.white));
      // bands of dark windows
      for (let y = 2.2; y < h - 1; y += 3.1) list.push(box(((a1 + b1) / 2 - 0.5) * L, D + y, 0, (b1 - a1) * L + 0.1, 1.1, B * w + 0.1, PAINT.black));
    }
    for (const t of kind.funnels) if (inside(t)) list.push(box((t - 0.5) * L, D + (kind.house[0]?.[2] ?? 6), 0, L * 0.035, D * 0.55, B * 0.26, spec.funnel ? PAINT[spec.funnel] : PAINT.buff));
    for (const t of kind.hatches) if (inside(t) && !open.some(([a, b]) => t > a && t < b)) list.push(box((t - 0.5) * L, D, 0, L * 0.085, 1.5, B * 0.56, PAINT.oxide));
    for (const t of kind.posts) if (inside(t)) {
      list.push(box((t - 0.5) * L, D, 0, 1.3, D * 1.25, 1.3, PAINT.buff));
      list.push(box((t - 0.5) * L, D + D * 0.95, 0, 1.0, 0.9, B * 0.7, PAINT.buff));
    }
    if (kind.spine) { const a1 = Math.max(0.2, from), b1 = Math.min(0.94, to); if (b1 > a1) list.push(box(((a1 + b1) / 2 - 0.5) * L, D, 0, (b1 - a1) * L, 1.6, 2.4, PAINT.oxide)); }
    if (spec.hold) {
      const [h0, h1] = spec.hold, [d0, d1, side] = spec.door;
      // her frames, bare on the inside of the plating, and the two bulkheads of the hold
      for (let t = h0 + 0.02; t < h1; t += 0.03) for (const s of [-1, 1]) {
        if (s === side && t > d0 - 0.01 && t < d1 + 0.01) continue;
        list.push(box((t - 0.5) * L, 0.4, s * (B / 2 - 0.3), 0.3, D - 0.6, 0.55, PAINT.oxide));
      }
      for (const t of [h0, h1]) list.push(box((t - 0.5) * L, 0.3, 0, 0.35, D - 0.5, B - 0.5, PAINT.black));
      // the plating of the door, folded back against the side
      list.push(box((d0 - 0.5) * L - 2.2, D * 0.16, side * (B / 2 + 0.5), 4.6, D * 0.28, 0.12, hull));
    }
    const geometry = mergeGeometries(list, false);
    // each half settled its own way when the back broke
    const roll = spec.roll * (n ? -0.55 : 1), pitch = (spec.pitch ?? 0) + (spec.broken ? (n ? 0.05 : -0.04) : 0);
    const pivot = new THREE.Matrix4().makeTranslation((mid - 0.5) * L, 0, 0);
    geometry.applyMatrix4(pivot.clone().multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(roll, 0, pitch, 'YXZ'))).multiply(pivot.clone().invert()));
    return geometry;
  });
  const geometry = pieces.length > 1 ? mergeGeometries(pieces, false) : pieces[0];
  const bed = sampleSalt(spec.x, spec.z), sink = spec.sink ?? 1.6;
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(spec.yaw).setPosition(spec.x, bed - sink, spec.z));
  geometry.computeBoundingSphere();
  if (spec.hold) {
    // what the crew keeps down there, by the door
    const [d0, d1, side] = spec.door, u = ((d0 + d1) / 2 - 0.5) * L, across = (s) => side * (B / 2 - s);
    const put = (name, du, s, yaw = 0) => { const [x, z] = world(spec, u + du, across(s)); props.push({ name, x, z, yaw: yaw + spec.yaw }); return [x, z]; };
    const [fx, fz] = put('fire_pit', 2, 8.5);
    fires.push([fx, sampleSalt(fx, fz) + 0.25, fz, 0.8]);
    put('chair', 4.2, 9.3, 4); put('chair', 0.2, 10.4, 2.4); put('crate', -9, 3.2, 0.3); put('crate', -10.6, 3.4, 1.2); put('ammo_crate', -9.6, 4.9, 0.6);
    put('barrel_blue', 9, 3); put('barrel_red', 10.1, 3.3); put('jerrycan', 8.2, 4.4, 1); put('generator', 12.5, 3.4, 1.57); put('bed_frame', -14, 3.2, 0); put('bed_frame', -17.2, 3.2, 0);
    put('tyre_stack', 15, 16, 0); put('gas_cylinder', 13.6, 4.6); put('table', 5.5, 13, 0.4); put('trash_bag', -6, 17);
  }
  return { geometry, colliders: hullColliders(spec, kind, bed, cuts), props, fires };
}

// Where they lie. yaw 0 = bow toward +x (east); roll and pitch in radians.
const FLEET = [
  // Le Cimetière des Coques, off the old cruise terminal
  { kind: 'liner', paint: 'black', funnel: 'oxide', x: -2560, z: -640, yaw: 1.42, roll: 0.3, sink: 2.6, broken: 0.57, gap: 17 },
  { kind: 'freighter', paint: 'navy', x: -2790, z: -380, yaw: 0.5, roll: -0.05, sink: 2.2, hold: [0.3, 0.84], door: [0.52, 0.6, -1] },
  { kind: 'coaster', paint: 'green', x: -2640, z: -150, yaw: 2.3, roll: 0.42, sink: 1.2 },
  { kind: 'tug', paint: 'oxide', x: -2460, z: -330, yaw: 4.1, roll: -0.22, sink: 0.9 },
  { kind: 'tanker', paint: 'oxide', funnel: 'black', x: -3000, z: -900, yaw: 1.75, roll: 0.1, sink: 3.0, broken: 0.46, gap: 13 },
  { kind: 'tug', paint: 'black', x: -2880, z: -640, yaw: 0.2, roll: 0.5, sink: 0.7 },
  // up and down the bed
  { kind: 'freighter', paint: 'black', x: -2620, z: -3240, yaw: 1.9, roll: 0.2, sink: 2.2, broken: 0.62 },
  { kind: 'coaster', paint: 'navy', x: -2380, z: -5300, yaw: 1.3, roll: -0.3, sink: 1.3 },
  { kind: 'coaster', paint: 'oxide', x: -2260, z: 1880, yaw: 1.1, roll: 0.26, sink: 1.2 },
  { kind: 'freighter', paint: 'green', x: -1760, z: 3900, yaw: 0.9, roll: -0.04, sink: 2.2, hold: [0.3, 0.84], door: [0.44, 0.52, 1] },
  { kind: 'tug', paint: 'navy', x: -2300, z: 900, yaw: 5.2, roll: 0.3, sink: 0.8 },
  // the harbour pan
  { kind: 'tanker', paint: 'black', x: -420, z: 8150, yaw: 0.35, roll: 0.08, sink: 1.3 },
  { kind: 'freighter', paint: 'oxide', x: 520, z: 9480, yaw: 2.6, roll: -0.24, sink: 1.0, broken: 0.5 },
  { kind: 'coaster', paint: 'black', x: -1700, z: 9700, yaw: 1.0, roll: 0.35, sink: 0.8 },
  // the Watchers' freighter off Red Hook: upright, lived in
  { kind: 'freighter', paint: 'grey', funnel: 'navy', x: 1640, z: 7470, yaw: 0.16, roll: 0.03, sink: 2.2, hold: [0.3, 0.84], door: [0.5, 0.58, 1] }
];

export function buildWastelandWrecks(parent, material) {
  const group = new THREE.Group(); group.name = 'Coques échouées';
  parent.add(group);
  const colliders = [], props = [], fires = [];
  for (const spec of FLEET) {
    if (!saltLandAt(spec.x, spec.z)) continue;
    const built = wreck(spec);
    const mesh = new THREE.Mesh(built.geometry, material);
    mesh.name = `Coque · ${spec.kind}`; mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    group.add(mesh);
    colliders.push(...built.colliders);
    props.push(...built.props); fires.push(...built.fires);
  }
  return { colliders, fleet: FLEET, props, fires };
}

export { FLEET, KINDS, wreck };
