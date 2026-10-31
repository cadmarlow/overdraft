import * as THREE from 'three/webgpu';
import { Fn, float, int, vec3, attribute, instanceIndex, normalLocal, cross, normalize, step } from 'three/tsl';

// The crowd: real avatars reposed on the game's skeleton (tools/people/import-crowd.mjs), instanced, skinned with up to four
// bones from the pose buffer, painted from one atlas each.

// Bodies by file: men, then women. A person picks among the ones of their sex (PersonRig)
const MALE_BODIES = 12;
const FEMALE_BODIES = 12;
const CROWD_BODIES = [
  ...Array.from({ length: MALE_BODIES }, (_, i) => `m${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: FEMALE_BODIES }, (_, i) => `f${String(i + 1).padStart(2, '0')}`)
];
// Held in the hand (one set per sex, their arms differ) or worn. The order is that of PROP in pedestrians.js, then the women's set
const CROWD_PROPS = ['held-phone-m', 'held-coffee-m', 'held-umbrella-m', 'prop-bag', 'prop-backpack', 'held-phone-f', 'held-coffee-f', 'held-umbrella-f'];

const qrot = (q, v) => v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2.0));

// Skinned from the pose buffer: `stride` vec4s per person, each bone a rotation then a position and scale
function skinnedPosition(pose, stride, inflate) {
  const base = int(instanceIndex).mul(stride);
  const info = pose.element(base.add(stride - 1)); // seed, female, girth, hair
  return Fn(() => {
    const index = attribute('skinIndex', 'uvec4');
    const weight = attribute('skinWeight', 'vec4');
    const normal = attribute('normal', 'vec3');
    const p = attribute('position', 'vec3').add(vec3(normal.x, 0, normal.z).mul(info.z.sub(1)).mul(inflate));
    const out = vec3(0).toVar();
    const n = vec3(0).toVar();
    for (const c of ['x', 'y', 'z', 'w']) {
      const at = base.add(int(index[c]).mul(2));
      const q = pose.element(at), t = pose.element(at.add(1));
      out.addAssign(qrot(q, p).mul(t.w).add(t.xyz).mul(weight[c]));
      n.addAssign(qrot(q, normal).mul(weight[c]));
    }
    normalLocal.assign(normalize(n));
    return out;
  })();
}

/** A body's painted atlas, on the pose buffer */
function createCrowdMaterial(pose, stride, atlas) {
  // little specular: hair is flat cards, which would mirror the sky
  const mat = new THREE.MeshPhysicalNodeMaterial({ map: atlas, metalness: 0, roughness: 0.72, specularIntensity: 0.35 });
  mat.alphaTest = 0.4;
  mat.positionNode = skinnedPosition(pose, stride, 0.03);
  return mat;
}

/** Things they carry: one flat colour per part, painted by the sculpting tool */
function createPropMaterial(pose, stride) {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.55 });
  mat.positionNode = skinnedPosition(pose, stride, 0);
  const part = attribute('part', 'float');
  // phone and cup bright, umbrella and bags dark
  const tone = float(0.06).add(step(1.5, part).mul(step(part, 2.5)).mul(0.62));
  mat.colorNode = vec3(tone, tone, tone.mul(1.04));
  return mat;
}

export { createCrowdMaterial, createPropMaterial, CROWD_BODIES, CROWD_PROPS, MALE_BODIES, FEMALE_BODIES };
