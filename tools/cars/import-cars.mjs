// The game's cars out of their glTF sources: oriented on their wheels, put to their real length, wheels apart and centred on
// their axles, every texture on one atlas (with the paint as a mask, so one model takes any colour), a coarse copy for far
// away. Usage: node import-cars.mjs <folder of .glb> [--out dir] [--only a,b]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, primitiveData, compactPrimitiveData } from './glb.mjs';

let sharp, MeshoptSimplifier;
function simplifyCarSurface(simplifier, indices, positions, attributes, targetTriangles, error) {
  return simplifier.simplifyWithAttributes(indices, positions, 3, attributes, 6,
    [0.5, 0.5, 0.5, 2, 2, 10], null, Math.min(indices.length, targetTriangles * 3), error,
    ['Permissive', 'Prune'])[0];
}
export { simplifyCarSurface };

async function prepareTools() {
  if (!sharp) ({ default: sharp } = await import('sharp'));
  if (!MeshoptSimplifier) ({ MeshoptSimplifier } = await import('meshoptimizer'));
  await MeshoptSimplifier.ready;
}

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
  { id: 'taxi', file: 'generico-sedan-80', length: 5.25, flip: true, paint: /Bodymat/ },
  { id: 'van', file: 'generico-van-92', length: 5.3, flip: true, paint: /bodymat/ },
  { id: 'truck', file: 'generico-caminhao', length: 6.6, paint: /Bodymat/ },
  { id: 'delivery', file: 'van-entrega', length: 4.6, flip: true, paint: /^body$/ },
  { id: 'super', file: '../khronos/CarConcept', length: 4.72, paint: /^Paint 1 Carmine$/, microfacet: /^Paint [12] Carmine$/, flatPaint: true, narrow: 0.86, triangles: 110000, sourceInterior: true, drop: /License Plate|Emblem|Engine|Underside|HoodUnder|HoodInterior/, dropMaterial: /Pearl|Graphite/ }
];

const toSRGB = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export function transformTextureUV(info, u, v) {
  const t = info?.extensions?.KHR_texture_transform;
  if (!t) return [u, v];
  const [sx, sy] = t.scale ?? [1, 1], [ox, oy] = t.offset ?? [0, 0], c = Math.cos(t.rotation ?? 0), s = Math.sin(t.rotation ?? 0);
  return [ox + c * sx * u - s * sy * v, oy + s * sx * u + c * sy * v];
}

export function wrapTextureCoordinate(value, mode = 10497) {
  if (mode === 33071) return clamp(value);
  if (mode === 33648) { const at = ((value % 2) + 2) % 2; return at > 1 ? 2 - at : at; }
  return ((value % 1) + 1) % 1;
}

// The normal map is baked in the untransformed mesh UV frame. Rotate its tangent vector back from texture space.
export function decodeNormal(red, green, blue, scale = 1, rotation = 0) {
  const x = (red / 255 * 2 - 1) * scale, y = (green / 255 * 2 - 1) * scale, z = blue / 255 * 2 - 1;
  const c = Math.cos(rotation), s = Math.sin(rotation), nx = c * x + s * y, ny = -s * x + c * y, l = Math.hypot(nx, ny, z) || 1;
  return [nx / l, ny / l, z / l];
}

export function encodeNormal16(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [Math.round(clamp(x / l, -1, 1) * 32767), Math.round(clamp(y / l, -1, 1) * 32767), Math.round(clamp(z / l, -1, 1) * 32767), 0];
}

// A tiled microflake map below the atlas footprint represents a distribution of facet slopes, not visible dents.
// Preserve its variance in GGX roughness (alpha = roughness squared) instead of aliasing the noise into larger bumps.
export function normalSlopeVariance(rgba, scale = 1) {
  let meanX = 0, meanY = 0, squareX = 0, squareY = 0;
  const count = rgba.length / 4;
  if (!count) return 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const z = Math.max(0.01, rgba[i + 2] / 255 * 2 - 1);
    const x = (rgba[i] / 255 * 2 - 1) * scale / z, y = (rgba[i + 1] / 255 * 2 - 1) * scale / z;
    meanX += x / count; meanY += y / count; squareX += x * x / count; squareY += y * y / count;
  }
  return Math.max(0, squareX + squareY - meanX * meanX - meanY * meanY);
}

export function filteredMicrofacetRoughness(roughness, variance) {
  return clamp((clamp(roughness) ** 4 + Math.max(0, variance)) ** 0.25);
}

// The concept source's parked wipers contain two blades and arms beneath dozens of stacked mechanical yokes.
// Keep the exact blades, arms and end pivot, but omit those tiny yokes which obscure the road from a driver's view.
export function simplifyParkedWipers(data) {
  const count = data.pos.length / 3, parent = Int32Array.from({ length: count }, (_, i) => i), weld = new Map();
  const root = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { parent[root(a)] = root(b); };
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(data.pos[i * 3] * 1e5)},${Math.round(data.pos[i * 3 + 1] * 1e5)},${Math.round(data.pos[i * 3 + 2] * 1e5)}`;
    if (weld.has(key)) join(i, weld.get(key)); else weld.set(key, i);
  }
  for (let i = 0; i < data.index.length; i += 3) { join(data.index[i], data.index[i + 1]); join(data.index[i], data.index[i + 2]); }
  const components = new Map();
  let right = -Infinity;
  for (let i = 0; i < count; i++) {
    const at = root(i);
    let c = components.get(at);
    if (!c) components.set(at, c = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] });
    for (let j = 0; j < 3; j++) { c.lo[j] = Math.min(c.lo[j], data.pos[i * 3 + j]); c.hi[j] = Math.max(c.hi[j], data.pos[i * 3 + j]); }
    right = Math.max(right, c.hi[0]);
  }
  const keep = new Set();
  for (const [at, c] of components) if (c.hi[0] - c.lo[0] > 0.45 || (c.hi[0] > right - 0.08 && c.hi[1] - c.lo[1] > 0.035)) keep.add(at);
  const index = [];
  for (let i = 0; i < data.index.length; i += 3) if (keep.has(root(data.index[i]))) index.push(data.index[i], data.index[i + 1], data.index[i + 2]);
  if (!index.length) throw new Error('No parked wiper blades found');
  return { ...data, index };
}

// The licensed source's sidewall logos are artwork, not a brand in this original game. Remove their color and embossed
// normal-map edges together; the tyre's moulding, dimensions and safety markings remain intact.
export function stripSidewallBrands(colour, normal, width, height) {
  const marks = new Uint8Array(width * height), pad = Math.max(2, Math.ceil(width / 256));
  for (let y = Math.floor(height * 0.32); y < height * 0.68; y++) for (let x = 0; x < width; x++) {
    if (x > width * 0.12 && x < width * 0.94) continue;
    const at = (y * width + x) * 4;
    if (Math.max(colour[at], colour[at + 1], colour[at + 2]) > 42) marks[y * width + x] = 1;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (marks[y * width + x]) {
    for (let yy = Math.max(0, y - pad); yy <= Math.min(height - 1, y + pad); yy++) for (let xx = Math.max(0, x - pad); xx <= Math.min(width - 1, x + pad); xx++) {
      const at = (yy * width + xx) * 4;
      colour[at] = colour[at + 1] = colour[at + 2] = 31;
      normal[at] = normal[at + 1] = 128; normal[at + 2] = 255;
    }
  }
}

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

// Each atlas region belongs to a complete material, not merely its base-color texture. Materials with no base-color
// map still need real UVs for tyre tread, leather, brushed discs and paint normal maps.
async function materialAtlas(glb, parts, model) {
  const width = model.atlasSize?.[0] ?? 2048, height = model.atlasSize?.[1] ?? (model.id === 'super' ? 2048 : 1024), gutter = 4;
  const descriptors = new Map(), images = new Map();
  for (const p of parts) {
    if (p.wheelLike && !p.wheel) continue;
    const m = p.material ?? {}, pbr = m.pbrMetallicRoughness ?? {};
    const normalInfo = m.normalTexture?.scale === 0 ? null : m.normalTexture;
    const key = JSON.stringify([pbr, normalInfo, m.emissiveTexture, m.emissiveFactor, p.paint]);
    let d = descriptors.get(key);
    if (!d) {
      d = { material: m, pbr, paint: p.paint, normalInfo, minU: Infinity, minV: Infinity, maxU: -Infinity, maxV: -Infinity, triangles: 0 };
      descriptors.set(key, d);
    }
    p.atlas = d;
    d.triangles += p.data.index.length / 3;
    for (let i = 0; i < p.data.uv.length; i += 2) {
      d.minU = Math.min(d.minU, p.data.uv[i]); d.maxU = Math.max(d.maxU, p.data.uv[i]);
      d.minV = Math.min(d.minV, p.data.uv[i + 1]); d.maxV = Math.max(d.maxV, p.data.uv[i + 1]);
    }
  }
  const textured = [], flats = [];
  for (const d of descriptors.values()) {
    const infos = [d.pbr.baseColorTexture, d.pbr.metallicRoughnessTexture, d.normalInfo, d.material.emissiveTexture].filter(Boolean);
    for (const info of infos) if ((info.extensions?.KHR_texture_transform?.texCoord ?? info.texCoord ?? 0) !== 0) throw new Error(`${model.id}: material ${d.material.name} uses a non-primary UV channel`);
    d.textured = infos.length > 0;
    d.minU = Number.isFinite(d.minU) ? d.minU : 0; d.minV = Number.isFinite(d.minV) ? d.minV : 0;
    if (d.maxU - d.minU < 1e-6) d.maxU = d.minU + 1;
    if (d.maxV - d.minV < 1e-6) d.maxV = d.minV + 1;
    if (d.textured) {
      d.size = (d.paint && d.pbr.baseColorTexture) || (model.id === 'super' && d.material.name === 'Dashboard') ? 1024 : 512;
      if (model.id === 'super' && /Interior|Floormat/.test(d.material.name ?? '')) d.size = 256;
      if (model.id === 'super' && !d.pbr.baseColorTexture && !d.pbr.metallicRoughnessTexture && !d.normalInfo && d.material.name !== 'Dashboard') d.size = 256;
      textured.push(d);
    } else { d.size = FLAT; flats.push(d); }
  }
  textured.sort((a, b) => b.size - a.size || b.triangles - a.triangles);
  const cellsX = width / 256, cellsY = height / 256, occupied = new Uint8Array(cellsX * cellsY);
  const swatchX = width - 256, swatchY = height - 256;
  occupied[occupied.length - 1] = 1;
  function place(d) {
    const side = d.size / 256;
    for (let y = 0; y <= cellsY - side; y++) for (let x = 0; x <= cellsX - side; x++) {
      let free = true;
      for (let yy = 0; yy < side; yy++) for (let xx = 0; xx < side; xx++) if (occupied[(y + yy) * cellsX + x + xx]) free = false;
      if (!free) continue;
      for (let yy = 0; yy < side; yy++) for (let xx = 0; xx < side; xx++) occupied[(y + yy) * cellsX + x + xx] = 1;
      d.x = x * 256; d.y = y * 256; return true;
    }
    return false;
  }
  for (const d of textured) {
    if (place(d)) continue;
    d.size = 256;
    if (!place(d)) throw new Error(`${model.id}: material atlas does not fit`);
  }
  flats.forEach((d, i) => { d.x = swatchX + (i % 16) * 16; d.y = swatchY + Math.floor(i / 16) * 16; });
  if (flats.length > 256) throw new Error(`${model.id}: too many flat materials`);
  const colour = Buffer.alloc(width * height * 4), surface = Buffer.alloc(width * height * 4), normal = Buffer.alloc(width * height * 4);
  for (let i = 0; i < normal.length; i += 4) { normal[i] = normal[i + 1] = 128; normal[i + 2] = normal[i + 3] = 255; }
  if (model.id === 'super') {
    const sidewall = [...descriptors.values()].find((d) => d.material.name === 'Tireside');
    if (sidewall?.pbr.baseColorTexture && sidewall.normalInfo) {
      const colorSource = glb.gltf.textures[sidewall.pbr.baseColorTexture.index].source, normalSource = glb.gltf.textures[sidewall.normalInfo.index].source;
      const [colorImage, normalImage] = await Promise.all([colorSource, normalSource].map((source) => sharp(glb.image(source)).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
      if (colorImage.info.width !== normalImage.info.width || colorImage.info.height !== normalImage.info.height) throw new Error('Sidewall source maps must share their dimensions');
      stripSidewallBrands(colorImage.data, normalImage.data, colorImage.info.width, colorImage.info.height);
      images.set(`${colorSource}:original`, colorImage); images.set(`${normalSource}:original`, normalImage);
    }
  }
  const imageOf = async (info, d) => {
    if (!info) return null;
    const tex = glb.gltf.textures[info.index], sampler = glb.gltf.samplers?.[tex.sampler] ?? {};
    const transform = info.extensions?.KHR_texture_transform;
    const scale = transform?.scale ?? [1, 1];
    const originalKey = `${tex.source}:original`;
    if (!images.has(originalKey)) {
      const original = await sharp(glb.image(tex.source)).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      model.processImage?.(tex.source, original);
      images.set(originalKey, original);
    }
    const original = images.get(originalKey), inner = Math.max(1, d.size - gutter * 2);
    const footprint = Math.max(Math.abs(scale[0]) * (d.maxU - d.minU) * original.info.width / inner, Math.abs(scale[1]) * (d.maxV - d.minV) * original.info.height / inner);
    const level = Math.max(0, Math.floor(Math.log2(Math.max(1, footprint)))), key = `${tex.source}:${level}`;
    if (!images.has(key)) {
      if (!level) images.set(key, original);
      else images.set(key, await sharp(original.data, { raw: { width: original.info.width, height: original.info.height, channels: 4 } })
        .resize(Math.max(1, original.info.width >> level), Math.max(1, original.info.height >> level), { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true }));
    }
    return { ...images.get(key), texture: info, sampler };
  };
  const sample = (im, u, v, out) => {
    if (!im) { out[0] = out[1] = out[2] = out[3] = 255; return out; }
    [u, v] = transformTextureUV(im.texture, u, v);
    u = wrapTextureCoordinate(u, im.sampler.wrapS); v = wrapTextureCoordinate(v, im.sampler.wrapT);
    const { width: w, height: h } = im.info, x = u * (w - 1), y = v * (h - 1), x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1), tx = x - x0, ty = y - y0;
    for (let c = 0; c < 4; c++) {
      const a = im.data[(y0 * w + x0) * 4 + c] * (1 - tx) + im.data[(y0 * w + x1) * 4 + c] * tx;
      const b = im.data[(y1 * w + x0) * 4 + c] * (1 - tx) + im.data[(y1 * w + x1) * 4 + c] * tx;
      out[c] = a * (1 - ty) + b * ty;
    }
    return out;
  };
  let hasNormals = false, paintRoughness = 0;
  for (const d of descriptors.values()) {
    const [base, mr, nm, em] = await Promise.all([imageOf(d.pbr.baseColorTexture, d), imageOf(d.pbr.metallicRoughnessTexture, d), imageOf(d.normalInfo, d), imageOf(d.material.emissiveTexture, d)]);
    hasNormals ||= !!nm;
    const microfacet = !!nm && model.microfacet?.test(d.material.name ?? '');
    const normalSource = microfacet ? images.get(`${glb.gltf.textures[d.normalInfo.index].source}:original`) : null;
    const variance = normalSource ? normalSlopeVariance(normalSource.data, d.normalInfo.scale ?? 1) : 0;
    if (microfacet && d.paint) paintRoughness = Math.max(paintRoughness, filteredMicrofacetRoughness(d.pbr.roughnessFactor ?? 1, variance));
    const factor = d.pbr.baseColorFactor ?? [1, 1, 1, 1], emission = d.material.emissiveFactor ?? [0, 0, 0];
    const tile = Buffer.alloc(d.size * d.size * 4), roughTile = Buffer.alloc(tile.length), normalTile = Buffer.alloc(tile.length);
    const a = [0, 0, 0, 0], b = [0, 0, 0, 0], e = [0, 0, 0, 0], n = [0, 0, 0, 0];
    const pad = d.textured ? gutter : 0, inside = Math.max(1, d.size - pad * 2 - 1);
    for (let y = 0; y < d.size; y++) for (let x = 0; x < d.size; x++) {
      const at = (y * d.size + x) * 4, u = d.minU + clamp((x - pad) / inside) * (d.maxU - d.minU), v = d.minV + clamp((y - pad) / inside) * (d.maxV - d.minV);
      sample(base, u, v, a); sample(mr, u, v, b); sample(em, u, v, e);
      for (let c = 0; c < 3; c++) tile[at + c] = Math.round(clamp(toSRGB(toLinear(a[c] / 255) * factor[c] + (em ? toLinear(e[c] / 255) * emission[c] : 0))) * 255);
      tile[at + 3] = 255;
      const roughness = b[1] / 255 * (d.pbr.roughnessFactor ?? 1);
      roughTile[at] = 0; roughTile[at + 1] = Math.round(filteredMicrofacetRoughness(roughness, variance) * 255); roughTile[at + 2] = Math.round(b[2] * (d.pbr.metallicFactor ?? 1)); roughTile[at + 3] = 255;
      if (nm && !microfacet) {
        sample(nm, u, v, n);
        const vector = decodeNormal(n[0], n[1], n[2], d.normalInfo.scale ?? 1, d.normalInfo.extensions?.KHR_texture_transform?.rotation ?? 0);
        for (let c = 0; c < 3; c++) normalTile[at + c] = Math.round((vector[c] * 0.5 + 0.5) * 255);
      } else { normalTile[at] = normalTile[at + 1] = 128; normalTile[at + 2] = 255; }
      normalTile[at + 3] = 255;
    }
    if (d.paint) {
      if (!base || model.flatPaint) for (let k = 0; k < tile.length; k += 4) { tile[k] = tile[k + 1] = tile[k + 2] = 204; tile[k + 3] = 255; }
      else maskPaint(tile, d.size);
      for (let k = 0; k < tile.length; k += 4) { roughTile[k] = tile[k + 3]; tile[k + 3] = 255; }
    }
    for (let row = 0; row < d.size; row++) {
      const at = ((d.y + row) * width + d.x) * 4;
      tile.copy(colour, at, row * d.size * 4, (row + 1) * d.size * 4);
      roughTile.copy(surface, at, row * d.size * 4, (row + 1) * d.size * 4);
      normalTile.copy(normal, at, row * d.size * 4, (row + 1) * d.size * 4);
    }
  }
  return { colour, surface, normal, hasNormals, paintRoughness, width, height, gutter };
}

async function importCar(model, { source = SOURCE, out = OUT, locked = null } = {}) {
  await prepareTools();
  const glb = await readGlb(path.join(source, `${model.file}.glb`));
  let parts = [];
  for (const item of glb.items) {
    const name = item.material?.name ?? '';
    if (model.drop && (model.drop.test(item.node) || model.drop.test(item.mesh))) continue;
    if (model.dropPart?.(item)) continue;
    if (model.dropMaterial?.test(name)) continue;
    let data = primitiveData(glb, item);
    if (model.filterData) data = model.filterData(data, item);
    if (!data) continue;
    if (model.id === 'super' && item.node === 'BodyWindshieldWipers') data = simplifyParkedWipers(data);
    if (!data.index.length) continue;
    const label = `${item.path} ${item.mesh}`;
    const wheelLike = (model.wheel ?? /wheel|tire|tyre|\brim|brake ?pad|BrakePad|Brake$|Disc$/i).test(`${item.node} ${item.mesh} ${name}`) && !/steering|steer_/i.test(label);
    const glass = model.glassOnly ? !!model.glass?.test(`${name} ${item.node}`) : item.material?.alphaMode === 'BLEND' || model.glass?.test(name) || !!item.material?.extensions?.KHR_materials_transmission || /^glass$/i.test(name);
    const caliper = model.caliper ? model.caliper.test(label) : model.id === 'super' && /BrakePad/.test(item.node);
    const steering = model.sourceInterior && (model.steering ?? /InteriorSteeringWheel\d+$/).test(item.node);
    parts.push({ item, name, data, label, wheelLike, glass, caliper, steering, material: model.material ? model.material(item.material, item) : item.material, paint: model.paintPart ? !!model.paintPart(item, name) : !!model.paint?.test(name) });
  }
  if (model.transformParts) parts = model.transformParts(parts);
  parts = parts.map(p => ({ ...p, data: compactPrimitiveData(p.data) })).filter(p => p.data.index.length);
  if (model.mirrorX) for (const p of parts) {
    p.data.pos = p.data.pos.slice(); p.data.nor = p.data.nor.slice();
    for (let i = 0; i < p.data.pos.length; i += 3) { p.data.pos[i] *= -1; p.data.nor[i] *= -1; }
    p.data.flipped = !p.data.flipped;
  }
  if (model.splitWheels) {
    const { splitDisconnected } = await import('./split-parts.mjs');
    parts = parts.flatMap(p => p.wheelLike ? splitDisconnected(p.data).map(data => ({ ...p, data })) : [p]);
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
    const quadrant = `${b.c[0] > (shell.lo[0] + shell.hi[0]) / 2}:${b.c[2] > (shell.lo[2] + shell.hi[2]) / 2}`;
    let found = model.splitWheels ? clusters.find(w => w.quadrant === quadrant)
      : clusters.find((w) => Math.hypot(w.c[0] - b.c[0], w.c[1] - b.c[1], w.c[2] - b.c[2]) < size * 0.1);
    if (!found) clusters.push(found = { c: b.c, quadrant, parts: [], lo: [...b.lo], hi: [...b.hi] });
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

  // A licensed replacement is fitted to the existing physical rig, rather than silently changing handling.
  // Both positions and their inverse-transpose normals follow the same smooth deformation.
  let fit = null;
  if (model.fitSpec) {
    if (!locked?.spec) throw new Error(`${model.id}: a replacement requires a locked physical rig`);
    const bodyX = [], point = [0, 0, 0]; let roof = 0;
    for (const p of parts) if (!p.wheelLike && !/mirror/i.test(p.label)) {
      for (let i = 0; i < p.data.pos.length; i += 3) {
        place(p.data.pos[i], p.data.pos[i + 1], p.data.pos[i + 2], point, 0);
        bodyX.push(Math.abs(point[0])); roof = Math.max(roof, point[1]);
      }
    }
    bodyX.sort((a, b) => a - b);
    const sourceSpec = { zFront: (zHi - zMid) * scale, zRear: (zLo - zMid) * scale,
      halfW: bodyX[Math.floor(bodyX.length * 0.97)], height: roof, wheels: wheels.map(w => [...w.at, w.radius]) };
    const { createCarFit } = await import('./fit-car.mjs');
    fit = createCarFit(sourceSpec, locked.spec);
  }

  const steeringParts = parts.filter((p) => p.steering);
  let steering = null;
  if (steeringParts.length) {
    const ring = steeringParts.find((p) => /Wheel02$/.test(p.item.node)) ?? steeringParts[0], bounds = centre(ring.data), position = [0, 0, 0];
    place(...bounds.c, position, 0);
    if (model.id === 'super') {
      const column = parts.find((p) => p.item.node === 'InteriorSteeringCylinder').item.matrix;
      const axis = [turnX(column[4], column[6]) * (model.narrow ?? 1), column[5], turnZ(column[4], column[6])], length = Math.hypot(...axis);
      steering = { position, axis: axis.map((v) => v / length), radius: (bounds.hi[0] - bounds.lo[0]) * scale * (model.narrow ?? 1) * 0.5 };
    } else {
      const tilt = model.steeringTilt ?? 0.42;
      if (model.steeringPosition) place(model.steeringPosition[0] * (model.mirrorX ? -1 : 1), model.steeringPosition[1], model.steeringPosition[2], position, 0);
      const sourceAxis = model.steeringAxis;
      let axis = sourceAxis ? [turnX(sourceAxis[0] * (model.mirrorX ? -1 : 1), sourceAxis[2]), sourceAxis[1], turnZ(sourceAxis[0] * (model.mirrorX ? -1 : 1), sourceAxis[2])] : [0, Math.sin(tilt), Math.cos(tilt)];
      axis = fit ? fit.normal(axis, position) : axis;
      const magnitude = Math.hypot(...axis); axis = axis.map(v => v / magnitude);
      steering = { position: fit ? fit.point(position) : position, axis, radius: model.steeringRadius ? model.steeringRadius * scale : 0.18 };
    }
  }
  let cabinLayout = model.fitSpec && !model.sourceInterior ? undefined : locked?.cabinLayout;
  if (model.id === 'super' && model.sourceInterior && steering && cabinLayout) {
    // This source has a central driving seat. Derive visual anchors from its cushion, pedals and screen, while keeping
    // the game's collision shape, wheelbase, suspension and driving tune untouched.
    const cushions = [];
    for (const p of parts.filter((p) => /InteriorSeatsColor/.test(p.item.node))) {
      const d = p.data;
      for (let i = 0; i < d.pos.length; i += 3) if (Math.abs(d.pos[i]) < 0.28 && d.pos[i + 1] > 0.14 && d.pos[i + 1] < 0.5 && d.pos[i + 2] > 0 && d.nor[i + 1] > 0.6) cushions.push([d.pos[i], d.pos[i + 1], d.pos[i + 2]]);
    }
    const quantile = (axis, q) => { const a = cushions.map((p) => p[axis]).sort((a, b) => a - b); return a[Math.floor((a.length - 1) * q)]; };
    const seat = [0, 0, 0], pedals = [0, 0, 0];
    place(0, quantile(1, 0.75), quantile(2, 0.1) + (quantile(2, 0.9) - quantile(2, 0.1)) * 0.33, seat, 0);
    const pedal = centre(parts.find((p) => p.item.node === 'InteriorPedalBrake').data);
    place(0, pedal.c[1], pedal.c[2], pedals, 0);
    const dash = parts.find((p) => p.item.node === 'InteriorSteeringDash').data;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < dash.pos.length; i += 3) if (dash.nor[i + 2] < -0.8) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], dash.pos[i + j]); hi[j] = Math.max(hi[j], dash.pos[i + j]); }
    const instrumentPosition = [0, 0, 0];
    place((lo[0] + hi[0]) * 0.5, (lo[1] + hi[1]) * 0.5, lo[2] - 0.003, instrumentPosition, 0);
    cabinLayout = { ...cabinLayout, seat, wheel: steering.position, radius: steering.radius, tilt: Math.asin(steering.axis[1]), pedals,
      instruments: { position: instrumentPosition, width: (hi[0] - lo[0]) * scale * (model.narrow ?? 1) * 0.94, height: (hi[1] - lo[1]) * scale * 0.94, rotation: [0, Math.PI - yaw, 0] } };
  } else if (model.sourceInterior && cabinLayout) {
    const converted = p => {
      const point = [0, 0, 0]; place(...p, point, 0); return fit ? fit.point(point) : point;
    };
    const component = expression => parts.find(p => expression?.test(p.item.node));
    const seatPart = component(model.seat), pedalPart = component(model.pedal), gaugePart = component(model.gauges);
    let seat = cabinLayout.seat;
    if (seatPart) {
      const bounds = centre(seatPart.data), candidates = [], d = seatPart.data;
      for (let i = 0; i < d.pos.length; i += 3) if (d.nor[i + 1] > 0.6 && d.pos[i + 1] < bounds.lo[1] + (bounds.hi[1] - bounds.lo[1]) * 0.5) candidates.push([d.pos[i], d.pos[i + 1], d.pos[i + 2]]);
      if (candidates.length) {
        const median = axis => candidates.map(p => p[axis]).sort((a, b) => a - b)[Math.floor(candidates.length / 2)];
        seat = converted([median(0), median(1), median(2)]);
      }
    }
    if (model.sourceSeat) seat = converted([model.sourceSeat[0] * (model.mirrorX ? -1 : 1), model.sourceSeat[1], model.sourceSeat[2]]);
    // Seat bolsters can contain far more vertices than the cushion and bias its median sideways.
    // The real steering column is the driver centreline; keep the eye clear of the A-pillar.
    if (steering) seat = [steering.position[0], seat[1], seat[2]];
    cabinLayout = { ...cabinLayout, seat, ...(steering ? { wheel: steering.position, radius: steering.radius, tilt: Math.asin(steering.axis[1]) } : {}),
      ...(pedalPart ? { pedals: converted(centre(pedalPart.data).c) } : {}) };
    if (model.sourceRoof !== undefined && model.sourceSeat) {
      cabinLayout.roof = converted([model.sourceSeat[0] * (model.mirrorX ? -1 : 1), model.sourceRoof, model.sourceSeat[2]])[1];
    }
    if (gaugePart) {
      const d = gaugePart.data, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < d.pos.length; i += 3) {
        const p = converted([d.pos[i], d.pos[i + 1], d.pos[i + 2]]);
        for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], p[c]); hi[c] = Math.max(hi[c], p[c]); }
      }
      cabinLayout.instruments = { position: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2] - 0.006],
        width: Math.min(0.43, hi[0] - lo[0]), height: Math.min(0.18, hi[1] - lo[1]), rotation: [0, Math.PI, 0] };
    }
  }

  const atlas = await materialAtlas(glb, parts, model);
  const { width: ATLAS_W, height: ATLAS_H } = atlas;

  // Geometry
  const vertices = { pos: [], nor: [], uv: [], flag: [] };
  const groups = { body: [], glass: [], exterior: [], wheels: wheels.map(() => []), calipers: wheels.map(() => []), steering: [] };
  const lightOf = (p) => {
    if (model.light) return model.light(p);
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
    const slot = p.atlas;
    const wheelIndex = p.wheel ? wheels.findIndex((w) => w.parts.includes(p)) : -1;
    const w = wheels[wheelIndex];
    const light = lightOf(p);
    for (let v = 0; v < d.pos.length / 3; v++) {
      place(d.pos[v * 3], d.pos[v * 3 + 1], d.pos[v * 3 + 2], scratch, 0);
      const x = scratch[0], y = scratch[1], z = scratch[2];
      if (w) vertices.pos.push(...(fit ? fit.wheelPoint([x - w.at[0], y - w.at[1], z - w.at[2]], wheelIndex) : [x - w.at[0], y - w.at[1], z - w.at[2]]));
      else if (p.steering) {
        const point = fit ? fit.point([x, y, z]) : [x, y, z];
        vertices.pos.push(...point.map((value, axis) => value - steering.position[axis]));
      }
      else vertices.pos.push(...(fit ? fit.point([x, y, z]) : [x, y, z]));
      const nx = turnX(d.nor[v * 3], d.nor[v * 3 + 2]) / (model.narrow ?? 1), ny = d.nor[v * 3 + 1], nz = turnZ(d.nor[v * 3], d.nor[v * 3 + 2]), nl = Math.hypot(nx, ny, nz) || 1;
      const normal = [nx / nl, ny / nl, nz / nl];
      vertices.nor.push(...(fit ? (w ? fit.wheelNormal(normal, wheelIndex) : fit.normal(normal, [x, y, z])) : normal));
      const u = d.uv[v * 2], vv = d.uv[v * 2 + 1];
      if (slot.textured) {
        const inner = slot.size - atlas.gutter * 2 - 1;
        vertices.uv.push((slot.x + atlas.gutter + 0.5 + (u - slot.minU) / (slot.maxU - slot.minU) * inner) / ATLAS_W,
          (slot.y + atlas.gutter + 0.5 + (vv - slot.minV) / (slot.maxV - slot.minV) * inner) / ATLAS_H);
      } else vertices.uv.push((slot.x + FLAT / 2) / ATLAS_W, (slot.y + FLAT / 2) / ATLAS_H);
      vertices.flag.push(model.vertexLight?.(p, v, x, y, z) ?? (light === 5 ? (z > 0 ? 1 : 2) : light || (p.glass ? 6 : 0)));
    }
    // Keep only the rotation: scale was uniform, a mirrored node reverses the winding
    const list = p.caliper ? groups.calipers[wheelIndex] : p.wheel ? groups.wheels[wheelIndex] : p.steering ? groups.steering : p.glass ? groups.glass : groups.body;
    const exterior = !p.wheel && !p.steering && !/Interior|Pedal|Engine|Underside|HoodInterior/i.test(p.item.node) && !/Interior|Floormat|Dashboard/i.test(p.name)
      && !(model.fitSpec && /Seat|Dash|Gauge|Sunvisor|Stalk|Shifter|Rollcage|Mirror.Int/i.test(p.item.node));
    for (let i = 0; i < d.index.length; i += 3) {
      const a = d.index[i] + base, b = d.index[i + 1] + base, c = d.index[i + 2] + base;
      if (d.flipped) list.push(a, c, b); else list.push(a, b, c);
      if (exterior) { if (d.flipped) groups.exterior.push(a, c, b); else groups.exterior.push(a, b, c); }
    }
  }

  const count = vertices.pos.length / 3;
  const positions = Float32Array.from(vertices.pos);
  let bodyIndex = Uint32Array.from(groups.body), glassIndex = Uint32Array.from(groups.glass);
  const wheelIndices = groups.wheels.map((w) => Uint32Array.from(w));
  const caliperIndices = groups.calipers.map((w) => Uint32Array.from(w));
  const steeringIndex = Uint32Array.from(groups.steering);
  // Respect shading and UV discontinuities in the near model. Position-only decimation at a 6 cm error once flattened
  // the detailed source's rims, panel crowns and interior. Glass and the actual steering wheel retain their source mesh.
  const budget = model.triangles;
  const total = (bodyIndex.length + glassIndex.length + wheelIndices.reduce((n, w) => n + w.length, 0)) / 3;
  await MeshoptSimplifier.ready;
  const attributes = new Float32Array(count * 5);
  for (let i = 0; i < count; i++) {
    attributes[i * 5] = vertices.nor[i * 3]; attributes[i * 5 + 1] = vertices.nor[i * 3 + 1]; attributes[i * 5 + 2] = vertices.nor[i * 3 + 2];
    attributes[i * 5 + 3] = vertices.uv[i * 2]; attributes[i * 5 + 4] = vertices.uv[i * 2 + 1];
  }
  const thin = (index, keep) => {
    if (!index.length || keep >= 1) return index;
    const target = Math.max(120, Math.floor(index.length * keep / 3) * 3);
    return MeshoptSimplifier.simplifyWithAttributes(index, positions, 3, attributes, 5, [0.7, 0.7, 0.7, 0.4, 0.4], null, Math.min(index.length, target), 0.0018, ['LockBorder'])[0];
  };
  if (budget && total > budget) {
    const keep = budget / total;
    bodyIndex = thin(bodyIndex, keep);
    for (let i = 0; i < 4; i++) wheelIndices[i] = thin(wheelIndices[i], keep);
    for (let i = 0; i < 4; i++) caliperIndices[i] = thin(caliperIndices[i], keep);
  }
  const shellIndex = Uint32Array.from(groups.exterior);
  const separateTraffic = model.id === 'super' || model.fitSpec;
  const lodAttributes = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    lodAttributes.set(attributes.subarray(i * 5, i * 5 + 5), i * 6);
    lodAttributes[i * 6 + 5] = vertices.flag[i];
  }
  // Spatial clustering alone can join chrome, glass and paint UVs at a shared position. Their triangles then
  // interpolate across unrelated atlas tiles, making intact traffic look crumpled. Preserve all surface attributes.
  const surfaceLOD = (list, target, error) => simplifyCarSurface(MeshoptSimplifier, list, positions, lodAttributes, target, error);
  const farTarget = separateTraffic ? 1200 : Math.max(420, Math.floor(shellIndex.length / 3 * 0.28));
  let far = model.fitSpec ? surfaceLOD(shellIndex, farTarget, 0.12)
    : MeshoptSimplifier.simplify(shellIndex, positions, 3, Math.min(shellIndex.length, farTarget * 3), 0.05, [])[0];
  if (!model.fitSpec && separateTraffic && far.length > farTarget * 4.5) far = MeshoptSimplifier.simplifySloppy(shellIndex, positions, 3, null, farTarget * 3, 0.06)[0];
  const trafficLOD = (list, target, error) => {
    if (model.fitSpec) return surfaceLOD(list, target, error * 2);
    return MeshoptSimplifier.simplify(list, positions, 3, Math.min(list.length, target * 3), error, [])[0];
  };
  const trafficShell = separateTraffic ? trafficLOD(shellIndex, model.id === 'super' ? 8000 : 6000, 0.016) : null;
  const trafficWheels = separateTraffic ? wheelIndices.map(list => trafficLOD(list, model.id === 'super' ? 1200 : 800, 0.025)) : null;

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
  const hasCalipers = caliperIndices.some((list) => list.length);
  const steeringListIndex = 7 + (hasCalipers ? 4 : 0), trafficListIndex = steeringListIndex + (steering ? 1 : 0);
  const lists = [bodyIndex, glassIndex, far, ...wheelIndices, ...(hasCalipers ? caliperIndices : []), ...(steering ? [steeringIndex] : []), ...(trafficShell ? [trafficShell, ...trafficWheels] : [])];
  const remap = new Int32Array(count).fill(-1);
  let used = 0;
  for (const list of lists) for (const i of list) if (remap[i] < 0) remap[i] = used++;
  const tight = new Float32Array(used * 3), nor = new Int16Array(used * 4), uv = new Uint16Array(used * 2), flag = new Uint8Array(used);
  for (let i = 0; i < count; i++) {
    const to = remap[i];
    if (to < 0) continue;
    tight[to * 3] = positions[i * 3]; tight[to * 3 + 1] = positions[i * 3 + 1]; tight[to * 3 + 2] = positions[i * 3 + 2];
    nor.set(encodeNormal16(vertices.nor[i * 3], vertices.nor[i * 3 + 1], vertices.nor[i * 3 + 2]), to * 4);
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
  fs.writeFileSync(path.join(out, `${model.id}.bin`), file);
  const raw = { width: ATLAS_W, height: ATLAS_H, channels: 4 };
  await sharp(atlas.colour, { raw }).removeAlpha().webp({ quality: 93, effort: 5 }).toFile(path.join(out, `${model.id}_c.webp`));
  await sharp(atlas.surface, { raw }).removeAlpha().webp({ lossless: true, effort: 5 }).toFile(path.join(out, `${model.id}_m.webp`));
  if (atlas.hasNormals) await sharp(atlas.normal, { raw }).removeAlpha().webp({ lossless: true, effort: 5 }).toFile(path.join(out, `${model.id}_n.webp`));

  const front = wheels.slice(0, 2), rear = wheels.slice(2);
  const glassMat = parts.find((p) => p.glass)?.material;
  return {
    vertices: used, indices: triangles, ranges: ranges.slice(0, 14), normalFormat: 'snorm16',
    ...(atlas.hasNormals ? { normalTexture: `${model.id}_n.webp` } : {}),
    ...(atlas.paintRoughness ? { paintRoughness: atlas.paintRoughness } : {}),
    ...(hasCalipers ? { calipers: caliperIndices.map((_, i) => ranges.slice(14 + i * 2, 16 + i * 2)) } : {}),
    ...(steering ? { steering: { ...steering, range: ranges.slice(steeringListIndex * 2, steeringListIndex * 2 + 2) } } : {}),
    ...(trafficShell ? { trafficShell: ranges.slice(trafficListIndex * 2, trafficListIndex * 2 + 2), trafficWheels: trafficWheels.map((_, i) => ranges.slice((trafficListIndex + 1 + i) * 2, (trafficListIndex + 2 + i) * 2)) } : {}),
    ...(model.sourceInterior ? { sourceInterior: true } : {}),
    ...(cabinLayout ? { cabinLayout } : {}),
    sourceGeometry: { triangles: parts.reduce((n, p) => n + p.data.index.length / 3, 0), nearTriangles: (bodyIndex.length + glassIndex.length + wheelIndices.reduce((n, list) => n + list.length, 0) + caliperIndices.reduce((n, list) => n + list.length, 0) + steeringIndex.length) / 3 },
    glass: { alpha: glassMat?.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 0.7 },
    spec: locked?.spec ?? {
      zFront: round(zHi === zLo ? 0 : (zHi - zMid) * scale), zRear: round((zLo - zMid) * scale), halfW: round(halfW), height: round(top), sill: round(Math.min(sill, 0.5)),
      wheelX: round((front[0].at[0] - front[1].at[0]) / 2), wheelXr: round((rear[0].at[0] - rear[1].at[0]) / 2), wheelZf: round(front[0].at[2]), wheelZr: round(rear[0].at[2]),
      wheelRadius: round(wheels.reduce((n, w) => n + w.radius, 0) / 4),
      wheels: wheels.map((w) => [round(w.at[0]), round(w.at[1]), round(w.at[2]), round(w.radius)]),
      head: lamp(1, true), tail: lamp(2, true)
    }
  };
}

export { MODELS, importCar };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!SOURCE) throw new Error('Usage: node import-cars.mjs <sources> [--out dossier] [--only a,b] [--lock-manifest fichier]');
  fs.mkdirSync(OUT, { recursive: true });
  const lockFile = option('--lock-manifest') ?? new URL('../../assets/cars/models.json', import.meta.url).pathname;
  const locked = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) : {};
  const manifest = {};
  for (const model of MODELS) {
    if (ONLY && !ONLY.includes(model.id)) continue;
    manifest[model.id] = await importCar(model, { locked: locked[model.id] });
    const m = manifest[model.id];
    if (locked[model.id]?.spec && JSON.stringify(m.spec) !== JSON.stringify(locked[model.id].spec)) throw new Error(`${model.id}: physical dimensions changed`);
    console.log(model.id.padEnd(10), `${m.vertices} v ${m.sourceGeometry.nearTriangles} triangles proches`, `${m.normalTexture ?? 'sans normal map'}`);
  }
  const file = path.join(OUT, 'models.json');
  const earlier = ONLY && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  fs.writeFileSync(file, JSON.stringify({ ...earlier, ...manifest }));
}
