import { polygonBoxOverlaps } from '../../js/building-collision.js';

// Offline corridor search. A complete path is selected before anything is emitted: no local dodge can strand
// traffic in a cul-de-sac. Buildings are immutable; the road has to fit around their measured footprints.
function routeHighway(rows, buildings, shoreAt, { grid = 1, reach = 400, halfWidth = 9 } = {}) {
  const history = [], near = [];
  const SPEEDS = 9, MID = 4;
  let previous;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], shore = shoreAt(r.z), s = r.west ? shore.westX : shore.eastX;
    const reserve = r.reserve ?? halfWidth, shoreMargin = 7.9 * reserve / halfWidth;
    const xmin = Math.ceil((r.west ? s + shoreMargin : s - reach) / grid) * grid;
    const xmax = Math.floor((r.west ? s + reach : s - shoreMargin) / grid) * grid;
    const count = Math.max(0, Math.floor((xmax - xmin) / grid) + 1);
    const cost = new Float64Array(count * SPEEDS).fill(Infinity), from = new Int16Array(count * SPEEDS).fill(-1);
    const obstacles = buildings.filter(b => b.minZ < r.z + 4 && b.maxZ > r.z - 4 && b.maxX > xmin - reserve && b.minX < xmax + reserve);
    near.push(obstacles);
    const clear = x => !obstacles.some(b => b.minX < x + reserve && b.maxX > x - reserve &&
      b.polygons.some(p => polygonBoxOverlaps(p, x, r.z, reserve, 4)));
    for (let j = 0; j < count; j++) {
      const x = xmin + j * grid;
      if (x < shore.westX + shoreMargin || x > shore.eastX - shoreMargin || !clear(x)) continue;
      const preference = (x - r.preferred) ** 2 / 900;
      for (let velocity = 0; velocity < SPEEDS; velocity++) {
        const dx = (velocity - MID) * grid, id = j * SPEEDS + velocity;
        if (!previous) { cost[id] = preference + dx * dx; continue; }
        const k = Math.round((x - dx - previous.xmin) / grid);
        if (k < 0 || k * SPEEDS >= previous.cost.length) continue;
        for (let before = 0; before < SPEEDS; before++) {
          const previousID = k * SPEEDS + before;
          const acceleration = (velocity - before) * grid;
          const candidate = previous.cost[previousID] + preference + dx * dx * 2 + acceleration * acceleration * 80;
          if (candidate < cost[id]) { cost[id] = candidate; from[id] = previousID; }
        }
      }
    }
    if (!cost.some(Number.isFinite)) throw new Error(`No continuous highway corridor at ${r.west ? 'west' : 'east'} z=${r.z}`);
    previous = { xmin, cost, from };
    history.push(previous);
  }
  let j = previous.cost.indexOf(Math.min(...previous.cost));
  const path = rows.map(r => ({ x: 0, z: r.z }));
  for (let i = rows.length - 1; i >= 0; i--) {
    path[i].x = history[i].xmin + Math.floor(j / SPEEDS) * grid;
    j = history[i].from[j];
  }
  // Remove the search lattice's stair steps without rounding a corner through a facade. The extra 1.4 m outside
  // the 15.2 m road section also reserves its shoulders, barrier and the swept body of a van in a bend.
  for (let pass = 0; pass < 180; pass++) {
    for (let i = 1; i < path.length - 1; i++) {
      const reserve = rows[i].reserve ?? halfWidth, shoreMargin = 7.9 * reserve / halfWidth;
      const p = path[i], x = (path[i - 1].x + 2 * p.x + path[i + 1].x) / 4;
      const shore = shoreAt(p.z);
      if (x < shore.westX + shoreMargin || x > shore.eastX - shoreMargin) continue;
      if (near[i].some(b => b.minX < x + reserve && b.maxX > x - reserve &&
        b.polygons.some(poly => polygonBoxOverlaps(poly, x, p.z, reserve, 4)))) continue;
      p.x = x;
    }
  }
  // Minimise bending energy as well as length. A shortest-path string alone hugs an obstacle corner with a kink;
  // this fourth-order fairing moves the approaches outward so a long vehicle can turn without clipping a barrier.
  for (let pass = 0; pass < 6400; pass++) {
    for (let i = 2; i < path.length - 2; i++) {
      const p = path[i], reserve = rows[i].reserve ?? halfWidth, shoreMargin = 7.9 * reserve / halfWidth;
      const gradient = 6 * p.x - 4 * (path[i - 1].x + path[i + 1].x) + path[i - 2].x + path[i + 2].x;
      if (Math.abs(gradient) < 1e-6) continue;
      const x = p.x - 0.06 * gradient, shore = shoreAt(p.z);
      if (x < shore.westX + shoreMargin || x > shore.eastX - shoreMargin) continue;
      if (near[i].some(b => b.minX < x + reserve && b.maxX > x - reserve &&
        b.polygons.some(poly => polygonBoxOverlaps(poly, x, p.z, reserve, 4)))) continue;
      p.x = x;
    }
  }
  return path;
}

export { routeHighway };
