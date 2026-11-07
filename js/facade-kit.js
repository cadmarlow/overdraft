// Window dressings in 3D near the camera: stone sills and lintels standing proud of the wall, the pressed-metal or
// brownstone hoods over the windows of walk-ups and row houses, keystones over arches, and window air conditioners.
// They sit on the very openings the facade shader draws (same piers, bays, storeys and proportions, see facadeCell
// and createPreWarBuildingMaterial in tsl-materials.js), catch the sun and cast their shadows; further out the shader
// paints the sills and air conditioners itself (uFacadeKit).
import * as THREE from 'three/webgpu';
import { Fn, vec3, float, positionGeometry, normalGeometry, abs, fract, sin, step, smoothstep, mix, max } from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';
import { WINDOW, FLAG, linear, windowsOf } from './building-types.js';

const CELL = 64;
const RESTREAM = 8;
const POOL = { stone: 70000, hood: 30000, ac: 8000 };
const HOODED = new Set(['rowhouse', 'tenement']);
const LINTELED = new Set(['prewar', 'commercial', 'civic', 'loft']);
const METAL_SILLS = new Set(['postwar', 'contemporary', 'utility']);
const AC_COLOURS = [0xe8e6e0, 0xdcd8ce, 0xc8c4ba, 0xb8b4aa, 0xe4e0d4].map(linear);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The dressings of one building as instance matrices and colours, made once and kept
function dressingsOf(record) {
  const s = record.style;
  const rand = mulberry32(Math.round(record.cx * 7 + record.cz * 13) ^ 0x68e31da4);
  const pieces = { stone: [], hood: [], ac: [] };
  const trim = linear(s.trim), cornice = linear(s.corniceColour ?? s.trim);
  const metalHoods = s.type === 'tenement' && rand() < 0.55;
  const acShare = s.flags & FLAG.ac ? 0.15 : 0.03;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const put = (list, w, x, y, z, sx, sy, sz, out, colour) => {
    // Local +z points out of the wall; the piece's back sits `out` metres in front of it minus its depth
    q.setFromAxisAngle(up, Math.atan2(w.nx, w.nz));
    p.set(x + w.nx * out, y, z + w.nz * out);
    m.compose(p, q, sc.set(sx, sy, sz));
    list.push(m.elements.slice(), colour);
  };
  // The base and belt courses are real mouldings at street range. Their two lips shade the wall and catch a fine
  // highlight along the avenue; their height agrees with the distant facade shader's painted courses.
  if (!METAL_SILLS.has(s.type)) for (const wall of record.kitWalls) {
    const cx = (wall.ax + wall.bx) / 2, cz = (wall.az + wall.bz) / 2;
    for (let floor = 1; floor * s.floor < wall.top - 0.4; floor++) {
      const base = floor === s.baseFloors || floor === 1;
      const belt = s.belt > 0 && floor > s.baseFloors && (floor - s.baseFloors) % s.belt === 0;
      const y = floor * s.floor - 0.12;
      if ((!base && !belt) || y < wall.bottom + 0.4) continue;
      put(pieces.stone, wall, cx, y, cz, wall.width, 0.18, 0.28, 0.10, trim);
      put(pieces.stone, wall, cx, y - 0.14, cz, wall.width, 0.10, 0.16, 0.04, trim);
    }
  }
  for (const w of windowsOf(record)) {
    const arched = s.window === WINDOW.arched;
    // Sills: a stone ledge (a thin metal one on later buildings) a little wider than the opening
    if (METAL_SILLS.has(s.type)) put(pieces.stone, w, w.x, w.y0 - 0.015, w.z, w.width + 0.04, 0.03, 0.07, 0.025, [0.42, 0.43, 0.44]);
    else put(pieces.stone, w, w.x, w.y0 - 0.045, w.z, w.width + 0.18, 0.09, 0.14, 0.06, trim);
    // Dressed surrounds make an opening read as a hole through a thick wall, with a lit jamb, a shadowed jamb and a
    // projecting sill. The same survey-derived opening drives the glass shader and these physical stone edges.
    if (!METAL_SILLS.has(s.type) && !w.base) {
      const jamb = s.type === 'loft' ? 0.085 : s.type === 'prewar' || s.type === 'civic' ? 0.16 : 0.10;
      const depth = s.type === 'rowhouse' || s.type === 'prewar' ? 0.22 : 0.16;
      for (const side of [-1, 1]) {
        const dx = side * (w.width + jamb) / 2;
        put(pieces.stone, w, w.x + w.nz * dx, (w.y0 + w.y1) / 2, w.z - w.nx * dx, jamb, w.y1 - w.y0, depth, depth / 2 - 0.015, trim);
      }
    }
    // Heads: hoods on walk-ups and row houses, flat lintels on stone-dressed fronts, keystones over arches
    if (arched && !METAL_SILLS.has(s.type)) {
      put(pieces.stone, w, w.x, w.y1 + 0.07 * s.floor + 0.05, w.z, 0.2, 0.26, 0.08, 0.03, trim);
    } else if (HOODED.has(s.type)) {
      put(pieces.hood, w, w.x, w.y1 + 0.13, w.z, w.width + 0.36, 0.26, 0.3, 0.03, metalHoods ? cornice : trim);
    } else if (LINTELED.has(s.type) && !w.base) {
      put(pieces.stone, w, w.x, w.y1 + 0.075, w.z, w.width + 0.32, 0.15, 0.22, 0.095, trim);
    }
    // Window air conditioners resting on the sill, most of the box hanging outside
    if (!w.base && !w.attic && rand() < acShare) {
      put(pieces.ac, w, w.x + (rand() - 0.5) * w.width * 0.2, w.y0 + 0.23, w.z, Math.min(0.66, w.width * 0.8), 0.42, 0.55, 0.16,
        AC_COLOURS[Math.floor(rand() * AC_COLOURS.length)]);
    }
  }
  return pieces;
}

// Pressed-metal hood: a little cornice of its own (corona and cyma over a bed moulding), extruded along x
function hoodGeometry() {
  const profile = [[0.5, -0.5], [0.2, -0.5], [0.2, -0.3], [-0.1, -0.3], [-0.42, -0.05], [-0.5, -0.05], [-0.5, 0.3], [-0.42, 0.38],
    [-0.42, 0.5], [0.5, 0.5]];
  // Out from the wall is -z in the profile, as the cornice's; extruded, it faces out along local +z like every piece here
  const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(-z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

function createFacadeKit(scene, records, { radius = 160 } = {}) {
  const group = new THREE.Group();
  group.name = 'FacadeKit';
  if (!radius) return { group, update() {} };

  // Stone: fine grain over the instance's own colour
  const stoneMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.02 });
  stoneMat.colorNode = Fn(() => {
    const p = positionGeometry;
    const grain = fract(sin(p.x.mul(37.1).add(p.y.mul(91.7))).mul(43758.5)).mul(0.08);
    return vec3(0.94).add(grain);
  })();
  const hoodMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.12 });
  // Air conditioners: louvred front and sides, a darker grille behind the louvres
  const acMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 });
  acMat.colorNode = Fn(() => {
    const p = positionGeometry, n = normalGeometry;
    const front = step(0.5, n.z);
    const side = step(0.5, abs(n.x));
    const slatCoord = p.y.mul(14.0);
    const slat = smoothstep(0.35, 0.55, fract(slatCoord)).mul(float(1.0).sub(smoothstep(0.75, 0.95, fract(slatCoord))));
    const panel = step(abs(p.x), 0.42).mul(step(abs(p.y.add(0.05)), 0.36));
    const grille = max(front.mul(panel), side.mul(step(abs(p.z.add(0.1)), 0.3)).mul(step(abs(p.y), 0.38)));
    return mix(vec3(1.0), vec3(0.42), grille.mul(slat.mul(0.7).add(0.3)));
  })();
  const pool = (geometry, material, count) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.count = 0;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };
  const meshes = {
    stone: pool(new THREE.BoxGeometry(1, 1, 1), stoneMat, POOL.stone),
    hood: pool(hoodGeometry(), hoodMat, POOL.hood),
    ac: pool(new THREE.BoxGeometry(1, 1, 1), acMat, POOL.ac)
  };
  scene.add(group);

  // Buildings by 64 m cell
  const cells = new Map();
  for (const r of records) {
    if (!r.style || r.style.glass || !r.kitWalls) continue;
    const key = Math.floor(r.cx / CELL) + ',' + Math.floor(r.cz / CELL);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(r);
  }
  const built = new Map();
  let lastX = Infinity, lastY = Infinity, lastZ = Infinity;
  cityUniforms.uFacadeKit.value.set(radius - 25, radius);

  function restream(cx, cy, cz) {
    const counts = { stone: 0, hood: 0, ac: 0 };
    const reach = radius + 30;
    const near = [];
    for (let x = Math.floor((cx - reach) / CELL); x <= Math.floor((cx + reach) / CELL); x++) {
      for (let z = Math.floor((cz - reach) / CELL); z <= Math.floor((cz + reach) / CELL); z++) {
        for (const r of cells.get(x + ',' + z) || []) {
          const d = Math.hypot(r.cx - cx, r.cz - cz, Math.max(0, cy - r.height - 30));
          if (d < reach) near.push([d, r]);
        }
      }
    }
    // Closest buildings first, so a full pool drops the far ones
    near.sort((a, b) => a[0] - b[0]);
    for (const [, r] of near) {
      let pieces = built.get(r);
      if (!pieces) built.set(r, (pieces = dressingsOf(r)));
      for (const kind of ['stone', 'hood', 'ac']) {
        const list = pieces[kind], mesh = meshes[kind];
        for (let i = 0; i < list.length && counts[kind] < POOL[kind]; i += 2) {
          const matrix = list[i];
          const dx = cx - matrix[12], dy = cy - matrix[13], dz = cz - matrix[14];
          const span = Math.hypot(matrix[0], matrix[2]);
          // A long belt can pass close to the player even when its centre belongs to the far end of the building.
          if (dx * dx + dy * dy + dz * dz > (radius + RESTREAM + (span > 4 ? span / 2 : 0)) ** 2) continue;
          // A building's far side and upper floors must not consume the entire pool from street level. Keep a
          // generous corner margin so their projecting details continue casting into the visible side of the street.
          if (dx * matrix[8] + dz * matrix[10] < -8 * Math.hypot(matrix[8], matrix[10])) continue;
          mesh.instanceMatrix.array.set(matrix, counts[kind] * 16);
          mesh.instanceColor.array.set(list[i + 1], counts[kind] * 3);
          counts[kind]++;
        }
      }
    }
    for (const kind of ['stone', 'hood', 'ac']) {
      const mesh = meshes[kind], n = counts[kind];
      mesh.count = n;
      for (const attribute of [mesh.instanceMatrix, mesh.instanceColor]) {
        attribute.clearUpdateRanges();
        if (n) attribute.addUpdateRange(0, n * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    }
    // A long drive leaves many buildings behind: forget the far ones
    if (built.size > 4000) for (const r of built.keys()) if (Math.hypot(r.cx - cx, r.cz - cz) > reach * 2) built.delete(r);
  }

  function update(camera) {
    const { x, y, z } = camera.position;
    if (Math.hypot(x - lastX, y - lastY, z - lastZ) < RESTREAM) return;
    lastX = x; lastY = y; lastZ = z;
    restream(x, y, z);
  }

  return { group, update, meshes, windowsOf, dressingsOf };
}

export { createFacadeKit, windowsOf, dressingsOf };
