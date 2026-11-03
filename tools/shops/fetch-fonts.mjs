// Download the shop-sign typefaces from the Google Fonts repository (SIL Open Font License, Permanent Marker under
// Apache 2.0) into tools/shops/fonts. Only the glyph atlas built from them ships with the game.
// Usage: node tools/shops/fetch-fonts.mjs
import fs from 'node:fs';

const BASE = 'https://raw.githubusercontent.com/google/fonts/main/';
const FONTS = {
  Oswald: 'ofl/oswald/Oswald[wght].ttf',
  Anton: 'ofl/anton/Anton-Regular.ttf',
  PlayfairDisplay: 'ofl/playfairdisplay/PlayfairDisplay[wght].ttf',
  Lobster: 'ofl/lobster/Lobster-Regular.ttf',
  BebasNeue: 'ofl/bebasneue/BebasNeue-Regular.ttf',
  PermanentMarker: 'apache/permanentmarker/PermanentMarker-Regular.ttf',
  JosefinSans: 'ofl/josefinsans/JosefinSans[wght].ttf',
  Bitter: 'ofl/bitter/Bitter[wght].ttf',
  Monoton: 'ofl/monoton/Monoton-Regular.ttf',
  Pacifico: 'ofl/pacifico/Pacifico-Regular.ttf',
  Cinzel: 'ofl/cinzel/Cinzel[wght].ttf',
  ArchivoBlack: 'ofl/archivoblack/ArchivoBlack-Regular.ttf'
};
const dir = new URL('fonts/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });
for (const [name, file] of Object.entries(FONTS)) {
  const target = new URL(`${name}.ttf`, dir);
  if (fs.existsSync(target) && fs.statSync(target).size > 1000) continue;
  const response = await fetch(BASE + file.replace('[', '%5B').replace(']', '%5D'), { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  console.log(name, fs.statSync(target).size);
}
for (const [file, src] of [['OFL.txt', 'ofl/oswald/OFL.txt'], ['LICENSE-PermanentMarker.txt', 'apache/permanentmarker/LICENSE.txt']]) {
  const target = new URL(file, dir);
  if (!fs.existsSync(target)) fs.writeFileSync(target, Buffer.from(await (await fetch(BASE + src)).arrayBuffer()));
}
