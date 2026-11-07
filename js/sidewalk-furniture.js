import * as THREE from 'three/webgpu';
import { blockAt, districtAt, nearestRoads } from './city-config.js';
import { polygonContains } from './building-collision.js';
import { createKitMaterials, createKitParts, TILES, SITE } from './sidewalk-kit.js';
import { zoneOf, ZONE, slotHash as hash } from './parking-plan.js';
import { SHOP_TYPES } from './storefront-types.js';

// What stands on a New York sidewalk. Where the city's registers say so (js/street-geodata.js: bus stops and shelters,
// newsstands, bike racks, benches, LinkNYC kiosks, muni-meters, building sites under sidewalk sheds, outdoor dining),
// the real thing stands at its real place; the rest follows the rules of the street along every curb of the road
// network and in front of every building (parking signs, litter baskets at the corners, newspaper boxes, subway
// grates over the lines, standpipes, cellar doors, tree guards, café tables, the dumpsters and cones of the sites).
// Parts come from sidewalk-kit.js, instanced per cell (160 m for small things, 480 m for what reads from afar) and
// culled by distance; the solid ones become obstacles for cars and people, the light ones go down under a car.

const CELL_NEAR = 240, CELL_FAR = 320;
// How far each part draws (m)
const CULL = {
  sign: 120, basket: 130, newsCluster: 130, meter: 110, rack: 110, bike: 110, link: 220, linkScreen: 220, shelter: 260, shelterGlass: 180,
  shelterLamp: 360, busStop: 160, newsstand: 260, newsstandLight: 360, bench: 120, grate: 150, standpipe: 80, cellar: 90, treeGuard: 100,
  shedBay: 210, shedBoard: 380, shedLight: 300, dumpster: 220, cone: 110, jersey: 180, portaloo: 180, alarmBox: 120, cafeSet: 150,
  diningShed: 240, barrierFence: 150
};
const SUBWAY = ['lex', '7th', 'broadway', '8th', '6th', 'central park w', 'st nicholas', 'park ave', '2nd ave', 'nassau', 'william'];
const CAFE_TYPES = new Set(['restaurant', 'cafe', 'bar', 'bakery', 'pizza', 'sushi', 'latin', 'juice', 'diner', 'takeout']);
const OLD_TYPES = new Set(['rowhouse', 'tenement', 'loft', 'prewar']);
const BIKE_COLOURS = [0x2e5a9c, 0xc8322a, 0x1c1c1c, 0xe6e6e6, 0x2f7d4e, 0xd98a1f, 0x6a3fa0];
const PLATES = [TILES.sign0, TILES.sign1, TILES.sign2, TILES.sign3];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * @param {THREE.Scene} scene
 * @param {object} o
 * @param {object} o.network - road network (edges with sx, sz, dx, dz, rx, rz, len, half, axis, id, opposite)
 * @param {object[]} o.records - buildings (polygons, height, style.type, cx, cz, minX...)
 * @param {object[]} [o.shops] - storefront plan (x, z, ux, uz, nx, nz, width, type)
 * @param {object[]} [o.trunks] - street trees ({x, z})
 * @param {object} [o.street] - js/street-geodata.js STREET (kinds), when loaded
 * @param {Function} o.isOnSidewalk - (x, z, pad) from street-details
 * @param {Function} o.isClearOfPoles - (x, z, minDist)
 * @param {Function} o.addPole - (x, z, width): registers a pole for later clearance tests, as a pedestrian footprint
 * @param {Function} o.addFootprint - (x, z, w, d, pedestrianOnly)
 * @param {object[]} o.obstacles - street-details obstacles: what cars and people run into (pushed to)
 * @param {object[]} [o.colliders] - the controllers' colliders (shed decks go here, walkable)
 */
function createSidewalkFurniture(scene, o) {
  const { network, records = [], shops = [], trunks = [], street = null, isOnSidewalk, isClearOfPoles, addPole, addFootprint, obstacles, colliders = [] } = o;
  const t0 = performance.now();
  const group = new THREE.Group();
  group.name = 'SidewalkFurniture';
  scene.add(group);
  const materials = createKitMaterials();
  const parts = createKitParts();
  const kinds = street?.kinds || {};
  const points = (name) => {
    const k = kinds[name];
    if (!k || !k.count) return [];
    const out = [];
    for (let i = 0; i < k.count; i++) out.push({ x: k.data[i * k.stride], z: k.data[i * k.stride + 1], extra: k.stride > 2 ? k.data[i * k.stride + 2] : 0 });
    return out;
  };

  // ---- Buildings by cell, to keep furniture out of them and to find the walls that face a street ----------------
  const RCELL = 40;
  const recordCells = new Map();
  for (const r of records) {
    if (!(r.height >= 4)) continue;
    for (let ix = Math.floor(r.minX / RCELL); ix <= Math.floor(r.maxX / RCELL); ix++) {
      for (let iz = Math.floor(r.minZ / RCELL); iz <= Math.floor(r.maxZ / RCELL); iz++) {
        const k = ix * 100003 + iz;
        if (!recordCells.has(k)) recordCells.set(k, []);
        recordCells.get(k).push(r);
      }
    }
  }
  const recordsNear = (x, z) => recordCells.get(Math.floor(x / RCELL) * 100003 + Math.floor(z / RCELL)) || [];
  const insideBuilding = (x, z, except = null) => {
    for (const r of recordsNear(x, z)) {
      if (r === except || x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      for (const p of r.polygons) if (polygonContains(p, x, z)) return true;
    }
    return false;
  };
  // Ground that can take furniture: a sidewalk, no building, nothing standing there yet
  const free = (x, z, pad = 0.5, poles = 0.9) => isOnSidewalk(x, z, pad) && !insideBuilding(x, z) && (poles <= 0 || isClearOfPoles(x, z, poles));

  // ---- Edges by cell: the curb nearest to a surveyed point ------------------------------------------------------------
  const edges = (network.edges || []).filter((e) => e.len >= 6);
  const ECELL = 48;
  const edgeCells = new Map();
  for (const e of edges) {
    const x1 = e.sx + e.dx * e.len, z1 = e.sz + e.dz * e.len, pad = e.half + 12;
    for (let ix = Math.floor((Math.min(e.sx, x1) - pad) / ECELL); ix <= Math.floor((Math.max(e.sx, x1) + pad) / ECELL); ix++) {
      for (let iz = Math.floor((Math.min(e.sz, z1) - pad) / ECELL); iz <= Math.floor((Math.max(e.sz, z1) + pad) / ECELL); iz++) {
        const k = ix * 100003 + iz;
        if (!edgeCells.has(k)) edgeCells.set(k, []);
        edgeCells.get(k).push(e);
      }
    }
  }
  // The curb side nearest to (x, z): edge, side (+1 right of travel, -1 left, one-way streets only), along t, depth d
  // into the sidewalk from the curb face, and the unit normal (nx, nz) into the sidewalk
  function snapToCurb(x, z, maxDepth = 12) {
    let best = null;
    for (const e of edgeCells.get(Math.floor(x / ECELL) * 100003 + Math.floor(z / ECELL)) || []) {
      const px = x - e.sx, pz = z - e.sz;
      const t = px * e.dx + pz * e.dz;
      if (t < -2 || t > e.len + 2) continue;
      const o = px * e.rx + pz * e.rz;
      const side = o >= 0 ? 1 : -1;
      if (side < 0 && e.opposite) continue;
      const d = Math.abs(o) - e.half;
      if (d < -1.5 || d > maxDepth) continue;
      const score = Math.abs(d) + (t < 0 || t > e.len ? 3 : 0);
      if (!best || score < best.score) best = { e, side, t: Math.max(0, Math.min(e.len, t)), d, nx: e.rx * side, nz: e.rz * side, score };
    }
    return best;
  }
  const curbPoint = (c, t, d) => ({ x: c.e.sx + c.e.dx * t + c.nx * (c.e.half + d), z: c.e.sz + c.e.dz * t + c.nz * (c.e.half + d) });

  // ---- Instances per cell ---------------------------------------------------------------------------------------------
  const cells = new Map(); // key -> { cx, cz, size, lists: Map(part -> { m, c, a }), meshes }
  const cellOf = (x, z, far) => {
    const size = far ? CELL_FAR : CELL_NEAR;
    const ix = Math.floor(x / size), iz = Math.floor(z / size), k = (far ? 1 : 0) * 1e10 + ix * 100003 + iz;
    let cell = cells.get(k);
    if (!cell) cells.set(k, (cell = { cx: (ix + 0.5) * size, cz: (iz + 0.5) * size, size, lists: new Map(), meshes: [] }));
    return cell;
  };
  const counts = {};
  // Places part `name` at (x, y, z) turned by ry about y, scaled (sx, sy, sz), in `colour` (hex) or the part's own;
  // `attr` fills the part's per-instance attribute (signs: their plates; site parts: their colours), or the scale does
  // for parts that ask for it (shed boards). Returns { cell, name, index }.
  function place(name, x, y, z, ry = 0, colour = null, sx = 1, sy = 1, sz = 1, attr = null) {
    const part = parts[name];
    const cell = cellOf(x, z, !!part.far);
    let list = cell.lists.get(name);
    if (!list) cell.lists.set(name, (list = { m: [], c: [], a: [] }));
    _q.setFromAxisAngle(UP, ry);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    list.m.push(..._m.elements);
    const c = new THREE.Color(colour ?? part.colour ?? 0xffffff);
    list.c.push(c.r, c.g, c.b);
    if (part.attr) list.a.push(...(attr || (part.attr.scale ? [sx, sy, sz] : new Array(part.attr.size).fill(0))));
    counts[name] = (counts[name] || 0) + 1;
    return { cell, name, index: list.m.length / 16 - 1 };
  }
  const round = (x, z, r, h, kind, extra = {}) => ({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, minY: 0, maxY: h, cx: x, cz: z, round: r, obstacle: kind, ...extra });
  // An oriented box standing on the ground: a polygon collider (cars and people resolve against its outline)
  const boxCollider = (x, z, w, d, ry, h, kind, extra = {}) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    const outer = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => ({ x: x + c * u + s * v, z: z - s * u + c * v }));
    const xs = outer.map((p) => p.x), zs = outer.map((p) => p.z);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), minY: 0, maxY: h, polygon: { outer, holes: [] }, obstacle: kind, ...extra };
  };
  // An axis-aligned footprint for a thing `along` metres long in the direction (dx, dz) and `across` metres wide
  const orientedFootprint = (x, z, dx, dz, along, across, ped = true) => addFootprint(x, z, Math.abs(dx) * along + Math.abs(dz) * across, Math.abs(dz) * along + Math.abs(dx) * across, ped);
  const breakables = [];
  const solid = (collider) => obstacles.push(collider);
  const knockable = (collider, ref, soft = false) => { breakables.push({ collider: { ...collider, breakable: true, soft }, ref }); };
  const busStops = [], grates = [], sheds = [], roadBlocks = [], cafes = [], newsstands = [];
  // Where people stop (street-life.js): seats { x, z, yaw } (yaw: the way the sitter faces), standing spots
  // { x, z, yaw, kind, group } (queues at bus stops, customers at newsstands and carts)
  const seats = [], stands = [];
  const local = (cx, cz, ry, lx, lz) => ({ x: cx + Math.cos(ry) * lx + Math.sin(ry) * lz, z: cz - Math.sin(ry) * lx + Math.cos(ry) * lz });
  const yawOf = (nx, nz) => Math.atan2(nx, nz);

  // ---- 1. The surveyed furniture at its real place -------------------------------------------------------------------
  const haveData = Object.keys(kinds).length > 0;
  let placedData = 0;
  // Bus stops: the flag on its pole 0.55 m from the curb at the stop
  for (const p of points('busstop')) {
    const c = snapToCurb(p.x, p.z);
    if (!c) continue;
    // the surveyed point itself when it stands clear on the sidewalk, else the curb line at the stop
    const q = free(p.x, p.z, 0.15, 0.35) ? p : curbPoint(c, c.t, 0.55);
    if (q !== p && !free(q.x, q.z, 0.3, 0.6)) continue;
    const yaw = yawOf(c.e.dx, c.e.dz);
    addPole(q.x, q.z, 0.1);
    place('busStop', q.x, 0.22, q.z, yaw);
    solid(round(q.x, q.z, 0.06, 3.0, 'pole'));
    const stop = { x: q.x, z: q.z, t: c.t, edge: c.e, side: c.side, yaw, shelter: false };
    busStops.push(stop);
    for (let i = 1; i <= 3; i++) { const w = curbPoint(c, c.t - i * 1.1, 1.0 + (i % 2) * 0.5); stands.push({ x: w.x, z: w.z, yaw: Math.atan2(-c.nx, -c.nz), kind: 'busstop', group: stop }); }
    placedData++;
  }
  // Shelters: 4.2 m long along the curb, their back 2.8 m in, open to the street
  for (const p of points('shelter')) {
    const c = snapToCurb(p.x, p.z);
    if (!c) continue;
    const t = Math.max(3, Math.min(c.e.len - 3, c.t));
    const centre = curbPoint(c, t, 2.1);
    const corners = [curbPoint(c, t - 2.2, 1.3), curbPoint(c, t + 2.2, 1.3), curbPoint(c, t - 2.2, 3.1), curbPoint(c, t + 2.2, 3.1)];
    if (!corners.every((q) => free(q.x, q.z, 0.3, 0.3))) continue;
    const ry = Math.atan2(-c.nx, -c.nz);
    place('shelter', centre.x, 0.22, centre.z, ry);
    place('shelterGlass', centre.x, 0.22, centre.z, ry);
    place('shelterLamp', centre.x, 0.22, centre.z, ry, 0xfff0c8);
    solid(boxCollider(centre.x - c.nx * 0.72, centre.z - c.nz * 0.72, 4.3, 0.14, ry, 2.6, 'shelter'));
    orientedFootprint(centre.x - c.nx * 0.72, centre.z - c.nz * 0.72, c.e.dx, c.e.dz, 4.3, 0.3, true); // people walk under the roof, not through the back
    for (const [dx, dz] of [[-2.0, -0.7], [2.0, -0.7], [-2.0, 0.7], [2.0, 0.7]]) {
      const px = centre.x + Math.cos(ry) * dx + Math.sin(ry) * dz, pz = centre.z - Math.sin(ry) * dx + Math.cos(ry) * dz;
      addPole(px, pz, 0.12);
    }
    const stop = busStops.find((s) => Math.hypot(s.x - centre.x, s.z - centre.z) < 16);
    if (stop) stop.shelter = true;
    for (const lx of [-1.4, -0.65]) { const q = local(centre.x, centre.z, ry, lx, -0.46); seats.push({ x: q.x, z: q.z, yaw: ry, group: stop || null, kind: 'shelter' }); }
    placedData++;
  }
  // Newsstands: the kiosk 1.6 m deep along the curb, counter to the sidewalk
  for (const p of points('newsstand')) {
    const c = snapToCurb(p.x, p.z);
    if (!c) continue;
    const t = Math.max(3, Math.min(c.e.len - 3, c.t));
    const centre = curbPoint(c, t, 1.3);
    const corners = [curbPoint(c, t - 1.8, 0.5), curbPoint(c, t + 1.8, 0.5), curbPoint(c, t - 1.8, 2.3), curbPoint(c, t + 1.8, 2.3)];
    if (!corners.every((q) => free(q.x, q.z, 0.3, 0.3))) continue;
    const ry = Math.atan2(c.nx, c.nz); // the counter (local +z) faces the sidewalk
    place('newsstand', centre.x, 0.22, centre.z, ry);
    place('newsstandLight', centre.x, 0.22, centre.z, ry, 0xfff0c8);
    solid(boxCollider(centre.x, centre.z, 3.4, 1.6, ry, 2.7, 'newsstand'));
    orientedFootprint(centre.x, centre.z, c.e.dx, c.e.dz, 3.5, 1.7, true);
    newsstands.push({ x: centre.x, z: centre.z, yaw: ry });
    for (const lx of [-0.7, 0.6]) { const q = local(centre.x, centre.z, ry, lx, 1.45); stands.push({ x: q.x, z: q.z, yaw: ry + Math.PI, kind: 'counter' }); }
    placedData++;
  }
  // Bike racks where the city bolted them (count of hoops at the spot), bikes locked to some
  for (const p of points('bikerack')) {
    if (!free(p.x, p.z, 0.2, 0.35)) continue;
    const c = snapToCurb(p.x, p.z);
    const yaw = c ? yawOf(c.e.dx, c.e.dz) + Math.PI / 2 : 0;
    const h = hash(Math.round(p.x * 7), Math.round(p.z * 7));
    const hoops = Math.min(3, Math.max(1, Math.round(p.extra || 1)));
    for (let i = 0; i < hoops; i++) {
      const u = (i - (hoops - 1) / 2) * 1.1;
      const x = p.x + Math.sin(yaw + Math.PI / 2) * u, z = p.z + Math.cos(yaw + Math.PI / 2) * u;
      place('rack', x, 0.22, z, yaw, 0x24282c);
      solid(round(x, z, 0.45, 0.9, 'rack'));
      const bikes = h * 3 > i + 0.8 ? (hash(i, Math.round(p.z)) < 0.5 ? 1 : 2) : 0;
      for (let b = 0; b < bikes; b++) {
        const side = b === 0 ? 0.3 : -0.3;
        place('bike', x + Math.sin(yaw) * side, 0.22, z + Math.cos(yaw) * side, yaw + Math.PI / 2 + (b === 0 ? 0.1 : -0.1), BIKE_COLOURS[Math.floor(hash(i + 3, Math.round(p.x)) * BIKE_COLOURS.length)]);
      }
    }
    if (c) orientedFootprint(p.x, p.z, c.e.dx, c.e.dz, 1.1 * hoops + 0.3, 0.5, true);
    else addFootprint(p.x, p.z, 0.9, 0.9, true);
    placedData++;
  }
  // CityBench seats, their back to the building
  for (const p of points('bench')) {
    if (!free(p.x, p.z, 0.3, 0.4)) continue;
    const c = snapToCurb(p.x, p.z);
    const ry = c ? Math.atan2(-c.nx, -c.nz) : 0;
    place('bench', p.x, 0.22, p.z, ry);
    for (const lx of [-0.5, 0.5]) { const q = local(p.x, p.z, ry, lx, 0.05); seats.push({ x: q.x, z: q.z, yaw: ry, kind: 'bench' }); }
    solid(boxCollider(p.x, p.z, 1.8, 0.5, ry, 0.9, 'bench'));
    if (c) orientedFootprint(p.x, p.z, c.e.dx, c.e.dz, 1.9, 0.6, true);
    placedData++;
  }
  // LinkNYC kiosks, their screens along the street
  for (const p of points('linknyc')) {
    if (!free(p.x, p.z, 0.25, 0.5)) continue;
    const c = snapToCurb(p.x, p.z);
    const yaw = c ? yawOf(c.e.dx, c.e.dz) : 0;
    addPole(p.x, p.z, 0.9);
    place('link', p.x, 0.22, p.z, yaw);
    place('linkScreen', p.x, 0.22, p.z, yaw);
    solid(boxCollider(p.x, p.z, 0.9, 0.3, yaw, 3.1, 'kiosk'));
    placedData++;
  }
  // Muni-meters, screens to the sidewalk
  for (const p of points('meter')) {
    if (!free(p.x, p.z, 0.15, 0.35)) continue;
    const c = snapToCurb(p.x, p.z);
    const yaw = c ? yawOf(c.nx, c.nz) : 0;
    addPole(p.x, p.z, 0.16);
    place('meter', p.x, 0.22, p.z, yaw);
    solid(round(p.x, p.z, 0.14, 1.7, 'meter'));
    placedData++;
  }
  // Building sites: the surveyed shed stands on its building's wall; that building is under scaffolding
  const shedBuildings = new Set();
  for (const p of points('shed')) {
    let best = null, bestD = 1.8;
    for (const r of recordsNear(p.x, p.z)) {
      if (p.x < r.minX - 2 || p.x > r.maxX + 2 || p.z < r.minZ - 2 || p.z > r.maxZ + 2) continue;
      for (const polygon of r.polygons) {
        const ring = polygon.outer;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9;
          const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
          const d = Math.hypot(a.x + dx * u - p.x, a.z + dz * u - p.z);
          if (d < bestD) { bestD = d; best = r; }
        }
      }
    }
    if (best) shedBuildings.add(best);
  }
  // Outdoor dining: a roadway shed in the parking lane in front of the restaurant, or tables on the sidewalk
  const diningSpots = [];
  for (const p of points('dining')) {
    const c = snapToCurb(p.x, p.z);
    if (!c) continue;
    const h = hash(Math.round(p.x * 3), Math.round(p.z * 3));
    const t = Math.max(4, Math.min(c.e.len - 4, c.t));
    if (h < 0.6) {
      const centre = curbPoint(c, t, -1.3); // in the roadway, 1.3 m off the curb face
      if (blockAt(centre.x, centre.z) || blockAt(curbPoint(c, t - 3, -1.3).x, curbPoint(c, t - 3, -1.3).z) || blockAt(curbPoint(c, t + 3, -1.3).x, curbPoint(c, t + 3, -1.3).z)) continue;
      const ry = Math.atan2(c.e.dx, c.e.dz) + Math.PI / 2;
      place('diningShed', centre.x, 0, centre.z, ry);
      solid(boxCollider(centre.x, centre.z, 6.1, 2.3, ry, 1.6, 'dining'));
      addFootprint(centre.x, centre.z, Math.abs(c.e.dx) * 6.3 + Math.abs(c.e.dz) * 2.5, Math.abs(c.e.dz) * 6.3 + Math.abs(c.e.dx) * 2.5, false);
      roadBlocks.push({ x: centre.x, z: centre.z, r: 4.6 });
      diningSpots.push(centre);
    } else {
      for (let i = -1; i <= 1; i++) {
        const q = curbPoint(c, t + i * 2.0, Math.max(1.6, c.d - 1.4));
        if (!free(q.x, q.z, 0.8, 1.0)) continue;
        const ryc = yawOf(c.e.dx, c.e.dz) + hash(i + 5, Math.round(p.z)) * 0.5;
        place('cafeSet', q.x, 0.22, q.z, ryc);
        solid(round(q.x, q.z, 0.4, 0.75, 'table'));
        addFootprint(q.x, q.z, 1.3, 1.3, true);
        cafes.push(q);
        for (const side of [1, -1]) { const w = local(q.x, q.z, ryc, side * 0.62, 0); seats.push({ x: w.x, z: w.z, yaw: ryc + (side > 0 ? -Math.PI / 2 : Math.PI / 2), kind: 'cafe' }); }
      }
    }
    placedData++;
  }

  // ---- 2. Along every curb: what no register lists --------------------------------------------------------------------
  for (const e of edges) {
    if (!(e.len >= 10)) continue;
    const mid = { x: e.sx + e.dx * e.len / 2, z: e.sz + e.dz * e.len / 2 };
    const zone = zoneOf(districtAt(mid.x, mid.z));
    const avenue = e.axis === 'ave';
    const roadName = (nearestRoads(mid.x, mid.z, 14)[0]?.road?.name || '').toLowerCase();
    const subway = avenue && SUBWAY.some((s) => roadName.includes(s));
    const sides = e.opposite ? [1] : [1, -1];
    for (const side of sides) {
      const seed = (e.id ?? 0) * 2 + (side > 0 ? 0 : 1);
      const h = (k) => hash(seed, k);
      const nx = e.rx * side, nz = e.rz * side;
      const at = (t, d) => ({ x: e.sx + e.dx * t + nx * (e.half + d), z: e.sz + e.dz * t + nz * (e.half + d) });
      const yawAlong = Math.atan2(e.dx, e.dz);
      const yawOut = Math.atan2(nx, nz);
      const L = e.len;
      // Parking regulation signs every 24 to 34 m, plates facing the traffic; a bus stop's own plate near a stop
      for (let t = 5 + h(1) * 8, k = 0; t < L - 4; t += 24 + h(10 + k) * 10, k++) {
        const p = at(t, 0.55);
        if (!free(p.x, p.z, 0.45, 1.0)) continue;
        addPole(p.x, p.z, 0.08);
        const nearStop = busStops.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 12);
        const top = nearStop ? 3 : zone === ZONE.business ? (h(20 + k) < 0.55 ? 0 : 2) : h(20 + k) < 0.6 ? 1 : 2;
        const second = h(22 + k) < 0.55 ? (top + 1) % 3 : -1;
        const tiles = [PLATES[top][0], PLATES[top][1], second < 0 ? PLATES[top][0] : PLATES[second][0], second < 0 ? PLATES[top][1] : PLATES[second][1]];
        place('sign', p.x, 0.22, p.z, yawAlong, null, 1, 1, 1, tiles);
        solid(round(p.x, p.z, 0.06, 2.9, 'pole'));
      }
      // Litter baskets at the corners
      for (const [t, k] of [[2.6, 2], [L - 2.6, 3]]) {
        if (h(k) > 0.58) continue;
        const p = at(t, 0.65);
        if (!free(p.x, p.z, 0.4, 0.8)) continue;
        const ref = place('basket', p.x, 0.22, p.z, h(k + 40) * 6.28, 0x2f6b3a);
        knockable(round(p.x, p.z, 0.33, 0.9, 'basket'), ref);
      }
      // Newspaper boxes near a corner
      if (h(4) < (avenue ? 0.4 : 0.2) && L > 24) {
        const t = h(6) < 0.5 ? 6.5 : L - 6.5;
        const p = at(t, 0.75);
        if (free(p.x, p.z, 0.6, 0.9) && free(at(t - 0.8, 0.75).x, at(t - 0.8, 0.75).z, 0.4, 0) && free(at(t + 0.8, 0.75).x, at(t + 0.8, 0.75).z, 0.4, 0)) {
          const ref = place('newsCluster', p.x, 0.22, p.z, yawAlong + (h(7) < 0.5 ? Math.PI / 2 : -Math.PI / 2));
          knockable(round(p.x, p.z, 0.8, 1.1, 'newsbox'), ref);
        }
      }
      // Muni-meters only where no register placed them
      if (!kinds.meter && (zone !== ZONE.residential || avenue)) {
        for (let t = 14 + h(7) * 20, k = 0; t < L - 8; t += 38 + h(60 + k) * 14, k++) {
          const p = at(t, 0.6);
          if (!free(p.x, p.z, 0.4, 0.9)) continue;
          addPole(p.x, p.z, 0.16);
          place('meter', p.x, 0.22, p.z, yawOut);
          solid(round(p.x, p.z, 0.14, 1.7, 'meter'));
        }
      }
      if (!kinds.bikerack && h(8) < 0.34 && L > 20) {
        const t = L * (0.35 + h(9) * 0.3), p = at(t, 1.25);
        if (free(p.x, p.z, 0.7, 1.4)) {
          place('rack', p.x, 0.22, p.z, yawAlong + Math.PI / 2, 0x24282c);
          solid(round(p.x, p.z, 0.45, 0.9, 'rack'));
          orientedFootprint(p.x, p.z, e.dx, e.dz, 1.0, 0.5, true);
        }
      }
      if (!kinds.linknyc && avenue && h(12) < 0.16 && L > 30) {
        const p = at(L - 14, 1.0);
        if (free(p.x, p.z, 0.5, 1.2) && free(at(L - 14, 2.0).x, at(L - 14, 2.0).z, 0.3, 0.3)) {
          addPole(p.x, p.z, 0.9);
          place('link', p.x, 0.22, p.z, yawAlong);
          place('linkScreen', p.x, 0.22, p.z, yawAlong);
          solid(boxCollider(p.x, p.z, 0.9, 0.3, yawAlong, 3.1, 'kiosk'));
        }
      }
      if (!kinds.busstop && avenue && side > 0 && h(13) < 0.42 && L > 40) {
        const p = at(L - 9, 0.6);
        if (free(p.x, p.z, 0.4, 0.9)) {
          addPole(p.x, p.z, 0.1);
          place('busStop', p.x, 0.22, p.z, yawAlong);
          solid(round(p.x, p.z, 0.06, 3.0, 'pole'));
          const stop = { x: p.x, z: p.z, t: L - 9, edge: e, side, yaw: yawAlong, shelter: false };
          busStops.push(stop);
          for (let i = 1; i <= 3; i++) { const w = at(L - 9 - i * 1.1, 1.0 + (i % 2) * 0.5); stands.push({ x: w.x, z: w.z, yaw: yawOut + Math.PI, kind: 'busstop', group: stop }); }
        }
      }
      // Subway ventilation grates along the lines
      if (subway) {
        for (let t = 20 + h(15) * 25, k = 0; t < L - 12; t += 44 + h(80 + k) * 16, k++) {
          const p = at(t, 2.2), a = at(t - 2.1, 2.2), b = at(t + 2.1, 2.2);
          if (!free(p.x, p.z, 0.8, 0) || !free(a.x, a.z, 0.5, 0) || !free(b.x, b.z, 0.5, 0)) continue;
          place('grate', p.x, 0.225, p.z, yawAlong);
          grates.push({ x: p.x, z: p.z, yaw: yawAlong });
        }
      }
      // A fire alarm box at some corners
      if (h(16) < 0.11) {
        const p = at(3.6, 0.6);
        if (free(p.x, p.z, 0.4, 0.9)) {
          addPole(p.x, p.z, 0.1);
          place('alarmBox', p.x, 0.22, p.z, yawOut);
          solid(round(p.x, p.z, 0.12, 2.1, 'alarm'));
        }
      }
    }
  }

  // ---- 3. In front of the buildings -----------------------------------------------------------------------------------
  // The walls of a building that face a street, with the sidewalk width found by probing outward to the roadway
  function streetWalls(r) {
    const walls = [];
    for (const polygon of r.polygons) {
      const ring = polygon.outer;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
        if (len < 5) continue;
        const ux = dx / len, uz = dz / len;
        let nx = uz, nz = -ux;
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        if (polygonContains(polygon, mx + nx * 0.4, mz + nz * 0.4)) { nx = -nx; nz = -nz; }
        if (insideBuilding(mx + nx * 1.0, mz + nz * 1.0, r)) continue;
        let width = 0;
        for (let d = 1.5; d <= 9.5; d += 0.5) {
          if (!blockAt(mx + nx * d, mz + nz * d)) { width = d; break; }
        }
        if (!width || width < 2.2) continue;
        walls.push({ ax: a.x, az: a.z, ux, uz, nx, nz, len, width, mx, mz });
      }
    }
    return walls;
  }
  let wallCount = 0;
  for (const r of records) {
    if (!(r.height >= 6)) continue;
    const type = r.style?.type || '';
    const rs = Math.round(r.cx * 13 + r.cz * 7);
    const h = (k) => hash(rs, k);
    const underShed = kinds.shed ? shedBuildings.has(r) : h(1) < 0.06;
    const old = OLD_TYPES.has(type);
    const wantsStandpipe = type !== 'rowhouse' && r.height >= 10 && h(2) < 0.85;
    const wantsCellar = old && h(3) < 0.4;
    if (!underShed && !wantsStandpipe && !wantsCellar) continue;
    const walls = streetWalls(r);
    wallCount += walls.length;
    walls.forEach((w, wi) => {
      const along = (t, d) => ({ x: w.ax + w.ux * t + w.nx * d, z: w.az + w.uz * t + w.nz * d });
      const yawOut = Math.atan2(w.nx, w.nz);
      if (wantsStandpipe && wi === 0) {
        const p = along(1.6 + h(4) * 1.5, 0.32);
        if (!insideBuilding(p.x, p.z) && isOnSidewalk(p.x, p.z, 0.1)) {
          place('standpipe', p.x, 0.22, p.z, yawOut);
          solid(round(p.x, p.z, 0.16, 0.95, 'standpipe'));
        }
      }
      if (wantsCellar && w.width >= 3.0 && h(5 + wi) < 0.7) {
        const p = along(w.len * (0.3 + h(6 + wi) * 0.4), 1.35);
        if (isOnSidewalk(p.x, p.z, 0.2) && !insideBuilding(p.x, p.z)) {
          place('cellar', p.x, 0.225, p.z, yawOut); // flush: walked over
        }
      }
      if (underShed && w.len >= 7 && w.width >= 3.0) buildShed(w, h, wi);
    });
  }

  // A sidewalk shed over the whole sidewalk in front of a wall: bays of posts every ~2.4 m, the deck at 3.75 m (a roof
  // you can stand on), green parapet boards along the curb and the ends, string lights underneath; a dumpster at the
  // curb with its cones and a portable toilet for some
  function buildShed(w, h, wi) {
    const depth = Math.min(3.6, w.width - 0.5);
    const inner = 0.35, outer = inner + depth;
    const start = 0.3, end = w.len - 0.3, run = end - start;
    const bays = Math.max(1, Math.round(run / 2.4)), bay = run / bays;
    const mid = inner + depth / 2;
    const cx = w.ax + w.ux * (start + run / 2) + w.nx * mid, cz = w.az + w.uz * (start + run / 2) + w.nz * mid;
    const ry = Math.atan2(w.ux, w.uz);
    // a part turned by `along` has its local x along the wall and its local z across the sidewalk: the kit bay's posts
    // stand at z = ±1.7 across and its brace reaches x = +2.4 along, scaled to this shed's depth and bay; the boards
    // (unit cubes) run along the wall and span the sidewalk; the container lies along the curb
    const along = ry + Math.PI / 2, out = Math.atan2(w.nx, w.nz);
    for (let i = 0; i < bays; i++) {
      const t = start + i * bay;
      place('shedBay', w.ax + w.ux * t + w.nx * mid, 0.22, w.az + w.uz * t + w.nz * mid, along, 0x3a3d3a, bay / 2.4, 1, depth / 3.4);
    }
    // the last pair of posts (no brace beyond it)
    place('shedBay', w.ax + w.ux * end + w.nx * mid, 0.22, w.az + w.uz * end + w.nz * mid, along, 0x3a3d3a, 0.01, 1, depth / 3.4);
    for (let i = 0; i <= bays; i++) {
      const t = start + i * bay;
      for (const d of [inner, outer]) {
        const q = { x: w.ax + w.ux * t + w.nx * d, z: w.az + w.uz * t + w.nz * d };
        addPole(q.x, q.z, 0.1);
        solid(round(q.x, q.z, 0.07, 3.75, 'pole'));
      }
    }
    place('shedBoard', cx, 0.22 + 3.75, cz, along, null, run + 0.6, 0.16, depth + 0.5);
    const ox = w.ax + w.ux * (start + run / 2) + w.nx * (outer + 0.2), oz = w.az + w.uz * (start + run / 2) + w.nz * (outer + 0.2);
    place('shedBoard', ox, 0.22 + 3.91, oz, along, null, run + 0.6, 1.0, 0.05);
    for (const t of [start - 0.3, end + 0.3]) {
      const q = { x: w.ax + w.ux * t + w.nx * mid, z: w.az + w.uz * t + w.nz * mid };
      place('shedBoard', q.x, 0.22 + 3.91, q.z, along, null, 0.05, 1.0, depth + 0.5);
    }
    for (let t = start + 1.2; t < end; t += 2.4) {
      place('shedLight', w.ax + w.ux * t + w.nx * mid, 0.22 + 3.5, w.az + w.uz * t + w.nz * mid, 0, 0xfff0c8);
    }
    const corners = [[start - 0.3, inner - 0.1], [end + 0.3, inner - 0.1], [end + 0.3, outer + 0.4], [start - 0.3, outer + 0.4]]
      .map(([t, d]) => ({ x: w.ax + w.ux * t + w.nx * d, z: w.az + w.uz * t + w.nz * d }));
    const xs = corners.map((p) => p.x), zs = corners.map((p) => p.z);
    colliders.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), minY: 3.6, maxY: 3.97 + 0.22, polygon: { outer: corners, holes: [] }, roof: true, shed: true });
    sheds.push({ x: cx, z: cz, len: run, yaw: ry, depth });
    if (h(30 + wi) < 0.32 && run > 12) {
      const t = start + run * (0.3 + h(31 + wi) * 0.4), d = w.width + 1.3;
      const q = { x: w.ax + w.ux * t + w.nx * d, z: w.az + w.uz * t + w.nz * d };
      if (!blockAt(q.x, q.z) && !blockAt(q.x + w.nx * 1.0, q.z + w.nz * 1.0)) {
        const steel = SITE.dumpster[Math.floor(h(35 + wi) * SITE.dumpster.length)], band = SITE.band[h(36 + wi) < 0.5 ? 0 : 1];
        place('dumpster', q.x, 0, q.z, along, null, 1, 1, 1, [...steel, ...band]);
        solid(boxCollider(q.x, q.z, 6.0, 2.2, along, 1.6, 'dumpster'));
        addFootprint(q.x, q.z, Math.abs(w.ux) * 6.2 + Math.abs(w.nx) * 2.4, Math.abs(w.uz) * 6.2 + Math.abs(w.nz) * 2.4, false);
        roadBlocks.push({ x: q.x, z: q.z, r: 4.2 });
        for (const [dt, dd] of [[-3.6, 0.2], [3.6, 0.2], [-3.9, 1.3], [3.9, 1.3]]) {
          const c = { x: q.x + w.ux * dt + w.nx * dd, z: q.z + w.uz * dt + w.nz * dd };
          const ref = place('cone', c.x, 0, c.z, h(32) * 6.28);
          knockable(round(c.x, c.z, 0.18, 0.7, 'cone'), ref, true);
        }
      }
    }
    if (h(33 + wi) < 0.22 && run > 10) {
      const q = { x: w.ax + w.ux * (end - 1.2) + w.nx * (inner + 0.75), z: w.az + w.uz * (end - 1.2) + w.nz * (inner + 0.75) };
      if (!insideBuilding(q.x, q.z)) {
        place('portaloo', q.x, 0.22, q.z, out, null, 1, 1, 1, [...SITE.portaloo[h(37 + wi) < 0.5 ? 0 : 1], 0, 0]); // the door onto the sidewalk
        solid(boxCollider(q.x, q.z, 1.1, 1.1, ry, 2.3, 'portaloo'));
        addFootprint(q.x, q.z, 1.2, 1.2, true);
      }
    }
  }

  // ---- 4. Café tables in front of the restaurants the register missed, tree guards round the street trees ---------
  for (const s of shops) {
    const typeId = typeof s.type === 'number' ? SHOP_TYPES[s.type]?.id : s.type;
    if (!CAFE_TYPES.has(typeId)) continue;
    const seed = Math.round(s.x * 7 + s.z * 3);
    if (hash(seed, 1) > (haveData ? 0.12 : 0.3) || s.width < 5) continue;
    if (diningSpots.some((d) => Math.hypot(d.x - s.x, d.z - s.z) < 14)) continue;
    const n = 1 + Math.floor(hash(seed, 2) * Math.min(3, s.width / 2.4));
    for (let i = 0; i < n; i++) {
      const t = s.width * ((i + 0.5) / n), d = 1.75;
      const x = s.x + s.ux * t + s.nx * d, z = s.z + s.uz * t + s.nz * d;
      if (!free(x, z, 0.8, 1.0) || !isOnSidewalk(x + s.nx * 1.3, z + s.nz * 1.3, 0.2)) continue;
      const ryc = Math.atan2(s.ux, s.uz) + hash(seed, 3 + i) * 0.4;
      place('cafeSet', x, 0.22, z, ryc);
      solid(round(x, z, 0.4, 0.75, 'table'));
      addFootprint(x, z, 1.3, 1.3, true);
      cafes.push({ x, z });
      for (const side of [1, -1]) { const w = local(x, z, ryc, side * 0.62, 0); seats.push({ x: w.x, z: w.z, yaw: ryc + (side > 0 ? -Math.PI / 2 : Math.PI / 2), kind: 'cafe' }); }
    }
  }
  let guards = 0;
  for (const t of trunks) {
    if (hash(Math.round(t.x * 3), Math.round(t.z * 3)) > 0.42) continue;
    if (!isOnSidewalk(t.x, t.z, 0.75)) continue;
    place('treeGuard', t.x, 0.22, t.z, (t.x * 0.37 + t.z * 0.11) % 1.57, 0x1d2a22);
    guards++;
  }

  // ---- Meshes -------------------------------------------------------------------------------------------------------
  const meshes = [];
  for (const cell of cells.values()) {
    for (const [name, list] of cell.lists) {
      const part = parts[name];
      const n = list.m.length / 16;
      let geometry = part.geometry;
      if (part.attr) {
        // per-instance data (the signs' plates): the vertex buffers shared, the instance attribute this cell's own
        geometry = new THREE.BufferGeometry();
        for (const [key, a] of Object.entries(part.geometry.attributes)) geometry.setAttribute(key, a);
        geometry.setIndex(part.geometry.index);
        geometry.boundingSphere = part.geometry.boundingSphere;
        geometry.boundingBox = part.geometry.boundingBox;
        geometry.setAttribute(part.attr.name, new THREE.InstancedBufferAttribute(Float32Array.from(list.a), part.attr.size));
      }
      const mesh = new THREE.InstancedMesh(geometry, materials[part.material], n);
      mesh.instanceMatrix.array.set(list.m);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(Float32Array.from(list.c), 3);
      mesh.castShadow = !!part.castShadow;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      mesh.name = `furniture:${name}`;
      mesh.userData.part = name;
      mesh.userData.cullDistance = CULL[name] || 200;
      group.add(mesh);
      cell.meshes.push(mesh);
      meshes.push(mesh);
      list.mesh = mesh;
    }
  }
  for (const { collider, ref } of breakables) {
    const list = ref.cell.lists.get(ref.name);
    collider.mesh = list.mesh;
    collider.index = ref.index;
    obstacles.push(collider);
  }
  group.updateMatrixWorld(true);

  // Per frame: cells near the camera show their parts up to each part's draw distance
  let lastX = Infinity, lastZ = Infinity;
  function update(camera) {
    const x = camera.position.x, z = camera.position.z;
    if (Math.abs(x - lastX) < 5 && Math.abs(z - lastZ) < 5) return;
    lastX = x; lastZ = z;
    for (const cell of cells.values()) {
      const half = cell.size / 2;
      const dx = Math.max(cell.cx - half - x, 0, x - cell.cx - half);
      const dz = Math.max(cell.cz - half - z, 0, z - cell.cz - half);
      const d = Math.hypot(dx, dz);
      for (const mesh of cell.meshes) mesh.visible = d < mesh.userData.cullDistance;
    }
  }
  update({ position: { x: 0, z: 140 } });

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.info(`[furniture] ${total} pieces in ${meshes.length} meshes (${placedData} from the registers), ${sheds.length} sheds, ${busStops.length} bus stops, ${newsstands.length} newsstands, ${grates.length} grates, ${cafes.length} café tables, ${diningSpots.length} dining sheds, ${guards} tree guards, ${wallCount} walls scanned, ${Math.round(performance.now() - t0)} ms`);
  return { group, update, counts, busStops, grates, sheds, roadBlocks, cafes, newsstands, seats, stands, materials };
}

export { createSidewalkFurniture };
