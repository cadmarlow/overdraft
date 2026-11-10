// Levels of detail for the cars, built from the detailed model each car already ships (assets/cars/<id>.bin), with no
// need for the original downloads:
//
//   near     what the player drives: bodywork, glass, wheels, cabin. Capped when a source is heavier than a browser
//            game can justify (NEAR_CAP), by a border-locked reduction that moves nothing by more than a millimetre or two.
//   mid      every other car within a few car lengths, parked or driving: the same bodywork reduced to what can
//            actually be seen from outside, and real wheels. This is the level that was missing: the street used to
//            jump from the detailed model straight to a 6 000-triangle reduction whose panels tore apart.
//   traffic  cars further away, rebuilt from the same visible skin.
//   far      the existing distant stand-in, untouched.
//
// What "can be seen from outside" means: the bodywork and glass are drawn into a depth buffer from a ring of viewpoints
// around and above the car, glass opaque; a triangle that wins no pixel anywhere is seats, dashboard, engine bay or
// underbody, and is left out before reducing. The reduction then spends all its triangles on what the street shows.
//
//   node build-lods.mjs [--in ../../assets/cars] [--out ../../assets/cars] [--only sedan,suv] [--no-cap]
//
// meshoptimizer comes from this folder's node_modules (`npm install` here once).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const IN = path.resolve(arg('--in', path.join(here, '../../assets/cars')));
const OUT = path.resolve(arg('--out', IN));
const ONLY = arg('--only', '')?.split(',').filter(Boolean);
const CAP = !process.argv.includes('--no-cap');

// Triangles. The mid level is what a modern open-world game shows of a car standing next to the player.
const BUDGET = {
  nearShell: 60000, // bodywork and glass of the car the player drives, cabin included
  nearWheel: 3600, // each of its wheels: several sources spend ten to seventeen thousand triangles on one rim
  nearSteering: 1500,
  midShell: 22000, midWheel: 1400,
  trafficShell: 7000, trafficWheel: 420
};
const VIEW = 1024; // pixels across each depth buffer

const { MeshoptSimplifier } = await import('meshoptimizer');
await MeshoptSimplifier.ready;

function readCar(id, entry) {
  const file = fs.readFileSync(path.join(IN, `${id}.bin`));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const n = entry.vertices, wide = entry.normalFormat === 'snorm16';
  let at = 0;
  const take = (Type, count, pad = 0) => { const a = new Type(buffer, at, count); at += a.byteLength + pad; return a; };
  const positions = take(Float32Array, n * 3);
  const normals = take(wide ? Int16Array : Int8Array, n * 4);
  const uvs = take(Uint16Array, n * 2);
  const flags = take(Uint8Array, n, (4 - n % 4) % 4);
  const index = new Uint32Array(buffer, at, entry.indices);
  const list = ([start, count]) => index.slice(start, start + count);
  const r = entry.ranges;
  return {
    n, wide, positions, normals, uvs, flags,
    body: list([r[0], r[1]]), glass: list([r[2], r[3]]), far: list([r[4], r[5]]),
    wheels: [0, 1, 2, 3].map((i) => list([r[6 + i * 2], r[7 + i * 2]])),
    calipers: entry.calipers ? entry.calipers.map(list) : null,
    steering: entry.steering ? list(entry.steering.range) : null,
    trafficShell: entry.trafficShell ? list(entry.trafficShell) : null,
    trafficWheels: entry.trafficWheels ? entry.trafficWheels.map(list) : null
  };
}

// Which triangles of `index` can be seen from outside, and from which side. Orthographic depth buffers holding the
// nearest triangle, from viewpoints around the car: level with the sills, at eye height, from a first floor, from a
// roof, and straight down. Returns the pixels each triangle won facing the viewer (front) and facing away (back).
// The side matters: the detailed car is drawn two-sided, so a panel modelled inside out goes unnoticed there, while
// the street's instanced material draws one side only and such a panel (a whole roof, on one model) would vanish.
function visibleSkin(positions, index) {
  const triangles = index.length / 3;
  const seen = new Uint8Array(triangles);
  const front = new Uint32Array(triangles), back = new Uint32Array(triangles);
  const depth = new Float32Array(VIEW * VIEW), owner = new Int32Array(VIEW * VIEW);
  const views = [[0, 1, 0]];
  for (const elevation of [-8, 12, 35, 62]) for (let k = 0; k < 12; k++) {
    const a = (k + (elevation > 30 ? 0.5 : 0)) * Math.PI / 6, e = elevation * Math.PI / 180;
    views.push([Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]);
  }
  const px = new Float32Array(triangles * 9); // projected corners: x, y, depth
  for (const eye of views) {
    // the camera looks along -eye; right and up span the picture
    const f = [-eye[0], -eye[1], -eye[2]];
    let rx = f[2], ry = 0, rz = -f[0];
    let rl = Math.hypot(rx, rz);
    if (rl < 1e-6) { rx = 1; rz = 0; rl = 1; }
    rx /= rl; rz /= rl;
    const ux = ry * f[2] - rz * f[1], uy = rz * f[0] - rx * f[2], uz = rx * f[1] - ry * f[0];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let t = 0; t < index.length; t++) {
      const i = index[t] * 3, X = positions[i], Y = positions[i + 1], Z = positions[i + 2];
      const x = X * rx + Z * rz, y = X * ux + Y * uy + Z * uz;
      px[t * 3] = x; px[t * 3 + 1] = y; px[t * 3 + 2] = X * f[0] + Y * f[1] + Z * f[2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const scale = (VIEW - 2) / Math.max(x1 - x0, y1 - y0);
    for (let t = 0; t < px.length; t += 3) { px[t] = (px[t] - x0) * scale + 1; px[t + 1] = (px[t + 1] - y0) * scale + 1; }
    depth.fill(Infinity); owner.fill(-1);
    for (let t = 0; t < triangles; t++) {
      const o = t * 9;
      const ax = px[o], ay = px[o + 1], az = px[o + 2], bx = px[o + 3], by = px[o + 4], bz = px[o + 5], cx = px[o + 6], cy = px[o + 7], cz = px[o + 8];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(VIEW - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(VIEW - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const qx = x + 0.5, qy = y + 0.5;
        const w0 = ((bx - qx) * (cy - qy) - (by - qy) * (cx - qx)) / area;
        const w1 = ((cx - qx) * (ay - qy) - (cy - qy) * (ax - qx)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * az + w1 * bz + w2 * cz, p = y * VIEW + x;
        if (z < depth[p]) { depth[p] = z; owner[p] = t; }
      }
    }
    const facing = (t) => { const o = t * 9; return (px[o + 3] - px[o]) * (px[o + 7] - px[o + 1]) - (px[o + 4] - px[o + 1]) * (px[o + 6] - px[o]) > 0; };
    for (let p = 0; p < owner.length; p++) { const t = owner[p]; if (t >= 0) { seen[t] = 1; if (facing(t)) front[t]++; else back[t]++; } }
    // Slivers and triangles smaller than a pixel own nothing: they count when they lie on the visible surface
    for (let t = 0; t < triangles; t++) {
      if (seen[t]) continue;
      const o = t * 9;
      const x = (px[o] + px[o + 3] + px[o + 6]) / 3, y = (px[o + 1] + px[o + 4] + px[o + 7]) / 3, z = (px[o + 2] + px[o + 5] + px[o + 8]) / 3;
      const p = Math.floor(y) * VIEW + Math.floor(x);
      if (z <= depth[p] + 0.006) { if (!front[t] && !back[t]) { if (facing(t)) front[t] = 1; else back[t] = 1; } seen[t] = 2; }
    }
    for (let t = 0; t < triangles; t++) if (seen[t] === 2) seen[t] = 1;
  }
  return { seen, front, back };
}

// A wheel's axle: the direction the wheel is narrowest along. (Extent, not spread: the points of a caliper or of a
// valve weigh on an average and tilt it by degrees; nothing is narrower than a tyre across its tread.)
function axleOf(positions, list) {
  const step = Math.max(1, Math.floor(list.length / 4000)), points = list.filter((_, k) => k % step === 0);
  const along = (yaw, tilt) => [Math.cos(tilt) * Math.cos(yaw), Math.sin(tilt), Math.cos(tilt) * Math.sin(yaw)];
  const width = (yaw, tilt) => {
    const d = along(yaw, tilt);
    let lo = Infinity, hi = -Infinity;
    for (const i of points) { const v = positions[i * 3] * d[0] + positions[i * 3 + 1] * d[1] + positions[i * 3 + 2] * d[2]; if (v < lo) lo = v; if (v > hi) hi = v; }
    return hi - lo;
  };
  let best = [0, 0], least = width(0, 0);
  for (const span of [30, 5, 1, 0.2]) {
    const from = best.slice();
    for (let y = -span; y <= span + 1e-9; y += span / 6) for (let t = -span; t <= span + 1e-9; t += span / 6) {
      const w = width((from[0] + y) * Math.PI / 180, (from[1] + t) * Math.PI / 180);
      if (w < least - 1e-7) { least = w; best = [from[0] + y, from[1] + t]; }
    }
  }
  return along(best[0] * Math.PI / 180, best[1] * Math.PI / 180);
}

// Wheels borrowed from another model: the sedan reached its .bin with no rims at all (a dark dish and the blocks
// of a tread, stretched into an egg), on the commonest car of the street. It rolls on the SUV's alloys, brought to
// its own radius. `swatches` says where each flat colour of the donor's palette is found in the borrower's:
// rubber to rubber, bright alloy to bright alloy, the grey of a brake disc, the red of a caliper.
const WHEELS_FROM = {
  sedan: { from: 'suv', swatches: { 8: 0, 7: 7, 10: 7, 6: 7, 3: 13, 9: 9 } }
};
const SWATCH = (k, size = 2048) => [(size - 256 + (k % 16) * 16 + 4) / size, (size - 256 + Math.floor(k / 16) * 16 + 4) / size];

function buildCar(id, entry, donors) {
  const car = readCar(id, entry);
  let n = car.n;
  let positions = car.positions, normals = car.normals, uvs = car.uvs, flags = car.flags;
  const borrowed = WHEELS_FROM[id];
  if (borrowed) {
    const { entry: donorEntry, car: donor } = donors[borrowed.from];
    const used = [...new Set(donor.wheels.flatMap((w) => [...w]))], to = new Map(used.map((i, k) => [i, n + k]));
    const count = n + used.length, convert = (car.wide ? 32767 : 127) / (donor.wide ? 32767 : 127);
    const P = new Float32Array(count * 3), N = new normals.constructor(count * 4), T = new Uint16Array(count * 2), F = new Uint8Array(count);
    P.set(positions); N.set(normals); T.set(uvs); F.set(flags);
    donor.wheels.forEach((list, w) => {
      const scale = entry.spec.wheels[w][3] / donorEntry.spec.wheels[w][3];
      for (const i of new Set(list)) {
        const j = to.get(i);
        for (let c = 0; c < 3; c++) { P[j * 3 + c] = donor.positions[i * 3 + c] * scale; N[j * 4 + c] = Math.round(donor.normals[i * 4 + c] * convert); }
        N[j * 4 + 3] = Math.round(donor.normals[i * 4 + 3] * convert);
        const swatch = Math.round((donor.uvs[i * 2] / 65535 * 2048 - (2048 - 256) - 4) / 16) + 16 * Math.round((donor.uvs[i * 2 + 1] / 65535 * 2048 - (2048 - 256) - 4) / 16);
        if (!(swatch in borrowed.swatches)) throw new Error(`${id}: the wheels of ${borrowed.from} use swatch ${swatch}, which WHEELS_FROM does not place`);
        const [u, v] = SWATCH(borrowed.swatches[swatch]);
        T[j * 2] = Math.round(u * 65535); T[j * 2 + 1] = Math.round(v * 65535);
      }
    });
    car.wheels = donor.wheels.map((list) => list.map((i) => to.get(i)));
    positions = P; normals = N; uvs = T; flags = F; n = count;
  }
  // what a reduction must keep apart: the way a surface faces, where it reads its paint, and what it is (lamp, glass...)
  const unit = car.wide ? 32767 : 127;
  let attributes;
  const describe = () => {
    const count = flags.length;
    attributes = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      attributes[i * 6] = normals[i * 4] / unit; attributes[i * 6 + 1] = normals[i * 4 + 1] / unit; attributes[i * 6 + 2] = normals[i * 4 + 2] / unit;
      attributes[i * 6 + 3] = uvs[i * 2] / 65535; attributes[i * 6 + 4] = uvs[i * 2 + 1] / 65535;
      attributes[i * 6 + 5] = flags[i];
    }
  };
  describe();
  const weights = [0.5, 0.5, 0.5, 1.5, 1.5, 10];
  // Error is in metres ('ErrorAbsolute'): a level may stop short of its budget rather than bend the bodywork further.
  // 'Permissive': several of these models are faceted, every triangle owning its three corners, so every edge is a
  // break in the normals and a strict reduction can collapse nothing at all. Collapsing across such breaks is allowed,
  // and the weights above make the reduction pay for mixing paint, glass and lamp surfaces, which it then avoids.
  const reduce = (index, target, error, extra = [], w = weights) => {
    if (index.length <= target * 3) return [index, 0];
    return MeshoptSimplifier.simplifyWithAttributes(index, positions, 3, attributes, 6, w, null, target * 3, error, ['ErrorAbsolute', 'Sparse', 'Permissive', ...extra]);
  };
  // A wheel is a small part made of hard edges (spokes, nuts, the blocks of a tread). At the bodywork's weights its
  // normals forbid nearly every collapse, and three of the sources kept eight to nine thousand triangles per wheel
  // at any distance: more than the body they carry. A wheel reads by its shape, so its normals weigh little here.
  const wheelWeights = [0.1, 0.1, 0.1, 0.3, 0.3, 10];
  const reduceWheel = (index, target, error) => reduce(index, target, error, [], wheelWeights)[0];
  const tri = (list) => list.length / 3;
  const report = {};

  // 0. wheels that turn true. A source may keep its front wheels steered (two models: 12 and 26 degrees) or all four
  // leaning in on their camber (one: 6 degrees). Spun on the car's axle such a wheel wobbles at every revolution: its
  // own axle is put back across the car.
  report.straightened = 0;
  for (const wheel of car.wheels) {
    const own = [...new Set(wheel)];
    const axle = axleOf(positions, own);
    if (axle[0] > Math.cos(2 * Math.PI / 180)) continue;
    // the rotation that takes the axle to +x, about their common normal
    const k = [0, axle[2], -axle[1]], sin = Math.hypot(k[1], k[2]), cos = axle[0];
    k[1] /= sin; k[2] /= sin;
    const turn = (x, y, z) => {
      const along = k[1] * y + k[2] * z;
      return [x * cos + (k[1] * z - k[2] * y) * sin, y * cos + k[2] * x * sin + k[1] * along * (1 - cos), z * cos - k[1] * x * sin + k[2] * along * (1 - cos)];
    };
    for (const i of own) {
      positions.set(turn(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]), i * 3);
      normals.set(turn(normals[i * 4], normals[i * 4 + 1], normals[i * 4 + 2]).map(Math.round), i * 4);
    }
    report.straightened++;
  }
  if (report.straightened) describe();

  // 1. the car the player drives, capped
  let { body, glass, wheels, steering } = car;
  const nearBefore = tri(body) + tri(glass) + wheels.reduce((sum, w) => sum + tri(w), 0);
  // (a model that already went through here keeps its detailed level as it is: reducing a reduction again would
  // wear it down at every run)
  if (CAP && !entry.lod) {
    // (the tread and the ribs of the sidewall are drawn by the wheel material: the grooves modelled in a source tyre
    // are the first thing a reduction may spend)
    wheels = wheels.map((w) => reduceWheel(w, BUDGET.nearWheel, 0.006));
    if (steering) steering = reduce(steering, BUDGET.nearSteering, 0.002)[0];
    if (tri(body) + tri(glass) > BUDGET.nearShell) {
      const keep = BUDGET.nearShell / (tri(body) + tri(glass));
      body = reduce(body, Math.floor(tri(body) * keep), 0.003)[0];
      glass = reduce(glass, Math.max(40, Math.floor(tri(glass) * keep)), 0.003)[0];
    }
  }
  const nearAfter = tri(body) + tri(glass) + wheels.reduce((sum, w) => sum + tri(w), 0);
  report.near = [nearBefore, nearAfter];

  // 2. what the street sees of it
  const exterior = new Uint32Array(body.length + glass.length);
  exterior.set(body); exterior.set(glass, body.length);
  const { seen, front, back } = visibleSkin(positions, exterior);
  // Each visible triangle the right way out; one seen from both sides (the wall of a pick-up bed, a spoiler) twice.
  // A triangle turned over needs corners whose normals point the other way: those are new vertices.
  const mirror = new Map(), extra = [];
  const mirrored = (i) => { let j = mirror.get(i); if (j === undefined) { j = n + extra.length; mirror.set(i, j); extra.push(i); } return j; };
  const skinList = [];
  let turned = 0, doubled = 0;
  // A corner keeps its normal when that normal already points out of the side being drawn (a mirrored half whose
  // winding alone was reversed), and gets a turned copy when it points into the car
  const corner = (i, gx, gy, gz) => (normals[i * 4] * gx + normals[i * 4 + 1] * gy + normals[i * 4 + 2] * gz < -0.2 * unit ? mirrored(i) : i);
  for (let t = 0; t < seen.length; t++) {
    if (!seen[t]) continue;
    const a = exterior[t * 3], b = exterior[t * 3 + 1], c = exterior[t * 3 + 2];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
    let gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const gl = Math.hypot(gx, gy, gz) || 1;
    gx /= gl; gy /= gl; gz /= gl;
    const fr = front[t], bk = back[t], both = fr && bk && Math.min(fr, bk) / (fr + bk) > 0.2;
    if (both || fr >= bk) skinList.push(corner(a, gx, gy, gz), corner(b, gx, gy, gz), corner(c, gx, gy, gz));
    if (both || bk > fr) { skinList.push(corner(a, -gx, -gy, -gz), corner(c, -gx, -gy, -gz), corner(b, -gx, -gy, -gz)); if (both) doubled++; else turned++; }
  }
  if (extra.length) {
    const count = n + extra.length;
    const P = new Float32Array(count * 3), N = new normals.constructor(count * 4), T = new Uint16Array(count * 2), F = new Uint8Array(count);
    P.set(positions); N.set(normals); T.set(uvs); F.set(flags);
    extra.forEach((i, k) => {
      const to = n + k;
      P.set(positions.subarray(i * 3, i * 3 + 3), to * 3);
      for (let c = 0; c < 3; c++) N[to * 4 + c] = -normals[i * 4 + c];
      N[to * 4 + 3] = normals[i * 4 + 3];
      T.set(uvs.subarray(i * 2, i * 2 + 2), to * 2);
      F[to] = flags[i];
    });
    positions = P; normals = N; uvs = T; flags = F;
    describe();
  }
  const skin = Uint32Array.from(skinList);
  report.sides = [turned, doubled];
  report.skin = tri(skin);
  let [midShell, midError] = reduce(skin, BUDGET.midShell, 0.012);
  const midWheels = car.wheels.map((w) => reduceWheel(w, BUDGET.midWheel, 0.012));
  report.mid = [tri(midShell), +(midError * 1000).toFixed(1)];
  let [trafficShell, trafficError] = reduce(skin, BUDGET.trafficShell, 0.06, ['Prune']);
  const trafficWheels = car.wheels.map((w) => reduceWheel(w, BUDGET.trafficWheel, 0.03));
  report.traffic = [tri(trafficShell), +(trafficError * 1000).toFixed(1)];

  // 3. written tight, over the vertices still in use
  const lists = [body, glass, car.far, ...wheels, ...(car.calipers || []), ...(steering ? [steering] : []), trafficShell, ...trafficWheels, midShell, ...midWheels];
  const all = flags.length;
  const remap = new Int32Array(all).fill(-1);
  let used = 0;
  for (const list of lists) for (const i of list) if (remap[i] < 0) remap[i] = used++;
  const P = new Float32Array(used * 3), N = new normals.constructor(used * 4), T = new Uint16Array(used * 2), F = new Uint8Array(used);
  for (let i = 0; i < all; i++) {
    const to = remap[i];
    if (to < 0) continue;
    P.set(positions.subarray(i * 3, i * 3 + 3), to * 3);
    N.set(normals.subarray(i * 4, i * 4 + 4), to * 4);
    T.set(uvs.subarray(i * 2, i * 2 + 2), to * 2);
    F[to] = flags[i];
  }
  const ranges = [];
  let total = 0;
  for (const list of lists) { ranges.push([total, list.length]); total += list.length; }
  const indices = new Uint32Array(total);
  { let at = 0; for (const list of lists) for (const i of list) indices[at++] = remap[i]; }
  const pad = (bytes) => (4 - bytes % 4) % 4;
  fs.writeFileSync(path.join(OUT, `${id}.bin`), Buffer.concat([Buffer.from(P.buffer), Buffer.from(N.buffer), Buffer.from(T.buffer), Buffer.from(F.buffer), Buffer.alloc(pad(F.byteLength)), Buffer.from(indices.buffer)]));

  let at = 7;
  const next = { ...entry, vertices: used, indices: total, ranges: ranges.slice(0, 7).flat() };
  if (car.calipers) { next.calipers = ranges.slice(at, at + 4); at += 4; }
  if (car.steering) { next.steering = { ...entry.steering, range: ranges[at] }; at += 1; }
  next.trafficShell = ranges[at]; next.trafficWheels = ranges.slice(at + 1, at + 5); at += 5;
  next.midShell = ranges[at]; next.midWheels = ranges.slice(at + 1, at + 5);
  next.lod = { near: nearAfter, mid: tri(midShell) + midWheels.reduce((s, w) => s + tri(w), 0), traffic: tri(trafficShell) + trafficWheels.reduce((s, w) => s + tri(w), 0), far: tri(car.far) };
  report.bytes = fs.statSync(path.join(OUT, `${id}.bin`)).size;
  return [next, report];
}

const manifest = JSON.parse(fs.readFileSync(path.join(IN, 'models.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
const result = OUT === IN ? manifest : JSON.parse(JSON.stringify(manifest));
// donors are read before anything is written: a run in place must not borrow from a file it has just replaced
const donors = {};
for (const { from } of Object.values(WHEELS_FROM)) donors[from] = { entry: JSON.parse(JSON.stringify(manifest[from])), car: readCar(from, manifest[from]) };
console.log('model      near before → after   skin  turned/doubled   mid (mm)        traffic (mm)     file   (S: wheels put back on their axle, B: wheels borrowed)');
for (const [id, entry] of Object.entries(manifest)) {
  if (ONLY.length && !ONLY.includes(id)) continue;
  const started = Date.now();
  const [next, r] = buildCar(id, entry, donors);
  result[id] = next;
  console.log(id.padEnd(9), String(r.near[0]).padStart(8), '→', String(r.near[1]).padStart(7), String(r.skin).padStart(8), `${r.sides[0]}/${r.sides[1]}`.padStart(13), `${String(r.mid[0]).padStart(7)} (${r.mid[1]})`.padEnd(16), `${String(r.traffic[0]).padStart(6)} (${r.traffic[1]})`.padEnd(15), `${(r.bytes / 1048576).toFixed(1)} MB`, `${((Date.now() - started) / 1000).toFixed(1)} s`, (r.straightened ? `S${r.straightened} ` : '') + (WHEELS_FROM[id] ? `B ${WHEELS_FROM[id].from}` : ''));
}
fs.writeFileSync(path.join(OUT, 'models.json'), JSON.stringify(result));
