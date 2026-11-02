import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

const dir = new URL('../assets/nature/', import.meta.url);
const SPECIES = ['plane', 'locust', 'elm', 'oak'];

test('every species has its bark, and the leaves and the turf are there', () => {
  for (const s of SPECIES) for (const t of ['c', 'n']) assert.ok(existsSync(new URL(`bark-${s}_${t}.webp`, dir)), `${s} ${t}`);
  for (const f of ['leaves_c.webp', 'leaves_n.webp', 'lawn_c.webp', 'lawn_n.webp', 'meadow_c.webp', 'meadow_n.webp']) assert.ok(existsSync(new URL(f, dir)), f);
});

test('the nature loader asks for exactly those files', () => {
  const source = readFileSync(new URL('../js/nature-assets.js', import.meta.url), 'utf8');
  for (const s of SPECIES) assert.ok(source.includes(`'${s}'`), s);
  for (const f of ['leaves_c.webp', 'lawn_c.webp', 'meadow_n.webp']) assert.ok(source.includes(f), f);
});

test('what the game ships stays light', () => {
  const size = readdirSync(dir).reduce((n, f) => n + statSync(new URL(f, dir)).size, 0);
  assert.ok(size < 15e6, `${(size / 1e6).toFixed(1)} MB`);
});
