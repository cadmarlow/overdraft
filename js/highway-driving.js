// Speed follows the curvature of the actual lane, with braking prepared ahead of the bend. The road remains open;
// a tight corner is a slower passage, never a fake stopped leader or a recycling point.
function highwaySpeedProfile(points, cumulative, cruise, lateralAcceleration = 2.5, braking = 2.8) {
  const limits = new Float32Array(points.length).fill(cruise);
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const before = Math.atan2(b.x - a.x, b.z - a.z), after = Math.atan2(c.x - b.x, c.z - b.z);
    const turn = Math.abs(Math.atan2(Math.sin(after - before), Math.cos(after - before)));
    const distance = (cumulative[i + 1] - cumulative[i - 1]) / 2;
    if (turn > 1e-5) limits[i] = Math.min(cruise, Math.max(4, Math.sqrt(lateralAcceleration * distance / turn)));
  }
  for (let i = limits.length - 2; i >= 0; i--) {
    limits[i] = Math.min(limits[i], Math.sqrt(limits[i + 1] ** 2 + 2 * braking * (cumulative[i + 1] - cumulative[i])));
  }
  return limits;
}

// A level crossing: where a road running east-west cuts across the carriageway (the Wasteland's western gate), every
// lane holds short of it while someone is on the crossing or coming up to it, as at a red light.
// The stop lines: for each lane that runs through the crossing at road level, the arc position where its cars wait.
// The carriageway may lie up to `reach` from the point given.
function crossingStops(lanes, { x, z, half = 14, reach = 90 }) {
  const stops = [];
  for (const lane of lanes) {
    const P = lane.pts;
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i], b = P[i + 1];
      if (a.z === b.z || (a.z - z) * (b.z - z) > 0) continue;
      const t = (z - a.z) / (b.z - a.z), ay = a.y ?? 0, by = b.y ?? 0;
      if (Math.abs(a.x + (b.x - a.x) * t - x) > reach || ay + (by - ay) * t < -1) continue; // elsewhere, or in a tunnel
      stops.push({ lane, u: lane.cum[i] + t * (lane.cum[i + 1] - lane.cum[i]) - half - 3 });
      break;
    }
  }
  return stops;
}

// Is the crossing taken? `west` and `east` are how far out on either side a body is seen coming.
function crossingHeld({ x, z, half = 14, west = 85, east = 170 }, body) {
  return !!body && Math.abs(body.z - z) < half + 6 && body.x > x - west && body.x < x + east && Math.abs(body.y) < 9;
}

// The gap a car at arc position `u` keeps to a held stop line: a standing leader at the line. A car already over the
// line clears the crossing, and one whose own leader is nearer keeps following it: both get `gap` back unchanged.
function gapToStopLine(stopAt, u, length, gap, standstill) {
  const toLine = stopAt - u - length / 2;
  return toLine > -1.5 && toLine < gap ? Math.max(0.1, toLine + standstill) : gap;
}

export { highwaySpeedProfile, crossingStops, crossingHeld, gapToStopLine };
