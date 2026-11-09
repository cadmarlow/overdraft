// Turns a downloaded firearm model (glTF / GLB) into what the game loads from assets/weapons: one .bin with the geometry
// cut into moving parts, and three WebP maps per material (colour, normal, occlusion-roughness-metal).
// Everything about a weapon is said in weapons.json (which nodes make which part, how the source is oriented, where the
// hands go); nothing here is specific to one model.
//
//   node import.mjs <folder holding the downloads> [weapon ids...]     (all of weapons.json by default)
//
// sharp and meshoptimizer come from tools/people: run `npm install` there once.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readGLTF } from './gltf.mjs';

const require = createRequire(new URL('../people/', import.meta.url));
const sharp = require('sharp');
const here = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(here, '../../assets/weapons');
const config = JSON.parse(fs.readFileSync(path.join(here, 'weapons.json'), 'utf8'));
const [sources, ...only] = process.argv.slice(2);
if (!sources) { console.error('usage: node import.mjs <downloads folder> [ids...]'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const AXIS = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

// A rotation about an axis (source space, degrees): some uploads sit askew on their stand
function rotation(axis, degrees) {
  const [x, y, z] = norm(axis), a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
}
const apply = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

async function raw(buffer, size) {
  return sharp(buffer).resize(size, size, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer();
}

// Maker's marks have no place on an invented brand. Each rectangle (u0, v0, u1, v1 in 0..1, v down) is repainted: with
// the clean metal found (du, dv) away when a fifth and sixth number say where to take it (a clone stamp: grain, scratches
// and normals come along), else with the average of what surrounds it. Edges are feathered either way.
function erase(pixels, size, rects, flat = null) {
  const source = Buffer.from(pixels);
  for (const [u0, v0, u1, v1, du, dv] of rects) {
    const x0 = Math.floor(u0 * size), y0 = Math.floor(v0 * size), x1 = Math.ceil(u1 * size), y1 = Math.ceil(v1 * size);
    const ox = du === undefined ? null : Math.round(du * size), oy = du === undefined ? null : Math.round((dv ?? 0) * size);
    const edge = [0, 0, 0]; let n = 0;
    if (ox === null && !flat) {
      for (let x = x0; x < x1; x++) for (const y of [Math.max(0, y0 - 2), Math.min(size - 1, y1 + 1)]) { for (let c = 0; c < 3; c++) edge[c] += source[(y * size + x) * 3 + c]; n++; }
      for (let y = y0; y < y1; y++) for (const x of [Math.max(0, x0 - 2), Math.min(size - 1, x1 + 1)]) { for (let c = 0; c < 3; c++) edge[c] += source[(y * size + x) * 3 + c]; n++; }
    }
    const fill = flat || edge.map((v) => v / Math.max(1, n));
    const feather = 3;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const o = (y * size + x) * 3;
      const w = Math.min(1, (Math.min(x - x0, x1 - 1 - x, y - y0, y1 - 1 - y) + 1) / feather);
      for (let c = 0; c < 3; c++) {
        const to = ox === null ? fill[c] : source[((y + oy) * size + x + ox) * 3 + c];
        pixels[o + c] = Math.round(source[o + c] * (1 - w) + to * w);
      }
    }
  }
}

// The same, said in the weapon's own space when the lettering is easier to find on the model than on its texture: every
// texel of the faces inside a box (optionally only faces turned sideways) that stands out from the paint around it is
// brought back to that paint. Returns a mask (1 = repainted) so the normal map can be flattened at the same texels.
function unmark(pixels, size, triangles, threshold = 16) {
  const inside = new Uint8Array(size * size);
  for (const t of triangles) {
    const [ax, ay, bx, by, cx, cy] = t.map((v) => v * size);
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(d) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const u = ((x + 0.5 - ax) * (cy - ay) - (y + 0.5 - ay) * (cx - ax)) / d, v = ((bx - ax) * (y + 0.5 - ay) - (by - ay) * (x + 0.5 - ax)) / d;
      if (u >= -0.02 && v >= -0.02 && u + v <= 1.02) inside[y * size + x] = 1;
    }
  }
  const lum = (i) => pixels[i * 3] * 0.3 + pixels[i * 3 + 1] * 0.59 + pixels[i * 3 + 2] * 0.11;
  const values = [];
  for (let i = 0; i < inside.length; i++) if (inside[i]) values.push(lum(i));
  if (!values.length) return inside.fill(0);
  values.sort((a, b) => a - b);
  const median = values[values.length >> 1];
  const paint = [0, 0, 0]; let n = 0;
  for (let i = 0; i < inside.length; i++) if (inside[i] && Math.abs(lum(i) - median) < threshold * 0.6) { for (let c = 0; c < 3; c++) paint[c] += pixels[i * 3 + c]; n++; }
  const marked = new Uint8Array(size * size);
  for (let i = 0; i < inside.length; i++) if (inside[i] && Math.abs(lum(i) - median) > threshold) marked[i] = 1;
  // letters have soft edges: take their neighbours with them
  const grown = Uint8Array.from(marked);
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const i = y * size + x;
    if (inside[i] && !marked[i] && (marked[i - 1] || marked[i + 1] || marked[i - size] || marked[i + size])) grown[i] = 1;
  }
  for (let i = 0; i < grown.length; i++) if (grown[i]) for (let c = 0; c < 3; c++) pixels[i * 3 + c] = Math.round(paint[c] / Math.max(1, n));
  return grown;
}

async function importWeapon(id, spec) {
  const gltf = readGLTF(path.join(sources, spec.source));
  let S = spec.scale ?? 1;
  // source axes → weapon space: +Z along the barrel, +Y the top, +X the weapon's left
  const pre = spec.rotate ? spec.rotate.reduce((m, [axis, deg]) => { const r = rotation(AXIS[axis] || axis, deg); return m ? [0, 1, 2].map((i) => [0, 1, 2].map((j) => r[i][0] * m[0][j] + r[i][1] * m[1][j] + r[i][2] * m[2][j])) : r; }, null) : null;
  let z, y, x;
  const wanted = Object.values(spec.parts).flatMap((rule) => (Array.isArray(rule) ? rule : rule.nodes)).map((p) => new RegExp(p));
  const chosen = gltf.meshes.filter((m) => wanted.some((p) => p.test(m.node)) && !spec.skipMaterials?.includes(m.material));
  if (spec.orient === 'pca') {
    // Display models sit askew on their stand. A firearm is long, tall and thin: its principal axes are its own.
    const points = [];
    for (const m of chosen) for (let i = 0; i < m.position.length; i += 3) points.push([m.position[i], m.position[i + 1], m.position[i + 2]]);
    const axes = (list) => {
      const c = [0, 0, 0];
      for (const p of list) for (let k = 0; k < 3; k++) c[k] += p[k] / list.length;
      const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const p of list) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += (p[i] - c[i]) * (p[j] - c[j]);
      const power = (seed, skip = []) => {
        let v = norm(seed);
        for (let i = 0; i < 300; i++) { v = apply(cov, v); for (const s of skip) { const d = dot(v, s); v = v.map((q, k) => q - d * s[k]); } v = norm(v); }
        return v;
      };
      const a = power([0.31, 0.83, 0.47]);
      return [a, power([0.77, 0.21, 0.6], [a]), c];
    };
    let [long, tall] = axes(points);
    if (spec.flip?.includes('z')) long = long.map((v) => -v);
    if (spec.flip?.includes('y')) tall = tall.map((v) => -v);
    z = long; y = tall; x = cross(y, z);
    if (spec.pitch) {
      // ... except that the grip and the stock pull the long axis off the bore: `pitch` (degrees, read off the measured
      // grid of tools/gun-preview.html) raises the muzzle until the barrel runs level
      const t = -spec.pitch * Math.PI / 180, c = Math.cos(t), sn = Math.sin(t);
      const nz = z.map((v, k) => v * c + y[k] * sn), ny = y.map((v, k) => v * c - z[k] * sn);
      z = nz; y = ny;
    }
    if (spec.length) {
      const along = points.map((p) => dot(p, z));
      S = spec.length / (Math.max(...along) - Math.min(...along));
    }
  } else { z = AXIS[spec.barrel]; y = AXIS[spec.up]; x = cross(y, z); }
  const mirrored = spec.mirror ? -1 : 1;
  const origin = spec.origin || [0, 0, 0];
  // an origin given as a fraction of the weapon's own box is easier to say before anything has been measured
  if (spec.centre !== false && spec.orient === 'pca' && !spec.origin) {
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const m of chosen) for (let i = 0; i < m.position.length; i += 3) {
      const p = [m.position[i], m.position[i + 1], m.position[i + 2]];
      [dot(p, x) * S * mirrored, dot(p, y) * S, dot(p, z) * S].forEach((v, k) => { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); });
    }
    for (let k = 0; k < 3; k++) origin[k] = (lo[k] + hi[k]) / 2;
  }
  // a sight knob or a charging handle on one side pulls the box off the weapon's own mid-plane: `shift` puts it back
  if (spec.shift) for (let k = 0; k < 3; k++) origin[k] += spec.shift[k];
  const toWeapon = (p, move = null) => {
    let v = move ? [p[0] + move[0], p[1] + move[1], p[2] + move[2]] : p;
    if (pre) v = apply(pre, v);
    return [dot(v, x) * S * mirrored - origin[0], dot(v, y) * S - origin[1], dot(v, z) * S - origin[2]];
  };
  const turn = (n) => { const v = pre ? apply(pre, n) : n; return [dot(v, x) * mirrored, dot(v, y), dot(v, z)]; };

  // which nodes make which part
  const parts = []; // { name, material, position[], normal[], uv[], index[] }
  const used = new Set();
  const taken = new Map(); // mesh → triangles already claimed by a part listed earlier
  const lettering = (spec.unmark || []).map(() => []); // per region: UV triangles, with their material
  const bounds = {};
  const materialsUsed = [];
  for (const [partName, rule] of Object.entries(spec.parts)) {
    const patterns = (Array.isArray(rule) ? rule : rule.nodes).map((p) => new RegExp(p));
    const move = Array.isArray(rule) ? null : rule.move || null;
    // a part may claim only the triangles whose centre lies in a box [x0, y0, z0, x1, y1, z1] of weapon space: this is
    // how a pump or a magazine is cut out of a model made in one piece. Parts listed first are served first.
    const box = Array.isArray(rule) ? null : rule.box || null;
    for (const mesh of gltf.meshes) {
      if (!patterns.some((p) => p.test(mesh.node))) continue;
      if (spec.skipMaterials?.includes(mesh.material)) continue;
      used.add(mesh);
      if (!materialsUsed.includes(mesh.material)) materialsUsed.push(mesh.material);
      let part = parts.find((p) => p.name === partName && p.material === mesh.material);
      if (!part) parts.push(part = { name: partName, material: mesh.material, position: [], normal: [], uv: [], index: [], seen: new Map() });
      const b = bounds[partName] ??= { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
      const map = new Int32Array(mesh.position.length / 3).fill(-1);
      const flip = mirrored < 0;
      const claimed = taken.get(mesh) ?? taken.set(mesh, new Uint8Array(mesh.index.length / 3)).get(mesh);
      for (let k = 0; k < mesh.index.length; k += 3) {
        if (claimed[k / 3]) continue;
        if (box || spec.drop) {
          const c = [0, 0, 0];
          for (let j = 0; j < 3; j++) { const i = mesh.index[k + j], p = toWeapon([mesh.position[i * 3], mesh.position[i * 3 + 1], mesh.position[i * 3 + 2]], move); for (let a = 0; a < 3; a++) c[a] += p[a] / 3; }
          // `drop`: boxes whose triangles are thrown away (a loose round posed beside the weapon, a second copy)
          if (spec.drop?.some((d) => c[0] >= d[0] && c[1] >= d[1] && c[2] >= d[2] && c[0] <= d[3] && c[1] <= d[4] && c[2] <= d[5])) { claimed[k / 3] = 1; continue; }
          if (box && (c[0] < box[0] || c[1] < box[1] || c[2] < box[2] || c[0] > box[3] || c[1] > box[4] || c[2] > box[5])) continue;
        }
        claimed[k / 3] = 1;
        if (spec.unmark) {
          const c = [0, 0, 0], nrm = [0, 0, 0];
          for (let j = 0; j < 3; j++) {
            const i = mesh.index[k + j], p = toWeapon([mesh.position[i * 3], mesh.position[i * 3 + 1], mesh.position[i * 3 + 2]], move);
            for (let a = 0; a < 3; a++) c[a] += p[a] / 3;
            if (mesh.normal) { const q = turn([mesh.normal[i * 3], mesh.normal[i * 3 + 1], mesh.normal[i * 3 + 2]]); for (let a = 0; a < 3; a++) nrm[a] += q[a] / 3; }
          }
          spec.unmark.forEach((region, r) => {
            const d = region.box;
            if (c[0] < d[0] || c[1] < d[1] || c[2] < d[2] || c[0] > d[3] || c[1] > d[4] || c[2] > d[5]) return;
            if (region.side && Math.abs(nrm[0]) < 0.7) return;
            const [i0, i1, i2] = [mesh.index[k], mesh.index[k + 1], mesh.index[k + 2]];
            lettering[r].push({ material: mesh.material, uv: [mesh.uv[i0 * 2], mesh.uv[i0 * 2 + 1], mesh.uv[i1 * 2], mesh.uv[i1 * 2 + 1], mesh.uv[i2 * 2], mesh.uv[i2 * 2 + 1]] });
          });
        }
        const tri = flip ? [mesh.index[k], mesh.index[k + 2], mesh.index[k + 1]] : [mesh.index[k], mesh.index[k + 1], mesh.index[k + 2]];
        for (const i of tri) {
          if (map[i] < 0) {
            const p = toWeapon([mesh.position[i * 3], mesh.position[i * 3 + 1], mesh.position[i * 3 + 2]], move);
            const n = mesh.normal ? turn([mesh.normal[i * 3], mesh.normal[i * 3 + 1], mesh.normal[i * 3 + 2]]) : [0, 1, 0];
            const u = mesh.uv[i * 2], v = mesh.uv[i * 2 + 1];
            const key = `${p.map((c) => c.toFixed(5))}|${n.map((c) => c.toFixed(3))}|${u.toFixed(5)},${v.toFixed(5)}`;
            let at = part.seen.get(key);
            if (at === undefined) {
              at = part.position.length / 3;
              part.seen.set(key, at);
              part.position.push(...p); part.normal.push(...n); part.uv.push(u, v);
              for (let c = 0; c < 3; c++) { b.min[c] = Math.min(b.min[c], p[c]); b.max[c] = Math.max(b.max[c], p[c]); }
            }
            map[i] = at;
          }
          part.index.push(map[i]);
        }
      }
    }
  }
  const unused = gltf.meshes.filter((m) => !used.has(m)).map((m) => m.node);
  if (!parts.length) throw new Error(`${id}: no node matched (nodes: ${gltf.meshes.map((m) => m.node).join(', ')})`);

  // one vertex buffer, parts as index ranges
  const position = [], normal = [], uv = [], index = [], ranges = [];
  for (const part of parts) {
    if (!part.index.length) continue;
    const base = position.length / 3;
    position.push(...part.position); normal.push(...part.normal); uv.push(...part.uv);
    ranges.push({ name: part.name, material: materialsUsed.indexOf(part.material), start: index.length, count: part.index.length });
    for (const i of part.index) index.push(base + i);
  }

  // maps
  const size = spec.texture ?? 1024;
  const materials = [];
  const written = new Map(); // content → the file that already holds it
  for (const [k, mi] of materialsUsed.entries()) {
    const m = gltf.materials[mi] || { name: 'none', colorFactor: [1, 1, 1, 1], metal: 0.5, rough: 0.5 };
    const marks = spec.erase?.filter((e) => (e.material ?? 0) === k).flatMap((e) => e.rects) || [];
    const file = (suffix) => `${id}${materialsUsed.length > 1 ? '_' + k : ''}_${suffix}.webp`;
    const entry = { name: m.name, color: m.colorFactor.slice(0, 3), metal: m.metal, rough: m.rough, maps: {} };
    const letters = lettering.map((list, r) => ({ list: list.filter((t) => t.material === mi).map((t) => t.uv), threshold: spec.unmark[r].threshold })).filter((l) => l.list.length);
    let repainted = null;
    if (m.color?.image) {
      const px = await raw(m.color.image, size);
      if (marks.length) erase(px, size, marks);
      for (const l of letters) { const mask = unmark(px, size, l.list, l.threshold); repainted ??= new Uint8Array(size * size); for (let i = 0; i < mask.length; i++) repainted[i] |= mask[i]; }
      await sharp(px, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 90, effort: 5 }).toFile(path.join(OUT, file('c')));
      entry.maps.c = file('c');
    }
    if (m.normal?.image) {
      const px = await raw(m.normal.image, size);
      if (marks.length) erase(px, size, marks, [128, 128, 255]);
      if (repainted) for (let i = 0; i < repainted.length; i++) if (repainted[i]) { px[i * 3] = 128; px[i * 3 + 1] = 128; px[i * 3 + 2] = 255; }
      await sharp(px, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 93, effort: 5 }).toFile(path.join(OUT, file('n')));
      entry.maps.n = file('n');
    }
    if (m.metalRough?.image || m.occlusion?.image || m.specGloss?.image) {
      const small = Math.min(size, spec.textureOrm ?? size);
      const mr = m.metalRough?.image ? await raw(m.metalRough.image, small) : null;
      const occ = m.occlusion?.image ? await raw(m.occlusion.image, small) : null;
      let gloss = null;
      if (!mr && m.specGloss?.image) gloss = await sharp(m.specGloss.image).resize(small, small, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
      const px = Buffer.alloc(small * small * 3);
      for (let i = 0; i < small * small; i++) {
        px[i * 3] = occ ? occ[i * 3] : 255;
        px[i * 3 + 1] = mr ? Math.round(mr[i * 3 + 1] * m.rough) : gloss ? 255 - Math.round(gloss[i * 4 + 3] * (m.gloss ?? 1)) : Math.round(255 * m.rough);
        px[i * 3 + 2] = mr ? Math.round(mr[i * 3 + 2] * m.metal) : gloss ? (gloss[i * 4] + gloss[i * 4 + 1] + gloss[i * 4 + 2] > 380 ? 255 : 0) : Math.round(255 * m.metal);
      }
      if (marks.length) erase(px, small, marks);
      await sharp(px, { raw: { width: small, height: small, channels: 3 } }).webp({ quality: 88, effort: 5 }).toFile(path.join(OUT, file('orm')));
      entry.maps.orm = file('orm');
      entry.metal = entry.rough = 1; // the map carries them
    }
    // Two materials of one model often share their paint and differ only in one map: an image is shipped once
    for (const [slot, name] of Object.entries(entry.maps)) {
      const digest = createHash('sha1').update(fs.readFileSync(path.join(OUT, name))).digest('hex');
      const first = written.get(digest);
      if (first && first !== name) { fs.rmSync(path.join(OUT, name)); entry.maps[slot] = first; } else written.set(digest, name);
    }
    materials.push(entry);
  }

  const P = Float32Array.from(position), N = Float32Array.from(normal), T = Float32Array.from(uv);
  const I = position.length / 3 > 65535 ? Uint32Array.from(index) : Uint16Array.from(index);
  const header = {
    version: 1, name: spec.name || id, parts: ranges, materials, travel: spec.travel || {}, points: spec.points || {},
    indexSize: I.BYTES_PER_ELEMENT, sections: [P.byteLength, N.byteLength, T.byteLength, I.byteLength]
  };
  const json = Buffer.from(JSON.stringify(header));
  const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const u32 = Buffer.alloc(4); u32.writeUInt32LE(json.length);
  const buf = (a) => pad(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  fs.writeFileSync(path.join(OUT, `${id}.bin`), Buffer.concat([pad(Buffer.concat([u32, json])), buf(P), buf(N), buf(T), buf(I)]));

  const f = (v) => v.map((c) => c.toFixed(3)).join(', ');
  console.log(`${id}: ${P.length / 3} vertices, ${I.length / 3} triangles, ${materials.length} material(s), ${(fs.statSync(path.join(OUT, `${id}.bin`)).size / 1024).toFixed(0)} KB`);
  for (const [name, b] of Object.entries(bounds)) console.log(`  ${name.padEnd(9)} x ${b.min[0].toFixed(3)} .. ${b.max[0].toFixed(3)}   y ${b.min[1].toFixed(3)} .. ${b.max[1].toFixed(3)}   z ${b.min[2].toFixed(3)} .. ${b.max[2].toFixed(3)}`);
  if (unused.length) console.log(`  left out: ${[...new Set(unused)].join(', ')}`);
  void f;
}

for (const [id, spec] of Object.entries(config.weapons)) {
  if (only.length && !only.includes(id)) continue;
  await importWeapon(id, spec);
}
