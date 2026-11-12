import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  FRONTIER_CRATE, FRONTIER_SITES, frontierDistance, frontierGroves, frontierOpen, frontierPoint
} from '../js/frontier-districts.js';
import { FrontierLife } from '../js/frontier-life.js';
import { cityBoundsAt } from '../js/city-frontier.js';
import { roofAt, roofColliderAt } from '../js/building-collision.js';
import { saltLandAt, saltLocation, saltRoadAt, sampleSalt } from '../js/wasteland-plan.js';

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

function settlement(initialStage = null) {
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
  const markers = new Set();
  const game = {
    player, state: 'onFoot', clock: 0, money: 0, saveCount: 0, frontierDelivery: initialStage,
    atmosphere: { hour: 14 }, director: { current: null }, wanted: { level: 0 }, actors, map: {},
    controllers: { getGroundHeight: () => 0 },
    markers: { add(x, z) { const m = { x, z }; markers.add(m); return m; }, remove(m) { markers.delete(m); } },
    safeSpot: (x, z) => ({ x, z }), hud: { say() {} }, audio: { ui() {} }, toast() {},
    addMoney(value) { this.money += value; },
    save() { this.saveCount++; }
  };
  const life = new FrontierLife(game);
  const move = point => { Object.assign(player, point); life.update(0.5, player); };
  return { game, life, move, markers };
}

test('the market changes shifts, retires its actors and does not steal slots during a mission', () => {
  const { game, life, move } = settlement();
  move(FRONTIER_SITES[0]);
  assert.equal(life.cast.length, 3);
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

test('the filter can be delivered once and its destination survives a resumed game', () => {
  const { game, life, move, markers } = settlement();
  const market = FRONTIER_SITES[0];
  const at = frontierPoint(market, 0.6, market.depth / 2 + 3);
  move(at);
  assert.match(life.prompt().text, /Leïla/);
  assert.equal(life.interact(), true);
  assert.equal(game.frontierDelivery, 'aller');
  assert.equal(game.map.waypoint.x, FRONTIER_CRATE.x);
  assert.equal(life.interact(), true, 'talking to the resident does not advance the delivery');
  assert.equal(game.frontierDelivery, 'aller');

  const resumed = settlement('aller');
  assert.equal(resumed.game.map.waypoint.direct, true);
  resumed.move(FRONTIER_CRATE);
  assert.equal(resumed.life.interact(), true);
  assert.equal(resumed.game.frontierDelivery, 'retour');
  assert.equal(resumed.markers.size, 1);
  resumed.game.atmosphere.hour = 1;
  resumed.move(at);
  assert.match(resumed.life.prompt().text, /Livrer/);
  assert.equal(resumed.life.interact(), true);
  assert.equal(resumed.game.frontierDelivery, 'livré');
  assert.equal(resumed.game.money, 850);
  assert.equal(resumed.markers.size, 0);
  assert.equal(resumed.game.map.waypoint, null);
  assert.equal(resumed.life.interact(), false);
  assert.equal(resumed.game.money, 850);
  assert.equal(markers.size, 1);
});
