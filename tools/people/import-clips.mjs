// Packs Rocketbox motion capture into assets/people/mocap.bin: one take per clip at 30 frames a second, every body bone's
// rotation (local to its parent) and the pelvis in world space, with the walk's steady forward travel taken out and
// kept as the clip's speed. Usage: node import-clips.mjs <dir of .fbx> [--out dir]
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { readFBX } from './fbx.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const DIR = args[0];
const OUT = flag('out', new URL('../../assets/people/', import.meta.url).pathname);
const FPS = 30;
const FINGERS = ['0', '01', '02', '1', '11', '12', '2', '21', '22', '3', '31', '32', '4', '41', '42'];
const SIDE = ['Clavicle', 'UpperArm', 'Forearm', 'Hand', ...FINGERS.map((f) => `Finger${f}`), 'Thigh', 'Calf', 'Foot', 'Toe0'];
const BONES = ['Pelvis', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', ...['L', 'R'].flatMap((s) => SIDE.map((b) => `${s}_${b}`))];
const INT = 32767;

const quats = [], pelvis = [], clips = [];
let quatFrames = 0;
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.fbx')).sort()) {
  const root = readFBX(path.join(DIR, file));
  const clip = root.animations[0];
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const bones = BONES.map((b) => root.getObjectByName(`Bip01_${b}`));
  const missing = BONES.filter((_, i) => !bones[i]);
  if (missing.length) { console.log(`${file}: no ${missing.join(' ')}`); continue; }
  const frames = Math.max(2, Math.round(clip.duration * FPS) + 1);
  const P = [], Q = new Float32Array(frames * BONES.length * 4), gap = [];
  const left = root.getObjectByName("Bip01_L_Foot"), right = root.getObjectByName("Bip01_R_Foot"), l = new THREE.Vector3(), r = new THREE.Vector3();
  const pos = new THREE.Vector3(), rot = new THREE.Quaternion(), scale = new THREE.Vector3();
  for (let f = 0; f < frames; f++) {
    mixer.setTime(Math.min(clip.duration * 0.99999, (f / (frames - 1)) * clip.duration));
    root.updateMatrixWorld(true);
    bones.forEach((b, i) => {
      const q = i === 0 ? rot.setFromRotationMatrix(b.matrixWorld) : b.quaternion;
      Q.set([q.x, q.y, q.z, q.w], (f * BONES.length + i) * 4);
    });
    bones[0].matrixWorld.decompose(pos, rot, scale);
    P.push(pos.x * 0.01, pos.y * 0.01, pos.z * 0.01);
    gap.push(left.getWorldPosition(l).z - right.getWorldPosition(r).z);
  }
  const dx = P[(frames - 1) * 3] - P[0], dz = P[(frames - 1) * 3 + 2] - P[2];
  // Travel in place; turns keep theirs, a loop's speed is what playback will be matched to
  const name = file.replace('.fbx', '');
  const travels = /walk|run/.test(name);
  if (travels) for (let f = 0; f < frames; f++) {
    const k = f / (frames - 1);
    P[f * 3] -= P[0] + dx * k - P[0];
    P[f * 3 + 2] -= P[2] + dz * k - P[2];
  }
  // Keeps every rotation on the same side as the frame before it, so sampling can blend them without a check
  for (let i = 0; i < BONES.length; i++) for (let f = 1; f < frames; f++) {
    const a = ((f - 1) * BONES.length + i) * 4, b = (f * BONES.length + i) * 4;
    if (Q[a] * Q[b] + Q[a + 1] * Q[b + 1] + Q[a + 2] * Q[b + 2] + Q[a + 3] * Q[b + 3] < 0) for (let c = 0; c < 4; c++) Q[b + c] = -Q[b + c];
  }
  // Gaits line up on the moment the left foot passes the right, going forward
  let sync = 0;
  for (let f = 0; f < frames - 1; f++) if (gap[f] < 0 && gap[f + 1] >= 0) { sync = (f + gap[f] / (gap[f] - gap[f + 1])) / (frames - 1); break; }
  clips.push({ name, frames, duration: clip.duration, speed: travels ? Math.hypot(dx, dz) / clip.duration : 0, sync, start: quatFrames });
  quats.push(Int16Array.from(Q, (v) => Math.round(v * INT)));
  pelvis.push(Float32Array.from(P));
  quatFrames += frames;
  console.log(`${name}: ${frames} frames, ${clip.duration.toFixed(2)} s, ${clips.at(-1).speed.toFixed(2)} m/s, pelvis ${P[1].toFixed(2)}`);
}
const header = { fps: FPS, bones: BONES, clips };
const json = Buffer.from(JSON.stringify(header));
const pad = (b, n = 4) => Buffer.concat([b, Buffer.alloc((n - (b.length % n)) % n)]);
const u32 = Buffer.alloc(4); u32.writeUInt32LE(json.length);
const buf = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const file = Buffer.concat([pad(Buffer.concat([u32, json])), ...pelvis.map(buf), ...quats.map(buf)]);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'mocap.bin'), file);
console.log(`${clips.length} clips, ${quatFrames} frames, ${(file.length / 1e6).toFixed(2)} MB`);
