import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Vector3 } from '../vendor/three/build/three.core.js';
import { WEAPONS } from '../js/weapons.js';
import helpers from './helpers/module.cjs';

const source = (file) => readFileSync(new URL(`../js/${file}.js`, import.meta.url), 'utf8');
const { WantedSystem } = helpers.loadModule(source('wanted'), { imports: {
  'three/webgpu': { Vector3 }, 'three/addons/utils/BufferGeometryUtils.js': {},
  './cars.js': {}, './weapons.js': { lineOfSight: () => false }, './ai-driver.js': {}
} });
const { ActorSystem } = helpers.loadModule(source('actors'), { imports: {
  'three/webgpu': { Vector3 }, './pedestrians.js': {}, './characters.js': {}, './weapons.js': { WEAPONS }, './ragdoll.js': {}
} });

test('a cruiser close on the map spots and deploys near a pedestrian only at street level', () => {
  const camera = { position: new Vector3(0, 3, 0), getWorldDirection: (out) => out.set(0, 0, 1) };
  const target = { x: 0, z: 0, y: 24, vx: 0, vz: 0, alive: true, onFoot: true };
  const car = {
    position: new Vector3(0, 0, 10), mesh: { position: new Vector3(), rotation: {}, updateMatrixWorld() {} },
    heading: 0, speed: 0, drive: { speed: 30 }, body: {}
  };
  const unit = {
    active: true, mode: 'pursue', car, los: false, losT: 0, crew: [],
    driver: { setGoal() {}, update() {} }
  };
  const spawns = [];
  const wanted = Object.assign(Object.create(WantedSystem.prototype), {
    camera, units: [unit], flashers: [], strips: [], clock: 0, warm: 10, blockT: 0, spawnT: 10, seenT: 0, escape: 0,
    level: 5, zone: { x: 0, z: 0 }, nav: { within: () => [] },
    actors: { actors: [], spawn: (officer) => { spawns.push(officer); return officer; } },
    controllers: { entities: { person: { position: new Vector3() } } }
  });
  wanted.update(0.1, target);
  assert.equal(wanted.seen, false);
  assert.ok(wanted.escape > 0);
  assert.equal(spawns.length, 0);

  target.y = car.position.y;
  wanted.update(0.1, target);
  assert.equal(wanted.seen, true);
  assert.equal(spawns.length, 2);
  assert.ok(spawns.every((officer) => officer.team === 'police'));
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
