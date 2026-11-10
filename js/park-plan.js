// What a park's ground needs to know about itself, worked out from what the park is made of: where the trees shade
// it, where the drives and their walkers wear it, where water keeps it wet, which lawns are kept (`bakeParkField`);
// the drives as ribbons with a shoulder each side and the shores as bands (`ribbon`, `shoreBand`); the schist outcrops
// as glacier-worn whalebacks (`outcrop`). Pure: no three.js, deterministic, tested in tests/park-plan.test.cjs.

const FIELD_CELL = 2; // metres a texel
const WEAR_REACH = 7; // how far from a drive's edge the grass shows its walkers
const SHORE_REACH = 9;
const CROWN = 5.6; // crown radius of a full-grown tree (scale 1), metres

const pointsOf = (flat) => {
  if (!flat.length || typeof flat[0] !== 'number') return flat.map((p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : p));
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], z: flat[i + 1] });
  return out;
};

/**
 * The park's field, a texture's worth of bytes (RGBA, rows along z):
 *   R canopy: how much of the sky the trees hide; G wear: 1 at a drive's edge, 0 `WEAR_REACH` metres from it;
 *   B shore: 1 at the water's edge; A kept: inside a named lawn (Sheep Meadow, the Great Lawn...)
 * @param {{ bounds: { minX, maxX, minZ, maxZ }, cell?: number, margin?: number,
 *   trees?: { x, z, scale }[], drives?: { pts: number[], w: number, reach?: number, strength?: number }[], water?: { ring: number[] }[], lawns?: { ring: number[] }[],
 *   rocks?: { x, z, radius }[] }} park
 */
function bakeParkField({ bounds, cell = FIELD_CELL, margin = 8, trees = [], drives = [], water = [], lawns = [], rocks = [] }) {
  const minX = bounds.minX - margin, minZ = bounds.minZ - margin;
  const width = Math.ceil((bounds.maxX - bounds.minX + margin * 2) / cell);
  const height = Math.ceil((bounds.maxZ - bounds.minZ + margin * 2) / cell);
  const canopy = new Float32Array(width * height), wear = new Float32Array(width * height), shore = new Float32Array(width * height);
  const kept = new Uint8Array(width * height);
  // Every texel whose centre lies within the box, clipped to the field
  const each = (x0, x1, z0, z1, fn) => {
    const i0 = Math.max(0, Math.floor((x0 - minX) / cell)), i1 = Math.min(width - 1, Math.floor((x1 - minX) / cell));
    const j0 = Math.max(0, Math.floor((z0 - minZ) / cell)), j1 = Math.min(height - 1, Math.floor((z1 - minZ) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * width + i, minX + (i + 0.5) * cell, minZ + (j + 0.5) * cell);
  };
  const toSegment = (x, z, a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
  };

  // Crowns overlap: each hides its share of what the others left
  for (const t of trees) {
    const r = CROWN * (t.scale || 1), reach = r * 1.25;
    each(t.x - reach, t.x + reach, t.z - reach, t.z + reach, (k, x, z) => {
      const d = Math.hypot(x - t.x, z - t.z);
      if (d >= reach) return;
      const u = Math.min(1, (reach - d) / (reach - r * 0.35));
      canopy[k] = 1 - (1 - canopy[k]) * (1 - 0.9 * u * u * (3 - 2 * u));
    });
  }
  for (const d of drives) {
    // (a footpath wears the grass less far and less hard than a drive: `reach`, `strength`)
    const pts = pointsOf(d.pts), half = (d.w || 8) / 2, far = d.reach || WEAR_REACH, strength = d.strength || 1, reach = half + far;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      each(Math.min(a.x, b.x) - reach, Math.max(a.x, b.x) + reach, Math.min(a.z, b.z) - reach, Math.max(a.z, b.z) + reach, (k, x, z) => {
        const e = toSegment(x, z, a, b) - half;
        if (e >= far) return;
        const v = (e <= 0 ? 1 : (1 - e / far) ** 2) * strength;
        if (v > wear[k]) wear[k] = v;
      });
    }
  }
  // Everyone climbs the rocks: the grass round them is gone
  for (const r of rocks) {
    const reach = r.radius + 4.5;
    each(r.x - reach, r.x + reach, r.z - reach, r.z + reach, (k, x, z) => {
      const e = Math.hypot(x - r.x, z - r.z) - r.radius;
      if (e >= 4.5) return;
      const v = e <= 0 ? 1 : (1 - e / 4.5) ** 1.5;
      if (v > wear[k]) wear[k] = v;
    });
  }
  for (const w of water) {
    const pts = pointsOf(w.ring);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      each(Math.min(a.x, b.x) - SHORE_REACH, Math.max(a.x, b.x) + SHORE_REACH, Math.min(a.z, b.z) - SHORE_REACH, Math.max(a.z, b.z) + SHORE_REACH, (k, x, z) => {
        const e = toSegment(x, z, a, b);
        if (e >= SHORE_REACH) return;
        const v = (1 - e / SHORE_REACH) ** 1.5;
        if (v > shore[k]) shore[k] = v;
      });
    }
  }
  for (const l of lawns) {
    const pts = pointsOf(l.ring);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    each(x0, x1, z0, z1, (k, x, z) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
      }
      if (inside) kept[k] = 1;
    });
  }

  const data = new Uint8Array(width * height * 4);
  for (let k = 0; k < width * height; k++) {
    data[k * 4] = Math.round(canopy[k] * 255);
    data[k * 4 + 1] = Math.round(wear[k] * 255);
    data[k * 4 + 2] = Math.round(shore[k] * 255);
    data[k * 4 + 3] = kept[k] * 255;
  }
  return { data, width, height, minX, minZ, cell };
}

/** The field at (x, z): { canopy, wear, shore, kept } in 0 .. 1 (nearest texel; zeros outside the park) */
function sampleParkField(field, x, z) {
  const i = Math.floor((x - field.minX) / field.cell), j = Math.floor((z - field.minZ) / field.cell);
  if (i < 0 || j < 0 || i >= field.width || j >= field.height) return { canopy: 0, wear: 0, shore: 0, kept: 0 };
  const k = (j * field.width + i) * 4;
  return { canopy: field.data[k] / 255, wear: field.data[k + 1] / 255, shore: field.data[k + 2] / 255, kept: field.data[k + 3] / 255 };
}

// Each point of a polyline with the unit normal to its left and how far a mitred offset must reach along it
function frames(pts, closed) {
  const n = pts.length;
  const out = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[closed ? (i + n - 1) % n : Math.max(0, i - 1)], b = pts[i], c = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const unit = (p, q) => { const l = Math.hypot(q.x - p.x, q.z - p.z) || 1; return [(q.x - p.x) / l, (q.z - p.z) / l]; };
    const [ax, az] = a === b ? unit(b, c) : unit(a, b);
    const [cx, cz] = b === c ? [ax, az] : unit(b, c);
    // left normals of the two edges, and their mitre
    let mx = az + cz, mz = -ax - cx;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { mx = az; mz = -ax; } else { mx /= ml; mz /= ml; }
    const reach = 1 / Math.max(0.5, mx * az + mz * -ax);
    if (i > 0) s += Math.hypot(b.x - pts[i - 1].x, b.z - pts[i - 1].z);
    out.push({ x: b.x, z: b.z, nx: mx, nz: mz, reach, s });
  }
  return out;
}

/**
 * A drive as cross-sections: at each point of its centreline, where its two edges and the outer edges of its two
 * shoulders are. `s` is the distance along it.
 * @returns {{ s: number, left: {x, z}, right: {x, z}, leftOut: {x, z}, rightOut: {x, z} }[]}
 */
function ribbon(points, width, shoulder = 0) {
  const pts = pointsOf(points).filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.z - all[i - 1].z) > 0.05);
  if (pts.length < 2) return [];
  const half = width / 2;
  return frames(pts, false).map((f) => {
    const at = (d) => ({ x: f.x + f.nx * d * f.reach, z: f.z + f.nz * d * f.reach });
    return { s: f.s, left: at(half), right: at(-half), leftOut: at(half + shoulder), rightOut: at(-half - shoulder) };
  });
}

/**
 * The band of ground along a shore: for each point of the water's outline, the point itself and one `width` metres
 * out on the land, with `s` the distance round the ring (the last section closes on the first).
 */
function shoreBand(ring, width) {
  const pts = pointsOf(ring);
  let area2 = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area2 += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  // frames() gives the normal to the left of travel, (dz, -dx): that is outward when the signed area is positive
  const out = area2 > 0 ? 1 : -1;
  const f = frames(pts, true);
  const band = f.map((p) => ({ s: p.s, edge: { x: p.x, z: p.z }, land: { x: p.x + p.nx * out * width * Math.min(p.reach, 1.4), z: p.z + p.nz * out * width * Math.min(p.reach, 1.4) } }));
  if (band.length) {
    const first = band[0], last = pts[pts.length - 1];
    band.push({ s: f[f.length - 1].s + Math.hypot(first.edge.x - last.x, first.edge.z - last.z), edge: first.edge, land: first.land });
  }
  return band;
}

function random(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A Manhattan schist outcrop as the glacier left it: a whaleback, rising gently on the side the ice came from and
 * dropping steeply on the other, stepped where the rock's layers broke away, its foot below the ground.
 * Local frame: y up from the ground, the outline within `rx` by `rz` metres.
 * @returns {{ position: Float32Array, normal: Float32Array, index: Uint16Array, height: number }}
 */
function outcrop({ seed = 1, rx = 6, rz = 5, height = 3, rings = 20, segments = 64 } = {}) {
  const rnd = random(seed * 977 + 31);
  const phase = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
  const ice = rnd() * 6.283, layers = rnd() * 3.1416;
  const steps = 3.5 + rnd() * 2.5;
  const lattice = Array.from({ length: 64 }, () => rnd());
  const noise = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const at = (i, j) => lattice[((i % 8) + 8) % 8 + (((j % 8) + 8) % 8) * 8];
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    return (at(ix, iz) * (1 - sx) + at(ix + 1, iz) * sx) * (1 - sz) + (at(ix, iz + 1) * (1 - sx) + at(ix + 1, iz + 1) * sx) * sz;
  };
  const stair = (v) => { const f = v - Math.floor(v); const u = Math.min(1, Math.max(0, (f - 0.3) / 0.4)); return Math.floor(v) + u * u * (3 - 2 * u); };
  const count = rings * segments + 1;
  const position = new Float32Array(count * 3), normal = new Float32Array(count * 3);
  let top = 0;
  const put = (k, ux, uz, r) => {
    let h = Math.max(0, 1 - r ** 2.4) ** 0.7;
    h *= 1 + 0.3 * (ux * Math.cos(ice) + uz * Math.sin(ice)); // the lee side stands higher
    const band = (ux * Math.cos(layers) + uz * Math.sin(layers)) * 2.6 + noise(ux * 2.3 + 3, uz * 2.3 + 7) * 0.9;
    h = h * 0.4 + (stair(h * steps + Math.sin(band * 3.1) * 0.3) / steps) * 0.6;
    h += (noise(ux * 3.7 + 11, uz * 3.7 + 5) - 0.5) * 0.16 * (1 - r ** 4) + (noise(ux * 9.1, uz * 9.1) - 0.5) * 0.05 * (1 - r ** 4);
    const y = Math.max(0, h) * height - 0.45 * r ** 8;
    position[k * 3] = ux * rx;
    position[k * 3 + 1] = y;
    position[k * 3 + 2] = uz * rz;
    if (y > top) top = y;
  };
  put(0, 0, 0, 0);
  for (let i = 1; i <= rings; i++) {
    const r = (i / rings) ** 0.75; // more rings toward the rim, where the rock falls away
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const lobe = 1 + 0.2 * Math.sin(2 * a + phase[0]) + 0.11 * Math.sin(3 * a + phase[1]) + 0.06 * Math.sin(5 * a + phase[2]);
      put(1 + (i - 1) * segments + j, Math.cos(a) * r * lobe / 1.37, Math.sin(a) * r * lobe / 1.37, r);
    }
  }
  const index = new Uint16Array(segments * 3 + (rings - 1) * segments * 6);
  let o = 0;
  const v = (i, j) => 1 + (i - 1) * segments + (j % segments);
  // (angles turn from +x toward +z: seen from above that is clockwise, so the centre fan and the quads run j + 1 first)
  for (let j = 0; j < segments; j++) { index[o++] = 0; index[o++] = v(1, j + 1); index[o++] = v(1, j); }
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      index[o++] = v(i, j); index[o++] = v(i, j + 1); index[o++] = v(i + 1, j + 1);
      index[o++] = v(i, j); index[o++] = v(i + 1, j + 1); index[o++] = v(i + 1, j);
    }
  }
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = position[b] - position[a], uy = position[b + 1] - position[a + 1], uz = position[b + 2] - position[a + 2];
    const wx = position[c] - position[a], wy = position[c + 1] - position[a + 1], wz = position[c + 2] - position[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    for (const k of [a, b, c]) { normal[k] += nx; normal[k + 1] += ny; normal[k + 2] += nz; }
  }
  for (let k = 0; k < count * 3; k += 3) {
    const l = Math.hypot(normal[k], normal[k + 1], normal[k + 2]) || 1;
    normal[k] /= l; normal[k + 1] /= l; normal[k + 2] /= l;
  }
  return { position, normal, index, height: top };
}

export { FIELD_CELL, WEAR_REACH, SHORE_REACH, CROWN, bakeParkField, sampleParkField, ribbon, shoreBand, outcrop };
