import { polygonBoxOverlaps } from './building-collision.js';

// One geometric reservation shared by terrain, vegetation and physics. Its quads use the same samples and width
// as the rendered road; this is a subtraction from the old procedural ground, not a second slab laid on top of it.
function highwayRowScale(route, i) {
  const a = Math.max(0, i - 1), b = Math.min(route.x.length - 1, i + 1);
  return Math.hypot(1, (route.x[b] - route.x[a]) / ((b - a) * route.step));
}

function createRoadCorridor(routes, halfWidth = 8.1, { eastEnd = 4250, westEnd = 5958 } = {}) {
  const quads = [], cells = new Map(), CELL = 64;
  for (const route of routes) {
    for (let i = 1; i < route.x.length; i++) {
      const az = route.z0 + (i - 1) * route.step, bz = az + route.step;
      if ((!route.west && bz > eastEnd) || (route.west && bz > westEnd)) continue;
      const ax = route.x[i - 1], bx = route.x[i];
      const ah = halfWidth * highwayRowScale(route, i - 1), bh = halfWidth * highwayRowScale(route, i);
      const q = { minX: Math.min(ax - ah, bx - bh), maxX: Math.max(ax + ah, bx + bh), minZ: az, maxZ: bz,
        ax, bx, ah, bh, poly: [[ax - ah, 0, az], [ax + ah, 0, az], [bx + bh, 0, bz], [bx - bh, 0, bz]] };
      quads.push(q);
      for (let x = Math.floor(q.minX / CELL); x <= Math.floor(q.maxX / CELL); x++) {
        for (let z = Math.floor(az / CELL); z <= Math.floor(bz / CELL); z++) {
          const key = `${x},${z}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(q);
        }
      }
    }
  }
  function query(minX, maxX, minZ, maxZ) {
    const found = new Set();
    for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) {
      for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) {
        for (const q of cells.get(`${x},${z}`) || []) {
          if (q.maxX >= minX && q.minX <= maxX && q.maxZ >= minZ && q.minZ <= maxZ) found.add(q);
        }
      }
    }
    return [...found];
  }
  function contains(x, z, margin = 0) {
    const nearby = margin ? query(x - margin, x + margin, z - margin, z + margin) : cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) || [];
    for (const q of nearby) {
      if (z < q.minZ - margin || z > q.maxZ + margin || x < q.minX - margin || x > q.maxX + margin) continue;
      const t = Math.max(0, Math.min(1, (z - q.minZ) / (q.maxZ - q.minZ)));
      const center = q.ax + (q.bx - q.ax) * t, half = q.ah + (q.bh - q.ah) * t;
      if (Math.abs(x - center) <= half + margin) return true;
    }
    return false;
  }
  return { quads, query, contains };
}

// Split against the four half-planes. Vertices can carry arbitrary interpolated attributes after xyz, so UVs,
// normals and the sidewalk atlas coordinates survive the cut. Each retained piece remains convex.
function subtractRoadQuad(vertices, quad) {
  let inside = vertices;
  const outside = [];
  for (let i = 0; i < 4 && inside.length; i++) {
    const a = quad[i], b = quad[(i + 1) % 4];
    const distance = p => (b[0] - a[0]) * (p[2] - a[2]) - (b[2] - a[2]) * (p[0] - a[0]);
    const yes = [], no = [];
    for (let k = 0; k < inside.length; k++) {
      const p = inside[k], q = inside[(k + 1) % inside.length], dp = distance(p), dq = distance(q);
      (dp >= -1e-8 ? yes : no).push(p);
      if ((dp > 1e-8 && dq < -1e-8) || (dp < -1e-8 && dq > 1e-8)) {
        const t = dp / (dp - dq), cut = p.map((v, n) => v + (q[n] - v) * t);
        yes.push(cut); no.push(cut);
      }
    }
    if (no.length >= 3) outside.push(no);
    inside = yes;
  }
  // Bounding boxes may overlap while the polygons miss each other. The half-plane walk can still split the
  // triangle along an edge's infinite extension: discard those provisional pieces when nothing was removed.
  // Keep the original reference too, so cutRoadGround does not expand an untouched indexed mesh.
  if (inside.length < 3) return [vertices];
  return outside;
}

// A surveyed pier's bounding rectangle can overhang its irregular landward end. Shorten its authored model from
// that end, keeping the seaward end fixed, until its headhouse clears the road. The access deck is trimmed separately.
function fitPierToRoad(corridor, { x, z, dx, dz, length, halfWidth }) {
  for (let shift = 0; shift <= Math.max(0, Math.min(80, length - 24)); shift += 0.5) {
    const halfL = (length - shift) / 2 + 1, halfW = halfWidth + 1;
    const cx = x + dx * (length + shift) / 2, cz = z + dz * (length + shift) / 2;
    const ex = Math.abs(dx) * halfL + Math.abs(dz) * halfW, ez = Math.abs(dz) * halfL + Math.abs(dx) * halfW;
    const blocked = corridor.query(cx - ex, cx + ex, cz - ez, cz + ez).some(q =>
      polygonBoxOverlaps({ outer: q.poly.map(p => ({ x: p[0], z: p[2] })), holes: [] }, cx, cz, halfW, halfL, dz, dx));
    if (!blocked) return { x: x + dx * shift, z: z + dz * shift, length: length - shift, setback: shift };
  }
  throw new Error('Pier headhouse has no clearance from the highway');
}

// A worksite may use the parking strip, but its full footprint must clear each moving lane, including long vans
// entering and leaving an edge. Callers supply nearby edges from their spatial index.
function overlapsTrafficLanes(polygon, edges, halfWidth = 1.45) {
  for (const e of edges) for (const offset of e.lanes) {
    const x = e.sx + e.dx * e.len / 2 + e.rx * offset;
    const z = e.sz + e.dz * e.len / 2 + e.rz * offset;
    if (polygonBoxOverlaps(polygon, x, z, halfWidth, e.len / 2 + 3.6, e.dz, e.dx)) return true;
  }
  return false;
}

export { createRoadCorridor, subtractRoadQuad, highwayRowScale, fitPierToRoad, overlapsTrafficLanes };
