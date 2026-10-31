import * as THREE from 'three/webgpu';
import { BONE, LIMB, SIDES, ARM_BIND_ABDUCTION } from './human-skeleton.js';

// Bodies that fall for real: when someone is shot, run over or blown away, their skeleton turns into a chain of weights
// joined by stiff links (Verlet integration, relaxed constraints). It keeps the momentum of the walk it interrupts, takes
// the impulse of what hit it, folds at the joints and settles on the ground, then stops costing anything.

// Particles
const P = { PELVIS: 0, CHEST: 1, NECK: 2, HEAD: 3, SHOULDER: 4, ELBOW: 6, WRIST: 8, HIP: 10, KNEE: 12, ANKLE: 14, TOE: 16 };
const COUNT = 18;
const GRAVITY = 12; // slightly heavy: limp bodies look floaty at the true value
const DAMPING = 0.985;
const ITERATIONS = 7;
const FRICTION = 0.16; // per relaxation pass
const RADIUS = [0.1, 0.11, 0.05, 0.1, 0.06, 0.06, 0.05, 0.05, 0.04, 0.04, 0.08, 0.08, 0.06, 0.06, 0.05, 0.05, 0.03, 0.03];
const SETTLE_SPEED = 0.25; // m/s: below this for SETTLE_TIME the body rests
const SETTLE_TIME = 0.7;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _front = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _bone = new THREE.Quaternion();

class Ragdoll {
  /**
   * @param {PersonRig} rig - its current pose is the starting point
   * @param {function} ground - (x, z) => height of the ground
   * @param {function} [push] - (x, y, z) => { x, z } moved out of walls, or null
   */
  constructor(rig, ground, push = null) {
    this.rig = rig;
    this.ground = ground;
    this.push = push;
    this.p = new Float32Array(COUNT * 3); // positions
    this.o = new Float32Array(COUNT * 3); // previous positions: velocity is their difference
    this.links = [];
    this.calm = 0;
    this.asleep = false;
    this.capture();
    this.buildLinks();
  }

  // Joint positions from the skeleton as it stands now
  capture() {
    const r = this.rig, j = r.bind;
    const at = (bone, joint, i) => {
      r.carried(bone, joint, r.readBone(bone, _q), _a);
      this.set(i, _a.x, _a.y, _a.z);
    };
    at(BONE.PELVIS, j[BONE.PELVIS], P.PELVIS);
    at(BONE.CHEST, j[BONE.CHEST], P.CHEST);
    at(BONE.NECK, j[BONE.NECK], P.NECK);
    r.carried(BONE.HEAD, _b.set(0, 1.72, 0.02), r.readBone(BONE.HEAD, _q), _a);
    this.set(P.HEAD, _a.x, _a.y, _a.z);
    for (let i = 0; i < 2; i++) {
      at(LIMB.upperArm[i], j[LIMB.upperArm[i]], P.SHOULDER + i);
      at(LIMB.forearm[i], j[LIMB.forearm[i]], P.ELBOW + i);
      at(LIMB.hand[i], j[LIMB.hand[i]], P.WRIST + i);
      at(LIMB.thigh[i], j[LIMB.thigh[i]], P.HIP + i);
      at(LIMB.shin[i], j[LIMB.shin[i]], P.KNEE + i);
      at(LIMB.foot[i], j[LIMB.foot[i]], P.ANKLE + i);
      at(LIMB.toe[i], j[LIMB.toe[i]], P.TOE + i);
    }
    this.o.set(this.p);
  }

  set(i, x, y, z) {
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
  }

  dist(a, b) {
    const p = this.p;
    return Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
  }

  // Bones keep their length; the trunk is braced so it stays a trunk; other pairs only keep a minimum distance, which is
  // what stops knees and elbows folding the wrong way round or through the body
  buildLinks() {
    const rod = (a, b, stiff = 1) => this.links.push({ a, b, len: this.dist(a, b), min: 0, stiff });
    const keep = (a, b, share) => this.links.push({ a, b, len: 0, min: this.dist(a, b) * share, stiff: 0.6 });
    rod(P.PELVIS, P.CHEST); rod(P.CHEST, P.NECK); rod(P.NECK, P.HEAD);
    for (let i = 0; i < 2; i++) {
      const S = P.SHOULDER + i, E = P.ELBOW + i, W = P.WRIST + i, H = P.HIP + i, K = P.KNEE + i, A = P.ANKLE + i, T = P.TOE + i;
      rod(S, P.NECK); rod(S, P.CHEST); rod(S, E); rod(E, W);
      rod(H, P.PELVIS); rod(H, P.CHEST, 0.5); rod(H, K); rod(K, A); rod(A, T);
      rod(T, K, 0.25); // ankles don't flop
      keep(S, W, 0.5); keep(H, A, 0.76); keep(W, P.CHEST, 0.42);
      keep(K, P.CHEST, 0.74); // knees don't reach far up the chest
    }
    rod(P.SHOULDER, P.SHOULDER + 1); rod(P.HIP, P.HIP + 1);
    rod(P.SHOULDER, P.HIP + 1, 0.8); rod(P.SHOULDER + 1, P.HIP, 0.8); // twist, not collapse
    rod(P.HEAD, P.CHEST, 0.5);
    keep(P.HEAD, P.PELVIS, 0.9);
    keep(P.CHEST, P.KNEE, 0.8); keep(P.CHEST, P.KNEE + 1, 0.8);
  }

  // Everyone moves at velocity (vx, vy, vz) to begin with (dt: the frame the Verlet step will use)
  drift(vx, vy, vz, dt) {
    for (let i = 0; i < COUNT; i++) {
      this.o[i * 3] = this.p[i * 3] - vx * dt;
      this.o[i * 3 + 1] = this.p[i * 3 + 1] - vy * dt;
      this.o[i * 3 + 2] = this.p[i * 3 + 2] - vz * dt;
    }
  }

  // A blow at height `y` above the ground: joints near it take most of it (a head shot snaps the head back; a car's
  // bumper takes the legs from under the body)
  hit(x, y, z, ix, iy, iz, dt, spread = 0.6) {
    this.asleep = false;
    this.calm = 0;
    const p = this.p;
    for (let i = 0; i < COUNT; i++) {
      const d = Math.hypot(p[i * 3] - x, p[i * 3 + 1] - y, p[i * 3 + 2] - z);
      const k = Math.max(0.12, 1 - d / spread);
      this.o[i * 3] -= ix * k * dt;
      this.o[i * 3 + 1] -= iy * k * dt;
      this.o[i * 3 + 2] -= iz * k * dt;
    }
  }

  step(dt) {
    if (this.asleep) return;
    dt = Math.min(dt, 1 / 30);
    const p = this.p, o = this.o;
    let fastest = 0;
    for (let i = 0; i < COUNT * 3; i += 3) {
      const vx = (p[i] - o[i]) * DAMPING, vy = (p[i + 1] - o[i + 1]) * DAMPING, vz = (p[i + 2] - o[i + 2]) * DAMPING;
      o[i] = p[i]; o[i + 1] = p[i + 1]; o[i + 2] = p[i + 2];
      p[i] += vx; p[i + 1] += vy - GRAVITY * dt * dt; p[i + 2] += vz;
      fastest = Math.max(fastest, Math.abs(vx), Math.abs(vy), Math.abs(vz));
    }
    const links = this.links;
    for (let n = 0; n < ITERATIONS; n++) {
      for (let k = 0; k < links.length; k++) {
        const l = links[k];
        const a = l.a * 3, b = l.b * 3;
        const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-5;
        if (l.min && d >= l.min) continue;
        const f = (((l.min || l.len) - d) / d) * 0.5 * l.stiff;
        p[a] -= dx * f; p[a + 1] -= dy * f; p[a + 2] -= dz * f;
        p[b] += dx * f; p[b + 1] += dy * f; p[b + 2] += dz * f;
      }
      this.collide();
    }
    this.calm = fastest / dt < SETTLE_SPEED ? this.calm + dt : 0;
    if (this.calm > SETTLE_TIME) this.asleep = true;
  }

  collide() {
    const p = this.p, o = this.o;
    const floor = this.ground(p[0], p[2]);
    for (let i = 0; i < COUNT; i++) {
      const y = floor + RADIUS[i];
      if (p[i * 3 + 1] < y) {
        p[i * 3 + 1] = y;
        // friction along the ground
        p[i * 3] -= (p[i * 3] - o[i * 3]) * FRICTION;
        p[i * 3 + 2] -= (p[i * 3 + 2] - o[i * 3 + 2]) * FRICTION;
      }
    }
    if (this.push) {
      const moved = this.push(p[3], p[4], p[5]); // the chest against walls; the rest of the body follows
      if (moved) { const dx = moved.x - p[3], dz = moved.z - p[5]; for (let i = 0; i < COUNT; i++) { p[i * 3] += dx * 0.6; p[i * 3 + 2] += dz * 0.6; } }
    }
  }

  // Writes the skeleton from where the weights are
  pose() {
    const r = this.rig, p = this.p, j = r.bind;
    const V = (out, i) => out.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    const left = (a, b) => _right.set(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
    // trunk: up along the spine, the hips and shoulders giving the side
    V(_a, P.PELVIS);
    _up.set(p[P.CHEST * 3] - _a.x, p[P.CHEST * 3 + 1] - _a.y, p[P.CHEST * 3 + 2] - _a.z);
    _front.crossVectors(_up, left(P.HIP, P.HIP + 1)).negate();
    r.basis(_up, _front, _bone);
    r.writeBone(BONE.PELVIS, _bone, _a);
    const frontP = _c.copy(_front);
    V(_a, P.CHEST);
    _up.set(p[P.NECK * 3] - _a.x, p[P.NECK * 3 + 1] - _a.y, p[P.NECK * 3 + 2] - _a.z);
    _front.crossVectors(_up, left(P.SHOULDER, P.SHOULDER + 1)).negate();
    r.basis(_up, _front, _bone);
    r.writeBone(BONE.CHEST, _bone, _a);
    const qChest = _q2.copy(_bone);
    V(_a, P.NECK);
    _b.set(p[P.HEAD * 3] - _a.x, p[P.HEAD * 3 + 1] - _a.y, p[P.HEAD * 3 + 2] - _a.z);
    r.basis(_b, _front, _bone);
    r.carried(BONE.CHEST, j[BONE.HEAD], qChest, _a);
    r.writeBone(BONE.HEAD, _bone, _a);
    // limbs: each bone from one joint to the next, the knee or elbow side as its front
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i];
      this.bone(LIMB.upperArm[i], P.SHOULDER + i, P.ELBOW + i, _front, side * ARM_BIND_ABDUCTION);
      this.bone(LIMB.forearm[i], P.ELBOW + i, P.WRIST + i, _front, side * ARM_BIND_ABDUCTION);
      this.bone(LIMB.thigh[i], P.HIP + i, P.KNEE + i, frontP, 0);
      this.bone(LIMB.shin[i], P.KNEE + i, P.ANKLE + i, frontP, 0);
      V(_a, P.ANKLE + i);
      _b.set(p[(P.TOE + i) * 3] - _a.x, p[(P.TOE + i) * 3 + 1] - _a.y, p[(P.TOE + i) * 3 + 2] - _a.z);
      _c.set(p[(P.KNEE + i) * 3] - _a.x, p[(P.KNEE + i) * 3 + 1] - _a.y, p[(P.KNEE + i) * 3 + 2] - _a.z);
      r.basis(_c, _b, _bone);
      r.writeFoot(i, _a, _bone, 0);
    }
    r.finishBones();
  }

  bone(index, from, to, front, tilt) {
    const p = this.p, r = this.rig;
    _a.set(p[from * 3], p[from * 3 + 1], p[from * 3 + 2]);
    _b.set(_a.x - p[to * 3], _a.y - p[to * 3 + 1], _a.z - p[to * 3 + 2]);
    r.basis(_b, front, _bone);
    if (tilt) _bone.multiply(_q.setFromAxisAngle(_up.set(0, 0, 1), -tilt));
    r.writeBone(index, _bone, _a);
  }
}

const STEP = 1 / 60;

// How each kind of blow takes a body: a bullet at the height it struck; a car at the shins, tipping them over the bonnet;
// a blast from below
function collapse(rig, { ground, push = null, vx = 0, vz = 0, dirX = 0, dirZ = 0, y = 1.25, cause = 'shot' }) {
  const body = new Ragdoll(rig, ground, push);
  body.drift(vx, 0, vz, STEP);
  const px = rig.x, pz = rig.z, base = body.p[1] - 0.96 * rig.s;
  const l = Math.hypot(dirX, dirZ) || 1;
  const ux = dirX / l, uz = dirZ / l;
  if (cause === 'vehicle') {
    const speed = Math.min(16, l);
    body.hit(px, base + 0.4, pz, ux * speed * 1.1, speed * 0.2, uz * speed * 1.1, STEP, 0.9);
    body.hit(px, base + 1.3, pz, ux * speed * 0.5, speed * 0.35, uz * speed * 0.5, STEP, 1.2);
  } else if (cause === 'explosion') {
    body.hit(px, base + 0.5, pz, ux * 7, 7.5, uz * 7, STEP, 2);
  } else {
    body.hit(px, base + y, pz, ux * 3.4, 0.5, uz * 3.4, STEP, 0.55);
  }
  rig.limp = body;
  rig.aim = null;
  rig.punch = 0;
  return body;
}

export { Ragdoll, collapse };
