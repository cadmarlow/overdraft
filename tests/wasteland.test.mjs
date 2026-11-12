import test from 'node:test';
import assert from 'node:assert/strict';
import { ISLAND_BOUNDS, WATERFRONT_PIERS, getIslandBoundsAtZ, streetZ } from '../js/city-config.js';
import {
  BREACHES, DAMS, FRONTIER_BRIDGES, NORTH_GATE, SALT_LINES, SALT_LOOP, SALT_MIN_X, SALT_MIN_Z, SALT_PLACES, SALT_STEP, SALT_TERRAIN, SALT_WATER,
  WALL_Z, WEST_GATE, bridgeFrameAt, createFrontierSurfaces, insideCity, routeThroughSalt, saltLandAt, saltLocation, saltMoatRuns, saltVertex,
  saltWetAt, sampleSalt
} from '../js/wasteland-plan.js';

const surfaces = createFrontierSurfaces([]);

test('the baked relief matches the game and stays within what it can store', () => {
  const { header, height } = SALT_TERRAIN;
  assert.equal(header.version, 2);
  assert.equal(height.length, header.w * header.h);
  assert.ok(header.low > header.min && header.high < header.min + header.range);
  assert.equal(header.routes.length, SALT_LINES.length);
});

test('the Hudson and the harbour are dry ground under the old water line', () => {
  for (const [x, z] of [[-2700, 0], [-2600, -4000], [-2500, 3000], [150, 9150], [-900, 8300]]) {
    assert.ok(saltLandAt(x, z), [x, z]);
    assert.ok(sampleSalt(x, z) < SALT_WATER + 2.5, `bed at ${x}, ${z} is ${sampleSalt(x, z)}`);
    assert.equal(saltWetAt(x, z), false);
  }
  // under Manhattan's western wall the bed lies well below the streets
  const z = streetZ(57), shore = getIslandBoundsAtZ(z);
  assert.ok(sampleSalt(shore.westX - 40, z) < -4);
});

test('the East River is the moat, and the city owns its own ground', () => {
  for (const [x, z] of [[1650, 800], [2850, 3500], [1420, -5200]]) {
    assert.ok(saltWetAt(x, z), [x, z]);
    assert.equal(saltLandAt(x, z), false);
  }
  for (const [x, z] of [[-585, 0], [0, -3000], [400, 5200]]) {
    assert.ok(insideCity(x, z));
    assert.equal(saltLandAt(x, z), false);
    assert.ok(sampleSalt(x, z) < 0, 'the relief stays buried under the streets');
    assert.equal(surfaces.sample(x, z, 1, {}), false);
  }
  assert.ok(saltMoatRuns().length > 500);
});

test('every dam stands dry between the moat and a dry bed', () => {
  for (const dam of DAMS) {
    const dx = dam.b.x - dam.a.x, dz = dam.b.z - dam.a.z, length = Math.hypot(dx, dz), nx = -dz / length, nz = dx / length;
    let crest = 0, wetSides = new Set(), drySides = new Set();
    for (let t = 0.1; t <= 0.9; t += 0.05) {
      const x = dam.a.x + dx * t, z = dam.a.z + dz * t;
      assert.ok(sampleSalt(x, z) > SALT_WATER + 0.5, `${dam.id} is breached at ${x}, ${z}`);
      crest++;
      for (const side of [-1, 1]) {
        const px = x + nx * side * 170, pz = z + nz * side * 170;
        if (saltWetAt(px, pz)) wetSides.add(side);
        else if (saltLandAt(px, pz)) drySides.add(side);
      }
    }
    assert.ok(crest > 10);
    assert.equal(wetSides.size, 1, `${dam.id} holds water on one side only`);
    assert.ok(drySides.has(-[...wetSides][0]), `${dam.id} has dry ground behind it`);
  }
});

test('every road and track is dry and driveable on regular suspension', () => {
  assert.deepEqual(SALT_LOOP[0], SALT_LOOP.at(-1));
  for (const line of SALT_LINES) {
    const path = line.path.filter(p => !insideCity(p.x, p.z));
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], length = Math.hypot(a.x - b.x, a.z - b.z);
      for (let n = 0; n <= 4; n++) assert.ok(saltLandAt(a.x + (b.x - a.x) * n / 4, a.z + (b.z - a.z) * n / 4), `${line.id} is under water near ${a.x}, ${a.z}`);
      const grade = Math.abs(sampleSalt(a.x, a.z) - sampleSalt(b.x, b.z)) / length;
      assert.ok(grade < 0.14, `${line.id}: grade ${grade} near ${a.x}, ${a.z}`);
    }
  }
});

test('each bridge crosses the moat and comes down to a ground-level landing', () => {
  assert.equal(FRONTIER_BRIDGES.length, 4);
  for (const { a, b, id } of FRONTIER_BRIDGES) {
    assert.ok(saltLandAt(b.x, b.z), id);
    assert.ok(Math.abs(sampleSalt(b.x, b.z)) < 0.3, `${id} lands at ${sampleSalt(b.x, b.z)}`);
    assert.ok(Array.from({ length: 33 }, (_, i) => i / 32).some(t => saltWetAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)), id);
  }
});

test('the suspension bridges leave enough length beyond the last anchorage to descend onto the far bank', () => {
  for (const bridge of FRONTIER_BRIDGES.filter(spec => spec.sideSpan)) {
    const { length } = bridgeFrameAt(bridge, bridge.a.x, bridge.a.z);
    const descent = length * (1 - bridge.towers.at(-1)) - bridge.sideSpan;
    const anchorHeight = bridge.deckY * (bridge.rampFrac ?? .86);
    assert.ok(descent > anchorHeight / .155, bridge.id);
  }
});

test('the two gates meet the streets at grade', () => {
  // the western ramp: from the street's level at the island's edge down to the bed of the Hudson
  const ramp = SALT_LINES.find(l => l.id === 'pumps').path.filter(p => !insideCity(p.x, p.z));
  assert.ok(Math.abs(sampleSalt(ramp[0].x, ramp[0].z)) < 0.7, `the ramp's top is at ${sampleSalt(ramp[0].x, ramp[0].z)}`);
  assert.ok(sampleSalt(ramp.at(-1).x, ramp.at(-1).z) < 6 && Math.min(...ramp.map(p => sampleSalt(p.x, p.z))) < -5);
  assert.ok(Math.abs(ramp[0].x - WEST_GATE.x) < 30);
  // the Great Gate: Harlem's ground is the avenue's own level on both sides of the Wall
  for (const dz of [8, -20, -60]) assert.ok(Math.abs(sampleSalt(NORTH_GATE.x, WALL_Z + dz) - 0.1) < 0.4, `at ${dz} m: ${sampleSalt(NORTH_GATE.x, WALL_Z + dz)}`);
  assert.ok(saltLandAt(NORTH_GATE.x, WALL_Z - 40));
});

test('sand has come over the seawall at every breach, and carries a body there', () => {
  for (const breach of BREACHES) {
    let best = -Infinity, at = null;
    for (let dx = -breach.r; dx <= breach.r; dx += 16) for (let dz = -breach.r; dz <= breach.r; dz += 16) {
      const x = breach.x + dx, z = breach.z + dz;
      if (insideCity(x, z) && sampleSalt(x, z) > best) { best = sampleSalt(x, z); at = [x, z]; }
    }
    assert.ok(best > 0.5, `${breach.id}: the drift stands ${best} m over the streets`);
    const hit = {};
    assert.ok(surfaces.sample(at[0], at[1], best + 1, hit) && Math.abs(hit.y - best) < 1e-6, breach.id);
  }
});

test('wheels and planes sample exactly the triangles used to draw the ground', () => {
  const ix = 1313, iz = 2320;
  const a = saltVertex(ix, iz), b = saltVertex(ix + 1, iz), c = saltVertex(ix, iz + 1), d = saltVertex(ix + 1, iz + 1);
  const hit = {};
  for (const [u, v] of [[.25, .20], [.70, .60], [.42, .58]]) {
    const y = sampleSalt(SALT_MIN_X + (ix + u) * SALT_STEP, SALT_MIN_Z + (iz + v) * SALT_STEP, hit);
    const expected = u + v <= 1 ? a * (1 - u - v) + b * u + c * v : d * (u + v - 1) + b * (1 - v) + c * (1 - u);
    assert.ok(Math.abs(y - expected) < 1e-4);
    assert.ok(Math.abs(Math.hypot(hit.nx, hit.ny, hit.nz) - 1) < 1e-8);
    assert.ok(hit.grip > 0.5 && hit.grip <= 1 && hit.rough > 0);
  }
});

test('a deck and the moat underneath are separate surfaces', () => {
  const spec = FRONTIER_BRIDGES.find(b => b.id === 'williamsburg');
  const { ux, uz, length } = bridgeFrameAt(spec, spec.a.x, spec.a.z);
  const d = { id: spec.id, ax: spec.a.x, az: spec.a.z, ux, uz, L: length, half: spec.width / 2 + 1, profile: t => 40 * Math.sin(t * Math.PI) };
  const decked = createFrontierSurfaces([d]);
  const x = spec.a.x + ux * length * .62, z = spec.a.z + uz * length * .62;
  const hit = {};
  assert.ok(decked.sample(x, z, 45, hit) && hit.deck && hit.y > 30);
  assert.equal(decked.sample(x, z, 2, hit), false);
  assert.equal(decked.landAt(x, z), false);
  assert.ok(saltWetAt(x, z));
});

test('a pier is the city\'s deck from above and open ground from below', () => {
  const pier = WATERFRONT_PIERS.find(p => p.side === 'west' && p.length > 200);
  const x = pier.cx - 40, z = pier.cz, hit = {};
  assert.ok(!insideCity(x, z));
  assert.equal(surfaces.sample(x, z, 1, hit), false, 'standing on the deck, the city rules');
  assert.ok(surfaces.sample(x, z, -4, hit) && hit.y < -3, 'down on the bed, the ground is the bed');
});

test('nothing down on the bed walks in under the streets', () => {
  const z = streetZ(50), shore = getIslandBoundsAtZ(z);
  const inside = { x: shore.westX + 20, y: -6.2, z }, from = { x: shore.westX - 30, z };
  assert.ok(insideCity(inside.x, inside.z) && !insideCity(from.x, from.z));
  assert.ok(surfaces.wall(inside, from.x, from.z));
  assert.ok(!insideCity(inside.x, inside.z), 'pushed back out');
  // a body at street level is not concerned
  const walker = { x: shore.westX + 20, y: 0.2, z };
  assert.equal(surfaces.wall(walker, from.x, from.z), false);
  assert.equal(walker.x, shore.westX + 20);
});

test('the map can guide a vehicle out of the city, round the island and up to the plateau', () => {
  const plateau = SALT_PLACES.find(p => p.name === 'Le Haut-Sel');
  const out = routeThroughSalt({ x: -585, z: 0 }, plateau);
  assert.ok(out && out.length > 20);
  assert.deepEqual(out.at(-1), plateau);
  const east = FRONTIER_BRIDGES.find(b => b.id === 'williamsburg');
  const round = routeThroughSalt(east.b, plateau);
  assert.deepEqual(round[0], east.b);
  assert.ok(round.slice(1, -1).every(p => saltLandAt(p.x, p.z) || insideCity(p.x, p.z)));
  assert.equal(routeThroughSalt({ x: 0, z: 0 }, { x: 300, z: 300 }), null, 'two points in the city are the streets\' business');
});

test('every place of the Wasteland has dry ground and a name', () => {
  for (const place of SALT_PLACES) {
    assert.ok(saltLandAt(place.x, place.z), place.name);
    assert.equal(saltLocation(place.x, place.z), place.name);
  }
  assert.equal(saltLocation(-585, 0), null);
  assert.equal(saltLocation(ISLAND_BOUNDS.minX - 700, 0), 'Le Lit de l’Hudson');
});
