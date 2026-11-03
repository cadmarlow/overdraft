// Build assets/shops/interiors.webp (the rooms, RGB) and assets/shops/interiors-near.webp (the furniture near the glass,
// premultiplied colour and coverage) from tools/shops/interiors.html, path traced in a headless Chrome.
// Needs the dev server (npm run dev) and the fonts (node tools/shops/fetch-fonts.mjs).
// Usage: node tools/shops/build-interiors.mjs [samples] [only=type,type]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { runPage } from './headless.mjs';

const sharp = createRequire(new URL('../world/package.json', import.meta.url))('sharp');
const samples = process.argv[2] || '160';
const only = process.argv.find((a) => a.startsWith('only='))?.slice(5) || '';
const TYPES = ['vacant', 'bodega', 'pizza', 'cafe', 'bakery', 'takeout', 'sushi', 'latin', 'restaurant', 'bar', 'diner', 'juice',
  'laundromat', 'cleaners', 'barber', 'salon', 'pharmacy', 'bank', 'boutique', 'luxury', 'jewelry', 'phones', 'hardware', 'florist',
  'liquor', 'books', 'office', 'souvenir', 'shoes', 'gallery'];
const TW = 512, TH = 290, COLS = 6, ROWS = 5;
const result = await runPage(`http://localhost:5173/tools/shops/interiors.html?samples=${samples}${only ? '&only=' + only : ''}`,
  { timeout: 3600000, width: 768, height: 435 });
if (result.error) throw new Error(result.error);
const png = (url) => Buffer.from(url.split(',')[1], 'base64');
const outDir = new URL('../../assets/shops/', import.meta.url).pathname;
const back = Buffer.alloc(TW * COLS * TH * ROWS * 3);
const near = Buffer.alloc(TW * COLS * TH * ROWS * 4);
// Keep tiles from a previous build when rendering only some rooms
if (only && fs.existsSync(outDir + 'interiors.webp')) {
  (await sharp(outDir + 'interiors.webp').removeAlpha().raw().toBuffer()).copy(back);
  (await sharp(outDir + 'interiors-near.webp').ensureAlpha().raw().toBuffer()).copy(near);
}
for (const [id, room] of Object.entries(result.rooms)) {
  const i = TYPES.indexOf(id), ox = (i % COLS) * TW, oy = Math.floor(i / COLS) * TH;
  const b = await sharp(png(room.back)).resize(TW, TH).removeAlpha().raw().toBuffer();
  const f = room.full ? await sharp(png(room.full)).resize(TW, TH).removeAlpha().raw().toBuffer() : null;
  const m = room.mask ? await sharp(png(room.mask)).resize(TW, TH).removeAlpha().raw().toBuffer() : null;
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const s = (y * TW + x) * 3, d = ((oy + y) * TW * COLS + ox + x);
    back[d * 3] = b[s]; back[d * 3 + 1] = b[s + 1]; back[d * 3 + 2] = b[s + 2];
    const a = m ? m[s] / 255 : 0;
    near[d * 4] = f ? Math.round(f[s] * a) : 0; near[d * 4 + 1] = f ? Math.round(f[s + 1] * a) : 0; near[d * 4 + 2] = f ? Math.round(f[s + 2] * a) : 0;
    near[d * 4 + 3] = Math.round(a * 255);
  }
  fs.mkdirSync('/tmp/overdraft-interiors', { recursive: true });
  await sharp(png(room.back)).toFile(`/tmp/overdraft-interiors/${id}.png`);
  if (room.full) await sharp(png(room.full)).toFile(`/tmp/overdraft-interiors/${id}-full.png`);
}
await sharp(back, { raw: { width: TW * COLS, height: TH * ROWS, channels: 3 } }).webp({ quality: 88, effort: 5 }).toFile(outDir + 'interiors.webp');
// Lossless keeps the colour under thin coverage intact
await sharp(near, { raw: { width: TW * COLS, height: TH * ROWS, channels: 4 } }).webp({ lossless: true, effort: 5 }).toFile(outDir + 'interiors-near.webp');
fs.writeFileSync(outDir + 'interiors.json', JSON.stringify({ tile: [TW, TH], cols: COLS, rows: ROWS, types: TYPES, eye: result.eye,
  room: result.room, near: result.mid }, null, 2) + '\n');
console.log('interiors', Object.keys(result.rooms).length, 'rooms');
