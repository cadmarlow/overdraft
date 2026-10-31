// The human skeleton, shared by the game and the tool that sculpts the bodies (tools/build-humans.mjs). Metres, a 1.75 m
// person standing at the origin facing +Z with +X on their left, legs straight, arms hanging 14 degrees out from the body.

const BONE = {
  PELVIS: 0, CHEST: 1, HEAD: 2,
  UPPER_ARM_L: 3, FOREARM_L: 4, UPPER_ARM_R: 5, FOREARM_R: 6,
  THIGH_L: 7, SHIN_L: 8, FOOT_L: 9, TOE_L: 10,
  THIGH_R: 11, SHIN_R: 12, FOOT_R: 13, TOE_R: 14,
  SPINE: 15, NECK: 16, CLAVICLE_L: 17, CLAVICLE_R: 18, HAND_L: 19, HAND_R: 20, FINGERS_L: 21, FINGERS_R: 22
};
const BONE_COUNT = 23;
const THIGH = 0.42;
const SHIN = 0.42;
const ANKLE_H = 0.08;
const HIP_X = 0.09;
const UPPER_ARM = 0.3;
const FOREARM = 0.255;
const ARM_BIND_ABDUCTION = 0.24; // wide enough that sleeves stay clear of the body in the sculpt
const PELVIS_Y = 0.96;
const HIP_Y = ANKLE_H + SHIN + THIGH;
const SIDES = [1, -1]; // left (+X), right (-X)
const LIMB = {
  upperArm: [BONE.UPPER_ARM_L, BONE.UPPER_ARM_R],
  forearm: [BONE.FOREARM_L, BONE.FOREARM_R],
  thigh: [BONE.THIGH_L, BONE.THIGH_R],
  shin: [BONE.SHIN_L, BONE.SHIN_R],
  foot: [BONE.FOOT_L, BONE.FOOT_R],
  toe: [BONE.TOE_L, BONE.TOE_R],
  clavicle: [BONE.CLAVICLE_L, BONE.CLAVICLE_R],
  hand: [BONE.HAND_L, BONE.HAND_R],
  fingers: [BONE.FINGERS_L, BONE.FINGERS_R]
};
const HAND_LENGTH = 0.09; // wrist to the knuckles

const shoulderJoint = (female) => (female ? [0.165, 1.415, -0.015] : [0.185, 1.43, -0.015]);

// Bind-pose joints as [x, y, z] by bone
function bindJointPositions(female) {
  const sh = shoulderJoint(female);
  const ax = Math.sin(ARM_BIND_ABDUCTION), ay = -Math.cos(ARM_BIND_ABDUCTION);
  const j = [];
  j[BONE.PELVIS] = [0, PELVIS_Y, 0];
  j[BONE.SPINE] = [0, 1.08, -0.005];
  j[BONE.CHEST] = [0, 1.2, -0.012];
  j[BONE.NECK] = [0, 1.49, -0.02];
  j[BONE.HEAD] = [0, 1.56, -0.008];
  SIDES.forEach((side, k) => {
    j[LIMB.clavicle[k]] = [side * 0.03, sh[1] + 0.02, sh[2] + 0.03];
    j[LIMB.upperArm[k]] = [side * sh[0], sh[1], sh[2]];
    j[LIMB.forearm[k]] = [side * (sh[0] + ax * UPPER_ARM), sh[1] + ay * UPPER_ARM, sh[2]];
    const fx = sh[0] + ax * (UPPER_ARM + FOREARM), fy = sh[1] + ay * (UPPER_ARM + FOREARM);
    j[LIMB.hand[k]] = [side * fx, fy, sh[2]];
    j[LIMB.fingers[k]] = [side * (fx + ax * HAND_LENGTH), fy + ay * HAND_LENGTH, sh[2]];
    j[LIMB.thigh[k]] = [side * HIP_X, HIP_Y, 0];
    j[LIMB.shin[k]] = [side * HIP_X, ANKLE_H + SHIN, 0];
    j[LIMB.foot[k]] = [side * HIP_X, ANKLE_H, 0];
    j[LIMB.toe[k]] = [side * HIP_X, 0.02, 0.135];
  });
  return j;
}

export {
  BONE, BONE_COUNT, THIGH, SHIN, ANKLE_H, HIP_X, UPPER_ARM, FOREARM, HAND_LENGTH, ARM_BIND_ABDUCTION, PELVIS_Y, HIP_Y, SIDES, LIMB,
  shoulderJoint, bindJointPositions
};
