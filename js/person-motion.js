import * as THREE from 'three/webgpu';
import { mocap, newPose, sample, blend } from './mocap.js';
import { BONE, LIMB, bindJointPositions } from './human-skeleton.js';
import { Body } from './person-body.js';

// What a real person's body does each frame: captured motion matched to their speed and heading, a weapon held in both
// hands by inverse kinematics, the head following the eyes. Falls, bikes, jumps and dives still come from the PersonRig
// (rig.pose), which is carried over onto this skeleton bone by bone.

const GAITS = {
  m: ['m_walk_slow_01', 'm_walk_neutral', 'm_run_slow_01', 'm_run_neutral', 'm_run_fast_01'],
  f: ['f_walk_slow_01', 'f_walk_neutral', 'f_run_slow_01', 'f_run_neutral', 'f_run_fast_01']
};
const IDLES = { m: ['m_idle_neutral_01', 'm_idle_neutral_02', 'm_idle_breathe_01'], f: ['f_idle_neutral_01', 'f_idle_neutral_02', 'f_idle_breathe_01'] };
const CROUCH = { m: 'm_crouch_idle', f: 'f_crouch_idle' };
const IDLE_FADE = 0.7; // seconds between two idle takes

const ease = (dt, t) => 1 - Math.exp(-dt / t);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
const qset = (q, a, i) => q.set(a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]);
const qput = (a, i, q) => { a[i * 4] = q.x; a[i * 4 + 1] = q.y; a[i * 4 + 2] = q.z; a[i * 4 + 3] = q.w; };
const vset = (v, a, i) => v.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
const vput = (a, i, v) => { a[i * 3] = v.x; a[i * 3 + 1] = v.y; a[i * 3 + 2] = v.z; };

const UP = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _f = new THREE.Vector3();
const _g = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _rootInv = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _across = new THREE.Vector3();
const _line = new THREE.Vector3();
const _top = new THREE.Vector3();
const _gx = new THREE.Vector3();
const _gy = new THREE.Vector3();
const _gz = new THREE.Vector3();
const _fingers = new THREE.Vector3();
const _target = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _restP = new THREE.Vector3();
const _aimP = new THREE.Vector3();
const _restQ = new THREE.Quaternion();
const _aimQ = new THREE.Quaternion();
const _handQ = new THREE.Quaternion();

// Rotation of a right-handed frame whose axes are (x, y, z) in world space
const frameQuat = (x, y, z, out) => out.setFromRotationMatrix(_m.makeBasis(x, y, z));

// Hands: how a bone frame sits on the wrist, once per skeleton. `f` runs along the fingers, `a` across the knuckles
// towards the index, `n` out of the palm
function handFrame(sk, side) {
  const i = side === 0 ? 'L' : 'R';
  const at = (name, out) => sk.pointOf(sk.index.get(`${i}_${name}`), out);
  const wrist = at('Hand', new THREE.Vector3());
  const middle = at('Finger2', new THREE.Vector3()), index = at('Finger1', new THREE.Vector3()), pinky = at('Finger4', new THREE.Vector3());
  const f = middle.clone().sub(wrist).normalize();
  const a = index.clone().sub(pinky);
  a.addScaledVector(f, -a.dot(f)).normalize();
  const c = new THREE.Vector3().crossVectors(f, a);
  const n = c.clone().multiplyScalar(side === 0 ? 1 : -1);
  const bind = new THREE.Quaternion().fromArray(sk.bindQ, sk.bone.hand[side] * 4);
  // takes the frame (f, a, f × a) to the hand bone
  const toBone = frameQuat(f, a, c, new THREE.Quaternion()).invert().multiply(bind);
  return { wrist, f, a, n, length: middle.distanceTo(wrist), bind, toBone };
}

// Fingers closed by joint angles, from the open bind pose: [thumb, index, middle, ring, little] × [base, middle, tip]
const GRIPS = {
  relaxed: null,
  pistol: [[0.5, 0.35, 0.3], [0.55, 0.55, 0.3], [1.15, 1.25, 0.8], [1.2, 1.3, 0.85], [1.2, 1.3, 0.85]],
  support: [[0.35, 0.25, 0.2], [0.75, 0.8, 0.5], [0.85, 0.85, 0.55], [0.95, 0.9, 0.55], [1.05, 0.95, 0.6]],
  fist: [[0.5, 0.4, 0.5], [1.35, 1.45, 0.9], [1.4, 1.5, 0.95], [1.45, 1.5, 0.95], [1.5, 1.5, 0.95]]
};
function fingerPose(sk, side, grip) {
  const frame = handFrame(sk, side);
  const out = new Float32Array(15 * 4);
  const axis = new THREE.Vector3().crossVectors(frame.f, frame.n).normalize();
  const local = new THREE.Vector3(), base = new THREE.Quaternion(), turn = new THREE.Quaternion(), inv = new THREE.Quaternion();
  sk.fingers[side].forEach((chain, f) => chain.forEach((bone, j) => {
    inv.fromArray(sk.bindQ, bone * 4).invert();
    if (f === 0) local.copy(frame.f).multiplyScalar(0.35).addScaledVector(frame.n, -0.2).addScaledVector(frame.a, side === 0 ? 0 : 0).normalize();
    else local.copy(axis);
    local.applyQuaternion(inv);
    base.fromArray(sk.localQ, bone * 4);
    turn.setFromAxisAngle(local, grip[f][j]);
    base.multiply(turn);
    out.set([base.x, base.y, base.z, base.w], (f * 3 + j) * 4);
  }));
  return out;
}

// One per skeleton: what never changes between bodies wearing it
function rigging(sk) {
  if (sk.rigging) return sk.rigging;
  const { bone, bindP } = sk;
  const hands = [handFrame(sk, 0), handFrame(sk, 1)];
  const grips = {};
  for (const [name, grip] of Object.entries(GRIPS)) if (grip) grips[name] = [fingerPose(sk, 0, grip), fingerPose(sk, 1, grip)];
  // Where the rig's bones become this skeleton's: same segment, with the arms and legs swung from the rig's bind pose to this one
  const joints = bindJointPositions(false);
  const dir = (from, to) => _a.fromArray(bindP, to * 3).sub(_b.fromArray(bindP, from * 3)).normalize().clone();
  const gameDir = (from, to) => new THREE.Vector3(...joints[to]).sub(new THREE.Vector3(...joints[from])).normalize();
  const map = [];
  const add = (b, g, c = null) => map.push({ bone: b, game: g, swing: c ?? new THREE.Quaternion(), bind: new THREE.Quaternion().fromArray(sk.bindQ, b * 4) });
  add(bone.pelvis, BONE.PELVIS);
  add(bone.spine, BONE.SPINE);
  add(bone.spine1, BONE.SPINE);
  add(bone.spine2, BONE.CHEST);
  add(bone.neck, BONE.NECK);
  add(bone.head, BONE.HEAD);
  for (let i = 0; i < 2; i++) {
    const swing = (b, child, g, gChild) => new THREE.Quaternion().setFromUnitVectors(dir(b, child), gameDir(g, gChild));
    add(bone.clavicle[i], LIMB.clavicle[i]);
    add(bone.upper[i], LIMB.upperArm[i], swing(bone.upper[i], bone.fore[i], LIMB.upperArm[i], LIMB.forearm[i]));
    add(bone.fore[i], LIMB.forearm[i], swing(bone.fore[i], bone.hand[i], LIMB.forearm[i], LIMB.hand[i]));
    add(bone.hand[i], LIMB.hand[i], swing(bone.fore[i], bone.hand[i], LIMB.forearm[i], LIMB.hand[i]));
    add(bone.thigh[i], LIMB.thigh[i], swing(bone.thigh[i], bone.calf[i], LIMB.thigh[i], LIMB.shin[i]));
    add(bone.calf[i], LIMB.shin[i], swing(bone.calf[i], bone.foot[i], LIMB.shin[i], LIMB.foot[i]));
    add(bone.foot[i], LIMB.foot[i]);
    add(bone.toe[i], LIMB.toe[i]);
  }
  map.sort((a, b) => a.bone - b.bone);
  const armBones = bone.upper.map((_, i) => new Set([bone.clavicle[i], bone.upper[i], bone.fore[i], bone.hand[i]]));
  sk.rigging = { hands, grips, map, armBones };
  return sk.rigging;
}

// How each weapon sits. Points are in the weapon's own space (metres, +Z along the barrel): `grip` where the palm closes,
// `fore` where the other hand supports it, `butt` the end that meets the shoulder, `muzzle` the barrel's end
const HOLD = {
  pistol: { grip: [0, -0.055, -0.035], fore: null, muzzle: [0, 0.022, 0.1], stance: 'pistol' },
  smg: { grip: [0, -0.1, -0.118], fore: [0, -0.08, 0.108], upright: true, butt: [0, 0, -0.37], muzzle: [0, 0.03, 0.167], stance: 'rifle' },
  shotgun: { grip: [0, -0.08, -0.243], fore: [0, -0.018, 0.146], butt: [0, 0, -0.45], muzzle: [0, 0.018, 0.378], stance: 'rifle' },
  rifle: { grip: [0, -0.057, -0.076], fore: [0, 0.03, 0.222], butt: [0, 0, -0.295], muzzle: [0, 0.035, 0.5], stance: 'rifle' },
  grenade: { grip: [0, 0, 0], fore: null, muzzle: [0, 0.05, 0], stance: 'thrown' }
};

const RIFLE_BLADE = 0.62;
const GUN_LIFT = 0.12; // the barrel over the line of the knuckles
const PALM_ALONG = 0.72; // palm centre, along the hand from the wrist
const PALM_OFF = 0.03; // and the gun's grip, out of the palm

class BodyDriver {
  /** @param {Skeleton} skeleton - of the person-body module */
  constructor(skeleton, female = false, seed = 0) {
    this.skeleton = skeleton;
    this.body = new Body(skeleton);
    this.kit = rigging(skeleton);
    const sex = female ? 'f' : 'm';
    this.gaits = GAITS[sex].map((n) => mocap.clips.get(n));
    this.idles = IDLES[sex].map((n) => mocap.clips.get(n));
    this.crouchClip = mocap.clips.get(CROUCH[sex]);
    this.pose = newPose();
    this.a = newPose();
    this.b = newPose();
    this.c = newPose();
    this.phase = (seed * 0.37) % 1;
    this.moving = 0;
    this.yaw = 0; // where the legs face
    this.lastYaw = null;
    this.idle = 0;
    this.idleT = (seed * 2.1) % 3;
    this.next = -1;
    this.free = 1; // 1: captured motion, 0: the PersonRig's pose
    this.ready = 0; // 0 hanging .. 1 weapon in both hands, raised
    this.aimW = 0;
    this.grip = [0, 0];
    this.recoil = 0;
    this.blink = 0;
    this.blinkAt = 1 + (seed * 3.3) % 4;
    this.time = 0;
    this.gunP = new THREE.Vector3();
    this.gunQ = new THREE.Quaternion();
    this.hasGun = false;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.twist = 0;
    this.pitch = 0;
    this.tmp = new Float32Array(skeleton.count * 4);
    this.tq = new Float32Array(skeleton.count * 4);
  }

  // The steady walk, matched to the ground speed so feet don't slide, over the standing take
  locomotion(dt, rig, yawRate, backwards) {
    const speed = rig.speed;
    const gaits = this.gaits;
    let i = 0;
    while (i < gaits.length - 2 && speed > gaits[i + 1].speed) i++;
    const low = gaits[i], high = gaits[i + 1];
    const w = clamp((speed - low.speed) / (high.speed - low.speed), 0, 1);
    const stride = low.stride + (high.stride - low.stride) * w;
    const turning = Math.abs(yawRate) * 0.22;
    const rate = Math.max(speed, turning) / stride;
    this.phase = (this.phase + rate * dt * (backwards ? -1 : 1) + 1) % 1;
    sample(low, (this.phase + low.sync) % 1, this.a);
    sample(high, (this.phase + high.sync) % 1, this.b);
    blend(this.a, this.b, w);
    const target = clamp(Math.max(speed / 0.75, turning / 0.7), 0, 1);
    this.moving += (target - this.moving) * ease(dt, 0.1);

    if (this.moving > 0.995) return this.a;
    // Standing: one take, fading to the next before it ends
    const take = this.idles[this.idle];
    this.idleT += dt;
    sample(take, Math.min(1, this.idleT / take.duration), this.b);
    const left = take.duration - this.idleT;
    if (left < IDLE_FADE) {
      if (this.next < 0) { this.next = (this.idle + 1) % this.idles.length; this.nextT = 0; }
      this.nextT += dt;
      const other = this.idles[this.next];
      sample(other, Math.min(1, this.nextT / other.duration), this.c);
      blend(this.b, this.c, 1 - clamp(left / IDLE_FADE, 0, 1));
      if (left <= 0) { this.idle = this.next; this.idleT = this.nextT; this.next = -1; }
    }
    return blend(this.b, this.a, this.moving);
  }

  // The rig's pose on this skeleton: `tq` gets each mapped bone's world rotation, then its rotation in its parent
  fromRig(rig) {
    const { body, kit: { map } } = this;
    const pose = rig.pose, { parent } = this.skeleton, tq = this.tq, tmp = this.tmp;
    for (const m of map) {
      const o = m.game * 8;
      _q.set(pose[o], pose[o + 1], pose[o + 2], pose[o + 3]).multiply(m.swing).multiply(m.bind);
      qput(tq, m.bone, _q);
      const p = parent[m.bone];
      if (p < 0) _q.premultiply(_rootInv);
      else _q.premultiply(qset(_q2, tq, p).invert());
      qput(tmp, m.bone, _q);
    }
    // the hips, between the two hip joints
    const a = LIMB.thigh[0] * 8, b = LIMB.thigh[1] * 8, j = rig.bind[LIMB.thigh[0]], k = rig.bind[LIMB.thigh[1]], s = rig.s;
    _a.copy(j).multiplyScalar(s).applyQuaternion(_q.set(pose[a], pose[a + 1], pose[a + 2], pose[a + 3]));
    _a.x += pose[a + 4]; _a.y += pose[a + 5]; _a.z += pose[a + 6];
    _b.copy(k).multiplyScalar(s).applyQuaternion(_q.set(pose[b], pose[b + 1], pose[b + 2], pose[b + 3]));
    _b.x += pose[b + 4]; _b.y += pose[b + 5]; _b.z += pose[b + 6];
    _a.add(_b).multiplyScalar(0.5);
    _a.x -= body.root[0]; _a.y -= body.root[1]; _a.z -= body.root[2];
    return _a.applyQuaternion(_rootInv).divideScalar(body.scale);
  }

  // Blends the rig's rotations (computed by fromRig) into bones, by `weight(bone)`
  blendRig(weight) {
    const { body: { q }, tmp, kit: { map } } = this;
    for (const m of map) {
      const w = weight(m.bone);
      if (w <= 0) continue;
      const o = m.bone * 4, s = q[o] * tmp[o] + q[o + 1] * tmp[o + 1] + q[o + 2] * tmp[o + 2] + q[o + 3] * tmp[o + 3] < 0 ? -w : w, r = 1 - w;
      const x = q[o] * r + tmp[o] * s, y = q[o + 1] * r + tmp[o + 1] * s, z = q[o + 2] * r + tmp[o + 2] * s, u = q[o + 3] * r + tmp[o + 3] * s;
      const n = 1 / Math.sqrt(x * x + y * y + z * z + u * u);
      q[o] = x * n; q[o + 1] = y * n; q[o + 2] = z * n; q[o + 3] = u * n;
    }
  }

  // Turns bone `b` (world space) by rotation d about its own joint, keeping its local rotation in step
  turn(b, d) {
    const { q, wq } = this.body;
    qset(_q4, wq, b).premultiply(d);
    qput(wq, b, _q4);
    const p = this.skeleton.parent[b];
    qset(_q3, wq, p).invert().multiply(_q4);
    qput(q, b, _q3);
  }

  /**
   * Two-bone reach for arm `i`: the wrist to `target`, elbow towards `pole`, the hand turned to `handQ` (world) if given.
   * `w` blends from where the arm is now.
   */
  reach(i, target, pole, handQ, w = 1) {
    const { body } = this, { bone, localP, belowHand } = this.skeleton;
    const { wp, wq, q, scale } = body;
    const up = bone.upper[i], fo = bone.fore[i], ha = bone.hand[i];
    const A = vset(_a, wp, up), B = vset(_b, wp, fo), C = vset(_c, wp, ha);
    const la = A.distanceTo(B), lb = B.distanceTo(C);
    const T = _t.copy(C).lerp(target, w);
    const dir = _d.subVectors(T, A);
    const reach = clamp(dir.length(), Math.abs(la - lb) + 0.01, (la + lb) * 0.999);
    dir.normalize();
    const cosA = (la * la + reach * reach - lb * lb) / (2 * la * reach);
    const bend = _e.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (bend.lengthSq() < 1e-6) bend.set(0, -1, 0);
    bend.normalize();
    const E = _f.copy(A).addScaledVector(dir, la * cosA).addScaledVector(bend, la * Math.sqrt(Math.max(0, 1 - cosA * cosA)));
    // upper arm: swing the bone from the elbow it has to the one it needs
    _g.subVectors(B, A).normalize();
    _p.subVectors(E, A).normalize();
    _q.setFromUnitVectors(_g, _p);
    this.turn(up, _q);
    // forearm: carried along, then swung to the wrist
    vput(wp, fo, E);
    qset(_q2, q, fo);
    qset(_q3, wq, up).multiply(_q2);
    qput(wq, fo, _q3);
    _g.copy(_c.fromArray(localP, ha * 3)).multiplyScalar(scale).applyQuaternion(_q3).normalize();
    _p.set(T.x - E.x, T.y - E.y, T.z - E.z).normalize();
    _q.setFromUnitVectors(_g, _p);
    this.turn(fo, _q);
    // the wrist and the hand
    _p.multiplyScalar(lb).add(E);
    vput(wp, ha, _p);
    qset(_q3, wq, fo).multiply(qset(_q2, q, ha));
    if (handQ) _q3.slerp(handQ, w);
    qput(wq, ha, _q3);
    body.settle(ha, belowHand[i]);
  }

  // Closes the fingers of hand i on a named grip
  clench(i, name, w) {
    const { body: { q } } = this, { fingers } = this.skeleton, pose = this.kit.grips[name][i];
    const chains = fingers[i];
    for (let f = 0; f < 5; f++) for (let j = 0; j < 3; j++) {
      const o = chains[f][j] * 4, k = (f * 3 + j) * 4;
      const s = q[o] * pose[k] + q[o + 1] * pose[k + 1] + q[o + 2] * pose[k + 2] + q[o + 3] * pose[k + 3] < 0 ? -w : w, r = 1 - w;
      const x = q[o] * r + pose[k] * s, y = q[o + 1] * r + pose[k + 1] * s, z = q[o + 2] * r + pose[k + 2] * s, u = q[o + 3] * r + pose[k + 3] * s;
      const n = 1 / Math.sqrt(x * x + y * y + z * z + u * u);
      q[o] = x * n; q[o + 1] = y * n; q[o + 2] = z * n; q[o + 3] = u * n;
    }
  }

  /**
   * @param {number} dt
   * @param {PersonRig} rig - its body has already moved this frame
   * @param {?string} kind - the weapon in hand
   */
  update(dt, rig, kind) {
    dt = Math.min(dt, 0.1);
    const { body, skeleton: sk } = this;
    this.time += dt;
    body.scale = rig.s * (0.92 / sk.legLength);

    // Where the body stands and faces
    const aiming = !!rig.aim;
    let backwards = false;
    let legYaw = rig.yaw;
    if (rig.speed > 0.4) {
      const moveYaw = Math.atan2(rig.vx, rig.vz);
      const off = wrap(moveYaw - rig.yaw);
      if (aiming) {
        // eyes on the target: the legs go where the body travels, the chest twists back
        backwards = Math.abs(off) > 1.9;
        legYaw = backwards ? wrap(moveYaw + Math.PI) : moveYaw;
      }
    }
    if (this.lastYaw === null) this.yaw = this.lastYaw = legYaw;
    this.yaw = wrap(this.yaw + wrap(legYaw - this.yaw) * ease(dt, 0.08));
    const yawRate = wrap(this.yaw - this.lastYaw) / Math.max(dt, 1e-3);
    this.lastYaw = this.yaw;
    const ground = rig.pelvisY - rig.standingHeight(0);
    body.root[0] = rig.x; body.root[1] = ground; body.root[2] = rig.z;
    _q.setFromAxisAngle(UP, this.yaw).multiply(_q2.setFromAxisAngle(AZ, (rig.bank || 0) * 0.8));
    body.rootQ[0] = _q.x; body.rootQ[1] = _q.y; body.rootQ[2] = _q.z; body.rootQ[3] = _q.w;
    _rootInv.copy(_q).invert();

    // How much the capture shows
    const forced = !!rig.limp || rig.diving || rig.riding || rig.air > 0.03;
    this.free += ((forced ? 0 : 1) - this.free) * (forced ? 1 : ease(dt, 0.14));
    const free = this.free < 0.002 ? 0 : this.free > 0.998 ? 1 : this.free;
    if (free > 0) {
      const pose = this.locomotion(dt, rig, yawRate, backwards);
      if (rig.crouch > 0.01) {
        sample(this.crouchClip, ((this.time * 0.1) % 1), this.c);
        blend(pose, this.c, Math.min(1, rig.crouch));
      }
      body.wear(pose);
    }
    if (free < 1 || rig.handsUp > 0.01 || rig.punch > 0.01) {
      const hips = this.fromRig(rig);
      if (free < 1) {
        const w = 1 - free;
        for (let c = 0; c < 3; c++) body.pelvis[c] = free > 0 ? body.pelvis[c] * free + hips.getComponent(c) * w : hips.getComponent(c);
        this.blendRig(() => w);
      }
      const hands = rig.handsUp > 0.01 ? Math.min(1, rig.handsUp) : 0;
      const punch = rig.punch > 0.01 ? Math.min(1, rig.punch * 2.5) : 0;
      if (free > 0 && (hands > 0 || punch > 0)) {
        const { armBones } = this.kit;
        const side = rig.punchSide;
        this.blendRig((b) => Math.max(armBones[0].has(b) || armBones[1].has(b) ? hands : 0, armBones[side].has(b) ? punch : 0));
      }
    }

    body.solve();
    if (free > 0 && (rig.kickX || rig.kickZ)) this.flinch(rig);
    const hold = kind ? HOLD[kind] : null;
    if (free > 0) this.upperBody(dt, rig, hold, kind);
    else { this.hasGun = false; this.ready = this.aimW = 0; }
    if (free > 0) this.lookAround(dt, rig);
    this.eyes(dt);
  }

  // A blow the chest gives way to
  flinch(rig) {
    const { spine1 } = this.skeleton.bone;
    _a.set(rig.kickZ, 0, -rig.kickX);
    const amount = _a.length();
    if (amount < 0.005) return;
    this.turn(spine1, _q.setFromAxisAngle(_a.divideScalar(amount), amount));
    this.body.settle(spine1, this.skeleton.belowSpine1);
  }

  // Chest and head towards the target, before the arms reach for the gun
  orient(dt, rig, want) {
    const { body } = this;
    const { bone, belowSpine1 } = this.skeleton;
    const yawTo = want ? clamp(wrap(want.yaw - this.yaw), -1.5, 1.5) : 0;
    const pitchTo = want ? clamp(want.pitch, -0.9, 0.9) : 0;
    this.twist += (yawTo - this.twist) * ease(dt, 0.07);
    this.pitch += (pitchTo - this.pitch) * ease(dt, 0.07);
    if (Math.abs(this.twist) + Math.abs(this.pitch) < 0.002) return;
    // shared along the back: two thirds of the way by the chest, the neck and head take the rest later
    _q.setFromAxisAngle(UP, this.twist * 0.5);
    this.turn(bone.spine1, _q);
    _a.set(Math.cos(this.yaw + this.twist), 0, -Math.sin(this.yaw + this.twist)); // across the chest, towards their left
    _q2.setFromAxisAngle(_a, -this.pitch * 0.45);
    this.turn(bone.spine1, _q2);
    body.settle(bone.spine1, belowSpine1);
    _q.setFromAxisAngle(UP, this.twist * 0.5);
    this.turn(bone.spine2, _q);
    _q2.setFromAxisAngle(_a, -this.pitch * 0.45);
    this.turn(bone.spine2, _q2);
    body.settle(bone.spine2, this.belowSpine2 ??= this.skeleton.below(bone.spine2));
  }

  upperBody(dt, rig, hold, kind) {
    const { body } = this;
    const { bone } = this.skeleton;
    const armed = !!hold && hold.stance !== 'thrown';
    const aiming = armed && !!rig.aim && rig.aim.y !== undefined;
    const rifle = armed && hold.stance === 'rifle';
    this.aimW += ((aiming ? 1 : 0) - this.aimW) * ease(dt, aiming ? 0.07 : 0.16);
    this.ready += ((rifle ? 1 : 0) - this.ready) * ease(dt, 0.1);
    this.hasGun = !!hold;

    // Aim direction from the base of the neck
    let want = null;
    if (aiming) {
      vset(_a, body.wp, bone.neck);
      const dx = rig.aim.x - _a.x, dy = rig.aim.y - _a.y, dz = rig.aim.z - _a.z;
      // a long gun turns the left shoulder towards the target, so the left hand reaches the fore-end
      want = { yaw: Math.atan2(dx, dz) - (rifle ? RIFLE_BLADE : 0), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
    }
    this.orient(dt, rig, want);
    if (this.grip[1] < 1) this.grip[1] += (((hold ? 1 : 0) - this.grip[1])) * ease(dt, 0.05);
    if (!hold) {
      this.grip[1] += (0 - this.grip[1]) * ease(dt, 0.1);
      this.grip[0] += (0 - this.grip[0]) * ease(dt, 0.1);
      if (rig.punch > 0.01) { this.clench(rig.punchSide, 'fist', Math.min(1, rig.punch * 3)); body.solve(); }
      return;
    }
    if (!armed) {
      this.clench(1, 'fist', 0.7);
      body.settle(bone.hand[1], this.skeleton.belowHand[1]);
      this.placeInHand(hold);
      return;
    }
    this.clench(1, 'pistol', this.grip[1]);
    body.settle(bone.hand[1], this.skeleton.belowHand[1]);
    this.holdGun(dt, rig, hold, want);
  }

  // World rotation of hand i with fingers along `f` and the index side towards `a`; `a` is squared up against `f`
  handFacing(i, f, a, out) {
    _a.copy(f).normalize();
    _b.copy(a).addScaledVector(_a, -a.dot(_a)).normalize();
    _c.crossVectors(_a, _b);
    return frameQuat(_a, _b, _c, out).multiply(this.kit.hands[i].toBone);
  }

  // Weapon follows the hand: hanging at their side
  placeInHand(hold) {
    const { body } = this;
    const { bone } = this.skeleton;
    const frame = this.kit.hands[1];
    qset(_q2, body.wq, bone.hand[1]).multiply(_q.copy(frame.bind).invert());
    const f = _a.copy(frame.f).applyQuaternion(_q2);
    const n = _c.copy(frame.n).applyQuaternion(_q2);
    const a = _b.copy(frame.a).applyQuaternion(_q2);
    // the inverse of what holdGun does: the barrel just above the line of the knuckles
    const z = _d.copy(f).addScaledVector(a, GUN_LIFT).normalize();
    const y = _e.copy(a).addScaledVector(z, -a.dot(z)).normalize();
    const x = _f.crossVectors(y, z);
    frameQuat(x, y, z, this.gunQ);
    vset(_p, body.wp, bone.hand[1]);
    _p.addScaledVector(f, frame.length * PALM_ALONG * body.scale).addScaledVector(n, PALM_OFF * body.scale);
    _g.fromArray(hold.grip).applyQuaternion(this.gunQ);
    this.gunP.copy(_p).sub(_g);
  }

  holdGun(dt, rig, hold, want) {
    const { body } = this;
    const { bone } = this.skeleton;
    const s = body.scale;
    const aimW = this.aimW;
    const rifle = hold.stance === 'rifle';
    const frame = this.kit.hands[1];
    const yawC = this.yaw + this.twist;
    _fwd.set(Math.sin(yawC), 0, Math.cos(yawC));
    _right.set(-_fwd.z, 0, _fwd.x);

    // Hanging pose first: where the weapon rests when not aimed
    if (rifle) {
      // low ready across the body: grip by the right hip, muzzle down and to the left
      _gz.copy(_fwd).multiplyScalar(0.72).addScaledVector(_right, -0.5);
      _gz.y = -0.48;
      _gz.normalize();
      _gx.crossVectors(UP, _gz).normalize();
      _gy.crossVectors(_gz, _gx);
      frameQuat(_gx, _gy, _gz, _restQ);
      vset(_restP, body.wp, bone.spine2).addScaledVector(_right, 0.15 * s).addScaledVector(_fwd, 0.17 * s);
      _restP.y -= 0.17 * s;
      _restP.sub(_c.fromArray(hold.grip).applyQuaternion(_restQ));
    } else {
      this.placeInHand(hold);
      _restP.copy(this.gunP);
      _restQ.copy(this.gunQ);
    }

    // Aimed pose: the barrel on the line to the target
    if (aimW > 0.001 && want) {
      _aim.set(rig.aim.x, rig.aim.y, rig.aim.z);
      vset(_b, body.wp, bone.neck);
      const yaw = Math.atan2(_aim.x - _b.x, _aim.z - _b.z);
      _across.set(-Math.cos(yaw), 0, Math.sin(yaw));
      _line.subVectors(_aim, _b).normalize();
      _top.crossVectors(_across, _line).negate().normalize();
      if (_top.y < 0) _top.negate();
      if (rifle) {
        // the stock in the shoulder, under the eye
        vset(_aimP, body.wp, bone.upper[1]).addScaledVector(_line, (-hold.butt[2] + 0.02) * s).addScaledVector(_top, 0.035 * s).addScaledVector(_across, -0.035 * s);
      } else {
        _aimP.copy(_b).addScaledVector(_line, 0.5 * s).addScaledVector(_top, -0.04 * s).addScaledVector(_across, 0.05 * s);
      }
      _gz.subVectors(_aim, _aimP).normalize();
      _gx.crossVectors(UP, _gz).normalize();
      _gy.crossVectors(_gz, _gx);
      frameQuat(_gx, _gy, _gz, _aimQ);
      const k = aimW * aimW * (3 - 2 * aimW);
      this.gunP.copy(_restP).lerp(_aimP, k);
      this.gunQ.copy(_restQ).slerp(_aimQ, k);
      if (this.recoil > 0.001) {
        this.gunP.addScaledVector(_gz, -0.05 * this.recoil * s);
        this.gunP.y += 0.012 * this.recoil * s;
        this.gunQ.premultiply(_q.setFromAxisAngle(_gx, -0.2 * this.recoil));
      }
    } else {
      this.gunP.copy(_restP);
      this.gunQ.copy(_restQ);
    }
    this.recoil *= Math.exp(-dt * 14);
    const weight = rifle ? Math.max(this.ready, aimW) : aimW;
    if (weight <= 0.001) return;

    // Hands onto the weapon
    _gx.set(1, 0, 0).applyQuaternion(this.gunQ);
    _gy.set(0, 1, 0).applyQuaternion(this.gunQ);
    _gz.set(0, 0, 1).applyQuaternion(this.gunQ);
    _fingers.copy(_gz).addScaledVector(_gy, -GUN_LIFT).normalize();
    this.handFacing(1, _fingers, _gy, _handQ);
    // the palm of the right hand faces left, against the grip
    _target.fromArray(hold.grip).applyQuaternion(this.gunQ).add(this.gunP).addScaledVector(_fingers, -frame.length * PALM_ALONG * s).addScaledVector(_gx, -PALM_OFF * s);
    _pole.set(-Math.cos(yawC) * (rifle ? 0.55 : 0.5), -1, Math.sin(yawC) * (rifle ? 0.55 : 0.5)); // elbow out to their right
    this.reach(1, _target, _pole, _handQ, weight);
    this.leftHand(rig, hold, weight, yawC);
  }

  // Uses the weapon's axes (_gx, _gy, _gz) set by holdGun
  leftHand(rig, hold, weight, yawC) {
    const { body } = this;
    const { bone, belowHand } = this.skeleton;
    const s = body.scale;
    const frame = this.kit.hands[0];
    if (hold.fore) {
      _target.fromArray(hold.fore).applyQuaternion(this.gunQ).add(this.gunP);
      if (hold.upright) {
        // round the upright grip, knuckles forward
        _fingers.copy(_gx).multiplyScalar(-0.75).addScaledVector(_gz, 0.65).normalize();
        this.handFacing(0, _fingers, _gy, _handQ);
        _target.addScaledVector(_fingers, -frame.length * 0.75 * s).addScaledVector(_gz, -0.03 * s).addScaledVector(_gx, 0.02 * s);
      } else {
        // palm up under the fore-end: fingers to the far side, thumb along the barrel
        _fingers.copy(_gx).multiplyScalar(-0.8).addScaledVector(_gz, 0.5).addScaledVector(_gy, 0.2).normalize();
        this.handFacing(0, _fingers, _gz, _handQ);
        _target.addScaledVector(_fingers, -frame.length * 0.72 * s).addScaledVector(_gy, -0.045 * s).addScaledVector(_gx, 0.015 * s);
      }
    } else {
      // wrapped round the shooting hand from the left, palm against its fingers
      _target.fromArray(hold.grip).applyQuaternion(this.gunQ).add(this.gunP);
      _fingers.copy(_gz).multiplyScalar(0.5).addScaledVector(_gx, -0.75).addScaledVector(_gy, -0.35).normalize();
      this.handFacing(0, _fingers, _gy, _handQ);
      _target.addScaledVector(_gx, 0.05 * s).addScaledVector(_fingers, -frame.length * 0.6 * s).addScaledVector(_gz, -0.01 * s);
    }
    if (rig.reloading >= 0) {
      // down to the belt for a fresh magazine and back
      const dip = Math.sin(Math.PI * Math.min(1, rig.reloading * 1.15));
      vset(_a, body.wp, bone.pelvis);
      _a.y += 0.04;
      _a.addScaledVector(_b.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), 0.17 * s);
      _target.lerp(_a, dip * dip);
    }
    _pole.set(Math.cos(yawC) * 0.4, -1, -Math.sin(yawC) * 0.4);
    this.grip[0] += (1 - this.grip[0]) * 0.3;
    this.clench(0, 'support', this.grip[0] * weight);
    body.settle(bone.hand[0], belowHand[0]);
    this.reach(0, _target, _pole, _handQ, weight);
  }

  // The head goes where they look, the eyes further
  lookAround(dt, rig) {
    const { body } = this;
    const { bone, belowHead } = this.skeleton;
    const yaw = rig.aim ? this.yawToAim(rig) : rig.yaw + (rig.lookTurn || 0);
    const pitch = rig.aim ? this.pitchToAim(rig) : 0;
    const chest = this.yaw + this.twist;
    const rel = clamp(wrap(yaw - chest), -1.2, 1.2);
    this.lookYaw += (rel - this.lookYaw) * ease(dt, 0.09);
    this.lookPitch += (clamp(pitch - this.pitch * 0.45, -0.6, 0.6) - this.lookPitch) * ease(dt, 0.09);
    if (Math.abs(this.lookYaw) + Math.abs(this.lookPitch) < 0.003) return;
    _q.setFromAxisAngle(UP, this.lookYaw);
    this.turn(bone.head, _q);
    _a.set(Math.cos(chest + this.lookYaw), 0, -Math.sin(chest + this.lookYaw));
    _q.setFromAxisAngle(_a, -this.lookPitch);
    this.turn(bone.head, _q);
    body.settle(bone.head, belowHead);
  }

  yawToAim(rig) { return Math.atan2(rig.aim.x - rig.x, rig.aim.z - rig.z); }

  pitchToAim(rig) {
    const { wp } = this.body, h = this.skeleton.bone.head;
    return Math.atan2(rig.aim.y - wp[h * 3 + 1], Math.hypot(rig.aim.x - rig.x, rig.aim.z - rig.z));
  }

  // Blinks now and then
  eyes(dt) {
    const { body } = this;
    const { bone, parent, localP } = this.skeleton;
    if (bone.lidTop[0] === undefined) return; // masked and helmeted avatars have no eyelids
    this.blinkAt -= dt;
    if (this.blinkAt <= 0) { this.blink = 1; this.blinkAt = 1.5 + Math.random() * 5; }
    if (this.blink <= 0.01) return;
    this.blink = Math.max(0, this.blink - dt * 7);
    const k = Math.sin(this.blink * Math.PI);
    for (let i = 0; i < 2; i++) {
      const top = bone.lidTop[i], low = bone.lidBottom[i], head = parent[top];
      qset(_q, body.wq, head);
      _a.fromArray(localP, top * 3).multiplyScalar(body.scale);
      _a.y -= 0.0075 * k;
      _a.applyQuaternion(_q);
      vset(_b, body.wp, head).add(_a);
      vput(body.wp, top, _b);
      _a.fromArray(localP, low * 3).multiplyScalar(body.scale);
      _a.y += 0.002 * k;
      _a.applyQuaternion(_q);
      vset(_b, body.wp, head).add(_a);
      vput(body.wp, low, _b);
    }
  }

  kick() { this.recoil = 1; }

  // World point of the barrel's end
  muzzle(hold, out) {
    return out.fromArray(hold.muzzle).multiplyScalar(this.gunScale ?? 1).applyQuaternion(this.gunQ).add(this.gunP);
  }
}

export { BodyDriver, HOLD };
