import * as THREE from 'three/webgpu';

// What lies about a New York sidewalk: trash bags, cans, planters, utility boxes, barriers and the hydrants themselves, real
// models (tools/world/import-prop.mjs, Poly Haven, CC0). Instances are split into cells the scene culler can drop.

const base = new URL('../assets/world/', import.meta.url);
const NAMES = ['hydrant', 'trashcan', 'trashbag', 'planter', 'utilitybox', 'barrier'];
const CELL = 256;
const DRAW_DISTANCE = 170;
const props = {};

const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none' });
async function loadTexture(name, color) {
  const texture = new THREE.Texture(await loader.loadAsync(new URL(name, base).href));
  texture.flipY = false;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

async function loadProp(name) {
  const buffer = await (await fetch(new URL(`prop-${name}.bin`, base))).arrayBuffer();
  const headLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headLength)));
  const align = (n) => (n + 3) & ~3;
  let o = align(4 + headLength);
  const take = (Type, bytes) => { const a = new Type(buffer, o, bytes / Type.BYTES_PER_ELEMENT); o = align(o + bytes); return a; };
  const [p, n, uv, f] = header.sections;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(take(Float32Array, p), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(take(Float32Array, n), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(take(Float32Array, uv), 2));
  geometry.setIndex(new THREE.BufferAttribute(take(Uint32Array, f), 1));
  geometry.computeBoundingSphere();
  const [map, normalMap] = await Promise.all([loadTexture(`prop-${name}_c.webp`, true), loadTexture(`prop-${name}_n.webp`, false)]);
  props[name] = { geometry, material: new THREE.MeshStandardNodeMaterial({ map, normalMap, roughness: 0.78, metalness: 0 }), size: header.size };
}

const loadClutter = () => Promise.all(NAMES.map(loadProp));

const gone = new THREE.Matrix4().makeScale(0, 0, 0);
const dummy = new THREE.Object3D();

/**
 * @param {THREE.Group} group
 * @param {{name: string, x: number, y: number, z: number, ry: number, scale?: number}[]} items
 * @returns one { item, mesh, index } per item, so a prop can be knocked away later
 */
function createClutter(group, items) {
  const cells = new Map();
  for (const item of items) {
    const key = `${item.name}:${Math.floor(item.x / CELL)},${Math.floor(item.z / CELL)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(item);
  }
  const placed = [];
  for (const [key, list] of cells) {
    const { geometry, material } = props[list[0].name];
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    mesh.name = `Clutter_${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    list.forEach((item, index) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.rotation.set(0, item.ry, 0);
      dummy.scale.setScalar(item.scale ?? 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      placed.push({ item, mesh, index });
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.cullDistance = DRAW_DISTANCE;
    group.add(mesh);
  }
  return placed;
}

function removeClutter(mesh, index) {
  mesh.setMatrixAt(index, gone);
  mesh.instanceMatrix.needsUpdate = true;
}

export { loadClutter, createClutter, removeClutter, props as clutterProps };
