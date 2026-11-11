const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./helpers/module.cjs');

// Flying as the game lives it (js/aviation.js): the player's keys on the stick, what the flight model's events cost,
// the pilot's eyes under g, the stunts that pay and the city's reactions. The flight model is the real one.

const source = (name) => readFileSync(join(__dirname, `../js/${name}.js`), 'utf8');
const flight = loadModule(source('flight'), { globals: { Math } });
class Vector3 { constructor() { this.x = this.y = this.z = 0; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
const { Aviation } = loadModule(source('aviation'), {
  globals: { Math },
  imports: { 'three/webgpu': { Vector3 }, './flight.js': flight, './aircraft.js': { aircraftPoint: (a, x, y, z, out) => out.set(x, y, z) } }
});

function craft(kind, at) {
  const a = { kind, position: { x: 0, y: 0, z: 0 }, flight: flight.createFlight(kind), hp: 100, mesh: { visible: true }, eye: [0, 1, 0], drive: { speed: kind === 'jet' ? 430 : 67 } };
  return flight.placeAircraft(a, at);
}

function harness({ kind = 'jet', at = { y: 600, speed: 160 } } = {}) {
  const log = { damage: [], hurt: [], toasts: [], awards: [], shakes: [], alarms: 0, panics: [], fled: [], scattered: [], sounds: [] };
  const colliders = [];
  const strain = { value: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } } };
  const classic = craft('classic', { y: 300, speed: 45 }), jet = craft('jet', { y: 600, speed: 160 });
  const car = kind === 'jet' ? jet : classic;
  flight.placeAircraft(car, at);
  const game = {
    state: 'driving', clock: 0, car,
    controllers: {
      keys: {}, aircraft: { classic, jet },
      flightWorld: { ground: () => 0, water: () => false, waterLevel: -2.2, solid: () => false, gust: 0 },
      overWater: () => false, nearColliders: () => colliders, bridgeDeckAt: () => false
    },
    camera: { addShake: (v) => log.shakes.push(v), activePresetId: 'chase' },
    audio: { flight: new Proxy({}, { get: (_, name) => (...args) => { log.sounds.push([name, ...args]); return true; } }), ui() {}, ambienceEvent: () => { log.alarms++; } },
    toast: (title) => log.toasts.push(title),
    damageCar: (a, amount) => { log.damage.push(amount); a.hp = Math.max(0, a.hp - amount); },
    damagePlayer: (amount) => log.hurt.push(amount),
    stunts: { award: (title, money) => log.awards.push([title, money]), crashed() { log.crashed = true; } },
    birds: { scatter: (x, z, r) => log.scattered.push(r) },
    traffic: { pedestrians: { panic: (x, z, r) => log.panics.push(r) }, flee: (x, z, r) => log.fled.push([x, z, r]) },
    atmosphere: { weather: 'clear', grade: { strain } },
    removeFleetCar(a) { log.removed = a; }
  };
  const aviation = new Aviation(game);
  return { aviation, game, car, log, colliders, strain };
}

const event = (h, e) => { h.car.flight.events.length = 0; h.car.flight.events.push(e); h.aviation.events(h.car, true, 1 / 60); };

test('the keys are the stick: S pulls, Q rolls left, A and E are the rudder, Space and C the lever, Shift the reheat', () => {
  const h = harness();
  Object.assign(h.game.controllers.keys, { backward: true, left: true, yawLeft: true, up: true, sprint: true });
  h.aviation.fly(1 / 60);
  assert.deepEqual({ ...h.aviation.input }, { pitch: 1, roll: 1, yaw: 1, throttle: 1, boost: true, brake: false });
  Object.assign(h.game.controllers.keys, { backward: false, forward: 0.4, left: false, right: true, yawLeft: false, yawRight: true, up: false, lever: true, sprint: false, handbrake: true });
  for (let i = 0; i < 6; i++) h.aviation.fly(1 / 60);
  assert.deepEqual({ ...h.aviation.input }, { pitch: -0.4, roll: -1, yaw: -1, throttle: -1, boost: false, brake: true });
  assert.ok(h.car.flight.stickPitch < 0 && h.car.flight.stickRoll < 0.2, 'the flight model received it');
  // not an aircraft: nothing to fly
  h.game.car = { position: { x: 0, y: 0, z: 0 } };
  assert.doesNotThrow(() => h.aviation.fly(1 / 60));
  assert.equal(h.aviation.piloted, null);
});

test('only the aircraft in hand is piloted; one parked with its lever shut is left alone', () => {
  const h = harness();
  assert.equal(h.aviation.piloted, h.car);
  h.game.state = 'onFoot';
  assert.equal(h.aviation.piloted, null);
  const parked = craft('classic', { y: 0, throttle: 0, onGround: true });
  for (let i = 0; i < 120; i++) h.aviation.drift(parked, 1 / 60);
  const { x, z } = parked.position;
  parked.flight.airspeed = 0; parked.flight.onGround = true;
  h.aviation.drift(parked, 1 / 60);
  assert.equal(parked.position.x, x); assert.equal(parked.position.z, z);
  // left in flight, it flies on by itself
  const adrift = craft('classic', { y: 300, speed: 45 });
  h.aviation.drift(adrift, 1 / 60);
  assert.ok(adrift.position.z > 0.5);
  adrift.destroyed = true;
  const before = adrift.position.z;
  h.aviation.drift(adrift, 1 / 60);
  assert.equal(adrift.position.z, before);
});

test('what the flight costs: a wing tip, a hard landing, a belly on the road, a wall at a roll', () => {
  let h = harness();
  event(h, { type: 'strike', kind: 'tipL', speed: 120, x: 0, y: 0, z: 0, nx: 1, nz: 0 });
  assert.deepEqual(h.log.damage, [45]);
  assert.match(h.log.toasts[0], /aile/i);
  assert.ok(h.log.shakes[0] > 1 && h.log.crashed);

  h = harness();
  event(h, { type: 'touchdown', sink: 1, speed: 60, x: 0, y: 0, z: 0 });
  assert.deepEqual(h.log.damage, [], 'a normal landing costs nothing');
  event(h, { type: 'touchdown', sink: 6.5, speed: 60, x: 0, y: 0, z: 0 });
  assert.ok(h.log.damage[0] > 10, 'a dropped one does');
  event(h, { type: 'gearCollapse', sink: 9 });
  assert.equal(h.log.damage[1], 30);
  assert.match(h.log.toasts.at(-1), /Train/);

  h = harness();
  event(h, { type: 'scrape', kind: 'belly', hit: 3, speed: 50, first: true, x: 0, y: 0, z: 0 });
  event(h, { type: 'scrape', kind: 'belly', hit: 0, speed: 50, dt: 0.005, x: 0, y: 0, z: 0 });
  assert.ok(h.log.damage[0] > h.log.damage[1] && h.log.damage[1] > 0);
  h = harness({ kind: 'classic', at: { y: 300, speed: 45 } });
  event(h, { type: 'scrape', kind: 'prop', hit: 1, speed: 10, first: true, x: 0, y: 0, z: 0 });
  assert.ok(h.car.flight.damage.engine >= 0.6, 'a propeller on the ground costs the engine');

  h = harness();
  event(h, { type: 'wreck', kind: 'nose', speed: 22, closing: 20, x: 0, y: 0, z: 0, nx: 0, nz: -1 });
  assert.equal(h.car.hp, 0, 'the aircraft is a write-off');
  assert.ok(h.log.hurt[0] > 10 && h.log.hurt[0] <= 60, 'the pilot is shaken, not killed');
  event(h, { type: 'bump', kind: 'nose', speed: 2, closing: 1, x: 0, y: 0, z: 0 });
  assert.equal(h.log.damage.length, 1, 'a nudge at a walk costs nothing more');
});

test('out of hit points the engine is dead: the aircraft becomes a glider', () => {
  const h = harness();
  h.car.hp = 0;
  h.aviation.fly(1 / 60);
  assert.equal(h.car.flight.damage.engine, 1);
  const hurt = harness();
  hurt.car.hp = 20;
  hurt.aviation.fly(1 / 60);
  assert.equal(hurt.car.flight.damage.engine, 0.5);
});

test('a ditching is survived and paid; the wreck floats, then goes', () => {
  const h = harness({ kind: 'classic', at: { y: 300, speed: 45 } });
  event(h, { type: 'ditch', speed: 28, x: 0, y: -2.2, z: 0 });
  assert.match(h.log.toasts[0], /Amerrissage/);
  assert.equal(h.log.awards[0][0], 'MIRACLE SUR L’HUDSON');
  assert.ok(h.car.sinkT > 30);
  // left behind, it sinks and goes back to the garage
  h.car.flight.ditched = true;
  h.game.state = 'onFoot';
  const y = h.car.position.y;
  for (let t = 0; t < 46; t += 0.5) h.aviation.update(0.5);
  assert.ok(h.car.position.y < y, 'it went down');
  assert.equal(h.log.removed, h.car);
});

test('the sound barrier: one bang, an award, and the streets under it hear it', () => {
  const h = harness({ at: { y: 300, speed: 345 } });
  h.car.flight.agl = 300;
  event(h, { type: 'boom' });
  assert.deepEqual(h.log.awards[0], ['MUR DU SON', 1500]);
  assert.ok(h.log.sounds.some(([name]) => name === 'boom'));
  assert.equal(h.log.alarms, 6);
  assert.ok(h.log.panics[0] > 100 && h.log.scattered[0] > 100);
  // from high up, nobody below is troubled
  const high = harness({ at: { y: 3000, speed: 345 } });
  high.car.flight.agl = 3000;
  event(high, { type: 'boom' });
  assert.equal(high.log.alarms, 0);
});

test('a low pass empties the sidewalk and clears the street ahead; high up the city is left in peace', () => {
  const h = harness({ kind: 'classic', at: { y: 20, speed: 45 } });
  h.car.flight.agl = 20; h.car.flight.onGround = false;
  h.aviation.update(1 / 60);
  assert.ok(h.log.scattered.length && h.log.panics.length, 'birds and people react');
  assert.equal(h.log.fled.length, 3, 'drivers ahead get out of the way');
  assert.ok(h.log.fled.every(([, z]) => z > 0), 'ahead of it, not behind');
  const high = harness({ kind: 'classic', at: { y: 400, speed: 45 } });
  high.car.flight.agl = 400;
  high.aviation.update(1 / 60);
  assert.equal(high.log.scattered.length + high.log.panics.length + high.log.fled.length, 0);
});

test('aerobatics pay: a loop, a roll, a street flown below the roofs, a bridge flown under', () => {
  const h = harness({ kind: 'classic', at: { y: 300, speed: 50 } });
  const b = h.car.flight;
  b.onGround = false; b.agl = 300;
  // a loop: the nose goes all the way round at 1 rad/s
  b.wx = -1; b.wz = 0;
  for (let t = 0; t < 6.2; t += 1 / 60) h.aviation.stunts(h.car, 1 / 60, false);
  assert.deepEqual(h.log.awards.map(([title]) => title), ['LOOPING']);
  // a roll, the other way round: it pays either way
  b.wx = 0; b.wz = -3;
  for (let t = 0; t < 2.2; t += 1 / 60) h.aviation.stunts(h.car, 1 / 60, false);
  assert.deepEqual(h.log.awards.map(([title]) => title), ['LOOPING', 'TONNEAU']);
  // wobbling about level never adds up to a figure
  b.wz = 0;
  for (let t = 0; t < 30; t += 1 / 60) { b.wx = Math.sin(t * 3) * 0.2; h.aviation.stunts(h.car, 1 / 60, false); }
  assert.equal(h.log.awards.length, 2);

  // down a street: walls higher than the aircraft on both sides
  b.wx = 0; b.agl = 20; h.car.position.y = 20;
  h.colliders.push({ minX: 12, maxX: 30, minZ: -40, maxZ: 40, maxY: 80 }, { minX: -30, maxX: -12, minZ: -40, maxZ: 40, maxY: 60 });
  assert.equal(h.aviation.streetCanyon(h.car), true);
  for (let t = 0; t < 4.2; t += 1 / 60) h.aviation.stunts(h.car, 1 / 60, true);
  assert.equal(h.log.awards.at(-1)[0], 'RASE-MOTTES');
  h.colliders.length = 1;
  assert.equal(h.aviation.streetCanyon(h.car), false, 'a wall on one side only is not a canyon');

  // under a bridge: paid on coming out the other side, once
  h.colliders.length = 0;
  h.game.clock = 100;
  h.game.controllers.bridgeDeckAt = (x, z, out) => { out.bottom = 40; out.top = 50; return true; };
  h.aviation.stunts(h.car, 1 / 60, false);
  assert.equal(h.log.awards.at(-1)[0], 'RASE-MOTTES', 'nothing yet while under it');
  h.game.controllers.bridgeDeckAt = () => false;
  h.aviation.stunts(h.car, 1 / 60, false);
  assert.equal(h.log.awards.at(-1)[0], 'SOUS LE PONT');
  const n = h.log.awards.length;
  h.aviation.stunts(h.car, 1 / 60, false);
  assert.equal(h.log.awards.length, n);
  // over the deck is not under it
  h.car.position.y = 60;
  h.game.controllers.bridgeDeckAt = (x, z, out) => { out.bottom = 40; out.top = 50; return true; };
  assert.equal(h.aviation.overhead(h.car), null);
});

test('g on the pilot: sight greys under a long hard pull, clears when it eases, and insisting costs the stick', () => {
  const h = harness();
  const b = h.car.flight;
  b.gSmooth = 8;
  for (let t = 0; t < 2; t += 1 / 60) h.aviation.pilot(h.car, 1 / 60);
  assert.ok(h.aviation.grey > 0.4 && h.aviation.grey < 0.8, `grey ${h.aviation.grey}`);
  assert.ok(h.strain.value.x > 0.2 && h.strain.value.y === 0);
  assert.equal(h.aviation.blackout, 0);
  b.gSmooth = 1;
  for (let t = 0; t < 2; t += 1 / 60) h.aviation.pilot(h.car, 1 / 60);
  assert.equal(h.aviation.grey, 0);
  // five g can be held for ever: it is the long pull at the limit that takes sight away
  b.gSmooth = 5;
  for (let t = 0; t < 30; t += 1 / 60) h.aviation.pilot(h.car, 1 / 60);
  assert.equal(h.aviation.grey, 0);
  b.gSmooth = 8;
  for (let t = 0; t < 5; t += 1 / 60) h.aviation.pilot(h.car, 1 / 60);
  assert.ok(h.aviation.blackout > 0);
  assert.match(h.log.toasts.at(-1), /Voile noir/);
  h.game.controllers.keys.backward = true;
  h.aviation.fly(1 / 60);
  assert.equal(h.aviation.input.pitch, 0, 'the stick is out of the pilot’s hands');
  // hanging in the straps: red
  b.gSmooth = -2.5;
  for (let t = 0; t < 2; t += 1 / 60) h.aviation.pilot(h.car, 1 / 60);
  assert.ok(h.strain.value.y > 0.5);
  // out of the aircraft the eyes are their own again
  h.aviation.pilot(null, 1 / 60);
  assert.deepEqual([h.strain.value.x, h.strain.value.y, h.aviation.blackout], [0, 0, 0]);
});

test('the garage hands over an aircraft at a speed it flies well at, whatever the player was doing', () => {
  const h = harness();
  const { classic, jet } = h.game.controllers.aircraft;
  classic.destroyed = true; classic.crashed = true;
  h.aviation.launch(classic, { x: 10, y: 250, z: 20, heading: 1, speed: 300 });
  assert.ok(classic.flight.airspeed < 60 && classic.flight.airspeed > 40, `biplane at ${classic.flight.airspeed}`);
  assert.equal(classic.destroyed, false); assert.equal(classic.crashed, false);
  assert.equal(classic.position.y, 250);
  h.aviation.launch(jet, { x: 0, y: 250, z: 0, heading: 0, speed: 0 });
  assert.ok(jet.flight.airspeed > jet.flight.tune.vStall * 2, 'never handed over at the stall');
  assert.equal(jet.flight.gear, 0);
  h.aviation.launch(jet, { x: 0, y: 0, z: 0, heading: 0, ground: true });
  assert.equal(jet.onGround, true);
  assert.equal(jet.flight.throttle, 0);
});

test('the lever key: undercarriage on the fighter, display smoke on the biplane', () => {
  const jet = harness();
  assert.equal(jet.car.flight.gearTarget, 0);
  assert.equal(jet.aviation.toggleGear(), true);
  assert.equal(jet.car.flight.gearTarget, 1);
  assert.ok(jet.car.flight.gearHold > 0, 'the aircraft leaves the lever alone after the pilot touched it');
  const bi = harness({ kind: 'classic', at: { y: 300, speed: 45 } });
  assert.equal(bi.aviation.smoke, false);
  bi.aviation.toggleGear();
  assert.equal(bi.aviation.smoke, true);
  bi.game.state = 'onFoot';
  assert.equal(bi.aviation.toggleGear(), false);
});

test('the wind an aircraft meets is sheltered down among the buildings', () => {
  const h = harness();
  h.game.vertical = { wind: { base: 6, gust: 0.3, at: (x, y, z, out) => { out.x = 10; out.y = 0; out.z = 0; return out; } } };
  const low = h.aviation.env.wind(0, 5, 0, {}), high = h.aviation.env.wind(0, 400, 0, {});
  assert.ok(low.x < 2 && high.x === 5);
  h.aviation.fly(1 / 60);
  assert.ok(h.aviation.env.gust > 0);
});
