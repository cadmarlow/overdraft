import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { BONE_COUNT } from '../js/human-skeleton.js';

const dir = new URL('../assets/people/', import.meta.url);
const align = (n) => (n + 3) & ~3;

function sections(name) {
  const file = readFileSync(new URL(name, dir));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const headLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headLength)));
  let o = align(4 + headLength);
  const take = (Type, bytes) => { const a = new Type(buffer, o, bytes / Type.BYTES_PER_ELEMENT); o = align(o + bytes); return a; };
  return { header, take, buffer, start: align(4 + headLength) };
}

function person(name) {
  const { header, take } = sections(name);
  const [p, n, uv, i, w, f, b] = header.sections;
  return { ...header, position: take(Float32Array, p), normal: take(Float32Array, n), uv: take(Float32Array, uv), index: take(Uint8Array, i), weight: take(Uint8Array, w), faces: take(Uint32Array, f), bind: take(Float32Array, b) };
}

function sound(m, bones) {
  const vertices = m.position.length / 3;
  assert.ok(m.position.every(Number.isFinite), 'positions are finite');
  for (let v = 0; v < vertices; v++) {
    const sum = m.weight[v * 4] + m.weight[v * 4 + 1] + m.weight[v * 4 + 2] + m.weight[v * 4 + 3];
    assert.equal(sum, 255, `vertex ${v}: weights sum to ${sum}`);
    for (let c = 0; c < 4; c++) assert.ok(m.index[v * 4 + c] < bones);
  }
  assert.ok(m.faces.every((i) => i < vertices), 'triangles use existing vertices');
}

const CAST = ['hero', 'cop', 'cop-b', 'detective', 'swat', 'crew', 'suit', 'guard'];
for (const id of CAST) {
  test(`${id}: a whole person, every vertex on the skeleton and every material painted`, () => {
    const m = person(`${id}.bin`);
    sound(m, m.bones.length);
    assert.ok(m.height > 1.6 && m.height < 2, `height ${m.height}`);
    for (const name of ['Pelvis', 'Head', 'L_Hand', 'R_Hand', 'R_Finger21', 'L_Foot']) assert.ok(m.bones.some((b) => b.name === name), name);
    m.bones.forEach((b, i) => assert.ok(b.parent < i, `${b.name} comes after its parent`));
    for (const part of m.parts) assert.ok(existsSync(new URL(`${id}_${part.name}_c.webp`, dir)), `${id} ${part.name}`);
  });
}

const CROWD = readdirSync(dir).filter((f) => /^crowd-[mf]\d+\.bin$/.test(f));
test('the street has as many men as women, each with an atlas', () => {
  assert.equal(CROWD.filter((f) => f.startsWith('crowd-m')).length, 12);
  assert.equal(CROWD.filter((f) => f.startsWith('crowd-f')).length, 12);
  for (const f of CROWD) assert.ok(existsSync(new URL(f.replace('.bin', '.webp'), dir)), f);
});

for (const name of CROWD) {
  test(`${name}: on the game's skeleton, standing, light enough for a street`, () => {
    const m = person(name);
    sound(m, BONE_COUNT);
    assert.ok(m.faces.length / 3 < 6000, `${m.faces.length / 3} triangles`);
    const ys = m.position.filter((_, i) => i % 3 === 1);
    assert.ok(Math.min(...ys) > -0.02 && Math.max(...ys) < 2.1);
    assert.ok(m.uv.every((v) => v >= 0 && v <= 1), 'inside the atlas');
  });
}

test('every gun comes with its maps', () => {
  for (const gun of ['pistol', 'smg', 'shotgun', 'rifle']) for (const f of [`gun-${gun}.bin`, `gun-${gun}_c.webp`, `gun-${gun}_n.webp`, `gun-${gun}_s.webp`]) assert.ok(existsSync(new URL(f, dir)), f);
});

test('motion capture: gaits rise in speed, loop on their first frame and rotations stay unit length', () => {
  const { header, buffer, start } = sections('mocap.bin');
  const clips = new Map(header.clips.map((c) => [c.name, c]));
  const total = header.clips.reduce((n, c) => n + c.frames, 0);
  const quats = new Int16Array(buffer, start + total * 12, total * header.bones.length * 4);
  for (const sex of ['m', 'f']) {
    const speeds = ['walk_slow_01', 'walk_neutral', 'run_slow_01', 'run_neutral', 'run_fast_01'].map((n) => clips.get(`${sex}_${n}`).speed);
    assert.deepEqual(speeds, [...speeds].sort((a, b) => a - b));
    assert.ok(speeds[0] > 0.5 && speeds[4] > 5);
    for (const n of ['idle_neutral_01', 'crouch_idle']) assert.ok(clips.has(`${sex}_${n}`), n);
  }
  const walk = clips.get('m_walk_neutral');
  const bones = header.bones.length;
  for (let b = 0; b < bones; b++) for (let c = 0; c < 4; c++) {
    const a = quats[walk.start * bones * 4 + b * 4 + c], z = quats[(walk.start + walk.frames - 1) * bones * 4 + b * 4 + c];
    assert.ok(Math.abs(a - z) < 2600, `${header.bones[b]} closes the loop`);
  }
  for (let i = 0; i < quats.length; i += 40004) {
    const l = Math.hypot(quats[i], quats[i + 1], quats[i + 2], quats[i + 3]) / 32767;
    assert.ok(Math.abs(l - 1) < 0.01);
  }
});

test('the crowd\'s poses cover what the street does, for men and women', () => {
  const { header, buffer, start } = sections('crowd-motion.bin');
  assert.equal(header.bones, BONE_COUNT);
  const names = new Set(header.clips.map((c) => c.name));
  for (const sex of ['m', 'f']) for (const n of ['walk_neutral', 'run_fast_01', 'idle_neutral_01', 'cell_phone_textmessage', 'drink_idle', 'umbrella_idle_01']) assert.ok(names.has(`${sex}_${n}`), n);
  const frames = header.clips.reduce((n, c) => n + c.frames, 0);
  const table = new Int16Array(buffer, start, frames * BONE_COUNT * 7);
  for (let i = 0; i < table.length; i += 7777 * 7) {
    const l = Math.hypot(table[i], table[i + 1], table[i + 2], table[i + 3]) / 32767;
    assert.ok(Math.abs(l - 1) < 0.01);
  }
});

test('what the game ships stays light and credits its sources', () => {
  const size = readdirSync(dir).reduce((n, f) => n + statSync(new URL(f, dir)).size, 0);
  assert.ok(size < 35e6, `${(size / 1e6).toFixed(1)} MB`);
  assert.match(readFileSync(new URL('LICENSE-Rocketbox.md', dir), 'utf8'), /Copyright \(c\) 2020 Microsoft/);
});
