// Procedural sprite atlas of the gunfire effects, painted once at boot: nothing is downloaded.
// One RGBA image carries three independent 4x4 atlases, so every effect pool samples the same texture:
//   R    glow shapes (muzzle flashes seen from the front and from the side, spark bursts, glints) as heat
//   G    smoke, dust and fragment shapes as density (fragments are coverage fields: 0.5 is the edge)
//   B/A  decals: B is brightness under the instance tint, A a coverage field (0.5 is the edge)
// Every tile falls to zero before its border, so neighbours never bleed through filtering or mipmaps.
// Pure data, no three.js: the unit tests and the offline previews run it in Node.

const GRID = 4;
const TAU = Math.PI * 2;

const GLOW = { star3: 0, star4: 1, star5: 2, starWild: 3, ballA: 4, ballB: 5, ballBig: 6, sparkBurst: 7,
  coneNarrowA: 8, coneNarrowB: 9, coneFatA: 10, coneFatB: 11, jet: 12, glint: 13, haze: 14, coneShort: 15 };
const SMOKE = { puffA: 0, puffB: 1, puffC: 2, puffD: 3, wispA: 4, wispB: 5, burst: 6, column: 7,
  chipA: 8, chipB: 9, chipC: 10, shard: 11, droplet: 12, splinter: 13, clod: 14, soft: 15 };
const DECAL = { concreteA: 0, concreteB: 1, concreteC: 2, gouge: 3, metalA: 4, metalB: 5, glassA: 6, glassB: 7,
  bloodPoolA: 8, bloodPoolB: 9, bloodPoolC: 10, bloodDropsA: 11, bloodDropsB: 12, wood: 13, scorch: 14, bloodSpray: 15 };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// Value noise on a fixed random lattice
const LATTICE = new Float32Array(65536);
{ const r = rng(0x0f3c51); for (let i = 0; i < 65536; i++) LATTICE[i] = r(); }
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = xi & 255, x1 = (xi + 1) & 255, y0 = (yi & 255) << 8, y1 = ((yi + 1) & 255) << 8;
  const a = LATTICE[y0 | x0], b = LATTICE[y0 | x1], c = LATTICE[y1 | x0], d = LATTICE[y1 | x1];
  return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
}
function fbm(x, y, octaves = 4) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < octaves; i++) { sum += noise(x, y) * amp; norm += amp; x = x * 2.03 + 17.1; y = y * 2.03 + 9.7; amp *= 0.5; }
  return sum / norm;
}
// Noise round a circle: periodic in the angle
const ring = (a, freq, ox, oy, octaves = 3) => fbm(Math.cos(a) * freq + ox, Math.sin(a) * freq + oy, octaves);
// Distance from (x, y) to the segment a-b
function segment(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = sat(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
}

// ---- Glow shapes (heat, 0..1) --------------------------------------------------------------------------------------
// A flame tongue along +x from the origin: narrow at the slot, swelling, then a point
function tongue(along, across, len, width, ox, oy) {
  if (along <= 0 || along >= len) return 0;
  const t = along / len;
  const w = width * Math.sqrt(t) * Math.pow(1 - t, 0.8) / 0.42 + 0.004;
  const q = across / w;
  if (q * q > 5) return 0;
  // fibres along the flame: the noise is only asked for inside it
  return Math.exp(-q * q * 1.5) * Math.pow(1 - t, 0.55) * (0.45 + 1.1 * fbm(along * 7 + ox, across * 34 + oy, 3));
}

// The flash of a slotted flash hider seen down the barrel: one tongue per slot round a white core
function starFlash(lobes, seed, spread = 0.3) {
  const r = rng(seed);
  const phase = r() * TAU, ox = r() * 60, oy = r() * 60;
  const petals = [];
  for (let i = 0; i < lobes; i++) {
    const a = phase + (i + (r() - 0.5) * spread) * TAU / lobes;
    petals.push({ c: Math.cos(a), s: Math.sin(a), len: 0.6 + r() * 0.32, w: 0.1 + r() * 0.06, gain: 0.5 + r() * 0.22 });
  }
  // short secondary licks between the slots
  for (let i = 0; i < lobes; i++) {
    const a = phase + (i + 0.5 + (r() - 0.5) * 0.5) * TAU / lobes;
    petals.push({ c: Math.cos(a), s: Math.sin(a), len: 0.2 + r() * 0.2, w: 0.07 + r() * 0.04, gain: 0.34 + r() * 0.2 });
  }
  return (u, v) => {
    const wu = u + (fbm(u * 2.6 + ox, v * 2.6 + oy) - 0.5) * 0.2;
    const wv = v + (fbm(u * 2.6 + oy + 9, v * 2.6 + ox + 4) - 0.5) * 0.2;
    const rr2 = wu * wu + wv * wv;
    let heat = Math.exp(-rr2 / 0.009) * 1.2 + Math.exp(-rr2 / 0.06) * 0.3;
    for (const p of petals) {
      const along = wu * p.c + wv * p.s, across = wv * p.c - wu * p.s;
      if (along <= 0) continue;
      heat += tongue(along, across, p.len, p.w, ox, oy) * p.gain;
    }
    return heat;
  };
}

// A ragged ball of burning gas with a few random spikes: pistols, SMGs, and at scale a shotgun
function ballFlash(seed, radius, spikes, ragged = 0.5) {
  const r = rng(seed);
  const ox = r() * 60, oy = r() * 60;
  const rays = [];
  for (let i = 0; i < spikes; i++) {
    const a = r() * TAU;
    rays.push({ c: Math.cos(a), s: Math.sin(a), len: radius * (0.9 + r() * 0.75), w: 0.05 + r() * 0.05, gain: 0.3 + r() * 0.32 });
  }
  return (u, v) => {
    const wu = u + (fbm(u * 3.1 + ox, v * 3.1 + oy) - 0.5) * 0.22;
    const wv = v + (fbm(u * 3.1 + oy + 5, v * 3.1 + ox + 8) - 0.5) * 0.22;
    const rr = Math.hypot(wu, wv), a = Math.atan2(wv, wu);
    const edge = radius * (1 - ragged * 0.5 + ragged * ring(a, 1.7, ox, oy));
    let heat = Math.pow(smooth(1, 0.1, rr / edge), 1.25) * (0.22 + 0.62 * fbm(u * 5 + ox, v * 5 + oy, 3));
    heat += Math.exp(-rr * rr / (radius * radius * 0.07)) * 1.1;
    if (rr < radius * 1.75) for (const p of rays) {
      const along = wu * p.c + wv * p.s, across = wv * p.c - wu * p.s;
      heat += tongue(along, across, p.len, p.w, oy, ox) * p.gain;
    }
    return heat;
  };
}

// The same flash seen from the side: a flame leaving the muzzle (left edge of the tile) along +u
function coneFlash(seed, width, length, ragged, blunt = 0.75) {
  const r = rng(seed);
  const ox = r() * 60, oy = r() * 60, swell = 0.16 + r() * 0.1;
  return (u, v) => {
    const t0 = (u + 0.9) / 1.8;
    if (t0 <= 0) return 0;
    const t = t0 / length;
    const y = v + (fbm(u * 3.2 + ox, v * 3.2 + oy) - 0.5) * ragged * (0.25 + t);
    const tt = t + (fbm(u * 2.2 + oy, v * 6 + ox, 3) - 0.5) * ragged * 0.6;
    if (tt >= 1) return 0;
    const w = (tt < swell ? width * Math.pow(tt / swell, 0.55) : width * Math.pow(1 - (tt - swell) / (1 - swell), blunt)) + 0.004;
    const q = y / w;
    const fibre = 0.55 + 0.9 * fbm(t0 * 5 + ox, y * 26 + oy, 3);
    const body = Math.exp(-q * q * 2.1) * Math.pow(1 - tt, 0.45) * fibre * 0.46;
    const core = Math.exp(-q * q * 16) * Math.pow(1 - tt, 1.5) * 0.85;
    const bulb = Math.exp(-((t0 - 0.05) * (t0 - 0.05) * 3.2 + v * v) / 0.004) * 1.1;
    return body + core + bulb;
  };
}

function sparkBurst(seed, count) {
  const r = rng(seed);
  const rays = [];
  for (let i = 0; i < count; i++) { const a = r() * TAU; rays.push({ c: Math.cos(a), s: Math.sin(a), len: 0.3 + r() * 0.62, w: 0.012 + r() * 0.014, gain: 0.5 + r() * 0.5 }); }
  return (u, v) => {
    let heat = Math.exp(-(u * u + v * v) / 0.012) * 1.3;
    if (u * u + v * v < 0.88) for (const p of rays) {
      const along = u * p.c + v * p.s, across = v * p.c - u * p.s;
      if (along <= 0 || along >= p.len) continue;
      const q = across / (p.w * (1 - along / p.len * 0.7));
      heat += Math.exp(-q * q) * Math.pow(1 - along / p.len, 1.1) * p.gain;
    }
    return heat;
  };
}

const glint = (u, v) => {
  const au = Math.abs(u), av = Math.abs(v);
  return Math.max(Math.exp(-au * 5.5 - av * 46), Math.exp(-av * 5.5 - au * 46)) * 0.9 + Math.exp(-(u * u + v * v) / 0.008);
};

function haze(seed) {
  const r = rng(seed), ox = r() * 60, oy = r() * 60;
  return (u, v) => Math.exp(-(u * u + v * v) / 0.11) * (0.55 + 0.9 * fbm(u * 2.4 + ox, v * 2.4 + oy));
}

// ---- Smoke and fragment shapes (density or coverage, 0..1) --------------------------------------------------------
function puff(seed, erosion = 0.55) {
  const r = rng(seed), ox = r() * 60, oy = r() * 60;
  return (u, v) => {
    // kept well inside the tile: a puff that reached the border would show the square it is drawn on
    const wu = u + (fbm(u * 1.7 + ox, v * 1.7 + oy) - 0.5) * 0.4;
    const wv = v + (fbm(u * 1.7 + oy + 3, v * 1.7 + ox + 7) - 0.5) * 0.4;
    const base = smooth(0.7, 0.04, Math.hypot(wu, wv)) * smooth(0.84, 0.6, Math.max(Math.abs(u), Math.abs(v)));
    const n = fbm(u * 2.6 + ox, v * 2.6 + oy, 5);
    return Math.pow(sat((base - (1 - n) * erosion) * 2.1), 0.85);
  };
}

// Thin strands curling out of a barrel: the ridges of a warped noise field under a soft envelope
function wisp(seed) {
  const r = rng(seed), ox = r() * 60, oy = r() * 60;
  return (u, v) => {
    const wu = u + (fbm(u * 1.4 + ox, v * 1.4 + oy) - 0.5) * 0.7;
    const wv = v + (fbm(u * 1.4 + oy + 3, v * 1.4 + ox + 7) - 0.5) * 0.7;
    const n = fbm(wu * 1.5 + ox, wv * 3.4 + oy, 4);
    const strand = smooth(0.7, 0.99, 1 - Math.abs(2 * n - 1));
    const envelope = smooth(0.8, 0.1, Math.hypot(u * 0.9, v * 1.15));
    return envelope * (strand * 0.85 + 0.2 * fbm(u * 3 + oy, v * 3 + ox));
  };
}

// A jet thrown from the bottom of the tile and fanning upward: dust off a wall, water off the river
function burst(seed, spread, streaks) {
  const r = rng(seed), ox = r() * 60, oy = r() * 60;
  return (u, v) => {
    // its foot sits at v = -0.8, inside the part of the tile the border fade leaves whole
    const qx = u, qy = v + 0.8;
    const dist = Math.hypot(qx, qy), ang = Math.atan2(qx, qy);
    const n = fbm(ang * streaks + ox, dist * 1.6 + oy, 4);
    const reach = 1 + n * 0.72;
    const fan = Math.exp(-(ang * ang) / (spread * spread));
    const body = fan * smooth(reach, reach * 0.2, dist) * smooth(0, 0.1, dist);
    const billow = fbm(u * 3 + oy, v * 3 + ox, 4);
    return Math.pow(sat((body * (0.45 + 1.1 * n) - (1 - billow) * 0.24) * 1.3), 1.25);
  };
}

// Fragments are star-shaped polygons stored as a coverage field
function fragment(seed, sides, rMin, rMax, stretch = 1) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (i + r() * 0.7) / sides * TAU, rad = rMin + r() * (rMax - rMin);
    pts.push([Math.cos(a) * rad * stretch, Math.sin(a) * rad / stretch, a]);
  }
  return (u, v) => {
    let d = 1e9;
    for (let i = 0; i < sides; i++) {
      const p = pts[i], q = pts[(i + 1) % sides];
      const ex = q[0] - p[0], ey = q[1] - p[1];
      d = Math.min(d, (ex * (v - p[1]) - ey * (u - p[0])) / Math.hypot(ex, ey));
    }
    return sat(0.5 + d * 7);
  };
}
const droplet = (u, v) => sat(0.5 + (0.55 - Math.hypot(u, v)) * 6);
const splinter = (u, v) => sat(0.5 + (0.1 * (1 - Math.pow(Math.abs(u) / 0.88, 2.2)) - Math.abs(v + u * u * 0.05)) * 14);
function clod(seed) {
  const r = rng(seed), ox = r() * 60, oy = r() * 60;
  return (u, v) => sat(0.5 + (0.6 * (0.7 + 0.6 * ring(Math.atan2(v, u), 1.9, ox, oy)) - Math.hypot(u, v)) * 6);
}
const soft = (u, v) => Math.pow(smooth(1, 0, Math.hypot(u, v)), 1.6);

// ---- Decals (brightness, coverage) ---------------------------------------------------------------------------------
// A bullet in masonry: a dark crater, the paler ring where the face spalled off in flakes, hairline cracks
function concreteHole(seed, size = 1) {
  const r = rng(seed), ox = r() * 60, oy = r() * 60;
  const cracks = [];
  for (let i = 0, n = 3 + Math.floor(r() * 3); i < n; i++) {
    const ca = r() * TAU, len = 0.16 + r() * 0.28, bend = (r() - 0.5) * 0.9, start = 0.3 * size;
    const c = Math.cos(ca), s = Math.sin(ca), mx = c * (start + len * 0.55), my = s * (start + len * 0.55);
    cracks.push([c * start, s * start, mx, my, mx + Math.cos(ca + bend) * len * 0.45, my + Math.sin(ca + bend) * len * 0.45]);
  }
  return (u, v, out) => {
    const rr = Math.hypot(u, v), a = Math.atan2(v, u);
    const low = ring(a, 1.5, ox, oy), high = ring(a, 4.2, oy, ox);
    const crater = 0.15 * size * (0.78 + 0.45 * high);
    const spall = (0.3 + 0.36 * low + 0.14 * (high - 0.5)) * size;
    const flake = fbm(u * 7 + ox, v * 7 + oy, 3);
    let cover = sat(0.5 + (spall - rr + (flake - 0.5) * 0.16) * 5.5);
    const slope = smooth(crater, spall, rr);
    let bright = mix(0.52, 1, slope) * (0.74 + 0.3 * fbm(u * 11 + oy, v * 11 + ox, 3));
    // flakes leave steps: a darker line where one broke above the other
    bright *= 0.82 + 0.18 * smooth(0.02, 0.09, Math.abs(flake - 0.5));
    const inside = smooth(crater * 1.2, crater * 0.75, rr);
    // light from the upper left: the crater's far wall catches it, the near wall is in shadow
    const relief = rr > 1e-4 ? (u * 0.55 - v * 0.83) / rr : 0;
    const pit = 0.07 + 0.1 * fbm(u * 14 + ox, v * 14 + oy, 2) + relief * 0.09 * smooth(0, crater, rr);
    bright = mix(bright, pit, inside);
    bright += relief * 0.16 * smooth(crater * 2.2, crater * 1.1, rr) * (1 - inside);
    for (const [ax, ay, mx, my, bx, by] of cracks) {
      const d = Math.min(segment(u, v, ax, ay, mx, my), segment(u, v, mx, my, bx, by));
      if (d > 0.022) continue;
      const line = 1 - d / 0.022;
      cover = Math.max(cover, line * 0.8);
      bright = mix(bright, 0.16, sat(line * 1.6) * (1 - inside) * smooth(spall * 0.6, spall, rr));
    }
    out[0] = bright; out[1] = cover;
  };
}

// A shallow gouge in asphalt, earth or timber: no pale ring, a torn dark patch with lighter grit
function gouge(seed) {
  const r = rng(seed), ox = r() * 60, oy = r() * 60;
  return (u, v, out) => {
    const rr = Math.hypot(u, v), a = Math.atan2(v, u);
    const edge = 0.3 + 0.34 * ring(a, 1.8, ox, oy) + 0.1 * (ring(a, 5, oy, ox) - 0.5);
    const grit = fbm(u * 13 + ox, v * 13 + oy, 3);
    out[1] = sat(0.5 + (edge - rr + (grit - 0.5) * 0.2) * 5);
    const pit = smooth(0.2, 0.06, rr);
    out[0] = mix(0.5 + 0.5 * smooth(0.45, 0.75, grit), 0.1 + 0.12 * grit, pit) * (0.8 + 0.2 * smooth(0, edge, rr));
  };
}

// Sheet metal: a clean punched hole, the bright lip pushed in round it, paint flaked off further out
function metalHole(seed) {
  const r = rng(seed), ox = r() * 60, oy = r() * 60;
  return (u, v, out) => {
    const rr = Math.hypot(u, v), a = Math.atan2(v, u);
    const hole = 0.12 * (0.94 + 0.12 * ring(a, 2.4, ox, oy));
    const lip = hole + 0.075;
    const paint = lip + 0.05 + 0.2 * ring(a, 2.1, oy, ox) + (fbm(u * 9 + ox, v * 9 + oy, 3) - 0.5) * 0.1;
    out[1] = sat(0.5 + (paint - rr) * 7);
    const relief = rr > 1e-4 ? (u * 0.55 - v * 0.83) / rr : 0;
    const scratch = 0.6 + 0.3 * fbm(u * 5 + ox, v * 40 + oy, 2);
    let bright = scratch * (0.82 + 0.18 * smooth(lip, paint, rr));
    bright = mix(bright, 0.84 - relief * 0.28, smooth(lip * 1.12, lip * 0.96, rr));
    out[0] = mix(bright, 0.015, smooth(hole * 1.1, hole * 0.9, rr));
  };
}

// Glass: a small hole, crushed white round it, long radial cracks tied by a few concentric ones
function glassCrack(seed) {
  const r = rng(seed);
  const rays = [];
  const n = 9 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) rays.push({ a: (i + r() * 0.8) / n * TAU, len: 0.38 + r() * 0.52, bend: (r() - 0.5) * 0.5 });
  const arcs = [];
  for (let i = 0; i < n; i++) if (r() < 0.6) arcs.push([i, 0.16 + r() * 0.3]);
  const point = (ray, d) => {
    const k = Math.min(d, ray.len), a = ray.a + ray.bend * Math.max(0, k - 0.2);
    return [Math.cos(a) * k, Math.sin(a) * k];
  };
  for (const ray of rays) { ray.m = point(ray, 0.2); ray.e = point(ray, ray.len); }
  const ties = arcs.map(([i, rad]) => [...point(rays[i], rad), ...point(rays[(i + 1) % n], rad * (0.85 + 0.3 * ((i * 7) % 5) / 5))]);
  return (u, v, out) => {
    const rr = Math.hypot(u, v);
    let d = 1e9;
    for (const ray of rays) {
      if (rr > ray.len + 0.05) continue;
      const m = ray.m, e = ray.e;
      d = Math.min(d, segment(u, v, 0, 0, m[0], m[1]), segment(u, v, m[0], m[1], e[0], e[1]) + smooth(ray.len * 0.5, ray.len, rr) * 0.012);
    }
    if (rr < 0.55) for (const t of ties) d = Math.min(d, segment(u, v, t[0], t[1], t[2], t[3]) + 0.004);
    const line = sat(1 - d / 0.03);
    const crushed = smooth(0.2, 0.07, rr) * (0.45 + 0.4 * fbm(u * 30, v * 30, 2));
    out[1] = Math.max(line, crushed, smooth(0.075, 0.05, rr));
    out[0] = mix(0.78 + 0.22 * line, 0.06, smooth(0.07, 0.045, rr));
  };
}

// Blood on the ground: an irregular pool, darker where it stands deeper, with a few drops thrown clear
function bloodPool(seed, lobes = 1.3) {
  const r = rng(seed), ox = r() * 60, oy = r() * 60;
  const drops = [];
  for (let i = 0, n = 6 + Math.floor(r() * 6); i < n; i++) {
    const a = r() * TAU, d = 0.5 + r() * 0.38;
    drops.push([Math.cos(a) * d, Math.sin(a) * d, 0.018 + r() * r() * 0.07]);
  }
  return (u, v, out) => {
    const rr = Math.hypot(u, v), a = Math.atan2(v, u);
    const edge = 0.56 * (0.5 + 0.62 * ring(a, lobes, ox, oy) + 0.2 * (ring(a, 3.6, oy, ox) - 0.5));
    const field = edge - rr + (fbm(u * 4 + ox, v * 4 + oy, 3) - 0.5) * 0.1;
    let cover = sat(0.5 + field * 5);
    if (rr > 0.4) for (const [dx, dy, size] of drops) cover = Math.max(cover, sat(0.5 + (size - Math.hypot(u - dx, v - dy)) * 13));
    out[1] = cover;
    out[0] = (0.5 + 0.5 * smooth(0.24, 0, field)) * (0.85 + 0.3 * fbm(u * 6 + oy, v * 6 + ox, 3));
  };
}

function bloodDrops(seed, count) {
  const r = rng(seed);
  const drops = [];
  for (let i = 0; i < count; i++) {
    const a = r() * TAU, d = Math.sqrt(r()) * 0.7, size = 0.025 + r() * r() * 0.13;
    const rot = r() * TAU;
    drops.push([Math.cos(a) * d, Math.sin(a) * d, size, 1 + r() * 0.8, Math.cos(rot), Math.sin(rot)]);
  }
  return (u, v, out) => {
    let cover = 0;
    for (const [dx, dy, size, stretch, c, s] of drops) {
      const x = u - dx, y = v - dy;
      if (x * x + y * y > 0.12) continue;
      cover = Math.max(cover, sat(0.5 + (size - Math.hypot((x * c + y * s) / stretch, y * c - x * s)) * 12));
    }
    out[1] = cover; out[0] = 0.8 + 0.2 * fbm(u * 8, v * 8, 2);
  };
}

// Blood thrown onto a surface behind a wound: drops stretched along their flight from the bottom of the tile
function bloodSpray(seed) {
  const r = rng(seed);
  const drops = [];
  for (let i = 0; i < 30; i++) {
    const a = (r() - 0.5) * 1.3, d = 0.3 + r() * 1.3, size = 0.012 + r() * r() * 0.07;
    drops.push([Math.sin(a) * d, Math.cos(a) * d - 0.85, size, 1.4 + r() * 2.6, Math.sin(a), Math.cos(a)]);
  }
  return (u, v, out) => {
    let cover = 0;
    for (const [dx, dy, size, stretch, ax, ay] of drops) {
      const x = u - dx, y = v - dy;
      if (x * x + y * y > 0.16) continue;
      cover = Math.max(cover, sat(0.5 + (size - Math.hypot((x * ax + y * ay) / stretch, y * ax - x * ay)) * 13));
    }
    out[1] = cover; out[0] = 0.8 + 0.2 * fbm(u * 8, v * 8, 2);
  };
}

// Timber: a small hole and pale splinters torn along the grain (v)
function woodHole(seed) {
  const r = rng(seed), ox = r() * 60;
  return (u, v, out) => {
    const grain = fbm(u * 22 + ox, v * 2.4, 3);
    const tear = 0.2 * (1 - Math.pow(Math.abs(v) / 0.78, 1.6)) * (0.55 + 0.9 * grain);
    out[1] = sat(0.5 + (tear - Math.abs(u)) * 9);
    const rr = Math.hypot(u, v * 0.8);
    out[0] = mix(0.62 + 0.38 * grain, 0.05, smooth(0.11, 0.07, rr));
  };
}

function scorch(seed) {
  const r = rng(seed), ox = r() * 60, oy = r() * 60;
  return (u, v, out) => {
    out[1] = smooth(0.9, 0.05, Math.hypot(u, v)) * (0.35 + 0.65 * fbm(u * 3 + ox, v * 3 + oy));
    out[0] = 0.5 + 0.5 * fbm(u * 6 + oy, v * 6 + ox, 2);
  };
}

/**
 * Paints the atlas.
 * @param {number} [size=512] - side of the square image in pixels (a multiple of 4)
 * @returns {{data: Uint8Array, size: number, grid: number}} RGBA8, row 0 first, linear values
 */
function buildFxAtlas(size = 512) {
  const tile = size / GRID;
  const data = new Uint8Array(size * size * 4);
  const out = [0, 0];
  const paint = (channel, index, fn) => {
    const tx = (index % GRID) * tile, ty = Math.floor(index / GRID) * tile;
    for (let y = 0; y < tile; y++) {
      const v = 1 - (y + 0.5) / tile * 2;
      for (let x = 0; x < tile; x++) {
        const u = (x + 0.5) / tile * 2 - 1;
        const m = Math.max(Math.abs(u), Math.abs(v));
        const window = m > 0.955 ? 0 : m > 0.84 ? smooth(0.955, 0.84, m) : 1;
        const o = ((ty + y) * size + tx + x) * 4;
        if (channel === 2) {
          if (!window) continue;
          fn(u, v, out);
          data[o + 2] = Math.round(sat(out[0]) * 255);
          data[o + 3] = Math.round(sat(out[1]) * window * 255);
        } else if (window) data[o + channel] = Math.round(sat(fn(u, v)) * window * 255);
      }
    }
  };

  paint(0, GLOW.star3, starFlash(3, 11));
  paint(0, GLOW.star4, starFlash(4, 23));
  paint(0, GLOW.star5, starFlash(5, 37));
  paint(0, GLOW.starWild, starFlash(4, 41, 1.1));
  paint(0, GLOW.ballA, ballFlash(53, 0.5, 6));
  paint(0, GLOW.ballB, ballFlash(67, 0.46, 8, 0.7));
  paint(0, GLOW.ballBig, ballFlash(71, 0.56, 11, 0.8));
  paint(0, GLOW.sparkBurst, sparkBurst(83, 16));
  paint(0, GLOW.coneNarrowA, coneFlash(97, 0.25, 1, 0.18));
  paint(0, GLOW.coneNarrowB, coneFlash(101, 0.22, 0.9, 0.24));
  paint(0, GLOW.coneFatA, coneFlash(113, 0.42, 1, 0.34, 0.6));
  paint(0, GLOW.coneFatB, coneFlash(127, 0.36, 0.92, 0.42, 0.5));
  paint(0, GLOW.jet, coneFlash(131, 0.13, 0.7, 0.2));
  paint(0, GLOW.glint, glint);
  paint(0, GLOW.haze, haze(139));
  paint(0, GLOW.coneShort, coneFlash(149, 0.3, 0.72, 0.3, 0.55));

  paint(1, SMOKE.puffA, puff(211));
  paint(1, SMOKE.puffB, puff(223));
  paint(1, SMOKE.puffC, puff(227, 0.68));
  paint(1, SMOKE.puffD, puff(229, 0.42));
  paint(1, SMOKE.wispA, wisp(233));
  paint(1, SMOKE.wispB, wisp(239));
  paint(1, SMOKE.burst, burst(241, 0.5, 5));
  paint(1, SMOKE.column, burst(251, 0.2, 9));
  paint(1, SMOKE.chipA, fragment(257, 4, 0.4, 0.8));
  paint(1, SMOKE.chipB, fragment(263, 5, 0.45, 0.78));
  paint(1, SMOKE.chipC, fragment(269, 3, 0.5, 0.82));
  paint(1, SMOKE.shard, fragment(271, 3, 0.3, 0.5, 1.7));
  paint(1, SMOKE.droplet, droplet);
  paint(1, SMOKE.splinter, splinter);
  paint(1, SMOKE.clod, clod(277));
  paint(1, SMOKE.soft, soft);

  paint(2, DECAL.concreteA, concreteHole(307));
  paint(2, DECAL.concreteB, concreteHole(311, 0.9));
  paint(2, DECAL.concreteC, concreteHole(313, 1.08));
  paint(2, DECAL.gouge, gouge(317));
  paint(2, DECAL.metalA, metalHole(331));
  paint(2, DECAL.metalB, metalHole(337));
  paint(2, DECAL.glassA, glassCrack(347));
  paint(2, DECAL.glassB, glassCrack(349));
  paint(2, DECAL.bloodPoolA, bloodPool(353));
  paint(2, DECAL.bloodPoolB, bloodPool(359, 1.7));
  paint(2, DECAL.bloodPoolC, bloodPool(367, 1.1));
  paint(2, DECAL.bloodDropsA, bloodDrops(373, 9));
  paint(2, DECAL.bloodDropsB, bloodDrops(379, 14));
  paint(2, DECAL.wood, woodHole(383));
  paint(2, DECAL.scorch, scorch(389));
  paint(2, DECAL.bloodSpray, bloodSpray(397));
  return { data, size, grid: GRID };
}

export { buildFxAtlas, GLOW, SMOKE, DECAL };
