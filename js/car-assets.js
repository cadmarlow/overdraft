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
  floor,
  fract,
  length,
  max,
  min,
  mix,
  normalize,
  normalLocal,
  normalView,
  normalWorld,
  pmremTexture,
  frontFacing,
  positionLocal,
  positionView,
  positionViewDirection,
  positionWorld,
  pow,
  select,
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
import { cabinLayout } from './car-cabin.js';

// The real cars (tools/cars/import-cars.mjs): one atlas per model holding every part, the paint as a mask so the same model
// takes any colour, wheels apart around their axles, and a coarse shell for far away. Bodies are deformed in the vertex
// stage by up to DENTS impact points, cheap enough to leave on for every driven car.

const base = new URL('../assets/cars/', import.meta.url);
const DENTS = 6;
const LAMPS_OFF = 256; // added to an instance's style code (carState.w): headlights and tail lamps dark
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
    lamps: [front[1], rear[1]], lampX: [Math.abs(front[0]), Math.abs(rear[0])],
    cabin: cabinLayout(s, model.glass, position)
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

// The street a car stands in, mirrored in its paint and glass: the scene's sky over the rooftops, facades with their
// windows up to them (lit at night), the road below the horizon. A street is four walls round the car, given as the world
// x+, x-, z+, z- planes and their heights (set for the player's car from the buildings around it, gameplay.js), or, while
// `absolute` is 0, a canyon of typical size round wherever the surface is (traffic). Rough surfaces see the facades blur
// into their average, far ones fade into the sky.
const STREET = { width: 13, depth: 11, height: 36 };
const createStreet = () => ({
  walls: uniform(new THREE.Vector4(STREET.width, -STREET.width, STREET.depth, -STREET.depth)),
  heights: uniform(new THREE.Vector4(STREET.height, STREET.height, STREET.height, STREET.height)),
  absolute: uniform(0)
});
const BRICK = vec3(0.36, 0.2, 0.15), STONE = vec3(0.56, 0.5, 0.42), CONCRETE = vec3(0.42, 0.42, 0.42), TOWER = vec3(0.12, 0.16, 0.2);

function streetRadiance(dir, level, env, street) {
  const d = normalize(dir), p = positionWorld, rel = street.absolute.oneMinus();
  const sky = (v, l) => (env ? pmremTexture(env, v, l) : mix(vec3(0.42, 0.45, 0.48), vec3(0.45, 0.62, 0.9), v.y.max(0)));
  const w = street.walls, ht = street.heights;
  const xp = mix(w.x, p.x.add(w.x), rel), xn = mix(w.y, p.x.add(w.y), rel);
  const zp = mix(w.z, p.z.add(w.z), rel), zn = mix(w.w, p.z.add(w.w), rel);
  // Along the ray to the wall it heads for, on each axis, and how high it meets that wall
  const tx = select(d.x.greaterThan(0), xp.sub(p.x), p.x.sub(xn)).div(d.x.abs().max(1e-4));
  const tz = select(d.z.greaterThan(0), zp.sub(p.z), p.z.sub(zn)).div(d.z.abs().max(1e-4));
  const yx = p.y.add(d.y.mul(tx)), yz = p.y.add(d.y.mul(tz));
  const okX = step(0, tx).mul(step(yx, select(d.x.greaterThan(0), ht.x, ht.y))).mul(step(0, yx));
  const okZ = step(0, tz).mul(step(yz, select(d.z.greaterThan(0), ht.z, ht.w))).mul(step(0, yz));
  const useX = okX.mul(max(step(tx, tz), okZ.oneMinus()));
  const wall = max(useX, okZ.mul(useX.oneMinus()));
  const t = mix(tz, tx, useX), y = mix(yz, yx, useX);
  const along = mix(p.x.add(d.x.mul(t)), p.z.add(d.z.mul(t)), useX);
  // A facade: one building every 24 m of its own stone, bays of windows over a ground floor of shops
  const lot = floor(along.div(24)).add(useX.mul(31));
  const pick = fract(sin(lot.mul(12.9898)).mul(43758.5453));
  const albedo = mix(mix(BRICK, STONE, step(0.4, pick)), mix(CONCRETE, TOWER, step(0.86, pick)), step(0.66, pick));
  const bay = along.div(1.9), storey = y.div(3.3);
  const pane = step(0.2, fract(bay)).mul(step(fract(bay), 0.8)).mul(step(0.3, fract(storey))).mul(step(fract(storey), 0.85)).mul(step(4.2, y));
  // As bright as the city looks next to its sky: a facade in shade a third of the sky at the horizon, one the sun faces
  // nearly as bright as it (albedos are relative to an average facade's)
  const horizon = sky(normalize(vec3(d.x, 0.08, d.z)), float(1));
  const facing = mix(vec3(0, 0, d.z.sign().negate()), vec3(d.x.sign().negate(), 0, 0), useX);
  const sunlit = dot(facing, cityUniforms.uSkySunDir).max(0).mul(cityUniforms.uSkySunDir.y.max(0).mul(4).min(1));
  const stone = albedo.div(0.38).mul(horizon).mul(sunlit.mul(0.6).add(0.34));
  const glass = sky(vec3(d.x.negate(), d.y, d.z.negate()), level.add(0.06)).mul(0.55);
  const room = fract(sin(floor(bay).mul(7.13).add(floor(storey).mul(19.7)).add(lot)).mul(9187.31));
  const lit = vec3(1, 0.72, 0.42).mul(step(0.58, room)).mul(smoothstep(0.55, 1.1, cityUniforms.uInteriorGlow)).mul(0.9);
  const facade = mix(mix(stone, glass.add(lit), pane), mix(stone, glass, 0.3), smoothstep(0.08, 0.42, level));
  const road = horizon.mul(0.3);
  const open = mix(sky(d, level), road, smoothstep(-0.005, -0.06, d.y));
  return mix(open, mix(facade, sky(d, level), smoothstep(70, 240, t)), wall);
}

class StreetReflectionNode extends THREE.Node {
  constructor(street) {
    super('vec3');
    this.street = street;
  }

  setup(builder) {
    const context = builder.context;
    const dir = context.getUV ? context.getUV(this, builder) : normalWorld;
    const level = context.getTextureLevel ? context.getTextureLevel(this) : float(1);
    const env = builder.scene?.environment ?? null;
    // The diffuse light (a constant level) stays the sky's: the street only shows in what the surface mirrors, or the
    // lower panels, facing the road, went black
    if (env && dir === normalWorld) return pmremTexture(env, dir, level);
    return streetRadiance(dir, level, env, this.street);
  }
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
  // A driven car is drawn from both sides: its inside closes the cabin, the street does not show through the doors
  const inside = instanced ? float(0) : float(frontFacing).oneMinus();
  if (!instanced) mat.side = THREE.DoubleSide;
  const mask = surface.r.mul(inside.oneMinus());
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
    // The panels' inside faces are the cabin's trim, seen through the glass
    if (!instanced) c.assign(mix(c, vec3(0.085, 0.08, 0.075), inside));
    return c;
  })();
  const gloss = mix(float(0.2), float(0.34), mask.oneMinus());
  mat.roughnessNode = mix(mix(mix(surface.g.max(0.24), gloss, mask).add(dentNode.mul(0.4)), float(0.07), glassMask), float(0.9), inside);
  // Car paint is coloured underneath and mirrors through its clear coat: a little metal for the flake, the coat does the rest
  mat.metalnessNode = mix(mix(surface.b, float(instanced ? 0.42 : 0.18), mask), float(0.1), glassMask).mul(inside.oneMinus());
  if (physical) {
    mat.clearcoatNode = mask.mul(dentNode.oneMinus());
    mat.clearcoatRoughnessNode = float(0.04);
  }
  mat.envMapIntensity = 1.5;
  const street = createStreet();
  mat.envNode = new StreetReflectionNode(street);

  const glow = cityUniforms.uInteriorGlow;
  const night = smoothstep(0.6, 1.15, glow);
  const blink = state.y.mul(step(0, side)).add(state.z.mul(step(side, 0)));
  // A parked car's lamps are off: parking.js sets LAMPS_OFF in the style code (bit 8, above the style fields)
  const lampsOn = instanced ? step(state.w, float(LAMPS_OFF - 0.5)) : float(1);
  mat.emissiveNode = Fn(() => {
    const e = vec3(0).toVar();
    e.addAssign(base.rgb.mul(head).mul(night.mul(5).add(0.6)).mul(lampsOn));
    e.addAssign(vec3(1, 0.03, 0.05).mul(brake).mul(state.x.mul(5).add(night.mul(1.1)).add(0.08)));
    e.addAssign(vec3(1, 0.5, 0.08).mul(blinker).mul(blink.mul(4)));
    if (!instanced) e.addAssign(vec3(0.9, 0.95, 1).mul(reverse).mul(state.w.mul(3)));
    return e.mul(inside.oneMinus());
  })();
  mat.userData.carState = stateUniform;
  mat.userData.paint = paintUniform;
  mat.userData.dents = dents;
  mat.userData.dentDirs = dentDirs;
  mat.userData.street = street;
  mat.userData.shared = instanced; // one material for every car of the model in the traffic
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
  // With someone at the wheel the glass clears to show them: tinted but see-through face on, a mirror at a glance
  const clear = uniform(0);
  const glance = float(1).sub(dot(normalView, positionViewDirection).abs()).pow(3);
  const tinted = float(Math.min(0.86, model.glassAlpha + 0.1));
  const outside = mix(tinted, mix(float(0.3), float(0.88), glance), clear);
  // From the driver's side the glass must transmit the road, rather than applying its exterior mirror tint again.
  mat.opacityNode = mix(mix(float(0.08), outside, float(frontFacing)), float(0.95), lines);
  mat.roughnessNode = mix(float(0.03), float(0.5), lines);
  mat.metalnessNode = float(0.05);
  mat.specularIntensityNode = float(1);
  mat.envMapIntensity = 2.2;
  mat.envNode = new StreetReflectionNode(carMaterial.userData.street);
  mat.userData.clear = clear;
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

export { DENTS, FLAG, LAMPS_OFF, carSpecs, createBodyMaterial, createGlassMaterial, createWheelMaterial, loadCars, models as carModels, trafficMaterial, withWheels };
