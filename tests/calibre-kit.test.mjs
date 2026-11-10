import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

// The gun shops' prop kit as it is shipped in assets/calibre (tools/calibre/build-kit.mjs writes it, js/calibre-kit.js
// reads it): every prop is a sane mesh at a believable size, sits on its anchor, reads its own part of the atlas, and
// the whole folder stays light.

const folder = new URL('../assets/calibre/', import.meta.url);
const info = JSON.parse(readFileSync(new URL('kit.json', folder), 'utf8'));
const bin = readFileSync(new URL('kit.bin', folder));
const buffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);

// The game's own decoder, lifted out of the loader (the module itself imports three.js, which Node cannot resolve here)
const source = readFileSync(new URL('../js/calibre-kit.js', import.meta.url), 'utf8');
const parseKit = new Function(`${source.match(/function parseKit\(buffer\) \{[\s\S]*?\n\}\n/)[0]}; return parseKit;`)();
const { header, props } = parseKit(buffer);
const byName = Object.fromEntries(props.map((p) => [p.name, p]));
const listed = Object.fromEntries(info.props.map((p) => [p.name, p]));

// Width and height of a WebP file, and whether it carries an alpha channel
function webp(name) {
  const b = readFileSync(new URL(name, folder));
  assert.equal(b.toString('ascii', 0, 4), 'RIFF', name);
  assert.equal(b.toString('ascii', 8, 12), 'WEBP', name);
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, alpha: false, bytes: b.length };
  if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, alpha: !!((bits >> 28) & 1), bytes: b.length }; }
  if (chunk === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1, alpha: !!(b[20] & 0x10), bytes: b.length };
  throw new Error(`${name}: unknown WebP chunk ${chunk}`);
}

test('the kit holds the props the shop is built from, each listed with its source and authors', () => {
  assert.equal(header.version, 1);
  assert.ok(props.length >= 24, `${props.length} props`);
  assert.deepEqual(props.map((p) => p.name), info.props.map((p) => p.name));
  assert.equal(new Set(props.map((p) => p.name)).size, props.length);
  for (const name of ['ammo_box', 'cash_register', 'shelves', 'tool_chest', 'toolbox', 'vice', 'drill_press', 'lamp_hanging', 'lamp_wall', 'lamp_tube', 'lamp_caged',
    'cardboard_box', 'crate', 'extinguisher', 'fire_alarm', 'first_aid', 'camera', 'stool', 'desk', 'hand_truck', 'duct', 'pipe']) assert.ok(byName[name], `${name} is missing`);
  for (const p of info.props) {
    assert.match(p.id, /^\w+$/, p.name);
    assert.ok(p.authors.length > 0, `${p.name} has no author`);
    assert.ok(['floor', 'wall', 'ceiling'].includes(p.anchor), p.name);
    assert.equal(byName[p.name].anchor, p.anchor);
    assert.equal(byName[p.name].triangles, p.triangles);
  }
});

test('every prop is a valid indexed mesh with unit normals', () => {
  for (const p of props) {
    assert.ok(p.vertices > 0 && p.vertices < 65536, `${p.name}: ${p.vertices} vertices`);
    assert.ok(p.triangles > 0, p.name);
    assert.equal(p.position.length, p.vertices * 3);
    assert.equal(p.normal.length, p.vertices * 3);
    assert.equal(p.uv.length, p.vertices * 2);
    assert.equal(p.index.length, p.triangles * 3);
    assert.ok(p.position instanceof Float32Array && p.normal instanceof Float32Array && p.uv instanceof Float32Array, `${p.name}: attributes must be Float32 to merge`);
    const used = new Uint8Array(p.vertices);
    let flat = 0;
    for (let t = 0; t < p.index.length; t += 3) {
      const [a, b, c] = [p.index[t], p.index[t + 1], p.index[t + 2]];
      assert.ok(a < p.vertices && b < p.vertices && c < p.vertices, `${p.name}: index out of range`);
      if (a === b || b === c || a === c) flat++;
      used[a] = used[b] = used[c] = 1;
    }
    assert.equal(flat, 0, `${p.name}: ${flat} triangles use a vertex twice`);
    assert.ok(used.every((u) => u === 1), `${p.name}: vertices nothing draws`);
    for (let v = 0; v < p.vertices; v++) {
      const l = Math.hypot(p.normal[v * 3], p.normal[v * 3 + 1], p.normal[v * 3 + 2]);
      assert.ok(Math.abs(l - 1) < 1e-3, `${p.name}: normal of length ${l}`);
      for (let c = 0; c < 3; c++) assert.ok(Number.isFinite(p.position[v * 3 + c]), p.name);
    }
  }
});

test('every prop sits on its anchor and inside the box it declares', () => {
  for (const p of props) {
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let v = 0; v < p.vertices; v++) for (let c = 0; c < 3; c++) {
      box[c] = Math.min(box[c], p.position[v * 3 + c]);
      box[c + 3] = Math.max(box[c + 3], p.position[v * 3 + c]);
    }
    for (let c = 0; c < 3; c++) {
      assert.ok(Math.abs(box[c] - p.min[c]) < 1e-4 && Math.abs(box[c + 3] - p.max[c]) < 1e-4, `${p.name}: its box is not its vertices'`);
      assert.ok(Math.abs(p.size[c] - (p.max[c] - p.min[c])) < 2e-4, `${p.name}: size`);
    }
    if (p.anchor === 'floor') {
      assert.ok(Math.abs(box[1]) < 1e-4, `${p.name} does not stand on y = 0 (${box[1]})`);
      // the origin is under the prop (its centre, or its foot for the desk lamp)
      assert.ok(box[0] < 0 && box[3] > 0 && box[2] < 0 && box[5] > 0, `${p.name}: origin outside its footprint`);
    } else if (p.anchor === 'wall') {
      assert.ok(Math.abs(box[2]) < 1e-4, `${p.name} is not against z = 0 (${box[2]})`);
      assert.ok(box[5] > 0.01, `${p.name} does not come out of the wall towards +z`);
      assert.ok(box[0] < 0 && box[3] > 0 && box[1] < 0 && box[4] > 0, `${p.name}: origin outside what touches the wall`);
    } else {
      assert.ok(Math.abs(box[4]) < 1e-4, `${p.name} does not hang from y = 0 (${box[4]})`);
      assert.ok(box[1] < -0.01, `${p.name} does not hang down`);
      assert.ok(box[0] < 0 && box[3] > 0 && box[2] < 0 && box[5] > 0, `${p.name}: origin outside what touches the ceiling`);
    }
  }
});

test('the props have the sizes of the real things', () => {
  const between = (name, axis, lo, hi) => {
    const v = byName[name].size[axis];
    assert.ok(v >= lo && v <= hi, `${name}: ${'xyz'[axis]} is ${v.toFixed(3)} m, expected ${lo} to ${hi}`);
  };
  between('ammo_box', 0, 0.2, 0.5); between('ammo_box', 1, 0.12, 0.25); between('ammo_box', 2, 0.06, 0.2);
  between('cash_register', 0, 0.35, 0.7); between('cash_register', 1, 0.35, 0.7); between('cash_register', 2, 0.3, 0.7);
  between('shelves', 0, 0.9, 1.3); between('shelves', 1, 1.8, 2.4); between('shelves', 2, 0.35, 0.65);
  between('shelves_narrow', 0, 0.45, 0.75); between('shelves_narrow', 1, 1.8, 2.4);
  between('tool_chest', 0, 0.5, 0.9); between('toolbox', 0, 0.3, 0.6);
  between('vice', 1, 0.12, 0.3); between('drill_press', 1, 0.7, 1.3);
  between('lamp_hanging', 1, 0.6, 1.6); between('lamp_wall', 1, 0.25, 0.6); between('lamp_tube', 0, 0.6, 1.3); between('lamp_caged', 0, 0.9, 1.4);
  between('cardboard_box', 1, 0.2, 0.5); between('crate', 0, 0.6, 1); between('crate_military', 0, 1, 1.5);
  between('extinguisher', 1, 0.5, 0.8); between('fire_alarm', 1, 0.1, 0.2); between('first_aid', 0, 0.35, 0.65); between('camera', 2, 0.25, 0.5);
  between('stool', 1, 0.6, 1); between('desk', 0, 1.4, 2.2); between('desk', 1, 0.7, 0.85); between('hand_truck', 1, 1.1, 1.6);
  between('duct', 0, 1.2, 2.4); between('pipe', 0, 1.2, 2.4); between('pipe', 1, 0.1, 0.3);
  // hand tools lie on their flat side, along x
  for (const name of ['bat', 'hatchet', 'crowbar', 'hammer', 'wrench', 'spanner', 'screwdriver']) {
    if (!byName[name]) continue;
    const [x, y, z] = byName[name].size;
    assert.ok(x > z && z >= y - 1e-3, `${name} does not lie along x on its flat side (${x}, ${y}, ${z})`);
    assert.ok(x > 0.2 && x < 1 && y < 0.07, `${name}: ${x} x ${y}`);
  }
  for (const p of props) for (let c = 0; c < 3; c++) assert.ok(p.size[c] > 0.015 && p.size[c] < 2.5, `${p.name}: ${p.size[c]} m`);
});

test('the triangle budgets are kept', () => {
  let total = 0;
  for (const p of info.props) {
    assert.ok(p.triangles <= p.budget, `${p.name}: ${p.triangles} triangles for a budget of ${p.budget}`);
    assert.ok(p.triangles <= p.sourceTriangles, p.name);
    total += p.triangles;
  }
  // the props the shop repeats or shows up close
  for (const [name, most] of Object.entries({ ammo_box: 900, cash_register: 2500, shelves: 1500, shelves_narrow: 1500, tool_chest: 2500, drill_press: 3500, cardboard_box: 400, fire_alarm: 400 })) {
    assert.ok(listed[name].triangles <= most, `${name}: ${listed[name].triangles} > ${most}`);
  }
  assert.ok(total <= 46000, `${total} triangles in the kit`);
});

test('every prop reads its own tiles of the atlas, inside their gutters', () => {
  const { size, gutter } = info.atlas;
  assert.equal(size, header.atlas);
  assert.ok(gutter >= 8);
  const all = info.props.flatMap((p) => p.rects.map((r) => ({ name: p.name, r })));
  for (const { name, r: [x, y, w, h] } of all) {
    assert.ok(x >= 0 && y >= 0 && x + w <= size && y + h <= size, `${name}: tile outside the atlas`);
    assert.ok(w > 2 * gutter && h > 2 * gutter, `${name}: tile smaller than its gutters`);
  }
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const [ax, ay, aw, ah] = all[i].r, [bx, by, bw, bh] = all[j].r;
    assert.ok(ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay, `${all[i].name} and ${all[j].name} share atlas pixels`);
  }
  for (const p of props) {
    const rects = listed[p.name].rects;
    for (let v = 0; v < p.vertices; v++) {
      const u = p.uv[v * 2] * size, w = p.uv[v * 2 + 1] * size;
      assert.ok(p.uv[v * 2] >= 0 && p.uv[v * 2] <= 1 && p.uv[v * 2 + 1] >= 0 && p.uv[v * 2 + 1] <= 1, `${p.name}: uv outside 0..1`);
      assert.ok(rects.some(([x, y, rw, rh]) => u >= x + gutter - 0.6 && u <= x + rw - gutter + 0.6 && w >= y + gutter - 0.6 && w <= y + rh - gutter + 0.6), `${p.name}: a uv (${u.toFixed(1)}, ${w.toFixed(1)}) outside its tiles`);
    }
  }
});

test('the lamps say where they shine from', () => {
  for (const name of ['lamp_hanging', 'lamp_wall', 'lamp_tube', 'lamp_caged', 'desk_lamp']) {
    const p = byName[name];
    assert.ok(p.lights?.length >= 1, `${name} has no light`);
    for (const light of p.lights) for (let c = 0; c < 3; c++) {
      assert.ok(light.at[c] >= p.min[c] - 1e-3 && light.at[c] <= p.max[c] + 1e-3, `${name}: light outside the prop`);
      assert.ok(light.min[c] <= light.at[c] + 1e-3 && light.max[c] >= light.at[c] - 1e-3, name);
    }
  }
  assert.ok(byName.lamp_hanging.lights[0].at[1] < -0.5, 'the hanging lamp shines from its shade, not from the ceiling');
  assert.ok(byName.lamp_wall.lights[0].at[2] > 0.02, 'the wall lamp shines in front of the wall');
});

test('the atlas and the surfaces are the images the loader expects, without alpha', () => {
  for (const key of ['colour', 'normal', 'orm', 'emission']) {
    const image = webp(info.atlas[key]);
    assert.equal(image.width, info.atlas.size, info.atlas[key]);
    assert.equal(image.height, info.atlas.size, info.atlas[key]);
    assert.equal(image.alpha, false, `${info.atlas[key]} has an alpha channel (WebP drops the colour under it)`);
  }
  assert.deepEqual(Object.keys(info.surfaces).sort(), ['ceiling', 'foam', 'plaster', 'plate', 'rubber', 'slats']);
  for (const [name, surface] of Object.entries(info.surfaces)) {
    assert.ok(surface.metres >= 0.25 && surface.metres <= 4, `${name}: ${surface.metres} m`);
    assert.ok(surface.id || surface.source, `${name}: no source`);
    if (surface.id) assert.ok(surface.authors.length > 0, `${name} has no author`);
    const c = webp(`surf_${name}_c.webp`), n = webp(`surf_${name}_n.webp`), r = webp(`surf_${name}_r.webp`);
    assert.deepEqual([c.width, c.height, n.width, n.height], [1024, 1024, 1024, 1024], name);
    assert.ok(r.width === r.height && r.width >= 512, name);
    assert.ok(!c.alpha && !n.alpha && !r.alpha, `${name} has an alpha channel`);
  }
});

test('the folder stays light', () => {
  let total = 0;
  for (const name of readdirSync(folder)) total += statSync(new URL(name, folder)).size;
  assert.ok(total <= 5 * 1024 * 1024, `assets/calibre weighs ${(total / 1024 / 1024).toFixed(2)} MB`);
  const atlas = ['colour', 'normal', 'orm'].reduce((sum, key) => sum + statSync(new URL(info.atlas[key], folder)).size, 0);
  assert.ok(atlas <= 3 * 1024 * 1024, `the atlas weighs ${(atlas / 1024 / 1024).toFixed(2)} MB`);
  assert.ok(bin.length <= 1.5 * 1024 * 1024, `kit.bin weighs ${(bin.length / 1024).toFixed(0)} kB`);
});

test('every Poly Haven asset of the kit is credited', () => {
  const credits = readFileSync(new URL('../CREDITS.md', import.meta.url), 'utf8');
  const ids = new Set([...info.props.map((p) => p.id), ...Object.values(info.surfaces).map((s) => s.id).filter(Boolean)]);
  for (const id of ids) assert.ok(credits.includes(`https://polyhaven.com/a/${id}`), `${id} is not in CREDITS.md`);
  for (const p of [...info.props, ...Object.values(info.surfaces)]) for (const author of p.authors) assert.ok(credits.includes(author), `${author} is not in CREDITS.md`);
});

test('the loader is preloaded with the game', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('<link rel="modulepreload" href="./js/calibre-kit.js" />'));
});
