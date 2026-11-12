import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Vector3 } from '../vendor/three/build/three.core.js';
import { WEAPONS, lineOfSight } from '../js/weapons.js';
import { RoadNavigator } from '../js/navigation.js';
import * as routing from '../js/police-routing.js';
import helpers from './helpers/module.cjs';

const source = (file) => readFileSync(new URL(`../js/${file}.js`, import.meta.url), 'utf8');
const { WantedSystem } = helpers.loadModule(source('wanted'), { imports: {
  'three/webgpu': { Vector3 }, 'three/addons/utils/BufferGeometryUtils.js': {},
  './cars.js': {}, './weapons.js': { lineOfSight }, './ai-driver.js': {}, './police-routing.js': routing
} });
const { ActorSystem } = helpers.loadModule(source('actors'), { imports: {
  'three/webgpu': { Vector3 }, './pedestrians.js': {}, './characters.js': {}, './weapons.js': { WEAPONS }, './ragdoll.js': {}
} });

function makeCruiser(x, z, heading = 0) {
  const car = {
    position: new Vector3(x, 0, z), mesh: { position: new Vector3(), rotation: {}, updateMatrixWorld() {} },
    heading, speed: 0, drive: { speed: 30 }, body: {}
  };
  return {
    active: true, mode: 'pursue', car, los: false, losT: 0, crew: [],
    driver: { setGoal(x, z) { this.goal = { x, z }; }, update() {} }
  };
}

function city() {
  const nodes = [];
  const edges = [];
  for (let x = -80; x <= 80; x += 80) for (let z = -80; z <= 400; z += 80) nodes.push({ x, z });
  for (const a of nodes) for (const b of nodes) {
    if (Math.abs(a.x - b.x) + Math.abs(a.z - b.z) === 80) edges.push({ from: a, to: b });
  }
  return new RoadNavigator({ nodes, edges });
}

function setup(units, level = 0) {
  const camera = { position: new Vector3(0, 3, 0), getWorldDirection: (out) => out.set(0, 0, 1) };
  const target = { x: 0, z: 0, y: 0, vx: 0, vz: 0, alive: true, onFoot: true };
  const spawns = [];
  const wanted = Object.assign(Object.create(WantedSystem.prototype), {
    camera, units, flashers: [], strips: [], clock: 0, warm: 10, spawnT: 100, seenT: 0, escape: 0, heat: 0,
    level, zone: { x: 0, z: 0 }, nav: city(), searchVisits: new Map(), searchNodes: [],
    actors: { actors: spawns, spawn: (officer) => { spawns.push(officer); return officer; } },
    controllers: { nearColliders: () => [] }
  });
  return { wanted, target, spawns };
}

test('a cruiser close on the map needs line of sight and officers deploy only at street level', () => {
  const unit = makeCruiser(0, 10, Math.PI);
  const { wanted, target, spawns } = setup([unit], 5);
  target.y = 24;
  const roof = { minX: -6, maxX: 6, minZ: -6, maxZ: 6, maxY: 24 };
  wanted.controllers.nearColliders = () => [roof];
  wanted.update(0.1, target);
  assert.equal(wanted.seen, false);
  assert.ok(wanted.escape > 0);
  assert.equal(spawns.length, 0);

  wanted.controllers.nearColliders = () => [];
  target.y = 0;
  wanted.update(0.4, target);
  assert.equal(wanted.seen, true);
  assert.equal(spawns.length, 2);
  assert.ok(spawns.every((officer) => officer.team === 'police'));
});

test('gunfire and explosions order cruisers to a fixed incident and redirect them to a new street', () => {
  const u = makeCruiser(0, 100, Math.PI);
  const { wanted, target } = setup([u]);
  wanted.controllers.nearColliders = () => [{ minX: -120, maxX: 120, minZ: 65, maxZ: 75, maxY: 60 }];
  wanted.crime('explosion', 4, 21);
  wanted.update(0.1, target);
  assert.equal(wanted.level, 2);
  assert.equal(wanted.phase, 'dispatch');
  assert.equal(wanted.seen, false);
  assert.deepEqual(u.driver.goal, { x: 0, z: 21 });
  target.x = 60;
  wanted.update(0.3, target);
  assert.deepEqual(u.driver.goal, { x: 0, z: 21 });
  wanted.crime('shots', 77, 25);
  wanted.update(0.3, target);
  assert.deepEqual(u.driver.goal, { x: 80, z: 25 });
});

test('a cruiser heading up a street does not turn back to the nearest intersection to reach the same block', () => {
  const nav = city();
  const route = routing.policeRoute(nav, 2, 24, 4, 60);
  assert.ok(route.every((p) => p.z >= 60));
  assert.ok(routing.routeDistance(nav, { x: 2, z: 24 }, { x: 4, z: 60 }) < 42);
});

test('the closest cruiser pursues while a unit already ahead can intercept at a connected crossing', () => {
  const lead = makeCruiser(0, -20);
  const cut = makeCruiser(80, 160, -Math.PI / 2);
  const { wanted, target } = setup([lead, cut], 3);
  Object.assign(target, { z: 32, vz: 20, inVehicle: true, onFoot: false });
  wanted.seen = true;
  wanted.assignTactics([lead, cut], target, true);
  assert.equal(lead.flank, 0);
  assert.equal(lead.intercept, null);
  assert.ok(cut.intercept.block);
  assert.equal(cut.intercept.x, 0);
  assert.ok(cut.intercept.z > 100);
});

test('ten responding cars leave room for contact units and cover distinct approaches', () => {
  const units = Array.from({ length: 10 }, (_, i) => makeCruiser(i < 5 ? -80 : 80, i * 24 - 80));
  const { wanted, target } = setup(units, 5);
  Object.assign(target, { z: 40, vz: 8, inVehicle: true, onFoot: false });
  wanted.seen = true;
  wanted.assignTactics(units, target, true);
  const perimeter = units.map((u) => u.perimeter).filter(Boolean);
  assert.equal(perimeter.length, 7);
  assert.equal(new Set(perimeter).size, 7);
  assert.equal(wanted.levelInfo.units, 10);
});

test('a roadblock stays on the ground and its spikes cannot burst tyres on another level', () => {
  const u = makeCruiser(0, 80);
  const { wanted, target } = setup([u], 4);
  const mesh = { position: new Vector3(), rotation: {}, updateMatrixWorld() {} };
  wanted.strips = [{ mesh, life: 0 }];
  wanted.controllers.getGroundHeight = () => 5;
  u.intercept = { x: 0, z: 84, dx: 0, dz: 1 };
  let hits = 0;
  wanted.onStrip = () => hits++;
  wanted.setRoadblock(u);
  assert.equal(u.mode, 'block');
  assert.ok(mesh.visible);
  Object.assign(target, { x: 0, z: 75, y: 25, inVehicle: true });
  wanted.updateRoadblocks(0.1, target);
  assert.equal(hits, 0);
  target.y = 5;
  wanted.updateRoadblocks(0.1, target);
  assert.equal(hits, 1);
});

test('after losing sight the lead returns to the sighting and other cars get different road nodes', () => {
  const units = [makeCruiser(0, -32), makeCruiser(-80, 30), makeCruiser(80, 55)];
  const { wanted, target } = setup(units, 4);
  Object.assign(target, { z: 24, vz: 19, inVehicle: true, onFoot: false });
  wanted.update(0.1, target);
  assert.equal(wanted.phase, 'chase');
  wanted.controllers.nearColliders = () => [{ minX: -150, maxX: 150, minZ: 65, maxZ: 85, maxY: 80 }];
  Object.assign(target, { x: 17, z: 100 });
  wanted.update(0.4, target);
  assert.equal(wanted.phase, 'search');
  assert.equal(wanted.zone.z, 24);
  assert.ok(units.some((u) => u.order.x === 0 && u.order.z === 24));
  const sweeps = units.map((u) => u.order.node).filter((node) => node !== undefined);
  assert.equal(new Set(sweeps).size, 2);
  assert.ok(wanted.escape > 0);
});

test('an officer can arrest a player next to them but cannot reach a player on another floor', () => {
  let arrests = 0;
  const system = { step() {}, onArrest: () => arrests++ };
  const officer = {
    x: 0, y: 0, z: 0, weapon: 'pistol', alert: true, behavior: 'arrest', sightT: 1, cooldown: 0, flinch: 0, strafeT: 0, punchT: 0, reloadT: 0,
    rig: {}, model: { setWeapon() {} }
  };
  const target = { x: 0, y: 12, z: 1, alive: true, onFoot: true };
  ActorSystem.prototype.think.call(system, officer, 0.1, target, {});
  assert.equal(arrests, 0);
  target.y = 0;
  ActorSystem.prototype.think.call(system, officer, 0.1, target, {});
  assert.equal(arrests, 1);
});
