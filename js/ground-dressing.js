// What lies in and on the ground of a New York street, placed by what the street is: manhole covers in the lanes and
// the intersections, storm grates where the gutters end, the oil of parked engines, braking marks at the signals,
// turn arrows and BUS ONLY on the avenues, the utility crews' spray paint; on the sidewalks, detectable-warning pads at
// the corners, valve caps, hand-holes and pull boxes along the curb. Pure: no three.js, deterministic, tested in tests/ground-plan.test.cjs.
//
// A decal: { sheet: 'object' | 'mark', tile, x, z, y, lx, lz, scale, tint: [r, g, b, a], gloss, wear }
//   (lx, lz) is the unit direction the tile's top points to (a road symbol's direction of travel); its width runs to
//   the right of it, (-lz, lx). `scale` multiplies the tile's real size. For marks, `gloss` is their roughness and
//   `wear` how much of the paint has flaked off.

import { CURB_HEIGHT, CURB_WIDTH, KIND, ROAD_LIFT, curbOutline, hasBusLane, offsetPoint, roadBands } from './ground-plan.js';

const ROAD_Y = ROAD_LIFT + 0.0045; // over every lane band and the gutters, under the road paint
const WALK_Y = CURB_HEIGHT + 0.004;
const BUILDING_LINE = 4.35; // metres in from the curb line
const WHITE = [0.74, 0.73, 0.68];
const OIL = [0.011, 0.01, 0.009];
const RUBBER = [0.012, 0.012, 0.013];
const TAR = [0.016, 0.016, 0.018];
const PAD_RED = [0.4, 0.105, 0.07];
const PAD_YELLOW = [0.72, 0.56, 0.09];
const SPRAY = [[0.85, 0.3, 0.04], [0.72, 0.07, 0.05], [0.82, 0.68, 0.08], [0.08, 0.22, 0.66], [0.8, 0.8, 0.76], [0.08, 0.46, 0.18]];
const COVERS = [['manhole_sewer', 0.34], ['manhole_power', 0.3], ['manhole_steam', 0.14], ['manhole_worn', 0.22]];

function random(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function weighted(list, r) {
  for (const [name, w] of list) {
    if (r < w) return name;
    r -= w;
  }
  return list[list.length - 1][0];
}

/**
 * The roadways' covers, grates, stains and symbols.
 * @param {{ edges: object[], paintEdges?: object[], nodes: object[] }} network
 * @param {(decal: object) => void} emit
 */
function dressRoads(network, emit) {
  const roads = new Map();
  for (const e of network.paintEdges || network.edges) {
    const key = Math.min(e.from.id, e.to.id) * 65536 + Math.max(e.from.id, e.to.id);
    if (roads.has(key)) roads.get(key).push(e);
    else roads.set(key, [e]);
  }
  let serial = 0;
  for (const [e, back] of roads.values()) {
    serial++;
    const rnd = random(serial * 7919 + 13);
    const at = (s, o) => [e.sx + e.dx * s + e.rx * o, e.sz + e.dz * s + e.rz * o];
    const put = (sheet, tile, s, o, dir, extra = {}) => {
      const [x, z] = at(s, o);
      emit({ sheet, tile, x, z, y: ROAD_Y, lx: e.dx * dir, lz: e.dz * dir, scale: 1, tint: [1, 1, 1, 1], gloss: 0.6, wear: 0, ...extra });
    };
    const spin = () => { const a = rnd() * Math.PI * 2; return { lx: Math.sin(a), lz: Math.cos(a) }; };
    const bus = hasBusLane(e);
    const bands = roadBands(e, back, { bus });
    const lanes = bands.filter((b) => b.kind === KIND.lane || b.kind === KIND.bus);
    const parking = bands.filter((b) => b.kind === KIND.parking && b.hi - b.lo > 1.6);
    const len = e.len;
    const stops = (node) => !node.shape;
    const signal = (node) => !!(node.node || node).signal;
    if (len < 8 || !lanes.length) continue;

    // Manhole covers: one every 35 m or so, in a wheel path, on the lane's centre or on the seam between two lanes
    const covers = Math.floor(len / 36 + rnd());
    for (let i = 0; i < covers; i++) {
      const lane = lanes[Math.floor(rnd() * lanes.length)];
      const mid = (lane.lo + lane.hi) / 2;
      const o = mid + [-0.85, 0, 0.85, (lane.hi - lane.lo) / 2][Math.floor(rnd() * 4)];
      put('object', weighted(COVERS, rnd()), 5 + rnd() * (len - 10), o, 1, spin());
    }
    // A rectangular vault cover against a parking lane now and then
    if (parking.length && rnd() < 0.3) {
      const p = parking[Math.floor(rnd() * parking.length)];
      put('object', 'vault_plate', 6 + rnd() * (len - 12), (p.lo + p.hi) / 2 + (rnd() - 0.5) * 0.4, rnd() < 0.5 ? 1 : -1, { lx: e.rx, lz: e.rz });
    }

    // Storm grates at the downhill end of each gutter: against the curb just short of the crosswalk
    for (const [node, s] of [[e.from, 1.0], [e.to, len - 1.0]]) {
      if (!stops(node) || e.general) continue;
      for (const side of [-1, 1]) {
        if (rnd() < 0.3) continue;
        const [x, z] = at(s, side * (e.half - 0.33));
        emit({ sheet: 'object', tile: 'storm_grate', x, z, y: ROAD_Y, lx: e.rx * side, lz: e.rz * side, scale: 1, tint: [1, 1, 1, 1], gloss: 0.6, wear: 0 });
      }
    }

    // Parked engines drip: a stain where a hood stood (the shader's own slot rhythm, see createGroundRoadMaterial)
    const seed = ((serial * 0.754877666) % 1 + 1) % 1;
    for (const p of parking) {
      const mid = (p.lo + p.hi) / 2;
      const first = Math.ceil(3 / 6.1 - 0.72 + ((seed * 3) % 1));
      for (let k = first; ; k++) {
        const s = (k + 0.72 - ((seed * 3) % 1)) * 6.1;
        if (s > len - 3) break;
        if (rnd() > 0.24) continue;
        put('mark', ['oil_a', 'oil_b', 'oil_c'][Math.floor(rnd() * 3)], s, mid + (rnd() - 0.5) * 0.5, 1,
          { ...spin(), scale: 0.7 + rnd() * 0.6, tint: [...OIL, 0.5 + rnd() * 0.4], gloss: 0.32 });
      }
    }

    for (const lane of lanes) {
      const mid = (lane.lo + lane.hi) / 2;
      const end = lane.dir > 0 ? e.to : e.from;
      const stopS = lane.dir > 0 ? len : 0; // where this lane's traffic stops
      const upstream = (d) => stopS - lane.dir * d;
      if (stops(end)) {
        // Hard braking for a light: twin marks ending at the stop line; an engine that leaked while it waited
        if (signal(end) && len > 24 && rnd() < 0.2) {
          put('mark', 'skid', upstream(5.5 + rnd() * 3), mid + (rnd() - 0.5) * 0.5, lane.dir, { tint: [...RUBBER, 0.3 + rnd() * 0.3], gloss: 0.8, scale: 0.8 + rnd() * 0.3 });
        }
        if (len > 16 && rnd() < 0.3) {
          put('mark', 'oil_trail', upstream(3 + rnd() * 6), mid + (rnd() - 0.5) * 0.4, lane.dir, { tint: [...OIL, 0.45 + rnd() * 0.35], gloss: 0.32 });
        }
      }
    }

    // Lane-use arrows before the signals of the avenues: turn lanes at the sides, straight on in between
    const forward = lanes.filter((l) => l.dir > 0).sort((p, q) => p.lo - q.lo);
    if (e.axis === 'ave' && !e.general && forward.length >= 3 && len > 45 && stops(e.to) && signal(e.to) && rnd() < 0.7) {
      const wear = 0.2 + rnd() * 0.45;
      forward.forEach((lane, i) => {
        if (lane.kind === KIND.bus) return;
        const tile = i === 0 ? 'arrow_straight_left' : i === forward.length - 1 ? 'arrow_straight_right' : 'arrow_straight';
        put('mark', tile, len - 13, (lane.lo + lane.hi) / 2, 1, { tint: [...WHITE, 1], gloss: 0.55, wear });
      });
    }
    // BUS ONLY, read in that order by the driver, twice a block
    if (bus) {
      const lane = lanes.find((l) => l.kind === KIND.bus);
      const mid = (lane.lo + lane.hi) / 2;
      for (const s of len > 90 ? [10, len * 0.5] : [10]) {
        if (s + 10 > len - 6) continue;
        const wear = 0.2 + rnd() * 0.4;
        put('mark', 'text_bus', s, mid, 1, { tint: [...WHITE, 1], gloss: 0.55, wear });
        put('mark', 'text_only', s + 4.2, mid, 1, { tint: [...WHITE, 1], gloss: 0.55, wear });
      }
    }

    // Utility crews mark what runs under the street before they dig, each trade its colour
    if (rnd() < 0.55) {
      const colour = SPRAY[Math.floor(rnd() * SPRAY.length)];
      const marks = 1 + Math.floor(rnd() * 3);
      const s0 = 6 + rnd() * Math.max(1, len - 14);
      for (let i = 0; i < marks; i++) {
        put('mark', `spray_${'abcd'[Math.floor(rnd() * 4)]}`, Math.min(len - 3, s0 + i * (1.2 + rnd() * 2)), (rnd() - 0.5) * e.half * 1.5, 1,
          { ...spin(), tint: [...colour, 0.75], gloss: 0.6, wear: 0.15 + rnd() * 0.4, scale: 0.8 + rnd() * 0.5 });
      }
    }
    // Long cracks the city sealed with tar
    const cracks = Math.floor(len / 55 + rnd() * 1.4);
    for (let i = 0; i < cracks; i++) {
      const lane = lanes[Math.floor(rnd() * lanes.length)];
      const along = rnd() < 0.75;
      put('mark', rnd() < 0.5 ? 'crack_a' : 'crack_b', 5 + rnd() * (len - 10), (lane.lo + lane.hi) / 2 + (rnd() - 0.5) * 1.6, 1,
        { ...(along ? {} : { lx: e.rx, lz: e.rz }), tint: [...TAR, 0.9], gloss: 0.3, scale: 0.8 + rnd() * 0.6 });
    }
  }

  // Intersections: where the mains cross, so do their covers
  for (const n of network.nodes) {
    if (!(n.hx > 3 && n.hz > 3) || n.general) continue;
    const rnd = random(n.id * 104729 + 7);
    const count = 1 + Math.floor(rnd() * 2.6);
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      emit({ sheet: 'object', tile: weighted(COVERS, rnd()), x: n.x + (rnd() - 0.5) * n.hx * 1.5, z: n.z + (rnd() - 0.5) * n.hz * 1.5, y: ROAD_Y, lx: Math.sin(a), lz: Math.cos(a), scale: 1, tint: [1, 1, 1, 1], gloss: 0.6, wear: 0 });
    }
  }
}

// The point `t` metres along an outline side, with its inward normal and the direction the side runs
function sidePoint(side, t) {
  let i = 1;
  while (i < side.length - 1 && side[i].t < t) i++;
  const a = side[i - 1], b = side[i];
  const f = Math.max(0, Math.min(1, (t - a.t) / Math.max(1e-6, b.t - a.t)));
  const nx = a.nx + (b.nx - a.nx) * f, nz = a.nz + (b.nz - a.nz) * f;
  const nl = Math.hypot(nx, nz) || 1;
  const tx = b.x - a.x, tz = b.z - a.z;
  const tl = Math.hypot(tx, tz) || 1;
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, nx: nx / nl, nz: nz / nl, tx: tx / tl, tz: tz / tl, arc: a.r > 0 && a.r !== Infinity && b.r > 0 && b.r !== Infinity };
}

/**
 * One curb island's sidewalk: pads at its corners, small covers along the curb, a vault plate, a stain. (The subway
 * gratings and the shops' cellar doors are sited by sidewalk-furniture.js from the registers; js/ground.js draws them.)
 */
function dressIsland(block, emit) {
  if (block.median) return;
  const outline = block.curb || (block.curb = curbOutline(block.poly));
  const rnd = random(block.id * 31337 + 5);
  const yellow = rnd() < 0.2;
  const deep = Math.min(block.maxX - block.minX, block.maxZ - block.minZ) > BUILDING_LINE * 2 + 6;
  const put = (sheet, tile, side, t, depth, facing, extra = {}) => {
    const p = sidePoint(side, t);
    // facing 'out': the tile's top toward the roadway; 'along': its top along the side
    const lx = facing === 'out' ? -p.nx : p.tx, lz = facing === 'out' ? -p.nz : p.tz;
    emit({ sheet, tile, x: p.x + p.nx * depth, z: p.z + p.nz * depth, y: WALK_Y, lx, lz, scale: 1, tint: [1, 1, 1, 1], gloss: 0.6, wear: 0, ...extra });
  };

  for (const side of outline.sides) {
    const length = side[side.length - 1].t;
    if (length < 6) continue;
    // Detectable-warning pads on the rounded corners, one facing each crossing
    for (const [t, corner] of [[0.95, side[0]], [length - 0.95, side[side.length - 1]]]) {
      if (!(corner.r >= 1.5) || corner.r === Infinity) continue;
      put('object', 'tactile_pad', side, t, CURB_WIDTH + 0.34, 'along', { tint: [...(yellow ? PAD_YELLOW : PAD_RED), 1] });
    }
    // The signal pull box by the corner
    if (length > 14 && rnd() < 0.6) put('object', 'pull_box', side, 3.4 + rnd(), 0.75 + rnd() * 0.3, 'along');

    // Along the side: the curb's small covers, the building line's cellar doors, a vault, a stain
    for (let t = 6 + rnd() * 6; t < length - 6; t += 8 + rnd() * 9) {
      const r = rnd();
      if (r < 0.22) put('object', rnd() < 0.5 ? 'cap_water' : 'cap_gas', side, t, 0.42 + rnd() * 0.5, 'along');
      else if (r < 0.34) put('object', 'handhole', side, t, 0.55 + rnd() * 0.3, 'along');
      else if (r < 0.42 && deep) put('object', 'vault_plate', side, t, 1.6 + rnd() * 1.2, 'along');
      else if (r < 0.5) {
        // the utility crews' marks run over the curb onto the flags
        const a = rnd() * Math.PI * 2;
        put('mark', `spray_${'abcd'[Math.floor(rnd() * 4)]}`, side, t, 0.6 + rnd() * 2.2, 'along',
          { lx: Math.sin(a), lz: Math.cos(a), tint: [...SPRAY[Math.floor(rnd() * SPRAY.length)], 0.7], gloss: 0.6, wear: 0.2 + rnd() * 0.4, scale: 0.7 + rnd() * 0.4 });
      } else if (r < 0.78) {
        const a = rnd() * Math.PI * 2;
        put('mark', ['oil_a', 'oil_b', 'oil_c', 'puddle_ring'][Math.floor(rnd() * 4)], side, t, 0.5 + rnd() * 1.6, 'along',
          { lx: Math.sin(a), lz: Math.cos(a), tint: [0.05, 0.043, 0.036, 0.28 + rnd() * 0.3], gloss: 0.7, scale: 0.6 + rnd() * 0.9 });
      }
    }
  }

}

export { dressRoads, dressIsland, sidePoint };
