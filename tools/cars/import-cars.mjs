// The game's cars out of their glTF sources: oriented on their wheels, put to their real length, wheels apart and centred on
// their axles, every texture on one atlas (with the paint as a mask, so one model takes any colour), a coarse copy for far
// away. Usage: node import-cars.mjs <folder of .glb> [--out dir] [--only a,b]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';
import { readGlb, primitiveData } from './glb.mjs';

const args = process.argv.slice(2);
const SOURCE = args[0];
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const OUT = option('--out') ?? new URL('../../assets/cars/', import.meta.url).pathname;
const ONLY = option('--only')?.split(',');

const PACK = { glass: /^Glass/, paint: /^Body/, optics: /^Optics/ };
const MODELS = [
  { id: 'sedan', file: 'generico-sedan', length: 4.82, flip: true, ...PACK },
  { id: 'suv', file: 'generico-suv', length: 4.95, ...PACK },
  { id: 'pickup', file: 'generico-picape', length: 5.5, ...PACK },
  { id: 'minivan', file: 'generico-minivan', length: 5.05, ...PACK },
  { id: 'hatch', file: 'generico-hatch', length: 4.2, ...PACK },
  { id: 'compact', file: 'generico-compacto', length: 3.75, flip: true, ...PACK },
  { id: 'wagon', file: 'generico-perua', length: 4.75, flip: true, ...PACK },
  { id: 'offroad', file: 'generico-offroad', length: 4.3, flip: true, ...PACK },
  { id: 'muscle', file: 'generico-coupe', length: 4.6, flip: true, ...PACK },
  { id: 'sport', file: 'generico-esportivo', length: 4.55, ...PACK },
  { id: 'taxi', file: 'generico-sedan-80', length: 5.25, flip: true, paint: /Bodymat/, triangles: 8200 },
  { id: 'van', file: 'generico-van-92', length: 5.3, flip: true, paint: /bodymat/, triangles: 8200 },
  { id: 'truck', file: 'generico-caminhao', length: 6.6, paint: /Bodymat/, triangles: 8200 },
  { id: 'delivery', file: 'van-entrega', length: 4.6, flip: true, paint: /^body$/ },
  { id: 'super', file: '../khronos/CarConcept', length: 4.72, paint: /^Paint 1 Carmine$/, flatPaint: true, narrow: 0.86, triangles: 46000, drop: /License Plate|Emblem|Pedal|Engine|Underside|HoodUnder|HoodInterior/, dropMaterial: /Pearl|Graphite/ }
];

const hex = (r, g, b) => [r, g, b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
const toSRGB = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

// The hue that covers most of a painted texture
function paintHue(rgba, size) {
  const bins = new Float64Array(36);
  for (let i = 0; i < size * size; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi < 40 || hi - lo < hi * 0.3) continue;
    bins[Math.floor(hue(r, g, b) / 10) % 36]++;
  }
  let best = 0;
  for (let i = 0; i < 36; i++) if (bins[i] > bins[best]) best = i;
  return bins[best] > size * size * 0.01 ? (best + 0.5) * 10 : null;
}
function hue(r, g, b) {
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), d = hi - lo || 1;
  const h = hi === r ? ((g - b) / d + 6) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

async function tileOf(glb, textureIndex, size) {
  const source = glb.gltf.textures[textureIndex].source;
  const { data } = await sharp(glb.image(source)).ensureAlpha().resize(size, size, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  return Buffer.from(data);
}

// Painted panels turn into a grey multiplier with the mask in alpha; the rest of the texture stays as it is
function maskPaint(tile, size, tint) {
  const h = paintHue(tile, size);
  let L = 0, n = 0;
  const lum = (i) => 0.2126 * tile[i] + 0.7152 * tile[i + 1] + 0.0722 * tile[i + 2];
  const inPaint = (i) => {
    const r = tile[i], g = tile[i + 1], b = tile[i + 2], hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi < 22 || hi - lo < hi * 0.28) return false;
    const d = Math.abs(hue(r, g, b) - h);
    return Math.min(d, 360 - d) < 26;
  };
  if (h === null) { tile.forEach((_, i) => { if (i % 4 === 3) tile[i] = 0; }); return tint; }
  for (let i = 0; i < size * size; i++) if (inPaint(i * 4)) { L = Math.max(L, lum(i * 4)); n++; }
  const hist = new Float64Array(256);
  for (let i = 0; i < size * size; i++) if (inPaint(i * 4)) hist[Math.round(lum(i * 4))]++;
  let acc = 0, ref = L;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.2) { ref = v; break; } }
  for (let i = 0; i < size * size; i++) {
    const at = i * 4;
    if (inPaint(at)) {
      const v = Math.min(255, lum(at) / (ref || 1) * 204);
      tile[at] = tile[at + 1] = tile[at + 2] = v;
      tile[at + 3] = 255;
    } else tile[at + 3] = 0;
  }
  return tint;
}

const FLAT = 8; // swatch size in the atlas

async function importCar(model) {
  const glb = await readGlb(path.join(SOURCE, `${model.file}.glb`));
  const parts = [];
  for (const item of glb.items) {
    const name = item.material?.name ?? '';
    if (model.drop && (model.drop.test(item.node) || model.drop.test(item.mesh))) continue;
    if (model.dropMaterial?.test(name)) continue;
    const data = primitiveData(glb, item);
    if (!data.index.length) continue;
    const label = `${item.path} ${item.mesh}`;
    const wheelLike = /wheel|tire|tyre|\brim|brake ?pad|BrakePad|Brake$|Disc$/i.test(`${item.node} ${item.mesh} ${name}`) && !/steering/i.test(label);
    const glass = item.material?.alphaMode === 'BLEND' || model.glass?.test(name) || !!item.material?.extensions?.KHR_materials_transmission || /^glass$/i.test(name);
    parts.push({ item, name, data, label, wheelLike, glass, material: item.material, paint: !!model.paint?.test(name) });
  }

  // Wheels: clusters of wheel parts, on the ground, under the body
  const centre = (d) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < d.pos.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], d.pos[i + c]); hi[c] = Math.max(hi[c], d.pos[i + c]); }
    return { lo, hi, c: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] };
  };
  const shell = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
  for (const p of parts) if (!p.wheelLike) { const b = centre(p.data); for (let c = 0; c < 3; c++) { shell.lo[c] = Math.min(shell.lo[c], b.lo[c]); shell.hi[c] = Math.max(shell.hi[c], b.hi[c]); } }
  const size = Math.max(shell.hi[0] - shell.lo[0], shell.hi[2] - shell.lo[2]);
  const clusters = [];
  for (const p of parts) {
    if (!p.wheelLike) continue;
    const b = centre(p.data);
    const inside = b.c[0] > shell.lo[0] - size * 0.06 && b.c[0] < shell.hi[0] + size * 0.06 && b.c[2] > shell.lo[2] - size * 0.06 && b.c[2] < shell.hi[2] + size * 0.06;
    if (!inside) continue;
    p.wheel = true;
    let found = clusters.find((w) => Math.hypot(w.c[0] - b.c[0], w.c[1] - b.c[1], w.c[2] - b.c[2]) < size * 0.1);
    if (!found) clusters.push(found = { c: b.c, parts: [], lo: [...b.lo], hi: [...b.hi] });
    found.parts.push(p);
    for (let c = 0; c < 3; c++) { found.lo[c] = Math.min(found.lo[c], b.lo[c]); found.hi[c] = Math.max(found.hi[c], b.hi[c]); }
  }
  for (const w of clusters) for (let c = 0; c < 3; c++) w.c[c] = (w.lo[c] + w.hi[c]) / 2;
  clusters.sort((a, b) => a.c[1] - b.c[1]);
  const wheels = clusters.slice(0, 4);
  for (const spare of clusters.slice(4)) for (const p of spare.parts) p.wheel = false;
  if (wheels.length !== 4) throw new Error(`${model.id}: ${wheels.length} wheels`);

  // Yaw from the wheels: the long way round the rectangle they make is the car's length
  const mx = wheels.reduce((n, w) => n + w.c[0], 0) / 4, mz = wheels.reduce((n, w) => n + w.c[2], 0) / 4;
  let xx = 0, zz = 0, xz = 0;
  for (const w of wheels) { const a = w.c[0] - mx, b = w.c[2] - mz; xx += a * a; zz += b * b; xz += a * b; }
  let yaw = 0.5 * Math.atan2(2 * xz, zz - xx);
  if (model.flip) yaw += Math.PI;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const turnX = (x, z) => x * cos - z * sin, turnZ = (x, z) => x * sin + z * cos;

  // Length of the body along the car, then metres
  let zLo = Infinity, zHi = -Infinity;
  for (const p of parts) {
    if (p.wheelLike && !p.wheel) continue;
    for (let i = 0; i < p.data.pos.length; i += 3) { const z = turnZ(p.data.pos[i] - mx, p.data.pos[i + 2] - mz); zLo = Math.min(zLo, z); zHi = Math.max(zHi, z); }
  }
  const scale = model.length / (zHi - zLo);
  const zMid = (zLo + zHi) / 2;
  let floor = Infinity;
  for (const w of wheels) floor = Math.min(floor, w.lo[1]);
  const place = (x, y, z, out, at) => {
    const dx = x - mx, dz = z - mz;
    out[at] = turnX(dx, dz) * scale * (model.narrow ?? 1);
    out[at + 1] = (y - floor) * scale;
    out[at + 2] = (turnZ(dx, dz) - zMid) * scale;
  };
  for (const w of wheels) {
    const a = [0, 0, 0];
    place(w.c[0], w.c[1], w.c[2], a, 0);
    w.at = a;
    w.radius = (w.hi[1] - w.lo[1]) * 0.5 * scale;
  }
  // Front first, on the car's left (+X) first
  wheels.sort((a, b) => (Math.abs(a.at[2] - b.at[2]) > 0.3 ? b.at[2] - a.at[2] : b.at[0] - a.at[0]));

  // Atlas: the big texture of the paint or the underbody at 1024, the others at 512, flat colours in a strip
  const ATLAS_W = 2048, ATLAS_H = 1024;
  const textures = new Map(), swatches = new Map();
  const texOf = (m) => (model.flatPaint && model.paint.test(m?.name ?? '') ? undefined : m?.pbrMetallicRoughness?.baseColorTexture?.index);
  for (const p of parts) {
    if (p.wheelLike && !p.wheel) continue;
    const t = texOf(p.material);
    if (t !== undefined) {
      const o = textures.get(t) ?? { tris: 0, paint: false, metal: p.material.pbrMetallicRoughness?.metallicRoughnessTexture?.index };
      o.tris += p.data.index.length / 3; o.paint ||= p.paint;
      textures.set(t, o);
    } else swatches.set(p.material?.name ?? '-', p.material);
  }
  const order = [...textures.entries()].sort((a, b) => (b[1].paint - a[1].paint) || (b[1].tris - a[1].tris));
  const slots = [{ x: 0, y: 0, s: 1024 }, { x: 1024, y: 0, s: 512 }, { x: 1536, y: 0, s: 512 }, { x: 1024, y: 512, s: 512 }, { x: 1536, y: 512, s: 256 }, { x: 1792, y: 512, s: 256 }, { x: 1536, y: 768, s: 256 }];
  const swatchArea = { x: 1792, y: 768, s: 256 };
  if (order.length > slots.length) throw new Error(`${model.id}: ${order.length} textures`);
  const colour = Buffer.alloc(ATLAS_W * ATLAS_H * 4), rough = Buffer.alloc(ATLAS_W * ATLAS_H * 4);
  const blit = (target, tile, s, x, y) => { for (let r = 0; r < s; r++) tile.copy(target, ((y + r) * ATLAS_W + x) * 4, r * s * 4, (r + 1) * s * 4); };
  const placed = new Map();
  for (const [i, [t, info]] of order.entries()) {
    const slot = slots[i];
    const tile = await tileOf(glb, t, slot.s);
    if (info.paint) maskPaint(tile, slot.s);
    else for (let k = 3; k < tile.length; k += 4) tile[k] = 0;
    let mr = info.metal !== undefined ? await tileOf(glb, info.metal, slot.s) : null;
    if (!mr) { mr = Buffer.alloc(slot.s * slot.s * 4); for (let k = 0; k < mr.length; k += 4) mr[k + 1] = 150; }
    // Red of the second atlas: paint mask. WebP throws away what lies under transparent pixels, so alpha cannot carry it
    for (let k = 0; k < mr.length; k += 4) { mr[k] = tile[k + 3]; mr[k + 3] = 255; tile[k + 3] = 255; }
    blit(colour, tile, slot.s, slot.x, slot.y);
    blit(rough, mr, slot.s, slot.x, slot.y);
    placed.set(t, slot);
  }
  const flats = new Map();
  let fx = 0, fy = 0;
  for (const [name, m] of swatches) {
    const pbr = m?.pbrMetallicRoughness ?? {}, f = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const paint = !!model.paint?.test(name);
    const [r, g, b] = paint ? [204, 204, 204] : hex(toSRGB(f[0]), toSRGB(f[1]), toSRGB(f[2]));
    const x = swatchArea.x + fx, y = swatchArea.y + fy;
    for (let v = 0; v < FLAT; v++) for (let u = 0; u < FLAT; u++) {
      const at = ((y + v) * ATLAS_W + x + u) * 4;
      colour[at] = r; colour[at + 1] = g; colour[at + 2] = b; colour[at + 3] = 255;
      rough[at] = paint ? 255 : 0; rough[at + 1] = Math.round((pbr.roughnessFactor ?? 0.5) * 255); rough[at + 2] = Math.round((pbr.metallicFactor ?? 0) * 255); rough[at + 3] = 255;
    }
    flats.set(name, { x, y });
    fx += FLAT * 2;
    if (fx >= swatchArea.s) { fx = 0; fy += FLAT * 2; }
  }

  // Geometry
  const vertices = { pos: [], nor: [], uv: [], flag: [] };
  const groups = { body: [], glass: [], wheels: wheels.map(() => []) };
  const lightOf = (p) => {
    const l = `${p.item.node} ${p.item.mesh} ${p.name}`;
    if (/head ?light/i.test(l)) return 1;
    if (/brake ?light|tail ?light/i.test(l)) return 2;
    if (/reverse/i.test(l)) return 3;
    if (/blinker|signal ?light|turn ?signal/i.test(l)) return 4;
    return model.optics?.test(p.name) ? 5 : 0;
  };
  const scratch = [0, 0, 0];
  for (const p of parts) {
    if (p.wheelLike && !p.wheel) continue;
    const d = p.data, base = vertices.pos.length / 3;
    const t = texOf(p.material), slot = t !== undefined ? placed.get(t) : null, flat = flats.get(p.name ?? '-');
    const wheelIndex = p.wheel ? wheels.findIndex((w) => w.parts.includes(p)) : -1;
    const w = wheels[wheelIndex];
    const light = lightOf(p);
    for (let v = 0; v < d.pos.length / 3; v++) {
      place(d.pos[v * 3], d.pos[v * 3 + 1], d.pos[v * 3 + 2], scratch, 0);
      const x = scratch[0], y = scratch[1], z = scratch[2];
      if (w) vertices.pos.push(x - w.at[0], y - w.at[1], z - w.at[2]);
      else vertices.pos.push(x, y, z);
      vertices.nor.push(turnX(d.nor[v * 3], d.nor[v * 3 + 2]), d.nor[v * 3 + 1], turnZ(d.nor[v * 3], d.nor[v * 3 + 2]));
      const u = d.uv[v * 2], vv = d.uv[v * 2 + 1];
      if (slot) vertices.uv.push((slot.x + u * slot.s * 0.996 + slot.s * 0.002) / ATLAS_W, (slot.y + vv * slot.s * 0.996 + slot.s * 0.002) / ATLAS_H);
      else vertices.uv.push(((flat?.x ?? 0) + FLAT / 2) / ATLAS_W, ((flat?.y ?? 0) + FLAT / 2) / ATLAS_H);
      vertices.flag.push(light === 5 ? (z > 0 ? 1 : 2) : light || (p.glass ? 6 : 0));
    }
    // Keep only the rotation: scale was uniform, a mirrored node reverses the winding
    const list = p.wheel ? groups.wheels[wheelIndex] : p.glass ? groups.glass : groups.body;
    for (let i = 0; i < d.index.length; i += 3) {
      const a = d.index[i] + base, b = d.index[i + 1] + base, c = d.index[i + 2] + base;
      if (d.flipped) list.push(a, c, b); else list.push(a, b, c);
    }
  }

  const count = vertices.pos.length / 3;
  const positions = Float32Array.from(vertices.pos);
  let bodyIndex = Uint32Array.from(groups.body), glassIndex = Uint32Array.from(groups.glass);
  const wheelIndices = groups.wheels.map((w) => Uint32Array.from(w));
  // Very dense sources are thinned to what a chase camera can show
  const budget = model.triangles;
  const total = (bodyIndex.length + glassIndex.length + wheelIndices.reduce((n, w) => n + w.length, 0)) / 3;
  await MeshoptSimplifier.ready;
  const thin = (index, keep) => {
    const target = Math.max(120, Math.floor(index.length * keep / 3) * 3);
    return MeshoptSimplifier.simplify(index, positions, 3, target, 0.012, ['LockBorder'])[0];
  };
  if (budget && total > budget) {
    const keep = budget / total;
    bodyIndex = thin(bodyIndex, keep);
    glassIndex = thin(glassIndex, Math.min(1, keep * 3));
    for (let i = 0; i < 4; i++) wheelIndices[i] = thin(wheelIndices[i], keep);
  }
  const shellIndex = new Uint32Array(bodyIndex.length + glassIndex.length);
  shellIndex.set(bodyIndex); shellIndex.set(glassIndex, bodyIndex.length);
  const far = MeshoptSimplifier.simplify(shellIndex, positions, 3, Math.max(420 * 3, Math.floor(shellIndex.length * 0.28 / 3) * 3), 0.05, [])[0];

  // Size of the car, from the bodywork rather than its mirrors
  const xs = [];
  let top = 0, xMax = 0;
  const seen = new Uint8Array(count);
  for (const i of bodyIndex) { if (seen[i]) continue; seen[i] = 1; const x = Math.abs(positions[i * 3]); xs.push(x); top = Math.max(top, positions[i * 3 + 1]); xMax = Math.max(xMax, x); }
  xs.sort((a, b) => a - b);
  const halfW = xs[Math.floor(xs.length * 0.97)];
  const lamp = (flag, want) => {
    let x = 0, y = 0, z = 0, n = 0;
    for (let i = 0; i < count; i++) if (vertices.flag[i] === flag && positions[i * 3] > 0 === want) { x += positions[i * 3]; y += positions[i * 3 + 1]; z += positions[i * 3 + 2]; n++; }
    return n ? [+(x / n).toFixed(3), +(y / n).toFixed(3), +(z / n).toFixed(3)] : null;
  };
  // Sill: how far the bodywork clears the road between the axles
  let sill = Infinity;
  for (let i = 0; i < count; i++) if (seen[i] && Math.abs(positions[i * 3 + 2]) < 0.6 && Math.abs(positions[i * 3]) > halfW * 0.5) sill = Math.min(sill, positions[i * 3 + 1]);

  // Written tight: positions, normals, uvs, flags, then all the triangle lists, over the vertices still in use
  const round = (v) => Math.round(v * 1000) / 1000;
  const lists = [bodyIndex, glassIndex, far, ...wheelIndices];
  const remap = new Int32Array(count).fill(-1);
  let used = 0;
  for (const list of lists) for (const i of list) if (remap[i] < 0) remap[i] = used++;
  const tight = new Float32Array(used * 3), nor = new Int8Array(used * 4), uv = new Uint16Array(used * 2), flag = new Uint8Array(used);
  for (let i = 0; i < count; i++) {
    const to = remap[i];
    if (to < 0) continue;
    tight[to * 3] = positions[i * 3]; tight[to * 3 + 1] = positions[i * 3 + 1]; tight[to * 3 + 2] = positions[i * 3 + 2];
    nor[to * 4] = Math.round(vertices.nor[i * 3] * 127); nor[to * 4 + 1] = Math.round(vertices.nor[i * 3 + 1] * 127); nor[to * 4 + 2] = Math.round(vertices.nor[i * 3 + 2] * 127);
    uv[to * 2] = Math.round(vertices.uv[i * 2] * 65535); uv[to * 2 + 1] = Math.round(vertices.uv[i * 2 + 1] * 65535);
    flag[to] = vertices.flag[i];
  }
  const ranges = [];
  let triangles = 0;
  for (const list of lists) { ranges.push(triangles, list.length); triangles += list.length; }
  const indices = new Uint32Array(triangles);
  { let at = 0; for (const list of lists) { for (const i of list) indices[at++] = remap[i]; } }
  const pad = (n) => (4 - n % 4) % 4;
  const file = Buffer.concat([Buffer.from(tight.buffer), Buffer.from(nor.buffer), Buffer.from(uv.buffer), Buffer.from(flag.buffer), Buffer.alloc(pad(flag.byteLength)), Buffer.from(indices.buffer)]);
  fs.writeFileSync(path.join(OUT, `${model.id}.bin`), file);
  await sharp(colour, { raw: { width: ATLAS_W, height: ATLAS_H, channels: 4 } }).removeAlpha().webp({ quality: 86, effort: 5 }).toFile(path.join(OUT, `${model.id}_c.webp`));
  await sharp(rough, { raw: { width: ATLAS_W, height: ATLAS_H, channels: 4 } }).removeAlpha().webp({ quality: 84, effort: 5 }).toFile(path.join(OUT, `${model.id}_m.webp`));

  const front = wheels.slice(0, 2), rear = wheels.slice(2);
  const glassMat = parts.find((p) => p.glass)?.material;
  return {
    vertices: used, indices: triangles, ranges,
    glass: { alpha: glassMat?.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 0.7 },
    spec: {
      zFront: round(zHi === zLo ? 0 : (zHi - zMid) * scale), zRear: round((zLo - zMid) * scale), halfW: round(halfW), height: round(top), sill: round(Math.min(sill, 0.5)),
      wheelX: round((front[0].at[0] - front[1].at[0]) / 2), wheelXr: round((rear[0].at[0] - rear[1].at[0]) / 2), wheelZf: round(front[0].at[2]), wheelZr: round(rear[0].at[2]),
      wheelRadius: round(wheels.reduce((n, w) => n + w.radius, 0) / 4),
      wheels: wheels.map((w) => [round(w.at[0]), round(w.at[1]), round(w.at[2]), round(w.radius)]),
      head: lamp(1, true), tail: lamp(2, true)
    }
  };
}

fs.mkdirSync(OUT, { recursive: true });
const manifest = {};
for (const model of MODELS) {
  if (ONLY && !ONLY.includes(model.id)) continue;
  manifest[model.id] = await importCar(model);
  const m = manifest[model.id];
  console.log(model.id.padEnd(10), `${m.vertices} v ${m.indices / 3} t`, JSON.stringify(m.spec).slice(0, 170));
}
const file = path.join(OUT, 'models.json');
const earlier = ONLY && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
fs.writeFileSync(file, JSON.stringify({ ...earlier, ...manifest }));
