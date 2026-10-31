// Turns one Rocketbox avatar into what the game loads: assets/people/<id>.bin and its textures as WebP.
// Usage: node import-avatar.mjs <id> <file.fbx> <texture dir> [--size 1024] [--normal 1024] [--hair 1] [--out dir]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { readAvatar, packed } from './avatar.mjs';
import { readTGA, bleed, resized } from './tga.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const [id, fbx, textures] = args;
const SIZE = +flag('size', 1024), NORMAL = +flag('normal', 1024), SPEC = +flag('spec', 512);
const HAIR = +flag('hair', 1); // darkens hair strands that show against a black scalp
const OUT = flag('out', new URL('../../assets/people/', import.meta.url).pathname);
fs.mkdirSync(OUT, { recursive: true });

const { p, n, uv, si, sw, index, parts, bind, skeleton } = readAvatar(fbx);
const header = {
  version: 1,
  bones: skeleton,
  parts,
  height: Math.max(...p.filter((_, i) => i % 3 === 1)),
  sections: [p.length * 4, n.length * 4, uv.length * 4, si.length, sw.length, index.length * 4, bind.length * 4]
};
const data = packed(header, [Float32Array.from(p), Float32Array.from(n), Float32Array.from(uv), Uint8Array.from(si), Uint8Array.from(sw), Uint32Array.from(index), Float32Array.from(bind)]);
fs.writeFileSync(path.join(OUT, `${id}.bin`), data);

// Textures: colour, normal and a specular map that the material reads as roughness
const files = fs.readdirSync(textures);
for (const part of parts) {
  for (const [suffix, tag, size, quality] of [['color', 'c', SIZE, 88], ['normal', 'n', NORMAL, 92], ['specular', 's', SPEC, 80]]) {
    const file = files.find((f) => f.toLowerCase() === `${part.material}_${suffix}.tga`.toLowerCase()) ?? files.find((f) => f.toLowerCase().endsWith(`_${part.name}_${suffix}.tga`));
    if (!file) continue;
    const { width, height, rgba } = readTGA(path.join(textures, file));
    const hasAlpha = part.name.includes('opacity') && suffix === 'color';
    if (hasAlpha) {
      bleed(rgba, width, height);
      for (let i = 0; i < rgba.length; i += 4) for (let c = 0; c < 3; c++) rgba[i + c] *= HAIR;
    }
    const w = Math.min(size, width), h = Math.min(size, height);
    let img = sharp(await resized(rgba, width, height, w, h), { raw: { width: w, height: h, channels: 4 } });
    if (!hasAlpha) img = img.removeAlpha();
    await img.webp({ quality, alphaQuality: 90, effort: 5, exact: true }).toFile(path.join(OUT, `${id}_${part.name}_${tag}.webp`));
  }
}
console.log(`${id}: ${p.length / 3} vertices, ${index.length / 3} triangles, ${skeleton.length} bones, height ${header.height.toFixed(2)}, parts ${parts.map((q) => `${q.name}:${q.count / 3}`).join(' ')}`);
