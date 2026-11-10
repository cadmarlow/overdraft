import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { MARGIN, bandsFor, listing, candidates } from '../js/tree-levels.js';
import { SPECIES, KINDS } from '../tools/trees/lib/species.mjs';
import { LEAF_KINDS, tileUV, ATLAS_W, ATLAS_H } from '../tools/trees/lib/foliage.mjs';
import { growTree } from '../tools/trees/lib/grow.mjs';
import { buildLevel } from '../tools/trees/lib/mesh.mjs';

const assets = new URL('../assets/trees/', import.meta.url);
const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const stats = JSON.parse(read('../tools/trees/lib/foliage-stats.json'));
const foliageOf = (sp) => ({ row: LEAF_KINDS.findIndex((k) => k.id === sp.leaf), tiles: stats[sp.leaf] });

// ---------------------------------------------------------------------------------------------------- levels of detail
test('every distance within reach is drawn by a level, and by two across each handover', () => {
  for (const k of [0.6, 1, 1.5]) {
    const b = bandsFor(k);
    assert.ok(b.near < b.far && b.far < b.reach && b.fade < b.near);
    for (let d = 0; d < b.reach; d += 0.5) {
      const bits = listing(d, b);
      assert.notEqual(bits, 0, `nothing at ${d} m`);
      // the material fades one level out and the next in over [edge - fade, edge]: both must be listed there, and a
      // little either side, since lists are only redone every few metres of camera travel
      if (d >= b.near - b.fade - MARGIN + 0.5 && d < b.near + MARGIN) assert.equal(bits & 3, 3, `full and light models at ${d} m`);
      if (d >= b.far - b.fade - MARGIN + 0.5 && d < b.far + MARGIN) assert.equal(bits & 6, 6, `light model and impostor at ${d} m`);
    }
    assert.equal(listing(1, b), 1, 'only the full model up close');
    assert.equal(listing((b.near + b.far) / 2, b), 2, 'only the light model in between');
    assert.equal(listing(b.far + MARGIN + 1, b), 4, 'only the impostor beyond');
    assert.equal(listing(b.reach + MARGIN + 1, b), 0, 'nothing beyond reach');
  }
  assert.ok(bandsFor(1.5).near > bandsFor(1).near && bandsFor(1).near > bandsFor(0.6).near, 'better graphics keep the full model further');
});

test('a surveyed tree gets the model nearest its trunk, then smaller ones where the street leaves less room', () => {
  const types = SPECIES.map((s) => ({ id: s.id, dbh: s.dbh }));
  for (let kind = 0; kind < 8; kind++) {
    const grown = types[kind * 2], young = types[kind * 2 + 1];
    assert.equal(candidates({ kind, dbh: Math.round(grown.dbh / 0.0254) }, types)[0].type, grown);
    assert.equal(candidates({ kind, dbh: Math.round(young.dbh / 0.0254) }, types)[0].type, young);
    const big = candidates({ kind, dbh: 60 }, types), small = candidates({ kind, dbh: 1 }, types);
    assert.equal(big[0].type, grown);
    assert.ok(big[0].scale <= 1.34 && small[0].scale >= 0.7, 'sizes stay within what a model can be stretched to');
    assert.equal(small[0].type, young);
    for (const list of [big, small]) {
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i];
        assert.ok(b.type === a.type ? b.scale < a.scale : a.type === grown && b.type === young, 'each try is smaller than the last');
      }
      assert.equal(list[list.length - 1].type, young);
    }
  }
  // the parks' authored trees carry a scale instead of a trunk: 1 is a grown tree
  assert.equal(candidates({ kind: 0, scale: 1 }, types)[0].type, types[0]);
  assert.equal(candidates({ kind: 0, scale: 0.5 }, types)[0].type, types[1]);
  assert.equal(candidates({ kind: 99 }, types)[0].type, types[14], 'an unknown kind is clamped');
});

// ---------------------------------------------------------------------------------------------------- the species
test('eight kinds, each grown and young, with a leaf row and a bark of their own', () => {
  assert.equal(SPECIES.length, 16);
  SPECIES.forEach((sp, i) => {
    assert.equal(sp.kind, i >> 1, sp.id);
    assert.equal(sp.id, `${KINDS[sp.kind]}-${i % 2 ? 'b' : 'a'}`);
    assert.ok(LEAF_KINDS.some((k) => k.id === sp.leaf), `${sp.id} leaf`);
    assert.ok(existsSync(new URL(`bark-${sp.bark}_c.webp`, assets)) && existsSync(new URL(`bark-${sp.bark}_n.webp`, assets)), `${sp.id} bark`);
    assert.ok(sp.crownBase >= sp.clearance - 0.5 && sp.clearance >= 1.9, `${sp.id} leaves headroom on the sidewalk`);
  });
  for (let k = 0; k < 8; k++) {
    assert.ok(SPECIES[k * 2].dbh > SPECIES[k * 2 + 1].dbh * 1.6, `${KINDS[k]} grown trunk`);
    assert.ok(SPECIES[k * 2].height > SPECIES[k * 2 + 1].height, `${KINDS[k]} grown height`);
  }
  for (const kind of LEAF_KINDS) {
    assert.equal(stats[kind.id]?.length, 4, `${kind.id} tiles`);
    for (const tile of stats[kind.id]) assert.ok(tile.size > 0.4 && tile.size < 3.5 && tile.cover > 0.12 && tile.foot >= 0.03 && tile.foot < 0.6, `${kind.id} tile`);
  }
  const uv = tileUV(LEAF_KINDS.length - 1, 3);
  assert.ok(uv.u1 <= 1 && uv.v1 <= 1 && uv.u0 > 0.75 && uv.v0 > 0.85);
});

test('a tree grows the same every time, thick where it carries much, inside its own outline', () => {
  for (const index of [0, 5, 8, 10, 15]) {
    const sp = SPECIES[index];
    const a = growTree(sp, 1 + index * 7919), b = growTree(sp, 1 + index * 7919);
    assert.deepEqual(a.branches.map((x) => x.pts), b.branches.map((x) => x.pts), `${sp.id} repeats`);
    assert.ok(a.sites.length > 60, `${sp.id} has leaves`);
    const trunk = a.branches[0];
    const breast = trunk.pts.findIndex((p) => p[1] >= 1.3);
    assert.ok(Math.abs(trunk.rad[breast] * 2 - sp.dbh) < sp.dbh * 0.25, `${sp.id} trunk diameter`);
    for (const branch of a.branches) {
      assert.ok(branch.rad.every(Number.isFinite) && branch.pts.every((p) => p.every(Number.isFinite)), `${sp.id} finite`);
      assert.ok(branch.rad[branch.rad.length - 1] <= branch.rad[0] * 1.001, `${sp.id} branches taper`);
      if (branch.parent < 0) continue;
      assert.ok(branch.parent < branch.index, 'parents come first');
      assert.ok(branch.rad[0] <= a.branches[branch.parent].rad[0] * 1.001, `${sp.id} a branch is thinner than what carries it`);
    }
    for (const s of a.sites) {
      assert.ok(s.p[1] >= sp.clearance - 0.01 && s.p[1] <= sp.height + 1.5, `${sp.id} leaves between the clearance and the top`);
      assert.ok(Math.hypot(s.p[0], s.p[2]) < sp.radius * 1.6, `${sp.id} leaves inside the crown`);
    }
  }
});

test('both levels of a tree are sound geometry, the light one a fraction of the full one', () => {
  for (const index of [1, 6, 12]) {
    const sp = SPECIES[index];
    const tree = growTree(sp, 1 + index * 7919);
    const [near, far] = [0, 1].map((lod) => buildLevel(tree, lod, foliageOf(sp), 1 + index * 7919));
    assert.ok(far.triangles < near.triangles / 4 && far.triangles > 60, `${sp.id}: ${near.triangles} / ${far.triangles}`);
    for (const gb of [near, far]) {
      const n = gb.vertices;
      assert.ok(gb.idx.every((i) => i >= 0 && i < n));
      assert.ok(gb.pos.every(Number.isFinite) && gb.uv.every(Number.isFinite));
      for (let i = 0; i < n; i++) assert.ok(Math.abs(Math.hypot(gb.nrm[i * 3], gb.nrm[i * 3 + 1], gb.nrm[i * 3 + 2]) - 1) < 0.02, 'unit normals');
      assert.ok(gb.wind.every((v) => v >= 0 && v <= 1) && gb.shade.every((v) => v >= 0 && v <= 1));
      // leaves carry atlas coordinates inside their species' row; the trunk does not sway against the ground
      const row = foliageOf(sp).row;
      for (let i = 0; i < n; i++) {
        if (gb.shade[i * 4 + 3] > 0.5) assert.ok(gb.uv[i * 2 + 1] >= row / LEAF_KINDS.length - 1e-6 && gb.uv[i * 2 + 1] <= (row + 1) / LEAF_KINDS.length + 1e-6);
        else if (gb.pos[i * 3 + 1] < 0.05) assert.equal(gb.wind[i * 4], 0);
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------------- what the game loads
function models() {
  const raw = gunzipSync(readFileSync(new URL('trees.bin.gz', assets)));
  assert.equal(raw.toString('latin1', 0, 4), 'OTR1');
  const length = raw.readUInt32LE(4);
  return { header: JSON.parse(raw.toString('utf8', 8, 8 + length)), size: raw.length - 8 - length };
}

test('the built models match the species, and every buffer lies inside the file', () => {
  const { header, size } = models();
  assert.equal(header.types.length, SPECIES.length);
  header.types.forEach((type, i) => {
    const sp = SPECIES[i];
    assert.equal(type.id, sp.id);
    assert.equal(type.kind, sp.kind);
    assert.equal(type.variant, i % 2);
    assert.equal(type.bark, sp.bark);
    assert.equal(type.dbh, sp.dbh);
    assert.ok(type.height > sp.height * 0.8 && type.height < sp.height * 1.25, `${sp.id} height ${type.height}`);
    assert.ok(type.gain >= 0.7 && type.gain <= 1.2);
    assert.ok(type.barkTint.every((v) => v > 0.05 && v < 4));
    assert.equal(type.levels.length, 2);
    for (const level of type.levels) {
      assert.equal(level.wide, level.vertices > 65535);
      const end = (offset, bytes) => { assert.equal(offset % 4, 0); assert.ok(offset + bytes <= size, `${sp.id} buffer`); };
      end(level.position, level.vertices * 12); end(level.normal, level.vertices * 4); end(level.uv, level.vertices * 8);
      end(level.wind, level.vertices * 4); end(level.shade, level.vertices * 4); end(level.index, level.triangles * 3 * (level.wide ? 4 : 2));
    }
    assert.ok(type.levels[0].triangles <= 16000, `${sp.id} full model: ${type.levels[0].triangles} triangles`);
    assert.ok(type.levels[1].triangles <= 2600, `${sp.id} light model: ${type.levels[1].triangles} triangles`);
  });
});

test('every tree has its own patch of the impostor atlas, with room for all its frames', () => {
  const { header } = models();
  const [w, h] = header.atlas, [cols, rows] = header.grid;
  const frames = header.rings.reduce((n, ring) => n + ring.n, 0);
  assert.ok(frames <= cols * rows);
  assert.equal(header.rings[header.rings.length - 1].n, 1, 'the last ring is the view from above');
  const rects = header.types.map((t) => t.impostor);
  rects.forEach((a, i) => {
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.size <= w && a.y + a.size <= h);
    assert.ok(a.frame * cols <= a.size && a.frame * rows <= a.size);
    assert.ok(a.half >= header.types[i].sphere.radius, 'the frame holds the whole tree');
    rects.forEach((b, j) => { if (j > i) assert.ok(a.x + a.size <= b.x || b.x + b.size <= a.x || a.y + a.size <= b.y || b.y + b.size <= a.y, 'no overlap'); });
  });
});

test('the tree assets are there, and stay light', () => {
  const files = ['trees.bin.gz', 'foliage_c.webp', 'foliage_n.webp', 'impostors_c.webp', 'impostors_n.webp'];
  let size = 0;
  for (const f of files) { assert.ok(existsSync(new URL(f, assets)), f); size += statSync(new URL(f, assets)).size; }
  assert.ok(size < 9e6, `${(size / 1e6).toFixed(1)} MB`);
  const loader = read('../js/tree-assets.js');
  for (const f of files) assert.ok(loader.includes(f), f);
});

// ---------------------------------------------------------------------------------------------------- one look, near and far
test('the material computes the surface the impostor frames were baked with', () => {
  const material = read('../js/tree-materials.js'), bake = read('../tools/trees/lib/draw.mjs');
  // a card's own tint
  assert.match(bake, /const b = 0\.84 \+ 0\.3 \* rnd;/);
  assert.match(material, /rnd\.mul\(0\.3\)\.add\(0\.84\)/);
  assert.match(bake, /rnd \* 7\.31/);
  assert.match(material, /rnd\.mul\(7\.31\)/);
  assert.match(bake, /1 \+ 0\.18 \* h\)/);
  assert.match(material, /h\.mul\(0\.18\)\.add\(1\.0\)/);
  assert.match(bake, /1 - 0\.22 \* h\)/);
  assert.match(material, /h\.mul\(-0\.22\)\.add\(1\.0\)/);
  // leaves in the crown's own shade, bark in it, the underside of a leaf
  assert.match(bake, /crownShade = \(ao\) => 0\.5 \+ 0\.5 \* ao;/);
  assert.match(material, /occlusion\.mul\(0\.5\)\.add\(0\.5\)\)\.mul\(under\)/);
  assert.match(bake, /barkShade = \(ao\) => 0\.55 \+ 0\.45 \* ao;/);
  assert.match(material, /occlusion\.mul\(0\.45\)\.add\(0\.55\)/);
  assert.match(bake, /UNDERSIDE = \[1\.12, 1\.14, 0\.94\]/);
  assert.match(material, /UNDERSIDE = vec3\(1\.12, 1\.14, 0\.94\)/);
});

test('levels hand over in the view only: every level casts its whole shadow', () => {
  const material = read('../js/tree-materials.js');
  assert.equal((material.match(/mat\.maskShadowNode = /g) || []).length, 2, 'the model and the impostor each have a mask for the shadow passes');
  for (const line of material.split('\n').filter((l) => l.includes('mat.maskShadowNode'))) assert.ok(!/fade|vFade/.test(line), 'no handover pattern in the shadow passes');
  assert.match(material, /treeUniforms\.view\.sub\(/, 'levels are judged from the player, not from whichever camera is drawing');
});
