import { polygonContains, polygonBoxOverlaps } from './building-collision.js';

function boxCorners(x, z, w, d, cs, sn) {
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) =>
    ({ x: x + u * cs + v * sn, z: z - u * sn + v * cs }));
}

// Corners alone miss concave notches and holes enclosed by the rectangle.
function containsBox(polygon, x, z, w, d, cs, sn) {
  if (!boxCorners(x, z, w, d, cs, sn).every((p) => polygonContains(polygon, p.x, p.z))) return false;
  const hx = w / 2, hz = d / 2;
  for (const ring of [polygon.outer, ...polygon.holes]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const ax = (a.x - x) * cs - (a.z - z) * sn, az = (a.x - x) * sn + (a.z - z) * cs;
      const bx = (b.x - x) * cs - (b.z - z) * sn, bz = (b.x - x) * sn + (b.z - z) * cs;
      if (Math.abs(ax) < hx && Math.abs(az) < hz) return false;
      for (const u of [-hx, hx]) {
        const t = (u - ax) / (bx - ax);
        if (t >= 0 && t <= 1 && Math.abs(az + (bz - az) * t) < hz) return false;
      }
      for (const v of [-hz, hz]) {
        const t = (v - az) / (bz - az);
        if (t >= 0 && t <= 1 && Math.abs(ax + (bx - ax) * t) < hx) return false;
      }
    }
  }
  return true;
}

// cornice: 'stone', 'metal' (pressed tin on brackets, deeper) or 'none', in corniceColour (linear rgb);
// waterTower: the chance of one on the roof
// type: the building's kind (js/building-types.js); wallColour: its brick for the bulkheads and chimneys (linear rgb)
function addBuildingDetails(b, detail, { masonry, rand, neighbours, cornice = masonry ? 'stone' : 'none', corniceColour = [0.6, 0.55, 0.46],
  waterTower = 0.25, type = '', wallColour = [0.4, 0.22, 0.16] }) {
  const roofY = b.height + 0.22;
  const streetReserves = [];
  const edges = b.polygons.flatMap((polygon) => polygon.outer.map((a, i, ring) => {
    const c = ring[(i + 1) % ring.length], dx = c.x - a.x, dz = c.z - a.z;
    const length = Math.hypot(dx, dz);
    return { x: (a.x + c.x) / 2, z: (a.z + c.z) / 2, nx: dz / length, nz: -dx / length, length, polygon };
  })).filter((edge) => edge.length >= 4).sort((a, b) => b.length - a.length);
  if (!edges.length || b.height < 6) return streetReserves;

  function blocked(x, z, w, d, cs, sn, roof = false) {
    return neighbours.some((r) => (!roof || (r.polygons !== b.polygons && (r.height ?? Infinity) > roofY - 0.1))
      && r.polygons.some((p) => polygonBoxOverlaps(p, x, z, w / 2, d / 2, cs, sn)));
  }

  if (cornice !== 'none') {
    const [h, d] = cornice === 'metal' ? [0.8, 0.85] : [0.6, 0.7];
    for (const e of edges.slice(0, 16)) {
      const x = e.x - e.nx * 0.1, z = e.z - e.nz * 0.1;
      const cs = -e.nz, sn = -e.nx;
      if (blocked(x, z, e.length - 0.1, d, cs, sn, true)) continue;
      detail.cornices.push({ x, y: roofY, z, w: e.length - 0.1, h, d, ry: Math.atan2(sn, cs), kind: cornice, colour: corniceColour });
    }
  }

  const ringArea = (ring) => Math.abs(ring.reduce((n, a, i) => {
    const c = ring[(i + 1) % ring.length];
    return n + a.x * c.z - c.x * a.z;
  }, 0));
  const area = (p) => ringArea(p.outer) - p.holes.reduce((n, ring) => n + ringArea(ring), 0);
  const polygon = b.polygons.reduce((a, c) => area(a) > area(c) ? a : c);
  const edge = edges.find((e) => e.polygon === polygon);
  if (edge) {
    const cs = -edge.nz, sn = -edge.nx, ry = Math.atan2(sn, cs);
    const us = polygon.outer.map((p) => (p.x - b.cx) * cs - (p.z - b.cz) * sn);
    const vs = polygon.outer.map((p) => (p.x - b.cx) * sn + (p.z - b.cz) * cs);
    const minU = Math.min(...us), maxU = Math.max(...us), minV = Math.min(...vs), maxV = Math.max(...vs);
    const occupied = [];
    function roofSpot(w, d) {
      if (maxU - minU < w + 1 || maxV - minV < d + 1) return null;
      for (let i = 0; i < 8; i++) {
        const u = minU + w / 2 + 0.5 + rand() * (maxU - minU - w - 1);
        const v = minV + d / 2 + 0.5 + rand() * (maxV - minV - d - 1);
        const x = b.cx + u * cs + v * sn, z = b.cz - u * sn + v * cs;
        if (!containsBox(polygon, x, z, w + 0.6, d + 0.6, cs, sn) || blocked(x, z, w, d, cs, sn, true)
          || occupied.some((p) => polygonBoxOverlaps(p, x, z, w / 2 + 0.3, d / 2 + 0.3, cs, sn))) continue;
        occupied.push({ outer: boxCorners(x, z, w, d, cs, sn), holes: [] });
        return { x, y: roofY, z, ry };
      }
      return null;
    }
    if (masonry && b.height >= 14 && rand() < waterTower) {
      const spot = roofSpot(4, 4);
      if (spot) detail.waterTowers.push(spot);
    }
    if (rand() < 0.35) {
      const w = 2.4 + rand() * 2.6, d = 2.4 + rand() * 2.6, spot = roofSpot(w, d);
      if (spot) detail.hvacUnits.push({ ...spot, w, d, h: masonry ? 2.4 : 3.4 });
    }
    // The clutter of a New York roof: the brick bulkhead over the stairs (and the lift), chimney stacks along the
    // party walls of old buildings, soil and vent pipes, skylights over the stairwell, a satellite dish
    const old = type === 'rowhouse' || type === 'tenement' || type === 'loft' || type === 'prewar';
    for (const list of ['bulkheads', 'chimneys', 'skylights', 'vents', 'dishes']) detail[list] ??= [];
    if (masonry && b.height >= 12) {
      const w = 2.4 + rand() * 1.4, d = 3 + rand() * 1.8, spot = roofSpot(w, d);
      if (spot) detail.bulkheads.push({ ...spot, w, d, h: 2.5 + rand() * 0.8, colour: wallColour });
    }
    if (masonry && old) {
      for (let i = 0, n = 1 + Math.floor(rand() * 3); i < n; i++) {
        const spot = roofSpot(0.6, 1.0);
        if (spot) detail.chimneys.push({ ...spot, w: 0.55 + rand() * 0.2, d: 0.9 + rand() * 0.4, h: 0.9 + rand() * 0.7, colour: wallColour });
      }
      if (rand() < 0.6) {
        const spot = roofSpot(1.3, 1.8);
        if (spot) detail.skylights.push({ ...spot, w: 1.2, d: 1.7, h: 0.55 });
      }
    }
    for (let i = 0, n = 2 + Math.floor(rand() * 5); i < n; i++) {
      const spot = roofSpot(0.3, 0.3);
      if (spot) detail.vents.push({ ...spot, h: 0.6 + rand() * 1.1, r: 0.05 + rand() * 0.05 });
    }
    if (rand() < 0.28) {
      const spot = roofSpot(0.9, 0.9);
      if (spot) detail.dishes.push({ ...spot, ry: spot.ry + Math.PI * (0.6 + rand() * 0.8) });
    }
  }

  let count = 0;
  for (const e of edges) {
    const segments = Math.floor(e.length / 10);
    for (let i = 0; i < segments && count < 4; i++) {
      if (rand() > 0.22) continue;
      const u = ((i + 0.5) / segments - 0.5) * e.length, d = Math.min(8.5, e.length / segments - 1.6);
      const x = e.x - e.nz * u, z = e.z + e.nx * u, cs = e.nx, sn = -e.nz;
      // Keep storefronts out of courtyards and away from neighbouring walls or fire escapes.
      if (blocked(x + e.nx * 2.65, z + e.nz * 2.65, 5.2, d + 0.4, cs, sn)) continue;
      const ry = Math.atan2(sn, cs);
      let item;
      if (!detail.scaffoldSheds.length && rand() < 0.06) {
        item = { x: x + e.nx * 2, y: 0.22, z: z + e.nz * 2, w: 3.8, d, ry };
        detail.scaffoldSheds.push(item);
      } else {
        if (!b.storefronts) continue;
        item = { x: x + e.nx, y: 3.8, z: z + e.nz, w: 1.8, d, colorIdx: Math.floor(rand() * 5), ry };
        detail.awnings.push(item);
      }
      const outer = boxCorners(item.x, item.z, item.w, item.d, cs, sn);
      const xs = outer.map((p) => p.x), zs = outer.map((p) => p.z);
      const reserve = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs),
        height: 0, polygons: [{ outer, holes: [] }] };
      streetReserves.push(reserve);
      neighbours.push(reserve);
      count++;
    }
    if (count === 4) break;
  }
  return streetReserves;
}

export { addBuildingDetails };
