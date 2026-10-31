import { BONE, BONE_COUNT, LIMB, SIDES, bindJointPositions } from '../../js/human-skeleton.js';

// Bone weights from the bind pose: a vertex follows the bones nearest to it, among those its body region allows.

function segments(female) {
  const j = bindJointPositions(female);
  const s = [];
  const add = (bone, a, b) => { s[bone] = { a, b }; };
  add(BONE.PELVIS, [0, 0.9, 0], [0, 1.06, 0]);
  add(BONE.SPINE, [0, 1.06, 0], [0, 1.19, -0.01]);
  add(BONE.CHEST, [0, 1.19, -0.01], [0, 1.46, -0.02]);
  add(BONE.NECK, j[BONE.NECK], j[BONE.HEAD]);
  add(BONE.HEAD, j[BONE.HEAD], [0, 1.75, 0]);
  SIDES.forEach((side, k) => {
    add(LIMB.clavicle[k], j[LIMB.clavicle[k]], j[LIMB.upperArm[k]]);
    add(LIMB.upperArm[k], j[LIMB.upperArm[k]], j[LIMB.forearm[k]]);
    add(LIMB.forearm[k], j[LIMB.forearm[k]], j[LIMB.hand[k]]);
    add(LIMB.hand[k], j[LIMB.hand[k]], j[LIMB.fingers[k]]);
    const f = j[LIMB.fingers[k]], h = j[LIMB.hand[k]];
    add(LIMB.fingers[k], f, [f[0] + (f[0] - h[0]), f[1] + (f[1] - h[1]), f[2]]);
    add(LIMB.thigh[k], j[LIMB.thigh[k]], j[LIMB.shin[k]]);
    add(LIMB.shin[k], j[LIMB.shin[k]], j[LIMB.foot[k]]);
    add(LIMB.foot[k], j[LIMB.foot[k]], j[LIMB.toe[k]]);
    add(LIMB.toe[k], j[LIMB.toe[k]], [j[LIMB.toe[k]][0], 0.02, 0.21]);
  });
  return s;
}

const segmentDistance = (x, y, z, { a, b }) => {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / (bx * bx + by * by + bz * bz)));
  return Math.hypot(x - a[0] - bx * t, y - a[1] - by * t, z - a[2] - bz * t);
};

const ARMS = (k) => [LIMB.upperArm[k], LIMB.forearm[k], LIMB.hand[k], LIMB.fingers[k]];
const LEGS = (k) => [LIMB.thigh[k], LIMB.shin[k], LIMB.foot[k], LIMB.toe[k]];
const TRUNK = [BONE.PELVIS, BONE.SPINE, BONE.CHEST];

// Which bones may move a vertex. `rule`: 'head' keeps to the skull, 'chest' and 'pelvis' to that bone; 'body' sorts by where
// the vertex sits: a sleeve follows the arm and nothing else, a hem never does
function allowedBones(x, y, z, rule, female, s) {
  if (rule === 'head') return [BONE.HEAD];
  if (rule === 'chest') return [BONE.CHEST];
  if (rule === 'pelvis') return [BONE.PELVIS];
  const k = x >= 0 ? 0 : 1;
  if (rule === 'arm') return ARMS(k);
  const armDistance = Math.min(segmentDistance(x, y, z, s[LIMB.upperArm[k]]), segmentDistance(x, y, z, s[LIMB.forearm[k]]), segmentDistance(x, y, z, s[LIMB.hand[k]]), segmentDistance(x, y, z, s[LIMB.fingers[k]]));
  const inColumn = (x / (female ? 0.172 : 0.186)) ** 2 + (z / 0.15) ** 2 < 1;
  if (y > 1.52) return [BONE.HEAD, BONE.NECK];
  if (y > 1.455 && Math.abs(x) < 0.09) return [BONE.NECK, BONE.CHEST, LIMB.clavicle[k]];
  if (y > 1.3) {
    if (!inColumn) return [LIMB.upperArm[k], LIMB.clavicle[k], BONE.CHEST];
    return Math.abs(x) > 0.1 ? [BONE.CHEST, LIMB.clavicle[k], LIMB.upperArm[k]] : [BONE.CHEST, BONE.SPINE, LIMB.clavicle[k]];
  }
  if (!inColumn && armDistance < 0.095) return ARMS(k);
  if (y > 0.93) return TRUNK;
  if (y > 0.8) return [BONE.PELVIS, ...LEGS(k)];
  return LEGS(k);
}

function computeSkin(positions, rule, female) {
  const s = segments(female);
  const n = positions.length / 3;
  const indices = new Uint8Array(n * 4), weights = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const list = allowedBones(x, y, z, rule, female, s);
    const scored = list.map((b) => [b, 1 / (segmentDistance(x, y, z, s[b]) + 0.012) ** 5]).sort((p, q) => q[1] - p[1]).slice(0, 4);
    const sum = scored.reduce((t, p) => t + p[1], 0);
    let left = 255;
    scored.forEach(([b, w], c) => {
      const v = c === scored.length - 1 ? left : Math.min(left, Math.round((w / sum) * 255));
      indices[i * 4 + c] = b;
      weights[i * 4 + c] = v;
      left -= v;
    });
  }
  return { indices, weights };
}

export { computeSkin, BONE_COUNT };
