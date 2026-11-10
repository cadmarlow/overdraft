// An original single-cab pickup derivative of the licensed Defender source. Run on primitiveData world coordinates,
// before atlas baking, grounding and createCarFit; the existing chassis and four running wheels retain their anchors.
// Coordinates below come from the source's front-door trailing edge (-6.04) and front-seat back (-6.7), not its filename.
export const DEFENDER_PICKUP_LAYOUT = Object.freeze({
  centerX: -0.3158, cabinBackZ: -6.9, tailZ: -23.38, floorY: 2.15, railY: 6.15,
  halfWidth: 7.1, innerHalfWidth: 6.4, roofY: 12.075, rearAxleZ: -15.65, wheelhouseRadius: 4.35,
  wheelhouseInnerX: 4.65, wheelhouseCenterY: -0.12
});

const unit = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const minus = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function bounds(data) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const i of data.index) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], data.pos[i * 3 + c]); hi[c] = Math.max(hi[c], data.pos[i * 3 + c]); }
  return { lo, hi };
}

function clipBody(data, L) {
  const b = bounds(data), left = L.centerX - L.innerHalfWidth, right = L.centerX + L.innerHalfWidth;
  if (b.lo[2] >= L.cabinBackZ || b.hi[1] <= L.floorY) return data;
  if (b.hi[2] <= L.cabinBackZ && (b.lo[1] > L.railY || (b.lo[0] > left && b.hi[0] < right && b.lo[1] > L.floorY))) return null;
  const positions = [], normals = [], uvs = [], indices = [], emitted = new Map();
  const vertex = (i) => ({ p: Array.from(data.pos.slice(i * 3, i * 3 + 3)), n: Array.from(data.nor.slice(i * 3, i * 3 + 3)),
    uv: Array.from(data.uv?.slice(i * 2, i * 2 + 2) ?? [0, 0]), key: String(i) });
  function split(poly, axis, value, name) {
    const distances = poly.map((v) => v.p[axis] - value), positive = [], negative = [];
    if (distances.every((d) => Math.abs(d) < 1e-9)) return [poly, []];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], next = (i + 1) % poly.length, b = poly[next], da = distances[i], db = distances[next];
      if (da >= 0) positive.push(a);
      if (da <= 0) negative.push(a);
      if (da * db < 0) {
        const t = da / (da - db), mix = (x, y) => x.map((v, j) => v + (y[j] - v) * t);
        const v = { p: mix(a.p, b.p), n: mix(a.n, b.n), uv: mix(a.uv, b.uv), key: `${name}(${[a.key, b.key].sort().join(':')})` };
        v.p[axis] = value; positive.push(v); negative.push(v);
      }
    }
    return [positive, negative];
  }
  function emit(poly) {
    for (let i = 1; i < poly.length - 1; i++) {
      const tri = [poly[0], poly[i], poly[i + 1]];
      if (Math.hypot(...cross(minus(tri[1].p, tri[0].p), minus(tri[2].p, tri[0].p))) < 1e-10) continue;
      for (const v of tri) {
        if (!emitted.has(v.key)) {
          emitted.set(v.key, positions.length / 3); positions.push(...v.p); normals.push(...unit(v.n)); uvs.push(...v.uv);
        }
        indices.push(emitted.get(v.key));
      }
    }
  }
  for (let i = 0; i < data.index.length; i += 3) {
    const poly = [vertex(data.index[i]), vertex(data.index[i + 1]), vertex(data.index[i + 2])];
    const [front, rear] = split(poly, 2, L.cabinBackZ, 'cab'); emit(front);
    if (!rear.length) continue;
    const [, belowRail] = split(rear, 1, L.railY, 'rail');
    if (!belowRail.length) continue;
    const [insideLeft, outerLeft] = split(belowRail, 0, left, 'left'); emit(outerLeft);
    const [outerRight, centre] = split(insideLeft, 0, right, 'right'); emit(outerRight);
    const [, underFloor] = split(centre, 1, L.floorY, 'floor'); emit(underFloor);
  }
  if (!indices.length) return null;
  return { ...data, pos: Float64Array.from(positions), nor: Float64Array.from(normals), uv: Float64Array.from(uvs), index: Uint32Array.from(indices) };
}

function mesh() {
  const pos = [], nor = [], uv = [], index = [];
  function triangle(a, b, c, normals) {
    const face = cross(minus(b, a), minus(c, a));
    // The wheel-tub side closes onto the floor: at each arc endpoint one half of its quad has coincident vertices.
    // Omit that zero-area triangle before emitting attributes; it has no surface normal for the fitting Jacobian.
    if (Math.hypot(...face) < 1e-10) return;
    const n = unit(face), start = pos.length / 3;
    [a, b, c].forEach((p, i) => { pos.push(...p); nor.push(...(normals?.[i] ?? n)); uv.push(0.5, 0.5); });
    index.push(start, start + 1, start + 2);
  }
  const quad = (a, b, c, d, normals) => {
    triangle(a, b, c, normals?.slice(0, 3)); triangle(a, c, d, normals ? [normals[0], normals[2], normals[3]] : null);
  };
  function extrudeXY(profile, z0, z1) {
    const centre = profile.reduce((a, p) => [a[0] + p[0] / profile.length, a[1] + p[1] / profile.length], [0, 0]);
    for (let i = 0; i < profile.length; i++) {
      const a = profile[i], b = profile[(i + 1) % profile.length];
      triangle([...centre, z0], [...b, z0], [...a, z0]);
      triangle([...centre, z1], [...a, z1], [...b, z1]);
      quad([...a, z0], [...b, z0], [...b, z1], [...a, z1]);
    }
  }
  function box(x0, y0, z0, x1, y1, z1, bevel = 0) {
    const r = Math.min(bevel, (x1 - x0) * 0.45, (y1 - y0) * 0.45);
    extrudeXY(r > 0 ? [[x0 + r, y0], [x1 - r, y0], [x1, y0 + r], [x1, y1 - r], [x1 - r, y1], [x0 + r, y1], [x0, y1 - r], [x0, y0 + r]]
      : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1);
  }
  function tube(a, b, radius, segments = 12) {
    const axis = unit(minus(b, a)), u = unit(cross(axis, Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross(axis, u);
    const normal = (i) => u.map((x, j) => x * Math.cos(i * 2 * Math.PI / segments) + v[j] * Math.sin(i * 2 * Math.PI / segments));
    const point = (p, n) => p.map((x, j) => x + n[j] * radius);
    for (let i = 0; i < segments; i++) {
      const n0 = normal(i), n1 = normal(i + 1), a0 = point(a, n0), a1 = point(a, n1), b0 = point(b, n0), b1 = point(b, n1);
      quad(a0, a1, b1, b0, [n0, n1, n1, n0]); triangle(a, a1, a0); triangle(b, b0, b1);
    }
  }
  return { triangle, quad, extrudeXY, box, tube, data: () => ({ pos: Float64Array.from(pos), nor: Float64Array.from(nor), uv: Float64Array.from(uv), index: Uint32Array.from(index), hasNormals: true, flipped: false }) };
}

function part(name, geometry, color, roughness, metalness = 0, options = {}) {
  const material = { name, pbrMetallicRoughness: { baseColorFactor: [...color, options.glass ? 0.38 : 1], roughnessFactor: roughness, metallicFactor: metalness },
    ...(options.glass ? { alphaMode: 'BLEND', doubleSided: true } : {}) };
  const item = { node: name, mesh: name, path: `OriginalPickup/${name}`, material };
  return { item, name, label: item.path, data: geometry.data(), material, paint: !!options.paint, glass: !!options.glass,
    wheelLike: false, wheel: false, caliper: false, steering: false, generated: true };
}

export function convertDefenderPickup(parts, options = {}) {
  const L = { ...DEFENDER_PICKUP_LAYOUT, ...options };
  if (!(L.tailZ < L.cabinBackZ && L.floorY < L.railY && L.railY < L.roofY && L.innerHalfWidth < L.halfWidth)) throw new Error('Invalid pickup conversion dimensions');
  const retained = [];
  for (const p of parts) {
    const label = `${p.label ?? ''} ${p.item?.path ?? ''}`, b = bounds(p.data);
    // The source also contains an unrelated covered object. Roof baskets and the hanging spare belong to the SUV.
    if (p.item?.node === 'Object_669' || /roofbar/i.test(label)) continue;
    if (b.hi[2] < L.tailZ && b.lo[1] > 1 && Math.abs((b.lo[0] + b.hi[0]) / 2 - L.centerX) < 4) continue;
    if (/back(?:left|right).*(?:light|handle)|trailerlight/i.test(label)) continue;
    if (p.wheelLike || p.wheel || p.caliper) { retained.push(p); continue; }
    const data = clipBody(p.data, L);
    if (data) retained.push(data === p.data ? p : { ...p, data });
  }
  const paint = mesh(), liner = mesh(), metal = mesh(), glass = mesh(), brake = mesh(), reverse = mesh();
  const cx = L.centerX, z0 = L.tailZ, z1 = L.cabinBackZ - 0.24, y = L.floorY, rail = L.railY;
  const wall = L.halfWidth, inner = L.innerHalfWidth, well = L.wheelhouseInnerX;
  const wheelAngle = Math.asin((y - L.wheelhouseCenterY) / L.wheelhouseRadius), wheelReach = Math.cos(wheelAngle) * L.wheelhouseRadius;
  const wellRear = L.rearAxleZ - wheelReach, wellFront = L.rearAxleZ + wheelReach;
  // Continuous structural floor between the wheel tubs, with separate side pockets clear of the tyres.
  liner.box(cx - well, y - 0.18, z0 + 0.28, cx + well, y, z1);
  for (const side of [-1, 1]) {
    const x0 = cx + (side < 0 ? -inner : well), x1 = cx + (side < 0 ? -well : inner);
    for (const [a, b] of [[z0 + 0.28, wellRear], [wellFront, z1]]) if (b > a) liner.box(x0, y - 0.18, a, x1, y, b);
    // The shell keeps its real outer wheel openings; the new side wall begins above the wheel crown.
    const sx = cx + side * (wall - 0.15);
    paint.box(sx - 0.16, L.wheelhouseCenterY + L.wheelhouseRadius, z0, sx + 0.16, rail, z1, 0.08);
    liner.box(cx + side * inner - 0.08, L.wheelhouseCenterY + L.wheelhouseRadius, z0 + 0.25,
      cx + side * inner + 0.08, rail - 0.1, z1);
    for (const [a, b] of [[z0 + 0.25, wellRear], [wellFront, z1]]) if (b > a) liner.box(cx + side * inner - 0.08, y, a, cx + side * inner + 0.08, rail - 0.1, b);
    paint.tube([sx, rail, z0], [sx, rail, z1], 0.17, 16);
    const xa = cx + (side < 0 ? -inner : well), xb = cx + (side < 0 ? -well : inner);
    for (let i = 0; i < 18; i++) {
      const a = wheelAngle + (Math.PI - 2 * wheelAngle) * i / 18, b = wheelAngle + (Math.PI - 2 * wheelAngle) * (i + 1) / 18;
      const point = (x, t) => [x, L.wheelhouseCenterY + Math.sin(t) * L.wheelhouseRadius, L.rearAxleZ + Math.cos(t) * L.wheelhouseRadius];
      const normal = (t) => [0, Math.sin(t), Math.cos(t)];
      liner.quad(point(xa, a), point(xb, a), point(xb, b), point(xa, b), [normal(a), normal(a), normal(b), normal(b)]);
      liner.quad([xa, y, point(xa, a)[2]], [xa, y, point(xa, b)[2]], point(xa, b), point(xa, a));
      liner.quad([xb, y, point(xb, a)[2]], point(xb, a), point(xb, b), [xb, y, point(xb, b)[2]]);
    }
    // Four recessed lashing eyes read as functional hardware without adding meshes or materials.
    for (const z of [z0 + 1.15, z1 - 1.2]) metal.tube([cx + side * (inner - 0.12), rail - 0.8, z - 0.2], [cx + side * (inner - 0.12), rail - 0.8, z + 0.2], 0.085, 8);
  }
  for (let x = -well + 0.45; x < well - 0.2; x += 0.62) {
    liner.extrudeXY([[cx + x - 0.17, y], [cx + x + 0.17, y], [cx + x + 0.1, y + 0.085], [cx + x - 0.1, y + 0.085]], z0 + 0.4, z1 - 0.2);
  }
  // Back of cab: a framed aperture, not an opaque plate pasted over a window.
  const cab = L.cabinBackZ, windowLow = rail + 0.85, windowHigh = L.roofY - 1.65, windowHalf = inner * 0.7;
  paint.box(cx - wall, y, cab - 0.12, cx + wall, windowLow, cab + 0.12, 0.12);
  paint.extrudeXY([[cx - inner, L.roofY], [cx - wall + 0.25, windowHigh], [cx + wall - 0.25, windowHigh], [cx + inner, L.roofY]], cab - 0.12, cab + 0.12);
  for (const side of [-1, 1]) {
    const a = cx + side * windowHalf, b = cx + side * (wall - 0.2);
    paint.box(Math.min(a, b), windowLow, cab - 0.12, Math.max(a, b), windowHigh, cab + 0.12);
  }
  const xl = cx - windowHalf, xr = cx + windowHalf;
  for (const [a, b] of [[[xl, windowLow], [xr, windowLow]], [[xl, windowHigh], [xr, windowHigh]], [[xl, windowLow], [xl, windowHigh]], [[xr, windowLow], [xr, windowHigh]]]) {
    liner.tube([...a, cab - 0.16], [...b, cab - 0.16], 0.1, 12);
  }
  glass.quad([xl, windowLow, cab - 0.02], [xl, windowHigh, cab - 0.02], [xr, windowHigh, cab - 0.02], [xr, windowLow, cab - 0.02]);
  liner.box(cx - inner, y, z1 - 0.14, cx + inner, rail - 0.08, z1);
  // Closed tailgate, rolled upper hem, stamped strengthening ribs, hinges and an inset latch.
  paint.box(cx - inner, y - 0.05, z0 - 0.28, cx + inner, rail - 0.1, z0, 0.16);
  paint.tube([cx - inner, rail - 0.05, z0 - 0.13], [cx + inner, rail - 0.05, z0 - 0.13], 0.16, 16);
  for (const x of [-3.7, 3.7]) metal.box(cx + x - 0.42, y - 0.12, z0 - 0.35, cx + x + 0.42, y + 0.18, z0 - 0.24, 0.08);
  for (const x of [-3.4, 0, 3.4]) paint.box(cx + x - 0.1, y + 0.5, z0 - 0.31, cx + x + 0.1, rail - 0.9, z0 - 0.26, 0.05);
  liner.box(cx - 0.86, rail - 0.98, z0 - 0.36, cx + 0.86, rail - 0.43, z0 - 0.26, 0.12);
  metal.box(cx - 0.61, rail - 0.81, z0 - 0.46, cx + 0.61, rail - 0.57, z0 - 0.34, 0.08);
  for (const side of [-1, 1]) {
    const x = cx + side * (wall - 0.55);
    liner.box(x - 0.38, y + 0.45, z0 - 0.39, x + 0.38, rail - 0.3, z0 - 0.15, 0.12);
    brake.box(x - 0.26, y + 1.35, z0 - 0.44, x + 0.26, rail - 0.48, z0 - 0.39, 0.08);
    reverse.box(x - 0.26, y + 0.64, z0 - 0.44, x + 0.26, y + 1.13, z0 - 0.39, 0.06);
  }
  const generated = [
    part('PickupPaint', paint, [0.24, 0.28, 0.23], 0.28, 0.15, { paint: true }),
    part('PickupBedLiner', liner, [0.025, 0.03, 0.032], 0.79),
    part('PickupHardware', metal, [0.19, 0.21, 0.22], 0.3, 0.8),
    part('PickupRearGlass', glass, [0.18, 0.23, 0.24], 0.09, 0.1, { glass: true }),
    part('PickupBrakeLight', brake, [0.55, 0.014, 0.009], 0.2),
    part('PickupReverseLight', reverse, [0.7, 0.74, 0.72], 0.18)
  ];
  return retained.concat(generated);
}
