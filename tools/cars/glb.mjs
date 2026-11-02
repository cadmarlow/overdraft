// A glTF binary read into plain arrays: buffers decoded (EXT_meshopt_compression), accessors as floats, nodes with world matrices.
import fs from 'node:fs';
import { MeshoptDecoder } from 'meshoptimizer';

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
  await MeshoptDecoder.ready;
  const raw = fs.readFileSync(file);
  const length = raw.readUInt32LE(12);
  const gltf = JSON.parse(raw.subarray(20, 20 + length).toString());
  const bin = raw.subarray(20 + length + 8);
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
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = dv[read]((a.byteOffset ?? 0) + k * stride + c * T.BYTES_PER_ELEMENT, true) * scale;
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

// Positions, normals and uvs of a primitive in world space
export function primitiveData(glb, item) {
  const { primitive: p, matrix: m } = item;
  const uvSet = p.attributes.TEXCOORD_0;
  const P = glb.accessor(p.attributes.POSITION), N = p.attributes.NORMAL !== undefined ? glb.accessor(p.attributes.NORMAL) : null;
  const T = uvSet !== undefined ? glb.accessor(uvSet) : null;
  const I = p.indices !== undefined ? glb.accessor(p.indices) : Float64Array.from({ length: P.length / 3 }, (_, i) => i);
  const count = P.length / 3;
  const pos = new Float64Array(count * 3), nor = new Float64Array(count * 3), uv = new Float64Array(count * 2);
  for (let v = 0; v < count; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    pos[v * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    pos[v * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    pos[v * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    if (N) {
      const a = N[v * 3], b = N[v * 3 + 1], c = N[v * 3 + 2];
      const nx = m[0] * a + m[4] * b + m[8] * c, ny = m[1] * a + m[5] * b + m[9] * c, nz = m[2] * a + m[6] * b + m[10] * c, l = Math.hypot(nx, ny, nz) || 1;
      nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
    }
    if (T) { uv[v * 2] = T[v * 2]; uv[v * 2 + 1] = T[v * 2 + 1]; }
  }
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  return { pos, nor, uv, index: Array.from(I), flipped: det < 0, hasNormals: !!N };
}
