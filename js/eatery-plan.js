import { calibrePoint, calibreLocal, calibreBox, planRooms } from './calibre-plan.js';
import { SHOP_TYPES } from './storefront-types.js';

// The restaurants: where the branches of BULLION (burgers) and TRANCHE (pizza by the slice) go in the real buildings,
// and the plan of each. Pure data and geometry, shared by the architecture (eatery-room.js), the people
// (eatery-cast.js), the game (eatery.js), the collisions and the tests. The rooms are carved out of ground floors the
// way CALIBRE's are (calibre-plan.js: same frame, same carving).
//
// Local frame of a site: x along the facade (to the right when entering), z out of the building (the street is +z),
// origin on the facade line in the middle of the front. Heights are above the room's floor.
//
//   BULLION, 10.4 x 15 m                               TRANCHE, 6.4 x 12.6 m
//   ┌─────────────────────────────┐ z = -14.8          ┌──────────────────┐ z = -12.4
//   │ shelves · cold room         │                    │ ▭ table    table │
//   │   cook       cook           │                    │ fridge     table │
//   │ ▓griddle▓ dress ▓fryers▓    │ z = -11.15         ├──gate──┐         │ z = -7.6
//   │   runner                    │                    │ boxes  ║ counter │
//   │ till  till   pickup │g│soda │ z = -9             │ oven   ║ till    │
//   │         queue               │                    │ oven   ║         │ ledge
//   │ booth        kiosk    table │                    │ prep   ║ pies    │ and
//   │ booth        kiosk    table │                    │        ║ pies    │ stools
//   │ booth                 table │                    │ dough  ║ pies    │
//   │ ledge + stools   ▯   bins   │                    │ bench hatch│   ▯  │
//   └───────────── door ──────────┘ z = 0              └────────────door──┘ z = 0

const BULLION = Object.freeze({ id: 'bullion', width: 10.4, depth: 15.0, height: 3.8, floor: 0.24, door: 2.0, entry: 0, count: 36, spacing: 330 });
const TRANCHE = Object.freeze({ id: 'tranche', width: 6.4, depth: 12.6, height: 3.8, floor: 0.24, door: 1.4, entry: 1.6, count: 54, spacing: 240 });
const SPECS = Object.freeze({ bullion: BULLION, tranche: TRANCHE });

// ---- BULLION ---------------------------------------------------------------------------------------------------------

const BULLION_PLAN = Object.freeze({
  half: 5.0, ceiling: 3.44, back: -14.8,
  door: { x0: -1.0, x1: 1.0, h: 2.5 },
  counter: { x0: -5.0, x1: 2.6, z: -9.0, depth: 0.7, h: 1.08 },
  gate: { x0: 2.6, x1: 3.5, z: -9.0, h: 1.0 },
  fountain: { x0: 3.5, x1: 5.0, z: -9.0, depth: 0.7, h: 0.92, top: 1.78 },
  tills: [-3.7, -2.0],
  pickup: 1.45,
  // the kitchen's island, facing the room: the griddle, the dressing station with its chute, the fryers
  island: { x0: -4.3, x1: 1.9, z: -11.15, depth: 0.85, h: 0.9 },
  griddle: { x0: -4.2, x1: -1.9 }, dress: { x0: -1.8, x1: -0.1 }, fryers: { x0: 0.0, x1: 1.8 },
  hood: { x0: -4.4, x1: 2.0, z0: -10.6, z1: -11.8, y0: 2.12, y1: 2.7 },
  shelves: { x0: -4.9, x1: 2.4, z: -14.5, depth: 0.6, h: 2.1 },
  coldRoom: { x0: 2.9, x1: 4.3 },
  sink: { x: 4.6, z: -12.3, w: 0.7, d: 1.3, h: 0.9 },
  booths: [-1.9, -3.9, -5.9],
  booth: { x0: -4.98, x1: -3.72, bench: 0.48, offset: 0.62, seat: 0.45, back: 1.12, table: { x0: -4.96, x1: -3.86, d: 0.66, h: 0.74 } },
  ledge: { x0: -3.62, x1: -1.35, z: -0.42, depth: 0.4, h: 1.05 },
  stools: [-3.1, -2.1],
  tables: [-2.9, -4.9, -6.9],
  table: { x: 3.95, size: 0.7, h: 0.74, chair: 0.66, seat: 0.46 },
  kiosks: [{ x: 1.9, z: -2.7 }, { x: 1.9, z: -3.7 }],
  kiosk: { w: 0.36, d: 0.62, h: 1.75 },
  trash: { x: 4.68, z: -1.05, w: 0.6, d: 1.1, h: 1.22 },
  menu: { y0: 2.36, y1: 3.2, z: -8.7 }
});

// ---- TRANCHE ---------------------------------------------------------------------------------------------------------

const TRANCHE_PLAN = Object.freeze({
  half: 3.0, ceiling: 3.3, back: -12.4,
  door: { x0: 0.9, x1: 2.3, h: 2.4 },
  window: { x0: -2.9, x1: 0.55, sill: 0.95, head: 2.5 },
  hatch: { x0: -1.5, x1: -0.5, z0: -0.1, z1: -0.55, h: 1.05 },
  bench: { x0: -2.96, x1: -1.6, z0: -0.18, z1: -0.95, h: 0.92 },
  counter: { x0: -0.5, x1: 0.3, z0: -0.2, z1: -7.0, h: 1.05 },
  display: { z0: -0.35, z1: -4.45, top: 1.5, pies: [-0.75, -1.37, -1.99, -2.61, -3.23, -3.85] },
  till: -5.1, pickup: -6.1,
  prep: { x0: -2.98, x1: -2.2, z0: -2.3, z1: -3.6, h: 0.9 },
  oven: { x0: -2.98, x1: -1.7, z0: -3.9, z1: -6.6, h: 1.95, mouths: [{ z: -4.6, y: 1.18 }, { z: -5.9, y: 1.18 }] },
  boxes: { x0: -2.98, x1: -2.3, z0: -6.8, z1: -7.55, h: 1.9 },
  partition: { z: -7.6, x0: -3.0, x1: -1.6, h: 1.1 },
  gate: { x0: -1.6, x1: -0.5, z: -7.3, h: 1.0 },
  ledge: { x0: 2.64, x1: 2.98, z0: -1.7, z1: -6.5, h: 1.05 },
  stools: [-2.3, -3.4, -4.5, -5.6],
  stool: { x: 2.28, seat: 0.76 },
  standing: [-2.85, -3.95, -5.05],
  tables: [{ x: 1.95, z: -8.9 }, { x: 1.95, z: -10.8 }, { x: -1.75, z: -10.6 }],
  table: { size: 0.66, h: 0.74, chair: 0.62, seat: 0.46 },
  fridge: { x0: -2.98, x1: -2.3, z0: -8.2, z1: -9.1, h: 2.0 },
  trash: { x: 2.66, z: -7.3, r: 0.26, h: 0.86 },
  staffDoor: { x0: 0.1, x1: 1.0 }
});

const PLANS = Object.freeze({ bullion: BULLION_PLAN, tranche: TRANCHE_PLAN });

// ---- Seats: where a customer (or the player) sits: { id, x, z, face [lx, lz], h (seat height), kind, tray { x, z, h }
// (where the tray or the plate lies), from { x, z } (where one stands before sitting down) } ---------------------------

function seatsOf(brand) {
  const seats = [];
  const add = (seat) => { seat.id = `${brand}-${seats.length}`; seat.brand = brand; seats.push(seat); };
  if (brand === 'bullion') {
    const P = BULLION_PLAN, B = P.booth;
    P.booths.forEach((z, k) => {
      for (const side of [1, -1]) for (const x of [-4.64, -4.02]) {
        add({ x, z: z + side * B.offset, face: [0, -side], h: B.seat, kind: 'booth', group: `booth${k}`, tray: { x, z: z + side * 0.17, h: B.table.h }, from: { x: -3.3, z: z + side * B.offset } });
      }
    });
    for (const x of P.stools) add({ x, z: -0.98, face: [0, 1], h: 0.76, kind: 'stool', group: 'ledge', tray: { x, z: P.ledge.z, h: P.ledge.h }, from: { x, z: -1.5 } });
    P.tables.forEach((z, k) => {
      for (const side of [1, -1]) add({ x: P.table.x, z: z + side * P.table.chair, face: [0, -side], h: P.table.seat, kind: 'chair', group: `table${k}`, tray: { x: P.table.x, z: z + side * 0.17, h: P.table.h }, from: { x: 3.2, z: z + side * P.table.chair } });
    });
  } else {
    const P = TRANCHE_PLAN;
    for (const z of P.stools) add({ x: P.stool.x, z, face: [1, 0], h: P.stool.seat, kind: 'stool', group: 'ledge', tray: { x: 2.81, z, h: P.ledge.h }, from: { x: 1.75, z } });
    for (const z of P.standing) add({ x: 2.3, z, face: [1, 0], h: 0, kind: 'stand', group: 'ledge', tray: { x: 2.81, z, h: P.ledge.h }, from: { x: 1.75, z } });
    P.tables.forEach((t, k) => {
      for (const side of [1, -1]) add({ x: t.x, z: t.z + side * P.table.chair, face: [0, -side], h: P.table.seat, kind: 'chair', group: `table${k}`, tray: { x: t.x, z: t.z + side * 0.16, h: P.table.h }, from: { x: t.x > 0 ? 1.25 : -0.95, z: t.z + side * P.table.chair } });
    });
  }
  return seats;
}
const SEATS = Object.freeze({ bullion: Object.freeze(seatsOf('bullion')), tranche: Object.freeze(seatsOf('tranche')) });

// ---- Spots: where people stand to do things: { x, z, face [lx, lz] } --------------------------------------------------

const SPOTS = Object.freeze({
  bullion: Object.freeze({
    out: { x: 0, z: 2.2, face: [0, -1] },
    order: BULLION_PLAN.tills.map((x) => ({ x, z: -8.12, face: [0, -1] })),
    queue: [{ x: -0.9, z: -7.5 }, { x: -0.78, z: -6.72 }, { x: -0.68, z: -5.94 }, { x: -0.6, z: -5.16 }, { x: -0.54, z: -4.38 }, { x: -0.5, z: -3.6 }].map((p) => ({ ...p, face: [0, -1] })),
    pickup: { x: BULLION_PLAN.pickup, z: -8.12, face: [0, -1] },
    wait: [{ x: 0.55, z: -7.7 }, { x: 2.35, z: -7.75 }, { x: 1.05, z: -6.9 }, { x: 2.0, z: -6.85 }, { x: 1.55, z: -6.2 }].map((p) => ({ ...p, face: [0, -1] })),
    fountain: { x: 4.25, z: -8.12, face: [0, -1] },
    trash: { x: 4.0, z: -1.05, face: [1, 0] },
    kiosks: BULLION_PLAN.kiosks.map((k) => ({ x: 1.12, z: k.z, face: [1, 0] })),
    board: [{ x: 0.9, z: -5.4 }, { x: -1.9, z: -5.0 }, { x: 0.2, z: -4.2 }].map((p) => ({ ...p, face: [0, -1] })), // reading the menu boards
    // the crew
    cashiers: BULLION_PLAN.tills.map((x) => ({ x, z: -9.78, face: [0, 1] })),
    runner: { x: 0.25, z: -10.2, face: [0, -1] }, // at the chute, back to the room
    handover: { x: BULLION_PLAN.pickup, z: -9.78, face: [0, 1] },
    grill: { x: -3.05, z: -12.1, face: [0, 1] },
    fry: { x: 0.9, z: -12.1, face: [0, 1] },
    closet: { x: 4.1, z: -10.3, face: [1, 0] } // the attendant's mop and bucket
  }),
  tranche: Object.freeze({
    out: { x: 1.6, z: 2.2, face: [0, -1] },
    order: [{ x: 0.86, z: TRANCHE_PLAN.till, face: [-1, 0] }],
    queue: [{ x: 0.86, z: -4.25 }, { x: 0.86, z: -3.4 }, { x: 0.88, z: -2.55 }, { x: 0.95, z: -1.7 }].map((p) => ({ ...p, face: [0, -1] })),
    pickup: { x: 0.86, z: TRANCHE_PLAN.pickup, face: [-1, 0] },
    wait: [{ x: 0.92, z: -6.75 }, { x: 1.5, z: -7.15 }].map((p) => ({ ...p, face: [-1, 0] })),
    trash: { x: 2.2, z: -7.3, face: [1, 0] },
    fridge: { x: -1.75, z: -8.65, face: [-1, 0] },
    window: { x: -1.0, z: 0.85, face: [0, -1] }, // on the sidewalk, at the hatch
    board: [{ x: 1.2, z: -2.2 }, { x: 1.3, z: -3.3 }].map((p) => ({ ...p, face: [-1, 0] })),
    // the crew
    cashiers: [{ x: -1.05, z: TRANCHE_PLAN.till, face: [1, 0] }],
    handover: { x: -1.05, z: TRANCHE_PLAN.pickup, face: [1, 0] },
    hatch: { x: -1.0, z: -1.08, face: [0, 1] },
    reheat: { x: -1.18, z: -4.6, face: [-1, 0] },
    dough: { x: -2.25, z: -1.5, face: [0, 1] },
    topping: { x: -1.75, z: -2.95, face: [-1, 0] },
    oven: { x: -1.18, z: -5.9, face: [-1, 0] },
    display: { x: -1.05, z: -2.3, face: [1, 0] }
  })
});

// ---- Ways: the lines people walk along. Nodes and the pairs that are joined; any point reaches the graph at the
// closest point of an edge. `staff: true` edges are behind the counter. ----------------------------------------------

const WAYS = Object.freeze({
  bullion: {
    nodes: { out: [0, 2.2], door: [0, -0.5], hub: [0.4, -1.5], fl: [-3.3, -1.5], fr: [3.0, -1.5], tr: [3.95, -1.5],
      bl: [-3.3, -7.6], bc: [0.4, -7.6], br: [3.0, -7.6], fo: [4.25, -7.6],
      gate: [3.05, -8.2], kg: [3.05, -10.1], kl: [-3.7, -10.1], kc: [0.25, -10.1], kb: [3.05, -12.5], cl: [-3.05, -12.5], cr: [0.9, -12.5] },
    edges: [['out', 'door'], ['door', 'hub'], ['hub', 'fl'], ['hub', 'fr'], ['fr', 'tr'], ['fl', 'bl'], ['hub', 'bc'], ['fr', 'br'], ['bl', 'bc'], ['bc', 'br'], ['br', 'fo'],
      ['br', 'gate'], ['gate', 'kg', true], ['kg', 'kc', true], ['kc', 'kl', true], ['kg', 'kb', true], ['kb', 'cr', true], ['cr', 'cl', true]]
  },
  tranche: {
    nodes: { out: [1.6, 2.2], door: [1.6, -0.5], a1: [1.25, -1.4], a2: [1.25, -7.4], a3: [1.25, -11.5], b1: [-0.6, -8.1], b2: [-0.95, -10.6], o2: [-1.0, 2.2], win: [-1.0, 0.85],
      s0: [-1.05, -1.1], s1: [-1.05, -6.7], p0: [-2.25, -1.5], p1: [-1.75, -2.95] },
    edges: [['out', 'door'], ['door', 'a1'], ['a1', 'a2'], ['a2', 'a3'], ['a2', 'b1'], ['b1', 'b2'], ['out', 'o2'], ['o2', 'win'],
      ['s0', 's1', true], ['s0', 'p0', true], ['p0', 'p1', true], ['p1', 's1', true]]
  }
});

const graphs = new Map();
function graphOf(brand) {
  let g = graphs.get(brand);
  if (g) return g;
  const W = WAYS[brand], names = Object.keys(W.nodes);
  g = { nodes: names.map((n) => ({ x: W.nodes[n][0], z: W.nodes[n][1] })), edges: W.edges.map(([a, b, staff]) => ({ a: names.indexOf(a), b: names.indexOf(b), staff: !!staff })) };
  graphs.set(brand, g);
  return g;
}

// The closest point of the graph to (x, z): { x, z, edge, t, d }
function nearestWay(brand, x, z, staff = null) {
  const g = graphOf(brand);
  let best = null;
  g.edges.forEach((e, i) => {
    if (staff !== null && e.staff !== staff) return;
    const a = g.nodes[e.a], b = g.nodes[e.b], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(px - x, pz - z);
    if (!best || d < best.d) best = { x: px, z: pz, edge: i, t, d };
  });
  return best;
}

/**
 * The way from one point of a room to another along its lines: a list of { x, z } ending at `to` (without `from`).
 * `staff`: true keeps to the lines behind the counter, false to the customers', null uses both (the attendant).
 */
function route(brand, from, to, staff = null) {
  const g = graphOf(brand), A = nearestWay(brand, from.x, from.z, staff), B = nearestWay(brand, to.x, to.z, staff);
  if (!A || !B) return [{ x: to.x, z: to.z }];
  const n = g.nodes.length, S = n, E = n + 1;
  const pos = [...g.nodes, { x: A.x, z: A.z }, { x: B.x, z: B.z }];
  const links = Array.from({ length: n + 2 }, () => []);
  const join = (i, j) => { const d = Math.hypot(pos[i].x - pos[j].x, pos[i].z - pos[j].z); links[i].push([j, d]); links[j].push([i, d]); };
  g.edges.forEach((e) => { if (staff === null || e.staff === staff) join(e.a, e.b); });
  const ea = g.edges[A.edge], eb = g.edges[B.edge];
  join(S, ea.a); join(S, ea.b); join(E, eb.a); join(E, eb.b);
  if (A.edge === B.edge) join(S, E);
  // Dijkstra over a dozen nodes
  const dist = new Array(n + 2).fill(Infinity), prev = new Array(n + 2).fill(-1), done = new Array(n + 2).fill(false);
  dist[S] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n + 2; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity || u === E) break;
    done[u] = true;
    for (const [v, d] of links[u]) if (dist[u] + d < dist[v]) { dist[v] = dist[u] + d; prev[v] = u; }
  }
  const path = [];
  if (dist[E] < Infinity) for (let u = E; u !== S && u >= 0; u = prev[u]) path.unshift({ x: pos[u].x, z: pos[u].z });
  if (A.d > 0.05) path.unshift({ x: A.x, z: A.z });
  // drop points that add nothing, then end exactly on the target
  const out = [];
  let last = from;
  for (const p of path) { if (Math.hypot(p.x - last.x, p.z - last.z) > 0.08) { out.push(p); last = p; } }
  if (!out.length || Math.hypot(to.x - last.x, to.z - last.z) > 0.03) out.push({ x: to.x, z: to.z });
  else out[out.length - 1] = { x: to.x, z: to.z };
  return out;
}

// ---- Placement in the city ---------------------------------------------------------------------------------------------

const typeId = (shop) => (typeof shop.type === 'number' ? SHOP_TYPES[shop.type]?.id : shop.type);
// Where the city already has a pizzeria (or a snack bar), the franchise takes it over first
const PREFER = {
  bullion: (shop) => { const id = typeId(shop); return id === 'diner' || id === 'takeout' ? 1.5 : id === 'restaurant' || id === 'latin' ? 1.15 : 1; },
  tranche: (shop) => (typeId(shop) === 'pizza' ? 1.8 : typeId(shop) === 'restaurant' ? 1.1 : 1)
};

/**
 * The branches of both franchises: { bullion: [site], tranche: [site], all: [site] }. A site is a calibre-plan.js
 * room site ({ x, z, nx, nz, wall, shop, record, polygon, spec, id, variant }) with `brand`.
 */
function planEateries(shops, records, bounds = null) {
  const out = { all: [] };
  for (const brand of ['bullion', 'tranche']) {
    const spec = SPECS[brand];
    const sites = planRooms(shops, records, { spec, count: spec.count, bounds, prefix: brand, spacing: spec.spacing, prefer: PREFER[brand] });
    for (const site of sites) { site.brand = brand; site.shop.eatery = site; }
    out[brand] = sites;
    out.all.push(...sites);
  }
  return out;
}

const eateryPoint = calibrePoint, eateryLocal = calibreLocal;
// The world heading of someone facing the local direction (lx, lz)
function eateryHeading(site, lx, lz) { return Math.atan2(site.nz * lx + site.nx * lz, -site.nx * lx + site.nz * lz); }

// Where a point of the local frame is: 'dining' (the customers' side), 'kitchen' (behind the counter), or null
function eateryZone(brand, x, z) {
  const P = PLANS[brand];
  if (Math.abs(x) >= P.half + 0.1 || z > 0.15 || z < P.back) return null;
  if (brand === 'bullion') return z < P.counter.z - P.counter.depth / 2 ? 'kitchen' : 'dining';
  return x < P.counter.x1 && z > P.gate.z - 0.3 ? 'kitchen' : 'dining';
}

// ---- What stands in the way: the shell and the furniture ---------------------------------------------------------------

function eateryFixtures(site) {
  const brand = site.brand, S = SPECS[brand], P = PLANS[brand], c = [], F = S.floor, top = S.height, wall = S.width / 2, H = P.half;
  const box = (x, z, width, depth, h = top - F, y0 = 0) => c.push(calibreBox(site, x, z, width, depth, y0, F + h));
  const span = (x0, x1, z0, z1, h, y0) => box((x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(z1 - z0), h, y0);
  // the shell: back, sides, the front on either side of the doorway
  span(-wall, wall, -S.depth, P.back);
  span(-wall, -H, 0, -S.depth); span(H, wall, 0, -S.depth);
  span(-wall, P.door.x0, 0.09, -0.09); span(P.door.x1, wall, 0.09, -0.09);
  if (brand === 'bullion') {
    const C = P.counter, B = P.booth, I = P.island;
    span(C.x0, C.x1, C.z + C.depth / 2, C.z - C.depth / 2, C.h);
    span(P.gate.x0, P.gate.x1, P.gate.z + 0.05, P.gate.z - 0.05, P.gate.h);
    span(P.fountain.x0, P.fountain.x1, C.z + C.depth / 2, C.z - C.depth / 2, P.fountain.top);
    span(I.x0, I.x1, I.z + I.depth / 2, I.z - I.depth / 2, I.h);
    span(P.shelves.x0, P.shelves.x1, P.shelves.z + P.shelves.depth / 2, P.back, P.shelves.h);
    box(P.sink.x, P.sink.z, P.sink.w, P.sink.d, P.sink.h);
    for (const z of P.booths) {
      span(B.table.x0, B.table.x1, z + B.table.d / 2, z - B.table.d / 2, B.table.h);
      for (const side of [1, -1]) {
        span(B.x0, B.x1, z + side * (B.offset - B.bench / 2), z + side * (B.offset + B.bench / 2), B.seat);
        span(B.x0, B.x1, z + side * (B.offset + B.bench / 2), z + side * (B.offset + B.bench / 2 + 0.1), B.back);
      }
    }
    span(P.ledge.x0, P.ledge.x1, P.ledge.z + P.ledge.depth / 2, P.ledge.z - P.ledge.depth / 2, P.ledge.h);
    for (const z of P.tables) box(P.table.x, z, P.table.size, P.table.size, P.table.h);
    for (const k of P.kiosks) box(k.x, k.z, P.kiosk.w, P.kiosk.d, P.kiosk.h);
    box(P.trash.x, P.trash.z, P.trash.w, P.trash.d, P.trash.h);
  } else {
    const C = P.counter, O = P.oven;
    // the window's wall and its glass are already the front; the bench, the hatch's shelf, the long counter
    span(P.bench.x0, P.bench.x1, P.bench.z0, P.bench.z1, P.bench.h);
    span(P.hatch.x0, P.hatch.x1, P.hatch.z0, P.hatch.z1, P.hatch.h);
    span(C.x0, C.x1, C.z0, C.z1, P.display.top);
    span(P.prep.x0, P.prep.x1, P.prep.z0, P.prep.z1, P.prep.h);
    span(O.x0, O.x1, O.z0, O.z1, O.h);
    span(P.boxes.x0, P.boxes.x1, P.boxes.z0, P.boxes.z1, P.boxes.h);
    span(P.partition.x0, P.partition.x1, P.partition.z + 0.05, P.partition.z - 0.05, P.partition.h);
    span(P.gate.x0, P.gate.x1, P.gate.z + 0.05, P.gate.z - 0.05, P.gate.h);
    span(P.ledge.x0, P.ledge.x1, P.ledge.z0, P.ledge.z1, P.ledge.h);
    for (const t of P.tables) box(t.x, t.z, P.table.size, P.table.size, P.table.h);
    span(P.fridge.x0, P.fridge.x1, P.fridge.z0, P.fridge.z1, P.fridge.h);
    box(P.trash.x, P.trash.z, P.trash.r * 2, P.trash.r * 2, P.trash.h);
  }
  return c;
}

// The sidewalk in front of a branch that street furniture and parked cars keep clear of: the doorway, and TRANCHE's hatch
function eateryReserves(site) {
  const S = SPECS[site.brand];
  const boxes = [calibreBox(site, S.entry, 1.7, 3.4, 3.8, 0, 3.5)];
  if (site.brand === 'tranche') boxes.push(calibreBox(site, -1.0, 1.3, 2.6, 2.6, 0, 3.5));
  return boxes;
}

export { BULLION, TRANCHE, SPECS, BULLION_PLAN, TRANCHE_PLAN, PLANS, SEATS, SPOTS, WAYS, planEateries, eateryPoint, eateryLocal, eateryHeading, eateryZone,
  eateryFixtures, eateryReserves, route, nearestWay };
