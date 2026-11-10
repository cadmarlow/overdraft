import * as THREE from 'three/webgpu';
import { polygonBoxOverlaps } from './building-collision.js';
import { trees } from './tree-assets.js';
import { treeUniforms, createTreeMaterial, createImpostorMaterial } from './tree-materials.js';
import { FAR_CASTER_LAYER } from './scene-culling.js';
import { MARGIN, bandsFor, listing, candidates } from './tree-levels.js';

// The trees of the island: tens of thousands of them, each the real species at its real size where the city's survey
// says so. Near the camera a tree is its full model (every branch, a pair of leaf sprays on every twig); further off
// a lighter one built from the same skeleton; far away a single card showing the photograph taken of the full model
// from that side. The three hand over pixel by pixel across a few metres (js/tree-materials.js), so nothing pops,
// and the far ones are images of the near ones, so nothing changes colour or size with distance either.
//
// Trees live in 200 m cells. Each cell holds, per kind of tree and level, one instanced draw whose instance list is
// rewritten only when a tree of the cell changes level.

const CELL = 200;
let detail = 1;
function setTreeDetail(k) { detail = k; }

function hashPos(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// Placement checks run once, against nearby buildings and bridge structures.
function createTreeClearance(colliders) {
  const cellSize = 64;
  const cells = new Map();
  for (const c of colliders) {
    for (let x = Math.floor(c.minX / cellSize); x <= Math.floor(c.maxX / cellSize); x++) {
      for (let z = Math.floor(c.minZ / cellSize); z <= Math.floor(c.maxZ / cellSize); z++) {
        const key = `${x},${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(c);
      }
    }
  }
  // is the box (centre x z, half-size r, from y0 to y1) clear of everything?
  return (cx, cz, r, y0, y1) => {
    const minX = cx - r, maxX = cx + r, minZ = cz - r, maxZ = cz + r;
    for (let x = Math.floor(minX / cellSize); x <= Math.floor(maxX / cellSize); x++) {
      for (let z = Math.floor(minZ / cellSize); z <= Math.floor(maxZ / cellSize); z++) {
        for (const c of cells.get(`${x},${z}`) || []) {
          if (y0 >= c.maxY || y1 <= (c.minY ?? 0) || minX >= c.maxX || maxX <= c.minX || minZ >= c.maxZ || maxZ <= c.minZ) continue;
          if (c.polygon && !polygonBoxOverlaps(c.polygon, cx, cz, r, r)) continue;
          if (c.obb) {
            const o = c.obb;
            const dx = cx - o.cx, dz = cz - o.cz;
            // Also test the building's axes, so its enclosing box doesn't block an angled sidewalk.
            if (Math.abs(dx * o.cs - dz * o.sn) >= o.hx + r * Math.abs(o.cs) + r * Math.abs(o.sn)
              || Math.abs(dx * o.sn + dz * o.cs) >= o.hz + r * Math.abs(o.sn) + r * Math.abs(o.cs)) continue;
          }
          return false;
        }
      }
    }
    return true;
  };
}

/**
 * Builds the tree field for `sites`. Call `update(cameraPosition)` from the frame loop.
 * Returns { group, update, stats, sites (the Set of those planted), trunks (what cars and people run into) }.
 */
function createTreeField(_scene, sites, colliders = []) {
  const group = new THREE.Group();
  group.name = 'Trees';
  const types = trees.types;
  const typeIndex = new Map(types.map((t, i) => [t, i]));
  const B = bandsFor(detail);

  // One material per kind of tree and level (they differ by their bark only, and share their shader)
  const meshMaterials = [];
  for (const type of types) {
    const twin = types.slice(0, typeIndex.get(type)).find((t) => t.bark === type.bark && t.barkTint.join() === type.barkTint.join());
    type.materials = twin ? twin.materials : [0, 1].map((level) => createTreeMaterial({
      bark: trees.bark[type.bark], barkNormal: trees.barkNormal[type.bark], barkTint: new THREE.Vector3(...type.barkTint), level
    }));
    meshMaterials.push(type.materials);
  }
  const impostorMaterial = createImpostorMaterial();
  const quad = new THREE.PlaneGeometry(2, 2, 1, 4);

  // --- Plant
  const clear = createTreeClearance(colliders);
  const planted = new Set();
  const trunks = [];
  const capacity = sites.length;
  const data = new Float32Array(capacity * 8); // x y z yaw | across up random type
  const cells = new Map();
  const perType = types.map(() => 0);
  let N = 0;
  for (const site of sites) {
    const y = site.y || 0;
    let chosen = null;
    for (const c of candidates(site, types)) {
      // the trunk and the heart of the crown must stand clear; its outer leaves may brush a facade, as they do
      const r = c.type.crownRadius * c.scale * (site.squeeze ?? 1) * 0.62;
      if (clear(site.x, site.z, Math.max(0.5, r), y + c.type.crownBase * c.scale, y + c.type.height * c.scale * 0.92)
        && clear(site.x, site.z, 0.45, y, y + c.type.crownBase * c.scale)) { chosen = c; break; }
    }
    if (!chosen) continue;
    const i = N++;
    planted.add(site);
    const r1 = hashPos(site.x, 1.3, site.z), r2 = hashPos(site.z, 7.1, site.x), r3 = hashPos(site.x + site.z, 3.3, 0.7);
    const s = chosen.scale * (0.95 + r1 * 0.1);
    const t = typeIndex.get(chosen.type);
    data.set([site.x, y, site.z, site.yaw ?? r2 * Math.PI * 2, s * (0.95 + r3 * 0.1) * (site.squeeze ?? 1), s * (0.94 + r2 * 0.12), r1, t], i * 8);
    perType[t]++;
    site.type = chosen.type.id;
    trunks.push({ x: site.x, y, z: site.z, radius: Math.max(0.09, chosen.type.trunkRadius * s * 1.1), height: Math.min(7, chosen.type.height * s * 0.6) });
    const cx = Math.floor(site.x / CELL), cz = Math.floor(site.z / CELL);
    const key = (cx + 32768) * 65536 + (cz + 32768);
    let cell = cells.get(key);
    if (!cell) {
      const cellGroup = new THREE.Group();
      cellGroup.name = `TreeCell_${cx},${cz}`;
      cellGroup.visible = false;
      group.add(cellGroup);
      cell = { group: cellGroup, trees: [], counts: new Map(), near: new Map(), far: new Map(), impostor: null, state: 0 };
      cells.set(key, cell);
    }
    cell.trees.push(i);
    cell.counts.set(t, (cell.counts.get(t) || 0) + 1);
  }

  // What each tree is listed in: bit 1 level 0, bit 2 level 1, bit 4 impostor
  const listed = new Uint8Array(N);
  const cellList = Array.from(cells.values(), (cell) => {
    cell.trees = Int32Array.from(cell.trees);
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, reach = 0;
    for (const i of cell.trees) {
      const x = data[i * 8], y = data[i * 8 + 1], z = data[i * 8 + 2];
      const type = types[data[i * 8 + 7]];
      const top = y + type.height * data[i * 8 + 5];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      minY = Math.min(minY, y); maxY = Math.max(maxY, top);
      reach = Math.max(reach, type.sphere.radius * Math.max(data[i * 8 + 4], data[i * 8 + 5]));
    }
    const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    // what the cell's draws may cover: its trees, their crowns, and how far a storm bends them
    cell.sphere = new THREE.Sphere(center, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + reach + 1.5);
    cell.radius = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 12;
    return cell;
  });

  const instanced = (geometry, material, capacityOf, name, cell) => {
    const g = new THREE.InstancedBufferGeometry();
    for (const key of Object.keys(geometry.attributes)) g.setAttribute(key, geometry.attributes[key]);
    g.setIndex(geometry.index);
    // Static usage on purpose: three.js re-uploads a DynamicDrawUsage attribute in every render pass of every frame.
    // fill() uploads just the instances in use, and only when the cell's lists change.
    g.setAttribute('aInstA', new THREE.InstancedBufferAttribute(new Float32Array(capacityOf * 4), 4));
    g.setAttribute('aInstB', new THREE.InstancedBufferAttribute(new Float32Array(capacityOf * 4), 4));
    g.instanceCount = 0;
    g.boundingSphere = cell.sphere;
    const mesh = new THREE.Mesh(g, material);
    mesh.name = name;
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.layers.enable(FAR_CASTER_LAYER);
    cell.group.add(mesh);
    return mesh;
  };

  function fill(cell) {
    const used = new Map();
    const put = (mesh, i, last) => {
      const n = used.get(mesh) || 0;
      const a = mesh.geometry.attributes.aInstA.array, b = mesh.geometry.attributes.aInstB.array;
      for (let k = 0; k < 4; k++) a[n * 4 + k] = data[i * 8 + k];
      b[n * 4] = data[i * 8 + 4]; b[n * 4 + 1] = data[i * 8 + 5]; b[n * 4 + 2] = data[i * 8 + 6]; b[n * 4 + 3] = last;
      used.set(mesh, n + 1);
    };
    const meshOf = (map, t, level) => {
      let mesh = map.get(t);
      if (!mesh) {
        mesh = instanced(types[t].geometry[level], types[t].materials[level], cell.counts.get(t), `Trees_${types[t].id}_lod${level}`, cell);
        map.set(t, mesh);
      }
      return mesh;
    };
    for (const i of cell.trees) {
      const bits = listed[i], t = data[i * 8 + 7];
      if (bits & 1) put(meshOf(cell.near, t, 0), i, 1);
      if (bits & 2) put(meshOf(cell.far, t, 1), i, types[t].gain);
      if (bits & 4) {
        if (!cell.impostor) cell.impostor = instanced(quad, impostorMaterial, cell.trees.length, 'Trees_impostors', cell);
        put(cell.impostor, i, t);
      }
    }
    let any = false;
    const settle = (mesh) => {
      const n = used.get(mesh) || 0;
      mesh.geometry.instanceCount = n;
      mesh.visible = n > 0;
      if (!n) return;
      any = true;
      for (const attr of [mesh.geometry.attributes.aInstA, mesh.geometry.attributes.aInstB]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, n * 4);
        attr.needsUpdate = true;
      }
    };
    for (const mesh of cell.near.values()) settle(mesh);
    for (const mesh of cell.far.values()) settle(mesh);
    if (cell.impostor) settle(cell.impostor);
    cell.group.visible = any;
  }

  // --- Levels, from the camera
  const last = new THREE.Vector3(Infinity, Infinity, Infinity);
  let bands = B, farEnd, end;
  // Where the levels hand over (metres); also how a level is looked at on its own, by pushing the others away
  function setBands({ near = B.near, far = B.far, fade = B.fade, reach = B.reach } = {}) {
    treeUniforms.bands.value.set(near, far, fade, reach);
    bands = { near, far, fade, reach };
    farEnd = far + MARGIN;
    end = reach + MARGIN;
    last.set(Infinity, Infinity, Infinity);
    for (const cell of cellList) cell.state = 0;
  }
  setBands();
  function update(position) {
    treeUniforms.view.value.copy(position);
    if (position.distanceToSquared(last) < 9) return false;
    last.copy(position);
    const px = position.x, py = position.y, pz = position.z;
    let changed = false;
    for (const cell of cellList) {
      const c = cell.sphere.center;
      const d = Math.hypot(c.x - px, c.z - pz);
      // 1 hidden, 2 all impostors: nothing to look at tree by tree
      const whole = d - cell.radius > end + 40 ? 1 : d - cell.radius > farEnd + 30 && d + cell.radius < end - 40 && Math.abs(py) < 2000 ? 2 : 0;
      if (whole && cell.state === whole) continue;
      let dirty = false;
      for (const i of cell.trees) {
        let bits = 0;
        if (whole === 2) bits = 4;
        else if (whole === 0) {
          // (the same point of the tree the material measures from)
          bits = listing(Math.hypot(data[i * 8] - px, data[i * 8 + 1] + data[i * 8 + 5] * 6 - py, data[i * 8 + 2] - pz), bands);
        }
        if (bits !== listed[i]) { listed[i] = bits; dirty = true; }
      }
      cell.state = whole;
      if (dirty) { fill(cell); changed = true; }
    }
    return changed;
  }

  // Levels for the start-up view (Midtown, 5th Ave), so the precompile pass sees the tree meshes
  update(new THREE.Vector3(0, 10, 140));

  group.traverse((object) => {
    object.matrixAutoUpdate = false;
    object.matrixWorldAutoUpdate = false;
  });

  const stats = {
    trees: N,
    perType: Object.fromEntries(types.map((t, i) => [t.id, perType[i]])),
    triangles: types.map((t) => t.levels.map((l) => l.triangles))
  };
  return { group, update, setBands, stats, sites: planted, trunks, materials: { mesh: meshMaterials, impostor: impostorMaterial } };
}

export { createTreeField, setTreeDetail };
