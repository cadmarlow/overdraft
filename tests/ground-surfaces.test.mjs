import assert from 'node:assert/strict';
import test from 'node:test';
import { createGroundSurfaces, groundFootprint, groundBoundaryColliders } from '../js/ground-surfaces.js';
import { polygonBoxOverlaps, polygonContact } from '../js/building-collision.js';
import { loadModule } from './helpers/module.cjs';
import { readFileSync } from 'node:fs';

const rect = (x0, x1, z0, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

test('park sidewalks, coping and lawns have their rendered heights, with no ramp outside their outlines', () => {
  const ground = createGroundSurfaces(), hit = {};
  ground.add(rect(-8, 100, -100, 100), 0.22);
  ground.add(rect(0, 100, -100, 100), 1.05);
  ground.add(rect(0.6, 100, -100, 100), 1.19, { grip: 0.62, curb: false });
  for (const [x, expected] of [[-4, 0.22], [-0.01, 0.22], [0.3, 1.05], [0.61, 1.19], [70, 1.19]]) {
    assert.ok(ground.sample(x, -32, hit));
    assert.equal(hit.y, expected);
    assert.equal(hit.ny, 1);
  }
  assert.equal(hit.grip, 0.62);
  assert.equal(ground.sample(-8.01, 0, hit), false, 'the roadway outside the curb remains lower');
  assert.equal(ground.sample(5, 101, hit), false, 'bounds do not create an infinite surface');
});

test('sloping paths sample the rendered triangles, including their shared edges and surface normals', () => {
  const ground = createGroundSurfaces(), hit = {};
  ground.add(rect(-1, 11, -1, 11), 0.22);
  ground.addTriangles([0, 1, 0, 10, 2, 0, 10, 2, 10, 0, 1, 10], [0, 1, 2, 0, 2, 3], { grip: 0.7 });
  for (const [x, z] of [[0, 0], [2, 2], [5, 5], [8, 3], [10, 10]]) {
    ground.sample(x, z, hit);
    assert.ok(Math.abs(hit.y - (1 + x / 10)) < 1e-6);
    assert.ok(Math.abs(hit.nx / hit.ny + 0.1) < 1e-6);
    assert.equal(hit.grip, 0.7);
  }
  ground.sample(-0.1, 5, hit);
  assert.equal(hit.y, 0.22);
});

test('a long park boundary stops car bodies at every segment and leaves the lawn interior open', () => {
  const walls = groundBoundaryColliders(rect(0, 200, 0, 120), rect(0.6, 199.4, 0.6, 119.4), 0, 1.05);
  const body = { car: true, hx: 0.9, hz: 2.3, sin: 1, cos: 0 };
  for (let z = 4; z < 116; z += 0.5) {
    assert.ok(walls.some(w => polygonContact(w.polygon, -1, z, body, null)), `wall at z=${z}`);
  }
  assert.ok(walls.every(w => !polygonBoxOverlaps(w.polygon, 100, 60, 2, 2)), 'no solid box across the park');
  assert.ok(walls.every(w => w.maxY === 1.05 && Math.max(w.maxX - w.minX, w.maxZ - w.minZ) < 25));
});

test('traffic excludes large park sidewalks and exact irregular outlines while leaving real roadway open', () => {
  const source = name => readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8');
  const { buildRoadNetwork } = loadModule(source('road-network'), { imports: {
    './city-config.js': { ALL_AVENUES: [], ALL_STREETS: [], BLOCKS: [], ISLAND_BOUNDS: { minZ: -100, maxZ: 100 }, getIslandBoundsAtZ: () => ({ westX: -1000, eastX: 1000 }) },
    './nyc-geodata.js': { GEO: {} }, './building-collision.js': { polygonBoxOverlaps },
    './road-layout.js': loadModule(source('road-layout'))
  } });
  const park = groundFootprint(rect(0, 120, 0, 120));
  const triangle = groundFootprint([{ x: -100, z: 0 }, { x: -40, z: 60 }, { x: -100, z: 60 }]);
  const network = buildRoadNetwork([{ minX: -100, maxX: -80, minZ: 20, maxZ: 60 }], [park], [], [park, triangle]);
  assert.equal(network.isRoadClear(3, 60, 1), false, 'a park wider than 50 m still blocks traffic');
  assert.equal(network.onSidewalk(-60, 50), true, 'paving outside the old lot rectangle is a sidewalk');
  assert.equal(network.isRoadClear(-60, 50, 1), false);
  assert.equal(network.isRoadClear(-45, 10, 1), true, 'the empty part of a polygon bounding box is road');
  assert.equal(network.isRoadClear(-0.5, -2, 1), true);
  assert.equal(network.isRoadClear(-0.5, 50, 1), false, 'the body width must clear the curb, not only its centre');
});
