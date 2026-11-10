import * as THREE from 'three/webgpu';

// The ground's photographs and wear masks (tools/ground, Poly Haven, CC0). Loaded once, behind the loading screen,
// before the streets that use them are built.
//   ground.<surface> = { color (RGB albedo, A height), normal (RGB normal, A roughness; null for the surfaces shipped
//                        without one: dirt, litter, rock), metres, mean }
//   ground.macro     = a 30 m aerial photograph, ground.masksA / masksB = wear masks (see tools/ground/build-ground.mjs)
//   ground.objects   = { color (RGB albedo, A coverage), normal (RGB normal, A roughness) }, ground.marks = masks

const base = new URL('../assets/ground/', import.meta.url);
const ground = {};

const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none' });
async function load(name, { color = false, anisotropy = 8 } = {}) {
  const texture = new THREE.Texture(await loader.loadAsync(new URL(name, base).href));
  texture.name = `ground/${name}`;
  texture.flipY = false;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

async function loadGround() {
  const info = await (await fetch(new URL('ground.json', base))).json();
  const jobs = Object.entries(info).map(async ([name, { metres, mean, normal: hasNormal }]) => {
    if (name === 'macro') {
      ground.macro = { color: await load('macro_c.webp', { color: true, anisotropy: 2 }), metres, mean };
      return;
    }
    const [color, normal] = await Promise.all([load(`${name}_c.webp`, { color: true }), hasNormal === false ? null : load(`${name}_n.webp`)]);
    ground[name] = { color, normal, metres, mean };
  });
  jobs.push(load('masks_a.webp', { anisotropy: 4 }).then((t) => { ground.masksA = t; }));
  jobs.push(load('masks_b.webp', { anisotropy: 4 }).then((t) => { ground.masksB = t; }));
  // The atlases of tools/ground/build-atlas.mjs (tiles in js/ground-atlas.js): covers, grates and doors; road symbols and stains
  const sheet = (name, options) => load(name, options).then((t) => { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; });
  jobs.push(Promise.all([sheet('objects_c.webp', { color: true }), sheet('objects_n.webp')]).then(([color, normal]) => { ground.objects = { color, normal }; }));
  jobs.push(sheet('marks.webp').then((t) => { ground.marks = t; }));
  await Promise.all(jobs);
}

export { ground, loadGround };
