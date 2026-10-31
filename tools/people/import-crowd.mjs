// A Rocketbox avatar for the street: reposed onto the game's 23-bone skeleton (js/human-skeleton.js) so the crowd's pose
// buffer drives it unchanged, decimated, its textures gathered into one atlas.
// Usage: node import-crowd.mjs <id> <file.fbx> <texture dir> <m|f> [--body 2800] [--head 1900] [--out dir]
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';
import { readAvatar, packed } from './avatar.mjs';
import { readTGA, bleed, resized } from './tga.mjs';
import { bindJointPositions } from '../../js/human-skeleton.js';
import { bipToGame } from './bip-map.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const [id, fbx, textures, sex] = args;
const BODY_TRIANGLES = +flag('body', 2800);
const HEAD_TRIANGLES = +flag('head', 1900);
const OUT = flag('out', new URL('../../assets/people/', import.meta.url).pathname);
const avatar = readAvatar(fbx);
const female = sex === 'f';
const joints = bindJointPositions(female);
const { mapping, weightsOf } = bipToGame(avatar.skeleton, avatar.bind, joints);

// Repose: each bone carries its vertices rigidly from its bind place to the game's
const count = avatar.p.length / 3;
const position = new Float32Array(count * 3), normal = new Float32Array(count * 3);
const v = new THREE.Vector3(), n = new THREE.Vector3(), sum = new THREE.Vector3(), nsum = new THREE.Vector3(), t = new THREE.Vector3();
const skinIndex = new Uint8Array(count * 4), skinWeight = new Uint8Array(count * 4);
for (let i = 0; i < count; i++) {
  v.fromArray(avatar.p, i * 3);
  n.fromArray(avatar.n, i * 3);
  sum.set(0, 0, 0); nsum.set(0, 0, 0);
  const merged = new Map();
  for (let k = 0; k < 4; k++) {
    const w = avatar.sw[i * 4 + k] / 255;
    if (!w) continue;
    const b = avatar.si[i * 4 + k];
    const m = mapping[b];
    t.subVectors(v, m.from).applyQuaternion(m.swing).add(m.to);
    sum.addScaledVector(t, w);
    nsum.addScaledVector(t.copy(n).applyQuaternion(m.swing), w);
    for (const [g, share] of weightsOf(b)) merged.set(g, (merged.get(g) ?? 0) + w * share);
  }
  sum.toArray(position, i * 3);
  nsum.normalize().toArray(normal, i * 3);
  const list = [...merged].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = list.reduce((s, [, x]) => s + x, 0);
  const bytes = list.map(([, x]) => Math.round((x / total) * 255));
  bytes[0] += 255 - bytes.reduce((a, b) => a + b, 0);
  list.forEach(([g], k) => { skinIndex[i * 4 + k] = g; skinWeight[i * 4 + k] = bytes[k]; });
}

// Atlas: the body large, then the head and whatever else is painted separately
const ATLAS = 1024;
const SLOTS = [[0, 0, 1024, 700], [0, 700, 342, 324], [342, 700, 341, 324], [683, 700, 341, 324]];
const parts = [...avatar.parts].sort((a, b) => (a.name === 'body' ? -1 : b.name === 'body' ? 1 : a.name === 'head' ? -1 : b.name === 'head' ? 1 : 0));
if (parts.length > SLOTS.length) console.log(`${id}: ${parts.length} parts, ${parts.slice(SLOTS.length).map((p) => p.name)} dropped`);
const uv = new Float32Array(count * 2);
const atlas = Buffer.alloc(ATLAS * ATLAS * 4);
for (let i = 0; i < atlas.length; i += 4) { atlas[i] = atlas[i + 1] = atlas[i + 2] = 40; atlas[i + 3] = 255; }
const files = fs.readdirSync(textures);
const GUTTER = 3;
for (const [i, part] of parts.slice(0, SLOTS.length).entries()) {
  const [x, y, w, h] = SLOTS[i];
  for (let f = part.start; f < part.start + part.count; f++) {
    const at = avatar.index[f];
    const a = avatar.uv[at * 2], b = avatar.uv[at * 2 + 1];
    uv[at * 2] = (x + GUTTER + (a - Math.floor(a)) * (w - 2 * GUTTER)) / ATLAS;
    uv[at * 2 + 1] = (y + GUTTER + (b - Math.floor(b)) * (h - 2 * GUTTER)) / ATLAS;
  }
  const file = files.find((f) => f.toLowerCase() === `${part.material}_color.tga`.toLowerCase());
  if (!file) { console.log(`${id}: no texture for ${part.name}`); continue; }
  const { width, height, rgba } = readTGA(path.join(textures, file));
  const alpha = part.name.includes('opacity');
  if (alpha) bleed(rgba, width, height);
  else for (let c = 3; c < rgba.length; c += 4) rgba[c] = 255;
  // a little past the slot's inner edge, so mipmaps don't pull in the neighbour
  const W = w - 2 * GUTTER + 4, H = h - 2 * GUTTER + 4, left = x + GUTTER - 2, top = y + GUTTER - 2;
  const pixels = await resized(rgba, width, height, W, H);
  for (let r = 0; r < H; r++) pixels.copy(atlas, ((top + r) * ATLAS + left) * 4, r * W * 4, (r + 1) * W * 4);
}
await sharp(atlas, { raw: { width: ATLAS, height: ATLAS, channels: 4 } }).webp({ quality: 84, alphaQuality: 90, effort: 5, exact: true }).toFile(path.join(OUT, `crowd-${id}.webp`));

// Fewer triangles, keeping texture seams and silhouette: clothes give way first, faces last
await MeshoptSimplifier.ready;
const attributes = new Float32Array(count * 5);
for (let i = 0; i < count; i++) attributes.set([uv[i * 2], uv[i * 2 + 1], normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]], i * 5);
const simple = [];
let error = 0;
for (const part of parts.slice(0, SLOTS.length)) {
  const list = Uint32Array.from(avatar.index.slice(part.start, part.start + part.count));
  const target = part.name === 'body' ? BODY_TRIANGLES : part.name === 'head' ? HEAD_TRIANGLES : list.length / 3;
  const [kept, e] = MeshoptSimplifier.simplifyWithAttributes(list, position, 3, attributes, 5, [2, 2, 0.4, 0.4, 0.4], null, Math.min(target * 3, list.length), 0.02, ['LockBorder']);
  simple.push(...kept);
  error = Math.max(error, e);
}

const used = new Map();
const index = Uint32Array.from(simple, (o) => { if (!used.has(o)) used.set(o, used.size); return used.get(o); });
const pick = (src, size, Type) => { const a = new Type(used.size * size); for (const [o, i] of used) for (let c = 0; c < size; c++) a[i * size + c] = src[o * size + c]; return a; };
const data = packed({ version: 1, bones: [], parts: [], height: 0, female, sections: [used.size * 12, used.size * 12, used.size * 8, used.size * 4, used.size * 4, index.length * 4, 0] },
  [pick(position, 3, Float32Array), pick(normal, 3, Float32Array), pick(uv, 2, Float32Array), pick(skinIndex, 4, Uint8Array), pick(skinWeight, 4, Uint8Array), index]);
fs.writeFileSync(path.join(OUT, `crowd-${id}.bin`), data);
console.log(`crowd-${id}: ${avatar.index.length / 3} → ${index.length / 3} triangles, ${used.size} vertices, error ${error.toFixed(4)}, ${parts.map((p) => p.name).join(' ')}`);
