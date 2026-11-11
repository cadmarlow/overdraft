// Independent of graphics quality: these limits change the simulated population, not only its visibility.
const TRAFFIC_LEVELS = Object.freeze({
  none: { name: 'Aucun', scale: 0 },
  low: { name: 'Faible', scale: 0.25 },
  medium: { name: 'Moyen', scale: 0.5 },
  high: { name: 'Dense', scale: 1 }
});
const STORAGE_KEY = 'overdraft:traffic';

function readTrafficDensity() {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    if (Object.hasOwn(TRAFFIC_LEVELS, id)) return id;
  } catch { /* Optional preferences, including private browsing. */ }
  return 'high';
}

function saveTrafficDensity(id) {
  if (!Object.hasOwn(TRAFFIC_LEVELS, id)) return;
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* Keep the live setting even without storage. */ }
}

// Nested, evenly spread subsets: lowering the density preserves the pose of every surviving car.
function trafficSubset(pool, scale) {
  return scale > 0 ? pool.filter((_, i) => i % Math.round(1 / scale) === 0) : [];
}

function clearHighwaySpawn(lane, u, focus) {
  if (!focus) return true;
  let i = 0;
  while (i < lane.cum.length - 2 && lane.cum[i + 1] < u) i++;
  const t = (u - lane.cum[i]) / (lane.cum[i + 1] - lane.cum[i]);
  const a = lane.pts[i], b = lane.pts[i + 1];
  return Math.hypot(a.x + (b.x - a.x) * t - focus.x, a.z + (b.z - a.z) * t - focus.z) >= 30;
}

function resizeHighwayTraffic(lane, scale, focus = null) {
  const selected = trafficSubset(lane.carPool, scale);
  const previous = new Set(lane.cars);
  const remaining = new Set(selected);
  for (const car of lane.cars) if (!remaining.has(car)) car.placed = false;
  const list = selected.filter(car => previous.has(car)).sort((a, b) => a.u - b.u);
  for (const car of selected) {
    if (previous.has(car)) continue;
    // Insert into the largest free gap, including across the lane seam. Dormant positions may now be occupied.
    if (list.length) {
      let largest = -Infinity, position = 0;
      for (let i = 0; i < list.length; i++) {
        const a = list[i], b = list[(i + 1) % list.length];
        const distance = b.u - a.u + (i === list.length - 1 ? lane.len : 0);
        const room = distance - (a.len + b.len) / 2;
        for (const fraction of [0.5, 0.25, 0.75]) {
          const candidate = (a.u + a.len / 2 + room * fraction) % lane.len;
          if (room * Math.min(fraction, 1 - fraction) >= car.len / 2 + 8
            && room > largest && clearHighwaySpawn(lane, candidate, focus)) {
            largest = room; position = candidate;
          }
        }
      }
      if (!Number.isFinite(largest)) continue;
      car.u = position;
    } else {
      let position = car.u;
      for (let i = 0; i < 8 && !clearHighwaySpawn(lane, position, focus); i++) position = (car.u + lane.len * (i + 1) / 8) % lane.len;
      if (!clearHighwaySpawn(lane, position, focus)) continue;
      car.u = position;
    }
    car.seg = 0;
    while (car.seg < lane.cum.length - 2 && lane.cum[car.seg + 1] < car.u) car.seg++;
    car.v = lane.speedProfile[car.seg];
    car.acc = car.ox = car.oz = car.oyaw = car.kvx = car.kvz = car.spin = car.stunned = car.hidden = 0;
    car.placed = false;
    list.push(car);
    list.sort((a, b) => a.u - b.u);
  }
  // Consumers retain the same array; its cyclic order also defines each driver's leader.
  lane.cars.splice(0, lane.cars.length, ...list);
}

export { TRAFFIC_LEVELS, readTrafficDensity, saveTrafficDensity, trafficSubset, resizeHighwayTraffic };
