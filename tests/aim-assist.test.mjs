import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AimAssist, pickTarget } from '../js/aim-assist.js';
import { loadModule } from './helpers/module.cjs';

const eye = { x: 0, y: 1.6, z: 0 };
const man = (x, z, ref = {}) => ({ ref, x, y: 1.35, z, dead: false });
const offAxis = (yaw, pitch, c) => {
  const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z, d = Math.hypot(dx, dy, dz);
  return Math.acos((dx * Math.sin(yaw) * Math.cos(pitch) - dy * Math.sin(pitch) + dz * Math.cos(yaw) * Math.cos(pitch)) / d);
};

test('raising the sights picks the man nearest the view axis, in sight and in range', () => {
  const near = man(2, 20), far = man(-1, 40), behind = man(0, -15), wide = man(18, 20);
  assert.equal(pickTarget(eye, 0, 0, [wide, behind, far, near]), far, 'closest to the centre of the view wins');
  assert.equal(pickTarget(eye, 0, 0, [wide, behind]), null, 'nobody outside the cone');
  assert.equal(pickTarget(eye, 0, 0, [far, near], { clear: (c) => c !== far }), near, 'a wall in between passes him over');
  assert.equal(pickTarget(eye, 0, 0, [man(0, 90)]), null, 'out of range');
  assert.equal(pickTarget(eye, 0, 0, [man(2.6, 3)]), null, 'beyond even the widened close-range cone');
  assert.ok(pickTarget(eye, 0, 0, [man(1.1, 3)]), 'a man a step aside at arm’s length is still taken');
});

test('the lock brings the view onto the chest within a quarter second at 30, 60 and 144 Hz, then lets go', () => {
  for (const hz of [30, 60, 144]) {
    const assist = new AimAssist(), target = man(3, 18), list = [target];
    let yaw = 0, pitch = 0;
    assert.equal(assist.update(1 / hz, false, eye, yaw, pitch, list, () => true), null, 'nothing happens with the sights down');
    for (let i = 0; i < Math.round(hz * 0.25); i++) {
      const to = assist.update(1 / hz, true, eye, yaw, pitch, list, () => true);
      assert.ok(to?.locked, `${hz} Hz frame ${i}`);
      yaw = to.yaw; pitch = to.pitch;
    }
    assert.ok(offAxis(yaw, pitch, target) < 0.012, `${hz} Hz: on target (${offAxis(yaw, pitch, target).toFixed(4)} rad)`);
    let released = false;
    for (let i = 0; i < hz * 1.5; i++) {
      const to = assist.update(1 / hz, true, eye, yaw, pitch, list, () => true);
      if (!to) { released = true; break; }
      yaw = to.yaw; pitch = to.pitch;
    }
    assert.ok(released, `${hz} Hz: the hold ends on its own`);
    assert.equal(assist.update(1 / hz, true, eye, yaw, pitch, list, () => true), null, 'and does not come back while the sights stay up');
  }
});

test('the lock follows a moving man, yields to a deliberate hand, and never fights it', () => {
  const assist = new AimAssist(), ref = {};
  let yaw = 0, pitch = 0, x = 2;
  for (let i = 0; i < 12; i++) {
    x += 4 / 60; // he runs across at 4 m/s
    const to = assist.update(1 / 60, true, eye, yaw, pitch, [man(x, 15, ref)], () => true);
    yaw = to.yaw; pitch = to.pitch;
  }
  assert.ok(offAxis(yaw, pitch, man(x, 15)) < 0.03, 'a fresh candidate object every frame is the same man');
  for (let i = 0; i < 8; i++) assist.update(1 / 60, true, eye, yaw, pitch, [man(x, 15, ref)], () => true);
  // the player sweeps away: the lock breaks on that very frame and stays broken
  yaw -= 0.06;
  assert.equal(assist.update(1 / 60, true, eye, yaw, pitch, [man(x, 15, ref)], () => true), null);
  assert.equal(assist.update(1 / 60, true, eye, yaw, pitch, [man(x, 15, ref)], () => true), null);
});

test('lowering and raising the sights again goes to a man, a dead one is dropped, and switched off it does nothing', () => {
  const assist = new AimAssist(), a = man(2, 16), b = man(-3, 20);
  let yaw = 0.1, pitch = 0;
  let to = assist.update(1 / 60, true, eye, yaw, pitch, [a, b], () => true);
  assert.equal(assist.target.ref, a.ref);
  a.dead = true;
  assert.equal(assist.update(1 / 60, true, eye, to.yaw, to.pitch, [a, b], () => true), null, 'the dead are let go at once');
  assist.update(1 / 60, false, eye, yaw, pitch, [b], () => true);
  to = assist.update(1 / 60, true, eye, -0.1, pitch, [b], () => true);
  assert.equal(assist.target.ref, b.ref, 'the next press takes the next man');
  assist.update(1 / 60, false, eye, yaw, pitch, [b], () => true);
  assist.enabled = false;
  assert.equal(assist.update(1 / 60, true, eye, 0, 0, [b], () => true), null);
});

// the harness evaluates classic scripts: the module's own address is given to it as a plain string
const { wedgeAt, takesTab } = loadModule(readFileSync(new URL('../js/arsenal.js', import.meta.url), 'utf8').replaceAll('import.meta.url', '"file:///js/arsenal.js"'), {
  imports: { './weapons.js': { WEAPONS: {}, WEAPON_ORDER: [] }, './shops.js': { GUN_ITEMS: [] }, './city-config.js': { isTypingInField: () => false } }, filename: 'arsenal.js'
});

test('a held TAB is the wheel’s, repeats included: the browser never gets to walk the focus through the page', () => {
  const tab = (extra = {}) => ({ code: 'Tab', repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...extra });
  const play = { open: false, held: -1, active: true, typing: false };
  assert.equal(takesTab(tab(), play), true, 'the first press, in play');
  assert.equal(takesTab(tab({ repeat: true }), { ...play, held: 0.05 }), true, 'the keyboard repeating while the key is held');
  assert.equal(takesTab(tab({ repeat: true }), { ...play, open: true }), true, 'and while the wheel is open');
  assert.equal(takesTab(tab({ repeat: true, shiftKey: true }), { ...play, open: true }), true, 'Shift (jump, sprint) held with it changes nothing');
  // a wheel left open over a game that stopped being active still owns the key until it closes
  assert.equal(takesTab(tab({ repeat: true }), { open: true, held: -1, active: false, typing: false }), true);
  // the browser keeps TAB in the menus, in a text field, and for system chords
  assert.equal(takesTab(tab(), { ...play, active: false }), false, 'paused or in the menu: focus navigation works');
  assert.equal(takesTab(tab(), { ...play, typing: true }), false);
  for (const chord of ['ctrlKey', 'metaKey', 'altKey']) assert.equal(takesTab(tab({ [chord]: true }), play), false, chord);
  assert.equal(takesTab({ code: 'KeyQ' }, play), false);
});

test('the wheel reads a direction as the wedge it points at, the first wedge straight up', () => {
  assert.equal(wedgeAt(0, -1, 7), 0);
  assert.equal(wedgeAt(0.2, -1, 7), 0);
  assert.equal(wedgeAt(1, -0.75, 7), 1);
  assert.equal(wedgeAt(1, 0.3, 7), 2);
  assert.equal(wedgeAt(0.4, 1, 7), 3);
  assert.equal(wedgeAt(-0.4, 1, 7), 4);
  assert.equal(wedgeAt(-1, 0.3, 7), 5);
  assert.equal(wedgeAt(-1, -0.75, 7), 6);
  // every direction lands on a wedge, and neighbours meet half-way
  for (let a = 0; a < 360; a++) {
    const i = wedgeAt(Math.sin(a * Math.PI / 180), -Math.cos(a * Math.PI / 180), 7);
    assert.ok(Number.isInteger(i) && i >= 0 && i < 7);
    assert.equal(i, Math.round(a / (360 / 7)) % 7);
  }
});
