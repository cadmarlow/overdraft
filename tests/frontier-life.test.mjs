import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  FRONTIER_SITES, frontierDistance, frontierFacadeWear, frontierGroves, frontierOpen, frontierPoint
} from '../js/frontier-districts.js';
import * as districts from '../js/frontier-districts.js';
import * as activity from '../js/frontier-activity.js';
import helpers from './helpers/module.cjs';
import { cityBoundsAt } from '../js/city-frontier.js';
import { roofAt, roofColliderAt } from '../js/building-collision.js';
import { createFrontierSurfaces, saltLandAt, saltLocation, saltRoadAt, sampleSalt } from '../js/wasteland-plan.js';

test('the transition field changes sign continuously at the city edge on both sides', () => {
  for (const z of [-6200, -4000, -1210, 650, 3740, 5790]) {
    const { westX, eastX } = cityBoundsAt(z);
    for (const [x, outward] of [[westX, -1], [eastX, 1]]) {
      assert.ok(Math.abs(frontierDistance(x, z)) < 1e-7);
      assert.ok(frontierDistance(x - outward * 15, z) < 0);
      assert.ok(frontierDistance(x + outward * 15, z) > 0);
    }
  }
});

test('the named settlements are accessible and their shelters are clear of the through roads', () => {
  for (const site of FRONTIER_SITES) {
    assert.equal(saltLocation(site.x, site.z), site.name);
    const bounds = [site.width / 2, site.depth / 2];
    for (const [x, z] of [[0, 0], bounds, bounds.map(v => -v), [0, site.depth / 2 + 3]]) {
      const point = frontierPoint(site, x, z), road = {};
      assert.ok(saltLandAt(point.x, point.z), site.id);
      assert.ok(Number.isFinite(sampleSalt(point.x, point.z)), site.id);
      assert.ok(!saltRoadAt(point.x, point.z, road) || road.distance > road.half + 3, site.id);
    }
    assert.ok(frontierOpen(site, 14), site.id);
  }
  assert.equal(frontierOpen(FRONTIER_SITES[0], 1), false);
  assert.equal(frontierOpen(FRONTIER_SITES.find(site => site.id === 'vigie'), 1), true);
});

test('frontier trees grow in repeatable patches outside the city and taper off before the desert', () => {
  const trees = frontierGroves();
  assert.ok(trees.length > 300 && trees.length < 1000);
  assert.deepEqual(trees, frontierGroves());
  assert.ok(trees.every(({ x, z }) => {
    const d = frontierDistance(x, z);
    return d > 0 && d < 145;
  }));
});

const source = readFileSync(new URL('../js/gameplay.js', import.meta.url), 'utf8');
const movement = source.match(/  updatePerson\(dt\) \{([\s\S]*?)\n  \}/)[1];
const updatePerson = new Function('clamp', 'angleDelta', 'WATER', `return function(dt) {${movement}\n}`)(
  (value, min, max) => Math.min(max, Math.max(min, value)),
  (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from)),
  -2
);

test('walking on the dry ground below street level keeps the player on the terrain', () => {
  for (const hz of [24, 60, 120]) {
    const position = { x: 616, z: -6190 };
    position.y = sampleSalt(position.x, position.z);
    assert.ok(position.y < -0.05);
    const game = {
      state: 'onFoot', stamina: 100, person: { position, speed: 0, heading: Math.PI / 2, verticalVel: 0 },
      camera: { footYaw: Math.PI / 2 }, weapon: { interval: 1 }, cooldown: 0, allCars: [],
      vertical: { owns: () => false, landed() {}, checkFall() {} }, isAiming: () => false,
      controllers: {
        keys: { forward: 1, backward: 0, left: 0, right: 0 },
        getGroundHeight: (x, z) => sampleSalt(x, z), resolveHorizontalCollision() {},
        roofHeight: (...args) => roofAt([], ...args),
        roofCollider: (...args) => roofColliderAt([], ...args)
      }
    };
    for (let frame = 0; frame < hz * 4; frame++) {
      updatePerson.call(game, 1 / hz);
      assert.ok(Math.abs(position.y - game.person.footing) < 0.02, `${hz} Hz, frame ${frame}`);
    }
    assert.ok(position.x > 622);
    assert.ok(game.person.speed < 2);
  }
});

const { FrontierLife } = helpers.loadModule(readFileSync(new URL('../js/frontier-life.js', import.meta.url), 'utf8'), {
  imports: { 'three/webgpu': {}, './drive-fx.js': {}, './frontier-districts.js': districts, './frontier-activity.js': activity },
  filename: 'frontier-life.js'
});

function settlement(saved) {
  const player = { x: 0, z: 0, y: 0, alive: true, onFoot: true, speed: 0 };
  const actors = {
    actors: [],
    spawn(opts) {
      const actor = { ...opts, rig: {}, dead: false };
      this.actors.push(actor);
      return actor;
    },
    remove(actor) { this.actors.splice(this.actors.indexOf(actor), 1); }
  };
  const game = {
    player, state: 'onFoot', clock: 0, money: 0, saveCount: 0, frontierTrade: saved, active: true, allCars: [],
    atmosphere: { hour: 14, day: 2, weather: 'clear' }, director: { current: null }, wanted: { level: 0 }, actors, map: {},
    controllers: { getGroundHeight: () => 0 },
    hud: { say() {} }, audio: { ui() {} }, toast() {},
    addMoney(value) { this.money += value; },
    save() { this.saveCount++; }
  };
  const life = new FrontierLife(game, {
    hubs: new Map(FRONTIER_SITES.map(({ id }) => [id, { y: 0, cart: {}, stock: [] }])),
    posts: new Map(), halts: [],
    salvage: new Map(activity.FRONTIER_SALVAGE.map(point => [point.id, { visible: true, position: { y: 0 } }]))
  });
  life.renderView = () => {};
  const move = point => { Object.assign(player, point); life.update(0.5, player); };
  return { game, life, move };
}

test('the market changes shifts, retires its actors and does not steal slots during a mission', () => {
  const { game, life, move } = settlement();
  move(FRONTIER_SITES[0]);
  assert.equal(life.cast.length, 5);
  const cast = [...life.cast];
  game.atmosphere.weather = 'storm';
  move(FRONTIER_SITES[0]);
  assert.equal(life.shift, 'storm');
  assert.ok(cast.every((job, index) => job === life.cast[index]), 'weather does not respawn visible residents');
  assert.ok(life.cast[1].shelter >= 0);
  game.atmosphere.hour = 1;
  move(FRONTIER_SITES[0]);
  assert.equal(game.actors.actors.length, 1);
  assert.equal(life.cast.some(job => job.host), false);
  game.director.current = {};
  move(FRONTIER_SITES[0]);
  assert.equal(game.actors.actors.length, 0);
  game.director.current = null;
  move({ x: 8000, z: 0 });
  assert.equal(life.site, null);
});

test('salvage stays claimed after a reload and returns the next day', () => {
  const { game, life, move } = settlement();
  const crate = activity.FRONTIER_SALVAGE.at(-1);
  move(crate);
  assert.equal(life.prompt().id, 'salvage');
  assert.equal(life.interact(), true);
  assert.equal(life.trade.scrap, 2);
  assert.equal(game.saveCount, 1);
  assert.equal(life.world.salvage.get(crate.id).visible, false);
  assert.equal(life.interact(), false);
  const resumed = settlement(JSON.parse(JSON.stringify(game.frontierTrade)));
  resumed.move(crate);
  assert.equal(resumed.life.interact(), false);
  resumed.game.atmosphere.day++;
  resumed.move(crate);
  assert.equal(resumed.life.interact(), true);
  assert.equal(resumed.life.trade.scrap, 4);
});

test('frontier sales are bounded by range, opening hours, daily stock and the persisted ledger', () => {
  const { game, life, move } = settlement({ scrap: 2 });
  const market = FRONTIER_SITES[0];
  const point = frontierPoint(market, ...activity.FRONTIER_PROGRAMS.lisieres.counter);
  move(point);
  life.view = life.prompt();
  game.atmosphere.hour = 2;
  life.transact('sell');
  assert.equal(game.money, 0);
  game.atmosphere.hour = 14;
  game.player.x += 10;
  life.transact('sell');
  assert.equal(game.money, 0);
  move(point);
  life.transact('sell');
  assert.equal(game.money, 39);
  assert.equal(life.trade.scrap, 1);
  assert.equal(life.available('lisieres'), 4);
  assert.equal(game.frontierTrade.orders.lisieres.count, 1);
  assert.equal(activity.frontierQuote('balance', 17, 4), 59);
  assert.equal(activity.frontierQuote('lisieres', 14, 1), 51);
});

test('gates follow the actual road, stay clear over an occupied lane and reopen during a story', () => {
  const { game, life } = settlement();
  for (const gate of activity.FRONTIER_POSTS) {
    const road = {};
    assert.ok(saltRoadAt(gate.x, gate.z, road));
    assert.ok(road.distance < 0.1);
    assert.ok(activity.postClosed(gate.id, 14, 'storm'));
  }
  const barrier = { minY: 0.56, maxY: 1.24, obb: { cx: 0, cz: 0, cs: 1, sn: 0, hx: 7.6 } };
  const post = { id: 'nord', name: 'Poste', x: 0, z: 0, side: 1, progress: 0, closed: false, inserted: false, barrier,
    signal: {}, swing: { rotation: {}, updateMatrixWorld() {} } };
  const colliders = new Set();
  game.controllers.addCollider = c => colliders.add(c);
  game.controllers.removeCollider = c => { c.maxY = -100; colliders.delete(c); };
  game.atmosphere.hour = 2;
  for (let i = 0; i < 120; i++) life.updatePost(post, 1 / 60, game.player);
  assert.ok(post.progress < 0.5);
  assert.equal(colliders.size, 0);
  game.player.z = 18;
  for (let i = 0; i < 120; i++) life.updatePost(post, 1 / 60, game.player);
  assert.ok(post.inserted);
  const firstArm = post.inserted;
  assert.ok(colliders.has(firstArm));
  game.director.current = {};
  life.updatePost(post, 1 / 60, game.player);
  assert.ok(!post.inserted);
  assert.equal(colliders.size, 0);
  assert.equal(firstArm.maxY, -100);
  game.director.current = null;
  for (let i = 0; i < 120; i++) life.updatePost(post, 1 / 60, game.player);
  assert.ok(colliders.has(post.inserted));
  assert.equal(post.inserted.maxY, 1.24);
});

test('frontier decks are height-limited and the underlying land stays walkable', () => {
  const deck = { sample(x, z, out, maxY) { if (maxY < 3 || x !== 616) return false; out.y = 3; out.deck = true; return true; } };
  const terrain = createFrontierSurfaces(deck), hit = {};
  assert.ok(terrain.sample(616, -6190, 3.1, hit));
  assert.equal(hit.y, 3);
  assert.ok(terrain.sample(616, -6190, 1, hit));
  assert.ok(Math.abs(hit.y - sampleSalt(616, -6190)) < 0.001);
  assert.equal(hit.deck, false);
});

test('wear reaches the last blocks without changing inland façades', () => {
  for (const z of [-6000, -4500, -1500, 1100, 4300, 5800]) {
    const { westX, eastX } = cityBoundsAt(z);
    for (const [x, inside] of [[westX, 1], [eastX, -1]]) {
      assert.ok(frontierFacadeWear(x + inside * 5, z) > 0.34);
      assert.ok(frontierFacadeWear(x + inside * 110, z) > 0.08);
      assert.equal(frontierFacadeWear(x + inside * 275, z), 0);
    }
  }
});
