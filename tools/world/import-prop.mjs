// A street prop from Poly Haven (CC0): its glTF flattened into one mesh in metres, simplified, textures made small.
// Usage: node import-prop.mjs <work folder> <polyhaven id> <name> <triangles> [--out dir]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';

const args = process.argv.slice(2);
const [WORK, ID, NAME, TRIANGLES] = args;
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : new URL('../../assets/world/', import.meta.url).pathname;
const AGENT = { headers: { 'User-Agent': 'overdraft-game-tools' } };
const folder = path.join(WORK, ID);
fs.mkdirSync(folder, { recursive: true });
const files = await (await fetch(`https://api.polyhaven.com/files/${ID}`, AGENT)).json();
const entry = files.gltf['1k'].gltf;
const save = async (url, name) => {
  const target = path.join(folder, name);
  if (fs.existsSync(target) && fs.statSync(target).size) return target;
  const r = await fetch(url, AGENT);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(await r.arrayBuffer()));
  return target;
};
const gltfFile = await save(entry.url, 'model.gltf');
for (const [rel, f] of Object.entries(entry.include)) await save(f.url, rel);
const gltf = JSON.parse(fs.readFileSync(gltfFile, 'utf8'));
const bin = fs.readFileSync(path.join(folder, gltf.buffers[0].uri));

const TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor(i) {
  const a = gltf.accessors[i], v = gltf.bufferViews[a.bufferView], T = TYPES[a.componentType], n = SIZE[a.type];
  const start = bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = v.byteStride ?? n * T.BYTES_PER_ELEMENT;
  const out = new Float64Array(a.count * n);
  const view = new DataView(bin.buffer);
  for (let e = 0; e < a.count; e++) for (let c = 0; c < n; c++) {
    const at = start + e * stride + c * T.BYTES_PER_ELEMENT;
    out[e * n + c] = T === Float32Array ? view.getFloat32(at, true) : T === Uint32Array ? view.getUint32(at, true) : T === Uint16Array ? view.getUint16(at, true) : view.getUint8(at);
  }
  return out;
}
const multiply = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
const pos = [], nor = [], uv = [], index = [];
function addNode(i, parent) {
  const node = gltf.nodes[i], m = multiply(parent, nodeMatrix(node));
  if (node.mesh !== undefined) for (const p of gltf.meshes[node.mesh].primitives) {
    const P = accessor(p.attributes.POSITION), N = accessor(p.attributes.NORMAL), T = accessor(p.attributes.TEXCOORD_0), I = accessor(p.indices);
    const base = pos.length / 3;
    for (let v = 0; v < P.length / 3; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], a = N[v * 3], b = N[v * 3 + 1], c = N[v * 3 + 2];
      pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
      const nx = m[0] * a + m[4] * b + m[8] * c, ny = m[1] * a + m[5] * b + m[9] * c, nz = m[2] * a + m[6] * b + m[10] * c, l = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / l, ny / l, nz / l);
      uv.push(T[v * 2], T[v * 2 + 1]);
    }
    for (const k of I) index.push(k + base);
  }
  for (const c of node.children ?? []) addNode(c, m);
}
for (const i of gltf.scenes[gltf.scene ?? 0].nodes) addNode(i, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

// Stands on y = 0, centred
const count = pos.length / 3;
let [x0, y0, z0, x1, y1, z1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (let i = 0; i < count; i++) { x0 = Math.min(x0, pos[i * 3]); x1 = Math.max(x1, pos[i * 3]); y0 = Math.min(y0, pos[i * 3 + 1]); y1 = Math.max(y1, pos[i * 3 + 1]); z0 = Math.min(z0, pos[i * 3 + 2]); z1 = Math.max(z1, pos[i * 3 + 2]); }
const position = new Float32Array(count * 3);
for (let i = 0; i < count; i++) { position[i * 3] = pos[i * 3] - (x0 + x1) / 2; position[i * 3 + 1] = pos[i * 3 + 1] - y0; position[i * 3 + 2] = pos[i * 3 + 2] - (z0 + z1) / 2; }
const normal = Float32Array.from(nor), texcoord = Float32Array.from(uv);
await MeshoptSimplifier.ready;
const attrs = new Float32Array(count * 5);
for (let i = 0; i < count; i++) attrs.set([uv[i * 2], uv[i * 2 + 1], nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]], i * 5);
const [kept] = MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(index), position, 3, attrs, 5, [1, 1, 0.4, 0.4, 0.4], null, +TRIANGLES * 3, 0.05, []);
const used = new Map();
const faces = Uint32Array.from(kept, (o) => { if (!used.has(o)) used.set(o, used.size); return used.get(o); });
const pick = (src, n) => { const a = new Float32Array(used.size * n); for (const [o, i] of used) for (let c = 0; c < n; c++) a[i * n + c] = src[o * n + c]; return a; };
const sections = [pick(position, 3), pick(normal, 3), pick(texcoord, 2), faces];
const json = Buffer.from(JSON.stringify({ size: [x1 - x0, y1 - y0, z1 - z0], sections: sections.map((a) => a.byteLength) }));
const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
const u32 = Buffer.alloc(4);
u32.writeUInt32LE(json.length);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `prop-${NAME}.bin`), Buffer.concat([pad(Buffer.concat([u32, json])), ...sections.map((a) => pad(Buffer.from(a.buffer, a.byteOffset, a.byteLength)))]));
const textures = Object.keys(entry.include);
const find = (key) => textures.find((t) => t.includes(`_${key}_`));
await sharp(path.join(folder, find('diff'))).resize(512, 512).webp({ quality: 82, effort: 5 }).toFile(path.join(OUT, `prop-${NAME}_c.webp`));
await sharp(path.join(folder, find('nor_gl'))).resize(512, 512).webp({ quality: 84, effort: 5 }).toFile(path.join(OUT, `prop-${NAME}_n.webp`));
console.log(NAME, `${index.length / 3} -> ${faces.length / 3} triangles`, [x1 - x0, y1 - y0, z1 - z0].map((v) => v.toFixed(2)).join(' x '), 'm');
