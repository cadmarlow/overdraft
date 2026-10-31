import * as THREE from 'three/webgpu';

// Real people: Microsoft Rocketbox avatars and motion capture, imported by tools/people into assets/people.

const base = new URL('../assets/people/', import.meta.url);

function parsePerson(buffer) {
  const headLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headLength)));
  const align = (n) => (n + 3) & ~3;
  let o = align(4 + headLength);
  const take = (Type, bytes) => {
    const a = new Type(buffer, o, bytes / Type.BYTES_PER_ELEMENT);
    o = align(o + bytes);
    return a;
  };
  const [pBytes, nBytes, uvBytes, iBytes, wBytes, fBytes, bBytes] = header.sections;
  const position = take(Float32Array, pBytes);
  const normal = take(Float32Array, nBytes);
  const uv = take(Float32Array, uvBytes);
  const skinIndex = take(Uint8Array, iBytes);
  const skinWeight = take(Uint8Array, wBytes);
  const index = take(Uint32Array, fBytes);
  const bind = take(Float32Array, bBytes);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(skinIndex), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Float32Array.from(skinWeight, (v) => v / 255), 4));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  header.parts.forEach((part, i) => geometry.addGroup(part.start, part.count, i));
  geometry.computeBoundingSphere();
  return { geometry, bones: header.bones, parts: header.parts, height: header.height, bind };
}

async function fetchBuffer(name) {
  const response = await fetch(new URL(name, base));
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  return response.arrayBuffer();
}

const textures = new Map();
const textureLoader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none' });
function loadTexture(name, colorSpace) {
  if (!textures.has(name)) textures.set(name, textureLoader.loadAsync(new URL(name, base).href).then((image) => {
    const texture = new THREE.Texture(image);
    texture.flipY = false;
    texture.colorSpace = colorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    return texture;
  }, () => null));
  return textures.get(name);
}

async function loadPerson(id) {
  const person = parsePerson(await fetchBuffer(`${id}.bin`));
  person.id = id;
  person.maps = await Promise.all(person.parts.map(async ({ name }) => {
    const [color, normal, specular] = await Promise.all([
      loadTexture(`${id}_${name}_c.webp`, THREE.SRGBColorSpace),
      loadTexture(`${id}_${name}_n.webp`, THREE.NoColorSpace),
      loadTexture(`${id}_${name}_s.webp`, THREE.NoColorSpace)
    ]);
    return { name, color, normal, specular };
  }));
  return person;
}

// A body of the crowd: on the game's skeleton, one painted atlas
async function loadCrowdBody(id) {
  const [{ geometry }, atlas] = await Promise.all([fetchBuffer(`crowd-${id}.bin`).then(parsePerson), loadTexture(`crowd-${id}.webp`, THREE.SRGBColorSpace)]);
  return { geometry, atlas };
}

// A gun lifted off an avatar: rigid, with its own painted maps
async function loadGun(id) {
  const buffer = await fetchBuffer(`gun-${id}.bin`);
  const headLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headLength)));
  const align = (n) => (n + 3) & ~3;
  let o = align(4 + headLength);
  const take = (Type, bytes) => {
    const a = new Type(buffer, o, bytes / Type.BYTES_PER_ELEMENT);
    o = align(o + bytes);
    return a;
  };
  const [pBytes, nBytes, uvBytes, fBytes] = header.sections;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(take(Float32Array, pBytes), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(take(Float32Array, nBytes), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(take(Float32Array, uvBytes), 2));
  geometry.setIndex(new THREE.BufferAttribute(take(Uint32Array, fBytes), 1));
  geometry.computeBoundingSphere();
  const [color, normal, specular] = await Promise.all([
    loadTexture(`gun-${id}_c.webp`, THREE.SRGBColorSpace),
    loadTexture(`gun-${id}_n.webp`, THREE.NoColorSpace),
    loadTexture(`gun-${id}_s.webp`, THREE.NoColorSpace)
  ]);
  return { geometry, color, normal, specular };
}

export { loadPerson, loadCrowdBody, loadGun, parsePerson, fetchBuffer };
