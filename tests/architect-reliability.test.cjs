const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = (name) => readFileSync(join(__dirname, '../js', name), 'utf8');
let THREE;
test.before(async () => { THREE = await import('../vendor/three/build/three.core.js'); });

function modules(extra = {}) {
  const globals = {
    Math, Map, Set, Promise, AbortController, setTimeout, clearTimeout, URL, URLSearchParams,
    performance, Image: class { decode() { return new Promise(() => {}); } },
    window: { addEventListener() {}, removeEventListener() {} }, document: {}, location: { search: '' }, ...extra
  };
  const retro = loadModule(source('architect-retro.js'), { globals });
  const eye = loadModule(source('architect-eye.js'), { globals, imports: { 'three/webgpu': THREE } });
  const lab = loadModule(source('architect-lab.js'), { globals, imports: { 'three/webgpu': THREE, './architect-retro.js': retro, './car-physics.js': { settleBody() {} } } });
  const repro = loadModule(source('repro-link.js'), { globals });
  const link = loadModule(source('architect-link.js'), { globals, imports: { './repro-link.js': repro } });
  const bodySource = source('architect.js');
  const imports = Object.fromEntries([...bodySource.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => [m[1], {}]));
  Object.assign(imports, {
    'three/webgpu': THREE, './architect-eye.js': eye, './architect-retro.js': retro, './architect-lab.js': lab,
    './repro-link.js': repro, './city-config.js': { TELEPORT_LOCATIONS: {}, NYC_LANDMARKS: [], getLocationLabel: () => '' }
  });
  const body = loadModule(bodySource, { globals, imports });
  return { ...retro, ...eye, ...lab, ...body, ...repro, ...link, globals };
}

function isolatedModule(name, globals, supplied = {}) {
  const code = source(name);
  const imports = Object.fromEntries([...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => [m[1], {}]));
  return loadModule(code, { globals, imports: { ...imports, 'three/webgpu': THREE, ...supplied } });
}

function realAtmosphere(game, globals) {
  const lighting = isolatedModule('lighting.js', globals);
  const grading = isolatedModule('post-processing.js', globals);
  const { Atmosphere } = isolatedModule('atmosphere.js', globals, { './lighting.js': lighting, './post-processing.js': grading });
  class WithoutRenderer extends Atmosphere {
    buildRain() {
      this.uCam = { value: new THREE.Vector3() }; this.uTint = { value: new THREE.Color() }; this.uAlpha = { value: 0 };
      this.rainMesh = { count: 0, visible: false };
    }
  }
  const applied = {};
  const atmosphere = new WithoutRenderer({
    controllers: game.controllers, camera: game.camera.camera, scene: {},
    lighting: { applyParams(p) { applied.sun = p.sunDir.clone(); applied.night = p.nightFactor; applied.wetness = p.roadWetness; } },
    grade: { applyLook(look) { applied.exposure = look.exposure; } }
  });
  return { atmosphere, applied };
}

function fixture(extra) {
  const m = modules(extra);
  const a = Object.create(m.ArchitectSystem.prototype);
  const atmosphere = {
    hour: 17, weather: 'clear', running: true, lockWeather: false, wet: 0.1, cloud: 0.2, rain: 0, storm: 0, nextWeather: 25,
    setHour(hour) { this.hour = hour; }, setWeather(weather) { this.weather = weather; this.wet = weather === 'rain' ? 1 : 0; }
  };
  const cars = [], removed = [], blasts = [];
  const game = {
    atmosphere, buildVersion: '0.9.4', weatherMode: 'auto', clock: 0, player: { x: 0, z: 0 }, fleet: [],
    camera: { camera: new THREE.PerspectiveCamera(), footYaw: 0, orbitPitchOffset: 0, resetForTeleport() {} },
    controllers: { getGroundHeight: () => 0, createCarEntity({ kind }) {
      const car = { kind, position: new THREE.Vector3(), speed: 0, vx: 0, vz: 0, body: { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], vy: 0 }, mesh: new THREE.Group(), hp: 100 };
      cars.push(car); return car;
    } }, actors: { actors: [], remove() {} },
    makeCar() { throw new Error('ordinary fleet recycling must not run'); },
    removeFleetCar(car) { removed.push(car); const i = this.fleet.indexOf(car); if (i >= 0) this.fleet.splice(i, 1); },
    explode(...args) { blasts.push(args); },
    person: { position: new THREE.Vector3(), rig: { reset() {} } },
    teleportPlayer() {}, toast() {}
  };
  Object.assign(a, {
    game, spectating: true, present: true, actor: { heading: 0 }, order: null, trip: null, fight: null, grudge: 0,
    captures: [], frameTimes: [], performanceProbes: new Set(), move: {}, car: {}, heli: {}, watch: {}, tag: {},
    senses: { quiet() {}, stop() {} }, addressAt: () => 'Rue de test', focus: () => ({ x: 0, y: 0, z: 0 }),
    teleportSelf() {}, leaveRide() {}, stow() {}, stopTicker() {}, refreshButton() {}, say() {}, emit() {}, follow() {}
  });
  a.eye = new m.ArchitectEye(a);
  a.retro = new m.ArchitectRetro(a);
  a.lab = new m.ArchitectLab(a);
  return { a, game, cars, removed, blasts, m };
}

function navigationFixture() {
  const f = fixture(), { a, game, m } = f;
  const physics = isolatedModule('car-physics.js', m.globals);
  const driving = isolatedModule('ai-driver.js', m.globals);
  const { ActorSystem } = isolatedModule('actors.js', m.globals);
  const { ArchitectSystem } = isolatedModule('architect.js', m.globals, {
    './ai-driver.js': driving, './car-physics.js': physics, './drive-fx.js': { repairBody() {} },
    './city-config.js': { TELEPORT_LOCATIONS: { timessq: { x: 300, z: 0 }, empire: { x: 1200, z: 0 }, centralpark: { x: 3500, z: 0 } }, NYC_LANDMARKS: [], getLocationLabel: () => '' }
  });
  Object.setPrototypeOf(a, ArchitectSystem.prototype);
  for (const name of ['focus', 'leaveRide', 'stow', 'follow', 'teleportSelf']) delete a[name];
  Object.assign(a.actor, { x: 0, y: 0, z: 0, vx: 0, vz: 0, speed: 0, hp: 120, armor: 60, rig: { reset() {} }, model: { update() {}, setWeapon() {} } });
  game.actors.actors.push(a.actor);
  Object.assign(game, {
    stats: { shots: 0 }, allCars: [], traffic: { vehicles: [], network: { edges: [] } },
    safeSpot: (x, z) => ({ x, z }), hud: { say() {} },
    park(vehicle) { vehicle.position.set(20000, -100, 20000); vehicle.mesh.position.copy(vehicle.position); },
    nav: { nodes: [], nearest: () => -1, route: (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z1 }] }
  });
  game.controllers.resolveHorizontalCollision = () => {};
  game.controllers.roofHeight = () => 0;
  a.senses.report = () => {};
  const actorPhysics = { controllers: game.controllers, pos: { x: 0, y: 0, z: 0 } };
  game.actors.step = (...args) => ActorSystem.prototype.step.call(actorPhysics, ...args);
  const tune = physics.makeTune('sedan', { halfW: 0.92, halfL: 2.3, height: 1.42, wheelX: 0.8, wheelZf: 1.42, wheelZr: -1.42, wheelRadius: 0.34 });
  a.car = { kind: 'sedan', tune, body: physics.createBody(tune), position: new THREE.Vector3(), mesh: new THREE.Group(), heading: 0, speed: 0, vx: 0, vz: 0, angularVel: 0 };
  a.heli = { kind: 'helicopter', position: new THREE.Vector3(0, -100, 0), mesh: new THREE.Group(), tiltPivot: new THREE.Group(), mainRotorPivot: new THREE.Group(), tailRotorPivot: new THREE.Group(), heading: 0, speed: 0, verticalSpeed: 0, pitchAngle: 0, rollAngle: 0, hp: 100 };
  a.heli.mesh.visible = false;
  game.controllers.simulateCar = (car, throttle, steer, handbrake, dt) => physics.stepCar(car, { throttle, steer, handbrake }, dt, {
    grip: 1, ground(_x, _z, hit) { Object.assign(hit, { y: 0, nx: 0, ny: 1, nz: 0, grip: 1, rough: 0, curb: false }); }
  });
  a.link = Object.assign(Object.create(m.ArchitectLink.prototype), { architect: a, game });
  function step(dt = 1 / 60) {
    game.clock += dt;
    if (a.trip) a.tripFrame(dt); else a.idleFrame(dt);
    if (!a.ride) a.pilot(a.actor, dt);
  }
  return { ...f, step };
}

const road = { x0: 0, z0: 0, x1: 0, z1: 100 };
async function pump(lab, count) {
  for (let i = 0; i < count; i++) {
    lab.frame(0.1);
    for (let k = 0; k < 8; k++) await Promise.resolve();
  }
}

test('performance measurements still collect new frames when the history is full', async () => {
  let now = 1000, a;
  const m = modules({ performance: { now: () => now }, setTimeout(fn) {
    for (let i = 0; i < 20; i++) { now += 1000 / 60; a.update(1 / 60); }
    fn(); return 1;
  } });
  a = Object.create(m.ArchitectSystem.prototype);
  Object.assign(a, {
    game: { playing: false, frames: 10 }, present: true, actor: null, lastFrameAt: now,
    frameTimes: Array.from({ length: 600 }, () => ({ at: 0, ms: 100 })), performanceProbes: new Set(),
    resumeFrame() {}, link: { frameTick() {} }, lab: { frame() {} }, spin() {}, senses: { update() {} },
    bodies: () => [], retro: { update() {} }, updateTag() {}, focus: () => ({ x: 0, z: 0 }), addressAt: () => 'Test'
  });
  const r = await a.measurePerformance(2);
  assert.equal(r.ok, true);
  assert.match(r.texte, /60 images par seconde/);
  assert.equal(a.frameTimes.length, 600);
  assert.equal(a.performanceProbes.size, 0);
});

test('render measurements keep completed frame counters after Animation resets them for a skipped RAF', async () => {
  let now = 1000, a;
  const counters = { drawCalls: 0, triangles: 0 };
  const m = modules({ performance: { now: () => now }, setTimeout(fn) {
    for (let i = 0; i < 20; i++) {
      now += 1000 / 60; a.update(1 / 60);
      counters.drawCalls = 100 + i; counters.triangles = 1000000 + i * 1000;
      a.afterRender({});
      // Three's Animation.start resets info before the application's pacer can skip the next RAF.
      counters.drawCalls = 0; counters.triangles = 0;
    }
    fn(); return 1;
  } });
  a = Object.create(m.ArchitectSystem.prototype);
  Object.assign(a, {
    game: { playing: false, frames: 10 }, present: true, actor: null, lastFrameAt: now,
    frameTimes: [], performanceProbes: new Set(), captures: [], renderer: { info: { render: counters } },
    resumeFrame() {}, link: { frameTick() {} }, lab: { frame() {} }, spin() {}, senses: { update() {} },
    bodies: () => [], retro: { update() {} }, updateTag() {}, focus: () => ({ x: 0, z: 0 }), addressAt: () => 'Test'
  });
  const r = await a.measurePerformance(2);
  assert.equal(counters.drawCalls, 0, 'the mutable renderer counters were reset before the timer returned');
  assert.equal(r.ok, true);
  assert.equal(r.mesures.images_rendues, 20);
  assert.equal(r.mesures.appels_dessin_moyens, 109.5);
  assert.equal(r.mesures.triangles_moyens, 1009500);
  assert.match(r.texte, /110 appels de dessin/);
  assert.equal(a.renderProbes.size, 0);
});

test('vehicle measurements include sideways and vertical motion from a blast', () => {
  const { a, m } = fixture();
  const car = { heading: 0, speed: 3, vx: 4, vz: 0, position: { x: 0, y: 0, z: 0 }, body: { vy: 12 }, hp: 100 };
  assert.equal(m.vehicleSpeed(car), 13);
  const measure = a.lab.measureCar(car);
  a.lab.frame(0.1);
  assert.equal(measure.stop().speed, 13);
});

test('voice starts muted, disabling it cuts the current utterance, and dismissal blocks future speech', async () => {
  const spoken = [];
  let speaking = false, cancels = 0;
  const synth = { getVoices: () => [], speak(u) { spoken.push(u.text); speaking = true; }, cancel() { cancels++; speaking = false; } };
  const { a, m } = fixture({
    window: { speechSynthesis: synth, addEventListener() {}, removeEventListener() {} }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    document: { addEventListener() {} }, setInterval: () => 1
  });
  a.senses.onEvent = () => {};
  class OfflineLink extends m.ArchitectLink { buildChat() {} connect() {} }
  const link = a.link = new OfflineLink(a);
  assert.equal(link.voice, false);
  link.speak('Ne doit pas être prononcé');
  assert.equal(spoken.length, 0);
  link.configure({ live: false });
  assert.equal(link.voice, false, 'a partial configuration must not turn voice on');
  link.configure({ voix: true });
  link.speak('Réponse autorisée');
  assert.equal(speaking, true);
  const before = cancels;
  link.configure({ voix: false });
  assert.equal(cancels, before + 1, 'cancel happens synchronously in configure');
  assert.equal(speaking, false);
  await link.execute('dire', { texte: 'Le sous-titre reste disponible', conversation: true });
  assert.equal(spoken.length, 1, 'future replies remain silent');
  link.configure({ voix: true }); link.speak('En cours');
  a.dismiss();
  assert.equal(speaking, false);
  link.speak('Absent');
  assert.equal(spoken.length, 2, 'an absent Architect cannot speak even if the preference remains on');
});

test('a programme can travel successively on foot, by real car physics and by helicopter without permanent idle', async () => {
  const { a, game, step } = navigationFixture();
  const completed = [];
  a.emit = (kind) => { if (kind === 'arrive') completed.push(kind); };
  for (const [mode, z, budget] of [['pied', 24, 1600], ['voiture', 220, 6000], ['helico', 700, 10000]]) {
    const result = await a.link.execute('aller_a', { x: 0, z, moyen: mode });
    assert.equal(result.ok, true);
    const initial = a.state();
    assert.equal(initial.navigation.destination.z, z);
    assert.ok(initial.capacites.deplacements.includes(mode));
    let sawMode = false;
    for (let i = 0; i < budget && a.order.kind !== 'idle'; i++) {
      step();
      if (a.state().navigation.moyen === mode) sawMode = true;
    }
    assert.equal(a.order.kind, 'idle', `${mode} did not reach its inspection point`);
    assert.ok(sawMode, `${mode} was advertised but never used`);
    assert.ok(Math.hypot(a.actor.x, a.actor.z - z) < 2, `${mode}: ${a.actor.x}, ${a.actor.z}`);
    assert.equal(game.camera.spectate, undefined, 'navigation never changes who owns the camera');
  }
  assert.equal(completed.length, 3);
});

test('a forced reprise replans a stuck route while ordinary duplicate orders preserve its progress', async () => {
  const { a, game, step } = navigationFixture();
  a.spectating = false;
  game.controllers.resolveHorizontalCollision = (position) => { position.x = a.actor.x; position.z = a.actor.z; };
  await a.link.execute('aller_a', { x: 30, z: 0, moyen: 'pied' });
  for (let i = 0; i < 1200; i++) step();
  const stuck = a.trip;
  assert.ok(stuck.stuck >= 2);
  assert.equal(a.actor.x, 0, 'Ensemble stuck recovery must not teleport him');
  assert.ok(a.state().navigation.blocages >= 2);
  await a.link.execute('aller_a', { x: 30, z: 0, moyen: 'pied' });
  assert.equal(a.trip, stuck);
  await a.link.execute('aller_a', { x: 30, z: 0, moyen: 'pied', reprendre: true });
  assert.notEqual(a.trip, stuck);
  assert.equal(a.trip.stuck, 0);
  assert.equal(a.state().navigation.duree_s, 0);
});

test('patrol progresses after inspection, stays local in Ensemble, and an explicit stop never restarts it', async () => {
  const { a, game, step } = navigationFixture();
  a.spectating = false;
  a.patrol();
  assert.ok(Math.hypot(a.order.x - game.player.x, a.order.z - game.player.z) <= 350);
  assert.equal(a.goTo(5000, 0, { by: 'heli' }), false, 'a direct body order respects the shared living zone too');
  a.arrive();
  const visits = a.order.visits;
  for (let i = 0; i < 900 && a.order.visits === visits; i++) step();
  assert.ok(a.order.visits > visits, 'inspection finished but patrol never chose its next stop');
  await a.link.execute('s_arreter', {});
  for (let i = 0; i < 1200; i++) step();
  assert.equal(a.order.kind, 'idle');
  assert.equal(a.trip, null);
  assert.equal(a.move.speed, 0);
});

test('dismissing him interrupts passive measurements immediately and discards their partial samples', async () => {
  let serial = 0;
  const timers = new Map();
  const { a, game } = fixture({
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  a.car = game.controllers.createCarEntity({ kind: 'sedan' });
  a.ride = a.car;
  const performanceResult = a.measurePerformance(8);
  const vehicleResult = a.measureVehicle('le_mien', 8);
  for (const probe of a.performanceProbes) probe({ at: performance.now() + 1, ms: 16 });
  a.lab.frame(0.1);
  assert.equal(a.measurements.size, 2);
  assert.equal(a.performanceProbes.size, 1);
  assert.equal(a.lab.hooks.size, 1);
  assert.equal(timers.size, 2, 'both observations were waiting for their eight-second deadline');
  a.dismiss();
  assert.equal(a.measurements.size, 0, 'no pending observations after returning control');
  assert.equal(a.performanceProbes.size, 0);
  assert.equal(a.renderProbes.size, 0);
  assert.equal(a.lab.hooks.size, 0);
  assert.equal(timers.size, 0, 'the deadline timers were cancelled synchronously');
  for (const result of await Promise.all([performanceResult, vehicleResult])) {
    assert.equal(result.ok, false, 'partial samples cannot become a successful full-duration report');
    assert.match(result.texte, /interrompue/);
    assert.doesNotMatch(result.texte, /8 s/);
  }
});

test('dismissing him during camera preparation cancels the photograph before a shutter is requested', async () => {
  let serial = 0;
  const timers = new Map();
  const { a, game, m } = fixture({
    document: { visibilityState: 'visible' },
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; }, clearTimeout: (id) => timers.delete(id)
  });
  game.playing = true;
  const link = Object.assign(Object.create(m.ArchitectLink.prototype), { architect: a, game });
  const task = link.photo({ direction: 'devant' });
  assert.equal(a.eye.jobs.length, 0);
  assert.equal(timers.size, 1, 'body and camera were turning for half a second');
  a.dismiss();
  const result = await task;
  assert.equal(result.ok, false);
  assert.match(result.texte, /interrompue/);
  assert.equal(a.eye.jobs.length, 0, 'the old operation cannot create a new photo after dismissal');
  assert.equal(timers.size, 0);
});

test('giving and taking the camera while the game is already hidden starts and stops only the authorized simulation', () => {
  const timers = new Map(), ticks = [];
  let serial = 0;
  const { a, game, m } = fixture({
    document: { hidden: true }, setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  Object.assign(game, { playing: true, paused: true, state: 'onFoot', wanted: { level: 0 }, director: { current: null }, setPaused(on) { this.paused = on; } });
  game.controllers.resetInput = () => {};
  a.frame = () => {};
  a.patrol = () => {};
  a.spectating = false;
  a.stopTicker = m.ArchitectSystem.prototype.stopTicker;
  a.ticker = { postMessage(ms) { ticks.push(ms); } };
  a.toggleSpectate();
  assert.equal(a.spectating, true);
  assert.equal(timers.size, 1, 'already-hidden tabs need their ticker started without another visibility event');
  [...timers.values()][0].fn();
  assert.equal(a.ticking, true);
  assert.equal(game.paused, false);
  assert.equal(ticks.at(-1), 33);
  a.stopSpectating();
  assert.equal(a.spectating, false);
  assert.equal(a.ticking, false);
  assert.equal(game.paused, true, 'the hidden player world pauses as soon as the Creator takes the camera back');
  assert.equal(ticks.at(-1), 0);
  assert.equal(timers.size, 0);
});

test('identification follows camera layers and ignores shadow stand-ins even on an enabled layer', () => {
  const { a } = fixture();
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.lookAt(0, 0, 1); camera.updateMatrixWorld();
  const box = (name, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1), new THREE.MeshBasicMaterial()); o.name = name; o.position.z = z; scene.add(o); return o; };
  const proxy = box('ShadowProxy', 3); proxy.userData.shadowProxy = true;
  box('AnotherLayer', 5).layers.set(3);
  const wall = box('SurveyedBuilding', 10);
  scene.updateMatrixWorld(true);
  a.eye.attach({ scene }); a.eye.last = { camera };
  const r = a.eye.identify(0.5, 0.5);
  assert.ok(r.hits.length);
  assert.ok(r.hits.every((hit) => hit.uuid === wall.uuid));
  const json = JSON.stringify(r);
  assert.ok(json.length < 5000, 'RPC returns descriptions rather than the scene graph');
  assert.ok(!r.hits.some((hit) => 'object' in hit));
});

test('identification serializes a real node material as a small public description', async () => {
  const { MeshPhysicalNodeMaterial } = await import('../vendor/three/build/three.webgpu.js');
  const { a } = fixture();
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.lookAt(0, 0, 1); camera.updateMatrixWorld();
  const material = new MeshPhysicalNodeMaterial();
  // Renderer materials and scene metadata may point back at one another; none of that belongs in an RPC response.
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1), material);
  wall.name = 'SurveyedBuilding'; wall.position.z = 5; wall.userData.scene = scene;
  material.userData.owner = wall;
  scene.add(wall); scene.updateMatrixWorld(true);
  a.eye.attach({ scene }); a.eye.last = { camera };
  const result = a.eye.identify(0.5, 0.5);
  const json = JSON.stringify(result), copy = JSON.parse(json);
  assert.ok(json.length < 5000);
  assert.equal(copy.hits[0].uuid, wall.uuid);
  assert.equal(copy.hits[0].material.type, 'MeshPhysicalNodeMaterial');
  assert.equal(copy.hits[0].point.z, 4.5);
  assert.match(copy.hits[0].module, /buildings/);
});

for (const action of ['stopSpectating', 'dismiss', 'onDeath']) {
  test(`${action} cancels an experiment before the blast and removes its temporary car`, async () => {
    const { a, game, cars, removed, blasts } = fixture();
    const task = a.lab.run({ type: 'explosion', trajet: road, conditions: { heure: 13, meteo: 'rain' } });
    await pump(a.lab, 10);
    assert.equal(cars.length, 1, 'the experiment had already created its target');
    assert.equal(cars[0].mission, true, 'temporary target excluded from ordinary autosaves');
    a[action]();
    assert.equal(game.atmosphere.hour, 17, 'restored synchronously before returning control');
    assert.equal(game.atmosphere.weather, 'clear');
    assert.equal(game.atmosphere.wet, 0.1);
    assert.equal(game.atmosphere.running, true);
    assert.equal(game.atmosphere.lockWeather, false);
    assert.equal(game.weatherMode, 'auto');
    assert.equal(removed.length, 1);
    assert.equal(a.lab.hooks.size, 0);
    const result = await task;
    assert.equal(result.ok, false);
    assert.equal(result.validite, 'incomplete');
    await pump(a.lab, 60);
    assert.equal(blasts.length, 0, 'no deferred blast after the player takes back control');
    assert.equal(a.lab.running, null);
  });
}

test('a pending photo and a night experiment stop without a frame and restore the time', async () => {
  const { a, game } = fixture();
  const task = a.lab.run({ type: 'nuit' });
  await pump(a.lab, 18);
  assert.equal(a.eye.jobs.length, 1, 'a photo is waiting for a renderer frame');
  a.stopSpectating();
  const r = await task;
  assert.equal(r.validite, 'incomplete');
  assert.equal(a.eye.jobs.length, 0);
  assert.equal(game.atmosphere.hour, 17);
});

test('cancelling night comparison also interrupts a stalled image decoder', async () => {
  const { a, game } = fixture();
  a.eye.shoot = async () => 'data:image/jpeg;base64,test';
  const task = a.lab.run({ type: 'nuit' });
  await pump(a.lab, 20);
  assert.equal(game.atmosphere.hour, 13);
  a.stopSpectating();
  assert.equal((await task).validite, 'incomplete');
  assert.equal(game.atmosphere.hour, 17);
});

test('the wall-clock watchdog releases an experiment when the simulation stops', async () => {
  let expire;
  const { a } = fixture({ setTimeout(fn, ms) { if (ms === 120000) expire = fn; return 1; }, clearTimeout() {} });
  const task = a.lab.run({ type: 'explosion', trajet: road });
  expire();
  const r = await task;
  assert.equal(r.ok, false);
  assert.equal(r.validite, 'incomplete');
  assert.match(r.raisons[0], /deux minutes/);
  assert.equal(a.lab.hooks.size, 0);
  assert.equal(a.lab.running, null);
});

test('cancelling a replay restores actual sun, wet-road grip and pending thunder before another frame', async () => {
  const { a, game, m } = fixture();
  const { atmosphere, applied } = realAtmosphere(game, m.globals);
  game.atmosphere = atmosphere;
  atmosphere.setHour(17); atmosphere.setWeather('clear', true);
  Object.assign(atmosphere, { wet: 0.1, cloud: 0.2, flash: 0.2, nextFlash: 4, thunderQueue: [2] });
  atmosphere.update(0, false);
  const original = { sun: applied.sun.clone(), night: applied.night, exposure: applied.exposure, wetness: applied.wetness, tint: atmosphere.uTint.value.clone() };
  const task = a.lab.run({ type: 'explosion', trajet: road, conditions: { heure: 13, meteo: 'storm' } });
  assert.equal(game.controllers.gripFactor, 0.8, 'the replay conditions apply to physics immediately');
  assert.equal(atmosphere.flash, 0, 'an inherited flash cannot contaminate the comparison');
  assert.equal(atmosphere.thunderQueue.length, 0);
  assert.ok(atmosphere.nextFlash > 120, 'no new random lightning during a bounded experiment');
  atmosphere.flash = 1; atmosphere.nextFlash = 20; atmosphere.thunderQueue.push(0.5);
  atmosphere.update(0, false);
  a.stopSpectating();
  assert.equal(game.controllers.gripFactor, 0.98);
  assert.ok(applied.sun.distanceTo(original.sun) < 1e-12);
  assert.equal(applied.night, original.night);
  assert.equal(applied.exposure, original.exposure);
  assert.equal(applied.wetness, original.wetness);
  assert.equal(atmosphere.flash, 0.2);
  assert.equal(atmosphere.nextFlash, 4);
  assert.equal(JSON.stringify(atmosphere.thunderQueue), '[2]');
  assert.equal(atmosphere.uTint.value.getHex(), original.tint.getHex());
  assert.equal((await task).validite, 'incomplete');
});

test('a failed replay setup restores the world and releases the run instead of leaving a frozen experiment', async () => {
  const { a, game } = fixture();
  let first = true;
  game.atmosphere.update = () => { if (first) { first = false; throw new Error('lighting refresh failed'); } };
  const result = await a.lab.run({ type: 'explosion', trajet: road, conditions: { heure: 13, meteo: 'rain' } });
  assert.equal(result.ok, false);
  assert.equal(result.validite, 'incomplete');
  assert.equal(game.atmosphere.hour, 17);
  assert.equal(game.atmosphere.running, true);
  assert.equal(a.lab.running, null);
  assert.equal(a.lab.context, null);
});

test('invalid saved replay geometry is refused before moving a body or changing the atmosphere', async () => {
  const { a, game, cars } = fixture();
  for (const input of [
    { type: 'crash', trajet: { x0: 0, z0: 0, x1: 0, z1: 0 } },
    { type: 'explosion', trajet: { x0: 0, z0: 0, x1: Infinity, z1: 100 } },
    { type: 'bordure', bord: { x: 0, z: 0, ux: 0, uz: 0, nx: 1, nz: 0 } },
    { type: 'nuit', lieu: { x: 0, z: 0 } }
  ]) {
    const result = await a.lab.run(input);
    assert.equal(result.ok, false);
    assert.equal(result.validite, 'incomplete');
  }
  assert.equal(a.lab.running, null);
  assert.equal(cars.length, 0);
  assert.equal(game.atmosphere.hour, 17);
});

test('reloading during preparation removes the target and restores the world before scheduling navigation', async () => {
  const timers = new Map(), saved = new Map();
  let serial = 0, reloaded = false;
  const { a, game, removed } = fixture({
    location: { search: '', reload() { reloaded = true; } }, localStorage: { setItem(key, value) { saved.set(key, JSON.parse(value)); } },
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); }
  });
  const task = a.lab.run({ type: 'explosion', trajet: road, conditions: { heure: 13, meteo: 'rain' } });
  await pump(a.lab, 10);
  a.reloadSoon();
  assert.equal(removed.length, 1);
  assert.equal(game.atmosphere.hour, 17);
  assert.equal(game.atmosphere.weather, 'clear');
  assert.equal(a.lab.hooks.size, 0);
  assert.equal((await task).validite, 'incomplete');
  assert.equal(timers.size, 1);
  const navigation = [...timers.values()][0];
  assert.equal(navigation.ms, 400);
  assert.equal(saved.size, 1, 'only the Architect resume record was written into isolated storage');
  assert.equal(reloaded, false);
  navigation.fn();
  assert.equal(reloaded, true);
});

test('a temporary target joins actual collision collection without evicting or autosaving the player fleet', async () => {
  const saves = [];
  const { a, game, m } = fixture({ localStorage: { setItem(_key, text) { saves.push(JSON.parse(text)); } } });
  const { Game } = isolatedModule('gameplay.js', m.globals);
  game.architect = a;
  Object.assign(game, { allCars: [], wanted: { cars: [] }, wrecks: [], gangs: { held: new Set() }, vertical: { owns: () => false } });
  game.atmosphere.serialize = function () { return { hour: this.hour, weather: this.weather }; };
  for (let i = 0; i < 12; i++) {
    const car = game.controllers.createCarEntity({ kind: 'sedan' });
    car.paint = 0x112233; car.heading = 0; car.position.set(i * 4, 0, 80);
    game.fleet.push(car);
  }
  const originals = [...game.fleet];
  const task = a.lab.run({ type: 'explosion', trajet: road, conditions: { heure: 13, meteo: 'rain' } });
  await pump(a.lab, 10);
  const target = game.fleet.at(-1);
  assert.equal(game.fleet.length, 13, 'no ordinary vehicle was recycled');
  assert.ok(Game.prototype.collectCars.call(game).includes(target), 'the target is present in the real collision collection');
  Game.prototype.save.call(game);
  assert.equal(saves.length, 0, 'experiment atmosphere must not enter an autosave');
  a.dismiss(); await task;
  assert.equal(game.fleet.length, 12);
  assert.ok(originals.every((car, i) => game.fleet[i] === car));
  assert.ok(!Game.prototype.collectCars.call(game).includes(target));
  Game.prototype.save.call(game);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].fleet.length, 12);
  assert.equal(saves[0].atmosphere.hour, 17);
  assert.equal(saves[0].atmosphere.weather, 'clear');
});

test('the rollover sensor releases removed vehicle references on a long session', () => {
  const { a, game } = fixture();
  const car = { position: new THREE.Vector3(), mesh: { visible: true }, body: { r: [1, 0, 0, 0, 0, 1, 0, -1, 0] }, speed: 0 };
  game.allCars = [car]; a.senses.report = () => {};
  for (let i = 0; i < 4; i++) { game.clock += 0.2; a.retro.scanCars(0.2); }
  assert.equal(a.retro.reported.size, 1);
  game.allCars.length = 0;
  a.retro.scanCars(0.2);
  assert.equal(a.retro.tipped.size, 0);
  assert.equal(a.retro.reported.size, 0);
});

test('experiment results distinguish missing evidence and retain comparable replay conditions', async () => {
  const { a, game, blasts } = fixture();
  a.eye.shoot = async () => null;
  const incomplete = a.lab.run({ type: 'explosion', trajet: road, conditions: { heure: 13, meteo: 'rain' } });
  await pump(a.lab, 90);
  const first = await incomplete;
  assert.equal(first.ok, true, 'the explosion ran');
  assert.equal(first.validite, 'incomplete', 'no photos means no complete proof');
  assert.match(first.raisons[0], /0\/4 photos/);
  assert.equal(game.atmosphere.hour, 17);
  a.eye.shoot = async () => 'data:image/jpeg;base64,test';
  const replay = a.lab.run({ type: 'explosion', ...first.params });
  await pump(a.lab, 90);
  const second = await replay;
  assert.equal(second.validite, 'valide');
  assert.equal(second.protocole.version_jeu, '0.9.4');
  assert.equal(second.protocole.trafic, 'actif_non_fige');
  assert.equal(second.protocole.pas_simulation, 'variable');
  assert.deepEqual(JSON.parse(JSON.stringify(second.params)), JSON.parse(JSON.stringify(first.params)));
  assert.equal(blasts.length, 2);
});

test('a target disturbed by traffic invalidates the planned explosion setup', async () => {
  const { a, cars } = fixture();
  a.eye.shoot = async () => 'data:image/jpeg;base64,test';
  const task = a.lab.run({ type: 'explosion', trajet: road });
  await pump(a.lab, 10);
  cars[0].position.x += 3;
  cars[0].vx = 2;
  await pump(a.lab, 80);
  const r = await task;
  assert.equal(r.validite, 'perturbee');
  assert.match(r.raisons[0], /avant le souffle/);
  assert.notEqual(r.mesures.distance_souffle_m, 2.2);
});

test('cancelling a burst resolves its pending photo and never schedules the remaining frames', async () => {
  const { a } = fixture();
  const task = a.retro.burst({ x: 10, y: 0, z: 0 });
  assert.equal(a.eye.jobs.length, 1);
  a.cancelWork('Reprise caméra');
  assert.equal((await task).length, 0);
  assert.equal(a.eye.jobs.length, 0);
  assert.equal(a.retro.bursts.size, 0);
});

test('a photo reproduction applies its saved field of view and releases it on input', () => {
  const events = new Map(), calls = [];
  const { a, game, m } = fixture({
    window: { __render: { view: (...args) => calls.push(args) }, addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name) => events.delete(name) },
    location: { search: '?at=0,0,0&oeil=1,2,3,0.5,0.2,25' }
  });
  a.applyRepro();
  assert.equal(calls[0][6], 25);
  events.get('keydown')();
  assert.equal(calls[1].length, 0, 'release requests restoration of the original FOV');
  assert.equal(events.size, 0);
  assert.equal(m.parseRepro('?at=0,0,0&oeil=1,2,3,0,0,180').eye, null);
});
