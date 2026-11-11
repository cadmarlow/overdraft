import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { highwayX, highwayScale } from '../js/highway-layout.js';
const z = 1020, x = highwayX(false, z) + 5.55 * highwayScale(false, z);
const heading = Math.atan2(highwayX(false, z - 3) - highwayX(false, z + 3), -6);

const source = readFileSync(new URL('../js/gameplay.js', import.meta.url), 'utf8');
const method = name => source.match(new RegExp(`  ${name}\\(\\) \\{[\\s\\S]*?\\n  \\}`))[0];
function harness(hostname, search) {
  const calls = [], location = { hostname, search };
  const methods = vm.runInNewContext(`(class { ${method('applyTestSpawn')} ${method('save')} }).prototype`, { location, URLSearchParams, highwayX, highwayScale });
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

test('the FDR test link starts the Ressac at the verified approach, aligned with the corrected road at noon', () => {
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

test('normal games and published sites do not apply the local test spawn', () => {
  for (const [host, search] of [['localhost', ''], ['localhost', '?spawn=other'], ['overdraft.vercel.app', '?spawn=fdr']]) {
    const { game, calls } = harness(host, search);
    game.applyTestSpawn();
    assert.equal(game.testSpawn, undefined);
    assert.deepEqual(calls, []);
  }
});
