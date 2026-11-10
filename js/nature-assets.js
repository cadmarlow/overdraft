import * as THREE from 'three/webgpu';

// Real plants: scanned leaves set along twigs (tools/nature/build-foliage.mjs), photographed bark and grass, all CC0.
// Loaded once, behind the loading screen, before the city that uses them is built.

const base = new URL('../assets/nature/', import.meta.url);
const SPECIES = ['plane', 'locust', 'elm', 'oak'];
const nature = { leaves: null, leavesNormal: null, bark: [], barkNormal: [], lawn: null, lawnNormal: null, meadow: null };

const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none' });
async function load(name, { color = false, wrap = THREE.RepeatWrapping, anisotropy = 8 } = {}) {
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

async function loadNature() {
  const clamp = THREE.ClampToEdgeWrapping;
  [nature.leaves, nature.leavesNormal, nature.lawn, nature.lawnNormal, nature.meadow] = await Promise.all([
    // (the lawn photograph gives the blades and their relief; the meadow one only breaks its repeats, in colour)
    load('leaves_c.webp', { color: true, wrap: clamp, anisotropy: 4 }),
    load('leaves_n.webp', { wrap: clamp, anisotropy: 4 }),
    load('lawn_c.webp', { color: true }),
    load('lawn_n.webp'),
    load('meadow_c.webp', { color: true })
  ]);
  nature.bark = await Promise.all(SPECIES.map((s) => load(`bark-${s}_c.webp`, { color: true })));
  nature.barkNormal = await Promise.all(SPECIES.map((s) => load(`bark-${s}_n.webp`)));
}

export { nature, loadNature };
