const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const root = join(__dirname, '..');
const source = readFileSync(join(root, 'js/car-cabin.js'), 'utf8');
// Layout needs the real indexed geometry but no renderer; the vectors only belong to the unused driver-pose pool.
const { cabinLayout } = loadModule(source, {
  imports: { 'three/webgpu': { Vector3: class Vector3 {} }, 'three/addons/utils/BufferGeometryUtils.js': {} }
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
  for (const id of ['sedan', 'compact', 'offroad', 'taxi', 'muscle', 'sport', 'super']) assert.ok(supported.includes(id), `${id}: missing cabin`);
});

test('models without an identifiable windscreen keep their exterior camera fallback', () => {
  for (const id of ['truck', 'delivery']) {
    const { glass, position } = modelGlass(id, models[id]);
    assert.equal(cabinLayout(models[id].spec, glass, position), null, id);
  }
});
