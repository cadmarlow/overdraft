import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, mix, positionWorld, sin, smoothstep } from 'three/tsl';
import { cityUniforms, createDressedStoneMaterial, createMarbleAshlarMaterial } from './tsl-materials.js';
import { groundFootprint } from './ground-surfaces.js';
import { AMSTERDAM, WEST_111 } from './morningside-plan.js';

const standard = (color, roughness = 0.82, metalness = 0) =>
  new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });

function stonePlan(polygon) {
  const points = ring => ring.map(p => new THREE.Vector2(p.x, -p.z));
  const shape = new THREE.Shape(points(polygon.outer));
  for (const hole of polygon.holes) shape.holes.push(new THREE.Path(points(hole)));
  return shape;
}

function pointed(width, height) {
  const r = width / 2;
  const spring = height - width * 0.78;
  const s = new THREE.Shape();
  s.moveTo(-r, 0);
  s.lineTo(r, 0);
  s.lineTo(r, spring);
  s.quadraticCurveTo(r, height - width * 0.29, 0, height);
  s.quadraticCurveTo(-r, height - width * 0.29, -r, spring);
  s.closePath();
  return s;
}

function archRing(width, height, trim) {
  const outer = pointed(width, height);
  const inner = pointed(width - trim * 2, height - trim * 2.15);
  outer.holes.push(new THREE.Path(inner.getPoints(12).map(p => new THREE.Vector2(p.x, p.y + trim))));
  return outer;
}

function buildMorningsideCathedral(scene, record) {
  const group = new THREE.Group();
  group.name = 'Cathédrale de Morningside';
  group.position.set(AMSTERDAM, 0.23, WEST_111);
  const colliders = [];
  const stone = createDressedStoneMaterial();
  const trim = createMarbleAshlarMaterial();
  const stoneVein = sin(positionWorld.x.mul(0.29).add(positionWorld.z.mul(0.22))).mul(0.06).add(0.94);
  stone.colorNode = stone.colorNode.mul(stoneVein).mul(mix(color(0xc7bdac), color(0xe8e3d8), smoothstep(1.0, 17.0, positionWorld.y)));
  const dark = standard(0x363634);
  const slate = standard(0x4a535b, 0.72);
  const lead = standard(0x292e31, 0.52, 0.24);
  const door = standard(0x3c3024, 0.72);
  const doorMoulding = standard(0x56402c, 0.64);
  const doorMetal = standard(0x695945, 0.48, 0.64);
  const stained = [0x34436b, 0x404b68, 0x683d47, 0x87734a].map(c => {
    const mat = standard(c, 0.53);
    mat.emissiveNode = color(c).mul(smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow)).mul(0.85);
    return mat;
  });
  const buckets = new Map();

  function add(mat, geo) {
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
  }
  function box(mat, x, y, z, w, h, d) {
    add(mat, new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z));
  }
  function cylinder(mat, x, y, z, r0, r1, h, sides = 8) {
    add(mat, new THREE.CylinderGeometry(r0, r1, h, sides).translate(x, y + h / 2, z));
  }
  function shape(mat, outline, x, y, z, depth, rot) {
    const g = new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: false, curveSegments: 10 });
    add(mat, g.rotateY(rot).translate(x, y, z));
  }
  function bar(mat, a, b, radius) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const vector = to.sub(from);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.clone().normalize());
    add(mat, new THREE.CylinderGeometry(radius, radius, vector.length(), 5).applyQuaternion(q).translate(...from.addScaledVector(vector, 0.5).toArray()));
  }
  function solid(x0, x1, z0, z1, bottom, top) {
    const polygon = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
      .map(([x,z]) => ({ x: x + AMSTERDAM, z: z + WEST_111 }));
    colliders.push({ ...groundFootprint(polygon), minY: bottom + 0.23, maxY: top + 0.23, roof: true });
  }
  function ridge(x0, x1, z, w, base, rise) {
    const outline = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rise)]);
    shape(slate, outline, x1, base, z, x1 - x0, -Math.PI / 2);
    bar(lead, [x0, base + rise, z], [x1, base + rise, z], 0.13);
    for (let q = x0 + 2; q < x1 - 1; q += 2.15) {
      for (const side of [-1, 1]) bar(lead, [q, base + rise, z], [q, base + 0.07, z + side * w / 2], 0.036);
    }
  }

  // The low masonry envelope follows the city survey, including the porches and the ambulatory.
  for (const polygon of record.polygons) {
    const local = ring => ring.map(p => ({ x: p.x - AMSTERDAM, z: p.z - WEST_111 }));
    const survey = { outer: local(polygon.outer), holes: polygon.holes.map(local) };
    add(stone, new THREE.ExtrudeGeometry(stonePlan(survey), { depth: 13.8, bevelEnabled: false }).rotateX(-Math.PI / 2));
    colliders.push({ ...groundFootprint(polygon.outer), polygon, minY: 0, maxY: 14.03, roof: true });
  }

  // Nave and its two aisles, transept and octagonal crossing.
  box(stone, 76, 11.5, -83, 87, 18.2, 26.8);
  solid(32.5, 119.5, -96.4, -69.6, 13.8, 29.7);
  ridge(33, 119, -83, 27.3, 29.4, 9.7);
  for (const side of [-1, 1]) {
    const z = -83 + side * 17.1;
    box(stone, 74, 11.6, z, 81.6, 2.8, 11.4);
    ridge(34, 114, z, 12.5, 14.2, 3);
    box(trim, 73, 13.6, -83 + side * 23.3, 78, 0.48, 0.55);
  }
  box(stone, 134, 12, -85, 29.5, 15.3, 65);
  solid(119.25, 148.75, -117.5, -52.5, 13.8, 27.3);
  const transeptRoof = new THREE.Shape([new THREE.Vector2(-15.1, 0), new THREE.Vector2(15.1, 0), new THREE.Vector2(0, 10.1)]);
  shape(slate, transeptRoof, 134, 27.2, -117.5, 65, 0);
  cylinder(stone, 132, 29.8, -84, 15.0, 16.0, 11.5, 8);
  cylinder(slate, 132, 41.3, -84, 7.8, 15.05, 7.8, 8);
  cylinder(lead, 132, 49.1, -84, 7.6, 7.9, 0.65, 8);

  box(stone, 163, 11.5, -82, 39, 18, 31);
  solid(143.5, 182.5, -97.5, -66.5, 13.8, 29.5);
  ridge(144, 181, -82, 31.5, 29.4, 8.8);
  cylinder(stone, 184, 10, -82, 17.1, 17.8, 18.5, 12);
  cylinder(slate, 184, 28.5, -82, 0.6, 17.3, 10.0, 12);
  const apse = new THREE.CircleGeometry(17.5, 12).attributes.position;
  const ring = [];
  for (let i = 1; i < apse.count - 1; i++) ring.push({ x: AMSTERDAM + 184 + apse.getX(i), z: WEST_111 - 82 + apse.getY(i) });
  colliders.push({ ...groundFootprint(ring), minY: 10, maxY: 28.73, roof: true });

  // Vertical jambs, leaded glazing, sill and deep dressed-stone surrounds.
  function lancet(x, y, z, w, h, rot, glazing = stained[0]) {
    shape(dark, pointed(w * 1.02, h), x, y, z, 0.035, rot);
    const nx = Math.sin(rot), nz = Math.cos(rot);
    shape(glazing, pointed(w * 0.76, h - 0.35), x + nx * 0.08, y + 0.13, z + nz * 0.08, 0.04, rot);
    shape(trim, archRing(w + 0.35, h + 0.29, 0.21), x + nx * 0.06, y - 0.12, z + nz * 0.06, 0.16, rot);
    for (const t of [0.28, 0.54, 0.72]) {
      const hw = w * 0.39 * (t < 0.65 ? 1 : 0.72);
      bar(lead, [x - nz * hw + nx * 0.15, y + h * t, z + nx * hw + nz * 0.15],
        [x + nz * hw + nx * 0.15, y + h * t, z - nx * hw + nz * 0.15], 0.042);
    }
    bar(lead, [x + nx * 0.15, y + 0.2, z + nz * 0.15], [x + nx * 0.15, y + h - 0.25, z + nz * 0.15], 0.062);
  }

  for (const side of [-1, 1]) {
    const rot = side > 0 ? 0 : Math.PI;
    for (let i = 0; i < 8; i++) {
      const x = 42 + i * 9.35, highZ = -83 + side * 13.45;
      lancet(x - 0.87, 20.8, highZ, 1.35, 6.8, rot, stained[i % 3]);
      lancet(x + 0.87, 20.8, highZ, 1.35, 6.8, rot, stained[i % 3]);
      const lowZ = -83 + side * 23.05;
      // The north and south aisles share the same bays, offset to leave the flying piers clear.
      lancet(x, 5.1, lowZ, 2.4, 6.2, rot, stained[(i + 1) % 3]);
      const pierX = x + 4.7, pierZ = -83 + side * 24.9;
      box(stone, pierX, 0, pierZ, 2.1, 15.4, 2.6);
      box(trim, pierX, 0.3, pierZ, 2.5, 0.58, 3);
      box(trim, pierX, 11.8, pierZ, 2.35, 0.26, 2.94);
      cylinder(stone, pierX, 15.1, pierZ, 0.54, 0.81, 2.8, 4);
      cylinder(trim, pierX, 17.8, pierZ, 0.06, 0.84, 1.85, 4);
      const a = new THREE.Shape();
      a.moveTo(0, 13.7); a.lineTo(0, 16.0);
      a.bezierCurveTo(4.5, 17, 8.6, 21.5, 11.8, 25.1);
      a.lineTo(11.8, 23.2);
      a.bezierCurveTo(7.1, 21.5, 3.5, 16.4, 0, 13.7);
      a.closePath();
      shape(stone, a, pierX - side * 0.48, 0, pierZ, 0.96, side * Math.PI / 2);
      solid(pierX - 1.05, pierX + 1.05, pierZ - 1.3, pierZ + 1.3, 0, 15.4);
    }
    const endZ = -85 + side * 32.52;
    for (const x of [128, 134, 140]) lancet(x, 12.4, endZ, 3.6, x === 134 ? 12.4 : 10.2, rot, stained[2]);
    for (const x of [119.4, 148.6]) box(trim, x, 8, endZ, 1.1, 23.5, 1.3);
  }

  // West front: unequal unfinished towers, rose and three deeply moulded entrances.
  box(stone, 32.8, 0, -83.5, 5.5, 31, 38.2);
  solid(30.05, 35.55, -102.6, -64.4, 0, 31);
  const frontGable = new THREE.Shape([new THREE.Vector2(-14, 0), new THREE.Vector2(14, 0), new THREE.Vector2(0, 10)]);
  shape(stone, frontGable, 34, 29.5, -83.5, 4.1, -Math.PI / 2);
  for (const [z, h] of [[-102.1, 49.5], [-64.8, 42.6]]) {
    box(stone, 36.6, 0, z, 13.8, h, 11.7);
    solid(29.7, 43.5, z - 5.85, z + 5.85, 0, h);
    for (const y of [4, 13.2, 24.8, 35.1, h - 0.5]) box(trim, 36.6, y, z, 14.4, 0.48, 12.3);
    for (const dz of [-4.65, 4.65]) {
      box(stone, 29.55, 0.2, z + dz, 2.1, h - 1.6, 1.84);
      box(trim, 29.55, h - 1.6, z + dz, 2.35, 0.32, 2.12);
      cylinder(trim, 29.55, h - 1.27, z + dz, 0.12, 0.76, 1.65, 4);
    }
    for (const dz of [-1.76, 1.76]) {
      lancet(29.62, 15.4, z + dz, 2.15, 7.8, -Math.PI / 2);
      lancet(29.62, 27, z + dz, 2.15, 6.5, -Math.PI / 2);
      lancet(29.62, 36.4, z + dz, 1.87, h - 38.1, -Math.PI / 2, dark);
    }
    for (let i = 0; i < 5; i++) box(trim, 29.8, h - 0.06, z - 4.8 + i * 2.4, 1.04, 0.9, 1.06);
  }
  for (const [z, w, h] of [[-94.7, 4.9, 9.4], [-83.5, 7.4, 12.1], [-72.4, 4.9, 9.4]]) {
    shape(dark, pointed(w, h), 30.0, 1.43, z, 0.13, -Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      shape(i % 2 ? stone : trim, archRing(w + 0.9 + i * 0.7, h + 1.5 + i * 0.58, 0.33), 29.94 - i * 0.28, 1.12 - i * 0.12, z, 0.26, -Math.PI / 2);
    }
    box(door, 29.8, 1.45, z, 0.17, 3.6, w * 0.58);
    box(trim, 29.67, 5.05, z, 0.32, 0.19, w * 0.63);
    box(lead, 29.69, 1.48, z, 0.13, 3.56, 0.1);
    for (const sign of [-1, 1]) {
      const middle = z + sign * w * 0.145, panel = w * 0.239;
      for (const [y, height] of [[1.68, 0.83], [2.69, 0.85], [3.72, 1.09]]) {
        box(doorMoulding, 29.674, y, middle, 0.1, height, panel);
        box(door, 29.608, y + 0.084, middle, 0.064, height - 0.168, panel - 0.155);
        box(doorMoulding, 29.581, y + 0.15, middle, 0.022, height - 0.30, panel - 0.30);
        for (const offset of [-1, 1]) {
          const hinge = middle + offset * (panel / 2 - 0.07);
          box(doorMetal, 29.564, y + 0.042, hinge, 0.035, 0.085, 0.085);
        }
      }
      const handleZ = z + sign * 0.19;
      add(doorMetal, new THREE.TorusGeometry(0.102, 0.022, 6, 12).rotateY(-Math.PI / 2).translate(29.57, 2.83, handleZ));
      add(doorMetal, new THREE.SphereGeometry(0.056, 8, 6).translate(29.59, 2.93, handleZ));
    }
    for (const dz of [-w * 0.38, w * 0.38]) cylinder(trim, 28.98, 1.52, z + dz, 0.14, 0.2, h * 0.58, 8);
    // Carved tympanum in three tiers, with small hooded figures sheltered under the archivolts.
    for (let row = 0; row < 3; row++) {
      const n = 5 - row * 2, step = w * 0.13, y = 5.26 + row * (h - 4.9) * 0.23;
      box(stone, 29.82, y - 0.08, z, 0.38, 0.13, step * n + 0.32);
      for (let i = 0; i < n; i++) {
        const pz = z + (i - (n - 1) / 2) * step;
        shape(stone, pointed(step * 0.86, 0.89), 29.74, y, pz, 0.25, -Math.PI / 2);
        cylinder(trim, 29.34, y + 0.08, pz, 0.095, 0.16, 0.48, 6);
        add(trim, new THREE.SphereGeometry(0.11, 7, 5).translate(29.32, y + 0.66, pz));
      }
    }
  }
  box(trim, 29.86, 15.28, -83.5, 0.85, 0.52, 31);
  box(trim, 29.86, 27.5, -83.5, 0.82, 0.54, 31);
  for (let i = 0; i < 13; i++) lancet(29.93, 28.55, -95.6 + i * 2.02, 1.18, 2.36, -Math.PI / 2, dark);

  const rose = { x: 29.98, y: 21.7, z: -83.5, r: 5.48 };
  function roseRing(y, z, r, t, mat, x = 29.56) {
    add(mat, new THREE.TorusGeometry(r, t, 6, 48).rotateY(-Math.PI / 2).translate(x, y, z));
  }
  add(dark, new THREE.CircleGeometry(rose.r + 0.33, 56).rotateY(-Math.PI / 2).translate(rose.x, rose.y, rose.z));
  roseRing(rose.y, rose.z, rose.r + 0.33, 0.23, trim);
  shape(stone, archRing(15.4, 17.5, 0.47), 29.84, 14.45, rose.z, 0.21, -Math.PI / 2);
  roseRing(rose.y, rose.z, rose.r - 0.13, 0.11, stone);
  roseRing(rose.y, rose.z, 2.02, 0.11, trim);
  roseRing(rose.y, rose.z, 0.86, 0.12, trim);
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6, c = Math.cos(angle), s = Math.sin(angle);
    for (const [r, petal] of [[3.63, 0.98], [1.41, 0.37]]) {
      const y = rose.y + c * r, z = rose.z + s * r;
      add(stained[i % stained.length], new THREE.CircleGeometry(petal, 16).rotateY(-Math.PI / 2).translate(29.62, y, z));
      roseRing(y, z, petal, 0.105, trim, 29.57);
    }
    bar(trim, [29.56, rose.y + c * 2, rose.z + s * 2], [29.56, rose.y + c * 5.37, rose.z + s * 5.37], 0.068);
  }
  box(trim, 30.5, 39.45, -83.5, 0.3, 2.4, 0.34);
  box(trim, 30.5, 40.54, -83.5, 0.3, 0.3, 1.8);

  for (const [mat, geos] of buckets) {
    const unindexed = geos.map(g => g.index ? g.toNonIndexed() : g);
    const mesh = new THREE.Mesh(mergeGeometries(unindexed), mat);
    mesh.castShadow = mat === stone || mat === trim || mat === slate;
    mesh.receiveShadow = true;
    group.add(mesh);
    for (const g of new Set([...geos, ...unindexed])) g.dispose();
  }
  scene.add(group);
  group.updateMatrixWorld(true);
  return colliders;
}

export { buildMorningsideCathedral };
