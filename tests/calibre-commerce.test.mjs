import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule } from './helpers/module.cjs';
import { WEAPONS, stockArsenal } from '../js/weapons.js';
import { MOD_GUNS, effectiveWeapon, sanitizeMods, withMod, fits, finishById } from '../js/weapon-mods.js';
import { CalibreCounter, COUNTER_TABS, counterLines, priced } from '../js/calibre-counter.js';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import * as TSL from '../vendor/three/build/three.tsl.js';

const source = name => readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8');
const gameSource = source('gameplay');
function method(name, globals = {}) {
  const match = gameSource.match(new RegExp(`  ${name}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n  \\}`));
  assert.ok(match, name);
  return new Function('WEAPONS', 'effectiveWeapon', 'sanitizeMods', 'MOD_GUNS', ...Object.keys(globals), `return function(${match[1]}) {${match[2]}\n}`)(WEAPONS, effectiveWeapon, sanitizeMods, MOD_GUNS, ...Object.values(globals));
}

// The counter (calibre-counter.js) on the game's own purchase methods, with no page behind it
function counter({ money = 20000, discount = 0, weapons = stockArsenal({ fists: { mag: 0, ammo: 0 } }) } = {}) {
  let saved = 0; const said = [];
  const api = { MOD_GUNS, withMod, fits, finishById };
  const own = (name) => { const m = gameSource.match(new RegExp(`  ${name}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n  \\}`)); assert.ok(m, name);
    return new Function('WEAPONS', 'effectiveWeapon', ...Object.keys(api), `return function(${m[1]}) {${m[2]}\n}`)(WEAPONS, effectiveWeapon, ...Object.values(api)); };
  const g = { money, armor: 0, weapons, weaponId: 'fists', mods: {}, stats: {},
    calibre: { available: () => true, discount: () => discount, say(kind) { said.push(kind); }, presented() {} },
    shops: { closed: 0, close() { this.closed++; } }, audio: { ui() {} }, toast() {}, updateKeybar() {}, syncLoadout() {},
    addMoney(amount) { this.money += amount; }, selectWeapon(id) { this.weaponId = id; }, save() { saved++; } };
  for (const name of ['giveWeapon', 'modState', 'buyMod', 'toggleMod', 'finishOf', 'ownsFinish', 'setFinish', 'refitWeapon']) g[name] = own(name);
  const c = Object.create(CalibreCounter.prototype);
  Object.assign(c, { game: g, shop: { site: {} }, tab: 0, sel: 0, rows: [], lines: [],
    refresh() { this.lines = counterLines(g, this.current, g.calibre.discount()); }, highlight() {} });
  c.refresh();
  const on = (tab, key) => { c.tab = COUNTER_TABS.findIndex(t => t.id === tab); c.refresh(); c.sel = c.lines.findIndex(l => l.key === key); assert.ok(c.sel >= 0, `${tab} ${key}`); return c.lines[c.sel]; };
  return { g, c, on, said, saves: () => saved };
}

test('the counter debits once per purchase, saves, and a held Enter buys nothing more', () => {
  const { g, c, on, saves } = counter();
  on('pistol', 'ammo'); c.act();
  assert.equal(g.money, 19880);
  assert.equal(g.weapons.pistol.ammo, 144);
  assert.equal(saves(), 1);
  let prevented = 0;
  for (let i = 0; i < 30; i++) c.key({ code: 'Enter', repeat: true, preventDefault() { prevented++; }, stopImmediatePropagation() {} });
  assert.equal(prevented, 30);
  assert.equal(g.money, 19880);
  assert.equal(saves(), 1);
  // a reserve that is full has nothing to top up
  const { g: full, c: c2, on: on2 } = counter();
  assert.equal(on2('pistol', 'fill').enabled, false); c2.act(); assert.equal(full.money, 20000);
});

test('upgrades are bought once, then come off and go back on for free; finishes are owned for good', () => {
  const { g, c, on } = counter();
  assert.equal(on('pistol', 'mod:mag').price, 450); c.act();
  assert.equal(g.money, 19550);
  assert.equal(g.modState('pistol', 'mag'), 'fitted');
  assert.equal(g.weapons.pistol.mag, 18, 'the longer magazine is filled from the reserve');
  assert.equal(on('pistol', 'mod:mag').price, 0); c.act();
  assert.equal(g.modState('pistol', 'mag'), 'stowed');
  assert.equal(g.weapons.pistol.mag, 12);
  c.act(); assert.equal(g.modState('pistol', 'mag'), 'fitted');
  assert.equal(g.money, 19550);
  assert.equal(c.lines.some(l => l.key === 'mod:grip'), false, 'a pistol takes no foregrip');
  on('rifle', 'finish:or'); c.act();
  assert.equal(g.money, 14550); assert.equal(g.finishOf('rifle'), 'or');
  on('rifle', 'finish:stock'); c.act(); assert.equal(g.finishOf('rifle'), 'stock');
  assert.equal(on('rifle', 'finish:or').price, 0); c.act();
  assert.equal(g.money, 14550); assert.equal(g.finishOf('rifle'), 'or');
  // the line highlighted shows on the counter what it would do, before a dollar is spent
  assert.equal(on('rifle', 'mod:sight').preview.sight, 1); assert.equal(g.modState('rifle', 'sight'), 'none');
});

test('grenades, armour, empty pockets and the range\'s medals', () => {
  const { g, c, on, said } = counter({ money: 500 });
  assert.equal(on('grenade', 'grenade:1').enabled, false, 'the belt is full');
  g.weapons.grenade.mag = 8;
  assert.equal(on('grenade', 'grenade:3').enabled, false); assert.equal(on('grenade', 'grenade:1').enabled, true); c.act();
  assert.equal(g.weapons.grenade.mag, 9); assert.equal(g.money, 180);
  on('armor', 'armor:heavy'); c.act();
  assert.equal(g.armor, 0); assert.equal(g.money, 180); assert.deepEqual(said.slice(-1), ['broke']);
  g.money = 1000; on('armor', 'armor:light'); c.act(); assert.equal(g.armor, 50); c.act(); assert.equal(g.armor, 100); assert.equal(g.money, 200);
  assert.equal(on('armor', 'armor:light').enabled, false);
  // 15 % off for a full board of medals, rounded to ten dollars
  assert.equal(priced(450, 0.15), 380); assert.equal(priced(0, 0.15), 0);
  const cheap = counter({ discount: 0.15 });
  assert.equal(cheap.on('pistol', 'mod:mag').price, 380);
  // a save from before the arsenal was free: the weapon itself is for sale
  const bare = counter({ weapons: { fists: { mag: 0, ammo: 0 } } });
  assert.equal(bare.on('rifle', 'weapon').price, 6500); bare.c.act();
  assert.deepEqual(bare.g.weapons.rifle, { mag: 30, ammo: 30 });
});

test('a service interrupted between selection and payment closes without charging', () => {
  const { g, c, on, saves } = counter();
  on('pistol', 'mod:mag');
  g.calibre.available = () => false;
  c.act();
  assert.equal(g.money, 20000);
  assert.equal(g.modState('pistol', 'mag'), 'none');
  assert.equal(g.shops.closed, 1);
  assert.equal(saves(), 0);
});

test('restoring a purchased inventory replaces the starter arsenal without free ammunition', () => {
  const purchased = { fists: { mag: 0, ammo: 0 }, pistol: { mag: 3, ammo: 21 }, grenade: { mag: 1, ammo: 0 } };
  const data = { version: 2, fleet: [], player: { x: 10, y: .24, z: 20, heading: 1 }, state: 'onFoot', active: -1,
    weapons: purchased, weaponId: 'pistol', money: 17380, armor: 43,
    range: { medals: { pistol: 2, rifle: 7, grenade: 3 }, best: { pistol: 312.4, smg: 'x' } } };
  const g = { person: { position: new THREE.Vector3() }, camera: {}, controllers: { entities: {} }, fleet: [{}],
    weapons: stockArsenal({}), stats: {}, range: { medals: {}, best: {} }, atmosphere: { restore() {} } };
  method('restore', { localStorage: { getItem: () => JSON.stringify(data) }, SAVE_KEY: 'test', LEGACY_SAVE_KEYS: [],
    FLEET_MAX: 10, validPosition: p => [p.x,p.y,p.z].every(Number.isFinite), carSpecs: {},
    clamp: (v,a,b) => Math.max(a,Math.min(b,v)) }).call(g);
  assert.deepEqual(g.weapons, purchased);
  assert.deepEqual(g.range, { medals: { pistol: 2 }, best: { pistol: 312 } }, 'the range\'s medals come back; impossible ones do not');
  assert.equal(g.weaponId, 'pistol');
  assert.equal(g.money, data.money);
  assert.equal(g.armor, data.armor);
  assert.ok(gameSource.indexOf('stockArsenal(this.weapons)') < gameSource.indexOf('this.restore()'), 'starter kit precedes restore');
});

test('a live counter advances game time, while a paused counter does not', () => {
  let resets = 0;
  const g = { active: false, camera: {}, controllers: { resetInput() { resets++; } }, shops: { open: { calibre: true } },
    slowMo: 0, arsenal: {}, wheelSlow: 0, timeScale: 1, clock: 10, invulnerable: 0, state: 'onFoot', health: 100,
    person: {}, updateTransition() {} };
  const update = method('beforeUpdate');
  update.call(g, .5); assert.equal(g.clock, 10.5);
  update.call(g, 0); assert.equal(g.clock, 10.5);
  g.shops.open = null;
  update.call(g, .5); assert.equal(g.clock, 10.5);
  assert.equal(resets, 3);
});

test('48 shop blips leave every mission marker available and reuse their own slots', () => {
  const { MarkerSystem } = loadModule(source('missions'), { imports: { 'three/webgpu': THREE, 'three/tsl': TSL,
    './city-config.js': { streetZ: n => n }, './navigation.js': { RoadNavigator: class {} } } });
  const markers = new MarkerSystem(new THREE.Scene());
  const shops = Array.from({ length: 48 }, (_, i) => markers.add(i, i, { mapOnly: true, kind: 'guns' }));
  assert.ok(shops.every(Boolean));
  const missions = Array.from({ length: 24 }, (_, i) => markers.add(i, i));
  assert.ok(missions.every(Boolean));
  assert.equal(markers.add(0,0), null);
  for (const m of shops) markers.remove(m);
  for (let i = 0; i < 48; i++) assert.ok(markers.add(i,i,{ mapOnly: true, kind: 'guns' }));
  assert.equal(markers.markers.length, 72);
  markers.update(() => 0);
  assert.ok(missions.every(m => m.used && m.group.visible));
});
