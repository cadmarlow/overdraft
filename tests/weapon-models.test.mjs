import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import { loadModule } from './helpers/module.cjs';

// The weapons the hands hold are real models prepared by tools/weapons into assets/weapons. These tests read the
// shipped files with the game's own parser: what the importer wrote must be what the game expects, at a size and a
// triangle count a browser game can afford, with nothing of a real maker left in the file names.
const dir = new URL('../assets/weapons/', import.meta.url);
const source = readFileSync(new URL('../js/weapon-models.js', import.meta.url), 'utf8').replaceAll('import.meta.url', '"file:///js/weapon-models.js"');
const models = loadModule(source, {
  imports: { 'three/webgpu': { ...THREE, MeshStandardNodeMaterial: THREE.MeshStandardMaterial }, 'three/addons/utils/BufferGeometryUtils.js': { mergeGeometries: () => new THREE.BufferGeometry() } },
  globals: { URL, TextDecoder, DataView, Uint8Array, Uint16Array, Uint32Array, Float32Array, console: { warn() {}, log() {} } }, filename: 'weapon-models.js'
});
const read = (id) => {
  const b = readFileSync(new URL(`${id}.bin`, dir));
  return models.parseWeapon(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const KINDS = { pistol: [0.2, 0.24], smg: [0.6, 0.68], shotgun: [0.94, 1.0], rifle: [0.9, 0.98] };
const box = (attribute, index, part) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const from = part ? part.start : 0, to = part ? part.start + part.count : index.count;
  for (let k = from; k < to; k++) for (let c = 0; c < 3; c++) {
    const v = attribute.array[index.array[k] * 3 + c];
    lo[c] = Math.min(lo[c], v); hi[c] = Math.max(hi[c], v);
  }
  return { lo, hi };
};

test('the four firearms are real-size, lie along +Z, stand upright and are centred on their own mid-plane', () => {
  assert.deepEqual([...models.GUNS], Object.keys(KINDS));
  for (const [kind, [min, max]] of Object.entries(KINDS)) {
    const { header, position, normal, uv, index } = read(kind);
    assert.equal(header.version, 1);
    for (const a of [position, normal, uv]) assert.ok(a.array.every(Number.isFinite), `${kind}: finite`);
    assert.equal(position.count, normal.count);
    assert.equal(position.count, uv.count);
    assert.ok(index.array.every((i) => i < position.count), `${kind}: indices in range`);
    assert.equal(index.count % 3, 0);
    const { lo, hi } = box(position, index);
    const length = hi[2] - lo[2];
    assert.ok(length >= min && length <= max, `${kind}: ${length.toFixed(3)} m long`);
    assert.ok(length > (hi[1] - lo[1]) * 1.4 && hi[1] - lo[1] > hi[0] - lo[0], `${kind}: long, then tall, then thin`);
    assert.ok(hi[0] - lo[0] < 0.11, `${kind}: ${(hi[0] - lo[0]).toFixed(3)} m thick`);
    // the magazine sits in the mid-plane whatever sight knob or handle hangs off one side
    const magazine = header.parts.find((p) => p.name === 'magazine');
    if (magazine) { const m = box(position, index, magazine); assert.ok(Math.abs(m.lo[0] + m.hi[0]) < 0.006, `${kind}: magazine centred (${((m.lo[0] + m.hi[0]) / 2).toFixed(4)})`); }
    assert.ok(index.count / 3 <= 30000, `${kind}: ${index.count / 3} triangles`);
    assert.ok(normal.array.length && Math.abs(Math.hypot(normal.array[0], normal.array[1], normal.array[2]) - 1) < 0.02);
  }
});

test('each weapon is cut into the parts that move and every part draws something', () => {
  const moving = { pistol: ['action', 'magazine'], smg: ['magazine'], shotgun: ['action'], rifle: ['magazine'] };
  for (const kind of Object.keys(KINDS)) {
    const { header, index } = read(kind);
    const names = new Set(header.parts.map((p) => p.name));
    assert.ok(names.has('body'), `${kind}: a body`);
    for (const name of moving[kind]) assert.ok(names.has(name), `${kind}: ${name}`);
    let covered = 0;
    for (const part of header.parts) {
      assert.ok(part.count > 0 && part.count % 3 === 0, `${kind} ${part.name}: draws`);
      assert.ok(part.material >= 0 && part.material < header.materials.length);
      assert.equal(part.start, covered, `${kind} ${part.name}: parts are consecutive runs of the index`);
      covered += part.count;
    }
    assert.equal(covered, index.count, `${kind}: every triangle belongs to a part`);
    assert.ok(header.parts.length <= 6, `${kind}: ${header.parts.length} draws`);
  }
  // the pump travels a real stroke, a slide its own
  assert.ok(read('shotgun').header.travel.action >= 0.06);
  assert.ok(read('pistol').header.travel.action > 0.02 && read('pistol').header.travel.action < 0.05);
});

test('every map a material names is shipped, light enough for the web, and nothing carries a maker’s name', () => {
  let total = 0;
  for (const kind of Object.keys(KINDS)) {
    const { header } = read(kind);
    total += statSync(new URL(`${kind}.bin`, dir)).size;
    assert.ok(statSync(new URL(`${kind}.bin`, dir)).size < 700 * 1024, `${kind}.bin under 700 KB`);
    assert.ok(header.materials.length >= 1 && header.materials.length <= 3);
    for (const material of header.materials) {
      assert.ok(material.maps.c, `${kind}: colour`);
      for (const file of Object.values(material.maps)) {
        assert.match(file, new RegExp(`^${kind}(_\\d)?_(c|n|orm)\\.webp$`));
        assert.ok(existsSync(new URL(file, dir)), file);
        const size = statSync(new URL(file, dir)).size;
        assert.ok(size < 400 * 1024, `${file}: ${size} bytes`);
        total += size;
      }
    }
    assert.ok(existsSync(new URL(`icon-${kind}.webp`, dir)), `the wheel's portrait of the ${kind}`);
    assert.ok(statSync(new URL(`icon-${kind}.webp`, dir)).size < 40 * 1024);
    assert.doesNotMatch(JSON.stringify(header), /remington|kalashnikov|heckler|walther|magpul|sig ?sauer|sketchfab/i);
  }
  assert.ok(total < 6 * 1024 * 1024, `the whole arsenal weighs ${(total / 1048576).toFixed(1)} MB`);
});

test('the grenade is a real one: palm-sized, centred where the hand closes, light', () => {
  const { header, position, index } = read('grenade');
  const { lo, hi } = box(position, index);
  assert.ok(hi[0] - lo[0] > 0.055 && hi[0] - lo[0] < 0.075, 'a body about 64 mm across');
  assert.ok(hi[1] - lo[1] > 0.08 && hi[1] - lo[1] < 0.11, 'with its fuze and lever on top');
  assert.ok(Math.abs(lo[0] + hi[0]) < 0.004 && lo[1] < -0.03 && hi[1] > 0.05, 'the origin is the centre of the body');
  assert.ok(index.count / 3 < 9000);
  assert.equal(header.materials.length, 1);
  for (const file of Object.values(header.materials[0].maps)) assert.ok(statSync(new URL(file, dir)).size < 80 * 1024, file);
});

test('the action cycles on a shot and the magazine leaves, vanishes at the belt and seats again on a reload', () => {
  const part = (travel) => ({ position: { y: 0, z: 0 }, visible: true, userData: { travel }, updates: 0, updateMatrix() { this.updates++; } });
  const gun = (kind, travel) => ({ userData: { action: part(travel), magazine: part() } });
  const pistol = gun('pistol', 0.03);
  models.animateWeapon(pistol, 'pistol', 0, -1);
  assert.ok(Math.abs(pistol.userData.action.position.z + 0.03) < 1e-9, 'the slide is back on the frame the shot leaves');
  models.animateWeapon(pistol, 'pistol', 0.5, -1);
  assert.ok(Math.abs(pistol.userData.action.position.z) < 1e-6, 'and home again');
  assert.equal(pistol.userData.magazine.visible, true);
  assert.ok(pistol.userData.action.updates === 2 && pistol.userData.magazine.updates === 2, 'moved parts refresh their own matrices');
  const pump = gun('shotgun', 0.08);
  models.animateWeapon(pump, 'shotgun', 0, -1);
  assert.equal(pump.userData.action.position.z, -0, 'a pump waits for the hand');
  models.animateWeapon(pump, 'shotgun', 0.26, -1);
  assert.ok(Math.abs(pump.userData.action.position.z + 0.08) < 1e-9, 'then goes its full stroke');
  models.animateWeapon(pump, 'shotgun', 0.6, -1);
  assert.ok(Math.abs(pump.userData.action.position.z) < 1e-9);
  const rifle = gun('rifle');
  models.animateWeapon(rifle, 'rifle', 10, 0.23);
  assert.ok(rifle.userData.magazine.position.y < -0.1 && rifle.userData.magazine.visible, 'pulled out of the well');
  models.animateWeapon(rifle, 'rifle', 10, 0.42);
  assert.equal(rifle.userData.magazine.visible, false, 'gone to the belt');
  models.animateWeapon(rifle, 'rifle', 10, 0.68);
  assert.ok(rifle.userData.magazine.visible && rifle.userData.magazine.position.y > -0.05, 'the fresh one going in');
  models.animateWeapon(rifle, 'rifle', 10, 0.86);
  assert.ok(rifle.userData.action.position.z < -0.02, 'the action is worked before the weapon comes back up');
  models.animateWeapon(rifle, 'rifle', 10, -1);
  assert.ok(rifle.userData.magazine.visible && rifle.userData.magazine.position.y === 0 && Math.abs(rifle.userData.action.position.z) < 1e-6, 'a cancelled reload leaves no part hanging');
  // a model made in one piece has nothing to move and is left alone
  models.animateWeapon({ userData: { action: null, magazine: null } }, 'smg', 0, 0.3);
});
