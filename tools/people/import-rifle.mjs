// The assault rifle (CC0, nisu on OpenGameArt): a textured FBX, turned into the same files as the guns of import-weapon.mjs.
// Usage: node import-rifle.mjs <folder of the unpacked M4A1 archive>
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import sharp from 'sharp';
import { readFBX } from './fbx.mjs';

const dir = process.argv[2];
const OUT = new URL('../../assets/people/', import.meta.url).pathname;
const root = readFBX(path.join(dir, 'M4A1.fbx'));
const meshes = [];
root.traverse((o) => { if (o.isMesh) meshes.push(o); });
const pos = [], nor = [], uv = [], index = [];
const v = new THREE.Vector3(), n = new THREE.Vector3();
for (const mesh of meshes) {
  const g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal, T = g.attributes.uv;
  const m3 = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const seen = new Map();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld);
    n.fromBufferAttribute(N, i).applyMatrix3(m3).normalize();
    const tag = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)},${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)},${T.getX(i).toFixed(4)},${T.getY(i).toFixed(4)}`;
    let at = seen.get(tag);
    if (at === undefined) { at = pos.length / 3; seen.set(tag, at); pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); uv.push(T.getX(i), 1 - T.getY(i)); }
    index.push(at);
  }
}
const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
for (let i = 0; i < pos.length; i++) { min[i % 3] = Math.min(min[i % 3], pos[i]); max[i % 3] = Math.max(max[i % 3], pos[i]); }
console.log(meshes.length, 'meshes', pos.length / 3, 'v', index.length / 3, 't', min.map((x) => x.toFixed(2)).join(), max.map((x) => x.toFixed(2)).join());
const axisOf = process.argv[3] ? process.argv[3].split(',').map(Number) : null; // barrel axis (0 x, 1 y, 2 z), sign, up axis, sign, length m, origin y, z
if (!axisOf) process.exit(0);
const [za, zs, ya, ys, length, oy, oz] = axisOf;
const k = length / (max[za] - min[za]);
const xa = 3 - za - ya;
const handed = ((ya + 1) % 3 === za ? 1 : -1) * zs * ys; // x = y × z
const c = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
const position = [], normal = [];
for (let i = 0; i < pos.length; i += 3) {
  const p = [pos[i] - c[0], pos[i + 1] - c[1], pos[i + 2] - c[2]];
  position.push(p[xa] * k * handed, p[ya] * k * ys - oy, p[za] * k * zs - oz);
  normal.push(nor[i + xa] * handed, nor[i + ya] * ys, nor[i + za] * zs);
}
const header = { sections: [position.length * 4, normal.length * 4, uv.length * 4, index.length * 4] };
const json = Buffer.from(JSON.stringify(header));
const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
const u32 = Buffer.alloc(4); u32.writeUInt32LE(json.length);
const buf = (a) => pad(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
fs.writeFileSync(path.join(OUT, 'gun-rifle.bin'), Buffer.concat([pad(Buffer.concat([u32, json])), buf(Float32Array.from(position)), buf(Float32Array.from(normal)), buf(Float32Array.from(uv)), buf(Uint32Array.from(index))]));
await sharp(path.join(dir, 'M4A1_Base_Color.png')).resize(1024).webp({ quality: 88, effort: 5 }).toFile(path.join(OUT, 'gun-rifle_c.webp'));
await sharp(path.join(dir, 'M4A1_Normal.png')).resize(1024).webp({ quality: 92, effort: 5 }).toFile(path.join(OUT, 'gun-rifle_n.webp'));
// what the material reads as specular: the inverse of roughness
await sharp(path.join(dir, 'M4A1_Roughness.png')).resize(512).negate({ alpha: false }).webp({ quality: 80, effort: 5 }).toFile(path.join(OUT, 'gun-rifle_s.webp'));
console.log('rifle', position.length / 3, 'scale', k.toFixed(4));
