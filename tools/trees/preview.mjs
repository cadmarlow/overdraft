// A look at the trees without the game: each one grown, meshed at both levels of detail and drawn in sunlight.
//   node tools/trees/preview.mjs <out folder> [--assets dir] [--size px] [--views side,under,top] [ids...]
// The assets folder must hold the foliage atlas (build-foliage.mjs) and the bark photographs.
import fs from 'node:fs';
import path from 'node:path';
import { SPECIES } from './lib/species.mjs';
import { growTree } from './lib/grow.mjs';
import { buildLevel, boundsOf } from './lib/mesh.mjs';
import { Raster } from './lib/raster.mjs';
import { loadTextures, drawTree, viewFrom, lit } from './lib/draw.mjs';
import { LEAF_KINDS } from './lib/foliage.mjs';
import { writePng } from './lib/image.mjs';

const args = process.argv.slice(2);
const OUT = args[0];
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const ASSETS = flag('--assets', new URL('../../assets/trees/', import.meta.url).pathname);
const SIZE = +flag('--size', 520);
const VIEWS = flag('--views', 'side,side2,lod1').split(',');
const skip = new Set(['--assets', '--size', '--views']);
const ids = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !skip.has(all[i - 1]));
if (!OUT) { console.error('usage: node preview.mjs <out folder> [ids...]'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const stats = JSON.parse(fs.readFileSync(new URL('./lib/foliage-stats.json', import.meta.url), 'utf8'));
const textures = await loadTextures(ASSETS, [...new Set(SPECIES.map((s) => s.bark))]);

export function foliageOf(sp) {
  return { row: LEAF_KINDS.findIndex((k) => k.id === sp.leaf), tiles: stats[sp.leaf] };
}

for (const sp of SPECIES) {
  if (ids.length && !ids.includes(sp.id)) continue;
  const t0 = Date.now();
  const seed = 1 + SPECIES.indexOf(sp) * 7919;
  const tree = growTree(sp, seed);
  const levels = [0, 1].map((lod) => buildLevel(tree, lod, foliageOf(sp), seed));
  const bounds = boundsOf(levels[0]);
  const half = bounds.radius * 1.02;
  const panels = [];
  for (const name of VIEWS) {
    const raster = new Raster(SIZE, SIZE, 2, 8);
    const lod = name === 'lod1' ? 1 : 0;
    const view = name === 'under' ? { ...viewFrom(0.6, -1.15, [0, sp.height * 0.55, 0], sp.radius * 1.1) }
      : name === 'top' ? viewFrom(0.6, 1.2, bounds.center, half)
        : name === 'close' ? viewFrom(0.6, 0.1, [sp.radius * 0.4, sp.crownBase + 1.5, 0], 2.6)
          : viewFrom(name === 'side2' ? 2.2 : 0.6, 0.08, bounds.center, half);
    drawTree(raster, levels[lod], view, textures, sp);
    panels.push(lit(raster.resolve()));
  }
  const sheet = Buffer.alloc(SIZE * panels.length * SIZE * 3);
  panels.forEach((p, k) => { for (let y = 0; y < SIZE; y++) p.copy(sheet, (y * SIZE * panels.length + k * SIZE) * 3, y * SIZE * 3, (y + 1) * SIZE * 3); });
  await writePng(path.join(OUT, `${sp.id}.png`), sheet, SIZE * panels.length, SIZE, 3);
  console.log(sp.id.padEnd(10), `${tree.branches.length} branches, ${tree.sites.length} twigs`,
    `| L0 ${levels[0].triangles} tris (${levels[0].cards} cards) | L1 ${levels[1].triangles} tris (${levels[1].cards} cards)`,
    `| r ${bounds.radius.toFixed(1)} m | ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
