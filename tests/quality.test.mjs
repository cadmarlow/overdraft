import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, ORDER, currentLevel, setLevel, cycleLevel, FramePacer, ShadowCadence } from '../js/quality.js';

globalThis.document ??= { hidden: false };

function qualityEnvironment(t, { search = '', saved = null, readBlocked = false, writeBlocked = false, storageBlocked = false } = {}) {
  const descriptors = new Map(['location', 'localStorage'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const values = new Map(saved === null ? [] : [['overdraft:quality', saved]]), writes = [], navigations = [];
  let reads = 0;
  const location = { search, reload: () => navigations.push('reload'), assign: () => navigations.push('assign'), replace: () => navigations.push('replace') };
  Object.defineProperty(location, 'href', { get: () => `https://example.test/${search}`, set: (value) => navigations.push(value) });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: location });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() {
    if (storageBlocked) throw new Error('Storage access denied');
    return {
      getItem(key) { reads++; if (readBlocked) throw new Error('Storage read denied'); return values.get(key) ?? null; },
      setItem(key, value) { if (writeBlocked) throw new Error('Storage write denied'); writes.push([key, value]); values.set(key, value); }
    };
  } });
  t.after(() => { for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  return { values, writes, navigations, location, reads: () => reads };
}

test('a direct quality choice is persisted without navigation or changes to the running profile', (t) => {
  const env = qualityEnvironment(t, { saved: 'balanced' }), active = currentLevel(), profiles = structuredClone(LEVELS);
  for (const id of ['fluid', 'high', 'balanced']) {
    assert.equal(setLevel(id), id);
    assert.equal(env.values.get('overdraft:quality'), id);
    assert.equal(currentLevel().id, id);
  }
  assert.deepEqual(env.writes, ['fluid', 'high', 'balanced'].map((id) => ['overdraft:quality', id]));
  assert.deepEqual(env.navigations, []); assert.equal(env.location.search, '');
  assert.deepEqual(active, { id: 'balanced', ...profiles.balanced });
  assert.deepEqual(LEVELS, profiles);
  assert.deepEqual(ORDER, ['high', 'balanced', 'fluid']);
});

test('invalid direct choices are rejected before any preference read, write or navigation', (t) => {
  const env = qualityEnvironment(t, { saved: 'high' }), profiles = structuredClone(LEVELS);
  for (const id of ['', 'performance', 'HIGH', 'constructor', 'toString', '__proto__', null, undefined, {}, ['fluid'], 1, Symbol('high')]) {
    assert.throws(() => setLevel(id), RangeError);
  }
  assert.equal(env.values.get('overdraft:quality'), 'high');
  assert.equal(env.reads(), 0); assert.deepEqual(env.writes, []); assert.deepEqual(env.navigations, []);
  assert.deepEqual(LEVELS, profiles);
});

for (const [query, saved, expected] of [
  ['high', 'fluid', 'high'], ['balanced', 'high', 'balanced'], ['fluid', 'balanced', 'fluid'], ['performance', 'high', 'fluid'],
  ['', 'high', 'high'], ['unknown', 'fluid', 'fluid'], ['constructor', 'high', 'high'], ['toString', null, 'balanced'],
  [null, 'fluid', 'fluid'], [null, 'performance', 'balanced'], [null, '__proto__', 'balanced'], [null, null, 'balanced']
]) test(`quality preference resolves URL ${query} and storage ${saved} to ${expected}`, (t) => {
  const env = qualityEnvironment(t, { search: query === null ? '' : `?quality=${query}`, saved });
  assert.deepEqual(currentLevel(), { id: expected, ...LEVELS[expected] });
  assert.equal(env.reads(), ['high', 'balanced', 'fluid', 'performance'].includes(query) ? 0 : 1);
  assert.deepEqual(env.writes, []);
});

test('an explicit URL keeps precedence after saving a pending direct choice', (t) => {
  const env = qualityEnvironment(t, { search: '?quality=high', saved: 'balanced' });
  assert.equal(setLevel('fluid'), 'fluid');
  assert.equal(currentLevel().id, 'high');
  assert.equal(env.values.get('overdraft:quality'), 'fluid');
  assert.equal(env.location.search, '?quality=high');
});

for (const failure of ['readBlocked', 'writeBlocked', 'storageBlocked']) test(`quality selection remains usable with ${failure}`, (t) => {
  const env = qualityEnvironment(t, { [failure]: true });
  assert.equal(currentLevel().id, 'balanced');
  assert.equal(setLevel('fluid'), 'fluid');
  assert.equal(env.values.get('overdraft:quality'), failure === 'readBlocked' ? 'fluid' : undefined);
  env.location.search = '?quality=performance';
  assert.equal(currentLevel().id, 'fluid');
  assert.deepEqual(env.navigations, []);
});

test('the legacy cycle retains its order and wraparound through the validated setter', (t) => {
  const env = qualityEnvironment(t, { saved: 'high' });
  for (const expected of ['balanced', 'fluid', 'high']) assert.equal(cycleLevel(), expected);
  assert.deepEqual(env.writes, ['balanced', 'fluid', 'high'].map((id) => ['overdraft:quality', id]));
  env.location.search = '?quality=performance';
  assert.equal(cycleLevel(), 'high');
  assert.deepEqual(env.navigations, []);
});

function setup(level = { scale: 1, minScale: 0.7 }) {
  const completions = [];
  const renderer = {
    pixelRatio: 0,
    setPixelRatio(v) { this.pixelRatio = v; },
    backend: { device: { queue: { onSubmittedWorkDone: () => new Promise((resolve) => completions.push(resolve)) } } }
  };
  const pacer = new FramePacer({ renderer, level, isActive: () => true });
  return { pacer, renderer, completions };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

// One 1.5 s window of `fps` rendered frames, with `skips` refreshes lost waiting for the GPU
function playWindow(pacer, clock, fps, skips) {
  pacer.inFlight = 0;
  pacer.submitted(clock.t); // opens the window if none is open
  pacer.inFlight = 0;
  const frames = Math.round(fps * 1.5);
  for (let i = 0; i < frames; i++) {
    clock.t += 1501 / frames;
    pacer.skipped += i < skips ? 1 : 0;
    pacer.submitted(clock.t);
    pacer.inFlight = 0;
  }
}

test('a third frame waits until the GPU has finished one', async () => {
  const { pacer, completions } = setup();
  assert.equal(pacer.skip(0), false);
  pacer.submitted(0);
  assert.equal(pacer.skip(16), false);
  pacer.submitted(16);
  assert.equal(pacer.skip(33), true);
  completions[0]();
  await settle();
  assert.equal(pacer.skip(50), false);
});

test('a lost completion never freezes the frame loop', () => {
  const { pacer } = setup();
  pacer.submitted(0);
  pacer.submitted(16);
  assert.equal(pacer.skip(100), true);
  assert.equal(pacer.skip(300), false);
  assert.equal(pacer.inFlight, 0);
});

test('the render scale drops only when the GPU is the limit, and never below the level minimum', () => {
  const { pacer, renderer } = setup();
  const clock = { t: 1000 };
  playWindow(pacer, clock, 40, 0); // main thread limited: a blurrier image would not help
  assert.equal(pacer.scale, 1);
  for (let i = 0; i < 6; i++) playWindow(pacer, clock, 40, 30);
  assert.equal(pacer.scale, 0.7);
  assert.equal(renderer.pixelRatio, 0.7);
});

test('the render scale climbs back after a sustained good frame rate, and waits longer after a failed try', () => {
  const { pacer } = setup();
  const clock = { t: 1000 };
  playWindow(pacer, clock, 40, 30);
  assert.equal(pacer.scale, 0.9);
  for (let i = 0; i < 8; i++) playWindow(pacer, clock, 60, 0);
  assert.equal(pacer.scale, 1);
  playWindow(pacer, clock, 40, 30); // the sharper image was too much
  assert.equal(pacer.scale, 0.9);
  const before = pacer.upAfter;
  assert.ok(before > 8);
  for (let i = 0; i < 9; i++) playWindow(pacer, clock, 60, 0);
  assert.equal(pacer.scale, 0.9);
});

test('a marginal frame rate does not trigger a more expensive render resolution', () => {
  const { pacer } = setup();
  const clock = { t: 1 };
  pacer.setScale(0.7);
  for (let i = 0; i < 26; i++) playWindow(pacer, clock, 54, 0);
  assert.equal(pacer.scale, 0.7, '54 fps is not enough headroom to add GPU work');
});

test('balanced shadows reuse a stable atlas, but a quick turn or displacement refreshes immediately', () => {
  const schedule = new ShadowCadence();
  const camera = { position: { x: 0, y: 2, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
  assert.equal(schedule.due(0, camera), true);
  assert.equal(schedule.due(16, camera), false);
  assert.equal(schedule.due(34, camera), true);
  camera.position.x += 1;
  assert.equal(schedule.due(40, camera), true, 'fast motion and teleportation never wait for the timer');
  camera.quaternion.y = Math.sin(0.05); camera.quaternion.w = Math.cos(0.05);
  assert.equal(schedule.due(45, camera), true, 'a trackpad turn cannot reveal an unrendered shadow edge');
  camera.position.x += 0.04;
  assert.equal(schedule.due(61, camera), false, 'ordinary walking can reuse the previous atlas');
  assert.equal(schedule.due(79, camera), true);
});
