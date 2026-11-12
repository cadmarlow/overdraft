import { ISLAND_BOUNDS, getIslandBoundsAtZ } from './city-config.js';
import { NORTH_GATE, WALL_Z, saltLandAt, saltRoadAt, sampleSalt } from './wasteland-plan.js';

// Where the bones of the old city stand, and what each is made of. Pure: no renderer, the same answer every time.
// Two kinds of ruin: a shell (four walls, blown windows, the floors that are left inside) and a frame (columns and
// slabs with the walls gone, open at street level: a car drives in under it).

export const STOREY = 3.3; // of a shell, floor to floor
export const FRAME = { ground: 4.4, storey: 3.4, bay: 6, column: 0.62, slab: 0.3 };
const TINTS = [[0.25, 0.20, 0.15], [0.22, 0.10, 0.06], [0.17, 0.15, 0.13], [0.30, 0.23, 0.15], [0.20, 0.115, 0.07]];
const CONCRETE = [[0.27, 0.25, 0.22], [0.23, 0.21, 0.185], [0.30, 0.27, 0.225]];
const BRICK = [[0.24, 0.115, 0.07], [0.20, 0.10, 0.065], [0.27, 0.19, 0.13]];

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const hash = (a, b, c) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };

// The floors left inside a shell: every storey up to where the walls are bitten off, each fallen in on one side,
// except the last, which is whole (it is the roof a body lands on)
function floorsOf(shell, random) {
  const top = Math.floor((shell.h * 0.66 - 3.4) / STOREY), first = Math.ceil((shell.sink + 2.4) / STOREY);
  const floors = [];
  for (let k = first; k <= top; k++) {
    const whole = k === top, keep = whole ? 1 : 0.45 + 0.55 * random(), side = random() < 0.5 ? -1 : 1, alongX = random() < 0.5;
    floors.push({ y: shell.y + k * STOREY, keep, side, alongX, sky: whole ? 1 : 0 });
  }
  return floors;
}

/**
 * @param {Array<{x, z, r}>} keepOut - camps and other works nothing may stand on
 * @returns {{ shells: Array, frames: Array }}
 */
export function planRuins(keepOut = []) {
  const random = rng(0x0b0de5);
  const shells = [], frames = [], road = {};
  const ruin = (x, z, w, d, h, sink, hero) => {
    const corners = [[0, 0], [w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]];
    for (const [ox, oz] of corners) if (!saltLandAt(x + ox, z + oz)) return;
    const onRoad = saltRoadAt(x, z, road), clear = onRoad ? road.distance - road.half : Infinity;
    if (clear < Math.max(w, d) / 2 + 5) return;
    for (const k of keepOut) if (Math.abs(x - k.x) < k.r + w / 2 && Math.abs(z - k.z) < k.r + d / 2) return;
    const levels = corners.map(([ox, oz]) => sampleSalt(x + ox, z + oz)), low = Math.min(...levels), high = Math.max(...levels);
    const close = onRoad || hero > 0;
    if (close && high - low < 1.1 && random() < (hero > 0 ? hero : clear < 75 ? 0.3 : 0.05)) {
      const nx = Math.max(2, Math.min(5, Math.round(w / FRAME.bay))), nz = Math.max(2, Math.min(4, Math.round(d / FRAME.bay)));
      frames.push({ x, z, y: low - 0.25, high, nx, nz, storeys: Math.max(2, Math.min(9, Math.round((h - FRAME.ground) / FRAME.storey))),
        corner: [random() < 0.5 ? 0 : 1, random() < 0.5 ? 0 : 1], seed: random() * 97, concrete: CONCRETE[Math.floor(random() * CONCRETE.length)],
        brick: BRICK[Math.floor(random() * BRICK.length)] });
      return;
    }
    const shell = { x, y: sampleSalt(x, z) - sink, z, w, d, h, sink, tint: TINTS[Math.floor(random() * TINTS.length)], seed: random(), floors: [] };
    if (close) shell.floors = floorsOf(shell, random);
    // the roof a body can stand on: the last whole floor where there is one, else what is left of the walls
    shell.roof = shell.floors.length ? shell.floors.at(-1).y : shell.y + h * 0.8;
    shells.push(shell);
  };
  // Harlem beyond the Wall: the avenues and the cross streets run on, and what stood along them
  const avenues = [-2000, -1683, -1408, -1134, -860, -585, -310, 0, 311, 622, 880];
  for (let k = 0; k < 24; k++) {
    const zs = WALL_Z - 92 - k * 80.4, thin = 0.5 + 0.3 * Math.min(1, k / 12);
    for (let a = 0; a + 1 < avenues.length; a++) {
      for (let x = avenues[a] + 26; x < avenues[a + 1] - 26; x += 20 + random() * 12) {
        for (const side of [-1, 1]) {
          if (random() < thin) continue;
          const w = 16 + random() * 9, d = 13 + random() * 9, tall = random();
          // what a traveller sees first through the Great Gate
          const hero = k < 10 && Math.abs(x - NORTH_GATE.x) < 420 ? 0.3 : 0;
          ruin(x, zs + side * (9.5 + d / 2), w, d, 9 + tall * tall * 34 + (tall > 0.94 ? 30 : 0), 1.5 + random() * 4, hero);
        }
      }
    }
  }
  // The far banks: Jersey City and Hoboken under the cliffs, Brooklyn and Queens across the moat
  const cluster = (x, z, cx, cz, r) => Math.max(0, 1 - Math.hypot(x - cx, z - cz) / r);
  for (let z = -5200; z < 8200; z += 58) {
    const shore = getIslandBoundsAtZ(Math.max(ISLAND_BOUNDS.minZ, Math.min(ISLAND_BOUNDS.maxZ, z)));
    let bank = null;
    for (let x = shore.eastX + 60; x < shore.eastX + 2600; x += 24) if (saltLandAt(x, z) && sampleSalt(x, z) > 0.4) { bank = x; break; }
    if (bank !== null && z < 6000) for (let x = bank + 30; x < bank + 950; x += 46 + random() * 30) {
      const downtown = Math.max(cluster(x, z, 2500, 5750, 900), cluster(x, z, 2450, -1200, 800), cluster(x, z, 3600, 3300, 700));
      if (random() > 0.34 + 0.4 * downtown) continue;
      const w = 18 + random() * 16, tall = random();
      ruin(x, z + (random() - 0.5) * 30, w, 16 + random() * 14, 8 + tall * tall * 30 + downtown * (20 + tall * 95), 1 + random() * 5, 0);
    }
    if (z > 300) for (let x = -2500; x > -4300; x -= 46 + random() * 30) {
      if (!saltLandAt(x, z)) continue;
      const y = sampleSalt(x, z);
      if (y < 0.6 || y > 14) continue;
      const downtown = Math.max(cluster(x, z, -2450, 5150, 900), cluster(x, z, -2950, 2300, 600));
      if (random() > 0.3 + 0.45 * downtown) continue;
      const w = 18 + random() * 16, tall = random();
      ruin(x, z + (random() - 0.5) * 30, w, 16 + random() * 14, 8 + tall * tall * 28 + downtown * (25 + tall * 110), 1 + random() * 5, 0);
    }
  }
  return { shells, frames };
}

// The level of the top of slab k of a frame (k = 1 is the first floor)
export const frameLevel = (frame, k) => frame.y + FRAME.ground + (k - 1) * FRAME.storey;

// How many slabs still stand over bay (i, j): the building gave way from one corner
export function frameTop(frame, i, j) {
  const t = Math.hypot((i + 0.5) / frame.nx - frame.corner[0], (j + 0.5) / frame.nz - frame.corner[1]) / Math.SQRT2;
  return Math.round(frame.storeys * Math.max(0, Math.min(1, 0.12 + 1.15 * t + (hash(i, j, frame.seed) - 0.5) * 0.34)));
}

/**
 * What a frame is built of.
 * @returns {{ boxes: Array<{x, y, z, sx, sy, sz, rx, rz, paint, sky}>, colliders: Array, props: Array<{name, x, z, yaw}> }}
 *   boxes are centred, sized sx, sy, sz, tilted by rx then rz (radians); sky is how open to the sky they are (0..1)
 */
export function frameParts(frame) {
  const { nx, nz, concrete, brick } = frame, B = FRAME.bay, boxes = [], colliders = [], props = [];
  const x0 = frame.x - nx * B / 2, z0 = frame.z - nz * B / 2;
  const top = Array.from({ length: nx }, (_, i) => Array.from({ length: nz }, (_, j) => frameTop(frame, i, j)));
  const box = (x, y, z, sx, sy, sz, paint, sky = 1, rx = 0, rz = 0) => boxes.push({ x, y, z, sx, sy, sz, rx, rz, paint, sky });
  // slabs: each row of bays in one piece per run of bays still standing
  for (let k = 1; k <= frame.storeys; k++) for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (top[i][j] < k) continue;
      let run = i;
      while (run + 1 < nx && top[run + 1][j] >= k) run++;
      box(x0 + (i + run + 1) / 2 * B, frameLevel(frame, k) - FRAME.slab / 2, z0 + (j + 0.5) * B, (run - i + 1) * B + 0.5, FRAME.slab, B + 0.02, concrete, top[i][j] === k ? 1 : 0);
      i = run;
    }
  }
  // columns: one shaft each, as high as the highest slab it carries, with a stub of bars above
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    let carries = 0;
    for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) if (a >= 0 && a < nx && b >= 0 && b < nz) carries = Math.max(carries, top[a][b]);
    const x = x0 + i * B, z = z0 + j * B;
    const height = carries ? frameLevel(frame, carries) - frame.y + 0.5 + hash(i, j, frame.seed + 3) * 1.3 : 1 + hash(i, j, frame.seed + 5) * 2.6;
    box(x, frame.y + height / 2 - 1, z, FRAME.column, height + 2, FRAME.column, concrete, 0.7);
    colliders.push({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45, minY: frame.y - 1, maxY: frame.y + Math.min(height, FRAME.ground - FRAME.slab), roof: false });
  }
  // what is left of the walls: spandrels under the windows, a few panels whole, more of them low down
  const edge = (i, j, alongX, outward, k) => {
    const chance = hash(i * 3 + (alongX ? 1 : 2), j * 5 + k * 11, frame.seed + outward);
    const whole = chance < (k === 0 ? 0.2 : 0.16), spandrel = !whole && k > 0 && chance < 0.62;
    if (!whole && !spandrel) return;
    const base = k === 0 ? frame.y : frameLevel(frame, k), height = whole ? (k === 0 ? FRAME.ground : FRAME.storey) - FRAME.slab : 1.05;
    const cx = alongX ? x0 + (i + 0.5) * B : x0 + (outward > 0 ? nx : 0) * B, cz = alongX ? z0 + (outward > 0 ? nz : 0) * B : z0 + (j + 0.5) * B;
    box(cx, base + height / 2, cz, alongX ? B - FRAME.column : 0.24, height, alongX ? 0.24 : B - FRAME.column, brick, 0.85);
    if (k === 0) colliders.push({ minX: cx - (alongX ? B / 2 : 0.4), maxX: cx + (alongX ? B / 2 : 0.4), minZ: cz - (alongX ? 0.4 : B / 2), maxZ: cz + (alongX ? 0.4 : B / 2),
      minY: frame.y - 1, maxY: frame.y + FRAME.ground - FRAME.slab, roof: false });
  };
  for (let k = 0; k <= frame.storeys; k++) {
    for (let i = 0; i < nx; i++) for (const [j, outward] of [[0, -1], [nz - 1, 1]]) if (top[i][j] >= Math.max(1, k)) edge(i, j, true, outward, k);
    for (let j = 0; j < nz; j++) for (const [i, outward] of [[0, -1], [nx - 1, 1]]) if (top[i][j] >= Math.max(1, k)) edge(i, j, false, outward, k);
  }
  // the corner that gave way: slabs lying against what still stands, and the heap they made
  const cx = x0 + frame.corner[0] * nx * B, cz = z0 + frame.corner[1] * nz * B, sx = frame.corner[0] ? 1 : -1, sz = frame.corner[1] ? 1 : -1;
  const lean = 0.5 + hash(1, 2, frame.seed) * 0.25, reach = B * Math.cos(lean) / 2, rise = B * Math.sin(lean) / 2;
  box(cx - sx * (B * 0.6 + reach * 0.2), frame.y + rise + 0.1, cz - sz * B * 0.5, B, FRAME.slab, B * 0.96, concrete, 1, 0, sx * lean);
  box(cx - sx * B * 0.45, frame.y + rise * 0.8 + 0.1, cz - sz * (B * 1.5 + reach * 0.2), B * 0.9, FRAME.slab, B, concrete, 1, -sz * lean * 0.85, 0);
  box(cx + sx * 1.6, frame.y + 0.5, cz + sz * 1.2, B * 0.8, FRAME.slab, B * 0.55, concrete, 1, 0.16 * sz, -0.2 * sx);
  colliders.push({ minX: cx - sx * B - B / 2, maxX: cx - sx * B + B / 2 + 0.6, minZ: cz - sz * B * 0.5 - B / 2, maxZ: cz - sz * B * 0.5 + B / 2, minY: frame.y - 1, maxY: frame.y + 1.5, roof: true });
  for (let n = 0; n < 5; n++) {
    const a = hash(n, 7, frame.seed) * 6.283, r = 2 + hash(n, 9, frame.seed) * 5.5;
    props.push({ name: n < 2 ? 'slab' : 'rubble', x: cx + sx * 1.5 + Math.cos(a) * r, z: cz + sz * 1.5 + Math.sin(a) * r, yaw: a * 2 });
  }
  // the floors above are one roof to whatever comes down on them; under the first slab the street level is open
  const flat = top.flat(), standing = flat.filter(t => t > 0);
  if (standing.length) {
    const median = standing.sort((a, b) => a - b)[Math.floor(standing.length / 2)];
    colliders.push({ minX: x0, maxX: x0 + nx * B, minZ: z0, maxZ: z0 + nz * B, minY: frame.y + FRAME.ground - FRAME.slab, maxY: frameLevel(frame, median), roof: true });
  }
  return { boxes, colliders, props, clearance: frame.y + FRAME.ground - FRAME.slab - frame.high };
}
