import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as Weapons from './weapon-models.js';
import { ground } from './ground-assets.js';
import { KIT } from './calibre-kit.js';
import { CALIBRE, PLAN, calibreLocal } from './calibre-plan.js';
import { Builder, createMaterials, at } from './calibre-build.js';
import { PAPER } from './calibre-range.js';

// A branch of CALIBRE, drawn once and shared by the 48 addresses: the shop on the street, the range behind it
// (the plan is PLAN in calibre-plan.js). Everything static is merged into one mesh per material; what moves or
// shines (doors, lamps, the weapon shown on the counter) belongs to the branch nearest to the camera.

const H = PLAN.ceiling, W = PLAN.half;
const GREEN = 0x2a4034, GREEN_DARK = 0x1b2a23, CHARCOAL = 0x202322, BRASS = 0xb08a45, STEEL = 0x3a3d3e, ALU = 0xa4a6a2;
const WOOD = 0x8a6a50, WALNUT = 0x8a6a50, CONCRETE = 0x9a9b95, CARD = 0xb39a70, OLIVE = 0x4d553b, COYOTE = 0x8b7453, BLACK = 0x191a1a;

// The lamps of a branch, in its local frame (y above the floor). `night`: on after dark only (the street side)
const LIGHTS = [
  // over the counter, three enamel pendants
  { kind: 'point', x: -3.0, y: 2.3, z: -6.75, color: 0xffc78a, power: 15, reach: 7.5 },
  { kind: 'point', x: -1.0, y: 2.3, z: -6.75, color: 0xffc78a, power: 15, reach: 7.5 },
  { kind: 'point', x: 1.0, y: 2.3, z: -6.75, color: 0xffc78a, power: 15, reach: 7.5 },
  // the gun wall, washed from a track
  { kind: 'spot', x: -2.3, y: 3.25, z: -8.25, tx: -2.3, ty: 1.8, tz: -10.2, color: 0xfff0d8, power: 70, reach: 7, angle: 0.95 },
  { kind: 'spot', x: 0.6, y: 3.25, z: -8.25, tx: 0.6, ty: 1.8, tz: -10.2, color: 0xfff0d8, power: 70, reach: 7, angle: 0.95 },
  // the neon's own glow on the wood
  { kind: 'point', x: -0.85, y: 2.95, z: -9.75, color: 0xff8c3c, power: 7, reach: 5 },
  // the glass cases and the aisles
  { kind: 'spot', x: -2.15, y: 3.3, z: -3.7, tx: -2.15, ty: 0.6, tz: -3.7, color: 0xffe2b8, power: 60, reach: 6, angle: 0.8 },
  { kind: 'spot', x: 2.15, y: 3.3, z: -3.7, tx: 2.15, ty: 0.6, tz: -3.7, color: 0xffe2b8, power: 60, reach: 6, angle: 0.8 },
  { kind: 'point', x: -2.6, y: 2.75, z: -2.2, color: 0xffd9a8, power: 9, reach: 6.5 },
  { kind: 'point', x: 2.6, y: 2.75, z: -2.2, color: 0xffd9a8, power: 9, reach: 6.5 },
  { kind: 'point', x: 0, y: 2.9, z: -1.3, color: 0xffd9a8, power: 8, reach: 6 },
  // the passage to the range, under its lit sign
  { kind: 'point', x: 3.3, y: 2.35, z: -9.3, color: 0xffb070, power: 7, reach: 5 },
  // the range: a cold tube over the briefing area, the booths in half-light, the lanes bright
  { kind: 'point', x: 0, y: 3.0, z: -11.9, color: 0xdfe9ff, power: 16, reach: 8 },
  { kind: 'point', x: 0, y: 2.7, z: -13.9, color: 0xffcf9c, power: 6, reach: 6 },
  { kind: 'spot', x: 0, y: 3.2, z: -16.2, tx: 0, ty: 1.2, tz: -21.5, color: 0xeaf1ff, power: 150, reach: 13, angle: 1.15 },
  { kind: 'spot', x: 0, y: 3.2, z: -21.5, tx: 0, ty: 1.3, tz: -27, color: 0xeaf1ff, power: 150, reach: 12, angle: 1.15 },
  // the fascia's goosenecks, on the sign and the pavement
  { kind: 'spot', x: -2.2, y: 3.75, z: 1.05, tx: -2.2, ty: 0, tz: 0.9, color: 0xffd3a0, power: 55, reach: 9, angle: 1.0, night: true },
  { kind: 'spot', x: 2.2, y: 3.75, z: 1.05, tx: 2.2, ty: 0, tz: 0.9, color: 0xffd3a0, power: 55, reach: 9, angle: 1.0, night: true }
];

// ---- Pieces --------------------------------------------------------------------------------------------------------

// An enamel pendant on its cord; the bulb hangs at y - drop
function pendant(B, x, y, z, drop, color = GREEN_DARK) {
  B.rod('paint', x, y - drop / 2 + 0.05, z, 0.006, drop - 0.1, 'y', { color: BLACK, segments: 5 });
  B.rod('metal', x, y - 0.02, z, 0.045, 0.04, 'y', { color: BRASS });
  const profile = [[0.035, 0.2], [0.07, 0.16], [0.2, 0.02], [0.215, 0], [0.2, 0], [0.19, 0.015], [0.06, 0.15], [0.03, 0.19]].map(([r, h]) => new THREE.Vector2(r, h));
  B.push('satin', new THREE.LatheGeometry(profile, 22), at(x, y - drop - 0.02, z), { color });
  B.push('bulb', new THREE.SphereGeometry(0.05, 12, 8), at(x, y - drop + 0.06, z));
}

// A ceiling tube fitting: `length` along x (or z when turned)
function striplight(B, x, y, z, length, turned = false) {
  const ry = turned ? Math.PI / 2 : 0;
  B.box('paint', x, y - 0.03, z, length, 0.06, 0.2, { ry, color: 0xd9dbd6 });
  for (const s of [-0.055, 0.055]) {
    const g = new THREE.CylinderGeometry(0.016, 0.016, length - 0.12, 8);
    B.push('tube', g, at(x + (turned ? s : 0), y - 0.075, z + (turned ? 0 : s), ry, 0, Math.PI / 2));
  }
}

// A plate carrier on its hanger, facing +z before the turn
function vest(B, x, y, z, ry, color) {
  const M = at(x, y, z, ry), part = (local) => M.clone().multiply(local);
  const s = new THREE.Shape();
  s.moveTo(-0.2, -0.27); s.lineTo(0.2, -0.27); s.lineTo(0.225, -0.03); s.quadraticCurveTo(0.17, 0.02, 0.18, 0.13);
  s.lineTo(0.15, 0.25); s.lineTo(0.075, 0.27); s.quadraticCurveTo(0, 0.13, -0.075, 0.27); s.lineTo(-0.15, 0.25);
  s.lineTo(-0.18, 0.13); s.quadraticCurveTo(-0.17, 0.02, -0.225, -0.03); s.closePath();
  const body = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 8 });
  B.push('fabric', body, part(at(0, 0, 0)), { color });
  const dark = new THREE.Color(color).multiplyScalar(0.72).getHex();
  for (let i = 0; i < 4; i++) B.push('fabric', new THREE.BoxGeometry(0.38, 0.022, 0.008), part(at(0, 0.1 - i * 0.045, 0.066)), { color: dark });
  for (const px of [-0.125, 0, 0.125]) {
    B.push('fabric', new THREE.BoxGeometry(0.105, 0.16, 0.05), part(at(px, -0.165, 0.085)), { color });
    B.push('fabric', new THREE.BoxGeometry(0.109, 0.05, 0.054), part(at(px, -0.105, 0.087)), { color: dark });
  }
  B.push('paint', new THREE.BoxGeometry(0.09, 0.04, 0.006), part(at(-0.09, 0.165, 0.066)), { color: 0xcfc6a8 });
  // hanger: a bar through the shoulders and a hook to the rail behind
  B.push('metal', new THREE.CylinderGeometry(0.006, 0.006, 0.42, 6), part(at(0, 0.265, 0.025, 0, 0, Math.PI / 2)), { color: ALU });
  B.push('metal', new THREE.CylinderGeometry(0.006, 0.006, 0.09, 6), part(at(0, 0.3, -0.01, 0, Math.PI / 4)), { color: ALU });
}

function helmet(B, x, y, z, ry, color) {
  const M = at(x, y, z, ry);
  B.push('fabric', new THREE.SphereGeometry(0.125, 18, 9, 0, Math.PI * 2, 0, Math.PI * 0.56), M.clone().multiply(at(0, 0.02, 0, 0, 0, 0, 1, 0.94, 1.2)), { color });
  B.push('fabric', new THREE.CylinderGeometry(0.128, 0.13, 0.018, 18, 1, true), M.clone().multiply(at(0, 0.008, 0, 0, 0, 0, 1, 1, 1.2)), { color: new THREE.Color(color).multiplyScalar(0.6).getHex() });
}

// Ear defenders, lying down
function muffs(B, x, y, z, ry, color = 0x8f2a1c) {
  const M = at(x, y, z, ry);
  for (const s of [-1, 1]) B.push('paint', new THREE.CylinderGeometry(0.048, 0.052, 0.045, 12), M.clone().multiply(at(s * 0.075, 0.045, 0, 0, 0, Math.PI / 2)), { color });
  B.push('paint', new THREE.TorusGeometry(0.085, 0.009, 6, 14, Math.PI), M.clone().multiply(at(0, 0.05, 0, 0, -0.5)), { color: BLACK });
}

// A row of ammunition boxes with their printed fronts, along z, facing +x (the left wall's shelves)
function ammoRow(B, x, y, z0, z1, label, tint, stack = 2) {
  const w = 0.19, h = 0.105, d = 0.27;
  let k = 0;
  for (let z = z0 - w / 2 - 0.01; z > z1 + w / 2; z -= w + 0.012, k++) {
    const layers = stack - ((k * 7 + Math.round(y * 10)) % 5 === 0 ? 1 : 0);
    for (let s = 0; s < layers; s++) {
      B.box('paint', x, y + h / 2 + s * h, z, d, h - 0.004, w, { color: tint });
      B.print(label, w - 0.012, at(x + d / 2 + 0.001, y + h / 2 + s * h, z, Math.PI / 2), 'print', h - 0.012);
    }
  }
}

// A glass floor case on a wooden base, `w` across (x), `d` along z
function glassCase(B, cx, cz, w, d, h, T) {
  const base = 0.5, x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz + d / 2, z1 = cz - d / 2;
  B.slab('plate', x0 + 0.03, x1 - 0.03, 0, 0.09, z0 - 0.03, z1 + 0.03, { tile: T.plate, color: 0x8a8c88 });
  B.slab('slats', x0, x1, 0.09, base, z0, z1, { tile: T.slats, color: WALNUT });
  B.slab('fabric', x0 + 0.02, x1 - 0.02, base, base + 0.012, z0 - 0.02, z1 + 0.02, { color: 0x1c3327 });
  for (const [ax, az] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) B.box('metal', ax, (base + h) / 2, az, 0.022, h - base, 0.022, { color: BRASS });
  for (const z of [z0, z1]) B.box('metal', cx, h, z, w, 0.02, 0.022, { color: BRASS });
  for (const x of [x0, x1]) B.box('metal', x, h, cz, 0.022, 0.02, d, { color: BRASS });
  for (const z of [z0, z1]) B.box('glass', cx, (base + h) / 2, z, w - 0.02, h - base - 0.01, 0.008);
  for (const x of [x0, x1]) B.box('glass', x, (base + h) / 2, cz, 0.008, h - base - 0.01, d - 0.02);
  B.box('glass', cx, h - 0.004, cz, w - 0.02, 0.008, d - 0.02);
  for (const x of [x0 + 0.03, x1 - 0.03]) B.box('led', x, h - 0.03, cz, 0.012, 0.012, d - 0.1);
  return base + 0.012;
}

// ---- The branch ----------------------------------------------------------------------------------------------------

function buildBranch(materials) {
  const B = new Builder(materials);
  const T = { // real size of each photographed surface, metres per repeat
    floor: ground.trowel?.metres || 2.5, plaster: KIT.surfaces.plaster?.metres || 2, slats: KIT.surfaces.slats?.metres || 1.6,
    foam: KIT.surfaces.foam?.metres || 1.2, plate: KIT.surfaces.plate?.metres || 2, rubber: KIT.surfaces.rubber?.metres || 1,
    ceiling: KIT.surfaces.ceiling?.metres || 2.4
  };
  const depth = CALIBRE.depth, wall = CALIBRE.width / 2, P = PLAN, pz = P.partition.z, door = P.partition.door;
  const SHOP = pz + 0.1, RANGE = pz - 0.1; // the partition's two faces

  // ---- Shell ----
  B.slab('floor', -wall, wall, -0.1, 0, 0.02, -depth, { tile: T.floor, color: 0xb9b8b0 });
  B.slab('ceiling', -wall, wall, H, H + 0.12, 0, -depth, { tile: T.ceiling, color: 0x2b2d2c });
  for (const s of [-1, 1]) {
    B.slab('plaster', s * W, s * wall, 0, H, 0, SHOP, { tile: T.plaster, color: GREEN });
    B.slab('plaster', s * W, s * wall, 0, H, SHOP, -depth, { tile: T.plaster, color: CONCRETE });
    // wainscot of the shop: planks, a cap rail, a dark skirting
    B.slab('slats', s * (W - 0.018), s * W, 0.1, 1.02, -0.2, SHOP, { tile: T.slats, color: WALNUT, turn: true });
    B.slab('satin', s * (W - 0.035), s * W, 1.02, 1.07, -0.2, SHOP, { color: 0x3b2a1c });
    B.slab('paint', s * (W - 0.025), s * W, 0, 0.1, -0.2, SHOP, { color: 0x121413 });
    // skirting of the range
    B.slab('paint', s * (W - 0.02), s * W, 0, 0.12, RANGE, P.back, { color: 0x151716 });
  }
  // partition: concrete towards the range; on the shop side planks behind the counter, green paint by the door
  B.slab('plaster', -wall, door.x0, 0, H, SHOP - 0.02, RANGE, { tile: T.plaster, color: CONCRETE });
  B.slab('plaster', door.x1, wall, 0, H, SHOP - 0.02, RANGE, { tile: T.plaster, color: CONCRETE });
  B.slab('plaster', door.x0, door.x1, door.h, H, SHOP - 0.02, RANGE, { tile: T.plaster, color: CONCRETE });
  B.slab('slats', -W, P.gate.x, 0, H, SHOP, SHOP - 0.02, { tile: T.slats, color: WOOD, turn: true });
  B.slab('plaster', P.gate.x, door.x0, 0, H, SHOP, SHOP - 0.02, { tile: T.plaster, color: GREEN });
  B.slab('plaster', door.x1, W, 0, H, SHOP, SHOP - 0.02, { tile: T.plaster, color: GREEN });
  B.slab('plaster', door.x0, door.x1, door.h, H, SHOP, SHOP - 0.02, { tile: T.plaster, color: GREEN });
  // its steel door frame, the leaf standing open in the range
  for (const x of [door.x0 + 0.025, door.x1 - 0.025]) B.slab('satin', x - 0.035, x + 0.035, 0, door.h, SHOP + 0.015, RANGE - 0.015, { color: 0x15201b });
  B.slab('satin', door.x0, door.x1, door.h - 0.06, door.h + 0.01, SHOP + 0.015, RANGE - 0.015, { color: 0x15201b });
  B.box('satin', door.x1 - 0.02, door.h / 2 - 0.02, RANGE - 0.53, 0.05, door.h - 0.08, 1.02, { color: 0x1f3229 });
  B.box('glass', door.x1 - 0.02, 1.55, RANGE - 0.53, 0.056, 0.5, 0.5);
  B.box('metal', door.x1 - 0.06, 1.0, RANGE - 0.93, 0.03, 0.03, 0.14, { color: BRASS });
  // the range's end wall
  B.slab('plate', -wall, wall, 0, H, P.back, -depth, { tile: T.plate, color: 0x6c6f6c });

  // ---- The front on the street ----
  B.slab('paint', -wall, wall, 2.8, H + 0.12, -0.06, 0.3, { color: GREEN_DARK }); // fascia
  B.slab('paint', -wall - 0.02, wall + 0.02, H + 0.04, H + 0.12, -0.06, 0.38, { color: 0x101a15 });
  B.slab('metal', -wall, wall, 2.8, 2.83, 0.3, 0.325, { color: BRASS });
  B.print('fascia', 8.5, at(0, 3.2, 0.304));
  for (const s of [-1, 1]) {
    B.slab('paint', s * W, s * wall, 0, 2.8, -0.06, 0.3, { color: GREEN_DARK }); // pilasters
    B.slab('paint', s * (W - 0.02), s * (wall + 0.02), 0, 0.22, -0.06, 0.33, { color: 0x101a15 });
    B.slab('paint', s * 0.94, s * 1.07, 0, 2.8, -0.08, 0.2, { color: GREEN_DARK }); // door jambs
    B.slab('paint', s * 1.07, s * W, 0, 0.5, -0.08, 0.2, { color: GREEN_DARK }); // stall riser
    B.slab('satin', s * 1.25, s * (W - 0.18), 0.09, 0.42, 0.2, 0.215, { color: 0x14211b });
    B.slab('metal', s * 1.07, s * W, 0.5, 0.535, -0.1, 0.24, { color: BRASS }); // sill
    B.slab('paint', s * 1.07, s * W, 2.72, 2.8, -0.06, 0.12, { color: GREEN_DARK }); // head
    B.slab('paint', s * 2.6, s * 2.66, 0.535, 2.72, 0.0, 0.07, { color: GREEN_DARK }); // mullion
    B.slab('glass', s * 1.07, s * W, 0.535, 2.72, 0.025, 0.04);
  }
  B.slab('paint', -0.94, 0.94, 2.62, 2.8, -0.06, 0.16, { color: GREEN_DARK }); // transom
  B.slab('metal', -0.94, 0.94, -0.012, 0.004, -0.14, 0.26, { color: BRASS }); // threshold
  // goosenecks over the sign
  for (const x of [-2.2, 2.2]) {
    B.rod('metal', x, H + 0.2, 0.42, 0.014, 0.44, 'z', { color: BLACK });
    B.rod('metal', x, H + 0.26, 0.2, 0.014, 0.16, 'y', { color: BLACK });
    B.push('satin', new THREE.CylinderGeometry(0.05, 0.17, 0.16, 16, 1, true), at(x, H + 0.17, 0.72, 0, -0.45), { color: 0x0f1512 });
    B.push('bulb', new THREE.SphereGeometry(0.045, 10, 6), at(x, H + 0.13, 0.75));
  }

  // ---- Inside the front: the window displays ----
  B.slab('rubber', -0.86, 0.86, 0, 0.012, -0.2, -1.6, { tile: T.rubber, color: 0x8a8d8a });
  for (const k of P.windows) {
    const s = Math.sign(k.x), x0 = k.x - k.w / 2, x1 = k.x + k.w / 2, z0 = k.z + k.d / 2, z1 = k.z - k.d / 2;
    B.slab('paint', x0, x1, 0, k.h - 0.03, z0, z1, { color: GREEN_DARK });
    B.slab('slats', x0 - 0.01, x1 + 0.01, k.h - 0.03, k.h, z0 + 0.01, z1 - 0.02, { tile: T.slats, color: WALNUT });
    // a card on an easel towards the street
    const px = s * 3.6;
    B.box('satin', px, k.h + 0.47, z1 + 0.1, 0.66, 0.94, 0.02, { rx: -0.12, color: 0x15120f });
    B.print(s < 0 ? 'posterCalm' : 'posterYield', 0.6, at(px, k.h + 0.47, z1 + 0.112, 0, -0.12));
    // a long gun on brass rests
    const gx = s * 1.9, gz = k.z + 0.02;
    for (const o of [-0.26, 0.24]) {
      B.rod('metal', gx + o, k.h + 0.1, gz, 0.008, 0.2, 'y', { color: BRASS });
      B.box('metal', gx + o, k.h + 0.2, gz, 0.02, 0.012, 0.07, { color: BRASS });
    }
    B.gun(s < 0 ? 'rifle' : 'shotgun', at(gx, k.h + (s < 0 ? 0.3 : 0.255), gz, s * Math.PI / 2, 0.05 * s));
    // stock: ammunition cans in a pyramid (a crate and cartons on the other side)
    if (s < 0) {
      [[-2.95, 0], [-2.66, 0], [-2.37, 0], [-2.08, 0], [-2.8, 0.18], [-2.51, 0.18], [-2.22, 0.18], [-2.66, 0.36], [-2.37, 0.36], [-2.51, 0.54]].forEach(([ax, ay], i) => {
        if (!B.prop('ammo_box', ax, k.h + ay, k.z - 0.1, (i % 3 - 1) * 0.05)) B.box('paint', ax, k.h + ay + 0.09, k.z - 0.1, 0.26, 0.18, 0.09, { color: OLIVE });
      });
      B.prop('crate', -1.75, k.h, k.z - 0.2, 0.06, 0.8);
    } else {
      vest(B, 2.75, k.h + 0.62, k.z - 0.12, 0.25, OLIVE);
      B.rod('metal', 2.75, k.h + 0.2, k.z - 0.14, 0.012, 0.4, 'y', { color: BLACK });
      B.rod('metal', 2.75, k.h + 0.008, k.z - 0.14, 0.13, 0.016, 'y', { color: BLACK, segments: 16 });
      helmet(B, 3.15, k.h, k.z + 0.1, -0.5, COYOTE);
      B.prop('crate_military', 1.75, k.h, k.z - 0.2, -0.05, 0.62);
    }
  }
  B.print('open', 1.05, at(-2.65, 2.2, -0.1), 'neon');
  B.box('satin', 0, 2.71, -0.075, 0.56, 0.2, 0.02, { color: 0x101412 });
  B.print('exit', 0.52, at(0, 2.71, -0.087, Math.PI), 'glow');
  B.print('cameras', 0.42, at(3.85, 0.84, 0.012));
  B.print('hours', 0.5, at(1.45, 1.42, 0.012));

  // ---- Left wall: ammunition ----
  {
    const S = P.shelves, x0 = -W + 0.02, x1 = S.x + S.depth / 2, mid = (x0 + x1) / 2, levels = [0.14, 0.62, 1.1, 1.58, 2.06];
    const bays = 3, bay = (S.z0 - S.z1) / bays;
    for (let i = 0; i <= bays; i++) for (const x of [x0 + 0.02, x1 - 0.02]) B.box('metal', x, S.h / 2, S.z0 - i * bay, 0.035, S.h, 0.035, { color: STEEL });
    for (const y of levels) B.slab('metal', x0, x1, y - 0.03, y, S.z0, S.z1, { color: 0x55595a });
    B.slab('paint', x0 - 0.01, x0 + 0.005, 0.1, S.h, S.z0, S.z1, { color: 0x15201b });
    const rows = [['ammo9', 0xb9a27a], ['ammo45', 0xc2ad7c], ['ammo12', 0xa9a079], ['ammo556', 0xb5a47f]];
    for (let i = 0; i < bays; i++) {
      const z0 = S.z0 - i * bay - 0.05, z1 = S.z0 - (i + 1) * bay + 0.05;
      ammoRow(B, mid + 0.05, levels[3], z0, z1, rows[i % 4][0], rows[i % 4][1], 2);
      ammoRow(B, mid + 0.05, levels[2], z0, z1, rows[(i + 1) % 4][0], rows[(i + 1) % 4][1], 3);
      ammoRow(B, mid + 0.05, levels[1], z0, z1, rows[(i + 2) % 4][0], rows[(i + 2) % 4][1], 3);
      // cans at the bottom, cartons on top
      for (let k = 0; k < 5; k++) {
        const z = z0 - 0.2 - k * 0.325;
        for (const [dx, dy] of [[0.12, 0], [-0.02, 0], [0.05, 0.18]]) {
          if (dy && (k + i) % 3 === 0) continue;
          if (!B.prop('ammo_box', mid + dx, levels[0] + dy, z, Math.PI / 2)) B.box('paint', mid + dx, levels[0] + dy + 0.09, z, 0.09, 0.18, 0.26, { color: OLIVE });
        }
        if (k % 2 === i % 2 && !B.prop('cardboard_box', mid - 0.03, levels[4], z - 0.1, Math.PI / 2 + (k - 2) * 0.06, 0.8)) B.box('paint', mid, levels[4] + 0.13, z - 0.1, 0.4, 0.26, 0.36, { color: CARD });
      }
    }
    B.print('stripMunitions', 4.1, at(-W + 0.004, 2.74, (S.z0 + S.z1) / 2, Math.PI / 2));
  }

  // ---- Right wall: protection ----
  {
    const R = P.racks, xw = W - 0.02, zc = (R.z0 + R.z1) / 2, len = R.z0 - R.z1;
    B.slab('paint', xw - 0.02, xw, 0.3, 2.5, R.z0, R.z1, { color: CHARCOAL });
    for (let y = 0.5; y < 2.5; y += 0.25) B.slab('metal', xw - 0.032, xw - 0.02, y, y + 0.014, R.z0, R.z1, { color: ALU });
    // the low shelf: kit bags; the high one: helmets
    B.slab('satin', R.x - R.depth / 2, xw - 0.02, 0.4, 0.44, R.z0, R.z1, { color: 0x2a1d13 });
    B.slab('paint', R.x - R.depth / 2 + 0.03, xw - 0.02, 0, 0.4, R.z0 - 0.02, R.z1 + 0.02, { color: 0x15201b });
    B.slab('satin', xw - 0.34, xw - 0.02, 2.22, 2.25, R.z0, R.z1, { color: 0x2a1d13 });
    const tones = [BLACK, OLIVE, COYOTE, 0x2a2f33];
    for (let i = 0; i < 5; i++) {
      const z = R.z0 - 0.5 - i * (len - 1) / 4;
      B.box('fabric', R.x, 0.6, z, 0.3, 0.3, 0.58, { color: tones[(i + 1) % 4] });
      B.box('fabric', R.x - 0.155, 0.62, z, 0.012, 0.16, 0.34, { color: tones[i % 4] });
      B.rod('fabric', R.x, 0.77, z, 0.012, 0.3, 'z', { color: BLACK, segments: 6 });
      helmet(B, xw - 0.19, 2.25, z, -Math.PI / 2 - 0.2 + i * 0.1, tones[i % 4]);
    }
    for (let i = 0; i < 4; i++) vest(B, xw - 0.11, 1.62, R.z0 - 0.75 - i * 1.02, -Math.PI / 2, tones[i]);
    // hardware at the far end
    for (let i = 0; i < 4; i++) {
      const gz = R.z0 - 0.5 - (i + 0.5) * (len - 1) / 4;
      B.prop(i % 2 ? 'hatchet' : 'binoculars', R.x - 0.09, 0.44, gz + 0.02, -Math.PI / 2 + 0.3 * (i - 1.5));
    }
    B.print('stripProtection', 3.9, at(W - 0.004, 2.74, zc, -Math.PI / 2));
  }

  // ---- The two glass cases ----
  {
    const [left, right] = P.cases;
    const fl = glassCase(B, left.x, left.z, left.w, left.d, left.h, T);
    // accessories: suppressors on cradles, magazines, sights
    for (let i = 0; i < 5; i++) {
      const z = left.z + 0.72 - i * 0.36;
      B.rod('metal', left.x - 0.22, fl + 0.045, z, 0.019, 0.19, 'x', { color: 0x1e2021 });
      B.box('satin', left.x - 0.22, fl + 0.012, z, 0.07, 0.024, 0.05, { color: 0x15120f });
      B.box('metal', left.x + 0.08, fl + 0.016, z + 0.03, 0.03, 0.03, 0.12, { color: 0x232526, ry: 0.5 });
      B.box('metal', left.x + 0.3, fl + 0.03, z, 0.05, 0.05, 0.075, { color: 0x1c1d1e });
      B.box('glass', left.x + 0.3, fl + 0.04, z, 0.035, 0.04, 0.08);
      B.print('tag', 0.075, at(left.x - 0.22, fl + 0.002, z - 0.1, 0, -Math.PI / 2));
    }
    const fr = glassCase(B, right.x, right.z, right.w, right.d, right.h, T);
    for (let i = 0; i < 5; i++) {
      const z = right.z + 0.72 - i * 0.36;
      B.box('rubber', right.x, fl + 0.004, z, 0.72, 0.008, 0.26, { tile: T.rubber, color: 0x777a78 });
      B.gun('pistol', at(right.x - 0.12, fr + 0.026, z + 0.02, Math.PI / 2 + 0.25, 0, Math.PI / 2));
      B.box('metal', right.x + 0.24, fr + 0.014, z - 0.02, 0.03, 0.028, 0.11, { color: 0x232526, ry: -0.4 });
      B.print('tag', 0.075, at(right.x + 0.28, fr + 0.01, z + 0.08, 0, -Math.PI / 2));
    }
  }

  // ---- The counter ----
  {
    const C = P.counter, zf = C.z + C.depth / 2, zb = C.z - C.depth / 2, glassEnd = 0.75, top = C.h;
    B.slab('plate', C.x0, C.x1, 0, 0.1, zf - 0.035, zb, { tile: T.plate, color: 0x8a8c88 });
    B.slab('slats', C.x0, C.x1, 0.1, 0.56, zf, zb, { tile: T.slats, color: WALNUT });
    B.slab('metal', C.x0, C.x1, 0.56, 0.575, zf + 0.012, zb, { color: BRASS });
    // the display: glass to the customer and on top, a service ledge to the clerk
    B.slab('slats', C.x0, glassEnd, 0.575, top - 0.02, zb + 0.24, zb, { tile: T.slats, color: WALNUT });
    B.slab('satin', C.x0, glassEnd, top - 0.02, top, zb + 0.26, zb - 0.01, { color: 0x2a1d13 });
    B.slab('fabric', C.x0 + 0.02, glassEnd, 0.575, 0.586, zf - 0.02, zb + 0.24, { color: 0x1c3327 });
    B.slab('glass', C.x0 + 0.02, glassEnd, 0.585, top - 0.03, zf - 0.006, zf - 0.016);
    B.slab('glass', C.x0 + 0.02, glassEnd, top - 0.012, top, zf, zb + 0.24);
    for (const x of [C.x0 + 0.03, -2.55, -0.9, glassEnd]) B.box('metal', x, (0.575 + top) / 2, zf - 0.011, 0.024, top - 0.575, 0.024, { color: BRASS });
    B.slab('metal', C.x0, glassEnd, top - 0.03, top - 0.008, zf + 0.002, zf - 0.022, { color: BRASS });
    B.slab('led', C.x0 + 0.06, glassEnd - 0.04, top - 0.05, top - 0.038, zf - 0.03, zf - 0.045);
    // under the glass: handguns, magazines and boxes
    const shown = [-3.75, -3.1, -2.1, -1.45, -0.35, 0.3];
    shown.forEach((x, i) => {
      B.box('rubber', x, 0.59, C.z + 0.07, 0.46, 0.008, 0.3, { tile: T.rubber, color: 0x7a7d7b });
      B.gun('pistol', at(x - 0.04, 0.612, C.z + 0.08, Math.PI / 2 + 0.2 * (i % 2 ? 1 : -1), 0, Math.PI / 2));
      B.box('metal', x + 0.17, 0.602, C.z + 0.0, 0.028, 0.026, 0.1, { color: 0x232526, ry: 0.6 });
      B.print('tag', 0.07, at(x + 0.16, 0.596, C.z + 0.19, 0, -Math.PI / 2));
    });
    for (const [x, label, tint] of [[-2.78, 'ammo9', 0xb9a27a], [-1.12, 'ammo45', 0xc2ad7c]]) {
      B.box('paint', x, 0.64, C.z - 0.02, 0.19, 0.105, 0.1, { color: tint });
      B.print(label, 0.178, at(x, 0.64, C.z + 0.031), 'print', 0.094);
    }
    // the wooden end: the till, the mat where a weapon is presented
    B.slab('slats', glassEnd, C.x1, 0.575, top - 0.03, zf, zb, { tile: T.slats, color: WALNUT });
    B.slab('satin', glassEnd - 0.01, C.x1 + 0.02, top - 0.03, top, zf + 0.02, zb - 0.01, { color: 0x2a1d13 });
    if (!B.prop('cash_register', 1.62, top, C.z - 0.06, Math.PI, 0.82)) {
      B.box('satin', 1.72, top + 0.09, C.z - 0.1, 0.38, 0.18, 0.36, { color: 0x1b1d1c });
      B.box('satin', 1.72, top + 0.3, C.z - 0.2, 0.34, 0.26, 0.04, { rx: -0.25, color: 0x1b1d1c });
    }
    B.print('mat', 0.74, at(-1.72, top + 0.003, C.z + 0.04, 0, -Math.PI / 2));
    B.prop('clipboard', -3.2, top, C.z - 0.12, 0.4);
    B.prop('tape', 0.95, top, C.z + 0.2, 0.7);
  }
  // the staff gate at the counter's end
  {
    const G = P.gate;
    B.slab('slats', G.x - 0.05, G.x + 0.05, 0.05, G.h - 0.05, G.z0, G.z1 + 0.02, { tile: T.slats, color: WALNUT, turn: true });
    B.slab('satin', G.x - 0.065, G.x + 0.065, G.h - 0.05, G.h, G.z0 + 0.01, G.z1 + 0.02, { color: 0x2a1d13 });
    B.print('staff', 0.44, at(G.x + 0.052, 0.72, (G.z0 + G.z1) / 2, Math.PI / 2));
  }

  // ---- Behind the counter: the gun wall, the neon, the back counter and the gunsmith's bench ----
  {
    const zw = SHOP - 0.02; // the planks' face
    for (const y of [1.14, 1.64, 2.14]) B.slab('metal', -3.95, 2.1, y, y + 0.03, zw, zw + 0.02, { color: 0x2a2c2d });
    const kinds = ['rifle', 'shotgun', 'smg'];
    for (let row = 0; row < 3; row++) for (let i = 0; i < 5; i++) {
      const x = -3.25 + i * 1.2, y = 1.36 + row * 0.5, kind = kinds[(i + row * 2) % 3], flip = (i + row) % 2 ? -1 : 1;
      for (const o of [-0.2, 0.19]) B.rod('metal', x + o, y - (kind === 'smg' ? 0.03 : 0.045), zw + 0.06, 0.007, 0.12, 'z', { color: BRASS, segments: 6 });
      B.gun(kind, at(x, y, zw + 0.075, flip * Math.PI / 2));
      B.print('tag', 0.1, at(x + 0.42, y - 0.17, zw + 0.004));
    }
    B.print('neon', 2.7, at(-0.85, 3.02, zw + 0.045), 'neon');
    for (const x of [-1.9, 0.2]) B.rod('metal', x, 3.02, zw + 0.022, 0.006, 0.045, 'z', { color: ALU, segments: 5 });
    // the back counter
    B.slab('slats', -3.3, 2.0, 0.08, 0.9, zw, zw + 0.5, { tile: T.slats, color: WALNUT });
    B.slab('satin', -3.32, 2.02, 0.9, 0.93, zw, zw + 0.53, { color: 0x2a1d13 });
    for (let i = 0; i < 6; i++) {
      const x = -3.0 + i * 0.86;
      if (i % 3 === 1) { if (!B.prop('toolbox', x, 0.93, zw + 0.27, 0.1)) B.box('paint', x, 1.03, zw + 0.27, 0.42, 0.2, 0.22, { color: 0x7a1f18 }); }
      else {
        for (const [dx, dy] of [[-0.14, 0], [0.14, 0], [0, 0.18]]) if (!B.prop('ammo_box', x + dx, 0.93 + dy, zw + 0.24, (i % 2) * 0.12)) B.box('paint', x + dx, 1.02 + dy, zw + 0.24, 0.26, 0.18, 0.09, { color: OLIVE });
        B.prop(i % 2 ? 'spray' : 'tin', x + 0.36, 0.93, zw + 0.3, i);
      }
    }
    // the bench against the left wall
    const bx0 = -W + 0.03, bx1 = -3.5, bz0 = -8.0, bz1 = -9.55;
    B.slab('satin', bx0, bx1, 0.86, 0.91, bz0, bz1, { color: 0x4a3524 });
    for (const z of [bz0 - 0.06, bz1 + 0.06]) for (const x of [bx0 + 0.05, bx1 - 0.05]) B.box('metal', x, 0.43, z, 0.045, 0.86, 0.045, { color: STEEL });
    B.slab('paint', bx0 - 0.015, bx0, 1.05, 2.2, bz0, bz1, { color: 0x3b3f3c });
    if (!B.prop('vice', bx1 - 0.16, 0.91, bz0 - 0.32, Math.PI / 2)) B.box('metal', bx1 - 0.2, 1.0, bz0 - 0.35, 0.14, 0.18, 0.3, { color: 0x2f4a66 });
    B.prop('drill_press', bx0 + 0.33, 0.91, bz1 + 0.3, Math.PI / 2);
    B.prop('desk_lamp', bx0 + 0.16, 0.91, bz0 - 0.98, Math.PI / 2);
    B.prop('tool_chest', bx0 + 0.27, 0, (bz0 + bz1) / 2 - 0.1, Math.PI / 2);
    // tools on the board: the kit's lie flat along x, so they are stood up against it
    ['hammer', 'wrench', 'screwdriver', 'crowbar', 'wrench', 'hammer', 'hatchet'].forEach((name, i) => B.push('kit', B.kit(name), at(bx0 + 0.002, (name === 'crowbar' ? 1.62 : 1.5) + (i % 2) * 0.36, bz0 - 0.2 - i * 0.2, 0, 0, -Math.PI / 2)));
    B.gun('rifle', at(bx0 + 0.34, 0.985, bz0 - 0.72, 0.12, 0, Math.PI / 2));
    B.print('stripAtelier', 1.45, at(-W + 0.004, 2.42, (bz0 + bz1) / 2, Math.PI / 2));
  }

  // ---- The passage to the range (right wall) ----
  if (!B.prop('wall_clock', W - 0.004, 2.5, -6.7, -Math.PI / 2, 1.25)) B.print('clock', 0.4, at(W - 0.006, 2.5, -6.7, -Math.PI / 2));
  B.prop('first_aid', W - 0.004, 1.5, -6.62, -Math.PI / 2, 0.8);
  B.prop('fire_alarm', door.x1 + 0.17, 1.42, SHOP + 0.002, 0);
  B.prop('camera', W - 0.004, 3.05, -0.85, -Math.PI / 2);
  B.box('satin', W - 0.012, 1.72, -7.95, 0.02, 0.8, 1.36, { color: 0x3b2a1c });
  B.print('blackboard', 1.3, at(W - 0.024, 1.72, -7.95, -Math.PI / 2));
  B.print('posterCover', 0.62, at(W - 0.006, 1.74, -9.42, -Math.PI / 2));
  B.box('satin', (P.gate.x + door.x0) / 2, 1.66, SHOP + 0.006, 0.42, 0.31, 0.012, { color: 0x2a1d13 });
  B.print('licence', 0.37, at((P.gate.x + door.x0) / 2, 1.66, SHOP + 0.014));
  if (!B.prop('extinguisher', (P.gate.x + door.x0) / 2 + 0.02, 0, SHOP + 0.2, 0, 0.9)) B.rod('paint', 2.5, 0.3, SHOP + 0.14, 0.07, 0.5, 'y', { color: 0xa32418 });
  if (B.prop('barrel', W - 0.34, 0, -6.42, 0.3, 0.72)) for (let i = 0; i < 6; i++) B.push('kit', B.kit('bat'), at(W - 0.34 + Math.cos(i * 1.05) * 0.1, 0.64, -6.42 + Math.sin(i * 1.05) * 0.1, i, 0.1 * Math.cos(i * 2), Math.PI / 2 + 0.1 * Math.sin(i * 2)));
  B.box('satin', (door.x0 + door.x1) / 2, 2.64, SHOP + 0.05, 1.16, 0.5, 0.1, { color: 0x101412 });
  B.print('toRange', 1.1, at((door.x0 + door.x1) / 2, 2.64, SHOP + 0.102), 'glow');

  // ---- Shop ceiling: duct, sprinkler main, track, pendants ----
  if (KIT.props.duct) for (let z = -1.5; z > SHOP + 0.9; z -= 1.8) B.prop('duct', -2.92, H, z, Math.PI / 2);
  else {
    B.slab('metal', -3.2, -2.64, 3.03, H - 0.05, -0.6, SHOP - 0.1, { color: 0x8b908e });
    for (let z = -1.2; z > SHOP; z -= 1.3) B.slab('metal', -3.23, -2.61, 3.0, H - 0.03, z, z - 0.05, { color: 0x7a7f7d });
  }
  B.rod('paint', 1.35, H - 0.07, SHOP / 2, 0.028, -SHOP - 0.4, 'z', { color: 0x8a2018 });
  for (let z = -1.4; z > SHOP + 0.5; z -= 2.6) { B.rod('paint', 1.35, H - 0.13, z, 0.012, 0.1, 'y', { color: 0x8a2018 }); B.rod('metal', 1.35, H - 0.19, z, 0.03, 0.02, 'y', { color: BRASS }); }
  for (const x of [3.55, 3.68]) B.rod('metal', x, H - 0.04, SHOP / 2, 0.014, -SHOP - 0.3, 'z', { color: 0x6a6e6c, segments: 6 });
  B.slab('paint', -3.7, 2.0, H - 0.09, H - 0.05, -8.23, -8.27, { color: BLACK });
  for (const x of [-3.3, -2.3, -1.2, -0.2, 0.6, 1.6]) {
    B.rod('paint', x, H - 0.13, -8.25, 0.008, 0.08, 'y', { color: BLACK, segments: 5 });
    B.push('satin', new THREE.CylinderGeometry(0.05, 0.05, 0.16, 12), at(x, H - 0.22, -8.33, 0, 0.9), { color: BLACK });
    B.push('bulb', new THREE.CircleGeometry(0.042, 12), at(x, H - 0.272, -8.396, 0, 0.9 + Math.PI / 2));
  }
  for (const x of [-3.0, -1.0, 1.0]) if (!B.prop('lamp_hanging', x, H, -6.75, x)) pendant(B, x, H, -6.75, 1.05);
  for (const x of [-2.15, 2.15]) pendant(B, x, H, -3.7, 0.85);
  pendant(B, 0, H, -1.3, 0.6, 0x7a2416);

  // ---- The range: briefing area ----
  {
    const D = P.desk;
    B.slab('satin', D.x - D.w / 2, D.x + D.w / 2, D.h - 0.04, D.h, D.z + D.d / 2, D.z - D.d / 2, { color: 0x3c4142 });
    B.slab('paint', D.x - D.w / 2 + 0.03, D.x - D.w / 2 + 0.5, 0.06, D.h - 0.04, D.z + D.d / 2 - 0.03, D.z - D.d / 2 + 0.03, { color: 0x2c3031 });
    for (const z of [D.z + D.d / 2 - 0.05, D.z - D.d / 2 + 0.05]) B.box('metal', D.x + D.w / 2 - 0.05, (D.h - 0.04) / 2, z, 0.04, D.h - 0.04, 0.04, { color: STEEL });
    muffs(B, D.x + 0.45, D.h, D.z + 0.12, 0.5);
    muffs(B, D.x + 0.2, D.h, D.z - 0.18, -0.8, 0x1f4a32);
    for (let i = 0; i < 3; i++) {
      B.box('paint', D.x - 0.4 + i * 0.2, D.h + 0.053, D.z + 0.05, 0.19, 0.105, 0.1, { color: 0xb9a27a });
      B.print(['ammo9', 'ammo12', 'ammo556'][i], 0.178, at(D.x - 0.4 + i * 0.2, D.h + 0.053, D.z + 0.101), 'print', 0.094);
    }
    B.prop('stool', D.x + 0.1, 0, D.z - 0.75, 0.4);
    B.prop('monitor', D.x - 0.45, D.h, D.z - 0.12, Math.PI + 0.3, 0.9);
    B.prop('power_box', W - 0.004, 1.5, -12.4, -Math.PI / 2, 0.8);
    B.prop('hand_truck', 2.2, 0, -11.0, Math.PI - 0.3);
    B.prop('lamp_wall', -W + 0.004, 2.45, -12.35, Math.PI / 2);
    B.print('medals', 2.3, at(-1.25, 1.95, RANGE - 0.006, Math.PI));
    B.box('satin', -1.25, 1.95, RANGE - 0.003, 2.38, 1.08, 0.012, { color: 0x15120f });
    B.print('posterRules', 0.74, at(-W + 0.006, 1.72, -12.35, Math.PI / 2));
    B.print('target', 0.42, at(1.2, 1.75, RANGE - 0.006, Math.PI));
    B.print('posterCalm', 0.6, at(2.0, 1.75, RANGE - 0.006, Math.PI));
    striplight(B, -0.6, H, -11.9, 1.3);
    striplight(B, 1.6, H, -11.9, 1.3);
    // crates in the corner
    if (KIT.props.crate_military) {
      B.prop('crate_military', -3.45, 0, -12.9, 0.04); B.prop('crate', -3.55, 0.46, -12.88, -0.1); B.prop('crate_long', -2.2, 0, -12.95, -0.06, 0.9);
      for (const [dx, dy] of [[-0.2, 0], [0.1, 0], [-0.05, 0.18]]) B.prop('ammo_box', -2.2 + dx, 0.415 + dy, -12.95, dx);
      B.prop('barrel', 1.75, 0, -10.85, 0.5, 0.9);
    } else for (const [x, y, z, r] of [[-3.75, 0, -12.85, 0], [-3.2, 0, -12.9, 0.1], [-3.5, 0.42, -12.88, -0.15]]) {
      B.box('slats', x, y + 0.21, z, 0.5, 0.42, 0.42, { ry: r, tile: T.slats, color: 0xb59468 }); B.print('crate', 0.34, at(x + Math.sin(r) * 0.212, y + 0.21, z + Math.cos(r) * 0.212, r));
    }
  }

  // ---- The firing line ----
  {
    const L = P.line, Bt = P.booths, zf = L.z + L.depth / 2, zb = L.z - L.depth / 2;
    B.print('hazard', 2 * W, at(0, 0.004, Bt.z0 + 0.12, 0, -Math.PI / 2), 'print', 0.14);
    B.slab('plate', -W, W, L.h - 0.05, L.h, zf, zb, { tile: T.plate, color: 0x7d807d });
    B.slab('plate', -W, W, 0, L.h - 0.05, zb + 0.06, zb, { tile: T.plate, color: 0x626562 });
    for (const x of Bt.walls) {
      B.slab('plate', x - 0.04, x + 0.04, 0, 1.25, Bt.z0, Bt.z1, { tile: T.plate, color: 0x6a6d6a });
      B.slab('glass', x - 0.012, x + 0.012, 1.25, Bt.h, Bt.z0 - 0.03, Bt.z1);
      B.slab('metal', x - 0.03, x + 0.03, 0, Bt.h, Bt.z0, Bt.z0 - 0.05, { color: STEEL });
      B.slab('metal', x - 0.03, x + 0.03, Bt.h, Bt.h + 0.04, Bt.z0, Bt.z1, { color: STEEL });
    }
    P.lanes.forEach((x, i) => {
      B.slab('rubber', x - 0.5, x + 0.5, L.h, L.h + 0.008, zf - 0.04, zb + 0.08, { tile: T.rubber, color: 0x8a8d8a });
      B.box('satin', x, 2.62, Bt.z1 - 0.02, 0.4, 0.4, 0.02, { color: 0x101412 });
      B.print(`lane${i + 1}`, 0.36, at(x, 2.62, Bt.z1 - 0.008));
      B.rod('metal', x, 3.13, Bt.z1 - 0.02, 0.006, 0.62, 'y', { color: STEEL, segments: 5 });
      muffs(B, x + 0.3, L.h + 0.008, L.z + 0.02, 0.4 + i, i % 2 ? 0x8f2a1c : 0x1f4a32);
      B.box('paint', x - 0.32, L.h + 0.06, L.z, 0.19, 0.105, 0.1, { ry: 0.3, color: 0xb9a27a });
      // the target carrier's rail and its motor box
      B.slab('metal', x - 0.025, x + 0.025, 3.2, 3.24, zb - 0.05, P.targets.far - 0.3, { color: STEEL });
      B.box('paint', x, 3.14, zb - 0.2, 0.16, 0.14, 0.24, { color: 0x30343a });
      B.push('bulb', new THREE.SphereGeometry(0.018, 8, 6), at(x + 0.05, 3.06, zb - 0.1));
    });
    B.box('satin', 0, 2.95, Bt.z0 + 0.02, 1.56, 0.48, 0.08, { color: 0x101412 });
    B.print('ceasefire', 1.5, at(0, 2.95, Bt.z0 + 0.062), 'glow');
  }

  // ---- Down range: foam, baffles, the trap ----
  {
    const z0 = P.line.z - 0.4, z1 = P.back;
    for (const s of [-1, 1]) B.slab('foam', s * (W - 0.07), s * W, 0.5, H - 0.1, z0, z1, { tile: T.foam, color: 0x8e9190 });
    B.slab('foam', -W, W, H - 0.07, H, z0, z1, { tile: T.foam, color: 0x7f8281 });
    for (const z of [-17.1, -19.9, -22.7, -25.3]) {
      B.box('plate', 0, 2.95, z, 2 * W, 0.04, 0.95, { rx: 0.62, tile: T.plate, color: 0x5d605d });
      B.push('tube', new THREE.CylinderGeometry(0.02, 0.02, 2 * W - 0.6, 8), at(0, 3.02, z - 0.36, 0, 0, Math.PI / 2));
    }
    for (const [z, mark] of [[-19.6, 0xd9d4c2], [-24.6, 0xd9d4c2]]) B.slab('paint', -W, W, 0.002, 0.005, z, z - 0.07, { color: mark });
    // the bullet trap: steel leaning back over a bed of rubber crumb
    B.box('plate', 0, 1.42, -27.02, 2 * W, 0.06, 3.0, { rx: -1.08, tile: T.plate, color: 0x4c4f4d });
    B.slab('rubber', -W, W, 0, 0.32, -26.45, z1, { tile: T.rubber, color: 0x5a5c5a });
    B.slab('plate', -W, W, 0.32, 0.36, -26.4, -26.5, { tile: T.plate, color: 0x6c6f6c });
  }

  const group = B.finish(new THREE.Group(), { shadows: ['plaster', 'ceiling', 'paint', 'plate', 'slats'] });
  group.name = 'CalibreBranch';
  return group;
}

// ---- The 48 branches in the city -------------------------------------------------------------------------------------

function createCalibreWorld(scene, sites) {
  const materials = createMaterials(), template = buildBranch(materials);
  const group = new THREE.Group(); group.name = 'Calibre'; scene.add(group);
  // one glazed leaf, cloned for every door
  const leaf = new THREE.Group();
  {
    const B = new Builder(materials);
    B.box('glass', 0.43, 1.31, 0, 0.8, 2.5, 0.012);
    for (const y of [0.07, 2.56]) B.box('paint', 0.43, y, 0, 0.86, 0.12, 0.05, { color: GREEN_DARK });
    for (const x of [0.03, 0.83]) B.box('paint', x, 1.31, 0, 0.06, 2.6, 0.05, { color: GREEN_DARK });
    for (const z of [-0.06, 0.06]) { B.rod('metal', 0.68, 1.15, z, 0.012, 0.5, 'y', { color: BRASS }); for (const y of [0.95, 1.35]) B.rod('metal', 0.68, y, z / 2, 0.008, 0.07, 'z', { color: BRASS, segments: 5 }); }
    B.finish(leaf);
  }
  const rooms = sites.map(site => {
    const root = template.clone(true); root.name = site.id;
    root.position.set(site.x, CALIBRE.floor, site.z); root.rotation.y = Math.atan2(site.nx, site.nz);
    const doors = [-1, 1].map(side => {
      const pivot = new THREE.Group(); pivot.position.set(side * 0.92, 0, 0.02);
      const door = leaf.clone(true); if (side > 0) door.rotation.y = Math.PI;
      pivot.add(door); root.add(pivot); return pivot;
    });
    group.add(root); root.updateMatrixWorld(true);
    return { site, root, doors, openness: 0 };
  });

  // What follows the nearest branch: its lamps, the weapon presented on the counter
  const dynamic = new THREE.Group(); dynamic.name = 'CalibreLive'; scene.add(dynamic);
  const lamps = LIGHTS.map(spec => {
    const light = spec.kind === 'spot' ? new THREE.SpotLight(spec.color, 0, spec.reach, spec.angle, 0.85, 1.6) : new THREE.PointLight(spec.color, 0, spec.reach, 1.7);
    light.position.set(spec.x, spec.y, spec.z);
    dynamic.add(light);
    if (spec.kind === 'spot') { light.target.position.set(spec.tx, spec.ty, spec.tz); dynamic.add(light.target); }
    return { light, spec };
  });
  // What the clerk lays on the mat: each weapon on a rest, leaning back, dressed as the counter asks (weapon-mods.js);
  // a vest for the protection tab
  const MAT = { x: -1.72, y: PLAN.counter.h + 0.004, z: PLAN.counter.z + 0.04 };
  // A piece rests on the mat by its lowest point as it is dressed: a longer magazine or a foregrip hangs below the bare
  // weapon, and their boxes say nothing (weapon-attachments.js keeps them empty), so the vertices are read.
  const _vertex = new THREE.Vector3();
  function settle(holder) {
    holder.position.y = MAT.y;
    holder.updateMatrixWorld(true);
    let low = Infinity;
    holder.traverseVisible((o) => {
      if (!o.isMesh) return;
      const g = o.geometry, position = g.attributes.position, index = g.index, e = o.matrixWorld.elements;
      const start = g.drawRange.start, end = Math.min(index ? index.count : position.count, start + g.drawRange.count);
      for (let i = start; i < end; i++) {
        _vertex.fromBufferAttribute(position, index ? index.getX(i) : i);
        low = Math.min(low, e[1] * _vertex.x + e[5] * _vertex.y + e[9] * _vertex.z + e[13]);
      }
    });
    if (Number.isFinite(low)) holder.position.y += dynamic.position.y + MAT.y + 0.006 - low;
    holder.updateMatrixWorld(true);
  }
  const previews = new Map();
  for (const id of ['pistol', 'smg', 'shotgun', 'rifle', 'grenade']) {
    const model = Weapons.createWeaponModel(id, { dress: true }); model.matrixAutoUpdate = true;
    const holder = new THREE.Group();
    model.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, id === 'grenade' ? 0 : -0.32, 'YXZ'));
    holder.add(model); holder.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(holder);
    model.position.set(-(bounds.min.x + bounds.max.x) / 2, 0, -(bounds.min.z + bounds.max.z) / 2);
    holder.position.set(MAT.x, MAT.y, MAT.z);
    holder.visible = false; dynamic.add(holder); previews.set(id, { holder, model, dressed: undefined });
  }
  {
    const B = new Builder(materials), holder = new THREE.Group();
    vest(B, 0, 0.36, 0, 0, 0x4d553b);
    B.rod('metal', 0, 0.06, -0.02, 0.01, 0.12, 'y', { color: 0x191a1a });
    B.rod('metal', 0, 0.006, -0.02, 0.1, 0.012, 'y', { color: 0x191a1a, segments: 16 });
    B.finish(holder);
    holder.position.set(MAT.x, MAT.y, MAT.z); holder.visible = false;
    dynamic.add(holder); previews.set('armor', { holder, model: null });
  }
  // The range's paper targets, one per lane on its carrier: place(d, x, turn), cross(o, d, reach), hole(x, y), clear()
  const LINE = PLAN.line.z + PLAN.line.depth / 2 + 0.35, PAPER_Y = 1.45, HOLES = 30;
  const holeGeometry = new THREE.CircleGeometry(0.011, 8), holeMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x0b0b0a });
  const _hole = new THREE.Matrix4(), _spin = new THREE.Quaternion(), _axis = new THREE.Vector3(0, 0, 1), _where = new THREE.Vector3(), _unit = new THREE.Vector3(1, 1, 1);
  const targets = PLAN.lanes.map((laneX) => {
    const group = new THREE.Group(), hang = new THREE.Group();
    const B = new Builder(materials);
    B.box('paint', 0, 3.15, 0, 0.14, 0.09, 0.2, { color: 0x30343a });
    B.finish(group);
    const H2 = new Builder(materials);
    for (const x of [-0.2, 0.2]) H2.rod('metal', x, 2.5, 0, 0.005, 1.22, 'y', { color: 0x3a3d3e, segments: 5 });
    H2.box('metal', 0, PAPER_Y + PAPER.h / 2 + 0.012, 0, 0.52, 0.03, 0.02, { color: 0x3a3d3e });
    H2.print('target', PAPER.w, at(0, PAPER_Y, 0.002), 'print', PAPER.h);
    H2.push('paint', new THREE.PlaneGeometry(PAPER.w, PAPER.h), at(0, PAPER_Y, -0.002, Math.PI), { color: 0xd9cfb2 });
    H2.finish(hang);
    const holes = new THREE.InstancedMesh(holeGeometry, holeMaterial, HOLES);
    holes.count = 0; holes.frustumCulled = false; holes.position.set(0, PAPER_Y, 0.004);
    hang.add(holes); group.add(hang); dynamic.add(group);
    const target = { group, d: 9, x: 0, turn: 0, written: 0,
      place(d, x = 0, turn = 0) {
        target.d = d; target.x = x; target.turn = turn;
        group.position.set(laneX + x, 0, LINE - d);
        hang.rotation.y = turn * Math.PI / 2;
        group.updateMatrixWorld(true);
      },
      // a ray in the branch's frame against the sheet: { t, x, y } on the paper, or null
      cross(o, d, reach) {
        const face = Math.cos(target.turn * Math.PI / 2);
        if (d.z >= -1e-6 || face < 0.3) return null;
        const t = (LINE - target.d - o.z) / d.z;
        if (t <= 0 || t > reach) return null;
        const x = (o.x + d.x * t - laneX - target.x) / face, y = o.y + d.y * t - PAPER_Y;
        return Math.abs(x) <= PAPER.w / 2 && Math.abs(y) <= PAPER.h / 2 ? { t, x, y } : null;
      },
      hole(x, y) {
        const i = target.written % HOLES;
        holes.setMatrixAt(i, _hole.compose(_where.set(x, y, 0), _spin.setFromAxisAngle(_axis, target.written * 2.4), _unit));
        target.written++;
        holes.count = Math.min(HOLES, target.written);
        holes.instanceMatrix.needsUpdate = true;
      },
      clear() { target.written = 0; holes.count = 0; }
    };
    target.place(9, 0, 0);
    return target;
  });
  // the regular's sheet is already well used
  for (let i = 0; i < 14; i++) targets[0].hole(Math.sin(i * 12.9) * 0.09, Math.cos(i * 7.3) * 0.12 - 0.02);
  dynamic.position.set(0, -500, 0); dynamic.updateMatrixWorld(true);

  let live = null, brightness = 0;
  function attach(room) {
    live = room;
    if (room) { dynamic.position.copy(room.root.position); dynamic.rotation.copy(room.root.rotation); }
    else dynamic.position.set(0, -500, 0);
    dynamic.updateMatrixWorld(true);
  }

  // The counter's choice on the mat: { site, id, state } or null. A change slides the new piece in from the clerk's side.
  let shown = null, slide = 1;
  function present(selected) {
    const id = selected && live && selected.site === live.site ? selected.id : null;
    if (id !== shown) { shown = id; slide = 0; for (const [key, p] of previews) { p.holder.visible = key === id; if (key === id && p.model) { p.dressed = undefined; } } }
    const p = id ? previews.get(id) : null;
    if (p?.model && p.dressed !== selected.state) {
      p.dressed = selected.state;
      Weapons.dressWeapon?.(p.model, selected.state || null);
      settle(p.holder);
    }
  }

  function update(camera, player, dt, selected = null, visitors = [], night = 0) {
    let nearest = null, distance = Infinity;
    for (const room of rooms) {
      const site = room.site, d = Math.hypot(camera.position.x - site.x, camera.position.z - site.z);
      room.root.visible = d < 300;
      if (d < distance) { nearest = room; distance = d; }
      if (!room.root.visible) continue;
      const p = calibreLocal(site, player.x, player.z);
      const visitorAtDoor = visitors.some(actor => {
        if (actor.dead) return false;
        const local = calibreLocal(site, actor.x, actor.z);
        return Math.abs(local.x) < 1.2 && local.z > -2 && local.z < 3;
      });
      const target = (Math.abs(p.x) < 2.5 && p.z > -3.5 && p.z < 4) || visitorAtDoor ? 1 : 0;
      if (Math.abs(target - room.openness) < 0.001) continue;
      room.openness += (target - room.openness) * (1 - Math.exp(-dt * 9));
      room.doors.forEach((door, i) => { door.rotation.y = (i ? -1 : 1) * room.openness * 1.48; door.updateMatrixWorld(true); });
    }
    const near = nearest && distance < 90 ? nearest : null;
    if (near !== live) attach(near);
    // the lamps come up as one approaches; the goosenecks only after dark
    const want = near ? 1 : 0;
    brightness += (want - brightness) * (1 - Math.exp(-dt * 4));
    for (const { light, spec } of lamps) light.intensity = spec.power * brightness * (spec.night ? Math.min(1, night * 2.2) : 1);
    present(selected);
    if (shown && slide < 1) {
      slide = Math.min(1, slide + dt * 3.2);
      const ease = 1 - (1 - slide) ** 3, holder = previews.get(shown).holder;
      holder.position.z = MAT.z - (1 - ease) * 0.38; holder.rotation.y = (1 - ease) * 0.5;
      holder.updateMatrixWorld(true);
    }
  }

  let exterior = [];
  const frustum = new THREE.Frustum(), view = new THREE.Matrix4(), front = new THREE.Box3(), corner = new THREE.Vector3();
  const hidden = [];
  const api = { group, rooms, lamps, materials, targets, update, occludedExterior: false,
    // the piece on the mat is pushed back towards the customer (a purchase, a change)
    nudge() { slide = Math.min(slide, 0.55); },
    get live() { return live; },
    setExteriorRoots(roots) { exterior = roots; },
    render(camera, draw) {
      let enclosed = null;
      for (const room of rooms) {
        if (!room.root.visible) continue;
        const local = calibreLocal(room.site, camera.position.x, camera.position.z);
        if (Math.abs(local.x) < W - 0.08 && local.z < -0.55 && local.z > PLAN.back + 0.1 && camera.position.y > 0.35 && camera.position.y < CALIBRE.floor + H - 0.1) { enclosed = room; break; }
      }
      api.occludedExterior = false;
      if (enclosed) {
        frustum.setFromProjectionMatrix(view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
        front.makeEmpty();
        const s = enclosed.site;
        for (const x of [-4.5, 4.5]) for (const y of [0, 4]) front.expandByPoint(corner.set(s.x + s.nz * x + s.nx * 0.25, y, s.z - s.nx * x + s.nz * 0.25));
        api.occludedExterior = !frustum.intersectsBox(front);
      }
      if (api.occludedExterior) for (const root of exterior) if (root.visible) { hidden.push(root); root.visible = false; }
      try { return draw(); } finally { for (const root of hidden) root.visible = true; hidden.length = 0; }
    }
  };
  return api;
}

export { createCalibreWorld, LIGHTS };
