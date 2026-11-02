import * as THREE from 'three/webgpu';
import {
  Fn,
  attribute,
  clamp,
  cross,
  dFdx,
  dFdy,
  dot,
  float,
  length,
  mix,
  normalize,
  normalLocal,
  normalView,
  positionLocal,
  positionView,
  positionViewDirection,
  pow,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uniformArray,
  uv,
  varying,
  vec3,
  vec4
} from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';

// The real cars (tools/cars/import-cars.mjs): one atlas per model holding every part, the paint as a mask so the same model
// takes any colour, wheels apart around their axles, and a coarse shell for far away. Bodies are deformed in the vertex
// stage by up to DENTS impact points, cheap enough to leave on for every driven car.

const base = new URL('../assets/cars/', import.meta.url);
const DENTS = 6;
const models = {};
const carSpecs = {}; // what the game asks of a body kind: its size, axles, lamps, doors
const FLAG = { HEAD: 1, BRAKE: 2, REVERSE: 3, BLINKER: 4, GLASS: 6 };
let manifest = null;

const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none' });
async function loadTexture(name, color) {
  const map = new THREE.Texture(await loader.loadAsync(new URL(name, base).href));
  map.flipY = false;
  map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.anisotropy = 8;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.needsUpdate = true;
  return map;
}

async function loadModel(id) {
  const entry = manifest[id];
  const [buffer, map, surface] = await Promise.all([
    fetch(new URL(`${id}.bin`, base)).then((r) => r.arrayBuffer()), loadTexture(`${id}_c.webp`, true), loadTexture(`${id}_m.webp`, false)
  ]);
  const n = entry.vertices;
  let at = 0;
  const take = (Type, count, pad = 0) => { const a = new Type(buffer, at, count); at += a.byteLength + pad; return a; };
  const position = new THREE.BufferAttribute(take(Float32Array, n * 3), 3);
  const normal = new THREE.BufferAttribute(take(Int8Array, n * 4), 4, true);
  const uvs = new THREE.BufferAttribute(take(Uint16Array, n * 2), 2, true);
  // Flags widen to floats: a shader attribute cannot read single unnormalised bytes
  const flag = new THREE.BufferAttribute(Float32Array.from(take(Uint8Array, n, (4 - n % 4) % 4)), 1);
  const index = new Uint32Array(buffer, at, entry.indices);
  const part = (start, count) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', position);
    g.setAttribute('normal', normal);
    g.setAttribute('uv', uvs);
    g.setAttribute('flag', flag);
    g.setIndex(new THREE.BufferAttribute(index.subarray(start, start + count), 1));
    g.computeBoundingSphere();
    return g;
  };
  const r = entry.ranges;
  const model = {
    id, spec: entry.spec, glassAlpha: entry.glass.alpha, map, surface,
    body: part(r[0], r[1]), glass: part(r[2], r[3]), shell: part(r[0], r[1] + r[3]), far: part(r[4], r[5]),
    wheels: [0, 1, 2, 3].map((i) => part(r[6 + i * 2], r[7 + i * 2]))
  };
  models[id] = model;
  carSpecs[id] = describe(model, position);
  return model;
}

function describe(model, position) {
  const s = model.spec;
  const shell = model.shell.index.array;
  let roofZ = 0, n = 0;
  for (const i of shell) if (position.getY(i) > s.height - 0.05) { roofZ += position.getZ(i); n++; }
  const front = s.head ?? [s.halfW * 0.7, 0.68, s.zFront], rear = s.tail ?? [s.halfW * 0.7, 0.86, s.zRear];
  return {
    ...s, name: model.id,
    wheelZ: (s.wheelZf - s.wheelZr) / 2, wheelMid: (s.wheelZf + s.wheelZr) / 2,
    roofZ: n ? roofZ / n : 0,
    doors: [s.wheelZf - s.wheelRadius * 1.3, s.wheelZf - s.wheelRadius * 1.3 - Math.min(1.25, (s.wheelZf - s.wheelZr) * 0.42)],
    headlight: [Math.abs(front[0]), front[1]], taillight: [Math.abs(rear[0]), rear[1]],
    lamps: [front[1], rear[1]], lampX: [Math.abs(front[0]), Math.abs(rear[0])]
  };
}

// The body with its wheels in place: one mesh for cars seen from afar on the parkways
function withWheels(model) {
  if (model.full) return model.full;
  const positions = [], normals = [], uvs = [], flags = [], index = [];
  const add = (g, ox, oy, oz) => {
    const base = positions.length / 3, p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv, f = g.attributes.flag;
    const map = new Map();
    for (const i of g.index.array) {
      if (!map.has(i)) {
        map.set(i, base + map.size);
        positions.push(p.getX(i) + ox, p.getY(i) + oy, p.getZ(i) + oz);
        normals.push(n.getX(i), n.getY(i), n.getZ(i));
        uvs.push(t.getX(i), t.getY(i));
        flags.push(f.getX(i));
      }
      index.push(map.get(i));
    }
  };
  add(model.shell, 0, 0, 0);
  model.wheels.forEach((w, i) => add(w, ...model.spec.wheels[i]));
  const full = new THREE.BufferGeometry();
  full.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  full.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  full.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  full.setAttribute('flag', new THREE.Float32BufferAttribute(flags, 1));
  full.setIndex(index);
  full.computeBoundingSphere();
  return (model.full = full);
}

async function loadCars(ids) {
  manifest ??= await fetch(new URL('models.json', base)).then((r) => r.json());
  await Promise.all((ids ?? Object.keys(manifest)).filter((id) => !models[id]).map(loadModel));
  return models;
}

// The bodywork: paint where the mask says, the model's own texture elsewhere, lamps lit by state
function createBodyMaterial(model, { paint = null, instanced = false, livery = 0, physical = !instanced } = {}) {
  const mat = physical ? new THREE.MeshPhysicalNodeMaterial() : new THREE.MeshStandardNodeMaterial();
  const stateUniform = uniform(new THREE.Vector4(0, 0, 0, 0));
  const paintUniform = uniform(new THREE.Color(paint ?? 0xffffff));
  const dents = instanced ? null : uniformArray(Array.from({ length: DENTS }, () => new THREE.Vector4(0, 0, 0, 0)));
  const dentDirs = instanced ? null : uniformArray(Array.from({ length: DENTS }, () => new THREE.Vector4(0, 0, 0, 0)));
  const paintNode = instanced ? varying(attribute('paintColor', 'vec3')) : paintUniform;
  const state = instanced ? varying(attribute('carState', 'vec4')) : stateUniform;
  const flag = attribute('flag', 'float');
  const isFlag = (id) => step(float(id - 0.5), flag).mul(step(flag, float(id + 0.5)));
  const glassMask = varying(isFlag(FLAG.GLASS));
  const head = varying(isFlag(FLAG.HEAD)), brake = varying(isFlag(FLAG.BRAKE)), reverse = varying(isFlag(FLAG.REVERSE)), blinker = varying(isFlag(FLAG.BLINKER));
  const side = varying(positionLocal.x);
  const alongCar = varying(positionLocal.z);

  const surface = texture(model.surface, uv());
  const base = texture(model.map, uv());
  const mask = surface.r;
  let dentNode = float(0);

  if (dents) {
    // Each impact pulls the panels around it in along its own direction, in folds rather than as a smooth bowl
    const displaced = Fn(() => {
      const p = positionLocal.toVar();
      const crush = float(0).toVar();
      for (let i = 0; i < DENTS; i++) {
        const dent = dents.element(i), dir = dentDirs.element(i);
        const d = length(positionLocal.sub(dent.xyz)).div(dir.w.max(0.1));
        const falloff = smoothstep(1, 0, d).mul(dent.w);
        const folds = sin(positionLocal.x.mul(13).add(positionLocal.y.mul(17)).add(positionLocal.z.mul(11))).mul(0.32).add(0.82);
        p.addAssign(dir.xyz.mul(falloff.mul(folds)));
        crush.addAssign(falloff);
      }
      return vec4(p, crush);
    })();
    mat.positionNode = displaced.xyz;
    dentNode = clamp(varying(displaced.w).mul(5), 0, 1);
    // Crumpled metal catches the light in facets: the face's own normal where the panel moved
    const facet = normalize(cross(dFdx(positionView), dFdy(positionView)));
    mat.normalNode = mix(normalView, facet, dentNode.mul(0.8));
  }

  // Police: white doors on a black car (traffic says so per instance, in the style code of its lamp state)
  const styleCode = state.w.mod(8);
  const liveryOn = instanced ? step(0.5, styleCode).mul(step(styleCode, 1.5)) : float(livery ? 1 : 0);
  const midDoors = (model.spec.wheelZf + model.spec.wheelZr) / 2;
  const doors = smoothstep(0.03, 0.0, alongCar.sub(midDoors).abs().sub(model.spec.wheelZf - midDoors).add(0.4));

  mat.colorNode = Fn(() => {
    const shade = base.rgb.mul(1.65);
    const coat = mix(paintNode, mix(vec3(0.012), vec3(0.8), doors), liveryOn);
    const c = mix(base.rgb, coat.mul(shade), mask).toVar();
    // Paint gone from what scraped the road: bare grey metal with a rust edge
    c.assign(mix(c, vec3(0.2, 0.19, 0.18), dentNode.mul(mask).mul(0.7)));
    c.assign(mix(c, vec3(0.01, 0.012, 0.015), glassMask));
    return c;
  })();
  const gloss = mix(float(0.2), float(0.34), mask.oneMinus());
  mat.roughnessNode = mix(mix(surface.g.max(0.24), gloss, mask).add(dentNode.mul(0.4)), float(0.07), glassMask);
  mat.metalnessNode = mix(mix(surface.b, float(0.42), mask), float(0.1), glassMask);
  if (physical) {
    mat.clearcoatNode = mask.mul(dentNode.oneMinus());
    mat.clearcoatRoughnessNode = float(0.04);
  }
  mat.envMapIntensity = 1.5;

  const glow = cityUniforms.uInteriorGlow;
  const night = smoothstep(0.6, 1.15, glow);
  const blink = state.y.mul(step(0, side)).add(state.z.mul(step(side, 0)));
  mat.emissiveNode = Fn(() => {
    const e = vec3(0).toVar();
    e.addAssign(base.rgb.mul(head).mul(night.mul(5).add(0.6)));
    e.addAssign(vec3(1, 0.03, 0.05).mul(brake).mul(state.x.mul(5).add(night.mul(1.1)).add(0.08)));
    e.addAssign(vec3(1, 0.5, 0.08).mul(blinker).mul(blink.mul(4)));
    if (!instanced) e.addAssign(vec3(0.9, 0.95, 1).mul(reverse).mul(state.w.mul(3)));
    return e;
  })();
  mat.userData.carState = stateUniform;
  mat.userData.paint = paintUniform;
  mat.userData.dents = dents;
  mat.userData.dentDirs = dentDirs;
  return mat;
}

function createGlassMaterial(model, carMaterial) {
  const mat = new THREE.MeshPhysicalNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const dents = carMaterial.userData.dents, dirs = carMaterial.userData.dentDirs;
  const tint = texture(model.map, uv());
  // Shattered where the car took a blow: the pane frosts over in a web of cracks
  const cracked = Fn(() => {
    const crack = float(0).toVar();
    for (let i = 0; i < DENTS; i++) {
      const dent = dents.element(i), dir = dirs.element(i);
      crack.addAssign(smoothstep(1.3, 0.2, length(positionLocal.sub(dent.xyz)).div(dir.w.max(0.1))).mul(smoothstep(0.02, 0.18, dent.w)));
    }
    return clamp(crack, 0, 1);
  })();
  const web = sin(positionLocal.x.mul(47).add(positionLocal.y.mul(61))).mul(sin(positionLocal.z.mul(53).sub(positionLocal.y.mul(37)))).abs();
  const lines = smoothstep(0.02, 0.0, web).mul(varying(cracked));
  mat.colorNode = mix(tint.rgb.mul(0.2), vec3(0.78), lines);
  mat.opacityNode = mix(float(Math.min(0.86, model.glassAlpha + 0.1)), float(0.95), lines);
  mat.roughnessNode = mix(float(0.03), float(0.5), lines);
  mat.metalnessNode = float(0.05);
  mat.specularIntensityNode = float(1);
  mat.envMapIntensity = 2.2;
  return mat;
}

// One per model for the street's traffic
const instancedMaterials = new Map();
function trafficMaterial(id) {
  if (!instancedMaterials.has(id)) instancedMaterials.set(id, createBodyMaterial(models[id], { instanced: true }));
  return instancedMaterials.get(id);
}

// A wheel: rubber and alloy from the atlas
const wheelMaterials = new Map();
function createWheelMaterial(model) {
  if (wheelMaterials.has(model.id)) return wheelMaterials.get(model.id);
  const mat = new THREE.MeshStandardNodeMaterial();
  wheelMaterials.set(model.id, mat);
  const surface = texture(model.surface, uv());
  mat.colorNode = texture(model.map, uv()).rgb;
  mat.roughnessNode = surface.g.max(0.18);
  mat.metalnessNode = surface.b;
  mat.envMapIntensity = 1.3;
  return mat;
}

export { DENTS, FLAG, carSpecs, createBodyMaterial, createGlassMaterial, createWheelMaterial, loadCars, models as carModels, trafficMaterial, withWheels };
