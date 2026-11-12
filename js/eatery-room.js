import * as THREE from 'three/webgpu';
import { texture, uniform, uv, vec2 } from 'three/tsl';
import { Builder, INDOOR, at } from './calibre-build.js';
import { PRINTS, PRINT_SIZE, paintPrints } from './eatery-prints.js';
import { FOOD, foodGeometry } from './eatery-food.js';
import { SPECS, PLANS, eateryLocal } from './eatery-plan.js';

// The restaurants as places: one branch of BULLION and one of TRANCHE drawn once (their plans are in eatery-plan.js)
// and shared by every address. What is static is merged into one mesh per material; what moves or shines (doors,
// lamps, fry baskets, oven doors, the order screen, the fan) belongs to the branch nearest to the camera.

const BRASS = 0xc9a24a, GOLD = 0xe0ad3c, BLACK = 0x141210, CHARCOAL = 0x23211f, CREAM = 0xefe5cf, OXBLOOD = 0x7a1d18, STEEL = 0xb4b8bb, DARK_STEEL = 0x4a4d4f;
const TOMATO = 0xc92f1e, TOMATO_DEEP = 0x8f1f14, BASIL = 0x2f7a4a, WHITE = 0xe9e6de, WOOD = 0x9a7350, WALNUT = 0x5b3d28, MARBLE = 0xe4e0d8;

// ---- Surfaces painted at load: tiles that repeat -----------------------------------------------------------------------

function tiled(name, size, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  paint(canvas.getContext('2d'), size);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8; map.name = `eatery/${name}`;
  return map;
}
const rnd = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

// white subway tiles in running bond: 4 across, 8 rows per repeat (one repeat = 0.6 m)
function paintSubway(c, s) {
  c.fillStyle = '#b9b6ae'; c.fillRect(0, 0, s, s);
  const w = s / 4, h = s / 8, g = 3;
  for (let row = 0; row < 8; row++) for (let col = -1; col < 5; col++) {
    const x = col * w + (row % 2 ? w / 2 : 0), y = row * h, k = rnd(row * 17 + col * 3);
    const v = 236 + Math.round(k * 12);
    c.fillStyle = `rgb(${v},${v - 2},${v - 8})`;
    c.fillRect(x + g / 2, y + g / 2, w - g, h - g);
    const shine = c.createLinearGradient(0, y, 0, y + h);
    shine.addColorStop(0, 'rgba(255,255,255,0.35)'); shine.addColorStop(0.3, 'rgba(255,255,255,0)'); shine.addColorStop(1, 'rgba(0,0,0,0.06)');
    c.fillStyle = shine; c.fillRect(x + g / 2, y + g / 2, w - g, h - g);
  }
}
// two-colour checks: 2 x 2 tiles per repeat
function paintChecks(a, b, grout) {
  return (c, s) => {
    const h = s / 2;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      c.fillStyle = (i + j) % 2 ? a : b; c.fillRect(i * h, j * h, h, h);
      // worn towards the middle of each tile, scuffs
      const wear = c.createRadialGradient(i * h + h / 2, j * h + h / 2, h * 0.1, i * h + h / 2, j * h + h / 2, h * 0.75);
      wear.addColorStop(0, 'rgba(255,255,255,0.07)'); wear.addColorStop(1, 'rgba(0,0,0,0.1)');
      c.fillStyle = wear; c.fillRect(i * h, j * h, h, h);
    }
    c.strokeStyle = grout; c.lineWidth = 3;
    for (let i = 0; i <= 2; i++) { c.beginPath(); c.moveTo(i * h, 0); c.lineTo(i * h, s); c.moveTo(0, i * h); c.lineTo(s, i * h); c.stroke(); }
    for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(${i % 2 ? 0 : 255},${i % 2 ? 0 : 255},${i % 2 ? 0 : 255},0.05)`; c.fillRect(rnd(i) * s, rnd(i + 0.5) * s, 1 + rnd(i * 3) * 5, 1); }
  };
}
// large dark stone tiles, 2 x 2 per repeat, each a shade apart, veined
function paintSlate(c, s) {
  const h = s / 2;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const v = 38 + Math.round(rnd(i * 5 + j * 11) * 14);
    c.fillStyle = `rgb(${v + 4},${v + 2},${v})`; c.fillRect(i * h, j * h, h, h);
  }
  for (let i = 0; i < 40; i++) {
    c.strokeStyle = `rgba(255,236,200,${0.02 + rnd(i) * 0.04})`; c.lineWidth = 0.6 + rnd(i * 2) * 1.4;
    c.beginPath(); let x = rnd(i * 7) * s, y = rnd(i * 13) * s; c.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rnd(i * 31 + k) - 0.4) * 90; y += (rnd(i * 57 + k) - 0.5) * 60; c.lineTo(x, y); }
    c.stroke();
  }
  c.strokeStyle = '#8a7a52'; c.lineWidth = 2;
  for (let i = 0; i <= 2; i++) { c.beginPath(); c.moveTo(i * h, 0); c.lineTo(i * h, s); c.moveTo(0, i * h); c.lineTo(s, i * h); c.stroke(); }
}

// ---- Materials ----------------------------------------------------------------------------------------------------------

const clock = uniform(0); // seconds, for what scrolls

function sheet(brand) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PRINT_SIZE;
  paintPrints(canvas.getContext('2d'), brand);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8; map.wrapS = THREE.RepeatWrapping; map.name = `eatery/${brand}`;
  return map;
}

// `shared`: CALIBRE's room materials (calibre-build.js), reused for everything that is not the brands' own
function createMaterials(shared) {
  const make = (options) => {
    const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0, vertexColors: true, ...options });
    material.aoNode = INDOOR.ambient;
    return material;
  };
  const common = {
    ...shared,
    tile: make({ map: tiled('subway', 512, paintSubway), roughness: 0.22 }),
    checker: make({ map: tiled('checks', 512, paintChecks('#b7281b', '#eadfc8', '#6d655a')), roughness: 0.42 }),
    slate: make({ map: tiled('slate', 512, paintSlate), roughness: 0.3 }),
    quarry: make({ map: tiled('quarry', 256, paintChecks('#8c8f8d', '#858886', '#5c5f5e')), roughness: 0.6 }),
    leather: make({ roughness: 0.42 }),
    gloss: make({ roughness: 0.16 }),
    steel: make({ roughness: 0.34, metalness: 0.85 }),
    ember: make({ color: 0x000000, emissive: 0xff6a1e, emissiveIntensity: 3.2 }),
    amber: make({ color: 0x000000, emissive: 0xffa040, emissiveIntensity: 1.6 }),
    oil: make({ color: 0x8a5514, roughness: 0.08 })
  };
  if (FOOD.material) { common.food = FOOD.material.clone(); common.food.aoNode = INDOOR.ambient; common.food.name = 'eatery/food'; }
  const out = {};
  for (const brand of ['bullion', 'tranche']) {
    const map = sheet(brand);
    const m = {
      ...common,
      print: make({ map, roughness: 0.7 }),
      glow: make({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 1.25, roughness: 0.5 }),
      neon: make({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.9, alphaTest: 0.3, side: THREE.DoubleSide }),
      decal: make({ map, roughness: 0.6, alphaTest: 0.4, side: THREE.DoubleSide })
    };
    if (brand === 'bullion') {
      // the LED band over the counter: the sheet's ticker strip, scrolling
      m.ticker = make({ map, roughness: 0.5 });
      const moving = texture(map, vec2(uv().x.add(clock.mul(0.035)), uv().y));
      m.ticker.colorNode = moving.mul(0.4);
      m.ticker.emissiveNode = moving.mul(2.4);
    }
    for (const [name, material] of Object.entries(m)) if (!material.name) material.name = `eatery/${brand}/${name}`;
    out[brand] = m;
  }
  for (const [name, material] of Object.entries(common)) if (!material.name) material.name = `eatery/${name}`;
  return out;
}

// The order screen over BULLION's pickup counter: two columns of numbers, redrawn when they change
function createOrderScreen() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 288;
  const c = canvas.getContext('2d'), map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace; map.name = 'eatery/orders';
  const material = new THREE.MeshStandardNodeMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 1.15, roughness: 0.4 });
  material.aoNode = INDOOR.ambient; material.name = 'eatery/screen';
  let shown = null;
  function set(preparing = [], ready = []) {
    const key = `${preparing.join(',')}|${ready.join(',')}`;
    if (key === shown) return;
    shown = key;
    c.fillStyle = '#0d0b09'; c.fillRect(0, 0, 512, 288);
    c.fillStyle = '#17130e'; c.fillRect(0, 0, 512, 56);
    c.fillStyle = '#e8b23a'; c.fillRect(254, 56, 4, 232);
    c.textBaseline = 'middle'; c.textAlign = 'center';
    c.font = '900 24px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    c.fillStyle = '#b8a888'; c.fillText('EN PRÉPARATION', 128, 30);
    c.fillStyle = '#e8b23a'; c.fillText('PRÊT', 384, 30);
    c.font = '900 58px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    preparing.slice(0, 6).forEach((n, i) => { c.fillStyle = '#d8cfbd'; c.fillText(String(n), 68 + (i % 2) * 122, 100 + Math.floor(i / 2) * 70); });
    ready.slice(0, 6).forEach((n, i) => { c.fillStyle = '#ffd35c'; c.fillText(String(n), 324 + (i % 2) * 122, 100 + Math.floor(i / 2) * 70); });
    map.needsUpdate = true;
  }
  set([], []);
  return { material, set };
}

// ---- A builder that also knows the food ----------------------------------------------------------------------------------

class Room extends Builder {
  food(name, x, y, z, ry = 0, scale = 1, rx = 0, rz = 0) {
    const g = this.materials.food ? foodGeometry(name) : null;
    if (!g) return false;
    this.push('food', g.clone(), at(x, y, z, ry, rx, rz, scale));
    return true;
  }
  // a framed print on a wall: `ry` turns it to face the room
  framed(name, width, x, y, z, ry, frame = BLACK, key = 'print') {
    const h = this.print(name, width, at(x, y, z, ry), key);
    if (!h) return;
    const back = new THREE.BoxGeometry(width + 0.06, h + 0.06, 0.024);
    this.push('satin', back, at(x - Math.sin(ry) * 0.014, y, z - Math.cos(ry) * 0.014, ry), { color: frame });
  }
}

// ---- Pieces --------------------------------------------------------------------------------------------------------------

function pendant(R, x, y, z, drop, color, shade = 0.2) {
  R.rod('paint', x, y - drop / 2 + 0.04, z, 0.006, drop - 0.08, 'y', { color: BLACK, segments: 5 });
  const profile = [[0.03, 0.2], [0.07, 0.17], [shade, 0.02], [shade + 0.012, 0], [shade, 0], [shade - 0.012, 0.014], [0.06, 0.155], [0.028, 0.19]].map(([r, h]) => new THREE.Vector2(r, h));
  R.push('satin', new THREE.LatheGeometry(profile, 20), at(x, y - drop - 0.02, z), { color });
  R.push('bulb', new THREE.SphereGeometry(0.045, 12, 8), at(x, y - drop + 0.05, z));
}
function striplight(R, x, y, z, length, turned = false) {
  const ry = turned ? Math.PI / 2 : 0;
  R.box('paint', x, y - 0.03, z, length, 0.06, 0.22, { ry, color: 0xdcdedb });
  for (const s of [-0.06, 0.06]) R.push('tube', new THREE.CylinderGeometry(0.016, 0.016, length - 0.12, 8), at(x + (turned ? s : 0), y - 0.075, z + (turned ? 0 : s), ry, 0, Math.PI / 2));
}
// A bar stool: a round seat on a column
function stool(R, x, z, seat, color) {
  R.push('leather', new THREE.CylinderGeometry(0.17, 0.165, 0.06, 20), at(x, seat - 0.03, z), { color });
  R.push('steel', new THREE.CylinderGeometry(0.175, 0.175, 0.012, 20), at(x, seat - 0.066, z), { color: STEEL });
  R.rod('steel', x, (seat - 0.07) / 2, z, 0.024, seat - 0.07, 'y', { color: STEEL });
  R.push('steel', new THREE.CylinderGeometry(0.2, 0.22, 0.02, 20), at(x, 0.01, z), { color: STEEL });
  R.push('steel', new THREE.TorusGeometry(0.15, 0.011, 6, 20), at(x, seat * 0.42, z, 0, Math.PI / 2), { color: STEEL });
}
// A chair facing the local direction (fx, fz): seat, back, four legs
function chair(R, x, z, fx, fz, seat, color, frame = BLACK) {
  const ry = Math.atan2(fx, fz), M = at(x, 0, z, ry), part = (g, local, key, c) => R.push(key, g, M.clone().multiply(local), { color: c });
  part(new THREE.BoxGeometry(0.42, 0.045, 0.42), at(0, seat - 0.022, 0), 'leather', color);
  part(new THREE.BoxGeometry(0.4, 0.3, 0.03), at(0, seat + 0.36, -0.2, 0, -0.1), 'leather', color);
  for (const sx of [-1, 1]) {
    part(new THREE.CylinderGeometry(0.013, 0.013, seat + 0.5, 6), at(sx * 0.19, (seat + 0.5) / 2, -0.2, 0, -0.07), 'paint', frame);
    part(new THREE.CylinderGeometry(0.013, 0.013, seat - 0.04, 6), at(sx * 0.19, (seat - 0.04) / 2, 0.19), 'paint', frame);
  }
}
// A pedestal table
function table(R, x, z, w, d, h, top, key = 'satin', edge = BLACK) {
  R.box(key, x, h - 0.018, z, w, 0.036, d, { color: top });
  R.box('satin', x, h - 0.045, z, w - 0.03, 0.02, d - 0.03, { color: edge });
  R.rod('steel', x, (h - 0.05) / 2, z, 0.035, h - 0.05, 'y', { color: DARK_STEEL });
  R.push('steel', new THREE.CylinderGeometry(0.2, 0.24, 0.025, 20), at(x, 0.012, z), { color: DARK_STEEL });
}
// A retractable belt post
function post(R, x, z) {
  R.rod('steel', x, 0.47, z, 0.026, 0.94, 'y', { color: 0x2a2a2a });
  R.push('steel', new THREE.CylinderGeometry(0.16, 0.17, 0.03, 18), at(x, 0.015, z), { color: 0x2a2a2a });
  R.push('metal', new THREE.CylinderGeometry(0.036, 0.036, 0.07, 12), at(x, 0.94, z), { color: BRASS });
}
// A round projecting sign on its bracket, at the facade's left (side -1) or right (side 1) end
function bladeSign(R, x, y, z, ring) {
  R.rod('metal', x, y + 0.5, z - 0.3, 0.016, 0.72, 'z', { color: BLACK });
  R.rod('metal', x, y + 0.42, z, 0.012, 0.16, 'y', { color: BLACK });
  R.push('satin', new THREE.CylinderGeometry(0.44, 0.44, 0.09, 40, 1, true), at(x, y, z, 0, 0, Math.PI / 2), { color: ring });
  for (const s of [-1, 1]) R.disc('blade', 0.44, at(x + s * 0.046, y, z, s * Math.PI / 2), 'glow');
}
// A sidewalk board: two leaves leaning on each other
function sandwichBoard(R, x, z, ry, frame) {
  for (const s of [-1, 1]) {
    const M = at(x, -0.02, z, ry).multiply(at(0, 0.5, s * 0.17, 0, -s * 0.17));
    R.push('satin', new THREE.BoxGeometry(0.6, 1.0, 0.025), M, { color: frame });
    R.print('sandwich', 0.54, M.clone().multiply(at(0, 0.02, s * 0.0135, s > 0 ? 0 : Math.PI)));
  }
}

// ---- BULLION -------------------------------------------------------------------------------------------------------------

const BULLION_LIGHTS = [
  { kind: 'point', x: -4.4, y: 1.92, z: -1.9, color: 0xffc78a, power: 13, reach: 5.5 },
  { kind: 'point', x: -4.4, y: 1.92, z: -3.9, color: 0xffc78a, power: 13, reach: 5.5 },
  { kind: 'point', x: -4.4, y: 1.92, z: -5.9, color: 0xffc78a, power: 13, reach: 5.5 },
  { kind: 'spot', x: 3.95, y: 3.3, z: -2.9, tx: 3.95, ty: 0.7, tz: -2.9, color: 0xffe2b8, power: 55, reach: 6, angle: 0.85 },
  { kind: 'spot', x: 3.95, y: 3.3, z: -4.9, tx: 3.95, ty: 0.7, tz: -4.9, color: 0xffe2b8, power: 55, reach: 6, angle: 0.85 },
  { kind: 'spot', x: 3.95, y: 3.3, z: -6.9, tx: 3.95, ty: 0.7, tz: -6.9, color: 0xffe2b8, power: 55, reach: 6, angle: 0.85 },
  { kind: 'point', x: 0, y: 2.9, z: -1.7, color: 0xffd9a8, power: 12, reach: 7 },
  { kind: 'point', x: -0.6, y: 3.0, z: -4.8, color: 0xffd9a8, power: 15, reach: 8.5 },
  { kind: 'point', x: -3.0, y: 2.25, z: -0.9, color: 0xffd0a0, power: 8, reach: 5 },
  { kind: 'spot', x: -2.9, y: 3.25, z: -7.7, tx: -2.9, ty: 1.0, tz: -8.9, color: 0xfff0d8, power: 80, reach: 7, angle: 1.0 },
  { kind: 'spot', x: 1.3, y: 3.25, z: -7.7, tx: 1.3, ty: 1.0, tz: -8.9, color: 0xfff0d8, power: 80, reach: 7, angle: 1.0 },
  { kind: 'point', x: -1.5, y: 2.2, z: -8.1, color: 0xffb760, power: 7, reach: 5 }, // the ticker and the boards' own glow
  { kind: 'point', x: 4.2, y: 2.5, z: -8.3, color: 0xffd9a8, power: 8, reach: 5 },
  { kind: 'point', x: -2.6, y: 3.05, z: -12.3, color: 0xeaf2ff, power: 24, reach: 9 },
  { kind: 'point', x: 0.9, y: 3.05, z: -12.3, color: 0xeaf2ff, power: 24, reach: 9 },
  { kind: 'point', x: 3.6, y: 3.05, z: -12.6, color: 0xeaf2ff, power: 16, reach: 8 },
  { kind: 'point', x: -0.95, y: 1.5, z: -10.5, color: 0xff7a2a, power: 5, reach: 3.2 }, // the chute's heat lamps
  { kind: 'spot', x: -2.6, y: 2.5, z: 0.5, tx: -2.6, ty: 0, tz: 1.4, color: 0xffd3a0, power: 50, reach: 8, angle: 1.05, night: true },
  { kind: 'spot', x: 2.6, y: 2.5, z: 0.5, tx: 2.6, ty: 0, tz: 1.4, color: 0xffd3a0, power: 50, reach: 8, angle: 1.05, night: true }
];

function buildBullion(materials, T) {
  const S = SPECS.bullion, P = PLANS.bullion, H = P.ceiling, W = P.half, wall = S.width / 2, depth = S.depth, TOP = S.height - S.floor;
  const front = new Room(materials, PRINTS.bullion, 'Bullion'), R = new Room(materials, PRINTS.bullion, 'Bullion');
  const C = P.counter, cf = C.z + C.depth / 2, cb = C.z - C.depth / 2;

  // ---- The front on the street: black lacquer, gold rules, the name in gold ----
  const F = front;
  F.slab('gloss', -wall, wall, 2.56, TOP, -0.06, 0.34, { color: BLACK });
  F.slab('metal', -wall, wall, 2.56, 2.59, 0.34, 0.36, { color: BRASS });
  F.slab('metal', -wall, wall, TOP - 0.035, TOP, 0.34, 0.37, { color: BRASS });
  F.print('fascia', S.width - 0.2, at(0, (2.59 + TOP - 0.035) / 2, 0.344), 'glow', TOP - 0.035 - 2.59);
  for (const s of [-1, 1]) {
    F.slab('gloss', s * W, s * wall, 0, 2.56, -0.06, 0.3, { color: BLACK }); // pilasters
    F.slab('metal', s * (W - 0.01), s * (wall + 0.01), 0.0, 0.1, -0.06, 0.32, { color: BRASS });
    F.slab('gloss', s * 1.0, s * 1.09, 0, 2.56, -0.08, 0.16, { color: BLACK }); // door jambs
    F.slab('gloss', s * 1.09, s * W, 0, 0.46, -0.08, 0.2, { color: BLACK }); // stall riser
    F.slab('metal', s * 1.09, s * W, 0.46, 0.5, -0.1, 0.23, { color: BRASS }); // sill
    F.slab('gloss', s * 1.09, s * W, 2.48, 2.56, -0.06, 0.12, { color: BLACK }); // head
    F.slab('gloss', s * 3.02, s * 3.08, 0.5, 2.48, 0.0, 0.07, { color: BLACK }); // mullion
    F.slab('glass', s * 1.09, s * W, 0.5, 2.48, 0.025, 0.04);
    F.print('doorBand', 1.9, at(s * 2.05, 1.05, 0.044), 'decal');
    F.print('doorBand', 1.85, at(s * 4.03, 1.05, 0.044), 'decal');
  }
  F.slab('gloss', -1.0, 1.0, 2.48, 2.56, -0.06, 0.16, { color: BLACK }); // transom
  F.slab('metal', -1.0, 1.0, -0.012, 0.004, -0.16, 0.28, { color: BRASS }); // threshold
  F.slab('led', -wall + 0.15, wall - 0.15, 2.535, 2.555, 0.22, 0.27); // a line of light under the sign
  bladeSign(F, -wall + 0.02, 3.05, 0.86, GOLD);
  sandwichBoard(F, 2.6, 1.0, 0.25, BLACK);
  F.print('hours', 0.42, at(1.42, 1.5, 0.044), 'print');
  F.print('open', 0.8, at(-3.95, 2.1, -0.08), 'neon');

  // ---- Shell ----
  R.slab('slate', -wall, wall, -0.1, 0, 0.02, cb, { tile: 1.2, color: 0xffffff });
  R.slab('quarry', -wall, wall, -0.1, 0, cb, -depth, { tile: 0.6, color: 0xffffff });
  R.slab('ceiling', -wall, wall, H, H + 0.12, 0, cb + 0.5, { tile: T.ceiling, color: 0x2a2826 });
  R.slab('paint', -wall, wall, H, H + 0.12, cb + 0.5, -depth, { color: 0xe6e6e2 });
  for (const s of [-1, 1]) {
    // dining room: black wainscot, a gold rail, cream above, a band of gold bars near the ceiling
    R.slab('plaster', s * W, s * wall, 0, H, 0, cb, { tile: T.plaster, color: CREAM });
    R.slab('gloss', s * (W - 0.02), s * W, 0.1, 1.1, -0.2, cb, { color: 0x191614 });
    R.slab('metal', s * (W - 0.03), s * W, 1.1, 1.135, -0.2, cb, { color: BRASS });
    R.slab('paint', s * (W - 0.025), s * W, 0, 0.1, -0.2, cb, { color: 0x0c0b0a });
    for (let z = -0.6; z > cb + 2; z -= 2.2) R.print('barsPattern', 2.2, at(s * (W - 0.004), 3.05, z - 1.1, -s * Math.PI / 2));
    // kitchen: white tile
    R.slab('tile', s * W, s * wall, 0, H, cb, -depth, { tile: 0.6, color: 0xffffff });
  }
  R.slab('tile', -wall, wall, 0, H, P.back, -depth, { tile: 0.6, color: 0xffffff });
  R.slab('rubber', -0.98, 0.98, 0, 0.012, -0.15, -1.5, { tile: T.rubber, color: 0x55524e });
  R.print('mat', 1.9, at(0, 0.014, -0.74, 0, -Math.PI / 2), 'print', 0.95);
  R.box('satin', 0, 2.72, -0.07, 0.56, 0.2, 0.02, { color: 0x101412 });
  R.print('exit', 0.52, at(0, 2.72, -0.082, Math.PI), 'glow');

  // ---- Booths along the left wall ----
  {
    const B = P.booth, t = B.table;
    P.booths.forEach((z, k) => {
      R.box('slats', (t.x0 + t.x1) / 2, t.h - 0.02, z, t.x1 - t.x0, 0.04, t.d, { tile: T.slats, color: WALNUT });
      R.box('metal', t.x1 + 0.006, t.h - 0.02, z, 0.012, 0.044, t.d + 0.01, { color: BRASS });
      R.rod('steel', t.x1 - 0.32, (t.h - 0.04) / 2, z, 0.04, t.h - 0.04, 'y', { color: DARK_STEEL });
      R.push('steel', new THREE.CylinderGeometry(0.2, 0.24, 0.025, 20), at(t.x1 - 0.32, 0.012, z), { color: DARK_STEEL });
      for (const side of [1, -1]) {
        const z0 = z + side * (B.offset - B.bench / 2), z1 = z + side * (B.offset + B.bench / 2), zb = z1 + side * 0.1;
        R.slab('gloss', B.x0, B.x1, 0, B.seat - 0.13, z0 + side * 0.03, z1, { color: 0x151210 });
        R.slab('leather', B.x0, B.x1 + 0.01, B.seat - 0.13, B.seat, z0, z1, { color: OXBLOOD });
        R.slab('leather', B.x0, B.x1 + 0.01, B.seat, B.back, z1, zb, { color: OXBLOOD });
        // channels in the back cushion, a gold piping on top
        for (let i = 1; i < 6; i++) R.box('leather', B.x0 + (B.x1 - B.x0) * i / 6, (B.seat + B.back) / 2 + 0.02, z1 - side * 0.004, 0.012, B.back - B.seat - 0.1, 0.01, { color: 0x4d110e });
        R.slab('metal', B.x0, B.x1 + 0.012, B.back, B.back + 0.018, z1 - side * 0.01, zb, { color: BRASS });
      }
      pendant(R, -4.4, H, z, 1.42, BLACK, 0.24);
      R.food('napkins', -4.82, t.h, z, Math.PI / 2);
      R.food('sauceRed', -4.84, t.h, z + 0.14); R.food('sauceYellow', -4.84, t.h, z - 0.14);
    });
    // between two booths: a low wall and a pane of glass
    for (let k = 0; k <= P.booths.length; k++) {
      const z = k < P.booths.length ? P.booths[k] + B.offset + B.bench / 2 + 0.14 : P.booths[k - 1] - B.offset - B.bench / 2 - 0.14;
      R.slab('gloss', B.x0, B.x1 + 0.02, 0, 1.3, z + 0.04, z - 0.04, { color: 0x151210 });
      R.slab('metal', B.x0, B.x1 + 0.03, 1.3, 1.32, z + 0.05, z - 0.05, { color: BRASS });
      R.slab('glass', B.x0, B.x1 - 0.02, 1.32, 1.72, z + 0.006, z - 0.006);
    }
    R.framed('posterBull', 0.66, -W + 0.03, 2.08, P.booths[0], Math.PI / 2);
    R.framed('posterDividende', 0.66, -W + 0.03, 2.08, P.booths[1], Math.PI / 2);
    R.framed('posterShake', 0.66, -W + 0.03, 2.08, P.booths[2], Math.PI / 2);
  }

  // ---- The window ledge and its stools ----
  {
    const L = P.ledge;
    R.slab('slats', L.x0, L.x1, L.h - 0.045, L.h, L.z + L.depth / 2, L.z - L.depth / 2, { tile: T.slats, color: WALNUT });
    R.slab('metal', L.x0, L.x1, L.h - 0.05, L.h + 0.004, L.z - L.depth / 2 - 0.012, L.z - L.depth / 2, { color: BRASS });
    for (let x = L.x0 + 0.3; x < L.x1; x += 1.05) R.box('steel', x, L.h - 0.2, L.z + 0.08, 0.03, 0.3, 0.26, { rx: 0.5, color: DARK_STEEL });
    for (const x of P.stools) stool(R, x, -0.98, 0.76, OXBLOOD);
    R.food('napkins', -1.7, L.h, L.z + 0.04);
  }

  // ---- Tables for two along the right wall ----
  {
    const t = P.table;
    for (const z of P.tables) {
      table(R, t.x, z, t.size, t.size, t.h, WALNUT, 'slats', BLACK);
      chair(R, t.x, z + t.chair, 0, -1, t.seat, OXBLOOD);
      chair(R, t.x, z - t.chair, 0, 1, t.seat, OXBLOOD);
      R.food('napkins', t.x + 0.24, t.h, z, -Math.PI / 2);
    }
    R.print('neonRefuge', 2.7, at(W - 0.05, 2.3, -4.9, -Math.PI / 2), 'neon');
    R.framed('chalk', 0.8, W - 0.03, 1.9, -2.2, -Math.PI / 2, 0x3b2a1c);
    R.framed('quarter', 0.46, W - 0.03, 1.85, -7.55, -Math.PI / 2, BRASS);
  }

  // ---- Order kiosks ----
  {
    const K = P.kiosk;
    for (const k of P.kiosks) {
      R.box('gloss', k.x, K.h / 2 + 0.02, k.z, K.w * 0.5, K.h - 0.04, K.d, { color: BLACK });
      R.box('steel', k.x, 0.02, k.z, K.w + 0.14, 0.04, K.d + 0.1, { color: DARK_STEEL });
      R.box('gloss', k.x - 0.11, 1.26, k.z, 0.06, 0.78, K.d + 0.04, { color: 0x0c0b0a });
      R.print('kiosk', K.d - 0.06, at(k.x - 0.142, 1.26, k.z, -Math.PI / 2), 'glow', 0.72);
      R.box('satin', k.x - 0.13, 0.78, k.z + 0.12, 0.05, 0.1, 0.16, { rz: -0.4, color: 0x2a2826 }); // the card reader
      R.box('metal', k.x - 0.092, 1.7, k.z, 0.01, 0.03, K.d + 0.045, { color: BRASS });
    }
  }

  // ---- Trays and bins by the door ----
  {
    const B = P.trash, x0 = B.x - B.w / 2, x1 = W - 0.02, z0 = B.z + B.d / 2, z1 = B.z - B.d / 2;
    R.slab('gloss', x0, x1, 0.06, B.h, z0, z1, { color: 0x191614 });
    R.slab('paint', x0 + 0.03, x1, 0, 0.06, z0 - 0.03, z1 + 0.03, { color: 0x0c0b0a });
    R.slab('slats', x0 - 0.02, x1, B.h, B.h + 0.035, z0 + 0.02, z1 - 0.02, { tile: T.slats, color: WALNUT });
    for (const s of [-1, 1]) {
      R.box('steel', x0 - 0.004, 0.86, B.z + s * 0.27, 0.012, 0.26, 0.42, { color: 0x2a2826 });
      R.print('trash', 0.38, at(x0 - 0.012, 0.86, B.z + s * 0.27, -Math.PI / 2), 'print', 0.19);
    }
    R.food('trayStack', B.x + 0.02, B.h + 0.035, B.z, Math.PI / 2);
  }

  // ---- The queue's belts ----
  for (const [x, z0, z1] of [[-1.5, -4.2, -7.3], [0.2, -4.2, -6.6]]) {
    for (let z = z0; z >= z1 - 0.01; z -= (z0 - z1) / 2) post(R, x, z);
    R.slab('fabric', x - 0.004, x + 0.004, 0.86, 0.91, z0, z1, { color: OXBLOOD });
  }

  // ---- The counter ----
  {
    R.slab('plate', C.x0, C.x1, 0, 0.1, cf - 0.04, cb, { tile: T.plate, color: 0x77797a });
    R.slab('gloss', C.x0, C.x1, 0.1, C.h - 0.05, cf, cb, { color: BLACK });
    R.slab('metal', C.x0, C.x1, 0.82, 0.85, cf + 0.008, cf, { color: BRASS });
    R.slab('satin', C.x0, C.x1 + 0.02, C.h - 0.05, C.h, cf + 0.05, cb - 0.02, { color: 0xe9e2d2 });
    R.print('orderHere', 1.7, at(-2.85, 0.5, cf + 0.004), 'glow');
    R.print('pickup', 1.7, at(P.pickup - 0.1, 0.5, cf + 0.004), 'glow');
    for (const x of P.tills) {
      // a till: its stand, a screen to the cashier, a card reader to the customer
      R.box('satin', x, C.h + 0.02, C.z - 0.1, 0.3, 0.04, 0.26, { color: 0x1a1918 });
      R.rod('steel', x, C.h + 0.16, C.z - 0.14, 0.018, 0.26, 'y', { color: DARK_STEEL });
      R.box('gloss', x, C.h + 0.34, C.z - 0.13, 0.36, 0.26, 0.03, { rx: 0.22, color: 0x0c0b0a });
      R.box('led', x, C.h + 0.34, C.z - 0.147, 0.32, 0.22, 0.004, { rx: 0.22 });
      R.box('satin', x + 0.34, C.h + 0.05, C.z + 0.16, 0.09, 0.05, 0.16, { rx: 0.5, color: 0x2a2826 });
      R.food('napkins', x - 0.5, C.h, C.z + 0.1);
    }
    R.food('cupStack', -0.6, C.h, C.z - 0.12);
    // the gate to the kitchen
    const G = P.gate;
    R.slab('gloss', G.x0 + 0.02, G.x1 - 0.02, 0.12, G.h, G.z + 0.025, G.z - 0.025, { color: BLACK });
    R.slab('metal', G.x0 + 0.02, G.x1 - 0.02, G.h, G.h + 0.02, G.z + 0.03, G.z - 0.03, { color: BRASS });
    R.print('staff', 0.5, at((G.x0 + G.x1) / 2, 0.66, G.z + 0.028));
  }

  // ---- Over the counter: three menu boards, the ticker, the order screen ----
  {
    const M = P.menu, y = (M.y0 + M.y1) / 2;
    R.slab('gloss', -4.85, 3.3, M.y0 - 0.34, M.y1 + 0.06, M.z - 0.1, M.z - 0.02, { color: 0x0c0b0a });
    [-3.75, -1.55, 0.65].forEach((x, i) => R.print(`menu${i + 1}`, 2.1, at(x, y + 0.03, M.z - 0.016), 'glow'));
    R.print('ticker', 6.5, at(-1.55, M.y0 - 0.19, M.z - 0.014), 'ticker', 0.2);
    for (const x of [-4.4, 1.3, 3.0]) R.rod('steel', x, (M.y1 + 0.06 + H) / 2, M.z - 0.06, 0.012, H - M.y1 - 0.06, 'y', { color: DARK_STEEL, segments: 6 });
    R.box('gloss', 2.52, y + 0.03, M.z - 0.05, 1.3, 0.78, 0.06, { color: 0x0c0b0a });
    R.push('screen', new THREE.PlaneGeometry(1.2, 0.675), at(2.52, y + 0.03, M.z - 0.018));
  }

  // ---- The soda fountain ----
  {
    const D = P.fountain, x0 = D.x0 + 0.04, x1 = W - 0.02, mid = (x0 + x1) / 2;
    R.slab('gloss', x0, x1, 0.1, D.h - 0.04, cf, cb, { color: BLACK });
    R.slab('plate', x0, x1, 0, 0.1, cf - 0.04, cb, { tile: T.plate, color: 0x77797a });
    R.slab('steel', x0 - 0.02, x1, D.h - 0.04, D.h, cf + 0.04, cb, { color: STEEL });
    R.slab('gloss', x0 + 0.08, x1 - 0.06, D.h + 0.2, D.top, cf - 0.18, cb + 0.04, { color: 0x1a1816 });
    R.slab('steel', x0 + 0.08, x1 - 0.06, D.h, D.h + 0.2, cf - 0.3, cb + 0.04, { color: STEEL });
    R.slab('amber', x0 + 0.14, x1 - 0.12, D.top - 0.26, D.top - 0.06, cf - 0.176, cf - 0.18);
    for (let i = 0; i < 6; i++) {
      const x = x0 + 0.24 + i * (x1 - x0 - 0.5) / 5;
      R.rod('steel', x, D.h + 0.3, cf - 0.14, 0.014, 0.08, 'y', { color: STEEL, segments: 8 });
      R.box('paint', x, D.h + 0.39, cf - 0.165, 0.05, 0.07, 0.02, { color: [0xb5281c, 0x1d5e8a, 0xd6a22a, 0x2f7a4a, 0x6b3a1c, 0xd8d4c8][i] });
    }
    R.slab('steel', x0 + 0.1, x1 - 0.08, D.h + 0.002, D.h + 0.012, cf - 0.02, cf - 0.26, { color: DARK_STEEL }); // the drip tray
    R.food('cupStack', x0 + 0.02, D.h, cf - 0.1); R.food('cupStack', mid + 0.5, D.h, cf - 0.08);
    R.food('napkins', mid + 0.52, D.h, cf - 0.4);
  }

  // ---- The kitchen: the island facing the room, its hood ----
  {
    const I = P.island, zf = I.z + I.depth / 2, zb = I.z - I.depth / 2, top = I.h;
    R.slab('plate', I.x0, I.x1, 0.12, top - 0.04, zf, zb, { tile: T.plate, color: 0xa9adb0 });
    R.slab('paint', I.x0 + 0.04, I.x1 - 0.04, 0, 0.12, zf - 0.05, zb + 0.05, { color: 0x1c1c1c });
    R.slab('steel', I.x0 - 0.02, I.x1 + 0.02, top - 0.04, top, zf + 0.02, zb - 0.02, { color: STEEL });
    // the griddle: a dark plate, a grease trough, low guards
    const G = P.griddle;
    R.slab('gloss', G.x0, G.x1, top, top + 0.035, zf - 0.14, zb + 0.06, { color: 0x1b1a19 });
    R.slab('steel', G.x0, G.x1, top, top + 0.02, zf - 0.06, zf - 0.14, { color: DARK_STEEL });
    for (const x of [G.x0 - 0.012, G.x1 + 0.012]) R.slab('steel', x - 0.008, x + 0.008, top, top + 0.16, zf - 0.14, zb + 0.06, { color: STEEL });
    for (let i = 0; i < 5; i++) R.rod('paint', G.x0 + 0.3 + i * 0.42, top - 0.2, zf + 0.012, 0.028, 0.03, 'z', { color: 0x151515, segments: 12 });
    [[-3.9, -11.0, 1], [-3.62, -11.02, 1], [-3.34, -10.98, 1], [-3.92, -11.3, 1], [-3.64, -11.32, 0], [-3.36, -11.3, 0], [-2.5, -11.02, 1], [-2.22, -11.0, 1]].forEach(([x, z, done], i) => R.food(done ? 'pattyDone' : 'pattyRaw', x, top + 0.035, z, i));
    // the dressing station: a board, pans of garnish, buns, the chute under its heat lamps
    const D = P.dress;
    R.slab('satin', D.x0 + 0.05, D.x1 - 0.05, top, top + 0.022, zf - 0.2, zb + 0.3, { color: 0xe6e0d0 });
    [0x4f8f3a, 0xb5281c, 0xe4c64a, 0xd8d2c0, 0x6f8f2f].forEach((color, i) => {
      const x = D.x0 + 0.2 + i * 0.33;
      R.slab('steel', x - 0.14, x + 0.14, top, top + 0.07, zb + 0.28, zb + 0.04, { color: STEEL });
      R.slab('paint', x - 0.12, x + 0.12, top + 0.05, top + 0.075, zb + 0.26, zb + 0.06, { color });
    });
    for (let i = 0; i < 4; i++) { R.food('bunBottom', D.x0 + 0.24 + i * 0.26, top + 0.022, zf - 0.38, i); R.food('bunTop', D.x0 + 0.24 + i * 0.26, top + 0.022, zf - 0.56, i * 2); }
    R.food('sauceRed', D.x1 - 0.14, top + 0.022, zf - 0.34); R.food('sauceYellow', D.x1 - 0.14, top + 0.022, zf - 0.5);
    R.box('steel', (D.x0 + D.x1) / 2, 1.16, zf + 0.2, D.x1 - D.x0, 0.02, 0.52, { rx: 0.32, color: STEEL });
    for (const x of [D.x0, D.x1]) R.box('steel', x, 1.2, zf + 0.2, 0.02, 0.1, 0.54, { rx: 0.32, color: STEEL });
    for (const x of [D.x0 + 0.02, D.x1 - 0.02]) R.rod('steel', x, 1.22, zf - 0.03, 0.014, 0.66, 'y', { color: STEEL, segments: 6 });
    R.rod('steel', (D.x0 + D.x1) / 2, 1.56, zf + 0.14, 0.03, D.x1 - D.x0, 'x', { color: DARK_STEEL, segments: 8 });
    R.slab('ember', D.x0 + 0.1, D.x1 - 0.1, 1.525, 1.535, zf + 0.17, zf + 0.11);
    for (let i = 0; i < 5; i++) R.food('burgerWrapped', D.x0 + 0.26 + i * 0.3, 1.09 + (i % 2) * 0.004, zf + 0.3, 0.3 * i, 1, 0.32);
    // the fryers: two vats of oil, the station where the fries wait
    const Y = P.fryers;
    for (const [a, b] of [[Y.x0 + 0.05, Y.x0 + 0.6], [Y.x0 + 0.65, Y.x0 + 1.2]]) {
      R.slab('steel', a, b, top, top + 0.03, zf - 0.1, zb + 0.08, { color: DARK_STEEL });
      R.slab('oil', a + 0.04, b - 0.04, top + 0.012, top + 0.032, zf - 0.14, zb + 0.14);
      R.rod('steel', (a + b) / 2, top + 0.3, zb + 0.07, 0.012, 0.6, 'y', { color: STEEL, segments: 6 });
      R.box('steel', (a + b) / 2, top + 0.6, zb + 0.07, b - a - 0.1, 0.02, 0.03, { color: STEEL });
    }
    R.slab('steel', Y.x0 + 1.26, Y.x1 + 0.04, top, top + 0.1, zf - 0.08, zb + 0.1, { color: STEEL });
    for (let i = 0; i < 4; i++) R.food('fries', Y.x0 + 1.36 + (i % 2) * 0.24, top + 0.1, zf - 0.26 - Math.floor(i / 2) * 0.24, 0.2 * i);
    R.rod('steel', Y.x0 + 1.55, 1.4, zb + 0.12, 0.012, 1.0, 'y', { color: STEEL, segments: 6 });
    R.slab('ember', Y.x0 + 1.3, Y.x1, 1.5, 1.51, zf - 0.2, zb + 0.2);
    R.slab('steel', Y.x0 + 1.28, Y.x1 + 0.02, 1.51, 1.54, zf - 0.16, zb + 0.16, { color: DARK_STEEL });
    // the hood
    const Hd = P.hood;
    R.slab('steel', Hd.x0, Hd.x1, Hd.y1 - 0.03, Hd.y1, Hd.z0, Hd.z1, { color: STEEL });
    for (const z of [Hd.z0, Hd.z1]) R.slab('steel', Hd.x0, Hd.x1, Hd.y0, Hd.y1, z + 0.012, z - 0.012, { color: STEEL });
    for (const x of [Hd.x0, Hd.x1]) R.slab('steel', x - 0.012, x + 0.012, Hd.y0, Hd.y1, Hd.z0, Hd.z1, { color: STEEL });
    R.slab('steel', -1.6, -0.6, Hd.y1, H, -11.0, -11.5, { color: STEEL });
    for (let x = Hd.x0 + 0.5; x < Hd.x1; x += 1.0) R.box('steel', x, Hd.y0 + 0.2, Hd.z1 + 0.22, 0.8, 0.02, 0.5, { rx: -0.7, color: DARK_STEEL });
    for (const x of [-3.2, -0.9, 1.0]) R.slab('led', x - 0.3, x + 0.3, Hd.y0 + 0.012, Hd.y0 + 0.02, -11.0, -11.08);
  }

  // ---- Back of house ----
  {
    const Sh = P.shelves;
    if (!R.prop('shelves', -2.0, 0, Sh.z, 0) || !R.prop('shelves', -0.85, 0, Sh.z, 0) || !R.prop('shelves', 0.3, 0, Sh.z, 0) || !R.prop('shelves_narrow', 1.2, 0, Sh.z, 0)) {
      for (const y of [0.3, 0.9, 1.5, 2.05]) R.slab('steel', -2.6, 1.6, y, y + 0.03, Sh.z + 0.25, Sh.z - 0.25, { color: STEEL });
    }
    for (let i = 0; i < 7; i++) R.prop('cardboard_box', -2.3 + i * 0.52, [0.52, 1.07, 1.62][i % 3], Sh.z, 0.1 * (i % 3 - 1), 0.9);
    // a two-door refrigerator
    R.slab('steel', -4.92, -2.75, 0.1, 2.05, P.back, P.back + 0.75, { color: STEEL });
    R.slab('paint', -4.9, -2.77, 0, 0.1, P.back, P.back + 0.7, { color: 0x1c1c1c });
    for (const x of [-4.36, -3.3]) { R.slab('steel', x - 0.5, x + 0.5, 0.16, 2.0, P.back + 0.75, P.back + 0.775, { color: 0xc2c6c9 }); R.rod('steel', x + (x < -4 ? 0.42 : -0.42), 1.1, P.back + 0.81, 0.014, 0.5, 'y', { color: DARK_STEEL, segments: 6 }); }
    // the cold room's door
    const Cr = P.coldRoom;
    R.slab('steel', Cr.x0, Cr.x1, 0, 2.2, P.back, P.back + 0.06, { color: 0xc6c9cb });
    R.slab('steel', Cr.x0 - 0.06, Cr.x1 + 0.06, 0, 2.26, P.back, P.back + 0.03, { color: DARK_STEEL });
    R.box('steel', Cr.x1 - 0.2, 1.08, P.back + 0.09, 0.05, 0.34, 0.05, { color: DARK_STEEL });
    R.box('glass', (Cr.x0 + Cr.x1) / 2, 1.6, P.back + 0.066, 0.3, 0.3, 0.01);
    // the sink
    const K = P.sink;
    R.slab('steel', K.x - K.w / 2, W - 0.02, 0.12, K.h, K.z + K.d / 2, K.z - K.d / 2, { color: STEEL });
    R.slab('gloss', K.x - K.w / 2 + 0.08, W - 0.1, K.h - 0.02, K.h + 0.004, K.z + K.d / 2 - 0.1, K.z - K.d / 2 + 0.1, { color: 0x2a2c2d });
    R.rod('steel', W - 0.16, K.h + 0.14, K.z, 0.014, 0.28, 'y', { color: STEEL, segments: 8 });
    R.rod('steel', W - 0.25, K.h + 0.28, K.z, 0.012, 0.2, 'x', { color: STEEL, segments: 8 });
    // the attendant's corner: a bucket on wheels, a mop, the yellow sign
    R.box('paint', 4.45, 0.2, -10.75, 0.34, 0.3, 0.46, { color: 0xd9b21c });
    R.box('paint', 4.45, 0.4, -10.92, 0.3, 0.12, 0.14, { color: 0xb8961a });
    R.rod('slats', 4.62, 0.82, -10.6, 0.014, 1.5, 'y', { color: 0xb59468, segments: 6 });
    if (!R.prop('wet_floor_sign', 3.85, 0, -10.9, -0.4)) R.box('paint', 3.85, 0.3, -10.9, 0.3, 0.6, 0.04, { rx: 0.2, color: 0xe2c21c });
    R.prop('wall_clock', -W + 0.004, 2.6, -12.4, Math.PI / 2, 1.2);
    R.prop('extinguisher', W - 0.2, 0, -13.6, -Math.PI / 2, 0.9);
    R.prop('first_aid', W - 0.004, 1.6, -13.9, -Math.PI / 2, 0.8);
    R.prop('camera', W - 0.004, 3.05, -0.9, -Math.PI / 2);
    R.prop('fire_alarm', W - 0.004, 1.45, -8.3, -Math.PI / 2);
    striplight(R, -2.6, H, -12.3, 1.4); striplight(R, 0.9, H, -12.3, 1.4); striplight(R, 3.6, H, -12.6, 1.2, true);
  }

  // ---- Ceiling of the dining room: recessed spots, a duct ----
  for (const z of P.tables) { R.push('satin', new THREE.CylinderGeometry(0.07, 0.07, 0.12, 14), at(P.table.x, H - 0.05, z), { color: BLACK }); R.push('bulb', new THREE.CircleGeometry(0.055, 14), at(P.table.x, H - 0.112, z, 0, Math.PI / 2)); }
  for (const [x, z] of [[0, -1.7], [-0.6, -4.8], [-2.9, -7.7], [1.3, -7.7]]) { R.push('satin', new THREE.CylinderGeometry(0.07, 0.07, 0.12, 14), at(x, H - 0.05, z), { color: BLACK }); R.push('bulb', new THREE.CircleGeometry(0.055, 14), at(x, H - 0.112, z, 0, Math.PI / 2)); }
  for (let z = -1.6; z > cb + 1.2; z -= 1.8) R.prop('duct', 1.9, H, z, Math.PI / 2);

  return { front: front.finish(new THREE.Group(), { shadows: ['gloss', 'satin'] }), room: R.finish(new THREE.Group(), { shadows: ['plaster', 'ceiling', 'tile', 'paint'] }) };
}

// ---- TRANCHE -------------------------------------------------------------------------------------------------------------

const TRANCHE_LIGHTS = [
  { kind: 'spot', x: -2.2, y: 3.15, z: -1.5, tx: -2.2, ty: 0.9, tz: -0.7, color: 0xffe2b8, power: 70, reach: 6, angle: 0.95 }, // the dough bench, for the street
  { kind: 'point', x: -0.1, y: 1.42, z: -1.6, color: 0xffcf8f, power: 4.5, reach: 2.6 }, // the display's own lamps
  { kind: 'point', x: -0.1, y: 1.42, z: -3.4, color: 0xffcf8f, power: 4.5, reach: 2.6 },
  { kind: 'point', x: 1.2, y: 2.95, z: -2.6, color: 0xfff0dc, power: 15, reach: 7.5 },
  { kind: 'point', x: 1.2, y: 2.95, z: -5.6, color: 0xfff0dc, power: 15, reach: 7.5 },
  { kind: 'point', x: -1.2, y: 3.0, z: -4.2, color: 0xeef3ff, power: 16, reach: 7 },
  { kind: 'point', x: -1.5, y: 1.2, z: -5.25, color: 0xff7a2a, power: 9, reach: 4, fire: true }, // the oven's mouth
  { kind: 'point', x: 2.4, y: 2.0, z: -2.9, color: 0xffc78a, power: 8, reach: 4.5 },
  { kind: 'point', x: 2.4, y: 2.0, z: -5.0, color: 0xffc78a, power: 8, reach: 4.5 },
  { kind: 'point', x: 1.9, y: 2.2, z: -9.8, color: 0xffc78a, power: 13, reach: 6.5 },
  { kind: 'point', x: -1.5, y: 2.3, z: -11.8, color: 0xff3b2a, power: 7, reach: 5 }, // the neon's glow
  { kind: 'point', x: -1.9, y: 1.4, z: -8.65, color: 0xcfe6ff, power: 5, reach: 3 }, // the fridge
  { kind: 'spot', x: -1.2, y: 2.3, z: 0.75, tx: -1.2, ty: 0, tz: 1.0, color: 0xffd3a0, power: 46, reach: 7, angle: 1.1, night: true },
  { kind: 'spot', x: 1.6, y: 2.3, z: 0.75, tx: 1.6, ty: 0, tz: 1.0, color: 0xffd3a0, power: 46, reach: 7, angle: 1.1, night: true }
];

function buildTranche(materials, T) {
  const S = SPECS.tranche, P = PLANS.tranche, H = P.ceiling, W = P.half, wall = S.width / 2, depth = S.depth, TOP = S.height - S.floor;
  const front = new Room(materials, PRINTS.tranche, 'Tranche'), R = new Room(materials, PRINTS.tranche, 'Tranche');
  const C = P.counter, Wn = P.window, Ht = P.hatch, D = P.door;

  // ---- The front: red tiles, a striped awning, the sign on cream ----
  const F = front;
  F.slab('paint', -wall, wall, 2.62, TOP, -0.06, 0.26, { color: 0xf1e8d4 });
  F.slab('gloss', -wall, wall, 2.62, 2.68, -0.06, 0.29, { color: TOMATO });
  F.slab('gloss', -wall, wall, TOP - 0.06, TOP, -0.06, 0.3, { color: TOMATO });
  F.print('fascia', S.width - 0.24, at(0, (2.68 + TOP - 0.06) / 2, 0.264), 'print');
  for (const s of [-1, 1]) F.slab('gloss', s * W, s * wall, 0, 2.62, -0.06, 0.24, { color: TOMATO_DEEP });
  F.slab('gloss', Wn.x1, D.x0, 0, 2.62, -0.06, 0.2, { color: TOMATO_DEEP }); // between the window and the door
  // under the window: red tiles and a cream line; the sill
  F.slab('gloss', -W, Wn.x1, 0, Wn.sill - 0.04, -0.08, 0.16, { color: TOMATO });
  F.slab('paint', -W, Wn.x1, Wn.sill - 0.2, Wn.sill - 0.16, 0.16, 0.166, { color: 0xf1e8d4 });
  F.slab('steel', -W, Wn.x1, Wn.sill - 0.04, Wn.sill, -0.1, 0.2, { color: STEEL });
  F.slab('gloss', -W, Wn.x1, Wn.head, 2.62, -0.06, 0.12, { color: TOMATO_DEEP });
  // glass: the dough bay, the end of the display; the hatch is open, its sash pushed up
  F.slab('glass', -W, Ht.x0, Wn.sill, Wn.head, 0.02, 0.035);
  F.slab('glass', Ht.x1, Wn.x1, Wn.sill, Wn.head, 0.02, 0.035);
  F.slab('glass', Ht.x0, Ht.x1, 2.0, Wn.head, 0.045, 0.06);
  for (const x of [Ht.x0, Ht.x1]) F.slab('gloss', x - 0.03, x + 0.03, Wn.sill, Wn.head, -0.02, 0.08, { color: TOMATO_DEEP });
  F.slab('gloss', Ht.x0, Ht.x1, 1.97, 2.03, 0.03, 0.075, { color: TOMATO_DEEP });
  F.slab('steel', Ht.x0 - 0.04, Ht.x1 + 0.04, Ht.h - 0.03, Ht.h, 0.3, Ht.z1, { color: STEEL }); // the hatch's shelf, out over the sidewalk
  for (const x of [Ht.x0 + 0.1, Ht.x1 - 0.1]) F.box('steel', x, Ht.h - 0.14, 0.2, 0.02, 0.24, 0.02, { rx: -0.7, color: DARK_STEEL });
  F.print('window', 0.5, at(0.03, 1.72, 0.012), 'print');
  F.print('neonSlice', 0.78, at(-2.25, 1.98, -0.06), 'neon');
  // the door's frame
  F.slab('gloss', D.x0, D.x1, D.h, 2.62, -0.06, 0.12, { color: TOMATO_DEEP });
  F.slab('glass', D.x0 + 0.04, D.x1 - 0.04, D.h + 0.04, 2.58, 0.02, 0.035);
  F.print('open', 0.86, at((D.x0 + D.x1) / 2, 2.49, -0.02), 'neon');
  F.slab('steel', D.x0, D.x1, -0.012, 0.004, -0.14, 0.24, { color: STEEL });
  // the awning: red and cream stripes sloping out over the sidewalk, a straight valance
  {
    const n = 16, w = (S.width - 0.1) / n, reach = 1.05, drop = 0.42, y = 2.6;
    for (let i = 0; i < n; i++) {
      const x = -wall + 0.05 + (i + 0.5) * w, color = i % 2 ? 0xf1e8d4 : TOMATO;
      F.box('fabric', x, y - drop / 2, 0.28 + reach / 2, w, 0.02, Math.hypot(reach, drop), { rx: Math.atan2(drop, reach), color });
      F.box('fabric', x, y - drop - 0.11, 0.28 + reach, w, 0.22, 0.012, { color });
    }
    for (const x of [-wall + 0.06, 0, wall - 0.06]) F.rod('steel', x, y - drop / 2 - 0.02, 0.28 + reach / 2, 0.012, Math.hypot(reach, drop), 'z', { color: DARK_STEEL, segments: 6 });
  }
  bladeSign(F, wall - 0.02, 3.1, 0.82, TOMATO);
  sandwichBoard(F, 2.75, 1.25, -0.3, TOMATO_DEEP);

  // ---- Shell ----
  R.slab('checker', -wall, wall, -0.1, 0, 0.02, -depth, { tile: 0.6, color: 0xffffff });
  R.slab('rubber', -1.6, C.x0, 0, 0.014, -1.0, P.gate.z, { tile: T.rubber, color: 0x4a4a48 });
  R.slab('paint', -wall, wall, H, H + 0.3, 0, -depth, { color: 0xeee9dc });
  // left wall: white tile to the ceiling behind the counter, tile below and cream above in the back room
  R.slab('tile', -wall, -W, 0, H, 0, P.partition.z, { tile: 0.6, color: 0xffffff });
  R.slab('tile', -wall, -W, 0, 1.4, P.partition.z, -depth, { tile: 0.6, color: 0xffffff });
  R.slab('plaster', -wall, -W, 1.4, H, P.partition.z, -depth, { tile: T.plaster, color: 0xf1e7d0 });
  R.slab('tile', W, wall, 0, 1.4, 0, -depth, { tile: 0.6, color: 0xffffff });
  R.slab('plaster', W, wall, 1.4, H, 0, -depth, { tile: T.plaster, color: 0xf1e7d0 });
  R.slab('tile', -wall, wall, 0, 1.4, P.back, -depth, { tile: 0.6, color: 0xffffff });
  R.slab('plaster', -wall, wall, 1.4, H, P.back, -depth, { tile: T.plaster, color: 0xf1e7d0 });
  // a red line where the tile stops
  R.slab('gloss', W - 0.012, W, 1.4, 1.46, -0.2, P.back, { color: TOMATO });
  R.slab('gloss', -W, -W + 0.012, 1.4, 1.46, P.partition.z, P.back, { color: TOMATO });
  R.slab('gloss', -W, W, 1.4, 1.46, P.back + 0.012, P.back, { color: TOMATO });
  // the inside of the front under the window
  R.slab('tile', -W, Wn.x1, 0, Wn.sill - 0.04, -0.08, -0.12, { tile: 0.6, color: 0xffffff });
  R.box('satin', (D.x0 + D.x1) / 2, 2.52, -0.085, 0.56, 0.18, 0.02, { color: 0x101412 });
  R.print('exit', 0.5, at((D.x0 + D.x1) / 2, 2.52, -0.097, Math.PI), 'glow');

  // ---- The window bench: dough, flour, sauce ----
  {
    const B = P.bench;
    R.slab('tile', B.x0, B.x1, 0, B.h - 0.04, B.z0, B.z1, { tile: 0.6, color: 0xffffff });
    R.slab('gloss', B.x0, B.x1 + 0.02, B.h - 0.04, B.h, B.z0 + 0.02, B.z1 - 0.03, { color: MARBLE });
    R.box('steel', -2.62, B.h + 0.012, -0.5, 0.5, 0.024, 0.36, { color: STEEL }); // a tray of dough balls
    for (let i = 0; i < 6; i++) R.food('doughBall', -2.78 + (i % 3) * 0.16, B.h + 0.024, -0.4 - Math.floor(i / 3) * 0.17, i);
    R.food('doughDisc', -1.98, B.h, -0.56, 0.4);
    R.rod('steel', -2.84, B.h + 0.09, -0.82, 0.09, 0.18, 'y', { color: STEEL, segments: 16 }); // the sauce pot
    R.push('paint', new THREE.CircleGeometry(0.082, 16), at(-2.84, B.h + 0.172, -0.82, 0, -Math.PI / 2), { color: 0xb2301c });
    R.rod('steel', -2.8, B.h + 0.26, -0.8, 0.006, 0.26, 'y', { color: STEEL, segments: 5 });
    R.box('paint', -1.78, B.h + 0.07, -0.26, 0.2, 0.14, 0.12, { color: 0xe9e2cf }); // the flour bin
    R.food('shakerCheese', -2.3, B.h, -0.26); R.food('shakerOregano', -2.18, B.h, -0.26);
  }

  // ---- The hatch's shelf ----
  R.food('plateStack', Ht.x0 + 0.2, Ht.h, -0.34);
  R.food('napkins', Ht.x1 - 0.2, Ht.h, -0.36, Math.PI);
  for (const [i, name] of ['shakerChili', 'shakerOregano', 'shakerCheese'].entries()) R.food(name, -1.12 + i * 0.1, Ht.h, 0.12);
  R.rod('glass', Ht.x1 - 0.16, Ht.h + 0.08, 0.14, 0.05, 0.16, 'y', { segments: 14 }); // the tip jar
  R.print('tips', 0.09, at(Ht.x1 - 0.16, Ht.h + 0.08, 0.192), 'print');

  // ---- The long counter: red tile front, steel top, the glass display of pies ----
  {
    const x0 = C.x0, x1 = C.x1, Dp = P.display;
    R.slab('gloss', x1 - 0.02, x1, 0.12, C.h - 0.04, C.z0, C.z1, { color: TOMATO });
    R.slab('paint', x1 - 0.03, x1 + 0.004, 0.56, 0.62, C.z0, C.z1, { color: 0xf1e8d4 });
    R.slab('plate', x0, x1 - 0.02, 0, C.h - 0.04, C.z0, C.z1, { tile: T.plate, color: 0xa9adb0 });
    R.slab('paint', x1 - 0.06, x1, 0, 0.12, C.z0, C.z1, { color: 0x1c1c1c });
    R.slab('steel', x0 - 0.02, x1 + 0.03, C.h - 0.04, C.h, C.z0 + 0.02, C.z1 - 0.02, { color: STEEL });
    // the display: glass to the customers and on top, open to the staff
    R.slab('glass', x1 - 0.004, x1 + 0.006, C.h, Dp.top, Dp.z0, Dp.z1);
    R.slab('glass', x0 + 0.16, x1, Dp.top - 0.008, Dp.top, Dp.z0, Dp.z1);
    for (const z of [Dp.z0, Dp.z1]) R.slab('glass', x0 + 0.16, x1, C.h, Dp.top, z + 0.004, z - 0.004);
    for (const z of [Dp.z0, (Dp.z0 + Dp.z1) / 2, Dp.z1]) R.box('steel', x1, (C.h + Dp.top) / 2, z, 0.022, Dp.top - C.h, 0.022, { color: STEEL });
    R.slab('steel', x0 + 0.14, x1 + 0.012, Dp.top, Dp.top + 0.02, Dp.z0 + 0.012, Dp.z1 - 0.012, { color: STEEL });
    R.slab('led', x1 - 0.05, x1 - 0.035, Dp.top - 0.03, Dp.top - 0.018, Dp.z0 - 0.06, Dp.z1 + 0.06);
    const pies = ['pieMargherita', 'piePepperoniPart', 'pieBianca', 'pieMargheritaPart', 'piePepperoni', 'pieBiancaPart'];
    Dp.pies.forEach((z, i) => {
      R.rod('steel', -0.1, C.h + 0.03, z, 0.07, 0.06, 'y', { color: DARK_STEEL, segments: 12 });
      R.food(pies[i], -0.1, C.h + 0.06, z, i * 1.3);
    });
    // the till, the pass
    R.box('satin', -0.08, C.h + 0.02, P.till, 0.3, 0.04, 0.3, { color: 0x1a1918 });
    R.box('gloss', -0.14, C.h + 0.2, P.till, 0.04, 0.26, 0.34, { rz: 0.22, color: 0x0c0b0a });
    R.box('led', -0.165, C.h + 0.2, P.till, 0.004, 0.22, 0.3, { rz: 0.22 });
    R.box('satin', 0.16, C.h + 0.04, P.till - 0.3, 0.14, 0.05, 0.09, { rz: -0.4, color: 0x2a2826 });
    R.food('plateStack', -0.22, C.h, P.pickup + 0.32);
    R.food('napkins', 0.08, C.h, P.pickup - 0.42, Math.PI / 2);
    for (const [i, name] of ['shakerChili', 'shakerOregano', 'shakerCheese'].entries()) R.food(name, 0.14, C.h, P.pickup - 0.62 - i * 0.1);
    R.food('boxStack', -0.14, C.h, C.z1 + 0.32, 0.1, 0.7);
  }

  // ---- The back line: prep table, the deck oven, boxes ----
  {
    const Pr = P.prep;
    R.slab('steel', Pr.x0, Pr.x1, Pr.h - 0.04, Pr.h, Pr.z0, Pr.z1, { color: STEEL });
    for (const z of [Pr.z0 - 0.05, Pr.z1 + 0.05]) for (const x of [Pr.x0 + 0.05, Pr.x1 - 0.05]) R.box('steel', x, (Pr.h - 0.04) / 2, z, 0.04, Pr.h - 0.04, 0.04, { color: STEEL });
    R.slab('steel', Pr.x0, Pr.x1, 0.2, 0.23, Pr.z0, Pr.z1, { color: STEEL });
    R.food('pieRaw', -2.56, Pr.h, -2.68, 0.5);
    [0xe9e3cf, 0xb2301c, 0x8f2a1c, 0x3f7f3a, 0xe8d9a8].forEach((color, i) => {
      const z = Pr.z0 - 0.78 - i * 0.14;
      R.slab('steel', Pr.x0 + 0.06, Pr.x0 + 0.34, Pr.h, Pr.h + 0.07, z + 0.065, z - 0.065, { color: STEEL });
      R.slab('paint', Pr.x0 + 0.08, Pr.x0 + 0.32, Pr.h + 0.05, Pr.h + 0.075, z + 0.05, z - 0.05, { color });
    });
    R.framed('menuBoard', 2.2, -W + 0.03, 2.38, -2.4, Math.PI / 2, STEEL);
    // the oven: two decks, each a long door with a bar; fire behind
    const O = P.oven, xf = O.x1;
    R.slab('steel', O.x0, xf, 0.36, O.h, O.z0, O.z1, { color: 0xa7abae });
    for (const z of [O.z0 - 0.08, O.z1 + 0.08]) for (const x of [O.x0 + 0.08, xf - 0.08]) R.box('steel', x, 0.18, z, 0.07, 0.36, 0.07, { color: DARK_STEEL });
    for (const y of [1.18, 1.62]) {
      R.slab('gloss', xf, xf + 0.012, y - 0.15, y + 0.15, O.z0 - 0.12, O.z1 + 0.12, { color: 0x1a1817 });
      R.slab('ember', xf + 0.012, xf + 0.014, y - 0.09, y + 0.1, O.z0 - 0.3, O.z1 + 0.3);
      R.slab('steel', xf + 0.01, xf + 0.03, y + 0.15, y + 0.19, O.z0 - 0.08, O.z1 + 0.08, { color: STEEL });
    }
    R.slab('steel', xf, xf + 0.02, 0.5, 0.96, O.z0 - 0.1, O.z1 + 0.1, { color: 0x9a9ea1 });
    for (let i = 0; i < 4; i++) R.rod('paint', xf + 0.03, 0.74, O.z0 - 0.4 - i * 0.26, 0.035, 0.03, 'x', { color: 0x151515, segments: 12 });
    R.print('ovenPlate', 0.42, at(xf + 0.022, 0.74, O.z1 + 0.6, Math.PI / 2));
    R.slab('steel', O.x0, xf - 0.2, O.h, H, O.z0 - 0.5, O.z1 + 0.5, { color: STEEL }); // the flue
    R.food('peel', -1.72, 0.04, O.z0 + 0.14, 0, 1, -Math.PI / 2 + 0.08);
    // boxes, folded and waiting
    const Bx = P.boxes;
    for (const y of [0.1, 0.72, 1.34]) { R.slab('steel', Bx.x0, Bx.x1, y, y + 0.03, Bx.z0, Bx.z1, { color: STEEL }); R.food('boxStack', (Bx.x0 + Bx.x1) / 2 - 0.02, y + 0.03, (Bx.z0 + Bx.z1) / 2, 0.05, 0.92); }
    for (const z of [Bx.z0, Bx.z1]) for (const x of [Bx.x0 + 0.02, Bx.x1 - 0.02]) R.rod('steel', x, 0.95, z, 0.014, 1.9, 'y', { color: STEEL, segments: 6 });
    // the low wall and the half-door that close the staff's side
    const Pt = P.partition, G = P.gate;
    R.slab('tile', Pt.x0, Pt.x1, 0, Pt.h, Pt.z + 0.05, Pt.z - 0.05, { tile: 0.6, color: 0xffffff });
    R.slab('steel', Pt.x0, Pt.x1 + 0.02, Pt.h, Pt.h + 0.02, Pt.z + 0.07, Pt.z - 0.07, { color: STEEL });
    R.slab('gloss', G.x0 + 0.03, G.x1 - 0.03, 0.2, G.h, G.z + 0.02, G.z - 0.02, { color: TOMATO_DEEP });
    R.print('staff', 0.5, at((G.x0 + G.x1) / 2, 0.66, G.z - 0.022, Math.PI));
    striplight(R, -1.2, H, -4.2, 1.4, true);
  }

  // ---- The customers' side: a ledge along the wall, its stools ----
  {
    const L = P.ledge;
    R.slab('slats', L.x0, L.x1, L.h - 0.04, L.h, L.z0, L.z1, { tile: T.slats, color: WOOD, turn: true });
    R.slab('steel', L.x0 - 0.012, L.x0, L.h - 0.045, L.h + 0.004, L.z0, L.z1, { color: STEEL });
    for (let z = L.z0 - 0.4; z > L.z1; z -= 1.1) R.box('steel', L.x0 + 0.18, L.h - 0.2, z, 0.3, 0.3, 0.03, { rz: -0.6, color: DARK_STEEL });
    for (const z of P.stools) stool(R, P.stool.x, z, P.stool.seat, TOMATO);
    for (const z of [-2.85, -5.05]) { ['shakerChili', 'shakerOregano', 'shakerCheese'].forEach((name, i) => R.food(name, 2.86, L.h, z + 0.2 - i * 0.1)); R.food('napkins', 2.84, L.h, z - 0.25, -Math.PI / 2); }
    R.framed('photos', 2.9, W - 0.03, 2.05, -4.1, -Math.PI / 2, 0x241c16);
    pendant(R, 2.4, H, -2.9, 1.15, TOMATO, 0.19); pendant(R, 2.4, H, -5.0, 1.15, TOMATO, 0.19);
    for (const z of [-2.6, -5.6]) striplight(R, 1.2, H, z, 1.2, true);
  }

  // ---- The back room: three tables under checked cloths, the fridge, the bin ----
  {
    const t = P.table;
    for (const tb of P.tables) {
      table(R, tb.x, tb.z, t.size, t.size, t.h, 0xdcd4c2, 'satin', TOMATO_DEEP);
      R.print('checker', t.size - 0.02, at(tb.x, t.h + 0.002, tb.z, 0, -Math.PI / 2), 'print', t.size - 0.02);
      chair(R, tb.x, tb.z + t.chair, 0, -1, t.seat, TOMATO, 0x1a1817);
      chair(R, tb.x, tb.z - t.chair, 0, 1, t.seat, TOMATO, 0x1a1817);
      ['shakerChili', 'shakerCheese'].forEach((name, i) => R.food(name, tb.x + (tb.x > 0 ? 0.24 : -0.24), t.h + 0.004, tb.z - 0.05 + i * 0.1));
    }
    const Fr = P.fridge, zc = (Fr.z0 + Fr.z1) / 2;
    R.slab('gloss', Fr.x0, Fr.x1, 0.06, Fr.h, Fr.z0, Fr.z1, { color: 0x151515 });
    R.slab('paint', Fr.x0, Fr.x1 - 0.03, 0, 0.06, Fr.z0 - 0.03, Fr.z1 + 0.03, { color: 0x0c0b0a });
    R.print('fridge', Fr.z0 - Fr.z1 - 0.14, at(Fr.x1 + 0.004, 1.02, zc, Math.PI / 2), 'glow', 1.56);
    R.slab('glass', Fr.x1 + 0.012, Fr.x1 + 0.02, 0.22, 1.82, Fr.z0 - 0.05, Fr.z1 + 0.05);
    R.rod('steel', Fr.x1 + 0.05, 1.05, Fr.z1 + 0.1, 0.012, 0.5, 'y', { color: STEEL, segments: 6 });
    R.slab('gloss', Fr.x1, Fr.x1 + 0.012, 1.82, Fr.h, Fr.z0, Fr.z1, { color: TOMATO });
    const Tr = P.trash;
    R.rod('steel', Tr.x, Tr.h / 2, Tr.z, Tr.r, Tr.h, 'y', { color: STEEL, segments: 20 });
    R.push('gloss', new THREE.SphereGeometry(Tr.r * 1.02, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), at(Tr.x, Tr.h, Tr.z, 0, 0, 0, 1, 0.5, 1), { color: 0x1a1817 });
    // the staff door, the neon, posters
    const Sd = P.staffDoor;
    R.slab('gloss', Sd.x0, Sd.x1, 0, 2.1, P.back + 0.03, P.back, { color: TOMATO_DEEP });
    R.slab('paint', Sd.x0 - 0.06, Sd.x1 + 0.06, 0, 2.16, P.back + 0.012, P.back, { color: 0xf1e8d4 });
    R.print('staff', 0.5, at((Sd.x0 + Sd.x1) / 2, 1.6, P.back + 0.034));
    R.rod('steel', Sd.x1 - 0.12, 1.02, P.back + 0.06, 0.014, 0.12, 'z', { color: STEEL, segments: 8 });
    R.print('neonName', 2.3, at(-1.55, 2.32, P.back + 0.05), 'neon');
    R.framed('posterCall', 0.62, 2.05, 2.08, P.back + 0.03, 0, 0x241c16);
    R.framed('posterPart', 0.62, -W + 0.03, 2.08, -9.95, Math.PI / 2, 0x241c16);
    R.framed('posterSubprime', 0.62, -W + 0.03, 2.08, -11.3, Math.PI / 2, 0x241c16);
    R.framed('special', 0.62, W - 0.03, 2.0, -9.85, -Math.PI / 2, STEEL);
    pendant(R, 1.9, H, -9.85, 1.05, TOMATO, 0.21);
    pendant(R, -1.6, H, -10.6, 1.05, TOMATO, 0.21);
    R.prop('wall_clock', W - 0.004, 2.55, -7.35, -Math.PI / 2, 1.1);
    R.prop('extinguisher', -W + 0.2, 0, -12.1, Math.PI / 2, 0.9);
    R.prop('camera', W - 0.004, 3.0, -0.9, -Math.PI / 2);
  }

  return { front: front.finish(new THREE.Group(), { shadows: ['gloss', 'fabric', 'paint'] }), room: R.finish(new THREE.Group(), { shadows: ['plaster', 'tile', 'paint'] }) };
}

const LIGHTS = { bullion: BULLION_LIGHTS, tranche: TRANCHE_LIGHTS };

// ---- The branches in the city ----------------------------------------------------------------------------------------------

/**
 * @param {THREE.Scene} scene
 * @param {object[]} sites - every branch (eatery-plan.js), with `brand`
 * @param {object} shared - CALIBRE's room materials (calibreWorld.materials) and the kit's surface sizes
 */
function createEateryWorld(scene, sites, shared, surfaces = {}) {
  const T = { plaster: surfaces.plaster || 2, slats: surfaces.slats || 1.6, plate: surfaces.plate || 2, rubber: surfaces.rubber || 1, ceiling: surfaces.ceiling || 2.4 };
  const materials = createMaterials(shared), screen = createOrderScreen();
  materials.bullion.screen = screen.material;
  const templates = { bullion: buildBullion(materials.bullion, T), tranche: buildTranche(materials.tranche, T) };
  const group = new THREE.Group(); group.name = 'Eateries'; scene.add(group);

  // the doors: BULLION's two sliding leaves, TRANCHE's single leaf on its hinges
  const slider = new THREE.Group(), swing = new THREE.Group();
  {
    const B = new Room(materials.bullion, PRINTS.bullion, 'Bullion');
    B.box('glass', 0.5, 1.24, 0, 0.96, 2.4, 0.012);
    for (const y of [0.05, 2.43]) B.box('gloss', 0.5, y, 0, 1.0, 0.1, 0.045, { color: BLACK });
    for (const x of [0.025, 0.975]) B.box('gloss', x, 1.24, 0, 0.05, 2.46, 0.045, { color: BLACK });
    B.print('doorBand', 0.9, at(0.5, 1.05, 0.008), 'decal');
    B.finish(slider);
    const Tm = new Room(materials.tranche, PRINTS.tranche, 'Tranche'), w = PLANS.tranche.door.x1 - PLANS.tranche.door.x0;
    Tm.box('glass', -w / 2, 1.3, 0, w - 0.2, 1.9, 0.012);
    for (const y of [0.17, 2.3]) Tm.box('gloss', -w / 2, y, 0, w - 0.04, y < 1 ? 0.34 : 0.14, 0.05, { color: TOMATO_DEEP });
    for (const x of [-0.06, -w + 0.06]) Tm.box('gloss', x, 1.2, 0, 0.1, 2.34, 0.05, { color: TOMATO_DEEP });
    for (const z of [-0.05, 0.05]) Tm.rod('steel', -w + 0.2, 1.1, z, 0.014, 0.6, 'y', { color: STEEL });
    Tm.print('hours', 0.42, at(-w / 2, 1.5, 0.008), 'print');
    Tm.finish(swing);
  }

  const rooms = sites.map((site) => {
    const S = SPECS[site.brand], tpl = templates[site.brand];
    const root = new THREE.Group(); root.name = site.id;
    root.position.set(site.x, S.floor, site.z); root.rotation.y = Math.atan2(site.nx, site.nz);
    const front = tpl.front.clone(true), room = tpl.room.clone(true);
    root.add(front, room);
    let doors;
    if (site.brand === 'bullion') {
      doors = [-1, 1].map((side) => {
        const holder = new THREE.Group(); holder.position.set(0, 0, -0.03);
        const leaf = slider.clone(true); if (side < 0) leaf.rotation.y = Math.PI;
        holder.add(leaf); front.add(holder); return { holder, side };
      });
    } else {
      const pivot = new THREE.Group(); pivot.position.set(PLANS.tranche.door.x1 - 0.02, 0, 0.0);
      pivot.add(swing.clone(true)); front.add(pivot);
      doors = [{ holder: pivot, side: 0 }];
    }
    group.add(root); root.updateMatrixWorld(true);
    return { site, brand: site.brand, root, front, room, doors, openness: 0 };
  });

  // What follows the nearest branch of each brand: its lamps, and the parts that move
  const live = {};
  for (const brand of ['bullion', 'tranche']) {
    const dynamic = new THREE.Group(); dynamic.name = `EateryLive ${brand}`; scene.add(dynamic);
    const lamps = LIGHTS[brand].map((spec) => {
      const light = spec.kind === 'spot' ? new THREE.SpotLight(spec.color, 0, spec.reach, spec.angle, 0.85, 1.6) : new THREE.PointLight(spec.color, 0, spec.reach, 1.7);
      light.position.set(spec.x, spec.y, spec.z);
      dynamic.add(light);
      if (spec.kind === 'spot') { light.target.position.set(spec.tx, spec.ty, spec.tz); dynamic.add(light.target); }
      return { light, spec };
    });
    const parts = {};
    const R = new Room(materials[brand], PRINTS[brand], brand === 'bullion' ? 'Bullion' : 'Tranche');
    if (brand === 'bullion') {
      // two fry baskets on their lifts
      const P = PLANS.bullion, I = P.island, Y = P.fryers;
      parts.baskets = [Y.x0 + 0.325, Y.x0 + 0.925].map((x) => {
        const holder = new THREE.Group(), B = new Room(materials.bullion, PRINTS.bullion, 'Bullion');
        if (!B.food('friesBasket', 0, 0, 0, Math.PI)) { B.box('steel', 0, 0.07, 0, 0.3, 0.14, 0.3, { color: DARK_STEEL }); B.rod('steel', 0, 0.2, 0.32, 0.01, 0.4, 'z', { color: DARK_STEEL, segments: 6 }); }
        B.finish(holder);
        holder.position.set(x, I.h + 0.34, I.z - 0.08); dynamic.add(holder);
        return holder;
      });
      // the gate, on its hinges
      const G = P.gate;
      parts.gate = new THREE.Group(); parts.gate.position.set(G.x1 - 0.02, 0, G.z); dynamic.add(parts.gate);
    } else {
      // the oven's two doors, hinged at the bottom; the fan
      const P = PLANS.tranche, O = P.oven;
      parts.ovenDoors = [1.18, 1.62].map((y) => {
        const holder = new THREE.Group(), B = new Room(materials.tranche, PRINTS.tranche, 'Tranche');
        B.box('steel', 0.012, 0.11, 0, 0.024, 0.22, O.z0 - O.z1 - 0.5, { color: 0x8d9194 });
        B.rod('steel', 0.06, 0.18, 0, 0.012, O.z0 - O.z1 - 0.9, 'z', { color: DARK_STEEL, segments: 8 });
        B.finish(holder);
        holder.position.set(O.x1 + 0.014, y - 0.11, (O.z0 + O.z1) / 2); dynamic.add(holder);
        return holder;
      });
      parts.fan = new THREE.Group();
      const B = new Room(materials.tranche, PRINTS.tranche, 'Tranche');
      B.rod('steel', 0, -0.14, 0, 0.02, 0.28, 'y', { color: DARK_STEEL, segments: 8 });
      B.push('steel', new THREE.CylinderGeometry(0.11, 0.09, 0.1, 14), at(0, -0.3, 0), { color: DARK_STEEL });
      for (let i = 0; i < 4; i++) B.box('slats', Math.cos(i * Math.PI / 2) * 0.42, -0.31, Math.sin(i * Math.PI / 2) * 0.42, 0.66, 0.012, 0.13, { ry: -i * Math.PI / 2, rx: 0.12, color: WALNUT });
      B.finish(parts.fan);
      parts.fan.position.set(0.8, P.ceiling, -9.9); dynamic.add(parts.fan);
    }
    R.finish(dynamic);
    dynamic.position.set(0, -500, 0); dynamic.visible = false; dynamic.updateMatrixWorld(true);
    live[brand] = { dynamic, lamps, parts, room: null, brightness: 0, distance: Infinity };
  }

  function attach(brand, room) {
    const L = live[brand];
    L.room = room;
    L.dynamic.visible = !!room;
    if (room) { L.dynamic.position.copy(room.root.position); L.dynamic.rotation.copy(room.root.rotation); }
    else L.dynamic.position.set(0, -500, 0);
    L.dynamic.updateMatrixWorld(true);
  }

  let elapsed = 0;
  /**
   * @param {THREE.Camera} camera
   * @param {{x, z}} player
   * @param {number} dt
   * @param {Array<{x, z}>} people - who else may open a door (the branch's customers)
   * @param {number} night - 0 day .. 1 night
   */
  function update(camera, player, dt, people = [], night = 0) {
    elapsed += dt; clock.value = elapsed;
    const nearest = { bullion: null, tranche: null }, best = { bullion: Infinity, tranche: Infinity };
    for (const room of rooms) {
      const site = room.site, d = Math.hypot(camera.position.x - site.x, camera.position.z - site.z);
      room.root.visible = d < 320;
      if (d < best[room.brand]) { best[room.brand] = d; nearest[room.brand] = room; }
      if (!room.root.visible) continue;
      room.room.visible = d < 130;
      if (d > 60) continue;
      // doors open for whoever stands at them
      const entry = SPECS[room.brand].entry, at = (x, z) => { const p = eateryLocal(site, x, z); return Math.abs(p.x - entry) < 1.5 && p.z > -2.6 && p.z < 2.6; };
      const target = at(player.x, player.z) || people.some((q) => at(q.x, q.z)) ? 1 : 0;
      if (Math.abs(target - room.openness) < 0.001) continue;
      const before = room.openness;
      room.openness += (target - room.openness) * (1 - Math.exp(-dt * (room.brand === 'bullion' ? 7 : 6)));
      if (target && before < 0.02) room.opened = true; // for the sound (eatery.js reads and clears it)
      for (const door of room.doors) {
        if (door.side) door.holder.position.x = door.side * room.openness * 0.97;
        else door.holder.rotation.y = -room.openness * 1.45;
        door.holder.updateMatrixWorld(true);
      }
    }
    for (const brand of ['bullion', 'tranche']) {
      const L = live[brand], near = nearest[brand] && best[brand] < 90 ? nearest[brand] : null;
      L.distance = best[brand];
      if (near !== L.room) attach(brand, near);
      L.brightness += ((near ? 1 : 0) - L.brightness) * (1 - Math.exp(-dt * 4));
      for (const { light, spec } of L.lamps) {
        const flicker = spec.fire ? 0.82 + 0.18 * Math.sin(elapsed * 9.1) * Math.sin(elapsed * 5.3 + 1.7) + 0.1 * Math.sin(elapsed * 23) : 1;
        light.intensity = spec.power * L.brightness * flicker * (spec.night ? Math.min(1, night * 2.2) : 1) * (spec.fire ? 1 + (L.fire || 0) * 1.6 : 1);
      }
      if (!near) continue;
      if (L.parts.fan) { L.parts.fan.rotation.y = elapsed * 2.1; L.parts.fan.updateMatrixWorld(true); }
    }
  }

  let exterior = [];
  const frustum = new THREE.Frustum(), view = new THREE.Matrix4(), box = new THREE.Box3(), corner = new THREE.Vector3(), hidden = [];
  const api = {
    group, rooms, live, materials, screen, update, occludedExterior: false,
    setExteriorRoots(roots) { exterior = roots; },
    roomOf(site) { return rooms.find((r) => r.site === site) || null; },
    // Inside a room and looking away from its front, the city is not drawn
    render(camera, draw) {
      let enclosed = null;
      for (const room of rooms) {
        if (!room.root.visible) continue;
        const S = SPECS[room.brand], P = PLANS[room.brand], local = eateryLocal(room.site, camera.position.x, camera.position.z);
        if (Math.abs(local.x) < P.half - 0.08 && local.z < -0.55 && local.z > P.back + 0.1 && camera.position.y > 0.35 && camera.position.y < S.floor + P.ceiling - 0.1) { enclosed = room; break; }
      }
      api.occludedExterior = false;
      if (enclosed) {
        frustum.setFromProjectionMatrix(view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
        box.makeEmpty();
        const s = enclosed.site, half = SPECS[enclosed.brand].width / 2;
        for (const x of [-half, half]) for (const y of [0, 4]) box.expandByPoint(corner.set(s.x + s.nz * x + s.nx * 0.25, y, s.z - s.nx * x + s.nz * 0.25));
        api.occludedExterior = !frustum.intersectsBox(box);
      }
      if (api.occludedExterior) for (const root of exterior) if (root.visible) { hidden.push(root); root.visible = false; }
      try { return draw(); } finally { for (const root of hidden) root.visible = true; hidden.length = 0; }
    }
  };
  return api;
}

export { createEateryWorld, LIGHTS, Room };
