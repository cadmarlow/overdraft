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

export { highwaySpeedProfile };
