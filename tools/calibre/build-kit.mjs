// The gun shops' prop kit and surfaces: scanned and modelled objects and photographed materials from Poly Haven (CC0),
// downloaded, flattened, simplified and packed for js/calibre-kit.js.
// Usage: node tools/calibre/build-kit.mjs <work folder> [--out dir] [--no-fetch] [--only name,name] [--full]
//   kit.bin       a JSON header, then every prop's vertices (positions and normals quantised, uvs in the atlas) and indices
//   kit_c.webp    the props' shared atlas: colour (sRGB)
//   kit_n.webp    tangent-space normals, green turned over (see below)
//   kit_orm.webp  R = occlusion, G = roughness, B = metalness (glTF order)
//   kit_e.webp    emission (bulbs and tubes of the lamps; black elsewhere)
//   surf_<name>_c/_n/_r.webp  tiling surfaces: colour, normal (green turned over too), roughness
//   kit.json      every prop (source, authors, triangles, size, anchor, atlas rectangles, lights) and surface (metres)
// The green of the normal maps: the sources are OpenGL maps (green = up the image). The game loads its textures with
// flipY = false and has no tangents, so three.js derives the bitangent from the uvs: it points where v grows, down the
// image. An OpenGL map drawn that way is lit upside down (checked on the pyramid foam in kit-preview.html: ?ny=-1
// shows what the other choice gives). So every normal map written here has its green turned over, and a material
// uses it as it is: normalMap, normalScale (1, 1).
// --full keeps every triangle (to judge what the simplification costs, in kit-preview.html); never ship that.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readGltf } from './gltf.mjs';

// sharp and meshoptimizer: this folder's own node_modules first, then the other tools' (tools/world installs both),
// here or in the main checkout when this is a git worktree
const HERE = path.dirname(fileURLToPath(import.meta.url));
function dependency(name) {
  const roots = [HERE];
  for (let dir = HERE; ; dir = path.dirname(dir)) {
    for (const tool of ['calibre', 'world', 'cars', 'people']) roots.push(path.join(dir, 'tools', tool));
    if (path.dirname(dir) === dir) break;
  }
  for (const root of roots) {
    try { return createRequire(path.join(root, 'package.json'))(name); } catch { /* next */ }
  }
  throw new Error(`${name} is not installed: run "npm install" in tools/calibre (or in tools/world)`);
}
const sharp = dependency('sharp');
const { MeshoptSimplifier } = dependency('meshoptimizer');

const args = process.argv.slice(2);
const WORK = args[0];
if (!WORK || WORK.startsWith('--')) throw new Error('usage: node tools/calibre/build-kit.mjs <work folder> [--out dir] [--no-fetch] [--only a,b] [--full]');
const option = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const OUT = option('--out') ?? path.join(HERE, '../../assets/calibre/');
if ((args.includes('--only') || args.includes('--full')) && !option('--out')) throw new Error('--only and --full write a kit that is not the game\'s: give them an --out folder');
const FETCH = !args.includes('--no-fetch');
const ONLY = option('--only')?.split(',') ?? null;
const FULL = args.includes('--full');
const AGENT = { headers: { 'User-Agent': 'overdraft-game-tools' } };
const ATLAS = 2048, GUTTER = 8, SURFACE = 1024;

// ---------------------------------------------------------------------------------------------------------------------
// What goes in the kit
//   name      what the game calls it                    id      Poly Haven model
//   tris      triangle budget                           tile    side of its atlas tile in pixels (its area, really:
//                                                               the tile takes the shape of the UVs the prop uses)
//   anchor    'floor' (default): stands on y = 0, centred. 'wall': back on z = 0, origin at the centre of what touches
//             the wall. 'ceiling': hangs from y = 0, origin at the centre of what touches the ceiling.
//   stand     a floor prop whose origin is the centre of its foot (what touches the floor), not of its whole footprint
//   only      keep the nodes whose path matches         drop    remove nodes or materials that match
//   scale     the source is not in metres               orient  [[axis, degrees], ...] turns the whole prop, in order
//   move      [[nodes, [x, y, z]], ...]                 turn    [[nodes, axis, degrees, [pivot]], ...] before orient
//   glass     keep the blended materials that match, as opaque surfaces (everything else that is blended is removed)
//   cut       [[u0, v0, u1, v1], ...] removes the triangles that read these rectangles of the texture
//   inside    metres: open sheets at least that large get an inside (their own triangles turned over), so that the
//             prop can be drawn with front faces only
//   erase     [[u0, v0, u1, v1, fromU, fromV], ...] paints a texture rectangle with the surface found at (fromU, fromV)
//   hue       degrees: turns the colours of a label that looked too much like a real product
//   tiles     [[material, pixels], ...] tile size of the secondary materials (default: half the main one)
//   lay       a hand tool: laid on its flattest side, its length along x (then orient, if given)
//   fine      the error the simplification may reach without asking, as a fraction of the prop's bulk (default 0.02)
//   detail    pieces smaller than this fraction of the bulk may be removed to meet the budget (default 0.1; 0: none)
//   weights   simplification: [normal, uv] weights (default [0.3, 0.5])
// ---------------------------------------------------------------------------------------------------------------------
const PROPS = [
  { name: 'ammo_box', id: 'ammo_box', tris: 900, tile: 512, orient: [['y', 90]], detail: 0 },
  { name: 'cash_register', id: 'CashRegister_01', tris: 2500, tile: 512, move: [[/drawer/, [0, 0, -0.185]]] },
  { name: 'shelves', id: 'steel_frame_shelves_01', tris: 1200, tile: 512, scale: 0.1 },
  { name: 'shelves_narrow', id: 'steel_frame_shelves_02', tris: 1200, tile: 360 },
  { name: 'tool_chest', id: 'metal_tool_chest', tris: 2200, tile: 512 },
  { name: 'toolbox', id: 'metal_toolbox', tris: 1400, tile: 256 },
  { name: 'vice', id: 'bench_vice_01', tris: 1000, tile: 256, move: [[/bar$/, [0, 0.088, 0]]] },
  { name: 'drill_press', id: 'old_drill_press', tris: 3000, tile: 512, drop: /cable/ }, // drill_press_01 needs 6500 triangles to stay clean
  { name: 'lamp_hanging', id: 'hanging_industrial_lamp', tris: 1400, tile: 256, anchor: 'ceiling' },
  { name: 'lamp_wall', id: 'industrial_wall_lamp', tris: 900, tile: 256, anchor: 'wall' },
  { name: 'lamp_tube', id: 'mounted_fluorescent_lights', tris: 700, tile: 256, anchor: 'ceiling', only: /lights_b$/ },
  { name: 'lamp_caged', id: 'caged_hanging_light', tris: 2000, tile: 256, anchor: 'ceiling' },
  { name: 'cardboard_box', id: 'cardboard_box_01', tris: 400, tile: 256 },
  { name: 'crate', id: 'wooden_crate_01', tris: 900, tile: 256 },
  { name: 'crate_long', id: 'wooden_crate_02', tris: 800, tile: 256, orient: [['y', 90]] },
  { name: 'crate_military', id: 'wooden_military_crate', tris: 1500, tile: 512 },
  { name: 'extinguisher', id: 'korean_fire_extinguisher_01', tris: 1200, tile: 256, erase: [[0.012, 0.016, 0.315, 0.116, 0.146, 0.119]] },
  { name: 'fire_alarm', id: 'fire_alarm', tris: 400, tile: 160, anchor: 'wall', detail: 0.25 },
  { name: 'first_aid', id: 'medical_box', tris: 700, tile: 256, anchor: 'wall', orient: [['x', 90], ['z', 180]] },
  { name: 'power_box', id: 'power_box_01', tris: 500, tile: 256, anchor: 'wall', turn: [[/door/, 'y', 111, [-0.1654, 0, 0.039]]], detail: 0.3 },
  { name: 'camera', id: 'security_camera_02', tris: 1100, tile: 256, anchor: 'wall' },
  { name: 'stool', id: 'metal_stool_01', tris: 1200, tile: 256 },
  { name: 'desk', id: 'metal_office_desk', tris: 1100, tile: 512 },
  { name: 'hand_truck', id: 'hand_truck', tris: 2400, tile: 256 },
  { name: 'bat', id: 'baseball_bat', tris: 400, tile: 128, lay: true },
  { name: 'hatchet', id: 'hatchet', tris: 600, tile: 128, lay: true },
  { name: 'binoculars', id: 'binoculars', tris: 2400, tile: 256, drop: /strap/, glass: /glass/ },
  { name: 'crowbar', id: 'crowbar_01', tris: 300, tile: 128, lay: true },
  { name: 'spray', id: 'lubricant_spray', tris: 500, tile: 128, hue: 150 },
  { name: 'tin', id: 'cleaner_tin_01', tris: 400, tile: 128 },
  { name: 'desk_lamp', id: 'desk_lamp_arm_01', tris: 1500, tile: 256, cut: [[0, 0.36, 0.34, 0.965]], inside: 0.15, orient: [['y', 180]], stand: true },
  { name: 'hammer', id: 'cross_pein_hammer', tris: 300, tile: 128, lay: true },
  { name: 'wrench', id: 'adjustable_wrench', tris: 1000, tile: 128, lay: true }, // its jaws shatter below that (combination_wrench is clean at 450)
  { name: 'screwdriver', id: 'flathead_screwdriver', tris: 300, tile: 128, lay: true },
  { name: 'tape', id: 'measuring_tape_01', tris: 500, tile: 128 },
  { name: 'clipboard', id: 'clipboard', tris: 700, tile: 256 },
  { name: 'duct', id: 'modular_airduct_rectangular_01', tris: 600, tile: 256, anchor: 'ceiling', only: /tripple_01$/, orient: [['y', 90]] },
  { name: 'pipe', id: 'modular_industrial_pipes_01', tris: 400, tile: 256, anchor: 'ceiling', only: /pipe02$/, orient: [['z', 90]] },
  { name: 'wall_clock', id: 'wall_clock', tris: 700, tile: 256, anchor: 'wall' },
  { name: 'barrel', id: 'barrel_03', tris: 600, tile: 256 },
  { name: 'jerrycan', id: 'metal_jerrycan_green', tris: 800, tile: 256 },
  { name: 'wet_floor_sign', id: 'WetFloorSign_01', tris: 228, tile: 128 },
  { name: 'monitor', id: 'television_02', tris: 600, tile: 256 },
  { name: 'tyre', id: 'old_tyre', tris: 500, tile: 256, orient: [['x', -90]] }
];

// Tiling surfaces: a Poly Haven texture id, or `make` for the one this tool draws itself
const SURFACES = {
  slats: { id: 'synthetic_wood' }, // a wall of narrow vertical slats, warm brown
  foam: { make: 'pyramids', metres: 0.5 }, // Poly Haven has no acoustic foam: pyramid foam drawn here
  plate: { id: 'metal_plate_02' }, // dark worn steel sheets
  rubber: { id: 'rubber_tiles' }, // black gym tiles
  plaster: { id: 'painted_plaster_wall' }, // light painted plaster, uneven: made to be tinted
  ceiling: { id: 'corrugated_iron_02' } // dark corrugated sheet: a metal deck
};

// ---------------------------------------------------------------------------------------------------------------------
// Downloads (kept in the work folder)
// ---------------------------------------------------------------------------------------------------------------------
async function json(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!FETCH) throw new Error(`missing ${file}`);
  const r = await fetch(url, AGENT);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const data = await r.json();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
  return data;
}
async function save(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size) return file;
  if (!FETCH) throw new Error(`missing ${file}`);
  const r = await fetch(url, AGENT);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}
async function model(id) {
  const folder = path.join(WORK, 'models', id);
  const files = await json(`https://api.polyhaven.com/files/${id}`, path.join(folder, 'files.json'));
  const info = await json(`https://api.polyhaven.com/info/${id}`, path.join(folder, 'info.json'));
  const entry = files.gltf['1k'].gltf;
  const file = await save(entry.url, path.join(folder, 'model.gltf'));
  await Promise.all(Object.entries(entry.include).map(([rel, f]) => save(f.url, path.join(folder, rel))));
  return { file, info };
}
async function texture(id, map, res = '2k') {
  const folder = path.join(WORK, 'textures', id);
  const files = await json(`https://api.polyhaven.com/files/${id}`, path.join(folder, 'files.json'));
  const url = files[map]?.[res]?.jpg?.url;
  if (!url) throw new Error(`${id}: no ${map} at ${res} (has ${Object.keys(files).join(', ')})`);
  return save(url, path.join(folder, `${map}_${res}.jpg`));
}
async function pool(items, size, job) {
  const queue = items.map((item, i) => [item, i]), out = new Array(items.length);
  await Promise.all(Array.from({ length: size }, async () => { while (queue.length) { const [item, i] = queue.shift(); out[i] = await job(item); } }));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------------------------------
const AXIS = { x: 0, y: 1, z: 2 };
// Turns points (and their normals) about an axis through a pivot
function rotate(position, normal, axis, degrees, pivot = [0, 0, 0]) {
  const a = (AXIS[axis] + 1) % 3, b = (AXIS[axis] + 2) % 3;
  const c = Math.cos(degrees * Math.PI / 180), s = Math.sin(degrees * Math.PI / 180);
  for (let i = 0; i < position.length; i += 3) {
    const pa = position[i + a] - pivot[a], pb = position[i + b] - pivot[b];
    position[i + a] = pa * c - pb * s + pivot[a];
    position[i + b] = pa * s + pb * c + pivot[b];
    const na = normal[i + a], nb = normal[i + b];
    normal[i + a] = na * c - nb * s;
    normal[i + b] = na * s + nb * c;
  }
}
function box(position, from = 0, to = position.length / 3) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = from; i < to; i++) for (let c = 0; c < 3; c++) {
    const v = position[i * 3 + c];
    if (v < b[c]) b[c] = v;
    if (v > b[c + 3]) b[c + 3] = v;
  }
  return b;
}

// A prop's parts as one mesh: positions, normals, uvs (each in its own texture's 0..1), the skin (texture set) and
// source material of every vertex
function assemble(prop, gltf) {
  const { materials } = gltf;
  const skins = []; // one per set of textures
  const skinOf = (m) => {
    const key = [m.color, m.normal, m.orm, m.emissive, m.color ? '' : m.colorFactor.join()].join('|');
    let skin = skins.find((s) => s.key === key);
    if (!skin) { skin = { key, material: m, index: skins.length }; skins.push(skin); }
    return skin;
  };
  const position = [], normal = [], uv = [], skinId = [], glow = [], index = [];
  let straddling = 0, wrapped = 0;
  for (const part of gltf.parts) {
    const m = materials[part.material] ?? { name: '', alphaMode: 'OPAQUE', colorFactor: [0.5, 0.5, 0.5, 1], emissiveFactor: [0, 0, 0], rough: 1, metal: 0 };
    if (prop.only && !prop.only.test(part.node)) continue;
    if (prop.drop && (prop.drop.test(part.node) || prop.drop.test(m.name))) continue;
    const blended = m.alphaMode === 'BLEND' || m.transmission > 0;
    if (blended && !(prop.glass && prop.glass.test(m.name))) continue;
    if (!part.hasNormal || !part.hasUv) throw new Error(`${prop.name}: ${part.node} has no normals or no uvs`);
    const P = Float64Array.from(part.position), N = Float64Array.from(part.normal);
    for (const [nodes, by] of prop.move ?? []) if (nodes.test(part.node)) for (let i = 0; i < P.length; i += 3) { P[i] += by[0]; P[i + 1] += by[1]; P[i + 2] += by[2]; }
    for (const [nodes, axis, degrees, pivot] of prop.turn ?? []) if (nodes.test(part.node)) rotate(P, N, axis, degrees, pivot);
    const skin = skinOf(m);
    // a material that glows without an emission texture (a bulb): its triangles are painted into the emission atlas
    const glows = !m.emissive && m.emissiveFactor.some((v) => v > 0) ? m.emissiveFactor : null;
    // UVs outside 0..1 read the same texture again: bring every triangle back into the first tile
    const copies = new Map(); // "vertex:shiftU:shiftV" -> new index
    const vertex = (v, su, sv) => {
      const key = su || sv ? `${v}:${su}:${sv}` : v;
      let at = copies.get(key);
      if (at === undefined) {
        at = position.length / 3;
        copies.set(key, at);
        position.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        normal.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
        uv.push(part.uv[v * 2] - su, part.uv[v * 2 + 1] - sv);
        skinId.push(skin.index);
        glow.push(glows ? 1 : 0);
      }
      return at;
    };
    for (let t = 0; t < part.index.length; t += 3) {
      const tri = [part.index[t], part.index[t + 1], part.index[t + 2]];
      const us = tri.map((v) => part.uv[v * 2]), vs = tri.map((v) => part.uv[v * 2 + 1]);
      const su = Math.floor(Math.min(...us) + 1e-4), sv = Math.floor(Math.min(...vs) + 1e-4);
      if (Math.max(...us) - su > 1.002 || Math.max(...vs) - sv > 1.002) straddling++;
      // a part of the texture whose triangles are not wanted (the inner skin of a thin shell, which pokes through the
      // outer one once both are simplified)
      if ((prop.cut ?? []).some(([u0, v0, u1, v1]) => us.every((u) => u - su >= u0 && u - su <= u1) && vs.every((v) => v - sv >= v0 && v - sv <= v1))) continue;
      if (su || sv) wrapped++;
      for (const v of tri) index.push(vertex(v, su, sv));
    }
    skin.glow ??= glows;
  }
  if (!index.length) throw new Error(`${prop.name}: nothing left of ${prop.id} (check only/drop)`);
  if (straddling) console.warn(`  ! ${prop.name}: ${straddling} triangles tile their texture across a 0..1 border (clamped)`);
  const P = Float32Array.from(position), N = Float32Array.from(normal);
  if (prop.scale) for (let i = 0; i < P.length; i++) P[i] *= prop.scale;
  if (prop.lay) {
    // longest side along x, thinnest up: the axes are permuted (a rotation, so nothing is mirrored)
    const b = box(P), sides = [b[3] - b[0], b[4] - b[1], b[5] - b[2]];
    const long = sides.indexOf(Math.max(...sides)), thin = sides.indexOf(Math.min(...sides)), mid = 3 - long - thin;
    const even = (long + 1) % 3 === thin; // x, y, z <- long, thin, mid is a rotation when long -> thin -> mid runs in order
    for (const A of [P, N]) for (let i = 0; i < A.length; i += 3) {
      const v = [A[i], A[i + 1], A[i + 2]];
      A[i] = v[long]; A[i + 1] = v[thin]; A[i + 2] = even ? v[mid] : -v[mid];
    }
  }
  for (const [axis, degrees] of prop.orient ?? []) rotate(P, N, axis, degrees);
  return { position: P, normal: N, uv: Float32Array.from(uv, (v) => Math.min(1, Math.max(0, v))), skinId: Uint8Array.from(skinId), glow: Uint8Array.from(glow), index: Uint32Array.from(index), skins, wrapped };
}

// Removes the vertices nothing draws, in the order the triangles meet them
function compact(mesh, index) {
  const order = new Map();
  const faces = Uint32Array.from(index, (v) => { if (!order.has(v)) order.set(v, order.size); return order.get(v); });
  const pick = (src, n, Type) => { const out = new Type(order.size * n); for (const [from, to] of order) for (let c = 0; c < n; c++) out[to * n + c] = src[from * n + c]; return out; };
  return { ...mesh, position: pick(mesh.position, 3, Float32Array), normal: pick(mesh.normal, 3, Float32Array), uv: pick(mesh.uv, 2, Float32Array), skinId: pick(mesh.skinId, 1, Uint8Array), glow: pick(mesh.glow, 1, Uint8Array), index: faces };
}

// The separate pieces of a mesh: triangles joined through vertices at the same place
function pieces(mesh) {
  const P = mesh.position, count = P.length / 3;
  const b = box(P), grain = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * 1e-5;
  const place = new Map(), weld = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(P[i * 3] / grain)},${Math.round(P[i * 3 + 1] / grain)},${Math.round(P[i * 3 + 2] / grain)}`;
    if (!place.has(key)) place.set(key, i);
    weld[i] = place.get(key);
  }
  const parent = Uint32Array.from({ length: count }, (_, i) => i);
  const find = (v) => { while (parent[v] !== v) { parent[v] = parent[parent[v]]; v = parent[v]; } return v; };
  for (let t = 0; t < mesh.index.length; t += 3) { const r = find(weld[mesh.index[t]]); parent[find(weld[mesh.index[t + 1]])] = r; parent[find(weld[mesh.index[t + 2]])] = r; }
  const list = new Map(); // root -> { box, diagonal }
  const of = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const r = find(weld[i]);
    let piece = list.get(r);
    if (!piece) { piece = { id: list.size, box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] }; list.set(r, piece); }
    of[i] = piece.id;
    for (let c = 0; c < 3; c++) { piece.box[c] = Math.min(piece.box[c], P[i * 3 + c]); piece.box[c + 3] = Math.max(piece.box[c + 3], P[i * 3 + c]); }
  }
  const all = [...list.values()];
  for (const p of all) p.diagonal = Math.hypot(p.box[3] - p.box[0], p.box[4] - p.box[1], p.box[5] - p.box[2]);
  return { of, all, weld };
}

// Down to the triangle budget. What the reduction must not blur: how a surface faces, where it reads its texture and
// which texture that is. These are hard-surface models cut into many texture islands and made of many separate pieces
// (screws, raised letters, switches): a collapse forced across a texture seam smears the picture over a shard. So:
//   1. reduce within an error a viewer does not see (`fine`, a fraction of the prop's bulk), crossing hard edges but
//      never a texture seam: the vertices that share a place but not their uvs are protected;
//   2. if the budget is not met, the small pieces go whole, the ones that cost the most triangles for their size first;
//   3. then the error grows, seams still protected; crossing them is the last resort, and is reported.
// The bulk is the cube root of the prop's volume, not its longest side: a wrench is long and its jaws are small.
function simplify(prop, mesh) {
  const target = prop.tris * 3;
  if (FULL || mesh.index.length <= target) return compact(mesh, mesh.index);
  const count = mesh.position.length / 3;
  const attributes = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    attributes[i * 6] = mesh.normal[i * 3]; attributes[i * 6 + 1] = mesh.normal[i * 3 + 1]; attributes[i * 6 + 2] = mesh.normal[i * 3 + 2];
    attributes[i * 6 + 3] = mesh.uv[i * 2]; attributes[i * 6 + 4] = mesh.uv[i * 2 + 1];
    attributes[i * 6 + 5] = mesh.skinId[i] * 2 + mesh.glow[i];
  }
  const [wn, wuv] = prop.weights ?? [0.3, 0.5];
  const weights = [wn, wn, wn, wuv, wuv, 8];
  const b = box(mesh.position), sides = [b[3] - b[0], b[4] - b[1], b[5] - b[2]], longest = Math.max(...sides);
  const bulk = Math.cbrt(sides.map((v) => Math.max(v, longest * 0.05)).reduce((p, v) => p * v, 1));
  const { of, all, weld } = pieces(mesh);
  // texture seams: vertices at one place whose uvs (or textures) differ
  const protect = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const w = weld[i];
    if (w === i) continue;
    if (Math.abs(mesh.uv[i * 2] - mesh.uv[w * 2]) > 1e-4 || Math.abs(mesh.uv[i * 2 + 1] - mesh.uv[w * 2 + 1]) > 1e-4 || mesh.skinId[i] !== mesh.skinId[w] || mesh.glow[i] !== mesh.glow[w]) protect[i] = protect[w] = 2;
  }
  for (let i = 0; i < count; i++) if (protect[weld[i]]) protect[i] = 2;
  const fine = prop.fine ?? 0.02;
  const run = (index, limit, seams = protect) => MeshoptSimplifier.simplifyWithAttributes(index, mesh.position, 3, attributes, 6, weights, seams, target, limit * bulk, ['ErrorAbsolute', 'Permissive']);
  const notes = [];
  let source = mesh.index;
  let [kept, error] = run(source, fine);
  const natural = kept.length / 3;
  if (kept.length > target && prop.detail !== 0) {
    for (const p of all) p.cost = 0;
    for (let t = 0; t < kept.length; t += 3) all[of[kept[t]]].cost++;
    // what may go: pieces smaller than a part of the whole, least seen for their cost first
    const limit = (prop.detail ?? 0.1) * bulk;
    const loose = all.filter((p) => p.diagonal < limit && p.cost > 0).sort((p, q) => p.diagonal ** 2 / p.cost - q.diagonal ** 2 / q.cost);
    const gone = new Set();
    let total = kept.length / 3, largest = 0;
    for (const p of loose) { if (total <= prop.tris) break; gone.add(p.id); total -= p.cost; largest = Math.max(largest, p.diagonal); }
    if (gone.size) {
      source = mesh.index.filter((v, k) => !gone.has(of[mesh.index[k - (k % 3)]]));
      [kept, error] = run(source, fine);
      notes.push(`${gone.size} of ${all.length} pieces removed (up to ${(largest * 100).toFixed(1)} cm)`);
    }
  }
  for (const factor of [1.5, 2.25, 3.5]) {
    if (kept.length <= target) break;
    [kept, error] = run(source, fine * factor);
    notes[1] = `error raised to ${(fine * factor * 100).toFixed(1)} %`;
  }
  if (kept.length > target) { [kept, error] = run(source, fine * 5, null); notes[1] = 'TEXTURE SEAMS CROSSED'; }
  const out = compact(mesh, kept);
  out.report = [`${natural} at ${(fine * 100).toFixed(1)} %`, `error ${(error / bulk * 100).toFixed(1)} %`, ...notes.filter(Boolean)].join(', ');
  if (kept.length > target) out.report += '  ! OVER BUDGET';
  return out;
}

// An inside for the open sheets of a prop (a lamp shade whose inner skin was cut away): every piece that has a free
// edge and is at least `prop.inside` metres across is doubled, turned inside out, a millimetre behind itself. The
// kit can then be drawn with front faces only.
function line(prop, mesh) {
  const { of, all, weld } = pieces(mesh);
  const edges = new Map(); // welded edge -> how many triangles use it
  for (let t = 0; t < mesh.index.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = weld[mesh.index[t + k]], b = weld[mesh.index[t + (k + 1) % 3]];
    const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  const free = new Array(all.length).fill(0);
  for (let t = 0; t < mesh.index.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = weld[mesh.index[t + k]], b = weld[mesh.index[t + (k + 1) % 3]];
    if (edges.get(a < b ? a * 4294967296 + b : b * 4294967296 + a) === 1) free[of[mesh.index[t]]]++;
  }
  const open = new Set(all.filter((p) => free[p.id] >= 3 && p.diagonal >= prop.inside).map((p) => p.id));
  const position = [...mesh.position], normal = [...mesh.normal], uv = [...mesh.uv], skinId = [...mesh.skinId], glow = [...mesh.glow], index = [...mesh.index];
  const twin = new Map();
  const inner = (v) => {
    if (!twin.has(v)) {
      twin.set(v, position.length / 3);
      for (let c = 0; c < 3; c++) { position.push(mesh.position[v * 3 + c] - mesh.normal[v * 3 + c] * 0.001); normal.push(-mesh.normal[v * 3 + c]); }
      uv.push(mesh.uv[v * 2], mesh.uv[v * 2 + 1]); skinId.push(mesh.skinId[v]); glow.push(mesh.glow[v]);
    }
    return twin.get(v);
  };
  for (let t = 0; t < mesh.index.length; t += 3) {
    if (!open.has(of[mesh.index[t]])) continue;
    index.push(inner(mesh.index[t]), inner(mesh.index[t + 2]), inner(mesh.index[t + 1]));
  }
  return { ...mesh, position: Float32Array.from(position), normal: Float32Array.from(normal), uv: Float32Array.from(uv), skinId: Uint8Array.from(skinId), glow: Uint8Array.from(glow), index: Uint32Array.from(index),
    report: `${mesh.report ?? ''}, ${(index.length - mesh.index.length) / 3} triangles of inside added` };
}

// Where the prop sits: on the floor, against a wall or under a ceiling
function anchor(prop, mesh) {
  const P = mesh.position, b = box(P);
  let origin;
  // the centre of what touches the wall or the ceiling: the vertices within a few millimetres of that plane
  const touching = (axis, plane) => {
    const t = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i + axis] - plane) < 0.004) for (let c = 0; c < 3; c++) { t[c] = Math.min(t[c], P[i + c]); t[c + 3] = Math.max(t[c + 3], P[i + c]); }
    return [(t[0] + t[3]) / 2, (t[1] + t[4]) / 2, (t[2] + t[5]) / 2];
  };
  if (prop.anchor === 'wall') { const c = touching(2, b[2]); origin = [c[0], c[1], b[2]]; }
  else if (prop.anchor === 'ceiling') { const c = touching(1, b[4]); origin = [c[0], b[4], c[2]]; }
  else if (prop.stand) { const c = touching(1, b[1]); origin = [c[0], b[1], c[2]]; }
  else origin = [(b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2];
  for (let i = 0; i < P.length; i += 3) { P[i] -= origin[0]; P[i + 1] -= origin[1]; P[i + 2] -= origin[2]; }
  mesh.min = [b[0] - origin[0], b[1] - origin[1], b[2] - origin[2]];
  mesh.max = [b[3] - origin[0], b[4] - origin[1], b[5] - origin[2]];
}

// ---------------------------------------------------------------------------------------------------------------------
// Atlas
// ---------------------------------------------------------------------------------------------------------------------
// Skyline packing: every rectangle goes where it sits lowest
function pack(rects, width, height) {
  let sky = [{ x: 0, y: 0, w: width }];
  for (const r of [...rects].sort((a, b) => b.h - a.h || b.w - a.w)) {
    let best = null;
    for (let i = 0; i < sky.length; i++) {
      const x = sky[i].x;
      if (x + r.w > width) break;
      let y = 0, left = r.w;
      for (let j = i; left > 0 && j < sky.length; j++) { y = Math.max(y, sky[j].y); left -= sky[j].w; }
      if (y + r.h > height) continue;
      if (!best || y < best.y) best = { x, y };
    }
    if (!best) return false;
    r.x = best.x; r.y = best.y;
    const a = r.x, b = r.x + r.w, next = [];
    for (const s of sky) {
      if (s.x + s.w <= a || s.x >= b) { next.push(s); continue; }
      if (s.x < a) next.push({ x: s.x, y: s.y, w: a - s.x });
      if (s.x + s.w > b) next.push({ x: b, y: s.y, w: s.x + s.w - b });
    }
    next.push({ x: a, y: r.y + r.h, w: r.w });
    sky = next.sort((p, q) => p.x - q.x);
  }
  return true;
}

// An image as raw RGB
async function rgb(file) {
  const { data, info } = await sharp(file).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  if (info.channels === 3) return { data, width: info.width, height: info.height };
  const out = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0; i < info.width * info.height; i++) out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = data[i * info.channels];
  return { data: out, width: info.width, height: info.height };
}
// A crop of an image (uv rectangle), resized to w x h, as raw RGB
async function crop(image, [u0, v0, u1, v1], w, h) {
  const left = Math.max(0, Math.floor(u0 * image.width)), top = Math.max(0, Math.floor(v0 * image.height));
  const width = Math.max(1, Math.min(image.width - left, Math.ceil(u1 * image.width) - left)), height = Math.max(1, Math.min(image.height - top, Math.ceil(v1 * image.height) - top));
  const data = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } })
    .extract({ left, top, width, height }).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  // what the crop really covers, so that the uvs land on the right pixels
  return { data, rect: [left / image.width, top / image.height, (left + width) / image.width, (top + height) / image.height] };
}
// Writes a w x h image into the atlas at (x + GUTTER, y + GUTTER), its edge pixels repeated into the gutter
function blit(atlas, tile, data) {
  const iw = tile.w - 2 * GUTTER, ih = tile.h - 2 * GUTTER;
  for (let y = 0; y < tile.h; y++) for (let x = 0; x < tile.w; x++) {
    const sx = Math.min(iw - 1, Math.max(0, x - GUTTER)), sy = Math.min(ih - 1, Math.max(0, y - GUTTER));
    const s = (sy * iw + sx) * 3, d = ((tile.y + y) * ATLAS + tile.x + x) * 3;
    atlas[d] = data[s]; atlas[d + 1] = data[s + 1]; atlas[d + 2] = data[s + 2];
  }
}
function fill(atlas, tile, colour) {
  for (let y = 0; y < tile.h; y++) for (let x = 0; x < tile.w; x++) {
    const d = ((tile.y + y) * ATLAS + tile.x + x) * 3;
    atlas[d] = colour[0]; atlas[d + 1] = colour[1]; atlas[d + 2] = colour[2];
  }
}
// Paints a triangle (atlas pixels) with a colour, one pixel fatter than it is
function paint(atlas, a, b, c, colour) {
  const x0 = Math.floor(Math.min(a[0], b[0], c[0])) - 1, x1 = Math.ceil(Math.max(a[0], b[0], c[0])) + 1;
  const y0 = Math.floor(Math.min(a[1], b[1], c[1])) - 1, y1 = Math.ceil(Math.max(a[1], b[1], c[1])) + 1;
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const sign = area < 0 ? -1 : 1;
  const edge = (p, q, x, y) => {
    const dx = q[0] - p[0], dy = q[1] - p[1];
    return sign * (dx * (y - p[1]) - dy * (x - p[0])) + Math.hypot(dx, dy); // one pixel of slack
  };
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (x < 0 || y < 0 || x >= ATLAS || y >= ATLAS) continue;
    const px = x + 0.5, py = y + 0.5;
    if (edge(a, b, px, py) < 0 || edge(b, c, px, py) < 0 || edge(c, a, px, py) < 0) continue;
    const d = (y * ATLAS + x) * 3;
    atlas[d] = colour[0]; atlas[d + 1] = colour[1]; atlas[d + 2] = colour[2];
  }
}
// OpenGL green to the green three.js wants of a texture that is not flipped (128 stays 128)
function turnGreen(data) {
  for (let i = 1; i < data.length; i += 3) data[i] = Math.min(255, 256 - data[i]);
  return data;
}
const toSrgb = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));

// ---------------------------------------------------------------------------------------------------------------------
// The props
// ---------------------------------------------------------------------------------------------------------------------
await MeshoptSimplifier.ready;
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });
const wanted = PROPS.filter((p) => !ONLY || ONLY.includes(p.name));
console.log(`fetching ${wanted.length} models`);
const sources = await pool(wanted, 6, (p) => model(p.id));

const built = [];
const images = new Map(); // file -> raw RGB, read once
const image = async (file) => { if (!images.has(file)) images.set(file, await rgb(file)); return images.get(file); };
for (const [i, prop] of wanted.entries()) {
  const gltf = readGltf(sources[i].file);
  const whole = assemble(prop, gltf);
  let mesh = simplify(prop, whole);
  if (prop.inside) {
    // the inside comes out of the budget
    let lined = line(prop, mesh);
    for (let reserve = lined.index.length - mesh.index.length; lined.index.length > prop.tris * 3; reserve += 30) {
      mesh = simplify({ ...prop, tris: prop.tris - Math.ceil(reserve / 3) }, whole);
      lined = line(prop, mesh);
    }
    mesh = lined;
  }
  anchor(prop, mesh);
  // Which part of each texture the kept triangles read
  const tiles = mesh.skins.map((skin) => ({ skin, prop, uv: [Infinity, Infinity, -Infinity, -Infinity], used: false }));
  for (let v = 0; v < mesh.position.length / 3; v++) {
    const t = tiles[mesh.skinId[v]], u = mesh.uv[v * 2], w = mesh.uv[v * 2 + 1];
    t.used = true;
    t.uv[0] = Math.min(t.uv[0], u); t.uv[1] = Math.min(t.uv[1], w); t.uv[2] = Math.max(t.uv[2], u); t.uv[3] = Math.max(t.uv[3], w);
  }
  // triangles per skin, to tell the main material from the others
  const share = new Array(tiles.length).fill(0);
  for (let t = 0; t < mesh.index.length; t += 3) share[mesh.skinId[mesh.index[t]]]++;
  const main = share.indexOf(Math.max(...share));
  for (const [k, t] of tiles.entries()) {
    if (!t.used) continue;
    const m = t.skin.material;
    let side = k === main ? prop.tile : prop.tile / 2;
    for (const [names, px] of prop.tiles ?? []) if (names.test(m.name)) side = px;
    if (!m.color && !m.normal && !m.orm) { t.w = t.h = 16 + 2 * GUTTER; t.flat = true; continue; }
    // two pixels of margin round the used rectangle, then a tile of the same area as side x side, shaped like it
    const pad = 2 / 1024;
    t.uv = [Math.max(0, t.uv[0] - pad), Math.max(0, t.uv[1] - pad), Math.min(1, t.uv[2] + pad), Math.min(1, t.uv[3] + pad)];
    const aspect = Math.min(4, Math.max(0.25, (t.uv[2] - t.uv[0]) / Math.max(1e-6, t.uv[3] - t.uv[1])));
    const round = (v) => Math.max(32, Math.round(v / 8) * 8);
    t.w = Math.min(ATLAS, round(side * Math.sqrt(aspect)));
    t.h = Math.min(ATLAS, round(side / Math.sqrt(aspect)));
  }
  built.push({ prop, mesh, tiles, info: sources[i].info, source: whole.index.length / 3 });
  const size = mesh.max.map((v, c) => v - mesh.min[c]);
  console.log(`${prop.name.padEnd(15)} ${String(whole.index.length / 3).padStart(6)} -> ${String(mesh.index.length / 3).padStart(5)} triangles  ${size.map((v) => v.toFixed(3)).join(' x ')} m  ${mesh.report ?? ''}${whole.wrapped ? `  (${whole.wrapped} triangles brought back into 0..1)` : ''}`);
}

// Pack: if everything does not fit, every tile shrinks a little until it does
const allTiles = built.flatMap((b) => b.tiles.filter((t) => t.used));
let shrink = 1;
for (; ; shrink *= 0.96) {
  for (const t of allTiles) {
    t.pw = t.flat ? t.w : Math.max(32, Math.round(t.w * shrink / 8) * 8);
    t.ph = t.flat ? t.h : Math.max(32, Math.round(t.h * shrink / 8) * 8);
  }
  const rects = allTiles.map((t) => ({ w: t.pw, h: t.ph, t }));
  if (pack(rects, ATLAS, ATLAS)) { for (const r of rects) { r.t.x = r.x; r.t.y = r.y; r.t.w = r.w; r.t.h = r.h; } break; }
  if (shrink < 0.3) throw new Error('the atlas cannot hold these tiles');
}
const usedArea = allTiles.reduce((s, t) => s + t.w * t.h, 0) / (ATLAS * ATLAS);
console.log(`atlas: ${allTiles.length} tiles, ${(usedArea * 100).toFixed(1)} % of ${ATLAS} x ${ATLAS}${shrink < 1 ? `, tiles shrunk to ${(shrink * 100).toFixed(0)} %` : ''}`);

const colour = Buffer.alloc(ATLAS * ATLAS * 3, 0x30);
const normal = Buffer.alloc(ATLAS * ATLAS * 3);
const orm = Buffer.alloc(ATLAS * ATLAS * 3);
const emission = Buffer.alloc(ATLAS * ATLAS * 3, 0);
for (let i = 0; i < ATLAS * ATLAS; i++) { normal[i * 3] = normal[i * 3 + 1] = 128; normal[i * 3 + 2] = 255; orm[i * 3] = 255; orm[i * 3 + 1] = 200; orm[i * 3 + 2] = 0; }

for (const { prop, mesh, tiles } of built) {
  for (const t of tiles) {
    if (!t.used) continue;
    const m = t.skin.material;
    const iw = t.w - 2 * GUTTER, ih = t.h - 2 * GUTTER;
    if (t.flat) {
      t.rect = [0, 0, 1, 1];
      fill(colour, t, m.colorFactor.slice(0, 3).map(toSrgb));
      fill(normal, t, [128, 128, 255]);
      fill(orm, t, [255, Math.round(m.rough * 255), Math.round(m.metal * 255)]);
      continue;
    }
    let c = m.color ? await image(m.color) : null;
    let n = m.normal ? await image(m.normal) : null;
    let o = m.orm ? await image(m.orm) : null;
    // Markings painted over: the rectangle takes the surface found at (fromU, fromV), tiled from a few pixels of it
    if (prop.erase?.length) {
      const patch = (img, flat) => {
        if (!img) return img;
        const out = { ...img, data: Buffer.from(img.data) };
        for (const [u0, v0, u1, v1, fu, fv] of prop.erase) {
          const x0 = Math.round(u0 * img.width), x1 = Math.round(u1 * img.width), y0 = Math.round(v0 * img.height), y1 = Math.round(v1 * img.height);
          const sx = Math.round(fu * img.width), sy = Math.round(fv * img.height), size = 8;
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const d = (y * img.width + x) * 3;
            if (flat) { out.data[d] = flat[0]; out.data[d + 1] = flat[1]; out.data[d + 2] = flat[2]; continue; }
            // a mirrored tiling of the patch, so that it has no seams
            const mx = (x - x0) % (2 * size), my = (y - y0) % (2 * size);
            const s = ((sy + (my < size ? my : 2 * size - 1 - my)) * img.width + sx + (mx < size ? mx : 2 * size - 1 - mx)) * 3;
            out.data[d] = img.data[s]; out.data[d + 1] = img.data[s + 1]; out.data[d + 2] = img.data[s + 2];
          }
        }
        return out;
      };
      c = patch(c); n = patch(n, [128, 128, 255]); o = patch(o);
    }
    if (c && prop.hue) c = { ...c, data: await sharp(c.data, { raw: { width: c.width, height: c.height, channels: 3 } }).modulate({ hue: prop.hue }).raw().toBuffer() };
    const first = c ?? n ?? o;
    const cut = await crop(first, t.uv, iw, ih);
    t.rect = cut.rect;
    if (c) blit(colour, t, cut.data); else fill(colour, t, m.colorFactor.slice(0, 3).map(toSrgb));
    if (n) blit(normal, t, (await crop(n, t.uv, iw, ih)).data); else fill(normal, t, [128, 128, 255]);
    if (o) {
      const data = (await crop(o, t.uv, iw, ih)).data;
      // the material's factors scale the texture (a metalness factor of 0 turns the metal channel off)
      if (m.rough !== 1 || m.metal !== 1) for (let k = 0; k < data.length; k += 3) { data[k + 1] = Math.round(data[k + 1] * m.rough); data[k + 2] = Math.round(data[k + 2] * m.metal); }
      blit(orm, t, data);
    } else fill(orm, t, [255, Math.round(m.rough * 255), Math.round(m.metal * 255)]);
    if (m.emissive) blit(emission, t, (await crop(await image(m.emissive), t.uv, iw, ih)).data);
  }
  // UVs into the atlas
  const count = mesh.position.length / 3;
  for (let v = 0; v < count; v++) {
    const t = tiles[mesh.skinId[v]], [u0, v0, u1, v1] = t.rect;
    const u = t.flat ? 0.5 : (mesh.uv[v * 2] - u0) / (u1 - u0), w = t.flat ? 0.5 : (mesh.uv[v * 2 + 1] - v0) / (v1 - v0);
    mesh.uv[v * 2] = (t.x + GUTTER + Math.min(1, Math.max(0, u)) * (t.w - 2 * GUTTER)) / ATLAS;
    mesh.uv[v * 2 + 1] = (t.y + GUTTER + Math.min(1, Math.max(0, w)) * (t.h - 2 * GUTTER)) / ATLAS;
  }
  // Bulbs without an emission texture, and where every lamp shines from: the triangles that read a bright part of the
  // emission atlas, gathered into the lights they form (a bulb, a tube)
  const P = mesh.position;
  const at = (v) => [mesh.uv[v * 2] * ATLAS, mesh.uv[v * 2 + 1] * ATLAS];
  const bright = (x, y) => { const e = (Math.min(ATLAS - 1, Math.max(0, Math.floor(y))) * ATLAS + Math.min(ATLAS - 1, Math.max(0, Math.floor(x)))) * 3; return emission[e] * 0.3 + emission[e + 1] * 0.6 + emission[e + 2] * 0.1; };
  const lit = [];
  for (let k = 0; k < mesh.index.length; k += 3) {
    const [a, b, c] = [mesh.index[k], mesh.index[k + 1], mesh.index[k + 2]];
    const skin = tiles[mesh.skinId[a]].skin;
    const [pa, pb, pc] = [at(a), at(b), at(c)];
    if (mesh.glow[a] && mesh.glow[b] && mesh.glow[c] && skin.glow) paint(emission, pa, pb, pc, skin.glow.map(toSrgb));
    // the middle of the triangle and a point towards each corner
    let sum = 0;
    for (const [wa, wb, wc] of [[1 / 3, 1 / 3, 1 / 3], [2 / 3, 1 / 6, 1 / 6], [1 / 6, 2 / 3, 1 / 6], [1 / 6, 1 / 6, 2 / 3]]) sum += bright(pa[0] * wa + pb[0] * wb + pc[0] * wc, pa[1] * wa + pb[1] * wb + pc[1] * wc);
    if (sum / 4 < 110) continue;
    const ab = [0, 1, 2].map((ax) => P[b * 3 + ax] - P[a * 3 + ax]), ac = [0, 1, 2].map((ax) => P[c * 3 + ax] - P[a * 3 + ax]);
    const area = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]) / 2;
    const box3 = [0, 1, 2].map((ax) => Math.min(P[a * 3 + ax], P[b * 3 + ax], P[c * 3 + ax])).concat([0, 1, 2].map((ax) => Math.max(P[a * 3 + ax], P[b * 3 + ax], P[c * 3 + ax])));
    lit.push({ area, sum: [0, 1, 2].map((ax) => (P[a * 3 + ax] + P[b * 3 + ax] + P[c * 3 + ax]) / 3 * area), box: box3 });
  }
  // lit surfaces closer than 6 cm are one light
  let lights = lit;
  for (let merged = true; merged;) {
    merged = false;
    const next = [];
    for (const l of lights) {
      const home = next.find((n) => [0, 1, 2].every((c) => l.box[c] <= n.box[c + 3] + 0.06 && l.box[c + 3] >= n.box[c] - 0.06));
      if (!home) { next.push({ area: l.area, sum: [...l.sum], box: [...l.box] }); continue; }
      home.area += l.area;
      for (let c = 0; c < 3; c++) { home.sum[c] += l.sum[c]; home.box[c] = Math.min(home.box[c], l.box[c]); home.box[c + 3] = Math.max(home.box[c + 3], l.box[c + 3]); }
      merged = true;
    }
    lights = next;
  }
  const round = (v) => +v.toFixed(3);
  mesh.lights = lights.filter((l) => l.area > 2e-4).map((l) => ({ at: l.sum.map((v) => round(v / l.area)), min: l.box.slice(0, 3).map(round), max: l.box.slice(3).map(round) }));
}

// ---------------------------------------------------------------------------------------------------------------------
// kit.bin: header, then positions (uint16 x 3, across each prop's own box), normals (int8 x 3), uvs (uint16 x 2, across
// the atlas) and indices (uint16, counted from the prop's first vertex)
// ---------------------------------------------------------------------------------------------------------------------
const totalVertices = built.reduce((s, b) => s + b.mesh.position.length / 3, 0), totalIndices = built.reduce((s, b) => s + b.mesh.index.length, 0);
const qPosition = new Uint16Array(totalVertices * 3), qNormal = new Int8Array(totalVertices * 3), qUv = new Uint16Array(totalVertices * 2), qIndex = new Uint16Array(totalIndices);
const header = { version: 1, atlas: ATLAS, props: [] };
let vertexAt = 0, indexAt = 0;
for (const { prop, mesh } of built) {
  const count = mesh.position.length / 3;
  if (count > 65535) throw new Error(`${prop.name}: ${count} vertices do not fit 16-bit indices`);
  const size = mesh.max.map((v, c) => v - mesh.min[c]);
  for (let v = 0; v < count; v++) {
    for (let c = 0; c < 3; c++) {
      qPosition[(vertexAt + v) * 3 + c] = Math.round(Math.min(1, Math.max(0, (mesh.position[v * 3 + c] - mesh.min[c]) / (size[c] || 1))) * 65535);
      qNormal[(vertexAt + v) * 3 + c] = Math.round(Math.min(1, Math.max(-1, mesh.normal[v * 3 + c])) * 127);
    }
    qUv[(vertexAt + v) * 2] = Math.round(mesh.uv[v * 2] * 65535);
    qUv[(vertexAt + v) * 2 + 1] = Math.round(mesh.uv[v * 2 + 1] * 65535);
  }
  qIndex.set(mesh.index, indexAt);
  header.props.push({
    name: prop.name, anchor: prop.anchor ?? 'floor', size: size.map((v) => +v.toFixed(4)), min: mesh.min.map((v) => +v.toFixed(4)), max: mesh.max.map((v) => +v.toFixed(4)),
    vertices: count, triangles: mesh.index.length / 3, vertexStart: vertexAt, indexStart: indexAt, ...(mesh.lights.length ? { lights: mesh.lights } : {})
  });
  vertexAt += count; indexAt += mesh.index.length;
}
const sections = [qPosition, qNormal, qUv, qIndex].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
header.sections = sections.map((s) => s.length);
const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
const head = Buffer.from(JSON.stringify(header));
const length = Buffer.alloc(4);
length.writeUInt32LE(head.length);
fs.writeFileSync(path.join(OUT, 'kit.bin'), Buffer.concat([pad(Buffer.concat([length, head])), ...sections.map(pad)]));

const webp = (data, file, options) => sharp(data, { raw: { width: ATLAS, height: ATLAS, channels: 3 } }).webp({ effort: 6, ...options }).toFile(path.join(OUT, file));
await webp(colour, 'kit_c.webp', { quality: 82 });
// normals and the three unrelated channels of the orm map suffer from halved chroma: the careful subsampling is worth its bytes
await webp(turnGreen(normal), 'kit_n.webp', { quality: 90, smartSubsample: true });
await webp(orm, 'kit_orm.webp', { quality: 82, smartSubsample: true });
await webp(emission, 'kit_e.webp', { quality: 80 });

// ---------------------------------------------------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------------------------------------------------
// Pyramid acoustic foam, drawn: the relief gives the normals and the shade in the hollows, a fine grain gives the cells
function pyramids(size, cells) {
  const colourOut = Buffer.alloc(size * size * 3), normalOut = Buffer.alloc(size * size * 3), roughOut = Buffer.alloc(size * size * 3);
  let seed = 12345;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const grain = Float32Array.from({ length: size * size }, () => random());
  const tone = Float32Array.from({ length: cells * cells }, () => 0.92 + random() * 0.16);
  // a pyramid with a slightly rounded tip and a narrow flat hollow, as cut foam has
  const height = (x, y) => {
    const fx = Math.abs(((x / size) * cells) % 1 - 0.5) * 2, fy = Math.abs(((y / size) * cells) % 1 - 0.5) * 2;
    const d = Math.max(fx, fy), soft = Math.hypot(fx, fy) * 0.7071;
    const h = 1 - (d * 0.85 + soft * 0.15);
    return Math.min(0.94, Math.max(0.03, h)) + (h > 0.94 ? (h - 0.94) * 0.3 : 0);
  };
  const cell = size / cells, slope = 1.25; // the pyramids are 1.25 times as tall as half their base
  const wrap = (v) => ((v % size) + size) % size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const g = (grain[i] + grain[wrap(y + 1) * size + x] + grain[y * size + wrap(x + 1)]) / 3 - 0.5;
    const h = height(x + 0.5, y + 0.5);
    const dx = (height(x + 1.5, y + 0.5) - height(x - 0.5, y + 0.5)) / 2 * (cell / 2) * slope + (grain[y * size + wrap(x + 1)] - grain[y * size + wrap(x - 1)]) * 0.22;
    const dy = (height(x + 0.5, y + 1.5) - height(x + 0.5, y - 0.5)) / 2 * (cell / 2) * slope + (grain[wrap(y + 1) * size + x] - grain[wrap(y - 1) * size + x]) * 0.22;
    const l = Math.hypot(dx, dy, 1);
    normalOut[i * 3] = Math.round(128 - (dx / l) * 127);
    normalOut[i * 3 + 1] = Math.round(128 + (dy / l) * 127); // OpenGL: green points up the image
    normalOut[i * 3 + 2] = Math.round(128 + (1 / l) * 127);
    const shade = (0.42 + 0.58 * h ** 0.8) * tone[Math.floor((y / size) * cells) * cells + Math.floor((x / size) * cells)] * (1 + g * 0.3);
    colourOut[i * 3] = Math.min(255, Math.round(62 * shade));
    colourOut[i * 3 + 1] = Math.min(255, Math.round(64 * shade));
    colourOut[i * 3 + 2] = Math.min(255, Math.round(69 * shade));
    roughOut[i * 3] = roughOut[i * 3 + 1] = roughOut[i * 3 + 2] = Math.round(238 + g * 30);
  }
  return { colour: colourOut, normal: normalOut, rough: roughOut };
}

const surfaces = {};
for (const [name, spec] of Object.entries(SURFACES)) {
  if (ONLY && !ONLY.includes(name) && !ONLY.includes('surfaces')) continue;
  const write = (data, suffix, size, quality) => sharp(data, { raw: { width: size, height: size, channels: 3 } }).webp({ quality, effort: 6, smartSubsample: suffix === 'n' }).toFile(path.join(OUT, `surf_${name}_${suffix}.webp`));
  if (spec.make) {
    const drawn = pyramids(SURFACE, 8);
    await write(drawn.colour, 'c', SURFACE, 82);
    await write(turnGreen(drawn.normal), 'n', SURFACE, 88);
    await write(await sharp(drawn.rough, { raw: { width: SURFACE, height: SURFACE, channels: 3 } }).resize(SURFACE / 2, SURFACE / 2).raw().toBuffer(), 'r', SURFACE / 2, 80);
    surfaces[name] = { id: null, source: 'drawn by tools/calibre/build-kit.mjs', metres: spec.metres, authors: [] };
  } else {
    const info = await json(`https://api.polyhaven.com/info/${spec.id}`, path.join(WORK, 'textures', spec.id, 'info.json'));
    const resized = async (map, size) => sharp(await texture(spec.id, map)).resize(size, size, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().toColourspace('srgb').raw().toBuffer();
    const three = (data, size) => { if (data.length === size * size * 3) return data; const out = Buffer.alloc(size * size * 3); for (let i = 0; i < size * size; i++) out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = data[i]; return out; };
    await write(three(await resized('Diffuse', SURFACE), SURFACE), 'c', SURFACE, 82);
    await write(turnGreen(three(await resized('nor_gl', SURFACE), SURFACE)), 'n', SURFACE, 88);
    await write(three(await resized('Rough', SURFACE / 2), SURFACE / 2), 'r', SURFACE / 2, 80);
    surfaces[name] = { id: spec.id, title: info.name ?? spec.id, metres: +(((info.dimensions?.[0] ?? 2000) / 1000).toFixed(3)), authors: Object.keys(info.authors ?? {}) };
  }
  console.log(`surface ${name.padEnd(8)} ${surfaces[name].id ?? '(drawn)'}  ${surfaces[name].metres} m`);
}

// ---------------------------------------------------------------------------------------------------------------------
// kit.json: what a person (or a test) wants to know without decoding kit.bin
// ---------------------------------------------------------------------------------------------------------------------
{
  const manifest = {
    atlas: { size: ATLAS, gutter: GUTTER, colour: 'kit_c.webp', normal: 'kit_n.webp', orm: 'kit_orm.webp', emission: 'kit_e.webp' },
    props: built.map(({ prop, mesh, tiles, info, source }, i) => ({
      name: prop.name, id: prop.id, title: info.name ?? prop.id, authors: Object.keys(info.authors ?? {}), budget: prop.tris, triangles: header.props[i].triangles, sourceTriangles: source,
      vertices: header.props[i].vertices, size: header.props[i].size, min: header.props[i].min, max: header.props[i].max, anchor: header.props[i].anchor,
      rects: tiles.filter((t) => t.used).map((t) => [t.x, t.y, t.w, t.h]), ...(mesh.lights.length ? { lights: mesh.lights } : {})
    })),
    surfaces
  };
  fs.writeFileSync(path.join(OUT, 'kit.json'), JSON.stringify(manifest, null, 1) + '\n');
}
let total = 0;
for (const f of fs.readdirSync(OUT).sort()) { const s = fs.statSync(path.join(OUT, f)).size; total += s; console.log(`${f.padEnd(22)} ${(s / 1024).toFixed(0).padStart(6)} kB`); }
console.log(`${'total'.padEnd(22)} ${(total / 1024 / 1024).toFixed(2).padStart(6)} MB  (${totalVertices} vertices, ${totalIndices / 3} triangles)`);
