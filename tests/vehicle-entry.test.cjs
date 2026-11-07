const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// The car-entry choreography (js/vehicle-entry.js): a pure function of time in the car's frame, checked here for its
// timing, the door's rest at both ends and the continuity of every target the body is asked to follow.

const source = readFileSync(join(__dirname, '../js/vehicle-entry.js'), 'utf8');
const V = loadModule(source, { imports: {} });

// Three real cabins (assets/cars/models.json through car-assets.js describe + car-cabin.js cabinLayout): a sedan, the
// low sports car whose roof calls for a deep duck, the tall van with its high seat
const CARS = {
  sedan: { spec: { halfW: 0.92, height: 1.48, wheelZf: 1.45, wheelZr: -1.45, wheelRadius: 0.34, doors: [1.01, -0.21], zFront: 2.3, zRear: -2.3 },
    layout: { seat: [0.41, 0.53, -0.04], roof: 1.33, recline: 0.42, wheel: [0.41, 0.85, 0.48], pedals: [0.41, 0.17, 0.86], radius: 0.18, tilt: 0.42 } },
  sport: { spec: { halfW: 0.97, height: 1.21, wheelZf: 1.28, wheelZr: -1.57, wheelRadius: 0.36, doors: [0.82, -0.38], zFront: 2.2, zRear: -2.4 },
    layout: { seat: [0.37, 0.22, 0.05], roof: 0.97, recline: 0.54, wheel: [0.37, 0.65, 0.57], pedals: [0.37, 0.14, 0.95], radius: 0.18, tilt: 0.42 } },
  van: { spec: { halfW: 1.03, height: 2.08, wheelZf: 1.93, wheelZr: -1.47, wheelRadius: 0.38, doors: [1.43, 0.18], zFront: 2.9, zRear: -2.4 },
    layout: { seat: [0.42, 1.03, 0.92], roof: 1.87, recline: 0.32, wheel: [0.42, 1.35, 1.44], pedals: [0.42, 0.67, 1.82], radius: 0.18, tilt: 0.42 } }
};
const S = 0.97; // the protagonist's scale (controllers.js)
const STEP = 1 / 60;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const snapshot = (out) => ({
  pose: out.pose, x: out.x, z: out.z, door: out.door, pelvis: { ...out.pelvis },
  feet: out.feet.map((f) => ({ ...f })), hands: out.hands.map((h) => ({ ...h }))
});

// Walks the choreography frame by frame and reports the largest step of each target between two frames
function trace(plan, sample) {
  const out = V.createSample();
  const worst = { pelvis: 0, feet: 0, hands: 0, walk: 0, door: 0 };
  let prev = null, doorMax = 0, poseFrames = 0, lastT = -1;
  const frames = [];
  // every frame, and the very last one on the end exactly
  const count = Math.ceil(plan.duration / STEP - 1e-9);
  for (let i = 0; i <= count; i++) {
    const t = Math.min(plan.duration, i * STEP);
    sample(plan, t, out);
    assert.ok(lastT < 0 || out.t > lastT);
    lastT = out.t;
    const now = snapshot(out);
    frames.push(now);
    doorMax = Math.max(doorMax, out.door);
    if (out.pose) poseFrames++;
    if (prev) {
      worst.door = Math.max(worst.door, Math.abs(now.door - prev.door));
      if (now.pose && prev.pose) {
        worst.pelvis = Math.max(worst.pelvis, dist(now.pelvis, prev.pelvis));
        for (let i = 0; i < 2; i++) {
          worst.feet = Math.max(worst.feet, dist(now.feet[i], prev.feet[i]));
          if (now.hands[i].w > 0.01 && prev.hands[i].w > 0.01) worst.hands = Math.max(worst.hands, dist(now.hands[i], prev.hands[i]));
        }
      } else if (!now.pose) worst.walk = Math.max(worst.walk, Math.hypot(now.x - prev.x, now.z - prev.z));
    }
    prev = now;
  }
  return { worst, doorMax, poseFrames, frames, first: frames[0], last: frames[frames.length - 1] };
}

for (const [id, { spec, layout }] of Object.entries(CARS)) {
  const frame = V.carFrame(spec, layout, S);

  // a seat at the usual height is the 1.8 s / 1.3 s case; the low sports car and the tall van take longer to climb into
  const usual = id === 'sedan';
  test(`${id}: the entry walks up, opens, sits, closes within ${usual ? 1.8 : 2.5} s and the door rests at both ends`, () => {
    const plan = V.planEntry(frame, { x: frame.halfW + 1.3, z: frame.rear - 1.5 }, { groundY: 0 });
    assert.ok(plan.duration <= (usual ? 1.8 : 2.5) + 1e-6, `entry lasts ${plan.duration}`);
    assert.ok(plan.approach > 0.15 && plan.approach <= 0.5, `the walk lasts ${plan.approach}`);
    const { worst, doorMax, first, last, poseFrames } = trace(plan, V.sampleEntry);
    assert.equal(first.door, 0);
    assert.ok(Math.abs(last.door) < 1e-6, `door left at ${last.door}`);
    assert.ok(doorMax > 55 * Math.PI / 180 && doorMax <= V.DOOR_OPEN + 1e-9, `door opened to ${doorMax}`);
    assert.ok(poseFrames > 0);
    // no target jumps more than 5 cm between two frames (6 cm for a hand)
    assert.ok(worst.pelvis < 0.05, `pelvis steps ${worst.pelvis}`);
    assert.ok(worst.feet < 0.05, `feet step ${worst.feet}`);
    assert.ok(worst.hands < 0.06, `hands step ${worst.hands}`); // a hand dropping from a van's high door top moves a shade faster
    assert.ok(worst.walk < 0.12, `the walk jumps ${worst.walk}`);
    assert.ok(worst.door < 0.12, `the door jumps ${worst.door} rad in a frame`);
    // seated exactly on the cabin's seat at the end, facing forward, the feet handed over to the driving pose
    assert.ok(dist(last.pelvis, { x: layout.seat[0], y: layout.seat[1], z: layout.seat[2] }) < 1e-6);
    assert.ok(last.feet.every((f) => f.w < 1e-6) && last.hands.every((h) => h.w < 1e-6));
  });

  test(`${id}: the exit opens, climbs out, steps clear and shuts the door within ${usual ? 1.3 : 2.2} s`, () => {
    const plan = V.planExit(frame, { groundY: 0 });
    assert.ok(plan.duration <= (usual ? 1.3 : 2.2) + 1e-6, `exit lasts ${plan.duration}`);
    const { worst, doorMax, first, last } = trace(plan, V.sampleExit);
    assert.equal(first.door, 0);
    assert.ok(Math.abs(last.door) < 1e-6, `door left at ${last.door}`);
    assert.ok(doorMax > 55 * Math.PI / 180);
    assert.ok(worst.pelvis < 0.05, `pelvis steps ${worst.pelvis}`);
    assert.ok(worst.feet < 0.05, `feet step ${worst.feet}`);
    assert.ok(worst.hands < 0.06, `hands step ${worst.hands}`); // a hand dropping from a van's high door top moves a shade faster
    assert.ok(worst.door < 0.2, `the door jumps ${worst.door} rad in a frame`);
    // starts in the driving pose: pelvis on the seat, feet on the pedals, hands on the wheel
    assert.ok(dist(first.pelvis, { x: layout.seat[0], y: layout.seat[1], z: layout.seat[2] }) < 1e-6);
    const grip = V.wheelGrip(frame, 1, { x: 0, y: 0, z: 0 });
    assert.ok(dist(first.hands[0], grip) < 1e-6 && dist(first.feet[1], V.pedalAnkle(frame, -1, { x: 0, y: 0, z: 0 })) < 1e-6);
    // ends standing clear of the door's sweep, out of the car
    assert.ok(last.pelvis.x > frame.halfW + 0.5 && Math.abs(last.pelvis.y - plan.pelvisStand) < 1e-9);
    assert.ok(Math.hypot(last.pelvis.x - frame.hingeX, last.pelvis.z - frame.front) > frame.L, 'the door would hit the body');
  });

  test(`${id}: the fast variant keeps the same shape at 0.7 x the time`, () => {
    const slow = V.planEntry(frame, { x: frame.halfW + 1.3, z: frame.rear - 1.5 }, { groundY: 0 });
    const fast = V.planEntry(frame, { x: frame.halfW + 1.3, z: frame.rear - 1.5 }, { groundY: 0, pace: V.FAST });
    assert.ok(Math.abs(fast.scripted - slow.scripted * V.FAST) < 1e-9);
    const a = V.createSample(), b = V.createSample();
    for (const u of [0.1, 0.5, 0.9]) {
      V.sampleEntry(slow, slow.approach + u * slow.scripted, a);
      V.sampleEntry(fast, fast.approach + u * fast.scripted, b);
      assert.ok(Math.abs(a.door - b.door) < 1e-9 && dist(a.pelvis, b.pelvis) < 1e-9);
    }
    const exit = V.planExit(frame, { pace: V.FAST });
    assert.ok(exit.duration <= (usual ? 1.3 : 2.2) * V.FAST + 1e-6);
    const fastTrace = trace(exit, V.sampleExit), slowTrace = trace(V.planExit(frame, {}), V.sampleExit);
    assert.ok(fastTrace.worst.feet < 0.05 / V.FAST + 0.005 && fastTrace.worst.hands < 0.06 / V.FAST + 0.005);
    assert.ok(trace(fast, V.sampleEntry).worst.hands < 0.06 / V.FAST + 0.005, 'the hands keep up at the fast pace');
    assert.ok(slowTrace.worst.pelvis < 0.05);
  });
}

test('the pelvis ducks under a low roof on the way in', () => {
  const { spec, layout } = CARS.sport;
  const plan = V.planEntry(V.carFrame(spec, layout, S), { x: 2.2, z: -1.5 }, {});
  const out = V.createSample();
  let deepest = 0, lowestHead = Infinity;
  for (let t = plan.approach; t <= plan.duration; t += STEP) {
    V.sampleEntry(plan, t, out);
    deepest = Math.min(deepest, out.recline);
    // the head top, 0.88 m up the leaning torso from the seat point: under the roof rail once the pelvis is over the sill
    if (out.pelvis.x < spec.halfW) lowestHead = Math.min(lowestHead, out.pelvis.y + 0.88 * S * Math.cos(out.recline));
  }
  assert.ok(deepest < -0.8, `the lean only reached ${deepest}`);
  assert.ok(lowestHead < layout.roof + 0.05);
});

test('the walk goes round the car instead of through it', () => {
  const { spec, layout } = CARS.sedan;
  const frame = V.carFrame(spec, layout, S);
  const plan = V.planEntry(frame, { x: -0.3, z: 2.8 }, {});
  const out = V.createSample();
  for (let t = 0; t < plan.approach; t += STEP) {
    V.sampleEntry(plan, t, out);
    const inside = Math.abs(out.x) < spec.halfW + 0.3 && out.z > spec.zRear && out.z < spec.zFront;
    assert.ok(!inside, `walked through the car at t=${t.toFixed(2)} (${out.x.toFixed(2)}, ${out.z.toFixed(2)})`);
  }
  assert.ok(plan.length > 3);
});

test('door points swing with the hinge at the front edge', () => {
  const frame = V.carFrame(CARS.sedan.spec, CARS.sedan.layout, S);
  const shut = V.handle(frame, 0, {}), open = V.handle(frame, V.DOOR_OPEN, {});
  assert.ok(Math.abs(shut.x - (frame.halfW + 0.04)) < 1e-9 && shut.z < frame.rear + 0.2);
  assert.ok(open.x > shut.x + 0.8 && open.z > shut.z + 0.3, 'the handle swings out and forward');
  assert.ok(Math.abs(Math.hypot(open.x - frame.hingeX, open.z - frame.front) - Math.hypot(shut.x - frame.hingeX, shut.z - frame.front)) < 1e-9);
});
