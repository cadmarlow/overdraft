import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { BONE_COUNT } from '../js/human-skeleton.js';

const dir = new URL('../assets/humans/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.bin'));
const align = (n) => (n + 3) & ~3;

function parse(name) {
  const file = readFileSync(new URL(name, dir));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const headLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headLength)));
  let o = align(4 + headLength);
  const take = (Type, bytes) => { const a = new Type(buffer, o, bytes / Type.BYTES_PER_ELEMENT); o = align(o + bytes); return a; };
  const [p, n, i, w, part, f] = header.sections;
  return { ...header, position: take(Float32Array, p), normal: take(Float32Array, n), index: take(Uint8Array, i), weight: take(Uint8Array, w), part: take(Uint8Array, part), faces: take(Uint32Array, f) };
}

test('every prop the crowd carries has been sculpted', () => {
  for (const name of ['held-phone-m', 'held-coffee-m', 'held-umbrella-m', 'prop-bag', 'prop-backpack', 'held-phone-f', 'held-coffee-f', 'held-umbrella-f']) assert.ok(files.includes(`${name}.bin`), name);
});

for (const name of files) {
  test(`${name}: a sound mesh, every vertex held by bones`, () => {
    const m = parse(name);
    assert.equal(m.position.length, m.vertices * 3);
    assert.ok(m.position.every(Number.isFinite), 'positions are finite');
    for (let v = 0; v < m.vertices; v++) {
      const sum = m.weight[v * 4] + m.weight[v * 4 + 1] + m.weight[v * 4 + 2] + m.weight[v * 4 + 3];
      assert.equal(sum, 255, `vertex ${v}: weights sum to ${sum}`);
      for (let c = 0; c < 4; c++) assert.ok(m.index[v * 4 + c] < BONE_COUNT);
    }
    assert.ok(m.faces.every((i) => i < m.vertices), 'triangles use existing vertices');
    const length = Math.hypot(m.normal[0], m.normal[1], m.normal[2]);
    assert.ok(Math.abs(length - 1) < 0.02, 'normals are unit length');
  });
}
