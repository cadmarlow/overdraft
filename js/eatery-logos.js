import { BRANDS } from './eatery-brands.js';

// The marks of the two franchises, drawn on any 2D canvas: signs, menus, packaging, the map. Original designs.
//
// BULLION: a burger stacked from gold bars, wearing a bull's horns. Seen far away it is a horned head; close up, a burger.
// TRANCHE: a pizza cut like a pie chart, one share pulled out; in the name, the A is a slice.
//
// Every function draws centred on (x, y); `size` is the mark's height in pixels. `tone` picks the inks:
//   'color' (on dark or light), 'ink' (one flat colour, `color`), 'light' (cream on dark).

const B = BRANDS.bullion.colors, T = BRANDS.tranche.colors;
const HEAVY = '"Arial Black", "Helvetica Neue", Impact, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

function goldFill(c, y0, y1) {
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#fbe6a2'); g.addColorStop(0.42, B.gold); g.addColorStop(1, B.goldDeep);
  return g;
}

// A bar seen from its end: a trapezoid, `wide` at y1 and `narrow` at y0, with softened corners
function bar(c, y0, y1, narrow, wide, r) {
  c.beginPath();
  c.moveTo(-narrow + r, y0); c.lineTo(narrow - r, y0); c.quadraticCurveTo(narrow, y0, narrow + r * 0.35, y0 + r);
  c.lineTo(wide - r * 0.2, y1 - r); c.quadraticCurveTo(wide, y1, wide - r, y1);
  c.lineTo(-wide + r, y1); c.quadraticCurveTo(-wide, y1, -wide + r * 0.2, y1 - r);
  c.lineTo(-narrow - r * 0.35, y0 + r); c.quadraticCurveTo(-narrow, y0, -narrow + r, y0);
  c.closePath();
}

/**
 * BULLION's emblem. The drawing lives in a box 2 units wide and 2 high; `size` is that box's height in pixels.
 * @param {'color'|'ink'|'light'} tone
 */
function bullionEmblem(c, x, y, size, { tone = 'color', color = B.black } = {}) {
  const k = size / 2;
  c.save();
  c.translate(x, y + k * 0.14); c.scale(k, k);
  const flat = tone === 'ink' ? color : tone === 'light' ? B.cream : null;
  const gold = flat || goldFill(c, -0.66, 0.66);
  // horns: two crescents rising from the top bar's shoulders
  c.fillStyle = flat || goldFill(c, -1.1, -0.4);
  for (const s of [-1, 1]) {
    c.beginPath();
    c.moveTo(s * 0.36, -0.6);
    c.bezierCurveTo(s * 0.62, -0.6, s * 0.86, -0.72, s * 0.9, -1.1);
    c.bezierCurveTo(s * 1.02, -0.74, s * 0.84, -0.42, s * 0.6, -0.38);
    c.closePath(); c.fill();
  }
  // the top bun: a bar, narrow side up, its upper face catching the light
  c.fillStyle = gold; bar(c, -0.66, -0.08, 0.5, 0.8, 0.07); c.fill();
  if (!flat) {
    c.fillStyle = 'rgba(255,246,208,0.55)'; bar(c, -0.66, -0.55, 0.5, 0.545, 0.05); c.fill();
    c.fillStyle = 'rgba(120,74,10,0.22)'; bar(c, -0.2, -0.08, 0.735, 0.8, 0.05); c.fill();
  }
  // the patty: one dark bar, wider than the buns, and a corner of cheese hanging over it
  c.fillStyle = flat || (tone === 'color' ? B.oxblood : B.black);
  c.beginPath(); c.roundRect(-0.88, -0.02, 1.76, 0.24, 0.11); c.fill();
  c.fillStyle = flat || B.goldPale;
  c.beginPath(); c.moveTo(-0.62, -0.085); c.lineTo(0.7, -0.085); c.lineTo(0.7, -0.03); c.lineTo(0.47, 0.13); c.lineTo(0.22, -0.03); c.lineTo(-0.62, -0.03); c.closePath(); c.fill();
  // the bottom bun: a thinner bar, upside down
  c.fillStyle = gold;
  c.save(); c.scale(1, -1); bar(c, -0.62, -0.28, 0.56, 0.8, 0.06); c.fill(); c.restore();
  if (!flat) { c.fillStyle = 'rgba(120,74,10,0.25)'; c.save(); c.scale(1, -1); bar(c, -0.62, -0.5, 0.56, 0.62, 0.05); c.fill(); c.restore(); }
  c.restore();
}

// BULLION's name: heavy capitals, widely spaced, struck in gold
function bullionWordmark(c, x, y, size, { tone = 'color', color = B.black, align = 'center' } = {}) {
  c.save();
  c.font = `900 ${size}px ${HEAVY}`;
  c.textBaseline = 'middle'; c.textAlign = 'left';
  const squeeze = 0.86, spacing = size * 0.16;
  c.letterSpacing = `${spacing}px`;
  const width = (c.measureText('BULLION').width - spacing) * squeeze;
  const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  c.translate(left, y + size * 0.04); c.scale(squeeze, 1);
  c.fillStyle = tone === 'ink' ? color : tone === 'light' ? B.cream : goldFill(c, -size * 0.42, size * 0.4);
  c.fillText('BULLION', 0, 0);
  c.letterSpacing = '0px';
  c.restore();
  return width;
}

/**
 * TRANCHE's emblem: the pie and its share. Box 2 x 2 units, `size` its height in pixels.
 */
function trancheEmblem(c, x, y, size, { tone = 'color', color = T.charcoal } = {}) {
  const k = size / 2;
  c.save();
  c.translate(x - k * 0.1, y + k * 0.1); c.scale(k, k);
  const flat = tone === 'ink' ? color : tone === 'light' ? T.cream : null;
  const R = 0.8, a0 = -Math.PI * 0.42, a1 = -Math.PI * 0.08, mid = (a0 + a1) / 2;
  // the pie, short of one share: crust, then sauce
  const pie = (r) => { c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, a1, a0 + Math.PI * 2); c.closePath(); };
  if (flat) {
    // one ink: five shares with daylight between them (nothing is erased, the ground shows through)
    c.fillStyle = flat;
    const span = (a0 + Math.PI * 2 - a1) / 5, gap = 0.045;
    for (let i = 0; i < 5; i++) {
      const s = a1 + span * i + gap, e = a1 + span * (i + 1) - gap, m = (s + e) / 2;
      c.beginPath(); c.moveTo(Math.cos(m) * 0.09, Math.sin(m) * 0.09); c.arc(0, 0, R, s, e); c.closePath(); c.fill();
    }
  } else {
    c.fillStyle = T.crust; pie(R); c.fill();
    c.fillStyle = T.tomato; pie(R * 0.86); c.fill();
    // cut like a chart: five more shares
    c.strokeStyle = T.cream; c.lineWidth = 0.035; c.lineCap = 'round';
    for (let i = 1; i <= 4; i++) {
      const a = a1 + (a0 + Math.PI * 2 - a1) * i / 5;
      c.beginPath(); c.moveTo(Math.cos(a) * 0.1, Math.sin(a) * 0.1); c.lineTo(Math.cos(a) * R * 0.84, Math.sin(a) * R * 0.84); c.stroke();
    }
    c.fillStyle = T.tomatoDeep;
    for (const [px, py, pr] of [[-0.42, -0.2, 0.085], [-0.15, 0.42, 0.09], [0.36, 0.3, 0.08], [-0.52, 0.28, 0.07], [0.08, -0.45, 0.07]]) { c.beginPath(); c.arc(px, py, pr, 0, Math.PI * 2); c.fill(); }
  }
  // the share, pulled out along its own axis
  c.translate(Math.cos(mid) * 0.26, Math.sin(mid) * 0.26);
  const share = (r) => { c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, a0 + 0.035, a1 - 0.035); c.closePath(); };
  c.fillStyle = flat || T.crust; share(R); c.fill();
  if (!flat) {
    c.fillStyle = T.cheese; share(R * 0.86); c.fill();
    c.fillStyle = T.tomato;
    for (const [r, a, pr] of [[0.56, mid - 0.2, 0.075], [0.4, mid + 0.22, 0.062]]) { c.beginPath(); c.arc(Math.cos(a) * r, Math.sin(a) * r, pr, 0, Math.PI * 2); c.fill(); }
    // a basil leaf near the point
    c.fillStyle = T.basil; c.save(); c.translate(Math.cos(mid) * 0.24, Math.sin(mid) * 0.24); c.rotate(mid + 0.5);
    c.beginPath(); c.ellipse(0, 0, 0.085, 0.045, 0, 0, Math.PI * 2); c.fill(); c.restore();
  }
  c.restore();
}

// TRANCHE's name: serif capitals, the A a slice of pizza standing on its crust
function trancheWordmark(c, x, y, size, { tone = 'color', color = T.charcoal, align = 'center' } = {}) {
  c.save();
  c.font = `700 ${size}px ${SERIF}`;
  c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  const spacing = size * 0.07, cap = size * 0.7, sliceW = cap * 1.02;
  c.letterSpacing = `${spacing}px`;
  const w1 = c.measureText('TR').width, w2 = c.measureText('NCHE').width - spacing;
  const width = w1 + sliceW + spacing + w2;
  const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  const base = y + cap / 2;
  const ink = tone === 'ink' ? color : tone === 'light' ? T.cream : T.tomato;
  c.fillStyle = ink;
  c.fillText('TR', left, base);
  c.fillText('NCHE', left + w1 + sliceW + spacing, base);
  c.letterSpacing = '0px';
  // the slice: point up, crust at the baseline
  const sx = left + w1 + sliceW / 2 - spacing * 0.2, flat = tone !== 'color';
  c.fillStyle = flat ? ink : T.crust;
  c.beginPath(); c.moveTo(sx, base - cap * 1.22); c.lineTo(sx + sliceW / 2, base - cap * 0.1);
  c.quadraticCurveTo(sx + sliceW / 2, base, sx + sliceW / 2 - cap * 0.1, base); c.lineTo(sx - sliceW / 2 + cap * 0.1, base);
  c.quadraticCurveTo(sx - sliceW / 2, base, sx - sliceW / 2, base - cap * 0.1); c.closePath(); c.fill();
  if (!flat) {
    c.fillStyle = T.cheese;
    c.beginPath(); c.moveTo(sx, base - cap * 1.04); c.lineTo(sx + sliceW * 0.38, base - cap * 0.2); c.lineTo(sx - sliceW * 0.38, base - cap * 0.2); c.closePath(); c.fill();
    c.fillStyle = T.tomato;
    for (const [dx, dy, r] of [[-0.02, 0.56, 0.085], [0.13, 0.33, 0.075], [-0.14, 0.31, 0.07]]) { c.beginPath(); c.arc(sx + dx * cap, base - dy * cap, r * cap, 0, Math.PI * 2); c.fill(); }
  }
  c.restore();
  return width;
}

const EMBLEM = { bullion: bullionEmblem, tranche: trancheEmblem };
const WORDMARK = { bullion: bullionWordmark, tranche: trancheWordmark };
function brandEmblem(c, brand, x, y, size, options) { EMBLEM[brand](c, x, y, size, options); }
function brandWordmark(c, brand, x, y, size, options) { return WORDMARK[brand](c, x, y, size, options); }

// The emblem beside the name, the pair centred on (x, y); `size` is the name's letter height. Returns the pair's width.
function brandLockup(c, brand, x, y, size, options = {}) {
  const mark = size * (brand === 'bullion' ? 1.9 : 2.1), gap = size * 0.5;
  // measure the name first
  c.save(); c.globalAlpha = 0; const name = brandWordmark(c, brand, 0, -1e5, size, { ...options, align: 'left' }); c.restore();
  const width = mark + gap + name, left = x - width / 2;
  brandEmblem(c, brand, left + mark / 2, y, mark, options);
  brandWordmark(c, brand, left + mark + gap, y, size, { ...options, align: 'left' });
  return width;
}

export { bullionEmblem, bullionWordmark, trancheEmblem, trancheWordmark, brandEmblem, brandWordmark, brandLockup };
