import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import * as TSL from '../vendor/three/build/three.tsl.js';
import * as mods from '../js/weapon-mods.js';
import { loadModule } from './helpers/module.cjs';

// What CALIBRE fits on the weapons, as objects: the hardware is machined to the shipped models (weapon-attachments.js)
// and a dressed weapon shows what its state says (weapon-models.js). No renderer: geometry, visibility and the values
// the finish shader reads.
const dir = new URL('../assets/weapons/', import.meta.url);
const text = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const utils = loadModule(text('../vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), { imports: { three: THREE } });
const hardware = loadModule(text('../js/weapon-attachments.js'), { imports: { 'three/webgpu': THREE, 'three/addons/utils/BufferGeometryUtils.js': utils }, filename: 'weapon-attachments.js' });
const fetched = [];
const models = loadModule(text('../js/weapon-models.js').replaceAll('import.meta.url', '"file:///js/weapon-models.js"'), {
  imports: { 'three/webgpu': { ...THREE, MeshStandardNodeMaterial: THREE.MeshStandardMaterial }, 'three/tsl': TSL, './weapon-mods.js': mods,
    './weapon-attachments.js': hardware, 'three/addons/utils/BufferGeometryUtils.js': utils },
  globals: { URL, TextDecoder, DataView, Uint8Array, Uint16Array, Uint32Array, Float32Array, Int32Array, Map, console: { warn() {}, log() {} },
    // the model files come off the disk; no picture decodes here, so the materials go without their maps
    fetch: async (url) => {
      const name = String(url).split('/').pop();
      fetched.push(name);
      if (!name.endsWith('.bin')) throw new Error('no images in a test');
      const b = readFileSync(new URL(name, dir));
      return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    } },
  filename: 'weapon-models.js'
});
const GUNS = ['pistol', 'smg', 'shotgun', 'rifle'];
const read = (id) => { const b = readFileSync(new URL(`${id}.bin`, dir)); return models.parseWeapon(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const bounds = (geometry) => { const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position); return { lo: box.min.toArray(), hi: box.max.toArray() }; };
const partBounds = (id, name) => {
  const { header, position, index } = read(id), part = header.parts.find((p) => p.name === name);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = part.start; k < part.start + part.count; k++) for (let c = 0; c < 3; c++) {
    const v = position.array[index.array[k] * 3 + c];
    lo[c] = Math.min(lo[c], v); hi[c] = Math.max(hi[c], v);
  }
  return { lo, hi };
};
const kits = Object.fromEntries(GUNS.map((kind) => [kind, hardware.buildAttachments(kind)]));

test('every upgrade of the catalogue has its hardware, cleanly machined and light enough to draw', () => {
  for (const kind of GUNS) {
    // the rifle's foregrip is the one its model came with (carved out of it below)
    const expected = mods.modsFor(kind).map((m) => m.id).filter((id) => !(kind === 'rifle' && id === 'grip')).sort();
    assert.deepEqual(Object.keys(kits[kind]).sort(), expected, kind);
    let total = 0;
    for (const [id, { geometry, on, holster }] of Object.entries(kits[kind])) {
      const { position, normal, tint, surface } = geometry.attributes, label = `${kind} ${id}`;
      assert.equal(geometry.index, null);
      assert.ok(position.count > 150 && position.count % 3 === 0, label);
      assert.ok(position.count / 3 < 9000, `${label}: ${position.count / 3} triangles`);
      total += position.count / 3;
      for (const a of [normal, tint, surface]) assert.equal(a.count, position.count, label);
      for (const a of [position, normal, tint, surface]) assert.ok(a.array.every(Number.isFinite), label);
      for (let i = 0; i < normal.count; i += 7) assert.ok(Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1) < 0.02, `${label}: unit normals`);
      for (let i = 0; i < surface.count; i += 5) {
        assert.ok(surface.getX(i) >= 0 && surface.getX(i) <= 1 && surface.getY(i) > 0.03 && surface.getY(i) <= 1 && surface.getZ(i) >= 0, `${label}: metalness, roughness, glow`);
        assert.ok(tint.getX(i) >= 0 && tint.getX(i) <= 1, label);
      }
      // closed, facing outwards: the volume its triangles enclose is positive
      let volume = 0;
      const p = position.array;
      for (let i = 0; i < p.length; i += 9) volume += p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
      assert.ok(volume / 6 > 1e-7, `${label}: ${(volume / 6 * 1e6).toFixed(2)} cm³`);
      // a longer magazine, a tube, a choke are part of the weapon and wear its finish; what is bolted on stays as it is
      let finished = 0;
      for (let i = 0; i < surface.count; i++) finished += surface.getW(i);
      assert.equal(finished > 0, id === 'mag' || id === 'choke', `${label}: the weapon's finish`);
      assert.ok(on === null || ['action', 'magazine'].includes(on), label);
      assert.equal(holster, !(kind === 'pistol' && (id === 'suppressor' || id === 'sight')), `${label}: only a pistol's holster is too tight`);
      // a display that measures a dressed weapon measures the bare one: hardware weighs nothing in a bounding box
      assert.ok(geometry.boundingBox.min.equals(geometry.boundingBox.max));
      assert.ok(geometry.boundingSphere.radius >= 1);
    }
    assert.ok(total < 22000, `${kind}: ${total} triangles of hardware`);
  }
  // magazines ride on the magazine (they leave the well with it), the pistol's sight on its slide, a pump's grip on the pump
  assert.equal(kits.pistol.mag.on, 'magazine'); assert.equal(kits.smg.mag.on, 'magazine'); assert.equal(kits.rifle.mag.on, 'magazine');
  assert.equal(kits.pistol.sight.on, 'action'); assert.equal(kits.shotgun.grip.on, 'action');
  assert.equal(kits.shotgun.mag.on, null, 'a tube extension is screwed to the gun');
});

test('suppressors are real-size, coaxial with the barrel they are screwed on, and the muzzle moves out with them', () => {
  const sizes = { pistol: [0.032, 0.17], smg: [0.037, 0.195], rifle: [0.04, 0.205] };
  for (const [kind, [diameter, length]] of Object.entries(sizes)) {
    const { lo, hi } = bounds(kits[kind].suppressor.geometry), mount = hardware.MOUNTS[kind];
    const reach = hardware.muzzleReach(kind, ['suppressor']);
    const along = Math.hypot(...reach), dir = reach.map((v) => v / along);
    assert.ok(Math.abs(dir[1] - Math.sin(mount.pitch)) < 1e-6 && dir[2] > 0.99, `${kind}: along the barrel as modelled`);
    assert.ok(along > 0.1 && along < length, `${kind}: ${along.toFixed(3)} m further out`);
    assert.ok(Math.abs(hi[2] - (mount.bore[2] + reach[2])) < 0.004, `${kind}: the new muzzle is the can's mouth`);
    assert.ok(lo[2] < mount.bore[2] - 0.004, `${kind}: it reaches back over the muzzle`);
    assert.ok(Math.abs(hi[2] - lo[2] - length) < 0.012, `${kind}: ${(hi[2] - lo[2]).toFixed(3)} m long`);
    // the widest ring of the can, measured across: its diameter and, at mid-length, its centre on the bore's line
    assert.ok(Math.abs(hi[0] - lo[0] - diameter) < 0.004, `${kind}: ${(hi[0] - lo[0]).toFixed(4)} m across`);
    const mid = (lo[2] + hi[2]) / 2 - mount.bore[2];
    assert.ok(Math.abs((lo[0] + hi[0]) / 2 - (mount.bore[0] + Math.tan(mount.yaw) * mid)) < 0.0012, `${kind}: centred on the bore, across`);
    assert.ok(Math.abs((lo[1] + hi[1]) / 2 - (mount.bore[1] + Math.tan(mount.pitch) * mid)) < 0.0015, `${kind}: centred on the bore, in height`);
    // the bore sits on the model's own muzzle
    const stock = partBounds(kind, 'body');
    assert.ok(Math.abs(stock.hi[2] - mount.bore[2]) < 0.002, `${kind}: the muzzle face is the model's`);
  }
  assert.equal(hardware.muzzleReach('shotgun', ['suppressor']), null);
  assert.equal(hardware.muzzleReach('pistol', ['mag', 'sight']), null);
  assert.equal(hardware.muzzleReach('grenade', ['suppressor']), null);
  const choke = hardware.muzzleReach('shotgun', ['choke']);
  assert.ok(choke[2] > 0.025 && choke[2] < 0.045 && choke[0] === 0 && choke[1] === 0);
});

test('sights sit on the slide or the rail, foregrips hang under theirs, at the size of the real thing', () => {
  // the pistol's reflex: on the slide, about 3 cm tall, no wider than a hand's breadth of slide
  let b = bounds(kits.pistol.sight.geometry);
  const slide = partBounds('pistol', 'action');
  assert.ok(Math.abs(b.lo[1] - 0.0714) < 0.001 && b.lo[1] < slide.hi[1], 'on the top of the slide');
  assert.ok(b.hi[1] - b.lo[1] > 0.025 && b.hi[1] - b.lo[1] < 0.034, `${(b.hi[1] - b.lo[1]).toFixed(3)} m tall`);
  assert.ok(b.lo[2] > 0.026 && b.hi[2] < slide.hi[2], 'ahead of the rear sight, on the slide');
  assert.ok(b.hi[0] - b.lo[0] < 0.031);
  // the SMG's red dot: on the top rail between the two folded sights, about 4.5-5 cm over it
  b = bounds(kits.smg.sight.geometry);
  assert.ok(b.lo[1] > 0.136 && b.lo[1] < 0.143, 'its clamp bites the rail');
  assert.ok(b.hi[1] - 0.1428 > 0.042 && b.hi[1] - 0.1428 < 0.054, `${(b.hi[1] - 0.1428).toFixed(3)} m over the rail`);
  assert.ok(b.lo[2] > -0.11 && b.hi[2] < 0.19);
  // the rifle's scope: on the receiver's rail, ahead of the stock and short of the front sight, a 30 mm tube
  b = bounds(kits.rifle.sight.geometry);
  assert.ok(b.hi[2] - b.lo[2] > 0.22 && b.hi[2] - b.lo[2] < 0.27, `${(b.hi[2] - b.lo[2]).toFixed(3)} m long`);
  assert.ok(b.lo[2] > -0.24 && b.hi[2] < 0.1);
  assert.ok(b.lo[1] > 0.092 && b.lo[1] < 0.105, 'its rings bite the rail');
  assert.ok(b.hi[1] < 0.185);
  // foregrips: under the SMG's lower rail, under the shotgun's pump, long enough for a hand
  b = bounds(kits.smg.grip.geometry);
  assert.ok(Math.abs(b.hi[1] - 0.0592) < 0.006 && b.hi[1] - b.lo[1] > 0.085, 'under the rail');
  assert.ok(b.lo[2] > 0.11 && b.hi[2] < 0.25);
  b = bounds(kits.shotgun.grip.geometry);
  const pump = partBounds('shotgun', 'action');
  assert.ok(Math.abs(b.hi[1] - pump.lo[1]) < 0.002 && b.hi[1] - b.lo[1] > 0.085, 'against the pump');
  assert.ok(b.lo[2] > pump.lo[2] && b.hi[2] < pump.hi[2]);
});

test('longer magazines carry on from the ones they replace; the tube and the choke end where a shotgun’s do', () => {
  for (const kind of ['pistol', 'smg', 'rifle']) {
    const stock = partBounds(kind, 'magazine'), longer = bounds(kits[kind].mag.geometry);
    assert.ok(longer.lo[1] < stock.lo[1] - 0.03, `${kind}: ${((stock.lo[1] - longer.lo[1]) * 100).toFixed(1)} cm more magazine`);
    assert.ok(longer.lo[1] > stock.lo[1] - 0.085, `${kind}: and not a drum`);
    assert.ok(longer.hi[1] >= stock.lo[1] - 0.002, `${kind}: it starts on the old one`);
    assert.ok(Math.abs(longer.lo[0] + longer.hi[0]) < 0.002, `${kind}: in the weapon's mid-plane`);
    assert.ok(longer.hi[0] - longer.lo[0] < stock.hi[0] - stock.lo[0] + 0.008, `${kind}: as wide as its magazine`);
  }
  const barrel = partBounds('shotgun', 'body').hi[2];
  const tube = bounds(kits.shotgun.mag.geometry), choke = bounds(kits.shotgun.choke.geometry);
  assert.ok(tube.hi[2] < barrel && tube.hi[2] > barrel - 0.01, 'the tube now reaches the muzzle, never past it');
  assert.ok(tube.hi[1] > 0.09, 'and is clamped to the barrel');
  assert.ok(choke.lo[2] < barrel && choke.hi[2] > barrel + 0.025 && choke.hi[2] < barrel + 0.045, 'the choke stands out of the muzzle');
  assert.ok(Math.abs((choke.lo[1] + choke.hi[1]) / 2 - hardware.MOUNTS.shotgun.bore[1]) < 0.001);
});

test('the hands and the muzzle follow what is on the weapon', () => {
  const hold = { grip: [0, -0.04, -0.2], fore: [0, -0.012, 0.112], upright: true, muzzle: [0, 0.078, 0.47], stance: 'rifle' };
  const smg = { grip: [0, 0, 0], fore: [0, 0.046, 0.14], muzzle: [0, 0.092, 0.32], stance: 'rifle' };
  const pistol = { grip: [0, 0, 0], fore: null, muzzle: [0, 0.06, 0.174], stance: 'pistol' };
  // the SENTINEL: its factory foregrip is the upgrade. Without it the hand cups the handguard
  const bare = hardware.dressedHold('rifle', hold, []);
  assert.equal(bare.upright, false);
  assert.ok(bare.fore[1] > 0.03 && bare.fore[1] < 0.06 && bare.fore[2] > 0.05 && bare.fore[2] < 0.17);
  assert.deepEqual(bare.muzzle, hold.muzzle);
  assert.equal(hardware.dressedHold('rifle', hold, ['grip', 'mag', 'sight']), hold, 'with it, the weapon is held as it always was');
  const quiet = hardware.dressedHold('rifle', hold, ['suppressor', 'grip']);
  assert.equal(quiet.upright, true);
  assert.ok(quiet.muzzle[2] > hold.muzzle[2] + 0.1 && quiet.muzzle[1] > hold.muzzle[1], 'the muzzle is the suppressor’s, up the barrel’s own slope');
  assert.equal(quiet.stance, 'rifle');
  assert.equal(hardware.dressedHold('rifle', hold, ['suppressor', 'grip']), quiet, 'one object per weapon and set of upgrades');
  // elsewhere a foregrip is something to take
  assert.equal(hardware.dressedHold('smg', smg, ['mag', 'sight']), smg);
  const gripped = hardware.dressedHold('smg', smg, ['grip']);
  assert.equal(gripped.upright, true);
  assert.ok(gripped.fore[1] < smg.fore[1] - 0.02, 'lower: on the grip, not under the rail');
  const b = bounds(kits.smg.grip.geometry);
  assert.ok(gripped.fore[2] > b.lo[2] && gripped.fore[2] < b.hi[2] && gripped.fore[1] > b.lo[1] && gripped.fore[1] < b.hi[1], 'inside the grip itself');
  const pumped = hardware.dressedHold('shotgun', { ...smg, pump: 0.08 }, ['grip']);
  const g = bounds(kits.shotgun.grip.geometry);
  assert.ok(pumped.upright && pumped.pump === 0.08 && pumped.fore[1] > g.lo[1] && pumped.fore[1] < g.hi[1] && pumped.fore[2] > g.lo[2] && pumped.fore[2] < g.hi[2]);
  // a pistol only grows longer
  assert.equal(hardware.dressedHold('pistol', pistol, ['mag', 'sight']), pistol);
  assert.ok(Math.abs(hardware.dressedHold('pistol', pistol, ['suppressor']).muzzle[2] - 0.338) < 0.002);
  assert.deepEqual(pistol.muzzle, [0, 0.06, 0.174], 'the shared entry is never written to');
});

test('a dressed weapon shows what its state says, keeps its shared materials and wears its finish mesh by mesh', async () => {
  await models.loadWeaponModels();
  assert.ok(fetched.includes('rifle.bin'));
  // the SENTINEL's own foregrip and red dot were carved out of its body, and every triangle is still drawn once
  const { header, index } = read('rifle');
  const plain = models.createWeaponModel('rifle');
  const runs = [];
  plain.traverse((o) => { if (o.isMesh) runs.push([o.geometry.drawRange.start, o.geometry.drawRange.count, o.parent === plain ? 'body' : o.parent.name]); });
  runs.sort((a, b) => a[0] - b[0]);
  assert.deepEqual(runs.map((r) => r[2]).sort(), ['body', 'factory-grip', 'factory-sight', 'magazine']);
  let covered = 0;
  for (const [start, count] of runs) { assert.equal(start, covered); covered += count; }
  assert.equal(covered, index.count);
  const run = (name) => runs.find((r) => r[2] === name)[1] / 3;
  assert.equal(run('factory-grip'), 448, 'the grip and its screw');
  assert.equal(run('factory-sight'), 776, 'the red dot, its cap and its two side plates');
  assert.equal(run('body') + run('factory-grip') + run('factory-sight'), header.parts.find((p) => p.name === 'body').count / 3);
  assert.equal(plain.userData.dress, undefined, 'a plain weapon carries nothing more');
  assert.ok(plain.getObjectByName('factory-grip').visible && plain.getObjectByName('factory-sight').visible, 'and looks as it always did');
  assert.equal(models.dressWeapon(plain, { sight: 1 }), plain, 'dressing it is a no-op');

  for (const kind of GUNS) {
    const model = models.createWeaponModel(kind, { dress: true }), dress = model.userData.dress;
    const shown = () => Object.entries(dress.parts).filter(([, part]) => part.objects.every((o) => o.visible)).map(([id]) => id).sort();
    assert.deepEqual(Object.keys(dress.parts).sort(), mods.modsFor(kind).map((m) => m.id).sort(), `${kind}: one part per upgrade`);
    assert.deepEqual(shown(), [], `${kind}: nothing fitted to begin with`);
    for (const { id } of mods.modsFor(kind)) {
      models.dressWeapon(model, { [id]: 1 });
      assert.deepEqual(shown(), [id], `${kind} ${id}`);
      models.dressWeapon(model, { [id]: 0 });
      assert.deepEqual(shown(), [], `${kind} ${id} stowed`);
    }
    const all = Object.fromEntries(mods.modsFor(kind).map((m) => [m.id, 1]));
    models.dressWeapon(model, { ...all, bogus: 1, choke: 1, suppressor: 1 });
    assert.deepEqual(shown(), Object.keys(all).sort(), `${kind}: everything, and nothing that does not fit`);
    assert.deepEqual([...dress.fitted].sort(), Object.keys(all).sort());
    // attachments hang off the part they ride on
    for (const [id, { on }] of Object.entries(kits[kind])) assert.equal(dress.parts[id].objects[0].parent, on ? model.userData[on] : model, `${kind} ${id}`);
    // put away: only a pistol sheds anything
    models.stowWeapon(model, true);
    assert.deepEqual(shown(), Object.keys(all).filter((id) => !(kind === 'pistol' && (id === 'suppressor' || id === 'sight'))).sort(), `${kind} stowed`);
    models.stowWeapon(model, false);
    assert.deepEqual(shown(), Object.keys(all).sort());
    // finishes: values per mesh, the material shared with every other weapon of the kind
    const twin = models.createWeaponModel(kind, { dress: true });
    models.dressWeapon(model, { finish: 'or', finishes: ['or'] });
    for (const [i, mesh] of dress.worn.entries()) {
      const { coat, set } = mesh.userData.finish, furniture = kind === 'shotgun' && mesh.material.userData.index !== 1;
      assert.deepEqual(coat.toArray().slice(0, 3), mods.finishById('or').color);
      assert.equal(coat.w, furniture ? 0 : 1, `${kind}: gold is laid on steel, not on a polymer stock`);
      assert.deepEqual(set.toArray().slice(0, 3), [1, mods.finishById('or').rough, mods.finishById('or').keep]);
      assert.equal(twin.userData.dress.worn[i].material, mesh.material, 'one material for both');
      assert.equal(twin.userData.dress.worn[i].userData.finish.coat.w, 0, 'and each its own finish');
      assert.equal(twin.userData.dress.worn[i].geometry, mesh.geometry);
    }
    assert.equal(dress.finish.coat.w, 1, 'and on the hardware that is part of the weapon');
    for (const part of Object.values(dress.parts)) for (const o of part.objects) if (o.isMesh) assert.equal(o.userData.finish, dress.finish);
    assert.equal(twin.userData.dress.finish.coat.w, 0);
    models.dressWeapon(model, { finish: 'sable' });
    assert.ok(dress.worn.every((mesh) => mesh.userData.finish.coat.w === 1), `${kind}: paint covers furniture too`);
    models.dressWeapon(model, { finish: 'chrome' });
    assert.ok(dress.worn.every((mesh) => mesh.userData.finish.coat.w === 0) && dress.finish.coat.w === 0, 'an unknown finish is the stock one');
    models.dressWeapon(model, null);
    assert.deepEqual(shown(), []);
    // the warm-up shows everything at once, and dressing puts it right again
    models.showEverything(model);
    assert.deepEqual(shown(), Object.keys(dress.parts).sort());
    models.dressWeapon(model, { mag: 1 });
    assert.deepEqual(shown(), ['mag']);
  }
  // the SENTINEL: its red dot stays until a scope takes its place, its foregrip shows only once bought
  const rifle = models.createWeaponModel('rifle', { dress: true });
  const dot = rifle.getObjectByName('factory-sight'), grip = rifle.getObjectByName('factory-grip');
  assert.ok(dot.visible && !grip.visible);
  models.dressWeapon(rifle, { sight: 1, grip: 1 });
  assert.ok(!dot.visible && grip.visible && rifle.userData.dress.parts.sight.objects[0].visible);
  models.dressWeapon(rifle, { sight: 0, grip: 0 });
  assert.ok(dot.visible && !grip.visible);
  // what is not a firearm is handed back plain
  assert.equal(models.createWeaponModel('grenade', { dress: true }).userData.dress, undefined);
  assert.equal(models.createWeaponModel('nothing', { dress: true }), null);
});
