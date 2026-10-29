import * as THREE from 'three/webgpu';
import { attribute, uv, float, smoothstep, abs, mix, vec2 } from 'three/tsl';

// Gameplay visual effects: camera-facing particles (fire, flashes, sparks, tracers in one additive draw; smoke and dust
// in one blended draw), tumbling wreck debris, scorch marks and a small pool of flash lights.
// Every pool keeps a degenerate instance until warmed up so its pipeline compiles behind the loading screen.

const GLOW_MAX = 900;
const SMOKE_MAX = 700;
const DEBRIS_MAX = 60;
const SCORCH_MAX = 12;
const LIGHT_POOL = 4;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _axis = new THREE.Vector3(0, 0, 1);
const zero = new THREE.Matrix4().makeScale(0, 0, 0);

function particleMesh(max, blending, name) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const color = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  const shape = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  for (const a of [color, alpha, shape]) a.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('fxColor', color);
  geometry.setAttribute('fxAlpha', alpha);
  geometry.setAttribute('fxShape', shape);
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending, side: THREE.DoubleSide, fog: false });
  const p = uv().sub(0.5).mul(2.0);
  // Soft disc for puffs and flames; a streak (soft along its width, tapered ends) for tracers and sparks
  const round = smoothstep(1.0, 0.0, p.length()).pow(1.6);
  const streak = smoothstep(1.0, 0.0, abs(p.y)).mul(smoothstep(1.0, 0.6, abs(p.x)));
  material.colorNode = attribute('fxColor', 'vec3');
  material.opacityNode = mix(round, streak, attribute('fxShape', 'float')).mul(attribute('fxAlpha', 'float'));
  const mesh = new THREE.InstancedMesh(geometry, material, max);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = blending === THREE.AdditiveBlending ? 997 : 996;
  mesh.count = 1;
  mesh.setMatrixAt(0, zero);
  return { mesh, color, alpha, shape, list: [] };
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

    this.lights = [];
    for (let i = 0; i < LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xffa040, 0, 20, 2);
      light.position.set(0, -1000, 0);
      this.root.add(light);
      this.lights.push({ light, life: 0, max: 1, power: 0 });
    }
    this.updates = 0;
  }

  // ---- Emitters -------------------------------------------------------------------------------------------------
  particle(pool, max, p) {
    if (pool.list.length >= max) pool.list.shift();
    pool.list.push(p);
    return p;
  }

  glowParticle(x, y, z, vx, vy, vz, size, life, r, g, b, opts = {}) {
    return this.particle(this.glow, GLOW_MAX, { x, y, z, vx, vy, vz, size, grow: opts.grow ?? 0, life, max: life, r, g, b,
      drag: opts.drag ?? 1.5, gravity: opts.gravity ?? 0, streak: opts.streak ?? 0, roll: Math.random() * 6.28, fade: opts.fade ?? 1 });
  }

  smokeParticle(x, y, z, vx, vy, vz, size, life, shade, alpha = 0.55, opts = {}) {
    return this.particle(this.smoke, SMOKE_MAX, { x, y, z, vx, vy, vz, size, grow: opts.grow ?? 1.4, life, max: life,
      r: shade * (opts.tint?.[0] ?? 1), g: shade * (opts.tint?.[1] ?? 1), b: shade * (opts.tint?.[2] ?? 1),
      drag: opts.drag ?? 1.2, gravity: opts.gravity ?? -0.6, alpha, roll: Math.random() * 6.28, streak: 0, fade: 1 });
  }

  flash(x, y, z, color, power, life, distance = 18) {
    let slot = this.lights[0];
    for (const l of this.lights) if (l.life <= 0 || l.power * (l.life / l.max) < slot.power * (slot.life / slot.max)) slot = l;
    slot.light.position.set(x, y, z);
    slot.light.color.setHex(color);
    slot.light.distance = distance;
    slot.life = slot.max = life;
    slot.power = power;
  }

  muzzleFlash(pos, dir, big = false) {
    const s = big ? 1.4 : 1;
    for (let i = 0; i < 3; i++) {
      const k = 0.08 + i * 0.12;
      this.glowParticle(pos.x + dir.x * k, pos.y + dir.y * k, pos.z + dir.z * k, dir.x * 2, dir.y * 2, dir.z * 2,
        (0.32 - i * 0.07) * s, 0.05, 6, 3.6, 1.2, { drag: 0 });
    }
    this.glowParticle(pos.x, pos.y, pos.z, 0, 0, 0, 0.55 * s, 0.035, 4, 2.4, 0.8);
    this.smokeParticle(pos.x + dir.x * 0.2, pos.y + dir.y * 0.2, pos.z + dir.z * 0.2, dir.x * 1.5, 0.3, dir.z * 1.5, 0.2, 0.7, 0.75, 0.18);
    this.flash(pos.x, pos.y, pos.z, 0xffb35c, big ? 60 : 35, 0.06, 9);
  }

  tracer(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1) return;
    const speed = 380;
    const seg = Math.min(9, len * 0.5);
    this.glowParticle(from.x, from.y, from.z, dx / len * speed, dy / len * speed, dz / len * speed, 0.035, Math.min(0.12, len / speed),
      2.6, 2.1, 1.4, { drag: 0, streak: seg });
  }

  impact(x, y, z, nx, ny, nz, kind = 'concrete') {
    if (kind === 'flesh') {
      for (let i = 0; i < 6; i++) {
        this.smokeParticle(x, y, z, nx * 1.5 + (Math.random() - 0.5) * 2, ny * 1.5 + Math.random(), nz * 1.5 + (Math.random() - 0.5) * 2,
          0.12, 0.35 + Math.random() * 0.2, 0.32, 0.75, { tint: [1, 0.12, 0.1], gravity: 3, grow: 1.8 });
      }
      return;
    }
    const metal = kind === 'metal';
    const sparks = metal ? 9 : 4;
    for (let i = 0; i < sparks; i++) {
      const vx = nx * 4 + (Math.random() - 0.5) * 7, vy = ny * 4 + Math.random() * 4, vz = nz * 4 + (Math.random() - 0.5) * 7;
      this.glowParticle(x, y, z, vx, vy, vz, 0.025, 0.15 + Math.random() * 0.2, 3.2, 2.2, 1.1, { gravity: 9, drag: 0.5, streak: 0.18 });
    }
    if (!metal || Math.random() < 0.4) {
      for (let i = 0; i < 3; i++) {
        this.smokeParticle(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * 1.4 + (Math.random() - 0.5), ny * 1.4 + Math.random() * 0.6,
          nz * 1.4 + (Math.random() - 0.5), 0.14, 0.6 + Math.random() * 0.5, metal ? 0.5 : 0.62, 0.5, { gravity: 0.6, grow: 1.6 });
      }
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
      this.smokeParticle(x + Math.cos(a), y + 1 + Math.random() * 2, z + Math.sin(a), Math.cos(a) * v, 2 + Math.random() * 5, Math.sin(a) * v,
        (1.6 + Math.random() * 1.8) * size, 3 + Math.random() * 4, 0.1 + Math.random() * 0.12, 0.85, { grow: 0.9, drag: 1.4, gravity: -1.2 });
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

  // Continuous emitters, called every frame by burning or damaged vehicles (rate in particles per second)
  smokeTrail(x, y, z, dt, amount = 1, dark = 0.3) {
    let n = amount * 14 * dt;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      this.smokeParticle(x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.6, 1.6 + Math.random(),
        (Math.random() - 0.5) * 0.6, 0.35 + amount * 0.2, 1.8 + Math.random() * 1.6, 0.55 - dark * 0.45, 0.32 + amount * 0.25, { grow: 1.3, gravity: -0.4 });
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
  updatePool(pool, dt, blended) {
    const list = pool.list;
    const cam = this.camera;
    const camQ = cam.quaternion;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag; p.vz *= drag;
      p.vy = p.vy * drag - p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.03 && p.gravity > 0) { p.y = 0.03; p.vy = Math.abs(p.vy) * 0.3; p.vx *= 0.6; p.vz *= 0.6; }
      p.size = Math.max(0.005, p.size + p.grow * dt);
      list[n++] = p;
      const t = p.life / p.max;
      const k = n - 1;
      if (p.streak) {
        // Stretched along its motion, facing the camera
        const speed = Math.hypot(p.vx, p.vy, p.vz) || 1;
        _x.set(p.vx / speed, p.vy / speed, p.vz / speed);
        _z.copy(cam.position).sub(_p.set(p.x, p.y, p.z)).normalize();
        _y.crossVectors(_z, _x).normalize();
        _z.crossVectors(_x, _y);
        _m.makeBasis(_x, _y, _z);
        const length = p.streak > 1 ? p.streak : Math.max(p.size * 3, speed * p.streak * 0.05);
        _s.set(length, p.size * 2, 1);
        _m.scale(_s);
        _m.setPosition(p.x - _x.x * length * 0.5, p.y - _x.y * length * 0.5, p.z - _x.z * length * 0.5);
        pool.shape.array[k] = 1;
      } else {
        _q.copy(camQ).multiply(_q2.setFromAxisAngle(_axis, p.roll));
        _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(p.size, p.size, p.size));
        pool.shape.array[k] = 0;
      }
      pool.mesh.setMatrixAt(k, _m);
      const fadeIn = blended ? Math.min(1, (p.max - p.life) * 8) : 1;
      pool.alpha.array[k] = blended ? p.alpha * t * fadeIn : Math.pow(t, 0.7);
      const heat = blended ? 1 : 0.55 + 0.45 * t;
      pool.color.array[k * 3] = p.r * heat;
      pool.color.array[k * 3 + 1] = p.g * heat * (blended ? 1 : 0.6 + 0.4 * t);
      pool.color.array[k * 3 + 2] = p.b * heat * (blended ? 1 : 0.3 + 0.7 * t);
    }
    list.length = n;
    const warm = this.updates <= 3;
    if (n === 0 && warm) { pool.mesh.setMatrixAt(0, zero); n = 1; }
    pool.mesh.count = n;
    pool.mesh.visible = n > 0;
    if (n > 0) {
      pool.mesh.instanceMatrix.needsUpdate = true;
      pool.color.needsUpdate = pool.alpha.needsUpdate = pool.shape.needsUpdate = true;
    }
  }

  update(dt, ground = () => 0) {
    this.updates++;
    this.updatePool(this.glow, dt, false);
    this.updatePool(this.smoke, dt, true);

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
      _q.setFromEuler(new THREE.Euler(d.rx, d.ry, 0));
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
        l.life -= dt;
        const t = Math.max(0, l.life / l.max);
        l.light.intensity = l.power * t * t;
        if (l.life <= 0) { l.light.intensity = 0; l.light.position.y = -1000; }
      }
    }
    this.root.updateMatrixWorld(true);
  }

  clear() {
    this.glow.list.length = this.smoke.list.length = 0;
    this.debris.length = this.scorches.length = 0;
  }
}

export { EffectsSystem };
