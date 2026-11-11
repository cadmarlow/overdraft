import * as THREE from 'three/webgpu';
import { subtractRoadQuad } from './road-corridor.js';

// Trim the low procedural terrain before batching. Buildings are built afterwards and are never trimmed.
function cutRoadGround(group, corridor, excludedMaterials = []) {
  group.updateMatrixWorld(true);
  const point = new THREE.Vector3(), inverse = new THREE.Matrix4();
  let changed = 0;
  group.traverse(mesh => {
    if (!mesh.isMesh || mesh.isInstancedMesh || excludedMaterials.includes(mesh.material)) return;
    const geometry = mesh.geometry;
    if (!geometry.attributes.position) return;
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    if (bounds.max.y <= 0.001 || bounds.min.y > 1.2 || !corridor.query(bounds.min.x, bounds.max.x, bounds.min.z, bounds.max.z).length) return;
    const attributes = Object.entries(geometry.attributes), offsets = [];
    let width = 3;
    for (const [name, attr] of attributes) { if (name === 'position') continue; offsets.push([name, attr, width]); width += attr.itemSize; }
    const position = geometry.attributes.position, index = geometry.index;
    const count = index ? index.count : position.count, output = [];
    let cut = false;
    const vertex = id => {
      point.fromBufferAttribute(position, id).applyMatrix4(mesh.matrixWorld);
      const v = [point.x, point.y, point.z];
      for (const [, attr] of offsets) for (let k = 0; k < attr.itemSize; k++) v.push(attr.array[id * attr.itemSize + k]);
      return v;
    };
    for (let i = 0; i < count; i += 3) {
      const triangle = [0, 1, 2].map(k => vertex(index ? index.getX(i + k) : i + k));
      // Pier batches mix low decks with tall buildings and deep piles. Inspect each triangle, otherwise one tall
      // item prevents every low slab in that batch from being trimmed out of the carriageway.
      if (triangle.every(v => v[1] <= 0.001) || triangle.some(v => v[1] < -1 || v[1] > 1.2)) { output.push(...triangle); continue; }
      const xs = triangle.map(v => v[0]), zs = triangle.map(v => v[2]);
      let pieces = [triangle];
      for (const q of corridor.query(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs))) {
        pieces = pieces.flatMap(p => subtractRoadQuad(p, q.poly));
        if (!pieces.length) break;
      }
      if (pieces.length !== 1 || pieces[0] !== triangle) cut = true;
      for (const p of pieces) for (let j = 1; j < p.length - 1; j++) output.push(p[0], p[j], p[j + 1]);
    }
    if (!cut) return;
    inverse.copy(mesh.matrixWorld).invert();
    const replacement = new THREE.BufferGeometry(), positions = [];
    for (const v of output) { point.set(v[0], v[1], v[2]).applyMatrix4(inverse); positions.push(point.x, point.y, point.z); }
    replacement.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    for (const [name, attr, offset] of offsets) {
      const data = [];
      for (const v of output) for (let k = 0; k < attr.itemSize; k++) data.push(v[offset + k]);
      replacement.setAttribute(name, new THREE.Float32BufferAttribute(data, attr.itemSize));
    }
    replacement.computeBoundingSphere();
    mesh.geometry = replacement;
    changed++;
  });
  return changed;
}

export { cutRoadGround };
