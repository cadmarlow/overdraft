// The biplane is doped fabric over wooden ribs and stringers, and its source carries no usable normal map (the one it
// names is not a tangent-space map: lit with it, the wings shade backwards). The importer draws one instead, over the
// same UV set as the colour: the fabric sags a little between the ribs of the wings and tail, and lies in flats
// between the stringers of the rear fuselage. Offline tool only.

/**
 * A tangent-space normal map (RGB bytes, size × size) that is flat but for the panels given, in pixels of a 1024 px map:
 *   rect [x0, y0, x1, y1]   the panel (an island of the colour map, or part of one)
 *   across "u" | "v"        which way the ribs are counted (ribs run the other way)
 *   pitch                   pixels from one rib to the next;  phase: where a rib falls (pixels, default: the panel's middle)
 *   sag                     how much the fabric tilts at most, as a slope (0.1 ≈ 6°)
 *   tape                    the rib-stitching tape: a narrow ridge on each rib, as a slope
 *   edge                    fraction of the panel, at each end of the ribs, where the sag fades out (leading and
 *                           trailing edges are stiff)
 */
function fabricNormals(size, panels) {
  const px = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) { px[i * 3] = 128; px[i * 3 + 1] = 128; px[i * 3 + 2] = 255; }
  const k = size / 1024;
  for (const panel of panels) {
    const [x0, y0, x1, y1] = panel.rect.map((v) => v * k), u = panel.across !== 'v';
    const pitch = panel.pitch * k, sag = panel.sag ?? 0.1, tape = panel.tape ?? 0.05, edge = panel.edge ?? 0.14;
    const from = u ? x0 : y0, to = u ? x1 : y1, phase = panel.phase !== undefined ? panel.phase * k : (from + to) / 2;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const along = u ? (y + 0.5 - y0) / (y1 - y0) : (x + 0.5 - x0) / (x1 - x0), t = (u ? x : y) + 0.5;
      // stiff at the ends of the ribs, and at the ends of the panel itself
      const fade = Math.min(1, along / edge, (1 - along) / edge) * Math.min(1, (t - from) / (pitch * 0.5), (to - t) / (pitch * 0.5));
      if (fade <= 0) continue;
      const cycle = ((t - phase) / pitch) % 1, c = cycle < 0 ? cycle + 1 : cycle; // 0 on a rib
      // the fabric dips between two ribs: the slope is that of a shallow sine
      let slope = -sag * Math.sin(c * Math.PI * 2);
      // the tape: up one side of the rib, down the other
      const d = Math.min(c, 1 - c) * pitch;
      if (d < 1.6) slope += tape * (c < 0.5 ? 1 : -1) * (1 - d / 1.6);
      slope *= fade;
      const n = [u ? -slope : 0, u ? 0 : -slope, 1], l = Math.hypot(n[0], n[1], 1), o = (y * size + x) * 3;
      px[o] = Math.round((n[0] / l * 0.5 + 0.5) * 255); px[o + 1] = Math.round((n[1] / l * 0.5 + 0.5) * 255); px[o + 2] = Math.round((n[2] / l * 0.5 + 0.5) * 255);
    }
  }
  return px;
}

export { fabricNormals };
