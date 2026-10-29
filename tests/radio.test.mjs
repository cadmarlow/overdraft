import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATIONS, STYLES, RadioSystem, createRng, hashSeed, degreeSemitone, scalePitchClasses, chordDegrees, voiceLead,
  generateSong, songPlan, renderBar, sectionAt, stationClock, stationOffset, songSeed,
} from '../js/radio.js';

// A strict stand-in for the Web Audio API: it records scheduling and throws where a browser would.
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
    this.context.automation++;
    return this;
  }
  setValueAtTime(value, time) { return this.record(time, value); }
  linearRampToValueAtTime(value, time) { return this.record(time, value); }
  exponentialRampToValueAtTime(value, time) {
    if (value === 0) throw new RangeError('exponential ramp to zero');
    return this.record(time, value);
  }
  setTargetAtTime(value, time, constant) {
    if (constant < 0) throw new RangeError('negative time constant');
    return this.record(time, value, constant);
  }
  cancelScheduledValues(time) { return this.record(time); }
}

class FakeNode {
  constructor(context, params = {}) {
    this.context = context;
    this.outputs = new Set();
    this.disconnected = false;
    for (const [name, value] of Object.entries(params)) this[name] = new FakeParam(context, value);
    context.nodes++;
  }
  connect(target) {
    if (!(target instanceof FakeNode || target instanceof FakeParam)) throw new TypeError('connect target is not an AudioNode/AudioParam');
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
    if (this.buffer && offset > this.buffer.duration) throw new RangeError('offset beyond buffer');
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
  constructor({ state = 'running', sampleRate = 8000 } = {}) {
    this.currentTime = 0;
    this.sampleRate = sampleRate;
    this.state = state;
    this.nodes = 0;
    this.automation = 0;
    this.started = [];
    this.active = new Set();
    this.ended = [];
    this.destination = new FakeNode(this);
  }
  createGain() { return new FakeNode(this, { gain: 1 }); }
  createOscillator() { const node = new FakeSource(this, { frequency: 440, detune: 0 }); node.type = 'sine'; return node; }
  createBiquadFilter() { const node = new FakeNode(this, { frequency: 350, Q: 1, gain: 0, detune: 0 }); node.type = 'lowpass'; return node; }
  createBufferSource() { const node = new FakeSource(this, { playbackRate: 1, detune: 0 }); node.buffer = null; node.loop = false; return node; }
  createStereoPanner() { return new FakeNode(this, { pan: 0 }); }
  createDynamicsCompressor() { return new FakeNode(this, { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 }); }
  createWaveShaper() { const node = new FakeNode(this); node.curve = null; return node; }
  createDelay() { return new FakeNode(this, { delayTime: 0 }); }
  createConvolver() { const node = new FakeNode(this); node.buffer = null; return node; }
  createBuffer(channels, length, sampleRate) {
    if (!(length > 0) || !(channels > 0)) throw new Error('NotSupportedError');
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: i => data[i] };
  }
  // Moves the clock and fires `onended` like the audio thread would.
  advance(seconds) {
    this.currentTime += seconds;
    for (const source of [...this.active]) {
      if (source.stopTime !== undefined && source.stopTime <= this.currentTime) {
        this.active.delete(source);
        this.ended.push(source);
        source.onended?.();
      }
    }
  }
}

function run(radio, context, seconds, step = 1 / 60, check = () => {}) {
  for (let t = 0; t < seconds; t += step) {
    context.advance(step);
    radio.update();
    check();
  }
}

const SEEDS = Array.from({ length: 24 }, (_, i) => songSeed(0, i, 99) ^ (i * 7919));

test('seeded PRNG is deterministic, seed-sensitive and stays in [0, 1)', () => {
  const a = createRng(42), b = createRng(42), c = createRng(43), s = createRng('bruine:7');
  const seqA = Array.from({ length: 200 }, a), seqB = Array.from({ length: 200 }, b), seqC = Array.from({ length: 200 }, c);
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const value of [...seqA, ...Array.from({ length: 200 }, s)]) assert.ok(value >= 0 && value < 1);
  assert.ok(Math.abs(seqA.reduce((sum, v) => sum + v, 0) / seqA.length - 0.5) < 0.1);
  assert.equal(hashSeed('jungle-beton'), hashSeed('jungle-beton'));
  assert.notEqual(hashSeed('a'), hashSeed('b'));
});

test('diatonic chords are stacked thirds of the mode and skip clashing extensions', () => {
  const semis = (mode, degrees) => degrees.map(d => degreeSemitone(mode, d) % 12);
  assert.deepEqual(semis('ionian', chordDegrees('ionian', 0, 4)), [0, 4, 7, 11]); // Imaj7
  assert.deepEqual(semis('ionian', chordDegrees('ionian', 1, 5)), [2, 5, 9, 0, 4]); // ii9
  assert.deepEqual(semis('ionian', chordDegrees('ionian', 2, 5)), [4, 7, 11, 2]); // iii7: the b9 is dropped
  assert.ok(!semis('ionian', chordDegrees('ionian', 0, 6)).includes(5)); // no natural 11 over a major third
  assert.ok(semis('dorian', chordDegrees('dorian', 0, 6)).includes(5)); // minor 11th is welcome
  assert.deepEqual(scalePitchClasses(9, 'aeolian'), [9, 11, 0, 2, 4, 5, 7]);
});

test('voice leading keeps every pitch class, stays in range and moves little', () => {
  const next = voiceLead([60, 64, 67], [5, 9, 0], 50, 74); // C major to F major
  assert.deepEqual([...next.map(m => m % 12)].sort((a, b) => a - b), [0, 5, 9]);
  for (const midi of next) assert.ok(midi >= 50 && midi <= 74);
  const moved = next.reduce((sum, m, i) => sum + Math.abs(m - [60, 64, 67][i]), 0);
  assert.ok(moved <= 3, `moved ${moved} semitones`);
});

test('every chord, melody and diatonic bass note stays in the song key', () => {
  for (const station of STATIONS) {
    const style = STYLES[station.id];
    for (const seed of SEEDS) {
      const song = generateSong(station.id, seed);
      const scale = new Set(scalePitchClasses(song.tonic, song.mode));
      for (const prog of ['A', 'B']) {
        assert.equal(song.harmony[prog].length, 4);
        for (const chord of song.harmony[prog]) {
          for (const midi of chord.voicing) assert.ok(scale.has(midi % 12), `${station.id} chord note ${midi} out of key`);
          assert.ok(scale.has(chord.bass % 12));
          assert.ok(chord.voicing.length >= 3 && chord.voicing.length <= 4);
        }
      }
      for (let bar = 0; bar < song.totalBars; bar++) {
        for (const event of renderBar(song, bar)) {
          if (event.inst === 'lead' || event.inst === 'arp') assert.ok(scale.has(event.midi % 12), `${station.id} ${event.inst} ${event.midi}`);
          if (event.inst === 'bass' && !style.chromatic) assert.ok(scale.has(event.midi % 12), `${station.id} bass ${event.midi}`);
        }
      }
    }
  }
});

test('patterns have the right length and every event fits its bar', () => {
  for (const station of STATIONS) {
    const style = STYLES[station.id];
    for (const bank of Object.values(style.drums)) for (const pattern of bank) assert.match(pattern, /^[.1-9]{16}$/);
    const span = style.chordBars * 16;
    for (const pattern of style.bass) for (const [step, dur] of pattern) assert.ok(step >= 0 && step + dur <= span && dur > 0);
    for (const list of Object.values(style.comp)) for (const pattern of list) for (const [step, dur] of pattern) assert.ok(step >= 0 && step + dur <= span);
    for (const cells of [...Object.values(style.melody.cells), style.melody.cadences]) {
      for (const cell of cells) for (const [step, dur] of cell) assert.ok(step >= 0 && step + dur <= span);
    }
    const song = generateSong(station.id, SEEDS[3]);
    for (const melody of Object.values(song.melodies)) {
      assert.equal(melody.bars, style.chordBars * 4);
      assert.equal(melody.q.length, melody.a.length);
      for (const note of [...melody.q, ...melody.a]) assert.ok(note.step >= 0 && note.step < melody.bars * 16);
    }
    for (let bar = 0; bar < song.totalBars; bar++) {
      for (const event of renderBar(song, bar)) {
        assert.ok(Number.isInteger(event.step) && event.step >= 0 && event.step < 16, JSON.stringify(event));
        if ('dur' in event) assert.ok(event.dur > 0);
        if ('vel' in event) assert.ok(event.vel > 0 && event.vel <= 1.2);
      }
    }
    assert.deepEqual(renderBar(song, -1), []);
    assert.deepEqual(renderBar(song, song.totalBars), []);
  }
});

test('songs have a 2-3 minute intro/verse/chorus/break/outro form at the station tempo ±4 %', () => {
  for (const [index, station] of STATIONS.entries()) {
    for (const seed of SEEDS) {
      const song = generateSong(station.id, seed);
      assert.ok(Math.abs(song.bpm / station.bpm - 1) <= 0.0401, `${station.id} bpm ${song.bpm}`);
      assert.ok(song.duration >= 120 && song.duration <= 190, `${station.id} lasts ${song.duration}`);
      assert.ok(Math.abs(song.duration - song.totalSteps * song.stepDur) < 1e-9);
      let bar = 0;
      for (const section of song.sections) {
        assert.equal(section.startBar, bar);
        assert.ok(section.bars > 0);
        bar += section.bars;
      }
      assert.equal(bar, song.totalBars);
      const names = song.sections.map(s => s.name);
      assert.equal(names[0], 'intro');
      assert.equal(names.at(-1), 'outro');
      for (const name of ['verse', 'chorus', 'break']) assert.ok(names.includes(name), `${station.id} lacks ${name}`);
      assert.equal(sectionAt(song, 0).name, 'intro');
      assert.equal(sectionAt(song, song.totalBars - 1).name, 'outro');
      assert.equal(typeof song.title, 'string');
      assert.ok(song.title.length > 2 && !/undefined/.test(song.title + song.artist));
      assert.equal(songPlan(station.id, seed).title, song.title);
      assert.ok(index >= 0);
    }
  }
});

test('the arrangement changes per section: no drums in the break, fuller chorus, sweep into the drop', () => {
  for (const station of STATIONS) {
    const style = STYLES[station.id];
    const count = (song, name, inst) => {
      let total = 0, bars = 0;
      for (const section of song.sections.filter(s => s.name === name)) {
        for (let b = 0; b < section.bars; b++) {
          bars++;
          total += renderBar(song, section.startBar + b).filter(e => !inst || e.inst === inst).length;
        }
      }
      return total / Math.max(1, bars);
    };
    for (const seed of SEEDS.slice(0, 8)) {
      const song = generateSong(station.id, seed);
      assert.equal(count(song, 'break', 'kick'), 0);
      assert.equal(count(song, 'break', 'hat'), 0);
      assert.ok(count(song, 'chorus') > count(song, 'intro'), `${station.id} chorus is not fuller than the intro`);
      assert.ok(count(song, 'chorus', 'kick') > 0);
      const brk = song.sections.find(s => s.name === 'break');
      const lastBreakBar = renderBar(song, brk.startBar + brk.bars - 1);
      if (style.build) {
        const sweep = lastBreakBar.find(e => e.inst === 'sweep');
        assert.ok(sweep.to > sweep.from, `${station.id} break should open the filter into the drop`);
      }
      const after = song.sections[brk.index + 1];
      if (after.name === 'chorus') assert.ok(renderBar(song, after.startBar).some(e => e.inst === 'crash'));
    }
  }
});

test('songs are reproducible from their seed and vary between seeds', () => {
  for (const station of STATIONS) {
    assert.deepEqual(generateSong(station.id, 1234), generateSong(station.id, 1234));
    const songs = SEEDS.map(seed => generateSong(station.id, seed));
    assert.ok(new Set(songs.map(s => s.title)).size >= SEEDS.length * 0.6);
    assert.ok(new Set(songs.map(s => s.keyName)).size >= 4);
    assert.ok(new Set(songs.map(s => s.bpm)).size >= 6);
    assert.ok(new Set(songs.map(s => s.harmony.A.map(c => c.degree).join())).size >= 3);
  }
  assert.throws(() => generateSong('nope', 1));
});

test('the station clock is continuous, deterministic and differs per station', () => {
  for (let index = 0; index < STATIONS.length; index++) {
    let previous = null;
    for (let t = 0; t < 2400; t += 7.3) {
      const clock = stationClock(index, t, 5, previous);
      assert.deepEqual(clock, stationClock(index, t, 5));
      assert.ok(clock.start <= t && t < clock.start + clock.duration);
      assert.ok(Math.abs(clock.position - (t - clock.start)) < 1e-9);
      if (previous) {
        assert.ok(clock.songIndex >= previous.songIndex);
        if (clock.songIndex === previous.songIndex + 1) assert.ok(Math.abs(clock.start - (previous.start + previous.duration)) < 1e-6);
      }
      assert.equal(clock.duration, songPlan(STATIONS[index].id, clock.seed).duration);
      previous = clock;
    }
    assert.ok(previous.songIndex >= 12);
  }
  const offsets = STATIONS.map((_, i) => stationOffset(i, 5));
  assert.equal(new Set(offsets).size, STATIONS.length);
  assert.notEqual(stationClock(0, 500, 1).seed, stationClock(0, 500, 2).seed);
});

test('the radio schedules a few notes ahead, caps voices and cleans up ended voices', () => {
  const context = new FakeContext();
  const radio = new RadioSystem(context, context.destination, { seed: 11 });
  const changes = [];
  radio.onChange = info => changes.push(info);
  radio.update();
  assert.equal(context.started.length, 0, 'nothing plays before entering a car');
  radio.setPlaying(true);
  let maxVoices = 0, maxAhead = 0;
  run(radio, context, 30, 1 / 60, () => {
    maxVoices = Math.max(maxVoices, radio.voices);
    for (const source of context.started.slice(-40)) maxAhead = Math.max(maxAhead, source.startTime - context.currentTime);
  });
  assert.ok(context.started.length > 200, `only ${context.started.length} sources in 30 s`);
  assert.ok(maxVoices <= 18, `voices peaked at ${maxVoices}`);
  assert.ok(maxAhead < 0.3, `notes created ${maxAhead.toFixed(2)} s ahead`);
  for (const source of context.ended) assert.ok(source.disconnected, 'ended sources are disconnected');
  assert.ok(context.active.size < 120, `${context.active.size} sources still active`);
  assert.equal(radio.nowPlaying.name, STATIONS[0].name);
});

test('after a long gap the scheduler resyncs to now instead of replaying a backlog', () => {
  const context = new FakeContext();
  const radio = new RadioSystem(context, context.destination, { seed: 3, station: 3 });
  radio.setPlaying(true);
  run(radio, context, 5);
  context.advance(90); // background tab: no update() for 90 s while the audio clock runs
  const before = context.started.length, now = context.currentTime;
  radio.update();
  const fresh = context.started.slice(before);
  assert.ok(fresh.length < 120, `${fresh.length} sources created at once`);
  for (const source of fresh) assert.ok(source.startTime >= now - 1e-9 && source.startTime < now + 0.35);
  // The station kept "playing": the song on air matches the station clock.
  const clock = stationClock(3, context.currentTime, 3);
  assert.equal(radio.nowPlaying.song, songPlan(STATIONS[3].id, clock.seed).title);
  run(radio, context, 3);
});

test('stations switch with static and an ident, cycle through the off slot and resume live', () => {
  const context = new FakeContext();
  const radio = new RadioSystem(context, context.destination, { seed: 8 });
  const changes = [];
  radio.onChange = info => changes.push(info);
  radio.setPlaying(true);
  run(radio, context, 2);
  const before = context.started.length;
  radio.setStation(2);
  assert.ok(context.started.length - before >= 6, 'static and ident are created on switch');
  assert.equal(radio.stationIndex, 2);
  assert.equal(changes.at(-1).name, STATIONS[2].name);
  assert.equal(changes.at(-1).color, STATIONS[2].color);
  assert.equal(typeof changes.at(-1).song, 'string');
  run(radio, context, 4);
  const order = [];
  for (let i = 0; i < STATIONS.length + 1; i++) {
    radio.next();
    order.push(radio.stationIndex);
    run(radio, context, 0.5);
  }
  assert.deepEqual(order, [3, 4, -1, 0, 1, 2]);
  radio.prev();
  radio.prev();
  radio.prev();
  assert.equal(radio.stationIndex, -1);
  assert.equal(radio.nowPlaying, null);
  assert.equal(changes.at(-1), null);
  const silentStart = context.started.length;
  run(radio, context, 3);
  assert.ok(context.started.length - silentStart < 3, 'off is silent');
  radio.setStation(7);
  radio.setStation(Number.NaN);
  assert.equal(radio.stationIndex, -1, 'invalid indices are ignored');
  radio.setStation(4);
  run(radio, context, 3);
  assert.equal(radio.nowPlaying.name, STATIONS[4].name);
});

test('robust when suspended, when not playing and after dispose', () => {
  const context = new FakeContext({ state: 'suspended' });
  const radio = new RadioSystem(context, context.destination);
  radio.update();
  radio.setVolume(Number.NaN);
  radio.setVolume(3);
  radio.setMuffled(-1);
  radio.setMuffled(0.5);
  radio.setPlaying(true);
  for (let i = 0; i < 30; i++) radio.update(); // suspended: the clock does not move
  const scheduled = context.started.length;
  for (let i = 0; i < 30; i++) radio.update();
  assert.equal(context.started.length, scheduled, 'no repeated scheduling while the clock is frozen');
  context.state = 'running';
  run(radio, context, 4);
  radio.setPlaying(false);
  run(radio, context, 3);
  assert.equal(radio.bus, null, 'the station bus is released after the fade-out');
  const idle = context.started.length;
  run(radio, context, 2);
  assert.equal(context.started.length, idle);
  run(radio, context, 3);
  assert.equal(radio.voices, 0);
  radio.setPlaying(true);
  run(radio, context, 1);
  radio.dispose();
  radio.dispose();
  for (const source of context.active) assert.ok(source.stopTime !== undefined, 'dispose stops every source');
  radio.update();
  radio.setPlaying(true);
  radio.setStation(1);
  radio.next();
  assert.equal(radio.nowPlaying, null);
  run(radio, context, 1);
});
