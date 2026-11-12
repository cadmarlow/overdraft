import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, color, dot, float, mix, normalWorld, positionWorld, pow, smoothstep, texture, uv, varying } from 'three/tsl';
import { cityUniforms, canyonSkyAONode } from './tsl-materials.js';
import { polygonContains } from './building-collision.js';
import { linear, FRAMES } from './building-types.js';
import { nearestRoads } from './city-config.js';
import { frontagePanels, planFrontages, wallPoint } from './frontage-plan.js';
import { createFrontageAtlas, TILE_UV } from './frontage-atlas.js';
import { SHADOW_PROXY_LAYER } from './scene-culling.js';

const PAINTS = [0x4e6252, 0x5b3d32, 0x353c3f, 0x576566, 0x604743, 0x646052, 0x485753, 0x56595d].map(linear);
const BRONZE = linear(0xc0a274), BLACK = linear(0x414340), SILVER = linear(0xb3b5ad), WARM = linear(0xffead3);
const WHITE = [1, 1, 1];
const OFFICE_GLAZING = ['smoked', 'office', 'fluted', 'blinds', 'office', 'smoked', 'fluted'];
const shade = (rgb, amount) => rgb.map(c => c * amount);
const materialTint = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
const GLASS = 1, LIT_GLASS = 2, FIXTURE = 3;
const CELL = 96;
const windowFinish = (family, seed, index) => family === 'lobby' ? OFFICE_GLAZING[(seed + index * 11) % OFFICE_GLAZING.length]
  : (seed + index * 13) % 7 < 3 ? 'blinds' : 'home';

function frontageMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.74, metalness: 0.06 });
  mat.name = 'ManhattanFrontage';
  const atlas = texture(createFrontageAtlas(), uv());
  const fx = varying(attribute('frontageFX', 'float'));
  const glass = smoothstep(0.5, 0.6, fx).mul(float(1).sub(smoothstep(2.5, 2.6, fx)));
  const lit = smoothstep(1.5, 1.6, fx);
  const view = cameraPosition.sub(positionWorld).normalize();
  const grazing = pow(float(1).sub(dot(normalWorld, view).abs().clamp(0, 1)), 2);
  const bounced = view.negate().reflect(normalWorld);
  const reflected = mix(color(0x363b3a), mix(cityUniforms.uSkyHorizonColor, cityUniforms.uSkyTopColor, bounced.y.mul(2).clamp(0, 1)),
    smoothstep(-0.12, 0.25, bounced.y));
  mat.colorNode = mix(atlas.rgb, reflected, glass.mul(grazing.mul(0.63).add(0.09)));
  mat.roughnessNode = mix(float(0.68), float(0.22), glass);
  mat.aoNode = canyonSkyAONode();
  const night = smoothstep(0.60, 1.36, cityUniforms.uInteriorGlow);
  mat.emissiveNode = atlas.rgb.mul(color(0xffd8a5)).mul(night).mul(lit)
    .mul(mix(float(2.4), float(0.68).mul(float(1).sub(grazing.mul(0.75))), glass));
  return mat;
}

// One static indexed batch per district cell, with separate near meshes for small hardware.
function faceWriter(cells, wall, size) {
  const centre = wallPoint(wall, wall.width / 2);
  const key = Math.floor(centre.x / size) + ',' + Math.floor(centre.z / size);
  let b = cells.get(key);
  if (!b) cells.set(key, (b = { positions: [], normals: [], uv: [], colors: [], effects: [], indices: [] }));
  return (points, tile, tint, effect = 0) => {
    const [a, c, d] = points;
    const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const inv = 1 / Math.hypot(nx, ny, nz);
    if (!Number.isFinite(inv)) return;
    const o = b.positions.length / 3;
    const r = Math.round(255 * Math.min(1, tint[0])), g = Math.round(255 * Math.min(1, tint[1])), blue = Math.round(255 * Math.min(1, tint[2]));
    const normalX = (nx * wall.ux + nz * wall.nx) * inv, normalY = ny * inv, normalZ = (nx * wall.uz + nz * wall.nz) * inv;
    const coords = TILE_UV[tile];
    for (let i = 0; i < points.length; i++) {
      const [s, y, depth] = points[i];
      b.positions.push(wall.ax + wall.ux * s + wall.nx * depth, y, wall.az + wall.uz * s + wall.nz * depth);
      b.normals.push(normalX, normalY, normalZ);
      b.uv.push(coords[i][0], coords[i][1]);
      b.colors.push(r, g, blue, 255);
      b.effects.push(effect);
    }
    for (let i = 1; i < points.length - 1; i++) b.indices.push(o, o + i, o + i + 1);
  };
}

function front(face, x0, x1, y0, y1, z, tile, tint, effect) {
  face([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], tile, tint, effect);
}

// Solid trim, omitting the back hidden in the host wall. UVs use the same finish on each cut face.
function block(face, x0, x1, y0, y1, z0, z1, tile, tint, effect) {
  front(face, x0, x1, y0, y1, z1, tile, tint, effect);
  face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], tile, shade(tint, 0.83));
  face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], tile, shade(tint, 0.83));
  face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], tile, tint);
  face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], tile, shade(tint, 0.66));
}

function recess(face, o, tile, tint, ceiling = o.y1) {
  const { lo, hi, y0 } = o, z = -o.recess;
  face([[lo, y0, z], [lo, ceiling, z], [lo, ceiling, 0], [lo, y0, 0]], tile, shade(tint, 0.69));
  face([[hi, y0, 0], [hi, ceiling, 0], [hi, ceiling, z], [hi, y0, z]], tile, shade(tint, 0.69));
  face([[lo, ceiling, z], [hi, ceiling, z], [hi, ceiling, 0], [lo, ceiling, 0]], tile, shade(tint, 0.48));
  face([[lo, y0, 0], [hi, y0, 0], [hi, y0, z], [lo, y0, z]], tile === 'granite' ? 'tile' : 'threshold', shade(tint, 0.87));
}

function arch(face, opening, stone) {
  const { lo, hi, y1 } = opening, middle = (lo + hi) / 2, radius = (hi - lo) / 2;
  const rise = Math.min(radius * 0.64, 0.51), spring = y1 - rise, depth = -opening.recess;
  const arc = (a, extra) => [middle + Math.cos(a) * (radius + extra), spring + Math.sin(a) * (rise + extra)];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI * (1 - i / 10), b = Math.PI * (1 - (i + 1) / 10);
    const [x0, y0] = arc(a, 0), [x1, y2] = arc(b, 0);
    const [ox0, oy0] = arc(a - 0.008, 0.145), [ox1, oy1] = arc(b + 0.008, 0.145);
    // Close the two spandrels, wrap the soffit into the wall and stand individual arch stones in front of the brick.
    const cap = [[x0, y0, 0.001], [x1, y2, 0.001], [x1, y1 + 0.003, 0.001], [x0, y1 + 0.003, 0.001]];
    if (i === 4) cap.splice(2, 1);
    if (i === 5) cap.pop();
    face(cap, 'stone', shade(stone, 0.88));
    face([[x0, y0, depth], [x1, y2, depth], [x1, y2, 0.08], [x0, y0, 0.08]], 'stone', shade(stone, 0.54));
    face([[x0, y0, 0.084], [x1, y2, 0.084], [ox1, oy1, 0.084], [ox0, oy0, 0.084]], 'stone', shade(stone, 0.87 + (i % 4) * 0.07));
    face([[ox0, oy0, 0.084], [ox1, oy1, 0.084], [ox1, oy1, 0], [ox0, oy0, 0]], 'stone', stone);
  }
}

function entry(face, detail, canopyShadow, o, frontage, colors, index) {
  const { lo, hi, y0, y1 } = o;
  const { profile, seed, wall, nearCurb } = frontage;
  const family = profile.family, lobby = family === 'lobby', service = family === 'service', estate = family === 'estate';
  const brownstone = family === 'brownstone';
  const { stone, trim, frame, paint } = colors;
  const width = hi - lo, mid = (lo + hi) / 2;
  const faceDepth = -o.recess + 0.009;
  const tile = lobby || estate ? 'granite' : 'stone';
  recess(face, o, tile, stone);
  const trimWidth = lobby ? 0.11 : service ? 0.095 : family === 'deco' ? 0.22 : 0.145;
  const head = o.arched ? y1 - Math.min(width * 0.32, 0.51) : y1;
  for (const [a, b] of [[lo - trimWidth, lo], [hi, hi + trimWidth]]) {
    block(face, a, b, y0, head, -0.02, 0.09, tile, trim);
    if (!lobby && !service) block(detail, a - 0.027, b + 0.027, y0 + 0.012, y0 + 0.26, -0.015, 0.145, tile, shade(trim, 0.89));
  }
  if (o.arched) arch(face, o, trim);
  else block(face, lo - trimWidth - 0.04, hi + trimWidth + 0.04, y1 - 0.006, y1 + 0.10, -0.02, 0.13, tile, trim);
  const landing = nearCurb ? 0.105 : 0.27;
  block(face, lo - 0.02, hi + 0.02, y0 - 0.047, y0 + 0.033, -o.recess, landing, 'threshold', shade(stone, 0.96));
  const leafFloor = y0 + (brownstone ? 0.16 : 0);
  if (brownstone) {
    block(face, lo, hi, y0 + 0.033, y0 + 0.096, -o.recess, -0.067, 'threshold', stone);
    block(face, lo, hi, y0 + 0.096, leafFloor, -o.recess, -0.227, 'threshold', shade(stone, 0.92));
  }
  if (service) {
    front(face, lo, hi, y0, y1, faceDepth, 'roller', frame);
    block(detail, lo + 0.07, hi - 0.07, y0 + 0.10, y0 + 0.14, faceDepth, faceDepth + 0.033, 'metal', BLACK);
  } else {
    const doorTop = Math.min(head - 0.03, leafFloor + (lobby ? 2.52 : 2.22));
    const two = width > 1.36, outer = 0.058, leafGap = 0.025;
    const hasSidelights = lobby && width > 2.7;
    const leafEdge = hasSidelights ? Math.min(1.08, width * 0.33) : width / 2 - outer;
    const sideLo = mid - leafEdge, sideHi = mid + leafEdge;
    const lit = (seed + index * 17) % 5 !== 0 ? LIT_GLASS : GLASS;
    front(face, lo, hi, leafFloor, y1, faceDepth, lobby ? 'lobby' : estate ? 'wired' : 'home', WHITE, lit);
    if (o.arched) front(face, lo, hi, doorTop + 0.043, y1, faceDepth + 0.005, 'fanlight', WHITE, lit);
    front(face, lo, lo + outer, y0, y1, faceDepth + 0.014, 'metal', frame);
    front(face, hi - outer, hi, y0, y1, faceDepth + 0.014, 'metal', frame);
    const leaves = two ? [[sideLo, mid - leafGap], [mid + leafGap, sideHi]] : [[sideLo, sideHi]];
    for (const [a, b] of leaves) {
      const z = faceDepth + 0.022, finish = lobby ? 'metal' : estate ? 'enamel' : 'timber';
      const wood = lobby || estate ? frame : paint;
      const rail = lobby ? 0.055 : 0.10, kick = lobby ? 0.22 : estate ? 0.44 : 0.78;
      front(face, a, b, leafFloor + 0.033, leafFloor + kick, z, lobby ? 'bronze' : estate ? 'enamel' : 'raised', wood);
      front(face, a, a + rail, leafFloor + kick, doorTop, z, finish, wood);
      front(face, b - rail, b, leafFloor + kick, doorTop, z, finish, wood);
      front(face, a + rail, b - rail, doorTop - 0.13, doorTop, z, finish, wood);
      if (!lobby && !estate && width > 1.15) front(face, (a + b) / 2 - 0.015, (a + b) / 2 + 0.015, leafFloor + kick, doorTop, z + 0.006, finish, wood);
      const handle = a >= mid || !two ? (two ? a + 0.09 : b - 0.13) : b - 0.09;
      block(detail, handle - 0.028, handle + 0.028, leafFloor + 0.94, leafFloor + 1.28, z + 0.008, z + 0.037, 'bronze', lobby ? SILVER : BRONZE);
      block(detail, handle - 0.016, handle + 0.016, leafFloor + 0.98, leafFloor + 1.25, z + 0.043, z + 0.09, 'bronze', lobby ? SILVER : BRONZE);
    }
    front(face, lo, hi, doorTop - 0.015, doorTop + 0.047, faceDepth + 0.043, 'metal', frame);
    if (lobby && hasSidelights) {
      for (const edge of [sideLo, sideHi]) front(face, edge - 0.036, edge + 0.036, y0, y1, faceDepth + 0.026, 'metal', frame);
    }
  }

  const canopy = !o.arched && (lobby || estate || (family === 'deco' && width > 1.85));
  if (canopy) {
    const overhang = nearCurb ? 0.52 : lobby ? 1.04 : 0.67;
    const bounds = [lo - 0.25, hi + 0.25, y1 + 0.032, y1 + 0.169, -0.015, overhang];
    block(face, ...bounds, 'metal', shade(frame, 0.85));
    block(canopyShadow, ...bounds, 'metal', WHITE);
    block(detail, lo - 0.25, hi + 0.25, y1 + 0.13, y1 + 0.153, overhang - 0.03, overhang + 0.014, 'bronze', lobby ? SILVER : BRONZE);
  }
  if (service) return;
  const atRight = (seed & 1) === 0;
  const sign = atRight ? hi + 0.27 : lo - 0.27;
  if (sign < 0.19 || sign > wall.width - 0.19) return;
  block(detail, sign - 0.082, sign + 0.082, y0 + 1.10, y0 + 1.36, -0.005, 0.042, 'intercom', SILVER);
  block(detail, sign - 0.092, sign + 0.092, y0 + 2.14, y0 + 2.40, -0.01, 0.11, 'lamp', WARM, FIXTURE);
  // A small plaque gives the eye a scale reference; numbers are stable and drawn from the facade seed.
  const plate = o.arched ? sign : mid, plateY = o.arched ? y0 + 1.61 : y1 + (canopy ? 0.041 : 0.004);
  const plateZ = canopy ? (nearCurb ? 0.527 : lobby ? 1.047 : 0.677) : o.arched ? 0.042 : 0.138;
  const digits = String(10 + (seed + index * 81) % 580);
  const half = digits.length * 0.039 + 0.024;
  block(detail, plate - half, plate + half, plateY, plateY + 0.12, plateZ - 0.025, plateZ, 'plate', BRONZE);
  for (const [i, digit] of [...digits].entries()) {
    const x = plate + (i - digits.length * 0.5) * 0.078;
    front(detail, x, x + 0.078, plateY + 0.009, plateY + 0.111, plateZ + 0.002, digit, WHITE);
  }
}

function windowBay(face, detail, o, frontage, colors, index) {
  const { lo, hi, y0, y1 } = o;
  const { profile, seed } = frontage, { trim, frame, stone } = colors;
  const lobby = profile.family === 'lobby', utility = profile.family === 'service';
  const width = hi - lo, mid = (lo + hi) / 2, z = -o.recess + 0.006;
  const glass = windowFinish(profile.family, seed, index);
  recess(face, o, lobby ? 'granite' : 'stone', stone);
  const lampOn = glass === 'office' || !lobby && (seed + index) % 5 === 1;
  front(face, lo, hi, y0, y1, z, utility ? 'vent' : glass, utility ? SILVER : WHITE, utility ? 0 : lampOn ? LIT_GLASS : GLASS);
  const lip = lobby ? 0.055 : 0.09;
  block(face, lo - lip, hi + lip, y0 - 0.09, y0 + 0.018, -0.035, lobby ? 0.08 : 0.14, lobby ? 'granite' : 'stone', trim);
  front(face, lo - lip, hi + lip, y1, y1 + (lobby ? 0.055 : 0.09), 0.008, 'stone', trim);
  if (['brownstone', 'stone', 'deco'].includes(profile.family)) {
    front(face, lo - lip, lo, y0, y1, 0.009, 'stone', shade(trim, 0.84));
    front(face, hi, hi + lip, y0, y1, 0.009, 'stone', trim);
  }
  if (utility) return;
  const bar = lobby ? 0.026 : 0.022;
  front(face, mid - bar, mid + bar, y0, y1, z + 0.014, 'metal', frame);
  const transom = lobby ? y1 - 0.54 : (y1 + y0) / 2;
  front(face, lo, hi, transom - bar, transom + bar, z + 0.014, 'metal', frame);
  if (o.grille) {
    // Thin silhouettes leave the glass and its recess visible between the rods.
    const bars = Math.max(3, Math.floor(width / 0.17));
    const top = Math.min(y1 - 0.12, y0 + 1.16), dz = -0.047;
    for (let i = 0; i < bars; i++) {
      const x = lo + (i + 0.5) * width / bars;
      front(detail, x - 0.011, x + 0.011, y0 + 0.07, top, dz, 'metal', BLACK);
      if (bars <= 8 && i % 2 === 0) detail([[x, top - 0.22, dz + 0.001], [x + 0.041, top - 0.14, dz + 0.001],
        [x, top - 0.06, dz + 0.001], [x - 0.041, top - 0.14, dz + 0.001]], 'metal', BLACK);
    }
    for (const y of [y0 + 0.15, top - 0.04]) front(detail, lo, hi, y - 0.016, y + 0.016, dz + 0.008, 'metal', BLACK);
  }
}

function dressFrontage(core, details, shadows, style, plan) {
  const { wall, openings, seed, profile, ceiling } = plan;
  const { bottom, width } = wall;
  if (!openings.length) return;
  const face = faceWriter(core, wall, CELL), detail = faceWriter(details, wall, CELL), shadow = faceWriter(shadows, wall, CELL);
  const lobby = profile.family === 'lobby';
  const trim = style.glass ? materialTint(linear(style.metalColour), linear(0xaaa9a0), 0.54) : linear(style.trim);
  const frame = style.glass ? materialTint(linear(style.metalColour), BLACK, 0.55) : materialTint(linear(FRAMES[style.frame]), BLACK, 0.43);
  const stone = materialTint(trim, linear(0x96908a), 0.23);
  const paint = PAINTS[seed % PAINTS.length];
  const colors = { trim, frame, stone, paint };

  // The continuous water table stops at the thresholds. Split long courses to keep a metre-scale stone finish.
  const baseHeight = lobby ? 0.20 : profile.family === 'estate' ? 0.36 : 0.28;
  let cursor = 0.045;
  for (const next of [...openings.filter(o => o.type === 'entry'), { lo: width - 0.045 }]) {
    const end = next.lo - 0.027;
    const panels = Math.ceil((end - cursor) / 3.3);
    for (let i = 0; i < panels; i++) {
      const a = cursor + (end - cursor) * i / panels, b = cursor + (end - cursor) * (i + 1) / panels;
      if (b - a < 0.09) continue;
      const granite = lobby || profile.family === 'estate' || profile.family === 'deco';
      block(face, a, b - 0.008, bottom - 0.034, bottom + baseHeight, -0.011, 0.034, granite ? 'granite' : 'stone', shade(stone, 0.65 + (i % 5) * 0.045));
    }
    cursor = next.hi + 0.027;
  }
  // A pronounced metal head rail on modern podiums and a lintel line on iron lofts.
  if ((lobby || profile.family === 'iron') && width > 4) {
    block(face, 0.06, width - 0.06, ceiling + 0.065, ceiling + 0.18, -0.02, 0.12, lobby ? 'metal' : 'stone', lobby ? trim : stone);
  }
  for (const [index, opening] of openings.entries()) {
    if (opening.type === 'entry') entry(face, detail, shadow, opening, plan, colors, index);
    else windowBay(face, detail, opening, plan, colors, index);
  }
}

function buildMeshes(group, cells, material, name, { shadowOnly = false, receiveShadow = true } = {}) {
  for (const batch of cells.values()) {
    if (!batch.indices.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    if (!shadowOnly) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uv, 2));
      geometry.setAttribute('color', new THREE.Uint8BufferAttribute(batch.colors, 4, true));
      geometry.setAttribute('frontageFX', new THREE.Float32BufferAttribute(batch.effects, 1));
    }
    geometry.setIndex(batch.indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = receiveShadow && !shadowOnly;
    mesh.castShadow = shadowOnly;
    if (shadowOnly) mesh.layers.set(SHADOW_PROXY_LAYER);
    group.add(mesh);
  }
  cells.clear();
}

function createFrontageBuilder(radius = 155) {
  const low = new Map(), districts = new Map(), active = new Set();
  const group = new THREE.Group();
  group.name = 'ManhattanFrontages';
  const material = frontageMaterial();
  const canopyShadow = new THREE.MeshBasicNodeMaterial();
  function forBuilding(record, walls, neighbours) {
    const isClear = (wall, s, depth) => {
      const { x, z } = wallPoint(wall, s, depth);
      if (record.polygons.some(p => polygonContains(p, x, z))) return false;
      return !neighbours.some(n => n.height > 0 && n.polygons !== record.polygons && x > n.x0 && x < n.x1 && z > n.z0 && z < n.z1 &&
        n.polygons.some(p => polygonContains(p, x, z)));
    };
    const roadDistance = ({ x, z }) => nearestRoads(x, z, 48)[0]?.dist ?? 70;
    const plans = planFrontages(record.style, walls, isClear, roadDistance);
    for (const plan of plans) {
      const { wall, openings, profile } = plan;
      if (!openings.length) continue;
      const centre = wallPoint(wall, wall.width / 2), cx = Math.floor(centre.x / CELL), cz = Math.floor(centre.z / CELL);
      const key = cx + ',' + cz;
      let district = districts.get(key);
      if (!district) districts.set(key, (district = { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL, reach: 0, plans: [], mesh: null }));
      district.reach = Math.max(district.reach, Math.hypot(district.x - centre.x, district.z - centre.z) + wall.width / 2);
      district.plans.push([record.style, plan]);

      // Permanent backs close the holes at all distances, including in the shadow pass. The extra border prevents
      // a view through the wall at a shallow angle. Up close the detailed reveal, leaves and sill hide this plane.
      const face = faceWriter(low, wall, 480);
      for (const [i, o] of openings.entries()) {
        const lobby = profile.family === 'lobby', service = profile.family === 'service';
        const tile = o.type === 'entry' ? service ? 'roller' : lobby ? 'lobby' : 'enamel'
          : service ? 'vent' : windowFinish(profile.family, plan.seed, i);
        const tint = service ? SILVER : o.type === 'entry' && !lobby ? PAINTS[plan.seed % PAINTS.length] : WHITE;
        const pad = o.recess * 1.5;
        const lo = i === 0 ? 0.015 : (openings[i - 1].hi + o.lo) / 2;
        const hi = i === openings.length - 1 ? wall.width - 0.015 : (o.hi + openings[i + 1].lo) / 2;
        front(face, Math.max(lo, o.lo - pad), Math.min(hi, o.hi + pad), Math.max(wall.bottom, o.y0 - pad),
          Math.min(wall.top, o.y1 + pad), -o.recess - 0.018, tile, tint, service || o.type === 'entry' && !lobby ? 0 : GLASS);
      }
    }
    return new Map(plans.map(({ wall, openings }) => [wall, frontagePanels(wall.width, wall.bottom, wall.top, openings)]));
  }
  function finish(parent) {
    buildMeshes(group, low, material, 'FrontageBacks', { receiveShadow: false });
    parent.add(group);
  }
  function buildDistrict(district, d) {
    const core = new Map(), details = new Map(), shadows = new Map();
    const root = new THREE.Group();
    for (const [style, plan] of district.plans) dressFrontage(core, details, shadows, style, plan);
    buildMeshes(root, core, material, 'FrontageMasonry');
    buildMeshes(root, details, material, 'FrontageHardware');
    // The surveyed shell already casts the wall's silhouette. Only the overhanging canopies need additional casters.
    buildMeshes(root, shadows, canopyShadow, 'FrontageCanopyShadow', { shadowOnly: true });
    for (const mesh of root.children) if (mesh.name === 'FrontageHardware') mesh.visible = d < 68;
    group.add(root);
    root.updateMatrixWorld(true);
    district.mesh = root;
    active.add(district);
  }
  const distance = (district, x, y, z) => Math.hypot(Math.max(0, Math.hypot(x - district.x, z - district.z) - district.reach), y);
  let lastX = Infinity, lastY = Infinity, lastZ = Infinity;
  const pending = [];
  function update(position) {
    const { x, y, z } = position;
    const moved = Math.hypot(x - lastX, y - lastY, z - lastZ);
    if (moved >= 12) {
      lastX = x; lastY = y; lastZ = z;
      pending.length = 0;
      for (const district of active) {
        const d = distance(district, x, y, z);
        if (d > radius + 230) {
          district.mesh.removeFromParent();
          for (const mesh of district.mesh.children) mesh.geometry.dispose();
          district.mesh = null;
          active.delete(district);
        } else {
          district.mesh.visible = d < radius + 22;
          for (const mesh of district.mesh.children) if (mesh.name === 'FrontageHardware') mesh.visible = d < 68;
        }
      }
      for (const district of districts.values()) {
        if (district.mesh) continue;
        const d = distance(district, x, y, z);
        if (d < radius) pending.push({ district, d });
      }
      pending.sort((a, b) => b.d - a.d);
      // A teleport or the first frame prepares the street immediately. Further blocks arrive before reaching them.
      if (moved > 170) while (pending.length && pending.at(-1).d < 28) {
        const { district, d } = pending.pop();
        buildDistrict(district, d);
      }
    }
    if (pending.length) {
      const { district, d } = pending.pop();
      buildDistrict(district, d);
    }
  }
  return { forBuilding, finish, update };
}

export { createFrontageBuilder };
