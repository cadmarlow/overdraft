import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as frontier from '../js/frontier-districts.js';
import * as plan from '../js/wasteland-plan.js';
import { loadModule } from './helpers/module.cjs';

const { WastelandEncounter } = loadModule(readFileSync(new URL('../js/wasteland-encounter.js', import.meta.url), 'utf8'), {
  imports: {
    'three/webgpu': {}, './ai-driver.js': {}, './car-physics.js': {}, './wasteland-convoy.js': {},
    './frontier-districts.js': frontier, './wasteland-plan.js': plan
  },
  filename: 'wasteland-encounter.js'
});

function encounterNearDeversoir() {
  const x = 1236, z = -1814;
  const player = { x, y: plan.sampleSalt(x, z), z, speed: 1.6, alive: true, inVehicle: false };
  const scout = { active: false, car: { mesh: { visible: false } } };
  const dust = [];
  const encounter = Object.assign(Object.create(WastelandEncounter.prototype), {
    game: { director: {}, toast() {}, fx: { smokeParticle: (...args) => dust.push(args) } },
    cable: { visible: false }, units: [scout], convoy: { units: [], update() {} },
    phase: 'calme', wait: 8, dust: 0,
    deploy(unit) { assert.equal(unit, scout); return true; }
  });
  assert.ok(frontier.frontierDistance(x, z) > 170 && plan.saltLandAt(x, z));
  return { encounter, player, dust };
}

test('a player walking beyond the frontier can keep walking after the scout timer expires', () => {
  const { encounter, player } = encounterNearDeversoir();
  for (let i = 0; i < 540; i++) encounter.update(1 / 60, player);
  assert.equal(encounter.entered, true);
  assert.ok(encounter.wait <= 0);
  assert.equal(encounter.phase, 'calme');

  player.speed = 3.4;
  encounter.update(1 / 60, player);
  assert.equal(encounter.zone.name, 'Le Déversoir');
  assert.equal(encounter.phase, 'observation');
});

test('driving off the road beyond the frontier emits dust before the scout arrives', () => {
  const { encounter, player, dust } = encounterNearDeversoir();
  Object.assign(player, { inVehicle: true, speed: 8 });
  encounter.game.car = { body: {}, mesh: { visible: true }, speed: player.speed, heading: 0, position: player };

  encounter.update(1 / 60, player);

  assert.equal(encounter.phase, 'calme');
  assert.equal(dust.length, 1);
  assert.equal(dust[0][0], player.x);
  assert.equal(dust[0][2], player.z - 2.7);
});
