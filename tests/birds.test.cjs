const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const flockSource = readFileSync(join(__dirname, '../js/birds-flock.js'), 'utf8');
const Flock = loadModule(flockSource, { filename: 'birds-flock.js' });
const { createBirdSim, createPointIndex, makeRandom, BIRD_COUNTS, PIGEON, GULL, RAT, PIGEON_STATE: S, RAT_STATE } = Flock;

// A small Manhattan: avenues along z every 250 m (20 m of roadway), streets along x every 80 m (18 m). The blocks are
// raised curb islands, buildings included, as the game's sidewalk test sees them.
const AVE = 250, ST = 80;
const off = (v, step) => v - Math.round(v / step) * step;
const onRoad = (x, z) => Math.abs(off(x, AVE)) < 10 || Math.abs(off(z, ST)) < 9;
const onSidewalk = (x, z) => !onRoad(x, z);
const groundHeight = (x, z) => (onSidewalk(x, z) ? 0.22 : 0);
function streetProps() {
  const px = [], pz = [], py = [], tx = [], tz = [];
  for (let s = -6; s <= 6; s++) {
    for (const side of [-1, 1]) {
      const zc = s * ST + side * 9.5;
      for (let x = -600; x <= 600; x += 30) if (onSidewalk(x, zc)) { px.push(x); pz.push(zc - side * 1.5); py.push(8); }
      const zt = s * ST + side * 9.8;
      for (let x = -590; x <= 600; x += 37) if (onSidewalk(x, zt)) for (let b = 0; b < 3; b++) { tx.push(x + b * 0.3); tz.push(zt); }
    }
  }
  return {
    perches: { x: Float32Array.from(px), z: Float32Array.from(pz), y: Float32Array.from(py) },
    trashPiles: { x: Float32Array.from(tx), z: Float32Array.from(tz) }
  };
}
// Distance from (x, z) to the nearest edge between roadway and sidewalk
function curbDistance(x, z) {
  const road = onRoad(x, z);
  let best = Infinity;
  for (let a = 0; a < 32; a++) {
    const ang = (a / 32) * Math.PI * 2;
    for (let r = 0; r <= 6; r += 0.05) {
      if (onRoad(x + Math.cos(ang) * r, z + Math.sin(ang) * r) !== road) { best = Math.min(best, r); break; }
    }
  }
  return best;
}

const DT = 1 / 60;
function makeSim(options = {}) {
  const sim = createBirdSim({ groundHeight, onSidewalk, ...streetProps(), quality: 'balanced', random: makeRandom(options.seed ?? 3), ...options });
  const camera = { x: 0, y: 1.7, z: 12, fx: 1, fz: 0, ...(options.camera || {}) };
  const world = { player: { x: 0, z: 12, speed: 0 }, cars: [], hour: 13, night: 0, ...(options.world || {}) };
  const run = (seconds, each) => {
    for (let t = 0; t < seconds; t += DT) {
      if (each) each(t);
      sim.step(DT, camera, world);
    }
  };
  return { sim, camera, world, run };
}
const members = (sim, f) => Array.from(sim.flocks.members.subarray(f * PIGEON.FLOCK_MAX, f * PIGEON.FLOCK_MAX + sim.flocks.size[f]));
const airborne = (sim, i) => [S.TAKEOFF, S.FLY, S.LAND].includes(sim.pigeons.state[i]);
const settled = (sim, i) => sim.pigeons.state[i] === S.GROUND || sim.pigeons.state[i] === S.PERCH;
function nearestFlock(sim, x, z) {
  let best = -1, bd = Infinity;
  for (let f = 0; f < sim.flocks.capacity; f++) {
    if (sim.flocks.state[f] !== 1) continue;
    const d = Math.hypot(sim.flocks.cx[f] - x, sim.flocks.cz[f] - z);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

test('point index finds exactly the points within a radius', () => {
  const rnd = makeRandom(9);
  const xs = Float32Array.from({ length: 500 }, () => rnd() * 400 - 200), zs = Float32Array.from({ length: 500 }, () => rnd() * 400 - 200);
  const index = createPointIndex(xs, zs, 24);
  const out = new Int32Array(500);
  const n = index.near(10, -20, 37, out);
  const found = new Set(Array.from(out.subarray(0, n)));
  for (let i = 0; i < 500; i++) assert.equal(found.has(i), Math.hypot(xs[i] - 10, zs[i] + 20) <= 37, `point ${i}`);
  assert.equal(createPointIndex(new Float32Array(0), new Float32Array(0)).near(0, 0, 50, out), 0);
});

test('flocks fill the sidewalks near the camera, along the curbs and never deep in a block', () => {
  const { sim, run } = makeSim();
  run(DT);
  const P = sim.pigeons;
  assert.ok(sim.stats().pigeons > BIRD_COUNTS.balanced.pigeons - PIGEON.FLOCK_MIN, 'the neighbourhood is filled at once');
  let grounded = 0;
  for (let i = 0; i < P.capacity; i++) {
    if (P.state[i] !== S.GROUND) continue;
    grounded++;
    const d = curbDistance(P.x[i], P.z[i]);
    if (onRoad(P.x[i], P.z[i])) assert.ok(d < 0.7, `pigeon ${i} wanders too far into the roadway (${d.toFixed(2)} m)`);
    else assert.ok(d < PIGEON.DEPTH_MAX + 0.2, `pigeon ${i} is ${d.toFixed(2)} m from the curb, where buildings stand`);
    assert.ok(Math.abs(P.y[i] - groundHeight(P.x[i], P.z[i])) < 0.15, 'standing on the ground');
    assert.ok(Math.hypot(P.x[i], P.z[i] - 12) < PIGEON.SPOT_RADIUS + 6, 'near the camera');
  }
  assert.ok(grounded > 200);
  for (let f = 0; f < sim.flocks.capacity; f++) {
    if (!sim.flocks.state[f]) continue;
    assert.ok(sim.flocks.size[f] >= PIGEON.FLOCK_MIN && sim.flocks.size[f] <= PIGEON.FLOCK_MAX, 'flocks of 6 to 18');
  }
});

test('a passing car flushes the whole flock together, and only that flock', () => {
  const { sim, world, run } = makeSim();
  run(1);
  const F = sim.flocks;
  const f = nearestFlock(sim, 30, 10);
  const birds = members(sim, f);
  assert.ok(birds.every((i) => sim.pigeons.state[i] === S.GROUND));
  // a car in the lane 4.5 m out from the curb, coming along the street at 12 m/s
  const lane = (k) => (k === 'x' ? F.cx[f] + F.nx[f] * 4.5 : F.cz[f] + F.nz[f] * 4.5);
  const car = { x: lane('x') - F.tx[f] * 40, z: lane('z') - F.tz[f] * 40, speed: 12 };
  world.cars = [car];
  const far = [];
  for (let k = 0; k < F.capacity; k++) {
    if (F.state[k] === 1 && k !== f && Math.hypot(F.cx[k] - F.cx[f], F.cz[k] - F.cz[f]) > 60 &&
        Math.abs((F.cx[k] - F.cx[f]) * F.nx[f] + (F.cz[k] - F.cz[f]) * F.nz[f]) > 20) far.push(k);
  }
  let firstUp = -1, allUp = -1;
  run(5, (t) => {
    car.x += F.tx[f] * car.speed * DT; car.z += F.tz[f] * car.speed * DT;
    const up = birds.filter((i) => airborne(sim, i)).length;
    if (up && firstUp < 0) firstUp = t;
    if (up === birds.length && allUp < 0) allUp = t;
  });
  assert.ok(firstUp > 0, 'the flock went up');
  assert.ok(allUp >= 0 && allUp - firstUp < 0.05, 'all of it, together');
  // off the ground within a moment of each other, and climbing away
  assert.ok(birds.every((i) => sim.pigeons.y[i] > groundHeight(sim.pigeons.x[i], sim.pigeons.z[i]) + 2), 'all well up in the air');
  for (const k of far) for (const i of members(sim, k)) assert.ok(settled(sim, i), 'a flock far from the car stays down');
  // a car standing still does nothing
  const calm = makeSim({ seed: 8 });
  calm.run(1);
  const g = nearestFlock(calm.sim, 30, 10);
  calm.world.cars = [{ x: calm.sim.flocks.cx[g] + calm.sim.flocks.nx[g] * 2, z: calm.sim.flocks.cz[g] + calm.sim.flocks.nz[g] * 2, speed: 0 }];
  calm.run(3);
  assert.ok(members(calm.sim, g).every((i) => settled(calm.sim, i)), 'a parked car does not flush them');
});

test('flushed pigeons wheel for 6 to 15 s, then come down on a spot or a lamp', () => {
  for (const seed of [1, 2, 5, 9]) {
    const { sim, run } = makeSim({ seed });
    run(1);
    const f = nearestFlock(sim, 20, 10);
    const birds = members(sim, f);
    sim.scatter(sim.flocks.cx[f], sim.flocks.cz[f], 8);
    assert.ok(birds.every((i) => airborne(sim, i)), 'scatter() sends them all up');
    run(PIGEON.FLIGHT_MIN - 0.5);
    assert.ok(birds.every((i) => airborne(sim, i)), `still in the air before ${PIGEON.FLIGHT_MIN} s (seed ${seed})`);
    let down = -1;
    run(PIGEON.FLIGHT_MAX + 6 - (PIGEON.FLIGHT_MIN - 0.5), (t) => { if (down < 0 && birds.every((i) => settled(sim, i))) down = t + PIGEON.FLIGHT_MIN - 0.5; });
    assert.ok(down > 0, `all back down (seed ${seed})`);
    assert.ok(down < PIGEON.FLIGHT_MAX + 5, `landed ${down.toFixed(1)} s after the flush (seed ${seed})`);
    for (const i of birds) {
      const P = sim.pigeons;
      // (right on a curb's edge, which side it stands on is a matter of rounding)
      if (P.state[i] === S.GROUND) {
        if (curbDistance(P.x[i], P.z[i]) > 0.05) assert.ok(Math.abs(P.y[i] - groundHeight(P.x[i], P.z[i])) < 0.15, 'on the ground');
      } else assert.ok(P.y[i] > 7.5, 'on a lamp top');
    }
  }
});

test('near() tells the ambience how many pigeons are about, and onFlush() hears them go up', () => {
  const flushes = [];
  const { sim, run } = makeSim({ onFlush: (x, z, count) => flushes.push({ x, z, count }) });
  run(1);
  const f = nearestFlock(sim, 20, 10);
  const level = sim.near(sim.flocks.cx[f], sim.flocks.cz[f]);
  assert.ok(level > 0.3 && level <= 1, `a flock right here (${level.toFixed(2)})`);
  assert.equal(sim.near(5000, 5000), 0);
  assert.equal(sim.near(NaN, 0), 0);
  sim.scatter(sim.flocks.cx[f], sim.flocks.cz[f], 6);
  assert.equal(flushes.length, 1);
  assert.equal(flushes[0].count, sim.flocks.size[f]);
  assert.ok(Math.hypot(flushes[0].x - sim.flocks.cx[f], flushes[0].z - sim.flocks.cz[f]) < 6);
  assert.ok(sim.near(sim.flocks.cx[f], sim.flocks.cz[f]) < level, 'fewer about once they are up');
  const throwing = makeSim({ onFlush: () => { throw new Error('sound'); } });
  throwing.run(0.2);
  throwing.sim.scatter(0, 10, 300);
});

test('perched pigeons come back down later', () => {
  const { sim, run } = makeSim({ seed: 4, perchChance: 1 });
  run(1);
  let perchedEver = 0;
  const seen = new Set();
  for (let round = 0; round < 6; round++) {
    sim.scatter(0, 10, 80);
    run(PIGEON.FLIGHT_MAX + 6, () => {
      for (let i = 0; i < sim.pigeons.capacity; i++) if (sim.pigeons.state[i] === S.PERCH && !seen.has(i)) { seen.add(i); perchedEver++; }
    });
  }
  assert.ok(perchedEver > 0, 'some landed on the lamp tops');
  // wait them out: everybody perched leaves the lamp within its time
  const perched = [];
  for (let i = 0; i < sim.pigeons.capacity; i++) if (sim.pigeons.state[i] === S.PERCH) perched.push(i);
  run(PIGEON.PERCH_TIME_MAX + 6);
  for (const i of perched) assert.notEqual(sim.pigeons.state[i], S.PERCH, `pigeon ${i} came down from its lamp`);
});

test('the flock keeps its spacing in the air and on the ground, and flies over the roadway', () => {
  const { sim, run } = makeSim({ seed: 6 });
  run(1);
  sim.scatter(0, 10, 200);
  const P = sim.pigeons;
  let minAir = Infinity, overBlock = 0, samples = 0;
  run(12, (t) => {
    if (t < 2) return;
    for (let f = 0; f < sim.flocks.capacity; f++) {
      if (!sim.flocks.state[f]) continue;
      const birds = members(sim, f).filter((i) => P.state[i] === S.FLY);
      for (let a = 0; a < birds.length; a++) {
        for (let b = a + 1; b < birds.length; b++) {
          const i = birds[a], j = birds[b];
          minAir = Math.min(minAir, Math.hypot(P.x[i] - P.x[j], P.y[i] - P.y[j], P.z[i] - P.z[j]));
        }
        const i = birds[a];
        if (P.y[i] > 3) { samples++; if (!onRoad(P.x[i], P.z[i]) && curbDistance(P.x[i], P.z[i]) > 3) overBlock++; }
      }
    }
  });
  assert.ok(minAir > 0.35, `boids keep apart (closest ${minAir.toFixed(2)} m)`);
  assert.ok(samples > 1000);
  assert.ok(overBlock / samples < 0.02, `they wheel over the street, not through the buildings (${(overBlock / samples * 100).toFixed(1)}% deep over blocks)`);
  run(25);
  let minGround = Infinity;
  for (let f = 0; f < sim.flocks.capacity; f++) {
    if (!sim.flocks.state[f]) continue;
    const birds = members(sim, f).filter((i) => P.state[i] === S.GROUND);
    for (let a = 0; a < birds.length; a++) for (let b = a + 1; b < birds.length; b++) {
      minGround = Math.min(minGround, Math.hypot(P.x[birds[a]] - P.x[birds[b]], P.z[birds[a]] - P.z[birds[b]]));
    }
  }
  assert.ok(minGround > 0.2, `room between pigeons on the ground (closest ${minGround.toFixed(2)} m)`);
});

test('a walker makes pigeons step aside; a runner within 5 m flushes them', () => {
  const { sim, world, run } = makeSim({ seed: 12 });
  run(1);
  const f = nearestFlock(sim, 25, 10);
  const birds = members(sim, f);
  const P = sim.pigeons;
  const i = birds[0];
  // someone walking up to the first pigeon, 1.6 m away
  const ux = sim.flocks.tx[f], uz = sim.flocks.tz[f];
  world.player = { x: P.x[i] - ux * 1.6, z: P.z[i] - uz * 1.6, speed: 1.3 };
  const before = Math.hypot(P.x[i] - world.player.x, P.z[i] - world.player.z);
  run(0.8);
  const after = Math.hypot(P.x[i] - world.player.x, P.z[i] - world.player.z);
  assert.ok(after > before + 0.2, `it moved away (${before.toFixed(2)} -> ${after.toFixed(2)} m)`);
  assert.ok(birds.filter((k) => settled(sim, k) || P.state[k] === S.GROUND).length >= birds.length - 1, 'a walker does not flush the flock at once');
  // now running past at 4 m
  const g = nearestFlock(sim, -40, 10);
  const others = members(sim, g);
  world.player = { x: sim.flocks.cx[g] + sim.flocks.nx[g] * 1 - sim.flocks.tx[g] * 12, z: sim.flocks.cz[g] + sim.flocks.nz[g] * 1 - sim.flocks.tz[g] * 12, speed: 6 };
  run(3, () => { world.player.x += sim.flocks.tx[g] * 6 * DT; world.player.z += sim.flocks.tz[g] * 6 * DT; });
  assert.ok(others.every((k) => airborne(sim, k)), 'the runner flushed the flock');
});

test('scatter() reaches pigeons on the lamps, gulls and rats too', () => {
  const { sim, world, run } = makeSim({ seed: 7, nearWater: () => true, world: { hour: 23.5, night: 0.86 } });
  run(8);
  assert.ok(sim.stats().rats > 0);
  const R = sim.rats;
  let target = -1;
  for (let r = 0; r < R.capacity; r++) if (R.state[r] === RAT_STATE.RUN || R.state[r] === RAT_STATE.FREEZE) { target = r; break; }
  assert.ok(target >= 0);
  sim.scatter(R.x[target], R.z[target], 4);
  assert.equal(R.state[target], RAT_STATE.FLEE, 'the rat bolts');
  world.hour = 13; world.night = 0;
  run(3);
  const G = sim.gulls;
  let g = -1;
  for (let k = 0; k < G.capacity; k++) if (G.state[k]) { g = k; break; }
  assert.ok(g >= 0, 'gulls by the water');
  const y0 = G.y[g];
  sim.scatter(G.x[g], G.z[g], 20);
  run(4);
  assert.ok(G.y[g] > y0 + 4, 'a gull climbs away from a shot');
});

test('rats only at night, running along the curbs near the camera', () => {
  const cases = [
    { hour: 14, night: 0, out: false },
    { hour: 21, night: 0.7, out: false },
    { hour: 23, night: 0.3, out: false },
    { hour: 23, night: 0.86, out: true },
    { hour: 3, night: 0.8, out: true },
    { hour: 5.5, night: 0.6, out: false }
  ];
  for (const c of cases) {
    const { sim, run } = makeSim({ seed: 2, world: { hour: c.hour, night: c.night } });
    let most = 0, far = 0, offCurb = 0, samples = 0;
    run(12, () => {
      const R = sim.rats;
      let n = 0;
      for (let r = 0; r < R.capacity; r++) {
        if (!R.state[r]) continue;
        n++;
        if (Math.hypot(R.x[r], R.z[r] - 12) > RAT.DROP_RADIUS) far++;
        if (R.state[r] === RAT_STATE.RUN) { samples++; if (curbDistance(R.x[r], R.z[r]) > 1.4) offCurb++; }
      }
      most = Math.max(most, n);
    });
    if (c.out) {
      assert.ok(most >= 4, `rats out at ${c.hour} h (${most})`);
      assert.ok(most <= BIRD_COUNTS.balanced.rats);
      assert.equal(far, 0, 'within reach of the camera');
      assert.ok(offCurb / samples < 0.05, 'running along the curb');
    } else {
      assert.equal(most, 0, `no rats at ${c.hour} h, night ${c.night}`);
    }
  }
  // at dawn they go to ground
  const { sim, world, run } = makeSim({ seed: 2, world: { hour: 23, night: 0.86 } });
  run(8);
  assert.ok(sim.stats().rats > 0);
  world.hour = 6; world.night = 0.2;
  run(2);
  assert.equal(sim.stats().rats, 0);
});

test('rats bolt from the player', () => {
  const { sim, world, run } = makeSim({ seed: 13, world: { hour: 1, night: 0.86 } });
  run(6);
  const R = sim.rats;
  let r = -1;
  for (let k = 0; k < R.capacity; k++) if (R.state[k] === RAT_STATE.RUN || R.state[k] === RAT_STATE.FREEZE) { r = k; break; }
  assert.ok(r >= 0);
  world.player = { x: R.x[r] + 2, z: R.z[r], speed: 0 };
  run(DT * 2);
  assert.equal(R.state[r], RAT_STATE.FLEE);
  const d0 = Math.hypot(R.x[r] - world.player.x, R.z[r] - world.player.z);
  run(0.5);
  if (R.state[r]) assert.ok(Math.hypot(R.x[r] - world.player.x, R.z[r] - world.player.z) > d0, 'running away');
});

test('gulls circle high only where the shore is near', () => {
  const dry = makeSim({ nearWater: () => false });
  dry.run(5);
  assert.equal(dry.sim.stats().gulls, 0);
  const wet = makeSim({ nearWater: () => true });
  let most = 0;
  wet.run(20, () => {
    const G = wet.sim.gulls;
    for (let g = 0; g < G.capacity; g++) {
      if (!G.state[g]) continue;
      assert.ok(G.y[g] >= GULL.ALT_MIN - 3.5 && G.y[g] <= GULL.ALT_MAX + 3.5 + 0.01, `gull at ${G.y[g].toFixed(1)} m`);
    }
    most = Math.max(most, wet.sim.stats().gulls);
  });
  assert.ok(most >= 4 && most <= 10, `4 to 10 gulls (${most})`);
  // and they leave the dark
  wet.world.night = 0.86; wet.world.hour = 23;
  wet.run(40);
  assert.equal(wet.sim.stats().gulls, 0);
});

test('fewer pigeons at night, the full count by day', () => {
  const { sim, world, run } = makeSim();
  run(2);
  assert.ok(sim.stats().pigeons > BIRD_COUNTS.balanced.pigeons - PIGEON.FLOCK_MIN);
  world.night = 0.86; world.hour = 0;
  run(40);
  assert.ok(sim.stats().pigeons <= Math.ceil(BIRD_COUNTS.balanced.pigeons * PIGEON.NIGHT_SHARE) + PIGEON.FLOCK_MAX);
  world.night = 0; world.hour = 10;
  run(30);
  assert.ok(sim.stats().pigeons > BIRD_COUNTS.balanced.pigeons * 0.85);
});

test('the quality level sets the populations', () => {
  for (const quality of ['high', 'balanced', 'fluid']) {
    const sim = createBirdSim({ quality, onSidewalk, groundHeight });
    assert.equal(sim.pigeons.capacity, BIRD_COUNTS[quality].pigeons);
    assert.equal(sim.rats.capacity, BIRD_COUNTS[quality].rats);
    assert.equal(sim.gulls.capacity, BIRD_COUNTS[quality].gulls);
  }
  assert.ok(BIRD_COUNTS.fluid.pigeons >= 180 && BIRD_COUNTS.high.pigeons <= 320);
  assert.equal(createBirdSim({ quality: 'nonsense' }).level, 'balanced');
});

test('no NaN through a long, rough run (traffic, runs, shots, nights, jumps)', () => {
  const { sim, camera, world, run } = makeSim({ seed: 21, quality: 'high', nearWater: (x) => x > 100 });
  const rnd = makeRandom(77);
  world.cars = Array.from({ length: 40 }, (_, k) => ({ x: -400 + k * 20, z: k % 2 ? 4 : -4, speed: 8 + (k % 5) }));
  run(120, (t) => {
    for (const c of world.cars) { c.x += c.speed * DT * (c.z > 0 ? 1 : -1); if (c.x > 400) c.x -= 800; if (c.x < -400) c.x += 800; }
    camera.x = Math.sin(t / 9) * 160; camera.fx = Math.cos(t / 9); camera.fz = Math.sin(t / 7);
    world.player = { x: camera.x + 3, z: 12, speed: t % 20 < 10 ? 1.4 : 6.5 };
    world.night = t % 60 < 30 ? 0 : 0.86;
    world.hour = t % 60 < 30 ? 13 : 23.5;
    if (rnd() < 0.01) sim.scatter(camera.x + rnd() * 60 - 30, 10, 5 + rnd() * 40);
    if (rnd() < 0.002) { camera.x += 900; }
    if (rnd() < 0.003) sim.step(0, camera, world);
    if (rnd() < 0.003) sim.step(0.5, camera, world); // a hitch
  });
  for (const name of ['pigeons', 'gulls', 'rats']) {
    const s = sim[name];
    for (const key of ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'scale', 'phase', 'amp', 'fold', 'head']) {
      for (let i = 0; i < s.capacity; i++) if (s.state[i]) assert.ok(Number.isFinite(s[key][i]), `${name}[${i}].${key} = ${s[key][i]}`);
    }
    for (let i = 0; i < s.capacity * 3; i++) assert.ok(Number.isFinite(s.color[i]));
  }
  const stats = sim.stats();
  for (const v of Object.values(stats)) assert.ok(Number.isInteger(v) && v >= 0);
});

test('missing or empty inputs are tolerated', () => {
  const bare = createBirdSim();
  bare.step(1 / 60);
  bare.step(1 / 60, {}, {});
  bare.step(NaN, { x: NaN, z: undefined }, { player: { x: 'a' }, cars: [null, { x: 1 }], hour: undefined });
  bare.scatter(NaN, 0, 10);
  bare.scatter(0, 0, -5);
  assert.deepEqual(Object.keys(bare.stats()).sort(), ['flying', 'gulls', 'pigeons', 'rats']);
  const throwing = createBirdSim({
    groundHeight: () => { throw new Error('x'); }, onSidewalk: () => { throw new Error('y'); }, nearWater: () => { throw new Error('z'); },
    perches: { x: new Float32Array(0), z: new Float32Array(0), y: new Float32Array(0) }, trashPiles: {}
  });
  for (let k = 0; k < 60; k++) throwing.step(1 / 60, { x: 0, z: 0, fx: 0, fz: 1 }, { hour: 23, night: 0.9 });
  assert.equal(throwing.stats().rats, 0);
});

// ---- The drawing ---------------------------------------------------------------------------------------------------
test('birds.js: three instanced draws, built and animated within the vertex-buffer budget', async () => {
  const THREE = await import('../vendor/three/build/three.webgpu.js');
  const TSL = await import('../vendor/three/build/three.tsl.js');
  const { createBirds } = loadModule(readFileSync(join(__dirname, '../js/birds.js'), 'utf8'), {
    imports: { 'three/webgpu': THREE, 'three/tsl': TSL, './birds-flock.js': Flock }, filename: 'birds.js'
  });
  const scene = new THREE.Scene();
  const birds = createBirds(scene, { groundHeight, onSidewalk, ...streetProps(), nearWater: () => false, quality: 'fluid' });
  assert.equal(birds.group.parent, scene);
  const meshes = birds.group.children;
  assert.equal(meshes.length, 3, 'one draw per species');
  const types = new Set();
  for (const mesh of meshes) {
    assert.ok(mesh.isInstancedMesh);
    assert.equal(mesh.frustumCulled, false);
    assert.equal(mesh.castShadow, false);
    assert.ok(mesh.instanceColor, 'colour per instance');
    const g = mesh.geometry;
    const tris = g.index.count / 3;
    assert.ok(tris >= 100 && tris <= 190, `${mesh.name}: ${tris} triangles`);
    // vertex buffers: the geometry's attributes plus the instance matrix and colour (WebGPU allows 8)
    assert.ok(Object.keys(g.attributes).length + 2 <= 8, `${mesh.name}: too many vertex buffers`);
    assert.ok(g.attributes.birdAnim.isInstancedBufferAttribute);
    for (const v of g.attributes.position.array) assert.ok(Number.isFinite(v));
    for (const v of g.attributes.normal.array) assert.ok(Number.isFinite(v));
    types.add(mesh.material.type);
    assert.ok(mesh.material.isMeshStandardNodeMaterial && mesh.material.colorNode);
    assert.equal(mesh.count, 1, 'a degenerate instance until warmed up, for the shader to compile at load');
  }
  assert.deepEqual([...types], ['BirdNodeMaterial'], 'one shader for the three species');
  // the pigeon's folded wing shows its upper side, outwards
  const g = meshes[0].geometry;
  const part = g.attributes.birdPart.array, fold = g.attributes.birdFold.array, nor = g.attributes.normal.array, idx = g.index.array;
  let outward = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    if ((part[a * 4] !== 3 && part[a * 4] !== 4) || nor[a * 3 + 1] <= 0) continue;
    const u = [0, 1, 2].map((k) => fold[b * 3 + k] - fold[a * 3 + k]), v = [0, 1, 2].map((k) => fold[c * 3 + k] - fold[a * 3 + k]);
    const nx = u[1] * v[2] - u[2] * v[1];
    assert.ok(nx * part[a * 4 + 1] > 0, 'folded upper surface faces out');
    outward++;
  }
  assert.ok(outward >= 8);

  const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 1000);
  camera.position.set(0, 1.7, 12);
  camera.lookAt(10, 1.5, 12);
  const world = { player: { x: 0, z: 12, speed: 0 }, cars: [], hour: 13, night: 0 };
  for (let k = 0; k < 120; k++) birds.update(DT, camera, world);
  const stats = birds.stats();
  assert.ok(stats.pigeons > BIRD_COUNTS.fluid.pigeons - PIGEON.FLOCK_MIN);
  assert.equal(stats.rats, 0);
  const [pigeons, gulls, rats] = meshes;
  assert.ok(pigeons.visible && pigeons.count >= stats.pigeons);
  assert.equal(rats.visible, false, 'no rats drawn by day');
  assert.equal(gulls.visible, false, 'no gulls away from the water');
  const e = pigeons.instanceMatrix.array;
  for (let k = 0; k < pigeons.count * 16; k++) assert.ok(Number.isFinite(e[k]));
  // the instance matrices put the birds where the simulation has them, standing upright on the sidewalk
  let upright = 0;
  for (let i = 0; i < pigeons.count; i++) {
    const o = i * 16;
    if (!e[o] && !e[o + 1] && !e[o + 2]) continue;
    if (e[o + 13] < 1) { assert.ok(e[o + 5] > 0.5, 'upright'); upright++; }
  }
  assert.ok(upright > 100);
  birds.scatter(0, 12, 300);
  birds.update(0.5, null, world);
  assert.ok(birds.stats().flying > 0);
});
