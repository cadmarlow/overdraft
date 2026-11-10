// The bark photographs (Poly Haven, CC0) at the size the game wants them: assets/trees/bark-<kind>_c.webp and _n.webp.
// Usage: node tools/trees/build-bark.mjs <folder of fetch.mjs> [--out dir]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { BARKS } from './fetch.mjs';

const args = process.argv.slice(2);
const RAW = args[0];
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : new URL('../../assets/trees/', import.meta.url).pathname;
if (!RAW) { console.error('usage: node build-bark.mjs <folder of fetch.mjs> [--out dir]'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
for (const [name, id] of Object.entries(BARKS)) {
  await sharp(path.join(RAW, id, `${id}_diff_2k.jpg`)).resize(1024, 1024, { fit: 'fill' }).webp({ quality: 84, effort: 5 }).toFile(path.join(OUT, `bark-${name}_c.webp`));
  await sharp(path.join(RAW, id, `${id}_nor_gl_2k.jpg`)).resize(1024, 1024, { fit: 'fill' }).webp({ quality: 86, effort: 5 }).toFile(path.join(OUT, `bark-${name}_n.webp`));
  console.log(name, id);
}
