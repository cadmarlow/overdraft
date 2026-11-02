import * as THREE from 'three/webgpu';

// The city's surfaces: photographed brick, stone, asphalt and concrete (tools/world, Poly Haven, CC0). Loaded once, behind
// the loading screen, before the streets and buildings that use them are built. `metres` is what one repeat covers.

const base = new URL('../assets/world/', import.meta.url);
const world = {};

const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none' });
async function load(name, color) {
  const texture = new THREE.Texture(await loader.loadAsync(new URL(name, base).href));
  texture.name = name;
  texture.flipY = false;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

async function loadWorld() {
  const sizes = await (await fetch(new URL('sizes.json', base))).json();
  await Promise.all(Object.entries(sizes).map(async ([name, { metres }]) => {
    const [color, normal, rough] = await Promise.all([load(`${name}_c.webp`, true), load(`${name}_n.webp`, false), load(`${name}_r.webp`, false)]);
    world[name] = { color, normal, rough, metres };
  }));
}

export { world, loadWorld };
