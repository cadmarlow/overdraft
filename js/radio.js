// In-car radio: five "live" stations playing songs composed from a seed and synthesized with plain Web Audio
// nodes (no samples, no worklets, no per-sample JS). Composition is pure and testable without audio; RadioSystem
// turns bars into notes with a lookahead scheduler driven by update() from the game loop.

const STEPS = 16; // sixteenth notes per 4/4 bar
const LOOKAHEAD = 0.2; // seconds of notes created ahead of context.currentTime
const FADE = 0.6;
const OPEN = 16000; // "fully open" cutoff of the arrangement filter
const MASTER = 0.38;
const VOICE_LIMITS = [0, 12, 16, 18]; // by priority: 1 hats/fx/arp, 2 chords/lead, 3 kick/snare/bass

export const STATIONS = Object.freeze([
  { id: 'bruine', name: 'Bruine FM', tagline: 'Beats poussiéreux pour les nuits mouillées', genre: 'Lo-fi hip-hop', bpm: 82, color: '#d9a066' },
  { id: 'paillettes', name: 'Paillettes 122', tagline: 'House filtrée qui pompe jusqu’à l’aube', genre: 'French touch / filter house', bpm: 122, color: '#ff5fa2' },
  { id: 'retroviseur', name: 'Rétroviseur FM', tagline: 'Néons, chrome et autoroutes sans fin', genre: 'Synthwave', bpm: 100, color: '#9d6bff' },
  { id: 'jungle-beton', name: 'Jungle Béton', tagline: 'Breakbeats à 172 pour semer tout le monde', genre: 'Drum & bass / jungle', bpm: 172, color: '#3ddc84' },
  { id: 'minuit-velours', name: 'Minuit Velours', tagline: 'Accords soyeux pour les heures creuses', genre: 'Neo-soul jazzy / ambient', bpm: 70, color: '#5b8cff' },
].map(station => Object.freeze(station)));

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mod = (n, m) => ((n % m) + m) % m;
const lerpExp = (a, b, x) => a * Math.pow(b / a, clamp(x, 0, 1));
export const midiToFreq = midi => 440 * Math.pow(2, (midi - 69) / 12);

// ---------------------------------------------------------------------------------------------------------------
// Seeded randomness

export function hashSeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    let h = Math.floor(value) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return (h ^ (h >>> 16)) >>> 0;
  }
  const text = String(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: tiny, fast and good enough for composition choices.
export function createRng(seed) {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];
const chance = (rng, p) => rng() < p;
function weighted(rng, entries) {
  let total = 0;
  for (const [, weight] of entries) total += weight;
  let r = rng() * total;
  for (const [value, weight] of entries) {
    r -= weight;
    if (r < 0) return value;
  }
  return entries[entries.length - 1][0];
}

// ---------------------------------------------------------------------------------------------------------------
// Music theory: modes, diatonic chords in stacked thirds, voice leading

export const MODES = Object.freeze({
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
});

// Scale-degree loops (0 = tonic). Diminished triads are left out on purpose.
const PROGRESSIONS = {
  ionian: [[1, 4, 0, 5], [0, 5, 1, 4], [3, 2, 1, 0], [3, 4, 2, 5], [5, 3, 0, 4], [0, 3, 5, 4], [3, 0, 1, 4]],
  dorian: [[0, 3, 0, 3], [0, 6, 3, 0], [0, 2, 3, 6], [0, 4, 3, 0], [3, 0, 6, 0], [0, 3, 6, 4]],
  aeolian: [[0, 5, 2, 6], [0, 6, 5, 6], [5, 6, 0, 0], [0, 3, 5, 6], [0, 5, 3, 4], [3, 0, 5, 6], [0, 2, 5, 6]],
  lydian: [[0, 1, 0, 1], [0, 1, 4, 0], [0, 4, 1, 0]],
};

export function degreeSemitone(mode, degree) {
  const octave = Math.floor(degree / 7);
  return MODES[mode][degree - octave * 7] + 12 * octave;
}

export function scalePitchClasses(tonic, mode) {
  return MODES[mode].map(step => mod(tonic + step, 12));
}

// Scale degrees of a diatonic chord: triad, 7th, then 9th/11th/13th while skipping the clashing ones
// (b9, natural 11 over a major third, b13).
export function chordDegrees(mode, root, size = 3) {
  const interval = step => degreeSemitone(mode, root + step) - degreeSemitone(mode, root);
  const tones = [0, 2, 4];
  if (size >= 4) tones.push(6);
  if (size >= 5 && interval(8) % 12 !== 1) tones.push(8);
  if (size >= 6) {
    const minor = interval(2) === 3;
    if (minor || interval(10) % 12 === 6) tones.push(10);
    else if (interval(12) % 12 !== 8) tones.push(12);
  }
  return tones.map(step => root + step);
}

const average = list => list.reduce((sum, v) => sum + v, 0) / list.length;
function movement(from, to) {
  let cost = 0;
  for (const note of to) cost += Math.min(...from.map(prev => Math.abs(prev - note)));
  for (const note of from) cost += Math.min(...to.map(next => Math.abs(next - note))) * 0.5;
  return cost;
}

// Places every pitch class inside [low, high] and keeps the smoothest, most compact voicing.
export function voiceLead(previous, pitchClasses, low = 50, high = 74) {
  const options = pitchClasses.map(pc => {
    const list = [];
    for (let midi = low + mod(pc - low, 12); midi <= high; midi += 12) list.push(midi);
    return list;
  });
  const center = previous?.length ? (average(previous) + (low + high) / 2) / 2 : (low + high) / 2;
  let best = null, bestCost = Infinity;
  const chosen = [];
  const walk = index => {
    if (index === options.length) {
      const sorted = [...chosen].sort((a, b) => a - b);
      const span = sorted[sorted.length - 1] - sorted[0];
      if (span > 19) return;
      let cost = Math.abs(average(sorted) - center) * 0.4 + span * 0.05;
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i] - sorted[i - 1];
        if (gap === 0) return;
        if (gap === 1) cost += i === sorted.length - 1 ? 6 : 3.5; // close semitones sound harsh, worst at the top
        if (sorted[i - 1] < 52 && gap < 5) cost += 3; // keep the low register clear
      }
      if (previous?.length) cost += movement(previous, sorted);
      if (cost < bestCost) { bestCost = cost; best = sorted; }
      return;
    }
    for (const midi of options[index]) {
      chosen.push(midi);
      walk(index + 1);
      chosen.pop();
    }
  };
  walk(0);
  return best || pitchClasses.map(pc => low + mod(pc - low, 12)).sort((a, b) => a - b);
}

function buildHarmony(mode, tonic, degrees, size, [low, high], bassLow) {
  const chords = [];
  let previous = null;
  // Two passes so the first chord is voiced coming from the last one: the loop then repeats seamlessly.
  for (let pass = 0; pass < 2; pass++) {
    degrees.forEach((degree, i) => {
      const tones = chordDegrees(mode, degree, size);
      let voiced = tones.length >= 5 ? tones.slice(1) : tones; // rootless: the bass carries the root
      if (voiced.length > 4) voiced = voiced.filter((_, k) => k !== 1); // drop the fifth of big chords
      const pcs = voiced.map(d => mod(tonic + degreeSemitone(mode, d), 12));
      const voicing = voiceLead(previous, pcs, low, high);
      previous = voicing;
      if (pass === 0) return;
      const rootPc = mod(tonic + degreeSemitone(mode, degree), 12);
      chords[i] = {
        degree, tones, voicing, rootPc,
        bass: bassLow + mod(rootPc - bassLow, 12),
        third: degreeSemitone(mode, degree + 2) - degreeSemitone(mode, degree),
        fifth: degreeSemitone(mode, degree + 4) - degreeSemitone(mode, degree),
      };
    });
  }
  return chords;
}

// ---------------------------------------------------------------------------------------------------------------
// Melody: motifs (rhythm cell + contour) repeated, sequenced over the chords and answered with a cadence

const CONTOURS = [
  [1, 1, -2, 1, -1], [-1, -1, 2, -1, 1], [2, -1, -1, 1, 0], [0, 1, 1, -3, 1], [-2, 1, 1, 1, -1],
  [1, -2, 1, 2, -1], [0, -1, 2, 1, -2], [3, -1, -1, -1, 1], [-1, 2, -1, -1, 2], [1, 0, -1, 2, -2],
];

// Nearest chord tone, searching first in the direction the melody is moving so snapping keeps the contour.
function nearestTone(target, classes, direction = 0) {
  const d = direction < 0 ? -1 : 1;
  const order = direction ? [0, d, 2 * d, -d, -2 * d, 3 * d, -3 * d] : [0, -1, 1, -2, 2, -3, 3];
  for (const offset of order) if (classes.includes(mod(target + offset, 7))) return target + offset;
  return target;
}
const reflect = (degree, lo, hi) => clamp(degree > hi ? 2 * hi - degree : degree < lo ? 2 * lo - degree : degree, lo, hi);

function buildMelody(rng, harmony, unit, cells, cadences, { anchor, lo, hi }) {
  const motif = { cell: pick(rng, cells), contour: pick(rng, CONTOURS) };
  const others = cells.filter(cell => cell !== motif.cell);
  const alt = { cell: others.length ? pick(rng, others) : motif.cell, contour: pick(rng, CONTOURS) };
  const cadence = { cell: pick(rng, cadences), contour: pick(rng, CONTOURS) };
  const plan = [motif, motif, chance(rng, 0.55) ? motif : alt, cadence];
  const shape = answer => {
    const notes = [];
    let prev = anchor, motifStart = null;
    plan.forEach((part, u) => {
      const chord = harmony[u % harmony.length];
      const core = chord.tones.slice(0, 4).map(d => mod(d, 7));
      part.cell.forEach(([step, dur], j) => {
        let degree;
        if (j === 0) {
          // A repeated motif is sequenced: it keeps its position relative to the new chord root.
          const shift = mod(chord.degree - harmony[0].degree + 3, 7) - 3;
          const target = part === motif && motifStart !== null ? motifStart + shift : u === 0 ? anchor : prev;
          degree = nearestTone(target, core);
        } else {
          degree = prev + part.contour[(j - 1) % part.contour.length];
        }
        degree = reflect(degree, lo, hi);
        // Strong beats and notes held on a beat land on chord tones; passing tones stay on weak steps.
        if (step % 8 === 0 || dur >= 6 || (step % 4 === 0 && dur >= 3)) degree = nearestTone(degree, core, j ? Math.sign(degree - prev) : 0);
        if (j === 0 && part === motif && motifStart === null) motifStart = degree;
        if (u === plan.length - 1 && j === part.cell.length - 1) {
          // Question phrases end on the 3rd/5th, answers on the tonic (or the chord root).
          const home = core.includes(0) ? [0] : [core[0]];
          degree = nearestTone(degree, answer ? home : [core[1], core[2]]);
        }
        degree = clamp(degree, lo - 2, hi + 2);
        const vel = 0.72 + (step % 4 === 0 ? 0.12 : 0) + (dur >= 4 ? 0.05 : 0) - (dur <= 1 ? 0.1 : 0) + rng() * 0.08;
        notes.push({ step: u * unit + step, dur, degree, vel });
        prev = degree;
      });
    });
    return notes;
  };
  return { q: shape(false), a: shape(true), bars: (unit / STEPS) * plan.length };
}

function arpNote(arp, pool, i) {
  const n = pool.length;
  if (arp.shape === 'up') return pool[i % n];
  if (arp.shape === 'updown') {
    const period = Math.max(1, 2 * n - 2), k = i % period;
    return pool[k < n ? k : period - k];
  }
  if (arp.shape === 'pedal') return i % 2 === 0 ? pool[0] : pool[1 + (Math.floor(i / 2) % (n - 1))];
  return pool[arp.seq[i % arp.seq.length] % n];
}

// ---------------------------------------------------------------------------------------------------------------
// Styles: everything that makes a station sound like its genre

const ENERGY = { intro: 0.45, verse: 0.75, chorus: 1, break: 0.55, outro: 0.6 };
const LEVEL = { intro: 0.9, verse: 0.84, chorus: 1, break: 0.95, outro: 0.9 }; // the chorus lifts by ~1.5 dB
const FILL_MUTES = { roll: ['snare'], toms: ['kick', 'snare'], drop: ['kick', 'snare', 'hat', 'ohat', 'perc'] };

// Bass and comp patterns: [step, duration, role|velocity, velocity]. Roles: R root, O octave, 5, 3, A approach.
const eighths = (role = 'R') => Array.from({ length: 8 }, (_, i) => [i * 2, 2, i % 4 === 3 ? 'O' : role, i % 2 ? 0.75 : 0.95]);
const gallop = () => [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15].map(s => [s, 1, 'R', s % 4 === 0 ? 0.95 : 0.7]);

export const STYLES = {
  bruine: {
    swing: 0.58, swingGrid: 8, humanize: 0.008, chordBars: 1, pump: 0.12, crackle: 0.05, wow: 7, tremolo: 0, gain: 0.72,
    modes: [['ionian', 3], ['dorian', 3], ['aeolian', 2]], chordSizes: [4, 5], sameChorus: 0.2,
    voicing: [50, 72], bassLow: 36, leadOctave: 0, arpOctave: 12, arpRate: 2, chromatic: false,
    templates: [
      [['intro', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['break', 4], ['chorus', 8], ['verse', 8], ['outro', 4]],
      [['intro', 4], ['verse', 8], ['verse', 8], ['chorus', 8], ['break', 8], ['chorus', 8], ['outro', 4]],
      [['intro', 4], ['verse', 8], ['chorus', 8], ['break', 4], ['verse', 8], ['chorus', 8], ['outro', 4]],
    ],
    layers: { intro: 'chords hats', verse: 'kick snare hats bass chords', chorus: 'kick snare hats perc bass chords pad lead', break: 'chords pad bass lead', outro: 'kick snare hats bass chords' },
    late: {}, extra: { verse: 'lead', chorus: 'ohat' }, breakUses: 'verse',
    fills: ['drop', 'roll', null], riserBars: 1, build: false, crash: 0.35,
    sweep: { intro: [900, OPEN], break: 2600, outro: [OPEN, 1500] },
    drums: {
      kick: ['9......6..8.....', '9.........9..6..', '9..6......9.....', '9......69.......', '9.....6...9.....'],
      snare: ['....9.......9...', '....9.......9..3', '....9..2....9...'],
      hat: ['7.4.7.4.7.4.7.4.', '6.4.6.4.6.4.6.46', '7.5.6.5.7.5.6.5.'],
      hatBusy: ['7.46.4.47.46.4.4', '7.4.7.447.4.7.44'],
      ohat: ['..............5.', '......4.......5.'],
      perc: ['..3...3...3...3.', '...3.......3..3.'],
    },
    bass: [
      [[0, 6, 'R'], [7, 2, 'R', 0.6], [10, 5, '5']],
      [[0, 8, 'R'], [10, 2, 'O', 0.7], [13, 3, 'A', 0.7]],
      [[0, 3, 'R'], [3, 4, 'R', 0.7], [8, 6, '3'], [14, 2, 'A', 0.6]],
      [[0, 10, 'R'], [11, 2, '5', 0.6], [14, 2, 'A', 0.7]],
    ],
    comp: {
      verse: [[[0, 14, 0.8]], [[0, 6, 0.8], [7, 8, 0.6]], [[0, 3, 0.75], [3, 7, 0.6], [10, 6, 0.65]]],
      chorus: [[[0, 6, 0.85], [6, 2, 0.5], [8, 8, 0.7]], [[0, 10, 0.85], [10, 6, 0.6]]],
    },
    melody: {
      verse: { anchor: 2, lo: -2, hi: 7 }, chorus: { anchor: 4, lo: 0, hi: 9 },
      cells: {
        verse: [[[2, 2], [4, 4], [10, 4]], [[3, 3], [6, 2], [8, 8]], [[0, 6], [10, 2], [12, 4]]],
        chorus: [[[0, 6], [7, 3], [10, 2], [12, 4]], [[0, 2], [2, 2], [4, 8], [14, 2]], [[0, 3], [3, 3], [6, 2], [8, 6]]],
      },
      cadences: [[[0, 4], [4, 12]], [[2, 2], [4, 12]], [[0, 16]]],
    },
    sounds: {
      kick: { f0: 115, f1: 47, sweep: 0.06, decay: 0.42, click: 0.1, level: 0.85 },
      snare: { kind: 'snare', tone: 185, toneLevel: 0.22, bp: 1600, q: 0.7, decay: 0.16, level: 0.42 },
      hat: { hp: 6000, decay: 0.035, open: 0.2, level: 0.12 },
      perc: { kind: 'shaker', level: 0.06 },
      bass: { wave: 'triangle', cutoff: 420, env: 500, decay: 0.15, q: 1, sub: 0.55, detune: 0, attack: 0.01, release: 0.09, level: 0.42 },
      chords: { inst: 'keys', ratio: 1, index: 1.2, decay: 1.8, cutoff: 2200, release: 0.35, strum: 0.014, level: 0.3, wow: true },
      pad: { wave: 'sawtooth', detune: 8, cutoff: 800, attack: 0.9, release: 1.4, level: 0.1, wow: true },
      leads: [
        { inst: 'soft', cutoff: 2600, attack: 0.03, release: 0.18, vibrato: 7, level: 0.17, wow: true },
        { inst: 'bell', ratio: 3.5, index: 1.4, decay: 1.4, octave: 12, level: 0.12 },
      ],
      arp: { wave: 'triangle', cutoff: 2400, decay: 0.2, level: 0.06 },
    },
    mix: { pad: 0.85, lead: 0.9 },
    sends: { chords: [0.22, 0.12], lead: [0.3, 0.32], pad: [0.35, 0] },
  },

  paillettes: {
    swing: 0.54, swingGrid: 16, humanize: 0.002, chordBars: 1, pump: 0.65, crackle: 0, wow: 0, tremolo: 0, gain: 1,
    modes: [['aeolian', 4], ['dorian', 4], ['ionian', 2]], chordSizes: [4, 4, 5], sameChorus: 0.45,
    voicing: [55, 77], bassLow: 33, leadOctave: 0, arpOctave: 12, arpRate: 1, chromatic: false,
    templates: [
      [['intro', 8], ['verse', 16], ['chorus', 16], ['break', 8], ['chorus', 16], ['outro', 8]],
      [['intro', 8], ['verse', 16], ['break', 8], ['chorus', 16], ['verse', 8], ['chorus', 16], ['outro', 8]],
      [['intro', 8], ['verse', 8], ['chorus', 16], ['break', 8], ['verse', 8], ['chorus', 16], ['outro', 8]],
    ],
    layers: { intro: 'kick ohat chords', verse: 'kick snare hats ohat bass chords', chorus: 'kick snare hats ohat perc bass chords pad lead', break: 'chords pad lead', outro: 'kick hats ohat bass chords' },
    late: { intro: 'snare hats' }, extra: { verse: 'perc', chorus: 'arp' }, breakUses: 'chorus',
    fills: ['roll', 'drop', 'roll'], riserBars: 2, build: true, crash: 0.6,
    sweep: { intro: [320, 3200], verse: 4200, break: 700, outro: [OPEN, 600] },
    drums: {
      kick: ['9...9...9...9...', '9...9...9...9..4'],
      snare: ['....9.......9...', '....9.......9..4'],
      hat: ['3...3...3...3...', '4.3.4.3.4.3.4.3.'],
      hatBusy: ['4.3.4.3.4.3.4.3.', '43.343.343.343.3'],
      ohat: ['..8...8...8...8.'],
      perc: ['3232323232323232', '.3.3.3.3.3.3.3.3'],
    },
    bass: [
      [[2, 2, 'R'], [6, 2, 'R'], [10, 2, 'R'], [14, 2, 'O']],
      [[0, 2, 'R'], [2, 2, 'O', 0.7], [4, 2, 'R'], [6, 2, 'O', 0.7], [8, 2, 'R'], [10, 2, 'O', 0.7], [12, 2, 'R'], [14, 2, 'O', 0.7]],
      [[0, 3, 'R'], [3, 3, 'R', 0.7], [6, 2, 'O'], [10, 2, 'R'], [12, 2, '5', 0.7], [14, 2, 'O', 0.7]],
      [[2, 2, 'R'], [5, 1, 'R', 0.6], [6, 2, 'O'], [10, 2, 'R'], [13, 1, 'R', 0.6], [14, 2, '5']],
    ],
    comp: {
      verse: [[[0, 2, 0.9], [3, 2, 0.7], [6, 3, 0.8], [10, 2, 0.7], [12, 3, 0.8]], [[2, 2, 0.8], [6, 2, 0.8], [10, 2, 0.8], [14, 2, 0.8]], [[0, 3, 0.9], [3, 3, 0.7], [7, 2, 0.8], [10, 4, 0.8]]],
      chorus: [[[0, 1, 0.9], [2, 2, 0.7], [4, 1, 0.6], [6, 3, 0.8], [10, 1, 0.7], [11, 3, 0.8]], [[0, 2, 0.9], [3, 2, 0.7], [6, 3, 0.8], [10, 2, 0.7], [12, 3, 0.8]], [[0, 3, 0.9], [3, 3, 0.7], [7, 2, 0.8], [10, 4, 0.8]]],
    },
    melody: {
      verse: { anchor: 2, lo: -2, hi: 7 }, chorus: { anchor: 4, lo: 0, hi: 9 },
      cells: {
        verse: [[[0, 3], [3, 3], [6, 2], [10, 2], [12, 4]], [[2, 2], [6, 2], [10, 4]]],
        chorus: [[[0, 2], [3, 2], [6, 2], [8, 2], [11, 3], [14, 2]], [[2, 1], [3, 2], [6, 1], [7, 3], [10, 2], [12, 2]], [[0, 3], [3, 3], [6, 2], [10, 2], [12, 4]]],
      },
      cadences: [[[0, 3], [3, 3], [6, 10]], [[0, 2], [3, 2], [6, 10]]],
    },
    sounds: {
      kick: { f0: 150, f1: 50, sweep: 0.05, decay: 0.3, click: 0.25, level: 0.9 },
      snare: { kind: 'clap', bp: 1200, q: 1.1, decay: 0.16, level: 0.42 },
      hat: { hp: 8000, decay: 0.03, open: 0.22, level: 0.11 },
      perc: { kind: 'shaker', level: 0.07 },
      bass: { wave: 'sawtooth', cutoff: 260, env: 1300, decay: 0.12, q: 4, sub: 0.35, detune: 0, attack: 0.004, release: 0.05, level: 0.3 },
      chords: { inst: 'stab', cutoff: 900, env: 2600, decay: 0.16, release: 0.08, detune: 10, level: 0.28 },
      pad: { wave: 'sawtooth', detune: 12, cutoff: 1600, attack: 0.5, release: 1, level: 0.09 },
      leads: [
        { inst: 'pluck', cutoff: 700, env: 3500, decay: 0.18, release: 0.08, level: 0.15 },
        { inst: 'organ', cutoff: 3200, attack: 0.004, release: 0.06, level: 0.12 },
      ],
      arp: { wave: 'square', cutoff: 1800, decay: 0.12, level: 0.05 },
    },
    mix: { lead: 0.9 },
    sends: { chords: [0.12, 0.06], lead: [0.22, 0.25], snare: [0.15, 0] },
  },

  retroviseur: {
    swing: 0.5, swingGrid: 16, humanize: 0.002, chordBars: 1, pump: 0.25, crackle: 0, wow: 0, tremolo: 0, gain: 0.97,
    modes: [['aeolian', 7], ['dorian', 3]], chordSizes: [3, 3, 4], sameChorus: 0.4,
    voicing: [52, 76], bassLow: 33, leadOctave: 0, arpOctave: 0, arpRate: 1, chromatic: false,
    templates: [
      [['intro', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['chorus', 8], ['break', 8], ['chorus', 8], ['outro', 4]],
      [['intro', 8], ['verse', 8], ['chorus', 8], ['break', 4], ['verse', 8], ['chorus', 16], ['outro', 4]],
      [['intro', 4], ['verse', 16], ['chorus', 8], ['break', 8], ['chorus', 16], ['outro', 4]],
    ],
    layers: { intro: 'chords arp', verse: 'kick snare hats bass chords lead', chorus: 'kick snare hats ohat bass chords arp lead', break: 'pad arp lead', outro: 'kick snare hats bass chords arp' },
    late: { intro: 'kick hats' }, extra: { verse: 'arp', chorus: 'perc' }, breakUses: 'verse',
    fills: ['toms', 'roll', 'toms'], riserBars: 2, build: true, crash: 0.55,
    sweep: { intro: [500, OPEN], break: 2000, outro: [OPEN, 900] },
    drums: {
      kick: ['9.......9.......', '9.......9.6.....', '9......69.......'],
      chorusKick: ['9...9...9...9...', '9.......9.......'],
      snare: ['....9.......9...'],
      hat: ['6.4.6.4.6.4.6.4.', '5.3.5.3.5.3.5.3.'],
      hatBusy: ['6353635363536353', '6.4.6.4.6.4.6444'],
      ohat: ['..............6.'],
      perc: ['..3...3...3...3.'],
    },
    bass: [eighths(), gallop(), [[0, 3, 'R'], [3, 3, 'R', 0.8], [6, 2, 'O', 0.8], [8, 3, 'R'], [11, 3, 'R', 0.8], [14, 2, '5', 0.8]]],
    comp: { verse: [[[0, 16, 0.8]], [[0, 8, 0.8], [8, 8, 0.75]]], chorus: [[[0, 16, 0.9]], [[0, 8, 0.9], [8, 8, 0.8]]] },
    melody: {
      verse: { anchor: 2, lo: -2, hi: 7 }, chorus: { anchor: 4, lo: 0, hi: 10 },
      cells: {
        verse: [[[0, 6], [6, 2], [8, 8]], [[0, 4], [4, 4], [8, 6], [14, 2]], [[0, 3], [3, 3], [6, 2], [8, 8]]],
        chorus: [[[0, 4], [4, 4], [8, 6], [14, 2]], [[0, 2], [2, 2], [4, 4], [8, 4], [12, 4]], [[0, 3], [3, 3], [6, 2], [8, 8]]],
      },
      cadences: [[[0, 4], [4, 12]], [[0, 16]], [[0, 6], [6, 10]]],
    },
    sounds: {
      kick: { f0: 140, f1: 46, sweep: 0.06, decay: 0.38, click: 0.2, level: 0.9 },
      snare: { kind: 'gated', tone: 170, toneLevel: 0.28, bp: 1400, q: 0.6, decay: 0.24, level: 0.42 },
      hat: { hp: 7500, decay: 0.035, open: 0.25, level: 0.1 },
      perc: { kind: 'shaker', level: 0.06 },
      bass: { wave: 'sawtooth', cutoff: 360, env: 900, decay: 0.09, q: 2, sub: 0.3, detune: 6, attack: 0.003, release: 0.04, level: 0.26 },
      chords: { inst: 'pad', wave: 'sawtooth', detune: 11, cutoff: 2600, attack: 0.25, release: 0.7, level: 0.12 },
      pad: { wave: 'triangle', detune: 6, cutoff: 1400, attack: 1, release: 1.5, level: 0.14 },
      leads: [
        { inst: 'saw', cutoff: 3000, q: 2.5, attack: 0.008, release: 0.14, vibrato: 14, glide: 0.06, level: 0.12 },
        { inst: 'soft', cutoff: 3400, attack: 0.02, release: 0.2, vibrato: 12, glide: 0.05, level: 0.15 },
      ],
      arp: { wave: 'square', cutoff: 2200, decay: 0.16, level: 0.06 },
    },
    mix: { arp: 0.9 },
    sends: { snare: [0.3, 0], lead: [0.25, 0.35], arp: [0.2, 0.4], chords: [0.25, 0.05] },
  },

  'jungle-beton': {
    swing: 0.52, swingGrid: 16, humanize: 0.003, chordBars: 2, pump: 0, crackle: 0, wow: 0, tremolo: 0, gain: 1.1,
    modes: [['aeolian', 5], ['dorian', 5]], chordSizes: [4, 5], sameChorus: 0.35,
    voicing: [52, 76], bassLow: 31, leadOctave: 0, arpOctave: 12, arpRate: 2, chromatic: false,
    templates: [
      [['intro', 16], ['verse', 16], ['chorus', 32], ['break', 16], ['chorus', 24], ['outro', 8]],
      [['intro', 16], ['chorus', 16], ['verse', 16], ['break', 8], ['chorus', 32], ['outro', 8]],
      [['intro', 8], ['verse', 16], ['chorus', 16], ['break', 16], ['chorus', 32], ['outro', 8]],
    ],
    layers: { intro: 'pad hats chords', verse: 'kick snare hats bass chords lead', chorus: 'kick snare hats ohat perc bass chords pad lead', break: 'pad chords lead', outro: 'kick snare hats pad bass' },
    late: { intro: 'kick snare' }, extra: { verse: 'perc', chorus: 'arp' }, breakUses: 'chorus',
    fills: ['roll', 'drop', 'roll'], riserBars: 4, build: true, crash: 0.55,
    sweep: { intro: [700, OPEN], break: 2200, outro: [OPEN, 1000] },
    drums: {
      kick: ['9.........9.....', '9.........96....', '9.6.......9.....', '9.........9..6..'],
      snare: ['....9.......9...', '....9..3.3..9...', '....9.......9..3', '....9.3...2.9.3.'],
      hat: ['6.4.6.4.6.4.6.4.', '5.3.5.3.5.3.5.3.'],
      hatBusy: ['6346634663466346', '6.466.466.466.46'],
      ohat: ['......5.......5.', '..............5.'],
      perc: ['5.3.5.3.5.3.5.3.'],
    },
    bass: [
      [[0, 30, 'R']],
      [[0, 10, 'R'], [10, 6, 'R', 0.8], [16, 10, 'R'], [26, 6, '5', 0.8]],
      [[0, 14, 'R'], [14, 2, 'O', 0.7], [16, 8, 'R'], [24, 8, 'A', 0.8]],
    ],
    comp: {
      verse: [[[0, 6, 0.75], [10, 4, 0.6], [16, 6, 0.7], [26, 6, 0.6]], [[0, 14, 0.7], [16, 14, 0.65]]],
      chorus: [[[0, 4, 0.8], [6, 4, 0.6], [12, 4, 0.7], [16, 6, 0.8], [24, 6, 0.6]], [[0, 6, 0.75], [10, 4, 0.6], [16, 6, 0.7], [26, 6, 0.6]]],
    },
    melody: {
      verse: { anchor: 2, lo: -2, hi: 7 }, chorus: { anchor: 4, lo: 0, hi: 9 },
      cells: {
        verse: [[[0, 12], [12, 4], [16, 16]], [[4, 4], [8, 8], [16, 6], [22, 10]]],
        chorus: [[[0, 8], [8, 4], [12, 4], [16, 12], [28, 4]], [[0, 6], [6, 6], [12, 4], [16, 8], [24, 8]], [[4, 4], [8, 8], [16, 6], [22, 10]]],
      },
      cadences: [[[0, 8], [8, 24]], [[0, 32]]],
    },
    sounds: {
      kick: { f0: 160, f1: 52, sweep: 0.04, decay: 0.26, click: 0.3, level: 0.85 },
      snare: { kind: 'snare', tone: 200, toneLevel: 0.3, bp: 2000, q: 0.6, decay: 0.14, level: 0.46 },
      hat: { hp: 8000, decay: 0.025, open: 0.15, level: 0.1 },
      perc: { kind: 'ride', level: 0.05 },
      bass: { wave: 'sawtooth', cutoff: 240, env: 400, decay: 0.3, q: 2.5, sub: 0.7, detune: 14, attack: 0.01, release: 0.12, level: 0.24, motion: 2 },
      chords: { inst: 'keys', ratio: 1, index: 0.9, decay: 1.4, cutoff: 4000, release: 0.3, strum: 0.006, level: 0.22 },
      pad: { wave: 'sawtooth', detune: 12, cutoff: 1500, attack: 1.2, release: 1.6, level: 0.09 },
      leads: [
        { inst: 'bell', ratio: 3.5, index: 1.2, decay: 1.2, octave: 12, level: 0.11 },
        { inst: 'soft', cutoff: 3000, attack: 0.03, release: 0.25, vibrato: 10, glide: 0.08, level: 0.14 },
      ],
      arp: { wave: 'triangle', cutoff: 3000, decay: 0.2, level: 0.06 },
    },
    mix: {},
    sends: { pad: [0.5, 0], lead: [0.35, 0.3], chords: [0.25, 0.1], snare: [0.1, 0] },
  },

  'minuit-velours': {
    swing: 0.62, swingGrid: 8, humanize: 0.01, chordBars: 1, pump: 0, crackle: 0, wow: 0, tremolo: 0.16, gain: 0.73,
    modes: [['dorian', 4], ['ionian', 4], ['lydian', 1]], chordSizes: [5, 6], sameChorus: 0.15,
    voicing: [50, 74], bassLow: 33, leadOctave: 0, arpOctave: 12, arpRate: 2, chromatic: true,
    templates: [
      [['intro', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['break', 4], ['chorus', 8], ['outro', 4]],
      [['intro', 4], ['verse', 8], ['chorus', 8], ['break', 8], ['chorus', 8], ['outro', 4]],
      [['intro', 4], ['verse', 8], ['verse', 8], ['chorus', 8], ['break', 4], ['chorus', 8], ['outro', 4]],
    ],
    layers: { intro: 'chords', verse: 'kick snare hats bass chords lead', chorus: 'kick snare hats perc bass chords pad lead', break: 'chords pad bass lead', outro: 'chords pad bass' },
    late: { intro: 'bass' }, extra: { chorus: 'ohat' }, breakUses: 'verse',
    fills: ['drop', null], riserBars: 0, build: false, crash: 0.25,
    sweep: { intro: [1500, OPEN], break: OPEN, outro: [OPEN, 1800] },
    drums: {
      kick: ['8......5..6.....', '8.....4...7.....', '8.........6..4..'],
      snare: ['....8.......8...', '....8.......8..3'],
      hat: ['5.3.5.3.5.3.5.3.', '5.35.3.35.3.5.3.'],
      hatBusy: ['5.35.35.5.35.35.', '5.3.5.335.3.5.33'],
      ohat: ['..............4.'],
      perc: ['4...4...4...4...'],
    },
    bass: [
      [[0, 7, 'R'], [7, 1, 'R', 0.4], [8, 4, '5'], [12, 4, 'A']],
      [[0, 4, 'R'], [4, 4, '3', 0.75], [8, 4, '5', 0.8], [12, 4, 'A', 0.75]],
      [[0, 10, 'R'], [10, 2, 'O', 0.6], [12, 4, '5', 0.7]],
      [[0, 6, 'R'], [6, 2, '5', 0.5], [8, 6, 'O', 0.7], [14, 2, 'A', 0.6]],
    ],
    comp: {
      verse: [[[0, 6, 0.7], [7, 9, 0.6]], [[0, 16, 0.7]], [[3, 5, 0.65], [10, 6, 0.6]], [[0, 2, 0.6], [2, 8, 0.7], [12, 4, 0.5]]],
      chorus: [[[0, 7, 0.75], [7, 1, 0.4], [8, 8, 0.65]], [[0, 10, 0.75], [10, 6, 0.6]]],
    },
    melody: {
      verse: { anchor: 2, lo: -2, hi: 7 }, chorus: { anchor: 4, lo: 0, hi: 9 },
      cells: {
        verse: [[[2, 2], [4, 2], [6, 2], [8, 8]], [[0, 6], [6, 2], [9, 3], [12, 4]], [[3, 3], [6, 2], [8, 8]]],
        chorus: [[[0, 3], [3, 3], [6, 2], [8, 6], [14, 2]], [[0, 1], [1, 1], [2, 2], [4, 4], [10, 6]], [[0, 6], [6, 2], [9, 3], [12, 4]]],
      },
      cadences: [[[0, 4], [4, 12]], [[2, 2], [4, 12]]],
    },
    sounds: {
      kick: { f0: 100, f1: 46, sweep: 0.07, decay: 0.4, click: 0.04, level: 0.7 },
      snare: { kind: 'rim', level: 0.22 },
      hat: { hp: 7000, decay: 0.03, open: 0.25, level: 0.08 },
      perc: { kind: 'brush', level: 0.08 },
      bass: { wave: 'triangle', cutoff: 700, env: 600, decay: 0.2, q: 0.7, sub: 0.4, detune: 0, attack: 0.012, release: 0.12, level: 0.5 },
      chords: { inst: 'keys', ratio: 1, index: 0.8, decay: 2.4, cutoff: 3800, release: 0.6, strum: 0.02, level: 0.28 },
      pad: { wave: 'sawtooth', detune: 7, cutoff: 700, attack: 1.5, release: 2, level: 0.09 },
      leads: [
        { inst: 'vibes', level: 0.16 },
        { inst: 'flugel', cutoff: 1500, attack: 0.06, release: 0.18, vibrato: 12, level: 0.13 },
      ],
      arp: { wave: 'triangle', cutoff: 2400, decay: 0.2, level: 0.05 },
    },
    mix: {},
    sends: { chords: [0.3, 0.05], lead: [0.4, 0.15], pad: [0.5, 0], snare: [0.2, 0], perc: [0.15, 0] },
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Song titles and artists

const NOUNS = [
  ['Pluie', 1], ['Néons', 2], ['Asphalte', 0], ['Marée', 1], ['Boulevard', 0], ['Quai', 0], ['Lumières', 3],
  ['Brume', 1], ['Ville', 1], ['Nuit', 1], ['Phare', 0], ['Écho', 0], ['Fumée', 1], ['Ressac', 0], ['Sirènes', 3],
  ['Horizon', 0], ['Mirage', 0], ['Toits', 2], ['Reflets', 2], ['Vagues', 3], ['Lueur', 1], ['Comète', 1],
  ['Écume', 1], ['Lagune', 1], ['Rocade', 1], ['Embruns', 2], ['Carrefour', 0], ['Avenue', 1], ['Docks', 2],
  ['Ferry', 0], ['Silhouette', 1], ['Rêverie', 1], ['Chrome', 0], ['Velours', 0],
];
const FLAVOUR = {
  bruine: [['Thé froid', 0], ['Carnet', 0], ['Persiennes', 3], ['Gouttière', 1], ['Radiateur', 0]],
  paillettes: [['Paillettes', 3], ['Satin', 0], ['Piste', 1], ['Boule à facettes', 1], ['Stroboscope', 0]],
  retroviseur: [['Turbo', 0], ['Laser', 0], ['Autoroute', 1], ['Cassette', 1], ['Rétroviseur', 0]],
  'jungle-beton': [['Béton', 0], ['Métro', 0], ['Sous-sol', 0], ['Périphérique', 0], ['Rames', 3]],
  'minuit-velours': [['Ambre', 0], ['Soie', 1], ['Insomnie', 1], ['Lampe', 1], ['Confidence', 1]],
};
const ADJECTIVES = [
  ['bleu', 'bleue', 'bleus', 'bleues'], ['électrique', 'électrique', 'électriques', 'électriques'],
  ['lent', 'lente', 'lents', 'lentes'], ['doré', 'dorée', 'dorés', 'dorées'], ['tiède', 'tiède', 'tièdes', 'tièdes'],
  ['infini', 'infinie', 'infinis', 'infinies'], ['secret', 'secrète', 'secrets', 'secrètes'],
  ['nocturne', 'nocturne', 'nocturnes', 'nocturnes'], ['mouillé', 'mouillée', 'mouillés', 'mouillées'],
  ['lointain', 'lointaine', 'lointains', 'lointaines'], ['magnétique', 'magnétique', 'magnétiques', 'magnétiques'],
  ['désert', 'déserte', 'déserts', 'désertes'], ['violet', 'violette', 'violets', 'violettes'],
  ['brûlant', 'brûlante', 'brûlants', 'brûlantes'], ['oublié', 'oubliée', 'oubliés', 'oubliées'],
  ['fragile', 'fragile', 'fragiles', 'fragiles'], ['sauvage', 'sauvage', 'sauvages', 'sauvages'],
];
const COMPLEMENTS = [
  'minuit', 'velours', 'septembre', 'chrome', 'sel', 'béton', 'néon', 'la marée', 'l’aube', 'la ville', 'verre',
  'soie', 'octobre', 'essence', 'été', 'hiver', 'ambre', 'le port', 'les quais', 'quatre heures', 'cendre',
];
const PLACES = [
  'sur le port', 'sous la pluie', 'au bout du quai', 'après minuit', 'derrière le phare', 'à contre-courant',
  'dans le rétro', 'sur la rocade', 'entre deux feux', 'près du fleuve', 'sous les ponts', 'au ralenti',
  'en roue libre', 'sans retour', 'jusqu’à l’aube', 'à marée basse', 'au point mort', 'côté mer',
];
const PHRASES = [
  'Rien ne presse', 'On roule encore', 'Tout s’efface', 'Encore une nuit', 'Plein phares', 'Vitres ouvertes',
  'Feu orange', 'Sans clignotant', 'Ligne blanche', 'Pas de détour', 'Toujours tout droit', 'Ciel de traîne',
  'Contre-jour', 'Marée haute', 'Dernière sortie', 'Pare-brise',
];
const SUFFIXES = [' (version longue)', ' (édit radio)', ' (dub de nuit)', ' (reprise)', ' (interlude)'];
const FIRST_NAMES = ['Lou', 'Maëlle', 'Yann', 'Inès', 'Théo', 'Soline', 'Bastien', 'Nour', 'Elio', 'Capucine', 'Anouk', 'Gaspard', 'Léna', 'Malo', 'Romy', 'Sacha'];
const LAST_NAMES = ['Marée', 'Lagune', 'Varech', 'Brasier', 'Comète', 'Ondine', 'Ressac', 'Satin', 'Galet', 'Embrun', 'Rivage', 'Sillon', 'Mistral', 'Azur', 'Bitume', 'Néroli'];
const BANDS = ['Mouettes', 'Sirènes', 'Lucioles', 'Comètes', 'Méduses', 'Rames'];
const BAND_ADJ = ['électriques', 'magnétiques', 'nocturnes', 'sauvages', 'tièdes', 'chromées'];

const VOWEL = /^[aeiouyhéèêàâîôûœ]/i;
function withDe(text) {
  if (text.startsWith('le ')) return 'du ' + text.slice(3);
  if (text.startsWith('les ')) return 'des ' + text.slice(4);
  return VOWEL.test(text) ? 'd’' + text : 'de ' + text;
}
function article([word, gender]) {
  if (gender >= 2) return 'Les ';
  return VOWEL.test(word) ? 'L’' : gender ? 'La ' : 'Le ';
}

export function songTitle(rng, stationId) {
  const nouns = NOUNS.concat(FLAVOUR[stationId] || []);
  const noun = pick(rng, nouns), adjective = pick(rng, ADJECTIVES)[noun[1]];
  const form = Math.floor(rng() * 5);
  let title;
  if (form === 0) title = `${noun[0]} ${adjective}`;
  else if (form === 1) title = `${noun[0]} ${withDe(pick(rng, COMPLEMENTS))}`;
  else if (form === 2) title = `${noun[0]} ${pick(rng, PLACES)}`;
  else if (form === 3) title = `${article(noun)}${noun[0].toLowerCase()} ${adjective}`;
  else title = pick(rng, PHRASES);
  if (chance(rng, 0.12)) title += pick(rng, SUFFIXES);
  const kind = rng();
  const artist = kind < 0.55 ? `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`
    : kind < 0.75 ? `Les ${pick(rng, BANDS)} ${pick(rng, BAND_ADJ)}`
      : kind < 0.9 ? `DJ ${pick(rng, LAST_NAMES)}` : `Collectif ${pick(rng, LAST_NAMES)}`;
  return { title, artist };
}

const NOTE_NAMES = ['do', 'do♯', 'ré', 'mi♭', 'mi', 'fa', 'fa♯', 'sol', 'la♭', 'la', 'si♭', 'si'];
const MODE_NAMES = { ionian: 'majeur', dorian: 'dorien', aeolian: 'mineur', lydian: 'lydien' };

// ---------------------------------------------------------------------------------------------------------------
// Songs and the station clock

// The cheap part of a song (tempo, form, title): enough for the clock and the "now playing" display.
export function songPlan(stationId, seed) {
  const style = STYLES[stationId];
  if (!style) throw new Error(`Station inconnue : ${stationId}`);
  const station = STATIONS.find(s => s.id === stationId);
  const rng = createRng(`${seed}:plan`);
  const bpm = Math.round(station.bpm * (1 + (rng() * 2 - 1) * 0.04) * 10) / 10;
  let startBar = 0;
  const sections = pick(rng, style.templates).map(([name, bars], index) => {
    const section = { index, name, startBar, bars };
    startBar += bars;
    return section;
  });
  const stepDur = 60 / bpm / 4;
  const totalSteps = startBar * STEPS;
  return { stationId, seed, bpm, stepDur, sections, totalBars: startBar, totalSteps, duration: totalSteps * stepDur, ...songTitle(rng, stationId) };
}

function patternPair(rng, bank) {
  const a = pick(rng, bank);
  return [a, chance(rng, 0.6) ? pick(rng, bank) : a];
}

export function generateSong(stationId, seed) {
  const style = STYLES[stationId];
  const plan = songPlan(stationId, seed);
  const rng = createRng(`${seed}:song`);
  const mode = weighted(rng, style.modes);
  const tonic = Math.floor(rng() * 12);
  const list = PROGRESSIONS[mode];
  const progA = pick(rng, list);
  const others = list.filter(p => p !== progA);
  const progB = chance(rng, style.sameChorus) || !others.length ? progA : pick(rng, others);
  const size = pick(rng, style.chordSizes);
  const harmony = {
    A: buildHarmony(mode, tonic, progA, size, style.voicing, style.bassLow),
    B: buildHarmony(mode, tonic, progB, size, style.voicing, style.bassLow),
  };
  const unit = STEPS * style.chordBars;
  const melodies = {
    verse: buildMelody(rng, harmony.A, unit, style.melody.cells.verse, style.melody.cadences, style.melody.verse),
    chorus: buildMelody(rng, harmony.B, unit, style.melody.cells.chorus, style.melody.cadences, style.melody.chorus),
  };
  const toSet = text => Object.fromEntries((text || '').split(' ').filter(Boolean).map(name => [name, true]));
  const seen = {};
  const sections = plan.sections.map(section => {
    const occurrence = seen[section.name] = (seen[section.name] ?? -1) + 1;
    const layers = toSet(style.layers[section.name]);
    if (occurrence > 0) Object.assign(layers, toSet(style.extra[section.name]));
    if (section.name === 'verse' && chance(rng, 0.3)) layers.perc = true;
    const uses = section.name === 'break' ? style.breakUses : section.name === 'chorus' ? 'chorus' : 'verse';
    return {
      ...section, occurrence, layers,
      lateLayers: style.late[section.name] ? { ...layers, ...toSet(style.late[section.name]) } : layers,
      energy: ENERGY[section.name],
      prog: uses === 'chorus' ? 'B' : 'A',
      melody: uses,
      fill: pick(rng, style.fills),
    };
  });
  const kick = style.drums.chorusKick || style.drums.kick;
  const drumsFor = name => ({
    kick: patternPair(rng, name === 'chorus' ? kick : style.drums.kick),
    snare: patternPair(rng, style.drums.snare),
    hat: [pick(rng, name === 'chorus' ? style.drums.hatBusy : style.drums.hat)],
    ohat: [pick(rng, style.drums.ohat)],
    perc: [pick(rng, style.drums.perc)],
  });
  const drums = Object.fromEntries(['intro', 'verse', 'chorus', 'break', 'outro'].map(name => [name, drumsFor(name)]));
  const verseBass = pick(rng, style.bass);
  return {
    ...plan, style: stationId, mode, tonic, keyName: `${NOTE_NAMES[tonic]} ${MODE_NAMES[mode]}`,
    swing: style.swing, swingGrid: style.swingGrid, humanize: style.humanize, chordBars: style.chordBars,
    leadTonic: (tonic <= 5 ? 60 : 48) + tonic + style.leadOctave,
    harmony, melodies, sections, drums,
    bass: [verseBass, chance(rng, 0.5) ? verseBass : pick(rng, style.bass)],
    comp: [pick(rng, style.comp.verse), pick(rng, style.comp.chorus)],
    arp: { shape: pick(rng, ['up', 'updown', 'pedal', 'seq']), rate: style.arpRate, seq: Array.from({ length: 8 }, () => Math.floor(rng() * 6)) },
    sounds: { ...style.sounds, lead: pick(rng, style.sounds.leads) },
  };
}

export function sectionAt(song, bar) {
  for (const section of song.sections) if (bar < section.startBar + section.bars) return section;
  return song.sections[song.sections.length - 1];
}

const patternVelocity = (pattern, step) => {
  const digit = pattern.charCodeAt(step) - 48;
  return digit >= 1 && digit <= 9 ? digit / 9 : 0;
};

// Arrangement-filter target for a bar: closed intros, a dip in the break, an opening sweep into the drop.
function sweepFor(song, style, section, local) {
  const sw = style.sweep, bars = section.bars;
  const span = (a, b, x0, x1) => ({ from: lerpExp(a, b, x0), to: lerpExp(a, b, x1) });
  switch (section.name) {
    case 'intro': return span(sw.intro[0], sw.intro[1], local / bars, (local + 1) / bars);
    case 'verse': return { from: sw.verse ?? OPEN, to: sw.verse ?? OPEN };
    case 'break': {
      const rise = style.build ? style.riserBars : 0, start = bars - rise;
      if (rise && local >= start) return span(sw.break, OPEN, (local - start) / rise, (local - start + 1) / rise);
      if (local > 0) return { from: sw.break, to: sw.break };
      const previous = song.sections[section.index - 1];
      const from = previous ? sweepFor(song, style, previous, previous.bars - 1).to : OPEN;
      return { from, to: sw.break };
    }
    case 'outro': {
      const half = Math.floor(bars / 2);
      if (local < half) return { from: OPEN, to: OPEN };
      return span(sw.outro[0], sw.outro[1], (local - half) / (bars - half), (local - half + 1) / (bars - half));
    }
    default: return { from: OPEN, to: OPEN };
  }
}

function bassNote(song, chord, next, role) {
  const root = chord.bass;
  if (role === 'O') return root + 12;
  if (role === '5') return root + chord.fifth;
  if (role === '3') return root + chord.third;
  if (role !== 'A') return root;
  const target = next.bass; // the note actually played next, so the approach resolves in place
  if (target === root) return root + chord.fifth;
  if (STYLES[song.style].chromatic) return target + (target > root ? -1 : 1);
  // Diatonic neighbour of the next root, approached from the side we are coming from.
  const pc = mod(song.tonic + degreeSemitone(song.mode, next.degree + (target > root ? -1 : 1)), 12);
  let note = target - 3 + mod(pc - (target - 3), 12);
  if (Math.abs(note - target) > 3) note -= 12;
  return note;
}

// All note/automation events of one bar (steps 0..15, durations in steps). Pure: the scheduler only times them.
export function renderBar(song, bar) {
  const events = [];
  if (!(bar >= 0 && bar < song.totalBars)) return events;
  const style = STYLES[song.style];
  const section = sectionAt(song, bar);
  const local = bar - section.startBar;
  const { name } = section;
  const layers = local >= section.bars / 2 ? section.lateLayers : section.layers;
  const next = song.sections[section.index + 1] || null;
  const last = local === section.bars - 1;
  const final = last && !next;
  const energy = 0.75 + 0.25 * section.energy;
  const fade = name === 'outro' ? 1 - 0.45 * local / section.bars : 1;
  const drumsOn = !final && !(name === 'outro' && local >= Math.ceil(section.bars / 2));
  const harmony = song.harmony[section.prog];
  const chordBars = song.chordBars;
  const inChord = local % chordBars;
  const chordIndex = Math.floor(local / chordBars) % harmony.length;
  const chord = harmony[chordIndex];
  const chordEndsSection = local - inChord + chordBars >= section.bars;
  const nextChord = chordEndsSection && next ? song.harmony[next.prog][0] : harmony[(chordIndex + 1) % harmony.length];
  const push = event => events.push(event);

  push({ step: 0, inst: 'sweep', ...sweepFor(song, style, section, local), dur: STEPS });
  push({ step: 0, inst: 'level', level: LEVEL[name] });

  // Drums, with an alternate pattern every 4th bar and a fill leading into a new section.
  const kit = song.drums[name];
  const fill = last && next && next.name !== name ? section.fill : null;
  const fillFrom = fill === 'toms' ? 8 : 12;
  const muted = (part, step) => fill && step >= fillFrom && FILL_MUTES[fill].includes(part);
  const alt = local % 4 === 3 ? 1 : 0;
  const hits = (part, inst, active, scale = 1, skip = null) => {
    if (!active || !drumsOn) return;
    const pattern = kit[part][alt % kit[part].length];
    for (let step = 0; step < STEPS; step++) {
      const vel = patternVelocity(pattern, step);
      if (vel && !muted(part, step) && !skip?.(step)) push({ step, inst, vel: vel * scale * fade });
    }
  };
  const ohatOn = layers.ohat || (layers.hats && name === 'chorus' && section.occurrence > 0);
  const ohatPattern = kit.ohat[0];
  hits('kick', 'kick', layers.kick);
  hits('snare', 'snare', layers.snare);
  hits('hat', 'hat', layers.hats, 1, step => ohatOn && patternVelocity(ohatPattern, step) > 0);
  hits('ohat', 'ohat', ohatOn);
  hits('perc', 'perc', layers.perc);
  // Open hats ring until the next hat hit (choke), computed here so the synth needs no lookahead.
  const hatSteps = events.filter(e => e.inst === 'hat' || e.inst === 'ohat').map(e => e.step);
  for (const event of events) {
    if (event.inst !== 'ohat') continue;
    const nextHat = hatSteps.find(step => step > event.step);
    event.dur = Math.min(4, (nextHat ?? STEPS + 1) - event.step);
  }
  if (fill === 'roll' && layers.snare && drumsOn) [0.45, 0.55, 0.7, 0.85].forEach((vel, i) => push({ step: 12 + i, inst: 'snare', vel }));
  if (fill === 'toms' && drumsOn) [[8, 196], [10, 165], [12, 139], [13, 139], [14, 110]].forEach(([step, freq]) => push({ step, inst: 'tom', freq, vel: 0.8 }));
  if (local === 0 && layers.kick && (name === 'chorus' || (name === 'verse' && section.occurrence === 0))) push({ step: 0, inst: 'crash', vel: style.crash });
  if (name === 'break' && style.riserBars && local === section.bars - style.riserBars) push({ step: 0, inst: 'riser', dur: style.riserBars * STEPS, vel: 0.8 });
  if (name === 'break' && style.build && last) {
    for (const step of [0, 2, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15]) push({ step, inst: 'snare', vel: 0.2 + 0.7 * step / 15 });
  }

  // Harmony: bass, comp, pad. The last bar of the song is a held final chord.
  const span = chordBars * STEPS;
  const inBar = list => list.filter(([step]) => Math.floor(step / STEPS) === inChord);
  const chorus = name === 'chorus' ? 1 : 0;
  if (layers.bass) {
    if (final) push({ step: 0, inst: 'bass', midi: chord.bass, dur: 12, vel: 0.8 });
    else for (const [step, dur, role, vel = 0.9] of inBar(song.bass[chorus])) {
      push({ step: step % STEPS, inst: 'bass', midi: bassNote(song, chord, nextChord, role), dur, vel: vel * fade });
    }
  }
  if (layers.chords) {
    if (final) push({ step: 0, inst: 'chords', notes: chord.voicing, dur: 16, vel: 0.65 });
    else for (const [step, dur, vel] of inBar(song.comp[chorus])) {
      push({ step: step % STEPS, inst: 'chords', notes: chord.voicing, dur: Math.min(dur, span - step), vel: vel * energy * fade });
    }
  }
  if (layers.pad && (inChord === 0 || final)) push({ step: 0, inst: 'pad', notes: chord.voicing, dur: final ? 16 : span, vel: 0.75 * energy * fade });

  // Melody: question/answer phrases looping over the section.
  if (layers.lead && !final) {
    const melody = song.melodies[section.melody];
    const phraseBars = melody.bars;
    const phrase = Math.floor(local / phraseBars) % 2 ? melody.a : melody.q;
    const phraseBar = local % phraseBars;
    const octave = name === 'break' && section.melody === 'chorus' ? -12 : 0;
    for (const note of phrase) {
      if (Math.floor(note.step / STEPS) !== phraseBar) continue;
      const midi = song.leadTonic + degreeSemitone(song.mode, note.degree) + octave;
      push({ step: note.step % STEPS, inst: 'lead', midi, dur: note.dur, vel: note.vel * energy * fade });
    }
  }
  if (layers.arp && !final) {
    const pool = [...chord.voicing, chord.voicing[0] + 12, chord.voicing[1] + 12].sort((a, b) => a - b).map(m => m + style.arpOctave);
    const rate = song.arp.rate;
    for (let i = 0; i < STEPS / rate; i++) {
      const step = i * rate;
      push({ step, inst: 'arp', midi: arpNote(song.arp, pool, i + inChord * (STEPS / rate)), dur: rate, vel: (step % 4 === 0 ? 0.85 : 0.6) * fade });
    }
  }
  return events;
}

export function stationOffset(stationIndex, session = 0) {
  return (hashSeed(`${STATIONS[stationIndex].id}:${session}:offset`) % 240000) / 1000;
}

export function songSeed(stationIndex, songIndex, session = 0) {
  return hashSeed(`${STATIONS[stationIndex].id}:${session}:${songIndex}`);
}

// Which song a station is playing at `time` (context seconds). Songs are laid end to end from an offset per
// station, so every station keeps "playing" while nobody listens. `hint` (a previous result) avoids rescanning.
export function stationClock(stationIndex, time, session = 0, hint = null) {
  let songIndex = 0, start = -stationOffset(stationIndex, session);
  if (hint && hint.station === stationIndex && hint.session === session && hint.start <= time) {
    if (time < hint.start + hint.duration) return { ...hint, position: time - hint.start };
    ({ songIndex, start } = hint);
  }
  const id = STATIONS[stationIndex].id;
  for (let guard = 0; guard < 1e6; guard++) {
    const seed = songSeed(stationIndex, songIndex, session);
    const { duration } = songPlan(id, seed);
    if (time < start + duration) return { station: stationIndex, session, songIndex, seed, start, duration, position: time - start };
    start += duration;
    songIndex++;
  }
  throw new RangeError('stationClock: temps hors limites');
}

// ---------------------------------------------------------------------------------------------------------------
// Synthesis. Every voice registers its sources with radio.track(), which disconnects the nodes on `onended`.

function gainNode(c, value = 0) {
  const node = c.createGain();
  node.gain.value = value;
  return node;
}
// Keeps filter targets below Nyquist on low-rate contexts (some Bluetooth outputs run at 16-24 kHz).
const hz = (c, frequency) => Math.min(frequency, c.sampleRate * 0.45);

function filterNode(c, type, frequency, q = 0.7) {
  const node = c.createBiquadFilter();
  node.type = type;
  node.frequency.value = hz(c, frequency);
  node.Q.value = q;
  return node;
}
function panNode(c, pan) {
  if (typeof c.createStereoPanner !== 'function') return gainNode(c, 1);
  const node = c.createStereoPanner();
  node.pan.value = pan;
  return node;
}
function oscillator(c, type, frequency, t) {
  const node = c.createOscillator();
  node.type = type;
  node.frequency.setValueAtTime(frequency, t);
  node.start(t);
  return node;
}
function noiseSource(r, t, loop = false) {
  const node = r.context.createBufferSource();
  node.buffer = r.noise;
  node.loop = loop;
  node.start(t, r.rng() * 1.2);
  return node;
}
// Lo-fi wow: the shared slow LFO bends the pitch of a voice; detached again when the voice ends.
function attachWow(wow, param, nodes) {
  if (!wow) return;
  wow.connect(param);
  nodes.push({ disconnect: () => { try { wow.disconnect(param); } catch { /* already detached */ } } });
}

function playKick(r, out, t, vel, p) {
  if (!r.claim(3)) return;
  const c = r.context;
  const body = oscillator(c, 'sine', p.f0, t);
  body.frequency.exponentialRampToValueAtTime(p.f1, t + p.sweep);
  const amp = gainNode(c);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(vel * p.level, t + 0.003);
  amp.gain.setTargetAtTime(0, t + 0.02, p.decay / 4);
  body.connect(amp).connect(out);
  body.stop(t + p.decay + 0.05);
  const sources = [body], nodes = [amp];
  if (p.click) {
    const click = noiseSource(r, t);
    const hp = filterNode(c, 'highpass', 2500);
    const cg = gainNode(c);
    cg.gain.setValueAtTime(vel * p.click, t);
    cg.gain.exponentialRampToValueAtTime(0.0005, t + 0.015);
    click.connect(hp).connect(cg).connect(out);
    click.stop(t + 0.03);
    sources.push(click);
    nodes.push(hp, cg);
  }
  r.track(sources, nodes);
}

function playSnare(r, out, t, vel, p) {
  if (p.kind === 'clap') return playClap(r, out, t, vel, p);
  if (p.kind === 'rim') return playPerc(r, out, t, vel, { kind: 'rim', level: p.level }, 3);
  if (!r.claim(3)) return;
  const c = r.context;
  const noise = noiseSource(r, t);
  const bp = filterNode(c, 'bandpass', p.bp, p.q);
  const ng = gainNode(c);
  const peak = vel * p.level;
  if (p.kind === 'gated') {
    // 80s gated snare: the noise holds, then is cut sharply.
    ng.gain.setValueAtTime(peak, t);
    ng.gain.linearRampToValueAtTime(peak * 0.55, t + p.decay);
    ng.gain.linearRampToValueAtTime(0, t + p.decay + 0.012);
  } else {
    ng.gain.setValueAtTime(peak, t);
    ng.gain.exponentialRampToValueAtTime(0.0005, t + p.decay);
  }
  noise.connect(bp).connect(ng).connect(out);
  noise.stop(t + p.decay + 0.03);
  const sources = [noise], nodes = [bp, ng];
  if (p.toneLevel) {
    const tone = oscillator(c, 'triangle', p.tone * 1.4, t);
    tone.frequency.exponentialRampToValueAtTime(p.tone, t + 0.03);
    const tg = gainNode(c);
    tg.gain.setValueAtTime(vel * p.toneLevel, t);
    tg.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    tone.connect(tg).connect(out);
    tone.stop(t + 0.1);
    sources.push(tone);
    nodes.push(tg);
  }
  r.track(sources, nodes);
}

function playClap(r, out, t, vel, p) {
  if (!r.claim(3)) return;
  const c = r.context;
  const noise = noiseSource(r, t);
  const bp = filterNode(c, 'bandpass', p.bp, p.q);
  const g = gainNode(c);
  const peak = vel * p.level;
  g.gain.setValueAtTime(0, t);
  for (const offset of [0, 0.011, 0.022]) {
    g.gain.setValueAtTime(peak, t + offset);
    g.gain.exponentialRampToValueAtTime(peak * 0.15, t + offset + 0.009);
  }
  g.gain.setValueAtTime(peak * 0.8, t + 0.031);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 0.031 + p.decay);
  noise.connect(bp).connect(g).connect(out);
  noise.stop(t + p.decay + 0.06);
  r.track([noise], [bp, g]);
}

function playHat(r, out, t, vel, decay, p) {
  if (!r.claim(1)) return;
  const c = r.context;
  const noise = noiseSource(r, t);
  const hp = filterNode(c, 'highpass', p.hp, 1.1);
  const g = gainNode(c);
  g.gain.setValueAtTime(vel * p.level, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
  noise.connect(hp).connect(g).connect(out);
  noise.stop(t + decay + 0.02);
  r.track([noise], [hp, g]);
}

function playPerc(r, out, t, vel, p, priority = 1) {
  if (!r.claim(priority)) return;
  const c = r.context;
  const peak = vel * p.level;
  if (p.kind === 'rim') {
    // Cross-stick "tock": two short, slightly inharmonic partials.
    const hi = oscillator(c, 'triangle', 1750, t), lo = oscillator(c, 'sine', 520, t);
    const hg = gainNode(c), lg = gainNode(c);
    hg.gain.setValueAtTime(peak, t);
    hg.gain.exponentialRampToValueAtTime(0.0005, t + 0.03);
    lg.gain.setValueAtTime(peak * 0.8, t);
    lg.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    hi.connect(hg).connect(out);
    lo.connect(lg).connect(out);
    hi.stop(t + 0.06);
    lo.stop(t + 0.06);
    r.track([hi, lo], [hg, lg]);
    return;
  }
  const shape = { shaker: [6500, 1.5, 0.012, 0.08], ride: [8000, 1, 0.001, 0.7], brush: [2800, 0.7, 0.035, 0.18] }[p.kind] || [6500, 1.5, 0.012, 0.08];
  const [freq, q, attack, decay] = shape;
  const noise = noiseSource(r, t);
  const bp = filterNode(c, 'bandpass', freq, q);
  const g = gainNode(c);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0005, t + attack + decay);
  noise.connect(bp).connect(g).connect(out);
  noise.stop(t + attack + decay + 0.02);
  r.track([noise], [bp, g]);
}

function playTom(r, out, t, vel, freq) {
  if (!r.claim(2)) return;
  const c = r.context;
  const body = oscillator(c, 'sine', freq * 1.6, t);
  body.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
  const g = gainNode(c);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel * 0.5, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 0.38);
  body.connect(g).connect(out);
  body.stop(t + 0.4);
  r.track([body], [g]);
}

function playCrash(r, out, t, vel) {
  if (!r.claim(1)) return;
  const c = r.context;
  const noise = noiseSource(r, t, true);
  const hp = filterNode(c, 'highpass', 5200, 0.6);
  const g = gainNode(c);
  g.gain.setValueAtTime(vel * 0.13, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + 2.2);
  noise.connect(hp).connect(g).connect(out);
  noise.stop(t + 2.25);
  r.track([noise], [hp, g]);
}

function playRiser(r, out, t, dur, vel) {
  if (!r.claim(1)) return;
  const c = r.context;
  const noise = noiseSource(r, t, true);
  const bp = filterNode(c, 'bandpass', 350, 4);
  bp.frequency.setValueAtTime(350, t);
  bp.frequency.exponentialRampToValueAtTime(hz(c, 7000), t + dur);
  const g = gainNode(c);
  g.gain.setValueAtTime(0.0005, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.16, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
  noise.connect(bp).connect(g).connect(out);
  noise.stop(t + dur + 0.05);
  r.track([noise], [bp, g]);
}

function playBass(r, out, t, midi, dur, vel, p) {
  if (!r.claim(3)) return;
  const c = r.context;
  const f = midiToFreq(midi), end = t + dur, stopAt = end + p.release + 0.03;
  const lp = filterNode(c, 'lowpass', p.cutoff, p.q);
  lp.frequency.setValueAtTime(p.cutoff + p.env * vel, t);
  lp.frequency.setTargetAtTime(p.cutoff, t + 0.004, p.decay / 3);
  if (p.motion) lp.frequency.setTargetAtTime(p.cutoff * p.motion, t + p.decay, Math.max(0.05, dur / 2));
  const amp = gainNode(c);
  const peak = vel * p.level;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + p.attack);
  amp.gain.setTargetAtTime(peak * 0.8, t + p.attack, 0.1);
  amp.gain.setTargetAtTime(0, Math.max(end, t + p.attack), p.release / 4);
  const sources = [], nodes = [lp, amp];
  for (const detune of p.detune ? [-p.detune, p.detune] : [0]) {
    const o = oscillator(c, p.wave, f, t);
    o.detune.value = detune;
    o.connect(lp);
    o.stop(stopAt);
    sources.push(o);
  }
  lp.connect(amp).connect(out);
  if (p.sub) {
    const sub = oscillator(c, 'sine', f, t);
    const sg = gainNode(c, p.sub);
    sub.connect(sg).connect(amp);
    sub.stop(stopAt);
    sources.push(sub);
    nodes.push(sg);
  }
  r.track(sources, nodes);
}

function playPad(r, out, t, notes, dur, vel, p, wow) {
  if (!r.claim(2)) return;
  const c = r.context;
  const hold = Math.max(t + dur, t + p.attack), stopAt = hold + p.release + 0.05;
  const lp = filterNode(c, 'lowpass', p.cutoff * 0.55, p.q ?? 0.6);
  lp.frequency.setValueAtTime(p.cutoff * 0.55, t);
  lp.frequency.linearRampToValueAtTime(p.cutoff, t + Math.min(dur, p.attack * 1.5));
  const amp = gainNode(c);
  const peak = vel * p.level / Math.sqrt(notes.length);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + p.attack);
  amp.gain.setTargetAtTime(0, hold, p.release / 4);
  const sources = [], nodes = [lp, amp];
  for (const midi of notes) {
    for (const detune of [-p.detune, p.detune]) {
      const o = oscillator(c, p.wave, midiToFreq(midi), t);
      o.detune.value = detune;
      if (p.wow) attachWow(wow, o.detune, nodes);
      o.connect(lp);
      o.stop(stopAt);
      sources.push(o);
    }
  }
  lp.connect(amp).connect(out);
  r.track(sources, nodes);
}

// Two-operator FM electric piano: a bright, decaying modulation index gives the tine attack.
function playKeys(r, out, t, notes, dur, vel, p, wow) {
  if (!r.claim(2)) return;
  const c = r.context;
  dur = Math.max(dur, 0.08);
  const end = t + dur, stopAt = end + p.release + 0.05;
  const lp = filterNode(c, 'lowpass', p.cutoff, 0.5);
  lp.connect(out);
  const sources = [], nodes = [lp];
  const peak = vel * p.level / Math.sqrt(notes.length);
  notes.forEach((midi, i) => {
    const tn = t + i * (p.strum || 0);
    if (tn > end - 0.04) return;
    const f = midiToFreq(midi);
    const carrier = oscillator(c, 'sine', f, tn), modulator = oscillator(c, 'sine', f * p.ratio, tn);
    const depth = gainNode(c);
    depth.gain.setValueAtTime(f * p.index * (0.5 + vel * 0.5), tn);
    depth.gain.setTargetAtTime(f * p.index * 0.08, tn, 0.18);
    modulator.connect(depth).connect(carrier.frequency);
    const amp = gainNode(c);
    amp.gain.setValueAtTime(0, tn);
    amp.gain.linearRampToValueAtTime(peak, tn + 0.004);
    amp.gain.setTargetAtTime(peak * 0.35, tn + 0.004, p.decay / 3);
    amp.gain.setTargetAtTime(0, end, p.release / 4);
    carrier.connect(amp).connect(lp);
    if (p.wow) attachWow(wow, carrier.detune, nodes);
    carrier.stop(stopAt);
    modulator.stop(stopAt);
    sources.push(carrier, modulator);
    nodes.push(depth, amp);
  });
  if (sources.length) r.track(sources, nodes);
  else lp.disconnect();
}

function playStab(r, out, t, notes, dur, vel, p) {
  if (!r.claim(2)) return;
  const c = r.context;
  const end = t + Math.max(dur, 0.05), stopAt = end + p.release + 0.05;
  const lp = filterNode(c, 'lowpass', p.cutoff, 1.2);
  lp.frequency.setValueAtTime(p.cutoff + p.env * vel, t);
  lp.frequency.setTargetAtTime(p.cutoff, t, p.decay / 3);
  const amp = gainNode(c);
  const peak = vel * p.level / Math.sqrt(notes.length);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.003);
  amp.gain.setTargetAtTime(peak * 0.55, t + 0.003, 0.08);
  amp.gain.setTargetAtTime(0, end, p.release / 4);
  const sources = [];
  for (const midi of notes) {
    for (const detune of [-p.detune, p.detune]) {
      const o = oscillator(c, 'sawtooth', midiToFreq(midi), t);
      o.detune.value = detune;
      o.connect(lp);
      o.stop(stopAt);
      sources.push(o);
    }
  }
  lp.connect(amp).connect(out);
  r.track(sources, [lp, amp]);
}

const LEAD_PARTIALS = {
  saw: [['sawtooth', 1, -7, 0.6], ['sawtooth', 1, 7, 0.6]],
  soft: [['triangle', 1, 0, 1], ['sine', 2, 0, 0.12]],
  pluck: [['sawtooth', 1, 0, 0.7], ['square', 1, 6, 0.35]],
  organ: [['square', 1, 0, 0.45], ['sine', 2, 0, 0.4], ['sine', 0.5, 0, 0.5]],
  flugel: [['sawtooth', 1, 0, 0.8], ['sine', 1, 0, 0.4]],
};

function playLead(r, out, t, midi, dur, vel, p, from = null, wow = null) {
  if (!r.claim(2)) return;
  const c = r.context;
  const f = midiToFreq(midi), end = t + Math.max(dur, 0.05), peak = vel * p.level;
  const sources = [], nodes = [];
  const amp = gainNode(c);
  amp.connect(out);
  nodes.push(amp);
  const voice = (type, ratio, detune = 0) => {
    const o = oscillator(c, type, f * ratio, t);
    if (from && p.glide) {
      o.frequency.setValueAtTime(from * ratio, t);
      o.frequency.exponentialRampToValueAtTime(f * ratio, t + p.glide);
    }
    o.detune.value = detune;
    if (p.wow) attachWow(wow, o.detune, nodes);
    sources.push(o);
    return o;
  };
  let stopAt;
  if (p.inst === 'bell' || p.inst === 'vibes') {
    const fundamental = voice('sine', 1);
    const partial = voice('sine', p.inst === 'bell' ? p.ratio : 4);
    const pg = gainNode(c);
    if (p.inst === 'bell') {
      // FM bell: an inharmonic modulator whose index dies quickly.
      pg.gain.setValueAtTime(f * p.index, t);
      pg.gain.exponentialRampToValueAtTime(f * p.index * 0.02 + 0.01, t + 0.6);
      partial.connect(pg).connect(fundamental.frequency);
    } else {
      pg.gain.setValueAtTime(0.25, t);
      pg.gain.setTargetAtTime(0, t, 0.05);
      partial.connect(pg).connect(amp);
    }
    nodes.push(pg);
    fundamental.connect(amp);
    const decay = p.inst === 'bell' ? p.decay : 1.6;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.003);
    amp.gain.setTargetAtTime(0, t + 0.003, decay / 4);
    stopAt = t + decay + 0.05;
  } else {
    const lp = filterNode(c, 'lowpass', p.cutoff, p.q ?? 1);
    lp.connect(amp);
    nodes.push(lp);
    for (const [type, ratio, detune, level] of LEAD_PARTIALS[p.inst]) {
      const g = gainNode(c, level);
      voice(type, ratio, detune).connect(g).connect(lp);
      nodes.push(g);
    }
    if (p.inst === 'pluck') {
      lp.frequency.setValueAtTime(p.cutoff + p.env * vel, t);
      lp.frequency.setTargetAtTime(p.cutoff, t, p.decay / 2);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + 0.002);
      amp.gain.setTargetAtTime(0, t + 0.002, p.decay * 1.2);
    } else {
      if (p.inst === 'saw') {
        lp.frequency.setValueAtTime(p.cutoff * 1.8, t);
        lp.frequency.setTargetAtTime(p.cutoff, t, 0.07);
      } else if (p.inst === 'flugel') {
        lp.frequency.setValueAtTime(p.cutoff * 0.35, t);
        lp.frequency.linearRampToValueAtTime(p.cutoff, t + 0.08);
        lp.frequency.setTargetAtTime(p.cutoff * 0.75, t + 0.08, Math.max(0.1, dur / 2));
      }
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + p.attack);
      amp.gain.setTargetAtTime(peak * 0.8, t + p.attack, 0.15);
    }
    amp.gain.setTargetAtTime(0, Math.max(end, t + 0.01), (p.release ?? 0.1) / 4);
    stopAt = Math.max(end, t + 0.01) + (p.release ?? 0.1) + 0.05;
    if (p.vibrato && dur > 0.35) {
      // Delayed vibrato, as a singer or player would add it on held notes.
      const lfo = oscillator(c, 'sine', 5.2, t);
      const depth = gainNode(c);
      depth.gain.setValueAtTime(0, t);
      depth.gain.setValueAtTime(0, t + 0.22);
      depth.gain.linearRampToValueAtTime(p.vibrato, t + 0.6);
      lfo.connect(depth);
      for (const o of sources.slice()) depth.connect(o.detune);
      sources.push(lfo);
      nodes.push(depth);
    }
  }
  for (const o of sources) o.stop(stopAt);
  r.track(sources, nodes);
}

function playArp(r, out, t, midi, dur, vel, p) {
  if (!r.claim(1)) return;
  const c = r.context;
  const o = oscillator(c, p.wave, midiToFreq(midi), t);
  const lp = filterNode(c, 'lowpass', p.cutoff, 3);
  lp.frequency.setValueAtTime(p.cutoff * 2, t);
  lp.frequency.setTargetAtTime(p.cutoff, t, 0.04);
  const g = gainNode(c);
  const decay = Math.min(dur, p.decay);
  g.gain.setValueAtTime(vel * p.level, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
  o.connect(lp).connect(g).connect(out);
  o.stop(t + decay + 0.02);
  r.track([o], [lp, g]);
}

// Station idents: a few notes in the station's own sound, played between the static and the music.
const IDENTS = {
  bruine(r, out, t) {
    const s = STYLES.bruine.sounds;
    playKeys(r, out, t, [53, 57, 60, 64, 67], 1.3, 0.8, s.chords, null);
    [[0.42, 72, 0.26], [0.7, 74, 0.2], [0.92, 69, 0.55]].forEach(([at, midi, dur]) => playLead(r, out, t + at, midi, dur, 0.75, s.leads[0]));
    return t + 1.45;
  },
  paillettes(r, out, t) {
    const s = STYLES.paillettes.sounds, step = 60 / 122 / 4;
    playKick(r, out, t, 0.9, s.kick);
    playStab(r, out, t, [57, 60, 64, 67], step * 2, 0.9, s.chords);
    playStab(r, out, t + step * 3, [57, 60, 64, 67], step * 2, 0.75, s.chords);
    playClap(r, out, t + step * 4, 0.9, s.snare);
    playStab(r, out, t + step * 6, [55, 59, 62, 67], step * 3, 0.85, s.chords);
    playKick(r, out, t + step * 8, 0.9, s.kick);
    return t + step * 9;
  },
  retroviseur(r, out, t) {
    const s = STYLES.retroviseur.sounds, step = 60 / 100 / 4;
    [57, 64, 69, 72, 76].forEach((midi, i) => playArp(r, out, t + i * step, midi + 12, 1.5, 0.85, s.arp));
    playSnare(r, out, t + step * 5, 0.9, s.snare);
    playPad(r, out, t + step * 5, [57, 60, 64, 69], 0.6, 0.9, { ...s.chords, attack: 0.04 }, null);
    playLead(r, out, t + step * 5, 76, 0.55, 0.8, s.leads[0]);
    return t + step * 5 + 0.75;
  },
  'jungle-beton'(r, out, t) {
    const s = STYLES['jungle-beton'].sounds, step = 60 / 172 / 4;
    [0.35, 0.5, 0.65, 0.8].forEach((vel, i) => playSnare(r, out, t + i * step, vel, s.snare));
    playKick(r, out, t + step * 4, 0.95, s.kick);
    playBass(r, out, t + step * 4, 40, 0.5, 0.9, s.bass);
    playSnare(r, out, t + step * 6, 1, s.snare);
    playLead(r, out, t + step * 4, 83, 0.4, 0.8, s.leads[0]);
    playLead(r, out, t + step * 7, 88, 0.6, 0.7, s.leads[0]);
    return t + step * 7 + 0.45;
  },
  'minuit-velours'(r, out, t) {
    const s = STYLES['minuit-velours'].sounds;
    playKeys(r, out, t, [57, 61, 64, 66], 1.5, 0.7, s.chords, null);
    [[0, 78], [0.28, 74], [0.56, 69], [0.84, 76]].forEach(([at, midi]) => playLead(r, out, t + at, midi, 0.5, 0.75, s.leads[0]));
    return t + 1.55;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Buffers built once per radio

function makeNoise(c, seconds) {
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const data = buffer.getChannelData(0), rng = createRng('noise');
  for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1;
  return buffer;
}

function makeCrackle(c, seconds) {
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const data = buffer.getChannelData(0), rng = createRng('crackle');
  let hiss = 0;
  for (let i = 0; i < data.length; i++) {
    hiss += ((rng() * 2 - 1) - hiss) * 0.2;
    data[i] = hiss * 0.08;
    if (rng() < 0.0005) {
      const amp = (0.3 + rng() * 0.7) * (rng() < 0.5 ? -1 : 1), length = 8 + Math.floor(rng() * 30);
      for (let k = 0; k < length && i + k < data.length; k++) data[i + k] += amp * Math.exp(-k / 4);
    }
  }
  return buffer;
}

function makeImpulse(c, seconds) {
  const length = Math.floor(c.sampleRate * seconds);
  const buffer = c.createBuffer(2, length, c.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel), rng = createRng(`room:${channel}`);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      const x = i / length;
      smooth += ((rng() * 2 - 1) - smooth) * (0.7 - 0.5 * x); // the tail darkens as it decays
      data[i] = i < c.sampleRate * 0.008 ? 0 : smooth * Math.pow(1 - x, 3);
    }
  }
  return buffer;
}

// ---------------------------------------------------------------------------------------------------------------
// Per-station bus: instrument groups (pan, sends, sidechain pump, arrangement filter) into a gentle compressor.

const GROUPS = {
  kick: { pan: 0 },
  snare: { pan: 0.03, rev: 0.12 },
  hats: { pan: 0.24, rev: 0.04 },
  perc: { pan: -0.26, rev: 0.12 },
  bass: { pan: 0, pump: true },
  chords: { pan: -0.14, rev: 0.22, del: 0.06, pump: true, sweep: true },
  pad: { pan: 0.12, rev: 0.4, pump: true, sweep: true },
  lead: { pan: 0.08, rev: 0.25, del: 0.22, pump: true },
  arp: { pan: 0, rev: 0.18, del: 0.3, pump: true, sweep: true },
  fx: { pan: 0, rev: 0.45 },
};

function createBus(r, stationIndex) {
  const c = r.context, station = STATIONS[stationIndex], style = STYLES[station.id];
  const nodes = [], sources = [];
  const add = node => (nodes.push(node), node);
  const out = add(gainNode(c, style.gain)); // loudness trim so stations match when switching
  out.connect(r.input);
  const comp = add(c.createDynamicsCompressor());
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.25;
  comp.connect(out);
  const music = add(gainNode(c, 1));
  const ident = add(gainNode(c, 1));
  const level = add(gainNode(c, 1));
  music.connect(level).connect(comp);
  ident.connect(comp);
  const rev = add(gainNode(c, 1));
  const del = add(gainNode(c, 1));
  rev.connect(r.reverbIn);
  del.connect(r.delayIn);
  ident.connect(add(gainNode(c, 0.25))).connect(rev);
  const pump = add(gainNode(c, 1));
  pump.connect(music);
  const sweep = add(filterNode(c, 'lowpass', OPEN, 1));
  sweep.connect(pump);
  const groups = {}, pans = {};
  for (const [name, spec] of Object.entries(GROUPS)) {
    const input = add(gainNode(c, style.mix[name] ?? 1));
    const pan = pans[name] = add(panNode(c, spec.pan));
    input.connect(pan).connect(spec.sweep ? sweep : spec.pump ? pump : music);
    const [send, echo] = style.sends[name] ?? [spec.rev ?? 0, spec.del ?? 0];
    if (send > 0) input.connect(add(gainNode(c, send))).connect(rev);
    if (echo > 0) input.connect(add(gainNode(c, echo))).connect(del);
    groups[name] = input;
  }
  const lfo = (frequency, depth, target) => {
    const o = c.createOscillator();
    o.frequency.value = frequency;
    const g = add(gainNode(c, depth));
    o.connect(g);
    if (target) g.connect(target);
    o.start();
    sources.push(o);
    return g;
  };
  if (style.tremolo) lfo(4.4, style.tremolo, groups.chords.gain);
  if (pans.arp.pan) lfo(0.13, 0.55, pans.arp.pan);
  const wow = style.wow ? lfo(0.55, style.wow, null) : null;
  if (style.crackle) {
    const vinyl = c.createBufferSource();
    vinyl.buffer = r.crackle;
    vinyl.loop = true;
    vinyl.connect(add(filterNode(c, 'highpass', 900))).connect(add(gainNode(c, style.crackle))).connect(comp);
    vinyl.start();
    sources.push(vinyl);
  }
  let disposed = false;
  return {
    station: stationIndex, groups, music, ident, wow, resumeAt: 0, fresh: true, lastLead: null, until: 0,
    pumpDepth: style.pump,
    pumpAt(t, beat) {
      const g = pump.gain;
      g.setValueAtTime(1, t);
      g.linearRampToValueAtTime(1 - style.pump, t + 0.012);
      g.linearRampToValueAtTime(1, t + beat * 0.62);
    },
    levelTo(t, value) {
      level.gain.setTargetAtTime(value, Math.max(t, c.currentTime), 0.08);
    },
    sweepTo(t, from, to, dur) {
      const now = c.currentTime;
      if (t < now) {
        // Joining mid-bar: start from where the sweep would be by now.
        from = lerpExp(from, to, (now - t) / dur);
        dur -= now - t;
        t = now;
      }
      sweep.frequency.setValueAtTime(hz(c, from), t);
      if (to !== from && dur > 0.01) sweep.frequency.exponentialRampToValueAtTime(hz(c, to), t + dur);
    },
    fadeOut(now) {
      for (const g of [out, rev, del]) {
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(0, now, 0.02);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const s of sources) {
        try { s.stop(); } catch { /* never started */ }
        s.disconnect();
      }
      for (const node of nodes) node.disconnect();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------

export class RadioSystem {
  constructor(context, destination, { seed, station = 0 } = {}) {
    this.context = context;
    this.session = Number.isFinite(seed) ? seed : Math.floor(Math.random() * 2 ** 31);
    this.rng = createRng(`${this.session}:live`);
    this.onChange = null;
    this.index = Number.isInteger(station) && station >= -1 && station < STATIONS.length ? station : 0;
    this.playing = false;
    this.disposed = false;
    this.voices = 0;
    this.live = new Set();
    this.bus = null;
    this.retired = [];
    this.cursor = null;
    this.clock = null;
    this.offAt = null;
    this.songs = new Map();
    this.noise = makeNoise(context, 2);
    this.crackle = makeCrackle(context, 4);
    this.nodes = [];
    const c = context, add = node => (this.nodes.push(node), node);

    // Output chain: car-radio EQ (gentle highpass, softened top), muffle, volume, in-car fade, master.
    this.input = add(gainNode(c, 1));
    const highpass = add(filterNode(c, 'highpass', 80, 0.55));
    const shelf = add(filterNode(c, 'highshelf', 6000));
    shelf.gain.value = -4;
    this.muffle = add(filterNode(c, 'lowpass', 20000, 0.6));
    this.muffleGain = add(gainNode(c, 1));
    this.volume = add(gainNode(c, 1));
    this.fade = add(gainNode(c, 0));
    this.master = add(gainNode(c, MASTER));
    this.input.connect(highpass).connect(shelf).connect(this.muffle).connect(this.muffleGain)
      .connect(this.volume).connect(this.fade).connect(this.master).connect(destination);

    // Shared room reverb and ping-pong delay, fed by the station buses' sends.
    this.reverbIn = add(gainNode(c, 1));
    if (typeof c.createConvolver === 'function') {
      const convolver = add(c.createConvolver());
      convolver.buffer = makeImpulse(c, 1.9);
      this.reverbIn.connect(add(filterNode(c, 'highpass', 250, 0.5))).connect(convolver).connect(add(gainNode(c, 0.5))).connect(this.input);
    }
    this.delayIn = add(gainNode(c, 1));
    this.delays = [];
    if (typeof c.createDelay === 'function') {
      const a = add(c.createDelay(2)), b = add(c.createDelay(2));
      const low = add(filterNode(c, 'highpass', 300, 0.5)), tone = add(filterNode(c, 'lowpass', 3200, 0.5));
      const ret = add(gainNode(c, 0.5));
      this.delayIn.connect(low).connect(tone).connect(a);
      a.connect(add(panNode(c, -0.55))).connect(ret);
      a.connect(add(gainNode(c, 0.75))).connect(b);
      b.connect(add(panNode(c, 0.55))).connect(ret);
      b.connect(add(gainNode(c, 0.45))).connect(low);
      ret.connect(this.input);
      this.delays = [a, b];
    }
    this.reported = this.songKey(context.currentTime);
  }

  get stationIndex() {
    return this.index;
  }

  get nowPlaying() {
    if (this.disposed || this.index < 0) return null;
    const station = STATIONS[this.index];
    const plan = songPlan(station.id, this.clockAt(this.context.currentTime).seed);
    return { station: this.index, id: station.id, name: station.name, tagline: station.tagline, genre: station.genre, color: station.color, song: plan.title, artist: plan.artist };
  }

  setPlaying(on) {
    if (this.disposed) return;
    on = Boolean(on);
    if (on === this.playing) return;
    this.playing = on;
    const now = this.context.currentTime;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setTargetAtTime(on ? 1 : 0, now, FADE / 3);
    this.cursor = null;
    if (!on) {
      this.offAt = now + FADE * 1.6;
      return;
    }
    this.offAt = null;
    if (this.index >= 0 && !this.bus) this.openBus(now, now);
  }

  setStation(index) {
    if (this.disposed) return;
    const next = Math.trunc(Number(index));
    if (!(next >= -1 && next < STATIONS.length) || next === this.index) return;
    this.index = next;
    this.cursor = null;
    if (this.playing) {
      const now = this.context.currentTime;
      this.retire(now);
      this.playStatic(now, next < 0);
      if (next >= 0) {
        const bus = this.openBus(now, Infinity);
        const end = IDENTS[STATIONS[next].id](this, bus.ident, now + 0.2);
        bus.resumeAt = Math.max(now + 0.5, end - 0.25);
        bus.music.gain.setValueAtTime(0, now);
        bus.music.gain.setValueAtTime(0, bus.resumeAt);
        bus.music.gain.linearRampToValueAtTime(1, bus.resumeAt + 0.5);
      }
    }
    this.reported = this.songKey(this.context.currentTime);
    this.notify();
  }

  next() {
    this.setStation(mod(this.index + 2, STATIONS.length + 1) - 1);
  }

  prev() {
    this.setStation(mod(this.index, STATIONS.length + 1) - 1);
  }

  setVolume(value) {
    if (this.disposed) return;
    const v = clamp(Number(value) || 0, 0, 1);
    this.volume.gain.setTargetAtTime(v, this.context.currentTime, 0.05);
  }

  setMuffled(amount) {
    if (this.disposed) return;
    const a = clamp(Number(amount) || 0, 0, 1), now = this.context.currentTime;
    this.muffle.frequency.setTargetAtTime(hz(this.context, 20000 * Math.pow(450 / 20000, a)), now, 0.08);
    this.muffleGain.gain.setTargetAtTime(1 - 0.35 * a, now, 0.08);
  }

  update() {
    if (this.disposed) return;
    const now = this.context.currentTime;
    if (!Number.isFinite(now)) return;
    if (this.retired.length) {
      this.retired = this.retired.filter(bus => {
        if (now < bus.until) return true;
        bus.dispose();
        return false;
      });
    }
    if (!this.playing && this.bus && this.offAt !== null && now >= this.offAt) {
      this.stopLive(now);
      this.bus.dispose();
      this.bus = null;
    }
    const key = this.songKey(now);
    if (key !== this.reported) {
      this.reported = key;
      this.notify();
    }
    if (this.playing && this.bus && this.index >= 0) this.schedule(now);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.playing = false;
    this.stopLive(this.context.currentTime);
    this.bus?.dispose();
    for (const bus of this.retired) bus.dispose();
    this.bus = null;
    this.retired = [];
    this.cursor = null;
    for (const node of this.nodes) node.disconnect();
    this.onChange = null;
  }

  // ----- internals -------------------------------------------------------------------------------------------

  // Voice cap: low-priority parts (hats, fx, arps) give way first when many notes ring at once.
  claim(priority) {
    return this.voices < VOICE_LIMITS[priority];
  }

  track(sources, nodes) {
    this.voices++;
    let pending = sources.length;
    const release = () => {
      if (--pending > 0) return;
      this.voices--;
      for (const s of sources) {
        this.live.delete(s);
        s.disconnect();
      }
      for (const node of nodes) node.disconnect();
    };
    for (const s of sources) {
      s.onended = release;
      this.live.add(s);
    }
  }

  stopLive(now) {
    for (const s of this.live) {
      try { s.stop(now + 0.08); } catch { /* already stopped */ }
    }
  }

  notify() {
    if (typeof this.onChange !== 'function') return;
    try {
      this.onChange(this.nowPlaying);
    } catch (error) {
      console.error(error);
    }
  }

  clockAt(time) {
    const hint = this.clock?.station === this.index ? this.clock : null;
    return (this.clock = stationClock(this.index, time, this.session, hint));
  }

  songKey(time) {
    return this.index < 0 ? 'off' : `${this.index}:${this.clockAt(time).songIndex}`;
  }

  song(seed) {
    let song = this.songs.get(seed);
    if (!song) {
      song = generateSong(STATIONS[this.index].id, seed);
      this.songs.set(seed, song);
      if (this.songs.size > 6) this.songs.delete(this.songs.keys().next().value);
    }
    return song;
  }

  openBus(now, resumeAt) {
    const bus = this.bus = createBus(this, this.index);
    bus.resumeAt = resumeAt;
    const beat = 60 / STATIONS[this.index].bpm;
    for (const delay of this.delays) delay.delayTime.setTargetAtTime(beat * 0.75, now, 0.03);
    return bus;
  }

  retire(now) {
    if (!this.bus) return;
    this.stopLive(now);
    this.bus.fadeOut(now);
    this.bus.until = now + 0.4;
    this.retired.push(this.bus);
    this.bus = null;
  }

  playStatic(t, off) {
    const c = this.context, dur = off ? 0.09 : 0.3;
    const noise = noiseSource(this, t);
    const bp = filterNode(c, 'bandpass', 2000, 0.9);
    const g = gainNode(c);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.008);
    for (let k = 0.02; k < dur - 0.02; k += 0.022) {
      bp.frequency.setValueAtTime(700 + this.rng() * 4300, t + k);
      g.gain.setValueAtTime(0.12 + this.rng() * 0.22, t + k);
    }
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    noise.connect(bp).connect(g).connect(this.input);
    noise.stop(t + dur + 0.02);
    const sources = [noise], nodes = [bp, g];
    // Tuning whistle, or the low thump of the set switching off.
    const tone = oscillator(c, 'sine', off ? 95 : 1700, t);
    tone.frequency.exponentialRampToValueAtTime(off ? 55 : 3400, t + dur);
    const tg = gainNode(c);
    tg.gain.setValueAtTime(off ? 0.3 : 0.025, t);
    tg.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    tone.connect(tg).connect(this.input);
    tone.stop(t + dur + 0.02);
    sources.push(tone);
    nodes.push(tg);
    this.track(sources, nodes);
  }

  schedule(now) {
    const bus = this.bus;
    const horizon = now + LOOKAHEAD;
    if (bus.resumeAt > horizon) return; // the ident is still on air
    let cur = this.cursor;
    const stale = cur && cur.clock.start + cur.step * cur.song.stepDur < now - 0.05;
    if (!cur || cur.bus !== bus || stale) cur = this.resync(Math.max(now + 0.01, bus.resumeAt));
    for (let guard = 0; guard < 512; guard++) {
      if (cur.step >= cur.song.totalSteps) {
        const clock = stationClock(this.index, cur.clock.start + cur.clock.duration + 1e-6, this.session, cur.clock);
        cur = this.cursor = { bus, clock, song: this.song(clock.seed), step: 0, bar: -1, byStep: null };
        continue;
      }
      const t = cur.clock.start + cur.step * cur.song.stepDur;
      if (t >= horizon) break;
      this.scheduleStep(cur, t);
      cur.step++;
    }
  }

  // Jump to the live position (after a pause, a background tab or a station change): missed notes are dropped.
  resync(time) {
    const hint = this.clock?.station === this.index && this.clock.start <= time ? this.clock : null;
    const clock = stationClock(this.index, time, this.session, hint);
    const song = this.song(clock.seed);
    const step = Math.max(0, Math.ceil((time - clock.start) / song.stepDur - 1e-6));
    const cur = this.cursor = { bus: this.bus, clock, song, step, bar: -1, byStep: null };
    if (step < song.totalSteps && step % STEPS) {
      const bar = Math.floor(step / STEPS), barStart = clock.start + bar * STEPS * song.stepDur;
      for (const event of renderBar(song, bar)) {
        if (event.inst === 'sweep' || event.inst === 'level') this.playEvent(event, barStart, song);
      }
      if (this.bus.fresh) this.resumeSustained(cur, time);
    }
    this.bus.fresh = false;
    return cur;
  }

  // When tuning in mid-bar, pads, held chords and long bass notes that are already sounding come in too.
  resumeSustained(cur, time) {
    const { song, step } = cur;
    const bar = Math.floor(step / STEPS);
    for (let b = Math.max(0, bar - 1); b <= bar; b++) {
      for (const event of renderBar(song, b)) {
        if (event.inst !== 'pad' && event.inst !== 'chords' && event.inst !== 'bass') continue;
        const begin = b * STEPS + event.step, end = begin + event.dur;
        if (begin < step && end - step >= 4) this.playEvent({ ...event, dur: end - step, vel: event.vel * 0.85 }, time, song);
      }
    }
  }

  scheduleStep(cur, t) {
    const bar = Math.floor(cur.step / STEPS), step = cur.step % STEPS;
    if (bar !== cur.bar) {
      cur.bar = bar;
      cur.byStep = Array.from({ length: STEPS }, () => []);
      for (const event of renderBar(cur.song, bar)) cur.byStep[event.step].push(event);
    }
    const song = cur.song, now = this.context.currentTime;
    // Swing delays the off-beat 16ths, or with an 8th grid the off-beat 8ths (and the 16ths around them).
    const amount = (song.swing - 0.5) * 2, pos = step % 4;
    const swing = (song.swingGrid === 8 ? (pos === 2 ? 2 * amount : pos % 2 ? amount : 0) : step % 2 ? amount : 0) * song.stepDur;
    for (const event of cur.byStep[step]) {
      if (event.inst === 'sweep' || event.inst === 'level') {
        this.playEvent(event, t, song);
        continue;
      }
      const human = (this.rng() - 0.5) * 2 * song.humanize;
      this.playEvent(event, Math.max(now, t + swing + human), song);
    }
  }

  playEvent(event, t, song) {
    const bus = this.bus, g = bus.groups, s = song.sounds, sd = song.stepDur;
    const vel = clamp(event.vel ?? 0.8, 0, 1.2);
    switch (event.inst) {
      case 'sweep': bus.sweepTo(t, event.from, event.to, event.dur * sd); break;
      case 'level': bus.levelTo(t, event.level); break;
      case 'kick':
        playKick(this, g.kick, t, vel, s.kick);
        if (bus.pumpDepth && event.step % 4 === 0) bus.pumpAt(t, sd * 4);
        break;
      case 'snare': playSnare(this, g.snare, t, vel, s.snare); break;
      case 'hat': playHat(this, g.hats, t, vel, s.hat.decay, s.hat); break;
      case 'ohat': playHat(this, g.hats, t, vel * 0.85, clamp(event.dur * sd, 0.05, s.hat.open), s.hat); break;
      case 'perc': playPerc(this, g.perc, t, vel, s.perc); break;
      case 'tom': playTom(this, g.snare, t, vel, event.freq); break;
      case 'crash': playCrash(this, g.fx, t, vel); break;
      case 'riser': playRiser(this, g.fx, t, event.dur * sd, vel); break;
      case 'bass': playBass(this, g.bass, t, event.midi, event.dur * sd * 0.92, vel, s.bass); break;
      case 'pad': playPad(this, g.pad, t, event.notes, event.dur * sd, vel, s.pad, bus.wow); break;
      case 'chords': {
        const dur = event.dur * sd * 0.95;
        if (s.chords.inst === 'stab') playStab(this, g.chords, t, event.notes, dur, vel, s.chords);
        else if (s.chords.inst === 'pad') playPad(this, g.chords, t, event.notes, dur, vel, s.chords, bus.wow);
        else playKeys(this, g.chords, t, event.notes, dur, vel, s.chords, bus.wow);
        break;
      }
      case 'lead': {
        const dur = event.dur * sd * 0.95, last = bus.lastLead, midi = event.midi + (s.lead.octave || 0);
        const from = last && t >= last.start && t - last.end < 0.06 ? last.freq : null;
        playLead(this, g.lead, t, midi, dur, vel, s.lead, from, bus.wow);
        bus.lastLead = { start: t, end: t + dur, freq: midiToFreq(midi) };
        break;
      }
      case 'arp': playArp(this, g.arp, t, event.midi, event.dur * sd, vel, s.arp); break;
      default: break;
    }
  }
}
