const assert = require('node:assert/strict');
const test = require('node:test');

// The ground's plans (js/ground-plan.js) and what is set in it (js/ground-dressing.js): pure modules

const rect = (minX, maxX, minZ, maxZ, id = 7) => ({
  id, rect: true, minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2,
  poly: [{ x: minX, z: minZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ }]
});
// Which way a triangle of a flat accumulator faces: > 0 up
const facing = (acc, i) => {
  const p = acc.position, a = acc.index[i] * 3, b = acc.index[i + 1] * 3, c = acc.index[i + 2] * 3;
  return (p[b + 2] - p[a + 2]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 2] - p[a + 2]);
};

test('a block corner turns on the curb radius, and the tip of its sharp outline is roadway', async () => {
  const { curbOutline, onRoundedBlock, CURB_RADIUS } = await import('../js/ground-plan.js');
  const block = rect(0, 60, 0, 200);
  const o = curbOutline(block.poly);
  assert.equal(o.sides.length, 4);
  const expected = 2 * (60 + 200) - 8 * CURB_RADIUS + 2 * Math.PI * CURB_RADIUS;
  assert.ok(Math.abs(o.perimeter - expected) < 0.2, `perimeter ${o.perimeter} vs ${expected}`);
  for (const p of o.loop) {
    assert.ok(p.x >= -1e-6 && p.x <= 60 + 1e-6 && p.z >= -1e-6 && p.z <= 200 + 1e-6);
    assert.ok(Math.abs(Math.hypot(p.nx, p.nz) - 1) < 1e-6);
  }
  // each side starts and ends on the middle of a corner arc, and measures itself from there
  for (const side of o.sides) {
    assert.equal(side[0].t, 0);
    assert.ok(side[0].r > 2 && side[side.length - 1].r > 2);
    for (let i = 1; i < side.length; i++) assert.ok(side[i].t > side[i - 1].t);
  }
  assert.equal(onRoundedBlock(block, 0.3, 0.3), false); // the corner's tip
  assert.equal(onRoundedBlock(block, 1.6, 1.6), true);
  assert.equal(onRoundedBlock(block, 30, 0.05), true); // against the curb, mid-block
  assert.equal(onRoundedBlock(block, 59.8, 199.8), false);
});

test('a narrow mall keeps a nose its width allows, and a reflex corner stays sharp', async () => {
  const { curbOutline } = await import('../js/ground-plan.js');
  const mall = curbOutline(rect(0, 4, 0, 80).poly);
  const radii = mall.loop.filter((p) => p.r > 0 && p.r !== Infinity).map((p) => p.r);
  assert.ok(radii.length > 0 && Math.max(...radii) <= 0.42 * 4 + 1e-6);
  // an L: five convex corners and one reflex one
  const L = curbOutline([{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }, { x: 20, z: 20 }, { x: 20, z: 50 }, { x: 0, z: 50 }]);
  assert.equal(L.loop.filter((p) => p.r === 0).length, 1);
  assert.equal(L.sides.length, 6);
});

test('an island is watertight on top: every triangle faces up, at curb height, inside its outline', async () => {
  const { buildIsland, accumulator, CURB_HEIGHT, GUTTER_WIDTH } = await import('../js/ground-plan.js');
  for (const block of [rect(0, 67, 0, 293), rect(100, 104, 0, 60, 9), { ...rect(0, 40, 0, 50, 11), rect: false, poly: [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }, { x: 20, z: 20 }, { x: 20, z: 50 }, { x: 0, z: 50 }] },
    // the same rectangle wound the other way
    { ...rect(0, 67, 0, 293, 13), poly: [{ x: 0, z: 293 }, { x: 67, z: 293 }, { x: 67, z: 0 }, { x: 0, z: 0 }] }]) {
    const acc = { curb: accumulator(), walk: accumulator(), gutter: accumulator() };
    buildIsland(block, acc);
    for (const part of Object.values(acc)) {
      assert.ok(part.position.every(Number.isFinite) && part.coord.every(Number.isFinite));
      assert.ok(part.index.every((i) => i >= 0 && i < part.count));
      assert.equal(part.position.length, part.count * 3);
    }
    let area = 0;
    for (let i = 0; i < acc.walk.index.length; i += 3) {
      const f = facing(acc.walk, i);
      assert.ok(f > -1e-7, `walk triangle ${i / 3} of block ${block.id} faces down`);
      area += f / 2;
    }
    for (let i = 0; i < acc.gutter.index.length; i += 3) assert.ok(facing(acc.gutter, i) > -1e-7);
    for (let i = 1; i < acc.walk.position.length; i += 3) assert.equal(acc.walk.position[i], CURB_HEIGHT);
    // the sidewalk covers the island less its curbstone: close to the outline's own area
    const outline = block.curb;
    assert.ok(area > outline.area * 0.9 && area <= outline.area + 1e-6, `area ${area} of ${outline.area}`);
    // the curb's face faces the roadway: its normals point out of the island
    const { position, normal } = acc.curb;
    let out = 0;
    for (let i = 0; i < position.length; i += 3) {
      if (position[i + 1] > 0.001) continue; // the foot row
      out += (position[i] - block.cx) * normal[i] + (position[i + 2] - block.cz) * normal[i + 2] > 0 ? 1 : -1;
    }
    assert.ok(out > 0);
    // the gutter lies in the roadway
    const g = acc.gutter.position;
    for (let i = 0; i < g.length; i += 3) assert.ok(g[i] > block.minX - GUTTER_WIDTH * 1.5 && g[i] < block.maxX + GUTTER_WIDTH * 1.5);
  }
});

test('triangulate covers convex and concave outlines exactly', async () => {
  const { triangulate } = await import('../js/ground-plan.js');
  const area = (loop) => {
    const t = triangulate(loop);
    let sum = 0;
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [loop[t[i]], loop[t[i + 1]], loop[t[i + 2]]];
      sum += Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
    }
    return sum;
  };
  assert.ok(Math.abs(area([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }, { x: 0, z: 5 }]) - 50) < 1e-9);
  assert.ok(Math.abs(area([{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }, { x: 20, z: 20 }, { x: 20, z: 50 }, { x: 0, z: 50 }]) - 1400) < 1e-9);
});

test('a roadway is cut into bands from curb to curb with no gap and no overlap', async () => {
  const { roadBands, KIND, ROAD_OVERLAP } = await import('../js/ground-plan.js');
  const covers = (bands, half) => {
    assert.ok(Math.abs(bands[0].lo + half + ROAD_OVERLAP) < 1e-9 && Math.abs(bands[bands.length - 1].hi - half - ROAD_OVERLAP) < 1e-9);
    for (let i = 1; i < bands.length; i++) assert.ok(Math.abs(bands[i].lo - bands[i - 1].hi) < 1e-9);
    for (const b of bands) assert.ok(b.hi > b.lo);
  };
  // 5th Ave: three lanes between two parking lanes
  const avenue = roadBands({ half: 8, lanes: [-3.7, 0, 3.7], park: { r: 6.75, l: -6.75 }, bike: null });
  covers(avenue, 8);
  assert.deepEqual(avenue.map((b) => b.kind), [KIND.parking, KIND.lane, KIND.lane, KIND.lane, KIND.parking]);
  // (a lane takes up the few centimetres left between it and the parking lane)
  assert.ok(avenue.filter((b) => b.kind === KIND.lane).every((b) => Math.abs(b.hi - b.lo - 3.7) < 0.06 && b.dir === 1));
  // with a bus lane: the lane along the right curb
  const bus = roadBands({ half: 8, lanes: [-3.7, 0, 3.7], park: { r: 6.75, l: -6.75 }, bike: null }, null, { bus: true });
  assert.deepEqual(bus.map((b) => b.kind), [KIND.parking, KIND.lane, KIND.lane, KIND.bus, KIND.parking]);
  // a lane closed by an obstacle leaves a hole nobody drives, not a wider lane
  const closed = roadBands({ half: 8, lanes: [-3.7, 3.7], park: { r: 6.75, l: -6.75 }, bike: null });
  covers(closed, 8);
  assert.ok(closed.filter((b) => b.kind === KIND.lane).every((b) => b.hi - b.lo <= 3.7 + 0.06));
  // two-way: each direction's lanes on its own side, driven its own way
  const side = { half: 9, lanes: [3, 6.5], park: { r: 7.75, l: null }, bike: null };
  const both = roadBands(side, side);
  covers(both, 9);
  assert.ok(both.filter((b) => b.kind === KIND.lane && b.dir === 1).every((b) => b.lo >= 0));
  assert.ok(both.filter((b) => b.kind === KIND.lane && b.dir === -1).every((b) => b.hi <= 0));
  // a protected bike lane keeps its place between the curb and the parked cars
  const bike = roadBands({ half: 10.65, lanes: [-2.6, 0.9, 4.4, 7.9].map((o) => o - 1.3), park: { r: 9.4, l: -6.8 }, bike: -9.75 });
  covers(bike, 10.65);
  const lane = bike.find((b) => b.kind === KIND.bike);
  assert.ok(lane && Math.abs((lane.lo + lane.hi) / 2 + 9.75) < 0.2);
});

// A two-node, one-roadway network like road-network.js makes them (paint edges and their live junctions)
function network() {
  const avenue = { name: '5th Ave' };
  const a = { id: 0, x: 0, z: 0, hx: 8, hz: 6, signal: true, avenue };
  const b = { id: 1, x: 0, z: 100, hx: 8, hz: 6, signal: true, avenue };
  const snap = (n) => ({ id: n.id, x: n.x, z: n.z, shape: false, hx: n.hx, hz: n.hz, general: false, node: n });
  const e = { from: snap(a), to: snap(b), axis: 'ave', x0: 0, z0: 0, sx: 0, sz: 8.5, dx: 0, dz: 1, rx: -1, rz: 0, span: 100, len: 83, half: 8, lanes: [-3.7, 0, 3.7], park: { r: 6.75, l: -6.75 }, bike: null, general: false };
  return { nodes: [a, b], edges: [e], paintEdges: [e] };
}

test('lane bands run from one intersection box to the next and know their stop line', async () => {
  const { buildRoads, KIND, ROAD_OVERLAP } = await import('../js/ground-plan.js');
  const acc = { position: [], road: [], band: [], flow: [], index: [], count: 0 };
  buildRoads(network(), () => acc);
  assert.equal(acc.count, (5 + 2) * 4); // five bands, two intersection boxes
  for (let i = 0; i < acc.index.length; i += 3) assert.ok(facing(acc, i) > 0);
  const lane = [];
  for (let v = 0; v < acc.count; v++) if (acc.band[v * 4 + 2] === KIND.bus || acc.band[v * 4 + 2] === KIND.lane) lane.push(v);
  assert.equal(lane.length, 12);
  for (const v of lane) {
    const z = acc.position[v * 3 + 2], s = acc.road[v * 4], toStop = acc.flow[v * 4];
    assert.ok(Math.abs(z - (8.5 + s)) < 1e-9);
    assert.ok(z === 6 || z === 94, 'a band ends on the box of each intersection'); // node.hz = 6
    assert.ok(Math.abs(toStop - (83 - s)) < 1e-9); // traffic drives toward the far stop line
    assert.equal(acc.flow[v * 4 + 1], 2 + 4); // a signal, on an avenue
  }
  const xs = acc.position.filter((_, i) => i % 3 === 0);
  assert.ok(Math.abs(Math.max(...xs) - 8 - ROAD_OVERLAP) < 1e-9);
  // 5th Ave carries a bus lane
  assert.equal(acc.band.filter((k, i) => i % 4 === 2 && k === KIND.bus).length, 4);
});

test('what is set in the ground exists in the atlases, lands on its roadway or island, and never changes', async () => {
  const { dressRoads, dressIsland } = await import('../js/ground-dressing.js');
  const { OBJECT_ATLAS, MARK_ATLAS } = await import('../js/ground-atlas.js');
  const run = () => {
    const out = [];
    dressRoads(network(), (d) => out.push({ ...d, on: 'road' }));
    dressIsland(rect(20, 87, 0, 293, 41), (d) => out.push({ ...d, on: 'island' }));
    return out;
  };
  const decals = run();
  assert.deepEqual(run(), decals);
  assert.ok(decals.length > 20);
  for (const d of decals) {
    const tile = (d.sheet === 'object' ? OBJECT_ATLAS : MARK_ATLAS).tiles[d.tile];
    assert.ok(tile, `${d.sheet} tile ${d.tile}`);
    assert.ok([d.x, d.z, d.y, d.lx, d.lz, d.scale, d.gloss, d.wear, ...d.tint].every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(d.lx, d.lz) - 1) < 1e-6);
    if (d.on === 'road') assert.ok(Math.abs(d.x) < 8.2 && d.z > -6.5 && d.z < 106.5 && d.y < 0.012, `${d.tile} at ${d.x}, ${d.z}`);
    else assert.ok(d.x > 20 && d.x < 87 && d.z > 0 && d.z < 293 && d.y > 0.22);
  }
  const tiles = new Set(decals.map((d) => d.tile));
  for (const expected of ['tactile_pad', 'storm_grate', 'text_bus', 'text_only']) assert.ok(tiles.has(expected), expected);
  assert.ok([...tiles].some((t) => t.startsWith('manhole_')));
  // eight pads: two to a corner
  assert.equal(decals.filter((d) => d.tile === 'tactile_pad').length, 8);
});

test('every atlas tile fits its sheet, clear of the others, and says how big the thing is', async () => {
  const { OBJECT_ATLAS, MARK_ATLAS } = await import('../js/ground-atlas.js');
  for (const atlas of [OBJECT_ATLAS, MARK_ATLAS]) {
    const tiles = Object.entries(atlas.tiles);
    for (const [name, t] of tiles) {
      assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= atlas.size && t.y + t.h <= atlas.size, name);
      assert.ok(t.metres.length === 2 && t.metres[0] > 0.1 && t.metres[1] > 0.1 && t.metres[0] < 4 && t.metres[1] < 10, name);
    }
    for (const [a, p] of tiles) {
      for (const [b, q] of tiles) {
        if (a >= b) continue;
        assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, `${a} overlaps ${b}`);
      }
    }
  }
});
