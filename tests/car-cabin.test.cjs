const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const root = join(__dirname, '..');
const source = readFileSync(join(root, 'js/car-cabin.js'), 'utf8');
const { makeTune } = loadModule(readFileSync(join(root, 'js/car-physics.js'), 'utf8'));
// Layout needs the real indexed geometry but no renderer; the vectors only belong to the unused driver-pose pool.
const { cabinLayout, instrumentProfile, instrumentAngle, poseCabin } = loadModule(source, {
  imports: { 'three/webgpu': { Vector3: class Vector3 {} }, 'three/addons/utils/BufferGeometryUtils.js': {}, './car-physics.js': { makeTune } }
});
const models = JSON.parse(readFileSync(join(root, 'assets/cars/models.json'), 'utf8'));

function modelGlass(id, model) {
  const bytes = readFileSync(join(root, `assets/cars/${id}.bin`));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const n = model.vertices, p = new Float32Array(buffer, 0, n * 3);
  const indices = new Uint32Array(buffer, n * 21 + (4 - n % 4) % 4, model.indices);
  const position = { getX: (i) => p[i * 3], getY: (i) => p[i * 3 + 1], getZ: (i) => p[i * 3 + 2] };
  const glass = { index: { array: indices.subarray(model.ranges[2], model.ranges[2] + model.ranges[3]) } };
  return { glass, position };
}

test('real car cabins keep the driver in front and the steering column within reach of the dashboard', () => {
  const supported = [];
  for (const [id, model] of Object.entries(models)) {
    const { glass, position } = modelGlass(id, model);
    const layout = cabinLayout(model.spec, glass, position);
    if (!layout) continue;
    supported.push(id);
    const [x, hip, z] = layout.seat;
    assert.ok(z > model.spec.wheelZr + 0.4, `${id}: driver over the rear axle at ${z}`);
    assert.ok(z < model.spec.wheelZf, `${id}: driver ahead of the cabin`);
    assert.ok(x > 0 && x < model.spec.halfW - 0.2, `${id}: driver outside the left seat`);
    const dashReach = layout.dash[1] - layout.wheel[2];
    assert.ok(dashReach > 0.35 && dashReach < 0.9, `${id}: steering wheel ${dashReach} m behind the dashboard`);
    assert.ok(hip + 0.88 * Math.cos(layout.recline) <= layout.roof + 0.01, `${id}: head through the roof`);
    assert.ok([...layout.seat, ...layout.wheel, ...layout.pedals, ...layout.dash, layout.recline].every(Number.isFinite), `${id}: invalid cabin`);
  }
  for (const id of Object.keys(models)) assert.ok(supported.includes(id), `${id}: missing cabin`);
});

test('cab-over and four-corner windscreens place the driver under the cabin roof, ahead of the cargo', () => {
  for (const id of ['truck', 'delivery']) {
    const { glass, position } = modelGlass(id, models[id]);
    const layout = cabinLayout(models[id].spec, glass, position);
    assert.ok(layout, id);
    assert.ok(layout.seat[2] > 0.4, id + ': driver is in the front cab');
    assert.ok(layout.roof < models[id].spec.height - 0.3, id + ': roof comes from the glass, not the cargo box');
    assert.ok(layout.dash[0] > 1.4 && layout.dash[0] < 1.8, id + ': dashboard meets the lower windscreen');
    assert.equal(layout.rear, false, id + ': no bench seat in the cargo area');
    assert.ok(layout.wheel[2] < layout.dash[1] && layout.wheel[2] > layout.seat[2], id + ': wheel ahead of the driver');
  }
});

test('missing glass keeps the safe exterior-camera fallback', () => {
  assert.equal(cabinLayout(models.truck.spec, { index: { array: [] } }, { getX() {}, getY() {}, getZ() {} }), null);
});


test('instrument scales distinguish diesel, road and high-revving performance engines', () => {
  const truck = instrumentProfile('truck'), road = instrumentProfile('sedan'), sport = instrumentProfile('sport'), supercar = instrumentProfile('super');
  assert.ok(truck.rpm < road.rpm && road.rpm < sport.rpm && sport.rpm < supercar.rpm);
  for (const kind of Object.keys(models)) {
    const p = instrumentProfile(kind);
    assert.equal(p.redline, makeTune(kind).redline, `${kind}: cockpit redline differs from the engine limit`);
    assert.ok(p.redline < p.rpm && p.redline > 3000, kind);
    assert.equal(instrumentAngle(-100, p.speed), instrumentAngle(0, p.speed));
    assert.equal(instrumentAngle(p.speed * 2, p.speed), instrumentAngle(p.speed, p.speed));
  }
});

test('cockpit needles read actual reverse speed and engine rpm while the wheel follows steering', () => {
  const dial = () => ({ rotation: { z: 0 }, updated: 0, updateMatrixWorld() { this.updated++; } });
  const cabin = { rim: dial(), instruments: { speed: dial(), revs: dial(), profile: instrumentProfile('sport') } };
  poseCabin(cabin, 0.3, { speed: -20, rpm: 4500 });
  assert.equal(cabin.instruments.speed.rotation.z, instrumentAngle(72, 320));
  assert.equal(cabin.instruments.revs.rotation.z, instrumentAngle(4500, 9000));
  assert.equal(cabin.rim.rotation.z, -1.5);
  assert.equal(cabin.instruments.speed.updated, 1);
  assert.equal(cabin.instruments.revs.updated, 1);
});
