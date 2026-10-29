import { polygonContains } from './building-collision.js';

// Weapon catalogue and hitscan ballistics against the city (building colliders, ground), pedestrians, traffic,
// gameplay cars and armed characters. Damage itself is applied by the caller (gameplay.js) from the returned hit.

const WEAPONS = {
  fists: { id: 'fists', name: 'POINGS', sub: 'Corps à corps', melee: true, damage: 20, interval: 0.45, range: 1.7, hands: 0 },
  pistol: { id: 'pistol', name: 'CALYPSO 9', sub: 'Pistolet', damage: 34, interval: 0.22, mag: 12, reload: 1.3, spread: 0.006,
    moveSpread: 0.02, range: 200, sound: 'pistol', auto: false, hands: 1, recoil: 0.018, shake: 0.12, heat: 6 },
  smg: { id: 'smg', name: 'HORNET', sub: 'Pistolet-mitrailleur', damage: 21, interval: 0.085, mag: 30, reload: 1.8, spread: 0.018,
    moveSpread: 0.03, range: 160, sound: 'smg', auto: true, hands: 2, recoil: 0.011, shake: 0.08, heat: 7 },
  shotgun: { id: 'shotgun', name: 'BREAKER 12', sub: 'Fusil à pompe', damage: 15, pellets: 9, interval: 0.85, mag: 6, reload: 2.4,
    spread: 0.075, moveSpread: 0.02, range: 70, sound: 'shotgun', auto: false, hands: 2, recoil: 0.06, shake: 0.35, heat: 9 }
};
const WEAPON_ORDER = ['fists', 'pistol', 'smg', 'shotgun'];

const CELL = 24;
const _seen = new Set();
const _list = [];

// First building hit along a ray (t in metres), or Infinity. Colliders come from the controllers' 48 m grid; each is
// slab-tested on its bounds, then refined for oriented boxes and footprint polygons.
function raycastBuildings(controllers, ox, oy, oz, dx, dy, dz, maxDist, out = null) {
  _seen.clear();
  _list.length = 0;
  const steps = Math.ceil(maxDist / CELL);
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(maxDist, i * CELL);
    for (const c of controllers.nearColliders(ox + dx * t, oz + dz * t, CELL * 0.75)) {
      if (_seen.has(c)) continue;
      _seen.add(c);
      _list.push(c);
    }
  }
  let best = maxDist, normalAxis = -1, hitC = null;
  for (const c of _list) {
    const minY = c.minY ?? 0, maxY = c.maxY;
    let t0 = 0, t1 = best, axis = -1;
    // slabs: x, y, z
    const slab = (o, d, lo, hi, a) => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let ta = (lo - o) / d, tb = (hi - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > t0) { t0 = ta; axis = a; }
      if (tb < t1) t1 = tb;
      return t0 <= t1;
    };
    if (!slab(ox, dx, c.minX, c.maxX, 0) || !slab(oy, dy, minY, maxY, 1) || !slab(oz, dz, c.minZ, c.maxZ, 2)) continue;
    if (c.polygon || c.obb) {
      // March the bounds interval for the true footprint (0.25 m is finer than any facade detail that matters here)
      let hit = -1;
      for (let t = t0; t <= t1; t += 0.25) {
        const x = ox + dx * t, z = oz + dz * t;
        if (c.polygon ? polygonContains(c.polygon, x, z) : insideObb(c.obb, x, z)) { hit = t; break; }
      }
      if (hit < 0) continue;
      if (hit < best) { best = hit; hitC = c; normalAxis = hit === t0 ? axis : 3; }
    } else if (t0 < best) {
      best = t0; hitC = c; normalAxis = axis;
    }
  }
  if (!hitC) return Infinity;
  if (out) {
    out.nx = out.ny = out.nz = 0;
    if (normalAxis === 0) out.nx = -Math.sign(dx);
    else if (normalAxis === 1) out.ny = -Math.sign(dy);
    else if (normalAxis === 2) out.nz = -Math.sign(dz);
    else { out.nx = -dx; out.nz = -dz; const l = Math.hypot(out.nx, out.nz) || 1; out.nx /= l; out.nz /= l; }
    out.collider = hitC;
  }
  return best;
}

function insideObb(o, x, z) {
  const lx = (x - o.cx) * o.cs - (z - o.cz) * o.sn, lz = (x - o.cx) * o.sn + (z - o.cz) * o.cs;
  return Math.abs(lx) <= o.hx && Math.abs(lz) <= o.hz;
}

// Ray against an upright cylinder (people). Returns t or Infinity.
function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cz, radius, y0, y1, maxDist) {
  const fx = ox - cx, fz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-10) return Infinity;
  const b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
    if (t < 0 || t > maxDist) continue;
    const y = oy + dy * t;
    if (y >= y0 && y <= y1) return t;
  }
  return Infinity;
}

// Ray against an oriented box standing on the ground (vehicles): heading yaw, half extents hw (across) / hl (along)
function rayBox(ox, oy, oz, dx, dy, dz, cx, cz, yaw, hw, hl, y0, y1, maxDist) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  // local frame: x across (cos, -sin), z along (sin, cos)
  const px = (ox - cx) * c - (oz - cz) * s, pz = (ox - cx) * s + (oz - cz) * c;
  const vx = dx * c - dz * s, vz = dx * s + dz * c;
  let t0 = 0, t1 = maxDist;
  const slab = (o, d, h) => {
    if (Math.abs(d) < 1e-9) return Math.abs(o) <= h;
    let ta = (-h - o) / d, tb = (h - o) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    return t0 <= t1;
  };
  if (!slab(px, vx, hw) || !slab(pz, vz, hl)) return Infinity;
  if (Math.abs(dy) < 1e-9) { if (oy < y0 || oy > y1) return Infinity; }
  else {
    let ta = (y0 - oy) / dy, tb = (y1 - oy) / dy;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  return t0 <= t1 ? t0 : Infinity;
}

/**
 * Closest hit along a ray among every target class. `ignore` excludes the shooter (an entity, actor or ped).
 * Result: { t, x, y, z, nx, ny, nz, kind: 'building'|'ground'|'ped'|'traffic'|'car'|'actor'|'player', target }
 */
function castShot(world, ox, oy, oz, dx, dy, dz, maxDist, ignore = null) {
  const { controllers, traffic, cars = [], actors = [], player = null } = world;
  const hit = { t: maxDist, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, kind: 'none', target: null };
  const normal = {};
  const tb = raycastBuildings(controllers, ox, oy, oz, dx, dy, dz, maxDist, normal);
  if (tb < hit.t) { hit.t = tb; hit.kind = 'building'; hit.target = normal.collider; hit.nx = normal.nx; hit.ny = normal.ny; hit.nz = normal.nz; }
  if (dy < -1e-4) {
    // the ground: road at 0, sidewalks 0.22 (refined at the hit point)
    let tg = (0 - oy) / dy;
    const gx = ox + dx * tg, gz = oz + dz * tg;
    const gy = controllers.getGroundHeight(gx, gz, 'person');
    tg = (gy - oy) / dy;
    if (tg > 0 && tg < hit.t) { hit.t = tg; hit.kind = 'ground'; hit.target = null; hit.nx = 0; hit.ny = 1; hit.nz = 0; }
  }
  // Quick reject: distance from the ray's ground-plane segment
  const flat = Math.hypot(dx, dz) || 1e-6;
  const ux = dx / flat, uz = dz / flat, reach = hit.t * flat;
  const near = (x, z, r) => {
    const px = x - ox, pz = z - oz;
    const u = Math.max(0, Math.min(reach, px * ux + pz * uz));
    const qx = ux * u - px, qz = uz * u - pz;
    return qx * qx + qz * qz < r * r;
  };
  for (const p of traffic.peds) {
    if (!p.placed || p === ignore || p.dead) continue;
    if (!near(p.x, p.z, 1)) continue;
    const t = rayCylinder(ox, oy, oz, dx, dy, dz, p.x, p.z, 0.3, 0.2, 1.95, hit.t);
    if (t < hit.t) { hit.t = t; hit.kind = 'ped'; hit.target = p; }
  }
  for (const v of traffic.vehicles) {
    if (!v.edge || !near(v.x, v.z, 6)) continue;
    const t = rayBox(ox, oy, oz, dx, dy, dz, v.x, v.z, v.yaw + v.yawOffset, v.halfWidth, v.halfL ?? v.half, 0.15, v.bus ? 3.1 : 1.55, hit.t);
    if (t < hit.t) { hit.t = t; hit.kind = 'traffic'; hit.target = v; }
  }
  for (const c of cars) {
    if (c === ignore || c === world.ignoreCar || !c.mesh?.visible || !near(c.position.x, c.position.z, 6)) continue;
    const t = rayBox(ox, oy, oz, dx, dy, dz, c.position.x, c.position.z, c.heading, 0.9, 2.2, 0.15, 1.55, hit.t);
    if (t < hit.t) { hit.t = t; hit.kind = 'car'; hit.target = c; }
  }
  for (const a of actors) {
    if (a === ignore || a.dead || !near(a.x, a.z, 1)) continue;
    const t = rayCylinder(ox, oy, oz, dx, dy, dz, a.x, a.z, 0.32, a.y, a.y + 1.85, hit.t);
    if (t < hit.t) { hit.t = t; hit.kind = 'actor'; hit.target = a; }
  }
  if (player && player !== ignore && !(player.inVehicle && world.ignoreCar) && near(player.x, player.z, 3)) {
    const t = player.inVehicle
      ? rayBox(ox, oy, oz, dx, dy, dz, player.x, player.z, player.heading, 0.9, 2.2, 0.15, 1.55, hit.t)
      : rayCylinder(ox, oy, oz, dx, dy, dz, player.x, player.z, 0.32, player.y, player.y + 1.85, hit.t);
    if (t < hit.t) { hit.t = t; hit.kind = 'player'; hit.target = player; }
  }
  hit.x = ox + dx * hit.t; hit.y = oy + dy * hit.t; hit.z = oz + dz * hit.t;
  if (hit.kind === 'ped' || hit.kind === 'actor' || hit.kind === 'player' || hit.kind === 'traffic' || hit.kind === 'car') {
    hit.nx = -dx; hit.ny = -dy; hit.nz = -dz;
  }
  return hit;
}

// Line of sight between two points through buildings only
function lineOfSight(controllers, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.5) return true;
  return raycastBuildings(controllers, ax, ay, az, dx / d, dy / d, dz / d, d) >= d - 0.3;
}

// Random direction within a cone of `spread` radians around (dx, dy, dz) (unit), written to out
function spreadDirection(dx, dy, dz, spread, out) {
  if (spread <= 0) { out.x = dx; out.y = dy; out.z = dz; return out; }
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
  // basis perpendicular to d
  let ux = -dz, uy = 0, uz = dx;
  let l = Math.hypot(ux, uz);
  if (l < 1e-6) { ux = 1; uz = 0; l = 1; }
  ux /= l; uz /= l;
  const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
  out.x = dx + (ux * Math.cos(a) + vx * Math.sin(a)) * r;
  out.y = dy + (uy * Math.cos(a) + vy * Math.sin(a)) * r;
  out.z = dz + (uz * Math.cos(a) + vz * Math.sin(a)) * r;
  const n = Math.hypot(out.x, out.y, out.z);
  out.x /= n; out.y /= n; out.z /= n;
  return out;
}

export { WEAPONS, WEAPON_ORDER, castShot, raycastBuildings, lineOfSight, spreadDirection, rayCylinder, rayBox };
