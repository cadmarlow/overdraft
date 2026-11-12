import * as THREE from 'three/webgpu';
import { createDistrictBatch, standard } from './district-geometry.js';
import { createDressedStoneMaterial, createLobbyGlassMaterial } from './tsl-materials.js';
import { groundFootprint } from './ground-surfaces.js';
import { lincolnPoint } from './urban-places-plan.js';

function entranceLettering(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#262321';
  ctx.fillRect(0, 0, 1024, 96);
  ctx.fillStyle = '#e3d5b9';
  ctx.textAlign = 'center';
  ctx.font = '500 52px sans-serif';
  ctx.fillText(name, 512, 67);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardNodeMaterial({ map, roughness: 0.74 });
}

function buildLincolnTheatres(scene, theatres) {
  const batch = createDistrictBatch('Lincoln Center · Opéra et salles de spectacle');
  const stone = createDressedStoneMaterial();
  const pale = standard(0xd3c5ac);
  const roof = standard(0x46494a);
  const frame = standard(0x4c4540, 0.48, 0.28);
  const glass = createLobbyGlassMaterial();
  const curtain = standard(0x853e36);
  const door = standard(0x23363d, 0.3, 0.25);
  const brass = standard(0x8c6f46, 0.36, 0.51);
  const plaster = standard(0xb9a68e);
  const colliders = [];
  const block = (mat, x, y, z, w, h, d) =>
    batch.add(mat, new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z));

  for (const { site, record } of theatres) {
    const opera = site.type === 'opera';
    const hall = site.type === 'geffen';
    const [left, right] = site.span;
    const isNorth = site.face === 'north';
    const angle = opera ? Math.PI / 2 : isNorth ? Math.PI : 0;
    const center = opera ? (record.minZ + record.maxZ) / 2 : (record.minX + record.maxX) / 2;
    const width = right - left;
    const gallery = opera ? 27.6 : hall ? 19.7 : 23.2;
    const base = site.podium;
    const outer = opera ? lincolnPoint(site.outer, 0).x : lincolnPoint(0, site.outer).z;
    const inner = opera ? lincolnPoint(site.inner, 0).x : lincolnPoint(0, site.inner).z;
    const front = (mat, u, y, depth, w, h, d) => {
      const geometry = new THREE.BoxGeometry(w, h, d).translate(u, y + h / 2, depth).rotateY(angle);
      batch.add(mat, geometry.translate(opera ? outer : center, 0, opera ? center : outer));
    };
    for (const p of record.polygons) {
      colliders.push({ ...groundFootprint(p.outer), polygon: p, minY: 0, maxY: record.height });
    }

    const x0 = record.minX + 0.12, x1 = opera ? inner - 1.2 : record.maxX - 0.12;
    const z0 = isNorth ? inner + 1.2 : record.minZ + 0.12;
    const z1 = hall ? inner - 1.2 : record.maxZ - 0.12;
    const spanX = x1 - x0, spanZ = z1 - z0, x = (x0 + x1) / 2, z = (z0 + z1) / 2;
    block(stone, x, 0, z, spanX, gallery + 1.8, spanZ);
    block(pale, x, gallery + 1.8, z, spanX + 0.26, 0.52, spanZ + 0.26);
    block(roof, x, gallery + 2.32, z, spanX - 0.35, 0.18, spanZ - 0.35);
    block(stone, x - (opera ? 13 : 0), gallery + 2.32, z, spanX * (opera ? 0.56 : 0.78),
      record.height - gallery - 2.32, spanZ * 0.82);
    for (const side of [-1, 1]) {
      const length = opera ? spanX : spanZ;
      const modules = Math.floor(length / 5.6);
      for (let i = 0; i < modules; i++) {
        const shift = (i - (modules - 1) / 2) * 5.6;
        if (opera) {
          block(pale, x + shift, 1.3, z + side * spanZ / 2, 0.24, gallery - 1.7, 0.28);
        } else {
          block(pale, x + side * spanX / 2, 1.3, z + shift, 0.28, gallery - 1.7, 0.24);
        }
      }
      front(stone, side * (width / 2 - 0.32), base, -2.5, 0.64, gallery - base, 5);
    }
    front(glass, 0, base + 0.32, -4.65, width - 0.45, gallery - base - 0.62, 0.16);
    front(stone, 0, 0, -2.5, width, base, 5.25);
    front(pale, 0, gallery, -2.75, width + 1.3, 1.8, 6.45);
    const entrance = opera ? 'METROPOLITAN OPERA' : hall ? 'DAVID GEFFEN HALL' : 'DAVID H. KOCH THEATER';
    const signWidth = opera ? 15.3 : 13.2;
    const sign = new THREE.PlaneGeometry(signWidth, 0.92)
      .translate(0, base + 4.04, -4.29).rotateY(angle)
      .translate(opera ? outer : center, 0, opera ? center : outer);
    batch.add(entranceLettering(entrance), sign, false);
    for (let i = -4; i <= 4; i++) {
      const u = i * (opera ? 5.45 : 5.05);
      front(frame, u, base + 0.09, -4.38, 2.58, 3.12, 0.17);
      front(door, u - 0.61, base + 0.17, -4.27, 1.12, 2.92, 0.11);
      front(door, u + 0.61, base + 0.17, -4.27, 1.12, 2.92, 0.11);
      front(brass, u, base + 1.16, -4.16, 1.55, 0.067, 0.11);
      front(frame, u, base + 3.09, -4.22, 2.62, 0.19, 0.19);
    }

    if (opera) {
      const panel = new THREE.Shape();
      panel.moveTo(-width / 2, base); panel.lineTo(width / 2, base);
      panel.lineTo(width / 2, gallery); panel.lineTo(-width / 2, gallery); panel.closePath();
      for (let i = -2; i <= 2; i++) {
        const u = i * 10.9, radius = 4.7, spring = 21.35;
        const arch = new THREE.Path();
        arch.moveTo(u - radius, base + 0.025); arch.lineTo(u - radius, spring);
        arch.absarc(u, spring, radius, Math.PI, 0, true);
        arch.lineTo(u + radius, base + 0.025); arch.closePath();
        panel.holes.push(arch);
        for (const side of [-1, 1]) front(curtain, u + side * 3.3, 6.2, -4.49, 1.2, 14.4, 0.13);
        for (const v of [-1.95, 0, 1.95]) front(frame, u + v, base + 0.22, -4.44, 0.085, 20.7, 0.11);
      }
      batch.add(stone, new THREE.ExtrudeGeometry(panel, { depth: 1.05, bevelEnabled: false, curveSegments: 12 })
        .rotateY(angle).translate(outer - 1.06, 0, center));
      for (const y of [4.65, 10.45, 16.25, 22.05]) front(frame, 0, y, -4.43, width, 0.12, 0.14);
    } else {
      const bays = hall ? 12 : 10;
      for (let i = 0; i <= bays; i++) {
        const u = (i / bays - 0.5) * (width - 0.48);
        front(hall ? pale : plaster, u, base, -0.52, hall ? 0.47 : 0.69, gallery - base, hall ? 1.23 : 1.58);
        front(frame, u, base + 0.18, -4.48, 0.11, gallery - base - 0.2, 0.21);
      }
      for (const y of hall ? [5.1, 9.7, 14.3] : [5.5, 10.9, 16.1, 20.8]) front(frame, 0, y, -4.46, width, 0.19, 0.2);
      front(pale, 0, gallery - 1.1, -0.4, width + 0.7, 0.22, 1.9);
      front(hall ? frame : plaster, 0, base + 4.66, -2.27, width - 0.2, hall ? 0.33 : 0.58, 4.55);
      front(hall ? brass : pale, 0, base + 4.82, 0.02, width - 0.1, 0.07, 0.12);
    }
  }
  batch.finish(scene);
  return colliders;
}

export { buildLincolnTheatres };
