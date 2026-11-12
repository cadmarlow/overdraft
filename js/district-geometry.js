import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function finishGeometry(position, index, style) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(position.length / 3 * 2).fill(style), 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}
function quad(index, a, b, c, d) {
  index.push(a, b, c, a, c, d);
}

function createDistrictBatch(name) {
  const group = new THREE.Group();
  group.name = name;
  const batches = new Map();
  function add(mat, geometry, cast = true) {
    let bucket = batches.get(mat);
    if (!bucket) batches.set(mat, (bucket = { casters: [], surfaces: [] }));
    (cast ? bucket.casters : bucket.surfaces).push(geometry);
  }
  function finish(parent) {
    for (const [mat, bucket] of batches) {
      for (const [geos, cast] of [[bucket.casters, true], [bucket.surfaces, false]]) {
        if (!geos.length) continue;
        const list = geos.length > 1 ? geos.map(g => g.index ? g.toNonIndexed() : g) : geos;
        const geometry = list.length === 1 ? list[0] : mergeGeometries(list);
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        mesh.userData.cullDistance = mat.userData.cullDistance ?? 1000;
        group.add(mesh);
        for (const g of new Set([...list, ...geos])) if (g !== geometry) g.dispose();
      }
    }
    parent.add(group);
    group.updateMatrixWorld(true);
  }
  return { add, finish };
}

function standard(color, roughness = 0.85, metalness = 0) {
  return new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
}
function topGeometry(points, y, style = 0) {
  const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p.x, -p.z)));
  const geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, y, 0);
  geometry.getAttribute('uv').array.fill(style);
  return geometry;
}

export { finishGeometry, quad, createDistrictBatch, standard, topGeometry };
