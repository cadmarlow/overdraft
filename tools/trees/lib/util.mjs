// Small shared helpers of the tree tools: seeded random numbers, 3D vectors as plain arrays, value noise.

export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.pick = (list) => list[Math.floor(next() * list.length)];
  // roughly normal, -1 .. 1
  next.bell = () => (next() + next() + next()) * (2 / 3) - 1;
  return next;
}

export const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  mad: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
  },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  // any unit vector at right angles to a
  perp: (a) => V.norm(Math.abs(a[1]) < 0.9 ? V.cross(a, [0, 1, 0]) : V.cross(a, [1, 0, 0])),
  // a turned by `angle` round the unit axis
  rotate: (a, axis, angle) => {
    const c = Math.cos(angle), s = Math.sin(angle), d = V.dot(a, axis), x = V.cross(axis, a);
    return [a[0] * c + x[0] * s + axis[0] * d * (1 - c), a[1] * c + x[1] * s + axis[1] * d * (1 - c), a[2] * c + x[2] * s + axis[2] * d * (1 - c)];
  },
  // unit vector `angle` off the unit vector dir, at `azimuth` round it
  deflect: (dir, angle, azimuth) => {
    const u = V.perp(dir), w = V.cross(dir, u);
    const s = Math.sin(angle);
    return V.norm([
      dir[0] * Math.cos(angle) + (u[0] * Math.cos(azimuth) + w[0] * Math.sin(azimuth)) * s,
      dir[1] * Math.cos(angle) + (u[1] * Math.cos(azimuth) + w[1] * Math.sin(azimuth)) * s,
      dir[2] * Math.cos(angle) + (u[2] * Math.cos(azimuth) + w[2] * Math.sin(azimuth)) * s
    ]);
  }
};

// Smooth 1D value noise, -1 .. 1, for wander that reads as growth and not as jitter
export function noise1(seed) {
  const r = rng(seed);
  const table = Array.from({ length: 64 }, () => r() * 2 - 1);
  return (x) => {
    const i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f);
    const a = table[((i % 64) + 64) % 64], b = table[(((i + 1) % 64) + 64) % 64];
    return a + (b - a) * t;
  };
}

export function hash01(a, b = 0) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
