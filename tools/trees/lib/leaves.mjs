// Leaves cut out of their scanned sheets, each stood upright in a texture of its own:
// channels r g b (linear), coverage, and the leaf's relief as a normal (x to the leaf's right, y toward its tip).
// Row 0 of a leaf texture is its tip, the last row its stem.
import path from 'node:path';
import { readRGB, readGray, Texture, toLinear } from './image.mjs';
import { clamp } from './util.mjs';

const CHANNELS = 6;

async function loadSheet(color, opacity, normal) {
  const [c, o, n] = await Promise.all([readRGB(color), readGray(opacity), readRGB(normal)]);
  if (o.w !== c.w || o.h !== c.h || n.w !== c.w || n.h !== c.h) throw new Error(`sheet maps differ in size: ${color}`);
  return { color: c, opacity: o, normal: n, w: c.w, h: c.h };
}

// Connected pieces of the opacity map, largest first: { label, area, pixels bounds }
function components(sheet, minShare) {
  const { w, h, opacity } = sheet;
  const S = opacity.c, src = opacity.data;
  const labels = new Int32Array(w * h);
  const found = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (labels[start] || src[start * S] < 128) continue;
    const label = found.length + 1;
    let top = 0, area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    stack[top++] = start;
    labels[start] = label;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i / w) | 0;
      area++;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && !labels[i - 1] && src[(i - 1) * S] >= 128) { labels[i - 1] = label; stack[top++] = i - 1; }
      if (x < w - 1 && !labels[i + 1] && src[(i + 1) * S] >= 128) { labels[i + 1] = label; stack[top++] = i + 1; }
      if (y > 0 && !labels[i - w] && src[(i - w) * S] >= 128) { labels[i - w] = label; stack[top++] = i - w; }
      if (y < h - 1 && !labels[i + w] && src[(i + w) * S] >= 128) { labels[i + w] = label; stack[top++] = i + w; }
    }
    const mx = sx / area, my = sy / area;
    found.push({ label, area, x0, y0, x1, y1, mx, my, cxx: sxx / area - mx * mx, cyy: syy / area - my * my, cxy: sxy / area - mx * my });
  }
  const kept = found.filter((f) => f.area >= w * h * minShare).sort((a, b) => b.area - a.area);
  return { labels, kept };
}

/**
 * The leaves of one sheet. `stem` says where stems are: 'bottom' (as ambientCG lays its leaves out), or 'narrow' for
 * sheets whose pieces lie at any angle (the stem is then the thin end of the piece's long axis).
 * Returns [{ tex, aspect (width / length), pixels (length in source pixels) }].
 */
export async function cutLeaves({ color, opacity, normal, stem = 'bottom', minShare = 0.006, maxLength = 640 }) {
  const sheet = await loadSheet(color, opacity, normal);
  const { w, h } = sheet;
  const { labels, kept } = components(sheet, minShare);
  const leaves = [];
  for (const piece of kept) {
    // Long axis by the piece's second moments; the sheet's own vertical when the piece is nearly round
    const { cxx, cyy, cxy } = piece;
    const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
    const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det)), l2 = tr - l1;
    let ax = 0, ay = -1;
    if (stem === 'narrow' || l1 / Math.max(1e-6, l2) > 2.4) {
      const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      ax = Math.cos(angle); ay = Math.sin(angle);
      if (stem === 'bottom' && ay > 0) { ax = -ax; ay = -ay; }
    }
    // Extent along and across the axis
    let tMin = Infinity, tMax = -Infinity, sMax = 0;
    const along = [];
    for (let y = piece.y0; y <= piece.y1; y++) for (let x = piece.x0; x <= piece.x1; x++) {
      if (labels[y * w + x] !== piece.label) continue;
      const dx = x - piece.mx, dy = y - piece.my;
      const t = dx * ax + dy * ay, s = Math.abs(-dx * ay + dy * ax);
      if (t < tMin) tMin = t; if (t > tMax) tMax = t; if (s > sMax) sMax = s;
      if (stem === 'narrow') along.push(t, s);
    }
    if (stem === 'narrow') {
      // the thin end is the stalk: turn the axis so it starts there
      const span = tMax - tMin;
      let lo = 0, hi = 0;
      for (let i = 0; i < along.length; i += 2) {
        if (along[i] < tMin + span * 0.07) lo = Math.max(lo, along[i + 1]);
        if (along[i] > tMax - span * 0.07) hi = Math.max(hi, along[i + 1]);
      }
      if (hi < lo) { ax = -ax; ay = -ay; [tMin, tMax] = [-tMax, -tMin]; }
    }
    const length = tMax - tMin + 4, width = sMax * 2 + 4;
    const scale = Math.min(1, maxLength / length);
    const th = Math.max(8, Math.round(length * scale)), tw = Math.max(8, Math.round(width * scale));
    const tex = new Texture(tw, th, CHANNELS);
    const d = tex.data;
    const px = -ay, py = ax; // the leaf's right, in sheet pixels
    const C = sheet.color.data, N = sheet.normal.data, O = sheet.opacity.data, OS = sheet.opacity.c;
    for (let v = 0; v < th; v++) for (let u = 0; u < tw; u++) {
      const t = tMin - 2 + (1 - (v + 0.5) / th) * length;
      const s = ((u + 0.5) / tw - 0.5) * width;
      const fx = piece.mx + ax * t + px * s, fy = piece.my + ay * t + py * s;
      const x = clamp(Math.round(fx), 0, w - 1), y = clamp(Math.round(fy), 0, h - 1);
      const i = y * w + x, o = (v * tw + u) * CHANNELS;
      d[o] = toLinear(C[i * 3]); d[o + 1] = toLinear(C[i * 3 + 1]); d[o + 2] = toLinear(C[i * 3 + 2]);
      d[o + 3] = labels[i] === piece.label ? O[i * OS] / 255 : 0;
      // the sheet's normal (x right, y up the sheet) turned into the leaf's own frame
      const nx = N[i * 3] / 127.5 - 1, ny = -(N[i * 3 + 1] / 127.5 - 1);
      d[o + 4] = nx * px + ny * py;
      d[o + 5] = nx * ax + ny * ay;
    }
    leaves.push({ tex, aspect: width / length, pixels: length });
  }
  return leaves;
}

// The leaves of an ambientCG set, as fetch.mjs unpacks it
export function cutSet(root, id, options = {}) {
  const base = path.join(root, id, `${id}_2K-JPG_`);
  return cutLeaves({ color: `${base}Color.jpg`, opacity: `${base}Opacity.jpg`, normal: `${base}NormalGL.jpg`, ...options });
}

// Mean colour of a leaf under its coverage (linear)
export function meanColor(leaves) {
  const sum = [0, 0, 0];
  let n = 0;
  for (const { tex } of leaves) {
    const d = tex.data;
    for (let i = 0; i < d.length; i += CHANNELS) {
      const a = d[i + 3];
      sum[0] += d[i] * a; sum[1] += d[i + 1] * a; sum[2] += d[i + 2] * a; n += a;
    }
  }
  return sum.map((v) => v / Math.max(1e-6, n));
}

/**
 * Brings a set of leaves to a target mean colour (linear), keeping each leaf's own veins and blotches; `contrast`
 * scales how far a texel may stand from the mean, and nothing comes out brighter than `ceiling` times the target
 * (scans carry glints and pale lichen several times the mean).
 */
export function gradeLeaves(leaves, target, { contrast = 1, ceiling = 2.2 } = {}) {
  const mean = meanColor(leaves);
  for (const { tex } of leaves) {
    const d = tex.data;
    for (let i = 0; i < d.length; i += CHANNELS) {
      for (let c = 0; c < 3; c++) {
        const rel = d[i + c] / Math.max(1e-5, mean[c]);
        d[i + c] = target[c] * Math.min(ceiling, Math.max(0.15, 1 + (rel - 1) * contrast));
      }
    }
    tex.buildMips(3);
  }
  return leaves;
}

/**
 * A fan-shaped leaf (ginkgo) made from the blade of another: the source's veins, which run along it, are swept round
 * the stalk so they radiate, inside a fan with a wavy rim and a notch.
 */
export function fanLeaf(source, seed = 1, size = 256) {
  const tex = new Texture(size, size, CHANNELS);
  const d = tex.data, out = new Float32Array(CHANNELS);
  const spread = 1.02 + 0.12 * Math.sin(seed * 12.9); // half-angle of the fan, radians
  const notch = 0.08 + 0.1 * Math.abs(Math.sin(seed * 7.3));
  for (let v = 0; v < size; v++) for (let u = 0; u < size; u++) {
    const s = (u + 0.5) / size - 0.5, t = 1 - (v + 0.5) / size;
    const o = (v * size + u) * CHANNELS;
    const y = t - 0.02, r = Math.hypot(s * 1.05, y), a = Math.atan2(s, y);
    const stalk = 0.26;
    const rim = 0.93 + 0.035 * Math.sin(a * 9 + seed) + 0.02 * Math.sin(a * 23 + seed * 3) - notch * Math.exp(-(a * a) / 0.006);
    let cover = 0;
    if (y > 0 && r > stalk * 0.8) {
      // the wedge opens from the stalk: narrow where it leaves it, the full fan a little further out
      const open = spread * clamp((r - stalk * 0.8) / (stalk * 0.9), 0.08, 1);
      const edge = Math.min((open - Math.abs(a)) * r * 16, (rim - r) * 24);
      cover = clamp(edge + 0.5);
    }
    const onStalk = y > 0 && y < stalk && Math.abs(s) < 0.012 + 0.006 * (1 - y / stalk);
    if (cover <= 0 && !onStalk) continue;
    // blade: across the fan = across the source, out along the fan = up the source
    source.tex.sampleLevel(0, 0.5 + (a / spread) * 0.16, 0.7 - clamp((r - stalk) / (1 - stalk)) * 0.4, out);
    d[o] = out[0]; d[o + 1] = out[1]; d[o + 2] = out[2];
    d[o + 3] = Math.max(cover, onStalk ? 1 : 0);
    // the source's relief follows the fan: its x is round the fan, its y is outward
    const cs = Math.cos(a), sn = Math.sin(a);
    d[o + 4] = out[4] * cs + out[5] * sn;
    d[o + 5] = -out[4] * sn + out[5] * cs;
    if (onStalk && cover <= 0) { d[o + 4] = 0; d[o + 5] = 0; }
  }
  return { tex, aspect: 1, pixels: size };
}
