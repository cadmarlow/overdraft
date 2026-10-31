// Lifts a weapon worn by a Rocketbox avatar off the body: one material of an imported avatar (.bin) becomes a rigid mesh in
// its own space, +Z along the barrel, +Y up, origin at the top of the grip.
// Usage: node import-weapon.mjs <name> <avatar.bin> <part> <avatar texture prefix> <flipZ> <flipY> <tilt> <x y z of the origin> [scale]
import fs from 'node:fs';
import path from 'node:path';

const [name, file, partName, prefix, flipZ = '1', flipY = '1', tilt = '0', ox = '0', oy = '0', oz = '0', scale = '1'] = process.argv.slice(2);
const OUT = new URL('../../assets/people/', import.meta.url).pathname;
const b = fs.readFileSync(file);
const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const hl = new DataView(ab).getUint32(0, true);
const h = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, hl)));
const align = (n) => (n + 3) & ~3;
let o = align(4 + hl);
const take = (T, bytes) => { const a = new T(ab, o, bytes / T.BYTES_PER_ELEMENT); o = align(o + bytes); return a; };
const [pB, nB, uB, iB, wB, fB] = h.sections;
const P = take(Float32Array, pB), N = take(Float32Array, nB), UV = take(Float32Array, uB);
take(Uint8Array, iB); take(Uint8Array, wB);
const F = take(Uint32Array, fB);
const part = h.parts.find((p) => p.name === partName);
const used = new Map();
const index = [];
for (let i = part.start; i < part.start + part.count; i++) {
  const v = F[i];
  if (!used.has(v)) used.set(v, used.size);
  index.push(used.get(v));
}
const verts = [...used.keys()];
// Principal axes: the longest becomes the barrel
const c = [0, 0, 0];
for (const v of verts) for (let k = 0; k < 3; k++) c[k] += P[v * 3 + k] / verts.length;
const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
for (const v of verts) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += (P[v * 3 + i] - c[i]) * (P[v * 3 + j] - c[j]);
const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const power = (seed, skip = []) => {
  let v = norm(seed);
  for (let i = 0; i < 200; i++) { v = mul(cov, v); for (const s of skip) { const d = dot(v, s); v = v.map((x, k) => x - d * s[k]); } v = norm(v); }
  return v;
};
let z = power([0.3, 1, 0.2]);
let y = power([1, 0.2, 0.4], [z]);
if (flipZ === '-1') z = z.map((x) => -x);
if (flipY === '-1') y = y.map((x) => -x);
// the longest axis of a gun leans towards its grip: tilt levels the barrel
if (+tilt) { const ca = Math.cos(+tilt), sa = Math.sin(+tilt); const ny = y.map((v, k) => v * ca - z[k] * sa), nz = z.map((v, k) => y[k] * sa + v * ca); y = ny; z = nz; }
const x = cross(y, z);
const S = +scale;
const position = [], normal = [], uv = [];
for (const v of verts) {
  const p = [0, 1, 2].map((k) => P[v * 3 + k] - c[k]);
  position.push(dot(p, x) * S - +ox, dot(p, y) * S - +oy, dot(p, z) * S - +oz);
  const n = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
  normal.push(dot(n, x), dot(n, y), dot(n, z));
  uv.push(UV[v * 2], UV[v * 2 + 1]);
}
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < position.length; i++) { mn[i % 3] = Math.min(mn[i % 3], position[i]); mx[i % 3] = Math.max(mx[i % 3], position[i]); }
const header = { sections: [position.length * 4, normal.length * 4, uv.length * 4, index.length * 4] };
const json = Buffer.from(JSON.stringify(header));
const pad = (buf) => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4)]);
const u32 = Buffer.alloc(4); u32.writeUInt32LE(json.length);
const buf = (a) => pad(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
fs.writeFileSync(path.join(OUT, `gun-${name}.bin`), Buffer.concat([pad(Buffer.concat([u32, json])), buf(Float32Array.from(position)), buf(Float32Array.from(normal)), buf(Float32Array.from(uv)), buf(Uint32Array.from(index))]));
for (const t of ['c', 'n', 's']) fs.copyFileSync(`${prefix}_${partName}_${t}.webp`, path.join(OUT, `gun-${name}_${t}.webp`));
console.log(name, verts.length, 'v', index.length / 3, 't', mn.map((v) => v.toFixed(3)).join(','), '..', mx.map((v) => v.toFixed(3)).join(','));
