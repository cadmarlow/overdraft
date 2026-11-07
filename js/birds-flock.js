// The animals of the street as pure logic, without three.js (birds.js draws them, tests/birds.test.cjs drives this):
// - pigeons in flocks of 6 to 18 on sidewalk spots near the camera, along the curb (never deep in a block, where the
//   buildings stand). They peck, potter about, turn, hop, step aside from a walker, and all go up together when someone
//   runs at them, a car goes by or a shot rings out; then they wheel down the street canyon (boids round a moving point
//   on a loop over the roadway) and come down again on another spot or on the lamp tops, which they leave later.
// - gulls circling high and slow wherever the shore is near;
// - at night, rats running along the curbs between the piles of bags, freezing, running on, vanishing into the gutter
//   or under a parked car, and bolting from the player.
// Everything lives in typed arrays; a step allocates nothing.

const TAU = Math.PI * 2;

// Population ceilings by graphics level
const BIRD_COUNTS = {
  high: { pigeons: 320, gulls: 10, rats: 30 },
  balanced: { pigeons: 250, gulls: 8, rats: 22 },
  fluid: { pigeons: 180, gulls: 5, rats: 14 }
};

const PIGEON = {
  SPOT_RADIUS: 110, // m from the camera within which spots are drawn
  RETIRE_RADIUS: 135, // and past which a flock is dropped (hysteresis)
  SPOT_GAP: 14, // m between two spots
  POP_DISTANCE: 75, // a flock may appear in view only beyond this distance
  FLOCK_MIN: 6,
  FLOCK_MAX: 18,
  CURB_REACH: 4, // m: a spot is never further than this from a curb (beyond, it may be inside a building)
  DEPTH_MAX: 2.4, // m into the sidewalk from the curb
  GUTTER: 0.55, // m they may wander into the roadway along the curb
  WALKER_AVOID: 2.5, // m: a walker this close makes a pigeon step aside
  STANDING_ROOM: 0.8, // m kept clear round someone standing still
  WALKER_SPEED: 0.4, // m/s: slower than this, a person stands still
  RUN_SPEED: 3.2, // m/s: faster than this, a person runs
  RUNNER_FLUSH: 5, // m: a runner this close flushes the flock
  VEHICLE_SPEED: 7, // m/s: a player this fast is in a vehicle
  CAR_SPEED: 1.5, // m/s: a car slower than this is parked or creeping
  CAR_FLUSH: 6, // m: a moving car this close flushes the flock
  ALARM_FLUSH: 3, // accumulated alarm (being pressed by a walker) that flushes the flock
  FLIGHT_MIN: 6, // s in the air before landing
  FLIGHT_MAX: 15,
  CRUISE: 8.5, // m/s
  SPEED_MIN: 3.5,
  SPEED_MAX: 12.5,
  SEPARATION: 1.1, // m: boids push apart closer than this
  GROUND_GAP: 0.28, // m between two pigeons on the ground
  ALT_MIN: 6, // m above the street for the loop
  ALT_MAX: 14,
  PERCH_CHANCE: 0.3,
  PERCH_SLOTS: 3, // pigeons per lamp top
  PERCH_REACH: 30, // m from the loop to the lamp tops they may choose
  PERCH_TIME_MIN: 12, // s on a lamp before coming down
  PERCH_TIME_MAX: 45,
  NIGHT_SHARE: 0.12 // share of the pigeons still out in the dead of night
};

const GULL = {
  ALT_MIN: 20,
  ALT_MAX: 60,
  RADIUS_MIN: 28,
  RADIUS_MAX: 70,
  SPEED_MIN: 8,
  SPEED_MAX: 11,
  CENTRE_MIN: 60, // m from the camera to the centre of a circle
  CENTRE_MAX: 220,
  DROP_RADIUS: 330, // m: farther gulls are dropped
  FLAP_EVERY_MIN: 5, // s between two bursts of wingbeats
  FLAP_EVERY_MAX: 14,
  CHECK_EVERY: 1 // s between two looks at the shore
};

const RAT = {
  RADIUS: 40, // m from the camera to the piles they come out of
  DROP_RADIUS: 52,
  HOUR_FROM: 22, // they are out from this hour...
  HOUR_TO: 5, // ...to this one
  NIGHT_MIN: 0.5, // and only when it is this dark
  FLEE: 3, // m: the player this close sends them running
  RUN_SPEED_MIN: 2.4,
  RUN_SPEED_MAX: 3.8,
  FLEE_SPEED: 4.6,
  PILE_REACH: 26, // m to the next pile along the same curb
  SPAWN_EVERY: 0.45 // s between two rats coming out (on average)
};

const PIGEON_STATE = { FREE: 0, GROUND: 1, TAKEOFF: 2, FLY: 3, LAND: 4, PERCH: 5 };
const RAT_STATE = { FREE: 0, RUN: 1, FREEZE: 2, FLEE: 3, HIDE: 4 };
const ACT = { IDLE: 0, PECK: 1, WALK: 2, TURN: 3, HOP: 4, AVOID: 5, DISPLAY: 6, SETTLE: 7 };
const FLOCK = { FREE: 0, ACTIVE: 1, LEAVING: 2 };

// Plumage, with the share of each in a New York flock
const PIGEON_COLORS = [
  [0.5, 0.53, 0.6, 0.5], // blue-grey, the wild type
  [0.64, 0.65, 0.67, 0.12], // ash
  [0.16, 0.16, 0.18, 0.14], // black
  [0.42, 0.3, 0.24, 0.13], // brown
  [0.86, 0.85, 0.82, 0.11] // white, speckled by the shader
];
const GULL_COLORS = [[0.93, 0.93, 0.92, 0.7], [0.8, 0.81, 0.83, 0.3]];
const RAT_COLORS = [[0.23, 0.2, 0.18, 0.45], [0.17, 0.16, 0.15, 0.35], [0.3, 0.26, 0.21, 0.2]];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));
function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
const turnToward = (yaw, target, step) => wrapAngle(yaw + clamp(wrapAngle(target - yaw), -step, step));
const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);

// Small, fast, seedable generator (mulberry32), so the tests are repeatable
function makeRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cellKey = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);

// Points (lamp tops, piles of bags) indexed in square cells for "which are within r of (x, z)"
function createPointIndex(xs, zs, cell = 24) {
  const n = Math.min(xs && xs.length ? xs.length : 0, zs && zs.length ? zs.length : 0);
  const lists = new Map();
  for (let i = 0; i < n; i++) {
    const x = +xs[i], z = +zs[i];
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const k = cellKey(Math.floor(x / cell), Math.floor(z / cell));
    let list = lists.get(k);
    if (!list) lists.set(k, (list = []));
    list.push(i);
  }
  const cells = new Map();
  for (const [k, list] of lists) cells.set(k, Int32Array.from(list));
  return {
    count: n,
    // Writes the indices of the points within r of (x, z) to out; returns how many
    near(x, z, r, out, max = out.length) {
      let found = 0;
      if (!n) return 0;
      const r2 = r * r;
      const x0 = Math.floor((x - r) / cell), x1 = Math.floor((x + r) / cell);
      const z0 = Math.floor((z - r) / cell), z1 = Math.floor((z + r) / cell);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const list = cells.get(cellKey(ix, iz));
          if (!list) continue;
          for (let k = 0; k < list.length; k++) {
            const i = list[k];
            const dx = xs[i] - x, dz = zs[i] - z;
            if (dx * dx + dz * dz <= r2) {
              out[found++] = i;
              if (found >= max) return found;
            }
          }
        }
      }
      return found;
    }
  };
}

function pickColor(table, random, out, k) {
  let r = random();
  let c = table[table.length - 1];
  for (const entry of table) {
    if ((r -= entry[3]) <= 0) { c = entry; break; }
  }
  const shade = 0.92 + random() * 0.16;
  out[k * 3] = c[0] * shade;
  out[k * 3 + 1] = c[1] * shade;
  out[k * 3 + 2] = c[2] * shade;
}

const asArray = (a) => (a && typeof a.length === 'number' ? a : []);

/**
 * @param {{
 *   groundHeight?: (x: number, z: number) => number,
 *   onSidewalk?: (x: number, z: number) => boolean,
 *   nearWater?: (x: number, z: number) => boolean,
 *   perches?: { x: ArrayLike<number>, z: ArrayLike<number>, y: ArrayLike<number> },
 *   trashPiles?: { x: ArrayLike<number>, z: ArrayLike<number> },
 *   quality?: 'high' | 'balanced' | 'fluid',
 *   random?: () => number, // for repeatable runs
 *   perchChance?: number, // share of landings on the lamp tops (PIGEON.PERCH_CHANCE)
 *   onFlush?: (x: number, z: number, count: number) => void // a flock goes up (for the wing clatter)
 * }} options
 */
function createBirdSim(options = {}) {
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const level = BIRD_COUNTS[options.quality] ? options.quality : 'balanced';
  const counts = BIRD_COUNTS[level];
  const groundFn = typeof options.groundHeight === 'function' ? options.groundHeight : null;
  const sidewalkFn = typeof options.onSidewalk === 'function' ? options.onSidewalk : null;
  const waterFn = typeof options.nearWater === 'function' ? options.nearWater : null;
  const groundAt = (x, z) => {
    if (!groundFn) return 0;
    try { return finite(+groundFn(x, z), 0); } catch { return 0; }
  };
  const onSidewalk = (x, z) => {
    try { return !!sidewalkFn(x, z); } catch { return false; }
  };
  const nearWater = (x, z) => {
    if (!waterFn) return false;
    try { return !!waterFn(x, z); } catch { return false; }
  };
  const rand = (lo, hi) => lo + (hi - lo) * random();
  const perchChance = clamp(finite(+options.perchChance, PIGEON.PERCH_CHANCE), 0, 1);
  const onFlush = typeof options.onFlush === 'function' ? options.onFlush : null;

  // ---- Lamp tops and piles of bags ------------------------------------------------------------------------------
  const perchSrc = options.perches || {};
  const perchX = asArray(perchSrc.x), perchZ = asArray(perchSrc.z), perchY = asArray(perchSrc.y);
  const perchCount = Math.min(perchX.length, perchZ.length);
  const perches = createPointIndex(perchX, perchZ, 32);
  const perchUse = new Uint8Array(perchCount); // pigeons sitting or headed there
  const pileSrc = options.trashPiles || {};
  const pileX = asArray(pileSrc.x), pileZ = asArray(pileSrc.z);
  const pileCount = Math.min(pileX.length, pileZ.length);
  const piles = createPointIndex(pileX, pileZ, 24);
  const pileFrame = new Int8Array(pileCount); // 0 not looked at yet, 1 curb found, -1 none near
  const pileNX = new Float32Array(pileCount), pileNZ = new Float32Array(pileCount), pileD = new Float32Array(pileCount);
  const near = new Int32Array(256);

  // ---- Curbs ----------------------------------------------------------------------------------------------------
  // Distance from (x, z) along (nx, nz) to the edge of the sidewalk, or Infinity within reach
  function curbDistance(x, z, nx, nz, reach) {
    let prev = 0;
    for (let s = 0.6; s <= reach + 1e-6; s += 0.6) {
      if (!onSidewalk(x + nx * s, z + nz * s)) {
        let lo = prev, hi = s;
        for (let b = 0; b < 5; b++) {
          const m = (lo + hi) * 0.5;
          if (onSidewalk(x + nx * m, z + nz * m)) lo = m; else hi = m;
        }
        return (lo + hi) * 0.5;
      }
      prev = s;
    }
    return Infinity;
  }

  // The curb nearest a sidewalk point: its foot (cx, cz), the normal towards the roadway, the tangent, and how far
  // the point is from it. The four axes find it (the grid is axis-aligned), two curb points either side square it up
  // so a diagonal street gets its own frame. False when no curb is within reach.
  const frame = { cx: 0, cz: 0, nx: 0, nz: 0, tx: 0, tz: 0, depth: 0 };
  function curbFrame(x, z, reach) {
    let best = Infinity, bnx = 0, bnz = 0;
    for (let k = 0; k < 4; k++) {
      const nx = k === 0 ? 1 : k === 1 ? -1 : 0, nz = k === 2 ? 1 : k === 3 ? -1 : 0;
      const d = curbDistance(x, z, nx, nz, Math.min(reach, best));
      if (d < best) { best = d; bnx = nx; bnz = nz; }
    }
    if (!(best < Infinity)) return false;
    let nx = bnx, nz = bnz;
    const tx0 = -bnz, tz0 = bnx, side = 2.5;
    const ax = x + tx0 * side, az = z + tz0 * side, bx = x - tx0 * side, bz = z - tz0 * side;
    if (onSidewalk(ax, az) && onSidewalk(bx, bz)) {
      const da = curbDistance(ax, az, bnx, bnz, reach + 2), db = curbDistance(bx, bz, bnx, bnz, reach + 2);
      if (da < Infinity && db < Infinity) {
        let tx = (ax + bnx * da) - (bx + bnx * db), tz = (az + bnz * da) - (bz + bnz * db);
        const len = Math.hypot(tx, tz);
        if (len > 1e-3) {
          tx /= len; tz /= len;
          let mx = tz, mz = -tx; // perpendicular, turned towards the roadway
          if (mx * bnx + mz * bnz < 0) { mx = -mx; mz = -mz; }
          if (mx * bnx + mz * bnz > 0.7) { nx = mx; nz = mz; best *= mx * bnx + mz * bnz; }
        }
      }
    }
    frame.nx = nx; frame.nz = nz;
    frame.tx = -nz; frame.tz = nx;
    frame.depth = best;
    frame.cx = x + nx * best;
    frame.cz = z + nz * best;
    return true;
  }

  // ---- Pigeons ----------------------------------------------------------------------------------------------------
  const NP = counts.pigeons;
  const pigeons = {
    capacity: NP,
    top: 0, // one past the highest index in use
    colorVersion: 0,
    state: new Uint8Array(NP),
    flock: new Int16Array(NP).fill(-1),
    x: new Float32Array(NP), y: new Float32Array(NP), z: new Float32Array(NP),
    vx: new Float32Array(NP), vy: new Float32Array(NP), vz: new Float32Array(NP),
    yaw: new Float32Array(NP), pitch: new Float32Array(NP), roll: new Float32Array(NP),
    scale: new Float32Array(NP), puff: new Float32Array(NP),
    phase: new Float32Array(NP), amp: new Float32Array(NP), fold: new Float32Array(NP), head: new Float32Array(NP),
    color: new Float32Array(NP * 3)
  };
  const P = pigeons;
  const act = new Uint8Array(NP), actT = new Float32Array(NP), actN = new Uint8Array(NP), pause = new Float32Array(NP);
  const stepPh = new Float32Array(NP), wspd = new Float32Array(NP), headGoal = new Float32Array(NP);
  const goalX = new Float32Array(NP), goalZ = new Float32Array(NP), goalY = new Float32Array(NP), goalYaw = new Float32Array(NP);
  const gy = new Float32Array(NP), hopT = new Float32Array(NP), hopH = new Float32Array(NP), lastSide = new Int8Array(NP);
  const timer = new Float32Array(NP), glideT = new Float32Array(NP), held = new Uint8Array(NP);
  const offX = new Float32Array(NP), offY = new Float32Array(NP), offZ = new Float32Array(NP);
  const yawRate = new Float32Array(NP), launched = new Uint8Array(NP), fromPerch = new Uint8Array(NP);
  const h0x = new Float32Array(NP), h0y = new Float32Array(NP), h0z = new Float32Array(NP);
  const m0x = new Float32Array(NP), m0y = new Float32Array(NP), m0z = new Float32Array(NP);
  const h1x = new Float32Array(NP), h1y = new Float32Array(NP), h1z = new Float32Array(NP);
  const m1x = new Float32Array(NP), m1y = new Float32Array(NP), m1z = new Float32Array(NP);
  const hT = new Float32Array(NP), ht = new Float32Array(NP), landTo = new Int32Array(NP).fill(-1); // perch or -1
  const threatX = new Float32Array(NP), threatZ = new Float32Array(NP);

  const NF = Math.ceil(NP / PIGEON.FLOCK_MIN) + 2;
  const flocks = {
    capacity: NF,
    state: new Uint8Array(NF),
    size: new Uint8Array(NF),
    members: new Int16Array(NF * PIGEON.FLOCK_MAX),
    // spot: curb foot, normal (to the road), tangent, extents, ground height
    cx: new Float32Array(NF), cz: new Float32Array(NF), nx: new Float32Array(NF), nz: new Float32Array(NF),
    tx: new Float32Array(NF), tz: new Float32Array(NF), halfLen: new Float32Array(NF), depth: new Float32Array(NF),
    gy: new Float32Array(NF), roadHalf: new Float32Array(NF),
    // the loop over the roadway: centre, half straight, radius, altitude, where along, which way
    ox: new Float32Array(NF), oz: new Float32Array(NF), ls: new Float32Array(NF), lr: new Float32Array(NF),
    alt: new Float32Array(NF), s: new Float32Array(NF), dir: new Int8Array(NF),
    ax: new Float32Array(NF), ay: new Float32Array(NF), az: new Float32Array(NF),
    avx: new Float32Array(NF), avz: new Float32Array(NF),
    airT: new Float32Array(NF), airDur: new Float32Array(NF), landing: new Uint8Array(NF),
    alarm: new Float32Array(NF), calm: new Float32Array(NF),
    airborne: new Uint8Array(NF), grounded: new Uint8Array(NF), perched: new Uint8Array(NF),
    // centroid and mean velocity of the airborne members
    mx: new Float32Array(NF), my: new Float32Array(NF), mz: new Float32Array(NF),
    mvx: new Float32Array(NF), mvy: new Float32Array(NF), mvz: new Float32Array(NF)
  };
  const F = flocks;
  const FW = 6; // walkers kept per flock: the ones near its spot
  const flockWalkers = new Uint8Array(NF), fwX = new Float32Array(NF * FW), fwZ = new Float32Array(NF * FW), fwR = new Float32Array(NF * FW);

  // ---- Gulls ------------------------------------------------------------------------------------------------------
  const NG = counts.gulls;
  const gulls = {
    capacity: NG,
    top: 0,
    colorVersion: 0,
    state: new Uint8Array(NG), // 0 free, 1 circling, 2 leaving
    x: new Float32Array(NG), y: new Float32Array(NG), z: new Float32Array(NG),
    yaw: new Float32Array(NG), pitch: new Float32Array(NG), roll: new Float32Array(NG), scale: new Float32Array(NG),
    phase: new Float32Array(NG), amp: new Float32Array(NG), fold: new Float32Array(NG), head: new Float32Array(NG),
    color: new Float32Array(NG * 3)
  };
  const G = gulls;
  const gcx = new Float32Array(NG), gcz = new Float32Array(NG), grad = new Float32Array(NG), galt = new Float32Array(NG);
  const gang = new Float32Array(NG), gspd = new Float32Array(NG), gdir = new Int8Array(NG), gseed = new Float32Array(NG);
  const gflapT = new Float32Array(NG), gbeats = new Float32Array(NG), gheld = new Uint8Array(NG), gclimb = new Float32Array(NG);
  const gdx = new Float32Array(NG), gdz = new Float32Array(NG), gage = new Float32Array(NG);

  // ---- Rats -------------------------------------------------------------------------------------------------------
  const NR = counts.rats;
  const rats = {
    capacity: NR,
    top: 0,
    colorVersion: 0,
    state: new Uint8Array(NR),
    x: new Float32Array(NR), y: new Float32Array(NR), z: new Float32Array(NR),
    yaw: new Float32Array(NR), pitch: new Float32Array(NR), roll: new Float32Array(NR), scale: new Float32Array(NR),
    phase: new Float32Array(NR), amp: new Float32Array(NR), fold: new Float32Array(NR), head: new Float32Array(NR),
    color: new Float32Array(NR * 3)
  };
  const R = rats;
  const WP = 4;
  const rwx = new Float32Array(NR * WP), rwz = new Float32Array(NR * WP), rwy = new Float32Array(NR * WP);
  const rwi = new Uint8Array(NR), rwn = new Uint8Array(NR), rspd = new Float32Array(NR), rtimer = new Float32Array(NR);
  const rgo = new Float32Array(NR), rvanish = new Float32Array(NR), rsize = new Float32Array(NR), rsy = new Float32Array(NR);
  const rnx = new Float32Array(NR), rnz = new Float32Array(NR), rcar = new Uint8Array(NR), rlen = new Float32Array(NR);

  // ---- World seen this step ---------------------------------------------------------------------------------------
  const MAX_THREATS = 160;
  const thrX = new Float32Array(MAX_THREATS), thrZ = new Float32Array(MAX_THREATS);
  const thrR = new Float32Array(MAX_THREATS), thrFlush = new Uint8Array(MAX_THREATS);
  let threats = 0;
  const MAX_WALKERS = 160;
  const wlkX = new Float32Array(MAX_WALKERS), wlkZ = new Float32Array(MAX_WALKERS), wlkR = new Float32Array(MAX_WALKERS);
  let walkers = 0;
  const MAX_PARKED = 64;
  const parkX = new Float32Array(MAX_PARKED), parkZ = new Float32Array(MAX_PARKED);
  let parked = 0;
  const view = { x: 0, y: 0, z: 0, fx: 0, fz: 1 };
  const player = { x: 0, z: 0, speed: 0, present: false };
  let dayShareNight = 0;
  let time = 0, steps = 0, filled = false, spawnWait = 0, gullCheck = 0, gullWanted = 0, ratWait = 0, ratsOut = false;
  let dayShare = 1;

  const inView = (x, z) => {
    const dx = x - view.x, dz = z - view.z, d = Math.hypot(dx, dz);
    return d < 1e-3 || (dx * view.fx + dz * view.fz) / d > 0.55;
  };

  // ---- Flock spots ------------------------------------------------------------------------------------------------
  const spot = { cx: 0, cz: 0, nx: 0, nz: 1, tx: 1, tz: 0, halfLen: 3, depth: 2, gy: 0, roadHalf: 8, ox: 0, oz: 0, ls: 15, lr: 5 };

  // A spot near (x, z): along a straight piece of curb, with the open roadway beside it for a loop. False if (x, z) is
  // not on a sidewalk near a curb.
  function trySpot(x, z) {
    if (!sidewalkFn) {
      // No map of the sidewalks: an open patch, a loop along x
      Object.assign(spot, { cx: x, cz: z, nx: 0, nz: 1, tx: 1, tz: 0, halfLen: 3, depth: PIGEON.DEPTH_MAX, gy: groundAt(x, z), roadHalf: 8 });
      spot.ox = x + spot.nx * 8; spot.oz = z + spot.nz * 8; spot.ls = 14; spot.lr = 6;
      return true;
    }
    if (!onSidewalk(x, z) || !curbFrame(x, z, PIGEON.CURB_REACH)) return false;
    const { cx, cz, nx, nz, tx, tz } = frame;
    // room on the sidewalk: deep enough, and a straight curb either side
    const depth = onSidewalk(cx - nx * PIGEON.DEPTH_MAX, cz - nz * PIGEON.DEPTH_MAX) ? PIGEON.DEPTH_MAX
      : onSidewalk(cx - nx * 1.3, cz - nz * 1.3) ? 1.3 : 0;
    if (!depth) return false;
    // a straight run of curb either side (beyond, a corner: the patch would wrap round onto the cross street), with
    // the sidewalk behind it all along and the roadway (or the gutter they potter in) in front
    let halfLen = 0;
    for (const h of [3.5, 2.5, 1.6]) {
      let ok = true;
      for (let k = -1; k <= 1 && ok; k += 2) {
        for (const a of [h * k, h * k * 0.5]) {
          const ex = cx + tx * (a + k * 0.6), ez = cz + tz * (a + k * 0.6);
          ok = ok && onSidewalk(ex - nx * 0.25, ez - nz * 0.25) && onSidewalk(ex - nx * (depth - 0.1), ez - nz * (depth - 0.1)) &&
            !onSidewalk(ex + nx * 0.25, ez + nz * 0.25) && !onSidewalk(ex + nx * (PIGEON.GUTTER + 0.3), ez + nz * (PIGEON.GUTTER + 0.3));
        }
      }
      if (ok) { halfLen = h; break; }
    }
    if (!halfLen) return false;
    // the roadway beside it: across to the far curb, and clear along the road either way
    let width = 0;
    for (let s = 1.5; s <= 40; s += 1.5) {
      width = s;
      if (onSidewalk(cx + nx * s, cz + nz * s)) break;
    }
    if (width < 6) return false;
    const half = Math.min(width * 0.5, 16);
    const rx = cx + nx * half, rz = cz + nz * half;
    let ahead = 0, behind = 0;
    for (let s = 4; s <= 44; s += 4) { if (onSidewalk(rx + tx * s, rz + tz * s)) break; ahead = s; }
    for (let s = 4; s <= 44; s += 4) { if (onSidewalk(rx - tx * s, rz - tz * s)) break; behind = s; }
    const shift = (ahead - behind) * 0.5, length = Math.max(8, (ahead + behind) * 0.5 - 3);
    const lr = clamp(half - 1.2, 2.5, 9);
    Object.assign(spot, { cx, cz, nx, nz, tx, tz, halfLen, depth, roadHalf: half, lr, ls: Math.max(0, Math.min(36, length) - lr) });
    spot.ox = rx + tx * shift; spot.oz = rz + tz * shift;
    spot.gy = groundAt(cx - nx, cz - nz);
    return true;
  }

  // A random point moved to just inside the nearest curb (the four axes, coarse then refined), so most draws give a
  // usable spot: from the roadway it steps up onto the sidewalk, from deep in a block it comes out to the curb
  const snapped = { x: 0, z: 0 };
  function snapToCurb(x, z) {
    if (!sidewalkFn) { snapped.x = x; snapped.z = z; return true; }
    const inside = onSidewalk(x, z);
    let best = Infinity, bnx = 0, bnz = 0;
    for (let k = 0; k < 4; k++) {
      const nx = k === 0 ? 1 : k === 1 ? -1 : 0, nz = k === 2 ? 1 : k === 3 ? -1 : 0;
      for (let s = 2; s <= 30 && s < best; s += 2) {
        if (onSidewalk(x + nx * s, z + nz * s) === inside) continue;
        let lo = s - 2, hi = s;
        for (let b = 0; b < 3; b++) {
          const m = (lo + hi) * 0.5;
          if (onSidewalk(x + nx * m, z + nz * m) === inside) lo = m; else hi = m;
        }
        best = (lo + hi) * 0.5; bnx = nx; bnz = nz;
        break;
      }
    }
    if (!(best < Infinity)) return inside;
    // the edge, then 1.2 m onto the sidewalk side of it
    const into = inside ? -1.2 : 1.2;
    snapped.x = x + bnx * (best + into);
    snapped.z = z + bnz * (best + into);
    if (inside && best < 3) { snapped.x = x; snapped.z = z; }
    return true;
  }

  function spotTaken(x, z, except = -1) {
    for (let f = 0; f < NF; f++) {
      if (f === except || F.state[f] === FLOCK.FREE) continue;
      const dx = F.cx[f] - x, dz = F.cz[f] - z;
      if (dx * dx + dz * dz < PIGEON.SPOT_GAP * PIGEON.SPOT_GAP) return true;
    }
    return false;
  }

  function threatNear(x, z, r) {
    for (let k = 0; k < threats; k++) {
      if (!thrFlush[k]) continue;
      const dx = thrX[k] - x, dz = thrZ[k] - z, rr = thrR[k] + r;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  }

  function setSpot(f) {
    F.cx[f] = spot.cx; F.cz[f] = spot.cz; F.nx[f] = spot.nx; F.nz[f] = spot.nz; F.tx[f] = spot.tx; F.tz[f] = spot.tz;
    F.halfLen[f] = spot.halfLen; F.depth[f] = spot.depth; F.gy[f] = spot.gy; F.roadHalf[f] = spot.roadHalf;
    F.ox[f] = spot.ox; F.oz[f] = spot.oz; F.ls[f] = spot.ls; F.lr[f] = spot.lr;
  }

  // Spot coordinates: along the curb (a) and into the sidewalk (d), to world. Nobody stops right on the curb's edge.
  const offEdge = (d) => (d > -0.1 && d < 0.1 ? (d < 0 ? -0.1 : 0.1) : d);
  const spotX = (f, a, d) => F.cx[f] + F.tx[f] * a - F.nx[f] * d;
  const spotZ = (f, a, d) => F.cz[f] + F.tz[f] * a - F.nz[f] * d;
  const alongOf = (f, x, z) => (x - F.cx[f]) * F.tx[f] + (z - F.cz[f]) * F.tz[f];
  const depthOf = (f, x, z) => -((x - F.cx[f]) * F.nx[f] + (z - F.cz[f]) * F.nz[f]);

  // Ground slot k of n in the flock's spot: a loose cluster in rows along the curb
  function slot(f, k, n, out) {
    const cols = Math.min(n, Math.max(3, Math.floor(F.halfLen[f] * 2 / 0.45)));
    const row = Math.floor(k / cols), col = k % cols, inRow = Math.min(cols, n - row * cols);
    const a = (col - (inRow - 1) * 0.5) * 0.45 + rand(-0.1, 0.1);
    const d = offEdge(clamp(0.45 + row * 0.5 + rand(-0.12, 0.12) + (row % 2) * 0.05, -0.3, F.depth[f] - 0.1));
    out.x = spotX(f, clamp(a, -F.halfLen[f], F.halfLen[f]), d);
    out.z = spotZ(f, clamp(a, -F.halfLen[f], F.halfLen[f]), d);
  }
  const slotOut = { x: 0, z: 0 };

  function allocPigeon() {
    for (let i = 0; i < NP; i++) if (P.state[i] === PIGEON_STATE.FREE) return i;
    return -1;
  }
  function freePigeons() {
    let n = 0;
    for (let i = 0; i < NP; i++) if (P.state[i] === PIGEON_STATE.FREE) n++;
    return n;
  }
  function releasePigeon(i) {
    if (landTo[i] >= 0) { perchUse[landTo[i]] = Math.max(0, perchUse[landTo[i]] - 1); landTo[i] = -1; }
    P.state[i] = PIGEON_STATE.FREE;
    P.flock[i] = -1;
  }
  function releaseFlock(f) {
    const base = f * PIGEON.FLOCK_MAX;
    for (let k = 0; k < F.size[f]; k++) releasePigeon(F.members[base + k]);
    F.size[f] = 0;
    F.state[f] = FLOCK.FREE;
  }

  function startGround(i, f) {
    P.state[i] = PIGEON_STATE.GROUND;
    act[i] = ACT.IDLE; actT[i] = rand(0.2, 1.6); actN[i] = 0; pause[i] = 0;
    P.fold[i] = 1; P.amp[i] = 0; P.pitch[i] = 0; P.roll[i] = 0; P.head[i] = 0; P.puff[i] = 0;
    P.vx[i] = P.vy[i] = P.vz[i] = 0;
    gy[i] = groundAt(P.x[i], P.z[i]);
    P.y[i] = gy[i];
    hopT[i] = 0;
    lastSide[i] = depthOf(f, P.x[i], P.z[i]) < 0 ? -1 : 1;
  }

  // A new flock on the ground (or arriving from the sky) at the spot found last
  function spawnFlock(size, arriving) {
    let f = -1;
    for (let k = 0; k < NF; k++) if (F.state[k] === FLOCK.FREE) { f = k; break; }
    if (f < 0) return -1;
    setSpot(f);
    F.state[f] = FLOCK.ACTIVE;
    F.size[f] = 0;
    F.alarm[f] = 0; F.calm[f] = 1; F.landing[f] = 0; F.airT[f] = 0; F.airDur[f] = 0;
    const base = f * PIGEON.FLOCK_MAX;
    // arrivals come in down the street, from its far end as seen from the camera
    const ahead = Math.hypot(F.ox[f] + F.tx[f] * 30 - view.x, F.oz[f] + F.tz[f] * 30 - view.z) >
      Math.hypot(F.ox[f] - F.tx[f] * 30 - view.x, F.oz[f] - F.tz[f] * 30 - view.z) ? 1 : -1;
    for (let k = 0; k < size; k++) {
      const i = allocPigeon();
      if (i < 0) break;
      F.members[base + F.size[f]++] = i;
      P.flock[i] = f;
      P.scale[i] = rand(0.9, 1.08);
      pickColor(PIGEON_COLORS, random, P.color, i);
      P.phase[i] = rand(0, TAU);
      landTo[i] = -1;
      slot(f, k, size, slotOut);
      P.x[i] = slotOut.x; P.z[i] = slotOut.z;
      P.yaw[i] = rand(-Math.PI, Math.PI);
      startGround(i, f);
      if (arriving) {
        // high over the roadway, a little way off, already on the way down to its slot
        const back = rand(26, 38) * ahead, side = rand(-1, 1) * Math.max(0, F.lr[f] - 1.5);
        const sx = F.ox[f] + F.tx[f] * back + F.nx[f] * side, sz = F.oz[f] + F.tz[f] * back + F.nz[f] * side;
        P.x[i] = sx; P.z[i] = sz; P.y[i] = F.gy[f] + rand(8, 13);
        P.vx[i] = (slotOut.x - sx) * 0.2; P.vz[i] = (slotOut.z - sz) * 0.2; P.vy[i] = -0.5;
        P.state[i] = PIGEON_STATE.FLY;
        P.fold[i] = 0; P.amp[i] = 0.8; launched[i] = 1;
        offX[i] = rand(-1.6, 1.6); offY[i] = rand(-0.8, 0.8); offZ[i] = rand(-1.6, 1.6);
      }
    }
    if (arriving) {
      F.airT[f] = 0; F.airDur[f] = rand(1.5, 3);
      F.s[f] = 0; F.dir[f] = random() < 0.5 ? 1 : -1; F.alt[f] = rand(PIGEON.ALT_MIN, PIGEON.ALT_MAX);
    }
    P.colorVersion++;
    return f;
  }

  function trySpawnFlock(fill) {
    const free = freePigeons();
    const active = NP - free;
    const wanted = Math.round(NP * dayShare);
    if (free < PIGEON.FLOCK_MIN || active + PIGEON.FLOCK_MIN > wanted) return false;
    const r0 = fill ? 6 : 22, r1 = PIGEON.SPOT_RADIUS - 5;
    const yaw = Math.atan2(view.fx, view.fz);
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = Math.sqrt(r0 * r0 + (r1 * r1 - r0 * r0) * random());
      const a = fill || random() < 0.4 ? rand(-Math.PI, Math.PI) : yaw + rand(-0.9, 0.9);
      const x = view.x + Math.sin(a) * r, z = view.z + Math.cos(a) * r;
      if (!fill && r < PIGEON.POP_DISTANCE && inView(x, z)) continue;
      if (player.present && Math.hypot(x - player.x, z - player.z) < 7) continue;
      if (!snapToCurb(x, z) || !trySpot(snapped.x, snapped.z) || spotTaken(spot.cx, spot.cz)) continue;
      if (!fill && Math.hypot(spot.cx - view.x, spot.cz - view.z) < PIGEON.POP_DISTANCE && inView(spot.cx, spot.cz)) continue;
      if (player.present && Math.hypot(spot.cx - player.x, spot.cz - player.z) < 6) continue;
      if (Math.hypot(spot.cx - view.x, spot.cz - view.z) > PIGEON.SPOT_RADIUS) continue;
      if (threatNear(spot.cx, spot.cz, 4)) continue;
      let size = Math.min(free, wanted - active, PIGEON.FLOCK_MIN + Math.floor(random() * (PIGEON.FLOCK_MAX - PIGEON.FLOCK_MIN + 1)));
      // the last few join this flock rather than be left out
      if (Math.min(free, wanted - active) - size < PIGEON.FLOCK_MIN) size = Math.min(PIGEON.FLOCK_MAX, free, wanted - active);
      if (size < PIGEON.FLOCK_MIN) return false;
      // now and then a flock flies in (from out of view) rather than being there already
      const arriving = !fill && !inView(spot.cx, spot.cz) && random() < 0.3;
      return spawnFlock(size, arriving) >= 0;
    }
    return false;
  }

  // ---- Flight plan --------------------------------------------------------------------------------------------------
  const st = { a: 0, c: 0, da: 1, dc: 0, per: 1, arc: false };
  // Point at arc length s round a stadium (straights of 2 ls along the road, half circles of radius r)
  function stadium(s, ls, r) {
    const straight = 2 * ls, arc = Math.PI * r, per = 2 * straight + 2 * arc;
    s = ((s % per) + per) % per;
    st.per = per;
    st.arc = false;
    if (s < straight) { st.a = -ls + s; st.c = r; st.da = 1; st.dc = 0; return; }
    s -= straight;
    if (s < arc) { const th = s / r; st.a = ls + r * Math.sin(th); st.c = r * Math.cos(th); st.da = Math.cos(th); st.dc = -Math.sin(th); st.arc = true; return; }
    s -= arc;
    if (s < straight) { st.a = ls - s; st.c = -r; st.da = -1; st.dc = 0; return; }
    s -= straight;
    const th = s / r;
    st.a = -ls - r * Math.sin(th); st.c = -r * Math.cos(th); st.da = -Math.cos(th); st.dc = Math.sin(th); st.arc = true;
  }
  // Arc length of the stadium point nearest local (a, c)
  function stadiumNearest(a, c, ls, r) {
    const straight = 2 * ls, arc = Math.PI * r;
    if (a >= -ls && a <= ls) return c >= 0 ? a + ls : straight + arc + (ls - a);
    if (a > ls) return straight + r * clamp(Math.atan2(a - ls, c), 0, Math.PI);
    return 2 * straight + arc + r * clamp(Math.atan2(-(a + ls), -c), 0, Math.PI);
  }

  // The flock takes off: from the threat at (x, z) (or calmly, for no threat)
  function flushFlock(f, x, z, withPerched) {
    const base = f * PIGEON.FLOCK_MAX;
    let any = false;
    let fx = 0, fz = 0, n = 0;
    for (let k = 0; k < F.size[f]; k++) {
      const i = F.members[base + k];
      fx += P.x[i]; fz += P.z[i]; n++;
    }
    if (!n) return false;
    fx /= n; fz /= n;
    let nearest = Infinity;
    for (let k = 0; k < F.size[f]; k++) {
      const i = F.members[base + k];
      nearest = Math.min(nearest, Math.hypot(P.x[i] - x, P.z[i] - z));
    }
    for (let k = 0; k < F.size[f]; k++) {
      const i = F.members[base + k];
      const s = P.state[i];
      if (s !== PIGEON_STATE.GROUND && !(withPerched && s === PIGEON_STATE.PERCH)) continue;
      fromPerch[i] = s === PIGEON_STATE.PERCH ? 1 : 0;
      if (fromPerch[i] && landTo[i] >= 0) { perchUse[landTo[i]] = Math.max(0, perchUse[landTo[i]] - 1); landTo[i] = -1; }
      P.state[i] = PIGEON_STATE.TAKEOFF;
      launched[i] = 0;
      // the nearest go first
      timer[i] = 0.02 + random() * 0.2 + clamp((Math.hypot(P.x[i] - x, P.z[i] - z) - nearest) * 0.03, 0, 0.25);
      threatX[i] = x; threatZ[i] = z;
      offX[i] = rand(-1.6, 1.6); offY[i] = rand(-0.9, 0.9); offZ[i] = rand(-1.6, 1.6);
      any = true;
    }
    if (!any) return false;
    if (onFlush) {
      let count = 0;
      for (let k = 0; k < F.size[f]; k++) if (P.state[F.members[base + k]] === PIGEON_STATE.TAKEOFF) count++;
      try { onFlush(fx, fz, count); } catch { /* the sound is not ours to break */ }
    }
    if (!F.airborne[f] || F.landing[f]) {
      // a new loop: start at the point nearest the flock, heading away from the threat
      const la = (fx - F.ox[f]) * F.tx[f] + (fz - F.oz[f]) * F.tz[f];
      const lc = (fx - F.ox[f]) * F.nx[f] + (fz - F.oz[f]) * F.nz[f];
      F.s[f] = stadiumNearest(la, lc, F.ls[f], F.lr[f]);
      stadium(F.s[f], F.ls[f], F.lr[f]);
      const dx = F.tx[f] * st.da + F.nx[f] * st.dc, dz = F.tz[f] * st.da + F.nz[f] * st.dc;
      F.dir[f] = dx * (fx - x) + dz * (fz - z) >= 0 ? 1 : -1;
      F.alt[f] = rand(PIGEON.ALT_MIN, PIGEON.ALT_MAX);
      F.airT[f] = 0;
      F.airDur[f] = rand(PIGEON.FLIGHT_MIN, PIGEON.FLIGHT_MAX);
      F.landing[f] = 0;
      F.ax[f] = fx; F.az[f] = fz; F.ay[f] = F.gy[f] + 2;
    } else {
      F.airDur[f] = Math.max(F.airDur[f], F.airT[f] + PIGEON.FLIGHT_MIN);
    }
    F.alarm[f] = 0;
    return true;
  }

  // Where the flock comes down: the lamp tops near the loop for some, a spot (the same or another) for the rest
  function planLanding(f) {
    F.landing[f] = 1;
    const base = f * PIGEON.FLOCK_MAX;
    // a new spot most of the time, near the loop: either side of the roadway, somewhere along it
    if (F.state[f] === FLOCK.ACTIVE && (random() < 0.6 || threatNear(F.cx[f], F.cz[f], 3))) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const along = rand(-F.ls[f] - 6, F.ls[f] + 6), across = (random() < 0.5 ? -1 : 1) * (F.roadHalf[f] + rand(0.8, 2.6));
        const x = F.ox[f] + F.tx[f] * along + F.nx[f] * across, z = F.oz[f] + F.tz[f] * along + F.nz[f] * across;
        if (trySpot(x, z) && !spotTaken(spot.cx, spot.cz, f) && !threatNear(spot.cx, spot.cz, 3) &&
            Math.hypot(spot.cx - view.x, spot.cz - view.z) < PIGEON.RETIRE_RADIUS - 10) {
          setSpot(f);
          break;
        }
      }
    }
    // lamp tops
    let perchSlots = 0, found = 0;
    if (perchCount && random() < perchChance) {
      found = perches.near(F.ax[f], F.az[f], PIGEON.PERCH_REACH, near, 32);
      for (let k = 0; k < found; k++) perchSlots += Math.max(0, PIGEON.PERCH_SLOTS - perchUse[near[k]]);
    }
    let n = 0;
    for (let k = 0; k < F.size[f]; k++) {
      const i = F.members[base + k];
      if (P.state[i] === PIGEON_STATE.FLY || P.state[i] === PIGEON_STATE.TAKEOFF) n++;
    }
    let groundK = 0, perchK = 0;
    const toPerch = perchSlots >= 2 ? Math.min(perchSlots, Math.ceil(n * rand(0.3, 0.8))) : 0;
    for (let k = 0; k < F.size[f]; k++) {
      const i = F.members[base + k];
      if (P.state[i] !== PIGEON_STATE.FLY && P.state[i] !== PIGEON_STATE.TAKEOFF) continue;
      timer[i] = rand(0, 0.9); // landing delay
      if (landTo[i] >= 0) { perchUse[landTo[i]] = Math.max(0, perchUse[landTo[i]] - 1); landTo[i] = -1; }
      if (perchK < toPerch) {
        // the first lamp with room
        for (let q = 0; q < found; q++) {
          const p = near[q];
          if (perchUse[p] >= PIGEON.PERCH_SLOTS) continue;
          const slotK = perchUse[p]++;
          const off = (slotK - 1) * 0.22;
          landTo[i] = p;
          goalX[i] = perchX[p] + F.nx[f] * off;
          goalZ[i] = perchZ[p] + F.nz[f] * off;
          goalYaw[i] = random() < 0.5 ? Math.atan2(F.tx[f], F.tz[f]) : Math.atan2(-F.tx[f], -F.tz[f]);
          goalY[i] = finite(+perchY[p], 7);
          perchK++;
          break;
        }
        if (landTo[i] >= 0) continue;
      }
      slot(f, groundK++, Math.max(1, n - toPerch), slotOut);
      goalX[i] = slotOut.x; goalZ[i] = slotOut.z;
      goalY[i] = groundAt(slotOut.x, slotOut.z);
    }
  }

  // Cubic Hermite from where the bird is (with its velocity) to (x, y, z), arriving slow
  function startLanding(i, x, y, z, minT = 1.2) {
    const dx = x - P.x[i], dy = y - P.y[i], dz = z - P.z[i];
    const dist = Math.hypot(dx, dy, dz);
    const T = clamp(dist / 6.5, minT, 4);
    let mx = P.vx[i] * T, my = P.vy[i] * T, mz = P.vz[i] * T;
    const m = Math.hypot(mx, my, mz), cap = Math.max(0.5, dist * 1.1);
    if (m > cap) { mx *= cap / m; my *= cap / m; mz *= cap / m; }
    const hd = Math.hypot(dx, dz) || 1;
    h0x[i] = P.x[i]; h0y[i] = P.y[i]; h0z[i] = P.z[i];
    m0x[i] = mx; m0y[i] = my; m0z[i] = mz;
    h1x[i] = x; h1y[i] = y; h1z[i] = z;
    const arrive = Math.min(1.2, hd / T) * T * 0.5;
    m1x[i] = dx / hd * arrive; m1z[i] = dz / hd * arrive; m1y[i] = -0.25 * T;
    hT[i] = T; ht[i] = 0;
    held[i] = 0;
    P.state[i] = PIGEON_STATE.LAND;
  }

  // ---- Steps ---------------------------------------------------------------------------------------------------------
  function gatherThreats(world) {
    threats = 0;
    walkers = 0;
    parked = 0;
    const p = world && world.player;
    player.present = false;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      player.present = true;
      player.x = p.x; player.z = p.z; player.speed = finite(+p.speed, 0);
      addPerson(p.x, p.z, player.speed);
    }
    const cars = world && world.cars;
    if (cars && typeof cars.length === 'number') {
      for (let k = 0; k < cars.length; k++) {
        const c = cars[k];
        if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
        const dx = c.x - view.x, dz = c.z - view.z;
        if (dx * dx + dz * dz > 170 * 170) continue;
        const speed = Math.abs(finite(+c.speed, 0));
        if (speed > PIGEON.CAR_SPEED) addThreat(c.x, c.z, PIGEON.CAR_FLUSH, 1);
        else if (speed < 0.3 && parked < MAX_PARKED) { parkX[parked] = c.x; parkZ[parked] = c.z; parked++; }
      }
    }
    const peds = world && world.peds;
    if (peds && typeof peds.length === 'number') {
      for (let k = 0; k < peds.length; k++) {
        const q = peds[k];
        if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.z)) continue;
        const dx = q.x - view.x, dz = q.z - view.z;
        if (dx * dx + dz * dz > 130 * 130) continue;
        addPerson(q.x, q.z, finite(+q.speed, 0));
      }
    }
  }
  function addThreat(x, z, r, flush) {
    if (threats >= MAX_THREATS) return;
    thrX[threats] = x; thrZ[threats] = z; thrR[threats] = r; thrFlush[threats] = flush; threats++;
  }
  function addPerson(x, z, speed) {
    if (speed > PIGEON.VEHICLE_SPEED) addThreat(x, z, PIGEON.CAR_FLUSH, 1);
    else if (speed > PIGEON.RUN_SPEED) addThreat(x, z, PIGEON.RUNNER_FLUSH, 1);
    else if (walkers < MAX_WALKERS) {
      // a walker is given room; someone standing still only has their feet kept clear
      wlkX[walkers] = x; wlkZ[walkers] = z; wlkR[walkers] = speed > PIGEON.WALKER_SPEED ? PIGEON.WALKER_AVOID : PIGEON.STANDING_ROOM;
      walkers++;
    }
  }

  function nextAction(i, alert) {
    const r = random();
    pause[i] = 0;
    if (alert) {
      act[i] = ACT.IDLE; actT[i] = rand(0.3, 0.9); headGoal[i] = rand(-0.4, -0.25);
      return;
    }
    if (r < 0.42) { act[i] = ACT.PECK; actN[i] = 1 + Math.floor(random() * 4); actT[i] = 0.28; return; }
    if (r < 0.72) {
      const f = P.flock[i];
      const a = alongOf(f, P.x[i], P.z[i]), d = depthOf(f, P.x[i], P.z[i]);
      const na = clamp(a + rand(-0.8, 0.8) - a * 0.15, -F.halfLen[f], F.halfLen[f]);
      const nd = offEdge(clamp(d + rand(-0.55, 0.55) + (0.9 - d) * 0.2, -PIGEON.GUTTER, F.depth[f] - 0.15));
      goalX[i] = spotX(f, na, nd); goalZ[i] = spotZ(f, na, nd);
      act[i] = ACT.WALK; wspd[i] = rand(0.32, 0.55); actT[i] = 6;
      return;
    }
    if (r < 0.86) { act[i] = ACT.IDLE; actT[i] = rand(0.5, 2.2); headGoal[i] = rand(-0.25, 0.12); return; }
    if (r < 0.94) { act[i] = ACT.TURN; goalYaw[i] = wrapAngle(P.yaw[i] + (random() < 0.5 ? -1 : 1) * rand(0.6, 2.2)); actT[i] = 2; return; }
    if (r < 0.975) { act[i] = ACT.HOP; actT[i] = 0.34; startHop(i, P.yaw[i], rand(0.2, 0.45)); return; }
    act[i] = ACT.DISPLAY; actT[i] = rand(2, 3.5); goalYaw[i] = random() < 0.5 ? 1 : -1;
  }

  function startHop(i, heading, dist) {
    hopT[i] = 0.34; hopH[i] = 0.1;
    goalX[i] = P.x[i] + Math.sin(heading) * dist;
    goalZ[i] = P.z[i] + Math.cos(heading) * dist;
    const f = P.flock[i];
    if (f >= 0) {
      const a = clamp(alongOf(f, goalX[i], goalZ[i]), -F.halfLen[f] - 1.5, F.halfLen[f] + 1.5);
      const d = offEdge(clamp(depthOf(f, goalX[i], goalZ[i]), -PIGEON.GUTTER, F.depth[f] - 0.1));
      goalX[i] = spotX(f, a, d); goalZ[i] = spotZ(f, a, d);
    }
  }

  // A walking pigeon's ground: hopping the curb when it crosses it (looked up all the while it is near the curb, whose
  // line in the spot's frame may be a centimetre or two off)
  function followGround(i, f) {
    const d = depthOf(f, P.x[i], P.z[i]);
    const side = d < 0 ? -1 : 1;
    if (side !== lastSide[i] || (d > -0.15 && d < 0.15)) {
      lastSide[i] = side;
      const g = groundAt(P.x[i], P.z[i]);
      if (Math.abs(g - gy[i]) > 0.02 && hopT[i] <= 0) { hopT[i] = 0.22; hopH[i] = Math.max(0.06, g - gy[i] + 0.05); }
      gy[i] = g;
    }
  }

  function stepGroundPigeon(i, dt, f) {
    const alarm = F.alarm[f];
    // a walker near: step aside, and the closer they come the more it fusses
    let nearest = Infinity, wx = 0, wz = 0, room = 0;
    for (let k = 0, o = f * FW; k < flockWalkers[f]; k++) {
      const dx = P.x[i] - fwX[o + k], dz = P.z[i] - fwZ[o + k], d2 = dx * dx + dz * dz;
      if (d2 < nearest) { nearest = d2; wx = dx; wz = dz; room = fwR[o + k]; }
    }
    nearest = Math.sqrt(nearest);
    const walking = room >= PIGEON.WALKER_AVOID;
    if (nearest < room && act[i] !== ACT.AVOID && act[i] !== ACT.HOP && act[i] !== ACT.SETTLE) {
      const d = nearest || 1;
      const ux = wx / d, uz = wz / d;
      if (nearest < 0.9 && walking) {
        act[i] = ACT.HOP; actT[i] = 0.34; startHop(i, Math.atan2(ux, uz), rand(0.5, 0.8));
        if (F.calm[f] <= 0) F.alarm[f] += 0.8;
      } else {
        act[i] = ACT.AVOID; actT[i] = 1.6; wspd[i] = walking ? rand(0.95, 1.25) : rand(0.5, 0.7);
        const a = clamp(alongOf(f, P.x[i] + ux * 1.2, P.z[i] + uz * 1.2), -F.halfLen[f] - 1.5, F.halfLen[f] + 1.5);
        const dd = offEdge(clamp(depthOf(f, P.x[i] + ux * 1.2, P.z[i] + uz * 1.2), -PIGEON.GUTTER, F.depth[f] - 0.1));
        goalX[i] = spotX(f, a, dd); goalZ[i] = spotZ(f, a, dd);
        if (F.calm[f] <= 0 && walking) F.alarm[f] += 0.25;
      }
    }
    const alert = alarm > 0.6 || nearest < (walking ? 5 : 1.5);

    actT[i] -= dt;
    let moveSpeed = 0;
    let headT = headGoal[i], pitchT = 0, rollT = 0, puffT = 0;
    switch (act[i]) {
      case ACT.IDLE: {
        if (random() < dt * 1.8) {
          headGoal[i] = alert ? rand(-0.45, -0.25) : rand(-0.25, 0.12);
          if (random() < 0.3) P.yaw[i] = wrapAngle(P.yaw[i] + rand(-0.3, 0.3));
        }
        headT = headGoal[i];
        if (actT[i] <= 0) nextAction(i, alert);
        break;
      }
      case ACT.PECK: {
        // a quick dip to the ground and back; a short pause between pecks
        if (pause[i] > 0) {
          pause[i] -= dt;
          headT = 0.1;
        } else {
          const s = clamp(1 - actT[i] / 0.28, 0, 1);
          const dip = Math.pow(Math.sin(Math.PI * s), 0.6);
          headT = 1.5 * dip;
          pitchT = 0.48 * dip;
          if (actT[i] <= 0) {
            if (actN[i] > 1) { actN[i]--; actT[i] = 0.28; pause[i] = rand(0.08, 0.5); }
            else nextAction(i, alert);
          }
        }
        break;
      }
      case ACT.WALK:
      case ACT.AVOID: {
        const dx = goalX[i] - P.x[i], dz = goalZ[i] - P.z[i], d = Math.hypot(dx, dz);
        if (d < 0.04 || actT[i] <= 0) { nextAction(i, alert); break; }
        const want = Math.atan2(dx, dz);
        P.yaw[i] = turnToward(P.yaw[i], want, (act[i] === ACT.AVOID ? 9 : 6) * dt);
        const before = stepPh[i];
        stepPh[i] += dt * (act[i] === ACT.AVOID ? 6.5 : 4.2);
        if (pause[i] > 0) pause[i] -= dt;
        else if (Math.floor(stepPh[i]) !== Math.floor(before) && act[i] === ACT.WALK && random() < 0.16) pause[i] = rand(0.12, 0.45);
        if (pause[i] <= 0 && Math.abs(wrapAngle(want - P.yaw[i])) < 0.9) {
          const pulse = 0.5 - 0.5 * Math.cos(TAU * stepPh[i]);
          moveSpeed = Math.min(d / dt, wspd[i] * (0.3 + 0.7 * pulse));
        }
        headT = -0.1 + 0.24 * Math.sin(TAU * stepPh[i] - 1.2);
        rollT = 0.07 * Math.sin(Math.PI * stepPh[i]);
        break;
      }
      case ACT.TURN: {
        stepPh[i] += dt * 4;
        P.yaw[i] = turnToward(P.yaw[i], goalYaw[i], 3 * (0.5 - 0.5 * Math.cos(TAU * stepPh[i])) * dt * 2);
        headT = -0.08 + 0.15 * Math.sin(TAU * stepPh[i]);
        rollT = 0.05 * Math.sin(Math.PI * stepPh[i]);
        if (Math.abs(wrapAngle(goalYaw[i] - P.yaw[i])) < 0.05 || actT[i] <= 0) nextAction(i, alert);
        break;
      }
      case ACT.HOP: {
        if (actT[i] <= 0) { P.fold[i] = 1; nextAction(i, alert); break; }
        break;
      }
      case ACT.DISPLAY: {
        // a male's coo display: puffed up, turning round and round, head bobbing
        if (alert) { nextAction(i, alert); break; }
        P.yaw[i] = wrapAngle(P.yaw[i] + goalYaw[i] * 2.6 * dt);
        stepPh[i] += dt * 3;
        headT = -0.3 + 0.35 * Math.max(0, Math.sin(TAU * stepPh[i]));
        pitchT = -0.12;
        puffT = 1;
        if (actT[i] <= 0) nextAction(i, alert);
        break;
      }
      case ACT.SETTLE: {
        P.amp[i] = approach(P.amp[i], 0, 10, dt);
        P.fold[i] = approach(P.fold[i], 1, 9, dt);
        headT = -0.2;
        if (actT[i] <= 0) { P.fold[i] = 1; P.amp[i] = 0; nextAction(i, alert); }
        break;
      }
    }
    if (moveSpeed > 0) {
      P.x[i] += Math.sin(P.yaw[i]) * moveSpeed * dt;
      P.z[i] += Math.cos(P.yaw[i]) * moveSpeed * dt;
      followGround(i, f);
    }
    // hops: up, over and down, wings flicked half open
    let lift = 0;
    if (hopT[i] > 0) {
      const total = act[i] === ACT.HOP ? 0.34 : 0.22;
      const s = clamp(1 - hopT[i] / total, 0, 1);
      if (act[i] === ACT.HOP) {
        P.x[i] += (goalX[i] - P.x[i]) * Math.min(1, dt / Math.max(hopT[i], dt));
        P.z[i] += (goalZ[i] - P.z[i]) * Math.min(1, dt / Math.max(hopT[i], dt));
        P.yaw[i] = turnToward(P.yaw[i], Math.atan2(goalX[i] - P.x[i] + 1e-6, goalZ[i] - P.z[i]), 8 * dt);
        followGround(i, f);
        P.fold[i] = 1 - 0.6 * Math.sin(Math.PI * s);
        P.amp[i] = 0.75 * Math.sin(Math.PI * s);
        P.phase[i] = (P.phase[i] + dt * TAU * 11) % TAU;
      }
      lift = hopH[i] * Math.sin(Math.PI * s);
      hopT[i] -= dt;
      if (hopT[i] <= 0) { hopT[i] = 0; if (act[i] === ACT.HOP) { P.fold[i] = 1; P.amp[i] = 0; } }
    } else if (act[i] !== ACT.SETTLE) {
      P.amp[i] = 0;
      P.fold[i] = approach(P.fold[i], 1, 12, dt);
    }
    P.y[i] = gy[i] + lift;
    P.head[i] = approach(P.head[i], headT, act[i] === ACT.PECK ? 30 : 12, dt);
    P.pitch[i] = approach(P.pitch[i], pitchT, act[i] === ACT.PECK ? 30 : 10, dt);
    P.roll[i] = approach(P.roll[i], rollT, 14, dt);
    P.puff[i] = approach(P.puff[i], puffT, 3, dt);
  }

  // Wingbeats: flapping at freq (Hz) with amplitude amp, or gliding with the wings held up in a V at `glideAmp`
  function wings(i, dt, gliding, freq, amp, glideAmp) {
    const before = P.phase[i];
    if (gliding && held[i]) {
      P.phase[i] = Math.PI / 2;
      P.amp[i] = approach(P.amp[i], glideAmp, 6, dt);
      return;
    }
    let ph = before + dt * TAU * freq;
    if (gliding && before <= Math.PI / 2 && ph >= Math.PI / 2) { ph = Math.PI / 2; held[i] = 1; }
    if (!gliding) held[i] = 0;
    P.phase[i] = ph % TAU;
    P.amp[i] = approach(P.amp[i], amp, 8, dt);
  }

  function orientFlight(i, dt, pitchBias) {
    const hs = Math.hypot(P.vx[i], P.vz[i]);
    if (hs > 0.3) {
      const yaw = Math.atan2(P.vx[i], P.vz[i]);
      const turned = wrapAngle(yaw - P.yaw[i]);
      const step = clamp(turned, -12 * dt, 12 * dt);
      P.yaw[i] = wrapAngle(P.yaw[i] + step);
      yawRate[i] = approach(yawRate[i], step / Math.max(dt, 1e-4), 8, dt);
    }
    const bank = clamp(-Math.atan(yawRate[i] * hs / 9.81), -0.9, 0.9);
    P.roll[i] = approach(P.roll[i], bank, 6, dt);
    P.pitch[i] = approach(P.pitch[i], clamp(-Math.atan2(P.vy[i], Math.max(hs, 0.5)) * 0.7 + pitchBias, -0.9, 0.7), 6, dt);
  }

  function stepFlock(f, dt) {
    const base = f * PIGEON.FLOCK_MAX;
    let air = 0, grounded = 0, perched = 0;
    let mx = 0, my = 0, mz = 0, mvx = 0, mvy = 0, mvz = 0;
    let gx = 0, gz = 0;
    for (let k = 0; k < F.size[f]; k++) {
      const i = F.members[base + k], s = P.state[i];
      if (s === PIGEON_STATE.GROUND) { grounded++; gx += P.x[i]; gz += P.z[i]; } else if (s === PIGEON_STATE.PERCH) perched++;
      else {
        air++;
        mx += P.x[i]; my += P.y[i]; mz += P.z[i];
        mvx += P.vx[i]; mvy += P.vy[i]; mvz += P.vz[i];
      }
    }
    F.airborne[f] = air; F.grounded[f] = grounded; F.perched[f] = perched;
    if (air) {
      mx /= air; my /= air; mz /= air;
      F.mx[f] = mx; F.my[f] = my; F.mz[f] = mz;
      F.mvx[f] = mvx / air; F.mvy[f] = mvy / air; F.mvz[f] = mvz / air;
    }
    const camDist = Math.hypot(F.cx[f] - view.x, F.cz[f] - view.z);
    // too far: dropped (any flyers too, once well away)
    if (camDist > PIGEON.RETIRE_RADIUS && (!air || Math.hypot(mx - view.x, mz - view.z) > PIGEON.RETIRE_RADIUS || !inView(mx, mz))) {
      releaseFlock(f);
      return;
    }
    F.calm[f] = Math.max(0, F.calm[f] - dt);
    F.alarm[f] = Math.max(0, F.alarm[f] - dt * 0.5);

    // threats to the ones on the ground; the walkers near them, for each to keep its distance
    flockWalkers[f] = 0;
    if (grounded && F.state[f] === FLOCK.ACTIVE) {
      gx /= grounded; gz /= grounded;
      const reach = F.halfLen[f] + 4, wr = F.halfLen[f] + 6;
      for (let k = 0; k < walkers && flockWalkers[f] < FW; k++) {
        const dx = wlkX[k] - gx, dz = wlkZ[k] - gz;
        if (dx * dx + dz * dz > wr * wr) continue;
        const o = f * FW + flockWalkers[f]++;
        fwX[o] = wlkX[k]; fwZ[o] = wlkZ[k]; fwR[o] = wlkR[k];
      }
      for (let t = 0; t < threats; t++) {
        if (!thrFlush[t]) continue;
        const dx = thrX[t] - gx, dz = thrZ[t] - gz, rr = thrR[t] + reach;
        if (dx * dx + dz * dz > rr * rr) continue;
        let hit = false;
        for (let k = 0; k < F.size[f] && !hit; k++) {
          const i = F.members[base + k];
          if (P.state[i] !== PIGEON_STATE.GROUND) continue;
          const ex = P.x[i] - thrX[t], ez = P.z[i] - thrZ[t];
          hit = ex * ex + ez * ez < thrR[t] * thrR[t];
        }
        if (hit) { flushFlock(f, thrX[t], thrZ[t], false); break; }
      }
      if (F.alarm[f] > PIGEON.ALARM_FLUSH && player.present) flushFlock(f, player.x, player.z, false);
    }

    if (F.state[f] === FLOCK.LEAVING && (grounded || perched)) flushFlock(f, F.cx[f] + F.nx[f] * 3, F.cz[f] + F.nz[f] * 3, true);

    if (!F.airborne[f] && !air) { F.landing[f] = 0; return; }
    // the point the flock wheels round
    F.airT[f] += dt;
    if (F.state[f] === FLOCK.LEAVING) {
      // off along the street, climbing, until out of sight
      const sp = PIGEON.CRUISE;
      F.ax[f] += F.tx[f] * F.dir[f] * sp * dt;
      F.az[f] += F.tz[f] * F.dir[f] * sp * dt;
      F.ay[f] = approach(F.ay[f], F.gy[f] + 24, 0.4, dt);
      F.avx[f] = F.tx[f] * F.dir[f] * sp; F.avz[f] = F.tz[f] * F.dir[f] * sp;
      if (F.airT[f] > 25 || (air && !inView(mx, mz) && Math.hypot(mx - view.x, mz - view.z) > 50)) releaseFlock(f);
      return;
    }
    // the point waits for a straggling flock, and slows in the turns
    const lag = air ? Math.hypot(mx - F.ax[f], mz - F.az[f]) : 0;
    stadium(F.s[f], F.ls[f], F.lr[f]);
    let speed = PIGEON.CRUISE * clamp(1.25 - (lag - 4) / 12, 0.45, 1.15);
    if (st.arc) speed = Math.min(speed, Math.sqrt(9 * F.lr[f]));
    F.s[f] += F.dir[f] * speed * dt;
    stadium(F.s[f], F.ls[f], F.lr[f]);
    const climb = clamp(F.airT[f] / 2.2, 0, 1);
    F.ax[f] = F.ox[f] + F.tx[f] * st.a + F.nx[f] * st.c;
    F.az[f] = F.oz[f] + F.tz[f] * st.a + F.nz[f] * st.c;
    F.ay[f] = F.gy[f] + 2 + (F.alt[f] - 2) * climb + 1.5 * Math.sin(F.s[f] * 0.08);
    F.avx[f] = (F.tx[f] * st.da + F.nx[f] * st.dc) * speed * F.dir[f];
    F.avz[f] = (F.tz[f] * st.da + F.nz[f] * st.dc) * speed * F.dir[f];

    if (!F.landing[f] && F.airT[f] >= F.airDur[f]) planLanding(f);
  }

  const SEP2 = PIGEON.SEPARATION * PIGEON.SEPARATION;
  function stepFlyingPigeon(i, dt, f) {
    const base = f * PIGEON.FLOCK_MAX;
    if (P.state[i] === PIGEON_STATE.TAKEOFF && !launched[i]) {
      // the delay before it goes: crouched, head up
      timer[i] -= dt;
      P.head[i] = approach(P.head[i], -0.4, 12, dt);
      P.pitch[i] = approach(P.pitch[i], 0.15, 12, dt);
      if (timer[i] > 0) return;
      launched[i] = 1;
      let ux = P.x[i] - threatX[i], uz = P.z[i] - threatZ[i];
      const d = Math.hypot(ux, uz);
      if (d > 1e-3) { ux /= d; uz /= d; } else { ux = F.nx[f]; uz = F.nz[f]; }
      ux += F.nx[f] * 0.7; uz += F.nz[f] * 0.7;
      const u = Math.hypot(ux, uz) || 1;
      const h = fromPerch[i] ? rand(1.5, 2.5) : rand(2.2, 3.5);
      P.vx[i] = ux / u * h; P.vz[i] = uz / u * h;
      P.vy[i] = fromPerch[i] ? rand(0.2, 1) : rand(3, 4.3);
      timer[i] = rand(0.75, 1);
      held[i] = 0;
    }
    if (P.state[i] === PIGEON_STATE.TAKEOFF) {
      timer[i] -= dt;
      // steep climb with deep, fast beats; turning towards the flock's point
      const ax = F.ax[f] - P.x[i], az = F.az[f] - P.z[i], d = Math.hypot(ax, az) || 1;
      P.vx[i] += ax / d * 5 * dt;
      P.vz[i] += az / d * 5 * dt;
      P.vy[i] = approach(P.vy[i], fromPerch[i] ? 0.5 : 2.4, 2.5, dt);
      P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.z[i] += P.vz[i] * dt;
      P.fold[i] = approach(P.fold[i], 0, 22, dt);
      P.head[i] = approach(P.head[i], 0, 10, dt);
      wings(i, dt, false, 11, 1.15, 0);
      orientFlight(i, dt, 0);
      if (timer[i] <= 0) { P.state[i] = PIGEON_STATE.FLY; glideT[i] = 0; }
      return;
    }
    if (F.landing[f]) {
      timer[i] -= dt;
      if (timer[i] <= 0) {
        fromPerch[i] = 0;
        startLanding(i, goalX[i], goalY[i], goalZ[i]);
        return;
      }
    }
    // boids: seek the flock's point (with an offset of its own), cohesion, alignment, separation
    const tx = F.ax[f] + offX[i] - P.x[i], ty = F.ay[f] + offY[i] - P.y[i], tz = F.az[f] + offZ[i] - P.z[i];
    const dist = Math.hypot(tx, ty, tz) || 1e-3;
    const anchorSpeed = Math.hypot(F.avx[f], F.avz[f]);
    const want = Math.min(PIGEON.SPEED_MAX, dist * 1.1 + anchorSpeed * 0.75);
    let sx = (tx / dist * want - P.vx[i]) * 2.2;
    let sy = (ty / dist * want - P.vy[i]) * 2.2;
    let sz = (tz / dist * want - P.vz[i]) * 2.2;
    sx += (F.mx[f] - P.x[i]) * 0.35 + (F.mvx[f] - P.vx[i]) * 0.6;
    sy += (F.my[f] - P.y[i]) * 0.35 + (F.mvy[f] - P.vy[i]) * 0.6;
    sz += (F.mz[f] - P.z[i]) * 0.35 + (F.mvz[f] - P.vz[i]) * 0.6;
    for (let k = 0; k < F.size[f]; k++) {
      const j = F.members[base + k];
      if (j === i) continue;
      const s = P.state[j];
      if (s !== PIGEON_STATE.FLY && s !== PIGEON_STATE.TAKEOFF && s !== PIGEON_STATE.LAND) continue;
      const dx = P.x[i] - P.x[j], dy = P.y[i] - P.y[j], dz = P.z[i] - P.z[j];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= SEP2) continue;
      const d = Math.sqrt(d2) || 1e-3;
      const push = Math.min(40, 14 * (PIGEON.SEPARATION / d - 1));
      if (d2 < 1e-8) { sx += push * (random() - 0.5); sz += push * (random() - 0.5); continue; }
      sx += dx / d * push; sy += dy / d * push; sz += dz / d * push;
    }
    const floor = F.gy[f] + 2.5;
    if (P.y[i] < floor) sy += (floor - P.y[i]) * 6;
    const s = Math.hypot(sx, sy, sz), cap = 22;
    if (s > cap) { sx *= cap / s; sy *= cap / s; sz *= cap / s; }
    P.vx[i] += sx * dt; P.vy[i] += sy * dt; P.vz[i] += sz * dt;
    let v = Math.hypot(P.vx[i], P.vy[i], P.vz[i]);
    if (v > PIGEON.SPEED_MAX) { P.vx[i] *= PIGEON.SPEED_MAX / v; P.vy[i] *= PIGEON.SPEED_MAX / v; P.vz[i] *= PIGEON.SPEED_MAX / v; v = PIGEON.SPEED_MAX; }
    else if (v < PIGEON.SPEED_MIN) {
      const k = v > 1e-3 ? PIGEON.SPEED_MIN / v : 0;
      if (k) { P.vx[i] *= k; P.vy[i] *= k; P.vz[i] *= k; } else { P.vx[i] = Math.sin(P.yaw[i]) * PIGEON.SPEED_MIN; P.vz[i] = Math.cos(P.yaw[i]) * PIGEON.SPEED_MIN; }
    }
    P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.z[i] += P.vz[i] * dt;
    // beats: hard when climbing or slow, glides now and then, and on the way down
    const climbing = P.vy[i] > 0.8 || v < 6.5;
    if (glideT[i] > 0) glideT[i] -= dt;
    else if (!climbing && random() < dt * 0.35) glideT[i] = rand(0.5, 1.4);
    const gliding = !climbing && (P.vy[i] < -1.4 || glideT[i] > 0);
    wings(i, dt, gliding, climbing ? 9.5 : 6.5, climbing ? 1.05 : 0.85, 0.42);
    P.fold[i] = approach(P.fold[i], 0, 12, dt);
    P.head[i] = approach(P.head[i], 0, 6, dt);
    orientFlight(i, dt, 0);
  }

  function stepLandingPigeon(i, dt, f) {
    ht[i] += dt;
    const T = hT[i], s = clamp(ht[i] / T, 0, 1);
    const s2 = s * s, s3 = s2 * s;
    const a0 = 2 * s3 - 3 * s2 + 1, b0 = s3 - 2 * s2 + s, a1 = -2 * s3 + 3 * s2, b1 = s3 - s2;
    const da0 = 6 * s2 - 6 * s, db0 = 3 * s2 - 4 * s + 1, da1 = -6 * s2 + 6 * s, db1 = 3 * s2 - 2 * s;
    P.x[i] = a0 * h0x[i] + b0 * m0x[i] + a1 * h1x[i] + b1 * m1x[i];
    P.y[i] = Math.max(Math.min(h0y[i], h1y[i]) - 0.02, a0 * h0y[i] + b0 * m0y[i] + a1 * h1y[i] + b1 * m1y[i]);
    P.z[i] = a0 * h0z[i] + b0 * m0z[i] + a1 * h1z[i] + b1 * m1z[i];
    P.vx[i] = (da0 * h0x[i] + db0 * m0x[i] + da1 * h1x[i] + db1 * m1x[i]) / T;
    P.vy[i] = (da0 * h0y[i] + db0 * m0y[i] + da1 * h1y[i] + db1 * m1y[i]) / T;
    P.vz[i] = (da0 * h0z[i] + db0 * m0z[i] + da1 * h1z[i] + db1 * m1z[i]) / T;
    // off a lamp: a few beats; then a glide with the wings in a V; at the end a flare, legs down, tail spread
    const flare = clamp((s - 0.7) / 0.3, 0, 1);
    if (fromPerch[i] && s < 0.15) wings(i, dt, false, 8, 0.9, 0);
    else if (flare > 0) wings(i, dt, false, 10, 1, 0);
    else wings(i, dt, true, 6, 0.8, 0.45);
    P.fold[i] = approach(P.fold[i], s > 0.6 ? 0.35 : 0, 10, dt);
    orientFlight(i, dt, -0.8 * flare);
    if (s >= 1) {
      P.x[i] = h1x[i]; P.y[i] = h1y[i]; P.z[i] = h1z[i];
      P.vx[i] = P.vy[i] = P.vz[i] = 0;
      P.pitch[i] = -0.3;
      if (landTo[i] >= 0) {
        P.state[i] = PIGEON_STATE.PERCH;
        timer[i] = rand(PIGEON.PERCH_TIME_MIN, PIGEON.PERCH_TIME_MAX);
        act[i] = ACT.SETTLE; actT[i] = 0.5;
        goalYaw[i] = finite(goalYaw[i], P.yaw[i]);
      } else {
        const keep = P.yaw[i];
        startGround(i, f);
        P.yaw[i] = keep;
        P.fold[i] = 0.35; P.amp[i] = 0.4; P.pitch[i] = -0.3;
        act[i] = ACT.SETTLE; actT[i] = 0.45;
        F.calm[f] = 1.5;
      }
    }
  }

  function stepPerchedPigeon(i, dt, f) {
    timer[i] -= dt;
    actT[i] -= dt;
    P.yaw[i] = turnToward(P.yaw[i], goalYaw[i], 3 * dt);
    if (act[i] === ACT.SETTLE) {
      P.amp[i] = approach(P.amp[i], 0, 10, dt);
      P.fold[i] = approach(P.fold[i], 1, 9, dt);
      if (actT[i] <= 0) { act[i] = ACT.IDLE; actT[i] = rand(0.5, 2); P.fold[i] = 1; P.amp[i] = 0; }
    } else if (actT[i] <= 0) {
      // looking about, preening, shuffling round
      const r = random();
      act[i] = r < 0.25 ? ACT.PECK : ACT.IDLE;
      actT[i] = act[i] === ACT.PECK ? 0.5 : rand(0.6, 2.5);
      headGoal[i] = rand(-0.3, 0.15);
      if (r > 0.85) goalYaw[i] = wrapAngle(goalYaw[i] + Math.PI);
    }
    const preen = act[i] === ACT.PECK ? Math.sin(Math.PI * clamp(1 - actT[i] / 0.5, 0, 1)) : 0;
    P.head[i] = approach(P.head[i], act[i] === ACT.PECK ? 1.1 * preen : headGoal[i], 10, dt);
    P.pitch[i] = approach(P.pitch[i], 0.15 * preen, 10, dt);
    P.roll[i] = approach(P.roll[i], 0, 8, dt);
    if (timer[i] <= 0 && F.state[f] === FLOCK.ACTIVE) {
      // down to the flock's spot
      if (landTo[i] >= 0) { perchUse[landTo[i]] = Math.max(0, perchUse[landTo[i]] - 1); landTo[i] = -1; }
      slot(f, Math.floor(random() * Math.max(1, F.size[f])), Math.max(1, F.size[f]), slotOut);
      P.vx[i] = Math.sin(P.yaw[i]) * 1.5; P.vy[i] = 0.6; P.vz[i] = Math.cos(P.yaw[i]) * 1.5;
      fromPerch[i] = 1;
      startLanding(i, slotOut.x, groundAt(slotOut.x, slotOut.z), slotOut.z, 1.6);
    }
  }

  function separateGround(f) {
    const base = f * PIGEON.FLOCK_MAX, gap = PIGEON.GROUND_GAP, gap2 = gap * gap;
    for (let a = 0; a < F.size[f]; a++) {
      const i = F.members[base + a];
      if (P.state[i] !== PIGEON_STATE.GROUND) continue;
      for (let b = a + 1; b < F.size[f]; b++) {
        const j = F.members[base + b];
        if (P.state[j] !== PIGEON_STATE.GROUND) continue;
        const dx = P.x[j] - P.x[i], dz = P.z[j] - P.z[i], d2 = dx * dx + dz * dz;
        if (d2 >= gap2) continue;
        let d = Math.sqrt(d2), ux = dx / d, uz = dz / d;
        if (!(d > 1e-4)) { const a2 = random() * TAU; ux = Math.cos(a2); uz = Math.sin(a2); d = 0; }
        const push = (gap - d) * 0.5;
        P.x[i] -= ux * push; P.z[i] -= uz * push;
        P.x[j] += ux * push; P.z[j] += uz * push;
        followGround(i, f);
        followGround(j, f);
        if (hopT[i] <= 0) P.y[i] = gy[i];
        if (hopT[j] <= 0) P.y[j] = gy[j];
      }
    }
  }

  function stepPigeons(dt) {
    for (let f = 0; f < NF; f++) if (F.state[f] !== FLOCK.FREE) stepFlock(f, dt);
    for (let i = 0; i < NP; i++) {
      const s = P.state[i];
      if (s === PIGEON_STATE.FREE) continue;
      const f = P.flock[i];
      if (f < 0 || F.state[f] === FLOCK.FREE) { releasePigeon(i); continue; }
      if (s === PIGEON_STATE.GROUND) stepGroundPigeon(i, dt, f);
      else if (s === PIGEON_STATE.TAKEOFF || s === PIGEON_STATE.FLY) stepFlyingPigeon(i, dt, f);
      else if (s === PIGEON_STATE.LAND) stepLandingPigeon(i, dt, f);
      else if (s === PIGEON_STATE.PERCH) stepPerchedPigeon(i, dt, f);
    }
    for (let f = 0; f < NF; f++) if (F.state[f] !== FLOCK.FREE && F.grounded[f] > 1) separateGround(f);

    // population (fewer as night falls): drop or send off flocks beyond the wanted number, then add new ones
    const wanted = Math.round(NP * dayShare);
    const active = NP - freePigeons();
    if (active > wanted + PIGEON.FLOCK_MIN) {
      let pick = -1, score = -Infinity;
      for (let f = 0; f < NF; f++) {
        if (F.state[f] !== FLOCK.ACTIVE) continue;
        const d = Math.hypot(F.cx[f] - view.x, F.cz[f] - view.z) + (inView(F.cx[f], F.cz[f]) ? 0 : 1000);
        if (d > score) { score = d; pick = f; }
      }
      if (pick >= 0) {
        if (score > 1000 || score > 90) releaseFlock(pick);
        else { F.state[pick] = FLOCK.LEAVING; F.airT[pick] = 0; F.dir[pick] = random() < 0.5 ? 1 : -1; }
      }
    }
    spawnWait -= dt;
    if (!filled) {
      // fill the neighbourhood at once (behind the loading screen, or right after a jump)
      for (let k = 0, misses = 0; k < 80 && misses < 12; k++) misses = trySpawnFlock(true) ? 0 : misses + 1;
      filled = true;
      spawnWait = 0.5;
    } else if (spawnWait <= 0) {
      if (trySpawnFlock(false)) spawnWait = 0.25;
      else spawnWait = 0.1;
    }
    let top = 0;
    for (let i = NP - 1; i >= 0; i--) if (P.state[i] !== PIGEON_STATE.FREE) { top = i + 1; break; }
    P.top = top;
  }

  // ---- Gulls --------------------------------------------------------------------------------------------------------
  function gullCentre(out) {
    let best = -1;
    for (let k = 0; k < 6; k++) {
      const a = rand(-Math.PI, Math.PI), r = rand(GULL.CENTRE_MIN, GULL.CENTRE_MAX);
      const x = view.x + Math.sin(a) * r, z = view.z + Math.cos(a) * r;
      if ((r < 160 && inView(x, z)) || !nearWater(x, z)) continue; // they come in from out of sight
      // more of the water around it: likelier out over the river than over the first row of buildings
      let score = 1;
      for (let q = 0; q < 4; q++) if (nearWater(x + Math.sin(q * 1.57) * 60, z + Math.cos(q * 1.57) * 60)) score++;
      if (score > best) { best = score; out.x = x; out.z = z; }
    }
    return best > 0;
  }
  const centre = { x: 0, z: 0 };

  function spawnGull() {
    let g = -1;
    for (let k = 0; k < NG; k++) if (G.state[k] === 0) { g = k; break; }
    if (g < 0 || !gullCentre(centre)) return;
    G.state[g] = 1;
    gcx[g] = centre.x; gcz[g] = centre.z;
    grad[g] = rand(GULL.RADIUS_MIN, GULL.RADIUS_MAX);
    galt[g] = rand(GULL.ALT_MIN, GULL.ALT_MAX);
    gspd[g] = rand(GULL.SPEED_MIN, GULL.SPEED_MAX);
    gdir[g] = random() < 0.5 ? 1 : -1;
    gseed[g] = rand(0, 100);
    gclimb[g] = 0;
    gage[g] = 0;
    // start on the far side of its circle from the camera
    gang[g] = Math.atan2(centre.z - view.z, centre.x - view.x) + rand(-0.8, 0.8);
    gflapT[g] = rand(0, 3);
    gbeats[g] = 0;
    G.scale[g] = rand(0.9, 1.1);
    G.phase[g] = Math.PI / 2; G.amp[g] = 0.06; G.fold[g] = 0; G.head[g] = 0; gheld[g] = 1;
    pickColor(GULL_COLORS, random, G.color, g);
    G.colorVersion++;
    placeGull(g, 0);
    G.roll[g] = 0;
  }

  function placeGull(g, dt) {
    const px = G.x[g], pz = G.z[g];
    G.x[g] = gcx[g] + Math.cos(gang[g]) * grad[g];
    G.z[g] = gcz[g] + Math.sin(gang[g]) * grad[g];
    G.y[g] = galt[g] + gclimb[g] + 3 * Math.sin(time * 0.3 + gseed[g]);
    if (dt > 0) {
      const vx = (G.x[g] - px) / dt, vz = (G.z[g] - pz) / dt, hs = Math.hypot(vx, vz);
      if (hs > 0.1) {
        const yaw = Math.atan2(vx, vz);
        const rate = wrapAngle(yaw - G.yaw[g]) / dt;
        G.yaw[g] = yaw;
        G.roll[g] = approach(G.roll[g], clamp(-Math.atan(rate * hs / 9.81), -0.6, 0.6), 2, dt);
      }
    } else {
      G.yaw[g] = Math.atan2(-Math.sin(gang[g]) * gdir[g], Math.cos(gang[g]) * gdir[g]);
    }
  }

  function stepGulls(dt) {
    gullCheck -= dt;
    if (gullCheck <= 0) {
      gullCheck = GULL.CHECK_EVERY;
      let wet = nearWater(view.x, view.z);
      for (let q = 0; q < 4 && !wet; q++) wet = nearWater(view.x + Math.sin(q * 1.57 + 0.4) * 120, view.z + Math.cos(q * 1.57 + 0.4) * 120);
      const dark = clamp((dayShareNight - 0.4) / 0.4, 0, 1);
      gullWanted = wet ? Math.round(NG * (1 - dark)) : 0;
      let n = 0;
      for (let g = 0; g < NG; g++) if (G.state[g] === 1) n++;
      if (n < gullWanted) spawnGull();
      else if (n > gullWanted) {
        for (let g = 0; g < NG; g++) if (G.state[g] === 1) { G.state[g] = 2; gdx[g] = Math.sin(G.yaw[g]); gdz[g] = Math.cos(G.yaw[g]); gage[g] = 0; break; }
      }
    }
    let top = 0;
    for (let g = 0; g < NG; g++) {
      if (!G.state[g]) continue;
      top = g + 1;
      gage[g] += dt;
      if (G.state[g] === 1) {
        gang[g] += gdir[g] * gspd[g] / grad[g] * dt;
        gang[g] %= TAU;
        // the wind carries the circle along, slowly
        gcx[g] += Math.sin(gseed[g]) * 0.35 * dt;
        gcz[g] += Math.cos(gseed[g]) * 0.35 * dt;
        gclimb[g] = approach(gclimb[g], 0, 0.08, dt);
        placeGull(g, dt);
      } else {
        G.x[g] += gdx[g] * gspd[g] * dt;
        G.z[g] += gdz[g] * gspd[g] * dt;
        G.y[g] += 1.2 * dt;
        G.roll[g] = approach(G.roll[g], 0, 1, dt);
      }
      // a few slow beats now and then; otherwise a glide on slightly raised wings
      gflapT[g] -= dt;
      if (gbeats[g] > 0) {
        const before = G.phase[g];
        G.phase[g] = (G.phase[g] + dt * TAU * 2.7) % TAU;
        if (G.phase[g] < before) gbeats[g]--;
        G.amp[g] = approach(G.amp[g], 0.6, 6, dt);
        gheld[g] = 0;
      } else {
        if (!gheld[g]) {
          const before = G.phase[g];
          const ph = before + dt * TAU * 2.7;
          if (before <= Math.PI / 2 && ph >= Math.PI / 2) { G.phase[g] = Math.PI / 2; gheld[g] = 1; } else G.phase[g] = ph % TAU;
        }
        G.amp[g] = approach(G.amp[g], 0.07, 3, dt);
        if (gflapT[g] <= 0) { gbeats[g] = 2 + Math.floor(random() * 4); gflapT[g] = rand(GULL.FLAP_EVERY_MIN, GULL.FLAP_EVERY_MAX); }
      }
      G.pitch[g] = approach(G.pitch[g], gbeats[g] > 0 ? -0.08 : 0.04, 2, dt);
      const far = Math.hypot(G.x[g] - view.x, G.z[g] - view.z);
      if (far > GULL.DROP_RADIUS || (G.state[g] === 2 && gage[g] > 30)) G.state[g] = 0;
    }
    G.top = top;
  }

  // ---- Rats ---------------------------------------------------------------------------------------------------------
  function pileCurb(p) {
    if (pileFrame[p] === 0) {
      if (sidewalkFn && curbFrame(pileX[p], pileZ[p], 5)) {
        pileFrame[p] = 1; pileNX[p] = frame.nx; pileNZ[p] = frame.nz; pileD[p] = frame.depth;
      } else pileFrame[p] = -1;
    }
    return pileFrame[p] === 1;
  }

  function spawnRat() {
    let r = -1;
    for (let k = 0; k < NR; k++) if (R.state[k] === 0) { r = k; break; }
    if (r < 0) return false;
    const found = piles.near(view.x, view.z, RAT.RADIUS, near, 128);
    if (!found) return false;
    const p = near[Math.floor(random() * found)];
    const px = +pileX[p], pz = +pileZ[p];
    if (player.present && Math.hypot(px - player.x, pz - player.z) < RAT.FLEE + 2) return false;
    // its run: out of the bags, onto the curb line, along it to the next pile (or a stretch of curb), and in
    let nx = 0, nz = 1, depth = 0.5;
    const curb = pileCurb(p);
    if (curb) { nx = pileNX[p]; nz = pileNZ[p]; depth = pileD[p]; }
    const tx = -nz, tz = nx;
    const lineX = px + nx * (depth - 0.14), lineZ = pz + nz * (depth - 0.14);
    let endX = 0, endZ = 0, endKind = 1;
    // another pile on the same curb, a few metres on
    const others = piles.near(px, pz, RAT.PILE_REACH, near, 128);
    let bestAlong = 0;
    for (let k = 0; k < others; k++) {
      const q = near[k];
      const dx = pileX[q] - px, dz = pileZ[q] - pz;
      const along = dx * tx + dz * tz, across = dx * nx + dz * nz;
      if (Math.abs(along) < 3 || Math.abs(across) > 1.6) continue;
      if (!bestAlong || random() < 0.35) { bestAlong = along; endX = pileX[q]; endZ = pileZ[q]; endKind = 0; }
    }
    const base = r * WP;
    rwx[base] = lineX; rwz[base] = lineZ;
    if (endKind === 0) {
      rwx[base + 1] = lineX + tx * bestAlong; rwz[base + 1] = lineZ + tz * bestAlong;
      rwx[base + 2] = endX; rwz[base + 2] = endZ;
      rwn[r] = 3;
    } else {
      // a stretch of curb, then down into the gutter (a storm drain)
      const along = (random() < 0.5 ? -1 : 1) * rand(4, 12);
      rwx[base + 1] = lineX + tx * along; rwz[base + 1] = lineZ + tz * along;
      rwx[base + 2] = rwx[base + 1] + nx * 0.4; rwz[base + 2] = rwz[base + 1] + nz * 0.4;
      rwn[r] = 3;
    }
    for (let k = 0; k < rwn[r]; k++) rwy[base + k] = groundAt(rwx[base + k], rwz[base + k]);
    rcar[r] = endKind === 0 ? 0 : 1;
    rnx[r] = nx; rnz[r] = nz;
    R.state[r] = RAT_STATE.RUN;
    R.x[r] = px; R.z[r] = pz; R.y[r] = groundAt(px, pz);
    rsy[r] = R.y[r];
    rwi[r] = 0;
    R.yaw[r] = Math.atan2(lineX - px, lineZ - pz);
    rspd[r] = rand(RAT.RUN_SPEED_MIN, RAT.RUN_SPEED_MAX);
    rtimer[r] = rand(0.4, 1.4);
    rvanish[r] = 0;
    rsize[r] = rand(0.85, 1.15);
    R.scale[r] = rsize[r] * 0.3; // grows out of the bags
    R.phase[r] = rand(0, TAU); R.amp[r] = 0; R.fold[r] = 1; R.head[r] = 0; R.pitch[r] = 0; R.roll[r] = 0;
    rlen[r] = 0;
    pickColor(RAT_COLORS, random, R.color, r);
    R.colorVersion++;
    return true;
  }

  function hideRat(r) {
    R.state[r] = RAT_STATE.HIDE;
    rvanish[r] = 0;
  }

  function fleeRat(r, fromX, fromZ) {
    const tx = -rnz[r], tz = rnx[r];
    const sign = (R.x[r] - fromX) * tx + (R.z[r] - fromZ) * tz >= 0 ? 1 : -1;
    const base = r * WP, run = rand(5, 9);
    rwx[base] = R.x[r] + tx * sign * run; rwz[base] = R.z[r] + tz * sign * run;
    rwx[base + 1] = rwx[base] + rnx[r] * 0.5; rwz[base + 1] = rwz[base] + rnz[r] * 0.5;
    rwy[base] = groundAt(rwx[base], rwz[base]);
    rwy[base + 1] = groundAt(rwx[base + 1], rwz[base + 1]);
    rwn[r] = 2; rwi[r] = 0;
    rsy[r] = R.y[r];
    R.state[r] = RAT_STATE.FLEE;
    rspd[r] = RAT.FLEE_SPEED;
    rlen[r] = 0;
  }

  function stepRats(dt, world) {
    const hour = finite(+(world && world.hour), 12);
    const night = finite(+(world && world.night), 0);
    ratsOut = (hour >= RAT.HOUR_FROM || hour < RAT.HOUR_TO) && night > RAT.NIGHT_MIN;
    ratWait -= dt;
    if (ratsOut && pileCount && ratWait <= 0) {
      let n = 0;
      for (let r = 0; r < NR; r++) if (R.state[r]) n++;
      if (n < NR && spawnRat()) ratWait = rand(0.2, RAT.SPAWN_EVERY * 2);
      else ratWait = 0.3;
    }
    let top = 0;
    for (let r = 0; r < NR; r++) {
      const s = R.state[r];
      if (!s) continue;
      top = r + 1;
      if (Math.hypot(R.x[r] - view.x, R.z[r] - view.z) > RAT.DROP_RADIUS) { R.state[r] = 0; continue; }
      if (s === RAT_STATE.HIDE) {
        // into the bags, the drain or under the car: it shrinks and sinks
        rvanish[r] += dt / 0.3;
        R.scale[r] = rsize[r] * Math.max(0, 1 - rvanish[r]);
        R.y[r] -= dt * 0.25;
        R.amp[r] = approach(R.amp[r], 0, 8, dt);
        if (rvanish[r] >= 1) R.state[r] = 0;
        continue;
      }
      if (!ratsOut && s !== RAT_STATE.FLEE) { hideRat(r); continue; }
      R.scale[r] = approach(R.scale[r], rsize[r], 6, dt);
      if (player.present && s !== RAT_STATE.FLEE && Math.hypot(R.x[r] - player.x, R.z[r] - player.z) < RAT.FLEE) {
        fleeRat(r, player.x, player.z);
        continue;
      }
      if (s === RAT_STATE.FREEZE) {
        rtimer[r] -= dt;
        R.amp[r] = approach(R.amp[r], 0, 14, dt);
        R.phase[r] = (R.phase[r] + dt * 4) % TAU;
        // sniffing: little quick nods
        R.head[r] = approach(R.head[r], 0.18 * Math.sin(time * 17 + r) - 0.15, 14, dt);
        R.y[r] = rsy[r];
        if (rtimer[r] <= 0) { R.state[r] = RAT_STATE.RUN; rtimer[r] = rand(0.4, 1.6); }
        continue;
      }
      // running between waypoints, freezing now and then (not when fleeing)
      const base = r * WP, w = rwi[r];
      const dx = rwx[base + w] - R.x[r], dz = rwz[base + w] - R.z[r], d = Math.hypot(dx, dz);
      const speed = rspd[r];
      if (d < 0.08 || d < speed * dt) {
        R.x[r] = rwx[base + w]; R.z[r] = rwz[base + w];
        rsy[r] = rwy[base + w];
        R.y[r] = rsy[r];
        rwi[r]++;
        rlen[r] = 0;
        if (rwi[r] >= rwn[r]) { hideRat(r); continue; }
      } else {
        R.yaw[r] = turnToward(R.yaw[r], Math.atan2(dx, dz), 14 * dt);
        const go = Math.abs(wrapAngle(Math.atan2(dx, dz) - R.yaw[r])) < 1.2 ? speed : speed * 0.3;
        R.x[r] += dx / d * go * dt;
        R.z[r] += dz / d * go * dt;
        rlen[r] += go * dt;
        // over the curb: ease between the heights of the waypoints
        const g = rwy[base + w];
        rsy[r] = approach(rsy[r], g, Math.abs(g - rsy[r]) > 0.05 && d < 0.6 ? 18 : 4, dt);
        R.phase[r] = (R.phase[r] + dt * TAU * (2.2 + go * 1.6)) % TAU;
        R.amp[r] = approach(R.amp[r], clamp(go / 3.5, 0.3, 1.2), 10, dt);
        R.head[r] = approach(R.head[r], 0.05, 10, dt);
        R.y[r] = rsy[r] + 0.012 * Math.abs(Math.sin(R.phase[r]));
        // a parked car close by: in under it
        if (s === RAT_STATE.RUN && rcar[r]) {
          for (let c = 0; c < parked; c++) {
            const cx = parkX[c] - R.x[r], cz = parkZ[c] - R.z[r];
            if (cx * cx + cz * cz < 2.6 * 2.6) {
              rwx[base] = parkX[c]; rwz[base] = parkZ[c]; rwy[base] = groundAt(parkX[c], parkZ[c]);
              rwi[r] = 0; rwn[r] = 1; rcar[r] = 0;
              break;
            }
          }
        }
        if (s === RAT_STATE.RUN) {
          rtimer[r] -= dt;
          if (rtimer[r] <= 0) { R.state[r] = RAT_STATE.FREEZE; rtimer[r] = rand(0.3, 1.8); }
        }
      }
    }
    R.top = top;
  }

  // ---- The step ---------------------------------------------------------------------------------------------------
  function step(dt, camera = {}, world = {}) {
    dt = clamp(finite(+dt, 0), 0, 0.1);
    const cx = finite(+camera.x, view.x), cz = finite(+camera.z, view.z);
    let fx = finite(+camera.fx, 0), fz = finite(+camera.fz, 1);
    const fl = Math.hypot(fx, fz);
    if (fl > 1e-4) { fx /= fl; fz /= fl; } else { fx = view.fx; fz = view.fz; }
    // a jump (teleport, respawn): the old neighbourhood goes, a new one fills in at once
    if (steps > 0 && Math.hypot(cx - view.x, cz - view.z) > 150) {
      for (let f = 0; f < NF; f++) if (F.state[f] !== FLOCK.FREE) releaseFlock(f);
      for (let r = 0; r < NR; r++) R.state[r] = 0;
      filled = false;
    }
    view.x = cx; view.y = finite(+camera.y, 0); view.z = cz; view.fx = fx; view.fz = fz;
    time += dt;
    steps++;
    const night = clamp(finite(+(world && world.night), 0), 0, 1);
    dayShareNight = night;
    dayShare = 1 - (1 - PIGEON.NIGHT_SHARE) * clamp((night - 0.35) / 0.4, 0, 1);
    gatherThreats(world);
    if (dt > 0 || !filled) stepPigeons(dt);
    stepGulls(dt);
    stepRats(dt, world);
  }

  // A shot, an explosion, a horn: everything within the radius takes off, or runs
  function scatter(x, z, radius) {
    x = +x; z = +z; radius = Math.max(0, finite(+radius, 0));
    if (!Number.isFinite(x) || !Number.isFinite(z) || !radius) return;
    const r2 = radius * radius;
    for (let f = 0; f < NF; f++) {
      if (F.state[f] === FLOCK.FREE) continue;
      const base = f * PIGEON.FLOCK_MAX;
      let hit = false, air = false;
      for (let k = 0; k < F.size[f]; k++) {
        const i = F.members[base + k];
        const dx = P.x[i] - x, dz = P.z[i] - z;
        if (dx * dx + dz * dz > r2) continue;
        const s = P.state[i];
        if (s === PIGEON_STATE.GROUND || s === PIGEON_STATE.PERCH) hit = true; else air = true;
      }
      if (hit) flushFlock(f, x, z, true);
      else if (air && F.state[f] === FLOCK.ACTIVE) {
        // already up: a sharp turn away and a longer flight
        F.dir[f] = -F.dir[f];
        F.airDur[f] = Math.max(F.airDur[f], F.airT[f] + PIGEON.FLIGHT_MIN);
        if (F.landing[f]) {
          F.landing[f] = 0;
          for (let k = 0; k < F.size[f]; k++) {
            const i = F.members[base + k];
            if (P.state[i] === PIGEON_STATE.LAND) {
              if (landTo[i] >= 0) { perchUse[landTo[i]] = Math.max(0, perchUse[landTo[i]] - 1); landTo[i] = -1; }
              P.state[i] = PIGEON_STATE.FLY; P.fold[i] = 0;
            }
          }
        }
      }
    }
    for (let g = 0; g < NG; g++) {
      if (!G.state[g]) continue;
      const dx = G.x[g] - x, dz = G.z[g] - z;
      if (dx * dx + dz * dz < r2 * 2.25) { gclimb[g] += 15; gbeats[g] = 5; }
    }
    for (let r = 0; r < NR; r++) {
      const s = R.state[r];
      if (!s || s === RAT_STATE.HIDE || s === RAT_STATE.FLEE) continue;
      const dx = R.x[r] - x, dz = R.z[r] - z;
      if (dx * dx + dz * dz < r2) fleeRat(r, x, z);
    }
  }

  // How many pigeons are about (x, z), 0..1: on the ground or the lamps within the radius, the nearest counting most
  function nearLevel(x, z, radius = 25) {
    x = +x; z = +z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
    let sum = 0;
    for (let f = 0; f < NF; f++) {
      if (F.state[f] === FLOCK.FREE || Math.hypot(F.cx[f] - x, F.cz[f] - z) > radius + 10) continue;
      const base = f * PIGEON.FLOCK_MAX;
      for (let k = 0; k < F.size[f]; k++) {
        const i = F.members[base + k];
        const d = Math.hypot(P.x[i] - x, P.z[i] - z);
        if (d < radius && (P.state[i] === PIGEON_STATE.GROUND || P.state[i] === PIGEON_STATE.PERCH)) sum += 1 - d / radius;
      }
    }
    return Math.min(1, sum / 8);
  }

  function stats() {
    let pigeonsOut = 0, flying = 0, gullsOut = 0, ratsOutN = 0;
    for (let i = 0; i < NP; i++) {
      const s = P.state[i];
      if (!s) continue;
      pigeonsOut++;
      if (s === PIGEON_STATE.TAKEOFF || s === PIGEON_STATE.FLY || s === PIGEON_STATE.LAND) flying++;
    }
    for (let g = 0; g < NG; g++) if (G.state[g]) gullsOut++;
    for (let r = 0; r < NR; r++) if (R.state[r]) ratsOutN++;
    return { pigeons: pigeonsOut, flying, gulls: gullsOut, rats: ratsOutN };
  }

  return { pigeons, flocks, gulls, rats, counts, level, step, scatter, stats, near: nearLevel, get time() { return time; } };
}

export {
  createBirdSim, createPointIndex, makeRandom, wrapAngle,
  BIRD_COUNTS, PIGEON, GULL, RAT, PIGEON_STATE, RAT_STATE, FLOCK
};
