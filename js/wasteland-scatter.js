import * as THREE from 'three/webgpu';
import { texture, uv } from 'three/tsl';
import { FRONTIER_SITES, frontierDistance, frontierGrowth, insideFrontierBounds } from './frontier-districts.js';
import { SALT_LINES, insideSaltGrid, saltLandAt, saltMasksAt, saltRoadAt, sampleSalt } from './wasteland-plan.js';

// What lies on the Wasteland's ground: scanned rocks and outcrops, dead wood, dry bushes, and what people left along
// the roads (tools/wasteland/build-kit.mjs, Poly Haven, CC0). Every 64 m cell grows the same things every time it is
// asked, from its own seed and from the baked masks; the cells around the camera are drawn as instances at two levels
// of detail, and the big things nearby are given to the colliders.

const CELL = 64, NEAR = 115, FAR = 620, SOLID = 190, MOVE = 40;
// name: [most instances at full detail, most at low detail]
const CAPACITY = {
  fire_barrel: [12, 40], fence: [40, 160], ladder: [8, 20], crate: [16, 40], ammo_crate: [12, 30], jerrycan: [12, 30], gas_cylinder: [8, 24], generator: [4, 10],
  fire_pit: [6, 16], chair: [10, 24], table: [4, 10], bed_frame: [6, 14], trash_bag: [12, 40], cement_bag: [40, 200], welding_cart: [3, 8],
  rubble: [260, 1800], boulder_a: [70, 420], boulder_d: [70, 420], boulder_e: [70, 420], boulder_f: [70, 420], slab: [40, 260],
  boulder_b: [30, 200], boulder_c: [30, 200], outcrop_a: [14, 110], outcrop_b: [10, 80],
  dead_trunk: [10, 60], dead_log: [14, 80], dead_tree: [14, 90], dead_branch: [30, 160], bush: [110, 800], bush_wide: [70, 520],
  tyre: [20, 80], tyre_stack: [8, 30], barrel_red: [10, 40], barrel_blue: [10, 40], road_barrier: [16, 70], concrete_block: [12, 50],
  covered_car: [6, 28], buoy: [6, 30], power_pole: [14, 90]
};
const WARM = [1.18, 0.84, 0.6], PALE = [1.08, 0.97, 0.86], DRY = [1.3, 1.02, 0.52], PLAIN = [1, 1, 1];

function hash(a, b, seed) {
  let k = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(seed + 1, 1442695041);
  k = Math.imul(k ^ (k >>> 13), 1274126177);
  return ((k ^ (k >>> 16)) >>> 0) / 4294967296;
}
function patch(x, z, scale, seed) {
  const fx = x / scale, fz = z / scale, ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

// Things placed by hand rather than grown: the poles of the old shore roads, by cell
const fixed = new Map();
const cellId = (ci, cj) => (ci + 4096) * 8192 + cj + 4096;
// Places a kit prop by hand: { name, x, z, yaw, scale, tint, sink, lean, leanYaw }. Call before the ground is first drawn.
export function fixItem(item) { fix({ scale: 1, yaw: 0, tint: PLAIN, ...item }); }
function fix(item) {
  const id = cellId(Math.floor(item.x / CELL), Math.floor(item.z / CELL));
  if (!fixed.has(id)) fixed.set(id, []);
  fixed.get(id).push(item);
}
{
  const line = SALT_LINES[0].path;
  let run = 0, n = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    run += length;
    if (run < 58) continue;
    run = 0; n++;
    if (hash(n, 7, 91) < 0.34) continue; // many have fallen
    const side = 12.5, x = b.x + dz / length * side, z = b.z - dx / length * side;
    fix({ name: 'power_pole', x, z, yaw: Math.atan2(dx, dz), scale: 1.25, lean: (hash(n, 3, 92) - 0.5) * 0.26, leanYaw: hash(n, 5, 93) * 6.28, tint: PLAIN, sink: 0.4 });
  }
}

const masks = [0, 0, 0, 0], road = {}, hit = {};
function grow(ci, cj) {
  const items = [], x0 = ci * CELL, z0 = cj * CELL, cx = x0 + CELL / 2, cz = z0 + CELL / 2;
  if (!insideSaltGrid(cx, cz)) return items;
  let n = 0;
  const rand = () => hash(ci * 131 + n++, cj, 1007);
  const [dune, crack, salt, rock] = saltMasksAt(cx, cz, masks);
  const bed = Math.max(crack, salt);
  // nothing grows on a road, in the moat or in the city
  const put = (name, x, z, scale, tint, extra) => {
    if (!saltLandAt(x, z)) return null;
    const near = saltRoadAt(x, z, road) ? road.distance - road.half : 1e3;
    if (near < (extra?.clear ?? 2.5)) return null;
    const y = sampleSalt(x, z, hit);
    const item = { name, x, y, z, scale, tint, yaw: rand() * 6.283, nx: hit.nx, ny: hit.ny, nz: hit.nz, near, ...extra };
    items.push(item);
    return item;
  };
  const spot = () => [x0 + rand() * CELL, z0 + rand() * CELL];
  const shade = (base, spread = 0.22) => { const k = 1 - spread + rand() * spread * 2; return [base[0] * k, base[1] * k, base[2] * k]; };
  const stoneTint = bed > 0.5 ? PALE : WARM;
  // Loose stone: thick on bare rock and under the cliffs, a scatter everywhere else, nearly none on the salt
  const stony = (0.35 + 2.6 * rock + 0.5 * (1 - dune)) * (1 - 0.85 * salt) * (0.4 + 1.2 * patch(cx, cz, 190, 3));
  for (let k = Math.round(stony * 2.2 + rand() - 0.5); k > 0; k--) {
    const [x, z] = spot(), r = rand();
    if (r < 0.5) put('rubble', x, z, 1.4 + rand() * 3.4, shade(stoneTint), { sink: 0.02 });
    else put(['boulder_d', 'boulder_e', 'boulder_a', 'boulder_f', 'slab'][Math.floor(rand() * 5)], x, z, 0.5 + rand() * rand() * 1.5, shade(stoneTint), { sink: 0.12 });
  }
  if (rand() < 0.035 + 0.5 * rock * rock) { const [x, z] = spot(); put(rand() < 0.5 ? 'boulder_b' : 'boulder_c', x, z, 0.8 + rand() * rand() * 1.9, shade(stoneTint, 0.15), { sink: 0.25 }); }
  // Outcrops break out of every steep face, their backs in the slope
  for (let k = 0; k < 3; k++) {
    const [x, z] = spot();
    if (!saltLandAt(x, z)) continue;
    sampleSalt(x, z, hit);
    const steep = 1 - hit.ny;
    if (steep < 0.2 || rand() > 0.55) continue;
    const down = Math.hypot(hit.nx, hit.nz) || 1, dx = hit.nx / down, dz = hit.nz / down, big = rand() < 0.4;
    const scale = (big ? 0.7 : 0.9) + rand() * (big ? 0.9 : 1.3);
    put(big ? 'outcrop_b' : 'outcrop_a', x - dx * 2.2 * scale, z - dz * 2.2 * scale, scale, shade(WARM, 0.12), { yaw: Math.atan2(dx, dz), flat: true, sink: 0.9, clear: 9 });
  }
  // Dry brush: in drifts of its own, on sand and stony ground, never on the pans
  const brush = Math.max(0, patch(cx, cz, 260, 11) - 0.42) * 3.2 * (1 - bed) * (1 - 0.6 * rock);
  for (let k = Math.round(brush * 5 + rand() - 0.5); k > 0; k--) {
    const [x, z] = spot();
    put(rand() < 0.62 ? 'bush' : 'bush_wide', x, z, 0.6 + rand() * 1.1, shade(DRY, 0.25), { flat: true, sink: 0.03 });
  }
  if (insideFrontierBounds(cx, cz)) {
    const d = frontierDistance(cx, cz), vegetation = frontierGrowth(cx, cz, d);
    const nearSettlements = FRONTIER_SITES.some(site => Math.hypot(cx - site.x, cz - site.z) < 105);
    if (d > -45 && d < 205) {
      for (let k = Math.floor(vegetation * 20 + (nearSettlements ? 9 : 0)); k > 0; k--) {
        const [x, z] = spot();
        if (FRONTIER_SITES.some(site => Math.hypot(x - site.x, z - site.z) < (site.id === 'lisieres' ? 43 : 28))) continue;
        const scrub = rand();
        put(scrub > 0.43 ? 'bush' : 'bush_wide', x, z, 0.44 + rand() * 0.64,
          shade(nearSettlements ? [0.83, 0.93, 0.54] : [1.13, 0.94, 0.53]), { flat: true, sink: 0.03, clear: 4 });
      }
      if (d > 90 && rand() < 0.31) {
        const [x, z] = spot();
        put('dead_tree', x, z, 1.1 + rand() * 0.6, shade(PALE), { flat: true, sink: 0.16, clear: 7 });
      }
    }
  }
  // Dead wood: drift wood on the old river bed, the odd bare trunk elsewhere
  if (rand() < 0.05 + 0.07 * crack) {
    const [x, z] = spot(), r = rand();
    put(r < 0.4 ? 'dead_log' : r < 0.7 ? 'dead_trunk' : r < 0.85 ? 'dead_tree' : 'dead_branch', x, z, 0.9 + rand() * 1.3, shade(PALE, 0.15), { sink: 0.06, flat: r >= 0.7 });
  }
  // A buoy now and then, where there was water to mark
  if (bed > 0.6 && rand() < 0.014) { const [x, z] = spot(); put('buoy', x, z, 1.3 + rand() * 0.8, PLAIN, { lean: 0.5 + rand() * 0.7, leanYaw: rand() * 6.28, sink: 0.35 }); }
  // What was left along the roads
  if (saltRoadAt(cx, cz, road) && road.distance < 70) {
    if (rand() < 0.16) {
      const [x, z] = spot(), r = rand();
      put(r < 0.3 ? 'tyre' : r < 0.42 ? 'tyre_stack' : r < 0.6 ? 'barrel_red' : r < 0.75 ? 'barrel_blue' : r < 0.9 ? 'road_barrier' : 'concrete_block', x, z, 1, shade(PLAIN, 0.1), { sink: 0.03, clear: 1.5, lean: r < 0.6 && rand() < 0.4 ? 1.5 : 0, leanYaw: rand() * 6.28 });
    }
    if (road.kind === 'road' && rand() < 0.05) { const [x, z] = spot(); put('covered_car', x, z, 1, shade(PALE, 0.1), { sink: 0.12, clear: 0.8, flat: true }); }
  }
  for (const item of fixed.get(cellId(ci, cj)) ?? []) {
    if (!saltLandAt(item.x, item.z)) continue;
    items.push({ ...item, y: sampleSalt(item.x, item.z, hit), nx: 0, ny: 1, nz: 0, flat: true, near: 1e3 });
  }
  return items;
}

const UP = new THREE.Vector3(0, 1, 0);
export class SaltScatter {
  constructor(parent, kit) {
    this.kit = kit;
    this.group = new THREE.Group(); this.group.name = 'Rochers et épaves du Wasteland';
    parent.add(this.group);
    const base = { map: kit.maps.color, normalMap: kit.maps.normal, roughnessMap: kit.maps.orm, metalnessMap: kit.maps.orm, roughness: 1, metalness: 1 };
    const material = (options) => {
      const mat = new THREE.MeshStandardNodeMaterial({ ...base, ...options });
      mat.aoNode = texture(kit.maps.orm, uv()).r;
      return mat;
    };
    const solid = material({}), open = material({ side: THREE.DoubleSide }), cut = material({ side: THREE.DoubleSide, alphaTest: 0.5 });
    solid.name = 'Wasteland · kit'; open.name = 'Wasteland · kit ouvert'; cut.name = 'Wasteland · kit ajouré';
    this.sets = {};
    for (const [name, [full, low]] of Object.entries(CAPACITY)) {
      const prop = kit.props[name];
      if (!prop) continue;
      const mat = prop.cutout ? cut : prop.twoSided ? open : solid;
      const make = (geometry, capacity, shadow) => {
        const mesh = new THREE.InstancedMesh(geometry, mat, capacity);
        mesh.name = `Wasteland · ${name}`; mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false;
        mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
        mesh.setColorAt(0, new THREE.Color(1, 1, 1));
        this.group.add(mesh);
        return mesh;
      };
      this.sets[name] = { prop, full: make(prop.full, full, true), low: make(prop.low, low, prop.kind === 'big' || name.startsWith('outcrop')) };
    }
    this.cells = new Map();
    this.solid = new Map();
    this.at = null;
    this.controllers = null;
    this.count = 0;
  }

  cell(ci, cj) {
    const id = cellId(ci, cj);
    let items = this.cells.get(id);
    if (!items) {
      items = grow(ci, cj);
      if (this.cells.size > 2400) this.cells.delete(this.cells.keys().next().value);
      this.cells.set(id, items);
    }
    return items;
  }

  update(camera) {
    if (this.at && Math.hypot(camera.x - this.at.x, camera.z - this.at.z) < MOVE && Math.abs(camera.y - this.at.y) < 60) return;
    this.at = { x: camera.x, y: camera.y, z: camera.z };
    const lift = Math.max(0, camera.y - 40);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), turn = new THREE.Quaternion(), tilt = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), normal = new THREE.Vector3(), axis = new THREE.Vector3(), colour = new THREE.Color();
    for (const set of Object.values(this.sets)) { set.full.count = 0; set.low.count = 0; }
    this.count = 0;
    const far = Math.max(0, FAR - lift * 0.5);
    const c0 = Math.floor((camera.x - far) / CELL), c1 = Math.floor((camera.x + far) / CELL), r0 = Math.floor((camera.z - far) / CELL), r1 = Math.floor((camera.z + far) / CELL);
    for (let cj = r0; cj <= r1; cj++) for (let ci = c0; ci <= c1; ci++) {
      const gx = Math.max(ci * CELL - camera.x, 0, camera.x - (ci + 1) * CELL), gz = Math.max(cj * CELL - camera.z, 0, camera.z - (cj + 1) * CELL);
      if (gx * gx + gz * gz > far * far) continue;
      for (const item of this.cell(ci, cj)) {
        const set = this.sets[item.name];
        if (!set) continue;
        const d = Math.hypot(item.x - camera.x, item.z - camera.z, lift);
        // small things are dropped sooner than large ones
        const size = Math.max(set.prop.size[0], set.prop.size[1], set.prop.size[2]) * item.scale;
        if (d > far * Math.min(1, 0.3 + size * 0.22)) continue;
        const mesh = d < NEAR ? set.full : set.low;
        if (mesh.count >= mesh.instanceMatrix.count) continue;
        turn.setFromAxisAngle(UP, item.yaw);
        if (item.lean) { axis.set(Math.sin(item.leanYaw), 0, Math.cos(item.leanYaw)); tilt.setFromAxisAngle(axis, item.lean); q.copy(tilt).multiply(turn); }
        else if (item.flat) q.copy(turn);
        else { normal.set(item.nx * 0.8, item.ny, item.nz * 0.8).normalize(); tilt.setFromUnitVectors(UP, normal); q.copy(tilt).multiply(turn); }
        const sink = ((set.prop.buried ?? 0) + (item.sink ?? 0)) * item.scale;
        m.compose(p.set(item.x, item.y - sink, item.z), q, s.setScalar(item.scale));
        mesh.setMatrixAt(mesh.count, m);
        mesh.setColorAt(mesh.count, colour.setRGB(item.tint[0], item.tint[1], item.tint[2]));
        mesh.count++; this.count++;
      }
    }
    for (const set of Object.values(this.sets)) for (const mesh of [set.full, set.low]) {
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.harden(camera);
  }

  // The big things within reach stand in the way of feet and wheels
  harden(camera) {
    const controllers = this.controllers;
    if (!controllers?.addCollider) return;
    const keep = new Set();
    const c0 = Math.floor((camera.x - SOLID) / CELL), c1 = Math.floor((camera.x + SOLID) / CELL), r0 = Math.floor((camera.z - SOLID) / CELL), r1 = Math.floor((camera.z + SOLID) / CELL);
    for (let cj = r0; cj <= r1; cj++) for (let ci = c0; ci <= c1; ci++) {
      const id = cellId(ci, cj);
      keep.add(id);
      if (this.solid.has(id)) continue;
      const list = [];
      for (const item of this.cell(ci, cj)) {
        const spec = this.sets[item.name]?.prop.collider;
        if (!spec || item.lean > 1) continue;
        const k = item.scale, y = item.y - 0.3;
        if (spec.radius) {
          const r = Math.max(spec.radius * k * 0.82, item.name === 'power_pole' ? 0.22 : 0);
          if (r < 0.42 && item.name !== 'power_pole') continue;
          list.push({ round: r, cx: item.x, cz: item.z, minX: item.x - r, maxX: item.x + r, minZ: item.z - r, maxZ: item.z + r, minY: y, maxY: item.y + spec.height * k * 0.9, obstacle: item.name === 'power_pole' ? 'pole' : 'rock' });
        } else if (spec.half) {
          const hx = spec.half[0] * k * 0.9, hz = spec.half[2] * k * 0.9;
          if (Math.max(hx, hz) < 0.6) continue;
          const cs = Math.cos(item.yaw), sn = Math.sin(item.yaw), ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
          list.push({ minX: item.x - ex, maxX: item.x + ex, minZ: item.z - ez, maxZ: item.z + ez, minY: y, maxY: item.y + spec.half[1] * 2 * k * 0.85, obb: { cx: item.x, cz: item.z, cs, sn, hx, hz }, obstacle: 'rock' });
        }
      }
      for (const c of list) controllers.addCollider(c);
      this.solid.set(id, list);
    }
    for (const [id, list] of this.solid) if (!keep.has(id)) { for (const c of list) controllers.removeCollider(c); this.solid.delete(id); }
  }
}
