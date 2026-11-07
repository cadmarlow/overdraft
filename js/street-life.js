import { districtAt } from './city-config.js';
import { zoneOf, ZONE, slotHash as hash } from './parking-plan.js';
import { SHOP_TYPES, shopOpenAt } from './storefront-types.js';
import { PROP } from './pedestrians.js';

// People with somewhere to be. On top of the walking crowd (pedestrian-system.js) this module gives the street its
// reasons: the crowd thickens and thins by district and hour (rush hours, nightlife, dead Financial District at night);
// passers-by stop at the places the street offers (a bench, a café chair, a newsstand counter, a shop window, a food
// cart, the queue at a bus stop) and go back on their way; shops breathe people in and out of their doors according to
// their hours, with a coffee or a shopping bag in hand; the subway stairs let out a burst of commuters now and then;
// buses pull in at their stops and the queue boards while others get off; someone hails a cab and the next free one
// stops; delivery vans double-park with their hazards on while the driver unloads.

const CELL = 24;
const TICK = 0.2;
const NEAR = 120; // anchors are only considered this close to the camera
const WINDOW_TYPES = new Set(['boutique', 'luxury', 'jewelry', 'shoes', 'books', 'gallery', 'phones', 'florist', 'bakery', 'souvenir', 'pharmacy']);
const COFFEE_TYPES = new Set(['cafe', 'juice', 'diner', 'bakery', 'bodega']);
const BAG_TYPES = new Set(['bodega', 'pharmacy', 'liquor', 'boutique', 'shoes', 'books', 'hardware', 'souvenir', 'luxury', 'florist']);
const NIGHTLIFE = new Set(['village', 'west_village', 'east_village', 'lower_east_side', 'chelsea', 'meatpacking', 'soho', 'hells_kitchen', 'little_italy', 'nomad', 'flatiron']);
// How often a door lets someone out (people per second, when open and the camera is near), by shop type
const DOOR_RATE = { bodega: 0.07, cafe: 0.08, bakery: 0.06, pizza: 0.06, takeout: 0.05, sushi: 0.03, latin: 0.04, restaurant: 0.04, bar: 0.06, diner: 0.05,
  juice: 0.04, laundromat: 0.015, cleaners: 0.015, barber: 0.015, salon: 0.015, pharmacy: 0.05, bank: 0.04, boutique: 0.03, luxury: 0.02, jewelry: 0.01,
  phones: 0.025, hardware: 0.02, florist: 0.015, liquor: 0.03, books: 0.02, office: 0.05, souvenir: 0.03, shoes: 0.02, gallery: 0.01 };

function createStreetLife({ pedestrians, traffic, shops = [], subwayMouths = [], foodCarts = [], seats = [], stands = [], busStops = [], hourOf = () => 12 }) {
  const peds = pedestrians.peds;
  const typesById = Object.fromEntries(SHOP_TYPES.map((t) => [t.id, t]));

  // ---- Anchors: spots to stop at, doors to come and go through ---------------------------------------------------------
  const anchors = [];
  const cells = new Map();
  const key = (x, z) => Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
  const add = (a) => {
    a.busy = 0;
    a.cooldown = 0;
    a.due = 0;
    anchors.push(a);
    const k = key(a.x, a.z);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(a);
    return a;
  };
  for (const s of seats) add({ kind: 'seat', x: s.x, z: s.z, yaw: s.yaw, seat: s, group: s.group || null, sub: s.kind });
  for (const s of stands) add({ kind: s.kind, x: s.x, z: s.z, yaw: s.yaw, group: s.group || null });
  for (const shop of shops) {
    // storefront-plan.js keeps the type as its index in SHOP_TYPES
    const type = typeof shop.type === 'number' ? SHOP_TYPES[shop.type] : typesById[shop.type];
    if (!type || type.id === 'vacant') continue;
    const mx = shop.x + shop.ux * shop.width / 2, mz = shop.z + shop.uz * shop.width / 2;
    // the door, a step out onto the sidewalk; a window to look into for the shops that dress theirs
    add({ kind: 'door', x: mx + shop.nx * 0.75, z: mz + shop.nz * 0.75, yaw: Math.atan2(shop.nx, shop.nz), type, shop, rate: DOOR_RATE[type.id] || 0.02 });
    if (WINDOW_TYPES.has(type.id) && shop.width >= 4) {
      const wx = shop.x + shop.ux * shop.width * 0.3, wz = shop.z + shop.uz * shop.width * 0.3;
      add({ kind: 'window', x: wx + shop.nx * 1.05, z: wz + shop.nz * 1.05, yaw: Math.atan2(-shop.nx, -shop.nz), type });
    }
  }
  for (const m of subwayMouths) add({ kind: 'subway', x: m.x, z: m.z, yaw: m.yaw });
  for (const c of foodCarts) {
    // customers queue on the sidewalk side of the cart: the side with ground that is walked on, found at first use
    add({ kind: 'cart', x: c.x, z: c.z, yaw: 0, cart: true, spots: null });
  }
  const near = (x, z, r, fn) => {
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        const list = cells.get(ix * 100003 + iz);
        if (list) for (const a of list) if ((a.x - x) ** 2 + (a.z - z) ** 2 <= r * r && fn(a) === true) return;
      }
    }
  };

  // ---- Density by district and hour ---------------------------------------------------------------------------------------
  function densityAt(x, z, hour) {
    const district = districtAt(x, z);
    const zone = zoneOf(district);
    const night = hour < 5.5 ? 1 : hour < 8 ? 1 - (hour - 5.5) / 2.5 : hour < 19.5 ? 0 : hour < 23 ? (hour - 19.5) / 3.5 : 1;
    let f;
    if (district === 'central_park') f = 0.45 - 0.3 * night;
    else if (zone === ZONE.business) f = 0.95 - 0.7 * night;
    else if (zone === ZONE.residential) f = 0.6 - 0.3 * night;
    else f = 0.72 - 0.35 * night;
    if (NIGHTLIFE.has(district) && (hour >= 20 || hour < 2.5)) f = Math.max(f, hour < 2.5 ? 0.6 : 0.9);
    const rush = (hour > 7.8 && hour < 9.6) || (hour > 16.8 && hour < 19.2);
    if (rush && zone !== ZONE.residential) f += 0.15;
    return Math.min(1, Math.max(0.15, f));
  }

  // ---- Activities -------------------------------------------------------------------------------------------------------
  let clock = 0;
  const started = { seat: 0, busstop: 0, counter: 0, window: 0, cart: 0, door: 0, exits: 0, subway: 0, boarded: 0, alighted: 0, hails: 0, fares: 0, deliveries: 0 };
  const release = (a) => (p, cancelled) => {
    a.busy = Math.max(0, a.busy - 1);
    a.cooldown = clock + (cancelled ? 2 : 6 + Math.random() * 20);
  };
  function startActivity(p, a, extra = {}) {
    const act = {
      kind: a.kind, phase: 'approach', x: a.x, z: a.z, heading: a.yaw, duration: 10, carry: undefined, seat: null, look: null,
      until: clock + 14, onDone: release(a), anchor: a, ...extra
    };
    a.busy++;
    p.activity = act;
    started[a.kind] = (started[a.kind] || 0) + 1;
    return act;
  }
  function tryAnchor(p, a, hour, zone) {
    if (a.busy || clock < a.cooldown) return false;
    const r = Math.random();
    switch (a.kind) {
      case 'seat': {
        if (a.sub === 'shelter' && a.group && !(hour > 6 && hour < 23.5)) return false;
        if (r > (a.sub === 'cafe' ? 0.3 : 0.22)) return false;
        const t = Math.random();
        startActivity(p, a, { duration: 25 + Math.random() * 50, seat: a.seat, carry: t < 0.3 ? PROP.PHONE : t < 0.55 ? PROP.COFFEE : -1 });
        return true;
      }
      case 'busstop': {
        if (!(hour > 5.5 && hour < 24) || r > 0.5) return false;
        const stop = a.group;
        const e = stop?.edge;
        const look = e ? { x: a.x - e.dx * 25, z: a.z - e.dz * 25 } : null; // up the street, where the bus comes from
        startActivity(p, a, { duration: 45 + Math.random() * 80, look, carry: Math.random() < 0.3 ? PROP.PHONE : undefined });
        return true;
      }
      case 'counter': {
        if (!(hour > 6 && hour < 22) || r > 0.3) return false;
        startActivity(p, a, { duration: 8 + Math.random() * 14 });
        return true;
      }
      case 'window': {
        if (!shopOpenAt(a.type, hour) || r > 0.26) return false;
        startActivity(p, a, { duration: 6 + Math.random() * 12 });
        return true;
      }
      case 'cart': {
        const lunch = hour > 11 && hour < 14.5;
        if (!(hour > 7 && hour < 20) || r > (lunch ? 0.5 : 0.2)) return false;
        if (!a.spots) cartSpots(a);
        const spot = a.spots.find((s) => !s.busy);
        if (!spot) return false;
        spot.busy = true;
        const act = startActivity(p, { ...a, x: spot.x, z: spot.z, yaw: spot.yaw, busy: 0, cooldown: 0 }, { duration: 10 + Math.random() * 16 });
        act.onDone = (q, cancelled) => { spot.busy = false; a.cooldown = clock + (cancelled ? 2 : 3); };
        a.busy = 0;
        return true;
      }
      case 'door': {
        if (!shopOpenAt(a.type, hour) || r > 0.16) return false;
        // into the shop and gone; the door stays free for the next
        const act = startActivity(p, a, { phase: 'enter', until: clock + 10 });
        act.onDone = (q) => { a.busy = 0; a.cooldown = clock + 3; };
        started.door++;
        return true;
      }
      default:
        return false;
    }
  }
  // Two queue spots in front of a cart, on the walked side: the side where a pedestrian stands when first asked
  function cartSpots(a, from = null) {
    const p = from;
    const dx = p ? p.x - a.x : 1, dz = p ? p.z - a.z : 0, d = Math.hypot(dx, dz) || 1;
    const nx = dx / d, nz = dz / d;
    a.spots = [{ x: a.x + nx * 1.4 - nz * 0.45, z: a.z + nz * 1.4 + nx * 0.45, yaw: Math.atan2(-nx, -nz), busy: false },
      { x: a.x + nx * 1.5 + nz * 0.55, z: a.z + nz * 1.5 - nx * 0.55, yaw: Math.atan2(-nx, -nz), busy: false }];
  }

  // Someone coming out of a door (or up the subway stairs), onto the sidewalk and away
  function exitThrough(a, carry = -1, offset = 0) {
    const p = peds.find((q) => !q.placed);
    if (!p) return false;
    const ox = Math.cos(a.yaw) * offset, oz = -Math.sin(a.yaw) * offset;
    if (!pedestrians.placeAt(p, a.x + ox, a.z + oz, 10)) return false;
    p.activity = { kind: 'exit', phase: 'return', x: p.x, z: p.z, heading: a.yaw, moveHeading: a.yaw, carry: carry >= 0 ? carry : undefined, until: clock + 12, anchor: a };
    started.exits++;
    return true;
  }
  function carryFrom(type) {
    const r = Math.random();
    if (COFFEE_TYPES.has(type.id) && r < 0.45) return PROP.COFFEE;
    if (BAG_TYPES.has(type.id) && r < 0.6) return PROP.BAG;
    return r < 0.15 ? PROP.PHONE : -1;
  }

  // ---- Buses, cabs, deliveries ---------------------------------------------------------------------------------------
  traffic.setBusStops?.(busStops);
  const busDoor = (v, lz) => ({ x: v.x + Math.cos(v.yaw) * -1.3 + Math.sin(v.yaw) * lz, z: v.z - Math.sin(v.yaw) * -1.3 + Math.cos(v.yaw) * lz });
  function serveBuses() {
    for (const stop of busStops) {
      const v = stop.bus;
      if (!v || v.serving !== stop) { stop.alighted = false; stop.bus = v && v.serving === stop ? v : null; continue; }
      const dwelling = v.stopAt >= 0 && v.speed < 0.3 && Math.abs(v.s - v.stopAt) < 2.5;
      if (!dwelling) continue;
      // the queue boards through the front door
      for (const p of peds) {
        const a = p.activity;
        if (!p.placed || !a || a.kind !== 'busstop' || a.anchor?.group !== stop || a.phase !== 'hold') continue;
        const door = busDoor(v, 4.3);
        Object.assign(a, { phase: 'enter', x: door.x, z: door.z, until: clock + 9 });
        started.boarded++;
      }
      // a few get off at the back
      if (!stop.alighted) {
        stop.alighted = true;
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const p = peds.find((q) => !q.placed);
          if (!p) break;
          const door = busDoor(v, -1.6 - i * 0.7);
          if (!pedestrians.placeAt(p, door.x, door.z, 12)) break;
          p.activity = { kind: 'exit', phase: 'return', x: p.x, z: p.z, heading: v.yaw, moveHeading: v.yaw + Math.PI / 2, carry: undefined, until: clock + 14 };
          started.alighted++;
        }
      }
    }
  }
  const hails = traffic.hails || [];
  function hailCab(p, camera, hour, zone) {
    if (hails.length >= 2 || !(hour > 6.5 || hour < 2)) return false;
    const e = p.route?.edge;
    if (!e || e.axis !== 'ave' || Math.random() > (zone === ZONE.residential ? 0.15 : 0.4)) return false;
    const o = (p.x - e.sx) * e.rx + (p.z - e.sz) * e.rz;
    if (o <= 0) return false; // the cab stops along its right curb
    const nx = e.rx, nz = e.rz;
    const s = (p.x - e.sx) * e.dx + (p.z - e.sz) * e.dz;
    if (s < 12 || s > e.len - 12) return false;
    const x = e.sx + e.dx * s + nx * (e.half + 0.45), z = e.sz + e.dz * s + nz * (e.half + 0.45);
    const hail = { edge: e, s, ped: p, taxi: null, x, z };
    hails.push(hail);
    const anchor = { kind: 'hail', x, z, yaw: Math.atan2(-nx, -nz), busy: 0, cooldown: 0 };
    const act = startActivity(p, anchor, { duration: 70, look: { x: x - e.dx * 30, z: z - e.dz * 30 }, hail });
    act.onDone = () => { const i = hails.indexOf(hail); if (i >= 0) hails.splice(i, 1); };
    started.hails++;
    return true;
  }
  function serveCabs() {
    for (const h of hails) {
      const v = h.taxi, p = h.ped, a = p.activity;
      if (!v || !a || a.hail !== h) continue;
      if (!v.edge || v.serving !== h) { h.taxi = null; continue; }
      if (v.stopAt >= 0 && v.speed < 0.3 && Math.abs(v.s - v.stopAt) < 2.5 && a.phase === 'hold') {
        const door = { x: v.x + Math.cos(v.yaw) * -0.95 + Math.sin(v.yaw) * -0.6, z: v.z - Math.sin(v.yaw) * -0.95 + Math.cos(v.yaw) * -0.6 };
        Object.assign(a, { phase: 'enter', x: door.x, z: door.z, until: clock + 6 });
        started.fares++;
      }
    }
  }
  const deliveries = [];
  function startDelivery(camera) {
    if (deliveries.length >= 2) return;
    const cx = camera.position.x, cz = camera.position.z;
    for (const v of traffic.cars) {
      if (!v.edge || v.conn || (v.bodyType !== 'van' && v.bodyType !== 'delivery') || v.stopAt >= 0 || v.isPolice) continue;
      if (v.lane !== v.edge.lanes.length - 1 || !(v.edge.park?.r !== null && v.edge.park?.r !== undefined)) continue;
      const d = Math.hypot(v.x - cx, v.z - cz);
      if (d < 35 || d > 130 || Math.random() > 0.5) continue;
      if (!traffic.requestStop(v, 22 + Math.random() * 16)) continue;
      deliveries.push({ v, ped: null, serial: v.serial });
      started.deliveries++;
      return;
    }
  }
  function serveDeliveries() {
    for (let i = deliveries.length - 1; i >= 0; i--) {
      const d = deliveries[i], v = d.v;
      const over = !v.edge || v.serial !== d.serial || v.stopAt < 0;
      if (over) {
        if (d.ped?.activity) { d.ped.activity.release = true; d.ped.activity.leave = 'vanish'; }
        deliveries.splice(i, 1);
        continue;
      }
      if (!d.ped && v.speed < 0.3 && Math.abs(v.s - v.stopAt) < 2.5) {
        const p = peds.find((q) => !q.placed);
        if (!p) continue;
        const rear = { x: v.x + Math.cos(v.yaw) * -1.6 + Math.sin(v.yaw) * -3.4, z: v.z - Math.sin(v.yaw) * -1.6 + Math.cos(v.yaw) * -3.4 };
        if (!pedestrians.placeAt(p, rear.x, rear.z, 12)) continue;
        d.ped = p;
        p.activity = { kind: 'deliver', phase: 'hold', x: rear.x, z: rear.z, heading: v.yaw, moveHeading: v.yaw, carry: PROP.BAG, duration: v.dwell, until: clock + v.dwell, leave: 'vanish' };
      }
    }
  }

  // ---- Per frame ---------------------------------------------------------------------------------------------------------
  let tickAt = 0, slowAt = 0, cursor = 0;
  function update(dt, camera) {
    clock = traffic.clock ?? clock + dt;
    const hour = hourOf();
    const cx = camera.position.x, cz = camera.position.z;
    if (clock >= slowAt) {
      slowAt = clock + 1;
      pedestrians.setDensity(densityAt(cx, cz, hour));
      serveBuses();
      startDelivery(camera);
    }
    serveCabs();
    serveDeliveries();
    if (clock < tickAt) return;
    tickAt = clock + TICK;
    const zone = zoneOf(districtAt(cx, cz));
    // 1. a slice of the walkers each tick: anyone passing a free spot may stop there
    const n = peds.length, slice = Math.ceil(n / 4);
    for (let k = 0; k < slice; k++) {
      const p = peds[(cursor + k) % n];
      if (!p.placed || p.dead || p.activity || p.node || !p.route?.edge || p.pause > 0 || p.conversation || p.v < 0.4 || clock < p.panicUntil) continue;
      const dx = p.x - cx, dz = p.z - cz;
      if (dx * dx + dz * dz > NEAR * NEAR) continue;
      let taken = false;
      near(p.x, p.z, 3.4, (a) => {
        if (a.kind === 'subway') return false;
        if (a.kind === 'cart' && !a.spots) cartSpots(a, p);
        if (tryAnchor(p, a, hour, zone)) { taken = true; return true; }
        return false;
      });
      if (!taken && Math.random() < 0.004) hailCab(p, camera, hour, zone);
    }
    cursor = (cursor + slice) % n;
    // 2. doors and stairs near the camera let people out
    let placed = 0;
    for (const p of peds) if (p.placed) placed++;
    const room = placed < pedestrians.NUM_PEDS * pedestrians.density + 12;
    if (room) {
      near(cx, cz, 110, (a) => {
        if (a.kind === 'door') {
          if (!shopOpenAt(a.type, hour)) return false;
          const meal = (a.type.id === 'restaurant' || a.type.id === 'sushi' || a.type.id === 'latin' || a.type.id === 'pizza') && ((hour > 11.5 && hour < 14.5) || (hour > 18.5 && hour < 22));
          const morning = COFFEE_TYPES.has(a.type.id) && hour > 7 && hour < 10.5;
          a.due += TICK * a.rate * (meal || morning ? 2.2 : 1) * (a.type.id === 'office' && !(hour > 7.5 && hour < 19) ? 0 : 1);
          if (a.due >= 1) { a.due -= 1; if (exitThrough(a, carryFrom(a.type))) a.cooldown = clock + 2; }
        } else if (a.kind === 'subway') {
          const rush = (hour > 7.5 && hour < 9.8) || (hour > 16.5 && hour < 19.5);
          a.due += TICK * (hour < 5.5 ? 0.004 : rush ? 0.05 : 0.022);
          if (a.due >= 1) {
            a.due -= 1;
            const burst = rush ? 4 + Math.floor(Math.random() * 4) : 2 + Math.floor(Math.random() * 3);
            for (let i = 0; i < burst; i++) if (!exitThrough(a, Math.random() < 0.3 ? PROP.PHONE : -1, (i - burst / 2) * 0.55)) break;
            started.subway++;
          }
        }
        return false;
      });
    }
  }

  // Everyone walking within reach turns to look at (x, z) for a while, phones out: a crash, an open hydrant, a fight
  function gather(x, z, n = 5, duration = 18, radius = 16) {
    let count = 0;
    for (const p of peds) {
      if (count >= n) break;
      if (!p.placed || p.dead || p.activity || p.node || !p.route?.edge || clock < p.panicUntil || p.conversation) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > radius || d < 3.5) continue;
      const anchor = { kind: 'gather', x: p.x, z: p.z, yaw: Math.atan2(x - p.x, z - p.z), busy: 0, cooldown: 0 };
      const act = startActivity(p, anchor, { duration: duration * (0.7 + Math.random() * 0.6), look: { x, z }, carry: Math.random() < 0.6 ? PROP.PHONE : undefined });
      act.phase = 'hold';
      act.until = clock + act.duration;
      count++;
    }
    return count;
  }
  // The nearest open shop of these kinds within r (for the sounds that leak out of a door): its distance, or Infinity
  function nearestOpen(ids, x, z, r, hour = hourOf()) {
    let best = Infinity;
    near(x, z, r, (a) => {
      if (a.kind !== 'door' || !ids.has(a.type.id) || !shopOpenAt(a.type, hour)) return false;
      best = Math.min(best, Math.hypot(a.x - x, a.z - z));
      return false;
    });
    return best;
  }

  const stats = () => {
    let active = 0, holding = 0, placed = 0;
    for (const p of peds) { if (p.placed) placed++; if (p.activity) { active++; if (p.activity.phase === 'hold') holding++; } }
    return { placed, active, holding, density: +pedestrians.density.toFixed(2), anchors: anchors.length, hails: hails.length, deliveries: deliveries.length, ...started };
  };
  return { update, anchors, stats, densityAt, gather, nearestOpen, near, get clock() { return clock; } };
}

export { createStreetLife };
