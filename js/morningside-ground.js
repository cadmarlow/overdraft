import * as THREE from 'three/webgpu';
import { finishGeometry, quad, createDistrictBatch, standard, topGeometry } from './district-geometry.js';
import { color, mix, positionWorld, sin, time } from 'three/tsl';
import { outcrop, ribbon } from './park-plan.js';
import { trees } from './tree-assets.js';
import { createGroundLawnMaterial, createGroundRockMaterial } from './park-materials.js';
import { createDressedStoneMaterial, createParkPavingMaterial, createParkWallMaterial } from './tsl-materials.js';
import { groundFootprint } from './ground-surfaces.js';
import { closePoint, closeLawn, fountainSite, closeWalks, gardenFence, closeTrees, closeSeats } from './morningside-plan.js';

const GROUND = 0.235;
const WALK = 0.268;
const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const surface = (points, y) => points.flatMap(p => [p.x, y, p.z]);
const rect = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const local = pts => pts.map(([x, z]) => closePoint(x, z));

function buildCathedralClose(scene, { ground, colliders, addTree, addLamp }) {
  const batch = createDistrictBatch('Jardins et parvis de Morningside');
  const paving = createParkPavingMaterial();
  const lawn = createGroundLawnMaterial();
  const limestone = createDressedStoneMaterial();
  const schist = createParkWallMaterial();
  const iron = standard(0x252c27, 0.52, 0.52);
  const bronze = standard(0x455e51, 0.42, 0.55);
  const earth = standard(0x554637);
  const leaves = new THREE.MeshStandardNodeMaterial({
    map: trees.foliage, side: THREE.DoubleSide, alphaTest: 0.38, alphaToCoverage: true, roughness: 0.87
  });
  leaves.userData.cullDistance = 170;
  const benchWood = standard(0x5f4a35, 0.86);
  const flowers = [0xb27192, 0xa85343, 0xe0b66b, 0x8e72a0, 0xdfd3b2].map(c => standard(c));
  for (const mat of flowers) mat.userData.cullDistance = 95;
  const seats = [];
  const hit = {};

  function floor(points, y, mat, style = 0, grass = false) {
    batch.add(mat, topGeometry(points, y, style), false);
    ground.add(points, y, { curb: false, ...(grass ? { grip: 0.66, rough: 0.018 } : {}) });
  }
  function box(mat, x, y, z, w, h, d, rot = 0) {
    batch.add(mat, new THREE.BoxGeometry(w, h, d).rotateY(rot).translate(x, y + h / 2, z));
  }
  function cylinder(mat, x, y, z, r0, r1, h, sides = 16) {
    batch.add(mat, new THREE.CylinderGeometry(r0, r1, h, sides).translate(x, y + h / 2, z));
  }
  function railVolume(a, b, half, y, h) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = (a.z - b.z) * half / d, nz = (b.x - a.x) * half / d;
    const footprint = groundFootprint([
      { x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz },
      { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }
    ]);
    colliders.push({ ...footprint, minY: y, maxY: y + h, obstacle: 'wall' });
  }
  function fence(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx);
    const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
    box(schist, x, GROUND, z, length, 0.55, 0.49, yaw);
    box(limestone, x, GROUND + 0.55, z, length + 0.04, 0.12, 0.61, yaw);
    for (const y of [0.78, 1.63]) box(iron, x, y, z, length, 0.035, 0.047, yaw);
    const panels = Math.ceil(length / 4.2);
    for (let j = 0; j <= panels; j++) {
      const t = j / panels, px = a.x + dx * t, pz = a.z + dz * t;
      if (j === 0 || j === panels) {
        box(schist, px, GROUND, pz, 0.64, 1.25, 0.64);
        box(limestone, px, 1.49, pz, 0.77, 0.15, 0.77);
        cylinder(limestone, px, 1.64, pz, 0.09, 0.26, 0.25, 6);
      } else {
        box(iron, px, 0.82, pz, 0.09, 1.07, 0.09);
      }
    }
    const bars = Math.ceil(length / 0.22);
    for (let j = 1; j < bars; j++) {
      const t = j / bars, px = a.x + dx * t, pz = a.z + dz * t;
      box(iron, px, 0.86, pz, 0.022, 0.99, 0.023, yaw);
      if (j % 4 === 0) cylinder(iron, px, 1.84, pz, 0, 0.044, 0.11, 4);
    }
    railVolume(a, b, 0.31, GROUND, 1.65);
  }
  function walk(points, width, style) {
    const position = [], index = [];
    const y = WALK + 0.008 + style * 0.003;
    for (const p of ribbon(points.flatMap(v => [v.x, v.z]), width)) {
      const n = position.length / 3;
      position.push(p.left.x, y, p.left.z, p.right.x, y, p.right.z);
      if (n) quad(index, n - 2, n, n + 1, n - 1);
    }
    const geo = finishGeometry(position, index, style);
    if (geo.getAttribute('normal').getY(0) < 0) {
      for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
      geo.setIndex(index);
      geo.computeVertexNormals();
    }
    batch.add(paving, geo, false);
    ground.addTriangles(position, index, { curb: false });
  }
  function ring(x, z, r, n = 32) {
    return Array.from({ length: n }, (_, i) => {
      const a = Math.PI * 2 * i / n;
      return { x: x + r * Math.cos(a), z: z + r * Math.sin(a) };
    });
  }
  function tube(mat, points, r) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    batch.add(mat, new THREE.TubeGeometry(curve, 14, r, 5));
  }

  // The lawn follows the property edge, leaving a continuous public sidewalk on all four sides.
  floor(local(closeLawn), GROUND, lawn, 0, true);
  floor(local([[12.5,-107],[28.6,-108],[31,-61],[14,-61],[12.5,-64]]), WALK, paving, 1);
  floor(local([[15,-64],[24,-64],[28,-60],[23,-53],[15,-53]]), WALK + 0.003, paving, 2);
  floor(local([[138,28],[151,29],[195,28],[226,15],[236,18],[230,31],[201,39],[149,43],[138,39]]), WALK, paving, 0);
  floor(local([[87,40],[96,40],[97,65],[87,65]]), WALK, paving, 0);
  for (const w of closeWalks) walk(local(w.points), w.width, w.stone);
  for (const [a, b] of gardenFence) fence(closePoint(...a), closePoint(...b));

  // Shallow terraces lead directly to the church doors. Each tread also supplies the foot and wheel surface.
  for (let i = 0; i < 8; i++) {
    const x0 = 24.3 + i * 0.53, x1 = x0 + 0.55, y = WALK + (i + 1) * 0.171;
    const a = closePoint(x0, -104.5), b = closePoint(x1, -62.4);
    box(limestone, (a.x + b.x) / 2, GROUND, (a.z + b.z) / 2, 0.55, y - GROUND, b.z - a.z);
    ground.add(rect(a.x, a.z, b.x, b.z), y, { curb: false });
  }
  const stairA = closePoint(28.51, -104.5), stairB = closePoint(30.05, -62.4);
  box(limestone, (stairA.x + stairB.x) / 2, GROUND, (stairA.z + stairB.z) / 2, stairB.x - stairA.x, WALK + 1.368 - GROUND, stairB.z - stairA.z);
  ground.add(rect(stairA.x, stairA.z, stairB.x, stairB.z), WALK + 1.368, { curb: false });
  for (const z of [-105.2, -61.6]) {
    const a = closePoint(24.0, z), b = closePoint(29.5, z);
    box(limestone, (a.x + b.x) / 2, GROUND, a.z, 5.5, 1.56, 0.72);
    railVolume(a, b, 0.36, GROUND, 1.56);
  }

  // Fountain court, framed by an original cast-bronze pair of rising wings.
  const f = fountainSite;
  floor(ring(f.x, f.z, 6.45), WALK + 0.01, paving, 2);
  floor(ring(f.x, f.z, 5.55), WALK + 0.02, paving, 1);
  cylinder(schist, f.x, WALK, f.z, 4.48, 4.48, 0.53, 44);
  batch.add(limestone, new THREE.TorusGeometry(4.35, 0.19, 8, 52).rotateX(-Math.PI / 2).translate(f.x, 0.82, f.z));
  const water = standard(0x3f625b, 0.26, 0.38);
  const phase = positionWorld.x.mul(3.9).add(positionWorld.z.mul(2.4)).add(time.mul(2));
  water.colorNode = mix(color(0x426460), color(0x73928a), sin(phase).mul(0.23).add(0.43));
  water.roughnessNode = sin(phase.mul(2.1)).mul(0.13).add(0.31);
  floor(ring(f.x, f.z, 4.23, 48), 0.805, water);
  cylinder(limestone, f.x, 0.8, f.z, 1.25, 1.35, 0.33, 10);
  cylinder(schist, f.x, 1.13, f.z, 0.76, 1.04, 0.55, 10);
  cylinder(bronze, f.x, 1.68, f.z, 0.39, 0.67, 0.31, 12);
  colliders.push({ ...groundFootprint(ring(f.x, f.z, 4.53)), minY: WALK, maxY: 0.98, obstacle: 'wall' });
  for (const side of [-1, 1]) {
    const wing = new THREE.Shape();
    wing.moveTo(0, 0); wing.bezierCurveTo(side * 0.55, 0.4, side * 1.0, 2.3, side * 2.75, 3.3);
    wing.bezierCurveTo(side * 2.22, 1.1, side * 1.41, 0.15, 0, 0); wing.closePath();
    const geo = new THREE.ExtrudeGeometry(wing, { depth: 0.075, bevelEnabled: true, bevelSize: 0.065, bevelThickness: 0.045, bevelSegments: 1 });
    batch.add(bronze, geo.rotateY(side * 0.45 + 0.12).translate(f.x, 1.9, f.z));
    for (let i = 0; i < 6; i++) {
      const v = i / 6;
      tube(bronze, [[f.x, 1.92, f.z], [f.x + side * (0.71 + v * 0.33), 2.53 + v * 0.65, f.z + side * 0.17],
        [f.x + side * (1.39 + v * 0.95), 2.89 + v * 2.33, f.z - 0.23 + v * 0.5]], 0.052);
    }
  }
  cylinder(bronze, f.x, 1.94, f.z, 0.09, 0.23, 2.61, 9);
  batch.add(bronze, new THREE.SphereGeometry(0.18, 10, 8).translate(f.x, 4.57, f.z));
  const bubble = standard(0x93ada3, 0.28, 0.34);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, dx = Math.cos(a), dz = Math.sin(a);
    tube(bubble, [[f.x + dx * 3.75, 0.81, f.z + dz * 3.75], [f.x + dx * 3.28, 1.35, f.z + dz * 3.28],
      [f.x + dx * 2.62, 1.26, f.z + dz * 2.62], [f.x + dx * 2.12, 0.81, f.z + dz * 2.12]], 0.021);
  }

  // Low mixed borders protect the sightline to the stone front; taller evergreens back the garden walls.
  function plantBed(x, z, rx, rz, salt, hedge = false) {
    const p = closePoint(x, z);
    const edge = ring(p.x, p.z, 1, 20).map(v => ({ x: p.x + (v.x - p.x) * rx, z: p.z + (v.z - p.z) * rz }));
    floor(edge, GROUND + 0.013, earth, 0, true);
    for (let i = 0; i < Math.ceil(rx * rz * 3); i++) {
      const a = i * 2.399963 + salt, t = Math.sqrt((i + 0.5) / Math.ceil(rx * rz * 3));
      const px = p.x + Math.cos(a) * rx * t * 0.92, pz = p.z + Math.sin(a) * rz * t * 0.92;
      const variation = (Math.sin(i * 2.7 + salt) + 1) / 2;
      const h = (hedge ? 0.48 : 0.28) + variation * (hedge ? 0.36 : 0.32);
      for (let j = 0; j < 3; j++) {
        const row = hedge ? 2 : [2, 5, 7][(i + salt) % 3];
        const col = hedge ? 3 : (i + j) % 3;
        const g = new THREE.PlaneGeometry(h * 1.38, h * 1.46, 1, 2);
        const uv = g.getAttribute('uv');
        for (let k = 0; k < uv.count; k++) uv.setXY(k, (col + 0.015 + uv.getX(k) * 0.97) / 4,
          (row + 0.015 + (1 - uv.getY(k)) * 0.97) / 8);
        const turn = a + j * 2.094;
        batch.add(leaves, g.translate(0, h * 0.62, 0).rotateX(0.35 + 0.36 * j).rotateY(turn)
          .translate(px, GROUND - 0.035, pz), false);
      }
      if (!hedge && i % 3 !== 0) {
        for (let j = 0; j < 3; j++) {
          batch.add(flowers[(salt + Math.floor(i / 5)) % flowers.length], new THREE.IcosahedronGeometry(0.045 + variation * 0.033, 0)
            .scale(1, 0.65, 1).translate(px + Math.cos(j * 2.1) * h * 0.26, GROUND + h * (0.89 + j * 0.09), pz + Math.sin(j * 2.1) * h * 0.26));
        }
      }
    }
  }
  [[19,9,2.3,3.2,1],[20,18,2.1,4,2],[18,37,2,4.2,3],[18,48,2.1,4,2],[18,59,2.1,4,6],
    [28,-10,2.5,4,5],[36,5,3.6,1.7,3],[27,23,2.8,1.9,4],[43,19,2.2,3.7,5],[52,-13,3.7,2.4,8],
    [61,-24,4.3,2.1,7],[72,-27,3.3,1.7,6],[78,-8,2.5,1.4,9],[87,-17,2.4,1.7,5],
    [18,-18,2.2,3.5,3],[18,-28,2.1,3,4],[18,-44,2.1,3.7,5],[18,-54,2,4,6],
    [44,61,3.8,2.4,8],[89,44,1.8,3.7,9],[131,14,2,4,4],[142,45,2.8,3.3,4]
  ].forEach((spec, i) => plantBed(...spec, i < 5 || i > 13 && i < 18));

  for (const [x, z, kind, scale] of closeTrees) {
    const p = closePoint(x, z);
    addTree({ ...p, y: GROUND, kind, scale, denseCanopy: true });
  }
  for (const [x, z, yaw] of closeSeats) {
    const p = closePoint(x, z);
    const y = ground.sample(p.x, p.z, hit) ? hit.y : GROUND;
    const part = (mat, x, py, z, w, h, d, rake = 0) => batch.add(mat, new THREE.BoxGeometry(w, h, d)
      .rotateX(rake).translate(x, py, z).rotateY(yaw).translate(p.x, y, p.z));
    for (let i = 0; i < 5; i++) part(benchWood, 0, 0.44, -0.16 + i * 0.084, 1.88, 0.04, 0.075);
    for (let i = 0; i < 4; i++) part(benchWood, 0, 0.55 + i * 0.078, -0.19 - i * 0.014, 1.88, 0.065, 0.036, -0.18);
    for (const x of [-0.81, 0.81]) {
      part(iron, x, 0.25, 0.15, 0.055, 0.49, 0.071, 0.18);
      part(iron, x, 0.42, -0.16, 0.055, 0.85, 0.073, -0.18);
      part(iron, x, 0.62, 0.02, 0.08, 0.047, 0.43);
      part(iron, x, 0.52, 0.21, 0.051, 0.22, 0.047);
    }
    seats.push({ ...p, y, yaw, kind: 'garden' });
    const a = { x: p.x - Math.cos(yaw) * 0.89, z: p.z + Math.sin(yaw) * 0.89 };
    const b = { x: p.x + Math.cos(yaw) * 0.89, z: p.z - Math.sin(yaw) * 0.89 };
    railVolume(a, b, 0.26, y, 0.85);
  }
  for (const [x, z] of [[16,-3.9],[16,26],[24,-19],[19,-46],[19,-64],[19,-103],[42,-12],[72,-4],
    [91,-18],[122,-18],[139,19],[141,50],[171,29],[212,29],[235,21],[17,-140]]) {
    const p = closePoint(x,z);
    addLamp(p.x, ground.sample(p.x, p.z, hit) ? hit.y : GROUND, p.z);
  }

  // French wayfinding is painted into a small reusable canvas at load time.
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#26352c'; ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#bda67c'; ctx.lineWidth = 4; ctx.strokeRect(10, 10, 492, 236);
  ctx.textAlign = 'center'; ctx.fillStyle = '#f1e8d5';
  ctx.font = '35px Georgia, serif'; ctx.fillText('JARDINS DE', 256, 89);
  ctx.font = 'bold 48px Georgia, serif'; ctx.fillText('MORNINGSIDE', 256, 148);
  ctx.font = '26px Georgia, serif'; ctx.fillText('PARVIS  ·  FONTAINE', 256, 207);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.8 });
  const s = closePoint(15.8, 6.1);
  box(iron, s.x, GROUND, s.z, 0.1, 1.58, 0.1);
  box(iron, s.x, 1.31, s.z, 0.12, 0.68, 1.27);
  batch.add(sign, new THREE.PlaneGeometry(1.21, 0.61).rotateY(-Math.PI / 2).translate(s.x - 0.063, 1.65, s.z));
  batch.finish(scene);

  const amsterdam = local([[10.9,-141],[10.9,66]]);
  return [
    { gate: closePoint(12, 0), route: local([[24,0]]), seat: seats[0], sidewalk: amsterdam, entry: closePoint(10.9, -14) },
    { gate: closePoint(11.7, 28), route: local([[25,28],[34,25],[42,23],[44,14],[45,-7],[60,-8]]), seat: seats[4],
      sidewalk: amsterdam, entry: closePoint(10.9, 40) },
    { gate: closePoint(12, -77), route: local([[18,-77],[23,-72],[23,-67]]), seat: seats[8],
      sidewalk: amsterdam, entry: closePoint(10.9, -92) },
    { gate: closePoint(137, 72), route: local([[137,57],[137,27],[139,20]]), seat: seats[10],
      sidewalk: local([[100,72],[164,72]]), entry: closePoint(151, 72) }
  ];
}

// A continuous cross-section joins the road shoulders. The southern ridge is split by eroded rock gullies.
function parkLimits(loop, z) {
  const hits = [];
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[j], b = loop[i];
    if ((a.z > z) === (b.z > z)) continue;
    hits.push(lerp(a.x, b.x, (z - a.z) / (b.z - a.z)));
  }
  if (hits.length < 2) return null;
  return [Math.min(...hits), Math.max(...hits)];
}

function buildMorningsidePark(scene, block, { ground, addTree, addBench, addLamp, colliders }) {
  const batch = createDistrictBatch('Versant de Morningside Park');
  const lawn = createGroundLawnMaterial(), schist = createGroundRockMaterial(GROUND);
  const paving = createParkPavingMaterial(), walls = createParkWallMaterial();
  const rail = standard(0x2b302c, 0.58, 0.53);
  const nosing = standard(0x6e716c, 0.92);
  const south = block.maxZ - 5, north = block.minZ + 5;
  const stairZ = south - 132, stairWidth = 4.2;
  const naturalHeight = (u, z) => {
    const strength = lerp(3.7, 11.4, smooth(south - 530, south - 130, z)) *
      smooth(north, north + 25, z) * (1 - smooth(south - 44, south, z));
    const west = smooth(0.035, 0.185, u);
    const east = 1 - smooth(0.24, 0.52, u);
    const fold = 0.79 + 0.15 * Math.sin(z * 0.055) + 0.07 * Math.cos(z * 0.134 + u * 21);
    const meadow = Math.sin(z * 0.038 + u * 5) ** 2 * smooth(0.52, 0.67, u) * (1 - smooth(0.87, 0.97, u));
    return GROUND + strength * (west * east * fold + meadow * 0.13);
  };
  const upperY = naturalHeight(0.224, stairZ) + 0.27;
  const lowerY = naturalHeight(0.55, stairZ) + 0.12;
  const height = (u, z) => {
    const y = naturalHeight(u, z);
    if (u < 0.224 || u > 0.55 || Math.abs(z - stairZ) >= 7) return y;
    const treadY = lerp(upperY, lowerY, (u - 0.224) / (0.55 - 0.224));
    const blend = 1 - smooth(stairWidth / 2 + 0.8, 7, Math.abs(z - stairZ));
    return lerp(y, Math.min(y, treadY - 0.25), blend);
  };
  const strips = 38, rows = Math.ceil((south - north) / 3.4);
  const position = [], grassIndex = [], rockIndex = [], hit = {};
  function parkPoint(u, z) {
    const [a, b] = parkLimits(block.poly, z);
    return { x: lerp(a + 4.4, b - 4.4, u), z };
  }
  for (let i = 0; i <= rows; i++) {
    const z = lerp(north, south, i / rows);
    for (let j = 0; j <= strips; j++) {
      const u = j / strips, p = parkPoint(u, z);
      position.push(p.x, height(u, z), z);
      if (!i || !j) continue;
      const end = position.length / 3 - 1, left = end - 1, back = end - strips - 1;
      const bare = u > 0.275 && u < 0.50 && z > south - 520 && z < south - 33 &&
        Math.sin(z * 0.049 + u * 14) + Math.cos(z * 0.021) > -0.85;
      quad(bare ? rockIndex : grassIndex, back - 1, left, end, back);
    }
  }
  // Register the exact triangles so the player and the planting both sit on the same hill.
  for (const [index, mat] of [[grassIndex, lawn], [rockIndex, schist]]) {
    batch.add(mat, finishGeometry(position, index, 0), false);
    ground.addTriangles(position, index, { curb: false, grip: mat === lawn ? 0.66 : 0.87, rough: 0.019 });
  }
  const yAt = p => ground.sample(p.x, p.z, hit) ? hit.y : GROUND;
  function path(points, width, style) {
    const positions = [], index = [];
    const sections = ribbon(points.flatMap(v => [v.x, v.z]), width);
    const edge = (a, b, t) => ({ x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) });
    function section(left, right) {
      const n = positions.length / 3;
      for (let i = 0; i <= 4; i++) {
        const p = edge(left, right, i / 4);
        positions.push(p.x, yAt(p) + 0.047, p.z);
      }
      if (n) for (let i = 0; i < 4; i++) quad(index, n - 5 + i, n + i, n + i + 1, n - 4 + i);
    }
    section(sections[0].left, sections[0].right);
    for (let i = 1; i < sections.length; i++) {
      const a = sections[i - 1], b = sections[i], count = Math.ceil((b.s - a.s) / 1.6);
      for (let j = 1; j <= count; j++) section(edge(a.left, b.left, j / count), edge(a.right, b.right, j / count));
    }
    const geo = finishGeometry(positions, index, style);
    if (geo.getAttribute('normal').getY(0) < 0) {
      for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
      geo.setIndex(index);
      geo.computeVertexNormals();
    }
    batch.add(paving, geo, false);
    ground.addTriangles(positions, index, { curb: false });
  }
  const route = (u, from, to, count) => Array.from({ length: count }, (_, i) => {
    const z = lerp(from, to, i / (count - 1));
    return parkPoint(u + Math.sin(z * 0.026) * 0.019, z);
  });
  const high = route(0.205, south - 18, north + 9, 244), low = route(0.70, south - 18, north + 9, 244);
  path(high, 3.2, 2);
  path(low, 4.5, 0);
  for (const z of [south - 16, south - 322, south - 561, north + 53]) {
    const bend = Array.from({ length: 27 }, (_, i) => {
      const t = i / 26;
      return parkPoint(lerp(0.022, 0.975, t), z - Math.sin(t * Math.PI) * 39);
    });
    path(bend, 3.3, 0);
  }

  // Two landings and real granite treads connect the high walk to the low path at the south end.
  const first = parkPoint(0.224, stairZ), last = parkPoint(0.55, stairZ);
  const width = stairWidth, count = Math.ceil((upperY - lowerY) / 0.167) + 1;
  const tread = (last.x - first.x - 3.2) / count;
  const steps = [];
  for (let i = 0; i < count; i++) {
    const offset = i < Math.floor(count / 2) ? 0 : 1.6;
    const x0 = first.x + i * tread + offset;
    const span = tread + (i === Math.floor(count / 2) - 1 || i === count - 1 ? 1.6 : 0);
    const x1 = x0 + span, y = lerp(upperY, lowerY, i / (count - 1));
    batch.add(walls, new THREE.BoxGeometry(span + 0.017, y - GROUND, width).translate((x0 + x1) / 2, (GROUND + y) / 2, stairZ));
    const treadTop = rect(x0 + 0.012, stairZ - width / 2 + 0.025, x1 - 0.013, stairZ + width / 2 - 0.025);
    batch.add(paving, topGeometry(treadTop, y + 0.006, 2), false);
    batch.add(nosing, new THREE.BoxGeometry(0.062, 0.037, width).translate(x1 - 0.019, y - 0.013, stairZ));
    ground.add(rect(x0, stairZ - width / 2, x1, stairZ + width / 2), y, { curb: false });
    steps.push({ x: x0, y });
  }
  steps.push({ x: last.x, y: lowerY });
  for (const sign of [-1, 1]) {
    const z = stairZ + sign * (width / 2 + 0.04);
    for (let i = 0; i < steps.length - 1; i += 3) {
      const a = steps[i], b = steps[Math.min(i + 3, steps.length - 1)];
      const dx = b.x - a.x, dy = b.y - a.y;
      batch.add(rail, new THREE.CylinderGeometry(0.035, 0.035, Math.hypot(dx, dy), 6)
        .rotateZ(Math.atan2(-dx, dy)).translate((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.9, z));
      batch.add(rail, new THREE.CylinderGeometry(0.036, 0.044, 0.9, 6).translate(a.x, a.y + 0.45, z));
      colliders.push({ ...groundFootprint(rect(a.x, z - 0.08, b.x, z + 0.08)),
        minY: b.y, maxY: a.y + 0.94, obstacle: 'wall' });
    }
  }
  const stairsApproach = [
    [parkPoint(0.207, stairZ), first],
    [last, parkPoint(0.70 + Math.sin(stairZ * 0.026) * 0.019, stairZ)]
  ];
  for (const [a, b] of stairsApproach) {
    const sections = Math.max(1, Math.ceil((b.x - a.x) / 2));
    const pts = Array.from({ length: sections + 1 }, (_, i) => ({ x: lerp(a.x, b.x, i / sections), z: stairZ }));
    path(pts, 4.0, 2);
  }

  // The lower promenade meets the Manhattan Avenue sidewalk along a planted approach to the steps.
  const eastZ = stairZ;
  const eastWalk = Array.from({ length: 11 }, (_, i) => parkPoint(lerp(0.70 + Math.sin(eastZ * 0.026) * 0.019, 1, i / 10), eastZ));
  path(eastWalk, 3.8, 2);
  const eastEdge = z => ({ x: parkLimits(block.poly, z)[1] - 2.3, z });
  const eastGate = eastEdge(eastZ);
  const bench = { ...eastWalk[4], z: eastZ + 2.85, yaw: 0, kind: 'garden' };
  bench.y = yAt(bench);
  addBench(bench.x, bench.y, bench.z, bench.yaw);
  addLamp(bench.x + 2.3, yAt({ x: bench.x + 2.3, z: bench.z }), bench.z);

  // Low schist parapets frame an overlook at the head of the stair.
  for (const [from, to] of [[-18, -3.3], [3.3, 18]]) {
    const a = parkPoint(0.226, stairZ + from), b = parkPoint(0.226, stairZ + to);
    const span = Math.hypot(b.x - a.x, b.z - a.z), yaw = Math.atan2(a.z - b.z, b.x - a.x);
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5, x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t), y = yAt({ x, z });
      batch.add(walls, new THREE.BoxGeometry(span / 5 + 0.08, 1.22, 0.59).rotateY(yaw).translate(x, y + 0.35, z));
      batch.add(walls, new THREE.BoxGeometry(span / 5 + 0.05, 0.14, 0.72).rotateY(yaw).translate(x, y + 1, z));
      const near = t - 0.1, far = t + 0.1;
      const x0 = lerp(a.x, b.x, near), z0 = lerp(a.z, b.z, near);
      const x1 = lerp(a.x, b.x, far), z1 = lerp(a.z, b.z, far);
      colliders.push({ ...groundFootprint([{ x: x0 - 0.32, z: z0 }, { x: x1 - 0.32, z: z1 },
        { x: x1 + 0.32, z: z1 }, { x: x0 + 0.32, z: z0 }]), minY: y - 0.3, maxY: y + 1.07, obstacle: 'wall' });
    }
  }

  // Schist noses are exposed between the trail and the ridge, clear of the granite flight.
  for (const [i, offset, u, rx, rz, rise] of [[1, -31, 0.34, 13, 16, 3.6], [2, 37, 0.39, 11, 15, 3.1],
    [3, 66, 0.33, 10, 14, 2.4], [4, -92, 0.36, 18, 22, 3.7], [5, -144, 0.38, 14, 16, 3.1]]) {
    const p = parkPoint(u, stairZ + offset);
    const rock = outcrop({ seed: i * 37, rx, rz, height: rise, rings: 12, segments: 32 });
    const y = yAt(p) - 1.15;
    const geo = finishGeometry(rock.position, Array.from(rock.index), 0).rotateY(i * 0.81).translate(p.x, y, p.z);
    batch.add(schist, geo);
    ground.addTriangles(geo.attributes.position.array, geo.index.array, { curb: false, grip: 0.83, rough: 0.024 });
  }

  for (let i = 0; i < high.length; i += 9) {
    for (const [pts, side] of [[high, -1], [low, 1]]) {
      const p = { x: pts[i].x + side * 3.3, z: pts[i].z };
      const y = yAt(p);
      addLamp(p.x, y, p.z);
      if (i % 18 === 0) {
        const bench = { x: p.x + side * 0.4, z: p.z + 2.4 };
        addBench(bench.x, yAt(bench), bench.z, side * -Math.PI / 2);
      }
    }
  }
  for (let z = north + 15; z < south - 12; z += 11.5) {
    for (let j = 0; j < 6; j++) {
      const jitter = Math.sin(z * 1.38 + j * 6.79);
      const u = [0.11, 0.29, 0.43, 0.56, 0.81, 0.92][j] + 0.028 * jitter;
      const nz = z + 4 * jitter;
      if (Math.abs(nz - stairZ) < 8 || [south - 35, south - 341, south - 580, north + 27].some(v => Math.abs(nz - v) < 8) || jitter < -0.61) continue;
      const p = parkPoint(u, nz);
      const kind = [0, 4, 5, 6, 4, 0][j];
      addTree({ ...p, y: yAt(p), kind, scale: 0.84 + Math.abs(jitter) * 0.47, denseCanopy: true });
    }
  }
  batch.finish(scene);
  return { gate: eastGate, route: eastWalk.slice(4).reverse(), seat: bench,
    sidewalk: [eastEdge(eastZ - 42), eastEdge(eastZ + 32)], entry: eastEdge(eastZ + 17) };
}

export { buildCathedralClose, buildMorningsidePark };
