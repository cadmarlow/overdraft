// Draws a tree's geometry through the software rasteriser, with the same surface colours the game's material gives
// it (js/tree-materials.js mirrors the formulas below): used to bake the impostor frames and to look at a tree.
import path from 'node:path';
import { readRGBA, readRGB, Texture, toLinear } from './image.mjs';
import { V } from './util.mjs';

// --- What the surface is, before any light. The runtime computes exactly this.
// A card's own shade and hue, from its random number
export function cardTint(rnd, out) {
  const b = 0.84 + 0.3 * rnd;
  const h = ((rnd * 7.31) % 1) - 0.5;
  out[0] = b * (1 + 0.18 * h); out[1] = b; out[2] = b * (1 - 0.22 * h);
  return out;
}
// Leaves deep in the crown stand in the shade of the others
export const crownShade = (ao) => 0.5 + 0.5 * ao;
export const barkShade = (ao) => 0.55 + 0.45 * ao;
// The underside of a leaf: paler, matt
export const UNDERSIDE = [1.12, 1.14, 0.94];
// What a bark photograph is multiplied by so that its mean becomes the species' bark colour (sRGB bytes)
export function barkTint(textures, sp) {
  const mean = textures.barkMean[sp.bark];
  return sp.barkColor.map((v, c) => toLinear(v) / Math.max(1e-4, mean[c]));
}

/** The textures a tree is drawn with: { foliage (r g b linear, coverage), relief (nx, ny, thin), bark: { name: rgb } } */
export async function loadTextures(assets, barks) {
  const c = await readRGBA(path.join(assets, 'foliage_c.webp'));
  const foliage = new Texture(c.w, c.h, 4);
  for (let i = 0, n = c.w * c.h; i < n; i++) {
    foliage.data[i * 4] = toLinear(c.data[i * 4]); foliage.data[i * 4 + 1] = toLinear(c.data[i * 4 + 1]);
    foliage.data[i * 4 + 2] = toLinear(c.data[i * 4 + 2]); foliage.data[i * 4 + 3] = c.data[i * 4 + 3] / 255;
  }
  foliage.buildMips(3);
  const nimg = await readRGB(path.join(assets, 'foliage_n.webp'));
  const relief = new Texture(nimg.w, nimg.h, 3);
  for (let i = 0; i < nimg.w * nimg.h * 3; i++) relief.data[i] = nimg.data[i] / 255;
  relief.buildMips();
  const bark = {}, barkMean = {};
  for (const name of barks) {
    const b = await readRGB(path.join(assets, `bark-${name}_c.webp`));
    const t = new Texture(b.w, b.h, 3);
    const sum = [0, 0, 0];
    for (let i = 0; i < b.w * b.h * 3; i++) { t.data[i] = toLinear(b.data[i]); sum[i % 3] += t.data[i]; }
    bark[name] = t.buildMips();
    barkMean[name] = sum.map((v) => v / (b.w * b.h));
  }
  return { foliage, relief, bark, barkMean };
}

const K = 10; // u v | normal | ao | random | leaf | pad
const texel = new Float32Array(4), tmp = new Float32Array(4), rel = new Float32Array(3), tint = new Float32Array(3);
const a = new Float32Array(K), b = new Float32Array(K), c = new Float32Array(K);

/**
 * Rasterises geometry `gb` (lib/mesh.mjs) as seen along `view.forward`.
 * view: { right, up, forward (unit, from the eye into the scene), center, half (metres from the centre to the frame's edge) }
 * Output channels: 0-2 surface colour (linear), 3-5 normal (tree frame), 6 sky occlusion, 7 thinness (leaves only)
 */
export function drawTree(raster, gb, view, textures, sp) {
  const { right, up, forward, center, half } = view;
  const { w, h } = raster;
  const bark = textures.bark[sp.bark], woodTint = barkTint(textures, sp);
  const P = gb.pos, N = gb.nrm, UV = gb.uv, SH = gb.shade, I = gb.idx;
  const px = half * 2 / (w * raster.ss); // metres per sample
  const screen = new Float32Array((P.length / 3) * 3);
  for (let i = 0, n = P.length / 3; i < n; i++) {
    const x = P[i * 3] - center[0], y = P[i * 3 + 1] - center[1], z = P[i * 3 + 2] - center[2];
    screen[i * 3] = ((x * right[0] + y * right[1] + z * right[2]) / half * 0.5 + 0.5) * w;
    screen[i * 3 + 1] = (0.5 - (x * up[0] + y * up[1] + z * up[2]) / half * 0.5) * h;
    screen[i * 3 + 2] = x * forward[0] + y * forward[1] + z * forward[2];
  }
  const load = (dst, i) => {
    dst[0] = UV[i * 2]; dst[1] = UV[i * 2 + 1];
    dst[2] = N[i * 3]; dst[3] = N[i * 3 + 1]; dst[4] = N[i * 3 + 2];
    dst[5] = SH[i * 4]; dst[6] = SH[i * 4 + 2]; dst[7] = SH[i * 4 + 3];
  };
  for (let t = 0; t < I.length; t += 3) {
    const i0 = I[t], i1 = I[t + 1], i2 = I[t + 2];
    load(a, i0); load(b, i1); load(c, i2);
    const p0 = [P[i0 * 3], P[i0 * 3 + 1], P[i0 * 3 + 2]], p1 = [P[i1 * 3], P[i1 * 3 + 1], P[i1 * 3 + 2]], p2 = [P[i2 * 3], P[i2 * 3 + 1], P[i2 * 3 + 2]];
    const e1 = V.sub(p1, p0), e2 = V.sub(p2, p0);
    const face = V.cross(e1, e2);
    const back = V.dot(face, forward) > 0;
    let shade;
    if (a[7] > 0.5) {
      // tangent frame of the card from its uv, for the leaves' own relief
      const du1 = b[0] - a[0], dv1 = b[1] - a[1], du2 = c[0] - a[0], dv2 = c[1] - a[1];
      const det = du1 * dv2 - du2 * dv1 || 1e-9;
      const T = V.norm(V.scale(V.sub(V.scale(e1, dv2), V.scale(e2, dv1)), 1 / det));
      const B = V.norm(V.scale(V.sub(V.scale(e2, du1), V.scale(e1, du2)), -1 / det)); // toward the top of the tile
      const texels = Math.hypot(du1 * textures.foliage.w, dv1 * textures.foliage.h) / Math.max(1e-6, V.len(e1) / px);
      const lod = Math.max(0, Math.log2(texels));
      shade = (v, out, threshold) => {
        textures.foliage.sample(v[0], v[1], lod, texel, tmp);
        if (texel[3] <= threshold * 0.98 + 0.01) return false;
        textures.relief.sampleLevel(Math.min(textures.relief.levels.length - 1, Math.round(lod)), v[0], v[1], rel);
        cardTint(v[6], tint);
        const s = crownShade(v[5]);
        out[0] = texel[0] * tint[0] * s; out[1] = texel[1] * tint[1] * s; out[2] = texel[2] * tint[2] * s;
        if (back) { out[0] *= UNDERSIDE[0]; out[1] *= UNDERSIDE[1]; out[2] *= UNDERSIDE[2]; }
        const rx = (rel[0] * 2 - 1) * 0.8, ry = (rel[1] * 2 - 1) * 0.8;
        let nx = v[2] + T[0] * rx + B[0] * ry, ny = v[3] + T[1] * rx + B[1] * ry, nz = v[4] + T[2] * rx + B[2] * ry;
        const l = Math.hypot(nx, ny, nz) || 1;
        out[3] = nx / l; out[4] = ny / l; out[5] = nz / l; out[6] = v[5]; out[7] = rel[2];
        return true;
      };
    } else {
      if (back) continue;
      shade = (v, out) => {
        bark.sampleLevel(2, v[0] - Math.floor(v[0]), v[1] - Math.floor(v[1]), texel);
        const s = barkShade(v[5]);
        out[0] = texel[0] * s * woodTint[0]; out[1] = texel[1] * s * woodTint[1]; out[2] = texel[2] * s * woodTint[2];
        const l = Math.hypot(v[2], v[3], v[4]) || 1;
        out[3] = v[2] / l; out[4] = v[3] / l; out[5] = v[4] / l; out[6] = v[5]; out[7] = 0;
        return true;
      };
    }
    raster.tri(screen[i0 * 3], screen[i0 * 3 + 1], screen[i0 * 3 + 2], screen[i1 * 3], screen[i1 * 3 + 1], screen[i1 * 3 + 2],
      screen[i2 * 3], screen[i2 * 3 + 1], screen[i2 * 3 + 2], a, b, c, 8, shade);
  }
}

/** The view from bearing `az` (radians round the tree) and elevation `el` above the horizon */
export function viewFrom(az, el, center, half) {
  const toEye = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  const forward = V.scale(toEye, -1);
  // (the eye's right, level with the ground: it stays defined looking straight down, where it keeps turning with az)
  const right = [Math.sin(az), 0, -Math.cos(az)];
  const up = V.norm(V.cross(toEye, right));
  return { right, up, forward, center, half, toEye };
}

/** A sunlit look at what drawTree produced, over a sky: RGB bytes */
export function lit(resolved, sun = V.norm([0.45, 0.75, 0.5]), sky = [150, 180, 215]) {
  const { w, h, out, coverage, c: C } = resolved;
  const bytes = Buffer.alloc(w * h * 3);
  const enc = (x) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, x)), 1 / 2.2));
  for (let i = 0; i < w * h; i++) {
    const o = i * C, k = coverage[i];
    const n = [out[o + 3], out[o + 4], out[o + 5]];
    const leaf = out[o + 7] > 0 || out[o + 6] < 0;
    const ndl = V.dot(n, sun);
    const direct = Math.max(0, ndl * 0.75 + 0.25) * 3.1;
    const ambient = (0.55 + 0.35 * n[1]) * out[o + 6] * 1.1;
    const light = direct * (0.35 + 0.65 * out[o + 6]) + ambient + (leaf ? 0 : 0);
    for (let c = 0; c < 3; c++) bytes[i * 3 + c] = Math.round(enc(out[o + c] * light) * k + sky[c] * (1 - k));
  }
  return bytes;
}
