// Where the parked cars of Manhattan stand: one slot after another along every curb the road network parks along
// (road-layout.js), each with a body kind, a seed and the character of its street, and how full a curb should be at
// a given hour. Pure: parking.js draws and collides them, tests/parking.test.cjs checks the rules.

// Bumper to bumper, a parked car takes its own length plus the gap New Yorkers leave
const KIND_LENGTH = { compact: 4.0, hatch: 4.4, sedan: 5.0, suv: 5.15, minivan: 5.25, pickup: 5.75, van: 5.55 };
const GAP = 0.85;
const END_CLEAR = 1.6; // from the stop line: the crosswalk and the corner's clear zone lie beyond it
const HYDRANT_CLEAR = 4.5; // no parking within 15 ft of a hydrant
const ZONE = { residential: 0, business: 1, mixed: 2 };

// Residential streets fill with family cars; business districts see more vans and pickups by day
const MIX = {
  [ZONE.residential]: [['sedan', 30], ['suv', 27], ['hatch', 12], ['compact', 10], ['minivan', 10], ['van', 6], ['pickup', 5]],
  [ZONE.business]: [['sedan', 30], ['suv', 26], ['van', 16], ['pickup', 8], ['hatch', 8], ['compact', 6], ['minivan', 6]],
  [ZONE.mixed]: [['sedan', 30], ['suv', 27], ['hatch', 10], ['compact', 8], ['minivan', 8], ['van', 10], ['pickup', 7]]
};
const KINDS = Object.keys(KIND_LENGTH);
const KIND_INDEX = Object.fromEntries(KINDS.map((k, i) => [k, i]));

const RESIDENTIAL = new Set(['uws', 'ues', 'harlem', 'east_harlem', 'morningside', 'chelsea', 'west_village', 'village',
  'east_village', 'lower_east_side', 'gramercy', 'murray_hill', 'stuy_town', 'hells_kitchen', 'turtle_bay', 'yorkville',
  'washington_heights', 'inwood', 'two_bridges', 'chinatown', 'little_italy', 'alphabet_city', 'kips_bay', 'lenox_hill',
  'carnegie_hill', 'manhattan_valley', 'hamilton_heights', 'sugar_hill', 'battery_park_city', 'tudor_city']);
const BUSINESS = new Set(['midtown', 'garment', 'flatiron', 'nomad', 'billionaires_row', 'hudson_yards', 'fidi',
  'financial_district', 'tribeca', 'soho', 'hudson_square', 'civic_center', 'times_square', 'theater_district',
  'koreatown', 'plaza_district', 'west_chelsea', 'meatpacking']);

function zoneOf(district) {
  if (!district) return ZONE.mixed;
  if (RESIDENTIAL.has(district)) return ZONE.residential;
  if (BUSINESS.has(district)) return ZONE.business;
  return ZONE.mixed;
}

function hash(a, b) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function pickKind(zone, u) {
  const mix = MIX[zone] || MIX[ZONE.mixed];
  let total = 0;
  for (const [, w] of mix) total += w;
  let acc = 0;
  for (const [kind, w] of mix) {
    acc += w;
    if (u * total < acc) return kind;
  }
  return mix[0][0];
}

/**
 * Every parking slot along the network's curbs.
 * @param {object[]} edges - road-network edges (sx, sz, dx, dz, rx, rz, len, axis, park: { r, l })
 * @param {object} options
 * @param {{x:number,z:number}[]} [options.hydrants] - no slot within 4.5 m along the curb of one
 * @param {(x:number,z:number,yaw:number,halfW:number,halfL:number)=>boolean} [options.blocked] - true where a car of
 *   that footprint cannot stand (on a curb island, over street furniture)
 * @param {(x:number,z:number)=>string|null} [options.districtAt]
 * @returns slots as parallel arrays, plus the kind table
 */
function planSlots(edges, { hydrants = [], blocked = null, districtAt = null } = {}) {
  const HCELL = 16;
  const hydrantCells = new Map();
  for (const h of hydrants) {
    const key = Math.floor(h.x / HCELL) + ',' + Math.floor(h.z / HCELL);
    if (!hydrantCells.has(key)) hydrantCells.set(key, []);
    hydrantCells.get(key).push(h);
  }
  const nearHydrant = (x, z, reach) => {
    const r2 = reach * reach;
    for (let ix = Math.floor((x - reach) / HCELL); ix <= Math.floor((x + reach) / HCELL); ix++) {
      for (let iz = Math.floor((z - reach) / HCELL); iz <= Math.floor((z + reach) / HCELL); iz++) {
        for (const h of hydrantCells.get(ix + ',' + iz) || []) if ((h.x - x) ** 2 + (h.z - z) ** 2 < r2) return true;
      }
    }
    return false;
  };

  const xs = [], zs = [], yaws = [], kinds = [], seeds = [], edgeIds = [], sides = [];
  const edgeZone = new Uint8Array(edges.length);
  const edgeAxis = new Uint8Array(edges.length); // 1 = avenue
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    edgeAxis[ei] = e.axis === 'ave' ? 1 : 0;
    const park = e.park;
    if (!park || (park.r === null && park.l === null)) continue;
    const mid = { x: e.sx + e.dx * e.len * 0.5, z: e.sz + e.dz * e.len * 0.5 };
    const zone = zoneOf(districtAt ? districtAt(mid.x, mid.z) : null);
    edgeZone[ei] = zone;
    const yaw = Math.atan2(e.dx, e.dz);
    for (const side of [1, -1]) {
      const offset = side > 0 ? park.r : park.l;
      if (offset === null || offset === undefined) continue;
      let s = END_CLEAR;
      let n = 0;
      while (true) {
        const u = hash(ei * 2 + (side > 0 ? 0 : 1), n * 7 + 1);
        const kind = pickKind(zone, u);
        const length = KIND_LENGTH[kind];
        if (s + length > e.len - END_CLEAR) break;
        const c = s + length * 0.5;
        const x = e.sx + e.dx * c + e.rx * offset;
        const z = e.sz + e.dz * c + e.rz * offset;
        const ok = !nearHydrant(x, z, HYDRANT_CLEAR + length * 0.5 - 0.6)
          && !(blocked && blocked(x, z, yaw, 0.95, length * 0.5));
        if (ok) {
          xs.push(x); zs.push(z); yaws.push(yaw); kinds.push(KIND_INDEX[kind]);
          seeds.push(hash(ei * 2 + (side > 0 ? 0 : 1), n * 7 + 2));
          edgeIds.push(ei); sides.push(side);
        }
        s += length + GAP;
        n++;
      }
    }
  }
  return {
    count: xs.length,
    x: Float32Array.from(xs), z: Float32Array.from(zs), yaw: Float32Array.from(yaws),
    kind: Uint8Array.from(kinds), seed: Float32Array.from(seeds), edge: Uint32Array.from(edgeIds), side: Int8Array.from(sides),
    edgeZone, edgeAxis, kinds: KINDS
  };
}

// Alternate side parking: on a residential street, one curb is cleared for the sweeper from 9:30 to 11 on alternate
// days, and fills back up over the hour after. Which curb depends on the street and the day.
const SWEEP_START = 9.5, SWEEP_END = 11, REFILL = 1.25;
function sweepFactor(hour, day, edgeId, side, zone, avenue) {
  if (zone !== ZONE.residential || avenue) return 1;
  const sweptSide = ((edgeId + day) & 1) ? 1 : -1;
  if (side !== sweptSide) return 1;
  if (hour >= SWEEP_START - 0.4 && hour < SWEEP_START) return 1 - (hour - (SWEEP_START - 0.4)) / 0.4 * 0.88;
  if (hour >= SWEEP_START && hour < SWEEP_END) return 0.12;
  if (hour >= SWEEP_END && hour < SWEEP_END + REFILL) return 0.12 + 0.88 * (hour - SWEEP_END) / REFILL;
  return 1;
}

/**
 * How full a curb should be (0..1) at `hour` on `day`: residential blocks stay packed, business districts empty out
 * at night, avenues keep more room than side streets, and the sweeper clears one side of residential streets.
 */
function occupancyTarget(zone, avenue, hour, day = 0, edgeId = 0, side = 1) {
  const night = hour < 6.5 ? 1 : hour < 8.5 ? 1 - (hour - 6.5) / 2 : hour < 19 ? 0 : hour < 22 ? (hour - 19) / 3 : 1;
  let base;
  if (zone === ZONE.residential) base = avenue ? 0.78 : 0.93;
  else if (zone === ZONE.business) base = avenue ? 0.62 - 0.2 * night : 0.82 - 0.3 * night;
  else base = avenue ? 0.7 - 0.08 * night : 0.86 - 0.1 * night;
  return Math.min(1, Math.max(0, base * sweepFactor(hour, day, edgeId, side, zone, avenue)));
}

/** Whether slot i stands occupied at this hour: a stable choice per slot (its seed) against the curb's target */
function occupied(plan, i, hour, day = 0) {
  const e = plan.edge[i];
  return plan.seed[i] < occupancyTarget(plan.edgeZone[e], plan.edgeAxis[e] === 1, hour, day, e, plan.side[i]);
}

export { KIND_LENGTH, KINDS, ZONE, GAP, END_CLEAR, HYDRANT_CLEAR, planSlots, occupancyTarget, occupied, zoneOf, hash as slotHash };
