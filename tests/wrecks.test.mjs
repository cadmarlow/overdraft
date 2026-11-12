import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import { CAR_CATALOG } from '../js/car-catalog.js';

// What a fire leaves of a vehicle is that vehicle. Every car that blew up used to turn into the same burnt sedan, a
// city bus included (gameplay.js placeWreck, controllers.js createCarEntity `burnt`).

const source = (name) => readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8');
const gameSource = source('gameplay');
const section = (start, end) => gameSource.slice(gameSource.indexOf(`  ${start}(`), gameSource.indexOf(`  ${end}(`));
const constant = (name) => Number(new RegExp(`const ${name} = (\\d+)`).exec(gameSource)[1]);

function harness() {
  const made = [];
  const methods = vm.runInNewContext(`class Wrecks {
    ${section('makeWreck', 'destroyCar')}
    ${section('destroyCar', 'wreckTraffic')}
    ${section('wreckTraffic', 'explode')}
  }; Wrecks.prototype`, { WRECK_MAX: constant('WRECK_MAX'), WRECKS_PER_KIND: constant('WRECKS_PER_KIND'), EJECT_ALTITUDE: 30, Math });
  const blasts = [], removed = [];
  const game = {
    clock: 0, wrecks: [], fleet: [], state: 'onFoot', stats: { cars: 0 }, car: null,
    wreckKinds: [...CAR_CATALOG.map((c) => c.kind), 'bus'],
    controllers: {
      createCarEntity(options) {
        made.push(options);
        return {
          kind: options.kind, body: { q: [0, 0, 0, 0], r: new Array(9).fill(0) }, position: new THREE.Vector3(),
          bodyPivot: { position: { y: 0 }, rotation: { x: 0, z: 0 } },
          mesh: { visible: true, position: new THREE.Vector3(), rotation: { y: 0 }, updateMatrixWorld() {} }
        };
      }
    },
    wanted: { units: [], retire() {} },
    traffic: { removeVehicle(v) { removed.push(v); v.edge = null; } },
    removeFleetCar(car) { this.fleet.splice(this.fleet.indexOf(car), 1); },
    explode(x, y, z) { blasts.push([x, z]); },
    damagePlayer() {}, bailOut() {}, toast() {}, onMode() {},
    makeWreck: methods.makeWreck, placeWreck: methods.placeWreck, destroyCar: methods.destroyCar, wreckTraffic: methods.wreckTraffic
  };
  for (const kind of game.wreckKinds) game.makeWreck(kind);
  // as after the first frames of a game: what is not standing in the street is hidden
  for (const w of game.wrecks) w.mesh.visible = false;
  return { game, made, blasts, removed };
}
const standing = (game) => game.wrecks.filter((w) => w.standing);

test('one burnt-out body of every model waits from the start, the bus included, all made the burnt way', () => {
  const { game, made } = harness();
  assert.equal(game.wrecks.length, CAR_CATALOG.length + 1);
  assert.deepEqual(game.wrecks.map((w) => w.kind), [...CAR_CATALOG.map((c) => c.kind), 'bus']);
  for (const options of made) assert.equal(options.burnt, true);
  for (const w of game.wrecks) {
    assert.ok(w.wreck && w.destroyed && !w.standing && w.hp === 0);
    assert.ok(w.position.y < -10, 'out of sight');
    assert.ok(w.bodyPivot.position.y < 0, 'down on its burst tyres');
  }
});

test('a vehicle that blows up leaves its own model: taxi, bus, pickup, never a stand-in', () => {
  const { game } = harness();
  for (const kind of ['taxi', 'bus', 'pickup', 'super', 'delivery']) {
    game.clock += 1;
    const w = game.placeWreck(10, 20, 1.2, kind);
    assert.equal(w.kind, kind);
    assert.ok(w.standing && w.mesh.visible && w.burnT > 0 && w.smokeT > 0);
    assert.deepEqual([w.position.x, w.position.y, w.position.z, w.heading], [10, 0, 20, 1.2]);
  }
  // a model the game does not know burns down to a sedan rather than to nothing
  assert.equal(game.placeWreck(0, 0, 0, 'hovercraft').kind, 'sedan');
});

test('a second wreck of a model is made on the spot, a third takes the oldest; the street keeps a bounded number', () => {
  const { game, made } = harness();
  const before = made.length;
  const taxis = [];
  for (let i = 0; i < 3; i++) { game.clock += 1; taxis.push(game.placeWreck(i * 10, 0, 0, 'taxi')); }
  assert.equal(made.length, before + 1); // one more taxi wreck, no more
  assert.notEqual(taxis[0], taxis[1]);
  assert.equal(taxis[2], taxis[0]); // the oldest moves to the new fire
  assert.equal(taxis[2].position.x, 20);
  // more fires than the street keeps: the oldest wreck is cleared away
  const max = constant('WRECK_MAX');
  for (const kind of ['bus', 'suv', 'van', 'sedan', 'hatch', 'muscle', 'truck']) { game.clock += 1; game.placeWreck(100, 0, 0, kind); }
  assert.equal(standing(game).length, max);
  assert.equal(game.wrecks.filter((w) => w.mesh.visible).length, max);
  const gone = game.wrecks.filter((w) => !w.standing && w.placedAt !== undefined);
  assert.ok(gone.length > 0 && gone.every((w) => !w.mesh.visible && !w.burnT && !w.smokeT && w.position.y < -10));
  assert.ok(Math.max(...gone.map((w) => w.placedAt)) < Math.min(...standing(game).map((w) => w.placedAt)), 'the oldest went');
});

test('traffic that explodes is replaced by its own model, a bus by a bus', () => {
  const { game, removed, blasts } = harness();
  const bus = { edge: {}, bus: true, bodyType: undefined, x: 5, z: 7, yaw: 0.5, yawOffset: 0.1 };
  const suv = { edge: {}, bus: false, bodyType: 'suv', x: -3, z: 9, yaw: 1, yawOffset: 0 };
  game.wreckTraffic(bus);
  game.clock += 1;
  game.wreckTraffic(suv);
  assert.deepEqual(standing(game).map((w) => w.kind).sort(), ['bus', 'suv']);
  const w = standing(game).find((c) => c.kind === 'bus');
  assert.deepEqual([w.position.x, w.position.z], [5, 7]);
  assert.ok(Math.abs(w.heading - 0.6) < 1e-9);
  assert.deepEqual(removed, [bus, suv]);
  assert.equal(blasts.length, 2);
  // a vehicle already off the road leaves nothing
  game.wreckTraffic({ edge: null, bodyType: 'van', x: 0, z: 0, yaw: 0, yawOffset: 0 });
  assert.equal(standing(game).length, 2);
});

test('a car of the game that is destroyed leaves its own model; a motorbike, a boat or an aircraft leaves none', () => {
  const { game } = harness();
  const car = (kind, extra = {}) => ({ kind, position: new THREE.Vector3(1, 0, 2), heading: 0.3, mesh: { visible: true }, burnT: 3, ...extra });
  const pickup = car('pickup');
  game.fleet.push(pickup);
  game.destroyCar(pickup);
  assert.ok(pickup.destroyed && !pickup.mesh.visible && !game.fleet.includes(pickup));
  assert.deepEqual(standing(game).map((w) => w.kind), ['pickup']);
  for (const other of [car('moto', { moto: true }), car('boat', { boat: true }), car('sedan', { mode: 'plane' })]) game.destroyCar(other);
  assert.equal(standing(game).length, 1);
  // a police cruiser is a sedan or an SUV under its livery
  game.clock += 1;
  game.destroyCar(car('suv', { police: true }));
  assert.deepEqual(standing(game).map((w) => w.kind).sort(), ['pickup', 'suv']);
});

test('the burnt state rides in the street cars\' style code without disturbing it, and the bus has its own', () => {
  const assets = source('car-assets'), controllers = source('controllers'), bus = source('bus');
  const BURNT = Number(/const BURNT = (\d+);/.exec(assets)[1]), LAMPS_OFF = Number(/const LAMPS_OFF = (\d+);/.exec(assets)[1]);
  assert.ok(BURNT > LAMPS_OFF, 'a burnt car has no lamps: above LAMPS_OFF');
  assert.equal(BURNT % 8, 0, 'the livery (style code mod 8) is left alone');
  assert.equal(LAMPS_OFF % 8, 0);
  assert.ok(Number(/const BUS_BURNT = (\d+);/.exec(bus)[1]) >= 2, 'above the brake lamp states 0 and 1');
  // the wreck is drawn with that state, on the street's own materials
  assert.match(controllers, /Float32Array\.of\(0, 0, 0, burnt \? BURNT : 0\)/);
  assert.match(controllers, /Float32Array\.of\(BUS_BURNT, 0, 0, 1\)/);
  assert.match(controllers, /burnt \? createBurntWheelMaterial\(\) : createWheelMaterial\(model\)/);
  // and no wreck is made of a fixed model any more
  assert.doesNotMatch(gameSource, /createCarEntity\(\{ kind: 'sedan'/);
  assert.match(gameSource, /this\.placeWreck\(x, z, heading, car\.kind(?:,|\))/);
  assert.match(gameSource, /this\.placeWreck\(x, z, heading, v\.bus \? 'bus' : v\.bodyType\)/);
});
