// The Wasteland's ground and walls: photographed sand, rock, rust and concrete from Poly Haven (CC0), packed exactly as
// tools/ground/build-ground.mjs packs the city's (js/wasteland-surfaces.js loads them as js/ground-assets.js does).
// Usage: node tools/wasteland/build-surfaces.mjs <work folder> [--out dir] [--no-fetch]
//   <name>_c.webp  RGB = albedo (sRGB), A = height (0 low .. 1 high, never 0: WebP drops the colour under alpha 0);
//                  the height is the surface's own relief, without the photograph's slow swells
//   <name>_n.webp  RGB = normal (OpenGL, as the source: green points up the image), A = roughness
//   macro_c.webp   a 20 m aerial photograph of dry ground streaked with sand, for the tone changes no tile can hold
//   surfaces.json  per surface: Poly Haven id, metres one repeat covers, mean linear albedo, mean roughness, authors,
//                  file names
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dependency, polyHaven } from './shared.mjs';

const sharp = dependency('sharp');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const WORK = args[0];
if (!WORK || WORK.startsWith('--')) throw new Error('usage: node tools/wasteland/build-surfaces.mjs <work folder> [--out dir] [--no-fetch]');
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(HERE, '../../assets/wasteland/');
const haven = polyHaven(WORK, !args.includes('--no-fetch'));
const SIZE = 1024;

// name: what the shaders call it. id: the Poly Haven texture. metres: what one repeat covers in the game, when that is
// not what the photograph covers (the source's own size is then kept as `photographed`).
// colour, normal: WebP quality of that surface, when the default is not right for it. swell: how much of the height's
// slow swells is kept (default 0.25). rough: the mean roughness the surface must have, when the photograph's is that
// of another state of the same matter (the map is shifted, its contrast kept).
const SURFACES = {
  // wind ripples on fine pale sand. A drone photograph of 30 m of beach: drawn at 10 m, its ripples are 30 cm apart,
  // which is what a dune's are, and a texel is a centimetre
  // (a beach is damp: its roughness is brought up to that of dry sand)
  dune: { id: 'aerial_beach_01', metres: 10, rough: 0.88 },
  sand: { id: 'dry_ground_rocks' }, // coarse ochre ground, hairline cracks, a scatter of small pale stones
  // dried mud, warm and pale. Photographed over 1.5 m, its polygons are a hand wide; drawn at 3 m they are the plates
  // of a dry lake bed, and can be seen from a car
  crack: { id: 'mud_cracked_dry_03', metres: 3 },
  salt: { id: 'dry_ground_01' }, // a pale grey crust broken into fine polygons: the closest Poly Haven has to a salt pan
  gravel: { id: 'floor_pebbles_01' }, // a wash of small pebbles in sand
  // layered red and ochre sandstone, its beds horizontal: for the steep slopes. Photographed over 1.8 m: drawn at 4 m,
  // its beds are 30 to 60 cm thick and a cliff shows five repeats where it showed eleven
  cliff: { id: 'cliff_side', metres: 4 },
  // a weathered face broken into blocks of a metre and more, at its real size (5.7 m): the large scale of a cliff, to
  // mix with `cliff` so that neither repeats
  crag: { id: 'marble_cliff_03' },
  slab: { id: 'sandstone_cracks' }, // bare orange sandstone, smooth, with shallow joints: slickrock
  rust: { id: 'rusty_metal_04' }, // flat steel plate, its grey paint flaking off deep brown rust
  sheet: { id: 'rusty_corrugated_iron' }, // corrugated iron rusted through, the waves vertical
  // poured concrete with vertical formwork joints, pitted and streaked dark (its roughness map is that of a sealed
  // floor: brought up to that of a weathered wall)
  bunker: { id: 'concrete', rough: 0.84 }
};
const MACRO = 'dirt_aerial_02';

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

const raw = async (file, channels) => {
  const img = sharp(file).resize(SIZE, SIZE, { fit: 'fill', kernel: 'lanczos3' });
  return (channels === 1 ? img.greyscale() : img.removeAlpha().toColourspace('srgb')).raw().toBuffer();
};
// The two maps that travel in an alpha channel (height, roughness) are smoothed a little first, across the tile's
// edges. WebP keeps few levels of an alpha channel (9 at quality 35, 12 at 50, 16 at 70) and stores them without
// loss, so the grain of these maps is what costs: smoothed by about a texel, the height keeps 16 levels and the
// roughness 12 for the bytes the city's ground spends on 9.
// A grey SIZE x SIZE map blurred as a tile: what leaves one edge comes back by the opposite one
async function blur(grey, sigma) {
  const margin = Math.min(SIZE, Math.ceil(sigma * 3) + 4);
  // two passes: in one, sharp would cut before it extends
  const { data, info } = await sharp(grey, { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .extend({ top: margin, bottom: margin, left: margin, right: margin, extendWith: 'repeat' }).blur(sigma).raw().toBuffer({ resolveWithObject: true });
  const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .extract({ left: margin, top: margin, width: SIZE, height: SIZE }).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  if (out.info.channels !== 1 || out.data.length !== SIZE * SIZE) throw new Error(`a blurred map came out as ${out.info.width} x ${out.info.height} x ${out.info.channels}`);
  return out.data;
}
const soft = async (file, sigma) => blur(await raw(file, 1), sigma);
// The height a shader blends and shades with is the relief of the surface itself: cracks, ripples, stones. The
// photographs' displacement maps also hold swells several metres long (a hollow across half the tile), which would
// take most of the range and show as one blotch per repeat: all but `swell` of them is taken out.
async function relief(file, swell) {
  const height = await soft(file, 1.2), slow = await blur(height, SIZE / 20);
  return Float32Array.from(height, (h, i) => h - slow[i] * (1 - swell));
}
const toLinear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const metresOf = (meta, fallback) => +(((meta.dimensions?.[0] ?? fallback) / 1000).toFixed(3));

const info = {};
for (const [name, spec] of Object.entries(SURFACES)) {
  const { id } = spec;
  const meta = await haven.info(id, 'textures');
  const [diff, nor, rough, disp] = await Promise.all([
    raw(await haven.texture(id, 'Diffuse'), 3), raw(await haven.texture(id, 'nor_gl'), 3), soft(await haven.texture(id, 'Rough'), 1.5), relief(await haven.texture(id, 'Displacement'), spec.swell ?? 0.25)
  ]);
  // Height stretched between its 1st and 99th percentiles
  const sorted = Float32Array.from(disp).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)];
  const hi = Math.max(lo + 1e-3, sorted[Math.floor(sorted.length * 0.99)]);
  if (spec.rough) {
    let sum = 0;
    for (let i = 0; i < SIZE * SIZE; i++) sum += rough[i];
    const shift = spec.rough * 255 - sum / (SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) rough[i] = Math.max(0, Math.min(255, Math.round(rough[i] + shift)));
  }
  const colour = Buffer.alloc(SIZE * SIZE * 4);
  const normal = Buffer.alloc(SIZE * SIZE * 4);
  const mean = [0, 0, 0];
  let roughness = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 3; c++) {
      colour[i * 4 + c] = diff[i * 3 + c];
      normal[i * 4 + c] = nor[i * 3 + c];
      mean[c] += toLinear(diff[i * 3 + c]);
    }
    colour[i * 4 + 3] = Math.max(2, Math.min(255, Math.round(((disp[i] - lo) / (hi - lo)) * 255)));
    normal[i * 4 + 3] = Math.max(2, rough[i]);
    roughness += rough[i] / 255;
  }
  const files = { color: `${name}_c.webp`, normal: `${name}_n.webp` };
  await sharp(colour, { raw: { width: SIZE, height: SIZE, channels: 4 } }).webp({ quality: spec.colour ?? 72, alphaQuality: 70, effort: 6 }).toFile(path.join(OUT, files.color));
  await sharp(normal, { raw: { width: SIZE, height: SIZE, channels: 4 } }).webp({ quality: spec.normal ?? 68, alphaQuality: 50, effort: 6 }).toFile(path.join(OUT, files.normal));
  const photographed = metresOf(meta, 2000);
  info[name] = {
    id, title: meta.name ?? id, metres: spec.metres ?? photographed, ...(spec.metres ? { photographed } : {}),
    mean: mean.map((m) => +(m / (SIZE * SIZE)).toFixed(4)), roughness: +(roughness / (SIZE * SIZE)).toFixed(3),
    authors: Object.keys(meta.authors || {}), ...files
  };
  console.log(name.padEnd(7), id.padEnd(22), String(info[name].metres).padStart(5), 'm  mean', info[name].mean.join(' '), ' rough', info[name].roughness);
}

{
  const meta = await haven.info(MACRO, 'textures');
  const diff = await raw(await haven.texture(MACRO, 'Diffuse'), 3);
  const mean = [0, 0, 0];
  for (let i = 0; i < SIZE * SIZE; i++) for (let c = 0; c < 3; c++) mean[c] += toLinear(diff[i * 3 + c]);
  await sharp(diff, { raw: { width: SIZE, height: SIZE, channels: 3 } }).webp({ quality: 86, effort: 5 }).toFile(path.join(OUT, 'macro_c.webp'));
  info.macro = { id: MACRO, title: meta.name ?? MACRO, metres: metresOf(meta, 20000), mean: mean.map((m) => +(m / (SIZE * SIZE)).toFixed(4)), authors: Object.keys(meta.authors || {}), color: 'macro_c.webp' };
  console.log('macro  ', MACRO.padEnd(22), String(info.macro.metres).padStart(5), 'm  mean', info.macro.mean.join(' '));
}

fs.writeFileSync(path.join(OUT, 'surfaces.json'), JSON.stringify(info, null, 2) + '\n');
let total = 0;
for (const entry of Object.values(info)) for (const f of [entry.color, entry.normal]) {
  if (!f) continue;
  const size = fs.statSync(path.join(OUT, f)).size;
  total += size;
  console.log(f.padEnd(18), (size / 1024).toFixed(0).padStart(5), 'kB');
}
console.log('surfaces'.padEnd(18), (total / 1024 / 1024).toFixed(2).padStart(5), 'MB');
