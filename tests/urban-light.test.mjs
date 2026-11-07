import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { rasterizeHeights, bakeSkyVisibility, encodeLightField, decodeLightField } from '../js/urban-light-field.js';

const box = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const building = (outer, height, holes = []) => ({ height, polygons: [{ outer, holes }] });
const bounds = { minX: -64, minZ: -64, maxX: 64, maxZ: 64 };
const at = (field, x, z) => Math.floor((z - field.minZ) / field.cell) * field.width + Math.floor((x - field.minX) / field.cell);

test('height baking keeps courtyards, exposed streets and the tallest overlapping roof', () => {
  const field = rasterizeHeights([building(box(-40, -40, 40, 40), 20, [box(-12, -12, 12, 12)]), building(box(20, 20, 36, 36), 70)], bounds);
  assert.equal(field.data[at(field, 0, 0)], 0, 'the courtyard remains sky-facing');
  assert.equal(field.data[at(field, 50, 0)], 0, 'the street remains open');
  assert.equal(field.data[at(field, 16, 16)], 20);
  assert.equal(field.data[at(field, 24, 24)], 70);
});

test('urban visibility distinguishes a canyon, a courtyard, an open plaza and the sky above their roofs', () => {
  const open = bakeSkyVisibility(rasterizeHeights([], bounds));
  assert.ok(open.data.every(v => v === 255));
  const field = rasterizeHeights([building(box(-48, -48, -12, 48), 40), building(box(12, -48, 48, 48), 40)], bounds);
  const canyon = bakeSkyVisibility(field), i = at(field, 0, 0) * 4;
  assert.ok(canyon.data[i] < 150, `street-level sky: ${canyon.data[i]}`);
  assert.ok(canyon.data[i + 1] > canyon.data[i]);
  assert.equal(canyon.data[i + 2], 255, 'above both roofs the sky is unobstructed');
  const enclosed = bakeSkyVisibility(rasterizeHeights([building(box(-48, -48, 48, 48), 40, [box(-12, -12, 12, 12)])], bounds));
  assert.ok(enclosed.data[i] < canyon.data[i], 'a courtyard has less sky than a two-sided street');
  for (let j = 0; j < canyon.data.length; j += 4) for (let k = 0; k < 3; k++) assert.ok(canyon.data[j + k] <= canyon.data[j + k + 1]);
});

test('field decoding rejects truncated, oversized and malformed data', () => {
  const field = bakeSkyVisibility(rasterizeHeights([], bounds));
  const bytes = encodeLightField(field), decoded = decodeLightField(bytes);
  assert.deepEqual(decoded, field);
  assert.throws(() => decodeLightField(bytes.subarray(0, bytes.length - 1)), /Invalid/);
  const invalid = bytes.slice(); new DataView(invalid.buffer).setUint32(8, 5000, true);
  assert.throws(() => decodeLightField(invalid), /Invalid/);
  const badHeight = bytes.slice(); new DataView(badHeight.buffer).setFloat32(32, 1, true);
  assert.throws(() => decodeLightField(badHeight), /Invalid/);
});

test('the shipped field covers Manhattan, including its north and south, and contains spatial variation', () => {
  const field = decodeLightField(gunzipSync(readFileSync(new URL('../assets/world/urban-light.bin.gz', import.meta.url))));
  assert.ok(field.minX < -2062 && field.minX + field.width * field.cell > 2548);
  assert.ok(field.minZ < -7116 && field.minZ + field.height * field.cell > 6485);
  assert.ok(field.data.some(v => v < 50) && field.data.some(v => v === 255));
});

test('reflection volumes preserve towers above 255 m and agree with the light field projection', async () => {
  const { reflectionField } = await import('../js/urban-light-field.js');
  const height = rasterizeHeights([building(box(-20, -20, 20, 20), 541)], bounds);
  const field = decodeLightField(encodeLightField(reflectionField(height)));
  const roof = i => field.data[i * 4] + field.data[i * 4 + 1] * 256;
  assert.equal(roof(at(field, 0, 0)), 541);
  assert.equal(roof(at(field, 40, 0)), 0);
  const shipped = decodeLightField(gunzipSync(readFileSync(new URL('../assets/world/urban-reflection.bin.gz', import.meta.url))));
  const light = decodeLightField(gunzipSync(readFileSync(new URL('../assets/world/urban-light.bin.gz', import.meta.url))));
  for (const k of ['width', 'height', 'cell', 'minX', 'minZ']) assert.equal(shipped[k], light[k]);
  assert.ok(shipped.data.some((v, i) => i % 4 === 1 && v > 0), 'the skyline retains its tall buildings');
});
