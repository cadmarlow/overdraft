import * as THREE from 'three/webgpu';
import { CURB_HEIGHT, accumulator, buildIsland, buildRoads } from './ground-plan.js';
import { dressRoads, dressIsland } from './ground-dressing.js';
import { OBJECT_ATLAS, MARK_ATLAS } from './ground-atlas.js';
import {
  createGroundRoadMaterial, createGroundWalkMaterial, createGroundCurbMaterial, createGutterMaterial, createGroundObjectMaterial, createGroundMarkMaterial
} from './ground-materials.js';

// The ground's meshes, from the plans of js/ground-plan.js: curbstones, sidewalks and gutters of every curb island
// (called by city-grid.js while it lays the island out) and, once the road network exists, the lane bands of every
// roadway. Everything is static and cut into cells, so streets far away or behind the camera are not drawn.

const CELL = 640;
const CULL_DISTANCE = 1500; // a sidewalk's detail is long gone by then; the island's deck is still there
const cellKey = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
const DECAL_CELL = 256;
const DECAL_CULL = 340; // a manhole cover is a few pixels by then
let islands = []; // the curb islands buildIslands() dressed in stone, for buildGroundDressing()

function mesh(name, acc, material, attributes, first) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(acc.position, 3));
  if (acc.normal) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(acc.normal, 3));
  else {
    const normal = new Float32Array(acc.position.length);
    for (let i = 1; i < normal.length; i += 3) normal[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  }
  for (const [key, size] of attributes) geometry.setAttribute(key, new THREE.Float32BufferAttribute(acc[key], size));
  geometry.setIndex(acc.count <= 65535 ? new THREE.Uint16BufferAttribute(acc.index, 1) : new THREE.Uint32BufferAttribute(acc.index, 1));
  geometry.computeBoundingSphere();
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.receiveShadow = true;
  m.castShadow = false; // a 22 cm step casts nothing a shadow map can hold
  m.userData.cullDistance = CULL_DISTANCE;
  if (first) m.userData.sharesPipelineWith = first;
  return m;
}

/**
 * Curbstones, sidewalks and gutters of the given curb islands (city-config.js BLOCKS), added to `group`.
 * @returns {{ walk: THREE.Material, curb: THREE.Material, gutter: THREE.Material }} the materials, for the caller's batching
 */
function buildIslands(group, blocks) {
  const materials = { walk: createGroundWalkMaterial({ coords: true }), curb: createGroundCurbMaterial({ coords: true }), gutter: createGutterMaterial() };
  const cells = new Map();
  islands = blocks;
  for (const b of blocks) {
    const key = cellKey(b.cx, b.cz);
    let acc = cells.get(key);
    if (!acc) cells.set(key, (acc = { curb: accumulator(), walk: accumulator(), gutter: accumulator() }));
    // A planted mall has no gutter litter to speak of on its narrow ends, but the same curb
    buildIsland(b, acc, { gutter: !b.median });
  }
  const first = {};
  for (const acc of cells.values()) {
    for (const part of ['curb', 'walk', 'gutter']) {
      if (!acc[part].index.length) continue;
      const m = mesh(`Ground${part[0].toUpperCase()}${part.slice(1)}`, acc[part], materials[part], [['coord', 4]], first[part]);
      if (part === 'gutter') m.renderOrder = -0.5; // over the road paint, under the other see-through ground effects
      first[part] ??= m;
      group.add(m);
    }
  }
  return materials;
}

/** The lane bands of every roadway of the network, over the island's asphalt deck */
function buildRoadSurface(scene, network) {
  const material = createGroundRoadMaterial({ street: true });
  const cells = new Map();
  const cellOf = (x, z) => {
    const key = cellKey(x, z);
    let acc = cells.get(key);
    if (!acc) cells.set(key, (acc = { position: [], road: [], band: [], flow: [], index: [], count: 0 }));
    return acc;
  };
  buildRoads(network, cellOf);
  const group = new THREE.Group();
  group.name = 'GroundRoads';
  let first = null;
  for (const acc of cells.values()) {
    const m = mesh('GroundRoad', acc, material, [['road', 4], ['band', 4], ['flow', 4]], first);
    first ??= m;
    group.add(m);
  }
  scene.add(group);
  group.updateMatrixWorld(true);
  return group;
}

/**
 * Everything set in or painted on the ground (js/ground-dressing.js): covers, grates, cellar doors and pads from the
 * object atlas, road symbols and stains from the mark atlas, as flat quads over the roadways and sidewalks.
 */
function buildGroundDressing(scene, network, { grates = [], cellars = [], treeGrates = [] } = {}) {
  const sheets = {
    object: { atlas: OBJECT_ATLAS, material: createGroundObjectMaterial(), cells: new Map(), order: -0.8, name: 'GroundObjects' },
    mark: { atlas: MARK_ATLAS, material: createGroundMarkMaterial(), cells: new Map(), order: -0.9, name: 'GroundMarks' }
  };
  const emit = (d) => {
    const sheet = sheets[d.sheet];
    const tile = sheet.atlas.tiles[d.tile];
    if (!tile) return;
    const key = `${Math.floor(d.x / DECAL_CELL)},${Math.floor(d.z / DECAL_CELL)}`;
    let acc = sheet.cells.get(key);
    if (!acc) sheet.cells.set(key, (acc = { position: [], uv: [], tint: [], frame: [], index: [], count: 0 }));
    const w = (tile.metres[0] * d.scale) / 2, l = (tile.metres[1] * d.scale) / 2;
    const rx = -d.lz, rz = d.lx; // the tile's width runs to the right of the direction its top points to
    const size = sheet.atlas.size;
    const u0 = (tile.x + 0.5) / size, u1 = (tile.x + tile.w - 0.5) / size, v0 = (tile.y + 0.5) / size, v1 = (tile.y + tile.h - 0.5) / size;
    const third = d.sheet === 'object' ? tile.metal ?? 0 : d.gloss;
    for (const [a, b, u, v] of [[-1, -1, u0, v1], [1, -1, u1, v1], [1, 1, u1, v0], [-1, 1, u0, v0]]) {
      acc.position.push(d.x + rx * w * a + d.lx * l * b, d.y, d.z + rz * w * a + d.lz * l * b);
      acc.uv.push(u, v);
      acc.tint.push(d.tint[0], d.tint[1], d.tint[2], d.tint[3]);
      acc.frame.push(d.lx, d.lz, third, d.wear);
    }
    acc.index.push(acc.count, acc.count + 1, acc.count + 2, acc.count, acc.count + 2, acc.count + 3);
    acc.count += 4;
  };

  dressRoads(network, emit);
  for (const b of islands) dressIsland(b, emit);
  // What sidewalk-furniture.js sited from the city's registers and no longer draws itself: the subway's ventilation
  // gratings along the lines (three modules of bar grating each, laid along the curb) and the shops' cellar doors
  const flat = { y: CURB_HEIGHT + 0.004, scale: 1, tint: [1, 1, 1, 1], gloss: 0.6, wear: 0 };
  for (const g of grates) {
    const sx = Math.sin(g.yaw), sz = Math.cos(g.yaw);
    for (const k of [-1, 0, 1]) emit({ ...flat, sheet: 'object', tile: 'subway_grate', x: g.x + sx * k * 1.4, z: g.z + sz * k * 1.4, lx: sz, lz: -sx, scale: 0.875 });
  }
  for (const c of cellars) emit({ ...flat, sheet: 'object', tile: 'cellar_door', x: c.x, z: c.z, lx: Math.sin(c.yaw), lz: Math.cos(c.yaw), scale: 0.95 });
  // The cast-iron grates over the tree beds street-details.js dug
  for (const t of treeGrates) emit({ ...flat, sheet: 'object', tile: 'tree_grate', x: t.x, z: t.z, y: t.y, lx: Math.sin(t.yaw), lz: Math.cos(t.yaw), scale: t.scale });

  const group = new THREE.Group();
  group.name = 'GroundDressing';
  for (const sheet of Object.values(sheets)) {
    let first = null;
    for (const acc of sheet.cells.values()) {
      const m = mesh(sheet.name, acc, sheet.material, [['uv', 2], ['tint', 4], ['frame', 4]], first);
      m.renderOrder = sheet.order; // over the road paint (-1), under the gutters and the other see-through ground effects
      m.userData.cullDistance = DECAL_CULL;
      first ??= m;
      group.add(m);
    }
  }
  scene.add(group);
  group.updateMatrixWorld(true);
  return group;
}

export { buildIslands, buildRoadSurface, buildGroundDressing };
