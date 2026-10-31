// Signed distance primitives for sculpting people. Distances in metres, +inside is negative.

export const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
export const smax = (a, b, k) => -smin(-a, -b, k);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const sstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// A sphere swept from a (radius r1) to b (radius r2)
export function cone(x, y, z, ax, ay, az, bx, by, bz, r1, r2) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = x - ax, pay = y - ay, paz = z - az;
  const yy = pax * bax + pay * bay + paz * baz;
  const zz = yy - l2;
  const cx = pax * l2 - bax * yy, cy = pay * l2 - bay * yy, cz = paz * l2 - baz * yy;
  const x2 = cx * cx + cy * cy + cz * cz;
  const y2 = yy * yy * l2;
  const z2 = zz * zz * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
}

export const capsule = (x, y, z, ax, ay, az, bx, by, bz, r) => cone(x, y, z, ax, ay, az, bx, by, bz, r, r);

// Good near the surface, which is the only place the mesher looks
export function ellipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {
  const px = x - cx, py = y - cy, pz = z - cz;
  const k0 = Math.hypot(px / rx, py / ry, pz / rz);
  const k1 = Math.hypot(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : k0 * (k0 - 1) / k1;
}

export function roundBox(x, y, z, cx, cy, cz, hx, hy, hz, r) {
  const qx = Math.abs(x - cx) - hx + r, qy = Math.abs(y - cy) - hy + r, qz = Math.abs(z - cz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

export function torusXZ(x, y, z, cx, cy, cz, R, r) {
  const px = x - cx, py = y - cy, pz = z - cz;
  return Math.hypot(Math.hypot(px, pz) - R, py) - r;
}

// Smooth value noise, for folds and hair clumps
const lattice = (i, j, k) => {
  const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
export function noise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const u = x - i, v = y - j, w = z - k;
  const a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v), c = w * w * (3 - 2 * w);
  const mix = (p, q, t) => p + (q - p) * t;
  return mix(
    mix(mix(lattice(i, j, k), lattice(i + 1, j, k), a), mix(lattice(i, j + 1, k), lattice(i + 1, j + 1, k), a), b),
    mix(mix(lattice(i, j, k + 1), lattice(i + 1, j, k + 1), a), mix(lattice(i, j + 1, k + 1), lattice(i + 1, j + 1, k + 1), a), b),
    c) * 2 - 1;
}
