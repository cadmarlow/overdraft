// Bake the city once, not while driving through it. Source footprints retain their NYC Open Data attribution.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { rasterizeHeights, bakeSkyVisibility, reflectionField, encodeLightField } from '../../js/urban-light-field.js';

const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => String(url).startsWith('file:') ? new Response(readFileSync(url)) : fetchOriginal(url, ...rest);
const { REAL_BUILDINGS } = await import('../../js/building-geodata.js');
globalThis.fetch = fetchOriginal;
const bounds = REAL_BUILDINGS.reduce((b, r) => ({ minX: Math.min(b.minX, r.minX - 224), minZ: Math.min(b.minZ, r.minZ - 224),
  maxX: Math.max(b.maxX, r.maxX + 224), maxZ: Math.max(b.maxZ, r.maxZ + 224) }), { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity });
const field = rasterizeHeights(REAL_BUILDINGS, bounds, 4);
console.log(`${field.width} × ${field.height}, ${REAL_BUILDINGS.length} immeubles, quatre hauteurs`);
let last = -1;
const light = bakeSkyVisibility(field, { onProgress: p => { const step = Math.floor(p * 10); if (step !== last) { last = step; console.log(`${step * 10} %`); } } });
const packed = gzipSync(encodeLightField(light), { level: 9 });
writeFileSync(new URL('../../assets/world/urban-light.bin.gz', import.meta.url), packed);
console.log(`Lumière urbaine : ${(packed.length / 1e6).toFixed(2)} Mo`);
const reflection = gzipSync(encodeLightField(reflectionField(field)), { level: 9 });
writeFileSync(new URL('../../assets/world/urban-reflection.bin.gz', import.meta.url), reflection);
console.log(`Volumes pour les reflets : ${(reflection.length / 1e6).toFixed(2)} Mo`);
