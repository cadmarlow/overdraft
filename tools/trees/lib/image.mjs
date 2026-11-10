// Images for the tree tools: read with sharp, sampled as textures (bilinear, with a mip chain), written as WebP / PNG.
import sharp from 'sharp';

export async function readRGB(file) {
  const { data, info } = await sharp(file).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, c: info.channels };
}
export async function readGray(file) {
  const { data, info } = await sharp(file).removeAlpha().toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, c: info.channels };
}
export async function readRGBA(file) {
  const { data, info } = await sharp(file).ensureAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, c: 4 };
}

const TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) { const s = i / 255; TO_LINEAR[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
export const toLinear = (byte) => TO_LINEAR[byte];
export const toSRGB = (l) => {
  const v = l <= 0 ? 0 : l >= 1 ? 1 : l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return Math.round(v * 255);
};

/**
 * A texture of float channels with its mip chain. `premultiply` names the channel whose average weights the others
 * (colour under coverage), so mips never drag the colour of clear texels into leaf edges.
 */
export class Texture {
  constructor(w, h, channels, data = null) {
    this.w = w; this.h = h; this.c = channels;
    this.levels = [{ w, h, data: data || new Float32Array(w * h * channels) }];
  }

  get data() { return this.levels[0].data; }

  buildMips(alphaChannel = -1) {
    this.levels.length = 1;
    const C = this.c;
    let src = this.levels[0];
    while (src.w > 1 || src.h > 1) {
      const w = Math.max(1, src.w >> 1), h = Math.max(1, src.h >> 1);
      const data = new Float32Array(w * h * C);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * C;
        let wsum = 0;
        for (let k = 0; k < 4; k++) {
          const sx = Math.min(src.w - 1, x * 2 + (k & 1)), sy = Math.min(src.h - 1, y * 2 + (k >> 1));
          const i = (sy * src.w + sx) * C;
          const a = alphaChannel >= 0 ? src.data[i + alphaChannel] : 1;
          for (let c = 0; c < C; c++) data[o + c] += c === alphaChannel ? src.data[i + c] : src.data[i + c] * a;
          wsum += a;
        }
        for (let c = 0; c < C; c++) {
          if (c === alphaChannel) data[o + c] /= 4;
          else if (wsum > 1e-6) data[o + c] /= wsum;
          else {
            // nothing here: keep a plain average so deeper levels still have a colour to give
            let s = 0;
            for (let k = 0; k < 4; k++) s += src.data[(Math.min(src.h - 1, y * 2 + (k >> 1)) * src.w + Math.min(src.w - 1, x * 2 + (k & 1))) * C + c];
            data[o + c] = s / 4;
          }
        }
      }
      src = { w, h, data };
      this.levels.push(src);
    }
    return this;
  }

  // Bilinear sample of one level at (u, v) in 0..1 (v down), clamped; writes `out`
  sampleLevel(level, u, v, out) {
    const L = this.levels[Math.max(0, Math.min(this.levels.length - 1, level))];
    const C = this.c, w = L.w, h = L.h, d = L.data;
    let x = u * w - 0.5, y = v * h - 0.5;
    if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
    if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
    const x0 = x | 0, y0 = y | 0, x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0;
    const fx = x - x0, fy = y - y0;
    const a = (y0 * w + x0) * C, b = (y0 * w + x1) * C, c2 = (y1 * w + x0) * C, e = (y1 * w + x1) * C;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    for (let c = 0; c < C; c++) out[c] = d[a + c] * w00 + d[b + c] * w10 + d[c2 + c] * w01 + d[e + c] * w11;
    return out;
  }

  // Trilinear sample at a fractional level
  sample(u, v, lod, out, tmp) {
    if (lod <= 0 || this.levels.length === 1) return this.sampleLevel(0, u, v, out);
    const l0 = Math.min(this.levels.length - 1, Math.floor(lod)), f = lod - l0;
    this.sampleLevel(l0, u, v, out);
    if (f < 0.01 || l0 + 1 >= this.levels.length) return out;
    this.sampleLevel(l0 + 1, u, v, tmp);
    for (let c = 0; c < this.c; c++) out[c] += (tmp[c] - out[c]) * f;
    return out;
  }
}

// 8-bit image (sRGB colour channels made linear when `linear`) into a float texture
export function textureFrom(img, { linear = [], channels = img.c } = {}) {
  const t = new Texture(img.w, img.h, channels);
  const d = t.data, s = img.data;
  for (let i = 0, n = img.w * img.h; i < n; i++) {
    for (let c = 0; c < channels; c++) {
      const b = s[i * img.c + Math.min(c, img.c - 1)];
      d[i * channels + c] = linear.includes(c) ? TO_LINEAR[b] : b / 255;
    }
  }
  return t;
}

export async function writeWebp(file, bytes, w, h, channels, options = {}) {
  await sharp(bytes, { raw: { width: w, height: h, channels } }).webp({ quality: 88, alphaQuality: 94, effort: 5, exact: true, ...options }).toFile(file);
}
export async function writePng(file, bytes, w, h, channels) {
  await sharp(bytes, { raw: { width: w, height: h, channels } }).png({ compressionLevel: 6 }).toFile(file);
}
