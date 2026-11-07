import * as THREE from 'three/webgpu';
import { carModels, carSpecs, trafficMaterial, withWheels, LAMPS_OFF } from './car-assets.js';
import { createContactShadowMaterial } from './tsl-materials.js';
import { carStyleCode } from './cars.js';
import { FLEET_STYLES } from './traffic.js';
import { blockAt, districtAt } from './city-config.js';
import { KINDS, planSlots, occupied } from './parking-plan.js';

// The cars parked along every curb of Manhattan. parking-plan.js lays the slots out along the road network's parking
// lanes; this module streams them in 128 m cells around the camera, drawn with the traffic's own car models and
// compiled materials (the full body with its wheels near the camera, the coarse stand-in beyond), gives each standing
// car a collider, and hands a car over to the gameplay layer when the player takes it, shoots it or drives into it
// (release()). Curbs fill and empty with the hour while nobody is looking (parking-plan.js occupancy), and gameplay
// cars placed in the street clear the slots they stand on (vacateNear()).

const CELL = 128;
const BUILD_RADIUS = 330; // cells are built this far from the camera...
const DROP_RADIUS = 440; // ...and dropped again beyond this
const DRAW_FAR = 230; // the coarse stand-in draws up to here
const DRAW_NEAR = 76; // the full model with its wheels, casting shadows, within this
const REFRESH_BEYOND = DRAW_FAR + 25; // occupancy is only reconsidered out of sight
const REFRESH_EVERY = 3; // seconds between two looks at the same far cell
const BUILDS_PER_FRAME = 1;
const STATE = { EMPTY: 0, OCCUPIED: 1, TAKEN: 2, BANNED: 3 };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// Frees the GPU buffer of a per-cell instanced attribute without touching the vertex buffers it shares with the models
function freeAttribute(attribute) {
  if (!attribute) return;
  if (typeof attribute.dispose === 'function') attribute.dispose();
  else if (typeof attribute.dispatchEvent === 'function') attribute.dispatchEvent({ type: 'dispose' });
}

/**
 * @param {THREE.Scene} scene
 * @param {object} network - the road network (traffic.network): its edges carry the parking lanes
 * @param {object} options
 * @param {{x:number,z:number}[]} [options.hydrants]
 * @param {object[]} [options.footprints] - street furniture rects ({minX, maxX, minZ, maxZ}) cars cannot stand on
 * @param {boolean} [options.storage] - WebGPU: instance matrices as storage buffers (uploaded once, see main.js)
 * @param {(x:number,z:number)=>boolean} [options.isBlocked] - true where a gameplay car already stands
 */
function createParking(scene, network, { hydrants = [], footprints = [], storage = false, isBlocked = null } = {}) {
  const group = new THREE.Group();
  group.name = 'ParkedCars';
  scene.add(group);

  // ---- Where the slots are --------------------------------------------------------------------------------------
  const FCELL = 32;
  const footprintCells = new Map();
  for (const f of footprints) {
    if (!(f.maxX > f.minX) || !(f.maxZ > f.minZ)) continue;
    for (let ix = Math.floor(f.minX / FCELL); ix <= Math.floor(f.maxX / FCELL); ix++) {
      for (let iz = Math.floor(f.minZ / FCELL); iz <= Math.floor(f.maxZ / FCELL); iz++) {
        const key = ix + ',' + iz;
        if (!footprintCells.has(key)) footprintCells.set(key, []);
        footprintCells.get(key).push(f);
      }
    }
  }
  // A car cannot stand with a corner on a curb island, nor across street furniture standing in the roadway (poles
  // and signs on the curbs, flagged pedestrianOnly, are no concern). The car is an oriented box: forward (s, c),
  // lateral (c, -s); a rect overlaps it when no axis of either separates them.
  const overlaps = (x, z, s, c, hw, hl, f) => {
    const rcx = (f.minX + f.maxX) / 2, rcz = (f.minZ + f.maxZ) / 2, ex = (f.maxX - f.minX) / 2, ez = (f.maxZ - f.minZ) / 2;
    const dx = rcx - x, dz = rcz - z;
    for (const [ax, az] of [[1, 0], [0, 1], [s, c], [c, -s]]) {
      const rect = Math.abs(ax) * ex + Math.abs(az) * ez;
      const car = hl * Math.abs(ax * s + az * c) + hw * Math.abs(ax * c - az * s);
      if (Math.abs(dx * ax + dz * az) >= rect + car) return false;
    }
    return true;
  };
  const blocked = (x, z, yaw, hw, hl) => {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    for (const [lx, lz] of [[hw, hl], [-hw, hl], [hw, -hl], [-hw, -hl], [0, 0]]) {
      if (blockAt(x + c * lx + s * lz, z - s * lx + c * lz)) return true;
    }
    const r = Math.hypot(hw, hl);
    for (let ix = Math.floor((x - r) / FCELL); ix <= Math.floor((x + r) / FCELL); ix++) {
      for (let iz = Math.floor((z - r) / FCELL); iz <= Math.floor((z + r) / FCELL); iz++) {
        for (const f of footprintCells.get(ix + ',' + iz) || []) {
          if (f.pedestrianOnly) continue;
          if (x + r <= f.minX || x - r >= f.maxX || z + r <= f.minZ || z - r >= f.maxZ) continue;
          if (overlaps(x, z, s, c, hw, hl, f)) return true;
        }
      }
    }
    return false;
  };
  const t0 = performance.now();
  // The network's roadway half widths are estimates on the blocks drawn as polygons (their rect covers): the parked
  // cars stand 1.2 m from the curb the player actually sees, found by probing the curb islands outward from the
  // outer lane. Where that leaves no room for a car beside the lane, the side has no parking.
  const PARK_FROM_CURB = 1.2;
  const edges = network.edges.map((e) => {
    if (!e.park || (e.park.r === null && e.park.l === null) || !e.lanes.length) return e;
    const laneEdge = (sign) => (sign > 0 ? Math.max(...e.lanes) : -Math.min(...e.lanes)) + 0.95;
    const curb = (sign) => {
      let min = Infinity;
      for (const f of [0.25, 0.5, 0.75]) {
        const t = e.len * f;
        let found = null;
        for (let o = Math.max(0.5, laneEdge(sign)); o <= e.half + 2.5; o += 0.1) {
          if (blockAt(e.sx + e.dx * t + e.rx * sign * o, e.sz + e.dz * t + e.rz * sign * o)) { found = o; break; }
        }
        if (found === null) return null; // open ground beside the road (plaza, park, water): the nominal curb holds
        min = Math.min(min, found);
      }
      return min;
    };
    const fit = (sign, nominal) => {
      if (nominal === null || nominal === undefined) return null;
      const c = curb(sign);
      const curbDist = c === null ? e.half : c;
      if (curbDist - laneEdge(sign) < 2.25) return null;
      return sign * (curbDist - PARK_FROM_CURB);
    };
    return { ...e, park: { r: fit(1, e.park.r), l: fit(-1, e.park.l) } };
  });
  const t1 = performance.now();
  const plan = planSlots(edges, { hydrants, blocked, districtAt });
  const state = new Uint8Array(plan.count);
  const spec = KINDS.map((k) => carSpecs[k] || carSpecs.sedan);

  // ---- Cells --------------------------------------------------------------------------------------------------------
  const cells = new Map();
  const cellKey = (ix, iz) => ix * 100003 + iz;
  {
    const lists = new Map();
    for (let i = 0; i < plan.count; i++) {
      const k = cellKey(Math.floor(plan.x[i] / CELL), Math.floor(plan.z[i] / CELL));
      let list = lists.get(k);
      if (!list) lists.set(k, (list = []));
      list.push(i);
    }
    for (const [k, list] of lists) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const i of list) {
        minX = Math.min(minX, plan.x[i]); maxX = Math.max(maxX, plan.x[i]);
        minZ = Math.min(minZ, plan.z[i]); maxZ = Math.max(maxZ, plan.z[i]);
      }
      cells.set(k, { key: k, slots: Int32Array.from(list), minX, maxX, minZ, maxZ, built: null, lastEval: -Infinity, hour: 0, day: 0 });
    }
  }
  console.info(`[parking] ${plan.count} slots in ${cells.size} cells, curbs ${Math.round(t1 - t0)} ms, slots ${Math.round(performance.now() - t1)} ms`);

  // ---- Looks ----------------------------------------------------------------------------------------------------------
  const shadowMat = createContactShadowMaterial();
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  unitPlane.rotateX(-Math.PI * 0.5);
  const palettes = KINDS.map((k) => FLEET_STYLES[k] || FLEET_STYLES.sedan);
  const paintOf = (i) => {
    const palette = palettes[plan.kind[i]];
    const p = palette[Math.floor(plan.seed[i] * 7919) % palette.length];
    return p;
  };
  // Per kind: the full body with its wheels and the coarse stand-in, their vertex buffers shared by every cell
  const shared = KINDS.map((k) => {
    const model = carModels[k] || carModels.sedan;
    return { near: withWheels(model), far: model.far, material: trafficMaterial(carModels[k] ? k : 'sedan') };
  });
  const shareGeometry = (source, paint, carState) => {
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'flag']) g.setAttribute(name, source.attributes[name]);
    g.setIndex(source.index);
    g.setAttribute('paintColor', paint);
    g.setAttribute('carState', carState);
    g.boundingSphere = source.boundingSphere;
    return g;
  };
  const storageMatrix = (mesh) => {
    if (storage) mesh.instanceMatrix = new THREE.StorageInstancedBufferAttribute(mesh.instanceMatrix.array, 16);
    return mesh.instanceMatrix;
  };

  let controllers = null;
  let colliderOrder = 1e6;
  const colliderFor = (i) => {
    const k = plan.kind[i], sp = spec[k];
    const yaw = plan.yaw[i], cs = Math.cos(yaw), sn = Math.sin(yaw);
    const hx = sp.halfW + 0.04, hz = Math.max(sp.zFront, -sp.zRear);
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    const x = plan.x[i], z = plan.z[i];
    return { minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, minY: 0, maxY: Math.min(1.6, sp.height),
      obb: { cx: x, cz: z, cs, sn, hx, hz }, parked: i, _order: colliderOrder++ };
  };

  function build(cell, hour, day) {
    if (cell.built) dispose(cell);
    cell.hour = hour; cell.day = day;
    const byKind = KINDS.map(() => []);
    for (const i of cell.slots) {
      if (state[i] === STATE.BANNED) continue;
      if (state[i] === STATE.TAKEN) {
        // the gameplay car that took it may be long gone: the slot is free again unless something stands there
        if (isBlocked && isBlocked(plan.x[i], plan.z[i])) continue;
        state[i] = STATE.EMPTY;
      }
      const on = occupied(plan, i, hour, day) && !(isBlocked && isBlocked(plan.x[i], plan.z[i]));
      state[i] = on ? STATE.OCCUPIED : STATE.EMPTY;
      if (on) byKind[plan.kind[i]].push(i);
    }
    const built = { meshes: [], near: [], far: [], shadows: [], kinds: new Map(), slotOf: new Map(), colliders: new Map(), attributes: [] };
    let total = 0;
    for (let k = 0; k < KINDS.length; k++) {
      const list = byKind[k];
      if (!list.length) continue;
      const n = list.length;
      total += n;
      const paint = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      const carState = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      const near = new THREE.InstancedMesh(shareGeometry(shared[k].near, paint, carState), shared[k].material, n);
      const far = new THREE.InstancedMesh(shareGeometry(shared[k].far, paint, carState), shared[k].material, n);
      const shadow = new THREE.InstancedMesh(unitPlane, shadowMat, n);
      const sp = spec[k];
      const shadowW = 2 * sp.halfW + 0.33, shadowL = sp.zFront - sp.zRear + 0.55, shadowZ = (sp.zFront + sp.zRear) / 2;
      list.forEach((i, j) => {
        const style = paintOf(i);
        paint.array[j * 3] = style.col.r; paint.array[j * 3 + 1] = style.col.g; paint.array[j * 3 + 2] = style.col.b;
        carState.array[j * 4 + 3] = style.style + LAMPS_OFF;
        _q.setFromAxisAngle(_up, plan.yaw[i]);
        _p.set(plan.x[i], 0, plan.z[i]);
        _m.compose(_p, _q, _s);
        near.setMatrixAt(j, _m);
        const sy = Math.sin(plan.yaw[i]), cy = Math.cos(plan.yaw[i]);
        _p.set(plan.x[i] + sy * shadowZ, 0.018, plan.z[i] + cy * shadowZ);
        _s.set(shadowW, 1, shadowL);
        _m.compose(_p, _q, _s);
        _s.set(1, 1, 1);
        shadow.setMatrixAt(j, _m);
        built.slotOf.set(i, { k, j });
        if (controllers) {
          const c = colliderFor(i);
          controllers.addCollider(c);
          built.colliders.set(i, c);
        }
      });
      const matrices = storageMatrix(near);
      far.instanceMatrix = matrices;
      storageMatrix(shadow);
      for (const mesh of [near, far, shadow]) {
        mesh.frustumCulled = true;
        mesh.computeBoundingSphere();
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
      }
      near.castShadow = true;
      shadow.renderOrder = 998;
      far.visible = near.visible = false;
      group.add(near, far, shadow);
      near.updateMatrixWorld(); far.updateMatrixWorld(); shadow.updateMatrixWorld();
      built.meshes.push(near, far, shadow);
      built.near.push(near); built.far.push(far); built.shadows.push(shadow);
      built.kinds.set(k, { near, shadow });
      built.attributes.push(paint, carState, matrices, shadow.instanceMatrix);
    }
    built.count = total;
    cell.built = built;
  }

  function dispose(cell) {
    const b = cell.built;
    if (!b) return;
    for (const c of b.colliders.values()) controllers?.removeCollider(c);
    for (const mesh of b.meshes) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    for (const a of b.attributes) freeAttribute(a);
    cell.built = null;
  }

  // The car in slot i disappears from the street (the gameplay layer has its own now)
  function hide(i) {
    const cell = cells.get(cellKey(Math.floor(plan.x[i] / CELL), Math.floor(plan.z[i] / CELL)));
    const b = cell?.built;
    if (!b) return;
    const at = b.slotOf.get(i);
    if (at) {
      const entry = b.kinds.get(at.k);
      // the coarse stand-in shares the full model's matrices: one write hides both
      entry.near.setMatrixAt(at.j, ZERO);
      entry.near.instanceMatrix.needsUpdate = true;
      entry.shadow.setMatrixAt(at.j, ZERO);
      entry.shadow.instanceMatrix.needsUpdate = true;
      b.slotOf.delete(i);
    }
    const c = b.colliders.get(i);
    if (c) {
      controllers?.removeCollider(c);
      b.colliders.delete(i);
    }
  }

  const info = (i) => {
    const k = plan.kind[i], sp = spec[k], style = paintOf(i);
    return { slot: i, x: plan.x[i], z: plan.z[i], yaw: plan.yaw[i], kind: KINDS[k], halfW: sp.halfW, halfL: Math.max(sp.zFront, -sp.zRear),
      paint: style.col.getHex(), style: style.style };
  };

  // ---- Streaming ------------------------------------------------------------------------------------------------------
  let cursor = 0;
  const near = [];
  const distanceTo = (cell, x, z) => Math.hypot(Math.max(cell.minX - x, 0, x - cell.maxX), Math.max(cell.minZ - z, 0, z - cell.maxZ));
  let clock = 0;

  function update(camera, hour = 12, day = 0, dt = 0) {
    clock += dt;
    const cx = camera.position.x, cz = camera.position.z;
    // 1. cells within reach, nearest first
    near.length = 0;
    const r = Math.ceil(BUILD_RADIUS / CELL);
    const ix0 = Math.floor(cx / CELL), iz0 = Math.floor(cz / CELL);
    for (let ix = ix0 - r; ix <= ix0 + r; ix++) {
      for (let iz = iz0 - r; iz <= iz0 + r; iz++) {
        const cell = cells.get(cellKey(ix, iz));
        if (!cell) continue;
        cell.d = distanceTo(cell, cx, cz);
        if (cell.d <= BUILD_RADIUS) near.push(cell);
      }
    }
    near.sort((a, b) => a.d - b.d);
    let builds = BUILDS_PER_FRAME;
    for (const cell of near) {
      if (!cell.built) {
        if (builds <= 0) continue;
        builds--;
        build(cell, hour, day);
        cell.lastEval = clock;
      } else if (cell.d > REFRESH_BEYOND && clock - cell.lastEval > REFRESH_EVERY && builds > 0) {
        // out of sight: the curb may have filled or emptied with the hour
        cell.lastEval = clock;
        let changed = false;
        for (const i of cell.slots) {
          if (state[i] === STATE.BANNED || state[i] === STATE.TAKEN) continue;
          if ((state[i] === STATE.OCCUPIED) !== occupied(plan, i, hour, day)) { changed = true; break; }
        }
        if (changed) { builds--; build(cell, hour, day); }
      }
      const b = cell.built;
      if (!b) continue;
      const showNear = cell.d < DRAW_NEAR, showFar = !showNear && cell.d < DRAW_FAR;
      for (const m of b.near) m.visible = showNear;
      for (const m of b.far) m.visible = showFar;
      for (const m of b.shadows) m.visible = showNear || showFar;
    }
    // 2. far cells go
    if ((cursor++ & 15) === 0) {
      for (const cell of cells.values()) {
        if (cell.built && distanceTo(cell, cx, cz) > DROP_RADIUS) dispose(cell);
      }
    }
  }

  // ---- Queries for the gameplay layer -------------------------------------------------------------------------------
  function forEachNear(x, z, radius, fn) {
    const r2 = radius * radius;
    for (let ix = Math.floor((x - radius) / CELL); ix <= Math.floor((x + radius) / CELL); ix++) {
      for (let iz = Math.floor((z - radius) / CELL); iz <= Math.floor((z + radius) / CELL); iz++) {
        const cell = cells.get(cellKey(ix, iz));
        if (!cell) continue;
        for (const i of cell.slots) {
          if (state[i] !== STATE.OCCUPIED) continue;
          const dx = plan.x[i] - x, dz = plan.z[i] - z;
          if (dx * dx + dz * dz <= r2 && fn(i) === true) return;
        }
      }
    }
  }
  // Occupied slots within `radius` of the segment from (ox, oz) along the unit vector (ux, uz) for `reach` metres
  function forEachAlong(ox, oz, ux, uz, reach, radius, fn) {
    const ex = ox + ux * reach, ez = oz + uz * reach;
    const minX = Math.min(ox, ex) - radius, maxX = Math.max(ox, ex) + radius, minZ = Math.min(oz, ez) - radius, maxZ = Math.max(oz, ez) + radius;
    const r2 = radius * radius;
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const cell = cells.get(cellKey(ix, iz));
        if (!cell) continue;
        for (const i of cell.slots) {
          if (state[i] !== STATE.OCCUPIED) continue;
          const px = plan.x[i] - ox, pz = plan.z[i] - oz;
          const u = Math.max(0, Math.min(reach, px * ux + pz * uz));
          const qx = ux * u - px, qz = uz * u - pz;
          if (qx * qx + qz * qz <= r2 && fn(i) === true) return;
        }
      }
    }
  }

  // The gameplay layer takes the car: it leaves the street, the slot stays empty until the player has gone
  function release(i) {
    if (state[i] !== STATE.OCCUPIED) return null;
    const r = info(i);
    state[i] = STATE.TAKEN;
    hide(i);
    return r;
  }
  // Something else now stands here (a fleet car, a roadblock): the slots under it empty without a trace
  function vacateNear(x, z, radius) {
    const gone = [];
    forEachNear(x, z, radius, (i) => { gone.push(i); });
    for (const i of gone) { state[i] = STATE.TAKEN; hide(i); }
    return gone.length;
  }
  // Nobody ever parks here (bus stops, fire houses, data-driven zones)
  function ban(x, z, radius) {
    const r2 = radius * radius;
    for (let ix = Math.floor((x - radius) / CELL); ix <= Math.floor((x + radius) / CELL); ix++) {
      for (let iz = Math.floor((z - radius) / CELL); iz <= Math.floor((z + radius) / CELL); iz++) {
        const cell = cells.get(cellKey(ix, iz));
        if (!cell) continue;
        for (const i of cell.slots) {
          const dx = plan.x[i] - x, dz = plan.z[i] - z;
          if (dx * dx + dz * dz > r2) continue;
          if (state[i] === STATE.OCCUPIED) hide(i);
          state[i] = STATE.BANNED;
        }
      }
    }
  }

  function attach(manager) {
    controllers = manager;
    // cells built before the controllers existed get their colliders now
    for (const cell of cells.values()) {
      const b = cell.built;
      if (!b) continue;
      for (const i of b.slotOf.keys()) {
        if (b.colliders.has(i)) continue;
        const c = colliderFor(i);
        controllers.addCollider(c);
        b.colliders.set(i, c);
      }
    }
  }

  const stats = () => {
    let built = 0, drawn = 0;
    for (const cell of cells.values()) if (cell.built) { built++; drawn += cell.built.count; }
    return { slots: plan.count, cells: cells.size, built, drawn };
  };

  return { group, plan, state, STATE, count: plan.count, attach, update, forEachNear, forEachAlong, info, release, vacateNear, ban, stats };
}

export { createParking, CELL as PARKING_CELL };
