import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { saltLandAt, sampleSalt } from './wasteland-plan.js';

// The ships the water left behind: lofted hulls lying on the bed of the Hudson and on the harbour pan, listing, sunk
// to their bilges in the mud, some with their backs broken. Each is one mesh of painted steel gone to rust.

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

// The hull between two fractions of its length (a broken ship is two of these), stern at -L / 2, keel on y = 0
function loft(kind, from, to, hullPaint) {
  const { L, B, D } = kind, N = Math.max(4, Math.round(22 * (to - from)));
  const half = (t) => (B / 2) * (t < 0.12 ? 0.72 + 0.28 * (t / 0.12) : t < 0.7 ? 1 : Math.max(0.03, 1 - ((t - 0.7) / 0.3) ** 2.3));
  const rise = (t) => D * 0.22 * Math.max(0, (t - 0.84) / 0.16) ** 2;
  const ring = [[1, 1], [1, 0.45], [0.93, 0.15], [0.6, 0.02], [0, 0], [-0.6, 0.02], [-0.93, 0.15], [-1, 0.45], [-1, 1]];
  const position = [], colour = [], index = [];
  for (let i = 0; i <= N; i++) {
    const t = from + (to - from) * i / N, b = half(t), keel = rise(t);
    for (const [s, y] of ring) {
      position.push((t - 0.5) * L, keel + (D - keel) * y, s * b);
      colour.push(...(y < 0.42 ? PAINT.fouling : hullPaint));
    }
  }
  const R = ring.length;
  for (let i = 0; i < N; i++) for (let k = 0; k + 1 < R; k++) {
    const a = i * R + k, b = a + 1, c = a + R, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const skin = new THREE.BufferGeometry();
  skin.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  skin.setAttribute('paint', new THREE.Float32BufferAttribute(colour, 3));
  skin.setIndex(index); skin.computeVertexNormals();
  // the weather deck, and a bulkhead across each open end
  const flat = [];
  for (let i = 0; i < N; i++) {
    const t0 = from + (to - from) * i / N, t1 = from + (to - from) * (i + 1) / N;
    const a = [(t0 - 0.5) * L, D, half(t0)], b = [(t0 - 0.5) * L, D, -half(t0)], c = [(t1 - 0.5) * L, D, half(t1)], d = [(t1 - 0.5) * L, D, -half(t1)];
    flat.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
  deck.computeVertexNormals();
  return [skin.toNonIndexed(), part(deck, PAINT.deck)];
}

function wreck(spec) {
  const kind = KINDS[spec.kind], { L, B, D } = kind, hull = PAINT[spec.paint];
  const parts = [];
  const cuts = spec.broken ? [[0, spec.broken - 0.012], [spec.broken + 0.012, 1]] : [[0, 1]];
  const pieces = cuts.map(([from, to], n) => {
    const list = loft(kind, from, to, hull);
    const mid = (from + to) / 2, inside = (t) => t > from && t < to;
    for (const [a, b, h, w] of kind.house) {
      const a1 = Math.max(a, from), b1 = Math.min(b, to);
      if (b1 - a1 < 0.02) continue;
      list.push(box(((a1 + b1) / 2 - 0.5) * L, D, 0, (b1 - a1) * L, h, B * w, PAINT.white));
      // bands of dark windows
      for (let y = 2.2; y < h - 1; y += 3.1) list.push(box(((a1 + b1) / 2 - 0.5) * L, D + y, 0, (b1 - a1) * L + 0.1, 1.1, B * w + 0.1, PAINT.black));
    }
    for (const t of kind.funnels) if (inside(t)) list.push(box((t - 0.5) * L, D + (kind.house[0]?.[2] ?? 6), 0, L * 0.035, D * 0.55, B * 0.26, spec.funnel ? PAINT[spec.funnel] : PAINT.buff));
    for (const t of kind.hatches) if (inside(t)) list.push(box((t - 0.5) * L, D, 0, L * 0.085, 1.5, B * 0.56, PAINT.oxide));
    for (const t of kind.posts) if (inside(t)) {
      list.push(box((t - 0.5) * L, D, 0, 1.3, D * 1.25, 1.3, PAINT.buff));
      list.push(box((t - 0.5) * L, D + D * 0.95, 0, 1.0, 0.9, B * 0.7, PAINT.buff));
    }
    if (kind.spine) { const a1 = Math.max(0.2, from), b1 = Math.min(0.94, to); if (b1 > a1) list.push(box(((a1 + b1) / 2 - 0.5) * L, D, 0, (b1 - a1) * L, 1.6, 2.4, PAINT.oxide)); }
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
  const colliders = [];
  const cs = Math.cos(spec.yaw), sn = Math.sin(spec.yaw);
  for (const [t, w] of [[0.12, 0.42], [0.37, 0.47], [0.62, 0.45], [0.84, 0.3]]) {
    const u = (t - 0.5) * L, cx = spec.x + u * cs, cz = spec.z - u * sn, hx = L * 0.125, hz = B * w;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: bed - 2, maxY: bed - sink + D * 0.82, roof: true, obb: { cx, cz, cs, sn, hx, hz } });
  }
  return { geometry, colliders };
}

// Where they lie. yaw 0 = bow toward +x (east); roll and pitch in radians.
const FLEET = [
  // Le Cimetière des Coques, off the old cruise terminal
  { kind: 'liner', paint: 'black', funnel: 'oxide', x: -2560, z: -640, yaw: 1.42, roll: 0.3, sink: 2.6, broken: 0.57 },
  { kind: 'freighter', paint: 'navy', x: -2790, z: -380, yaw: 0.5, roll: -0.16, sink: 2.0 },
  { kind: 'coaster', paint: 'green', x: -2640, z: -150, yaw: 2.3, roll: 0.42, sink: 1.2 },
  { kind: 'tug', paint: 'oxide', x: -2460, z: -330, yaw: 4.1, roll: -0.22, sink: 0.9 },
  { kind: 'tanker', paint: 'oxide', funnel: 'black', x: -3000, z: -900, yaw: 1.75, roll: 0.1, sink: 3.0, broken: 0.46 },
  { kind: 'tug', paint: 'black', x: -2880, z: -640, yaw: 0.2, roll: 0.5, sink: 0.7 },
  // up and down the bed
  { kind: 'freighter', paint: 'black', x: -2620, z: -3240, yaw: 1.9, roll: 0.2, sink: 2.2, broken: 0.62 },
  { kind: 'coaster', paint: 'navy', x: -2380, z: -5300, yaw: 1.3, roll: -0.3, sink: 1.3 },
  { kind: 'coaster', paint: 'oxide', x: -2260, z: 1880, yaw: 1.1, roll: 0.26, sink: 1.2 },
  { kind: 'freighter', paint: 'green', x: -1760, z: 3900, yaw: 0.9, roll: -0.14, sink: 2.0 },
  { kind: 'tug', paint: 'navy', x: -2300, z: 900, yaw: 5.2, roll: 0.3, sink: 0.8 },
  // the harbour pan
  { kind: 'tanker', paint: 'black', x: -420, z: 8150, yaw: 0.35, roll: 0.08, sink: 1.3 },
  { kind: 'freighter', paint: 'oxide', x: 520, z: 9480, yaw: 2.6, roll: -0.24, sink: 1.0, broken: 0.5 },
  { kind: 'coaster', paint: 'black', x: -1700, z: 9700, yaw: 1.0, roll: 0.35, sink: 0.8 },
  // the Watchers' freighter off Red Hook: upright, lived in
  { kind: 'freighter', paint: 'grey', funnel: 'navy', x: 1640, z: 7470, yaw: 0.16, roll: 0.035, sink: 0.9 }
];

export function buildWastelandWrecks(parent, material) {
  const group = new THREE.Group(); group.name = 'Coques échouées';
  parent.add(group);
  const colliders = [];
  for (const spec of FLEET) {
    if (!saltLandAt(spec.x, spec.z)) continue;
    const built = wreck(spec);
    const mesh = new THREE.Mesh(built.geometry, material);
    mesh.name = `Coque · ${spec.kind}`; mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    group.add(mesh);
    colliders.push(...built.colliders);
  }
  return { colliders, fleet: FLEET };
}

export { FLEET, KINDS, wreck };
