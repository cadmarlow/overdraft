import fs from 'node:fs';
import sharp from 'sharp';

// Reads an uncompressed or RLE true-colour TGA into top-down RGBA
function readTGA(file) {
  const b = fs.readFileSync(file);
  const idLength = b[0], type = b[2], width = b.readUInt16LE(12), height = b.readUInt16LE(14), bpp = b[16], flip = !(b[17] & 0x20);
  if (type !== 2 && type !== 10) throw new Error(`${file}: TGA type ${type}`);
  const bytes = bpp / 8;
  const rgba = Buffer.alloc(width * height * 4);
  let o = 18 + idLength, n = 0;
  const put = (at) => {
    const y = Math.floor(n / width), x = n - y * width;
    const d = ((flip ? height - 1 - y : y) * width + x) * 4;
    rgba[d] = b[at + 2]; rgba[d + 1] = b[at + 1]; rgba[d + 2] = b[at]; rgba[d + 3] = bytes === 4 ? b[at + 3] : 255;
    n++;
  };
  const total = width * height;
  if (type === 2) while (n < total) { put(o); o += bytes; }
  else while (n < total) {
    const head = b[o++], count = (head & 127) + 1;
    if (head & 128) { for (let i = 0; i < count; i++) put(o); o += bytes; }
    else for (let i = 0; i < count; i++) { put(o); o += bytes; }
  }
  return { width, height, rgba };
}

// Clear pixels take the colour of the nearest solid ones, or mipmaps fade hair strands towards the painted background
function bleed(rgba, width, height) {
  let sum = [0, 0, 0], n = 0;
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] > 128) { sum[0] += rgba[i]; sum[1] += rgba[i + 1]; sum[2] += rgba[i + 2]; n++; }
  const mean = sum.map((v) => Math.round(v / Math.max(1, n)));
  const solid = new Uint8Array(width * height);
  for (let i = 0; i < solid.length; i++) solid[i] = rgba[i * 4 + 3] > 128 ? 1 : 0;
  for (let pass = 0; pass < 16; pass++) {
    const next = solid.slice();
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (solid[i]) continue;
      for (const j of [i - 1, i + 1, i - width, i + width]) if (solid[j]) {
        rgba[i * 4] = rgba[j * 4]; rgba[i * 4 + 1] = rgba[j * 4 + 1]; rgba[i * 4 + 2] = rgba[j * 4 + 2];
        next[i] = 1;
        break;
      }
    }
    solid.set(next);
  }
  for (let i = 0; i < solid.length; i++) if (!solid[i]) { rgba[i * 4] = mean[0]; rgba[i * 4 + 1] = mean[1]; rgba[i * 4 + 2] = mean[2]; }
}

// Colour and alpha resized apart: resizing them together multiplies colour by alpha and loses it where hair fades out
async function resized(rgba, width, height, w, h) {
  const raw = { raw: { width, height, channels: 4 } };
  const rgb = await sharp(rgba, raw).removeAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer();
  const alpha = await sharp(rgba, raw).extractChannel(3).resize(w, h, { fit: 'fill' }).raw().toBuffer();
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { out[i * 4] = rgb[i * 3]; out[i * 4 + 1] = rgb[i * 3 + 1]; out[i * 4 + 2] = rgb[i * 3 + 2]; out[i * 4 + 3] = alpha[i]; }
  return out;
}

export { readTGA, bleed, resized };
