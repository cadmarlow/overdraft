import test from 'node:test';
import assert from 'node:assert/strict';
import { PauseMenu } from '../js/pause-menu.js';

function setup(saved = true) {
  const calls = [], status = { textContent: '' };
  const menu = Object.create(PauseMenu.prototype);
  Object.assign(menu, { applied: 'balanced', pending: 'balanced', applying: false,
    game: { save() { calls.push('save'); return saved; } }, syncQuality() { calls.push('sync'); }, el: () => status });
  globalThis.localStorage = { setItem(key, value) { calls.push(['store', key, value]); } };
  globalThis.location = { href: 'http://localhost:5174/?qa=1&quality=balanced&architecte=0#city', assign(value) { calls.push(['navigate', value]); } };
  return { menu, calls, status };
}

test('previewing and cancelling a graphics profile never saves, persists or navigates', () => {
  const { menu, calls } = setup();
  menu.selectQuality('high'); assert.equal(menu.pending, 'high'); assert.equal(menu.applied, 'balanced');
  menu.selectQuality(menu.applied); assert.equal(menu.pending, 'balanced');
  menu.selectQuality('not-a-profile'); assert.equal(menu.pending, 'balanced');
  menu.applyQuality(); assert.deepEqual(calls, ['sync', 'sync']);
});

test('applying saves before storing the profile and navigates only once, preserving other URL parameters', () => {
  const { menu, calls } = setup(); menu.selectQuality('fluid'); calls.length = 0;
  menu.applyQuality(); menu.applyQuality();
  assert.deepEqual(calls, ['save', 'sync', ['store', 'overdraft:quality', 'fluid'], ['navigate', 'http://localhost:5174/?qa=1&quality=fluid&architecte=0#city']]);
  assert.equal(menu.applying, true);
});

test('failed or temporarily unavailable saving preserves both the document and the applied profile', () => {
  const { menu, calls, status } = setup(false); menu.selectQuality('high'); calls.length = 0; menu.applyQuality();
  assert.deepEqual(calls, ['save']); assert.equal(menu.applying, false); assert.equal(menu.applied, 'balanced');
  assert.match(status.textContent, /Sauvegarde indisponible/);
});

test('resuming discards an unapplied preview without changing the current graphics', () => {
  const { menu, calls } = setup(); menu.pending = 'high'; menu.onPauseChanged(false);
  assert.equal(menu.pending, 'balanced'); assert.deepEqual(calls, ['sync']);
});

test('native dialogs keep browser defaults without leaking keys to gameplay overlays', () => {
  const { menu } = setup();
  Object.defineProperty(menu, 'visible', { value: true });
  globalThis.document = { getElementById: () => null, querySelector: () => ({ open: true }) };
  try {
    for (const code of ['Escape', 'Enter', 'Tab', 'ArrowRight']) {
      const calls = [];
      menu.key({ code, stopImmediatePropagation() { calls.push('stop'); }, preventDefault() { calls.push('prevent'); } });
      assert.deepEqual(calls, ['stop']);
    }
  } finally { delete globalThis.document; }
});
