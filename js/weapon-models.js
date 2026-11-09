import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The weapons as objects: real models prepared offline (tools/weapons) into assets/weapons, loaded once behind the
// loading screen. Every character shares their geometry and materials; taking one out only instantiates transforms.
// A model's children named `action` (slide, bolt, pump) and `magazine` move; everything is in weapon space (metres, +Z
// along the barrel, +Y its top, +X its left).

const GUNS = ['pistol', 'smg', 'shotgun', 'rifle'];
const base = new URL('../assets/weapons/', import.meta.url);
const templates = new Map();
let leather = null;

const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none' });
const maps = new Map(); // one texture per file: materials of a model may share an image
function loadMap(name, colorSpace) {
  if (!maps.has(name)) maps.set(name, readMap(name, colorSpace));
  return maps.get(name);
}
function readMap(name, colorSpace) {
  return loader.loadAsync(new URL(name, base).href).then((image) => {
    const texture = new THREE.Texture(image);
    texture.flipY = false;
    texture.colorSpace = colorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    return texture;
  }, () => null);
}

// What tools/weapons/import.mjs wrote: a JSON header, then positions, normals, uvs and indices
function parseWeapon(buffer) {
  const headLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headLength)));
  const align = (n) => (n + 3) & ~3;
  let o = align(4 + headLength);
  const take = (Type, bytes) => {
    const a = new Type(buffer, o, bytes / Type.BYTES_PER_ELEMENT);
    o = align(o + bytes);
    return a;
  };
  const [pBytes, nBytes, uvBytes, iBytes] = header.sections;
  const position = new THREE.BufferAttribute(take(Float32Array, pBytes), 3);
  const normal = new THREE.BufferAttribute(take(Float32Array, nBytes), 3);
  const uv = new THREE.BufferAttribute(take(Float32Array, uvBytes), 2);
  const index = new THREE.BufferAttribute(take(header.indexSize === 4 ? Uint32Array : Uint16Array, iBytes), 1);
  return { header, position, normal, uv, index };
}

async function loadWeapon(id) {
  const response = await fetch(new URL(`${id}.bin`, base));
  if (!response.ok) throw new Error(`${id}.bin: ${response.status}`);
  const { header, position, normal, uv, index } = parseWeapon(await response.arrayBuffer());
  const materials = await Promise.all(header.materials.map(async (m) => {
    const [map, normalMap, orm] = await Promise.all([
      m.maps.c ? loadMap(m.maps.c, THREE.SRGBColorSpace) : null,
      m.maps.n ? loadMap(m.maps.n, THREE.NoColorSpace) : null,
      m.maps.orm ? loadMap(m.maps.orm, THREE.NoColorSpace) : null
    ]);
    const material = new THREE.MeshStandardNodeMaterial({ map, normalMap, roughnessMap: orm, metalnessMap: orm, aoMap: orm, metalness: m.metal, roughness: m.rough });
    if (!map) material.color.setRGB(...m.color);
    material.name = `${header.name} ${m.name}`;
    return material;
  }));
  const root = new THREE.Group();
  root.name = header.name;
  for (const part of header.parts) {
    // the parts share one set of vertex buffers; each draws its own run of the index
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', position);
    geometry.setAttribute('normal', normal);
    geometry.setAttribute('uv', uv);
    geometry.setIndex(index);
    geometry.setDrawRange(part.start, part.count);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0.1), 1.2);
    const mesh = new THREE.Mesh(geometry, materials[part.material]);
    mesh.castShadow = true;
    mesh.name = `${header.name} ${part.name}`;
    let parent = root;
    if (part.name !== 'body') {
      parent = root.getObjectByName(part.name);
      if (!parent) { parent = new THREE.Group(); parent.name = part.name; parent.userData.travel = header.travel?.[part.name]; root.add(parent); }
    }
    parent.add(mesh);
  }
  return root;
}

async function loadWeaponModels() {
  if (templates.size) return;
  await Promise.all([...GUNS, 'grenade'].map(async (kind) => templates.set(kind, await loadWeapon(kind))));
  templates.set('grapple', launcher());
  leather = new THREE.MeshStandardNodeMaterial({ color: 0x4a2c18, roughness: 0.55, metalness: 0 });
  leather.name = 'Holster leather';
  templates.set('holster', holster());
}

// The « Levier » grapple launcher: a tool, not a firearm, and it must not be mistaken for the pistol on the thigh.
// A fat tube on a moulded safety-orange frame, the folded hook showing at its mouth. Weapon space, like the others.
function launcher() {
  const side = new THREE.Shape();
  side.moveTo(-0.066, 0.056); side.lineTo(0.034, 0.056); side.lineTo(0.034, 0.006); side.lineTo(-0.012, 0);
  side.lineTo(-0.03, -0.108); side.lineTo(-0.074, -0.108); side.lineTo(-0.058, 0); side.lineTo(-0.066, 0.012);
  const frame = new THREE.ExtrudeGeometry(side, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
  frame.translate(0, 0, -0.013);
  frame.rotateY(-Math.PI / 2);
  const tube = new THREE.CylinderGeometry(0.021, 0.021, 0.15, 16).rotateX(Math.PI / 2).translate(0, 0.03, 0.085);
  const collar = new THREE.CylinderGeometry(0.026, 0.026, 0.022, 16).rotateX(Math.PI / 2).translate(0, 0.03, 0.152);
  const tip = new THREE.ConeGeometry(0.011, 0.045, 10).rotateX(Math.PI / 2).translate(0, 0.03, 0.188);
  const prongs = [0, 1, 2].map((k) => new THREE.BoxGeometry(0.005, 0.03, 0.012).translate(0, 0.02, 0.172).rotateZ(k * Math.PI * 2 / 3).translate(0, 0.03, 0));
  const plain = (g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; };
  const body = new THREE.Mesh(mergeGeometries([plain(frame)]), new THREE.MeshStandardNodeMaterial({ color: 0xc8581c, roughness: 0.62, metalness: 0.05 }));
  const steel = new THREE.Mesh(mergeGeometries([tube, collar, tip, ...prongs].map(plain)), new THREE.MeshStandardNodeMaterial({ color: 0x2b3036, roughness: 0.38, metalness: 0.85 }));
  body.geometry.computeVertexNormals();
  body.castShadow = steel.castShadow = true;
  body.name = 'Levier frame'; steel.name = 'Levier tube';
  const root = new THREE.Group();
  root.name = 'Levier';
  return root.add(body, steel);
}

// A low-slung leather holster, modelled round the pistol in the pistol's own space so that it sits wherever the
// holstered pistol does: a pouch over the slide and trigger guard, open at the top, on a drop strap from the belt.
function holster() {
  const side = new THREE.Shape();
  // side profile in (z along the barrel, y up): mouth at the back, toe at the muzzle
  side.moveTo(-0.012, 0.09); side.lineTo(0.165, 0.086); side.quadraticCurveTo(0.192, 0.082, 0.19, 0.058);
  side.lineTo(0.184, 0.04); side.lineTo(0.1, 0.006); side.quadraticCurveTo(0.07, -0.014, 0.036, -0.006);
  side.lineTo(0.02, 0.012); side.quadraticCurveTo(-0.004, 0.03, -0.012, 0.09);
  const pouch = new THREE.ExtrudeGeometry(side, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 2, curveSegments: 6 });
  // the shape was drawn in (x → z, y): turn it so its depth runs across the weapon
  pouch.translate(0, 0, -0.02);
  pouch.rotateY(-Math.PI / 2);
  // the strap from the pouch up to the belt, against the leg (the leg is on the weapon's +X side when holstered)
  const drop = new THREE.BoxGeometry(0.005, 0.05, 0.15).translate(0.025, 0.05, -0.05);
  const loop = new THREE.BoxGeometry(0.01, 0.06, 0.045).translate(0.025, 0.05, -0.13);
  const keeper = new THREE.BoxGeometry(0.05, 0.014, 0.012).translate(0.002, 0.089, 0.05);
  const geometry = mergeGeometries([pouch.toNonIndexed(), drop.toNonIndexed(), loop.toNonIndexed(), keeper.toNonIndexed()].map((g) => { g.deleteAttribute('uv'); return g; }));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, leather);
  mesh.castShadow = true;
  mesh.name = 'holster';
  return new THREE.Group().add(mesh);
}

function createWeaponModel(kind) {
  const model = templates.get(kind)?.clone(true);
  if (!model) return null;
  model.userData.action = model.getObjectByName('action') ?? null;
  model.userData.magazine = model.getObjectByName('magazine') ?? null;
  model.matrixAutoUpdate = false;
  return model;
}

// The magazine leaves its well, disappears at the belt, then seats before the action is worked. The pump
// follows a delayed mechanical stroke, while self-loading actions cycle immediately after each shot.
function animateWeapon(model, kind, shotAge, reload) {
  const action = model.userData.action, mag = model.userData.magazine;
  if (!action && !mag) return;
  const reloading = reload >= 0 && reload <= 1;
  let cycle = Math.exp(-shotAge * 38);
  if (kind === 'shotgun') cycle = Math.max(0, 1 - Math.abs(shotAge - 0.26) / 0.16);
  if (reloading && reload > 0.78) cycle = Math.max(cycle, Math.sin(Math.min(1, (reload - 0.78) / 0.18) * Math.PI));
  if (action) { action.position.z = -cycle * (action.userData.travel ?? (kind === 'shotgun' ? 0.085 : kind === 'pistol' ? 0.032 : 0.038)); action.updateMatrix(); }
  if (mag) {
    const extraction = reloading ? Math.max(0, Math.min(1, (reload - 0.13) / 0.13, (0.71 - reload) / 0.13)) : 0;
    mag.position.y = -extraction * 0.16;
    mag.visible = !reloading || reload < 0.29 || reload > 0.51;
    mag.updateMatrix();
  }
}

export { loadWeaponModels, loadWeapon, parseWeapon, createWeaponModel, animateWeapon, GUNS };
