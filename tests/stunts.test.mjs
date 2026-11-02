import test from 'node:test';
import assert from 'node:assert/strict';
import { StuntScore } from '../js/stunts.js';

function scene() {
  const awards = [];
  const car = { position: { x: 0, z: 0 }, heading: 0, speed: 30, vx: 0, vz: 0, halfW: 0.9, nitro: 0.2, body: { vx: 0, vz: 30, vy: 0, airborne: 0, grounded: 4, r: [1, 0, 0, 0, 1, 0, 0, 0, 1] } };
  const traffic = { x: 2.4, z: 3, speed: 5, edge: {}, halfWidth: 0.9, yaw: 0 };
  const game = { car, state: 'driving', traffic: { vehicles: [traffic] }, addMoney() {}, audio: {}, hud: { stunt: (...a) => awards.push(a) } };
  return { game, car, traffic, awards, score: new StuntScore(game) };
}

test('passing a car close at speed counts, and tops up the nitro', () => {
  const { score, traffic, awards, car } = scene();
  score.update(1 / 60);
  traffic.z = -1;
  score.update(1 / 60);
  assert.equal(awards.length, 1);
  assert.equal(awards[0][0], 'FRÔLEMENT');
  assert.ok(car.nitro > 0.25);
});

test('passing wide, or just after a crash, does not', () => {
  const wide = scene();
  wide.traffic.x = 5;
  wide.score.update(1 / 60); wide.traffic.z = -1; wide.score.update(1 / 60);
  assert.equal(wide.awards.length, 0);
  const hit = scene();
  hit.score.update(1 / 60); hit.score.crashed(); hit.traffic.z = -1; hit.score.update(1 / 60);
  assert.equal(hit.awards.length, 0);
});

test('a long slide pays when it ends, a jump when it lands, and they chain', () => {
  const { score, car, game, awards } = scene();
  game.traffic.vehicles = [];
  car.vx = 7; car.speed = 18; car.body.vx = 7; car.body.vz = 18;
  for (let i = 0; i < 120; i++) score.update(1 / 60);
  car.vx = 0; car.speed = 25; car.body.vx = 0; car.body.vz = 25;
  for (let i = 0; i < 40; i++) score.update(1 / 60);
  assert.equal(awards[0][0], 'DÉRAPAGE');
  car.body.airborne = 1;
  for (let i = 0; i < 70; i++) score.update(1 / 60);
  car.body.airborne = 0;
  score.update(1 / 60);
  assert.equal(awards[1][0], 'SAUT');
  assert.equal(awards[1][3], 2);
});
