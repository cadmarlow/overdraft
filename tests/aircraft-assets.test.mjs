import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import * as TSL from '../vendor/three/build/three.tsl.js';
import { loadModule } from './helpers/module.cjs';

// The two aircraft are real models prepared by tools/aircraft into assets/aircraft. These tests read the shipped files
// with the game's own parser and build them with the game's own module: what the importer wrote must be what the
// flight model stands on (real size, the frame and the origin it expects, wheels where the header says), every part
// that moves must hang on a bone, and nothing of the real aircraft's operators may be left in the credits' way.
const dir = new URL('../assets/aircraft/', import.meta.url);
const source = readFileSync(new URL('../js/aircraft-assets.js', import.meta.url), 'utf8').replaceAll('import.meta.url', '"file:///js/aircraft-assets.js"');
const quiet = { warn() {}, log() {}, error() {} };
const assets = loadModule(source, {
  imports: {
    'three/webgpu': { ...THREE, MeshStandardNodeMaterial: THREE.MeshStandardMaterial, MeshPhysicalNodeMaterial: THREE.MeshPhysicalMaterial, MeshBasicNodeMaterial: THREE.MeshBasicMaterial },
    'three/tsl': TSL
  },
  globals: {
    URL, TextDecoder, DataView, Uint8Array, Int8Array, Uint16Array, Uint32Array, Float32Array, console: quiet,
    // the module fetches its files: here they come from the checkout
    fetch: async (url) => {
      const file = new URL(String(url).split('/').pop(), dir);
      if (!existsSync(file)) return { ok: false, status: 404 };
      const b = readFileSync(file);
      return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    }
  },
  filename: 'aircraft-assets.js'
});
const read = (kind) => {
  const b = readFileSync(new URL(`${kind}.bin`, dir));
  return assets.parseAircraft(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const SPEC = {
  classic: {
    size: ['x', 9.8], axle: 0.95, tyre: -1.52, third: 'wheelTail',
    parts: ['body', 'prop', 'blades', 'rudder', 'elevatorL', 'elevatorR', 'aileronLL', 'aileronLR', 'aileronUL', 'aileronUR', 'wheelL', 'wheelR', 'pilot', 'glass'],
    bones: ['prop', 'rudder', 'elevatorL', 'elevatorR', 'aileronLL', 'aileronLR', 'aileronUL', 'aileronUR', 'wheelL', 'wheelR', 'wheelTail'],
    points: ['wheelL', 'wheelR', 'wheelTail', 'nose', 'tail', 'tipUL', 'tipUR', 'tipLL', 'tipLR', 'belly', 'finTop', 'propHub', 'exhaustL', 'exhaustR', 'eye', 'seat', 'lightL', 'lightR', 'lightTail'],
    numbers: ['wheelLRadius', 'wheelRRadius', 'wheelTailRadius', 'propRadius']
  },
  jet: {
    size: ['z', 16.7], axle: -0.85, tyre: -1.95, third: 'wheelNose',
    parts: ['body', 'gearNose', 'gearL', 'gearR', 'nozzle', 'glass'],
    bones: ['gearNose', 'gearL', 'gearR', 'wheelNose', 'wheelL', 'wheelR', 'nozzle0'],
    points: ['wheelL', 'wheelR', 'wheelNose', 'nose', 'tail', 'tipL', 'tipR', 'belly', 'finTop', 'nozzle', 'eye', 'seat', 'lightL', 'lightR', 'lightTail'],
    numbers: ['wheelLRadius', 'wheelRRadius', 'wheelNoseRadius', 'nozzleRadius']
  }
};
const KINDS = Object.keys(SPEC);
// the box of what a part draws
const boxOf = (data, part) => {
  const m = data.header.materials[part.material], ix = data.indices[part.material], from = m.vertices[0];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = part.start; k < part.start + part.count; k++) for (let c = 0; c < 3; c++) {
    const v = data.position[(from + ix[k]) * 3 + c];
    if (v < lo[c]) lo[c] = v;
    if (v > hi[c]) hi[c] = v;
  }
  return { lo, hi };
};

test('the module knows both aircraft and the shipped files parse', () => {
  assert.deepEqual([...assets.AIRCRAFT_KINDS], KINDS);
  for (const kind of KINDS) {
    const { header, position, normal, uv, uv1, indices } = read(kind);
    assert.equal(header.version, 1);
    assert.equal(header.kind, kind);
    assert.equal(position.length, header.vertices * 3);
    assert.equal(normal.length, header.vertices * 3);
    assert.equal(uv.length, header.vertices * 2);
    if (uv1) assert.equal(uv1.length, header.vertices * 2);
    for (const a of [position, normal, uv]) assert.ok(a.every(Number.isFinite), `${kind}: finite`);
    for (let i = 0; i < normal.length; i += 3 * 997) assert.ok(Math.abs(Math.hypot(normal[i], normal[i + 1], normal[i + 2]) - 1) < 1e-3, `${kind}: unit normals`);
    let triangles = 0;
    header.materials.forEach((m, i) => {
      assert.equal(indices[i].length, m.index.count);
      assert.equal(m.index.count % 3, 0);
      assert.ok(indices[i].every((v) => v < m.vertices[1]), `${kind} ${m.id}: indices inside its own vertices`);
      assert.ok(m.vertices[0] + m.vertices[1] <= header.vertices);
      triangles += m.index.count / 3;
    });
    assert.equal(triangles, header.triangles);
    assert.ok(triangles > 30000 && triangles < 90000, `${kind}: ${triangles} triangles`);
  }
});

test('each material is one run of parts, every part draws something and hangs on a bone that exists', () => {
  for (const kind of KINDS) {
    const { header } = read(kind);
    header.materials.forEach((m, i) => {
      const parts = header.parts.filter((p) => p.material === i).sort((a, b) => a.start - b.start);
      assert.ok(parts.length, `${kind} ${m.id}: has parts`);
      let at = 0;
      for (const part of parts) {
        assert.equal(part.start, at, `${kind} ${m.id}: ${part.name} follows the part before it`);
        assert.ok(part.count > 0 && part.count % 3 === 0, `${kind}: ${part.name} draws triangles`);
        if (part.bone) assert.ok(header.bones[part.bone], `${kind}: ${part.name} hangs on ${part.bone}`);
        at += part.count;
      }
      assert.equal(at, m.index.count, `${kind} ${m.id}: the parts cover the whole run`);
    });
    const names = new Set(header.parts.map((p) => p.name));
    for (const name of SPEC[kind].parts) assert.ok(names.has(name), `${kind}: part ${name}`);
    // few enough materials to be a handful of draw calls
    assert.ok(header.materials.length <= 4, `${kind}: ${header.materials.length} materials`);
  }
});

test('a vertex belongs to one bone only: what moves shares nothing with what stays', () => {
  for (const kind of KINDS) {
    const data = read(kind), { header } = data;
    const owner = new Map();
    for (const part of header.parts) {
      const from = header.materials[part.material].vertices[0], ix = data.indices[part.material], bone = part.bone ?? '';
      for (let k = part.start; k < part.start + part.count; k++) {
        const v = from + ix[k], seen = owner.get(v);
        if (seen === undefined) owner.set(v, bone);
        else assert.equal(seen, bone, `${kind}: vertex ${v} of ${part.name}`);
      }
    }
  }
});

test('bones: a finite pivot, a unit axis, parents listed first; the moving parts lie where their pivots are', () => {
  for (const kind of KINDS) {
    const data = read(kind), { header } = data;
    const names = Object.keys(header.bones);
    for (const name of SPEC[kind].bones) assert.ok(header.bones[name], `${kind}: bone ${name}`);
    for (const [name, bone] of Object.entries(header.bones)) {
      assert.ok(bone.pivot.every(Number.isFinite) && bone.axis.every(Number.isFinite), `${kind} ${name}: finite`);
      assert.ok(Math.abs(Math.hypot(...bone.axis) - 1) < 0.01, `${kind} ${name}: unit axis`);
      if (bone.parent) assert.ok(names.indexOf(bone.parent) >= 0 && names.indexOf(bone.parent) < names.indexOf(name), `${kind} ${name}: parent ${bone.parent} first`);
      // the pivot is on or beside what turns about it
      const parts = header.parts.filter((p) => p.bone === name);
      assert.ok(parts.length, `${kind}: something hangs on ${name}`);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const part of parts) { const b = boxOf(data, part); for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], b.lo[c]); hi[c] = Math.max(hi[c], b.hi[c]); } }
      for (let c = 0; c < 3; c++) assert.ok(bone.pivot[c] > lo[c] - 0.35 && bone.pivot[c] < hi[c] + 0.35, `${kind} ${name}: pivot ${bone.pivot} by its part (${lo.map((v) => v.toFixed(2))} .. ${hi.map((v) => v.toFixed(2))})`);
    }
  }
  // control surfaces: positive stick is a positive turn (pitch: trailing edges up; roll: left up, right down; yaw: trailing edge left)
  const { bones } = read('classic').header;
  for (const name of ['elevatorL', 'elevatorR', 'aileronLL', 'aileronUL']) assert.ok(bones[name].axis[0] > 0.95, `${name} turns about +X`);
  for (const name of ['aileronLR', 'aileronUR']) assert.ok(bones[name].axis[0] < -0.95, `${name} turns about -X`);
  assert.ok(bones.rudder.axis[1] < -0.95, 'the rudder turns about -Y');
  assert.ok(bones.prop.axis[2] > 0.99, 'the propeller turns about +Z');
});

test('real size, the game\'s frame, the origin the flight model uses, symmetric about x = 0', () => {
  for (const kind of KINDS) {
    const data = read(kind), { header } = data, { points, bones, bounds } = header, spec = SPEC[kind];
    // the stated bounds are the geometry's
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.position.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], data.position[i + c]); hi[c] = Math.max(hi[c], data.position[i + c]); }
    for (let c = 0; c < 3; c++) { assert.ok(Math.abs(lo[c] - bounds.min[c]) < 2e-3); assert.ok(Math.abs(hi[c] - bounds.max[c]) < 2e-3); }
    const [axis, size] = spec.size, c = 'xyz'.indexOf(axis), measured = hi[c] - lo[c];
    assert.ok(Math.abs(measured - size) < size * 0.02, `${kind}: ${measured.toFixed(2)} m along ${axis} for ${size}`);
    // symmetric: the box, the main wheels, the tips
    assert.ok(Math.abs(lo[0] + hi[0]) < 0.03, `${kind}: box centred (${(lo[0] + hi[0]).toFixed(3)})`);
    assert.ok(Math.abs(points.wheelL[0] + points.wheelR[0]) < 0.03, `${kind}: main wheels either side`);
    assert.ok(points.wheelL[0] > 0.5 && points.wheelR[0] < -0.5, `${kind}: the left wheel is on +X`);
    assert.ok(Math.abs(points.wheelL[1] - points.wheelR[1]) < 0.01 && Math.abs(points.wheelL[2] - points.wheelR[2]) < 0.01);
    // +Z the nose, +Y up
    assert.ok(points.nose[2] > 2 && points.tail[2] < -4, `${kind}: nose ahead, tail behind`);
    assert.ok(points.finTop[1] > 1 && points.finTop[1] > points.belly[1] + 1.5 && points.finTop[2] < -3, `${kind}: the fin is up and aft`);
    assert.ok(points.eye[1] > points.seat[1] + 0.3, `${kind}: eyes above hips`);
    // the origin: so far ahead of or behind the main axle, so high above the tyres
    for (const side of 'LR') {
      assert.ok(Math.abs(bones[`wheel${side}`].pivot[2] - spec.axle) < 0.01, `${kind}: main axle at z ${bones[`wheel${side}`].pivot[2]}`);
      assert.ok(Math.abs(points[`wheel${side}`][1] - spec.tyre) < 0.005, `${kind}: tyres at y ${points[`wheel${side}`][1]}`);
      assert.ok(Math.abs(points[`wheel${side}`][1] + bones[`wheel${side}`].radius - bones[`wheel${side}`].pivot[1]) < 0.02, `${kind}: the tyre's foot is a radius under its axle`);
    }
    assert.ok(Math.abs(points[spec.third][0]) < 0.03, `${kind}: third wheel on the centre line`);
    // nothing below the tyres but the propeller's sweep
    assert.ok(lo[1] > Math.min(points.wheelL[1], points[spec.third][1]) - 0.01, `${kind}: lowest point ${lo[1].toFixed(3)}`);
    for (const name of spec.points) assert.ok(Array.isArray(points[name]) && points[name].length === 3 && points[name].every(Number.isFinite), `${kind}: point ${name}`);
    for (const name of spec.numbers) assert.ok(points[name] > 0.05 && points[name] < 2, `${kind}: ${name} ${points[name]}`);
    // every point is on or about the aircraft
    for (const name of spec.points) for (let k = 0; k < 3; k++) assert.ok(points[name][k] > lo[k] - 0.05 && points[name][k] < hi[k] + 0.05, `${kind}: ${name} inside the box`);
  }
  const classic = read('classic').header.points, jet = read('jet').header.points;
  assert.ok(classic.wheelTail[2] < -4 && jet.wheelNose[2] > 3, 'a tail wheel behind, a nose wheel ahead');
  assert.ok(classic.propRadius > 1.1 && classic.propRadius < classic.propHub[1] - classic.wheelL[1], 'the propeller clears the ground with the tail up');
  assert.ok(Math.abs(jet.nozzle[0]) < 0.01 && jet.nozzle[2] < -5.5, 'the nozzle is on the centre line, at the tail');
});

test('the wheels are round and square on their axles', () => {
  const round = (kind, name) => {
    const data = read(kind), { header } = data, bone = header.bones[name];
    const part = header.parts.filter((p) => p.bone === name).sort((a, b) => b.count - a.count)[0];
    const from = header.materials[part.material].vertices[0], ix = data.indices[part.material];
    let far = 0, wide = 0;
    for (let k = part.start; k < part.start + part.count; k++) {
      const v = (from + ix[k]) * 3, d = [data.position[v] - bone.pivot[0], data.position[v + 1] - bone.pivot[1], data.position[v + 2] - bone.pivot[2]];
      const along = d[0] * bone.axis[0] + d[1] * bone.axis[1] + d[2] * bone.axis[2];
      far = Math.max(far, Math.hypot(d[0] - along * bone.axis[0], d[1] - along * bone.axis[1], d[2] - along * bone.axis[2]));
      wide = Math.max(wide, Math.abs(along));
    }
    assert.ok(Math.abs(far - bone.radius) < 0.004, `${kind} ${name}: reaches ${far.toFixed(4)} for a radius of ${bone.radius}`);
    assert.ok(wide < bone.radius * 0.75, `${kind} ${name}: a tyre, not a ball`);
    // round: its box is as long as it is tall (to 1 %), for an axle that lies across the aircraft
    if (Math.abs(bone.axis[0]) > 0.999) {
      const b = boxOf(data, part);
      assert.ok(Math.abs((b.hi[1] - b.lo[1]) / (b.hi[2] - b.lo[2]) - 1) < 0.01, `${kind} ${name}: ${(b.hi[1] - b.lo[1]).toFixed(4)} tall, ${(b.hi[2] - b.lo[2]).toFixed(4)} long`);
    }
    assert.ok(Math.abs(bone.axis[0]) > 0.99, `${kind} ${name}: axle across the aircraft`);
  };
  for (const name of ['wheelL', 'wheelR', 'wheelTail']) round('classic', name);
  for (const name of ['wheelL', 'wheelR', 'wheelNose']) round('jet', name);
});

test('the maps named in the headers are shipped, the folder stays light, the licence names both authors', () => {
  let bytes = 0;
  for (const name of readdirSync(dir)) bytes += statSync(new URL(name, dir)).size;
  assert.ok(bytes < 8e6, `assets/aircraft weighs ${(bytes / 1e6).toFixed(2)} MB`);
  for (const kind of KINDS) {
    const { header } = read(kind);
    for (const m of header.materials) for (const [slot, map] of Object.entries(m.maps)) {
      assert.ok(existsSync(new URL(map.file, dir)), `${kind}: ${map.file} (${m.id} ${slot})`);
      assert.match(map.file, /\.webp$/);
      const head = readFileSync(new URL(map.file, dir)).subarray(0, 12).toString('latin1');
      assert.ok(head.startsWith('RIFF') && head.endsWith('WEBP'), `${map.file} is WebP`);
    }
    // the invented names only: nothing of the real types or their operators in what the game reads
    assert.doesNotMatch(JSON.stringify(header), /stearman|boeing|starfighter|lockheed|f-?104|navy|air force|usaf/i);
  }
  const licence = readFileSync(new URL('LICENSE-aircraft.md', dir), 'utf8');
  for (const text of ['Stéphane Agullo', 'Mikhail Zelenov', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/',
    'https://sketchfab.com/3d-models/boeing-stearman-model-75-57035fcd89e7496aa712ca1b522700fd',
    'https://sketchfab.com/3d-models/f-104-starfighter-96e60f2f463b4b1c8822079f1b2e21eb']) assert.ok(licence.includes(text), `licence: ${text}`);
});

test('a model is returned at once, fills when the files arrive, and its parts answer the aircraft\'s state', async () => {
  const flying = (over = {}) => ({
    crashed: false,
    flight: { power: 0, ab: 0, gear: 1, flaps: 0, brake: 0, stickPitch: 0, stickRoll: 0, stickYaw: 0, onGround: false, airspeed: 60,
      wheels: [{ spin: 0, angle: 0 }, { spin: 0, angle: 0 }, { spin: 0, angle: 0 }], damage: { engine: 0, gear: 0 }, ...over }
  });
  const angle = (bone) => 2 * Math.acos(Math.min(1, Math.abs(bone.quaternion.w))) * 180 / Math.PI;
  const settle = (model, a, frames = 240) => { for (let i = 0; i < frames; i++) model.pose(a, 1 / 60); };

  const classic = assets.buildAircraftModel('classic');
  assert.ok(classic.root.isObject3D && classic.root.children.length === 0, 'an empty root at once');
  classic.pose(flying(), 1 / 60); // a no-op until the data is there
  assert.equal(await classic.ready, classic);
  assert.ok(classic.root.children.length > 0);
  assert.deepEqual(classic.points.wheelL, read('classic').header.points.wheelL);
  assert.equal(await assets.loadAircraftModels(), undefined, 'loading again is the same promise');
  const meshes = [];
  classic.root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  assert.ok(meshes.length <= 6, `classic: ${meshes.length} draw calls`);
  assert.ok(meshes.filter((m) => !m.material.transparent).every((m) => m.castShadow), 'opaque parts cast shadows');

  // stick: pull, roll left, nose left
  const a = flying({ stickPitch: 1, stickRoll: 1, stickYaw: 1, power: 1 });
  settle(classic, a);
  const b = classic.bones;
  assert.ok(Math.abs(angle(b.elevatorL.bone) - 25) < 0.5 && Math.abs(angle(b.elevatorR.bone) - 25) < 0.5, 'elevators at 25°');
  assert.ok(Math.abs(angle(b.rudder.bone) - 28) < 0.5, 'rudder at 28°');
  for (const name of ['aileronLL', 'aileronLR', 'aileronUL', 'aileronUR']) assert.ok(Math.abs(angle(b[name].bone) - 25) < 0.5, `${name} at 25°`);
  // a point just behind the left elevator's hinge goes up, behind the right aileron's goes down
  const lifted = (r) => new THREE.Vector3(0, 0, -0.1).applyQuaternion(r.bone.quaternion).y;
  assert.ok(lifted(b.elevatorL) > 0.03 && lifted(b.aileronLL) > 0.03 && lifted(b.aileronUL) > 0.03, 'pull and left roll raise the left trailing edges');
  assert.ok(lifted(b.aileronLR) < -0.03 && lifted(b.aileronUR) < -0.03, 'left roll lowers the right ailerons');
  assert.ok(new THREE.Vector3(0, 0, -0.1).applyQuaternion(b.rudder.bone.quaternion).x > 0.03, 'nose left swings the rudder\'s trailing edge left');
  // propeller: a disc at power, blades when stopped; the pilot only while someone flies
  const disc = classic.root.getObjectByName('Hauturier · Bourrasque propeller disc');
  assert.ok(disc.visible && !classic.meshes.blade.visible, 'at full power the disc has taken over from the blades');
  assert.ok(disc.userData.prop.y > 3 && disc.userData.prop.z > 0.99, 'the smear fills the disc');
  assert.equal(classic.meshes.pilot.visible, true, 'the pilot shows when nobody says otherwise');
  const parked = flying({ onGround: true, airspeed: 0, power: 0 });
  parked.ridden = false;
  settle(classic, parked, 600);
  assert.ok(!disc.visible && classic.meshes.blade.visible && classic.meshes.blade.userData.fade > 0.99, 'parked and empty: the blades stand still');
  assert.equal(classic.meshes.pilot.visible, false);
  const before = b.prop.bone.quaternion.clone();
  classic.pose(parked, 1 / 60);
  assert.ok(before.angleTo(b.prop.bone.quaternion) < 1e-6, 'a stopped propeller does not creep');
  // wheels roll by what the flight model says, on their true radius
  const rolling = flying({ onGround: true });
  rolling.flight.wheels[0].spin = 1;
  classic.pose(rolling, 1 / 60);
  assert.ok(Math.abs(angle(b.wheelL.bone) - (0.3 / b.wheelL.spec.radius) * 180 / Math.PI) < 0.5);
  // a wrecked aircraft's propeller stops at once
  const wreck = flying({ power: 1 });
  settle(classic, wreck, 120);
  wreck.crashed = true;
  settle(classic, wreck, 30);
  assert.ok(!disc.visible, 'no disc on a wreck');

  const jet = assets.buildAircraftModel('jet');
  await jet.ready;
  const jetMeshes = [];
  jet.root.traverse((o) => { if (o.isMesh) jetMeshes.push(o); });
  assert.ok(jetMeshes.length <= 4, `jet: ${jetMeshes.length} draw calls`);
  const j = jet.bones;
  settle(jet, flying({ gear: 1 }));
  for (const name of ['gearL', 'gearR', 'gearNose']) { assert.ok(angle(j[name].bone) < 0.01, `${name} down`); assert.equal(j[name].bone.scale.x, 1); }
  assert.ok(angle(j.doorFwdL.bone) < 0.01 && angle(j.doorMainL.bone) < 0.01 && angle(j.doorNoseL.bone) < 0.01, 'doors as modelled with the gear down');
  settle(jet, flying({ gear: 0.5 }));
  assert.ok(angle(j.gearL.bone) > 20 && angle(j.gearL.bone) < j.gearL.spec.swing - 20, 'legs half folded');
  assert.ok(angle(j.doorFwdL.bone) > 80, 'forward doors open while the legs pass');
  settle(jet, flying({ gear: 0 }));
  for (const name of ['gearL', 'gearR', 'gearNose']) assert.equal(j[name].bone.scale.x, 0, `${name} put away`);
  assert.ok(angle(j.doorFwdL.bone) < 0.01, 'forward doors shut again');
  assert.ok(Math.abs(angle(j.doorMainL.bone) - j.doorMainL.spec.closed) < 0.01 && Math.abs(angle(j.doorNoseR.bone) - j.doorNoseR.spec.closed) < 0.01, 'the other doors closed');
  // the nozzle closes down at full dry power and opens again in reheat
  // how far from the engine's axis a point 30 cm behind a petal's hinge stands
  const tail = (r) => { const p = new THREE.Vector3(0, 0, -0.3).applyQuaternion(r.bone.quaternion).add(new THREE.Vector3().fromArray(r.spec.pivot)); return Math.hypot(p.x, p.y - jet.points.nozzle[1]); };
  settle(jet, flying({ gear: 0, power: 0 }));
  const idle = tail(j.nozzle0);
  settle(jet, flying({ gear: 0, power: 1 }));
  const dry = tail(j.nozzle0);
  settle(jet, flying({ gear: 0, power: 1, ab: 1 }));
  const reheat = tail(j.nozzle0);
  assert.ok(dry < idle - 0.03 && reheat > dry + 0.03, `nozzle: ${idle.toFixed(3)} at idle, ${dry.toFixed(3)} dry, ${reheat.toFixed(3)} in reheat`);
  settle(jet, flying({ gear: 0, stickPitch: 1, flaps: 1, brake: 1 }));
  assert.ok(new THREE.Vector3(0, 0, -1).applyQuaternion(j.stabilator.bone.quaternion).y > 0.2, 'pull raises the tailplane\'s trailing edge');
  assert.ok(new THREE.Vector3(0, 0, -1).applyQuaternion(j.flapL.bone.quaternion).y < -0.4 && new THREE.Vector3(0, 0, -1).applyQuaternion(j.flapR.bone.quaternion).y < -0.4, 'flaps go down, both');
  assert.ok(new THREE.Vector3(0, 0, -1).applyQuaternion(j.brakeL.bone.quaternion).x > 0.5 && new THREE.Vector3(0, 0, -1).applyQuaternion(j.brakeR.bone.quaternion).x < -0.5, 'airbrakes open outwards');
});
