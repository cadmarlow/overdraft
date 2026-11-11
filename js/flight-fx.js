import * as THREE from 'three/webgpu';
import { attribute, float, mix, mx_noise_float, normalView, positionViewDirection, pow, smoothstep, time, uniform, uv, vec3 } from 'three/tsl';
import { sealEffect } from './effect-outputs.js';
import { AirFx } from './air-fx.js';
import { aircraftPoint } from './aircraft.js';
import { WATER } from './boat.js';

// What flight looks like around the aircraft. Ribbons the wing leaves in the air: vortices off the tips under g, the
// display smoke of the biplane, the soot of a jet at full dry power. The afterburner: a flame with standing shock
// diamonds. Condensation: the cloud that forms over a wing pulling hard, the cone round the fuselage at Mach 1 and the
// ring it leaves when the barrier goes. And the ground: tyre smoke, sparks under a belly, spray off the river.
// Everything is made once, here; nothing compiles in flight.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);
const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3(), _s = new THREE.Vector3();
const _wind = { x: 0, y: 0, z: 0 };

// A ribbon laid in the air behind a point, facing the camera: soft across, clouded along, widening and fading with age
class Ribbon {
  constructor(scene, { points = 80, life = 3, width = 0.05, grow = 0.3, most = 1, alpha = 0.5, color = 0xffffff, every = 0.03, drift = 0.3, cloud = 0.5, additive = false }) {
    Object.assign(this, { n: points, life, width, grow, most, alpha, every, drift });
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(points * 2 * 3);
    this.a = new Float32Array(points * 2);
    const side = new Float32Array(points * 2 * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('ribbonAlpha', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(side, 2).setUsage(THREE.DynamicDrawUsage));
    this.side = side;
    const index = [];
    for (let i = 0; i < points - 1; i++) { const k = i * 2; index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    g.setIndex(index);
    const m = sealEffect(new THREE.MeshBasicNodeMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    if (additive) m.blending = THREE.AdditiveBlending;
    const across = uv().x.mul(2).sub(1), along = uv().y;
    const soft = float(1).sub(across.mul(across)).max(0).pow(1.4);
    const billow = mx_noise_float(vec3(along.mul(0.55), across.mul(1.3), float(0))).mul(0.5).add(0.5);
    m.opacityNode = attribute('ribbonAlpha', 'float').mul(soft).mul(mix(float(1), billow.mul(1.5), cloud));
    this.light = uniform(1);
    m.colorNode = vec3(...new THREE.Color(color).toArray()).mul(this.light);
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 985;
    this.mesh.name = 'FlightRibbon';
    scene.add(this.mesh);
    this.history = [];
    this.on = 0;
    this.clock = 0;
    this.length = 0;
  }

  reset() { this.history.length = 0; this.on = 0; this.mesh.visible = false; }

  // at: where it leaves the aircraft now (or null when it is off); strength 0..1; wind drifts what was already laid
  update(at, strength, dt, cam, wind, warm = false) {
    const h = this.history;
    this.on += ((at ? strength : 0) - this.on) * (1 - Math.exp(-dt * 6));
    this.clock += dt;
    if (at && dt > 0) {
      const head = h[0];
      if (!head || this.clock - head.t >= this.every) {
        if (head) this.length += Math.hypot(at.x - head.x, at.y - head.y, at.z - head.z);
        h.unshift({ x: at.x, y: at.y, z: at.z, t: this.clock, age: 0, s: this.on, u: this.length, dx: rand(-1, 1) * this.drift, dy: rand(-0.4, 1) * this.drift, dz: rand(-1, 1) * this.drift });
        if (h.length > this.n - 1) h.length = this.n - 1;
      }
    }
    for (const p of h) {
      p.age += dt;
      p.x += (p.dx + (wind?.x || 0)) * dt; p.y += p.dy * dt; p.z += (p.dz + (wind?.z || 0)) * dt;
    }
    while (h.length && h[h.length - 1].age > this.life) h.pop();
    this.mesh.visible = h.length + (at ? 1 : 0) > 1 || warm;
    if (!this.mesh.visible) return;
    if (!h.length) { this.a.fill(0); this.mesh.geometry.attributes.ribbonAlpha.needsUpdate = true; return; }
    const pos = this.pos, alpha = this.a, side = this.side;
    // the ribbon's nodes: the point where it leaves the aircraft now, then what was laid, newest first
    const live = at ? 1 : 0, count = Math.min(this.n, h.length + live);
    const node = (i) => (live && i === 0 ? at : h[Math.min(h.length - 1, i - live)]);
    for (let i = 0; i < this.n; i++) {
      const k = Math.min(i, count - 1);
      const p = node(k), before = node(Math.max(0, k - 1)), after = node(Math.min(count - 1, k + 1));
      _d.set(before.x - after.x, before.y - after.y, before.z - after.z);
      _c.set(cam.x - p.x, cam.y - p.y, cam.z - p.z);
      _s.crossVectors(_d, _c);
      if (_s.lengthSq() < 1e-8) _s.set(0, 1, 0);
      _s.normalize();
      const laid = live && k === 0 ? null : p;
      const age = laid ? laid.age : 0;
      const w = this.width + Math.min(this.most, age * this.grow);
      const o = i * 6;
      pos[o] = p.x + _s.x * w; pos[o + 1] = p.y + _s.y * w; pos[o + 2] = p.z + _s.z * w;
      pos[o + 3] = p.x - _s.x * w; pos[o + 4] = p.y - _s.y * w; pos[o + 5] = p.z - _s.z * w;
      // thin where it leaves the aircraft, gone right at the camera (a chase camera flies in the plume)
      const near = clamp((Math.hypot(cam.x - p.x, cam.y - p.y, cam.z - p.z) - 3) / 8, 0, 1);
      const strength = laid ? laid.s : this.on;
      const fade = i >= count ? 0 : Math.max(0, 1 - age / this.life) ** 1.3 * Math.min(1, (k + 0.4) / 2.5) * this.alpha * strength * near;
      alpha[i * 2] = alpha[i * 2 + 1] = fade;
      const u = laid ? laid.u : this.length;
      side[i * 4] = 0; side[i * 4 + 1] = u; side[i * 4 + 2] = 1; side[i * 4 + 3] = u;
    }
    const g = this.mesh.geometry.attributes;
    g.position.needsUpdate = g.ribbonAlpha.needsUpdate = g.uv.needsUpdate = true;
  }
}

// The reheat: two nested cones of flame behind the nozzle, bright where the shock diamonds stand
function createFlame() {
  const group = new THREE.Group();
  group.name = 'Afterburner';
  const power = uniform(0);
  const make = (radius, length, hot, cool, strength) => {
    const profile = [];
    for (let i = 0; i <= 14; i++) { const t = i / 14; profile.push(new THREE.Vector2(radius * (1 - t * 0.82) * (1 + 0.12 * Math.sin(t * 22)), -t * length)); }
    const g = new THREE.LatheGeometry(profile, 20).rotateX(Math.PI / 2); // along -Z, from the nozzle back
    const m = sealEffect(new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    const v = uv().y; // 0 at the nozzle, 1 at the tip
    // the diamonds stand still in the jet (they are shock waves, not something carried along) and shimmer a little
    const diamonds = pow(v.mul(5.4).add(mx_noise_float(vec3(time.mul(9), float(radius), float(0))).mul(0.05)).mul(6.2832).cos().mul(0.5).add(0.5), 2.6);
    const flicker = mx_noise_float(vec3(v.mul(7), time.mul(14), float(radius))).mul(0.22).add(0.86);
    // seen square-on the cone is thin, edge-on it is deep: that is what makes it read as a volume
    const depth = float(1).sub(normalView.dot(positionViewDirection).abs()).mul(0.75).add(0.35);
    const body = float(1).sub(v).pow(1.35);
    m.colorNode = mix(vec3(...hot), vec3(...cool), smoothstep(0.0, 0.8, v)).mul(strength).mul(diamonds.mul(1.25).add(0.3)).mul(flicker);
    m.opacityNode = body.mul(depth).mul(power).mul(flicker).mul(float(1).sub(smoothstep(0.0, 0.06, v).oneMinus().mul(0.5)));
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 986;
    return mesh;
  };
  group.add(make(0.47, 8.2, [1.0, 0.5, 0.16], [0.85, 0.2, 0.04], 0.85));
  group.add(make(0.3, 5.6, [0.5, 0.66, 1.0], [1.0, 0.55, 0.22], 1.5));
  group.visible = false;
  return { group, power };
}

// The ring the sound barrier leaves behind: a disc of condensation that opens and thins
function createShockRing() {
  const g = new THREE.RingGeometry(0.72, 1, 48, 1);
  const strength = uniform(0);
  const m = sealEffect(new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  const r = uv().sub(0.5).length().mul(2);
  m.opacityNode = smoothstep(0.72, 0.86, r).mul(smoothstep(1.0, 0.9, r)).mul(strength);
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 987;
  mesh.visible = false;
  mesh.name = 'ShockRing';
  return { mesh, strength, t: 9 };
}

class FlightFx {
  constructor(scene, fx, driveFx = null) {
    this.scene = scene;
    this.fx = fx; // the game's particle pools (fx.js)
    this.driveFx = driveFx;
    this.vortexL = new Ribbon(scene, { points: 46, life: 1.5, width: 0.035, grow: 0.16, most: 0.3, alpha: 0.5, every: 0.028, drift: 0.12, cloud: 0.25 });
    this.vortexR = new Ribbon(scene, { points: 46, life: 1.5, width: 0.035, grow: 0.16, most: 0.3, alpha: 0.5, every: 0.028, drift: 0.12, cloud: 0.25 });
    // the biplane's display smoke: laid for ten seconds, a hundred metres of it in every loop
    this.smoke = new Ribbon(scene, { points: 190, life: 11, width: 0.22, grow: 0.42, most: 3.4, alpha: 0.6, color: 0xf2f1ec, every: 0.055, drift: 0.55, cloud: 0.75 });
    // a jet's soot at dry power
    this.soot = new Ribbon(scene, { points: 70, life: 2.6, width: 0.3, grow: 0.9, most: 2.2, alpha: 0.16, color: 0x3a3c40, every: 0.035, drift: 0.4, cloud: 0.7 });
    this.flame = createFlame();
    scene.add(this.flame.group);
    this.ring = createShockRing();
    scene.add(this.ring.mesh);
    this.streaks = new AirFx(scene);
    this.craft = null;
    this.warm = 0;
    this.vel = new THREE.Vector3();
    this.puffT = 0;
  }

  // The named points of the aircraft's model, or what the physics knows when the model has not said
  point(a, name, out) {
    const m = a.model?.points?.[name], hull = a.flight.tune.hull;
    if (m) return aircraftPoint(a, m[0], m[1], m[2], out);
    const jet = a.flight.tune.engine === 'jet';
    const tip = (kind) => hull.find((p) => p.kind === kind);
    const f = name === 'tipL' ? tip('tipL') : name === 'tipR' ? tip('tipR') : name === 'nozzle' ? { x: 0, y: jet ? 0 : -0.2, z: -a.halfL + (jet ? 0.3 : 1) }
      : name === 'exhaust' ? { x: 0.5, y: -0.45, z: jet ? -a.halfL : 1.4 } : name === 'engine' ? { x: 0, y: 0, z: jet ? -a.halfL * 0.6 : a.halfL * 0.55 } : { x: 0, y: 0, z: 0 };
    return aircraftPoint(a, f.x, f.y, f.z, out);
  }

  // ---- Events ---------------------------------------------------------------------------------------------------------
  touchdown(a, e) {
    const b = a.flight, n = clamp(Math.round(3 + e.sink * 2 + e.speed * 0.06), 3, 16);
    for (let i = 0; i < n; i++) {
      this.fx.billow(this.fx.smokeParticle(e.x + rand(-0.3, 0.3), e.y + 0.1, e.z + rand(-0.3, 0.3), b.vx * 0.35 + rand(-1, 1), rand(0.4, 1.6), b.vz * 0.35 + rand(-1, 1),
        rand(0.35, 0.7), rand(0.7, 1.5), 0.62 * this.fx.level, 0.4, { grow: 1.6, drag: 1.6, gravity: -0.3 }));
    }
  }

  scrape(a, e) {
    const b = a.flight, n = e.first ? 14 : Math.random() < 0.6 ? 2 : 0;
    for (let i = 0; i < n; i++) {
      const p = this.fx.glowParticle(e.x + rand(-0.2, 0.2), e.y + 0.05, e.z + rand(-0.2, 0.2), b.vx * rand(0.3, 0.8) + rand(-2, 2), rand(1, 5), b.vz * rand(0.3, 0.8) + rand(-2, 2),
        rand(0.012, 0.03), rand(0.25, 0.7), 7, 3.6, 1.2, { gravity: 12, drag: 0.5, streak: 0.5 });
      p.floor = e.y + 0.02;
    }
    if (e.first || Math.random() < 0.3) this.fx.billow(this.fx.smokeParticle(e.x, e.y + 0.2, e.z, b.vx * 0.2, 1, b.vz * 0.2, 0.6, 1.4, 0.4 * this.fx.level, 0.35, { grow: 1.5 }));
  }

  strike(a, e) {
    this.fx.shards(e.x, e.y, e.z, e.nx, e.nz, 16);
    for (let i = 0; i < 22; i++) {
      this.fx.glowParticle(e.x, e.y, e.z, e.nx * rand(2, 9) + rand(-5, 5), rand(-2, 6), e.nz * rand(2, 9) + rand(-5, 5), rand(0.015, 0.04), rand(0.3, 0.9), 7, 3.6, 1.2, { gravity: 10, drag: 0.5, streak: 0.5 }).floor = -Infinity;
    }
    for (let i = 0; i < 8; i++) this.fx.billow(this.fx.smokeParticle(e.x, e.y, e.z, e.nx * rand(1, 4) + rand(-2, 2), rand(-1, 2), e.nz * rand(1, 4) + rand(-2, 2), rand(0.8, 1.6), rand(1.5, 3), 0.55 * this.fx.level, 0.5));
  }

  splash(a, e, size = 1) {
    this.driveFx?.splash(e.x, e.z, size);
    for (let i = 0; i < 40 * size; i++) {
      const ang = Math.random() * 6.28, v = rand(2, 9) * size;
      this.fx.smokeParticle(e.x + Math.cos(ang) * 2, (e.y ?? WATER) + 0.1, e.z + Math.sin(ang) * 2, Math.cos(ang) * v + a.flight.vx * 0.3, rand(4, 11) * size, Math.sin(ang) * v + a.flight.vz * 0.3,
        rand(0.3, 0.8), rand(0.8, 1.8), 0.9 * this.fx.level, 0.5, { tint: [0.93, 0.97, 1], gravity: 9, drag: 0.4, grow: 1.4 });
    }
  }

  wake(a, e) {
    if (e.speed < 2 || Math.random() > e.speed * 0.2) return;
    this.fx.smokeParticle(e.x + rand(-2, 2), (e.y ?? WATER) + 0.1, e.z + rand(-2, 2), rand(-1, 1), rand(1, 3), rand(-1, 1), rand(0.4, 0.9), rand(0.6, 1.2), 0.9 * this.fx.level, 0.4, { tint: [0.93, 0.97, 1], gravity: 6, grow: 1.2 });
  }

  boom(a) {
    const b = a.flight, r = this.ring;
    r.t = 0;
    r.mesh.position.copy(a.position);
    _d.set(b.vx, b.vy, b.vz).normalize();
    r.mesh.quaternion.setFromUnitVectors(_q.set(0, 0, 1), _d);
    r.mesh.visible = true;
    r.vx = b.vx * 0.15; r.vy = b.vy * 0.15; r.vz = b.vz * 0.15;
    // the cone bursts off the fuselage
    for (let i = 0; i < 36; i++) {
      const ang = Math.random() * 6.28, rad = rand(2, 6);
      aircraftPoint(a, Math.cos(ang) * rad, Math.sin(ang) * rad, rand(-3, 1), _p);
      this.fx.smokeParticle(_p.x, _p.y, _p.z, b.vx * 0.5, b.vy * 0.5, b.vz * 0.5, rand(1.5, 3), rand(0.35, 0.7), 1.0 * this.fx.level, 0.45, { grow: 6, drag: 2, gravity: 0 });
    }
  }

  // ---- Every frame ----------------------------------------------------------------------------------------------------
  update(dt, aviation, game) {
    const cam = game.camera.camera.position, fx = this.fx;
    const a = aviation.piloted;
    const warm = this.warm++ < 6; // drawn once behind the loading screen so the shaders compile
    const light = clamp(fx.level ?? 1, 0.12, 1);
    for (const r of [this.vortexL, this.vortexR, this.smoke, this.soot]) r.light.value = light;
    const wind = game.vertical?.wind?.at?.(cam.x, cam.y, cam.z, _wind) || null;
    if (wind) { wind.x *= 0.5; wind.z *= 0.5; }
    if (a !== this.craft) {
      this.craft = a;
      for (const r of [this.vortexL, this.vortexR, this.soot]) r.reset();
      if (!a) this.smoke.on = 0; // smoke already laid stays in the sky
    }
    // the shock ring opens whether or not anyone still flies
    const ring = this.ring;
    if (ring.t < 1.1) {
      ring.t += dt;
      const k = ring.t / 1.1, s = 6 + 150 * (1 - (1 - k) ** 2.2);
      ring.mesh.scale.setScalar(s);
      ring.mesh.position.x += ring.vx * dt; ring.mesh.position.y += ring.vy * dt; ring.mesh.position.z += ring.vz * dt;
      ring.strength.value = (1 - k) ** 1.6 * 0.5 * light;
      ring.mesh.updateMatrixWorld();
    } else if (!warm) ring.mesh.visible = false;
    if (warm) { ring.mesh.visible = true; ring.strength.value = 0.001; ring.mesh.position.copy(cam).y -= 300; ring.mesh.updateMatrixWorld(); }

    const flame = this.flame;
    if (!a) {
      for (const r of [this.vortexL, this.vortexR, this.soot, this.smoke]) r.update(null, 0, dt, cam, wind, warm);
      flame.group.visible = warm;
      if (warm) { flame.power.value = 0.001; flame.group.position.copy(cam).y -= 300; flame.group.updateMatrixWorld(true); }
      this.streaks.update(cam, this.vel.set(0, 0, 0), 0, null, dt);
      this.idle(dt, aviation, game);
      return;
    }
    const b = a.flight, t = b.tune, jet = t.engine === 'jet', V = b.airspeed;
    const airborne = !b.onGround;
    // wing-tip vortices: the wing working hard in air that can show it
    const pull = Math.max(smooth(2.6, 5, Math.abs(b.gSmooth)), smooth(t.stall * 0.72, t.stall * 0.95, Math.abs(b.alpha)) * 0.8) * smooth(t.vStall * 0.9, t.vStall * 1.6, V);
    const damp = game.atmosphere?.weather === 'rain' || game.atmosphere?.weather === 'storm' ? 1 : game.atmosphere?.weather === 'cloudy' ? 0.8 : 0.6;
    const vortex = airborne ? clamp(pull * (0.5 + damp), 0, 1) : 0;
    this.vortexL.update(vortex > 0.03 ? this.point(a, 'tipL', _p) : null, vortex, dt, cam, wind, warm);
    this.vortexR.update(vortex > 0.03 ? this.point(a, 'tipR', _q) : null, vortex, dt, cam, wind, warm);
    // display smoke (biplane) and soot (jet)
    const smoking = !jet && aviation.smoke && b.power > 0.12 && !a.crashed;
    this.smoke.update(smoking ? this.point(a, 'exhaust', _p) : null, 1, dt, cam, wind, warm);
    const sooty = jet && b.power > 0.55 && b.ab < 0.3 && b.damage.engine < 1;
    this.soot.update(sooty ? this.point(a, 'nozzle', _p) : null, smooth(0.55, 1, b.power), dt, cam, wind, warm);

    // reheat
    const burn = jet ? b.ab : 0;
    flame.group.visible = burn > 0.02 || warm;
    if (flame.group.visible) {
      this.point(a, 'nozzle', flame.group.position);
      flame.group.quaternion.set(b.q[0], b.q[1], b.q[2], b.q[3]);
      const radius = (a.model?.points?.nozzleRadius ?? 0.5) / 0.46;
      flame.group.scale.set(radius, radius, (0.55 + 0.45 * burn) * (1 + 0.25 * b.mach));
      flame.power.value = warm && burn < 0.02 ? 0.001 : burn * 0.9;
      flame.group.updateMatrixWorld(true);
    }

    // condensation: over the wings under g, round the fuselage near Mach 1
    this.puffT += dt;
    if (jet && airborne && this.puffT > 0.016) {
      this.puffT = 0;
      const cloud = smooth(4.2, 7.5, b.gSmooth) * smooth(90, 150, V) * (0.45 + damp * 0.6);
      for (let n = cloud * 3 + Math.random(); n >= 1; n--) {
        const side = Math.random() < 0.5 ? 1 : -1, span = rand(0.9, a.halfW * 0.8);
        aircraftPoint(a, side * span, rand(0.25, 0.7), rand(-2.4, 0.2), _p);
        fx.smokeParticle(_p.x, _p.y, _p.z, b.vx * 0.93, b.vy * 0.93, b.vz * 0.93, rand(0.6, 1.3), rand(0.14, 0.3), 1.0 * light, 0.3 * cloud, { grow: 5, drag: 0.6, gravity: 0 });
      }
      const cone = Math.exp(-(((b.mach - 0.985) / 0.035) ** 2));
      for (let n = cone * 5 + Math.random() * cone; n >= 1; n--) {
        const ang = Math.random() * 6.28, rad = rand(1.6, 3.4);
        aircraftPoint(a, Math.cos(ang) * rad, Math.sin(ang) * rad, rand(-3.5, -1), _p);
        fx.smokeParticle(_p.x, _p.y, _p.z, b.vx * 0.985, b.vy * 0.985, b.vz * 0.985, rand(1.2, 2.2), rand(0.08, 0.16), 1.0 * light, 0.42 * cone, { grow: 9, drag: 0.2, gravity: 0 });
      }
    }

    // low over the river: the wash tears spray off the water
    const wet = aviation.env.water(a.position.x, a.position.z);
    const overWater = wet !== false, level = overWater ? wet : WATER;
    const height = a.position.y - level;
    if (overWater && airborne && height < 22 && V > 25) {
      const k = (1 - height / 22) * clamp(V / 80, 0.3, 1.6) * (jet ? 1.4 : 0.8);
      for (let n = k * 70 * dt + Math.random(); n >= 1; n--) {
        const side = rand(-1, 1) * (a.halfW * 0.9 + height * 0.5);
        aircraftPoint(a, side, 0, rand(-a.halfL * 1.6, -a.halfL * 0.2), _p);
        fx.smokeParticle(_p.x, level + 0.15, _p.z, b.vx * rand(0.1, 0.35) + rand(-2, 2), rand(1.5, 5) * (0.5 + k * 0.5), b.vz * rand(0.1, 0.35) + rand(-2, 2),
          rand(0.5, 1.2), rand(0.7, 1.6), 0.92 * light, 0.34, { tint: [0.93, 0.97, 1], gravity: 5, drag: 0.8, grow: 1.6 });
      }
    }
    // rolling: dust and rubber off the wheels on the take-off run
    if (b.onGround && V > 12 && Math.random() < dt * V * 0.25) {
      const w = b.wheels[Math.random() < 0.5 ? 0 : 1];
      aircraftPoint(a, w.x, w.y, w.z, _p);
      fx.smokeParticle(_p.x, _p.y + 0.1, _p.z, b.vx * 0.2, 0.6, b.vz * 0.2, rand(0.3, 0.6), rand(0.6, 1.2), 0.6 * light, 0.14, { grow: 1.8 });
    }
    // speed lines, where there is something close to fly past
    this.vel.set(b.vx, b.vy, b.vz);
    const close = clamp(1 - (b.agl - 30) / 220, 0, 1);
    this.streaks.update(cam, this.vel, airborne ? smooth(jet ? 110 : 45, jet ? 300 : 70, V) * (0.12 + 0.5 * close) : 0, null, dt);
    this.idle(dt, aviation, game);
  }

  // What a hurt aircraft trails, flown or not
  idle(dt, aviation, game) {
    const fx = this.fx;
    for (const a of Object.values(aviation.craft)) {
      if (!a.mesh.visible || a.destroyed || a.hp === undefined || !(dt > 0)) continue;
      const b = a.flight;
      if (a.hp < 50 || b.damage.engine > 0.4) {
        this.point(a, 'engine', _p);
        const bad = clamp(1 - a.hp / 50, 0.25, 1);
        let n = bad * 26 * dt + Math.random() * 0.5;
        for (; n >= 1; n--) {
          fx.billow(fx.smokeParticle(_p.x + rand(-0.3, 0.3), _p.y + rand(-0.2, 0.3), _p.z + rand(-0.3, 0.3), b.vx * 0.25, b.vy * 0.25 + 0.6, b.vz * 0.25,
            rand(0.5, 1) + bad * 0.6, rand(1.6, 3.2), (a.hp < 25 ? 0.12 : 0.34) * fx.level, 0.5 + bad * 0.3, { grow: 2.4, drag: 0.9 }));
        }
        if (a.hp <= 0) fx.fire(_p.x, _p.y, _p.z, dt, 0.8);
      }
      // a torn wing tip streams fuel vapour
      for (const [side, name] of [['wingL', 'tipL'], ['wingR', 'tipR']]) {
        if (!b.damage[side] || b.airspeed < 15 || Math.random() > dt * 40) continue;
        this.point(a, name, _p);
        fx.smokeParticle(_p.x, _p.y, _p.z, b.vx * 0.3, b.vy * 0.3, b.vz * 0.3, rand(0.3, 0.6), rand(0.8, 1.6), 0.95 * fx.level, 0.3, { grow: 2.2, gravity: 0.2 });
      }
    }
  }
}

export { FlightFx, Ribbon };
