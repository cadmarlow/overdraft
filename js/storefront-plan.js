// Where every shop goes: each registered storefront (js/storefront-geodata.js) finds the wall of its building that
// faces the street its address is on, then each wall is shared out between its shops. Pure data in, pure data out
// (no three.js), so tests can check it in Node.
//
// A building record: { polygons: [{ outer: [{x, z}], holes }], height, cx, cz, minX, maxX, minZ, maxZ }.
// A planned shop: { x, z (start of its frontage, on the wall), ux, uz (along the wall), nx, nz (out of the wall),
//   width, type (code in js/storefront-types.js), seed, record, wall (wallKey) }.

const PREFERRED_WIDTH = {
  vacant: 7, bodega: 6, pizza: 5.5, cafe: 6.5, bakery: 6, takeout: 5.5, sushi: 6.5, latin: 7, restaurant: 9, bar: 7.5,
  diner: 7, juice: 4.5, laundromat: 7.5, cleaners: 5, barber: 5, salon: 5, pharmacy: 12, bank: 12, boutique: 7, luxury: 14,
  jewelry: 5, phones: 4.5, hardware: 7, florist: 5.5, liquor: 6, books: 7, office: 7, souvenir: 6, shoes: 7, gallery: 10
};
const MIN_WIDTH = 3.6;
// What fills out an avenue frontage beside its registered shops
const FILLER = ['bodega', 'restaurant', 'cafe', 'boutique', 'phones', 'salon', 'cleaners', 'pharmacy', 'pizza', 'diner', 'bar', 'vacant',
  'shoes', 'takeout', 'liquor', 'florist', 'barber', 'laundromat', 'bakery', 'restaurant', 'boutique', 'vacant'];
const MAX_WIDTH = 18;
const END_MARGIN = 0.35; // masonry left at each end of a wall, where it meets the next wall
const SEARCH = 40; // metres from the property's point to the walls it may own

// Walls are keyed by their rounded end points, whichever way round a ring runs
function wallKey(ax, az, bx, bz) {
  const a = `${Math.round(ax * 10)},${Math.round(az * 10)}`, b = `${Math.round(bx * 10)},${Math.round(bz * 10)}`;
  return a < b ? a + '|' + b : b + '|' + a;
}

function ringSignedArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    s += a.x * b.z - b.x * a.z;
  }
  return s / 2;
}

function ringContains(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < a.x + (z - a.z) * (b.x - a.x) / (b.z - a.z)) inside = !inside;
  }
  return inside;
}

function polygonContains(polygon, x, z) {
  if (!ringContains(polygon.outer, x, z)) return false;
  return !(polygon.holes || []).some((h) => ringContains(h, x, z));
}

function hashSeed(x, z, i) {
  let h = Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(z * 10) | 0, 19349663) ^ Math.imul(i + 1, 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * @param {object[]} records - building records
 * @param {object} storefronts - { count, x, z, streetX, streetZ, type } (js/storefront-geodata.js)
 * @param {object[]} types - SHOP_TYPES
 * @returns {{ shops: object[], wallsByRecord: Map<object, Set<string>>, unplaced: number, dropped: number }}
 */
function planStorefronts(records, storefronts, types) {
  // Buildings by 50 m cell
  const CELL = 50;
  const grid = new Map();
  records.forEach((r) => {
    if (!(r.height >= 5)) return;
    for (let i = Math.floor(r.minX / CELL); i <= Math.floor(r.maxX / CELL); i++)
      for (let j = Math.floor(r.minZ / CELL); j <= Math.floor(r.maxZ / CELL); j++) {
        const k = i * 100003 + j;
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(r);
      }
  });
  const recordsNear = (x, z, r) => {
    const out = new Set();
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++)
        for (const rec of grid.get(i * 100003 + j) || [])
          if (x > rec.minX - r && x < rec.maxX + r && z > rec.minZ - r && z < rec.maxZ + r) out.add(rec);
    return out;
  };
  const insideOther = (own, x, z) => {
    for (const rec of recordsNear(x, z, 0)) {
      if (rec === own) continue;
      if (rec.polygons.some((p) => polygonContains(p, x, z))) return true;
    }
    return false;
  };

  // Every outer wall of a record, outward normal and all, built on first use
  const wallCache = new Map();
  function wallsOf(rec) {
    let walls = wallCache.get(rec);
    if (walls) return walls;
    walls = [];
    for (const polygon of rec.polygons) {
      const ring = polygon.outer;
      if (ring.length < 3) continue;
      const ccw = ringSignedArea(ring) > 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
        if (length < MIN_WIDTH + 2 * END_MARGIN) continue;
        const ux = dx / length, uz = dz / length;
        walls.push({ rec, ax: a.x, az: a.z, ux, uz, length, nx: ccw ? uz : -uz, nz: ccw ? -ux : ux,
          key: wallKey(a.x, a.z, b.x, b.z), party: null, shops: [] });
      }
    }
    wallCache.set(rec, walls);
    return walls;
  }
  // A wall another building stands against (or the building's own other wing) never gets a shopfront
  function isParty(w) {
    if (w.party === null) {
      w.party = false;
      for (const t of [0.2, 0.5, 0.8]) {
        const x = w.ax + w.ux * w.length * t + w.nx * 1.4, z = w.az + w.uz * w.length * t + w.nz * 1.4;
        if (insideOther(w.rec, x, z) || w.rec.polygons.some((p) => polygonContains(p, x, z))) { w.party = true; break; }
      }
    }
    return w.party;
  }

  let unplaced = 0;
  const used = new Set();
  for (let i = 0; i < storefronts.count; i++) {
    const px = storefronts.x[i], pz = storefronts.z[i], sx = storefronts.streetX[i], sz = storefronts.streetZ[i];
    let best = null, bestScore = Infinity, bestOut = 0;
    for (const rec of recordsNear(px, pz, SEARCH)) {
      for (const w of wallsOf(rec)) {
        // The street point must lie in front of the wall, a sidewalk and a roadway away
        const ox = sx - w.ax, oz = sz - w.az;
        const out = ox * w.nx + oz * w.nz;
        if (out < 3 || out > 70) continue;
        const along = ox * w.ux + oz * w.uz;
        const beyond = Math.max(0, -along, along - w.length);
        if (beyond > 25) continue;
        // ... and the property's point near it
        const qx = px - w.ax, qz = pz - w.az;
        const t = Math.max(0, Math.min(w.length, qx * w.ux + qz * w.uz));
        const dist = Math.hypot(qx - w.ux * t, qz - w.uz * t);
        if (dist > SEARCH) continue;
        const score = dist + beyond * 2 + Math.abs(out - 18) * 0.15;
        if (score < bestScore && !isParty(w)) { bestScore = score; best = w; bestOut = out; }
      }
    }
    if (!best) { unplaced++; continue; }
    const qx = px - best.ax, qz = pz - best.az;
    best.shops.push({ index: i, type: storefronts.type[i], t: qx * best.ux + qz * best.uz });
    best.out = Math.max(best.out || 0, bestOut);
    used.add(best);
  }

  // Share each wall out between its shops
  const shops = [];
  const wallsByRecord = new Map();
  let dropped = 0;
  for (const w of used) {
    const usable = w.length - 2 * END_MARGIN;
    let list = w.shops.sort((a, b) => a.t - b.t || a.index - b.index);
    const room = Math.floor(usable / MIN_WIDTH);
    if (list.length > room) {
      // Too many for the frontage (upper-floor units, food halls): keep the open shops, spread along the wall
      const open = list.filter((s) => types[s.type].id !== 'vacant');
      const keep = (open.length >= room ? open : list).filter((_, k, arr) => Math.floor(k * room / arr.length) !== Math.floor((k - 1) * room / arr.length));
      dropped += list.length - keep.length;
      list = keep.slice(0, room);
    }
    // Avenues (their centre line well out from the wall) are lined with shops end to end: the registry's storefronts
    // there get company, picked like the neighbours, so the frontage fills up
    const avenue = (w.out || 0) >= 14;
    if (avenue) {
      let room = usable - list.reduce((n, s) => n + (PREFERRED_WIDTH[types[s.type].id] ?? 6), 0);
      let k = 0;
      while (room > 7 && list.length < Math.floor(usable / MIN_WIDTH)) {
        const h = hashSeed(w.ax + k, w.az - k, 7919 + k);
        const id = FILLER[Math.floor(h * FILLER.length)];
        const type = types.findIndex((t) => t.id === id);
        list.push({ index: -1 - k, type, t: w.length * hashSeed(w.az, w.ax, k), filler: true });
        room -= PREFERRED_WIDTH[id];
        k++;
      }
      list.sort((a, b) => a.t - b.t);
    }
    const preferred = list.map((s) => {
      const base = PREFERRED_WIDTH[types[s.type].id] ?? 6;
      return base * (0.85 + 0.3 * hashSeed(w.ax, w.az, s.index)) * (avenue ? 1 : 1.25);
    });
    const total = preferred.reduce((n, v) => n + v, 0);
    let widths, starts;
    if (total >= usable * 0.82) {
      // A full frontage: every shop scaled to fill it
      widths = preferred.map((p) => p * usable / total);
      starts = [];
      let s = END_MARGIN;
      for (const width of widths) { starts.push(s); s += width; }
    } else {
      // Few shops on a long wall: each where its property's point says, the rest stays the building's own base
      widths = preferred.map((p) => Math.min(MAX_WIDTH, p));
      starts = list.map((s, k) => Math.max(END_MARGIN, Math.min(w.length - END_MARGIN - widths[k], s.t - widths[k] / 2)));
      for (let k = 1; k < starts.length; k++) starts[k] = Math.max(starts[k], starts[k - 1] + widths[k - 1]);
      const overflow = starts.length ? starts[starts.length - 1] + widths[widths.length - 1] - (w.length - END_MARGIN) : 0;
      if (overflow > 0) {
        for (let k = starts.length - 1; k >= 0; k--) {
          const limit = k === starts.length - 1 ? w.length - END_MARGIN - widths[k] : starts[k + 1] - widths[k];
          starts[k] = Math.max(END_MARGIN, Math.min(starts[k], limit));
        }
      }
    }
    list.forEach((s, k) => {
      if (widths[k] < MIN_WIDTH - 0.01) { dropped++; return; }
      shops.push({
        x: w.ax + w.ux * starts[k], z: w.az + w.uz * starts[k], ux: w.ux, uz: w.uz, nx: w.nx, nz: w.nz,
        width: widths[k], type: s.type, seed: hashSeed(w.ax + starts[k], w.az, s.index), record: w.rec, wall: w.key,
        filler: !!s.filler
      });
    });
  }
  // Two surveyed footprints can share a street wall (a building over a duplicate of its outline): the second one's
  // shops would stand in the first one's, gate on gate, fighting over every pixel they share. The first keeps them.
  const kept = [], frontCells = new Map();
  for (const s of shops) {
    const cx = Math.floor(s.x / 20), cz = Math.floor(s.z / 20);
    let clash = false;
    for (let dx = -1; dx <= 1 && !clash; dx++) {
      for (let dz = -1; dz <= 1 && !clash; dz++) {
        for (const o of frontCells.get((cx + dx) + ',' + (cz + dz)) || []) {
          if (o.wall === s.wall || s.nx * o.nx + s.nz * o.nz < 0.98) continue;
          if (Math.abs((o.x - s.x) * s.nx + (o.z - s.z) * s.nz) > 0.3) continue;
          const u0 = (o.x - s.x) * s.ux + (o.z - s.z) * s.uz, u1 = u0 + o.width * (o.ux * s.ux + o.uz * s.uz);
          if (Math.min(s.width, Math.max(u0, u1)) - Math.max(0, Math.min(u0, u1)) > 0.3) { clash = true; break; }
        }
      }
    }
    if (clash) { dropped++; continue; }
    kept.push(s);
    const key = cx + ',' + cz;
    if (!frontCells.has(key)) frontCells.set(key, []);
    frontCells.get(key).push(s);
  }
  for (const s of kept) {
    let set = wallsByRecord.get(s.record);
    if (!set) wallsByRecord.set(s.record, (set = new Set()));
    set.add(s.wall);
  }
  return { shops: kept, wallsByRecord, unplaced, dropped };
}

// The proportions that decide how far a front stands out from its wall, drawn from their own random sequence so the
// colliders (built for every shop at load) match the parts (built when the camera comes near)
// Shops whose doors often sit back in an alcove between forward display windows
const ALCOVE_TYPES = new Set(['restaurant', 'bar', 'cafe', 'books', 'bakery', 'florist', 'barber', 'sushi', 'latin', 'pizza', 'liquor',
  'hardware', 'boutique', 'luxury', 'shoes', 'jewelry']);
function shopLayout(shop, types) {
  let h = Math.floor(shop.seed * 2147483646) + 1;
  const r = () => { h = (h * 16807) % 2147483647; return (h - 1) / 2147483646; };
  const W = shop.width;
  const pw = Math.min(0.32 + r() * 0.22, W * 0.12);
  const pd = 0.16 + r() * 0.12;
  const Wo = W - 2 * pw;
  const alcove = Wo >= 4.4 && r() < (ALCOVE_TYPES.has(types[shop.type].id) ? 0.4 : 0.15);
  const a = alcove ? 0.42 + r() * 0.25 : 0;
  const gz = alcove ? a : 0.07;
  const front = gz + 0.08;
  return { pw, pd, alcove, a, gz, front, depth: Math.max(pd, front + 0.04) };
}

// Solid fronts: an oriented box per shop, the width of its frontage and as deep as its piers stand out
function shopColliders(shops, types) {
  return shops.map((shop) => {
    const { depth } = shopLayout(shop, types);
    const top = (shop.record.floorHeight || 3.6) - 0.06;
    const cx = shop.x + shop.ux * shop.width / 2 + shop.nx * depth / 2, cz = shop.z + shop.uz * shop.width / 2 + shop.nz * depth / 2;
    const hx = shop.width / 2, hz = depth / 2;
    const ex = Math.abs(shop.ux) * hx + Math.abs(shop.nx) * hz, ez = Math.abs(shop.uz) * hx + Math.abs(shop.nz) * hz;
    return { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: 0, maxY: top,
      obb: { cx, cz, cs: shop.ux, sn: -shop.uz, hx, hz }, storefront: true };
  });
}

export { planStorefronts, wallKey, shopLayout, shopColliders, PREFERRED_WIDTH, MIN_WIDTH };
