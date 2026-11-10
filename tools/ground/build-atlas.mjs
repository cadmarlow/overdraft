// The ground of the city, seen up close: everything that lies flat in the street (manhole covers, grates, cellar
// doors, tactile pads...) and everything painted or spilled on it (arrows, words, oil, skid marks, locate marks).
//
// Usage, from the repo root:
//   node tools/ground/build-atlas.mjs                      regenerates the three atlases and js/ground-atlas.js
//   node tools/ground/build-atlas.mjs --preview <folder>   also writes lit previews (PNG) into <folder>
//
// Nothing is downloaded and nothing is random: every object is authored here as a height map in millimetres (shapes
// drawn as SVG, rasterised by sharp, bevelled by a blur), and the normal map, the albedo and the roughness are all
// derived from that height. Lettering uses the stroke alphabet below, so the result does not depend on installed fonts.
//
//   assets/ground/objects_c.webp   RGB albedo (sRGB), A coverage
//   assets/ground/objects_n.webp   RGB tangent normal (OpenGL, +Y = image up), A roughness
//   assets/ground/marks.webp       greyscale masks: road symbols (crisp) and stains (soft)
//   js/ground-atlas.js             where each tile sits and how many metres it covers
//
// Roughness carries more than the highlight: js/ground-materials.js takes whatever is rougher than about 0.9 for
// something that is not bare metal. So rust, dirt, leaves and gum are all authored at 0.86 and above, worked metal
// below 0.7, and exactly 1 is kept for the openings of grates and pick holes (black, flat, nothing to reflect).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const sharp = createRequire(new URL('../world/', import.meta.url))('sharp');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.join(ROOT, 'assets/ground');
const MANIFEST = path.join(ROOT, 'js/ground-atlas.js');
const SIZE = 2048;
const PAD = 8; // empty pixels between two tiles
const BLEED = 4; // edge pixels repeated into that padding, so that mips do not pull in the background
const argv = process.argv.slice(2);
const PREVIEW = argv.includes('--preview') ? argv[argv.indexOf('--preview') + 1] : null;

// ---------------------------------------------------------------------------------------------------------------------
// Numbers, noise

const TAU = Math.PI * 2;
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const n2 = (v) => Math.round(v * 100) / 100;

function seedOf(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(R) {
  const a = Math.sqrt(-2 * Math.log(1 - R() * 0.999999)), b = TAU * R();
  return [a * Math.cos(b), a * Math.sin(b)];
}

function hash(ix, iy, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Value noise; px and py are optional periods (in cells) for textures that must tile
function vnoise(x, y, seed, px = 0, py = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const wx = (i) => (px ? ((i % px) + px) % px : i), wy = (i) => (py ? ((i % py) + py) % py : i);
  const a = hash(wx(x0), wy(y0), seed), b = hash(wx(x0 + 1), wy(y0), seed);
  const c = hash(wx(x0), wy(y0 + 1), seed), d = hash(wx(x0 + 1), wy(y0 + 1), seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y, seed, oct = 4, px = 0, py = 0) {
  let s = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) {
    s += a * vnoise(x, y, seed + o * 101, px, py);
    n += a; a *= 0.5; x *= 2; y *= 2; px *= 2; py *= 2;
  }
  return s / n;
}

// A noise image with `cells` lattice cells across the width, stretched to use the whole 0..1 range
function noiseField(w, h, cells, seed, oct = 4, wrap = false, contrast = 1.8) {
  const out = new Float32Array(w * h), f = cells / w, per = wrap ? cells : 0;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) out[i] = sat((fbm(x * f, y * f, seed, oct, per, 0) - 0.5) * contrast + 0.5);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Images as Float32Array

function blur(src, w, h, sigma, wrapX = false) {
  if (sigma < 0.05) return Float32Array.from(src);
  const r = Math.max(1, Math.ceil(sigma * 3)), ker = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += ker[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < ker.length; i++) ker[i] /= sum;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) {
        let xx = x + k;
        if (wrapX) xx = ((xx % w) + w) % w; else if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
        s += src[row + xx] * ker[k + r];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let k = -r; k <= r; k++) {
      const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k, kk = ker[k + r], s0 = yy * w;
      for (let x = 0; x < w; x++) out[o + x] += tmp[s0 + x] * kk;
    }
  }
  return out;
}

// A flat-topped relief out of a mask: blurred, then squeezed so that the top stays flat and the sides become chamfers
function bevel(mask, w, h, sigma, lo = 0.18, hi = 0.82, wrapX = false) {
  const b = blur(mask, w, h, sigma, wrapX);
  for (let i = 0; i < b.length; i++) b[i] = sstep(lo, hi, b[i]);
  return b;
}

// White shapes on black, drawn in the tile's own units (millimetres) and rasterised at the tile's pixel size
// (channels = 3 keeps the colours of the shapes, as sRGB bytes, for the few things that are painted rather than cast)
async function raster(w, h, vw, vh, body, channels = 1) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${vw} ${vh}">`
    + `<rect x="-10" y="-10" width="${vw + 20}" height="${vh + 20}" fill="#000"/><g fill="#fff" stroke="none">${body}</g></svg>`;
  const { data, info } = await sharp(Buffer.from(svg), { limitInputPixels: false, unlimited: true }).raw().toBuffer({ resolveWithObject: true });
  if (info.width !== w || info.height !== h) throw new Error(`raster ${info.width}x${info.height}, wanted ${w}x${h}`);
  const out = new Float32Array(w * h * channels);
  if (channels === 1) for (let i = 0; i < out.length; i++) out[i] = data[i * info.channels] / 255;
  else for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = data[i * info.channels + c];
  return out;
}

// Tangent-space normals of a height map in millimetres. Slopes saturate smoothly, and never reach 55 degrees.
function normalsOf(H, w, h, pxPerMetre, strength, wrapX = false) {
  const out = new Float32Array(w * h * 3), lim = Math.tan((52 * Math.PI) / 180), s = (strength * pxPerMetre) / 1000 / 8; // 52: lossy WebP overshoots a little
  const at = (x, y) => {
    x = wrapX ? (x + w) % w : x < 0 ? 0 : x >= w ? w - 1 : x;
    y = y < 0 ? 0 : y >= h ? h - 1 : y;
    return H[y * w + x];
  };
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const a = at(x - 1, y - 1), b = at(x, y - 1), c = at(x + 1, y - 1), d = at(x - 1, y), f = at(x + 1, y);
      const g = at(x - 1, y + 1), hh = at(x, y + 1), ii = at(x + 1, y + 1);
      let gx = (c + 2 * f + ii - a - 2 * d - g) * s, gy = (g + 2 * hh + ii - a - 2 * b - c) * s; // gy: slope towards image DOWN
      const q = 1 / Math.sqrt(1 + (Math.hypot(gx, gy) / lim) ** 2);
      gx *= q; gy *= q;
      const l = 1 / Math.hypot(gx, gy, 1);
      out[i * 3] = -gx * l; // +X = image right
      out[i * 3 + 1] = gy * l; // +Y = image UP: a surface rising towards the bottom of the image leans up
      out[i * 3 + 2] = l;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// SVG shapes and the stroke alphabet

const circ = (cx, cy, r, a = '') => `<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(r)}" ${a}/>`;
const ringS = (cx, cy, r0, r1, a = '', ink = '#fff') => `<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2((r0 + r1) / 2)}" fill="none" stroke="${ink}" stroke-width="${n2(r1 - r0)}" ${a}/>`;
const rectS = (x, y, w, h, r = 0, a = '') => `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" rx="${n2(r)}" ${a}/>`;
const lineS = (x1, y1, x2, y2, sw, a = '') => `<path d="M${n2(x1)} ${n2(y1)}L${n2(x2)} ${n2(y2)}" fill="none" stroke="#fff" stroke-width="${n2(sw)}" ${a}/>`;
const poly = (pts, a = '') => `<path d="M${pts.map((p) => `${n2(p[0])} ${n2(p[1])}`).join('L')}Z" ${a}/>`;
const BLACK = 'fill="#000"';

// Capital letters and digits as centre lines on a grid 7 units tall (y down, 0 = top, 7 = baseline). [width, path, flipped?]
// Strokes are drawn with square ends and each glyph is clipped to its own box (half a stroke around the grid), so
// upright stems, round letters and diagonals all end on the same two lines; diagonals are simply drawn too long.
const O_PATH = 'M1.7 0H2.3A1.7 1.7 0 0 1 4 1.7V5.3A1.7 1.7 0 0 1 2.3 7H1.7A1.7 1.7 0 0 1 0 5.3V1.7A1.7 1.7 0 0 1 1.7 0Z';
const SIX_PATH = 'M3.9 1.5A1.7 1.7 0 0 0 2.3 0H1.7A1.7 1.7 0 0 0 0 1.7V5.3A1.7 1.7 0 0 0 1.7 7H2.3A1.7 1.75 0 0 0 2.3 3.5H1.7A1.7 1.7 0 0 0 0 5.2';
const GLYPHS = {
  A: [4, 'M-0.29 8L2.29 -1M4.29 8L1.71 -1M0.75 4.7H3.25'],
  B: [4, 'M0 3.4V0H2.1A1.7 1.7 0 0 1 2.1 3.4H0V7H2.2A1.8 1.8 0 0 0 2.2 3.4'],
  C: [4, 'M4 1.7A1.7 1.7 0 0 0 2.3 0H1.7A1.7 1.7 0 0 0 0 1.7V5.3A1.7 1.7 0 0 0 1.7 7H2.3A1.7 1.7 0 0 0 4 5.3'],
  D: [4, 'M0 0H2.3A1.7 1.7 0 0 1 4 1.7V5.3A1.7 1.7 0 0 1 2.3 7H0Z'],
  E: [3.4, 'M3.4 0H0V7H3.4M0 3.4H2.7'],
  F: [3.4, 'M3.4 0H0V7M0 3.5H2.7'],
  G: [4, 'M4 1.7A1.7 1.7 0 0 0 2.3 0H1.7A1.7 1.7 0 0 0 0 1.7V5.3A1.7 1.7 0 0 0 1.7 7H2.3A1.7 1.7 0 0 0 4 5.3V3.8H2.7'],
  H: [4, 'M0 0V7M4 0V7M0 3.4H4'],
  I: [0, 'M0 0V7'],
  J: [3.4, 'M3.4 0V5.3A1.7 1.7 0 0 1 1.7 7A1.7 1.7 0 0 1 0 5.3'],
  K: [4, 'M0 0V7M4.89 -1L0 4.5M1.45 3.1L4.65 8'],
  L: [3.3, 'M0 0V7H3.3'],
  M: [5, 'M0 0V7M5 0V7M-0.54 -1L2.5 4.6L5.54 -1'],
  N: [4, 'M0 0V7M4 0V7M-0.57 -1L4.57 8'],
  O: [4, O_PATH],
  P: [4, 'M0 7V0H2.2A1.8 1.8 0 0 1 2.2 3.6H0'],
  Q: [4, `${O_PATH}M2.3 4.9L4.2 7.3`],
  R: [4, 'M0 7V0H2.2A1.8 1.8 0 0 1 2.2 3.6H0M2.1 3.6L4.56 8'],
  S: [4, 'M4 1.7A1.7 1.7 0 0 0 2.3 0H1.7A1.7 1.7 0 0 0 0 1.7V1.8A1.7 1.7 0 0 0 1.7 3.5H2.3A1.7 1.7 0 0 1 4 5.2V5.3A1.7 1.7 0 0 1 2.3 7H1.7A1.7 1.7 0 0 1 0 5.3'],
  T: [4, 'M0 0H4M2 0V7'],
  U: [4, 'M0 0V5.3A1.7 1.7 0 0 0 1.7 7H2.3A1.7 1.7 0 0 0 4 5.3V0'],
  V: [4, 'M-0.29 -1L2.29 8M4.29 -1L1.71 8'],
  W: [5.4, 'M-0.19 -1L1.54 8M1.07 8L2.7 2.2L4.33 8M3.86 8L5.59 -1'],
  X: [4, 'M-0.57 -1L4.57 8M4.57 -1L-0.57 8'],
  Y: [4, 'M-0.54 -1L2 3.7L4.54 -1M2 3.7V7'],
  Z: [4, 'M0 0H4L0 7H4'],
  0: [3.8, 'M1.7 0H2.1A1.7 1.7 0 0 1 3.8 1.7V5.3A1.7 1.7 0 0 1 2.1 7H1.7A1.7 1.7 0 0 1 0 5.3V1.7A1.7 1.7 0 0 1 1.7 0Z'],
  1: [2, 'M0 1.6L2 0V7'],
  2: [4, 'M0 1.7A1.7 1.7 0 0 1 1.7 0H2.3A1.7 1.7 0 0 1 4 1.7V2.1C4 3.7 0 4.6 0 7H4'],
  3: [4, 'M0 1.7A1.7 1.7 0 0 1 1.7 0H2.3A1.7 1.7 0 0 1 4 1.7V1.75A1.7 1.7 0 0 1 2.3 3.45H1.8M2.3 3.45A1.7 1.7 0 0 1 4 5.15V5.3A1.7 1.7 0 0 1 2.3 7H1.7A1.7 1.7 0 0 1 0 5.3'],
  4: [4, 'M3.1 7V0L0 4.9H4'],
  5: [4, 'M3.6 0H0.4L0 3.3H2.3A1.7 1.85 0 0 1 2.3 7H1.7A1.7 1.7 0 0 1 0 5.3'],
  6: [4, SIX_PATH],
  7: [4, 'M0 0H4L1.14 8'],
  8: [4, 'M1.7 0H2.3A1.7 1.7 0 0 1 2.3 3.4H1.7A1.7 1.7 0 0 1 1.7 0ZM1.8 3.4A1.8 1.8 0 0 0 1.8 7H2.2A1.8 1.8 0 0 0 2.2 3.4'],
  9: [4, SIX_PATH, true],
  '-': [2.2, 'M0 3.6H2.2'],
  '.': [0, 'M0 6.5V7']
};
// Pairs that leave a hole between them when set at the normal distance
const KERN = { LY: -1.2, LT: -1, LV: -1, AT: -0.7, TA: -0.7, AV: -0.8, VA: -0.8, AY: -0.8, YA: -0.8, WA: -0.6, AW: -0.6, PA: -0.5, FA: -0.5, TO: -0.2, OT: -0.2 };
const SPACE = 2.6;

// Where each glyph of a word sits, in font units: [{ ch, x (origin), mid (centre) }] and the total length
function layoutWord(str, weight, gap) {
  const out = [];
  let pen = 0, last = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === ' ') { pen += SPACE; continue; }
    const g = GLYPHS[ch];
    if (!g) throw new Error(`no glyph for "${ch}"`);
    out.push({ ch, x: pen + weight / 2, mid: pen + weight / 2 + g[0] / 2 });
    pen += g[0] + weight + gap;
    last = pen;
    pen += KERN[ch + str[i + 1]] || 0;
  }
  return { glyphs: out, total: last - gap };
}

// The same centre line with every height multiplied by `tall`: the shape grows, the stroke that will follow it does not
function stretchPath(d, tall) {
  const tok = d.match(/[A-Za-z]|-?\d*\.?\d+/g), y = (v) => n2(v * tall);
  let out = '', i = 0, cmd = '';
  const num = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
    if (cmd === 'M' || cmd === 'L') out += `${cmd}${num()} ${y(num())}`;
    else if (cmd === 'H') out += `H${num()}`;
    else if (cmd === 'V') out += `V${y(num())}`;
    else if (cmd === 'A') out += `A${num()} ${y(num())} ${num()} ${num()} ${num()} ${num()} ${y(num())}`;
    else if (cmd === 'C') out += `C${num()} ${y(num())} ${num()} ${y(num())} ${num()} ${y(num())}`;
    else if (cmd === 'Z') out += 'Z';
    else throw new Error(`path command ${cmd}`);
  }
  return out;
}

let clipCount = 0;
function glyphPath(ch, tf, weight, tall = 1) {
  const [gw, d, flip] = GLYPHS[ch], id = `g${clipCount++}`, half = weight / 2;
  return `<clipPath id="${id}"><rect x="${-half}" y="${-half}" width="${gw + weight}" height="${7 * tall + weight}"/></clipPath>`
    + `<g transform="${tf}" clip-path="url(#${id})"><path d="${tall === 1 ? d : stretchPath(d, tall)}"${flip ? ` transform="translate(${gw} ${7 * tall}) rotate(180)"` : ''}/></g>`;
}
const strokeGroup = (weight, round, body) => `<g fill="none" stroke="#fff" stroke-width="${weight}" stroke-linejoin="${round ? 'round' : 'miter'}" stroke-miterlimit="2.2" stroke-linecap="${round ? 'round' : 'square'}">${body}</g>`;

// A straight word centred on (x, y). cap is the full height of a capital, strokes included. Road words are read from
// a driver's seat, so they are drawn tall and narrow: `tall` lengthens the letters themselves, `wide` then scales the
// drawing sideways (which also makes upright strokes thinner than level ones, as on a real road).
function textLine(str, { x, y, cap, weight = 1.25, gap = 1.1, wide = 1, tall = 1, round = false }) {
  const { glyphs, total } = layoutWord(str, weight, gap), uy = cap / (7 * tall + weight), ux = uy * wide;
  const x0 = x - (total * ux) / 2, y0 = y - cap / 2 + (weight / 2) * uy;
  return strokeGroup(weight, round, glyphs.map((g) => glyphPath(g.ch, `translate(${n2(x0 + g.x * ux)} ${n2(y0)}) scale(${ux} ${uy})`, weight, tall)).join(''));
}

// A word bent around (cx, cy). Top text reads clockwise with its feet on radius r; bottom text reads the other way
// round, upright for the same reader, with its feet on radius r too (r is then the outer edge of the lettering).
function arcText(str, { cx, cy, r, cap, weight = 1.25, gap = 1.1, bottom = false }) {
  const { glyphs, total } = layoutWord(str, weight, gap), u = cap / (7 + weight);
  const rRef = bottom ? r - cap / 2 : r + cap / 2;
  return strokeGroup(weight, false, glyphs.map((g) => {
    const deg = (((g.mid - total / 2) * u) / rRef) * (180 / Math.PI), half = GLYPHS[g.ch][0] / 2;
    const tf = bottom
      ? `translate(${cx} ${cy}) rotate(${n2(-deg)}) translate(0 ${n2(r - (weight / 2) * u - 7 * u)}) scale(${u}) translate(${-half} 0)`
      : `translate(${cx} ${cy}) rotate(${n2(deg)}) translate(0 ${n2(-(r + (weight / 2) * u + 7 * u))}) scale(${u}) translate(${-half} 0)`;
    return glyphPath(g.ch, tf, weight);
  }).join(''));
}

// Diamond (checker) plate: lens-shaped lugs on a square grid, turned 45 degrees one way then the other
function treadLugs(x0, y0, x1, y1, pitch, len, wid, keep) {
  const cols = Math.floor((x1 - x0) / pitch), rows = Math.floor((y1 - y0) / pitch);
  const ox = x0 + (x1 - x0 - (cols - 1) * pitch) / 2, oy = y0 + (y1 - y0 - (rows - 1) * pitch) / 2, l = n2(len / 2), q = n2(wid);
  let s = '';
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cx = ox + i * pitch, cy = oy + j * pitch;
      if (!keep(cx, cy)) continue;
      s += `<path d="M${-l} 0Q0 ${-q} ${l} 0Q0 ${q} ${-l} 0Z" transform="translate(${n2(cx)} ${n2(cy)}) rotate(${(i + j) % 2 ? 45 : -45})"/>`;
    }
  }
  return s;
}

const hexS = (cx, cy, r, turn = 0) => poly([0, 1, 2, 3, 4, 5].map((i) => [cx + r * Math.cos(turn + (i * TAU) / 6), cy + r * Math.sin(turn + (i * TAU) / 6)]));

// ---------------------------------------------------------------------------------------------------------------------
// From a height map to albedo, roughness and normals

// Colours are sRGB bytes. base = weathered, top = polished by tyres and shoes, dirt = what settles in the low parts.
const IRON = { base: [70, 63, 57], top: [100, 95, 89], rust: [94, 58, 38], dirt: [43, 39, 35], rBase: 0.66, rTop: 0.42, rRust: 0.88, rDirt: 0.93, grain: 0.3, warp: 0.5, rustThr: 0.58, rustK: 0.75, dirtK: 1, ao: 0.4 };
const IRON_RUSTY = { ...IRON, base: [76, 62, 52], rustThr: 0.5, rustK: 1 };
const IRON_WORN = { ...IRON, top: [126, 121, 114], rTop: 0.3, grain: 0.18, warp: 1.1, rustThr: 0.66, rustK: 0.5 };
const STEEL = { base: [92, 84, 76], top: [122, 118, 112], rust: [100, 62, 40], dirt: [50, 46, 41], rBase: 0.58, rTop: 0.36, rRust: 0.86, rDirt: 0.92, grain: 0.12, warp: 0.8, rustThr: 0.6, rustK: 0.7, dirtK: 1, ao: 0.35 };
const CONCRETE = { base: [132, 130, 124], top: [150, 148, 142], rust: [122, 104, 84], dirt: [78, 74, 68], rBase: 0.88, rTop: 0.78, rRust: 0.9, rDirt: 0.95, grain: 0.55, warp: 0.3, rustThr: 0.68, rustK: 0.35, dirtK: 1, ao: 0.4 };
const TACTILE = { base: [184, 184, 184], top: [202, 202, 202], rust: [150, 146, 140], dirt: [108, 106, 102], rBase: 0.7, rTop: 0.52, rRust: 0.8, rDirt: 0.9, grain: 0.2, warp: 0.25, rustThr: 0.72, rustK: 0.3, dirtK: 0.8, ao: 0.3 };
const VOID = [14, 13, 12];

// o: { H (mm), cover, voidM, mat, polish: [lo, hi] heights between which a surface goes from untouched to polished,
//      polishField, polishMul, rustBias, dirtBias, overlays: [{ mask, col: [r, g, b] | Float32Array, rough }],
//      strength, wrapX, voidCol }
function finish(t, o) {
  const { w, h } = t, n = w * h, k = w / (t.metres[0] * 1000), m = o.mat, wrap = !!o.wrapX, seed = t.seed;
  const [lo, hi] = o.polish, voidCol = o.voidCol || VOID;
  const cells = Math.max(2, Math.round(t.metres[0] * 3));
  const nLow = noiseField(w, h, cells, seed + 11, 4, wrap), nLow2 = noiseField(w, h, cells * 2, seed + 17, 4, wrap);
  const nMid = noiseField(w, h, cells * 8, seed + 23, 3, wrap), nRust = noiseField(w, h, cells * 3, seed + 37, 5, wrap, 2.2);
  const nFine = noiseField(w, h, Math.round(w / 2.4), seed + 41, 2, wrap, 1.5);
  const H = o.H, voidM = o.voidM || new Float32Array(n), Hc = new Float32Array(n);
  for (let i = 0; i < n; i++) Hc[i] = Math.max(H[i], -7); // openings must not count as bottomless when looking for crevices
  const bS = blur(Hc, w, h, Math.max(1.1, 2.5 * k), wrap), bM = blur(Hc, w, h, Math.max(3, 9 * k), wrap);
  const rgb = new Float32Array(n * 3), rough = new Float32Array(n), Hn = new Float32Array(n);
  const overlays = [...(o.overlays || [])];
  let gum = null;
  if (o.gum) { // chewing gum trodden flat and black, on whatever shoes touch
    gum = new Float32Array(n);
    const R = rng(seed + 77);
    for (let g = 0, tries = 0; g < o.gum && tries < 500; tries++) {
      const cx = R() * w, cy = R() * h, r = (8 + R() * 8) * k, i0 = Math.floor(cy) * w + Math.floor(cx);
      if (voidM[i0] > 0.05 || o.cover[i0] < 0.95) continue;
      blot(gum, w, h, cx, cy, r, 1, seed + 78 + g, { warp: 0.22, edge: Math.min(0.6, 1.6 / r + 0.2), ry: r * (0.75 + R() * 0.4) });
      g++;
    }
    overlays.push({ mask: gum, col: [47, 45, 44], rough: 0.95 });
  }
  for (let i = 0; i < n; i++) {
    const top = sstep(lo, hi, H[i]), edge = sat((Hc[i] - bS[i]) / 0.8);
    let pol = o.polishField ? o.polishField[i] : sat(Math.max(top, edge * 0.6) * (0.5 + 0.7 * nLow[i]));
    if (o.polishMul) pol *= o.polishMul[i];
    const crev = sat((bM[i] - Hc[i]) / 1.6 - 0.08);
    const dirt = sat(crev * (0.45 + nMid[i]) * m.dirtK + (1 - top) * 0.32 * nLow2[i] + (o.dirtBias ? o.dirtBias[i] : 0));
    // rust blooms in patches whose edges break up into freckles, and wherever water sits (the bias)
    const rust = sat(sat((nRust[i] + (nMid[i] - 0.5) * 0.3 - m.rustThr) * 5) * m.rustK * (1 - 0.9 * pol) + (o.rustBias ? o.rustBias[i] * (0.3 + nMid[i]) : 0));
    const tone = 0.9 + 0.2 * nLow2[i], rt = 0.8 + 0.4 * nMid[i], shade = (1 - m.ao * crev) * (0.94 + 0.12 * nFine[i]);
    let ro = mix(mix(mix(m.rBase, m.rTop, pol), m.rRust, rust), m.rDirt, dirt) + (nMid[i] - 0.5) * 0.05;
    const v = voidM[i];
    for (let c = 0; c < 3; c++) {
      let x = mix(m.base[c] * tone, m.top[c], pol);
      x = mix(x, m.rust[c] * rt, rust * 0.85);
      x = mix(x, m.dirt[c], dirt * 0.9) * shade;
      rgb[i * 3 + c] = x;
    }
    for (const ov of overlays) {
      const a = ov.mask[i];
      if (a <= 0) continue;
      const flat = !(ov.col instanceof Float32Array);
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] = mix(rgb[i * 3 + c], (flat ? ov.col[c] : ov.col[i * 3 + c]) * shade, a);
      ro = mix(ro, ov.rough, a);
    }
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = mix(rgb[i * 3 + c], voidCol[c], v);
    rough[i] = mix(Math.min(ro, 0.96), 1, v); // 1 is kept for openings alone
    Hn[i] = H[i] + ((nFine[i] - 0.5) * m.grain * (1 - 0.8 * pol) + (nLow[i] - 0.5) * m.warp) * (1 - v) + (gum ? gum[i] * 0.9 : 0);
  }
  const nrm = normalsOf(Hn, w, h, w / t.metres[0], o.strength ?? 1.5, wrap);
  for (let i = 0; i < n; i++) { // nothing to light at the bottom of a hole
    const f = sstep(0.55, 0.95, voidM[i]);
    if (f <= 0) continue;
    const x = nrm[i * 3] * (1 - f), y = nrm[i * 3 + 1] * (1 - f), z = mix(nrm[i * 3 + 2], 1, f), l = 1 / Math.hypot(x, y, z);
    nrm[i * 3] = x * l; nrm[i * 3 + 1] = y * l; nrm[i * 3 + 2] = z * l;
  }
  return { rgb, rough, nrm, cover: o.cover };
}

const add = (H, m, mm) => { for (let i = 0; i < H.length; i++) H[i] += m[i] * mm; };

// The outline of a rectangular object: the whole tile, corners slightly rounded, a soft pixel at the edge
async function coverRect(t, W, Hh, r) {
  const e = (0.7 * W) / t.w;
  return blur(await raster(t.w, t.h, W, Hh, rectS(e, e, W - 2 * e, Hh - 2 * e, r)), t.w, t.h, 0.5);
}

// ---------------------------------------------------------------------------------------------------------------------
// Round covers: the four manholes and the two valve caps share one construction
//   frame ring at road level, a groove, then the cover: a plate 5 mm down carrying raised work back up to road level

async function roundCover(t, { mm, rOut, rPlate, gap, raised, holes, worn = false, strength = 1.5, mat = IRON }) {
  const { w, h } = t, n = w * h, c = mm / 2, k = w / mm, L = (b) => raster(w, h, mm, mm, b);
  const cover = blur(await L(circ(c, c, rOut - 0.7 / k)), w, h, 0.5);
  const plateM = await L(circ(c, c, rPlate)), gapM = await L(ringS(c, c, rPlate, rPlate + gap));
  const raisedM = await L(raised), holesM = await L(holes), innerM = await L(circ(c, c, rOut - 4 / k));
  const bPlate = bevel(plateM, w, h, 0.8), bRaised = bevel(raisedM, w, h, worn ? 2.1 : 1.0), bGap = blur(gapM, w, h, 0.8);
  const bHole = bevel(holesM, w, h, 1.0), bOut = bevel(innerM, w, h, 1.7), nearGap = blur(gapM, w, h, 6 * k + 2);
  const H = new Float32Array(n), polishMul = new Float32Array(n), rustBias = new Float32Array(n), dirtBias = new Float32Array(n);
  let polishField = null;
  const wear = worn ? noiseField(w, h, 3, t.seed + 5, 4) : null, pits = worn ? noiseField(w, h, Math.round(w / 6), t.seed + 6, 2, false, 1.6) : null;
  if (worn) polishField = new Float32Array(n);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      if (worn) {
        // decades of tyres ground the raised work down to the plate: a few tenths of a millimetre are left in the
        // middle, a little more near the rim, and the whole face is polished
        const rr = Math.hypot((x + 0.5) / k - c, (y + 0.5) / k - c) / rPlate;
        const keep = sat(0.04 + 0.66 * wear[i] * wear[i] + 0.3 * rr ** 4), pit = sstep(0.84, 0.93, pits[i]) * bPlate[i];
        H[i] = -mix(0.35, 2.6, keep) * bPlate[i] * (1 - bRaised[i]) - 0.5 * pit;
        polishField[i] = sat(0.74 + 0.26 * bRaised[i] - 0.35 * pit) * (1 - sat(bGap[i] * 2)) * mix(0.6, 1, plateM[i]);
      } else H[i] = -5 * bPlate[i] + 5 * bRaised[i];
      H[i] += -7 * bGap[i] - 14 * bHole[i] - 3 * (1 - bOut[i]);
      polishMul[i] = mix(0.55, 1, plateM[i]);
      rustBias[i] = nearGap[i] * 2.2 + (1 - plateM[i]) * 0.25;
      dirtBias[i] = bGap[i] * 1.5;
    }
  }
  return finish(t, { H, cover, voidM: holesM, mat: worn ? IRON_WORN : mat, polish: worn ? [-2, -0.3] : [-3.2, -0.6], polishField, polishMul: worn ? null : polishMul, rustBias, dirtBias, strength: worn ? 2 : strength });
}

// The pair of pick slots cut in the lettering band at 3 and 9 o'clock, each with a raised lip
function pickSlots(c, r) {
  let raised = '', holes = '';
  for (const s of [-1, 1]) {
    const x = c + s * r;
    raised += rectS(x - 16, c - 29, 32, 58, 10, BLACK) + rectS(x - 13, c - 26, 26, 52, 9, 'fill="none" stroke="#fff" stroke-width="6"');
    holes += rectS(x - 9, c - 22, 18, 44, 7);
  }
  return { raised, holes };
}

function manhole(t, kind) {
  const c = 500;
  let raised = ringS(c, c, 354, 379), holes = '';
  if (kind === 'sewer') {
    // a field of small squares, a name plate across the middle, two pick holes inside the field
    raised += ringS(c, c, 266, 276);
    for (let j = -9; j <= 9; j++) {
      for (let i = -9; i <= 9; i++) {
        const dx = Math.abs(i * 30), dy = Math.abs(j * 30);
        if (Math.hypot(dx + 8.5, dy + 8.5) > 259) continue;
        if (dx < 178 && dy < 68) continue;
        if (Math.hypot(dx - 213, dy) < 44) continue;
        raised += rectS(c + i * 30 - 8.5, c + j * 30 - 8.5, 17, 17, 2);
      }
    }
    raised += rectS(c - 160, c - 52, 320, 104, 12, 'fill="none" stroke="#fff" stroke-width="7"');
    raised += textLine('SEWER', { x: c, y: c, cap: 64, weight: 1.3 });
    for (const s of [-1, 1]) {
      raised += rectS(c + s * 213 - 15, c - 28, 30, 56, 14, 'fill="none" stroke="#fff" stroke-width="7"');
      holes += rectS(c + s * 213 - 9, c - 22, 18, 44, 9);
      raised += circ(c + s * 315, c, 9);
    }
    raised += arcText('HAUTURIER FOUNDRY', { cx: c, cy: c, r: 290, cap: 50 });
    raised += arcText('MADE IN USA', { cx: c, cy: c, r: 340, cap: 50, bottom: true });
  } else if (kind === 'power') {
    // a waffle of raised diamonds around a boss stamped with a lightning bolt
    raised += ringS(c, c, 262, 272);
    for (let j = -9; j <= 9; j++) {
      for (let i = -9; i <= 9; i++) {
        const x = ((i + j) * 44) / Math.SQRT2, y = ((i - j) * 44) / Math.SQRT2, d = Math.hypot(x, y), q = 21.5;
        if (d + q > 256 || d - q < 90) continue;
        raised += poly([[c + x - q, c + y], [c + x, c + y - q], [c + x + q, c + y], [c + x, c + y + q]]);
      }
    }
    raised += ringS(c, c, 66, 80);
    raised += poly([[8, -50], [-26, 6], [-4, 6], [-12, 50], [28, -12], [5, -12], [22, -50]].map(([x, y]) => [c + x, c + y]));
    const p = pickSlots(c, 311);
    raised += arcText('ELECTRIC', { cx: c, cy: c, r: 286, cap: 52, gap: 2.2 }) + arcText('VALMONT POWER CO', { cx: c, cy: c, r: 338, cap: 52, bottom: true }) + p.raised;
    holes += p.holes;
  } else if (kind === 'steam') {
    // sunburst ribs from a hub, two rings of vent holes between them
    raised += ringS(c, c, 264, 274);
    for (let i = 0; i < 20; i++) {
      const a = (i * TAU) / 20, ca = Math.cos(a), sa = Math.sin(a), at = (r, o) => [c + ca * r - sa * o, c + sa * r + ca * o];
      raised += poly([at(60, -5), at(258, -9.5), at(258, 9.5), at(60, 5)]);
      const b = ((i + 0.5) * TAU) / 20;
      raised += ringS(c + Math.cos(b) * 205, c + Math.sin(b) * 205, 12, 18);
      holes += circ(c + Math.cos(b) * 205, c + Math.sin(b) * 205, 12.5) + circ(c + Math.cos(b) * 128, c + Math.sin(b) * 128, 7.5);
    }
    raised += circ(c, c, 64) + ringS(c, c, 36, 45, '', '#000') + circ(c, c, 14, BLACK);
    const p = pickSlots(c, 311);
    raised += arcText('STEAM', { cx: c, cy: c, r: 288, cap: 50, gap: 2.4 }) + arcText('BRISANT STEAM CO', { cx: c, cy: c, r: 338, cap: 50, bottom: true }) + p.raised;
    holes += p.holes;
  } else {
    // the old one: rings of radial lugs, a foundry name and a year nobody can quite read any more
    raised += ringS(c, c, 262, 272) + ringS(c, c, 22, 34) + circ(c, c, 10);
    for (const r of [70, 112, 154, 196, 238]) {
      const count = Math.round((TAU * r) / 36);
      for (let i = 0; i < count; i++) raised += rectS(c + r - 14, c - 7.5, 28, 15, 4, `transform="rotate(${n2((i * 360) / count)} ${c} ${c})"`);
    }
    const p = pickSlots(c, 311);
    raised += arcText('CORSAIRE IRON WORKS', { cx: c, cy: c, r: 288, cap: 50 }) + arcText('SEWER 1928', { cx: c, cy: c, r: 338, cap: 50, bottom: true, gap: 1.6 }) + p.raised;
    holes += p.holes;
  }
  return roundCover(t, { mm: 1000, rOut: 430, rPlate: 379, gap: 6.5, raised, holes, worn: kind === 'worn' });
}

function valveCap(t, word) {
  const c = 150, long = word.length > 3, cap = long ? 34 : 50, yb = cap / 2 + 11;
  let raised = ringS(c, c, 83, 95) + textLine(word, { x: c, y: c, cap, weight: long ? 1.25 : 1.35, gap: 0.95 });
  for (const s of [-1, 1]) {
    raised += rectS(c - 52, c + s * yb - 2.5, 104, 5, 2.5);
    raised += circ(c - 20, c + s * (yb + 17), 4.5) + circ(c, c + s * (yb + 20), 4.5) + circ(c + 20, c + s * (yb + 17), 4.5);
  }
  const holes = circ(c - 89, c, 6.5) + circ(c + 89, c, 6.5);
  return roundCover(t, { mm: 300, rOut: 120, rPlate: 95, gap: 4.5, raised, holes, strength: 1.2 });
}

// ---------------------------------------------------------------------------------------------------------------------
// Steel plate covers

const mitres = (W, Hh, f) => lineS(0, 0, f, f, 3) + lineS(W, 0, W - f, f, 3) + lineS(0, Hh, f, Hh - f, 3) + lineS(W, Hh, W - f, Hh - f, 3);

async function vaultPlate(t) {
  const W = 1300, Hh = 900, { w, h } = t, n = w * h, k = w / W, L = (b) => raster(w, h, W, Hh, b);
  const fw = 36, gp = 5, x0 = fw + gp, y0 = fw + gp, x1 = W - fw - gp, y1 = Hh - fw - gp, sx = W / 2;
  const frame = rectS(0, 0, W, Hh, 6) + rectS(fw, fw, W - 2 * fw, Hh - 2 * fw, 2, BLACK);
  const leaves = rectS(x0, y0, sx - 2.5 - x0, y1 - y0, 3) + rectS(sx + 2.5, y0, x1 - sx - 2.5, y1 - y0, 3);
  const slots = [[sx - 80, 230], [sx - 80, 670], [sx + 80, 230], [sx + 80, 670]];
  const bolts = [[x0 + 32, y0 + 32], [x0 + 32, y1 - 32], [x1 - 32, y0 + 32], [x1 - 32, y1 - 32], [x0 + 32, Hh / 2], [x1 - 32, Hh / 2]];
  const keep = (x, y) => ((x > x0 + 20 && x < sx - 22) || (x > sx + 22 && x < x1 - 20)) && y > y0 + 20 && y < y1 - 20
    && slots.every(([a, b]) => Math.abs(x - a) > 46 || Math.abs(y - b) > 30) && bolts.every(([a, b]) => Math.hypot(x - a, y - b) > 31);
  const lugs = treadLugs(x0, y0, x1, y1, 27, 33, 10, keep);
  const holesSvg = slots.map(([a, b]) => rectS(a - 23, b - 8, 46, 16, 8)).join('');
  const boltSvg = bolts.map(([a, b], i) => hexS(a, b, 12, i)).join('');
  const frameM = await L(frame), leafM = await L(leaves), holesM = await L(holesSvg);
  const H = new Float32Array(n).fill(-9), gaps = new Float32Array(n);
  add(H, bevel(frameM, w, h, 0.8), 9);
  add(H, bevel(leafM, w, h, 0.8), 7.5);
  add(H, bevel(await L(lugs), w, h, 0.75), 2.4);
  add(H, bevel(await L(boltSvg), w, h, 0.9), 3);
  add(H, bevel(holesM, w, h, 0.9), -10);
  add(H, blur(await L(mitres(W, Hh, fw)), w, h, 0.7), -2.5);
  for (let i = 0; i < n; i++) gaps[i] = sat(1 - frameM[i] - leafM[i]);
  const near = blur(gaps, w, h, 9 * k + 2), tight = blur(gaps, w, h, 0.8);
  const rustBias = new Float32Array(n), dirtBias = new Float32Array(n);
  for (let i = 0; i < n; i++) { rustBias[i] = near[i] * 3.2; dirtBias[i] = tight[i] * 1.4; }
  return finish(t, { H, cover: await coverRect(t, W, Hh, 6), voidM: holesM, mat: STEEL, polish: [-0.9, 0.6], rustBias, dirtBias, strength: 1.7, gum: 3 });
}

async function cellarDoor(t) {
  const W = 1500, Hh = 1900, { w, h } = t, n = w * h, k = w / W, L = (b) => raster(w, h, W, Hh, b);
  const fw = 46, gp = 6, x0 = fw + gp, y0 = fw + gp, x1 = W - fw - gp, y1 = Hh - fw - gp, sx = W / 2;
  const frame = rectS(0, 0, W, Hh, 8) + rectS(fw, fw, W - 2 * fw, Hh - 2 * fw, 2, BLACK);
  const leaves = rectS(x0, y0, sx - 4 - x0, y1 - y0, 3) + rectS(sx + 4, y0, x1 - sx - 4, y1 - y0, 3);
  // the right leaf carries a flat bar that laps over the seam
  const barX = sx - 12, barW = 62, bar = rectS(barX, y0 + 8, barW, y1 - y0 - 16, 3);
  const hingeY = [330, 950, 1570], ring = [600, 990];
  let barrels = '', straps = '', heads = '', cuts = '';
  for (const y of hingeY) {
    for (const s of [-1, 1]) {
      const bx = s < 0 ? x0 - gp / 2 : x1 + gp / 2;
      barrels += rectS(bx - 13, y - 66, 26, 132, 9);
      cuts += lineS(bx - 15, y - 22, bx + 15, y - 22, 3.5) + lineS(bx - 15, y + 22, bx + 15, y + 22, 3.5);
      straps += rectS(s < 0 ? bx + 6 : bx - 6 - 124, y - 30, 124, 60, 5);
      for (const d of [44, 96]) heads += circ(bx - s * d, y, 8.5);
    }
  }
  for (let y = y0 + 70; y < y1 - 40; y += 172) heads += circ(barX + barW / 2 + 6, y, 9);
  const keep = (x, y) => {
    if (y < y0 + 36 || y > y1 - 36) return false;
    if (!((x > x0 + 36 && x < barX - 16) || (x > barX + barW + 16 && x < x1 - 36))) return false;
    if (Math.hypot(x - ring[0], y - ring[1]) < 86) return false;
    return hingeY.every((hy) => Math.abs(y - hy) > 48 || (x > x0 + 150 && x < x1 - 150));
  };
  const lugs = treadLugs(x0, y0, x1, y1, 34, 42, 13, keep);
  const cup = circ(ring[0], ring[1], 64), pull = ringS(ring[0], ring[1], 33, 46), staple = rectS(ring[0] - 16, ring[1] - 52, 32, 20, 4);
  const frameM = await L(frame), leafM = await L(leaves);
  const H = new Float32Array(n).fill(-9), gaps = new Float32Array(n);
  add(H, bevel(frameM, w, h, 0.8), 9);
  add(H, bevel(leafM, w, h, 0.8), 7);
  add(H, bevel(await L(lugs), w, h, 0.75), 2.6);
  add(H, bevel(await L(bar), w, h, 0.9), 3.5);
  add(H, bevel(await L(straps), w, h, 0.9), 2.4);
  add(H, bevel(await L(heads), w, h, 1.3, 0.1, 0.9), 2.6);
  add(H, bevel(await L(barrels), w, h, 2.2, 0.08, 0.95), 9);
  add(H, blur(await L(cuts), w, h, 0.6), -3);
  add(H, bevel(await L(cup), w, h, 1.6), -6.5);
  add(H, bevel(await L(pull), w, h, 1.6, 0.1, 0.9), 5.5);
  add(H, bevel(await L(staple), w, h, 0.9), 6.5);
  add(H, blur(await L(mitres(W, Hh, fw)), w, h, 0.7), -2.5);
  for (let i = 0; i < n; i++) gaps[i] = sat(1 - frameM[i] - leafM[i]);
  const near = blur(gaps, w, h, 12 * k + 3), tight = blur(gaps, w, h, 0.8), cupM = blur(await L(cup), w, h, 1.5);
  const rustBias = new Float32Array(n), dirtBias = new Float32Array(n);
  for (let i = 0; i < n; i++) { rustBias[i] = near[i] * 3.4; dirtBias[i] = tight[i] * 1.4 + cupM[i] * 0.45; }
  return finish(t, { H, cover: await coverRect(t, W, Hh, 8), mat: STEEL, polish: [-1.2, 0.6], rustBias, dirtBias, strength: 1.8, gum: 6 });
}

// ---------------------------------------------------------------------------------------------------------------------
// Grates

async function stormGrate(t) {
  const W = 950, Hh = 600, { w, h } = t, n = w * h, k = w / W, L = (b) => raster(w, h, W, Hh, b), R = rng(t.seed);
  const fw = 46, gp = 5, gx0 = fw + gp, gy0 = fw + gp, gw = W - 2 * gx0, gh = Hh - 2 * gy0, rim = 20;
  const frame = rectS(0, 0, W, Hh, 8) + rectS(fw, fw, W - 2 * fw, Hh - 2 * fw, 4, BLACK);
  const cols = 12, rows = 3, cross = 20, pitch = (gw - 2 * rim + 30) / cols, ow = pitch - 30, oh = (gh - 2 * rim - (rows - 1) * cross) / rows;
  let open = '', crossBars = '';
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) open += rectS(gx0 + rim + i * pitch, gy0 + rim + j * (oh + cross), ow, oh, 10);
  for (let j = 1; j < rows; j++) crossBars += rectS(gx0 + rim, gy0 + rim + j * (oh + cross) - cross, gw - 2 * rim, cross);
  const frameM = await L(frame), grateM = await L(rectS(gx0, gy0, gw, gh, 6)), openM = await L(open);
  const iron = new Float32Array(n), gaps = new Float32Array(n);
  for (let i = 0; i < n; i++) { iron[i] = sat(grateM[i] - openM[i]); gaps[i] = sat(1 - frameM[i] - grateM[i]); }
  const H = new Float32Array(n).fill(-9);
  add(H, bevel(frameM, w, h, 0.8), 9);
  add(H, bevel(grateM, w, h, 0.8), 9);
  const round = bevel(iron, w, h, 3.2, 0.3, 0.92); // bars are rounded on top
  for (let i = 0; i < n; i++) H[i] -= 4.5 * (1 - round[i]) * grateM[i];
  add(H, bevel(await L(crossBars), w, h, 1.2), -3);
  add(H, bevel(openM, w, h, 0.9), -14);
  // what the last rain left at the upstream end: packed dirt between the bars, and leaves on top
  const dn = noiseField(w, h, 9, t.seed + 3, 4), fill = new Float32Array(n), dirtBias = new Float32Array(n), dirtCol = new Float32Array(n * 3);
  const lumps = noiseField(w, h, 60, t.seed + 4, 3);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const D = 1.5 - ((x + 0.5) / k - gx0) / 170 + (dn[i] - 0.5) * 1.6, mud = sstep(0.8, 1.3, D + (lumps[i] - 0.5) * 0.5) * grateM[i];
      fill[i] = Math.max(sstep(0.35, 0.7, D) * openM[i], mud); // packed between the bars, and over them at the very end
      dirtBias[i] = sat(D - 0.15) * 0.75;
      H[i] += sstep(0.35, 0.7, D) * openM[i] * (9.5 + lumps[i] * 3.5) + mud * (1 + lumps[i] * 2.5) * (1 - openM[i]) + mud * openM[i] * 5;
      const q = 0.8 + 0.4 * lumps[i];
      dirtCol[i * 3] = 60 * q; dirtCol[i * 3 + 1] = 50 * q; dirtCol[i * 3 + 2] = 39 * q;
    }
  }
  const hues = [[88, 64, 36], [104, 80, 42], [66, 48, 30], [112, 90, 52], [90, 56, 34], [54, 42, 30], [78, 66, 38]]; // from wet and rotting to dry ochre
  let leafShape = '', leafPaint = '';
  for (let i = 0; i < 52; i++) {
    const far = i >= 44, x = far ? gx0 + 200 + R() * (gw - 220) : gx0 + 6 + Math.min(280, -Math.log(1 - R() * 0.97) * 90), y = gy0 + 12 + R() * (gh - 24);
    const len = 24 + R() * 38, wid = len * (0.28 + R() * 0.3), rot = R() * 360, l = n2(len / 2), bend = n2((R() - 0.5) * len * 0.5), tf = `transform="translate(${n2(x)} ${n2(y)}) rotate(${n2(rot)})"`;
    const tint = 0.85 + R() * 0.3, [r, g, b] = hues[Math.floor(R() * hues.length)].map((v) => Math.round(v * tint));
    const d = `M${-l} 0Q${bend} ${n2(-wid)} ${l} 0Q${n2(-bend)} ${n2(wid)} ${-l} 0Z`, stem = `M${n2(-len * 0.72)} ${n2(len * 0.06)}L${l} 0`;
    leafShape += `<path d="${d}" ${tf}/><path d="${stem}" stroke="#fff" stroke-width="1.8" ${tf}/>`;
    leafPaint += `<path d="${d}" fill="rgb(${r},${g},${b})" ${tf}/><path d="${stem}" stroke="rgb(${Math.round(r * 0.6)},${Math.round(g * 0.6)},${Math.round(b * 0.6)})" stroke-width="1.8" ${tf}/>`;
  }
  // (painted over a leaf-brown ground, so that the soft edge of a leaf does not darken towards black)
  const leafM = await L(leafShape), leafCol = await raster(w, h, W, Hh, rectS(0, 0, W, Hh, 0, 'fill="rgb(84,64,38)"') + leafPaint, 3);
  add(H, bevel(leafM, w, h, 1.1), 1.6);
  const voidM = new Float32Array(n);
  for (let i = 0; i < n; i++) voidM[i] = openM[i] * (1 - fill[i]) * (1 - leafM[i]);
  const near = blur(gaps, w, h, 8 * k + 2), tight = blur(gaps, w, h, 0.8), rustBias = new Float32Array(n);
  for (let i = 0; i < n; i++) { rustBias[i] = near[i] * 2.4; dirtBias[i] += tight[i] * 1.4; }
  return finish(t, {
    H, cover: await coverRect(t, W, Hh, 8), voidM, mat: IRON, polish: [-3, -0.5], rustBias, dirtBias, strength: 1.4,
    overlays: [{ mask: fill, col: dirtCol, rough: 0.97 }, { mask: leafM, col: leafCol, rough: 0.95 }]
  });
}

// Steel bar grating over the subway: tiles sideways, so every pattern and every noise here wraps along x
async function subwayGrate(t) {
  const W = 1600, Hh = 1200, { w, h } = t, n = w * h, L = (b) => raster(w, h, W, Hh, b);
  const fr = 38, top = 46, bot = Hh - 46;
  const frame = rectS(-5, -5, W + 10, fr + 5) + rectS(-5, Hh - fr, W + 10, fr + 5);
  let bars = rectS(-5, 42, W + 10, 10) + rectS(-5, Hh - 52, W + 10, 10), cross = '';
  for (let i = 0; i < 50; i++) bars += rectS(16 + i * 32 - 4.5, top, 9, bot - top);
  for (const x of [400, 1200]) bars += rectS(x - 16, top, 14, bot - top) + rectS(x + 2, top, 14, bot - top); // where two panels meet
  for (let j = 1; j <= 6; j++) cross += rectS(-5, 52 + (1096 * j) / 7 - 4, W + 10, 8);
  const gum = [[530, 19, 13], [1010, 640, 18], [262, 930, 12], [1385, 1182, 10]];
  const gumSvg = gum.map(([x, y, r]) => circ(x, y, r)).join('');
  const frameM = await L(frame), barM = await L(bars), crossM = await L(cross), gumM = blur(await L(gumSvg), w, h, 0.8, true);
  const iron = new Float32Array(n), voidM = new Float32Array(n);
  for (let i = 0; i < n; i++) { iron[i] = sat(frameM[i] + barM[i] + crossM[i] + gumM[i]); voidM[i] = 1 - iron[i]; }
  const H = new Float32Array(n).fill(-12);
  add(H, bevel(iron, w, h, 0.7, 0.18, 0.82, true), 12);
  const lowCross = new Float32Array(n);
  for (let i = 0; i < n; i++) lowCross[i] = crossM[i] * (1 - barM[i]) * (1 - frameM[i]);
  add(H, blur(lowCross, w, h, 0.7, true), -1.6);
  add(H, bevel(gumM, w, h, 2, 0.1, 0.9, true), 1.4);
  const cover = new Float32Array(n).fill(1);
  for (let x = 0; x < w; x++) { cover[x] = cover[(h - 1) * w + x] = 0.35; cover[w + x] = cover[(h - 2) * w + x] = 0.85; }
  const nearFrame = blur(frameM, w, h, 6, true), rustBias = new Float32Array(n);
  for (let i = 0; i < n; i++) rustBias[i] = nearFrame[i] * (1 - frameM[i]) * 1.6 + frameM[i] * 0.35;
  return finish(t, {
    H, cover, voidM, mat: { ...STEEL, top: [108, 104, 98] }, polish: [-2.6, -0.3], rustBias, strength: 1.3, wrapX: true,
    overlays: [{ mask: gumM, col: [44, 42, 41], rough: 0.95 }]
  });
}

async function treeGrate(t) {
  const W = 1500, c = 750, { w, h } = t, n = w * h, k = w / W, L = (b) => raster(w, h, W, W, b);
  let slots = '';
  const slot = (a, r0, r1) => { slots += `<path d="M${n2(c + Math.cos(a) * (r0 + 9))} ${n2(c + Math.sin(a) * (r0 + 9))}L${n2(c + Math.cos(a) * (r1 - 9))} ${n2(c + Math.sin(a) * (r1 - 9))}"/>`; };
  for (const [r0, r1, count] of [[315, 455, 44], [482, 640, 64]]) for (let i = 0; i < count; i++) slot(((i + 0.5) * TAU) / count, r0, r1);
  for (let i = 0; i < 92; i++) { // the corners: slots run on until they meet the square border
    const a = ((i + 0.5) * TAU) / 92, r1 = Math.min(1010, 704 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))));
    if (r1 - 667 > 52) slot(a, 667, r1);
  }
  const pads = [187, 365, 1135, 1313];
  const slotSvg = `<g fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round">${slots}</g>` + pads.map((y) => rectS(c - 34, y - 19, 68, 38, 5, BLACK)).join('');
  const outline = rectS(0.7 / k, 0.7 / k, W - 1.4 / k, W - 1.4 / k, 10) + circ(c, c, 250, BLACK);
  const cover = blur(await L(outline), w, h, 0.5), slotM = await L(slotSvg), body = await L(rectS(0, 0, W, W, 10) + circ(c, c, 250, BLACK));
  const iron = new Float32Array(n);
  for (let i = 0; i < n; i++) iron[i] = sat(body[i] - slotM[i]);
  const H = new Float32Array(n).fill(-12);
  add(H, bevel(iron, w, h, 0.9), 12);
  const round = bevel(iron, w, h, 3, 0.3, 0.95);
  for (let i = 0; i < n; i++) H[i] -= 3 * (1 - round[i]) * body[i];
  add(H, bevel(await L(ringS(c, c, 256, 290)), w, h, 1.8, 0.1, 0.9), 3);
  add(H, bevel(await L(pads.map((y) => hexS(c, y, 11)).join('')), w, h, 0.9), 3);
  const seam = await L(lineS(c, 0, c, c - 250, 5) + lineS(c, c + 250, c, W, 5));
  add(H, blur(seam, w, h, 0.7), -5);
  // soil works its way up through the slots, mostly around the trunk
  const sn = noiseField(w, h, 8, t.seed + 3, 4), lumps = noiseField(w, h, 70, t.seed + 4, 3);
  const fill = new Float32Array(n), soil = new Float32Array(n * 3), voidM = new Float32Array(n), dirtBias = new Float32Array(n), rustBias = new Float32Array(n);
  const nearSeam = blur(seam, w, h, 5);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const r = Math.hypot((x + 0.5) / k - c, (y + 0.5) / k - c), D = (sn[i] - 0.5) * 2.2 + 0.75 - (r - 250) / 420;
      fill[i] = sstep(0.3, 0.7, D) * slotM[i];
      voidM[i] = slotM[i] * (1 - fill[i]);
      H[i] += fill[i] * (8 + lumps[i] * 3);
      const q = 0.8 + 0.4 * lumps[i];
      soil[i * 3] = 54 * q; soil[i * 3 + 1] = 43 * q; soil[i * 3 + 2] = 32 * q;
      dirtBias[i] = sat(D - 0.2) * 0.3 * lumps[i] + seam[i];
      rustBias[i] = nearSeam[i] * 1.5 + (1 - sstep(250, 300, r)) * 0.6;
    }
  }
  return finish(t, {
    H, cover, voidM, mat: { ...IRON_RUSTY, top: [90, 84, 78] }, polish: [-2.6, -0.4], rustBias, dirtBias, strength: 1.5, voidCol: [17, 14, 11],
    overlays: [{ mask: fill, col: soil, rough: 0.97 }]
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Small covers and the tactile pad

async function handhole(t) {
  const W = 500, Hh = 350, { w, h } = t, n = w * h, k = w / W, L = (b) => raster(w, h, W, Hh, b);
  const fw = 26, gp = 4, x0 = fw + gp, y0 = fw + gp, cw = W - 2 * x0, ch = Hh - 2 * y0;
  const frame = rectS(0, 0, W, Hh, 10) + rectS(fw, fw, W - 2 * fw, Hh - 2 * fw, 14, BLACK);
  const lid = rectS(x0, y0, cw, ch, 12);
  let raised = rectS(x0 + 5, y0 + 5, cw - 10, ch - 10, 9, 'fill="none" stroke="#fff" stroke-width="10"'), holes = '';
  for (let j = 0; j < 14; j++) {
    for (let i = 0; i < 21; i++) {
      const x = W / 2 + (i - 10) * 20, y = Hh / 2 + (j - 6.5) * 20;
      if (x < x0 + 22 || x > W - x0 - 22 || y < y0 + 22 || y > Hh - y0 - 22) continue;
      if (Math.abs(x - W / 2) < 146 && Math.abs(y - Hh / 2) < 50) continue;
      if (Math.abs(Math.abs(x - W / 2) - 184) < 18 && Math.abs(y - Hh / 2) < 34) continue;
      raised += rectS(x - 5.5, y - 5.5, 11, 11, 1.5);
    }
  }
  raised += rectS(W / 2 - 134, Hh / 2 - 39, 268, 78, 9, 'fill="none" stroke="#fff" stroke-width="6"');
  raised += textLine('ELECTRIC', { x: W / 2, y: Hh / 2, cap: 44, weight: 1.3 });
  for (const s of [-1, 1]) {
    raised += rectS(W / 2 + s * 184 - 11, Hh / 2 - 25, 22, 50, 10, 'fill="none" stroke="#fff" stroke-width="5"');
    holes += rectS(W / 2 + s * 184 - 6, Hh / 2 - 19, 12, 38, 6);
  }
  const frameM = await L(frame), lidM = await L(lid), holesM = await L(holes), gaps = new Float32Array(n);
  const H = new Float32Array(n).fill(-8);
  add(H, bevel(frameM, w, h, 0.8), 8);
  add(H, bevel(lidM, w, h, 0.8), 3.5);
  add(H, bevel(await L(raised), w, h, 1.0), 4.5);
  add(H, bevel(holesM, w, h, 1), -12);
  for (let i = 0; i < n; i++) gaps[i] = sat(1 - frameM[i] - lidM[i]);
  const near = blur(gaps, w, h, 6 * k + 2), tight = blur(gaps, w, h, 0.8), rustBias = new Float32Array(n), dirtBias = new Float32Array(n);
  for (let i = 0; i < n; i++) { rustBias[i] = near[i] * 2.4; dirtBias[i] = tight[i] * 1.4; }
  return finish(t, { H, cover: await coverRect(t, W, Hh, 10), voidM: holesM, mat: IRON, polish: [-3, -0.5], rustBias, dirtBias, strength: 1.2 });
}

async function pullBox(t) {
  const W = 700, { w, h } = t, n = w * h, k = w / W, L = (b) => raster(w, h, W, W, b), c = W / 2;
  const fw = 44, gp = 5, x0 = fw + gp, cw = W - 2 * x0;
  const frame = rectS(0, 0, W, W, 12) + rectS(fw, fw, W - 2 * fw, W - 2 * fw, 16, BLACK);
  const lid = rectS(x0, x0, cw, cw, 13), bolts = [[108, c], [W - 108, c]], slotsAt = [[c, 112], [c, W - 112]];
  let studs = '';
  for (let j = 0; j < 30; j++) {
    for (let i = 0; i < 30; i++) {
      const x = x0 + 22 + i * 21 + (j % 2) * 10.5, y = x0 + 22 + j * 18.2;
      if (x > W - x0 - 20 || y > W - x0 - 20) continue;
      if (Math.abs(x - c) < 204 && Math.abs(y - c) < 68) continue;
      if (bolts.some(([a, b]) => Math.hypot(x - a, y - b) < 36) || slotsAt.some(([a, b]) => Math.abs(x - a) < 46 && Math.abs(y - b) < 22)) continue;
      studs += circ(x, y, 5.2);
    }
  }
  const plaque = rectS(c - 190, c - 55, 380, 110, 12), word = textLine('SIGNAL', { x: c, y: c, cap: 66, weight: 1.35 });
  const recess = bolts.map(([a, b]) => circ(a, b, 25)).join(''), heads = bolts.map(([a, b], i) => hexS(a, b, 15, i * 0.4)).join('');
  const holes = slotsAt.map(([a, b]) => rectS(a - 30, b - 8, 60, 16, 8)).join('');
  const frameM = await L(frame), lidM = await L(lid), holesM = await L(holes), headM = await L(heads), gaps = new Float32Array(n);
  const H = new Float32Array(n).fill(-8);
  add(H, bevel(frameM, w, h, 1.0), 8);
  add(H, bevel(lidM, w, h, 1.0), 7);
  add(H, bevel(await L(studs), w, h, 1.1, 0.1, 0.85), 1.9);
  add(H, bevel(await L(plaque), w, h, 1.0), -3);
  add(H, bevel(await L(word), w, h, 1.0), 3.6);
  add(H, bevel(await L(recess), w, h, 1.1), -5);
  add(H, bevel(headM, w, h, 0.9), 4.5);
  add(H, bevel(holesM, w, h, 1), -12);
  for (let i = 0; i < n; i++) gaps[i] = sat(1 - frameM[i] - lidM[i]);
  const tight = blur(gaps, w, h, 0.8), recM = blur(await L(recess), w, h, 1), dirtBias = new Float32Array(n);
  for (let i = 0; i < n; i++) dirtBias[i] = tight[i] * 1.4 + recM[i] * (1 - headM[i]) * 0.6;
  return finish(t, {
    H, cover: await coverRect(t, W, W, 12), voidM: holesM, mat: CONCRETE, polish: [-0.6, 0.9], dirtBias, strength: 1.5, gum: 2,
    overlays: [{ mask: blur(headM, w, h, 0.5), col: [104, 102, 98], rough: 0.45 }]
  });
}

async function tactilePad(t) {
  const W = 600, Hh = 1200, { w, h } = t, n = w * h, k = w / W, pitch = 50;
  const H = new Float32Array(n), screw = new Float32Array(n), anchors = [[50, 50], [550, 50], [50, 600], [550, 600], [50, 1150], [550, 1150]];
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const X = (x + 0.5) / k, Y = (y + 0.5) / k;
      const r = Math.hypot(X - (Math.floor(X / pitch) + 0.5) * pitch, Y - (Math.floor(Y / pitch) + 0.5) * pitch);
      let v = 5 * sstep(13.5, 6.5, r); // truncated dome: 27 mm at the base, 13 mm flat on top
      v -= 2.5 * (1 - sstep(0, 9, Math.min(X, Y, W - X, Hh - Y)));
      for (const [ax, ay] of anchors) {
        const d = Math.hypot(X - ax, Y - ay);
        if (d < 12) { v -= 1.6 * sstep(9.5, 6.5, d); screw[i] = sstep(7.5, 6, d); }
      }
      H[i] = v;
    }
  }
  return finish(t, {
    H, cover: await coverRect(t, W, Hh, 5), mat: TACTILE, polish: [1.5, 4.6], strength: 1.6, gum: 4,
    overlays: [{ mask: screw, col: [120, 118, 114], rough: 0.45 }]
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Road symbols: crisp masks, drawn in millimetres. Image up is the direction of travel.

const sym = (t, body) => raster(t.w, t.h, t.metres[0] * 1000, t.metres[1] * 1000, body);

const straightArrow = (cx, top, len, headW, headL) => poly([[cx, top], [cx + headW / 2, top + headL], [cx + 100, top + headL], [cx + 100, top + len], [cx - 100, top + len], [cx - 100, top + headL], [cx - headW / 2, top + headL]]);

// A shaft that comes up at x = sx (its left edge), bends left around (hx, cy) and ends in a head whose tip is at x = tip
function turnArrow(sxl, bottom, hx, tip, yMid, arm, headH, cy) {
  const sxr = sxl + 200, yu = yMid - arm / 2, yl = yMid + arm / 2;
  return `<path d="M${sxl} ${bottom}V${cy}A${sxl - hx} ${cy - yl} 0 0 0 ${hx} ${yl}V${yMid + headH / 2}L${tip} ${yMid}L${hx} ${yMid - headH / 2}V${yu}A${sxr - hx} ${cy - yu} 0 0 1 ${sxr} ${cy}V${bottom}Z"/>`;
}

function roadWord(t, word, gap = 1.25) {
  const W = t.metres[0] * 1000, Hh = t.metres[1] * 1000, weight = 1.3, tall = 1.55, m = 12;
  const { total } = layoutWord(word, weight, gap), uy = (Hh - 2 * m) / (7 * tall + weight);
  return sym(t, textLine(word, { x: W / 2, y: Hh / 2, cap: Hh - 2 * m, weight, gap, tall, wide: (W - 2 * m) / total / uy }));
}

function bikeSymbol(t) {
  // drawn in a box half as tall, then stretched lengthwise like every symbol meant to be read from a saddle or a seat
  const st = (w, b, round = true) => `<g fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="${round ? 'round' : 'butt'}" stroke-linejoin="round">${b}</g>`;
  let s = st(42, circ(250, 660, 180) + circ(720, 660, 180));
  s += st(36, '<path d="M720 660L505 660L580 395L720 660M580 395L318 410L505 660M318 410L250 660M318 410L300 340L250 338"/>');
  s += st(44, '<path d="M530 372H640"/>');
  s += circ(398, 112, 72);
  s += st(82, '<path d="M585 318L440 208"/>');
  s += st(46, '<path d="M430 222L372 300L290 334"/>');
  s += st(56, '<path d="M585 322L452 470L505 650"/>');
  return sym(t, `<g transform="translate(15 0) scale(1 2)">${s}</g>`);
}

function chevrons(t) {
  const one = (y) => poly([[500, y], [945, y + 440], [945, y + 670], [500, y + 230], [55, y + 670], [55, y + 440]]);
  return sym(t, one(28) + one(700));
}

function hatch(t) {
  // one stripe per metre at 45 degrees; the tile repeats in both directions
  let s = '';
  for (const x of [-628, 372, 1372]) s += poly([[x, 1000], [x + 255, 1000], [x + 1255, 0], [x + 1000, 0]]);
  return sym(t, s);
}

const mirror = (m, w, h) => { const o = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = m[y * w + w - 1 - x]; return o; };

// ---------------------------------------------------------------------------------------------------------------------
// Stains: soft masks with life inside, fading to nothing before the edge of their tile

function fadeBorder(F, w, h, m) {
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) F[i] *= sstep(0, m, Math.min(x, w - 1 - x) + 0.5) * sstep(0, m, Math.min(y, h - 1 - y) + 0.5);
  return F;
}

// One blot of liquid: an irregular pool, darker at its rim, optionally sitting in the paler ring it soaked into the road
function blot(F, w, h, cx, cy, r, amp, seed, { warp = 0.25, freq = 2.2, edge = 0.25, halo = 0, haloR = 1.8, rim = 0, ry = r } = {}) {
  const ext = Math.max(r, ry) * (halo > 0 ? haloR : 1) * (1 + warp * 1.3) + 2;
  const xa = Math.max(0, Math.floor(cx - ext)), xb = Math.min(w - 1, Math.ceil(cx + ext)), ya = Math.max(0, Math.floor(cy - ext)), yb = Math.min(h - 1, Math.ceil(cy + ext));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const dx = (x - cx) / r, dy = (y - cy) / ry, d = Math.hypot(dx, dy);
      const dd = d * (1 + warp * 2.4 * (fbm(dx * freq + 31.7, dy * freq - 12.3, seed, 3) - 0.5));
      let v = amp * (1 - sstep(1 - edge, 1, dd)) * (1 - rim * (1 - sstep(0.35, 0.92, dd)));
      v *= 0.84 + 0.32 * fbm(x * 0.23, y * 0.23, seed + 5, 2);
      if (halo > 0) {
        const hd = (d * (1 + warp * 1.8 * (fbm(dx * freq * 0.7 - 5.1, dy * freq * 0.7 + 9.4, seed + 9, 3) - 0.5))) / haloR;
        v = Math.max(v, amp * halo * (1 - sstep(0.4, 1, hd)) * (0.7 + 0.6 * fbm(x * 0.11, y * 0.11, seed + 13, 3)));
      }
      const i = y * w + x;
      F[i] = 1 - (1 - F[i]) * (1 - sat(v));
    }
  }
}

function oilStain(t, kind) {
  const { w, h } = t, F = new Float32Array(w * h), R = rng(t.seed), px = w / t.metres[0], s = t.seed;
  const drips = (count, cx, cy, spread, rMax) => {
    for (let i = 0; i < count; i++) {
      const [gx, gy] = gauss(R), r = (0.005 + rMax * R() ** 2.2) * px;
      blot(F, w, h, (cx + gx * spread) * w, (cy + gy * spread) * h, r, 0.55 + 0.45 * R(), s + i * 7, { warp: 0.12, edge: Math.min(0.6, 1.4 / r + 0.15), halo: R() < 0.4 ? 0.22 : 0, haloR: 2 });
    }
  };
  if (kind === 'a') { // where a car is parked every night: a cluster of drips, old and new
    blot(F, w, h, 0.46 * w, 0.53 * h, 0.07 * px, 0.9, s + 900, { warp: 0.3, rim: 0.3, halo: 0.3, haloR: 2.1 });
    blot(F, w, h, 0.6 * w, 0.4 * h, 0.045 * px, 0.8, s + 901, { warp: 0.3, rim: 0.3, halo: 0.28, haloR: 2 });
    blot(F, w, h, 0.37 * w, 0.36 * h, 0.03 * px, 0.7, s + 902, { warp: 0.3, rim: 0.2, halo: 0.25, haloR: 2 });
    drips(64, 0.5, 0.5, 0.16, 0.024);
    drips(22, 0.6, 0.4, 0.09, 0.018);
  } else if (kind === 'b') { // a real leak: a pooled blot in the wide halo it soaked into the asphalt
    blot(F, w, h, 0.5 * w, 0.5 * h, 0.2 * px, 0.95, s + 900, { warp: 0.32, freq: 1.8, edge: 0.12, rim: 0.22, halo: 0.34, haloR: 1.75 });
    blot(F, w, h, 0.56 * w, 0.44 * h, 0.09 * px, 1, s + 901, { warp: 0.3, edge: 0.3 });
    drips(16, 0.5, 0.5, 0.2, 0.014);
  } else { // a pool that tyres dragged forward, up the image
    blot(F, w, h, 0.46 * w, 0.62 * h, 0.12 * px, 0.9, s + 900, { warp: 0.35, edge: 0.15, rim: 0.25, halo: 0.3, haloR: 1.9 });
    blot(F, w, h, 0.57 * w, 0.52 * h, 0.085 * px, 0.85, s + 901, { warp: 0.35, edge: 0.2, rim: 0.2, halo: 0.25, haloR: 1.8 });
    for (let i = 0; i < 2; i++) {
      const x0 = (0.4 + i * 0.16) * w, sw = (0.035 + 0.01 * i) * px;
      for (let y = Math.floor(0.14 * h); y < 0.7 * h; y++) {
        const f = Math.abs(0.62 * h - y) / (y > 0.62 * h ? 0.08 * h : 0.48 * h), cx = x0 + Math.sin(y * 0.05 + i) * 2;
        for (let x = Math.floor(cx - sw * 2); x <= cx + sw * 2; x++) {
          if (x < 0 || x >= w) continue;
          const d = Math.abs(x - cx) / sw, v = 0.42 * (1 - f) ** 1.5 * (1 - sstep(0.5, 1.2, d)) * (0.5 + fbm(x * 0.9, y * 0.06, s + 40 + i, 3));
          F[y * w + x] = 1 - (1 - F[y * w + x]) * (1 - sat(v));
        }
      }
    }
    drips(18, 0.52, 0.56, 0.16, 0.013);
  }
  return fadeBorder(F, w, h, 0.07 * px);
}

function oilTrail(t) {
  const { w, h } = t, F = new Float32Array(w * h), R = rng(t.seed), px = w / t.metres[0], py = h / t.metres[1];
  let s = 0.12, i = 0;
  while (s < t.metres[1] - 0.12) { // a car losing oil as it drives off: drops stretched along the way, never quite in line
    const x = 0.3 + 0.07 * Math.sin(s * 2.3 + 1) + (R() - 0.5) * 0.09, r = 0.009 + 0.022 * R() ** 1.6;
    blot(F, w, h, x * px, h - s * py, r * px, 0.65 + 0.35 * R(), t.seed + i * 5, { warp: 0.15, edge: 0.4, ry: r * py * (1.2 + R() * 1.4), halo: R() < 0.3 ? 0.2 : 0, haloR: 2 });
    if (R() < 0.45) blot(F, w, h, (x + (R() - 0.5) * 0.07) * px, h - (s + 0.04 + R() * 0.05) * py, 0.007 * px, 0.7, t.seed + i * 5 + 1, { warp: 0.1, edge: 0.6 });
    s += 0.06 + R() * 0.17;
    i++;
  }
  return fadeBorder(F, w, h, 0.05 * px);
}

// Rubber laid down by spinning rear wheels: the car is at the bottom of the image and leaves upwards, fishtailing
function burnout(t) {
  const { w, h } = t, F = new Float32Array(w * h), px = w / t.metres[0], py = h / t.metres[1], sd = t.seed;
  for (let y = 0; y < h; y++) {
    const s = (h - y - 0.5) / py; // metres travelled
    const env = sstep(0.06, 0.4, s) * (1 - sstep(2.3, 4.8, s + (fbm(s * 1.3, 0.5, sd, 3) - 0.5) * 1.6));
    const hop = 0.72 + 0.56 * fbm(s * 5, 3.1, sd + 1, 3);
    const wob = 0.14 * Math.sin(s * 1.15 + 0.4) * sstep(0.1, 1.6, s) + (fbm(s * 0.9, 7.7, sd + 2, 3) - 0.5) * 0.14 * sstep(0, 1, s);
    for (let x = 0; x < w; x++) {
      const xm = (x + 0.5) / px;
      let v = 0;
      for (const side of [-1, 1]) {
        const d = Math.abs(xm - (1.1 + side * 0.74 + wob * (1 + 0.12 * side))) / 0.125 + (fbm(xm * 30, s * 6, sd + 3, 2) - 0.5) * 0.25;
        const prof = (1 - sstep(0.72, 1.05, d)) * (0.66 + 0.34 * sstep(0.3, 0.85, d)); // shoulders lay down more rubber
        v = Math.max(v, prof * (side < 0 ? 0.82 : 1));
      }
      v *= env * hop * (0.62 + 0.38 * fbm(xm * 46, s * 0.9, sd + 4, 3)) * (0.7 + 0.5 * fbm(xm * 3, s * 2.4, sd + 5, 3));
      F[y * w + x] = sat(v * 1.25);
    }
  }
  return fadeBorder(F, w, h, 0.06 * px);
}

// Locked wheels: two straight marks, each made of the tyre's ribs, strongest where the brakes bit
function skid(t) {
  const { w, h } = t, F = new Float32Array(w * h), px = w / t.metres[0], py = h / t.metres[1], sd = t.seed;
  for (let y = 0; y < h; y++) {
    const s = (h - y - 0.5) / py;
    for (let x = 0; x < w; x++) {
      const xm = (x + 0.5) / px;
      let v = 0;
      for (const side of [-1, 1]) {
        const end = side < 0 ? 6.9 : 7.6, start = side < 0 ? 0.25 : 0.12;
        const env = sstep(start, start + 0.35, s) * mix(1, 0.3, sat(s / end) ** 0.8) * (1 - sstep(end - 1.6, end, s + (fbm(xm * 40, 1.3, sd + side, 2) - 0.5) * 1.2));
        const d = (xm - (1 + side * 0.76)) / 0.118;
        if (Math.abs(d) > 1.3) continue;
        const ribs = 0.62 + 0.38 * sstep(-0.5, 0.6, Math.cos(d * Math.PI * 4.5)); // five ribs across the tread
        v = Math.max(v, env * (1 - sstep(0.7, 1.12, Math.abs(d) + (fbm(xm * 9, s * 2.2, sd + 8 + side, 2) - 0.5) * 0.3)) * ribs);
      }
      v *= (0.55 + 0.45 * fbm(xm * 60, s * 0.3, sd + 4, 3)) * (0.6 + 0.65 * fbm(xm * 2.5, s * 1.3, sd + 5, 3));
      F[y * w + x] = sat(v * 1.3);
    }
  }
  return fadeBorder(F, w, h, 0.05 * px);
}

// A crack filled with tar: a band that wanders up the tile, swells where the crew lingered, and a few short branches
function crack(t) {
  const { w, h } = t, F = new Float32Array(w * h), R = rng(t.seed), px = w / t.metres[0], py = h / t.metres[1], sd = t.seed;
  const cx = (s) => 0.25 + (fbm(s * 0.55, 1.7, sd, 4) - 0.5) * 0.36 + (fbm(s * 2.6, 5.1, sd + 1, 2) - 0.5) * 0.05;
  const paint = (xm, ym, r) => { // a disc of tar, in metres
    const xa = Math.max(0, Math.floor((xm - r) * px - 1)), xb = Math.min(w - 1, Math.ceil((xm + r) * px + 1));
    const ya = Math.max(0, Math.floor((ym - r) * py - 1)), yb = Math.min(h - 1, Math.ceil((ym + r) * py + 1));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const d = Math.hypot((x + 0.5) / px - xm, (y + 0.5) / py - ym), v = 1 - sstep(r - 0.6 / px, r + 0.6 / px, d);
      if (v > F[y * w + x]) F[y * w + x] = v;
    }
  };
  const len = t.metres[1];
  for (let s = 0.1; s < len - 0.1; s += 0.004) {
    const taper = sstep(0.1, 0.3, s) * sstep(len - 0.1, len - 0.3, s);
    const r = (0.016 + 0.009 * fbm(s * 3.1, 9.9, sd + 2, 3) + 0.012 * sstep(0.72, 0.9, fbm(s * 1.7, 2.2, sd + 3, 2))) * mix(0.35, 1, taper);
    paint(sat(cx(s) * 2) / 2, len - s, r);
  }
  for (let b = 0; b < 4; b++) {
    const s0 = 0.5 + ((b + R() * 0.7) * (len - 1)) / 4, dir = R() < 0.5 ? -1 : 1, ang = (0.5 + R() * 0.6) * dir, bl = 0.09 + R() * 0.09;
    for (let u = 0; u < bl; u += 0.004) {
      const f = u / bl, x = cx(s0) + Math.sin(ang) * u + (fbm(u * 20, b, sd + 6, 2) - 0.5) * 0.02, y = len - s0 - Math.cos(ang) * u * 0.9;
      if (x < 0.05 || x > 0.45) break;
      paint(x, y, mix(0.014, 0.006, f));
    }
  }
  const tex = noiseField(w, h, Math.round(w / 3), sd + 7, 2, false, 1.4);
  for (let i = 0; i < F.length; i++) F[i] *= 0.88 + 0.12 * tex[i];
  return fadeBorder(F, w, h, 0.03 * px);
}

// What utility crews spray before digging. The strokes are drawn by a slightly unsteady hand, then turned into paint:
// a soft-edged core, a faint mist around it, uneven coverage and stray droplets.
async function sprayMark(t, kind) {
  const { w, h } = t, n = w * h, R = rng(t.seed), sd = t.seed, mm = 800;
  const j = (v, a = 9) => n2(v + (R() - 0.5) * a);
  const st = (sw, b) => `<g fill="none" stroke="#fff" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${b}</g>`;
  let body = '';
  if (kind === 'a') { // this way to the main, and which main
    body += st(34, `<path d="M${j(210)} ${j(620)}Q${j(330)} ${j(470)} ${j(505)} ${j(250)}"/><path d="M${j(385)} ${j(225)}L${j(520)} ${j(228)}L${j(545)} ${j(365)}"/>`);
    body += `<g transform="rotate(-8 590 590)">${textLine('W', { x: 590, y: 585, cap: 170, weight: 1.15, round: true })}</g>`;
  } else if (kind === 'b') { // a dashed run and its depth
    let d = '';
    for (let i = 0; i < 4; i++) d += `<path d="M${j(120 + i * 150)} ${j(600 - i * 62)}L${j(215 + i * 150)} ${j(560 - i * 62)}"/>`;
    body += st(34, d) + `<g transform="rotate(-20 420 250)">${textLine('24', { x: 420, y: 250, cap: 165, weight: 1.15, gap: 1.6, round: true })}</g>`;
  } else if (kind === 'c') { // the corner of a cut that has been cleared
    body += st(36, `<path d="M${j(170)} ${j(640)}L${j(175)} ${j(190)}L${j(600)} ${j(175)}"/>`);
    body += `<g transform="rotate(6 450 460)">${textLine('OK', { x: 455, y: 460, cap: 170, weight: 1.15, gap: 1.6, round: true })}</g>`;
  } else { // something runs under here
    let d = `M${j(120)} ${j(430)}`;
    for (let i = 0; i < 5; i++) d += `Q${j(175 + i * 115)} ${j(i % 2 ? 540 : 290, 24)} ${j(235 + i * 115)} ${j(415, 16)}`;
    body += st(34, `<path d="${d}"/><path d="M${j(110)} ${j(330)}L${j(128)} ${j(520)}"/>`);
  }
  const ink = await raster(w, h, mm, mm, `<g transform="translate(400 400) scale(1.2) translate(-400 -400)">${body}</g>`), core = blur(ink, w, h, 1.7), mist = blur(ink, w, h, 7), reach = blur(ink, w, h, 12);
  const grainN = noiseField(w, h, Math.round(w / 3), sd + 1, 2, false, 2), cloud = noiseField(w, h, 9, sd + 2, 4);
  const F = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = sstep(0.12, 0.8, core[i]) * (0.72 + 0.28 * cloud[i]) * (0.82 + 0.18 * grainN[i]);
    const speck = hash(i % w, Math.floor(i / w), sd + 3) > 0.985 - reach[i] * 0.09 ? 0.2 + 0.5 * hash(i % w, Math.floor(i / w), sd + 4) : 0;
    F[i] = sat(c + mist[i] * 0.42 * (0.5 + grainN[i]) + speck * sat(reach[i] * 4));
  }
  for (let d = 0; d < 7; d++) { // where the can stopped a moment
    let x = 0, y = 0, tries = 0;
    do { x = Math.floor(R() * w); y = Math.floor(R() * h); tries++; } while (tries < 200 && !(reach[y * w + x] > 0.12 && core[y * w + x] < 0.3));
    blot(F, w, h, x, y, 2 + R() * 3.5, 0.75, sd + 20 + d, { warp: 0.2, edge: 0.5 });
  }
  return fadeBorder(F, w, h, 12);
}

// What a puddle leaves once it has dried: the minerals settle along each shoreline it had on the way down
function puddleRing(t) {
  const { w, h } = t, F = new Float32Array(w * h), R = rng(t.seed), sd = t.seed, c = w / 2, r0 = w * 0.36;
  const lobes = [2, 3, 4, 5, 7].map((kk) => [kk, (0.11 / Math.sqrt(kk - 1)) * (0.5 + R()), R() * TAU]);
  const shores = [[1, 1, 0.022], [0.93, 0.45, 0.016], [0.84, 0.6, 0.02], [0.7, 0.32, 0.016], [0.52, 0.4, 0.022]];
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, a = Math.atan2(dy, dx);
      let rr = 1;
      for (const [kk, amp, ph] of lobes) rr += amp * Math.cos(kk * a + ph);
      const d = Math.hypot(dx, dy) / (r0 * rr) + (fbm(x * 0.035, y * 0.035, sd, 3) - 0.5) * 0.14;
      let v = (1 - sstep(0.9, 1.0, d)) * (0.07 + 0.1 * fbm(x * 0.05, y * 0.05, sd + 1, 4)); // a thin film inside
      shores.forEach(([at, amp, wd], sI) => {
        const broken = sstep(0.3, 0.6, fbm(Math.cos(a) * 2.2 + sI * 7.1, Math.sin(a) * 2.2 - sI * 3.3, sd + 2 + sI, 3) + (sI ? 0 : 0.25));
        const e = (d - at) / wd;
        v += amp * broken * Math.exp(-e * e) * (0.7 + 0.5 * fbm(x * 0.3, y * 0.3, sd + 9, 2));
        if (e < 0) v += amp * broken * 0.3 * Math.exp(e * 0.6); // minerals thin out towards the inside
      });
      F[i] = sat(v);
    }
  }
  return fadeBorder(F, w, h, 10);
}

// ---------------------------------------------------------------------------------------------------------------------
// The two atlases. Positions are fixed by hand so that a tile never moves when another one changes.
//   px: pixel size of the tile, at: its top-left corner, wrap: 'x' or 'xy' for tiles that repeat (their opposite edge is
//   copied into an 8 px gutter so that filtering across the seam is right)

const OBJECTS = [
  { name: 'manhole_sewer', metres: [1, 1], px: [500, 500], at: [8, 8], metal: 1, build: (t) => manhole(t, 'sewer') },
  { name: 'manhole_power', metres: [1, 1], px: [500, 500], at: [516, 8], metal: 1, build: (t) => manhole(t, 'power') },
  { name: 'manhole_steam', metres: [1, 1], px: [500, 500], at: [1024, 8], metal: 1, build: (t) => manhole(t, 'steam') },
  { name: 'manhole_worn', metres: [1, 1], px: [500, 500], at: [1532, 8], metal: 1, build: (t) => manhole(t, 'worn') },
  { name: 'vault_plate', metres: [1.3, 0.9], px: [666, 461], at: [616, 1124], metal: 1, build: vaultPlate },
  { name: 'storm_grate', metres: [0.95, 0.6], px: [486, 307], at: [1290, 1124], metal: 1, build: stormGrate },
  { name: 'subway_grate', metres: [1.6, 1.2], px: [800, 600], at: [1232, 516], metal: 1, wrap: 'x', build: subwayGrate },
  { name: 'cellar_door', metres: [1.5, 1.9], px: [600, 760], at: [8, 516], metal: 1, build: cellarDoor },
  { name: 'tactile_pad', metres: [0.6, 1.2], px: [360, 720], at: [8, 1284], metal: 0, build: tactilePad },
  { name: 'cap_water', metres: [0.3, 0.3], px: [240, 240], at: [1784, 1124], metal: 1, build: (t) => valveCap(t, 'WATER') },
  { name: 'cap_gas', metres: [0.3, 0.3], px: [240, 240], at: [1784, 1372], metal: 1, build: (t) => valveCap(t, 'GAS') },
  { name: 'handhole', metres: [0.5, 0.35], px: [400, 280], at: [616, 1593], metal: 1, build: handhole },
  { name: 'pull_box', metres: [0.7, 0.7], px: [392, 392], at: [1290, 1439], metal: 0, build: pullBox },
  { name: 'tree_grate', metres: [1.5, 1.5], px: [600, 600], at: [616, 516], metal: 1, build: treeGrate }
];

const arrowLeft = (t) => sym(t, `<g transform="translate(60 0)">${turnArrow(1150, 2575, 640, 30, 800, 420, 1240, 1500)}</g>`);
const arrowStraightLeft = (t) => sym(t, straightArrow(1150, 28, 2945, 800, 1100) + turnArrow(1050, 2973, 560, 40, 1820, 380, 1040, 2500));
const MARKS = [
  { name: 'arrow_straight', metres: [1, 2.9], px: [200, 580], at: [664, 8], build: (t) => sym(t, straightArrow(500, 28, 2845, 920, 1300)) },
  { name: 'arrow_left', metres: [1.5, 2.6], px: [300, 520], at: [872, 8], build: arrowLeft },
  { name: 'arrow_right', metres: [1.5, 2.6], px: [300, 520], at: [1180, 8], build: async (t) => mirror(await arrowLeft(t), t.w, t.h) },
  { name: 'arrow_straight_left', metres: [1.6, 3], px: [320, 600], at: [8, 8], build: arrowStraightLeft },
  { name: 'arrow_straight_right', metres: [1.6, 3], px: [320, 600], at: [336, 8], build: async (t) => mirror(await arrowStraightLeft(t), t.w, t.h) },
  { name: 'text_only', metres: [2.2, 2.4], px: [440, 480], at: [536, 616], build: (t) => roadWord(t, 'ONLY') },
  { name: 'text_bus', metres: [1.9, 2.4], px: [380, 480], at: [8, 1104], build: (t) => roadWord(t, 'BUS', 2) },
  { name: 'text_stop', metres: [2.2, 2.4], px: [440, 480], at: [984, 616], build: (t) => roadWord(t, 'STOP') },
  { name: 'text_school', metres: [2.6, 2.4], px: [520, 480], at: [8, 616], build: (t) => roadWord(t, 'SCHOOL') },
  { name: 'text_xing', metres: [2.2, 2.4], px: [440, 480], at: [1432, 616], build: (t) => roadWord(t, 'X-ING') },
  { name: 'bike_symbol', metres: [1, 1.8], px: [200, 360], at: [1488, 8], build: bikeSymbol },
  { name: 'bike_chevrons', metres: [1, 1.4], px: [200, 280], at: [1696, 8], build: chevrons },
  { name: 'hatch', metres: [1, 1], px: [256, 256], at: [1180, 1420], wrap: 'xy', build: hatch },
  { name: 'oil_a', metres: [1, 1], px: [256, 256], at: [8, 1592], build: (t) => oilStain(t, 'a') },
  { name: 'oil_b', metres: [1, 1], px: [256, 256], at: [1480, 1104], build: (t) => oilStain(t, 'b') },
  { name: 'oil_c', metres: [1, 1], px: [256, 256], at: [660, 1712], build: (t) => oilStain(t, 'c') },
  { name: 'oil_trail', metres: [0.6, 3], px: [128, 640], at: [1880, 616], build: oilTrail },
  { name: 'burnout', metres: [2.2, 5], px: [264, 600], at: [660, 1104], build: burnout },
  { name: 'skid', metres: [2, 8], px: [256, 768], at: [396, 1104], build: skid },
  { name: 'crack_a', metres: [0.5, 4], px: [112, 896], at: [932, 1104], build: crack },
  { name: 'crack_b', metres: [0.5, 4], px: [112, 896], at: [1052, 1104], build: crack },
  { name: 'spray_a', metres: [0.8, 0.8], px: [200, 200], at: [1488, 376], build: (t) => sprayMark(t, 'a') },
  { name: 'spray_b', metres: [0.8, 0.8], px: [200, 200], at: [1696, 296], build: (t) => sprayMark(t, 'b') },
  { name: 'spray_c', metres: [0.8, 0.8], px: [200, 200], at: [1452, 1412], build: (t) => sprayMark(t, 'c') },
  { name: 'spray_d', metres: [0.8, 0.8], px: [200, 200], at: [1660, 1412], build: (t) => sprayMark(t, 'd') },
  { name: 'puddle_ring', metres: [1.5, 1.5], px: [300, 300], at: [1172, 1104], build: puddleRing }
];

function prepare(tiles) {
  for (const t of tiles) {
    [t.w, t.h] = t.px; [t.x, t.y] = t.at;
    t.seed = seedOf(t.name);
    t.gx = t.wrap ? PAD : 0; t.gy = t.wrap === 'xy' ? PAD : 0;
  }
  // every tile, gutter included, keeps PAD pixels clear of its neighbours and of the border of the image
  for (const a of tiles) {
    if (a.x - a.gx < PAD || a.y - a.gy < PAD || a.x + a.w + a.gx > SIZE - PAD || a.y + a.h + a.gy > SIZE - PAD) throw new Error(`${a.name} is too close to the border`);
    for (const b of tiles) {
      if (a === b) continue;
      const dx = Math.max(b.x - b.gx - (a.x + a.w + a.gx), a.x - a.gx - (b.x + b.w + b.gx)), dy = Math.max(b.y - b.gy - (a.y + a.h + a.gy), a.y - a.gy - (b.y + b.h + b.gy));
      if (Math.max(dx, dy) < PAD) throw new Error(`${a.name} and ${b.name} are closer than ${PAD} px`);
    }
  }
}

// Calls put(x, y, sx, sy, inside) for every pixel of a tile and of the margin it paints around itself
function eachPixel(t, put) {
  const mx = t.gx || BLEED, my = t.gy || BLEED, { w, h } = t;
  for (let y = -my; y < h + my; y++) {
    for (let x = -mx; x < w + mx; x++) {
      const sx = t.gx ? (x + w) % w : x < 0 ? 0 : x >= w ? w - 1 : x, sy = t.gy ? (y + h) % h : y < 0 ? 0 : y >= h ? h - 1 : y;
      const inside = (t.gx || (x >= 0 && x < w)) && (t.gy || (y >= 0 && y < h));
      put(t.x + x, t.y + y, sy * w + sx, inside);
    }
  }
}

async function build() {
  prepare(OBJECTS);
  prepare(MARKS);
  const colour = new Uint8Array(SIZE * SIZE * 4), normal = new Uint8Array(SIZE * SIZE * 4), marks = new Uint8Array(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) {
    colour[i * 4] = 62; colour[i * 4 + 1] = 58; colour[i * 4 + 2] = 54;
    normal[i * 4] = 128; normal[i * 4 + 1] = 128; normal[i * 4 + 2] = 255; normal[i * 4 + 3] = 204;
  }
  const byte = (v) => Math.max(0, Math.min(255, Math.round(v)));
  // The alpha plane is stored lossless, so every distinct value costs: roughness is kept in steps of 8 where it only
  // shapes a highlight, and in steps of 4 above 0.7, where the game also reads from it how much of the surface is bare metal
  const roughByte = (v) => { const b = v * 255; return Math.max(8, Math.min(255, b < 180 ? Math.round(b / 8) * 8 : Math.round(b / 4) * 4)); };
  for (const t of OBJECTS) {
    const t0 = performance.now(), r = await t.build(t);
    eachPixel(t, (X, Y, i, inside) => {
      const o = (Y * SIZE + X) * 4;
      for (let c = 0; c < 3; c++) {
        colour[o + c] = Math.max(4, byte(r.rgb[i * 3 + c]));
        normal[o + c] = byte(r.nrm[i * 3 + c] * 127.5 + 127.5);
      }
      colour[o + 3] = inside ? byte(r.cover[i] * 255) : 0;
      normal[o + 3] = roughByte(r.rough[i]);
    });
    console.log(`  ${t.name.padEnd(22)} ${t.w}x${t.h}  ${(performance.now() - t0).toFixed(0)} ms`);
  }
  for (const t of MARKS) {
    const m = await t.build(t);
    eachPixel(t, (X, Y, i, inside) => {
      const o = (Y * SIZE + X) * 3;
      marks[o] = marks[o + 1] = marks[o + 2] = inside ? byte(m[i] * 255) : 0;
    });
  }
  let steepest = 0;
  for (let i = 0; i < SIZE * SIZE; i++) steepest = Math.max(steepest, Math.hypot(normal[i * 4] - 127.5, normal[i * 4 + 1] - 127.5) / (normal[i * 4 + 2] - 127.5));
  console.log(`steepest slope before compression: ${((Math.atan(steepest) * 180) / Math.PI).toFixed(1)} degrees`);
  fs.mkdirSync(OUT, { recursive: true });
  const raw = (channels) => ({ raw: { width: SIZE, height: SIZE, channels } });
  await sharp(colour, raw(4)).webp({ quality: 88, alphaQuality: 100, effort: 6, smartSubsample: true }).toFile(path.join(OUT, 'objects_c.webp'));
  await sharp(normal, raw(4)).webp({ quality: 90, alphaQuality: 100, effort: 6, smartSubsample: true }).toFile(path.join(OUT, 'objects_n.webp'));
  await sharp(marks, raw(3)).webp({ quality: 90, effort: 6, smartSubsample: true }).toFile(path.join(OUT, 'marks.webp'));
  const lines = (tiles, metal) => tiles.map((t) => `    ${t.name}: { x: ${t.x}, y: ${t.y}, w: ${t.w}, h: ${t.h}, metres: [${t.metres.join(', ')}]${metal ? `, metal: ${t.metal}` : ''}${t.wrap ? `, repeat: '${t.wrap}'` : ''} }`).join(',\n');
  fs.writeFileSync(MANIFEST, `// Generated by tools/ground/build-atlas.mjs — do not edit
// x, y, w, h: pixels from the top-left of the image. metres: [width, length] of the real thing on the ground
// (width = image horizontal, length = image vertical). repeat: the tile tiles along these axes.
export const OBJECT_ATLAS = {
  size: ${SIZE},
  tiles: {
${lines(OBJECTS, true)}
  }
};

export const MARK_ATLAS = {
  size: ${SIZE},
  tiles: {
${lines(MARKS, false)}
  }
};
`);
  for (const f of ['objects_c.webp', 'objects_n.webp', 'marks.webp']) console.log(`${f.padEnd(16)} ${fs.statSync(path.join(OUT, f)).size} bytes`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Preview: the written files, read back and lit by a low sun, so that what is judged is what the game will load

const lin = (b) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const srgb = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
const LIN = Float32Array.from({ length: 256 }, (_, i) => lin(i));
const norm3 = (v) => { const l = 1 / Math.hypot(v[0], v[1], v[2]); return [v[0] * l, v[1] * l, v[2] * l]; };
const SUN_EL = (25 * Math.PI) / 180;
const ASPHALT = [0.05, 0.05, 0.052];

// Cook-Torrance under a sun 25 degrees above the horizon plus a sky to reflect; out = linear RGB
function shade(out, al, n, rough, metal, L, V) {
  const nl = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]), nv = Math.max(0.05, n[0] * V[0] + n[1] * V[1] + n[2] * V[2]);
  const hv = norm3([L[0] + V[0], L[1] + V[1], L[2] + V[2]]), nh = Math.max(0, n[0] * hv[0] + n[1] * hv[1] + n[2] * hv[2]);
  const vh = Math.max(0, V[0] * hv[0] + V[1] * hv[1] + V[2] * hv[2]);
  const a = Math.max(0.03, rough * rough), a2 = a * a, dd = nh * nh * (a2 - 1) + 1, D = a2 / (Math.PI * dd * dd);
  const kk = ((rough + 1) * (rough + 1)) / 8, G = (nl / (nl * (1 - kk) + kk)) * (nv / (nv * (1 - kk) + kk));
  const rz = 2 * nv * n[2] - V[2], f5 = (1 - vh) ** 5, fe = (1 - nv) ** 5, SUN = 3.2;
  const blurK = Math.min(1, rough ** 1.2);
  for (let c = 0; c < 3; c++) {
    const F0 = mix(0.04, al[c], metal), F = F0 + (1 - F0) * f5;
    const zen = [0.2, 0.34, 0.62][c], hor = [0.62, 0.68, 0.76][c], gnd = [0.07, 0.065, 0.06][c];
    const sky = mix(rz > 0 ? mix(hor, zen, Math.sqrt(rz)) : mix(hor, gnd, Math.min(1, -rz * 4)), [0.3, 0.34, 0.42][c], blurK);
    const Fe = F0 + (Math.max(1 - rough, F0) - F0) * fe;
    const diff = al[c] * (1 - metal) * (nl * SUN + 0.38 * (0.6 + 0.4 * n[2]));
    out[c] = diff + ((D * G * F) / (4 * nv + 1e-4)) * Math.PI * SUN * (nl > 0 ? 1 : 0) + sky * Fe;
  }
}
const tone = (v) => srgb(1 - Math.exp(-v * 1.05));

async function preview(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const rd = async (f) => (await sharp(path.join(OUT, f)).ensureAlpha().raw().toBuffer());
  const C = await rd('objects_c.webp'), N = await rd('objects_n.webp'), M = await rd('marks.webp');
  const metalAt = new Uint8Array(SIZE * SIZE).fill(1);
  for (const t of OBJECTS) for (let y = t.y - 4; y < t.y + t.h + 4; y++) for (let x = t.x - 8; x < t.x + t.w + 8; x++) metalAt[y * SIZE + x] = t.metal;
  const sample = (o, metal, L, V, out) => {
    const a = C[o + 3] / 255, al = [LIN[C[o]], LIN[C[o + 1]], LIN[C[o + 2]]];
    // as js/ground-materials.js reads them: relief pushed by a third, and only what is smooth enough is bare metal
    // (rust, dirt and leaves are rough, hence dielectric). Openings, the only pixels at roughness 1, are lit here as
    // metal too: a black metal reflects nothing, which is what a hole should do.
    const n = norm3([N[o] / 127.5 - 1, N[o + 1] / 127.5 - 1, (N[o + 2] / 127.5 - 1) * 0.75]), ro = N[o + 3] / 255;
    const lit = [0, 0, 0], road = [0, 0, 0];
    shade(lit, al, n, ro, Math.max(metal * (1 - sstep(0.72, 0.95, ro)), ro > 0.985 ? 1 : 0), L, V);
    shade(road, ASPHALT, [0, 0, 1], 0.9, 0, L, V);
    for (let c = 0; c < 3; c++) out[c] = mix(road[c], lit[c], a);
  };
  // 1. the whole atlas from above, sun from the top-left, next to the raw albedo on asphalt
  const L0 = [-Math.cos(SUN_EL) * 0.7071, Math.cos(SUN_EL) * 0.7071, Math.sin(SUN_EL)], V0 = norm3([0, -0.55, 0.83]);
  const lit = Buffer.alloc(SIZE * SIZE * 3), alb = Buffer.alloc(SIZE * SIZE * 3), nrm = Buffer.alloc(SIZE * SIZE * 3), px = [0, 0, 0];
  for (let i = 0; i < SIZE * SIZE; i++) {
    sample(i * 4, metalAt[i], L0, V0, px);
    const a = C[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) {
      lit[i * 3 + c] = tone(px[c]);
      alb[i * 3 + c] = Math.round(mix(40, C[i * 4 + c], a));
      nrm[i * 3 + c] = N[i * 4 + c];
    }
  }
  const png = (buf, w, h) => sharp(buf, { raw: { width: w, height: h, channels: 3 } });
  const both = Buffer.alloc(SIZE * 2 * SIZE * 3);
  for (let y = 0; y < SIZE; y++) { lit.copy(both, y * SIZE * 6, y * SIZE * 3, (y + 1) * SIZE * 3); alb.copy(both, y * SIZE * 6 + SIZE * 3, y * SIZE * 3, (y + 1) * SIZE * 3); }
  await png(both, SIZE * 2, SIZE).png().toFile(path.join(dir, 'ground_preview.png'));
  await png(lit, SIZE, SIZE).png().toFile(path.join(dir, 'objects_lit.png'));
  await png(nrm, SIZE, SIZE).png().toFile(path.join(dir, 'objects_normal.png'));
  for (const t of OBJECTS) { // each object alone: lit | albedo
    const cut = (src) => png(src, SIZE, SIZE).extract({ left: t.x - 4, top: t.y - 4, width: t.w + 8, height: t.h + 8 }).png().toBuffer();
    await sharp({ create: { width: (t.w + 8) * 2, height: t.h + 8, channels: 3, background: '#000' } })
      .composite([{ input: await cut(lit), left: 0, top: 0 }, { input: await cut(alb), left: t.w + 8, top: 0 }]).png().toFile(path.join(dir, `obj_${t.name}.png`));
  }
  // 2. each object as a player sees it: eye 1.6 m up, a few metres away, sun low ahead and to the left
  const PW = 840, PH = 440, COLS = 2, PER = 8;
  let tiles = [], sheet = 1;
  const flush = async () => {
    await sharp({ create: { width: COLS * (PW + 6), height: Math.ceil(tiles.length / COLS) * (PH + 6), channels: 3, background: '#000' } }).composite(tiles).png().toFile(path.join(dir, `objects_eye_${sheet++}.png`));
    tiles = [];
  };
  for (const t of OBJECTS) {
    const img = Buffer.alloc(PW * PH * 3), size = Math.max(...t.metres), dist = 1.6 + size * 1.5, eye = [0, -dist, 1.6];
    const fwd = norm3([0, dist, -1.6]), right = [1, 0, 0], up = [0, -fwd[2], fwd[1]], fov = Math.max(0.2, (size * 1.5) / Math.hypot(dist, 1.6));
    const az = (125 * Math.PI) / 180, L = [Math.cos(SUN_EL) * Math.cos(az), Math.cos(SUN_EL) * Math.sin(az), Math.sin(SUN_EL)];
    const acc = [0, 0, 0], SS = 3;
    for (let y = 0; y < PH; y++) {
      for (let x = 0; x < PW; x++) {
        acc[0] = acc[1] = acc[2] = 0;
        for (let s = 0; s < SS * SS; s++) {
          const u = ((x + ((s % SS) + 0.5) / SS) / PW - 0.5) * fov, v = (0.5 - (y + (Math.floor(s / SS) + 0.5) / SS) / PH) * fov * (PH / PW);
          const d = norm3([fwd[0] + right[0] * u + up[0] * v, fwd[1] + right[1] * u + up[1] * v, fwd[2] + right[2] * u + up[2] * v]);
          if (d[2] >= -1e-4) { for (let c = 0; c < 3; c++) acc[c] += [0.55, 0.62, 0.72][c]; continue; }
          const k = -eye[2] / d[2], gx = eye[0] + d[0] * k, gy = eye[1] + d[1] * k, V = [-d[0], -d[1], -d[2]];
          const tx = Math.floor((gx / t.metres[0] + 0.5) * t.w), ty = Math.floor((0.5 - gy / t.metres[1]) * t.h);
          if (tx < 0 || ty < 0 || tx >= t.w || ty >= t.h) shade(px, ASPHALT, [0, 0, 1], 0.9, 0, L, V);
          else sample(((t.y + ty) * SIZE + t.x + tx) * 4, t.metal, L, V, px);
          for (let c = 0; c < 3; c++) acc[c] += px[c];
        }
        for (let c = 0; c < 3; c++) img[(y * PW + x) * 3 + c] = tone(acc[c] / (SS * SS));
      }
    }
    tiles.push({ input: await png(img, PW, PH).png().toBuffer(), left: (tiles.length % COLS) * (PW + 6), top: Math.floor(tiles.length / COLS) * (PH + 6) });
    if (tiles.length === PER) await flush();
  }
  if (tiles.length) await flush();
  // 3. the marks, as they are
  await sharp(M, { raw: { width: SIZE, height: SIZE, channels: 4 } }).removeAlpha().png().toFile(path.join(dir, 'marks.png'));
  console.log(`previews in ${dir}`);
}

console.log('building the ground atlases');
await build();
if (PREVIEW) await preview(PREVIEW);
