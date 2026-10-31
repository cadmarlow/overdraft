// What passers-by hold in a hand: placed in the palm of the crowd's skeleton and tied to the wrist, so it goes wherever the
// captured arm takes it. One of each per sex, since their arms differ. Written to assets/humans, with the sculpted props.
// Usage: node import-held.mjs <male avatar.fbx> <female avatar.fbx>
import fs from 'node:fs';
import * as THREE from 'three';
import { readAvatar, packed } from './avatar.mjs';
import { bipToGame } from './bip-map.mjs';
import { BONE, BONE_COUNT, bindJointPositions } from '../../js/human-skeleton.js';

const [maleFile, femaleFile] = process.argv.slice(2);
const OUT = new URL('../../assets/humans/', import.meta.url).pathname;
const PART = { BRIGHT: 2, DARK: 7 };

// Parts of the umbrella come from the sculpted one, the others are simple shapes
function readProp(name) {
  const b = fs.readFileSync(`${OUT}${name}.bin`);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const hl = new DataView(ab).getUint32(0, true);
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, hl)));
  const align = (n) => (n + 3) & ~3;
  let o = align(4 + hl);
  const take = (T, bytes) => { const a = new T(ab, o, bytes / T.BYTES_PER_ELEMENT); o = align(o + bytes); return a; };
  const [p, n, i, w, part, f] = h.sections;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(take(Float32Array, p).slice(), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(take(Float32Array, n).slice(), 3));
  take(Uint8Array, i); take(Uint8Array, w); take(Uint8Array, part);
  g.setIndex(new THREE.BufferAttribute(take(Uint32Array, f).slice(), 1));
  return g;
}

const SHAFT_FROM = new THREE.Vector3(-0.055, 1.24, 0.2), SHAFT_TO = new THREE.Vector3(-0.045, 2.14, 0.09);

function write(name, geometry, part, bone) {
  const g = geometry.index ? geometry : null;
  const count = geometry.attributes.position.count;
  const skinIndex = new Uint8Array(count * 4), skinWeight = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) { skinIndex[i * 4] = bone; skinWeight[i * 4] = 255; }
  const parts = new Uint8Array(count).fill(part);
  const index = Uint32Array.from(g.index.array);
  const position = Float32Array.from(geometry.attributes.position.array), normal = Float32Array.from(geometry.attributes.normal.array);
  fs.writeFileSync(`${OUT}${name}.bin`, packed({ vertices: count, indices: index.length, sections: [position.byteLength, normal.byteLength, count * 4, count * 4, count, index.byteLength] }, [position, normal, skinIndex, skinWeight, parts, index]));
  console.log(name, count, 'vertices');
}

// Where a point on the left hand sits, on average through a take, in the chest bone's bind space
const motion = (() => {
  const file = fs.readFileSync(new URL('../../assets/people/crowd-motion.bin', import.meta.url));
  const ab = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const headLength = new DataView(ab).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, headLength)));
  return { header, table: new Int16Array(ab, (4 + headLength + 3) & ~3) };
})();
function meanInChest(name, point) {
  const { header, table } = motion;
  const clip = header.clips.find((c) => c.name === name);
  const read = (f, bone) => {
    const o = (clip.start + f) * BONE_COUNT * 7 + bone * 7;
    return { q: new THREE.Quaternion(table[o], table[o + 1], table[o + 2], table[o + 3]).normalize(), t: new THREE.Vector3(table[o + 4], table[o + 5], table[o + 6]).divideScalar(header.posScale) };
  };
  const sum = new THREE.Vector3();
  for (let f = 0; f < clip.frames; f++) {
    const hand = read(f, BONE.HAND_L), chest = read(f, BONE.CHEST);
    sum.add(point.clone().applyQuaternion(hand.q).add(hand.t).sub(chest.t).applyQuaternion(chest.q.clone().invert()));
  }
  return sum.divideScalar(clip.frames);
}

for (const [sex, file, phoneHand] of [['m', maleFile, 0], ['f', femaleFile, 1]]) {
  const avatar = readAvatar(file);
  const { mapping } = bipToGame(avatar.skeleton, avatar.bind, bindJointPositions(sex === 'f'));
  const at = (name) => avatar.skeleton.findIndex((b) => b.name === name);
  const point = (name) => new THREE.Vector3(...avatar.bind.slice(at(name) * 7, at(name) * 7 + 3));
  // The hand i (0 left) in the game's bind pose: palm centre, along the fingers, towards the index, out of the palm
  const hand = (i) => {
    const s = i ? 'R' : 'L';
    const m = mapping[at(`${s}_Hand`)];
    const wrist = point(`${s}_Hand`), middle = point(`${s}_Finger2`);
    const f = middle.clone().sub(wrist).applyQuaternion(m.swing);
    const length = f.length();
    f.normalize();
    const a = point(`${s}_Finger1`).sub(point(`${s}_Finger4`)).applyQuaternion(m.swing);
    a.addScaledVector(f, -a.dot(f)).normalize();
    const n = new THREE.Vector3().crossVectors(f, a).multiplyScalar(i ? -1 : 1);
    const palm = m.to.clone().addScaledVector(f, length * 0.72).addScaledVector(n, 0.03);
    return { f, a, n, palm, bone: i ? BONE.HAND_R : BONE.HAND_L };
  };
  // Geometry built along (x, y, z), laid along hand axes (right-handed), centred at `at`
  const place = (g, x, y, z, centre) => {
    const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(centre);
    return g.applyMatrix4(m);
  };
  {
    const h = hand(phoneHand);
    const box = new THREE.BoxGeometry(0.072, 0.148, 0.009);
    const c = new THREE.Vector3().crossVectors(h.a, h.f);
    write(`held-phone-${sex}`, place(box, h.a, h.f, c, h.palm.clone().addScaledVector(h.n, 0.012)), PART.DARK, h.bone);
  }
  {
    const h = hand(1);
    const cup = new THREE.CylinderGeometry(0.041, 0.031, 0.115, 12);
    const c = new THREE.Vector3().crossVectors(h.f, h.a);
    write(`held-coffee-${sex}`, place(cup, h.f, h.a, c, h.palm.clone().addScaledVector(h.n, 0.04)), PART.BRIGHT, h.bone);
  }
  {
    // Upright over the head whatever the hand does: tied to the chest, where the captured take keeps the left hand
    const h = hand(0);
    const grip = meanInChest(`${sex}_umbrella_idle_01`, h.palm.clone().addScaledVector(h.n, 0.018));
    const g = readProp('prop-umbrella');
    const shaft = SHAFT_TO.clone().sub(SHAFT_FROM).normalize();
    g.translate(-SHAFT_FROM.x, -SHAFT_FROM.y, -SHAFT_FROM.z);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(shaft, new THREE.Vector3(0.03, 1, 0.1).normalize()));
    g.translate(grip.x, grip.y - 0.08, grip.z);
    write(`held-umbrella-${sex}`, g, PART.DARK, BONE.CHEST);
  }
}
