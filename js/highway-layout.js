import { HIGHWAY_ROUTES } from './highway-geodata.js';
import { createRoadCorridor, highwayRowScale } from './road-corridor.js';

const highwayCorridor = createRoadCorridor(HIGHWAY_ROUTES);
// The shallow viaduct ramp also replaces the old sidewalk below it; physics uses its sloped deck instead.
const highwayGroundCut = createRoadCorridor(HIGHWAY_ROUTES, 8.1, { eastEnd: 4310 });
function highwayX(west, z) {
  const route = HIGHWAY_ROUTES[west ? 0 : 1];
  const at = Math.max(0, Math.min(route.x.length - 1, (z - route.z0) / route.step));
  const i = Math.min(route.x.length - 2, Math.floor(at));
  return route.x[i] + (route.x[i + 1] - route.x[i]) * (at - i);
}

function highwayScale(west, z) {
  const route = HIGHWAY_ROUTES[west ? 0 : 1];
  const at = Math.max(0, Math.min(route.x.length - 1, (z - route.z0) / route.step));
  const i = Math.min(route.x.length - 2, Math.floor(at)), t = at - i;
  return highwayRowScale(route, i) * (1 - t) + highwayRowScale(route, i + 1) * t;
}

export { HIGHWAY_ROUTES, highwayCorridor, highwayGroundCut, highwayX, highwayScale };
