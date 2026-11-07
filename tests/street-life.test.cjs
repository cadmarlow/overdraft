const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// The crowd's density by district and hour, and the spots it stops at (street-life.js), without three.js

const read = (file) => readFileSync(join(__dirname, '../js', file), 'utf8');
const parkingPlan = loadModule(read('parking-plan.js'));
const storefrontTypes = loadModule(read('storefront-types.js'));
const PROP = { PHONE: 0, COFFEE: 1, UMBRELLA: 2, BAG: 3, BACKPACK: 4 };

function makeLife({ district = 'midtown', shops = [], seats = [], stands = [], peds = [] } = {}) {
  const { createStreetLife } = loadModule(read('street-life.js'), { imports: {
    './city-config.js': { districtAt: () => district },
    './parking-plan.js': parkingPlan,
    './storefront-types.js': storefrontTypes,
    './pedestrians.js': { PROP }
  } });
  const placed = [];
  const pedestrians = {
    peds, NUM_PEDS: peds.length || 340, density: 1,
    setDensity(f) { this.density = f; },
    placeAt(p, x, z) { if (p.placed) return false; p.placed = true; p.x = x; p.z = z; p.route = { edge: {} }; placed.push(p); return true; }
  };
  const traffic = { clock: 0, cars: [], hails: [], setBusStops() {}, requestStop() { return false; } };
  const hour = { value: 12 };
  const life = createStreetLife({ pedestrians, traffic, shops, seats, stands, busStops: [], subwayMouths: [], foodCarts: [], hourOf: () => hour.value });
  return { life, pedestrians, traffic, hour, placed };
}

test('the crowd thickens by day in business districts and thins at night, but the Village fills up at night', () => {
  const { life } = makeLife();
  const midtownDay = life.densityAt(0, 0, 12), midtownNight = life.densityAt(0, 0, 2.5);
  assert.ok(midtownDay > 0.9, `midtown at noon: ${midtownDay}`);
  assert.ok(midtownNight < 0.35, `midtown at night: ${midtownNight}`);
  const { life: residential } = makeLife({ district: 'uws' });
  assert.ok(residential.densityAt(0, 0, 12) < midtownDay, 'residential streets are calmer than Midtown by day');
  assert.ok(residential.densityAt(0, 0, 3) > midtownNight, 'but keep more people at night');
  const { life: village } = makeLife({ district: 'east_village' });
  assert.ok(village.densityAt(0, 0, 23) >= 0.85, `nightlife at 23 h: ${village.densityAt(0, 0, 23)}`);
  const { life: rush } = makeLife({ district: 'midtown' });
  assert.ok(rush.densityAt(0, 0, 8.5) >= rush.densityAt(0, 0, 11), 'the morning rush adds to the day');
  for (const h of [0, 4, 8, 12, 16, 20, 23.9]) {
    const f = life.densityAt(0, 0, h);
    assert.ok(f >= 0.15 && f <= 1, `density within bounds at ${h} h: ${f}`);
  }
});

test('shops become doors and windows; a window-shopper stops only while the shop is open', () => {
  const shop = { x: 0, z: 0, ux: 1, uz: 0, nx: 0, nz: 1, width: 8, type: storefrontTypes.SHOP_TYPES.findIndex((t) => t.id === 'boutique') };
  const { life } = makeLife({ shops: [shop] });
  const kinds = Array.from(life.anchors, (a) => a.kind).sort(); // (the module's arrays come from another realm)
  assert.deepEqual(kinds, ['door', 'window']);
  const door = life.anchors.find((a) => a.kind === 'door');
  assert.ok(Math.abs(door.x - 4) < 1e-9 && door.z > 0.5 && door.z < 1, 'the door stands a step out from the middle of the front');
  assert.equal(door.type.id, 'boutique');
  // the vacant local gets no anchor
  const vacant = { ...shop, type: storefrontTypes.SHOP_TYPES.findIndex((t) => t.id === 'vacant') };
  assert.equal(makeLife({ shops: [vacant] }).life.anchors.length, 0);
});

test('a walker passing a free seat may sit; busy seats and people already busy are left alone', () => {
  const seat = { x: 2, z: 0, yaw: 0, kind: 'bench' };
  const peds = Array.from({ length: 40 }, () => ({ placed: true, dead: false, activity: null, node: null, route: { edge: { axis: 'st' } }, pause: 0, conversation: null, v: 1.2, panicUntil: 0, x: 1, z: 0 }));
  const { life, traffic } = makeLife({ seats: [seat], peds });
  const camera = { position: { x: 0, z: 0 } };
  let sat = 0;
  for (let i = 0; i < 400 && !sat; i++) {
    traffic.clock += 0.25;
    life.update(0.25, camera);
    sat = peds.filter((p) => p.activity && p.activity.kind === 'seat').length;
  }
  assert.ok(sat >= 1, 'someone sat down');
  assert.equal(sat, 1, 'one seat, one sitter');
  const sitter = peds.find((p) => p.activity);
  assert.equal(sitter.activity.phase, 'approach');
  assert.ok(sitter.activity.seat === seat);
  assert.equal(life.anchors[0].busy, 1);
  // done: the seat frees up and cools down
  sitter.activity.onDone(sitter, false);
  assert.equal(life.anchors[0].busy, 0);
  assert.ok(life.anchors[0].cooldown > traffic.clock);
});

test('people gather round a spot, phones out, only those walking nearby', () => {
  const peds = [
    { placed: true, dead: false, activity: null, node: null, route: { edge: {} }, pause: 0, conversation: null, v: 1, panicUntil: 0, x: 8, z: 0 },
    { placed: true, dead: false, activity: null, node: null, route: { edge: {} }, pause: 0, conversation: null, v: 1, panicUntil: 0, x: 40, z: 0 },
    { placed: false, dead: false, activity: null, node: null, route: null, pause: 0, conversation: null, v: 0, panicUntil: 0, x: 5, z: 0 }
  ];
  const { life } = makeLife({ peds });
  assert.equal(life.gather(0, 0, 5, 10, 16), 1);
  assert.equal(peds[0].activity.kind, 'gather');
  assert.equal(peds[0].activity.phase, 'hold');
  assert.equal(peds[0].activity.look.x, 0);
  assert.equal(peds[0].activity.look.z, 0);
  assert.equal(peds[1].activity, null);
});
