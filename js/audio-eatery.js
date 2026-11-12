import { setControlRate } from './audio-synthesis.js';

// The sound of the city's two restaurant franchises (eatery-brands.js). No audio file: three loops are baked once per
// context, everything else is oscillators and the shared noise through filters.
//
//   BULLION  burgers. An extraction hood humming over a flat-top that hisses and spits and fryers that boil (the three
//            follow `cooking`), a room full of people talking (`crowd`), the house tune from the ceiling (`music`).
//   TRANCHE  pizza by the slice. A deck oven roaring softly while its fire crackles (`cooking`), the drinks fridge, the
//            same murmur, and a small radio by the oven playing a tarantella through a three-inch speaker (`music`).
//
// setScene() says where the listener stands and what the room is doing; update() (called by the audio system every
// frame, with the game's pause) turns that into gains. The room's talk and music are not positioned: they come through
// one low-pass that is wide open inside and nearly shut on the pavement, where only a dull leak is left, louder at the
// door. What cooks is positioned at the kitchen through the city's spatial emitter, so it turns with the camera.
// play() fires one of the EATERY_SOUNDS at a world position, each on its own emitter like a gunshot.
//
// Only the room in earshot has a graph (about thirty nodes, eight of them sources). It is built when a scene arrives
// and given back REST seconds after the last one: with setScene(null) the module is two idle gains. Nothing is created
// per frame; a steady scene schedules nothing at all.
//
// TO TUNE BY EAR. Nobody had heard any of this when it was written: the levels were measured, not listened to, in a
// headless Chrome, on the real audio system with a stub city around it, per channel after its compressor and master.
// Listener inside, five metres from the kitchen: a full house 0.013 RMS, griddle and fryers flat out 0.012, the
// house tune 0.010, a busy BULLION or TRANCHE 0.017 (0.023 leaning on the counter); from the pavement 0.006 to 0.008
// at the door and nothing to speak of fifteen metres away. One-shots peak, at their own `ref`, between 0.03 (a cloth
// on a table) and 0.15 (the oven door, BULLION's jingle). Measured the same way, for scale: the street's busiest
// ambience 0.010 RMS, a sedan cruising by at 10 m 0.037; a footstep peaks 0.013 at 3.5 m, a voice 0.017, a reload
// 0.09, the interface's cash sting 0.15, a punch 0.36, a pistol 0.49. In order of priority:
// 1. BED and SHOT, then MIX: the room against the street, the one-shots against footsteps and voices.
// 2. LEAK, WALL and the shut cutoff in levels(): how much of the room reaches the pavement, and how dull.
// 3. The walla (bakeWalla): it must read as a room of people, not as filtered noise or a drone.
// 4. The two tunes and the two jingles: the notes are in BULLION_TUNE, TRANCHE_TUNE and the jingle recipes.
// 5. Fat and fire (the `spit` and `crackle` chains): `drive` is how often they pop; the fire is meant to snap about
//    fifteen times a second flat out, three or four of them sharp, and three times a second when it idles.

const BED = 1; // every bed against the rest of the game
const SHOT = 0.45; // every one-shot
const MIX = {
  murmur: 0.042, // each of the two walla loops, at a full house (they are baked at 0.25 RMS)
  bullion: { sizzle: 0.06, spit: 0.05, fry: 0.085, hood: 0.025, hoodBusy: 0.015, hum: 0.0035, music: 0.063 },
  tranche: { roar: 0.055, pilot: 0.015, crackle: 0.12, fridge: 0.006, radio: 0.044 }
};
const SEATS = 14; // a full house
const LEAK = 0.5; // what the shop front lets out of the room, standing at the door
const WALL = 0.4; // and of the kitchen, which its emitter already thins with distance
const OPEN = 16000; // Hz: a filter that is not in the way
const KITCHEN = { ref: 3, range: 75 };
const REST = 3; // seconds a silent room keeps its graph, in case the player turns back
const LEAVE = 120; // metres from the kitchen at which a scene nobody cleared is dropped
const VOICES = 12; // one-shots at once

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const unit = (v) => clamp(num(v), 0, 1);
const ease = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// What a filter leaves of the shared noise (white up to 7 kHz at its own speed, 0.3 RMS, peaks at about three times
// that), so a recipe states the peak it wants to hear instead of a gain
function passes(type, frequency, q, rate) {
  const band = 7000 * rate;
  const width = type === 'bandpass' ? frequency / Math.max(q, 0.3) : type === 'lowpass' ? frequency * 1.2 : band - frequency;
  return 0.9 * Math.sqrt(clamp(width / band, 0.03, 1));
}

function shape(f) {
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) curve[i] = f(i / 1024 - 1);
  return curve;
}
// Quiet stays quiet and the peaks leap out: fat spitting on a griddle, a fizz with pops in it
const pops = () => shape((x) => Math.sign(x) * Math.min(1, Math.pow(Math.abs(x) / 0.42, 2.6)));
// Nothing at all under a threshold, then everything: sap in a fire, a few sharp snaps and silence between them
const snaps = () => shape((x) => Math.sign(x) * Math.min(1, Math.max(0, Math.abs(x) - 0.3) / 0.07));
// The small speaker of a kitchen radio, pushed a little too hard
const speaker = () => shape((x) => Math.tanh(x * 2.2) / Math.tanh(2.2));

// ---- Levels: pure, so the mix can be tested without an audio context ------------------------------------------------

function levels(s, out) {
  // on the pavement the room is a leak that falls off from the door and is gone before the scene is
  const near = 1 / (1 + (s.distance / 8) ** 2);
  const leak = LEAK * near * (1 - ease(35, 60, s.distance));
  out.room = leak + (1 - leak) * s.inside;
  // the shop front passes the bottom of the sound; stepping in opens it, slowly at first
  const shut = 380 + 520 * near;
  out.cutoff = shut * Math.pow(OPEN / shut, Math.pow(s.inside, 1.5));
  out.wall = WALL + (1 - WALL) * s.inside;
  out.murmur = MIX.murmur * Math.pow(s.crowd / SEATS, 0.65);
  return out;
}

const blank = () => ({ on: false, placed: false, brand: '', inside: 0, distance: 0, x: 0, y: 0, z: 0, crowd: 0, cooking: 0, music: 0 });

function read(scene, s) {
  s.brand = scene.brand;
  s.inside = unit(scene.inside);
  s.distance = Math.max(0, num(scene.distance));
  s.placed = Number.isFinite(scene.x) && Number.isFinite(scene.y) && Number.isFinite(scene.z);
  if (s.placed) { s.x = scene.x; s.y = scene.y; s.z = scene.z; }
  s.crowd = clamp(num(scene.crowd), 0, SEATS);
  s.cooking = unit(scene.cooking);
  s.music = unit(scene.music);
  return s;
}

/** What a scene asks of the room, without any audio: `room` and `wall` (gains), `cutoff` (Hz), `murmur` (gain). */
function eateryLevels(scene) {
  return levels(read(scene ?? {}, blank()), {});
}

// ---- Baking: the walla and the two tunes, about thirty milliseconds each, once per context --------------------------

// DC out, then to an RMS with a ceiling on the peak
function settle(context, data, rate, rms, ceiling = 0.9) {
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length;
  let energy = 0, peak = 0;
  for (let i = 0; i < data.length; i++) {
    data[i] -= mean;
    energy += data[i] * data[i];
    peak = Math.max(peak, Math.abs(data[i]));
  }
  const scale = peak > 0 ? Math.min(ceiling / peak, rms / Math.sqrt(energy / data.length)) : 0;
  const buffer = context.createBuffer(1, data.length, rate), out = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) out[i] = data[i] * scale;
  return buffer;
}

const VOWELS = [[730, 1090], [530, 1840], [300, 2200], [570, 840], [440, 1020], [640, 1190], [490, 1350]];

// Ten people talking at once in a tiled room: syllables on two formants each, pauses, no words
function bakeWalla(context) {
  const rate = 8000, length = Math.round(7.2 * rate), overlap = Math.round(0.5 * rate), lead = Math.round(0.25 * rate);
  const total = lead + length + overlap, raw = new Float32Array(total), random = rng(0x77616c6c), dt = 1 / rate;
  // A formant: a two-pole resonance that rings at the same level wherever it sits, so the weights below are the voice's
  const r1 = Math.exp(-Math.PI * 140 / rate), r2 = Math.exp(-Math.PI * 200 / rate), r3 = Math.exp(-Math.PI * 320 / rate);
  const turn = (frequency, r) => 2 * r * Math.cos(TAU * Math.min(frequency, rate * 0.45) / rate);
  const ring = (frequency, r) => (1 - r) * 2 * Math.sin(TAU * Math.min(frequency, rate * 0.45) / rate);
  for (let talker = 0; talker < 10; talker++) {
    const pitch = 92 + random() * 150, size = 0.88 + random() * 0.26, loud = 0.4 + random() * 0.6;
    const a3 = turn(2550 * size, r3), g3 = ring(2550 * size, r3);
    let phase = random(), elapsed = 0, duration = 0.05 + random() * 0.4, level = 0, step = 0;
    let a1 = 0, g1 = 0, a2 = 0, g2 = 0, y11 = 0, y12 = 0, y21 = 0, y22 = 0, y31 = 0, y32 = 0;
    for (let i = 0; i < total; i++) {
      elapsed += dt;
      if (elapsed >= duration) {
        elapsed = 0;
        if (random() < 0.18) {
          // a breath, or listening to the other one
          duration = 0.25 + random() * 0.9;
          level = 0;
        } else {
          duration = 0.09 + random() * 0.17;
          level = 0.4 + random() * 0.6;
          const vowel = VOWELS[Math.floor(random() * VOWELS.length)];
          a1 = turn(vowel[0] * size, r1); g1 = ring(vowel[0] * size, r1);
          a2 = turn(vowel[1] * size, r2); g2 = ring(vowel[1] * size, r2);
          step = pitch * (0.88 + random() * 0.26) * dt;
        }
      }
      // a syllable swells and falls while its pitch sags; the cords open once a period, with a little breath
      const x = elapsed / duration, swell = 16 * x * x * (1 - x) * (1 - x);
      let drive = (random() * 2 - 1) * 0.06;
      phase += step * (1 - 0.1 * x);
      if (phase >= 1) { phase -= 1; drive += 1; }
      drive *= level * swell;
      const y1 = g1 * drive + a1 * y11 - r1 * r1 * y12;
      y12 = y11; y11 = y1;
      const y2 = g2 * drive + a2 * y21 - r2 * r2 * y22;
      y22 = y21; y21 = y2;
      const y3 = g3 * drive + a3 * y31 - r3 * r3 * y32;
      y32 = y31; y31 = y3;
      raw[i] += (y1 + 0.5 * y2 + 0.22 * y3) * loud;
    }
  }
  // The room: three early reflections, then only what a wall of people lets through, in slow swells
  const taps = [[0.023, 0.5], [0.041, 0.36], [0.067, 0.26]].map(([seconds, gain]) => [Math.round(seconds * rate), gain]);
  const wet = new Float32Array(total), knots = Array.from({ length: 12 }, random);
  const kh = 1 - Math.exp(-TAU * 220 / rate), kl = 1 - Math.exp(-TAU * 3000 / rate);
  let low = 0, high = 0;
  for (let i = 0; i < total; i++) {
    let v = raw[i];
    for (const [delay, gain] of taps) if (i >= delay) v += raw[i - delay] * gain;
    low += (v - low) * kh;
    high += (v - low - high) * kl;
    const at = i / total * (knots.length - 1), k = Math.floor(at), u = at - k;
    wet[i] = high * (0.8 + 0.2 * (knots[k] + (knots[k + 1] - knots[k]) * u * u * (3 - 2 * u)));
  }
  // An even bed: ride the level down where everyone talks at once, and round off the loudest syllables
  let mean = 0;
  for (let i = 0; i < total; i++) mean += wet[i] * wet[i];
  mean /= total;
  const kp = 1 - Math.exp(-1 / (0.3 * rate)), ceiling = 3 * Math.sqrt(mean);
  let power = mean;
  for (let i = 0; i < total; i++) {
    power += (wet[i] * wet[i] - power) * kp;
    wet[i] = ceiling * Math.tanh(wet[i] * Math.pow(mean / Math.max(power, mean * 0.05), 0.3) / ceiling);
  }
  // The loop's own continuation is faded into its start: no seam
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = wet[lead + i];
  for (let i = 0; i < overlap; i++) {
    const x = i / overlap;
    data[i] = wet[lead + length + i] * Math.sqrt(1 - x) + wet[lead + i] * Math.sqrt(x);
  }
  return settle(context, data, rate, 0.25, 0.98);
}

// A few bars of music as a loop: every note is rendered once per pitch at unit peak, with its last hundredth of a
// second faded, and whatever rings past the last bar rings over the first, as if the loop had always been playing
function score(rate, seconds, tail = 0.7) {
  const length = Math.round(seconds * rate), raw = new Float32Array(length + Math.round(tail * rate)), cache = new Map();
  return {
    sound(key, duration, voice) {
      let sound = cache.get(key);
      if (sound) return sound;
      sound = new Float32Array(Math.round(Math.min(duration, tail) * rate));
      const fade = rate * 0.01;
      let peak = 0;
      for (let i = 0; i < sound.length; i++) {
        sound[i] = voice(i / rate) * Math.min(1, (sound.length - 1 - i) / fade);
        peak = Math.max(peak, Math.abs(sound[i]));
      }
      if (peak > 0) for (let i = 0; i < sound.length; i++) sound[i] /= peak;
      cache.set(key, sound);
      return sound;
    },
    place(sound, time, gain = 1) {
      const start = Math.round(time * rate), count = Math.min(sound.length, raw.length - start);
      for (let i = 0; i < count; i++) raw[start + i] += sound[i] * gain;
    },
    loop(context, rms) {
      const data = new Float32Array(length);
      for (let i = 0; i < length; i++) data[i] = raw[i] + (length + i < raw.length ? raw[length + i] : 0);
      return settle(context, data, rate, rms);
    }
  };
}

const sin = (frequency, t) => Math.sin(TAU * frequency * t);

// BULLION's house tune: eight bars in F at 108, a mallet over off-beat keys. Its first four notes are the jingle's.
// Each bar: the chord of its two halves, then eight eighth notes (MIDI; 0 lets the last one ring).
const BULLION_TUNE = {
  bpm: 108,
  // bass root, bass fifth, the keys' voicing
  chords: { F: [41, 48, [60, 65, 69]], d: [50, 45, [62, 65, 69]], B: [46, 53, [62, 65, 70]], C: [48, 43, [60, 64, 67]] },
  bars: [
    ['F', 'F', [77, 0, 72, 0, 77, 0, 81, 0]],
    ['d', 'd', [81, 0, 79, 77, 74, 0, 77, 0]],
    ['B', 'B', [74, 0, 77, 0, 79, 0, 82, 81]],
    ['C', 'C', [79, 0, 0, 76, 79, 0, 84, 0]],
    ['F', 'F', [81, 0, 77, 0, 84, 0, 81, 0]],
    ['d', 'd', [77, 0, 74, 77, 81, 0, 79, 77]],
    ['B', 'C', [74, 0, 77, 0, 76, 0, 79, 0]],
    ['F', 'F', [77, 0, 0, 0, 0, 0, 72, 0]]
  ]
};

function bakeBullionTune(context) {
  const tune = BULLION_TUNE, rate = 16000, eighth = 60 / tune.bpm / 2, random = rng(0x62756c6c);
  const s = score(rate, tune.bars.length * 8 * eighth);
  const mallet = (m) => s.sound(`m${m}`, 0.6, (t) => {
    const f = hz(m);
    return (sin(f, t) * Math.exp(-t / 0.2) + 0.5 * sin(f * 4, t) * Math.exp(-t / 0.07) + 0.15 * sin(f * 2, t) * Math.exp(-t / 0.1) + 0.12 * sin(f * 3, t) * Math.exp(-t / 0.09))
      * (1 - Math.exp(-t / 0.002));
  });
  const keys = (m) => s.sound(`k${m}`, 0.26, (t) => {
    const f = hz(m);
    return (sin(f, t) + 0.35 * sin(f * 2, t) + 0.3 * sin(f * 3, t) * Math.exp(-t / 0.06) + 0.12 * sin(f * 5, t) * Math.exp(-t / 0.03)) * Math.exp(-t / 0.11) * (1 - Math.exp(-t / 0.004));
  });
  // (the second and third harmonics are what a laptop plays of a bass)
  const bass = (m) => s.sound(`b${m}`, 0.42, (t) => {
    const f = hz(m);
    return (sin(f, t) + 0.5 * sin(f * 2, t) + 0.2 * sin(f * 3, t)) * Math.exp(-t / 0.22) * (1 - Math.exp(-t / 0.006));
  });
  const kick = s.sound('kick', 0.3, (t) => Math.sin(TAU * (52 * t + 68 * 0.03 * (1 - Math.exp(-t / 0.03)))) * Math.exp(-t / 0.11) * (1 - Math.exp(-t / 0.0015)));
  let a = 0, b = 0;
  const clap = s.sound('clap', 0.14, (t) => {
    a += (random() * 2 - 1 - a) * 0.55;
    b += (a - b) * 0.2;
    return (a - b) * (Math.exp(-t / 0.035) + 0.5 * Math.exp(-Math.max(0, t - 0.012) / 0.02));
  });
  let c = 0;
  const shaker = s.sound('shaker', 0.07, (t) => {
    const n = random() * 2 - 1;
    c += (n - c) * 0.6;
    return (n - c) * (1 - Math.exp(-t / 0.008)) * Math.exp(-t / 0.018);
  });
  tune.bars.forEach(([first, second, melody], bar) => {
    for (let k = 0; k < 8; k++) {
      const at = (bar * 8 + k) * eighth, [root, fifth, chord] = tune.chords[k < 4 ? first : second];
      if (melody[k]) s.place(mallet(melody[k]), at, 0.6);
      if (k === 0 || k === 3 || k === 6) s.place(bass(root), at, 0.34);
      if (k === 4) s.place(bass(first === second ? fifth : root), at, 0.3);
      if (k % 2) for (const m of chord) s.place(keys(m), at, 0.13);
      if (k % 4 === 0) s.place(kick, at, 0.3);
      if (k === 2 || k === 6) s.place(clap, at, 0.22);
      s.place(shaker, at, k % 2 ? 0.16 : 0.09);
    }
  });
  return s.loop(context, 0.2);
}

// TRANCHE's radio: sixteen bars of tarantella in 6/8, A minor then C. A mandolin (held notes kept alive by the
// plectrum), an accordion on the off-beats, a tambourine. Each bar: its chord, then six eighth notes.
const TRANCHE_TUNE = {
  bpm: 108, // dotted quarters a minute
  chords: { a: [45, 52, [57, 60, 64]], E: [52, 47, [56, 62, 64]], C: [48, 55, [55, 60, 64]], G: [43, 50, [53, 59, 62]] },
  bars: [
    ['a', [76, 81, 76, 72, 76, 72]], ['a', [69, 72, 76, 81, 0, 0]], ['E', [80, 83, 80, 76, 80, 76]], ['E', [74, 76, 77, 76, 0, 0]],
    ['E', [77, 76, 74, 71, 74, 71]], ['E', [68, 71, 74, 76, 0, 74]], ['a', [72, 71, 72, 76, 74, 72]], ['a', [69, 0, 0, 76, 0, 79]],
    ['C', [76, 79, 84, 79, 76, 79]], ['C', [84, 0, 83, 81, 79, 0]], ['G', [77, 79, 81, 83, 81, 79]], ['G', [77, 0, 0, 74, 0, 0]],
    ['G', [71, 74, 77, 79, 77, 74]], ['G', [83, 0, 81, 79, 77, 74]], ['C', [76, 74, 76, 79, 76, 72]], ['E', [76, 0, 74, 71, 0, 68]]
  ]
};
const REED = [1, 0.55, 0.5, 0.28, 0.22, 0.12, 0.1, 0.06];

function bakeTrancheTune(context) {
  const tune = TRANCHE_TUNE, rate = 11025, eighth = 60 / tune.bpm / 3, random = rng(0x7472616e), top = rate * 0.45;
  const s = score(rate, tune.bars.length * 6 * eighth);
  // two strings a hair apart; the upper partials die first
  const mandolin = (m) => s.sound(`m${m}`, 0.36, (t) => {
    const f = hz(m);
    let v = 0;
    for (let h = 1; h <= 6 && f * h < top; h++) v += (h % 2 ? 1 : 0.7) / h ** 0.8 * Math.exp(-t * (5 + 4 * h)) * (sin(f * h, t) + 0.8 * sin(f * h * 1.004, t + 0.0007));
    return v * (1 - Math.exp(-t / 0.0012));
  });
  // two reeds tuned apart on purpose
  const reed = (m, duration) => s.sound(`r${m}`, duration, (t) => {
    const f = hz(m);
    let v = 0;
    for (let h = 1; h <= REED.length && f * h < top; h++) v += REED[h - 1] * (sin(f * h, t) + sin(f * h * 1.0046, t));
    return v * Math.min(1, t / 0.015);
  });
  const bass = (m) => s.sound(`b${m}`, 0.3, (t) => {
    const f = hz(m);
    return (sin(f, t) + 0.6 * sin(f * 2, t) + 0.35 * sin(f * 3, t) + 0.15 * sin(f * 4, t)) * Math.exp(-t / 0.16) * Math.min(1, t / 0.008);
  });
  let low = 0;
  const tambourine = s.sound('tambourine', 0.16, (t) => {
    const n = random() * 2 - 1;
    low += (n - low) * 0.76;
    return (n - low) * (Math.exp(-t / 0.012) + 0.5 * Math.exp(-t / 0.06));
  });
  tune.bars.forEach(([name, melody], bar) => {
    const [root, fifth, chord] = tune.chords[name];
    for (let k = 0; k < 6; k++) {
      const at = (bar * 6 + k) * eighth;
      if (melody[k]) {
        let held = 1;
        while (k + held < 6 && !melody[k + held]) held++;
        const sound = mandolin(melody[k]);
        s.place(sound, at, 0.5);
        for (let stroke = 1; stroke < held * 2 - 1; stroke++) s.place(sound, at + stroke * eighth / 2, stroke % 2 ? 0.34 : 0.4);
      }
      if (k === 0 || k === 3) {
        s.place(bass(k ? fifth : root), at, 0.4);
        s.place(tambourine, at, k ? 0.1 : 0.14);
      } else if (k === 2 || k === 5) {
        for (const m of chord) s.place(reed(m, eighth * 0.8), at, 0.11);
        s.place(tambourine, at, 0.06);
      }
    }
  });
  return s.loop(context, 0.2);
}

const BAKERS = { walla: bakeWalla, tuneBullion: bakeBullionTune, tuneTranche: bakeTrancheTune };

// ---- Standing alone: a plain panner where the audio system does not lend its own emitters ---------------------------

class LocalEmitter {
  constructor(context, output, ref) {
    this.input = context.createGain();
    this.input.gain.value = 0;
    this.panner = typeof context.createPanner === 'function' ? context.createPanner() : null;
    if (this.panner) {
      this.panner.panningModel = 'equalpower';
      this.panner.distanceModel = 'inverse';
      this.panner.refDistance = ref;
      this.panner.rolloffFactor = 1.15;
      this.panner.maxDistance = 500;
      this.input.connect(this.panner).connect(output);
    } else this.input.connect(output);
  }

  update(source, listener, now, range = 160, snap = false, immediate = false) {
    const distance = Math.hypot(source.x - listener.x, source.y - listener.y, source.z - listener.z);
    const p = this.panner;
    if (p?.positionX) {
      for (const [param, value] of [[p.positionX, source.x], [p.positionY, source.y], [p.positionZ, source.z]]) {
        param.cancelScheduledValues(now);
        if (snap) param.setValueAtTime(value, now);
        else param.setTargetAtTime(value, now, 0.035);
      }
    } else p?.setPosition?.(source.x, source.y, source.z);
    const fade = clamp((range - distance) / (range * 0.3), 0, 1), level = (source.gain ?? 1) * fade * fade * (3 - 2 * fade);
    this.input.gain.cancelScheduledValues(now);
    if (immediate) this.input.gain.setValueAtTime(level, now);
    else this.input.gain.setTargetAtTime(level, now, 0.035);
    return distance;
  }

  dispose() {
    this.input.disconnect();
    this.panner?.disconnect();
  }
}

function localSpatial(context, output) {
  const here = { x: 0, y: 0, z: 0 };
  return {
    emitter: (ref) => new LocalEmitter(context, output, ref),
    listener: () => {
      const l = context.listener;
      here.x = num(l?.positionX?.value); here.y = num(l?.positionY?.value); here.z = num(l?.positionZ?.value);
      return here;
    }
  };
}

// ---- The voice ------------------------------------------------------------------------------------------------------

class EateryAudio {
  /**
   * `output`: where everything goes (the city's mix). `spatial`: `{ emitter(refDistance), listener() }` from the audio
   * system, so one-shots and the kitchen go through its emitters; left out, the module pans for itself.
   */
  constructor(context, resources, output, spatial = null) {
    this.context = context;
    this.resources = resources;
    this.spatial = spatial?.emitter && spatial?.listener ? spatial : localSpatial(context, output);
    this.nodes = new Set();
    this.sources = new Set();
    this.targets = new WeakMap();
    this.waves = new Map();
    this.curves = new Map();
    this.bank = {};
    this.disposed = false;
    this.scene = blank();
    this.levels = {};
    this.rig = null; // the room in earshot
    this.retired = []; // rooms fading out
    this.scope = null; // the room or the one-shot being built: own() files its nodes there too
    this.restAt = Infinity;
    this.placeAt = 0;
    this.spot = { x: 0, y: 0, z: 0, seed: 0.37 };
    this.voices = []; // one-shots playing
    this.fading = []; // and those cut short to make room
    this.lists = [this.voices, this.fading, this.retired]; // all that sweep() gives back when its time is up
    this.last = {}; // when each one-shot last started
    this.failed = new Set(); // one-shots that threw: reported once
    this.broken = false; // a room could not be built: no more rooms
    this.bus = this.gain(BED);
    this.bus.connect(output);
    this.shots = this.gain(1); // one-shots without a position
    this.shots.connect(output);
    // Ninety milliseconds of synthesis in three slices, kept off the first click's frame; a room that opens before
    // they are done bakes what it needs on the spot
    this.pending = Object.keys(BAKERS);
    const step = () => {
      this.warm = null;
      if (this.disposed || !this.pending.length) return;
      this.buffer(this.pending[0]);
      if (this.pending.length) arm(160);
    };
    const arm = (ms) => { this.warm = globalThis.setTimeout?.(step, ms) ?? null; this.warm?.unref?.(); };
    arm(700);
  }

  // ---- Plumbing ----------------------------------------------------------------------------------------------------

  own(node, source = false) {
    this.nodes.add(node);
    if (source) this.sources.add(node);
    if (this.scope) { this.scope.nodes.push(node); if (source) this.scope.sources?.push(node); }
    return node;
  }

  release(nodes) {
    for (const node of nodes) { node.disconnect(); this.nodes.delete(node); this.sources.delete(node); }
  }

  gain(value = 0) {
    const g = this.own(this.context.createGain());
    g.gain.value = value;
    return g;
  }

  filter(type, frequency, q = 0.7) {
    const f = this.own(this.context.createBiquadFilter());
    setControlRate(f.frequency, f.detune, f.Q, f.gain);
    f.type = type;
    f.frequency.value = Math.min(frequency, this.context.sampleRate * 0.45);
    f.Q.value = q;
    return f;
  }

  // A looping buffer, not started: a room starts all of its loops on the same instant
  loop(buffer, rate = 1) {
    const s = this.own(this.context.createBufferSource(), true);
    s.buffer = buffer;
    s.loop = true;
    s.playbackRate.value = rate;
    return s;
  }

  oscillator(type, frequency) {
    const o = this.own(this.context.createOscillator(), true);
    if (typeof type === 'string') o.type = type;
    else o.setPeriodicWave(type);
    o.frequency.value = Math.min(frequency, this.context.sampleRate * 0.45);
    return o;
  }

  // Partials with the peak given
  wave(name, partials, peak = 1) {
    if (this.waves.has(name)) return this.waves.get(name);
    let top = 0;
    for (let i = 0; i < 512; i++) {
      let v = 0;
      for (let k = 0; k < partials.length; k++) v += partials[k] * Math.sin((k + 1) * i / 512 * TAU);
      top = Math.max(top, Math.abs(v));
    }
    const real = new Float32Array(partials.length + 1), imag = new Float32Array(partials.length + 1);
    for (let k = 0; k < partials.length; k++) imag[k + 1] = partials[k] * peak / (top || 1);
    const wave = this.context.createPeriodicWave(real, imag, { disableNormalization: true });
    this.waves.set(name, wave);
    return wave;
  }

  shaper(name, make) {
    if (!this.curves.has(name)) this.curves.set(name, make());
    const node = this.own(this.context.createWaveShaper());
    node.curve = this.curves.get(name);
    return node;
  }

  /** One of the baked loops ('walla', 'tuneBullion', 'tuneTranche'), baked now if the warm-up has not reached it. */
  buffer(name) {
    if (name in this.bank) return this.bank[name];
    const at = this.pending.indexOf(name);
    if (at >= 0) this.pending.splice(at, 1);
    try {
      this.bank[name] = BAKERS[name](this.context);
    } catch (error) {
      console.warn(`[audio] eatery: unable to bake ${name}`, error);
      this.bank[name] = null;
    }
    return this.bank[name];
  }

  // Glide to a value. Unchanged targets cost nothing, so a steady room does not pile automation up.
  set(param, value, now, time = 0.1) {
    if (!Number.isFinite(value) || this.disposed) return;
    const previous = this.targets.get(param);
    if (previous !== undefined && Math.abs(previous - value) <= 1e-4 + Math.abs(value) * 2e-4) return;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, time);
    this.targets.set(param, value);
  }

  // ---- The rooms ---------------------------------------------------------------------------------------------------

  // What both rooms have: the two ways out (the room's air, the kitchen's emitter), the murmur, the noises
  begin(brand) {
    const c = this.context, rig = this.scope = { brand, nodes: [], sources: [], offsets: new Map(), fresh: true };
    rig.emitter = this.spatial.emitter(KITCHEN.ref);
    rig.out = this.gain();
    rig.out.connect(this.bus);
    rig.room = this.filter('lowpass', OPEN, 0.5);
    rig.room.connect(rig.out);
    rig.kitchen = this.gain();
    rig.kitchen.connect(rig.emitter.input);
    rig.wall = this.filter('lowpass', OPEN, 0.5);
    rig.wall.connect(rig.kitchen);
    // one loop twice, six per cent apart in speed and half a loop apart, either side of the listener
    rig.murmur = this.gain();
    rig.murmur.connect(rig.room);
    const walla = this.buffer('walla');
    if (walla) {
      for (const [rate, pan, offset] of [[1, -0.55, 0], [0.943, 0.55, 0.5]]) {
        const s = this.loop(walla, rate);
        rig.offsets.set(s, offset * walla.duration);
        if (typeof c.createStereoPanner === 'function') {
          const side = this.own(c.createStereoPanner());
          side.pan.value = pan;
          s.connect(side).connect(rig.murmur);
        } else s.connect(rig.murmur);
      }
    }
    rig.air = this.loop(this.resources.noise, 1);
    rig.low = this.loop(this.resources.noise, 0.3); // the same noise three times slower: all of it under 2 kHz
    rig.slow = this.loop(this.resources.noise, 0.0004); // and so slow that it is a hand on a fader, a few times a second
    return rig;
  }

  finish(rig, now) {
    this.scope = null;
    for (const s of rig.sources) {
      if (!s.buffer) s.start(now);
      else s.start(now, s.buffer === this.resources.noise ? Math.random() * (s.buffer.duration || 0) : rig.offsets.get(s) || 0);
    }
    return rig;
  }

  drop(rig) {
    for (const s of rig.sources) { try { s.stop(); } catch { /* Already ended. */ } }
    this.release(rig.nodes);
    rig.emitter.dispose();
  }

  // Hard-edged pops out of steady noise; `drive` is how often, and it wanders so they come in flurries
  popping(rig, frequency, q, name, curve, body = 0) {
    const band = this.filter('bandpass', frequency, q), drive = this.gain(), wander = this.gain(), out = this.gain();
    const edges = rig.air.connect(band).connect(drive).connect(this.shaper(name, curve));
    // (`body`: a resonance that turns each edge from a click into a small knock)
    (body ? edges.connect(this.filter('lowpass', body, 1.2)) : edges).connect(out).connect(rig.wall);
    rig.slow.connect(wander).connect(drive.gain);
    return { drive, wander, out };
  }

  buildBullion(now) {
    const rig = this.begin('bullion'), { air, low, slow, wall } = rig;
    // the griddle: a hiss that breathes, and the fat spitting through it
    rig.sizzle = this.gain();
    rig.sizzleWander = this.gain();
    air.connect(this.filter('highpass', 3200, 0.6)).connect(rig.sizzle).connect(wall);
    slow.connect(rig.sizzleWander).connect(rig.sizzle.gain);
    rig.spit = this.popping(rig, 4800, 0.9, 'pops', pops);
    // the fryers: a band of the low noise, beaten thirty times a second by bubbles
    rig.bubbles = this.loop(this.resources.noise, 0.004);
    rig.fry = this.gain();
    rig.fryDepth = this.gain();
    low.connect(this.filter('bandpass', 700, 1.4)).connect(rig.fry).connect(wall);
    rig.bubbles.connect(rig.fryDepth).connect(rig.fry.gain);
    // the hood: air through a duct, and its motor a little under mains pitch
    rig.hood = this.gain();
    low.connect(this.filter('lowpass', 480, 0.5)).connect(rig.hood).connect(wall);
    rig.hum = this.gain();
    this.oscillator(this.wave('hood', [1, 0.45, 0.25, 0.1], 1), 118).connect(rig.hum).connect(wall);
    // the house tune, from speakers in the ceiling
    rig.music = this.gain();
    const tune = this.buffer('tuneBullion');
    if (tune) this.loop(tune).connect(this.filter('highpass', 140, 0.6)).connect(this.filter('lowpass', 4500, 0.6)).connect(rig.music).connect(rig.room);
    return this.finish(rig, now);
  }

  updateBullion(rig, s, now) {
    const m = MIX.bullion, heat = s.cooking, hiss = m.sizzle * Math.pow(heat, 0.8);
    this.set(rig.sizzle.gain, hiss, now, 0.25);
    this.set(rig.sizzleWander.gain, hiss * 0.5, now, 0.25);
    this.set(rig.spit.drive.gain, 0.22 + 0.12 * heat, now, 0.25);
    this.set(rig.spit.wander.gain, 0.25, now, 0.25);
    this.set(rig.spit.out.gain, m.spit * Math.pow(heat, 0.6), now, 0.25);
    this.set(rig.fry.gain, m.fry * heat, now, 0.3);
    this.set(rig.fryDepth.gain, m.fry * heat * 2.6, now, 0.3);
    this.set(rig.hood.gain, m.hood + m.hoodBusy * heat, now, 0.5);
    this.set(rig.hum.gain, m.hum, now, 0.5);
    this.set(rig.music.gain, m.music * s.music, now, 0.3);
  }

  buildTranche(now) {
    const rig = this.begin('tranche'), { low, slow, wall } = rig;
    // the oven: a low roar that the flame leans on
    const body = this.filter('peaking', 130, 0.8);
    body.gain.value = 6;
    rig.roar = this.gain();
    rig.roarDepth = this.gain();
    low.connect(this.filter('lowpass', 420, 0.6)).connect(body).connect(rig.roar).connect(wall);
    slow.connect(rig.roarDepth).connect(rig.roar.gain);
    rig.crackle = this.popping(rig, 2800, 0.8, 'snaps', snaps, 3200);
    // the drinks fridge: a compressor on the mains, two of them a third of a hertz apart so it throbs
    rig.fridge = this.gain();
    rig.fridge.connect(rig.room);
    const mains = this.wave('fridge', [0.15, 1, 0.35, 0.3, 0, 0.12], 0.6);
    for (const frequency of [60, 60.35]) this.oscillator(mains, frequency).connect(rig.fridge);
    // the radio: band-passed and overdriven like a cheap speaker, and standing by the oven
    rig.radio = this.gain();
    const tune = this.buffer('tuneTranche');
    if (tune) {
      this.loop(tune).connect(this.filter('highpass', 420, 0.7)).connect(this.filter('lowpass', 2900, 0.7))
        .connect(this.shaper('speaker', speaker)).connect(rig.radio).connect(wall);
    }
    return this.finish(rig, now);
  }

  updateTranche(rig, s, now) {
    const m = MIX.tranche, heat = s.cooking, roar = m.pilot + (m.roar - m.pilot) * Math.pow(heat, 0.8);
    this.set(rig.roar.gain, roar, now, 0.4);
    this.set(rig.roarDepth.gain, roar * 0.5, now, 0.4);
    this.set(rig.crackle.drive.gain, 0.4 + 0.07 * heat, now, 0.3);
    this.set(rig.crackle.wander.gain, 0.2, now, 0.3);
    this.set(rig.crackle.out.gain, m.crackle * Math.pow(heat, 0.6), now, 0.3);
    this.set(rig.fridge.gain, m.fridge, now, 0.5);
    this.set(rig.radio.gain, m.radio * s.music, now, 0.3);
  }

  // ---- The game's side ---------------------------------------------------------------------------------------------

  /**
   * Called every frame while a branch is in earshot, then once with null:
   * `{ brand: 'bullion' | 'tranche', inside: 0..1, distance: metres to the door, x, y, z: the kitchen or the oven,
   * crowd: customers (0..14), cooking: 0..1, music: 0..1 }`. Anything else, or an unknown brand, is null.
   */
  setScene(scene) {
    const s = this.scene;
    if (scene && typeof scene === 'object' && (scene.brand === 'bullion' || scene.brand === 'tranche')) read(scene, s).on = true;
    else s.on = false;
  }

  // A room that cannot be built (a browser missing a node) is given up for good: the frame loop is not the place to
  // find out again sixty times a second
  build(brand, now) {
    try {
      return brand === 'bullion' ? this.buildBullion(now) : this.buildTranche(now);
    } catch (error) {
      console.warn('[audio] eatery: unable to build the room', error);
      const failed = this.scope;
      this.scope = null;
      this.broken = true;
      if (failed) {
        for (const s of failed.sources) { try { s.stop(); } catch { /* Never started. */ } }
        this.release(failed.nodes);
        failed.emitter?.dispose();
      }
      return null;
    }
  }

  /** Every frame, from the audio system. `playing`: false while the game is paused, and the room falls silent. */
  update(playing = true) {
    if (this.disposed) return;
    const now = this.context.currentTime, s = this.scene;
    this.sweep(now);
    if (this.broken) return;
    const listener = this.spatial.listener();
    // a scene left behind (a teleport, a respawn) is not followed across the city
    if (s.on && s.placed && listener && Math.hypot(s.x - listener.x, s.y - listener.y, s.z - listener.z) > LEAVE) s.on = false;
    let rig = this.rig;
    if (!playing || !s.on) {
      if (!rig) return;
      this.set(rig.out.gain, 0, now, 0.08);
      this.set(rig.kitchen.gain, 0, now, 0.08);
      if (this.restAt === Infinity) this.restAt = now + REST;
      else if (now >= this.restAt) { this.drop(rig); this.rig = null; this.restAt = Infinity; }
      return;
    }
    this.restAt = Infinity;
    if (rig?.brand !== s.brand) {
      if (rig) {
        // another franchise next door: the first room fades under the second
        this.set(rig.out.gain, 0, now, 0.08);
        this.set(rig.kitchen.gain, 0, now, 0.08);
        this.retired.push({ nodes: rig.nodes, rig, end: now + 0.6 });
      }
      rig = this.rig = this.build(s.brand, now);
      if (!rig) return;
    }
    if (s.placed && listener) {
      const spot = this.spot, jumped = Math.hypot(s.x - spot.x, s.y - spot.y, s.z - spot.z) > 20;
      if (rig.fresh || jumped || now >= this.placeAt) {
        spot.x = s.x; spot.y = s.y; spot.z = s.z;
        rig.emitter.update(spot, listener, now, KITCHEN.range, rig.fresh || jumped);
        rig.fresh = false;
        this.placeAt = now + 0.1;
      }
    }
    const l = levels(s, this.levels);
    this.set(rig.out.gain, l.room, now, 0.12);
    this.set(rig.room.frequency, l.cutoff, now, 0.12);
    this.set(rig.kitchen.gain, l.wall * BED, now, 0.12);
    this.set(rig.wall.frequency, l.cutoff, now, 0.12);
    this.set(rig.murmur.gain, l.murmur, now, 0.5);
    if (rig.brand === 'bullion') this.updateBullion(rig, s, now);
    else this.updateTranche(rig, s, now);
  }

  // ---- One-shots ---------------------------------------------------------------------------------------------------

  /**
   * One of EATERY_SOUNDS at a world position (or straight to both ears, without one). Returns false when it would
   * not be heard: unknown name, out of earshot, sound off, the same sound an instant ago.
   * `intensity`: 0..1.5. `muffle`: 0..1 to say how much shop front it is heard through, instead of the default: what
   * belongs to the room is dulled for a listener on the pavement, unless it happens within a few steps of them.
   */
  play(name, x, y, z, { intensity = 1, muffle } = {}) {
    const spec = Object.hasOwn(SHOTS, name) ? SHOTS[name] : null;
    if (!spec || this.disposed || this.context.state !== 'running') return false;
    const now = this.context.currentTime, k = clamp(num(intensity, 1), 0, 1.5);
    if (!(k > 0.01) || now - (this.last[name] ?? -Infinity) < spec.gap) return false;
    const placed = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
    let listener = null, distance = 0;
    if (placed) {
      listener = this.spatial.listener();
      if (!listener) return false;
      distance = Math.hypot(x - listener.x, y - listener.y, z - listener.z);
      if (distance > spec.range) return false;
    }
    this.sweep(now);
    if (this.voices.length >= VOICES) this.steal(now);
    this.last[name] = now;
    const voice = this.scope = { name, nodes: [], end: now, emitter: null, input: null };
    this.voices.push(voice);
    try {
      const s = this.scene;
      const veil = unit(muffle ?? (spec.room && s.on ? (1 - s.inside) * ease(3, 8, distance) : 0));
      const input = voice.input = this.gain(SHOT * k * (1 - 0.6 * veil));
      let to = this.shots;
      if (placed) {
        voice.emitter = this.spatial.emitter(spec.ref);
        voice.emitter.update({ x, y, z, seed: Math.random() }, listener, now, spec.range, true, true);
        to = voice.emitter.input;
      }
      if (veil > 0.02) input.connect(this.filter('lowpass', OPEN * Math.pow(700 / OPEN, veil), 0.5)).connect(to);
      else input.connect(to);
      spec.make(this, input, now + 0.005);
      return true;
    } catch (error) {
      // a sound that cannot be made is not worth a frame of the game: say so once, and give back what was built
      if (!this.failed.has(name)) console.warn(`[audio] eatery: unable to play ${name}`, error);
      this.failed.add(name);
      voice.end = now;
      return false;
    } finally {
      this.scope = null;
      voice.end += 0.08;
    }
  }

  // The one-shot that is nearest its end makes room, in a hundredth of a second
  steal(now) {
    let pick = 0;
    for (let i = 1; i < this.voices.length; i++) if (this.voices[i].end < this.voices[pick].end) pick = i;
    const [voice] = this.voices.splice(pick, 1);
    voice.input?.gain.setTargetAtTime(0, now, 0.012);
    voice.end = Math.min(voice.end, now + 0.06);
    this.fading.push(voice);
  }

  // Give back what has finished: one-shots, and rooms that have faded out
  sweep(now) {
    for (const list of this.lists) {
      for (let i = list.length - 1; i >= 0; i--) {
        const item = list[i];
        if (now < item.end) continue;
        list.splice(i, 1);
        if (item.rig) this.drop(item.rig);
        else { this.release(item.nodes); item.emitter?.dispose(); }
      }
    }
  }

  // ---- What one-shots are made of. Everything made while one is open is filed with it and freed when it ends. -----

  until(time) {
    if (this.scope && time > this.scope.end) this.scope.end = time;
  }

  // An oscillator that lives from `at` to `end`, for a recipe that shapes its own envelope
  note(type, frequency, at, end) {
    const o = this.oscillator(type, frequency);
    o.start(at);
    o.stop(end + 0.02);
    this.until(end + 0.02);
    return o;
  }

  // A sine with a falling pitch: the weight of a blow
  thud(to, at, level, from, down, length) {
    if (!(level > 0.0005)) return;
    const o = this.note('sine', from, at, at + length), g = this.gain();
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(down, at + length * 0.7);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    o.connect(g).connect(to);
  }

  // A pitched blip, steady or gliding: beeps, squeaks, swallows
  tone(to, at, { type = 'sine', from, down = from, glide = 0.05, level, attack = 0.004, hold = 0, decay = 0.1 }) {
    if (!(level > 0.0005)) return;
    const end = at + attack + hold + decay, o = this.note(type, from, at, end), g = this.gain();
    if (down !== from) {
      o.frequency.setValueAtTime(from, at);
      o.frequency.exponentialRampToValueAtTime(down, at + glide);
    }
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + attack);
    if (hold > 0) g.gain.setValueAtTime(level, at + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    o.connect(g).connect(to);
  }

  // One partial of something struck, ringing with the time constant `tau`; `hits` ([seconds after, strength]) strike
  // it again while it rings
  bell(to, at, frequency, level, tau, hits = ONCE) {
    if (!(level > 0.0005)) return;
    const g = this.gain(), p = g.gain;
    let value = 0.0001, end = at;
    p.setValueAtTime(value, at);
    for (let i = 0; i < hits.length; i++) {
      const start = at + hits[i][0], peak = Math.max(level * hits[i][1], value * 1.05);
      end = i + 1 < hits.length ? at + hits[i + 1][0] : start + tau * 7;
      p.setValueAtTime(value, start);
      p.linearRampToValueAtTime(peak, start + 0.002);
      value = Math.max(0.0001, peak * Math.exp(-(end - start - 0.002) / tau));
      p.exponentialRampToValueAtTime(value, end);
    }
    this.note('sine', frequency, at, end).connect(g).connect(to);
  }

  noise(rate, at, end) {
    const s = this.own(this.context.createBufferSource(), true);
    s.buffer = this.resources.noise;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(at, Math.random() * (s.buffer.duration || 0));
    s.stop(end + 0.02);
    this.until(end + 0.02);
    return s;
  }

  // Noise through one moving filter, with an attack and an exponential tail. `level` is the peak that comes out.
  burst(to, at, { rate = 1, type = 'bandpass', from, down = from, glide = 0.1, q = 0.7, level, attack = 0.004, hold = 0, decay = 0.1 }) {
    if (!(level > 0.0005)) return;
    const end = at + attack + hold + decay, f = this.filter(type, from, q), g = this.gain();
    const peak = level / passes(type, (from + down) / 2, q, rate);
    if (down !== from) {
      f.frequency.setValueAtTime(from, at);
      f.frequency.exponentialRampToValueAtTime(down, at + glide);
    }
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    if (hold > 0) g.gain.setValueAtTime(peak, at + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    this.noise(rate, at, end).connect(f).connect(g).connect(to);
  }

  // The same noise let through in `count` short grains over `span` seconds: paper, crust, coins, bubbles.
  // `even`: 0 scatters them, 1 spaces them like the teeth of a wheel. `fall`: the last grain's level against the first.
  grains(to, at, { count, span, level, length = GRAIN, type = 'bandpass', from, down = from, q = 1, rate = 1, even = 0, fall = 1 }) {
    if (!(level > 0.0005) || !(count > 0)) return;
    const f = this.filter(type, from, q), g = this.gain(), p = g.gain, slot = span / count;
    // (a grain is too short to catch the noise at its loudest: half as much again and `level` is the peak heard)
    const peak = 1.5 * level / passes(type, (from + down) / 2, q, rate);
    if (down !== from) {
      f.frequency.setValueAtTime(from, at);
      f.frequency.exponentialRampToValueAtTime(down, at + span);
    }
    p.setValueAtTime(0, at);
    let end = at;
    for (let i = 0; i < count; i++) {
      const start = at + (i + (1 - even) * Math.random() * 0.6) * slot;
      const size = Math.max(0.002, Math.min(0.4 * slot, length[0] + Math.random() * (length[1] - length[0])));
      p.setValueAtTime(0, start);
      p.linearRampToValueAtTime(peak * (0.55 + 0.45 * Math.random()) * (1 + (fall - 1) * i / count), start + Math.min(0.0015, size * 0.3));
      p.linearRampToValueAtTime(0, end = start + size);
    }
    this.noise(rate, at, end).connect(f).connect(g).connect(to);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.warm) globalThis.clearTimeout?.(this.warm);
    for (const source of this.sources) { try { source.stop(); } catch { /* Already ended, or never started. */ } }
    for (const node of this.nodes) node.disconnect();
    for (const voice of [...this.voices, ...this.fading]) voice.emitter?.dispose();
    for (const item of this.retired) item.rig.emitter.dispose();
    this.rig?.emitter.dispose();
    this.nodes.clear(); this.sources.clear(); this.waves.clear(); this.curves.clear();
    this.voices.length = this.fading.length = this.retired.length = this.pending.length = 0;
    this.rig = null;
    this.bank = {};
    this.scene.on = false;
  }
}

// ---- The one-shots ---------------------------------------------------------------------------------------------------
// `ref`: the distance (m) at which the levels below are heard; `range`: earshot; `gap`: seconds before the same sound
// may start again; `room`: it belongs to the room, so the shop front dulls it for a listener outside.
// make(a, o, t): build it on `a` into `o`, starting at `t`. Levels are peaks at `ref` before SHOT and `intensity`; what
// leaves the master is about 1.2 times what enters the city's mix (its compressor's make-up gain, then the master).

const ONCE = [[0, 1]];
const GRAIN = [0.004, 0.012];

const SHOTS = {
  doorSlide: { ref: 3, range: 32, gap: 0.4, make(a, o, t) {
    // air let into the ram, the panels on their track, the stop
    a.burst(o, t, { type: 'highpass', from: 2600, down: 1700, glide: 0.5, level: 0.09, attack: 0.03, hold: 0.3, decay: 0.3 });
    a.burst(o, t + 0.04, { rate: 0.3, from: 260, down: 190, glide: 0.6, q: 2.5, level: 0.07, attack: 0.08, hold: 0.45, decay: 0.15 });
    a.thud(o, t + 0.72, 0.12, 95, 60, 0.09);
  } },
  doorBell: { ref: 3, range: 32, gap: 0.3, make(a, o, t) {
    // a small brass bell on a spring: the clapper lands three times, each softer
    const hits = [[0, 1], [0.13, 0.55], [0.235, 0.35]], f = 1975 * (0.97 + Math.random() * 0.06);
    a.bell(o, t, f, 0.085, 0.2, hits);
    a.bell(o, t, f * 2.03, 0.04, 0.12, hits);
    a.bell(o, t, f * 2.76, 0.025, 0.07, hits);
    a.burst(o, t, { from: 5200, q: 2, level: 0.03, attack: 0.001, decay: 0.02 });
  } },
  till: { ref: 2.5, range: 24, gap: 0.2, room: true, make(a, o, t) {
    for (const after of [0, 0.085]) a.tone(o, t + after, { type: 'triangle', from: 1245, level: 0.06, attack: 0.003, hold: 0.04, decay: 0.02 });
    // the drawer kicks open on its spring, its bell, the change in its tray
    const d = t + 0.23;
    a.thud(o, d, 0.12, 150, 80, 0.09);
    a.burst(o, d, { from: 1700, down: 1100, glide: 0.05, q: 2, level: 0.14, attack: 0.002, decay: 0.06 });
    a.bell(o, d + 0.01, 2350, 0.045, 0.09);
    a.grains(o, d + 0.04, { count: 5, span: 0.14, from: 4300, q: 2.5, level: 0.045 });
  } },
  kiosk: { ref: 2, range: 14, gap: 0.08, room: true, make(a, o, t) {
    a.tone(o, t, { from: 880, down: 1320, glide: 0.05, level: 0.14, hold: 0.03, decay: 0.07 });
    a.tone(o, t, { from: 1760, down: 2640, glide: 0.05, level: 0.04, hold: 0.02, decay: 0.05 });
  } },
  orderUp: { ref: 5, range: 40, gap: 0.5, room: true, make(a, o, t) {
    // ding, dong: a major third down, E to C
    for (const [after, f] of [[0, 1318.5], [0.34, 1046.5]]) {
      a.bell(o, t + after, f, 0.2, 0.2);
      a.bell(o, t + after, f * 2, 0.055, 0.11);
      a.bell(o, t + after, f * 3.01, 0.02, 0.06);
    }
  } },
  sizzle: { ref: 2.5, range: 26, gap: 0.12, room: true, make(a, o, t) {
    // the wet slap of the meat, then fat spitting while the hiss dies down
    a.burst(o, t, { type: 'lowpass', from: 1100, down: 320, glide: 0.07, level: 0.1, decay: 0.07 });
    a.burst(o, t + 0.01, { type: 'highpass', from: 3000, down: 3800, glide: 0.8, level: 0.13, attack: 0.012, hold: 0.12, decay: 0.95 });
    a.grains(o, t + 0.03, { count: 12, span: 0.75, from: 5200, q: 1.2, level: 0.11, fall: 0.25 });
  } },
  fryerDrop: { ref: 2.5, range: 26, gap: 0.3, room: true, make(a, o, t) {
    // the basket on its hook, then the oil boiling up around cold food
    a.burst(o, t, { from: 2700, q: 7, level: 0.1, attack: 0.002, decay: 0.09 });
    a.burst(o, t + 0.012, { from: 3900, q: 9, level: 0.07, attack: 0.002, decay: 0.07 });
    a.burst(o, t + 0.05, { from: 1500, down: 2300, glide: 0.5, q: 0.8, level: 0.15, attack: 0.07, hold: 0.45, decay: 1 });
    a.grains(o, t + 0.08, { rate: 0.4, count: 16, span: 1.3, from: 620, q: 3, level: 0.09, length: [0.012, 0.03], fall: 0.3 });
  } },
  fryerBeep: { ref: 3, range: 28, gap: 0.6, room: true, make(a, o, t) {
    for (let i = 0; i < 3; i++) a.tone(o, t + i * 0.2, { type: 'triangle', from: 2090, level: 0.1, attack: 0.003, hold: 0.1, decay: 0.02 });
  } },
  soda: { ref: 2, range: 18, gap: 0.3, room: true, make(a, o, t) {
    // the valve, the cup filling (its note climbs), ice knocking about, the foam settling
    a.burst(o, t, { type: 'highpass', from: 3800, level: 0.065, attack: 0.02, hold: 0.8, decay: 0.2 });
    a.burst(o, t + 0.03, { from: 520, down: 1250, glide: 0.9, q: 3, level: 0.06, attack: 0.05, hold: 0.7, decay: 0.15 });
    a.grains(o, t + 0.1, { count: 4, span: 0.6, from: 3600, q: 9, level: 0.05, length: [0.02, 0.04] });
    a.burst(o, t + 1, { type: 'highpass', from: 4500, level: 0.03, attack: 0.01, decay: 0.35 });
  } },
  trayDown: { ref: 2, range: 20, gap: 0.08, room: true, make(a, o, t) {
    a.thud(o, t, 0.1, 190, 110, 0.07);
    a.burst(o, t, { type: 'lowpass', from: 1600, down: 500, glide: 0.04, level: 0.16, attack: 0.002, decay: 0.05 });
    a.grains(o, t + 0.03, { count: 2, span: 0.07, from: 2600, q: 2, level: 0.04 });
  } },
  trayDump: { ref: 2.5, range: 22, gap: 0.3, room: true, make(a, o, t) {
    // paper and cups sliding off, landing in the bag, the flap swinging back twice
    a.grains(o, t, { count: 9, span: 0.32, from: 2900, q: 1, level: 0.12, length: [0.008, 0.02] });
    a.thud(o, t + 0.3, 0.14, 130, 70, 0.1);
    a.thud(o, t + 0.39, 0.09, 110, 65, 0.09);
    a.burst(o, t + 0.5, { rate: 0.5, from: 430, q: 3.5, level: 0.2, attack: 0.003, decay: 0.09 });
    a.burst(o, t + 0.69, { rate: 0.5, from: 400, q: 3.5, level: 0.1, attack: 0.003, decay: 0.08 });
  } },
  wrap: { ref: 2, range: 14, gap: 0.08, make(a, o, t) {
    a.grains(o, t, { count: 14, span: 0.42, from: 4400, q: 0.9, level: 0.13, length: [0.003, 0.012] });
    a.grains(o, t + 0.02, { count: 5, span: 0.36, from: 2100, q: 1.4, level: 0.06, length: [0.01, 0.03] });
  } },
  bite: { ref: 2, range: 16, gap: 0.06, make(a, o, t) {
    // soft bread closing on itself, and a little salad
    a.burst(o, t, { type: 'lowpass', from: 950, down: 330, glide: 0.09, level: 0.18, attack: 0.012, decay: 0.12 });
    a.burst(o, t + 0.02, { from: 1500, q: 1.2, level: 0.05, attack: 0.01, decay: 0.07 });
    a.grains(o, t + 0.03, { count: 3, span: 0.07, from: 3300, q: 1.5, level: 0.035 });
  } },
  chew: { ref: 2, range: 12, gap: 0.1, make(a, o, t) {
    for (const after of [0, 0.22 + Math.random() * 0.05]) a.burst(o, t + after, { type: 'lowpass', from: 640, down: 300, glide: 0.07, level: 0.08, attack: 0.02, decay: 0.09 });
  } },
  crunch: { ref: 2, range: 16, gap: 0.06, make(a, o, t) {
    a.grains(o, t, { count: 9, span: 0.15, from: 2700, q: 1.1, level: 0.25, length: [0.003, 0.009] });
    a.burst(o, t, { type: 'lowpass', from: 1300, down: 480, glide: 0.1, level: 0.08, attack: 0.006, decay: 0.12 });
  } },
  slurp: { ref: 2, range: 14, gap: 0.3, make(a, o, t) {
    // air and the last of the drink rattling up the straw
    a.grains(o, t, { count: 17, span: 0.68, from: 850, down: 1500, q: 4, level: 0.1, length: [0.014, 0.026], even: 0.7 });
    a.burst(o, t, { type: 'highpass', from: 3200, level: 0.04, attack: 0.05, hold: 0.5, decay: 0.12 });
  } },
  gulp: { ref: 2, range: 10, gap: 0.12, make(a, o, t) {
    a.tone(o, t, { from: 150, down: 400, glide: 0.07, level: 0.09, attack: 0.012, hold: 0.03, decay: 0.08 });
    a.tone(o, t + 0.1, { from: 230, down: 310, glide: 0.05, level: 0.04, attack: 0.01, decay: 0.07 });
  } },
  burp: { ref: 2.5, range: 18, gap: 0.6, make(a, o, t) {
    // two rough reeds a fifth apart, sagging, through one mouth
    const length = 0.3 + Math.random() * 0.12, f = 86 + Math.random() * 14, mouth = a.filter('bandpass', 560, 1.4);
    mouth.connect(o);
    a.tone(mouth, t, { type: 'sawtooth', from: f, down: f * 0.66, glide: length, level: 0.28, attack: 0.03, hold: length * 0.5, decay: length * 0.5 });
    a.tone(mouth, t, { type: 'sawtooth', from: f * 1.51, down: f * 0.97, glide: length, level: 0.12, attack: 0.03, hold: length * 0.5, decay: length * 0.5 });
    a.burst(o, t, { rate: 0.4, from: 420, q: 1.5, level: 0.035, attack: 0.03, hold: length * 0.5, decay: length * 0.4 });
  } },
  doughSlap: { ref: 3, range: 26, gap: 0.12, room: true, make(a, o, t) {
    a.thud(o, t, 0.12, 150, 70, 0.14);
    a.burst(o, t, { type: 'lowpass', from: 1700, down: 300, glide: 0.06, level: 0.2, attack: 0.003, decay: 0.08 });
    a.burst(o, t + 0.01, { type: 'highpass', from: 3000, level: 0.025, attack: 0.02, decay: 0.16 }); // flour
  } },
  doughSpin: { ref: 3, range: 20, gap: 0.4, room: true, make(a, o, t) {
    // the disc turning in the air: four soft beats of wind, each a little higher
    for (let i = 0; i < 4; i++) a.burst(o, t + i * 0.19, { from: 520 + i * 90, down: 900 + i * 90, glide: 0.16, q: 1.3, level: 0.07 + 0.01 * i, attack: 0.07, decay: 0.16 });
  } },
  peel: { ref: 3, range: 22, gap: 0.3, room: true, make(a, o, t) {
    // a blade over the stone, and its heel on the oven's mouth
    a.burst(o, t, { from: 1700, down: 2700, glide: 0.4, q: 1.8, level: 0.08, attack: 0.05, hold: 0.28, decay: 0.16 });
    a.burst(o, t, { rate: 0.4, from: 480, q: 1.2, level: 0.06, attack: 0.05, hold: 0.28, decay: 0.14 });
    a.thud(o, t + 0.45, 0.08, 210, 140, 0.05);
  } },
  ovenDoor: { ref: 3.5, range: 28, gap: 0.3, room: true, make(a, o, t) {
    // a hinge that wants oil, then cast iron on its frame
    a.tone(o, t, { type: 'triangle', from: 610, down: 790, glide: 0.16, level: 0.02, attack: 0.03, hold: 0.08, decay: 0.07 });
    const c = t + 0.2;
    a.thud(o, c, 0.16, 140, 72, 0.13);
    a.burst(o, c, { from: 790, q: 12, level: 0.16, attack: 0.002, decay: 0.3 });
    a.burst(o, c, { from: 1660, q: 14, level: 0.1, attack: 0.002, decay: 0.22 });
    a.burst(o, c, { type: 'lowpass', from: 2400, down: 500, glide: 0.05, level: 0.14, attack: 0.002, decay: 0.06 });
  } },
  cutter: { ref: 2.5, range: 18, gap: 0.25, room: true, make(a, o, t) {
    // the wheel through the crust in one push, then onto the board
    a.grains(o, t, { count: 13, span: 0.34, from: 3100, q: 1.4, level: 0.15, length: [0.004, 0.01], even: 0.85 });
    a.burst(o, t, { rate: 0.4, type: 'lowpass', from: 420, level: 0.035, attack: 0.04, hold: 0.22, decay: 0.1 });
    a.burst(o, t + 0.36, { from: 1900, q: 3, level: 0.09, attack: 0.002, decay: 0.03 });
  } },
  boxFold: { ref: 2.5, range: 18, gap: 0.3, make(a, o, t) {
    // cardboard is duller and slower than paper; two folds, and the tab going home
    a.grains(o, t, { rate: 0.5, count: 6, span: 0.45, from: 950, q: 1, level: 0.14, length: [0.015, 0.04] });
    a.thud(o, t + 0.1, 0.09, 175, 120, 0.06);
    a.thud(o, t + 0.38, 0.1, 165, 110, 0.06);
    a.burst(o, t + 0.52, { from: 2000, q: 2, level: 0.1, attack: 0.002, decay: 0.03 });
  } },
  canOpen: { ref: 2, range: 14, gap: 0.3, make(a, o, t) {
    // the tab, the can ringing, the gas, the fizz
    a.burst(o, t, { from: 3500, q: 2.5, level: 0.18, attack: 0.001, decay: 0.025 });
    a.burst(o, t + 0.004, { from: 2300, q: 14, level: 0.1, attack: 0.002, decay: 0.14 });
    a.burst(o, t + 0.01, { type: 'highpass', from: 3900, level: 0.12, attack: 0.006, decay: 0.2 });
    a.burst(o, t + 0.12, { type: 'highpass', from: 4600, level: 0.025, attack: 0.05, decay: 0.4 });
  } },
  mop: { ref: 2.5, range: 18, gap: 0.6, room: true, make(a, o, t) {
    // wet strings pushed away, then drawn back
    a.burst(o, t, { rate: 0.6, from: 650, down: 1050, glide: 0.5, q: 0.9, level: 0.08, attack: 0.16, hold: 0.25, decay: 0.3 });
    a.burst(o, t + 0.05, { from: 2500, q: 1.1, level: 0.03, attack: 0.15, hold: 0.2, decay: 0.25 });
    a.burst(o, t + 0.8, { rate: 0.6, from: 1000, down: 620, glide: 0.5, q: 0.9, level: 0.065, attack: 0.14, hold: 0.22, decay: 0.3 });
    a.burst(o, t + 0.85, { from: 2300, q: 1.1, level: 0.025, attack: 0.13, hold: 0.18, decay: 0.25 });
  } },
  wipe: { ref: 2, range: 14, gap: 0.2, room: true, make(a, o, t) {
    a.burst(o, t, { type: 'highpass', from: 2600, level: 0.04, attack: 0.08, hold: 0.2, decay: 0.15 });
    for (const after of [0.04, 0.24]) a.tone(o, t + after, { type: 'triangle', from: 1250 + Math.random() * 200, down: 1900, glide: 0.08, level: 0.022, attack: 0.015, hold: 0.04, decay: 0.04 });
  } },
  chair: { ref: 3, range: 22, gap: 0.2, room: true, make(a, o, t) {
    // feet juddering over tiles
    const legs = a.filter('bandpass', 760, 2.2);
    legs.connect(o);
    a.tone(legs, t, { type: 'sawtooth', from: 78 + Math.random() * 10, down: 112, glide: 0.3, level: 0.2, attack: 0.03, hold: 0.22, decay: 0.12 });
    a.burst(o, t, { from: 1500, q: 1.6, level: 0.05, attack: 0.03, hold: 0.22, decay: 0.1 });
  } },
  coins: { ref: 2.5, range: 20, gap: 0.3, room: true, make(a, o, t) {
    a.grains(o, t, { count: 12, span: 0.75, from: 4300, q: 11, level: 0.16, length: [0.02, 0.045] });
    a.grains(o, t + 0.03, { count: 9, span: 0.7, from: 5700, q: 13, level: 0.11, length: [0.015, 0.035] });
    a.grains(o, t, { count: 5, span: 0.8, from: 1700, q: 1.2, level: 0.05, length: [0.02, 0.05] }); // the bag
  } },
  jingleBullion: { ref: 6, range: 45, gap: 1.5, make(a, o, t) {
    // Four notes on a horn section, F C F A, the last one held and swelling; then the till: ka-ching, on F again
    const notes = [[65, 0, 0.15], [60, 0.17, 0.15], [65, 0.34, 0.15], [69, 0.51, 0.62]], end = t + 1.13;
    const bore = a.filter('lowpass', 520, 1.1), g = a.gain(), p = g.gain;
    bore.connect(g).connect(o);
    const horns = [a.note('sawtooth', hz(65), t, end), a.note('sawtooth', hz(65), t, end), a.note('triangle', hz(53), t, end)];
    horns[1].detune.value = 9;
    for (const horn of horns) horn.connect(bore);
    p.setValueAtTime(0, t);
    for (const [midi, after, length] of notes) {
      const s = t + after, e = s + length, held = length > 0.3;
      for (let i = 0; i < 3; i++) horns[i].frequency.setValueAtTime(hz(i < 2 ? midi : midi - 12), s);
      // brass brightens as it is blown: the filter follows the breath
      bore.frequency.setValueAtTime(520, s);
      bore.frequency.linearRampToValueAtTime(held ? 2600 : 2100, s + 0.05);
      bore.frequency.linearRampToValueAtTime(held ? 1500 : 1300, s + Math.min(length, 0.3));
      p.setValueAtTime(0, s);
      p.linearRampToValueAtTime(0.075, s + 0.03);
      if (held) p.linearRampToValueAtTime(0.09, s + 0.3);
      else p.setValueAtTime(0.075, e - 0.035);
      p.linearRampToValueAtTime(0, e);
    }
    const ka = t + 0.98, ching = ka + 0.06;
    a.burst(o, ka, { from: 2500, q: 3, level: 0.1, attack: 0.001, decay: 0.03 });
    a.thud(o, ka, 0.08, 170, 90, 0.06);
    a.bell(o, ching, hz(101), 0.07, 0.12);
    a.bell(o, ching, hz(108), 0.045, 0.1);
    a.bell(o, ching + 0.03, hz(113) * 1.01, 0.02, 0.07);
    a.grains(o, ching, { count: 7, span: 0.3, type: 'highpass', from: 4800, level: 0.025, fall: 0.2 });
  } },
  jingleTranche: { ref: 6, range: 45, gap: 1.5, make(a, o, t) {
    // Five notes on a mandolin, A G# A F# D, the long ones kept alive by the plectrum; the open D under the last
    const notes = [[81, 0, 0.15], [80, 0.15, 0.15], [81, 0.3, 0.3], [78, 0.6, 0.15], [74, 0.75, 0.6]], end = t + 1.75;
    const wave = a.wave('mandolin', [1, 0.5, 0.42, 0.2, 0.17, 0.08, 0.06], 1);
    const body = a.filter('peaking', 1150, 1.2), g = a.gain(), p = g.gain;
    body.gain.value = 5;
    body.connect(g).connect(o);
    const strings = [a.note(wave, hz(81), t, end), a.note(wave, hz(81), t, end)];
    strings[1].detune.value = 8;
    for (const string of strings) string.connect(body);
    p.setValueAtTime(0.0001, t);
    notes.forEach(([midi, after, length], n) => {
      // one stroke every fourteenth of a second
      const s = t + after, strokes = Math.max(1, Math.round(length / 0.072)), last = n === notes.length - 1;
      for (const string of strings) string.frequency.setValueAtTime(hz(midi), s);
      for (let k = 0; k < strokes; k++) {
        const start = s + k * length / strokes, final = last && k === strokes - 1;
        const peak = 0.06 * (k ? 0.8 : 1) * (last ? 1 - 0.35 * k / strokes : 1);
        p.linearRampToValueAtTime(peak, start + 0.004);
        p.exponentialRampToValueAtTime(final ? 0.0001 : peak * 0.35, final ? end : start + length / strokes);
      }
    });
    a.bell(o, t + 0.75, hz(62), 0.05, 0.12);
    a.bell(o, t + 0.75, hz(50), 0.04, 0.13);
  } }
};

const EATERY_SOUNDS = Object.freeze(Object.keys(SHOTS));

export { EateryAudio, EATERY_SOUNDS, eateryLevels };
