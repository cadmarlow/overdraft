// Turns a downloaded aircraft model (GLB) into what the game loads from assets/aircraft: one .bin with the geometry cut
// into the parts that move, each hung on a bone with its pivot and its axis, the points the flight model stands on
// (tyres, tips, nozzle, eye), and WebP maps with the source's national markings painted out. What a source lacks is
// made here: the biplane's propeller blades and the relief of its fabric.
// Everything about an aircraft is said in aircraft.json; README.md says how to read it.
//
//   node import.mjs <folder holding the downloads> [kinds...] [--dump]     (every aircraft of aircraft.json by default)
//
// sharp comes from tools/people: run `npm install` there once (a git worktree borrows the main checkout's).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readGLB } from './glb.mjs';
import { buildBlades, bladeTexture, chordAt, pitchAt } from './propeller.mjs';
import { paintOut } from './paint.mjs';
import { fabricNormals } from './fabric.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
function borrow(name) {
  const folders = [path.join(here, '../people/')];
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: here, encoding: 'utf8' }).trim();
    folders.push(path.join(path.resolve(here, common), '../tools/people/'));
  } catch { /* not a git checkout: tools/people is the only place */ }
  for (const folder of folders) { try { return createRequire(folder)(name); } catch { /* next */ } }
  throw new Error(`${name} is missing: run npm install in tools/people`);
}
const sharp = borrow('sharp');
const OUT = path.join(here, '../../assets/aircraft');
const config = JSON.parse(fs.readFileSync(path.join(here, 'aircraft.json'), 'utf8'));
const args = process.argv.slice(2), flags = args.filter((a) => a.startsWith('--')), [sources, ...only] = args.filter((a) => !a.startsWith('--'));
if (!sources) { console.error('usage: node import.mjs <downloads folder> [kinds...] [--dump]'); process.exit(1); }
const DUMP = flags.includes('--dump');
fs.mkdirSync(OUT, { recursive: true });

const AXIS = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const round = (v, digits = 4) => Number(v.toFixed(digits));
const round3 = (p) => p.map((v) => round(v));
const inBox = (p, b) => p[0] >= b[0] && p[1] >= b[1] && p[2] >= b[2] && p[0] <= b[3] && p[1] <= b[4] && p[2] <= b[5];
const mirrorBox = (b) => [-b[3], b[1], b[2], -b[0], b[4], b[5]];
const otherSide = (name) => name.replace(/L(\d*)$/, 'R$1');

// v turned by `degrees` about a unit axis
function turn(v, axis, degrees) {
  const a = degrees * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), d = dot(axis, v), x = cross(axis, v);
  return [v[0] * c + x[0] * sn + axis[0] * d * (1 - c), v[1] * c + x[1] * sn + axis[1] * d * (1 - c), v[2] * c + x[2] * sn + axis[2] * d * (1 - c)];
}

// The principal axes of a cloud of points, longest first (power iteration is plenty for a wheel or a hinge line)
function principal(points) {
  const c = [0, 0, 0];
  for (const p of points) for (let k = 0; k < 3; k++) c[k] += p[k] / points.length;
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += (p[i] - c[i]) * (p[j] - c[j]);
  const apply = (v) => cov.map((r) => dot(r, v));
  const power = (seed, skip = []) => {
    let v = norm(seed);
    for (let i = 0; i < 400; i++) { v = apply(v); for (const s of skip) { const d = dot(v, s); v = v.map((q, k) => q - d * s[k]); } v = norm(v); }
    return v;
  };
  const a = power([0.31, 0.83, 0.47]), b = power([0.77, 0.21, 0.6], [a]);
  return { centre: c, axes: [a, b, norm(cross(a, b))] };
}

// ---- The source in the game's frame -------------------------------------------------------------------------------------
// Metres, +X the pilot's left, +Y up, +Z the nose; x centred on the model's own box. The origin is settled later, from
// the wheels (stance).
function inFrame(spec, glb) {
  const z = AXIS[spec.nose], y = AXIS[spec.up], x = cross(y, z);
  const keep = new RegExp(spec.keep ?? '.');
  const meshes = glb.meshes.filter((m) => keep.test(m.node));
  if (!meshes.length) throw new Error(`no node matches ${spec.keep}`);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    for (let i = 0; i < m.position.length; i += 3) {
      const p = [m.position[i], m.position[i + 1], m.position[i + 2]], n = [m.normal[i], m.normal[i + 1], m.normal[i + 2]];
      const q = [dot(p, x), dot(p, y), dot(p, z)], r = [dot(n, x), dot(n, y), dot(n, z)];
      for (let k = 0; k < 3; k++) { m.position[i + k] = q[k]; m.normal[i + k] = r[k]; lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
    }
  }
  const axis = 'xyz'.indexOf(spec.fit.axis), S = spec.fit.size / (hi[axis] - lo[axis]), cx = (lo[0] + hi[0]) / 2;
  const origin = spec.origin || [0, 0, 0];
  for (const m of meshes) for (let i = 0; i < m.position.length; i += 3) {
    m.position[i] = (m.position[i] - cx) * S - origin[0];
    m.position[i + 1] = m.position[i + 1] * S - origin[1];
    m.position[i + 2] = m.position[i + 2] * S - origin[2];
  }
  return { meshes, scale: S };
}

// What stays connected is an island: a wheel, a door, a strut. Corners are welded by position first.
function islandsOf(mesh) {
  const P = mesh.position, n = P.length / 3, weld = new Map(), parent = [], id = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(P[i * 3] * 2e4)},${Math.round(P[i * 3 + 1] * 2e4)},${Math.round(P[i * 3 + 2] * 2e4)}`;
    let v = weld.get(key);
    if (v === undefined) { v = parent.length; parent.push(v); weld.set(key, v); }
    id[i] = v;
  }
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  for (let k = 0; k < mesh.index.length; k += 3) { const a = find(id[mesh.index[k]]); parent[find(id[mesh.index[k + 1]])] = a; parent[find(id[mesh.index[k + 2]])] = a; }
  const byRoot = new Map(), list = [];
  for (let k = 0; k < mesh.index.length; k += 3) {
    const root = find(id[mesh.index[k]]);
    let island = byRoot.get(root);
    if (!island) { island = { mesh, triangles: [], lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }; byRoot.set(root, island); list.push(island); }
    island.triangles.push(k);
    for (let j = 0; j < 3; j++) for (let c = 0; c < 3; c++) {
      const v = P[mesh.index[k + j] * 3 + c];
      if (v < island.lo[c]) island.lo[c] = v;
      if (v > island.hi[c]) island.hi[c] = v;
    }
  }
  for (const island of list) { island.count = island.triangles.length; island.centre = island.lo.map((v, c) => (v + island.hi[c]) / 2); }
  return list;
}

// The distinct corners of a set of islands
function cornersOf(islands) {
  const out = [];
  for (const island of islands) {
    const seen = new Set(), { mesh } = island;
    for (const k of island.triangles) for (let j = 0; j < 3; j++) {
      const v = mesh.index[k + j];
      if (seen.has(v)) continue;
      seen.add(v);
      out.push([mesh.position[v * 3], mesh.position[v * 3 + 1], mesh.position[v * 3 + 2]]);
    }
  }
  return out;
}
const boxOf = (points) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let c = 0; c < 3; c++) { if (p[c] < lo[c]) lo[c] = p[c]; if (p[c] > hi[c]) hi[c] = p[c]; }
  return { lo, hi, centre: lo.map((v, c) => (v + hi[c]) / 2) };
};

// ---- Which island makes which part --------------------------------------------------------------------------------------
// Rules are served in order; `sides` writes the right-hand twin of a rule given for the left (+X) side.
function expandRules(rules) {
  const out = [];
  for (const rule of rules) {
    out.push(rule);
    if (!rule.sides) continue;
    const twin = { ...rule };
    for (const key of ['part', 'bone']) if (twin[key]) twin[key] = otherSide(twin[key]);
    for (const key of ['inside', 'centre', 'touch']) if (twin[key]) twin[key] = mirrorBox(twin[key]);
    if (twin.ring) twin.ring = { ...twin.ring };
    out.push(twin);
  }
  return out.map((rule) => ({ ...rule, pattern: rule.nodes ? new RegExp(rule.nodes) : null }));
}
function ruleTakes(rule, island) {
  if (rule.pattern && !rule.pattern.test(island.mesh.node)) return false;
  if (rule.tris && (island.count < rule.tris[0] || island.count > rule.tris[1])) return false;
  if (rule.inside && !(inBox(island.lo, rule.inside) && inBox(island.hi, rule.inside))) return false;
  if (rule.centre && !inBox(island.centre, rule.centre)) return false;
  if (rule.touch) { const b = rule.touch; for (let c = 0; c < 3; c++) if (island.hi[c] < b[c] || island.lo[c] > b[c + 3]) return false; }
  return true;
}

// ---- Bones: where each moving part turns -----------------------------------------------------------------------------------
// A control surface hinges on its leading face: the line through the middle of that face, found station by station
// along the span so that a swept or tapered surface gets its own line.
function hingeOnEdge(points, forward, hint) {
  const f = AXIS[forward];
  const { axes } = principal(points);
  let along = axes[0];
  if (Math.abs(dot(along, f)) > 0.6) along = axes[1]; // a surface deeper than it is wide
  const s = points.map((p) => dot(p, along)), s0 = Math.min(...s), s1 = Math.max(...s), stations = [];
  const bins = 12;
  for (let b = 0; b < bins; b++) {
    const from = s0 + (s1 - s0) * b / bins, to = s0 + (s1 - s0) * (b + 1) / bins;
    const inBin = points.filter((p, i) => s[i] >= from && s[i] <= to);
    if (inBin.length < 2) continue;
    const front = Math.max(...inBin.map((p) => dot(p, f)));
    const face = inBin.filter((p) => dot(p, f) > front - 0.006);
    stations.push({ front, point: boxOf(face).centre });
  }
  // rounded tips and hinge cut-outs fall back from the line: keep the stations that agree with the most forward ones
  const ranked = stations.map((st) => st.front).sort((a, b) => b - a), reference = ranked[Math.floor(ranked.length / 3)];
  let kept = stations.filter((st) => Math.abs(st.front - reference) < 0.05);
  if (kept.length < 2) kept = stations;
  // least squares through the kept stations, twice, dropping what strays
  let line = principal(kept.map((st) => st.point));
  const off = (p) => { const d = sub(p, line.centre), t = dot(d, line.axes[0]); return Math.hypot(...sub(d, scale(line.axes[0], t))); };
  const close = kept.filter((st) => off(st.point) < 0.025);
  if (close.length >= 2) line = principal(close.map((st) => st.point));
  let axis = kept.length >= 2 ? line.axes[0] : along;
  if (dot(axis, hint) < 0) axis = scale(axis, -1);
  // the pivot: the line's point at mid span
  const mid = (s0 + s1) / 2, t = (mid - dot(line.centre, along)) / (dot(axis, along) || 1);
  return { pivot: add(line.centre, scale(axis, t)), axis: norm(axis) };
}

// A wheel turns about its axle: the thin axis of its tyre, through the tyre's middle
function axleOf(tyre, all, spec) {
  const corners = cornersOf([tyre]);
  const { axes } = principal(corners);
  let axis = axes[2];
  if (axis[0] < 0) axis = scale(axis, -1);
  const centre = boxOf(corners).centre;
  let radius = 0;
  for (const p of corners) { const d = sub(p, centre), t = dot(d, axis); radius = Math.max(radius, Math.hypot(...sub(d, scale(axis, t)))); }
  if (spec.round) {
    // an oval wheel wobbles when it turns: stretched fore and aft until it is as long as it is tall (its height is
    // what the aircraft stands on)
    const box = boxOf(corners), tall = box.hi[1] - box.lo[1], long = box.hi[2] - box.lo[2], k = tall / long;
    if (Math.abs(k - 1) > 0.004) {
      const done = new Set();
      for (const island of all) for (const t of island.triangles) for (let j = 0; j < 3; j++) {
        const v = island.mesh.index[t + j], key = island.mesh.node + ':' + v;
        if (done.has(key)) continue;
        done.add(key);
        const P = island.mesh.position, N = island.mesh.normal;
        P[v * 3 + 2] = centre[2] + (P[v * 3 + 2] - centre[2]) * k;
        const n = norm([N[v * 3], N[v * 3 + 1], N[v * 3 + 2] / k]);
        N[v * 3] = n[0]; N[v * 3 + 1] = n[1]; N[v * 3 + 2] = n[2];
      }
      for (const island of all) { const b = boxOf(cornersOf([island])); island.lo = b.lo; island.hi = b.hi; island.centre = b.centre; }
      radius = tall / 2;
      axis = [1, 0, 0];
      console.log(`    ${spec.name}: rounded (was ${(tall * 1000).toFixed(0)} mm tall, ${(long * 1000).toFixed(0)} mm long)`);
    }
  }
  // where the tyre meets the ground: the middle of its lowest corners
  const after = cornersOf([tyre]), low = Math.min(...after.map((p) => p[1]));
  const foot = boxOf(after.filter((p) => p[1] < low + 0.003)).centre;
  return { pivot: centre, axis: norm(axis), radius, contact: [foot[0], low, foot[2]] };
}

async function importAircraft(kind, spec) {
  console.log(`\n${kind} — ${spec.name}`);
  const glb = readGLB(path.join(sources, spec.source));
  const { meshes, scale: S } = inFrame(spec, glb);
  const islands = meshes.flatMap(islandsOf);
  const rules = expandRules(spec.parts);
  const takeAll = () => {
    for (const island of islands) {
      island.rule = rules.find((rule) => ruleTakes(rule, island)) || null;
      if (!island.rule) throw new Error(`${kind}: no rule takes an island of ${island.mesh.node} (${island.count} triangles at ${round3(island.centre)})`);
    }
  };
  takeAll();
  const ofBone = (name) => islands.filter((i) => !i.rule.drop && i.rule.bone === name);
  const tagged = (name) => islands.filter((i) => !i.rule.drop && (i.rule.part === name || i.rule.tag === name || i.rule.bone === name));

  // ---- stance: the origin is the centre of gravity the flight model uses, said from the main wheels
  const stance = spec.stance;
  const mains = () => stance.wheels.map((name) => {
    const all = ofBone(name), tyre = all.reduce((a, b) => (b.count > a.count ? b : a));
    return axleOf(tyre, all, { name, round: spec.bones[name]?.round ?? spec.bones[name.replace(/R$/, 'L')]?.round });
  });
  {
    const w = mains();
    const dz = (w[0].pivot[2] + w[1].pivot[2]) / 2 - stance.axle, dy = Math.min(w[0].contact[1], w[1].contact[1]) - stance.tyre;
    for (const m of meshes) for (let i = 0; i < m.position.length; i += 3) { m.position[i + 1] -= dy; m.position[i + 2] -= dz; }
    for (const island of islands) { island.lo[1] -= dy; island.hi[1] -= dy; island.centre[1] -= dy; island.lo[2] -= dz; island.hi[2] -= dz; island.centre[2] -= dz; }
    if (Math.abs(dy) > 0.02 || Math.abs(dz) > 0.02) {
      console.log(`  origin moved by y ${dy.toFixed(4)}, z ${dz.toFixed(4)} to stand on its wheels: add them to "origin" so that the boxes of aircraft.json stay true`);
      takeAll();
    }
  }
  console.log(`  scale ${S.toFixed(6)} (source units to metres)`);

  // ---- bones
  const bones = {};
  const boneSpecs = {};
  for (const [name, b] of Object.entries(spec.bones)) {
    boneSpecs[name] = b;
    if (!b.sides) continue;
    const twin = { ...b, twinOf: name };
    for (const key of ['parent', 'carry']) if (twin[key]) twin[key] = otherSide(twin[key]);
    if (twin.pivot) twin.pivot = [-twin.pivot[0], twin.pivot[1], twin.pivot[2]];
    // the mirror image of a turn: its axis reflected, then reversed
    if (twin.axis) twin.axis = [twin.axis[0], -twin.axis[1], -twin.axis[2]];
    if (twin.to) twin.to = [-twin.to[0], twin.to[1], twin.to[2]];
    boneSpecs[otherSide(name)] = twin;
  }
  const PASS = ['parent', 'angle', 'open', 'closed', 'swing', 'twist', 'shrink', 'group'];
  for (const [name, b] of Object.entries(boneSpecs)) {
    const mine = ofBone(name);
    if (!mine.length && !b.empty) throw new Error(`${kind}: nothing hangs on bone ${name}`);
    const corners = cornersOf(mine);
    let bone;
    if (b.wheel) {
      const tyre = mine.reduce((a, c) => (c.count > a.count ? c : a));
      bone = axleOf(tyre, mine, { name, round: !!b.round });
    } else if (b.edge) bone = hingeOnEdge(corners, b.edge, b.axis || [1, 0, 0]);
    else if (b.to) {
      // a leg that folds: the shortest turn about its pivot that carries the point `from` (default: the middle of
      // what hangs on the bone named by `carry`) to `to`
      const from = b.from || boxOf(cornersOf(ofBone(b.carry))).centre;
      const a = norm(sub(from, b.pivot)), c = norm(sub(b.to, b.pivot));
      bone = { pivot: b.pivot, axis: norm(cross(a, c)), swing: round(Math.acos(Math.max(-1, Math.min(1, dot(a, c)))) * 180 / Math.PI, 2) };
    } else {
      const centre = corners.length ? boxOf(corners).centre : [0, 0, 0];
      const pivot = (b.pivot || [null, null, null]).map((v, c) => (v === null ? centre[c] : v));
      bone = { pivot, axis: norm(b.axis || [1, 0, 0]) };
    }
    for (const key of PASS) if (b[key] !== undefined) bone[key] = b[key];
    bone.pivot = round3(bone.pivot); bone.axis = round3(bone.axis);
    if (bone.radius) bone.radius = round(bone.radius);
    if (bone.contact) bone.contact = round3(bone.contact);
    bones[name] = bone;
  }
  // a wheel that must lie flat in its bay: the shortest turn about its own middle that leaves its axle upright once
  // the leg has folded (the real aircraft does it with a link on the strut)
  for (const [name, b] of Object.entries(boneSpecs)) {
    if (!b.flat) continue;
    const wheel = bones[name], leg = bones[wheel.parent];
    const up = turn([0, 1, 0], leg.axis, -leg.swing);
    let best = null;
    for (const sign of [1, -1]) {
      const to = scale(up, sign), angle = Math.acos(Math.max(-1, Math.min(1, dot(wheel.axis, to)))) * 180 / Math.PI;
      if (best === null || angle < best.angle) best = { angle, axis: norm(cross(wheel.axis, to)) };
    }
    wheel.twist = round(best.angle, 2); wheel.twistAxis = round3(best.axis);
  }
  // rings of petals: one bone each, hinged on the tangent at its forward end
  for (const rule of rules) {
    if (!rule.ring) continue;
    const { centre, count, prefix, hinge, phase = 0 } = rule.ring;
    const mine = islands.filter((i) => i.rule === rule);
    // a petal is one node of the source, however many pieces it is made of
    for (const mesh of new Set(mine.map((i) => i.mesh))) {
      const pieces = mine.filter((i) => i.mesh === mesh), c = boxOf(cornersOf(pieces)).centre;
      const angle = Math.atan2(c[1] - centre[1], c[0] - centre[0]);
      const slot = ((Math.round((angle - phase) / (Math.PI * 2 / count)) % count) + count) % count;
      for (const island of pieces) island.bone = `${prefix}${slot}`;
    }
    // every petal hinges at the same distance from the axis: the median of what the whole ones measure
    const reach = [];
    for (let slot = 0; slot < count; slot++) {
      const front = cornersOf(mine.filter((i) => i.bone === `${prefix}${slot}`)).filter((p) => p[2] > hinge - 0.02 && p[2] < hinge + 0.06);
      if (front.length) { const c = boxOf(front).centre; reach.push(Math.hypot(c[0] - centre[0], c[1] - centre[1])); }
    }
    reach.sort((p, q) => p - q);
    const radius = rule.ring.radius ?? reach[reach.length >> 1];
    for (let slot = 0; slot < count; slot++) {
      if (!mine.some((i) => i.bone === `${prefix}${slot}`)) continue;
      const angle = phase + slot * Math.PI * 2 / count, radial = [Math.cos(angle), Math.sin(angle), 0];
      // positive closes the nozzle: the tail end of the petal swings towards the axis
      bones[`${prefix}${slot}`] = { pivot: round3([centre[0] + radial[0] * radius, centre[1] + radial[1] * radius, hinge]), axis: round3(cross([0, 0, 1], radial)), group: prefix };
    }
  }
  const boneOf = (island) => island.bone ?? island.rule.bone ?? null;

  // ---- points
  const points = {};
  for (const [name, probe] of Object.entries(spec.points)) {
    if (Array.isArray(probe)) { points[name] = probe; continue; }
    if (probe.wheel) { const b = bones[probe.wheel]; points[name] = b.contact; points[`${name}Radius`] = b.radius; continue; }
    let pool = [].concat(probe.of).flatMap((n) => (n === '*' ? islands.filter((i) => !i.rule.drop) : tagged(n)));
    if (!pool.length) throw new Error(`${kind}: point ${name} probes nothing (${probe.of})`);
    let corners = cornersOf(pool);
    if (probe.box) corners = corners.filter((p) => inBox(p, probe.box));
    if (!corners.length) throw new Error(`${kind}: point ${name}: no corner in its box`);
    let p;
    if (!probe.at || probe.at === 'centre') p = boxOf(corners).centre;
    else {
      const [which, axis] = probe.at.split('-'), c = 'xyz'.indexOf(axis), sign = which === 'max' ? 1 : -1;
      const best = Math.max(...corners.map((q) => q[c] * sign));
      p = boxOf(corners.filter((q) => q[c] * sign > best - 0.004)).centre;
      p[c] = best * sign;
      if (probe.radius) {
        // how far the probed corners reach from the axis through their middle (a nozzle's mouth)
        const centre = boxOf(corners.filter((q) => q[c] * sign > best - (probe.depth ?? 0.05))).centre;
        const ring = corners.filter((q) => q[c] * sign > best - (probe.depth ?? 0.05));
        points[`${name}Radius`] = round(Math.max(...ring.map((q) => Math.hypot(q[0] - centre[0], q[1] - centre[1]))));
        p = [centre[0], centre[1], best * sign];
      }
    }
    for (const [c, key] of ['x', 'y', 'z'].entries()) { if (probe[key] !== undefined) p[c] = probe[key]; if (probe[`d${key}`]) p[c] += probe[`d${key}`]; }
    points[name] = round3(p);
  }
  // mirrored points are given once: tipL makes tipR
  for (const name of spec.mirrorPoints || []) points[otherSide(name)] = [-points[name][0], points[name][1], points[name][2]];

  // ---- what the importer builds itself
  const extras = []; // { part, bone, material, position[], normal[], uv[], uv1[], index[] }
  if (spec.propeller) {
    const hub = bones[spec.propeller.bone].pivot;
    extras.push({ part: 'blades', bone: spec.propeller.bone, material: spec.propeller.material, ...buildBlades(spec.propeller, hub) });
    points.propHub = round3(hub);
    points.propRadius = spec.propeller.radius;
  }
  // ---- geometry: one run of vertices and one of indices per material, its parts as ranges
  const materialIds = Object.keys(spec.materials);
  const hasUv1 = !!spec.uv1; // a second UV set is shipped only for the aircraft that says so
  const runs = materialIds.map((id) => ({ id, position: [], normal: [], uv: [], uv1: [], index: [], parts: [], seen: new Map() }));
  // parts in a steady order: what never moves first, then by bone
  const partKey = (island) => `${island.rule.part}|${boneOf(island) ?? ''}`;
  const order = [];
  for (const island of islands) { if (island.rule.drop) continue; const k = partKey(island); if (!order.includes(k)) order.push(k); }
  order.sort((a, b) => (a.split('|')[1] ? 1 : 0) - (b.split('|')[1] ? 1 : 0));
  let dropped = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const run of runs) {
    for (const key of order) {
      const mine = islands.filter((i) => !i.rule.drop && i.rule.material === run.id && partKey(i) === key);
      if (!mine.length) continue;
      const [part, bone] = key.split('|');
      const start = run.index.length;
      for (const island of mine) {
        const { mesh } = island, fixed = island.rule.uv;
        for (const k of island.triangles) for (let j = 0; j < 3; j++) {
          const i = mesh.index[k + j];
          const p = [mesh.position[i * 3], mesh.position[i * 3 + 1], mesh.position[i * 3 + 2]];
          const n = [mesh.normal[i * 3], mesh.normal[i * 3 + 1], mesh.normal[i * 3 + 2]];
          const t = fixed || [mesh.uv[i * 2], mesh.uv[i * 2 + 1]], t1 = fixed ? (island.rule.uv1 || [0, 0]) : mesh.uv1 ? [mesh.uv1[i * 2], mesh.uv1[i * 2 + 1]] : [0, 0];
          const id = `${bone}|${p.map((c) => c.toFixed(5))}|${n.map((c) => c.toFixed(2))}|${t.map((c) => c.toFixed(5))}|${t1.map((c) => c.toFixed(5))}`;
          let at = run.seen.get(id);
          if (at === undefined) {
            at = run.position.length / 3;
            run.seen.set(id, at);
            run.position.push(...p); run.normal.push(...n); run.uv.push(...t); run.uv1.push(...t1);
            for (let c = 0; c < 3; c++) { if (p[c] < lo[c]) lo[c] = p[c]; if (p[c] > hi[c]) hi[c] = p[c]; }
          }
          run.index.push(at);
        }
      }
      run.parts.push({ name: part, bone: bone || null, start, count: run.index.length - start });
    }
    for (const extra of extras.filter((e) => e.material === run.id)) {
      const base = run.position.length / 3, start = run.index.length;
      run.position.push(...extra.position); run.normal.push(...extra.normal); run.uv.push(...extra.uv); run.uv1.push(...(extra.uv1 || extra.uv.map(() => 0)));
      for (const i of extra.index) run.index.push(base + i);
      for (let i = 0; i < extra.position.length; i += 3) for (let c = 0; c < 3; c++) { const v = extra.position[i + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
      const existing = run.parts.find((p) => p.name === extra.part && p.bone === (extra.bone || null) && p.start + p.count === start);
      if (existing) existing.count += extra.index.length;
      else run.parts.push({ name: extra.part, bone: extra.bone || null, start, count: extra.index.length });
    }
  }
  for (const island of islands) if (island.rule.drop) dropped += island.count;

  // ---- maps
  const written = [];
  const headerMaterials = [];
  const guides = new Map(); // material → its colour map as it stood before each mark (what the other maps' choices read)
  for (const id of materialIds) {
    const m = spec.materials[id], entry = { id, maps: {}, ...(m.set || {}) };
    for (const [slot, map] of Object.entries(m.maps || {})) {
      if (map.same) { entry.maps[slot] = { file: map.same, uv: map.uv || 0 }; continue; }
      const file = `${kind}_${map.name || id}_${slot}.webp`, size = map.size || 1024;
      let px;
      if (map.make === 'blade') px = bladeTexture(size, map.height || 64);
      else if (map.make === 'fabric') px = fabricNormals(size, map.panels);
      else {
        const source = glb.materials.get(map.material || m.source);
        if (!source) throw new Error(`${kind}: no source material ${map.material || m.source}`);
        const read = async (which) => {
          const image = source[which]?.image;
          if (!image) throw new Error(`${kind}: ${source.name} has no ${which} map`);
          return sharp(image).resize(size, size, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer();
        };
        if (typeof map.from === 'string') px = await read(map.from);
        else {
          // channels packed from several maps: ["occlusion.r", "metalRough.g", "metalRough.b"]
          px = Buffer.alloc(size * size * 3);
          const cache = {};
          for (const [c, from] of map.from.entries()) {
            if (typeof from === 'number') { for (let i = 0; i < size * size; i++) px[i * 3 + c] = from; continue; }
            const [which, channel] = from.split('.'), src = cache[which] ??= await read(which), k = 'rgb'.indexOf(channel);
            for (let i = 0; i < size * size; i++) px[i * 3 + c] = src[i * 3 + k];
          }
        }
        if (map.levels) {
          // occlusion baked too dark for an aircraft in the open sky: [black, white] brought to 0..255
          const [a, b] = map.levels, channels = map.levelChannels || [0, 1, 2];
          for (let i = 0; i < size * size; i++) for (const c of channels) px[i * 3 + c] = Math.max(0, Math.min(255, Math.round((px[i * 3 + c] - a) / (b - a) * 255)));
        }
        const marks = m.erase || [];
        if (marks.length && slot === 'c') guides.set(id, paintOut(px, size, marks, { slot }));
        else if (marks.length) paintOut(px, size, marks, { guides: guides.get(id) ?? null, colour: false, slot });
      }
      const height = map.make === 'blade' ? (map.height || 64) : size;
      await sharp(px, { raw: { width: size, height, channels: 3 } }).webp({ quality: map.quality || (slot === 'n' ? 92 : slot === 'c' ? 90 : 88), effort: 6 }).toFile(path.join(OUT, file));
      entry.maps[slot] = { file, uv: map.uv || 0 };
      written.push(file);
    }
    headerMaterials.push(entry);
  }

  // ---- the file
  const uvBox = (key) => {
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (const run of runs) for (let i = 0; i < run[key].length; i += 2) { u0 = Math.min(u0, run[key][i]); u1 = Math.max(u1, run[key][i]); v0 = Math.min(v0, run[key][i + 1]); v1 = Math.max(v1, run[key][i + 1]); }
    return [u0, v0, Math.max(u1, u0 + 1e-6), Math.max(v1, v0 + 1e-6)];
  };
  const uvRange = uvBox('uv'), uv1Range = hasUv1 ? uvBox('uv1') : null;
  const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const sections = [], chunks = [];
  let vertexStart = 0;
  const partsOut = [];
  const total = runs.reduce((s, r) => s + r.position.length / 3, 0);
  const P = new Uint16Array(total * 3), N = new Int8Array(total * 3), T = new Uint16Array(total * 2), T1 = hasUv1 ? new Uint16Array(total * 2) : null;
  const indexChunks = [];
  let indexBytes = 0, triangles = 0;
  runs.forEach((run, r) => {
    const count = run.position.length / 3;
    for (let i = 0; i < count; i++) {
      const o = vertexStart + i;
      for (let c = 0; c < 3; c++) {
        P[o * 3 + c] = Math.round((run.position[i * 3 + c] - lo[c]) / (hi[c] - lo[c]) * 65535);
        N[o * 3 + c] = Math.max(-127, Math.min(127, Math.round(run.normal[i * 3 + c] * 127)));
      }
      for (let c = 0; c < 2; c++) {
        T[o * 2 + c] = Math.round((run.uv[i * 2 + c] - uvRange[c]) / (uvRange[c + 2] - uvRange[c]) * 65535);
        if (T1) T1[o * 2 + c] = Math.round((run.uv1[i * 2 + c] - uv1Range[c]) / (uv1Range[c + 2] - uv1Range[c]) * 65535);
      }
    }
    const wide = count > 65535, I = wide ? Uint32Array.from(run.index) : Uint16Array.from(run.index);
    const bytes = pad(Buffer.from(I.buffer, I.byteOffset, I.byteLength));
    headerMaterials[r].vertices = [vertexStart, count];
    headerMaterials[r].index = { offset: indexBytes, count: run.index.length, size: I.BYTES_PER_ELEMENT };
    indexChunks.push(bytes); indexBytes += bytes.length;
    for (const part of run.parts) partsOut.push({ name: part.name, material: r, start: part.start, count: part.count, ...(part.bone ? { bone: part.bone } : {}) });
    vertexStart += count; triangles += run.index.length / 3;
  });
  for (const a of [P, N, T, T1]) { if (!a) continue; const b = pad(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); chunks.push(b); sections.push(b.length); }
  const indexAll = Buffer.concat(indexChunks); chunks.push(indexAll); sections.push(indexAll.length);
  // what the game needs to draw the propeller as a disc at speed: the blades' chord and pitch along their radius
  const samples = Array.from({ length: 33 }, (_, i) => i / 32);
  const propeller = spec.propeller && {
    ...spec.propeller,
    chords: samples.map((s) => (s * spec.propeller.radius < spec.propeller.root ? 0 : round(chordAt(spec.propeller, s)))),
    pitches: samples.map((s) => round(pitchAt(spec.propeller, s)))
  };
  const header = {
    version: 1, kind, name: spec.name, vertices: total, triangles,
    bounds: { min: round3(lo), max: round3(hi) }, uvRange: uvRange.map((v) => round(v, 6)), ...(uv1Range ? { uv1Range: uv1Range.map((v) => round(v, 6)) } : {}),
    attributes: ['position', 'normal', 'uv', ...(T1 ? ['uv1'] : []), 'index'], sections,
    materials: headerMaterials, parts: partsOut, bones, points, ...(propeller ? { propeller } : {})
  };
  const json = Buffer.from(JSON.stringify(header));
  const u32 = Buffer.alloc(4); u32.writeUInt32LE(json.length);
  fs.writeFileSync(path.join(OUT, `${kind}.bin`), Buffer.concat([pad(Buffer.concat([u32, json])), ...chunks]));

  // ---- report
  const kb = (file) => (fs.statSync(path.join(OUT, file)).size / 1024).toFixed(0);
  console.log(`  ${total} vertices, ${triangles} triangles (${dropped} dropped), ${Object.keys(bones).length} bones, ${kind}.bin ${kb(`${kind}.bin`)} KB`);
  console.log(`  box x ${lo[0].toFixed(3)} .. ${hi[0].toFixed(3)}   y ${lo[1].toFixed(3)} .. ${hi[1].toFixed(3)}   z ${lo[2].toFixed(3)} .. ${hi[2].toFixed(3)}`);
  for (const file of written) console.log(`  ${file} ${kb(file)} KB`);
  console.log('  parts:');
  for (const part of partsOut) console.log(`    ${part.name.padEnd(12)} ${headerMaterials[part.material].id.padEnd(7)} ${String(part.count / 3).padStart(6)} triangles${part.bone ? `  bone ${part.bone}` : ''}`);
  console.log('  bones:');
  for (const [name, b] of Object.entries(bones)) console.log(`    ${name.padEnd(12)} pivot ${b.pivot.map((v) => v.toFixed(3).padStart(7)).join(' ')}  axis ${b.axis.map((v) => v.toFixed(3).padStart(6)).join(' ')}${b.parent ? `  parent ${b.parent}` : ''}${b.radius ? `  radius ${b.radius}` : ''}${b.swing ? `  swing ${b.swing}°` : ''}`);
  console.log('  points:');
  for (const [name, p] of Object.entries(points)) console.log(`    ${name.padEnd(16)} ${Array.isArray(p) ? p.map((v) => v.toFixed(3).padStart(7)).join(' ') : p}`);
  if (DUMP) {
    console.log('  islands:');
    for (const island of islands.slice().sort((a, b) => b.count - a.count)) {
      console.log(`    ${String(island.count).padStart(6)} ${island.mesh.node.replace(/^avion_DEF5:|_low|_Material(\.001)?_0|_0$/g, '').slice(0, 22).padEnd(22)} lo ${island.lo.map((v) => v.toFixed(3).padStart(7)).join(' ')}  hi ${island.hi.map((v) => v.toFixed(3).padStart(7)).join(' ')}  → ${island.rule.drop ? 'dropped' : `${island.rule.part}${boneOf(island) ? ` (${boneOf(island)})` : ''}`}`);
    }
  }
}

for (const [kind, spec] of Object.entries(config)) {
  if (kind.startsWith('_') || (only.length && !only.includes(kind))) continue;
  await importAircraft(kind, spec);
}
