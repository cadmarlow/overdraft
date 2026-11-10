import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import * as TSL from '../vendor/three/build/three.tsl.js';
import { loadModule } from './helpers/module.cjs';

const source = name => readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8');
const { DriveEffects, SkidMarks } = loadModule(source('drive-fx'), {
  imports: { 'three/webgpu': THREE, 'three/tsl': TSL, './car-assets.js': { DENTS: 6 }, './boat.js': { WATER: 0 } }
});

function effectHarness() {
  const particles = [];
  const fx = { smokeParticle(...args) { particles.push(args); }, glowParticle() {}, flash() {} };
  const drive = new DriveEffects(new THREE.Scene(), fx);
  const car = { kind: 'sedan', spec: { wheelRadius: 0.35 }, tune: { mass: 1500 }, body: {
    vx: 0, vz: 30, backfire: 0, scrape: 0,
    wheels: Array.from({ length: 4 }, (_, i) => ({ hasGround: true, px: i & 1 ? -0.8 : 0.8, pz: i > 1 ? -1.4 : 1.4,
      py: 0, gy: 0, nx: 0, ny: 1, nz: 0, grip: 1, rough: 0.0035, slip: 15, load: 1500 * 9.81 / 4 }))
  } };
  const run = () => {
    for (let i = 0; i < 20; i++) {
      for (const wheel of car.body.wheels) wheel.pz += 0.5;
      drive.car(car, 1 / 30, true);
    }
  };
  return { drive, car, particles, run };
}

test('skid strips conform to banked road normals and upload only changed segments', () => {
  const skids = new SkidMarks(new THREE.Scene(), { quads: 24 });
  const trail = {}, normal = { nx: 0.2, ny: 1, nz: 0 };
  skids.extend(trail, 0, 0, 0, 0.6, 0.15, normal);
  skids.extend(trail, 0, 0, 1, 0.8, 0.15, normal);
  assert.equal(skids.cursor, 1);
  assert.ok(Math.abs(Math.abs(skids.positions[0] - skids.positions[3]) - 0.3) < 1e-6);
  assert.ok(Math.abs(skids.positions[1] - skids.positions[4]) > 0.05, 'width follows road bank');
  assert.ok(Math.abs(skids.positions[7] - skids.positions[10]) > 0.05);
  skids.flush();
  assert.deepEqual(skids.positionAttribute.updateRanges, [{ start: 0, count: 12 }]);
  assert.deepEqual(skids.alphaAttribute.updateRanges, [{ start: 0, count: 4 }]);
  assert.ok(skids.mesh.geometry.getAttribute('edge'), 'tread edges are feathered in the material');
});

test('tyre traces break across a jump and never connect across a teleport', () => {
  const h = effectHarness();
  h.run();
  const start = h.drive.skids.cursor;
  for (const w of h.car.body.wheels) w.hasGround = false;
  h.run();
  assert.equal(h.drive.skids.cursor, start);
  for (const w of h.car.body.wheels) { w.hasGround = true; w.pz += 500; }
  h.drive.car(h.car, 1 / 60);
  assert.equal(h.drive.skids.cursor, start);
  assert.ok(h.car.body.trails.every(t => t.joined === false));
});

test('wet asphalt emits white spray, loose ground emits dust, and airborne wheels emit neither', () => {
  const wet = effectHarness();
  wet.drive.wet = 1;
  for (const w of wet.car.body.wheels) w.grip = 0.6;
  wet.run();
  assert.equal(wet.drive.skids.cursor, 0);
  assert.ok(wet.particles.length > 0);
  assert.ok(wet.particles.every(p => !p[10]?.tint), 'rain must not be mistaken for grass');
  const dirt = effectHarness();
  for (const w of dirt.car.body.wheels) { w.grip = 0.6; w.rough = 0.024; }
  dirt.run();
  assert.equal(dirt.drive.skids.cursor, 0);
  assert.ok(dirt.particles.length > 0);
  assert.ok(dirt.particles.every(p => p[10]?.tint?.[1] === 0.84));
  const air = effectHarness();
  air.drive.wet = 1;
  for (const w of air.car.body.wheels) w.hasGround = false;
  air.run();
  assert.equal(air.particles.length, 0);
});

test('a slow handbrake turn leaves rear tyre traces without marking ordinary rolling or a parked car', () => {
  const h = effectHarness();
  h.car.body.vz = 2;
  for (const w of h.car.body.wheels) { w.slip = 2; w.lock = false; }
  h.run();
  assert.equal(h.drive.skids.cursor, 0, 'ordinary rolling keeps its existing slip threshold');
  for (const w of h.car.body.wheels.slice(2)) w.lock = true;
  h.run();
  assert.ok(h.drive.skids.cursor > 0, 'locked rear tyres leave light rubber at manoeuvring speed');
  assert.ok(h.car.body.trails.slice(0, 2).every(t => t.x === undefined), 'front tyres keep rolling cleanly');
  const cursor = h.drive.skids.cursor;
  h.car.body.vz = 0;
  h.run();
  assert.equal(h.drive.skids.cursor, cursor, 'holding the handbrake at rest adds no traces');
});

function audioHarness() {
  const nodes = [], params = [];
  const parameter = value => {
    const p = { value, calls: 0, target: value, cancelScheduledValues() {},
      setTargetAtTime(v) { assert.ok(Number.isFinite(v)); this.target = v; this.calls++; },
      setValueAtTime(v) { assert.ok(Number.isFinite(v)); this.target = v; },
      exponentialRampToValueAtTime(v) { assert.ok(v > 0 && Number.isFinite(v)); this.target = v; } };
    params.push(p); return p;
  };
  const node = () => {
    const n = { connected: false, stopped: false, connect(to) { this.connected = true; return to; },
      disconnect() { this.connected = false; }, start() {}, stop() { this.stopped = true; },
      gain: parameter(0), frequency: parameter(0), Q: parameter(0), detune: parameter(0), playbackRate: parameter(1) };
    nodes.push(n); return n;
  };
  const context = { currentTime: 1, sampleRate: 48000, createGain: node, createOscillator: node,
    createBufferSource: node, createBiquadFilter: node, createWaveShaper: node };
  const { DriveAudio } = loadModule(source('audio-drive'), { imports: { './audio-synthesis.js': {
    setControlRate() {}, combustionBuffers() { return { exhaust: {}, highExhaust: {}, mechanical: {}, referenceRPM: 1200, highReferenceRPM: 3600 }; }
  } } });
  const audio = new DriveAudio(context, { noise: { duration: 2 } }, node());
  const car = { kind: 'muscle', tune: { idle: 780, redline: 6600 }, body: { rpm: 3600, throttle: 1, engineLoad: 1,
    gear: 0, shift: 0, vx: 0, vz: 30, vy: 0, grounded: 4, landed: 0, skid: 14,
    wheels: Array.from({ length: 4 }, () => ({ hasGround: true, rough: 0.0035, grip: 1, slip: 14 })) } };
  return { audio, context, car, nodes, params };
}

test('engine pitch follows RPM while load and clutch independently shape exhaust energy', () => {
  const { audio, context, car } = audioHarness();
  audio.update(car, true);
  const voice = audio.current, full = voice.master.gain.target;
  assert.equal(voice.low.playbackRate.target, 3);
  car.body.engineLoad = 0;
  context.currentTime += 0.1; audio.update(car, true);
  assert.ok(voice.master.gain.target < full * 0.3);
  assert.equal(voice.low.playbackRate.target, 3, 'lifting off does not fake an RPM drop');
  car.body.engineLoad = 1; car.body.shift = 0.15;
  audio.update(car, true);
  assert.ok(voice.master.gain.target < full * 0.3, 'torque cut is audible through the shift');
  car.body.rpm = 5400;
  audio.update(car, true);
  assert.equal(voice.low.playbackRate.target, 4.5);
  assert.equal(voice.high.playbackRate.target, 1.5);
});

test('audio uses actual tyre contacts, distinguishes rain from loose terrain and avoids pure harsh squeal', () => {
  const { audio, car } = audioHarness();
  for (const w of car.body.wheels) w.grip = 0.6;
  audio.update(car, true);
  assert.ok(audio.tyreA.out.gain.target > 0);
  assert.equal(audio.dirt.out.gain.target, 0);
  assert.equal(audio.whine.type, 'triangle');
  for (const w of car.body.wheels) w.rough = 0.024;
  audio.update(car, true);
  assert.equal(audio.tyreA.out.gain.target, 0);
  assert.ok(audio.dirt.out.gain.target > 0);
  for (const w of car.body.wheels) w.hasGround = false;
  car.body.grounded = 0;
  audio.update(car, true);
  assert.equal(audio.tyreA.out.gain.target, 0);
  assert.equal(audio.dirt.out.gain.target, 0);
  assert.equal(audio.road.out.gain.target, 0);
});

test('reverse transmission whirr follows actual backward travel and fades at rest or in forward gear', () => {
  const { audio, car } = audioHarness();
  car.body.reversing = true; car.speed = -2;
  audio.update(car, true);
  assert.ok(audio.reverseGain.gain.target > 0);
  const pitch = audio.reverse.frequency.target;
  car.speed = -6; audio.update(car, true);
  assert.ok(audio.reverse.frequency.target > pitch);
  car.speed = 0; audio.update(car, true);
  assert.equal(audio.reverseGain.gain.target, 0, 'reverse selected while stopped is silent');
  car.speed = 2; audio.update(car, true);
  assert.equal(audio.reverseGain.gain.target, 0, 'forward motion must not whine in reverse');
  car.speed = -2; car.body.reversing = false; audio.update(car, true);
  assert.equal(audio.reverseGain.gain.target, 0, 'rolling back in forward gear is not reverse transmission');
});

test('locked tyres are audible at manoeuvring speed but silent when parked, airborne or on loose earth', () => {
  const { audio, car } = audioHarness();
  car.body.vz = 2;
  for (const w of car.body.wheels) { w.slip = 1.7; w.lock = false; }
  audio.update(car, true);
  assert.equal(audio.tyreA.out.gain.target, 0);
  for (const w of car.body.wheels.slice(2)) w.lock = true;
  audio.update(car, true);
  assert.ok(audio.tyreA.out.gain.target > 0.08);
  car.body.vz = 0; audio.update(car, true);
  assert.equal(audio.tyreA.out.gain.target, 0);
  car.body.vz = 2;
  for (const w of car.body.wheels) { w.grip = 0.6; w.rough = 0.024; }
  audio.update(car, true);
  assert.equal(audio.tyreA.out.gain.target, 0);
  for (const w of car.body.wheels) { w.grip = 1; w.rough = 0.0035; w.hasGround = false; }
  car.body.grounded = 0; audio.update(car, true);
  assert.equal(audio.tyreA.out.gain.target, 0);
});

test('all vehicle families reuse graphs, avoid duplicate target queues and release every source on disposal', () => {
  const { audio, car, context, nodes } = audioHarness();
  const kinds = ['sedan', 'taxi', 'wagon', 'cruiser', 'compact', 'hatch', 'minivan', 'muscle', 'sport', 'super', 'suv', 'offroad', 'pickup', 'van', 'truck', 'delivery'];
  for (const kind of kinds) { car.kind = kind; audio.update(car, true); context.currentTime += 0.1; }
  assert.equal(audio.voices.size, 6);
  const count = nodes.length;
  for (const kind of kinds) { car.kind = kind; audio.update(car, true); context.currentTime += 0.1; }
  assert.equal(nodes.length, count);
  const rate = audio.current.low.playbackRate, calls = rate.calls;
  for (let i = 0; i < 100; i++) audio.update(car, true);
  assert.equal(rate.calls, calls, 'steady RPM must not accumulate automation events');
  const owned = [...audio.nodes], sources = [...audio.sources];
  audio.dispose(); audio.dispose();
  assert.ok(owned.every(n => !n.connected));
  assert.ok(sources.every(n => n.stopped));
  audio.update(car, true);
  assert.equal(nodes.length, count);
});
