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
  assert.deepEqual({ ...view }, { x: -581.2, y: 0.2, z: -324.1, yaw: 1.23, pitch: -0.1, hour: 1.5, weather: 'rain', eye: null });
});

test('a photo from his own eye carries the eye’s exact pose in its link', () => {
  const link = repro.buildReproLink({ x: 10, y: 0.15, z: 20, yaw: 0.5, eye: { x: 10.3, y: 1.83, z: 20.2, yaw: 0.5123, pitch: 0.5, fov: 25 } }, 'http://localhost:5173/');
  assert.match(link, /&oeil=10\.3,1\.8,20\.2,0\.512,0\.5,25$/);
  assert.deepEqual({ ...repro.parseRepro(new URL(link).search).eye }, { x: 10.3, y: 1.8, z: 20.2, yaw: 0.512, pitch: 0.5, fov: 25 });
  assert.equal(repro.parseRepro('?at=1,2,3&oeil=1,2').eye, null, 'a broken pose is dropped');
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
  for (const file of ['js/architect.js', 'js/architect-senses.js', 'js/architect-panel.js', 'js/architect-eye.js', 'js/architect-retro.js', 'js/architect-lab.js', 'js/repro-link.js', 'css/architect.css']) assert.ok(left.test(`/repo/${file}`), file);
  // his eye and his body reach main.js through optional calls only
  assert.match(main, /gameplay\.architect\?\.beforeRender\(/);
  assert.match(main, /gameplay\.architect\?\.attach\(/);
  for (const file of ['js/actors.js', 'js/arsenal.js', 'js/main.js', 'css/hud.css', 'assets/people/architect.webp']) assert.ok(!left.test(`/repo/${file}`), file);
});

// ---- His rear-view mirror, his experiments and his eye ------------------------------------------------------------
const retroModule = () => loadModule(source('architect-retro.js'), { globals: { Math, Map, Promise, setTimeout } });

// A car body's axes (car-physics.js: the columns of body.r) for a pitch about its own X axis
function pitchedBody(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { r: [1, 0, 0, 0, c, s, 0, -s, c] };
}

test('a car body’s attitude reads pitch, roll and tilt from its axes', () => {
  const { attitude } = retroModule();
  const level = attitude({ body: pitchedBody(0) });
  assert.equal(Math.round(level.tilt * 100), 0);
  const reared = attitude({ body: { r: [1, 0, 0, 0, 0, 1, 0, 1, 0] } }); // nose straight up
  assert.equal(Math.round(reared.pitch * 180 / Math.PI), 90);
  assert.equal(Math.round(reared.tilt * 180 / Math.PI), 90);
  assert.equal(attitude({}), null, 'a bike without a body has no attitude');
});

test('a car tipped past 60 degrees for over half a second is reported once, then not again for 20 s', () => {
  const { ArchitectRetro } = retroModule();
  const reports = [];
  const car = { kind: 'taxi', mesh: { visible: true }, body: pitchedBody(1.3), position: { x: 5, y: 1.2, z: 5 }, speed: 0 };
  const game = { clock: 0, allCars: [car], camera: { camera: { position: { x: 0, y: 2, z: 0 } } }, state: 'onFoot', car: null };
  const architect = { game, present: true, car: {}, senses: { report: (kind, e) => reports.push({ kind, ...e }) } };
  const r = new ArchitectRetro(architect);
  for (let i = 0; i < 2; i++) { game.clock += 0.2; r.scanCars(0.2); }
  assert.equal(reports.length, 0, 'not yet: 0.4 s');
  for (let i = 0; i < 3; i++) { game.clock += 0.2; r.scanCars(0.2); }
  assert.equal(reports.length, 1);
  assert.equal(reports[0].kind, 'retournement');
  assert.match(reports[0].detail, /inclinée à 74°/);
  for (let i = 0; i < 20; i++) { game.clock += 0.2; r.scanCars(0.2); }
  assert.equal(reports.length, 1, 'once per car per 20 s');
  car.body = pitchedBody(0);
  r.scanCars(0.2);
  assert.equal(r.tipped.has(car), false, 'back on its wheels: the watch resets');
});

test('the kerb search finds the nearest edge of the sidewalk and its direction', () => {
  const THREE = { Vector3: class { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } } };
  const { ArchitectLab } = loadModule(source('architect-lab.js'), {
    globals: { Math, Map, Set, Promise, document: {}, Image: class {} },
    imports: { 'three/webgpu': THREE, './car-physics.js': { settleBody() {} }, './architect-retro.js': retroModule() }
  });
  // the sidewalk is everything east of x = 5
  const game = { controllers: { isPointOnSidewalk: (x) => x > 5 } };
  const lab = new ArchitectLab({ game });
  const edge = lab.findKerb(0, 0);
  assert.ok(Math.abs(edge.x - 5.5) < 0.6, `edge at ${edge.x}`);
  assert.deepEqual([Math.round(edge.nx), Math.round(edge.nz)], [1, 0], 'its inside is the sidewalk');
  assert.deepEqual([Math.round(Math.abs(edge.ux)), Math.round(Math.abs(edge.uz))], [0, 1], 'it runs along z');
});

test('his eye stands in front of his head and looks where he asks', () => {
  class V3 { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } }
  const THREE = { Vector3: V3, Vector2: V3, Raycaster: class {} };
  const { ArchitectEye } = loadModule(source('architect-eye.js'), { globals: { Math, Set, Promise, setTimeout, performance: { now: () => 0 } }, imports: { 'three/webgpu': THREE } });
  const game = { camera: { footYaw: 0, camera: { position: { x: 0, y: 2, z: 0 } } }, player: { x: 0, z: 50 } };
  const architect = { game, ride: null, heli: {}, actor: { heading: 0 }, focus: () => ({ x: 0, y: 0.15, z: 0 }) };
  const eye = new ArchitectEye(architect);
  const ahead = eye.pose({ direction: 'devant', cadrage: 'rue' });
  assert.ok(ahead.z > 0.3 && Math.abs(ahead.x) < 1e-9, 'a step in front of his face');
  assert.ok(Math.abs(ahead.y - 1.83) < 1e-9, 'at head height');
  assert.equal(ahead.fov, 55);
  const left = eye.pose({ direction: 'gauche', cadrage: 'haut', zoom: 'serre' });
  assert.ok(Math.abs(left.yaw - Math.PI / 2) < 1e-9);
  assert.ok(left.pitch > 0.4, 'looking up at the tops of the buildings');
  assert.equal(left.fov, 25);
  const down = eye.pose({ direction: 'devant', cadrage: 'sol' });
  assert.ok(down.pitch < -0.6 && down.z < 0, 'a step back to look down at his feet');
  const point = eye.pose({ direction: 'vers_point', x: 10, y: 11.83, z: 0 });
  assert.ok(Math.abs(point.yaw - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(point.pitch - Math.PI / 4) < 0.05, 'aimed at the point, up and to the side');
  assert.match(eye.detailNote({ x: 400, z: 0 }), /400 m de la caméra du joueur/);
  assert.equal(eye.detailNote({ x: 30, z: 0 }), '');
});
