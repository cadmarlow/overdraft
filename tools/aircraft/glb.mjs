// A small GLB reader for the aircraft importer: every triangle mesh flattened into the scene's space with its two
// first UV sets (the biplane keeps its occlusion on the second), the materials by name and the images they use.
// Offline tool only.
import fs from 'node:fs';

const TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const READ = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
function trs(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1], [sx, sy, sz] = node.scale || [1, 1, 1], [tx, ty, tz] = node.translation || [0, 0, 0];
  const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0, (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0, tx, ty, tz, 1];
}

/**
 * @param {string} file - a binary glTF
 * @returns {{meshes: {node: string, material: string, position: Float32Array, normal: Float32Array, uv: Float32Array,
 *   uv1: Float32Array|null, index: Uint32Array}[], materials: Map<string, object>}} materials by name, each with the
 *   encoded images of its maps (`base`, `metalRough`, `normal`, `occlusion`, `clearcoat`) and the UV set each reads
 */
function readGLB(file) {
  const raw = fs.readFileSync(file);
  if (raw.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  let json, bin = null, o = 12;
  while (o < raw.length) {
    const length = raw.readUInt32LE(o), type = raw.readUInt32LE(o + 4), chunk = raw.subarray(o + 8, o + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    o += 8 + length;
  }
  const accessor = (i) => {
    const a = json.accessors[i], T = TYPES[a.componentType], n = SIZE[a.type], out = new Float32Array(a.count * n);
    if (a.bufferView === undefined) return out;
    const v = json.bufferViews[a.bufferView], bytes = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    const step = v.byteStride || T.BYTES_PER_ELEMENT * n, base = a.byteOffset || 0;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), get = READ[a.componentType];
    const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 0;
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      const value = dv[get](base + k * step + c * T.BYTES_PER_ELEMENT, true);
      out[k * n + c] = norm ? Math.max(-1, value / norm) : value;
    }
    return out;
  };
  const image = (t) => {
    if (!t) return null;
    const v = json.bufferViews[json.images[json.textures[t.index].source].bufferView];
    return { image: Buffer.from(bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength)), uv: t.texCoord || 0 };
  };
  const materials = new Map();
  const names = (json.materials || []).map((m, i) => m.name || `material${i}`);
  (json.materials || []).forEach((m, i) => {
    const p = m.pbrMetallicRoughness || {};
    materials.set(names[i], {
      name: names[i], factor: p.baseColorFactor || [1, 1, 1, 1], metal: p.metallicFactor ?? 1, rough: p.roughnessFactor ?? 1,
      base: image(p.baseColorTexture), metalRough: image(p.metallicRoughnessTexture), normal: image(m.normalTexture),
      occlusion: image(m.occlusionTexture), clearcoat: image(m.extensions?.KHR_materials_clearcoat?.clearcoatTexture)
    });
  });
  const meshes = [];
  const walk = (index, parent) => {
    const node = json.nodes[index], m = mul(parent, trs(node));
    if (node.mesh !== undefined) for (const prim of json.meshes[node.mesh].primitives) {
      if ((prim.mode ?? 4) !== 4 || prim.attributes.POSITION === undefined) continue;
      const P = accessor(prim.attributes.POSITION), count = P.length / 3;
      const N = prim.attributes.NORMAL !== undefined ? accessor(prim.attributes.NORMAL) : null;
      const uv = prim.attributes.TEXCOORD_0 !== undefined ? accessor(prim.attributes.TEXCOORD_0) : new Float32Array(count * 2);
      const uv1 = prim.attributes.TEXCOORD_1 !== undefined ? accessor(prim.attributes.TEXCOORD_1) : null;
      const index = prim.indices !== undefined ? Uint32Array.from(accessor(prim.indices)) : Uint32Array.from({ length: count }, (_, k) => k);
      const position = new Float32Array(count * 3), normal = new Float32Array(count * 3);
      for (let k = 0; k < count; k++) {
        const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
        position[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        position[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        position[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        if (N) {
          const nx = N[k * 3], ny = N[k * 3 + 1], nz = N[k * 3 + 2];
          const ax = m[0] * nx + m[4] * ny + m[8] * nz, ay = m[1] * nx + m[5] * ny + m[9] * nz, az = m[2] * nx + m[6] * ny + m[10] * nz;
          const l = Math.hypot(ax, ay, az) || 1;
          normal[k * 3] = ax / l; normal[k * 3 + 1] = ay / l; normal[k * 3 + 2] = az / l;
        }
      }
      const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
      if (det < 0) for (let k = 0; k < index.length; k += 3) { const t = index[k + 1]; index[k + 1] = index[k + 2]; index[k + 2] = t; }
      meshes.push({ node: node.name || `node${index}`, material: names[prim.material] ?? '', position, normal, uv, uv1, index });
    }
    for (const child of node.children || []) walk(child, m);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const root of json.scenes[json.scene ?? 0].nodes) walk(root, identity);
  return { meshes, materials };
}

export { readGLB };
