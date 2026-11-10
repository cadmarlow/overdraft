const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const root = join(__dirname, '..');
const source = readFileSync(join(root, 'js/car-cabin.js'), 'utf8');
// Layout needs the real indexed geometry but no renderer; the vectors only belong to the unused driver-pose pool.
const { cabinLayout, instrumentProfile, instrumentAngle, poseCabin } = loadModule(source, {
  imports: { 'three/webgpu': { Vector3: class Vector3 {} }, 'three/addons/utils/BufferGeometryUtils.js': {}, 'three/tsl': {} }
});
const models = JSON.parse(readFileSync(join(root, 'assets/cars/models.json'), 'utf8'));

function modelGlass(id, model) {
  const bytes = readFileSync(join(root, `assets/cars/${id}.bin`));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const n = model.vertices, p = new Float32Array(buffer, 0, n * 3);
  const indices = new Uint32Array(buffer, n * (model.normalFormat === 'snorm16' ? 25 : 21) + (4 - n % 4) % 4, model.indices);
  const position = { getX: (i) => p[i * 3], getY: (i) => p[i * 3 + 1], getZ: (i) => p[i * 3 + 2] };
  const glass = { index: { array: indices.subarray(model.ranges[2], model.ranges[2] + model.ranges[3]) } };
  return { glass, position };
}

test('real car cabins keep the driver in front and the steering column within reach of the dashboard', () => {
  const supported = [];
  for (const [id, model] of Object.entries(models)) {
    const { glass, position } = modelGlass(id, model);
    const layout = model.cabinLayout ?? cabinLayout(model.spec, glass, position);
    if (!layout) continue;
    supported.push(id);
    const [x, hip, z] = layout.seat;
    assert.ok(z > model.spec.wheelZr + 0.4, `${id}: driver over the rear axle at ${z}`);
    // A cab-over truck puts the driver just ahead of its front axle; the windscreen and body envelope bound it.
    const frontLimit = id === 'truck' ? Math.min(layout.dash[1] - 0.5, model.spec.zFront - 0.6) : model.spec.wheelZf;
    assert.ok(z < frontLimit, `${id}: driver ahead of the cabin`);
    assert.ok((id === 'super' && model.sourceInterior ? x >= 0 : x > 0) && x < model.spec.halfW - 0.2, `${id}: driver outside the supported seat`);
    if (model.sourceInterior) {
      assert.deepEqual(layout.wheel, model.steering.position, `${id}: controls use the real steering pivot`);
      const reach = layout.wheel[2] - z;
      assert.ok(reach > 0.2 && reach < 0.85, `${id}: source wheel ${reach} m ahead of the seat`);
      assert.ok(layout.instruments?.width > 0 && layout.instruments?.height > 0, `${id}: source instrument recess supplied`);
    } else {
      const dashReach = layout.dash[1] - layout.wheel[2];
      assert.ok(dashReach > 0.35 && dashReach < 0.9, `${id}: steering wheel ${dashReach} m behind the dashboard`);
    }
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
    assert.ok(layout.seat[2] > 0 && layout.seat[2] > models[id].spec.wheelZr + 0.4, id + ': driver is in the front cab');
    const heights = [...glass.index.array].map(i => position.getY(i));
    const top = Math.max(...heights);
    assert.ok(layout.roof < top && layout.roof > top - 0.15, id + ': headroom follows the real glazing roof');
    assert.ok(layout.roof < models[id].spec.height, id + ': cabin stays below the roof envelope');
    assert.ok(layout.dash[0] > layout.seat[1] && layout.dash[0] < layout.roof - 0.2, id + ': dashboard is below the windscreen roof');
    assert.ok(layout.wheel[2] < layout.dash[1] && layout.wheel[2] > layout.seat[2], id + ': wheel ahead of the driver');
  }
});

test('a four-corner windscreen anchors its cab independently from a taller cargo roof', () => {
  const vertices = [[-1, 1.6, 2.8], [1, 1.6, 2.8], [1, 2.2, 2.4], [-1, 2.2, 2.4]];
  const position = { getX: i => vertices[i][0], getY: i => vertices[i][1], getZ: i => vertices[i][2] };
  const glass = { index: { array: [0, 1, 2, 0, 2, 3] } };
  const layout = cabinLayout({ height: 3.3, wheelZf: 1.3, zFront: 3.4 }, glass, position);
  assert.ok(layout, 'a windscreen needs no vertex on its centre line');
  assert.ok(Math.abs(layout.roof - 2.1) < 1e-9, 'the cargo box cannot move the cabin ceiling');
  assert.ok(Math.abs(layout.dash[0] - 1.58) < 1e-9 && Math.abs(layout.dash[1] - 2.8) < 1e-9, 'dashboard meets the actual lower glass edge');
  assert.equal(layout.rear, false, 'a front cab does not invent a rear cabin from the cargo box');
});

test('missing glass keeps the safe exterior-camera fallback', () => {
  assert.equal(cabinLayout(models.truck.spec, { index: { array: [] } }, { getX() {}, getY() {}, getZ() {} }), null);
});


test('instrument scales distinguish diesel, road and high-revving performance engines', () => {
  const truck = instrumentProfile('truck'), road = instrumentProfile('sedan'), sport = instrumentProfile('sport'), supercar = instrumentProfile('super');
  assert.ok(truck.rpm < road.rpm && road.rpm < sport.rpm && sport.rpm < supercar.rpm);
  for (const kind of Object.keys(models)) {
    const p = instrumentProfile(kind);
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

let renderHarness;
async function cabinRenderHarness() {
  renderHarness ??= (async () => {
    const THREE = await import('../vendor/three/build/three.webgpu.js');
    const TSL = await import('../vendor/three/build/three.tsl.js');
    const utils = loadModule(readFileSync(join(root, 'vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), 'utf8'), { imports: { three: THREE } });
    const context = new Proxy({ createRadialGradient() { return { addColorStop() {} }; } }, {
      get(target, key) { return key in target ? target[key] : () => {}; },
      set(target, key, value) { target[key] = value; return true; }
    });
    const api = loadModule(source, {
      imports: { 'three/webgpu': THREE, 'three/tsl': TSL, 'three/addons/utils/BufferGeometryUtils.js': utils },
      globals: { document: { createElement: () => ({ getContext: () => context }) } }
    });
    return { THREE, api };
  })();
  return renderHarness;
}
const sampleCabin = () => ({ seat: [0.4, 0.45, -0.3], recline: 0.35, wheel: [0.4, 0.77, 0.22], radius: 0.18, tilt: 0.42,
  pedals: [0.4, 0.15, 0.6], dash: [0.9, 0.85], width: 0.82, roof: 1.35, back: -1.5, rear: true });

test('sculpted cabins keep five draws and one shared surface shader across all generated families', async () => {
  const { THREE, api } = await cabinRenderHarness();
  const families = new Set();let material;
  for (const kind of ['sedan', 'wagon', 'suv', 'sport', 'hatch', 'muscle', 'taxi', 'offroad', 'truck', 'delivery', 'van', 'pickup', 'compact', 'minivan']) {
    const parent = new THREE.Group(), layout = sampleCabin(), before = JSON.stringify(layout);
    const cabin = api.buildCabin(layout, parent, kind);
    const draws = [];parent.traverse((o) => { if (o.isMesh) draws.push(o); });
    assert.equal(draws.length, 5, kind + ': fixed draw budget despite richer trim');
    assert.equal(JSON.stringify(layout), before, kind + ': driver and camera anchors unchanged');
    material ??= cabin.mesh.material;
    assert.equal(cabin.mesh.material, material, kind + ': shared cabin material');
    assert.equal(cabin.rim.material, material, kind + ': wheel uses the same surface pipeline');
    families.add(cabin.family);
    const geometry = cabin.mesh.geometry;
    assert.ok(geometry.attributes.position.count / 3 < 26000, kind + ': bounded static triangle budget');
    for (const attribute of Object.values(geometry.attributes)) assert.ok(Array.from(attribute.array).every(Number.isFinite), kind + ': finite mesh attributes');
    const surface = geometry.attributes.cabinSurface;
    let roughLow = 1, roughHigh = 0, metalLow = 1, metalHigh = 0;
    for (let i = 0; i < surface.count; i++) {
      roughLow = Math.min(roughLow, surface.getX(i));roughHigh = Math.max(roughHigh, surface.getX(i));
      metalLow = Math.min(metalLow, surface.getY(i));metalHigh = Math.max(metalHigh, surface.getY(i));
    }
    assert.ok(roughLow < 0.35 && roughHigh > 0.8, kind + ': distinct metal and upholstery highlights');
    assert.ok(metalLow === 0 && metalHigh >= 0.8, kind + ': insulating trim and actual metal remain distinct');
    assert.ok(cabin.rim.matrixWorld.elements.every(Number.isFinite), kind + ': initial world matrices valid');
  }
  assert.equal(families.size, 5);
});

test('a supplied interior adds only its extracted wheel and turns about the imported steering axis', async () => {
  const { THREE, api } = await cabinRenderHarness();
  const parent = new THREE.Group(), material = new THREE.MeshStandardNodeMaterial();
  const geometry = new THREE.TorusGeometry(0.18, 0.02, 8, 32);
  const axis = new THREE.Vector3(0, -0.4, 0.9).normalize();
  const cabin = api.buildCabin(sampleCabin(), parent, 'super', { sourceInterior: true,
    steering: { geometry, position: [0, 0.7, 0.3], axis: axis.toArray() }, material });
  const draws = [];parent.traverse((o) => { if (o.isMesh) draws.push(o); });
  assert.equal(draws.length, 1, 'no generated seats, dashboard or second steering wheel over source cabin');
  assert.equal(cabin.rim.geometry, geometry);assert.equal(cabin.rim.material, material);
  api.poseCabin(cabin, 0.2, { speed: 15, rpm: 4000 });
  const expected = new THREE.Quaternion().setFromAxisAngle(axis, -1);
  assert.ok(cabin.rim.quaternion.angleTo(expected) < 1e-7);
  assert.deepEqual(cabin.rim.position.toArray(), [0, 0.7, 0.3]);
});

test('source instruments fit their measured recess and keep live speed and rpm without a duplicate dashboard', async () => {
  const { THREE, api } = await cabinRenderHarness();
  const parent = new THREE.Group(), layout = sampleCabin();
  layout.instruments = { position: [0, 0.81, 1.04], width: 0.349, height: 0.125, rotation: [0, Math.PI, 0] };
  const cabin = api.buildCabin(layout, parent, 'super', { sourceInterior: true });
  const cluster = cabin.instruments.group, draws = [];
  parent.traverse((o) => { if (o.isMesh) draws.push(o); });
  assert.equal(draws.length, 3, 'only one face and two animated needles, no generic cabin or radio');
  assert.deepEqual(cluster.position.toArray(), layout.instruments.position);
  assert.equal(cluster.rotation.y, Math.PI);
  const face = cluster.children[0].geometry;face.computeBoundingBox();
  const size = face.boundingBox.getSize(new THREE.Vector3()).multiply(cluster.scale);
  assert.ok(size.x <= layout.instruments.width + 1e-7 && size.y <= layout.instruments.height + 1e-7, 'face stays in source dashboard recess');
  assert.equal(cluster.scale.x, cluster.scale.y, 'round dials remain round');
  api.poseCabin(cabin, 0, { speed: 25, rpm: 6000 });
  assert.equal(cabin.instruments.speed.rotation.z, instrumentAngle(90, 360));
  assert.equal(cabin.instruments.revs.rotation.z, instrumentAngle(6000, 10000));
  assert.ok(cluster.matrixWorld.elements.every(Number.isFinite));
});

test('the imported steering normal cannot reverse the wheel relative to the driver hands', async () => {
  const { THREE, api } = await cabinRenderHarness(), L = models.super.cabinLayout;
  const axis = models.super.steering.axis;
  const geometry = new THREE.TorusGeometry(L.radius, 0.02, 8, 32), material = new THREE.MeshStandardNodeMaterial();
  const cabin = api.buildCabin(L, new THREE.Group(), 'super', { sourceInterior: true,
    steering: { geometry, position: L.wheel, axis }, material });
  api.poseCabin(cabin, 0.15);
  const forward = new THREE.Vector3(0, -Math.sin(L.tilt), Math.cos(L.tilt));
  const expected = new THREE.Quaternion().setFromAxisAngle(forward, -0.75);
  assert.ok(cabin.rim.quaternion.angleTo(expected) < 0.001, 'source and generated wheels must follow the same hand rotation');
});

test('the real source cockpit exposes both instruments from its central driving position', async () => {
  const { THREE, api } = await cabinRenderHarness(), model = models.super;
  assert.ok(model.sourceInterior && model.cabinLayout?.instruments, 'source cockpit supplies measured instrument anchors');
  const bytes = readFileSync(join(root, 'assets/cars/super.bin'));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), n = model.vertices;
  const indices = new Uint32Array(buffer, n * (model.normalFormat === 'snorm16' ? 25 : 21) + (4 - n % 4) % 4, model.indices);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffer, 0, n * 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(indices.subarray(model.ranges[0], model.ranges[0] + model.ranges[1]), 1));
  const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const parent = new THREE.Group(), L = model.cabinLayout;
  const cabin = api.buildCabin(L, parent, 'super', { sourceInterior: true });
  parent.add(body);parent.updateMatrixWorld();
  const eye = new THREE.Vector3(L.seat[0], L.seat[1] + 0.74 * Math.cos(L.recline), L.seat[2] - 0.04);
  for (const x of [-0.1075, 0.1075]) {
    const target = cabin.instruments.group.localToWorld(new THREE.Vector3(x, -0.0017, 0));
    const ray = new THREE.Raycaster(eye, target.clone().sub(eye).normalize(), 0.35);
    const hit = ray.intersectObject(body)[0];
    assert.ok(!hit || hit.distance >= eye.distanceTo(target) - 0.001, 'source dashboard must not cover its animated instruments');
  }
});

test('driver sight lines reach both instrument faces and the centre display without hitting their surrounds', async () => {
  const { THREE, api } = await cabinRenderHarness();
  const parent = new THREE.Group(), layout = sampleCabin(), cabin = api.buildCabin(layout, parent, 'sedan');
  const eye = new THREE.Vector3(layout.seat[0], layout.seat[1] + 0.74 * Math.cos(layout.recline), layout.seat[2] - 0.04);
  const ray = new THREE.Raycaster();
  const targets = [new THREE.Vector3(-0.1075, -0.0017, 0), new THREE.Vector3(0.1075, -0.0017, 0),
    new THREE.Vector3(layout.seat[0], -0.065, -0.008)];
  for (const point of targets) {
    const target = cabin.instruments.group.localToWorld(point.clone());
    ray.set(eye, target.clone().sub(eye).normalize());
    const hits = ray.intersectObjects(parent.children, true);
    assert.ok(hits.length, 'driver sees an instrument surface');
    assert.ok(hits[0].object.material.name === 'CarInstruments' || hits[0].object === cabin.instruments.speed || hits[0].object === cabin.instruments.revs,
      `instrument face obscured by ${hits[0].object.name || hits[0].object.material.name}`);
  }
  for (const point of [new THREE.Vector3(0, layout.radius, 0), new THREE.Vector3(-layout.radius, 0, 0), new THREE.Vector3(layout.radius, 0, 0)]) {
    const target = cabin.rim.localToWorld(point.clone());
    ray.set(eye, target.clone().sub(eye).normalize());
    const hits = ray.intersectObjects(parent.children, true);
    assert.equal(hits[0]?.object, cabin.rim, 'the dashboard must sit ahead of the visible steering rim');
  }
});

test('the compact rear bench stays behind its closed rear window instead of protruding through the hatch', async () => {
  const { THREE, api } = await cabinRenderHarness(), model = models.compact;
  const bytes = readFileSync(join(root, 'assets/cars/compact.bin'));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), n = model.vertices;
  const position = new THREE.BufferAttribute(new Float32Array(buffer, 0, n * 3), 3);
  const indices = new Uint32Array(buffer, n * (model.normalFormat === 'snorm16' ? 25 : 21) + (4 - n % 4) % 4, model.indices);
  const glass = new THREE.BufferGeometry().setAttribute('position', position)
    .setIndex(new THREE.BufferAttribute(indices.subarray(model.ranges[2], model.ranges[2] + model.ranges[3]), 1));
  const body = new THREE.BufferGeometry().setAttribute('position', position)
    .setIndex(new THREE.BufferAttribute(indices.subarray(model.ranges[0], model.ranges[0] + model.ranges[1]), 1));
  const L = model.cabinLayout ?? api.cabinLayout(model.spec, glass, position), before = JSON.stringify(L);
  assert.ok(L.rear && glass.index.count > 0, 'a closed rear cabin is present');
  const pieces = api.rearBench(L, 'compact', api.cabinPalette('compact'));
  assert.ok(pieces.length >= 8, 'the fitted bench retains cushions, backrest, bolsters, posts and headrest');
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const envelope = [new THREE.Mesh(body, material), new THREE.Mesh(glass, material)], vertices = new Map();
  for (const piece of pieces) {
    const p = piece.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(p, i);
      vertices.set(point.toArray().map(v => Math.round(v * 1000)).join(','), point);
    }
  }
  assert.ok(vertices.size > 1000, 'the check covers the actual detailed seat surface');
  for (const point of vertices.values()) {
    const ray = new THREE.Raycaster(new THREE.Vector3(point.x, point.y, model.spec.zRear - 1), new THREE.Vector3(0, 0, 1));
    const hit = ray.intersectObjects(envelope)[0];
    assert.ok(hit, 'the backrest has a closed body or glass surface behind it');
    assert.ok(point.z > hit.point.z + 0.008, `rear seat crosses the hatch at ${point.toArray()}`);
  }
  assert.equal(JSON.stringify(L), before, 'driver seat, controls and camera anchors stay unchanged');
});
