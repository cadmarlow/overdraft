import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WEAPONS, HANDLING, gunSpread, gunDamage, sightOrigin, muzzleObstruction, castShot, lineOfSight, spreadDirection, raycastBuildings } from '../js/weapons.js';
import { effectiveWeapon } from '../js/weapon-mods.js';
import { Vector3 } from '../vendor/three/build/three.core.js';
import { AimAssist } from '../js/aim-assist.js';

const world = (colliders = [], actors = []) => ({
  controllers: { nearColliders: () => colliders, getGroundHeight: () => 0 },
  traffic: { peds: [], vehicles: [] }, actors
});

test('paced aimed shots are precise and automatic bursts bloom then recover at any frame rate', () => {
  for (const id of Object.keys(HANDLING)) {
    const w = WEAPONS[id], h = HANDLING[id];
    const first = gunSpread(w, true);
    assert.ok(gunSpread(w, false) > first);
    assert.ok(gunSpread(w, true, 2.6) > first);
    assert.equal(gunSpread(w, true, -2.6), gunSpread(w, true, 2.6));
    const recovered = [];
    for (const hz of [30, 60, 144]) {
      let bloom = h.maxBloom;
      for (let i = 0; i < hz; i++) bloom *= Math.exp(-h.recovery / hz);
      recovered.push(gunSpread(w, true, 0, bloom));
    }
    assert.ok(Math.abs(recovered[0] - recovered[2]) < 1e-10);
    assert.ok(recovered[0] < first + 0.0002, id);
  }
  assert.ok(gunSpread(WEAPONS.rifle, true) * 30 < 0.1, 'first rifle shot stays inside a head at 30 m');
});

test('shotgun loses distant damage while rifle keeps its useful range', () => {
  for (const id of Object.keys(HANDLING)) {
    const w = WEAPONS[id];
    assert.equal(gunDamage(w, 0), w.damage);
    assert.ok(gunDamage(w, w.range) > 0);
    assert.ok(gunDamage(w, w.range) < w.damage);
    assert.equal(gunDamage(w, w.range * 2), gunDamage(w, w.range));
  }
  assert.equal(gunDamage(WEAPONS.rifle, 60), WEAPONS.rifle.damage);
  assert.ok(gunDamage(WEAPONS.shotgun, 60) < WEAPONS.shotgun.damage / 3);
});

test('shoulder sight ignores targets behind player but keeps point-blank targets', () => {
  const player = { x: 0, y: 0, z: 0 };
  const camera = { x: -0.7, y: 1.4, z: -1.95 }, dir = { x: 0, y: 0, z: 1 };
  const origin = sightOrigin(camera, dir, player, {});
  const behind = { x: -0.7, y: 0, z: -0.8 }, near = { x: -0.7, y: 0, z: 0.65 };
  const hit = castShot(world([], [behind, near]), origin.x, origin.y, origin.z, 0, 0, 1, 200, player);
  assert.equal(hit.target, near);
  assert.ok(hit.t < 0.5);
  camera.z = -0.15;
  assert.equal(sightOrigin(camera, dir, player, {}).z, 0);
});

test('a protruding barrel cannot start a shot behind cover, but high barrels clear low cover', () => {
  const wall = { minX: -2, maxX: 2, minZ: 0.35, maxZ: 0.42, maxY: 2 };
  const player = { x: 0, y: 0, z: 0 }, muzzle = { x: -0.18, y: 1.48, z: 0.8 };
  const h = muzzleObstruction(world([wall]), player, muzzle);
  assert.equal(h.kind, 'building');
  assert.ok(Math.abs(h.z - 0.35) < 1e-6);
  assert.equal(muzzleObstruction(world([{ ...wall, maxY: 0.8 }]), player, muzzle), null);
  assert.equal(muzzleObstruction(world(), player, muzzle), null);
});

test('a barrel cannot skip a thin rotated shopfront between ray samples', () => {
  const cx = 0.53, cs = Math.cos(1), sn = Math.sin(1), hx = 2, hz = 0.095;
  const ex = cs * hx + sn * hz, ez = sn * hx + cs * hz;
  const front = { minX: cx - ex, maxX: cx + ex, minZ: -ez, maxZ: ez, maxY: 2,
    obb: { cx, cz: 0, cs, sn, hx, hz } };
  const w = world([front]);
  const z = -0.166;
  const hit = muzzleObstruction(w, { x: 0, y: 0, z }, { x: 0.9, y: 1.35, z });
  assert.equal(hit?.target, front);
  assert.ok(Math.abs(hit.x - (cx + (-hz - z * cs) / sn)) < 1e-9);
  assert.equal(hit.nx, -sn);
  assert.equal(hit.nz, -cs);
  const roof = castShot(w, cx, 3, 0, 0, -1, 0, 4);
  assert.equal(roof.target, front);
  assert.equal(roof.y, 2);
  assert.equal(roof.ny, 1);
});

test('parked cars are damageable targets while blocking sight and shots behind them', () => {
  const collider = { minX: 4.06, maxX: 5.94, minZ: -2.2, maxZ: 2.2, maxY: 1.5, parked: 0,
    obb: { cx: 5, cz: 0, cs: 1, sn: 0, hx: 0.94, hz: 2.2 } };
  const wall = { minX: 8, maxX: 9, minZ: -2, maxZ: 2, maxY: 2 };
  const w = world([collider, wall]);
  w.parking = {
    forEachAlong(...args) { args.at(-1)(0); },
    info() { return { x: 5, z: 0, yaw: 0, halfW: 0.9, halfL: 2.2 }; }
  };
  const hit = castShot(w, 0, 1.2, 0, 1, 0, 0, 10);
  assert.equal(hit.kind, 'parked');
  assert.equal(hit.target, 0);
  assert.equal(hit.t, 4.1);
  assert.equal(lineOfSight(w.controllers, 0, 1.2, 0, 7, 1.2, 0), false);
  assert.equal(castShot(w, 10, 1.2, 0, -1, 0, 0, 10).target, wall);
});

// Exercise the actual game methods with small collaborators; switching weapons must cancel deferred reloads.
const source = readFileSync(new URL('../js/gameplay.js', import.meta.url), 'utf8');
const method = (name, globals = {}) => {
  const match = source.match(new RegExp(`  ${name}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n  \\}`));
  assert.ok(match, name);
  return new Function('WEAPONS', 'HANDLING', ...Object.keys(globals), `return function(${match[1]}) {${match[2]}\n}`)(WEAPONS, HANDLING, ...Object.values(globals));
};

test('switching weapons cancels buffered shots and the old empty-magazine reload', () => {
  const g = { weapons: { pistol: { mag: 0, ammo: 12 }, rifle: { mag: 9, ammo: 15 } }, weaponId: 'pistol',
    reloadT: 0.5, autoReloadT: 0.18, triggerBuffer: 0.1, bloom: 0.02, aimToggle: true,
    player: { x: 0, y: 0, z: 0 }, audio: { sfx() {} }, updateKeybar() {}, heldKind: (id) => id };
  method('selectWeapon').call(g, 'rifle');
  assert.equal(g.reloadT, 0);
  assert.equal(g.autoReloadT, 0);
  assert.equal(g.triggerBuffer, 0);
  assert.equal(g.bloom, 0);
  assert.equal(g.weapons.rifle.mag, 9, 'no ammunition created on switch');
});

test('reload rejects full magazines, grenades and zero reserves', () => {
  const reload = method('reload');
  const g = { weapon: WEAPONS.pistol, weaponId: 'pistol', weapons: { pistol: { mag: 12, ammo: 12 } },
    reloadT: 0, player: { x: 0, y: 0, z: 0 }, audio: { sfx() {} } };
  reload.call(g); assert.equal(g.reloadT, 0);
  g.weapons.pistol.mag = 5; g.weapons.pistol.ammo = 0;
  reload.call(g); assert.equal(g.reloadT, 0);
  g.weapons.pistol.ammo = 12;
  reload.call(g); assert.equal(g.reloadT, WEAPONS.pistol.reload);
  assert.equal(g.weapons.pistol.mag, 5, 'ammunition transfers only when reload finishes');
  g.reloadT = 0; g.weapon = WEAPONS.grenade; g.weaponId = 'grenade'; g.weapons.grenade = { mag: 2, ammo: 10 };
  reload.call(g); assert.equal(g.reloadT, 0);
});

function weaponHarness(id = 'pistol', colliders = []) {
  const _port = new Vector3(), _gunRight = new Vector3(), _gunUp = new Vector3();
  const globals = { gunSpread, gunDamage, sightOrigin, muzzleObstruction, castShot, spreadDirection, lineOfSight, raycastBuildings,
    _port, _gunRight, _gunUp, _barrel: new Vector3(), _wallHit: {},
    _flashOpts: { id: 'player', vx: 0, vy: 0, vz: 0 }, _casingOpts: { port: _port, right: _gunRight, up: _gunUp }, _hitOpts: { dir: { x: 0, y: 0, z: 0 } },
    _aim: new Vector3(), _muzzle: new Vector3(), _camDir: new Vector3(), _dir: new Vector3(), _v: new Vector3(),
    clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)), angleDelta: (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a)) };
  const state = { shots: [], sounds: [], crosshair: null, combat: null, impacts: [], brass: [] };
  const g = {
    state: 'onFoot', weaponId: id, mods: {}, get weapon() { return effectiveWeapon(this.weaponId, this.mods[this.weaponId]); },
    weapons: Object.fromEntries(Object.entries(WEAPONS).map(([k, w]) => [k, { mag: w.mag || 0, ammo: w.mag * 10 || 0 }])),
    triggerBuffer: 0, bloom: 0, combatReadyT: 0, hipT: 0, strafeT: 0, threatT: 0, threatNear: false, autoReloadT: 0, shotsInBurst: 0, lastGunShot: -10,
    aimAssist: new AimAssist(), assistTargets: [], actors: { actors: [] }, arsenal: { open: false },
    cooldown: 0, reloadT: 0, punchT: 0, spread: 0, clock: 0, lastCrimeShot: 0,
    fireHeld: false, firePressed: false, aimHeld: false, aimToggle: false,
    person: { rig: { yaw: 0 }, position: new Vector3(), speed: 0, heading: 0 },
    player: { x: 0, y: 0, z: 0 }, controllers: { keys: {} }, stats: { shots: 0 }, world: world(colliders),
    camera: { footYaw: 0, orbitPitchOffset: 0, shoulderSide: 1, addRecoil() {}, camera: { position: new Vector3(-0.7, 1.4, -2),
      getWorldDirection(out) { return out.set(0, 0, 1); } } },
    hero: { armed: true, setWeapon(kind) { state.held = kind; }, setLoadout() {}, prepareShot() {}, muzzle(out) { return out.set(-0.18, 1.4, 0.8); }, fired() {},
      barrel(out) { return out.set(0, 0, 1); }, ejection(port, right, up) { port.set(-0.2, 1.42, 0.5); right.set(-1, 0, 0); up.set(0, 1, 0); return port; } },
    hud: { setCrosshair(...args) { state.crosshair = args; }, setCombat(v) { state.combat = v; }, setWeapon() {}, hit() {}, shot() {} },
    audio: { sfx(name) { state.sounds.push(name); }, ui() {} },
    fx: { tracer() {}, muzzleFlash(p) { state.shots.push({ x: p.x, y: p.y, z: p.z, clock: g.clock }); }, trackMuzzle() {},
      ejectCasing(pos, dir, kind, groundY, opts) { state.brass.push({ kind, clock: g.clock, port: opts?.port ? { x: opts.port.x, y: opts.port.y, z: opts.port.z } : null }); } },
    traffic: { pedestrians: { holdUp() {}, panic() { return 0; } }, flee() {} },
    vertical: { owns() { return false; } }, wanted: { level: 0 }, policeNear() { return false; },
    applyShot(hit) { state.impacts.push(hit); return { hit: false }; },
    updateGrenades() {}, updateKeybar() {}
  };
  for (const name of ['isAiming', 'aimPoint', 'fire', 'reload', 'selectWeapon', 'updateWeapons', 'cancelWeaponActions', 'assistAim', 'heldKind', 'ejectBrass']) g[name] = method(name, globals);
  return { g, state, step(dt) { g.clock += dt; g.updateWeapons(dt); } };
}

test('automatic cadence remains within one shot at 30, 60 and 144 Hz', () => {
  for (const id of ['smg', 'rifle']) {
    const counts = [30, 60, 144].map(hz => {
      const h = weaponHarness(id);
      h.g.fireHeld = h.g.firePressed = true;
      for (let i = 0; i < hz * 2; i++) h.step(1 / hz);
      assert.equal(h.g.weapons[id].mag, WEAPONS[id].mag - h.state.shots.length);
      return h.state.shots.length;
    });
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${id}: ${counts}`);
    assert.ok(Math.abs(counts[0] - 2 / WEAPONS[id].interval) <= 1);
  }
});

test('semi-auto holds fire once, accepts a buffered click and never repeats that click', () => {
  const h = weaponHarness();
  h.g.fireHeld = h.g.firePressed = true;
  h.step(1 / 60);
  for (let i = 0; i < 7; i++) h.step(1 / 60);
  assert.equal(h.state.shots.length, 1);
  h.g.firePressed = true;
  h.step(1 / 60);
  assert.ok(h.g.triggerBuffer > 0);
  for (let i = 0; i < 30; i++) h.step(1 / 60);
  assert.equal(h.state.shots.length, 2);
  assert.equal(h.g.triggerBuffer, 0);
});

test('reload conserves rounds, plays each phase once, and a switch cancels its transfer', () => {
  const h = weaponHarness();
  const slot = h.g.weapons.pistol;
  slot.mag = 2; slot.ammo = 6;
  h.g.reload();
  for (let i = 0; i < 120; i++) h.step(1 / 60);
  assert.equal(slot.mag, 8);
  assert.equal(slot.ammo, 0);
  assert.equal(h.state.sounds.filter(s => s === 'reloadInsert').length, 1);
  assert.equal(h.state.sounds.filter(s => s === 'reloadRack').length, 1);
  slot.mag = 3; slot.ammo = 20;
  h.g.reload(); h.step(0.3);
  h.g.selectWeapon('rifle');
  for (let i = 0; i < 120; i++) h.step(1 / 60);
  assert.equal(slot.mag, 3);
  assert.equal(slot.ammo, 20);
});

test('the delayed empty-magazine reload uses game time and cannot reload the next selected weapon', () => {
  const h = weaponHarness();
  h.g.weapons.pistol.mag = 1;
  h.g.firePressed = true; h.step(1 / 60);
  assert.ok(h.g.autoReloadT > 0);
  h.g.weapons.rifle.mag = 3;
  h.g.selectWeapon('rifle');
  for (let i = 0; i < 150; i++) h.step(1 / 60);
  assert.equal(h.g.weapons.rifle.mag, 3);
  assert.equal(h.g.reloadT, 0);
});

test('a shot from a barrel beyond a thin wall hits the wall and flashes on the visible side', () => {
  const wall = { minX: -2, maxX: 2, minZ: 0.35, maxZ: 0.42, maxY: 2 };
  const h = weaponHarness('rifle', [wall]);
  h.g.aimHeld = h.g.fireHeld = h.g.firePressed = true;
  h.step(1 / 60);
  assert.ok(h.state.crosshair[2].blocked);
  assert.equal(h.state.impacts[0].kind, 'building');
  assert.equal(h.state.impacts[0].target, wall);
  assert.ok(h.state.shots[0].z < wall.minZ);
  assert.equal(h.state.combat.aiming, true);
  h.g.aimHeld = h.g.fireHeld = false;
  h.step(1 / 60);
  assert.equal(h.state.combat.aiming, false);
  assert.equal(h.state.crosshair[0], true, 'hip fire keeps a readable sight');
});

test('death and arrest cancel pending reloads, firing and fixed aim without transferring rounds', () => {
  for (const transition of ['die', 'busted']) {
    const h = weaponHarness('smg'), g = h.g, slot = g.weapons.smg;
    const document = { body: { classList: { add() {} }, dataset: {} } };
    g.vertical.reset = () => {};
    g.hud.showBanner = () => {};
    g.director = { onPlayerDown() {} };
    g.person.rig.limp = true;
    g.stats.deaths = g.stats.busted = 0;
    slot.mag = 3; slot.ammo = 20;
    g.reload();
    g.autoReloadT = 0.12;
    g.fireHeld = g.firePressed = g.aimHeld = g.aimToggle = true;
    g.triggerBuffer = 0.1;
    method(transition, { document }).call(g, 'shot');
    assert.equal(g.reloadT, 0, transition);
    assert.equal(g.autoReloadT, 0, transition);
    assert.equal(g.triggerBuffer, 0, transition);
    assert.equal(g.fireHeld, false, transition);
    assert.equal(g.aimToggle, false, transition);
    for (let i = 0; i < 120; i++) h.step(1 / 60);
    assert.equal(slot.mag, 3, transition);
    assert.equal(slot.ammo, 20, transition);
    assert.equal(h.state.shots.length, 0, transition);
    assert.equal(h.state.combat.visible, false, transition);
  }
});

test('pause clears the trigger and fixed aim while preserving the in-progress reload for resume', () => {
  const h = weaponHarness(), g = h.g;
  const classes = { toggle() {} };
  g.controllers.resetInput = () => {};
  g.gamepad = g.touch = { setEnabled() {} };
  g.ui = { 'game-menu': { classList: classes } };
  g.camera.domElement = { focus() {} };
  g.save = g.releasePointer = g.updateMenuProgress = () => {};
  g.playing = true;
  g.weapons.pistol.mag = 2;
  g.reload(); h.step(0.25);
  const remaining = g.reloadT;
  g.fireHeld = g.firePressed = g.aimHeld = g.aimToggle = true;
  g.triggerBuffer = 0.1;
  const pause = method('setPaused', { document: { body: { classList: classes } } });
  pause.call(g, true);
  assert.equal(g.reloadT, remaining);
  assert.equal(g.triggerBuffer, 0);
  assert.equal(g.firePressed, false);
  assert.equal(g.aimToggle, false);
  pause.call(g, false);
  for (let i = 0; i < 90; i++) h.step(1 / 60);
  assert.equal(g.weapons.pistol.mag, 12);
  assert.equal(h.state.shots.length, 0);
});

test('a weapon still on its way out of the holster cannot fire; the press is kept and leaves when the hands have it', () => {
  const { g, state, step } = weaponHarness('pistol');
  g.hero.armed = false;
  g.firePressed = true;
  step(1 / 60);
  assert.equal(state.shots.length, 0, 'nothing leaves a holstered pistol');
  for (let i = 0; i < 18; i++) step(1 / 60);
  assert.equal(state.shots.length, 0);
  g.hero.armed = true;
  step(1 / 60);
  assert.equal(state.shots.length, 1, 'the kept press fires once the pistol is up');
  for (let i = 0; i < 40; i++) step(1 / 60);
  assert.equal(state.shots.length, 1, 'and only once');
  // a press older than half a second is forgotten rather than fired late
  const late = weaponHarness('pistol');
  late.g.hero.armed = false; late.g.firePressed = true;
  for (let i = 0; i < 45; i++) late.step(1 / 60);
  late.g.hero.armed = true;
  late.step(1 / 60);
  assert.equal(late.state.shots.length, 0);
});

test('both hands stay on the weapon while there is a fight and it hangs in one hand otherwise', () => {
  const { g, step } = weaponHarness('rifle');
  step(1 / 60);
  assert.equal(g.person.rig.gunReady, false, 'nothing going on: carried');
  assert.equal(g.camera.combatMode, false, 'and the camera stays behind the walker');
  g.firePressed = g.fireHeld = true;
  step(1 / 60);
  g.fireHeld = false;
  assert.ok(g.person.rig.aim, 'firing from the hip raises the weapon to the sight line');
  step(1 / 60);
  assert.equal(g.person.rig.gunReady, true);
  assert.equal(g.camera.combatMode, true);
  for (let i = 0; i < 60; i++) step(1 / 60);
  assert.equal(g.person.rig.aim, null, 'the arms come down from the sights a moment after the last shot');
  assert.equal(g.person.rig.gunReady, true, 'but both hands stay on it');
  for (let i = 0; i < 200; i++) step(1 / 60);
  assert.equal(g.person.rig.gunReady, false, 'until the street is quiet again');
  // a sprint drops it to one hand, a wanted level keeps it up
  g.wanted.level = 2; g.threatT = 0;
  step(1 / 60);
  assert.equal(g.person.rig.gunReady, true);
  g.controllers.keys.run = true; g.person.speed = 7;
  step(1 / 60);
  assert.equal(g.person.rig.gunReady, false);
});

test('the wheel holds fire and selecting a weapon hands the right object to the hero', () => {
  const { g, state, step } = weaponHarness('pistol');
  g.arsenal.open = true;
  g.firePressed = g.fireHeld = true;
  step(1 / 60);
  assert.equal(state.shots.length, 0);
  g.arsenal.open = false;
  g.selectWeapon('grapple');
  assert.equal(state.held, 'grapple', 'the grapple has its own launcher');
  g.selectWeapon('fists');
  assert.equal(state.held, null);
  g.selectWeapon('shotgun');
  assert.equal(state.held, 'shotgun');
  assert.ok(g.combatReadyT > 1, 'drawn into both hands');
});

test('brass leaves by the weapon’s own port: at once from a self-loader, when the fore-end comes back on a pump', () => {
  const rifle = weaponHarness('rifle');
  rifle.g.firePressed = rifle.g.fireHeld = true;
  rifle.step(1 / 60);
  rifle.g.fireHeld = false;
  assert.equal(rifle.state.brass.length, 1);
  assert.equal(rifle.state.brass[0].kind, 'rifle');
  assert.deepEqual(rifle.state.brass[0].port, { x: -0.2, y: 1.42, z: 0.5 }, 'thrown from the ejection port, not from behind the muzzle');
  const pump = weaponHarness('shotgun');
  pump.g.firePressed = true;
  pump.step(1 / 60);
  assert.equal(pump.state.shots.length, 1);
  assert.equal(pump.state.brass.length, 0, 'the hull stays in until the action is worked');
  for (let i = 0; i < 12; i++) pump.step(1 / 60);
  assert.equal(pump.state.brass.length, 0);
  for (let i = 0; i < 12; i++) pump.step(1 / 60);
  assert.equal(pump.state.brass.length, 1);
  assert.ok(Math.abs(pump.state.brass[0].clock - pump.state.shots[0].clock - 0.3) < 0.03, 'a third of a second after the shot');
  for (let i = 0; i < 60; i++) pump.step(1 / 60);
  assert.equal(pump.state.brass.length, 1, 'once');
});

test('a shot remembers the way it travelled, for the effects that follow it', () => {
  const wall = { minX: -2, maxX: 2, minZ: 5, maxZ: 6, maxY: 4 };
  const hit = castShot(world([wall]), 0, 1.4, 0, 0, 0, 1, 50);
  assert.equal(hit.kind, 'building');
  assert.deepEqual([hit.dx, hit.dy, hit.dz], [0, 0, 1]);
  assert.deepEqual([hit.nx, hit.ny, hit.nz], [0, 0, -1]);
});

test('raising empty hands to aim takes out the last firearm held, the pistol by default, and nothing else changes hands', () => {
  const { g, state } = weaponHarness('fists');
  g.drawForAim = method('drawForAim');
  g.arsenal.previous = null;
  assert.equal(g.drawForAim(), true);
  assert.equal(g.weaponId, 'pistol');
  assert.equal(state.held, 'pistol');
  assert.equal(g.drawForAim(), false, 'a weapon already in hand is left alone');
  g.selectWeapon('fists');
  g.arsenal.previous = 'rifle';
  g.drawForAim();
  assert.equal(g.weaponId, 'rifle', 'the one put away last comes back');
  g.selectWeapon('fists');
  g.arsenal.previous = 'grenade';
  g.drawForAim();
  assert.equal(g.weaponId, 'pistol', 'a grenade is not something to aim with');
  g.selectWeapon('fists');
  g.state = 'driving';
  assert.equal(g.drawForAim(), false);
  assert.equal(g.weaponId, 'fists');
});
