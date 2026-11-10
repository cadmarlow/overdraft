import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

const dir = new URL('../assets/nature/', import.meta.url);
const FILES = ['lawn_c.webp', 'lawn_n.webp', 'meadow_c.webp'];

test('the turf is there (the trees have their own folder and tests)', () => {
  for (const f of FILES) assert.ok(existsSync(new URL(f, dir)), f);
});

test('the nature loader asks for exactly those files', () => {
  const source = readFileSync(new URL('../js/nature-assets.js', import.meta.url), 'utf8');
  for (const f of FILES) assert.ok(source.includes(f), f);
  assert.deepEqual(readdirSync(dir).sort(), FILES, 'nothing the game no longer loads is left behind');
});

test('what the game ships stays light', () => {
  const size = readdirSync(dir).reduce((n, f) => n + statSync(new URL(f, dir)).size, 0);
  assert.ok(size < 2e6, `${(size / 1e6).toFixed(1)} MB`);
});
