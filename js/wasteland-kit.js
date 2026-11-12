import * as THREE from 'three/webgpu';

// The Wasteland's props: scanned rocks and dead wood, and the clutter of a camp at the end of the world, from Poly
// Haven (CC0), prepared offline by tools/wasteland/build-kit.mjs into assets/wasteland. No material is made here: the
// desert builds its own from these textures and instances these geometries.
//   const kit = await loadWastelandKit();
//   kit.props[name] = { full, low (BufferGeometry: position, normal, uv as Float32; indexed), size [x, y, z], min, max
//                       (metres, in the prop's own space), collider, kind, grounded, buried, cutout, twoSided,
//                       triangles { full, low } }
//       full, low  : the same prop at two levels of detail (low is about a quarter of full), reading the same atlas
//       origin     : the centre of the footprint, on the ground (y = 0), y up
//       grounded   : the base is the plane y = 0. If not, `buried` metres hang under y = 0: a scan keeps the ground it
//                    was photographed on at y = 0 and its skirt goes into the sand
//       collider   : { radius, height, centre } for round things (a vertical cylinder), { half, centre } for boxes,
//                    null for what nobody bumps into (a bush, a branch). Metres, in the prop's space: scale them with it
//       kind       : 'rock', 'wood', 'plant', 'clutter' or 'big'
//       cutout     : has holes cut by the alpha of the colour atlas: draw it with alphaTest (0.5)
//       twoSided   : has open sheets whose back shows: draw it with THREE.DoubleSide
//   kit.maps = { color, normal, orm }: the atlas every prop reads. color is sRGB with coverage in its alpha (1
//       everywhere but in the cut-outs); orm is occlusion, roughness, metalness in red, green, blue
//       new THREE.MeshStandardNodeMaterial({ map: kit.maps.color, normalMap: kit.maps.normal, aoMap: kit.maps.orm,
//         roughnessMap: kit.maps.orm, metalnessMap: kit.maps.orm, roughness: 1, metalness: 1 })
//   The normal map is used as it is: normalMap, normalScale (1, 1). Its green was turned over by the tool, because
//   three.js derives the bitangent of an unflipped texture down the image (see tools/calibre/build-kit.mjs).

const base = new URL('../assets/wasteland/', import.meta.url);
const KIT = { ready: false, props: {}, maps: null };
let loading = null;

const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none' });
async function loadMap(name, { color = false } = {}) {
  let image;
  try {
    image = await loader.loadAsync(new URL(name, base).href);
  } catch {
    throw new Error(`wasteland kit: assets/wasteland/${name} did not load`);
  }
  const texture = new THREE.Texture(image);
  texture.name = `wasteland/${name}`;
  texture.flipY = false;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
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
    throw new Error(`wasteland kit: assets/wasteland/${name} did not load`);
  }
  if (!response.ok) throw new Error(`wasteland kit: assets/wasteland/${name}: ${response.status}`);
  return response[as]();
}

// What tools/wasteland/build-kit.mjs wrote: a JSON header, then every vertex's position (uint16 across its prop's own
// box), normal (int8) and uv (uint16 across the atlas), then the indices (uint16, counted from the level's first
// vertex). Returns the header and, per prop, its levels as plain Float32 attributes and an index.
function parseKit(buffer) {
  const headLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headLength)));
  if (header.version !== 1) throw new Error(`wasteland kit: kit.bin is version ${header.version}, this loader reads version 1`);
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
    const levels = {};
    for (const [level, l] of Object.entries(p.levels)) {
      const position = new Float32Array(l.vertices * 3), normal = new Float32Array(l.vertices * 3), uv = new Float32Array(l.vertices * 2);
      for (let v = 0; v < l.vertices; v++) {
        const s = l.vertexStart + v;
        const nx = N[s * 3], ny = N[s * 3 + 1], nz = N[s * 3 + 2], length = Math.hypot(nx, ny, nz) || 1;
        for (let c = 0; c < 3; c++) position[v * 3 + c] = p.min[c] + (P[s * 3 + c] / 65535) * (p.max[c] - p.min[c]);
        normal[v * 3] = nx / length; normal[v * 3 + 1] = ny / length; normal[v * 3 + 2] = nz / length;
        uv[v * 2] = T[s * 2] / 65535; uv[v * 2 + 1] = T[s * 2 + 1] / 65535;
      }
      levels[level] = { ...l, position, normal, uv, index: I.slice(l.indexStart, l.indexStart + l.triangles * 3) };
    }
    return { ...p, levels };
  });
  return { header, props };
}

async function load() {
  const [buffer, info] = await Promise.all([read('kit.bin', 'arrayBuffer'), read('kit.json', 'json')]);
  const listed = Object.fromEntries(info.props.map((p) => [p.name, p]));
  for (const p of parseKit(buffer).props) {
    const geometry = (level) => {
      const l = p.levels[level], g = new THREE.BufferGeometry();
      g.name = `wasteland/${p.name}/${level}`;
      g.setAttribute('position', new THREE.BufferAttribute(l.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(l.normal, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(l.uv, 2));
      g.setIndex(new THREE.BufferAttribute(l.index, 1));
      g.boundingBox = new THREE.Box3(new THREE.Vector3(...p.min), new THREE.Vector3(...p.max));
      g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
      return g;
    };
    const { kind, grounded, buried, collider, cutout, twoSided } = listed[p.name];
    KIT.props[p.name] = {
      full: geometry('full'), low: geometry('low'), size: p.size, min: p.min, max: p.max, collider, kind, grounded, buried, cutout, twoSided,
      triangles: { full: p.levels.full.triangles, low: p.levels.low.triangles }
    };
  }
  const [color, normal, orm] = await Promise.all([loadMap(info.atlas.colour, { color: true }), loadMap(info.atlas.normal), loadMap(info.atlas.orm)]);
  KIT.maps = { color, normal, orm };
  KIT.ready = true;
  return KIT;
}

// Fetches and decodes everything once and returns the kit; a second call waits for, or returns, the same load. A
// failed load can be retried.
function loadWastelandKit() {
  loading ??= load().catch((error) => { loading = null; throw error; });
  return loading;
}

// A copy of a prop's geometry at one level ('full' or 'low'), to transform and merge; null for a name the kit does not have
function wastelandProp(name, level = 'full') {
  return KIT.props[name]?.[level]?.clone() ?? null;
}

export { KIT as WASTELAND_KIT, loadWastelandKit, wastelandProp };
