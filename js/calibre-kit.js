import * as THREE from 'three/webgpu';

// The gun shops' props and surfaces: scanned and modelled objects and photographed materials from Poly Haven (CC0),
// prepared offline by tools/calibre/build-kit.mjs into assets/calibre. Loaded once, behind the loading screen. No
// material is made here: the room builds its own from these textures and merges these geometries.
//   KIT.props[name]    = { geometry (position, normal, uv: Float32; indexed), size [x, y, z], min, max (metres, in the
//                          prop's own space), anchor, triangles, lights }
//       anchor 'floor'   : stands on y = 0, centred on its footprint, front towards +z
//       anchor 'wall'    : its back on the plane z = 0, origin at the centre of what touches the wall, facing +z
//       anchor 'ceiling' : hangs under y = 0, origin at the centre of what touches the ceiling
//       lights           : [{ at, min, max }] where the prop shines from (a lamp's bulb or tube), in its own space
//   KIT.maps           = { color, normal, orm, emissive }: the atlas every prop reads. orm is occlusion, roughness,
//                        metalness in red, green, blue; emissive is black but on the lamps' bulbs and tubes
//   Normal maps (the atlas and the surfaces) are used as they are: normalMap, normalScale (1, 1). Their green was
//   turned over by the tool, because three.js derives the bitangent of an unflipped texture down the image: the
//   OpenGL maps of the sources would be lit upside down (tools/calibre/build-kit.mjs).
//   KIT.surfaces[name] = { color, normal, rough, metres }: tiling surfaces, `metres` across one repeat
// Every prop can be drawn with front faces only (THREE.FrontSide): thin sheets carry their own inside.

const base = new URL('../assets/calibre/', import.meta.url);
const KIT = { ready: false, props: {}, maps: null, surfaces: {} };
let loading = null;

const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none' });
async function loadMap(name, { color = false, repeat = false } = {}) {
  let image;
  try {
    image = await loader.loadAsync(new URL(name, base).href);
  } catch {
    throw new Error(`calibre kit: assets/calibre/${name} did not load`);
  }
  const texture = new THREE.Texture(image);
  texture.name = `calibre/${name}`;
  texture.flipY = false;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

async function read(name, as) {
  let response;
  try {
    response = await fetch(new URL(name, base));
  } catch {
    throw new Error(`calibre kit: assets/calibre/${name} did not load`);
  }
  if (!response.ok) throw new Error(`calibre kit: assets/calibre/${name}: ${response.status}`);
  return response[as]();
}

// What tools/calibre/build-kit.mjs wrote: a JSON header, then every prop's positions (uint16 across the prop's own
// box), normals (int8), uvs (uint16 across the atlas) and indices (uint16, counted from the prop's first vertex).
// Returns the header and, per prop, plain Float32 attributes and its index.
function parseKit(buffer) {
  const headLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headLength)));
  if (header.version !== 1) throw new Error(`calibre kit: kit.bin is version ${header.version}, this loader reads version 1`);
  const align = (n) => (n + 3) & ~3;
  let o = align(4 + headLength);
  const take = (Type, bytes) => {
    const a = new Type(buffer, o, bytes / Type.BYTES_PER_ELEMENT);
    o = align(o + bytes);
    return a;
  };
  const [pBytes, nBytes, uvBytes, iBytes] = header.sections;
  const P = take(Uint16Array, pBytes), N = take(Int8Array, nBytes), T = take(Uint16Array, uvBytes), I = take(Uint16Array, iBytes);
  const props = header.props.map((p) => {
    const position = new Float32Array(p.vertices * 3), normal = new Float32Array(p.vertices * 3), uv = new Float32Array(p.vertices * 2);
    for (let v = 0; v < p.vertices; v++) {
      const s = p.vertexStart + v;
      const nx = N[s * 3], ny = N[s * 3 + 1], nz = N[s * 3 + 2], l = Math.hypot(nx, ny, nz) || 1;
      for (let c = 0; c < 3; c++) position[v * 3 + c] = p.min[c] + (P[s * 3 + c] / 65535) * (p.max[c] - p.min[c]);
      normal[v * 3] = nx / l; normal[v * 3 + 1] = ny / l; normal[v * 3 + 2] = nz / l;
      uv[v * 2] = T[s * 2] / 65535; uv[v * 2 + 1] = T[s * 2 + 1] / 65535;
    }
    return { ...p, position, normal, uv, index: I.slice(p.indexStart, p.indexStart + p.triangles * 3) };
  });
  return { header, props };
}

async function load() {
  const [buffer, info] = await Promise.all([read('kit.bin', 'arrayBuffer'), read('kit.json', 'json')]);
  const { props } = parseKit(buffer);
  for (const p of props) {
    const geometry = new THREE.BufferGeometry();
    geometry.name = `calibre/${p.name}`;
    geometry.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(p.uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(p.index, 1));
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(...p.min), new THREE.Vector3(...p.max));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    KIT.props[p.name] = { geometry, size: p.size, min: p.min, max: p.max, anchor: p.anchor, triangles: p.triangles, lights: p.lights ?? [] };
  }
  const jobs = [
    Promise.all([loadMap(info.atlas.colour, { color: true }), loadMap(info.atlas.normal), loadMap(info.atlas.orm), loadMap(info.atlas.emission, { color: true })])
      .then(([color, normal, orm, emissive]) => { KIT.maps = { color, normal, orm, emissive }; })
  ];
  const surfaces = Object.entries(info.surfaces).map(([name, { metres }]) => Promise.all([
    loadMap(`surf_${name}_c.webp`, { color: true, repeat: true }), loadMap(`surf_${name}_n.webp`, { repeat: true }), loadMap(`surf_${name}_r.webp`, { repeat: true })
  ]).then(([color, normal, rough]) => [name, { color, normal, rough, metres }]));
  const [loaded] = await Promise.all([Promise.all(surfaces), ...jobs]);
  for (const [name, surface] of loaded) KIT.surfaces[name] = surface; // in the order of kit.json
  KIT.ready = true;
}

// Fetches and decodes everything once; a second call waits for, or returns, the same load. A failed load can be retried.
function loadCalibreKit() {
  loading ??= load().catch((error) => { loading = null; throw error; });
  return loading;
}

// A copy of a prop's geometry, to transform and merge; null for a name the kit does not have
function kitProp(name) {
  return KIT.props[name]?.geometry.clone() ?? null;
}

export { KIT, loadCalibreKit, kitProp };
