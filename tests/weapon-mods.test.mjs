import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, HANDLING, gunSpread, gunDamage } from '../js/weapons.js';
import { MODS, MOD_ORDER, FINISHES, fits, finishById, modsFor, fitted, effectiveWeapon, effectiveHandling, weaponBars, withMod, sanitizeMods } from '../js/weapon-mods.js';

const GUNS = ['pistol', 'smg', 'shotgun', 'rifle'];
const all = (id) => Object.fromEntries(modsFor(id).map((m) => [m.id, 1]));

test('the catalogue sells each upgrade to the weapons it fits, at the agreed prices and under their French names', () => {
  const prices = {
    mag: { pistol: 450, smg: 700, shotgun: 800, rifle: 950 },
    suppressor: { pistol: 1200, smg: 1600, rifle: 2400 },
    grip: { smg: 900, shotgun: 1000, rifle: 1200 },
    sight: { pistol: 800, smg: 1100, rifle: 2600 },
    choke: { shotgun: 900 }
  };
  assert.deepEqual(Object.keys(MODS), MOD_ORDER);
  for (const [mod, table] of Object.entries(prices)) {
    assert.deepEqual(MODS[mod].price, table, mod);
    assert.equal(MODS[mod].id, mod);
    assert.ok(MODS[mod].slot);
    for (const id of GUNS) {
      assert.equal(fits(id, mod), id in table, `${mod} on ${id}`);
      if (id in table) { assert.ok(MODS[mod].names[id], `${mod} ${id} name`); assert.ok(MODS[mod].sub[id], `${mod} ${id} sub`); }
    }
  }
  assert.deepEqual(modsFor('pistol').map((m) => m.id), ['mag', 'suppressor', 'sight']);
  assert.deepEqual(modsFor('smg').map((m) => m.id), ['mag', 'suppressor', 'grip', 'sight']);
  assert.deepEqual(modsFor('shotgun').map((m) => m.id), ['mag', 'grip', 'choke']);
  assert.deepEqual(modsFor('rifle').map((m) => m.id), ['mag', 'suppressor', 'grip', 'sight']);
  for (const id of ['fists', 'grenade', 'grapple', 'nothing']) assert.deepEqual(modsFor(id), []);
  assert.deepEqual(modsFor('shotgun')[0], { id: 'mag', slot: 'magazine', name: 'TUBE RALLONGÉ', sub: '8 cartouches au lieu de 6', price: 800 });
  assert.equal(modsFor('rifle').find((m) => m.id === 'sight').name, 'LUNETTE ×3');
  assert.equal(modsFor('smg').find((m) => m.id === 'sight').name, 'POINT ROUGE');
  assert.equal(modsFor('pistol').find((m) => m.id === 'suppressor').name, 'SILENCIEUX');
  // two things cannot hang off the same place of one weapon
  for (const id of GUNS) assert.equal(new Set(modsFor(id).map((m) => m.slot)).size, modsFor(id).length, id);
});

test('finishes: the stock one is free, the others are priced, and paint is told from plating', () => {
  assert.deepEqual(FINISHES.map((f) => [f.id, f.name, f.price]), [
    ['stock', 'D’ORIGINE', 0], ['noir', 'NOIR MAT', 300], ['sable', 'SABLE', 400], ['olive', 'OLIVE', 400],
    ['nickel', 'NICKEL', 900], ['cuivre', 'CUIVRE', 1500], ['or', 'OR', 5000]]);
  for (const f of FINISHES) {
    assert.equal(f.color.length, 3);
    assert.ok(f.color.every((c) => c >= 0 && c <= 1), f.id);
    if (f.kind === 'plating') assert.ok(f.metal === 1 && f.rough < 0.35, `${f.id} is polished metal`);
    if (f.kind === 'paint') assert.ok(f.metal < 0.2 && f.rough > 0.6, `${f.id} is matte paint`);
  }
  assert.equal(finishById('or').price, 5000);
  assert.equal(finishById('unknown').id, 'stock');
  assert.equal(finishById(undefined).id, 'stock');
});

test('a weapon with nothing fitted fires exactly as the stock tables say', () => {
  for (const id of Object.keys(WEAPONS)) {
    for (const state of [undefined, {}, { mag: 0, suppressor: 0, finish: 'or', finishes: ['or'] }, { choke: 1, bogus: 1 }]) {
      if (state?.choke && id === 'shotgun') continue;
      const w = effectiveWeapon(id, state);
      for (const [key, value] of Object.entries(WEAPONS[id])) assert.deepEqual(w[key], value, `${id}.${key}`);
      assert.equal(w.handling, HANDLING[id] ?? null);
      assert.equal(effectiveHandling(id, state), HANDLING[id] ?? null);
      assert.equal(w.suppressed, false);
      assert.equal(w.flash, 1);
      assert.equal(w.aimFov, id === 'rifle' ? 40 : id === 'shotgun' ? 46 : 44);
      assert.deepEqual({ ...w.noise }, { panic: 45, flee: 40, police: 90, birds: 45, alert: 70, witnesses: true });
      assert.deepEqual(w.fitted, []);
    }
  }
  assert.equal(effectiveWeapon('nothing').id, 'fists');
  // the stock tables themselves are untouched by all of this
  effectiveWeapon('rifle', all('rifle'));
  assert.equal(WEAPONS.rifle.mag, 30);
  assert.equal(HANDLING.rifle.aimed, 0.0022);
});

test('each upgrade changes what it says, and nothing else', () => {
  const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} vs ${b}`);
  // the magazine
  assert.deepEqual(GUNS.map((id) => effectiveWeapon(id, { mag: 1 }).mag), [18, 45, 8, 45]);
  assert.equal(effectiveWeapon('pistol', { mag: 0 }).mag, 12, 'stowed counts for nothing');
  assert.deepEqual(effectiveWeapon('pistol', { mag: 1 }).handling, HANDLING.pistol);
  // the suppressor
  for (const id of ['pistol', 'smg', 'rifle']) {
    const w = effectiveWeapon(id, { suppressor: 1 }), s = WEAPONS[id], h = HANDLING[id];
    assert.equal(w.suppressed, true);
    assert.equal(w.sound, `${s.sound}Suppressed`);
    assert.ok(w.flash < 0.25);
    assert.deepEqual({ ...w.noise }, { panic: 10, flee: 8, police: 25, birds: 12, alert: 25, witnesses: false });
    near(w.damage, s.damage * 0.92, `${id} damage`);
    near(w.range, s.range * 0.85, `${id} range`);
    near(w.handling.falloff, h.falloff * 0.85, `${id} falloff`);
    assert.equal(w.mag, s.mag);
    assert.equal(w.recoil, s.recoil);
    assert.equal(w.handling.aimed, h.aimed);
    assert.ok(gunDamage(w, 10) < gunDamage(s, 10));
  }
  assert.equal(effectiveWeapon('shotgun', { suppressor: 1 }).suppressed, false, 'no suppressor on the shotgun');
  // the foregrip
  for (const id of ['smg', 'shotgun', 'rifle']) {
    const w = effectiveWeapon(id, { grip: 1 }), s = WEAPONS[id], h = HANDLING[id];
    near(w.recoil, s.recoil * 0.65, `${id} recoil`);
    near(w.handling.bloom, h.bloom * 0.7, `${id} bloom`);
    near(w.handling.hip, h.hip * 0.85, `${id} hip`);
    assert.equal(w.handling.aimed, h.aimed);
    assert.equal(w.damage, s.damage);
    assert.ok(gunSpread(w, false) < gunSpread(s, false));
    assert.equal(gunSpread(w, true), gunSpread(s, true));
  }
  assert.equal(effectiveWeapon('pistol', { grip: 1 }).recoil, WEAPONS.pistol.recoil);
  // the sight
  for (const id of ['pistol', 'smg', 'rifle']) {
    const w = effectiveWeapon(id, { sight: 1 }), h = HANDLING[id];
    near(w.handling.aimed, h.aimed * 0.6, `${id} aimed`);
    near(w.handling.recovery, h.recovery * 1.25, `${id} recovery`);
    assert.equal(w.handling.hip, h.hip);
    assert.equal(w.aimFov, id === 'rifle' ? 27 : 41);
    assert.ok(gunSpread(w, true) < gunSpread(WEAPONS[id], true));
    assert.ok(w.spread < WEAPONS[id].spread, 'and from a car window');
  }
  // the choke
  const choked = effectiveWeapon('shotgun', { choke: 1 }), s = WEAPONS.shotgun, h = HANDLING.shotgun;
  near(choked.handling.aimed, h.aimed * 0.7, 'choke aimed');
  near(choked.handling.hip, h.hip * 0.7, 'choke hip');
  near(choked.handling.falloff, h.falloff * 1.25, 'choke falloff');
  near(choked.range, s.range * 1.25, 'choke range');
  assert.equal(choked.pellets, s.pellets);
  assert.ok(gunDamage(choked, 30) > gunDamage(s, 30), 'a tighter pattern carries further');
  // everything at once
  const rifle = effectiveWeapon('rifle', all('rifle'));
  assert.deepEqual(rifle.fitted, ['mag', 'suppressor', 'grip', 'sight']);
  assert.equal(rifle.mag, 45);
  assert.equal(rifle.aimFov, 27);
  near(rifle.recoil, WEAPONS.rifle.recoil * 0.65, 'full rifle recoil');
  near(rifle.handling.aimed, HANDLING.rifle.aimed * 0.6, 'full rifle aimed');
  assert.equal(rifle.id, 'rifle');
  assert.equal(rifle.auto, true);
});

test('effective specs are cached per weapon and set of fitted upgrades, and cannot be altered', () => {
  const a = effectiveWeapon('smg', { mag: 1, sight: 1 });
  assert.equal(effectiveWeapon('smg', { sight: 1, mag: 1, suppressor: 0, finish: 'or' }), a, 'same set, same object');
  assert.equal(effectiveWeapon('smg', withMod(withMod(undefined, 'sight'), 'mag')), a);
  assert.notEqual(effectiveWeapon('smg', { mag: 1 }), a);
  assert.equal(effectiveWeapon('smg'), effectiveWeapon('smg', {}));
  assert.equal(effectiveWeapon('smg', { choke: 1 }), effectiveWeapon('smg'), 'what does not fit is ignored');
  assert.notEqual(effectiveWeapon('smg'), effectiveWeapon('rifle'));
  assert.equal(effectiveHandling('smg', { sight: 1, mag: 1 }), a.handling);
  assert.throws(() => { 'use strict'; a.mag = 99; });
  assert.throws(() => { 'use strict'; a.handling.aimed = 0; });
  assert.throws(() => { 'use strict'; a.noise.panic = 0; });
});

test('fitted() lists what is on the weapon, in catalogue order', () => {
  assert.deepEqual(fitted(undefined), []);
  assert.deepEqual(fitted({}), []);
  assert.deepEqual(fitted({ sight: 1, mag: 1, suppressor: 0, finish: 'or', finishes: ['or'], bogus: 1 }), ['mag', 'sight']);
  assert.deepEqual(fitted({ mag: true, grip: 2 }), [], 'only a saved 1 is a fitted upgrade');
});

test('withMod() never mutates and only stows what is owned', () => {
  const state = Object.freeze({ mag: 1, finish: 'or', finishes: Object.freeze(['or']) });
  const more = withMod(state, 'suppressor');
  assert.deepEqual(more, { mag: 1, suppressor: 1, finish: 'or', finishes: ['or'] });
  assert.notEqual(more, state);
  assert.deepEqual(withMod(state, 'mag', false), { mag: 0, finish: 'or', finishes: ['or'] });
  assert.deepEqual(withMod(state, 'sight', false), { ...state }, 'nothing to take off');
  assert.deepEqual(withMod(undefined, 'mag'), { mag: 1 });
  assert.deepEqual(withMod(undefined, 'mag', false), {});
  assert.deepEqual(withMod({ mag: 0 }, 'mag'), { mag: 1 });
  assert.deepEqual(withMod(state, 'bogus'), { ...state });
  assert.deepEqual(state, { mag: 1, finish: 'or', finishes: ['or'] });
});

test('bars share one scale between weapons and move the way each upgrade promises', () => {
  const keys = ['damage', 'rate', 'accuracy', 'range', 'control', 'capacity'];
  for (const id of GUNS) {
    const stock = weaponBars(id);
    assert.deepEqual(Object.keys(stock), keys);
    for (const k of keys) assert.ok(stock[k] > 0 && stock[k] <= 1, `${id} ${k} ${stock[k]}`);
    const full = weaponBars(id, all(id));
    for (const k of keys) assert.ok(full[k] > 0 && full[k] <= 1, `${id} full ${k} ${full[k]}`);
    for (const { id: mod } of modsFor(id)) {
      const b = weaponBars(id, { [mod]: 1 });
      const up = (k) => assert.ok(b[k] > stock[k] + 0.01, `${id} ${mod} raises ${k}: ${stock[k]} → ${b[k]}`);
      const down = (k) => assert.ok(b[k] < stock[k] - 0.005, `${id} ${mod} lowers ${k}`);
      const same = (...list) => { for (const k of list) assert.equal(b[k], stock[k], `${id} ${mod} leaves ${k}`); };
      if (mod === 'mag') { up('capacity'); same('damage', 'rate', 'accuracy', 'range', 'control'); }
      if (mod === 'suppressor') { down('damage'); down('range'); same('rate', 'accuracy', 'control', 'capacity'); }
      if (mod === 'grip') { up('control'); assert.ok(b.accuracy > stock.accuracy); same('damage', 'rate', 'range', 'capacity'); }
      if (mod === 'sight') { up('accuracy'); assert.ok(b.control > stock.control); same('damage', 'rate', 'range', 'capacity'); }
      if (mod === 'choke') { up('accuracy'); up('range'); same('damage', 'rate', 'control', 'capacity'); }
    }
  }
  // across weapons: what anyone would say of these four
  const [pistol, smg, shotgun, rifle] = GUNS.map((id) => weaponBars(id));
  assert.ok(shotgun.damage > pistol.damage && pistol.damage > rifle.damage && rifle.damage > smg.damage);
  assert.ok(smg.rate > rifle.rate && rifle.rate > pistol.rate && pistol.rate > shotgun.rate);
  assert.ok(rifle.range > pistol.range && pistol.range > smg.range && smg.range > shotgun.range);
  assert.ok(shotgun.accuracy < smg.accuracy && smg.accuracy < rifle.accuracy);
  assert.ok(shotgun.control < pistol.control && pistol.control < rifle.control);
  assert.ok(weaponBars('rifle', { mag: 1 }).capacity === 1 && pistol.capacity < smg.capacity);
  for (const id of ['fists', 'grenade', 'grapple']) assert.deepEqual(weaponBars(id), { damage: 0, rate: 0, accuracy: 0, range: 0, control: 0, capacity: 0 });
});

test('a saved table is read back without what the game does not know', () => {
  assert.deepEqual(sanitizeMods(undefined), {});
  assert.deepEqual(sanitizeMods('x'), {});
  assert.deepEqual(sanitizeMods({
    pistol: { mag: 1, suppressor: 0, grip: 1, choke: 1, sight: 2, finish: 'or', finishes: ['or', 'noir', 'or', 'chrome', 'stock'] },
    smg: { finish: 'nickel' },
    shotgun: { choke: 1, suppressor: 1, finishes: ['sable'], finish: 'stock' },
    rifle: 'broken', grenade: { mag: 1 }, fists: { mag: 1 }, tank: { mag: 1 }
  }), {
    pistol: { mag: 1, suppressor: 0, finish: 'or', finishes: ['or', 'noir'] },
    shotgun: { choke: 1, finishes: ['sable'] }
  });
  const clean = { rifle: { mag: 1, suppressor: 0, grip: 1, sight: 1, finishes: ['or'], finish: 'or' } };
  assert.deepEqual(sanitizeMods(JSON.parse(JSON.stringify(clean))), clean, 'a round trip through the save keeps everything');
});
