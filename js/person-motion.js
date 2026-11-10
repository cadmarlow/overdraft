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
const _slotR = new THREE.Quaternion();
const _slotQ = new THREE.Quaternion();
const _slotO = new THREE.Vector3();
const _slotP = new THREE.Vector3();
const _viaP = new THREE.Vector3();
const _stP = new THREE.Vector3();
const _stQ = new THREE.Quaternion();

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
  pistol: [[0.8, 0.15, 0.2], [0.55, 0.55, 0.3], [1.15, 1.25, 0.8], [1.2, 1.3, 0.85], [1.2, 1.3, 0.85]],
  // the same hand with the index laid along the frame, off the trigger
  indexed: [[0.8, 0.15, 0.2], [0.3, 0.38, 0.22], [1.15, 1.25, 0.8], [1.2, 1.3, 0.85], [1.2, 1.3, 0.85]],
  support: [[0.55, 0.15, 0.15], [0.75, 0.8, 0.5], [0.85, 0.85, 0.55], [0.95, 0.9, 0.55], [1.05, 0.95, 0.6]],
  fist: [[0.7, 0.35, 0.4], [1.35, 1.45, 0.9], [1.4, 1.5, 0.95], [1.45, 1.5, 0.95], [1.5, 1.5, 0.95]]
};
function fingerPose(sk, side, grip) {
  const frame = handFrame(sk, side);
  const out = new Float32Array(15 * 4);
  const axis = new THREE.Vector3().crossVectors(frame.f, frame.n).normalize();
  const local = new THREE.Vector3(), base = new THREE.Quaternion(), turn = new THREE.Quaternion(), inv = new THREE.Quaternion();
  sk.fingers[side].forEach((chain, f) => chain.forEach((bone, j) => {
    inv.fromArray(sk.bindQ, bone * 4).invert();
    // the thumb stands off the palm in the bind pose: it closes by swinging down onto the line of the fingers (about
    // a × f), with a little roll in towards the palm, rather than by curling like the others
    if (f === 0) local.crossVectors(frame.a, frame.f).addScaledVector(frame.f, 0.3).normalize();
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

// How each weapon sits. Points are in the weapon's own space (metres, +Z along the barrel, +Y its top, +X its left):
// `grip` where the palm closes, `fore` where the other hand supports it, `butt` the end that meets the shoulder, `muzzle`
// the barrel's end, `port` where the brass leaves, `stow` the point that rests on the body when it is put away.
// `slot` is where it is carried (SLOTS), `draw` the seconds from there to the hands, `tilt` how far the barrel leans off
// the forearm when it hangs in one hand, `kick` = [back m, muzzle rise rad, spring rad/s, how far the chest rocks rad].
const HOLD = {
  pistol: { grip: [0, -0.008, -0.01], fore: null, magazine: [0, -0.06, -0.022], muzzle: [0, 0.06, 0.174], port: [0, 0.082, 0.02], sight: 0.086,
    stow: [0, 0.045, 0.04], stance: 'pistol', slot: 'thigh', draw: 0.36, tilt: 0.12, kick: [0.024, 0.21, 27, 0.012] },
  smg: { grip: [0, -0.005, 0], fore: [0, 0.046, 0.14], magazine: [0, -0.12, 0.015], butt: [0, 0.05, -0.318], muzzle: [0, 0.092, 0.32], port: [-0.03, 0.09, -0.02], sight: 0.155,
    stow: [0, 0.06, 0], stance: 'rifle', slot: 'jacket', draw: 0.42, tilt: 0.34, kick: [0.011, 0.028, 30, 0.006] },
  shotgun: { grip: [0, 0.008, -0.21], fore: [0, 0.026, 0.24], magazine: [0, 0.03, -0.05], butt: [0, -0.025, -0.488], muzzle: [0, 0.083, 0.488], port: [-0.028, 0.078, -0.03], sight: 0.1, pump: 0.08,
    stow: [0, 0.03, 0], stance: 'rifle', slot: 'backL', draw: 0.52, tilt: 0.42, kick: [0.06, 0.15, 15, 0.075] },
  rifle: { grip: [0, -0.04, -0.205], fore: [0, -0.012, 0.112], upright: true, magazine: [0, -0.09, -0.02], butt: [0, -0.015, -0.468], muzzle: [0, 0.078, 0.47], port: [-0.03, 0.07, -0.06], sight: 0.145,
    stow: [0, 0.03, 0], stance: 'rifle', slot: 'backR', draw: 0.52, tilt: 0.42, kick: [0.017, 0.036, 26, 0.012] },
  grapple: { grip: [0, -0.055, -0.035], fore: null, muzzle: [0, 0.03, 0.16], port: [0, 0, 0], sight: 0.05,
    stow: [0, 0, 0], stance: 'pistol', slot: 'belt', draw: 0.34, tilt: 0.12, kick: [0.03, 0.12, 22, 0.01] },
  grenade: { grip: [0, 0, 0], fore: null, muzzle: [0, 0.05, 0], stow: [0, 0, 0], stance: 'thrown', slot: 'pocket', draw: 0.26, tilt: 0.12 }
};

// Where weapons live on the body when the hands are empty. Everything is written in the avatar's bind space (metres at
// scale 1, x = their left, y up, z = their front) and rides on one bone: `at` from that bone's joint (`out` is pushed
// further by the measured body surface: clothes differ), `dir` the barrel, `top` the weapon's top, `via` the point the
// weapon swings through on its way to the hands. Hidden slots are inside clothing: the weapon shows only once drawn.
const SLOTS = {
  // low on the right thigh, butt canted forward, where the hand already hangs
  thigh: { bone: 'thighR', at: [0, -0.085, 0.012], out: [-1, 0, 0], surface: 'thigh', gap: 0.024, dir: [0, -0.966, -0.259], top: [0, -0.259, 0.966], via: [-0.1, 0.09, 0.07] },
  // long guns slung across the back, muzzles up over the left shoulder, grips low behind the right hip: where the right
  // hand finds them, and nothing stands on the right shoulder, which is where the camera looks past when aiming
  backR: { bone: 'spine2', at: [0.05, -0.1, 0], out: [0, 0, -1], surface: 'back', gap: 0.09, dir: [0.643, 0.766, 0], top: [0.766, -0.643, 0], via: [-0.46, -0.34, 0.04] },
  backL: { bone: 'spine2', at: [0.0, -0.05, 0], out: [0, 0, -1], surface: 'back', gap: 0.035, dir: [0.438, 0.899, 0], top: [0.899, -0.438, 0], via: [-0.46, -0.36, 0.02] },
  // under the jacket on the left flank, on a shoulder rig
  jacket: { bone: 'spine1', at: [0.13, 0.04, 0.07], out: [0, 0, 0], gap: 0, dir: [0, -1, 0], top: [0, 0, 1], via: [0.02, 0.02, 0.3], hidden: true },
  // the gadget hangs at the back of the belt, a grenade comes out of the right pocket
  belt: { bone: 'pelvis', at: [-0.1, 0.02, -0.1], out: [0, 0, 0], gap: 0, dir: [0, -1, 0], top: [0, 0, 1], via: [-0.3, 0, 0], hidden: true },
  pocket: { bone: 'pelvis', at: [-0.17, 0, 0.05], out: [0, 0, 0], gap: 0, dir: [0, 1, 0], top: [0, 0, 1], via: [-0.24, 0.06, 0.12], hidden: true }
};
// What the body measures when nobody measured the avatar (characters.js does, per look)
const SURFACE = { thigh: 0.1, back: 0.13 };
for (const slot of Object.values(SLOTS)) {
  const z = new THREE.Vector3(...slot.dir).normalize(), y = new THREE.Vector3(...slot.top);
  y.addScaledVector(z, -y.dot(z)).normalize();
  slot.q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z));
}

const RIFLE_BLADE = 0.62;
const GUN_LIFT = 0.12; // the barrel over the line of the knuckles
const PALM_ALONG = 0.72; // palm centre, along the hand from the wrist
const PALM_OFF = 0.03; // and the gun's grip, out of the palm
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
// A critically damped spring in closed form: the same motion at 30, 60 or 144 Hz, stable on a missed frame
function spring(s, omega, dt) {
  const j = s.v + omega * s.x, decay = Math.exp(-omega * dt);
  s.x = (s.x + j * dt) * decay;
  s.v = (s.v - omega * j * dt) * decay;
}

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
    this.aimShoulder = 1;
    this.grip = [0, 0];
    this.gunKind = null; // the weapon the right hand is busy with: held, being drawn or being put away
    this.holds = null; // kind → a HOLD entry of this body's own (a dressed weapon: its muzzle, where its foregrip is)
    this.swap = 0; // 0 on the body .. 1 in the hands
    this.swapDir = 0; // +1 drawing, -1 putting away
    this.gunOut = false; // out of its clothes: to be drawn at gunP / gunQ
    this.shotAge = 10;
    this.kickS = { x: 0, v: 0 }; // recoil through the hands, 1 = one shot of this weapon at its peak
    this.kickSide = 0;
    this.rock = { x: 0, v: 0 }; // and through the chest
    this.lean = 0; // weight forward behind the sights
    this.cheek = 0; // head down on the stock
    this.lag = 0; // the muzzle trailing a fast turn (rad)
    this.lastAimYaw = null;
    this.trigger = 0; // 0 index along the frame .. 1 on the trigger
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
    const speed = rig.speed / this.body.scale;
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
    const { bone, belowHand } = this.skeleton;
    this.reachChain(bone.upper[i], bone.fore[i], bone.hand[i], belowHand[i], target, pole, handQ, w);
  }

  // The same for a leg: the ankle to `target`, the knee towards `pole`, the foot turned to `footQ` (world) if given
  reachLeg(i, target, pole, footQ, w = 1) {
    const { bone } = this.skeleton;
    const below = this.kit.belowFoot ??= bone.foot.map((f) => this.skeleton.below(f));
    this.reachChain(bone.thigh[i], bone.calf[i], bone.foot[i], below[i], target, pole, footQ, w);
  }

  // Two-bone chain `up` - `fo` - `ha` (upper, lower, end bone), the end joint to `target`, the middle bending towards
  // `pole`; `below` lists what hangs from the end bone
  reachChain(up, fo, ha, below, target, pole, handQ, w = 1, qw = w) {
    const { body } = this, { localP } = this.skeleton;
    const { wp, wq, q, scale } = body;
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
    if (handQ) _q3.slerp(handQ, qw);
    qput(wq, ha, _q3);
    body.settle(ha, below);
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
    // A captured stride already includes its pelvis motion. Adding the procedural rig's bob a second time can
    // pull the whole runner 20+ cm below the pavement. Anchor capture to the actual supporting surface instead.
    const ground = rig.groundY;
    body.root[0] = rig.x; body.root[1] = ground; body.root[2] = rig.z;
    _q.setFromAxisAngle(UP, this.yaw).multiply(_q2.setFromAxisAngle(AZ, (rig.bank || 0) * 0.8));
    body.rootQ[0] = _q.x; body.rootQ[1] = _q.y; body.rootQ[2] = _q.z; body.rootQ[3] = _q.w;
    _rootInv.copy(_q).invert();

    // How much the capture shows
    // Normally the rig's pose takes over at once (a fall, a bike); a rig that sets `rideFade` (seconds) is faded into, so
    // the hero's capture crosses into the scripted body getting into a car (gameplay.js, vehicle-entry.js)
    const forced = !!rig.limp || rig.diving || rig.riding || rig.air > 0.03;
    this.free += ((forced ? 0 : 1) - this.free) * (forced ? (rig.rideFade > 0 ? ease(dt, rig.rideFade) : 1) : ease(dt, 0.14));
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
    if (!forced && !rig.overlay?.feet) this.conformGround(rig);
    if (free > 0 && (rig.kickX || rig.kickZ)) this.flinch(rig);
    if (free > 0) { this.equip(dt, kind); this.upperBody(dt, rig); }
    else {
      this.ready = this.aimW = 0;
      this.kickS.x = this.kickS.v = 0;
      if (this.gunKind && kind === this.gunKind && this.swap >= 1 && !rig.limp && !rig.riding) {
        // a jump, a dive: the weapon stays in the hand that holds it and goes where that hand goes
        this.placeInHand(this.holdFor(this.gunKind), this.gunP, this.gunQ);
        this.hasGun = this.gunOut = true;
      } else { this.snapWeapon(null); this.hasGun = this.gunOut = false; }
    }
    if (free > 0) this.lookAround(dt, rig);
    this.eyes(dt);
    if (rig.overlay) this.overlay(rig.overlay);
  }

  // Preserve the captured stride on flat ground, but let each foot stand on its own side of a curb. Moving the
  // whole capture up when its centre crosses a curb otherwise buries the leading foot before the centre arrives.
  conformGround(rig) {
    const { body, skeleton: sk } = this, { bone } = sk;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), scale = body.scale;
    for (let i = 0; i < 2; i++) {
      vset(_target, body.wp, bone.foot[i]);
      // The toe reaches the curb before the ankle does. Sample the sole's footprint, including both heel corners,
      // so the shoe cannot enter the vertical curb face while the ankle is still over the road.
      let support = rig.surfaceAt(_target.x, _target.z);
      let lift = -Infinity;
      _q.fromArray(body.wq, bone.foot[i] * 4).multiply(_q2.fromArray(sk.bindQ, bone.foot[i] * 4).invert());
      for (const along of [-0.12, 0.25]) for (const across of [-0.12, 0.12]) {
        _g.set(across, -sk.bindP[bone.foot[i] * 3 + 1], along).multiplyScalar(scale).applyQuaternion(_q);
        const ground = rig.surfaceAt(_target.x + _g.x, _target.z + _g.z);
        support = Math.max(support, ground);
        lift = Math.max(lift, ground - (_target.y + _g.y));
      }
      const delta = Math.max(support - rig.groundY, lift);
      if (Math.abs(delta) < 0.002 || Math.abs(delta) > 0.45) continue;
      _target.y += delta;
      _pole.set(sy, 0.05, cy);
      _handQ.fromArray(body.wq, bone.foot[i] * 4);
      this.reachLeg(i, _target, _pole, _handQ);
    }
  }

  /**
   * Postures the capture does not have, laid over it (vertical.js): hands on a rope or a ledge, arms spread in a wingsuit
   * or bent in a skydiver's arch, legs apart, then the whole body pitched and rolled about its hips.
   * o = { arms: 'spread'|'arch'|'up'|'rope'|'ledge'|'balance'|'toggles', toward: Vector3 (rope), brakeL / brakeR: 0..1
   * (toggles), legs: rad apart, sit: rad (thighs raised, knees bent: a harness), head: rad (chin up), pitch: rad (+ head
   * forward and down), roll: rad (about the spine), w: 0..1 }
   */
  overlay(o) {
    const { body, skeleton: sk } = this, { wp, wq } = body, { bone } = sk;
    const w = clamp(o.w ?? 1, 0, 1);
    if (w <= 0.001) return;
    const fwd = _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const left = _right.crossVectors(UP, fwd); // the body's left
    if (o.arms === 'hands') {
      // Each hand to its own world point, the elbow towards (px, py, pz) (gameplay.js getting into a car):
      // handL / handR = { x, y, z, w, px, py, pz }
      for (let i = 0; i < 2; i++) {
        const h = i === 0 ? o.handL : o.handR;
        if (!h || !(h.w > 0.001)) continue;
        _target.set(h.x, h.y, h.z);
        _pole.set(h.px ?? 0, h.py ?? -1, h.pz ?? 0);
        this.reach(i, _target, _pole, null, clamp(h.w * w, 0, 1));
      }
    } else if (o.arms) {
      const rope = o.arms === 'rope' && o.toward;
      for (let i = 0; i < 2; i++) {
        const sgn = i === 0 ? 1 : -1;
        const S = vset(_restP, wp, bone.upper[i]);
        const T = _target.copy(S), pole = _pole.set(0, -1, 0);
        switch (o.arms) {
          case 'spread': T.addScaledVector(left, sgn).addScaledVector(fwd, 0.12).y += 0.04; break;
          case 'arch': T.addScaledVector(left, sgn * 0.42).addScaledVector(fwd, 0.08).y += 0.42; pole.copy(left).multiplyScalar(sgn).y = -0.4; break;
          case 'up': T.addScaledVector(left, sgn * 0.07).addScaledVector(fwd, 0.16).y += 1; pole.copy(fwd).negate().addScaledVector(left, sgn * 0.6); break;
          case 'ledge': T.addScaledVector(left, sgn * 0.14).addScaledVector(fwd, 0.42).y += 0.3; pole.set(0, -1, 0).addScaledVector(fwd, -0.5); break;
          case 'balance': T.addScaledVector(left, sgn * 0.85).addScaledVector(fwd, 0.1).y -= 0.18; break;
          case 'toggles': {
            // hands up on the risers, pulled down to the hips with the brake on that side
            const b = clamp(i === 0 ? o.brakeL ?? 0 : o.brakeR ?? 0, 0, 1);
            T.addScaledVector(left, sgn * (0.2 + b * 0.06)).addScaledVector(fwd, 0.08 + b * 0.1).y += 0.55 - b * 0.95;
            pole.copy(left).multiplyScalar(sgn).y = -0.6;
            break;
          }
          case 'rope': {
            const R = vset(_aimP, wp, bone.upper[1]);
            _line.subVectors(rope, R).normalize();
            T.copy(R).addScaledVector(_line, i === 1 ? 0.58 : 0.34);
            if (i === 0) T.addScaledVector(left, 0.04);
            break;
          }
        }
        this.reach(i, T, pole, null, w);
      }
    }
    // Legs apart: each thigh swung out about the body's forward axis; seated: thighs raised, shins hanging back
    if (o.legs || o.sit) {
      const below = this.kit.belowThigh ??= bone.thigh.map((t) => sk.below(t));
      const belowCalf = this.kit.belowCalf ??= bone.calf.map((t) => sk.below(t));
      for (let i = 0; i < 2; i++) {
        if (o.legs) this.turn(bone.thigh[i], _q.setFromAxisAngle(fwd, (i === 0 ? 1 : -1) * o.legs * w));
        if (o.sit) this.turn(bone.thigh[i], _q.setFromAxisAngle(left, -o.sit * w));
        body.settle(bone.thigh[i], below[i]);
        if (o.sit) { this.turn(bone.calf[i], _q.setFromAxisAngle(left, o.sit * 1.1 * w)); body.settle(bone.calf[i], belowCalf[i]); }
      }
    }
    // Each foot to its own world ankle point (a leg into a car's footwell, a foot planted beside it): feet[i] = { x, y, z,
    // yaw, w, flat }: the knee forward of the foot's heading, the foot flat on the ground facing `yaw` by `flat` (else
    // carried round with the shin)
    if (o.feet) {
      for (let i = 0; i < 2; i++) {
        const f = o.feet[i];
        if (!f || !(f.w > 0.001)) continue;
        _target.set(f.x, f.y, f.z);
        _pole.set(Math.sin(f.yaw), 0.15, Math.cos(f.yaw));
        const flat = clamp(f.flat ?? 1, 0, 1), fw = clamp(f.w * w, 0, 1);
        const footQ = flat > 0.001 ? _handQ.setFromAxisAngle(UP, f.yaw).multiply(_q.fromArray(sk.bindQ, bone.foot[i] * 4)) : null;
        this.reachLeg(i, _target, _pole, footQ, fw, flat * fw);
      }
    }
    // Chin up: a body flying face down still looks where it goes
    if (o.head) {
      this.turn(bone.neck, _q.setFromAxisAngle(left, -o.head * 0.55 * w));
      body.settle(bone.neck, this.kit.belowNeck ??= sk.below(bone.neck));
      this.turn(bone.head, _q.setFromAxisAngle(left, -o.head * 0.45 * w));
      body.settle(bone.head, sk.belowHead);
    }
    // The whole body about the hips: leaned sideways (a harness swinging into a turn), pitched about its left axis, rolled
    // about its own spine
    if (o.pitch || o.roll || o.lean) {
      _q.setFromAxisAngle(fwd, (o.lean || 0) * w).multiply(_q2.setFromAxisAngle(left, (o.pitch || 0) * w)).multiply(_q3.setFromAxisAngle(UP, (o.roll || 0) * w));
      const P = vset(_top, wp, bone.pelvis);
      for (let i = 0; i < sk.count; i++) {
        vset(_p, wp, i).sub(P).applyQuaternion(_q).add(P);
        vput(wp, i, _p);
        qput(wq, i, qset(_q3, wq, i).premultiply(_q));
      }
    }
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
    // looking up bends the back, so does a shot coming back through the shoulders; the weight goes forward behind sights
    const bend = this.pitch * 0.45 + this.rock.x * 0.5 - this.lean * 0.5;
    if (Math.abs(this.twist) + Math.abs(bend) < 0.002) return;
    // shared along the back: two thirds of the way by the chest, the neck and head take the rest later
    _q.setFromAxisAngle(UP, this.twist * 0.5);
    this.turn(bone.spine1, _q);
    _a.set(Math.cos(this.yaw + this.twist), 0, -Math.sin(this.yaw + this.twist)); // across the chest, towards their left
    _q2.setFromAxisAngle(_a, -bend);
    this.turn(bone.spine1, _q2);
    body.settle(bone.spine1, belowSpine1);
    _q.setFromAxisAngle(UP, this.twist * 0.5);
    this.turn(bone.spine2, _q);
    _q2.setFromAxisAngle(_a, -bend);
    this.turn(bone.spine2, _q2);
    body.settle(bone.spine2, this.belowSpine2 ??= this.skeleton.below(bone.spine2));
  }

  // What the hands hold follows what is asked of them through a draw and a holster: `gunKind` is the weapon the right
  // hand is busy with, `swap` runs from 0 (on the body) to 1 (in the hands)
  equip(dt, kind) {
    if (kind && !HOLD[kind]) kind = null;
    if (this.swapDir === 0 && kind !== this.gunKind) {
      if (this.gunKind) this.swapDir = -1;
      else if (kind) { this.gunKind = kind; this.swap = 0; this.swapDir = 1; }
    }
    if (this.swapDir > 0 && kind !== this.gunKind) this.swapDir = -1; // changed their mind half-way
    else if (this.swapDir < 0 && kind === this.gunKind) this.swapDir = 1;
    if (!this.swapDir) return;
    this.swap += this.swapDir * dt / (HOLD[this.gunKind].draw * (this.swapDir < 0 ? 0.8 : 1));
    if (this.swap >= 1) { this.swap = 1; this.swapDir = 0; }
    else if (this.swap <= 0) { this.swap = 0; this.swapDir = 0; this.gunKind = null; }
  }

  // How this body holds a weapon: the shared entry, unless its own weapon of that kind is dressed otherwise
  holdFor(kind) { return this.holds?.[kind] ?? HOLD[kind]; }

  // At once, without the gesture: a spawn, someone who held it all along
  snapWeapon(kind) {
    this.gunKind = kind && HOLD[kind] ? kind : null;
    this.swap = this.gunKind ? 1 : 0;
    this.swapDir = 0;
  }

  // In the hands for good: it can fire
  get armed() { return !!this.gunKind && this.swap >= 1 && this.swapDir === 0; }

  /**
   * Where a weapon rests on the body (world): its position and rotation, and the point it swings through when drawn.
   * Works in every state of the body (a fall, a seat), since it only reads the solved bones.
   */
  slotPose(kind, P, Q, via = null) {
    const hold = HOLD[kind], slot = SLOTS[hold.slot];
    const sk = this.skeleton, { wp, wq, scale: s } = this.body;
    const b = slot.bone === 'thighR' ? sk.bone.thigh[1] : sk.bone[slot.bone];
    const surface = slot.surface ? (sk.surface?.[slot.surface] ?? SURFACE[slot.surface]) + slot.gap : 0;
    // the bone's turn since the bind pose carries bind-space offsets into the world
    _slotR.fromArray(wq, b * 4).multiply(_q.fromArray(sk.bindQ, b * 4).invert());
    Q.copy(_slotR).multiply(slot.q);
    _slotO.set(slot.at[0] + slot.out[0] * surface, slot.at[1] + slot.out[1] * surface, slot.at[2] + slot.out[2] * surface);
    P.copy(_slotO).multiplyScalar(s).applyQuaternion(_slotR);
    P.x += wp[b * 3]; P.y += wp[b * 3 + 1]; P.z += wp[b * 3 + 2];
    if (via) {
      via.set(_slotO.x + slot.via[0], _slotO.y + slot.via[1], _slotO.z + slot.via[2]).multiplyScalar(s).applyQuaternion(_slotR);
      via.x += wp[b * 3]; via.y += wp[b * 3 + 1]; via.z += wp[b * 3 + 2];
    }
    P.sub(_slotO.fromArray(hold.stow).applyQuaternion(Q));
    return slot;
  }

  upperBody(dt, rig) {
    const { body } = this;
    const { bone } = this.skeleton;
    const hold = this.gunKind ? this.holdFor(this.gunKind) : null;
    const gun = !!hold && hold.stance !== 'thrown';
    const rifle = gun && hold.stance === 'rifle';
    const target = gun && rig.aim && rig.aim.y !== undefined ? rig.aim : null;
    this.shotAge += dt;
    this.aimShoulder += ((rig.aim?.shoulder === -1 ? -1 : 1) - this.aimShoulder) * ease(dt, 0.09);
    this.aimW += ((target ? 1 : 0) - this.aimW) * ease(dt, target ? 0.065 : 0.15);
    this.ready += ((gun && (target || (rig.gunReady ?? rig.combatReady)) ? 1 : 0) - this.ready) * ease(dt, 0.11);
    this.lean += ((target ? (rifle ? 0.2 : 0.1) : 0) - this.lean) * ease(dt, 0.12);
    this.cheek = rifle ? smooth(this.aimW) : 0;
    spring(this.kickS, hold?.kick?.[2] ?? 24, dt);
    spring(this.rock, 11, dt);
    this.hasGun = !!hold && this.swap > 0;
    this.gunOut = false;

    // Aim direction from the base of the neck
    let want = null;
    if (target) {
      vset(_a, body.wp, bone.neck);
      const dx = target.x - _a.x, dy = target.y - _a.y, dz = target.z - _a.z;
      // a long gun turns the left shoulder towards the target, so the left hand reaches the fore-end
      want = { yaw: Math.atan2(dx, dz) - (rifle ? RIFLE_BLADE : 0), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
      // the muzzle trails a fast turn of the eyes, then catches up
      if (dt > 0) {
        const yaw = Math.atan2(dx, dz);
        const rate = this.lastAimYaw === null ? 0 : clamp(wrap(yaw - this.lastAimYaw) / dt, -6, 6);
        this.lastAimYaw = yaw;
        this.lag += (-rate * 0.03 - this.lag) * ease(dt, 0.07);
      }
    } else { this.lastAimYaw = null; this.lag *= Math.exp(-dt * 12); }
    this.orient(dt, rig, want);

    const closed = hold && this.swap > 0.3 ? 1 : 0;
    this.grip[1] += (closed - this.grip[1]) * ease(dt, closed ? 0.05 : 0.1);
    if (!hold) {
      this.grip[0] += (0 - this.grip[0]) * ease(dt, 0.1);
      this.trigger = 0;
      if (rig.punch > 0.01) { this.clench(rig.punchSide, 'fist', Math.min(1, rig.punch * 3)); body.solve(); }
      return;
    }
    if (!gun) {
      // thrown things: out of the pocket and into a closed hand
      this.grip[0] += (0 - this.grip[0]) * ease(dt, 0.1);
      this.clench(1, 'fist', 0.7 * this.grip[1]);
      body.settle(bone.hand[1], this.skeleton.belowHand[1]);
      this.placeInHand(hold, this.gunP, this.gunQ);
      this.gunOut = this.swap > 0.5;
      return;
    }
    // the finger stays off the trigger until the sights are on something
    this.trigger += ((this.aimW > 0.55 || this.shotAge < 0.5 ? 1 : 0) - this.trigger) * ease(dt, 0.06);
    this.clench(1, 'indexed', this.grip[1]);
    if (this.trigger > 0.01) this.clench(1, 'pistol', this.grip[1] * this.trigger);
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

  // The weapon where the right hand already is: hanging at their side, swinging with the arm
  placeInHand(hold, P, Q) {
    const { body } = this;
    const { bone } = this.skeleton;
    const frame = this.kit.hands[1];
    qset(_q2, body.wq, bone.hand[1]).multiply(_q.copy(frame.bind).invert());
    const f = _a.copy(frame.f).applyQuaternion(_q2);
    const n = _c.copy(frame.n).applyQuaternion(_q2);
    const a = _b.copy(frame.a).applyQuaternion(_q2);
    // the inverse of what holdGun does: the barrel above the line of the knuckles, a long gun drooping further
    const z = _d.copy(f).addScaledVector(a, hold.tilt ?? GUN_LIFT).normalize();
    const y = _e.copy(a).addScaledVector(z, -a.dot(z)).normalize();
    const x = _f.crossVectors(y, z);
    frameQuat(x, y, z, Q);
    vset(_p, body.wp, bone.hand[1]);
    _p.addScaledVector(f, frame.length * PALM_ALONG * body.scale).addScaledVector(n, PALM_OFF * body.scale);
    _g.fromArray(hold.grip).applyQuaternion(Q);
    P.copy(_p).sub(_g);
  }

  // The frame of a weapon whose barrel runs along `z` (kept upright), into Q
  barrelFrame(z, Q) {
    _gz.copy(z).normalize();
    _gx.crossVectors(UP, _gz).normalize();
    _gy.crossVectors(_gz, _gx);
    return frameQuat(_gx, _gy, _gz, Q);
  }

  holdGun(dt, rig, hold, want) {
    const { body } = this;
    const { bone } = this.skeleton;
    const s = body.scale;
    const rifle = hold.stance === 'rifle';
    const frame = this.kit.hands[1];
    const yawC = this.yaw + this.twist;
    _fwd.set(Math.sin(yawC), 0, Math.cos(yawC));
    _right.set(-_fwd.z, 0, _fwd.x);
    const kr = smooth(this.ready), ka = want ? smooth(this.aimW) : 0;
    const P = _stP, Q = _stQ;

    // Carried: the weapon goes where the hand swings, but nobody waves a muzzle about with every step. It stays low and
    // ahead while the wrist gives, and the weight of a long gun quietens the arm that carries it.
    this.placeInHand(hold, P, Q);
    _target.fromArray(hold.grip).applyQuaternion(Q).add(P);
    if (rifle) {
      vset(_restP, body.wp, bone.pelvis).addScaledVector(_right, 0.27 * s).addScaledVector(_fwd, 0.05 * s);
      _restP.y -= 0.12 * s;
      _target.lerp(_restP, 0.55);
    }
    const sway = Math.sin(this.phase * Math.PI * 2) * 0.05 * this.moving;
    this.barrelFrame(_line.copy(_fwd).multiplyScalar(0.46 + sway).addScaledVector(_right, 0.05).setY(-0.88), _restQ);
    Q.slerp(_restQ, rifle ? 1 : 0.6);
    P.copy(_target).sub(_c.fromArray(hold.grip).applyQuaternion(Q));

    // Ready: both hands on it, muzzle low, a step from the sights
    if (kr > 0.001) {
      if (rifle) {
        // the stock under the collar bone, the barrel across the body towards their left foot
        this.barrelFrame(_line.copy(_fwd).multiplyScalar(0.8).addScaledVector(_right, -0.3).setY(-0.52), _restQ);
        vset(_restP, body.wp, bone.upper[1]).addScaledVector(_fwd, 0.07 * s).addScaledVector(_right, -0.06 * s);
        _restP.y -= 0.1 * s;
        _restP.sub(_c.fromArray(hold.butt).applyQuaternion(_restQ));
      } else {
        // a handgun pressed out from the chest, close, pointing at the ground ahead
        this.barrelFrame(_line.copy(_fwd).multiplyScalar(0.84).addScaledVector(_right, -0.08).setY(-0.54), _restQ);
        vset(_restP, body.wp, bone.spine2).addScaledVector(_fwd, 0.36 * s).addScaledVector(_right, 0.02 * s);
        _restP.y -= 0.07 * s;
        _restP.sub(_c.fromArray(hold.grip).applyQuaternion(_restQ));
      }
      P.lerp(_restP, kr);
      Q.slerp(_restQ, kr);
    }

    // Aimed: the sights between the eye and the target
    if (ka > 0.001) {
      _aim.set(rig.aim.x, rig.aim.y, rig.aim.z);
      vset(_b, body.wp, bone.neck);
      const yaw = Math.atan2(_aim.x - _b.x, _aim.z - _b.z);
      _across.set(-Math.cos(yaw), 0, Math.sin(yaw));
      _line.subVectors(_aim, _b).normalize();
      _top.crossVectors(_across, _line).negate().normalize();
      if (_top.y < 0) _top.negate();
      if (rifle) {
        // the stock in the pocket of the shoulder, the comb under the cheek
        vset(_aimP, body.wp, bone.upper[1]).addScaledVector(_line, 0.035 * s).addScaledVector(_top, 0.045 * s).addScaledVector(_across, -0.045 * s);
        const opposite = (1 - this.aimShoulder) * 0.5;
        _aimP.addScaledVector(_line, opposite * 0.075 * s).addScaledVector(_top, opposite * 0.025 * s).addScaledVector(_across, -opposite * 0.15 * s);
        // that is where the butt goes; the weapon hangs off it along the line of sight
        _aimP.sub(_c.fromArray(hold.butt).applyQuaternion(this.barrelFrame(_line, _aimQ)));
      } else {
        // arms pushed out, the sights level with the eye on the camera's side
        // (over the left shoulder the hands cross to the left eye, far enough to show past the head from that side)
        const sh = this.aimShoulder;
        _aimP.copy(_b).addScaledVector(_line, 0.5 * s).addScaledVector(_top, (0.115 - hold.sight) * s).addScaledVector(_across, (0.02 + (sh > 0 ? 0.045 : 0.19) * sh) * s);
      }
      // the walk comes up through the arms, and nobody holds a weapon perfectly still
      const step = this.phase * Math.PI * 2, t = this.time;
      _aimP.addScaledVector(_top, (Math.sin(step * 2) * 0.006 * this.moving + Math.sin(t * 1.7) * 0.0012) * s)
        .addScaledVector(_across, (Math.sin(step) * 0.005 * this.moving + Math.sin(t * 1.13 + 2) * 0.0015) * s);
      this.barrelFrame(_line.subVectors(_aim, _aimP), _aimQ);
      if (Math.abs(this.lag) > 1e-4) _aimQ.premultiply(_q.setFromAxisAngle(UP, this.lag));
      P.lerp(_aimP, ka);
      Q.slerp(_aimQ, ka);
    }

    // The shot: back into the hands, the muzzle up, and round again
    const kick = this.kickS.x;
    if (Math.abs(kick) > 0.0005) {
      const k = hold.kick, held = Math.max(kr, ka);
      _gz.set(0, 0, 1).applyQuaternion(Q);
      _gx.set(1, 0, 0).applyQuaternion(Q);
      P.addScaledVector(_gz, -k[0] * kick * s * held);
      Q.premultiply(_q.setFromAxisAngle(_gx, -k[1] * kick * held)).premultiply(_q.setFromAxisAngle(UP, k[1] * 0.3 * kick * this.kickSide * held));
    }
    if (rig.reloading >= 0) {
      // Bring the well into view while the support hand changes the magazine, then shoulder the weapon again.
      const t = clamp(rig.reloading, 0, 1);
      const cant = Math.sin(Math.min(1, t / 0.18) * Math.PI / 2) * (1 - Math.max(0, (t - 0.78) / 0.22));
      P.y -= 0.075 * cant * s;
      Q.multiply(_q.setFromAxisAngle(AZ, -0.36 * cant));
      Q.multiply(_q.setFromAxisAngle(_a.set(1, 0, 0), -0.16 * cant));
    }

    // Between the body and the hands: the hand goes to the weapon where it is stowed, then brings it round
    const u = this.swap;
    const two = Math.max(kr, ka);
    let right = 1, left = two;
    if (u < 1) {
      const slot = this.slotPose(this.gunKind, _slotP, _slotQ, _viaP);
      const v = smooth((u - 0.2) / 0.8), a = (1 - v) * (1 - v), b = 2 * (1 - v) * v, c = v * v;
      this.gunP.set(_slotP.x * a + _viaP.x * b + P.x * c, _slotP.y * a + _viaP.y * b + P.y * c, _slotP.z * a + _viaP.z * b + P.z * c);
      this.gunQ.copy(_slotQ).slerp(Q, smooth(v));
      right = smooth(u / 0.34);
      left = two * smooth((v - 0.6) / 0.4);
      this.gunOut = !slot.hidden || v > 0.03;
    } else {
      this.gunP.copy(P);
      this.gunQ.copy(Q);
      this.gunOut = true;
    }

    // Hands onto the weapon
    _gx.set(1, 0, 0).applyQuaternion(this.gunQ);
    _gy.set(0, 1, 0).applyQuaternion(this.gunQ);
    _gz.set(0, 0, 1).applyQuaternion(this.gunQ);
    // one hand lets a long gun droop off the forearm; two hands square the wrist up behind it
    const lift = (hold.tilt ?? GUN_LIFT) + (GUN_LIFT - (hold.tilt ?? GUN_LIFT)) * two;
    _fingers.copy(_gz).addScaledVector(_gy, -lift).normalize();
    this.handFacing(1, _fingers, _gy, _handQ);
    // the palm of the right hand faces left, against the grip
    _target.fromArray(hold.grip).applyQuaternion(this.gunQ).add(this.gunP).addScaledVector(_fingers, -frame.length * PALM_ALONG * s).addScaledVector(_gx, -PALM_OFF * s);
    // elbow out to their right and down; reaching behind the back it goes up and out instead
    const behind = u < 1 ? 1 - smooth((u - 0.2) / 0.5) : 0;
    const out = (rifle ? 0.55 : 0.5) * (0.5 + 0.5 * two);
    _pole.set(-Math.cos(yawC) * out, -1 + behind * 0.6 + (1 - two) * 0.5, Math.sin(yawC) * out).addScaledVector(_fwd, -behind * 0.9 - (1 - two) * 0.7);
    this.reach(1, _target, _pole, _handQ, right);
    if (left > 0.001) this.leftHand(rig, hold, left, yawC);
    else this.grip[0] += (0 - this.grip[0]) * ease(dt, 0.1);
  }

  // Uses the weapon's axes (_gx, _gy, _gz) set by holdGun
  leftHand(rig, hold, weight, yawC) {
    const { body } = this;
    const { bone, belowHand } = this.skeleton;
    const s = body.scale;
    const frame = this.kit.hands[0];
    if (hold.fore) {
      _target.fromArray(hold.fore).applyQuaternion(this.gunQ).add(this.gunP);
      // the hand rides the slide of a pump as it is worked
      if (hold.pump) _target.addScaledVector(_gz, -hold.pump * clamp(1 - Math.abs(this.shotAge - 0.26) / 0.16, 0, 1));
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
      const t = clamp(rig.reloading, 0, 1);
      // Touch the magazine first, pull it clear, reach the belt and insert. The final short reach works
      // the action before returning to the fore-end; it no longer performs one unexplained sinusoidal dip.
      _restP.fromArray(hold.magazine || hold.grip).applyQuaternion(this.gunQ).add(this.gunP);
      _restP.addScaledVector(_gy, -Math.max(0, Math.min(1, (t - 0.13) / 0.13, (0.71 - t) / 0.13)) * 0.16);
      const contact = clamp(t / 0.13, 0, 1) * (1 - clamp((t - 0.73) / 0.22, 0, 1));
      _target.lerp(_restP, contact);
      vset(_restP, body.wp, bone.pelvis).addScaledVector(_b.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), 0.18 * s);
      _restP.y += 0.03;
      const belt = Math.max(0, Math.min(1, (t - 0.27) / 0.10, (0.57 - t) / 0.12));
      _target.lerp(_restP, belt);
      if (t > 0.78 && t < 0.94) {
        _restP.set(-0.035, 0.04, hold.grip[2] + 0.045).applyQuaternion(this.gunQ).add(this.gunP);
        _target.lerp(_restP, Math.sin((t - 0.78) / 0.16 * Math.PI));
      }
    }
    if (hold.fore) {
      // a long fore-end held low is further than the arm is long: the hand takes it nearer the receiver instead of
      // stopping short in the air
      const { upper, fore, hand } = bone;
      const arm = (Math.hypot(body.wp[upper[0] * 3] - body.wp[fore[0] * 3], body.wp[upper[0] * 3 + 1] - body.wp[fore[0] * 3 + 1], body.wp[upper[0] * 3 + 2] - body.wp[fore[0] * 3 + 2])
        + Math.hypot(body.wp[fore[0] * 3] - body.wp[hand[0] * 3], body.wp[fore[0] * 3 + 1] - body.wp[hand[0] * 3 + 1], body.wp[fore[0] * 3 + 2] - body.wp[hand[0] * 3 + 2])) * 0.97;
      vset(_restP, body.wp, upper[0]);
      for (let k = 0; k < 8 && _target.distanceTo(_restP) > arm; k++) _target.addScaledVector(_gz, -0.02);
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
    // the chest leaning onto the sights must not take the eyes down with it
    this.lookPitch += (clamp(pitch - this.pitch * 0.45 + this.lean * 0.9, -0.6, 0.6) - this.lookPitch) * ease(dt, 0.09);
    if (Math.abs(this.lookYaw) + Math.abs(this.lookPitch) + this.cheek < 0.003) return;
    _q.setFromAxisAngle(UP, this.lookYaw);
    this.turn(bone.head, _q);
    _a.set(Math.cos(chest + this.lookYaw), 0, -Math.sin(chest + this.lookYaw));
    _q.setFromAxisAngle(_a, -this.lookPitch);
    this.turn(bone.head, _q);
    // cheek on the stock: the head tips towards the shoulder that holds it
    if (this.cheek > 0.003) {
      _b.set(Math.sin(chest + this.lookYaw), 0, Math.cos(chest + this.lookYaw));
      this.turn(bone.head, _q.setFromAxisAngle(_b, 0.16 * this.cheek * this.aimShoulder));
    }
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

  // A shot leaves through the hands: `amount` 1 is this weapon's own kick, more for a hot burst
  kick(amount = 1) {
    const hold = this.gunKind ? HOLD[this.gunKind] : null;
    const omega = hold?.kick?.[2] ?? 24;
    this.kickS.v = Math.min(this.kickS.v + amount * omega * Math.E, 2.2 * omega * Math.E);
    this.kickSide = Math.random() * 2 - 1;
    this.rock.v += (hold?.kick?.[3] ?? 0.01) * amount * 11 * Math.E;
    this.shotAge = 0;
  }

  // World point of the barrel's end
  muzzle(hold, out) {
    return out.fromArray(hold.muzzle).multiplyScalar(this.gunScale ?? 1).applyQuaternion(this.gunQ).add(this.gunP);
  }

  // Any point of the weapon in hand (weapon space) in the world
  gunPoint(point, out) { return out.fromArray(point).applyQuaternion(this.gunQ).add(this.gunP); }
}

export { BodyDriver, HOLD, SLOTS };

