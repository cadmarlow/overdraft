// Painting out what an invented aircraft must not wear: national insignia, service lettering, serials, squadron
// badges. Each mark of aircraft.json names a patch of the texture (pixels of a 1024 px map, y down), what in it is to
// go, and what to lay there instead: the clean paint or metal found a little further (a clone stamp: grain, rivets,
// panel lines and weathering come along), or what surrounds it, drawn in (heal: for thin lettering).
// The same stamps are applied to the occlusion-roughness-metal map, at the texels chosen on the colour map, so that no
// ghost of the lettering stays in the reflections. Offline tool only.

// 1 inside the patch, falling to 0 over `feather` pixels at its border; patches are rectangles or polygons
function patch(mark, k) {
  const feather = Math.max(1, (mark.feather ?? 3) * k);
  if (mark.rect) {
    const [x0, y0, x1, y1] = mark.rect.map((v) => v * k), sharp = mark.sharp || '';
    const far = 1e6; // a side named in `sharp` is not feathered: the patch ends there on an island's edge
    const weight = (x, y) => Math.max(0, Math.min(1, (Math.min(sharp.includes('l') ? far : x - x0, sharp.includes('r') ? far : x1 - x,
      sharp.includes('t') ? far : y - y0, sharp.includes('b') ? far : y1 - y) + 0.5) / feather));
    return { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1), y1: Math.ceil(y1), weight };
  }
  const poly = mark.poly.map(([x, y]) => [x * k, y * k]);
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const weight = (x, y) => {
    let inside = false, nearest = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[j];
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      nearest = Math.min(nearest, Math.hypot(x - ax - dx * t, y - ay - dy * t));
    }
    return inside ? Math.min(1, (nearest + 0.5) / feather) : 0;
  };
  return { x0: Math.floor(Math.min(...xs)), y0: Math.floor(Math.min(...ys)), x1: Math.ceil(Math.max(...xs)), y1: Math.ceil(Math.max(...ys)), weight };
}

const near = (px, o, c, tol) => Math.max(Math.abs(px[o] - c[0]), Math.abs(px[o + 1] - c[1]), Math.abs(px[o + 2] - c[2])) <= tol;
const colours = (v) => (Array.isArray(v[0]) ? v : [v]);

/**
 * Applies the marks to an RGB map in place, one after the other (a later mark may copy what an earlier one cleaned).
 *
 * The patch:
 *   rect [x0, y0, x1, y1] or poly [[x, y], ...]   in pixels of a 1024 px map
 *   feather                                        soft border, pixels (3 by default)
 *   sharp "lrtb"                                   sides of a rect that end on an island's edge: not feathered
 * What goes, inside the patch (everything, when none of these is given). Read on the colour map:
 *   dark n                                         texels darker than n on every channel (black lettering)
 *   bright n                                       texels brighter than n on every channel
 *   match [r, g, b] or [[r, g, b], ...], tol       texels within `tol` of these colours (an insignia's blue and red)
 *   keep [r, g, b] or [[r, g, b], ...], tol        or everything but the texels within `tol` of these (the paint)
 *   grow                                           the choice widened by so many pixels: lettering has soft edges (2)
 * What is laid there:
 *   from [dx, dy]                                  the surface found that far from each texel (clone stamp)
 *   heal true, grain n                             or what surrounds the chosen texels, drawn in smoothly, with a
 *                                                  speckle of ±n levels so that it does not read as a clean patch
 *   fill [r, g, b] or { c: [...], orm: [...] }     or a flat value: one colour (colour map only: the other maps take
 *                                                  what surrounds the patch), or one value per map
 *   gain                                           brightness of the cloned texels on the colour map (1)
 * @param {Buffer} px - size × size × 3
 * @param {object[]} marks
 *   maps ["c", "orm"]                              the maps the mark is applied to (these two by default)
 * @param {{guides?: Buffer[], colour?: boolean, slot?: string}} [options] - guides: the colour map as it stood before
 *   each mark, when `px` is another map (what this function returned for the colour map); colour: false for the
 *   other maps; slot: which map `px` is
 * @returns {Buffer[]} the states of the map before each mark
 */
function paintOut(px, size, marks, { guides = null, colour = true, slot = 'c' } = {}) {
  const k = size / 1024, states = [];
  marks.forEach((mark, index) => {
    const source = Buffer.from(px), region = patch(mark, k);
    if (colour) states.push(source);
    if (!(mark.maps || ['c', 'orm']).includes(slot)) return;
    const ref = guides ? guides[index] : source; // what the choice is read on
    const x0 = Math.max(0, region.x0), y0 = Math.max(0, region.y0), x1 = Math.min(size, region.x1), y1 = Math.min(size, region.y1);
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    let mask = new Float32Array(w * h);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[(y - y0) * w + x - x0] = region.weight(x + 0.5, y + 0.5);
    if (mark.keep || mark.match || mark.dark !== undefined || mark.bright !== undefined) {
      const tol = mark.tol ?? 40, grow = mark.grow ?? 2;
      const chosen = new Uint8Array(w * h);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const o = (y * size + x) * 3;
        let take = false;
        if (mark.dark !== undefined && Math.max(ref[o], ref[o + 1], ref[o + 2]) < mark.dark) take = true;
        if (mark.bright !== undefined && Math.min(ref[o], ref[o + 1], ref[o + 2]) > mark.bright) take = true;
        if (mark.match && colours(mark.match).some((c) => near(ref, o, c, tol))) take = true;
        if (mark.keep && colours(mark.keep).every((c) => !near(ref, o, c, tol))) take = true;
        if (take) chosen[(y - y0) * w + x - x0] = 1;
      }
      const soft = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let best = 0;
        for (let dy = -grow - 1; dy <= grow + 1 && best < 1; dy++) for (let dx = -grow - 1; dx <= grow + 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !chosen[yy * w + xx]) continue;
          best = Math.max(best, Math.max(0, Math.min(1, grow + 1 - Math.hypot(dx, dy))));
        }
        soft[y * w + x] = best;
      }
      mask = mask.map((v, i) => v * soft[i]);
    }
    const laid = new Float32Array(w * h * 3);
    if (mark.heal) {
      // the chosen texels take, little by little, the mean of their neighbours: the surroundings flow in
      // (a whole patch is filled from the ring of texels round it; chosen texels, from what was not chosen inside
      // the patch only: what lies beyond it may be another paint)
      const ring = mark.keep || mark.match || mark.dark !== undefined || mark.bright !== undefined ? 0 : 1;
      const X0 = Math.max(0, x0 - ring), Y0 = Math.max(0, y0 - ring), X1 = Math.min(size, x1 + ring), Y1 = Math.min(size, y1 + ring), W = X1 - X0, H = Y1 - Y0;
      const field = new Float32Array(W * H * 3), fixed = new Uint8Array(W * H);
      const mean = [0, 0, 0]; let n = 0;
      for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
        const i = (y - Y0) * W + x - X0, o = (y * size + x) * 3;
        const inside = x >= x0 && x < x1 && y >= y0 && y < y1 && mask[(y - y0) * w + x - x0] > 0.02;
        fixed[i] = inside ? 0 : 1;
        for (let c = 0; c < 3; c++) field[i * 3 + c] = source[o + c];
        if (!inside) { for (let c = 0; c < 3; c++) mean[c] += source[o + c]; n++; }
      }
      for (let i = 0; i < W * H; i++) if (!fixed[i]) for (let c = 0; c < 3; c++) field[i * 3 + c] = mean[c] / Math.max(1, n);
      for (let pass = 0; pass < 400; pass++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (fixed[i]) continue;
        const l = x > 0 ? i - 1 : i, r = x < W - 1 ? i + 1 : i, u = y > 0 ? i - W : i, d = y < H - 1 ? i + W : i;
        for (let c = 0; c < 3; c++) field[i * 3 + c] = (field[l * 3 + c] + field[r * 3 + c] + field[u * 3 + c] + field[d * 3 + c]) / 4;
      }
      // what flows in is smooth: `grain` puts back the speckle of weathered metal (colour map only)
      const grain = colour ? mark.grain ?? 0 : 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453, speck = ((n - Math.floor(n)) - 0.5) * 2 * grain;
        for (let c = 0; c < 3; c++) laid[((y - y0) * w + x - x0) * 3 + c] = field[((y - Y0) * W + x - X0) * 3 + c] + speck;
      }
    } else if (mark.from) {
      const dx = Math.round(mark.from[0] * k), dy = Math.round(mark.from[1] * k), gain = colour ? mark.gain ?? 1 : 1;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const sx = Math.max(0, Math.min(size - 1, x + dx)), sy = Math.max(0, Math.min(size - 1, y + dy)), s = (sy * size + sx) * 3;
        for (let c = 0; c < 3; c++) laid[((y - y0) * w + x - x0) * 3 + c] = source[s + c] * gain;
      }
    } else {
      // a flat value: one colour (colour map only) or one per map ({ c: [...], orm: [...] })
      let flat = !mark.fill ? null : Array.isArray(mark.fill) ? (colour ? mark.fill : null) : mark.fill[slot] ?? null;
      if (!flat) {
        flat = [0, 0, 0]; let n = 0;
        const ring = (x, y) => { if (x < 0 || y < 0 || x >= size || y >= size) return; const o = (y * size + x) * 3; for (let c = 0; c < 3; c++) flat[c] += source[o + c]; n++; };
        for (let x = x0; x < x1; x++) { ring(x, y0 - 3); ring(x, y1 + 2); }
        for (let y = y0; y < y1; y++) { ring(x0 - 3, y); ring(x1 + 2, y); }
        flat = flat.map((v) => v / Math.max(1, n));
      }
      for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) laid[i * 3 + c] = flat[c];
    }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y - y0) * w + x - x0, t = mask[i];
      if (t <= 0) continue;
      const o = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) px[o + c] = Math.max(0, Math.min(255, Math.round(source[o + c] * (1 - t) + laid[i * 3 + c] * t)));
    }
  });
  return states;
}

export { paintOut };
