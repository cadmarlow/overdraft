// The shape of the ground, worked out from the data the city already has: each curb island's outline with its corners
// rounded as New York builds them, the rings that make a curbstone and a sidewalk out of that outline, and every
// roadway cut into the bands traffic really uses (travel lanes, parking lanes, bike lanes), so the shaders can put wear
// where use puts it. Pure: no three.js, tested in tests/ground-plan.test.cjs.

const CURB_HEIGHT = 0.22; // ISLAND_BOUNDS.sidewalkHeight
const CURB_WIDTH = 0.17; // a granite curbstone seen from above
const CURB_RADIUS = 2.4; // corner radius at the curb line
const WALK_DEPTH = 4.6; // how far in from the curb the sidewalk rings run (lots start about 4.4 m in)
const GUTTER_WIDTH = 0.6;
const ARC_STEP = Math.PI / 8; // an arc point every 22.5 degrees
const ROAD_LIFT = 0.004; // the lane bands lie this far over the island's asphalt deck
const ROAD_OVERLAP = 0.4; // and run this far under the curbs, so no deck shows along them
const PARK_HALF = 1.15;

const KIND = { other: 0, lane: 1, parking: 2, bike: 3, box: 4, bus: 5 };
// Avenues whose curbside lane is a red bus lane (as their real counterparts')
const BUS_AVENUES = /^(1st|2nd|3rd|5th|Madison|Lexington) Ave/;
// An edge runs along an avenue when both its junctions are that avenue's (a cross street joins two different ones)
const avenueOf = (e) => {
  const a = (e.from.node || e.from).avenue, b = (e.to.node || e.to).avenue;
  return a && a === b ? a.name || '' : '';
};
const hasBusLane = (e) => !e.general && e.lanes.length >= 2 && BUS_AVENUES.test(avenueOf(e));

// ---------------------------------------------------------------------------------------------------------------------
// Curb outline
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The outline of a curb island with its convex corners rounded, as sides running corner to corner.
 * A point: { x, z, nx, nz (unit inward normal), t (metres along its side), r (corner radius: Infinity on a straight
 * edge, 0 at a sharp vertex), cx, cz (arc centre), mx, mz (miter direction for offsets past the centre) }.
 * @returns {{ sides: object[][], loop: object[], area: number, perimeter: number }}
 */
function curbOutline(poly, radius = CURB_RADIUS) {
  // Drop repeated points
  const pts = [];
  for (const p of poly) {
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.z - q.z) > 0.05) pts.push(p);
  }
  if (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) <= 0.05) pts.pop();
  const n = pts.length;
  let area2 = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area2 += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  const orient = area2 >= 0 ? 1 : -1; // inward is to the left of travel when positive
  const inward = (ex, ez) => [-ez * orient, ex * orient];

  const loop = [];
  for (let i = 0; i < n; i++) {
    const P = pts[(i + n - 1) % n], V = pts[i], N = pts[(i + 1) % n];
    const l1 = Math.hypot(V.x - P.x, V.z - P.z), l2 = Math.hypot(N.x - V.x, N.z - V.z);
    const e1x = (V.x - P.x) / l1, e1z = (V.z - P.z) / l1, e2x = (N.x - V.x) / l2, e2z = (N.z - V.z) / l2;
    const [n1x, n1z] = inward(e1x, e1z);
    const [n2x, n2z] = inward(e2x, e2z);
    const cross = (e1x * e2z - e1z * e2x) * orient;
    const turn = Math.acos(Math.max(-1, Math.min(1, e1x * e2x + e1z * e2z)));
    if (turn < 0.04) {
      loop.push({ x: V.x, z: V.z, nx: n1x, nz: n1z, r: Infinity, corner: false });
      continue;
    }
    // Miter of the two edges: where the sharp corner goes when the outline is offset
    const k = 1 / Math.max(0.25, 1 + n1x * n2x + n1z * n2z);
    const mx = (n1x + n2x) * k, mz = (n1z + n2z) * k;
    const tan = Math.tan(turn / 2);
    const reach = Math.min(radius * tan, 0.42 * Math.min(l1, l2));
    const r = reach / tan;
    if (cross > 0 && turn > 0.26 && r >= 0.35) {
      const ax = V.x - e1x * reach, az = V.z - e1z * reach;
      const cx = ax + n1x * r, cz = az + n1z * r;
      const steps = Math.max(2, Math.ceil(turn / ARC_STEP));
      const sin = Math.sin(turn);
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        const wa = Math.sin((1 - f) * turn) / sin, wb = Math.sin(f * turn) / sin;
        const ux = -(n1x * wa + n2x * wb), uz = -(n1z * wa + n2z * wb); // from the centre out to the curb
        loop.push({ x: cx + ux * r, z: cz + uz * r, nx: -ux, nz: -uz, r, cx, cz, mx, mz, corner: s === Math.floor(steps / 2) && turn > 0.5 });
      }
    } else {
      const len = Math.hypot(mx, mz) || 1;
      loop.push({ x: V.x, z: V.z, nx: mx / len, nz: mz / len, r: 0, mx, mz, corner: turn > 0.5 });
    }
  }

  // Sides: from one corner to the next, t restarting at each, the corner point shared by both
  let start = loop.findIndex((p) => p.corner);
  if (start < 0) start = 0;
  const sides = [];
  let side = null;
  let perimeter = 0;
  for (let k = 0; k <= loop.length; k++) {
    const p = loop[(start + k) % loop.length];
    if (side) {
      const q = side[side.length - 1];
      const step = Math.hypot(p.x - q.x, p.z - q.z);
      perimeter += step;
      side.push({ ...p, t: q.t + step });
    }
    if (!side || (p.corner && k < loop.length)) {
      side = [{ ...p, t: 0 }];
      sides.push(side);
    }
  }
  return { sides, loop, area: Math.abs(area2) / 2, perimeter };
}

/** The outline point moved d metres into the island (d < 0: out into the roadway) */
function offsetPoint(p, d, out = {}) {
  if (p.r === Infinity || (p.r > 0 && d <= p.r)) {
    out.x = p.x + p.nx * d;
    out.z = p.z + p.nz * d;
  } else if (p.r > 0) {
    out.x = p.cx + p.mx * (d - p.r);
    out.z = p.cz + p.mz * (d - p.r);
  } else {
    out.x = p.x + p.mx * d;
    out.z = p.z + p.mz * d;
  }
  return out;
}

function pointInLoop(loop, x, z) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Whether (x, z), already known to be inside the block's sharp outline, is still on it once its corners are rounded */
function onRoundedBlock(block, x, z) {
  // Only a corner can differ: on a rectangular island, nothing further than a corner radius from two of its sides
  if (block.rect && (Math.min(x - block.minX, block.maxX - x) > CURB_RADIUS || Math.min(z - block.minZ, block.maxZ - z) > CURB_RADIUS)) return true;
  const o = block.curb || (block.curb = curbOutline(block.poly));
  return pointInLoop(o.loop, x, z);
}

// Ear clipping of a simple polygon given as [{x, z}]; returns triangle indices wound like the polygon
function triangulate(loop) {
  const n = loop.length;
  if (n < 3) return [];
  let area2 = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area2 += loop[j].x * loop[i].z - loop[i].x * loop[j].z;
  const sign = area2 >= 0 ? 1 : -1;
  const idx = Array.from({ length: n }, (_, i) => i);
  const out = [];
  const cross = (a, b, c) => ((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) * sign;
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = loop[ia], b = loop[ib], c = loop[ic];
      const area = cross(a, b, c);
      if (area < -1e-9) continue; // reflex
      let ear = true;
      if (area > 1e-9) {
        for (const k of idx) {
          if (k === ia || k === ib || k === ic) continue;
          const p = loop[k];
          if (cross(a, b, p) > 1e-9 && cross(b, c, p) > 1e-9 && cross(c, a, p) > 1e-9) { ear = false; break; }
        }
      }
      if (!ear) continue;
      if (area > 1e-9) out.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate leftovers
  }
  if (idx.length === 3 && cross(loop[idx[0]], loop[idx[1]], loop[idx[2]]) > 1e-9) out.push(idx[0], idx[1], idx[2]);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry accumulators: position (3), normal (3), one vec4 of surface coordinates, indices
// ---------------------------------------------------------------------------------------------------------------------
function accumulator() {
  return { position: [], normal: [], coord: [], index: [], count: 0 };
}
function vertex(acc, x, y, z, nx, ny, nz, a, b, c, d) {
  acc.position.push(x, y, z);
  acc.normal.push(nx, ny, nz);
  acc.coord.push(a, b, c, d);
  return acc.count++;
}
// Two triangles a-b-c-d, turned so they face `up` (1) or away from it
function quad(acc, a, b, c, d, flip) {
  if (flip) acc.index.push(a, c, b, a, d, c);
  else acc.index.push(a, b, c, a, c, d);
}

/**
 * One curb island as geometry: its curbstone (foot, face, rounded nose, top), the sidewalk behind it and the gutter
 * strip in the roadway along it.
 *   curb    coord = (t along the side, height above the road, distance in from the curb line, seed)
 *   walk    coord = (t along the side, the side's own seed in 0 .. 1 or -1 in the middle of the island, distance in
 *           from the curb line, seed): each side paves its own lots; the middle follows the world axes
 *   gutter  coord = (t, 0 at the curb .. 1 out in the roadway, 0, seed)
 * @param {{ poly: object[], rect: boolean, id: number }} block
 * @param {{ curb: object, walk: object, gutter: object }} acc accumulators
 */
function buildIsland(block, acc, { height = CURB_HEIGHT, radius = CURB_RADIUS, gutter = true } = {}) {
  const outline = block.curb || (block.curb = curbOutline(block.poly, radius));
  const seed = ((block.id * 0.61803398875) % 1 + 1) % 1;
  // Rings stay inside the island: no deeper than its inradius allows
  const depth = Math.max(CURB_WIDTH + 0.05, Math.min(WALK_DEPTH, (outline.area / Math.max(1, outline.perimeter)) * 0.9));
  // The triangle winding that faces up depends on which way the outline runs
  let area2 = 0;
  for (let i = 0, j = outline.loop.length - 1; i < outline.loop.length; j = i++) area2 += outline.loop[j].x * outline.loop[i].z - outline.loop[i].x * outline.loop[j].z;
  const flip = area2 >= 0;
  const p0 = {};
  const inner = [];
  // Where the sidewalk ends: on a rectangular island, the property line of its lots (5 to 6 m in, each side its own);
  // elsewhere a ring of the depth above. `reach` is how far in from the curb line that is, at this point.
  const lots = block.rect && block.rects && block.rects.length ? block.rects : null;
  let line = null;
  if (lots) {
    const x0 = Math.min(...lots.map((r) => r[0])), x1 = Math.max(...lots.map((r) => r[1])), z0 = Math.min(...lots.map((r) => r[2])), z1 = Math.max(...lots.map((r) => r[3]));
    const margins = [x0 - block.minX, block.maxX - x1, z0 - block.minZ, block.maxZ - z1];
    if (x1 - x0 > 1 && z1 - z0 > 1 && margins.every((m) => m >= 1.5 && m <= 14)) line = { x0, x1, z0, z1 };
  }
  const inward = (p, out) => {
    if (line) {
      out.x = Math.min(line.x1, Math.max(line.x0, p.x));
      out.z = Math.min(line.z1, Math.max(line.z0, p.z));
    } else offsetPoint(p, depth, out);
    return out;
  };

  // Curb profile: [distance in, height, how far the normal has turned from facing the road to facing up]
  const profile = [[0, 0, 0.04], [0.012, height - 0.03, 0.18], [0.04, height, 0.85], [CURB_WIDTH, height, 1]];
  outline.sides.forEach((side, index) => {
    const sideSeed = ((seed * 7.13 + (index + 1) * 0.381966) % 1) * 0.98 + 0.01; // never 0: that is the middle of the island
    const rows = profile.map(() => []);
    const walkOuter = [], walkInner = [], gutIn = [], gutOut = [];
    side.forEach((p, i) => {
      // The way the side runs at this point: its coordinates are measured along it and square to it, wherever the
      // property line sends the inner edge
      const q = side[Math.min(i + 1, side.length - 1)], o = side[Math.max(i - 1, 0)];
      const turn = (q.x - o.x) * -p.nz + (q.z - o.z) * p.nx >= 0 ? 1 : -1;
      const tx = -p.nz * turn, tz = p.nx * turn;
      profile.forEach(([d, y, up], k) => {
        offsetPoint(p, d, p0);
        const h = Math.sqrt(Math.max(0, 1 - up * up));
        rows[k].push(vertex(acc.curb, p0.x, y, p0.z, -p.nx * h, up, -p.nz * h, p.t, y, d, seed));
      });
      offsetPoint(p, CURB_WIDTH, p0);
      walkOuter.push(vertex(acc.walk, p0.x, height, p0.z, 0, 1, 0, p.t, sideSeed, CURB_WIDTH, seed));
      inward(p, p0);
      walkInner.push(vertex(acc.walk, p0.x, height, p0.z, 0, 1, 0, p.t + (p0.x - p.x) * tx + (p0.z - p.z) * tz, sideSeed,
        Math.max(CURB_WIDTH + 0.05, (p0.x - p.x) * p.nx + (p0.z - p.z) * p.nz), seed));
      if (gutter) {
        gutIn.push(vertex(acc.gutter, p.x, ROAD_LIFT * 2, p.z, 0, 1, 0, p.t, 0, 0, seed));
        offsetPoint(p, -GUTTER_WIDTH, p0);
        gutOut.push(vertex(acc.gutter, p0.x, ROAD_LIFT * 2, p0.z, 0, 1, 0, p.t, 1, 0, seed));
      }
    });
    for (let i = 0; i + 1 < side.length; i++) {
      for (let k = 0; k + 1 < rows.length; k++) quad(acc.curb, rows[k][i], rows[k][i + 1], rows[k + 1][i + 1], rows[k + 1][i], flip);
      quad(acc.walk, walkOuter[i], walkOuter[i + 1], walkInner[i + 1], walkInner[i], flip);
      if (gutter) quad(acc.gutter, gutOut[i], gutOut[i + 1], gutIn[i + 1], gutIn[i], flip);
    }
  });

  // The middle of the island, under its buildings and plazas
  for (const p of outline.loop) {
    inward(p, p0);
    const last = inner[inner.length - 1];
    if (!last || Math.hypot(last.x - p0.x, last.z - p0.z) > 0.02) inner.push({ x: p0.x, z: p0.z });
  }
  if (inner.length > 2 && Math.hypot(inner[0].x - inner[inner.length - 1].x, inner[0].z - inner[inner.length - 1].z) <= 0.02) inner.pop();
  const base = acc.walk.count;
  for (const p of inner) vertex(acc.walk, p.x, height, p.z, 0, 1, 0, p.x, -1, depth, seed);
  const tris = triangulate(inner);
  for (let i = 0; i < tris.length; i += 3) {
    // triangulate() winds like the loop; quad() above turns that the same way
    if (flip) acc.walk.index.push(base + tris[i], base + tris[i + 2], base + tris[i + 1]);
    else acc.walk.index.push(base + tris[i], base + tris[i + 1], base + tris[i + 2]);
  }
  return { depth, outline };
}

// ---------------------------------------------------------------------------------------------------------------------
// Roadways
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The bands across one roadway, left to right in the frame of its edge `e` (offsets to the right of e's centreline):
 * each travel lane, the parking and bike lanes, and whatever is left over. `back` is the edge driving the other way on
 * the same roadway, if any.
 * @returns {{ lo: number, hi: number, kind: number, dir: number }[]} dir: 1 with e, -1 against it, 0 nobody drives it
 */
function roadBands(e, back = null, { bus = false } = {}) {
  const reach = e.half + ROAD_OVERLAP;
  const bands = [];
  for (const [f, sign] of back ? [[e, 1], [back, -1]] : [[e, 1]]) {
    const lanes = f.lanes;
    // Lanes are evenly spread; one closed by an obstacle leaves a hole, not a wider lane
    let gap = Math.min(3.7, f.half * 2);
    for (let i = 1; i < lanes.length; i++) gap = Math.min(gap, lanes[i] - lanes[i - 1]);
    lanes.forEach((o, i) => {
      const a = (o - gap / 2) * sign, b = (o + gap / 2) * sign;
      // the bus lane is the travel lane nearest the right curb
      bands.push({ lo: Math.min(a, b), hi: Math.max(a, b), kind: bus && f === e && i === lanes.length - 1 ? KIND.bus : KIND.lane, dir: sign });
    });
    const park = f.park || {};
    if (park.r !== null && park.r !== undefined) bands.push({ lo: Math.min((park.r - PARK_HALF) * sign, reach * sign), hi: Math.max((park.r - PARK_HALF) * sign, reach * sign), kind: KIND.parking, dir: sign });
    if (park.l !== null && park.l !== undefined) bands.push({ lo: Math.min((park.l + PARK_HALF) * sign, -reach * sign), hi: Math.max((park.l + PARK_HALF) * sign, -reach * sign), kind: KIND.parking, dir: sign });
    if (f.bike !== null && f.bike !== undefined) bands.push({ lo: Math.min((f.bike - 0.9) * sign, (f.bike + 0.9) * sign), hi: Math.max((f.bike - 0.9) * sign, (f.bike + 0.9) * sign), kind: KIND.bike, dir: sign });
  }
  // Clip to the roadway, drop what an earlier band already covers (lanes first, then bike lanes, then the parking lanes,
  // which reach to the curb and so keep whatever the bike lane leaves)
  const order = { [KIND.lane]: 0, [KIND.bus]: 0, [KIND.bike]: 1, [KIND.parking]: 2 };
  bands.sort((p, q) => order[p.kind] - order[q.kind] || p.lo - q.lo);
  const kept = [];
  for (const b of bands) {
    let pieces = [[Math.max(-reach, b.lo), Math.min(reach, b.hi)]];
    for (const k of kept) {
      pieces = pieces.flatMap(([lo, hi]) => {
        if (k.hi <= lo || k.lo >= hi) return [[lo, hi]];
        const rest = [];
        if (k.lo > lo) rest.push([lo, k.lo]);
        if (k.hi < hi) rest.push([k.hi, hi]);
        return rest;
      });
    }
    for (const [lo, hi] of pieces) if (hi - lo > 0.3) kept.push({ lo, hi, kind: b.kind, dir: b.dir });
  }
  kept.sort((p, q) => p.lo - q.lo);
  // Fill the gaps (medians' flanks, buffers, the strip past a single parking lane)
  const out = [];
  let x = -reach;
  for (const b of kept) {
    if (b.lo - x > 0.05) out.push({ lo: x, hi: b.lo, kind: KIND.other, dir: 0 });
    else b.lo = x;
    out.push(b);
    x = b.hi;
  }
  if (reach - x > 0.05) out.push({ lo: x, hi: reach, kind: KIND.other, dir: 0 });
  else if (out.length) out[out.length - 1].hi = reach;
  return out;
}

/**
 * Every roadway of the network as quads, one per band.
 *   road  = (s: metres from the roadway's first stop line, o: metres right of its centreline, length between stop
 *            lines, half width curb to curb)
 *   band  = (v: -1 .. 1 across the band, half width of the band, kind, seed of the roadway)
 *   flow  = (metres to the stop line this band's traffic is driving at, 0 no stop line / 1 unsignalised / 2 signal
 *            (+4 on an avenue), dx, dz of the roadway)
 * Intersection boxes of the grid come last, as kind `box`.
 * @param {{ edges: object[], paintEdges?: object[], nodes: object[] }} network
 * @param {(x: number, z: number) => object} cellOf returns the accumulator { position, road, band, flow, index, count } of a place
 */
function buildRoads(network, cellOf) {
  const roads = new Map();
  for (const e of network.paintEdges || network.edges) {
    const key = Math.min(e.from.id, e.to.id) * 65536 + Math.max(e.from.id, e.to.id);
    if (roads.has(key)) roads.get(key).push(e);
    else roads.set(key, [e]);
  }
  let serial = 0;
  for (const [e, back] of roads.values()) {
    serial++;
    const seed = ((serial * 0.754877666) % 1 + 1) % 1;
    const lift = ROAD_LIFT + (serial % 5) * 0.0006; // overlapping roadways (bends, forks) never share a plane
    // From the box of one intersection to the box of the next (a centreline street or a bend: from node to node)
    const start = (e.sx - e.x0) * e.dx + (e.sz - e.z0) * e.dz;
    const boxOf = (node) => (node.shape || node.general || e.general ? 0 : (e.axis === 'ave' ? node.hz : node.hx) || 0);
    const s0 = -(start - Math.min(start, boxOf(e.from)));
    const s1 = e.span - start - Math.min(e.span - start - e.len, boxOf(e.to));
    const stopOf = (node) => (node.shape ? 0 : (node.node || node).signal ? 2 : 1) + (e.axis === 'ave' ? 4 : 0);
    const acc = cellOf(e.sx + e.dx * e.len * 0.5, e.sz + e.dz * e.len * 0.5);
    for (const b of roadBands(e, back, { bus: hasBusLane(e) })) {
      const half = (b.hi - b.lo) / 2;
      const ids = [];
      for (const [s, o, v] of [[s0, b.lo, -1], [s0, b.hi, 1], [s1, b.hi, 1], [s1, b.lo, -1]]) {
        acc.position.push(e.sx + e.dx * s + e.rx * o, lift, e.sz + e.dz * s + e.rz * o);
        acc.road.push(s, o, e.len, e.half);
        acc.band.push(v, half, b.kind, seed);
        const toStop = b.dir > 0 ? e.len - s : b.dir < 0 ? s : 1e3;
        acc.flow.push(toStop, b.dir === 0 ? 0 : stopOf(b.dir > 0 ? e.to : e.from), e.dx, e.dz);
        ids.push(acc.count++);
      }
      // (rx, rz) x (dx, dz) points up, so this order faces the sky
      acc.index.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    }
  }
  // The boxes of the grid's intersections, where the lanes of two streets cross
  for (const n of network.nodes) {
    if (!(n.hx > 1 && n.hz > 1) || n.general) continue;
    const acc = cellOf(n.x, n.z);
    const seed = ((n.id * 0.569840291) % 1 + 1) % 1;
    const ids = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      acc.position.push(n.x + sx * n.hx, ROAD_LIFT, n.z + sz * n.hz);
      acc.road.push(sz * n.hz, sx * n.hx, n.hz * 2, n.hx);
      acc.band.push(sx, n.hx, KIND.box, seed);
      acc.flow.push(1e3, n.signal ? 2 : 1, 0, 1);
      ids.push(acc.count++);
    }
    acc.index.push(ids[0], ids[2], ids[1], ids[0], ids[3], ids[2]);
  }
  return serial;
}

export {
  CURB_HEIGHT, CURB_WIDTH, CURB_RADIUS, WALK_DEPTH, GUTTER_WIDTH, ROAD_LIFT, ROAD_OVERLAP, KIND, hasBusLane,
  curbOutline, offsetPoint, pointInLoop, onRoundedBlock, triangulate, accumulator, buildIsland, roadBands, buildRoads
};
