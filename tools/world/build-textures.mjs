// The city's surfaces: photographed brick, stone, asphalt and concrete from Poly Haven (CC0), downloaded and made small.
// Usage: node build-textures.mjs <work folder> [--out dir]
// sizes.json records how many metres each photograph covers, as the shaders need to know
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const WORK = args[0];
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : new URL('../../assets/world/', import.meta.url).pathname;
const SURFACES = {
  limestone: 'white_sandstone_bricks',
  redbrick: 'red_brick_03',
  brownbrick: 'brick_wall_09',
  buffbrick: 'brown_brick_02',
  asphalt: 'asphalt_02',
  sidewalk: 'concrete_floor_worn_001'
};
const AGENT = { headers: { 'User-Agent': 'overdraft-game-tools' } };
fs.mkdirSync(OUT, { recursive: true });
const sizes = {};
for (const [name, id] of Object.entries(SURFACES)) {
  const folder = path.join(WORK, id);
  fs.mkdirSync(folder, { recursive: true });
  const info = await (await fetch(`https://api.polyhaven.com/info/${id}`, AGENT)).json();
  sizes[name] = { id, metres: (info.dimensions?.[0] ?? 2000) / 1000, authors: Object.keys(info.authors) };
  for (const [key, file] of [['diff', 'diff.jpg'], ['nor_gl', 'nor.jpg'], ['rough', 'rough.jpg']]) {
    const target = path.join(folder, file);
    if (fs.existsSync(target) && fs.statSync(target).size) continue;
    const r = await fetch(`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/${id}/${id}_${key}_2k.jpg`, AGENT);
    if (!r.ok) throw new Error(`${id} ${key}: ${r.status}`);
    fs.writeFileSync(target, Buffer.from(await r.arrayBuffer()));
  }
  await sharp(path.join(folder, 'diff.jpg')).resize(1024, 1024, { fit: 'fill' }).webp({ quality: 84, effort: 5 }).toFile(path.join(OUT, `${name}_c.webp`));
  await sharp(path.join(folder, 'nor.jpg')).resize(1024, 1024, { fit: 'fill' }).webp({ quality: 86, effort: 5 }).toFile(path.join(OUT, `${name}_n.webp`));
  await sharp(path.join(folder, 'rough.jpg')).resize(512, 512, { fit: 'fill' }).webp({ quality: 80, effort: 5 }).toFile(path.join(OUT, `${name}_r.webp`));
  console.log(name, id, sizes[name].metres, sizes[name].authors.join(', '));
}
fs.writeFileSync(path.join(OUT, 'sizes.json'), JSON.stringify(sizes, null, 2));
