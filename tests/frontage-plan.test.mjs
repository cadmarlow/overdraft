import test from 'node:test';
import assert from 'node:assert/strict';
import { frontagePanels, planFrontages, wallPoint } from '../js/frontage-plan.js';

const street = { ax: 0, az: 0, ux: 1, uz: 0, nx: 0, nz: 1, width: 9, bottom: 0.22, top: 18 };
const noObstruction = () => true;
const roadDistance = ({ z }) => Math.abs(z - 16);
const style = { type: 'rowhouse', floor: 3.5, bay: 2.25 };

test('a row house has one arched entry on the street and windows on clear side and courtyard walls', () => {
  const side = { ...street, ax: 0, ux: 0, uz: -1, nx: 1, nz: 0, width: 19 };
  const court = { ...street, az: -15, width: 12, court: true };
  const shop = { ...street, ax: 15, shop: true };
  const [front, lateral, courtyard, ...other] = planFrontages(style, [street, side, court, shop], noObstruction, roadDistance);
  assert.equal(other.length, 0);
  const entries = front.openings.filter(o => o.type === 'entry');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].arched, true);
  assert.equal(entries[0].y0, street.bottom);
  assert.ok(entries[0].recess > 0.35);
  assert.ok(front.openings.some(o => o.type === 'window'));
  for (const f of [lateral, courtyard]) {
    assert.ok(f.openings.length > 0);
    assert.ok(f.openings.every(o => o.type === 'window'));
  }
});

test('large lobbies have a wide recessed entrance and low glazing with room at either corner', () => {
  const wall = { ...street, width: 37 };
  const [plan] = planFrontages({ type: 'glass', floor: 4.6, bay: 3.8 }, [wall], noObstruction, roadDistance);
  const entry = plan.openings.find(o => o.type === 'entry');
  const window = plan.openings.find(o => o.type === 'window');
  assert.ok(entry.hi - entry.lo > 3);
  assert.ok(entry.recess > 0.5);
  assert.ok(window.y0 - wall.bottom < 0.35);
  assert.ok(plan.openings.every(o => o.lo > 0 && o.hi < wall.width && o.y1 < 4.6));
  for (const [index, o] of plan.openings.slice(1).entries()) assert.ok(o.lo > plan.openings[index].hi);
});

test('obstructions leave the wall solid and a shop gets no competing holes', () => {
  const short = { ...street, top: 2.6 };
  const [partlyClear] = planFrontages(style, [street, short, { ...street, shop: true }], (_, s) => s > 5.3, roadDistance);
  assert.ok(partlyClear.openings.every(o => (o.lo + o.hi) / 2 > 5.3));
  assert.deepEqual(planFrontages(style, [street, short], () => false, roadDistance), []);
});

test('ground-storey panels leave exactly the planned openings and keep one upper wall', () => {
  const [plan] = planFrontages(style, [street], noObstruction, roadDistance);
  const panels = frontagePanels(street.width, street.bottom, street.top, plan.openings);
  const [lo, hi, y0, y1] = panels[0];
  assert.deepEqual([lo, hi, y1], [0, street.width, street.top]);
  assert.equal(y0, Math.max(...plan.openings.map(o => o.y1)));
  const area = rectangles => rectangles.reduce((sum, [a, b, c, d]) => sum + (b - a) * (d - c), 0);
  const holeArea = area(plan.openings.map(o => [o.lo, o.hi, o.y0, o.y1]));
  assert.ok(Math.abs(area(panels) + holeArea - street.width * (street.top - street.bottom)) < 1e-8);
  for (const [a, b, c, d] of panels) for (const o of plan.openings) {
    assert.ok(b <= o.lo || a >= o.hi || d <= o.y0 || c >= o.y1, 'the wall never paints over a cutout');
  }
  const angled = { ...street, ux: 0.6, uz: 0.8, nx: -0.8, nz: 0.6 };
  assert.deepEqual(wallPoint(angled, 5, -0.5), { x: 3.4, z: 3.7 });
});
