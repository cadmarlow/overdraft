const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = (name) => readFileSync(join(__dirname, '../js', name), 'utf8');
const repro = loadModule(source('repro-link.js'), { globals: { URL, URLSearchParams } });

function senses({ state = 'onFoot', ground = 0.15, y = 0.15 } = {}) {
  let now = 1000;
  const listeners = {};
  const consoleStub = { error() {} };
  const globals = {
    URL, URLSearchParams, Date, JSON, Number, Math,
    console: consoleStub,
    performance: { now: () => now },
    location: { href: 'http://localhost:5173/?qa=1&stats=1' },
    document: { visibilityState: 'visible' },
    window: { addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; } }
  };
  const { ArchitectSenses } = loadModule(source('architect-senses.js'), {
    globals,
    imports: { './city-config.js': { getLocationLabel: (x, z) => `${Math.round(x)} & ${Math.round(z)}` }, './repro-link.js': repro }
  });
  const game = {
    clock: 0, active: true, state,
    person: { position: { x: 10, y, z: 20 }, suspended: false },
    car: { position: { x: 0, y: 0, z: 0 } },
    camera: { footYaw: 0.5, orbitPitchOffset: 0.1, camera: { position: { x: 0, y: 3, z: 0 } } },
    atmosphere: { hour: 13, weather: 'rain' },
    controllers: { getGroundHeight: () => ground }
  };
  const s = new ArchitectSenses(game, () => ({ x: 10, y: 0.15, z: 20 }));
  return { s, game, consoleStub, listeners, tick: (ms) => { now += ms; } };
}

test('a reproduction link round-trips position, view, hour and weather', () => {
  const link = repro.buildReproLink({ x: -581.234, y: 0.18, z: -324.06, yaw: 1.2345, pitch: -0.1, hour: 25.5, weather: 'rain' }, 'http://localhost:5173/?stats=1#x');
  assert.match(link, /^http:\/\/localhost:5173\/\?qa=1&at=-581\.2,0\.2,-324\.1,1\.23,-0\.1&heure=1\.5&meteo=rain$/);
  const view = repro.parseRepro(new URL(link).search);
  assert.deepEqual({ ...view }, { x: -581.2, y: 0.2, z: -324.1, yaw: 1.23, pitch: -0.1, hour: 1.5, weather: 'rain' });
});

test('a link without a place, or with a broken one, asks for nothing; an unknown weather is dropped', () => {
  assert.equal(repro.parseRepro('?qa=1'), null);
  assert.equal(repro.parseRepro('?at=1,2'), null);
  assert.equal(repro.parseRepro('?at=a,b,c'), null);
  const view = repro.parseRepro('?at=1,2,3&meteo=snow');
  assert.equal(view.weather, null);
  assert.equal(view.hour, null);
  assert.equal(view.yaw, 0);
});

test('the same fault in the same spot counts up; elsewhere it is a new event', () => {
  const { s, game } = senses();
  assert.equal(s.report('coince', { who: 'architecte' }), null, 'nothing is logged before start');
  s.start();
  const first = s.report('coince', { who: 'architecte', x: 0, y: 0, z: 0, detail: 'a' });
  game.clock = 10;
  const again = s.report('coince', { who: 'architecte', x: 12, y: 0, z: 5, detail: 'b' });
  assert.equal(again, first);
  assert.equal(first.count, 2);
  assert.equal(first.detail, 'b');
  const elsewhere = s.report('coince', { who: 'architecte', x: 200, y: 0, z: 0 });
  assert.notEqual(elsewhere, first);
  game.clock = 200;
  assert.notEqual(s.report('coince', { who: 'architecte', x: 0, y: 0, z: 0 }), first, 'a minute and a half later it is news again');
  assert.equal(s.events.length, 3);
  assert.match(first.link, /at=0,0,0,0\.5,0\.1&heure=13&meteo=rain$/);
  assert.equal(first.address, '0 & 0');
});

test('an event with no place of its own happens where the watched body is', () => {
  const { s } = senses();
  s.start();
  const e = s.report('saccade', { who: 'jeu' });
  assert.deepEqual([e.x, e.y, e.z], [10, 0.15, 20]);
});

test('a player under the ground for a few tenths of a second is reported once', () => {
  const { s, game } = senses({ ground: 0.15, y: -0.2 });
  s.start();
  for (let i = 0; i < 10; i++) s.update(0.05);
  const sunk = s.events.filter((e) => e.kind === 'enfonce');
  assert.equal(sunk.length, 1);
  assert.equal(sunk[0].who, 'joueur');
  game.person.position.y = 0.15;
  s.update(0.05);
  assert.equal(s.sinkT.has('joueur'), false);
});

test('a long frame is a stall; a NaN body is reported', () => {
  const { s, tick } = senses();
  s.start();
  s.update(0.016);
  tick(16); s.update(0.016);
  assert.equal(s.events.length, 0);
  tick(240); s.update(0.05);
  assert.equal(s.events[0].kind, 'saccade');
  assert.match(s.events[0].detail, /240 ms/);
  s.update(0.016, [{ who: 'architecte', x: NaN, y: 0, z: 0 }]);
  assert.ok(s.events.some((e) => e.kind === 'nan' && e.who === 'architecte'));
});

test('script errors and console errors are caught while active, and only then', () => {
  const { s, consoleStub, listeners } = senses();
  const original = consoleStub.error;
  s.start();
  assert.ok(listeners.error && listeners.unhandledrejection);
  consoleStub.error('boom', 42);
  consoleStub.error('boom again');
  listeners.error({ error: new Error('kaput') });
  const errors = s.events.filter((e) => e.kind === 'erreur');
  assert.equal(JSON.stringify(errors.map((e) => [e.who, e.count])), JSON.stringify([['console', 2], ['jeu', 1]]));
  assert.match(errors[1].detail, /^Error: kaput/);
  s.stop();
  assert.equal(consoleStub.error, original);
  assert.equal(listeners.error, undefined);
});

test('the Architect stays out of the game online: no static import, no preload, left out of the build, gated in main.js', () => {
  const { readdirSync } = require('node:fs');
  const root = join(__dirname, '..');
  assert.doesNotMatch(readFileSync(join(root, 'index.html'), 'utf8'), /architect|repro-link/i, 'index.html neither preloads nor links him');
  const devOnly = (name) => /^(architect[\w-]*|repro-link)\.js$/.test(name);
  for (const name of readdirSync(join(root, 'js')).filter((n) => n.endsWith('.js') && !devOnly(n))) {
    const code = readFileSync(join(root, 'js', name), 'utf8');
    assert.doesNotMatch(code, /(?:\bfrom\s*|\bimport\s*)['"]\.\/(architect[\w-]*|repro-link)\.js['"]/, `${name} imports him statically`);
  }
  const main = readFileSync(join(root, 'js/main.js'), 'utf8');
  assert.match(main, /if \(architectAllowed\(\)\) \{\s*try \{\s*const \{ ArchitectSystem \} = await import\('\.\/architect\.js'\);/, 'loaded on demand, behind the local-only gate');
  const build = readFileSync(join(root, 'scripts/build.mjs'), 'utf8');
  const pattern = /const DEV_ONLY = \/(.+)\/;/.exec(build);
  assert.ok(pattern, 'the build names the files it leaves out');
  const left = new RegExp(pattern[1]);
  for (const file of ['js/architect.js', 'js/architect-senses.js', 'js/architect-panel.js', 'js/repro-link.js', 'css/architect.css']) assert.ok(left.test(`/repo/${file}`), file);
  for (const file of ['js/actors.js', 'js/arsenal.js', 'js/main.js', 'css/hud.css', 'assets/people/architect.webp']) assert.ok(!left.test(`/repo/${file}`), file);
});
