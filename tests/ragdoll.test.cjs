const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
}
class Q { }
const skeleton = loadModule(readFileSync(join(__dirname, '../js/human-skeleton.js'), 'utf8'));
const { Ragdoll, collapse } = loadModule(readFileSync(join(__dirname, '../js/ragdoll.js'), 'utf8'), {
  imports: { 'three/webgpu': { Vector3: V3, Quaternion: Q }, './human-skeleton.js': skeleton }
});

// A standing body: every joint where the bind pose has it, carried unrotated
function standingRig() {
  const bind = skeleton.bindJointPositions(false).map((p) => new V3(...p));
  return {
    bind, s: 1, x: 0, z: 0,
    readBone(b, q) { return q; },
    carried(bone, point, q, out) { return out.copy(point); }
  };
}

const height = (body, i) => body.p[i * 3 + 1];
const STEP = 1 / 60;

test('a body left alone falls to the ground and stays there', () => {
  const body = new Ragdoll(standingRig(), () => 0);
  body.hit(0, 1.3, 0, 2, 0, 0, STEP);
  for (let i = 0; i < 600 && !body.asleep; i++) body.step(STEP);
  assert.equal(body.asleep, true, 'it comes to rest');
  assert.ok(height(body, 3) < 0.6, `head at ${height(body, 3)}`);
  for (let i = 0; i < 18; i++) assert.ok(height(body, i) >= -0.01, `joint ${i} is above the ground`);
});

test('bones keep their length through the fall', () => {
  const body = new Ragdoll(standingRig(), () => 0);
  body.hit(0, 0.4, 0, 6, 1, 0, STEP, 1);
  const rods = body.links.filter((l) => l.len && l.stiff === 1);
  for (let i = 0; i < 180; i++) body.step(STEP);
  for (const l of rods) assert.ok(Math.abs(body.dist(l.a, l.b) - l.len) < l.len * 0.25, `${l.a}-${l.b}`);
});

test('a harder blow throws the body further', () => {
  const travel = (force) => {
    const body = new Ragdoll(standingRig(), () => 0);
    body.hit(0, 1, 0, force, 1, 0, STEP, 2);
    for (let i = 0; i < 240; i++) body.step(STEP);
    return body.p[0];
  };
  assert.ok(travel(9) > travel(3) + 0.3);
});

test('collapse leaves the rig limp, with whatever it was aiming forgotten', () => {
  const rig = standingRig();
  rig.aim = { x: 1, y: 1, z: 1 };
  rig.punch = 1;
  const body = collapse(rig, { ground: () => 0, dirX: 1, dirZ: 0, cause: 'vehicle' });
  assert.equal(rig.limp, body);
  assert.equal(rig.aim, null);
  assert.equal(rig.punch, 0);
});
