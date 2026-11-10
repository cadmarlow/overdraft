// A small software rasteriser: what bakes leaf sprays into cards and whole trees into impostor frames, and what lets a
// tree be looked at from Node without a browser. Orthographic by nature: callers hand over screen positions.
//
// Samples are taken at `ss` x `ss` per output pixel. A fragment is kept or dropped per sample (the shader decides,
// usually by comparing the leaf's coverage with the sample's own random threshold), the nearest kept one wins, and
// resolve() averages what the samples hold: coverage comes out as a true fraction and thin leaves keep their density.

import { hash01 } from './util.mjs';

export class Raster {
  constructor(w, h, ss = 4, channels = 8) {
    this.w = w; this.h = h; this.ss = ss; this.c = channels;
    this.W = w * ss; this.H = h * ss;
    const n = this.W * this.H;
    this.depth = new Float32Array(n);
    this.out = new Float32Array(n * channels);
    this.layers = new Uint16Array(n);
    this.frag = new Float32Array(channels);
    this.vary = new Float32Array(32);
    this.serial = 0;
    this.clear();
  }

  clear() {
    this.depth.fill(Infinity);
    this.out.fill(0);
    this.layers.fill(0);
    this.serial = 0;
  }

  /**
   * One triangle. Positions are in output pixels (x right, y down) with a depth where smaller is nearer.
   * v0..v2 are arrays of `k` varyings. shade(varyings, out, threshold) fills `out` and returns false to drop the
   * fragment; `threshold` is a random number in 0..1 that belongs to this sample of this triangle.
   */
  tri(x0, y0, z0, x1, y1, z1, x2, y2, z2, v0, v1, v2, k, shade) {
    const s = this.ss, W = this.W, H = this.H;
    x0 *= s; y0 *= s; x1 *= s; y1 *= s; x2 *= s; y2 *= s;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) return;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) return;
    const inv = 1 / area;
    const serial = ++this.serial;
    const vary = this.vary, frag = this.frag, C = this.c, depth = this.depth, out = this.out, layers = this.layers;
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        for (let i = 0; i < k; i++) vary[i] = v0[i] * w0 + v1[i] * w1 + v2[i] * w2;
        const index = y * W + x;
        if (!shade(vary, frag, hash01(index, serial))) continue;
        layers[index]++;
        const z = z0 * w0 + z1 * w1 + z2 * w2;
        if (z >= depth[index]) continue;
        depth[index] = z;
        const o = index * C;
        for (let c = 0; c < C; c++) out[o + c] = frag[c];
      }
    }
  }

  // Averages the samples of each pixel: { coverage, out (mean over the covered samples), depth (mean), layers (mean) }
  resolve() {
    const { w, h, ss, c: C, W } = this;
    const coverage = new Float32Array(w * h), out = new Float32Array(w * h * C), depth = new Float32Array(w * h), layers = new Float32Array(w * h);
    const total = ss * ss;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = y * w + x;
      let n = 0, d = 0, l = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const i = (y * ss + sy) * W + x * ss + sx;
        l += this.layers[i];
        if (this.depth[i] === Infinity) continue;
        n++;
        d += this.depth[i];
        for (let c = 0; c < C; c++) out[o * C + c] += this.out[i * C + c];
      }
      coverage[o] = n / total;
      layers[o] = l / total;
      if (n) {
        depth[o] = d / n;
        for (let c = 0; c < C; c++) out[o * C + c] /= n;
      }
    }
    return { coverage, out, depth, layers, w, h, c: C };
  }
}

// Spreads the colour of covered pixels into the clear ones around them (`passes` pixels deep), so that filtering and
// mipmaps never pull a leaf's edge toward black. `out` has `C` channels per pixel; channels listed in `keep` are left.
export function dilate(out, coverage, w, h, C, passes = 8) {
  let solid = new Uint8Array(w * h);
  for (let i = 0; i < solid.length; i++) solid[i] = coverage[i] > 0.004 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const next = solid.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      let n = 0;
      const acc = new Float32Array(C);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (!solid[j]) continue;
        n++;
        for (let c = 0; c < C; c++) acc[c] += out[j * C + c];
      }
      if (!n) continue;
      for (let c = 0; c < C; c++) out[i * C + c] = acc[c] / n;
      next[i] = 1;
    }
    solid = next;
  }
  return solid;
}
