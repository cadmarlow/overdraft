// Ground dispatch uses the same road graph as the driving AI. All positions come from reports or sightings.

// Project a report onto a nearby road segment, including reports midway down a long avenue.
export function roadApproach(nav, x, z) {
  const { x: px, z: pz } = roadSegment(nav, x, z);
  return { x: px, z: pz };
}

function roadSegment(nav, x, z) {
  const candidates = nav.within(x, z, 220);
  const nearest = nav.nearest(x, z, 260);
  if (nearest < 0) return { x, z, ends: [] };
  const point = nav.nodes[nearest];
  let best = { x: point.x, z: point.z, ends: [nearest] }, distance = Math.hypot(best.x - x, best.z - z);
  for (const id of candidates) {
    const a = nav.nodes[id];
    for (const { to, cost } of nav.links[id]) {
      const b = nav.nodes[to], dx = b.x - a.x, dz = b.z - a.z;
      if (cost < 1) continue;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (cost * cost)));
      const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(px - x, pz - z);
      if (d < distance - 0.001) { best = { x: px, z: pz, ends: [id, to] }; distance = d; }
    }
  }
  return best;
}

export function policeRoute(nav, ax, az, bx, bz) {
  const start = roadSegment(nav, ax, az), end = roadSegment(nav, bx, bz);
  const goal = { x: bx, z: bz };
  if (start.ends.length === 2 && end.ends.length === 2 && start.ends.every((id) => end.ends.includes(id))) {
    return [{ x: end.x, z: end.z }, goal];
  }
  let result = null, best = Infinity;
  for (const a of start.ends) for (const b of end.ends) {
    const from = nav.nodes[a], to = nav.nodes[b];
    const route = nav.route(from.x, from.z, to.x, to.z, 500);
    if (!route) continue;
    const cost = Math.hypot(from.x - ax, from.z - az) + pathDistance(route, from) + Math.hypot(end.x - to.x, end.z - to.z);
    if (cost < best) { best = cost; result = [...route.slice(0, -1), end, goal]; }
  }
  return result;
}

// Follow the road in the last observed direction. A turn is plausible at an intersection, but the
// prediction never jumps a block or reads the player's position once contact is lost.
export function roadAhead(nav, x, z, dx, dz, distance) {
  const candidates = nav.within(x, z, 190);
  let from = -1, next = -1, best = Infinity;
  for (const id of candidates) {
    const a = nav.nodes[id];
    for (const { to, cost } of nav.links[id]) {
      if (cost < 4) continue;
      const b = nav.nodes[to], ex = (b.x - a.x) / cost, ez = (b.z - a.z) / cost;
      const alignment = dx * ex + dz * ez;
      if (alignment < 0.68) continue;
      const along = (x - a.x) * ex + (z - a.z) * ez;
      if (along < -20 || along > cost - 2) continue;
      const offset = Math.hypot(a.x + ex * along - x, a.z + ez * along - z);
      const score = offset * 2 + (1 - alignment) * 45 + Math.max(0, -along);
      if (score < best) { best = score; from = id; next = to; }
    }
  }
  if (next < 0 || best > 55) return [];
  let previous = from, current = next;
  let travelled = Math.hypot(nav.nodes[current].x - x, nav.nodes[current].z - z);
  const route = [];
  while (travelled <= distance && route.length < 8) {
    const a = nav.nodes[previous], b = nav.nodes[current];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    route.push({ x: b.x, z: b.z, dx: (b.x - a.x) / length, dz: (b.z - a.z) / length, node: current, distance: travelled });
    let forward = -1, alignment = 0.75, lengthAhead = 0;
    for (const { to, cost } of nav.links[current]) {
      if (to === previous || cost < 4) continue;
      const p = nav.nodes[to];
      const dot = ((p.x - b.x) * dx + (p.z - b.z) * dz) / cost;
      if (dot > alignment) { forward = to; alignment = dot; lengthAhead = cost; }
    }
    if (forward < 0) break;
    previous = current; current = forward; travelled += lengthAhead;
  }
  return route;
}

export function routeDistance(nav, from, to) {
  const path = policeRoute(nav, from.x, from.z, to.x, to.z);
  if (!path) return Infinity;
  return pathDistance(path, from);
}

function pathDistance(path, from) {
  let previous = from, distance = 0;
  for (const point of path) {
    distance += Math.hypot(point.x - previous.x, point.z - previous.z);
    previous = point;
  }
  return distance;
}
