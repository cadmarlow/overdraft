import * as THREE from 'three/webgpu';
import { attribute, uv, float, smoothstep, abs, mix, vec2, vec3, texture, select, dot } from 'three/tsl';
import { buildFxAtlas, GLOW, SMOKE, DECAL } from './fx-textures.js';

// Gameplay visual effects: gunfire (shaped muzzle flashes, smoke, tracers, brass, impacts by surface, bullet holes and
// blood), fire, explosions, wreck debris, scorch marks and a small pool of flash lights.
// Draw calls: one additive pool (flashes, sparks, tracers, fire), one blended pool (smoke, dust, fragments, droplets),
// one instanced mesh of casings, one of decals. Their shapes come from one atlas painted at boot (fx-textures.js).
// Nothing is created while playing: particles, casings and decals are recycled objects in bounded pools, and every
// pool keeps a degenerate instance until warmed up so its pipeline compiles behind the loading screen.

const GLOW_MAX = 900;
const SMOKE_MAX = 1100;
const DEBRIS_MAX = 60;
const SCORCH_MAX = 12;
const LIGHT_POOL = 4;
const CASING_MAX = 128;
const DECAL_MAX = 200;
const BARRELS = 6;

// How a particle's quad is laid out
const BILLBOARD = 0; // faces the camera, rolled
const STREAK = 1;    // stretched along its motion, turned to the camera
const TRACER = 2;    // a bullet's streak between two points
const PLANE = 3;     // fixed in the world on two given axes (the petals of a flash, its side planes)
const UPRIGHT = 4;   // rooted at a point, rising along a given axis, turned to the camera (dust jets, splashes)
const TILE = 3;      // shape codes: 0 soft disc, 1 streak, 2 tracer, TILE + n the atlas tile n

const NONE = Object.freeze({});
const POWDER = Object.freeze({ drag: 7, gravity: 3, streak: 0.11 });
const SPARK = Object.freeze({ gravity: 9.8, drag: 0.9, streak: 0.3 });
const GLINT = Object.freeze({ gravity: 9.8, drag: 0.5 });
const EXPLOSION_SMOKE = Object.freeze({ grow: 0.9, drag: 1.4, gravity: -1.2 });
const TRAIL_SMOKE = Object.freeze({ grow: 1.3, gravity: -0.4 });
const BLANK = Object.freeze({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, len: 0, grow: 0, swell: 0, life: 0, max: 0,
  r: 0, g: 0, b: 0, alpha: 1, drag: 0, gravity: 0, streak: 0, mode: BILLBOARD, code: 0, core: 0, roll: 0, spin: 0,
  fadeIn: 8, fadeOut: 0, fadePow: 0.7, floor: -Infinity, bounce: 0.3, rest: false, turb: 0, seed: 0, lit: 0, hard: 0,
  fresh: false, stain: 0, tracer: false, length: 0, stretch: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, ox: 0, oy: 0, oz: 0,
  dist: 0, total: 0, speed: 0 });

// Per weapon: the shapes its flash is cut from and how big, bright and smoky a shot is
const FLASH = {
  pistol: { front: [GLOW.ballA, GLOW.ballB, GLOW.starWild], side: [GLOW.coneShort, GLOW.coneFatB], star: false,
    size: 0.23, length: 0.29, width: 0.16, light: 6, sparks: 1, smoke: 2, puff: 1, heat: 0.14 },
  smg: { front: [GLOW.ballB, GLOW.ballA, GLOW.star4, GLOW.starWild], side: [GLOW.coneShort, GLOW.coneNarrowB], star: false,
    size: 0.19, length: 0.3, width: 0.13, light: 5, sparks: 1, smoke: 2, puff: 0.9, heat: 0.09 },
  rifle: { front: [GLOW.star3, GLOW.star4, GLOW.star5, GLOW.starWild], side: [GLOW.coneNarrowA, GLOW.coneNarrowB], star: true,
    size: 0.36, length: 0.64, width: 0.34, light: 9, sparks: 2, smoke: 3, puff: 1.15, heat: 0.11 },
  shotgun: { front: [GLOW.ballBig, GLOW.ballA, GLOW.ballB], side: [GLOW.coneFatA, GLOW.coneFatB], star: false,
    size: 0.44, length: 0.66, width: 0.33, light: 16, sparks: 18, smoke: 5, puff: 1.9, heat: 0.34 }
};

// Per casing: [radius, length, bottleneck (0) or straight wall (1), hex colour of the wall, its metalness, port behind the muzzle]
// A quarter larger than life, so they read from a camera two metres back.
const CASINGS = {
  pistol: [0.0072, 0.026, 1, 0xb58a45, 0.9, 0.16],
  smg: [0.0072, 0.026, 1, 0xb58a45, 0.9, 0.3],
  rifle: [0.0072, 0.054, 0, 0xb58a45, 0.9, 0.42],
  shotgun: [0.0125, 0.07, 1, 0xa3261c, 0, 0.5]
};

// Per surface: what a bullet throws off it. dust/chip are linear grey or [r, g, b]; decal: [tiles, size, tint, roughness]
const SURFACES = {
  concrete: { dust: [0.66, 0.64, 0.6], chip: [0.5, 0.48, 0.45], chips: 5, puffs: 3, sparks: 0.3, tile: SMOKE.chipA,
    decal: [[DECAL.concreteA, DECAL.concreteB, DECAL.concreteC], 0.125, [0.4, 0.38, 0.35], 0.95] },
  asphalt: { dust: [0.3, 0.3, 0.31], chip: [0.13, 0.13, 0.14], chips: 5, puffs: 3, sparks: 0.3, tile: SMOKE.chipB,
    decal: [[DECAL.gouge], 0.12, [0.2, 0.2, 0.21], 0.95] },
  dirt: { dust: [0.4, 0.31, 0.2], chip: [0.2, 0.14, 0.08], chips: 6, puffs: 3, sparks: 0, tile: SMOKE.clod,
    decal: [[DECAL.gouge], 0.14, [0.26, 0.19, 0.12], 1] },
  wood: { dust: [0.62, 0.52, 0.38], chip: [0.66, 0.52, 0.34], chips: 6, puffs: 2, sparks: 0, tile: SMOKE.splinter,
    decal: [[DECAL.wood], 0.11, [0.7, 0.56, 0.38], 0.9] }
};
const METAL_DECAL = [[DECAL.metalA, DECAL.metalB], 0.085, [0.8, 0.82, 0.86], 0.35];
const GLASS_DECAL = [[DECAL.glassA, DECAL.glassB], 0.34, [0.86, 0.93, 0.96], 0.2];
const BLOOD = [0.2, 0.008, 0.008];
const BLOOD_POOLS = [DECAL.bloodPoolA, DECAL.bloodPoolB, DECAL.bloodPoolC];
const BLOOD_DROPS = [DECAL.bloodDropsA, DECAL.bloodDropsB];
const PUFFS = [SMOKE.puffA, SMOKE.puffB, SMOKE.puffC, SMOKE.puffD];
const WISPS = [SMOKE.wispA, SMOKE.wispB, SMOKE.puffC];
const CURLS = [SMOKE.wispA, SMOKE.wispB, SMOKE.puffC, SMOKE.puffA];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _debrisEuler = new THREE.Euler();
const _color = new THREE.Color();
const _u = [0, 0, 0], _w = [0, 0, 0];
const zero = new THREE.Matrix4().makeScale(0, 0, 0);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[(Math.random() * list.length) | 0];

// Two unit vectors square to the direction d, into _u and _w (u x w = d)
function square(dx, dy, dz) {
  let ux = -dz, uy = 0, uz = dx;
  let l = Math.hypot(ux, uz);
  if (l < 1e-4) { ux = 1; uz = 0; l = 1; }
  ux /= l; uz /= l;
  _u[0] = ux; _u[1] = uy; _u[2] = uz;
  _w[0] = dy * uz - dz * uy; _w[1] = dz * ux - dx * uz; _w[2] = dx * uy - dy * ux;
}

let atlasTexture = null;
function atlas() {
  if (atlasTexture) return atlasTexture;
  const { data, size } = buildFxAtlas();
  atlasTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  atlasTexture.colorSpace = THREE.NoColorSpace;
  atlasTexture.magFilter = THREE.LinearFilter;
  atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTexture.generateMipmaps = true;
  atlasTexture.needsUpdate = true;
  return atlasTexture;
}

// The atlas sampled at the tile a shape code names
function tileSample(code) {
  const tile = code.sub(TILE).max(0);
  const cell = vec2(tile.mod(4), tile.div(4).floor());
  return texture(atlas(), cell.add(vec2(uv().x, uv().y.oneMinus())).mul(0.25));
}

// fxA = colour + alpha, fxB = shape code + three numbers the pool's shader gives a meaning to
function instanceAttributes(geometry, max) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  const b = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  a.setUsage(THREE.DynamicDrawUsage);
  b.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('fxA', a);
  geometry.setAttribute('fxB', b);
  return [a, b];
}

function particleMesh(max, blending, name) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const [a, b] = instanceAttributes(geometry, max);
  const additive = blending === THREE.AdditiveBlending;
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending, side: THREE.DoubleSide, fog: false });
  const fxA = attribute('fxA', 'vec4'), fxB = attribute('fxB', 'vec4');
  const code = fxB.x;
  const p = uv().sub(0.5).mul(2.0);
  // Soft disc for puffs and flames; a streak (soft along its width, tapered ends) for sparks
  const round = smoothstep(1.0, 0.0, p.length()).pow(1.6);
  const streak = smoothstep(1.0, 0.0, abs(p.y)).mul(smoothstep(1.0, 0.25, abs(p.x)));
  // the blended pool also draws the glow shapes (codes past the sixteen smoke tiles): the body of a flash
  const glowShape = code.greaterThanEqual(TILE + 16);
  const sample = tileSample(additive ? code : select(glowShape, code.sub(16), code));
  if (additive) {
    // A bullet's streak: a hot head at +x, a tail thinning and dimming to nothing
    const along = uv().x;
    const across = smoothstep(1.0, 0.0, abs(p.y).div(mix(float(0.3), float(1.0), along.mul(along)))).pow(1.4);
    const tracer = across.mul(along.pow(2.4).mul(0.5).add(smoothstep(0.84, 0.97, along).mul(0.75))).mul(smoothstep(1.0, 0.985, along));
    const heat = select(code.lessThan(0.5), round, select(code.lessThan(1.5), streak, select(code.lessThan(2.5), tracer, sample.r)));
    // Heat ramp: the tint where the gas is thin, white-hot where it is dense (fxB.y, zero for plain particles)
    material.colorNode = fxA.rgb.add(vec3(1.0, 0.82, 0.5).mul(fxB.y).mul(heat.mul(heat).mul(heat)));
    material.opacityNode = heat.mul(fxA.a);
  } else {
    // Fragments are coverage fields cut crisp (fxB.w); smoke is density, shaded as a lit ball (fxB.yz: light in the quad)
    const density = select(code.lessThan(0.5), round, select(code.lessThan(1.5), streak, select(glowShape, sample.r, sample.g)));
    material.colorNode = fxA.rgb.mul(dot(p, fxB.yz).add(1.0));
    material.opacityNode = mix(density, smoothstep(0.42, 0.58, density), fxB.w).mul(fxA.a);
  }
  const mesh = new THREE.InstancedMesh(geometry, material, max);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = additive ? 997 : 996;
  mesh.count = 1;
  mesh.setMatrixAt(0, zero);
  return { mesh, a, b, list: [], free: [], max };
}

// A spent case, one unit long and one wide: the bottlenecked rifle case and the straight-walled one share the mesh,
// and each instance keeps the one it is (fxPart.x against fxB.x). fxPart.y marks the brass head of a shotgun hull,
// fxPart.z the dark inside of the mouth.
function casingGeometry() {
  const lathe = (profile, variant) => {
    const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 10);
    const pos = g.getAttribute('position'), part = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const ring = Math.floor(i / 11);
      part[i * 3] = variant;
      part[i * 3 + 1] = pos.getY(i) < -0.26 ? 1 : 0;
      part[i * 3 + 2] = ring >= profile.length - 2 ? 1 : 0;
    }
    g.setAttribute('fxPart', new THREE.BufferAttribute(part, 3));
    return g;
  };
  const neck = lathe([[0, -0.5], [0.5, -0.5], [0.5, -0.47], [0.43, -0.455], [0.43, -0.425], [0.5, -0.405], [0.48, 0.2],
    [0.35, 0.31], [0.35, 0.5], [0.29, 0.5], [0.29, 0.3]], 0);
  const wall = lathe([[0, -0.5], [0.57, -0.5], [0.57, -0.46], [0.45, -0.445], [0.45, -0.41], [0.5, -0.39], [0.5, -0.27], [0.5, -0.25],
    [0.5, 0.5], [0.43, 0.5], [0.43, 0.25]], 1);
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'fxPart']) {
    const a = neck.getAttribute(name), b = wall.getAttribute(name);
    const merged = new Float32Array(a.array.length + b.array.length);
    merged.set(a.array); merged.set(b.array, a.array.length);
    geometry.setAttribute(name, new THREE.BufferAttribute(merged, a.itemSize));
  }
  const offset = neck.getAttribute('position').count;
  geometry.setIndex([...neck.index.array, ...Array.from(wall.index.array, (i) => i + offset)]);
  return geometry;
}

class EffectsSystem {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.name = 'GameplayEffects';
    scene.add(this.root);
    this.glow = particleMesh(GLOW_MAX, THREE.AdditiveBlending, 'FxGlow');
    this.smoke = particleMesh(SMOKE_MAX, THREE.NormalBlending, 'FxSmoke');
    this.root.add(this.glow.mesh, this.smoke.mesh);

    const debrisMat = new THREE.MeshStandardNodeMaterial({ color: 0x1d1b19, roughness: 0.8, metalness: 0.4 });
    this.debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), debrisMat, DEBRIS_MAX);
    this.debrisMesh.castShadow = true;
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.count = 1;
    this.debrisMesh.setMatrixAt(0, zero);
    this.debris = [];
    this.root.add(this.debrisMesh);

    const scorchGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    const scorchAlpha = new THREE.InstancedBufferAttribute(new Float32Array(SCORCH_MAX), 1);
    scorchGeo.setAttribute('fxAlpha', scorchAlpha);
    const scorchMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, color: 0x0b0907 });
    const sp = uv().sub(0.5).mul(2.0);
    scorchMat.opacityNode = smoothstep(1.0, 0.2, sp.length()).mul(attribute('fxAlpha', 'float')).mul(0.85);
    scorchMat.polygonOffset = true;
    scorchMat.polygonOffsetFactor = -4;
    this.scorchMesh = new THREE.InstancedMesh(scorchGeo, scorchMat, SCORCH_MAX);
    this.scorchMesh.frustumCulled = false;
    this.scorchMesh.renderOrder = 995;
    this.scorchAlpha = scorchAlpha;
    this.scorches = [];
    this.scorchMesh.count = 1;
    this.scorchMesh.setMatrixAt(0, zero);
    this.root.add(this.scorchMesh);

    // Casings: lit brass. Warm the metal and decal pipelines at boot; firing only fills bounded instance pools.
    const caseGeo = casingGeometry();
    [this.casingA, this.casingB] = instanceAttributes(caseGeo, CASING_MAX);
    const part = attribute('fxPart', 'vec3'), caseA = attribute('fxA', 'vec4'), caseB = attribute('fxB', 'vec4');
    const caseMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.32 });
    const brass = vec3(_color.setHex(0xb58a45).r, _color.g, _color.b);
    caseMat.colorNode = mix(mix(caseA.rgb, brass, part.y), vec3(0.02, 0.016, 0.012), part.z);
    caseMat.metalnessNode = mix(mix(caseA.a, float(0.9), part.y), float(0), part.z);
    caseMat.roughnessNode = mix(mix(mix(float(0.5), float(0.32), caseA.a), float(0.32), part.y), float(1), part.z);
    caseMat.maskNode = abs(part.x.sub(caseB.x)).lessThan(0.5);
    this.casingMesh = new THREE.InstancedMesh(caseGeo, caseMat, CASING_MAX);
    this.casingMesh.name = 'FxCasings';
    this.casingMesh.frustumCulled = false;
    this.casingMesh.receiveShadow = true;
    this.casingMesh.count = 1;
    this.casingMesh.setMatrixAt(0, zero);
    this.casings = [];
    this.casingFree = [];
    this.root.add(this.casingMesh);
    /** Called on every bounce of a casing, for the audio to tick: (x, y, z, kind, speed in m/s) */
    this.onCasingBounce = null;

    // Decals: bullet holes and blood, lit like the surface they lie on, drawn just above it
    const markGeo = new THREE.PlaneGeometry(1, 1);
    [this.decalA, this.decalB] = instanceAttributes(markGeo, DECAL_MAX);
    const markA = attribute('fxA', 'vec4'), markB = attribute('fxB', 'vec4');
    const markMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, metalness: 0, roughness: 0.95, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mark = tileSample(markB.x.add(TILE));
    markMat.colorNode = markA.rgb.mul(mark.b);
    markMat.opacityNode = mix(mark.a, smoothstep(0.36, 0.6, mark.a), markB.y).mul(markA.a);
    markMat.roughnessNode = markB.z;
    this.impactMesh = new THREE.InstancedMesh(markGeo, markMat, DECAL_MAX);
    this.impactMesh.name = 'FxBulletMarks';
    this.impactMesh.frustumCulled = false;
    this.impactMesh.receiveShadow = true;
    this.impactMesh.renderOrder = 995;
    this.impactMesh.count = 1;
    this.impactMesh.setMatrixAt(0, zero);
    this.impactMarks = [];
    this.markFree = [];
    this.marksDirty = false;
    this.root.add(this.impactMesh);

    this.lights = [];
    for (let i = 0; i < LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xffa040, 0, 20, 2);
      light.position.set(0, -1000, 0);
      this.root.add(light);
      this.lights.push({ light, life: 0, max: 1, power: 0, fresh: false });
    }

    // Barrels that fired lately: smoke keeps curling out of a hot one
    this.barrels = [];
    for (let i = 0; i < BARRELS; i++) this.barrels.push({ id: null, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, heat: 0, since: 10, emit: 0, tracked: false, light: 1, litT: -10, litX: 0, litY: 0, litZ: 0, lit: 0 });
    // Smoke, dust and fragments are not lit by the renderer: each emitter gives them the light of where it stands.
    /** How bright the day is, 0.3 (night) to 1 (noon). Left null, it is read off the scene's sun and sky lights. */
    this.ambient = null;
    /**
     * (x, y, z) => 0..1: how much direct sun reaches a point (atmosphere.sunReaches). Without it everything is taken to
     * stand mostly in shade, which is right in a street canyon and too dark on an open, sunlit avenue.
     */
    this.sunlit = null;
    this.level = 1;  // the day's brightness
    this.light = 1;  // the light of the emitter at work
    this.hitLight = { litT: -10, litX: 0, litY: 0, litZ: 0, lit: 0 };
    this.sun = null; this.sky = null;
    this.sunX = 0.4; this.sunY = 0.8; this.sunZ = 0.45;
    this.wind = { x: 0.22, z: 0.1 };
    /** Slows or freezes every effect (0 = frozen) without touching the game: for captures and slow motion */
    this.timeScale = 1;
    this.ground = null;
    this.time = 0;
    this.updates = 0;
    this.lastFront = -1;
    this.lastSide = -1;
    this.impactsThisFrame = 0;
    // camera axes, refreshed each update
    this.rx = 1; this.ry = 0; this.rz = 0; this.ux = 0; this.uy = 1; this.uz = 0;
  }

  // ---- Emitters -------------------------------------------------------------------------------------------------
  spawn(pool) {
    const list = pool.list;
    const p = list.length >= pool.max ? list.shift() : pool.free.pop() || { ...BLANK };
    Object.assign(p, BLANK);
    list.push(p);
    return p;
  }

  glowParticle(x, y, z, vx, vy, vz, size, life, r, g, b, opts = NONE) {
    const p = this.spawn(this.glow);
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.size = size; p.life = p.max = life; p.r = r; p.g = g; p.b = b;
    p.grow = opts.grow ?? 0; p.drag = opts.drag ?? 1.5; p.gravity = opts.gravity ?? 0; p.streak = opts.streak ?? 0;
    if (p.streak) { p.mode = STREAK; p.code = 1; }
    p.roll = Math.random() * 6.28;
    if (p.gravity > 0) { p.floor = 0.03; p.bounce = 0.3; }
    return p;
  }

  smokeParticle(x, y, z, vx, vy, vz, size, life, shade, alpha = 0.55, opts = NONE) {
    const p = this.spawn(this.smoke);
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.size = size; p.life = p.max = p.fadeOut = life; p.alpha = alpha;
    p.r = shade * (opts.tint?.[0] ?? 1); p.g = shade * (opts.tint?.[1] ?? 1); p.b = shade * (opts.tint?.[2] ?? 1);
    p.grow = opts.grow ?? 1.4; p.drag = opts.drag ?? 1.2; p.gravity = opts.gravity ?? -0.6;
    p.roll = Math.random() * 6.28;
    if (p.gravity > 0) { p.floor = 0.03; p.bounce = 0.3; }
    return p;
  }

  // Turns a plain smoke particle into a billow of the atlas, shaded by the sun and slowly turning
  billow(p) {
    p.code = TILE + pick(PUFFS); p.lit = 0.3; p.spin = rand(-0.4, 0.4);
    p.size *= 1.3; p.grow *= 1.3;
    return p;
  }

  // Lit, textured smoke: a puff of the atlas shaded by the sun, tumbling a little
  puff(x, y, z, vx, vy, vz, size, life, tint, alpha, tile) {
    const p = this.spawn(this.smoke), l = this.light;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.size = size; p.life = p.max = life; p.fadeOut = life * 0.7; p.fadeIn = 14; p.alpha = alpha;
    p.r = tint[0] * l; p.g = tint[1] * l; p.b = tint[2] * l;
    p.code = TILE + tile; p.lit = 0.34; p.roll = Math.random() * 6.28; p.spin = rand(-0.6, 0.6); p.seed = Math.random() * 40;
    return p;
  }

  // A solid bit thrown off a surface: falls, bounces on the floor under the hit, lies there, fades
  fragment(x, y, z, vx, vy, vz, size, life, tint, tile, floor) {
    const p = this.spawn(this.smoke), l = this.light;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.size = size; p.life = p.max = life; p.fadeOut = 0.3; p.fadeIn = 60; p.alpha = 1;
    p.r = tint[0] * l; p.g = tint[1] * l; p.b = tint[2] * l;
    p.code = TILE + tile; p.hard = 1; p.gravity = 9.8; p.drag = 0.35; p.floor = floor; p.bounce = rand(0.2, 0.4);
    p.roll = Math.random() * 6.28; p.spin = rand(-22, 22);
    return p;
  }

  // One quad of a flash: fixed on the axes a (its length) and b (its width), or facing the camera without them.
  // Additive light alone washes out against a sunlit street, so each quad is drawn twice: an orange body in the
  // blended pool that hides what is behind the flame, then its heat on top.
  flashQuad(tile, x, y, z, length, width, hot, core, ax, ay, az, bx, by, bz) {
    const p = this.spawn(this.glow);
    p.x = x; p.y = y; p.z = z; p.len = length; p.size = width;
    p.life = p.max = 0.042; p.fresh = true; p.swell = 6; p.fadePow = 1.5;
    p.r = 4.4 * hot; p.g = 1.25 * hot; p.b = 0.2 * hot; p.core = core * hot;
    p.code = TILE + tile;
    if (ax === undefined) p.roll = Math.random() * 6.28;
    else { p.mode = PLANE; p.ax = ax; p.ay = ay; p.az = az; p.bx = bx; p.by = by; p.bz = bz; }
    if (core > 0) {
      const body = this.spawn(this.smoke);
      body.x = x; body.y = y; body.z = z; body.len = length; body.size = width;
      body.life = body.max = 0.042; body.fresh = true; body.swell = 6; body.fadeIn = 0; body.fadeOut = 0.034;
      body.r = 1.9; body.g = 0.7; body.b = 0.12; body.alpha = Math.min(0.7, 0.62 * hot);
      body.code = TILE + 16 + tile; body.mode = p.mode; body.roll = p.roll;
      body.ax = p.ax; body.ay = p.ay; body.az = p.az; body.bx = p.bx; body.by = p.by; body.bz = p.bz;
    }
    return p;
  }

  flash(x, y, z, color, power, life, distance = 18) {
    let slot = this.lights[0];
    for (const l of this.lights) if (l.life <= 0 || l.power * (l.life / l.max) < slot.power * (slot.life / slot.max)) slot = l;
    slot.light.position.set(x, y, z);
    slot.light.color.setHex(color);
    slot.light.distance = distance;
    slot.life = slot.max = life;
    slot.power = power;
    slot.fresh = true;
  }

  /**
   * A shot leaving a barrel: the flash (never twice the same), its sparks, light, a wisp of smoke, heat in the barrel.
   * @param {{x, y, z}} pos - the muzzle
   * @param {{x, y, z}} dir - unit direction of the barrel
   * @param {boolean|string} [big] - 'pistol' | 'smg' | 'shotgun' | 'rifle' (true is a shotgun, false a pistol)
   * @param {object} [opts] - scale: 0..1 strength of the flash (a suppressor is about 0.15); id: whose barrel this is
   *   (any value, see trackMuzzle); vx, vy, vz: the shooter's velocity, carried by the smoke
   */
  muzzleFlash(pos, dir, big = false, opts = NONE) {
    const kind = big === true ? 'shotgun' : FLASH[big] ? big : 'pistol';
    const f = FLASH[kind];
    const scale = opts.scale ?? 1;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    const mx = pos.x, my = pos.y, mz = pos.z;
    const barrel = this.barrel(opts.id, mx, my, mz);
    this.light = barrel.light = this.lightAt(barrel, mx, my, mz);
    square(dx, dy, dz);
    if (scale > 0.02) {
      // No two shots alike: the odd one is half a flash, as real gunfire is
      const punch = Math.sqrt(scale) * rand(0.8, 1.22) * (kind !== 'shotgun' && Math.random() < 0.12 ? 0.62 : 1);
      const hot = scale * rand(0.8, 1.2);
      const a = Math.random() * 6.283, ca = Math.cos(a), sa = Math.sin(a);
      const px = _u[0] * ca + _w[0] * sa, py = _u[1] * ca + _w[1] * sa, pz = _u[2] * ca + _w[2] * sa;
      const qx = _w[0] * ca - _u[0] * sa, qy = _w[1] * ca - _u[1] * sa, qz = _w[2] * ca - _u[2] * sa;
      let front = pick(f.front);
      if (front === this.lastFront) front = f.front[(f.front.indexOf(front) + 1) % f.front.length];
      this.lastFront = front;
      const size = f.size * punch, lead = 0.03 + size * 0.1;
      const flip = Math.random() < 0.5 ? -1 : 1;
      if (f.star) {
        // The star of a flash hider lies square to the barrel: full from behind, a line from the side
        this.flashQuad(front, mx + dx * lead, my + dy * lead, mz + dz * lead, size * 1.2, size * 1.2 * flip, hot, 10, px, py, pz, qx, qy, qz);
        this.flashQuad(pick(FLASH.pistol.front), mx + dx * lead, my + dy * lead, mz + dz * lead, size * 0.55, size * 0.55, hot * 0.8, 8);
      } else this.flashQuad(front, mx + dx * lead, my + dy * lead, mz + dz * lead, size, size * flip, hot, 10);
      // Seen from the side: two crossed planes carrying the flame along the barrel
      let side = pick(f.side);
      if (side === this.lastSide) side = f.side[(f.side.indexOf(side) + 1) % f.side.length];
      this.lastSide = side;
      const length = f.length * punch * rand(0.8, 1.25), width = f.width * punch * rand(0.85, 1.2);
      const c = length * 0.45;
      this.flashQuad(side, mx + dx * c, my + dy * c, mz + dz * c, length, width * flip, hot, 8, dx, dy, dz, px, py, pz);
      const l2 = length * rand(0.75, 1.05), c2 = l2 * 0.45;
      this.flashQuad(pick(f.side), mx + dx * c2, my + dy * c2, mz + dz * c2, l2, -width * flip * rand(0.8, 1.1), hot * 0.85, 8, dx, dy, dz, qx, qy, qz);
      // The glare round it all
      const halo = this.flashQuad(GLOW.haze, mx + dx * lead * 2, my + dy * lead * 2, mz + dz * lead * 2, size * 2.2, size * 2.2, hot * (0.17 - 0.15 * this.level), 0);
      halo.swell = 3;
      // Burning grains of powder thrown down the line of fire
      const sparks = f.sparks * (0.5 + Math.random()) * Math.min(1, scale * 1.5);
      for (let i = 0; i < sparks; i++) {
        const v = rand(12, 34), cone = kind === 'shotgun' ? 0.2 : 0.11;
        const jx = rand(-cone, cone), jy = rand(-cone, cone);
        const p = this.glowParticle(mx + dx * 0.05, my + dy * 0.05, mz + dz * 0.05,
          (dx + _u[0] * jx + _w[0] * jy) * v, (dy + _u[1] * jx + _w[1] * jy) * v, (dz + _u[2] * jx + _w[2] * jy) * v,
          rand(0.0018, 0.004), rand(0.06, 0.22), 5, 1.8, 0.4, POWDER);
        p.floor = -Infinity;
      }
      this.flash(mx + dx * 0.22, my + dy * 0.22 + 0.02, mz + dz * 0.22, 0xffb066, f.light * punch * hot, 0.05, 6.5);
    }

    // Smoke: a fast thin wisp down the line of fire, slower puffs that hang at the muzzle and drift
    const thick = f.puff * (0.55 + 0.45 * Math.min(1, scale * 2));
    const sx = opts.vx ?? 0, sy = opts.vy ?? 0, sz = opts.vz ?? 0;
    const grey = SMOKE_GREY;
    let v = rand(3.5, 6.5);
    let p = this.puff(mx + dx * 0.1, my + dy * 0.1, mz + dz * 0.1, dx * v + sx, dy * v + sy, dz * v + sz,
      0.07 * thick, rand(0.7, 1.1), grey, 0.24 * Math.min(1.3, thick), pick(WISPS));
    p.grow = 0.5 * thick; p.drag = 7; p.gravity = -0.35; p.turb = 0.5;
    for (let i = 1; i < f.smoke; i++) {
      v = rand(0.5, 2.4);
      p = this.puff(mx + dx * 0.06, my + dy * 0.06, mz + dz * 0.06,
        dx * v + rand(-0.35, 0.35) + sx, dy * v + rand(0.1, 0.5) + sy, dz * v + rand(-0.35, 0.35) + sz,
        0.06 * thick, rand(1.2, 2.2), grey, 0.14 * Math.min(1.4, thick), pick(PUFFS));
      p.grow = 0.26 * thick; p.drag = 3.2; p.gravity = -0.3; p.turb = 0.6;
    }
    barrel.x = mx; barrel.y = my; barrel.z = mz; barrel.dx = dx; barrel.dy = dy; barrel.dz = dz;
    barrel.heat = Math.min(1.5, barrel.heat + f.heat * (0.5 + 0.5 * Math.min(1, scale * 2)));
    barrel.since = 0;
  }

  // The light of a place: the day's brightness in the sun, under a third of it in a building's shadow, and at night the
  // same everywhere. The sun is asked for a few times a second per place at most: cache is a barrel or the last hit.
  lightAt(cache, x, y, z) {
    let lit = 0.15;
    if (this.sunlit) {
      if (this.time - cache.litT > 0.3 || Math.abs(x - cache.litX) + Math.abs(y - cache.litY) + Math.abs(z - cache.litZ) > 2.5) {
        cache.lit = this.sunlit(x, y, z); cache.litT = this.time; cache.litX = x; cache.litY = y; cache.litZ = z;
      }
      lit = cache.lit;
    }
    const day = Math.min(1, Math.max(0, (this.level - 0.3) / 0.6));
    return this.level * (1 - day * 0.7 * (1 - lit));
  }

  // The record of a barrel: by owner if one is given, else the one that last fired from about there, else the coldest
  barrel(id, x, y, z) {
    let best = null, cold = this.barrels[0];
    for (const b of this.barrels) {
      if (id != null ? b.id === id : b.id == null && b.heat > 0.01 && Math.abs(b.x - x) + Math.abs(b.y - y) + Math.abs(b.z - z) < 1.6) { best = b; break; }
      if (b.heat < cold.heat) cold = b;
    }
    if (best) return best;
    cold.id = id ?? null; cold.heat = 0; cold.emit = 0; cold.tracked = false; cold.litT = -10;
    return cold;
  }

  /**
   * Keeps a hot barrel's smoke on the muzzle while its owner moves: call every frame with the id given to muzzleFlash.
   * Without it the smoke keeps to where the last shot left and stops sooner.
   */
  trackMuzzle(id, pos, dir) {
    for (const b of this.barrels) {
      if (b.id !== id || id == null) continue;
      b.x = pos.x; b.y = pos.y; b.z = pos.z; b.tracked = true;
      if (dir) { b.dx = dir.x; b.dy = dir.y; b.dz = dir.z; }
      return;
    }
  }

  /**
   * A bullet in flight: a short tapered streak with a hot head, from the muzzle to where it lands.
   * @param {string} [kind] - 'shotgun' draws a pellet: thinner, shorter, fainter
   */
  tracer(from, to, kind) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1) return null;
    const thin = kind === 'shotgun' || kind === 'pellet' || kind === 'ricochet';
    const p = this.spawn(this.glow);
    p.mode = TRACER; p.tracer = true; p.code = 2; p.fresh = true;
    p.ox = p.x = from.x; p.oy = p.y = from.y; p.oz = p.z = from.z;
    p.ax = dx / len; p.ay = dy / len; p.az = dz / len;
    p.total = len;
    p.speed = (thin ? 300 : 390) * rand(0.9, 1.12);
    p.len = (thin ? 3 : 6.2) * rand(0.8, 1.2);
    p.dist = Math.random() * 2.2;
    p.size = thin ? 0.0035 : 0.0055;
    p.life = p.max = 10;
    const k = thin ? 0.6 : 1;
    p.r = 2.3 * k; p.g = 1.7 * k; p.b = 0.95 * k; p.alpha = 0.7;
    return p;
  }

  /**
   * A spent case thrown from the ejection port: it spins, bounces on the ground, comes to rest and fades.
   * @param {{x, y, z}} pos - the muzzle (the port is taken a little behind it unless opts.port says where it is)
   * @param {{x, y, z}} dir - unit direction of the barrel
   * @param {string} [kind] - 'pistol' | 'smg' | 'rifle' | 'shotgun'
   * @param {number} [groundY] - height of the ground under the shooter
   * @param {object} [opts] - port: {x, y, z} of the ejection port; right, up: unit axes of the gun; vx, vy, vz: the
   *   shooter's velocity
   */
  ejectCasing(pos, dir, kind = 'pistol', groundY = 0, opts = NONE) {
    const spec = CASINGS[kind] || CASINGS.pistol;
    const c = this.casings.length >= CASING_MAX ? this.casings.shift() : this.casingFree.pop() || {};
    let rx, ry, rz, ux, uy, uz;
    if (opts.right) { rx = opts.right.x; ry = opts.right.y; rz = opts.right.z; }
    else { const flat = Math.hypot(dir.x, dir.z) || 1; rx = -dir.z / flat; ry = 0; rz = dir.x / flat; }
    if (opts.up) { ux = opts.up.x; uy = opts.up.y; uz = opts.up.z; } else { ux = 0; uy = 1; uz = 0; }
    if (opts.port) { c.x = opts.port.x; c.y = opts.port.y; c.z = opts.port.z; }
    else {
      const back = spec[5];
      c.x = pos.x - dir.x * back + rx * 0.035 + ux * 0.02; c.y = pos.y - dir.y * back + ry * 0.035 + uy * 0.02;
      c.z = pos.z - dir.z * back + rz * 0.035 + uz * 0.02;
    }
    const pump = kind === 'shotgun';
    const side = pump ? rand(1.1, 1.8) : rand(1.4, 2.5), lift = pump ? rand(0.9, 1.5) : rand(1.1, 2), back = rand(-0.2, 0.7);
    c.vx = rx * side + ux * lift - dir.x * back + (opts.vx ?? 0);
    c.vy = ry * side + uy * lift - dir.y * back + (opts.vy ?? 0);
    c.vz = rz * side + uz * lift - dir.z * back + (opts.vz ?? 0);
    c.yaw = Math.random() * 6.28; c.pitch = Math.random() * 6.28;
    c.wy = rand(-12, 12); c.wp = rand(16, 38) * (Math.random() < 0.5 ? -1 : 1);
    c.radius = spec[0]; c.length = spec[1]; c.variant = spec[2];
    _color.setHex(spec[3]);
    c.r = _color.r; c.g = _color.g; c.b = _color.b; c.metal = spec[4];
    c.kind = kind; c.groundY = c.floor = groundY; c.probed = false; c.bounces = 0;
    c.life = 10; c.settled = false;
    this.casings.push(c);
    return c;
  }

  // ---- Decals -----------------------------------------------------------------------------------------------------
  // A mark laid flat on a surface, turned at random round its normal
  decal(tile, x, y, z, nx, ny, nz, size, tint, life = 45, roughness = 0.95, hard = 1) {
    const m = this.impactMarks.length >= DECAL_MAX ? this.impactMarks.shift() : this.markFree.pop() || {};
    let l = Math.hypot(nx, ny, nz);
    if (l < 1e-4) { nx = 0; ny = 1; nz = 0; l = 1; }
    nx /= l; ny /= l; nz /= l;
    square(nx, ny, nz);
    const a = Math.random() * 6.283, ca = Math.cos(a), sa = Math.sin(a);
    m.tx = _u[0] * ca + _w[0] * sa; m.ty = _u[1] * ca + _w[1] * sa; m.tz = _u[2] * ca + _w[2] * sa;
    m.bx = _w[0] * ca - _u[0] * sa; m.by = _w[1] * ca - _u[1] * sa; m.bz = _w[2] * ca - _u[2] * sa;
    m.nx = nx; m.ny = ny; m.nz = nz;
    m.x = x + nx * 0.008; m.y = y + ny * 0.008; m.z = z + nz * 0.008;
    m.size = m.full = size; m.spread = 0; m.life = life; m.fade = 5; m.alpha = 0.96;
    m.tile = tile; m.r = tint[0]; m.g = tint[1]; m.b = tint[2]; m.rough = roughness; m.hard = hard;
    this.impactMarks.push(m);
    this.marksDirty = true;
    return m;
  }

  // A bullet hole on a static surface (kept for callers that only want the mark)
  impactMark(x, y, z, nx, ny, nz, kind = 'concrete') {
    const d = kind === 'metal' ? METAL_DECAL : kind === 'glass' ? GLASS_DECAL : (SURFACES[kind] || SURFACES.concrete).decal;
    return this.decal(pick(d[0]), x, y, z, nx, ny, nz, d[1] * rand(0.8, 1.2), d[2], 45, d[3]);
  }

  /**
   * Blood left on the ground under a body: a pool that spreads for a few seconds, then stays and dries out.
   * @param {number} y - height of the ground there (null or undefined: asked from the ground function given to update)
   * @param {number} [size] - width of the pool once spread, in metres
   */
  bloodStain(x, y, z, size = 0.55) {
    const m = this.decal(pick(BLOOD_POOLS), x, y ?? this.ground?.(x, z) ?? 0, z, 0, 1, 0, size * 0.32, BLOOD, 60, 0.42);
    m.full = size * rand(0.85, 1.15); m.spread = 1.1; m.fade = 8;
    return m;
  }

  /** Blood thrown on a surface behind a wound (a wall, a car door...): (point, normal, size in metres) */
  bloodSplatter(x, y, z, nx, ny, nz, size = 0.5) {
    return this.decal(Math.random() < 0.5 ? DECAL.bloodSpray : pick(BLOOD_DROPS), x, y, z, nx, ny, nz, size, BLOOD, 60, 0.42);
  }

  // ---- Impacts ----------------------------------------------------------------------------------------------------
  /**
   * A bullet striking a surface.
   * @param {string} [kind] - 'concrete' | 'asphalt' | 'metal' | 'glass' | 'flesh' | 'water' | 'dirt' | 'wood'
   * @param {object} [opts] - decal: leave a mark on the surface (default: yes on concrete, asphalt, dirt and wood, no on
   *   metal and glass, which are mostly moving cars: pass true for static metal or glass, false for anything that
   *   moves); dir: {x, y, z} unit direction of the bullet (sparks and dust lean with it, shallow hits ricochet);
   *   scale: size of the effect (1)
   */
  impact(x, y, z, nx, ny, nz, kind = 'concrete', opts = NONE) {
    const few = ++this.impactsThisFrame > 3; // a shotgun's pellets land together: each throws less
    const s = opts.scale ?? 1;
    const d = opts.dir;
    // where the bits will land
    let floor = y;
    if (ny < 0.7) {
      floor = this.ground ? this.ground(x + nx * 0.3, z + nz * 0.3) : 0;
      if (!(floor < y - 0.02)) floor = y - 1.4;
    }
    floor += 0.012;
    // the way things leave: off the normal, leaning along the bullet's reflection when its direction is known
    let ox = nx, oy = ny, oz = nz, graze = 1;
    if (d) {
      const k = d.x * nx + d.y * ny + d.z * nz;
      graze = -k;
      ox = nx * 0.55 + (d.x - 2 * k * nx) * 0.45; oy = ny * 0.55 + (d.y - 2 * k * ny) * 0.45; oz = nz * 0.55 + (d.z - 2 * k * nz) * 0.45;
    }
    square(nx, ny, nz);
    const light = this.light = this.lightAt(this.hitLight, x + nx * 0.25, y + ny * 0.25 + 0.05, z + nz * 0.25);

    if (kind === 'flesh') {
      // a red mist off the wound, heavier drops that fall and mark the ground
      for (let i = few ? 1 : 3; i > 0; i--) {
        const v = rand(0.8, 2.4);
        const p = this.puff(x, y, z, ox * v + rand(-0.6, 0.6), oy * v + rand(-0.1, 0.7), oz * v + rand(-0.6, 0.6), 0.07 * s, rand(0.25, 0.45), BLOOD_MIST, 0.55, pick(PUFFS));
        p.grow = 0.75; p.drag = 4; p.gravity = 1.5; p.lit = 0.2;
      }
      if (d) for (let i = few ? 1 : 2; i > 0; i--) {
        const v = rand(2.5, 5);
        const p = this.puff(x, y, z, d.x * v + rand(-0.5, 0.5), d.y * v + rand(-0.2, 0.5), d.z * v + rand(-0.5, 0.5), 0.06 * s, rand(0.22, 0.4), BLOOD_MIST, 0.5, pick(WISPS));
        p.grow = 0.9; p.drag = 5; p.gravity = 1.5; p.lit = 0.2;
      }
      for (let i = few ? 2 : 5; i > 0; i--) {
        const v = rand(0.8, 3.2), back = d ? rand(0, 2.4) : 0;
        const p = this.fragment(x, y, z, ox * v + (d ? d.x * back : 0) + rand(-0.8, 0.8), oy * v + rand(0.3, 1.6), oz * v + (d ? d.z * back : 0) + rand(-0.8, 0.8),
          rand(0.012, 0.024) * s, 1.6, BLOOD_DROP, SMOKE.droplet, floor);
        p.spin = 0; p.stain = i === 1 || (i === 2 && !few) ? 1 : 2;
      }
      return;
    }

    if (kind === 'water') {
      const white = WATER_WHITE;
      const col = this.spawn(this.smoke);
      col.mode = UPRIGHT; col.code = TILE + SMOKE.column; col.x = x; col.y = y; col.z = z; col.ax = 0; col.ay = 1; col.az = 0;
      col.size = 0.26 * s; col.len = 0.4 * s; col.stretch = 9 * s; col.drag = 7; col.grow = 0.5; col.life = col.max = 0.55; col.fadeOut = 0.4; col.fadeIn = 40; col.alpha = 0.7;
      col.r = white[0] * light; col.g = white[1] * light; col.b = white[2] * light;
      for (let i = few ? 2 : 6; i > 0; i--) {
        const p = this.fragment(x, y + 0.05, z, rand(-1.3, 1.3), rand(2.2, 5.5), rand(-1.3, 1.3), rand(0.012, 0.026) * s, 1.2, white, SMOKE.droplet, y - 0.05);
        p.spin = 0; p.stain = 2; p.alpha = 0.8;
      }
      for (let i = few ? 1 : 3; i > 0; i--) {
        const a = Math.random() * 6.283, v = rand(0.6, 1.6);
        const p = this.puff(x, y + 0.06, z, Math.cos(a) * v, rand(0.3, 1), Math.sin(a) * v, 0.12 * s, rand(0.4, 0.7), white, 0.4, pick(PUFFS));
        p.grow = 0.9; p.drag = 2.5; p.gravity = 2;
      }
      return;
    }

    if (kind === 'glass') {
      // pale fragments that catch the light as they fall
      for (let i = few ? 4 : 9; i > 0; i--) {
        const v = rand(0.8, 4);
        const p = this.fragment(x, y, z, ox * v + rand(-1.6, 1.6), oy * v + rand(-0.4, 1.8), oz * v + rand(-1.6, 1.6),
          rand(0.012, 0.032) * s, rand(0.8, 1.3), GLASS_PALE, i % 3 ? SMOKE.shard : SMOKE.chipC, floor);
        p.alpha = 0.8;
      }
      const glare = 0.35 + 0.65 * light;
      for (let i = few ? 2 : 6; i > 0; i--) {
        const v = rand(0.8, 3.5);
        const p = this.glowParticle(x, y, z, ox * v + rand(-1.5, 1.5), oy * v + rand(-0.3, 1.6), oz * v + rand(-1.5, 1.5),
          rand(0.05, 0.11) * s, rand(0.07, 0.32), 2.4 * glare, 2.8 * glare, 3.2 * glare, GLINT);
        p.code = TILE + GLOW.glint; p.floor = floor; p.core = 5 * glare; p.fadePow = 0.4;
      }
      const p = this.puff(x + nx * 0.04, y + ny * 0.04, z + nz * 0.04, ox * 1.2, oy * 1.2 + 0.2, oz * 1.2, 0.09 * s, 0.4, GLASS_PALE, 0.3, pick(PUFFS));
      p.grow = 0.8; p.drag = 4;
      if (opts.decal === true) this.impactMark(x, y, z, nx, ny, nz, 'glass');
      return;
    }

    if (kind === 'metal') {
      // a burst of white-hot sparks off the reflection, falling and bouncing; a wink of light at the hole
      for (let i = few ? 4 : Math.round(rand(9, 14)); i > 0; i--) {
        const v = rand(3.5, 15), jx = rand(-0.75, 0.75), jy = rand(-0.75, 0.75);
        const p = this.glowParticle(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01,
          (ox + _u[0] * jx + _w[0] * jy) * v, (oy + _u[1] * jx + _w[1] * jy) * v + rand(0, 1.5), (oz + _u[2] * jx + _w[2] * jy) * v,
          rand(0.003, 0.0065) * s, rand(0.18, 0.6), 7.5, 4.2, 1.6, SPARK);
        p.floor = floor; p.bounce = 0.45;
      }
      const wink = this.flashQuad(GLOW.sparkBurst, x + nx * 0.03, y + ny * 0.03, z + nz * 0.03, 0.26 * s, 0.26 * s, 0.85, 12);
      wink.life = wink.max = 0.05;
      if (!few) {
        const p = this.puff(x + nx * 0.04, y + ny * 0.04, z + nz * 0.04, ox * 0.9, oy * 0.9 + 0.3, oz * 0.9, 0.06 * s, 0.45, METAL_SMOKE, 0.3, pick(PUFFS));
        p.grow = 0.5; p.drag = 3;
      }
      if (opts.decal === true) this.impactMark(x, y, z, nx, ny, nz, 'metal');
      if (d && graze < 0.42 && Math.random() < 0.65) this.ricochet(x, y, z, nx, ny, nz, d);
      return;
    }

    // Masonry, road, earth, timber: a jet of dust off the face, chips that fall, a hole
    const surf = SURFACES[kind] || SURFACES.concrete;
    if (opts.decal !== false) this.impactMark(x, y, z, nx, ny, nz, SURFACES[kind] ? kind : 'concrete');
    const jet = this.spawn(this.smoke);
    jet.mode = UPRIGHT; jet.code = TILE + SMOKE.burst; jet.x = x; jet.y = y; jet.z = z;
    let l = Math.hypot(ox, oy, oz) || 1;
    jet.ax = ox / l; jet.ay = oy / l; jet.az = oz / l;
    jet.size = 0.2 * s; jet.len = 0.25 * s; jet.stretch = rand(3.6, 5.2) * s; jet.drag = 9; jet.grow = 0.5; jet.life = jet.max = rand(0.34, 0.5); jet.fadeOut = jet.life * 0.85; jet.fadeIn = 60; jet.alpha = 0.46;
    jet.r = surf.dust[0] * light; jet.g = surf.dust[1] * light; jet.b = surf.dust[2] * light; jet.lit = 0.2;
    for (let i = few ? 1 : surf.puffs; i > 0; i--) {
      const v = rand(1.2, 4.2);
      const p = this.puff(x + nx * 0.04, y + ny * 0.04, z + nz * 0.04, ox * v + rand(-0.5, 0.5), oy * v + rand(-0.2, 0.6), oz * v + rand(-0.5, 0.5),
        0.07 * s, rand(0.6, 1.2), surf.dust, 0.34, pick(PUFFS));
      p.grow = 0.5; p.drag = 5; p.gravity = 0.25; p.turb = 0.3;
    }
    for (let i = few ? 2 : surf.chips; i > 0; i--) {
      const v = rand(1, 4.6), jx = rand(-0.9, 0.9), jy = rand(-0.9, 0.9);
      const p = this.fragment(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02,
        (ox + _u[0] * jx + _w[0] * jy) * v, (oy + _u[1] * jx + _w[1] * jy) * v + rand(0.2, 1.6), (oz + _u[2] * jx + _w[2] * jy) * v,
        rand(0.01, 0.026) * s, rand(0.9, 1.6), surf.chip, surf.tile === SMOKE.chipA ? pick(CHIPS) : surf.tile, floor);
      if (surf.tile === SMOKE.splinter) { p.len = p.size * rand(3, 6); p.size *= 0.9; }
    }
    if (Math.random() < surf.sparks) {
      for (let i = 1 + (Math.random() * 3 | 0); i > 0; i--) {
        const v = rand(3, 9);
        const p = this.glowParticle(x, y, z, ox * v + rand(-2, 2), oy * v + rand(-1, 2), oz * v + rand(-2, 2), rand(0.003, 0.005), rand(0.1, 0.25), 6, 3.1, 1, SPARK);
        p.floor = floor;
      }
    }
    if (d && graze < 0.34 && kind !== 'dirt' && kind !== 'wood' && Math.random() < 0.5) this.ricochet(x, y, z, nx, ny, nz, d);
  }

  // A bullet glancing off: a spark and a short streak leaving along the reflection
  ricochet(x, y, z, nx, ny, nz, d) {
    const k = d.x * nx + d.y * ny + d.z * nz;
    let rx = d.x - 2 * k * nx + rand(-0.12, 0.12), ry = d.y - 2 * k * ny + rand(0, 0.2), rz = d.z - 2 * k * nz + rand(-0.12, 0.12);
    const l = Math.hypot(rx, ry, rz) || 1, reach = rand(9, 24);
    rx /= l; ry /= l; rz /= l;
    _p.set(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02);
    _s.set(_p.x + rx * reach, _p.y + ry * reach, _p.z + rz * reach);
    const t = this.tracer(_p, _s, 'ricochet');
    if (t) { t.r = 4.5; t.g = 2.4; t.b = 0.8; t.speed *= 0.6; }
    for (let i = 0; i < 3; i++) {
      const v = rand(8, 20);
      this.glowParticle(_p.x, _p.y, _p.z, rx * v + rand(-1.5, 1.5), ry * v + rand(-1, 1.5), rz * v + rand(-1.5, 1.5), rand(0.003, 0.005), rand(0.1, 0.3), 7, 3.8, 1.3, SPARK).floor = -Infinity;
    }
  }

  explosion(x, y, z, size = 1) {
    for (let i = 0; i < 26 * size; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 0.9 + 0.1, v = 3 + Math.random() * 9 * size;
      this.glowParticle(x, y + 0.6, z, Math.cos(a) * v * (1 - e * 0.5), e * v, Math.sin(a) * v * (1 - e * 0.5),
        (1.4 + Math.random() * 1.6) * size, 0.55 + Math.random() * 0.6, 5, 2.4 + Math.random(), 0.6, { drag: 3, gravity: -2, grow: 1.6 });
    }
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2, v = 6 + Math.random() * 18;
      this.glowParticle(x, y + 0.8, z, Math.cos(a) * v, 4 + Math.random() * 12, Math.sin(a) * v, 0.05, 0.6 + Math.random() * 0.8,
        4, 2.5, 1, { gravity: 14, drag: 0.4, streak: 0.4 });
    }
    for (let i = 0; i < 30 * size; i++) {
      const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 5;
      this.billow(this.smokeParticle(x + Math.cos(a), y + 1 + Math.random() * 2, z + Math.sin(a), Math.cos(a) * v, 2 + Math.random() * 5, Math.sin(a) * v,
        (1.6 + Math.random() * 1.8) * size, 3 + Math.random() * 4, 0.1 + Math.random() * 0.12, 0.85, EXPLOSION_SMOKE));
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 10;
      const s = 0.12 + Math.random() * 0.35;
      if (this.debris.length >= DEBRIS_MAX) this.debris.shift();
      this.debris.push({ x, y: y + 1, z, vx: Math.cos(a) * v, vy: 5 + Math.random() * 10, vz: Math.sin(a) * v, sx: s, sy: s * 0.4, sz: s * 1.3,
        rx: Math.random() * 6, ry: Math.random() * 6, wx: (Math.random() - 0.5) * 16, wy: (Math.random() - 0.5) * 16, life: 12 + Math.random() * 6 });
    }
    if (this.scorches.length >= SCORCH_MAX) this.scorches.shift();
    this.scorches.push({ x, z, r: 3.2 * size + Math.random(), life: 90 });
    this.flash(x, y + 2, z, 0xff8a30, 1600 * size, 0.9, 60);
  }

  // Bits of a car thrown off a hard blow
  shards(x, y, z, nx, nz, count) {
    for (let i = 0; i < count; i++) {
      const v = 3 + Math.random() * 8, s = 0.06 + Math.random() * 0.2;
      if (this.debris.length >= DEBRIS_MAX) this.debris.shift();
      this.debris.push({ x, y, z, vx: nx * v + (Math.random() - 0.5) * 6, vy: 2 + Math.random() * 6, vz: nz * v + (Math.random() - 0.5) * 6, sx: s, sy: s * 0.3, sz: s * 1.2,
        rx: Math.random() * 6, ry: Math.random() * 6, wx: (Math.random() - 0.5) * 18, wy: (Math.random() - 0.5) * 18, life: 7 + Math.random() * 5 });
    }
  }

  // Continuous emitters, called every frame by burning or damaged vehicles (rate in particles per second)
  // Leaves shaken out of a crown, spinning down
  leaves(x, y, z, radius, count = 40) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * radius;
      const green = 0.55 + Math.random() * 0.4;
      this.smokeParticle(x + Math.cos(a) * d, y + Math.random() * radius * 0.6, z + Math.sin(a) * d,
        (Math.random() - 0.5) * 2.4, -0.4 - Math.random() * 0.8, (Math.random() - 0.5) * 2.4,
        0.1 + Math.random() * 0.09, 2 + Math.random() * 2.5, 0.42, 0.95, { tint: [0.62, green, 0.2], gravity: 0.5, drag: 1.1, grow: 0 });
    }
  }

  // A broken hydrant: a jet of water falling back as spray. Call every frame
  jet(x, y, z, dt) {
    for (let n = Math.ceil(dt * 70); n > 0; n--) {
      const a = Math.random() * 6.28, s = 0.3 + Math.random() * 0.8;
      this.smokeParticle(x, y, z, Math.cos(a) * s, 7.5 + Math.random() * 3, Math.sin(a) * s,
        0.1 + Math.random() * 0.1, 1 + Math.random() * 0.6, 0.86, 0.5, { tint: [0.93, 0.97, 1], gravity: 9.5, drag: 0.25, grow: 0.65 });
    }
  }

  smokeTrail(x, y, z, dt, amount = 1, dark = 0.3) {
    let n = amount * 14 * dt;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      this.billow(this.smokeParticle(x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.6, 1.6 + Math.random(),
        (Math.random() - 0.5) * 0.6, 0.35 + amount * 0.2, 1.8 + Math.random() * 1.6, (0.55 - dark * 0.45) * (0.45 + 0.55 * this.level), 0.32 + amount * 0.25, TRAIL_SMOKE));
      n -= 1;
    }
  }

  fire(x, y, z, dt, size = 1) {
    let n = 40 * size * dt;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      const r = Math.random() * 0.8 * size;
      const a = Math.random() * Math.PI * 2;
      this.glowParticle(x + Math.cos(a) * r, y + Math.random() * 0.3, z + Math.sin(a) * r, (Math.random() - 0.5) * 0.6, 1.8 + Math.random() * 1.6,
        (Math.random() - 0.5) * 0.6, (0.5 + Math.random() * 0.5) * size, 0.45 + Math.random() * 0.35, 3.4, 1.4 + Math.random() * 0.6, 0.3,
        { drag: 1, gravity: -1.5, grow: -0.3 });
      n -= 1;
    }
    this.smokeTrail(x, y + 1.2 * size, z, dt, 1.4 * size, 0.85);
    if (Math.random() < dt * 12) this.flash(x, y + 1, z, 0xff7a28, 120 * size, 0.12, 16);
  }

  // ---- Simulation & drawing -------------------------------------------------------------------------------------
  updateBarrels(dt) {
    const grey = SMOKE_GREY;
    for (const b of this.barrels) {
      if (b.heat <= 0.01) { if (b.heat) { b.heat = 0; b.id = null; b.tracked = false; } continue; }
      b.since += dt;
      b.heat *= Math.exp(-dt * 0.8);
      // Only a barrel that has been worked smokes; untracked, it stops before its owner can have walked away
      const linger = b.tracked ? 2.6 : 0.45;
      if (b.heat < 0.24 || b.since > linger) continue;
      b.emit += dt * Math.min(16, (b.heat - 0.18) * 20);
      this.light = b.light;
      while (b.emit >= 1) {
        b.emit -= 1;
        const p = this.puff(b.x + b.dx * 0.02, b.y + b.dy * 0.02, b.z + b.dz * 0.02,
          b.dx * rand(0.1, 0.4) + rand(-0.1, 0.1), rand(0.25, 0.5), b.dz * rand(0.1, 0.4) + rand(-0.1, 0.1),
          rand(0.045, 0.07), rand(1.4, 2.6), grey, Math.min(0.22, 0.1 + b.heat * 0.1), pick(CURLS)); // thin: the camera sits just behind it
        p.grow = rand(0.14, 0.22); p.drag = 1.3; p.gravity = -0.2; p.turb = 0.4; p.fadeIn = 5;
      }
    }
  }

  updateCasings(dt, ground) {
    const M = this.casingMesh.instanceMatrix.array, A = this.casingA.array, B = this.casingB.array;
    let n = 0;
    for (let i = 0; i < this.casings.length; i++) {
      const c = this.casings[i];
      c.life -= dt;
      if (c.life <= 0) { this.casingFree.push(c); continue; }
      if (!c.settled && dt > 0) {
        c.vy -= 9.81 * dt;
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        c.yaw += c.wy * dt; c.pitch += c.wp * dt;
        // the ground is only asked for once the case is nearly down, and again where each bounce lands it
        if (!c.probed && c.y < c.floor + 0.35) { c.floor = ground?.(c.x, c.z) ?? c.groundY; c.probed = true; }
        const floor = c.floor + c.radius;
        if (c.y < floor) {
          const speed = -c.vy;
          c.y = floor;
          if (speed > 0.7 && c.bounces < 4) {
            c.bounces++;
            c.vy = speed * rand(0.3, 0.48);
            // a cylinder never bounces straight: it kicks off sideways and tumbles the other way
            const kick = speed * 0.22;
            c.vx = c.vx * 0.6 + rand(-kick, kick); c.vz = c.vz * 0.6 + rand(-kick, kick);
            c.wp = -c.wp * rand(0.4, 0.8); c.wy = rand(-9, 9);
            c.floor = ground?.(c.x, c.z) ?? c.groundY;
            this.onCasingBounce?.(c.x, c.y, c.z, c.kind, speed);
          } else {
            c.settled = true; c.pitch = Math.PI / 2; c.vx = c.vy = c.vz = 0;
            if (speed > 0.25) this.onCasingBounce?.(c.x, c.y, c.z, c.kind, speed);
          }
        }
      }
      this.casings[n] = c;
      _q.setFromEuler(_euler.set(c.pitch, c.yaw, 0));
      const fade = Math.min(1, c.life);
      _m.compose(_p.set(c.x, c.y, c.z), _q, _s.set(c.radius * 2 * fade, c.length * fade, c.radius * 2 * fade));
      _m.toArray(M, n * 16);
      const a = n * 4;
      A[a] = c.r; A[a + 1] = c.g; A[a + 2] = c.b; A[a + 3] = c.metal;
      B[a] = c.variant;
      n++;
    }
    this.casings.length = n;
    if (!n && this.updates <= 3) { this.casingMesh.setMatrixAt(0, zero); n = 1; }
    this.casingMesh.count = n;
    this.casingMesh.visible = n > 0;
    if (n) { this.casingMesh.instanceMatrix.needsUpdate = true; this.casingA.needsUpdate = this.casingB.needsUpdate = true; }
  }

  updateImpactMarks(dt) {
    const marks = this.impactMarks, M = this.impactMesh.instanceMatrix.array, A = this.decalA.array, B = this.decalB.array;
    let n = 0, moved = this.marksDirty;
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      m.life -= dt;
      if (m.life <= 0) { this.markFree.push(m); moved = true; continue; }
      let grew = false;
      if (m.spread > 0 && m.size < m.full && dt > 0) { m.size = Math.min(m.full, m.size + (m.full - m.size) * Math.min(1, dt * m.spread) + dt * 0.01); grew = true; }
      marks[n] = m;
      if (moved || grew) {
        const o = n * 16, s = m.size;
        M[o] = m.tx * s; M[o + 1] = m.ty * s; M[o + 2] = m.tz * s; M[o + 3] = 0;
        M[o + 4] = m.bx * s; M[o + 5] = m.by * s; M[o + 6] = m.bz * s; M[o + 7] = 0;
        M[o + 8] = m.nx; M[o + 9] = m.ny; M[o + 10] = m.nz; M[o + 11] = 0;
        M[o + 12] = m.x; M[o + 13] = m.y; M[o + 14] = m.z; M[o + 15] = 1;
        const a = n * 4;
        A[a] = m.r; A[a + 1] = m.g; A[a + 2] = m.b;
        B[a] = m.tile; B[a + 1] = m.hard; B[a + 2] = m.rough;
        this.impactMesh.instanceMatrix.needsUpdate = this.decalB.needsUpdate = true;
      }
      const alpha = Math.fround(m.alpha * Math.min(1, m.life / m.fade));
      if (moved || A[n * 4 + 3] !== alpha) { A[n * 4 + 3] = alpha; this.decalA.needsUpdate = true; }
      n++;
    }
    marks.length = n;
    this.marksDirty = false;
    if (!n && this.updates <= 3) { this.impactMesh.setMatrixAt(0, zero); this.impactMesh.instanceMatrix.needsUpdate = true; n = 1; }
    this.impactMesh.count = n;
    this.impactMesh.visible = n > 0;
  }

  updatePool(pool, dt, blended) {
    const list = pool.list, free = pool.free;
    const M = pool.mesh.instanceMatrix.array, A = pool.a.array, B = pool.b.array;
    const cam = this.camera.position, cx = cam.x, cy = cam.y, cz = cam.z;
    const rx = this.rx, ry = this.ry, rz = this.rz, ux = this.ux, uy = this.uy, uz = this.uz;
    // the sun as the quads see it, for the shading of smoke
    const lx = this.sunX * rx + this.sunY * ry + this.sunZ * rz, ly = this.sunX * ux + this.sunY * uy + this.sunZ * uz;
    const time = this.time, wx = this.wind.x, wz = this.wind.z;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const fresh = p.fresh;
      if (fresh) p.fresh = false; else p.life -= dt;
      if (p.life <= 0) { free.push(p); continue; }
      const o = n * 16, a = n * 4;
      let alpha, edge = 1;

      if (p.mode === TRACER) {
        p.dist += p.speed * dt;
        const head = p.dist < p.total ? p.dist : p.total;
        let tail = p.dist - p.len;
        if (tail < 0) tail = 0;
        // the frame it is fired on always shows it, however short the shot
        if (fresh && tail > head - Math.min(p.len, p.total)) tail = Math.max(0, head - Math.min(p.len, p.total));
        const length = head - tail;
        if (length <= 0.001 && !fresh) { free.push(p); continue; }
        p.length = length;
        const dx = p.ax, dy = p.ay, dz = p.az;
        p.x = p.ox + dx * head; p.y = p.oy + dy * head; p.z = p.oz + dz * head;
        const mx = p.ox + dx * (tail + length * 0.5), my = p.oy + dy * (tail + length * 0.5), mz = p.oz + dz * (tail + length * 0.5);
        // turned to the camera round its own line, and never thinner than about a pixel
        let tx = cx - mx, ty = cy - my, tz = cz - mz;
        const range = Math.hypot(cx - p.x, cy - p.y, cz - p.z);
        let sx = ty * dz - tz * dy, sy = tz * dx - tx * dz, sz = tx * dy - ty * dx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        const w = Math.max(p.size, range * 0.0005) * 2 / sl;
        sx *= w; sy *= w; sz *= w;
        M[o] = dx * length; M[o + 1] = dy * length; M[o + 2] = dz * length; M[o + 3] = 0;
        M[o + 4] = sx; M[o + 5] = sy; M[o + 6] = sz; M[o + 7] = 0;
        M[o + 8] = 0; M[o + 9] = 0; M[o + 10] = 1; M[o + 11] = 0;
        M[o + 12] = mx; M[o + 13] = my; M[o + 14] = mz; M[o + 15] = 1;
        A[a] = p.r; A[a + 1] = p.g; A[a + 2] = p.b; A[a + 3] = p.alpha;
        B[a] = 2; B[a + 1] = 0; B[a + 2] = 0; B[a + 3] = 0;
        list[n++] = p;
        continue;
      }

      if (dt > 0) {
        if (!p.rest) {
          const drag = Math.exp(-p.drag * dt);
          p.vx *= drag; p.vz *= drag;
          p.vy = p.vy * drag - p.gravity * dt;
          if (p.turb) {
            // smoke meanders: slow eddies that differ from one puff to the next, and the street's draught
            const ph = p.seed + time * 2.6, k = p.turb * dt;
            p.vx += (Math.sin(ph + p.y * 3.1) + wx) * k;
            p.vz += (Math.cos(ph * 1.3 + p.y * 2.7) + wz) * k;
            p.vy += Math.sin(ph * 0.7 + p.x * 2.3) * k * 0.35;
          }
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          if (p.y < p.floor) {
            p.y = p.floor;
            if (p.stain) {
              // a drop of blood marks the ground where it lands; other drops just vanish
              if (p.stain === 1) this.decal(pick(BLOOD_DROPS), p.x, p.floor - 0.012, p.z, 0, 1, 0, rand(0.07, 0.16), BLOOD, 50, 0.42);
              free.push(p);
              continue;
            }
            const vy = Math.abs(p.vy) * p.bounce;
            p.vx *= 0.6; p.vz *= 0.6; p.spin *= 0.5;
            if (vy < 0.45 && p.hard) { p.rest = true; p.vx = p.vy = p.vz = p.spin = 0; } else p.vy = vy;
          }
        }
        if (p.swell) { const k = 1 + p.swell * dt; p.size *= k; p.len *= k; } else p.size = Math.max(0.005, p.size + p.grow * dt);
        // a jet is thrown out fast and slows as it goes
        if (p.stretch) { p.len += p.stretch * dt; p.stretch *= Math.exp(-p.drag * dt); }
        if (p.spin) p.roll += p.spin * dt;
      }
      const t = p.life / p.max;

      if (p.mode === BILLBOARD) {
        const c = Math.cos(p.roll), s = Math.sin(p.roll);
        const w = p.len || p.size, h = p.size;
        M[o] = (rx * c + ux * s) * w; M[o + 1] = (ry * c + uy * s) * w; M[o + 2] = (rz * c + uz * s) * w; M[o + 3] = 0;
        M[o + 4] = (ux * c - rx * s) * h; M[o + 5] = (uy * c - ry * s) * h; M[o + 6] = (uz * c - rz * s) * h; M[o + 7] = 0;
        M[o + 8] = 0; M[o + 9] = 0; M[o + 10] = 1; M[o + 11] = 0;
        M[o + 12] = p.x; M[o + 13] = p.y; M[o + 14] = p.z; M[o + 15] = 1;
        if (p.lit) { B[a + 1] = (lx * c + ly * s) * p.lit; B[a + 2] = (ly * c - lx * s) * p.lit; } else { B[a + 1] = blended ? 0 : p.core * t * t; B[a + 2] = 0; }
      } else if (p.mode === STREAK) {
        // Stretched along its motion, facing the camera
        const speed = Math.hypot(p.vx, p.vy, p.vz) || 1;
        const dx = p.vx / speed, dy = p.vy / speed, dz = p.vz / speed;
        const tx = cx - p.x, ty = cy - p.y, tz = cz - p.z;
        let sx = ty * dz - tz * dy, sy = tz * dx - tx * dz, sz = tx * dy - ty * dx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        // never longer than the way it has come: a spark does not trail back through what threw it
        p.dist += speed * dt;
        const length = Math.min(p.dist + p.size * 3, p.streak > 1 ? p.streak : Math.max(p.size * 3, speed * p.streak * 0.05));
        const w = p.size * 2 / sl;
        sx *= w; sy *= w; sz *= w;
        M[o] = dx * length; M[o + 1] = dy * length; M[o + 2] = dz * length; M[o + 3] = 0;
        M[o + 4] = sx; M[o + 5] = sy; M[o + 6] = sz; M[o + 7] = 0;
        M[o + 8] = 0; M[o + 9] = 0; M[o + 10] = 1; M[o + 11] = 0;
        M[o + 12] = p.x - dx * length * 0.5; M[o + 13] = p.y - dy * length * 0.5; M[o + 14] = p.z - dz * length * 0.5; M[o + 15] = 1;
        B[a + 1] = 0; B[a + 2] = 0;
      } else if (p.mode === PLANE) {
        // a plane seen edge-on is a bright line that gives the trick away: it fades as it turns its edge to the eye
        const nx = p.ay * p.bz - p.az * p.by, ny = p.az * p.bx - p.ax * p.bz, nz = p.ax * p.by - p.ay * p.bx;
        const ex = cx - p.x, ey = cy - p.y, ez = cz - p.z;
        const facing = Math.abs(nx * ex + ny * ey + nz * ez) / (Math.hypot(ex, ey, ez) || 1);
        edge = facing >= 0.55 ? 1 : facing <= 0.15 ? 0 : (facing - 0.15) / 0.4;
        const w = p.len, h = p.size;
        M[o] = p.ax * w; M[o + 1] = p.ay * w; M[o + 2] = p.az * w; M[o + 3] = 0;
        M[o + 4] = p.bx * h; M[o + 5] = p.by * h; M[o + 6] = p.bz * h; M[o + 7] = 0;
        M[o + 8] = 0; M[o + 9] = 0; M[o + 10] = 1; M[o + 11] = 0;
        M[o + 12] = p.x; M[o + 13] = p.y; M[o + 14] = p.z; M[o + 15] = 1;
        B[a + 1] = p.core * t * t; B[a + 2] = 0;
      } else {
        // UPRIGHT: its foot on the point, rising along the axis, turned to the camera round it
        const dx = p.ax, dy = p.ay, dz = p.az, h = p.len, half = h * 0.4;
        const tx = cx - p.x, ty = cy - p.y, tz = cz - p.z;
        let sx = dy * tz - dz * ty, sy = dz * tx - dx * tz, sz = dx * ty - dy * tx;
        const sl = Math.hypot(sx, sy, sz) || 1, w = p.size / sl;
        sx *= w; sy *= w; sz *= w;
        M[o] = sx; M[o + 1] = sy; M[o + 2] = sz; M[o + 3] = 0;
        M[o + 4] = dx * h; M[o + 5] = dy * h; M[o + 6] = dz * h; M[o + 7] = 0;
        M[o + 8] = 0; M[o + 9] = 0; M[o + 10] = 1; M[o + 11] = 0;
        M[o + 12] = p.x + dx * half; M[o + 13] = p.y + dy * half; M[o + 14] = p.z + dz * half; M[o + 15] = 1;
        // lit from where the sun stands across the jet and along it
        if (p.lit) { B[a + 1] = (this.sunX * sx + this.sunY * sy + this.sunZ * sz) / (p.size || 1) * p.lit; B[a + 2] = (this.sunX * dx + this.sunY * dy + this.sunZ * dz) * p.lit; }
        else { B[a + 1] = 0; B[a + 2] = 0; }
      }

      if (blended) {
        alpha = p.alpha * Math.min(1, p.fadeIn ? (p.max - p.life) * p.fadeIn : 1, p.life / p.fadeOut);
        A[a] = p.r; A[a + 1] = p.g; A[a + 2] = p.b;
      } else {
        alpha = p.alpha * Math.pow(t, p.fadePow);
        const heat = 0.55 + 0.45 * t;
        A[a] = p.r * heat; A[a + 1] = p.g * heat * (0.6 + 0.4 * t); A[a + 2] = p.b * heat * (0.3 + 0.7 * t);
      }
      A[a + 3] = alpha * edge;
      B[a] = p.code; B[a + 3] = p.hard;
      list[n++] = p;
    }
    list.length = n;
    const warm = this.updates <= 3;
    if (n === 0 && warm) { pool.mesh.setMatrixAt(0, zero); n = 1; }
    pool.mesh.count = n;
    pool.mesh.visible = n > 0;
    if (n > 0) {
      pool.mesh.instanceMatrix.needsUpdate = true;
      pool.a.needsUpdate = pool.b.needsUpdate = true;
    }
  }

  // How bright the day is, and where the sun stands: read off the scene's own lights unless `ambient` is set
  readLight() {
    if (!this.sun && this.updates % 120 === 1) {
      for (const o of this.scene.children) {
        if ((o.isSunLight || o.isDirectionalLight) && !this.sun) this.sun = o; // the city's sun is three's SunLight, placed at its direction
        if (o.isHemisphereLight && !this.sky) this.sky = o;
      }
    }
    if (this.sun) {
      const p = this.sun.position, l = Math.hypot(p.x, p.y, p.z);
      if (l > 1e-3) { this.sunX = p.x / l; this.sunY = p.y / l; this.sunZ = p.z / l; }
    }
    if (this.ambient != null) this.level = this.ambient;
    else if (this.sun || this.sky) this.level = Math.max(0.3, Math.min(1, (this.sun?.intensity ?? 0) * 0.125 + (this.sky?.intensity ?? 0) * 0.18 - 0.1));
  }

  update(dt, ground = () => 0) {
    dt *= this.timeScale;
    this.updates++;
    this.time += dt;
    this.ground = ground;
    this.impactsThisFrame = 0;
    this.readLight();
    // the camera's right and up, for every billboard of the frame
    const cq = this.camera.quaternion;
    _x.set(1, 0, 0).applyQuaternion(cq); _y.set(0, 1, 0).applyQuaternion(cq);
    this.rx = _x.x; this.ry = _x.y; this.rz = _x.z; this.ux = _y.x; this.uy = _y.y; this.uz = _y.z;

    if (dt > 0) this.updateBarrels(dt);
    this.updatePool(this.glow, dt, false);
    this.updatePool(this.smoke, dt, true);
    this.updateCasings(dt, ground);
    this.updateImpactMarks(dt);

    let n = 0;
    for (const d of this.debris) {
      d.life -= dt;
      if (d.life <= 0) continue;
      const floor = ground(d.x, d.z) + d.sy * 0.5;
      if (d.y > floor || d.vy > 0) {
        d.vy -= 18 * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        d.rx += d.wx * dt; d.ry += d.wy * dt;
        if (d.y < floor) { d.y = floor; d.vy = Math.abs(d.vy) > 2 ? -d.vy * 0.35 : 0; d.vx *= 0.55; d.vz *= 0.55; d.wx *= 0.5; d.wy *= 0.5; }
      }
      this.debris[n++] = d;
      _q.setFromEuler(_debrisEuler.set(d.rx, d.ry, 0));
      _m.compose(_p.set(d.x, d.y, d.z), _q, _s.set(d.sx, d.sy, d.sz));
      this.debrisMesh.setMatrixAt(n - 1, _m);
    }
    this.debris.length = n;
    if (n === 0 && this.updates <= 3) { this.debrisMesh.setMatrixAt(0, zero); n = 1; }
    this.debrisMesh.count = n;
    this.debrisMesh.visible = n > 0;
    if (n) this.debrisMesh.instanceMatrix.needsUpdate = true;

    n = 0;
    for (const s of this.scorches) {
      s.life -= dt;
      if (s.life <= 0) continue;
      this.scorches[n++] = s;
      _m.compose(_p.set(s.x, ground(s.x, s.z) + 0.03, s.z), _q.identity(), _s.set(s.r, 1, s.r));
      this.scorchMesh.setMatrixAt(n - 1, _m);
      this.scorchAlpha.array[n - 1] = Math.min(1, s.life / 20);
    }
    this.scorches.length = n;
    if (n === 0 && this.updates <= 3) { this.scorchMesh.setMatrixAt(0, zero); n = 1; }
    this.scorchMesh.count = n;
    this.scorchMesh.visible = n > 0;
    if (n) { this.scorchMesh.instanceMatrix.needsUpdate = true; this.scorchAlpha.needsUpdate = true; }

    for (const l of this.lights) {
      if (l.life > 0) {
        if (l.fresh) l.fresh = false; else l.life -= dt;
        const t = Math.max(0, l.life / l.max);
        l.light.intensity = l.power * t * t;
        if (l.life <= 0) { l.light.intensity = 0; l.light.position.y = -1000; }
      }
    }
    this.root.updateMatrixWorld(true);
  }

  clear() {
    for (const pool of [this.glow, this.smoke]) { while (pool.list.length) pool.free.push(pool.list.pop()); }
    this.debris.length = this.scorches.length = 0;
    while (this.casings.length) this.casingFree.push(this.casings.pop());
    while (this.impactMarks.length) this.markFree.push(this.impactMarks.pop());
    this.casingMesh.count = this.impactMesh.count = 0;
    this.casingMesh.visible = this.impactMesh.visible = false;
    for (const b of this.barrels) { b.heat = 0; b.id = null; b.tracked = false; b.emit = 0; b.litT = -10; }
    this.hitLight.litT = -10;
  }
}

const SMOKE_GREY = [0.66, 0.67, 0.7];
const METAL_SMOKE = [0.42, 0.42, 0.44];
const BLOOD_MIST = [0.3, 0.012, 0.012];
const BLOOD_DROP = [0.24, 0.01, 0.01];
const WATER_WHITE = [0.88, 0.93, 0.97];
const GLASS_PALE = [0.74, 0.86, 0.9];
const CHIPS = [SMOKE.chipA, SMOKE.chipB, SMOKE.chipC];

export { EffectsSystem };
