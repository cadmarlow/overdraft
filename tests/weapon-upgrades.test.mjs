import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WEAPONS, HANDLING, gunSpread, gunDamage, sightOrigin, muzzleObstruction, castShot, lineOfSight, spreadDirection, raycastBuildings, stockArsenal } from '../js/weapons.js';
import { MOD_GUNS, effectiveWeapon, withMod, fits, finishById, sanitizeMods } from '../js/weapon-mods.js';
import { createCombatResources, COMBAT_SOUNDS } from '../js/audio-combat.js';
import { Vector3 } from '../vendor/three/build/three.core.js';
import { AimAssist } from '../js/aim-assist.js';

// The upgrades as the game applies them: the real Game methods, taken from the source and run on small collaborators
// (see combat-handling.test.mjs and calibre-commerce.test.mjs).
const source = readFileSync(new URL('../js/gameplay.js', import.meta.url), 'utf8');
const MODS_API = { MOD_GUNS, effectiveWeapon, withMod, fits, finishById, sanitizeMods };
const method = (name, globals = {}) => {
  const match = source.match(new RegExp(`  ${name}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n  \\}`));
  assert.ok(match, name);
  const all = { WEAPONS, HANDLING, ...MODS_API, ...globals };
  return new Function(...Object.keys(all), `return function(${match[1]}) {${match[2]}\n}`)(...Object.values(all));
};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function owner(weapons = stockArsenal({})) {
  const calls = { dressed: [], keybar: 0, saves: 0 };
  const g = { weapons, mods: {}, weaponId: 'pistol',
    hero: { setMods(mods) { calls.dressed.push(JSON.parse(JSON.stringify(mods))); } },
    updateKeybar() { calls.keybar++; }, save() { calls.saves++; } };
  for (const name of ['modState', 'buyMod', 'toggleMod', 'finishOf', 'ownsFinish', 'setFinish', 'refitWeapon']) g[name] = method(name);
  return { g, calls };
}

test('the game reads the weapon in hand through what is fitted on it, and a new game owns no upgrade', () => {
  assert.match(source, /get weapon\(\) \{ return effectiveWeapon\(this\.weaponId, this\.mods\[this\.weaponId\]\); \}/);
  assert.match(source, /this\.mods = \{\};/);
  assert.ok(source.indexOf('this.mods = {};') < source.indexOf('this.restore();'), 'the empty table precedes the save');
  const { g } = owner();
  for (const id of MOD_GUNS) for (const mod of ['mag', 'suppressor', 'grip', 'sight', 'choke']) assert.equal(g.modState(id, mod), 'none');
  for (const id of MOD_GUNS) { assert.equal(g.finishOf(id), 'stock'); assert.equal(g.ownsFinish(id, 'stock'), true); assert.equal(g.ownsFinish(id, 'or'), false); }
});

test('an upgrade bought is fitted at once, then comes off and goes back on for free; nothing here saves', () => {
  const { g, calls } = owner();
  assert.deepEqual(g.weapons.pistol, { mag: 12, ammo: 120 });
  assert.equal(g.buyMod('pistol', 'mag'), true);
  assert.equal(g.modState('pistol', 'mag'), 'fitted');
  assert.deepEqual(g.weapons.pistol, { mag: 18, ammo: 114 }, 'the longer magazine is filled from the reserve');
  assert.deepEqual(calls.dressed.at(-1), { pistol: { mag: 1 } }, 'the hero’s pistol is dressed at once');
  assert.equal(calls.keybar, 1);
  assert.equal(g.buyMod('pistol', 'mag'), false, 'already owned');
  assert.equal(g.buyMod('pistol', 'grip'), false, 'no foregrip on a pistol');
  assert.equal(g.buyMod('pistol', 'choke'), false);
  assert.equal(g.buyMod('shotgun', 'suppressor'), false);
  assert.equal(g.buyMod('fists', 'mag'), false);
  assert.equal(g.buyMod('grenade', 'mag'), false);
  assert.equal(g.buyMod('pistol', 'bogus'), false);
  assert.equal(calls.keybar, 1, 'a refused purchase changes nothing');
  assert.deepEqual(g.mods, { pistol: { mag: 1 } });

  assert.equal(g.toggleMod('pistol', 'mag'), true);
  assert.equal(g.modState('pistol', 'mag'), 'stowed');
  assert.deepEqual(g.weapons.pistol, { mag: 12, ammo: 120 }, 'the surplus returns to the reserve');
  assert.deepEqual(calls.dressed.at(-1), { pistol: { mag: 0 } });
  assert.equal(g.toggleMod('pistol', 'mag'), true);
  assert.equal(g.modState('pistol', 'mag'), 'fitted');
  assert.deepEqual(g.weapons.pistol, { mag: 18, ammo: 114 });
  assert.equal(g.toggleMod('pistol', 'suppressor'), false, 'not owned');
  assert.equal(g.modState('pistol', 'suppressor'), 'none');

  // a thin reserve fills what it can; an emptied magazine is not conjured full
  g.weapons.smg = { mag: 30, ammo: 4 };
  g.buyMod('smg', 'mag');
  assert.deepEqual(g.weapons.smg, { mag: 34, ammo: 0 });
  g.weapons.rifle = { mag: 7, ammo: 0 };
  g.buyMod('rifle', 'mag');
  assert.deepEqual(g.weapons.rifle, { mag: 7, ammo: 0 });
  g.weapons.shotgun = { mag: 6, ammo: 60 };
  g.buyMod('shotgun', 'mag');
  assert.deepEqual(g.weapons.shotgun, { mag: 8, ammo: 58 });
  // upgrades that hold no rounds leave the ammunition alone
  g.buyMod('rifle', 'suppressor'); g.buyMod('rifle', 'grip'); g.buyMod('rifle', 'sight');
  assert.deepEqual(g.weapons.rifle, { mag: 7, ammo: 0 });
  assert.deepEqual(g.mods.rifle, { mag: 1, suppressor: 1, grip: 1, sight: 1 });
  g.weapons.smg = { mag: 9, ammo: 100 };
  g.buyMod('smg', 'suppressor'); g.toggleMod('smg', 'suppressor'); g.toggleMod('smg', 'suppressor'); g.buyMod('smg', 'sight');
  assert.deepEqual(g.weapons.smg, { mag: 9, ammo: 100 }, 'only a magazine loads the weapon: no free reload at the counter');
  assert.equal(calls.saves, 0, 'the counter saves, not these');
});

test('a finish is owned once worn, and switching between owned finishes is free', () => {
  const { g, calls } = owner();
  assert.equal(g.setFinish('pistol', 'or'), true);
  assert.equal(g.finishOf('pistol'), 'or');
  assert.equal(g.ownsFinish('pistol', 'or'), true);
  assert.equal(g.ownsFinish('pistol', 'noir'), false);
  assert.equal(g.ownsFinish('smg', 'or'), false, 'bought per weapon');
  assert.deepEqual(calls.dressed.at(-1), { pistol: { finish: 'or', finishes: ['or'] } });
  assert.equal(g.setFinish('pistol', 'noir'), true);
  assert.equal(g.setFinish('pistol', 'or'), true);
  assert.deepEqual(g.mods.pistol.finishes, ['or', 'noir'], 'owned once each');
  assert.equal(g.setFinish('pistol', 'stock'), true);
  assert.equal(g.finishOf('pistol'), 'stock');
  assert.equal(g.ownsFinish('pistol', 'or'), true, 'back to stock keeps what was paid for');
  assert.equal(g.setFinish('pistol', 'chrome'), false);
  assert.equal(g.setFinish('grenade', 'or'), false);
  assert.equal(g.setFinish('fists', 'noir'), false);
  assert.equal(g.finishOf('pistol'), 'stock');
  // upgrades and finishes live side by side
  g.buyMod('pistol', 'sight');
  g.setFinish('pistol', 'nickel');
  assert.deepEqual(g.mods.pistol, { finishes: ['or', 'noir', 'nickel'], sight: 1, finish: 'nickel' });
  assert.deepEqual(g.weapons.pistol, { mag: 12, ammo: 120 }, 'a finish holds no rounds');
  assert.equal(calls.keybar, calls.dressed.length);
  assert.equal(calls.saves, 0);
});

test('supplies, reloads and a return to the street respect the capacity fitted, and the starter kit stays stock', () => {
  const stock = stockArsenal({});
  assert.deepEqual([stock.pistol.mag, stock.smg.mag, stock.shotgun.mag, stock.rifle.mag], [12, 30, 6, 30]);
  const { g } = owner();
  g.syncLoadout = () => {}; g.selectWeapon = () => {};
  g.giveWeapon = method('giveWeapon');
  g.buyMod('pistol', 'mag');
  g.weapons.pistol = { mag: 3, ammo: 0 };
  g.giveWeapon('pistol', 24);
  assert.deepEqual(g.weapons.pistol, { mag: 18, ammo: 9 }, 'bought rounds fill the extended magazine first');
  g.toggleMod('pistol', 'mag');
  g.weapons.pistol = { mag: 3, ammo: 0 };
  g.giveWeapon('pistol', 24);
  assert.deepEqual(g.weapons.pistol, { mag: 12, ammo: 15 });

  g.cancelWeaponActions = () => {};
  g.buyMod('shotgun', 'mag'); g.buyMod('rifle', 'mag');
  g.weapons.shotgun = { mag: 0, ammo: 0 }; g.weapons.rifle = { mag: 2, ammo: 100 }; g.weapons.smg = { mag: 0, ammo: 0 };
  method('rearm').call(g);
  assert.deepEqual(g.weapons.shotgun, { mag: 8, ammo: 0 }, 'shot dry: one full tube, extension included');
  assert.deepEqual(g.weapons.rifle, { mag: 45, ammo: 57 });
  assert.deepEqual(g.weapons.smg, { mag: 30, ammo: 0 });
});

function weaponHarness(id, mods = {}) {
  const _port = new Vector3(), _gunRight = new Vector3(), _gunUp = new Vector3();
  const globals = { gunSpread, gunDamage, sightOrigin, muzzleObstruction, castShot, spreadDirection, lineOfSight, raycastBuildings,
    _port, _gunRight, _gunUp, _barrel: new Vector3(), _wallHit: {},
    _flashOpts: { id: 'player', vx: 0, vy: 0, vz: 0 }, _casingOpts: { port: _port, right: _gunRight, up: _gunUp }, _hitOpts: { dir: { x: 0, y: 0, z: 0 } },
    _aim: new Vector3(), _muzzle: new Vector3(), _camDir: new Vector3(), _dir: new Vector3(), _v: new Vector3(),
    clamp, angleDelta: (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a)) };
  const seen = { flashes: [], sounds: [], panic: [], flee: [], police: [], crimes: [], birds: [], recoil: [], damage: [], combat: null, crosshair: null };
  const target = { x: 0, y: 0, z: 12 }; // someone down the line of fire, to read the damage off
  const g = {
    state: 'onFoot', weaponId: id, mods, get weapon() { return effectiveWeapon(this.weaponId, this.mods[this.weaponId]); },
    weapons: Object.fromEntries(Object.entries(WEAPONS).map(([k, w]) => [k, { mag: effectiveWeapon(k, mods[k]).mag || 0, ammo: w.mag * 10 || 0 }])),
    triggerBuffer: 0, bloom: 0, combatReadyT: 0, hipT: 0, strafeT: 0, threatT: 0, threatNear: false, autoReloadT: 0, shotsInBurst: 0, lastGunShot: -10,
    aimAssist: new AimAssist(), assistTargets: [], actors: { actors: [] }, arsenal: { open: false },
    cooldown: 0, reloadT: 0, punchT: 0, spread: 0, clock: 0, lastCrimeShot: -10,
    fireHeld: false, firePressed: false, aimHeld: false, aimToggle: false,
    person: { rig: { yaw: 0 }, position: new Vector3(), speed: 0, heading: 0 },
    player: { x: 0, y: 0, z: 0 }, controllers: { keys: {} }, stats: { shots: 0 },
    world: { controllers: { nearColliders: () => [], getGroundHeight: () => 0 }, traffic: { peds: [], vehicles: [] }, actors: [target] },
    camera: { footYaw: 0, orbitPitchOffset: 0, shoulderSide: 1, addRecoil(kick) { seen.recoil.push(kick); }, camera: { position: new Vector3(0, 1.4, -2),
      getWorldDirection(out) { return out.set(0, 0, 1); } } },
    hero: { armed: true, setWeapon() {}, setLoadout() {}, setMods() {}, prepareShot() {}, muzzle(out) { return out.set(0, 1.4, 0.8); }, fired() {},
      barrel(out) { return out.set(0, 0, 1); }, ejection() { return null; } },
    hud: { setCrosshair(...args) { seen.crosshair = args; }, setCombat(v) { seen.combat = v; }, setWeapon() {}, hit() {}, shot() {} },
    audio: { sfx(name) { seen.sounds.push(name); }, ui() {} },
    fx: { tracer() {}, muzzleFlash(p, d, kind, opts) { seen.flashes.push({ kind, scale: opts.scale }); }, trackMuzzle() {}, ejectCasing() {} },
    birds: { scatter(x, z, radius) { seen.birds.push(radius); } },
    bystanders: 3, officerAt: Infinity,
    traffic: { pedestrians: { holdUp() {}, panic(x, z, radius) { seen.panic.push(radius); return radius >= 20 ? g.bystanders : 0; } }, flee(x, z, radius) { seen.flee.push(radius); } },
    vertical: { owns() { return false; } }, wanted: { level: 0 },
    policeNear(radius) { seen.police.push(radius); return this.officerAt < radius; },
    crime(kind) { seen.crimes.push(kind); },
    applyShot(hit, damage) { seen.damage.push(damage); return { hit: false }; },
    updateGrenades() {}, updateKeybar() {}
  };
  for (const name of ['isAiming', 'aimPoint', 'fire', 'reload', 'selectWeapon', 'updateWeapons', 'cancelWeaponActions', 'assistAim', 'heldKind', 'ejectBrass',
    'modState', 'buyMod', 'toggleMod', 'refitWeapon']) g[name] = method(name, globals);
  const step = (dt = 1 / 60) => { g.clock += dt; g.updateWeapons(dt); };
  const shoot = () => { g.firePressed = g.fireHeld = true; step(); g.fireHeld = false; for (let i = 0; i < 90; i++) step(); };
  return { g, seen, step, shoot };
}

test('a suppressed shot is heard a few metres away: no panic down the street, no call to the police, a spark for a flash', () => {
  for (const id of ['pistol', 'smg', 'rifle']) {
    const loud = weaponHarness(id);
    loud.shoot();
    assert.equal(loud.seen.sounds[0], WEAPONS[id].sound);
    assert.deepEqual([loud.seen.panic[0], loud.seen.flee[0], loud.seen.birds[0]], [45, 40, 45], id);
    assert.equal(loud.seen.flashes[0].scale, 1);
    assert.deepEqual(loud.seen.crimes, ['shots'], 'a panicking street reports open gunfire');

    const quiet = weaponHarness(id, { [id]: { suppressor: 1 } });
    quiet.shoot();
    assert.equal(quiet.seen.sounds[0], `${WEAPONS[id].sound}Suppressed`);
    assert.deepEqual([quiet.seen.panic[0], quiet.seen.flee[0], quiet.seen.birds[0]], [10, 8, 12], id);
    assert.ok(quiet.seen.flashes[0].scale <= 0.2);
    assert.deepEqual(quiet.seen.police, [25], 'only an officer within 25 m hears it');
    assert.deepEqual(quiet.seen.crimes, [], 'nobody further heard anything');
    assert.ok(Math.abs(quiet.seen.damage[0] - WEAPONS[id].damage * 0.92) < 1e-9, 'and it hits a little softer');

    // even the few who run from the gun itself do not make it a reported shooting
    const close = weaponHarness(id, { [id]: { suppressor: 1 } });
    close.g.traffic.pedestrians.panic = (x, z, radius) => { close.seen.panic.push(radius); return 2; };
    close.shoot();
    assert.deepEqual(close.seen.crimes, []);
    // an officer close by, or a player already wanted, still does
    const patrol = weaponHarness(id, { [id]: { suppressor: 1 } });
    patrol.g.officerAt = 20;
    patrol.shoot();
    assert.deepEqual(patrol.seen.crimes, ['shots']);
    const far = weaponHarness(id, { [id]: { suppressor: 1 } });
    far.g.officerAt = 60;
    far.shoot();
    assert.deepEqual(far.seen.crimes, [], 'the officer sixty metres away hears an open shot, not this one');
    const wanted = weaponHarness(id, { [id]: { suppressor: 1 } });
    wanted.g.wanted.level = 2;
    wanted.shoot();
    assert.deepEqual(wanted.seen.crimes, ['shots']);
    // stowed, the weapon is as loud as ever
    quiet.g.toggleMod(id, 'suppressor');
    quiet.g.clock += 5;
    quiet.shoot();
    assert.equal(quiet.seen.sounds.filter((s) => !s.startsWith('reload')).at(-1), WEAPONS[id].sound);
    assert.equal(quiet.seen.panic.at(-1), 45);
    assert.deepEqual(quiet.seen.crimes, ['shots']);
  }
  // the open reports are untouched, the suppressed ones shorter, quieter and carrying a fifth as far
  const ctx = { sampleRate: 24000, createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, sampleRate, duration: length / sampleRate, getChannelData: (c) => data[c] };
  } };
  const sounds = createCombatResources(ctx);
  for (const id of ['pistol', 'smg', 'rifle']) {
    const energy = (name) => sounds[name][0].getChannelData(0).reduce((sum, v) => sum + v * v, 0) * COMBAT_SOUNDS[name].level ** 2;
    const open = WEAPONS[id].sound, quiet = `${open}Suppressed`;
    assert.equal(sounds[quiet].length, 3);
    assert.ok(sounds[quiet][0].duration < sounds[open][0].duration * 0.7, id);
    assert.ok(energy(quiet) < energy(open) * 0.15, `${id}: ${energy(quiet)} vs ${energy(open)}`);
    assert.ok(COMBAT_SOUNDS[quiet].range >= 55 && COMBAT_SOUNDS[quiet].range <= 85);
    assert.ok(COMBAT_SOUNDS[quiet].level < COMBAT_SOUNDS[open].level * 0.5);
  }
  assert.equal(sounds.shotgunSuppressed, undefined);
});

test('a foregrip tames the kick and the bloom, a sight tightens the aimed shot and narrows the lens', () => {
  for (const id of ['smg', 'shotgun', 'rifle']) {
    const stock = weaponHarness(id), gripped = weaponHarness(id, { [id]: { grip: 1 } });
    for (const h of [stock, gripped]) { h.g.firePressed = h.g.fireHeld = true; h.step(); h.g.fireHeld = false; }
    assert.ok(Math.abs(gripped.seen.recoil[0] / stock.seen.recoil[0] - 0.65) < 1e-9, `${id} recoil`);
    assert.ok(Math.abs(gripped.g.bloom / stock.g.bloom - 0.7) < 1e-9, `${id} bloom`);
  }
  for (const id of ['pistol', 'smg', 'rifle']) {
    const stock = weaponHarness(id), sighted = weaponHarness(id, { [id]: { sight: 1 } });
    for (const h of [stock, sighted]) { h.g.aimHeld = true; h.step(); }
    assert.equal(stock.g.camera.aimFov, id === 'rifle' ? 40 : 44);
    assert.equal(sighted.g.camera.aimFov, id === 'rifle' ? 27 : 41);
    assert.ok(Math.abs(sighted.seen.crosshair[1] / stock.seen.crosshair[1] - 0.6) < 1e-9, `${id}: the crosshair closes with the spread`);
    // bloom is shed a quarter faster
    stock.g.bloom = sighted.g.bloom = 0.01;
    stock.g.aimHeld = sighted.g.aimHeld = false;
    stock.step(0.1); sighted.step(0.1);
    assert.ok(Math.abs(Math.log(sighted.g.bloom / 0.01) / Math.log(stock.g.bloom / 0.01) - 1.25) < 1e-6, `${id} recovery`);
  }
  const choked = weaponHarness('shotgun', { shotgun: { choke: 1 } }), open = weaponHarness('shotgun');
  for (const h of [open, choked]) { h.g.aimHeld = true; h.step(); }
  assert.ok(Math.abs(choked.seen.crosshair[1] / open.seen.crosshair[1] - 0.7) < 1e-9);
  assert.equal(choked.g.camera.aimFov, 46);
});

test('an extended magazine is what the weapon reloads to and what the HUD counts', () => {
  const h = weaponHarness('rifle', { rifle: { mag: 1 } }), slot = h.g.weapons.rifle;
  assert.equal(slot.mag, 45);
  h.step();
  assert.equal(h.seen.combat.capacity, 45);
  slot.mag = 5; slot.ammo = 200;
  h.g.reload();
  for (let i = 0; i < 200; i++) h.step();
  assert.deepEqual(slot, { mag: 45, ammo: 160 });
  h.g.reload();
  assert.equal(h.g.reloadT, 0, 'full at 45: nothing to reload');
  // taken off with a full magazine: fifteen rounds go back to the reserve, and thirty is full again
  h.g.toggleMod('rifle', 'mag');
  assert.deepEqual(slot, { mag: 30, ammo: 175 });
  h.step();
  assert.equal(h.seen.combat.capacity, 30);
  h.g.reload();
  assert.equal(h.g.reloadT, 0);
  // automatic fire empties exactly what the magazine holds
  const smg = weaponHarness('smg', { smg: { mag: 1 } });
  smg.g.weapons.smg.ammo = 0;
  smg.g.fireHeld = smg.g.firePressed = true;
  for (let i = 0; i < 600; i++) smg.step();
  assert.equal(smg.seen.flashes.length, 45);
});

test('upgrades and finishes survive a save and a reload of the page, without what an older build cannot know', () => {
  let stored = null;
  const position = new Vector3(4, 0.22, 9);
  const playing = { mods: { pistol: { mag: 1, suppressor: 0, finish: 'or', finishes: ['or', 'noir'] }, rifle: { sight: 1, grip: 1 } },
    weapons: { fists: { mag: 0, ammo: 0 }, pistol: { mag: 18, ammo: 40 }, rifle: { mag: 30, ammo: 90 } }, weaponId: 'pistol',
    state: 'onFoot', fleet: [], person: { position, heading: 1 }, vertical: { owns: () => false }, controllers: { getGroundHeight: () => 0.22 },
    stolen: 0, distance: 0, firstEntry: false, money: 900, debt: 1000, gangs: { held: new Set() }, health: 100, armor: 0, missionsDone: [], stats: {},
    atmosphere: { serialize: () => ({}) } };
  const io = { localStorage: { setItem(key, text) { stored = text; }, getItem: () => stored }, SAVE_KEY: 'test', LEGACY_SAVE_KEYS: [], FLEET_MAX: 12,
    validPosition: (p) => [p.x, p.y, p.z].every(Number.isFinite), carSpecs: {}, clamp };
  assert.equal(method('save', io).call(playing), true);
  assert.deepEqual(JSON.parse(stored).mods, playing.mods);

  const fresh = () => ({ person: { position: new Vector3() }, camera: {}, controllers: { entities: {} }, fleet: [{}], gangs: {},
    weapons: stockArsenal({}), mods: {}, stats: {}, atmosphere: { restore() {} } });
  const g = fresh();
  method('restore', io).call(g);
  assert.deepEqual(g.mods, playing.mods);
  assert.deepEqual(g.weapons.pistol, { mag: 18, ammo: 40 }, 'the eighteen rounds in the extended magazine are kept');
  assert.equal(effectiveWeapon('pistol', g.mods.pistol).mag, 18);
  assert.equal(effectiveWeapon('pistol', g.mods.pistol).suppressed, false, 'stowed stays stowed');
  assert.equal(effectiveWeapon('rifle', g.mods.rifle).aimFov, 27);

  // a save tampered with, or from a build that knew other upgrades: the unknown is dropped and magazines are clamped
  const data = JSON.parse(stored);
  data.mods = { pistol: { mag: 0, laser: 1, finish: 'chrome', finishes: ['chrome', 'sable'] }, smg: { choke: 1 }, tank: { mag: 1 } };
  data.weapons.pistol.mag = 18;
  stored = JSON.stringify(data);
  const h = fresh();
  method('restore', io).call(h);
  assert.deepEqual(h.mods, { pistol: { mag: 0, finishes: ['sable'] } });
  assert.deepEqual(h.weapons.pistol, { mag: 12, ammo: 40 });
  // a save from before the upgrades existed
  delete data.mods;
  stored = JSON.stringify(data);
  const old = fresh();
  old.mods = { pistol: { mag: 1 } };
  method('restore', io).call(old);
  assert.deepEqual(old.mods, {});
  assert.deepEqual(old.weapons.pistol, { mag: 12, ammo: 40 });
});
