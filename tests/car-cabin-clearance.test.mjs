import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import * as TSL from '../vendor/three/build/three.tsl.js';
import { openCabinGeometry } from '../js/car-cabin-clearance.js';

const { loadModule } = createRequire(import.meta.url)('./helpers/module.cjs');
const utils = loadModule(readFileSync(new URL('../vendor/three/examples/jsm/utils/BufferGeometryUtils.js', import.meta.url), 'utf8'), { imports: { three: THREE } });
const canvas = new Proxy({ createRadialGradient: () => ({ addColorStop() {} }) }, { get: (o, k) => k in o ? o[k] : () => {} });
const { cabinLayout, buildCabin } = loadModule(readFileSync(new URL('../js/car-cabin.js', import.meta.url), 'utf8'), {
  imports: { 'three/webgpu': THREE, 'three/tsl': TSL, 'three/addons/utils/BufferGeometryUtils.js': utils },
  globals: { document: { createElement: () => ({ getContext: () => canvas }) } }
});
const manifest = JSON.parse(readFileSync(new URL('../assets/cars/models.json', import.meta.url)));
const fleet = Object.entries(manifest).map(([kind, entry]) => {
  const bytes = readFileSync(new URL(`../assets/cars/${kind}.bin`, import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), n = entry.vertices;
  const position = new THREE.BufferAttribute(new Float32Array(buffer, 0, n * 3), 3);
  const Type = entry.normalFormat === 'snorm16' ? Int16Array : Int8Array;
  const normal = new THREE.BufferAttribute(new Type(buffer, n * 12, n * 4), 4, true);
  const indices = new Uint32Array(buffer, n * (entry.normalFormat === 'snorm16' ? 25 : 21) + (4 - n % 4) % 4, entry.indices);
  const part = (r, count = entry.ranges[r + 1]) => new THREE.BufferGeometry()
    .setAttribute('position', position).setAttribute('normal', normal)
    .setIndex(new THREE.BufferAttribute(indices.subarray(entry.ranges[r], entry.ranges[r] + count), 1));
  const body = part(0), glass = part(2), shell = part(0, entry.ranges[1] + entry.ranges[3]);
  const layout = entry.cabinLayout ?? cabinLayout(entry.spec, glass, position);
  return { kind, entry, layout, body, glass, shell, wheels: [6, 8, 10, 12].map(r => part(r)) };
});
const triangleKeys = g => {
  const set = new Set();
  for (let at = 0; at < g.index.count; at += 3) set.add([g.index.getX(at), g.index.getX(at + 1), g.index.getX(at + 2)].join(','));
  return set;
};
const openedModel = m => m.entry.sourceInterior ? m.body : openCabinGeometry(m.body, m.entry.spec, m.layout);

test('all fifteen source models keep shared attributes, traffic shells, glazing and wheels immutable', () => {
  assert.equal(fleet.length, 15);
  for (const m of fleet) {
    const original = m.body.index.array.slice(), traffic = m.shell.index.array.slice();
    const glazing = m.glass.index.array.slice(), wheels = m.wheels.map(g => g.index.array.slice());
    const opened = openedModel(m);
    assert.equal(opened.attributes.position, m.body.attributes.position, m.kind);
    assert.equal(opened.attributes.normal, m.body.attributes.normal, m.kind);
    assert.deepEqual(m.body.index.array, original, `${m.kind}: original body`);
    assert.deepEqual(m.shell.index.array, traffic, `${m.kind}: traffic shell`);
    assert.deepEqual(m.glass.index.array, glazing, `${m.kind}: glass`);
    m.wheels.forEach((g, i) => assert.deepEqual(g.index.array, wheels[i], `${m.kind}: wheel ${i}`));
    if (opened !== m.body) assert.notEqual(opened.index.array.buffer, m.body.index.array.buffer, `${m.kind}: private index`);
    const source = triangleKeys(m.body);
    for (const key of triangleKeys(opened)) assert.ok(source.has(key), `${m.kind}: triangle orientation and vertices preserved`);
  }
});

test('real exterior hood, roof, door edges, floor and boot triangles survive the opening', () => {
  let protectedTriangles = 0;
  for (const m of fleet) {
    const { layout: L, entry, body } = m, kept = triangleKeys(openedModel(m));
    if (entry.sourceInterior) { assert.equal(kept.size, triangleKeys(body).size); continue; }
    const p = body.attributes.position;
    const side = Math.min(entry.spec.halfW * 0.98, L.width / 0.92 + 0.015);
    const floor = Math.max(entry.spec.sill ?? 0, L.seat[1] - 0.26);
    for (let at = 0; at < body.index.count; at += 3) {
      const ids = [body.index.getX(at), body.index.getX(at + 1), body.index.getX(at + 2)];
      const xs = ids.map(i => p.getX(i)), ys = ids.map(i => p.getY(i)), zs = ids.map(i => p.getZ(i));
      if (Math.max(...zs) > L.dash[1] + 0.025 || Math.max(...ys) >= L.roof - 0.04
        || Math.min(...ys) <= floor || xs.some(x => Math.abs(x) >= side)
        || Math.max(...zs) <= L.seat[2] - 0.6) {
        protectedTriangles++;
        assert.ok(kept.has(ids.join(',')), `${m.kind}: exterior triangle ${at / 3}`);
      }
    }
  }
  assert.ok(protectedTriangles > 15000, 'the protection covers actual fleet bodywork, not a handful of fixtures');
});

test('outside raycasts preserve the actual roof, hood, boot and door silhouettes across the fleet', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  let verified = 0;
  for (const m of fleet) {
    const { spec: s } = m.entry, L = m.layout;
    const oldMesh = new THREE.Mesh(m.body, material), newMesh = new THREE.Mesh(openedModel(m), material);
    const glass = new THREE.Mesh(m.glass, material);
    const compare = (origin, direction, accept) => {
      const ray = new THREE.Raycaster(origin, direction), old = ray.intersectObjects([oldMesh, glass])[0];
      if (!old || !accept(old)) return;
      const next = ray.intersectObjects([newMesh, glass])[0];
      assert.ok(next && next.point.distanceTo(old.point) < 1e-7, `${m.kind}: exterior ray changed at ${old.point.toArray()}`);
      verified++;
    };
    for (let xi = -4; xi <= 4; xi++) for (let n = 1; n < 16; n++) {
      const x = xi * 0.2, z = s.zRear + (s.zFront - s.zRear) * n / 16;
      compare(new THREE.Vector3(x * s.halfW, s.height + 2, z), new THREE.Vector3(0, -1, 0),
        h => h.point.y >= L.roof - 0.025 || h.point.z > L.dash[1] + 0.05 || h.point.z < L.seat[2] - 0.65);
    }
    for (const sign of [-1, 1]) for (let yi = 1; yi < 10; yi++) for (let n = 1; n < 16; n++) {
      const y = s.sill + (L.roof - s.sill) * yi / 10, z = s.zRear + (s.zFront - s.zRear) * n / 16;
      compare(new THREE.Vector3(sign * (s.halfW + 2), y, z), new THREE.Vector3(-sign, 0, 0),
        h => Math.abs(h.face.normal.x) > 0.65 && Math.abs(h.point.x) > s.halfW * 0.72);
    }
    for (const sign of [-1, 1]) for (let xi = -4; xi <= 4; xi++) for (let yi = 1; yi < 10; yi++) {
      const y = s.sill + (L.roof - s.sill) * yi / 10;
      compare(new THREE.Vector3(xi * 0.2 * s.halfW, y, sign > 0 ? s.zFront + 2 : s.zRear - 2), new THREE.Vector3(0, 0, -sign),
        h => h.object === glass || (Math.abs(h.face.normal.z) > 0.65
          && (h.point.z > L.dash[1] || h.point.z < L.seat[2] - 0.65)));
    }
  }
  assert.ok(verified > 4000, `${verified} exterior samples verified`);
});

test('all fleet instruments and steering sightlines remain clear for generated and source cabins', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  let verified = 0;
  for (const m of fleet) {
    const { layout: L } = m, scene = new THREE.Group();
    const cabin = buildCabin(L, scene, m.kind, { sourceInterior: m.entry.sourceInterior });
    scene.updateMatrixWorld(true);
    const eye = new THREE.Vector3(L.seat[0], L.seat[1] + 0.74 * Math.cos(L.recline), L.seat[2] - 0.04);
    const targets = [-0.1075, 0.1075].map(x => cabin.instruments.group.localToWorld(new THREE.Vector3(x, -0.0017, 0)));
    if (m.entry.sourceInterior) targets.push(new THREE.Vector3().fromArray(L.wheel));
    else for (const [x, y] of [[0, L.radius], [-L.radius, 0], [L.radius, 0]]) targets.push(cabin.rim.localToWorld(new THREE.Vector3(x, y, 0)));
    const opened = new THREE.Mesh(openedModel(m), material);
    for (const [i, target] of targets.entries()) {
      const ray = new THREE.Raycaster(eye, target.clone().sub(eye).normalize(), 0.05, eye.distanceTo(target) - 0.003);
      verified++;
      assert.equal(ray.intersectObject(opened).length, 0, `${m.kind}: ${['speed', 'rpm', 'wheelTop', 'wheelLeft', 'wheelRight'][i]} obstructed`);
    }
  }
  assert.equal(verified, fleet.reduce((n, m) => n + (m.entry.sourceInterior ? 3 : 5), 0));
});

test('only wholly internal disconnected accessories are removed, including across split UV vertices', () => {
  const left = new THREE.BoxGeometry(0.18, 0.18, 0.18).translate(-0.3, 0.9, 0.4).toNonIndexed();
  const right = new THREE.BoxGeometry(0.18, 0.18, 0.18).translate(0.3, 0.9, 0.4).toNonIndexed();
  const points = [...left.attributes.position.array, ...right.attributes.position.array,
    0.21, 0.81, 0.31, 1.2, 0.81, 0.31, 0.21, 0.8, 0.31];
  const body = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  body.setIndex(Array.from({ length: points.length / 3 }, (_, i) => i));
  const L = { seat: [0.3, 0.4, 0], dash: [1, 1.1], width: 0.85, roof: 1.5, back: -1 };
  const opened = openCabinGeometry(body, { halfW: 1, sill: 0.1 }, L);
  assert.equal(opened.index.count, right.attributes.position.count + 3, 'the box connected to an exterior vertex survives as one component');
  assert.ok([...opened.index.array].every(i => i >= left.attributes.position.count), 'only the disconnected internal box disappears');
});

test('tapered pillars inside the widest body section survive a dashboard opening', () => {
  // Real sedan/SUV faces lost by the old fascia box, measured with exterior side rays. A connected upper
  // vertex rules out accessory removal, so this specifically catches a fascia cut reaching the exterior skin.
  const pillars = [
    { halfW: 0.916, L: { seat: [0.3664, 0.4695, -0.0218], wheel: [0.3664, 0.7895, 0.4982],
      dash: [0.9195, 1.1282], width: 0.7024, roof: 1.2972, back: -2.3624 },
      points: [[-0.7123017, 1.0698441, 0.6432982], [-0.6934837, 1.1114265, 0.6059913], [-0.7014505, 1.1030262, 0.5930392]] },
    { halfW: 0.958, L: { seat: [0.42, 0.7964, 0.0095], wheel: [0.42, 1.1164, 0.5295],
      dash: [1.2464, 1.1595], width: 1.0182, roof: 1.6328, back: -2.3741 },
      points: [[-0.7805337, 1.2724255, 0.9143096], [-0.7889344, 1.2373624, 0.9953267], [-0.7719981, 1.2952584, 0.9432048]] }
  ];
  for (const { halfW, L, points } of pillars) {
    const positions = [...points, [-halfW, L.roof + 0.1, 0.6]];
    const body = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions.flat(), 3));
    body.setIndex([0, 1, 2, 0, 3, 1]);
    assert.equal(openCabinGeometry(body, { halfW, sill: 0.1 }, L), body, 'both the pillar skin and its connected roof edge stay intact');
  }
});

// Exact intersected faces and camera anchors from the former models' photographed wheel/dashboard bugs.
// Keep these regressions independent from the replacement fleet: a new model must not be required to contain an old defect.
const photographedInteriorFixtures = [
  { kind: 'compact', spec: {"halfW":0.755,"sill":0.312},
    layout: { seat: [0.3153013,0.5061172,0.0070661], wheel: [0.3153013,0.8412682,0.5270661], dash: [0.9712682,1.1570661],
      recline: 0.42000000000000004, width: 0.6043275356292724, roof: 1.3096354246139525, back: -1.713652491569519 },
    points: [[0.42559,1.15591,0.3999],[0.18097,1.04831,0.34349],[0.15853,0.99825,0.32123]],
    triangles: [
      [0.303277,1.1489545,0.3895688],
      [0.4504525,1.1636034,0.4113133],
      [0.443128,1.1489545,0.3895689],
      [0.1902059,1.0745656,0.3547777],
      [0.1471748,0.9424968,0.323191],
      [0.1471748,0.9539412,0.2986999],
      [0.1357304,1.018259,0.3435622],
      [0.1902059,1.0745656,0.3547777],
      [0.1471748,0.9539412,0.2986999]
    ] },
  { kind: 'offroad', spec: {"halfW":0.958,"sill":0.5},
    layout: { seat: [0.3861845,0.7226232,-0.6148129], wheel: [0.3861845,1.0998758,-0.0948129], dash: [1.2298758,0.5351871],
      recline: 0.42000000000000004, width: 0.7401869797706604, roof: 1.5261414289474486, back: -1.758324384689331 },
    points: [[0.429,1.299,0.29]],
    triangles: [
      [0.1753231,1.1973209,0.2627215],
      [0.5541173,1.3547964,0.3049772],
      [0.6987323,1.2946932,0.2889671]
    ] },
  { kind: 'truck', spec: {"halfW":1.18,"sill":0.401},
    layout: { seat: [0.42,1.111483,1.8532158], wheel: [0.42,1.431483,2.3732158], dash: [1.561483,3.0032158],
      recline: 0.30000000000000016, width: 1.014172306060791, roof: 2.1950670719146728, back: 1.6153287887573242 },
    points: [[0.631,1.647,2.438],[0.617,1.579,2.275]],
    triangles: [
      [0.5622198,1.6463341,2.4458032],
      [0.5619807,1.6602197,2.4598262],
      [0.7441497,1.6419678,2.420578],
      [0.6526409,1.6195691,2.2675648],
      [0.6418856,1.5495871,2.2177608],
      [0.5285079,1.5487446,2.2177632],
      [0.5323449,1.5261459,2.2317052],
      [0.6383855,1.526934,2.2317028],
      [0.6569183,1.6142907,2.2914271],
      [0.5684851,1.6089391,2.2960067],
      [0.6284976,1.5763003,2.2724519],
      [0.5689749,1.5429094,2.2488997]
    ] },
  { kind: 'van', spec: {"halfW":1.028,"sill":0.5},
    layout: { seat: [0.42,1.0336776,0.923585], wheel: [0.42,1.3536776,1.443585], dash: [1.4836776,2.073585],
      recline: 0.31893123677707813, width: 0.8887028551101684, roof: 1.8693001508712768, back: 0.8485955595970154 },
    points: [[0.672,1.429,1.616],[0.161,1.432,1.638]],
    triangles: [
      [0.2081843,1.4290347,1.6308887],
      [0.5250946,1.4406214,1.6404517],
      [0.6917657,1.4286137,1.6137315],
      [0.6819871,1.4195418,1.7057053],
      [0.2081843,1.4290347,1.6308887],
      [0.6917657,1.4286137,1.6137315],
      [0.0326548,1.4311335,1.6230133],
      [0.0534178,1.3995007,1.8682767],
      [0.5250946,1.4406214,1.6404517]
    ] }
];

test('photographed legacy wheel and dashboard faces are removed without requiring the new fleet to retain old defects', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const fixture of photographedInteriorFixtures) {
    const { kind, layout: L } = fixture;
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(fixture.triangles.flat(), 3));
    geometry.setIndex(Array.from({ length: fixture.triangles.length }, (_, i) => i));
    const old = new THREE.Mesh(geometry, material), opened = new THREE.Mesh(openCabinGeometry(geometry, fixture.spec, L), material);
    const eye = new THREE.Vector3(L.seat[0], L.seat[1] + 0.74 * Math.cos(L.recline), L.seat[2] - 0.04);
    for (const point of fixture.points) {
      const target = new THREE.Vector3().fromArray(point);
      const ray = new THREE.Raycaster(eye, target.clone().sub(eye).normalize(), 0.35, eye.distanceTo(target) + 0.01);
      assert.ok(ray.intersectObject(old).length, kind + ': photographed obstruction reproduced');
      assert.equal(ray.intersectObject(opened).length, 0, kind + ': photographed obstruction removed');
    }
  }
});

test('missing layouts and explicitly supplied source interiors are untouched', () => {
  const { body, entry, layout } = fleet[0];
  assert.equal(openCabinGeometry(body, entry.spec, null), body);
  assert.equal(openCabinGeometry(body, entry.spec, { ...layout, width: NaN }), body);
  assert.equal(openCabinGeometry(body, { ...entry.spec, sourceInterior: true }, layout), body);
  assert.equal(openCabinGeometry(body, entry.spec, { ...layout, sourceInterior: true }), body);
  const source = fleet.find(m => m.entry.sourceInterior);
  assert.ok(source, 'fleet includes its imported source cabin');
  assert.equal(openedModel(source), source.body, 'source interior is excluded from generic-cabin opening');
});
