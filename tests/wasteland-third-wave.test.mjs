import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import * as plan from '../js/wasteland-plan.js';
import { FRAME, STOREY, frameLevel, frameParts, frameTop, planRuins } from '../js/wasteland-ruins-plan.js';
import { loadModule } from './helpers/module.cjs';

// The third wave of the Wasteland: ruins that hold up to a close look (js/wasteland-ruins-plan.js), the convoys of
// the Rouliers on the Ceinture (js/wasteland-convoy.js) and the full beam of the player's headlights outside the walls.

const { SALT_LINES, insideCity, saltLandAt, saltLoopAhead, saltLoopNearest, saltRoadAt, sampleSalt } = plan;
const { shells, frames } = planRuins();

test('the same ruins stand in the same places every time, on dry ground and clear of the roads', () => {
  const again = planRuins();
  assert.deepEqual(again.shells.slice(0, 40), shells.slice(0, 40));
  assert.deepEqual(again.frames.map(f => [f.x, f.z, f.storeys]), frames.map(f => [f.x, f.z, f.storeys]));
  assert.ok(shells.length > 2500 && frames.length > 80 && frames.length < 400, `${shells.length} shells, ${frames.length} frames`);
  const road = {};
  for (const r of shells) {
    assert.ok(saltLandAt(r.x, r.z) && !insideCity(r.x, r.z));
    if (saltRoadAt(r.x, r.z, road)) assert.ok(road.distance - road.half > Math.max(r.w, r.d) / 2, 'a shell stands on a road');
  }
  for (const f of frames) {
    for (const [i, j] of [[0, 0], [f.nx, 0], [0, f.nz], [f.nx, f.nz]]) assert.ok(saltLandAt(f.x + (i - f.nx / 2) * FRAME.bay, f.z + (j - f.nz / 2) * FRAME.bay));
    if (saltRoadAt(f.x, f.z, road)) assert.ok(road.distance - road.half > Math.max(f.nx, f.nz) * FRAME.bay / 2, 'a frame stands on a road');
  }
  // nothing is built where a camp is
  const camp = { x: shells[100].x, z: shells[100].z, r: 30 };
  const without = planRuins([camp]);
  assert.ok(!without.shells.some(r => Math.abs(r.x - camp.x) < 20 && Math.abs(r.z - camp.z) < 20));
});

test('what a traveller sees first through the Great Gate is built to be looked at', () => {
  const near = (r) => Math.abs(r.x - plan.NORTH_GATE.x) < 420 && r.z < plan.WALL_Z && r.z > plan.WALL_Z - 900;
  assert.ok(frames.filter(near).length >= 20, `${frames.filter(near).length} frames by the gate`);
  const floored = shells.filter(r => near(r) && r.floors.length);
  assert.ok(floored.length >= 30, `${floored.length} shells with floors by the gate`);
});

test('the floors left in a shell are a storey apart, under the bitten walls, the last one whole', () => {
  const floored = shells.filter(r => r.floors.length);
  assert.ok(floored.length > 300);
  for (const r of floored) {
    r.floors.forEach((f, n) => {
      assert.ok(Math.abs((f.y - r.y) / STOREY - Math.round((f.y - r.y) / STOREY)) < 1e-9, 'on a storey line, where the windows are');
      if (n) assert.ok(Math.abs(f.y - r.floors[n - 1].y - STOREY) < 1e-9);
      assert.ok(f.keep >= 0.45 && f.keep <= 1);
    });
    const last = r.floors.at(-1), ground = sampleSalt(r.x, r.z);
    assert.equal(last.keep, 1);
    assert.equal(last.sky, 1);
    assert.equal(r.roof, last.y, 'a body lands on a floor that is drawn');
    assert.ok(last.y < r.y + r.h * 0.66 - 3, 'below the lowest the walls are bitten to');
    assert.ok(r.floors[0].y > ground + 2.3, 'head room over the sand inside');
  }
  for (const r of shells.filter(r => !r.floors.length)) assert.equal(r.roof, r.y + r.h * 0.8);
});

const blocked = (colliders, x, y, z) => colliders.some(c => x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ && y > c.minY && y < c.maxY);

test('a frame is open at street level: a car drives in under the first slab and between the columns', () => {
  let open = 0, bays = 0;
  for (const frame of frames) {
    const { boxes, colliders, props, clearance } = frameParts(frame);
    assert.ok(clearance > 2.6, `only ${clearance.toFixed(2)} m under the first slab`);
    assert.ok(boxes.length > 15 && boxes.every(b => b.sx > 0 && b.sy > 0 && b.sz > 0 && b.sky >= 0 && b.sky <= 1));
    assert.ok(props.length >= 4);
    const x0 = frame.x - frame.nx * FRAME.bay / 2, z0 = frame.z - frame.nz * FRAME.bay / 2;
    for (let i = 0; i < frame.nx; i++) for (let j = 0; j < frame.nz; j++) {
      bays++;
      if (!blocked(colliders, x0 + (i + 0.5) * FRAME.bay, frame.high + 1, z0 + (j + 0.5) * FRAME.bay)) open++;
    }
    // every column stops a car, at every corner of the grid, even the stumps where the building gave way
    for (const [i, j] of [[0, 0], [frame.nx, frame.nz], [1, 1]]) assert.ok(blocked(colliders, x0 + i * FRAME.bay, frame.y + 0.5, z0 + j * FRAME.bay));
    // the slabs that stand carry a body; nothing is drawn above the number of storeys
    const standing = [];
    for (let i = 0; i < frame.nx; i++) for (let j = 0; j < frame.nz; j++) standing.push(frameTop(frame, i, j));
    assert.ok(Math.max(...standing) <= frame.storeys && Math.max(...standing) >= 1);
    assert.ok(Math.min(...standing) < Math.max(...standing) || frame.storeys <= 2, 'one corner has given way');
    const top = Math.max(...boxes.filter(b => !b.rx && !b.rz && b.sy === FRAME.slab).map(b => b.y + b.sy / 2));
    assert.ok(Math.abs(top - frameLevel(frame, Math.max(...standing))) < 1e-6);
  }
  assert.ok(open / bays > 0.8, `${(100 * open / bays).toFixed(0)} % of the bays are open at street level`);
});

test('the Ceinture is a ring a convoy can follow either way round', () => {
  const ring = SALT_LINES[0].path, n = ring.length - 1;
  const near = saltLoopNearest(-3500, 300);
  assert.ok(near.distance < 120 && near.index >= 0 && near.index < n);
  for (const direction of [1, -1]) {
    const road = saltLoopAhead(near.index, direction, 900);
    let run = 0;
    for (let i = 1; i < road.length; i++) {
      run += Math.hypot(road[i].x - road[i - 1].x, road[i].z - road[i - 1].z);
      assert.equal(road[i].index, (road[i - 1].index + direction + n) % n);
    }
    assert.ok(run >= 900 && run < 900 + 95, `${run.toFixed(0)} m of road`);
    assert.ok(road.every(p => saltLandAt(p.x, p.z)));
  }
  // over the seam of the list
  const seam = saltLoopAhead(n - 2, 1, 400);
  assert.deepEqual(seam.slice(0, 4).map(p => p.index), [n - 2, n - 1, 0, 1]);
  assert.equal(saltLoopAhead(1, -1, 300)[2].index, n - 1);
  assert.ok(saltLoopAhead(0, 1, 1e9).length <= n + 1, 'once round and no more');
});

const convoy = loadModule(readFileSync(new URL('../js/wasteland-convoy.js', import.meta.url), 'utf8'), {
  imports: { 'three/webgpu': THREE, 'three/tsl': {}, './ai-driver.js': { AIDriver: class {} }, './tsl-materials.js': { cityUniforms: {} }, './wasteland-plan.js': plan },
  globals: { Math, Array, Object }, filename: 'wasteland-convoy.js'
});

test('a column comes onto the road in line, a gap apart, every truck facing the way it goes', () => {
  const { CONVOY, columnPlaces } = convoy;
  const near = saltLoopNearest(-3500, 300);
  for (const direction of [1, -1]) {
    const head = saltLoopAhead(near.index, -direction, CONVOY.spawn).at(-1);
    assert.ok(Math.hypot(head.x + 3500, head.z - 300) > CONVOY.spawn * 0.7, 'out of sight of whoever stands by the road');
    const back = saltLoopAhead(head.index, -direction, CONVOY.gap * 4 + 200), places = columnPlaces(back, 4, CONVOY.gap);
    assert.equal(places.length, 4);
    assert.ok(Math.hypot(places[0].x - head.x, places[0].z - head.z) < 1e-9);
    const way = saltLoopAhead(head.index, direction, 200), ahead = Math.atan2(way[1].x - way[0].x, way[1].z - way[0].z);
    places.forEach((p, i) => {
      assert.ok(saltLandAt(p.x, p.z));
      if (i) assert.ok(Math.abs(Math.hypot(p.x - places[i - 1].x, p.z - places[i - 1].z) - CONVOY.gap) < 1.5);
      const turn = Math.abs(Math.atan2(Math.sin(p.heading - ahead), Math.cos(p.heading - ahead)));
      assert.ok(turn < 0.6, `truck ${i} faces ${turn.toFixed(2)} rad off the road`);
    });
  }
});

test('a truck keeps its place: faster when the gap opens, slower when it closes, never past its own best', () => {
  const { CONVOY, followSpeed } = convoy;
  assert.equal(followSpeed(17, CONVOY.gap, 26), 17);
  assert.ok(followSpeed(17, CONVOY.gap + 10, 26) > 17);
  assert.ok(followSpeed(17, CONVOY.gap - 10, 26) < 17);
  assert.equal(followSpeed(17, 2, 26), followSpeed(17, 2, 26));
  assert.equal(followSpeed(0, 3, 26), 0);
  assert.equal(followSpeed(30, 200, 26), 26);
  assert.ok(CONVOY.far > CONVOY.spawn * 1.5 && CONVOY.loot > 0 && CONVOY.cruise < 26);
});
