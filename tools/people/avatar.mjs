import * as THREE from 'three';
import { readFBX } from './fbx.mjs';

// An avatar's mesh in metres and world axes, in its bind pose: welded vertices, up to four bones each (strongest first, in
// bytes that add up to 255), bones parents first, triangles gathered by material
function readAvatar(file) {
  const root = readFBX(file);
  let mesh = null;
  root.traverse((o) => { if (o.isSkinnedMesh) mesh ??= o; });
  const g = mesh.geometry, bones = mesh.skeleton.bones;
  const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const order = [];
  const seen = new Set();
  const visit = (b) => {
    if (seen.has(b)) return;
    seen.add(b);
    if (bones.includes(b.parent)) visit(b.parent);
    order.push(b);
  };
  bones.forEach(visit);
  const newIndex = new Map(order.map((b, i) => [b, i]));
  const remap = bones.map((b) => newIndex.get(b));

  const world = mesh.matrixWorld;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
  const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const v = new THREE.Vector3();
  const map = new Map();
  const out = { p: [], n: [], uv: [], si: [], sw: [] };
  const slots = new Map();
  const groups = g.groups.length ? g.groups : [{ start: 0, count: P.count, materialIndex: 0 }];
  for (const { start, count, materialIndex } of groups) {
    const key = source[materialIndex]?.name ?? 'body';
    if (!slots.has(key)) slots.set(key, []);
    const list = slots.get(key);
    for (let i = start; i < start + count; i++) {
      const w = [SW.getX(i), SW.getY(i), SW.getZ(i), SW.getW(i)];
      const s = [SI.getX(i), SI.getY(i), SI.getZ(i), SI.getW(i)].map((b) => remap[b] ?? 0);
      const pairs = s.map((b, k) => [b, w[k]]).sort((a, b) => b[1] - a[1]);
      const sum = pairs.reduce((t, [, x]) => t + x, 0) || 1;
      const bytes = pairs.map(([, x]) => Math.round((x / sum) * 255));
      bytes[0] += 255 - bytes.reduce((a, b) => a + b, 0);
      v.fromBufferAttribute(P, i).applyMatrix4(world).multiplyScalar(0.01);
      const n = new THREE.Vector3().fromBufferAttribute(N, i).applyMatrix3(normalMatrix).normalize();
      const u = UV.getX(i), t = 1 - UV.getY(i);
      const tag = [v.x, v.y, v.z].map((x) => x.toFixed(4)).join() + [n.x, n.y, n.z].map((x) => x.toFixed(2)).join() + u.toFixed(4) + t.toFixed(4);
      let at = map.get(tag);
      if (at === undefined) {
        at = out.p.length / 3;
        map.set(tag, at);
        out.p.push(v.x, v.y, v.z);
        out.n.push(n.x, n.y, n.z);
        out.uv.push(u, t);
        out.si.push(...pairs.map(([b]) => b));
        out.sw.push(...bytes);
      }
      list.push(at);
    }
  }
  const index = [];
  const parts = [];
  for (const [name, list] of slots) {
    parts.push({ name: name.replace(/^[a-z]+\d+_/, '').replace('equpiment', 'equipment'), material: name, start: index.length, count: list.length });
    index.push(...list);
  }
  const m = new THREE.Matrix4(), t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const bind = [];
  for (const b of order) {
    m.copy(mesh.skeleton.boneInverses[bones.indexOf(b)]).invert().decompose(t, q, s);
    bind.push(t.x * 0.01, t.y * 0.01, t.z * 0.01, q.x, q.y, q.z, q.w);
  }
  const skeleton = order.map((b) => ({ name: b.name.replace('Bip01_', ''), parent: order.indexOf(b.parent) }));
  return { ...out, index, parts, bind, skeleton };
}

// One file: a length-prefixed JSON header, then typed sections
function packed(header, arrays) {
  const json = Buffer.from(JSON.stringify(header));
  const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const u32 = Buffer.alloc(4);
  u32.writeUInt32LE(json.length);
  return Buffer.concat([pad(Buffer.concat([u32, json])), ...arrays.map((a) => pad(Buffer.from(a.buffer, a.byteOffset, a.byteLength)))]);
}

export { readAvatar, packed };
