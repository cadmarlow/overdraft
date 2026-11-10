import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compactPrimitiveData, primitiveData, readGlb } from '../tools/cars/glb.mjs';
import { transformTextureUV, wrapTextureCoordinate, decodeNormal, encodeNormal16, stripSidewallBrands, normalSlopeVariance, filteredMicrofacetRoughness, simplifyParkedWipers } from '../tools/cars/import-cars.mjs';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function triangle(matrix = IDENTITY, withNormals = true) {
  const normals = Array(3).fill([1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)]).flat();
  const data = [new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), new Float64Array(normals), new Float64Array([0, 1, 2])];
  return primitiveData({ accessor: (i) => data[i] }, { node: 'test triangle', matrix, primitive: { indices: 2, attributes: { POSITION: 0, ...(withNormals ? { NORMAL: 1 } : {}) } } });
}
const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('nonuniform source transforms keep normals perpendicular to both transformed surface tangents', () => {
  const m = [...IDENTITY]; m[0] = 2; m[5] = 3; m[10] = 0.5;
  const d = triangle(m);
  const n = d.nor.subarray(0, 3);
  for (const offset of [3, 6]) close(n[0] * (d.pos[offset] - d.pos[0]) + n[1] * (d.pos[offset + 1] - d.pos[1]) + n[2] * (d.pos[offset + 2] - d.pos[2]), 0);
  close(Math.hypot(...n), 1);
  assert.ok(n[2] > 0.95, 'compressed axis must dominate the transformed normal');
});

test('mirrored glTF nodes preserve outward normals and report the required winding reversal', () => {
  const m = [...IDENTITY]; m[0] = -2;
  const d = triangle(m);
  assert.equal(d.flipped, true);
  assert.ok(d.nor[0] < 0 && d.nor[1] > 0 && d.nor[2] > 0);
  const a = d.pos.subarray(0, 3), b = d.pos.subarray(6, 9), c = d.pos.subarray(3, 6);
  const u = b.map((x, i) => x - a[i]), v = c.map((x, i) => x - a[i]);
  const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  assert.ok(cross.reduce((n, value, i) => n + value * d.nor[i], 0) > 0);
});

test('removing an antenna also removes its bounds and UV footprint without changing surviving faces or shading', () => {
  // Vertex zero belonged to a deleted antenna face. Leaving it in the arrays would flatten the fitted roof and
  // allocate a huge mostly-empty atlas tile, even though no remaining triangle references it.
  const source = {
    pos: new Float64Array([0, 50, 0, -1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1]),
    nor: new Float32Array([1, 0, 0, 0, 1, 0, 0.6, 0.8, 0, 0, 0.8, 0.6, -0.6, 0.8, 0]),
    uv: new Float32Array([800, -400, 0, 0, 1, 0, 1, 1, 0, 1]),
    index: new Uint32Array([4, 2, 1, 4, 3, 2]), flipped: true, hasNormals: true
  };
  const original = structuredClone(source), result = compactPrimitiveData(source);
  const roof = data => Math.max(...Array.from(data.pos).filter((_, i) => i % 3 === 1));
  assert.equal(roof(source), 50);
  assert.equal(roof(result), 1, 'unused geometry must no longer influence visual fitting');
  assert.equal(result.pos.length, 12);
  assert.equal(result.uv.length, 8);
  assert.ok([...result.uv].every(value => value >= 0 && value <= 1), 'discarded UVs must not influence atlas extent');
  for (const [name, size] of [['pos', 3], ['nor', 3], ['uv', 2]]) {
    assert.equal(result[name].constructor, source[name].constructor);
    for (let i = 0; i < source.index.length; i++) {
      assert.deepEqual([...result[name].subarray(result.index[i] * size, (result.index[i] + 1) * size)],
        [...source[name].subarray(source.index[i] * size, (source.index[i] + 1) * size)], `${name}: triangle corner order changed`);
    }
  }
  assert.equal(result.flipped, true, 'the later mirrored-winding correction must remain attached');
  assert.equal(result.hasNormals, true);
  assert.deepEqual(source, original, 'compaction must not mutate the source asset');
});

test('a source without vertex normals gets geometric normals instead of a black zero-normal surface', () => {
  const d = triangle(IDENTITY, false);
  assert.equal(d.hasNormals, false);
  for (let i = 0; i < d.nor.length; i += 3) {
    close(Math.hypot(d.nor[i], d.nor[i + 1], d.nor[i + 2]), 1);
    close(d.nor[i], 1 / Math.sqrt(3));
  }
});

test('texture transforms retain scale, then rotation, then translation without clamping repeated UVs', () => {
  const transformed = transformTextureUV({ extensions: { KHR_texture_transform: { scale: [2, 3], rotation: Math.PI / 2, offset: [0.25, -0.5] } } }, 0.5, 0.25);
  close(transformed[0], -0.5); close(transformed[1], 0.5);
  assert.deepEqual(transformTextureUV({ extensions: { KHR_texture_transform: { scale: [200, 400] } } }, 0.75, 0.5), [150, 200]);
  close(wrapTextureCoordinate(-0.25), 0.75);
  close(wrapTextureCoordinate(1.25, 33648), 0.75);
  close(wrapTextureCoordinate(-0.25, 33648), 0.25);
  close(wrapTextureCoordinate(1.25, 33071), 1);
});

test('normal-map strength and rotation preserve tangent-space direction and a unit vector', () => {
  const full = decodeNormal(240, 127.5, 200), mild = decodeNormal(240, 127.5, 200, 0.3), rotated = decodeNormal(240, 127.5, 200, 1, Math.PI / 2);
  assert.ok(mild[0] < full[0] * 0.65 && mild[2] > full[2]);
  close(rotated[0], 0); close(rotated[1], -full[0]);
  close(Math.hypot(...rotated), 1);
  decodeNormal(240, 120, 200, 0).forEach((value, i) => close(value, i === 2 ? 1 : 0));
});

test('subpixel microflakes become stable roughness, independent of repeat count and sample order', () => {
  // Equal opposing slopes average to a smooth normal but must keep their reflected-light spread.
  const pixels = [192, 127, 239, 255, 63, 128, 239, 255, 127, 192, 239, 255, 128, 63, 239, 255];
  const variance = normalSlopeVariance(pixels, 0.3), roughness = filteredMicrofacetRoughness(0.19, variance);
  assert.ok(variance > 0.01 && roughness > 0.3 && roughness < 0.5, 'lost microscopic slopes must broaden the highlight');
  close(normalSlopeVariance(Array(30).fill(pixels).flat(), 0.3), variance);
  close(normalSlopeVariance([...pixels.slice(8), ...pixels.slice(0, 8)], 0.3), variance);
  close(normalSlopeVariance(pixels, 0.15), variance * 0.25);
  close(filteredMicrofacetRoughness(0.19, normalSlopeVariance(pixels, 0)), 0.19);
  close(normalSlopeVariance(Array(10).fill([192, 127, 239, 255]).flat(), 0.3), 0);
  assert.equal(filteredMicrofacetRoughness(0.9, 100), 1);
});

test('parked wiper cleanup retains blade and pivot coordinates while removing the stacked small yokes', () => {
  const pos = new Float64Array([
    -0.6, 0.88, 1.4, 0.05, 0.88, 1.4, 0.05, 0.89, 1.42,
    -0.2, 0.87, 1.46, 0.45, 0.87, 1.46, 0.45, 0.88, 1.48,
    0.13, 0.9, 1.42, 0.69, 0.9, 1.42, 0.69, 0.91, 1.44,
    0.66, 0.85, 1.4, 0.7, 0.85, 1.4, 0.7, 0.91, 1.44,
    -0.2, 0.91, 1.4, -0.1, 0.91, 1.4, -0.1, 0.93, 1.42
  ]);
  const data = { pos, nor: new Float64Array(pos.length).fill(1), uv: new Float64Array(pos.length / 3 * 2), index: Array.from({ length: 15 }, (_, i) => i) };
  const filtered = simplifyParkedWipers(data);
  assert.deepEqual(filtered.index, data.index.slice(0, 12));
  assert.equal(filtered.pos, data.pos, 'visual attachment points must not move');
  assert.equal(filtered.nor, data.nor); assert.equal(filtered.uv, data.uv);
  assert.deepEqual(data.index, Array.from({ length: 15 }, (_, i) => i), 'the source must remain unchanged');
});

test('16-bit normals retain curved reflection directions within 0.003 degrees', () => {
  let worst = 0, previousWorst = 0;
  for (let i = 1; i <= 4000; i++) {
    const n = [Math.sin(i * 0.71), Math.cos(i * 0.43), Math.sin(i * 0.19)], length = Math.hypot(...n);
    for (let j = 0; j < 3; j++) n[j] /= length;
    const encoded = encodeNormal16(...n).slice(0, 3), decodedLength = Math.hypot(...encoded), old = n.map((x) => Math.round(x * 127)), oldLength = Math.hypot(...old);
    const angle = (v, length) => Math.acos(Math.max(-1, Math.min(1, v.reduce((sum, value, j) => sum + value / length * n[j], 0)))) * 180 / Math.PI;
    worst = Math.max(worst, angle(encoded, decodedLength)); previousWorst = Math.max(previousWorst, angle(old, oldLength));
  }
  assert.ok(worst < 0.003, `${worst}°`);
  assert.ok(previousWorst > worst * 100, 'precision did not improve over the previous 8-bit format');
});

test('source sidewall brands are removed from both color and embossed normals without erasing central tread data', () => {
  const size = 100, colour = Buffer.alloc(size * size * 4, 31), normal = Buffer.alloc(size * size * 4, 128);
  const brand = (50 * size + 3) * 4, middle = (50 * size + 50) * 4;
  colour[brand] = 240; normal[brand] = 220; colour[middle] = 180; normal[middle] = 200;
  stripSidewallBrands(colour, normal, size, size);
  assert.equal(colour[brand], 31); assert.equal(normal[brand], 128); assert.equal(normal[brand + 2], 255);
  assert.equal(colour[middle], 180); assert.equal(normal[middle], 200);
});

test('the GLB reader handles interleaved normalized signed data without wrapping -128 below -1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'overdraft-glb-'));
  try {
    const gltf = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], buffers: [{ byteLength: 8 }], bufferViews: [{ buffer: 0, byteLength: 8, byteStride: 4 }],
      accessors: [{ bufferView: 0, componentType: 5120, count: 2, type: 'VEC3', normalized: true }] };
    let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const raw = Buffer.alloc(12 + 8 + json.length + 8 + 8);
    raw.writeUInt32LE(0x46546c67, 0); raw.writeUInt32LE(2, 4); raw.writeUInt32LE(raw.length, 8); raw.writeUInt32LE(json.length, 12); raw.writeUInt32LE(0x4e4f534a, 16); json.copy(raw, 20);
    const binAt = 20 + json.length; raw.writeUInt32LE(8, binAt); raw.writeUInt32LE(0x004e4942, binAt + 4);
    Buffer.from([128, 0, 127, 99, 127, 128, 0, 99]).copy(raw, binAt + 8);
    const file = join(dir, 'signed.glb'); writeFileSync(file, raw);
    const glb = await readGlb(file);
    assert.deepEqual([...glb.accessor(0)], [-1, 0, 1, 1, -1, 0]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
