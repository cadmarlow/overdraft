import * as THREE from 'three/webgpu';
import { texture, uniform, uv } from 'three/tsl';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createWeaponModel } from './weapon-models.js';
import { ground } from './ground-assets.js';
import { KIT, kitProp } from './calibre-kit.js';
import { PRINTS, PRINT_SIZE, paintPrints } from './calibre-prints.js';

// The workshop of CALIBRE's interiors: the materials of a branch and a builder that gathers boxes, panels, prints,
// props of the kit (calibre-kit.js) and weapons into one mesh per material. calibre-room.js draws the branch with it.

// What the sky gives a surface indoors (every material here), against 1 in the street: the room is lit by its lamps
const INDOOR = { ambient: uniform(0.16), glow: uniform(1) };

function printTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PRINT_SIZE;
  paintPrints(canvas.getContext('2d'));
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.name = 'calibre/prints';
  return map;
}

function createMaterials() {
  const make = (options) => {
    const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0, vertexColors: true, ...options });
    material.aoNode = INDOOR.ambient;
    return material;
  };
  // a photographed surface of the kit (colour, normal, roughness); plain paint until the kit is there
  const surface = (name, options = {}) => {
    const s = KIT.surfaces[name];
    return make(s ? { map: s.color, normalMap: s.normal, roughnessMap: s.rough, roughness: 1, ...options } : options);
  };
  const prints = printTexture();
  const m = {
    plaster: surface('plaster', { roughness: 0.9 }),
    slats: surface('slats', { roughness: 0.75 }),
    foam: surface('foam', { roughness: 1 }),
    plate: surface('plate', { roughness: 0.7, metalness: 0.6 }),
    rubber: surface('rubber', { roughness: 0.95 }),
    ceiling: surface('ceiling', { roughness: 0.95 }),
    paint: make({ roughness: 0.62 }),
    satin: make({ roughness: 0.34 }),
    metal: make({ roughness: 0.36, metalness: 1 }),
    fabric: make({ roughness: 0.96 }),
    print: make({ map: prints, roughness: 0.78 }),
    // lit boxes and screens: the sheet shines by itself
    glow: make({ map: prints, emissive: 0xffffff, emissiveMap: prints, emissiveIntensity: 1.2, roughness: 0.5 }),
    // glass tubes, cut out of the sheet by its alpha
    neon: make({ map: prints, emissive: 0xffffff, emissiveMap: prints, emissiveIntensity: 0.62, alphaTest: 0.32, side: THREE.DoubleSide }),
    bulb: make({ color: 0x000000, emissive: 0xffd9a6, emissiveIntensity: 6 }),
    tube: make({ color: 0x000000, emissive: 0xe6efff, emissiveIntensity: 4.5 }),
    led: make({ color: 0x000000, emissive: 0xfff0d2, emissiveIntensity: 2.2 }),
    // clear glass: almost nothing but its reflections
    glass: new THREE.MeshStandardNodeMaterial({ color: 0x18221e, transparent: true, opacity: 0.1, metalness: 0, roughness: 0.04, depthWrite: false, side: THREE.DoubleSide }),
    // the kit's props read one atlas; its lamps shine by themselves
    kit: make(KIT.maps ? { map: KIT.maps.color, normalMap: KIT.maps.normal, roughnessMap: KIT.maps.orm, metalnessMap: KIT.maps.orm, roughness: 1, metalness: 1,
      emissive: 0xffffff, emissiveMap: KIT.maps.emissive, emissiveIntensity: 5 } : { color: 0x6c6f66 })
  };
  // polished concrete: the street's trowelled slab, sealed (its normal map carries the roughness in alpha)
  const slab = ground.trowel;
  m.floor = make(slab ? { map: slab.color, normalMap: slab.normal } : { color: 0x55554f });
  if (slab?.normal) m.floor.roughnessNode = texture(slab.normal, uv()).a.mul(0.5).add(0.14);
  for (const [name, material] of Object.entries(m)) material.name = `calibre/${name}`;
  return m;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
// A placement: position, then turns about Y, X, Z (radians), then a scale
function at(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));
}

// Texture coordinates in metres from where a face is in the room, so that a photograph runs unbroken across pieces
function projectUV(geometry, metres, turn) {
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  const out = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const ax = Math.abs(normal.getX(i)), ay = Math.abs(normal.getY(i)), az = Math.abs(normal.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = position.getX(i); v = position.getZ(i); }
    else if (ax >= az) { u = position.getZ(i); v = position.getY(i); }
    else { u = position.getX(i); v = position.getY(i); }
    out[i * 2] = (turn ? v : u) / metres; out[i * 2 + 1] = (turn ? u : v) / metres;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(out, 2));
}

// The weapons of the game as plain geometry, one piece per material, for the displays
const baked = new Map();
function bakeWeapon(kind) {
  if (baked.has(kind)) return baked.get(kind);
  const model = createWeaponModel(kind), parts = [];
  model?.traverse((o) => {
    if (!o.isMesh || !o.geometry.index) return;
    const g = o.geometry, index = g.index.array, { start, count } = g.drawRange;
    const end = Number.isFinite(count) ? start + count : index.length;
    const seen = new Map(), P = [], N = [], U = [], I = [];
    const pos = g.attributes.position.array, nor = g.attributes.normal.array, tex = g.attributes.uv.array;
    for (let i = start; i < end; i++) {
      const v = index[i];
      let k = seen.get(v);
      if (k === undefined) {
        k = P.length / 3; seen.set(v, k);
        P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); N.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]); U.push(tex[v * 2], tex[v * 2 + 1]);
      }
      I.push(k);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    geometry.setIndex(I);
    parts.push({ geometry, material: o.material });
  });
  baked.set(kind, parts);
  return parts;
}

class Builder {
  /**
   * @param {object} materials - by name
   * @param {object} prints - the sheet's rectangles by name ([u0, v0, u1, v1], v down); CALIBRE's unless given
   * @param {string} label - the meshes' name prefix
   */
  constructor(materials, prints = PRINTS, label = 'Calibre') {
    this.materials = materials;
    this.prints = prints;
    this.label = label;
    this.batches = new Map(); // a material name, or a weapon's own material -> geometries in room space
  }

  // Everything goes through here: indexed, with position / normal / uv / colour and nothing else
  push(key, geometry, matrix = null, { color = 0xffffff, tile = 0, turn = false } = {}) {
    if (!geometry) return null;
    let g = geometry.index ? geometry : mergeVertices(geometry);
    if (matrix) g.applyMatrix4(matrix);
    if (tile) projectUV(g, tile, turn);
    else if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    const n = g.attributes.position.count, colors = new Float32Array(n * 3);
    _c.set(color);
    for (let i = 0; i < n; i++) { colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!this.batches.has(key)) this.batches.set(key, []);
    this.batches.get(key).push(g);
    return g;
  }

  // A block given by its extents
  slab(key, x0, x1, y0, y1, z0, z1, options) {
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
    return this.push(key, new THREE.BoxGeometry(w, h, d), at((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), options);
  }
  // A block given by its centre and size, turned about Y (then X, Z)
  box(key, x, y, z, w, h, d, { ry = 0, rx = 0, rz = 0, ...options } = {}) {
    return this.push(key, new THREE.BoxGeometry(w, h, d), at(x, y, z, ry, rx, rz), options);
  }
  // A rod along an axis ('x', 'y' or 'z')
  rod(key, x, y, z, radius, length, axis = 'y', { segments = 10, ...options } = {}) {
    const g = new THREE.CylinderGeometry(radius, radius, length, segments);
    return this.push(key, g, at(x, y, z, 0, axis === 'z' ? Math.PI / 2 : 0, axis === 'x' ? Math.PI / 2 : 0), options);
  }
  // A print of the sheet, `width` metres wide, facing +z before `matrix`; its height follows the print's proportions
  print(name, width, matrix, key = 'print', height = 0) {
    const rect = this.prints[name];
    if (!rect) { console.warn(`[${this.label}] no print named ${name}`); return 0; }
    const [u0, v0, u1, v1] = rect;
    const h = height || width * (v1 - v0) / (u1 - u0);
    const g = new THREE.PlaneGeometry(width, h), t = g.attributes.uv;
    for (let i = 0; i < t.count; i++) t.setXY(i, u0 + t.getX(i) * (u1 - u0), 1 - (v0 + (1 - t.getY(i)) * (v1 - v0)));
    this.push(key, g, matrix);
    return h;
  }
  // A round print (a projecting sign's face): the sheet's square, cut to its inscribed circle, facing +z before `matrix`
  disc(name, radius, matrix, key = 'print') {
    const rect = this.prints[name];
    if (!rect) return;
    const [u0, v0, u1, v1] = rect;
    const g = new THREE.CircleGeometry(radius, 40), t = g.attributes.uv;
    for (let i = 0; i < t.count; i++) t.setXY(i, u0 + t.getX(i) * (u1 - u0), 1 - (v0 + (1 - t.getY(i)) * (v1 - v0)));
    this.push(key, g, matrix);
  }
  // A prop of the kit, standing on its anchor
  prop(name, x, y, z, ry = 0, scale = 1, color = 0xffffff) {
    const g = KIT.ready ? kitProp(name) : null;
    if (!g) return false;
    this.push('kit', g, at(x, y, z, ry, 0, 0, scale), { color });
    return true;
  }
  // A prop's own geometry, to place by hand (null without the kit)
  kit(name) { return KIT.ready ? kitProp(name) : null; }
  // A weapon of the game: +z of its own space along the barrel, +y its top
  gun(kind, matrix) {
    for (const part of bakeWeapon(kind)) this.push(part.material, part.geometry.clone(), matrix);
  }

  // One mesh per material
  finish(group, { shadows = [] } = {}) {
    for (const [key, geometries] of this.batches) {
      const named = typeof key === 'string';
      const mesh = new THREE.Mesh(mergeGeometries(geometries), named ? this.materials[key] : key);
      mesh.name = `${this.label} ${named ? key : key.name}`;
      mesh.castShadow = named && shadows.includes(key);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      for (const g of geometries) g.dispose();
    }
    this.batches.clear();
    return group;
  }
}

export { INDOOR, Builder, createMaterials, bakeWeapon, at };
