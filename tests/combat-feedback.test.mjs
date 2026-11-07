import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import * as TSL from '../vendor/three/build/three.tsl.js';
import { loadModule } from './helpers/module.cjs';
import { createCombatResources, COMBAT_SOUNDS } from '../js/audio-combat.js';

const source = name => readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8');
const { EffectsSystem } = loadModule(source('fx'), { imports: { 'three/webgpu': THREE, 'three/tsl': TSL } });

test('gunfire effects reuse bounded pools and clear both CPU and rendered casing/decal instances', () => {
  const fx = new EffectsSystem(new THREE.Scene(), new THREE.PerspectiveCamera());
  const material = fx.casingMesh.material, decalMaterial = fx.impactMesh.material;
  for (let i = 0; i < 180; i++) {
    fx.ejectCasing({ x: 0, y: 1.4, z: 0 }, { x: 0, y: 0, z: 1 }, 'rifle');
    fx.impact(0, 1.2, 2, 0, 0, -1, 'concrete');
  }
  assert.equal(fx.casings.length, 72);
  assert.equal(fx.impactMarks.length, 96);
  for (let i = 0; i < 150; i++) fx.update(1 / 60, () => 0.22);
  assert.equal(fx.casingMesh.count, 72);
  assert.equal(fx.impactMesh.count, 96);
  assert.ok(fx.casings.every(c => c.y >= 0.22 && Number.isFinite(c.x) && c.settled));
  assert.ok(fx.impactMesh.instanceMatrix.array.every(Number.isFinite));
  assert.equal(fx.casingMesh.material, material);
  assert.equal(fx.impactMesh.material, decalMaterial);
  fx.clear();
  assert.equal(fx.casingMesh.count, 0);
  assert.equal(fx.impactMesh.count, 0);
  assert.equal(fx.casings.length, 0);
  assert.equal(fx.impactMarks.length, 0);
});

test('bullet marks face the surface and do not remain floating on moving metal targets', () => {
  const fx = new EffectsSystem(new THREE.Scene(), new THREE.PerspectiveCamera());
  fx.impact(0, 1, 2, 0, 0, -1, 'metal');
  assert.equal(fx.impactMarks.length, 0);
  fx.impact(0, 1, 2, 0, 0, -1, 'concrete');
  const m = fx.impactMarks[0];
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(m.qx, m.qy, m.qz, m.qw));
  assert.ok(normal.distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-6);
  assert.ok(m.z < 2, 'mark sits just outside the surface');
  fx.update(27);
  assert.equal(fx.impactMarks.length, 0);
});

test('a close-range tracer remains visible for a frame without extending beyond the hit', () => {
  const fx = new EffectsSystem(new THREE.Scene(), new THREE.PerspectiveCamera());
  fx.tracer({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 2 });
  fx.update(1 / 30);
  assert.equal(fx.glow.list.length, 1);
  const tracer = fx.glow.list[0];
  assert.ok(tracer.z > 0 && tracer.z <= 2);
  assert.ok(tracer.length <= 2.1);
  fx.update(1 / 30);
  assert.equal(fx.glow.list.length, 0);
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
