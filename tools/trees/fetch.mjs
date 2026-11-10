// Downloads what the trees are made from (all CC0), into a folder outside the repository:
//   node tools/trees/fetch.mjs <folder>
// ambientCG leaf scans (one sheet of leaves per set), the jacaranda fronds of Poly Haven's tree model, and Poly
// Haven's bark photographs. Nothing here is loaded by the game: build-bark.mjs, build-foliage.mjs and build-trees.mjs
// turn it into assets/trees.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const direct = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
const OUT = process.argv[2];
if (direct && !OUT) { console.error('usage: node fetch.mjs <folder>'); process.exit(1); }
const AGENT = { 'User-Agent': 'overdraft-game-tools' };

export const LEAF_SETS = ['LeafSet004', 'LeafSet009', 'LeafSet010', 'LeafSet014', 'LeafSet016', 'LeafSet022', 'LeafSet024'];
const POLYHAVEN = 'https://dl.polyhaven.org/file/ph-assets/Models/jpg/2k/jacaranda_tree/';
const FRONDS = ['leaves_diff', 'leaves_alpha', 'leaves_nor_gl'];
// The bark each kind of tree wears (the game's name: Poly Haven's texture)
export const BARKS = { plane: 'bark_platanus', elm: 'japanese_zelkova_bark', locust: 'bark_brown_02', oak: 'jolcham_oak_bark_01' };
const TEXTURES = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/';

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return false;
  const response = await fetch(url, { headers: AGENT, redirect: 'follow' });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return true;
}

for (const id of direct ? LEAF_SETS : []) {
  const dir = path.join(OUT, id);
  const zip = path.join(OUT, `${id}_2K-JPG.zip`);
  if (fs.existsSync(path.join(dir, `${id}_2K-JPG_Color.jpg`))) { console.log(id, 'already here'); continue; }
  await download(`https://ambientcg.com/get?file=${id}_2K-JPG.zip`, zip);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
  fs.rmSync(zip);
  console.log(id, fs.readdirSync(dir).length, 'files');
}
for (const id of direct ? Object.values(BARKS) : []) {
  for (const map of ['diff', 'nor_gl']) {
    const name = `${id}_${map}_2k.jpg`;
    const fresh = await download(`${TEXTURES}${id}/${name}`, path.join(OUT, id, name));
    console.log(name, fresh ? 'downloaded' : 'already here');
  }
}
for (const map of direct ? FRONDS : []) {
  const name = `jacaranda_tree_${map}_2k.jpg`;
  const fresh = await download(POLYHAVEN + name, path.join(OUT, 'jacaranda_tree', name));
  console.log(name, fresh ? 'downloaded' : 'already here');
}
