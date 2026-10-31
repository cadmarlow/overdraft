// Motion capture for the crowd: chosen clips of mocap.bin, carried over onto the game's 23 bones as ready-made poses, so a
// passer-by's pose costs a table lookup. Each bone is stored as in PersonRig.pose (rotation, then position), for a person
// of scale 1 at the origin facing +Z.
// Usage: node bake-crowd-motion.mjs <male avatar.fbx> <female avatar.fbx>
import fs from 'node:fs';
import * as THREE from 'three';
import { readAvatar, packed } from './avatar.mjs';
import { bipToGame } from './bip-map.mjs';
import { BONE, BONE_COUNT, LIMB, bindJointPositions } from '../../js/human-skeleton.js';

const [maleFile, femaleFile] = process.argv.slice(2);
const OUT = new URL('../../assets/people/', import.meta.url).pathname;
const mocapFile = fs.readFileSync(`${OUT}mocap.bin`);
const ab = mocapFile.buffer.slice(mocapFile.byteOffset, mocapFile.byteOffset + mocapFile.byteLength);
const headLength = new DataView(ab).getUint32(0, true);
const mocap = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, headLength)));
const total = mocap.clips.reduce((n, c) => n + c.frames, 0);
const start = (4 + headLength + 3) & ~3;
const pelvisAll = new Float32Array(ab, start, total * 3);
const quatsAll = new Int16Array(ab, start + total * 12, total * mocap.bones.length * 4);

const MAX_SECONDS = 14; // standing takes are long; a person never watches one for that long
const CLIPS = {
  m: ['walk_slow_01', 'walk_neutral', 'walk_fast_01', 'walk_cool_01', 'run_slow_01', 'run_neutral', 'run_fast_01', 'idle_neutral_01', 'idle_neutral_02', 'idle_look_around_01', 'idle_waiting_01', 'cell_phone_textmessage', 'drink_idle', 'umbrella_idle_01'],
  f: ['walk_slow_01', 'walk_neutral', 'walk_fast_01', 'walk_cool_01', 'run_slow_01', 'run_neutral', 'run_fast_01', 'idle_neutral_01', 'idle_neutral_02', 'idle_look_around_01', 'idle_waiting_01', 'cell_phone_textmessage', 'drink_idle', 'umbrella_idle_01']
};

const POS_SCALE = 32767 / 4;
const header = { bones: BONE_COUNT, fps: mocap.fps, clips: [], posScale: POS_SCALE };
const chunks = [];
let frameAt = 0;
for (const [sex, file] of [['m', maleFile], ['f', femaleFile]]) {
  const avatar = readAvatar(file);
  const joints = bindJointPositions(sex === 'f');
  const { mapping } = bipToGame(avatar.skeleton, avatar.bind, joints);
  const n = avatar.skeleton.length;
  const index = new Map(avatar.skeleton.map((b, i) => [b.name, i]));
  const bindP = [], bindQ = [], localP = [];
  for (let i = 0; i < n; i++) {
    bindP.push(new THREE.Vector3(...avatar.bind.slice(i * 7, i * 7 + 3)));
    bindQ.push(new THREE.Quaternion(...avatar.bind.slice(i * 7 + 3, i * 7 + 7)));
    const p = avatar.skeleton[i].parent;
    localP.push(p < 0 ? new THREE.Vector3() : bindP[i].clone().sub(bindP[p]).applyQuaternion(bindQ[p].clone().invert()));
  }
  const bindLocal = bindQ.map((q, i) => { const p = avatar.skeleton[i].parent; return p < 0 ? q.clone() : bindQ[p].clone().invert().multiply(q); });
  const clipBone = mocap.bones.map((name) => index.get(name) ?? -1);
  // game bone -> the Biped bone that moves it
  const moved = new Array(BONE_COUNT);
  const set = (g, name) => { moved[g] = index.get(name); };
  set(BONE.PELVIS, 'Pelvis'); set(BONE.SPINE, 'Spine'); set(BONE.CHEST, 'Spine2'); set(BONE.NECK, 'Neck'); set(BONE.HEAD, 'Head');
  for (const [k, s] of [[0, 'L'], [1, 'R']]) {
    set(LIMB.clavicle[k], `${s}_Clavicle`); set(LIMB.upperArm[k], `${s}_UpperArm`); set(LIMB.forearm[k], `${s}_Forearm`); set(LIMB.hand[k], `${s}_Hand`);
    set(LIMB.fingers[k], `${s}_Finger2`); set(LIMB.thigh[k], `${s}_Thigh`); set(LIMB.shin[k], `${s}_Calf`); set(LIMB.foot[k], `${s}_Foot`); set(LIMB.toe[k], `${s}_Toe0`);
  }
  for (const short of CLIPS[sex]) {
    const name = `${sex}_${short}`;
    const clip = mocap.clips.find((c) => c.name === name);
    if (!clip) { console.log('no', name); continue; }
    const frames = Math.min(clip.frames, MAX_SECONDS * mocap.fps);
    const table = new Int16Array(frames * BONE_COUNT * 7);
    const wq = bindQ.map((q) => q.clone()), wp = bindP.map((p) => p.clone());
    const q = new THREE.Quaternion(), v = new THREE.Vector3(), t = new THREE.Vector3(), d = new THREE.Quaternion(), g = new THREE.Quaternion();
    const locals = bindLocal.map((l) => l.clone());
    for (let f = 0; f < frames; f++) {
      const base = (clip.start + f) * mocap.bones.length * 4;
      clipBone.forEach((b, i) => { if (b >= 0) locals[b].set(quatsAll[base + i * 4], quatsAll[base + i * 4 + 1], quatsAll[base + i * 4 + 2], quatsAll[base + i * 4 + 3]).normalize(); });
      for (let i = 0; i < n; i++) {
        const p = avatar.skeleton[i].parent;
        if (p < 0) {
          wq[i].copy(locals[i]);
          wp[i].set(pelvisAll[(clip.start + f) * 3], pelvisAll[(clip.start + f) * 3 + 1], pelvisAll[(clip.start + f) * 3 + 2]);
        } else {
          wq[i].copy(wq[p]).multiply(locals[i]);
          wp[i].copy(wp[p]).add(v.copy(localP[i]).applyQuaternion(wq[p]));
        }
      }
      for (let b = 0; b < BONE_COUNT; b++) {
        const i = moved[b], m = mapping[i];
        // this bone's rigid move, then the way from the game's bind pose to the avatar's
        d.copy(wq[i]).multiply(q.copy(bindQ[i]).invert());
        g.copy(d).multiply(q.copy(m.swing).invert());
        t.copy(m.from).sub(bindP[i]).applyQuaternion(d).add(wp[i]);
        t.sub(v.copy(m.to).applyQuaternion(g));
        const o = (f * BONE_COUNT + b) * 7;
        const flip = g.w < 0 ? -1 : 1;
        table[o] = Math.round(g.x * flip * 32767); table[o + 1] = Math.round(g.y * flip * 32767); table[o + 2] = Math.round(g.z * flip * 32767); table[o + 3] = Math.round(g.w * flip * 32767);
        table[o + 4] = Math.round(t.x * POS_SCALE); table[o + 5] = Math.round(t.y * POS_SCALE); table[o + 6] = Math.round(t.z * POS_SCALE);
      }
    }
    header.clips.push({ name, frames, duration: ((frames - 1) / (clip.frames - 1)) * clip.duration, speed: clip.speed, stride: clip.speed * clip.duration, sync: clip.sync, start: frameAt });
    chunks.push(table);
    frameAt += frames;
  }
}
const all = new Int16Array(frameAt * BONE_COUNT * 7);
let o = 0;
for (const c of chunks) { all.set(c, o); o += c.length; }
const data = packed(header, [all]);
fs.writeFileSync(`${OUT}crowd-motion.bin`, data);
console.log(`${header.clips.length} clips, ${frameAt} frames, ${(data.length / 1e6).toFixed(2)} MB`);
