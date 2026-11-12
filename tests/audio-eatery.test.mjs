import test from 'node:test';
import assert from 'node:assert/strict';
import { EateryAudio, EATERY_SOUNDS, eateryLevels } from '../js/audio-eatery.js';

// A strict stand-in for the Web Audio API (the one of tests/audio-flight.test.mjs, with a panner and a listener): it
// throws where a browser would, refuses non-finite automation, remembers what every parameter was last asked for, and
// records every node so the tests can count what stays connected.
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
    if (!(this.target > 0)) throw new RangeError('exponential ramp from zero or below');
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
    const param = (value) => new FakeParam(this, value);
    this.listener = { positionX: param(0), positionY: param(1.7), positionZ: param(0) };
  }
  createGain() { return new FakeNode(this, 'gain', { gain: 1 }); }
  createOscillator() { const node = new FakeSource(this, 'oscillator', { frequency: 440, detune: 0 }); node.type = 'sine'; return node; }
  createBiquadFilter() { const node = new FakeNode(this, 'filter', { frequency: 350, Q: 1, gain: 0, detune: 0 }); node.type = 'lowpass'; return node; }
  createBufferSource() { const node = new FakeSource(this, 'buffer', { playbackRate: 1, detune: 0 }); node.buffer = null; node.loop = false; return node; }
  createStereoPanner() { return new FakeNode(this, 'stereo', { pan: 0 }); }
  createPanner() {
    const node = new FakeNode(this, 'panner', { positionX: 0, positionY: 0, positionZ: 0, orientationX: 1, orientationY: 0, orientationZ: 0 });
    Object.assign(node, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 1, rolloffFactor: 1, maxDistance: 10000 });
    return node;
  }
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

// What the audio system lends the module (audio-system.js: its SpatialEmitter and its listener), recording what is asked
function lend(context, output) {
  const spatial = {
    made: [],
    here: { x: 0, y: 1.7, z: 0 },
    lost: false,
    emitter(ref) {
      const emitter = {
        ref, updates: [], disposed: false, input: context.createGain(),
        update(source, listener, now, range, snap = false, immediate = false) {
          finite(source.x, source.y, source.z, listener.x, listener.y, listener.z, now, range);
          this.updates.push({ x: source.x, y: source.y, z: source.z, now, range, snap, immediate });
          this.input.gain.setTargetAtTime(1, now, 0.035);
          return Math.hypot(source.x - listener.x, source.y - listener.y, source.z - listener.z);
        },
        dispose() { this.disposed = true; this.input.disconnect(); }
      };
      emitter.input.gain.value = 0;
      emitter.input.connect(output);
      spatial.made.push(emitter);
      return emitter;
    },
    listener: () => (spatial.lost ? null : spatial.here)
  };
  return spatial;
}

const STEP = 1 / 60;
const IDLE = 3; // the bed bus, the bus of one-shots without a position, and the test's output
const NAMES = ['doorSlide', 'doorBell', 'till', 'kiosk', 'orderUp', 'sizzle', 'fryerDrop', 'fryerBeep', 'soda', 'trayDown', 'trayDump', 'wrap', 'bite',
  'chew', 'crunch', 'slurp', 'gulp', 'burp', 'doughSlap', 'doughSpin', 'peel', 'ovenDoor', 'cutter', 'boxFold', 'canOpen', 'mop', 'wipe', 'chair',
  'coins', 'jingleBullion', 'jingleTranche'];

// A branch as the game describes it: the listener well inside, eight metres from the door, the kitchen five metres away
const scene = (brand, set = {}) => ({ brand, inside: 1, distance: 8, x: 5, y: 1.2, z: 0, crowd: 8, cooking: 0.6, music: 1, ...set });

function harness(t, { own = false } = {}) {
  const context = new FakeContext();
  const output = context.createGain();
  const spatial = own ? null : lend(context, output);
  const audio = new EateryAudio(context, { noise: context.createBuffer(1, 96000, 48000) }, output, spatial);
  t.after(() => audio.dispose());
  // frames with the clock running, as the game does it: the scene, then the audio system's update
  const run = (what, seconds = STEP, playing = true) => {
    for (let s = 0; s < seconds - 1e-9; s += STEP) {
      if (what !== undefined) audio.setScene(what);
      audio.update(playing);
      context.advance(STEP);
    }
  };
  // one scene long enough to be reached, and the room it leaves
  const at = (what) => { run(what, 0.5); return audio.rig; };
  return { context, output, audio, spatial, run, at };
}

const rising = (values, message) => {
  for (let i = 1; i < values.length; i++) assert.ok(values[i] > values[i - 1], `${message}: ${values.map((v) => +v.toFixed(5)).join(' → ')}`);
};
const params = (context) => context.all.flatMap((node) => Object.values(node).filter((v) => v instanceof FakeParam));
const events = (context) => params(context).reduce((sum, p) => sum + p.events, 0);

test('the module loads and knows every sound the restaurants ask for', () => {
  assert.equal(typeof EateryAudio, 'function');
  assert.deepEqual([...EATERY_SOUNDS].sort(), [...NAMES].sort());
  assert.ok(Object.isFrozen(EATERY_SOUNDS));
});

test('a new voice is two idle gains and no room, and stays that way until a scene arrives', (t) => {
  const { context, audio, output, spatial } = harness(t);
  assert.equal(context.live().length, IDLE);
  assert.ok(audio.bus.outputs.has(output) && audio.shots.outputs.has(output));
  assert.equal(audio.rig, null);
  assert.equal(context.started.length, 0);
  audio.update(true);
  audio.setScene(null);
  audio.setScene(undefined);
  audio.setScene({ brand: 'sushi', inside: 1, distance: 0, x: 0, y: 0, z: 0, crowd: 5, cooking: 1, music: 1 });
  audio.setScene({ brand: 'constructor' });
  audio.setScene('bullion');
  for (let i = 0; i < 30; i++) { audio.update(true); context.advance(STEP); }
  assert.equal(audio.rig, null, 'only the two franchises have a room');
  assert.equal(context.live().length, IDLE);
  assert.equal(spatial.made.length, 0);
  assert.equal(events(context), 0, 'and nothing was scheduled');
});

test('each franchise has its own room of about thirty nodes, built once; a steady scene schedules nothing', (t) => {
  for (const brand of ['bullion', 'tranche']) {
    const { context, audio, run, spatial } = harness(t);
    const s = scene(brand);
    run(s);
    assert.equal(audio.rig.brand, brand);
    const count = context.live().length - IDLE, started = context.started.length;
    assert.ok(count >= 24 && count <= 40, `${brand}: ${count} nodes`);
    assert.ok(started >= 7 && started <= 9, `${brand}: ${started} sources`);
    assert.equal(context.late, 0);
    assert.equal(spatial.made.length, 1, 'one emitter, at the kitchen');
    run(s, 3);
    assert.equal(context.live().length - IDLE, count, 'frames build nothing');
    assert.equal(context.started.length, started);
    assert.equal(spatial.made.length, 1);
    // nor do they schedule anything, once every target is reached and between two placings of the kitchen
    audio.update(true);
    const before = events(context), placed = spatial.made[0].updates.length;
    for (let i = 0; i < 50; i++) { audio.setScene(s); audio.update(true); }
    assert.equal(spatial.made[0].updates.length, placed);
    assert.equal(events(context), before, `${brand}: a steady state must not pile automation up`);
  }
});

test('setScene(null) silences the beds within a few tenths of a second, then gives the graph back', (t) => {
  for (const brand of ['bullion', 'tranche']) {
    const { context, audio, run, at, spatial } = harness(t);
    const rig = at(scene(brand)), sources = [...rig.sources];
    assert.ok(rig.out.gain.target > 0.9 && rig.kitchen.gain.target > 0.9);
    audio.setScene(null);
    audio.update(true);
    assert.equal(rig.out.gain.target, 0, 'the room');
    assert.equal(rig.kitchen.gain.target, 0, 'the kitchen');
    for (const gain of [rig.out.gain, rig.kitchen.gain]) assert.ok(Math.exp(-0.3 / gain.constant) < 0.03, 'under 3% of the level after 0.3 s');
    // every layer reaches the listener through one of those two gains: there is no way round them
    const escapes = (node, seen = new Set()) => {
      if (node === rig.out || node === rig.kitchen || seen.has(node) || !(node instanceof FakeNode)) return false;
      if (node === audio.bus || node === spatial.made[0].input) return true;
      seen.add(node);
      return [...node.outputs].some((next) => escapes(next, seen));
    };
    assert.equal(sources.length, context.started.length);
    for (const source of sources) assert.ok(!escapes(source));
    assert.ok(rig.out.outputs.has(audio.bus) && rig.kitchen.outputs.has(spatial.made[0].input));
    run(undefined, 1);
    assert.equal(audio.rig, rig, 'kept for a moment: turning back costs nothing');
    run(scene(brand), 0.5);
    assert.equal(audio.rig, rig);
    assert.ok(rig.out.gain.target > 0.9);
    audio.setScene(null);
    run(undefined, 4);
    assert.equal(audio.rig, null);
    assert.equal(context.live().length, IDLE, 'only the idle nodes are left');
    assert.ok(sources.every((s) => s.stopTime !== undefined && s.disconnected));
    assert.ok(spatial.made[0].disposed, 'and the emitter is given back to the system');
    const count = context.all.length;
    run(undefined, 1);
    assert.equal(context.all.length, count, 'silence costs nothing');
  }
});

test('stepping in opens the room: from a dull leak to the full sound, level and brightness together', (t) => {
  const { at } = harness(t);
  const seen = [0, 0.25, 0.5, 0.75, 1].map((inside) => {
    const rig = at(scene('bullion', { inside, distance: 2 }));
    return { room: rig.out.gain.target, cutoff: rig.room.frequency.target, kitchen: rig.kitchen.gain.target, wall: rig.wall.frequency.target };
  });
  for (const key of ['room', 'cutoff', 'kitchen', 'wall']) rising(seen.map((s) => s[key]), key);
  assert.ok(seen[0].cutoff < 1000 && seen[0].wall < 1000, `from the pavement only the bottom of the sound: ${seen[0].cutoff} Hz`);
  assert.ok(seen[0].room > 0.1 && seen[0].room < 0.55, `a leak: ${seen[0].room}`);
  assert.equal(seen[4].room, 1);
  assert.equal(seen[4].kitchen, 1);
  assert.ok(seen[4].cutoff >= 15000, 'inside, the filter is out of the way');
  assert.equal(at(scene('bullion', { inside: 1, distance: 30 })).out.gain.target, 1, 'deep in the room the door no longer matters');
});

test('from the pavement the leak is louder at the door, brighter too, and gone before the scene is', (t) => {
  const { at } = harness(t);
  const seen = [60, 30, 15, 6, 0].map((distance) => {
    const rig = at(scene('tranche', { inside: 0, distance }));
    return { room: rig.out.gain.target, cutoff: rig.room.frequency.target };
  });
  rising(seen.map((s) => s.room), 'leak');
  rising(seen.map((s) => s.cutoff), 'cutoff');
  assert.equal(seen[0].room, 0, 'nothing at sixty metres: the scene can start and stop there without a step');
  assert.ok(seen[4].room <= 0.55 && seen[4].cutoff <= 1000);
  assert.ok(seen[2].room < seen[4].room * 0.4, 'fifteen metres away it is a hint');
});

test('the murmur follows the crowd, from silence to a full house', (t) => {
  for (const brand of ['bullion', 'tranche']) {
    const { at, context } = harness(t);
    assert.equal(at(scene(brand, { crowd: 0 })).murmur.gain.target, 0);
    rising([1, 4, 9, 14].map((crowd) => at(scene(brand, { crowd })).murmur.gain.target), 'murmur');
    const full = at(scene(brand, { crowd: 14 })).murmur.gain.target;
    assert.equal(at(scene(brand, { crowd: 40 })).murmur.gain.target, full, 'fourteen is a full house');
    assert.ok(at(scene(brand, { crowd: 1 })).murmur.gain.target < full * 0.25, 'one customer is not a crowd');
    // one loop twice, either side
    const sides = context.all.filter((n) => n.kind === 'stereo');
    assert.deepEqual(sides.map((n) => Math.sign(n.pan.value)).sort(), [-1, 1]);
    assert.ok(full > 0.02 && full < 0.2);
  }
});

test('BULLION: griddle, fat and fryers follow `cooking`, the hood never stops, the tune follows `music`', (t) => {
  const { at, audio } = harness(t);
  const cold = at(scene('bullion', { cooking: 0, music: 0, crowd: 0 }));
  assert.equal(cold.sizzle.gain.target, 0);
  assert.equal(cold.spit.out.gain.target, 0);
  assert.equal(cold.fry.gain.target, 0);
  assert.equal(cold.fryDepth.gain.target, 0);
  assert.equal(cold.music.gain.target, 0);
  assert.ok(cold.hood.gain.target > 0.01 && cold.hum.gain.target > 0, 'the extraction runs in an empty kitchen');
  const seen = [0.2, 0.5, 0.8, 1].map((cooking) => {
    const rig = at(scene('bullion', { cooking }));
    return { sizzle: rig.sizzle.gain.target, spit: rig.spit.out.gain.target, often: rig.spit.drive.gain.target, fry: rig.fry.gain.target,
      bubbles: rig.fryDepth.gain.target, hood: rig.hood.gain.target };
  });
  for (const key of ['sizzle', 'spit', 'often', 'fry', 'bubbles', 'hood']) rising(seen.map((s) => s[key]), key);
  assert.ok(seen[3].bubbles > seen[3].fry, 'the fryers boil: the bubbles beat their own level');
  rising([0.25, 0.5, 1].map((music) => at(scene('bullion', { music })).music.gain.target), 'tune');
  // the tune is in the room, not in the kitchen; what cooks is in the kitchen
  const rig = audio.rig;
  assert.ok(rig.music.outputs.has(rig.room) && rig.murmur.outputs.has(rig.room));
  for (const node of [rig.sizzle, rig.spit.out, rig.fry, rig.hood, rig.hum]) assert.ok(node.outputs.has(rig.wall));
  assert.ok(rig.music.gain.target < 0.15, 'a quiet tune');
});

test('TRANCHE: the oven roars and crackles with `cooking` over a pilot flame, the fridge hums, the radio stands by the oven', (t) => {
  const { at, audio, context } = harness(t);
  const cold = at(scene('tranche', { cooking: 0, music: 0, crowd: 0 }));
  assert.ok(cold.roar.gain.target > 0 && cold.roar.gain.target < 0.08, 'a pilot flame');
  assert.equal(cold.crackle.out.gain.target, 0);
  assert.equal(cold.radio.gain.target, 0);
  assert.ok(cold.fridge.gain.target > 0);
  const seen = [0.2, 0.5, 0.8, 1].map((cooking) => {
    const rig = at(scene('tranche', { cooking }));
    return { roar: rig.roar.gain.target, flame: rig.roarDepth.gain.target, crackle: rig.crackle.out.gain.target, often: rig.crackle.drive.gain.target };
  });
  for (const key of ['roar', 'flame', 'crackle', 'often']) rising(seen.map((s) => s[key]), key);
  rising([0.25, 0.5, 1].map((music) => at(scene('tranche', { music })).radio.gain.target), 'radio');
  const rig = audio.rig;
  assert.ok(rig.radio.outputs.has(rig.wall), 'a small radio has a place: the oven');
  assert.ok(rig.fridge.outputs.has(rig.room) && rig.murmur.outputs.has(rig.room));
  // it reaches the gain through a band-pass and a speaker pushed too hard
  const into = (node) => context.all.filter((n) => n.outputs.has(node));
  const drive = into(rig.radio)[0], high = into(drive)[0], lowCut = into(high)[0];
  assert.equal(drive.kind, 'shaper');
  assert.ok(high.type === 'lowpass' && high.frequency.value <= 3500 && lowCut.type === 'highpass' && lowCut.frequency.value >= 300, 'lo-fi');
  // two compressors a fraction of a hertz apart: a slow throb, never two notes
  const mains = context.all.filter((n) => n.kind === 'oscillator' && !n.disconnected).map((n) => n.frequency.value).sort();
  assert.ok(mains.length === 2 && mains[1] - mains[0] > 0.1 && mains[1] - mains[0] < 1);
});

test('the kitchen is placed in the world through the system\'s emitter, ten times a second at most', (t) => {
  const { audio, run, spatial } = harness(t);
  run(scene('bullion', { x: 12, y: 1.4, z: -7 }), 1);
  const emitter = spatial.made[0];
  assert.equal(emitter.ref, 3);
  assert.ok(audio.rig.kitchen.outputs.has(emitter.input));
  assert.ok(emitter.updates.length >= 8 && emitter.updates.length <= 12, `${emitter.updates.length} placings in a second`);
  assert.ok(emitter.updates[0].snap, 'the first one does not glide in from somewhere else');
  assert.ok(emitter.updates.slice(1).every((u) => !u.snap && !u.immediate));
  assert.ok(emitter.updates.every((u) => u.x === 12 && u.y === 1.4 && u.z === -7 && u.range > 60));
  // the same franchise two blocks away: the emitter jumps, it does not sweep across the street
  run(scene('bullion', { x: 12, y: 1.4, z: -67 }));
  assert.ok(emitter.updates.at(-1).snap && emitter.updates.at(-1).z === -67);
  // no listener yet (the audio system has just been reset): nothing is placed, nothing breaks
  spatial.lost = true;
  const count = emitter.updates.length;
  run(scene('bullion', { x: 12, y: 1.4, z: -67 }), 0.5);
  assert.equal(emitter.updates.length, count);
  // a scene without a position still has its room
  spatial.lost = false;
  run(scene('bullion', { x: NaN, y: undefined, z: null }), 0.5);
  assert.equal(emitter.updates.length, count + 0);
  assert.ok(audio.rig.out.gain.target > 0.9);
});

test('the game\'s pause silences the room like the flight voice; resuming brings it back without rebuilding', (t) => {
  const { context, audio, run, at } = harness(t);
  const s = scene('tranche');
  const rig = at(s), level = rig.out.gain.target, built = context.all.length;
  run(s, 0.5, false);
  assert.equal(rig.out.gain.target, 0);
  assert.equal(rig.kitchen.gain.target, 0);
  run(s, 0.5, true);
  assert.equal(audio.rig, rig);
  assert.equal(rig.out.gain.target, level);
  assert.equal(rig.kitchen.gain.target, 1);
  assert.equal(context.all.length, built, 'nothing was built for a short pause');
  // a long pause gives the graph back; the scene is still there when the game resumes
  run(s, 5, false);
  assert.equal(audio.rig, null);
  assert.equal(context.live().length, IDLE);
  run(s, 0.5, true);
  assert.equal(audio.rig.brand, 'tranche');
  assert.equal(audio.rig.out.gain.target, level);
});

test('walking from one franchise into the other fades the first room under the second and frees it', (t) => {
  const { context, audio, run, at, spatial } = harness(t);
  const first = at(scene('bullion')), count = context.live().length;
  run(scene('tranche'));
  assert.equal(audio.rig.brand, 'tranche');
  assert.equal(first.out.gain.target, 0, 'the old room fades');
  assert.equal(first.kitchen.gain.target, 0);
  assert.ok(context.live().length > count, 'both alive for the crossfade');
  run(scene('tranche'), 1);
  assert.ok(first.nodes.every((n) => n.disconnected) && first.sources.every((s) => s.stopTime !== undefined));
  assert.ok(spatial.made[0].disposed && !spatial.made[1].disposed);
  run(scene('bullion'), 1);
  assert.equal(audio.rig.brand, 'bullion');
  assert.equal(context.live().length, count);
});

test('a scene nobody cleared is dropped once the listener is far from its kitchen', (t) => {
  const { audio, run, at, spatial } = harness(t);
  const rig = at(scene('bullion', { x: 5, z: 0 }));
  // the game stops calling (a respawn, a teleport) and the listener is now across town
  spatial.here.x = 400;
  run(undefined, 0.2);
  assert.equal(rig.out.gain.target, 0);
  assert.equal(audio.scene.on, false);
  run(undefined, 4);
  assert.equal(audio.rig, null);
  // while the listener stays near, the last scene holds: a menu that freezes the game's own update keeps its room
  spatial.here.x = 0;
  const again = at(scene('bullion', { x: 5, z: 0 }));
  run(undefined, 2);
  assert.equal(audio.rig, again);
  assert.ok(again.out.gain.target > 0.9);
});

test('every one-shot plays at its position, starts on time, ends, and gives back all it made', (t) => {
  const { context, audio, run, spatial } = harness(t);
  run(undefined, 0.1);
  for (const name of NAMES) {
    const before = context.started.length, nodes = context.all.length, now = context.currentTime, made = spatial.made.length;
    assert.equal(audio.play(name, 2, 1.2, -1), true, name);
    const sources = context.started.slice(before);
    assert.ok(sources.length >= 1, `${name}: ${sources.length} sources`);
    assert.ok(sources.every((s) => s.startTime >= now && s.stopTime > s.startTime), `${name}: every source starts now or later and has an end`);
    assert.ok(Math.min(...sources.map((s) => s.startTime)) - now < 0.02, `${name} starts at once`);
    assert.equal(context.late, 0);
    const length = Math.max(...sources.map((s) => s.stopTime)) - now;
    assert.ok(length > 0.08 && length < 2.4, `${name} lasts ${length.toFixed(2)} s`);
    assert.ok(context.all.length - nodes <= 34, `${name}: ${context.all.length - nodes} nodes`);
    // one emitter of the system's, set where the sound is before the first sample
    assert.equal(spatial.made.length, made + 1, name);
    const emitter = spatial.made.at(-1);
    assert.ok(emitter.ref >= 1.5 && emitter.ref <= 6);
    assert.deepEqual(emitter.updates.map((u) => [u.x, u.y, u.z, u.snap, u.immediate]), [[2, 1.2, -1, true, true]]);
    // every gain it uses starts from silence or is ramped: no step, no click
    const gains = context.all.slice(nodes).filter((n) => n.kind === 'gain' && n !== emitter.input);
    assert.ok(gains.every((g) => g.gain.top <= 1.6), `${name}: a gain of ${Math.max(...gains.map((g) => g.gain.top))}`);
    run(undefined, 3);
    assert.equal(context.live().length, IDLE, `${name}: everything it made is released`);
    assert.ok(emitter.disposed);
  }
});

test('the two jingles are between 1.2 and 2 seconds: four notes of brass and a ka-ching, five notes of mandolin', (t) => {
  const { context, audio, run } = harness(t);
  run(undefined, 0.1);
  const shot = (name) => {
    const before = context.started.length, nodes = context.all.length, now = context.currentTime;
    assert.equal(audio.play(name, 1, 1.5, 0), true);
    const sources = context.started.slice(before), made = context.all.slice(nodes);
    run(undefined, 3);
    return { sources, made, now, length: Math.max(...sources.map((s) => s.stopTime)) - now };
  };
  const bullion = shot('jingleBullion');
  assert.ok(bullion.length >= 1.2 && bullion.length <= 2, `${bullion.length} s`);
  const horns = bullion.sources.filter((s) => s.type === 'sawtooth');
  assert.equal(horns.length, 2, 'two horns a few cents apart');
  assert.equal(horns[0].frequency.events, 4, 'four notes');
  assert.ok(Math.abs(horns[0].frequency.target - 440) < 0.01, 'ending on the A, held');
  const bells = bullion.sources.filter((s) => s.type === 'sine' && s.frequency.value > 2500);
  assert.ok(bells.length >= 2 && bells.every((s) => s.startTime > bullion.now + 0.9), 'the shimmer comes at the end');
  const tranche = shot('jingleTranche');
  assert.ok(tranche.length >= 1.2 && tranche.length <= 2, `${tranche.length} s`);
  const strings = tranche.sources.filter((s) => s.type === 'custom');
  assert.equal(strings.length, 2, 'a double course');
  assert.equal(strings[0].frequency.events, 5, 'five notes');
  const pick = tranche.made.find((n) => n.kind === 'gain' && n.gain.ramps > 20);
  assert.ok(pick, 'a tremolo: the plectrum keeps the long notes alive');
  assert.equal(pick.gain.target, 0.0001, 'and lets the last one ring out');
});

test('one-shots are refused when they would not be heard, and then build nothing', (t) => {
  const { context, audio, run, spatial } = harness(t);
  run(undefined, 0.1);
  const count = () => context.all.length;
  let before = count();
  assert.equal(audio.play('gong', 0, 0, 0), false, 'unknown');
  assert.equal(audio.play('toString', 0, 0, 0), false);
  assert.equal(audio.play(undefined, 0, 0, 0), false);
  assert.equal(audio.play('bite', 200, 0, 0), false, 'out of earshot');
  assert.equal(audio.play('bite', 1, 1, 1, { intensity: 0 }), false, 'no intensity');
  context.state = 'suspended';
  assert.equal(audio.play('bite', 1, 1, 1), false, 'sound off: it would play late');
  context.state = 'running';
  spatial.lost = true;
  assert.equal(audio.play('bite', 1, 1, 1), false, 'no listener to place it against');
  spatial.lost = false;
  assert.equal(count(), before);
  // the same sound an instant later is the same event reported twice; a different sound is not
  assert.equal(audio.play('doorBell', 1, 1, 1), true);
  before = count();
  assert.equal(audio.play('doorBell', 1, 1, 1), false);
  assert.equal(count(), before);
  assert.equal(audio.play('till', 1, 1, 1), true);
  run(undefined, 0.5);
  assert.equal(audio.play('doorBell', 1, 1, 1), true, 'and later it may ring again');
  // nonsense arguments make no sound worse than a default
  run(undefined, 3);
  assert.equal(audio.play('bite', 1, 1, 1, { intensity: NaN }), true);
  assert.equal(audio.play('chew', 1, 1, 1, { intensity: Infinity }), true);
  assert.equal(audio.play('gulp', 1, 1, 1, null ?? undefined), true);
  audio.dispose();
  before = count();
  assert.equal(audio.play('crunch', 1, 1, 1), false);
  assert.equal(count(), before);
});

test('intensity scales a one-shot; what belongs to the room is dulled for a listener on the pavement, unless it is close', (t) => {
  const { context, audio, run } = harness(t);
  run(undefined, 0.1);
  const shot = (name, distance, options) => {
    const nodes = context.all.length;
    assert.equal(audio.play(name, distance, 1.7, 0, options), true, name);
    const voice = audio.voices.at(-1), made = context.all.slice(nodes);
    const veil = made.find((n) => voice.input.outputs.has(n) && n.kind === 'filter');
    run(undefined, 3);
    return { level: voice.input.gain.value, veil };
  };
  const full = shot('trayDown', 4);
  assert.ok(full.level > 0.2 && full.level <= 1, `one number scales every one-shot: ${full.level}`);
  assert.equal(full.veil, undefined, 'no scene: nothing in the way');
  assert.ok(Math.abs(shot('trayDown', 4, { intensity: 0.4 }).level / full.level - 0.4) < 1e-9);
  assert.ok(Math.abs(shot('trayDown', 4, { intensity: 9 }).level / full.level - 1.5) < 1e-9, 'capped');
  // standing on the pavement in front of a branch
  audio.setScene(scene('bullion', { inside: 0, distance: 3 }));
  const through = shot('trayDown', 15);
  assert.ok(through.veil && through.veil.type === 'lowpass' && through.veil.frequency.value < 1200, 'through the shop front');
  assert.ok(through.level < full.level * 0.5);
  assert.equal(shot('trayDown', 2).veil, undefined, 'at arm\'s length it is on the listener\'s side of the glass (the service window)');
  assert.equal(shot('bite', 12).veil, undefined, 'someone eating is not part of the room: the player may be eating outside');
  assert.equal(shot('doorSlide', 15).veil, undefined, 'the door is heard from both sides');
  // half-way in, half the veil; inside, none
  audio.setScene(scene('bullion', { inside: 0.5, distance: 1 }));
  const half = shot('trayDown', 15);
  assert.ok(half.veil.frequency.value > through.veil.frequency.value && half.level > through.level);
  audio.setScene(scene('bullion', { inside: 1 }));
  assert.equal(shot('trayDown', 15).veil, undefined);
  // and the game can say so itself
  audio.setScene(null);
  assert.ok(shot('trayDown', 4, { muffle: 1 }).veil.frequency.value <= 700);
  assert.equal(shot('trayDown', 4, { muffle: 0 }).veil, undefined);
});

test('a one-shot without a position goes straight to both ears', (t) => {
  const { context, audio, run, spatial } = harness(t);
  run(undefined, 0.1);
  for (const args of [[], [NaN, 0, 0], [1, 2, undefined]]) {
    assert.equal(audio.play('jingleTranche', ...args), true);
    const voice = audio.voices.at(-1);
    assert.equal(voice.emitter, null);
    assert.ok(voice.input.outputs.has(audio.shots));
    run(undefined, 2.5);
  }
  assert.equal(spatial.made.length, 0);
  assert.equal(context.live().length, IDLE);
});

test('no more than twelve one-shots at once: the one nearest its end makes room, in a hundredth of a second', (t) => {
  const { context, audio, run, spatial } = harness(t);
  run(undefined, 0.1);
  const long = ['jingleBullion', 'jingleTranche', 'fryerDrop', 'soda', 'orderUp', 'doorBell', 'coins', 'trayDump', 'doorSlide', 'mop', 'peel', 'sizzle'];
  for (const name of long) assert.equal(audio.play(name, 1, 1, 1), true);
  assert.equal(audio.voices.length, 12);
  const shortest = audio.voices.reduce((a, b) => (b.end < a.end ? b : a));
  assert.equal(audio.play('bite', 1, 1, 1), true, 'a thirteenth is not refused');
  assert.equal(audio.voices.length, 12);
  assert.ok(!audio.voices.includes(shortest) && audio.fading.includes(shortest));
  assert.equal(shortest.input.gain.target, 0);
  assert.ok(shortest.input.gain.constant <= 0.02);
  run(undefined, 0.1);
  assert.equal(audio.fading.length, 0);
  assert.ok(shortest.nodes.every((n) => n.disconnected) && shortest.emitter.disposed);
  run(undefined, 3);
  assert.equal(context.live().length, IDLE);
  assert.ok(spatial.made.every((e) => e.disposed));
});

test('standing alone, the module pans for itself: a panner per sound, placed and released', (t) => {
  const { context, audio, run } = harness(t, { own: true });
  context.listener.positionX.value = 10;
  run(scene('tranche', { x: 14, y: 1, z: 3 }), 0.5);
  const kitchen = context.all.find((n) => n.kind === 'panner');
  assert.ok(kitchen && kitchen.panningModel === 'equalpower' && kitchen.refDistance === 3);
  assert.deepEqual([kitchen.positionX.target, kitchen.positionY.target, kitchen.positionZ.target], [14, 1, 3]);
  assert.equal(audio.play('ovenDoor', 14, 1, 3), true);
  assert.equal(context.all.filter((n) => n.kind === 'panner').length, 2);
  assert.equal(audio.play('ovenDoor', 300, 1, 3), false, 'earshot is measured from the context\'s listener');
  audio.setScene(null);
  run(undefined, 4);
  assert.equal(context.live().length, IDLE);
});

test('the baked loops are finite, within full scale, even, and loop without a seam', (t) => {
  const { audio } = harness(t);
  const expected = { walla: [7.2, 0.25], tuneBullion: [8 * 4 * 60 / 108, 0.14], tuneTranche: [16 * 2 * 60 / 108, 0.16] };
  for (const [name, [seconds, level]] of Object.entries(expected)) {
    const buffer = audio.buffer(name);
    assert.equal(audio.buffer(name), buffer, 'baked once');
    assert.equal(buffer.numberOfChannels, 1);
    assert.ok(Math.abs(buffer.duration - seconds) < 0.001, `${name}: ${buffer.duration} s`);
    const data = buffer.getChannelData(0);
    let peak = 0, energy = 0, mean = 0, step = 0;
    for (let i = 0; i < data.length; i++) {
      assert.ok(Number.isFinite(data[i]), `${name}[${i}]`);
      peak = Math.max(peak, Math.abs(data[i]));
      energy += data[i] * data[i];
      mean += data[i];
      if (i) step = Math.max(step, Math.abs(data[i] - data[i - 1]));
    }
    const rms = Math.sqrt(energy / data.length);
    assert.ok(peak <= 0.981, `${name} peaks at ${peak}`);
    assert.ok(Math.abs(rms - level) < 0.03, `${name}: ${rms} RMS`);
    assert.ok(Math.abs(mean / data.length) < 1e-4, 'no DC');
    assert.ok(Math.abs(data[0] - data[data.length - 1]) <= step, `${name}: the loop point is an ordinary step`);
    // no window of half a second is silent or twice as loud as the whole: a bed, not a pattern of holes
    const size = Math.round(buffer.sampleRate * 0.5);
    for (let from = 0; from + size <= data.length; from += size) {
      let e = 0;
      for (let i = from; i < from + size; i++) e += data[i] * data[i];
      const part = Math.sqrt(e / size) / rms;
      assert.ok(part > 0.2 && part < 2, `${name}: ${part.toFixed(2)} of the mean at ${(from / buffer.sampleRate).toFixed(1)} s`);
    }
  }
});

test('the house tune starts on the jingle\'s four notes, and both tunes stay in their key', (t) => {
  // The pitch a loop holds at a moment: the strongest of the candidate frequencies over a short window
  const strongest = (buffer, at, length, candidates) => {
    const data = buffer.getChannelData(0), rate = buffer.sampleRate, from = Math.round(at * rate), count = Math.round(length * rate);
    let best = 0, power = -1;
    for (const f of candidates) {
      let re = 0, im = 0;
      for (let i = 0; i < count; i++) {
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / count), phase = 2 * Math.PI * f * i / rate;
        re += data[from + i] * w * Math.cos(phase);
        im += data[from + i] * w * Math.sin(phase);
      }
      if (re * re + im * im > power) { power = re * re + im * im; best = f; }
    }
    return best;
  };
  const { audio } = harness(t);
  const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
  const octave = Array.from({ length: 13 }, (_, i) => hz(72 + i)); // C5 to C6
  const quarter = 60 / 108;
  const heard = [0, 1, 2, 3].map((beat) => strongest(audio.buffer('tuneBullion'), beat * quarter + 0.02, 0.2, octave));
  assert.deepEqual(heard.map((f) => Math.round(f)), [77, 72, 77, 81].map((m) => Math.round(hz(m))), 'F C F A, an octave above the horns');
  // the radio opens on E A E over A minor: its first, second and third eighth notes
  const eighth = 60 / 108 / 3, top = Array.from({ length: 13 }, (_, i) => hz(72 + i));
  const radio = [0, 1, 2].map((k) => strongest(audio.buffer('tuneTranche'), k * eighth + 0.01, eighth * 0.8, top));
  assert.deepEqual(radio.map((f) => Math.round(f)), [76, 81, 76].map((m) => Math.round(hz(m))));
});

test('the levels are pure: eateryLevels answers without an audio context, whatever it is given', () => {
  const inside = eateryLevels({ brand: 'bullion', inside: 1, distance: 9, crowd: 14 });
  assert.deepEqual(Object.keys(inside).sort(), ['cutoff', 'murmur', 'room', 'wall']);
  assert.equal(inside.room, 1);
  assert.equal(inside.wall, 1);
  const door = eateryLevels({ brand: 'bullion', inside: 0, distance: 0, crowd: 14 });
  assert.ok(door.room < 0.55 && door.wall < 0.5 && door.cutoff < 1000);
  assert.equal(door.murmur, inside.murmur, 'the crowd is the crowd wherever it is heard from');
  for (const broken of [undefined, null, {}, { inside: NaN, distance: -5, crowd: 'many' }, { inside: 7, distance: Infinity, crowd: -3 }]) {
    const l = eateryLevels(broken);
    for (const value of Object.values(l)) assert.ok(Number.isFinite(value) && value >= 0, JSON.stringify(broken));
    assert.ok(l.room <= 1 && l.wall <= 1);
  }
});

test('half-built or broken scenes never reach a parameter as NaN', (t) => {
  for (const brand of ['bullion', 'tranche']) {
    const { audio, run } = harness(t);
    assert.doesNotThrow(() => run({ brand }, 0.3));
    assert.equal(audio.rig.brand, brand);
    assert.equal(audio.rig.out.gain.target, eateryLevels({ brand, inside: 0, distance: 0 }).room, 'no `inside`: outside, at the door');
    const broken = { brand, inside: NaN, distance: NaN, x: Infinity, y: NaN, z: 'far', crowd: NaN, cooking: -Infinity, music: Infinity };
    assert.doesNotThrow(() => run(broken, 0.5));
    assert.doesNotThrow(() => run({ brand, inside: 9, distance: -40, x: 1, y: 2, z: 3, crowd: 1e9, cooking: 12, music: -1 }, 0.5));
    assert.equal(audio.rig.out.gain.target, 1);
    for (const playing of [undefined, null, 0, 'yes']) assert.doesNotThrow(() => audio.update(playing));
  }
});

test('a loop that cannot be baked leaves its layer out and the rest of the room standing', (t) => {
  const { context, audio, run } = harness(t);
  const create = context.createBuffer.bind(context), warn = console.warn;
  context.createBuffer = (channels, length, rate) => { if (rate === 8000) throw new Error('NotSupportedError'); return create(channels, length, rate); };
  const warned = [];
  console.warn = (...args) => warned.push(args);
  try {
    run(scene('bullion'), 0.5);
  } finally {
    console.warn = warn;
  }
  assert.equal(warned.length, 1, 'said once');
  assert.equal(audio.buffer('walla'), null);
  assert.equal(context.all.filter((n) => n.kind === 'stereo').length, 0, 'no murmur');
  assert.ok(audio.rig.music.gain.target > 0 && audio.rig.sizzle.gain.target > 0);
});

test('a browser that cannot build a room or a sound costs the game one warning, never a frame', (t) => {
  const { context, audio, run, spatial } = harness(t);
  const warn = console.warn, warned = [];
  console.warn = (...args) => warned.push(args[0]);
  t.after(() => { console.warn = warn; });
  // one-shots first: without periodic waves there is no mandolin, but sounds made of noise and sines still play
  const shaper = context.createWaveShaper;
  context.createPeriodicWave = () => { throw new Error('NotSupportedError'); };
  run(undefined, 0.1);
  assert.equal(audio.play('jingleTranche', 1, 1, 1), false, 'the mandolin needs a periodic wave');
  run(undefined, 2);
  assert.equal(audio.play('jingleTranche', 1, 1, 1), false);
  assert.equal(warned.length, 1, 'said once');
  assert.equal(audio.play('bite', 1, 1, 1), true);
  run(undefined, 1);
  assert.equal(context.live().length, IDLE, 'what the failed sound had built is given back');
  assert.ok(spatial.made.every((e) => e.disposed));
  // then the room: without wave shapers the fire cannot crackle, and a room is all or nothing
  context.createWaveShaper = () => { throw new Error('NotSupportedError'); };
  assert.doesNotThrow(() => run(scene('tranche'), 0.5));
  assert.equal(audio.rig, null);
  assert.equal(warned.length, 2);
  assert.equal(context.live().length, IDLE, 'the half-built room is given back');
  assert.ok(spatial.made.every((e) => e.disposed));
  const count = context.all.length;
  context.createWaveShaper = shaper;
  run(scene('bullion'), 0.5);
  assert.equal(context.all.length, count, 'and no room is tried again');
  assert.equal(warned.length, 2);
  assert.equal(audio.play('chew', 1, 1, 1), true, 'one-shots go on');
});

test('dispose stops every source, disconnects every node and makes everything a no-op', (t) => {
  const { context, audio, run, spatial } = harness(t);
  run(scene('bullion'), 0.5);
  run(scene('tranche'), STEP);
  for (const name of ['till', 'orderUp', 'jingleBullion', 'coins']) audio.play(name, 1, 1, 1);
  const owned = [...audio.nodes], sources = [...audio.sources];
  assert.ok(owned.length > 70, 'two rooms and four one-shots alive');
  audio.dispose();
  audio.dispose();
  assert.ok(owned.every((n) => n.disconnected));
  assert.ok(sources.every((s) => s.stopTime !== undefined));
  assert.ok(spatial.made.length === 6 && spatial.made.every((e) => e.disposed));
  assert.equal(context.live().length, 1, 'nothing but the output it was given');
  assert.equal(audio.nodes.size, 0);
  assert.equal(audio.rig, null);
  const count = context.all.length;
  audio.setScene(scene('bullion'));
  audio.update(true);
  assert.equal(audio.play('bite', 1, 1, 1), false);
  context.advance(10);
  assert.equal(context.all.length, count);
});

// ---- In the audio system ----------------------------------------------------------------------------------------------

test('the audio system builds the voice with its context, lends it its emitters and its listener, and pauses it', async (t) => {
  class SystemContext extends FakeContext {
    constructor() {
      super();
      for (const [name, value] of Object.entries({ forwardX: 0, forwardY: 0, forwardZ: -1, upX: 0, upY: 1, upZ: 0 })) this.listener[name] = new FakeParam(this, value);
    }
    createDynamicsCompressor() { return new FakeNode(this, 'compressor', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 }); }
    createConvolver() { return new FakeNode(this, 'convolver'); }
    createDelay() { return new FakeNode(this, 'delay', { delayTime: 0 }); }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  // the page the system expects around it
  const page = { AudioContext: SystemContext, document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    matchMedia: () => ({ matches: false }), localStorage: { getItem: () => null, setItem() {} } };
  const saved = Object.keys(page).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const [key, value] of Object.entries(page)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  let system = null;
  t.after(() => {
    system?.dispose();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  const { CityAudioSystem } = await import('../js/audio-system.js');
  const controllerManager = { entities: {}, getActiveEntity: () => null, nearColliders: () => [], setCollisionListener() {} };
  system = new CityAudioSystem({ controllerManager, trafficSystem: { cars: [], buses: [], peds: [], setCollisionListener() {} },
    highwayTraffic: { cars: [] }, streetDetails: { audioSignals: [] } });
  assert.equal(system.eatery, null, 'no context yet: the game calls it through ?.');
  system.enabled = true;
  system.unlock();
  assert.ok(system.eatery instanceof EateryAudio);
  assert.ok(system.eatery.bus.outputs.has(system.mix), 'through the city\'s mix and its compressor, under the master');
  system.ready = true;
  system.sources.collect = () => ({ motors: [], sirens: [], people: [], signals: [], motion: 0, rush: 0, traffic: 0 });
  const camera = { position: { x: 0, y: 1.7, z: 0 }, updateMatrixWorld() {}, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } };
  const context = system.context;
  const frames = (seconds, playing = true) => {
    for (let s = 0; s < seconds - 1e-9; s += STEP) {
      system.eatery.setScene(scene('bullion', { x: 6, y: 1.2, z: -2 }));
      system.update(STEP, s, camera, false, playing);
      context.advance(STEP);
    }
  };
  frames(0.5);
  const rig = system.eatery.rig;
  assert.equal(rig.brand, 'bullion');
  assert.equal(rig.out.gain.target, 1);
  // the kitchen sits on one of the system's own emitters: HRTF, the city's obstruction, a send to its reflections
  const { panner, input } = rig.emitter;
  assert.equal(panner.panningModel, 'HRTF');
  assert.equal(panner.refDistance, 3);
  assert.deepEqual([panner.positionX.target, panner.positionY.target, panner.positionZ.target], [6, 1.2, -2]);
  assert.ok(input.gain.target > 0.99 && panner.outputs.has(system.reflections));
  // a one-shot too
  const panners = () => context.all.filter((n) => n.kind === 'panner' && !n.disconnected).length, before = panners();
  assert.equal(system.eatery.play('till', 3, 1, 1), true);
  assert.equal(panners(), before + 1);
  assert.equal(system.eatery.play('till', 300, 1, 1), false, 'out of earshot of the system\'s listener');
  // the game's pause reaches it with the same flag as the flight voice
  frames(0.2, false);
  assert.equal(rig.out.gain.target, 0);
  assert.equal(rig.kitchen.gain.target, 0);
  frames(0.2, true);
  assert.equal(rig.out.gain.target, 1);
  // after a reset the system has no listener for a moment: one-shots wait for it
  system.reset();
  assert.equal(system.eatery.play('kiosk', 3, 1, 1), false);
  frames(0.2);
  assert.equal(system.eatery.play('kiosk', 3, 1, 1), true);
  system.dispose();
  assert.equal(system.eatery.disposed, true);
});
