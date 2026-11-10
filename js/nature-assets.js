import * as THREE from 'three/webgpu';

// Real grass: the photographed lawn and meadow of the parks (tools/nature), CC0. The trees have their own loader
// (js/tree-assets.js). Loaded once, behind the loading screen, before the city that uses them is built.

const base = new URL('../assets/nature/', import.meta.url);
const nature = { lawn: null, lawnNormal: null, meadow: null };

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
  // (the lawn photograph gives the blades and their relief; the meadow one only breaks its repeats, in colour)
  [nature.lawn, nature.lawnNormal, nature.meadow] = await Promise.all([
    load('lawn_c.webp', { color: true }),
    load('lawn_n.webp'),
    load('meadow_c.webp', { color: true })
  ]);
}

export { nature, loadNature };
