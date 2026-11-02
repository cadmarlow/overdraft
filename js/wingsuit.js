import * as THREE from 'three/webgpu';

// The wingsuit's fabric (its flight lives in air-physics.js). Three panels stretched over the hero's skeleton every
// frame: an arm wing on each side, from the shoulder along the arm to the wrist and back down to the hip, and a tail
// wing between the legs from the crotch to the ankles. The air below inflates them into a curve, and at speed their
// trailing edges flutter.

const ARM_U = 9, ARM_V = 6, TAIL_U = 7, TAIL_V = 6;
// a suit that reads against dark roofs and the sky: lime wings, a graphite leading edge, a white band
const GRAPHITE = new THREE.Color(0x1d2125), STRIPE = new THREE.Color(0x1d2125), PALE = new THREE.Color(0xf2f3ef), WING = new THREE.Color(0xc9e46a);

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _n = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();

// A (nu + 1) x (nv + 1) grid of vertices, two triangles per cell, appended to the index list
function grid(indices, base, nu, nv) {
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) {
      const a = base + v * (nu + 1) + u, b = a + 1, c = a + nu + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
}

function createWingsuitMesh(scene) {
  const arm = (ARM_U + 1) * (ARM_V + 1), tail = (TAIL_U + 1) * (TAIL_V + 1);
  const count = arm * 2 + tail;
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const indices = [];
  grid(indices, 0, ARM_U, ARM_V);
  grid(indices, arm, ARM_U, ARM_V);
  grid(indices, arm * 2, TAIL_U, TAIL_V);
  // colours: graphite, a lime leading edge, a pale band towards the wrist
  const paint = (i, u, v, leading) => {
    let c = WING;
    if (v < 0.16 && leading) c = STRIPE;
    else if (u > 0.6 && u < 0.7) c = PALE;
    colors.set([c.r, c.g, c.b], i * 3);
  };
  for (let s = 0; s < 2; s++) for (let v = 0; v <= ARM_V; v++) for (let u = 0; u <= ARM_U; u++) paint(s * arm + v * (ARM_U + 1) + u, u / ARM_U, v / ARM_V, true);
  for (let v = 0; v <= TAIL_V; v++) for (let u = 0; u <= TAIL_U; u++) {
    const i = arm * 2 + v * (TAIL_U + 1) + u;
    const c = v > 0.84 * TAIL_V ? PALE : v < 0.2 * TAIL_V ? GRAPHITE : WING;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.04, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Wingsuit';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);

  const joint = (wp, i, out) => out.set(wp[i * 3], wp[i * 3 + 1], wp[i * 3 + 2]);
  const J = {};
  for (const name of ['shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'pelvis', 'chest']) J[name] = new THREE.Vector3();

  /**
   * Stretches the fabric over the current pose. `wp`: world joint positions, `bone`: skeleton indices; `inflate`: how
   * full the air holds it (0 folded .. 1); `flutter`: amplitude of the trailing edges' flapping; `t`: time (s).
   */
  mesh.fit = (wp, bone, inflate = 1, flutter = 0, t = 0) => {
    if (!Number.isFinite(wp[bone.pelvis * 3] + wp[bone.hand[0] * 3] + wp[bone.foot[1] * 3 + 1])) return; // not posed yet
    for (const [s, side] of [['L', 0], ['R', 1]]) {
      joint(wp, bone.upper[side], J[`shoulder${s}`]);
      joint(wp, bone.fore[side], J[`elbow${s}`]);
      joint(wp, bone.hand[side], J[`wrist${s}`]);
      joint(wp, bone.thigh[side], J[`hip${s}`]);
      joint(wp, bone.calf[side], J[`knee${s}`]);
      joint(wp, bone.foot[side], J[`ankle${s}`]);
    }
    joint(wp, bone.pelvis, J.pelvis);
    joint(wp, bone.spine2, J.chest);
    // the body's back: the side the air pushes the fabric towards
    const across = _a.subVectors(J.shoulderL, J.shoulderR), along = _b.subVectors(J.chest, J.pelvis);
    const back = _n.crossVectors(along, across);
    if (back.lengthSq() < 1e-10) back.set(0, 1, 0); else back.normalize();
    const billow = 0.11 * inflate;
    let o = 0;
    const put = (p) => { positions[o++] = p.x; positions[o++] = p.y; positions[o++] = p.z; };
    for (const s of ['L', 'R']) {
      const sh = J[`shoulder${s}`], el = J[`elbow${s}`], wr = J[`wrist${s}`];
      // the wing's root runs down the side of the body to a little past the hip
      const root = _c.copy(J[`hip${s}`]).lerp(J[`knee${s}`], 0.22);
      for (let v = 0; v <= ARM_V; v++) {
        for (let u = 0; u <= ARM_U; u++) {
          const fu = u / ARM_U, fv = v / ARM_V;
          // leading edge: along the arm; trailing edge: wrist back to the root, drawn in towards the arm
          if (fu < 0.5) _p.copy(sh).lerp(el, fu * 2); else _p.copy(el).lerp(wr, fu * 2 - 1);
          _q.copy(root).lerp(wr, fu);
          _d.subVectors(_p, _q).multiplyScalar(0.2 * Math.sin(Math.PI * fu));
          _q.add(_d);
          _p.lerp(_q, fv);
          const lift = billow * Math.pow(Math.sin(Math.PI * fu), 0.8) * Math.sin(Math.PI * fv);
          const flap = flutter * Math.sin(t * 41 + fu * 9 + (s === 'L' ? 0 : 1.7)) * Math.pow(Math.max(0, fv - 0.6) / 0.4, 2) * Math.sin(Math.PI * fu);
          _p.addScaledVector(back, lift + flap);
          put(_p);
        }
      }
    }
    // tail wing: left leg to right leg, crotch to ankles, the trailing edge cut in between the feet
    for (let v = 0; v <= TAIL_V; v++) {
      const fv = v / TAIL_V;
      _a.copy(J.hipL).lerp(J.ankleL, fv);
      _b.copy(J.hipR).lerp(J.ankleR, fv);
      for (let u = 0; u <= TAIL_U; u++) {
        const fu = u / TAIL_U;
        _p.copy(_a).lerp(_b, fu);
        const middle = Math.sin(Math.PI * fu);
        if (fv < 0.2) _p.lerp(J.pelvis, middle * (0.2 - fv) * 2);
        _p.lerp(J.pelvis, middle * Math.pow(fv, 4) * 0.28);
        const lift = billow * 0.7 * middle * Math.sin(Math.PI * fv);
        const flap = flutter * 0.8 * Math.sin(t * 47 + fu * 7) * Math.pow(Math.max(0, fv - 0.6) / 0.4, 2) * middle;
        _p.addScaledVector(back, lift + flap);
        put(_p);
      }
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    mesh.updateMatrixWorld();
  };
  return mesh;
}

export { createWingsuitMesh };
