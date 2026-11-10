const assert = require('node:assert/strict');
const test = require('node:test');

// The plans of the parks' ground (js/park-plan.js) and the Central Park they are drawn from (js/nyc-geodata.js)

const bounds = { minX: 0, maxX: 200, minZ: 0, maxZ: 300 };

test('the park field knows its trees, its drives, its shores, its kept lawns and its rocks', async () => {
  const { bakeParkField, sampleParkField, WEAR_REACH, CROWN } = await import('../js/park-plan.js');
  const field = bakeParkField({
    bounds,
    trees: [{ x: 50, z: 50, scale: 1 }, { x: 53, z: 50, scale: 1 }],
    drives: [{ pts: [100, 0, 100, 300], w: 8 }, { pts: [0, 250, 60, 250], w: 3, reach: 3.5, strength: 0.75 }],
    water: [{ ring: [150, 100, 190, 100, 190, 140, 150, 140] }],
    lawns: [{ ring: [10, 150, 60, 150, 60, 200, 10, 200] }],
    rocks: [{ x: 160, z: 250, radius: 6 }]
  });
  assert.equal(field.data.length, field.width * field.height * 4);
  assert.equal(field.cell, 2);
  const at = (x, z) => sampleParkField(field, x, z);
  // under a crown, and more under two; nothing in the open
  assert.ok(at(47, 50).canopy > 0.7);
  assert.ok(at(51.5, 50).canopy > at(47, 50).canopy - 0.02);
  assert.equal(at(50 + CROWN * 1.6, 80).canopy, 0);
  // worn at a drive's edge, less with every metre, not at all past the reach
  assert.equal(at(101, 150).wear, 1);
  assert.ok(at(106, 150).wear > at(108.5, 150).wear && at(108.5, 150).wear > 0);
  assert.equal(at(100 + 4 + WEAR_REACH + 3, 150).wear, 0);
  // a footpath wears less, and less far
  assert.ok(Math.abs(at(31, 250).wear - 0.75) < 0.02);
  assert.equal(at(31, 250 + 1.5 + 3.5 + 3).wear, 0);
  // the shore, both sides of the water's edge; a kept lawn, inside its outline only
  assert.ok(at(149, 120).shore > 0.6 && at(140, 120).shore < 0.01 + at(145, 120).shore);
  assert.equal(at(120, 60).shore, 0);
  assert.equal(at(30, 170).kept, 1);
  assert.equal(at(70, 170).kept, 0);
  // the grass is gone round a rock
  assert.equal(at(160, 250).wear, 1);
  assert.ok(at(168, 250).wear > 0 && at(175, 250).wear === 0);
  // outside the field: nothing
  assert.deepEqual(sampleParkField(field, -500, 0), { canopy: 0, wear: 0, shore: 0, kept: 0 });
  // and the same park gives the same field
  assert.deepEqual(bakeParkField({ bounds, trees: [{ x: 50, z: 50, scale: 1 }] }).data, bakeParkField({ bounds, trees: [{ x: 50, z: 50, scale: 1 }] }).data);
});

test('a ribbon keeps its width round a bend and its shoulders outside it', async () => {
  const { ribbon } = await import('../js/park-plan.js');
  const r = ribbon([0, 0, 50, 0, 50, 40, 90, 40], 8, 1.5);
  assert.equal(r.length, 4);
  const d = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
  // straight ends: exactly the width, shoulders 1.5 m further each side
  assert.ok(Math.abs(d(r[0].left, r[0].right) - 8) < 1e-9);
  assert.ok(Math.abs(d(r[0].leftOut, r[0].rightOut) - 11) < 1e-9);
  assert.ok(Math.abs(d(r[3].left, r[3].right) - 8) < 1e-9);
  // a right angle is mitred: the corner reaches out by sqrt(2)
  assert.ok(Math.abs(d(r[1].left, r[1].right) - 8 * Math.SQRT2) < 1e-6);
  // distance along
  assert.deepEqual(r.map((c) => c.s), [0, 50, 90, 130]);
  // left is left of travel: going +x, north (-z)
  assert.ok(r[0].left.z < 0 && r[0].right.z > 0);
  // repeated points are dropped, a single point makes no ribbon
  assert.equal(ribbon([0, 0, 0, 0, 10, 0], 4).length, 2);
  assert.equal(ribbon([5, 5], 4).length, 0);
});

test('a shore band lies on the land, whichever way the water is drawn', async () => {
  const { shoreBand } = await import('../js/park-plan.js');
  const square = [0, 0, 40, 0, 40, 30, 0, 30];
  const reversed = [0, 30, 40, 30, 40, 0, 0, 0];
  for (const ring of [square, reversed]) {
    const band = shoreBand(ring, 2);
    assert.equal(band.length, 5); // closes on its first section
    assert.deepEqual(band[4].edge, band[0].edge);
    for (const c of band) {
      assert.ok(c.land.x < 0 || c.land.x > 40 || c.land.z < 0 || c.land.z > 30, `land point ${c.land.x}, ${c.land.z} is in the water`);
      assert.ok(Math.hypot(c.land.x - c.edge.x, c.land.z - c.edge.z) >= 2 - 1e-9);
    }
    assert.ok(band[4].s > band[3].s);
  }
});

test('an outcrop is a closed dome inside its footprint, its foot below the ground, the same every time', async () => {
  const { outcrop } = await import('../js/park-plan.js');
  const rock = outcrop({ seed: 7, rx: 12, rz: 9, height: 3 });
  assert.equal(rock.position.length, (20 * 64 + 1) * 3);
  assert.equal(rock.index.length, (64 + 19 * 64 * 2) * 3);
  let top = -Infinity, low = Infinity;
  for (let k = 0; k < rock.position.length; k += 3) {
    assert.ok(Math.hypot(rock.position[k] / 12, rock.position[k + 2] / 9) <= 1.0001);
    assert.ok(rock.normal[k + 1] > 0, 'every normal leans up');
    assert.ok(Math.abs(Math.hypot(rock.normal[k], rock.normal[k + 1], rock.normal[k + 2]) - 1) < 1e-5);
    top = Math.max(top, rock.position[k + 1]);
    low = Math.min(low, rock.position[k + 1]);
  }
  assert.ok(Math.abs(top - rock.height) < 1e-6 && top > 2 && top < 5);
  assert.ok(low < -0.3, 'the rim is buried');
  // every triangle faces out of the rock: up, seen from above
  for (let t = 0; t < rock.index.length; t += 3) {
    const [a, b, c] = [rock.index[t] * 3, rock.index[t + 1] * 3, rock.index[t + 2] * 3];
    const ny = (rock.position[b + 2] - rock.position[a + 2]) * (rock.position[c] - rock.position[a]) - (rock.position[b] - rock.position[a]) * (rock.position[c + 2] - rock.position[a + 2]);
    assert.ok(ny > -1e-6, `triangle ${t / 3} faces down`);
  }
  assert.deepEqual(outcrop({ seed: 7, rx: 12, rz: 9, height: 3 }).position, rock.position);
  assert.notDeepEqual(outcrop({ seed: 8, rx: 12, rz: 9, height: 3 }).position, rock.position);
  // a small rock is drawn with fewer triangles
  assert.equal(outcrop({ seed: 1, rx: 3, rz: 2, height: 0.8, rings: 10, segments: 32 }).index.length, (32 + 9 * 32 * 2) * 3);
});

test("Central Park's footpaths and outcrops are in the park, and of believable sizes", async () => {
  const { GEO } = await import('../js/nyc-geodata.js');
  const park = GEO.centralPark, b = park.bounds;
  assert.ok(park.paths.length > 800 && park.rocks.length > 80);
  let length = 0;
  for (const [width, earth, pts] of park.paths) {
    assert.ok(width >= 1.8 && width <= 8);
    assert.ok(earth === 0 || earth === 1);
    assert.ok(pts.length >= 4 && pts.length % 2 === 0);
    let inside = 0;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] > b.minX - 10 && pts[i] < b.maxX + 10 && pts[i + 1] > b.minZ - 10 && pts[i + 1] < b.maxZ + 10) inside++;
      if (i) length += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    }
    assert.ok(inside >= (pts.length / 2) * 0.8);
  }
  assert.ok(length > 50000 && length < 110000, `${Math.round(length)} m of paths`);
  assert.ok(park.paths.some((p) => p[1] === 1), 'some are earth');
  for (const [x, z, a, c, ang] of park.rocks) {
    assert.ok(x > b.minX - 5 && x < b.maxX + 5 && z > b.minZ - 5 && z < b.maxZ + 5);
    assert.ok(a >= 1.5 && a < 80 && c >= 1 && c < 60);
    assert.ok(Math.abs(ang) <= Math.PI / 2 + 1e-6);
  }
});
