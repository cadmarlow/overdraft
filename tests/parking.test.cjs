const assert = require('node:assert/strict');
const test = require('node:test');

// Roadway layouts (road-layout.js) and the parked cars planned along them (parking-plan.js): pure modules

test('a 9 m one-way side street keeps one lane between two rows of parked cars', async () => {
  const { layoutOneWay, PARK_OFF } = await import('../js/road-layout.js');
  const l = layoutOneWay(4.55);
  assert.equal(l.lanes.length, 1);
  assert.ok(Math.abs(l.lanes[0]) < 1e-9);
  assert.ok(Math.abs(l.park.r - (4.55 - PARK_OFF)) < 1e-9);
  assert.ok(Math.abs(l.park.l + (4.55 - PARK_OFF)) < 1e-9);
  assert.equal(l.bike, null);
});

test('a 21.3 m avenue: four lanes clear of both parking lanes and a protected bike lane on the left', async () => {
  const { layoutOneWay, BIKE_LANE } = await import('../js/road-layout.js');
  const half = 10.65;
  const l = layoutOneWay(half);
  assert.equal(l.lanes.length, 4); // 8th Ave: four travel lanes, parking both sides, the bike lane behind the left row
  assert.equal(layoutOneWay(7.5).lanes.length, 3); // 5th Ave: three between its parking lanes, too narrow for a bike lane
  assert.ok(l.park.r !== null && l.park.l !== null && l.bike !== null);
  const carHalf = 0.95;
  // lanes sit between the parked cars' inner sides
  assert.ok(Math.max(...l.lanes) + 0.9 < l.park.r - 1.15, 'right lane clear of the right parking lane');
  assert.ok(Math.min(...l.lanes) - 0.9 > l.park.l + 1.15, 'left lane clear of the left parking lane');
  // the bike lane lies between the left curb and the left parking lane
  assert.ok(l.bike - BIKE_LANE / 2 >= -half - 1e-9);
  assert.ok(l.bike + BIKE_LANE / 2 < l.park.l - carHalf);
  // lanes are evenly spaced, 3.1 to 3.7 m apart
  for (let i = 1; i < l.lanes.length; i++) {
    const d = l.lanes[i] - l.lanes[i - 1];
    assert.ok(d >= 3.1 - 1e-9 && d <= 3.7 + 1e-9, `lane spacing ${d}`);
  }
});

test('two-way roadways park along their curb only when a lane still fits beside the parked cars', async () => {
  const { layoutSide } = await import('../js/road-layout.js');
  const narrow = layoutSide(4.55);
  assert.equal(narrow.lanes.length, 1);
  assert.equal(narrow.park.r, null);
  const wide = layoutSide(9);
  assert.equal(wide.lanes.length, 2);
  assert.ok(wide.park.r > 7 && wide.park.r < 8);
  assert.ok(Math.max(...wide.lanes) + 0.9 < wide.park.r - 1.15);
  assert.ok(Math.min(...wide.lanes) > 1.5, 'the inner lane keeps clear of the centreline');
});

function edge(len, park, { axis = 'st', sx = 0, sz = 0, dx = 0, dz = 1 } = {}) {
  return { sx, sz, dx, dz, rx: -dz, rz: dx, len, axis, park };
}

test('slots run bumper to bumper along a curb, clear of its ends, hydrants and blocked ground', async () => {
  const { planSlots, KIND_LENGTH, END_CLEAR } = await import('../js/parking-plan.js');
  const e = edge(80, { r: 3.3, l: -3.3 });
  const plan = planSlots([e]);
  assert.ok(plan.count >= 20 && plan.count <= 34, `${plan.count} slots on 80 m of two curbs`);
  // every slot on its curb line, inside the edge, none overlapping its neighbour
  const bySide = { 1: [], '-1': [] };
  for (let i = 0; i < plan.count; i++) {
    const x = plan.x[i], z = plan.z[i];
    assert.ok(Math.abs(Math.abs(x) - 3.3) < 1e-6, `slot ${i} on the curb line (x=${x})`);
    const halfLen = KIND_LENGTH[plan.kinds[plan.kind[i]]] / 2;
    assert.ok(z - halfLen >= END_CLEAR - 1e-6 && z + halfLen <= 80 - END_CLEAR + 1e-6, `slot ${i} within the edge`);
    assert.ok(Math.abs(plan.yaw[i]) < 1e-9, 'cars face the direction of travel');
    bySide[plan.side[i]].push({ z, halfLen });
  }
  for (const list of Object.values(bySide)) {
    list.sort((a, b) => a.z - b.z);
    for (let k = 1; k < list.length; k++) assert.ok(list[k].z - list[k].halfLen >= list[k - 1].z + list[k - 1].halfLen - 1e-6, 'no overlap');
  }
  // a hydrant clears 4.5 m of curb either side of it (on its own curb: the edge runs +z, its right is -x)
  const hydrant = planSlots([e], { hydrants: [{ x: 4.5, z: 40 }] });
  for (let i = 0; i < hydrant.count; i++) {
    if (Math.abs(hydrant.x[i] - 4.5) > 2) continue;
    const halfLen = KIND_LENGTH[hydrant.kinds[hydrant.kind[i]]] / 2;
    assert.ok(Math.abs(hydrant.z[i] - 40) > 4.5 + halfLen - 0.6 - 1e-6, `slot at z=${hydrant.z[i]} too close to the hydrant`);
  }
  assert.ok(hydrant.count < plan.count);
  // blocked ground takes its slots away
  const blockedPlan = planSlots([e], { blocked: (x) => x > 0 });
  assert.ok(blockedPlan.count > 0 && blockedPlan.count < plan.count);
  for (let i = 0; i < blockedPlan.count; i++) assert.ok(blockedPlan.x[i] < 0);
});

test('an edge without parking lanes, or with one, plans accordingly', async () => {
  const { planSlots } = await import('../js/parking-plan.js');
  assert.equal(planSlots([edge(60, { r: null, l: null })]).count, 0);
  assert.equal(planSlots([edge(60, null)]).count, 0);
  const oneSide = planSlots([edge(60, { r: 6.2, l: null })]);
  assert.ok(oneSide.count > 0);
  for (let i = 0; i < oneSide.count; i++) assert.equal(oneSide.side[i], 1);
});

test('curbs fill by district and hour, and the sweeper clears one side of residential streets', async () => {
  const { occupancyTarget, ZONE } = await import('../js/parking-plan.js');
  assert.ok(occupancyTarget(ZONE.residential, false, 3) > 0.9);
  const businessNight = occupancyTarget(ZONE.business, true, 3);
  const businessDay = occupancyTarget(ZONE.business, true, 13);
  assert.ok(businessNight < businessDay, 'business avenues empty out at night');
  assert.ok(occupancyTarget(ZONE.residential, true, 13) < occupancyTarget(ZONE.residential, false, 13), 'avenues keep more room than side streets');
  // alternate side: at 10 o'clock one curb of a residential street is nearly empty, the other full; the sides swap next day
  const day0 = [occupancyTarget(ZONE.residential, false, 10, 0, 7, 1), occupancyTarget(ZONE.residential, false, 10, 0, 7, -1)];
  assert.ok(Math.min(...day0) < 0.15 && Math.max(...day0) > 0.9, `sweep day 0: ${day0}`);
  const day1 = [occupancyTarget(ZONE.residential, false, 10, 1, 7, 1), occupancyTarget(ZONE.residential, false, 10, 1, 7, -1)];
  assert.ok(day0[0] < day0[1] !== day1[0] < day1[1], 'the swept side alternates with the day');
  assert.ok(occupancyTarget(ZONE.residential, false, 14, 0, 7, 1) > 0.9, 'full again in the afternoon');
  assert.ok(occupancyTarget(ZONE.residential, true, 10, 0, 7, 1) > 0.7, 'avenues are not swept');
});

test('a slot stands occupied or empty by its own seed against the curb target', async () => {
  const { planSlots, occupied } = await import('../js/parking-plan.js');
  const plan = planSlots([edge(200, { r: 3.3, l: -3.3 }, { axis: 'st' })]);
  let on = 0;
  for (let i = 0; i < plan.count; i++) if (occupied(plan, i, 14, 0)) on++;
  assert.ok(on > plan.count * 0.6, `${on} of ${plan.count} occupied at 14 h on a mixed street`);
  // deterministic
  assert.equal(occupied(plan, 0, 14, 0), occupied(plan, 0, 14, 0));
});
