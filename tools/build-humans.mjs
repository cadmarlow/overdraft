// Sculpts the people of the game into assets/humans/*.bin (node tools/build-humans.mjs [name] [detail]).
// Each file: a Uint32 header length, a JSON header, then position, normal (Float32 x3), skin index, skin weight (Uint8 x4),
// part (Uint8) and the triangle indices (Uint32), each aligned to 4 bytes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mesh } from './humans/mesher.mjs';
import { computeSkin } from './humans/skinning.mjs';
import { decimate, settle } from './humans/decimate.mjs';
import { OUTFITS, HAIR, PROPS, WEAPONS, layersFor, hairLayer, propLayer, weaponLayers } from './humans/outfits.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'assets/humans');
mkdirSync(out, { recursive: true });

const align = (n) => (n + 3) & ~3;

function bake(name, layers, female, suffix = '', budgetScale = 1) {
  const P = [], N = [], F = [], parts = [], skinI = [], skinW = [];
  const t0 = Date.now();
  for (const layer of layers) {
    const t = Date.now();
    const m = settle(layer.field, decimate(mesh(layer.field, layer.bounds, layer.voxel), Math.round(layer.budget * budgetScale)), layer.voxel);
    const base = P.length / 3;
    const skin = computeSkin(m.positions, layer.skin, female);
    for (let i = 0; i < m.positions.length; i++) P.push(m.positions[i]);
    for (let i = 0; i < m.normals.length; i++) N.push(m.normals[i]);
    for (let i = 0; i < m.faces.length; i++) F.push(m.faces[i] + base);
    for (let i = 0; i < m.positions.length / 3; i++) parts.push(layer.part);
    skinI.push(skin.indices); skinW.push(skin.weights);
    console.log(`  ${layer.name.padEnd(8)} ${String(m.faces.length / 3).padStart(7)} tri  ${Date.now() - t} ms`);
  }
  const count = P.length / 3;
  const concat = (list) => { const a = new Uint8Array(count * 4); let o = 0; for (const b of list) { a.set(b, o); o += b.length; } return a; };
  const sections = [new Float32Array(P), new Float32Array(N), concat(skinI), concat(skinW), Uint8Array.from(parts), new Uint32Array(F)];
  const header = JSON.stringify({ vertices: count, indices: F.length, sections: sections.map((s) => s.byteLength), female });
  const head = new TextEncoder().encode(header);
  const start = align(4 + head.length);
  const size = sections.reduce((o, s) => align(o + s.byteLength), start);
  const file = new Uint8Array(size);
  new DataView(file.buffer).setUint32(0, head.length, true);
  file.set(head, 4);
  let o = start;
  for (const s of sections) { file.set(new Uint8Array(s.buffer, s.byteOffset, s.byteLength), o); o = align(o + s.byteLength); }
  writeFileSync(resolve(out, `${name}${suffix}.bin`), file);
  console.log(`${name}${suffix}: ${F.length / 3} triangles, ${(size / 1048576).toFixed(2)} MB, ${Date.now() - t0} ms`);
}

// Full detail for the protagonist and everyone who fights; the crowd's bodies are a tenth of that
const FULL = ['hero', 'cop', 'hoodie', 'blazer', 'overcoat'];
const [only, level] = process.argv.slice(2);
for (const name of Object.keys(OUTFITS)) {
  if (only && only !== name) continue;
  if ((!level || level === 'full') && FULL.includes(name)) {
    const { layers, female } = layersFor(OUTFITS[name], 1);
    bake(name, layers, female);
  }
  if (!level || level === 'crowd') {
    const { layers, female } = layersFor(OUTFITS[name], 1.5);
    bake(name, layers, female, '-crowd', 0.1);
  }
}
for (const name of Object.keys(WEAPONS)) {
  if (only && only !== `weapon-${name}`) continue;
  bake(`weapon-${name}`, weaponLayers(name), false);
}
for (const name of Object.keys(PROPS)) {
  if (only && only !== `prop-${name}`) continue;
  bake(`prop-${name}`, [propLayer(name, 1)], false);
}
for (const name of Object.keys(HAIR)) {
  if (only && only !== `hair-${name}`) continue;
  for (const female of [false, true]) {
    const stem = `hair-${name}${female ? '-f' : ''}`;
    bake(stem, [hairLayer(name, female, 1)], female);
    bake(stem, [hairLayer(name, female, 1.5)], female, '-crowd', 0.12);
  }
}
