// BULLION's and TRANCHE's printed and lit matter: fascias, neon tubes, menu boards, posters, screens and labels, painted
// once at load into one sheet per franchise. Original graphics and slogans; the marks come from eatery-logos.js and every
// name and price from eatery-brands.js. `PRINTS[brand][name]` = [u0, v0, u1, v1] on that brand's sheet (v down, as canvas
// rows). The prints listed in `PRINT_ALPHA` sit on a fully transparent ground (neon tubes, stickers on glass); every
// other print fills its rectangle. Each print is painted clipped to its rectangle: nothing bleeds into a neighbour.
// See them all in tools/eatery/prints-preview.html.

import { BRANDS, menuItem } from './eatery-brands.js';
import { brandEmblem, brandWordmark, brandLockup } from './eatery-logos.js';

const SIZE = 2048;
const B = BRANDS.bullion.colors, T = BRANDS.tranche.colors;
const HEAVY = '"Arial Black", "Helvetica Neue", Impact, Arial, sans-serif';
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const SCRIPT = '"Snell Roundhand", "Brush Script MT", "Segoe Script", cursive';
const CHALK = 'Chalkduster, "Marker Felt", "Segoe Print", "Comic Sans MS", cursive';
const HAND = '"Marker Felt", "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive';
const MONO = 'Menlo, Consolas, "Courier New", monospace';

// name -> [x, y, w, h] in pixels. Opaque prints keep 4 px between them, alpha prints 8 px or more around them.
const LAYOUT = {
  bullion: {
    fascia: [0, 0, 2048, 200],
    ticker: [0, 204, 2048, 64],
    menu1: [0, 272, 640, 360], menu2: [644, 272, 640, 360], menu3: [1288, 272, 640, 360],
    receipt: [1932, 272, 116, 360],
    posterBull: [0, 636, 420, 600], posterDividende: [424, 636, 420, 600], posterShake: [848, 636, 420, 600],
    sandwich: [1272, 636, 360, 600],
    wetFloor: [1636, 636, 200, 300],
    cap: [1840, 636, 128, 128],
    trayLiner: [1840, 768, 208, 168],
    apron: [1636, 940, 256, 256],
    kiosk: [0, 1240, 320, 512],
    blade: [324, 1240, 384, 384],
    quarter: [712, 1240, 300, 380],
    chalk: [1016, 1240, 420, 300],
    mat: [1440, 1240, 512, 256],
    banner: [1956, 1240, 88, 512],
    orderHere: [324, 1628, 512, 96],
    hours: [1016, 1544, 420, 160],
    pickup: [1440, 1500, 512, 96],
    barsPattern: [1440, 1600, 512, 128],
    neonRefuge: [8, 1764, 900, 240],
    doorBand: [920, 1764, 512, 64],
    open: [920, 1840, 320, 150],
    bagFront: [1248, 1840, 180, 204],
    staff: [1444, 1756, 256, 96], wc: [1704, 1756, 256, 96],
    exit: [1444, 1856, 256, 96], trash: [1704, 1856, 256, 128]
  },
  tranche: {
    fascia: [0, 0, 2048, 200],
    posterPart: [0, 204, 420, 600], posterCall: [424, 204, 420, 600], posterSubprime: [848, 204, 420, 600],
    sandwich: [1272, 204, 360, 600],
    fridge: [1636, 204, 300, 600],
    banner: [1940, 204, 104, 600],
    menuBoard: [0, 808, 900, 600],
    photos: [904, 808, 900, 300],
    wetFloor: [1808, 808, 200, 300],
    special: [904, 1112, 420, 300], window: [1328, 1112, 420, 300],
    apron: [1752, 1112, 256, 256],
    neonSlice: [8, 1424, 420, 420],
    neonName: [440, 1424, 900, 260],
    blade: [1352, 1416, 384, 384],
    ovenPlate: [1740, 1416, 300, 110],
    tips: [1740, 1530, 160, 160],
    checker: [436, 1692, 256, 256], tiles: [696, 1692, 256, 256], bag: [956, 1692, 256, 256],
    cap: [1216, 1692, 128, 128],
    boxLid: [1740, 1700, 300, 300],
    open: [1360, 1812, 360, 150],
    hours: [0, 1856, 420, 160],
    staff: [436, 1952, 256, 96], exit: [696, 1952, 256, 96], cashOnly: [956, 1952, 256, 96]
  }
};
const ALPHA = { bullion: ['neonRefuge', 'doorBand', 'open'], tranche: ['neonSlice', 'neonName', 'open'] };

const PRINTS = {};
for (const [brand, sheet] of Object.entries(LAYOUT)) {
  PRINTS[brand] = {};
  for (const [name, [x, y, w, h]] of Object.entries(sheet)) PRINTS[brand][name] = [x / SIZE, y / SIZE, (x + w) / SIZE, (y + h) / SIZE];
}

// ---------- words and numbers ----------

const NBSP = '\u00a0';
const money = (n) => `${n}${NBSP}$`;                           // 9 $
const quote = (n) => n.toFixed(2).replace('.', ',');           // 9,00
const clock = (h) => `${h % 24}${NBSP}H`;                      // 26 -> 2 H
const hoursText = (brand) => BRANDS[brand].hours.map(clock).join(' – ');
const dish = (brand, id) => menuItem(brand, id) || { id, name: id.toUpperCase(), note: '', price: 0 };

// ---------- drawing helpers ----------

// Deterministic noise: the sheet is the same at every load
function rng(seed) {
  let a = Math.imul(seed | 0, 2654435761) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function text(c, str, x, y, font, color, align = 'left', spacing = 0) {
  c.font = font; c.fillStyle = color; c.textAlign = align;
  if (!spacing) { c.fillText(str, x, y); return; }
  c.letterSpacing = `${spacing}px`;
  c.fillText(str, x + (align === 'center' ? spacing / 2 : align === 'right' ? spacing : 0), y);
  c.letterSpacing = '0px';
}
function measure(c, str, font, spacing = 0) {
  c.font = font; c.letterSpacing = `${spacing}px`;
  const w = c.measureText(str).width - spacing;
  c.letterSpacing = '0px';
  return w;
}
// the largest size, `size` at most, at which `str` holds in `width`
function fit(c, str, weight, family, size, width, spacing = 0) {
  for (let s = size; s > 8; s -= 1) if (!(measure(c, str, `${weight} ${s}px ${family}`, spacing) > width)) return s;
  return 8;
}
function fitted(c, str, x, y, weight, family, size, width, color, align = 'left', spacing = 0) {
  const s = fit(c, str, weight, family, size, width, spacing);
  text(c, str, x, y, `${weight} ${s}px ${family}`, color, align, spacing);
  return s;
}
function wrap(c, str, font, width) {
  c.font = font;
  const lines = [];
  let line = '';
  for (const word of str.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && c.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
function grain(c, x, y, w, h, n, alpha = 0.05, seed = 1) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    c.fillStyle = r() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 0.7})`;
    c.fillRect(x + r() * w, y + r() * h, 1 + r() * 2, 1);
  }
}
function vignette(c, w, h, strength = 0.5) {
  const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.56);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
}
function glow(c, x, y, r, color, w, h) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  c.fillStyle = g; c.fillRect(0, 0, w, h);
}
function goldGrad(c, y0, y1) {
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#fbe6a2'); g.addColorStop(0.45, B.gold); g.addColorStop(1, B.goldDeep);
  return g;
}
function disc(c, x, y, r, style) { c.fillStyle = style; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
function ring(c, x, y, r, width, style) { c.strokeStyle = style; c.lineWidth = width; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke(); }
function line(c, x0, y0, x1, y1, width, style) { c.strokeStyle = style; c.lineWidth = width; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
function poly(c, points, close = false) {
  c.beginPath();
  points.forEach(([x, y], i) => c[i ? 'lineTo' : 'moveTo'](x, y));
  if (close) c.closePath();
}
function star(c, cx, cy, r1, r2, n, rot = 0) {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + i * Math.PI / n, r = i % 2 ? r2 : r1;
    c[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  c.closePath();
}
function checks(c, x, y, w, h, cell, a, b) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = a; c.fillRect(x, y, w, h);
  c.fillStyle = b;
  for (let j = 0; j * cell < h; j++) for (let i = j % 2; i * cell < w; i += 2) c.fillRect(x + i * cell, y + j * cell, cell, cell);
  c.restore();
}
// A picture frame's moulding around (x, y, w, h): four mitred sides, lit from the top left
function moulding(c, x, y, w, h, t, light, dark) {
  const sides = [
    [[x, y], [x + w, y], [x + w - t, y + t], [x + t, y + t], light],
    [[x, y], [x + t, y + t], [x + t, y + h - t], [x, y + h], light],
    [[x + w, y], [x + w, y + h], [x + w - t, y + h - t], [x + w - t, y + t], dark],
    [[x, y + h], [x + t, y + h - t], [x + w - t, y + h - t], [x + w, y + h], dark]
  ];
  for (const [a, b, d, e, style] of sides) { c.fillStyle = style; poly(c, [a, b, d, e], true); c.fill(); }
  c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1; c.strokeRect(x + t - 0.5, y + t - 0.5, w - 2 * t + 1, h - 2 * t + 1);
  c.strokeStyle = 'rgba(255,255,255,0.18)'; c.strokeRect(x + t * 0.45, y + t * 0.45, w - t * 0.9, h - t * 0.9);
}

// Glass tubes: `draw()` strokes the tube's path (or text) with the current stroke style; a wide soft halo, the coloured
// glass, then its white-hot core. The halo stays under the room's alphaTest (0.3): cut out, a tube keeps its own width
// and the loops of a script stay open; blended, it still glows.
const HALO = 0.27;
function neon(c, draw, color, width = 6, core = '#fff4e2') {
  c.save();
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.shadowColor = color; c.strokeStyle = color;
  c.globalAlpha = HALO; c.shadowBlur = width * 4.2; c.lineWidth = width * 1.7; draw();
  c.globalAlpha = 1; c.shadowBlur = width * 0.9; c.lineWidth = width; draw();
  c.shadowBlur = 0; c.strokeStyle = core; c.lineWidth = Math.max(1.3, width * 0.32); draw();
  c.restore();
}
// Words bent from one tube: a thin face thickened by the glass, its own shape left white-hot inside
function neonText(c, str, x, y, font, color, width = 6, spacing = 0, core = '#fff4e2') {
  c.save();
  c.font = font; c.textAlign = 'center'; c.lineJoin = 'round'; c.lineCap = 'round';
  c.letterSpacing = `${spacing}px`;
  const px = x + spacing / 2;
  c.shadowColor = color; c.strokeStyle = color;
  c.globalAlpha = HALO; c.shadowBlur = width * 4.2; c.lineWidth = width * 1.7; c.strokeText(str, px, y);
  c.globalAlpha = 1; c.shadowBlur = width * 0.9; c.lineWidth = width; c.strokeText(str, px, y);
  c.shadowBlur = 0; c.fillStyle = core; c.fillText(str, px, y);
  c.letterSpacing = '0px';
  c.restore();
}

// Chalk: strokes with a dry edge. `chalkDust` goes over a finished board and bites specks out of every stroke.
function chalkDust(c, w, h, n, board, seed = 1) {
  const r = rng(seed);
  c.fillStyle = board;
  for (let i = 0; i < n; i++) c.fillRect(r() * w, r() * h, 1 + r() * 1.6, 1 + r() * 1.2);
}
function slate(c, w, h, base, seed = 1) {
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  const r = rng(seed);
  for (let i = 0; i < 9; i++) { // what the sponge left behind
    const x = r() * w, y = r() * h, rad = (0.25 + r() * 0.45) * Math.max(w, h);
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(235,235,225,0.055)'); g.addColorStop(1, 'rgba(235,235,225,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }
  c.strokeStyle = 'rgba(240,240,230,0.035)'; c.lineWidth = 14; c.lineCap = 'round';
  for (let i = 0; i < 7; i++) { const y = r() * h; c.beginPath(); c.moveTo(r() * w * 0.4, y); c.quadraticCurveTo(w / 2, y + (r() - 0.5) * 60, w * (0.6 + r() * 0.4), y + (r() - 0.5) * 40); c.stroke(); }
  c.lineCap = 'butt';
}

// An illegible autograph: loops running to the right, then a flourish under them
function scribble(c, x, y, w, h, seed, color, width = 2) {
  const r = rng(seed);
  c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round';
  // a tall first letter, a run of humps that dies away, then the stroke back under the lot
  const cap = h * (1.5 + r() * 0.9);
  c.beginPath(); c.moveTo(x, y);
  c.bezierCurveTo(x + w * 0.02, y - cap, x + w * 0.22, y - cap, x + w * 0.1, y - h * 0.2);
  c.bezierCurveTo(x + w * 0.04, y + h * 0.5, x + w * 0.2, y + h * 0.3, x + w * 0.24, y - h * 0.1);
  let px = x + w * 0.24;
  const n = 3 + Math.floor(r() * 5), step = w * 0.56 / n;
  for (let i = 0; i < n; i++) {
    const up = h * (0.35 + r() * 0.75) * (1 - i / n * 0.6) * (r() < 0.25 ? 1.9 : 1);
    c.bezierCurveTo(px + step * 0.1, y - up, px + step * 0.75, y - up, px + step * 0.6, y);
    c.quadraticCurveTo(px + step * 0.55, y + h * 0.2 * r(), px + step, y - h * 0.05);
    px += step;
  }
  c.bezierCurveTo(px + w * 0.1, y - h * 0.3, px + w * 0.16, y + h * 0.5, x + w * 0.5, y + h * (0.5 + r() * 0.3));
  c.quadraticCurveTo(x + w * 0.2, y + h * 0.62, x + w * 0.06, y + h * 0.42);
  c.stroke();
  c.lineCap = 'butt';
}

// Head and shoulders, filled with the current style
function bust(c, cx, base, h, look = 'plain') {
  const hy = base - h * 0.66;
  c.beginPath();
  c.moveTo(cx - h * 0.47, base);
  c.bezierCurveTo(cx - h * 0.47, base - h * 0.3, cx - h * 0.3, base - h * 0.37, cx - h * 0.1, base - h * 0.41);
  c.lineTo(cx - h * 0.085, base - h * 0.52); c.lineTo(cx + h * 0.085, base - h * 0.52); c.lineTo(cx + h * 0.1, base - h * 0.41);
  c.bezierCurveTo(cx + h * 0.3, base - h * 0.37, cx + h * 0.47, base - h * 0.3, cx + h * 0.47, base);
  c.closePath(); c.fill();
  c.beginPath(); c.ellipse(cx, hy, h * 0.15, h * 0.19, 0, 0, Math.PI * 2); c.fill();
  if (look === 'cap') {
    c.beginPath(); c.ellipse(cx, hy - h * 0.1, h * 0.165, h * 0.12, 0, Math.PI, 0); c.fill();
    c.beginPath(); c.ellipse(cx + h * 0.13, hy - h * 0.1, h * 0.17, h * 0.03, 0.06, 0, Math.PI * 2); c.fill();
  } else if (look === 'fedora') {
    c.beginPath(); c.ellipse(cx, hy - h * 0.11, h * 0.27, h * 0.045, -0.05, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(cx - h * 0.15, hy - h * 0.11); c.quadraticCurveTo(cx - h * 0.15, hy - h * 0.3, cx - h * 0.03, hy - h * 0.27);
    c.quadraticCurveTo(cx + h * 0.02, hy - h * 0.24, cx + h * 0.06, hy - h * 0.28); c.quadraticCurveTo(cx + h * 0.16, hy - h * 0.29, cx + h * 0.15, hy - h * 0.11); c.closePath(); c.fill();
  } else if (look === 'bouffant') {
    c.beginPath(); c.ellipse(cx, hy - h * 0.1, h * 0.22, h * 0.17, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(cx - h * 0.17, hy + h * 0.04, h * 0.07, h * 0.14, 0.2, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(cx + h * 0.17, hy + h * 0.04, h * 0.07, h * 0.14, -0.2, 0, Math.PI * 2); c.fill();
  } else if (look === 'curls') {
    for (const [dx, dy, r] of [[-0.13, -0.1, 0.075], [-0.05, -0.17, 0.08], [0.05, -0.17, 0.08], [0.13, -0.1, 0.075], [-0.16, 0, 0.06], [0.16, 0, 0.06]]) { c.beginPath(); c.arc(cx + dx * h, hy + dy * h, r * h, 0, Math.PI * 2); c.fill(); }
  } else if (look === 'toque') {
    c.beginPath(); c.roundRect(cx - h * 0.13, hy - h * 0.34, h * 0.26, h * 0.22, h * 0.02); c.fill();
    for (const dx of [-0.11, 0, 0.11]) { c.beginPath(); c.arc(cx + dx * h, hy - h * 0.34, h * 0.085, 0, Math.PI * 2); c.fill(); }
  }
}

// Pictograms, drawn with thick round strokes in a box of 2 x 2 units around (cx, cy)
function limbs(c, cx, cy, k, head, parts, width) {
  c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = width * k;
  for (const part of parts) { c.beginPath(); part.forEach(([x, y], i) => c[i ? 'lineTo' : 'moveTo'](cx + x * k, cy + y * k)); c.stroke(); }
  c.beginPath(); c.arc(cx + head[0] * k, cy + head[1] * k, head[2] * k, 0, Math.PI * 2); c.fill();
  c.lineCap = 'butt';
}
// somebody's feet going out from under them
function slipping(c, cx, cy, k) {
  limbs(c, cx, cy, k, [-0.42, -0.5, 0.17], [
    [[-0.28, -0.26], [0.08, 0.2]],                      // the back
    [[0.08, 0.2], [0.46, 0.02], [0.78, -0.3]],          // one leg in the air
    [[0.08, 0.2], [0.44, 0.4], [0.8, 0.44]],            // the other sliding away
    [[-0.26, -0.2], [-0.62, 0], [-0.74, 0.3]],          // an arm reaching for the floor
    [[-0.2, -0.24], [0.1, -0.5], [0.34, -0.72]]         // an arm reaching for the sky
  ], 0.16);
}
function running(c, cx, cy, k) {
  limbs(c, cx, cy, k, [0.2, -0.62, 0.14], [
    [[0.1, -0.4], [-0.08, 0.06]],
    [[0.1, -0.38], [0.4, -0.22], [0.56, -0.42]],
    [[0.08, -0.38], [-0.26, -0.3], [-0.42, -0.06]],
    [[-0.08, 0.06], [0.28, 0.2], [0.3, 0.66]],
    [[-0.08, 0.06], [-0.36, 0.34], [-0.74, 0.3]]
  ], 0.15);
}

// ---------- food: BULLION ----------

function bunTop(c, cx, y, w, h, seed) {
  const half = w / 2;
  const g = c.createLinearGradient(0, y - h, 0, y);
  g.addColorStop(0, '#fbd47c'); g.addColorStop(0.3, '#eba743'); g.addColorStop(0.78, '#c67a27'); g.addColorStop(1, '#8a4e14');
  c.fillStyle = g;
  c.beginPath(); c.moveTo(cx - half, y - h * 0.14);
  c.bezierCurveTo(cx - half * 1.03, y - h * 0.9, cx - half * 0.58, y - h, cx, y - h);
  c.bezierCurveTo(cx + half * 0.58, y - h, cx + half * 1.03, y - h * 0.9, cx + half, y - h * 0.14);
  c.quadraticCurveTo(cx + half, y, cx + half - h * 0.14, y); c.lineTo(cx - half + h * 0.14, y); c.quadraticCurveTo(cx - half, y, cx - half, y - h * 0.14);
  c.closePath(); c.fill();
  c.fillStyle = 'rgba(255,250,220,0.4)';
  c.beginPath(); c.ellipse(cx - half * 0.28, y - h * 0.74, half * 0.44, h * 0.12, -0.1, 0, Math.PI * 2); c.fill();
  const r = rng(seed);
  for (let i = 0; i < 18; i++) {
    const v = 0.26 + r() * 0.62, u = (r() - 0.5) * 1.7 * Math.sqrt(1 - v * v);
    c.save(); c.translate(cx + u * half, y - h * v); c.rotate((r() - 0.5) * 1.8);
    c.fillStyle = 'rgba(120,64,10,0.35)'; c.beginPath(); c.ellipse(w * 0.004, w * 0.006, w * 0.021, w * 0.011, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff3cf'; c.beginPath(); c.ellipse(0, 0, w * 0.021, w * 0.0105, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  }
}
function bunBottom(c, cx, y, w, h) { // y = top
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#f2bd62'); g.addColorStop(0.5, '#d18a35'); g.addColorStop(1, '#8a4e14');
  c.fillStyle = g; c.beginPath(); c.roundRect(cx - w / 2, y, w, h, [h * 0.16, h * 0.16, h * 0.6, h * 0.6]); c.fill();
  c.fillStyle = 'rgba(255,238,190,0.55)'; c.beginPath(); c.roundRect(cx - w * 0.47, y + h * 0.05, w * 0.94, h * 0.16, h * 0.08); c.fill();
}
function patty(c, cx, y, w, h, seed) {
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#7a4326'); g.addColorStop(0.5, '#55290f'); g.addColorStop(1, '#2e1408');
  c.fillStyle = g; c.beginPath(); c.roundRect(cx - w / 2, y, w, h, h * 0.46); c.fill();
  const r = rng(seed);
  for (let i = 0; i < w * 0.7; i++) {
    c.fillStyle = r() < 0.55 ? 'rgba(18,6,0,0.4)' : 'rgba(196,120,70,0.34)';
    c.beginPath(); c.arc(cx + (r() - 0.5) * w * 0.93, y + h * (0.16 + r() * 0.7), h * (0.035 + r() * 0.06), 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = 'rgba(255,200,150,0.2)'; c.beginPath(); c.roundRect(cx - w * 0.45, y + h * 0.1, w * 0.9, h * 0.14, h * 0.07); c.fill();
}
// a slice of cheddar laid over what is below, its corners melting down
function cheddar(c, cx, y, w, h, drips, seed) {
  const r = rng(seed), x0 = cx - w / 2, x1 = cx + w / 2, span = w / drips;
  const g = c.createLinearGradient(0, y, 0, y + h * 5);
  g.addColorStop(0, '#ffd866'); g.addColorStop(1, '#f09a14');
  c.fillStyle = g;
  c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.lineTo(x1, y + h);
  for (let i = 0; i < drips; i++) {
    const mid = x1 - span * (i + 0.3 + r() * 0.4), dw = span * (0.2 + r() * 0.14), dh = h * (2 + r() * 2.6);
    c.lineTo(mid + dw, y + h);
    c.bezierCurveTo(mid + dw * 0.45, y + h * 1.2, mid + dw * 0.3, y + h + dh, mid, y + h + dh);
    c.bezierCurveTo(mid - dw * 0.3, y + h + dh, mid - dw * 0.45, y + h * 1.2, mid - dw, y + h);
  }
  c.lineTo(x0, y + h); c.closePath(); c.fill();
  c.fillStyle = 'rgba(255,248,205,0.6)'; c.fillRect(x0 + 2, y, w - 4, Math.max(1, h * 0.34));
}
function lettuce(c, cx, y, w, h, seed) { // a frill hanging below y
  const r = rng(seed), n = Math.round(w / (h * 1.9)), x0 = cx - w / 2;
  const g = c.createLinearGradient(0, y - h, 0, y + h);
  g.addColorStop(0, '#9ad24f'); g.addColorStop(1, '#3d8a2a');
  c.fillStyle = g;
  c.beginPath(); c.moveTo(x0, y - h * 0.6);
  for (let i = 0; i < n; i++) {
    const a = x0 + w * i / n, b = x0 + w * (i + 1) / n;
    c.quadraticCurveTo((a + b) / 2, y + h * (0.9 + r() * 0.9), b, y - h * 0.2 * r());
  }
  c.lineTo(cx + w / 2, y - h * 0.6); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(220,255,170,0.5)'; c.lineWidth = Math.max(1, h * 0.12);
  c.beginPath(); c.moveTo(x0 + 2, y - h * 0.45); c.lineTo(cx + w / 2 - 2, y - h * 0.45); c.stroke();
}
function bacon(c, cx, y, w, h, seed) {
  const r = rng(seed), phase = r() * 6;
  const wave = (width, style) => {
    c.strokeStyle = style; c.lineWidth = width; c.lineCap = 'round'; c.beginPath();
    for (let i = 0; i <= 28; i++) { const x = cx - w / 2 + w * i / 28; c[i ? 'lineTo' : 'moveTo'](x, y + Math.sin(i * 0.85 + phase) * h * 0.38); }
    c.stroke(); c.lineCap = 'butt';
  };
  wave(h, '#8f2a1c'); wave(h * 0.36, '#e9a184');
}
function friedOnions(c, cx, y, w, h, seed) {
  const r = rng(seed);
  for (let i = 0; i < w * 0.22; i++) {
    const x = cx + (r() - 0.5) * w * 0.9, yy = y + (r() - 0.5) * h;
    c.strokeStyle = r() < 0.5 ? '#f0b24a' : '#c9801f'; c.lineWidth = h * 0.3; c.lineCap = 'round';
    c.beginPath(); c.arc(x, yy, h * (0.3 + r() * 0.3), r() * 6, r() * 6 + 2.4); c.stroke();
  }
  c.lineCap = 'butt';
}
function crispyChicken(c, cx, y, w, h, seed) {
  const r = rng(seed), n = 13;
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#f6bd55'); g.addColorStop(0.55, '#d98a26'); g.addColorStop(1, '#96540f');
  c.fillStyle = g;
  c.beginPath();
  for (let i = 0; i <= n; i++) { const x = cx - w / 2 + w * i / n; c.lineTo(x, y + h * (0.12 + r() * 0.16) - (i % 2) * h * 0.14); }
  c.quadraticCurveTo(cx + w * 0.56, y + h * 0.55, cx + w / 2, y + h * 0.9);
  for (let i = n; i >= 0; i--) { const x = cx - w / 2 + w * i / n; c.lineTo(x, y + h * (0.9 + r() * 0.12) + (i % 2) * h * 0.08); }
  c.quadraticCurveTo(cx - w * 0.56, y + h * 0.55, cx - w / 2, y + h * 0.2);
  c.closePath(); c.fill();
  for (let i = 0; i < w * 0.6; i++) {
    c.fillStyle = r() < 0.5 ? 'rgba(120,60,6,0.4)' : 'rgba(255,226,150,0.5)';
    c.beginPath(); c.arc(cx + (r() - 0.5) * w * 0.92, y + h * (0.22 + r() * 0.62), h * (0.03 + r() * 0.06), 0, Math.PI * 2); c.fill();
  }
}
function coleslaw(c, cx, y, w, h, seed) {
  const r = rng(seed);
  c.fillStyle = '#f1ead2'; c.beginPath(); c.roundRect(cx - w / 2, y, w, h, h * 0.5); c.fill();
  c.lineCap = 'round';
  for (let i = 0; i < w * 0.5; i++) {
    const x = cx + (r() - 0.5) * w * 0.98, yy = y + h * (0.1 + r() * 0.95), a = (r() - 0.5) * 1.6, len = h * (0.5 + r() * 0.7);
    c.strokeStyle = ['#fffaf0', '#dfe9b8', '#f0a44b', '#c9d39a', '#b46fb0'][Math.floor(r() * 5)]; c.lineWidth = Math.max(1, h * 0.14);
    c.beginPath(); c.moveTo(x - Math.cos(a) * len / 2, yy - Math.sin(a) * len / 2); c.lineTo(x + Math.cos(a) * len / 2, yy + Math.sin(a) * len / 2); c.stroke();
  }
  c.lineCap = 'butt';
}
const BURGERS = {
  carat: ['bun', 'patty', 'cheese', 'top'],
  lingot: ['bun', 'salad', 'patty', 'cheese', 'patty', 'cheese', 'sauce', 'top'],
  bull: ['bun', 'patty', 'cheese', 'bacon', 'patty', 'cheese', 'bacon', 'patty', 'cheese', 'onions', 'top'],
  krach: ['bun', 'slaw', 'chicken', 'salad', 'top']
};
/**
 * A burger seen from the side, standing on `base`, `w` wide. Returns the y of its crown.
 * @param {'carat'|'lingot'|'bull'|'krach'} kind
 */
function burger(c, cx, base, w, kind = 'lingot', seed = 1, { horns = false, shadow = true } = {}) {
  if (shadow) { c.fillStyle = 'rgba(0,0,0,0.4)'; c.beginPath(); c.ellipse(cx, base, w * 0.52, w * 0.05, 0, 0, Math.PI * 2); c.fill(); }
  let y = base, n = 0;
  for (const layer of BURGERS[kind]) {
    const s = seed * 31 + ++n;
    if (layer === 'bun') { y -= w * 0.15; bunBottom(c, cx, y, w * 0.93, w * 0.15); }
    else if (layer === 'patty') { y -= w * 0.118; patty(c, cx, y, w * 0.99, w * 0.13, s); }
    else if (layer === 'cheese') { y -= w * 0.026; cheddar(c, cx, y, w * 1.02, w * 0.03, 3, s); }
    else if (layer === 'salad') { y -= w * 0.03; lettuce(c, cx, y + w * 0.035, w * 1.05, w * 0.034, s); }
    else if (layer === 'bacon') { y -= w * 0.034; bacon(c, cx, y + w * 0.02, w * 1.08, w * 0.05, s); }
    else if (layer === 'onions') { y -= w * 0.05; friedOnions(c, cx, y + w * 0.03, w * 0.96, w * 0.07, s); }
    else if (layer === 'sauce') { // the house sauce, escaping
      c.fillStyle = '#d9641c';
      for (const [u, dw, dh] of [[-0.3, 0.05, 0.075], [0.12, 0.04, 0.05], [0.36, 0.045, 0.085]]) { c.beginPath(); c.roundRect(cx + (u - dw / 2) * w, y - w * 0.012, dw * w, dh * w, dw * w / 2); c.fill(); }
      c.beginPath(); c.roundRect(cx - w * 0.47, y - w * 0.02, w * 0.94, w * 0.03, w * 0.015); c.fill();
      c.fillStyle = 'rgba(255,214,150,0.6)'; c.fillRect(cx - w * 0.44, y - w * 0.016, w * 0.88, w * 0.006);
      y -= w * 0.008;
    }
    else if (layer === 'slaw') { y -= w * 0.075; coleslaw(c, cx, y, w * 1.0, w * 0.085, s); }
    else if (layer === 'chicken') { y -= w * 0.17; crispyChicken(c, cx, y, w * 1.06, w * 0.19, s); }
    else if (layer === 'top') {
      if (horns) { // the house's bull, in gold
        c.fillStyle = goldGrad(c, y - w * 0.62, y - w * 0.12);
        for (const side of [-1, 1]) {
          c.beginPath(); c.moveTo(cx + side * w * 0.3, y - w * 0.2);
          c.bezierCurveTo(cx + side * w * 0.46, y - w * 0.2, cx + side * w * 0.6, y - w * 0.3, cx + side * w * 0.6, y - w * 0.62);
          c.bezierCurveTo(cx + side * w * 0.7, y - w * 0.32, cx + side * w * 0.58, y - w * 0.06, cx + side * w * 0.4, y - w * 0.04);
          c.closePath(); c.fill();
        }
      }
      bunTop(c, cx, y + w * 0.012, w * 0.97, w * 0.36, s); y -= w * 0.35;
    }
  }
  return y;
}
// a black carton of fries, the emblem struck on its face
function fries(c, cx, base, w, seed = 1) {
  const r = rng(seed), h = w * 0.82, lip = base - h;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 9; i++) {
    const u = (i + 0.5) / 9 - 0.5 + (r() - 0.5) * 0.04, len = w * (0.52 + r() * 0.36) * (pass ? 0.78 : 1), fw = w * 0.092;
    c.save(); c.translate(cx + u * w * 0.8, lip + w * 0.2); c.rotate(u * 0.62 + (r() - 0.5) * 0.16);
    const g = c.createLinearGradient(-fw / 2, 0, fw / 2, 0);
    g.addColorStop(0, pass ? '#ffe18a' : '#f2bd52'); g.addColorStop(0.6, pass ? '#f5c14e' : '#e2a035'); g.addColorStop(1, '#bd7a1c');
    c.fillStyle = g; c.beginPath(); c.roundRect(-fw / 2, -len, fw, len + w * 0.1, fw * 0.22); c.fill();
    c.fillStyle = 'rgba(255,246,200,0.55)'; c.fillRect(-fw / 2 + 1, -len + 2, fw * 0.22, len);
    c.restore();
  }
  const g = c.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  g.addColorStop(0, '#2a241e'); g.addColorStop(0.5, '#191512'); g.addColorStop(1, '#0c0a08');
  c.fillStyle = g;
  c.beginPath(); c.moveTo(cx - w * 0.5, lip); c.quadraticCurveTo(cx, lip + w * 0.3, cx + w * 0.5, lip);
  c.lineTo(cx + w * 0.36, base - w * 0.03); c.quadraticCurveTo(cx + w * 0.355, base, cx + w * 0.32, base);
  c.lineTo(cx - w * 0.32, base); c.quadraticCurveTo(cx - w * 0.355, base, cx - w * 0.36, base - w * 0.03); c.closePath(); c.fill();
  c.strokeStyle = B.gold; c.lineWidth = Math.max(1.5, w * 0.022);
  c.beginPath(); c.moveTo(cx - w * 0.485, lip + w * 0.03); c.quadraticCurveTo(cx, lip + w * 0.325, cx + w * 0.485, lip + w * 0.03); c.stroke();
  brandEmblem(c, 'bullion', cx, base - h * 0.34, w * 0.36, { tone: 'ink', color: B.gold });
}
// a paper cup: black, a gold band, a lid and a straw
function cup(c, cx, base, h) {
  const top = base - h * 0.8, tw = h * 0.3, bw = h * 0.215;
  c.strokeStyle = B.oxblood; c.lineWidth = h * 0.045; c.lineCap = 'round';
  c.beginPath(); c.moveTo(cx + h * 0.04, top); c.lineTo(cx + h * 0.1, base - h * 1.0); c.stroke(); c.lineCap = 'butt';
  const g = c.createLinearGradient(cx - tw, 0, cx + tw, 0);
  g.addColorStop(0, '#2b251f'); g.addColorStop(0.4, '#1a1613'); g.addColorStop(1, '#0b0908');
  c.fillStyle = g; poly(c, [[cx - tw, top], [cx + tw, top], [cx + bw, base], [cx - bw, base]], true); c.fill();
  c.fillStyle = goldGrad(c, top + h * 0.2, top + h * 0.5);
  const at = (t) => tw + (bw - tw) * t;
  poly(c, [[cx - at(0.3), top + h * 0.24], [cx + at(0.3), top + h * 0.24], [cx + at(0.36), top + h * 0.288], [cx - at(0.36), top + h * 0.288]], true); c.fill();
  brandEmblem(c, 'bullion', cx, top + h * 0.52, h * 0.24, { tone: 'ink', color: B.gold });
  c.fillStyle = '#efe6d2'; c.beginPath(); c.roundRect(cx - tw * 1.08, top - h * 0.05, tw * 2.16, h * 0.07, h * 0.02); c.fill();
  c.fillStyle = '#d9cdb2'; c.beginPath(); c.roundRect(cx - tw * 0.86, top - h * 0.085, tw * 1.72, h * 0.045, h * 0.02); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.14)'; poly(c, [[cx - tw * 0.8, top + 2], [cx - tw * 0.55, top + 2], [cx - bw * 0.5, base - 2], [cx - bw * 0.78, base - 2]], true); c.fill();
}
// LIQUIDITÉS: a vanilla shake in a clear cup, cream on top, a gold straw
function shake(c, cx, base, h, seed = 1) {
  const top = base - h * 0.66, tw = h * 0.25, bw = h * 0.175;
  // straw, behind the cream
  c.save(); c.translate(cx + h * 0.1, top - h * 0.12); c.rotate(0.24);
  c.fillStyle = B.gold; c.fillRect(-h * 0.022, -h * 0.27, h * 0.044, h * 0.5);
  c.fillStyle = '#15120f'; for (let i = 0; i < 5; i++) c.fillRect(-h * 0.022, -h * 0.27 + i * h * 0.055, h * 0.044, h * 0.02);
  c.restore();
  // the shake through the cup
  const g = c.createLinearGradient(cx - tw, 0, cx + tw, 0);
  g.addColorStop(0, '#f1ddb0'); g.addColorStop(0.3, '#fff6dc'); g.addColorStop(0.75, '#f0dcb0'); g.addColorStop(1, '#cdb486');
  c.fillStyle = g; poly(c, [[cx - tw, top], [cx + tw, top], [cx + bw, base - h * 0.02], [cx + bw * 0.9, base], [cx - bw * 0.9, base], [cx - bw, base - h * 0.02]], true); c.fill();
  // black sleeve with the emblem
  const at = (t) => tw + (bw - tw) * t;
  c.fillStyle = '#17130f'; poly(c, [[cx - at(0.3), top + h * 0.2], [cx + at(0.3), top + h * 0.2], [cx + at(0.72), top + h * 0.475], [cx - at(0.72), top + h * 0.475]], true); c.fill();
  brandEmblem(c, 'bullion', cx, top + h * 0.335, h * 0.2, { tone: 'ink', color: B.gold });
  c.fillStyle = 'rgba(255,255,255,0.35)'; poly(c, [[cx - tw * 0.82, top + 3], [cx - tw * 0.62, top + 3], [cx - bw * 0.6, base - 4], [cx - bw * 0.8, base - 4]], true); c.fill();
  // whipped cream: a swirl of four folds and its curl
  const r = rng(seed), ch = h * 0.3;
  for (let i = 0; i < 4; i++) {
    const fw = tw * 2.2 * (1 - i * 0.2), fy = top - ch * i * 0.235, fh = ch * 0.4, lean = (i % 2 ? 1 : -1) * tw * 0.05;
    const lg = c.createLinearGradient(cx - fw / 2, 0, cx + fw / 2, 0);
    lg.addColorStop(0, '#e6d8b8'); lg.addColorStop(0.32, '#ffffff'); lg.addColorStop(0.7, '#f6eeda'); lg.addColorStop(1, '#d6c6a0');
    c.fillStyle = lg; c.beginPath(); c.ellipse(cx + lean, fy - fh * 0.42, fw / 2, fh / 2, lean * 0.012, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(150,120,70,0.32)'; c.lineWidth = Math.max(1, h * 0.012);
    c.beginPath(); c.ellipse(cx + lean, fy - fh * 0.5, fw * 0.47, fh * 0.5, 0, 0.25, Math.PI - 0.25); c.stroke();
  }
  c.fillStyle = '#ffffff';
  c.beginPath(); c.moveTo(cx - tw * 0.32, top - ch * 0.86); c.bezierCurveTo(cx - tw * 0.2, top - ch * 1.12, cx + tw * 0.1, top - ch * 1.05, cx + tw * 0.2, top - ch * 1.3);
  c.bezierCurveTo(cx + tw * 0.26, top - ch * 1.1, cx + tw * 0.36, top - ch * 0.98, cx + tw * 0.34, top - ch * 0.84); c.closePath(); c.fill();
  // gold dust
  for (let i = 0; i < 18; i++) { const v = r(); c.fillStyle = i % 2 ? B.gold : '#c98f1e'; c.fillRect(cx + (r() - 0.5) * tw * 1.7 * (1 - v * 0.7), top - ch * (0.08 + v * 0.95), h * 0.013, h * 0.013); }
  // rim of the clear cup
  c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = Math.max(1, h * 0.012); c.beginPath(); c.moveTo(cx - tw * 1.04, top); c.lineTo(cx + tw * 1.04, top); c.stroke();
}

// ---------- food: TRANCHE ----------

/**
 * A slice of pizza around (x, y): crust up, point down before `rot`. `len` is crust to point.
 * @param {'margherita'|'pepperoni'|'bianca'|'tired'} kind
 */
function slice(c, x, y, len, rot = 0, kind = 'margherita', seed = 1) {
  const r = rng(seed * 131 + 7), hw = len * 0.44, top = -len / 2, tip = len / 2, rim = len * 0.13;
  const tired = kind === 'tired';
  c.save(); c.translate(x, y); c.rotate(rot);
  const outline = () => {
    c.beginPath(); c.moveTo(-hw, top + rim * 0.6);
    c.bezierCurveTo(-hw * 0.6, top - rim * 0.55, hw * 0.6, top - rim * 0.55, hw, top + rim * 0.6);
    if (tired) c.quadraticCurveTo(hw * 0.2, tip * 0.5, hw * 0.24, tip * 0.92); else c.lineTo(0, tip);
    if (tired) c.quadraticCurveTo(-hw * 0.1, tip * 0.6, -hw, top + rim * 0.6);
    c.closePath();
  };
  // the dough and its baked edge
  const cg = c.createLinearGradient(0, top - rim, 0, top + rim * 1.6);
  cg.addColorStop(0, tired ? '#b98f58' : '#f0c27a'); cg.addColorStop(0.55, tired ? '#a17a47' : T.crust); cg.addColorStop(1, tired ? '#7a5a30' : '#b07a36');
  outline(); c.fillStyle = cg; c.fill();
  c.save(); outline(); c.clip();
  // sauce showing under the cheese, then the cheese
  const inner = (inset) => {
    c.beginPath(); c.moveTo(-hw * 1.2, top + rim * 1.25 + inset);
    c.bezierCurveTo(-hw * 0.6, top + rim * 0.2 + inset, hw * 0.6, top + rim * 0.2 + inset, hw * 1.2, top + rim * 1.25 + inset);
    c.lineTo(hw * 1.2, tip + len); c.lineTo(-hw * 1.2, tip + len); c.closePath();
  };
  inner(0); c.fillStyle = tired ? '#8a3a26' : T.tomato; c.fill();
  inner(len * 0.028);
  const chg = c.createLinearGradient(0, top, 0, tip);
  if (kind === 'bianca') { chg.addColorStop(0, '#fff3cf'); chg.addColorStop(1, '#f3d992'); }
  else if (tired) { chg.addColorStop(0, '#d7b45c'); chg.addColorStop(1, '#b98d3c'); }
  else { chg.addColorStop(0, '#ffd866'); chg.addColorStop(1, '#f0a630'); }
  c.fillStyle = chg; c.fill();
  c.save(); c.clip();
  // browned blisters and pools of oil
  for (let i = 0; i < 26; i++) {
    const v = r(), u = (r() - 0.5) * 1.7 * (1 - v);
    c.fillStyle = r() < 0.5 ? 'rgba(214,120,30,0.35)' : 'rgba(255,246,200,0.5)';
    c.beginPath(); c.ellipse(u * hw, top + rim * 1.5 + v * (len - rim * 1.6), len * (0.02 + r() * 0.045), len * (0.014 + r() * 0.03), r() * 3, 0, Math.PI * 2); c.fill();
  }
  const spot = (v, u) => [u * hw * (1 - v) * 1.55, top + rim * 1.7 + v * (len - rim * 2.2)];
  if (kind === 'margherita' || tired) {
    for (const [v, u, s] of [[0.1, -0.34, 1], [0.16, 0.3, 0.9], [0.42, -0.1, 1.05], [0.62, 0.2, 0.8]]) {
      const [px, py] = spot(v, u);
      c.fillStyle = tired ? '#d9cfae' : '#fffaf0'; c.beginPath(); c.ellipse(px, py, len * 0.085 * s, len * 0.07 * s, r() * 3, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.ellipse(px - len * 0.02, py - len * 0.02, len * 0.035 * s, len * 0.022 * s, 0, 0, Math.PI * 2); c.fill();
    }
    for (const [v, u, a] of [[0.27, 0.12, 0.5], [0.05, -0.02, -0.7], [0.52, -0.42, 1.1]]) {
      const [px, py] = spot(v, u);
      c.save(); c.translate(px, py); c.rotate(a);
      c.fillStyle = tired ? '#5a6b3a' : T.basil; c.beginPath(); c.moveTo(-len * 0.085, 0); c.quadraticCurveTo(0, -len * 0.06, len * 0.085, 0); c.quadraticCurveTo(0, len * 0.06, -len * 0.085, 0); c.fill();
      c.strokeStyle = 'rgba(200,240,190,0.55)'; c.lineWidth = Math.max(1, len * 0.008); c.beginPath(); c.moveTo(-len * 0.07, 0); c.lineTo(len * 0.07, 0); c.stroke();
      c.restore();
    }
  } else if (kind === 'pepperoni') {
    for (const [v, u, s] of [[0.06, -0.38, 1], [0.08, 0.36, 1], [0.24, 0, 1.05], [0.42, -0.4, 0.95], [0.44, 0.42, 0.9], [0.66, 0, 0.85]]) {
      const [px, py] = spot(v, u), pr = len * 0.078 * s;
      disc(c, px, py, pr, '#a3261a'); disc(c, px, py, pr * 0.8, '#c4392a');
      c.fillStyle = 'rgba(255,190,150,0.5)'; c.beginPath(); c.ellipse(px - pr * 0.25, py - pr * 0.3, pr * 0.4, pr * 0.22, -0.5, 0, Math.PI * 2); c.fill();
      for (let k = 0; k < 4; k++) disc(c, px + (r() - 0.5) * pr, py + (r() - 0.5) * pr, pr * 0.09, 'rgba(90,12,6,0.6)');
    }
    for (let i = 0; i < 7; i++) { const [px, py] = spot(r() * 0.7, (r() - 0.5) * 0.9); disc(c, px, py, len * 0.028, '#6d4a2c'); disc(c, px - 1, py - 1, len * 0.014, '#8d6a44'); }
  } else if (kind === 'bianca') {
    for (const [v, u, s] of [[0.08, -0.32, 1], [0.12, 0.34, 0.9], [0.34, 0.02, 1.1], [0.56, -0.3, 0.8], [0.6, 0.34, 0.75]]) {
      const [px, py] = spot(v, u);
      c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(px, py, len * 0.08 * s, len * 0.068 * s, r() * 3, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(226,205,150,0.6)'; c.beginPath(); c.ellipse(px + len * 0.015, py + len * 0.02, len * 0.045 * s, len * 0.03 * s, 0, 0, Math.PI * 2); c.fill();
    }
    for (let i = 0; i < 30; i++) { const [px, py] = spot(r() * 0.8, (r() - 0.5) * 0.95); c.fillStyle = r() < 0.6 ? T.basil : '#3b3024'; c.fillRect(px, py, len * 0.014, len * 0.008); }
  }
  c.restore(); c.restore();
  // the crust's own light and a few scorched bubbles
  c.strokeStyle = 'rgba(255,240,200,0.5)'; c.lineWidth = Math.max(1, rim * 0.16); c.lineCap = 'round';
  c.beginPath(); c.moveTo(-hw * 0.82, top + rim * 0.22); c.bezierCurveTo(-hw * 0.45, top - rim * 0.3, hw * 0.3, top - rim * 0.32, hw * 0.6, top + rim * 0.02); c.stroke(); c.lineCap = 'butt';
  for (let i = 0; i < 6; i++) { const u = (r() - 0.5) * 1.5; disc(c, u * hw, top + rim * (0.35 + r() * 0.35) + Math.abs(u) * rim * 0.5, rim * (0.07 + r() * 0.1), 'rgba(90,50,14,0.5)'); }
  c.restore();
}
// A whole pie seen from above, cut in `cuts`; `out` pulls share 0 away from the centre
function pie(c, cx, cy, r, { cuts = 6, out = 0, kind = 'margherita', seed = 1, start = -Math.PI / 2 } = {}) {
  const rand = rng(seed * 77 + 3), step = Math.PI * 2 / cuts;
  for (let i = 0; i < cuts; i++) {
    const a0 = start + i * step, a1 = a0 + step, mid = (a0 + a1) / 2, pull = i === 0 ? out : 0;
    const ox = cx + Math.cos(mid) * pull, oy = cy + Math.sin(mid) * pull, gap = i === 0 && out ? 0 : 0.012;
    const wedge = (rad) => { c.beginPath(); c.moveTo(ox, oy); c.arc(ox, oy, rad, a0 + gap, a1 - gap); c.closePath(); };
    wedge(r); c.fillStyle = T.crust; c.fill();
    wedge(r * 0.9); c.fillStyle = T.tomato; c.fill();
    wedge(r * 0.86);
    const g = c.createRadialGradient(ox, oy, r * 0.1, ox, oy, r * 0.86);
    g.addColorStop(0, '#ffd866'); g.addColorStop(1, '#f2ae36');
    c.fillStyle = g; c.fill();
    c.save(); c.clip();
    for (let k = 0; k < 9; k++) {
      const a = a0 + rand() * step, d = r * (0.18 + rand() * 0.6);
      c.fillStyle = rand() < 0.5 ? 'rgba(214,120,30,0.35)' : 'rgba(255,246,200,0.5)';
      c.beginPath(); c.ellipse(ox + Math.cos(a) * d, oy + Math.sin(a) * d, r * (0.03 + rand() * 0.04), r * (0.02 + rand() * 0.03), rand() * 3, 0, Math.PI * 2); c.fill();
    }
    const places = [[0.3, 0.5], [0.72, 0.36], [0.6, 0.72], [0.28, 0.76]];
    for (const [t, d] of places) {
      const a = a0 + step * t, px = ox + Math.cos(a) * r * d, py = oy + Math.sin(a) * r * d;
      if (kind === 'pepperoni') { disc(c, px, py, r * 0.085, '#a3261a'); disc(c, px, py, r * 0.066, '#c4392a'); }
      else if ((t * 10 | 0) % 2) { c.fillStyle = '#fffaf0'; c.beginPath(); c.ellipse(px, py, r * 0.085, r * 0.07, a, 0, Math.PI * 2); c.fill(); }
      else { c.save(); c.translate(px, py); c.rotate(a + 0.6); c.fillStyle = T.basil; c.beginPath(); c.moveTo(-r * 0.08, 0); c.quadraticCurveTo(0, -r * 0.055, r * 0.08, 0); c.quadraticCurveTo(0, r * 0.055, -r * 0.08, 0); c.fill(); c.restore(); }
    }
    c.restore();
  }
}
// an invented soda can, front on
function can(c, cx, base, w, h, body, band, mark) {
  const g = c.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.25, 'rgba(255,255,255,0.3)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
  c.fillStyle = '#c9ced2'; c.beginPath(); c.roundRect(cx - w * 0.44, base - h, w * 0.88, h, w * 0.14); c.fill();
  c.fillStyle = body; c.beginPath(); c.roundRect(cx - w / 2, base - h * 0.92, w, h * 0.86, w * 0.06); c.fill();
  c.fillStyle = band; c.fillRect(cx - w / 2, base - h * 0.62, w, h * 0.26);
  fitted(c, mark, cx, base - h * 0.435, 900, HEAVY, Math.round(h * 0.17), w * 0.82, body, 'center');
  c.fillStyle = g; c.beginPath(); c.roundRect(cx - w / 2, base - h, w, h, w * 0.1); c.fill();
}
function bottle(c, cx, base, w, h, liquid, label, capColor) {
  c.fillStyle = liquid;
  c.beginPath(); c.moveTo(cx - w / 2, base); c.lineTo(cx - w / 2, base - h * 0.58);
  c.bezierCurveTo(cx - w / 2, base - h * 0.74, cx - w * 0.16, base - h * 0.74, cx - w * 0.16, base - h * 0.9);
  c.lineTo(cx + w * 0.16, base - h * 0.9);
  c.bezierCurveTo(cx + w * 0.16, base - h * 0.74, cx + w / 2, base - h * 0.74, cx + w / 2, base - h * 0.58);
  c.lineTo(cx + w / 2, base); c.closePath(); c.fill();
  c.fillStyle = label; c.fillRect(cx - w / 2, base - h * 0.5, w, h * 0.26);
  c.fillStyle = capColor; c.fillRect(cx - w * 0.2, base - h, w * 0.4, h * 0.1);
  const g = c.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(0.28, 'rgba(255,255,255,0.4)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.4)');
  c.fillStyle = g; c.fillRect(cx - w / 2, base - h, w, h);
}

// ---------- shared furniture ----------

// Black felt in grooves, for plastic letters
function felt(c, x, y, w, h, pitch = 10) {
  c.fillStyle = '#131313'; c.fillRect(x, y, w, h);
  for (let gy = y + pitch / 2; gy < y + h; gy += pitch) {
    c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillRect(x, gy, w, 2);
    c.fillStyle = 'rgba(255,255,255,0.045)'; c.fillRect(x, gy + 2, w, 1);
  }
}
// White plastic letters pressed into the felt one by one: never quite level. `tilt` = { index, angle, drop } hangs one.
function letters(c, str, x, y, size, { align = 'left', seed = 1, tilt = null, color = '#f3f0e6', weight = 700, family = SANS, spacing = size * 0.09 } = {}) {
  const r = rng(seed), chars = [...str];
  c.font = `${weight} ${size}px ${family}`;
  const widths = chars.map((ch) => c.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let px = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  c.save();
  c.textAlign = 'center'; c.fillStyle = color;
  c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 1.5; c.shadowOffsetX = size * 0.035; c.shadowOffsetY = size * 0.06;
  chars.forEach((ch, i) => {
    const dy = (r() - 0.5) * size * 0.07, da = (r() - 0.5) * 0.06;
    if (ch !== ' ') {
      const hung = tilt && tilt.index === i;
      c.save(); c.translate(px + widths[i] / 2, y + dy + (hung ? tilt.drop : 0)); c.rotate(hung ? tilt.angle : da);
      c.fillText(ch, 0, 0);
      c.restore();
    }
    px += widths[i] + spacing;
  });
  c.restore();
  return total;
}
// Small spaced capitals either side of a fascia's lockup, each between two lozenges and whatever rule fits
function fasciaWords(c, w, cy, lock, labels, ink, rule, most = 30, spacing = 11) {
  const edge = 60, inner = w / 2 - lock / 2 - 64, room = inner - edge;
  const size = Math.min(...labels.map((label) => fit(c, label, 800, SANS, most, room - 84, spacing))), font = `800 ${size}px ${SANS}`;
  labels.forEach((label, i) => {
    const tw = measure(c, label, font, spacing), mid = i ? w - (edge + inner) / 2 : (edge + inner) / 2;
    text(c, label, mid, cy + size * 0.36, font, ink, 'center', spacing);
    c.fillStyle = rule;
    for (const dir of [-1, 1]) {
      const end = mid + dir * room / 2, tip = end - dir * 16, from = mid + dir * (tw / 2 + 24);
      poly(c, [[end, cy], [end - dir * 8, cy - 7], [tip, cy], [end - dir * 8, cy + 7]], true); c.fill();
      if ((tip - from) * dir > 10) c.fillRect(Math.min(from, tip), cy - 1, Math.abs(tip - from), 2);
    }
  });
}
// A small plate fixed to a door or a wall
function plate(c, w, h, ground, border, inset = 5) {
  c.fillStyle = ground; c.fillRect(0, 0, w, h);
  c.strokeStyle = border; c.lineWidth = 2; c.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
}
// The floor stand that says the floor is wet: yellow plastic, a black triangle, the fall
function wetFloorSign(c, w, h, small, brandLine) {
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#e2b20c'); g.addColorStop(0.5, '#f8d023'); g.addColorStop(1, '#dfae0a');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = '#15120f'; c.fillRect(0, 0, w, 44);
  text(c, 'ATTENTION', w / 2, 31, `900 23px ${HEAVY}`, '#f8d023', 'center', 3);
  // the warning triangle
  const cx = w / 2, ty = 62, th = 124, tw = 146;
  c.lineJoin = 'round'; c.strokeStyle = '#15120f'; c.lineWidth = 11;
  poly(c, [[cx, ty], [cx + tw / 2, ty + th], [cx - tw / 2, ty + th]], true); c.stroke();
  c.fillStyle = '#15120f'; c.strokeStyle = '#15120f';
  slipping(c, cx + 2, ty + th * 0.6, 40);
  line(c, cx - 36, ty + th * 0.6 + 27, cx + 38, ty + th * 0.6 + 27, 3, '#15120f');
  text(c, 'SOL', w / 2, 226, `900 30px ${HEAVY}`, '#15120f', 'center', 2);
  text(c, 'GLISSANT', w / 2, 256, `900 30px ${HEAVY}`, '#15120f', 'center', 0);
  c.fillStyle = '#15120f'; c.fillRect(14, 266, w - 28, 2);
  text(c, small, w / 2, 281, `700 10.5px ${SANS}`, '#15120f', 'center', 0.5);
  text(c, brandLine, w / 2, 293, `700 8px ${SANS}`, 'rgba(21,18,15,0.7)', 'center', 2);
  grain(c, 0, 0, w, h, 500, 0.05, 41);
  // scuffs from the mop bucket
  c.strokeStyle = 'rgba(60,40,0,0.18)'; c.lineWidth = 2; const r = rng(5);
  for (let i = 0; i < 7; i++) { const y = 220 + r() * 70, x = r() * w; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 20 + r() * 40, y + (r() - 0.5) * 8); c.stroke(); }
}
// The green sign over the way out
function exitSign(c, w, h) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2fa868'); g.addColorStop(1, '#17754a');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 3; c.strokeRect(6, 6, w - 12, h - 12);
  c.fillStyle = '#ffffff'; c.strokeStyle = '#ffffff';
  running(c, 50, h / 2 + 2, 31);
  fitted(c, 'SORTIE', 88, h / 2 + 14, 900, HEAVY, 38, w - 108, '#ffffff', 'left', 2);
}

// ---------- the LED ticker's dot-matrix face: capitals 5 dots wide and 7 high, accents in the two rows above ----------

const DOTS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  Œ: ['.#######', '#..#....', '#..#....', '#..####.', '#..#....', '#..#....', '.#######'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['..', '..', '..', '..', '..', '..', '..'],
  ',': ['..', '..', '..', '..', '..', '.#', '#.'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  '%': ['##..#', '##.#.', '...#.', '..#..', '.#...', '.#.##', '#..##'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '−': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '-': ['....', '....', '....', '####', '....', '....', '....'],
  '·': ['.', '.', '.', '#', '.', '.', '.'],
  '$': ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '▲': ['.......', '...#...', '..###..', '..###..', '.#####.', '#######', '.......'],
  '▼': ['.......', '#######', '.#####.', '..###..', '..###..', '...#...', '.......'],
  '◆': ['.....', '..#..', '.###.', '#####', '.###.', '..#..', '.....']
};
const LED_COLS = 416, LED_ROWS = 13, LED_TOP = 3;   // 2048 / 416 = 64 / 13: round dots on a square grid
// accents: [row above the capital (1 or 2), column offset from the middle]
const ACCENTS = { '́': [[2, 0], [1, 1]], '̀': [[2, 0], [1, -1]], '̂': [[1, 0], [2, -1], [2, 1]], '̈': [[1, -1], [1, 1]] };
// a string as columns of lit rows (one bit per row), a blank column after each character
function ledColumns(str) {
  const cols = [];
  for (const ch of str) {
    const [base, mark] = DOTS[ch] ? [ch] : [...ch.normalize('NFD')];
    const glyph = DOTS[base] || DOTS['·'], width = glyph[0].length, first = cols.length;
    for (let x = 0; x < width; x++) {
      let bits = 0;
      for (let row = 0; row < 7; row++) if (glyph[row][x] === '#') bits |= 1 << (row + LED_TOP);
      cols.push(bits);
    }
    for (const [row, dx] of ACCENTS[mark] || []) cols[first + (width >> 1) + dx] |= 1 << row;
    cols.push(0);
  }
  cols.pop();
  return cols;
}
// The band's message: the menu quoted like stocks, spread so that it loops without a seam
function tickerColumns() {
  const short = (id) => dish('bullion', id).name.replace(/^(LE|LA|LES|MENU)\s+/, '');
  const stock = (id, arrow, move) => `${short(id)} ${quote(dish('bullion', id).price)} ${arrow}${move ? ` ${move}` : ''}`;
  const parts = [stock('lingot', '▲', '+0,4 %'), stock('krach', '▼', '−1,2 %'), 'BŒUF ▲', 'CHEDDAR ◆', stock('pepites', '▲')].map(ledColumns);
  while (parts.length > 1 && parts.reduce((n, p) => n + p.length, 0) + parts.length * 4 > LED_COLS) parts.pop();
  const free = LED_COLS - parts.reduce((n, p) => n + p.length, 0);
  const cols = new Array(LED_COLS).fill(0);
  let x = Math.floor(free / parts.length / 2);
  parts.forEach((part, i) => {
    part.forEach((bits, k) => { if (x + k < LED_COLS) cols[x + k] = bits; });
    x += part.length + Math.floor(free * (i + 1) / parts.length) - Math.floor(free * i / parts.length);
  });
  return cols;
}

// ---------- BULLION ----------

function lacquer(c, w, h) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2a231c'); g.addColorStop(0.16, '#1a1612'); g.addColorStop(0.7, '#110e0b'); g.addColorStop(1, '#090706');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // the sheen of the lacquer: two slanted bands of soft light
  for (const [at, wide, a] of [[0.3, 0.16, 0.07], [0.72, 0.07, 0.045]]) {
    const s = c.createLinearGradient(w * (at - wide) , 0, w * (at + wide) + h * 0.6, h);
    s.addColorStop(0, 'rgba(255,236,200,0)'); s.addColorStop(0.5, `rgba(255,236,200,${a})`); s.addColorStop(1, 'rgba(255,236,200,0)');
    c.fillStyle = s; c.fillRect(0, 0, w, h);
  }
}
function boardField(c, w, h, gx, gy, gr, strength = 0.22) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#16120e'); g.addColorStop(1, '#0a0807');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  glow(c, gx, gy, gr, `rgba(232,178,58,${strength})`, w, h);
  c.strokeStyle = 'rgba(232,178,58,0.5)'; c.lineWidth = 2; c.strokeRect(9, 9, w - 18, h - 18);
}
function boardHeader(c, w, label) {
  text(c, label, 28, 53, `900 31px ${HEAVY}`, goldGrad(c, 28, 56), 'left', 7);
  c.fillStyle = B.goldDeep; c.fillRect(28, 66, w - 56, 2);
  brandEmblem(c, 'bullion', w - 52, 36, 42);
}
function menuRow(c, it, x, y, width, nameSize = 34, priceSize = 42) {
  fitted(c, it.name, x, y, 900, HEAVY, nameSize, width - priceSize * 2.4, B.cream);
  text(c, money(it.price), x + width, y, `900 ${priceSize}px ${HEAVY}`, goldGrad(c, y - priceSize * 0.76, y), 'right');
  wrap(c, it.note, `500 15px ${SANS}`, width - 6).slice(0, 2).forEach((l, i) => text(c, l, x + 1, y + 21 + i * 17, `500 15px ${SANS}`, '#b3a78d'));
}
// a price as on the boards: tall figures, a small raised dollar
function bigPrice(c, n, right, y, size, style) {
  const dollar = measure(c, '$', `900 ${Math.round(size * 0.46)}px ${HEAVY}`);
  text(c, String(n), right - dollar - size * 0.06, y, `900 ${size}px ${HEAVY}`, style, 'right');
  text(c, '$', right, y - size * 0.36, `900 ${Math.round(size * 0.46)}px ${HEAVY}`, style, 'right');
}
function tray(c, cx, cy, rx, ry) {
  c.fillStyle = 'rgba(0,0,0,0.45)'; c.beginPath(); c.ellipse(cx, cy + ry * 0.5, rx * 1.02, ry, 0, 0, Math.PI * 2); c.fill();
  const g = c.createLinearGradient(0, cy - ry, 0, cy + ry);
  g.addColorStop(0, '#9c2a22'); g.addColorStop(1, '#5a130f');
  c.fillStyle = g; c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(255,170,150,0.35)'; c.lineWidth = 2; c.beginPath(); c.ellipse(cx, cy - 1, rx * 0.97, ry * 0.86, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
}
// a price chalked by hand: the figure, then its dollar, closer than a typesetter would dare
function chalkPrice(c, n, cx, y, size, color) {
  const font = `400 ${size}px ${CHALK}`, a = measure(c, String(n), font), b = measure(c, '$', font), gap = size * 0.16;
  text(c, String(n), cx - (a + gap + b) / 2, y, font, color);
  text(c, '$', cx - (a + gap + b) / 2 + a + gap, y, font, color);
}
// a hand-drawn quote: where the price has been, in chalk or light
function quoteLine(c, x, y, w, h, points, style, width) {
  c.strokeStyle = style; c.lineWidth = width; c.lineJoin = 'round'; c.lineCap = 'round';
  c.beginPath(); points.forEach(([u, v], i) => c[i ? 'lineTo' : 'moveTo'](x + u * w, y + (1 - v) * h)); c.stroke();
  c.lineCap = 'butt';
}

const bullion = {
  // The sign band over the street: black lacquer, the lockup, small capitals between gold rules
  fascia(c, w, h) {
    lacquer(c, w, h);
    c.fillStyle = goldGrad(c, 12, 17); c.fillRect(24, 12, w - 48, 4);
    c.fillStyle = goldGrad(c, h - 17, h - 12); c.fillRect(24, h - 16, w - 48, 4);
    c.fillStyle = 'rgba(232,178,58,0.5)'; c.fillRect(24, 22, w - 48, 1); c.fillRect(24, h - 23, w - 48, 1);
    const lock = brandLockup(c, 'bullion', w / 2, h / 2 + 4, 90);
    const [what, year] = BRANDS.bullion.since.toUpperCase().split(' DEPUIS ');
    fasciaWords(c, w, h / 2 + 4, lock, [what, `DEPUIS ${year || '1971'}`], B.goldPale, B.gold);
    grain(c, 0, 0, w, h, 2600, 0.035, 11);
  },
  // The round sign hung out over the pavement
  blade(c, w, h) {
    const cx = w / 2, cy = h / 2, r = w / 2;
    c.fillStyle = '#0b0908'; c.fillRect(0, 0, w, h);
    const g = c.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#2a231c'); g.addColorStop(0.6, '#15120f'); g.addColorStop(1, '#0c0a08');
    disc(c, cx, cy, r, g);
    ring(c, cx, cy, r - 9, 14, goldGrad(c, 0, h));
    ring(c, cx, cy, r - 27, 2.5, B.goldDeep);
    brandEmblem(c, 'bullion', cx, cy + 2, 232);
  },
  // « la valeur refuge. » in warm gold tubes
  neonRefuge(c, w, h) {
    const words = BRANDS.bullion.tagline.toLowerCase();
    const size = fit(c, words, 400, SCRIPT, 170, w - 120);
    neonText(c, words, w / 2, h * 0.6, `400 ${size}px ${SCRIPT}`, '#ffb93c', 6.6, 0, '#fff8e2');
    // a flourish under the words
    neon(c, () => { c.beginPath(); c.moveTo(w * 0.2, h * 0.84); c.bezierCurveTo(w * 0.4, h * 0.9, w * 0.62, h * 0.76, w * 0.8, h * 0.83); c.stroke(); }, '#ff8a3c', 5, '#ffe9d6');
  },
  open(c, w, h) {
    neon(c, () => { c.beginPath(); c.roundRect(34, 34, w - 68, h - 68, 24); c.stroke(); }, '#ff5a36', 5.4, '#ffe6dc');
    neonText(c, 'OUVERT', w / 2, h / 2 + 17, `200 ${fit(c, 'OUVERT', 200, SANS, 52, w - 132, 8)}px ${SANS}`, '#ffb93c', 5.4, 8, '#fff8e2');
  },
  // Backlit boards over the counter
  menu1(c, w, h) {
    boardField(c, w, h, 150, 210, 240);
    boardHeader(c, w, 'LES BURGERS');
    burger(c, 150, 326, 216, 'lingot', 4);
    ['bullmarket', 'lingot', 'krach', 'carat'].forEach((id, i) => {
      const y = 119 + i * 64;
      if (i) { c.fillStyle = 'rgba(232,178,58,0.28)'; for (let x = 294; x < 614; x += 8) c.fillRect(x, y - 41, 3, 2); }
      menuRow(c, dish('bullion', id), 294, y, 320, 33, 40);
    });
  },
  menu2(c, w, h) {
    const deal = dish('bullion', 'dividende'), [first, ...rest] = deal.name.split(' ');
    boardField(c, w, h, 196, 190, 300, 0.3);
    tray(c, 200, 318, 178, 23);
    cup(c, 322, 314, 172);
    burger(c, 138, 318, 184, 'lingot', 9, { shadow: false });
    fries(c, 250, 327, 92, 5);
    text(c, first, 392, 62, `800 26px ${SANS}`, B.goldPale, 'left', 13);
    fitted(c, rest.join(' ') || first, 390, 112, 900, HEAVY, 52, 226, B.cream);
    c.save(); c.shadowColor = 'rgba(232,178,58,0.55)'; c.shadowBlur = 26;
    bigPrice(c, deal.price, 616, 250, 134, goldGrad(c, 150, 250));
    c.restore();
    c.fillStyle = B.oxblood; c.beginPath(); c.roundRect(390, 272, 226, 30, 4); c.fill();
    fitted(c, 'VERSÉ À CHAQUE VISITE', 503, 293, 800, SANS, 16, 206, B.cream, 'center', 2);
    wrap(c, deal.note, `500 15px ${SANS}`, 226).slice(0, 2).forEach((l, i) => text(c, l, 392, 324 + i * 17, `500 15px ${SANS}`, '#b3a78d'));
  },
  menu3(c, w, h) {
    const pep = dish('bullion', 'pepites'), liq = dish('bullion', 'liquidites'), ref = dish('bullion', 'lingot');
    boardField(c, w, h, 80, 210, 200, 0.2);
    boardHeader(c, w, 'À CÔTÉ');
    fries(c, 78, 196, 84, 3);
    shake(c, 80, 340, 132, 2);
    menuRow(c, pep, 146, 128, 252, 33, 40);
    c.fillStyle = 'rgba(232,178,58,0.28)'; for (let x = 146; x < 398; x += 8) c.fillRect(x, 212, 3, 2);
    menuRow(c, liq, 146, 262, 252, 33, 40);
    // the day's quote, as on a trading screen
    const px = 420, py = 84, pw = 196, ph = 252;
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(px, py, pw, ph);
    c.strokeStyle = 'rgba(232,178,58,0.6)'; c.lineWidth = 1.5; c.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
    text(c, 'COURS DU JOUR', px + pw / 2, py + 27, `800 16px ${SANS}`, B.goldPale, 'center', 3);
    c.fillStyle = 'rgba(243,233,210,0.1)';
    for (let i = 1; i < 5; i++) c.fillRect(px + 14, py + 44 + i * 26, pw - 28, 1);
    for (let i = 1; i < 6; i++) c.fillRect(px + 14 + i * 28, py + 52, 1, 122);
    const points = [[0, 0.16], [0.12, 0.3], [0.22, 0.22], [0.34, 0.46], [0.46, 0.4], [0.58, 0.62], [0.7, 0.55], [0.84, 0.8], [1, 0.9]];
    c.save(); c.shadowColor = B.gold; c.shadowBlur = 10;
    quoteLine(c, px + 16, py + 56, pw - 36, 112, points, B.gold, 3.5);
    c.restore();
    disc(c, px + pw - 20, py + 56 + 112 * 0.1, 5.5, '#fff3c4');
    text(c, ref.name, px + 14, py + 204, `900 19px ${HEAVY}`, B.cream);
    text(c, quote(ref.price), px + 14, py + 236, `900 26px ${HEAVY}`, goldGrad(c, py + 214, py + 238));
    text(c, '▲ +0,4 %', px + pw - 14, py + 234, `800 17px ${SANS}`, '#7fe0a0', 'right');
  },
  // The amber band that runs the menu like share prices
  ticker(c, w, h) {
    c.fillStyle = '#060403'; c.fillRect(0, 0, w, h);
    const pitch = w / LED_COLS, cols = tickerColumns(), lit = [];
    c.fillStyle = '#2a1806'; c.beginPath();
    for (let col = 0; col < LED_COLS; col++) for (let row = 0; row < LED_ROWS; row++) {
      const x = (col + 0.5) * pitch, y = (row + 0.5) * pitch;
      if (cols[col] >> row & 1) lit.push(x, y); else { c.moveTo(x + pitch * 0.3, y); c.arc(x, y, pitch * 0.3, 0, Math.PI * 2); }
    }
    c.fill();
    for (const [radius, style] of [[pitch * 0.95, 'rgba(255,150,20,0.2)'], [pitch * 0.42, '#ffa81f'], [pitch * 0.22, '#ffe3a3']]) {
      c.fillStyle = style; c.beginPath();
      for (let i = 0; i < lit.length; i += 2) { c.moveTo(lit[i] + radius, lit[i + 1]); c.arc(lit[i], lit[i + 1], radius, 0, Math.PI * 2); }
      c.fill();
    }
  },
  posterBull(c, w, h) {
    const it = dish('bullion', 'bullmarket');
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1b1612'); g.addColorStop(1, '#0a0807');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    glow(c, w / 2, 230, 250, 'rgba(232,178,58,0.3)', w, h);
    // the market behind it: bars climbing, and the line that only goes one way
    for (let i = 0; i < 9; i++) { const bh = 26 + i * 24 + (i % 3) * 10; c.fillStyle = `rgba(232,178,58,${0.1 + i * 0.012})`; c.fillRect(40 + i * 38, 356 - bh, 30, bh); }
    c.save(); c.shadowColor = B.gold; c.shadowBlur = 14;
    quoteLine(c, 44, 96, 300, 250, [[0, 0.05], [0.14, 0.2], [0.24, 0.13], [0.4, 0.42], [0.52, 0.35], [0.7, 0.68], [0.8, 0.62], [1, 0.98]], B.gold, 6);
    c.fillStyle = B.gold; poly(c, [[366, 78], [356, 122], [326, 94]], true); c.fill();
    c.restore();
    burger(c, w / 2 - 6, 362, 188, 'bull', 2, { horns: true });
    c.strokeStyle = B.goldDeep; c.lineWidth = 2; c.strokeRect(14, 14, w - 28, h - 28);
    text(c, 'MARCHÉ HAUSSIER', w / 2, 50, `800 17px ${SANS}`, B.goldPale, 'center', 7);
    const [a, b] = it.name.split(' ');
    fitted(c, a, w / 2, 436, 900, HEAVY, 92, w - 70, goldGrad(c, 372, 438), 'center', 4);
    fitted(c, b || '', w / 2, 506, 900, HEAVY, 92, w - 70, goldGrad(c, 442, 508), 'center', 2);
    text(c, 'Ça ne peut que monter.*', w / 2, 533, `italic 600 21px ${SERIF}`, B.cream, 'center');
    c.fillStyle = goldGrad(c, 543, 571); c.fillRect(14, 543, w - 28, 27);
    text(c, `TRIPLE BŒUF · BACON · ${money(it.price)}`, w / 2, 562.5, `900 16px ${HEAVY}`, '#15120f', 'center', 2);
    text(c, '*Les performances passées ne préjugent pas de votre appétit.', w / 2, 581, `500 9px ${SANS}`, 'rgba(243,233,210,0.75)', 'center');
    grain(c, 0, 0, w, h, 900, 0.03, 21);
  },
  posterDividende(c, w, h) {
    const it = dish('bullion', 'dividende'), [first, ...rest] = it.name.split(' '), ink = '#15120f';
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f6cf63'); g.addColorStop(0.6, B.gold); g.addColorStop(1, '#c9952c');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    // rays from the plate
    c.save(); c.translate(w / 2, 232); c.fillStyle = 'rgba(255,244,200,0.35)';
    for (let i = 0; i < 18; i++) { c.rotate(Math.PI / 9); poly(c, [[0, 0], [-26, -520], [26, -520]], true); c.fill(); }
    c.restore();
    disc(c, w / 2, 232, 156, ink);
    ring(c, w / 2, 232, 146, 2, B.gold);
    c.save(); c.beginPath(); c.arc(w / 2, 232, 156, 0, Math.PI * 2); c.clip();
    glow(c, w / 2, 250, 150, 'rgba(232,178,58,0.3)', w, h);
    tray(c, w / 2, 318, 150, 20);
    cup(c, w / 2 + 92, 314, 150);
    burger(c, w / 2 - 44, 318, 150, 'lingot', 6, { shadow: false });
    fries(c, w / 2 + 40, 326, 76, 8);
    c.restore();
    c.strokeStyle = ink; c.lineWidth = 3; c.strokeRect(14, 14, w - 28, h - 28);
    text(c, 'VERSÉ À CHAQUE VISITE', w / 2, 50, `800 17px ${SANS}`, ink, 'center', 6);
    text(c, first, w / 2, 430, `800 30px ${SANS}`, ink, 'center', 18);
    fitted(c, rest.join(' ') || first, w / 2, 494, 900, HEAVY, 70, w - 60, ink, 'center', 1);
    text(c, 'Le seul dividende qui se mange.', w / 2, 526, `italic 600 21px ${SERIF}`, ink, 'center');
    c.fillStyle = ink; c.fillRect(14, 544, w - 28, 42);
    fitted(c, `${it.note.toUpperCase()} · ${money(it.price)}`, w / 2, 571, 900, HEAVY, 17, w - 60, B.gold, 'center', 1);
    // the price, struck like a coin on the plate's shoulder
    star(c, 338, 128, 54, 47, 22, 0.1); c.fillStyle = ink; c.fill();
    ring(c, 338, 128, 41, 1.5, B.gold);
    text(c, money(it.price), 338, 141, `900 34px ${HEAVY}`, B.gold, 'center');
    grain(c, 0, 0, w, h, 900, 0.03, 22);
  },
  posterShake(c, w, h) {
    const it = dish('bullion', 'liquidites');
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1b1612'); g.addColorStop(1, '#0a0807');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    glow(c, w / 2, 220, 240, 'rgba(246,217,138,0.3)', w, h);
    // drops falling upward: liquidity, on tap
    const r = rng(77);
    for (let i = 0; i < 22; i++) {
      const x = 40 + r() * (w - 80), y = 80 + r() * 300, s = 5 + r() * 9;
      c.fillStyle = `rgba(246,217,138,${0.12 + r() * 0.2})`;
      c.beginPath(); c.moveTo(x, y - s * 1.6); c.bezierCurveTo(x + s, y - s * 0.2, x + s, y + s, x, y + s); c.bezierCurveTo(x - s, y + s, x - s, y - s * 0.2, x, y - s * 1.6); c.fill();
    }
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.ellipse(w / 2, 392, 80, 11, 0, 0, Math.PI * 2); c.fill();
    shake(c, w / 2, 392, 296, 4);
    c.strokeStyle = B.goldDeep; c.lineWidth = 2; c.strokeRect(14, 14, w - 28, h - 28);
    text(c, 'ACTIF TRÈS LIQUIDE', w / 2, 50, `800 17px ${SANS}`, B.goldPale, 'center', 7);
    fitted(c, it.name, w / 2, 468, 900, HEAVY, 80, w - 56, goldGrad(c, 418, 470), 'center', 1);
    text(c, 'Toujours disponibles.', w / 2, 506, `italic 600 26px ${SERIF}`, B.cream, 'center');
    text(c, 'Retrait immédiat. Aucun plafond.', w / 2, 532, `500 16px ${SANS}`, '#b3a78d', 'center');
    c.fillStyle = goldGrad(c, 548, 578); c.fillRect(14, 548, w - 28, 38);
    text(c, `MILK-SHAKE VANILLE · ${money(it.price)}`, w / 2, 574, `900 18px ${HEAVY}`, '#15120f', 'center', 2);
    grain(c, 0, 0, w, h, 900, 0.03, 23);
  },
  // The order kiosk's touch screen
  kiosk(c, w, h) {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1d1813'); g.addColorStop(1, '#0c0a08');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    glow(c, w / 2, 96, 220, 'rgba(232,178,58,0.2)', w, h);
    brandLockup(c, 'bullion', w / 2, 30, 17);
    c.fillStyle = 'rgba(232,178,58,0.5)'; c.fillRect(12, 54, w - 24, 1);
    text(c, 'TOUCHEZ', w / 2, 92, `900 34px ${HEAVY}`, B.cream, 'center', 3);
    text(c, 'POUR COMMANDER', w / 2, 118, `900 19px ${HEAVY}`, goldGrad(c, 102, 120), 'center', 3);
    const tile = (x, y, tw, th, it, art) => {
      const tg = c.createLinearGradient(0, y, 0, y + th); tg.addColorStop(0, '#2c251d'); tg.addColorStop(1, '#1a1511');
      c.fillStyle = tg; c.beginPath(); c.roundRect(x, y, tw, th, 8); c.fill();
      c.strokeStyle = 'rgba(232,178,58,0.45)'; c.lineWidth = 1; c.beginPath(); c.roundRect(x + 0.5, y + 0.5, tw - 1, th - 1, 8); c.stroke();
      art(x + 30, y + th - 12);
      const label = it.name.replace(/^MENU /, '');
      fitted(c, label, x + 58, y + 27, 900, HEAVY, 13, tw - 64, B.cream);
      text(c, money(it.price), x + tw - 9, y + th - 13, `900 20px ${HEAVY}`, goldGrad(c, y + th - 30, y + th - 12), 'right');
    };
    const deal = dish('bullion', 'dividende');
    { // the deal, across the screen
      const x = 12, y = 132, tw = w - 24, th = 74;
      const tg = c.createLinearGradient(0, y, 0, y + th); tg.addColorStop(0, '#f6cf63'); tg.addColorStop(1, '#c9952c');
      c.fillStyle = tg; c.beginPath(); c.roundRect(x, y, tw, th, 8); c.fill();
      burger(c, x + 40, y + th - 9, 54, 'lingot', 3, { shadow: false }); fries(c, x + 88, y + th - 8, 30, 3);
      text(c, deal.name, x + 114, y + 27, `900 17px ${HEAVY}`, '#15120f');
      wrap(c, deal.note, `600 10.5px ${SANS}`, 110).slice(0, 2).forEach((l, i) => text(c, l, x + 114, y + 43 + i * 12, `600 10.5px ${SANS}`, '#3a2c0c'));
      text(c, money(deal.price), x + tw - 10, y + th - 10, `900 24px ${HEAVY}`, '#15120f', 'right');
    }
    const arts = {
      bullmarket: (x, y) => burger(c, x, y, 40, 'bull', 2, { shadow: false }), lingot: (x, y) => burger(c, x, y, 42, 'lingot', 4, { shadow: false }),
      krach: (x, y) => burger(c, x, y, 42, 'krach', 5, { shadow: false }), carat: (x, y) => burger(c, x, y, 34, 'carat', 6, { shadow: false }),
      pepites: (x, y) => fries(c, x, y, 34, 2), liquidites: (x, y) => shake(c, x, y, 50, 3)
    };
    Object.keys(arts).forEach((id, i) => tile(12 + (i % 2) * 150, 214 + Math.floor(i / 2) * 76, 146, 70, dish('bullion', id), arts[id]));
    // sur place / à emporter
    c.fillStyle = goldGrad(c, 448, 496); c.beginPath(); c.roundRect(12, 448, 146, 46, 23); c.fill();
    text(c, 'SUR PLACE', 85, 477, `900 15px ${HEAVY}`, '#15120f', 'center', 1);
    c.strokeStyle = B.gold; c.lineWidth = 2; c.beginPath(); c.roundRect(163, 449, 144, 44, 22); c.stroke();
    text(c, 'À EMPORTER', 235, 477, `900 15px ${HEAVY}`, B.gold, 'center', 1);
    text(c, 'FR · EN · ES', w / 2, 506, `600 9px ${SANS}`, '#8d8168', 'center', 2);
    // the glass over the screen
    const s = c.createLinearGradient(0, 0, w, h * 0.5); s.addColorStop(0, 'rgba(255,255,255,0.08)'); s.addColorStop(0.5, 'rgba(255,255,255,0)');
    c.fillStyle = s; c.fillRect(0, 0, w, h);
  },
  orderHere(c, w, h) { lightbox(c, w, h, 'COMMANDEZ ICI', 'down'); },
  pickup(c, w, h) { lightbox(c, w, h, 'RETRAIT DES COMMANDES', 'mark'); },
  // The framed certificate nobody asked for
  quarter(c, w, h) {
    c.fillStyle = '#f4ecd8'; c.fillRect(0, 0, w, h);
    grain(c, 0, 0, w, h, 700, 0.03, 31);
    moulding(c, 0, 0, w, h, 17, '#d2aa4c', '#8a6a22');
    c.strokeStyle = '#b8862b'; c.lineWidth = 1; c.strokeRect(27, 27, w - 54, h - 54);
    brandEmblem(c, 'bullion', w / 2, 52, 34, { tone: 'ink', color: '#15120f' });
    text(c, 'ÉQUIPIER', w / 2, 100, `700 27px ${SERIF}`, '#15120f', 'center', 5);
    text(c, 'DU TRIMESTRE', w / 2, 122, `700 15px ${SERIF}`, '#7e1f1a', 'center', 5);
    // the photograph
    const px = 86, py = 136, pw = 128, ph = 132;
    const pg = c.createLinearGradient(0, py, 0, py + ph); pg.addColorStop(0, '#d8d2c2'); pg.addColorStop(1, '#a9a290');
    c.fillStyle = '#ffffff'; c.fillRect(px - 5, py - 5, pw + 10, ph + 10);
    c.fillStyle = pg; c.fillRect(px, py, pw, ph);
    c.save(); c.beginPath(); c.rect(px, py, pw, ph); c.clip();
    c.fillStyle = '#2a2622'; bust(c, px + pw / 2, py + ph + 6, 132, 'cap');
    brandEmblem(c, 'bullion', px + pw / 2 + 2, py + 36, 15, { tone: 'ink', color: B.gold });
    c.restore();
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1; c.strokeRect(px - 5.5, py - 5.5, pw + 11, ph + 11);
    // the seal
    star(c, 222, 262, 25, 21, 18, 0.2); c.fillStyle = goldGrad(c, 238, 288); c.fill();
    brandEmblem(c, 'bullion', 222, 261, 22, { tone: 'ink', color: '#7a5a16' });
    text(c, BRANDS.bullion.crew[1] || 'DEV', w / 2, 305, `900 24px ${HEAVY}`, '#15120f', 'center', 5);
    text(c, 'Rendement : +12 %.', w / 2, 326, `italic 500 15px ${SERIF}`, '#3a332b', 'center');
    text(c, 'Augmentation : 0 %.', w / 2, 344, `italic 500 15px ${SERIF}`, '#3a332b', 'center');
    // glass
    const s = c.createLinearGradient(0, 0, w, h); s.addColorStop(0.2, 'rgba(255,255,255,0)'); s.addColorStop(0.45, 'rgba(255,255,255,0.14)'); s.addColorStop(0.55, 'rgba(255,255,255,0)');
    c.fillStyle = s; c.fillRect(17, 17, w - 34, h - 34);
  },
  // The chalkboard: the market against the burger
  chalk(c, w, h) {
    slate(c, w, h, '#1b1d1c', 12);
    const ref = dish('bullion', 'lingot'), white = 'rgba(240,236,224,0.92)';
    text(c, 'COURS DU JOUR', w / 2, 56, `400 31px ${CHALK}`, white, 'center');
    line(c, 96, 68, w - 96, 70, 2.5, 'rgba(240,236,224,0.7)');
    // axes
    c.lineCap = 'round';
    line(c, 46, 88, 46, 248, 3, white); line(c, 46, 248, 272, 248, 3, white);
    poly(c, [[40, 98], [46, 86], [52, 98]]); c.stroke(); poly(c, [[262, 242], [274, 248], [262, 254]]); c.stroke();
    // the market: all over the place, then through the floor
    quoteLine(c, 52, 96, 206, 146, [[0, 0.5], [0.1, 0.72], [0.18, 0.58], [0.28, 0.9], [0.36, 0.7], [0.46, 0.84], [0.56, 0.42], [0.64, 0.56], [0.74, 0.3], [0.84, 0.36], [1, 0.02]], 'rgba(240,130,120,0.9)', 3);
    // the burger: flat as a board since 1971
    quoteLine(c, 52, 96, 206, 146, [[0, 0.44], [0.2, 0.445], [0.4, 0.44], [0.6, 0.45], [0.8, 0.44], [1, 0.445]], 'rgba(246,208,110,0.95)', 4.5);
    text(c, 'le marché', 284, 240, `400 15px ${CHALK}`, 'rgba(240,130,120,0.95)');
    fitted(c, ref.name, 278, 132, 400, CHALK, 19, 114, 'rgba(246,208,110,0.98)');
    chalkPrice(c, ref.price, 340, 184, 42, 'rgba(246,208,110,0.98)');
    text(c, 'hier, aujourd’hui, demain.', w / 2, 282, `400 15px ${CHALK}`, white, 'center');
    chalkDust(c, w, h, 5200, '#1b1d1c', 5);
    moulding(c, 0, 0, w, h, 13, '#6b5332', '#3d2d18');
  },
  // The board on the pavement
  sandwich(c, w, h) {
    const deal = dish('bullion', 'dividende'), white = 'rgba(240,236,224,0.94)', gold = 'rgba(246,208,110,0.98)';
    slate(c, w, h, '#191a19', 13);
    brandEmblem(c, 'bullion', w / 2, 84, 96, { tone: 'ink', color: gold });
    text(c, 'AUJOURD’HUI', w / 2, 170, `400 25px ${CHALK}`, white, 'center');
    line(c, 70, 184, w - 70, 186, 2.5, 'rgba(240,236,224,0.7)');
    const [first, ...rest] = deal.name.split(' ');
    text(c, first, w / 2, 232, `400 30px ${CHALK}`, gold, 'center');
    fitted(c, rest.join(' ') || first, w / 2, 280, 400, CHALK, 40, w - 70, gold, 'center');
    chalkPrice(c, deal.price, w / 2, 392, 86, white);
    c.lineCap = 'round'; c.strokeStyle = gold; c.lineWidth = 3;
    c.beginPath(); c.ellipse(w / 2, 360, 142, 70, -0.03, 0.2, Math.PI * 2 + 0.05); c.stroke();
    wrap(c, deal.note, `400 17px ${CHALK}`, w - 84).forEach((l, i) => text(c, l, w / 2, 462 + i * 24, `400 17px ${CHALK}`, white, 'center'));
    text(c, 'Ouvert quand', w / 2, 536, `400 20px ${CHALK}`, gold, 'center');
    text(c, 'la Bourse dort.', w / 2, 562, `400 20px ${CHALK}`, gold, 'center');
    chalkDust(c, w, h, 9000, '#191a19', 6);
    moulding(c, 0, 0, w, h, 20, '#3a2f22', '#17120c');
    c.strokeStyle = B.goldDeep; c.lineWidth = 1.5; c.strokeRect(20.5, 20.5, w - 41, h - 41);
  },
  // The doormat: ribbed black rubber, the bull walked dull
  mat(c, w, h) {
    c.fillStyle = '#121110'; c.fillRect(0, 0, w, h);
    for (let y = 3; y < h; y += 6) { c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(0, y, w, 1.5); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, y + 2, w, 2); }
    c.strokeStyle = '#26231f'; c.lineWidth = 10; c.strokeRect(13, 13, w - 26, h - 26);
    c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 2; c.strokeRect(19, 19, w - 38, h - 38);
    brandEmblem(c, 'bullion', w / 2, h / 2 - 10, 152, { tone: 'ink', color: '#b58d34' });
    text(c, 'BULLION', w / 2, h - 34, `900 20px ${HEAVY}`, '#9a7830', 'center', 12);
    // wear: the ribs show through, and grit where the feet land
    for (let y = 5; y < h; y += 6) { c.fillStyle = 'rgba(18,17,16,0.42)'; c.fillRect(0, y, w, 2); }
    const r = rng(8);
    for (let i = 0; i < 1700; i++) { const x = w / 2 + (r() + r() - 1) * w * 0.42, y = h / 2 + (r() + r() - 1) * h * 0.46; c.fillStyle = r() < 0.7 ? 'rgba(18,17,16,0.65)' : 'rgba(150,140,120,0.16)'; c.fillRect(x, y, 1 + r() * 3, 1 + r() * 1.5); }
    vignette(c, w, h, 0.4);
  },
  apron(c, w, h) { cloth(c, w, h, '#161412', 51); brandEmblem(c, 'bullion', w / 2, 74, 76); brandWordmark(c, 'bullion', w / 2, 132, 17); stitches(c, w, h, 'rgba(232,178,58,0.5)'); },
  cap(c, w, h) {
    cloth(c, w, h, '#161412', 52);
    c.strokeStyle = B.goldDeep; c.lineWidth = 2; c.setLineDash([5, 3]); c.beginPath(); c.roundRect(9, 9, w - 18, h - 18, 12); c.stroke(); c.setLineDash([]);
    brandEmblem(c, 'bullion', w / 2, h / 2 - 2, 84);
  },
  staff(c, w, h) {
    plate(c, w, h, '#15120f', B.goldDeep);
    text(c, 'PERSONNEL', w / 2, 46, `900 30px ${HEAVY}`, goldGrad(c, 22, 48), 'center', 3);
    text(c, 'SEULEMENT', w / 2, 74, `800 17px ${SANS}`, B.cream, 'center', 8);
  },
  wc(c, w, h) {
    plate(c, w, h, '#15120f', B.goldDeep);
    text(c, 'TOILETTES', w / 2, 46, `900 30px ${HEAVY}`, goldGrad(c, 22, 48), 'center', 3);
    text(c, 'CLIENTS SEULEMENT', w / 2, 74, `800 15px ${SANS}`, B.cream, 'center', 4);
  },
  exit(c, w, h) { exitSign(c, w, h); },
  trash(c, w, h) {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2a2520'); g.addColorStop(0.5, '#171411'); g.addColorStop(1, '#0d0b09');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(232,178,58,0.6)'; c.lineWidth = 2; c.strokeRect(7, 7, w - 14, h - 14);
    fitted(c, 'MERCI', w / 2, 72, 900, HEAVY, 56, w - 56, goldGrad(c, 30, 74), 'center', 8);
    text(c, 'DÉPOSEZ ICI VOS PASSIFS', w / 2, 102, `800 13px ${SANS}`, B.cream, 'center', 3);
    // the hinge's shadow and fingerprints
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, 0, w, 5);
    grain(c, 0, 0, w, h, 300, 0.05, 61);
  },
  hours(c, w, h) {
    c.fillStyle = '#15120f'; c.fillRect(0, 0, w, h);
    c.strokeStyle = B.gold; c.lineWidth = 2; c.strokeRect(8, 8, w - 16, h - 16);
    c.strokeStyle = B.goldDeep; c.lineWidth = 1; c.strokeRect(13, 13, w - 26, h - 26);
    text(c, 'OUVERT', 34, 48, `800 20px ${SANS}`, B.goldPale, 'left', 9);
    text(c, '7 J / 7', w - 34, 48, `800 20px ${SANS}`, B.goldPale, 'right', 4);
    fitted(c, hoursText('bullion'), w / 2, 108, 900, HEAVY, 62, w - 70, goldGrad(c, 62, 110), 'center', 2);
    text(c, 'Le marché ferme. Pas nous.', w / 2, 138, `italic 500 17px ${SERIF}`, B.cream, 'center');
  },
  wetFloor(c, w, h) { wetFloorSign(c, w, h, 'RISQUE DE CHUTE DES COURS', 'BULLION'); },
  // Ingots in running bond, for a stripe round the room; loops every 512 px
  barsPattern(c, w, h) {
    c.fillStyle = '#100d0b'; c.fillRect(0, 0, w, h);
    c.fillStyle = goldGrad(c, 5, 11); c.fillRect(0, 6, w, 4);
    c.fillStyle = goldGrad(c, h - 11, h - 5); c.fillRect(0, h - 10, w, 4);
    const bw = 128, bh = 44;
    const ingot = (x, y) => {
      // the top face, then the long face sloping toward us
      c.fillStyle = '#fbe6a2'; poly(c, [[x + 12, y], [x + bw - 16, y], [x + bw - 10, y + 9], [x + 6, y + 9]], true); c.fill();
      const g = c.createLinearGradient(0, y + 9, 0, y + bh); g.addColorStop(0, B.gold); g.addColorStop(1, '#9c6e1e');
      c.fillStyle = g; poly(c, [[x + 6, y + 9], [x + bw - 10, y + 9], [x + bw - 4, y + bh - 2], [x, y + bh - 2]], true); c.fill();
      c.fillStyle = 'rgba(255,250,220,0.5)'; c.fillRect(x + 7, y + 9, bw - 18, 1.5);
      c.fillStyle = 'rgba(110,70,10,0.5)';
      c.beginPath(); c.roundRect(x + 34, y + 17, bw - 72, 16, 3); c.fill();
      text(c, '999,9', x + bw / 2 - 2, y + 30, `900 12px ${HEAVY}`, 'rgba(255,236,170,0.8)', 'center', 1);
    };
    for (let i = -1; i < 5; i++) { ingot(i * bw + 4, 18); ingot(i * bw + bw / 2 + 4, 18 + bh + 4); }
  },
  // Small bulls in a row across the glass doors, where the hand goes
  doorBand(c, w, h) {
    for (let i = 0; i < 8; i++) {
      brandEmblem(c, 'bullion', 32 + i * 64, h / 2 - 1, 40, { tone: 'ink', color: B.gold });
      if (i) { c.fillStyle = B.goldDeep; c.fillRect(i * 64 - 4, h / 2 + 1, 8, 2); }
    }
  },
  // extras -------------------------------------------------------------
  // A vertical sign for the corner of the building: the trade, one letter over the next
  banner(c, w, h) {
    const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#0d0b09'); g.addColorStop(0.35, '#211b15'); g.addColorStop(1, '#0b0908');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = goldGrad(c, 0, h); c.fillRect(6, 6, 3, h - 12); c.fillRect(w - 9, 6, 3, h - 12);
    c.fillStyle = B.goldDeep; c.fillRect(6, 6, w - 12, 3); c.fillRect(6, h - 9, w - 12, 3);
    brandEmblem(c, 'bullion', w / 2, 50, 62);
    [...'BURGERS'].forEach((ch, i) => { const y = 142 + i * 53; text(c, ch, w / 2, y, `900 52px ${HEAVY}`, goldGrad(c, y - 40, y + 2), 'center'); });
    text(c, '1971', w / 2, h - 20, `800 14px ${SANS}`, B.goldPale, 'center', 3);
    grain(c, 0, 0, w, h, 500, 0.035, 81);
  },
  // The till's ticket
  receipt(c, w, h) {
    const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#e9e6de'); g.addColorStop(0.5, '#fbfaf5'); g.addColorStop(1, '#e4e1d8');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const ink = '#2b2926', deal = dish('bullion', 'dividende'), extra = dish('bullion', 'liquidites');
    brandEmblem(c, 'bullion', w / 2, 24, 26, { tone: 'ink', color: ink });
    text(c, 'BULLION', w / 2, 52, `700 13px ${MONO}`, ink, 'center', 2);
    text(c, 'la valeur refuge', w / 2, 64, `400 8px ${MONO}`, ink, 'center');
    const dash = () => '- '.repeat(13);
    text(c, dash(), w / 2, 78, `400 8px ${MONO}`, ink, 'center');
    text(c, 'TICKET N° 1971', 8, 92, `700 8.5px ${MONO}`, ink);
    let y = 110;
    for (const it of [deal, extra]) {
      text(c, `1 ${it.name.replace(/^MENU /, '')}`, 8, y, `400 8.5px ${MONO}`, ink); text(c, quote(it.price), w - 8, y + 11, `400 8.5px ${MONO}`, ink, 'right'); y += 26;
    }
    text(c, dash(), w / 2, y, `400 8px ${MONO}`, ink, 'center'); y += 16;
    text(c, 'TOTAL', 8, y, `700 11px ${MONO}`, ink); text(c, quote(deal.price + extra.price), w - 8, y, `700 11px ${MONO}`, ink, 'right'); y += 16;
    text(c, 'FRAIS DE GARDE', 8, y, `400 8px ${MONO}`, ink); text(c, '0,00', w - 8, y, `400 8px ${MONO}`, ink, 'right'); y += 12;
    text(c, 'PLUS-VALUE', 8, y, `400 8px ${MONO}`, ink); text(c, 'LA VÔTRE', w - 8, y, `400 8px ${MONO}`, ink, 'right'); y += 18;
    text(c, dash(), w / 2, y, `400 8px ${MONO}`, ink, 'center'); y += 16;
    text(c, 'MERCI DE VOTRE', w / 2, y, `700 9px ${MONO}`, ink, 'center'); y += 12;
    text(c, 'INVESTISSEMENT', w / 2, y, `700 9px ${MONO}`, ink, 'center'); y += 16;
    const r = rng(19); let x = 12;
    while (x < w - 12) { const bw = 1 + Math.floor(r() * 3); c.fillStyle = ink; c.fillRect(x, y, bw, 34); x += bw + 1 + Math.floor(r() * 2); }
    text(c, '0 1971 0815 26', w / 2, y + 46, `400 7.5px ${MONO}`, ink, 'center', 1);
    // the paper's torn foot
    c.fillStyle = '#cfcbc0'; for (let i = 0; i < w; i += 6) { poly(c, [[i, h], [i + 3, h - 5], [i + 6, h]], true); c.fill(); }
  },
  // The sheet of paper under every meal
  trayLiner(c, w, h) {
    c.fillStyle = '#f3e9d2'; c.fillRect(0, 0, w, h);
    c.save(); c.globalAlpha = 0.16;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) brandEmblem(c, 'bullion', 20 + i * 40 + (j % 2) * 20, 18 + j * 36, 22, { tone: 'ink', color: '#b8862b' });
    c.restore();
    c.fillStyle = '#f3e9d2'; c.beginPath(); c.roundRect(24, 46, w - 48, 76, 6); c.fill();
    brandLockup(c, 'bullion', w / 2, 72, 19, { tone: 'ink', color: '#15120f' });
    text(c, 'La valeur refuge.', w / 2, 108, `italic 600 14px ${SERIF}`, '#7e1f1a', 'center');
    c.strokeStyle = '#b8862b'; c.lineWidth = 1.5; c.strokeRect(5, 5, w - 10, h - 10);
    text(c, 'NE PAS MANGER LE PAPIER. IL NE RAPPORTE RIEN.', w / 2, h - 13, `700 6.6px ${SANS}`, '#6b5a3a', 'center', 0.6);
  },
  // The takeaway bag's face
  bagFront(c, w, h) {
    const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#b98f58'); g.addColorStop(0.5, '#cba36a'); g.addColorStop(1, '#b08650');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    grain(c, 0, 0, w, h, 900, 0.05, 71);
    c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, 0, w, 16); c.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < w; i += 8) { poly(c, [[i, 0], [i + 4, 6], [i + 8, 0]], true); c.fill(); }
    brandEmblem(c, 'bullion', w / 2, 84, 92, { tone: 'ink', color: '#15120f' });
    brandWordmark(c, 'bullion', w / 2, 146, 20, { tone: 'ink', color: '#15120f' });
    text(c, 'À EMPORTER', w / 2, 174, `800 10px ${SANS}`, '#15120f', 'center', 4);
    text(c, 'Valeur en baisse dès la sortie.', w / 2, 190, `italic 500 9.5px ${SERIF}`, '#3a2c14', 'center');
    // grease, already
    disc(c, 34, 168, 13, 'rgba(120,80,30,0.16)'); disc(c, 146, 44, 9, 'rgba(120,80,30,0.13)');
  }
};

// a lit sign box: gold glass, black capitals
function lightbox(c, w, h, label, side) {
  const g = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.56);
  g.addColorStop(0, '#fff1b8'); g.addColorStop(0.55, '#f2c452'); g.addColorStop(1, '#c9952c');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.strokeStyle = '#15120f'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
  c.strokeStyle = 'rgba(21,18,15,0.55)'; c.lineWidth = 1.5; c.strokeRect(13, 13, w - 26, h - 26);
  // a long line is squeezed, as a signwriter would, before it is made smaller
  const room = w - 132, natural = measure(c, label, `900 40px ${HEAVY}`, 3), squeeze = Math.max(0.72, Math.min(1, room / natural));
  const size = fit(c, label, 900, HEAVY, 40, room / squeeze, 3);
  c.save(); c.translate(w / 2, h / 2 + size * 0.36); c.scale(squeeze, 1);
  text(c, label, 0, 0, `900 ${size}px ${HEAVY}`, '#15120f', 'center', 3);
  c.restore();
  for (const dir of [-1, 1]) {
    const x = w / 2 + dir * (w / 2 - 40);
    if (side === 'down') { c.fillStyle = '#15120f'; poly(c, [[x - 15, h / 2 - 11], [x + 15, h / 2 - 11], [x, h / 2 + 15]], true); c.fill(); }
    else brandEmblem(c, 'bullion', x, h / 2 - 2, 40, { tone: 'ink', color: '#15120f' });
  }
}
// woven cloth
function cloth(c, w, h, base, seed, weave = 1) {
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 3) { c.fillStyle = y % 6 ? 'rgba(255,255,255,0.03)' : `rgba(0,0,0,${0.12 * weave})`; c.fillRect(0, y, w, 1); }
  for (let x = 0; x < w; x += 3) { c.fillStyle = x % 6 ? 'rgba(255,255,255,0.025)' : `rgba(0,0,0,${0.1 * weave})`; c.fillRect(x, 0, 1, h); }
  grain(c, 0, 0, w, h, w * h / 110, 0.05, seed);
}
function stitches(c, w, h, style) {
  c.strokeStyle = style; c.lineWidth = 1.5; c.setLineDash([6, 4]);
  c.strokeRect(10, 10, w - 20, h - 20);
  c.beginPath(); c.moveTo(48, 170); c.lineTo(w - 48, 170); c.lineTo(w - 48, h - 10); c.moveTo(48, 170); c.lineTo(48, h - 10); c.moveTo(w / 2, 170); c.lineTo(w / 2, h - 10); c.stroke();
  c.setLineDash([]);
}

// ---------- TRANCHE ----------

// A telephone handset: the call nobody wants, except this one
function handset(c, cx, cy, s, rot, color) {
  c.save(); c.translate(cx, cy); c.rotate(rot);
  // the grip: a thick bar, barely arched; then the ear and mouth pieces, two cups hanging from its ends
  c.strokeStyle = color; c.lineWidth = s * 0.3; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-s * 0.62, -s * 0.04); c.quadraticCurveTo(0, -s * 0.3, s * 0.62, -s * 0.04); c.stroke();
  for (const side of [-1, 1]) {
    c.save(); c.translate(side * s * 0.72, s * 0.16); c.rotate(side * 0.26);
    c.fillStyle = color; c.beginPath(); c.roundRect(-s * 0.28, -s * 0.26, s * 0.56, s * 0.52, [s * 0.14, s * 0.14, s * 0.22, s * 0.22]); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.ellipse(0, s * 0.2, s * 0.2, s * 0.04, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = s * 0.045;
  c.beginPath(); c.moveTo(-s * 0.5, -s * 0.16); c.quadraticCurveTo(-s * 0.05, -s * 0.33, s * 0.34, -s * 0.24); c.stroke();
  c.restore(); c.lineCap = 'butt';
}
function paper(c, w, h, base, seed) {
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  grain(c, 0, 0, w, h, Math.round(w * h / 280), 0.035, seed);
}
// The pavement board's own slice, in chalk
function chalkSlice(c, cx, cy, s, rot, color, dots) {
  c.save(); c.translate(cx, cy); c.rotate(rot);
  c.strokeStyle = color; c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(-s * 0.44, -s * 0.42); c.quadraticCurveTo(0, -s * 0.62, s * 0.44, -s * 0.42); c.lineTo(0, s * 0.5); c.closePath(); c.stroke();
  c.beginPath(); c.moveTo(-s * 0.36, -s * 0.28); c.quadraticCurveTo(0, -s * 0.44, s * 0.36, -s * 0.28); c.stroke();
  c.strokeStyle = dots;
  for (const [x, y] of [[-0.14, -0.14], [0.14, -0.1], [0, 0.12]]) { c.beginPath(); c.arc(x * s, y * s, s * 0.07, 0, Math.PI * 2); c.stroke(); }
  c.restore(); c.lineCap = 'butt';
}

const RED_LETTER = '#f0503a';
const tranche = {
  // The sign band: cream, the lockup in tomato, a ribbon of checks along the foot
  fascia(c, w, h) {
    const ribbon = 30;
    paper(c, w, h, T.cream, 101);
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(120,80,30,0.1)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    checks(c, 0, h - ribbon, w, ribbon, 15, '#fffaf0', T.tomato);
    c.fillStyle = T.tomatoDeep; c.fillRect(0, h - ribbon - 4, w, 4);
    c.fillStyle = T.tomato; c.fillRect(24, 7, w - 48, 4);
    // the shop is narrow and the band shallow: the lockup takes all the height there is
    const cy = (h - ribbon) / 2 + 1;
    const lock = brandLockup(c, 'tranche', w / 2, cy, 80);
    const [left, right] = BRANDS.tranche.since.toUpperCase().split(' · ');
    fasciaWords(c, w, cy + 6, lock, [left, right || 'FOUR À SOLE'], T.tomato, T.basil, 38, 9);
  },
  blade(c, w, h) {
    const cx = w / 2, cy = h / 2, r = w / 2;
    c.fillStyle = T.tomatoDeep; c.fillRect(0, 0, w, h);
    const g = c.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#fffaf0'); g.addColorStop(0.7, T.cream); g.addColorStop(1, '#e9dcc0');
    disc(c, cx, cy, r, g);
    ring(c, cx, cy, r - 10, 16, T.tomato);
    ring(c, cx, cy, r - 28, 2.5, T.basil);
    brandEmblem(c, 'tranche', cx + 10, cy - 8, 304);
  },
  // « Tranche » in red script tubes, a yellow slice, a green stroke under it
  neonName(c, w, h) {
    const size = fit(c, 'Tranche', 400, SCRIPT, 210, w - 300);
    neonText(c, 'Tranche', w * 0.42, h * 0.66, `400 ${size}px ${SCRIPT}`, '#ff3a26', 6.8, 0, '#ffc9bd');
    neon(c, () => { c.beginPath(); c.moveTo(w * 0.14, h * 0.86); c.bezierCurveTo(w * 0.32, h * 0.93, w * 0.52, h * 0.8, w * 0.7, h * 0.87); c.stroke(); }, '#35e07a', 5, '#e8fff0');
    // the slice: crust up, leaning
    c.save(); c.translate(w * 0.855, h * 0.45); c.rotate(0.3);
    neon(c, () => { c.beginPath(); c.moveTo(-52, -54); c.quadraticCurveTo(0, -84, 52, -54); c.stroke(); }, '#ff3a26', 6, '#ffe9e2');
    neon(c, () => { c.beginPath(); c.moveTo(-46, -36); c.lineTo(0, 72); c.lineTo(46, -36); c.stroke(); }, '#ffd23c', 4.6, '#fffbe6');
    for (const [x, y] of [[-14, -22], [14, -8], [-2, 20]]) neon(c, () => { c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.stroke(); }, '#ff3a26', 3.4, '#ffe9e2');
    c.restore();
  },
  // The slice in the window: red crust, yellow cheese, PIZZA in green
  neonSlice(c, w, h) {
    const cx = w / 2;
    neon(c, () => { c.beginPath(); c.moveTo(cx - 132, 96); c.quadraticCurveTo(cx, 22, cx + 132, 96); c.stroke(); }, '#ff3a26', 9, '#ffe9e2');
    neon(c, () => { c.beginPath(); c.moveTo(cx - 120, 126); c.quadraticCurveTo(cx, 64, cx + 120, 126); c.lineTo(cx + 6, 296); c.quadraticCurveTo(cx, 304, cx - 6, 296); c.closePath(); c.stroke(); }, '#ffd23c', 6.5, '#fffbe6');
    for (const [x, y, r] of [[-52, 140, 17], [34, 132, 18], [-8, 194, 17], [14, 246, 11]]) neon(c, () => { c.beginPath(); c.arc(cx + x, y, r, 0, Math.PI * 2); c.stroke(); }, '#ff3a26', 4.6, '#ffe9e2');
    neonText(c, 'PIZZA', cx, 382, `200 ${fit(c, 'PIZZA', 200, SANS, 70, w - 160, 14)}px ${SANS}`, '#35e07a', 6.2, 14, '#e8fff0');
  },
  open(c, w, h) {
    neonText(c, 'OUVERT', w / 2 - 16, 67, `200 ${fit(c, 'OUVERT', 200, SANS, 50, w - 132, 9)}px ${SANS}`, '#ff3a26', 5.2, 9, '#ffc9bd');
    c.save(); c.translate(w / 2 + 66, 114); c.rotate(-0.08);
    neonText(c, 'tard', 0, 0, `400 70px ${SCRIPT}`, '#ffd23c', 4.8, 0, '#fffbe6');
    c.restore();
  },
  // The wall menu: black felt in an aluminium frame, white plastic letters, red ones for what it costs
  menuBoard(c, w, h) {
    felt(c, 0, 0, w, h, 10);
    const title = BRANDS.tranche.since.toUpperCase().split(' · ')[0];
    letters(c, title, w / 2, 104, 52, { align: 'center', seed: 3, color: RED_LETTER, weight: 800 });
    brandEmblem(c, 'tranche', 96, 82, 96); brandEmblem(c, 'tranche', w - 92, 82, 96);
    BRANDS.tranche.menu.forEach((it, i) => {
      const y = 180 + i * 61, last = [...it.name].length - 1;
      const nw = letters(c, it.name, 62, y, 36, { seed: 10 + i, tilt: it.id === 'triplea' ? { index: last, angle: 0.48, drop: 8 } : null });
      const pw = letters(c, money(it.price), w - 62, y, 36, { align: 'right', seed: 30 + i, color: RED_LETTER });
      for (let x = 62 + nw + 22; x < w - 62 - pw - 14; x += 15) disc(c, x, y - 4, 2.2, 'rgba(243,240,230,0.55)');
      letters(c, it.note.toUpperCase(), 64, y + 23, 14.5, { seed: 50 + i, color: '#cbc4b0', weight: 600, spacing: 1.6 });
    });
    c.fillStyle = 'rgba(240,80,58,0.8)'; c.fillRect(62, 516, w - 124, 2);
    letters(c, 'EQUITY · MEZZANINE · SENIOR', w / 2, 552, 28, { align: 'center', seed: 80 });
    letters(c, 'TROIS TAILLES. LA SENIOR EST SERVIE EN PREMIER.', w / 2, 574, 13, { align: 'center', seed: 81, color: RED_LETTER, weight: 600, spacing: 1.8 });
    moulding(c, 0, 0, w, h, 17, '#dde1e4', '#8f969b');
    c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1; c.strokeRect(5.5, 5.5, w - 11, h - 11);
    vignette(c, w, h, 0.22);
  },
  posterPart(c, w, h) {
    paper(c, w, h, T.cream, 111);
    c.strokeStyle = T.tomato; c.lineWidth = 3; c.strokeRect(14, 14, w - 28, h - 28);
    text(c, 'RÉPARTITION DU CAPITAL', w / 2, 52, `800 17px ${SANS}`, T.tomatoDeep, 'center', 5);
    // the chart: one share has left the pie
    c.fillStyle = 'rgba(30,27,25,0.1)'; c.beginPath(); c.arc(170, 262, 120, 0, Math.PI * 2); c.fill();
    pie(c, 164, 254, 120, { cuts: 6, out: 40, start: -Math.PI / 2, seed: 4 });
    // its label, as in any annual report
    c.strokeStyle = T.charcoal; c.lineWidth = 2; c.beginPath(); c.moveTo(270, 152); c.lineTo(296, 122); c.lineTo(392, 122); c.stroke();
    disc(c, 270, 152, 4, T.charcoal);
    text(c, 'VOTRE PART', 392, 113, `800 14px ${SANS}`, T.charcoal, 'right', 2);
    text(c, '16,7 %', 392, 150, `700 27px ${SERIF}`, T.tomato, 'right');
    c.strokeStyle = T.charcoal; c.beginPath(); c.moveTo(150, 376); c.lineTo(150, 394); c.lineTo(176, 394); c.stroke();
    text(c, 'LE RESTE : EN NÉGOCIATION', 184, 399, `800 12px ${SANS}`, T.charcoal, 'left', 1.5);
    const [a, ...b] = BRANDS.tranche.tagline.toUpperCase().split(' ');
    fitted(c, a, w / 2, 462, 700, SERIF, 66, w - 70, T.tomato, 'center', 3);
    fitted(c, b.join(' '), w / 2, 522, 700, SERIF, 58, w - 64, T.tomato, 'center', 1);
    text(c, 'Avant qu’un autre ne la prenne.', w / 2, 549, `italic 500 19px ${SERIF}`, T.charcoal, 'center');
    c.fillStyle = T.tomato; c.fillRect(14, 560, w - 28, 26);
    text(c, BRANDS.tranche.since.toUpperCase(), w / 2, 579, `800 14px ${SANS}`, T.cream, 'center', 3);
  },
  posterCall(c, w, h) {
    const it = dish('tranche', 'margherita');
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2a2522'); g.addColorStop(1, '#141210');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    glow(c, w / 2, 220, 250, 'rgba(213,49,31,0.34)', w, h);
    c.strokeStyle = T.crust; c.lineWidth = 2; c.strokeRect(14, 14, w - 28, h - 28);
    text(c, 'ÇA SONNE. DÉCROCHEZ.', w / 2, 52, `800 17px ${SANS}`, T.cheese, 'center', 5);
    slice(c, 266, 232, 264, 0.16, 'margherita', 3);
    // the handset off its hook, its cord, and the ringing
    c.strokeStyle = T.cream; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath();
    for (let i = 0; i <= 60; i++) c[i ? 'lineTo' : 'moveTo'](66 + Math.sin(i * 0.82) * 13 - i * 0.2, 236 + i * 2.5);
    c.stroke();
    handset(c, 92, 184, 72, -1.12, T.cream);
    c.strokeStyle = T.cheese; c.lineWidth = 5;
    for (const r of [34, 50, 66]) { c.beginPath(); c.arc(112, 136, r, -2.75, -1.85); c.stroke(); }
    c.lineCap = 'butt';
    const [a, ...b] = it.name.split(' ');
    fitted(c, a, w / 2, 448, 900, HEAVY, 70, w - 56, T.cream, 'center', 1);
    fitted(c, b.join(' '), w / 2, 520, 900, HEAVY, 92, w - 60, T.tomato, 'center', 12);
    text(c, 'Le seul appel de marge qui fait plaisir.', w / 2, 546, `italic 500 19px ${SERIF}`, T.cream, 'center');
    c.fillStyle = T.tomato; c.fillRect(14, 558, w - 28, 28);
    fitted(c, `${it.note.toUpperCase()} · ${money(it.price)}`, w / 2, 578, 800, SANS, 15, w - 60, T.cream, 'center', 2.5);
    grain(c, 0, 0, w, h, 900, 0.03, 112);
  },
  posterSubprime(c, w, h) {
    const it = dish('tranche', 'subprime');
    paper(c, w, h, '#f1dfae', 113);
    // the rays of a bargain
    c.save(); c.translate(w / 2, 250); c.fillStyle = 'rgba(213,49,31,0.1)';
    for (let i = 0; i < 16; i++) { c.rotate(Math.PI / 8); poly(c, [[0, 0], [-30, -460], [30, -460]], true); c.fill(); }
    c.restore();
    c.strokeStyle = T.charcoal; c.lineWidth = 3; c.strokeRect(14, 14, w - 28, h - 28);
    text(c, 'OFFRE NON GARANTIE', w / 2, 52, `800 17px ${SANS}`, T.charcoal, 'center', 5);
    fitted(c, it.name, w / 2, 128, 900, HEAVY, 84, w - 60, T.charcoal, 'center', 1);
    // yesterday's slice on its paper plate, and what rises from it
    c.fillStyle = 'rgba(30,27,25,0.18)'; c.beginPath(); c.ellipse(170, 372, 128, 20, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fbf7ec'; c.beginPath(); c.ellipse(170, 360, 126, 24, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#d9d2bf'; c.lineWidth = 2; c.beginPath(); c.ellipse(170, 359, 104, 17, 0, 0, Math.PI * 2); c.stroke();
    slice(c, 166, 262, 200, -0.12, 'tired', 8);
    c.strokeStyle = 'rgba(30,27,25,0.5)'; c.lineWidth = 3; c.lineCap = 'round';
    for (const x of [96, 150, 214]) { c.beginPath(); c.moveTo(x, 152); c.bezierCurveTo(x - 14, 164, x + 14, 176, x, 190); c.stroke(); }
    c.lineCap = 'butt';
    // the price, loud
    star(c, 318, 268, 86, 68, 14, 0.2); c.fillStyle = T.tomato; c.fill();
    star(c, 318, 268, 74, 60, 14, 0.2); c.strokeStyle = T.cheese; c.lineWidth = 2; c.stroke();
    c.save(); c.translate(318, 268); c.rotate(-0.1);
    bigPrice(c, it.price, 38, 36, 104, T.cheese);
    c.restore();
    // the rating agency has been
    c.save(); c.translate(166, 420); c.rotate(-0.09);
    c.strokeStyle = T.tomatoDeep; c.lineWidth = 4; c.beginPath(); c.roundRect(-132, -27, 264, 54, 6); c.stroke();
    c.lineWidth = 1.5; c.beginPath(); c.roundRect(-125, -20, 250, 40, 3); c.stroke();
    fitted(c, 'RISQUE NON NOTÉ', 0, 9, 900, HEAVY, 24, 228, T.tomatoDeep, 'center', 1);
    c.restore();
    text(c, 'La part d’hier.', w / 2, 490, `italic 700 34px ${SERIF}`, T.charcoal, 'center');
    text(c, 'Au prix d’avant-hier.', w / 2, 524, `italic 700 26px ${SERIF}`, T.tomato, 'center');
    text(c, 'Aucune garantie. Aucun remboursement. Aucun regret.', w / 2, 548, `600 12.5px ${SANS}`, T.charcoal, 'center');
    c.fillStyle = T.charcoal; c.fillRect(14, 558, w - 28, 28);
    text(c, 'VENDUE EN L’ÉTAT · SANS RECOURS', w / 2, 577, `800 14px ${SANS}`, '#f1dfae', 'center', 3);
  },
  // Five frames for the wall, 180 px each: the regulars, signed, and the year the pie chart hung with them
  photos(c, w, h) {
    const looks = ['fedora', 'bouffant', null, 'toque', 'curls'];
    const woods = [['#3a342f', '#0f0d0c'], ['#8a5f3a', '#3f2814'], ['#dcb95e', '#8d6c24'], ['#b93222', '#5c120b'], ['#3a342f', '#0f0d0c']];
    const names = ['Vinnie, 1974', 'Gloria, 1981', 'Exercice 1987', 'Sal, 1999', 'Le petit Enzo, 2008'];
    for (let i = 0; i < 5; i++) {
      const fw = w / 5, px = 31, py = 36, pw = fw - 62, ph = h - 100;
      c.save(); c.translate(i * fw, 0);
      c.beginPath(); c.rect(0, 0, fw, h); c.clip();
      c.fillStyle = i % 2 ? '#ece3cf' : '#f1e9d8'; c.fillRect(0, 0, fw, h);
      if (looks[i]) {
        const tone = i === 3 ? [226, 218, 200] : [222, 222, 220];
        const g = c.createLinearGradient(0, py, 0, py + ph);
        g.addColorStop(0, `rgb(${tone})`); g.addColorStop(1, `rgb(${tone.map((v) => Math.round(v * 0.52))})`);
        c.fillStyle = g; c.fillRect(px, py, pw, ph);
        c.save(); c.beginPath(); c.rect(px, py, pw, ph); c.clip();
        glow(c, px + pw * 0.5, py + ph * 0.4, pw * 0.7, 'rgba(255,255,255,0.35)', fw, h);
        c.fillStyle = '#1d1b1a'; bust(c, px + pw / 2 + (i % 2 ? 4 : -3), py + ph + 8, ph * 0.86, looks[i]);
        c.fillStyle = 'rgba(255,255,255,0.14)'; c.beginPath(); c.ellipse(px + pw / 2 - 12, py + ph * 0.36, 8, 22, 0.3, 0, Math.PI * 2); c.fill();
        grain(c, px, py, pw, ph, 1100, 0.09, 120 + i);
        c.save(); c.translate(px + pw * 0.2, py + ph * 0.84); c.rotate(-0.14);
        scribble(c, 0, 0, pw * 0.72, 22, 130 + i * 7, 'rgba(250,248,240,0.92)', 2);
        c.restore();
        c.restore();
      } else {
        c.fillStyle = '#fbf8ef'; c.fillRect(px, py, pw, ph);
        pie(c, px + pw / 2 - 6, py + ph * 0.46, pw * 0.36, { cuts: 5, out: 12, start: -1.2, seed: 9 });
        text(c, 'PART DE MARCHÉ', px + pw / 2, py + 22, `800 9.5px ${SANS}`, T.charcoal, 'center', 1.5);
        text(c, '20 %', px + pw - 7, py + ph * 0.22, `700 12px ${SERIF}`, T.tomato, 'right');
        text(c, 'le reste : nous', px + pw / 2, py + ph - 14, `italic 500 11px ${SERIF}`, T.charcoal, 'center');
      }
      c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 1; c.strokeRect(px - 0.5, py - 0.5, pw + 1, ph + 1);
      text(c, names[i], fw / 2, h - 36, `italic 500 12px ${SERIF}`, '#4a4238', 'center');
      // glass
      const s = c.createLinearGradient(0, 0, fw, h); s.addColorStop(0.25, 'rgba(255,255,255,0)'); s.addColorStop(0.45, 'rgba(255,255,255,0.13)'); s.addColorStop(0.6, 'rgba(255,255,255,0)');
      c.fillStyle = s; c.fillRect(0, 0, fw, h);
      moulding(c, 3, 3, fw - 6, h - 6, 13, woods[i][0], woods[i][1]);
      c.fillStyle = '#151311'; c.fillRect(0, 0, fw, 3); c.fillRect(0, h - 3, fw, 3); c.fillRect(0, 0, 3, h); c.fillRect(fw - 3, 0, 3, h);
      c.restore();
    }
  },
  checker(c, w, h) { checks(c, 0, 0, w, h, w / 4, '#fbf6ea', T.tomato); },
  // White subway tiles in running bond; loops both ways
  tiles(c, w, h) {
    c.fillStyle = '#aeaaa0'; c.fillRect(0, 0, w, h);
    const tw = w / 2, th = h / 4, gap = 3;
    for (let row = 0; row < 4; row++) for (let i = -1; i < 3; i++) {
      const x = i * tw + (row % 2) * tw / 2, y = row * th, r = rng(200 + row * 2 + ((i % 2) + 2) % 2);
      const v = 243 + Math.round((r() - 0.5) * 9);
      c.fillStyle = `rgb(${v},${v - 1},${v - 7})`; c.beginPath(); c.roundRect(x + gap / 2, y + gap / 2, tw - gap, th - gap, 2.5); c.fill();
      // the glaze: a bevel all round, and a shine that never sits twice in the same place
      const g = c.createLinearGradient(0, y, 0, y + th);
      g.addColorStop(0, 'rgba(255,255,255,0.75)'); g.addColorStop(0.16, 'rgba(255,255,255,0)'); g.addColorStop(0.84, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(60,55,40,0.16)');
      c.fillStyle = g; c.beginPath(); c.roundRect(x + gap / 2, y + gap / 2, tw - gap, th - gap, 2.5); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.5)'; c.beginPath(); c.ellipse(x + tw * (0.3 + r() * 0.4), y + th * (0.32 + r() * 0.2), tw * (0.2 + r() * 0.12), th * 0.1, (r() - 0.5) * 0.3, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(120,110,90,0.06)'; c.beginPath(); c.ellipse(x + tw * (0.2 + r() * 0.6), y + th * 0.7, tw * 0.2, th * 0.12, 0, 0, Math.PI * 2); c.fill();
    }
  },
  // Behind the glass door: shelves of sodas nobody else sells, in cold light
  fridge(c, w, h) {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#fbfeff'); g.addColorStop(0.12, '#e4eff4'); g.addColorStop(1, '#b3c6d1');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (const side of [0, 1]) { // the walls
      const wg = c.createLinearGradient(side ? w : 0, 0, side ? w - 26 : 26, 0); wg.addColorStop(0, 'rgba(70,95,110,0.55)'); wg.addColorStop(1, 'rgba(70,95,110,0)');
      c.fillStyle = wg; c.fillRect(side ? w - 26 : 0, 0, 26, h);
    }
    glow(c, w / 2, 16, 190, 'rgba(255,255,255,0.9)', w, h);
    c.fillStyle = '#ffffff'; c.beginPath(); c.roundRect(26, 12, w - 52, 9, 4); c.fill();
    const soda = dish('tranche', 'soda'), n = 6, pitch = (w - 44) / n, at = (i) => 22 + pitch * (i + 0.5);
    const shelves = [124, 238, 350, 464, 578];
    const rows = [
      (i, y) => can(c, at(i), y, 35, 66, '#c8281c', '#f7eedc', 'BULLE'),
      (i, y) => i % 2 ? bottle(c, at(i), y, 30, 94, '#f08a1e', '#fff3d6', '#2f7a4a') : bottle(c, at(i), y, 30, 94, '#3a1b0e', '#c8281c', '#d9d9d9'),
      (i, y) => i < 3 ? can(c, at(i), y, 35, 66, '#f2c14e', '#2f7a4a', 'ZESTE') : can(c, at(i), y, 35, 66, '#1e1b19', '#c9ced2', 'TAUX 0'),
      (i, y) => bottle(c, at(i), y, 29, 96, 'rgba(176,216,236,0.95)', '#2f6fb0', '#2f6fb0'),
      (i, y) => i % 3 === 2 ? can(c, at(i), y, 35, 78, '#2f7a4a', '#f7eedc', 'THÉ') : can(c, at(i), y, 35, 78, '#e86f1c', '#fff3d6', 'PÊCHE')
    ];
    shelves.forEach((y, row) => {
      for (let i = 0; i < n; i++) { // a second rank behind, in the shade
        c.save(); c.globalAlpha = 0.55; c.translate(0, -7); rows[row](i, y); c.restore();
      }
      for (let i = 0; i < n; i++) rows[row](i, y);
      // the wire shelf, its lip and the price rail
      c.fillStyle = '#7f8c94'; c.fillRect(8, y, w - 16, 5);
      c.fillStyle = '#dfe7eb'; c.fillRect(8, y, w - 16, 1.5);
      c.fillStyle = '#f7f7f2'; c.fillRect(8, y + 5, w - 16, 12);
      c.fillStyle = 'rgba(40,60,75,0.3)'; c.fillRect(8, y + 17, w - 16, 5);
      for (let i = 0; i < n; i += 2) text(c, money(soda.price), at(i) + pitch / 2, y + 15, `800 9.5px ${SANS}`, T.tomato, 'center');
    });
    // cold on the glass, and what the street reflects in it
    c.save(); c.translate(w * 0.2, 0); c.rotate(0.22);
    for (const [x, bw, a] of [[0, 40, 0.14], [70, 14, 0.1], [170, 60, 0.07]]) { c.fillStyle = `rgba(255,255,255,${a})`; c.fillRect(x, -100, bw, h + 300); }
    c.restore();
    const mist = c.createLinearGradient(0, h - 90, 0, h); mist.addColorStop(0, 'rgba(235,245,250,0)'); mist.addColorStop(1, 'rgba(235,245,250,0.35)');
    c.fillStyle = mist; c.fillRect(0, h - 90, w, 90);
    c.strokeStyle = '#1c2226'; c.lineWidth = 12; c.strokeRect(3, 3, w - 6, h - 6);
    c.strokeStyle = '#aab4ba'; c.lineWidth = 2; c.strokeRect(10, 10, w - 20, h - 20);
  },
  // The small board by the till
  special(c, w, h) {
    const it = dish('tranche', 'junkbond');
    felt(c, 0, 0, w, h, 10);
    letters(c, 'PART DU JOUR', w / 2, 70, 38, { align: 'center', seed: 91, color: RED_LETTER, weight: 800 });
    c.fillStyle = 'rgba(240,80,58,0.8)'; c.fillRect(54, 88, w - 108, 2);
    const size = fit(c, it.name, 700, SANS, 60, w - 110, 5);
    letters(c, it.name, w / 2, 160, size, { align: 'center', seed: 92, tilt: { index: 1, angle: -0.2, drop: 3 } });
    wrap(c, it.note.toUpperCase(), `600 15px ${SANS}`, w - 150).slice(0, 2).forEach((l, i) => letters(c, l, w / 2, 196 + i * 22, 15, { align: 'center', seed: 93 + i, color: '#cbc4b0', weight: 600, spacing: 1.8 }));
    letters(c, money(it.price), w / 2, 276, 46, { align: 'center', seed: 96, color: RED_LETTER, weight: 800 });
    moulding(c, 0, 0, w, h, 15, '#a67c4e', '#5b3d20');
    vignette(c, w, h, 0.2);
  },
  hours(c, w, h) {
    paper(c, w, h, T.cream, 141);
    checks(c, 0, 0, w, 14, 7, '#fffaf0', T.tomato); checks(c, 0, h - 14, w, 14, 7, '#fffaf0', T.tomato);
    text(c, 'OUVERT', w / 2, 50, `800 20px ${SANS}`, T.basil, 'center', 12);
    fitted(c, hoursText('tranche'), w / 2, 106, 700, SERIF, 62, w - 70, T.tomato, 'center', 1);
    text(c, 'On ferme quand le four refroidit.', w / 2, 133, `italic 500 16px ${SERIF}`, T.charcoal, 'center');
  },
  // The card in the service window
  window(c, w, h) {
    const it = dish('tranche', 'margherita');
    paper(c, w, h, '#fbf4e2', 151);
    checks(c, 0, 0, w, 20, 10, '#fffaf0', T.tomato); checks(c, 0, h - 20, w, 20, 10, '#fffaf0', T.tomato);
    star(c, 312, 122, 94, 78, 18, 0.1); c.fillStyle = T.cheese; c.fill();
    star(c, 312, 122, 83, 70, 18, 0.1); c.strokeStyle = T.tomato; c.lineWidth = 2.5; c.stroke();
    bigPrice(c, it.price, 356, 166, 124, T.tomato);
    text(c, 'LA', 34, 108, `700 40px ${SERIF}`, T.charcoal, 'left', 4);
    text(c, 'PART', 30, 174, `700 61px ${SERIF}`, T.tomato, 'left', 1);
    // steam off the slice
    c.strokeStyle = 'rgba(213,49,31,0.45)'; c.lineWidth = 3; c.lineCap = 'round';
    for (const x of [58, 86, 114]) { c.beginPath(); c.moveTo(x, 44); c.bezierCurveTo(x - 9, 52, x + 9, 60, x, 68); c.stroke(); }
    c.lineCap = 'butt';
    c.fillStyle = T.tomato; c.beginPath(); c.roundRect(30, 206, w - 60, 52, 6); c.fill();
    text(c, 'SERVIE CHAUDE', w / 2, 243, `900 31px ${HEAVY}`, T.cream, 'center', 5);
  },
  // The pavement board: honest arithmetic
  sandwich(c, w, h) {
    const part = dish('tranche', 'margherita'), soda = dish('tranche', 'soda');
    const white = 'rgba(244,240,228,0.94)', red = 'rgba(248,120,100,0.98)', yellow = 'rgba(250,214,110,0.98)';
    slate(c, w, h, '#1c2420', 17);
    brandEmblem(c, 'tranche', w / 2, 82, 100, { tone: 'ink', color: white });
    text(c, '2 PARTS', w / 2, 196, `400 58px ${CHALK}`, white, 'center');
    text(c, `+ ${soda.name}`, w / 2, 256, `400 44px ${CHALK}`, yellow, 'center');
    line(c, 86, 276, w - 86, 279, 3, white);
    chalkPrice(c, part.price * 2 + soda.price, w / 2 + 30, 374, 84, red);
    text(c, '=', 50, 364, `400 54px ${CHALK}`, red);
    chalkSlice(c, 54, 466, 54, -0.3, white, red); chalkSlice(c, w - 54, 466, 54, 0.3, white, red);
    text(c, 'Pas de remise :', w / 2, 456, `400 17px ${CHALK}`, white, 'center');
    text(c, 'on sait compter.', w / 2, 482, `400 17px ${CHALK}`, white, 'center');
    text(c, BRANDS.tranche.tagline, w / 2, 552, `400 26px ${CHALK}`, yellow, 'center');
    chalkDust(c, w, h, 9000, '#1c2420', 18);
    moulding(c, 0, 0, w, h, 20, '#c23a28', '#6e1a10');
  },
  // The jar's label
  tips(c, w, h) {
    paper(c, w, h, '#fbf4e2', 161);
    c.strokeStyle = T.tomato; c.lineWidth = 4; c.strokeRect(7, 7, w - 14, h - 14);
    c.strokeStyle = T.basil; c.lineWidth = 1.5; c.strokeRect(13, 13, w - 26, h - 26);
    c.save(); c.translate(w / 2, h / 2); c.rotate(-0.05);
    text(c, 'POURBOIRES', 0, -32, `400 23px ${HAND}`, T.charcoal, 'center', 1);
    text(c, '=', 0, -3, `400 32px ${HAND}`, T.tomato, 'center');
    text(c, 'DIVIDENDES', 0, 27, `400 24px ${HAND}`, T.tomato, 'center', 1);
    c.restore();
    brandEmblem(c, 'tranche', w / 2 + 2, h - 32, 28);
  },
  // White cotton, flour, and the day's first tomato
  apron(c, w, h) {
    cloth(c, w, h, '#e9e4d8', 171, 0.3);
    const r = rng(172);
    for (let i = 0; i < 11; i++) { // flour, wiped on in passing
      const x = r() * w, y = 100 + r() * (h - 110), rad = 16 + r() * 36;
      const g = c.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }
    for (let i = 0; i < 4; i++) { c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.ellipse(70 + i * 9, 206 - Math.abs(i - 1.5) * 5, 3.6, 13, (i - 1.5) * 0.14, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.ellipse(86, 232, 18, 14, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(110, 226, 4, 11, 1, 0, Math.PI * 2); c.fill();
    disc(c, 186, 196, 7, 'rgba(213,49,31,0.5)'); disc(c, 196, 208, 3, 'rgba(213,49,31,0.45)'); disc(c, 178, 211, 2, 'rgba(213,49,31,0.4)');
    brandEmblem(c, 'tranche', w / 2 + 3, 70, 78); brandWordmark(c, 'tranche', w / 2, 130, 19);
    stitches(c, w, h, 'rgba(30,27,25,0.28)');
  },
  cap(c, w, h) {
    cloth(c, w, h, T.tomato, 173);
    c.strokeStyle = 'rgba(247,238,220,0.8)'; c.lineWidth = 2; c.setLineDash([5, 3]); c.beginPath(); c.roundRect(9, 9, w - 18, h - 18, 12); c.stroke(); c.setLineDash([]);
    brandEmblem(c, 'tranche', w / 2 + 4, h / 2 - 3, 88, { tone: 'light' });
  },
  // The maker's plate riveted to the oven
  ovenPlate(c, w, h) {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#e6c36c'); g.addColorStop(0.45, '#c79a3e'); g.addColorStop(1, '#8e6a22');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const r = rng(181);
    for (let i = 0; i < 260; i++) { c.fillStyle = r() < 0.5 ? 'rgba(255,240,190,0.12)' : 'rgba(70,45,5,0.12)'; c.fillRect(r() * w, r() * h, 20 + r() * 70, 1); }
    c.strokeStyle = '#5c4210'; c.lineWidth = 2; c.strokeRect(7, 7, w - 14, h - 14);
    const engraved = (str, y, font, spacing) => { text(c, str, w / 2 + 0.8, y + 1, font, 'rgba(255,240,190,0.55)', 'center', spacing); text(c, str, w / 2, y, font, '#3d2a08', 'center', spacing); };
    engraved('STROMBOLI FRÈRES', 41, `700 ${fit(c, 'STROMBOLI FRÈRES', 700, SERIF, 23, w - 64, 3)}px ${SERIF}`, 3);
    engraved('FOURS À SOLE · BROOKLYN, N.Y.', 63, `700 11px ${SANS}`, 2.4);
    engraved('MODÈLE 29 · N° 2008 · 480 °C', 86, `700 11px ${SANS}`, 2.4);
    for (const [x, y] of [[17, 17], [w - 17, 17], [17, h - 17], [w - 17, h - 17]]) {
      disc(c, x, y, 5.5, '#6d5116'); disc(c, x - 0.8, y - 0.8, 4, '#d9b85e');
      line(c, x - 3, y + 2, x + 3, y - 2, 1.3, '#5c4210');
    }
  },
  // The insulated delivery bag's face
  bag(c, w, h) {
    const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#e03a26'); g.addColorStop(1, '#b02416');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(90,10,4,0.28)'; c.lineWidth = 1.5; // quilting
    for (let i = -h; i < w + h; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.moveTo(i + h, 0); c.lineTo(i, h); c.stroke(); }
    c.strokeStyle = 'rgba(255,200,180,0.16)'; c.lineWidth = 1;
    for (let i = -h; i < w + h; i += 32) { c.beginPath(); c.moveTo(i + 1.5, 0); c.lineTo(i + h + 1.5, h); c.stroke(); }
    c.fillStyle = T.tomato; c.beginPath(); c.roundRect(34, 40, w - 68, 150, 10); c.fill();
    c.strokeStyle = T.cream; c.lineWidth = 2; c.setLineDash([6, 4]); c.beginPath(); c.roundRect(40, 46, w - 80, 138, 7); c.stroke(); c.setLineDash([]);
    brandEmblem(c, 'tranche', w / 2 + 5, 96, 92, { tone: 'light' });
    brandWordmark(c, 'tranche', w / 2, 160, 24, { tone: 'light' });
    c.fillStyle = '#c9ced2'; c.fillRect(0, h - 44, w, 22);
    for (let x = 0; x < w; x += 10) { c.fillStyle = x % 20 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.08)'; c.fillRect(x, h - 44, 10, 22); }
    text(c, 'LIVRAISON CHAUDE', w / 2, h - 9, `800 11px ${SANS}`, T.cream, 'center', 4);
    c.strokeStyle = '#1e1b19'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
  },
  staff(c, w, h) {
    plate(c, w, h, T.cream, T.tomato);
    text(c, 'PERSONNEL', w / 2, 46, `900 30px ${HEAVY}`, T.tomato, 'center', 3);
    text(c, 'SEULEMENT', w / 2, 74, `800 17px ${SANS}`, T.charcoal, 'center', 8);
  },
  exit(c, w, h) { exitSign(c, w, h); },
  wetFloor(c, w, h) { wetFloorSign(c, w, h, 'ATTERRISSAGE BRUTAL POSSIBLE', 'TRANCHE'); },
  // extras -------------------------------------------------------------
  // A vertical sign for the corner of the building, as every slice joint hangs one
  banner(c, w, h) {
    const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#b92616'); g.addColorStop(0.4, '#e03a26'); g.addColorStop(1, '#a82012');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    checks(c, 0, 0, w, 26, 13, '#fffaf0', T.tomato); checks(c, 0, h - 26, w, 26, 13, '#fffaf0', T.tomato);
    c.fillStyle = T.tomatoDeep; c.fillRect(0, 26, w, 3); c.fillRect(0, h - 29, w, 3);
    brandEmblem(c, 'tranche', w / 2 + 3, 76, 74, { tone: 'light' });
    c.save(); c.shadowColor = 'rgba(90,10,4,0.7)'; c.shadowOffsetX = 2; c.shadowOffsetY = 3; c.shadowBlur = 0;
    [...'PIZZA'].forEach((ch, i) => text(c, ch, w / 2, 196 + i * 84, `700 82px ${SERIF}`, T.cream, 'center'));
    c.restore();
    grain(c, 0, 0, w, h, 500, 0.03, 82);
  },
  // Taped by the till
  cashOnly(c, w, h) {
    paper(c, w, h, '#fbf4e2', 195);
    c.strokeStyle = T.charcoal; c.lineWidth = 3; c.strokeRect(5, 5, w - 10, h - 10);
    text(c, 'ESPÈCES SEULEMENT', w / 2, 44, `900 ${fit(c, 'ESPÈCES SEULEMENT', 900, HEAVY, 24, w - 30, 1)}px ${HEAVY}`, T.tomato, 'center', 1);
    text(c, 'Pas de crédit.', w / 2, 66, `italic 700 15px ${SERIF}`, T.charcoal, 'center');
    text(c, 'Même noté AAA.', w / 2, 83, `italic 700 13px ${SERIF}`, T.charcoal, 'center');
    for (const x of [14, w - 34]) { c.fillStyle = 'rgba(214,200,150,0.75)'; c.save(); c.translate(x, 3); c.rotate(x < 100 ? -0.3 : 0.3); c.fillRect(0, 0, 22, 9); c.restore(); }
  },
  // The lid of the box a whole pie leaves in
  boxLid(c, w, h) {
    paper(c, w, h, '#f6f1e4', 191);
    const ink = T.tomato;
    checks(c, 12, 12, w - 24, 16, 8, '#f6f1e4', ink); checks(c, 12, h - 28, w - 24, 16, 8, '#f6f1e4', ink);
    c.strokeStyle = ink; c.lineWidth = 2; c.strokeRect(12, 12, w - 24, h - 24);
    brandEmblem(c, 'tranche', w / 2 + 8, 112, 132, { tone: 'ink', color: ink });
    brandWordmark(c, 'tranche', w / 2, 204, 34, { tone: 'ink', color: ink });
    text(c, BRANDS.tranche.tagline, w / 2, 240, `italic 600 19px ${SERIF}`, ink, 'center');
    text(c, 'QUATRE PARTS · AUCUNE OBLIGATION DE PARTAGE', w / 2, 262, `800 8.6px ${SANS}`, ink, 'center', 1.2);
    // the cardboard's folds and a first ring of grease
    c.strokeStyle = 'rgba(120,100,60,0.25)'; c.lineWidth = 1; c.strokeRect(5.5, 5.5, w - 11, h - 11);
    disc(c, 246, 232, 16, 'rgba(170,130,60,0.12)'); disc(c, 60, 66, 9, 'rgba(170,130,60,0.1)');
  }
};

// ---------- the sheets ----------

const PAINTERS = { bullion, tranche };

/** Paints one print of `brand` into its rectangle of the sheet (clipped: nothing leaks into its neighbours). */
function paintPrint(c, brand, name) {
  const [x, y, w, h] = LAYOUT[brand][name], painter = PAINTERS[brand][name];
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.translate(x, y);
  c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.letterSpacing = '0px'; c.globalAlpha = 1;
  if (painter) painter(c, w, h);
  c.restore();
}

/** Paints the whole 2048 x 2048 sheet of `brand` ('bullion' or 'tranche') into a 2D context. */
function paintPrints(c, brand) {
  c.clearRect(0, 0, SIZE, SIZE);
  for (const name of Object.keys(LAYOUT[brand])) paintPrint(c, brand, name);
}

export { PRINTS, LAYOUT as PRINT_LAYOUT, ALPHA as PRINT_ALPHA, SIZE as PRINT_SIZE, paintPrints, paintPrint };
