import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import * as brands from '../js/eatery-brands.js';
import * as logos from '../js/eatery-logos.js';
import { loadModule } from './helpers/module.cjs';

// The food of BULLION and TRANCHE (js/eatery-food.js): every item is a sane mesh at the size of the real thing,
// sits on y = 0, stays inside its triangle budget and reads its own tiles of the painted atlas. The shapes are built
// here without a canvas or a renderer, as the module promises.

const source = readFileSync(new URL('../js/eatery-food.js', import.meta.url), 'utf8');
const food = loadModule(source, {
  imports: { 'three/webgpu': { ...THREE, MeshStandardNodeMaterial: THREE.MeshStandardMaterial }, './eatery-brands.js': brands, './eatery-logos.js': logos },
  globals: { Float32Array, Uint16Array, Int32Array, Math, Map }, filename: 'eatery-food.js'
});
const { meshes, info } = food.buildFoodMeshes();

const BULLION = ['tray', 'burger', 'burgerTall', 'burgerHalf', 'burgerWrapped', 'fries', 'friesHalf', 'cup', 'bag', 'pattyRaw', 'pattyDone', 'bunTop', 'bunBottom',
  'cheese', 'sauceBottle', 'sauceRed', 'sauceYellow', 'trayStack', 'cupStack', 'napkins', 'friesBasket'];
const TRANCHE = ['pieMargherita', 'piePepperoni', 'pieBianca', 'pieMargheritaPart', 'piePepperoniPart', 'pieBiancaPart', 'sliceMargherita', 'slicePepperoni',
  'sliceBianca', 'sliceMargheritaHand', 'slicePepperoniHand', 'sliceBiancaHand', 'sliceBitten', 'plate', 'box', 'boxOpen', 'boxStack', 'doughBall', 'doughDisc',
  'pieRaw', 'peel', 'cutter', 'shakerOregano', 'shakerChili', 'shakerCheese', 'can', 'plateStack'];
const HAND = ['sliceMargheritaHand', 'slicePepperoniHand', 'sliceBiancaHand', 'sliceBitten'];

// What the brief asks for at most, per kind of item
const BUDGET = { burger: 900, burgerHalf: 900, burgerTall: 1100, tray: 220, cup: 360, fries: 520, friesHalf: 520, friesBasket: 520, bag: 160, box: 80,
  sliceMargherita: 320, slicePepperoni: 320, sliceBianca: 320, sliceMargheritaHand: 320, slicePepperoniHand: 320, sliceBiancaHand: 320, sliceBitten: 320,
  pieMargherita: 900, piePepperoni: 900, pieBianca: 900, pieMargheritaPart: 900, piePepperoniPart: 900, pieBiancaPart: 900, pieRaw: 900,
  // the small things
  pattyRaw: 150, pattyDone: 150, bunTop: 150, bunBottom: 150, cheese: 150, sauceBottle: 150, sauceRed: 150, sauceYellow: 150, napkins: 150, plate: 150,
  doughBall: 150, doughDisc: 150, peel: 150, cutter: 150, shakerOregano: 150, shakerChili: 150, shakerCheese: 150, can: 150,
  // several things in one, or a thing the brief gives no number for
  trayStack: 600, cupStack: 420, plateStack: 220, boxStack: 120, boxOpen: 480, burgerWrapped: 220 };

// Width, height, depth in metres: [least, most]
const pie = { w: [0.46, 0.52], h: [0.015, 0.035], d: [0.46, 0.52] }, plated = { w: [0.22, 0.24], h: [0.02, 0.04], d: [0.23, 0.27] };
const held = { w: [0.1, 0.18], h: [0.03, 0.08], d: [0.21, 0.25] }, shaker = { w: [0.055, 0.07], h: [0.1, 0.14], d: [0.055, 0.07] };
const bottle = { w: [0.045, 0.065], h: [0.16, 0.22], d: [0.045, 0.065] }, patty = { w: [0.1, 0.12], h: [0.008, 0.018], d: [0.1, 0.12] };
const SIZE = {
  tray: { w: [0.42, 0.46], h: [0.015, 0.03], d: [0.3, 0.34] }, trayStack: { w: [0.42, 0.47], h: [0.06, 0.1], d: [0.3, 0.35] },
  burger: { w: [0.11, 0.24], h: [0.078, 0.095], d: [0.11, 0.24] }, burgerHalf: { w: [0.11, 0.24], h: [0.078, 0.095], d: [0.11, 0.24] },
  burgerTall: { w: [0.11, 0.24], h: [0.105, 0.13], d: [0.11, 0.24] }, burgerWrapped: { w: [0.1, 0.13], h: [0.06, 0.085], d: [0.1, 0.13] },
  fries: { w: [0.07, 0.12], h: [0.11, 0.16], d: [0.04, 0.1] }, friesHalf: { w: [0.07, 0.11], h: [0.09, 0.12], d: [0.03, 0.08] },
  cup: { w: [0.085, 0.1], h: [0.155, 0.24], d: [0.085, 0.1] }, cupStack: { w: [0.085, 0.1], h: [0.2, 0.3], d: [0.085, 0.1] },
  bag: { w: [0.25, 0.27], h: [0.31, 0.33], d: [0.13, 0.17] }, pattyRaw: patty, pattyDone: patty,
  bunTop: { w: [0.1, 0.115], h: [0.03, 0.045], d: [0.1, 0.115] }, bunBottom: { w: [0.1, 0.115], h: [0.012, 0.022], d: [0.1, 0.115] },
  cheese: { w: [0.08, 0.1], h: [0.002, 0.004], d: [0.08, 0.1] }, sauceBottle: bottle, sauceRed: bottle, sauceYellow: bottle,
  napkins: { w: [0.12, 0.2], h: [0.1, 0.16], d: [0.08, 0.13] }, friesBasket: { w: [0.14, 0.2], h: [0.12, 0.25], d: [0.3, 0.7] },
  pieMargherita: pie, piePepperoni: pie, pieBianca: pie, pieMargheritaPart: pie, piePepperoniPart: pie, pieBiancaPart: pie,
  pieRaw: { w: [0.44, 0.47], h: [0.008, 0.02], d: [0.44, 0.47] },
  sliceMargherita: plated, slicePepperoni: plated, sliceBianca: plated, sliceMargheritaHand: held, slicePepperoniHand: held, sliceBiancaHand: held,
  sliceBitten: { w: [0.1, 0.18], h: [0.03, 0.08], d: [0.14, 0.2] }, plate: { w: [0.22, 0.24], h: [0.01, 0.02], d: [0.22, 0.24] },
  plateStack: { w: [0.22, 0.24], h: [0.03, 0.08], d: [0.22, 0.24] }, box: { w: [0.355, 0.365], h: [0.043, 0.047], d: [0.355, 0.365] },
  boxOpen: { w: [0.355, 0.37], h: [0.36, 0.42], d: [0.36, 0.45] }, boxStack: { w: [0.36, 0.4], h: [0.22, 0.23], d: [0.36, 0.4] },
  doughBall: { w: [0.09, 0.13], h: [0.045, 0.07], d: [0.09, 0.13] }, doughDisc: { w: [0.28, 0.32], h: [0.006, 0.016], d: [0.28, 0.32] },
  peel: { w: [0.32, 0.34], h: [0.01, 0.03], d: [1.3, 1.4] }, cutter: { w: [0.09, 0.11], h: [0.015, 0.03], d: [0.18, 0.25] },
  shakerOregano: shaker, shakerChili: shaker, shakerCheese: shaker, can: { w: [0.064, 0.068], h: [0.12, 0.124], d: [0.064, 0.068] }
};

function boxOf(mesh) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], p = mesh.position;
  for (let k = 0; k < p.length; k += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], p[k + c]); hi[c] = Math.max(hi[c], p[k + c]); }
  return { lo, hi };
}

test('the module needs neither a page nor a renderer to load, and says so', () => {
  assert.equal(food.FOOD.ready, false);
  assert.equal(food.FOOD.material, null);
  assert.deepEqual(Object.keys(food.FOOD.geometry), []);
  assert.equal(food.foodGeometry('burger'), null);
  assert.equal(typeof food.loadFoodKit, 'function');
});

test('every item of the two menus is there, once', () => {
  for (const name of [...BULLION, ...TRANCHE]) assert.ok(meshes[name], `${name} is missing`);
  assert.equal(Object.keys(meshes).length, BULLION.length + TRANCHE.length, `unexpected items: ${Object.keys(meshes).filter((n) => !BULLION.includes(n) && !TRANCHE.includes(n))}`);
  for (const name of BULLION) assert.equal(info[name].brand, 'bullion', name);
  for (const name of TRANCHE) assert.equal(info[name].brand, 'tranche', name);
});

test('every item is a valid indexed mesh: position, normal, uv, unit normals, no dead vertex', () => {
  for (const [name, m] of Object.entries(meshes)) {
    const n = m.position.length / 3;
    assert.deepEqual(Object.keys(m).sort(), ['index', 'normal', 'position', 'uv'], name);
    assert.ok(m.position instanceof Float32Array && m.normal instanceof Float32Array && m.uv instanceof Float32Array, `${name}: Float32 attributes`);
    assert.ok(m.index instanceof Uint16Array && n < 65536, `${name}: 16-bit index`);
    assert.ok(n > 0 && Number.isInteger(n), name);
    assert.equal(m.normal.length, n * 3, `${name}: normals`);
    assert.equal(m.uv.length, n * 2, `${name}: uvs`);
    assert.equal(m.index.length % 3, 0, name);
    assert.ok(m.index.length > 0, name);
    const used = new Uint8Array(n);
    for (let t = 0; t < m.index.length; t += 3) {
      const [a, b, c] = [m.index[t], m.index[t + 1], m.index[t + 2]];
      assert.ok(a < n && b < n && c < n, `${name}: index out of range`);
      assert.ok(a !== b && b !== c && a !== c, `${name}: a triangle uses a vertex twice`);
      used[a] = used[b] = used[c] = 1;
      // and it has an area
      const p = m.position, ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2], vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
      assert.ok(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 1e-11, `${name}: a triangle without area`);
    }
    assert.ok(used.every((u) => u === 1), `${name}: vertices nothing draws`);
    for (let v = 0; v < n; v++) {
      const l = Math.hypot(m.normal[v * 3], m.normal[v * 3 + 1], m.normal[v * 3 + 2]);
      assert.ok(Math.abs(l - 1) < 1e-3, `${name}: a normal of length ${l}`);
      for (let c = 0; c < 3; c++) assert.ok(Number.isFinite(m.position[v * 3 + c]), name);
    }
  }
});

test('every item rests on y = 0, its origin under it, and says its box and where a hand takes it', () => {
  for (const [name, m] of Object.entries(meshes)) {
    const { lo, hi } = boxOf(m), i = info[name];
    assert.ok(Math.abs(lo[1]) < 1e-3, `${name} does not rest on y = 0 (${lo[1]})`);
    assert.ok(Math.abs(i.w - (hi[0] - lo[0])) < 2e-4 && Math.abs(i.h - (hi[1] - lo[1])) < 2e-4 && Math.abs(i.d - (hi[2] - lo[2])) < 2e-4, `${name}: its box is not its vertices'`);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(i.min[c] - lo[c]) < 2e-4 && Math.abs(i.max[c] - hi[c]) < 2e-4, `${name}: min/max`);
    assert.ok(Array.isArray(i.grip) && i.grip.length === 3 && i.grip.every(Number.isFinite), `${name}: grip`);
    for (let c = 0; c < 3; c++) assert.ok(i.grip[c] >= lo[c] - 0.02 && i.grip[c] <= hi[c] + 0.02, `${name}: its grip is off the item (${i.grip})`);
    assert.equal(i.triangles, m.index.length / 3, name);
    // across, the origin is the middle; along z it is the middle too, but for what is held or carried by one end
    assert.ok(Math.abs(lo[0] + hi[0]) < 0.25 * (hi[0] - lo[0]) + 0.01, `${name}: off centre across (${lo[0]} to ${hi[0]})`);
    if (name === 'peel') { assert.ok(Math.abs(lo[2]) < 1e-3 && hi[2] > 1.3, 'the peel starts at the end of its handle and runs along +z'); continue; }
    if (HAND.includes(name)) { assert.ok(lo[2] > -0.02 && lo[2] < 0.01 && hi[2] > 0.14, `${name} is held by its crust at the origin and points along +z (${lo[2]} to ${hi[2]})`); continue; }
    if (name === 'friesBasket') { assert.ok(lo[2] < -0.1 && hi[2] > 0.3, 'the basket sits on the origin, its handle towards +z'); continue; }
    assert.ok(lo[2] < 0 && hi[2] > 0 && Math.abs(lo[2] + hi[2]) < 0.35 * (hi[2] - lo[2]) + 0.01, `${name}: off centre along z (${lo[2]} to ${hi[2]})`);
  }
});

test('the items have the sizes of the real things', () => {
  for (const name of Object.keys(meshes)) {
    const guide = SIZE[name], i = info[name];
    assert.ok(guide, `${name} has no size guide`);
    for (const axis of ['w', 'h', 'd']) assert.ok(i[axis] >= guide[axis][0] && i[axis] <= guide[axis][1], `${name}: ${axis} is ${i[axis].toFixed(3)} m, expected ${guide[axis][0]} to ${guide[axis][1]}`);
  }
  // a tray holds the meal it is sold with
  assert.ok(info.tray.w > info.burger.w + info.fries.w + info.cup.w);
  assert.ok(info.burgerTall.h > info.burger.h + 0.02 && info.cup.h > info.fries.h);
  assert.ok(info.sliceBitten.d < info.slicePepperoniHand.d - 0.03, 'the bitten slice lost its point');
  assert.ok(info.pieRaw.h < info.pieMargherita.h, 'a raw pie has not risen');
});

test('the triangle budgets are kept', () => {
  let total = 0;
  for (const [name, i] of Object.entries(info)) {
    assert.ok(BUDGET[name], `${name} has no budget`);
    assert.ok(i.triangles <= BUDGET[name], `${name}: ${i.triangles} triangles for a budget of ${BUDGET[name]}`);
    assert.ok(i.budget <= BUDGET[name], `${name}: the module allows itself ${i.budget}`);
    total += i.triangles;
  }
  assert.ok(total < 17000, `${total} triangles in the kit`);
});

test('the atlas tiles lie inside the atlas, apart from each other, and every uv falls in one', () => {
  const size = food.FOOD.atlas, tiles = Object.entries(food.FOOD.tiles);
  assert.equal(size, 2048);
  assert.ok(tiles.length >= 50);
  for (const [name, t] of tiles) assert.ok(t.x >= 4 && t.y >= 4 && t.x + t.w <= size - 4 && t.y + t.h <= size - 4 && t.w > 8 && t.h > 8, `${name}: tile outside the atlas`);
  for (let a = 0; a < tiles.length; a++) for (let b = a + 1; b < tiles.length; b++) {
    const [, s] = tiles[a], [, t] = tiles[b], gap = 8; // room for both gutters
    assert.ok(s.x + s.w + gap <= t.x || t.x + t.w + gap <= s.x || s.y + s.h + gap <= t.y || t.y + t.h + gap <= s.y, `${tiles[a][0]} and ${tiles[b][0]} share atlas pixels`);
  }
  for (const [name, m] of Object.entries(meshes)) {
    for (let v = 0; v < m.uv.length; v += 2) {
      const u = m.uv[v], w = m.uv[v + 1];
      assert.ok(u >= 0 && u <= 1 && w >= 0 && w <= 1, `${name}: uv outside 0..1 (${u}, ${w})`);
      const x = u * size, y = w * size;
      assert.ok(tiles.some(([, t]) => x >= t.x - 0.75 && x <= t.x + t.w + 0.75 && y >= t.y - 0.75 && y <= t.y + t.h + 0.75), `${name}: a uv (${x.toFixed(1)}, ${y.toFixed(1)}) outside every tile`);
    }
  }
});

test('closed things face outwards', () => {
  // the volume enclosed, counted with the faces' own winding: positive when they look out
  for (const name of ['can', 'sauceRed', 'sauceYellow', 'doughBall', 'box', 'pattyDone', 'pattyRaw', 'bunTop', 'bunBottom', 'shakerChili', 'cup', 'burgerWrapped', 'cheese', 'boxStack', 'napkins']) {
    const m = meshes[name], p = m.position;
    let volume = 0;
    for (let t = 0; t < m.index.length; t += 3) {
      const a = m.index[t] * 3, b = m.index[t + 1] * 3, c = m.index[t + 2] * 3;
      volume += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
    }
    const { lo, hi } = boxOf(m), most = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
    assert.ok(volume > most * 0.3 && volume < most * 1.001, `${name}: encloses ${(volume * 1e6).toFixed(0)} cm3 of a ${(most * 1e6).toFixed(0)} cm3 box`);
  }
  // what lies flat looks up
  for (const name of ['tray', 'plate', 'pieMargherita', 'doughDisc', 'pieRaw', 'sliceBianca', 'peel']) {
    const m = meshes[name], p = m.position;
    let up = 0, area = 0;
    for (let t = 0; t < m.index.length; t += 3) {
      const a = m.index[t] * 3, b = m.index[t + 1] * 3, c = m.index[t + 2] * 3;
      const ny = (p[b + 2] - p[a + 2]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 2] - p[a + 2]);
      const n = Math.hypot((p[b + 1] - p[a + 1]) * (p[c + 2] - p[a + 2]) - (p[b + 2] - p[a + 2]) * (p[c + 1] - p[a + 1]), ny, (p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a]));
      if (ny > 0) up += ny;
      area += n;
    }
    assert.ok(up > area * 0.3, `${name}: only ${(100 * up / area).toFixed(0)} % of its surface looks up`);
  }
});

test('a bite takes its share and leaves the layers showing', () => {
  const whole = boxOf(meshes.burger), half = boxOf(meshes.burgerHalf);
  assert.ok(Math.abs(whole.hi[1] - half.hi[1]) < 2e-3, 'the bitten burger is as tall as the whole one');
  // nothing of the burger itself is left in front of where the teeth went (its paper stays): look above the paper
  let front = -Infinity;
  const p = meshes.burgerHalf.position;
  for (let k = 0; k < p.length; k += 3) if (p[k + 1] > 0.03) front = Math.max(front, p[k + 2]);
  assert.ok(front < 0.03 && front > -0.01, `the burger is bitten back to z = ${front.toFixed(3)}`);
  let wholeFront = -Infinity;
  for (let k = 0; k < meshes.burger.position.length; k += 3) if (meshes.burger.position[k + 1] > 0.03) wholeFront = Math.max(wholeFront, meshes.burger.position[k + 2]);
  assert.ok(wholeFront > 0.05);
  // the three part-pies lost three slices of eight
  for (const kind of ['Margherita', 'Pepperoni', 'Bianca']) {
    const part = meshes[`pie${kind}Part`].position;
    let missing = 0;
    for (let k = 0; k < part.length; k += 3) if (part[k + 1] > 0.012 && part[k] > 0.02 && part[k + 2] > 0.02) missing++;
    assert.equal(missing, 0, `pie${kind}Part still has crust in the quarter that was served`);
  }
});

test('the same shapes come out every time, and as BufferGeometry on request', () => {
  const again = food.buildFoodMeshes();
  for (const name of ['burger', 'fries', 'piePepperoni', 'sliceBitten', 'boxStack', 'trayStack']) {
    assert.deepEqual(Array.from(again.meshes[name].position), Array.from(meshes[name].position), name);
    assert.deepEqual(Array.from(again.meshes[name].uv), Array.from(meshes[name].uv), name);
  }
  const { geometry, info: listed } = food.buildFoodGeometries();
  assert.deepEqual(Object.keys(geometry).sort(), Object.keys(meshes).sort());
  for (const [name, g] of Object.entries(geometry)) {
    assert.ok(g.isBufferGeometry, name);
    assert.deepEqual(Object.keys(g.attributes).sort(), ['normal', 'position', 'uv'], name);
    assert.ok(g.index && g.index.count === listed[name].triangles * 3, name);
    assert.equal(g.attributes.position.count, g.attributes.normal.count);
    assert.equal(g.attributes.position.count, g.attributes.uv.count);
  }
  assert.equal(geometry.sauceBottle, geometry.sauceRed, 'the squeeze bottle is the red one under another name');
});
