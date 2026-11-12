// The Wasteland's prop kit: scanned rocks and dead wood, and the clutter of a camp at the end of the world, all from
// Poly Haven (CC0): downloaded, flattened, simplified to two levels of detail and packed for js/wasteland-kit.js.
// Adapted from tools/calibre/build-kit.mjs: same glTF reader, same atlas and normal maps, its simplification with a cap
// on the error, and two levels of detail per prop.
// Usage: node tools/wasteland/build-kit.mjs <work folder> [--out dir] [--no-fetch] [--only name,name] [--atlas 4096x2048]
//   kit.bin       a JSON header, then every prop's two levels (full, low): positions and normals quantised, uvs in
//                 the atlas, indices
//   kit_c.webp    the props' shared atlas: colour (sRGB). A = coverage: 1 everywhere but in the holes of the cut-out
//                 props (chain-link wire, leaves), which are drawn with an alpha test
//   kit_n.webp    tangent-space normals, green turned over (see below)
//   kit_orm.webp  R = occlusion, G = roughness, B = metalness (glTF order), at half the atlas's size
//   kit.json      every prop: source, authors, real size, triangles per level, where its base is, a collider, flags
// The green of the normal map: the sources are OpenGL maps (green = up the image). The game loads its textures with
// flipY = false and has no tangents, so three.js derives the bitangent from the uvs: it points where v grows, down the
// image. An OpenGL map drawn that way is lit upside down (tools/calibre/build-kit.mjs has the proof). So the atlas has
// its green turned over, and a material uses it as it is: normalMap, normalScale (1, 1).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGltf } from '../calibre/gltf.mjs';
import { dependency, polyHaven, pool } from './shared.mjs';

const sharp = dependency('sharp');
const { MeshoptSimplifier } = dependency('meshoptimizer');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const WORK = args[0];
if (!WORK || WORK.startsWith('--')) throw new Error('usage: node tools/wasteland/build-kit.mjs <work folder> [--out dir] [--no-fetch] [--only a,b] [--atlas 4096x2048]');
const option = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const OUT = option('--out') ?? path.join(HERE, '../../assets/wasteland/');
if (args.includes('--only') && !option('--out')) throw new Error('--only writes a kit that is not the game\'s: give it an --out folder');
const ONLY = option('--only')?.split(',') ?? null;
const haven = polyHaven(WORK, !args.includes('--no-fetch'));
// The atlas: tile sizes in PROPS are written for a 2048 x 2048 atlas and scale with the one chosen here
const WIDTH = +(option('--atlas')?.split('x')[0] ?? 4096), HEIGHT = +(option('--atlas')?.split('x')[1] ?? 2048), GUTTER = 8;
const DENSITY = Math.sqrt(WIDTH * HEIGHT) / 2048;

// ---------------------------------------------------------------------------------------------------------------------
// What goes in the kit
//   name      what the game calls it                    id      Poly Haven model
//   kind      rock, wood, plant, clutter or big (a landmark): for the game to pick families from
//   tris      triangle budget of the `full` level       low     budget of the `low` level (default: a quarter)
//   tile      side of its atlas tile, in pixels of a 2048 x 2048 atlas (its area, really: the tile takes the shape of
//             the UVs the prop uses). Props made from the same model with the same tile share it (the tyre and the
//             stack of tyres)
//   scan      a photogrammetry scan: the ground it was photographed on stays at y = 0 and what was under it hangs
//             below (to bury); its normals are rebuilt smooth after the reduction. Without it, the prop's lowest point
//             is put on y = 0. Either way the origin is the centre of the footprint (but see axis)
//   sink      metres a scan is lowered by: the strip of ground photographed at its foot goes under y = 0 (negative: raised)
//   shell     a scan of a cliff face: open behind, to stand against a slope with its face towards +z
//   matte     the least roughness its texture may have (a polished stone, enlarged into a boulder, must not shine)
//   round     its collider is a vertical cylinder (default: a box)       collide   false: nothing to bump into
//   radius    the cylinder's radius, when it is not the prop's own girth (a pole with cross arms)
//   axis      the nodes whose middle is the origin, instead of the middle of the footprint (the post of that pole)
//   only      keep the nodes whose path matches         drop    remove nodes or materials that match
//   scale     the source is not in metres               orient  [[axis, degrees], ...] turns the whole prop, in order
//   move      [[nodes, [x, y, z]], ...]                 turn    [[nodes, axis, degrees, [pivot]], ...] before orient
//   place     [[nodes, [x, z], degrees], ...] puts the middle of those nodes at (x, z), turned about their own
//             vertical: gathers the pieces of a set that the source lays out in a row
//   copies    [[x, y, z, degrees], ...] the reduced prop is repeated at these places, turned about the vertical: a
//             stack. `tris` is the budget of the whole
//   alpha     { 'material pattern': 'map' } keeps these blended or masked materials as cut-outs: the map (a Poly Haven
//             file of the model: Alpha, wire_alpha) goes into the alpha of the colour atlas. Every other blended
//             material is removed (glass)
//   tiles     [[material, pixels], ...] tile size of the secondary materials (default: half the main one)
//   fine      the error the simplification may reach without asking, as a fraction of the prop's bulk (default 0.02)
//   cap       [full, low]: the error neither level may pass, whatever its budget (default [0.04, 0.07]; scans
//             [0.08, 0.16]). A level that cannot meet its budget within it keeps more triangles
//   detail    pieces smaller than this fraction of the bulk may be removed to meet the budget (default 0.1; 0: none)
//   weights   simplification: [normal, uv] weights (default [0.3, 0.5]; scans [0.12, 0.5])
// ---------------------------------------------------------------------------------------------------------------------
const PROPS = [
  // Rocks: scans, most of them from the Namaqualand desert. Six boulders with six silhouettes, and a slab
  // (boulder_01, the craggiest of Poly Haven's, is cut into 270 texture islands: it cannot be reduced without smears.)
  // boulder_a, boulder_f and the slab are hand-sized stones, scanned close: enlarged, they are boulders like the others
  { name: 'boulder_a', id: 'stone_01', kind: 'rock', tris: 1800, tile: 384, scan: true, round: true, scale: 12 }, // a red spur with a long tail
  { name: 'boulder_b', id: 'namaqualand_boulder_03', kind: 'rock', tris: 1800, tile: 416, scan: true, round: true }, // a split block, sharp edges
  { name: 'boulder_c', id: 'namaqualand_boulder_04', kind: 'rock', tris: 1800, tile: 416, scan: true, round: true }, // a rounded dome, orange lichen
  { name: 'boulder_d', id: 'namaqualand_boulder_05', kind: 'rock', tris: 1500, tile: 384, scan: true, round: true }, // a flat pale lens
  { name: 'boulder_e', id: 'namaqualand_boulder_06', kind: 'rock', tris: 1800, tile: 384, scan: true, round: true }, // a long brown loaf
  { name: 'boulder_f', id: 'rock_07', kind: 'rock', tris: 1500, tile: 352, scan: true, round: true, scale: 6, matte: 0.72 }, // a squared brown block (polished: dulled)
  { name: 'slab', id: 'rock_09', kind: 'rock', tris: 1500, tile: 384, scan: true, scale: 20 }, // a flat shard of layered rock
  // Two cliff faces: shells, open behind. They face +z and stand against a slope, never alone in the open
  { name: 'outcrop_a', id: 'namaqualand_cliff_01', kind: 'rock', tris: 3000, tile: 448, scan: true, shell: true, sink: 0.4 }, // stacked blocks, 8 m
  { name: 'outcrop_b', id: 'namaqualand_cliff_02', kind: 'rock', tris: 3000, tile: 512, scan: true, shell: true }, // a fractured wall, 20 m
  { name: 'rubble', id: 'namaqualand_rocks_01', kind: 'rock', tris: 720, tile: 224, scan: true, round: true, detail: 0,
    place: [[/_a$/, [-0.11, 0.07], 20], [/_b$/, [0.16, 0.13], 250], [/_c$/, [0.12, -0.15], 110], [/_d$/, [-0.14, -0.17], 320]] },
  // Dead wood
  { name: 'dead_trunk', id: 'dead_tree_trunk_02', kind: 'wood', tris: 1400, tile: 320, scan: true }, // a fallen trunk with its stubs
  { name: 'dead_log', id: 'dead_tree_trunk', kind: 'wood', tris: 800, tile: 256, scan: true }, // a long bleached log
  { name: 'dead_tree', id: 'dead_quiver_trunk', kind: 'wood', tris: 800, tile: 256, round: true }, // a standing dead trunk, 2 m
  { name: 'dead_branch', id: 'dry_branches_medium_01', kind: 'wood', tris: 500, tile: 192, only: /_a$/, collide: false },
  { name: 'bush', id: 'shrub_02', kind: 'plant', tris: 900, tile: 256, only: /_b$/, alpha: { '.': 'Alpha' }, collide: false, detail: 0.5 },
  { name: 'bush_wide', id: 'shrub_02', kind: 'plant', tris: 1200, tile: 256, only: /_c$/, alpha: { '.': 'Alpha' }, collide: false, detail: 0.5 },
  // What people left
  { name: 'barrel_red', id: 'Barrel_01', kind: 'clutter', tris: 600, tile: 256, round: true },
  { name: 'barrel_blue', id: 'barrel_03', kind: 'clutter', tris: 600, tile: 256, round: true },
  { name: 'fire_barrel', id: 'barrel_stove', kind: 'clutter', tris: 900, tile: 256, round: true },
  { name: 'tyre', id: 'old_tyre', kind: 'clutter', tris: 500, tile: 224, orient: [['x', -90]], round: true },
  { name: 'tyre_stack', id: 'old_tyre', kind: 'clutter', tris: 1600, low: 400, tile: 224, orient: [['x', -90]], round: true,
    copies: [[0, 0, 0, 0], [0.025, 0.158, -0.01, 50], [-0.03, 0.316, 0.02, 115], [0.015, 0.474, 0.01, 200]] },
  { name: 'jerrycan', id: 'metal_jerrycan', kind: 'clutter', tris: 500, tile: 192 },
  { name: 'gas_cylinder', id: 'small_lpg_tank', kind: 'clutter', tris: 900, tile: 192, round: true },
  { name: 'road_barrier', id: 'concrete_road_barrier', kind: 'clutter', tris: 700, tile: 288 },
  { name: 'concrete_block', id: 'concrete_road_barrier_02', kind: 'clutter', tris: 500, tile: 256 },
  { name: 'cement_bag', id: 'cement_bag', kind: 'clutter', tris: 300, tile: 160 },
  { name: 'crate', id: 'wooden_crate_01', kind: 'clutter', tris: 600, tile: 224 },
  { name: 'ammo_crate', id: 'old_military_crate', kind: 'clutter', tris: 700, tile: 224, only: /_a$/, drop: /cloth|loop|latch/ },
  { name: 'fence', id: 'modular_chainlink_fence', kind: 'clutter', tris: 400, tile: 256, only: /modular_chainlink_fence_double$/, alpha: { wire: 'wire_alpha' }, tiles: [[/wire/, 256]] },
  { name: 'ladder', id: 'ladder_sectioned_01', kind: 'clutter', tris: 800, tile: 192, only: /section_01$/ },
  { name: 'covered_car', id: 'covered_car', kind: 'big', tris: 3000, tile: 512 },
  { name: 'buoy', id: 'ocean_buoy', kind: 'big', tris: 1500, tile: 320, round: true },
  { name: 'power_pole', id: 'modular_electricity_poles', kind: 'big', tris: 1500, tile: 288, only: /^preset_01_/, round: true, radius: 0.11, axis: /_pole$/ },
  { name: 'generator', id: 'portable_generator', kind: 'clutter', tris: 2000, low: 700, tile: 256, cap: [0.05, 0.08] },
  { name: 'welding_cart', id: 'portable_welding_cart', kind: 'clutter', tris: 900, tile: 256 },
  { name: 'trash_bag', id: 'trashbag', kind: 'clutter', tris: 400, tile: 160, round: true },
  { name: 'trash_can', id: 'metal_trash_can', kind: 'clutter', tris: 600, tile: 224, only: /rust/ },
  { name: 'bed_frame', id: 'old_bed_frame', kind: 'clutter', tris: 900, tile: 192 },
  { name: 'fire_pit', id: 'stone_fire_pit', kind: 'clutter', tris: 900, tile: 256, scan: true, round: true, sink: -0.08 }, // its stones are centred on y = 0: raised, a third stays in the ground
  { name: 'chair', id: 'plastic_monobloc_chair_01', kind: 'clutter', tris: 600, low: 300, tile: 160, cap: [0.04, 0.05] },
  { name: 'table', id: 'wooden_picnic_table', kind: 'clutter', tris: 800, tile: 256 }
];

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

// A prop's parts as one mesh: positions, normals, uvs (each in its own texture's 0..1) and the skin (texture set) of
// every vertex
function assemble(prop, gltf) {
  const { materials } = gltf;
  const skins = []; // one per set of textures
  const cutOut = (m) => Object.entries(prop.alpha ?? {}).find(([pattern]) => new RegExp(pattern).test(m.name))?.[1] ?? null;
  const skinOf = (m) => {
    const key = [m.color, m.normal, m.orm, m.color ? '' : m.colorFactor.join(), cutOut(m) ?? ''].join('|');
    let skin = skins.find((s) => s.key === key);
    if (!skin) { skin = { key, material: m, index: skins.length, alpha: cutOut(m) }; skins.push(skin); }
    return skin;
  };
  const position = [], normal = [], uv = [], skinId = [], index = [], stem = [];
  let straddling = 0, wrapped = 0;
  for (const part of gltf.parts) {
    const m = materials[part.material] ?? { name: '', alphaMode: 'OPAQUE', colorFactor: [0.5, 0.5, 0.5, 1], rough: 1, metal: 0 };
    if (prop.only && !prop.only.test(part.node)) continue;
    if (prop.drop && (prop.drop.test(part.node) || prop.drop.test(m.name))) continue;
    const see = m.alphaMode !== 'OPAQUE' || m.transmission > 0;
    if (see && !cutOut(m)) {
      if (m.alphaMode === 'MASK') throw new Error(`${prop.name}: ${m.name} is a cut-out material: give it an alpha map or drop it`);
      continue;
    }
    if (!part.hasNormal || !part.hasUv) throw new Error(`${prop.name}: ${part.node} has no normals or no uvs`);
    const P = Float64Array.from(part.position), N = Float64Array.from(part.normal);
    for (const [nodes, by] of prop.move ?? []) if (nodes.test(part.node)) for (let i = 0; i < P.length; i += 3) { P[i] += by[0]; P[i + 1] += by[1]; P[i + 2] += by[2]; }
    for (const [nodes, axis, degrees, pivot] of prop.turn ?? []) if (nodes.test(part.node)) rotate(P, N, axis, degrees, pivot);
    for (const [nodes, [x, z], degrees] of prop.place ?? []) {
      if (!nodes.test(part.node)) continue;
      const b = box(P), centre = [(b[0] + b[3]) / 2, 0, (b[2] + b[5]) / 2];
      rotate(P, N, 'y', degrees, centre);
      for (let i = 0; i < P.length; i += 3) { P[i] += x - centre[0]; P[i + 2] += z - centre[2]; }
    }
    const skin = skinOf(m), first = position.length / 3;
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
      }
      return at;
    };
    for (let t = 0; t < part.index.length; t += 3) {
      const tri = [part.index[t], part.index[t + 1], part.index[t + 2]];
      const us = tri.map((v) => part.uv[v * 2]), vs = tri.map((v) => part.uv[v * 2 + 1]);
      const su = Math.floor(Math.min(...us) + 1e-4), sv = Math.floor(Math.min(...vs) + 1e-4);
      if (Math.max(...us) - su > 1.002 || Math.max(...vs) - sv > 1.002) straddling++;
      if (su || sv) wrapped++;
      for (const v of tri) index.push(vertex(v, su, sv));
    }
    if (prop.axis?.test(part.node)) stem.push([first, position.length / 3]);
  }
  if (!index.length) throw new Error(`${prop.name}: nothing left of ${prop.id} (check only/drop)`);
  if (straddling) console.warn(`  ! ${prop.name}: ${straddling} triangles tile their texture across a 0..1 border (clamped)`);
  const P = Float32Array.from(position), N = Float32Array.from(normal);
  if (prop.scale) for (let i = 0; i < P.length; i++) P[i] *= prop.scale;
  for (const [axis, degrees] of prop.orient ?? []) rotate(P, N, axis, degrees);
  // the vertical the prop stands on, when it is not the middle of its footprint: the middle of the nodes named by `axis`
  let axis = null;
  if (prop.axis) {
    if (!stem.length) throw new Error(`${prop.name}: no node matches its axis`);
    const b = stem.map(([from, to]) => box(P, from, to)).reduce((a, c) => [Math.min(a[0], c[0]), 0, Math.min(a[2], c[2]), Math.max(a[3], c[3]), 0, Math.max(a[5], c[5])]);
    axis = [(b[0] + b[3]) / 2, (b[2] + b[5]) / 2];
  }
  return { axis, position: P, normal: N, uv: Float32Array.from(uv, (v) => Math.min(1, Math.max(0, v))), skinId: Uint8Array.from(skinId), index: Uint32Array.from(index), skins, wrapped };
}

// Removes the vertices nothing draws, in the order the triangles meet them
function compact(mesh, index) {
  const order = new Map();
  const faces = Uint32Array.from(index, (v) => { if (!order.has(v)) order.set(v, order.size); return order.get(v); });
  const pick = (src, n, Type) => { const out = new Type(order.size * n); for (const [from, to] of order) for (let c = 0; c < n; c++) out[to * n + c] = src[from * n + c]; return out; };
  return { skins: mesh.skins, position: pick(mesh.position, 3, Float32Array), normal: pick(mesh.normal, 3, Float32Array), uv: pick(mesh.uv, 2, Float32Array), skinId: pick(mesh.skinId, 1, Uint8Array), index: faces };
}

// Vertices at the same place, as one: weld[i] is the first vertex found there
function welded(mesh) {
  const P = mesh.position, count = P.length / 3;
  const b = box(P), grain = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * 1e-5 || 1e-9;
  const place = new Map(), weld = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(P[i * 3] / grain)},${Math.round(P[i * 3 + 1] / grain)},${Math.round(P[i * 3 + 2] / grain)}`;
    if (!place.has(key)) place.set(key, i);
    weld[i] = place.get(key);
  }
  return weld;
}

// The separate pieces of a mesh: triangles joined through vertices at the same place
function pieces(mesh) {
  const P = mesh.position, count = P.length / 3, weld = welded(mesh);
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

// Down towards a triangle budget (see tools/calibre/build-kit.mjs, where this comes from). What the reduction must not
// blur: how a surface faces, where it reads its texture and which texture that is. So:
//   1. reduce within an error a viewer does not see (`fine`, a fraction of the prop's bulk), crossing hard edges but
//      never a texture seam: the vertices that share a place but not their uvs are protected;
//   2. if the budget is not met, the small pieces go whole, the ones that cost the most triangles for their size first;
//   3. then the error grows, seams still protected, up to `cap`: beyond it a barrel crumples and a tyre turns hexagonal;
//   4. a made object may then cross its seams, within the same cap (a smear on a far-away crate). A scan never does:
//      its texture is all it has.
// What is left may be over the budget: a level that costs more triangles than asked, never a wrecked one.
// The bulk is the cube root of the prop's volume, not its longest side.
function simplify(prop, mesh, tris, cap) {
  const target = tris * 3;
  if (mesh.index.length <= target) return compact(mesh, mesh.index);
  const count = mesh.position.length / 3;
  const attributes = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    attributes[i * 6] = mesh.normal[i * 3]; attributes[i * 6 + 1] = mesh.normal[i * 3 + 1]; attributes[i * 6 + 2] = mesh.normal[i * 3 + 2];
    attributes[i * 6 + 3] = mesh.uv[i * 2]; attributes[i * 6 + 4] = mesh.uv[i * 2 + 1];
    attributes[i * 6 + 5] = mesh.skinId[i];
  }
  const [wn, wuv] = prop.weights ?? (prop.scan ? [0.12, 0.5] : [0.3, 0.5]);
  const weights = [wn, wn, wn, wuv, wuv, 8];
  const b = box(mesh.position), sides = [b[3] - b[0], b[4] - b[1], b[5] - b[2]], longest = Math.max(...sides);
  const bulk = Math.cbrt(sides.map((v) => Math.max(v, longest * 0.05)).reduce((p, v) => p * v, 1));
  const { of, all, weld } = pieces(mesh);
  // texture seams: vertices at one place whose uvs (or textures) differ
  const protect = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const w = weld[i];
    if (w === i) continue;
    if (Math.abs(mesh.uv[i * 2] - mesh.uv[w * 2]) > 1e-4 || Math.abs(mesh.uv[i * 2 + 1] - mesh.uv[w * 2 + 1]) > 1e-4 || mesh.skinId[i] !== mesh.skinId[w]) protect[i] = protect[w] = 2;
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
    for (const p of loose) { if (total <= tris) break; gone.add(p.id); total -= p.cost; largest = Math.max(largest, p.diagonal); }
    if (gone.size) {
      source = mesh.index.filter((v, k) => !gone.has(of[mesh.index[k - (k % 3)]]));
      [kept, error] = run(source, fine);
      notes.push(`${gone.size} of ${all.length} pieces removed (up to ${(largest * 100).toFixed(1)} cm)`);
    }
  }
  for (let limit = fine * 1.5; kept.length > target && limit < cap * 1.5; limit *= 1.5) {
    [kept, error] = run(source, Math.min(limit, cap));
    notes[1] = `error raised to ${(Math.min(limit, cap) * 100).toFixed(1)} %`;
  }
  if (kept.length > target && !prop.scan) {
    const [crossed, crossedError] = run(source, cap, null);
    if (crossed.length < kept.length) { kept = crossed; error = crossedError; notes[1] = `seams crossed at ${(cap * 100).toFixed(1)} %`; }
  }
  const out = compact(mesh, kept);
  out.report = [`${natural} at ${(fine * 100).toFixed(1)} %`, `error ${(error / bulk * 100).toFixed(1)} %`, ...notes.filter(Boolean)].join(', ');
  if (kept.length > target) out.report += `  (asked for ${tris})`;
  return out;
}

// A scan reduced a hundred times keeps, at each vertex, the normal of the grain of rock that stood there. The normals
// are rebuilt from the triangles that are left, smooth across the whole skin (texture seams included): the relief
// comes back from the normal map.
function smoothNormals(mesh) {
  const P = mesh.position, weld = welded(mesh), sum = new Float64Array(P.length);
  for (let t = 0; t < mesh.index.length; t += 3) {
    const [a, b, c] = [mesh.index[t] * 3, mesh.index[t + 1] * 3, mesh.index[t + 2] * 3];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; // its length is twice the triangle's area
    for (const v of [mesh.index[t], mesh.index[t + 1], mesh.index[t + 2]]) for (let k = 0; k < 3; k++) sum[weld[v] * 3 + k] += n[k];
  }
  for (let v = 0; v < P.length / 3; v++) {
    const w = weld[v] * 3, l = Math.hypot(sum[w], sum[w + 1], sum[w + 2]);
    if (l > 0) for (let k = 0; k < 3; k++) mesh.normal[v * 3 + k] = sum[w + k] / l;
  }
}

// The same reduced prop several times over: a stack
function repeat(mesh, copies) {
  const count = mesh.position.length / 3, n = copies.length;
  const out = { ...mesh, position: new Float32Array(count * 3 * n), normal: new Float32Array(count * 3 * n), uv: new Float32Array(count * 2 * n), skinId: new Uint8Array(count * n), index: new Uint32Array(mesh.index.length * n) };
  for (const [k, [x, y, z, degrees]] of copies.entries()) {
    const P = Float32Array.from(mesh.position), N = Float32Array.from(mesh.normal);
    rotate(P, N, 'y', degrees);
    for (let i = 0; i < P.length; i += 3) { P[i] += x; P[i + 1] += y; P[i + 2] += z; }
    out.position.set(P, k * count * 3); out.normal.set(N, k * count * 3); out.uv.set(mesh.uv, k * count * 2); out.skinId.set(mesh.skinId, k * count);
    out.index.set(mesh.index.map((v) => v + k * count), k * mesh.index.length);
  }
  return out;
}

// How much of a mesh is open sheet: the length of the edges only one triangle uses, above `floor` (what is under the
// ground does not count), against the prop's bulk
function openEdges(mesh, floor) {
  const P = mesh.position, weld = welded(mesh), edges = new Map();
  for (let t = 0; t < mesh.index.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = weld[mesh.index[t + k]], b = weld[mesh.index[t + (k + 1) % 3]];
    const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  let length = 0;
  for (const [key, uses] of edges) {
    if (uses !== 1) continue;
    const a = Math.floor(key / 4294967296) * 3, b = (key % 4294967296) * 3;
    if (P[a + 1] < floor && P[b + 1] < floor) continue;
    length += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]);
  }
  return length;
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
    const s = (sy * iw + sx) * 3, d = ((tile.y + y) * WIDTH + tile.x + x) * 3;
    atlas[d] = data[s]; atlas[d + 1] = data[s + 1]; atlas[d + 2] = data[s + 2];
  }
}
function fill(atlas, tile, colour) {
  for (let y = 0; y < tile.h; y++) for (let x = 0; x < tile.w; x++) {
    const d = ((tile.y + y) * WIDTH + tile.x + x) * 3;
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
console.log(`fetching ${wanted.length} props`);
const sources = await pool(wanted, 6, (p) => haven.model(p.id));

const built = [];
const tiles = new Map(); // "textures | tile size" -> the tile of the atlas that every prop drawn with them reads
const round3 = (v) => +v.toFixed(3);
for (const [i, prop] of wanted.entries()) {
  const whole = assemble(prop, readGltf(sources[i].file));
  const n = prop.copies?.length ?? 1;
  const budgets = { full: prop.tris, low: prop.low ?? Math.max(40, Math.round(prop.tris / 4)) };
  const levels = {};
  for (const [level, tris] of Object.entries(budgets)) {
    // how far a level may stray from the source, as a fraction of its bulk: rock and wood forgive more than a barrel
    const cap = (prop.cap ?? (prop.scan ? [0.08, 0.16] : [0.04, 0.07]))[level === 'full' ? 0 : 1];
    let mesh = simplify(prop, whole, Math.floor(tris / n), cap);
    if (prop.scan) smoothNormals(mesh);
    if (prop.copies) mesh = { ...repeat(mesh, prop.copies), report: mesh.report };
    levels[level] = mesh;
  }
  // The origin: the centre of the footprint; in height, the ground of a scan or the lowest point of anything else
  const b = box(levels.full.position);
  const origin = [whole.axis?.[0] ?? (b[0] + b[3]) / 2, prop.scan ? (prop.sink ?? 0) : b[1], whole.axis?.[1] ?? (b[2] + b[5]) / 2];
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const mesh of Object.values(levels)) {
    const P = mesh.position;
    for (let v = 0; v < P.length; v += 3) for (let c = 0; c < 3; c++) {
      P[v + c] -= origin[c];
      bounds[c] = Math.min(bounds[c], P[v + c]); bounds[c + 3] = Math.max(bounds[c + 3], P[v + c]);
    }
  }
  const min = bounds.slice(0, 3), max = bounds.slice(3), size = max.map((v, c) => v - min[c]);

  // Which part of each texture the kept triangles read, and the tile that part gets
  const share = new Array(whole.skins.length).fill(0);
  for (let t = 0; t < levels.full.index.length; t += 3) share[levels.full.skinId[levels.full.index[t]]]++;
  const main = share.indexOf(Math.max(...share));
  const own = whole.skins.map((skin, k) => {
    const m = skin.material;
    let side = k === main ? prop.tile : prop.tile / 2;
    for (const [names, px] of prop.tiles ?? []) if (names.test(m.name)) side = px;
    const flat = !m.color && !m.normal && !m.orm;
    const key = `${skin.key}|${flat ? 'flat' : side}`;
    if (!tiles.has(key)) tiles.set(key, { skin, id: prop.id, matte: prop.matte ?? 0, flat, side, uv: [Infinity, Infinity, -Infinity, -Infinity], used: false, props: [] });
    return tiles.get(key);
  });
  for (const mesh of Object.values(levels)) {
    for (let v = 0; v < mesh.position.length / 3; v++) {
      const t = own[mesh.skinId[v]], u = mesh.uv[v * 2], w = mesh.uv[v * 2 + 1];
      t.used = true;
      if (!t.props.includes(prop.name)) t.props.push(prop.name);
      t.uv[0] = Math.min(t.uv[0], u); t.uv[1] = Math.min(t.uv[1], w); t.uv[2] = Math.max(t.uv[2], u); t.uv[3] = Math.max(t.uv[3], w);
    }
  }

  // What the game needs to know to place it
  const cutout = whole.skins.some((s, k) => s.alpha && share[k] > 0);
  const P = levels.full.position;
  const bulk = Math.cbrt(size.map((v) => Math.max(v, Math.max(...size) * 0.05)).reduce((p, v) => p * v, 1));
  const open = openEdges(levels.full, prop.scan ? Math.max(0.02, size[1] * 0.04) : -Infinity) / bulk;
  let collider = null;
  if (prop.collide !== false) {
    const top = max[1], foot = Math.max(0, min[1]);
    if (prop.round) {
      // the girth: how far the prop reaches from its axis, averaged over sixteen directions; a rock's is drawn in a
      // little, so that a bumper meets stone and not the air round a corner
      let reach = 0;
      for (let d = 0; d < 16; d++) {
        const cx = Math.cos(d * Math.PI / 8), cz = Math.sin(d * Math.PI / 8);
        let far = 0;
        for (let v = 0; v < P.length; v += 3) if (P[v + 1] >= foot) far = Math.max(far, P[v] * cx + P[v + 2] * cz);
        reach += far / 16;
      }
      collider = { radius: round3(prop.radius ?? reach * (prop.kind === 'rock' ? 0.85 : 1)), height: round3(top - foot), centre: [0, round3((top + foot) / 2), 0] };
      if (!whole.axis) collider.centre = [round3((min[0] + max[0]) / 2), collider.centre[1], round3((min[2] + max[2]) / 2)];
    } else {
      collider = { half: [round3(size[0] / 2), round3((top - foot) / 2), round3(size[2] / 2)], centre: [round3((min[0] + max[0]) / 2), round3((top + foot) / 2), round3((min[2] + max[2]) / 2)] };
    }
  }
  built.push({ prop, levels, own, info: sources[i].info, source: whole.index.length / 3, min, max, size, cutout, open, collider });
  console.log(`${prop.name.padEnd(15)} ${String(whole.index.length / 3).padStart(6)} -> ${String(levels.full.index.length / 3).padStart(5)} / ${String(levels.low.index.length / 3).padStart(4)} triangles  ${size.map((v) => v.toFixed(2)).join(' x ')} m  open ${open.toFixed(2)}`);
  console.log(`${''.padEnd(15)} full: ${levels.full.report ?? 'as it is'}`);
  console.log(`${''.padEnd(15)} low:  ${levels.low.report ?? 'as it is'}`);
}

// Tile sizes: two pixels of margin round the used rectangle, then a tile of the same area as side x side, shaped like it
const allTiles = [...tiles.values()].filter((t) => t.used);
for (const t of allTiles) {
  if (t.flat) { t.w = t.h = 16 + 2 * GUTTER; continue; }
  const pad = 2 / 1024;
  t.uv = [Math.max(0, t.uv[0] - pad), Math.max(0, t.uv[1] - pad), Math.min(1, t.uv[2] + pad), Math.min(1, t.uv[3] + pad)];
  const aspect = Math.min(4, Math.max(0.25, (t.uv[2] - t.uv[0]) / Math.max(1e-6, t.uv[3] - t.uv[1])));
  const round = (v) => Math.max(32, Math.round(v / 8) * 8);
  t.w = Math.min(WIDTH, round(t.side * DENSITY * Math.sqrt(aspect)));
  t.h = Math.min(HEIGHT, round(t.side * DENSITY / Math.sqrt(aspect)));
}
// Pack: if everything does not fit, every tile shrinks a little until it does
let shrink = 1;
for (; ; shrink *= 0.97) {
  for (const t of allTiles) {
    t.pw = t.flat ? t.w : Math.max(32, Math.round(t.w * shrink / 8) * 8);
    t.ph = t.flat ? t.h : Math.max(32, Math.round(t.h * shrink / 8) * 8);
  }
  const rects = allTiles.map((t) => ({ w: t.pw, h: t.ph, t }));
  if (pack(rects, WIDTH, HEIGHT)) { for (const r of rects) { r.t.x = r.x; r.t.y = r.y; r.t.w = r.w; r.t.h = r.h; } break; }
  if (shrink < 0.3) throw new Error('the atlas cannot hold these tiles');
}
const usedArea = allTiles.reduce((s, t) => s + t.w * t.h, 0) / (WIDTH * HEIGHT);
console.log(`atlas: ${allTiles.length} tiles, ${(usedArea * 100).toFixed(1)} % of ${WIDTH} x ${HEIGHT}${shrink < 1 ? `, tiles shrunk to ${(shrink * 100).toFixed(0)} %` : ''}`);

const colour = Buffer.alloc(WIDTH * HEIGHT * 3, 0x30);
const normal = Buffer.alloc(WIDTH * HEIGHT * 3);
const orm = Buffer.alloc(WIDTH * HEIGHT * 3);
const cover = Buffer.alloc(WIDTH * HEIGHT * 3, 255);
for (let i = 0; i < WIDTH * HEIGHT; i++) { normal[i * 3] = normal[i * 3 + 1] = 128; normal[i * 3 + 2] = 255; orm[i * 3] = 255; orm[i * 3 + 1] = 200; orm[i * 3 + 2] = 0; }

const images = new Map(); // file -> raw RGB, read once
const image = async (file) => { if (!images.has(file)) images.set(file, await rgb(file)); return images.get(file); };
let cutOuts = 0;
for (const t of allTiles) {
  const m = t.skin.material;
  const iw = t.w - 2 * GUTTER, ih = t.h - 2 * GUTTER;
  if (t.flat) {
    t.rect = [0, 0, 1, 1];
    fill(colour, t, m.colorFactor.slice(0, 3).map(toSrgb));
    fill(normal, t, [128, 128, 255]);
    fill(orm, t, [255, Math.round(m.rough * 255), Math.round(m.metal * 255)]);
    continue;
  }
  const c = m.color ? await image(m.color) : null;
  const n = m.normal ? await image(m.normal) : null;
  const o = m.orm ? await image(m.orm) : null;
  const cut = await crop(c ?? n ?? o, t.uv, iw, ih);
  t.rect = cut.rect;
  if (c) blit(colour, t, cut.data); else fill(colour, t, m.colorFactor.slice(0, 3).map(toSrgb));
  if (n) blit(normal, t, (await crop(n, t.uv, iw, ih)).data); else fill(normal, t, [128, 128, 255]);
  if (o) {
    const data = (await crop(o, t.uv, iw, ih)).data;
    // the material's factors scale the texture (a metalness factor of 0 turns the metal channel off)
    if (m.rough !== 1 || m.metal !== 1) for (let k = 0; k < data.length; k += 3) { data[k + 1] = Math.round(data[k + 1] * m.rough); data[k + 2] = Math.round(data[k + 2] * m.metal); }
    if (t.matte) for (let k = 1; k < data.length; k += 3) data[k] = Math.max(data[k], Math.round(t.matte * 255));
    blit(orm, t, data);
  } else fill(orm, t, [255, Math.round(m.rough * 255), Math.round(m.metal * 255)]);
  if (t.skin.alpha) { blit(cover, t, (await crop(await image(await haven.modelMap(t.id, t.skin.alpha)), t.uv, iw, ih)).data); cutOuts++; }
}
// UVs into the atlas
for (const { levels, own } of built) {
  for (const mesh of Object.values(levels)) {
    for (let v = 0; v < mesh.position.length / 3; v++) {
      const t = own[mesh.skinId[v]], [u0, v0, u1, v1] = t.rect;
      const u = t.flat ? 0.5 : (mesh.uv[v * 2] - u0) / (u1 - u0), w = t.flat ? 0.5 : (mesh.uv[v * 2 + 1] - v0) / (v1 - v0);
      mesh.uv[v * 2] = (t.x + GUTTER + Math.min(1, Math.max(0, u)) * (t.w - 2 * GUTTER)) / WIDTH;
      mesh.uv[v * 2 + 1] = (t.y + GUTTER + Math.min(1, Math.max(0, w)) * (t.h - 2 * GUTTER)) / HEIGHT;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// kit.bin: header, then positions (uint16 x 3, across each prop's own box), normals (int8 x 3), uvs (uint16 x 2, across
// the atlas) and indices (uint16, counted from the level's first vertex). A prop's two levels follow each other.
// ---------------------------------------------------------------------------------------------------------------------
const everyLevel = built.flatMap((b) => Object.values(b.levels));
const totalVertices = everyLevel.reduce((s, m) => s + m.position.length / 3, 0), totalIndices = everyLevel.reduce((s, m) => s + m.index.length, 0);
const qPosition = new Uint16Array(totalVertices * 3), qNormal = new Int8Array(totalVertices * 3), qUv = new Uint16Array(totalVertices * 2), qIndex = new Uint16Array(totalIndices);
const header = { version: 1, atlas: [WIDTH, HEIGHT], props: [] };
let vertexAt = 0, indexAt = 0;
for (const { prop, levels, min, max, size } of built) {
  const entry = { name: prop.name, size: size.map((v) => +v.toFixed(4)), min: min.map((v) => +v.toFixed(4)), max: max.map((v) => +v.toFixed(4)), levels: {} };
  for (const [level, mesh] of Object.entries(levels)) {
    const count = mesh.position.length / 3;
    if (count > 65535) throw new Error(`${prop.name}: ${count} vertices do not fit 16-bit indices`);
    for (let v = 0; v < count; v++) {
      for (let c = 0; c < 3; c++) {
        qPosition[(vertexAt + v) * 3 + c] = Math.round(Math.min(1, Math.max(0, (mesh.position[v * 3 + c] - entry.min[c]) / ((entry.max[c] - entry.min[c]) || 1))) * 65535);
        qNormal[(vertexAt + v) * 3 + c] = Math.round(Math.min(1, Math.max(-1, mesh.normal[v * 3 + c])) * 127);
      }
      qUv[(vertexAt + v) * 2] = Math.round(mesh.uv[v * 2] * 65535);
      qUv[(vertexAt + v) * 2 + 1] = Math.round(mesh.uv[v * 2 + 1] * 65535);
    }
    qIndex.set(mesh.index, indexAt);
    entry.levels[level] = { vertices: count, triangles: mesh.index.length / 3, vertexStart: vertexAt, indexStart: indexAt };
    vertexAt += count; indexAt += mesh.index.length;
  }
  header.props.push(entry);
}
const sections = [qPosition, qNormal, qUv, qIndex].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
header.sections = sections.map((s) => s.length);
const padded = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
const head = Buffer.from(JSON.stringify(header));
const length = Buffer.alloc(4);
length.writeUInt32LE(head.length);
fs.writeFileSync(path.join(OUT, 'kit.bin'), Buffer.concat([padded(Buffer.concat([length, head])), ...sections.map(padded)]));

// The colour atlas carries the cut-outs in its alpha, never 0: WebP throws away the colour under a transparent pixel,
// and the smaller mip levels would then draw a dark fringe round every leaf
const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
for (let i = 0; i < WIDTH * HEIGHT; i++) { rgba[i * 4] = colour[i * 3]; rgba[i * 4 + 1] = colour[i * 3 + 1]; rgba[i * 4 + 2] = colour[i * 3 + 2]; rgba[i * 4 + 3] = Math.max(2, cover[i * 3]); }
const webp = (data, file, options, channels = 3, scale = 1) => {
  const image = sharp(data, { raw: { width: WIDTH, height: HEIGHT, channels } });
  return (scale === 1 ? image : image.resize(WIDTH * scale, HEIGHT * scale, { kernel: 'lanczos3' })).webp({ effort: 6, ...options }).toFile(path.join(OUT, file));
};
await webp(rgba, 'kit_c.webp', { quality: 82, alphaQuality: 90 }, 4);
// normals and the three unrelated channels of the orm map suffer from halved chroma: the careful subsampling is worth its bytes
await webp(turnGreen(normal), 'kit_n.webp', { quality: 86, smartSubsample: true });
// occlusion, roughness and metalness change slowly: half the size is enough (the uvs are the same)
await webp(orm, 'kit_orm.webp', { quality: 82, smartSubsample: true }, 3, 0.5);

// ---------------------------------------------------------------------------------------------------------------------
// kit.json: what a person (or a test, or the game) wants to know without decoding kit.bin
// ---------------------------------------------------------------------------------------------------------------------
{
  const manifest = {
    atlas: { width: WIDTH, height: HEIGHT, gutter: GUTTER, colour: 'kit_c.webp', normal: 'kit_n.webp', orm: 'kit_orm.webp', ormScale: 0.5, cutOuts },
    bin: 'kit.bin',
    props: built.map(({ prop, own, info, source, cutout, open, collider }, i) => {
      const h = header.props[i];
      return {
        name: prop.name, kind: prop.kind, id: prop.id, title: info.name ?? prop.id, authors: Object.keys(info.authors ?? {}),
        size: h.size, min: h.min, max: h.max,
        triangles: { full: h.levels.full.triangles, low: h.levels.low.triangles }, vertices: { full: h.levels.full.vertices, low: h.levels.low.vertices }, sourceTriangles: source,
        // on the ground: the base is the plane y = 0. Otherwise `buried` metres of it hang under y = 0 (a scan's skirt)
        grounded: h.min[1] > -0.005, buried: round3(Math.max(0, -h.min[1])),
        collider,
        // cutout: has holes cut by the alpha of the colour atlas (alpha test). twoSided: has open sheets, whose back shows
        cutout, twoSided: cutout || open > 0.5, ...(prop.shell ? { shell: true } : {}),
        rects: own.filter((t) => t.used && t.props.includes(prop.name)).map((t) => [t.x, t.y, t.w, t.h])
      };
    })
  };
  fs.writeFileSync(path.join(OUT, 'kit.json'), JSON.stringify(manifest, null, 1) + '\n');
}
let total = 0;
for (const f of ['kit.bin', 'kit_c.webp', 'kit_n.webp', 'kit_orm.webp', 'kit.json']) { const s = fs.statSync(path.join(OUT, f)).size; total += s; console.log(`${f.padEnd(14)} ${(s / 1024).toFixed(0).padStart(6)} kB`); }
console.log(`${'kit'.padEnd(14)} ${(total / 1024 / 1024).toFixed(2).padStart(6)} MB  (${built.length} props, ${totalVertices} vertices, ${totalIndices / 3} triangles)`);
