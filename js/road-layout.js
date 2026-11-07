// How a curb-to-curb roadway is shared between moving traffic and the cars parked along its curbs, as New York does
// it: a 2.3 m parking lane along every curb that has room, the rest split into travel lanes 3.1 to 3.7 m wide. A
// 9.1 m one-way side street keeps one lane between two rows of parked cars; a 21.3 m avenue five lanes between its two.
// Offsets are lateral, to the right of the direction of travel, in metres from the roadway's centreline
// (road-network.js convention). Pure: no three.js, tested in tests/parking.test.cjs.

const PARK_WIDTH = 2.3; // a parking lane
const PARK_OFF = 1.25; // the centre of a parked car from the curb face
const LANE_MIN = 3.1;
const LANE_MAX = 3.7;
const ONE_WAY_MIN_HALF = 4.4; // narrower one-way roadways are not corridors the grid drives (as before parking existed)
const BIKE_MIN_HALF = 9; // one-way roadways from 18 m across get a protected bike lane along their left curb
const BIKE_LANE = 1.8;
const BIKE_BUFFER = 0.8;

function spread(n, width, centre) {
  const spacing = Math.min(LANE_MAX, width / n);
  return Array.from({ length: n }, (_, i) => centre + (i - (n - 1) / 2) * spacing);
}

/**
 * A one-way roadway `half` metres each side of its centreline: its lanes, and the curbs it parks along (both when the
 * roadway allows, the right one alone when only one fits, none when it is too narrow). null when it cannot carry
 * traffic at all.
 * @returns {{ lanes: number[], park: { r: number|null, l: number|null } } | null}
 */
function layoutOneWay(half) {
  if (!(half >= ONE_WAY_MIN_HALF)) return null;
  const w = half * 2;
  // The wide one-way avenues carry a parking-protected bike lane along their left curb (1st, 2nd, 8th, 9th Aves...):
  // curb, bike lane, buffer, then the parked cars shield it from the traffic
  const bike = half >= BIKE_MIN_HALF;
  const bikeWidth = bike ? BIKE_LANE + BIKE_BUFFER : 0;
  const sides = w - bikeWidth - 2 * PARK_WIDTH >= LANE_MIN ? 2 : w - PARK_WIDTH >= LANE_MIN ? 1 : 0;
  const travel = w - sides * PARK_WIDTH - (sides === 2 ? bikeWidth : 0);
  const n = Math.max(1, Math.min(6, Math.floor(travel / LANE_MIN)));
  // the travel lanes keep away from whatever the left curb carries: parked cars and a bike lane shift them right,
  // parking along the right curb alone shifts them left
  const centre = sides === 1 ? -PARK_WIDTH / 2 : bikeWidth / 2;
  const lanes = spread(n, travel, centre);
  return {
    lanes,
    park: { r: sides >= 1 ? half - PARK_OFF : null, l: sides === 2 ? -(half - bikeWidth - PARK_OFF) : null },
    bike: sides === 2 && bike ? -(half - BIKE_LANE / 2) : null
  };
}

/**
 * One direction of a two-way roadway: its lanes between the centreline and its curb, parked cars along that curb
 * when a lane still fits beside them.
 * @returns {{ lanes: number[], park: { r: number|null, l: null } }}
 */
function layoutSide(half) {
  const park = half - PARK_WIDTH >= LANE_MIN;
  const travel = park ? half - PARK_WIDTH : half;
  const n = Math.max(1, Math.min(4, Math.floor(travel / LANE_MIN)));
  return { lanes: spread(n, travel, travel / 2), park: { r: park ? half - PARK_OFF : null, l: null }, bike: null };
}

const NO_LANES = Object.freeze({ lanes: [], park: { r: null, l: null }, bike: null });

export { PARK_WIDTH, PARK_OFF, LANE_MIN, LANE_MAX, BIKE_LANE, NO_LANES, layoutOneWay, layoutSide };
