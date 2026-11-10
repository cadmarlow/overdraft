// The city's ground: photographed asphalt and concrete from Poly Haven (CC0), packed for the ground shaders, and the
// tileable wear masks they share. Usage: node tools/ground/build-ground.mjs <work folder> [--out dir] [--no-fetch]
//   <name>_c.webp  RGB = albedo (sRGB), A = height (0 low .. 1 high, never 0: WebP drops the colour under alpha 0)
//   <name>_n.webp  RGB = normal (OpenGL), A = roughness
//   macro_c.webp   a 30 m aerial photograph of a road, for the tone changes no 2 m tile can hold
//   masks_a.webp   grey = blotches (stains, pours), A = streaks (drips, leaks, tyre drag), both equalised
//   masks_b.webp   grey = speckle (chips, drops, debris), A = cracks (thin lines)
//   ground.json    metres covered, mean linear albedo (so a shader can set the tone it wants), authors
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const sharp = createRequire(new URL('../world/', import.meta.url))('sharp');
const args = process.argv.slice(2);
const WORK = args[0];
if (!WORK) throw new Error('usage: node tools/ground/build-ground.mjs <work folder> [--out dir] [--no-fetch]');
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : new URL('../../assets/ground/', import.meta.url).pathname;
const FETCH = !args.includes('--no-fetch');
const AGENT = { headers: { 'User-Agent': 'overdraft-game-tools' } };
const SIZE = 1024;

const SURFACES = {
  asphalt: 'asphalt_pit_lane', // the aged, coarse roadway
  blacktop: 'asphalt_track', // fresh pours: repaved blocks, utility cuts
  chipseal: 'tarred_gravel', // old binder with the stone showing through
  concrete: 'granular_concrete', // sidewalk flags
  trowel: 'brushed_concrete', // hand-finished concrete: older flags, curbs, bluestone
  setts: 'cobblestone_floor_08', // Belgian block: the strip of granite setts along many curbs
  dirt: 'park_dirt', // trodden earth: under the trees, along the paths, where the grass gave up
  litter: 'forest_leaves_03', // last year's leaves, under the canopy
  rock: 'lichen_rock' // Manhattan schist: the outcrops of Central Park
};
const MACRO = 'aerial_asphalt_01';
// Surfaces the shaders only read the colour and height of: no normal map is shipped for them
const COLOUR_ONLY = new Set(['dirt', 'litter', 'rock']);

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

async function source(id, map, res = '2k') {
  const file = path.join(WORK, `${id}_${map}_${res}.jpg`);
  if (fs.existsSync(file) && fs.statSync(file).size) return file;
  if (!FETCH) throw new Error(`missing ${file}`);
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, AGENT)).json();
  const url = files[map]?.[res]?.jpg?.url;
  if (!url) throw new Error(`${id}: no ${map} at ${res} (has ${Object.keys(files).join(', ')})`);
  const r = await fetch(url, AGENT);
  if (!r.ok) throw new Error(`${id} ${map}: ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}
const raw = async (file, channels) => {
  const img = sharp(file).resize(SIZE, SIZE, { fit: 'fill', kernel: 'lanczos3' });
  return (channels === 1 ? img.greyscale() : img.removeAlpha()).raw().toBuffer();
};
const toLinear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

const info = {};
for (const [name, id] of Object.entries(SURFACES)) {
  const meta = await (await fetch(`https://api.polyhaven.com/info/${id}`, AGENT)).json().catch(() => ({}));
  const [diff, nor, rough, disp] = await Promise.all([
    raw(await source(id, 'Diffuse'), 3), raw(await source(id, 'nor_gl'), 3), raw(await source(id, 'Rough'), 1), raw(await source(id, 'Displacement'), 1)
  ]);
  // Height stretched between its 1st and 99th percentiles
  const sorted = Uint8Array.from(disp).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)];
  const hi = Math.max(lo + 1, sorted[Math.floor(sorted.length * 0.99)]);
  const colour = Buffer.alloc(SIZE * SIZE * 4);
  const normal = Buffer.alloc(SIZE * SIZE * 4);
  const mean = [0, 0, 0];
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 3; c++) {
      colour[i * 4 + c] = diff[i * 3 + c];
      normal[i * 4 + c] = nor[i * 3 + c];
      mean[c] += toLinear(diff[i * 3 + c]);
    }
    colour[i * 4 + 3] = Math.max(2, Math.min(255, Math.round(((disp[i] - lo) / (hi - lo)) * 255)));
    normal[i * 4 + 3] = Math.max(2, rough[i]);
  }
  await sharp(colour, { raw: { width: SIZE, height: SIZE, channels: 4 } }).webp({ quality: 78, alphaQuality: 35, effort: 6 }).toFile(path.join(OUT, `${name}_c.webp`));
  if (COLOUR_ONLY.has(name)) fs.rmSync(path.join(OUT, `${name}_n.webp`), { force: true });
  else await sharp(normal, { raw: { width: SIZE, height: SIZE, channels: 4 } }).webp({ quality: 80, alphaQuality: 35, effort: 6 }).toFile(path.join(OUT, `${name}_n.webp`));
  info[name] = {
    id, metres: +(((meta.dimensions?.[0] ?? 2000) / 1000).toFixed(3)), mean: mean.map((m) => +(m / (SIZE * SIZE)).toFixed(4)),
    ...(COLOUR_ONLY.has(name) ? { normal: false } : {}),
    authors: Object.keys(meta.authors || {})
  };
  console.log(name, id, info[name].metres, 'm', info[name].mean.join(' '));
}

{
  const meta = await (await fetch(`https://api.polyhaven.com/info/${MACRO}`, AGENT)).json().catch(() => ({}));
  const diff = await raw(await source(MACRO, 'Diffuse'), 3);
  const mean = [0, 0, 0];
  for (let i = 0; i < SIZE * SIZE; i++) for (let c = 0; c < 3; c++) mean[c] += toLinear(diff[i * 3 + c]);
  await sharp(diff, { raw: { width: SIZE, height: SIZE, channels: 3 } }).webp({ quality: 86, effort: 5 }).toFile(path.join(OUT, 'macro_c.webp'));
  info.macro = { id: MACRO, metres: +(((meta.dimensions?.[0] ?? 30000) / 1000).toFixed(3)), mean: mean.map((m) => +(m / (SIZE * SIZE)).toFixed(4)), authors: Object.keys(meta.authors || {}) };
  console.log('macro', MACRO, info.macro.metres, 'm');
}

// ---------------------------------------------------------------------------------------------------------------------
// Wear masks: tileable, made here so the shaders spend texture fetches instead of dozens of procedural noises a pixel
// ---------------------------------------------------------------------------------------------------------------------
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Periodic value noise on a px x py lattice
function lattice(px, py, seed) {
  const rnd = mulberry(seed);
  const v = Float32Array.from({ length: px * py }, () => rnd());
  return (x, y) => {
    const fx = x * px, fy = y * py;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const x0 = ((ix % px) + px) % px, x1 = (x0 + 1) % px, y0 = ((iy % py) + py) % py, y1 = (y0 + 1) % py;
    const a = v[y0 * px + x0], b = v[y0 * px + x1], c = v[y1 * px + x0], d = v[y1 * px + x1];
    return a + (b - a) * sx + (c - a + (a - b + d - c) * sx) * sy;
  };
}
function fbm(px, py, octaves, seed, gain = 0.5) {
  const layers = Array.from({ length: octaves }, (_, o) => lattice(px << o, py << o, seed + o * 101));
  return (x, y) => {
    let sum = 0, amp = 1, total = 0;
    for (const n of layers) { sum += n(x, y) * amp; total += amp; amp *= gain; }
    return sum / total;
  };
}
function field(fn) {
  const out = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) out[y * SIZE + x] = fn((x + 0.5) / SIZE, (y + 0.5) / SIZE);
  return out;
}
// Rank transform: a threshold t then covers exactly (1 - t) of the surface
function equalise(f) {
  const order = Uint32Array.from({ length: f.length }, (_, i) => i).sort((a, b) => f[a] - f[b]);
  const out = new Float32Array(f.length);
  for (let r = 0; r < order.length; r++) out[order[r]] = r / (order.length - 1);
  return out;
}
// Periodic Worley: nearest and second nearest jittered points of an n x n grid
function worley(n, seed) {
  const rnd = mulberry(seed);
  const pts = Float32Array.from({ length: n * n * 3 }, () => rnd());
  return (x, y) => {
    const fx = x * n, fy = y * n;
    const cx = Math.floor(fx), cy = Math.floor(fy);
    let f1 = 9, f2 = 9, id = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const gx = cx + i, gy = cy + j;
        const k = ((((gy % n) + n) % n) * n + (((gx % n) + n) % n)) * 3;
        const dx = gx + 0.1 + pts[k] * 0.8 - fx, dy = gy + 0.1 + pts[k + 1] * 0.8 - fy;
        const d = Math.hypot(dx, dy);
        if (d < f1) { f2 = f1; f1 = d; id = pts[k + 2]; } else if (d < f2) f2 = d;
      }
    }
    return [f1, f2, id];
  };
}

console.log('masks…');
const warpX = fbm(3, 3, 4, 11), warpY = fbm(3, 3, 4, 23);
const blotchBase = fbm(4, 4, 6, 37, 0.55);
const blotch = equalise(field((x, y) => blotchBase(x + (warpX(x, y) - 0.5) * 0.22, y + (warpY(x, y) - 0.5) * 0.22)));
// Streaks run along the image's vertical axis (the road's direction of travel)
const streakBase = fbm(24, 2, 5, 51, 0.6), streakBreak = fbm(6, 6, 4, 67);
const streak = equalise(field((x, y) => streakBase(x + (warpX(x, y) - 0.5) * 0.02, y) * 0.75 + streakBreak(x, y) * 0.25));
const dots = worley(28, 83), fineDots = worley(90, 97);
const speckle = equalise(field((x, y) => {
  const [a, , ida] = dots(x + (warpX(x, y) - 0.5) * 0.01, y);
  const [b, , idb] = fineDots(x, y);
  return Math.max((1 - a * 1.6) * (0.35 + 0.65 * ida), (1 - b * 2.2) * (0.2 + 0.5 * idb));
}));
const veins = worley(5, 131), fineVeins = worley(13, 149);
const breakUp = fbm(5, 5, 4, 163);
const crack = field((x, y) => {
  const wx = x + (warpX(x * 3, y * 3) - 0.5) * 0.035, wy = y + (warpY(x * 3, y * 3) - 0.5) * 0.035;
  const [a1, a2] = veins(wx, wy);
  const [b1, b2] = fineVeins(wx, wy);
  const main = 1 - Math.min(1, (a2 - a1) / 0.014);
  const fine = (1 - Math.min(1, (b2 - b1) / 0.022)) * Math.max(0, Math.min(1, (breakUp(x, y) - 0.45) * 6)) * 0.6;
  return Math.max(main, fine);
});
const pair = (grey, alpha) => {
  const out = Buffer.alloc(SIZE * SIZE * 2);
  for (let i = 0; i < SIZE * SIZE; i++) {
    out[i * 2] = Math.round(Math.max(0, Math.min(1, grey[i])) * 255);
    out[i * 2 + 1] = Math.max(2, Math.round(Math.max(0, Math.min(1, alpha[i])) * 255));
  }
  return sharp(out, { raw: { width: SIZE, height: SIZE, channels: 2 } }).webp({ quality: 90, alphaQuality: 92, effort: 5 });
};
await pair(blotch, streak).toFile(path.join(OUT, 'masks_a.webp'));
await pair(speckle, crack).toFile(path.join(OUT, 'masks_b.webp'));

fs.writeFileSync(path.join(OUT, 'ground.json'), JSON.stringify(info, null, 2) + '\n');
for (const f of fs.readdirSync(OUT)) console.log(f.padEnd(18), (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0), 'kB');
