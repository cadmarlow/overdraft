// Survey coordinates stay at 1:1. The inhabited city ends on this authored line.
export const CITY_NORTH = -6360;
export const CITY_SOUTH = 6055;
const west = [
  [-1750, CITY_NORTH], [-1750, -5760], [-1620, -5540], [-1610, -3410], [-1515, -2970],
  [-1515, -1950], [-1585, -1560], [-1585, -550], [-1515, 180], [-1515, 930],
  [-1370, 1490], [-1215, 2160], [-1150, 2590], [-910, 3060], [-750, 3780],
  [-548, 4350], [-465, 4970], [-350, 5360], [-285, 5750], [-155, CITY_SOUTH]
];
const east = [
  [575, CITY_NORTH], [575, -5750], [710, -5410], [785, -5080], [785, -3750],
  [945, -3280], [945, -2320], [1010, -1830], [1010, -900], [945, -670],
  [945, 940], [1095, 1440], [1265, 1750], [1265, 2280], [1140, 2580],
  [1140, 3940], [1290, 4250], [1290, 4600], [1000, 5000], [850, 5240],
  [725, 5540], [645, 5790], [548, CITY_SOUTH]
];

export const CITY_RING = [...west, ...east.slice().reverse()].map(([x, z]) => ({ x, z }));
const edges = CITY_RING.map((a, i) => {
  const b = CITY_RING[(i + 1) % CITY_RING.length];
  const dx = b.x - a.x, dz = b.z - a.z;
  return { a, dx, dz, length2: dx * dx + dz * dz };
});

function sideAt(side, z) {
  if (z <= CITY_NORTH) return side[0][0];
  if (z >= CITY_SOUTH) return side.at(-1)[0];
  let lo = 0, hi = side.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (side[mid][1] <= z) lo = mid;
    else hi = mid;
  }
  const [x0, z0] = side[lo], [x1, z1] = side[hi];
  return x0 + (x1 - x0) * (z - z0) / (z1 - z0);
}

export const cityBoundsAt = z => ({ westX: sideAt(west, z), eastX: sideAt(east, z) });
export const insideCity = (x, z) => z >= CITY_NORTH && z <= CITY_SOUTH && x >= sideAt(west, z) && x <= sideAt(east, z);

export function cityContainsBox(minX, maxX, minZ, maxZ, margin = 0) {
  const x0 = minX - margin, x1 = maxX + margin, z0 = minZ - margin, z1 = maxZ + margin;
  if (!insideCity(x0, z0) || !insideCity(x1, z0) || !insideCity(x0, z1) || !insideCity(x1, z1)) return false;
  return west.every(([x, z]) => z <= z0 || z >= z1 || x <= x0) &&
    east.every(([x, z]) => z <= z0 || z >= z1 || x >= x1);
}

// Used only at the edge of the terrain lattice, where the ground meets the street deck.
export function cityEdgeDistance(x, z) {
  let best = Infinity;
  for (const { a, dx, dz, length2 } of edges) {
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2));
    best = Math.min(best, (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2);
  }
  return Math.sqrt(best);
}

export function clipCityLine(points) {
  const runs = [];
  let run = null;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1], q = points[i], vx = q.x - p.x, vz = q.z - p.z;
    const cuts = [0, 1];
    for (const { a, dx, dz } of edges) {
      const det = vx * dz - vz * dx;
      if (Math.abs(det) < 1e-8) continue;
      const ax = a.x - p.x, az = a.z - p.z;
      const t = (ax * dz - az * dx) / det, u = (ax * vz - az * vx) / det;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((a, b) => a - b);
    for (let j = 1; j < cuts.length; j++) {
      const t = cuts[j - 1], u = cuts[j], mid = (t + u) / 2;
      if (u - t < 1e-8) continue;
      if (!insideCity(p.x + mid * vx, p.z + mid * vz)) {
        run = null;
        continue;
      }
      if (!run) {
        run = [{ x: p.x + t * vx, z: p.z + t * vz }];
        runs.push(run);
      }
      run.push({ x: p.x + u * vx, z: p.z + u * vz });
    }
  }
  return runs;
}
