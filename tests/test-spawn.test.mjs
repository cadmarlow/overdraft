import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SALT_ROUTES } from '../js/wasteland-plan.js';
import { closePoint } from '../js/morningside-plan.js';
import { urbanArrivals } from '../js/urban-places-plan.js';
import { manhattanArrivals } from '../js/manhattan-sites-plan.js';
const LOCAL_ARRIVALS = { ...urbanArrivals, ...manhattanArrivals };
const [{ x, z }] = SALT_ROUTES.find(line => line.id === 'deversoir').path;
const heading = Math.PI / 2;

const source = readFileSync(new URL('../js/gameplay.js', import.meta.url), 'utf8');
const method = name => source.match(new RegExp(`  ${name}\\(\\) \\{[\\s\\S]*?\\n  \\}`))[0];
function harness(hostname, search) {
  const calls = [], location = { hostname, search };
  const methods = vm.runInNewContext(`(class { ${method('applyTestSpawn')} ${method('save')} }).prototype`, { location, URLSearchParams, SALT_ROUTES, closePoint, LOCAL_ARRIVALS });
  const game = {
    person: { position: { copy: p => calls.push(['person', p.x, p.z]) } }, car: { position: { x, z } },
    camera: { resetForTeleport: () => calls.push(['camera']) },
    teleportPlayer: (x, z) => calls.push(['player', x, z]),
    garage: { summon: kind => { calls.push(['car', kind]); assert.equal(game.testSpawn, true, 'disable saves before boarding'); } },
    controllers: { teleportActiveTo: (...args) => calls.push(['arrival', ...args]) },
    atmosphere: { setHour: h => calls.push(['hour', h]), setWeather: (...args) => calls.push(['weather', ...args]) },
    ...Object.fromEntries(['applyTestSpawn', 'save'].map(name => [name, methods[name]]))
  };
  return { game, calls };
}

test('the previous FDR test link starts the Ressac on the Déversoir approach at noon', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const { game, calls } = harness(host, '?spawn=fdr');
    game.applyTestSpawn();
    assert.deepEqual(calls, [['player', x - 12, z + 12], ['car', 'hatch'], ['arrival', x, z, heading],
      ['person', x, z], ['camera'], ['hour', 12], ['weather', 'clear', true]]);
    assert.equal(game.person.heading, heading);
    assert.equal(game.atmosphere.running, false);
    assert.equal(game.atmosphere.lockWeather, true);
    assert.equal(game.save(), false, 'test driving and pausing do not overwrite the regular save');
  }
});

test('the Morningside test link starts on foot at the open garden entrance without saving', () => {
  const { game, calls } = harness('localhost', '?spawn=morningside');
  const { x, z } = closePoint(11.3, 2.4);
  game.applyTestSpawn();
  assert.deepEqual(calls, [['player', x, z], ['hour', 14], ['weather', 'clear', true]]);
  assert.equal(game.person.heading, Math.PI / 2);
  assert.equal(game.save(), false);
});

test('normal games and published sites do not apply the local test spawn', () => {
  for (const [host, search] of [['localhost', ''], ['localhost', '?spawn=other'], ['overdraft.vercel.app', '?spawn=fdr'], ['overdraft.vercel.app', '?spawn=morningside']]) {
    const { game, calls } = harness(host, search);
    game.applyTestSpawn();
    assert.equal(game.testSpawn, undefined);
    assert.deepEqual(calls, []);
  }
});

test('the authored neighbourhood visits start on foot, facing the public paths', () => {
  for (const [name, arrival] of Object.entries(LOCAL_ARRIVALS)) {
    const { game, calls } = harness('localhost', '?spawn=' + name);
    game.applyTestSpawn();
    assert.deepEqual(calls, [['player', arrival.x, arrival.z], ['hour', 14], ['weather', 'clear', true]]);
    assert.equal(game.person.heading, arrival.heading);
    assert.equal(game.testSpawnSite, name);
    assert.equal(game.save(), false);
    const hosted = harness('overdraft.vercel.app', '?spawn=' + name);
    hosted.game.applyTestSpawn();
    assert.deepEqual(hosted.calls, []);
  }
});
