import { pointInLoop } from './ground-plan.js';

// Ground registered by the builders that draw it, in world metres. The spatial index keeps wheel and foot queries
// independent of city size; it contains surfaces, never building roofs or water.
const CELL = 32;
const key = (x, z) => Math.floor(x / CELL) * 1048576 + Math.floor(z / CELL);

function groundFootprint(poly) {
  return {
    minX: Math.min(...poly.map(p => p.x)), maxX: Math.max(...poly.map(p => p.x)),
    minZ: Math.min(...poly.map(p => p.z)), maxZ: Math.max(...poly.map(p => p.z)),
    polygon: { outer: poly, holes: [] }
  };
}

function createGroundSurfaces() {
  const cells = new Map();
  function add(poly, height, { grip = 1, rough = 0.006, curb = true, plane = null } = {}) {
    if (poly.length < 3) return;
    const surface = { ...groundFootprint(poly), height, grip, rough, curb, plane };
    for (let x = Math.floor(surface.minX / CELL); x <= Math.floor(surface.maxX / CELL); x++) {
      for (let z = Math.floor(surface.minZ / CELL); z <= Math.floor(surface.maxZ / CELL); z++) {
        const k = x * 1048576 + z;
        let list = cells.get(k);
        if (!list) cells.set(k, list = []);
        list.push(surface);
      }
    }
    return surface;
  }
  // Park paths include sloping shoulders. Read the triangles used by the renderer instead of approximating their
  // bends with a distance to a line (which leaves cracks at mitred corners).
  function addTriangles(position, index, options = {}) {
    for (let i = 0; i < index.length; i += 3) {
      const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
      const ax = position[a], ay = position[a + 1], az = position[a + 2];
      const bx = position[b] - ax, by = position[b + 1] - ay, bz = position[b + 2] - az;
      const cx = position[c] - ax, cy = position[c + 1] - ay, cz = position[c + 2] - az;
      let nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
      if (Math.abs(ny) < 1e-8) continue;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const length = Math.hypot(nx, ny, nz);
      nx /= length; ny /= length; nz /= length;
      add([{ x: ax, z: az }, { x: position[b], z: position[b + 2] }, { x: position[c], z: position[c + 2] }], ay,
        { ...options, plane: { x: ax, z: az, nx, ny, nz } });
    }
  }
  // On a shared triangle edge, include both triangles; their heights agree. Polygon edges are solid too.
  function contains(poly, x, z) {
    if (pointInLoop(poly, x, z)) return true;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i], dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      if ((x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2 < 1e-12) return true;
    }
    return false;
  }
  function sample(x, z, out) {
    let best = null, height = -Infinity;
    for (const s of cells.get(key(x, z)) || []) {
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      const p = s.plane;
      const y = p ? s.height - ((x - p.x) * p.nx + (z - p.z) * p.nz) / p.ny : s.height;
      if (y <= height || !contains(s.polygon.outer, x, z)) continue;
      best = s; height = y;
    }
    if (!best) return false;
    out.y = height; out.grip = best.grip; out.rough = best.rough; out.curb = best.curb;
    out.nx = best.plane?.nx ?? 0; out.ny = best.plane?.ny ?? 1; out.nz = best.plane?.nz ?? 0;
    return true;
  }
  return { add, addTriangles, sample };
}

// The wall's visible outer edge and the lawn's inset enclose its solid coping. Split long edges so collision cells
// contain local wall pieces, not one park-sized box. The park interior remains accessible from above.
function groundBoundaryColliders(outer, inner, minY, maxY) {
  if (outer.length !== inner.length) throw new Error('Ground boundary rings must share their vertices');
  const colliders = [];
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length;
    const count = Math.max(1, Math.ceil(Math.hypot(outer[j].x - outer[i].x, outer[j].z - outer[i].z) / 24));
    for (let k = 0; k < count; k++) {
      const a = k / count, b = (k + 1) / count;
      const poly = [lerp(outer[i], outer[j], a), lerp(outer[i], outer[j], b), lerp(inner[i], inner[j], b), lerp(inner[i], inner[j], a)];
      colliders.push({ ...groundFootprint(poly), minY, maxY, obstacle: 'wall' });
    }
  }
  return colliders;
}

export { createGroundSurfaces, groundFootprint, groundBoundaryColliders };
