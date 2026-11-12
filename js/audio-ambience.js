import { setControlRate } from './audio-synthesis.js';

// The sound bed of the city around the listener: seven layers, each behind its own smoothed gain, plus three
// events the game can trigger. No audio file: every buffer is baked here, at low sample rates where the content
// allows it, lazily (a few milliseconds per update) and cached on the shared resources object.
//
//   crowd         banded babble (300-3000 Hz, decorrelated stereo) with slow random swells, plus sparse calls,
//                 laughs and shouts synthesised with three formants (1 to 6 per 10 s with density)
//   subway        25-70 Hz rumble and rolling noise from a grate; a train passes every 40-90 s (6 s rise, plateau,
//                 fall) with the grate's piston draft, wheel joints, and a brake squeal or the rising inverter scale
//   construction  jackhammer bursts (11-14 Hz, 2-5 s, ringing steel), a distant drill, spaced hammer blows; 7 h-18 h
//   bar           four-on-the-floor kick and a simple bass line heard through a wall (250 Hz low-pass), 20 h-4 h
//   birds         pigeon coos (pigeons near) and descending gull cries (waterfront)
//   siren         a far, filtered siren with baked street echoes every 60-180 s, more often at night
//   hum           brown traffic rumble plus ventilation fans and transformer hum (60/120 Hz), by traffic and night
//
// event('alarm' | 'coo' | 'gull', x, y, z) plays at a world position through a cheap equal-power panner, which
// follows the context listener that the city audio system already moves. Without a position it is panned at random.
//
// Graph: layers -> bus -> indoor low-pass -> output -> destination, and bus -> short street reflections (two
// cross-fed delays, band-passed) -> indoor low-pass. 30 persistent nodes, 7 of them looping sources. Rare sounds are
// built on demand, scheduled slightly ahead on the audio clock, then stopped and disconnected.
//
// Baking: ~6.8 MB of buffers, ~300 ms of CPU in all, sliced at about 4 ms per update (beds first): the bank fills in
// ~80 updates (1.3 s at 60 per second). Layer gains open together once every bed runs. An explicit event bakes what
// it needs at once if the bank has not reached it yet (the alarm costs ~15 ms then).
//
// TO TUNE BY EAR. Nothing here could be listened to when it was written; in order of priority:
// 1. TUNING.level: each layer against cars, footsteps and the radio. Crowd, hum and construction first, the layers
//    heard most; the jackhammer may annoy but must not mask the game.
// 2. Laptop speakers reproduce almost nothing under ~90 Hz. The subway's 25-70 Hz rumble, the kick and the brown hum
//    reach them only through their 100-400 Hz content (TUNING.subway.growl, the kick's pitch sweep, the rumble's
//    body band in bakeRumble). Check on the MacBook speakers and on headphones.
// 3. Babble must read as people further down the street, not as filtered noise or a drone: talker count, formant
//    bandwidths and the voiced / breath ratio in bakeBabble; TUNING.crowd.call against the bed.
// 4. The distant siren must stay in the background and never pass for the game's police: TUNING.level.siren, the
//    1.3 kHz low-pass and the echoes in bakeSiren.
// 5. Street reflections: TUNING.reflections (send, feedback, 47/71 ms delays). Too much sounds like a tube.
// 6. Bar: the wall low-pass (250 Hz, opening towards 800 Hz at the door) and the kick / bass balance in bakeBar.
// 7. Pigeon pitch (380-560 Hz) and gurgle rate (~30 Hz), gull roughness, the car alarm's piezo timbre and level.

const TAU = Math.PI * 2;

// For scale, in the rest of the mix: the wind bed is ~0.003 RMS, a car at 10 m ~0.01-0.02, a footstep peaks ~0.05.
// Expected here at full presence: crowd bed ~0.006 RMS (calls peak 0.01-0.03), hum ~0.005, subway ~0.03 RMS of mostly
// sub-bass under a passing train, jackhammer ~0.014 RMS (peaks 0.09), club ~0.016, pigeons peak 0.02-0.05,
// distant siren peaks 0.01-0.02, car alarm peaks 0.08 at 6 m.
const TUNING = {
  // Gain of each layer at full presence, before the indoor attenuation. Loops are baked at BED_RMS (or at a 0.98
  // peak when their crest factor is high: the babble lands near 0.13 RMS).
  level: { crowd: 0.07, subway: 0.12, construction: 0.3, bar: 0.075, birds: 0.06, siren: 0.03, hum: 0.022, fountain: 0.12 },
  indoor: { db: -12, cutoff: 800, open: 18000 },
  crowd: { call: [0.2, 0.5] },
  hum: { rumble: 1, vent: 0.55 },
  subway: { growl: 0.5, idle: 0.2, draft: 0.15, gust: 0.6, clack: 0.35, squeal: 0.22, inverter: 0.16, interval: [40, 90] },
  construction: { jackhammer: 0.35, drill: 0.22, hammer: 0.3 },
  birds: { coo: [0.5, 1], gull: [0.4, 1] },
  siren: { interval: [60, 180], night: 0.55 },
  events: { alarm: 0.1, coo: 0.08, gull: 0.15 },
  reflections: { send: [0.04, 0.34], feedback: [0.18, 0.3], delays: [0.047, 0.071] }
};

const BED_RMS = 0.25;
const LOOKAHEAD = 0.3; // seconds of rare sounds created ahead on the audio clock
const CONTROL_INTERVAL = 0.05; // layer gains are re-targeted at most 20 times per second
const BAKE_BUDGET_MS = 4; // buffer baking per update while the bank fills
const MAX_GROUPS = 14; // concurrent on-demand sounds, 2 to 5 nodes each
const MAX_AMBIENT_GROUPS = 9; // the rest stays free for explicit events
const BAR_BPM = 124;
const UNIT_PARAMS = ['crowd', 'traffic', 'night', 'subway', 'construction', 'bar', 'birds', 'water', 'fountain', 'indoor', 'rain', 'enclosure', 'wasteland'];
let voiceSerial = 0;

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, finite(value)));
const unitValue = (value) => clamp(typeof value === 'boolean' ? Number(value) : value);
const smoothstep = (value) => { const x = clamp(value); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const pole = (frequency, rate) => 1 - Math.exp(-TAU * frequency / rate);
const triangle = (x) => 1 - Math.abs(2 * (x - Math.floor(x)) - 1);
const clock = () => globalThis.performance?.now?.() ?? Date.now();

function randomSource(seed) {
  let state = (finite(seed, 1) * 2654435761) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x7feb352d);
  state = Math.imul(state ^ (state >>> 15), 0x846ca68b);
  state ^= state >>> 16;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Levels: pure, so the mix can be tested without an audio context.

function readParams(params, out) {
  const source = params && typeof params === 'object' ? params : {};
  for (const key of UNIT_PARAMS) out[key] = unitValue(source[key]);
  const hour = typeof source.hour === 'number' ? source.hour : NaN;
  out.hour = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : out.night > 0.5 ? 23 : 13;
  return out;
}

// 1 between `open` and `close` (hours; close may pass midnight as close > 24), eased over half an hour, 0 outside.
function openHours(hour, open, close) {
  const ramp = 0.5;
  const at = (h) => smoothstep((h - open + ramp / 2) / ramp) * smoothstep((close + ramp / 2 - h) / ramp);
  return Math.max(at(hour), at(hour + 24));
}

const indoorFactor = (indoor) => Math.pow(10, TUNING.indoor.db * indoor / 20);

function computeLevels(p, out) {
  const level = TUNING.level, indoor = indoorFactor(p.indoor);
  const work = openHours(p.hour, 7, 18), nightlife = openHours(p.hour, 20, 28);
  out.crowd = level.crowd * Math.pow(p.crowd, 0.75) * (1 - 0.45 * p.rain) * indoor;
  out.subway = level.subway * Math.pow(p.subway, 1.4) * indoor;
  out.construction = level.construction * Math.pow(p.construction, 1.2) * work * (1 - 0.6 * p.rain) * indoor;
  out.bar = level.bar * Math.pow(p.bar, 1.3) * nightlife * indoor;
  // Pigeons roost and gulls quieten at night; both shelter from the rain.
  out.birds = level.birds * Math.pow(Math.max(p.birds, p.water * 0.9), 0.8) * (1 - 0.7 * p.night) * (1 - 0.85 * p.rain) * indoor;
  out.siren = level.siren * (0.8 + 0.4 * p.night) * indoor * (1 - p.wasteland);
  out.hum = level.hum * (0.65 + 0.35 * p.traffic) * (1 - 0.2 * p.night) * indoor * (1 - .94 * p.wasteland);
  out.fountain = level.fountain * p.fountain ** 1.5 * indoor;
  return out;
}

const blankParams = () => ({ crowd: 0, traffic: 0, night: 0, hour: 13, subway: 0, construction: 0, bar: 0, birds: 0,
  water: 0, fountain: 0, indoor: 0, rain: 0, enclosure: 0, wasteland: 0 });

// Target gain of every layer for the given params, indoor attenuation included.
export function ambienceLevels(params) {
  return computeLevels(readParams(params, blankParams()), {});
}

// ---------------------------------------------------------------------------------------------------------------
// Baking. Every baker is a generator that yields about every 2048 samples, so the bank can spread the work over
// several frames within BAKE_BUDGET_MS. Filters run over whole arrays; loops either cross-fade their own
// continuation into their start (continuous noise) or fold the tail of their last events onto the beginning
// (event trains), so they never click at the seam.

const SLICE = 2047; // yield when (i & SLICE) === SLICE

// sin(2π·cycles) and other periodic waves from tables with linear interpolation (error below -120 dB for the sine).
function waveTable(size, value) {
  const table = new Float64Array(size + 1);
  for (let i = 0; i <= size; i++) table[i] = value(i / size);
  return table;
}
function lookup(table, cycles) {
  const size = table.length - 1, x = (cycles - Math.floor(cycles)) * size, i = x | 0;
  return table[i] + (table[i + 1] - table[i]) * (x - i);
}
const SINE = waveTable(4096, (x) => Math.sin(TAU * x));
const sine = (cycles) => lookup(SINE, cycles);
const sawTable = (count) => waveTable(2048, (x) => {
  let value = 0;
  for (let n = 1; n <= count; n++) value += Math.sin(TAU * n * x) / n;
  return value;
});
const SAW3 = sawTable(3), SAW6 = sawTable(6);
// A car alarm's piezo: odd harmonics up to 1, 3, 5 or 7, a little second harmonic, softly clipped.
const PIEZO = [1, 3, 5, 7].map((limit) => waveTable(2048, (x) => {
  let value = 0.12 * Math.sin(TAU * 2 * x);
  for (let h = 1; h <= limit; h += 2) value += Math.sin(TAU * h * x) / h;
  return Math.tanh(value * 1.4);
}));

// Whole-array passes slice more coarsely than the synthesis loops: they are much cheaper per sample.
const PASS = 8191;

function* noise(length, random) {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = random() * 2 - 1;
    if ((i & PASS) === PASS) yield;
  }
  return data;
}

function* lowpass(data, frequency, rate, passes = 1) {
  const k = pole(Math.min(frequency, rate * 0.45), rate);
  for (let pass = 0; pass < passes; pass++) {
    let y = 0;
    for (let i = 0; i < data.length; i++) {
      y += (data[i] - y) * k;
      data[i] = y;
      if ((i & PASS) === PASS) yield;
    }
  }
  return data;
}

function* highpass(data, frequency, rate) {
  const k = pole(frequency, rate);
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y += (data[i] - y) * k;
    data[i] -= y;
    if ((i & PASS) === PASS) yield;
  }
  return data;
}

function* band(data, low, high, rate) {
  yield* highpass(data, low, rate);
  return yield* lowpass(data, high, rate, 2);
}

function* scaleTo(data, target, peak) {
  let value = 0;
  for (let i = 0; i < data.length; i++) {
    value = peak ? Math.max(value, Math.abs(data[i])) : value + data[i] * data[i];
    if ((i & PASS) === PASS) yield;
  }
  if (!peak) value = Math.sqrt(value / data.length);
  const scale = value > 0 ? target / value : 0;
  for (let i = 0; i < data.length; i++) {
    data[i] *= scale;
    if ((i & PASS) === PASS) yield;
  }
  return data;
}
const unit = (data) => scaleTo(data, 1, false);
const peakUnit = (data) => scaleTo(data, 1, true);

// A smooth random curve in [0, 1] with about `rate` independent values per second, read once per sample.
function wander(random, rate, sampleRate) {
  const step = rate / sampleRate;
  let from = random(), to = random(), position = 0;
  return () => {
    position += step;
    if (position >= 1) { position -= 1; from = to; to = random(); }
    return from + (to - from) * position * position * (3 - 2 * position);
  };
}

// Two-pole resonator coefficients for a centre frequency and bandwidth (Hz).
function resonance(frequency, bandwidth, rate) {
  const radius = Math.exp(-Math.PI * bandwidth / rate);
  return [2 * radius * Math.cos(TAU * Math.min(frequency, rate * 0.45) / rate), radius * radius, 1 - radius];
}

// Remove DC per channel, then scale to a peak (and optionally an RMS, whichever is lower).
function* level(buffer, { rms = 0, peak = 0.8, center = true } = {}) {
  let energy = 0, maximum = 0, count = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    if (center) {
      let mean = 0;
      for (let i = 0; i < data.length; i++) mean += data[i];
      mean /= data.length;
      for (let i = 0; i < data.length; i++) data[i] -= mean;
      yield;
    }
    for (let i = 0; i < data.length; i++) {
      energy += data[i] * data[i];
      maximum = Math.max(maximum, Math.abs(data[i]));
      if ((i & PASS) === PASS) yield;
    }
    count += data.length;
  }
  let scale = maximum > 0 ? peak / maximum : 0;
  if (rms > 0 && energy > 0) scale = Math.min(scale, rms / Math.sqrt(energy / count));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      data[i] *= scale;
      if ((i & PASS) === PASS) yield;
    }
  }
  return buffer;
}

function* bakeShot(ctx, rate, duration, render, peak = 0.8) {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.round(duration * rate)), rate);
  const data = buffer.getChannelData(0);
  yield* render(data, rate);
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length;
  const fadeIn = rate * 0.002, fadeOut = rate * 0.012;
  for (let i = 0; i < data.length; i++) data[i] = (data[i] - mean) * Math.min(1, i / fadeIn, (data.length - 1 - i) / fadeOut);
  yield;
  return yield* level(buffer, { peak, center: false });
}

// render(length, channel) returns warm-up + loop + overlap samples; `periodic` then adds content that completes
// whole cycles in the loop (tones), which must not be cross-faded with itself.
function* bakeLoop(ctx, { rate, duration, channels = 1, fade = 0.4, warm = 0.25 }, render, periodic) {
  const length = Math.round(duration * rate), overlap = Math.round(fade * rate), lead = Math.round(warm * rate);
  const buffer = ctx.createBuffer(channels, length, rate);
  for (let channel = 0; channel < channels; channel++) {
    const raw = yield* render(lead + length + overlap, channel);
    const out = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) out[i] = raw[lead + i];
    for (let i = 0; i < overlap; i++) {
      const x = i / overlap;
      out[i] = raw[lead + length + i] * Math.sqrt(1 - x) + raw[lead + i] * Math.sqrt(x);
    }
    // Both sides of a stereo bed carry the same energy, whatever their random content.
    if (channels > 1) yield* unit(out);
    if (periodic) yield* periodic(out, channel, rate);
    yield;
  }
  return yield* level(buffer, { rms: BED_RMS, peak: 0.98 });
}

// Event trains: render with a tail, then add the tail onto the start, as if the loop had always been playing.
function* bakeFolded(ctx, rate, duration, tail, render, options) {
  const length = Math.round(duration * rate), extra = Math.round(tail * rate);
  const raw = new Float32Array(length + extra);
  yield* render(raw, rate);
  const buffer = ctx.createBuffer(1, length, rate);
  const out = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) out[i] = raw[i] + (i < extra ? raw[length + i] : 0);
  yield;
  return yield* level(buffer, options);
}

// Decaying sine partials [frequency, decay seconds, weight], stepped incrementally (no exp per sample).
function partials(list, rate, random, detune = 1) {
  return list.map(([frequency, decay, weight]) => ({
    step: frequency * detune / rate, phase: random(), envelope: weight, fall: Math.exp(-1 / (decay * rate))
  }));
}
function ring(set) {
  let value = 0;
  for (const partial of set) {
    value += sine(partial.phase) * partial.envelope;
    partial.phase += partial.step;
    partial.envelope *= partial.fall;
  }
  return value;
}

// ---------------------------------------------------------------------------------------------------------------
// Beds (looping).

function* bakeRumble(ctx) {
  const rate = 8000;
  return yield* bakeLoop(ctx, { rate, duration: 6.4, channels: 2, fade: 0.5 }, function* (length, channel) {
    const random = randomSource(7101 + channel * 31);
    // Brown noise (a 14 Hz one-pole) kept between 22 and 170 Hz, plus a body band laptops can reproduce.
    const deep = yield* noise(length, random);
    yield* lowpass(deep, 14, rate);
    yield* lowpass(deep, 170, rate, 2);
    yield* highpass(deep, 22, rate);
    yield* unit(deep);
    const body = yield* noise(length, random);
    yield* band(body, 130, 420, rate);
    yield* unit(body);
    const swell = wander(random, 0.3, rate);
    for (let i = 0; i < length; i++) {
      deep[i] = (deep[i] + body[i] * 0.3) * (0.7 + 0.3 * swell());
      if ((i & PASS) === PASS) yield;
    }
    return deep;
  });
}

function* bakeVent(ctx) {
  const rate = 11025;
  return yield* bakeLoop(ctx, { rate, duration: 6, channels: 2, fade: 0.5 }, function* (length, channel) {
    const random = randomSource(7203 + channel * 17);
    const fan = yield* noise(length, random);
    yield* band(fan, 170, 1100, rate);
    yield* unit(fan);
    const speed = wander(random, 0.5, rate);
    for (let i = 0; i < length; i++) {
      fan[i] *= 0.85 + 0.15 * speed();
      if ((i & PASS) === PASS) yield;
    }
    return fan;
  }, function* (out, channel, rate) {
    // Every tone completes a whole number of cycles in 6 s, so it runs straight through the seam. US transformer
    // hum sits at twice the 60 Hz mains; each side has a different rooftop fan.
    const blade = channel ? 340 / 3 : 97.5;
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      const breathe = 1 + 0.25 * sine(t / 6 + channel * 0.3);
      out[i] += (0.07 * sine(60 * t) + 0.16 * sine(120 * t + 0.06) + 0.05 * sine(240 * t + 0.18) + 0.025 * sine(360 * t + 0.37)) * breathe
        + 0.09 * sine(blade * t + channel * 0.16) * (1 + 0.3 * sine(t / 3));
      if ((i & SLICE) === SLICE) yield;
    }
  });
}

// Slow crowd swells in [0.38, 0.92], when the wind's gust signal is not available to share.
function* bakeSwell(ctx) {
  const rate = 8000, length = rate * 19;
  const buffer = ctx.createBuffer(1, length, rate), data = buffer.getChannelData(0);
  const random = randomSource(7307), knots = Array.from({ length: 23 }, random);
  for (let i = 0; i < length; i++) {
    const position = i / length * knots.length, index = Math.floor(position), x = position - index;
    const a = knots[index % knots.length], b = knots[(index + 1) % knots.length];
    data[i] = 0.38 + 0.54 * (a + (b - a) * x * x * (3 - 2 * x));
    if ((i & SLICE) === SLICE) yield;
  }
  return buffer;
}

const BABBLE_VOWELS = [[730, 1090], [530, 1840], [300, 2200], [570, 840], [320, 870], [640, 1190], [490, 1350]];

function* bakeBabble(ctx) {
  const rate = 11025;
  return yield* bakeLoop(ctx, { rate, duration: 6.6, channels: 2, fade: 0.5 }, function* (length, channel) {
    const random = randomSource(7411 + channel * 53);
    const out = new Float32Array(length), dt = 1 / rate;
    const [, b1, g1] = resonance(500, 150, rate), [, b2, g2] = resonance(1500, 210, rate);
    // Five talkers per side, each with its own pitch, vocal tract size and loudness, speaking in syllables and pauses.
    for (let talker = 0; talker < 5; talker++) {
      const pitch = 95 + random() * 140, size = 0.9 + random() * 0.25, gain = 0.35 + random() * 0.65;
      let phase = random(), elapsed = random() * 0.3, duration = 0.2, amplitude = 0, step = 0;
      let a1 = 0, a2 = 0, y11 = 0, y12 = 0, y21 = 0, y22 = 0;
      for (let i = 0; i < length; i++) {
        elapsed += dt;
        if (elapsed >= duration) {
          elapsed -= duration;
          if (random() < 0.16) {
            duration = 0.2 + random() * 0.8;
            amplitude = 0;
          } else {
            duration = 0.1 + random() * 0.17;
            amplitude = 0.45 + random() * 0.55;
            const vowel = BABBLE_VOWELS[Math.floor(random() * BABBLE_VOWELS.length)];
            a1 = resonance(vowel[0] * size, 150, rate)[0];
            a2 = resonance(vowel[1] * size, 210, rate)[0];
            step = pitch * (0.9 + random() * 0.22) * dt;
          }
        }
        // A syllable rises and falls (4x(1-x))^2, close to sin^2, while its pitch sags a little.
        const x = elapsed / duration, shape = 16 * x * x * (1 - x) * (1 - x);
        phase += step * (1 - 0.08 * x);
        if (phase >= 1) phase -= 1;
        const excitation = ((phase * 2 - 1) * 0.6 + (random() * 2 - 1) * 0.45) * amplitude * shape;
        const y1 = g1 * excitation + a1 * y11 - b1 * y12;
        y12 = y11; y11 = y1;
        const y2 = g2 * excitation + a2 * y21 - b2 * y22;
        y22 = y21; y21 = y2;
        out[i] += (y1 + y2 * 0.75) * gain;
        if ((i & SLICE) === SLICE) yield;
      }
    }
    yield* band(out, 300, 3000, rate);
    yield* highpass(out, 300, rate);
    const activity = wander(random, 0.25, rate);
    for (let i = 0; i < length; i++) {
      out[i] *= 0.75 + 0.25 * activity();
      if ((i & PASS) === PASS) yield;
    }
    return out;
  });
}

function* bakeSubway(ctx) {
  const rate = 8000;
  return yield* bakeLoop(ctx, { rate, duration: 6, fade: 0.5 }, function* (length) {
    const random = randomSource(7517);
    const rumble = yield* noise(length, random);
    yield* lowpass(rumble, 70, rate, 2);
    yield* highpass(rumble, 25, rate);
    yield* unit(rumble);
    const growl = yield* noise(length, random);
    yield* band(growl, 85, 320, rate);
    yield* unit(growl);
    const roll = yield* noise(length, random);
    yield* highpass(roll, 300, rate);
    yield* lowpass(roll, 1500, rate);
    yield* unit(roll);
    const track = wander(random, 7, rate), growlLevel = TUNING.subway.growl;
    for (let i = 0; i < length; i++) {
      rumble[i] += growl[i] * growlLevel * (0.55 + 0.45 * track()) + roll[i] * 0.14;
      if ((i & PASS) === PASS) yield;
    }
    return rumble;
  }, function* (out, channel, rate) {
    // Traction motor hum, whole cycles in 6 s.
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      out[i] += 0.22 * sine(140 / 3 * t) + 0.1 * sine(280 / 3 * t + 0.11);
      if ((i & SLICE) === SLICE) yield;
    }
  });
}

function* bakeAir(ctx) {
  const rate = 11025;
  return yield* bakeLoop(ctx, { rate, duration: 5, fade: 0.5 }, function* (length) {
    const random = randomSource(7621);
    const air = yield* noise(length, random);
    yield* band(air, 260, 1700, rate);
    yield* unit(air);
    const flutter = wander(random, 4, rate), drift = wander(random, 0.5, rate);
    for (let i = 0; i < length; i++) {
      air[i] *= (0.65 + 0.35 * flutter()) * (0.8 + 0.2 * drift());
      if ((i & PASS) === PASS) yield;
    }
    return air;
  });
}

function* bakeFountain(ctx) {
  const rate = 16000;
  return yield* bakeLoop(ctx, { rate, duration: 7, fade: 0.55 }, function* (length) {
    const random = randomSource(11132);
    const flow = yield* noise(length, random), drops = yield* noise(length, random);
    yield* band(flow, 620, 2900, rate);
    yield* band(drops, 2050, 5600, rate);
    yield* unit(flow);
    yield* unit(drops);
    const pulse = wander(random, 21, rate), water = wander(random, 3.6, rate);
    for (let i = 0; i < length; i++) {
      flow[i] = flow[i] * (0.61 + 0.23 * water()) + drops[i] * (0.03 + 0.16 * pulse() ** 3);
      if ((i & PASS) === PASS) yield;
    }
    return flow;
  });
}

// Eight bars of house at 124 BPM, already dull: only what passes through a wall is rendered.
function* bakeBar(ctx) {
  const rate = 8000, beat = 60 / BAR_BPM, bars = 8;
  return yield* bakeFolded(ctx, rate, bars * 4 * beat, 0.6, function* (raw) {
    const random = randomSource(7933), length = raw.length;
    const render = (duration, voice) => {
      const sound = new Float32Array(Math.round(duration * rate));
      for (let i = 0; i < sound.length; i++) sound[i] = voice(i / rate);
      return sound;
    };
    const place = (target, sound, time, gain = 1) => {
      const start = Math.round(time * rate), count = Math.min(sound.length, length - start);
      for (let i = 0; i < count; i++) target[start + i] += sound[i] * gain;
    };
    // The kick's pitch falls from 160 to 50 Hz: the sweep is what a laptop speaker renders of it.
    const kickSound = render(0.45, (t) => sine(50 * t + 110 * 0.035 * (1 - Math.exp(-t / 0.035)))
      * Math.exp(-t / 0.2) * (1 - Math.exp(-t / 0.0015)));
    const claps = [0, 1].map(() => render(0.2, (t) => (random() * 2 - 1) * Math.exp(-t / 0.05) + sine(185 * t) * Math.exp(-t / 0.04) * 0.6));
    const notes = new Map();
    const bassSound = (frequency, duration, hold) => {
      const key = `${frequency}/${hold}`;
      if (!notes.has(key)) {
        notes.set(key, render(duration, (t) => lookup(SAW6, frequency * t) * smoothstep(t / 0.006)
          * (t < hold ? 1 - 0.3 * t / hold : 0.7 * Math.exp(-(t - hold) / 0.02))));
      }
      return notes.get(key);
    };
    const kick = new Float32Array(length), bass = new Float32Array(length);
    const clap = new Float32Array(length), pad = new Float32Array(length);
    const chords = [[55, [220, 261.63, 329.63]], [43.65, [174.61, 220, 261.63]], [65.41, [196, 261.63, 329.63]],
      [49, [196, 246.94, 293.66]]];
    for (let bar = 0; bar < bars; bar++) {
      const [root, triad] = chords[Math.floor(bar / 2) % chords.length];
      const at = bar * 4 * beat;
      if (bar % 2 === 0) {
        const hold = beat * 8 + 0.2, start = Math.round(at * rate), count = Math.min(Math.round(hold * rate), length - start);
        for (const frequency of triad) {
          for (let i = 0; i < count; i++) {
            const t = i / rate;
            pad[start + i] += lookup(SAW3, frequency * t) * smoothstep(t / 0.08) * smoothstep((hold - t) / 0.2);
            if ((i & SLICE) === SLICE) yield;
          }
        }
      }
      for (let k = 0; k < 4; k++) {
        const time = at + k * beat;
        yield;
        place(kick, kickSound, time);
        place(bass, bassSound(root * (bar % 2 === 1 && k === 3 ? 2 : 1), 0.29, 0.19), time + beat / 2);
        if (bar >= 4 && (k === 1 || k === 3)) place(bass, bassSound(root * 1.5, 0.19, 0.09), time + beat * 0.75, 0.6);
        if (k === 1 || k === 3) place(clap, claps[k === 1 ? 0 : 1], time);
      }
    }
    yield* lowpass(bass, 300, rate, 2);
    yield* band(clap, 250, 1100, rate);
    yield* lowpass(pad, 500, rate, 2);
    for (const part of [kick, bass, clap, pad]) yield* peakUnit(part);
    for (let i = 0; i < length; i++) {
      raw[i] = kick[i] + bass[i] * 0.55 + clap[i] * 0.28 + pad[i] * 0.12;
      if ((i & PASS) === PASS) yield;
    }
  }, { rms: BED_RMS, peak: 0.98 });
}

// ---------------------------------------------------------------------------------------------------------------
// One-shots and event loops.

function* bakeClack(ctx) {
  const rate = 11025;
  return yield* bakeFolded(ctx, rate, 3, 0.2, function* (raw) {
    const random = randomSource(7723);
    const hit = (time, amplitude) => {
      const start = Math.round(time * rate), pitch = 120 + random() * 50, ringing = 2100 + random() * 500;
      for (let i = 0; i < rate * 0.16 && start + i < raw.length; i++) {
        const t = i / rate;
        raw[start + i] += amplitude * (sine(pitch * t) * Math.exp(-t / 0.022) * 0.9
          + (random() * 2 - 1) * Math.exp(-t / 0.004) * 0.6 + sine(ringing * t) * Math.exp(-t / 0.03) * 0.22);
      }
    };
    // Two axles per truck; the trucks of two coupled cars close together, then a car length.
    for (const pair of [0.08, 0.6, 1.58, 2.1]) {
      const at = pair + random() * 0.02;
      hit(at, 0.8 + random() * 0.2);
      hit(at + 0.16 + random() * 0.015, 0.65 + random() * 0.2);
      yield;
    }
    yield* lowpass(raw, 3200, rate);
  }, { peak: 0.8 });
}

function* bakeSqueal(ctx) {
  return yield* bakeShot(ctx, 16000, 3.4, function* (data, rate) {
    const random = randomSource(7829);
    const pitch = wander(random, 3, rate), grip = wander(random, 9, rate);
    let phase = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate;
      phase += (2850 + 260 * pitch()) / rate;
      // Stick-slip between flange and rail: intermittent, never a steady whistle.
      const slip = Math.pow(grip(), 2.2);
      const envelope = smoothstep(t / 0.5) * smoothstep((3.4 - t) / 0.9);
      data[i] = (sine(phase) + 0.3 * sine(2 * phase) + (random() * 2 - 1) * 0.08) * slip * envelope;
      if ((i & SLICE) === SLICE) yield;
    }
    yield* lowpass(data, 5200, rate);
  });
}

// The rising scale of a departing train's traction inverters, heard from a grate.
function* bakeInverter(ctx) {
  const notes = [349.2, 392, 440, 466.2, 523.3, 587.3, 659.3, 698.5], step = 0.34, duration = 3.9;
  return yield* bakeShot(ctx, 11025, duration, function* (data, rate) {
    let phase = 0, frequency = notes[0];
    for (let i = 0; i < data.length; i++) {
      const t = i / rate;
      const target = t < notes.length * step ? notes[Math.min(notes.length - 1, Math.floor(t / step))]
        : notes[notes.length - 1] * (1 + (t - notes.length * step) * 0.35);
      frequency += (target - frequency) * 0.004;
      phase += frequency / rate;
      const envelope = smoothstep(t / 0.25) * smoothstep((duration - t) / 0.9);
      data[i] = (sine(phase) + 0.25 * sine(3 * phase) + 0.1 * sine(5 * phase)) * envelope;
      if ((i & SLICE) === SLICE) yield;
    }
    yield* lowpass(data, 2400, rate);
  });
}

const JACKHAMMER_MODES = [[1180, 0.045, 1], [1760, 0.034, 0.7], [2650, 0.026, 0.5], [3870, 0.018, 0.33], [5300, 0.011, 0.2]];

// Eight piston strikes at 12.5 Hz; playback rate 0.88-1.12 gives 11-14 Hz.
function* bakeJackhammer(ctx) {
  const rate = 22050, period = 0.08, strikes = 8;
  return yield* bakeFolded(ctx, rate, period * strikes, 0.1, function* (raw) {
    const random = randomSource(8039), count = Math.round(0.1 * rate), lowK = pole(500, rate);
    for (let s = 0; s < strikes; s++) {
      const start = Math.round((s * period + 0.002 + random() * 0.003) * rate);
      const amplitude = 0.8 + random() * 0.2, steel = partials(JACKHAMMER_MODES, rate, random, 0.99 + random() * 0.02);
      let debris = 0;
      for (let i = 0; i < count; i++) {
        const t = i / rate, white = random() * 2 - 1;
        debris += (white - debris) * lowK;
        // Chisel click, ringing steel, the concrete's thud and grit, then the pneumatic exhaust.
        const exhaust = t > 0.022 ? white * Math.exp(-(t - 0.022) / 0.03) * 0.16 : 0;
        raw[start + i] += amplitude * (white * Math.exp(-t / 0.0015) * 0.5 + ring(steel) * 0.42
          + sine(95 * t) * Math.exp(-t / 0.018) * 0.8 + debris * Math.exp(-t / 0.03) * 1.2 + exhaust);
      }
      yield;
    }
    yield* lowpass(raw, 7000, rate);
  }, { peak: 0.85 });
}

function* bakeDrill(ctx) {
  const rate = 16000;
  return yield* bakeLoop(ctx, { rate, duration: 1, fade: 0.25, warm: 0.1 }, function* (length) {
    const random = randomSource(8147);
    const hiss = yield* noise(length, random);
    yield* highpass(hiss, 1800, rate);
    yield* lowpass(hiss, 4800, rate);
    return yield* scaleTo(hiss, 0.12, false);
  }, function* (out, channel, rate) {
    // A 230 Hz motor with its gearbox buzz around 1.1 kHz (whole cycles in the 1 s loop).
    const random = randomSource(8148);
    const weights = Array.from({ length: 16 }, (_, i) => {
      const frequency = 230 * (i + 1);
      return Math.pow(i + 1, -0.7) * (1 + 2 * Math.exp(-(((frequency - 1100) / 380) ** 2))) * (frequency > 3200 ? 0.4 : 1);
    });
    const phases = weights.map(() => random());
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      let tone = 0;
      for (let n = 0; n < weights.length; n++) tone += sine(230 * (n + 1) * t + phases[n]) * weights[n];
      out[i] += tone * 0.25 * (1 + 0.15 * sine(23 * t));
      if ((i & SLICE) === SLICE) yield;
    }
  });
}

const HAMMERS = [
  [[2150, 0.12, 1], [3420, 0.08, 0.6], [5100, 0.05, 0.4], [7300, 0.03, 0.2], [420, 0.03, 0.5]], // steel on steel
  [[2900, 0.035, 0.7], [4600, 0.025, 0.4], [320, 0.04, 1], [650, 0.03, 0.5]], // a nail into a beam
  [[1450, 0.02, 0.3], [180, 0.035, 1], [420, 0.03, 0.6]] // plywood
];

function* bakeHammers(ctx) {
  const out = [];
  for (let index = 0; index < HAMMERS.length; index++) {
    out.push(yield* bakeShot(ctx, 22050, 0.5, function* (data, rate) {
      const random = randomSource(8251 + index), set = partials(HAMMERS[index], rate, random, 0.97 + random() * 0.06);
      for (let i = 0; i < data.length; i++) {
        data[i] = (random() * 2 - 1) * Math.exp(-i / (rate * 0.0008)) * 0.6 + ring(set);
        if ((i & SLICE) === SLICE) yield;
      }
      // A slap from the facade across the street, darker than the blow itself.
      const echo = yield* lowpass(data.slice(), 2500, rate), delay = Math.round((0.06 + random() * 0.05) * rate);
      for (let i = data.length - 1; i >= delay; i--) data[i] += echo[i - delay] * 0.3;
      yield* lowpass(data, 6500, rate);
    }));
  }
  return out;
}

// Rock dove perch coo, "oo-roo-coo": a nearly pure low tone, a fast throat gurgle on the middle syllable, breath.
// Syllables: [start, length, pitch start, middle, end, vibrato Hz, vibrato depth, gurgle, amplitude].
const COOS = [
  [[0, 0.16, 440, 455, 445, 7, 0.01, 0, 0.6], [0.24, 0.36, 430, 530, 480, 30, 0.05, 0.6, 1], [0.7, 0.55, 520, 470, 390, 6, 0.015, 0.15, 0.85]],
  [[0, 0.14, 400, 410, 400, 6, 0.01, 0, 0.5], [0.2, 0.44, 390, 480, 440, 27, 0.06, 0.7, 1], [0.72, 0.6, 470, 430, 350, 5, 0.02, 0.2, 0.8]],
  [[0, 0.3, 420, 500, 460, 33, 0.05, 0.55, 1], [0.38, 0.5, 490, 450, 380, 6, 0.015, 0.1, 0.75]]
];

function* bakeCoos(ctx) {
  const out = [];
  for (let index = 0; index < COOS.length; index++) {
    const syllables = COOS[index], last = syllables[syllables.length - 1];
    out.push(yield* bakeShot(ctx, 16000, last[0] + last[1] + 0.05, function* (data, rate) {
      const random = randomSource(8353 + index), breathK = pole(900, rate);
      let phase = 0, breath = 0, current = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i / rate;
        breath += (random() * 2 - 1 - breath) * breathK;
        while (current < syllables.length && t > syllables[current][0] + syllables[current][1]) current++;
        const syllable = syllables[current];
        if (syllable && t >= syllable[0]) {
          const [start, length, f0, f1, f2, vibrato, depth, gurgle, amplitude] = syllable;
          const local = t - start, x = local / length;
          const frequency = x < 0.4 ? f0 + (f1 - f0) * x / 0.4 : f1 + (f2 - f1) * (x - 0.4) / 0.6;
          phase += frequency * (1 + depth * sine(vibrato * local)) / rate;
          const throat = 1 - gurgle * 0.5 * (1 + sine(vibrato * local + 0.2));
          const envelope = smoothstep(local / 0.045) * smoothstep((length - local) / 0.09) * amplitude;
          data[i] = ((sine(phase) + 0.22 * sine(2 * phase) + 0.06 * sine(3 * phase)) * throat + breath * 0.5) * envelope;
        }
        if ((i & SLICE) === SLICE) yield;
      }
      yield* lowpass(data, 2200, rate);
    }));
  }
  return out;
}

const GULL_HARMONICS = [1, 0.75, 0.6, 0.4, 0.28, 0.18, 0.12];

// A harsh, falling call: a quick rise, then an exponential glide down, rough with an 85 Hz flutter.
function* gullNote(data, rate, random, start, length, f0, f1, f2, amplitude, rough) {
  const offset = Math.round(start * rate), count = Math.min(Math.round(length * rate), data.length - offset);
  let phase = 0;
  for (let i = 0; i < count; i++) {
    const t = i / rate, x = t / length;
    const frequency = x < 0.15 ? f0 + (f1 - f0) * smoothstep(x / 0.15) : f1 * Math.pow(f2 / f1, (x - 0.15) / 0.85);
    phase += frequency / rate;
    const partialsCount = Math.min(GULL_HARMONICS.length, Math.floor(9500 / frequency));
    let value = 0;
    for (let n = 1; n <= partialsCount; n++) value += sine(n * phase) * GULL_HARMONICS[n - 1];
    const flutter = 1 - rough * 0.5 * (1 + sine(85 * t));
    const envelope = smoothstep(t / 0.015) * smoothstep((length - t) / 0.06) * amplitude;
    data[offset + i] += (value * flutter + (random() * 2 - 1) * 0.12) * envelope;
    if ((i & SLICE) === SLICE) yield;
  }
}

function* bakeGulls(ctx) {
  const calls = [
    [0.85, [[0.02, 0.5, 1250, 1650, 850, 1, 0.35]]],
    [1.9, [[0.02, 0.42, 1300, 1700, 950, 1, 0.3],
      ...[0, 1, 2, 3, 4].map((k) => [0.55 + k * 0.2, 0.13, 1500 - 60 * k, 1650 - 60 * k, (1650 - 60 * k) * 0.72, 0.85 - 0.08 * k, 0.4])]],
    [0.75, [0, 1, 2].map((k) => [0.02 + k * 0.16, 0.09, 1550, 1700, 1300, 0.9, 0.5])]
  ];
  const out = [];
  for (let index = 0; index < calls.length; index++) {
    const [duration, notes] = calls[index];
    out.push(yield* bakeShot(ctx, 22050, duration, function* (data, rate) {
      const random = randomSource(8461 + index);
      for (const note of notes) yield* gullNote(data, rate, random, ...note);
      yield* highpass(data, 600, rate);
      yield* lowpass(data, 7000, rate);
      // Open water and the far quay give one late, dark echo.
      const echo = yield* lowpass(data.slice(), 2500, rate), delay = Math.round(0.21 * rate);
      for (let i = data.length - 1; i >= delay; i--) data[i] += echo[i - delay] * 0.16;
    }));
  }
  return out;
}

// Vowel formants (Hz) for the crowd's calls.
const FORMANTS = { a: [730, 1090, 2440], e: [530, 1840, 2480], i: [300, 2200, 2950], o: [570, 840, 2410],
  u: [320, 870, 2240], uh: [640, 1190, 2390] };
// Segments: [start, length, from vowel, to vowel, pitch start, middle, end, amplitude, breath, aspirated onset].
const CALLS = [
  { scale: 1, segments: [[0, 0.32, 'e', 'i', 140, 178, 128, 1, 0.08, 0.05]] }, // "hey!"
  { scale: 1.14, segments: [[0, 0.3, 'e', 'i', 235, 285, 215, 1, 0.1, 0.05]] },
  { scale: 1, segments: [0, 1, 2, 3].map((k) => [k * 0.17, 0.11, 'a', 'uh', 165 - 6 * k, 160 - 6 * k, 150 - 6 * k, 1 - 0.15 * k, 0.35, 0.03]) }, // laugh
  { scale: 1.14, segments: [0, 1, 2, 3, 4].map((k) => [k * 0.15, 0.1, 'a', 'a', 270 - 8 * k, 265 - 8 * k, 250 - 8 * k, 1 - 0.12 * k, 0.4, 0.03]) },
  { scale: 1.12, segments: [[0, 0.36, 'o', 'u', 300, 270, 215, 1, 0.08, 0]] }, // "oh!"
  { scale: 1, segments: [[0, 0.26, 'i', 'o', 150, 140, 118, 1, 0.06, 0]] }, // "yo!"
  { scale: 1, segments: [[0, 0.15, 'a', 'a', 135, 140, 138, 0.85, 0.05, 0], [0.21, 0.3, 'e', 'i', 150, 172, 135, 1, 0.08, 0]] }, // "taxi!"
  { scale: 1.15, segments: [[0, 0.62, 'u', 'u', 280, 360, 430, 1, 0.12, 0.06]] }, // "whoo!"
  { scale: 1, segments: [[0, 0.46, 'a', 'i', 152, 158, 128, 1, 0.07, 0]] }, // "ayyy"
  { scale: 1.12, segments: [[0, 0.16, 'uh', 'uh', 210, 205, 190, 0.8, 0.12, 0.04], [0.24, 0.22, 'uh', 'uh', 235, 250, 262, 0.9, 0.12, 0.04]] } // "uh-huh"
];
const CALL_BANDWIDTHS = [90, 120, 170], CALL_WEIGHTS = [1, 0.7, 0.35];

function* bakeCall(ctx, call, seed) {
  const segments = call.segments, last = segments[segments.length - 1];
  return yield* bakeShot(ctx, 16000, last[0] + last[1] + 0.06, function* (data, rate) {
    const random = randomSource(seed), open = 0.6, close = 0.2;
    const a = new Float64Array(3), b = new Float64Array(3), g = new Float64Array(3), y1 = new Float64Array(3), y2 = new Float64Array(3);
    for (let k = 0; k < 3; k++) [a[k], b[k], g[k]] = resonance(FORMANTS[segments[0][2]][k], CALL_BANDWIDTHS[k], rate);
    let phase = 0, lastFlow = 0, jitter = 1, current = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate;
      while (current < segments.length && t >= segments[current][0] + segments[current][1]) current++;
      const segment = segments[current];
      let excitation = 0;
      if (segment && t >= segment[0]) {
        const [start, length, from, to, p0, p1, p2, amplitude, breath, onset] = segment;
        const local = t - start, x = local / length;
        if ((i & 31) === 0) {
          const mix = smoothstep(x);
          for (let k = 0; k < 3; k++) a[k] = resonance(lerp(FORMANTS[from][k], FORMANTS[to][k], mix) * call.scale, CALL_BANDWIDTHS[k], rate)[0];
        }
        const pitch = (x < 0.5 ? lerp(p0, p1, x * 2) : lerp(p1, p2, (x - 0.5) * 2)) * jitter;
        phase += pitch / rate;
        if (phase >= 1) { phase -= 1; jitter = 0.99 + random() * 0.02; }
        // Glottal flow pulses (cos(πu) = sin(2π(1/4 - u/2))), with an aspirated "h" before voicing when asked.
        const flow = phase < open ? 0.5 - 0.5 * sine(0.25 - 0.5 * phase / open)
          : phase < open + close ? sine(0.25 - 0.25 * (phase - open) / close) : 0;
        const pulse = (flow - lastFlow) * rate / (pitch * 6);
        lastFlow = flow;
        const voicing = onset > 0 ? smoothstep((local - onset * 0.5) / (onset * 0.5)) : 1;
        const envelope = smoothstep(local / 0.025) * smoothstep((length - local) / 0.07) * amplitude;
        excitation = (pulse * voicing + (random() * 2 - 1) * (breath * voicing + (1 - voicing) * 0.6)) * envelope;
      }
      let value = 0;
      for (let k = 0; k < 3; k++) {
        const y = g[k] * excitation + a[k] * y1[k] - b[k] * y2[k];
        y2[k] = y1[k];
        y1[k] = y;
        value += y * CALL_WEIGHTS[k];
      }
      data[i] = value;
      if ((i & SLICE) === SLICE) yield;
    }
    yield* highpass(data, 150, rate);
    yield* lowpass(data, 4500, rate);
  });
}

function* bakeCalls(ctx) {
  const out = [];
  for (let index = 0; index < CALLS.length; index++) out.push(yield* bakeCall(ctx, CALLS[index], 8671 + index * 7));
  return out;
}

const AIR_HORNS = [[5.6, 6.3], [6.6, 7.4]];

// Far sirens: 0 is an electronic wail with a stretch of yelp, 1 a fire truck's mechanical siren with air horns.
function* bakeSiren(ctx, kind) {
  const duration = 14;
  return yield* bakeShot(ctx, 11025, duration, function* (data, rate) {
    const random = randomSource(kind ? 8563 : 8569), drift = wander(random, 0.3, rate);
    const wind = (from, to, t) => to - (to - from) * Math.exp(-t / 1.1);
    const coast = (from, t) => 0.35 + (from - 0.35) * Math.exp(-t / 2.4);
    const s35 = wind(0.25, 1, 3.5), s85 = coast(s35, 5), s115 = wind(s85, 1, 3);
    let phase = 0, growl = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate, wobble = 1 + 0.03 * (drift() - 0.5);
      let value;
      if (!kind) {
        let frequency;
        if (t >= 6.4 && t < 9.4) frequency = 720 + 700 * triangle(t * 3.3);
        else {
          const c = (t % 4.4) / 4.4;
          frequency = 680 + 760 * (c < 0.42 ? smoothstep(c / 0.42) : 1 - smoothstep((c - 0.42) / 0.58));
        }
        phase += frequency * wobble / rate;
        value = sine(phase) + 0.3 * sine(3 * phase);
      } else {
        // The rotor winds up, coasts, winds up again: its speed is continuous, so the pitch never jumps.
        const spin = t < 3.5 ? wind(0.25, 1, t) : t < 8.5 ? coast(s35, t - 3.5) : t < 11.5 ? wind(s85, 1, t - 8.5) : coast(s115, t - 11.5);
        phase += 1050 * spin * wobble / rate;
        growl += 70 * spin / rate;
        value = (sine(phase) + 0.45 * sine(2 * phase) + 0.25 * sine(3 * phase)) * (0.75 + 0.25 * sine(growl));
        for (const [from, to] of AIR_HORNS) {
          if (t < from || t >= to) continue;
          const local = t - from;
          const envelope = smoothstep(local / 0.03) * smoothstep((to - from - local) / 0.08) * 0.55;
          value += (lookup(SAW6, 233 * t) + lookup(SAW6, 294 * t)) * envelope;
        }
      }
      data[i] = value;
      if ((i & SLICE) === SLICE) yield;
    }
    // Far away only the low partials survive, the avenues add late echoes, and buildings pass in between.
    yield* lowpass(data, 1300, rate, 2);
    const dark = yield* lowpass(data.slice(), 800, rate), dry = data.slice();
    for (const [delay, gain] of [[0.12, 0.42], [0.26, 0.3], [0.41, 0.2]]) {
      const offset = Math.round(delay * rate);
      for (let i = offset; i < data.length; i++) {
        data[i] += (dark[i - offset] * 0.7 + dry[i - offset] * 0.3) * gain;
        if ((i & PASS) === PASS) yield;
      }
    }
    const shade = wander(random, 0.35, rate);
    for (let i = 0; i < data.length; i++) {
      const t = i / rate;
      data[i] *= smoothstep(t / 3.2) * smoothstep((duration - t) / 4) * (0.6 + 0.4 * shade());
      if ((i & PASS) === PASS) yield;
    }
  });
}

function* bakeAlarm(ctx) {
  const rate = 22050, length = 2.4;
  // [frequency(t), gate(t)] per mode. Sweeps are exponential; gates have 3 ms edges.
  const sweep = (t, period, active, from, to) => { const c = t % period; return c < active ? from * Math.pow(to / from, c / active) : 0; };
  const gate = (t, period, active) => { const c = t % period; return smoothstep(c / 0.003) * smoothstep((active - c) / 0.003); };
  const modes = {
    chirp: [(t) => sweep(t, 0.11, 0.075, 1250, 2500), (t) => gate(t, 0.11, 0.075)],
    whoop: [(t) => sweep(t, 0.6, 0.55, 650, 2100), (t) => gate(t, 0.6, 0.55)],
    yelp: [(t) => 900 + 1000 * triangle(t * 5.5), () => 1],
    raygun: [(t) => sweep(t, 0.2, 0.17, 2500, 800), (t) => gate(t, 0.2, 0.17)]
  };
  const out = {};
  for (const [name, [frequencyAt, gateAt]] of Object.entries(modes)) {
    out[name] = yield* bakeShot(ctx, rate, length, function* (data) {
      let phase = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i / rate, frequency = frequencyAt(t), open = gateAt(t);
        if (frequency > 0 && open > 0) {
          phase += frequency / rate;
          // Band-limit the piezo: only the odd harmonics below 10 kHz.
          const table = PIEZO[Math.min(3, Math.max(0, Math.floor((10000 / frequency - 1) / 2)))];
          data[i] = lookup(table, phase) * open;
        }
        if ((i & SLICE) === SLICE) yield;
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The bank of baked buffers, shared by every ambience voice of a context. The beds come first.

const BAKERS = {
  swell: bakeSwell, rumble: bakeRumble, vent: bakeVent, babble: bakeBabble, subway: bakeSubway, air: bakeAir, bar: bakeBar,
  calls: bakeCalls, jackhammer: bakeJackhammer, drill: bakeDrill, hammers: bakeHammers, coos: bakeCoos, gulls: bakeGulls,
  sirenWail: (ctx) => bakeSiren(ctx, 0), sirenFire: (ctx) => bakeSiren(ctx, 1), alarm: bakeAlarm, clack: bakeClack,
  squeal: bakeSqueal, inverter: bakeInverter, fountain: bakeFountain
};

function ambienceBank(context, resources) {
  const shared = resources && typeof resources === 'object' ? resources : null;
  if (shared?.ambienceBank?.context === context) return shared.ambienceBank;
  const bank = { context, buffers: {}, pending: Object.keys(BAKERS), job: null };
  // Reuse the wind's gust signal for the crowd's swells (played at another rate, so they do not move together).
  if (shared?.gusts) {
    bank.buffers.swell = shared.gusts;
    bank.pending = bank.pending.filter((name) => name !== 'swell');
  }
  if (shared && Object.isExtensible(shared)) shared.ambienceBank = bank;
  return bank;
}

function settle(bank, name, value) {
  bank.buffers[name] = value ?? null;
  const index = bank.pending.indexOf(name);
  if (index >= 0) bank.pending.splice(index, 1);
  if (bank.job?.name === name) bank.job = null;
}

// Bake one buffer now (an explicit event needs it), continuing its job if the bank had already started it.
function need(bank, name) {
  if (bank.buffers[name] !== undefined) return bank.buffers[name];
  const iterator = bank.job?.name === name ? bank.job.iterator : BAKERS[name](bank.context);
  try {
    let step = iterator.next();
    while (!step.done) step = iterator.next();
    settle(bank, name, step.value);
  } catch (error) {
    console.warn(`[audio] ambience: unable to bake ${name}`, error);
    settle(bank, name, null);
  }
  return bank.buffers[name];
}

// Advance the bank by at least one slice, then for as long as the budget (ms) allows.
function pump(bank, budget) {
  const start = clock();
  for (let first = true; bank.pending.length && (first || clock() - start < budget); first = false) {
    const name = bank.pending[0];
    if (!bank.job) bank.job = { name, iterator: BAKERS[name](bank.context) };
    try {
      const step = bank.job.iterator.next();
      if (step.done) settle(bank, name, step.value);
    } catch (error) {
      console.warn(`[audio] ambience: unable to bake ${name}`, error);
      settle(bank, name, null);
    }
  }
}

function hold(param, time) {
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(time);
  else param.cancelScheduledValues(time);
}

function stopSource(source, when) {
  try { source.stop(when); } catch { /* already stopped */ }
}

function envelope(param, start, end, value, attack, release) {
  param.setValueAtTime(0, start);
  param.linearRampToValueAtTime(value, start + attack);
  param.setValueAtTime(value, Math.max(start + attack, end - release));
  param.linearRampToValueAtTime(0, end);
}

// ---------------------------------------------------------------------------------------------------------------

export function createAmbienceVoice(context, resources = {}, destination = context.destination) {
  const bank = ambienceBank(context, resources);
  const random = randomSource(0x616d62 + (voiceSerial++) * 7919);
  const range = (low, high) => low + (high - low) * random();
  const pick = (list) => list[Math.floor(random() * list.length)];
  const nyquist = context.sampleRate * 0.45;
  const persistent = [], persistentSources = [], groups = new Set(), queue = [];
  const p = blankParams(), levels = computeLevels(p, {});
  const timers = { call: Infinity, train: Infinity, jack: Infinity, drill: Infinity, hammer: Infinity, coo: Infinity,
    gull: Infinity, siren: Infinity };
  let disposed = false, released = false, remaining = 0, nextControl = -Infinity, bedsReady = false;
  let subwaySource = null, barSource = null, barQuietSince = 0, barRerolled = true;
  let sitePan = 0, jackLeft = 0, trainBusyUntil = 0, lastCoo = -Infinity, lastGull = -Infinity;

  const own = (node) => { persistent.push(node); return node; };
  const gainNode = (value = 0) => {
    const node = own(context.createGain());
    node.gain.value = value;
    return node;
  };
  const filterNode = (type, frequency, q) => {
    const node = own(context.createBiquadFilter());
    setControlRate(node.frequency, node.detune, node.Q, node.gain);
    node.type = type;
    node.frequency.value = Math.min(frequency, nyquist);
    node.Q.value = q;
    return node;
  };
  const delayNode = (time) => {
    const node = own(context.createDelay(0.2));
    setControlRate(node.delayTime);
    node.delayTime.value = time;
    return node;
  };

  // Master section, then the short street reflections: two cross-fed delays through one band-pass.
  const output = gainNode(1);
  output.connect(destination);
  const indoorFilter = filterNode('lowpass', TUNING.indoor.open, 0.5);
  indoorFilter.connect(output);
  const bus = gainNode(1);
  bus.connect(indoorFilter);
  const send = gainNode(0);
  const echoA = delayNode(TUNING.reflections.delays[0]), echoB = delayNode(TUNING.reflections.delays[1]);
  const damp = filterNode('bandpass', 1300, 0.45);
  const feedbackA = gainNode(0), feedbackB = gainNode(0);
  bus.connect(send);
  send.connect(echoA);
  send.connect(echoB);
  echoA.connect(damp);
  echoB.connect(damp);
  damp.connect(feedbackA).connect(echoA);
  damp.connect(feedbackB).connect(echoB);
  damp.connect(indoorFilter);

  // Layers.
  const crowdMod = gainNode(0), crowdGain = gainNode(0);
  crowdMod.connect(crowdGain).connect(bus);
  const rumbleGain = gainNode(0), ventGain = gainNode(0), fountainGain = gainNode(0);
  fountainGain.connect(bus);
  rumbleGain.connect(bus);
  ventGain.connect(bus);
  const subFilter = filterNode('lowpass', 260, 0.6), trainGain = gainNode(TUNING.subway.idle);
  const airGain = gainNode(TUNING.subway.draft), subwayGain = gainNode(0);
  subFilter.connect(trainGain).connect(subwayGain);
  airGain.connect(subwayGain);
  subwayGain.connect(bus);
  const constructionGain = gainNode(0);
  constructionGain.connect(bus);
  const barFilter = filterNode('lowpass', 250, 0.9), barGain = gainNode(0);
  barFilter.connect(barGain).connect(bus);
  const birdsGain = gainNode(0), sirenGain = gainNode(0), eventsGain = gainNode(1);
  for (const node of [birdsGain, sirenGain, eventsGain]) node.connect(bus);

  const smoother = (param, timeConstant) => {
    let target = NaN;
    return (value, now) => {
      if (Math.abs(value - target) <= Math.max(1e-5, Math.abs(target) * 0.01)) return;
      param.cancelScheduledValues(now);
      param.setTargetAtTime(value, now, timeConstant);
      target = value;
    };
  };
  const set = {
    crowd: smoother(crowdGain.gain, 0.6), rumble: smoother(rumbleGain.gain, 0.8), vent: smoother(ventGain.gain, 0.8),
    fountain: smoother(fountainGain.gain, 0.35), subway: smoother(subwayGain.gain, 0.5), construction: smoother(constructionGain.gain, 0.5),
    bar: smoother(barGain.gain, 0.5), barCutoff: smoother(barFilter.frequency, 0.4), birds: smoother(birdsGain.gain, 0.8),
    siren: smoother(sirenGain.gain, 1.2), events: smoother(eventsGain.gain, 0.25), indoor: smoother(indoorFilter.frequency, 0.25),
    send: smoother(send.gain, 0.5), feedbackA: smoother(feedbackA.gain, 0.5), feedbackB: smoother(feedbackB.gain, 0.5)
  };

  const barRate = () => range(120, 128) / BAR_BPM;
  const loop = (name, target, when, rate = 1) => {
    const buffer = bank.buffers[name];
    const source = own(context.createBufferSource());
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = rate;
    source.connect(target);
    source.onended = () => { if (disposed && --remaining === 0) release(); };
    source.start(when, random() * buffer.duration * 0.95);
    persistentSources.push(source);
    return source;
  };
  const beds = [
    { needs: ['babble', 'swell'], start: (t) => { loop('babble', crowdMod, t); loop('swell', crowdMod.gain, t, 0.61); } },
    { needs: ['rumble'], start: (t) => loop('rumble', rumbleGain, t) },
    { needs: ['vent'], start: (t) => loop('vent', ventGain, t) },
    { needs: ['fountain'], start: (t) => loop('fountain', fountainGain, t) },
    { needs: ['subway'], start: (t) => { subwaySource = loop('subway', subFilter, t); } },
    { needs: ['air'], start: (t) => loop('air', airGain, t) },
    { needs: ['bar'], start: (t) => { barSource = loop('bar', barFilter, t, barRate()); barQuietSince = t; } }
  ];
  const startBeds = (t) => {
    let ready = true;
    for (const bed of beds) {
      if (bed.started) continue;
      const buffers = bed.needs.map((name) => bank.buffers[name]);
      if (buffers.some((buffer) => buffer === undefined)) { ready = false; continue; }
      bed.started = true;
      if (buffers.every(Boolean)) bed.start(t);
    }
    // Layer gains stay closed until every bed runs, so a late bed never starts at full level.
    bedsReady = ready;
  };

  // On-demand sounds: source(s) -> [low-pass] -> gain -> [panner] -> a layer bus. Closed once past `end`.
  function openGroup(target, { volume = 1, pan = null, panner = null, cutoff = 0, end = 0, kind = 'ambient', explicit = false } = {}) {
    const nodes = [];
    let tail = target, panNode = null;
    if (panner) {
      panner.connect(tail);
      tail = panner;
      nodes.push(panner);
    } else if (pan !== null) {
      panNode = context.createStereoPanner();
      panNode.pan.value = clamp(pan, -1, 1);
      panNode.connect(tail);
      tail = panNode;
      nodes.push(panNode);
    }
    const gain = context.createGain();
    gain.gain.value = volume;
    gain.connect(tail);
    nodes.push(gain);
    let input = gain;
    if (cutoff > 0) {
      const filter = context.createBiquadFilter();
      setControlRate(filter.frequency, filter.detune, filter.Q, filter.gain);
      filter.type = 'lowpass';
      filter.frequency.value = Math.min(cutoff, nyquist);
      filter.Q.value = 0.5;
      filter.connect(gain);
      input = filter;
      nodes.push(filter);
    }
    const group = { kind, explicit, gain, input, panNode, nodes, sources: [], end, x: NaN, y: NaN, z: NaN, closed: false, fading: false };
    groups.add(group);
    return group;
  }
  function playIn(group, buffer, when, { rate = 1, loop: looping = false, stop = 0, offset = 0 } = {}) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = looping;
    source.playbackRate.value = rate;
    source.connect(group.input);
    const end = stop || when + buffer.duration / rate;
    source.start(when, offset);
    source.stop(end);
    group.sources.push(source);
    group.nodes.push(source);
    group.end = Math.max(group.end, end + 0.05);
    return source;
  }
  function close(group) {
    group.closed = true;
    for (const source of group.sources) stopSource(source, context.currentTime);
    for (const node of group.nodes) node.disconnect();
    groups.delete(group);
  }
  function fade(group, now) {
    if (group.fading) return;
    group.fading = true;
    hold(group.gain.gain, now);
    group.gain.gain.setTargetAtTime(0, now, 0.02);
    for (const source of group.sources) stopSource(source, now + 0.12);
    group.end = Math.min(group.end, now + 0.17);
  }
  const ambientRoom = () => groups.size < MAX_AMBIENT_GROUPS;
  const later = (time, run) => queue.push({ time, run });

  function listenerDistance(x, y, z) {
    const listener = context.listener;
    const lx = listener?.positionX?.value, ly = listener?.positionY?.value, lz = listener?.positionZ?.value;
    return Number.isFinite(lx) && Number.isFinite(ly) && Number.isFinite(lz) ? Math.hypot(x - lx, y - ly, z - lz) : NaN;
  }
  // Explicit events sit at a world position (equal-power panner, air absorption by distance) on the events bus.
  function explicitGroup(kind, x, y, z, levelValue, refDistance, end, now) {
    const placed = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
    let panner = null, cutoff = 0;
    if (placed && typeof context.createPanner === 'function') {
      const distance = listenerDistance(x, y, z);
      if (distance > 400) return null;
      if (Number.isFinite(distance)) cutoff = 1800 + 14000 * Math.exp(-distance / 70);
      panner = context.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = refDistance;
      panner.rolloffFactor = 1;
      panner.maxDistance = 1000;
      if (panner.positionX) {
        setControlRate(panner.positionX, panner.positionY, panner.positionZ, panner.orientationX, panner.orientationY, panner.orientationZ);
        panner.positionX.value = x;
        panner.positionY.value = y;
        panner.positionZ.value = z;
      } else panner.setPosition?.(x, y, z);
    }
    if (groups.size >= MAX_GROUPS) {
      const victim = [...groups].find((group) => !group.explicit && !group.fading);
      if (!victim) return null;
      fade(victim, now);
    }
    const group = openGroup(eventsGain, { volume: levelValue, panner, pan: panner ? null : placed ? 0 : range(-0.6, 0.6),
      cutoff, end, kind, explicit: true });
    group.x = x; group.y = y; group.z = z;
    return group;
  }

  // ---- ambient spawners
  function spawnCall(at) {
    const calls = bank.buffers.calls;
    if (!calls || !ambientRoom()) return;
    const near = random(), [quiet, loud] = TUNING.crowd.call;
    const group = openGroup(crowdGain, { volume: lerp(quiet, loud, near), pan: range(-0.95, 0.95), cutoff: 1400 + 3600 * near * near, end: at });
    playIn(group, pick(calls), at, { rate: range(0.84, 1.2) });
  }
  function spawnJackhammer(at, duration) {
    const buffer = bank.buffers.jackhammer;
    if (!buffer || !ambientRoom()) return;
    const end = at + duration;
    const group = openGroup(constructionGain, { volume: 0, pan: sitePan + range(-0.05, 0.05), end });
    envelope(group.gain.gain, at, end, TUNING.construction.jackhammer, 0.025, 0.06);
    playIn(group, buffer, at, { rate: range(0.88, 1.12), loop: true, stop: end, offset: random() * buffer.duration * 0.9 });
  }
  function spawnDrill(at) {
    const buffer = bank.buffers.drill;
    if (!buffer || !ambientRoom()) return;
    const duration = range(1.5, 4), end = at + duration;
    const group = openGroup(constructionGain, { volume: 0, pan: clamp(sitePan + range(-0.4, 0.4), -1, 1), cutoff: 2600, end });
    envelope(group.gain.gain, at, end, TUNING.construction.drill, 0.18, 0.3);
    const rate = playIn(group, buffer, at, { rate: 0.55, loop: true, stop: end, offset: random() * buffer.duration * 0.9 }).playbackRate;
    // Spin up, bite into the material once, spin down.
    const bite = at + range(0.5, duration - 0.8);
    rate.setValueAtTime(0.55, at);
    rate.setTargetAtTime(1, at, 0.12);
    rate.setTargetAtTime(0.84, bite, 0.05);
    rate.setTargetAtTime(1, bite + 0.35, 0.1);
    rate.setTargetAtTime(0.5, end - 0.3, 0.1);
  }
  function spawnHammer(at, variant) {
    const buffers = bank.buffers.hammers;
    if (!buffers || !ambientRoom()) return;
    const group = openGroup(constructionGain, { volume: TUNING.construction.hammer * range(0.7, 1),
      pan: clamp(sitePan + range(-0.3, 0.3), -1, 1), end: at });
    playIn(group, buffers[variant], at, { rate: range(0.96, 1.04) });
  }
  function spawnTrain(at) {
    const rise = 6, plateau = range(4, 10), fall = 6, leave = at + rise + plateau;
    const { idle, draft, gust } = TUNING.subway;
    // Scheduled on the audio clock only: these parameters are never touched by the level smoothing.
    trainGain.gain.setTargetAtTime(1, at, rise / 3);
    trainGain.gain.setTargetAtTime(idle, leave, fall / 3.2);
    subFilter.frequency.setTargetAtTime(Math.min(1100, nyquist), at, rise / 2.5);
    subFilter.frequency.setTargetAtTime(260, leave, fall / 3);
    subwaySource.playbackRate.setTargetAtTime(1.1, at, rise / 2);
    subwaySource.playbackRate.setTargetAtTime(0.93, leave, 1.5);
    subwaySource.playbackRate.setTargetAtTime(1, leave + fall, 3);
    airGain.gain.setTargetAtTime(gust, at + 1.5, 1.6);
    airGain.gain.setTargetAtTime(draft, leave + 1, 2.2);
    const clack = bank.buffers.clack;
    if (clack && groups.size < MAX_GROUPS) {
      const start = at + rise * 0.5, end = leave + fall * 0.5;
      const group = openGroup(subwayGain, { volume: 0, end });
      envelope(group.gain.gain, start, end, TUNING.subway.clack, 2, 2.5);
      playIn(group, clack, start, { rate: range(0.92, 1.12), loop: true, stop: end, offset: random() * clack.duration * 0.9 });
    }
    // Braking into the next station, or pulling out of it.
    const kind = random();
    const extra = kind < 0.4 ? ['squeal', leave - 0.6, TUNING.subway.squeal] : kind < 0.7 ? ['inverter', at + 0.8, TUNING.subway.inverter] : null;
    if (extra && bank.buffers[extra[0]] && groups.size < MAX_GROUPS) {
      const group = openGroup(subwayGain, { volume: extra[2] * range(0.6, 1), end: extra[1] });
      playIn(group, bank.buffers[extra[0]], extra[1], { rate: range(0.95, 1.05) });
    }
    trainBusyUntil = leave + fall;
    return rise + plateau + fall;
  }
  function birdSeries(list, at, count, gap, options) {
    const group = openGroup(options.target, { volume: options.volume, pan: options.pan ?? null, panner: options.panner ?? null,
      cutoff: options.cutoff ?? 0, end: at });
    const rate = range(0.93, 1.07);
    let t = at;
    for (let k = 0; k < count; k++) {
      const buffer = pick(list);
      playIn(group, buffer, t, { rate: rate * range(0.98, 1.02) });
      t += buffer.duration / rate + range(gap[0], gap[1]);
    }
    return group;
  }
  function spawnCoos(at) {
    const coos = bank.buffers.coos;
    if (!coos || !ambientRoom()) return;
    const [quiet, loud] = TUNING.birds.coo;
    birdSeries(coos, at, 1 + Math.floor(random() * 3), [0.2, 0.5], { target: birdsGain, volume: range(quiet, loud), pan: range(-0.8, 0.8) });
  }
  function spawnGulls(at) {
    const gulls = bank.buffers.gulls;
    if (!gulls || !ambientRoom()) return;
    const [quiet, loud] = TUNING.birds.gull;
    birdSeries(gulls, at, 1 + Math.floor(random() * 3), [0.3, 0.9], { target: birdsGain, volume: range(quiet, loud),
      pan: range(-0.9, 0.9), cutoff: range(2500, 8500) });
  }
  function spawnSiren(at) {
    const buffer = random() < 0.62 ? bank.buffers.sirenWail : bank.buffers.sirenFire;
    if (!buffer || !ambientRoom()) return;
    const rate = range(0.93, 1.07), end = at + buffer.duration / rate;
    const group = openGroup(sirenGain, { volume: range(0.55, 1), pan: 0, end });
    // It crosses some distant avenue.
    const from = range(-0.8, 0.8), to = clamp(from + range(-0.6, 0.6), -0.85, 0.85);
    group.panNode.pan.setValueAtTime(from, at);
    group.panNode.pan.linearRampToValueAtTime(to, end);
    playIn(group, buffer, at, { rate });
  }

  // Arms a timer when its layer becomes active, then spawns whenever it falls inside the look-ahead window.
  function tick(name, active, now, first, spawn) {
    if (!active) { timers[name] = Infinity; return; }
    if (timers[name] === Infinity) timers[name] = now + first();
    if (timers[name] > now + LOOKAHEAD) return;
    const at = Math.max(timers[name], now);
    timers[name] = at + Math.max(0.05, finite(spawn(at), 1));
  }
  function schedule(now) {
    const crowdOn = p.crowd > 0.03 && levels.crowd > 1e-4;
    tick('call', crowdOn, now, () => range(0.5, 3), (at) => {
      spawnCall(at);
      return 10 / ((1 + 5 * p.crowd) * (1 - 0.5 * p.rain)) * range(0.35, 1.65);
    });
    const subwayOn = !!subwaySource && p.subway > 0.02 && levels.subway > 1e-4;
    tick('train', subwayOn, now, () => Math.max(range(5, 25), trainBusyUntil - now + 5), (at) => {
      const passage = spawnTrain(at);
      const [shortest, longest] = TUNING.subway.interval;
      return Math.max(passage + 10, range(shortest, longest) * (1 + 0.4 * p.night));
    });
    const buildOn = p.construction > 0.02 && levels.construction > 1e-4;
    if (buildOn && timers.jack === Infinity) {
      sitePan = range(-0.35, 0.35);
      jackLeft = 2 + Math.floor(random() * 5);
    }
    tick('jack', buildOn, now, () => range(1, 6), (at) => {
      const duration = range(2, 5);
      spawnJackhammer(at, duration);
      if (--jackLeft > 0) return duration + range(0.7, 3.5);
      jackLeft = 3 + Math.floor(random() * 5);
      return duration + range(10, 32);
    });
    tick('drill', buildOn, now, () => range(4, 14), (at) => { spawnDrill(at); return range(9, 28); });
    tick('hammer', buildOn, now, () => range(2, 9), (at) => {
      const hits = 3 + Math.floor(random() * 7), variant = Math.floor(random() * HAMMERS.length);
      let t = at;
      for (let k = 0; k < hits; k++) {
        later(t, (when) => spawnHammer(when, variant));
        t += range(0.45, 1.05);
      }
      return t - at + range(4, 16);
    });
    tick('coo', p.birds > 0.03 && levels.birds > 1e-4, now, () => range(2, 10), (at) => {
      spawnCoos(at);
      // Pigeons roost at night: a coo now and then, not a chorus.
      return range(8, 30) / (0.35 + 0.65 * p.birds) * (1 + 2 * p.night);
    });
    tick('gull', p.water > 0.03 && levels.birds > 1e-4, now, () => range(3, 15), (at) => {
      spawnGulls(at);
      return range(12, 42) / (0.35 + 0.65 * p.water) * (1 + p.night);
    });
    const [rare, frequent] = TUNING.siren.interval;
    tick('siren', levels.siren > 1e-5, now, () => range(20, 80), (at) => {
      spawnSiren(at);
      return range(rare, frequent) * (1 - (1 - TUNING.siren.night) * p.night);
    });
    // Another record after the bar has been out of earshot for a while.
    if (barSource) {
      if (levels.bar > 1e-4) { barQuietSince = now; barRerolled = false; }
      else if (!barRerolled && now - barQuietSince > 30) {
        barSource.playbackRate.setValueAtTime(barRate(), now);
        barRerolled = true;
      }
    }
  }

  function runQueue(now) {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].time > now + LOOKAHEAD) continue;
      const item = queue[i];
      queue.splice(i, 1);
      item.run(Math.max(item.time, context.currentTime));
    }
  }

  function applyLevels(now) {
    const { send: sendRange, feedback } = TUNING.reflections;
    set.events(indoorFactor(p.indoor), now);
    set.indoor(Math.min(nyquist, TUNING.indoor.open * Math.pow(TUNING.indoor.cutoff / TUNING.indoor.open, p.indoor)), now);
    set.send(lerp(sendRange[0], sendRange[1], p.enclosure), now);
    set.feedbackA(lerp(feedback[0], feedback[1], p.enclosure), now);
    set.feedbackB(lerp(feedback[0], feedback[1], p.enclosure) * 0.8, now);
    if (!bedsReady) return;
    set.crowd(levels.crowd, now);
    // Traffic feeds the rumble; at night the fans and transformers come forward.
    set.rumble(levels.hum * TUNING.hum.rumble * (0.4 + 0.6 * p.traffic) * (1 - 0.3 * p.night), now);
    set.vent(levels.hum * TUNING.hum.vent * (1 + 0.4 * p.night), now);
    set.fountain(levels.fountain, now);
    set.subway(levels.subway, now);
    set.construction(levels.construction, now);
    set.bar(levels.bar, now);
    // Right at the door the wall opens up a little.
    set.barCutoff(Math.min(nyquist, 250 + 550 * smoothstep((p.bar - 0.72) / 0.28)), now);
    set.birds(levels.birds, now);
    set.siren(levels.siren, now);
  }

  function release() {
    if (released) return;
    released = true;
    for (const group of groups) for (const node of group.nodes) node.disconnect();
    groups.clear();
    for (const node of persistent) node.disconnect();
  }

  return {
    update(params = {}, now = context.currentTime) {
      if (disposed) return;
      const audioTime = context.currentTime;
      // Only the audio clock schedules sound; a value from another clock falls back to it.
      now = Number.isFinite(now) && now >= audioTime && now < audioTime + 1 ? now : audioTime;
      if (bank.pending.length) pump(bank, BAKE_BUDGET_MS);
      if (!bedsReady) startBeds(audioTime);
      readParams(params, p);
      computeLevels(p, levels);
      if (now >= nextControl) {
        nextControl = now + CONTROL_INTERVAL;
        applyLevels(now);
      }
      if (bedsReady) schedule(now);
      runQueue(now);
      for (const group of groups) if (now >= group.end) close(group);
    },

    event(kind, x, y, z) {
      if (disposed) return false;
      const now = context.currentTime;
      if (kind === 'alarm') {
        const modes = need(bank, 'alarm');
        if (!modes) return false;
        const alarms = [...groups].filter((group) => group.kind === 'alarm' && !group.fading);
        // A car does not set itself off twice; a third alarm replaces the oldest.
        if (alarms.some((group) => Math.hypot(group.x - x, group.y - y, group.z - z) < 4)) return false;
        if (alarms.length >= 2) fade(alarms[0], now);
        const at = now + 0.02, end = at + range(12, 20);
        const group = explicitGroup('alarm', x, y, z, 0, 6, end + 0.1, now);
        if (!group) return false;
        envelope(group.gain.gain, at, end, TUNING.events.alarm, 0.008, 0.12);
        // Chirps first, then the modulated siren modes, 2.4 s each with a short gap.
        const cycle = ['whoop', 'yelp', 'raygun'], shift = Math.floor(random() * cycle.length), pitch = range(0.95, 1.05);
        let t = at;
        for (let index = 0; t < end - 0.3; index++) {
          const buffer = modes[index === 0 ? 'chirp' : cycle[(index - 1 + shift) % cycle.length]];
          later(t, (when) => {
            if (group.closed || group.fading) return;
            playIn(group, buffer, when, { rate: pitch, stop: Math.min(end, when + buffer.duration / pitch) });
          });
          t += buffer.duration / pitch + 0.12;
        }
        runQueue(now);
        return true;
      }
      if (kind === 'coo' || kind === 'gull') {
        const coo = kind === 'coo';
        if (now - (coo ? lastCoo : lastGull) < (coo ? 1.2 : 0.6)) return false;
        const list = need(bank, coo ? 'coos' : 'gulls');
        if (!list) return false;
        const group = explicitGroup(kind, x, y, z, coo ? TUNING.events.coo : TUNING.events.gull, coo ? 1.5 : 10, now, now);
        if (!group) return false;
        const rate = range(0.93, 1.07), count = coo && random() < 0.6 ? 2 : 1;
        let t = now + 0.02;
        for (let k = 0; k < count; k++) {
          const buffer = pick(list);
          playIn(group, buffer, t, { rate });
          t += buffer.duration / rate + range(0.2, 0.45);
        }
        if (coo) lastCoo = now;
        else lastGull = now;
        return true;
      }
      return false;
    },

    dispose(immediate = false) {
      if (disposed) return;
      disposed = true;
      const now = context.currentTime;
      const fadeTime = !immediate && context.state === 'running' ? 0.1 : 0;
      hold(output.gain, now);
      output.gain.setTargetAtTime(0, now, 0.02);
      queue.length = 0;
      for (const group of groups) for (const source of group.sources) stopSource(source, now + fadeTime);
      for (const source of persistentSources) stopSource(source, now + fadeTime);
      remaining = persistentSources.length;
      // Suspended contexts may not dispatch `ended` until resumed: release right away then.
      if (!fadeTime || !remaining) release();
    }
  };
}
