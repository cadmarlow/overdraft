// The storefronts' surfaces, photographed (Poly Haven, CC0), in one 4 x 4 atlas of 512 px tiles: assets/shops/kit_c.webp
// (colour) and assets/shops/kit_n.webp (normal x, y in red and green, roughness in blue). Each tile carries a 16 px
// border of its own wrapped-round pixels, so a shader can tile it without bleeding into its neighbours. The last four
// tiles are the buildings' own brick and stone (assets/world), so piers match the walls above them.
// Usage: node tools/shops/build-kit-textures.mjs <work folder>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// sharp is installed once, by tools/world (npm install there)
const sharp = createRequire(new URL('../world/package.json', import.meta.url))('sharp');
const WORK = process.argv[2];
if (!WORK) throw new Error('Usage: node tools/shops/build-kit-textures.mjs <work folder>');
const OUT = new URL('../../assets/shops/', import.meta.url).pathname;
const WORLD = new URL('../../assets/world/', import.meta.url).pathname;
// [name, Poly Haven id, how the shader uses it ('tint': a detail map under a paint colour, 'natural': its own colour)]
const TILES = [
  ['paint', 'painted_plaster_wall', 'tint'],
  ['planks', 'distressed_painted_planks', 'tint'],
  ['wood', 'fine_grained_wood', 'natural'],
  ['granite', 'granite_tile', 'natural'],
  ['marble', 'marble_01', 'natural'],
  ['metal', 'metal_plate', 'natural'],
  ['tiles', 'long_white_tiles', 'natural'],
  ['terrazzo', 'terrazzo_tiles', 'natural'],
  ['shutter', 'painted_metal_shutter', 'natural'],
  ['rustshutter', 'rusty_metal_shutter', 'natural'],
  ['paintedbrick', 'painted_brick', 'tint'],
  ['concrete', 'brushed_concrete', 'natural'],
  ['limestone', null, 'natural'],
  ['redbrick', null, 'natural'],
  ['brownbrick', null, 'natural'],
  ['buffbrick', null, 'natural']
];
const TILE = 512, BORDER = 16, INNER = TILE - 2 * BORDER, COLS = 4;
const AGENT = { headers: { 'User-Agent': 'overdraft-game-tools' } };

async function fetchMaps(id) {
  const folder = path.join(WORK, id);
  fs.mkdirSync(folder, { recursive: true });
  const info = await (await fetch(`https://api.polyhaven.com/info/${id}`, AGENT)).json();
  // File names vary between assets (diff, col...): the files listing says which is which
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, AGENT)).json();
  for (const [key, file] of [['Diffuse', 'diff.jpg'], ['nor_gl', 'nor.jpg'], ['Rough', 'rough.jpg']]) {
    const target = path.join(folder, file);
    if (fs.existsSync(target) && fs.statSync(target).size) continue;
    const url = files[key]?.['1k']?.jpg?.url;
    if (!url) throw new Error(`${id}: no 1k ${key}`);
    const r = await fetch(url, AGENT);
    if (!r.ok) throw new Error(`${id} ${key}: ${r.status}`);
    fs.writeFileSync(target, Buffer.from(await r.arrayBuffer()));
  }
  return { diff: path.join(folder, 'diff.jpg'), nor: path.join(folder, 'nor.jpg'), rough: path.join(folder, 'rough.jpg'),
    metres: (info.dimensions?.[0] ?? 2000) / 1000, authors: Object.keys(info.authors || {}) };
}

// A tile: the photo squeezed to the inner square, then wrapped round into the border
async function tile(file, channels) {
  const inner = await sharp(file).resize(INNER, INNER, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const out = Buffer.alloc(TILE * TILE * channels);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const sx = (x - BORDER + INNER) % INNER, sy = (y - BORDER + INNER) % INNER;
    for (let c = 0; c < channels; c++) out[(y * TILE + x) * channels + c] = inner[(sy * INNER + sx) * 3 + Math.min(c, 2)];
  }
  return out;
}

const size = TILE * COLS;
const colour = Buffer.alloc(size * size * 3), normal = Buffer.alloc(size * size * 3);
const meta = [];
const sizes = JSON.parse(fs.readFileSync(path.join(WORLD, 'sizes.json'), 'utf8'));
for (let i = 0; i < TILES.length; i++) {
  const [name, id, use] = TILES[i];
  let maps;
  if (id) maps = await fetchMaps(id);
  else maps = { diff: path.join(WORLD, `${name}_c.webp`), nor: path.join(WORLD, `${name}_n.webp`), rough: path.join(WORLD, `${name}_r.webp`),
    metres: sizes[name].metres, authors: sizes[name].authors, id: sizes[name].id };
  const c = await tile(maps.diff, 3), n = await tile(maps.nor, 3), r = await tile(maps.rough, 3);
  const ox = (i % COLS) * TILE, oy = Math.floor(i / COLS) * TILE;
  // Average colour (linear) and roughness, which the shader fades to in the distance instead of shimmering
  let ar = 0, ag = 0, ab = 0, rough = 0;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  for (let k = 0; k < TILE * TILE; k++) { ar += lin(c[k * 3]); ag += lin(c[k * 3 + 1]); ab += lin(c[k * 3 + 2]); rough += r[k * 3] / 255; }
  const nPix = TILE * TILE;
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const s = (y * TILE + x) * 3, d = ((oy + y) * size + ox + x) * 3;
    colour[d] = c[s]; colour[d + 1] = c[s + 1]; colour[d + 2] = c[s + 2];
    normal[d] = n[s]; normal[d + 1] = n[s + 1]; normal[d + 2] = r[s];
  }
  meta.push({ name, id: id || maps.id, use, metres: +maps.metres.toFixed(3), authors: maps.authors,
    average: [ar / nPix, ag / nPix, ab / nPix, rough / nPix].map((v) => +v.toFixed(4)) });
  console.log(name, id || maps.id, maps.metres, maps.authors.join(', '));
}
fs.mkdirSync(OUT, { recursive: true });
await sharp(colour, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 86, effort: 5 }).toFile(path.join(OUT, 'kit_c.webp'));
await sharp(normal, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 90, effort: 5 }).toFile(path.join(OUT, 'kit_n.webp'));
fs.writeFileSync(path.join(OUT, 'kit.json'), JSON.stringify({ tile: TILE, border: BORDER, cols: COLS, tiles: meta }, null, 2) + '\n');
