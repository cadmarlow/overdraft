// Synthesized one-shot buffers for combat and interface sounds (gunshots, blasts, impacts, cash, mission stings).
// Built once per AudioContext like audio-events.js; played spatially by CityAudioSystem.sfx() or flat by ui().

const TAU = Math.PI * 2;

function rng(seed) {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeBuffer(ctx, duration, synthesize, peak = 0.8, channels = 1) {
  const length = Math.ceil(duration * ctx.sampleRate);
  const buffer = ctx.createBuffer(channels, length, ctx.sampleRate);
  for (let c = 0; c < channels; c++) {
    const samples = buffer.getChannelData(c);
    let maximum = 0;
    for (let i = 0; i < length; i++) {
      const fade = Math.min(1, (length - 1 - i) / (ctx.sampleRate * 0.015));
      samples[i] = synthesize(i / ctx.sampleRate, c) * fade;
      maximum = Math.max(maximum, Math.abs(samples[i]));
    }
    const scale = maximum > 0 ? peak / maximum : 0;
    for (let i = 0; i < length; i++) samples[i] *= scale;
  }
  return buffer;
}

// One-pole filter state helper
function onePole(ctx, frequency) {
  const k = 1 - Math.exp(-TAU * frequency / ctx.sampleRate);
  let y = 0;
  return (x) => (y += (x - y) * k);
}

function gunshot(ctx, seed, { body = 110, crack = 1, length = 0.55, weight = 1 } = {}) {
  const random = rng(seed);
  const low = onePole(ctx, 180 * weight + 60), mid = onePole(ctx, 2400), high = onePole(ctx, 6500);
  return makeBuffer(ctx, length, (t) => {
    const n = random() * 2 - 1;
    const l = low(n), m = mid(n), h = high(n);
    const snap = Math.exp(-t / 0.0035) * crack;
    const blast = (1 - Math.exp(-t * 4000)) * Math.exp(-t / (0.045 * weight));
    const tail = Math.exp(-t / (0.16 * weight)) * 0.22;
    const thump = Math.sin(TAU * (body * Math.exp(-t * 18) + 38) * t) * Math.exp(-t / (0.05 * weight)) * 0.9 * weight;
    return Math.tanh((h - m) * snap * 3 + (m - l) * blast * 1.6 + l * (blast + tail) * 2.4 + thump);
  }, 0.95);
}

function explosion(ctx, seed) {
  const random = rng(seed);
  const sub = onePole(ctx, 55), low = onePole(ctx, 180), mid = onePole(ctx, 1200);
  const crackles = Array.from({ length: 40 }, () => ({ t: 0.08 + random() ** 1.6 * 1.6, d: 0.002 + random() * 0.006, l: 0.2 + random() * 0.8 }));
  return makeBuffer(ctx, 2.6, (t) => {
    const n = random() * 2 - 1;
    const s = sub(n), l = low(n), m = mid(n);
    const env = (1 - Math.exp(-t * 900)) * Math.exp(-t / 0.55);
    const boom = Math.sin(TAU * (60 * Math.exp(-t * 3) + 24) * t) * Math.exp(-t / 0.35);
    let crackle = 0;
    for (const c of crackles) {
      const u = t - c.t;
      if (u > 0 && u < c.d * 8) crackle += (n - m) * Math.exp(-u / c.d) * c.l;
    }
    return Math.tanh(s * env * 9 + l * env * 3 + (m - l) * Math.exp(-t / 0.08) * 2 + boom * 1.4 + crackle * 0.5);
  }, 0.95);
}

function impact(ctx, seed, metal = false) {
  const random = rng(seed);
  const band = onePole(ctx, metal ? 5200 : 3000), base = onePole(ctx, metal ? 1500 : 500);
  const whine = metal || random() < 0.5;
  const f0 = 2600 + random() * 1800;
  return makeBuffer(ctx, metal ? 0.35 : 0.28, (t) => {
    const n = random() * 2 - 1;
    const tick = (band(n) - base(n)) * Math.exp(-t / 0.006) * 2.2;
    const ring = metal ? Math.sin(TAU * 3100 * t) * Math.exp(-t / 0.09) * 0.35 + Math.sin(TAU * 4720 * t) * Math.exp(-t / 0.05) * 0.2 : 0;
    const zing = whine ? Math.sin(TAU * f0 * t * (1 - t * 0.9)) * Math.exp(-t / 0.07) * Math.min(1, t * 120) * 0.18 : 0;
    return tick + ring + zing;
  }, 0.7);
}

function punch(ctx, seed) {
  const random = rng(seed);
  const low = onePole(ctx, 260);
  return makeBuffer(ctx, 0.2, (t) => {
    const n = random() * 2 - 1;
    return low(n) * Math.exp(-t / 0.03) * 3 + Math.sin(TAU * (90 - t * 200) * t) * Math.exp(-t / 0.04) + n * Math.exp(-t / 0.004) * 0.3;
  }, 0.8);
}

function clickClack(ctx, seed, times) {
  const random = rng(seed);
  const hp = onePole(ctx, 1800);
  return makeBuffer(ctx, times[times.length - 1] + 0.08, (t) => {
    const n = random() * 2 - 1;
    let v = 0;
    for (const [at, level] of times.map((x, i) => [x, i ? 1 : 0.6])) {
      const u = t - at;
      if (u > 0) v += (n - hp(n) * 0.6) * Math.exp(-u / 0.004) * level + Math.sin(TAU * 2100 * u) * Math.exp(-u / 0.01) * 0.3 * level;
    }
    return v;
  }, 0.5);
}

// ---- Interface stings (flat, stereo) --------------------------------------------------------------------------------
const note = (semitones) => 440 * 2 ** (semitones / 12);
function bell(t, f, d) { return (Math.sin(TAU * f * t) + Math.sin(TAU * f * 2.01 * t) * 0.35 + Math.sin(TAU * f * 3.98 * t) * 0.12) * Math.exp(-t / d); }

function cash(ctx) {
  return makeBuffer(ctx, 0.6, (t, c) => {
    const a = bell(t, note(19), 0.12);
    const u = t - 0.07;
    const b = u > 0 ? bell(u, note(24 + (c ? 0.03 : 0)), 0.22) : 0;
    return (a * 0.6 + b) * Math.min(1, t * 400);
  }, 0.5, 2);
}

function arpeggio(ctx, steps, { gap = 0.11, decay = 0.5, length = 1.8, pad = 0, peak = 0.55 } = {}) {
  return makeBuffer(ctx, length, (t, c) => {
    let v = 0;
    steps.forEach((s, i) => {
      const u = t - i * gap;
      if (u <= 0) return;
      const f = note(s) * (c ? 1.003 : 0.997);
      v += (Math.sin(TAU * f * u) * 0.7 + Math.sin(TAU * f * 2 * u) * 0.2 + Math.sign(Math.sin(TAU * f * u)) * 0.06) * Math.exp(-u / decay) * Math.min(1, u * 200);
    });
    if (pad) {
      const env = Math.min(1, t * 3) * Math.exp(-Math.max(0, t - 0.5) / 0.6);
      for (const s of steps.slice(0, 3)) v += Math.sin(TAU * note(s - 12) * t * (c ? 1.004 : 0.996)) * env * pad;
    }
    return v;
  }, peak, 2);
}

function sweep(ctx, seed, up) {
  const random = rng(seed);
  let y = 0;
  return makeBuffer(ctx, 0.9, (t, c) => {
    const p = up ? t / 0.9 : 1 - t / 0.9;
    const f = 300 + p * p * 2400;
    y += ((random() * 2 - 1) - y) * (1 - Math.exp(-TAU * f / ctx.sampleRate));
    const tone = Math.sin(TAU * (up ? 220 + t * 300 : 520 - t * 330) * t * (c ? 1.01 : 1)) * 0.35;
    return (y * 1.6 + tone) * Math.sin(Math.PI * Math.min(1, t / 0.9)) ;
  }, 0.45, 2);
}

function wasted(ctx, seed) {
  const random = rng(seed);
  const low = onePole(ctx, 400);
  return makeBuffer(ctx, 3.2, (t, c) => {
    const n = random() * 2 - 1;
    const drone = [-24, -17, -12].reduce((v, s, i) => v + Math.sin(TAU * note(s) * (1 - t * 0.04) * t * (c ? 1.002 : 0.998) + i) , 0) / 3;
    const hit = low(n) * Math.exp(-t / 0.25) * 2.5;
    return (drone * Math.min(1, t * 6) * Math.exp(-t / 1.6) + hit) * 0.8;
  }, 0.6, 2);
}

export function createCombatResources(ctx) {
  return {
    pistol: [1, 2, 3].map((s) => gunshot(ctx, 700 + s, { body: 120, crack: 1, length: 0.5 })),
    smg: [1, 2, 3].map((s) => gunshot(ctx, 720 + s, { body: 150, crack: 1.2, length: 0.32, weight: 0.7 })),
    shotgun: [1, 2].map((s) => gunshot(ctx, 740 + s, { body: 80, crack: 0.8, length: 0.9, weight: 1.6 })),
    explosion: [1, 2].map((s) => explosion(ctx, 760 + s)),
    impact: [1, 2, 3, 4].map((s) => impact(ctx, 780 + s)),
    impactMetal: [1, 2].map((s) => impact(ctx, 790 + s, true)),
    punch: [1, 2].map((s) => punch(ctx, 800 + s)),
    reload: [clickClack(ctx, 810, [0.02, 0.32])],
    dry: [clickClack(ctx, 811, [0.01])],
    cash: [cash(ctx)],
    pass: [arpeggio(ctx, [0, 4, 7, 12, 16, 19, 24], { gap: 0.09, decay: 0.7, length: 2.2, pad: 0.25 })],
    fail: [arpeggio(ctx, [7, 3, 0, -5], { gap: 0.16, decay: 0.6, length: 1.6, pad: 0.2 })],
    start: [arpeggio(ctx, [0, 7, 12], { gap: 0.12, decay: 0.45, length: 1.1, pad: 0.15 })],
    checkpoint: [arpeggio(ctx, [12, 19], { gap: 0.06, decay: 0.18, length: 0.45 })],
    wantedUp: [sweep(ctx, 820, true)],
    wantedDown: [sweep(ctx, 821, false)],
    wasted: [wasted(ctx, 830)]
  };
}

// Mix levels and audible ranges per sound
export const COMBAT_SOUNDS = {
  pistol: { level: 0.9, range: 320, ref: 12 },
  smg: { level: 0.75, range: 300, ref: 11 },
  shotgun: { level: 1, range: 360, ref: 14 },
  explosion: { level: 1, range: 900, ref: 40 },
  impact: { level: 0.35, range: 60, ref: 3 },
  impactMetal: { level: 0.4, range: 70, ref: 3 },
  punch: { level: 0.6, range: 40, ref: 3 },
  reload: { level: 0.5, range: 25, ref: 2 },
  dry: { level: 0.4, range: 20, ref: 2 },
  cash: { level: 0.45 },
  pass: { level: 0.5 },
  fail: { level: 0.45 },
  start: { level: 0.4 },
  checkpoint: { level: 0.4 },
  wantedUp: { level: 0.35 },
  wantedDown: { level: 0.3 },
  wasted: { level: 0.6 }
};
