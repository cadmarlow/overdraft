import * as THREE from 'three/webgpu';
import { createDistrictBatch, standard } from './district-geometry.js';
import { groundFootprint } from './ground-surfaces.js';
import { createCurtainWallMaterial, createDressedStoneMaterial, createLobbyGlassMaterial } from './tsl-materials.js';

function createArchitecture(scene, name) {
  const batch = createDistrictBatch(name);
  const box = (mat, x, y, z, w, h, d, yaw = 0) =>
    batch.add(mat, new THREE.BoxGeometry(w, h, d).rotateY(yaw).translate(x, y + h / 2, z));
  const column = (mat, x, y, z, r0, r1, h, sides = 16) =>
    batch.add(mat, new THREE.CylinderGeometry(r0, r1, h, sides).translate(x, y + h / 2, z));
  const shape = (mat, points, base, height, holes = []) => {
    const path = new THREE.Shape(points.map(p => new THREE.Vector2(p.x, -p.z)));
    for (const ring of holes) path.holes.push(new THREE.Path(ring.map(p => new THREE.Vector2(p.x, -p.z))));
    const geo = new THREE.ExtrudeGeometry(path, { depth: height, bevelEnabled: false });
    batch.add(mat, geo.rotateX(-Math.PI / 2).translate(0, base, 0));
  };
  function dome(mat, x, y, z, radius, height, flatten = 1, sides = 56) {
    const profile = Array.from({ length: 20 }, (_, i) => {
      const t = i * Math.PI / 38;
      return new THREE.Vector2(radius * Math.cos(t), height * Math.sin(t));
    });
    batch.add(mat, new THREE.LatheGeometry(profile, sides).scale(1, 1, flatten).translate(x, y, z));
  }
  return { box, column, dome, shape, batch, finish: () => batch.finish(scene) };
}

function campusLibrary(g, m, b, low) {
  const x = b.cx, z = b.cz, front = low ? 1 : -1;
  const base = low ? 6.5 : 1.04;
  const portico = low ? b.maxZ - 0.4 : b.minZ + 0.55;
  const baseHeight = low ? 14.9 : 23;
  for (const p of b.polygons) g.shape(m.stone, p.outer, 0, base, p.holes);
  const mainFace = low ? b.maxZ - 14.05 : b.minZ + 7.8;
  const backFace = low ? b.minZ + 13 : b.maxZ - 0.5;
  g.box(low ? m.stone : m.brick, x, base, (mainFace + backFace) / 2,
    b.maxX - b.minX - (low ? 1.6 : 0.7), baseHeight, Math.abs(mainFace - backFace));
  const count = low ? 10 : 12;
  const spacing = low ? 2.88 : 4.15;
  for (let i = 0; i < count; i++) {
    const px = x + (i - (count - 1) * 0.5) * spacing;
    const colZ = portico - front * (low ? 1.3 : 1.7);
    g.box(m.trim, px, base, colZ, 1.59, 0.26, 1.55);
    g.column(m.stone, px, base + 0.27, colZ, 0.52, 0.7, low ? 10.5 : 13);
    g.column(m.trim, px, base + (low ? 10.75 : 13.2), colZ, 0.84, 0.57, 0.72, 12);
    g.box(m.trim, px, base + (low ? 11.42 : 13.9), colZ, 1.76, 0.27, 1.72);
    g.box(m.lobby, px + spacing / 2, base + 0.7, mainFace + front * 0.11,
      i === count - 1 ? 0.2 : 1.37, low ? 8.9 : 10.2, 0.17);
  }
  const span = count * spacing + (low ? 1.2 : 2);
  g.box(m.stone, x, base + (low ? 11.7 : 14.2), (portico + mainFace) / 2, span, 2.1, Math.abs(portico - mainFace) + 1);
  g.box(m.trim, x, base + (low ? 13.8 : 16.3), (portico + mainFace) / 2, span + 1.05, 0.5, Math.abs(portico - mainFace) + 1.4);
  g.box(m.trim, x, base + baseHeight, (mainFace + backFace) / 2, b.maxX - b.minX, 0.64, Math.abs(mainFace - backFace) + 0.5);

  if (low) {
    g.column(m.stone, x, 20.7, z - 0.6, 17.4, 18.2, 5.85, 56);
    g.column(m.trim, x, 26.42, z - 0.6, 17.9, 17.72, 0.7, 56);
    g.dome(m.dome, x, 27.05, z - 0.6, 17.52, 11.5);
    g.column(m.trim, x, 38.24, z - 0.6, 1.08, 1.45, 0.65, 16);
    g.column(m.bronze, x, 38.9, z - 0.6, 0.22, 0.4, 1.12, 10);
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12, px = x + Math.cos(a) * 17.28, pz = z - 0.6 + Math.sin(a) * 17.28;
      g.box(m.lobby, px, 22.19, pz, 1.28, 2.43, 0.2, Math.PI / 2 - a);
    }
    g.box(m.stone, x, 6.5, z - 21.5, 34.1, 13.5, 17.3);
    g.box(m.trim, x, 19.95, z - 21.5, 34.7, 0.45, 17.6);
  } else {
    g.box(m.stone, x, 25, z + 1.5, 48, 7.4, 36);
    g.box(m.roof, x, 32.4, z + 1.5, 46.8, 0.58, 35);
    g.box(m.stone, x, 32.98, z + 4.1, 24, 3.9, 14);
    for (const zt of [b.minZ + 8, b.maxZ - 0.4]) for (const yt of [6, 12, 18]) {
      for (let i = -9; i <= 9; i++) g.box(m.lobby, x + i * 3.9, yt, zt, 1.7, 2.48, 0.22);
    }
  }
}

function asphaltPlant(g, m, b) {
  const x = b.cx - 4.1, z = b.cz + 2.4, half = 18.6, depth = 35.2, base = 0.29;
  const profile = (width, height, offset = 0) => {
    const path = new THREE.Shape();
    path.moveTo(-width, offset);
    for (let i = 0; i <= 32; i++) {
      const q = i / 16 - 1;
      path.lineTo(q * width, offset + height * (1 - q * q));
    }
    path.lineTo(width, offset); path.closePath();
    return path;
  };
  const yaw = 0.16;
  const panel = (mat, width, height, start, thickness, offset = 0) => {
    const geo = new THREE.ExtrudeGeometry(profile(width, height, offset), { depth: thickness, bevelEnabled: false });
    g.batch.add(mat, geo.translate(0, base, start).rotateY(yaw).translate(x, 0, z));
  };
  panel(m.concrete, half, 20.65, -depth * 0.5, depth);
  for (const side of [-1,1]) {
    panel(m.brick, half - 1.02, 19.16, side * depth * 0.5 - 0.08, 0.18, 0.06);
    panel(m.lobby, 10.75, 15.1, side * (depth * 0.5 + 0.24) - 0.05, 0.1, 1.65);
    for (const y of [2.35,5.7,9.2,12.7]) {
      const width = 21.4 * Math.sqrt(1 - (y - 1.35) / 15.1);
      const dz = side * (depth * 0.5 + 0.31);
      g.box(m.concrete, x + Math.sin(yaw) * dz, y, z + Math.cos(yaw) * dz, width, 0.23, 0.22, yaw);
    }
    const dz = side * (depth * 0.5 + 0.65);
    g.box(m.trim, x + Math.sin(yaw) * dz, 3.14, z + Math.cos(yaw) * dz, 9, 0.26, 2.65, yaw);
  }
  for (const dz of [-13.4,-4.45,4.45,13.4]) panel(m.concrete, half + 0.2, 20.83, dz, 0.32);
  g.box(m.brick, b.minX + 5.4, 0.29, b.cz, 9.7, 8.25, 48.2);
  g.box(m.roof, b.minX + 5.4, 8.55, b.cz, 10.1, 0.32, 48.6);
  const wing = [[1359,-3981],[1374,-3983],[1385,-3988],[1394,-3996],[1371,-4017],[1359,-4005]].map(([x,z])=>({x,z}));
  g.shape(m.concrete,wing,0.27,9.18);
  g.shape(m.roof,wing,9.45,0.48);
  g.box(m.lobby,1372,1.2,-3983.15,23.7,6.6,0.23,0.18);
}

function secretariat(g, m, b) {
  const x = b.cx, z = b.cz, w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  g.box(m.stone, x, 0, z, w, 5.6, d);
  g.box(m.unGlass, x, 5.6, z, w - 0.68, b.height - 6.4, d - 0.33);
  for (const s of [-1,1]) {
    g.box(m.unMarble, x, 5.6, z + s * d / 2, w, b.height - 5.6, 0.41);
    for (const end of [-1,1]) g.box(m.unMarble, x + s * (w / 2 - 0.25), 5.6, z + end * (d / 2 - 0.63), 0.48, b.height - 5.6, 1.25);
    g.box(m.trim, x + s * w / 2, 4.8, z, 0.53, 0.9, d + 0.7);
    for (const h of [33.7, 68.4, 105.9, 142.3]) g.box(m.roof, x + s * (w / 2 - 0.11), h, z, 0.22, 1.22, d - 0.3);
  }
  g.box(m.trim, x, b.height - 0.85, z, w + 0.42, 0.85, d + 0.31);
}

function assembly(g, m) {
  // The survey records the connected Assembly and Conference wings as one footprint.
  const points = [[-300,13],[-274,18.9],[-242,22.4],[-213,23.1],[-182,20.8],[-151,14.2]];
  const side = new THREE.Shape();
  side.moveTo(points[0][0], 0.3);
  for (const [z,y] of points) side.lineTo(z,y);
  side.lineTo(points.at(-1)[0], 0.3); side.closePath();
  const geo = new THREE.ExtrudeGeometry(side, { depth: 67.5, bevelEnabled: false });
  g.batch.add(m.unMarble, geo.rotateY(-Math.PI / 2).translate(1198.9, 0, 0));
  for (let i = 1; i < points.length; i++) {
    const [az, ay] = points[i - 1], [bz, by] = points[i];
    const d = Math.hypot(bz - az, by - ay);
    const ledge = new THREE.BoxGeometry(69.4, 0.51, d + 0.08)
      .rotateX(-Math.atan2(by - ay, bz - az)).translate(1165.15, (ay + by) / 2, (az + bz) / 2);
    g.batch.add(m.unMarble, ledge);
  }
  g.dome(m.patina, 1168, 22.86, -223, 10.9, 3.65, 0.9);
  g.box(m.unMarble, 1160, 0, -287.3, 109, 9.7, 24.2);
  g.box(m.lobby, 1130.6, 0.53, -282, 0.45, 8.2, 22);
  g.box(m.unMarble, 1225.4, 0, -140.4, 50.5, 8.7, 136.8);
  g.box(m.lobby, 1225.4, 8.7, -140.4, 49.6, 9.2, 136.3);
  g.box(m.unMarble, 1225.4, 17.9, -140.4, 51, 1.3, 137.4);
}

function buildManhattanArchitecture(scene, buildings) {
  const m = {
    stone: createDressedStoneMaterial(), trim: standard(0xc1b79f), brick: standard(0x785747), dome: standard(0xa7a393),
    concrete: standard(0xa49c86), bronze: standard(0x605948, 0.46, 0.58), roof: standard(0x495253),
    lobby: createLobbyGlassMaterial(), unMarble: standard(0xc3c1b5), patina: standard(0x526660, 0.69, 0.22),
    unGlass: createCurtainWallMaterial({ glassTint: 0x3a6a65, frameTint: 0x596865, floorHeight: 3.84, windowWidth: 1.48,
      mullionThickness: 0.048, spandrelRatio: 0.27, seed: 28 })
  };
  const colliders = [];
  for (const { type, record } of buildings) {
    const g = createArchitecture(scene, type);
    if (type === 'lowLibrary' || type === 'butlerLibrary') campusLibrary(g, m, record, type === 'lowLibrary');
    if (type === 'murphyCenter') asphaltPlant(g, m, record);
    if (type === 'secretariat') secretariat(g, m, record);
    if (type === 'assembly') assembly(g, m);
    for (const p of record.polygons) colliders.push({ ...groundFootprint(p.outer), polygon: p, minY: 0, maxY: record.height });
    g.finish();
  }
  return colliders;
}

export { buildManhattanArchitecture };
