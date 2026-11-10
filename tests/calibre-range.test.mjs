import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN } from '../js/calibre-plan.js';
import { PAPER, STAGES, MEDALS, HITS_PER_STAGE, RANGE_WEAPONS, scoreHit, medalFor, rangeDiscount, finalScore, carrierAt } from '../js/calibre-range.js';

test('a hole is worth more the nearer it is to the middle of the sheet', () => {
  assert.equal(scoreHit(0, 0).points, 12);
  assert.equal(scoreHit(0.02, 0.01).zone, '10');
  const along = [0, 0.02, 0.05, 0.09, 0.14].map(x => scoreHit(x, 0).points);
  for (let i = 1; i < along.length; i++) assert.ok(along[i] < along[i - 1], along.join(' '));
  assert.equal(scoreHit(0, PAPER.head[1]).zone, 'TÊTE');
  assert.equal(scoreHit(0.17, -0.25).zone, 'SILHOUETTE');
  assert.equal(scoreHit(0.23, 0.42).zone, 'PAPIER');
  assert.equal(scoreHit(PAPER.w / 2 + 0.001, 0), null);
  assert.equal(scoreHit(0, -PAPER.h / 2 - 0.001), null);
});

test('medals: thresholds in order, paid by score, and a full board is 15 % off', () => {
  assert.deepEqual(MEDALS.map(m => m.score), [...MEDALS.map(m => m.score)].sort((a, b) => a - b));
  assert.equal(medalFor(0), 0); assert.equal(medalFor(MEDALS[0].score), 1); assert.equal(medalFor(MEDALS[1].score - 1), 1);
  assert.equal(medalFor(MEDALS[2].score), 3);
  assert.equal(rangeDiscount({}), 0); assert.equal(rangeDiscount(undefined), 0);
  assert.ok(Math.abs(rangeDiscount(Object.fromEntries(RANGE_WEAPONS.map(id => [id, 3]))) - 0.15) < 1e-9);
  assert.ok(Math.abs(rangeDiscount({ pistol: 2, rifle: 9, grenade: 3 }) - 0.15 * 5 / 12) < 1e-9, 'unknown weapons and impossible medals do not count');
  // gold is within reach of clean, quick shooting; spraying the sheet is not enough for bronze
  const clean = finalScore(STAGES.length * HITS_PER_STAGE * 10, 24, 40, 36), spray = finalScore(STAGES.length * HITS_PER_STAGE * 3, 0, 220, 36);
  assert.equal(medalFor(clean), 3, String(clean));
  assert.equal(medalFor(spray), 0, String(spray));
  assert.equal(finalScore(100, 0, 0, 0), 100);
});

test('the carrier stays between the bench and the trap, and does what each stage says', () => {
  const line = PLAN.line.z + PLAN.line.depth / 2 + 0.35;
  for (const stage of STAGES) {
    for (let t = 0; t <= stage.time; t += 0.1) {
      const c = carrierAt(stage, t), z = line - c.d;
      assert.ok(z < PLAN.line.z - PLAN.line.depth / 2 - 1 && z > PLAN.trap.z + PLAN.trap.depth / 2 + 0.3, `${stage.name}: z ${z.toFixed(1)}`);
      assert.ok(Math.abs(c.x) <= 0.6 && c.turn >= 0 && c.turn <= 1);
    }
  }
  const advance = STAGES.find(s => s.move === 'advance'), flip = STAGES.find(s => s.move === 'flip'), sway = STAGES.find(s => s.move === 'sway');
  assert.equal(carrierAt(advance, 0).d, advance.d); assert.equal(carrierAt(advance, advance.time).d, advance.to);
  const faces = Array.from({ length: 230 }, (_, i) => carrierAt(flip, i / 10).turn);
  assert.ok(faces.some(v => v === 0) && faces.some(v => v === 1), 'it faces the shooter, then turns edge-on');
  assert.ok(Math.max(...Array.from({ length: 80 }, (_, i) => Math.abs(carrierAt(sway, i / 10).x))) > 0.4);
});
