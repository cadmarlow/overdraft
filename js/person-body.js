import * as THREE from 'three/webgpu';
import { mocap } from './mocap.js';

// The skeleton of a real person: rotations local to each parent, turned into world transforms and then skin matrices.
// Bones come parents first, so one pass poses them all. Inverse kinematics and retargeting work on the world transforms.

function qmul(a, ao, b, bo, out, oo) {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3], bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  out[oo] = ax * bw + aw * bx + ay * bz - az * by;
  out[oo + 1] = ay * bw + aw * by + az * bx - ax * bz;
  out[oo + 2] = az * bw + aw * bz + ax * by - ay * bx;
  out[oo + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

function qrot(q, qo, v, vo, out, oo) {
  const x = v[vo], y = v[vo + 1], z = v[vo + 2], qx = q[qo], qy = q[qo + 1], qz = q[qo + 2], qw = q[qo + 3];
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  out[oo] = ix * qw - iw * qx - iy * qz + iz * qy;
  out[oo + 1] = iy * qw - iw * qy - iz * qx + ix * qz;
  out[oo + 2] = iz * qw - iw * qz - ix * qy + iy * qx;
}

class Skeleton {
  constructor(person) {
    const n = person.bones.length;
    this.count = n;
    this.parent = Int16Array.from(person.bones, (b) => b.parent);
    this.index = new Map(person.bones.map((b, i) => [b.name, i]));
    this.bindP = new Float32Array(n * 3);
    this.bindQ = new Float32Array(n * 4);
    this.localP = new Float32Array(n * 3); // where each bone sits on its parent
    this.localQ = new Float32Array(n * 4); // its rotation there in the bind pose
    const conj = new Float32Array(4), d = new Float32Array(3);
    for (let i = 0; i < n; i++) {
      this.bindP.set(person.bind.subarray(i * 7, i * 7 + 3), i * 3);
      this.bindQ.set(person.bind.subarray(i * 7 + 3, i * 7 + 7), i * 4);
      const p = this.parent[i];
      if (p < 0) { this.localP.set(this.bindP.subarray(i * 3, i * 3 + 3), i * 3); this.localQ.set(this.bindQ.subarray(i * 4, i * 4 + 4), i * 4); continue; }
      conj[0] = -this.bindQ[p * 4]; conj[1] = -this.bindQ[p * 4 + 1]; conj[2] = -this.bindQ[p * 4 + 2]; conj[3] = this.bindQ[p * 4 + 3];
      qmul(conj, 0, this.bindQ, i * 4, this.localQ, i * 4);
      for (let c = 0; c < 3; c++) d[c] = this.bindP[i * 3 + c] - this.bindP[p * 3 + c];
      qrot(conj, 0, d, 0, this.localP, i * 3);
    }
    this.clipBone = Int16Array.from(mocap.bones, (name) => this.index.get(name) ?? -1);
    this.inverse = [];
    const m = new THREE.Matrix4(), t = new THREE.Vector3(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < n; i++) this.inverse.push(m.compose(t.fromArray(this.bindP, i * 3), q.fromArray(this.bindQ, i * 4), one).clone().invert());
    const at = (name) => this.index.get(name);
    const both = (name) => [at(`L_${name}`), at(`R_${name}`)];
    this.bone = {
      pelvis: at('Pelvis'), spine: at('Spine'), spine1: at('Spine1'), spine2: at('Spine2'), neck: at('Neck'), head: at('Head'),
      clavicle: both('Clavicle'), upper: both('UpperArm'), fore: both('Forearm'), hand: both('Hand'),
      thigh: both('Thigh'), calf: both('Calf'), foot: both('Foot'), toe: both('Toe0'),
      eye: [at('LEye'), at('REye')], lidTop: [at('LEyeBlinkTop'), at('REyeBlinkTop')], lidBottom: [at('LEyeBlinkBottom'), at('REyeBlinkBottom')],
      jaw: at('MJaw')
    };
    // Everything hanging from a bone, in solving order
    this.below = (root) => {
      const inside = new Set([root]), list = [];
      for (let i = 0; i < n; i++) if (i !== root && inside.has(this.parent[i])) { inside.add(i); list.push(i); }
      return list;
    };
    this.belowHand = this.bone.hand.map(this.below);
    this.belowHead = this.below(this.bone.head);
    this.belowSpine1 = this.below(this.bone.spine1);
    this.legLength = this.bindP[this.bone.thigh[0] * 3 + 1]; // hip to the ground
    this.fingers = ['L', 'R'].map((side) => [0, 1, 2, 3, 4].map((f) => [`${side}_Finger${f}`, `${side}_Finger${f}1`, `${side}_Finger${f}2`].map(at)));
  }

  // Bind-pose position of a bone
  pointOf(i, out) { return out.fromArray(this.bindP, i * 3); }
}

const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _conj = new Float32Array(4);

class Body {
  constructor(skeleton) {
    this.skeleton = skeleton;
    const n = skeleton.count;
    this.q = skeleton.localQ.slice(); // local rotation of every bone, the pelvis's being in the body's own space
    this.wp = new Float32Array(n * 3);
    this.wq = new Float32Array(n * 4);
    this.root = new Float32Array([0, 0, 0]); // where the body stands
    this.rootQ = new Float32Array([0, 0, 0, 1]); // its heading
    this.pelvis = skeleton.localP.slice(0, 3); // pelvis in the body's own space (metres, before scale)
    this.scale = 1;
  }

  // Wears a pose sampled from a clip
  wear(pose) {
    const map = this.skeleton.clipBone;
    for (let i = 0; i < map.length; i++) {
      const b = map[i];
      if (b < 0) continue;
      this.q[b * 4] = pose[i * 4]; this.q[b * 4 + 1] = pose[i * 4 + 1]; this.q[b * 4 + 2] = pose[i * 4 + 2]; this.q[b * 4 + 3] = pose[i * 4 + 3];
    }
    const o = map.length * 4;
    this.pelvis[0] = pose[o]; this.pelvis[1] = pose[o + 1]; this.pelvis[2] = pose[o + 2];
  }

  // World transforms of every bone from `from` on
  solve(from = 0) {
    const { parent, localP, count } = this.skeleton, { q, wp, wq, rootQ, root, scale } = this;
    for (let i = from; i < count; i++) {
      const p = parent[i];
      if (p < 0) {
        qmul(rootQ, 0, q, i * 4, wq, i * 4);
        qrot(rootQ, 0, this.pelvis, 0, wp, i * 3);
        for (let c = 0; c < 3; c++) wp[i * 3 + c] = wp[i * 3 + c] * scale + root[c];
        continue;
      }
      qmul(wq, p * 4, q, i * 4, wq, i * 4);
      qrot(wq, p * 4, localP, i * 3, wp, i * 3);
      for (let c = 0; c < 3; c++) wp[i * 3 + c] = wp[i * 3 + c] * scale + wp[p * 3 + c];
    }
  }

  // Local rotations of a bone from the world rotation it was given, then everything hanging from it
  settle(i, list) {
    const { q, wq, wp, scale } = this, { parent, localP } = this.skeleton;
    const p = parent[i];
    _conj[0] = -wq[p * 4]; _conj[1] = -wq[p * 4 + 1]; _conj[2] = -wq[p * 4 + 2]; _conj[3] = wq[p * 4 + 3];
    qmul(_conj, 0, wq, i * 4, q, i * 4);
    if (list) for (const b of list) {
      const a = parent[b];
      qmul(wq, a * 4, q, b * 4, wq, b * 4);
      qrot(wq, a * 4, localP, b * 3, wp, b * 3);
      for (let c = 0; c < 3; c++) wp[b * 3 + c] = wp[b * 3 + c] * scale + wp[a * 3 + c];
    }
  }

  // Into three's bones, ready for skinning
  write(bones) {
    const { wp, wq, scale } = this;
    _s.setScalar(scale);
    for (let i = 0; i < bones.length; i++) bones[i].matrixWorld.compose(_t.fromArray(wp, i * 3), _q.fromArray(wq, i * 4), _s);
  }
}

export { Skeleton, Body, qmul, qrot };
