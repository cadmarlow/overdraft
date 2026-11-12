import * as THREE from 'three/webgpu';
import { float, positionWorld, texture, vec3 } from 'three/tsl';
import { ground } from './ground-assets.js';
import { FRONTIER_CRATE } from './frontier-districts.js';
import { sampleSalt } from './wasteland-plan.js';
import { fixItem } from './wasteland-scatter.js';

const COLORS = { pale: 0xa6a18c, iron: 0x45433b, cement: 0x8e8371, rust: 0x955447 };

export function buildFrontierNursery(parent, { colliders, keepOut }) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.88 });
  material.name = 'Lisières · bois, toile et tôle';
  material.colorNode = vec3(texture(ground.masksA, positionWorld.xz.div(4.3)).a.mul(0.22).add(0.76));
  material.aoNode = float(0.73);
  const pose = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), scale = new THREE.Vector3();
  const build = (district, boxes, yaw) => {
    const mesh = new THREE.InstancedMesh(geo, material, boxes.length);
    boxes.forEach((b, i) => {
      q.setFromEuler(e.set(b.tilt, yaw, b.roll ?? 0, 'YXZ'));
      pose.compose(p.set(b.x, b.y, b.z), q, scale.set(b.w, b.h, b.d));
      mesh.setMatrixAt(i, pose);
      mesh.setColorAt(i, new THREE.Color(COLORS[b.color]));
    });
    mesh.name = district.name + ' · ossature';
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    district.add(mesh);
  };

  const { x, z } = FRONTIER_CRATE;
  const nursery = new THREE.Group();
  nursery.name = FRONTIER_CRATE.name;
  parent.add(nursery);
  const frame = [], offsetX = x + 8.6, offsetZ = z - 2.7;
  const sill = sampleSalt(offsetX, offsetZ);
  const remnant = (dx, y, dz, w, h, d, color, roll = 0, tilt = 0, solid = false) => {
    const bx = offsetX + dx, by = sill + y, bz = offsetZ + dz;
    frame.push({ x: bx, y: by, z: bz, w, h, d, color, roll, tilt });
    if (solid) colliders.push({ minX: bx - w / 2, maxX: bx + w / 2, minY: by - h / 2, maxY: by + h / 2,
      minZ: bz - d / 2, maxZ: bz + d / 2, roof: h > 0.3 });
  };
  for (const [i, dz] of [-4.2, -0.7, 2.8].entries()) {
    for (const side of [-1, 1]) {
      const h = i === 2 && side === -1 ? 0.86 : 2.56;
      const dx = side * 2.65;
      const base = Math.min(-0.22, sampleSalt(offsetX + dx, offsetZ + dz) - sill - 0.22);
      remnant(dx, (h - 0.22 + base) / 2, dz, 0.12, h - 0.22 - base, 0.12, 'iron', side * i * 0.026, 0, true);
      if (h > 1) remnant(side * 1.32, 2.65, dz, 2.85, 0.105, 0.105, 'iron', -side * 0.34);
      if (i < 2) {
        const footing = Math.min(base, sampleSalt(offsetX + dx, offsetZ + dz + 3.5) - sill - 0.18);
        remnant(dx, (0.42 + footing) / 2, dz + 1.72, 0.23, 0.42 - footing, 3.55, 'cement', 0, 0, true);
      }
    }
  }
  remnant(0, 3.11, -1.65, 0.14, 0.12, 5.35, 'rust', 0, -0.044);
  remnant(1.42, 2.64, -3.65, 2.72, 0.055, 1.39, 'pale', -0.34);
  remnant(-1.52, 0.42, 1.36, 2.35, 0.07, 1.71, 'rust', 0.19, 0.29);
  build(nursery, frame, 0);
  keepOut.push({ x: offsetX, z: offsetZ, r: 11 });
  for (const [name, dx, dz, yaw] of [['concrete_block', -3.4, 1.8, 0.15], ['fence', 5.6, -5.1, 0.12], ['barrel_blue', 2.8, 0.7, 0],
    ['crate', -1.2, 0.5, -0.12], ['dead_trunk', 10, 2.4, 1.5], ['dead_log', 7.5, -4, 0.22],
    ['rubble', 4, 2.1, 0.24], ['rubble', 11.8, -7.3, 0.76], ['barrel_red', 8.9, -6.3, 0.36]]) {
    fixItem({ name, x: x + dx, z: z + dz, yaw, lean: name === 'barrel_red' ? 1.5 : 0, leanYaw: 1.1 });
  }
}
