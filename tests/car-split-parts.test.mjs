import test from 'node:test';
import assert from 'node:assert/strict';
import { splitDisconnected } from '../tools/cars/split-parts.mjs';

function primitive(positions, indices) {
  const count = positions.length / 3;
  return { pos: Float64Array.from(positions), nor: Float32Array.from({ length: count * 3 }, (_, i) => i % 3 === 1 ? 1 : 0),
    uv: Float32Array.from({ length: count * 2 }, (_, i) => i / 100), flag: Uint8Array.from({ length: count }, (_, i) => i % 5),
    index: Uint32Array.from(indices), hasNormals: true, flipped: false, material: { name: 'shared wheel material' } };
}

test('a material primitive spanning four wheels becomes four parts without changing positions or winding', () => {
  const positions = [], indices = [];
  for (const [x, z] of [[0.8, 1.4], [-0.8, 1.4], [0.8, -1.4], [-0.8, -1.4]]) {
    const first = positions.length / 3;
    positions.push(x, 0, z, x, 0.6, z, x, 0.3, z + 0.3, x, 0.3, z - 0.3);
    indices.push(first, first + 1, first + 2, first, first + 3, first + 1);
  }
  const data = primitive(positions, indices), before = structuredClone(data), parts = splitDisconnected(data);
  assert.equal(parts.length, 4);
  let triangle = 0;
  for (const part of parts) {
    assert.equal(part.index.length, 6); assert.equal(part.pos.length, 12);
    assert.equal(part.material, data.material); assert.equal(part.flipped, false); assert.equal(part.hasNormals, true);
    for (let i = 0; i < part.index.length; i++) {
      const local = part.index[i], original = data.index[triangle++];
      assert.equal(part.sourceVertexIndices[local], original);
      assert.deepEqual([...part.pos.slice(local * 3, local * 3 + 3)], [...data.pos.slice(original * 3, original * 3 + 3)]);
    }
  }
  assert.deepEqual(data, before);
});

test('position welding crosses UV and sharp-normal seams without merging their attribute vertices', () => {
  const data = primitive([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], [0, 1, 2, 3, 5, 4]);
  data.nor.set([0, 0, 1], 3 * 3); data.uv.set([0.9, 0.8], 3 * 2);
  const parts = splitDisconnected(data);
  assert.equal(parts.length, 1); assert.equal(parts[0].pos.length / 3, 6, 'UV seams must not be collapsed in the render mesh');
  for (let i = 0; i < parts[0].sourceVertexIndices.length; i++) {
    const from = parts[0].sourceVertexIndices[i];
    assert.deepEqual([...parts[0].nor.slice(i * 3, i * 3 + 3)], [...data.nor.slice(from * 3, from * 3 + 3)]);
    assert.deepEqual([...parts[0].uv.slice(i * 2, i * 2 + 2)], [...data.uv.slice(from * 2, from * 2 + 2)]);
    assert.equal(parts[0].flag[i], data.flag[from]);
  }
});

test('welding uses physical distance across hash-cell borders and does not bridge a nearby detached part', () => {
  const data = primitive([
    0.0000099, 0, 0, 1, 0, 0, 0, 1, 0,
    0.0000101, 0, 0, -1, 0, 0, 0, -1, 0,
    0.000025, 0, 0, 0, 0, 1, 1, 0, 1
  ], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const parts = splitDisconnected(data, { weldTolerance: 1e-5 });
  assert.deepEqual(parts.map((p) => p.index.length), [6, 3]);
  assert.equal(splitDisconnected(data, { weldTolerance: 1e-7 }).length, 3);
});

test('unreferenced vertices disappear and custom vertex metadata survives repeated splitting', () => {
  const data = primitive([9, 9, 9, 0, 0, 0, 1, 0, 0, 0, 1, 0], [1, 2, 3]);
  data.originalId = [90, 12, 13, 14]; data.color = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const part = splitDisconnected(data)[0];
  assert.deepEqual(part.originalId, [12, 13, 14]); assert.deepEqual([...part.sourceVertexIndices], [1, 2, 3]);
  assert.deepEqual([...part.color], [255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const again = splitDisconnected(part)[0];
  assert.deepEqual([...again.sourceVertexIndices], [1, 2, 3]);
  assert.deepEqual(again.originalId, part.originalId);
});

test('disconnected hardware remains separate for the importer to group spatially into a wheel', () => {
  const data = primitive([0, 0, 0, 0, 1, 0, 0, 0, 1, 0.02, 0.2, 0.2, 0.02, 0.3, 0.2, 0.02, 0.2, 0.3], [0, 1, 2, 3, 4, 5]);
  assert.equal(splitDisconnected(data).length, 2, 'physical separation must not be silently joined by proximity');
});

test('invalid topology and attributes fail before export; an empty primitive has no parts', () => {
  assert.deepEqual(splitDisconnected(primitive([], [])), []);
  const data = primitive([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
  assert.throws(() => splitDisconnected({ ...data, index: [0, 1, 5] }), /missing vertex/);
  assert.throws(() => splitDisconnected({ ...data, index: [0, 1] }), /triangle indices/);
  assert.throws(() => splitDisconnected({ ...data, nor: [0, 1, 0] }), /source vertex count/);
  assert.throws(() => splitDisconnected(data, { weldTolerance: 0 }), /positive/);
});
