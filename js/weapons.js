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
    spread: 0.075, moveSpread: 0.02, range: 70, sound: 'shotgun', auto: false, hands: 2, recoil: 0.06, shake: 0.35, heat: 9 },
  rifle: { id: 'rifle', name: 'SENTINEL', sub: 'Fusil d’assaut', damage: 29, interval: 0.11, mag: 30, reload: 2.1, spread: 0.006,
    moveSpread: 0.035, range: 280, sound: 'rifle', auto: true, hands: 2, recoil: 0.013, shake: 0.1, heat: 8 },
  // Thrown: the magazine is the number carried; no reload
  grenade: { id: 'grenade', name: 'ÉCLAT', sub: 'Grenade', throwable: true, damage: 0, interval: 0.9, mag: 10, reload: 0, range: 40, hands: 1, heat: 12 },
  // A gadget, not a gun: the « Levier » grapple (vertical.js fires it). No ammunition, no damage
  grapple: { id: 'grapple', name: 'LEVIER', sub: 'Grappin', gadget: true, damage: 0, interval: 0.35, range: 95, hands: 1 }
};
const WEAPON_ORDER = ['fists', 'pistol', 'smg', 'shotgun', 'rifle', 'grenade', 'grapple'];
const STARTER_MAGS = 10;

// Player handling is independent of the AI's accuracy. Short, paced bursts recover their first-shot precision.
const HANDLING = {
  pistol: { aimed: 0.0018, hip: 0.018, move: 0.007, bloom: 0.0035, maxBloom: 0.014, recovery: 8, falloff: 45, minimum: 0.55 },
  smg: { aimed: 0.0045, hip: 0.027, move: 0.013, bloom: 0.0026, maxBloom: 0.023, recovery: 5, falloff: 28, minimum: 0.38 },
  shotgun: { aimed: 0.046, hip: 0.065, move: 0.012, bloom: 0.009, maxBloom: 0.02, recovery: 7, falloff: 12, minimum: 0.12 },
  rifle: { aimed: 0.0022, hip: 0.024, move: 0.01, bloom: 0.0022, maxBloom: 0.018, recovery: 6, falloff: 75, minimum: 0.58 }
};

// A weapon carrying its own `handling` (the player's, with upgrades fitted: weapon-mods.js effectiveWeapon) is read
// through it; a bare WEAPONS entry falls back on the stock table.
function gunSpread(weapon, aiming, speed = 0, bloom = 0) {
  const h = weapon.handling ?? HANDLING[weapon.id];
  if (!h) return weapon.spread || 0;
  return (aiming ? h.aimed : h.hip) + Math.min(1.5, Math.abs(speed) / 3.9) * h.move + Math.max(0, bloom);
}

function gunDamage(weapon, distance) {
  const h = weapon.handling ?? HANDLING[weapon.id];
  if (!h || distance <= h.falloff) return weapon.damage;
  const t = Math.min(1, Math.max(0, (distance - h.falloff) / (weapon.range - h.falloff)));
  return weapon.damage * (1 - t * (1 - h.minimum));
}

// The sight ray starts at the player's depth, so it never selects a pedestrian behind the shoulder camera.
// Unlike a fixed three-metre cutoff this preserves point-blank targets as the camera moves in near a wall.
function sightOrigin(camera, direction, player, out) {
  const depth = Math.max(0, (player.x - camera.x) * direction.x +
    (player.y + 1.4 - camera.y) * direction.y + (player.z - camera.z) * direction.z);
  out.x = camera.x + direction.x * depth;
  out.y = camera.y + direction.y * depth;
  out.z = camera.z + direction.z * depth;
  return out;
}

// A barrel poking through cover must hit that cover, not begin its ray on the other side.
function muzzleObstruction(world, player, muzzle) {
  const y = player.y + 1.35;
  const dx = muzzle.x - player.x, dy = muzzle.y - y, dz = muzzle.z - player.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 0.01) return null;
  const hit = castShot(world, player.x, y, player.z, dx / length, dy / length, dz / length, length, player);
  return hit.kind === 'none' ? null : hit;
}

// The whole arsenal from the first second: every gun loaded with ten magazines in reserve, a full belt of grenades.
// Tops up what a save already holds, never takes anything away.
function stockArsenal(weapons) {
  for (const id of WEAPON_ORDER) {
    const w = WEAPONS[id];
    const slot = weapons[id] ??= { mag: 0, ammo: 0 };
    if (w.melee || w.gadget) continue;
    slot.mag = Math.max(slot.mag, w.mag);
    if (!w.throwable) slot.ammo = Math.max(slot.ammo, w.mag * STARTER_MAGS);
  }
  return weapons;
}

const CELL = 24;
const _seen = new Set();
const _list = [];

// First building hit along a ray (t in metres), or Infinity. Colliders come from the controllers' 48 m grid; each is
// slab-tested on its bounds, then refined for oriented boxes and footprint polygons.
function raycastBuildings(controllers, ox, oy, oz, dx, dy, dz, maxDist, out = null, includeParked = true) {
  _seen.clear();
  _list.length = 0;
  const steps = Math.ceil(maxDist / CELL);
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(maxDist, i * CELL);
    for (const c of controllers.nearColliders(ox + dx * t, oz + dz * t, CELL * 0.75)) {
      if ((!includeParked && c.parked !== undefined) || _seen.has(c)) continue;
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
    if (c.polygon) {
      // March the clipped interval for the true footprint, including courtyards.
      let hit = -1;
      for (let t = t0; t <= t1; t += 0.25) {
        const x = ox + dx * t, z = oz + dz * t;
        if (polygonContains(c.polygon, x, z)) { hit = t; break; }
      }
      if (hit < 0) continue;
      if (hit < best) { best = hit; hitC = c; normalAxis = hit === t0 ? axis : 3; }
      continue;
    }
    if (c.obb) {
      // Recompute the entry in the box's own axes. Sampling the broad bounds can step over a thin shopfront.
      const { cx, cz, cs, sn, hx, hz } = c.obb;
      const x = ox - cx, z = oz - cz;
      t0 = 0; axis = -1;
      if (!slab(oy, dy, minY, maxY, 1) || !slab(x * cs - z * sn, dx * cs - dz * sn, -hx, hx, 4) ||
        !slab(x * sn + z * cs, dx * sn + dz * cs, -hz, hz, 5)) continue;
    }
    if (t0 < best) {
      best = t0; hitC = c; normalAxis = axis;
    }
  }
  if (!hitC) return Infinity;
  if (out) {
    out.nx = out.ny = out.nz = 0;
    if (normalAxis === 0) out.nx = -Math.sign(dx);
    else if (normalAxis === 1) out.ny = -Math.sign(dy);
    else if (normalAxis === 2) out.nz = -Math.sign(dz);
    else if (normalAxis === 4 || normalAxis === 5) {
      const { cs, sn } = hitC.obb;
      const nx = normalAxis === 4 ? cs : sn, nz = normalAxis === 4 ? -sn : cs;
      const side = -Math.sign(dx * nx + dz * nz);
      out.nx = nx * side; out.nz = nz * side;
    } else { out.nx = -dx; out.nz = -dz; const l = Math.hypot(out.nx, out.nz) || 1; out.nx /= l; out.nz /= l; }
    out.collider = hitC;
  }
  return best;
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
  // dx, dy, dz: the direction the shot travelled, for whatever it does to what it strikes (effects lean with it)
  const hit = { t: maxDist, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, dx, dy, dz, kind: 'none', target: null };
  const normal = {};
  // Parked cars have movement colliders as well as damageable hitboxes. Test them once, as vehicles.
  const tb = raycastBuildings(controllers, ox, oy, oz, dx, dy, dz, maxDist, normal, !world.parking);
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
    if (c === ignore || c === world.ignoreCar || c.bicycle || !c.mesh?.visible || !near(c.position.x, c.position.z, 6)) continue;
    const y = c.position.y || 0;
    const t = rayBox(ox, oy, oz, dx, dy, dz, c.position.x, c.position.z, c.heading, c.halfW ?? 0.9, c.halfL ?? 2.2, y + 0.15, y + 1.55, hit.t);
    if (t < hit.t) { hit.t = t; hit.kind = 'car'; hit.target = c; }
  }
  // Cars parked along the curbs (parking.js): hit, one becomes a gameplay car (applyShot)
  if (world.parking) {
    const parking = world.parking;
    parking.forEachAlong(ox, oz, ux, uz, reach, 3.5, (i) => {
      const s = parking.info(i);
      const t = rayBox(ox, oy, oz, dx, dy, dz, s.x, s.z, s.yaw, s.halfW, s.halfL, 0.15, 1.55, hit.t);
      if (t < hit.t) { hit.t = t; hit.kind = 'parked'; hit.target = i; }
    });
  }
  for (const a of actors) {
    if (a === ignore || a.dead || !near(a.x, a.z, 1)) continue;
    const t = rayCylinder(ox, oy, oz, dx, dy, dz, a.x, a.z, 0.32, a.y, a.y + (a.height ?? 1.85), hit.t);
    if (t < hit.t) { hit.t = t; hit.kind = 'actor'; hit.target = a; }
  }
  if (player && player !== ignore && !(player.inVehicle && world.ignoreCar) && near(player.x, player.z, 3)) {
    const t = player.inVehicle
      ? rayBox(ox, oy, oz, dx, dy, dz, player.x, player.z, player.heading, 0.9, 2.2, player.y + 0.15, player.y + 1.55, hit.t)
      : rayCylinder(ox, oy, oz, dx, dy, dz, player.x, player.z, 0.32, player.y, player.y + 1.85, hit.t);
    if (t < hit.t) { hit.t = t; hit.kind = 'player'; hit.target = player; }
  }
  hit.x = ox + dx * hit.t; hit.y = oy + dy * hit.t; hit.z = oz + dz * hit.t;
  if (hit.kind === 'ped' || hit.kind === 'actor' || hit.kind === 'player' || hit.kind === 'traffic' || hit.kind === 'car' || hit.kind === 'parked') {
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

export { WEAPONS, WEAPON_ORDER, HANDLING, gunSpread, gunDamage, sightOrigin, muzzleObstruction, stockArsenal, castShot, raycastBuildings, lineOfSight, spreadDirection, rayCylinder, rayBox };
