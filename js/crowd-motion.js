import { fetchBuffer } from './people-assets.js';
import { BONE_COUNT, BONE, LIMB } from './human-skeleton.js';

// Passers-by walk in captured motion: poses baked onto the game's skeleton (tools/people/bake-crowd-motion.mjs), read from
// a table, turned to the person's heading and written into PersonRig.pose. Whatever the rig does on its own (falling,
// cowering, diving) simply takes over: the pose it writes means the same thing.

const STRIDE = 7;
const SIZE = BONE_COUNT * STRIDE;
const clips = new Map();
let data = null;
let posScale = 1;

async function loadCrowdMotion() {
  const buffer = await fetchBuffer('crowd-motion.bin');
  const headLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headLength)));
  data = new Int16Array(buffer, (4 + headLength + 3) & ~3);
  posScale = 1 / header.posScale;
  for (const clip of header.clips) clips.set(clip.name, clip);
}

const POSE_A = new Float32Array(SIZE), POSE_B = new Float32Array(SIZE), POSE_C = new Float32Array(SIZE), POSE_D = new Float32Array(SIZE);
const QS = 1 / 32767;

function decode(clip, u, out) {
  const n = clip.frames - 1;
  const at = Math.min(n - 1e-4, Math.max(0, u * n));
  const f = Math.floor(at), k = at - f, l = 1 - k;
  let a = (clip.start + f) * SIZE, b = a + SIZE;
  for (let i = 0; i < SIZE; i += STRIDE, a += STRIDE, b += STRIDE) {
    const s = data[a] * data[b] + data[a + 1] * data[b + 1] + data[a + 2] * data[b + 2] + data[a + 3] * data[b + 3] < 0 ? -k : k;
    const x = data[a] * l + data[b] * s, y = data[a + 1] * l + data[b + 1] * s, z = data[a + 2] * l + data[b + 2] * s, w = data[a + 3] * l + data[b + 3] * s;
    const m = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
    out[i] = x * m; out[i + 1] = y * m; out[i + 2] = z * m; out[i + 3] = w * m;
    out[i + 4] = (data[a + 4] * l + data[b + 4] * k) * posScale;
    out[i + 5] = (data[a + 5] * l + data[b + 5] * k) * posScale;
    out[i + 6] = (data[a + 6] * l + data[b + 6] * k) * posScale;
  }
  return out;
}

// a := a + (b - a) * w
function mix(a, b, w) {
  const l = 1 - w;
  for (let i = 0; i < SIZE; i += STRIDE) {
    const s = a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3] < 0 ? -w : w;
    const x = a[i] * l + b[i] * s, y = a[i + 1] * l + b[i + 1] * s, z = a[i + 2] * l + b[i + 2] * s, u = a[i + 3] * l + b[i + 3] * s;
    const m = 1 / Math.sqrt(x * x + y * y + z * z + u * u);
    a[i] = x * m; a[i + 1] = y * m; a[i + 2] = z * m; a[i + 3] = u * m;
    a[i + 4] = a[i + 4] * l + b[i + 4] * w; a[i + 5] = a[i + 5] * l + b[i + 5] * w; a[i + 6] = a[i + 6] * l + b[i + 6] * w;
  }
  return a;
}

// Chest, head and arms: what holding something changes
const UPPER = [BONE.CHEST, BONE.NECK, BONE.HEAD, ...LIMB.clavicle, ...LIMB.upperArm, ...LIMB.forearm, ...LIMB.hand, ...LIMB.fingers];
function wearUpper(a, b, w) {
  // carried along with the walking chest, so the waist doesn't tear
  const c = BONE.CHEST * STRIDE;
  const dx = a[c + 4] - b[c + 4], dy = a[c + 5] - b[c + 5], dz = a[c + 6] - b[c + 6];
  const l = 1 - w;
  for (const bone of UPPER) {
    const i = bone * STRIDE;
    const s = a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3] < 0 ? -w : w;
    const x = a[i] * l + b[i] * s, y = a[i + 1] * l + b[i + 1] * s, z = a[i + 2] * l + b[i + 2] * s, u = a[i + 3] * l + b[i + 3] * s;
    const m = 1 / Math.sqrt(x * x + y * y + z * z + u * u);
    a[i] = x * m; a[i + 1] = y * m; a[i + 2] = z * m; a[i + 3] = u * m;
    a[i + 4] = a[i + 4] * l + (b[i + 4] + dx) * w; a[i + 5] = a[i + 5] * l + (b[i + 5] + dy) * w; a[i + 6] = a[i + 6] * l + (b[i + 6] + dz) * w;
  }
}

const GAITS = ['walk_slow_01', 'walk_neutral', 'run_slow_01', 'run_neutral', 'run_fast_01'];
const BRISK = ['walk_slow_01', 'walk_fast_01', 'run_slow_01', 'run_neutral', 'run_fast_01'];
const SWAGGER = ['walk_slow_01', 'walk_cool_01', 'run_slow_01', 'run_neutral', 'run_fast_01'];
const IDLES = ['idle_neutral_01', 'idle_neutral_02', 'idle_look_around_01', 'idle_waiting_01'];
const HELD = ['cell_phone_textmessage', 'drink_idle', 'umbrella_idle_01']; // by PROP, while it is held in a hand
const FADE = 0.5;

class CrowdMotion {
  constructor(rig) {
    const sex = rig.female ? 'f' : 'm';
    const style = (rig.seed * 5.77) % 1;
    const take = (n) => clips.get(`${sex}_${n}`);
    this.gaits = (style < 0.5 ? GAITS : style < 0.8 ? BRISK : SWAGGER).map(take).sort((a, b) => a.speed - b.speed);
    this.idles = IDLES.map(take);
    this.held = HELD.map(take);
    this.phase = (rig.seed * 3.1) % 1;
    this.moving = 0;
    this.idle = Math.floor((rig.seed * 2.3 % 1) * this.idles.length);
    this.idleT = (rig.seed * 11.7) % 4;
    this.next = -1;
    this.nextT = 0;
    this.heldW = 0;
    this.heldT = (rig.seed * 7.1) % 8;
    this.lastCarry = -1;
  }

  // Writes this frame's pose, or says the rig must solve it itself
  pose(rig, dt) {
    if (rig.crouch > 0.02 || rig.handsUp > 0.02 || rig.aim || rig.punch > 0.01 || rig.air > 0.03) return false;
    const speed = rig.speed, s = rig.s;
    const gaits = this.gaits;
    let i = 0;
    while (i < gaits.length - 2 && speed > gaits[i + 1].speed) i++;
    const low = gaits[i], high = gaits[i + 1];
    const w = Math.min(1, Math.max(0, (speed - low.speed) / (high.speed - low.speed)));
    this.phase = (this.phase + (speed / ((low.stride + (high.stride - low.stride) * w) * s)) * dt) % 1;
    const walk = decode(low, (this.phase + low.sync) % 1, POSE_A);
    decode(high, (this.phase + high.sync) % 1, POSE_B);
    mix(walk, POSE_B, w);
    this.moving += (Math.min(1, speed / 0.7) - this.moving) * Math.min(1, dt * 9);

    let pose = walk;
    if (this.moving < 0.995) {
      const take = this.idles[this.idle];
      this.idleT += dt;
      decode(take, this.idleT / take.duration, POSE_B);
      const left = take.duration - this.idleT;
      if (left < FADE) {
        if (this.next < 0) { this.next = (this.idle + 1) % this.idles.length; this.nextT = 0; }
        this.nextT += dt;
        const other = this.idles[this.next];
        decode(other, this.nextT / other.duration, POSE_C);
        mix(POSE_B, POSE_C, 1 - Math.max(0, left / FADE));
        if (left <= 0) { this.idle = this.next; this.idleT = this.nextT; this.next = -1; }
      }
      pose = mix(POSE_B, walk, this.moving);
    }

    const carried = rig.carry >= 0 && rig.carry < this.held.length ? this.held[rig.carry] : null;
    if (carried) this.lastCarry = rig.carry;
    this.heldW += ((carried ? 1 : 0) - this.heldW) * Math.min(1, dt * 5);
    if (this.heldW > 0.01 && this.lastCarry >= 0 && this.held[this.lastCarry]) {
      const clip = this.held[this.lastCarry];
      this.heldT = (this.heldT + dt) % (clip.duration * 0.98);
      wearUpper(pose, decode(clip, this.heldT / clip.duration, POSE_D), this.heldW);
    }
    this.write(rig, pose);
    return true;
  }

  // Into the rig's pose: turned to their heading, where they stand
  write(rig, pose) {
    const half = rig.yaw * 0.5, sy = Math.sin(half), cy = Math.cos(half);
    const s = rig.s, out = rig.pose;
    const ground = rig.pelvisY - rig.standingHeight(0);
    const c2 = cy * cy - sy * sy, s2 = 2 * cy * sy; // cos, sin of the yaw
    for (let b = 0, i = 0, o = 0; b < BONE_COUNT; b++, i += STRIDE, o += 8) {
      const qx = pose[i], qy = pose[i + 1], qz = pose[i + 2], qw = pose[i + 3];
      out[o] = cy * qx + sy * qz;
      out[o + 1] = cy * qy + sy * qw;
      out[o + 2] = cy * qz - sy * qx;
      out[o + 3] = cy * qw - sy * qy;
      const tx = pose[i + 4], ty = pose[i + 5], tz = pose[i + 6];
      out[o + 4] = rig.x + (tx * c2 + tz * s2) * s;
      out[o + 5] = ground + ty * s;
      out[o + 6] = rig.z + (tz * c2 - tx * s2) * s;
      out[o + 7] = s;
    }
    if (rig.lookTurn) this.turnHead(rig, BONE.HEAD, rig.lookTurn * 0.75);
  }

  // The head (about its own joint) towards something
  turnHead(rig, bone, angle) {
    const out = rig.pose, o = bone * 8, j = rig.bind[bone], s = rig.s;
    const h = angle * 0.5, sy = Math.sin(h), cy = Math.cos(h);
    const px = out[o], py = out[o + 1], pz = out[o + 2], pw = out[o + 3];
    // where the joint is now
    const qrot = (qx, qy, qz, qw, x, y, z, r) => {
      const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
      r[0] = ix * qw - iw * qx - iy * qz + iz * qy; r[1] = iy * qw - iw * qy - iz * qx + ix * qz; r[2] = iz * qw - iw * qz - ix * qy + iy * qx;
    };
    const a = [0, 0, 0], b = [0, 0, 0];
    qrot(px, py, pz, pw, j.x * s, j.y * s, j.z * s, a);
    const jx = a[0] + out[o + 4], jy = a[1] + out[o + 5], jz = a[2] + out[o + 6];
    const nx = cy * px + sy * pz, ny = cy * py + sy * pw, nz = cy * pz - sy * px, nw = cy * pw - sy * py;
    out[o] = nx; out[o + 1] = ny; out[o + 2] = nz; out[o + 3] = nw;
    qrot(nx, ny, nz, nw, j.x * s, j.y * s, j.z * s, b);
    out[o + 4] = jx - b[0]; out[o + 5] = jy - b[1]; out[o + 6] = jz - b[2];
  }
}

const crowdMotionLoaded = () => clips.size > 0;

export { CrowdMotion, loadCrowdMotion, crowdMotionLoaded };
