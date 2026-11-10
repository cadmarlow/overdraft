import * as THREE from 'three/webgpu';
import { attribute, clamp, dot, float, max, mix, smoothstep, sqrt, texture, uniform, userData, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fitted, finishById } from './weapon-mods.js';
import { buildAttachments } from './weapon-attachments.js';

// The weapons as objects: real models prepared offline (tools/weapons) into assets/weapons, loaded once behind the
// loading screen. Every character shares their geometry and materials; taking one out only instantiates transforms.
// A model's children named `action` (slide, bolt, pump) and `magazine` move; everything is in weapon space (metres, +Z
// along the barrel, +Y its top, +X its left).
//
// A weapon made with `{ dress: true }` (the player's own, the ones on CALIBRE's counter) also carries, hidden, every
// upgrade it can take (weapon-attachments.js) and wears finishes: dressWeapon(model, state) shows what is fitted and
// sets the finish. Dressed weapons share their materials too: the finish of each lives on its meshes (userData), so a
// new one costs no shader, and nothing compiles when an upgrade is bought.

const GUNS = ['pistol', 'smg', 'shotgun', 'rifle'];
const base = new URL('../assets/weapons/', import.meta.url);
const templates = new Map();
let leather = null;
const skins = new Map(); // a template's material → the same, able to wear a finish
const hardware = new Map(); // kind → the attachments machined for it (buildAttachments)
let hardwareMaterial = null;

// Hardware a model came with that CALIBRE now sells or swaps: whole islands of its body lying inside a box (weapon
// space, [x0, y0, z0, x1, y1, z1]) and made of `min` triangles or more become parts of their own. A plain weapon
// draws them as ever; a dressed one shows the foregrip only once bought, and its red dot until a scope replaces it.
const FACTORY = {
  rifle: {
    grip: [{ box: [-0.03, -0.06, 0.08, 0.03, 0.05, 0.14], min: 50 }],
    sight: [{ box: [-0.02, 0.097, -0.15, 0.02, 0.16, -0.07], min: 50 }, { box: [-0.02, 0.125, -0.15, 0.02, 0.16, -0.07], min: 1 }]
  }
};
// Materials that are furniture, not steel (the shotgun's polymer stock and fore-end): they take paint, never plating
const FURNITURE = { shotgun: [0, 2] };

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

// The triangles of whole islands of `part` that `rules` take are moved to the end of its run of the index and leave
// it: returns their own run ({ start, count }), or null when nothing was taken.
function carve(position, index, part, rules) {
  const p = position.array, ix = index.array, { start, count } = part;
  // corners welded by position, then joined triangle by triangle: what stays connected is an island
  const welded = new Map(), parent = [];
  const corner = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const v = ix[start + i] * 3, key = `${Math.round(p[v] * 2e4)},${Math.round(p[v + 1] * 2e4)},${Math.round(p[v + 2] * 2e4)}`;
    let id = welded.get(key);
    if (id === undefined) { id = parent.length; parent.push(id); welded.set(key, id); }
    corner[i] = id;
  }
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  for (let i = 0; i < count; i += 3) { const a = find(corner[i]); parent[find(corner[i + 1])] = a; parent[find(corner[i + 2])] = a; }
  const islands = new Map();
  for (let i = 0; i < count; i += 3) {
    const id = find(corner[i]);
    let island = islands.get(id);
    if (!island) islands.set(id, island = { triangles: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] });
    island.triangles++;
    for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) {
      const value = p[ix[start + i + k] * 3 + c];
      if (value < island.lo[c]) island.lo[c] = value;
      if (value > island.hi[c]) island.hi[c] = value;
    }
  }
  for (const island of islands.values()) {
    island.taken = rules.some(({ box, min }) => island.triangles >= min && island.lo.every((v, c) => v >= box[c]) && island.hi.every((v, c) => v <= box[c + 3]));
  }
  const kept = [], taken = [];
  for (let i = 0; i < count; i += 3) (islands.get(find(corner[i])).taken ? taken : kept).push(ix[start + i], ix[start + i + 1], ix[start + i + 2]);
  if (!taken.length) return null;
  ix.set(kept, start);
  ix.set(taken, start + kept.length);
  part.count = kept.length;
  return { start: start + kept.length, count: taken.length };
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
    material.userData.index = header.materials.indexOf(m); // which of its model's materials this is (FURNITURE)
    return material;
  }));
  const root = new THREE.Group();
  root.name = header.name;
  const body = header.parts.find((part) => part.name === 'body');
  for (const [name, rules] of Object.entries(FACTORY[id] ?? {})) {
    const run = body && carve(position, index, body, rules);
    if (run) header.parts.push({ name: `factory-${name}`, material: body.material, ...run });
  }
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
  prepareDress();
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

// ---- Dressed weapons: upgrades and finishes ---------------------------------------------------------------------------
// The brightness a material's main surface has in its colour map (linear, the median of its unsaturated texels): what
// a finish measures the wear of the texture against
function surfaceBrightness(image) {
  try {
    const size = 64, context = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, size, size);
    const data = context.getImageData(0, 0, size, size).data, values = [];
    const linear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    for (let i = 0; i < data.length; i += 4) {
      const r = linear(data[i]), g = linear(data[i + 1]), b = linear(data[i + 2]), l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (l > 0.002 && (r - b) / Math.max(r, g, b, 0.02) < 0.45) values.push(l);
    }
    values.sort((a, b) => a - b);
    return values.length ? Math.min(0.6, Math.max(0.004, values[values.length >> 1])) : 0.05;
  } catch { return 0.05; }
}

// A weapon's material that can wear a finish: paint or plating laid over what the texture calls steel or polymer
// (grey, black, blued: not warm), leaving wood and red markings alone, and keeping the texture's scratches and grime
// as the wear of the new surface. The finish is read from each mesh (userData.finish), so every dressed weapon of a
// kind shares this one material: `coat` = (linear colour, how much of it), `set` = (metalness, roughness, wear kept).
function finishMaterial(source) {
  if (!source.map || !source.roughnessMap) return source;
  const material = source.clone();
  material.name = `${source.name} (finish)`;
  const coat = userData('finish.coat', 'vec4'), set = userData('finish.set', 'vec4');
  const base = texture(source.map).rgb, orm = texture(source.roughnessMap);
  const warmth = base.r.sub(base.b).div(max(max(base.r, base.g), base.b).max(0.02));
  const cover = coat.w.mul(smoothstep(0.45, 0.7, warmth).oneMinus());
  const wear = clamp(sqrt(dot(base, vec3(0.2126, 0.7152, 0.0722)).div(uniform(surfaceBrightness(source.map.image)))), 0.5, 1.3);
  material.colorNode = mix(base, coat.rgb.mul(mix(float(1), wear, set.z)).min(1), cover);
  material.metalnessNode = mix(orm.b.mul(source.metalness), set.x, cover);
  material.roughnessNode = mix(orm.g.mul(source.roughness), clamp(set.y.add(orm.g.sub(0.5).mul(0.3)), 0.08, 1), cover);
  return material;
}

// Called once the templates are loaded: the finish-wearing twin of every firearm material, the attachments of every
// firearm and the one material they are all drawn with (what each surface is rides on the vertices)
function prepareDress() {
  for (const kind of GUNS) {
    const materials = [];
    templates.get(kind).traverse((o) => { if (o.isMesh && !materials.includes(o.material)) materials.push(o.material); });
    for (const material of materials) {
      const skin = finishMaterial(material);
      skin.userData.furniture = !!FURNITURE[kind]?.includes(material.userData.index);
      skins.set(material, skin);
    }
    hardware.set(kind, buildAttachments(kind));
  }
  hardwareMaterial = new THREE.MeshStandardNodeMaterial();
  hardwareMaterial.name = 'Weapon hardware';
  const tint = attribute('tint', 'vec3'), surface = attribute('surface', 'vec4');
  // what is part of the weapon (surface.w: a longer magazine, a tube) wears its finish; what is bolted on stays black
  const coat = userData('finish.coat', 'vec4'), set = userData('finish.set', 'vec4'), cover = coat.w.mul(surface.w);
  hardwareMaterial.colorNode = mix(tint, coat.rgb, cover);
  hardwareMaterial.metalnessNode = mix(surface.x, set.x, cover);
  hardwareMaterial.roughnessNode = mix(surface.y, set.y, cover);
  hardwareMaterial.emissiveNode = tint.mul(surface.z);
}

/**
 * A weapon of its own for a body or a counter. Its geometry and materials are shared with every other of its kind.
 * @param {string} kind
 * @param {{dress?: boolean}} [options] - dress: a firearm that carries its upgrades and wears finishes; dressWeapon()
 *   then says what shows (nothing fitted and the stock finish until it is called)
 */
function createWeaponModel(kind, { dress = false } = {}) {
  const model = templates.get(kind)?.clone(true);
  if (!model) return null;
  model.userData.action = model.getObjectByName('action') ?? null;
  model.userData.magazine = model.getObjectByName('magazine') ?? null;
  model.matrixAutoUpdate = false;
  if (dress && hardware.has(kind)) {
    const worn = [], parts = {}, swaps = {};
    const finish = { coat: new THREE.Vector4(1, 1, 1, 0), set: new THREE.Vector4(0, 1, 1, 0) }; // the hardware's: one for all of it
    model.traverse((o) => {
      if (!o.isMesh || !skins.has(o.material)) return;
      o.material = skins.get(o.material);
      o.userData.finish = { coat: new THREE.Vector4(1, 1, 1, 0), set: new THREE.Vector4(0, 1, 1, 0) };
      worn.push(o);
    });
    for (const [id, { geometry, on, holster }] of Object.entries(hardware.get(kind))) {
      const mesh = new THREE.Mesh(geometry, hardwareMaterial);
      mesh.name = `${model.name} ${id}`;
      mesh.castShadow = true;
      mesh.userData.finish = finish;
      (model.userData[on] ?? model).add(mesh);
      parts[id] = { objects: [mesh], holster };
    }
    // what the model came with: its foregrip is the upgrade, its red dot gives way to the scope
    const grip = model.getObjectByName('factory-grip'), sight = model.getObjectByName('factory-sight');
    if (grip) parts.grip = { objects: [grip], holster: true };
    if (sight) swaps.sight = sight;
    model.userData.dress = { kind, worn, parts, swaps, finish, fitted: [], stowed: false };
    dressWeapon(model, null);
  }
  return model;
}

function showDress(model) {
  const { parts, swaps, fitted: on, stowed } = model.userData.dress;
  for (const [id, part] of Object.entries(parts)) {
    const visible = on.includes(id) && (part.holster || !stowed);
    for (const object of part.objects) object.visible = visible;
  }
  for (const [id, object] of Object.entries(swaps)) object.visible = !on.includes(id);
}

/**
 * Shows on a dressed weapon what a weapon-mods.js state says: the upgrades fitted (1) and the finish worn. Works on
 * any model made with `{ dress: true }`, on a body or free-standing; a state the player does not own is a preview
 * (withMod(state, 'sight'), { ...state, finish: 'or' }). Nothing is created or compiled.
 */
function dressWeapon(model, state = null) {
  const dress = model?.userData.dress;
  if (!dress) return model;
  dress.fitted = fitted(state).filter((id) => dress.parts[id] || dress.swaps[id]);
  const finish = finishById(state?.finish);
  for (const mesh of dress.worn) {
    const { coat, set } = mesh.userData.finish;
    const worn = finish.kind !== 'stock' && !(finish.kind === 'plating' && mesh.material.userData.furniture);
    coat.set(finish.color[0], finish.color[1], finish.color[2], worn ? 1 : 0);
    set.set(finish.metal, finish.rough, finish.keep, 0);
  }
  dress.finish.coat.set(finish.color[0], finish.color[1], finish.color[2], finish.kind === 'stock' ? 0 : 1);
  dress.finish.set.set(finish.metal, finish.rough, finish.keep, 0);
  showDress(model);
  return model;
}

// A dressed weapon put away or taken out: what its holster has no room for (a pistol's suppressor and sight) comes
// off while it is in there
function stowWeapon(model, stowed) {
  const dress = model?.userData.dress;
  if (!dress || dress.stowed === stowed) return;
  dress.stowed = stowed;
  showDress(model);
}

// Everything a dressed weapon can ever show, at once: drawn like this for one frame behind the loading screen, its
// materials and every attachment are compiled, and buying an upgrade later stalls nothing. dressWeapon() undoes it.
function showEverything(model) {
  const dress = model?.userData.dress;
  if (!dress) return;
  for (const part of Object.values(dress.parts)) for (const object of part.objects) object.visible = true;
  for (const object of Object.values(dress.swaps)) object.visible = true;
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

export { loadWeaponModels, loadWeapon, parseWeapon, createWeaponModel, dressWeapon, stowWeapon, showEverything, animateWeapon, GUNS };
