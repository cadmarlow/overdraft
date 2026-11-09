import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import * as TSL from '../vendor/three/build/three.tsl.js';
import { loadModule } from './helpers/module.cjs';
import { createCombatResources, COMBAT_SOUNDS } from '../js/audio-combat.js';
import * as FxTextures from '../js/fx-textures.js';

const source = name => readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8');
const { EffectsSystem } = loadModule(source('fx'), { imports: { 'three/webgpu': THREE, 'three/tsl': TSL, './fx-textures.js': FxTextures } });
const makeFx = () => new EffectsSystem(new THREE.Scene(), new THREE.PerspectiveCamera());
const finite = (array, count, stride) => { for (let i = 0; i < count * stride; i++) if (!Number.isFinite(array[i])) return false; return true; };

test('gunfire effects reuse bounded pools and clear both CPU and rendered casing/decal instances', () => {
  const fx = makeFx();
  const material = fx.casingMesh.material, decalMaterial = fx.impactMesh.material;
  for (let i = 0; i < 260; i++) {
    fx.ejectCasing({ x: 0, y: 1.4, z: 0 }, { x: 0, y: 0, z: 1 }, 'rifle');
    fx.impact(0, 1.2, 2, 0, 0, -1, 'concrete');
  }
  assert.equal(fx.casings.length, 128);
  assert.equal(fx.impactMarks.length, 200);
  for (let i = 0; i < 150; i++) fx.update(1 / 60, () => 0.22);
  assert.equal(fx.casingMesh.count, 128);
  assert.equal(fx.impactMesh.count, 200);
  assert.ok(fx.casings.every(c => c.y >= 0.22 && Number.isFinite(c.x) && c.settled));
  assert.ok(finite(fx.impactMesh.instanceMatrix.array, 200, 16));
  assert.ok(finite(fx.casingMesh.instanceMatrix.array, 128, 16));
  assert.equal(fx.casingMesh.material, material);
  assert.equal(fx.impactMesh.material, decalMaterial);
  fx.clear();
  assert.equal(fx.casingMesh.count, 0);
  assert.equal(fx.impactMesh.count, 0);
  assert.equal(fx.casings.length, 0);
  assert.equal(fx.impactMarks.length, 0);
  assert.equal(fx.glow.list.length + fx.smoke.list.length, 0);
});

test('bullet marks face the surface and do not remain floating on moving metal targets', () => {
  const fx = makeFx();
  fx.impact(0, 1, 2, 0, 0, -1, 'metal');
  fx.impact(0, 1, 2, 0, 0, -1, 'glass');
  fx.impact(0, 1, 2, 0, 0, -1, 'flesh');
  fx.impact(0, 1, 2, 0, 0, -1, 'concrete', { decal: false });
  assert.equal(fx.impactMarks.length, 0, 'no decal unless the surface is known to be static');
  fx.impact(0, 1, 2, 0, 0, -1, 'concrete');
  const m = fx.impactMarks[0];
  // the quad's own axes: a right-handed frame whose normal is the surface's, so it is lit and not culled
  const t = new THREE.Vector3(m.tx, m.ty, m.tz), b = new THREE.Vector3(m.bx, m.by, m.bz);
  assert.ok(t.clone().cross(b).distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-6);
  assert.ok(Math.abs(t.length() - 1) < 1e-6 && Math.abs(t.dot(b)) < 1e-6);
  assert.ok(m.z < 2 && m.z > 1.98, 'mark sits just outside the surface');
  fx.update(1 / 60);
  const e = fx.impactMesh.instanceMatrix.array;
  assert.ok(Math.hypot(e[8], e[9], e[10] + 1) < 1e-6, 'the instance carries the surface normal');
  fx.impact(0, 1, 2, 0, 0, -1, 'metal', { decal: true });
  fx.impact(0, 1, 2, 0, 0, -1, 'glass', { decal: true });
  assert.equal(fx.impactMarks.length, 3, 'static metal and glass take a mark when asked');
  fx.update(40);
  assert.equal(fx.impactMarks.length, 3);
  assert.ok(fx.decalA.array[3] > 0 && fx.decalA.array[3] < 0.96, 'a mark fades over its last seconds');
  fx.update(6);
  fx.update(1 / 60);
  assert.equal(fx.impactMarks.length, 0);
  assert.equal(fx.impactMesh.count, 0);
});

test('a close-range tracer remains visible for a frame without extending beyond the hit', () => {
  const fx = makeFx();
  fx.tracer({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 2 });
  fx.update(1 / 30);
  assert.equal(fx.glow.list.length, 1);
  const tracer = fx.glow.list[0];
  assert.ok(tracer.z > 0 && tracer.z <= 2);
  assert.ok(tracer.length <= 2.1);
  fx.update(1 / 30);
  assert.equal(fx.glow.list.length, 0);
});

test('a long tracer is a short streak that leaves the muzzle, never trails behind it, and dies at the hit', () => {
  const fx = makeFx();
  fx.camera.position.set(3, 1.6, -2);
  fx.tracer({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 120 });
  let frames = 0, last = 0;
  for (; frames < 200 && fx.glow.list.length; frames++) {
    fx.update(1 / 60);
    const t = fx.glow.list[0];
    if (!t) break;
    const e = fx.glow.mesh.instanceMatrix.array;
    const tail = e[14] - e[10 - 8] * 0.5; // centre z minus half the streak (its x axis is the line of fire)
    assert.ok(tail >= -1e-4, 'the streak starts at the muzzle');
    assert.ok(t.z <= 120 + 1e-6 && t.z >= last, 'the head only advances, up to the hit');
    assert.ok(t.length > 0 && t.length < 9, 'a streak, not a beam');
    last = t.z;
  }
  assert.ok(frames > 8 && frames < 40, `a rifle bullet crosses 120 m in a handful of frames (${frames})`);
  assert.equal(fx.glow.list.length, 0);
});

test('every weapon gets its own flash, never twice the same shape in a row, gone in three frames', () => {
  const fx = makeFx();
  const pos = { x: 0, y: 1.4, z: 0 }, dir = { x: 0, y: 0, z: 1 };
  const flashOf = () => fx.glow.list.filter(p => p.fresh && p.code >= 3);
  const sizes = {};
  for (const kind of ['pistol', 'smg', 'rifle', 'shotgun']) {
    let previous = -1, total = 0;
    for (let i = 0; i < 40; i++) {
      fx.clear();
      fx.muzzleFlash(pos, dir, kind);
      const quads = flashOf();
      assert.ok(quads.length >= 4 && quads.length <= 6, `${kind}: ${quads.length} quads`);
      const planes = quads.filter(p => p.mode === 3), facing = quads.filter(p => p.mode === 0);
      assert.ok(planes.length >= 2 && facing.length >= 1, 'barrel-aligned planes and a camera-facing sprite');
      for (const p of planes.filter(p => Math.abs(p.az - 1) < 1e-6)) assert.ok(Math.abs(p.z - Math.abs(p.len) * 0.45) < 1e-6, 'the flame starts on the muzzle and runs forward');
      assert.notEqual(quads[0].code, previous, 'two shots in a row never share their main shape');
      previous = quads[0].code;
      total += Math.abs(quads[0].size);
      assert.ok(fx.smoke.list.length >= 2, 'a shot leaves smoke');
    }
    sizes[kind] = total / 40;
    fx.clear();
    fx.muzzleFlash(pos, dir, kind);
    fx.update(0.2); // a long frame: the flash is still drawn once
    assert.ok(flashOf().length === 0 && fx.glow.list.some(p => p.code >= 3), 'the flash survives its first frame');
    assert.ok(finite(fx.glow.mesh.instanceMatrix.array, fx.glow.mesh.count, 16));
    fx.update(1 / 60); fx.update(1 / 60); fx.update(1 / 60);
    assert.ok(!fx.glow.list.some(p => p.code >= 3 && p.max < 0.05), 'and is gone three frames later');
  }
  assert.ok(sizes.shotgun > sizes.pistol * 1.4 && sizes.rifle > sizes.pistol * 1.4 && sizes.pistol >= sizes.smg * 0.9, JSON.stringify(sizes));
  // legacy callers: true is a shotgun, false a pistol; a suppressed shot has no flash and no light but still smokes
  const average = (kind) => { let sum = 0; for (let i = 0; i < 30; i++) { fx.clear(); fx.muzzleFlash(pos, dir, kind); sum += Math.abs(flashOf()[0].size); } return sum / 30; };
  assert.ok(Math.abs(average(true) / sizes.shotgun - 1) < 0.2 && Math.abs(average(false) / sizes.pistol - 1) < 0.2);
  fx.clear();
  for (const l of fx.lights) l.life = 0;
  fx.muzzleFlash(pos, dir, 'rifle', { scale: 0 });
  assert.equal(flashOf().length, 0);
  assert.ok(fx.lights.every(l => l.life <= 0));
  assert.ok(fx.smoke.list.length >= 2);
});

test('barrel smoke builds with sustained fire, follows a tracked muzzle and stops', () => {
  const fx = makeFx();
  const pos = { x: 0, y: 1.4, z: 0 }, dir = { x: 0, y: 0, z: 1 };
  fx.muzzleFlash(pos, dir, 'smg', { id: 'hero' });
  fx.clear();
  for (let i = 0; i < 30; i++) fx.update(1 / 60);
  assert.equal(fx.smoke.list.length, 0, 'one shot does not make a barrel smoke');
  for (let i = 0; i < 20; i++) { fx.muzzleFlash(pos, dir, 'smg', { id: 'hero' }); for (let k = 0; k < 5; k++) fx.update(1 / 60); }
  const hot = fx.barrels.find(b => b.id === 'hero');
  assert.ok(hot.heat > 0.5 && hot.heat <= 1.5);
  while (fx.smoke.list.length) fx.smoke.free.push(fx.smoke.list.pop());
  fx.trackMuzzle('hero', { x: 5, y: 1.2, z: 5 }, dir);
  for (let i = 0; i < 30; i++) fx.update(1 / 60);
  const wisps = fx.smoke.list.length;
  assert.ok(wisps >= 3, 'a hot barrel keeps smoking after the burst');
  assert.ok(fx.smoke.list.every(p => Math.hypot(p.x - 5, p.z - 5) < 1.5), 'from where the muzzle now is');
  assert.ok(fx.smoke.list.every(p => p.alpha <= 0.35 && p.size < 0.5), 'thin: it must not blind a camera two metres behind');
  for (let i = 0; i < 600; i++) fx.update(1 / 60);
  assert.equal(fx.smoke.list.length, 0, 'and it clears');
  assert.ok(fx.barrels.every(b => b.heat === 0));
});

test('smoke takes the light of where it is made: sun, shade or night, asking for the sun sparingly', () => {
  const fx = makeFx();
  const pos = { x: 0, y: 1.4, z: 0 }, dir = { x: 0, y: 0, z: 1 };
  const grey = () => { fx.clear(); fx.muzzleFlash(pos, dir, 'pistol'); return fx.smoke.list.find(p => p.lit && p.code < 19).r; };
  fx.update(1 / 60);
  const unknown = grey();
  let asked = 0;
  fx.sunlit = () => { asked++; return 1; };
  const sun = grey();
  for (let i = 0; i < 20; i++) fx.muzzleFlash(pos, dir, 'pistol');
  for (let i = 0; i < 20; i++) fx.impact(0.1 * i, 1, 3, 0, 0, -1, 'concrete');
  assert.ok(asked <= 3, `the sun is not asked for at every shot (${asked})`);
  fx.sunlit = () => 0;
  for (let i = 0; i < 30; i++) fx.update(1 / 60);
  const shade = grey();
  assert.ok(sun > shade * 2.5 && unknown > shade && unknown < sun * 0.6, 'without a probe, mostly shade');
  fx.ambient = 0.3;
  for (let i = 0; i < 30; i++) fx.update(1 / 60);
  const night = grey();
  fx.sunlit = () => 1;
  for (let i = 0; i < 30; i++) fx.update(1 / 60);
  assert.ok(Math.abs(grey() - night) < 1e-6 && night < sun * 0.4, 'at night the sun makes no difference');
});

test('casings leave the port sideways and up, bounce with a callback, and come to rest lying flat', () => {
  const fx = makeFx();
  const bounces = [];
  fx.onCasingBounce = (x, y, z, kind, speed) => bounces.push({ y, kind, speed });
  const c = fx.ejectCasing({ x: 0, y: 1.4, z: 0 }, { x: 0, y: 0, z: 1 }, 'shotgun', 0.1,
    { port: { x: 0.1, y: 1.35, z: -0.4 }, right: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, vx: 0, vy: 0, vz: 3 });
  assert.deepEqual([c.x, c.y, c.z], [0.1, 1.35, -0.4]);
  assert.ok(c.vx < -1 && c.vy > 0.8 && c.vz > 2, 'thrown to the right of the gun, upward, carrying the shooter');
  assert.ok(c.length > 0.06 && c.metal === 0, 'a shotgun hull: long, plastic');
  const brass = fx.ejectCasing({ x: 0, y: 1.4, z: 0 }, { x: 0, y: 0, z: 1 }, 'rifle', 0.1);
  assert.ok(brass.metal > 0.5 && brass.variant === 0 && brass.z < -0.3, 'rifle brass, bottlenecked, from behind the muzzle');
  for (let i = 0; i < 240; i++) fx.update(1 / 60, () => 0.1);
  assert.ok(c.settled && brass.settled);
  assert.ok(Math.abs(c.pitch - Math.PI / 2) < 1e-9, 'at rest it lies on its side');
  assert.ok(Math.abs(c.y - (0.1 + c.radius)) < 1e-9);
  assert.ok(bounces.length >= 3 && bounces.length <= 10);
  assert.ok(bounces.some(b => b.kind === 'shotgun') && bounces.every(b => b.speed > 0 && b.y < 0.2));
  for (let i = 0; i < 480; i++) fx.update(1 / 60, () => 0.1);
  assert.equal(fx.casings.length, 0, 'gone after a while');
});

test('each surface throws its own debris, fragments fall to the ground and stay inside the pools', () => {
  const fx = makeFx();
  const kinds = ['concrete', 'asphalt', 'metal', 'glass', 'flesh', 'water', 'dirt', 'wood', 'unknown'];
  const seen = {};
  for (const kind of kinds) {
    fx.clear();
    fx.update(1 / 60, () => 0);
    fx.impact(0, 1.2, 2, 0, 0, -1, kind, { dir: { x: 0.3, y: -0.1, z: 0.95 } });
    seen[kind] = { glow: fx.glow.list.length, smoke: fx.smoke.list.length, hard: fx.smoke.list.filter(p => p.hard).length, marks: fx.impactMarks.length };
    for (let i = 0; i < 90; i++) fx.update(1 / 60, () => 0);
    assert.ok(fx.smoke.list.every(p => p.y >= 0 && Number.isFinite(p.x + p.y + p.z)), `${kind}: nothing falls through the ground`);
    assert.ok(finite(fx.smoke.mesh.instanceMatrix.array, fx.smoke.mesh.count, 16) && finite(fx.smoke.a.array, fx.smoke.mesh.count, 4));
    for (let i = 0; i < 200; i++) fx.update(1 / 60, () => 0);
    assert.equal(fx.glow.list.length + fx.smoke.list.length, 0, `${kind}: everything ends`);
  }
  assert.ok(seen.metal.glow >= 8 && seen.metal.marks === 0, 'metal: a shower of sparks, no floating decal');
  assert.ok(seen.concrete.hard >= 3 && seen.concrete.marks === 1 && seen.concrete.smoke > seen.concrete.hard, 'concrete: dust, chips, a hole');
  assert.ok(seen.glass.hard >= 6 && seen.glass.glow >= 3, 'glass: fragments that glint');
  assert.ok(seen.flesh.hard >= 3 && seen.flesh.marks === 0, 'flesh: drops, the mark comes when they land');
  assert.ok(seen.water.smoke >= 5 && seen.water.marks === 0);
  assert.ok(seen.dirt.marks === 1 && seen.wood.marks === 1 && seen.asphalt.marks === 1 && seen.unknown.marks === 1);
  // a shotgun's pellets landing on the same frame share the budget
  fx.clear();
  fx.update(1 / 60);
  for (let i = 0; i < 9; i++) fx.impact(i * 0.1, 1.2, 2, 0, 0, -1, 'concrete');
  assert.ok(fx.smoke.list.length < 9 * 7, `nine pellets: ${fx.smoke.list.length} particles`);
  // flooding the pools recycles the oldest particles and never grows them
  for (let i = 0; i < 400; i++) fx.impact(0, 1.2, 2, 0, 0, -1, i % 2 ? 'metal' : 'concrete');
  fx.update(1 / 60);
  assert.ok(fx.smoke.list.length <= 1100 && fx.glow.list.length <= 900);
  assert.ok(fx.smoke.mesh.count <= 1100 && fx.glow.mesh.count <= 900);
});

test('blood: drops stain the ground where they land, a body leaves a pool that spreads then fades', () => {
  const fx = makeFx();
  fx.update(1 / 60, () => 0.2);
  fx.impact(0, 1.3, 0, 0, 0, -1, 'flesh', { dir: { x: 0, y: 0, z: 1 } });
  for (let i = 0; i < 120; i++) fx.update(1 / 60, () => 0.2);
  assert.ok(fx.impactMarks.length >= 1 && fx.impactMarks.length <= 2);
  assert.ok(fx.impactMarks.every(m => m.ny === 1 && Math.abs(m.y - 0.208) < 1e-6 && m.r > m.g * 10), 'red, flat on the ground');
  fx.clear();
  const pool = fx.bloodStain(4, null, 5, 0.6);
  assert.ok(Math.abs(pool.y - 0.208) < 1e-6, 'the ground is asked when no height is given');
  const start = pool.size;
  fx.update(1 / 60, () => 0.2);
  for (let i = 0; i < 240; i++) fx.update(1 / 60, () => 0.2);
  assert.ok(pool.size > start * 2 && pool.size <= pool.full && pool.full < 0.75, 'it spreads to its size and stops');
  assert.ok(Math.abs(Math.hypot(fx.impactMesh.instanceMatrix.array[0], fx.impactMesh.instanceMatrix.array[1], fx.impactMesh.instanceMatrix.array[2]) - pool.size) < 1e-5);
  const wall = fx.bloodSplatter(0, 1, 2, 0, 0, -1, 0.5);
  assert.ok(wall.nz === -1 && fx.impactMarks.length === 2);
  fx.update(70);
  assert.equal(fx.impactMarks.length, 0);
});

test('the effects atlas is deterministic, every tile is painted and none bleeds over its border', () => {
  const { buildFxAtlas, GLOW, SMOKE, DECAL } = FxTextures;
  const a = buildFxAtlas(128), b = buildFxAtlas(128);
  assert.equal(a.size, 128);
  assert.equal(a.data.length, 128 * 128 * 4);
  assert.deepEqual(a.data, b.data);
  for (const set of [GLOW, SMOKE, DECAL]) assert.deepEqual(Object.values(set).sort((x, y) => x - y), [...Array(16).keys()]);
  const tile = 32;
  for (let t = 0; t < 16; t++) {
    const tx = (t % 4) * tile, ty = Math.floor(t / 4) * tile;
    const peak = [0, 0, 0, 0];
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) {
      const o = ((ty + y) * 128 + tx + x) * 4;
      const border = x === 0 || y === 0 || x === tile - 1 || y === tile - 1;
      for (const c of [0, 1, 3]) {
        if (border) assert.equal(a.data[o + c], 0, `tile ${t} channel ${c} reaches its border`);
        peak[c] = Math.max(peak[c], a.data[o + c]);
      }
    }
    assert.ok(peak[0] > 120 && peak[1] > 120 && peak[3] > 120, `tile ${t} is painted in every atlas: ${peak}`);
  }
});

function node() {
  const classes = new Set(), props = new Map();
  return {
    children: [], dataset: {}, textContent: '',
    get offsetWidth() { throw new Error('combat feedback must not force layout'); },
    style: { setProperty: (k, v) => props.set(k, v), getPropertyValue: k => props.get(k) },
    classList: { add: k => classes.add(k), remove: k => classes.delete(k), contains: k => classes.has(k),
      toggle(k, on) { if (on) classes.add(k); else classes.delete(k); } },
    append(child) { this.children.push(child); child.parentElement = this; },
    replaceChildren() { this.children.length = 0; }
  };
}

test('combat HUD communicates empty magazines, reload progress, shoulder and headshots without layout reads', () => {
  const document = { body: node(), createElement: node };
  const { GameHud } = loadModule(source('hud'), { globals: { document } });
  const hud = new GameHud();
  hud.setCombat({ visible: true, aiming: true, mag: 4, capacity: 30, reserve: 90, mode: 'AUTOMATIQUE', shoulder: -1 });
  assert.equal(hud.combatMag.textContent, '04');
  assert.ok(hud.combat.classList.contains('low'));
  assert.equal(hud.combatStatus.textContent, 'ÉPAULE GAUCHE');
  hud.setCombat({ visible: true, aiming: true, mag: 0, capacity: 30, reserve: 90, reload: 0.4 });
  assert.equal(hud.combatStatus.textContent, 'RECHARGEMENT');
  assert.equal(hud.combatReload.style.transform, 'scaleX(0.4)');
  assert.ok(hud.reloadSight.classList.contains('show'));
  hud.setCombat({ visible: false });
  assert.ok(!hud.reloadSight.classList.contains('show'));
  hud.setCombat({ visible: true, mag: 0, reserve: 0 });
  assert.equal(hud.combatStatus.textContent, 'À SEC');
  hud.setCrosshair(true, 0.01, { aiming: true, blocked: true });
  assert.ok(hud.crosshair.classList.contains('blocked'));
  const before = Number.parseFloat(hud.crosshair.style.getPropertyValue('--spread'));
  hud.shot(); hud.update(0.016);
  assert.ok(Number.parseFloat(hud.crosshair.style.getPropertyValue('--spread')) > before);
  hud.hit(true, true);
  assert.equal(hud.hitCaption.textContent, 'PLEINE TÊTE');
  assert.ok(hud.hitmarker.classList.contains('headshot'));
  hud.hit(false, false);
  assert.equal(hud.hitCaption.textContent, '');
  hud.update(1);
  assert.equal(hud.hitmarker.style.opacity, '0');
});

test('the complete combat sound bank is finite, bounded, faded and covers every declared sound', () => {
  const ctx = { sampleRate: 24000, createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / sampleRate, numberOfChannels: channels, getChannelData: i => data[i] };
  } };
  const bank = createCombatResources(ctx);
  for (const [name, sounds] of Object.entries(bank)) {
    assert.ok(COMBAT_SOUNDS[name], name);
    for (const buffer of sounds) for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      let peak = 0;
      for (const sample of data) { assert.ok(Number.isFinite(sample), name); peak = Math.max(peak, Math.abs(sample)); }
      assert.ok(peak > 0.05 && peak < 1, `${name} has headroom: ${peak}`);
      assert.equal(Math.abs(data.at(-1)), 0, `${name} fades to zero`);
    }
  }
  for (const name of Object.keys(COMBAT_SOUNDS)) assert.ok(bank[name]?.length, name);
  assert.ok(bank.shotgun[0].duration > bank.smg[0].duration);
  assert.notDeepEqual(bank.pistol[0].getChannelData(0), bank.pistol[1].getChannelData(0));
});
