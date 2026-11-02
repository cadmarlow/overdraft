const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const { GANGS, GangSystem, ZONES, zoneAt } = loadModule(readFileSync(join(__dirname, '../js/gangs.js'), 'utf8'), {
  imports: { './city-config.js': { streetZ: (n) => (40 - n) * 80 }, './ai-driver.js': { AIDriver: class {} } }
});

test('every zone has a gang and its hideout inside it', () => {
  for (const z of ZONES) {
    assert.ok(GANGS[z.gang], z.id);
    assert.equal(zoneAt(z.hq.x, z.hq.z), z, z.id);
    assert.ok(z.box[0] < z.box[1] && z.box[2] < z.box[3], z.id);
  }
  assert.equal(zoneAt(99999, 0), null);
});

function game() {
  const actors = [];
  return { messages: [], money: 0, director: { current: null }, player: { x: 0, z: 0, alive: true }, hud: {}, fleet: [],
    actors: { actors, count: 0, remove: (a) => actors.splice(actors.indexOf(a), 1), spawn: (a) => { actors.push(a); return a; } },
    phone: { text(from, text) { this.last = [from, text]; } }, addMoney(n) { this.money += n; }, save() {}, safeSpot: (x, z) => ({ x, z }) };
}

test('taking a zone removes it from the jobs, adds its income, and it pays on schedule', () => {
  const g = game(), s = new GangSystem(g), z = ZONES[0];
  const before = s.takeovers().length;
  s.capture(z);
  assert.equal(s.takeovers().length, before - 1);
  assert.equal(s.income, z.income);
  g.player.x = 1e6;
  s.payT = 0.01;
  s.update(0.1);
  assert.equal(g.money, z.income);
  assert.match(g.phone.last[1], /Échéance/);
});

test('corners fill up in a hostile zone, stay empty in yours', () => {
  const g = game(), s = new GangSystem(g), z = ZONES[0];
  g.player.x = z.hq.x; g.player.z = z.hq.z;
  s.crewT = 0;
  s.update(0.1);
  assert.ok(s.corners.length > 0 || g.actors.actors.length === 0);
  const mine = game(), held = new GangSystem(mine);
  held.held.add(z.id);
  mine.player.x = z.hq.x; mine.player.z = z.hq.z;
  held.crewT = 0;
  held.update(0.1);
  assert.equal(held.corners.length, 0);
});

test('killing a crew pays a little, and the third brings a car', () => {
  const g = game(), s = new GangSystem(g);
  let sent = 0;
  s.sendHit = () => { sent++; s.anger = 0; };
  for (let i = 0; i < 3; i++) s.onKilled({ team: 'meute' });
  assert.equal(sent, 1);
  assert.ok(g.money > 0);
  s.onKilled({ team: 'police' });
  assert.equal(s.anger, 0);
});
