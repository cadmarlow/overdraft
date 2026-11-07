// Offline sky visibility from the surveyed city, at four heights. No renderer dependency: the baker and its tests
// use exactly the same projection and binary format as the runtime loader.
const LIGHT_HEIGHTS = [2, 16, 48, 144];
const HEADER_BYTES = 48;
const MAGIC = 0x314c444f; // ODL1

function rasterizeHeights(buildings, bounds, cell = 4) {
  const minX = Math.floor(bounds.minX / cell) * cell;
  const minZ = Math.floor(bounds.minZ / cell) * cell;
  const width = Math.ceil((bounds.maxX - minX) / cell);
  const height = Math.ceil((bounds.maxZ - minZ) / cell);
  const data = new Uint16Array(width * height);
  for (const b of buildings) for (const polygon of b.polygons) {
    const rings = [polygon.outer, ...(polygon.holes || [])];
    const zs = polygon.outer.map(p => p.z);
    const from = Math.max(0, Math.ceil((Math.min(...zs) - minZ) / cell - 0.5));
    const to = Math.min(height - 1, Math.floor((Math.max(...zs) - minZ) / cell - 0.5));
    for (let row = from; row <= to; row++) {
      const z = minZ + (row + 0.5) * cell, crossings = [];
      for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], c = ring[j];
        if ((a.z > z) !== (c.z > z)) crossings.push(a.x + (z - a.z) * (c.x - a.x) / (c.z - a.z));
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const x0 = Math.max(0, Math.ceil((crossings[i] - minX) / cell - 0.5));
        const x1 = Math.min(width - 1, Math.floor((crossings[i + 1] - minX) / cell - 0.5));
        for (let x = x0; x <= x1; x++) data[row * width + x] = Math.max(data[row * width + x], Math.ceil(b.height));
      }
    }
  }
  return { minX, minZ, cell, width, height, data };
}

function bakeSkyVisibility(field, { heights = LIGHT_HEIGHTS, onProgress = () => {} } = {}) {
  const { width, height, cell, data } = field;
  const output = new Uint8Array(width * height * 4);
  const rays = Array.from({ length: 8 }, (_, i) => [1, 2, 3, 5, 8, 13, 21, 34, 55].map(d => {
    const x = Math.round(Math.cos(i * Math.PI / 4) * d), z = Math.round(Math.sin(i * Math.PI / 4) * d);
    return [x, z, 1 / (Math.hypot(x, z) * cell)];
  }));
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const sky = [0, 0, 0, 0];
      for (const ray of rays) {
        let a = 0, b = 0, c = 0, d = 0;
        for (const [dx, dz, invDistance] of ray) {
          const px = x + dx, pz = z + dz;
          if (px < 0 || pz < 0 || px >= width || pz >= height) continue;
          const roof = data[pz * width + px];
          a = Math.max(a, (roof - heights[0]) * invDistance);
          b = Math.max(b, (roof - heights[1]) * invDistance);
          c = Math.max(c, (roof - heights[2]) * invDistance);
          d = Math.max(d, (roof - heights[3]) * invDistance);
        }
        // Integral of cosine-weighted sky above the horizon: cos(atan(slope))^2.
        sky[0] += 1 / (1 + a * a); sky[1] += 1 / (1 + b * b);
        sky[2] += 1 / (1 + c * c); sky[3] += 1 / (1 + d * d);
      }
      const i = (z * width + x) * 4;
      for (let k = 0; k < 4; k++) output[i + k] = Math.round(sky[k] * 255 / 8);
    }
    if (z % 128 === 0) onProgress(z / height);
  }
  return { ...field, heights: [...heights], data: output };
}

function encodeLightField(field) {
  const bytes = new Uint8Array(HEADER_BYTES + field.data.length), h = new DataView(bytes.buffer);
  h.setUint32(0, MAGIC, true); h.setUint32(4, 1, true);
  h.setUint32(8, field.width, true); h.setUint32(12, field.height, true);
  h.setFloat32(16, field.minX, true); h.setFloat32(20, field.minZ, true); h.setFloat32(24, field.cell, true);
  field.heights.forEach((v, i) => h.setFloat32(28 + i * 4, v, true));
  bytes.set(field.data, HEADER_BYTES);
  return bytes;
}

// The same surveyed heights for local reflection rays. Two exact bytes retain metre-scale roofs well above 255 m;
// the other channels are reserved. This is geometry data, so it must never pass through image colour conversion.
function reflectionField(field) {
  const data = new Uint8Array(field.width * field.height * 4);
  for (let i = 0; i < field.data.length; i++) {
    data[i * 4] = field.data[i] & 255;
    data[i * 4 + 1] = field.data[i] >>> 8;
  }
  return { ...field, data, heights: [...LIGHT_HEIGHTS] };
}

function decodeLightField(bytes) {
  if (bytes.byteLength < HEADER_BYTES) throw new Error('Invalid urban light field.');
  const h = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = h.getUint32(8, true), height = h.getUint32(12, true), cell = h.getFloat32(24, true);
  const minX = h.getFloat32(16, true), minZ = h.getFloat32(20, true);
  const heights = Array.from({ length: 4 }, (_, i) => h.getFloat32(28 + i * 4, true));
  if (h.getUint32(0, true) !== MAGIC || h.getUint32(4, true) !== 1 || !width || !height || width > 4096 || height > 4096 ||
      !Number.isFinite(minX + minZ + cell) || !(cell > 0) || heights.some((v, i) => !Number.isFinite(v) || (i && v <= heights[i - 1])) ||
      bytes.byteLength !== HEADER_BYTES + width * height * 4) throw new Error('Invalid urban light field.');
  return { width, height, cell, minX, minZ, heights, data: bytes.subarray(HEADER_BYTES) };
}

export { LIGHT_HEIGHTS, rasterizeHeights, bakeSkyVisibility, reflectionField, encodeLightField, decodeLightField };
