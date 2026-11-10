import { polygonContains, polygonBoxOverlaps } from './building-collision.js';
import { wallKey } from './storefront-plan.js';

// CALIBRE, the gun shops: where they go in the real buildings, and the plan of one branch. Pure data and geometry,
// shared by the architecture (calibre-room.js), the game (calibre.js), the collisions and the tests.
//
// A branch is a shop on the street and a shooting range behind it, carved out of one building's ground floor:
//
//      street            z = 0      glazed front, 1.8 m doorway in the middle
//   ┌──────────────┐
//   │ shelves  racks│   shop        left wall: ammunition; right wall: protection; two glass cases on the floor
//   │  ▭        ▭  │
//   │▬▬▬▬▬▬▬▬▬▬▬  │   z = -7.3   the counter, from the left wall; a passage is left along the right wall
//   │ gun wall    ▯│   z = -10.3  partition, with the door to the range on the right
//   ├──────────────┤
//   │ desk         │   range       briefing area
//   │ ╷  ╷  ╷  ╷   │   z = -14.6  the firing line: four booths
//   │ ·  ·  ·  ·   │               lanes; the targets ride in on ceiling rails
//   │▓▓▓▓▓▓▓▓▓▓▓▓▓│   z = -27.1  bullet trap
//   └──────────────┘
//
// Local frame of a site: x along the facade (to the right when entering), z out of the building (the street is +z),
// origin on the facade line in the middle of the front. Heights are above the city's ground; the floor is CALIBRE.floor.

const CALIBRE = Object.freeze({ width: 8.8, depth: 27.8, shop: 10.2, height: 3.8, floor: 0.24, door: 1.8, count: 48 });

// The plan, in the local frame (metres). `h` is a height above the floor.
const HALF = 4.2; // the walls' inner faces
const PLAN = Object.freeze({
  half: HALF,
  ceiling: 3.44,
  partition: { z: -10.3, door: { x0: 2.75, x1: 3.85, h: 2.16 } },
  back: -27.6,
  counter: { x0: -HALF, x1: 2.2, z: -7.3, depth: 0.9, h: 1.08 },
  gate: { x: 2.26, z0: -7.75, z1: -10.2, h: 1.08 },
  shelves: { x: -3.93, depth: 0.54, z0: -0.95, z1: -6.35, h: 2.3 },
  racks: { x: 3.98, depth: 0.44, z0: -0.95, z1: -6.0, h: 2.4 },
  cases: [{ x: -2.15, z: -3.7, w: 1.0, d: 1.9, h: 0.98 }, { x: 2.15, z: -3.7, w: 1.0, d: 1.9, h: 0.98 }],
  windows: [{ x: -2.65, z: -0.58, w: 3.1, d: 0.8, h: 0.5 }, { x: 2.65, z: -0.58, w: 3.1, d: 0.8, h: 0.5 }],
  desk: { x: -2.95, z: -11.55, w: 1.6, d: 0.8, h: 0.78 },
  line: { z: -14.6, depth: 0.5, h: 1.0 },
  booths: { z0: -13.35, z1: -14.75, walls: [-2.1, 0, 2.1], h: 2.25 },
  lanes: [-3.15, -1.05, 1.05, 3.15],
  targets: { near: -18.6, far: -26.3 },
  trap: { z: -27.1, depth: 1.0, h: 2.7 }
});

function calibrePoint(site, x, z) {
  return { x: site.x + site.nz * x + site.nx * z, z: site.z - site.nx * x + site.nz * z };
}
function calibreLocal(site, x, z) {
  const dx = x - site.x, dz = z - site.z;
  return { x: dx * site.nz - dz * site.nx, z: dx * site.nx + dz * site.nz };
}

function roomFits(site, polygon) {
  const half = CALIBRE.width / 2;
  // Include the entire shell, and reject concavities/courtyards cutting any of its edges.
  for (const x of [-half - 0.2, 0, half + 0.2]) for (let z = -0.15; z > -CALIBRE.depth - 0.25; z -= 2.5) {
    const p = calibrePoint(site, x, Math.max(z, -CALIBRE.depth - 0.2));
    if (!polygonContains(polygon, p.x, p.z)) return false;
  }
  for (const x of [-half - 0.2, 0, half + 0.2]) {
    const p = calibrePoint(site, x, -CALIBRE.depth - 0.2);
    if (!polygonContains(polygon, p.x, p.z)) return false;
  }
  const crossesRoom = (a, b) => {
    let lo = 0, hi = 1;
    for (const [start, delta, min, max] of [[a.x, b.x - a.x, -half - 0.19, half + 0.19], [a.z, b.z - a.z, -CALIBRE.depth - 0.19, -0.1]]) {
      if (Math.abs(delta) < 1e-10) { if (start <= min || start >= max) return false; }
      else { const t0 = (min - start) / delta, t1 = (max - start) / delta; lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1)); }
    }
    return hi - lo > 1e-8;
  };
  for (const ring of [polygon.outer, ...(polygon.holes || [])]) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (crossesRoom(calibreLocal(site, a.x, a.z), calibreLocal(site, b.x, b.z))) return false;
  }
  // A boundary vertex in the proposed room reveals a re-entrant wall or courtyard.
  for (const ring of [polygon.outer, ...(polygon.holes || [])]) for (const p of ring) {
    const q = calibreLocal(site, p.x, p.z);
    if (Math.abs(q.x) < half + 0.2 && q.z < -0.05 && q.z > -CALIBRE.depth - 0.2) return false;
  }
  return true;
}

function planCalibre(shops, records, count = CALIBRE.count, bounds = null) {
  const candidates = [];
  for (const shop of shops) {
    if (shop.width < CALIBRE.width + 0.6 || shop.record.height < CALIBRE.height + 1) continue;
    const site = { x: shop.x + shop.ux * shop.width / 2, z: shop.z + shop.uz * shop.width / 2,
      nx: shop.nx, nz: shop.nz, wall: shop.wall, shop, record: shop.record };
    if (bounds) {
      const playable = (x, z) => {
        const p = calibrePoint(site, x, z), shore = bounds.shoreAt?.(p.z);
        return p.z > bounds.minZ + 40 && p.z < bounds.maxZ - 20 && p.x > bounds.minX + 20 && p.x < bounds.maxX - 20 &&
          (!shore || p.x > shore.westX + 15 && p.x < shore.eastX - 15);
      };
      if (![-4.6, 4.6].every(x => [-CALIBRE.depth - 0.2, 4.5].every(z => playable(x, z)))) continue;
    }
    const polygon = shop.record.polygons.find(p => roomFits(site, p));
    if (!polygon) continue;
    const approach = calibrePoint(site, 0, 1.8), middle = calibrePoint(site, 0, -CALIBRE.depth / 2);
    const reach = CALIBRE.depth + 6;
    const nearby = records.filter(r => r !== site.record && r.minX < site.x + reach && r.maxX > site.x - reach && r.minZ < site.z + reach && r.maxZ > site.z - reach);
    if (nearby.some(r => r.polygons.some(p => polygonBoxOverlaps(p, approach.x, approach.z, 1.3, 1.6, site.nz, site.nx)
      || polygonBoxOverlaps(p, middle.x, middle.z, CALIBRE.width / 2, CALIBRE.depth / 2 - 0.1, site.nz, site.nx)))) continue;
    site.polygon = polygon;
    site.id = `calibre-${Math.round(site.x * 10)}-${Math.round(site.z * 10)}`;
    candidates.push(site);
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  const selected = [], used = new Set();
  // The first branch is close to the opening; farthest-point sampling then covers the whole inhabited island.
  for (const site of candidates) site.distance = Math.hypot(site.x + 12, site.z - 380);
  while (selected.length < count) {
    let best = null;
    for (const site of candidates) {
      if (used.has(site.record) || (selected.length && site.distance < 350)) continue;
      if (!best || (selected.length ? site.distance > best.distance : site.distance < best.distance)) best = site;
    }
    if (!best) break;
    selected.push(best); used.add(best.record);
    best.variant = (selected.length - 1) % 3;
    best.shop.calibre = best;
    best.record.calibreOpenings = [best];
    for (const site of candidates) {
      const distance = Math.hypot(site.x - best.x, site.z - best.z);
      site.distance = selected.length === 1 ? distance : Math.min(site.distance, distance);
    }
  }
  return selected;
}

// Subtract an open-front room from the ground-floor footprint, retaining its original winding.
function carveCalibrePolygon(polygon, site) {
  const ring = polygon.outer, outer = [];
  let cut = false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    outer.push(a);
    if (wallKey(a.x, a.z, b.x, b.z) !== site.wall) continue;
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    const along = (site.x - a.x) * dx / length + (site.z - a.z) * dz / length;
    const half = CALIBRE.width / 2;
    if (along - half < 0 || along + half > length) throw new Error('CALIBRE: opening outside its wall');
    const p = { x: a.x + dx / length * (along - half), z: a.z + dz / length * (along - half) };
    const q = { x: a.x + dx / length * (along + half), z: a.z + dz / length * (along + half) };
    outer.push(p, { x: p.x - site.nx * CALIBRE.depth, z: p.z - site.nz * CALIBRE.depth },
      { x: q.x - site.nx * CALIBRE.depth, z: q.z - site.nz * CALIBRE.depth }, q);
    cut = true;
  }
  if (!cut) throw new Error('CALIBRE: facade wall not found');
  return { outer, holes: polygon.holes || [] };
}

function carveCalibreColliders(colliders, sites) {
  for (const site of sites) {
    const index = colliders.findIndex(c => c.polygon === site.polygon && c.minY === 0);
    if (index < 0) throw new Error('CALIBRE: building collider not found');
    const original = colliders[index];
    colliders[index] = { ...original, polygon: carveCalibrePolygon(original.polygon, site), maxY: CALIBRE.height, roof: false };
    colliders.push({ ...original, minY: CALIBRE.height });
  }
}

function calibreWallPanels(record, ax, az, bx, bz, bottom, top) {
  const width = Math.hypot(bx - ax, bz - az), key = wallKey(ax, az, bx, bz);
  const site = record.calibreOpenings?.find(s => s.wall === key);
  if (!site || bottom >= CALIBRE.height) return [[0, width, bottom, top]];
  const t = ((site.x - ax) * (bx - ax) + (site.z - az) * (bz - az)) / width;
  const lo = t - CALIBRE.width / 2, hi = t + CALIBRE.width / 2;
  return [[0, lo, bottom, top], [lo, hi, CALIBRE.height, top], [hi, width, bottom, top]].filter(p => p[1] - p[0] > 0.001 && p[3] > p[2]);
}

function calibreBox(site, x, z, width, depth, minY, maxY) {
  const centre = calibrePoint(site, x, z), cs = site.nz, sn = site.nx;
  const ex = Math.abs(cs) * width / 2 + Math.abs(sn) * depth / 2;
  const ez = Math.abs(sn) * width / 2 + Math.abs(cs) * depth / 2;
  return { minX: centre.x - ex, maxX: centre.x + ex, minZ: centre.z - ez, maxZ: centre.z + ez, minY, maxY,
    obb: { cx: centre.x, cz: centre.z, cs, sn, hx: width / 2, hz: depth / 2 } };
}

// What stands in the way inside a branch: the shell, the partition and the furniture of PLAN
function calibreFixtures(site) {
  const c = [], F = CALIBRE.floor, top = CALIBRE.height;
  const box = (x, z, width, depth, h = top - F) => c.push(calibreBox(site, x, z, width, depth, 0, F + h));
  const span = (x0, x1, z0, z1, h) => box((x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(z1 - z0), h);
  const P = PLAN, wall = CALIBRE.width / 2;
  // shell: back and sides, then the glazed front on either side of a permanent 1.8 m clear doorway
  span(-wall, wall, -CALIBRE.depth, P.back);
  span(-wall, -HALF, 0, -CALIBRE.depth); span(HALF, wall, 0, -CALIBRE.depth);
  box(-2.65, 0, 3.5, 0.18); box(2.65, 0, 3.5, 0.18);
  // partition between the shop and the range, open at its door (the lintel is above anyone's head)
  const pz = P.partition.z, door = P.partition.door;
  span(-wall, door.x0, pz + 0.1, pz - 0.1); span(door.x1, wall, pz + 0.1, pz - 0.1);
  c.push(calibreBox(site, (door.x0 + door.x1) / 2, pz, door.x1 - door.x0, 0.2, F + door.h, top));
  // shop
  span(P.counter.x0, P.counter.x1, P.counter.z + P.counter.depth / 2, P.counter.z - P.counter.depth / 2, P.counter.h);
  span(P.gate.x - 0.06, P.gate.x + 0.06, P.gate.z0, P.gate.z1, P.gate.h);
  span(P.shelves.x - P.shelves.depth / 2, P.shelves.x + P.shelves.depth / 2, P.shelves.z0, P.shelves.z1, P.shelves.h);
  span(P.racks.x - P.racks.depth / 2, P.racks.x + P.racks.depth / 2, P.racks.z0, P.racks.z1, P.racks.h);
  for (const k of [...P.cases, ...P.windows, P.desk]) box(k.x, k.z, k.w, k.d, k.h);
  // range: the firing line's bench across the room, the booth walls, the trap
  span(-HALF, HALF, P.line.z + P.line.depth / 2, P.line.z - P.line.depth / 2, P.line.h);
  for (const x of P.booths.walls) span(x - 0.05, x + 0.05, P.booths.z0, P.booths.z1, P.booths.h);
  span(-HALF, HALF, P.trap.z + P.trap.depth / 2, P.trap.z - P.trap.depth / 2, P.trap.h);
  return c;
}

// Where a point of the local frame is: 'shop', 'range' (behind the partition) or null (outside the walls)
function calibreZone(x, z) {
  if (Math.abs(x) >= HALF + 0.1 || z > 0.15 || z < PLAN.back) return null;
  return z > PLAN.partition.z ? 'shop' : 'range';
}

export { CALIBRE, PLAN, calibrePoint, calibreLocal, roomFits, planCalibre, carveCalibrePolygon, carveCalibreColliders, calibreWallPanels, calibreBox, calibreFixtures, calibreZone };
