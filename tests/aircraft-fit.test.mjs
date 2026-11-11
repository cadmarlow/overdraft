import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AIRCRAFT, makeTune, restAttitude } from '../js/flight.js';

// The flight model stands on numbers (js/flight.js: where the wheels are, where the hull ends) and the game draws a
// model (assets/aircraft/*.bin, whose header carries the same points measured on it by tools/aircraft). If the two part
// company the aircraft floats over the runway, or sinks into it, or loses a wing tip to a wall it never touched.

function header(kind) {
  const b = readFileSync(new URL(`../assets/aircraft/${kind}.bin`, import.meta.url));
  const length = b.readUInt32LE(0);
  return JSON.parse(b.subarray(4, 4 + length).toString('utf8'));
}
const near = (a, b, slack, what) => assert.ok(Math.abs(a - b) <= slack, `${what}: physics ${a} vs model ${b}`);

for (const kind of Object.keys(AIRCRAFT)) {
  test(`${kind}: the wheels of the flight model are the wheels of the model`, () => {
    const t = makeTune(kind), p = header(kind).points;
    const third = p.wheelTail || p.wheelNose;
    const wheels = [p.wheelL, p.wheelR, third];
    assert.equal(t.gear.length, 3);
    t.gear.forEach((w, i) => {
      near(w.x, wheels[i][0], 0.03, `wheel ${i} x`);
      near(w.y, wheels[i][1], 0.03, `wheel ${i} y (tyre bottom)`);
      near(w.z, wheels[i][2], 0.03, `wheel ${i} z`);
    });
    // left is +X: the left wheel is the first one
    assert.ok(t.gear[0].x > 0 && t.gear[1].x < 0);
    assert.equal(!!t.tail, !!p.wheelTail, 'a tail wheel makes a tail-dragger');
    // standing on them, the nose is where the model's own gear puts it
    const rest = restAttitude(t);
    const expected = Math.atan((third[1] - p.wheelL[1]) / (p.wheelL[2] - third[2]));
    near(rest.pitch, expected, 0.01, 'pitch at rest');
    // the centre of gravity stands as far above the ground as it is from the line through the tyres, less the sag of the legs
    const run = Math.hypot(p.wheelL[2] - third[2], p.wheelL[1] - third[1]);
    const stand = Math.abs(p.wheelL[2] * (third[1] - p.wheelL[1]) - p.wheelL[1] * (third[2] - p.wheelL[2])) / run;
    assert.ok(rest.height > stand - 0.12 && rest.height <= stand + 0.01, `stands ${rest.height} m high, the model ${stand}`);
  });

  test(`${kind}: the hull of the flight model is the hull of the model`, () => {
    const t = makeTune(kind), h = header(kind), p = h.points;
    const of = (name) => t.hull.filter((c) => c.kind === name);
    // wing tips: every tip of the model has a hull point within a hand's breadth, a little inside
    const tips = Object.entries(p).filter(([name]) => /^tip/.test(name));
    assert.ok(tips.length >= 2);
    for (const [name, at] of tips) {
      const side = at[0] > 0 ? 'tipL' : 'tipR';
      const best = Math.min(...of(side).map((c) => Math.hypot(c.x - at[0], c.y - at[1], c.z - at[2])));
      assert.ok(best < 0.15, `${name} is ${best.toFixed(2)} m from the nearest ${side} hull point`);
    }
    near(of('nose')[0].z, p.nose[2], 0.15, 'nose');
    near(of('nose')[0].y, p.nose[1], 0.05, 'nose height');
    near(of('fin')[0].y, p.finTop[1], 0.05, 'fin top');
    const lowest = Math.min(...of('belly').map((c) => c.y));
    assert.ok(lowest <= p.belly[1] + 0.03, 'the belly is no higher than the model’s');
    // nothing of the hull is lower than the tyres: it stands on its wheels, not on its belly
    const tyres = Math.min(...t.gear.map((w) => w.y));
    for (const c of t.hull) assert.ok(c.y > tyres + 0.15, `${c.kind} at ${c.y} clears the wheels at ${tyres}`);
    // the real size
    near(t.span, h.bounds.max[0] - h.bounds.min[0], 0.25, 'span');
    if (p.propHub) {
      // the propeller's lowest point clears the ground with the tail up
      const prop = of('prop')[0];
      near(prop.y, p.propHub[1] - p.propRadius, 0.08, 'propeller tip');
      assert.ok(prop.y > tyres + 0.15, 'propeller clearance, tail up');
    }
  });
}

test('each aircraft has its own eye, exhaust and lights for the camera and the effects', () => {
  for (const kind of Object.keys(AIRCRAFT)) {
    const p = header(kind).points;
    for (const name of ['eye', 'seat', 'lightL', 'lightR', 'lightTail']) assert.equal(p[name]?.length >= 3, true, `${kind} ${name}`);
    assert.ok(p.lightL[0] > 0 && p.lightR[0] < 0, 'red to port, green to starboard');
    assert.ok(p.eye[1] > p.seat[1], 'the eyes are above the seat');
  }
  const jet = header('jet').points, classic = header('classic').points;
  assert.ok(jet.nozzle && jet.nozzleRadius > 0.3 && jet.nozzle[2] < -5, 'the jet has a nozzle at its tail');
  assert.ok(classic.exhaustL && classic.propHub && classic.propRadius > 1, 'the biplane has exhausts and a propeller');
});
