import { smin, smax, cone, capsule, ellipsoid, roundBox, clamp, sstep, noise } from './sdf.mjs';
import { makeBody } from './anatomy.mjs';
import { HIP_X, SIDES } from '../../js/human-skeleton.js';

// Parts tell the shader what a vertex is made of
const PART = { SKIN: 0, HAIR: 1, EYE: 2, TOP: 3, UNDER: 4, LEGS: 5, SHOE: 6, GEAR: 7 };

// Soft drag folds: long ridges along a direction, broken up so they never read as stripes
const ridges = (t, x, y, z, warp = 2.2) => Math.sin(t + noise(x * 7, y * 7, z * 7) * warp * 2.2) * (0.55 + 0.45 * noise(x * 3.1, y * 3.1 + 7, z * 3.1));

function bodyFolds(B) {
  return {
    // bunching across the inside of the elbow and at the armpit
    sleeve(q, y, z) {
      const along = (B.shY - y);
      const elbow = 1 - clamp(Math.abs(along - 0.3) / 0.11, 0, 1);
      const pit = 1 - clamp(Math.abs(along - 0.07) / 0.1, 0, 1);
      const cuff = sstep(0.4, 0.52, along);
      return ridges(along * 74 + z * 26, q, y, z) * (0.0058 * elbow + 0.0036 * pit + 0.0024 * cuff);
    },
    // drape from the chest to the hem, a pull from the shoulders across the front
    trunk(x, y, z) {
      const waist = 1 - clamp(Math.abs(y - 1.07) / 0.18, 0, 1);
      const chest = 1 - clamp(Math.abs(y - 1.3) / 0.14, 0, 1);
      return ridges(y * 46 + Math.abs(x) * 34, x, y, z) * 0.0056 * waist + ridges(y * 22 - Math.abs(x) * 40, x, y + 3, z) * 0.0036 * chest;
    },
    // stacks over the shoe, behind the knee, across the hips
    trouser(q, y, z) {
      const ankle = 1 - clamp((y - 0.1) / 0.17, 0, 1);
      const knee = 1 - clamp(Math.abs(y - 0.5) / 0.1, 0, 1);
      const groin = 1 - clamp(Math.abs(y - 0.84) / 0.1, 0, 1);
      return ridges(y * 90 + z * 14, q, y, z) * 0.0052 * ankle + ridges(y * 66 + q * 40, q, y + 5, z) * 0.0034 * knee
        + ridges(y * 34 - q * 60, q, y + 11, z) * 0.0028 * groin;
    }
  };
}

// A profile through a body: keys of [y, half width, half depth, centre z], eased through with a Catmull-Rom spline
function profile(rows) {
  const at = (i) => rows[Math.max(0, Math.min(rows.length - 1, i))];
  return (y) => {
    let i = 0;
    while (i < rows.length - 2 && y > rows[i + 1][0]) i++;
    const a = rows[i], b = rows[i + 1];
    const t = clamp((y - a[0]) / (b[0] - a[0]), 0, 1);
    const out = [0, 0, 0];
    for (let c = 1; c < 4; c++) {
      const p0 = at(i - 1)[c], p1 = a[c], p2 = b[c], p3 = at(i + 2)[c];
      out[c - 1] = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
    }
    return out;
  };
}

// Distance to a tube of cloth whose sections are superellipses, a little squarer than ellipses, as bodies are
function tube(section, x, y, z, ex = 2.5) {
  const [w, d, cz] = section(y);
  const r = (Math.abs(x / w) ** ex + Math.abs((z - cz) / d) ** ex) ** (1 / ex);
  return (r - 1) * Math.min(w, d);
}

const JACKET = profile([[0.84, 0.184, 0.132, -0.012], [0.92, 0.184, 0.131, -0.012], [1.04, 0.178, 0.126, -0.012], [1.16, 0.174, 0.122, -0.012], [1.28, 0.178, 0.126, -0.014],
  [1.38, 0.174, 0.12, -0.022], [1.45, 0.138, 0.098, -0.026], [1.5, 0.076, 0.076, -0.02], [1.56, 0.066, 0.068, -0.012]]);

// A garment for the upper body. Sleeves: long, short, none. Collar: band, lapel, hood, none. `vee`: how deep the front opens
function top(B, { hem = 0.885, section = JACKET, ribbed = true, sleeves = 'long', collar = 'band', vee = 0, cuff = 0.915, sleeveEase = 1, zip = true } = {}) {
  const folds = bodyFolds(B);
  const r = sleeveEase;
  const armTop = sleeves === 'short' ? 1.17 : -1;
  return (x, y, z) => {
    const a = Math.abs(x);
    let d = tube(section, x, y, z) - folds.trunk(x, y, z);
    if (ribbed) d += sstep(hem + 0.055, hem + 0.05, y) * 0.0065 + Math.max(0, Math.sin(x * 420 + (z > 0 ? 0 : 1))) * 0.0007 * sstep(hem + 0.055, hem + 0.05, y);
    for (const side of SIDES) {
      if (x * side < 0) continue;
      const q = x * side;
      if (sleeves !== 'none') {
        // a plain tube of cloth from the shoulder seam, roomy at the elbow, narrowing to the cuff
        let sleeve = cone(q, y, z, B.shX - 0.006, B.shY - 0.012, B.shZ, B.elbowX, B.elbowY, B.shZ - 0.004, 0.0585 * r, 0.0485 * r);
        sleeve = smin(sleeve, cone(q, y, z, B.elbowX, B.elbowY, B.shZ - 0.004, B.wristX, B.wristY + 0.03, B.shZ + 0.002, 0.0485 * r, 0.0395 * r), 0.012) - folds.sleeve(q, y, z);
        if (ribbed && sleeves === 'long') sleeve += sstep(cuff + 0.05, cuff + 0.04, y) * 0.0065;
        sleeve = smax(sleeve, (sleeves === 'short' ? armTop : cuff) - y, 0.003);
        d = smin(d, sleeve, 0.022);
      }
      // the shoulder runs from the neck into the sleeve head
      d = smin(d, cone(a, y, z, 0.06, 1.462, -0.03, B.shX - 0.018 - (sleeves === 'none' ? 0.03 : 0), B.shY + 0.002, B.shZ - 0.002, 0.052, sleeves === 'none' ? 0.03 : 0.052), 0.05);
    }
    d = smax(d, hem - y, 0.005);
    d = smax(d, y - 1.53, 0.008);
    d = smax(d, -ellipsoid(x, y, z, 0, 1.56, -0.014, 0.0635, 0.105, 0.072), 0.005); // neck opening
    if (vee) {
      // a V down the chest
      const w = (1.5 - y) / vee;
      if (z > 0) d = smax(d, 0.05 + (1 - clamp(w, 0, 1)) * 0.0 - (a + clamp(1 - w, 0, 1) * -0.05 + 0.001 + (y < 1.5 - vee ? 1 : 0)), 0.004);
    }
    if (collar === 'band') {
      // a turned-down band resting on the shoulders, open at the throat
      const c = Math.hypot(x / 0.084, (z + 0.02) / 0.086);
      const lift = 1.492 - sstep(-0.02, 0.07, z) * 0.03 - 0.34 * Math.max(0, c - 1);
      let band = (Math.hypot((c - 1) * 0.084 / 0.0082, (y - lift) / 0.024) - 1) * 0.0082;
      band = smax(band, z - 0.058 + a * 0.2, 0.006);
      d = smin(d, band, 0.005);
    } else if (collar === 'lapel') {
      // folded lapels running down from the neck along the V
      const v = clamp((1.49 - y) / Math.max(vee, 0.1), 0, 1);
      const lapel = ellipsoid(a, y, z - 0.004, 0.058 - v * 0.03, 1.49 - v * Math.max(vee, 0.1), 0.098 - (1 - v) * 0.018, 0.04, Math.max(vee, 0.1) * 0.62, 0.012);
      d = smin(d, smax(lapel, 1.27 - y, 0.01), 0.006);
      d = smin(d, smax(tube(profile([[1.44, 0.08, 0.082, -0.022], [1.51, 0.074, 0.076, -0.02]]), x, y, z), y - 1.505, 0.006), 0.006);
    } else if (collar === 'hood') {
      // the hood lying on the back of the neck and shoulders
      const hood = ellipsoid(x, y, z, 0, 1.465, -0.092, 0.122, 0.082, 0.072);
      d = smin(d, smax(hood, -ellipsoid(x, y, z, 0, 1.52, -0.02, 0.07, 0.09, 0.07), 0.006), 0.016);
    }
    if (zip && !vee && z > 0) d -= sstep(0.0135, 0.008, a) * 0.0016; // the placket over the zip
    // pockets: a slight rise of the flap
    if (zip && z > 0.04 && y > 0.98 && y < 1.05 && a > 0.05 && a < 0.14) d -= sstep(1.045, 1.04, y) * sstep(1.015, 1.02, y) * 0.0022;
    return d;
  };
}

// The T-shirt showing at the neck
function innerTop(B, { neckline = 1.505, low = 1.36, width = 1 } = {}) {
  const shirt = profile([[1.0, 0.15 * width, 0.104, -0.012], [1.36, 0.15 * width, 0.104, -0.016], [1.45, 0.11 * width, 0.08, -0.022], [1.52, 0.062, 0.062, -0.02]]);
  return (x, y, z) => {
    let d = tube(shirt, x, y, z);
    d = smax(d, y - neckline, 0.004);
    d = smax(d, low - y, 0.01);
    return smax(d, -ellipsoid(x, y, z, 0, 1.53, 0.0, 0.058, 0.06, 0.068), 0.004);
  };
}

const THIGH_SECTION = profile([[0.09, 0.063, 0.074, -0.012], [0.2, 0.06, 0.068, -0.014], [0.34, 0.058, 0.066, -0.016], [0.5, 0.062, 0.066, 0.004], [0.66, 0.073, 0.08, 0.004], [0.8, 0.086, 0.095, 0], [0.9, 0.092, 0.105, -0.004]]);
const SEAT = profile([[0.8, 0.16, 0.112, -0.012], [0.92, 0.164, 0.116, -0.016], [0.98, 0.156, 0.11, -0.012], [1.02, 0.146, 0.1, -0.008]]);

function trousers(B, { hem = 0.1, top = 1.0, section = THIGH_SECTION, flare = 0 } = {}) {
  const folds = bodyFolds(B);
  return (x, y, z) => {
    let d = 1e3;
    for (const side of SIDES) {
      const q = x * side;
      const leg = tube(section, q - HIP_X, y, z, 2.2) - flare * sstep(0.5, 0.1, y) - folds.trouser(q, y, z);
      d = Math.min(d, smax(leg, y - 0.88, 0.03));
    }
    d = smin(d, smax(tube(SEAT, x, y, z, 2.4), 0.8 - y, 0.04), 0.02);
    d = smax(d, y - top, 0.003);
    return smax(d, hem - y, 0.003);
  };
}

// A sneaker around the foot of the given side, in world space; toes point +Z
function sneaker(side, x, y, z, { high = 0.112, wide = 1 } = {}) {
  const q = x * side - HIP_X + 0.004;
  // footprint: heel, ball, toe
  const foot2 = (px, pz) => {
    const seg = (ax, az, bx, bz, r1, r2) => {
      const bax = bx - ax, baz = bz - az;
      const t = clamp(((px - ax) * bax + (pz - az) * baz) / (bax * bax + baz * baz), 0, 1);
      return Math.hypot(px - ax - bax * t, pz - az - baz * t) - (r1 + (r2 - r1) * t);
    };
    return Math.min(seg(0, -0.04, 0.002, 0.11, 0.04 * wide, 0.05 * wide), seg(0.002, 0.11, -0.004, 0.165, 0.05 * wide, 0.042 * wide));
  };
  const toeRise = sstep(0.13, 0.215, z) * 0.012;
  const sy = y - toeRise;
  const sole = Math.max(foot2(q, z) - 0.002, Math.abs(sy - 0.0135) - 0.0135) - 0.003;
  let upper = ellipsoid(q, y, z, 0, 0.062, -0.036, 0.0405, 0.062, 0.046);
  upper = smin(upper, ellipsoid(q, y, z, 0, 0.056, 0.05, 0.044, 0.05, 0.1), 0.03);
  upper = smin(upper, ellipsoid(q, y, z, -0.002, 0.047, 0.14, 0.046, 0.033, 0.067), 0.02);
  upper = smin(upper, capsule(q, y, z, 0, 0.09, -0.02, 0, 0.12, -0.012, 0.036), 0.018);
  upper = smax(upper, y - high + Math.max(0, z) * 0.1, 0.006);
  upper = smax(upper, -capsule(q, y, z, 0, 0.1, -0.015, 0, 0.16, -0.015, 0.03), 0.005); // the opening for the ankle
  // lace ridges over the instep
  if (z > 0.015 && z < 0.1 && Math.abs(q) < 0.024) upper -= Math.max(0, Math.sin(z * 480)) * 0.0011;
  return smin(sole, upper, 0.004);
}

// Footwear variations on the sneaker: a low leather shoe, a boot, a flat
function oxford(side, x, y, z) {
  const base = sneaker(side, x, y, z, { high: 0.098, wide: 0.92 });
  return smax(base, -(Math.abs(y - 0.027) - 0.0012 + (Math.abs(x * side - HIP_X) > 0.03 ? 0 : 1)), 0.001);
}
function boot(side, x, y, z) {
  const q = x * side - HIP_X;
  return smin(sneaker(side, x, y, z, { high: 0.115, wide: 1.04 }), smax(cone(q, y, z, 0, 0.09, -0.012, 0, 0.21, -0.012, 0.044, 0.047), y - 0.205, 0.004), 0.02);
}
function flat(side, x, y, z) {
  return sneaker(side, x, y, z, { high: 0.078, wide: 0.86 });
}

// Short, textured, slightly longer on top, cut close at the sides
function shortHair(B, { volume = 1 } = {}) {
  return (x, y, z) => {
    const theta = Math.atan2(x, z), side = Math.abs(theta);
    // hairline: an M over the forehead, down the temples, round the ears, low at the nape
    const line = 1.712 - 0.016 * Math.abs(Math.cos(theta * 2.6)) * (1 - sstep(0.45, 0.8, side)) - 0.042 * sstep(0.62, 1.12, side) + 0.006 * sstep(1.2, 1.45, side)
      - 0.075 * sstep(1.75, 2.5, side);
    const top = sstep(1.68, 1.76, y);
    const fade = sstep(line, line + 0.05, y);
    const skull = ellipsoid(x, y - 1.645, z, 0, 0.03, -0.02, 0.0775, 0.089, 0.1);
    // tufts combed back and up from the forehead
    const clumps = noise(x * 34, y * 22, z * 16) * 0.0058 + noise(x * 84, y * 60, z * 40) * 0.0026 + noise(x * 170, y * 170, z * 120) * 0.0009;
    let d = skull - (0.0012 + 0.0135 * volume * (0.35 + 0.65 * top) * fade) - clumps * (0.12 + 0.88 * top) * fade;
    d = smax(d, line - y + noise(theta * 16, 3, 1) * 0.0022, 0.0024);
    return smax(d, -ellipsoid(x, y - 1.645, z, 0, -0.04, 0.1, 0.07, 0.09, 0.05), 0.006);
  };
}

const SKULL = (x, y, z) => ellipsoid(x, y - 1.645, z, 0, 0.03, -0.02, 0.0775, 0.089, 0.1);
const headCut = (d, x, y, z) => smax(d, -ellipsoid(x, y - 1.645, z, 0, -0.04, 0.1, 0.07, 0.09, 0.05), 0.006);

// Long hair: a fall from the crown over the shoulders, a parting, ends in soft clumps
function longHair(B, { reach = 1.34, volume = 1 } = {}) {
  return (x, y, z) => {
    const theta = Math.atan2(x, z), side = Math.abs(theta);
    const skull = SKULL(x, y, z) - 0.009 * volume;
    const flow = noise(x * 26, y * 7, z * 26) * 0.0075 + noise(x * 70, y * 16, z * 70) * 0.0026;
    let curtain = ellipsoid(x, y, z, 0, 1.51, -0.05, 0.1 * volume, 0.25 + (1.34 - reach), 0.09);
    curtain = smax(curtain, reach + noise(x * 22, 2, z * 22) * 0.02 - y, 0.012);
    curtain = smax(curtain, -ellipsoid(x, y, z, 0, 1.5, 0.05, 0.078, 0.2, 0.1), 0.02); // room for the face and neck
    let d = smin(skull, curtain, 0.03) - flow;
    const line = 1.71 - 0.012 * Math.abs(Math.cos(theta * 2.2)) * (1 - sstep(0.4, 0.8, side));
    return smax(d, smax(line - y, 0.1 - z - y * 0, 0.02) * sstep(1.0, 0.7, side) - 0.04 * (1 - sstep(1.0, 0.7, side)), 0.005);
  };
}

// A bob to the jaw
const bobHair = (B) => longHair(B, { reach: 1.55, volume: 0.96 });

// Tight curls
function curlyHair(B) {
  return (x, y, z) => {
    const theta = Math.atan2(x, z), side = Math.abs(theta);
    const line = 1.708 - 0.04 * sstep(0.62, 1.12, side) - 0.078 * sstep(1.75, 2.5, side);
    const curls = noise(x * 150, y * 150, z * 150) * 0.0034 + noise(x * 70, y * 70, z * 70) * 0.0036;
    let d = SKULL(x, y, z) - 0.018 * sstep(line, line + 0.04, y) - curls;
    d = smax(d, line - y, 0.004);
    return headCut(d, x, y, z);
  };
}

// A receding, close-cropped grey cut
function thinHair(B) {
  return (x, y, z) => {
    const theta = Math.atan2(x, z), side = Math.abs(theta);
    const line = 1.74 - 0.082 * sstep(0.7, 1.25, side) - 0.05 * sstep(1.9, 2.6, side);
    let d = SKULL(x, y, z) - 0.0036 - noise(x * 130, y * 130, z * 130) * 0.0009;
    d = smax(d, line - y, 0.004);
    return headCut(d, x, y, z);
  };
}

// Caps sit on the skull; the crew's and the officers'
function peakedCap(B) {
  const band = profile([[1.67, 0.0815, 0.1035, -0.018], [1.71, 0.083, 0.105, -0.018]]);
  const crown = profile([[1.7, 0.083, 0.105, -0.018], [1.735, 0.099, 0.118, -0.012], [1.765, 0.093, 0.112, -0.01], [1.785, 0.05, 0.062, -0.012]]);
  return (x, y, z) => {
    let d = smax(smax(tube(band, x, y, z), 1.675 - y, 0.002), y - 1.72, 0.002);
    d = smin(d, smax(smax(tube(crown, x, y, z, 2.2), 1.7 - y, 0.004), y - 1.785, 0.01), 0.006);
    const brim = ellipsoid(x, y, z, 0, 1.682 - Math.max(0, z - 0.085) * 0.34, 0.098, 0.074, 0.0048, 0.052);
    return smin(d, smax(brim, 0.05 - z, 0.002), 0.003);
  };
}

function beanie(B) {
  return (x, y, z) => {
    let d = SKULL(x, y, z) - 0.0125 - Math.sin(x * 240 + z * 60) * 0.0006;
    d = smax(d, 1.676 + Math.abs(x) * 0.01 - y, 0.004);
    return d;
  };
}

function eyeballs(B) {
  const s = B.P.head;
  return (x, y, z) => Math.min(
    ellipsoid(x, y, z, 0.0315 * s, 1.646, 0.0725 * s, 0.0125, 0.0125, 0.0125),
    ellipsoid(x, y, z, -0.0315 * s, 1.646, 0.0725 * s, 0.0125, 0.0125, 0.0125));
}

// ---- Who wears what -----------------------------------------------------------------------------------------------
const box = (x0, y0, z0, x1, y1, z1) => [x0, y0, z0, x1, y1, z1];
const FITTED = profile([[0.8, 0.178, 0.126, -0.012], [0.92, 0.168, 0.12, -0.012], [1.06, 0.15, 0.108, -0.01], [1.16, 0.156, 0.112, -0.012], [1.28, 0.172, 0.122, -0.014],
  [1.38, 0.172, 0.118, -0.022], [1.45, 0.138, 0.098, -0.026], [1.5, 0.076, 0.076, -0.02], [1.56, 0.066, 0.068, -0.012]]);
const LOOSE = profile([[0.84, 0.2, 0.14, -0.012], [0.92, 0.2, 0.14, -0.012], [1.04, 0.194, 0.136, -0.012], [1.16, 0.19, 0.132, -0.012], [1.28, 0.19, 0.134, -0.014],
  [1.38, 0.18, 0.124, -0.022], [1.45, 0.142, 0.1, -0.026], [1.5, 0.08, 0.08, -0.02], [1.56, 0.068, 0.07, -0.012]]);
const SLIM = profile([[0.84, 0.166, 0.118, -0.012], [0.92, 0.166, 0.118, -0.012], [1.06, 0.152, 0.108, -0.01], [1.16, 0.15, 0.108, -0.012], [1.28, 0.166, 0.118, -0.014],
  [1.38, 0.168, 0.114, -0.022], [1.45, 0.136, 0.096, -0.026], [1.5, 0.074, 0.074, -0.02], [1.56, 0.066, 0.068, -0.012]]);
const COAT = profile([[0.55, 0.222, 0.17, -0.02], [0.75, 0.2, 0.15, -0.018], [0.92, 0.186, 0.136, -0.014], [1.06, 0.176, 0.126, -0.012], [1.16, 0.178, 0.126, -0.012], [1.28, 0.184, 0.13, -0.014],
  [1.38, 0.18, 0.124, -0.022], [1.45, 0.142, 0.1, -0.026], [1.5, 0.08, 0.08, -0.02], [1.56, 0.066, 0.068, -0.012]]);
const F_TOP = profile([[0.84, 0.165, 0.122, -0.016], [0.94, 0.158, 0.116, -0.014], [1.06, 0.124, 0.098, -0.008], [1.14, 0.122, 0.096, -0.008], [1.22, 0.138, 0.11, -0.002], [1.3, 0.15, 0.124, 0.004],
  [1.37, 0.152, 0.11, -0.012], [1.44, 0.126, 0.09, -0.024], [1.5, 0.068, 0.068, -0.02], [1.56, 0.058, 0.06, -0.012]]);
const F_COAT = profile([[0.55, 0.21, 0.16, -0.02], [0.75, 0.19, 0.145, -0.018], [0.92, 0.176, 0.132, -0.014], [1.04, 0.14, 0.108, -0.01], [1.12, 0.136, 0.106, -0.008], [1.22, 0.15, 0.118, -0.002], [1.3, 0.16, 0.13, 0.004],
  [1.37, 0.16, 0.116, -0.012], [1.44, 0.13, 0.094, -0.024], [1.5, 0.072, 0.072, -0.02], [1.56, 0.058, 0.06, -0.012]]);
const DRESS = profile([[0.55, 0.205, 0.17, -0.014], [0.75, 0.178, 0.14, -0.014], [0.92, 0.158, 0.116, -0.014], [1.06, 0.122, 0.096, -0.008], [1.14, 0.12, 0.094, -0.008], [1.22, 0.136, 0.108, -0.002], [1.3, 0.148, 0.122, 0.004],
  [1.37, 0.15, 0.108, -0.012], [1.44, 0.124, 0.088, -0.024], [1.5, 0.068, 0.068, -0.02], [1.56, 0.058, 0.06, -0.012]]);
const SKIRT = profile([[0.56, 0.138, 0.112, -0.012], [0.75, 0.15, 0.116, -0.014], [0.92, 0.158, 0.118, -0.014], [1.04, 0.124, 0.098, -0.008], [1.1, 0.12, 0.094, -0.008]]);
const SLIM_LEG = profile([[0.09, 0.046, 0.054, -0.01], [0.2, 0.05, 0.058, -0.014], [0.34, 0.054, 0.062, -0.016], [0.5, 0.056, 0.06, 0.004], [0.66, 0.07, 0.076, 0.004], [0.8, 0.084, 0.09, 0], [0.9, 0.09, 0.1, -0.004]]);
const WIDE_LEG = profile([[0.09, 0.072, 0.082, -0.012], [0.2, 0.07, 0.078, -0.014], [0.34, 0.068, 0.076, -0.016], [0.5, 0.072, 0.076, 0.004], [0.66, 0.08, 0.086, 0.004], [0.8, 0.09, 0.098, 0], [0.9, 0.094, 0.106, -0.004]]);

const shoes = (L, h, make, budget, reach = 0.135) => {
  for (const side of SIDES) {
    L.push({ name: `shoe${side}`, part: PART.SHOE, skin: 'body', voxel: h(0.0026), budget, bounds: box(side > 0 ? 0.02 : -0.17, -0.002, -0.1, side > 0 ? 0.17 : -0.02, reach, 0.23),
      field: (x, y, z) => make(side, x, y, z) });
  }
};
const bareLegs = (B, L, h, top, budget) => L.push({ name: 'legsSkin', part: PART.SKIN, skin: 'body', voxel: h(0.0042), budget, bounds: box(-0.2, 0.05, -0.16, 0.2, top + 0.02, 0.16),
  field: (x, y, z) => smax(Math.min(B.leg(1, x, y, z), B.leg(-1, x, y, z)), Math.max(y - top, 0.06 - y), 0.004) });
const bareArms = (B, L, h, budget) => L.push({ name: 'armsSkin', part: PART.SKIN, skin: 'arm', voxel: h(0.0036), budget, bounds: box(-0.42, 0.86, -0.1, 0.42, 1.24, 0.1),
  field: (x, y, z) => smax(B.arm(x >= 0 ? 1 : -1, x, y, z), Math.max(y - 1.2, 0.9 - y), 0.004) });

// Layer budgets are for the full detail body; bake() scales them for the crowd
const OUTFITS = {
  hero: { layers(B, L, h) {
    L.push({ name: 'jacket', part: PART.TOP, skin: 'body', voxel: h(0.004), budget: 18000, bounds: box(-0.4, 0.84, -0.2, 0.4, 1.58, 0.2), field: top(B) });
    L.push({ name: 'tee', part: PART.UNDER, skin: 'body', voxel: h(0.005), budget: 1000, bounds: box(-0.2, 1.1, -0.17, 0.2, 1.53, 0.17), field: innerTop(B) });
    L.push({ name: 'jeans', part: PART.LEGS, skin: 'body', voxel: h(0.0042), budget: 12000, bounds: box(-0.22, 0.08, -0.2, 0.22, 1.06, 0.2), field: trousers(B) });
    shoes(L, h, sneaker, 2800);
  } },
  blazer: { layers(B, L, h) {
    L.push({ name: 'blazer', part: PART.TOP, skin: 'body', voxel: h(0.004), budget: 16000, bounds: box(-0.4, 0.74, -0.2, 0.4, 1.58, 0.2),
      field: top(B, { hem: 0.8, section: FITTED, ribbed: false, collar: 'lapel', vee: 0.25, zip: false, cuff: 0.9, sleeveEase: 0.92 }) });
    L.push({ name: 'shirt', part: PART.UNDER, skin: 'body', voxel: h(0.005), budget: 2500, bounds: box(-0.2, 1.1, -0.17, 0.2, 1.53, 0.17), field: innerTop(B, { neckline: 1.51, low: 1.2 }) });
    L.push({ name: 'trousers', part: PART.LEGS, skin: 'body', voxel: h(0.0042), budget: 11000, bounds: box(-0.22, 0.05, -0.2, 0.22, 1.06, 0.2), field: trousers(B, { hem: 0.06 }) });
    shoes(L, h, oxford, 2400);
  } },
  hoodie: { layers(B, L, h) {
    L.push({ name: 'hoodie', part: PART.TOP, skin: 'body', voxel: h(0.004), budget: 16000, bounds: box(-0.42, 0.8, -0.22, 0.42, 1.6, 0.22),
      field: top(B, { hem: 0.86, section: LOOSE, collar: 'hood', zip: false, cuff: 0.905, sleeveEase: 1.08 }) });
    L.push({ name: 'jeans', part: PART.LEGS, skin: 'body', voxel: h(0.0042), budget: 11000, bounds: box(-0.22, 0.08, -0.2, 0.22, 1.06, 0.2), field: trousers(B, { section: WIDE_LEG }) });
    shoes(L, h, sneaker, 2600);
  } },
  tee: { layers(B, L, h) {
    L.push({ name: 'tee', part: PART.TOP, skin: 'body', voxel: h(0.004), budget: 12000, bounds: box(-0.4, 0.9, -0.2, 0.4, 1.58, 0.2),
      field: top(B, { hem: 0.93, section: SLIM, ribbed: false, sleeves: 'short', collar: 'none', zip: false, sleeveEase: 0.96 }) });
    bareArms(B, L, h, 3000);
    L.push({ name: 'jeans', part: PART.LEGS, skin: 'body', voxel: h(0.0042), budget: 11000, bounds: box(-0.22, 0.08, -0.2, 0.22, 1.06, 0.2), field: trousers(B) });
    shoes(L, h, sneaker, 2600);
  } },
  overcoat: { layers(B, L, h) {
    L.push({ name: 'coat', part: PART.TOP, skin: 'body', voxel: h(0.0042), budget: 18000, bounds: box(-0.42, 0.5, -0.24, 0.42, 1.58, 0.22),
      field: top(B, { hem: 0.56, section: COAT, ribbed: false, collar: 'lapel', vee: 0.2, zip: false, cuff: 0.9, sleeveEase: 1.04 }) });
    L.push({ name: 'scarf', part: PART.UNDER, skin: 'body', voxel: h(0.005), budget: 2000, bounds: box(-0.2, 1.1, -0.17, 0.2, 1.53, 0.17), field: innerTop(B, { neckline: 1.515, low: 1.25 }) });
    L.push({ name: 'trousers', part: PART.LEGS, skin: 'body', voxel: h(0.0046), budget: 6000, bounds: box(-0.2, 0.05, -0.18, 0.2, 0.8, 0.18), field: trousers(B, { hem: 0.06, top: 0.78 }) });
    shoes(L, h, oxford, 2400);
  } },
  coatF: { female: true, layers(B, L, h) {
    L.push({ name: 'coat', part: PART.TOP, skin: 'body', voxel: h(0.0042), budget: 18000, bounds: box(-0.4, 0.5, -0.24, 0.4, 1.58, 0.22),
      field: top(B, { hem: 0.58, section: F_COAT, ribbed: false, collar: 'lapel', vee: 0.17, zip: false, cuff: 0.9, sleeveEase: 0.86 }) });
    L.push({ name: 'top', part: PART.UNDER, skin: 'body', voxel: h(0.005), budget: 1500, bounds: box(-0.2, 1.1, -0.17, 0.2, 1.53, 0.17), field: innerTop(B, { neckline: 1.5, low: 1.25, width: 0.9 }) });
    L.push({ name: 'trousers', part: PART.LEGS, skin: 'body', voxel: h(0.0046), budget: 5000, bounds: box(-0.18, 0.05, -0.16, 0.18, 0.8, 0.16), field: trousers(B, { hem: 0.09, top: 0.76, section: SLIM_LEG }) });
    shoes(L, h, boot, 2600, 0.22);
  } },
  dressF: { female: true, layers(B, L, h) {
    L.push({ name: 'dress', part: PART.TOP, skin: 'body', voxel: h(0.004), budget: 15000, bounds: box(-0.4, 0.5, -0.22, 0.4, 1.58, 0.22),
      field: top(B, { hem: 0.56, section: DRESS, ribbed: false, sleeves: 'short', collar: 'none', zip: false, sleeveEase: 0.8 }) });
    bareArms(B, L, h, 3000);
    bareLegs(B, L, h, 0.6, 5000);
    shoes(L, h, flat, 2000);
  } },
  casualF: { female: true, layers(B, L, h) {
    L.push({ name: 'jacket', part: PART.TOP, skin: 'body', voxel: h(0.004), budget: 15000, bounds: box(-0.4, 0.84, -0.2, 0.4, 1.58, 0.2),
      field: top(B, { hem: 0.93, section: F_TOP, collar: 'band', zip: true, sleeveEase: 0.84, cuff: 0.905 }) });
    L.push({ name: 'top', part: PART.UNDER, skin: 'body', voxel: h(0.005), budget: 1000, bounds: box(-0.2, 1.1, -0.17, 0.2, 1.53, 0.17), field: innerTop(B, { width: 0.88 }) });
    L.push({ name: 'jeans', part: PART.LEGS, skin: 'body', voxel: h(0.0042), budget: 11000, bounds: box(-0.2, 0.08, -0.18, 0.2, 1.06, 0.18), field: trousers(B, { section: SLIM_LEG }) });
    shoes(L, h, sneaker, 2400);
  } },
  skirtF: { female: true, layers(B, L, h) {
    L.push({ name: 'blouse', part: PART.TOP, skin: 'body', voxel: h(0.004), budget: 13000, bounds: box(-0.4, 0.96, -0.2, 0.4, 1.58, 0.2),
      field: top(B, { hem: 1.0, section: F_TOP, ribbed: false, collar: 'band', zip: false, sleeveEase: 0.84, cuff: 0.9 }) });
    L.push({ name: 'skirt', part: PART.LEGS, skin: 'body', voxel: h(0.0042), budget: 7000, bounds: box(-0.22, 0.52, -0.18, 0.22, 1.1, 0.18),
      field: (x, y, z) => smax(smax(tube(SKIRT, x, y, z, 2.3), y - 1.08, 0.004), 0.57 - y, 0.004) });
    bareLegs(B, L, h, 0.6, 5000);
    shoes(L, h, flat, 2000);
  } },
  cop: { layers(B, L, h) {
    L.push({ name: 'shirt', part: PART.TOP, skin: 'body', voxel: h(0.004), budget: 15000, bounds: box(-0.4, 0.9, -0.2, 0.4, 1.58, 0.2),
      field: top(B, { hem: 0.94, section: SLIM, ribbed: false, collar: 'band', zip: false, cuff: 0.905, sleeveEase: 0.96 }) });
    const vest = profile([[0.98, 0.17, 0.13, -0.012], [1.06, 0.168, 0.128, -0.012], [1.16, 0.168, 0.128, -0.012], [1.28, 0.176, 0.134, -0.014], [1.38, 0.166, 0.126, -0.022], [1.46, 0.12, 0.1, -0.024]]);
    L.push({ name: 'vest', part: PART.GEAR, skin: 'body', voxel: h(0.0042), budget: 7000, bounds: box(-0.24, 1.0, -0.18, 0.24, 1.5, 0.18),
      field: (x, y, z) => {
        let d = tube(vest, x, y, z, 3);
        d = smax(d, 1.02 - y, 0.006);
        d = smax(d, y - 1.455, 0.012);
        d = smax(d, -ellipsoid(x, y, z, 0, 1.5, -0.016, 0.092, 0.095, 0.092), 0.01); // neck
        const a = Math.abs(x);
        d = smax(d, -ellipsoid(a, y, z, 0.2, 1.33, -0.015, 0.058, 0.135, 0.15), 0.012); // armholes
        // pouches on the front, the radio on the left of the chest
        if (z > 0) {
          d = smin(d, roundBox(a, y, z, 0.075, 1.09, 0.112, 0.036, 0.048, 0.016, 0.006), 0.003);
          d = smin(d, roundBox(x, y, z, 0.098, 1.34, 0.118, 0.022, 0.05, 0.016, 0.006), 0.003);
        }
        return d;
      } });
    L.push({ name: 'belt', part: PART.GEAR, skin: 'body', voxel: h(0.0036), budget: 6000, bounds: box(-0.24, 0.84, -0.18, 0.24, 1.08, 0.18),
      field: (x, y, z) => {
        const belt = profile([[0.94, 0.166, 0.118, -0.012], [1.04, 0.158, 0.114, -0.01]]);
        let d = smax(smax(tube(belt, x, y, z), y - 1.01, 0.003), 0.965 - y, 0.003);
        d = smin(d, roundBox(x, y, z, -0.185, 0.93, 0.0, 0.021, 0.075, 0.042, 0.012), 0.004); // holster, right hip
        d = smin(d, roundBox(x, y, z, 0.175, 0.965, 0.02, 0.016, 0.042, 0.03, 0.008), 0.004); // magazines, left hip
        d = smin(d, roundBox(x, y, z, 0, 0.965, -0.135, 0.04, 0.03, 0.02, 0.008), 0.004); // cuffs, back
        return d;
      } });
    L.push({ name: 'trousers', part: PART.LEGS, skin: 'body', voxel: h(0.0042), budget: 11000, bounds: box(-0.24, 0.1, -0.2, 0.24, 1.06, 0.2),
      field: (x, y, z) => {
        let d = trousers(B, { hem: 0.17, section: WIDE_LEG })(x, y, z);
        const a = Math.abs(x);
        return smin(d, roundBox(a, y, z, 0.165, 0.62, 0.0, 0.016, 0.06, 0.05, 0.012), 0.008); // cargo pockets
      } });
    shoes(L, h, boot, 3000, 0.23);
  } }
};

const HAIR = {
  short: { make: shortHair, budget: 9000 },
  curly: { make: curlyHair, budget: 8000 },
  thin: { make: thinHair, budget: 4000 },
  long: { make: longHair, budget: 12000, low: 1.3 },
  bob: { make: bobHair, budget: 10000, low: 1.5 },
  cap: { make: peakedCap, budget: 5000 },
  beanie: { make: beanie, budget: 4000 }
};

// Things carried, modelled where the arm poses of PersonRig (CARRY) leave the hand
const PROPS = {
  phone: { rule: 'chest', part: PART.GEAR, voxel: 0.0024, budget: 160, bounds: box(-0.1, 1.2, 0.2, 0.06, 1.36, 0.34),
    field: (x, y, z) => { const ty = y - 1.285, tz = z - 0.272, c = Math.cos(0.72), n = Math.sin(0.72);
      return roundBox(x + 0.012, ty * c + tz * n, tz * c - ty * n, 0, 0, 0, 0.036, 0.074, 0.0045, 0.004); } },
  coffee: { rule: 'chest', part: PART.EYE, voxel: 0.0032, budget: 200, bounds: box(0.06, 1.12, 0.22, 0.2, 1.3, 0.34),
    field: (x, y, z) => smin(cone(x, y, z, 0.128, 1.15, 0.277, 0.128, 1.245, 0.277, 0.031, 0.04), capsule(x, y, z, 0.128, 1.262, 0.277, 0.128, 1.27, 0.277, 0.039), 0.002) },
  umbrella: { rule: 'chest', part: PART.GEAR, voxel: 0.012, budget: 520, bounds: box(-0.8, 1.2, -0.7, 0.7, 2.3, 0.85),
    field: (x, y, z) => {
      const cx = -0.045, cz = 0.09;
      const dome = Math.abs(ellipsoid(x, y, z, cx, 1.72, cz, 0.62, 0.38, 0.62) ) - 0.008;
      const rib = Math.sin(Math.atan2(x - cx, z - cz) * 8) * 0.012 * sstep(1.86, 1.76, y);
      const canopy = smax(dome - rib, 1.9 - y - 0.03, 0.01);
      return Math.min(canopy, capsule(x, y, z, -0.055, 1.24, 0.2, cx, 2.14, cz, 0.0085));
    } },
  bag: { rule: 'pelvis', part: PART.GEAR, voxel: 0.0052, budget: 500, bounds: box(0.08, 0.8, -0.14, 0.32, 1.42, 0.14),
    field: (x, y, z) => {
      const body = roundBox(x, y, z, 0.205, 0.94, 0.0, 0.03, 0.095, 0.12, 0.022);
      const strap = capsule(x, y, z, 0.195, 1.03, 0.05, 0.16, 1.4, 0.0, 0.009);
      return smin(body, Math.min(strap, capsule(x, y, z, 0.195, 1.03, -0.05, 0.16, 1.4, 0.0, 0.009)), 0.006);
    } },
  backpack: { rule: 'chest', part: PART.GEAR, voxel: 0.0052, budget: 700, bounds: box(-0.2, 0.98, -0.3, 0.2, 1.52, 0.14),
    field: (x, y, z) => {
      const a = Math.abs(x);
      let d = roundBox(x, y, z, 0, 1.235, -0.195, 0.14, 0.2, 0.062, 0.05);
      d = smin(d, roundBox(x, y, z, 0, 1.14, -0.248, 0.105, 0.075, 0.03, 0.022), 0.008);
      d = Math.min(d, capsule(a, y, z, 0.1, 1.42, -0.14, 0.11, 1.46, 0.0, 0.012), capsule(a, y, z, 0.11, 1.46, 0.0, 0.135, 1.2, 0.1, 0.012));
      return d;
    } }
};

function propLayer(name, detail) {
  const P = PROPS[name];
  return { name, part: P.part, skin: P.rule, voxel: P.voxel * detail, budget: P.budget, bounds: P.bounds, field: P.field };
}

function hairLayer(name, female, detail) {
  const B = makeBody(female);
  const H = HAIR[name];
  return { name, part: name === 'cap' || name === 'beanie' ? PART.GEAR : PART.HAIR, skin: 'head', voxel: 0.0024 * detail, budget: H.budget,
    bounds: box(-0.14, H.low ?? 1.5, -0.17, 0.14, 1.82, 0.2), field: H.make(B) };
}

function layersFor(outfit, detail) {
  const female = !!outfit.female;
  const B = makeBody(female);
  const h = (fine) => fine * detail;
  const layers = [
    { name: 'head', part: PART.SKIN, skin: 'body', voxel: h(0.0024), budget: 13000, bounds: box(-0.11, 1.45, -0.14, 0.11, 1.8, 0.16),
      field: (x, y, z) => smax(smin(B.head(x, y, z), B.neck(x, y, z), 0.02), 1.455 - y, 0.004) },
    { name: 'hands', part: PART.SKIN, skin: 'arm', voxel: h(0.0028), budget: 9000, bounds: box(-0.46, 0.62, -0.12, 0.46, 1.02, 0.12),
      field: (x, y, z) => {
        const side = x >= 0 ? 1 : -1;
        return smax(smin(B.hand(side, x, y, z), B.arm(side, x, y, z), 0.008), y - 0.97, 0.004);
      } },
    { name: 'eyes', part: PART.EYE, skin: 'head', voxel: h(0.0018), budget: 900, bounds: box(-0.055, 1.625, 0.05, 0.055, 1.667, 0.09), field: eyeballs(B) }
  ];
  outfit.layers(B, layers, h);
  return { layers, female };
}

// Guns, in the hand's frame: +Z along the barrel, +Y up, origin at the grip. Metal parts use PART.EYE, polymer PART.GEAR
const rbox = (x, y, z, cx, cy, cz, hx, hy, hz, r = 0.003) => roundBox(x, y, z, cx, cy, cz, hx, hy, hz, r);
const tubeZ = (x, y, z, cy, z0, z1, r) => capsule(x, y, z, 0, cy, z0, 0, cy, z1, r);
const WEAPONS = {
  pistol: { metal(x, y, z) {
    let d = rbox(x, y, z, 0, 0.042, 0.062, 0.0125, 0.0145, 0.092, 0.002); // slide
    d = Math.max(d, -rbox(x, y, z, 0.0125, 0.052, 0.0, 0.002, 0.008, 0.014, 0.0005)); // ejection port
    for (let i = 0; i < 6; i++) d = Math.max(d, -rbox(Math.abs(x), y, z, 0.0125, 0.042, -0.012 + i * 0.0045, 0.0012, 0.009, 0.0011, 0.0003)); // serrations
    d = Math.min(d, rbox(x, y, z, 0, 0.06, 0.144, 0.0016, 0.0032, 0.0034, 0.0008), rbox(x, y, z, 0, 0.06, -0.022, 0.006, 0.0032, 0.0034, 0.0008)); // sights
    return Math.min(d, tubeZ(x, y, z, 0.044, 0.15, 0.156, 0.005));
  }, gear(x, y, z) {
    let d = rbox(x, y, z, 0, -0.018, -0.008, 0.0145, 0.05, 0.021, 0.006); // grip, leaning back a little via the frame below
    d = smin(d, rbox(x, y, z, 0, 0.023, 0.05, 0.0118, 0.0085, 0.08, 0.002), 0.004); // frame
    const guard = Math.abs(ellipsoid(x / 1.0, y, z, 0, 0.006, 0.034, 0.008, 0.016, 0.03)) - 0.0022;
    return Math.min(d, smax(guard, Math.abs(x) - 0.004, 0.001));
  } },
  smg: { metal(x, y, z) {
    let d = rbox(x, y, z, 0, 0.044, 0.1, 0.021, 0.028, 0.14, 0.004); // receiver
    d = Math.max(d, -rbox(x, y, z, 0.021, 0.052, 0.08, 0.0025, 0.009, 0.04, 0.001));
    return Math.min(d, tubeZ(x, y, z, 0.05, 0.24, 0.36, 0.011), rbox(x, y, z, 0, 0.078, 0.2, 0.002, 0.008, 0.005, 0.001), rbox(x, y, z, 0, 0.078, 0.0, 0.009, 0.008, 0.006, 0.001));
  }, gear(x, y, z) {
    let d = rbox(x, y, z, 0, -0.03, 0.0, 0.015, 0.05, 0.022, 0.007);
    d = Math.min(d, rbox(x, y, z, 0, -0.05, 0.13, 0.012, 0.085, 0.017, 0.004)); // magazine
    return Math.min(d, rbox(x, y, z, 0, 0.03, -0.14, 0.012, 0.03, 0.1, 0.005)); // stock
  } },
  shotgun: { metal(x, y, z) {
    let d = rbox(x, y, z, 0, 0.042, 0.1, 0.0185, 0.03, 0.135, 0.004);
    d = Math.min(d, tubeZ(x, y, z, 0.056, 0.2, 0.66, 0.0115), tubeZ(x, y, z, 0.026, 0.2, 0.58, 0.0125));
    return Math.min(d, rbox(x, y, z, 0, 0.069, 0.65, 0.0015, 0.004, 0.003, 0.0006));
  }, gear(x, y, z) {
    let d = rbox(x, y, z, 0, 0.026, 0.42, 0.0185, 0.0175, 0.075, 0.005); // pump
    for (let i = 0; i < 7; i++) d = Math.max(d, -rbox(x, y, z, 0, 0.01, 0.365 + i * 0.018, 0.03, 0.002, 0.0024, 0.0006));
    d = Math.min(d, rbox(x, y, z, 0, -0.02, -0.015, 0.0145, 0.045, 0.024, 0.008));
    return smin(d, cone(x, y, z, 0, 0.03, -0.04, 0, -0.012, -0.32, 0.03, 0.044), 0.012); // stock
  } },
  rifle: { metal(x, y, z) {
    let d = rbox(x, y, z, 0, 0.048, 0.1, 0.0205, 0.031, 0.15, 0.003); // receiver
    d = Math.max(d, -rbox(x, y, z, 0.0205, 0.056, 0.13, 0.0025, 0.01, 0.045, 0.001)); // ejection port
    d = Math.min(d, rbox(x, y, z, 0, 0.08, 0.18, 0.0095, 0.0025, 0.3, 0.001)); // top rail
    for (let i = 0; i < 26; i++) d = Math.max(d, -rbox(x, y, z, 0, 0.083, -0.09 + i * 0.022, 0.012, 0.0014, 0.0034, 0.0004));
    d = Math.min(d, tubeZ(x, y, z, 0.056, 0.45, 0.62, 0.0078), rbox(x, y, z, 0, 0.056, 0.645, 0.0125, 0.0125, 0.03, 0.003)); // barrel, flash hider
    return Math.min(d, rbox(x, y, z, 0, 0.098, 0.035, 0.0085, 0.016, 0.03, 0.002), rbox(x, y, z, 0, 0.098, 0.43, 0.0028, 0.015, 0.005, 0.001));
  }, gear(x, y, z) {
    let d = rbox(x, y, z, 0, 0.05, 0.34, 0.02, 0.026, 0.115, 0.006); // handguard
    for (let i = 0; i < 9; i++) d = Math.max(d, -rbox(Math.abs(x), y, z, 0.02, 0.052, 0.25 + i * 0.024, 0.003, 0.012, 0.005, 0.001));
    d = Math.min(d, rbox(x, y, z, 0, -0.034, 0.0, 0.015, 0.058, 0.024, 0.008)); // grip
    d = smin(d, rbox(x, y, z, 0, -0.058, 0.175, 0.0125, 0.082, 0.021, 0.005), 0.003); // magazine
    d = Math.min(d, tubeZ(x, y, z, 0.056, -0.21, -0.03, 0.017));
    return smin(d, rbox(x, y, z, 0, 0.03, -0.25, 0.017, 0.058, 0.04, 0.01), 0.012); // stock
  } }
};

function weaponLayers(name) {
  const w = WEAPONS[name];
  const b = box(-0.05, -0.16, -0.4, 0.05, 0.13, 0.72);
  return [
    { name: `${name}Metal`, part: PART.EYE, skin: 'head', voxel: 0.0013, budget: 2400, bounds: b, field: w.metal },
    { name: `${name}Grip`, part: PART.GEAR, skin: 'head', voxel: 0.0016, budget: 1800, bounds: b, field: w.gear }
  ];
}

export { OUTFITS, HAIR, PROPS, WEAPONS, PART, layersFor, hairLayer, propLayer, weaponLayers };
