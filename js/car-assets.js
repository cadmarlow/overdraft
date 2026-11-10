import * as THREE from 'three/webgpu';
import {
  Fn,
  attribute,
  atan,
  bumpMap,
  clamp,
  cos,
  cross,
  dFdx,
  dFdy,
  dot,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  normalize,
  normalMap,
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
  vec2,
  vec3,
  vec4
} from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';
import { traceUrbanReflection } from './urban-light.js';
import { cabinLayout } from './car-cabin.js';
import { openCabinGeometry } from './car-cabin-clearance.js';

// The real cars (tools/cars/import-cars.mjs): one atlas per model holding every part, the paint as a mask so the same model
// takes any colour, wheels apart around their axles, and a coarse shell for far away. Bodies are deformed in the vertex
// stage by up to DENTS impact points, cheap enough to leave on for every driven car.

const base = new URL('../assets/cars/', import.meta.url);
const DENTS = 6;
const LAMPS_OFF = 256; // added to an instance's style code (carState.w): headlights and tail lamps dark
const models = {};
const carSpecs = {}; // what the game asks of a body kind: its size, axles, lamps, doors
// WHEEL + i: the four wheels of a car drawn as one mesh (withWheels), which the street's material turns on their axles
const FLAG = { HEAD: 1, BRAKE: 2, REVERSE: 3, BLINKER: 4, GLASS: 6, WHEEL: 8 };
// Pigment and varnish are separate layers. Commercial vehicles keep a softer solid finish, sports cars a fine metallic.
const FINISH = {
  taxi: [0.27, 0.08, 0.075], van: [0.3, 0.06, 0.09], truck: [0.32, 0.04, 0.11], delivery: [0.3, 0.05, 0.1],
  offroad: [0.29, 0.12, 0.085], pickup: [0.25, 0.18, 0.065], compact: [0.25, 0.1, 0.065],
  sedan: [0.24, 0.26, 0.055], wagon: [0.24, 0.25, 0.055], suv: [0.24, 0.22, 0.06], minivan: [0.27, 0.16, 0.07],
  hatch: [0.22, 0.24, 0.05], muscle: [0.23, 0.22, 0.055], sport: [0.2, 0.3, 0.045], super: [0.19, 0.34, 0.04]
};
let manifest = null;
let surveyedReflections = false; // selected once at loading time, before any car shader is compiled

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

const IDENTITIES = {
  sedan: ['VALMONT', 'ÉCUME'], suv: ['BRISANT', 'RÉCIF'], taxi: ['VALMONT', 'CAB 7'],
  pickup: ['GRÉVILLE', 'FALAISE'], van: ['HAUTURIER', 'CARGO'], minivan: ['GRÉVILLE', 'ESCALE'],
  hatch: ['VALMONT', 'RESSAC'], compact: ['GRÉVILLE', 'GALET'], wagon: ['VALMONT', 'SILLAGE'],
  offroad: ['BRISANT', 'MARAIS'], muscle: ['BRISANT', 'TEMPÊTE'], sport: ['CORSAIRE', 'FOUDRE'],
  super: ['CORSAIRE', 'ZÉNITH'], truck: ['HAUTURIER', 'FRET'], delivery: ['HAUTURIER', 'TOURNÉE']
};
let identityAtlas = null;
function carIdentityAtlas() {
  if (identityAtlas) return identityAtlas;
  const canvas = document.createElement('canvas');canvas.width = 1024;canvas.height = 2048;
  const c = canvas.getContext('2d');
  Object.entries(IDENTITIES).forEach(([, [brand, name]], i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 256;
    c.save();c.translate(x, y);
    c.textAlign = 'center';c.textBaseline = 'middle';c.fillStyle = '#e7edf0';
    c.font = '600 31px sans-serif';c.letterSpacing = '4px';c.fillText(brand, 256, 24);
    c.font = '17px sans-serif';c.letterSpacing = '3px';c.fillText(name, 256, 52);
    c.letterSpacing = '0px';
    c.fillStyle = '#121b24';c.beginPath();c.roundRect(1, 77, 510, 178, 12);c.fill();
    c.fillStyle = '#eeeadd';c.beginPath();c.roundRect(6, 82, 500, 168, 9);c.fill();
    c.fillStyle = '#ba7930';c.fillRect(13, 89, 486, 5);
    c.fillStyle = '#526371';c.font = 'bold 16px sans-serif';c.letterSpacing = '3px';c.fillText('OVERDRAFT', 256, 109);
    c.fillStyle = '#182b3a';c.font = 'bold 76px monospace';c.letterSpacing = '2px';c.fillText('OD–' + String(217 + i * 43).padStart(3, '0'), 256, 169);
    c.font = 'bold 12px sans-serif';c.letterSpacing = '4px';c.fillText('MANHATTAN', 256, 230);
    for (const sx of [32, 480]) for (const sy of [106, 230]) {
      c.fillStyle = '#647077';c.beginPath();c.arc(sx, sy, 3.5, 0, Math.PI * 2);c.fill();
      c.strokeStyle = '#c9cbd0';c.lineWidth = 1;c.beginPath();c.moveTo(sx - 2.5, sy);c.lineTo(sx + 2.5, sy);c.stroke();
    }
    c.restore();
  });
  identityAtlas = new THREE.CanvasTexture(canvas);identityAtlas.colorSpace = THREE.SRGBColorSpace;
  identityAtlas.anisotropy = 8;identityAtlas.name = 'OriginalVehicleIdentities';
  return identityAtlas;
}

// Find the actual front/back body surface at a projected point. Badge/plate projections can then stay on a panel,
// including recessed plates, instead of floating at the car's longest bumper dimension.
function bodySurfaceAt(model, x, y, side) {
  const g = model.body, p = g.attributes.position, n = g.attributes.normal;
  const indices = g.index.array;
  let best = null;
  for (let at = 0; at < indices.length; at += 3) {
    const a = indices[at], b = indices[at + 1], c = indices[at + 2];
    const ax = p.getX(a), ay = p.getY(a), bx = p.getX(b), by = p.getY(b), cx = p.getX(c), cy = p.getY(c);
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-8) continue;
    const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
    const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, w = 1 - u - v;
    if (u < -1e-5 || v < -1e-5 || w < -1e-5) continue;
    const nz = (n.getZ(a) * u + n.getZ(b) * v + n.getZ(c) * w) * side;
    if (nz < 0.5) continue;
    const z = p.getZ(a) * u + p.getZ(b) * v + p.getZ(c) * w;
    if (!best || z * side > best.z * side) best = { y, z, facing: nz };
  }
  return best;
}
function identityPlacement(model) {
  const choose = (side, preferred, width, height) => {
    for (let k = 0; k <= 16; k++) {
      const delta = Math.ceil(k / 2) * 0.025 * (k % 2 ? 1 : -1), y = preferred + delta;
      if (y < 0.25 || y > model.spec.height * 0.84) continue;
      const centre = bodySurfaceAt(model, 0, y, side);
      if (!centre || centre.z * side < (side > 0 ? model.spec.zFront : -model.spec.zRear) - 0.85) continue;
      let fits = true;
      for (const x of [-width / 2, width / 2]) for (const dy of [-height / 2, height / 2]) {
        const hit = bodySurfaceAt(model, x, y + dy, side);
        if (!hit || Math.abs(hit.z - centre.z) > 0.13) fits = false;
      }
      if (fits) return { ...centre, side, width, height };
    }
    return null;
  };
  const front = choose(1, (model.spec.head?.[1] ?? 0.7) * 0.72, 0.5, 0.172);
  // Use the sport's continuous lower recess and the truck's tailgate, above its open chassis/bumper assembly.
  const rear = model.id === 'sport' ? choose(-1, 0.5, 0.34, 0.117)
    : model.id === 'truck' ? choose(-1, 1.2, 0.5, 0.172)
    : model.id === 'wagon' ? choose(-1, 0.73, 0.5, 0.172)
    : choose(-1, (model.spec.tail?.[1] ?? 0.8) * 0.8, 0.5, 0.172);
  let badge = rear ? choose(-1, model.id === 'sport' ? 0.721 : model.id === 'wagon' ? 0.88 : rear.y + 0.26, 0.55, 0.065) : null;
  if (badge && badge.y - badge.height * 0.5 < rear.y + rear.height * 0.5 + 0.03) badge = null;
  return { front, rear, badge };
}

function lampRange(model, flagValue) {
  const p = model.body.attributes.position, f = model.body.attributes.flag;
  let low = Infinity, high = -Infinity;
  for (const i of model.body.index.array) if (f.getX(i) === flagValue) { low = Math.min(low, p.getY(i)); high = Math.max(high, p.getY(i)); }
  return Number.isFinite(low) ? [low, Math.max(0.025, high - low)] : [0, 1];
}

async function loadModel(id) {
  const entry = manifest[id];
  const [buffer, map, surface, normalTexture] = await Promise.all([
    fetch(new URL(`${id}.bin`, base)).then((r) => r.arrayBuffer()), loadTexture(`${id}_c.webp`, true), loadTexture(`${id}_m.webp`, false),
    entry.normalTexture ? loadTexture(entry.normalTexture, false) : null
  ]);
  const n = entry.vertices;
  let at = 0;
  const take = (Type, count, pad = 0) => { const a = new Type(buffer, at, count); at += a.byteLength + pad; return a; };
  const position = new THREE.BufferAttribute(take(Float32Array, n * 3), 3);
  const normal = new THREE.BufferAttribute(take(entry.normalFormat === 'snorm16' ? Int16Array : Int8Array, n * 4), 4, true);
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
    id, spec: entry.spec, glassAlpha: entry.glass.alpha, map, surface, normalTexture,
    paintRoughness: entry.paintRoughness,
    sourceInterior: entry.sourceInterior === true,
    cabinLayout: entry.cabinLayout,
    body: part(r[0], r[1]), glass: part(r[2], r[3]), shell: part(r[0], r[1] + r[3]), far: part(r[4], r[5]),
    wheels: [0, 1, 2, 3].map((i) => part(r[6 + i * 2], r[7 + i * 2]))
  };
  if (entry.calipers) model.calipers = entry.calipers.map(([start, count]) => count ? part(start, count) : null);
  if (entry.trafficShell) model.shell = part(...entry.trafficShell);
  if (entry.trafficWheels) model.trafficWheels = entry.trafficWheels.map(([start, count]) => part(start, count));
  // The level between the two (tools/cars/build-lods.mjs): what stands or drives within a few car lengths
  if (entry.midShell) {
    model.mid = part(...entry.midShell);
    model.midWheels = entry.midWheels.map(([start, count]) => part(start, count));
  }
  if (entry.steering) model.steering = {
    geometry: part(...entry.steering.range), position: entry.steering.position, axis: entry.steering.axis
  };
  carSpecs[id] = describe(model, position);
  if (!model.sourceInterior) model.body = openCabinGeometry(model.body, model.spec, carSpecs[id].cabin);
  model.identity = identityPlacement(model);
  model.lampRanges = { head: lampRange(model, FLAG.HEAD), tail: lampRange(model, FLAG.BRAKE) };
  models[id] = model;
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
    cabin: model.cabinLayout ?? cabinLayout(s, model.glass, position)
  };
}

// The body with its wheels in place, as one mesh for instancing: the traffic level, or with `close` the level shown
// within a few car lengths. Each wheel's vertices say which wheel they belong to (FLAG.WHEEL + i): one draw shows
// a whole car, and its material still spins and steers the wheels (createBodyMaterial, carPose).
function withWheels(model, close = false) {
  const key = close ? 'close' : 'full';
  if (model[key]) return model[key];
  const shell = close ? model.mid ?? model.shell : model.shell;
  const wheels = close ? model.midWheels ?? model.trafficWheels ?? model.wheels : model.trafficWheels ?? model.wheels;
  const positions = [], normals = [], uvs = [], flags = [], index = [];
  const add = (g, ox, oy, oz, wheel = -1) => {
    const base = positions.length / 3, p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv, f = g.attributes.flag;
    const map = new Map();
    for (const i of g.index.array) {
      if (!map.has(i)) {
        map.set(i, base + map.size);
        positions.push(p.getX(i) + ox, p.getY(i) + oy, p.getZ(i) + oz);
        normals.push(n.getX(i), n.getY(i), n.getZ(i));
        uvs.push(t.getX(i), t.getY(i));
        flags.push(wheel < 0 ? f.getX(i) : FLAG.WHEEL + wheel);
      }
      index.push(map.get(i));
    }
  };
  add(shell, 0, 0, 0);
  wheels.forEach((w, i) => add(w, model.spec.wheels[i][0], model.spec.wheels[i][1], model.spec.wheels[i][2], i));
  const full = new THREE.BufferGeometry();
  full.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  full.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  full.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  full.setAttribute('flag', new THREE.Float32BufferAttribute(flags, 1));
  full.setIndex(index);
  full.computeBoundingSphere();
  return (model[key] = full);
}

async function loadCars(ids, options = {}) {
  surveyedReflections = options.surveyedReflections === true;
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

function streetRadiance(dir, level, env, street, surveyed) {
  const d = normalize(dir), p = positionWorld, rel = street.absolute.oneMinus();
  const sky = (v, l) => (env ? pmremTexture(env, v, l) : mix(vec3(0.42, 0.45, 0.48), vec3(0.45, 0.62, 0.9), v.y.max(0)));
  let useX, wall, t, y;
  if (surveyed) {
    const hit = traceUrbanReflection(d);
    t = hit.x; y = hit.y; useX = hit.z; wall = hit.w;
  } else {
    const w = street.walls, ht = street.heights;
    const xp = mix(w.x, p.x.add(w.x), rel), xn = mix(w.y, p.x.add(w.y), rel);
    const zp = mix(w.z, p.z.add(w.z), rel), zn = mix(w.w, p.z.add(w.w), rel);
    // Along the ray to the wall it heads for, on each axis, and how high it meets that wall
    const tx = select(d.x.greaterThan(0), xp.sub(p.x), p.x.sub(xn)).div(d.x.abs().max(1e-4));
    const tz = select(d.z.greaterThan(0), zp.sub(p.z), p.z.sub(zn)).div(d.z.abs().max(1e-4));
    const yx = p.y.add(d.y.mul(tx)), yz = p.y.add(d.y.mul(tz));
    const okX = step(0, tx).mul(step(yx, select(d.x.greaterThan(0), ht.x, ht.y))).mul(step(0, yx));
    const okZ = step(0, tz).mul(step(yz, select(d.z.greaterThan(0), ht.z, ht.w))).mul(step(0, yz));
    useX = okX.mul(max(step(tx, tz), okZ.oneMinus()));
    wall = max(useX, okZ.mul(useX.oneMinus()));
    t = mix(tz, tx, useX); y = mix(yz, yx, useX);
  }
  const along = mix(p.x.add(d.x.mul(t)), p.z.add(d.z.mul(t)), useX);
  // A facade: one building every 24 m of its own stone, bays of windows over a ground floor of shops
  const lot = floor(along.div(24)).add(useX.mul(31));
  const pick = fract(sin(lot.mul(12.9898)).mul(43758.5453));
  const albedo = mix(mix(BRICK, STONE, step(0.4, pick)), mix(CONCRETE, TOWER, step(0.86, pick)), step(0.66, pick));
  const bay = along.div(1.9), storey = y.div(3.3);
  // Filter the reflected window grid in screen space, including the material's lobe width. Hard steps here made
  // the hood crawl with black checkerboards as soon as the car moved, even with antialiasing enabled.
  const windowBand = (coordinate, lo, hi) => {
    const blur = clamp(fwidth(coordinate).mul(0.75).add(level.mul(0.4)), 0.003, 0.46);
    const p = fract(coordinate);
    const band = smoothstep(float(lo).sub(blur), float(lo).add(blur), p)
      .mul(smoothstep(float(hi).add(blur), float(hi).sub(blur), p));
    return mix(band, float(hi - lo), smoothstep(0.15, 0.5, blur));
  };
  const pane = windowBand(bay, 0.2, 0.8).mul(windowBand(storey, 0.3, 0.85)).mul(smoothstep(3.8, 4.4, y));
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
  constructor(street, surveyed = false) {
    super('vec3');
    this.street = street;
    this.surveyed = surveyed;
  }

  setup(builder) {
    const context = builder.context;
    const dir = context.getUV ? context.getUV(this, builder) : normalWorld;
    const level = context.getTextureLevel ? context.getTextureLevel(this) : float(1);
    const env = builder.scene?.environment ?? null;
    // The diffuse light (a constant level) stays the sky's: the street only shows in what the surface mirrors, or the
    // lower panels, facing the road, went black
    if (env && dir === normalWorld) return pmremTexture(env, dir, level);
    return streetRadiance(dir, level, env, this.street, this.surveyed);
  }
}

// The bodywork: paint where the mask says, the model's own texture elsewhere, lamps lit by state
// Every car, the traffic's included, is a physical material: coloured paint under a clear coat is what makes a car a car
function createBodyMaterial(model, { paint = null, instanced = false, livery = 0, physical = true } = {}) {
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
  // Pack lamp classifications into one location: Metal/WebGPU exposes only sixteen inter-stage varyings.
  // Separate scalar varyings exhausted that budget once local-space panel projections were added.
  const lampMasks = varying(vec4(isFlag(FLAG.HEAD), isFlag(FLAG.BRAKE), isFlag(FLAG.REVERSE), isFlag(FLAG.BLINKER)));
  const head = lampMasks.x, brake = lampMasks.y, reverse = lampMasks.z, blinker = lampMasks.w;
  // Where a point is on the car as modelled. By the time an instanced car reaches the pixels, `positionLocal` has been
  // through its instance and stands in the street: plates, the blinking side and the door seams would be laid out
  // along Manhattan instead of along the bodywork (and no street car wore a plate).
  const local = instanced ? varying(attribute('position', 'vec3'), 'vCarLocal') : positionLocal;
  const side = local.x;
  const alongCar = local.z;
  const finish = FINISH[model.id] ?? FINISH.sedan;

  const surface = texture(model.surface, uv());
  const base = texture(model.map, uv());
  // The source normal atlas shares the colour UVs. Tangent-space detail remains independent of the simulated body.
  const atlasNormal = model.normalTexture ? normalMap(texture(model.normalTexture, uv()).rgb) : normalView;
  // A filtered paint tile represents subpixel flakes through roughness, not a biased 8-bit "flat" normal.
  const sourceNormal = model.paintRoughness ? normalize(mix(atlasNormal, normalView, surface.r)) : atlasNormal;
  mat.normalNode = sourceNormal;
  // Lens colour separates the red brake chamber from the amber/white cells inside a shared imported lamp mesh.
  const redLens = brake.mul(smoothstep(0.18, 0.52, base.r.sub(base.g.mul(1.3)).div(base.r.max(0.01))));
  const hy = model.lampRanges?.head ?? [0, 1], ty = model.lampRanges?.tail ?? [0, 1];
  const lensBand = (range, level, width) => {
    const v = local.y.sub(range[0]).div(range[1]), aa = fwidth(v).max(0.008);
    return smoothstep(float(width).add(aa), float(width).sub(aa), v.sub(level).abs()).mul(smoothstep(0.4, 0.08, aa));
  };
  const runningBlade = lensBand(hy, 0.24, 0.065).mul(head);
  const tailBlade = max(lensBand(ty, 0.3, 0.075), lensBand(ty, 0.65, 0.055)).mul(redLens);
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
    mat.normalNode = normalize(mix(sourceNormal, facet, dentNode.mul(0.8)));
  }

  const identityIndex = Math.max(0, Object.keys(IDENTITIES).indexOf(model.id));
  const identityMap = carIdentityAtlas();
  const projectIdentity = (placement, badge = false) => {
    if (!placement) return vec4(0);
    const u = local.x.mul(placement.side / placement.width).add(0.5);
    const v = local.y.sub(placement.y).div(placement.height).add(0.5);
    const tileX = identityIndex % 2, tileY = Math.floor(identityIndex / 2);
    const atlasY = badge ? float(64).mul(v.oneMinus()) : float(76).add(float(180).mul(v.oneMinus()));
    const sample = texture(identityMap, vec2(clamp(u, 0, 1).add(tileX).mul(0.5), float(1).sub(atlasY.add(tileY * 256).div(2048))));
    const bounds = step(0, u).mul(step(u, 1)).mul(step(0, v)).mul(step(v, 1));
    // Registered bounds already locate the panel. Keep the print across its small bevels and shut-lines;
    // an aggressive facing gate cut a dark stripe straight through every plate at a bumper chamfer.
    const face = smoothstep(0.08, 0.28, normalLocal.z.mul(placement.side));
    const depth = smoothstep(0.17, 0.12, local.z.sub(placement.z).abs());
    return vec4(sample.rgb, sample.a.mul(bounds).mul(face).mul(depth).mul(inside.oneMinus()));
  };
  const plateFront = projectIdentity(model.identity?.front), plateRear = projectIdentity(model.identity?.rear);
  const plate = vec4(plateFront.rgb.mul(plateFront.a).add(plateRear.rgb.mul(plateRear.a)), max(plateFront.a, plateRear.a));
  const badge = projectIdentity(model.identity?.badge, true);

  // Police: white doors on a black car (traffic says so per instance, in the style code of its lamp state)
  const styleCode = state.w.mod(8);
  const liveryOn = instanced ? step(0.5, styleCode).mul(step(styleCode, 1.5)) : float(livery ? 1 : 0);
  const midDoors = (model.spec.wheelZf + model.spec.wheelZr) / 2;
  const doors = smoothstep(0.03, 0.0, alongCar.sub(midDoors).abs().sub(model.spec.wheelZf - midDoors).add(0.4));

  mat.colorNode = Fn(() => {
    // Keep the baked panel occlusion, but let the pigment show in sun and roll gently into darker face-on panels.
    const grazing = float(1).sub(dot(normalView, positionViewDirection).abs()).pow(2);
    const shade = base.rgb.mul(1.65);
    const pigment = paintNode.mul(mix(float(0.98), float(1.12), grazing));
    const coat = mix(pigment, mix(vec3(0.012), vec3(0.8), doors), liveryOn);
    const c = mix(base.rgb, coat.mul(shade), mask).toVar();
    // Paint gone from what scraped the road: bare grey metal with a rust edge
    c.assign(mix(c, vec3(0.2, 0.19, 0.18), dentNode.mul(mask).mul(0.7)));
    c.assign(mix(c, vec3(0.01, 0.012, 0.015), glassMask));
    // A red polymer lens over a dark reflector keeps its depth in daylight instead of reading as a flat bright sticker.
    c.assign(mix(c, base.rgb.mul(0.6).add(vec3(0.035, 0.002, 0.004)), redLens.mul(0.7)));
    c.assign(mix(c, plate.rgb, plate.a));
    c.assign(mix(c, badge.rgb, badge.a));
    // The panels' inside faces are the cabin's trim, seen through the glass
    if (!instanced) c.assign(mix(c, vec3(0.085, 0.08, 0.075), inside));
    return c;
  })();
  // A satin pigment below a polished dielectric coat gives a broad highlight under the sharper reflected skyline.
  // No stochastic sparkle: metallic flakes are integrated into roughness, so they cannot shimmer at traffic distance.
  // Offline filtering can move unresolved normal-map variance into pigment roughness; the clear coat stays smooth.
  const gloss = float(Math.max(finish[0], model.paintRoughness ?? 0));
  const optics = max(head, max(brake, max(reverse, blinker)));
  mat.roughnessNode = mix(mix(mix(mix(surface.g.max(0.2), gloss, mask).add(dentNode.mul(0.4)), float(0.12), optics), float(0.065), glassMask), float(0.9), inside);
  mat.metalnessNode = mix(mix(mix(surface.b, float(finish[1]), mask), float(0), optics), float(0.04), glassMask).mul(inside.oneMinus());
  if (physical) {
    mat.clearcoatNode = max(mask.mul(dentNode.oneMinus()), optics.mul(0.72)).mul(inside.oneMinus());
    mat.clearcoatRoughnessNode = float(finish[2]).add(dentNode.mul(0.3));
    mat.ior = 1.48;
  }
  mat.roughnessNode = mix(mix(mat.roughnessNode, float(0.36), plate.a), float(0.23), badge.a);
  mat.metalnessNode = mix(mix(mat.metalnessNode, float(0.12), plate.a), float(0.82), badge.a);
  if (physical) mat.clearcoatNode = mat.clearcoatNode.mul(max(plate.a, badge.a).oneMinus());
  mat.envMapIntensity = 1.25;
  const street = createStreet();
  mat.envNode = new StreetReflectionNode(street, surveyedReflections && !instanced);

  const glow = cityUniforms.uInteriorGlow;
  const night = smoothstep(0.6, 1.15, glow);
  const blink = state.y.mul(step(0, side)).add(state.z.mul(step(side, 0)));
  // A parked car's lamps are off: parking.js sets LAMPS_OFF in the style code (bit 8, above the style fields)
  const lampsOn = instanced ? step(state.w, float(LAMPS_OFF - 0.5)) : float(1);
  mat.emissiveNode = Fn(() => {
    const e = vec3(0).toVar();
    e.addAssign(mix(base.rgb, vec3(0.88, 0.94, 1), float(0.35)).mul(head).mul(night.mul(3.8).add(0.36)).mul(lampsOn));
    e.addAssign(vec3(0.85, 0.93, 1).mul(runningBlade).mul(night.mul(1.7).add(1.2)).mul(lampsOn));
    e.addAssign(vec3(1, 0.016, 0.025).mul(redLens).mul(state.x.mul(5).add(night.mul(0.7).add(0.04).mul(lampsOn))));
    e.addAssign(vec3(1, 0.025, 0.04).mul(tailBlade).mul(night.mul(0.8).add(0.2)).mul(lampsOn));
    e.addAssign(vec3(1, 0.5, 0.08).mul(blinker).mul(blink.mul(4)));
    if (!instanced) e.addAssign(vec3(0.9, 0.95, 1).mul(reverse).mul(state.w.mul(3)));
    return e.mul(inside.oneMinus());
  })();
  if (instanced) {
    // What moves on a street car, worked out in the vertex stage before the instance places the car: the wheels
    // (FLAG.WHEEL + i) turn on their axles and the front pair steers, and the bodywork leans on its springs over
    // them while they stay on the road. carPose: wheel spin, steering angle, pitch, roll (radians); the instance
    // itself only carries where the car is and which way it points.
    const pose = attribute('carPose', 'vec4');
    const centres = model.spec.wheels.map(([x, y, z]) => vec3(x, y, z));
    const wheel = flag.sub(FLAG.WHEEL);
    const onWheel = step(-0.5, wheel);
    const centre = mix(mix(centres[0], centres[1], step(0.5, wheel)), mix(centres[2], centres[3], step(2.5, wheel)), step(1.5, wheel));
    const steer = pose.y.mul(step(wheel, 1.5));
    const aboutX = (v, a) => { const c = cos(a), n = sin(a); return vec3(v.x, v.y.mul(c).sub(v.z.mul(n)), v.y.mul(n).add(v.z.mul(c))); };
    const aboutY = (v, a) => { const c = cos(a), n = sin(a); return vec3(v.x.mul(c).add(v.z.mul(n)), v.y, v.z.mul(c).sub(v.x.mul(n))); };
    const aboutZ = (v, a) => { const c = cos(a), n = sin(a); return vec3(v.x.mul(c).sub(v.y.mul(n)), v.x.mul(n).add(v.y.mul(c)), v.z); };
    const turned = (v) => aboutY(aboutX(v, pose.x), steer);
    const leaned = (v) => aboutX(aboutZ(v, pose.w), pose.z);
    const setupPosition = mat.setupPosition;
    mat.setupPosition = function (builder) {
      positionLocal.assign(mix(leaned(positionLocal), centre.add(turned(positionLocal.sub(centre))), onWheel));
      normalLocal.assign(mix(leaned(normalLocal), turned(normalLocal), onWheel));
      return setupPosition.call(this, builder);
    };
  }
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
  mat.colorNode = mix(mix(tint.rgb.mul(0.11), vec3(0.018, 0.034, 0.04), float(0.5)), vec3(0.78), lines);
  // With someone at the wheel the glass clears to show them: tinted but see-through face on, a mirror at a glance
  const clear = uniform(0);
  const glance = float(1).sub(dot(normalView, positionViewDirection).abs()).pow(3);
  // Front side glass transmits enough to read the cabin even when unoccupied. Rear privacy glass remains darker.
  const privacy = smoothstep(model.spec.wheelZf * 0.1, model.spec.wheelZr * 0.75, varying(positionLocal.z));
  const tinted = float(Math.min(0.6, Math.max(0.38, model.glassAlpha * 0.72)));
  const faceOn = mix(tinted, float(0.24), clear).add(privacy.mul(0.1));
  const outside = mix(faceOn, float(0.85), glance);
  // From the driver's side the glass must transmit the road, rather than applying its exterior mirror tint again.
  mat.opacityNode = mix(mix(float(0.08), outside, float(frontFacing)), float(0.95), lines);
  mat.roughnessNode = mix(float(0.03), float(0.5), lines);
  mat.metalnessNode = float(0.05);
  mat.specularIntensityNode = float(1);
  mat.envMapIntensity = 1.25;
  mat.ior = 1.5;
  mat.envNode = new StreetReflectionNode(carMaterial.userData.street, surveyedReflections);
  mat.userData.clear = clear;
  return mat;
}

// One per model for the street's traffic
const instancedMaterials = new Map();
function trafficMaterial(id) {
  if (!instancedMaterials.has(id)) instancedMaterials.set(id, createBodyMaterial(models[id], { instanced: true }));
  return instancedMaterials.get(id);
}

// Source mechanisms have their own local origin. Body dents, panel projections and back-face trim must not be
// evaluated in that frame. Share this material across steering wheels and calipers, prepared during fleet warmup.
const sourcePartMaterials = new Map();
function createSourcePartMaterial(model) {
  if (sourcePartMaterials.has(model.id)) return sourcePartMaterials.get(model.id);
  const mat = new THREE.MeshStandardNodeMaterial();
  const surface = texture(model.surface, uv());
  mat.name = 'SourceMechanism';
  mat.colorNode = texture(model.map, uv()).rgb;
  mat.roughnessNode = surface.g.max(0.08);
  mat.metalnessNode = surface.b;
  mat.normalNode = model.normalTexture ? normalMap(texture(model.normalTexture, uv()).rgb) : normalView;
  mat.side = THREE.DoubleSide;
  mat.envMapIntensity = 1.05;
  mat.userData.shared = true;
  sourcePartMaterials.set(model.id, mat);
  return mat;
}

// A wheel: rubber and alloy from the atlas
const wheelMaterials = new Map();
function createWheelMaterial(model) {
  if (wheelMaterials.has(model.id)) return wheelMaterials.get(model.id);
  const mat = new THREE.MeshStandardNodeMaterial();
  wheelMaterials.set(model.id, mat);
  const surface = texture(model.surface, uv());
  const base = texture(model.map, uv()).rgb;
  const radius = length(positionLocal.yz), r = model.spec.wheelRadius;
  // The imported atlas supplies the alloy design. Rubber gets geometric-coordinate tread and sidewall ribs,
  // independent of the many atlas layouts; derivative filtering fades those cuts before they alias at distance.
  const dark = smoothstep(0.2, 0.08, max(base.r, max(base.g, base.b)));
  const rubber = dark.mul(smoothstep(r * 0.62, r * 0.78, radius)).mul(surface.b.oneMinus());
  const tread = smoothstep(0.5, 0.85, normalLocal.x.abs().oneMinus());
  const angle = atan(positionLocal.y, positionLocal.z);
  const circum = positionLocal.x.mul(32);
  const blocks = angle.mul(8).add(positionLocal.x.abs().mul(10));
  const cut = (v, width) => {
    const edge = fwidth(v).max(0.008), at = fract(v).sub(0.5).abs();
    return smoothstep(float(width).add(edge), float(width).sub(edge), at).mul(smoothstep(0.45, 0.08, edge));
  };
  const grooves = max(cut(circum, 0.065), cut(blocks, 0.06)).mul(tread);
  const ribs = cut(radius.div(r).mul(29), 0.09).mul(tread.oneMinus()).mul(smoothstep(r * 0.72, r * 0.9, radius));
  const pattern = max(grooves, ribs.mul(0.38)).mul(rubber);
  const rubberColor = mix(base, vec3(0.022, 0.024, 0.026), float(0.48));
  mat.colorNode = mix(base, rubberColor, rubber).mul(float(1).sub(pattern.mul(0.45)));
  mat.roughnessNode = mix(surface.g.max(0.22), float(0.88), rubber).add(pattern.mul(0.08));
  mat.metalnessNode = surface.b.mul(rubber.oneMinus());
  // Preserve the source tyre and alloy relief. The atlas is neutral on parts without a source normal map.
  mat.normalNode = model.normalTexture ? normalMap(texture(model.normalTexture, uv()).rgb) : bumpMap(pattern.mul(-0.0007));
  mat.envMapIntensity = 1.05;
  mat.userData.shared = true;
  return mat;
}

export { DENTS, FINISH, FLAG, bodySurfaceAt, identityPlacement, LAMPS_OFF, carSpecs, createBodyMaterial, createGlassMaterial, createSourcePartMaterial, createWheelMaterial, loadCars, models as carModels, trafficMaterial, withWheels };
