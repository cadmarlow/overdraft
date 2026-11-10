import test from 'node:test';
import assert from 'node:assert/strict';
import { convertDefenderPickup, DEFENDER_PICKUP_LAYOUT as L } from '../tools/cars/pickup-conversion.mjs';
import { OFFROAD_MODELS, correctDefenderFrontNormals } from '../tools/cars/fleet-offroad.mjs';

function primitive(name, pos, index, extra = {}) {
  const n = pos.length / 3;
  return { label: name, item: { node: name, mesh: name, path: name }, name: 'OriginalMaterial', material: { name: 'OriginalMaterial' },
    data: { pos: Float64Array.from(pos), nor: Float64Array.from({ length: n * 3 }, (_, i) => i % 3 === 2 ? 1 : 0),
      uv: Float64Array.from({ length: n * 2 }, (_, i) => i % 2 ? 0.75 : 0.25), index: Uint32Array.from(index), hasNormals: true, flipped: false }, ...extra };
}
const close = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} differs from ${b}`);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const subtract = (a, b) => a.map((v, i) => v - b[i]);

test('pickup conversion keeps wheel and chassis anchors while removing roof rack, spare and cargo glazing', () => {
  const wheel = primitive('rear-left-wheel', [6, 0, -15, 7, 1, -15, 6, 1, -14], [0, 1, 2], { wheelLike: true });
  const chassis = primitive('chassis', [-2, 0, -20, 2, 0, -20, 0, 0, 4], [0, 1, 2]);
  const roof = primitive('roofbar_302', [-2, 13, -18, 2, 13, -18, 0, 14, 2], [0, 1, 2]);
  const spare = primitive('rear-spare-wheel', [-1, 3, -25, 1, 3, -25, 0, 8, -25], [0, 1, 2], { wheelLike: true });
  const rearGlass = primitive('rear-cargo-window', [-1, 7, -20, 1, 7, -20, 0, 10, -20], [0, 1, 2], { glass: true });
  const before = structuredClone([wheel, chassis, roof, spare, rearGlass]);
  const result = convertDefenderPickup([wheel, chassis, roof, spare, rearGlass]);
  assert.ok(result.includes(wheel)); assert.ok(result.includes(chassis));
  for (const removed of [roof, spare, rearGlass]) assert.ok(!result.some((p) => p.item.node === removed.item.node));
  assert.deepEqual([wheel, chassis, roof, spare, rearGlass], before);
});

test('triangles crossing the cab cut are clipped exactly instead of dropping visible front-door geometry', () => {
  const panel = primitive('shared-roof', [-2, 11, -8, 2, 11, -8, 2, 11, -5, -2, 11, -5], [0, 1, 2, 0, 2, 3]);
  const result = convertDefenderPickup([panel]).find((p) => p.item.node === 'shared-roof');
  assert.ok(result);
  const zs = Array.from(result.data.pos).filter((_, i) => i % 3 === 2);
  close(Math.min(...zs), L.cabinBackZ); close(Math.max(...zs), -5);
  let area = 0;
  for (let i = 0; i < result.data.index.length; i += 3) {
    const vertices = [0, 1, 2].map((j) => Array.from(result.data.pos.slice(result.data.index[i + j] * 3, result.data.index[i + j] * 3 + 3)));
    area += Math.hypot(...cross(subtract(vertices[1], vertices[0]), subtract(vertices[2], vertices[0]))) / 2;
  }
  close(area, 4 * (-5 - L.cabinBackZ));
  assert.ok(result.data.uv.every((v) => v === 0.25 || v === 0.75));
});

test('new cargo space is open above the liner and preserves the original outer quarter panels', () => {
  const seats = primitive('rear-seats', [-3, 3, -13, 3, 3, -13, 3, 5, -10, -3, 5, -10], [0, 1, 2, 0, 2, 3]);
  const wingX = L.centerX + L.innerHalfWidth + 0.2;
  const wing = primitive('outer-quarter', [wingX, 3, -19, wingX, 5, -19, wingX, 5, -10], [0, 1, 2]);
  const result = convertDefenderPickup([seats, wing]);
  assert.ok(!result.some((p) => p.item.node === 'rear-seats'));
  const fittedWing = result.find((p) => p.item.node === 'outer-quarter'); assert.ok(fittedWing);
  close(Math.min(...Array.from(fittedWing.data.pos).filter((_, i) => i % 3 === 1)), 3);
  const liner = result.find((p) => p.name === 'PickupBedLiner');
  assert.ok(liner.data.pos.some((value, i) => i % 3 === 1 && Math.abs(value - (L.floorY + 0.085)) < 1e-8), 'floor must have real longitudinal ribs');
});

test('rear cab has an actual glazed aperture and the pickup gets two separate rear lamp roles', () => {
  const result = convertDefenderPickup([]), glass = result.find((p) => p.name === 'PickupRearGlass'), paint = result.find((p) => p.name === 'PickupPaint');
  assert.ok(glass.glass); assert.equal(glass.material.alphaMode, 'BLEND'); assert.ok(paint.paint);
  const midpoint = [L.centerX, (L.railY + 0.85 + L.roofY - 1.65) / 2];
  const hits = [];
  for (let i = 0; i < paint.data.index.length; i += 3) {
    const p = [0, 1, 2].map((j) => Array.from(paint.data.pos.slice(paint.data.index[i + j] * 3, paint.data.index[i + j] * 3 + 3)));
    if (p.some((v) => Math.abs(v[2] - L.cabinBackZ) > 0.15)) continue;
    const [a, b, c] = p, d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-8) continue;
    const u = ((b[1] - c[1]) * (midpoint[0] - c[0]) + (c[0] - b[0]) * (midpoint[1] - c[1])) / d;
    const v = ((c[1] - a[1]) * (midpoint[0] - c[0]) + (a[0] - c[0]) * (midpoint[1] - c[1])) / d;
    if (u >= 0 && v >= 0 && u + v <= 1) hits.push(i);
  }
  assert.deepEqual(hits, [], 'paint must not obstruct the rear-window centre');
  assert.ok(result.some((p) => p.name === 'PickupBrakeLight')); assert.ok(result.some((p) => p.name === 'PickupReverseLight'));
});

test('generated body surfaces are finite, outward-facing and share six preparation-time materials', () => {
  const parts = convertDefenderPickup([]); assert.equal(parts.length, 6);
  let triangles = 0;
  for (const part of parts) {
    const d = part.data; triangles += d.index.length / 3;
    assert.ok(d.pos.every(Number.isFinite)); assert.ok(d.nor.every(Number.isFinite));
    for (let i = 0; i < d.nor.length; i += 3) close(Math.hypot(d.nor[i], d.nor[i + 1], d.nor[i + 2]), 1);
    for (let i = 0; i < d.index.length; i += 3) {
      const ids = Array.from(d.index.slice(i, i + 3)), p = ids.map((id) => Array.from(d.pos.slice(id * 3, id * 3 + 3)));
      const face = cross(subtract(p[1], p[0]), subtract(p[2], p[0])), length = Math.hypot(...face);
      assert.ok(length >= 1e-10, `${part.name} contains a zero-area triangle`);
      for (const id of ids) {
        const normal = Array.from(d.nor.slice(id * 3, id * 3 + 3)); close(Math.hypot(...normal), 1);
        assert.ok(face.reduce((sum, v, j) => sum + v * normal[j], 0) > -1e-8, `${part.name} has a reversed surface`);
      }
    }
  }
  assert.ok(triangles < 3000, `pickup additions unexpectedly expensive: ${triangles}`);
});

test('wheel-tub closures meeting the floor never emit zero normals into the offline fitting pipeline', () => {
  const liner = convertDefenderPickup([]).find((p) => p.name === 'PickupBedLiner').data;
  const reach = Math.sqrt(L.wheelhouseRadius ** 2 - (L.floorY - L.wheelhouseCenterY) ** 2);
  let endpoints = 0;
  for (let i = 0; i < liner.pos.length; i += 3) {
    if (Math.abs(liner.pos[i + 1] - L.floorY) > 1e-8 || Math.abs(Math.abs(liner.pos[i + 2] - L.rearAxleZ) - reach) > 1e-8) continue;
    endpoints++;
    close(Math.hypot(liner.nor[i], liner.nor[i + 1], liner.nor[i + 2]), 1);
  }
  assert.ok(endpoints >= 8, 'the floor must still join both wheel tubs after removing degenerate closure faces');
});

test('conversion rejects inverted dimensions before modifying any source', () => {
  assert.throws(() => convertDefenderPickup([], { cabinBackZ: -25 }), /dimensions/);
  assert.throws(() => convertDefenderPickup([], { floorY: 7 }), /dimensions/);
});

test('offroad recipe identifies running-wheel nodes without confusing dashboard mesh numbers or the static spare', () => {
  const m = OFFROAD_MODELS.offroad;
  for (const node of [74, 75, 86, 94, 120, 121, 129, 135, 671, 672, 673, 675, 676, 677]) assert.ok(m.wheel.test(`Object_${node} other-mesh Material`));
  assert.ok(!m.wheel.test('Object_146 Object_74 blackplastic'), 'mesh Object_74 belongs to the dashboard');
  for (const node of [77, 78, 88, 96]) assert.ok(!m.wheel.test(`Object_${node} spare-wheel Material`));
  for (const node of [642, 643, 644, 645, 646, 647, 669]) assert.ok(m.drop.test(`Object_${node}`));
  assert.ok(!m.drop.test('Object_9'), 'the real white roof must survive removal of the external rack');
  assert.ok(!m.drop.test('Object_640'), 'the neighbouring mirror-arm node must survive');
});

test('offroad glass keeps explicit transparency and exterior optics retain independent lamp roles', () => {
  const m = OFFROAD_MODELS.offroad, source = { name: 'glass', pbrMetallicRoughness: { baseColorTexture: { index: 3 } }, alphaMode: 'BLEND' };
  const material = m.material(source);
  assert.ok(material.pbrMetallicRoughness.baseColorFactor[3] < 0.5);
  assert.deepEqual(source.pbrMetallicRoughness, { baseColorTexture: { index: 3 } });
  assert.equal(m.light({ item: { node: 'Object_391', path: 'frontleftheadlight_177' } }), 1);
  assert.equal(m.light({ item: { node: 'Object_48', path: 'backleftbrakelightcover_21' } }), 2);
  assert.equal(m.light({ item: { node: 'Object_411', path: 'frontleftturnlightcover_187' } }), 4);
  assert.equal(m.light({ item: { node: 'PickupReverseLight' } }), 3);
});

test('shared white source lenses bake red stop lamps and amber indicators without colouring the headlights', () => {
  const m = OFFROAD_MODELS.offroad;
  const source = { name: 'Material.006', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.25] }, emissiveFactor: [1, 0.66, 0.56] };
  const paths = ['backleftbrakelightcover_21', 'backrightfoglightcover_50', 'backleftlightcover_33'];
  for (const path of paths) {
    const lens = m.material(source, { path }).pbrMetallicRoughness.baseColorFactor;
    assert.ok(lens[0] > lens[1] * 20 && lens[0] > lens[2] * 20, 'a stop-lamp atlas swatch must retain a strong red hue');
    assert.equal(m.light({ item: { path } }), 2);
  }
  for (const path of ['frontleftturnlightcover_187', 'backrightlight1cover_54']) {
    const lens = m.material(source, { path }).pbrMetallicRoughness.baseColorFactor;
    assert.ok(lens[0] > lens[1] && lens[1] > lens[2] * 10, 'indicator lenses must retain amber in daylight');
    assert.equal(m.light({ item: { path } }), 4);
  }
  const front = m.material(source, { path: 'frontleftheadlightcover_177' }).pbrMetallicRoughness.baseColorFactor;
  assert.ok(Math.max(...front.slice(0, 3)) - Math.min(...front.slice(0, 3)) < 0.15);
  assert.equal(m.light({ item: { path: 'trailerlightcover_326' } }), 3);
  const reflector = { name: 'chrome', pbrMetallicRoughness: { baseColorFactor: [0.04, 0.04, 0.04, 1], metallicFactor: 1 } };
  assert.deepEqual(m.material(reflector, { path: 'backleftbrakelight_20' }), reflector, 'reflector substrate must keep its source material');
  assert.deepEqual(source.pbrMetallicRoughness.baseColorFactor, [1, 1, 1, 0.25], 'shared GLB material must remain immutable');
});

test('front lamp surrounds stay dark on both sides while the mismatched source lens names bake identically', () => {
  const m = OFFROAD_MODELS.offroad, housing = { name: 'matteblack', pbrMetallicRoughness: { baseColorFactor: [0.015, 0.015, 0.015, 1] } };
  for (const path of ['leftfrontlightcover_268/Object_571', 'frontrightlightcover_216/Object_469']) {
    assert.deepEqual(m.material(housing, { path }), housing);
    assert.equal(m.light({ item: { path }, name: housing.name }), 0, 'the full rectangular surround must not emit headlight light');
  }
  const lens = { name: 'Material.006', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.25] } };
  const left = { path: 'frontleftheadlight_177/Object_391' }, right = { path: 'frontrightheadlightcover_214/Object_465' };
  assert.deepEqual(m.material(lens, left), m.material(lens, right));
  assert.equal(m.light({ item: left, name: lens.name }), 1); assert.equal(m.light({ item: right, name: lens.name }), 1);
});

test('single-cab driving position reserves space behind the reclined shoulders without moving the source wheel', () => {
  const suv = OFFROAD_MODELS.offroad, pickup = OFFROAD_MODELS.pickup;
  // The measured fitting ratio near the single cab is 0.14 m/source unit. A clothed shoulder can extend 0.30 m behind
  // the hip with the existing driving pose; this includes the rear surface, not merely the shoulder's joint centre.
  const seatToInnerWall = (pickup.sourceSeat[2] - (L.cabinBackZ + 0.12)) * 0.14;
  assert.ok(seatToInnerWall > 0.32, 'the source seat must leave clearance for the real driver shoulder envelope');
  assert.ok(pickup.sourceSeat[2] >= -5.73 && pickup.sourceSeat[2] <= -1.69, 'the hip must remain on the measured front cushion');
  assert.deepEqual(pickup.steeringPosition, suv.steeringPosition);
  assert.deepEqual(pickup.steeringAxis, suv.steeringAxis);
});

test('authored mirrored front lamps face the exterior ray after correction, with unchanged geometry and bright headlight data', () => {
  const m = OFFROAD_MODELS.offroad;
  const left = primitive('left-lens', [4.2, 3.4, 10.92, 4.8, 3.4, 10.92, 4.5, 4, 10.92], [0, 1, 2]).data;
  const right = { ...left, pos: Float64Array.from(left.pos, (value, i) => i % 3 === 0 ? -value - 0.611 : value), nor: Float64Array.from(left.nor, value => -value) };
  const paths = ['frontleftheadlight_177', 'frontrightheadlightcover_214'];
  for (const [i, original] of [left, right].entries()) {
    const item = { node: ['Object_391', 'Object_465'][i], path: paths[i] }, d = correctDefenderFrontNormals(original, item);
    const ids = d.flipped ? [d.index[0], d.index[2], d.index[1]] : [...d.index];
    const p = ids.map(id => Array.from(d.pos.slice(id * 3, id * 3 + 3)));
    const face = cross(subtract(p[1], p[0]), subtract(p[2], p[0]));
    assert.ok(face[2] > 0, 'an exterior ray travelling along -Z must meet the front face, not the cabin side');
    assert.ok(d.nor[2] > 0, 'the shading normal must agree with the exposed lens surface');
    assert.equal(m.light({ item, name: 'Material.006' }), 1);
    const lens = m.material({ name: 'Material.006' }, item).pbrMetallicRoughness.baseColorFactor;
    assert.ok(lens.slice(0, 3).every(value => value >= 0.8), 'both outer lens centres must retain a clear headlight swatch');
    assert.equal(d.pos, original.pos); assert.equal(d.index, original.index); assert.equal(d.uv, original.uv);
  }
  assert.equal(right.flipped, false); assert.equal(right.nor[2], -1, 'normal repair must not mutate the shared primitive');
  assert.equal(correctDefenderFrontNormals(right, { node: 'Object_9' }), right, 'the actual roof and other body panels must remain untouched');
});
