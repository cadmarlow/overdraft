import assert from 'node:assert/strict';
import test from 'node:test';
import { CITY_BLOCKS as BLOCKS } from '../js/city-config.js';
import { insideCity } from '../js/city-frontier.js';
import { curbOutline } from '../js/ground-plan.js';
import { groundFootprint } from '../js/ground-surfaces.js';
import { buildRoadNetwork, buildRoadNetworkAsync } from '../js/road-network.js';

test('Manhattan traffic keeps every lane and turn off the real curb islands, without orphaned lanes', { timeout: 90000 }, async () => {
  // Use only rectangular blocks to infer the grid: its inferred lanes must still respect all the irregular blocks
  // and parks that the separate curb survey supplies. This reproduces the missing-cover failure with real geography.
  const layout = BLOCKS.filter(b => b.rect && !b.median && b.park < 0.6).map(b => ({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ }));
  const curbs = BLOCKS.map(b => groundFootprint(b.park > 0.6 && !b.median && b.parkName !== 'Bryant Park' ? b.poly : curbOutline(b.poly).loop));
  const n = buildRoadNetwork(layout, [], [], curbs), p = {};
  assert.ok(n.edges.length > 3000, `road coverage collapsed: ${n.edges.length}`);
  let curves = 0;
  for (const e of n.edges) {
    for (let i = 0; i < e.lanes.length; i++) {
      assert.ok(e.moves.some(m => m.out[i] >= 0), `orphaned lane ${e.id}:${i}`);
      for (let s = 0; s <= e.len; s += 2) {
        assert.equal(n.onSidewalk(e.sx + e.dx * s + e.rx * e.lanes[i], e.sz + e.dz * s + e.rz * e.lanes[i]), false, `lane ${e.id}:${i} on sidewalk`);
      }
    }
    for (const m of e.moves) for (let i = 0; i < m.out.length; i++) {
      const j = m.out[i];
      if (j < 0) continue;
      assert.ok(j < m.to.lanes.length, 'lane indices remain valid after removal');
      const c = n.connector(e, i, m.to, j);
      curves++;
      for (let s = 0; s <= c.len; s += 0.5) {
        n.curvePoint(c, s, p);
        assert.ok(insideCity(p.x, p.z), `turn ${e.id} leaves the compact city`);
        assert.equal(n.onSidewalk(p.x, p.z), false, `turn ${e.id}:${i} -> ${m.to.id}:${j} on sidewalk`);
      }
    }
  }
  assert.ok(curves > 7800, `turn coverage collapsed: ${curves}`);
  let beats = 0;
  const timer = setInterval(() => beats++, 1);
  let incremental;
  try { incremental = await buildRoadNetworkAsync(layout, [], [], curbs); }
  finally { clearInterval(timer); }
  assert.ok(beats > 1, 'browser startup must service other tasks while building the real city');
  const snapshot = network => network.edges.map(e => ({ sx: e.sx, sz: e.sz, len: e.len, lanes: e.lanes,
    moves: e.moves.map(m => ({ to: m.to.id, out: m.out })) }));
  assert.deepEqual(snapshot(incremental), snapshot(n), 'incremental startup preserves every lane and turn');
});
