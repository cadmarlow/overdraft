const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// The eye adaptation of atmosphere.js: the sun probe through the building colliders, and the exposure that follows it.
// The rest of the module (rain, weather, the sky bake) runs against chainable TSL stubs: only the eye is under test.

const source = readFileSync(join(__dirname, '../js/atmosphere.js'), 'utf8');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; return this.set(this.x / l, this.y / l, this.z / l); }
}
class Color {
  constructor(hex = 0) { this.hex = hex; this.r = this.g = this.b = 0.5; }
  copy(c) { this.hex = c.hex; return this; }
  lerp() { return this; }
  setRGB() { return this; }
  getHexString() { return this.hex.toString(16); }
}
// Any TSL call or property: another chainable stub
const chain = new Proxy(function () {}, { get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : chain), apply: () => chain });
const tsl = new Proxy({}, { get: () => chain });

const preset = (sunDir, nightFactor) => ({
  sunDir: new Vector3(...sunDir).normalize(), sunColor: 0xffffff, hemiSky: 0xffffff, hemiGround: 0xffffff, skyTop: 0, skyHorizon: 0, fogColor: 0,
  sunIntensity: 7, hemiIntensity: 1.4, fogDensity: 0.0002, interiorGlow: 0.4, roadWetness: 0.2, envIntensity: 0.4, canyonBounce: 0.5,
  turbidity: 8, rayleigh: 2.8, mieCoefficient: 0.008, mieDirectionalG: 0.88, cloudCoverage: 0.3, cloudDensity: 0.3, skyExposure: 0.14, nightFactor
});
const TIME_PRESETS = { golden: preset([-0.44, 0.58, -0.68], 0), midday: preset([-0.34, 0.82, -0.46], 0), twilight: preset([-0.52, 0.36, -0.77], 0.28), midnight: preset([0.42, 0.68, -0.6], 0.86) };
const look = { exposure: 1, contrast: 1.2, saturation: 1.1, balance: [1, 1, 1], bloom: 0.2, threshold: 1.2 };
const GRADE_LOOKS = { golden: look, midday: look, twilight: look, midnight: look };

function atmosphere({ colliders = [], camera = { position: new Vector3(0, 2, 0), matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } }, entity = null } = {}) {
  const { Atmosphere } = loadModule(source, {
    imports: {
      'three/webgpu': { Vector3, Color, MeshBasicNodeMaterial: class { }, PlaneGeometry: class { }, Mesh: class { constructor() { this.position = new Vector3(); } } },
      'three/tsl': tsl,
      './lighting.js': { TIME_PRESETS },
      './post-processing.js': { GRADE_LOOKS }
    }
  });
  const applied = [];
  const looks = [];
  const controllers = {
    nearColliders: (x, z) => colliders.filter((c) => x > c.minX - 1 && x < c.maxX + 1 && z > c.minZ - 1 && z < c.maxZ + 1),
    getActiveEntity: () => entity
  };
  const a = new Atmosphere({ lighting: { applyParams: (p) => applied.push(p) }, grade: { applyLook: (l) => looks.push({ ...l }) }, scene: { add() {} }, camera, controllers });
  a.lockWeather = true;
  return { a, applied, looks };
}

test('the sun probe sees the sky in the open and a building in the way', () => {
  const tower = { minX: -20, maxX: 20, minY: 0, maxY: 60, minZ: -60, maxZ: -30 };
  const { a } = atmosphere({ colliders: [tower] });
  const sun = new Vector3(0, 0.5, -1).normalize(); // low, to the north: the tower north of the origin shades it
  assert.equal(a.sunReaches(0, 2, 0, sun), 0);
  assert.equal(a.sunReaches(0, 2, 140, sun), 1, 'far enough south the ray clears the tower');
  assert.equal(a.sunReaches(0, 2, 0, new Vector3(0, 0.5, 1).normalize()), 1, 'the sun on the other side');
  assert.equal(a.sunReaches(0, 70, 0, sun), 1, 'above the roof');
  assert.equal(a.sunReaches(0, 2, 0, new Vector3(0, 0.01, -1).normalize()), 1, 'a sun at the horizon is not probed');
});

test('the eye opens up in the shade by day, and closes again in the sun', () => {
  const tower = { minX: -200, maxX: 200, minY: 0, maxY: 200, minZ: -120, maxZ: -60 };
  const { a, looks } = atmosphere({ colliders: [tower], entity: { position: new Vector3(0, 0, 0) } });
  a.setHour(17); // golden: the sun to the north-west, low
  a.setWeather('clear', true);
  for (let i = 0; i < 300; i++) a.update(1 / 60, true);
  assert.ok(a.eye > 1.4, `in the tower's shadow the eye opens: ${a.eye}`);
  assert.ok(a.eye <= 1.7);
  assert.ok(looks.at(-1).exposure > 1.3, 'the grade gets the opened exposure');
  // the tower gone: the eye closes, faster than it opened
  tower.maxY = 0;
  const before = a.eye;
  for (let i = 0; i < 30; i++) a.update(1 / 60, true);
  assert.ok(a.eye < before - 0.25, `closing after half a second: ${before} -> ${a.eye}`);
  for (let i = 0; i < 300; i++) a.update(1 / 60, true);
  assert.ok(Math.abs(a.eye - 1) < 0.02, `back to the open exposure: ${a.eye}`);
});

test('at night, under cloud and with the sun down the eye stays put', () => {
  const tower = { minX: -200, maxX: 200, minY: 0, maxY: 200, minZ: -120, maxZ: -60 };
  const { a } = atmosphere({ colliders: [tower] });
  a.setHour(1);
  for (let i = 0; i < 200; i++) a.update(1 / 60, true);
  assert.ok(Math.abs(a.eye - 1) < 0.08, `midnight: ${a.eye}`);
  a.setHour(17);
  a.setWeather('storm', true);
  for (let i = 0; i < 300; i++) a.update(1 / 60, true);
  assert.ok(a.eye < 1.25, `storm clouds flatten the contrast the eye would answer: ${a.eye}`);
});
