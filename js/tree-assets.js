import * as THREE from 'three/webgpu';

// The trees, as tools/trees built them: every species' geometry at two levels of detail (trees.bin.gz), the foliage
// atlas their twigs wear, the bark photographs, and the impostor frames a tree turns into far away.
// Loaded once behind the loading screen, before the city that plants them is built.

const base = new URL('../assets/trees/', import.meta.url);
const BARKS = ['plane', 'locust', 'oak', 'elm'];
const trees = {
  ready: false,
  types: [], // per tree: the header's numbers plus `geometry: [near, far]` (vertex attributes shared by every cell)
  atlas: [1, 1], grid: [1, 1], rings: [],
  foliage: null, foliageRelief: null, impostors: null, impostorRelief: null, bark: {}, barkNormal: {}
};

const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
async function load(name, { color = false, wrap = THREE.ClampToEdgeWrapping, anisotropy = 4 } = {}) {
  const image = await loader.loadAsync(new URL(name, base).href);
  const texture = new THREE.Texture(image);
  texture.name = name;
  texture.flipY = false;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = wrap;
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

async function loadModels() {
  const response = await fetch(new URL('trees.bin.gz', base));
  if (!response.ok) throw new Error(`Tree models request failed: ${response.status}`);
  // Servers that send .gz files as Content-Encoding: gzip hand over bytes the browser has already inflated
  const body = new Uint8Array(await response.arrayBuffer());
  const data = body[0] === 0x1f && body[1] === 0x8b
    ? new Uint8Array(await new Response(new Response(body).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
    : body;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (String.fromCharCode(data[0], data[1], data[2], data[3]) !== 'OTR1') throw new Error('Invalid tree models.');
  const headerLength = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(data.subarray(8, 8 + headerLength)));
  const start = data.byteOffset + 8 + headerLength;
  const buffer = data.buffer;
  trees.atlas = header.atlas;
  trees.grid = header.grid;
  trees.rings = header.rings;
  trees.types = header.types.map((type) => {
    const geometry = type.levels.map((level) => {
      const n = level.vertices;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffer, start + level.position, n * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buffer, start + level.normal, n * 4), 4, true));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buffer, start + level.uv, n * 2), 2));
      g.setAttribute('aWind', new THREE.BufferAttribute(new Uint8Array(buffer, start + level.wind, n * 4), 4, true));
      g.setAttribute('aShade', new THREE.BufferAttribute(new Uint8Array(buffer, start + level.shade, n * 4), 4, true));
      const count = level.triangles * 3;
      g.setIndex(new THREE.BufferAttribute(level.wide ? new Uint32Array(buffer, start + level.index, count) : new Uint16Array(buffer, start + level.index, count), 1));
      return g;
    });
    return { ...type, geometry };
  });
}

async function loadTrees() {
  const repeat = THREE.RepeatWrapping;
  const [, foliage, foliageRelief, impostors, impostorRelief, bark, barkNormal] = await Promise.all([
    loadModels(),
    load('foliage_c.webp', { color: true, anisotropy: 8 }),
    load('foliage_n.webp'),
    load('impostors_c.webp', { color: true, anisotropy: 1 }),
    load('impostors_n.webp', { anisotropy: 1 }),
    Promise.all(BARKS.map((name) => load(`bark-${name}_c.webp`, { color: true, wrap: repeat, anisotropy: 8 }))),
    Promise.all(BARKS.map((name) => load(`bark-${name}_n.webp`, { wrap: repeat, anisotropy: 8 })))
  ]);
  Object.assign(trees, { foliage, foliageRelief, impostors, impostorRelief });
  BARKS.forEach((name, i) => { trees.bark[name] = bark[i]; trees.barkNormal[name] = barkNormal[i]; });
  trees.ready = true;
}

export { trees, loadTrees };
