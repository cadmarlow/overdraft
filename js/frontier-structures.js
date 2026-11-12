import * as THREE from 'three/webgpu';
import { float, positionWorld, texture, vec3 } from 'three/tsl';
import { ground } from './ground-assets.js';
import { FRONTIER_CRATE, FRONTIER_SITES, frontierPoint } from './frontier-districts.js';
import { sampleSalt } from './wasteland-plan.js';
import { fixItem } from './wasteland-scatter.js';

const COLORS = {
  beam: 0x655449, pale: 0xa6a18c, iron: 0x45433b, cement: 0x8e8371, plank: 0x987a55,
  rust: 0x955447, red: 0xa45843, petrol: 0x4b7777, canvas: 0xc5b889, leaf: 0x637340, soil: 0x60503a
};
const FACE = {
  market: 'FARINE · RÉCUPÉRATION · ÉCHANGE',
  garden: 'PLANTS · TERRE · EAU DE RÉEMPLOI',
  garage: 'PIÈCES · SOUDURE · PNEUS',
  yard: 'DÉPÔT · PESÉE · RÉCUPÉRATION',
  watch: 'BULLETIN DE LA RADE'
};

export function buildFrontierStructures(parent, { sign, colliders, fires, keepOut }) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.88 });
  material.name = 'Lisières · bois, toile et tôle';
  material.colorNode = vec3(texture(ground.masksA, positionWorld.xz.div(4.3)).a.mul(0.22).add(0.76));
  material.aoNode = float(0.73);
  const beacon = new THREE.MeshStandardNodeMaterial({ color: 0xf1b46e, emissive: 0xe07c25, emissiveIntensity: 0.8 });
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

  for (const site of FRONTIER_SITES) {
    const { width, depth, yaw, type } = site, hw = width / 2, hd = depth / 2;
    const y0 = sampleSalt(site.x, site.z), height = type === 'watch' ? 4.9 : 3.25;
    const district = new THREE.Group();
    district.name = site.name;
    parent.add(district);
    const boxes = [];
    const box = (x, y, z, w, h, d, color, solid = false, tilt = 0) => {
      const at = frontierPoint(site, x, z);
      boxes.push({ ...at, y: y0 + y + h / 2, w, h, d, color, tilt });
      if (!solid) return;
      const cs = Math.cos(yaw), sn = Math.sin(yaw), hx = w / 2, hz = d / 2;
      const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
      colliders.push({
        minX: at.x - ex, maxX: at.x + ex, minZ: at.z - ez, maxZ: at.z + ez,
        minY: y0 + y, maxY: y0 + y + h, obb: { cx: at.x, cz: at.z, cs, sn, hx, hz }, roof: h > 0.25
      });
    };
    const prop = (name, x, z, heading = 0, scale = 1, extra = {}) =>
      fixItem({ name, ...frontierPoint(site, x, z), yaw: yaw + heading, scale, ...extra });

    // Individual posts follow the terrain; the weathered roofs are built level above them.
    for (const x of [-hw + 0.25, 0, hw - 0.25]) for (const z of [-hd + 0.25, hd - 0.25]) {
      const p = frontierPoint(site, x, z);
      const base = sampleSalt(p.x, p.z) - y0 - 0.12;
      box(x, base, z, 0.23, height - base, 0.23, 'beam', true);
    }
    box(0, height - 0.28, -hd, width, 0.2, 0.22, 'beam');
    box(0, height - 0.28, hd, width, 0.2, 0.22, 'beam');
    const panels = type === 'market' ? ['petrol', 'canvas', 'red', 'canvas', 'petrol'] :
      type === 'garden' ? ['canvas', 'pale', 'canvas', 'pale'] :
      type === 'garage' ? ['iron', 'iron', 'rust', 'pale', 'iron'] : ['pale', 'rust', 'iron', 'pale'];
    panels.forEach((color, i) => {
      const w = width / panels.length;
      const rise = type === 'market' ? [0, 0.18, 0.35, 0.23, 0][i] : (i % 2) * 0.07;
      box(-hw + (i + 0.5) * w, height - 0.12 + rise, 0, w + 0.2, 0.13, depth + 0.9, color, false, type === 'market' ? 0.095 : 0.065);
      if (type === 'market') {
        for (let s = 0; s < 6; s++) {
          box(-hw + (i + (s + 0.5) / 6) * w, height - 0.65 + rise, hd + 0.48, w / 6, 0.24 + (s % 3) * 0.035, 0.08,
            s % 2 ? color : 'canvas');
        }
      }
    });
    for (let x = -hw + 0.2, i = 0; x < hw; x += 0.42, i++) {
      if (i % 11 === 7 || (type === 'garden' && i % 3)) continue;
      const h = 1.8 + (i % 7) * 0.06;
      box(x, -0.25, -hd + 0.3, 0.4, h, 0.09, type === 'market' ? 'plank' : (i % 5 ? 'pale' : 'rust'));
    }
    box(0, -0.4, -hd + 0.42, width, 1.75, 0.24, 'plank', true);
    const label = frontierPoint(site, 0, hd + 0.55);
    const signWidth = type === 'market' ? 6.5 : Math.min(6, width * 0.59);
    sign(district, label.x, y0 + height + 0.47, label.z, yaw, site.name.toUpperCase(), FACE[type], signWidth);
    for (const x of [-signWidth / 2 + 0.15, signWidth / 2 - 0.15]) {
      box(x, height - 0.35, hd + 0.33, 0.17, 1.05, 0.17, 'beam');
    }

    if (type === 'market') {
      for (const [x, color] of [[-6.6, 'red'], [-2.2, 'plank'], [3.4, 'petrol'], [7.6, 'pale']]) {
        box(x, -0.05, 0.95, 3.7, 0.82, 0.86, color, true);
        box(x, 0.76, 0.95, 3.9, 0.12, 1.01, 'plank');
        for (const dx of [-1.56, 1.56]) box(x + dx, 0.03, 1.41, 0.16, 0.73, 0.12, 'beam');
        box(x - 1.12, 0.88, 0.83, 0.62, 0.24, 0.47, 'canvas');
        box(x - 0.5, 0.88, 0.77, 0.47, 0.17, 0.4, 'plank');
        box(x + 0.94, 0.88, 0.95, 0.48, 0.33, 0.44, 'pale');
        prop('crate', x - 0.8, -0.72, 0.12, 0.72);
        prop('jerrycan', x + 0.75, -0.66, 0.3, 0.85);
      }
      box(-hw - 4, -0.3, 0, 5.8, 0.77, 1.3, 'cement', true);
      box(-hw - 4.5, 0.46, -0.24, 2.15, 0.51, 0.73, 'petrol');
      box(-hw - 5.45, 0.46, 0.14, 0.13, 1.55, 0.13, 'iron');
      box(-hw - 5.45, 1.91, 0.48, 0.13, 0.13, 0.76, 'iron');
      box(-hw - 5.45, 1.67, 0.82, 0.13, 0.36, 0.13, 'iron');
      box(-hw - 2.7, 0.45, 0.23, 1.55, 0.08, 0.65, 'plank');
      for (const [x, z] of [[-hw - 4.8, -2], [hw + 3.2, -1], [hw + 8, 3]]) prop('barrel_blue', x, z);
      prop('generator', -hw - 3, -2.05, 0.2, 0.9);
      prop('table', hw + 4.3, 0.9, 0.13, 0.9);
      prop('covered_car', hw + 9.2, -4.4, 0.34, 1);
      prop('fence', hw + 6.2, -7, 0.14, 1);
      prop('chair', hw + 4.4, 2.25, -0.21, 0.85);
      for (const [x, z] of [[-hw - 7, -4], [hw + 8, -4], [hw + 13, 1], [hw + 10, 7], [-hw - 9, 4]]) {
        prop('bush_wide', x, z, 0, 0.89, { tint: [0.89, 1.03, 0.72] });
        prop('bush', x + 1.3, z - 1.2, 1.3, 0.77, { tint: [0.92, 1.05, 0.69] });
        prop('rubble', x - 0.5, z + 0.4, 0.4, 1.18, { sink: 0.08 });
      }
    } else if (type === 'garden') {
      for (const x of [-7, -3.6, 0, 3.6, 7]) {
        box(x, -0.14, -0.24, 1.55, 0.55, 5.65, 'plank', true);
        box(x, 0.38, -0.24, 1.31, 0.06, 5.4, 'soil');
        for (let i = 0; i < 7; i++) {
          const z = -2.47 + i * 0.75, size = 0.39 + (i % 3) * 0.06;
          const row = x + (i % 2 - 0.5) * 0.6;
          const at = frontierPoint(site, row, z);
          const lift = y0 + 0.39 - sampleSalt(at.x, at.z);
          prop('bush_wide', row, z, i * 1.17, size, { tint: [0.64, 1.21, 0.48], sink: -lift / size });
        }
      }
      prop('barrel_blue', hw + 2, -hd);
      prop('jerrycan', hw + 2.7, -hd + 0.45);
      prop('crate', hw + 2.65, -hd + 2.5, 0.2, 0.9);
      prop('table', -hw - 3.5, 0.9, -0.17, 0.84);
    } else if (type === 'garage') {
      prop('covered_car', -3, 0, 0, 0.96);
      prop('welding_cart', -1, -2.4, 0.3);
      prop('tyre_stack', hw - 1.2, -2.6, 1.3);
      prop('gas_cylinder', hw - 1.2, -0.4);
      prop('generator', hw + 1.6, -0.9, 1.2);
      box(hw - 2.5, 0, -2.5, 2.7, 0.94, 0.9, 'iron', true);
    } else if (type === 'watch') {
      box(0, 2.5, -1.6, width, 0.23, depth * 0.48, 'plank', true);
      box(0, 2.73, 0.1, width, 0.1, 0.12, 'iron');
      for (const x of [-3, 0, 3]) box(x, 2.69, 0.1, 0.095, 0.85, 0.095, 'iron');
      prop('ladder', hw + 0.1, -hd + 2.0, 0, 1.16);
      const at = frontierPoint(site, 0, 0);
      const lamp = new THREE.Mesh(geo, beacon);
      lamp.position.set(at.x, y0 + height + 0.45, at.z);
      lamp.scale.set(0.36, 0.55, 0.36);
      district.add(lamp);
    } else {
      for (let i = 0; i < 4; i++) {
        const x = -hw + 2.1 + i * 2.55;
        prop(i % 2 ? 'crate' : 'cement_bag', x, -1.8, i * 0.6, 0.9);
        if (i % 2) prop('tyre_stack', x, -3.2, i * 0.6, 0.65);
      }
      box(-hw + 3.7, -0.03, 1.6, 5.7, 0.19, 3.0, 'iron');
      box(hw - 1.6, 0, -0.3, 1.8, 0.78, 0.8, 'plank', true);
    }

    const fire = frontierPoint(site, -hw - 4, hd + 7);
    prop('fire_pit', -hw - 4, hd + 7);
    prop('chair', -hw - 5.2, hd + 8.8, 0.1);
    prop('crate', -hw - 2, hd + 6.7, 0.2, 0.71);
    fires.push([fire.x, sampleSalt(fire.x, fire.z) + 0.25, fire.z, 0.63]);
    keepOut.push({ x: site.x, z: site.z, r: width * 0.7 + 15 });

    build(district, boxes, yaw);
  }

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
    ['crate', 0, 0, 0.27], ['crate', -1.2, 0.5, -0.12], ['dead_trunk', 10, 2.4, 1.5], ['dead_log', 7.5, -4, 0.22],
    ['rubble', 4, 2.1, 0.24], ['rubble', 11.8, -7.3, 0.76], ['barrel_red', 8.9, -6.3, 0.36]]) {
    fixItem({ name, x: x + dx, z: z + dz, yaw, lean: name === 'barrel_red' ? 1.5 : 0, leanYaw: 1.1 });
  }
}
