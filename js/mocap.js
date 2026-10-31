import { fetchBuffer } from './people-assets.js';

// Motion capture: every clip of assets/people/mocap.bin, sampled into poses that a Body (person-body.js) wears. A pose is
// one rotation per captured bone, the first of them (the pelvis) in world space, then the pelvis position.

const mocap = { bones: [], clips: new Map(), fps: 30 };

async function loadMocap() {
  const buffer = await fetchBuffer('mocap.bin');
  const headLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headLength)));
  mocap.bones = header.bones;
  mocap.fps = header.fps;
  const total = header.clips.reduce((n, c) => n + c.frames, 0);
  const start = (4 + headLength + 3) & ~3;
  const pelvis = new Float32Array(buffer, start, total * 3);
  const quats = new Int16Array(buffer, start + total * 12, total * header.bones.length * 4);
  for (const clip of header.clips) {
    clip.pelvis = pelvis.subarray(clip.start * 3, (clip.start + clip.frames) * 3);
    clip.quats = quats.subarray(clip.start * header.bones.length * 4, (clip.start + clip.frames) * header.bones.length * 4);
    clip.stride = clip.speed * clip.duration;
    mocap.clips.set(clip.name, clip);
  }
  return mocap;
}

const newPose = () => new Float32Array(mocap.bones.length * 4 + 3);

// The clip at normalised time u (0..1) into `out`. Looping clips were captured to close on their first frame
function sample(clip, u, out) {
  const n = clip.frames - 1;
  const at = Math.min(n - 1e-4, Math.max(0, u * n));
  const f = Math.floor(at), k = at - f, l = 1 - k;
  const count = mocap.bones.length * 4;
  const q = clip.quats;
  let a = f * count, b = a + count;
  for (let i = 0; i < count; i += 4, a += 4, b += 4) {
    const x = q[a] * l + q[b] * k, y = q[a + 1] * l + q[b + 1] * k, z = q[a + 2] * l + q[b + 2] * k, w = q[a + 3] * l + q[b + 3] * k;
    const s = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
    out[i] = x * s; out[i + 1] = y * s; out[i + 2] = z * s; out[i + 3] = w * s;
  }
  const p = clip.pelvis;
  for (let c = 0; c < 3; c++) out[count + c] = p[f * 3 + c] * l + p[(f + 1) * 3 + c] * k;
  return out;
}

// a := a * (1 - w) + b * w, for bones i where mask (optional) is set
function blend(a, b, w, mask = null) {
  const bones = mocap.bones.length;
  const l = 1 - w;
  for (let i = 0, o = 0; i < bones; i++, o += 4) {
    const m = mask ? mask[i] * w : w;
    if (m <= 0) continue;
    const r = 1 - m;
    const s = a[o] * b[o] + a[o + 1] * b[o + 1] + a[o + 2] * b[o + 2] + a[o + 3] * b[o + 3] < 0 ? -m : m;
    const x = a[o] * r + b[o] * s, y = a[o + 1] * r + b[o + 1] * s, z = a[o + 2] * r + b[o + 2] * s, w2 = a[o + 3] * r + b[o + 3] * s;
    const n = 1 / Math.sqrt(x * x + y * y + z * z + w2 * w2);
    a[o] = x * n; a[o + 1] = y * n; a[o + 2] = z * n; a[o + 3] = w2 * n;
  }
  if (!mask) for (let c = bones * 4; c < bones * 4 + 3; c++) a[c] = a[c] * l + b[c] * w;
  return a;
}

export { mocap, loadMocap, newPose, sample, blend };
