import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import { loadModule } from './helpers/module.cjs';
import { CAR_CATALOG, GARAGE_KINDS } from '../js/car-catalog.js';
import { createBody, makeTune, settleBody } from '../js/car-physics.js';
import { doorPosition } from '../js/interaction-state.js';
import { polygonContact } from '../js/building-collision.js';

const source = name => readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../assets/cars/models.json', import.meta.url)));
const gameSource = source('gameplay');
const section = (start, end) => gameSource.slice(gameSource.indexOf(`  ${start}(`), gameSource.indexOf(`  ${end}(`));

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.listeners = {}; this.attrs = {}; this.style = {}; this.dataset = {};
    this.classes = new Set(); this.classList = { toggle: (k, on) => on ? this.classes.add(k) : this.classes.delete(k) };
    this.parts = new Map(); this.textContent = ''; this.hidden = false;
  }
  set innerHTML(value) {
    this.html = value; this.children = [];
    if (value.startsWith('<button')) {
      for (const match of value.matchAll(/<button[^>]*>(.*?)<\/button>/g)) {
        const child = new Element('button'); child.innerHTML = match[1]; this.children.push(child);
      }
    }
  }
  get innerHTML() { return this.html; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...children) { this.children.push(...children); }
  prepend(child) { this.children.unshift(child); }
  addEventListener(k, fn) { this.listeners[k] = fn; }
  querySelector(tag) { if (!this.parts.has(tag)) this.parts.set(tag, new Element(tag)); return this.parts.get(tag); }
  remove() { this.removed = true; }
  scrollIntoView() { this.scrolled = true; }
  focus() {}
}

function harness() {
  const document = { body: new Element('body'), createElement: tag => new Element(tag), pointerLockElement: null };
  const globals = { document, window: { addEventListener() {} }, getComputedStyle: () => ({ gridTemplateColumns: '80px 80px 80px 80px 80px 80px 80px' }) };
  const { QuickStrip } = loadModule(source('quick-strip'), { globals });
  let repairs = 0;
  const { Garage, CHOICES } = loadModule(source('garage'), { globals, imports: {
    './interaction-state.js': { doorPosition }, './quick-strip.js': { QuickStrip }, './car-physics.js': { settleBody },
    './boat.js': { WATER: 0 }, './drive-fx.js': { repairBody(c) { repairs++; for (const w of c.body?.wheels || []) w.burst = false; } },
    './car-catalog.js': { CAR_CATALOG, GARAGE_KINDS }
  } });
  let data = null, clearance = 0;
  const methods = vm.runInNewContext(`class VehicleMethods {
    ${section('park', 'spawnFleet')}
    ${section('save', 'restore')}
  }; VehicleMethods.prototype`, { localStorage: { setItem(_key, value) { data = JSON.parse(value); } }, SAVE_KEY: 'test' });
  const person = { position: new THREE.Vector3(10, 0, 20), heading: 0, speed: 0, inVehicle: false };
  const game = { active: true, state: 'onFoot', transition: null, rides: [], fleet: [], wrecks: [], person,
    gangs: { held: new Set(['midtown']) }, weapons: {}, stats: {}, missionsDone: [],
    vertical: { owns: () => false }, atmosphere: { serialize: () => ({ hour: 12 }) },
    controllers: { entities: { person, car: null }, resetInput() {}, getGroundHeight: () => 0 },
    camera: { footYaw: 0, domElement: new Element('canvas'), resetOrbit() {}, resetForTeleport() {} },
    safeSpot: (x, z, radius) => { assert.ok(Number.isFinite(radius) && radius > 0); clearance = radius; return { x, z }; }, releasePointer() {}, onMode() {}, announce() {}, updateKeybar() {},
    park: methods.park, removeFleetCar: methods.removeFleetCar, save: methods.save
  };
  Object.defineProperty(game, 'car', { get: () => game.controllers.entities.car });
  for (const entry of CAR_CATALOG) {
    const spec = manifest[entry.kind].spec;
    const tune = makeTune(entry.kind, { ...spec, halfL: Math.max(spec.zFront, -spec.zRear), wheelX: (spec.wheelX + spec.wheelXr) / 2 });
    game.rides.push({ kind: entry.kind, pooled: true, halfW: tune.halfW, halfL: tune.halfL, spec, tune, body: createBody(tune), paint: entry.paint,
      position: new THREE.Vector3(), mesh: new THREE.Group(), drive: { speed: tune.top }, heading: 0, speed: 0, hp: 100 });
  }
  const ordinary = { ...game.rides[0], pooled: false, position: new THREE.Vector3(15, 0, 20), mesh: new THREE.Group(), hp: 61 };
  game.fleet.push(ordinary); game.controllers.entities.car = ordinary;
  const garage = new Garage(game);
  return { garage, game, CHOICES, ordinary, document, saved: () => data, clearance: () => clearance, repaired: () => repairs };
}

test('garage preserves the first nine shortcuts while exposing every body and a valid current tile', () => {
  const { garage, game, CHOICES } = harness();
  assert.equal(CHOICES.length, 22);
  assert.deepEqual(Array.from(CHOICES.slice(0, 9), c => c.id), ['foot', 'car', 'muscle', 'sport', 'super', 'moto', 'bicycle', 'boat', 'helicopter']);
  assert.equal(new Set(CHOICES.map(c => c.id)).size, CHOICES.length);
  for (const entry of CAR_CATALOG) {
    game.state = 'driving'; game.controllers.entities.car = game.rides.find(c => c.kind === entry.kind);
    assert.ok(garage.currentIndex >= 0);
    assert.equal(CHOICES[garage.currentIndex].id, entry.kind === 'sedan' ? 'car' : entry.kind);
    garage.update();
  }
  for (const [flags, expected] of [[{ kind: 'cruiser' }, 'car'], [{ bicycle: true, mode: 'cyclist' }, 'bicycle'],
    [{ moto: true }, 'moto'], [{ boat: true }, 'boat'], [{ mode: 'helicopter' }, 'helicopter'],
    [{ mode: 'plane', kind: 'classic', flight: {} }, 'classic'], [{ mode: 'plane', kind: 'jet', flight: {} }, 'jet']]) {
    game.controllers.entities.car = flags;
    assert.equal(garage.current, expected); assert.ok(garage.currentIndex >= 0);
  }
});

test('every catalogue car can be summoned repeatedly without growing the fleet or losing street cars', () => {
  const h = harness(), seen = new Map();
  for (let round = 0; round < 3; round++) for (const entry of CAR_CATALOG) {
    h.garage.summon(entry.kind === 'sedan' ? 'car' : entry.kind);
    const car = h.game.car;
    assert.equal(car.kind, entry.kind);
    assert.equal(car.pooled, true); assert.equal(car.summoned, true); assert.equal(car.ridden, true);
    assert.equal(h.game.person.inVehicle, true); assert.equal(h.game.state, 'driving');
    assert.ok(h.game.fleet.includes(h.ordinary), 'a street vehicle remains in the world');
    assert.equal(h.game.fleet.length, 2, 'only the current pooled car joins the street fleet');
    assert.equal(new Set(h.game.fleet).size, h.game.fleet.length);
    if (seen.has(entry.kind)) assert.equal(car, seen.get(entry.kind), 'recall reuses the compiled model');
    seen.set(entry.kind, car);
  }
  assert.equal(h.repaired(), 45);
});

test('recalling a damaged car repairs it and clears its suspension, steering and reverse state', () => {
  const h = harness();
  h.garage.summon('muscle');
  const car = h.game.car;
  car.hp = 2; car.nitro = 0; car.body.reversing = true; car.body.steer = 0.5;
  car.body.wheels[0].burst = true; car.body.wheels[0].travel = 0.1;
  h.garage.summon('truck');
  assert.equal(car.mesh.visible, false);
  h.garage.summon('muscle');
  assert.equal(h.game.car, car); assert.equal(car.hp, 100); assert.equal(car.nitro, 1);
  assert.equal(car.body.reversing, false); assert.equal(car.body.steer, 0);
  assert.equal(car.body.wheels[0].burst, false); assert.equal(car.body.wheels[0].travel, 0);
});

test('garage selection saves ordinary cars unchanged and never serializes hidden pool bodies', () => {
  const h = harness();
  for (const entry of CAR_CATALOG) h.garage.summon(entry.kind === 'sedan' ? 'car' : entry.kind);
  const data = h.saved();
  assert.ok(data);
  assert.equal(data.fleet.length, 1);
  assert.equal(data.fleet[0].kind, 'sedan'); assert.equal(data.fleet[0].hp, 61);
  assert.deepEqual(data.fleet[0].position, { x: 15, y: 0, z: 20 });
  assert.equal(data.state, 'onFoot'); assert.equal(data.active, -1);
  assert.deepEqual(data.held, ['midtown']);
  h.garage.summon('foot');
  assert.equal(h.game.state, 'onFoot'); assert.equal(h.game.person.inVehicle, false);
  assert.equal(h.game.car.ridden, false); assert.equal(h.saved().fleet.length, 1);
});

test('opening, arrow navigation and selection operate on the whole grid with the real strip controller', () => {
  const { garage, game, CHOICES } = harness();
  garage.show();
  assert.equal(game.modal, true); assert.equal(garage.panel.hidden, false); assert.equal(garage.sel, 0);
  const press = code => garage.key({ code, preventDefault() {}, stopImmediatePropagation() {} });
  press('ArrowUp'); assert.equal(garage.sel, 15);
  press('ArrowDown'); assert.equal(garage.sel, 0);
  press('ArrowLeft'); assert.equal(garage.sel, CHOICES.length - 1);
  assert.match(garage.info.querySelector('strong').textContent, /FRET/);
  assert.match(garage.info.querySelector('small').textContent, /RAPPORTS/);
  press('Enter');
  assert.equal(game.car.kind, 'truck'); assert.equal(garage.panel.hidden, true); assert.equal(game.modal, false);
  garage.show(); press('Digit2'); assert.equal(game.car.kind, 'sedan');
});


test('large garage bodies request clearance for their complete dimensions before spawning', () => {
  const h = harness();
  // Saving also asks for a person-sized spot, so record the radius at groundSpot itself.
  const asked = [];
  h.game.safeSpot = (x, z, radius) => { asked.push(radius); return { x, z }; };
  h.garage.summon('truck');
  const truck = h.game.car;
  assert.ok(asked[0] >= Math.hypot(truck.halfW, truck.halfL), 'the rear overhang must clear the surroundings');
  assert.ok(asked[0] > 2.5);
});

test('garage clearance uses the full radius against real building footprints', () => {
  const safeSpot = vm.runInNewContext(`(class Game {
    ${section('safeSpot', 'placeWorldPickups')}
  }).prototype.safeSpot`, { polygonContact });
  const polygon = {
    outer: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }],
    holes: []
  };
  const wall = { minX: 0, maxX: 10, minZ: 0, maxZ: 10, maxY: 20, polygon };
  const game = { controllers: { nearColliders: () => [wall] } };
  const radius = 3.5;
  const spot = safeSpot.call(game, 12, 5, radius);
  assert.ok(!polygonContact(polygon, spot.x, spot.z, { radius }));
  assert.ok(Math.hypot(spot.x - 12, spot.z - 5) <= 3, 'use a nearby position outside the façade');
});

test('a mission vehicle stays in the street when changing to a garage car', () => {
  const h = harness();
  h.game.state = 'driving'; h.ordinary.mission = true; h.ordinary.summoned = true; h.ordinary.ridden = true;
  h.garage.summon('super');
  assert.ok(h.game.fleet.includes(h.ordinary));
  assert.equal(h.ordinary.ridden, false);
  assert.equal(h.ordinary.mesh.visible, true);
  assert.deepEqual(h.ordinary.position.toArray(), [15, 0, 20]);
});

test('prewarming the complete garage preserves a full restored fleet and does not vacate real parking', () => {
  const h = harness(), game = h.game;
  game.fleet = Array.from({ length: 12 }, (_, i) => ({ ...h.ordinary, position: new THREE.Vector3(100 + i * 10, 0, 0), mesh: new THREE.Group() }));
  game.controllers.entities.car = game.fleet[0];
  game.rides = []; game.nextId = 30;
  const original = [...game.fleet];
  let parkingCalls = 0;
  game.parking = { vacateNear() { parkingCalls++; } };
  const create = ({ kind = 'sedan', paint }) => {
    const spec = manifest[kind]?.spec || manifest.sedan.spec;
    const tune = makeTune(kind, { ...spec, halfL: Math.max(spec.zFront, -spec.zRear) });
    return { kind, paint, spec: { ...spec, wheelZ: (spec.wheelZf - spec.wheelZr) / 2 }, tune,
      position: new THREE.Vector3(), mesh: new THREE.Group(), speed: 0 };
  };
  game.controllers.createCarEntity = create;
  const initStart = gameSource.indexOf('    for (const [kind, paint] of [...CAR_CATALOG');
  const initEnd = gameSource.indexOf('    controllers.entities.person.inVehicle', initStart);
  assert.ok(initStart > 0 && initEnd > initStart, 'exercise the actual constructor pool path');
  const methods = vm.runInNewContext(`class Prewarm {
    ${section('makeCar', 'spawnFleet')}
    warm() { ${gameSource.slice(initStart, initEnd)} }
  }; Prewarm.prototype`, { THREE, CAR_CATALOG, FLEET_MAX: 12, splitDoor() {},
    createMotorbike: (_scene, options) => create({ ...options, kind: 'moto' }),
    createBoat: (_scene, options) => create({ ...options, kind: 'boat' }) });
  game.makeCar = methods.makeCar;
  methods.warm.call(game);
  assert.deepEqual(game.fleet, original);
  assert.equal(game.car, original[0]);
  assert.equal(parkingCalls, 0, 'hidden preparation must not remove a parked car at the world origin');
  assert.equal(game.rides.length, CAR_CATALOG.length + 2);
  assert.ok(game.rides.every(c => c.pooled && !game.fleet.includes(c)));
  assert.ok(game.rides.every(c => c.position.y === -100));
});
