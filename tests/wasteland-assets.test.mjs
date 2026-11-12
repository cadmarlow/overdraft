import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';

// The Wasteland's art as it is shipped in assets/wasteland (tools/wasteland/build-surfaces.mjs and build-kit.mjs write
// it, js/wasteland-surfaces.js and js/wasteland-kit.js read it): every file the manifests name is there, the surfaces
// are packed as the ground shaders expect, every prop is a sane mesh at a believable size with its two levels, and
// both sets stay within their weight.

const folder = new URL('../assets/wasteland/', import.meta.url);
const surfaces = JSON.parse(readFileSync(new URL('surfaces.json', folder), 'utf8'));
const kit = JSON.parse(readFileSync(new URL('kit.json', folder), 'utf8'));
const bytes = (name) => statSync(new URL(name, folder)).size;
const MB = 1024 * 1024;

// Width and height of a WebP file, and whether it carries an alpha channel
function webp(name) {
  const b = readFileSync(new URL(name, folder));
  assert.equal(b.toString('ascii', 0, 4), 'RIFF', name);
  assert.equal(b.toString('ascii', 8, 12), 'WEBP', name);
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, alpha: false };
  if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, alpha: !!((bits >> 28) & 1) }; }
  if (chunk === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1, alpha: !!(b[20] & 0x10) };
  throw new Error(`${name}: unknown WebP chunk ${chunk}`);
}

// The game's own decoder, lifted out of the loader (the module itself imports three.js, which Node cannot resolve here)
const kitSource = readFileSync(new URL('../js/wasteland-kit.js', import.meta.url), 'utf8');
const surfaceSource = readFileSync(new URL('../js/wasteland-surfaces.js', import.meta.url), 'utf8');
const parseKit = new Function(`${kitSource.match(/function parseKit\(buffer\) \{[\s\S]*?\n\}\n/)[0]}; return parseKit;`)();
const bin = readFileSync(new URL(kit.bin, folder));
const { header, props } = parseKit(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const listed = Object.fromEntries(kit.props.map((p) => [p.name, p]));

test('every surface the desert shaders name is there, packed like the city\'s ground', () => {
  const names = Object.keys(surfaces).filter((n) => n !== 'macro');
  for (const name of ['dune', 'sand', 'crack', 'salt', 'gravel', 'cliff', 'slab', 'rust', 'sheet', 'bunker']) assert.ok(names.includes(name), `${name} is missing`);
  for (const name of names) {
    const s = surfaces[name];
    assert.match(s.id, /^\w+$/, name);
    assert.ok(s.authors.length > 0, `${name} has no author`);
    assert.ok(s.metres >= 1 && s.metres <= 12, `${name}: ${s.metres} m a repeat`);
    assert.equal(s.mean.length, 3, name);
    for (const m of s.mean) assert.ok(m > 0.005 && m < 0.9, `${name}: mean albedo ${s.mean}`);
    assert.ok(s.roughness > 0.3 && s.roughness <= 1, `${name}: roughness ${s.roughness}`);
    assert.equal(s.color, `${name}_c.webp`);
    assert.equal(s.normal, `${name}_n.webp`);
    // colour carries the height in its alpha, the normal map carries the roughness
    for (const file of [s.color, s.normal]) {
      assert.ok(existsSync(new URL(file, folder)), `${file} is missing`);
      assert.deepEqual(webp(file), { width: 1024, height: 1024, alpha: true }, file);
    }
  }
  // the dry ground of a desert is not dark, and no surface is a mirror
  assert.ok(surfaces.dune.roughness > 0.8 && surfaces.bunker.roughness > 0.75);
});

test('the aerial photograph for the large tone changes is there', () => {
  const { macro } = surfaces;
  assert.ok(macro && macro.authors.length > 0);
  assert.ok(macro.metres >= 15, `${macro.metres} m`);
  assert.equal(macro.mean.length, 3);
  assert.ok(existsSync(new URL(macro.color, folder)));
  const image = webp(macro.color);
  assert.equal(image.width, 1024);
  assert.equal(image.height, 1024);
});

test('the surfaces stay within their weight', () => {
  let total = 0;
  for (const s of Object.values(surfaces)) for (const file of [s.color, s.normal]) if (file) total += bytes(file);
  assert.ok(total < 6.8 * MB, `${(total / MB).toFixed(2)} MB of surfaces`);
});

test('the kit\'s files are there, the atlas is what the manifest says, and the kit stays within its weight', () => {
  const { atlas } = kit;
  for (const file of [kit.bin, atlas.colour, atlas.normal, atlas.orm]) assert.ok(existsSync(new URL(file, folder)), `${file} is missing`);
  assert.deepEqual(header.atlas, [atlas.width, atlas.height]);
  const colour = webp(atlas.colour), normal = webp(atlas.normal), orm = webp(atlas.orm);
  assert.deepEqual([colour.width, colour.height], [atlas.width, atlas.height]);
  assert.deepEqual([normal.width, normal.height], [atlas.width, atlas.height]);
  assert.deepEqual([orm.width, orm.height], [atlas.width * atlas.ormScale, atlas.height * atlas.ormScale]);
  for (const side of [atlas.width, atlas.height]) assert.ok(side <= 4096 && Number.isInteger(Math.log2(side)), `${side} px`);
  // the cut-outs live in the alpha of the colour atlas
  assert.equal(colour.alpha, atlas.cutOuts > 0);
  const total = [kit.bin, atlas.colour, atlas.normal, atlas.orm, 'kit.json'].reduce((sum, file) => sum + bytes(file), 0);
  assert.ok(total < 6 * MB, `${(total / MB).toFixed(2)} MB of kit`);
});

test('the kit holds what a wasteland is dressed with, each prop listed with its source and authors', () => {
  assert.equal(header.version, 1);
  assert.deepEqual(props.map((p) => p.name), kit.props.map((p) => p.name));
  assert.equal(new Set(props.map((p) => p.name)).size, props.length);
  const count = (kind) => kit.props.filter((p) => p.kind === kind).length;
  assert.ok(kit.props.filter((p) => /^boulder_/.test(p.name)).length >= 5, 'five boulders');
  assert.ok(count('rock') >= 8 && count('wood') >= 2 && count('plant') >= 1 && count('clutter') >= 15 && count('big') >= 2);
  for (const name of ['rubble', 'outcrop_a', 'dead_trunk', 'barrel_red', 'tyre', 'tyre_stack', 'jerrycan', 'road_barrier', 'crate', 'fence', 'covered_car']) assert.ok(listed[name], `${name} is missing`);
  for (const p of kit.props) {
    assert.match(p.id, /^\w+$/, p.name);
    assert.ok(p.authors.length > 0, `${p.name} has no author`);
    assert.ok(['rock', 'wood', 'plant', 'clutter', 'big'].includes(p.kind), p.name);
  }
});

test('every prop has two levels, both valid indexed meshes with unit normals', () => {
  for (const p of props) {
    assert.deepEqual(Object.keys(p.levels), ['full', 'low'], p.name);
    for (const [level, l] of Object.entries(p.levels)) {
      const at = `${p.name} ${level}`;
      assert.equal(l.triangles, listed[p.name].triangles[level], at);
      assert.ok(l.vertices > 0 && l.vertices < 65536, `${at}: ${l.vertices} vertices`);
      assert.equal(l.position.length, l.vertices * 3);
      assert.equal(l.normal.length, l.vertices * 3);
      assert.equal(l.uv.length, l.vertices * 2);
      assert.equal(l.index.length, l.triangles * 3);
      assert.ok(l.position instanceof Float32Array && l.normal instanceof Float32Array && l.uv instanceof Float32Array, `${at}: attributes must be Float32 to merge`);
      const used = new Uint8Array(l.vertices);
      let flat = 0;
      for (let t = 0; t < l.index.length; t += 3) {
        const [a, b, c] = [l.index[t], l.index[t + 1], l.index[t + 2]];
        assert.ok(a < l.vertices && b < l.vertices && c < l.vertices, `${at}: index out of range`);
        if (a === b || b === c || a === c) flat++;
        used[a] = used[b] = used[c] = 1;
      }
      assert.equal(flat, 0, `${at}: ${flat} triangles use a vertex twice`);
      assert.ok(used.every((u) => u === 1), `${at}: vertices nothing draws`);
      for (let v = 0; v < l.vertices; v++) {
        const length = Math.hypot(l.normal[v * 3], l.normal[v * 3 + 1], l.normal[v * 3 + 2]);
        assert.ok(Math.abs(length - 1) < 1e-3, `${at}: normal of length ${length}`);
        for (let c = 0; c < 3; c++) assert.ok(Number.isFinite(l.position[v * 3 + c]), at);
      }
    }
  }
});

test('the levels cost what they should: a full level a player can stand next to, a low level for the distance', () => {
  for (const p of kit.props) {
    const { full, low } = p.triangles;
    assert.ok(full <= 3000, `${p.name}: ${full} triangles`);
    assert.ok(low < full, `${p.name}: low (${low}) is not lighter than full (${full})`);
    assert.ok(low <= full * 0.8, `${p.name}: low (${low}) saves too little of full (${full})`);
    // the rocks are instanced up to 6 m: they keep enough triangles for their silhouette to hold
    if (/^boulder_|^outcrop_|^slab$/.test(p.name)) {
      assert.ok(full >= 1200, `${p.name}: ${full} triangles`);
      assert.ok(low >= 300 && low <= full * 0.3, `${p.name}: low ${low} of ${full}`);
    }
    if (p.kind === 'clutter') assert.ok(full >= 200 && full <= 2100, `${p.name}: ${full} triangles`);
  }
});

test('every prop is at a believable size, inside the box it declares, with its base where it says', () => {
  for (const p of props) {
    const info = listed[p.name];
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const l of Object.values(p.levels)) {
      for (let v = 0; v < l.vertices; v++) for (let c = 0; c < 3; c++) {
        box[c] = Math.min(box[c], l.position[v * 3 + c]);
        box[c + 3] = Math.max(box[c + 3], l.position[v * 3 + c]);
      }
    }
    for (let c = 0; c < 3; c++) {
      assert.ok(Math.abs(box[c] - p.min[c]) < 2e-3 && Math.abs(box[c + 3] - p.max[c]) < 2e-3, `${p.name}: its box is not the one declared`);
      assert.ok(Math.abs(p.size[c] - (p.max[c] - p.min[c])) < 1e-3, p.name);
      assert.ok(p.size[c] > 0.02 && p.size[c] < 25, `${p.name}: ${p.size} m`);
    }
    assert.deepEqual(info.size, p.size);
    // the origin is the centre of the footprint; a pole's is its post, wherever its cross arms and its stay reach
    if (p.name === 'power_pole') assert.ok(p.min[0] < -0.07 && p.max[0] > 0.07 && p.min[2] < -0.07 && p.max[2] > 0.07, 'the pole does not stand on its origin');
    else assert.ok(Math.abs(p.min[0] + p.max[0]) < 0.02 && Math.abs(p.min[2] + p.max[2]) < 0.02, `${p.name} is not centred on its footprint`);
    // on the ground, or with a skirt to bury
    assert.equal(info.grounded, p.min[1] > -0.005, p.name);
    assert.ok(Math.abs(info.buried - Math.max(0, -p.min[1])) < 2e-3, p.name);
    if (info.grounded) assert.ok(Math.abs(p.min[1]) < 0.005, `${p.name} floats ${p.min[1]} m`);
    else assert.ok(info.buried < p.size[1] * 0.35, `${p.name}: ${info.buried} m of ${p.size[1]} m are under the ground`);
  }
  const size = (name) => listed[name].size;
  for (const p of kit.props.filter((q) => /^boulder_/.test(q.name))) assert.ok(Math.max(...p.size) > 1 && Math.max(...p.size) < 4, `${p.name}: ${p.size} m`);
  assert.ok(size('barrel_red')[1] > 0.8 && size('barrel_red')[1] < 1, 'a barrel is 88 cm tall');
  assert.ok(size('tyre')[0] > 0.5 && size('tyre')[0] < 0.8 && size('tyre')[1] < 0.25, 'a tyre lies flat');
  assert.ok(size('tyre_stack')[1] > 3.5 * size('tyre')[1], 'four tyres make a stack');
  assert.ok(size('covered_car')[2] > 4 && size('covered_car')[2] < 5 && size('covered_car')[1] < 1.6, 'a car under its tarpaulin');
  assert.ok(size('fence')[1] > 2 && size('fence')[2] < 0.1, 'a fence panel stands and is thin');
  assert.ok(size('power_pole')[1] > 5.5 && size('road_barrier')[1] > 0.7 && size('outcrop_b')[0] > 15);
});

test('every prop reads its own part of the atlas', () => {
  const { width, height, gutter } = kit.atlas;
  for (const p of props) {
    const { rects } = listed[p.name];
    assert.ok(rects.length > 0, p.name);
    for (const [x, y, w, h] of rects) assert.ok(x >= 0 && y >= 0 && x + w <= width && y + h <= height, `${p.name}: a tile leaves the atlas`);
    for (const [level, l] of Object.entries(p.levels)) {
      for (let v = 0; v < l.vertices; v++) {
        const px = l.uv[v * 2] * width, py = l.uv[v * 2 + 1] * height;
        const inside = rects.some(([x, y, w, h]) => px >= x + gutter - 0.5 && px <= x + w - gutter + 0.5 && py >= y + gutter - 0.5 && py <= y + h - gutter + 0.5);
        assert.ok(inside, `${p.name} ${level}: a vertex reads (${px.toFixed(1)}, ${py.toFixed(1)}), outside its tiles`);
      }
    }
  }
  // the two levels of a prop, and the stack made of a prop, share their tiles
  assert.deepEqual(listed.tyre_stack.rects, listed.tyre.rects);
});

test('the suggested colliders fit their props', () => {
  for (const p of kit.props) {
    const c = p.collider;
    if (!c) { assert.ok(p.kind === 'plant' || p.name === 'dead_branch', `${p.name} has no collider`); continue; }
    const top = p.max[1], foot = Math.max(0, p.min[1]);
    assert.equal(c.centre.length, 3, p.name);
    assert.ok(Math.abs(c.centre[1] - (top + foot) / 2) < 0.01, `${p.name}: the collider is not centred in height`);
    if (c.radius !== undefined) {
      assert.ok(c.radius > 0.05 && c.radius <= Math.max(p.size[0], p.size[2]) / 2 + 0.01, `${p.name}: radius ${c.radius}`);
      assert.ok(Math.abs(c.centre[0]) < 0.02 && Math.abs(c.centre[2]) < 0.02, `${p.name}: the cylinder is not on the origin`);
      assert.ok(Math.abs(c.height - (top - foot)) < 0.01, `${p.name}: height ${c.height}`);
    } else {
      assert.equal(c.half.length, 3, p.name);
      assert.ok(Math.abs(c.half[0] - p.size[0] / 2) < 0.01 && Math.abs(c.half[2] - p.size[2] / 2) < 0.01 && Math.abs(c.half[1] - (top - foot) / 2) < 0.01, `${p.name}: half extents ${c.half}`);
    }
  }
  assert.ok(listed.barrel_red.collider.radius > 0.25 && listed.barrel_red.collider.radius < 0.32);
  assert.ok(listed.power_pole.collider.radius < 0.2, 'a pole is hit on its post, not on its cross arms');
});

test('the flags say how each prop must be drawn', () => {
  for (const p of kit.props) {
    assert.equal(typeof p.cutout, 'boolean', p.name);
    assert.equal(typeof p.twoSided, 'boolean', p.name);
    if (p.cutout) assert.ok(p.twoSided, `${p.name}: a cut-out is seen from both sides`);
  }
  assert.ok(listed.fence.cutout && listed.bush.cutout);
  assert.ok(!listed.boulder_b.cutout && !listed.boulder_b.twoSided && !listed.barrel_red.twoSided);
  assert.equal(kit.props.filter((p) => p.cutout).length > 0, kit.atlas.cutOuts > 0);
  // a cliff face is a shell: the manifest says so
  assert.ok(listed.outcrop_a.shell && listed.outcrop_b.shell && listed.outcrop_a.twoSided);
});

test('the loaders are self-contained and nothing loads them behind the game\'s back', () => {
  for (const [name, source] of [['wasteland-kit.js', kitSource], ['wasteland-surfaces.js', surfaceSource]]) {
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    assert.deepEqual(imports, ['three/webgpu'], `${name} imports ${imports}`);
    assert.ok(source.includes("new URL('../assets/wasteland/', import.meta.url)"), name);
    assert.ok(!/MeshStandardNodeMaterial\(|NodeMaterial\(\{/.test(source.replace(/^\/\/.*$/gm, '')), `${name} makes a material`);
  }
  assert.match(kitSource, /export \{ KIT as WASTELAND_KIT, loadWastelandKit, wastelandProp \};/);
  assert.match(surfaceSource, /export \{ surfaces, loadWastelandSurfaces \};/);
});

test('every Poly Haven asset of the Wasteland is credited', () => {
  const credits = readFileSync(new URL('../CREDITS.md', import.meta.url), 'utf8');
  const ids = new Set([...Object.values(surfaces).map((s) => s.id), ...kit.props.map((p) => p.id)]);
  for (const id of ids) assert.ok(credits.includes(`https://polyhaven.com/a/${id}`), `${id} is not in CREDITS.md`);
});
