// Bark and grass, from Poly Haven and ambientCG (both CC0), at the size the game wants them.
// Usage: node build-textures.mjs <folder of the raw downloads> [--out dir]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const RAW = args[0];
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : new URL('../../assets/nature/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const BARK = { plane: 'japanese_zelkova_bark', locust: 'bark_brown_02', elm: 'bark_platanus', oak: 'jolcham_oak_bark_01' };
for (const [name, folder] of Object.entries(BARK)) {
  await sharp(path.join(RAW, folder, 'diff.jpg')).resize(1024, 1024, { fit: 'fill' }).webp({ quality: 84, effort: 5 }).toFile(path.join(OUT, `bark-${name}_c.webp`));
  await sharp(path.join(RAW, folder, 'nor_gl.jpg')).resize(1024, 1024, { fit: 'fill' }).webp({ quality: 86, effort: 5 }).toFile(path.join(OUT, `bark-${name}_n.webp`));
}
for (const [name, id] of Object.entries({ lawn: 'Grass001', meadow: 'Grass005' })) {
  const base = path.join(RAW, id, `${id}_2K-JPG_`);
  await sharp(`${base}Color.jpg`).resize(1024, 1024).webp({ quality: 84, effort: 5 }).toFile(path.join(OUT, `${name}_c.webp`));
  await sharp(`${base}NormalGL.jpg`).resize(1024, 1024).webp({ quality: 84, effort: 5 }).toFile(path.join(OUT, `${name}_n.webp`));
}
