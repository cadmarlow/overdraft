import test from 'node:test';
import assert from 'node:assert/strict';
import { FramePacer } from '../js/quality.js';

globalThis.document ??= { hidden: false };

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
