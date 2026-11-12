import * as THREE from 'three/webgpu';
import { PROP, PERSON_BONES as BONE } from './pedestrians.js';
import { BRANDS, brandOpenAt } from './eatery-brands.js';
import { SPECS, PLANS, SEATS, SPOTS, route, eateryPoint, eateryLocal, eateryHeading } from './eatery-plan.js';

// The people of the restaurants. Everyone is a pedestrian of the city's crowd (pedestrian-system.js) taken off the
// street for a while: the crew at their posts in a cap and an apron, the customers who come in from the sidewalk,
// queue, order, wait for their number, carry a tray to a table, eat, clear it and go back to their walk. Each one runs
// a script (a generator that yields once per frame); what their hands do and hold is drawn by `pose`, called by the
// crowd when it has placed their body. Only the branch of each franchise nearest to the camera is alive.

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clamp01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t);
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
// 0 -> 1 -> 0: up in `rise`, held for `hold`, down in `fall` (seconds)
const pulse = (t, rise, hold, fall) => (t < rise ? smooth(t / rise) : t < rise + hold ? 1 : 1 - smooth((t - rise - hold) / fall));
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _mouth = new THREE.Vector3();

const MAX_CUSTOMERS = { bullion: 11, tranche: 7 };
const CLOSED_FOR = 150; // seconds a branch stays shut after trouble
const FLAVOURS = ['margherita', 'pepperoni', 'bianca'];
// Crowd bodies in a suit (human-crowd.js): nobody wears an apron over one
const SUITS = new Set([10, 22, 23]);

// How full a branch is at `hour`, 0..1
function crowdAt(brand, hour) {
  if (!brandOpenAt(brand, hour)) return 0;
  const bell = (centre, width) => Math.exp(-(((hour - centre) / width) ** 2));
  const lunch = bell(12.8, 1.3), dinner = bell(19.8, 1.5), late = brand === 'tranche' ? 0.55 * bell(25.5 - (hour < 6 ? 0 : 24), 2.2) + 0.55 * bell(1.5, 2.2) : 0.2 * bell(23.5, 2);
  const morning = brand === 'bullion' ? 0.45 * bell(8, 1.2) : 0;
  return Math.min(1, 0.28 + 0.72 * Math.max(lunch, dinner * 0.9, late, morning));
}

// ---- Seats as the crowd poses them (PersonRig.drive): the hips' height, where the hands rest, where the feet go ----------
const seatPose = (seat, lean = 0.1, nod = 0.08) => {
  const reach = Math.hypot(seat.tray.x - seat.x, seat.tray.z - seat.z);
  return { seat: { x: 0, y: seat.h, z: 0 }, wheel: { x: 0, y: seat.tray.h + 0.03, z: Math.max(0.3, reach - 0.12) }, radius: 0.15, tilt: Math.PI / 2, turn: 0,
    pedals: seat.kind === 'stool' ? { x: 0, y: 0.32, z: 0.2 } : { x: 0, y: 0.03, z: 0.4 }, recline: 0.02, look: 0, lean, nod };
};

// ---- A body the gestures move: a crowd rig, or the protagonist's (eatery.js gives its own `hand`) -----------------------
// B = { rig, x, y, z (floor under them, world), yaw, s, hand(i, x, y, z, grip), street }
function crowdBody(c, rig) {
  const B = c.body;
  B.rig = rig; B.x = rig.x; B.z = rig.z; B.y = c.branch.floorY; B.yaw = rig.yaw; B.s = rig.s; B.street = c.outside;
  return B;
}
// A point of the body's frame (lx to its left, h above the floor, fz ahead), in the world
function at(B, lx, h, fz, out) {
  const sn = Math.sin(B.yaw), cs = Math.cos(B.yaw);
  return out.set(B.x + cs * lx + sn * fz, B.y + h, B.z - sn * lx + cs * fz);
}
const item = (name, street) => (street ? `${name}@street` : name);

// What lies on a tray (or a plate), drawn where the tray is: tray = { kind: 'tray'|'plate'|'bag'|'box', burger, tall,
// fries, cup (0 none, 1 half or there, 2 full), flavour, slice, can, lifted }
function drawTray(props, tray, x, y, z, yaw, street = false) {
  const sn = Math.sin(yaw), cs = Math.cos(yaw);
  const put = (name, lx, h, fz, turn = 0, tip = 0) => props.place(item(name, street), x + cs * lx + sn * fz, y + h, z - sn * lx + cs * fz, yaw + turn, tip);
  if (tray.kind === 'bag') { put('bag', 0, 0, 0); return; }
  if (tray.kind === 'box') { put('box', 0, 0, 0); return; }
  if (tray.kind === 'plate') {
    if (tray.slice >= 2 && tray.lifted !== 'slice') put(`slice${cap(tray.flavour)}`, 0, 0, 0, 0.3);
    else put('plate', 0, 0, 0);
    if (tray.can && tray.lifted !== 'can') put('can', 0.17, 0, 0.02);
    return;
  }
  put('tray', 0, 0, 0);
  const top = 0.012;
  if (tray.burger && tray.lifted !== 'burger') put(tray.burger >= 2 ? (tray.wrapped ? 'burgerWrapped' : tray.tall ? 'burgerTall' : 'burger') : 'burgerHalf', 0.09, top, 0.02, 0.4);
  if (tray.fries && tray.lifted !== 'fries') put(tray.fries >= 2 ? 'fries' : 'friesHalf', -0.08, top, 0.07, -0.3);
  if (tray.cup && tray.lifted !== 'cup') put('cup', -0.13, top, -0.07);
}

// ---- Gestures: (cast, B, t seconds in, data) ---------------------------------------------------------------------------
const GESTURES = {
  // a tray (or a box) carried in both hands ahead of the belly
  carryTray(cast, B, t, d) {
    const p = at(B, 0, 1.03 * B.s, 0.4, _a);
    drawTray(cast.props, d.tray, p.x, p.y, p.z, B.yaw, B.street);
    const half = d.tray.kind === 'box' ? 0.17 : 0.21;
    for (const i of [0, 1]) { const h = at(B, (i ? -1 : 1) * half, 1.035 * B.s, 0.36, _b); B.hand(i, h.x, h.y, h.z, 0.7); }
  },
  // a plate held flat in the right hand
  carryPlate(cast, B, t, d) {
    const p = at(B, -0.13, 1.08 * B.s, 0.33, _a);
    drawTray(cast.props, d.tray, p.x, p.y, p.z, B.yaw, B.street);
    B.hand(1, p.x, p.y - 0.015, p.z, 0.4);
  },
  // a bag hanging from the right hand: the arm is left to swing
  carryBag(cast, B, t, d) {
    const h = B.rig.handPoint(1, _a);
    cast.props.place(item('bag', B.street), h.x, h.y - 0.36, h.z, B.yaw + 0.2);
  },
  // a burger taken from the tray in both hands, up to the mouth, a bite, and back (1.7 s)
  bite(cast, B, t, d) {
    const k = pulse(t, 0.5, 0.42, 0.55), m = B.rig.mouthPoint(_mouth), rest = d.rest;
    const x = rest.x + (m.x - rest.x) * k, y = rest.y + 0.05 + (m.y - 0.045 - rest.y - 0.05) * k, z = rest.z + (m.z - rest.z) * k;
    cast.props.place(item(d.name, B.street), x, y - 0.04, z, B.yaw + 0.4, -0.25 * k);
    const sn = Math.sin(B.yaw), cs = Math.cos(B.yaw);
    for (const i of [0, 1]) { const s = i ? -1 : 1; B.hand(i, x + cs * s * 0.062 - sn * 0.03, y - 0.005, z - sn * s * 0.062 - cs * 0.03, 0.75); }
    if (!d.bitten && t > 0.6) { d.bitten = true; cast.sfx(d.sound || 'bite', m.x, m.y, m.z); }
  },
  // one hand: a fry, a slice, a cup, a can from where it rests to the mouth and back (1.5 s)
  nibble(cast, B, t, d) {
    const k = pulse(t, 0.45, d.hold ?? 0.4, 0.5), m = B.rig.mouthPoint(_mouth), rest = d.rest, i = d.left ? 0 : 1;
    const x = rest.x + (m.x - rest.x) * k, y = rest.y + (m.y - 0.03 - rest.y) * k + Math.sin(k * Math.PI) * 0.03, z = rest.z + (m.z - rest.z) * k;
    if (d.name) {
      const sn = Math.sin(B.yaw), cs = Math.cos(B.yaw);
      // a slice points at the mouth; a cup stays upright and tips at the lips
      if (d.slice) cast.props.place(item(d.name, B.street), x - sn * 0.2, y - 0.02 - 0.05 * k, z - cs * 0.2, B.yaw, -0.35 * k);
      else cast.props.place(item(d.name, B.street), x, y - (d.tall ?? 0.1), z, B.yaw, d.tip ? -0.5 * k : 0);
    }
    const sn = Math.sin(B.yaw), cs = Math.cos(B.yaw), back = d.slice ? 0.22 : 0.03, side = (i ? -1 : 1) * (d.slice ? 0 : 0.045);
    B.hand(i, x - sn * back + cs * side, y - (d.slice ? 0.02 : 0.03), z - cs * back - sn * side, 0.7);
    if (!d.bitten && t > 0.55) { d.bitten = true; if (d.sound) cast.sfx(d.sound, m.x, m.y, m.z); }
  },
  // talking with the hands, a little
  talk(cast, B, t) {
    const h = at(B, -0.16, (1.08 + Math.sin(t * 5.2) * 0.04) * B.s, 0.3 + Math.sin(t * 3.1) * 0.05, _a);
    B.hand(1, h.x, h.y, h.z, 0.25);
  },
  // an arm raised at the boards over the counter
  point(cast, B, t, d) {
    const k = pulse(t, 0.35, 0.5, 0.35), h = at(B, -0.2, (0.95 + 0.62 * k) * B.s, 0.25 + 0.3 * k, _a);
    B.hand(1, h.x, h.y, h.z, 0.1);
  },
  // a finger on the glass of a display
  pointLow(cast, B, t, d) {
    const k = pulse(t, 0.3, 0.5, 0.3), h = at(B, -0.15 - 0.1 * k, (0.95 + 0.22 * k) * B.s, 0.25 + 0.3 * k, _a);
    B.hand(1, h.x, h.y, h.z, 0.1);
  },
  // a card (or notes) held out over the counter
  pay(cast, B, t, d) {
    const k = pulse(t, 0.4, 0.6, 0.4), h = at(B, -0.16, (1.0 + 0.12 * k) * B.s, 0.26 + 0.34 * k, _a);
    B.hand(1, h.x, h.y, h.z, 0.8);
    cast.props.place(d.cash ? 'cash' : 'card', h.x, h.y + 0.02, h.z, B.yaw, 0, 0);
  },
  // taking or setting something down ahead: both hands out and back
  take(cast, B, t, d) {
    const k = pulse(t, 0.3, 0.2, 0.3);
    for (const i of [0, 1]) { const h = at(B, (i ? -1 : 1) * 0.2, (1.0 + 0.06 * k) * B.s, 0.3 + 0.28 * k, _b); B.hand(i, h.x, h.y, h.z, 0.6); }
    if (d?.tray) { const p = at(B, 0, 1.02 * B.s, 0.4 + 0.24 * k, _a); drawTray(cast.props, d.tray, p.x, p.y, p.z, B.yaw, B.street); }
  },
  // the right hand on a till's screen
  type(cast, B, t, d) {
    const h = at(B, -0.1 + Math.sin(t * 7.3) * 0.07, (1.16 + Math.sin(t * 11) * 0.025) * B.s, 0.42, _a);
    B.hand(1, h.x, h.y, h.z, 0.15);
    const r = at(B, 0.22, 1.03 * B.s, 0.34, _b); B.hand(0, r.x, r.y, r.z, 0.2);
  },
  // tidying what is in front: both hands low on the counter, sliding
  tidy(cast, B, t) {
    for (const i of [0, 1]) { const h = at(B, (i ? -1 : 1) * (0.18 + Math.sin(t * 2.3 + i) * 0.1), 1.04 * B.s, 0.36 + Math.sin(t * 1.7 + i * 2) * 0.06, _b); B.hand(i, h.x, h.y, h.z, 0.3); }
  },
  // one hand reaching for something ahead at height d.h (the chute, the fries, a slice in the display), and back
  grab(cast, B, t, d) {
    const k = pulse(t, 0.35, 0.25, 0.35), h = at(B, (d.side ?? -0.12), (1.0 + ((d.h ?? 1.12) - 1.0) * k) * B.s, 0.28 + (d.reach ?? 0.36) * k, _a);
    B.hand(1, h.x, h.y, h.z, 0.7);
    if (d.tool) cast.props.place(d.tool, h.x, h.y, h.z, B.yaw, 0.2 * k);
    if (d.tray) { const p = at(B, 0.16, 1.02 * B.s, 0.38, _c); drawTray(cast.props, d.tray, p.x, p.y, p.z, B.yaw); B.hand(0, p.x + Math.cos(B.yaw) * 0.2, p.y + 0.01, p.z - Math.sin(B.yaw) * 0.2, 0.7); }
  },
  // a cup held under a nozzle
  fill(cast, B, t, d) {
    const k = pulse(t, 0.4, 1.5, 0.4), h = at(B, -0.14, (1.02 + 0.2 * k) * B.s, 0.3 + 0.32 * k, _a);
    B.hand(1, h.x, h.y, h.z, 0.7);
    cast.props.place('cup', h.x, h.y - 0.08, h.z, B.yaw);
    if (d.tray) { const p = at(B, 0.14, 1.02 * B.s, 0.36, _c); drawTray(cast.props, d.tray, p.x, p.y, p.z, B.yaw); B.hand(0, p.x + Math.cos(B.yaw) * 0.2, p.y + 0.01, p.z - Math.sin(B.yaw) * 0.2, 0.7); }
  },
  // a tray tipped into the bin's flap
  dump(cast, B, t, d) {
    const k = pulse(t, 0.4, 0.4, 0.4), p = at(B, 0, (1.02 - 0.08 * k) * B.s, 0.4 + 0.16 * k, _a);
    if (d.tray) { if (d.tray.kind === 'plate') cast.props.place('plate', p.x, p.y, p.z, B.yaw, 0.9 * k); else cast.props.place('tray', p.x, p.y, p.z, B.yaw, 0.75 * k); }
    for (const i of [0, 1]) { const h = at(B, (i ? -1 : 1) * 0.2, (1.03 - 0.02 * k) * B.s, 0.36 + 0.1 * k, _b); B.hand(i, h.x, h.y, h.z, 0.7); }
  },
  // a cloth worked in circles on a table top at d.h
  wipe(cast, B, t, d) {
    const h = at(B, -0.05 + Math.cos(t * 5) * 0.16, (d.h ?? 0.76) + 0.02, 0.5 + Math.sin(t * 5) * 0.1, _a);
    B.hand(1, h.x, h.y + 0.02, h.z, 0.5);
    cast.props.place('cloth', h.x, h.y, h.z, B.yaw + t * 2);
    const r = at(B, 0.2, (d.h ?? 0.76) + 0.03, 0.34, _b); B.hand(0, r.x, r.y, r.z, 0.2);
  },
  // a mop pushed and pulled ahead
  mop(cast, B, t) {
    const push = Math.sin(t * 2.4) * 0.16, h = at(B, -0.08, 1.16 * B.s, 0.2 + push, _a);
    cast.props.place('mop', h.x, h.y, h.z, B.yaw + Math.sin(t * 1.2) * 0.25);
    B.hand(1, h.x, h.y, h.z, 0.9);
    const l = at(B, 0.06, 0.92 * B.s, 0.36 + push, _b); B.hand(0, l.x, l.y, l.z, 0.9);
  },
  // the griddle: a turner at slot d.to (world point), a flip of the wrist in the middle
  turner(cast, B, t, d) {
    const k = pulse(t, 0.3, 0.3, 0.3), rest = at(B, -0.2, 1.02 * B.s, 0.34, _a), to = d.to;
    const x = rest.x + (to.x - rest.x) * k, y = rest.y + (to.y + 0.05 - rest.y) * k + (d.flip ? Math.sin(clamp01((t - 0.35) / 0.25) * Math.PI) * 0.09 : 0), z = rest.z + (to.z - rest.z) * k;
    const sn = Math.sin(B.yaw), cs = Math.cos(B.yaw);
    B.hand(1, x - sn * 0.24, y + 0.03, z - cs * 0.24, 0.9);
    cast.props.place('spatula', x - sn * 0.24, y + 0.03, z - cs * 0.24, B.yaw, 0.12 - (d.flip ? Math.sin(clamp01((t - 0.35) / 0.25) * Math.PI) * 0.9 : 0));
    const l = at(B, 0.2, 0.98 * B.s, 0.3, _b); B.hand(0, l.x, l.y, l.z, 0.2);
  },
  // the turner idle in the hand
  holdTurner(cast, B, t) {
    const h = at(B, -0.2, 1.0 * B.s, 0.32 + Math.sin(t * 1.3) * 0.03, _a);
    B.hand(1, h.x, h.y, h.z, 0.9); cast.props.place('spatula', h.x, h.y, h.z, B.yaw, 0.15);
  },
  // dressing a burger, wrapping it: both hands working close together
  assemble(cast, B, t, d) {
    const fold = Math.sin(t * 6) * 0.05;
    for (const i of [0, 1]) { const h = at(B, (i ? -1 : 1) * (0.08 + fold * (i ? 1 : -1)), (1.02 + Math.abs(Math.sin(t * 3 + i)) * 0.05) * B.s, 0.44, _b); B.hand(i, h.x, h.y, h.z, 0.6); }
    const p = at(B, 0, 0.98 * B.s, 0.46, _a); cast.props.place(t > (d.time || 2) * 0.6 ? 'burgerWrapped' : 'burger', p.x, p.y, p.z, B.yaw + t);
  },
  // a fry basket's handle, pushed down or pulled up: d.to is the handle (world)
  basket(cast, B, t, d) {
    const k = smooth(t / 0.5), rest = at(B, -0.18, 1.0 * B.s, 0.3, _a), to = d.to;
    B.hand(1, rest.x + (to.x - rest.x) * k, rest.y + (to.y - rest.y) * k, rest.z + (to.z - rest.z) * k, 0.9);
  },
  // a scoop through the fries, into a carton held in the other hand
  scoop(cast, B, t) {
    const s = Math.sin(t * 4.2), h = at(B, -0.14, (1.0 + Math.max(0, s) * 0.14) * B.s, 0.46 - Math.max(0, s) * 0.12, _a);
    B.hand(1, h.x, h.y, h.z, 0.9); cast.props.place('scoop', h.x, h.y, h.z, B.yaw + 0.5, -0.3 + s * 0.5);
    const l = at(B, 0.12, 1.08 * B.s, 0.32, _b); B.hand(0, l.x, l.y, l.z, 0.7); cast.props.place('fries', l.x, l.y - 0.06, l.z, B.yaw);
  },
  // dough: pressed out on the bench with both palms
  knead(cast, B, t, d) {
    const push = Math.sin(t * 5.5);
    for (const i of [0, 1]) { const h = at(B, (i ? -1 : 1) * (0.07 + 0.05 * Math.max(0, push)), d.h + 0.04 + Math.max(0, -push) * 0.05, 0.46 + push * 0.07, _b); B.hand(i, h.x, h.y, h.z, 0.1); }
    const p = at(B, 0, d.h, 0.5, _a);
    cast.props.place(d.flat ? 'doughDisc' : 'doughBall', p.x, p.y, p.z, B.yaw + (d.flat ? t * 0.8 : 0), 0, 0, d.flat ? 0.6 + 0.4 * clamp01(t / (d.time || 3)) : 1);
  },
  // the toss: the disc spun up off the knuckles, caught, twice
  toss(cast, B, t, d) {
    const beat = 1.25, u = (t % beat) / beat, up = Math.sin(clamp01((u - 0.18) / 0.64) * Math.PI);
    const air = up > 0 ? up * 0.62 : 0, lift = pulse(u, 0.18, 0.02, 0.2) * 0.22;
    const p = at(B, 0, (1.32 + lift * 0.7) * B.s, 0.34, _a);
    for (const i of [0, 1]) { const h = at(B, (i ? -1 : 1) * 0.1, (1.24 + lift) * B.s, 0.32, _b); B.hand(i, h.x, h.y, h.z, 0.85); }
    cast.props.place('doughDisc', p.x, p.y + air, p.z, B.yaw + t * 9, Math.sin(t * 9) * 0.12 * (air > 0 ? 1 : 0), 0, 0.92 + 0.14 * clamp01(t / (d.time || 3)));
    const n = Math.floor(t / beat);
    if (n !== d.beats && u > 0.18) { d.beats = n; cast.sfx('doughSpin', p.x, p.y, p.z); }
  },
  // sauce ladled in a spiral, then cheese let fall from the fingers
  dress(cast, B, t, d) {
    const p = at(B, 0, d.h, 0.5, _a), half = (d.time || 3) / 2, r = 0.04 + 0.09 * clamp01(t / half);
    cast.props.place(t < half * 0.7 ? 'doughDisc' : 'pieRaw', p.x, p.y, p.z, B.yaw);
    const h = at(B, Math.cos(t * 5) * r, d.h + (t < half ? 0.1 : 0.2 + Math.sin(t * 9) * 0.03), 0.5 + Math.sin(t * 5) * r, _b);
    B.hand(1, h.x, h.y, h.z, t < half ? 0.9 : 0.3);
    if (t < half) cast.props.place('ladle', h.x, h.y, h.z, B.yaw + 0.6, 0.9);
    const l = at(B, 0.22, d.h + 0.05, 0.4, _c); B.hand(0, l.x, l.y, l.z, 0.2);
  },
  // the peel in both hands, its blade ahead; d.pie rides on it; d.thrust slides it forward (into the oven)
  peel(cast, B, t, d) {
    const k = d.thrust ? pulse(t, 0.35, 0.2, 0.35) : 0, reach = 0.05 + 0.5 * k;
    const h = at(B, -0.12, (1.02 + (d.lift ?? 0.1)) * B.s, 0.1 + reach, _a);
    cast.props.place('peel', h.x, h.y, h.z, B.yaw, 0.02);
    B.hand(1, h.x, h.y, h.z, 0.9);
    const l = at(B, -0.02, (1.03 + (d.lift ?? 0.1)) * B.s, 0.42 + reach, _b); B.hand(0, l.x, l.y, l.z, 0.9);
    if (d.pie && !(d.leave && t > 0.5)) { const p = at(B, -0.12, (1.035 + (d.lift ?? 0.1)) * B.s, 0.1 + reach + 0.82, _c); cast.props.place(d.pie, p.x, p.y, p.z, B.yaw); }
  },
  // the wheel run across a pie three times
  cut(cast, B, t, d) {
    const p = at(B, 0, d.h, 0.5, _a);
    cast.props.place(d.pie, p.x, p.y, p.z, B.yaw + Math.floor(t / 0.7) * 1.05);
    const u = (t % 0.7) / 0.7, h = at(B, -0.02, d.h + 0.07, 0.3 + u * 0.42, _b);
    B.hand(1, h.x, h.y, h.z, 0.9); cast.props.place('cutter', h.x, h.y - 0.05, h.z, B.yaw);
    const l = at(B, 0.24, d.h + 0.04, 0.42, _c); B.hand(0, l.x, l.y, l.z, 0.2);
    const n = Math.floor(t / 0.7);
    if (n !== d.cuts) { d.cuts = n; cast.sfx('cutter', p.x, p.y, p.z); }
  },
  // a shaker turned over a slice
  shake(cast, B, t, d) {
    const h = at(B, -0.05, d.h + 0.2 + Math.abs(Math.sin(t * 12)) * 0.03, 0.42, _a);
    B.hand(1, h.x, h.y, h.z, 0.9); cast.props.place(d.name || 'shakerChili', h.x, h.y + 0.05, h.z, B.yaw, 2.6);
  },
  // hands up where a gun can see them (the crowd raises them itself: nothing to add)
  none() {}
};

// What someone carries when no gesture has their hands
const CARRY = {
  tray: GESTURES.carryTray, box: GESTURES.carryTray, plate: GESTURES.carryPlate, bag: GESTURES.carryBag,
  turner: GESTURES.holdTurner,
  mop(cast, B) { const h = at(B, -0.2, 1.05 * B.s, 0.16, _a); cast.props.place('mop', h.x, h.y, h.z, B.yaw, -0.5); B.hand(1, h.x, h.y, h.z, 0.9); },
  peel: GESTURES.peel,
  // a slice in the hand between two bites, a cup or a can in the other
  slice(cast, B, t, d) {
    const h = at(B, -0.15, 1.1 * B.s, 0.26, _a);
    cast.props.place(item(d.tray.slice >= 2 ? `slice${cap(d.tray.flavour)}Hand` : 'sliceBitten', B.street), h.x, h.y, h.z, B.yaw, -0.1);
    B.hand(1, h.x, h.y - 0.01, h.z, 0.7);
  },
  // a stretched disc of dough draped over both hands
  dough(cast, B) {
    const p = at(B, 0, 1.1 * B.s, 0.36, _a);
    cast.props.place('doughDisc', p.x, p.y, p.z, B.yaw);
    for (const i of [0, 1]) { const h = at(B, (i ? -1 : 1) * 0.11, 1.08 * B.s, 0.34, _b); B.hand(i, h.x, h.y, h.z, 0.3); }
  },
  drink(cast, B, t, d) {
    const h = at(B, 0.16, 1.06 * B.s, 0.24, _a);
    cast.props.place(item(d.name, B.street), h.x, h.y - 0.08, h.z, B.yaw); B.hand(0, h.x, h.y, h.z, 0.75);
  }
};

class EateryCast {
  constructor({ game, world, props }) {
    this.game = game; this.world = world; this.props = props;
    this.clock = 0; this.dt = 0;
    this.branches = { bullion: null, tranche: null };
    this.closed = new Map();
    this.saidAt = -100; this.serial = 0;
    this.strays = []; // people gone back to the street with something of ours in their hands
  }

  get pedestrians() { return this.game.traffic.pedestrians; }
  sfx(name, x, y, z, options) { this.game.audio?.eatery?.play?.(name, x, y, z, options); }
  // The player inside this branch hears its people
  say(c, kind, vars = null, force = false) {
    const g = this.game, b = c.branch;
    if (g.eatery?.inside !== b.site || c.gone || c.p.dead) return;
    if (!force && this.clock - this.saidAt < 3.2) return;
    this.saidAt = this.clock;
    let text = pick(BRANDS[b.brand].lines[kind] || ['…']);
    if (vars) for (const [key, value] of Object.entries(vars)) text = text.replace(`{${key}}`, value);
    g.hud.say(c.name, text, 3.2);
  }

  // ---- Places ------------------------------------------------------------------------------------------------------------
  W(b, local) { return eateryPoint(b.site, local.x, local.z); }
  heading(b, face) { return eateryHeading(b.site, face[0], face[1]); }
  localOf(c) { return eateryLocal(c.branch.site, c.p.x, c.p.z); }
  isClosed(site) { return (this.closed.get(site.id) || 0) > this.clock; }

  // ---- People --------------------------------------------------------------------------------------------------------------
  // Takes a pedestrian out of the pool (or `walker`, off the street) and makes it ours
  enlist(b, role, local, { walker = null, face = [0, 1], staff = false, name = '' } = {}) {
    const peds = this.pedestrians.peds, world = this.W(b, local);
    let p = walker;
    if (!p) {
      const fits = (q) => !staff || (q.rig.s > 0.93 && !SUITS.has(q.rig.body));
      p = peds.find((q) => !q.placed && !q.eatery && fits(q));
      if (!p) {
        // the street has them all: one walking far from here, out of sight, is called in
        const g = this.game, cx = g.camera.camera.position.x, cz = g.camera.camera.position.z;
        p = peds.find((q) => q.placed && !q.dead && !q.activity && !q.eatery && !q.conversation && !q.node && (q.x - cx) ** 2 + (q.z - cz) ** 2 > 170 * 170 && fits(q));
        if (!p) return null;
        p.placed = false; p.rig.placed = false;
      }
      if (!this.pedestrians.placeAt(p, world.x, world.z, 70)) return null;
    }
    const c = { p, role, branch: b, staff, name, uniform: staff, script: null, gesture: null, carry: null, seat: null, order: null, till: null, serving: null,
      look: null, gone: false, outside: false, scared: false, id: ++this.serial, body: { hand: (i, x, y, z, grip) => c.body.rig.reachHand(i, x, y, z, grip) } };
    c.act = { kind: 'eatery', phase: 'hold', until: Infinity, x: p.x, z: p.z, heading: this.heading(b, face), moveHeading: this.heading(b, face), carry: -1, seat: null, look: null,
      floor: walker ? undefined : b.floorY, pose: (rig) => this.pose(c, rig), onDone: (ped, cancelled) => this.lost(c, cancelled), owner: c };
    p.activity = c.act; p.eatery = c; p.pose = null;
    p.v = 0; p.pause = 0;
    b.people.push(c);
    return c;
  }

  // The crowd took them back (a panic, a gun pointed at them, a death)
  lost(c, cancelled) {
    if (!cancelled || c.gone) return;
    c.p.activity = c.act; // still ours until they are out of the door (update() lets go of a body that fell)
    this.scare(c);
    c.branch.alarm(false);
  }

  scare(c) {
    if (c.scared || c.gone) return;
    c.scared = true;
    const b = c.branch;
    if (c.seat) { c.seat.by = null; if (c.seat.tray) c.seat.tray.dirty = true; c.seat = null; }
    c.act.seat = null; c.act.carry = -1; c.gesture = null;
    if (c.carry?.tray && c.carry.kind !== 'bag') b.spill(c.p.x, c.p.z);
    c.carry = null;
    if (c.till) { if (c.till.customer === c) c.till.customer = null; c.till = null; }
    const i = b.queue.indexOf(c); if (i >= 0) b.queue.splice(i, 1);
    b.freeSpot(c);
    c.script = c.staff ? this.hide(c) : this.flee(c);
  }

  // Out of the branch for good: back to the street, or out of the world
  release(c, how = 'return') {
    if (c.gone) return;
    c.gone = true;
    const b = c.branch, p = c.p;
    const i = b.people.indexOf(c); if (i >= 0) b.people.splice(i, 1);
    if (c.seat) { c.seat.by = null; c.seat = null; }
    b.freeSpot(c);
    const q = b.queue.indexOf(c); if (q >= 0) b.queue.splice(q, 1);
    for (const till of b.tills) { if (till.customer === c) till.customer = null; if (till.cashier === c) till.cashier = null; }
    p.eatery = null;
    if (p.dead) { if (p.activity === c.act) p.activity = null; return; }
    if (p.activity !== c.act) return;
    c.act.onDone = null;
    if (how === 'vanish' || !p.route) { p.activity = null; p.placed = false; p.rig.placed = false; return; }
    c.act.floor = undefined;
    c.act.pose = null;
    c.act.phase = 'return'; c.act.until = this.pedestrians.clock + 12;
    if (how === 'run') c.act.speed = 3.8;
    // what they leave with stays in their hands for a while
    if (c.carry && (c.carry.kind === 'bag' || c.carry.kind === 'slice' || c.carry.kind === 'box' || c.carry.kind === 'drink')) {
      const stray = { p, c, until: this.clock + 70, next: this.clock + rand(2, 5), bite: null };
      c.outside = true;
      p.pose = (rig) => this.strayPose(stray, rig);
      this.strays.push(stray);
    }
  }

  // Someone back on the sidewalk with a bag, or a slice they finish as they walk
  strayPose(stray, rig) {
    const c = stray.c, B = crowdBody(c, rig);
    B.y = rig.groundY; B.street = true;
    const kind = c.carry.kind;
    if (kind === 'bag') { CARRY.bag(this, B, 0, c.carry); return; }
    if (kind === 'box') { CARRY.box(this, B, 0, { tray: c.carry }); return; }
    if (kind === 'drink') { CARRY.drink(this, B, 0, c.carry); return; }
    const tray = c.carry.tray;
    if (tray.slice <= 0) return;
    if (stray.bite) {
      const t = this.clock - stray.bite.t0;
      GESTURES.nibble(this, B, t, stray.bite);
      if (t > 1.45) { stray.bite = null; tray.slice -= 0.5; stray.next = this.clock + rand(2.5, 5); }
    } else {
      CARRY.slice(this, B, 0, c.carry);
      if (this.clock > stray.next) { const rest = at(B, -0.15, 1.1 * B.s, 0.26, new THREE.Vector3()); stray.bite = { t0: this.clock, rest, slice: true, name: tray.slice >= 2 ? `slice${cap(tray.flavour)}Hand` : 'sliceBitten', sound: 'crunch' }; }
    }
  }

  // The crowd has placed this body: its uniform, what its hands do and hold
  pose(c, rig) {
    const brand = c.branch.brand, props = this.props;
    if (c.uniform) {
      props.wear(`cap-${brand}`, rig, BONE.HEAD);
      props.wear(`apron-${brand}`, rig, BONE.CHEST);
      props.wear(`mark-${brand}`, rig, BONE.CHEST);
      props.wear(`skirt-${brand}`, rig, BONE.PELVIS);
    }
    const B = crowdBody(c, rig), g = c.gesture;
    if (g) GESTURES[g.name]?.(this, B, this.clock - g.t0, g);
    else if (c.carry) CARRY[c.carry.kind]?.(this, B, this.clock, c.carry.kind === 'tray' || c.carry.kind === 'box' || c.carry.kind === 'plate' ? { tray: c.carry } : c.carry);
  }

  // ---- The scripts' steps (generators: one `yield` is one frame) -----------------------------------------------------------
  *wait(c, seconds) { let t = 0; while ((t += this.dt) < seconds) yield; }
  *until(c, test, timeout = 60) { let t = 0; while (!test() && (t += this.dt) < timeout) yield; return test(); }
  *gesture(c, name, seconds, data = {}) { c.gesture = { name, t0: this.clock, time: seconds, ...data }; yield* this.wait(c, seconds); c.gesture = null; }
  *face(c, face, seconds = 0.35) { c.act.heading = Array.isArray(face) ? this.heading(c.branch, face) : face; yield* this.wait(c, seconds); }

  // Along world points; someone in the way is waited for a moment, then walked round
  *walk(c, points, speed = 1.15) {
    const p = c.p, g = this.game;
    for (const to of points) {
      let blocked = 0;
      for (;;) {
        const dx = to.x - p.x, dz = to.z - p.z, d = Math.hypot(dx, dz), step = speed * this.dt;
        if (d <= Math.max(step, 0.03)) { p.x = to.x; p.z = to.z; break; }
        const nx = p.x + dx / d * 0.55, nz = p.z + dz / d * 0.55;
        let stop = g.state === 'onFoot' && Math.hypot(g.player.x - nx, g.player.z - nz) < 0.45;
        if (!stop && blocked < 1.4) for (const o of c.branch.people) { if (o !== c && !o.act.seat && Math.hypot(o.p.x - nx, o.p.z - nz) < 0.36 && o.id < c.id) { stop = true; break; } }
        if (stop && blocked < 2.2) { blocked += this.dt; yield; continue; }
        p.x += dx / d * step; p.z += dz / d * step;
        c.act.heading = c.act.moveHeading = Math.atan2(dx, dz);
        yield;
      }
    }
  }
  // To a spot of the room, along its lines (`staff`: true behind the counter, false in front, null anywhere)
  *go(c, local, staff = c.staff ? true : false, speed = 1.15) {
    const b = c.branch, path = route(b.brand, this.localOf(c), local, staff).map((q) => this.W(b, q));
    yield* this.walk(c, path, speed);
    if (local.face) c.act.heading = this.heading(b, local.face);
  }

  // ---- Customers ---------------------------------------------------------------------------------------------------------
  // In from the sidewalk, through the door
  *enter(c) {
    const b = c.branch, S = SPOTS[b.brand];
    if (c.outside) {
      yield* this.walk(c, [this.W(b, S.out)], 1.25);
      c.outside = false;
      c.act.floor = b.floorY;
    }
  }

  // The queue: a place behind the last, a step forward when the one ahead moves; at its head, the first free till
  *queueUp(c) {
    const b = c.branch, S = SPOTS[b.brand];
    b.queue.push(c);
    let slot = -1, idle = rand(3, 9);
    for (;;) {
      const i = b.queue.indexOf(c);
      if (i < 0) return false;
      if (i === 0) {
        const till = b.tills.find((t) => !t.customer && t.cashier && !t.cashier.scared && !t.cashier.away);
        if (till) {
          till.customer = c; c.till = till; b.queue.shift();
          yield* this.go(c, S.order[till.index]);
          return true;
        }
      }
      const want = Math.min(i, S.queue.length - 1);
      if (want !== slot) { slot = want; c.act.carry = -1; yield* this.go(c, S.queue[slot]); }
      else if ((idle -= this.dt) < 0) { idle = rand(6, 14); c.act.carry = c.act.carry === PROP.PHONE ? -1 : Math.random() < 0.5 ? PROP.PHONE : -1; }
      // the player standing at a till while people wait: someone says so
      const g = this.game;
      if (i === 0 && g.eatery?.atTill && b.queue.length > 1 && this.clock - (b.grumbledAt || -99) > 18) { b.grumbledAt = this.clock; this.say(c, 'queue', null, true); }
      yield;
    }
  }

  *order(c, low = false) {
    const b = c.branch, till = c.till, cashier = till.cashier;
    c.act.carry = -1;
    if (cashier) cashier.serving = c;
    yield* this.gesture(c, 'talk', rand(1.2, 2.4));
    yield* this.gesture(c, low ? 'pointLow' : 'point', 1.2);
    yield* this.wait(c, rand(0.6, 1.6));
    yield* this.gesture(c, 'pay', 1.5, { cash: Math.random() < 0.35 });
    const w = this.W(b, { x: till.x, z: PLANS[b.brand].counter.z ?? PLANS[b.brand].till });
    this.sfx('till', w.x, b.floorY + 1.1, w.z);
    c.order = b.placeOrder(c);
    if (cashier) cashier.serving = null;
    till.customer = null; c.till = null;
  }

  // Off to one side until the number comes up, then to the counter for it
  *collect(c) {
    const b = c.branch, S = SPOTS[b.brand], spot = b.takeSpot(c);
    yield* this.go(c, spot);
    c.act.heading = this.heading(b, spot.face);
    if (Math.random() < 0.45) c.act.carry = PROP.PHONE;
    const ok = yield* this.until(c, () => c.order.state === 'ready', 120);
    c.act.carry = -1;
    b.freeSpot(c);
    if (!ok) return false;
    const at = b.brand === 'bullion' ? { x: S.pickup.x + (c.order.slot - 1) * 0.5, z: S.pickup.z, face: S.pickup.face } : S.pickup;
    yield* this.go(c, at);
    yield* this.face(c, at.face, 0.3);
    yield* this.gesture(c, 'take', 0.8, { tray: c.order.tray });
    c.order.state = 'taken';
    c.carry = c.order.tray;
    return true;
  }

  // A seat for one: with company where a booth or a table already has some, else alone
  reserve(c) {
    const b = c.branch, free = b.seats.filter((s) => !s.by && !s.tray && !s.held);
    if (!free.length) return null;
    const score = (s) => {
      const mates = b.seats.filter((o) => o !== s && o.seat.group === s.seat.group && o.by).length;
      return (s.seat.kind === 'stand' ? 0.3 : 1) * (mates === 0 ? 1.3 : mates === 1 ? 1 : 0.6) * (0.6 + Math.random() * 0.8);
    };
    const slot = free.sort((x, y) => score(y) - score(x))[0];
    slot.by = c; c.seat = slot;
    return slot;
  }

  *sitDown(c, slot) {
    const b = c.branch, seat = slot.seat;
    yield* this.go(c, seat.from);
    yield* this.walk(c, [this.W(b, seat)], 0.8);
    const yaw = this.heading(b, seat.face);
    c.act.heading = yaw;
    // the tray goes on the table, then they sit
    if (c.carry) { slot.tray = c.carry; slot.tray.dirty = false; c.carry = null; const w = this.W(b, seat.tray); this.sfx('trayDown', w.x, b.floorY + seat.tray.h, w.z); }
    if (seat.kind !== 'stand') {
      const w = this.W(b, seat);
      c.act.seat = { x: w.x, z: w.z, yaw, y: b.floorY, pose: seatPose(seat) };
      if (seat.kind === 'chair') this.sfx('chair', w.x, b.floorY, w.z, { intensity: 0.5 });
    }
    yield* this.wait(c, 0.6);
  }

  *getUp(c, slot) {
    const b = c.branch;
    c.act.seat = null;
    yield* this.walk(c, [this.W(b, slot.seat.from)], 0.8);
  }

  // Where the food rests in front of someone at their seat (world)
  restOf(b, slot, lx = 0) {
    const w = this.W(b, slot.seat.tray), yaw = this.heading(b, slot.seat.face);
    return new THREE.Vector3(w.x + Math.cos(yaw) * lx, b.floorY + slot.seat.tray.h + 0.03, w.z - Math.sin(yaw) * lx);
  }

  // A meal on a tray: the burger in both hands, fries one by one, a pull at the straw, chewing and looking around between
  *eatMeal(c, slot) {
    const b = c.branch, tray = slot.tray;
    let bites = tray.tall ? 6 : 5, fries = tray.fries ? 4 : 0, sips = tray.cup ? 3 : 0;
    while (bites + fries + sips > 0 && !c.scared) {
      c.act.carry = -1;
      if (Math.random() < 0.3) { c.act.carry = PROP.PHONE; yield* this.wait(c, rand(3, 7)); c.act.carry = -1; }
      else yield* this.wait(c, rand(1.8, 4.6));
      const r = Math.random() * (bites * 1.4 + fries + sips);
      if (r < bites * 1.4) {
        tray.lifted = 'burger';
        yield* this.gesture(c, 'bite', 1.6, { rest: this.restOf(b, slot, 0.09), name: tray.burger >= 2 && bites > 3 ? (tray.tall ? 'burgerTall' : 'burger') : 'burgerHalf' });
        bites--; tray.burger = bites > 2 ? 2 : bites > 0 ? 1 : 0; tray.lifted = null;
      } else if (r < bites * 1.4 + fries) {
        yield* this.gesture(c, 'nibble', 1.3, { rest: this.restOf(b, slot, -0.08), sound: Math.random() < 0.5 ? 'chew' : null });
        fries--; tray.fries = fries > 2 ? 2 : fries > 0 ? 1 : 0;
      } else {
        tray.lifted = 'cup';
        yield* this.gesture(c, 'nibble', 1.9, { rest: this.restOf(b, slot, -0.13).setY(b.floorY + slot.seat.tray.h + 0.14), name: 'cup', left: true, hold: 0.9, tall: 0.13, sound: sips === 1 ? 'slurp' : null });
        sips--; tray.lifted = null;
      }
    }
    yield* this.wait(c, rand(2, 6));
  }

  // A slice on its plate: sometimes a shake of chili first, then five bites, the last ones off a shorter slice
  *eatSlice(c, slot) {
    const b = c.branch, tray = slot.tray, h = b.floorY + slot.seat.tray.h;
    if (Math.random() < 0.3) yield* this.gesture(c, 'shake', 1.3, { h, name: pick(['shakerChili', 'shakerOregano', 'shakerCheese']) });
    let bites = 5;
    while (bites > 0 && !c.scared) {
      yield* this.wait(c, rand(1.6, 4));
      tray.lifted = 'slice';
      yield* this.gesture(c, 'nibble', 1.5, { rest: this.restOf(b, slot), slice: true, name: bites > 3 ? `slice${cap(tray.flavour)}Hand` : 'sliceBitten', sound: 'crunch' });
      bites--; tray.slice = bites > 3 ? 2 : bites > 0 ? 1 : 0; tray.lifted = bites > 0 && bites <= 3 ? 'slice' : null;
      if (bites > 0 && bites <= 3) tray.held = true;
      if (tray.can && Math.random() < 0.4) { tray.lifted = 'can'; yield* this.gesture(c, 'nibble', 1.7, { rest: this.restOf(b, slot, 0.17).setY(h + 0.1), name: 'can', left: true, hold: 0.8, tall: 0.09, tip: true, sound: 'gulp' }); tray.lifted = tray.held ? 'slice' : null; }
    }
    tray.lifted = null; tray.held = false; tray.slice = 0;
    yield* this.wait(c, rand(1.5, 4));
  }

  // The tray to the bins (or the plate to the can); or left where it is for the crew
  *clear(c, slot) {
    const b = c.branch, S = SPOTS[b.brand];
    if (Math.random() < (b.brand === 'bullion' ? 0.68 : 0.78)) {
      const tray = slot.tray; slot.tray = null;
      c.carry = tray;
      yield* this.go(c, S.trash);
      yield* this.face(c, S.trash.face, 0.3);
      c.carry = null;
      yield* this.gesture(c, 'dump', 1.2, { tray });
      const w = this.W(b, S.trash); this.sfx('trayDump', w.x, b.floorY + 0.9, w.z);
    } else if (slot.tray) slot.tray.dirty = true;
    slot.by = null; c.seat = null;
  }

  *leave(c, how = 'return') {
    const b = c.branch, S = SPOTS[b.brand];
    if (c.seat) { c.seat.by = null; c.seat = null; }
    yield* this.go(c, S.out, false, how === 'run' ? 3.8 : 1.2);
    c.outside = true;
    this.release(c, how);
  }

  // BULLION: board, queue, order, number, (fountain), table, meal, bins, street
  *bullionCustomer(c, from = 'street') {
    const b = c.branch, S = SPOTS.bullion;
    if (from === 'street') {
      yield* this.enter(c);
      if (Math.random() < 0.4) { const spot = pick(S.board); yield* this.go(c, spot); yield* this.face(c, spot.face, 0.3); yield* this.gesture(c, 'none', rand(2, 4.5)); }
    }
    if (from !== 'seated') {
      if (!(yield* this.queueUp(c))) return yield* this.leave(c);
      yield* this.order(c);
      if (!(yield* this.collect(c))) return yield* this.leave(c);
      if (c.carry.kind === 'bag') return yield* this.leave(c);
      if (c.carry.cup && Math.random() < 0.65) {
        yield* this.go(c, S.fountain); yield* this.face(c, S.fountain.face, 0.3);
        const w = this.W(b, S.fountain); this.sfx('soda', w.x, b.floorY + 1.2, w.z - 0.5);
        const tray = c.carry; tray.lifted = 'cup';
        yield* this.gesture(c, 'fill', 2.3, { tray });
        tray.lifted = null;
      }
      const slot = this.reserve(c);
      if (!slot) return yield* this.leave(c);
      yield* this.sitDown(c, slot);
    }
    const slot = c.seat;
    yield* this.eatMeal(c, slot);
    yield* this.getUp(c, slot);
    yield* this.clear(c, slot);
    yield* this.leave(c);
  }

  // TRANCHE: the queue along the display, a slice reheated, the ledge or a table (or the street, eating), the bin
  *trancheCustomer(c, from = 'street') {
    const b = c.branch, S = SPOTS.tranche;
    if (from === 'street') yield* this.enter(c);
    if (from !== 'seated') {
      if (!(yield* this.queueUp(c))) return yield* this.leave(c);
      yield* this.order(c, true);
      if (!(yield* this.collect(c))) return yield* this.leave(c);
      if (Math.random() < 0.22) {
        yield* this.go(c, S.fridge); yield* this.face(c, S.fridge.face, 0.3);
        yield* this.gesture(c, 'grab', 1.0, { h: 1.25, reach: 0.4, tray: c.carry });
        c.carry.can = 1; const w = this.W(b, S.fridge); this.sfx('canOpen', w.x, b.floorY + 1.2, w.z);
      }
      // off down the street with it, folded in one hand
      if (Math.random() < 0.36) { c.carry = { kind: 'slice', tray: c.carry }; return yield* this.leave(c); }
      const slot = this.reserve(c);
      if (!slot) { c.carry = { kind: 'slice', tray: c.carry }; return yield* this.leave(c); }
      yield* this.sitDown(c, slot);
    }
    const slot = c.seat;
    yield* this.eatSlice(c, slot);
    if (slot.seat.kind !== 'stand') yield* this.getUp(c, slot);
    yield* this.clear(c, slot);
    yield* this.leave(c);
  }

  // TRANCHE's hatch on the sidewalk: a slice without going in, eaten on the way
  *windowCustomer(c) {
    const b = c.branch, S = SPOTS.tranche;
    b.hatch.customer = c;
    yield* this.walk(c, [this.W(b, S.window)], 1.2);
    yield* this.face(c, S.window.face, 0.3);
    const server = b.staff.server;
    if (!server || server.scared) { b.hatch.customer = null; return this.release(c); }
    yield* this.gesture(c, 'talk', rand(1, 2));
    c.order = b.placeOrder(c, 'window');
    yield* this.gesture(c, 'pay', 1.4, { cash: true });
    const ok = yield* this.until(c, () => c.order.state === 'ready', 60);
    if (ok) { yield* this.gesture(c, 'take', 0.7, { tray: c.order.tray }); c.order.state = 'taken'; c.carry = { kind: 'slice', tray: c.order.tray }; }
    b.hatch.customer = null;
    this.release(c);
  }

  // Run for the door (after a moment with the hands up, if a gun was on them)
  *flee(c) {
    const b = c.branch, S = SPOTS[b.brand], p = c.p;
    c.act.pose = null;
    while (this.pedestrians.clock < (p.cowerUntil ?? 0)) yield;
    if (c.outside) return this.release(c, 'run');
    yield* this.wait(c, Math.random() * 0.5);
    yield* this.go(c, S.out, false, rand(3.3, 4.2));
    c.outside = true;
    this.release(c, 'run');
  }

  // The crew gets down behind the counter and stays there
  *hide(c) {
    const p = c.p;
    c.serving = null;
    for (;;) {
      p.heldUp = !!c.held;
      p.cowerUntil = this.pedestrians.clock + 1.5;
      if (!c.branch.alarmed && !c.held) break;
      yield;
    }
    c.scared = false;
  }

  // ---- BULLION's crew ----------------------------------------------------------------------------------------------------
  *cashier(c, index) {
    const b = c.branch, home = SPOTS.bullion.cashiers[index], faceOut = this.heading(b, home.face);
    for (;;) {
      if (c.serving) {
        c.gesture = { name: 'type', t0: this.clock };
        while (c.serving && !c.scared) {
          const who = c.serving === 'player' ? this.game.player : c.serving.p;
          c.act.heading = Math.atan2(who.x - c.p.x, who.z - c.p.z);
          yield;
        }
        c.gesture = null;
      } else {
        c.act.heading = faceOut;
        if (Math.random() < 0.004) yield* this.gesture(c, pick(['tidy', 'type']), rand(1.2, 2.6));
      }
      yield;
    }
  }

  // Orders, one after the other: burgers from the chute, fries from their station, the tray to the pickup counter
  *runner(c) {
    const b = c.branch, S = SPOTS.bullion;
    for (;;) {
      const o = b.orders.find((q) => q.state === 'queued');
      if (!o) {
        if (Math.hypot(this.localOf(c).x - S.runner.x, this.localOf(c).z - S.runner.z) > 0.2) yield* this.go(c, S.runner);
        c.act.heading = this.heading(b, S.runner.face);
        if (Math.random() < 0.01) yield* this.gesture(c, 'tidy', rand(1.5, 3));
        yield; continue;
      }
      o.state = 'assembling';
      const tray = o.tray; // filled as it goes
      const want = { burger: tray.burger, fries: tray.fries, cup: tray.cup };
      tray.burger = tray.fries = tray.cup = 0;
      if (tray.kind === 'tray') c.carry = tray;
      yield* this.go(c, { x: -0.95, z: -10.2 });
      yield* this.face(c, [0, -1], 0.25);
      yield* this.until(c, () => b.chute > 0, 25);
      yield* this.gesture(c, 'grab', 0.9, { h: 1.16, reach: 0.34, tray: c.carry });
      b.chute = Math.max(0, b.chute - 1); tray.burger = want.burger; tray.wrapped = true;
      { const w = this.W(b, { x: -0.95, z: -10.6 }); this.sfx('wrap', w.x, b.floorY + 1.1, w.z); }
      if (want.fries) {
        yield* this.go(c, { x: 1.5, z: -10.2 });
        yield* this.face(c, [0, -1], 0.25);
        yield* this.until(c, () => b.friesReady > 0, 25);
        yield* this.gesture(c, 'grab', 0.9, { h: 1.05, reach: 0.4, tray: c.carry });
        b.friesReady = Math.max(0, b.friesReady - 1); tray.fries = want.fries;
      }
      tray.cup = want.cup;
      yield* this.go(c, S.handover);
      yield* this.face(c, S.handover.face, 0.25);
      c.carry = null;
      yield* this.gesture(c, 'take', 0.7, { tray: tray.kind === 'tray' ? tray : null });
      b.ready(o);
      this.say(c, 'ready', { n: o.n }, o.by === 'player');
    }
  }

  // The griddle: patties laid, pressed, turned, taken off; every two, a burger dressed and wrapped for the chute
  *grill(c) {
    const b = c.branch, S = SPOTS.bullion, I = PLANS.bullion.island;
    c.carry = { kind: 'turner' };
    let done = 0;
    for (;;) {
      const busy = Math.min(1, b.pending() / 3);
      const now = this.clock, y = b.floorY + I.h + 0.04;
      const world = (s) => { const w = this.W(b, s); return new THREE.Vector3(w.x, y, w.z); };
      const off = b.patties.find((s) => s.state === 'done' && now - s.t > 1.5 + Math.random() * 3);
      const turn = b.patties.find((s) => s.state === 'raw' && now - s.t > 5.5 - busy * 2);
      const cooked = b.patties.find((s) => s.state === 'turned' && now - s.t > 5 - busy * 2);
      const empty = b.patties.filter((s) => s.state === 'empty');
      const active = b.patties.length - empty.length;
      if (cooked) { cooked.state = 'done'; cooked.t = now; }
      if (off && b.chute < 6) {
        yield* this.gesture(c, 'turner', 0.9, { to: world(off) });
        off.state = 'empty'; done++;
        if (done >= 2) {
          done = 0;
          yield* this.go(c, { x: -1.25, z: -12.1 }); yield* this.face(c, [0, 1], 0.2);
          c.carry = null;
          yield* this.gesture(c, 'assemble', 2.4);
          b.chute = Math.min(6, b.chute + 1);
          { const w = this.W(b, { x: -1.25, z: -11.4 }); this.sfx('wrap', w.x, y, w.z); }
          c.carry = { kind: 'turner' };
          yield* this.go(c, S.grill); yield* this.face(c, S.grill.face, 0.2);
        }
      } else if (turn) {
        yield* this.gesture(c, 'turner', 0.9, { to: world(turn), flip: true });
        turn.state = 'turned'; turn.t = now;
        const w = world(turn); this.sfx('sizzle', w.x, w.y, w.z); b.smoke(w.x, w.y, w.z, 3);
      } else if (empty.length && active < 3 + Math.round(busy * 4)) {
        const s = pick(empty);
        yield* this.gesture(c, 'grab', 0.8, { h: 0.98, reach: 0.3, side: 0.2 });
        s.state = 'raw'; s.t = this.clock;
        const w = world(s); this.sfx('sizzle', w.x, w.y, w.z, { intensity: 1.2 }); b.smoke(w.x, w.y, w.z, 2);
      } else yield* this.wait(c, rand(0.5, 1.6));
      yield;
    }
  }

  // The fryers: a basket down, the timer, the basket up and shaken, tipped out; cartons filled in between
  *fryCook(c) {
    const b = c.branch, P = PLANS.bullion, I = P.island, xs = [P.fryers.x0 + 0.325, P.fryers.x0 + 0.925];
    for (;;) {
      for (let k = 0; k < 2; k++) {
        const basket = b.baskets[k], handle = () => { const w = this.W(b, { x: xs[k], z: I.z - 0.38 }); return new THREE.Vector3(w.x, b.floorY + I.h + 0.2 + (1 - basket.down) * 0.3, w.z); };
        yield* this.go(c, { x: xs[k], z: -12.1 }); yield* this.face(c, [0, 1], 0.2);
        yield* this.gesture(c, 'basket', 0.7, { to: handle() });
        basket.target = 1; basket.t = this.clock;
        { const w = this.W(b, { x: xs[k], z: I.z }); this.sfx('fryerDrop', w.x, b.floorY + I.h, w.z); b.smoke(w.x, b.floorY + I.h + 0.1, w.z, 2, 0.75); }
        // while it fries: cartons
        yield* this.go(c, { x: 1.55, z: -12.1 }); yield* this.face(c, [0, 1], 0.2);
        for (let n = 0; n < 2; n++) { yield* this.gesture(c, 'scoop', 1.9); if (b.friesStock > 0 && b.friesReady < 4) { b.friesStock--; b.friesReady++; } }
        yield* this.until(c, () => this.clock - basket.t > 8 - Math.min(3, b.pending()), 12);
        { const w = this.W(b, { x: xs[k], z: I.z }); this.sfx('fryerBeep', w.x, b.floorY + 1.4, w.z); }
        yield* this.go(c, { x: xs[k], z: -12.1 }); yield* this.face(c, [0, 1], 0.2);
        yield* this.gesture(c, 'basket', 0.7, { to: handle() });
        basket.target = 0; basket.shake = this.clock;
        yield* this.wait(c, 1.1);
        b.friesStock = Math.min(6, b.friesStock + 3);
      }
    }
  }

  // The dining room: trays left behind, spills, a table wiped, the floor mopped behind its yellow sign
  *attendant(c) {
    const b = c.branch, S = SPOTS[b.brand];
    for (;;) {
      const slot = b.seats.find((s) => s.tray?.dirty && !s.by);
      const spill = b.spills[0];
      if (slot) {
        slot.held = true;
        yield* this.go(c, slot.seat.from, null);
        c.act.heading = Math.atan2(this.W(b, slot.seat.tray).x - c.p.x, this.W(b, slot.seat.tray).z - c.p.z);
        yield* this.wait(c, 0.3);
        const tray = slot.tray; slot.tray = null;
        { const w = this.W(b, slot.seat.tray); this.sfx('wipe', w.x, b.floorY + 0.8, w.z); }
        yield* this.gesture(c, 'wipe', 2.4, { h: b.floorY + slot.seat.tray.h });
        slot.held = false;
        if (tray && b.brand === 'bullion') {
          c.carry = { ...tray, burger: 0, fries: tray.fries ? 1 : 0 };
          yield* this.go(c, S.trash, null); yield* this.face(c, S.trash.face, 0.3);
          const t = c.carry; c.carry = null;
          yield* this.gesture(c, 'dump', 1.2, { tray: t });
          const w = this.W(b, S.trash); this.sfx('trayDump', w.x, b.floorY + 0.9, w.z);
        }
      } else if (spill) {
        const l = eateryLocal(b.site, spill.x, spill.z);
        yield* this.go(c, { x: l.x + 0.5, z: l.z + 0.4 }, null);
        c.act.heading = Math.atan2(spill.x - c.p.x, spill.z - c.p.z);
        b.wetSign = { x: spill.x + 0.7, z: spill.z + 0.3, until: this.clock + 40 };
        this.say(c, 'clean');
        this.sfx('mop', spill.x, b.floorY, spill.z);
        yield* this.gesture(c, 'mop', 4.5);
        b.spills.shift();
      } else {
        const r = Math.random();
        if (r < 0.4 && b.brand === 'bullion') {
          // a stretch of the aisle, backwards, a stroke at a time
          const z0 = rand(-6.5, -2.5), x = pick([0.5, -2.6, 2.9]);
          yield* this.go(c, { x, z: z0 }, null);
          c.act.heading = this.heading(b, [0, -1]);
          const w0 = this.W(b, { x: x + 0.6, z: z0 - 0.6 });
          b.wetSign = { x: w0.x, z: w0.z, until: this.clock + 45 };
          this.sfx('mop', c.p.x, b.floorY, c.p.z);
          c.gesture = { name: 'mop', t0: this.clock };
          const to = this.W(b, { x, z: z0 + 2.2 });
          const face = c.act.heading;
          for (let t = 0; t < 9 && !c.scared; t += this.dt) {
            const dx = to.x - c.p.x, dz = to.z - c.p.z, d = Math.hypot(dx, dz);
            if (d > 0.05) { c.p.x += dx / d * 0.22 * this.dt; c.p.z += dz / d * 0.22 * this.dt; }
            c.act.heading = face;
            if (Math.hypot(this.game.player.x - c.p.x, this.game.player.z - c.p.z) < 1.5) this.say(c, 'clean');
            yield;
          }
          c.gesture = null;
        } else if (r < 0.75) {
          const free = b.seats.filter((s) => !s.by && !s.tray && s.seat.kind !== 'stand');
          if (free.length) {
            const s = pick(free);
            yield* this.go(c, s.seat.from, null);
            c.act.heading = Math.atan2(this.W(b, s.seat.tray).x - c.p.x, this.W(b, s.seat.tray).z - c.p.z);
            yield* this.wait(c, 0.3);
            { const w = this.W(b, s.seat.tray); this.sfx('wipe', w.x, b.floorY + 0.8, w.z); }
            yield* this.gesture(c, 'wipe', rand(1.8, 3), { h: b.floorY + s.seat.tray.h });
          }
        } else {
          yield* this.go(c, b.brand === 'bullion' ? { x: 3.0, z: -7.4, face: [-1, 0] } : { x: 1.3, z: -7.6, face: [0, 1] }, null);
          yield* this.wait(c, rand(4, 9));
        }
      }
      yield;
    }
  }

  // ---- TRANCHE's crew ----------------------------------------------------------------------------------------------------
  // Dough pressed, stretched, tossed, dressed; into the oven on the peel; out, cut, into the display
  *pizzaiolo(c) {
    const b = c.branch, S = SPOTS.tranche, P = PLANS.tranche, bench = b.floorY + P.bench.h, prep = b.floorY + P.prep.h;
    for (;;) {
      // a baked pie first: the display must never run dry
      const baked = b.oven.find((o) => o.pie && this.clock - o.t > 22);
      if (baked) {
        const deck = b.oven.indexOf(baked), spot = { x: -1.18, z: P.oven.mouths[deck].z, face: [-1, 0] };
        yield* this.go(c, spot); yield* this.face(c, spot.face, 0.25);
        baked.open = 1; { const w = this.W(b, { x: -1.7, z: spot.z }); this.sfx('ovenDoor', w.x, b.floorY + 1.2, w.z); }
        yield* this.wait(c, 0.4);
        c.carry = null;
        yield* this.gesture(c, 'peel', 1.0, { thrust: true, lift: 0.14 });
        const flavour = baked.pie; baked.pie = null; b.fire = 1;
        c.carry = { kind: 'peel', pie: `pie${cap(flavour)}`, lift: 0.14 };
        baked.open = 0;
        // to the counter by the emptiest stand, the wheel, the stand
        const i = b.pies.reduce((best, q, k) => (q.slices < b.pies[best].slices ? k : best), 0), z = P.display.pies[i];
        yield* this.go(c, { x: -1.05, z, face: [1, 0] }); yield* this.face(c, [1, 0], 0.25);
        c.carry = null;
        yield* this.gesture(c, 'cut', 2.1, { h: b.floorY + P.counter.h + 0.07, pie: `pie${cap(flavour)}` });
        b.pies[i] = { flavour, slices: 8 };
        this.say(c, 'cook');
        continue;
      }
      const deck = b.oven.findIndex((o) => !o.pie);
      if (deck < 0 || b.pies.every((q) => q.slices > 5) && Math.random() < 0.6) {
        // nothing pressing: the bench wiped, a look at the street
        yield* this.go(c, S.dough); yield* this.face(c, S.dough.face, 0.3);
        yield* this.gesture(c, pick(['tidy', 'tidy', 'none']), rand(2, 5));
        continue;
      }
      yield* this.go(c, S.dough); yield* this.face(c, S.dough.face, 0.3);
      { const w = this.W(b, { x: -2.25, z: -0.6 }); this.sfx('doughSlap', w.x, bench, w.z); }
      yield* this.gesture(c, 'knead', 2.6, { h: bench });
      yield* this.gesture(c, 'knead', 2.4, { h: bench, flat: true });
      yield* this.gesture(c, 'toss', 3.75, {});
      { const w = this.W(b, { x: -2.25, z: -0.6 }); this.sfx('doughSlap', w.x, bench, w.z, { intensity: 0.7 }); }
      // dressed on the prep table behind
      c.carry = { kind: 'dough' };
      yield* this.go(c, S.topping); yield* this.face(c, S.topping.face, 0.25);
      c.carry = null;
      const flavour = pick(FLAVOURS);
      yield* this.gesture(c, 'dress', 3.2, { h: prep });
      // into the oven
      c.carry = { kind: 'peel', pie: 'pieRaw', lift: 0.1 };
      const spot = { x: -1.18, z: P.oven.mouths[deck].z, face: [-1, 0] };
      yield* this.go(c, spot); yield* this.face(c, spot.face, 0.25);
      const o = b.oven[deck];
      o.open = 1; { const w = this.W(b, { x: -1.7, z: spot.z }); this.sfx('ovenDoor', w.x, b.floorY + 1.2, w.z); }
      yield* this.wait(c, 0.4);
      c.carry = null;
      { const w = this.W(b, { x: -1.7, z: spot.z }); this.sfx('peel', w.x, b.floorY + 1.2, w.z); }
      yield* this.gesture(c, 'peel', 1.0, { thrust: true, pie: 'pieRaw', leave: true, lift: 0.14 });
      o.pie = flavour; o.t = this.clock; o.open = 0; b.fire = 1;
      this.say(c, 'cook');
    }
  }

  // The till, the display, the oven for a reheat, the pass; the hatch on the sidewalk in between
  *server(c) {
    const b = c.branch, S = SPOTS.tranche, P = PLANS.tranche, till = b.tills[0];
    for (;;) {
      const o = b.orders.find((q) => q.state === 'queued');
      if (!o) {
        // at the till for whoever is there, else at the hatch when someone stands at it, else tidying
        const wantHatch = !!b.hatch.customer && !till.customer;
        const home = wantHatch ? S.hatch : S.cashiers[0];
        if (Math.hypot(this.localOf(c).x - home.x, this.localOf(c).z - home.z) > 0.25) yield* this.go(c, home);
        c.act.heading = this.heading(b, home.face);
        c.away = wantHatch;
        if (c.serving) { c.gesture = { name: 'type', t0: this.clock }; while (c.serving && !c.scared && !b.orders.some((q) => q.state === 'queued')) yield; c.gesture = null; }
        else if (Math.random() < 0.006) yield* this.gesture(c, 'tidy', rand(1.5, 3));
        // a plate left on the ledge: out through the gate for it
        const slot = !till.customer && !b.hatch.customer && this.clock - (c.roundAt || 0) > 25 ? b.seats.find((s) => s.tray?.dirty && !s.by) : null;
        if (slot) {
          c.away = true; c.roundAt = this.clock;
          yield* this.go(c, slot.seat.from, null);
          yield* this.gesture(c, 'wipe', 2, { h: b.floorY + slot.seat.tray.h });
          slot.tray = null;
          yield* this.go(c, S.cashiers[0], null);
          c.away = false;
        }
        yield; continue;
      }
      o.state = 'assembling'; c.away = true;
      const flavour = o.tray.flavour;
      // the slice: from the fullest pie of that kind
      let i = b.pies.findIndex((q) => q.flavour === flavour && q.slices > 0);
      if (i < 0) i = b.pies.findIndex((q) => q.slices > 0);
      if (i < 0) { yield* this.until(c, () => b.pies.some((q) => q.slices > 0), 40); i = Math.max(0, b.pies.findIndex((q) => q.slices > 0)); }
      o.tray.flavour = b.pies[i].flavour;
      yield* this.go(c, { x: -1.05, z: P.display.pies[i], face: [1, 0] }); yield* this.face(c, [1, 0], 0.2);
      yield* this.gesture(c, 'grab', 0.9, { h: 1.14, reach: 0.42, tool: 'spatula' });
      b.pies[i].slices = Math.max(0, b.pies[i].slices - 1);
      c.carry = o.tray;
      // a turn in the oven
      yield* this.go(c, S.reheat); yield* this.face(c, S.reheat.face, 0.2);
      b.oven[0].open = Math.max(b.oven[0].open, 0.7); { const w = this.W(b, { x: -1.7, z: S.reheat.z }); this.sfx('ovenDoor', w.x, b.floorY + 1.2, w.z, { intensity: 0.6 }); }
      c.carry = null;
      yield* this.gesture(c, 'take', 0.7, { tray: o.tray });
      b.oven[0].open = 0; b.fire = Math.max(b.fire, 0.6);
      yield* this.wait(c, o.by === 'player' ? 2.2 : rand(2.4, 4));
      b.oven[0].open = 0.7;
      yield* this.gesture(c, 'take', 0.7, {});
      b.oven[0].open = 0;
      c.carry = o.tray;
      // to whoever waits for it
      const pass = o.at === 'window' ? S.hatch : S.handover;
      yield* this.go(c, pass); yield* this.face(c, pass.face, 0.2);
      c.carry = null;
      yield* this.gesture(c, 'take', 0.7, { tray: o.tray });
      b.ready(o);
      this.say(c, 'ready', null, o.by === 'player');
      c.away = false;
    }
  }

  // ---- The branches ------------------------------------------------------------------------------------------------------
  populate(brand, site, hour) {
    const b = new Branch(this, brand, site);
    this.branches[brand] = b;
    if (this.isClosed(site) || !brandOpenAt(brand, hour)) { b.shut = true; return b; }
    this.crew(b, hour);
    const S = SPOTS[brand], load = crowdAt(brand, hour);
    // the room as it is at this hour: some at table already, some in the queue
    const want = Math.round(MAX_CUSTOMERS[brand] * load);
    for (let k = 0; k < Math.round(want * 0.6); k++) {
      const free = b.seats.filter((s) => !s.by && (brand === 'bullion' ? s.seat.kind !== 'stand' : true));
      if (!free.length) break;
      const slot = pick(free), c = this.enlist(b, 'customer', slot.seat, { face: slot.seat.face });
      if (!c) break;
      slot.by = c; c.seat = slot;
      const yaw = this.heading(b, slot.seat.face), w = this.W(b, slot.seat);
      if (slot.seat.kind !== 'stand') c.act.seat = { x: w.x, z: w.z, yaw, y: b.floorY, pose: seatPose(slot.seat) };
      slot.tray = brand === 'bullion' ? { kind: 'tray', burger: 2, tall: Math.random() < 0.3, fries: Math.random() < 0.8 ? 2 : 0, cup: 1 } : { kind: 'plate', flavour: pick(FLAVOURS), slice: 2, can: Math.random() < 0.3 ? 1 : 0 };
      c.script = brand === 'bullion' ? this.bullionCustomer(c, 'seated') : this.trancheCustomer(c, 'seated');
    }
    for (let k = 0; k < Math.min(Math.round(want * 0.3), S.queue.length - 1); k++) {
      const c = this.enlist(b, 'customer', S.queue[k], { face: S.queue[k].face });
      if (!c) break;
      c.script = brand === 'bullion' ? this.bullionCustomer(c, 'queue') : this.trancheCustomer(c, 'queue');
    }
    return b;
  }

  // Everyone the branch employs who is not at their post is taken on (at the start, and when a post falls empty)
  crew(b, hour) {
    const brand = b.brand, site = b.site, S = SPOTS[brand], load = crowdAt(brand, hour);
    const names = BRANDS[brand].crew, n0 = Math.abs(Math.round(site.x * 3 + site.z * 7)) % names.length;
    const posts = brand === 'bullion' ? [
      ['cashier0', S.cashiers[0], (q) => this.cashier(q, 0), 0], ['cashier1', S.cashiers[1], (q) => this.cashier(q, 1), 1],
      ['runner', S.runner, (q) => this.runner(q)], ['grill', S.grill, (q) => this.grill(q)], ['fry', S.fry, (q) => this.fryCook(q)],
      ['attendant', { x: 3.0, z: -7.4, face: [-1, 0] }, (q) => this.attendant(q)]
    ] : [['server', S.cashiers[0], (q) => this.server(q), 0], ['pizzaiolo', S.dough, (q) => this.pizzaiolo(q)]];
    posts.forEach(([role, spot, script, till], k) => {
      const now = b.staff[role];
      if (now && !now.gone) return;
      if (role === 'cashier1' && load < 0.45) return;
      // someone new only comes in while nobody is looking at the post
      if (now && this.game.eatery?.inside === site) return;
      const c = this.enlist(b, role, spot, { face: spot.face, staff: true, name: names[(n0 + k) % names.length] });
      if (!c) return;
      b.staff[role] = c; c.restart = () => script(c); c.script = c.restart();
      if (till !== undefined) b.tills[till].cashier = c;
    });
  }

  depopulate(brand) {
    const b = this.branches[brand];
    if (!b) return;
    for (const c of [...b.people]) this.release(c, 'vanish');
    this.branches[brand] = null;
  }

  // Someone walking past the door (or the hatch) may come in
  recruit(b, hour) {
    const brand = b.brand, S = SPOTS[brand], peds = this.pedestrians.peds, g = this.game;
    const customers = b.people.filter((c) => !c.staff).length, want = Math.round(MAX_CUSTOMERS[brand] * crowdAt(brand, hour));
    const door = this.W(b, S.out), hatch = brand === 'tranche' && !b.hatch.customer && b.staff.server && Math.random() < 0.35;
    if (customers >= want && !hatch) return;
    if (customers < want && b.queue.length >= S.queue.length - 1) { if (!hatch) return; }
    const pedClock = this.pedestrians.clock;
    for (const p of peds) {
      if (!p.placed || p.dead || p.activity || p.eatery || p.node || p.conversation || p.v < 0.4 || pedClock < (p.panicUntil || 0)) continue;
      const d = Math.hypot(p.x - door.x, p.z - door.z);
      if (d > 7.5 || d < 1.2) continue;
      if (Math.hypot(p.x - g.player.x, p.z - g.player.z) < 1.5) continue;
      const c = this.enlist(b, 'customer', S.out, { walker: p, face: S.out.face });
      if (!c) return;
      c.outside = true;
      if (hatch && customers >= want * 0.5) c.script = this.windowCustomer(c);
      else c.script = brand === 'bullion' ? this.bullionCustomer(c) : this.trancheCustomer(c);
      return;
    }
  }

  /**
   * @param {number} dt
   * @param {number} hour - of the game's day
   */
  update(dt, hour) {
    this.dt = dt; this.clock += dt;
    const g = this.game, world = this.world;
    for (const brand of ['bullion', 'tranche']) {
      const live = world.live[brand], room = live.room && live.distance < 78 ? live.room : null;
      let b = this.branches[brand];
      if (b && (!room || room.site !== b.site)) { if (!room && live.distance < 92 && live.room?.site === b.site) { /* still close: keep them */ } else { this.depopulate(brand); b = null; } }
      if (!b && room) b = this.populate(brand, room.site, hour);
      if (!b) continue;
      // shut after trouble: it opens again once the trouble is over and nobody of ours is left inside
      if (b.shut) {
        if (!this.isClosed(b.site) && brandOpenAt(brand, hour) && g.eatery?.inside !== b.site && b.people.length === 0) { this.depopulate(brand); this.branches[brand] = null; }
        b.update(dt);
        continue;
      }
      if (b.alarmed && !this.isClosed(b.site)) b.alarmed = false;
      for (const c of [...b.people]) {
        const p = c.p;
        if (p.dead || !p.placed || p.activity !== c.act) { this.release(c); continue; }
        if (!c.script) continue;
        // (the crew goes back to work when the fright is over)
        if (c.script.next().done) c.script = c.restart && !c.gone ? c.restart() : null;
        if (!c.script && !c.gone) this.release(c);
      }
      if (dt > 0 && !b.alarmed && this.clock >= b.recruitAt) { b.recruitAt = this.clock + rand(1.2, 3.2); this.crew(b, hour); this.recruit(b, hour); }
      b.update(dt);
    }
    // what left with a customer is forgotten after a while
    for (let i = this.strays.length - 1; i >= 0; i--) {
      const s = this.strays[i];
      if (this.clock > s.until || !s.p.placed || s.p.dead || s.p.eatery) { if (s.p.pose) s.p.pose = null; this.strays.splice(i, 1); }
    }
  }

  // Everyone of ours near a door, for the doors (eatery-room.js)
  people() {
    const list = [];
    for (const brand of ['bullion', 'tranche']) { const b = this.branches[brand]; if (b) for (const c of b.people) list.push(c.p); }
    return list;
  }
}

// One live branch: its people, its seats, its tills and orders, what cooks
class Branch {
  constructor(cast, brand, site) {
    this.cast = cast; this.brand = brand; this.site = site;
    this.floorY = SPECS[brand].floor;
    this.yaw = Math.atan2(site.nx, site.nz);
    this.people = []; this.staff = {}; this.queue = [];
    this.seats = SEATS[brand].map((seat) => ({ seat, by: null, tray: null, held: false }));
    this.tills = SPOTS[brand].cashiers.map((spot, index) => ({ index, x: spot.x, cashier: null, customer: null }));
    this.orders = []; this.number = 12 + Math.floor(Math.random() * 60);
    this.spots = SPOTS[brand].wait.map((spot) => ({ spot, by: null }));
    this.spills = []; this.wetSign = null;
    this.alarmed = false; this.shut = false; this.recruitAt = 0;
    this.fire = 0; this.cooking = 0;
    if (brand === 'bullion') {
      this.patties = [];
      for (const z of [-11.24, -11.44]) for (const x of [-3.5, -3.22, -2.94, -2.66]) this.patties.push({ x, z, state: Math.random() < 0.5 ? 'turned' : 'empty', t: cast.clock - Math.random() * 4 });
      this.baskets = [{ down: 0, target: 0, t: 0, shake: -9 }, { down: 0, target: 0, t: 0, shake: -9 }];
      this.chute = 4; this.friesReady = 3; this.friesStock = 4;
    } else {
      this.pies = PLANS.tranche.display.pies.map((z, i) => ({ flavour: FLAVOURS[i % 3], slices: 3 + Math.floor(Math.random() * 6) }));
      this.oven = [{ pie: Math.random() < 0.5 ? pick(FLAVOURS) : null, t: cast.clock - Math.random() * 15, open: 0, angle: 0 }, { pie: null, t: 0, open: 0, angle: 0 }];
      this.hatch = { customer: null };
    }
  }

  pending() { return this.orders.filter((o) => o.state === 'queued' || o.state === 'assembling').length; }

  // An order goes in: `by` is a person of the cast, or 'player' (with what was bought)
  placeOrder(by, at = 'counter', what = null) {
    let tray;
    if (this.brand === 'bullion') {
      const takeaway = what ? !!what.takeaway : Math.random() < 0.28;
      tray = takeaway ? { kind: 'bag', burger: 2, fries: 0, cup: 0 } : { kind: 'tray', burger: 2, tall: what ? !!what.tall : Math.random() < 0.3, fries: what ? (what.fries ? 2 : 0) : Math.random() < 0.8 ? 2 : 0, cup: what ? (what.cup ? 1 : 0) : 1 };
    } else tray = what?.box ? { kind: 'box' } : { kind: 'plate', flavour: what?.flavour || pick(FLAVOURS), slice: 2, can: 0 };
    const o = { n: this.number = this.number % 99 + 1, by, at, state: 'queued', tray, item: what?.item || null, slot: 0, t: this.cast.clock };
    if (tray.kind === 'box') { o.state = 'ready'; o.readyAt = this.cast.clock; }
    this.orders.push(o);
    return o;
  }

  // On the counter, its number called
  ready(o) {
    const used = this.orders.filter((q) => q.state === 'ready' && q.at === o.at).map((q) => q.slot);
    o.slot = [1, 0, 2, 3].find((k) => !used.includes(k)) ?? 1;
    o.state = 'ready'; o.readyAt = this.cast.clock;
    const S = SPOTS[this.brand], w = this.cast.W(this, S.handover);
    this.cast.sfx(this.brand === 'bullion' ? 'orderUp' : 'trayDown', w.x, this.floorY + 1.3, w.z);
  }

  // Where an order waits on the counter (local x, z and its height above the floor)
  orderPlace(o) {
    if (this.brand === 'bullion') return { x: PLANS.bullion.pickup + (o.slot - 1) * 0.5, z: PLANS.bullion.counter.z + 0.08, h: PLANS.bullion.counter.h };
    const P = PLANS.tranche;
    return o.at === 'window' ? { x: -1.0, z: 0.1, h: P.hatch.h } : { x: 0.04, z: P.pickup, h: P.counter.h };
  }

  takeSpot(c) {
    const free = this.spots.find((s) => !s.by) || pick(this.spots);
    free.by = c;
    return free.spot;
  }
  freeSpot(c) { for (const s of this.spots) if (s.by === c) s.by = null; }

  // A tray dropped: what was on it is on the floor until someone mops
  spill(x, z) {
    if (this.spills.length < 4) this.spills.push({ x, z, yaw: Math.random() * 6 });
    this.cast.sfx('trayDown', x, this.floorY, z, { intensity: 1.4 });
  }

  smoke(x, y, z, n = 2, shade = 0.9) {
    const fx = this.cast.game.fx;
    if (!fx?.smokeParticle) return;
    for (let i = 0; i < n; i++) fx.smokeParticle(x + rand(-0.06, 0.06), y, z + rand(-0.06, 0.06), rand(-0.05, 0.05), rand(0.25, 0.5), rand(-0.05, 0.05), rand(0.16, 0.3), rand(0.9, 1.6), shade, 0.2);
  }

  // Trouble: everybody out or down, the branch shut for a while. `loud`: the crew is scared too.
  alarm(loud = true) {
    const cast = this.cast, first = !this.alarmed;
    this.alarmed = true;
    cast.closed.set(this.site.id, cast.clock + CLOSED_FOR);
    if (!first) return;
    for (const c of [...this.people]) if (loud || !c.staff) cast.scare(c);
    if (!loud) for (const c of this.people) if (c.staff) cast.scare(c);
    for (const o of this.orders) if (o.by !== 'player' && o.state !== 'taken') o.state = 'void';
  }

  update(dt) {
    const cast = this.cast, props = cast.props, site = this.site, live = cast.world.live[this.brand], clock = cast.clock;
    const P = PLANS[this.brand], F = this.floorY;
    const place = (name, lx, h, lz, turn = 0, tip = 0, scale = 1) => { const w = eateryPoint(site, lx, lz); return props.place(name, w.x, F + h, w.z, this.yaw + turn, tip, 0, scale); };
    // trays and plates on the tables; orders waiting on the counter; spills and the yellow sign
    for (const slot of this.seats) if (slot.tray) { const w = eateryPoint(site, slot.seat.tray.x, slot.seat.tray.z); drawTray(props, slot.tray, w.x, F + slot.seat.tray.h + 0.004, w.z, eateryHeading(site, slot.seat.face[0], slot.seat.face[1])); }
    for (let i = this.orders.length - 1; i >= 0; i--) {
      const o = this.orders[i];
      if (o.state === 'taken' || o.state === 'void' || (o.state === 'ready' && o.by !== 'player' && clock - o.readyAt > 150)) { this.orders.splice(i, 1); continue; }
      if (o.state !== 'ready') continue;
      const at = this.orderPlace(o), w = eateryPoint(site, at.x, at.z);
      drawTray(props, o.tray, w.x, F + at.h + 0.004, w.z, this.yaw + (this.brand === 'bullion' ? Math.PI : -Math.PI / 2));
    }
    for (const s of this.spills) props.place('spill', s.x, F + 0.004, s.z, s.yaw);
    if (this.wetSign) { if (clock > this.wetSign.until) this.wetSign = null; else props.place('wetSign', this.wetSign.x, F, this.wetSign.z, this.yaw + 0.4); }
    if (this.brand === 'bullion') {
      const I = P.island, top = I.h;
      for (const s of this.patties) if (s.state !== 'empty') place(s.state === 'raw' ? 'pattyRaw' : 'pattyDone', s.x, top + 0.036, s.z, s.x * 7);
      for (let i = 0; i < this.chute; i++) place('burgerWrapped', P.dress.x0 + 0.26 + i * 0.26, 1.085, I.z + I.depth / 2 + 0.3, 0.3 * i, 0.32);
      for (let i = 0; i < this.friesReady; i++) place('fries', P.fryers.x0 + 1.36 + (i % 2) * 0.24, top + 0.1, I.z + I.depth / 2 - 0.26 - Math.floor(i / 2) * 0.24, 0.2 * i);
      // the baskets on their lifts, shaken as they come up; the oil smokes while one is down
      this.baskets.forEach((basket, k) => {
        basket.down += (basket.target - basket.down) * Math.min(1, dt * 5);
        const holder = live.parts.baskets?.[k];
        if (!holder || live.room?.site !== site) return;
        const shake = clock - basket.shake < 1 ? Math.sin((clock - basket.shake) * 38) * 0.02 * (1 - (clock - basket.shake)) : 0;
        holder.position.y = I.h + 0.34 - basket.down * 0.3 + shake;
        holder.updateMatrixWorld(true);
        if (basket.down > 0.8 && Math.random() < dt * 2.5) { const w = eateryPoint(site, holder.position.x, I.z); this.smoke(w.x, F + I.h + 0.08, w.z, 1, 0.8); }
      });
      const frying = this.baskets.some((q) => q.down > 0.5) ? 1 : 0, searing = this.patties.filter((s) => s.state === 'raw' || s.state === 'turned').length / 5;
      this.cooking += (Math.min(1, 0.25 + frying * 0.4 + searing * 0.5) * (this.staff.grill || this.staff.fry ? 1 : 0) - this.cooking) * Math.min(1, dt * 2);
      // a wisp over the griddle now and then
      if (Math.random() < dt * searing * 3) { const s = pick(this.patties); if (s.state !== 'empty' && s.state !== 'done') { const w = eateryPoint(site, s.x, s.z); this.smoke(w.x, F + top + 0.06, w.z, 1); } }
      // the order screen
      if (live.room?.site === site) cast.world.screen.set(this.orders.filter((o) => o.state === 'queued' || o.state === 'assembling').map((o) => o.n), this.orders.filter((o) => o.state === 'ready').map((o) => o.n));
    } else {
      const C = P.counter;
      this.pies.forEach((pie, i) => { if (pie.slices > 0) place(`pie${cap(pie.flavour)}${pie.slices >= 6 ? '' : 'Part'}`, -0.1, C.h + 0.06, P.display.pies[i], i * 1.3 + (pie.slices % 3) * 0.7); });
      // the oven's doors, the fire behind them
      this.oven.forEach((o, k) => {
        o.angle += (o.open - o.angle) * Math.min(1, dt * 7);
        const door = live.parts.ovenDoors?.[k];
        if (door && live.room?.site === site) { door.rotation.z = -o.angle * 1.35; door.updateMatrixWorld(true); }
      });
      this.fire = Math.max(0, this.fire - dt * 0.5);
      live.fire = Math.max(this.fire, this.oven.some((o) => o.angle > 0.2) ? 0.8 : 0);
      const baking = this.oven.filter((o) => o.pie).length;
      this.cooking += (Math.min(1, 0.35 + baking * 0.25 + this.fire * 0.3) * (this.staff.pizzaiolo ? 1 : 0.4) - this.cooking) * Math.min(1, dt * 2);
    }
  }
}

export { EateryCast, Branch, GESTURES, CARRY, drawTray, crowdAt, seatPose, at as bodyPoint, pulse, MAX_CUSTOMERS, FLAVOURS };
