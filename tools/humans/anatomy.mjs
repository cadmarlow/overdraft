import { smin, smax, cone, capsule, ellipsoid, roundBox, clamp, sstep, noise } from './sdf.mjs';
import { BONE, LIMB, SIDES, UPPER_ARM, FOREARM, HAND_LENGTH, ARM_BIND_ABDUCTION, HIP_X, HIP_Y, shoulderJoint } from '../../js/human-skeleton.js';

// The human body as distance fields, region by region, in the bind pose of js/human-skeleton.js. Garments are built from
// these regions, so clothes follow the figure underneath.

const HEAD_Y = 1.645;

function makeBody(female = false) {
  const F = female ? 1 : 0;
  const sh = shoulderJoint(female);
  const shX = sh[0], shY = sh[1], shZ = sh[2];
  const ax = Math.sin(ARM_BIND_ABDUCTION), ay = -Math.cos(ARM_BIND_ABDUCTION);
  const elbowX = shX + ax * UPPER_ARM, elbowY = shY + ay * UPPER_ARM;
  const wristX = shX + ax * (UPPER_ARM + FOREARM), wristY = shY + ay * (UPPER_ARM + FOREARM);
  const P = female
    ? { chest: 0.138, waist: 0.102, hip: 0.158, hipD: 0.118, neck: 0.044, arm: 0.84, leg: 0.97, head: 0.955 }
    : { chest: 0.166, waist: 0.13, hip: 0.15, hipD: 0.108, neck: 0.056, arm: 1, leg: 1, head: 1 };

  function torso(x, y, z) {
    const a = Math.abs(x);
    let d = ellipsoid(x, y, z, 0, 0.965, -0.008, P.hip, 0.135, P.hipD);
    // waist to chest, flattened front to back
    d = smin(d, cone(x, y, z / 0.72, 0, 0.98, -0.006, 0, 1.2, -0.012, P.waist, P.waist * 1.08) * 0.72, 0.06);
    d = smin(d, ellipsoid(x, y, z, 0, 1.285, -0.012, P.chest, 0.205, 0.116 - F * 0.012), 0.05);
    if (female) d = smin(d, ellipsoid(a, y, z, 0.066, 1.3, 0.082, 0.066, 0.06, 0.056), 0.03);
    else d = smin(d, ellipsoid(a, y, z, 0.076, 1.335, 0.078, 0.082, 0.056, 0.036), 0.03);
    // shoulders: trapezius sloping from the neck, deltoid caps
    d = smin(d, cone(a, y, z, 0.035, 1.505, -0.03, shX - 0.012, shY + 0.022, shZ - 0.005, 0.048, 0.042), 0.035);
    d = smin(d, ellipsoid(a, y, z, shX - 0.002, shY - 0.012, shZ, 0.046 * P.arm, 0.07, 0.054 * P.arm), 0.03);
    // shoulder blades, glutes
    d = smin(d, ellipsoid(a, y, z, 0.085, 1.34, -0.1, 0.07, 0.1, 0.03), 0.04);
    d = smin(d, ellipsoid(a, y, z, 0.078, 0.9, -0.075 - F * 0.012, 0.09 + F * 0.012, 0.1, 0.08 + F * 0.01), 0.04);
    return d;
  }

  function neck(x, y, z) {
    let d = cone(x, y, z, 0, 1.47, -0.03, 0, 1.585, -0.006, P.neck + 0.004, P.neck - 0.004);
    const a = Math.abs(x);
    d = smin(d, capsule(a, y, z, 0.056, 1.6, -0.022, 0.016, 1.482, 0.034, 0.012), 0.016); // the muscle from behind the ear to the sternum
    return d;
  }

  // Bald head with its features, built on standard head measurements. Origin at eye height; the cornea sits at z = 0.084,
  // the head is 15.5 cm wide and 23 cm tall, the jaw 11 cm wide, 11.5 cm from the eyes down to the chin
  function head(x, y, z) {
    const s = P.head;
    x /= s; y = (y - HEAD_Y) / s + HEAD_Y; z /= s;
    const px = x, py = y - HEAD_Y, pz = z, a = Math.abs(px);
    let d = ellipsoid(px, py, pz, 0, 0.03, -0.02, 0.0775, 0.089, 0.1);
    d = smin(d, ellipsoid(px, py, pz, 0, -0.02, 0.018, 0.0655 - F * 0.002, 0.088, 0.072), 0.03);
    d = smin(d, ellipsoid(px, py, pz, 0, -0.05, 0.05, 0.042, 0.04, 0.0455), 0.02); // upper jaw, under the nose and lips
    d = smin(d, ellipsoid(a, py, pz, 0.021 - F * 0.003, -0.076, 0.022, 0.0325, 0.029, 0.058), 0.022); // lower jaw
    d = smin(d, ellipsoid(px, py, pz, 0, -0.1 + F * 0.003, 0.066, 0.0195 - F * 0.002, 0.0158, 0.021), 0.02); // chin
    d = smin(d, ellipsoid(a, py, pz, 0.043, -0.03, 0.05, 0.022, 0.03, 0.029), 0.03); // cheeks
    d = smin(d, ellipsoid(a, py, pz, 0.052, -0.008, 0.052, 0.0175, 0.011, 0.019), 0.02); // cheekbones
    d = smin(d, capsule(a, py, pz, 0.013, 0.0205, 0.0885, 0.05, 0.0225, 0.0695, 0.0062 - F * 0.0016), 0.016); // brow
    // nose: bridge, tip, wings, nostrils
    d = smin(d, cone(px, py, pz, 0, 0.0095, 0.0855, 0, -0.03, 0.1035, 0.0064, 0.0078), 0.0105);
    d = smin(d, ellipsoid(px, py, pz, 0, -0.033, 0.1058, 0.0104, 0.0094, 0.0104), 0.006);
    d = smin(d, ellipsoid(a, py, pz, 0.0122, -0.0372, 0.0935, 0.0076, 0.0066, 0.0095), 0.0052);
    d = smax(d, -ellipsoid(a, py, pz, 0.0064, -0.0436, 0.0992, 0.0031, 0.0023, 0.0046), 0.0016);
    // sockets, then lids around the eye, opened in an almond
    d = smax(d, -ellipsoid(a, py, pz, 0.0315, 0.0005, 0.1005, 0.0195, 0.0112, 0.0162), 0.0108);
    const slit = 0.0132 - 0.0009 * Math.abs(a - 0.0318) * 40;
    const lids = smax(ellipsoid(a, py, pz, 0.0315, 0.0005, 0.0725, 0.0163, 0.0133, 0.0137), -ellipsoid(a, py - 0.0006 * (a - 0.0318) * 60, pz, 0.0318, 0.0002, 0.0885, slit, 0.0047, 0.0105), 0.0008);
    d = smin(d, lids, 0.0026);
    // the groove under the nose, lips, the line between them, the dip below them
    d = smax(d, -ellipsoid(px, py, pz, 0, -0.0505, 0.0985, 0.0028, 0.0068, 0.0024), 0.0018);
    d = smin(d, ellipsoid(px, py, pz, 0, -0.0595, 0.0905, 0.0192, 0.0048, 0.0082), 0.0042);
    d = smin(d, ellipsoid(px, py, pz, 0, -0.0704, 0.0875, 0.0162, 0.0062, 0.0084), 0.0042);
    d = smax(d, -ellipsoid(px, py, pz, 0, -0.0648, 0.0995, 0.0232, 0.00095, 0.0115), 0.001);
    d = smax(d, -ellipsoid(px, py, pz, 0, -0.0835, 0.0985, 0.015, 0.0042, 0.0075), 0.007);
    // ears: disc, rim, bowl, lobe
    const ez = pz + 0.012 + py * 0.14;
    const eLen = Math.hypot(py * 0.72, ez);
    let ear = ellipsoid(a, py, ez, 0.0795, -0.001, 0, 0.0048, 0.0295, 0.018);
    ear = smin(ear, Math.hypot(eLen - 0.0158, a - 0.0815) - 0.0028, 0.003);
    ear = smax(ear, -ellipsoid(a, py, ez, 0.0862, -0.003, 0.003, 0.0052, 0.0118, 0.0084), 0.002);
    ear = smin(ear, ellipsoid(a, py, ez, 0.079, -0.0278, 0.003, 0.0042, 0.0088, 0.0068), 0.004);
    d = smin(d, ear, 0.0028);
    return d * s;
  }

  // Arm from the shoulder to the wrist, flat wrist, muscle where it belongs
  function arm(side, x, y, z) {
    const q = x * side;
    const k = P.arm;
    let d = cone(q, y, z, shX, shY, shZ, elbowX, elbowY, shZ, 0.044 * k, 0.0335 * k);
    d = smin(d, ellipsoid(q, y, z, shX + ax * 0.15, shY + ay * 0.15, shZ + 0.016, 0.034 * k, 0.09, 0.035 * k), 0.025); // biceps
    d = smin(d, ellipsoid(q, y, z, shX + ax * 0.16, shY + ay * 0.16, shZ - 0.022, 0.034 * k, 0.1, 0.03 * k), 0.025); // triceps
    d = smin(d, cone(q, y, z, elbowX, elbowY, shZ, wristX, wristY, shZ, 0.0335 * k, 0.0235 * k), 0.015);
    d = smin(d, ellipsoid(q, y, z, shX + ax * 0.375, shY + ay * 0.375, shZ, 0.0365 * k, 0.085, 0.034 * k), 0.022); // forearm belly
    return d;
  }

  // The hand's frame: along the fingers, across the palm (+ towards the thumb), through it (+ out of the palm)
  const handFrame = (() => {
    const t = 0.45;
    const m = [-Math.abs(ay), ax * ay / Math.abs(ay) * -1, 0]; // towards the thigh, in the side's mirrored space
    const u = [ax, ay, 0];
    const n = [m[0] * Math.cos(t), m[1] * Math.cos(t), -Math.sin(t)];
    const l = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]];
    const sign = l[2] > 0 ? 1 : -1;
    return { u, n, l: l.map((v) => v * sign) };
  })();
  const FINGERS = [[0.029, 0.073, 0.0098], [0.0095, 0.081, 0.0102], [-0.0105, 0.075, 0.0097], [-0.0295, 0.06, 0.0086]];

  function hand(side, x, y, z) {
    const k = female ? 0.92 : 1;
    const qx = x * side - wristX, qy = y - wristY, qz = z - shZ;
    const { u, n, l } = handFrame;
    const a = (qx * u[0] + qy * u[1] + qz * u[2]) / k;
    const c = (qx * l[0] + qy * l[1] + qz * l[2]) / k;
    const e = (qx * n[0] + qy * n[1] + qz * n[2]) / k;
    let d = roundBox(a, c, e, 0.047, 0, 0, 0.05, 0.04, 0.0135, 0.0125);
    d = smin(d, ellipsoid(a, c, e, 0.03, 0.03, 0.009, 0.03, 0.018, 0.014), 0.012); // heel of the thumb
    for (const [co, len, r] of FINGERS) {
      let pa = 0.094, pe = 0.002;
      const lens = [len * 0.46, len * 0.3, len * 0.24];
      const bend = [0.3, 0.62, 0.92];
      for (let i = 0; i < 3; i++) {
        const na = pa + Math.cos(bend[i]) * lens[i], ne = pe + Math.sin(bend[i]) * lens[i];
        d = smin(d, cone(a, c, e, pa, co, pe, na, co, ne, r * (1 - i * 0.08), r * (0.92 - i * 0.08)), 0.0035);
        pa = na; pe = ne;
      }
    }
    d = smin(d, cone(a, c, e, 0.02, 0.036, 0.01, 0.058, 0.058, 0.02, 0.0145, 0.0112), 0.008);
    d = smin(d, cone(a, c, e, 0.058, 0.058, 0.02, 0.09, 0.066, 0.026, 0.0108, 0.0092), 0.004);
    d = smin(d, cone(a, c, e, 0.09, 0.066, 0.026, 0.11, 0.067, 0.03, 0.0092, 0.0082), 0.003);
    return d * k;
  }

  function leg(side, x, y, z) {
    const q = x * side;
    const k = P.leg;
    const hipX = HIP_X, kneeY = HIP_Y - 0.42, ankleY = 0.08;
    let d = cone(q, y, z, hipX + 0.006, HIP_Y, -0.004, hipX, kneeY + 0.02, 0.008, 0.088 * k, 0.05 * k);
    d = smin(d, ellipsoid(q, y, z, hipX + 0.006, 0.73, 0.03, 0.062 * k, 0.17, 0.052 * k), 0.03); // quadriceps
    d = smin(d, ellipsoid(q, y, z, hipX, 0.74, -0.038, 0.06 * k, 0.16, 0.05 * k), 0.03); // hamstrings
    d = smin(d, ellipsoid(q, y, z, hipX, kneeY, 0.016, 0.046 * k, 0.05, 0.046 * k), 0.02); // knee
    d = smin(d, cone(q, y, z, hipX, kneeY - 0.02, 0, hipX, ankleY + 0.04, -0.008, 0.042 * k, 0.03 * k), 0.015);
    d = smin(d, ellipsoid(q, y, z, hipX + 0.004, 0.345, -0.032, 0.046 * k, 0.11, 0.046 * k), 0.025); // calf
    return d;
  }

  return { torso, neck, head, arm, hand, leg, P, F, shX, shY, shZ, elbowX, elbowY, wristX, wristY, ax, ay, handFrame };
}

export { makeBody, HEAD_Y };
