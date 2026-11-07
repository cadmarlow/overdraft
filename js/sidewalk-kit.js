import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, dFdx, dFdy, float, floor, fract, hash, mix, normalGeometry, positionGeometry, select, smoothstep, step, texture, uv, vec2 } from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';

// The street furniture of a New York sidewalk, built in code at the real sizes of the real things: parking regulation
// signs, the green wire litter baskets, newspaper honor boxes, muni-meters, bike racks and the bikes locked to them,
// LinkNYC kiosks, bus shelters and stop signs, newsstands, benches, subway ventilation grates, standpipes on the
// building fronts, cellar doors, tree guards, sidewalk sheds (scaffolding) with their bracing and string lights, the
// roll-off containers, cones and barriers of a building site, portable toilets, café tables and the roadway dining sheds.
//
// One 2048 px atlas (8 x 8 tiles of 256 px) carries every painted surface: solid swatches, the sign plates, the bus
// flag, a poster, the grate bars, a newsstand front, and the site's materials: painted plywood, raw timber, ribbed
// container steel in three colours, the carting company's name band, the toilet's ribbed plastic, the cone's collars,
// Jersey concrete. Every opaque part draws with one material (painted metal, matte, or a per-instance one) and one call
// per part per cell. Tinted parts map onto the white swatch and take their colour from the instance colour.

const ATLAS = 2048, GRID = 8, TILE = 256, SWATCH = 64; // 8 x 8 tiles of 256 px; tile (0, 0) holds 16 swatches of 64 px
const SW = { white: 0, black: 1, orange: 2, dark: 3, brass: 4, green: 5, rust: 6, light: 7, blue: 8, yellow: 9, red: 10, navy: 11, plywood: 12, busblue: 13, concrete: 14, tan: 15 };
const SWATCH_RGB = ['#ffffff', '#1a1a1c', '#f26d1f', '#3a3d40', '#a0783c', '#2f6b3a', '#8c3b25', '#b8bcc0', '#2f5d9a', '#e8b820', '#c8322a', '#1f3a66', '#2c5a37', '#0b4a9c', '#a8a49c', '#c9b48a'];
const TILES = {
  sign0: [1, 0], sign1: [2, 0], sign2: [3, 0], sign3: [0, 1], busflag: [1, 1], news: [2, 1], meterface: [3, 1], ad: [0, 2], grate: [2, 2], screen: [3, 2], newsstand: [1, 3], plywood: [2, 3],
  // the building site: raw timber, cedar planks, ribbed container steel (rust, green, blue), the carting company's
  // bands, Jersey concrete, the toilet's ribbed plastic and its door in two colours, the cone, rubble in a container
  timber: [4, 0], planks: [5, 0], steelRust: [6, 0], steelGreen: [7, 0], carting: [4, 1], concrete: [5, 1], looWall: [6, 1], looDoor: [7, 1],
  cone: [4, 2], steelBlue: [5, 2], looWall2: [6, 2], looDoor2: [7, 2], debris: [4, 3]
};
// The looks a site part can take, per instance: offsets in tiles from its base tiles (instance attribute `tiles`:
// x, y shift the body's tiles, z, w the name band's; vertex attribute `plate` says which applies)
const SITE = { dumpster: [[0, 0], [1, 0], [-1, 2]], band: [[0, 0], [0, 0.5]], portaloo: [[0, 0], [0, 1]] };

// ---- UV mapping into the atlas ---------------------------------------------------------------------------------------
// Puts a geometry's own 0..1 uvs into an atlas rectangle (x0, y0, w, h in tiles; atlas y up = canvas y down)
function mapUV(g, tx, ty, tw = 1, th = 1) {
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, (tx + a.getX(i) * tw) / GRID, 1 - (ty + th - a.getY(i) * th) / GRID);
  return g;
}
// Each face of a fresh BoxGeometry (+x, -x, +y, -y, +z, -z; four vertices apiece) into its own atlas rectangle
function boxFaces(g, rects) {
  const a = g.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const [tx, ty, tw = 1, th = 1] = rects[f] || rects[rects.length - 1];
    for (let i = f * 4; i < f * 4 + 4; i++) a.setXY(i, (tx + a.getX(i) * tw) / GRID, 1 - (ty + th - a.getY(i) * th) / GRID);
  }
  return g;
}
// Every vertex on one swatch (a solid colour)
function swatch(g, index) {
  const a = g.attributes.uv;
  const u = ((index % 4) + 0.5) * SWATCH / ATLAS, v = 1 - (Math.floor(index / 4) + 0.5) * SWATCH / ATLAS;
  for (let i = 0; i < a.count; i++) a.setXY(i, u, v);
  return g;
}
// Vertex colour white: the atlas (and the instance colour) decide
function white(g) {
  const values = new Float32Array(g.attributes.position.count * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(values, 3));
  return g;
}
// Vertex attribute `plate` of the per-instance materials: 0 keeps the vertex's own tile, 1 shifts it by the instance's
// first offset, 2 by its second
const plated = (g, v) => g.setAttribute('plate', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1));
const box = (w, h, d, x = 0, y = 0, z = 0, sw = SW.white) => white(swatch(new THREE.BoxGeometry(w, h, d).translate(x, y, z), sw));
const cyl = (rt, rb, h, x = 0, y = 0, z = 0, seg = 8, sw = SW.white) => white(swatch(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z), sw));
const tube = (r, ax, ay, az, bx, by, bz, seg = 6, sw = SW.white) => {
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.translate(0, len / 2, 0);
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(ax, ay, az);
  return white(swatch(g, sw));
};
const plane = (w, h, tile, tw = 1, th = 1) => white(mapUV(new THREE.PlaneGeometry(w, h), tile[0], tile[1], tw, th));
function merged(parts) {
  const g = mergeGeometries(parts.filter(Boolean));
  for (const p of parts) if (p) p.dispose();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// ---- The atlas ---------------------------------------------------------------------------------------------------------
// Deterministic noise for the painted tiles: the atlas looks the same on every load
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
const rgba = (hex, a) => `rgba(${channel(hex, 0)},${channel(hex, 1)},${channel(hex, 2)},${a})`;
const mixHex = (a, b, t) => `rgb(${[0, 1, 2].map((i) => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t)).join(',')})`;
// Random flecks over a region of the tile
function speckle(ctx, r, n, colours, alpha, size = 2, y0 = 0, y1 = TILE) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rgba(colours[Math.floor(r() * colours.length)], alpha * (0.5 + r() * 0.5));
    ctx.fillRect(r() * TILE, y0 + r() * (y1 - y0), size * (0.5 + r()), size * (0.5 + r()));
  }
}
// Streaks running down from y0, fading out
function drips(ctx, r, n, hex, y0, alpha, maxLen = 160) {
  for (let i = 0; i < n; i++) {
    const x = r() * TILE, w = 1.5 + r() * 4, h = 20 + r() * (maxLen - 20);
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, rgba(hex, alpha * (0.6 + r() * 0.4)));
    g.addColorStop(1, rgba(hex, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, w, h);
  }
}
// Soft cloudy patches of a colour
function clouds(ctx, r, n, hex, alpha, minR = 14, maxR = 60, y0 = 0, y1 = TILE) {
  for (let i = 0; i < n; i++) {
    const x = r() * TILE, y = y0 + r() * (y1 - y0), rad = minR + r() * (maxR - minR);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, rgba(hex, alpha));
    g.addColorStop(1, rgba(hex, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}
const grime = (ctx, hex, y0, alpha) => {
  const g = ctx.createLinearGradient(0, y0, 0, TILE);
  g.addColorStop(0, rgba(hex, 0));
  g.addColorStop(1, rgba(hex, alpha));
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, TILE, TILE - y0);
};
const fitText = (ctx, text, maxWidth, size, weight, y) => {
  let s = size + 2;
  do { s -= 2; ctx.font = `${weight} ${s}px Inter, Arial, sans-serif`; } while (ctx.measureText(text).width > maxWidth && s > 8);
  ctx.fillText(text, TILE / 2, y);
};

// A sheet of plywood painted hunter green, 2.44 m across and 1.22 m up per tile (the joint with the next sheet along
// the left and the bottom): weathered paint, the grain showing through, nails along the studs, scuffs
function paintPlywood(ctx, r) {
  const base = '#2e5b3b', dark = '#1f4430', light = '#427552';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TILE, TILE);
  clouds(ctx, r, 14, light, 0.35, 16, 60);
  clouds(ctx, r, 12, dark, 0.4, 16, 70);
  for (let i = 0; i < 110; i++) {
    ctx.fillStyle = rgba(r() < 0.5 ? dark : light, 0.1 + r() * 0.14);
    ctx.fillRect(r() * 80 - 40, r() * TILE, 100 + r() * 220, r() < 0.2 ? 2 : 1);
  }
  for (let i = 0; i < 12; i++) {
    ctx.strokeStyle = rgba('#c9d3c4', 0.14 + r() * 0.2);
    ctx.lineWidth = 1 + r();
    const x = r() * TILE, y = r() * TILE;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 70, y + (r() - 0.5) * 24); ctx.stroke();
  }
  clouds(ctx, r, 3, '#9fb3a0', 0.18, 30, 70);
  // nails along the studs every 0.61 m and the plates
  for (let c = 0; c < 5; c++) for (let k = 0; k < 4; k++) {
    const x = (c === 4 ? 249 : 7 + c * 64) + (r() - 0.5) * 2, y = 30 + k * 64 + (r() - 0.5) * 8;
    ctx.fillStyle = rgba('#5a3a22', 0.45); ctx.fillRect(x - 1, y - 1, 4, 7 + r() * 6);
    ctx.fillStyle = '#131a12'; ctx.fillRect(x, y, 2, 2);
  }
  // the joint: a dark gap on the left and along the bottom, the sheet's edge catching light opposite
  ctx.fillStyle = '#0f1b13'; ctx.fillRect(0, 0, 3, TILE); ctx.fillRect(0, TILE - 3, TILE, 3);
  ctx.fillStyle = rgba('#000000', 0.25); ctx.fillRect(3, 0, 2, TILE); ctx.fillRect(0, TILE - 5, TILE, 2);
  ctx.fillStyle = rgba('#9cc4a6', 0.22); ctx.fillRect(TILE - 2, 0, 2, TILE); ctx.fillRect(0, 0, TILE, 2);
}
// Raw spruce: grain along the tile, grey where the weather got to it, a knot or two
function paintTimber(ctx, r) {
  ctx.fillStyle = '#c3a26f';
  ctx.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = rgba(r() < 0.6 ? '#8d6a3e' : '#e4c891', 0.15 + r() * 0.3);
    ctx.fillRect(0, r() * TILE, TILE, r() < 0.3 ? 2 : 1);
  }
  clouds(ctx, r, 8, '#8a8478', 0.3, 20, 60);
  for (const [x, y] of [[70, 150], [200, 60]]) {
    ctx.fillStyle = '#6b4a2a'; ctx.beginPath(); ctx.ellipse(x, y, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = rgba('#5a3b1f', 0.6); ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x, y, 11, 6, 0, 0, Math.PI * 2); ctx.stroke();
  }
}
// Cedar planks across the tile, six to 0.9 m, screwed at both ends, greying towards the ground
function paintPlanks(ctx, r) {
  ctx.fillStyle = '#4e3b2b';
  ctx.fillRect(0, 0, TILE, TILE);
  const tones = ['#a9794a', '#b8865a', '#9c6e41', '#b07d4e', '#a27247', '#bb8b5e'];
  for (let p = 0; p < 6; p++) {
    const y = p * 42.67;
    ctx.fillStyle = tones[p]; ctx.fillRect(0, y + 1, TILE, 40);
    for (let i = 0; i < 14; i++) { ctx.fillStyle = rgba(r() < 0.5 ? '#6e4a2a' : '#d3a26e', 0.18 + r() * 0.2); ctx.fillRect(r() * 40 - 20, y + 3 + r() * 36, 160 + r() * 120, 1); }
    ctx.fillStyle = rgba('#ffffff', 0.12); ctx.fillRect(0, y + 1, TILE, 2);
    ctx.fillStyle = rgba('#000000', 0.3); ctx.fillRect(0, y + 39, TILE, 2);
    for (const x of [22, 234]) { ctx.fillStyle = '#3a3a3a'; ctx.beginPath(); ctx.arc(x, y + 21, 2.2, 0, Math.PI * 2); ctx.fill(); }
  }
  grime(ctx, '#6c655c', 150, 0.45);
}
// Ribbed container steel: 2 m across and 1.5 m up per tile, the top 20 px being the top rail. Five hat-channel ribs
// (a lit flank, a flat crown, a shadowed flank), rust blooming through the paint and dripping from the rail
function paintSteel(ctx, r, base, hi, lo, rust, bloom) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TILE, TILE);
  speckle(ctx, r, 900, [hi, lo], 0.2, 3);
  clouds(ctx, r, 14, bloom, 0.45, 8, 38, 40, 240);
  clouds(ctx, r, 6, lo, 0.35, 20, 60);
  for (let i = 0; i < 5; i++) {
    const x = 18 + i * 51.2;
    ctx.fillStyle = hi; ctx.fillRect(x, 20, 3, TILE - 20);
    ctx.fillStyle = mixHex(base, hi, 0.35); ctx.fillRect(x + 3, 20, 8, TILE - 20);
    ctx.fillStyle = lo; ctx.fillRect(x + 11, 20, 4, TILE - 20);
    ctx.fillStyle = rgba(lo, 0.4); ctx.fillRect(x + 15, 20, 4, TILE - 20);
  }
  drips(ctx, r, 18, rust, 20, 0.55);
  drips(ctx, r, 6, bloom, 20, 0.35, 90);
  for (let i = 0; i < 8; i++) { ctx.fillStyle = rgba(hi, 0.3 + r() * 0.2); ctx.fillRect(r() * TILE, 40 + r() * 180, 14 + r() * 40, 1 + r()); }
  grime(ctx, lo, 196, 0.6);
  // the top rail
  ctx.fillStyle = lo; ctx.fillRect(0, 0, TILE, 20);
  ctx.fillStyle = mixHex(lo, hi, 0.5); ctx.fillRect(0, 2, TILE, 3);
  ctx.fillStyle = rgba('#000000', 0.35); ctx.fillRect(0, 17, TILE, 3);
  speckle(ctx, r, 60, [rust, bloom], 0.5, 3, 0, 20);
}
// The carting company's name, painted on a cream panel: two companies, one per half of the tile
function paintCarting(ctx, r) {
  const band = (y, name, phone, sub, ink, accent) => {
    ctx.fillStyle = '#e8e1d0'; ctx.fillRect(0, y, TILE, 102);
    for (let i = 0; i < 160; i++) { ctx.fillStyle = rgba(r() < 0.5 ? '#b89c7a' : '#8c5a3a', 0.08 + r() * 0.15); ctx.fillRect(r() * TILE, y + r() * 102, 2 + r() * 4, 1 + r() * 2); }
    ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.strokeRect(5, y + 5, TILE - 10, 92);
    ctx.textAlign = 'center';
    ctx.fillStyle = ink; fitText(ctx, name, TILE - 24, 40, 'bold', y + 46);
    ctx.fillStyle = accent; fitText(ctx, phone, TILE - 40, 30, 'bold', y + 78);
    ctx.fillStyle = ink; ctx.font = '11px Inter, Arial, sans-serif'; ctx.fillText(sub, TILE / 2, y + 94);
    for (let i = 0; i < 7; i++) { ctx.fillStyle = rgba('#7a3a1e', 0.2 + r() * 0.3); ctx.fillRect(r() * TILE, y, 2 + r() * 3, 10 + r() * 50); }
  };
  band(0, 'GRÉVILLE CARTING', '212-555-0147', 'CONTAINER SERVICE · DEMOLITION · RUBBISH', '#1b1b1b', '#b8302a');
  band(128, 'BRISANT CONTAINER', '212-555-0163', 'ROLL-OFF 10 · 20 · 30 YD', '#17264a', '#17264a');
}
// Jersey barrier concrete: aggregate, chips, the form line where the slope breaks, road grime and tyre scuffs at the
// foot, the clean top in the first rows
function paintConcrete(ctx, r) {
  ctx.fillStyle = '#b5b2a9';
  ctx.fillRect(0, 0, TILE, TILE);
  speckle(ctx, r, 2600, ['#9c9990', '#cfccc3', '#8a877f', '#dedbd3'], 0.55, 1.6);
  clouds(ctx, r, 8, '#8f8b82', 0.3, 20, 60);
  for (let i = 0; i < 24; i++) {
    const x = r() * TILE, y = 60 + r() * 190;
    ctx.fillStyle = rgba('#6f6c65', 0.55); ctx.beginPath(); ctx.ellipse(x, y, 2 + r() * 5, 1.5 + r() * 3, r() * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba('#d8d5cd', 0.5); ctx.fillRect(x - 2, y - 4, 4, 2);
  }
  ctx.fillStyle = rgba('#7d7a72', 0.5); ctx.fillRect(0, 150, TILE, 2);
  ctx.fillStyle = rgba('#d6d3cb', 0.4); ctx.fillRect(0, 152, TILE, 1);
  drips(ctx, r, 3, '#8a5a3a', 150, 0.35, 70);
  grime(ctx, '#4d4a44', 168, 0.7);
  for (let i = 0; i < 5; i++) { ctx.fillStyle = rgba('#1e1d1b', 0.25 + r() * 0.3); ctx.fillRect(r() * TILE, 200 + r() * 40, 20 + r() * 50, 3 + r() * 6); }
  ctx.fillStyle = rgba('#c9c6be', 0.6); ctx.fillRect(0, 0, TILE, 12);
}
// A traffic cone from tip (top) to foot (bottom): faded orange, two reflective collars, road grime at the base
function paintCone(ctx, r) {
  ctx.fillStyle = '#ef6a1f';
  ctx.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < 40; i++) { ctx.fillStyle = rgba(r() < 0.5 ? '#f58a45' : '#c9521a', 0.15 + r() * 0.2); ctx.fillRect(r() * TILE, r() * TILE, 2 + r() * 4, 10 + r() * 60); }
  const collar = (y0, y1) => {
    ctx.fillStyle = '#ececea'; ctx.fillRect(0, y0, TILE, y1 - y0);
    ctx.fillStyle = rgba('#000000', 0.25); ctx.fillRect(0, y0, TILE, 2); ctx.fillRect(0, y1 - 2, TILE, 2);
    ctx.fillStyle = rgba('#ffffff', 0.5); ctx.fillRect(0, y0 + (y1 - y0) * 0.3, TILE, 3);
    speckle(ctx, r, 30, ['#9a9690'], 0.35, 2, y0 + 2, y1 - 2);
  };
  collar(37, 84);
  collar(120, 146);
  ctx.fillStyle = rgba('#000000', 0.2); ctx.fillRect(0, 0, TILE, 6);
  grime(ctx, '#3a2a1e', 200, 0.75);
  speckle(ctx, r, 160, ['#2e2620'], 0.5, 2, 205, TILE);
}
// The toilet's ribbed polyethylene (1.1 m across, 2.1 m up per tile) and its door: a flat panel in a raised frame,
// vent slots, a sticker, the vacant dial and the handle
function paintLooWall(ctx, r, base, hi, lo) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < 20; i++) {
    const x = i * 12.8;
    ctx.fillStyle = rgba(hi, 0.35); ctx.fillRect(x, 0, 3, TILE);
    ctx.fillStyle = rgba(lo, 0.35); ctx.fillRect(x + 9, 0, 3, TILE);
  }
  ctx.fillStyle = rgba(lo, 0.5); ctx.fillRect(0, 0, TILE, 4); ctx.fillRect(0, 236, TILE, 3);
  for (let i = 0; i < 30; i++) { ctx.fillStyle = rgba(r() < 0.5 ? '#ffffff' : '#000000', 0.05 + r() * 0.08); ctx.fillRect(r() * TILE, r() * TILE, 1 + r() * 3, 6 + r() * 40); }
  grime(ctx, '#2a2a26', 212, 0.55);
}
function paintLooDoor(ctx, r, base, hi, lo) {
  paintLooWall(ctx, r, base, hi, lo);
  ctx.fillStyle = mixHex(base, lo, 0.25); ctx.fillRect(26, 8, 204, 236);
  ctx.fillStyle = rgba(hi, 0.5); ctx.fillRect(26, 8, 204, 3); ctx.fillRect(26, 8, 3, 236);
  ctx.fillStyle = rgba(lo, 0.6); ctx.fillRect(26, 241, 204, 3); ctx.fillRect(227, 8, 3, 236);
  ctx.fillStyle = rgba(lo, 0.3); ctx.fillRect(40, 22, 176, 206);
  ctx.fillStyle = '#17201f'; for (let i = 0; i < 4; i++) ctx.fillRect(80, 28 + i * 8, 96, 3);
  ctx.fillStyle = '#eceae4'; ctx.fillRect(96, 62, 64, 32);
  ctx.fillStyle = '#1b1b1b'; ctx.font = 'bold 20px Inter, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('WC', 128, 86);
  ctx.fillStyle = '#d8d8d6'; ctx.beginPath(); ctx.arc(196, 108, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2f9e44'; ctx.beginPath(); ctx.arc(196, 108, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2c2c2c'; ctx.fillRect(190, 118, 12, 40);
  ctx.fillStyle = rgba('#ffffff', 0.25); ctx.fillRect(191, 119, 3, 38);
  grime(ctx, '#2a2a26', 212, 0.4);
}
// Rubble in a container, seen from above: broken drywall, timber, bags, dust
function paintDebris(ctx, r) {
  ctx.fillStyle = '#3b3733';
  ctx.fillRect(0, 0, TILE, TILE);
  const bits = ['#d9d4cb', '#cfc9bf', '#8a6a46', '#6f5133', '#1b1b1d', '#2a2a2c', '#6c6861', '#9a958c', '#b35a2c'];
  for (let i = 0; i < 90; i++) {
    ctx.save();
    ctx.translate(r() * TILE, r() * TILE);
    ctx.rotate(r() * Math.PI);
    const w = 10 + r() * 50, h = 4 + r() * 16;
    ctx.fillStyle = bits[Math.floor(r() * bits.length)]; ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = rgba('#000000', 0.35); ctx.fillRect(-w / 2, h / 2 - 2, w, 2);
    ctx.restore();
  }
  speckle(ctx, r, 600, ['#1e1c1a', '#7a746c'], 0.4, 2);
}

function drawAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  // swatches
  SWATCH_RGB.forEach((hex, i) => { ctx.fillStyle = hex; ctx.fillRect((i % 4) * SWATCH, Math.floor(i / 4) * SWATCH, SWATCH, SWATCH); });
  const tile = (name, draw) => {
    const [tx, ty] = TILES[name];
    ctx.save();
    ctx.translate(tx * TILE, ty * TILE);
    draw(ctx, rng(tx * 131 + ty * 17 + 7));
    ctx.restore();
  };
  const plate = (bg, fg, lines, slash) => (ctx) => {
    ctx.fillStyle = '#4a5750'; ctx.fillRect(0, 0, TILE, TILE); // the strip at the left is the post's grey
    ctx.fillStyle = bg; ctx.fillRect(28, 0, TILE - 28, TILE);
    ctx.strokeStyle = fg; ctx.lineWidth = 5; ctx.strokeRect(34, 6, TILE - 40, TILE - 12);
    ctx.fillStyle = fg; ctx.textAlign = 'center';
    const cx = 28 + (TILE - 28) / 2;
    lines.forEach(([t, size, dy, bold]) => { ctx.font = `${bold ? 'bold ' : ''}${size}px Inter, Arial, sans-serif`; ctx.fillText(t, cx, dy); });
    if (slash) { ctx.strokeStyle = fg; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(cx, 118, 70, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx - 50, 68); ctx.lineTo(cx + 50, 168); ctx.stroke(); }
  };
  tile('sign0', plate('#f5f3ee', '#c8322a', [['NO', 40, 52, true], ['STANDING', 34, 196, true], ['ANYTIME', 22, 232, true]], true));
  tile('sign1', plate('#f5f3ee', '#c8322a', [['NO PARKING', 30, 44, true], ['9:30-11AM', 28, 100, true], ['MON & THURS', 24, 140, true], ['STREET', 20, 190], ['CLEANING', 20, 215]]));
  tile('sign2', plate('#f5f3ee', '#1f6f3a', [['2 HOUR', 40, 70, true], ['PARKING', 34, 120, true], ['8AM-7PM', 24, 170, true], ['EXCEPT SUNDAY', 18, 215]]));
  tile('sign3', plate('#f5f3ee', '#c8322a', [['NO', 40, 52, true], ['STOPPING', 32, 196, true], ['BUS STOP', 24, 232, true]], true));
  tile('busflag', (ctx) => {
    ctx.fillStyle = '#0b4a9c'; ctx.fillRect(0, 0, TILE, TILE * 2);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = 'bold 54px Inter, Arial, sans-serif'; ctx.fillText('BUS', TILE / 2, 90); ctx.fillText('STOP', TILE / 2, 150);
    ctx.fillRect(30, 190, TILE - 60, 4);
    ctx.font = 'bold 40px Inter, Arial, sans-serif'; ctx.fillStyle = '#ffd200'; ctx.fillText('M1 M2 M3', TILE / 2, 260); ctx.fillText('M4 Q32', TILE / 2, 320);
    ctx.fillStyle = '#fff'; ctx.font = '26px Inter, Arial, sans-serif'; ctx.fillText('NO STANDING', TILE / 2, 420); ctx.fillText('BUS STOP', TILE / 2, 460);
  });
  tile('news', (ctx) => {
    ctx.fillStyle = '#e9e4d8'; ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = '#111'; ctx.font = 'italic bold 40px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('The Ledger', TILE / 2, 52);
    ctx.fillStyle = '#333'; for (let i = 0; i < 9; i++) ctx.fillRect(20, 80 + i * 18, TILE - 40 - (i % 3) * 30, 8);
    ctx.fillStyle = '#c8322a'; ctx.font = 'bold 22px Inter, Arial, sans-serif'; ctx.fillText('OVERDRAFT', TILE / 2, TILE - 20);
  });
  tile('meterface', (ctx) => {
    ctx.fillStyle = '#0d1a2a'; ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = '#9fd3ff'; ctx.fillRect(40, 60, TILE - 80, 70);
    ctx.fillStyle = '#1b1b1b'; ctx.font = 'bold 44px monospace'; ctx.textAlign = 'center'; ctx.fillText('PAID', TILE / 2, 112);
    ctx.fillStyle = '#d0d4d8'; for (let i = 0; i < 4; i++) ctx.fillRect(48 + i * 42, 160, 32, 32);
  });
  tile('ad', (ctx) => {
    ctx.fillStyle = '#f4efe6'; ctx.fillRect(0, 0, TILE, TILE * 2);
    ctx.fillStyle = '#d9412f'; ctx.fillRect(0, 0, TILE, 190);
    ctx.fillStyle = '#ffffff'; ctx.font = 'italic bold 52px Inter, Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('VALMONT', TILE / 2, 100); ctx.font = 'bold 24px Inter, Arial, sans-serif'; ctx.fillText('LA NOUVELLE ÉCUME', TILE / 2, 150);
    ctx.fillStyle = '#1b1b1b'; ctx.font = 'bold 34px Inter, Arial, sans-serif'; ctx.fillText('CHAQUE DETTE', TILE / 2, 300); ctx.fillText('SE PAIE.', TILE / 2, 345);
    ctx.fillStyle = '#2d6fb5'; ctx.fillRect(40, 400, TILE - 80, 70); ctx.fillStyle = '#fff'; ctx.font = 'bold 28px Inter, Arial, sans-serif'; ctx.fillText('GRÉVILLE', TILE / 2, 446);
  });
  tile('grate', (ctx) => {
    ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = '#4a4b4d'; for (let i = 0; i < 18; i++) ctx.fillRect(0, i * (TILE / 18), TILE, TILE / 18 * 0.45);
    ctx.fillStyle = '#5a5b5d'; ctx.fillRect(0, 0, 6, TILE); ctx.fillRect(TILE - 6, 0, 6, TILE);
  });
  tile('screen', (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, TILE * 2);
    g.addColorStop(0, '#1b3a6b'); g.addColorStop(0.5, '#2d6fb5'); g.addColorStop(1, '#0d2244');
    ctx.fillStyle = g; ctx.fillRect(0, 0, TILE, TILE * 2);
    ctx.fillStyle = '#e8f1ff'; ctx.font = 'bold 44px Inter, Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('MANHATTAN', TILE / 2, 110); ctx.font = '28px Inter, Arial, sans-serif'; ctx.fillText('WI-FI GRATUIT', TILE / 2, 160);
    ctx.fillStyle = '#ffffff22'; for (let i = 0; i < 6; i++) ctx.fillRect(24, 220 + i * 44, TILE - 48, 26);
    ctx.fillStyle = '#ffd166'; ctx.font = 'bold 36px Inter, Arial, sans-serif'; ctx.fillText('OVERDRAFT', TILE / 2, TILE * 2 - 60);
  });
  tile('newsstand', (ctx) => {
    // racks of magazines: rows of bright covers behind the counter
    ctx.fillStyle = '#1f3a2a'; ctx.fillRect(0, 0, TILE, TILE);
    const hues = ['#d9412f', '#2d6fb5', '#e8b820', '#f0f0f0', '#2f7d4e', '#d98a1f', '#6a3fa0', '#111'];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { ctx.fillStyle = hues[(r * 7 + c * 3) % hues.length]; ctx.fillRect(8 + c * 41, 10 + r * 60, 34, 50); ctx.fillStyle = '#ffffffaa'; ctx.fillRect(12 + c * 41, 14 + r * 60, 26, 8); }
  });
  tile('plywood', paintPlywood);
  tile('timber', paintTimber);
  tile('planks', paintPlanks);
  tile('steelRust', (ctx, r) => paintSteel(ctx, r, '#7c3f2b', '#a9654b', '#4a2416', '#3f1d10', '#b8592a'));
  tile('steelGreen', (ctx, r) => paintSteel(ctx, r, '#2f4a36', '#4b6a50', '#1a2b1f', '#5a3018', '#a0522d'));
  tile('steelBlue', (ctx, r) => paintSteel(ctx, r, '#3d5566', '#5b7686', '#22333e', '#5a3018', '#a0522d'));
  tile('carting', paintCarting);
  tile('concrete', paintConcrete);
  tile('cone', paintCone);
  tile('looWall', (ctx, r) => paintLooWall(ctx, r, '#3f7f79', '#79b3ad', '#24504c'));
  tile('looDoor', (ctx, r) => paintLooDoor(ctx, r, '#3f7f79', '#79b3ad', '#24504c'));
  tile('looWall2', (ctx, r) => paintLooWall(ctx, r, '#5c7489', '#8fa6b8', '#374858'));
  tile('looDoor2', (ctx, r) => paintLooDoor(ctx, r, '#5c7489', '#8fa6b8', '#374858'));
  tile('debris', paintDebris);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function createKitMaterials() {
  const atlas = drawAtlas();
  const painted = new THREE.MeshStandardNodeMaterial({ map: atlas, vertexColors: true, roughness: 0.5, metalness: 0.35 });
  const matte = new THREE.MeshStandardNodeMaterial({ map: atlas, vertexColors: true, roughness: 0.86, metalness: 0.04 });
  // Per-instance tiles (instance attribute `tiles`: two offsets in tiles, x, y and z, w). Vertices of `plate` 1 shift
  // by the first, those of `plate` 2 by the second, `plate` 0 keeps its own tile.
  const shifted = () => {
    const tiles = attribute('tiles', 'vec4');
    const plate = attribute('plate', 'float');
    const offset = mix(tiles.xy, tiles.zw, step(1.5, plate)).mul(step(0.5, plate));
    return vec2(uv().x.add(offset.x.div(GRID)), uv().y.sub(offset.y.div(GRID)));
  };
  // Signs: the two plates pick their design, the post keeps its grey strip whatever the tile
  const sign = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25, side: THREE.DoubleSide });
  sign.colorNode = texture(atlas, shifted()).rgb;
  // The building site: containers and toilets pick their colour and lettering per instance the same way, in rougher paint
  const site = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.12 });
  site.colorNode = texture(atlas, shifted()).rgb;
  // Shed boards are unit cubes scaled per shed (instance attribute `board`: the scale, so the board's size in metres),
  // so the sheets of painted plywood (2.44 x 1.22 m, a joint between each) and the raw timber of the edges are mapped
  // from the position on the board. The faces across the board's thin axis are the painted ones (the deck's top and
  // underside, the parapet's two sides), the rest are edges of raw wood.
  const plywood = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.84, metalness: 0.02 });
  {
    const atlasUV = (tile, f) => vec2(f.x.add(tile[0]).div(GRID), float(1).sub(float(tile[1] + 1).sub(f.y).div(GRID)));
    // sampled with the derivatives of the unwrapped coordinate, so the wrap does not break the mip selection
    const sample = (tile, c) => texture(atlas, atlasUV(tile, fract(c))).grad(dFdx(c.div(GRID)), dFdy(c.div(GRID))).rgb;
    const s = attribute('board', 'vec3');
    const p = positionGeometry.mul(s);
    const an = normalGeometry.abs();
    const faceX = an.x.greaterThan(0.5), faceY = an.y.greaterThan(0.5);
    const thinX = s.x.lessThan(s.y).and(s.x.lessThan(s.z));
    const thinY = s.y.lessThanEqual(s.x).and(s.y.lessThan(s.z));
    const isPainted = select(thinX, faceX, select(thinY, faceY, faceX.or(faceY).not()));
    const onFace = select(faceY, p.xz, select(faceX, p.zy, p.xy));
    const sheet = vec2(onFace.x.div(2.44), onFace.y.div(1.22));
    // most sheets wear the same coat; one in six was replaced and painted fresher
    const h = hash(floor(sheet.x).add(floor(sheet.y).mul(7)).add(s.x.mul(13.7)).add(s.z.mul(3.1)).add(4096));
    const tone = mix(0.9, 1.08, h).add(step(0.84, h).mul(0.25));
    const edge = vec2(onFace.x, onFace.y.mul(3));
    plywood.colorNode = select(isPainted, sample(TILES.plywood, sheet).mul(tone), sample(TILES.timber, edge));
  }
  const glass = new THREE.MeshPhysicalNodeMaterial({ color: 0x9fb4bd, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  glass.envMapIntensity = 1.6;
  // Screens, lamps and lit windows: pale by day, lit after dusk (instance colour sets the warmth)
  const glow = new THREE.MeshBasicNodeMaterial({ vertexColors: true });
  const night = smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow);
  glow.colorNode = texture(atlas, uv()).rgb.mul(mix(0.45, 1.9, night));
  return { painted, matte, sign, site, plywood, glass, glow, atlas };
}

// ---- Parts ---------------------------------------------------------------------------------------------------------------
// { geometry, material, castShadow, colour (default instance colour), far (drawn from afar: 480 m cells), attr }
function createKitParts() {
  const P = {};
  const tinted = (geometry, colour, extra = {}) => ({ geometry, material: 'painted', castShadow: false, colour, ...extra });
  const fixed = (geometry, extra = {}) => ({ geometry, material: 'painted', castShadow: false, colour: 0xffffff, ...extra });
  const mattePart = (geometry, extra = {}) => ({ geometry, material: 'matte', castShadow: false, colour: 0xffffff, ...extra });
  // a part of the building site: per instance, `tiles` picks its colours (see SITE)
  const sitePart = (geometry, extra = {}) => ({ geometry, material: 'site', castShadow: true, colour: 0xffffff, far: true, attr: { name: 'tiles', size: 4 }, ...extra });

  // Parking regulation sign: post 2.9 m + two 0.3 m plates at 2.45 and 2.1 m; uvs of the post inside each tile's grey strip
  {
    const post = new THREE.BoxGeometry(0.06, 2.9, 0.04).translate(0, 1.45, 0);
    const pa = post.attributes.uv; for (let i = 0; i < pa.count; i++) pa.setXY(i, (1 + 0.04) / GRID, 1 - 0.5 / GRID);
    const plateGeo = (y) => { const g = new THREE.PlaneGeometry(0.3, 0.3).translate(0, y, 0.03); const a = g.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, (1 + 0.12 + a.getX(i) * 0.86) / GRID, 1 - (0 + 1 - a.getY(i)) / GRID); return g; };
    const top = plateGeo(2.45), bottom = plateGeo(2.1);
    plated(post, 0); plated(top, 1); plated(bottom, 2);
    P.sign = { geometry: merged([white(post), white(top), white(bottom)]), material: 'sign', castShadow: false, colour: 0xffffff, attr: { name: 'tiles', size: 4 } };
  }
  // The green wire litter basket of every corner (0.84 m tall, 0.6 m across)
  P.basket = tinted(merged([cyl(0.3, 0.27, 0.8, 0, 0.42, 0, 12).rotateY(0.2), cyl(0.31, 0.31, 0.03, 0, 0.83, 0, 12), cyl(0.28, 0.28, 0.03, 0, 0.03, 0, 12), box(0.56, 0.02, 0.02, 0, 0.03, 0), box(0.02, 0.02, 0.56, 0, 0.03, 0)]), 0x2f6b3a);
  // Three newspaper honor boxes side by side, each its own colour, a window of news on the front
  {
    const one = (x, sw) => [box(0.45, 0.92, 0.5, x, 0.6, 0, sw), box(0.47, 0.06, 0.52, x, 1.08, 0, SW.dark), cyl(0.02, 0.02, 0.14, x + 0.18, 0.07, 0.2, 6, SW.dark), cyl(0.02, 0.02, 0.14, x - 0.18, 0.07, 0.2, 6, SW.dark), cyl(0.02, 0.02, 0.14, x + 0.18, 0.07, -0.2, 6, SW.dark), cyl(0.02, 0.02, 0.14, x - 0.18, 0.07, -0.2, 6, SW.dark), plane(0.34, 0.42, TILES.news).translate(x, 0.72, 0.252)];
    P.newsCluster = fixed(merged([...one(-0.52, SW.red), ...one(0, SW.blue), ...one(0.52, SW.yellow)]));
  }
  // Muni-meter: grey post 1.55 m, a tilted head with its screen, a solar panel on top
  P.meter = tinted(merged([cyl(0.07, 0.08, 1.2, 0, 0.6, 0, 8), box(0.34, 0.45, 0.22, 0, 1.42, 0), box(0.3, 0.02, 0.26, 0, 1.67, 0.02).rotateX(-0.25), plane(0.22, 0.26, TILES.meterface).translate(0, 1.44, 0.112)]), 0x8c9094);
  // CityRack hoop: an inverted U of steel, 0.9 m high, 0.8 m across
  P.rack = tinted(merged([tube(0.025, -0.4, 0, 0, -0.4, 0.75, 0, 8), tube(0.025, 0.4, 0, 0, 0.4, 0.75, 0, 8), tube(0.025, -0.4, 0.75, 0, 0.4, 0.75, 0, 8), box(0.12, 0.02, 0.12, -0.4, 0.01, 0), box(0.12, 0.02, 0.12, 0.4, 0.01, 0)]), 0x24282c);
  // A bicycle leaning on it: wheels and tyres black, frame in the instance colour
  {
    const wheel = (z) => white(swatch(new THREE.TorusGeometry(0.33, 0.018, 6, 20).translate(0, 0.33, z), SW.black));
    const rim = (z) => white(swatch(new THREE.TorusGeometry(0.3, 0.008, 4, 18).translate(0, 0.33, z), SW.light));
    P.bike = tinted(merged([
      wheel(0.52), wheel(-0.52), rim(0.52), rim(-0.52),
      tube(0.018, 0, 0.33, -0.52, 0, 0.85, -0.2), tube(0.018, 0, 0.85, -0.2, 0, 0.95, 0.46), tube(0.018, 0, 0.42, -0.1, 0, 0.95, 0.46),
      tube(0.018, 0, 0.42, -0.1, 0, 0.33, -0.52), tube(0.018, 0, 0.95, 0.46, 0, 0.33, 0.52), tube(0.014, -0.22, 1.02, 0.46, 0.22, 1.02, 0.46, 6, SW.black),
      box(0.08, 0.05, 0.24, 0, 0.9, -0.22, SW.black), cyl(0.07, 0.07, 0.02, 0, 0.42, -0.1, 10, SW.dark)
    ]), 0x2e5a9c);
  }
  // LinkNYC: 2.9 m slim black monolith; its screens glow
  P.link = fixed(merged([box(0.86, 2.9, 0.28, 0, 1.45, 0, SW.black), box(0.9, 0.08, 0.32, 0, 2.94, 0, SW.dark)]), { castShadow: true, far: true });
  P.linkScreen = { geometry: merged([plane(0.62, 1.4, TILES.screen, 1, 2).translate(0, 1.85, 0.142), plane(0.62, 1.4, TILES.screen, 1, 2).rotateY(Math.PI).translate(0, 1.85, -0.142)]), material: 'glow', castShadow: false, colour: 0xffffff, far: true };
  // Bus shelter: 4.2 m long, 1.6 m deep, 2.6 m high: steel frame and roof, the ad panel, a bench; glass and lamp apart
  P.shelter = fixed(merged([
    box(0.1, 2.55, 0.1, -2.0, 1.275, -0.7, SW.dark), box(0.1, 2.55, 0.1, 2.0, 1.275, -0.7, SW.dark), box(0.1, 2.55, 0.1, -2.0, 1.275, 0.7, SW.dark), box(0.1, 2.55, 0.1, 2.0, 1.275, 0.7, SW.dark),
    box(4.3, 0.12, 1.75, 0, 2.6, 0, SW.dark), box(4.3, 0.05, 0.08, 0, 2.5, -0.74, SW.dark), box(4.3, 0.05, 0.08, 0, 2.5, 0.74, SW.dark),
    box(1.5, 0.05, 0.34, -1.0, 0.45, -0.46, SW.dark), box(0.05, 0.45, 0.3, -1.7, 0.225, -0.46, SW.dark), box(0.05, 0.45, 0.3, -0.3, 0.225, -0.46, SW.dark),
    box(1.3, 2.0, 0.14, 1.3, 1.25, -0.7, SW.black), plane(1.1, 1.8, TILES.ad, 1, 2).translate(1.3, 1.25, -0.625), plane(1.1, 1.8, TILES.ad, 1, 2).rotateY(Math.PI).translate(1.3, 1.25, -0.775)
  ]), { castShadow: true, far: true });
  P.shelterGlass = { geometry: merged([plane(2.2, 2.3, [0, 0]).translate(-0.9, 1.3, -0.72), plane(1.35, 2.3, [0, 0]).rotateY(Math.PI / 2).translate(-2.0, 1.3, 0), plane(1.35, 2.3, [0, 0]).rotateY(Math.PI / 2).translate(2.0, 1.3, 0)]), material: 'glass', castShadow: false, colour: 0xffffff, far: true };
  P.shelterLamp = { geometry: box(1.6, 0.04, 0.2, -0.6, 2.52, 0), material: 'glow', castShadow: false, colour: 0xfff0c8, far: true };
  // Bus stop: the pole and its blue flag
  P.busStop = fixed(merged([cyl(0.04, 0.045, 3.0, 0, 1.5, 0, 8, SW.dark), plane(0.36, 0.72, TILES.busflag, 1, 2).translate(0, 2.55, 0.05), plane(0.36, 0.72, TILES.busflag, 1, 2).rotateY(Math.PI).translate(0, 2.55, -0.05)]), { far: true });
  // Newsstand: green steel kiosk 3.4 x 1.6 x 2.7 m, magazines behind the counter, an awning, a lit window at night
  P.newsstand = fixed(merged([
    box(3.4, 2.6, 1.6, 0, 1.3, 0, SW.green), box(3.6, 0.12, 1.8, 0, 2.66, 0, SW.dark),
    box(3.6, 0.06, 0.9, 0, 2.3, 1.2, SW.green).rotateX(0.15).translate(0, 0, 0), box(3.0, 0.08, 0.5, 0, 1.0, 0.95, SW.dark),
    plane(2.8, 1.2, TILES.newsstand).translate(0, 1.7, 0.81), box(3.42, 0.3, 0.1, 0, 2.45, 0.78, SW.red)
  ]), { castShadow: true, far: true });
  P.newsstandLight = { geometry: box(2.6, 0.05, 0.08, 0, 2.25, 0.84), material: 'glow', castShadow: false, colour: 0xfff0c8, far: true };
  // CityBench: a backed steel bench 1.8 m long on two cast legs
  P.bench = fixed(merged([box(1.8, 0.05, 0.45, 0, 0.45, 0, SW.dark), box(1.8, 0.4, 0.05, 0, 0.72, -0.22, SW.dark), box(0.06, 0.45, 0.45, -0.8, 0.225, 0, SW.black), box(0.06, 0.45, 0.45, 0.8, 0.225, 0, SW.black), box(1.8, 0.03, 0.04, 0, 0.47, 0.18, SW.light), box(1.8, 0.03, 0.04, 0, 0.47, -0.02, SW.light)]));
  // Subway ventilation grate: a flush slab, bars across
  P.grate = fixed(white(mapUV(new THREE.BoxGeometry(1.4, 0.06, 4.2), TILES.grate[0], TILES.grate[1])));
  // Standpipe (Siamese connection) on a building front, brass
  P.standpipe = fixed(merged([cyl(0.07, 0.07, 0.55, 0, 0.275, 0, 10, SW.brass), cyl(0.065, 0.065, 0.22, -0.13, 0.66, 0.02, 10, SW.brass).rotateZ(0.5), cyl(0.065, 0.065, 0.22, 0.13, 0.66, 0.02, 10, SW.brass).rotateZ(-0.5), cyl(0.085, 0.085, 0.05, -0.2, 0.74, 0.04, 10, SW.brass), cyl(0.085, 0.085, 0.05, 0.2, 0.74, 0.04, 10, SW.brass)]));
  // Cellar doors: two steel leaves flush in the sidewalk
  P.cellar = fixed(merged([box(1.3, 0.05, 2.0, 0, 0, 0, SW.dark), box(0.04, 0.07, 2.0, 0, 0, 0, SW.light), box(1.34, 0.02, 0.1, 0, 0.02, 0.95, SW.light), box(1.34, 0.02, 0.1, 0, 0.02, -0.95, SW.light)]));
  // Tree guard: four low iron rails round the tree pit
  {
    const side = (rot) => merged([tube(0.012, -0.65, 0.52, 0.65, 0.65, 0.52, 0.65, 6), tube(0.012, -0.65, 0.3, 0.65, 0.65, 0.3, 0.65, 6), cyl(0.02, 0.02, 0.58, -0.65, 0.29, 0.65, 6), ...[-0.4, -0.15, 0.1, 0.35].map((u) => cyl(0.008, 0.008, 0.52, u, 0.3, 0.65, 4))]).rotateY(rot);
    P.treeGuard = tinted(merged([side(0), side(Math.PI / 2), side(Math.PI), side(-Math.PI / 2)]), 0x1d2a22);
  }
  // Sidewalk shed bay (instanced along the facade): two posts 3.4 m apart across, the beam between, the X brace to the
  // next bay on the curb side, ledgers along; the deck and parapet boards are unit cubes scaled per shed
  // (kept light: thousands of bays stand within view in Midtown)
  P.shedBay = tinted(merged([
    cyl(0.045, 0.045, 3.75, 0, 1.875, 1.7, 6), cyl(0.045, 0.045, 3.75, 0, 1.875, -1.7, 6),
    tube(0.04, 0, 3.7, 1.7, 0, 3.7, -1.7, 5),
    tube(0.03, 0, 0.3, 1.7, 2.4, 3.5, 1.7, 4), tube(0.03, 0, 3.5, 1.7, 2.4, 0.3, 1.7, 4),
    tube(0.04, 0, 3.7, 1.7, 2.4, 3.7, 1.7, 5)
  ]), 0x3a3d3a, { castShadow: true, far: true });
  // The shed's boards: a unit cube the shed scales into its deck, its parapet and its ends; the plywood material maps
  // the painted sheets and the raw edges from the instance's scale (attribute `board`)
  P.shedBoard = { geometry: box(1, 1, 1, 0, 0.5, 0, SW.plywood), material: 'plywood', castShadow: true, colour: 0xffffff, far: true, attr: { name: 'board', size: 3, scale: true } };
  P.shedLight = { geometry: white(swatch(new THREE.BoxGeometry(0.09, 0.09, 0.09), SW.white)), material: 'glow', castShadow: false, colour: 0xffe9b8, far: true };
  // The building site. The roll-off container: 6 x 2.2 m, 1.6 m to the top rail, walls of ribbed steel in 2 m panels
  // on two floor rails, the rollers at the rear under the swing doors with their hinge posts and locking bars, the
  // hook-lift frame at the front, rubble inside, the carting company's band on both sides. Per instance, `tiles`
  // picks the steel's colour (plate 1) and the company (plate 2); the rest keeps its swatch (plate 0).
  {
    const R = TILES.steelRust;
    const steel = (g, rail = false) => plated(white(mapUV(g, R[0], R[1] + (rail ? 0 : 0.08), 1, rail ? 0.08 : 0.92)), 1);
    const own = (g) => plated(g, 0);
    const parts = [];
    for (const x of [-2, 0, 2]) for (const z of [-1.075, 1.075]) parts.push(steel(new THREE.BoxGeometry(2.0, 1.45, 0.05).translate(x, 0.875, z)));
    for (const x of [-2.975, 2.975]) parts.push(steel(new THREE.BoxGeometry(0.05, 1.45, 2.2).translate(x, 0.875, 0)));
    for (const z of [-1.1, 1.1]) parts.push(steel(new THREE.BoxGeometry(6.1, 0.1, 0.12).translate(0, 1.65, z), true));
    for (const x of [-3.0, 3.0]) parts.push(steel(new THREE.BoxGeometry(0.12, 0.1, 2.32).translate(x, 1.65, 0), true));
    parts.push(own(white(mapUV(new THREE.BoxGeometry(5.9, 0.05, 2.1).translate(0, 1.05, 0), TILES.debris[0], TILES.debris[1]))));
    for (const z of [-0.8, 0.8]) parts.push(own(box(6.0, 0.15, 0.14, 0, 0.075, z, SW.dark)));
    for (const z of [-0.95, 0.95]) parts.push(own(white(swatch(new THREE.CylinderGeometry(0.12, 0.12, 0.18, 6).rotateX(Math.PI / 2).translate(-2.7, 0.13, z), SW.dark))));
    for (const z of [-1.06, 1.06]) parts.push(steel(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 6).translate(-3.03, 0.9, z), true));
    for (const y of [0.55, 1.2]) parts.push(steel(new THREE.BoxGeometry(0.05, 0.06, 2.1).translate(-3.04, y, 0), true));
    for (const z of [-0.45, 0.45]) parts.push(steel(new THREE.BoxGeometry(0.05, 1.35, 0.06).translate(-3.04, 0.9, z), true));
    parts.push(own(tube(0.045, 2.95, 0.15, -0.9, 3.3, 1.45, -0.3, 4, SW.dark)), own(tube(0.045, 2.95, 0.15, 0.9, 3.3, 1.45, 0.3, 4, SW.dark)), own(tube(0.05, 3.3, 1.45, -0.36, 3.3, 1.45, 0.36, 4, SW.dark)));
    for (const s of [1, -1]) parts.push(plated(plane(2.6, 0.95, TILES.carting, 1, 0.4).rotateY(s < 0 ? Math.PI : 0).translate(0.3 * s, 0.9, 1.125 * s), 2));
    P.dumpster = sitePart(merged(parts));
  }
  // A traffic cone: the collars and the grime at its foot painted, a square rubber base
  P.cone = mattePart(merged([white(mapUV(new THREE.CylinderGeometry(0.03, 0.15, 0.7, 10, 1, true).translate(0, 0.35, 0), TILES.cone[0], TILES.cone[1])), box(0.36, 0.03, 0.36, 0, 0.015, 0, SW.black)]));
  // Jersey barrier: the real profile (0.61 m at the foot, 0.81 m high, the slope breaking at 0.33 m) extruded 2 m
  // along x, the concrete tile projected on by face: grime at the foot, the clean rows on top
  {
    const half = [[0.305, 0], [0.305, 0.075], [0.2, 0.33], [0.115, 0.81]];
    const shape = new THREE.Shape();
    [...half, ...half.slice().reverse().map(([w, y]) => [-w, y])].forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 2.0, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-1, 0, 0);
    const pos = g.attributes.position, nor = g.attributes.normal, uvs = g.attributes.uv, T = TILES.concrete;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ny = Math.abs(nor.getY(i)), nx = Math.abs(nor.getX(i));
      let u, v;
      if (ny > 0.7) { u = x / 2 + 0.5; v = 0.955 + (z / 0.3 + 0.5) * 0.04; } else if (nx > 0.7) { u = z / 0.7 + 0.5; v = y / 0.81; } else { u = x / 2 + 0.5; v = y / 0.81; }
      uvs.setXY(i, (T[0] + u) / GRID, 1 - (T[1] + 1 - v) / GRID);
    }
    P.jersey = mattePart(white(g), { far: true });
  }
  // The portable toilet: 1.1 x 1.1 m, 2.2 m to the roof, on a black skid; ribbed plastic with the door on +z, a white
  // translucent roof, the vent stack behind, the handle standing off the door. `tiles` picks the colour (teal or grey-blue).
  {
    const W = TILES.looWall, D = TILES.looDoor;
    const body = plated(white(boxFaces(new THREE.BoxGeometry(1.1, 2.1, 1.1).translate(0, 1.15, 0), [W, W, W, W, D, W])), 1);
    const own = (g) => plated(g, 0);
    P.portaloo = sitePart(merged([
      body, own(box(1.16, 0.1, 1.16, 0, 0.05, 0, SW.black)),
      own(box(1.18, 0.1, 1.18, 0, 2.25, 0, SW.white)), own(box(0.92, 0.08, 0.92, 0, 2.34, 0, SW.light)),
      own(cyl(0.055, 0.055, 0.3, 0.35, 2.45, -0.3, 6, SW.dark)), own(cyl(0.085, 0.085, 0.04, 0.35, 2.61, -0.3, 6, SW.dark)),
      own(box(0.03, 0.17, 0.035, 0.27, 1.07, 0.56, SW.dark))
    ]));
  }
  // Fire alarm box: red post with a lantern head
  P.alarmBox = fixed(merged([cyl(0.05, 0.06, 1.6, 0, 0.8, 0, 8, SW.red), box(0.28, 0.4, 0.2, 0, 1.8, 0, SW.red), cyl(0.06, 0.08, 0.14, 0, 2.07, 0, 8, SW.dark)]));
  // Sidewalk café: a round table under an umbrella, two chairs
  P.cafeSet = mattePart(merged([
    cyl(0.35, 0.35, 0.03, 0, 0.72, 0, 14, SW.dark), cyl(0.02, 0.03, 0.7, 0, 0.36, 0, 8, SW.dark), cyl(0.2, 0.2, 0.02, 0, 0.01, 0, 10, SW.dark),
    cyl(0.015, 0.015, 2.3, 0, 1.15, 0, 6, SW.dark), white(swatch(new THREE.ConeGeometry(0.95, 0.28, 8, 1, true).translate(0, 2.2, 0), SW.tan)),
    box(0.4, 0.03, 0.4, 0.62, 0.45, 0, SW.dark), box(0.4, 0.42, 0.03, 0.62, 0.66, -0.19, SW.dark), box(0.4, 0.03, 0.4, -0.62, 0.45, 0, SW.dark), box(0.4, 0.42, 0.03, -0.62, 0.66, 0.19, SW.dark)
  ]));
  // Roadway dining shed in the parking lane: a timber platform 6 x 2.2 m, cedar plank walls, planters with a hedge on
  // top, a canopy on posts
  {
    const T = TILES.timber, K = TILES.planks;
    const plankBox = (w, h, d, x, y, z) => white(mapUV(new THREE.BoxGeometry(w, h, d).translate(x, y, z), K[0], K[1]));
    P.diningShed = mattePart(merged([
      white(boxFaces(new THREE.BoxGeometry(6.0, 0.25, 2.2).translate(0, 0.125, 0), [T, T, K, K, T, T])),
      plankBox(2.0, 0.9, 0.08, -2, 0.7, 1.06), plankBox(2.0, 0.9, 0.08, 0, 0.7, 1.06), plankBox(2.0, 0.9, 0.08, 2, 0.7, 1.06),
      plankBox(0.08, 0.9, 2.2, -2.96, 0.7, 0), plankBox(0.08, 0.9, 2.2, 2.96, 0.7, 0),
      plankBox(6.0, 0.3, 0.3, 0, 1.3, 1.0), plankBox(0.3, 0.3, 2.0, -2.85, 1.3, 0), plankBox(0.3, 0.3, 2.0, 2.85, 1.3, 0),
      box(5.8, 0.26, 0.26, 0, 1.56, 1.0, SW.green), box(0.26, 0.26, 1.9, -2.85, 1.56, 0, SW.green), box(0.26, 0.26, 1.9, 2.85, 1.56, 0, SW.green),
      cyl(0.04, 0.04, 2.4, -2.9, 1.45, 1.0, 6, SW.dark), cyl(0.04, 0.04, 2.4, 2.9, 1.45, 1.0, 6, SW.dark), cyl(0.04, 0.04, 2.4, -2.9, 1.45, -1.0, 6, SW.dark), cyl(0.04, 0.04, 2.4, 2.9, 1.45, -1.0, 6, SW.dark),
      box(6.3, 0.06, 2.5, 0, 2.66, 0, SW.tan),
      cyl(0.3, 0.3, 0.03, -1.5, 0.98, 0, 10, SW.dark), cyl(0.3, 0.3, 0.03, 1.5, 0.98, 0, 10, SW.dark), cyl(0.02, 0.02, 0.7, -1.5, 0.6, 0, 6, SW.dark), cyl(0.02, 0.02, 0.7, 1.5, 0.6, 0, 6, SW.dark)
    ]), { castShadow: true, far: true });
  }
  P.barrierFence = fixed(merged([tube(0.02, -1.1, 0.05, 0, -1.1, 1.05, 0, 6, SW.light), tube(0.02, 1.1, 0.05, 0, 1.1, 1.05, 0, 6, SW.light), tube(0.02, -1.1, 1.05, 0, 1.1, 1.05, 0, 6, SW.light), tube(0.02, -1.1, 0.12, 0, 1.1, 0.12, 0, 6, SW.light), ...Array.from({ length: 9 }, (_, i) => tube(0.008, -0.9 + i * 0.225, 0.12, 0, -0.9 + i * 0.225, 1.05, 0, 4, SW.light))]));
  for (const p of Object.values(P)) { p.geometry.computeBoundingSphere(); p.geometry.computeBoundingBox(); }
  return P;
}

export { createKitMaterials, createKitParts, TILES, SW, SITE, GRID };
