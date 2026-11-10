import * as THREE from 'three/webgpu';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

// The hardware CALIBRE fits on the four firearms (weapon-mods.js): suppressors, sights, a scope, foregrips, longer
// magazines, a tube extension and a choke. Machined here rather than imported: every piece is turned, extruded or
// lofted to the measures of the weapon it goes on, in that weapon's own space (metres, +Z along the barrel, +Y its
// top, +X its left). One geometry per attachment, drawn with one material: what each surface is made of rides on the
// vertices (`tint` = linear colour, `surface` = metalness, roughness, glow, and whether it takes the weapon's finish).

// What the pieces are made of: [linear colour], metalness, roughness, glow (emissive, as a share of the colour), and
// 1 for what is part of the weapon itself and wears its finish (a magazine, a tube), unlike what is bolted on
const ANODISED = [[0.026, 0.028, 0.032], 0.88, 0.4, 0];
const SATIN = [[0.034, 0.036, 0.04], 0.9, 0.3, 0]; // a turned body: catches a line of light along its length
const KNURL = [[0.017, 0.018, 0.021], 0.85, 0.52, 0];
const BLUED = [[0.014, 0.016, 0.021], 0.92, 0.36, 0, 1]; // gun steel, as on the shotgun's own tube and barrel
const POLYMER = [[0.0095, 0.01, 0.0115], 0, 0.56, 0];
const MAGAZINE = [...POLYMER, 1];
const RUBBER = [[0.011, 0.011, 0.012], 0, 0.86, 0];
const STEEL = [[0.3, 0.3, 0.31], 1, 0.34, 0]; // screw heads, pins
const VOID = [[0.002, 0.002, 0.003], 0, 0.9, 0]; // down a bore
const GLASS = [[0.012, 0.016, 0.02], 0.9, 0.05, 0];
const COATED_RED = [[0.26, 0.045, 0.028], 1, 0.07, 0.06]; // the front lens of a red dot: a ruby mirror
const COATED_BLUE = [[0.035, 0.05, 0.19], 1, 0.05, 0.05]; // a scope's objective
const COATED_GREEN = [[0.02, 0.07, 0.05], 1, 0.06, 0.04]; // and its eyepiece
const LED = [[1, 0.05, 0.02], 0, 0.4, 3];

// Where each weapon takes its hardware (weapon space), read off the shipped models (tools/gun-preview.html). `bore` is
// the centre of the muzzle face; `pitch` and `yaw` say how the barrel and its rails lean in the model's own frame (two
// of them were not modelled level), so that what is screwed on follows the steel rather than the axes.
const MOUNTS = {
  pistol: { bore: [0.0006, 0.0612, 0.1738], pitch: 0, yaw: 0 },
  smg: { bore: [0.0011, 0.0916, 0.32], pitch: 0.035, yaw: 0 },
  shotgun: { bore: [0, 0.0838, 0.49], pitch: 0, yaw: 0 },
  rifle: { bore: [-0.0038, 0.0822, 0.47], pitch: 0.038, yaw: -0.007 }
};

// ---- Tools of the trade ---------------------------------------------------------------------------------------------
const CREASE = 0.5; // faces meeting at more than this (rad) keep a hard edge
const _m = new THREE.Matrix4();

// Triangles of a closed piece facing outwards whichever way it was wound (a lathe or a loft does not say), without the
// slivers a lathe leaves on its axis
function outward(g) {
  const source = g.attributes.position.array, kept = new Float32Array(source.length);
  let length = 0;
  for (let i = 0; i < source.length; i += 9) {
    const ux = source[i + 3] - source[i], uy = source[i + 4] - source[i + 1], uz = source[i + 5] - source[i + 2];
    const vx = source[i + 6] - source[i], vy = source[i + 7] - source[i + 1], vz = source[i + 8] - source[i + 2];
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-12) continue;
    for (let k = 0; k < 9; k++) kept[length + k] = source[i + k];
    length += 9;
  }
  const p = kept.slice(0, length);
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  let volume = 0;
  for (let i = 0; i < p.length; i += 9) {
    volume += p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
  }
  if (volume < 0) for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
  return g;
}

// Any closed geometry as a machined part of one material: hard edges, smooth rounds, and what it is made of
function part(geometry, [color, metal, rough, glow, finished = 0], matrix = null) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  if (matrix) g.applyMatrix4(matrix);
  outward(g);
  // the crease pass welds positions on a centimetre grid: it is run in millimetres
  g.scale(1000, 1000, 1000);
  g = toCreasedNormals(g, CREASE);
  g.scale(0.001, 0.001, 0.001);
  const n = g.attributes.position.count;
  const tint = new Float32Array(n * 3), surface = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    tint[i * 3] = color[0]; tint[i * 3 + 1] = color[1]; tint[i * 3 + 2] = color[2];
    surface[i * 4] = metal; surface[i * 4 + 1] = rough; surface[i * 4 + 2] = glow; surface[i * 4 + 3] = finished;
  }
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  g.setAttribute('surface', new THREE.BufferAttribute(surface, 4));
  return g;
}

// A frame leaning with the steel: origin `at`, +Z turned up by `pitch` and aside by `yaw`
function frame(at, pitch = 0, yaw = 0) {
  return new THREE.Matrix4().makeRotationY(yaw).multiply(_m.makeRotationX(-pitch)).setPosition(at[0], at[1], at[2]);
}

// Lathe work: a profile of [radius, along the axis] pairs, closed back on itself unless it starts and ends on the axis
function lathe(profile, segments) {
  const open = profile[0][0] > 1e-4 || profile[profile.length - 1][0] > 1e-4;
  return new THREE.LatheGeometry((open ? [...profile, profile[0]] : profile).map(([r, a]) => new THREE.Vector2(Math.max(r, 1e-5), a)), segments);
}
// Round +Z (tubes, caps, lenses), round +Y (a grip), round +X (a knob on the side of something)
const turned = (profile, segments = 40) => lathe(profile, segments).rotateX(Math.PI / 2);
const turnedY = (profile, segments = 32) => lathe(profile, segments);
const turnedX = (profile, segments = 24) => turned(profile, segments).rotateY(Math.PI / 2);
// A lens seated at z, bulging `bulge` towards whoever looks into it (the sign says which way): its curve is what
// breaks the sky's reflection across the glass
const lens = (r, z, bulge) => [[0, z + bulge], [r * 0.45, z + bulge * 0.8], [r * 0.75, z + bulge * 0.45], [r * 0.93, z + bulge * 0.13], [r, z], [r, z - Math.sign(bulge) * 0.0005], [0, z - Math.sign(bulge) * 0.0005]];
// A plain plug: radius r from a to b along the lathe's axis, its edges broken by `chamfer`
const plug = (r, a, b, chamfer = 0.0005) => [[0, a], [r - chamfer, a], [r, a + chamfer], [r, b - chamfer], [r - chamfer, b], [0, b]];

// A ring of straight flutes round +Z, between z0 and z1: what knurling reads as from a metre away
function fluted(r, z0, z1, count = 36, depth = 0.0006, inner = r - depth - 0.0012) {
  const shape = new THREE.Shape(), step = Math.PI * 2 / count;
  for (let i = 0; i < count; i++) {
    for (const [f, rho] of [[0, r], [0.5, r], [0.6, r - depth], [0.9, r - depth]]) {
      const a = (i + f) * step;
      shape[i === 0 && f === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * rho, Math.sin(a) * rho);
    }
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments: 20 }).translate(0, 0, z0);
}
const flutedX = (r, x0, x1, count, depth) => fluted(r, x0, x1, count, depth).rotateY(Math.PI / 2);
const flutedY = (r, y0, y1, count, depth) => fluted(r, -y1, -y0, count, depth).rotateX(Math.PI / 2);

// An outline as a THREE.Shape; `round` cuts every corner with an arc of that radius
function outline(points, round = 0) {
  const shape = new THREE.Shape(), n = points.length;
  if (!round) {
    points.forEach(([x, y], i) => shape[i ? 'lineTo' : 'moveTo'](x, y));
    shape.closePath();
    return shape;
  }
  for (let i = 0; i < n; i++) {
    const [px, py] = points[(i + n - 1) % n], [x, y] = points[i], [nx, ny] = points[(i + 1) % n];
    const a = Math.hypot(px - x, py - y), b = Math.hypot(nx - x, ny - y), r = Math.min(round, a / 2, b / 2);
    const sx = x + (px - x) / a * r, sy = y + (py - y) / a * r, ex = x + (nx - x) / b * r, ey = y + (ny - y) / b * r;
    shape[i ? 'lineTo' : 'moveTo'](sx, sy);
    shape.quadraticCurveTo(x, y, ex, ey);
  }
  shape.closePath();
  return shape;
}
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const extrude = (shape, depth, bevel) => new THREE.ExtrudeGeometry(shape, bevel
  ? { depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, curveSegments: 5 }
  : { depth, bevelEnabled: false, curveSegments: 5 }).translate(0, 0, bevel || 0);
// A front view [x, y] pushed along the barrel from z0 to z1
const alongZ = (points, z0, z1, { round = 0, bevel = 0, holes = [] } = {}) => {
  const shape = outline(points, round);
  for (const hole of holes) shape.holes.push(outline([...hole].reverse(), round ? Math.min(round, 0.003) : 0));
  return extrude(shape, z1 - z0, bevel).translate(0, 0, z0);
};
// A side view [z, y] pushed across the weapon from x0 to x1
const acrossX = (points, x0, x1, opts = {}) => extrude(outline(points, opts.round), x1 - x0, opts.bevel).rotateY(-Math.PI / 2).translate(x1, 0, 0);
// A top view [x, z] pushed down from y1 to y0
const downY = (points, y0, y1, opts = {}) => extrude(outline(points, opts.round), y1 - y0, opts.bevel).rotateX(Math.PI / 2).translate(0, y1, 0);
const block = (x0, y0, z0, x1, y1, z1, bevel = 0.0006) => alongZ(rect(x0, y0, x1, y1), z0, z1, { bevel });

// A skin through closed rings of [x, y, z] points (as many in each), capped at both ends
function loft(rings) {
  const n = rings[0].length, out = [];
  const tri = (a, b, c) => out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < n; j++) {
      const a = rings[i][j], b = rings[i][(j + 1) % n], c = rings[i + 1][(j + 1) % n], d = rings[i + 1][j];
      tri(a, b, c); tri(a, c, d);
    }
  }
  for (const [ring, flip] of [[rings[0], true], [rings[rings.length - 1], false]]) {
    const centre = [0, 1, 2].map((k) => ring.reduce((sum, p) => sum + p[k], 0) / n);
    for (let j = 0; j < n; j++) flip ? tri(centre, ring[(j + 1) % n], ring[j]) : tri(centre, ring[j], ring[(j + 1) % n]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out), 3));
  return g;
}
// A rounded rectangle as a ring of [u, v] points, anticlockwise from the +u side: half sizes a × b, corner radius r
function roundedRing(a, b, r, steps = 4) {
  const ring = [];
  for (const [cu, cv, start] of [[a - r, b - r, 0], [-(a - r), b - r, 1], [-(a - r), -(b - r), 2], [a - r, -(b - r), 3]]) {
    for (let k = 0; k <= steps; k++) {
      const t = (start + k / steps) * Math.PI / 2;
      ring.push([cu + Math.cos(t) * r, cv + Math.sin(t) * r]);
    }
  }
  return ring;
}

// ---- Suppressors ----------------------------------------------------------------------------------------------------
// A can screwed over the muzzle: `back` metres of it reach behind the muzzle face over whatever the barrel ends with
// (`hole` clears it), a lock collar, the tube, its two knurled end caps, and a recessed front with the bore in it.
function suppressor({ radius: R, length, back, hole, collar, collarLength, bore, flutes }) {
  const a = -back, c = a + collarLength, f = a + length; // rear face, shoulder, front face
  const body = turned([
    [0, a + 0.012], [hole, a + 0.012], [hole, a], [collar - 0.0006, a], [collar, a + 0.0006], [collar, c - 0.001],
    [R - 0.0016, c], [R, c + 0.0016],
    // a turned groove sets each end cap off the tube
    [R, c + 0.0175], [R - 0.0007, c + 0.0182], [R - 0.0007, c + 0.0194], [R, c + 0.0201],
    [R, f - 0.0211], [R - 0.0007, f - 0.0204], [R - 0.0007, f - 0.0192], [R, f - 0.0185],
    [R, f - 0.0018], [R - 0.0018, f],
    // the front: a flat rim, a dished cap, the bore
    [R * 0.68, f], [R * 0.6, f - 0.0022], [bore + 0.0012, f - 0.0022], [bore, f - 0.0034], [bore, f - 0.02], [0, f - 0.02]
  ], 48);
  return [
    part(body, SATIN),
    part(fluted(collar + 0.0007, a + 0.002, c - 0.0025, Math.round(flutes * 0.7), 0.0006), KNURL),
    part(fluted(R + 0.0005, c + 0.0035, c + 0.016, flutes, 0.0006), KNURL),
    part(fluted(R + 0.0005, f - 0.017, f - 0.0045, flutes, 0.0006), KNURL),
    part(turned(plug(bore + 0.0002, f - 0.0205, f - 0.0195, 0), 20), VOID)
  ];
}
const SUPPRESSORS = {
  // 3.2 cm × 17 cm on the pistol's bare barrel; 3.7 × 19.5 over the SMG's flash hider; 4 × 20.5 over the rifle's brake
  pistol: { radius: 0.016, length: 0.17, back: 0.006, hole: 0.0079, collar: 0.0112, collarLength: 0.02, bore: 0.0052, flutes: 40 },
  smg: { radius: 0.0185, length: 0.195, back: 0.046, hole: 0.0108, collar: 0.0148, collarLength: 0.02, bore: 0.0036, flutes: 44 },
  rifle: { radius: 0.02, length: 0.205, back: 0.088, hole: 0.0139, collar: 0.0172, collarLength: 0.022, bore: 0.0042, flutes: 48 }
};

// ---- Sights ---------------------------------------------------------------------------------------------------------
// A clamp that grips a rail from above (front view, the rail's top face at y = 0, `half` its half-width)
const clampOutline = (half, wide, top) => [[-wide, -0.0032], [-half, -0.0032], [-half, 0], [half, 0], [half, -0.0032], [wide, -0.0032],
  [wide, top - 0.002], [wide - 0.002, top], [-wide + 0.002, top], [-wide, top - 0.002]];

// The pistol's: a micro reflex on a plate, low on the slide. Origin: the slide's top, at the rear of the plate
function reflexSight() {
  const w = 0.0132, sill = 0.0105, top = 0.0298, z0 = 0.027, z1 = 0.0455;
  const hood = alongZ([[-w, sill - 0.002], [w, sill - 0.002], [w, top - 0.005], [w - 0.005, top], [-w + 0.005, top], [-w, top - 0.005]], z0, z1,
    { holes: [[[-w + 0.0026, sill + 0.0018], [w - 0.0026, sill + 0.0018], [w - 0.0026, top - 0.0062], [w - 0.0062, top - 0.0026], [-w + 0.0062, top - 0.0026], [-w + 0.0026, top - 0.0062]]], bevel: 0.0005 });
  const ear = [[0.0035, sill - 0.001], [z0 + 0.001, sill - 0.001], [z0 + 0.001, top - 0.0012], [z0 - 0.0035, top - 0.0012]];
  return [
    part(downY(rect(-0.0108, 0, 0.0108, 0.046), 0, 0.0036, { round: 0.003, bevel: 0.0005 }), ANODISED),
    part(block(-w + 0.0006, 0.0034, 0.0012, w - 0.0006, sill, z1 - 0.0004, 0.0008), ANODISED),
    part(hood, ANODISED),
    part(acrossX(ear, w - 0.0026, w, { bevel: 0.0004 }), ANODISED),
    part(acrossX(ear, -w, -w + 0.0026, { bevel: 0.0004 }), ANODISED),
    // the window, leaning back a little as they do, and the emitter that throws the dot onto it
    part(block(-w + 0.0022, sill + 0.0012, -0.0006, w - 0.0022, top - 0.0022, 0.0006, 0), COATED_RED,
      new THREE.Matrix4().makeRotationX(-0.14).setPosition(0, 0, z1 - 0.006)),
    part(block(-0.0042, sill - 0.0005, 0.004, 0.0042, sill + 0.0034, 0.0125, 0.0006), ANODISED),
    part(block(-0.0012, sill + 0.0008, 0.0124, 0.0012, sill + 0.0026, 0.0131, 0), LED),
    // brightness buttons on the flanks, the plate's two screws
    part(turnedX(plug(0.0027, w - 0.0012, w + 0.0008, 0.0004), 14).translate(0, 0.0068, 0.017), RUBBER),
    part(turnedX(plug(0.0027, -w - 0.0008, -w + 0.0012, 0.0004), 14).translate(0, 0.0068, 0.017), RUBBER),
    part(turnedY(plug(0.0019, sill - 0.0004, sill + 0.0005, 0.0002), 12).translate(-0.0072, 0, 0.0195), STEEL),
    part(turnedY(plug(0.0019, sill - 0.0004, sill + 0.0005, 0.0002), 12).translate(0.0072, 0, 0.0195), STEEL)
  ];
}

// The SMG's: a tube red dot on a rail clamp. Origin: the rail's top face, under the middle of the sight
function tubeSight(half) {
  const R = 0.0162, c = 0.0282, l = 0.0305; // tube radius, height of its axis over the rail, half-length
  const tube = turned([
    [0, -0.0225], [R - 0.0034, -0.0225], [R - 0.0034, -l + 0.0005], [R + 0.0012, -l + 0.0005], [R + 0.0018, -l + 0.0012], [R + 0.0018, -l + 0.0068], [R, -l + 0.0078],
    [R, l - 0.0088], [R + 0.0018, l - 0.0078], [R + 0.0018, l - 0.0012], [R + 0.0012, l - 0.0005], [R - 0.0034, l - 0.0005], [R - 0.0034, 0.0225], [0, 0.0225]
  ], 40).translate(0, c, 0);
  const knob = (r, x0, x1) => [part(turnedX(plug(r - 0.0009, Math.min(x0, x1), Math.max(x0, x1), 0.0006), 28), ANODISED),
    part(flutedX(r, Math.min(x0, x1) + 0.0012, Math.max(x0, x1) - 0.0012, 28, 0.0006), KNURL)];
  const at = (parts, x, y, z) => parts.map((g) => g.translate(x, y, z));
  return [
    part(alongZ(clampOutline(half, half + 0.0034, 0.0078), -0.019, 0.019, { bevel: 0.0006 }), ANODISED),
    part(block(-0.0105, 0.0072, -0.0165, 0.0105, c - 0.004, 0.0165, 0.001), ANODISED),
    part(alongZ(rect(-0.0148, c - 0.0105, 0.0148, c + 0.003), -0.018, 0.018, { round: 0.003, bevel: 0.0008 }), ANODISED),
    part(tube, ANODISED),
    // the lenses, set back in the tube: a ruby mirror to the front, plain glass to the eye
    part(turned(lens(R - 0.0036, 0.0228, 0.0016), 32).translate(0, c, 0), COATED_RED),
    part(turned(lens(R - 0.0036, -0.0228, -0.0012), 32).translate(0, c, 0), GLASS),
    // elevation on top, windage on the right, the brightness dial on the left, the clamp's bolt below it
    part(turnedY(plug(0.0072, c + R - 0.0015, c + R + 0.0052, 0.0007), 24).translate(0, 0, 0.0035), ANODISED),
    part(flutedY(0.0079, c + R + 0.0012, c + R + 0.0044, 24, 0.0006).translate(0, 0, 0.0035), KNURL),
    ...at(knob(0.0072, -0.0148, -0.0212), 0, c, 0.0035),
    ...at(knob(0.0104, 0.0148, 0.0252), 0, c - 0.0028, -0.003),
    ...at(knob(0.0058, half + 0.0034, half + 0.0102), 0, 0.0012, 0),
    part(turnedX(plug(0.0042, -half - 0.0062, -half - 0.0034, 0.0005), 6), STEEL).translate(0, 0.0012, 0)
  ];
}

// The rifle's: a 3× scope in two rings. Origin: the rail's top face, under the turrets
function scope(half) {
  const T = 0.015, c = 0.0295; // main tube radius, height of its axis over the rail
  const O = 0.0218, E = 0.0196; // objective bell and eyepiece radii
  const zf = 0.118, zb = -0.128;
  const tube = turned([
    // eyepiece, from the eye forward: rubber lip, the body, the zoom ring's seat, the neck down to the tube
    [0, zb + 0.008], [E - 0.0052, zb + 0.008], [E - 0.0052, zb + 0.0006], [E - 0.0006, zb + 0.0006], [E + 0.0006, zb + 0.0016], [E + 0.0006, zb + 0.011], [E, zb + 0.012],
    [E, zb + 0.047], [E - 0.0008, zb + 0.049], [T + 0.0012, zb + 0.064], [T, zb + 0.066],
    // the tube, then the bell
    [T, 0.06], [T + 0.0008, 0.062], [O - 0.0006, 0.084], [O, 0.086], [O, zf - 0.0105], [O + 0.0007, zf - 0.0098],
    [O + 0.0007, zf - 0.0008], [O, zf], [O - 0.0026, zf], [O - 0.0026, zf - 0.009], [0, zf - 0.009]
  ], 48).translate(0, c, 0);
  const knob = (r, a, b) => [part(turned(plug(r - 0.001, a, b, 0.0008), 28), ANODISED), part(fluted(r, Math.max(a, b - 0.0085), b - 0.0015, 30, 0.0006), KNURL)];
  const up = new THREE.Matrix4().makeRotationX(-Math.PI / 2), right = new THREE.Matrix4().makeRotationY(-Math.PI / 2), left = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  const turret = (r, a, b, m) => knob(r, a, b).map((g) => g.applyMatrix4(_m.copy(m).setPosition(0, c, 0)));
  const ring = (z) => {
    const band = turned([[T - 0.001, -0.0068], [T + 0.0046, -0.0068], [T + 0.0052, -0.0062], [T + 0.0052, 0.0062], [T + 0.0046, 0.0068], [T - 0.001, 0.0068]], 40).translate(0, c, z);
    const foot = alongZ([...clampOutline(half, half + 0.0036, 0.0075).slice(0, 6), [half + 0.0036, 0.0052], [0.0082, 0.0095], [0.0082, c - T + 0.003],
      [-0.0082, c - T + 0.003], [-0.0082, 0.0095], [-half - 0.0036, 0.0052]], z - 0.0068, z + 0.0068, { bevel: 0.0005 });
    return [
      part(band, ANODISED), part(foot, ANODISED),
      // the split of the ring with its two cap screws a side, and the clamp's nut
      part(block(T + 0.0044, c - 0.0016, z - 0.0058, T + 0.0082, c + 0.0016, z + 0.0058, 0.0005), ANODISED),
      part(block(-T - 0.0082, c - 0.0016, z - 0.0058, -T - 0.0044, c + 0.0016, z + 0.0058, 0.0005), ANODISED),
      part(turnedY(plug(0.0017, c + 0.0012, c + 0.0024, 0.0003), 10).translate(T + 0.0063, 0, z), STEEL),
      part(turnedY(plug(0.0017, c + 0.0012, c + 0.0024, 0.0003), 10).translate(-T - 0.0063, 0, z), STEEL),
      part(turnedX(plug(0.0048, half + 0.0036, half + 0.0086, 0.0006), 6).translate(0, 0.0012, z), STEEL)
    ];
  };
  return [
    part(tube, ANODISED),
    part(fluted(E + 0.0012, zb + 0.034, zb + 0.047, 40, 0.0007), KNURL).translate(0, c, 0),
    part(turned([[E - 0.005, zb - 0.0004], [E + 0.0011, zb - 0.0004], [E + 0.0011, zb + 0.0105], [E - 0.005, zb + 0.0105]], 40).translate(0, c, 0), RUBBER),
    // the glass, set back in its two mouths
    part(turned(lens(O - 0.0028, zf - 0.0088, 0.0034), 40).translate(0, c, 0), COATED_BLUE),
    part(turned(lens(E - 0.0054, zb + 0.0078, -0.0022), 40).translate(0, c, 0), COATED_GREEN),
    // the saddle and its three turrets: elevation on top, windage on the right, the illumination dial on the left
    part(alongZ(rect(-T - 0.0022, c - T - 0.0012, T + 0.0022, c + T + 0.0022), -0.0135, 0.0135, { round: 0.0045, bevel: 0.0009 }), ANODISED),
    ...turret(0.0098, T + 0.0015, T + 0.0162, up), ...turret(0.0098, T + 0.0015, T + 0.0162, right), ...turret(0.0086, T + 0.0015, T + 0.0125, left),
    ...ring(-0.044), ...ring(0.04)
  ];
}

// ---- Foregrips ------------------------------------------------------------------------------------------------------
// A vertical grip under a rail (or bolted flat under a pump: `half` null). Origin: the rail's lower face, over the grip
function foregrip(half) {
  const saddle = half
    ? [[-half - 0.0034, 0.0032], [-half - 0.0034, -0.0062], [-half - 0.0004, -0.0102], [half + 0.0004, -0.0102], [half + 0.0034, -0.0062], [half + 0.0034, 0.0032], [half, 0.0032], [half, 0], [-half, 0], [-half, 0.0032]]
    : [[-0.0165, 0], [-0.0165, -0.0058], [-0.013, -0.0102], [0.013, -0.0102], [0.0165, -0.0058], [0.0165, 0]];
  // the shaft: flared where it meets the saddle, three finger swells, a foot. Round +Y, then pressed into an oval
  const shaft = turnedY([[0, -0.094], [0.0128, -0.094], [0.0148, -0.0922], [0.0148, -0.086], [0.0136, -0.0835], [0.0131, -0.078], [0.0139, -0.071], [0.0129, -0.064],
    [0.0139, -0.057], [0.0129, -0.05], [0.0139, -0.043], [0.0129, -0.036], [0.0136, -0.029], [0.0128, -0.022], [0.0134, -0.016], [0.0152, -0.0098], [0, -0.0098]], 32).scale(0.92, 1, 1.12);
  const pieces = [
    part(alongZ(saddle, -0.02, 0.02, { bevel: 0.0007 }), ANODISED),
    part(shaft, POLYMER),
    part(flutedY(0.0152, -0.0935, -0.0868, 30, 0.0007).scale(0.92, 1, 1.12), RUBBER)
  ];
  if (half) {
    pieces.push(part(turnedX(plug(0.0049, half + 0.0034, half + 0.0098, 0.0006), 24).translate(0, -0.0032, 0), ANODISED),
      part(flutedX(0.0058, half + 0.0046, half + 0.0086, 22, 0.0006).translate(0, -0.0032, 0), KNURL),
      part(turnedX(plug(0.0042, -half - 0.006, -half - 0.0034, 0.0005), 6).translate(0, -0.0032, 0), STEEL));
  } else {
    for (const z of [-0.0135, 0.0135]) for (const x of [-0.0165, 0.0165]) pieces.push(part(turnedX(plug(0.0022, Math.min(x, x * 1.06), Math.max(x, x * 1.06), 0.0003), 10).translate(0, -0.0034, z), STEEL));
  }
  return pieces;
}

// ---- Magazines ------------------------------------------------------------------------------------------------------
// The pistol's: a sleeve under the grip that carries on the well's rake, ending in a pad. The floor plate it swallows
// runs z −0.0384..0.0063 at y −0.052, 17.6 mm wide, round at the front
function pistolMagazine() {
  const top = -0.0514, rake = 0.23; // z gained per metre of height, as the well leans
  const ring = (grow, y) => {
    // seen from above: a round toe at the front, two small corners at the back
    const front = 0.0066 + grow, back = -0.0388 - grow, w = 0.0092 + grow, points = [];
    for (const [cx, cz, r, from, steps] of [[w - 0.0082, front - 0.0082, 0.0082, 0, 5], [-(w - 0.0082), front - 0.0082, 0.0082, 1, 5], [-(w - 0.003), back + 0.003, 0.003, 2, 3], [w - 0.003, back + 0.003, 0.003, 3, 3]]) {
      for (let k = 0; k <= steps; k++) { const t = (from + k / steps) * Math.PI / 2; points.push([cx + Math.cos(t) * r, y, cz + Math.sin(t) * r + (y - top) * rake]); }
    }
    return points;
  };
  return [
    part(loft([ring(0, top), ring(0, -0.0775), ring(0.0012, -0.079), ring(0.0012, -0.0862), ring(0.0004, -0.0872)]), MAGAZINE),
    part(block(-0.0045, -0.0874, -0.036, 0.0045, -0.0866, -0.008, 0), RUBBER, new THREE.Matrix4().makeTranslation(0, 0, (-0.087 - top) * rake))
  ];
}

// The SMG's: its box carried on down its own rake behind a collar that swallows the old floor plate
function smgMagazine() {
  const o = [0.0266, -0.1526], d = [0.279, -0.96], e = [0.96, 0.279]; // a point on the axis [z, y], the way down it, and towards the front
  const ring = (s, depth, width) => roundedRing(depth, width, 0.0034).map(([u, x]) => [x, o[1] + d[1] * s + e[1] * u, o[0] + d[0] * s + e[0] * u]);
  return [
    part(loft([ring(-0.002, 0.0293, 0.0126), ring(-0.001, 0.0303, 0.0136), ring(0.0275, 0.0303, 0.0136), ring(0.0285, 0.0293, 0.0126)]), MAGAZINE),
    part(loft([ring(0.027, 0.0274, 0.0113), ring(0.079, 0.0274, 0.0113)]), MAGAZINE),
    part(loft([ring(0.078, 0.0286, 0.0124), ring(0.079, 0.0298, 0.0132), ring(0.0872, 0.0298, 0.0132), ring(0.0882, 0.0288, 0.0122)]), MAGAZINE),
    // witness holes down the flank, as on the magazine above
    ...[0.04, 0.053, 0.066].flatMap((s) => [[0.0111, 0.0115], [-0.0115, -0.0111]].map(([x0, x1]) =>
      part(turnedX(plug(0.0019, x0, x1, 0), 10).translate(0, o[1] + d[1] * s - e[1] * 0.012, o[0] + d[0] * s - e[0] * 0.012), VOID)))
  ];
}

// The rifle's: the banana carried on round its own two arcs (the spine and the front are not concentric on this
// model), from just above its floor plate, with the front rib and a floor plate of its own
function rifleMagazine() {
  const F = { c: [0.1734, 0.0483], r: 0.2143, a0: 233.2, da: 2.75 }, B = { c: [0.2435, 0.0998], r: 0.3526, a0: 225.5, da: 1.84 };
  const on = (arc, k, grow) => {
    const a = (arc.a0 + arc.da * k) * Math.PI / 180, r = arc.r + grow;
    return [arc.c[0] + Math.cos(a) * r, arc.c[1] + Math.sin(a) * r]; // [z, y]
  };
  // station k (0 = the old floor plate, counting down the magazine): a rounded box between the two arcs
  const ring = (k, grow, half) => {
    const f = on(F, k, -grow), b = on(B, k, grow), depth = Math.hypot(f[0] - b[0], f[1] - b[1]) / 2;
    const m = [(f[0] + b[0]) / 2, (f[1] + b[1]) / 2], u = [(f[0] - b[0]) / (2 * depth), (f[1] - b[1]) / (2 * depth)];
    return roundedRing(depth, half, 0.0042).map(([t, x]) => [x, m[1] + u[1] * t, m[0] + u[0] * t]);
  };
  const rib = (k, grow) => {
    const f = on(F, k, -grow - 0.0142), g = on(F, k, 0.004), half = 0.0068 + grow;
    return [[half, f[1], f[0]], [half, g[1], g[0]], [-half, g[1], g[0]], [-half, f[1], f[0]]];
  };
  const stations = [-2.6, -1.5, 0, 1.5, 3, 4.5, 6, 7.2];
  return [
    part(loft([ring(-2.9, 0.0002, 0.0142), ring(-2.6, 0.001, 0.0149), ...stations.slice(1).map((k) => ring(k, 0.001, 0.0149))]), MAGAZINE),
    part(loft(stations.map((k) => rib(k, 0.0004))), MAGAZINE),
    part(loft([ring(7.0, 0.0012, 0.0151), ring(7.2, 0.0022, 0.016), ring(7.75, 0.0022, 0.016), ring(7.9, 0.0012, 0.015)]), MAGAZINE),
    // the stiffening ribs pressed across the flanks
    ...[0.6, 2.4, 4.2, 6].map((k) => part(loft([ring(k - 0.22, 0.0004, 0.0156), ring(k + 0.22, 0.0004, 0.0156)]), MAGAZINE))
  ];
}

// The shotgun's: the tube carried on to the muzzle behind a knurled coupling nut, and clamped to the barrel.
// Tube axis at y 0.0551, radius 12.3 mm, its cap ending at z 0.4536; barrel axis at y 0.0838, radius 9.2 mm
function tubeExtension() {
  const ty = 0.0551, by = 0.0838, tx = -0.0005, z1 = 0.4868;
  const tube = turned([[0, 0.434], [0.0151, 0.434], [0.0156, 0.4346], [0.0156, 0.4575], [0.0128, 0.4592], [0.0128, z1 - 0.0085], [0.0137, z1 - 0.0078],
    [0.0137, z1 - 0.0012], [0.0125, z1], [0.006, z1], [0.0052, z1 + 0.0016], [0, z1 + 0.0016]], 40).translate(tx, ty, 0);
  // the clamp: two rings in one plate, round the extension and round the barrel, pinched by a screw
  const bracket = new THREE.Shape();
  bracket.absarc(tx, ty, 0.0168, Math.PI * 0.72, Math.PI * 0.28, false);
  bracket.absarc(0, by, 0.0132, -Math.PI * 0.3, Math.PI * 1.3, false);
  bracket.closePath();
  for (const [x, y, r] of [[tx, ty, 0.0126], [0, by, 0.009]]) { const hole = new THREE.Path(); hole.absarc(x, y, r, 0, Math.PI * 2, true); bracket.holes.push(hole); }
  const clamp = new THREE.ExtrudeGeometry(bracket, { depth: 0.0076, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelOffset: -0.0006, bevelSegments: 1, curveSegments: 18 }).translate(0, 0, 0.4648);
  return [
    part(tube, BLUED),
    part(fluted(0.0161, 0.4375, 0.455, 40, 0.0006), KNURL).translate(tx, ty, 0),
    part(fluted(0.0141, z1 - 0.0068, z1 - 0.0018, 36, 0.0005), KNURL).translate(tx, ty, 0),
    part(clamp, ANODISED),
    part(turnedX(plug(0.0026, -0.0118, 0.0118, 0.0004), 10).translate(0, 0.0705, 0.4692), STEEL)
  ];
}

// The choke: an extended tube standing out of the muzzle, knurled to be turned by hand, notched at the mouth
function choke() {
  const { bore: [x, y, z] } = MOUNTS.shotgun, r = 0.0111, f = z + 0.034;
  const tube = turned([[0, z - 0.004], [0.0104, z - 0.004], [0.0104, z + 0.0006], [r + 0.0008, z + 0.0012], [r + 0.0008, z + 0.0125], [r, z + 0.0135],
    [r, f - 0.0085], [r - 0.0007, f - 0.0078], [r - 0.0007, f - 0.0062], [r, f - 0.0055], [r, f - 0.0008], [r - 0.0008, f],
    [0.009, f], [0.0086, f - 0.0012], [0.0086, f - 0.03], [0, f - 0.03]], 40).translate(x, y, 0);
  const notches = Array.from({ length: 6 }, (_, i) => part(block(-0.0012, r - 0.0016, f - 0.0042, 0.0012, r + 0.0003, f + 0.0002, 0), VOID,
    new THREE.Matrix4().makeRotationZ(i * Math.PI / 3).setPosition(x, y, 0)));
  return [
    part(tube, BLUED),
    part(fluted(r + 0.0013, z + 0.0022, z + 0.0115, 40, 0.0006), KNURL).translate(x, y, 0),
    part(turned(plug(0.0088, f - 0.0305, f - 0.0295, 0), 24).translate(x, y, 0), VOID),
    ...notches
  ];
}

// ---- What goes where ------------------------------------------------------------------------------------------------
// Per weapon and upgrade: the pieces (already in weapon space) and the moving part they ride on. `holster: false`
// marks what cannot stay on the weapon while it is put away (a pistol's holster is cut for the bare slide and barrel).
// The rifle's foregrip is the one its model came with (weapon-models.js carves it out); nothing is machined for it.
const pieces = (list, matrix) => list.map((g) => (matrix ? g.applyMatrix4(matrix) : g));
const muzzleFrame = (kind) => frame(MOUNTS[kind].bore, MOUNTS[kind].pitch, MOUNTS[kind].yaw);
const RECIPES = {
  pistol: {
    suppressor: { build: () => pieces(suppressor(SUPPRESSORS.pistol), muzzleFrame('pistol')), holster: false },
    sight: { build: () => pieces(reflexSight(), frame([0.0012, 0.0714, 0.0285])), on: 'action', holster: false },
    mag: { build: pistolMagazine, on: 'magazine' }
  },
  smg: {
    suppressor: { build: () => pieces(suppressor(SUPPRESSORS.smg), muzzleFrame('smg')) },
    sight: { build: () => pieces(tubeSight(0.0126), frame([0.0018, 0.1428, -0.012], 0.034)) },
    grip: { build: () => pieces(foregrip(0.0126), frame([0.0011, 0.0592, 0.178], 0.033)) },
    mag: { build: smgMagazine, on: 'magazine' }
  },
  shotgun: {
    grip: { build: () => pieces(foregrip(null), frame([0, 0.0188, 0.245])), on: 'action' },
    mag: { build: tubeExtension },
    choke: { build: choke }
  },
  rifle: {
    suppressor: { build: () => pieces(suppressor(SUPPRESSORS.rifle), muzzleFrame('rifle')) },
    sight: { build: () => pieces(scope(0.0093), frame([-0.0006, 0.1051, -0.074], 0.039, -0.007)) },
    mag: { build: rifleMagazine, on: 'magazine' }
  }
};

/**
 * The hardware of one weapon, machined once: { [modId]: { geometry, on, holster } }. `on` names the moving part the
 * piece rides on ('action', 'magazine') when it is not bolted to the body.
 */
function buildAttachments(kind) {
  const out = {};
  for (const [id, recipe] of Object.entries(RECIPES[kind] ?? {})) {
    const geometry = mergeGeometries(recipe.build());
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0.1), 1.2); // as the weapon's own parts
    // a box measured round a dressed weapon (a rest on a counter, a rack) is the bare weapon's: hardware, shown or
    // not, does not move the weapon it is on
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 0.05, 0));
    out[id] = { geometry, on: recipe.on ?? null, holster: recipe.holster !== false };
  }
  return out;
}

// How far the muzzle moves out along the barrel with something screwed on it (weapon space, metres)
function muzzleReach(kind, fitted) {
  const mount = MOUNTS[kind];
  if (!mount) return null;
  let reach = 0;
  if (fitted.includes('suppressor') && SUPPRESSORS[kind]) reach = SUPPRESSORS[kind].length - SUPPRESSORS[kind].back;
  else if (fitted.includes('choke') && kind === 'shotgun') reach = 0.034;
  if (!reach) return null;
  const cp = Math.cos(mount.pitch);
  return [Math.sin(mount.yaw) * cp * reach, Math.sin(mount.pitch) * reach, Math.cos(mount.yaw) * cp * reach];
}

// Where the support hand goes when a foregrip is there to take (or, on the rifle, when its own is not): the changes
// to a HOLD entry of person-motion.js, or null
const GRIPS = {
  smg: { on: { fore: [0.001, 0.004, 0.176], upright: true } },
  shotgun: { on: { fore: [0, -0.034, 0.245], upright: true } },
  // the SENTINEL's factory foregrip is the upgrade: without it the hand takes the handguard from below
  rifle: { off: { fore: [-0.001, 0.052, 0.1], upright: false } }
};
const holds = new Map();
/**
 * The HOLD entry of a weapon as it is dressed: the muzzle further out behind a suppressor or a choke, the support
 * hand on the foregrip. Returns `hold` itself when nothing changes; one object per weapon and set of upgrades.
 */
function dressedHold(kind, hold, fitted) {
  const reach = muzzleReach(kind, fitted), grip = GRIPS[kind]?.[fitted.includes('grip') ? 'on' : 'off'];
  if (!reach && !grip) return hold;
  const key = `${kind}|${fitted.join('+')}`;
  let dressed = holds.get(key);
  if (!dressed || dressed.stock !== hold) {
    dressed = { ...hold, ...grip, stock: hold };
    if (reach) dressed.muzzle = hold.muzzle.map((v, i) => v + reach[i]);
    holds.set(key, dressed);
  }
  return dressed;
}

export { buildAttachments, dressedHold, muzzleReach, MOUNTS, SUPPRESSORS };
