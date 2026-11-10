// A small glTF 2.0 reader for build-kit.mjs: every primitive of a scene, flattened into world space (node transforms
// applied), with the material it was drawn with. Only what Poly Haven's exports use: one .bin, float or normalised
// integer accessors, triangles.
import fs from 'node:fs';
import path from 'node:path';

const TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const READ = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' };
const NORMALISE = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

const multiply = (a, b) => {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1
  ];
}
// The matrix that carries normals: the inverse transpose of the upper 3 x 3 (models may be scaled unevenly or mirrored)
function normalMatrix(m) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const s = det ? 1 / det : 1;
  return { n: [A * s, B * s, C * s, (c * h - b * i) * s, (a * i - c * g) * s, (b * g - a * h) * s, (b * f - c * e) * s, (c * d - a * f) * s, (a * e - b * d) * s], det };
}

export function readGltf(file) {
  const gltf = JSON.parse(fs.readFileSync(file, 'utf8'));
  const folder = path.dirname(file);
  const buffers = gltf.buffers.map((b) => fs.readFileSync(path.join(folder, decodeURIComponent(b.uri))));
  function accessor(index) {
    const a = gltf.accessors[index], v = gltf.bufferViews[a.bufferView], n = WIDTH[a.type], T = TYPES[a.componentType];
    const bin = buffers[v.buffer];
    const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride || n * T.BYTES_PER_ELEMENT;
    const scale = a.normalized ? 1 / NORMALISE[a.componentType] : 1;
    const out = new Float64Array(a.count * n);
    const read = READ[a.componentType];
    for (let e = 0; e < a.count; e++) for (let c = 0; c < n; c++) out[e * n + c] = view[read](start + e * stride + c * T.BYTES_PER_ELEMENT, true) * scale;
    return out;
  }
  const image = (t) => (t === undefined ? null : path.join(folder, decodeURIComponent(gltf.images[gltf.textures[t.index].source].uri)));
  const materials = (gltf.materials ?? []).map((m) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    return {
      name: m.name ?? '', alphaMode: m.alphaMode ?? 'OPAQUE', doubleSided: !!m.doubleSided,
      color: image(pbr.baseColorTexture), colorFactor: pbr.baseColorFactor ?? [1, 1, 1, 1],
      normal: image(m.normalTexture), orm: image(pbr.metallicRoughnessTexture), occlusion: image(m.occlusionTexture),
      emissive: image(m.emissiveTexture), emissiveFactor: m.emissiveFactor ?? [0, 0, 0],
      rough: pbr.roughnessFactor ?? 1, metal: pbr.metallicFactor ?? 1,
      transmission: m.extensions?.KHR_materials_transmission?.transmissionFactor ?? 0
    };
  });
  const parts = [];
  function walk(index, parent, trail) {
    const node = gltf.nodes[index], m = multiply(parent, nodeMatrix(node));
    const names = [...trail, node.name ?? `node${index}`];
    if (node.mesh !== undefined) {
      const { n, det } = normalMatrix(m);
      for (const p of gltf.meshes[node.mesh].primitives) {
        if ((p.mode ?? 4) !== 4) continue;
        const P = accessor(p.attributes.POSITION);
        const N = p.attributes.NORMAL !== undefined ? accessor(p.attributes.NORMAL) : null;
        const T = p.attributes.TEXCOORD_0 !== undefined ? accessor(p.attributes.TEXCOORD_0) : null;
        const count = P.length / 3;
        const I = p.indices !== undefined ? accessor(p.indices) : Float64Array.from({ length: count }, (_, k) => k);
        const position = new Float64Array(count * 3), normal = new Float64Array(count * 3), uv = new Float64Array(count * 2);
        for (let v = 0; v < count; v++) {
          const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
          position[v * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
          position[v * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          position[v * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          if (N) {
            const a = N[v * 3], b = N[v * 3 + 1], c = N[v * 3 + 2];
            const nx = n[0] * a + n[3] * b + n[6] * c, ny = n[1] * a + n[4] * b + n[7] * c, nz = n[2] * a + n[5] * b + n[8] * c, l = Math.hypot(nx, ny, nz) || 1;
            normal[v * 3] = nx / l; normal[v * 3 + 1] = ny / l; normal[v * 3 + 2] = nz / l;
          }
          if (T) { uv[v * 2] = T[v * 2]; uv[v * 2 + 1] = T[v * 2 + 1]; }
        }
        const index = Uint32Array.from(I);
        // a mirrored node turns its triangles inside out: wind them back
        if (det < 0) for (let t = 0; t < index.length; t += 3) { const k = index[t + 1]; index[t + 1] = index[t + 2]; index[t + 2] = k; }
        parts.push({ node: names.join('/'), mesh: gltf.meshes[node.mesh].name ?? '', material: p.material ?? -1, position, normal, uv, index, hasNormal: !!N, hasUv: !!T });
      }
    }
    for (const c of node.children ?? []) walk(c, m, names);
  }
  for (const i of gltf.scenes[gltf.scene ?? 0].nodes) walk(i, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], []);
  return { materials, parts };
}

export function bounds(position, into = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]) {
  for (let i = 0; i < position.length; i += 3) for (let c = 0; c < 3; c++) {
    if (position[i + c] < into[c]) into[c] = position[i + c];
    if (position[i + c] > into[c + 3]) into[c + 3] = position[i + c];
  }
  return into;
}
