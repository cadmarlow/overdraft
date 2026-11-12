import { CanvasTexture, SRGBColorSpace } from 'three/webgpu';

const TILES = Object.fromEntries([
  'stone', 'granite', 'metal', 'timber', 'raised', 'enamel', 'roller', 'vent',
  'home', 'blinds', 'lobby', 'wired', 'fanlight', 'fluted', 'intercom', 'lamp',
  'tile', 'bronze', 'threshold', 'plate', '0', '1', '2', '3',
  '4', '5', '6', '7', '8', '9', 'office', 'smoked'
].map((name, index) => [name, index]));
const COLS = 8, ROWS = 4, SIZE = 128, PAD = 5, CONTENT = SIZE - 2 * PAD;

function tileUV(name, u, v) {
  const tile = TILES[name];
  return [((tile % COLS) * SIZE + PAD + u * CONTENT) / (SIZE * COLS),
    1 - (Math.floor(tile / COLS) * SIZE + PAD + (1 - v) * CONTENT) / (SIZE * ROWS)];
}

const TILE_UV = Object.fromEntries(Object.keys(TILES).map(name => [name,
  [tileUV(name, 0, 0), tileUV(name, 1, 0), tileUV(name, 1, 1), tileUV(name, 0, 1)]]));

function createFrontageAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE * COLS;
  canvas.height = SIZE * ROWS;
  const ctx = canvas.getContext('2d');
  let seed = 902183;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const rect = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  const line = (x, y, x1, y1, color, width = 1) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x1, y1); ctx.stroke();
  };
  const gradient = (y0, y1, stops) => {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    for (const [at, color] of stops) g.addColorStop(at, color);
    return g;
  };
  const grain = (count, length, contrast) => {
    for (let i = 0; i < count; i++) {
      const x = random() * SIZE, y = random() * SIZE, a = random() * contrast;
      rect(x, y, 0.5 + random() * 1.35, 0.45 + random() * length, i % 3 ? `rgba(15,13,10,${a})` : `rgba(255,255,248,${a})`);
    }
  };
  const bevel = (x, y, w, h, thickness, light, dark, inner) => {
    rect(x, y, w, h, dark);
    rect(x + 1, y + 1, w - 2, h - 2, light);
    rect(x + thickness, y + thickness, w - thickness * 2, h - thickness * 2, inner);
    line(x + 2, y + 1, x + w - 2, y + 1, dark);
    line(x + 1, y, x + 1, y + h - 1, dark);
  };
  for (const [name, index] of Object.entries(TILES)) {
    ctx.save();
    ctx.translate((index % COLS) * SIZE, Math.floor(index / COLS) * SIZE);
    ctx.beginPath(); ctx.rect(0, 0, SIZE, SIZE); ctx.clip();
    if (['stone', 'granite', 'tile', 'threshold'].includes(name)) {
      const granite = name === 'granite', threshold = name === 'threshold';
      rect(0, 0, SIZE, SIZE, granite ? '#c0c0ba' : '#e3ded4');
      for (let i = 0; i < 64; i++) {
        const x = random() * SIZE, y = random() * SIZE, r = 5 + random() * 25;
        const cloud = ctx.createRadialGradient(x, y, 0, x, y, r);
        cloud.addColorStop(0, i % 2 ? 'rgba(58,47,31,.19)' : 'rgba(255,252,241,.38)');
        cloud.addColorStop(1, 'rgba(124,121,110,0)');
        rect(x - r, y - r, r * 2, r * 2, cloud);
      }
      grain(1700, granite ? 2 : 1, granite ? 0.55 : 0.22);
      if (name === 'tile' || threshold) {
        for (let y = 12; y < SIZE; y += threshold ? 29 : 42) {
          line(0, y, SIZE, y, '#8a8272', 1.6); line(0, y + 1, SIZE, y + 1, '#f4ecda');
          for (let x = 20 + (y % 3) * 12; x < SIZE; x += 42) line(x, y, x, y + 42, '#a09989', 1.4);
        }
      }
    } else if (['timber', 'raised', 'enamel'].includes(name)) {
      rect(0, 0, SIZE, SIZE, gradient(0, SIZE, [[0, '#dfdad1'], [0.82, '#b0aaa0'], [1, '#928c81']]));
      const painted = name === 'enamel';
      if (name !== 'timber') {
        bevel(15, 17, 98, 94, 6, '#ede5d6', '#635e54', '#bab2a3');
        if (!painted) bevel(25, 27, 78, 74, 4, '#d9cbb7', '#84715d', '#bba892');
      }
      grain(880, painted ? 2 : 17, painted ? 0.12 : 0.22);
    } else if (['home', 'blinds', 'lobby', 'wired', 'fanlight', 'fluted', 'office', 'smoked'].includes(name)) {
      const lobby = name === 'lobby', fan = name === 'fanlight';
      rect(0, 0, SIZE, SIZE, gradient(0, SIZE, lobby ? [[0, '#554c3b'], [0.43, '#353631'], [0.76, '#575247'], [1, '#252c2c']]
        : [[0, '#3f4848'], [0.54, '#323936'], [1, '#20282a']]));
      if (lobby) {
        // A ceiling, a lit back wall, stone floor joints and a planter suggest a vestibule behind the glass.
        rect(28, 24, 79, 64, '#474437'); rect(43, 32, 49, 52, '#696252');
        for (const x of [44, 91]) line(x, 33, x, 91, '#333329', 3);
        for (const x of [8, 50, 91]) line(60, 83, x, 128, 'rgba(190,172,142,.20)');
        rect(48, 29, 34, 2, '#c8bc9d'); rect(57, 38, 15, 2, '#928064');
        rect(91, 83, 21, 14, '#2d302b');
        for (let i = 0; i < 18; i++) line(102, 84, 93 + random() * 19, 65 + random() * 20, '#434c3c', 1.3);
      } else if (name === 'office') {
        rect(0, 1, 128, 43, '#625f50');
        rect(0, 40, 128, 3, '#32332f');
        rect(18, 46, 91, 36, '#5b5c53');
        rect(21, 74, 77, 12, '#393a36');
        rect(36, 63, 14, 13, '#454642');
        rect(39, 64, 10, 6, '#575c58');
        for (const x of [23, 77]) line(x, 6, x + 4, 27, '#b4a789', 2);
      } else if (name === 'smoked' || name === 'fluted') {
        rect(0, 0, SIZE, SIZE, gradient(0, SIZE, [[0, '#3b4140'], [0.64, '#4d5150'], [1, '#262d2f']]));
        if (name === 'fluted') for (let x = 0; x < SIZE; x += 5) {
          rect(x, 0, 1, SIZE, 'rgba(185,189,179,.20)'); rect(x + 1, 0, 1, SIZE, 'rgba(15,19,20,.24)');
        }
      } else if (name === 'blinds') {
        rect(6, 4, 116, 62, '#7e7b6d');
        for (let y = 9; y < 66; y += 4) { line(6, y, 122, y, '#45443d'); line(6, y + 1, 122, y + 1, '#a5a193'); }
        line(27, 4, 27, 67, '#a6a496'); line(102, 4, 102, 68, '#a6a496');
      } else if (!fan) {
        for (let i = 0; i < 34; i++) {
          const x = random() * SIZE;
          if (x < 31 || x > 90) rect(x, 1, 1 + random() * 4, 99 - random() * 18, 'rgba(190,182,163,.14)');
        }
      }
      const sheen = ctx.createLinearGradient(4, 7, 112, 103);
      [[0, 'rgba(186,204,213,.25)'], [0.40, 'rgba(148,175,192,.09)'], [0.51, 'rgba(214,224,229,.13)'],
        [0.54, 'rgba(134,153,166,.05)'], [1, 'rgba(109,143,156,.07)']].forEach(([x, c]) => sheen.addColorStop(x, c));
      rect(0, 0, SIZE, SIZE, sheen);
      if (name === 'wired') {
        for (let j = -128; j < 256; j += 8) {
          line(j, 0, j + 128, 128, 'rgba(15,18,19,.35)', 0.8);
          line(j, 0, j - 128, 128, 'rgba(15,18,19,.35)', 0.8);
        }
      }
      if (fan) {
        for (let i = -3; i <= 3; i++) line(64, 126, 64 + i * 21, 0, '#343b37', 3);
      }
      grain(420, 2, 0.11);
    } else if (name === 'roller' || name === 'vent') {
      rect(0, 0, SIZE, SIZE, name === 'roller' ? '#a7a6a0' : '#292c2a');
      for (let y = 0; y < SIZE; y += name === 'roller' ? 6 : 9) {
        rect(0, y, SIZE, 2, '#414440'); rect(0, y + 2, SIZE, 1, '#d0cec3');
      }
      grain(680, 3, 0.3);
    } else if (name === 'intercom' || name === 'lamp' || name === 'plate') {
      rect(0, 0, SIZE, SIZE, '#403f38');
      bevel(6, 6, 116, 116, 5, '#c2baa2', '#443e32', name === 'lamp' ? '#ebd8ac' : '#817c6b');
      if (name === 'intercom') {
        for (let y = 19; y <= 49; y += 6) line(24, y, 104, y, '#292a27', 3);
        for (let y = 63; y <= 104; y += 11) for (let x = 28; x <= 100; x += 18) bevel(x, y, 10, 7, 2, '#c7c5b6', '#55554a', '#aaa99b');
      }
      if (name === 'lamp') for (let x = 20; x < 118; x += 12) line(x, 12, x, 116, 'rgba(157,124,73,.48)', 2);
      grain(430, 2, 0.16);
    } else if (name.length === 1) {
      rect(0, 0, SIZE, SIZE, '#38352d');
      ctx.font = 'bold 106px Georgia, serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e9d7ab'; ctx.fillText(name, 64, 69);
    } else {
      rect(0, 0, SIZE, SIZE, gradient(0, SIZE, [[0, '#c8c9c3'], [0.32, '#dedcd3'], [0.8, '#a6a39b'], [1, '#8e8d84']]));
      grain(700, 0.9, 0.23);
      if (name === 'bronze') for (let i = 0; i < 140; i++) rect(0, random() * SIZE, SIZE, 0.6, 'rgba(244,232,201,.07)');
    }
    ctx.restore();
  }
  const atlas = new CanvasTexture(canvas);
  atlas.name = 'ManhattanFrontageAtlas';
  atlas.colorSpace = SRGBColorSpace;
  atlas.anisotropy = 8;
  return atlas;
}

export { createFrontageAtlas, TILE_UV };
