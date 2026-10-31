import * as THREE from 'three/webgpu';
import { loadCrowdBody } from './people-assets.js';

// Loads a body sculpted by tools/build-humans.mjs into a geometry
function parseHuman(buffer) {
  const headLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headLength)));
  const align = (n) => (n + 3) & ~3;
  let o = align(4 + headLength);
  const take = (Type, bytes) => {
    const a = new Type(buffer, o, bytes / Type.BYTES_PER_ELEMENT);
    o = align(o + bytes);
    return a;
  };
  const [pBytes, nBytes, iBytes, wBytes, partBytes, fBytes] = header.sections;
  const position = take(Float32Array, pBytes);
  const normal = take(Float32Array, nBytes);
  const skinIndex = take(Uint8Array, iBytes);
  const skinWeight = take(Uint8Array, wBytes);
  const part = take(Uint8Array, partBytes);
  const index = take(Uint32Array, fBytes);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(skinIndex), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Float32Array.from(skinWeight, (v) => v / 255), 4));
  geometry.setAttribute('part', new THREE.Float32BufferAttribute(Float32Array.from(part), 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

async function loadHuman(name) {
  const response = await fetch(new URL(`../assets/humans/${name}.bin`, import.meta.url));
  if (!response.ok) throw new Error(`human ${name}: ${response.status}`);
  return parseHuman(await response.arrayBuffer());
}

// Everything the street needs, loaded once behind the loading screen
const crowd = { bodies: [], props: [] };
async function loadCrowd(bodies, props) {
  crowd.bodies = await Promise.all(bodies.map(loadCrowdBody));
  crowd.props = await Promise.all(props.map(loadHuman));
}

export { loadHuman, parseHuman, loadCrowd, crowd };
