const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// person-lighting.js evaluated numerically: TSL nodes are small arrays, the view is the world (identity view matrix)
const source = (name) => readFileSync(join(__dirname, '../js', name), 'utf8');

class N {
  constructor(f) { this.f = typeof f === 'function' ? f : () => f; }
  eval() { return this.f(); }
  get xyz() { return new N(() => this.eval().slice(0, 3)); }
  mul(b) { return new N(() => zip(this, b, (x, y) => x * y)); }
  add(b) { return new N(() => zip(this, b, (x, y) => x + y)); }
  oneMinus() { return new N(() => this.eval().map((v) => 1 - v)); }
}
const val = (v) => (v instanceof N ? v.eval() : typeof v === 'number' ? [v] : v);
function zip(a, b, fn) {
  const va = val(a), vb = val(b), n = Math.max(va.length, vb.length);
  return Array.from({ length: n }, (_, i) => fn(va[i % va.length], vb[i % vb.length]));
}
const state = { normal: [0, 0, 1], albedo: [0.3, 0.3, 0.3] };
const uniform = (value) => {
  const node = new N(() => (typeof node.value === 'number' ? [node.value] : [node.value.r, node.value.g, node.value.b]));
  node.value = value;
  return node;
};
const tsl = {
  BRDF_Lambert: ({ diffuseColor }) => diffuseColor.mul(1 / Math.PI),
  cameraViewMatrix: { mul: (v) => v },
  diffuseContribution: new N(() => state.albedo),
  dot: (a, b) => new N(() => [zip(a, b, (x, y) => x * y).slice(0, 3).reduce((s, v) => s + v, 0)]),
  float: (v) => new N([v]),
  mix: (a, b, t) => new N(() => { const va = val(a), vb = val(b), vt = val(t), n = Math.max(va.length, vb.length); return Array.from({ length: n }, (_, i) => va[i % va.length] + (vb[i % vb.length] - va[i % va.length]) * vt[i % vt.length]); }),
  normalView: new N(() => state.normal),
  smoothstep: (e0, e1, x) => new N(() => val(x).map((v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); })),
  uniform,
  vec4: (...args) => new N(() => args.flatMap(val))
};
class Color { constructor(r, g, b) { Object.assign(this, { r, g, b }); } }
const calls = [];
class PhysicalLightingModel {
  constructor() { this.clearcoat = false; this.sheen = false; }
  direct() { calls.push('direct'); }
  indirect() { calls.push('indirect'); }
}
const cityUniforms = { uNight: uniform(0) };
const { PERSON_LIGHT, PersonLightingModel, lightAsPerson, isLocalLight } = loadModule(source('person-lighting.js'), {
  imports: { 'three/webgpu': { Color, PhysicalLightingModel }, 'three/tsl': tsl, './tsl-materials.js': { cityUniforms } }
});

const sum = () => ({ total: [0, 0, 0], addAssign(n) { this.total = zip(this.total, n, (x, y) => x + y); } });
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function personModel() {
  const material = { setupLightingModel() { const m = new PhysicalLightingModel(); m.clearcoat = true; return m; } };
  assert.equal(lightAsPerson(material), material);
  return material.setupLightingModel({});
}
// What one light leaves on a surface of the given normal (direct diffuse only: the bounce)
function bounceFrom(lightNode, normal) {
  state.normal = normal;
  const reflectedLight = { directDiffuse: sum(), indirectDiffuse: sum() };
  personModel().direct({ lightNode, lightColor: new N([1, 1, 1]), lightDirection: new N([0, 1, 0]), reflectedLight }, {});
  return luma(reflectedLight.directDiffuse.total);
}
// The night floor on a surface of the given normal at the given nightFactor
function glowAt(night, normal) {
  state.normal = normal;
  cityUniforms.uNight.value = night;
  const reflectedLight = { directDiffuse: sum(), indirectDiffuse: sum() };
  personModel().indirect({ context: { reflectedLight } });
  return reflectedLight.indirectDiffuse.total;
}
const UP = [0, 1, 0], DOWN = [0, -1, 0], UPRIGHT = [0, 0, 1];

test('a person keeps their material\'s own lighting model, its flags and its direct and indirect light', () => {
  calls.length = 0;
  const model = personModel();
  assert.ok(model instanceof PersonLightingModel);
  assert.equal(model.clearcoat, true, 'the clearcoat flag of the material\'s model carries over');
  model.direct({ lightNode: null, lightColor: new N([1, 1, 1]), reflectedLight: { directDiffuse: sum() } }, {});
  model.indirect({ context: { reflectedLight: { indirectDiffuse: sum() } } });
  assert.deepEqual(calls, ['direct', 'indirect']);
});

test('lamps, headlights and shop lights light a person back from the street; the sun and the moon do not', () => {
  assert.ok(isLocalLight({ isClusteredLightsNode: true }), 'clustered lamps and headlights');
  assert.ok(isLocalLight({ light: { isSpotLight: true } }), 'a spot of its own (the player\'s car)');
  assert.ok(isLocalLight({ light: { isPointLight: true } }));
  assert.ok(!isLocalLight({ light: { isDirectionalLight: true } }), 'sun and moon: the hemisphere light carries their bounce');
  assert.ok(!isLocalLight(null));
  assert.ok(bounceFrom({ isClusteredLightsNode: true }, UPRIGHT) > 0);
  assert.equal(bounceFrom({ light: { isDirectionalLight: true } }, UPRIGHT), 0);
});

test('a lamp behind someone still lights their front: most on what faces the pavement, least on what faces the sky', () => {
  const lamp = { isClusteredLightsNode: true };
  const down = bounceFrom(lamp, DOWN), upright = bounceFrom(lamp, UPRIGHT), up = bounceFrom(lamp, UP);
  assert.ok(down > upright && upright > up && up > 0, `${down} > ${upright} > ${up} > 0`);
  // a share of the lamp's light, far below what the side facing it gets
  const facing = 0.3 / Math.PI;
  assert.ok(upright > facing * 0.05 && down < facing * 0.4, `bounce ${upright} against ${facing} facing the lamp`);
});

test('the night floor: nothing by day, a little at dusk, a warm street glow at midnight', () => {
  assert.deepEqual(glowAt(0, UPRIGHT), [0, 0, 0], 'daylight looks as it did');
  const dusk = luma(glowAt(0.28, UPRIGHT)), night = luma(glowAt(0.86, UPRIGHT));
  assert.ok(dusk > 0 && dusk < night * 0.25, `dusk ${dusk}, night ${night}`);
  const below = glowAt(0.86, DOWN), above = glowAt(0.86, UP);
  assert.ok(luma(below) > luma(above), 'the lit street gives more than the dark sky');
  assert.ok(below[0] > below[2], 'warm from the street');
  assert.ok(above[2] > above[0], 'cool from the sky');
});

test('at midnight the floor outweighs the dark sky by far, so nobody turns into a black cut-out', async () => {
  const THREE = await import('../vendor/three/build/three.core.js');
  const code = source('lighting.js');
  const imports = Object.fromEntries([...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => [m[1], {}]));
  const { TIME_PRESETS } = loadModule(code, { imports: { ...imports, 'three/webgpu': THREE } });
  const p = TIME_PRESETS.midnight;
  const sky = new THREE.Color(p.hemiSky), ground = new THREE.Color(p.hemiGround);
  // the hemisphere light on an upright surface: half sky, half ground
  const hemi = luma([sky.r, sky.g, sky.b].map((v, i) => (v + [ground.r, ground.g, ground.b][i]) / 2 * p.hemiIntensity));
  const floor = luma(glowAt(p.nightFactor, UPRIGHT)) * Math.PI / 0.3; // back to irradiance
  assert.ok(floor > hemi * 4, `floor ${floor.toFixed(3)} against the night sky's ${hemi.toFixed(3)}`);
  // still a floor: well under a lamp's light on the side that faces it (a street lamp gives several units up close)
  assert.ok(floor < 0.6, `floor ${floor.toFixed(3)}`);
  assert.ok(PERSON_LIGHT.nightFrom < 0.28 && PERSON_LIGHT.nightTo <= p.nightFactor, 'full at midnight, starting at dusk');
});
