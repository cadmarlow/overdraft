import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightAudio } from '../js/audio-flight.js';
import { createFlight } from '../js/flight.js';

// A strict stand-in for the Web Audio API (in the spirit of tests/audio-ambience.test.cjs): it throws where a browser
// would, refuses non-finite automation, remembers what every parameter was last asked for, and records every node so
// the tests can count what stays connected.
function finite(...values) {
  for (const value of values) if (!Number.isFinite(value)) throw new TypeError(`non-finite value ${value}`);
}

class FakeParam {
  constructor(context, value) {
    this.context = context;
    this.value = value;
    this.target = value; // the last value any automation asked for
    this.constant = 0; // the time constant of the last setTargetAtTime
    this.top = -Infinity; // the highest value any automation asked for
    this.events = 0;
    this.ramps = 0;
    this.automationRate = 'a-rate';
  }
  record(time, value, ...rest) {
    finite(time, value, ...rest);
    if (time < 0) throw new RangeError('negative time');
    this.events++;
    this.target = value;
    this.top = Math.max(this.top, value);
    return this;
  }
  setValueAtTime(value, time) { return this.record(time, value); }
  linearRampToValueAtTime(value, time) { this.ramps++; return this.record(time, value); }
  exponentialRampToValueAtTime(value, time) {
    if (!(value > 0)) throw new RangeError('exponential ramp to zero or below');
    this.ramps++;
    return this.record(time, value);
  }
  setTargetAtTime(value, time, constant) {
    if (!(constant > 0)) throw new RangeError('time constant must be positive');
    this.constant = constant;
    return this.record(time, value, constant);
  }
  cancelScheduledValues(time) { finite(time); return this; }
  cancelAndHoldAtTime(time) { finite(time); this.held = (this.held || 0) + 1; return this; }
}

class FakeNode {
  constructor(context, kind, params = {}) {
    this.context = context;
    this.kind = kind;
    this.outputs = new Set();
    this.disconnected = false;
    for (const [name, value] of Object.entries(params)) this[name] = new FakeParam(context, value);
    context.all.push(this);
  }
  connect(target) {
    if (!(target instanceof FakeNode || target instanceof FakeParam)) throw new TypeError('connect target is not an AudioNode/AudioParam');
    if (this.disconnected) throw new Error('connecting a released node');
    this.outputs.add(target);
    return target;
  }
  disconnect() {
    this.outputs.clear();
    this.disconnected = true;
  }
}

class FakeSource extends FakeNode {
  start(time = 0, offset = 0) {
    finite(time, offset);
    if (this.started) throw new Error('InvalidStateError: started twice');
    if (time < 0 || offset < 0) throw new RangeError('negative start');
    if (this.kind === 'buffer' && !this.buffer) throw new Error('source started without a buffer');
    if (this.buffer && offset > this.buffer.duration) throw new RangeError('offset beyond buffer');
    if (time < this.context.currentTime - 1e-6) this.context.late++;
    this.started = true;
    this.startTime = time;
    this.context.started.push(this);
    this.context.active.add(this);
  }
  stop(time = 0) {
    finite(time);
    if (!this.started) throw new Error('InvalidStateError: stop before start');
    if (time < 0) throw new RangeError('negative stop');
    this.stopTime = time;
  }
  setPeriodicWave(wave) {
    if (!wave?.periodic) throw new TypeError('not a PeriodicWave');
    this.type = 'custom';
  }
}

class FakeContext {
  constructor() {
    this.currentTime = 1;
    this.sampleRate = 48000;
    this.state = 'running';
    this.all = [];
    this.started = [];
    this.active = new Set();
    this.late = 0;
    this.destination = new FakeNode(this, 'destination');
  }
  createGain() { return new FakeNode(this, 'gain', { gain: 1 }); }
  createOscillator() { const node = new FakeSource(this, 'oscillator', { frequency: 440, detune: 0 }); node.type = 'sine'; return node; }
  createBiquadFilter() { const node = new FakeNode(this, 'filter', { frequency: 350, Q: 1, gain: 0, detune: 0 }); node.type = 'lowpass'; return node; }
  createBufferSource() { const node = new FakeSource(this, 'buffer', { playbackRate: 1, detune: 0 }); node.buffer = null; node.loop = false; return node; }
  createWaveShaper() {
    const node = new FakeNode(this, 'shaper');
    let curve = null;
    Object.defineProperty(node, 'curve', { get: () => curve, set(value) {
      if (!(value instanceof Float32Array) || value.length < 2) throw new Error('InvalidStateError: curve');
      finite(...value);
      curve = value;
    } });
    return node;
  }
  createPeriodicWave(real, imag, options) {
    if (!(real instanceof Float32Array) || !(imag instanceof Float32Array) || real.length !== imag.length || real.length < 2) throw new Error('IndexSizeError');
    finite(...real, ...imag);
    return { periodic: true, real, imag, options };
  }
  createBuffer(channels, length, sampleRate) {
    if (!(length > 0) || !(channels > 0) || !(sampleRate >= 3000 && sampleRate <= 768000)) throw new Error('NotSupportedError');
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (i) => data[i] };
  }
  // Moves the clock and fires `onended` like the audio thread would
  advance(seconds) {
    this.currentTime += seconds;
    for (const source of [...this.active]) {
      if (source.stopTime !== undefined && source.stopTime <= this.currentTime) {
        this.active.delete(source);
        source.onended?.();
      }
    }
  }
  live() { return this.all.filter((node) => node !== this.destination && !node.disconnected); }
}

const STEP = 1 / 60;

// An aircraft as the flight model leaves it (createFlight), standing still in the air with everything at rest
function craft(kind, set = {}) {
  const flight = createFlight(kind);
  Object.assign(flight, { throttle: 0, power: 0, ab: 0, airspeed: 0, mach: 0, g: 1, buffet: 0, stall: 0, agl: 500, onGround: false, gear: 0, brake: 0, vx: 0, vy: 0, vz: 0 });
  const a = { type: 'plane', kind, flight, crashed: false, destroyed: false, hp: 100, verticalSpeed: 0, drive: { speed: kind === 'jet' ? 430 : 67 } };
  return fly(a, set);
}

function fly(a, set) {
  const b = a.flight;
  for (const [key, value] of Object.entries(set)) {
    if (key === 'engine') b.damage.engine = value;
    else if (key === 'wheels') for (const w of b.wheels) w.load = b.tune.mass * 9.81 * value / b.wheels.length;
    else if (key === 'slide') b.hull[0].contact = value;
    else b[key] = value;
  }
  if (set.airspeed !== undefined) { b.mach = b.airspeed / 340; b.vz = b.airspeed; }
  if (set.power !== undefined && set.throttle === undefined) b.throttle = b.power;
  a.verticalSpeed = b.vy;
  return a;
}

function harness(t) {
  const context = new FakeContext();
  const output = context.createGain();
  const audio = new FlightAudio(context, { noise: context.createBuffer(1, 96000, 48000) }, output);
  t.after(() => audio.dispose());
  // a few frames with the clock running, so one-off sounds end and smoothed state settles
  const run = (aircraft, seconds = STEP, view = 'chase', each = () => {}) => {
    for (let s = 0; s < seconds - 1e-9; s += STEP) {
      each(s);
      audio.update(aircraft, STEP, view);
      context.advance(STEP);
    }
  };
  // the same aircraft at one setting, long enough for the smoothed state to forget the last one
  const at = (a, set, view) => { fly(a, set); run(a, 1.2, view); return audio.rig; };
  return { context, output, audio, run, at };
}

const rising = (values, message) => {
  for (let i = 1; i < values.length; i++) assert.ok(values[i] > values[i - 1], `${message}: ${values.map((v) => +v.toFixed(4)).join(' → ')}`);
};

test('a new voice is four silent nodes and no graph, and stays that way until an aircraft is flown', (t) => {
  const { context, audio, output } = harness(t);
  assert.equal(context.live().length, 5, 'bus, limiter, the continuous path, the one-shot path (and the test output)');
  assert.equal(audio.bus.gain.value, 0);
  assert.ok(audio.bus.outputs.has(output));
  assert.equal(audio.rig, null);
  assert.equal(context.started.length, 0);
  audio.update(null, STEP);
  audio.update(undefined, STEP);
  audio.update({ type: 'car', body: {} }, STEP);
  assert.equal(audio.rig, null, 'only something with a flight model has this voice');
  assert.equal(context.live().length, 5);
  assert.equal(audio.bus.gain.target, 0);
});

test('the bus bends towards a ceiling and cannot clip, warnings included', (t) => {
  const { audio, at } = harness(t);
  const curve = audio.limiter.curve;
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i] >= curve[i - 1], 'monotonic');
  const middle = (curve.length - 1) / 2;
  assert.equal(curve[middle], 0, 'silence stays silence');
  assert.ok(Math.abs(curve[middle + 1] / (3 / middle) - 1) < 0.01, 'quiet sound passes at unity (the paths in carry a third)');
  assert.ok(Math.abs(audio.duck.gain.value - 1 / 3) < 1e-6 && Math.abs(audio.shots.gain.value - 1 / 3) < 1e-6);
  const ceiling = Math.max(...curve);
  assert.ok(ceiling <= 0.8 && -Math.min(...curve) <= 0.8);
  // the loudest the warning can be: the ground coming up, reheat lit, heard from the cockpit
  const jet = craft('jet');
  const rig = at(jet, { power: 1, ab: 1, airspeed: 200, agl: 30, vy: -30 }, 'pov');
  assert.ok(rig.warning.gain.top > 0.05);
  assert.ok(ceiling + rig.warning.gain.top < 1, `ceiling ${ceiling} + warning ${rig.warning.gain.top}`);
});

test('each aircraft has its own graph of about forty nodes, reused frame after frame', (t) => {
  for (const kind of ['classic', 'jet']) {
    const { context, audio, run } = harness(t);
    const a = craft(kind, { power: 0.6, airspeed: kind === 'jet' ? 200 : 45 });
    audio.update(a, STEP);
    assert.equal(audio.rig.kind, kind === 'jet' ? 'jet' : 'prop');
    assert.equal(audio.bus.gain.target, 1);
    const count = context.live().length - 1, started = context.started.length;
    assert.ok(count >= 30 && count <= 42, `${kind}: ${count} nodes`);
    assert.equal(context.late, 0);
    run(a, 2);
    assert.equal(context.live().length - 1, count, 'a steady cruise builds nothing');
    assert.equal(context.started.length, started);
    // and schedules nothing either, once every target is reached
    const params = context.all.flatMap((node) => Object.values(node).filter((v) => v instanceof FakeParam));
    const events = () => params.reduce((sum, p) => sum + p.events, 0);
    audio.update(a, STEP);
    const before = events();
    for (let i = 0; i < 50; i++) audio.update(a, STEP);
    assert.equal(events(), before, `${kind}: a steady state must not pile automation up`);
  }
});

test('radial: revs, firing rate and blade-pass beat follow the power, from a 600 rpm idle to 2,300', (t) => {
  const { audio, at } = harness(t);
  const a = craft('classic', { airspeed: 50 });
  const seen = [0, 0.25, 0.5, 0.75, 1].map((power) => {
    const rig = at(a, { power });
    return { rate: rig.lowBank.playbackRate.target, pass: rig.blade.frequency.target, level: rig.exhaust.gain.target,
      tone: rig.tone.frequency.target, prop: rig.prop.gain.target, twin: rig.bladeTwin.frequency.target };
  });
  rising(seen.map((s) => s.rate), 'revs');
  rising(seen.map((s) => s.pass), 'blade-pass frequency');
  rising(seen.map((s) => s.level), 'exhaust level');
  rising(seen.map((s) => s.tone), 'exhaust brightness');
  rising(seen.map((s) => s.prop), 'propeller level');
  const rpm = (s) => s.rate * audio.radial.referenceRPM;
  assert.ok(Math.abs(rpm(seen[0]) - 600) < 1, `idle ${rpm(seen[0])} rpm`);
  assert.ok(Math.abs(rpm(seen[4]) - 2300) < 1, `full ${rpm(seen[4])} rpm`);
  // two blades: twice a revolution; nine cylinders on four strokes: four and a half firings a revolution
  assert.ok(Math.abs(seen[0].pass - 20) < 0.05 && Math.abs(seen[4].pass - 2300 / 60 * 2) < 0.05);
  const rig = audio.rig;
  assert.ok(Math.abs(rig.highBank.playbackRate.target * audio.radial.highReferenceRPM - 2300) < 1, 'both banks turn at the same revs');
  assert.ok(Math.abs(rig.lowLevel.gain.target ** 2 + rig.highLevel.gain.target ** 2 - 1) < 1e-3, 'equal-power crossfade');
  // the twin drone is a fraction of a hertz away: a slow beat, never a second pitch
  for (const s of seen) assert.ok(s.twin - s.pass > 0.2 && s.twin - s.pass < 1);
  assert.ok(seen[4].prop > seen[0].prop * 8, 'the propeller is the sound of full power');
  // standing still the propeller holds the engine back; in a dive it lets it go
  const still = at(a, { power: 1, airspeed: 0 }).lowBank.playbackRate.target;
  const dive = at(a, { power: 1, airspeed: 95 }).lowBank.playbackRate.target;
  assert.ok(still < seen[4].rate && dive > seen[4].rate);
});

test('radial: wind and wires rise with the airspeed, the wires in pitch too, and die away in the stall', (t) => {
  const { at } = harness(t);
  const a = craft('classic', { power: 0.6 });
  const seen = [10, 25, 45, 67, 95].map((airspeed) => {
    const rig = at(a, { airspeed });
    return { wind: rig.wind.gain.target, wires: rig.wires.gain.target, a: rig.wireA.frequency.target, b: rig.wireB.frequency.target, band: rig.windBand.frequency.target };
  });
  for (const key of ['wind', 'wires', 'a', 'b', 'band']) rising(seen.map((s) => s[key]), key);
  assert.ok(seen[4].wires > seen[2].wires * 5, 'a dive whistles');
  assert.ok(seen.every((s) => s.b > s.a * 1.3), 'two wires, two notes');
  const flying = at(a, { airspeed: 30, stall: 0, buffet: 0 }), wind = flying.wind.gain.target, rumble = flying.rumble.gain.target;
  const stalled = at(a, { airspeed: 30, stall: 1, buffet: 1 });
  assert.ok(stalled.wind.gain.target < wind * 0.6 && stalled.wires.gain.target >= 0);
  assert.ok(stalled.rumble.gain.target > rumble + 0.4, 'the airframe shudders instead');
  assert.ok(stalled.shudderDepth.gain.target > 0.3 && stalled.shudderDepth.gain.target <= stalled.rumble.gain.target);
  assert.equal(stalled.warning, undefined, 'no stall horn on a 1930s biplane');
  // wires pull sharp under load
  const level = at(a, { airspeed: 50, stall: 0, buffet: 0, g: 1 }).wireA.frequency.target;
  assert.ok(at(a, { g: 4 }).wireA.frequency.target > level * 1.04);
});

test('radial: a dead engine is silent but for the windmilling tick and the wind', (t) => {
  const { at, audio } = harness(t);
  const a = craft('classic', { power: 0.8, airspeed: 40 });
  const running = at(a, {});
  const wind = running.wind.gain.target;
  assert.ok(running.exhaust.gain.target > 0.2);
  const dead = at(a, { engine: 1 });
  assert.ok(dead.exhaust.gain.target < 0.002, `exhaust ${dead.exhaust.gain.target}`);
  assert.ok(dead.clatterLevel.gain.target > 0.1, 'valve gear turned by the propeller');
  assert.ok(dead.wash.gain.target > 0.05 && dead.prop.gain.target < 0.04);
  assert.equal(dead.wind.gain.target, wind, 'the wind is all that is left');
  const rate = dead.clatter.playbackRate.target;
  assert.ok(rate * audio.radial.referenceRPM < 600, 'windmilling, slower than idle');
  assert.ok(at(a, { airspeed: 20 }).clatter.playbackRate.target < rate, 'and slower as the air slows');
  const stopped = at(a, { airspeed: 0 });
  assert.equal(stopped.clatterLevel.gain.target, 0);
  assert.equal(stopped.wash.gain.target, 0);
  assert.equal(stopped.prop.gain.target, 0);
});

test('radial: closing the throttle crackles in the stacks, holding it does not', (t) => {
  const { context, audio, run } = harness(t);
  const a = craft('classic', { power: 1, airspeed: 50 });
  run(a, 1);
  const steady = context.started.length;
  run(a, 1);
  assert.equal(context.started.length, steady, 'no pops at a steady power');
  let power = 1;
  run(a, 1, 'chase', () => { power = Math.max(0.3, power - 0.6 * STEP); fly(a, { power }); });
  const pops = context.started.slice(steady);
  assert.ok(pops.length >= 4, `${pops.length} pops`);
  assert.ok(pops.every((s) => s.kind === 'buffer' && s.stopTime > s.startTime && s.stopTime - s.startTime < 0.2));
  assert.ok(audio.rig.exhaust.gain.target < 0.25, 'and the load comes off');
  run(a, 2);
  assert.equal(context.live().length - 1, audio.rig.nodes.length + 4, 'every pop is released when it ends');
});

test('jet: the whine climbs from 900 Hz to 5 kHz with the spool and the roar opens up with the thrust', (t) => {
  const { at } = harness(t);
  const a = craft('jet', { airspeed: 200 });
  const seen = [0, 0.25, 0.5, 0.75, 1].map((power) => {
    const rig = at(a, { power });
    return { a: rig.whineA.frequency.target, b: rig.whineB.frequency.target, c: rig.whineC.frequency.target,
      roar: rig.roar.gain.target, open: rig.roarLow.frequency.target, whine: rig.whine.gain.target };
  });
  for (const key of ['a', 'b', 'c', 'roar', 'open']) rising(seen.map((s) => s[key]), key);
  assert.ok(Math.abs(seen[0].a - 900) < 1 && Math.abs(seen[4].a - 5000) < 1);
  for (const s of seen) {
    assert.ok(s.b > s.a && s.b < s.a * 1.02, 'two partials a few hertz apart');
    assert.ok(s.c > s.a * 1.9 && s.c < 21600, 'and a stage above, under Nyquist');
  }
  assert.ok(seen[4].roar > seen[0].roar * 4 && seen[4].open > 2000 && seen[0].open < 400);
  assert.ok(seen[2].whine > seen[4].whine, 'at full power the jet covers the whine');
});

test('jet: reheat lights with a thump, roars with the afterburner and goes out with a sigh', (t) => {
  const { context, audio, run, at } = harness(t);
  const a = craft('jet', { power: 1, airspeed: 220 });
  const dry = at(a, {});
  assert.equal(dry.burn.gain.target, 0);
  assert.equal(dry.tear.gain.target, 0);
  const before = context.started.length;
  const seen = [0.1, 0.3, 0.6, 1].map((ab) => {
    const rig = at(a, { ab });
    return { burn: rig.burn.gain.target, tear: rig.tear.gain.target, flame: rig.roarDepth.gain.target };
  });
  for (const key of ['burn', 'tear', 'flame']) rising(seen.map((s) => s[key]), key);
  assert.ok(seen[3].burn > 1.5 && seen[3].burn > seen[3].tear * 3, 'the low end dominates');
  assert.equal(audio.rig.tearDepth.gain.target, seen[3].tear * 0.8);
  // crossing 0.15 upward: one thump (a sine and a noise), not one a frame
  const thump = context.started.slice(before);
  assert.deepEqual(thump.map((s) => s.kind).sort(), ['buffer', 'oscillator']);
  run(a, 1);
  assert.equal(context.started.length, before + 2);
  at(a, { ab: 0.05 });
  const sigh = context.started.slice(before + 2);
  assert.deepEqual(sigh.map((s) => s.kind), ['buffer']);
  assert.ok(sigh[0].stopTime - sigh[0].startTime > 0.5, 'a sigh, not a click');
  // boarding an aircraft already in reheat is not a light-off
  const other = craft('jet', { power: 1, ab: 1, airspeed: 300 });
  const count = context.started.length;
  run(other, 0.5);
  assert.equal(context.started.length, count);
});

test('jet: the wind goes with the square of the speed, the airbrake hisses, buffet and g shake the airframe', (t) => {
  const { at } = harness(t);
  const a = craft('jet', { power: 0.5 });
  const seen = [60, 120, 240, 340, 420].map((airspeed) => {
    const rig = at(a, { airspeed });
    return { wind: rig.wind.gain.target, cut: rig.windHigh.frequency.target };
  });
  rising(seen.map((s) => s.wind), 'wind');
  rising(seen.map((s) => s.cut), 'wind brightness');
  assert.ok(seen[2].wind / seen[1].wind > 3.2 && seen[2].wind / seen[1].wind < 4.2, 'twice the speed, about four times the rush');
  assert.ok(seen.every((s) => s.cut >= 900), 'thin: nothing under 900 Hz');
  const clean = at(a, { airspeed: 240 });
  const levels = { brake: clean.brake.gain.target, rumble: clean.rumble.gain.target, wind: clean.wind.gain.target };
  assert.equal(levels.brake, 0);
  const braking = at(a, { brake: 1 });
  assert.ok(braking.brake.gain.target > 0.3 && braking.rumble.gain.target > levels.rumble + 0.2);
  // the transonic wall only raises `buffet` to about 0.2: it must still be heard
  const wall = at(a, { brake: 0, buffet: 0.2 }).rumble.gain.target;
  assert.ok(wall > levels.rumble + 0.5 && at(a, {}).shudderDepth.gain.target > 0.4);
  assert.ok(at(a, { buffet: 0.8 }).rumble.gain.target > wall);
  const pulling = at(a, { buffet: 0, g: 7.5 });
  assert.ok(pulling.rumble.gain.target > levels.rumble + 0.4 && pulling.wind.gain.target > levels.wind);
  const down = at(a, { g: 1, gear: 1, airspeed: 100 }).rumble.gain.target;
  assert.ok(down > at(a, { gear: 0 }).rumble.gain.target + 0.1, 'wheels in the airstream');
});

test('jet: a dead engine winds down to nothing but the wind', (t) => {
  const { at, run } = harness(t);
  const a = craft('jet', { power: 0.8, airspeed: 200 });
  const running = at(a, {});
  const pitch = running.whineA.frequency.target, wind = running.wind.gain.target;
  fly(a, { engine: 1 });
  run(a, 0.2);
  assert.ok(running.whineA.frequency.target < pitch && running.whine.gain.target > 0, 'heard winding down');
  const dead = at(a, { power: 0 });
  run(a, 3);
  assert.ok(dead.whine.gain.target < 1e-3 && dead.roar.gain.target < 1e-3 && dead.burn.gain.target === 0);
  assert.equal(dead.wind.gain.target, wind);
});

test('jet: a low-speed tone twice a second in the air, a faster one when the ground comes up, neither on the ground', (t) => {
  const { context, run } = harness(t);
  const a = craft('jet', { power: 0.2, airspeed: 60 });
  run(a, 2);
  const g = () => context.all.find((node) => node.kind === 'oscillator' && node.type === 'triangle');
  const tone = g();
  assert.ok(tone, 'the jet has a warning tone');
  const gain = [...tone.outputs][0].gain;
  assert.equal(gain.ramps, 0, 'flying normally: silent');
  fly(a, { stall: 0.9 });
  run(a, 3);
  const stall = gain.ramps / 2;
  assert.ok(stall >= 6 && stall <= 7, `${stall} beeps in 3 s`);
  assert.equal(tone.frequency.target, 640);
  assert.ok(gain.top > 0.02 && gain.top < 0.08, `quiet: ${gain.top}`);
  assert.equal(gain.target, 0, 'every beep ends in silence');
  // sinking fast under 60 m takes over
  fly(a, { agl: 40, vy: -15 });
  const before = gain.ramps;
  run(a, 3);
  const pull = (gain.ramps - before) / 2;
  assert.ok(pull >= 13 && pull <= 16, `${pull} beeps in 3 s`);
  assert.ok([1175, 1480].includes(tone.frequency.target));
  // a normal approach is not an alarm, and wheels on the ground silence both
  for (const set of [{ agl: 40, vy: -3, stall: 0.2 }, { agl: 0, vy: -15, stall: 1, onGround: true }, { agl: 300, vy: -60, stall: 0.4, onGround: false }]) {
    fly(a, set);
    run(a, 0.6);
    const count = gain.ramps;
    run(a, 2);
    assert.equal(gain.ramps, count, JSON.stringify(set));
  }
});

test('the cockpit view dulls the engine and brings the air and the warnings closer', (t) => {
  for (const kind of ['classic', 'jet']) {
    const { at } = harness(t);
    const a = craft(kind, { power: 0.7, airspeed: kind === 'jet' ? 220 : 50 });
    const chase = at(a, {}, 'chase');
    assert.equal(chase.engine.type, 'highshelf');
    assert.equal(chase.engine.gain.target, 0);
    const wind = chase.wind.gain.target;
    const pov = at(a, {}, 'pov');
    assert.ok(pov.engine.gain.target <= -5, `${kind}: shelf ${pov.engine.gain.target} dB`);
    assert.ok(pov.wind.gain.target > wind * 1.2);
    assert.equal(at(a, {}, 'anything else').engine.gain.target, 0);
  }
  const { at } = harness(t);
  const jet = craft('jet', { power: 0.2, airspeed: 60, stall: 0.9 });
  const quiet = at(jet, {}, 'chase').warning.gain.top;
  assert.ok(at(jet, {}, 'pov').warning.gain.top > quiet * 1.4);
});

test('tyres rumble with the weight on the wheels and the speed over the ground; a hull on the ground scrapes', (t) => {
  for (const kind of ['classic', 'jet']) {
    const { at } = harness(t);
    const a = craft(kind, { power: 0.3, airspeed: 0, onGround: true, wheels: 1 });
    assert.equal(at(a, {}).tyres.gain.target, 0, 'standing: silent');
    const seen = [5, 15, 30].map((airspeed) => at(a, { airspeed }).tyres.gain.target);
    rising(seen, 'tyre rumble');
    const light = at(a, { wheels: 0.3 }).tyres.gain.target;
    assert.ok(light > 0 && light < seen[2] * 0.5, 'the wing carrying the weight quietens them');
    assert.equal(at(a, { wheels: 0 }).tyres.gain.target, 0, 'airborne: silent');
    assert.equal(at(a, {}).scrape.gain.target, 0);
    assert.ok(at(a, { slide: true }).scrape.gain.target > 0.15, 'metal on the ground');
    assert.equal(at(a, { airspeed: 0 }).scrape.gain.target, 0);
  }
});

test('one-shots play while an aircraft is flown, are scheduled on time and are released when they end', (t) => {
  const { context, audio, run } = harness(t);
  const a = craft('jet', { power: 0.3, airspeed: 90 });
  run(a, 0.5);
  const steady = context.live().length;
  const shots = { touchdown: () => audio.touchdown(2.5, 55), crunch: () => audio.crunch(0.7), splash: () => audio.splash(1), boom: () => audio.boom(), gear: () => audio.gear(true) };
  for (const [name, shot] of Object.entries(shots)) {
    const before = context.started.length, now = context.currentTime;
    assert.equal(shot(), true, name);
    const sources = context.started.slice(before);
    assert.ok(sources.length >= 2, `${name}: ${sources.length} sources`);
    assert.ok(context.live().length > steady, `${name} adds nodes`);
    assert.ok(sources.every((s) => s.startTime >= now && s.stopTime > s.startTime), `${name}: every source starts now or later and has an end`);
    assert.ok(sources.some((s) => s.startTime === now), `${name} starts at once`);
    assert.equal(context.late, 0);
    run(a, 6);
    assert.equal(context.live().length, steady, `${name}: everything it made is released`);
  }
});

test('a touchdown is scaled by the sink rate and chirps with the speed; a crunch by its intensity', (t) => {
  const { context, audio, run } = harness(t);
  const a = craft('classic', { power: 0.2, airspeed: 30 });
  run(a, 0.5);
  const loudest = (from) => Math.max(...context.all.slice(from).filter((n) => n.kind === 'gain').map((n) => n.gain.top));
  const level = (shot) => { const from = context.all.length; shot(); const top = loudest(from); run(a, 3); return top; };
  const sources = (shot) => { const from = context.started.length; shot(); const n = context.started.length - from; run(a, 3); return n; };
  rising([0.3, 1.5, 3.5, 7].map((sink) => level(() => audio.touchdown(sink, 3))), 'touchdown thump');
  assert.ok(sources(() => audio.touchdown(1, 40)) > sources(() => audio.touchdown(1, 3)), 'tyres chirp when the ground is moving');
  rising([0.1, 0.4, 1].map((k) => level(() => audio.crunch(k))), 'crunch');
  // wheels touching together are one touchdown, and nonsense arguments make no sound worse than a default
  assert.equal(audio.touchdown(2, 30), true);
  assert.equal(audio.touchdown(2, 30), false);
  run(a, 1);
  assert.equal(audio.touchdown(NaN, undefined), true);
  assert.equal(audio.crunch(Infinity), true);
  assert.equal(audio.splash(-3), true);
});

test('the sonic boom is two bangs a tenth of a second apart, then a long rumble, with everything else ducked', (t) => {
  const { context, audio, run } = harness(t);
  const a = craft('jet', { power: 1, ab: 1, airspeed: 345 });
  run(a, 0.5);
  const before = context.started.length, now = context.currentTime, events = audio.duck.gain.events;
  assert.equal(audio.boom(), true);
  const sources = context.started.slice(before);
  const bangs = sources.filter((s) => s.kind === 'oscillator').map((s) => s.startTime - now);
  assert.equal(bangs.length, 2);
  assert.equal(bangs[0], 0);
  assert.ok(bangs[1] > 0.08 && bangs[1] < 0.14, `second bang after ${bangs[1]} s`);
  const rumble = sources.filter((s) => s.kind === 'buffer' && s.stopTime - s.startTime > 1.5);
  assert.ok(rumble.length >= 1 && Math.max(...rumble.map((s) => s.stopTime - now)) > 2.5, 'the rumble rolls on');
  assert.ok(audio.duck.gain.events > events, 'the voice steps back');
  assert.ok(Math.abs(audio.duck.gain.target - 1 / 3) < 1e-6, 'and comes back');
  assert.equal(audio.boom(), false, 'one barrier, one boom');
});

test('the undercarriage whirrs for its travel and then locks; throwing the lever back stops the first motion', (t) => {
  const { context, audio, run } = harness(t);
  const a = craft('jet', { power: 0.3, airspeed: 90 });
  run(a, 0.5);
  const travel = a.flight.tune.gearTime, now = context.currentTime, before = context.started.length, nodes = context.all.length;
  assert.equal(travel, 2.4);
  assert.equal(audio.gear(true), true);
  const down = context.started.slice(before);
  const motor = down.find((s) => s.kind === 'oscillator' && s.type === 'sawtooth');
  assert.ok(motor && Math.abs(motor.stopTime - now - travel) < 0.05, 'hydraulics for the length of the travel');
  const locks = down.filter((s) => s !== motor && s.startTime >= now + travel - 1e-6);
  assert.ok(locks.length >= 2, 'then the clunk of the locks');
  const firstGains = context.all.slice(nodes).filter((n) => n.kind === 'gain');
  run(a, 1);
  assert.equal(audio.gear(false), true);
  assert.ok(firstGains.every((g) => g.gain.target === 0), 'the first motion is silenced');
  assert.ok(context.started.length > before + down.length);
  run(a, 6);
  assert.equal(context.live().length - 1, audio.rig.nodes.length + 4);
});

test('one-shots are safe and silent when nothing is flown, when the context is suspended and after disposal', (t) => {
  const { context, audio, run } = harness(t);
  const all = () => [audio.touchdown(3, 40), audio.crunch(1), audio.splash(1), audio.boom(), audio.gear(true), audio.gear(false)];
  const count = context.all.length;
  assert.deepEqual(all(), [false, false, false, false, false, false], 'nothing flown yet');
  assert.equal(context.all.length, count);
  const a = craft('classic', { power: 0.5, airspeed: 40 });
  run(a, 0.5);
  context.state = 'suspended';
  const flying = context.all.length;
  assert.deepEqual(all(), [false, false, false, false, false, false], 'a suspended context would play them late');
  assert.equal(context.all.length, flying);
  context.state = 'running';
  assert.equal(audio.crunch(1), true);
  // left a moment ago: the crash that threw the pilot out is still heard; later, an abandoned aircraft is not
  run(null, 0.5);
  assert.equal(audio.touchdown(3, 40), true);
  run(null, 2);
  const left = context.all.length;
  assert.deepEqual(all(), [false, false, false, false, false, false]);
  assert.equal(context.all.length, left);
  audio.dispose();
  assert.deepEqual(all(), [false, false, false, false, false, false]);
  assert.equal(context.all.length, left);
});

test('no aircraft fades the voice out within 0.3 s, then gives its graph back; a wreck is no aircraft', (t) => {
  const { context, audio, run } = harness(t);
  const a = craft('jet', { power: 1, ab: 1, airspeed: 300, stall: 0.9 });
  run(a, 1);
  const rig = audio.rig, sources = [...rig.sources];
  assert.equal(audio.bus.gain.target, 1);
  audio.update(null, STEP);
  assert.equal(audio.bus.gain.target, 0);
  assert.ok(Math.exp(-0.3 / audio.bus.gain.constant) < 0.02, 'under 2% of the level after 0.3 s');
  assert.equal(rig.warning.gain.target, 0, 'a warning does not outlive the flight');
  run(null, 1);
  assert.equal(audio.rig, rig, 'kept for a moment: stepping back in costs nothing');
  run(a, 0.5);
  assert.equal(audio.rig, rig);
  assert.equal(audio.bus.gain.target, 1);
  run(null, 3);
  assert.equal(audio.rig, null);
  assert.equal(context.live().length, 5, 'only the four idle nodes are left');
  assert.ok(sources.every((s) => s.stopTime !== undefined && s.disconnected));
  // crashed or destroyed: the explosion is someone else's sound
  for (const flag of ['crashed', 'destroyed']) {
    const wreck = craft('classic', { power: 1, airspeed: 60 });
    run(wreck, 0.5);
    assert.equal(audio.bus.gain.target, 1);
    wreck[flag] = true;
    audio.update(wreck, STEP);
    assert.equal(audio.bus.gain.target, 0, flag);
    run(null, 3);
  }
  assert.equal(context.live().length, 5);
});

test('stepping from one aircraft into the other swaps the graph without leaving the old one behind', (t) => {
  const { context, audio, run } = harness(t);
  const prop = craft('classic', { power: 0.8, airspeed: 50 }), jet = craft('jet', { power: 0.8, airspeed: 200 });
  run(prop, 0.5);
  const first = audio.rig, count = context.live().length;
  run(jet, STEP);
  assert.equal(audio.rig.kind, 'jet');
  assert.equal(first.out.gain.target, 0, 'the old voice fades');
  assert.ok(context.live().length > count, 'both alive for the crossfade');
  run(jet, 1);
  assert.ok(first.nodes.every((n) => n.disconnected) && first.sources.every((s) => s.stopTime !== undefined));
  assert.equal(context.live().length - 1, audio.rig.nodes.length + 4);
  run(prop, 1);
  assert.equal(audio.rig.kind, 'prop');
  assert.equal(context.live().length, count);
});

test('half-built or broken state never reaches a parameter as NaN', (t) => {
  const { audio, run } = harness(t);
  const bare = { type: 'plane', flight: {} };
  assert.doesNotThrow(() => run(bare, 0.2));
  assert.equal(audio.rig.kind, 'prop');
  for (const kind of ['classic', 'jet']) {
    const a = craft(kind);
    Object.assign(a.flight, { power: NaN, throttle: undefined, ab: Infinity, airspeed: NaN, mach: NaN, g: NaN, buffet: -Infinity, stall: NaN, agl: NaN, gear: NaN, brake: NaN, vx: NaN, vz: NaN, beta: NaN });
    a.flight.damage.engine = NaN;
    a.flight.wheels[0].load = NaN;
    a.verticalSpeed = NaN;
    a.drive = null;
    assert.doesNotThrow(() => run(a, 0.5, 'pov'));
    assert.doesNotThrow(() => { audio.update(a, NaN); audio.update(a, -1); audio.update(a, 0); audio.update(a); });
    for (const view of [undefined, null, 7]) assert.doesNotThrow(() => audio.update(a, STEP, view));
  }
});

test('dispose stops every source, disconnects every node and makes everything a no-op', (t) => {
  const { context, audio, run } = harness(t);
  const jet = craft('jet', { power: 1, ab: 1, airspeed: 345, stall: 0.9 });
  run(jet, 0.5);
  audio.boom(); audio.crunch(1); audio.gear(true); audio.touchdown(4, 60); audio.splash(1);
  run(craft('classic', { power: 1, airspeed: 60 }), STEP);
  const owned = [...audio.nodes], sources = [...audio.sources];
  assert.ok(owned.length > 80, 'two graphs and five one-shots alive');
  audio.dispose();
  audio.dispose();
  assert.ok(owned.every((n) => n.disconnected));
  assert.ok(sources.every((s) => s.stopTime !== undefined));
  assert.equal(context.live().length, 1, 'nothing but the output it was given');
  assert.equal(audio.nodes.size, 0);
  assert.equal(audio.rig, null);
  const count = context.all.length;
  audio.update(jet, STEP);
  context.advance(10);
  assert.equal(context.all.length, count);
});
