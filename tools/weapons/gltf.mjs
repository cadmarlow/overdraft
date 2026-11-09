// A small glTF 2.0 reader for static props (no skins, no animation): every mesh node flattened into world space, its
// materials and the images they name. Reads .gltf with external files and binary .glb alike. Offline tool only.
import fs from 'node:fs';
import path from 'node:path';

const TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
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

function readGLTF(file) {
  const raw = fs.readFileSync(file);
  let json, bin = null;
  if (raw.readUInt32LE(0) === 0x46546c67) {
    let o = 12;
    while (o < raw.length) {
      const length = raw.readUInt32LE(o), type = raw.readUInt32LE(o + 4), chunk = raw.subarray(o + 8, o + 8 + length);
      if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
      else if (type === 0x004e4942) bin = chunk;
      o += 8 + length;
    }
  } else json = JSON.parse(raw.toString('utf8'));
  const dir = path.dirname(file);
  const buffers = (json.buffers || []).map((b) => b.uri ? (b.uri.startsWith('data:') ? Buffer.from(b.uri.slice(b.uri.indexOf(',') + 1), 'base64') : fs.readFileSync(path.join(dir, decodeURIComponent(b.uri)))) : bin);
  const view = (i) => {
    const v = json.bufferViews[i], b = buffers[v.buffer];
    return { bytes: b.subarray((v.byteOffset || 0), (v.byteOffset || 0) + v.byteLength), stride: v.byteStride || 0 };
  };
  const accessor = (i) => {
    const a = json.accessors[i], T = TYPES[a.componentType], n = SIZE[a.type], out = new Float32Array(a.count * n);
    if (a.bufferView === undefined) return { data: out, size: n };
    const { bytes, stride } = view(a.bufferView);
    const step = stride || T.BYTES_PER_ELEMENT * n, base = a.byteOffset || 0;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 0;
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      const v = dv[get](base + k * step + c * T.BYTES_PER_ELEMENT, true);
      out[k * n + c] = norm ? Math.max(-1, v / norm) : v;
    }
    return { data: out, size: n };
  };
  const image = (i) => {
    if (i === undefined) return null;
    const im = json.images[i];
    if (im.uri) return im.uri.startsWith('data:') ? Buffer.from(im.uri.slice(im.uri.indexOf(',') + 1), 'base64') : fs.readFileSync(path.join(dir, decodeURIComponent(im.uri)));
    return Buffer.from(view(im.bufferView).bytes);
  };
  const tex = (t) => (t ? { image: image(json.textures[t.index].source ?? json.textures[t.index].extensions?.EXT_texture_webp?.source), transform: t.extensions?.KHR_texture_transform || null } : null);
  const materials = (json.materials || []).map((m) => {
    const p = m.pbrMetallicRoughness || {}, sg = m.extensions?.KHR_materials_pbrSpecularGlossiness;
    return {
      name: m.name || '', alphaMode: m.alphaMode || 'OPAQUE', doubleSided: !!m.doubleSided,
      color: tex(p.baseColorTexture || sg?.diffuseTexture), colorFactor: p.baseColorFactor || sg?.diffuseFactor || [1, 1, 1, 1],
      metalRough: tex(p.metallicRoughnessTexture), metal: p.metallicFactor ?? (sg ? 0 : 1), rough: p.roughnessFactor ?? 1,
      specGloss: tex(sg?.specularGlossinessTexture), gloss: sg?.glossinessFactor ?? null,
      normal: tex(m.normalTexture), occlusion: tex(m.occlusionTexture), emissive: tex(m.emissiveTexture)
    };
  });
  const meshes = [];
  const walk = (index, parent) => {
    const node = json.nodes[index], world = mul(parent, trs(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4 || prim.attributes.POSITION === undefined) continue;
        const P = accessor(prim.attributes.POSITION).data, count = P.length / 3;
        const N = prim.attributes.NORMAL !== undefined ? accessor(prim.attributes.NORMAL).data : null;
        const T = prim.attributes.TEXCOORD_0 !== undefined ? accessor(prim.attributes.TEXCOORD_0).data : new Float32Array(count * 2);
        const index = prim.indices !== undefined ? Uint32Array.from(accessor(prim.indices).data) : Uint32Array.from({ length: count }, (_, k) => k);
        const position = new Float32Array(count * 3), normal = new Float32Array(count * 3);
        const m = world;
        const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
        for (let k = 0; k < count; k++) {
          const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
          position[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
          position[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          position[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          if (N) {
            // rotation only matters here (uniform scales): renormalised
            const nx = N[k * 3], ny = N[k * 3 + 1], nz = N[k * 3 + 2];
            const ax = m[0] * nx + m[4] * ny + m[8] * nz, ay = m[1] * nx + m[5] * ny + m[9] * nz, az = m[2] * nx + m[6] * ny + m[10] * nz;
            const l = Math.hypot(ax, ay, az) || 1;
            normal[k * 3] = ax / l; normal[k * 3 + 1] = ay / l; normal[k * 3 + 2] = az / l;
          }
        }
        if (det < 0) for (let k = 0; k < index.length; k += 3) { const t = index[k + 1]; index[k + 1] = index[k + 2]; index[k + 2] = t; }
        meshes.push({ node: node.name || `node${index}`, mesh: json.meshes[node.mesh].name || '', material: prim.material ?? -1, position, normal: N ? normal : null, uv: T, index });
      }
    }
    for (const child of node.children || []) walk(child, world);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const root of json.scenes[json.scene ?? 0].nodes) walk(root, identity);
  return { meshes, materials, generator: json.asset?.generator || '' };
}

export { readGLTF };
