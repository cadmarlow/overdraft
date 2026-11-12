import * as THREE from 'three/webgpu';
import { Fn, attributeArray, float, instanceIndex, mix, positionGeometry, sin, smoothstep, time, uniform, varying, vec3 } from 'three/tsl';
import { lawnLayers } from './park-materials.js';

// Blades of grass over the lawns near the camera: real geometry, its colour and its vigour taken from the lawn it grows
// on (js/park-materials.js lawnLayers): tall where the lawn is lush, short and straw where it is worn, none on bare earth.
// Two rings of cells follow the camera, the inner one thick with fine tufts, the outer one thinner with wider ones. Lawns are found
// by material (`userData.lawn`, or `userData.lawnVariant` for the shared ground), so any lawn gets its grass.

const BLADE_HEIGHT = 0.13;
const FADE_FROM = 46, FADE_TO = 62; // metres: where the outer ring shrinks into the turf

// A tuft: `blades` tapering blades fanned round its foot, two segments each, bent over with height
function tuftGeometry(blades, width) {
  const pos = [], index = [];
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + b * 0.7;
    const cx = Math.cos(a), sz = Math.sin(a);
    const bx = cx * width * 0.45, bz = sz * width * 0.45; // leaning outwards from the foot
    const sx = -sz * width * 0.5, ss = cx * width * 0.5;
    const h = 0.8 + ((b * 7) % 5) * 0.1;
    const at = pos.length / 3;
    const ring = (t, w) => { pos.push(bx * t * 1.6 - sx * w, h * t, bz * t * 1.6 - ss * w, bx * t * 1.6 + sx * w, h * t, bz * t * 1.6 + ss * w); };
    ring(0, 1);
    ring(0.55, 0.62);
    pos.push(bx * 1.6, h, bz * 1.6);
    index.push(at, at + 1, at + 3, at, at + 3, at + 2, at + 2, at + 3, at + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(index);
  return g;
}

function createGrassMaterial(store, camera) {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.82, side: THREE.DoubleSide });
  const tuft = store.element(instanceIndex); // x, y, z, seed
  const tip = positionGeometry.y;
  const seed = tuft.w;
  // What the lawn is like at the tuft's foot, worked out once a vertex
  const lawn = lawnLayers(tuft.xz);
  // (a kept lawn is mown short)
  const vigour = lawn.bare.oneMinus().mul(mix(float(1.0), float(0.6), lawn.wear)).mul(mix(float(1.0), float(0.8), lawn.canopy)).mul(mix(float(1.0), float(0.5), lawn.kept));
  mat.positionNode = Fn(() => {
    const p = positionGeometry;
    const yaw = seed.mul(6.2832);
    const c = yaw.cos(), s = yaw.sin();
    const size = seed.mul(7.13).fract().mul(0.7).add(0.65);
    const away = tuft.xz.sub(camera.xz).length();
    const fade = smoothstep(float(FADE_TO), float(FADE_FROM), away);
    const h = p.y.mul(BLADE_HEIGHT).mul(size).mul(fade).mul(vigour);
    const local = vec3(p.x.mul(c).sub(p.z.mul(s)), h, p.x.mul(s).add(p.z.mul(c)));
    // the wind runs through the lawn in waves
    const wave = sin(time.mul(1.9).add(tuft.x.mul(0.5)).add(tuft.z.mul(0.37))).mul(0.5).add(0.5);
    const lean = wave.mul(0.05).add(sin(time.mul(5.2).add(seed.mul(40.0))).mul(0.012)).mul(p.y).mul(p.y);
    return tuft.xyz.add(local).add(vec3(lean.mul(0.86), 0, lean.mul(0.51)));
  })();
  const green = varying(lawn.green, 'vLawnGreen');
  const hue = seed.mul(13.7).fract();
  mat.colorNode = Fn(() => {
    const t = tip.clamp(0, 1);
    // dark at the foot, where the blades shade each other; the tips catch the light, some yellower than others
    return green.mul(mix(float(0.62), mix(float(0.95), float(1.18), hue), t)).mul(mix(vec3(1.0), vec3(1.08, 1.04, 0.86), hue.mul(t)));
  })();
  return mat;
}

const hash = (x, z, k) => {
  const v = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

class Ring {
  constructor(scene, field, { cell, radius, tufts, geometry, name }) {
    this.field = field;
    this.cell = cell;
    this.radius = radius;
    this.tufts = tufts;
    this.side = radius * 2 + 1;
    this.slots = this.side * this.side;
    this.store = attributeArray(this.slots * tufts, 'vec4').toReadOnly();
    const data = this.store.value.array;
    for (let i = 1; i < data.length; i += 4) data[i] = -1000; // nothing grows here yet
    this.mesh = new THREE.Mesh(geometry, createGrassMaterial(this.store, field.camera));
    this.mesh.name = name;
    this.mesh.count = this.slots * tufts;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
    this.at = new Map(); // cell -> slot
    this.free = Array.from({ length: this.slots }, (_, i) => i);
    this.cx = NaN;
    this.cz = NaN;
    this.hole = 0; // rings inside this one are drawn by the finer ring
  }

  update(x, z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    if (cx === this.cx && cz === this.cz) return;
    this.cx = cx;
    this.cz = cz;
    const R = this.radius, attr = this.store.value;
    for (const [key, slot] of this.at) {
      const ix = Math.floor(key / 65536) - 32768, iz = (key % 65536) - 32768;
      if (Math.abs(ix - cx) > R || Math.abs(iz - cz) > R) {
        this.at.delete(key);
        this.free.push(slot);
      }
    }
    attr.clearUpdateRanges();
    for (let ix = cx - R; ix <= cx + R; ix++) for (let iz = cz - R; iz <= cz + R; iz++) {
      const key = (ix + 32768) * 65536 + (iz + 32768);
      if (this.at.has(key)) continue;
      const slot = this.free.pop();
      this.at.set(key, slot);
      this.field.fill(this, ix, iz, attr.array, slot * this.tufts * 4);
      attr.addUpdateRange(slot * this.tufts * 4, this.tufts * 4);
    }
    attr.needsUpdate = true;
  }
}

function createGrass(scene, root, cameraPosition, isCovered = () => false) {
  // Upward triangles of every lawn, indexed by 16 m cells
  const CELL = 16;
  const tris = [];
  const cells = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const cellKey = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);
  root.updateMatrixWorld(true);
  root.traverse((mesh) => {
    if (!mesh.isMesh || mesh.isInstancedMesh) return;
    const material = Array.isArray(mesh.material) ? null : mesh.material;
    const lawn = material?.userData?.lawn, variant = material?.userData?.lawnVariant;
    if (!lawn && variant === undefined) return;
    const g = mesh.geometry, P = g.attributes.position, U = g.attributes.uv, I = g.index;
    const count = I ? I.count : P.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const ia = I ? I.getX(i) : i, ib = I ? I.getX(i + 1) : i + 1, ic = I ? I.getX(i + 2) : i + 2;
      if (variant !== undefined && Math.floor(U.getX(ia) * 0.1 + 0.01) !== variant) continue;
      a.fromBufferAttribute(P, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(P, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(P, ic).applyMatrix4(mesh.matrixWorld);
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      if (length < 1e-4 || Math.abs(ny) / length < 0.85) continue;
      const at = tris.length;
      tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      const x0 = Math.floor(Math.min(a.x, b.x, c.x) / CELL), x1 = Math.floor(Math.max(a.x, b.x, c.x) / CELL);
      const z0 = Math.floor(Math.min(a.z, b.z, c.z) / CELL), z1 = Math.floor(Math.max(a.z, b.z, c.z) / CELL);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const key = cellKey(ix, iz);
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(at);
      }
    }
  });

  // Height of the lawn at (x, z), or NaN
  const lawnAt = (x, z, list) => {
    for (let k = 0; k < list.length; k++) {
      const t = list[k];
      const ax = tris[t], ay = tris[t + 1], az = tris[t + 2], bx = tris[t + 3], by = tris[t + 4], bz = tris[t + 5], cx = tris[t + 6], cy = tris[t + 7], cz = tris[t + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (u < 0 || v < 0 || u + v > 1) continue;
      return u * ay + v * by + (1 - u - v) * cy;
    }
    return NaN;
  };

  const field = {
    camera: uniform(new THREE.Vector3()),
    fill(ring, ix, iz, out, o) {
      const size = ring.cell;
      const list = cells.get(cellKey(Math.floor((ix * size) / CELL), Math.floor((iz * size) / CELL))) ?? [];
      for (let i = 0; i < ring.tufts; i++) {
        const x = (ix + hash(ix, iz, i + 0.1)) * size, z = (iz + hash(iz, ix, i + 0.7)) * size;
        const y = list.length ? lawnAt(x, z, list) : NaN;
        const at = o + i * 4;
        out[at] = x;
        out[at + 1] = Number.isNaN(y) || isCovered(x, z, y) ? -1000 : y;
        out[at + 2] = z;
        out[at + 3] = hash(x, z, 3.3);
      }
    }
  };
  const near = new Ring(scene, field, { cell: 8, radius: 3, tufts: 340, geometry: tuftGeometry(5, 0.05), name: 'GrassNear' });
  const far = new Ring(scene, field, { cell: 16, radius: 4, tufts: 260, geometry: tuftGeometry(3, 0.11), name: 'GrassFar' });
  field.camera.value.copy(cameraPosition);

  return {
    meshes: [near.mesh, far.mesh],
    triangles: tris.length / 9,
    update(position) {
      field.camera.value.copy(position);
      near.update(position.x, position.z);
      far.update(position.x, position.z);
    }
  };
}

export { createGrass };
