import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

const dir = new URL('../assets/world/', import.meta.url);
const sizes = JSON.parse(readFileSync(new URL('sizes.json', dir), 'utf8'));

test('every surface has its three maps and a real-world size', () => {
  for (const name of ['limestone', 'redbrick', 'brownbrick', 'buffbrick', 'asphalt', 'sidewalk']) {
    assert.ok(sizes[name], name);
    assert.ok(sizes[name].metres > 0.4 && sizes[name].metres < 6, `${name}: ${sizes[name].metres} m`);
    for (const t of ['c', 'n', 'r']) assert.ok(existsSync(new URL(`${name}_${t}.webp`, dir)), `${name} ${t}`);
  }
});

test('every prop is light enough to stand all along a street', () => {
  for (const name of ['hydrant', 'trashcan', 'trashbag', 'planter', 'utilitybox', 'barrier']) {
    const file = readFileSync(new URL(`prop-${name}.bin`, dir));
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const head = new DataView(buffer).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, head)));
    assert.ok(header.sections[3] / 12 < 3000, `${name}: ${header.sections[3] / 12} triangles`);
    assert.ok(header.size[1] > 0.3 && header.size[1] < 2, `${name} stands ${header.size[1]} m tall`);
    for (const t of ['c', 'n']) assert.ok(existsSync(new URL(`prop-${name}_${t}.webp`, dir)), `${name} ${t}`);
  }
});

test('what the game ships stays light', () => {
  const size = readdirSync(dir).reduce((n, f) => n + statSync(new URL(f, dir)).size, 0);
  assert.ok(size < 12e6, `${(size / 1e6).toFixed(1)} MB`);
});
