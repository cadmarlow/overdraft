import * as THREE from 'three/webgpu';

// The Wasteland's photographed surfaces (tools/wasteland/build-surfaces.mjs, Poly Haven, CC0), packed and loaded exactly
// as the city's ground is (js/ground-assets.js): load them once, behind the loading screen, before the desert that
// uses them is built.
//   surfaces.<name> = { color (RGB albedo, A height), normal (RGB normal, A roughness), metres, mean, roughness }
//       names   : dune, sand, crack, salt, gravel, slab (ground), cliff, crag (rock faces), rust, sheet, bunker (walls)
//       metres  : what one repeat covers: texture(surfaces.dune.color, positionWorld.xz.div(surfaces.dune.metres))
//       mean    : the photograph's mean linear albedo [r, g, b], to divide by before setting the tone you want
//       roughness : its mean roughness (the map itself is in normal.a)
//       normals : OpenGL, as assets/ground: green points up the image. On flat ground, with u along world x and v
//                 along world z, the world normal is normalize(vec3(n.x, 1, -n.y)) (flatNormal of js/ground-materials.js)
//   surfaces.macro  = { color, metres, mean }: a 20 m aerial photograph of dry ground streaked with sand

const base = new URL('../assets/wasteland/', import.meta.url);
const surfaces = {};
let loading = null;

const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none' });
async function load(name, { color = false, anisotropy = 8 } = {}) {
  const texture = new THREE.Texture(await loader.loadAsync(new URL(name, base).href));
  texture.name = `wasteland/${name}`;
  texture.flipY = false;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

async function loadAll() {
  const info = await (await fetch(new URL('surfaces.json', base))).json();
  const loaded = await Promise.all(Object.entries(info).map(async ([name, s]) => {
    if (name === 'macro') return [name, { color: await load(s.color, { color: true, anisotropy: 2 }), metres: s.metres, mean: s.mean }];
    const [color, normal] = await Promise.all([load(s.color, { color: true }), load(s.normal)]);
    return [name, { color, normal, metres: s.metres, mean: s.mean, roughness: s.roughness }];
  }));
  for (const [name, surface] of loaded) surfaces[name] = surface; // in the order of surfaces.json
  return surfaces;
}

// Loads every surface once and returns `surfaces`; a second call waits for, or returns, the same load
function loadWastelandSurfaces() {
  loading ??= loadAll().catch((error) => { loading = null; throw error; });
  return loading;
}

export { surfaces, loadWastelandSurfaces };
