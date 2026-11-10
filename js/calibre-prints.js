// CALIBRE's printed matter: the fascia, the neon tubes, posters, ammunition labels, range signs and the paper targets,
// drawn once at load into one sheet. Original graphics and slogans; the brand's colours are bottle green, brass and
// brick red. `PRINTS[name]` = [u0, v0, u1, v1] on the sheet (v down, as canvas rows).

const SIZE = 2048;
const GREEN = '#16261f', GREEN_2 = '#22382f', BRASS = '#d9b36a', CREAM = '#efe4c6', RED = '#b5452b', INK = '#141a17', PAPER = '#e9dfc4';
const SANS = '"Helvetica Neue", "Arial Narrow", Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

// name -> [x, y, w, h] in pixels
const LAYOUT = {
  fascia: [0, 0, 2048, 192],
  neon: [0, 200, 1024, 280],
  open: [1032, 200, 480, 200],
  toRange: [1520, 200, 520, 200],
  hours: [1032, 408, 480, 72],
  staff: [1520, 408, 256, 72],
  exit: [1784, 408, 256, 72],
  posterCalm: [0, 488, 420, 600],
  posterCover: [428, 488, 420, 600],
  posterYield: [856, 488, 420, 600],
  posterRules: [1284, 488, 420, 600],
  target: [1712, 488, 328, 600],
  ammo9: [0, 1096, 256, 144], ammo12: [264, 1096, 256, 144], ammo556: [528, 1096, 256, 144], ammo45: [792, 1096, 256, 144],
  crate: [1056, 1096, 320, 144],
  licence: [1384, 1096, 320, 232],
  clock: [1712, 1096, 232, 232],
  stripMunitions: [0, 1248, 1024, 80], stripProtection: [0, 1336, 1024, 80], stripAccessoires: [0, 1424, 1024, 80], stripAtelier: [0, 1512, 1024, 80],
  lane1: [1032, 1336, 160, 160], lane2: [1200, 1336, 160, 160], lane3: [1368, 1336, 160, 160], lane4: [1536, 1336, 160, 160],
  hazard: [0, 1600, 1024, 48],
  tag: [1032, 1504, 200, 96],
  screen: [1240, 1504, 320, 200],
  ceasefire: [1568, 1504, 472, 136],
  cameras: [1712, 1336, 328, 160],
  mat: [0, 1656, 720, 380],
  blackboard: [728, 1712, 560, 324],
  medals: [1296, 1712, 744, 324]
};

const PRINTS = {};
for (const [name, [x, y, w, h]] of Object.entries(LAYOUT)) PRINTS[name] = [x / SIZE, y / SIZE, (x + w) / SIZE, (y + h) / SIZE];

function spaced(c, text, x, y, spacing = 0) {
  c.letterSpacing = `${spacing}px`;
  c.fillText(text, x + spacing / 2, y);
  c.letterSpacing = '0px';
}
function fit(c, text, weight, family, size, width, spacing = 0) {
  for (let s = size; s > 8; s -= 2) {
    c.font = `${weight} ${s}px ${family}`;
    c.letterSpacing = `${spacing}px`;
    const w = c.measureText(text).width;
    c.letterSpacing = '0px';
    if (w <= width) return s;
  }
  return 8;
}
// the house roundel: three rings and a dot, the target the brand is named after
function roundel(c, x, y, r, color = RED, width = r * 0.11) {
  c.strokeStyle = color; c.lineWidth = width;
  for (const k of [1, 0.66, 0.34]) { c.beginPath(); c.arc(x, y, r * k, 0, Math.PI * 2); c.stroke(); }
  c.fillStyle = color; c.beginPath(); c.arc(x, y, r * 0.09, 0, Math.PI * 2); c.fill();
}
function grain(c, x, y, w, h, n, alpha = 0.05) {
  for (let i = 0; i < n; i++) {
    const px = x + ((i * 97.13) % 1) * w + (i * 13.7) % w, py = y + (i * 57.31) % h;
    c.fillStyle = i % 2 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 0.7})`;
    c.fillRect(px % (x + w), py, 1 + i % 3, 1);
  }
}
// the outline of a head and shoulders, for the range targets and the posters
function silhouette(c, cx, top, h) {
  const w = h * 0.52;
  c.beginPath();
  c.ellipse(cx, top + h * 0.115, h * 0.085, h * 0.105, 0, 0, Math.PI * 2);
  c.moveTo(cx - h * 0.05, top + h * 0.2);
  c.bezierCurveTo(cx - w * 0.2, top + h * 0.25, cx - w * 0.5, top + h * 0.25, cx - w * 0.5, top + h * 0.42);
  c.lineTo(cx - w * 0.5, top + h);
  c.lineTo(cx + w * 0.5, top + h);
  c.lineTo(cx + w * 0.5, top + h * 0.42);
  c.bezierCurveTo(cx + w * 0.5, top + h * 0.25, cx + w * 0.2, top + h * 0.25, cx + h * 0.05, top + h * 0.2);
  c.closePath();
}

function poster(c, [x, y, w, h], { light = true, kicker, title, lines, foot, art }) {
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = light ? PAPER : GREEN; c.fillRect(x, y, w, h);
  grain(c, x, y, w, h, 900, 0.035);
  c.strokeStyle = light ? '#8d8368' : '#3d5247'; c.lineWidth = 3; c.strokeRect(x + 14, y + 14, w - 28, h - 28);
  c.textAlign = 'center';
  c.fillStyle = light ? INK : BRASS;
  c.font = `700 17px ${SANS}`; spaced(c, kicker, x + w / 2, y + 52, 5);
  art?.(c, x + w / 2, y + 86, h * 0.44);
  c.fillStyle = light ? INK : CREAM;
  let ty = y + h * 0.66;
  for (const line of title) {
    const s = fit(c, line, 900, SANS, 58, w - 64, 1);
    c.font = `900 ${s}px ${SANS}`; spaced(c, line, x + w / 2, ty, 1); ty += s * 1.02;
  }
  c.fillStyle = light ? '#3b4640' : '#c9c2a8'; c.font = `500 19px ${SERIF}`;
  for (const line of lines || []) { c.fillText(line, x + w / 2, ty + 10); ty += 26; }
  c.fillStyle = RED; c.fillRect(x + 14, y + h - 62, w - 28, 48);
  c.fillStyle = CREAM; c.font = `800 18px ${SANS}`; spaced(c, foot, x + w / 2, y + h - 31, 4);
  c.restore();
}

function ammoLabel(c, [x, y, w, h], calibre, count, band, name) {
  c.fillStyle = '#d8ccab'; c.fillRect(x, y, w, h);
  c.fillStyle = band; c.fillRect(x, y, w, 40); c.fillRect(x, y + h - 14, w, 14);
  c.fillStyle = CREAM; c.textAlign = 'left'; c.font = `900 22px ${SANS}`; spaced(c, 'CALIBRE', x + 14, y + 28, 4);
  roundel(c, x + w - 26, y + 20, 13, CREAM, 2.5);
  c.fillStyle = INK; c.font = `900 ${fit(c, calibre, 900, SANS, 50, w - 28)}px ${SANS}`; c.fillText(calibre, x + 14, y + 92);
  c.font = `600 15px ${SANS}`; spaced(c, name, x + 14, y + 116, 2);
  c.textAlign = 'right'; c.font = `800 18px ${SANS}`; c.fillText(count, x + w - 14, y + 116);
}

function strip(c, [x, y, w, h], text, sub) {
  c.fillStyle = GREEN; c.fillRect(x, y, w, h);
  c.fillStyle = RED; c.fillRect(x, y + h - 7, w, 7);
  c.fillStyle = BRASS; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.font = `900 46px ${SANS}`; spaced(c, text, x + 26, y + h / 2 - 2, 9);
  c.fillStyle = '#b9b294'; c.textAlign = 'right'; c.font = `600 18px ${SANS}`; spaced(c, sub, x + w - 30, y + h / 2 - 2, 4);
  c.textBaseline = 'alphabetic';
}

// Glass tubes: a wide soft halo, the coloured tube, its white-hot core
function neonText(c, text, x, y, font, color, spacing = 0) {
  c.font = font; c.textAlign = 'center'; c.lineJoin = 'round'; c.lineCap = 'round';
  const draw = (width, style, blur) => {
    c.shadowColor = color; c.shadowBlur = blur; c.strokeStyle = style; c.lineWidth = width;
    c.letterSpacing = `${spacing}px`; c.strokeText(text, x + spacing / 2, y); c.letterSpacing = '0px';
  };
  draw(11, color, 26); draw(7, color, 8);
  c.shadowBlur = 0; draw(1.6, '#ffe9cf', 0);
}

function paintPrints(c) {
  const R = (name) => LAYOUT[name];
  c.clearRect(0, 0, SIZE, SIZE);
  c.textBaseline = 'alphabetic';

  { // The fascia over the street: brass capitals on bottle green, a red rule under them
    const [x, y, w, h] = R('fascia');
    c.fillStyle = GREEN; c.fillRect(x, y, w, h);
    grain(c, x, y, w, h, 2400, 0.03);
    c.fillStyle = RED; c.fillRect(x, y + h - 12, w, 12);
    c.strokeStyle = '#6b5a33'; c.lineWidth = 2; c.strokeRect(x + 10, y + 10, w - 20, h - 34);
    c.textAlign = 'center';
    const grad = c.createLinearGradient(0, y + 28, 0, y + 130);
    grad.addColorStop(0, '#f3dc9c'); grad.addColorStop(0.5, BRASS); grad.addColorStop(1, '#9b7b3a');
    c.fillStyle = grad; c.font = `900 118px ${SANS}`; spaced(c, 'CALIBRE', x + w / 2, y + 124, 44);
    roundel(c, x + w / 2 - 470, y + 84, 44, BRASS, 5); roundel(c, x + w / 2 + 470, y + 84, 44, BRASS, 5);
    c.fillStyle = '#cfc5a6'; c.font = `700 21px ${SANS}`;
    c.textAlign = 'left'; spaced(c, 'ARMURERIE  ·  MUNITIONS', x + 60, y + 92, 6);
    c.textAlign = 'right'; spaced(c, 'STAND DE TIR  ·  DEPUIS 1978', x + w - 66, y + 92, 6);
    c.textAlign = 'center'; c.font = `600 17px ${SANS}`; spaced(c, 'LE SANG-FROID NE S’ACHÈTE PAS. LE RESTE, SI.', x + w / 2, y + 160, 7);
  }
  { // neon, cut out by alpha
    const [x, y, w, h] = R('neon');
    neonText(c, 'Calibre', x + w / 2, y + 150, `italic 700 150px ${SERIF}`, '#ffb14a', 6);
    c.shadowColor = '#ff5a3c'; c.shadowBlur = 18; c.strokeStyle = '#ff6a4a'; c.lineWidth = 6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x + 150, y + 205); c.lineTo(x + w - 150, y + 205); c.stroke();
    c.shadowBlur = 0; c.strokeStyle = '#fff1ea'; c.lineWidth = 2; c.stroke();
    neonText(c, 'ARMURERIE  ·  STAND DE TIR', x + w / 2, y + 256, `700 34px ${SANS}`, '#ff6a4a', 9);
  }
  {
    const [x, y, w, h] = R('open');
    neonText(c, 'OUVERT', x + w / 2, y + 112, `800 96px ${SANS}`, '#59e0a4', 12);
    neonText(c, '24 H / 24', x + w / 2, y + 174, `700 40px ${SANS}`, '#ffb14a', 8);
  }
  {
    const [x, y, w, h] = R('toRange');
    c.fillStyle = '#0d1512'; c.fillRect(x, y, w, h);
    c.strokeStyle = BRASS; c.lineWidth = 4; c.strokeRect(x + 8, y + 8, w - 16, h - 16);
    c.fillStyle = '#ffd9a0'; c.textAlign = 'center';
    c.font = `900 ${fit(c, 'STAND DE TIR', 900, SANS, 64, w - 70, 6)}px ${SANS}`; spaced(c, 'STAND DE TIR', x + w / 2, y + 96, 6);
    c.fillStyle = '#ff7a55'; c.font = `700 ${fit(c, 'QUATRE PAS · MUNITIONS OFFERTES', 700, SANS, 26, w - 70, 3)}px ${SANS}`; spaced(c, 'QUATRE PAS · MUNITIONS OFFERTES', x + w / 2, y + 148, 3);
  }
  {
    const [x, y, w, h] = R('hours');
    c.fillStyle = PAPER; c.fillRect(x, y, w, h);
    c.fillStyle = INK; c.textAlign = 'center'; c.font = `800 26px ${SANS}`; spaced(c, 'SERVICE CONTINU · 7 J / 7', x + w / 2, y + 34, 4);
    c.font = `500 17px ${SERIF}`; c.fillText('On ne ferme que pour recompter.', x + w / 2, y + 58);
  }
  for (const [name, text] of [['staff', 'PERSONNEL'], ['exit', 'SORTIE']]) {
    const [x, y, w, h] = R(name);
    c.fillStyle = name === 'exit' ? '#1f6b47' : GREEN_2; c.fillRect(x, y, w, h);
    c.fillStyle = CREAM; c.textAlign = 'center'; c.font = `800 34px ${SANS}`; spaced(c, text, x + w / 2, y + 48, 6);
  }
  poster(c, R('posterCalm'), { kicker: 'CALIBRE · DEPUIS 1978', title: ['GARDEZ', 'VOTRE CALME.'], lines: ['Nous avons déjà les arguments.'], foot: 'ARMES · MUNITIONS · PROTECTION',
    art: (c, cx, top, h) => roundel(c, cx, top + h / 2, h * 0.46) });
  poster(c, R('posterCover'), { light: false, kicker: 'PROTECTION CALIBRE', title: ['COUVREZ', 'VOS POSITIONS.'], lines: ['Gilets niveau IIIA. Essayage au comptoir.'], foot: 'RIEN N’EST GARANTI. SAUF NOS GILETS.',
    art: (c, cx, top, h) => { // a plate carrier, front view
      c.fillStyle = '#51614a'; c.beginPath();
      const w = h * 0.62, y0 = top + h * 0.08;
      c.moveTo(cx - w * 0.28, y0); c.lineTo(cx - w * 0.5, y0 + h * 0.2); c.lineTo(cx - w * 0.5, y0 + h * 0.82); c.lineTo(cx + w * 0.5, y0 + h * 0.82);
      c.lineTo(cx + w * 0.5, y0 + h * 0.2); c.lineTo(cx + w * 0.28, y0); c.quadraticCurveTo(cx, y0 + h * 0.16, cx - w * 0.28, y0); c.fill();
      c.fillStyle = '#3e4b3a'; for (let i = 0; i < 3; i++) c.fillRect(cx - w * 0.42 + i * w * 0.29, y0 + h * 0.46, w * 0.25, h * 0.3);
      c.fillStyle = '#2c362b'; for (let i = 0; i < 5; i++) c.fillRect(cx - w * 0.44, y0 + h * 0.22 + i * h * 0.045, w * 0.88, h * 0.012);
    } });
  poster(c, R('posterYield'), { kicker: 'LE CONSEIL DE LA MAISON', title: ['RENDEMENT', 'IMMÉDIAT.'], lines: ['12 coups. 0 frais de dossier.', 'Calypso 9, la valeur refuge.'], foot: 'PLACEMENT GARANTI À 25 MÈTRES',
    art: (c, cx, top, h) => { // a rising chart that ends in a bullet hole
      c.strokeStyle = '#b9ad8c'; c.lineWidth = 2;
      for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(cx - h * 0.42, top + h * (0.1 + i * 0.19)); c.lineTo(cx + h * 0.42, top + h * (0.1 + i * 0.19)); c.stroke(); }
      c.strokeStyle = RED; c.lineWidth = 9; c.lineJoin = 'round'; c.beginPath();
      [[-0.42, 0.82], [-0.22, 0.6], [-0.08, 0.7], [0.1, 0.42], [0.22, 0.5], [0.36, 0.16]].forEach(([px, py], i) => c[i ? 'lineTo' : 'moveTo'](cx + h * px, top + h * py)); c.stroke();
      c.fillStyle = INK; c.beginPath(); c.arc(cx + h * 0.36, top + h * 0.16, 13, 0, Math.PI * 2); c.fill();
      c.strokeStyle = INK; c.lineWidth = 2; for (let i = 0; i < 7; i++) { const a = i * 0.9; c.beginPath(); c.moveTo(cx + h * 0.36 + Math.cos(a) * 15, top + h * 0.16 + Math.sin(a) * 15); c.lineTo(cx + h * 0.36 + Math.cos(a) * (24 + i % 3 * 6), top + h * 0.16 + Math.sin(a) * (24 + i % 3 * 6)); c.stroke(); }
    } });
  { // range rules
    const [x, y, w, h] = R('posterRules');
    c.fillStyle = '#e7e0cc'; c.fillRect(x, y, w, h);
    c.fillStyle = RED; c.fillRect(x, y, w, 86);
    c.fillStyle = CREAM; c.textAlign = 'center'; c.font = `900 44px ${SANS}`; spaced(c, 'RÈGLES DU STAND', x + w / 2, y + 58, 3);
    c.fillStyle = INK; c.textAlign = 'left';
    const rules = ['L’arme pointe vers les cibles.', 'Le doigt hors de la détente', 'jusqu’au moment de tirer.', 'Un tireur par pas de tir.', 'Protections auditives', 'conseillées. Vraiment.', 'On ne vise pas le personnel.', 'Le personnel vise mieux.'];
    let ty = y + 140, n = 1;
    for (let i = 0; i < rules.length; i++) {
      const first = i === 0 || i === 1 || i === 3 || i === 4 || i === 6 || i === 7;
      const numbered = [0, 1, 3, 4, 6].includes(i);
      if (numbered) { c.fillStyle = RED; c.font = `900 34px ${SANS}`; c.fillText(String(n++), x + 30, ty + 4); }
      c.fillStyle = INK; c.font = `${first && numbered ? 700 : 500} 23px ${SANS}`; c.fillText(rules[i], x + 72, ty);
      ty += numbered && [1, 4].includes(i) ? 34 : rules[i + 1] && [2, 5].includes(i + 1) ? 34 : 52;
    }
    c.fillStyle = '#5a6158'; c.font = `600 15px ${SANS}`; c.textAlign = 'center'; spaced(c, 'CALIBRE · STAND DE TIR · CESSEZ LE FEU AU SIGNAL', x + w / 2, y + h - 24, 2);
  }
  { // the paper target: a grey silhouette with scoring rings, numbered
    const [x, y, w, h] = R('target');
    c.fillStyle = '#e6dcc0'; c.fillRect(x, y, w, h);
    grain(c, x, y, w, h, 700, 0.03);
    c.fillStyle = '#39413d'; silhouette(c, x + w / 2, y + 46, h * 0.82); c.fill();
    const cx = x + w / 2, cy = y + h * 0.5;
    c.strokeStyle = '#e6dcc0'; c.lineWidth = 2.5;
    for (const [rx, ry] of [[106, 150], [74, 106], [44, 64], [18, 26]]) { c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.ellipse(cx, y + 46 + h * 0.82 * 0.115, 24, 30, 0, 0, Math.PI * 2); c.stroke();
    c.fillStyle = RED; c.beginPath(); c.ellipse(cx, cy, 7, 9, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e6dcc0'; c.font = `700 15px ${SANS}`; c.textAlign = 'center';
    ['7', '8', '9'].forEach((t, i) => c.fillText(t, cx + [90, 59, 31][i], cy + 5));
    c.fillStyle = INK; c.font = `800 15px ${SANS}`; c.textAlign = 'left'; spaced(c, 'CALIBRE · CIBLE C-25', x + 12, y + 24, 2);
    c.textAlign = 'right'; c.fillText('N° ____', x + w - 12, y + 24);
  }
  ammoLabel(c, R('ammo9'), '9 MM', '× 50', RED, 'PARABELLUM · FMJ');
  ammoLabel(c, R('ammo12'), 'CAL. 12', '× 25', '#2f5a45', 'CHEVROTINE 00');
  ammoLabel(c, R('ammo556'), '5,56', '× 30', '#3b4d68', 'OTAN · 62 GR');
  ammoLabel(c, R('ammo45'), '4,6 MM', '× 40', '#8a6a2c', 'HAUTE VITESSE');
  { // stencil for crates
    const [x, y, w, h] = R('crate');
    c.fillStyle = '#5c6048'; c.fillRect(x, y, w, h);
    c.fillStyle = '#e8dfc2'; c.textAlign = 'center'; c.font = `900 40px ${SANS}`; spaced(c, 'CALIBRE', x + w / 2, y + 58, 10);
    c.font = `700 20px ${SANS}`; spaced(c, 'MUNITIONS · LOT 78', x + w / 2, y + 92, 4);
    c.font = `600 15px ${SANS}`; spaced(c, 'CRAINT L’HUMIDITÉ ET LES IMPATIENTS', x + w / 2, y + 120, 2);
  }
  { // the framed licence behind the counter
    const [x, y, w, h] = R('licence');
    c.fillStyle = '#f1ead6'; c.fillRect(x, y, w, h);
    c.strokeStyle = '#8a7a52'; c.lineWidth = 3; c.strokeRect(x + 10, y + 10, w - 20, h - 20); c.lineWidth = 1; c.strokeRect(x + 16, y + 16, w - 32, h - 32);
    c.fillStyle = INK; c.textAlign = 'center'; c.font = `700 22px ${SERIF}`; c.fillText('Licence d’armurier', x + w / 2, y + 56);
    c.font = `500 13px ${SERIF}`; c.fillText('État de New York · Classe III', x + w / 2, y + 78);
    c.strokeStyle = '#3d4541'; c.lineWidth = 1; for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(x + 44, y + 104 + i * 15); c.lineTo(x + w - 44 - (i === 4 ? 80 : 0), y + 104 + i * 15); c.stroke(); }
    roundel(c, x + w - 62, y + h - 56, 22, RED, 3);
    c.font = `italic 500 20px ${SERIF}`; c.fillStyle = '#2a3a5c'; c.textAlign = 'left'; c.fillText('E. Vasseur', x + 44, y + h - 42);
  }
  { // wall clock
    const [x, y, w, h] = R('clock'), cx = x + w / 2, cy = y + h / 2, r = w / 2 - 6;
    c.fillStyle = '#1b1f1c'; c.beginPath(); c.arc(cx, cy, r + 4, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#efe7d0'; c.beginPath(); c.arc(cx, cy, r - 8, 0, Math.PI * 2); c.fill();
    c.strokeStyle = INK;
    for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2; c.lineWidth = i % 5 ? 1.5 : 4; const r0 = r - (i % 5 ? 20 : 28); c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)); c.stroke(); }
    c.lineCap = 'round'; c.lineWidth = 6; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx - 36, cy - 42); c.stroke();
    c.lineWidth = 4; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + 62, cy - 30); c.stroke(); c.lineCap = 'butt';
    c.fillStyle = RED; c.beginPath(); c.arc(cx, cy, 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = INK; c.font = `800 12px ${SANS}`; c.textAlign = 'center'; spaced(c, 'CALIBRE', cx, cy + 46, 3);
  }
  strip(c, R('stripMunitions'), 'MUNITIONS', '9 MM · CAL. 12 · 5,56 · 4,6');
  strip(c, R('stripProtection'), 'PROTECTION', 'GILETS · CASQUES · BAGAGERIE');
  strip(c, R('stripAccessoires'), 'ACCESSOIRES', 'OPTIQUES · SILENCIEUX · CHARGEURS');
  strip(c, R('stripAtelier'), 'ATELIER', 'MONTAGE · RÉGLAGE · FINITIONS');
  for (let i = 1; i <= 4; i++) {
    const [x, y, w, h] = R(`lane${i}`);
    c.fillStyle = '#1a1f1c'; c.fillRect(x, y, w, h);
    c.strokeStyle = '#d6b25e'; c.lineWidth = 6; c.strokeRect(x + 8, y + 8, w - 16, h - 16);
    c.fillStyle = '#f1d489'; c.textAlign = 'center'; c.font = `900 118px ${SANS}`; c.fillText(String(i), x + w / 2, y + 122);
  }
  { // hazard tape
    const [x, y, w, h] = R('hazard');
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.fillStyle = '#d9a514'; c.fillRect(x, y, w, h);
    c.fillStyle = '#161616'; for (let i = -2; i < w / 48 + 2; i++) { c.beginPath(); c.moveTo(x + i * 48, y + h); c.lineTo(x + i * 48 + 24, y + h); c.lineTo(x + i * 48 + 24 + h, y); c.lineTo(x + i * 48 + h, y); c.fill(); }
    grain(c, x, y, w, h, 500, 0.06); c.restore();
  }
  { // price tag
    const [x, y, w, h] = R('tag');
    c.fillStyle = '#f0e8d2'; c.fillRect(x, y, w, h);
    c.fillStyle = RED; c.fillRect(x, y, w, 16);
    c.fillStyle = INK; c.textAlign = 'center'; c.font = `900 15px ${SANS}`; spaced(c, 'CALIBRE', x + w / 2, y + 40, 4);
    c.strokeStyle = '#59605a'; c.lineWidth = 2; for (let i = 0; i < 2; i++) { c.beginPath(); c.moveTo(x + 26, y + 58 + i * 16); c.lineTo(x + w - 26, y + 58 + i * 16); c.stroke(); }
  }
  { // the till's screen
    const [x, y, w, h] = R('screen');
    c.fillStyle = '#08130f'; c.fillRect(x, y, w, h);
    c.fillStyle = '#6ff0b0'; c.textAlign = 'left'; c.font = `700 26px Menlo, Consolas, monospace`; c.fillText('CALIBRE · CAISSE 01', x + 18, y + 44);
    c.font = `500 19px Menlo, Consolas, monospace`; c.fillStyle = '#42b384';
    ['> prêt', '> stock : à jour', '> stand : 4 pas libres'].forEach((t, i) => c.fillText(t, x + 18, y + 86 + i * 30));
    c.fillStyle = '#6ff0b0'; c.fillRect(x + 18, y + h - 34, 14, 20);
  }
  {
    const [x, y, w, h] = R('ceasefire');
    c.fillStyle = '#1a0e0b'; c.fillRect(x, y, w, h);
    c.strokeStyle = '#6a1f14'; c.lineWidth = 4; c.strokeRect(x + 6, y + 6, w - 12, h - 12);
    c.fillStyle = '#ff5136'; c.textAlign = 'center'; c.font = `900 ${fit(c, 'TIR EN COURS', 900, SANS, 60, w - 60, 6)}px ${SANS}`; spaced(c, 'TIR EN COURS', x + w / 2, y + 88, 6);
  }
  {
    const [x, y, w, h] = R('cameras');
    c.fillStyle = '#e9c63a'; c.fillRect(x, y, w, h);
    c.strokeStyle = INK; c.lineWidth = 5; c.strokeRect(x + 8, y + 8, w - 16, h - 16);
    c.fillStyle = INK; c.textAlign = 'center'; c.font = `900 34px ${SANS}`; spaced(c, 'SOURIEZ', x + w / 2, y + 62, 6);
    c.font = `700 19px ${SANS}`; c.fillText('Vous êtes filmé. Lui est armé.', x + w / 2, y + 100);
    c.font = `600 14px ${SANS}`; spaced(c, 'VIDÉOSURVEILLANCE 24 H / 24', x + w / 2, y + 130, 2);
  }
  { // the counter's presentation mat: dark felt, the roundel, a brass rule
    const [x, y, w, h] = R('mat');
    c.fillStyle = '#10201a'; c.fillRect(x, y, w, h);
    grain(c, x, y, w, h, 5200, 0.05);
    c.strokeStyle = '#8f7740'; c.lineWidth = 4; c.strokeRect(x + 18, y + 18, w - 36, h - 36);
    roundel(c, x + w - 96, y + h - 92, 44, '#8f7740', 4);
    c.fillStyle = '#8f7740'; c.textAlign = 'left'; c.font = `800 22px ${SANS}`; spaced(c, 'CALIBRE', x + 42, y + h - 44, 9);
  }
  { // the chalkboard of the day
    const [x, y, w, h] = R('blackboard');
    c.fillStyle = '#1d2421'; c.fillRect(x, y, w, h);
    c.strokeStyle = '#6a4f2e'; c.lineWidth = 12; c.strokeRect(x + 6, y + 6, w - 12, h - 12);
    c.fillStyle = '#e9e4d3'; c.textAlign = 'left'; c.font = `italic 600 34px ${SERIF}`; c.fillText('Cours du jour', x + 36, y + 66);
    c.font = `500 25px ${SERIF}`;
    [['Plomb', '▲ stable'], ['Laiton', '▲ en hausse'], ['Sang-froid', '▼ introuvable'], ['Conseils', 'gratuits']].forEach(([a, b], i) => {
      c.textAlign = 'left'; c.fillStyle = '#e9e4d3'; c.fillText(a, x + 40, y + 122 + i * 46);
      c.textAlign = 'right'; c.fillStyle = i === 2 ? '#f08a70' : '#a8e0b8'; c.fillText(b, x + w - 40, y + 122 + i * 46);
    });
  }
  { // the range's roll of honour
    const [x, y, w, h] = R('medals');
    c.fillStyle = GREEN; c.fillRect(x, y, w, h);
    c.strokeStyle = BRASS; c.lineWidth = 3; c.strokeRect(x + 12, y + 12, w - 24, h - 24);
    c.fillStyle = BRASS; c.textAlign = 'center'; c.font = `900 40px ${SANS}`; spaced(c, 'TABLEAU D’HONNEUR', x + w / 2, y + 66, 8);
    c.font = `600 19px ${SANS}`; c.fillStyle = '#cfc5a6'; spaced(c, 'OR · ARGENT · BRONZE — LES MÉDAILLES FONT BAISSER LES PRIX', x + w / 2, y + 100, 2);
    const medals = ['#e3bd55', '#c9ccd0', '#b97a45'];
    ['CALYPSO 9', 'HORNET', 'BREAKER 12', 'SENTINEL'].forEach((name, i) => {
      const px = x + 70 + i * 162;
      c.fillStyle = CREAM; c.font = `800 19px ${SANS}`; c.textAlign = 'left'; spaced(c, name, px, y + 150, 2);
      medals.forEach((m, k) => { c.fillStyle = m; c.beginPath(); c.arc(px + 18 + k * 42, y + 200, 16, 0, Math.PI * 2); c.fill(); c.fillStyle = '#00000033'; c.beginPath(); c.arc(px + 18 + k * 42, y + 200, 9, 0, Math.PI * 2); c.fill(); });
      c.fillStyle = '#9fa58f'; c.font = `500 15px ${SERIF}`; c.fillText(['M. Okafor', 'J. Ferrand', 'E. Vasseur', 'anonyme'][i], px, y + 250);
    });
  }
}

export { PRINTS, LAYOUT as PRINT_LAYOUT, SIZE as PRINT_SIZE, paintPrints };
