// A glTF binary read into plain arrays: buffers decoded (EXT_meshopt_compression), accessors as floats, nodes with world matrices.
import fs from 'node:fs';

const TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const NORMALIZE = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
const multiply = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}

export async function readGlb(file) {
  const raw = fs.readFileSync(file);
  if (raw.length < 28 || raw.readUInt32LE(0) !== 0x46546c67 || raw.readUInt32LE(4) !== 2 || raw.readUInt32LE(8) !== raw.length) throw new Error(`Invalid glTF binary: ${file}`);
  const length = raw.readUInt32LE(12);
  if (raw.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`Missing JSON chunk: ${file}`);
  const gltf = JSON.parse(raw.subarray(20, 20 + length).toString());
  const bin = raw.subarray(20 + length + 8);
  let MeshoptDecoder;
  if (gltf.bufferViews.some((v) => v.extensions?.EXT_meshopt_compression)) {
    ({ MeshoptDecoder } = await import('meshoptimizer'));
    await MeshoptDecoder.ready;
  }
  const views = gltf.bufferViews.map((v) => {
    const e = v.extensions?.EXT_meshopt_compression;
    if (!e) return bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    const source = bin.subarray(e.byteOffset ?? 0, (e.byteOffset ?? 0) + e.byteLength);
    const out = new Uint8Array(e.count * e.byteStride);
    MeshoptDecoder.decodeGltfBuffer(out, e.count, e.byteStride, source, e.mode, e.filter);
    return Buffer.from(out.buffer);
  });
  function accessor(i, normalise = true) {
    const a = gltf.accessors[i], view = gltf.bufferViews[a.bufferView], data = views[a.bufferView];
    const T = TYPES[a.componentType], n = SIZE[a.type];
    const e = view.extensions?.EXT_meshopt_compression;
    const stride = e?.byteStride ?? view.byteStride ?? n * T.BYTES_PER_ELEMENT;
    const out = new Float64Array(a.count * n);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const read = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    const scale = normalise && a.normalized ? 1 / NORMALIZE[a.componentType] : 1;
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = Math.max(normalise && a.normalized ? -1 : -Infinity, dv[read]((a.byteOffset ?? 0) + k * stride + c * T.BYTES_PER_ELEMENT, true) * scale);
    return out;
  }
  const image = (i) => { const im = gltf.images[i]; return views[im.bufferView]; };
  // Every drawn primitive, with the matrix of its node
  const items = [];
  const walk = (i, parent, path) => {
    const n = gltf.nodes[i], m = multiply(parent, nodeMatrix(n));
    if (n.mesh !== undefined) {
      const mesh = gltf.meshes[n.mesh];
      for (const p of mesh.primitives) items.push({ node: n.name ?? '', mesh: mesh.name ?? '', path: [...path, n.name ?? ''].join('/'), matrix: m, primitive: p, material: gltf.materials?.[p.material], materialIndex: p.material });
    }
    for (const c of n.children ?? []) walk(c, m, [...path, n.name ?? '']);
  };
  for (const i of gltf.scenes[gltf.scene ?? 0].nodes) walk(i, IDENTITY, []);
  return { gltf, accessor, image, items };
}

// Filtering faces must also discard their now-unused vertices: otherwise a removed antenna or emblem still changes
// bounds, wheel clustering, UV footprints and the replacement's fitted height.
export function compactPrimitiveData(data) {
  const count = data.pos.length / 3, used = new Map();
  for (const index of data.index) if (!used.has(index)) used.set(index, used.size);
  if (used.size === count) return data;
  const result = { ...data, index: Uint32Array.from(data.index, index => used.get(index)) };
  for (const [name, size] of [['pos', 3], ['nor', 3], ['uv', 2]]) {
    const source = data[name]; if (!source) continue;
    const array = new source.constructor(used.size * size);
    for (const [from, to] of used) for (let c = 0; c < size; c++) array[to * size + c] = source[from * size + c];
    result[name] = array;
  }
  return result;
}

// Positions, normals and uvs of a primitive in world space
export function primitiveData(glb, item) {
  const { primitive: p, matrix: m } = item;
  if (p.mode !== undefined && p.mode !== 4) throw new Error(`Unsupported non-triangle primitive: ${item.node}`);
  const uvSet = p.attributes.TEXCOORD_0;
  const P = glb.accessor(p.attributes.POSITION);
  let N = p.attributes.NORMAL !== undefined ? glb.accessor(p.attributes.NORMAL) : null;
  const T = uvSet !== undefined ? glb.accessor(uvSet) : null;
  const I = p.indices !== undefined ? glb.accessor(p.indices) : Float64Array.from({ length: P.length / 3 }, (_, i) => i);
  const count = P.length / 3;
  const hasNormals = !!N;
  if (!N) {
    N = new Float64Array(P.length);
    for (let i = 0; i < I.length; i += 3) {
      const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const at of [a, b, c]) { N[at] += nx; N[at + 1] += ny; N[at + 2] += nz; }
    }
  }
  // Normals are covectors: a nonuniform or mirrored node needs the inverse transpose, not its position matrix.
  const cof = [m[5] * m[10] - m[9] * m[6], m[9] * m[2] - m[1] * m[10], m[1] * m[6] - m[5] * m[2],
    m[8] * m[6] - m[4] * m[10], m[0] * m[10] - m[8] * m[2], m[4] * m[2] - m[0] * m[6],
    m[4] * m[9] - m[8] * m[5], m[8] * m[1] - m[0] * m[9], m[0] * m[5] - m[4] * m[1]];
  const det = m[0] * cof[0] + m[4] * cof[1] + m[8] * cof[2];
  if (Math.abs(det) < 1e-12) throw new Error(`Singular node transform: ${item.node}`);
  const pos = new Float64Array(count * 3), nor = new Float64Array(count * 3), uv = new Float64Array(count * 2);
  for (let v = 0; v < count; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    pos[v * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    pos[v * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    pos[v * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    if (N) {
      const a = N[v * 3], b = N[v * 3 + 1], c = N[v * 3 + 2];
      const nx = (cof[0] * a + cof[1] * b + cof[2] * c) / det, ny = (cof[3] * a + cof[4] * b + cof[5] * c) / det, nz = (cof[6] * a + cof[7] * b + cof[8] * c) / det, l = Math.hypot(nx, ny, nz) || 1;
      nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
    }
    if (T) { uv[v * 2] = T[v * 2]; uv[v * 2 + 1] = T[v * 2 + 1]; }
  }
  return { pos, nor, uv, index: Array.from(I), flipped: det < 0, hasNormals };
}
