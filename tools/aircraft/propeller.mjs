// The biplane's propeller. Its source carries a flat blurred card where the propeller should be: the importer carves
// real blades instead (laminated wood, a brass sheath along the outer leading edge, painted tips), twisted like a
// fixed-pitch propeller, and paints the small map they wear. The spinning disc that takes over at speed is drawn by
// the game from the same numbers (js/aircraft-assets.js). Offline tool only.

// A smooth curve through (x, y) pairs
function curve(table) {
  return (x) => {
    if (x <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
      if (x > table[i][0]) continue;
      const [x0, y0] = table[i - 1], [x1, y1] = table[i], t = (x - x0) / (x1 - x0), s = t * t * (3 - 2 * t);
      return y0 + (y1 - y0) * s;
    }
    return table[table.length - 1][1];
  };
}

// Chord and thickness along the blade (fractions of the radius): a round shank inside the hub, the widest chord near
// mid span, a thin rounded tip
const CHORD = curve([[0.06, 0.52], [0.14, 0.56], [0.24, 0.76], [0.38, 0.96], [0.5, 1], [0.64, 0.95], [0.78, 0.82], [0.88, 0.66], [0.94, 0.5], [0.975, 0.34], [0.993, 0.19], [1, 0.07]]);
const THICK = curve([[0.06, 0.78], [0.14, 0.6], [0.24, 0.31], [0.4, 0.17], [0.6, 0.115], [0.8, 0.09], [1, 0.08]]);
// Half the thickness of a section at x of its chord (0 leading edge, 1 trailing edge), for a thickness of 1
const half = (x) => 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
const AROUND = [0, 0.012, 0.045, 0.11, 0.22, 0.38, 0.56, 0.74, 0.9, 1]; // stations round a section, leading edge first

/** The chord of the blade (metres) at a fraction of its radius: the game's spinning disc smears this */
const chordAt = (spec, s) => spec.chord * CHORD(s);
/** The blade's angle to the plane it turns in, at a fraction of its radius */
const pitchAt = (spec, s) => Math.min(spec.maxPitch ?? 0.9, Math.atan(spec.pitch / (2 * Math.PI * Math.max(0.02, s) * spec.radius)));

/**
 * Blades as triangles in the aircraft's frame, turning about +Z through `hub` (clockwise seen from the cockpit).
 * uv: x along the blade, y across its chord (0 the leading edge). uv1: (metalness, roughness) of each corner.
 */
function buildBlades(spec, hub) {
  const R = spec.radius, s0 = spec.root / R, stations = [];
  const N = 30;
  for (let i = 0; i <= N; i++) { const t = i / N; stations.push(s0 + (1 - s0) * (1 - (1 - t) ** 1.7)); } // closer together towards the tip
  const ring = [...AROUND.map((x) => [x, 1]), ...AROUND.slice(1, -1).reverse().map((x) => [x, -1])]; // back (forward face) then face
  const position = [], normal = [], uv = [], uv1 = [], index = [], middle = [];
  for (let blade = 0; blade < spec.blades; blade++) {
    const turn = blade * Math.PI * 2 / spec.blades, ct = Math.cos(turn), st = Math.sin(turn);
    const base = position.length / 3;
    const place = (r, u, v, beta) => {
      // blade standing along +Y: its leading edge leads the turn (towards -X) and leans forward by its pitch
      const le = [-Math.cos(beta), 0, Math.sin(beta)], back = [Math.sin(beta), 0, Math.cos(beta)];
      const x = u * le[0] + v * back[0], y = r, z = u * le[2] + v * back[2];
      return [hub[0] + x * ct - y * st, hub[1] + x * st + y * ct, hub[2] + z + (spec.forward ?? 0)];
    };
    for (const s of stations) {
      const c = chordAt(spec, s), t = THICK(s) * c, beta = pitchAt(spec, s);
      const along = (s - s0) / (1 - s0), mid = place(s * R, (0.36 - 0.42) * c, 0, beta);
      for (const [x, side] of ring) {
        middle.push(...mid);
        const h = half(x) * t;
        position.push(...place(s * R, (0.36 - x) * c, side > 0 ? h * 1.45 : -h * 0.55, beta));
        normal.push(0, 0, 0);
        uv.push(along, x);
        // brass along the outer leading edge, paint at the tip, varnished wood elsewhere
        const sheath = x < 0.15 && along > 0.5 && along < 0.9;
        uv1.push(sheath ? 1 : 0, sheath ? 0.34 : along >= 0.9 ? 0.42 : 0.26);
      }
    }
    const M = ring.length;
    for (let i = 0; i < stations.length - 1; i++) for (let j = 0; j < M; j++) {
      const a = base + i * M + j, b = base + i * M + (j + 1) % M, c = base + (i + 1) * M + j, d = base + (i + 1) * M + (j + 1) % M;
      index.push(a, b, c, b, d, c);
    }
    // the tip closed with a fan
    const tip = position.length / 3, last = base + (stations.length - 1) * M;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < M; j++) { cx += position[(last + j) * 3] / M; cy += position[(last + j) * 3 + 1] / M; cz += position[(last + j) * 3 + 2] / M; }
    const out = [-st, ct, 0];
    position.push(cx + out[0] * 0.004, cy + out[1] * 0.004, cz); normal.push(0, 0, 0); uv.push(1, 0.5); uv1.push(0, 0.42); middle.push(cx, cy, cz);
    for (let j = 0; j < M; j++) index.push(last + j, last + (j + 1) % M, tip);
  }
  // triangles wound outwards, then smooth normals
  const P = (i) => [position[i * 3], position[i * 3 + 1], position[i * 3 + 2]];
  for (let k = 0; k < index.length; k += 3) {
    const a = P(index[k]), b = P(index[k + 1]), c = P(index[k + 2]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (let j = 0; j < 3; j++) for (let q = 0; q < 3; q++) normal[index[k + j] * 3 + q] += n[q];
  }
  // which way is out: away from the middle of each corner's own section
  let outward = 0;
  for (let i = 0; i < position.length / 3; i++) for (let q = 0; q < 3; q++) outward += normal[i * 3 + q] * (position[i * 3 + q] - middle[i * 3 + q]);
  if (outward < 0) {
    for (let k = 0; k < index.length; k += 3) { const t = index[k + 1]; index[k + 1] = index[k + 2]; index[k + 2] = t; }
    for (let i = 0; i < normal.length; i++) normal[i] = -normal[i];
  }
  for (let i = 0; i < normal.length; i += 3) {
    const l = Math.hypot(normal[i], normal[i + 1], normal[i + 2]) || 1;
    normal[i] /= l; normal[i + 1] /= l; normal[i + 2] /= l;
  }
  return { position, normal, uv, uv1, index };
}

// Cheap repeatable noise for the grain
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v;
}

/**
 * The blades' colour map, sRGB bytes, `width` along the blade (root to tip) by `height` across the chord (leading
 * edge first): laminations of a carved wooden propeller, a riveted brass sheath, a painted tip.
 */
function bladeTexture(width, height) {
  const px = Buffer.alloc(width * height * 3);
  const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
  const light = [150, 92, 46], dark = [92, 50, 24], brass = [186, 146, 72], paint = [232, 186, 30], edge = [60, 34, 18];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / (width - 1), v = y / (height - 1);
    // the glue lines of the laminations follow the carved surface: bands across the chord that drift along the blade
    const band = (v * 5.2 + Math.sin(u * 5.1 + 0.6) * 0.55 + u * 1.3 + (noise(u * 9, v * 3) - 0.5) * 0.35);
    const lam = band - Math.floor(band);
    let c = mix(light, dark, Math.floor(band) % 2 ? 0.75 : 0.1);
    c = mix(c, edge, Math.max(0, 1 - Math.abs(lam - 0.5) * 2 - 0.86) * 5); // the glue line itself
    // grain: long streaks along the blade
    const grain = noise(u * 160, v * 26) * 0.6 + noise(u * 420, v * 60) * 0.4;
    c = c.map((q) => q * (0.82 + grain * 0.32));
    // varnish darker towards the root, where hands and oil have been
    c = c.map((q) => q * (0.78 + 0.22 * Math.min(1, u * 3)));
    if (u > 0.5 && u < 0.9 && v < 0.16) {
      // sheath: brushed brass, rivets along its inner edge
      const brushed = 0.86 + noise(u * 300, v * 8) * 0.22;
      let b = brass.map((q) => q * brushed);
      const pitch = 0.018, along = (u - 0.5) / pitch, near = Math.hypot((along - Math.round(along)) * pitch * width, (v - 0.125) * height);
      if (near < 1.6) b = b.map((q) => q * 0.62);
      const fade = Math.min(1, (0.16 - v) / 0.012, (u - 0.5) / 0.004, (0.9 - u) / 0.004);
      c = mix(c, b, Math.max(0, fade));
    }
    if (u >= 0.9) {
      const worn = Math.max(0, 0.25 - v) * 1.2 * noise(u * 240, v * 40);
      c = mix(c, mix(paint, [150, 120, 60], worn), Math.min(1, (u - 0.9) / 0.006));
    }
    const o = (y * width + x) * 3;
    for (let k = 0; k < 3; k++) px[o + k] = Math.max(0, Math.min(255, Math.round(c[k])));
  }
  return px;
}

export { buildBlades, bladeTexture, chordAt, pitchAt, CHORD };
