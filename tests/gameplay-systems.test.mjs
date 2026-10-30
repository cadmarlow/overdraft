import test from 'node:test';
import assert from 'node:assert/strict';
import { RoadNavigator } from '../js/navigation.js';
import { WEAPONS, WEAPON_ORDER, castShot, raycastBuildings, lineOfSight, spreadDirection, rayCylinder, rayBox } from '../js/weapons.js';

// A 4 x 4 street grid, 100 m apart, with one missing link (a closed block side)
function grid() {
  const nodes = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) nodes.push({ x: i * 100, z: j * 100 });
  const at = (i, j) => nodes[i * 4 + j];
  const edges = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (i < 3 && !(i === 1 && j === 1)) edges.push({ from: at(i, j), to: at(i + 1, j) });
      if (j < 3) edges.push({ from: at(i, j), to: at(i, j + 1) });
    }
  }
  return { nodes, edges };
}

test('road routes follow the street graph and detour around missing links', () => {
  const nav = new RoadNavigator(grid());
  const path = nav.route(100, 100, 200, 100);
  assert.ok(path.length > 3, 'the direct link is missing, so the route goes round the block');
  assert.deepEqual(path.at(-1), { x: 200, z: 100 });
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1], b = path[i];
    assert.ok(a.x === b.x || a.z === b.z, 'every leg runs along a street');
  }
  assert.equal(RoadNavigator.length(path), 300);
});

test('a route between points sharing an intersection still passes by it', () => {
  const nav = new RoadNavigator(grid());
  const path = nav.route(2, 30, 30, 2);
  assert.equal(path.length, 2);
  assert.deepEqual([path[0].x, path[0].z], [0, 0]);
  assert.deepEqual(path[1], { x: 30, z: 2 });
});

test('nearest and within queries use the spatial grid', () => {
  const nav = new RoadNavigator(grid());
  assert.equal(nav.nodes[nav.nearest(204, 296)].x, 200);
  assert.equal(nav.nodes[nav.nearest(204, 296)].z, 300);
  assert.equal(nav.nearest(5000, 5000, 100), -1);
  assert.equal(nav.within(100, 100, 101).length, 5);
});

test('rays hit upright cylinders and oriented boxes at the right distance', () => {
  close(rayCylinder(0, 1, 0, 1, 0, 0, 10, 0, 0.5, 0, 2, 100), 9.5);
  assert.equal(rayCylinder(0, 3, 0, 1, 0, 0, 10, 0, 0.5, 0, 2, 100), Infinity, 'over the head');
  assert.equal(rayCylinder(0, 1, 0, 1, 0, 0, 10, 0, 0.5, 0, 2, 5), Infinity, 'out of range');
  close(rayBox(0, 1, 0, 1, 0, 0, 10, 0, 0, 0.9, 2.2, 0, 1.5, 100), 9.1);
  // turned a quarter: the car's length now lies across the ray
  close(rayBox(0, 1, 0, 1, 0, 0, 10, 0, Math.PI / 2, 0.9, 2.2, 0, 1.5, 100), 7.8);
});

test('building raycasts respect footprints, heights and polygons', () => {
  const box = { minX: 20, maxX: 30, minZ: -5, maxZ: 5, maxY: 40 };
  const low = { minX: 10, maxX: 12, minZ: -5, maxZ: 5, maxY: 0.8 };
  const poly = { minX: 50, maxX: 60, minZ: -10, maxZ: 10, maxY: 30, polygon: { outer: [{ x: 50, z: 10 }, { x: 60, z: -10 }, { x: 60, z: 10 }], holes: [] } };
  const controllers = { nearColliders: () => [box, low, poly] };
  const out = {};
  close(raycastBuildings(controllers, 0, 1.5, 0, 1, 0, 0, 100, out), 20);
  assert.equal(out.nx, -1);
  assert.equal(out.collider, box);
  // over the low wall, under nothing else
  assert.equal(raycastBuildings({ nearColliders: () => [low] }, 0, 1.5, 0, 1, 0, 0, 100), Infinity);
  // the triangle's hypotenuse at z = 0 is x = 55
  const t = raycastBuildings({ nearColliders: () => [poly] }, 0, 1.5, 0, 1, 0, 0, 100);
  assert.ok(t > 54.7 && t < 55.3, String(t));
  assert.equal(lineOfSight({ nearColliders: () => [box] }, 0, 1.5, 0, 15, 1.5, 0), true);
  assert.equal(lineOfSight({ nearColliders: () => [box] }, 0, 1.5, 0, 40, 1.5, 0), false);
});

test('a shot strikes the nearest target and ignores its shooter', () => {
  const ped = { placed: true, x: 8, z: 0 };
  const shooter = { placed: true, x: 0, z: 0 };
  const traffic = { peds: [shooter, ped], vehicles: [{ edge: {}, x: 15, z: 0, yaw: 0, yawOffset: 0, halfWidth: 0.9, halfL: 2.2 }] };
  const controllers = { nearColliders: () => [{ minX: 30, maxX: 40, minZ: -5, maxZ: 5, maxY: 50 }], getGroundHeight: () => 0 };
  const world = { controllers, traffic, cars: [], actors: [], player: null };
  let hit = castShot(world, 0, 1.2, 0, 1, 0, 0, 100, shooter);
  assert.equal(hit.kind, 'ped');
  assert.equal(hit.target, ped);
  ped.dead = true;
  hit = castShot(world, 0, 1.2, 0, 1, 0, 0, 100, shooter);
  assert.equal(hit.kind, 'traffic');
  close(hit.x, 14.1); // heading +z: the shot meets its 0.9 m side
  traffic.vehicles.length = 0;
  hit = castShot(world, 0, 1.2, 0, 1, 0, 0, 100, shooter);
  assert.equal(hit.kind, 'building');
  hit = castShot(world, 0, 1.2, 0, Math.SQRT1_2, -Math.SQRT1_2, 0, 100, shooter);
  assert.equal(hit.kind, 'ground');
  close(hit.x, 1.2);
});

test('spread directions stay unit length inside the cone', () => {
  const out = {};
  for (let i = 0; i < 200; i++) {
    spreadDirection(0, 0, 1, 0.05, out);
    close(Math.hypot(out.x, out.y, out.z), 1);
    assert.ok(Math.acos(Math.min(1, out.z)) <= 0.051);
  }
});

test('the weapon catalogue is complete and ordered for selection', () => {
  assert.deepEqual(WEAPON_ORDER, ['fists', 'pistol', 'smg', 'shotgun', 'rifle', 'grenade']);
  for (const id of WEAPON_ORDER) {
    const w = WEAPONS[id];
    assert.equal(w.id, id);
    assert.ok(w.interval > 0 && w.name);
    if (w.throwable) assert.ok(w.mag > 0 && w.range > 0);
    else assert.ok(w.damage > 0);
    if (!w.melee && !w.throwable) assert.ok(w.mag > 0 && w.reload > 0 && w.range > 0 && w.sound);
  }
});

function close(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≉ ${expected}`);
}

test('the AI driver slides its steering point along the route and slows for bends', async () => {
  const { AIDriver } = await import('../js/ai-driver.js');
  const calls = [];
  const controllers = { simulateCar: (car, throttle, steer) => calls.push({ throttle, steer }) };
  const nav = { route: () => [{ x: 0, z: 100 }, { x: 100, z: 100 }] };
  const car = { position: { x: 0, z: 0, copy() {} }, heading: 0, speed: 10, mesh: { position: { copy() {} }, rotation: {} } };
  const driver = new AIDriver(controllers, nav, car, { maxSpeed: 30, corner: 8 });
  driver.setGoal(100, 100, true);
  driver.update(0.016);
  assert.equal(driver.path.length, 3, 'the car position starts the route');
  close(driver.aim.x, 0);
  assert.ok(driver.aim.z > 5 && driver.aim.z < 20, 'aims a few metres ahead on the route');
  assert.ok(Math.abs(calls[0].steer) < 0.05 && calls[0].throttle > 0, 'straight on, accelerating');
  // close to the corner the planned speed drops to the cornering speed
  car.position.z = 92; car.speed = 25;
  driver.update(0.016);
  assert.ok(driver.target < 15, `target ${driver.target}`);
  assert.ok(calls.at(-1).throttle < 0, 'brakes into the bend');
  assert.ok(calls.at(-1).steer > 0, 'turns towards +x (the left of a car heading +z)');
});
