import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFireEscapes } from './fire-escapes.js';
import { addBuildingDetails } from './building-details.js';
import {
  Fn,
  float,
  vec2,
  vec3,
  positionWorld,
  positionGeometry,
  color,
  uv,
  normalWorldGeometry,
  abs,
  fract,
  floor,
  mod,
  step,
  smoothstep,
  fwidth,
  max,
  min,
  mix,
  length
} from 'three/tsl';
import {
  ALL_AVENUES,
  CENTRAL_PARK_BOUNDS,
  ISLAND_BOUNDS,
  LANDMARK_SITES,
  streetZ,
  avenueX
} from './city-config.js';
import {
  createPreWarBuildingMaterial,
  createCurtainWallMaterial,
  createBillboardMaterial,
  filteredPulse
} from './tsl-materials.js';
import { GEO } from './nyc-geodata.js';
import { REAL_BUILDINGS } from './building-geodata.js';
import { BUILDING_FACTS } from './building-styles.js';
import { dressBuilding, styleAttributes, linear, SURFACES } from './building-types.js';
import { zoningSetbacks, parapetHeight } from './building-massing.js';
import { createBuildingFootprints } from './building-footprints.js';
import { STOREFRONTS } from './storefront-geodata.js';
import { SHOP_TYPES } from './storefront-types.js';
import { planStorefronts } from './storefront-plan.js';
import { polygonContains, polygonBoxOverlaps } from './building-collision.js';
import { pavedPlazaRects, parkTreeSites, sidewalkBlocks } from './city-grid.js';

// Surveyed footprints define buildings and collisions; architectural details stream around the player.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Spatial 2D quadtree for range queries around the active player/camera position.
 */
class Quadtree {
  constructor(bounds, capacity = 6, maxDepth = 6, depth = 0) {
    this.bounds = bounds; // { minX, maxX, minZ, maxZ }
    this.capacity = capacity;
    this.maxDepth = maxDepth;
    this.depth = depth;
    this.items = [];
    this.divided = false;
    this.nw = null;
    this.ne = null;
    this.sw = null;
    this.se = null;
  }

  containsPoint(x, z) {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }

  intersectsCircle(cx, cz, radius) {
    const b = this.bounds;
    const closestX = Math.max(b.minX, Math.min(cx, b.maxX));
    const closestZ = Math.max(b.minZ, Math.min(cz, b.maxZ));
    const dx = cx - closestX;
    const dz = cz - closestZ;
    return (dx * dx + dz * dz) <= (radius * radius);
  }

  subdivide() {
    const b = this.bounds;
    const midX = (b.minX + b.maxX) * 0.5;
    const midZ = (b.minZ + b.maxZ) * 0.5;
    const nextDepth = this.depth + 1;

    this.nw = new Quadtree({ minX: b.minX, maxX: midX, minZ: b.minZ, maxZ: midZ }, this.capacity, this.maxDepth, nextDepth);
    this.ne = new Quadtree({ minX: midX, maxX: b.maxX, minZ: b.minZ, maxZ: midZ }, this.capacity, this.maxDepth, nextDepth);
    this.sw = new Quadtree({ minX: b.minX, maxX: midX, minZ: midZ, maxZ: b.maxZ }, this.capacity, this.maxDepth, nextDepth);
    this.se = new Quadtree({ minX: midX, maxX: b.maxX, minZ: midZ, maxZ: b.maxZ }, this.capacity, this.maxDepth, nextDepth);
    this.divided = true;

    for (const item of this.items) {
      this._insertIntoChildren(item);
    }
    this.items.length = 0;
  }

  _insertIntoChildren(item) {
    if (this.nw.containsPoint(item.cx, item.cz)) return this.nw.insert(item);
    if (this.ne.containsPoint(item.cx, item.cz)) return this.ne.insert(item);
    if (this.sw.containsPoint(item.cx, item.cz)) return this.sw.insert(item);
    if (this.se.containsPoint(item.cx, item.cz)) return this.se.insert(item);
    return false;
  }

  insert(item) {
    if (!this.containsPoint(item.cx, item.cz)) return false;

    if (!this.divided) {
      if (this.items.length < this.capacity || this.depth >= this.maxDepth) {
        this.items.push(item);
        return true;
      }
      this.subdivide();
    }
    return this._insertIntoChildren(item);
  }

  queryRange(cx, cz, radius, found = []) {
    if (!this.intersectsCircle(cx, cz, radius)) return found;

    const rSq = radius * radius;
    if (!this.divided) {
      for (let i = 0; i < this.items.length; i++) {
        const item = this.items[i];
        const dx = item.cx - cx;
        const dz = item.cz - cz;
        if (dx * dx + dz * dz <= rSq) {
          found.push(item);
        }
      }
      return found;
    }

    this.nw.queryRange(cx, cz, radius, found);
    this.ne.queryRange(cx, cz, radius, found);
    this.sw.queryRange(cx, cz, radius, found);
    this.se.queryRange(cx, cz, radius, found);
    return found;
  }
}

function buildCityBlocks(scene, landmarkColliders = []) {
  const group = new THREE.Group();
  group.name = 'ManhattanCityBlocks';
  const colliders = [];

  // Stream nearby architectural details.
  const quadtree = new Quadtree({
    minX: ISLAND_BOUNDS.minX - 50,
    maxX: ISLAND_BOUNDS.maxX + 50,
    minZ: ISLAND_BOUNDS.minZ - 50,
    maxZ: ISLAND_BOUNDS.maxZ + 50
  }, 6, 9);
  const allBlocks = [];

  // One facade material per wall photograph, and one for curtain walls: each building brings its own dress (its kind,
  // colours, windows; js/building-types.js) as vertex attributes, so these few materials draw every building in town
  const GLASS_BUCKET = SURFACES.length;
  const materials = [
    ...SURFACES.map((surface) => createPreWarBuildingMaterial({ surface, windowGlassColor: 0x18222c, footprintLocal: true, styled: true })),
    createCurtainWallMaterial({ footprintLocal: true, styled: true })
  ];
  const MASONRY = new Set(SURFACES.map((_, i) => i));

  const broadwayBillboards = [];

  // Times Square's billboard-facing walls look onto Broadway and 7th Avenue between 42nd and 47th St.
  const TS = (() => {
    const def = (GEO.plazas || []).find((d) => d.name === 'Times Square');
    const ave7 = ALL_AVENUES.find((a) => a.id === '7');
    if (!def || !ave7) return null;
    const [ax, az] = def.a;
    const [bx, bz] = def.b;
    return {
      zN: streetZ(47) - 6,
      zS: streetZ(42) + 6,
      x7: ave7.x,
      half7: ave7.width * 0.5 + 1,
      halfB: def.w * 0.5 + 1,
      xAt: (z) => ax + ((z - az) / (bz - az)) * (bx - ax)
    };
  })();
  const inBowtie = (x, z) => !!TS && z > TS.zN && z < TS.zS && (Math.abs(x - TS.xAt(z)) < TS.halfB || Math.abs(x - TS.x7) < TS.half7);

  // Keep authored landmarks clear of surveyed buildings and architectural details.
  const LANDMARK_RESERVE = [
    ['Empire State Building'], ['Chrysler Building'], ['One Vanderbilt'], ['Grand Central Terminal'], ['MetLife Building'],
    ['Stephen A. Schwarzman Building'], ['One Times Square'], ['30 Rockefeller Plaza'], ['Citigroup Center'],
    ['Seagram Building', { x0: avenueX('park') + 20 }], ['Flatiron Building'], ['One World Trade Center'], ['New York Stock Exchange']
  ].map(([name, o]) => {
    const t = LANDMARK_SITES[name];
    if (!t) return null;
    return { height: Infinity, x: t.x, z: t.z, x0: t.x - t.w / 2 - 3, x1: t.x + t.w / 2 + 3, z0: t.z - t.d / 2 - 3, z1: t.z + t.d / 2 + 3, ...(o || {}) };
  }).filter(Boolean);
  // Keep the authored landmark models; the survey supplies the surrounding buildings.
  const surveyedBuildings = REAL_BUILDINGS.filter((b) => !LANDMARK_RESERVE.some((h) =>
    b.polygons.some((p) => polygonContains({ outer: p.outer, holes: [] }, h.x, h.z)))
    && !landmarkColliders.some((c) => b.minX < c.maxX && b.maxX > c.minX && b.minZ < c.maxZ && b.maxZ > c.minZ
      && b.polygons.some((p) => polygonBoxOverlaps(p, (c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2,
        (c.maxX - c.minX) / 2, (c.maxZ - c.minZ) / 2))));
  const landmarkReserves = [...LANDMARK_RESERVE, ...landmarkColliders.map((c) =>
    ({ x0: c.minX, x1: c.maxX, z0: c.minZ, z1: c.maxZ, height: c.maxY ?? Infinity }))];
  const hitR = (a, x0, x1, z0, z1) => a.x0 < x1 && a.x1 > x0 && a.z0 < z1 && a.z1 > z0;
  const buildingReserves = [];
  const reserveCells = new Map();
  function addReserve(r) {
    const index = buildingReserves.length;
    buildingReserves.push(r);
    for (let ix = Math.floor(r.x0 / 128); ix <= Math.floor(r.x1 / 128); ix++) {
      for (let iz = Math.floor(r.z0 / 128); iz <= Math.floor(r.z1 / 128); iz++) {
        const key = ix + ',' + iz;
        if (!reserveCells.has(key)) reserveCells.set(key, []);
        reserveCells.get(key).push(index);
      }
    }
  }
  // Each building's kind and dress (js/building-types.js), and the tiers of a stepped tower: its footprint rises to
  // the lowest part standing on the ground, and the parts above rise from there, their setbacks left as terraces
  const factIndex = new Map(REAL_BUILDINGS.map((b, i) => [b, i]));
  const dress = new Map();
  for (const b of surveyedBuildings) {
    const facts = BUILDING_FACTS[factIndex.get(b)];
    const style = dressBuilding(b, facts);
    let podium = b.height, tiers = [];
    const ground = facts.parts.filter((p) => p.base < 1);
    if (ground.length) {
      podium = Math.min(b.height, Math.max(3, Math.min(...ground.map((p) => p.top))));
      tiers = facts.parts.filter((p) => p.top > podium + 0.5).map((p) => ({ ring: p.ring, base: Math.max(p.base, podium), top: p.top }));
    } else {
      // No surveyed tiers: a tall building of the 1916 zoning era steps back as the law made it
      const zoned = zoningSetbacks(b, style, facts.year || b.year);
      if (zoned) ({ podium, tiers } = zoned);
    }
    dress.set(b, { style, podium, tiers });
  }
  for (const b of surveyedBuildings) {
    const { podium, tiers } = dress.get(b);
    addReserve({ x0: b.minX, x1: b.maxX, z0: b.minZ, z1: b.maxZ, height: podium + 0.22, polygons: b.polygons });
    for (const t of tiers) {
      const xs = t.ring.map((q) => q.x), zs = t.ring.map((q) => q.z);
      addReserve({ x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), height: t.top + 0.22,
        polygons: [{ outer: t.ring, holes: [] }] });
    }
  }
  function nearbyReserves(b, padding = 0) {
    const minX = b.minX - padding, maxX = b.maxX + padding;
    const minZ = b.minZ - padding, maxZ = b.maxZ + padding;
    const found = new Set();
    for (let ix = Math.floor(minX / 128); ix <= Math.floor(maxX / 128); ix++) {
      for (let iz = Math.floor(minZ / 128); iz <= Math.floor(maxZ / 128); iz++) {
        for (const index of reserveCells.get(ix + ',' + iz) || []) {
          if (hitR(buildingReserves[index], minX, maxX, minZ, maxZ)) found.add(index);
        }
      }
    }
    return Array.from(found, (index) => buildingReserves[index]);
  }
  function overlapsParkOrLandmark(minX, maxX, minZ, maxZ) {
    const cp = CENTRAL_PARK_BOUNDS;
    if (maxX > cp.minX && minX < cp.maxX && maxZ > cp.minZ && minZ < cp.maxZ) return true;
    return LANDMARK_RESERVE.some((h) => hitR(h, minX, maxX, minZ, maxZ));
  }

  for (const r of landmarkReserves) {
    addReserve({ ...r, polygons: [{ outer: [
      { x: r.x0, z: r.z0 }, { x: r.x1, z: r.z0 }, { x: r.x1, z: r.z1 }, { x: r.x0, z: r.z1 }
    ], holes: [] }] });
  }
  function reserveFireEscape(fe) {
    const cs = Math.cos(fe.facing), sn = Math.sin(fe.facing);
    const outer = [[-1.7, -0.55], [1.7, -0.55], [1.7, 0.57], [-1.7, 0.57]].map(([x, z]) =>
      ({ x: fe.x + x * cs + z * sn, z: fe.z - x * sn + z * cs }));
    const xs = outer.map((p) => p.x), zs = outer.map((p) => p.z);
    const r = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs),
      height: 0, polygons: [{ outer, holes: [] }] };
    addReserve(r);
    return r;
  }

  function addSurveyedFireEscapes(b, detail, storey, neighbours) {
    if (!b.style?.fireEscape || b.height > 30) return;
    const floors = Math.floor((b.height + 0.22) / storey);
    if (floors < 3) return;
    const landings = Math.min(floors - 1, 7), h = (landings - 1) * storey + 1;
    for (const polygon of b.polygons) {
      for (const ring of [polygon.outer, ...polygon.holes]) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], c = ring[(i + 1) % ring.length];
          const dx = c.x - a.x, dz = c.z - a.z, length = Math.hypot(dx, dz);
          if (length < 4.6) continue;
          const nx = dz / length, nz = -dx / length;
          const count = length >= 15 ? 2 : 1;
          for (let k = 0; k < count; k++) {
            const t = (k + 0.5) / count, x = a.x + dx * t, z = a.z + dz * t;
            // The clearance box starts just outside the wall, including on concave footprints.
            if (neighbours.some((r) => r.polygons.some((p) =>
              polygonBoxOverlaps(p, x + nx * 0.75, z + nz * 0.75, 1.9, 0.65, nz, nx)))) continue;
            const fe = {
              x: x + nx * 0.55, y: storey + 0.1, z: z + nz * 0.55, h, storey, landings,
              facing: Math.atan2(nx, nz)
            };
            detail.fireEscapes.push(fe);
            neighbours.push(reserveFireEscape(fe));
            if (detail.fireEscapes.length === 4) return;
          }
        }
      }
    }
  }

  const surveyedBuckets = materials.map(() => []);
  const detailsToPlace = [];
  const records = [];
  for (const b of surveyedBuildings) {
    const seed = Math.round(b.cx * 31 + b.cz * 17);
    const rand = mulberry32(seed);
    const tone = rand();
    const { style, podium, tiers } = dress.get(b);
    const mat = style.glass ? GLASS_BUCKET : SURFACES.indexOf(style.surface);
    // The roof's vertices carry its covering's colour where the walls carry their tint
    const styleAttr = styleAttributes(style), roofAttr = styleAttr.slice();
    roofAttr.splice(4, 3, ...linear(style.roof));
    // Shops come from the city's storefront registry (planned below); storefronts.js builds them
    const record = { ...b, height: podium, tone, storefronts: false, mat, floorHeight: style.floor, style, styleAttr, roofAttr, tiers,
      parapet: parapetHeight(style) };
    surveyedBuckets[mat].push(record);
    records.push(record);
    const detail = {
      cx: b.cx, cz: b.cz, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ,
      cornices: [], waterTowers: [], hvacUnits: [], fireEscapes: [], awnings: [], scaffoldSheds: [], footprints: [],
      bulkheads: [], chimneys: [], skylights: [], vents: [], dishes: []
    };
    const top = podium + 0.22;
    for (const polygon of b.polygons) {
      const xs = polygon.outer.map((p) => p.x), zs = polygon.outer.map((p) => p.z);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
      colliders.push({ minX, maxX, minZ, maxZ, minY: 0, maxY: top, polygon, roof: true });
      detail.footprints.push({ h: top, pts: polygon.outer, holes: polygon.holes });
    }
    // Every tier is solid and its roof walkable
    for (const t of tiers) {
      const xs = t.ring.map((p) => p.x), zs = t.ring.map((p) => p.z);
      const polygon = { outer: t.ring, holes: [] };
      colliders.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs),
        minY: t.base + 0.22, maxY: t.top + 0.22, polygon, roof: true });
      detail.footprints.push({ h: t.top + 0.22, pts: t.ring, holes: [] });
    }
    const neighbours = nearbyReserves(b, 6);
    addSurveyedFireEscapes(record, detail, style.floor, neighbours);
    detailsToPlace.push({ b: record, detail, masonry: !style.glass, rand });
    allBlocks.push(detail);
  }
  // Every registered storefront on the wall of its building that faces its street
  const plan = planStorefronts(records, STOREFRONTS, SHOP_TYPES);
  for (const [record, walls] of plan.wallsByRecord) record.shopWalls = walls;
  // Reserve every fire escape before placing scaffolding on neighbouring buildings.
  for (const { b, detail, masonry, rand } of detailsToPlace) {
    const neighbours = nearbyReserves(b, 6);
    for (const reserve of addBuildingDetails(b, detail, { masonry, rand, neighbours, cornice: b.style.cornice,
      corniceColour: linear(b.style.corniceColour), waterTower: b.style.waterTower, type: b.style.type,
      wallColour: linear(b.style.wall ?? 0x7a5a48) })) {
      addReserve(reserve);
    }
    quadtree.insert(detail);
  }
  // The street walls each building's windows open in, for the window dressings of facade-kit.js
  const streetWalls = new Map();
  surveyedBuckets.forEach((items, i) => {
    if (!items.length) return;
    group.add(createBuildingFootprints(materials[i], items, MASONRY.has(i) ? b => nearbyReserves(b, 2) : undefined, streetWalls));
  });
  for (const [record, walls] of streetWalls) record.kitWalls = walls;

  // Narrow empty lots become sitting areas with trees.
  {
    const plazas = pavedPlazaRects || [];
    const sites = parkTreeSites;
    const hit = (r, x0, x1, z0, z1) => r.minX < x1 && r.maxX > x0 && r.minZ < z1 && r.maxZ > z0;
    for (const s of (sites && sidewalkBlocks) || []) {
      const x0 = s.cx - s.w / 2;
      const x1 = s.cx + s.w / 2;
      const z0 = s.cz - s.d / 2;
      const z1 = s.cz + s.d / 2;
      if (s.cover || (s.block && (s.block.median || s.block.park > 0.6))) continue;
      const narrow = Math.min(s.w, s.d);
      if (narrow < 8 || narrow > 26 || Math.max(s.w, s.d) < 20) continue;
      if (allBlocks.some((b) => hit(b, x0 + 2, x1 - 2, z0 + 2, z1 - 2)) || plazas.some((r) => hit(r, x0, x1, z0, z1))) continue;
      if (overlapsParkOrLandmark(x0, x1, z0, z1)) continue;
      const alongX = s.w > s.d;
      const len = alongX ? s.w : s.d;
      const n = Math.max(1, Math.floor((len - 6) / 8));
      const lanes = narrow >= 15 ? [-narrow / 4, narrow / 4] : [0];
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        for (const [j, o] of lanes.entries()) {
          const u = (len - 6) * t + (j % 2) * 2;
          const x = alongX ? s.cx + u : s.cx + o;
          const z = alongX ? s.cz + o : s.cz + u;
          const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
          sites.push({ x, y: 0.22, z, scale: 0.8 + h * 0.3, species: h < 0.55 ? 1 : 0, tier: 1 });
        }
      }
    }
  }

  // Times Square: tiers of billboards up every street wall that looks onto the bowtie (podiums and the tower
  //     shafts set back above them alike), from above the storefront marquees to ~62 m, split into screens up to
  //     ~26 m wide (the odd screen left out)
  if (TS) {
    const hash = (a, b) => Math.abs(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453) % 1;
    function addBillboards(cx, cz, nx, nz, length, base, top) {
      if (length < 8 || top - base < 8) return;
      const ax = -nz, az = nx;
      const seen = [0.2, 0.5, 0.8].some((t) => [6, 12, 20, 30].some((d) => {
        const u = (t - 0.5) * length;
        return inBowtie(cx + nx * d + ax * u, cz + nz * d + az * u);
      }));
      if (!seen) return;
      const n = Math.max(1, Math.ceil((length - 2) / 26));
      const pw = (length - 2 - (n - 1) * 1.2) / n;
      for (let i = 0; i < n; i++) {
        const u = -length * 0.5 + 1 + i * (pw + 1.2) + pw * 0.5;
        let y = base;
        for (let tier = 0; y < top - 6; tier++) {
          const h = Math.min(top - y, 8 + 8 * hash(u + tier, cx));
          if (h < 6) break;
          if (hash(cz + tier, u) > 0.12) {
            broadwayBillboards.push({
              x: cx + nx * 0.35 + ax * u,
              y: y + h * 0.5,
              z: cz + nz * 0.35 + az * u,
              w: pw,
              h,
              rotY: Math.atan2(nx, nz),
              variant: Math.floor(hash(cx + i, cz + tier) * 6)
            });
          }
          y += h + 1.2;
        }
      }
    }
    for (const b of surveyedBuildings) {
      if (b.maxZ < TS.zN - 40 || b.minZ > TS.zS + 40 || Math.abs(b.cx - TS.x7) > 280) continue;
      for (const { outer } of b.polygons) {
        for (let i = 0; i < outer.length; i++) {
          const a = outer[i], c = outer[(i + 1) % outer.length];
          const dx = c.x - a.x, dz = c.z - a.z, length = Math.hypot(dx, dz);
          if (length < 8) continue;
          addBillboards((a.x + c.x) / 2, (a.z + c.z) / 2, dz / length, -dx / length,
            length, 7.5, Math.min(b.height + 0.22 - 2, 62));
        }
      }
    }
  }

  // ============================================================================
  // STATIC BILLBOARDS
  // ============================================================================
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D();
  const corniceColour = new THREE.Color();

  // Billboards: one merged mesh per poster theme
  {
    const byVariant = new Map();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const bb of broadwayBillboards) {
      const g = new THREE.PlaneGeometry(bb.w, bb.h);
      g.applyMatrix4(m.compose(new THREE.Vector3(bb.x, bb.y, bb.z), q.setFromAxisAngle(up, bb.rotY), new THREE.Vector3(1, 1, 1)));
      if (!byVariant.has(bb.variant)) byVariant.set(bb.variant, []);
      byVariant.get(bb.variant).push(g);
    }
    for (const [variant, geos] of byVariant) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), createBillboardMaterial(variant));
      mesh.name = `TimesSquareBillboards_${variant}`;
      group.add(mesh);
      for (const g of geos) g.dispose();
    }
  }

  // ============================================================================
  // STREAMED ARCHITECTURAL DETAILS
  // ============================================================================
  const MAX_CORNICES = 7000;
  const MAX_WATER_TOWERS = 1400;
  const MAX_HVAC = 1600;
  const MAX_SHEDS = 300;

  // 1. Projecting cornices: a moulded profile (frieze, bed moulding, corona, crown) run along the roof line, in each
  //    building's stone or paint, with consoles shaded into its bed moulding
  const corniceMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.74, metalness: 0.06 });
  corniceMat.colorNode = Fn(() => {
    // Along the wall, whatever face this is: the horizontal at right angles to the face's normal
    const n = normalWorldGeometry;
    const along = positionWorld.x.mul(n.z.negate()).add(positionWorld.z.mul(n.x)).div(max(length(n.xz), 0.2));
    const local = positionGeometry.y;
    // Consoles every 0.7 m under the corona: a dark gap between each pair
    const inBed = smoothstep(-0.4, -0.36, local).mul(float(1.0).sub(smoothstep(-0.08, -0.04, local)));
    const coord = along.div(0.7);
    const gap = filteredPulse(fract(coord), 0.62, 1.0, fwidth(coord)).mul(inBed).mul(step(abs(n.y), 0.7));
    // Dentils along the frieze's top
    const dentCoord = along.div(0.18);
    const dentil = filteredPulse(fract(dentCoord), 0.5, 1.0, fwidth(dentCoord))
      .mul(smoothstep(-0.27, -0.25, local)).mul(float(1.0).sub(smoothstep(-0.18, -0.16, local))).mul(step(abs(n.y), 0.7));
    return vec3(1.0).mul(float(1.0).sub(gap.mul(0.62)).sub(dentil.mul(0.35)));
  })();
  const corniceGeo = (() => {
    // Profile (out from the wall is -z, up is y) in the unit box the instances scale; it is extruded along x
    const profile = [[0.1, -0.5], [-0.12, -0.5], [-0.12, -0.26], [-0.2, -0.26], [-0.2, -0.38], [-0.46, -0.08], [-0.5, -0.08],
      [-0.5, 0.28], [-0.44, 0.34], [-0.44, 0.42], [-0.5, 0.46], [-0.5, 0.5], [0.5, 0.5], [0.5, -0.5]];
    const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(-z, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    g.rotateY(Math.PI / 2);
    g.computeVertexNormals();
    return g;
  })();
  const corniceInst = new THREE.InstancedMesh(corniceGeo, corniceMat, MAX_CORNICES);
  corniceInst.setColorAt(0, new THREE.Color(1, 1, 1));
  corniceInst.castShadow = true;
  corniceInst.receiveShadow = true;
  corniceInst.frustumCulled = false;
  group.add(corniceInst);

  // 2. 3-part rooftop cedar water towers with steel hoop bands & open 4-leg steel trestle
  const woodMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.78 });
  woodMat.colorNode = Fn(() => {
    const u = uv();
    // Preserve the average width of seams and hoops when they become smaller than a pixel.
    const staveCoord = u.x.mul(28.0);
    const staveSeam = filteredPulse(fract(staveCoord), 0.46, 0.54, fwidth(staveCoord));
    const staveTone = mix(color(0x8e6343), color(0x5c3e26), staveSeam.mul(0.55));
    const bandCoord = u.y.mul(5.0);
    const isHoop = filteredPulse(fract(bandCoord), 0.42, 0.58, fwidth(bandCoord));
    return mix(staveTone, color(0x1f2328), isHoop);
  })();
  const roofCapMat = new THREE.MeshStandardNodeMaterial({ color: 0x3b4045, roughness: 0.65, metalness: 0.3 });
  const legMat = new THREE.MeshStandardNodeMaterial({ color: 0x262b30, roughness: 0.45, metalness: 0.68 });
  const barrelGeo = new THREE.CylinderGeometry(1.65, 1.75, 3.6, 12);
  const coneGeo = new THREE.ConeGeometry(1.9, 1.5, 12);

  // Open 4-leg structural steel trestle with cross-bracing and top chime deck
  const trestleParts = [];
  const legPostGeo = new THREE.BoxGeometry(0.24, 2.75, 0.24);
  const legPositions = [
    [-1.05, 0, -1.05],
    [1.05, 0, -1.05],
    [-1.05, 0, 1.05],
    [1.05, 0, 1.05],
  ];
  for (const [lx, ly, lz] of legPositions) {
    const g = legPostGeo.clone();
    g.rotateZ(lx > 0 ? 0.08 : -0.08);
    g.rotateX(lz > 0 ? -0.08 : 0.08);
    g.translate(lx, ly, lz);
    trestleParts.push(g);
  }
  const deckRingGeo = new THREE.CylinderGeometry(1.88, 1.88, 0.22, 12);
  deckRingGeo.translate(0, 1.22, 0);
  trestleParts.push(deckRingGeo);
  const braceX1 = new THREE.BoxGeometry(2.15, 0.14, 0.14);
  braceX1.translate(0, 0.2, -1.02);
  trestleParts.push(braceX1);
  const braceX2 = new THREE.BoxGeometry(2.15, 0.14, 0.14);
  braceX2.translate(0, 0.2, 1.02);
  trestleParts.push(braceX2);
  const braceZ1 = new THREE.BoxGeometry(0.14, 0.14, 2.15);
  braceZ1.translate(-1.02, -0.45, 0);
  trestleParts.push(braceZ1);
  const braceZ2 = new THREE.BoxGeometry(0.14, 0.14, 2.15);
  braceZ2.translate(1.02, -0.45, 0);
  trestleParts.push(braceZ2);
  const riserPipe = new THREE.CylinderGeometry(0.24, 0.24, 2.6, 8);
  trestleParts.push(riserPipe);
  const legsGeo = mergeGeometries(trestleParts, false);

  const barrelInst = new THREE.InstancedMesh(barrelGeo, woodMat, MAX_WATER_TOWERS);
  const coneInst = new THREE.InstancedMesh(coneGeo, roofCapMat, MAX_WATER_TOWERS);
  const legsInst = new THREE.InstancedMesh(legsGeo, legMat, MAX_WATER_TOWERS);
  barrelInst.castShadow = barrelInst.receiveShadow = true;
  coneInst.castShadow = coneInst.receiveShadow = true;
  legsInst.castShadow = legsInst.receiveShadow = true;
  barrelInst.frustumCulled = coneInst.frustumCulled = legsInst.frustumCulled = false;
  group.add(legsInst, barrelInst, coneInst);

  // 3. Rooftop mechanical penthouses & HVAC chillers with top exhaust fans & side louvers
  const hvacMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.52, metalness: 0.45 });
  hvacMat.colorNode = Fn(() => {
    const u = uv();
    const isTop = step(0.7, normalWorldGeometry.y);
    const fan1 = length(u.sub(vec2(0.3, 0.5)));
    const fan2 = length(u.sub(vec2(0.7, 0.5)));
    const fanDist = min(fan1, fan2);
    const inFanWell = smoothstep(0.19, 0.17, fanDist);
    // Average subpixel slats and fan rings instead of letting them shimmer at a distance.
    const fanCoord = fanDist.mul(16.0);
    const fanRing = filteredPulse(fract(fanCoord), 0.4835, 0.5165, fwidth(fanCoord)).mul(inFanWell);
    const topCol = mix(color(0x889098), color(0x1b2026), inFanWell.mul(0.82).sub(fanRing.mul(0.45)));

    const inLouverBox = step(0.12, u.x).mul(step(u.x, 0.88)).mul(step(0.18, u.y)).mul(step(u.y, 0.82));
    const slatCoord = u.y.mul(14.0);
    const louverSlat = filteredPulse(fract(slatCoord), 0.45, 1.0, fwidth(slatCoord)).mul(inLouverBox);
    const panelSeam = smoothstep(0.03, 0.0, abs(fract(u.x.mul(3.0)).sub(0.5)));
    const sideCol = mix(color(0x7c848c), color(0x282e36), max(louverSlat.mul(0.72), panelSeam.mul(0.35)));
    return mix(sideCol, topCol, isTop);
  })();
  // 3b. Roof clutter: brick bulkheads and chimney stacks in their building's brick, hipped skylights, vent pipes, dishes
  const MAX_BRICK = 7000, MAX_SKYLIGHTS = 2400, MAX_VENTS = 9000, MAX_DISHES = 1200;
  const brickMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.88 });
  brickMat.colorNode = Fn(() => {
    const p = positionWorld, n = normalWorldGeometry;
    const along = p.x.mul(n.z.negate()).add(p.z.mul(n.x));
    const course = p.y.div(0.076);
    const brick = along.div(0.205).add(mod(floor(course), 2.0).mul(0.5));
    const mortar = max(filteredPulse(fract(course), 0.0, 0.16, fwidth(course)), filteredPulse(fract(brick), 0.0, 0.07, fwidth(brick)));
    const shade = fract(floor(brick).mul(0.37).add(floor(course).mul(0.71))).mul(0.16).add(0.92);
    // The cap: tar paper, dark whatever the brick
    return mix(mix(vec3(shade), vec3(1.45), mortar.mul(0.55)), vec3(0.32), step(0.7, n.y));
  })();
  const brickInst = new THREE.InstancedMesh(unitBox, brickMat, MAX_BRICK);
  brickInst.setColorAt(0, new THREE.Color(1, 1, 1));
  const skylightMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.5 });
  skylightMat.colorNode = Fn(() => {
    // Wired glass panes between aluminium glazing bars
    const p = positionGeometry;
    const bar = filteredPulse(fract(p.x.add(p.z).mul(3.0)), 0.0, 0.12, fwidth(p.x.add(p.z).mul(3.0)));
    return mix(vec3(0.16, 0.2, 0.24), vec3(0.62, 0.64, 0.66), max(bar, step(p.y, -0.42)));
  })();
  const skylightGeo = new THREE.CylinderGeometry(0.42, 0.7, 1, 4, 1);
  skylightGeo.rotateY(Math.PI / 4);
  const skylightInst = new THREE.InstancedMesh(skylightGeo, skylightMat, MAX_SKYLIGHTS);
  const ventMat = new THREE.MeshStandardNodeMaterial({ color: 0x6e7176, roughness: 0.45, metalness: 0.7 });
  const ventInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1), ventMat, MAX_VENTS);
  const dishMat = new THREE.MeshStandardNodeMaterial({ color: 0xd8d8d4, roughness: 0.5, metalness: 0.2 });
  const dishGeo = (() => {
    const post = new THREE.CylinderGeometry(0.035, 0.035, 0.9, 6);
    post.translate(0, 0.45, 0);
    const dish = new THREE.CylinderGeometry(0.4, 0.3, 0.07, 14);
    dish.rotateX(-0.9);
    dish.translate(0, 0.95, 0.04);
    const arm = new THREE.CylinderGeometry(0.015, 0.015, 0.5, 4);
    arm.rotateX(0.7);
    arm.translate(0, 1.05, 0.25);
    return mergeGeometries([post, dish, arm], false);
  })();
  const dishInst = new THREE.InstancedMesh(dishGeo, dishMat, MAX_DISHES);
  for (const inst of [brickInst, skylightInst, ventInst, dishInst]) {
    inst.castShadow = inst.receiveShadow = true;
    inst.frustumCulled = false;
    inst.count = 0;
    group.add(inst);
  }
  const hvacInst = new THREE.InstancedMesh(unitBox, hvacMat, MAX_HVAC);
  hvacInst.castShadow = hvacInst.receiveShadow = true;
  hvacInst.frustumCulled = false;
  group.add(hvacInst);

  // 4. Instanced fire escapes: real steps nearby, lightweight silhouettes in the distance.
  const fireEscapeSystem = createFireEscapes(group);

  // 6. Sidewalk construction scaffolding sheds
  const shedMat = new THREE.MeshStandardNodeMaterial({ color: 0x214f37, roughness: 0.6, metalness: 0.25 });
  const shedInst = new THREE.InstancedMesh(unitBox, shedMat, MAX_SHEDS);
  shedInst.castShadow = shedInst.receiveShadow = true;
  shedInst.frustumCulled = false;
  group.add(shedInst);

  // ============================================================================
  // STREAMING AROUND THE PLAYER / CAMERA
  // ============================================================================
  let lastStreamX = Infinity;
  let lastStreamZ = Infinity;
  const STREAM_RADIUS = 560; // High-detail architectural radius around player in meters

  // Streaming rewrites only the active prefix; unused pool capacity need not cross the GPU queue.
  function flagRange(attribute, count) {
    if (count === 0) return;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, count * attribute.itemSize);
    attribute.needsUpdate = true;
  }

  function update(focusX, focusZ, force = false) {
    const dx = focusX - lastStreamX;
    const dz = focusZ - lastStreamZ;
    if (!force && (dx * dx + dz * dz) < 324) {
      // Player moved less than 18m since last Quadtree stream update
      return;
    }
    lastStreamX = focusX;
    lastStreamZ = focusZ;

    const nearbyBlocks = quadtree.queryRange(focusX, focusZ, STREAM_RADIUS);
    // Sort closest blocks first so if any pool hits capacity, closest blocks around the player always win
    nearbyBlocks.sort((a, b) => {
      const da = (a.cx - focusX) * (a.cx - focusX) + (a.cz - focusZ) * (a.cz - focusZ);
      const db = (b.cx - focusX) * (b.cx - focusX) + (b.cz - focusZ) * (b.cz - focusZ);
      return da - db;
    });

    let corniceCount = 0;
    let wtCount = 0;
    let hvacCount = 0;
    let brickCount = 0, skylightCount = 0, ventCount = 0, dishCount = 0;
    fireEscapeSystem.begin(focusX, focusZ);
    let shedCount = 0;

    for (const blk of nearbyBlocks) {
      // 1. Stone cornices & setback ledges, hung just below their roof line (top 0.1h under it, so no two ledges or
      //    roofs share a plane) so roofs & terraces keep their own roofing instead of a stone lid
      for (let i = 0; i < blk.cornices.length && corniceCount < MAX_CORNICES; i++) {
        const c = blk.cornices[i];
        dummy.rotation.set(0, c.ry || 0, 0);
        dummy.position.set(c.x, c.y - c.h * 0.6, c.z);
        dummy.scale.set(c.w, c.h, c.d);
        dummy.updateMatrix();
        corniceInst.setColorAt(corniceCount, corniceColour.setRGB(...(c.colour || [0.6, 0.55, 0.46])));
        corniceInst.setMatrixAt(corniceCount++, dummy.matrix);
      }

      // 2. Rooftop cedar water towers
      for (let i = 0; i < blk.waterTowers.length && wtCount < MAX_WATER_TOWERS; i++) {
        const wt = blk.waterTowers[i];
        dummy.rotation.set(0, wt.ry || 0, 0);
        dummy.scale.set(1, 1, 1);

        dummy.position.set(wt.x, wt.y + 1.3, wt.z);
        dummy.updateMatrix();
        legsInst.setMatrixAt(wtCount, dummy.matrix);

        dummy.position.set(wt.x, wt.y + 4.2, wt.z);
        dummy.updateMatrix();
        barrelInst.setMatrixAt(wtCount, dummy.matrix);

        dummy.position.set(wt.x, wt.y + 6.7, wt.z);
        dummy.updateMatrix();
        coneInst.setMatrixAt(wtCount, dummy.matrix);
        wtCount++;
      }

      // 3. Rooftop HVAC & mechanical bulkheads
      for (let i = 0; i < blk.hvacUnits.length && hvacCount < MAX_HVAC; i++) {
        const u = blk.hvacUnits[i];
        dummy.rotation.set(0, u.ry || 0, 0);
        dummy.position.set(u.x, u.y + u.h * 0.5, u.z);
        dummy.scale.set(u.w, u.h, u.d);
        dummy.updateMatrix();
        hvacInst.setMatrixAt(hvacCount++, dummy.matrix);
      }

      // 3b. Roof clutter
      const tint = (c) => corniceColour.setRGB(c[0], c[1], c[2]);
      for (const u of [...blk.bulkheads, ...blk.chimneys]) {
        if (brickCount >= MAX_BRICK) break;
        dummy.rotation.set(0, u.ry || 0, 0);
        dummy.position.set(u.x, u.y + u.h * 0.5, u.z);
        dummy.scale.set(u.w, u.h, u.d);
        dummy.updateMatrix();
        brickInst.setColorAt(brickCount, tint(u.colour));
        brickInst.setMatrixAt(brickCount++, dummy.matrix);
      }
      for (const u of blk.skylights) {
        if (skylightCount >= MAX_SKYLIGHTS) break;
        dummy.rotation.set(0, u.ry || 0, 0);
        dummy.position.set(u.x, u.y + u.h * 0.5, u.z);
        dummy.scale.set(u.w, u.h, u.d);
        dummy.updateMatrix();
        skylightInst.setMatrixAt(skylightCount++, dummy.matrix);
      }
      for (const u of blk.vents) {
        if (ventCount >= MAX_VENTS) break;
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(u.x, u.y + u.h * 0.5, u.z);
        dummy.scale.set(u.r, u.h, u.r);
        dummy.updateMatrix();
        ventInst.setMatrixAt(ventCount++, dummy.matrix);
      }
      for (const u of blk.dishes) {
        if (dishCount >= MAX_DISHES) break;
        dummy.rotation.set(0, u.ry || 0, 0);
        dummy.position.set(u.x, u.y, u.z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        dishInst.setMatrixAt(dishCount++, dummy.matrix);
      }

      // 4. Wrought-iron fire escapes
      for (const fe of blk.fireEscapes) fireEscapeSystem.add(fe);

      // 6. Sidewalk construction sheds: built in full by sidewalk-furniture.js (posts, bracing, deck, lights) over the
      //    buildings this streaming marked (blk.scaffoldSheds keeps their street reservation for the awnings)
    }
    dummy.rotation.set(0, 0, 0);

    corniceInst.count = corniceCount;
    flagRange(corniceInst.instanceMatrix, corniceCount);
    flagRange(corniceInst.instanceColor, corniceCount);

    legsInst.count = wtCount;
    barrelInst.count = wtCount;
    coneInst.count = wtCount;
    flagRange(legsInst.instanceMatrix, wtCount);
    flagRange(barrelInst.instanceMatrix, wtCount);
    flagRange(coneInst.instanceMatrix, wtCount);

    brickInst.count = brickCount;
    flagRange(brickInst.instanceMatrix, brickCount);
    flagRange(brickInst.instanceColor, brickCount);
    skylightInst.count = skylightCount;
    flagRange(skylightInst.instanceMatrix, skylightCount);
    ventInst.count = ventCount;
    flagRange(ventInst.instanceMatrix, ventCount);
    dishInst.count = dishCount;
    flagRange(dishInst.instanceMatrix, dishCount);

    hvacInst.count = hvacCount;
    flagRange(hvacInst.instanceMatrix, hvacCount);

    fireEscapeSystem.end();

    shedInst.count = shedCount;
    flagRange(shedInst.instanceMatrix, shedCount);
  }

  // Initial Quadtree stream centered at Midtown 5th Ave & 42nd St
  update(0, 62, true);

  scene.add(group);
  return {
    group,
    colliders,
    allBlocks,
    update,
    shops: plan.shops,
    records
  };
}

export { buildCityBlocks };
