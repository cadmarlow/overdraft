const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../js/audio-ambience.js');

// A strict stand-in for the Web Audio API (in the spirit of tests/radio.test.mjs): it throws where a browser would,
// refuses non-finite automation, and records every node so the tests can count what stays connected.
function finite(...values) {
  for (const value of values) if (!Number.isFinite(value)) throw new TypeError(`non-finite value ${value}`);
}

class FakeParam {
  constructor(context, value) {
    this.context = context;
    this.value = value;
    this.automationRate = 'a-rate';
    this.events = 0;
  }
  record(time, ...values) {
    finite(time, ...values);
    if (time < 0) throw new RangeError('negative time');
    this.events++;
    return this;
  }
  setValueAtTime(value, time) { return this.record(time, value); }
  linearRampToValueAtTime(value, time) { return this.record(time, value); }
  exponentialRampToValueAtTime(value, time) {
    if (value === 0) throw new RangeError('exponential ramp to zero');
    return this.record(time, value);
  }
  setTargetAtTime(value, time, constant) {
    if (!(constant > 0)) throw new RangeError('time constant must be positive');
    return this.record(time, value, constant);
  }
  cancelScheduledValues(time) { return this.record(time); }
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
  disconnect(target) {
    if (target === undefined) {
      this.outputs.clear();
      this.disconnected = true;
      return;
    }
    if (!this.outputs.has(target)) throw new Error('InvalidAccessError: not connected');
    this.outputs.delete(target);
  }
}

class FakeSource extends FakeNode {
  start(time = 0, offset = 0) {
    finite(time, offset);
    if (this.started) throw new Error('InvalidStateError: started twice');
    if (time < 0 || offset < 0) throw new RangeError('negative start');
    if (!this.buffer && this.kind === 'buffer') throw new Error('source started without a buffer');
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
}

class FakeContext {
  constructor({ state = 'running', sampleRate = 48000 } = {}) {
    this.currentTime = 0;
    this.sampleRate = sampleRate;
    this.state = state;
    this.all = [];
    this.started = [];
    this.active = new Set();
    this.late = 0;
    this.destination = new FakeNode(this, 'destination');
    const param = (value) => new FakeParam(this, value);
    this.listener = { positionX: param(0), positionY: param(1.7), positionZ: param(0), forwardX: param(0), forwardY: param(0),
      forwardZ: param(-1), upX: param(0), upY: param(1), upZ: param(0) };
  }
  createGain() { return new FakeNode(this, 'gain', { gain: 1 }); }
  createOscillator() { const node = new FakeSource(this, 'oscillator', { frequency: 440, detune: 0 }); node.type = 'sine'; return node; }
  createBiquadFilter() { const node = new FakeNode(this, 'filter', { frequency: 350, Q: 1, gain: 0, detune: 0 }); node.type = 'lowpass'; return node; }
  createBufferSource() { const node = new FakeSource(this, 'buffer', { playbackRate: 1, detune: 0 }); node.buffer = null; node.loop = false; return node; }
  createStereoPanner() { return new FakeNode(this, 'stereo', { pan: 0 }); }
  createDelay(maxDelayTime = 1) {
    if (!(maxDelayTime > 0 && maxDelayTime < 180)) throw new RangeError('NotSupportedError: max delay time');
    return new FakeNode(this, 'delay', { delayTime: 0 });
  }
  createPanner() {
    const node = new FakeNode(this, 'panner', { positionX: 0, positionY: 0, positionZ: 0, orientationX: 1, orientationY: 0, orientationZ: 0 });
    Object.assign(node, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 1, rolloffFactor: 1, maxDistance: 10000 });
    return node;
  }
  createBuffer(channels, length, sampleRate) {
    if (!(length > 0) || !(channels > 0) || !(sampleRate >= 3000 && sampleRate <= 768000)) throw new Error('NotSupportedError');
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (i) => data[i] };
  }
  // Moves the clock and fires `onended` like the audio thread would.
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

const QUIET = { crowd: 0, traffic: 0, night: 0, hour: 13, subway: 0, construction: 0, bar: 0, birds: 0, water: 0, indoor: 0, rain: 0, enclosure: 0 };
const EVERYTHING = { crowd: 1, traffic: 1, subway: 1, construction: 1, bar: 1, birds: 1, water: 1 };
const DAY = { ...QUIET, crowd: 1, traffic: 0.8, hour: 10, subway: 1, construction: 1, bar: 1, birds: 1, water: 1, enclosure: 0.8 };
const NIGHT = { ...DAY, hour: 23, night: 1 };

function run(voice, context, seconds, params, step = 0.1, each = () => {}) {
  for (let t = 0; t < seconds - 1e-9; t += step) {
    context.advance(step);
    voice.update(params, context.currentTime);
    each();
  }
}

// Updates at 60 per second until the lazy bank has baked every buffer.
async function bakedVoice(options) {
  const { createAmbienceVoice } = await load();
  const context = new FakeContext(options), resources = {};
  const voice = createAmbienceVoice(context, resources, context.destination);
  for (let guard = 0; resources.ambienceBank.pending.length; guard++) {
    if (guard > 2000) throw new Error('the bank never filled');
    context.advance(1 / 60);
    voice.update(QUIET, context.currentTime);
  }
  return { context, resources, voice, buffers: resources.ambienceBank.buffers };
}

const flatten = (value) => Array.isArray(value) ? value : value?.getChannelData ? [value] : Object.values(value);

test('ambienceLevels is pure and always returns the seven finite layer gains', async () => {
  const { ambienceLevels } = await load();
  const params = Object.freeze({ crowd: 0.6, traffic: 0.4, night: 0.2, hour: 15, subway: 0.5, construction: 0.7, bar: 0.3,
    birds: 0.5, water: 0.2, indoor: 0, rain: 0.1, enclosure: 0.5 });
  const a = ambienceLevels(params), b = ambienceLevels(params);
  assert.deepEqual(a, b);
  assert.notEqual(a, b, 'a fresh object every call');
  assert.deepEqual(Object.keys(a).sort(), ['bar', 'birds', 'construction', 'crowd', 'hum', 'siren', 'subway']);
  const garbage = { crowd: NaN, traffic: -4, night: true, hour: 'midi', subway: 9, construction: Infinity, bar: -1, birds: '1',
    water: null, indoor: 2, rain: -0.5, enclosure: 7 };
  for (const input of [undefined, null, 42, {}, garbage, { hour: -30 }, { hour: 1e9 }, { hour: 24 }]) {
    for (const [layer, value] of Object.entries(ambienceLevels(input))) {
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `${layer} = ${value} for ${JSON.stringify(input)}`);
    }
  }
  assert.equal(ambienceLevels({ subway: 9 }).subway, ambienceLevels({ subway: 1 }).subway, 'params are clamped to 0..1');
  assert.equal(ambienceLevels({ night: true, bar: 1 }).bar, ambienceLevels({ night: 1, bar: 1 }).bar, 'a boolean night counts');
});

test('construction only works by day and the club only plays at night', async () => {
  const { ambienceLevels } = await load();
  for (const hour of [0, 2, 4.5, 6, 6.7, 18.3, 19, 21, 23.9]) {
    assert.equal(ambienceLevels({ ...EVERYTHING, hour, night: 1 }).construction, 0, `construction at ${hour} h`);
    assert.equal(ambienceLevels({ ...EVERYTHING, hour, night: 0 }).construction, 0, `construction at ${hour} h, lit`);
  }
  for (const hour of [7.5, 9, 12, 17.5]) assert.ok(ambienceLevels({ ...EVERYTHING, hour }).construction > 0, `construction at ${hour} h`);
  for (const hour of [4.3, 6, 9, 12, 15, 18, 19.7]) assert.equal(ambienceLevels({ ...EVERYTHING, hour, night: 1 }).bar, 0, `bar at ${hour} h`);
  for (const hour of [20.5, 22, 0, 1, 3.5]) assert.ok(ambienceLevels({ ...EVERYTHING, hour, night: 1 }).bar > 0, `bar at ${hour} h`);
  // Without an hour, night decides.
  assert.equal(ambienceLevels({ construction: 1, night: 1 }).construction, 0);
  assert.ok(ambienceLevels({ bar: 1, night: 1 }).bar > 0);
  assert.ok(ambienceLevels({ construction: 1 }).construction > 0);
});

test('being indoors lowers every layer by 12 dB', async () => {
  const { ambienceLevels } = await load();
  for (const base of [{ ...EVERYTHING, hour: 11 }, { ...EVERYTHING, hour: 23, night: 1 }]) {
    const outside = ambienceLevels(base), half = ambienceLevels({ ...base, indoor: 0.5 }), inside = ambienceLevels({ ...base, indoor: 1 });
    let audible = 0;
    for (const layer of Object.keys(outside)) {
      if (outside[layer] === 0) {
        assert.equal(inside[layer], 0, layer);
        continue;
      }
      audible++;
      assert.ok(inside[layer] < half[layer] && half[layer] < outside[layer], layer);
      assert.ok(Math.abs(20 * Math.log10(inside[layer] / outside[layer]) + 12) < 1e-9, `${layer} indoors is not -12 dB`);
    }
    assert.ok(audible >= 6);
  }
});

test('the crowd grows with pedestrian density, from silence', async () => {
  const { ambienceLevels } = await load();
  for (const base of [{}, { night: 1, hour: 23 }, { rain: 1 }, { indoor: 1, traffic: 1 }]) {
    let previous = -1;
    for (let step = 0; step <= 20; step++) {
      const value = ambienceLevels({ ...base, crowd: step / 20 }).crowd;
      assert.ok(value >= previous, `crowd ${step / 20} is quieter than ${(step - 1) / 20}`);
      previous = value;
    }
    assert.equal(ambienceLevels({ ...base, crowd: 0 }).crowd, 0);
    assert.ok(ambienceLevels({ ...base, crowd: 1 }).crowd > ambienceLevels({ ...base, crowd: 0.5 }).crowd);
  }
});

test('the baked bank is finite, audible, within full scale, and its loops have no seam', async () => {
  const { buffers, context } = await bakedVoice();
  const loops = ['swell', 'rumble', 'vent', 'babble', 'subway', 'air', 'bar', 'jackhammer', 'drill', 'clack'];
  let total = 0;
  for (const [name, entry] of Object.entries(buffers)) {
    assert.ok(entry, `${name} failed to bake`);
    for (const buffer of flatten(entry)) {
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        let energy = 0;
        for (const sample of data) {
          assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 1, `${name}: sample ${sample}`);
          energy += sample * sample;
        }
        assert.ok(Math.sqrt(energy / data.length) > 1e-3, `${name} channel ${channel} is silent`);
        if (loops.includes(name)) {
          // The jump from the last sample back to the first is an ordinary step of the signal.
          const steps = Array.from({ length: data.length - 1 }, (_, i) => Math.abs(data[i + 1] - data[i])).sort((x, y) => x - y);
          const seam = Math.abs(data[0] - data[data.length - 1]);
          assert.ok(seam <= steps[Math.floor(steps.length * 0.999)], `${name} channel ${channel} clicks at its loop point (${seam})`);
        }
      }
      total += buffer.length * buffer.numberOfChannels;
    }
  }
  assert.ok(total * 4 < 12e6, `the bank weighs ${(total * 4 / 1e6).toFixed(1)} MB`);
  assert.equal(context.late, 0);
});

test('the persistent graph stays within 40 nodes, with seven looping beds', async () => {
  const { context, voice } = await bakedVoice();
  run(voice, context, 3, QUIET);
  const live = context.live();
  assert.ok(live.length <= 40, `${live.length} persistent nodes`);
  const beds = context.started.filter((source) => source.loop && !source.disconnected);
  assert.equal(beds.length, 7);
  assert.equal(context.all.filter((node) => node.kind === 'oscillator').length, 0, 'everything is baked, no live oscillator');
});

test('a minute of every layer by day, then by night, runs cleanly and frees its one-shots', async () => {
  const { context, voice, buffers } = await bakedVoice();
  run(voice, context, 2, QUIET);
  const persistent = context.live().length;
  let peak = 0;
  const watch = () => { peak = Math.max(peak, context.live().length); };
  const dayStart = context.started.length;
  run(voice, context, 60, DAY, 1 / 60, watch);
  const day = context.started.slice(dayStart);
  const played = (list) => day.filter((source) => flatten(list).includes(source.buffer)).length;
  assert.ok(played(buffers.calls) >= 25, `${played(buffers.calls)} crowd calls in a dense minute`);
  assert.ok(played(buffers.jackhammer) >= 3, 'jackhammer bursts');
  assert.ok(played(buffers.drill) >= 1 && played(buffers.hammers) >= 3, 'drill and hammer');
  assert.ok(played(buffers.clack) >= 1, 'a train passed under the grate');
  assert.ok(played(buffers.coos) >= 1 && played(buffers.gulls) >= 1, 'pigeons and gulls');
  for (const source of day.filter((s) => s.buffer === buffers.jackhammer)) {
    const rate = source.playbackRate.value * 12.5, length = source.stopTime - source.startTime;
    assert.ok(rate >= 11 && rate <= 14, `jackhammer at ${rate} Hz`);
    assert.ok(length >= 2 - 1e-9 && length <= 5 + 1e-9, `jackhammer burst of ${length} s`);
  }
  assert.ok(peak <= persistent + 14 * 6, `${peak} live nodes at the busiest`);

  const nightStart = context.started.length, nightTime = context.currentTime;
  run(voice, context, 60, NIGHT);
  const lateNight = context.started.slice(nightStart).filter((source) => source.startTime > nightTime + 12);
  const construction = [buffers.jackhammer, buffers.drill, ...buffers.hammers];
  assert.equal(lateNight.filter((source) => construction.includes(source.buffer)).length, 0, 'no construction at night');

  run(voice, context, 30, QUIET);
  // Everything rare has ended and been released; at most one distant siren may still be crossing.
  assert.ok(context.live().length <= persistent + 3, `${context.live().length - persistent} nodes left over`);
  assert.equal(context.late, 0, 'no sound was scheduled in the past');
});

test('a car alarm chirps, then sirens for 12 to 20 s, then frees everything it built', async () => {
  const { context, voice, buffers } = await bakedVoice();
  const before = context.all.length;
  assert.equal(voice.event('alarm', 20, 0.8, -12), true);
  assert.equal(voice.event('alarm', 21, 0.8, -12), false, 'the same car does not set itself off twice');
  const built = () => context.all.slice(before);
  const panner = built().find((node) => node.kind === 'panner');
  assert.ok(panner, 'the alarm sits at its position');
  assert.deepEqual([panner.positionX.value, panner.positionY.value, panner.positionZ.value], [20, 0.8, -12]);
  run(voice, context, 25, QUIET);
  const modes = Object.values(buffers.alarm);
  const segments = context.started.filter((source) => modes.includes(source.buffer)).sort((a, b) => a.startTime - b.startTime);
  assert.equal(segments[0].buffer, buffers.alarm.chirp, 'chirps first');
  assert.ok(segments.slice(1).some((source) => source.buffer !== buffers.alarm.chirp), 'then the modulated siren');
  const length = Math.max(...segments.map((source) => source.stopTime)) - segments[0].startTime;
  assert.ok(length >= 11.9 && length <= 20.1, `alarm lasted ${length} s`);
  assert.deepEqual(built().filter((node) => !node.disconnected && !segments.includes(node) && node.kind === 'panner'), []);
  assert.ok(segments.every((source) => source.disconnected));
  assert.equal(voice.event('alarm', 5000, 0, 5000), false, 'too far away to hear');
});

test('pigeons and gulls answer explicit events; unknown events are ignored', async () => {
  const { context, voice, buffers } = await bakedVoice();
  const before = context.all.length;
  assert.equal(voice.event('coo', 2, 0.3, 1), true);
  assert.equal(voice.event('coo', 2, 0.3, 1), false, 'one pigeon at a time');
  assert.equal(voice.event('gull', 30, 12, 40), true);
  assert.equal(voice.event('boom', 0, 0, 0), false);
  assert.equal(voice.event(), false);
  context.advance(1);
  assert.equal(voice.event('gull'), true, 'without a position the cry is panned at random');
  const sources = context.all.slice(before).filter((node) => node.kind === 'buffer');
  assert.ok(sources.some((source) => buffers.coos.includes(source.buffer)));
  assert.ok(sources.filter((source) => buffers.gulls.includes(source.buffer)).length >= 2);
  run(voice, context, 10, QUIET);
  assert.deepEqual(context.all.slice(before).filter((node) => !node.disconnected), []);
});

test('only the audio clock schedules sound, whatever clock update() is given', async () => {
  const { context, voice } = await bakedVoice();
  const start = context.started.length;
  for (let i = 0; i < 300; i++) {
    context.advance(0.1);
    voice.update(DAY, 1e6 + i); // e.g. the game's elapsed time in milliseconds
  }
  const scheduled = context.started.slice(start);
  assert.ok(scheduled.length > 0);
  for (const source of scheduled) assert.ok(source.startTime < context.currentTime + 10, `a sound scheduled at ${source.startTime}`);
});

test('dispose fades out, stops every source and disconnects every node', async () => {
  for (const immediate of [false, true]) {
    const { context, voice } = await bakedVoice();
    run(voice, context, 20, DAY);
    voice.event('alarm', 5, 1, 5);
    voice.event('coo', 1, 0.2, 1);
    run(voice, context, 1, DAY);
    voice.dispose(immediate);
    if (!immediate) {
      assert.ok(context.live().length > 0, 'the graph stays connected while it fades');
      context.advance(0.5);
    }
    assert.deepEqual(context.live().map((node) => node.kind), []);
    for (const source of context.started) {
      assert.ok(source.stopTime !== undefined && source.stopTime <= context.currentTime + 1e-9, 'every source is stopped');
    }
    const count = context.all.length;
    voice.update(DAY, context.currentTime);
    assert.equal(voice.event('alarm', 1, 1, 1), false);
    voice.dispose();
    assert.equal(context.all.length, count, 'a disposed voice builds nothing');
  }
  // A suspended context may never dispatch `ended`: dispose releases at once.
  const { context, voice } = await bakedVoice({ state: 'suspended' });
  voice.dispose();
  assert.deepEqual(context.live(), []);
});
