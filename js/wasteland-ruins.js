import * as THREE from 'three/webgpu';
import { abs, attribute, cameraPosition, float, floor, fract, frontFacing, length, max, mix, normalWorldGeometry, positionWorld, select, sin, smoothstep, step, texture, varying, vec2, vec3 } from 'three/tsl';
import { bumpNormal } from './tsl-materials.js';
import { ground } from './ground-assets.js';
import { saltTints, saltUniforms } from './wasteland-materials.js';
import { fixItem } from './wasteland-scatter.js';
import { STOREY, frameParts, planRuins } from './wasteland-ruins-plan.js';

// The bones of the old city outside the walls (planned in js/wasteland-ruins-plan.js): shells with their windows
// blown through, the floors that are left inside them, and bare frames of columns and slabs open at street level.

// Shells of buildings: windows blown through, a broken skyline, sand banked against the walls. Close by, a window
// is a hole: the far wall, the floors and the sand inside show through it. From afar it is painted dark.
function shellMaterial(surfaces) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 });
  mat.name = 'Wasteland · ruine';
  const p = positionWorld, n = normalWorldGeometry, s = surfaces.bunker;
  const local = varying(attribute('position', 'vec3')); // the unit box: y from 0 at the foot to 1 at the top
  const size = varying(attribute('ruin', 'vec4')); // width, height, depth, seed
  const isWall = abs(n.y).lessThan(0.5), wall = select(isWall, float(1), float(0));
  const inside = select(frontFacing, float(0), float(1));
  const along = select(abs(n.x).greaterThan(abs(n.z)), p.z, p.x);
  const up = local.y.mul(size.y);
  const grain = texture(s.color, select(isWall, vec2(along, p.y), p.xz).div(s.metres * 1.4));
  const rel = grain.rgb.div(vec3(...s.mean));
  // windows: bays of 3.1 m, storeys of 3.3 m, measured from this building's own corner
  const bay = along.add(size.w.mul(37)).div(3.1), storey = up.div(STOREY);
  const cell = vec2(floor(bay), floor(storey));
  const chance = fract(sin(cell.x.mul(12.9898).add(cell.y.mul(78.233)).add(size.w.mul(41.7))).mul(43758.5453));
  const inBay = step(0.2, fract(bay)).mul(step(fract(bay), 0.8));
  const hole = inBay.mul(step(0.24, fract(storey))).mul(step(fract(storey), 0.78)).mul(step(0.16, chance)).mul(wall).mul(step(1.2, up));
  // each window opens at its own distance, so that no line crosses the wall as the camera comes up
  const open = hole.mul(step(length(p.sub(cameraPosition)), chance.mul(110).add(170)));
  const soot = smoothstep(0.78, 1.0, fract(storey)).mul(inBay).mul(0.5);
  const sill = step(0.17, fract(storey)).mul(step(fract(storey), 0.24)).mul(step(0.16, fract(bay))).mul(step(fract(bay), 0.84)).mul(step(0.16, chance)).mul(wall);
  const slabLine = smoothstep(0.93, 0.97, fract(storey)).mul(wall).mul(0.22);
  const stain = texture(ground.masksA, vec2(along.div(13), p.y.div(26))).a;
  const tint = attribute('paint', 'vec3');
  let albedo = tint.mul(rel).mul(stain.mul(0.35).add(0.72)).mul(soot.oneMinus()).mul(slabLine.oneMinus());
  albedo = mix(albedo, vec3(0.3, 0.27, 0.22).mul(rel), sill.mul(0.7));
  // indoors: plaster gone grey, darker toward the floor of each storey where the fires were lit
  const plaster = mix(vec3(0.2, 0.185, 0.165), tint.mul(0.6), 0.3).mul(rel).mul(stain.mul(0.5).add(0.5)).mul(fract(storey).mul(0.35).add(0.65));
  albedo = mix(albedo, plaster, inside);
  // sand lies against the foot and on every ledge and roof
  const banked = smoothstep(4.5, 0.4, up.add(stain.mul(3)));
  albedo = mix(albedo, saltTints.dune.mul(0.85), max(banked.mul(0.8), wall.oneMinus().mul(0.75)));
  mat.colorNode = mix(albedo, vec3(0.012, 0.011, 0.01), hole);
  mat.roughnessNode = mix(float(0.9), float(0.4), hole);
  mat.aoNode = mix(float(1), float(0.42), inside).mul(saltUniforms.uFill); // little of the sky gets indoors
  // the top storeys are bitten off; open shells: the roofs fell in long ago
  const bite = texture(ground.masksA, vec2(along.div(31).add(size.w), size.w.mul(3.7))).r;
  const standing = step(up, size.y.sub(bite.mul(bite).mul(size.y.mul(0.34).add(3))));
  mat.opacityNode = select(isWall, standing.mul(open.oneMinus()), float(0));
  mat.normalNode = bumpNormal(grain.a.mul(0.03));
  mat.emissiveNode = vec3(0);
  return mat;
}

// Bare concrete and brick: slabs, columns, what is left of a wall. Sand lies on whatever faces the sky.
function concreteMaterial(surfaces) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.93, metalness: 0 });
  mat.name = 'Wasteland · béton';
  const p = positionWorld, n = normalWorldGeometry, s = surfaces.bunker;
  const flat = abs(n.y).greaterThan(0.5);
  const along = select(abs(n.x).greaterThan(abs(n.z)), p.z, p.x);
  const grain = texture(s.color, select(flat, p.xz, vec2(along, p.y)).div(s.metres * 1.4));
  const rel = grain.rgb.div(vec3(...s.mean));
  const stain = texture(ground.masksA, select(flat, p.xz.div(17), vec2(along.div(13), p.y.div(9)))).a;
  const streak = texture(ground.masksA, vec2(along.div(3.1), p.y.div(21))).r;
  const paint = attribute('paint', 'vec4'), sky = paint.w; // rgb, and how open to the sky this piece is
  let albedo = paint.rgb.mul(rel).mul(stain.mul(0.45).add(0.62)).mul(select(flat, float(1), streak.mul(0.3).add(0.78)));
  albedo = albedo.mul(select(n.y.lessThan(-0.5), float(0.5), float(1))); // the underside of a slab, black with smoke
  albedo = mix(albedo, saltTints.dune.mul(0.85), select(n.y.greaterThan(0.5), smoothstep(0.2, 0.62, stain).mul(0.85).mul(sky), float(0)));
  mat.colorNode = albedo;
  mat.aoNode = mix(float(0.36), float(1), sky).mul(saltUniforms.uFill);
  mat.normalNode = bumpNormal(grain.a.mul(0.035));
  return mat;
}

/**
 * @param {THREE.Object3D} parent
 * @param {object} surfaces - js/wasteland-surfaces.js
 * @param {{ keepOut: Array, colliders: Array }} site - where nothing may stand, and the list the walls go into
 */
export function buildWastelandRuins(parent, surfaces, { keepOut = [], colliders }) {
  const { shells, frames } = planRuins(keepOut);
  const SPAN = 1500, cells = new Map();
  const cellOf = (x, z) => {
    const id = `${Math.floor(x / SPAN)},${Math.floor(z / SPAN)}`;
    if (!cells.has(id)) cells.set(id, { shells: [], boxes: [] });
    return cells.get(id);
  };
  for (const r of shells) {
    const cell = cellOf(r.x, r.z);
    cell.shells.push(r);
    colliders.push({ minX: r.x - r.w / 2, maxX: r.x + r.w / 2, minZ: r.z - r.d / 2, maxZ: r.z + r.d / 2, minY: r.y, maxY: r.roof, roof: true });
    const paint = r.tint.map(c => c * 0.55 + 0.1);
    for (const f of r.floors) {
      const w = r.w - 0.7, d = r.d - 0.7, cut = 1 - f.keep;
      cell.boxes.push({ x: r.x + (f.alongX ? f.side * w * cut / 2 : 0), y: f.y - 0.14, z: r.z + (f.alongX ? 0 : f.side * d * cut / 2),
        sx: f.alongX ? w * f.keep : w, sy: 0.28, sz: f.alongX ? d : d * f.keep, rx: 0, rz: 0, paint, sky: f.sky });
    }
  }
  for (const frame of frames) {
    const parts = frameParts(frame);
    cellOf(frame.x, frame.z).boxes.push(...parts.boxes);
    colliders.push(...parts.colliders);
    for (const prop of parts.props) fixItem(prop);
  }
  const shell = shellMaterial(surfaces), concrete = concreteMaterial(surfaces);
  const unit = new THREE.BoxGeometry(1, 1, 1), footed = unit.clone().translate(0, 0.5, 0);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  for (const cell of cells.values()) {
    if (cell.shells.length) {
      const geometry = footed.clone(), list = cell.shells;
      const paint = new Float32Array(list.length * 3), size = new Float32Array(list.length * 4);
      const mesh = new THREE.InstancedMesh(geometry, shell, list.length);
      q.identity();
      list.forEach((r, i) => {
        mesh.setMatrixAt(i, m.compose(v.set(r.x, r.y, r.z), q, s.set(r.w, r.h, r.d)));
        paint.set(r.tint, i * 3); size.set([r.w, r.h, r.d, r.seed], i * 4);
      });
      geometry.setAttribute('paint', new THREE.InstancedBufferAttribute(paint, 3));
      geometry.setAttribute('ruin', new THREE.InstancedBufferAttribute(size, 4));
      mesh.name = 'Os de la vieille ville'; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      parent.add(mesh);
    }
    if (cell.boxes.length) {
      const geometry = unit.clone(), list = cell.boxes;
      const paint = new Float32Array(list.length * 4);
      const mesh = new THREE.InstancedMesh(geometry, concrete, list.length);
      list.forEach((b, i) => {
        q.setFromEuler(e.set(b.rx, 0, b.rz));
        mesh.setMatrixAt(i, m.compose(v.set(b.x, b.y, b.z), q, s.set(b.sx, b.sy, b.sz)));
        paint.set(b.paint, i * 4); paint[i * 4 + 3] = b.sky;
      });
      geometry.setAttribute('paint', new THREE.InstancedBufferAttribute(paint, 4));
      mesh.name = 'Planchers et carcasses'; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      parent.add(mesh);
    }
  }
  return { shells, frames };
}
