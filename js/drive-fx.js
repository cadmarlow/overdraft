import * as THREE from 'three/webgpu';
import { attribute, float, positionWorld, sin, smoothstep, uniform, varying } from 'three/tsl';
import { DENTS } from './car-assets.js';
import { WATER } from './boat.js';

// What driving leaves in the world: rubber on the road, tyre smoke, sparks, flames from the exhaust, bodywork that stays
// bent. Reads each car's physics state (car-physics.js) once a frame.

const SKID_QUADS = 2400;
const SKID_STEP = 0.4; // metres of road per segment
const SKID_WIDTH = 0.12; // half
const SKID_HEIGHT = 0.03;
const FOAM_LIFE = 9; // seconds a boat's track stays white

class SkidMarks {
  constructor(scene, { quads = SKID_QUADS, step = SKID_STEP, width = SKID_WIDTH, colour = 0x08080a, opacity = 0.72, fades = false } = {}) {
    Object.assign(this, { quads, step, width, fades });
    this.positions = new Float32Array(quads * 4 * 3);
    this.alpha = new Float32Array(quads * 4);
    const index = new Uint32Array(quads * 6);
    for (let i = 0; i < quads; i++) {
      const v = i * 4, o = i * 6;
      index[o] = v; index[o + 1] = v + 2; index[o + 2] = v + 1;
      index[o + 3] = v + 1; index[o + 4] = v + 2; index[o + 5] = v + 3;
    }
    const geometry = new THREE.BufferGeometry();
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttribute = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute('skid', this.alphaAttribute);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    const material = new THREE.MeshBasicNodeMaterial({ color: colour, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide });
    if (fades) {
      // White in the middle of the track, gone at its edges, broken up along it
      const edge = new Float32Array(quads * 4);
      for (let i = 0; i < edge.length; i += 2) { edge[i] = 1; edge[i + 1] = -1; }
      geometry.setAttribute('edge', new THREE.BufferAttribute(edge, 1));
      this.born = new Float32Array(quads * 4);
      this.bornAttribute = new THREE.BufferAttribute(this.born, 1).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('born', this.bornAttribute);
      this.clock = uniform(0);
      const age = this.clock.sub(varying(attribute('born', 'float')));
      const across = varying(attribute('edge', 'float')).abs();
      const breakup = sin(positionWorld.x.mul(1.7).add(positionWorld.z.mul(2.3))).mul(sin(positionWorld.z.mul(5.1).sub(positionWorld.x.mul(3.7)))).mul(0.5).add(0.5);
      material.opacityNode = varying(attribute('skid', 'float')).mul(float(opacity)).mul(smoothstep(FOAM_LIFE, 1, age)).mul(smoothstep(1, 0.15, across)).mul(breakup.mul(0.7).add(0.3));
    } else material.opacityNode = varying(attribute('skid', 'float')).mul(float(opacity));
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'SkidMarks';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 990;
    scene.add(this.mesh);
    this.cursor = 0;
    this.dirty = false;
  }

  // A trail is one wheel's strip; it stays joined from one segment to the next while the wheel keeps sliding
  extend(trail, x, y, z, strength) {
    if (trail.x === undefined || Math.hypot(x - trail.x, z - trail.z) > 3) {
      Object.assign(trail, { x, y, z, a: strength, lx: x, ly: y, lz: z, rx: x, ry: y, rz: z });
      return;
    }
    const dx = x - trail.x, dz = z - trail.z, length = Math.hypot(dx, dz);
    if (length < this.step) return;
    const px = -dz / length * this.width, pz = dx / length * this.width;
    const i = this.cursor;
    this.cursor = (i + 1) % this.quads;
    const v = i * 4 * 3, p = this.positions, h = y + SKID_HEIGHT;
    p[v] = trail.lx; p[v + 1] = trail.ly; p[v + 2] = trail.lz;
    p[v + 3] = trail.rx; p[v + 4] = trail.ry; p[v + 5] = trail.rz;
    p[v + 6] = x + px; p[v + 7] = h; p[v + 8] = z + pz;
    p[v + 9] = x - px; p[v + 10] = h; p[v + 11] = z - pz;
    const a = this.alpha;
    a[i * 4] = a[i * 4 + 1] = trail.a;
    a[i * 4 + 2] = a[i * 4 + 3] = strength;
    if (this.born) this.born.fill(this.clock.value, i * 4, i * 4 + 4);
    trail.x = x; trail.y = y; trail.z = z; trail.a = strength;
    trail.lx = x + px; trail.ly = h; trail.lz = z + pz;
    trail.rx = x - px; trail.ry = h; trail.rz = z - pz;
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.positionAttribute.needsUpdate = true;
    this.alphaAttribute.needsUpdate = true;
    if (this.bornAttribute) this.bornAttribute.needsUpdate = true;
  }
}

const hitLocal = { x: 0, y: 0, z: 0 };
function toLocal(car, wx, wy, wz, out = hitLocal) {
  const r = car.body.r, dx = wx - car.position.x, dy = wy - car.position.y, dz = wz - car.position.z;
  out.x = r[0] * dx + r[1] * dy + r[2] * dz;
  out.y = r[3] * dx + r[4] * dy + r[5] * dz;
  out.z = r[6] * dx + r[7] * dy + r[8] * dz;
  return out;
}

// A blow bends the panels around it for good: it joins the dent nearby, or takes the place of the weakest
function addDent(car, wx, wy, wz, nx, nz, speed) {
  const data = car.paintMaterial?.userData;
  if (!data?.dents) return;
  const local = toLocal(car, wx, wy, wz);
  const dents = data.dents.array, dirs = data.dentDirs.array;
  const depth = Math.min(0.34, Math.max(0.02, (speed - 4) * 0.013));
  const radius = Math.min(1.15, 0.5 + speed * 0.022);
  let slot = 0, best = Infinity;
  for (let i = 0; i < DENTS; i++) {
    const d = dents[i], near = Math.hypot(d.x - local.x, d.y - local.y, d.z - local.z);
    if (d.w > 0 && near < 0.55) { slot = i; best = -1; break; }
    if (d.w < best) { best = d.w; slot = i; }
  }
  const dent = dents[slot], dir = dirs[slot];
  const had = best === -1 ? dent.w : 0;
  const r = car.body.r;
  dent.set(local.x, Math.max(0.3, local.y), local.z, Math.min(0.42, had + depth));
  // The world normal pushes away from what was hit: that is the way the metal goes
  dir.set((r[0] * nx + r[2] * nz), 0, (r[6] * nx + r[8] * nz), Math.max(dir.w, radius));
}

// New tyres, straight panels
function repairBody(car) {
  clearDents(car);
  if (car.body) for (const w of car.body.wheels) w.burst = false;
}

function clearDents(car) {
  const data = car.paintMaterial?.userData;
  if (!data?.dents) return;
  for (const d of data.dents.array) d.set(0, 0, 0, 0);
  for (const d of data.dentDirs.array) d.set(0, 0, 0, 0);
}

// A lamp post knocked off its base: it spins away along the road, rings on the ground and stays there a while
const LAMP_POOL = 6;
class FallingLamps {
  constructor(scene, parts) {
    this.items = Array.from({ length: LAMP_POOL }, () => {
      const mesh = new THREE.Mesh(parts.post, parts.metal);
      mesh.add(new THREE.Mesh(parts.globe, parts.glow));
      mesh.castShadow = true;
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, tilt: 0, spin: 0, yaw: 0 };
    });
    this.next = 0;
  }

  knock(x, z, vx, vz) {
    const it = this.items[this.next++ % LAMP_POOL];
    Object.assign(it, { life: 18, x, y: 0.2, z, vx: vx * 0.55, vy: 1.8 + Math.hypot(vx, vz) * 0.05, vz: vz * 0.55, tilt: 0, spin: 1.2 + Math.hypot(vx, vz) * 0.1, yaw: Math.atan2(vx, vz) });
    it.mesh.visible = true;
  }

  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { it.mesh.visible = false; continue; }
      it.vy -= 9.81 * dt;
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      it.tilt += it.spin * dt;
      if (it.y < 0.1) {
        it.y = 0.1; it.vy = Math.abs(it.vy) * 0.25;
        const drag = Math.exp(-dt * 3.2);
        it.vx *= drag; it.vz *= drag;
      }
      if (it.tilt > 1.52) { it.tilt = 1.52; it.spin *= -0.15; }
      it.mesh.position.set(it.x, it.y, it.z);
      it.mesh.rotation.set(it.tilt, it.yaw, 0, 'YXZ');
      it.mesh.updateMatrixWorld(true);
    }
  }
}

class DriveEffects {
  constructor(scene, fx) {
    this.fx = fx;
    this.skids = new SkidMarks(scene);
    this.foam = new SkidMarks(scene, { quads: 900, step: 1.6, width: 1.5, colour: 0xe8f0f2, opacity: 0.55, fades: true });
    this.foam.mesh.renderOrder = 2;
    this.light = 1;
    this.wet = 0;
  }

  // Everything a car leaves this frame. `near`: within sight of the camera, worth the particles.
  car(car, dt, near = true) {
    const b = car.body, fx = this.fx;
    if (!b) return;
    b.trails ??= [{}, {}, {}, {}];
    const dx = Math.hypot(b.vx, b.vz);
    const shade = this.light;
    for (let i = 0; i < 4; i++) {
      const w = b.wheels[i], trail = b.trails[i];
      if (!w.hasGround) { trail.x = undefined; continue; }
      // On the rim: the road throws sparks off it
      if (w.burst && dx > 6 && near && Math.random() < dt * 30) this.sparks(w.px, w.py + 0.05, w.pz, b.vx, b.vz, 0.4, 0.03);
      const slip = w.slip;
      if (slip > 2.4 && w.grip > 0.7) this.skids.extend(trail, w.px, w.gy, w.pz, Math.min(1, 0.3 + slip * 0.06));
      else if (slip < 1.2) trail.x = undefined;
      if (!near || slip < 3) continue;
      const rate = Math.min(90, 14 + slip * 4.6) * dt;
      const grass = w.grip < 0.7;
      for (let n = rate + Math.random(); n >= 1; n--) {
        const up = 0.5 + Math.random() * 0.9;
        fx.smokeParticle(w.px + (Math.random() - 0.5) * 0.3, w.py + 0.12, w.pz + (Math.random() - 0.5) * 0.3,
          b.vx * 0.22 + (Math.random() - 0.5) * 1.1, up, b.vz * 0.22 + (Math.random() - 0.5) * 1.1,
          0.5 + Math.random() * 0.34, 1.1 + Math.random() * 1.1, (grass ? 0.42 : 0.84) * shade, Math.min(0.3, 0.1 + slip * 0.012),
          { grow: 2.2 + Math.random() * 1.1, drag: 2.2, gravity: -0.34, tint: grass ? [1, 0.84, 0.6] : [1, 1, 1.02] });
      }
    }
    // Wet road: tyres throw a fine mist behind them
    if (near && this.wet > 0.3 && dx > 12 && Math.random() < dt * 40) {
      const w = b.wheels[2 + (Math.random() < 0.5 ? 1 : 0)];
      fx.smokeParticle(w.px, w.py + 0.2, w.pz, b.vx * 0.5, 0.6, b.vz * 0.5, 0.5, 0.7, 0.8 * shade, 0.1, { grow: 3, drag: 2.4, gravity: 0 });
    }
    if (b.scrape > 0) this.sparks(b.scrapeX, b.scrapeY, b.scrapeZ, b.vx, b.vz, Math.min(1, b.scrape / 18), dt);
    if (b.wall > 0) {
      b.wall -= dt;
      this.sparks(b.wallX, b.wallY, b.wallZ, b.vx, b.vz, Math.min(1, b.wallSpeed / 26), dt);
    }
    if (near && (b.backfire > 0 || b.nitro > 0)) this.exhaust(car, dt);
    b.backfire = Math.max(0, b.backfire - dt * 7);
  }

  sparks(x, y, z, vx, vz, strength, dt) {
    const fx = this.fx;
    for (let n = strength * 200 * dt + Math.random(); n >= 1; n--) {
      const k = 0.3 + Math.random() * 0.7;
      fx.glowParticle(x + (Math.random() - 0.5) * 0.4, y + 0.05, z + (Math.random() - 0.5) * 0.4,
        vx * k * 0.72 + (Math.random() - 0.5) * 4, Math.random() * 3.4, vz * k * 0.72 + (Math.random() - 0.5) * 4,
        0.016 + Math.random() * 0.02, 0.28 + Math.random() * 0.42, 1, 0.66, 0.28, { gravity: 13, streak: 0.9, drag: 0.7 });
    }
  }

  exhaust(car, dt) {
    const b = car.body, r = b.r, fx = this.fx, s = car.spec;
    const nitro = b.nitro > 0;
    for (const side of [-0.42, 0.42]) {
      const lx = side, ly = s.sill + 0.08, lz = s.zRear;
      const x = car.position.x + r[0] * lx + r[3] * ly + r[6] * lz;
      const y = car.position.y + r[1] * lx + r[4] * ly + r[7] * lz;
      const z = car.position.z + r[2] * lx + r[5] * ly + r[8] * lz;
      const back = nitro ? 14 : 5;
      for (let n = (nitro ? 150 : 90) * dt + Math.random(); n >= 1; n--) {
        fx.glowParticle(x, y, z, b.vx - r[6] * back + (Math.random() - 0.5), b.vy - r[7] * back + Math.random() * 0.4, b.vz - r[8] * back + (Math.random() - 0.5),
          (nitro ? 0.17 : 0.13) + Math.random() * 0.1, 0.08 + Math.random() * 0.1, nitro ? 0.35 : 1, nitro ? 0.58 : 0.48, nitro ? 1 : 0.14, { drag: 3, grow: -0.6 });
      }
      if (!nitro && Math.random() < dt * 30) fx.flash(x, y, z, 0xff8a30, 26, 0.06, 7);
    }
    if (nitro && Math.random() < dt * 22) fx.flash(car.position.x - r[6] * 2.6, car.position.y + 0.5, car.position.z - r[8] * 2.6, 0x5a90ff, 44, 0.07, 12);
  }

  // A big blow: bent metal, shards of glass and plastic in the car's paint thrown off the point of impact
  crash(car, x, y, z, nx, nz, speed) {
    addDent(car, x, y, z, nx, nz, speed);
    const fx = this.fx, b = car.body;
    if (speed < 7) return;
    const count = Math.min(90, speed * 3.4);
    for (let i = 0; i < count; i++) {
      const up = 1 + Math.random() * (2 + speed * 0.3);
      const kick = (0.3 + Math.random()) * speed * 0.3;
      fx.glowParticle(x, y, z, b.vx * 0.5 + nx * kick + (Math.random() - 0.5) * 6, up, b.vz * 0.5 + nz * kick + (Math.random() - 0.5) * 6,
        0.014 + Math.random() * 0.024, 0.3 + Math.random() * 0.5, 1, 0.7, 0.3, { gravity: 12, streak: 0.9, drag: 0.8 });
    }
    fx.shards(x, y, z, nx, nz, Math.min(12, Math.floor(speed * 0.45)));
    fx.smokeParticle(x, y, z, b.vx * 0.3, 0.8, b.vz * 0.3, 0.8, 0.9, 0.5 * this.light, 0.3, { grow: 3.4, drag: 2 });
  }

  // A boat's track: white water behind it, spray off the shoulders of the bow, a sheet thrown up when it slams
  boat(boat, dt, near, clock) {
    const fx = this.fx, speed = Math.abs(boat.speed);
    const sin = Math.sin(boat.heading), cos = Math.cos(boat.heading), x = boat.position.x, z = boat.position.z;
    this.foam.clock.value = clock;
    boat.trail ??= {};
    if (speed > 2) this.foam.extend(boat.trail, x - sin * boat.halfL, WATER + 0.04, z - cos * boat.halfL, Math.min(1, speed / 14));
    else boat.trail.x = undefined;
    if (!near) return;
    const white = this.light;
    if (speed > 4) {
      for (let n = Math.min(70, speed * 3.2) * dt + Math.random(); n >= 1; n--) {
        const side = Math.random() < 0.5 ? -1 : 1, spread = 2 + speed * 0.16;
        fx.smokeParticle(x - sin * boat.halfL * 0.9 + cos * side * 0.8, WATER + 0.25, z - cos * boat.halfL * 0.9 - sin * side * 0.8,
          cos * side * spread + boat.vx * 0.3, 0.7 + Math.random(), -sin * side * spread + boat.vz * 0.3,
          0.5 + Math.random() * 0.4, 1 + Math.random() * 0.8, 0.92 * white, 0.26, { grow: 1.8, drag: 1.6, gravity: 1.2 });
      }
    }
    if (boat.plane > 0.3) {
      for (let n = boat.plane * 60 * dt + Math.random(); n >= 1; n--) {
        const side = Math.random() < 0.5 ? -1 : 1;
        fx.smokeParticle(x + sin * boat.halfL * 0.45 + cos * side * 1.2, WATER + 0.3, z + cos * boat.halfL * 0.45 - sin * side * 1.2,
          sin * speed * 0.6 + cos * side * 5, 2 + Math.random() * 2.5, cos * speed * 0.6 - sin * side * 5,
          0.32, 0.7, 0.96 * white, 0.34, { grow: 1.2, drag: 0.8, gravity: 7 });
      }
    }
    if (boat.slam > 0) { this.splash(x + sin * 2, z + cos * 2, boat.slam * 0.7); boat.slam = 0; }
  }

  // Something big hits the water
  splash(x, z, size = 1) {
    const fx = this.fx, white = this.light;
    for (let i = 0; i < 46 * size; i++) {
      const a = Math.random() * 6.28, v = (1.5 + Math.random() * 5) * size;
      fx.smokeParticle(x + Math.cos(a), WATER + 0.3, z + Math.sin(a), Math.cos(a) * v, (3 + Math.random() * 6) * size, Math.sin(a) * v, 0.5 + Math.random() * 0.5, 0.9 + Math.random() * 0.7, 0.95 * white, 0.34, { grow: 1.6, drag: 0.7, gravity: 9 });
    }
  }

  flush() { this.skids.flush(); this.foam.flush(); }
}

export { DriveEffects, FallingLamps, SkidMarks, addDent, clearDents, repairBody };
