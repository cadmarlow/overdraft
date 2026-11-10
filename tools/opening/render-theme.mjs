import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SOURCE = 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/440300901dfe9275fd84e0b7763af1f8443ae62e';
const RATE = 44100;
const BEAT = 60 / 88;
const BARS = 20;
const FRAMES = Math.round(BARS * 4 * BEAT * RATE);
const TAU = Math.PI * 2;

const cello = [[50, 'D2'], [57, 'A2'], [60, 'C3'], [67, 'G3']];
const strings = [
  ...cello.map(([note, name]) => ['cello', note, `Strings/Cello Section/susvib/susvib_${name}_v3_1.wav`]),
  ...cello.flatMap(([note, name]) => [1, 2].map(rr => ['spic', note, `Strings/Cello Section/spic/spic_${name}_v2_RR${rr}.wav`])),
  ...[[69, 'A3'], [76, 'E4'], [79, 'G4'], [83, 'B4']].map(([note, name]) => ['violin', note, `Strings/Violin Section/susVib/VlnEns_susVib_${name}_v2.wav`])
];
const palette = [
  ...strings,
  ...[[50, 'D2'], [57, 'A2'], [60, 'C3']].map(([note, name]) => ['horn', note, `Brass/F Horn/sus/MOHorn_sus_${name}_v2_1.wav`]),
  ...[14, 18, 24, 30].map(key => ['piano', 21 + key * 2, `Keys/Upright Piano/Player_dyn2_rr1_${String(key).padStart(3, '0')}.wav`]),
  ['timp', 0, 'Percussion/Timpani/Timpani1_Hit_v3_rr1_Sum.wav'],
  ['gong', 0, 'VSCO 1 Percussion/varMetal/Gong/gong_hit_mf.wav'],
  ['drum', 0, 'VSCO 1 Percussion/drums/bass/bdrum3_mp_1.wav'],
  ...[2, 3].map(rr => ['snare', 0, `VSCO 1 Percussion/drums/snare/OldSnare/snare_mf${rr}.wav`]),
  ...[2, 3].map(rr => ['shaker', 0, `VSCO 1 Percussion/varWood/Camo's Shaker/shake${rr}.wav`])
];

function decodeWave(bytes) {
  let format, data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const payload = bytes.subarray(offset + 8, offset + 8 + size);
    if (id === 'fmt ') format = payload;
    if (id === 'data') data = payload;
    offset += 8 + size + size % 2;
  }
  const channels = format.readUInt16LE(2);
  const rate = format.readUInt32LE(4);
  const width = format.readUInt16LE(14) / 8;
  if (channels !== 2 || rate !== RATE || ![2, 3].includes(width)) throw new Error('Unexpected sample format');

  const frames = Math.min(data.length / (2 * width), RATE * 6);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const scale = 2 ** (8 * width - 1);
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    left[i] = data.readIntLE(i * 2 * width, width) / scale;
    right[i] = data.readIntLE((i * 2 + 1) * width, width) / scale;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const attack = left.findIndex((value, i) => Math.max(Math.abs(value), Math.abs(right[i])) > peak * .025);
  return { left, right, peak, offset: Math.max(0, attack - 620) };
}

const temp = await mkdtemp(join(tmpdir(), 'overdraft-score-'));
try {
  const cache = process.argv[2] ? resolve(process.argv[2]) : temp;
  await mkdir(cache, { recursive: true });
  const sources = await Promise.all(palette.map(async ([instrument, note, path]) => {
    const local = join(cache, path.split('/').at(-1));
    let bytes = await readFile(local).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (!bytes) {
      const url = SOURCE + '/' + path.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      await writeFile(local, bytes);
    }
    return { instrument, note, ...decodeWave(bytes) };
  }));

  const left = new Float32Array(FRAMES), right = new Float32Array(FRAMES);
  const room = new Float32Array(FRAMES);
  let seed = 0x2e6801;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
  const roomTaps = [[.041, .115, .027], [.079, .043, .103], [.127, .072, -.017], [.181, -.022, .07],
    [.233, .061, .021], [.317, .022, .061], [.479, -.031, .027], [.641, .024, .017], [.873, .011, -.016]];

  function sample(instrument, note, at, length, gain, pan = 0, { attack = .012, release = .18, wet = .3, rate = 1 } = {}) {
    const bank = sources.filter(s => s.instrument === instrument);
    const nearest = Math.min(...bank.map(s => Math.abs(s.note - note)));
    const choices = bank.filter(s => Math.abs(s.note - note) === nearest);
    const src = choices[Math.floor(random() * choices.length)];
    const pitch = rate * 2 ** ((note - src.note) / 12);
    const end = Math.min((src.left.length - src.offset - 2) / pitch, Math.round((length * BEAT + release) * RATE));
    const begin = Math.round(at * BEAT * RATE);
    const leftGain = gain / src.peak * Math.cos((1 + pan) * Math.PI / 4);
    const rightGain = gain / src.peak * Math.sin((1 + pan) * Math.PI / 4);
    for (let i = 0; i < end; i++) {
      const pos = i * pitch + src.offset;
      const base = Math.floor(pos), frac = pos - base;
      const frame = (begin + i + FRAMES) % FRAMES;
      const env = Math.min(1, i / (RATE * attack), (end - i) / (RATE * release));
      const l = (src.left[base] * (1 - frac) + src.left[base + 1] * frac) * env * leftGain;
      const r = (src.right[base] * (1 - frac) + src.right[base + 1] * frac) * env * rightGain;
      left[frame] += l;
      right[frame] += r;
      room[frame] += (l + r) * wet;
    }
  }

  function low(note, at, length, gain, kick = false) {
    const baseHz = 440 * 2 ** ((note - 69) / 12);
    const begin = Math.round(at * BEAT * RATE);
    const end = Math.round(length * BEAT * RATE);
    let phase = 0;
    for (let i = 0; i < end; i++) {
      const t = i / RATE;
      phase += TAU * (baseHz + (kick ? 125 * Math.exp(-t * 52) : 5 * Math.exp(-t * 15))) / RATE;
      const env = Math.min(1, t / .006, (end - i) / (RATE * .075)) * Math.exp(-t * (kick ? 11 : 1.8));
      const value = Math.tanh(Math.sin(phase) * 1.6 + Math.sin(phase * 2) * .27) * env * gain;
      const frame = (begin + i + FRAMES) % FRAMES;
      left[frame] += value;
      right[frame] += value;
    }
  }

  // E minor, with a Phrygian upper neighbour over the dominant. Each bar is four beats.
  const harmony = [
    [28, 52, 55, 59], [24, 52, 55, 59], [33, 52, 57, 60], [23, 51, 54, 57],
    [28, 52, 55, 59], [28, 52, 54, 59], [24, 52, 55, 59], [23, 51, 54, 57],
    [28, 52, 55, 59], [31, 50, 55, 59], [33, 52, 57, 60], [23, 51, 54, 60],
    [24, 52, 55, 59], [33, 52, 57, 60], [30, 51, 57, 60], [23, 51, 54, 57],
    [28, 52, 55, 59], [24, 52, 55, 59], [33, 52, 57, 60], [23, 51, 54, 57]
  ];
  const call = [
    [[0, 71, .6], [.73, 76, 1.11], [2.38, 79, .7], [3.17, 78, .57]],
    [[.03, 75, 1.3], [1.65, 76, 1.35], [3.3, 71, .42]],
    [[0, 74, .62], [.74, 76, 1.1], [2.11, 72, .84], [3.21, 71, .48]],
    [[.04, 69, .98], [1.19, 66, .7], [2.21, 75, 1.37]]
  ];
  const bridge = [
    [[.16, 83, 1.65], [2.17, 79, 1.46]], [[.27, 81, 1.75], [2.35, 76, 1.25]],
    [[.06, 75, 1.76], [2.28, 72, 1.41]], [[.12, 66, 1.32], [2.03, 77, .55], [2.73, 75, .83]]
  ];

  harmony.forEach(([bass, a, b, c], bar) => {
    const at = bar * 4;
    const opening = bar < 4;
    const breakdown = bar >= 12 && bar < 16;
    const hit = [0, 4, 8, 12, 16].includes(bar);
    const intensity = opening ? .77 : breakdown ? .62 : 1;
    low(bass, at, 1.9, .16 * intensity);
    low(bass, at + 2.66, .92, .13 * intensity);
    sample('cello', a, at - .08, 3.82, .12, -.36, { attack: .15, release: .31 });
    sample('cello', b, at + .08, 3.56, .079, .35, { attack: .2, release: .36, wet: .6 });
    sample('violin', c + 12, at + 1.43, 2.18, .059, .28, { attack: .39, release: .52, wet: .65 });
    if (hit) {
      sample('timp', 0, at + .03, 1.8, .23 * intensity, -.12, { release: .8, wet: .5 });
      sample('gong', 0, at, 2.9, .15 * intensity, .2, { release: 1.3, wet: .62 });
      sample('horn', b, at - .02, 1.27, .11, -.28, { attack: .12, release: .43, wet: .7 });
    }
    if (!opening && !breakdown) {
      sample('horn', a - 12, at + 2.5, 1.16, .13, .11, { attack: .13, release: .34, wet: .75 });
    }
    const ostinato = [[0, a], [.5, a + 12], [1.27, b], [1.77, a], [2.5, c], [3.04, b], [3.59, a]];
    ostinato.forEach(([offset, note], step) => {
      if (breakdown && step % 2) return;
      sample('spic', note, at + offset - .024 + (random() - .5) * .032, .32,
        (step % 3 === 0 ? .20 : .105) * intensity, step % 2 ? -.31 : .13, { release: .082, wet: .44 });
    });
    const melody = breakdown ? bridge[bar % 4] : call[bar % 4];
    melody.forEach(([offset, note, length], step) => {
      const pitch = opening ? note - 12 : note;
      const strong = step === 0 || step === 2;
      sample('piano', pitch, at + offset, length, strong ? .22 : .15, -.16, { attack: .008, release: .42, wet: .55 });
      if (!opening || bar === 2 || bar === 3) sample('violin', pitch, at + offset - .063, length,
        (strong ? .215 : .15) * intensity, .22, { attack: .094, release: .19, wet: .45 });
    });
    const kicks = breakdown ? [0] : bar % 2 ? [0, 1.71, 2.59, 3.55] : [0, .77, 2.29, 2.88];
    kicks.forEach((offset, step) => {
      if (opening && bar < 2 && step > 0) return;
      const gain = (step === 0 ? .46 : .33) * intensity;
      low(31, at + offset, .47, gain, true);
      sample('drum', 0, at + offset, .32, gain * .35, 0, { release: .14, wet: .15 });
    });
    if (!breakdown && bar > 0) {
      for (const offset of [1.025, 3.03]) sample('snare', 0, at + offset, .24, .3 * intensity, .07, { attack: .004, release: .065, wet: .38 });
      for (let step = 0; step < 8; step++) sample('shaker', 0, at + step * .5 + (step % 2 ? .065 : 0), .2,
        (.035 + (step % 2) * .035 + random() * .016) * intensity, step % 2 ? -.31 : .32, { release: .055, wet: .16, rate: 1.18 });
    }
  });

  for (const [delay, l, r] of roomTaps) {
    const offset = Math.round(delay * RATE);
    for (let i = 0, frame = offset; i < FRAMES; i++) {
      left[frame] += room[i] * l;
      right[frame] += room[i] * r;
      if (++frame === FRAMES) frame = 0;
    }
  }

  // A stereo master with gentle saturation and headroom for the AAC encode.
  let peak = 0;
  for (let i = 0; i < FRAMES; i++) {
    left[i] = Math.tanh(left[i] * 1.5);
    right[i] = Math.tanh(right[i] * 1.5);
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const output = Buffer.alloc(44 + FRAMES * 4);
  output.write('RIFF', 0); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(2, 22);
  output.writeUInt32LE(RATE, 24); output.writeUInt32LE(RATE * 4, 28);
  output.writeUInt16LE(4, 32); output.writeUInt16LE(16, 34); output.write('data', 36);
  output.writeUInt32LE(FRAMES * 4, 40);
  const level = 0.88 * 32767 / peak;
  for (let i = 0; i < FRAMES; i++) {
    output.writeInt16LE(Math.round(left[i] * level), 44 + i * 4);
    output.writeInt16LE(Math.round(right[i] * level), 46 + i * 4);
  }
  const master = join(temp, 'la-dette.wav');
  await writeFile(master, output);
  const destination = resolve(import.meta.dirname, '../../assets/opening/la-dette.m4a');
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac ', '-b', '128000', '-q', '127', master, destination]);
  console.log(`La dette · ${(FRAMES / RATE).toFixed(1)} s · ${destination}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
