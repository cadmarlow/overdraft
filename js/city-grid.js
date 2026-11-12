import * as THREE from 'three/webgpu';
import { CITY_RING } from './city-frontier.js';
import { nature } from './nature-assets.js';
import {
  vec2,
  vec3,
  color,
  uv,
  texture,
  positionWorld,
  normalWorldGeometry,
  fract,
  floor,
  sin,
  dot,
  abs,
  min,
  max,
  mix,
  step,
  smoothstep,
  length,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CITY_BLOCKS as BLOCKS,
  streetZ,
  avenueX,
  ALL_AVENUES,
  ALL_STREETS,
  blockAt
} from './city-config.js';
import { createGroundRoadMaterial, createGroundWalkMaterial, createGroundCurbMaterial } from './ground-materials.js';
import { buildIslands } from './ground.js';
import { curbOutline } from './ground-plan.js';
import { createGroundSurfaces, groundFootprint, groundBoundaryColliders } from './ground-surfaces.js';
import { lawnColorNode, createGroundLawnMaterial, createParkEdgeMaterial, createGroundRockMaterial } from './park-materials.js';
import { buildParkWays, buildParkShores, buildOutcrops, paintParkDrives } from './park-ground.js';
import {
  createWaterMaterial,
  createParkPavingMaterial,
  createParkLampGlobeMaterial,
  createTktsStepMaterial,
  createMarbleAshlarMaterial,
  createParkWallMaterial,
  createParkLampPoolMaterial
} from './tsl-materials.js';
import { createRoadPaintChunkBuilder } from './road-paint.js';
import { GEO } from './nyc-geodata.js';
import { buildCathedralClose, buildMorningsidePark } from './morningside-ground.js';
import { MORNINGSIDE_PARK } from './morningside-plan.js';
import { buildUrbanPlaces } from './urban-places.js';
import { buildManhattanGrounds } from './manhattan-grounds.js';

// Live construction data consumed by the building and street-detail builders after buildCityGrid().
let centralParkClearings;
let parkTreeSites;
let parkLampSites;
let pavedPlazaRects;
let sidewalkBlocks;
let streetGroundSurfaces = createGroundSurfaces();
const streetGroundHit = {};

function addStreetGround(poly, height, options) {
  streetGroundSurfaces.add(poly, height, options);
}

function getStreetGroundHeight(x, z) {
  return streetGroundSurfaces.sample(x, z, streetGroundHit) ? Math.max(0.22, streetGroundHit.y) : 0.22;
}

// The city deck, raised sidewalks and parks.

/**
 * Builds a multi-part vaulted stone-arch park bridge (Gapstow Bridge & Bow Bridge)
 * with stone abutments, segmented arch ring, cambered walkway deck, and parapet walls.
 */
function addStoneArchBridge(parent, cx, cz, rotY, span, width, archRise, wallMat, deckMat) {
  const bGroup = new THREE.Group();
  bGroup.position.set(cx, 1.22, cz);
  bGroup.rotation.y = rotY;

  const numSegs = 9;
  const segLen = span / numSegs;
  for (let i = 0; i < numSegs; i++) {
    const u = ((i + 0.5) / numSegs) * 2.0 - 1.0; // -1 .. +1
    const archY = Math.max(0.15, (1.0 - u * u) * archRise);
    const xPos = u * (span * 0.48);
    const tiltZ = -2.0 * u * (archRise / (span * 0.55));

    // Segmented stone arch & spandrel wall
    const spandrelH = 0.55 + (1.0 - Math.abs(u) * 0.35) * 0.45;
    const archSeg = new THREE.Mesh(new THREE.BoxGeometry(segLen * 1.08, spandrelH, width), wallMat);
    archSeg.position.set(xPos, archY + spandrelH * 0.35, 0);
    archSeg.rotation.z = tiltZ * 0.65;
    archSeg.castShadow = true;
    archSeg.receiveShadow = true;
    bGroup.add(archSeg);

    // Cambered gravel/bluestone pedestrian deck
    const deckSeg = new THREE.Mesh(new THREE.BoxGeometry(segLen * 1.08, 0.22, width - 0.7), deckMat);
    deckSeg.position.set(xPos, archY + spandrelH * 0.78, 0);
    deckSeg.rotation.z = tiltZ * 0.65;
    deckSeg.receiveShadow = true;
    bGroup.add(deckSeg);

    // Left & right stone parapet railings
    for (const side of [-1, 1]) {
      const parapet = new THREE.Mesh(new THREE.BoxGeometry(segLen * 1.06, 0.78, 0.38), wallMat);
      parapet.position.set(xPos, archY + spandrelH * 0.78 + 0.44, side * (width * 0.5 - 0.20));
      parapet.rotation.z = tiltZ * 0.65;
      parapet.castShadow = true;
      parapet.receiveShadow = true;
      bGroup.add(parapet);
    }
  }

  // Heavy rusticated stone end abutments anchored into both banks
  for (const endSign of [-1, 1]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.35, width + 1.0), wallMat);
    pier.position.set(endSign * (span * 0.49), 0.52, 0);
    pier.castShadow = true;
    pier.receiveShadow = true;
    bGroup.add(pier);
  }

  parent.add(bGroup);
}

/**
 * Merges static non-instanced THREE.Mesh objects sharing the same material into a single
 * batched BufferGeometry per material to minimize WebGPU render & shadow pass draw calls.
 */
function batchStaticGroupMeshes(rootGroup, excludeMaterials = null) {
  rootGroup.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(rootGroup.matrixWorld).invert();
  const buckets = new Map();

  rootGroup.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh || !obj.geometry || !obj.material) return;
    if (excludeMaterials && excludeMaterials.has(obj.material)) return;
    const attrs = obj.geometry.attributes;
    if (!attrs.position || !attrs.normal || !attrs.uv) return;
    if (!buckets.has(obj.material)) {
      buckets.set(obj.material, []);
    }
    buckets.get(obj.material).push(obj);
  });

  for (const [mat, meshes] of buckets.entries()) {
    if (meshes.length < 2) continue;
    const geos = [];
    let anyCast = false;
    let anyReceive = false;

    for (const m of meshes) {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const key of Object.keys(g.attributes)) {
        if (key !== 'position' && key !== 'normal' && key !== 'uv') {
          g.deleteAttribute(key);
        }
      }
      const relMat = new THREE.Matrix4().multiplyMatrices(invRoot, m.matrixWorld);
      g.applyMatrix4(relMat);
      geos.push(g);
      if (m.castShadow) anyCast = true;
      if (m.receiveShadow) anyReceive = true;
      if (m.parent) m.parent.remove(m);
    }

    const merged = mergeGeometries(geos, false);
    if (merged) {
      const batchedMesh = new THREE.Mesh(merged, mat);
      batchedMesh.castShadow = anyCast;
      batchedMesh.receiveShadow = anyReceive;
      rootGroup.add(batchedMesh);
    }
  }
}

/**
 * Helper to convert an array of world {x, z} polygon vertices into a horizontal THREE.Shape
 * in (x, -z) space so that rotating by rotateX(-Math.PI / 2) maps (x, -z, 0) -> (x, 0, z)
 * with an upward (+Y) surface normal.
 */
function createWorldXZShape(pts) {
  const shape = new THREE.Shape();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) shape.moveTo(p.x, -p.z);
    else shape.lineTo(p.x, -p.z);
  }
  shape.closePath();
  return shape;
}

function createExtrudedPolygonMesh(pts, bottomY, height, material, receiveShadow = true, castShadow = false) {
  const shape = createWorldXZShape(pts);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bottomY, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = receiveShadow;
  mesh.castShadow = castShadow;
  return mesh;
}

function createFlatPolygonMesh(pts, y, material, receiveShadow = true) {
  const shape = createWorldXZShape(pts);
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

/**
 * Sutherland-Hodgman clip of polygon [{x, z}] to the half-plane nx * x + nz * z >= c.
 */
function clipPolygonHalfPlane(pts, nx, nz, c) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const da = nx * a.x + nz * a.z - c;
    const db = nx * b.x + nz * b.z - c;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

function rectPolygon(minX, maxX, minZ, maxZ) {
  return [{ x: minX, z: minZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ }];
}

/**
 * Clips polygon [{x, z}] (may be concave, e.g. MANHATTAN_COASTLINE) to the inside of a convex polygon (either winding).
 * The part inside must be connected.
 */
function clipPolygonToConvex(pts, convex) {
  let area = 0;
  for (let i = 0; i < convex.length; i++) {
    const a = convex[i];
    const b = convex[(i + 1) % convex.length];
    area += a.x * b.z - b.x * a.z;
  }
  const s = area > 0 ? 1 : -1;
  let out = pts;
  for (let i = 0; i < convex.length && out.length; i++) {
    const a = convex[i];
    const b = convex[(i + 1) % convex.length];
    const nx = -s * (b.z - a.z);
    const nz = s * (b.x - a.x);
    out = clipPolygonHalfPlane(out, nx, nz, nx * a.x + nz * a.z);
  }
  return out;
}

/** Area centroid {x, z} of a simple polygon [{x, z}]. */
function polygonCentroid(pts) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p.x * q.z - q.x * p.z;
    a += f;
    cx += (p.x + q.x) * f;
    cz += (p.z + q.z) * f;
  }
  return Math.abs(a) < 1e-9 ? { x: pts[0].x, z: pts[0].z } : { x: cx / (3 * a), z: cz / (3 * a) };
}

/**
 * Offsets a convex polygon outward (d > 0) or inward (d < 0) by moving each vertex along its corner bisector.
 */
function offsetConvexPolygon(pts, d) {
  const src = pts.filter((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.hypot(q.x - p.x, q.z - p.z) > 0.05;
  });
  const n = src.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = src[i];
    const b = src[(i + 1) % n];
    area += a.x * b.z - b.x * a.z;
  }
  const s = area > 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = src[(i + n - 1) % n];
    const p1 = src[i];
    const p2 = src[(i + 1) % n];
    const l1 = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const l2 = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const n1x = (s * (p1.z - p0.z)) / l1;
    const n1z = (-s * (p1.x - p0.x)) / l1;
    const n2x = (s * (p2.z - p1.z)) / l2;
    const n2z = (-s * (p2.x - p1.x)) / l2;
    let bx = n1x + n2x;
    let bz = n1z + n2z;
    const bl = Math.hypot(bx, bz) || 1;
    bx /= bl;
    bz /= bl;
    const cosHalf = Math.max(0.3, bx * n1x + bz * n1z);
    out.push({ x: p1.x + (bx * d) / cosHalf, z: p1.z + (bz * d) / cosHalf });
  }
  return out;
}

/**
 * Tags every vertex of a mesh using the shared park paving material with its paving style (uv.x, see
 * createParkPavingMaterial: 0 hex asphalt pavers, 1 light granite plaza pavers, 2 bluestone slabs).
 */
/**
 * A simple polygon ([{x, z}], either winding, convex or not) offset inward by d with mitred corners (miters clamped
 * to 3d); null if it collapses
 */
function offsetPolygonInward(pts, d) {
  const n = pts.length;
  if (n < 3) return null;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  const s = area > 0 ? 1 : -1; // positive area: the inside lies left of each edge, i.e. along (-dz, dx)
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n];
    const q = pts[i];
    const r = pts[(i + 1) % n];
    let ax = q.x - p.x, az = q.z - p.z;
    let bx = r.x - q.x, bz = r.z - q.z;
    const la = Math.hypot(ax, az) || 1e-9;
    const lb = Math.hypot(bx, bz) || 1e-9;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const n1x = -az * s, n1z = ax * s; // inward normals of the two edges
    const n2x = -bz * s, n2z = bx * s;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { out.push({ x: q.x + n1x * d, z: q.z + n1z * d }); continue; }
    mx /= ml; mz /= ml;
    const cos = mx * n1x + mz * n1z; // miter length = d / cos(half angle)
    const len = Math.min(3 * d, d / Math.max(1e-3, cos));
    out.push({ x: q.x + mx * len, z: q.z + mz * len });
  }
  let a2 = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a2 += out[j].x * out[i].z - out[i].x * out[j].z;
  return a2 * area > 0 && Math.abs(a2) < Math.abs(area) ? out : null;
}

function polygonCentroidArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  return a * 0.5;
}
function pointInPolygonXZ(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Polygon offset by d (d > 0 inward, d < 0 outward), mitred corners clamped to 3|d|; null if it degenerates */
function offsetPolygon(pts, d) {
  if (d > 0) return offsetPolygonInward(pts, d);
  const n = pts.length;
  if (n < 3) return null;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  const s = area > 0 ? -1 : 1; // outward normal side
  const D = -d;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], q = pts[i], r = pts[(i + 1) % n];
    let ax = q.x - p.x, az = q.z - p.z, bx = r.x - q.x, bz = r.z - q.z;
    const la = Math.hypot(ax, az) || 1e-9, lb = Math.hypot(bx, bz) || 1e-9;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const n1x = -az * s, n1z = ax * s, n2x = -bz * s, n2z = bx * s;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { out.push({ x: q.x + n1x * D, z: q.z + n1z * D }); continue; }
    mx /= ml; mz /= ml;
    const len = Math.min(3 * D, D / Math.max(1e-3, mx * n1x + mz * n1z));
    out.push({ x: q.x + mx * len, z: q.z + mz * len });
  }
  return out;
}

function setPavingStyle(geo, style) {
  const uvAttr = geo.attributes.uv;
  for (let i = 0; i < uvAttr.count; i++) uvAttr.setXY(i, style, 0);
  uvAttr.needsUpdate = true;
  return geo;
}

/**
 * Vertical alpha-tested iron fence strips (createIronFenceMaterial) along segments [[x1, z1, x2, z2], ...]:
 * uv.x = metres along the run, uv.y = 0 (bottom) .. 1 (top).
 */
function buildFenceStripGeometry(segments, y0, h) {
  const pos = [];
  const nor = [];
  const uvs = [];
  for (const [x1, z1, x2, z2] of segments) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.4) continue;
    const nx = -(z2 - z1) / len;
    const nz = (x2 - x1) / len;
    const corners = [[x1, z1, 0, 0], [x2, z2, len, 0], [x2, z2, len, 1], [x1, z1, 0, 0], [x2, z2, len, 1], [x1, z1, 0, 1]];
    for (const [x, z, u, v] of corners) {
      pos.push(x, y0 + v * h, z);
      nor.push(nx, 0, nz);
      uvs.push(u, v);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/**
 * Closed polygon outline -> fence segments, skipping the stretches within `gapR` of any gate point {x, z}.
 */
function polygonFenceSegments(pts, gates = [], gapR = 2.0, step = 1.0) {
  const segs = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(len / step));
    let runStart = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const open = gates.some((g) => Math.hypot(g.x - x, g.z - z) < gapR);
      if (!open && runStart === null) runStart = { x, z };
      if ((open || k === n) && runStart !== null) {
        if (Math.hypot(x - runStart.x, z - runStart.z) > 0.4) segs.push([runStart.x, runStart.z, x, z]);
        runStart = null;
      }
    }
  }
  return segs;
}

function buildCityGrid(scene) {
  streetGroundSurfaces = createGroundSurfaces();
  const group = new THREE.Group();
  group.name = 'ManhattanCityGrid';

  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  // Ground footprints that traffic and pedestrians must keep clear of (medians, plazas, monuments, parks)
  const footprints = [];
  const addFootprint = (x, z, w, d) => footprints.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

  // =========================================================================
  // The inhabited footprint meets the dry ground at street level.
  const roadMat = createGroundRoadMaterial();
  const waterMat = createWaterMaterial();
  group.add(createFlatPolygonMesh(CITY_RING, 0, roadMat));

  // 3. PARK LAWN MATERIALS (the harbor islands themselves are built in boroughs.js)
  // =========================================================================
  // One lawn for every park (js/park-materials.js): what makes Sheep Meadow a kept lawn and the Ramble a wood's floor is
  // the park field, not the material
  const cpLawnMat = createGroundLawnMaterial();
  const cpMeadowMat = cpLawnMat;

  // =========================================================================
  // 4. RAISED SIDEWALKS & GRANITE CURBSTONES: every real curb island of Manhattan (city-config.js BLOCKS, from the
  //    street centreline at its curb-to-curb widths). Rectangular islands are instanced slabs; the rest (Broadway's
  //    triangles & trapezoids, Lower Manhattan's irregular blocks, the malls down the middle of Park Ave & Broadway)
  //    are extruded from their outlines
  // =========================================================================
  // The islands' own curbs, sidewalks and gutters come from js/ground.js; these two dress the park paths, plazas and
  // waterfront that are still laid out here
  const sidewalkMat = createGroundWalkMaterial();
  const curbMat = createGroundCurbMaterial();
  const islands = [];
  // Clipped shrubs: the meadow photograph, darker and leafier, laid on the top and run along the sides
  const medianHedgeMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.9 });
  {
    const top = step(0.7, normalWorldGeometry.y);
    const leaves = texture(nature.meadow, vec2(positionWorld.x.add(positionWorld.z), positionWorld.y.mul(1.3)).div(1.4)).rgb;
    const clumps = smoothstep(0.2, 0.8, fract(sin(dot(floor(positionWorld.xz.mul(0.8)), vec2(12.9898, 78.233))).mul(43758.5453)));
    const sides = leaves.mul(mix(vec3(0.42, 0.52, 0.34), vec3(0.6, 0.7, 0.44), clumps));
    const crown = lawnColorNode().mul(mix(vec3(0.72, 0.84, 0.6), vec3(0.94, 1.03, 0.74), clumps));
    // Shade toward the foot of the hedge, where the leaves thin out
    medianHedgeMat.colorNode = mix(sides.mul(smoothstep(0.15, 0.75, positionWorld.y.sub(0.2)).mul(0.45).add(0.55)), crown, top);
  }
  const blockSidewalks = []; // { cx, cz, w, d, block } axis-aligned slabs (irregular islands: their lot cover)
  const curbs = []; // exact rendered outlines, separate from the rectangles used to infer the street grid
  const groundColliders = [];
  const roadSidewalks = []; // the curbs road-network.js bounds the roads with (medians go in as footprints)
  const hedgeGeos = [];
  const SW_TOP = 0.22;
  for (const b of BLOCKS) {
    if (b.park > 0.6 && !b.median && b.parkName !== 'Bryant Park') continue; // parks build their own perimeter sidewalk (sections 7, 7B)
    islands.push(b);
    curbs.push(groundFootprint((b.curb ??= curbOutline(b.poly)).loop));
    addStreetGround(b.curb.loop, SW_TOP);
    if (b.rect) {
      const slab = { cx: (b.minX + b.maxX) * 0.5, cz: (b.minZ + b.maxZ) * 0.5, w: b.maxX - b.minX, d: b.maxZ - b.minZ, block: b };
      blockSidewalks.push(slab);
      if (b.median) addFootprint(slab.cx, slab.cz, slab.w, slab.d);
      else roadSidewalks.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    } else {
      // rect cover for the consumers that work on rectangles: the lot rects grown back out to the curb
      for (const [x0, x1, z0, z1] of b.rects) {
        const r = { minX: x0 - 4.4, maxX: x1 + 4.4, minZ: z0 - 4.4, maxZ: z1 + 4.4 };
        blockSidewalks.push({ cx: (r.minX + r.maxX) * 0.5, cz: (r.minZ + r.maxZ) * 0.5, w: r.maxX - r.minX, d: r.maxZ - r.minZ, block: b, cover: true });
        if (!b.median) roadSidewalks.push(r);
      }
      if (b.median) addFootprint((b.minX + b.maxX) * 0.5, (b.minZ + b.maxZ) * 0.5, b.maxX - b.minX, b.maxZ - b.minZ);
    }
    // Planted malls down the middle of Park Ave, Broadway (Upper West Side), Allen St...: a clipped hedge on the slab
    if (b.median && Math.min(b.maxX - b.minX, b.maxZ - b.minZ) > 2.2) {
      const hedge = offsetPolygonInward(b.poly, 1.0);
      if (hedge) {
        hedgeGeos.push(createExtrudedPolygonMesh(hedge, SW_TOP, 0.55, medianHedgeMat).geometry);
        addStreetGround(hedge, SW_TOP + 0.55);
      }
    }
  }
  const mergeInto = (geos, mat, cast = false) => {
    for (let i = 0; i < geos.length; i += 400) {
      const m = new THREE.Mesh(mergeGeometries(geos.slice(i, i + 400), false), mat);
      m.receiveShadow = true;
      m.castShadow = cast;
      group.add(m);
    }
  };
  mergeInto(hedgeGeos, medianHedgeMat, true);
  // Curbstones with rounded corners, sidewalk flags and gutters of every island
  buildIslands(group, islands);

  // 6. Times Square Pedestrian Plazas, Duffy Square TKTS Red Steps, Herald Square & Flatiron Plaza
  //    Curb-height light-grey granite paver plazas in Broadway's roadbed with granite benches & planters, plus the
  //    shared street-furniture instancing of the plazas & small parks (instanced at the end of section 7B)
  const pavingMat = createParkPavingMaterial();
  const graniteMat = new THREE.MeshStandardNodeMaterial({ color: 0x86837c, roughness: 0.8 }); // benches, planters, copings
  const benchMatrices = []; // NYC Parks "World's Fair" slatted benches
  const lampMatrices = []; // NYC Parks cast-iron lampposts with glass globes
  const treeSites = []; // { x, y, z, scale, species } park & plaza trees planted by street-details.js (section 7)
  const PLAZA_Y = 0.24;
  const pavedRects = []; // plaza & park slab bounds, exported so street trees (street-details.js) stay off them

  function addPavedPlaza(pts, style, topY = PLAZA_Y) {
    group.add(createExtrudedPolygonMesh(pts, 0.0, topY - 0.04, curbMat, true, false));
    const topPoly = offsetConvexPolygon(pts, -0.3);
    const top = createExtrudedPolygonMesh(topPoly, 0.0, topY, pavingMat, true, false);
    setPavingStyle(top.geometry, style);
    group.add(top);
    curbs.push(groundFootprint(pts));
    addStreetGround(pts, topY - 0.04);
    addStreetGround(topPoly, topY);
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    pavedRects.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
  }
  function addBox(mat, x, y, z, w, h, d, rotY = 0, cast = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h * 0.5, z);
    m.rotation.y = rotY;
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  }
  function addPlanter(x, z, w, d, baseY = PLAZA_Y) {
    addBox(graniteMat, x, baseY, z, w, 0.55, d);
    addBox(medianHedgeMat, x, baseY + 0.55, z, w - 0.35, 0.3, d - 0.35, 0, false);
  }
  function addPlanterTree(x, z, species = 1, scale = 0.85) {
    addPlanter(x, z, 2.4, 2.4);
    treeSites.push({ x, y: PLAZA_Y + 0.55, z, scale, species });
  }
  function addBench(x, y, z, rotY) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    benchMatrices.push(dummy.matrix.clone());
  }
  function addLamp(x, y, z) {
    lampMatrices.push(new THREE.Matrix4().makeTranslation(x, y, z));
  }

  // Broadway's pedestrian plazas on the real street grid (city-config.js GEO.plazas: the Broadway roadbed between the
  // cross streets, which carry on across them): Times Square's bowtie where Broadway crosses 7th Ave (42nd-47th St)
  // and Herald Square where it crosses 6th Ave (33rd-35th St). Each strip is cut into the pieces between the cross
  // streets and either side of the avenue it crosses.
  const PLAZA_DEFS = GEO.plazas;
  const streetHalf = (n) => {
    const st = ALL_STREETS.find((t) => t.number === n);
    return st ? st.width * 0.5 : 5;
  };
  // Pieces of a plaza strip (centre a -> b, width w) between streets n0..n1, cut around the avenue `aveId`
  function plazaPieces(def, n0, n1, aveId) {
    const [ax, az] = def.a;
    const [bx, bz] = def.b;
    const hw = def.w * 0.5;
    const xAt = (z) => ax + ((z - az) / (bz - az)) * (bx - ax);
    const ave = ALL_AVENUES.find((a) => a.id === aveId);
    const aveHalf = ave.width * 0.5 + 0.4;
    const pieces = [];
    for (let n = n0; n > n1; n--) {
      const zN = streetZ(n) + streetHalf(n) + 0.6; // south curb of the northern street
      const zS = streetZ(n - 1) - streetHalf(n - 1) - 0.6; // north curb of the southern street
      if (zS - zN < 4) continue;
      const strip = [
        { x: xAt(zN) - hw, z: zN }, { x: xAt(zN) + hw, z: zN }, { x: xAt(zS) + hw, z: zS }, { x: xAt(zS) - hw, z: zS }
      ];
      // either side of the avenue's roadway (x = ave.x +- aveHalf)
      const west = clipPolygonHalfPlane(strip, -1, 0, -(ave.x - aveHalf)); // keeps x <= ave.x - aveHalf
      const east = clipPolygonHalfPlane(strip, 1, 0, ave.x + aveHalf); // keeps x >= ave.x + aveHalf
      for (const piece of [west, east]) {
        if (piece.length >= 3 && Math.abs(polygonCentroidArea(piece)) > 25) pieces.push({ pts: piece, zN, zS, west: piece === west });
      }
    }
    return pieces;
  }
  const tsDef = PLAZA_DEFS.find((d) => d.name === 'Times Square');
  const hsDef = PLAZA_DEFS.find((d) => d.name === 'Herald Square');
  const tsPieces = tsDef ? plazaPieces(tsDef, 47, 42, '7') : [];
  const hsPieces = hsDef ? plazaPieces(hsDef, 35, 33, '6') : [];
  const footprintOf = (pts) => {
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    addFootprint((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  };
  for (const pc of [...tsPieces, ...hsPieces]) {
    addPavedPlaza(pc.pts, 1);
    footprintOf(pc.pts);
  }
  // Times Square: long, low granite benches of the 2017 plaza redesign in staggered rows along the bowtie, planters
  // closing each piece towards the cross streets
  const pieceBox = (pc) => {
    const xs = pc.pts.map((p) => p.x);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), cx: (Math.min(...xs) + Math.max(...xs)) / 2 };
  };
  const insidePiece = (pc, x, z, m = 1.5) => {
    const inner = offsetPolygonInward(pc.pts, m);
    return inner && pointInPolygonXZ(inner, x, z);
  };
  for (const pc of tsPieces) {
    const bx = pieceBox(pc);
    if (bx.maxX - bx.minX < 6) continue;
    for (let z = pc.zN + 6; z <= pc.zS - 6; z += 12) {
      for (const [dx, dz] of [[-0.22, 0], [0.22, -6]]) {
        const x = bx.cx + (bx.maxX - bx.minX) * dx;
        if (insidePiece(pc, x, z + dz, 2)) addBox(graniteMat, x, PLAZA_Y, z + dz, 1.25, 0.46, 8.0);
      }
    }
    for (const z of [pc.zN + 2.2, pc.zS - 2.2]) if (insidePiece(pc, bx.cx, z, 0.8)) addPlanter(bx.cx, z, Math.min(5.5, (bx.maxX - bx.minX) * 0.5), 1.6);
  }

  // Duffy Square TKTS booth (47th St & Broadway): 27 ruby-red glass bleacher steps rising ~5 m to the north, seats
  // facing south down Times Square toward One Times Square, the glazed ticket booth tucked under the top steps.
  // Duffy Square is the bowtie's northern piece west of 7th Ave (46th-47th St)
  const tktsStepMat = createTktsStepMaterial(PLAZA_Y, 0.18);
  const tktsGlassMat = new THREE.MeshStandardNodeMaterial({ color: 0x1b252c, roughness: 0.08, metalness: 0.75 });
  const steelMat = new THREE.MeshStandardNodeMaterial({ color: 0xa3a8ab, roughness: 0.3, metalness: 0.85 });
  const bronzeMat = new THREE.MeshStandardNodeMaterial({ color: 0x4a5a46, roughness: 0.45, metalness: 0.7 });
  const duffyPiece = tsPieces.filter((pc) => pc.west).sort((p, q) => p.zN - q.zN)[0];
  if (duffyPiece) {
    const duffy = { ...pieceBox(duffyPiece), minZ: duffyPiece.zN, maxZ: duffyPiece.zS };
    const tkRun0 = 27 * 0.66;
    const tkX = (duffy.minX + duffy.maxX) * 0.5;
    const tkW = 12.4;
    const tkFrontZ = duffy.minZ + tkRun0 + 4.1;
    const tkSteps = 27;
    const tkRiser = 0.18;
    const tkTread = 0.66;
    const tkRun = tkSteps * tkTread;
    const tkRise = tkSteps * tkRiser;
    for (let s = 0; s < tkSteps; s++) {
      addBox(tktsStepMat, tkX, PLAZA_Y, tkFrontZ - (s + 0.5) * tkTread, tkW, (s + 1) * tkRiser, tkTread);
    }
    // Glazed ticket booth face under the top of the bleachers (47th St side) & a steel canopy edge
    addBox(tktsGlassMat, tkX, PLAZA_Y, tkFrontZ - tkRun - 0.15, tkW - 0.4, tkRise - 0.25, 0.3);
    addBox(steelMat, tkX, PLAZA_Y + tkRise - 0.25, tkFrontZ - tkRun - 0.2, tkW + 0.2, 0.25, 0.5);
    // Sloped steel handrails up both sides and the centre of the steps
    const tkSlope = Math.atan2(tkRise, tkRun);
    const tkRailLen = Math.hypot(tkRise, tkRun);
    for (const rx of [-tkW * 0.5 + 0.12, 0, tkW * 0.5 - 0.12]) {
      const rail = addBox(steelMat, tkX + rx, 0, tkFrontZ - tkRun * 0.5, 0.07, 0.07, tkRailLen, 0, false);
      rail.rotation.x = tkSlope;
      rail.position.y = PLAZA_Y + tkRise * 0.5 + 1.0;
      for (let k = 0; k <= 4; k++) {
        const pz = tkFrontZ - 0.5 - k * ((tkRun - 1.0) / 4);
        const stepTop = PLAZA_Y + Math.ceil((tkFrontZ - pz) / tkTread) * tkRiser;
        addBox(steelMat, tkX + rx, stepTop, pz, 0.06, PLAZA_Y + tkRise * ((tkFrontZ - pz) / tkRun) + 1.0 - stepTop, 0.06, 0, false);
      }
    }
    // Father Duffy statue: bronze chaplain before a granite Celtic cross at the south end of the square
    addBox(graniteMat, tkX, PLAZA_Y, tkFrontZ + 4.4, 1.2, 1.35, 1.2);
    const duffyFigure = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.36, 1.85, 8), bronzeMat);
    duffyFigure.position.set(tkX, PLAZA_Y + 1.35 + 0.925, tkFrontZ + 4.6);
    duffyFigure.castShadow = true;
    group.add(duffyFigure);
    addBox(graniteMat, tkX, PLAZA_Y + 1.35, tkFrontZ + 3.95, 0.36, 3.9, 0.3);
    addBox(graniteMat, tkX, PLAZA_Y + 4.1, tkFrontZ + 3.95, 1.45, 0.34, 0.3);
    addLamp(duffy.minX + 1.2, PLAZA_Y, tkFrontZ + 2.6);
    addLamp(duffy.maxX - 1.2, PLAZA_Y, tkFrontZ + 2.6);
  }

  // Herald Square (34th-35th St) & Greeley Square: planted honey locusts in granite planters, benches & lampposts on the
  // larger pieces
  for (const pc of hsPieces) {
    const bx = pieceBox(pc);
    if (bx.maxX - bx.minX < 7 || pc.zS - pc.zN < 20) continue;
    for (let z = pc.zN + 8; z <= pc.zS - 8; z += 16) {
      if (!insidePiece(pc, bx.cx, z, 3)) continue;
      addPlanterTree(bx.cx, z, 1, 0.9);
      addBench(bx.cx - 4.6, PLAZA_Y, z + 5.5, Math.PI * 0.5);
      addBench(bx.cx + 4.6, PLAZA_Y, z + 5.5, -Math.PI * 0.5);
    }
    addLamp(bx.cx - 5.5, PLAZA_Y, pc.zN + 3);
    addLamp(bx.cx + 5.5, PLAZA_Y, pc.zS - 3);
  }

  // =========================================================================
  // 7. CENTRAL PARK (59th to 110th St, 5th Ave to Central Park West) from its real features (city-config.js GEO:
  //    the NYC Parks outline, OpenStreetMap's meadows, water bodies, loop drives & landmarks, the transverses from the
  //    street centreline)
  // =========================================================================
  const cpWallMat = new THREE.MeshStandardNodeMaterial({
    color: 0x6e6a63,
    roughness: 0.78
  });
  const cpPathMat = new THREE.MeshStandardNodeMaterial({
    color: 0xb8afa0,
    roughness: 0.74
  });
  // Where paving or water meets the grass, and the schist of the outcrops (js/park-materials.js)
  const CP_LAWN = 1.2; // between the wood's floor (1.19) and the kept lawns laid over it (1.21)
  const cpEdgeMat = createParkEdgeMaterial();
  const schistRockMat = createGroundRockMaterial(CP_LAWN);
  const marbleArchMat = new THREE.MeshStandardNodeMaterial({
    color: 0xd2cbbd,
    roughness: 0.62
  });

  const CPG = GEO.centralPark;
  const flatPts = (flat) => {
    const o = [];
    for (let i = 0; i < flat.length; i += 2) o.push({ x: flat[i], z: flat[i + 1] });
    return o;
  };
  const cpSite = (name) => CPG.sites.find((t) => t.name === name);

  // Perimeter sidewalk: the park's curb island (BLOCKS), with the schist wall along the real park line inside it
  const cpBlock = BLOCKS.filter((b) => b.parkName === 'Central Park').sort((a, b) => b.area - a.area)[0];
  if (cpBlock) {
    curbs.push(groundFootprint(cpBlock.poly));
    addStreetGround(cpBlock.poly, 0.18);
    group.add(createExtrudedPolygonMesh(cpBlock.poly, 0.0, 0.18, curbMat, true, true));
    const sw = offsetPolygonInward(cpBlock.poly, 0.25);
    if (sw) {
      group.add(createExtrudedPolygonMesh(sw, 0.03, 0.19, sidewalkMat));
      addStreetGround(sw, 0.22);
    }
    addFootprint((cpBlock.minX + cpBlock.maxX) * 0.5, (cpBlock.minZ + cpBlock.maxZ) * 0.5, cpBlock.maxX - cpBlock.minX, cpBlock.maxZ - cpBlock.minZ);
  }
  // Low coursed-schist perimeter wall (~0.8 m above the sidewalk) with the lawn a little inside it
  const cpWall = flatPts(CPG.outline);
  group.add(createExtrudedPolygonMesh(cpWall, 0.0, 1.05, createParkWallMaterial(), true, false));
  addStreetGround(cpWall, 1.05);
  const cpLawnPts = offsetPolygonInward(cpWall, 0.6) || cpWall;
  group.add(createExtrudedPolygonMesh(cpLawnPts, 0.85, 0.34, cpLawnMat, true, false));
  addStreetGround(cpLawnPts, 1.19, { grip: 0.62, rough: 0.024, curb: false });
  groundColliders.push(...groundBoundaryColliders(cpWall, cpLawnPts, 0, 1.05));

  // Sunlit open meadows & lawns: Sheep Meadow, the Great Lawn, North Meadow, the Great Hill, Cedar & Pilgrim Hills...
  const cpLawnPolys = CPG.lawns.map((l) => flatPts(l.ring));
  for (const pts of cpLawnPolys) {
    group.add(createFlatPolygonMesh(pts, 1.21, cpMeadowMat, true));
    addStreetGround(pts, 1.21, { grip: 0.62, rough: 0.024, curb: false });
  }

  // Water: the Lake, the Jacqueline Kennedy Onassis Reservoir (raised in its stone basin, ringed by the running
  // track), Harlem Meer, the Pond, Turtle Pond, the Pool & Conservatory Water
  const cpWaterPolys = [], cpWaterBodies = [];
  for (const w of CPG.water) {
    const pts = flatPts(w.ring);
    cpWaterPolys.push(pts);
    // for what lands on it (controllers.js parkWaterAt): its outline, its level and its bounds
    cpWaterBodies.push({ name: w.name, pts, y: w.name === 'Jacqueline Kennedy Onassis Reservoir' ? 1.58 : 1.24,
      minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minZ: Math.min(...pts.map((p) => p.z)), maxZ: Math.max(...pts.map((p) => p.z)) });
    if (w.name === 'Jacqueline Kennedy Onassis Reservoir') {
      const track = offsetPolygon(pts, -6);
      if (track) {
        group.add(createExtrudedPolygonMesh(track, 1.18, 0.38, cpPathMat, true, false));
        addStreetGround(track, 1.56);
      }
      group.add(createFlatPolygonMesh(pts, 1.58, waterMat, true));
    } else {
      group.add(createFlatPolygonMesh(pts, 1.24, waterMat, true));
    }
  }
  // No lawn runs to the water on a ruled line: a band of mud and pebbles along every shore but the reservoir's
  group.add(buildParkShores(CPG.water.filter((w) => w.name !== 'Jacqueline Kennedy Onassis Reservoir'), { edge: cpEdgeMat, y: 1.24, lawn: CP_LAWN }));

  // The loop drives (East, West, Center & Terrace Drives, car-free) and the four transverse roads crossing the park
  const cpDrives = [];
  const cpTransverses = [];
  for (const d of CPG.drives) {
    const wp = [];
    for (let i = 0; i < d.pts.length; i += 2) wp.push([d.pts[i], d.pts[i + 1]]);
    if (wp.length < 2) continue;
    (d.transverse ? cpTransverses : cpDrives).push(wp);
  }
  // Ribbons of the streets' own asphalt, a shoulder of trodden earth each side (js/park-ground.js); their lines are
  // painted with the rest of the island's, once the paint builder exists (section 11)
  const CP_DRIVE_TOP = 1.24, CP_TRANSVERSE_TOP = 1.255;
  // and the 70 km of footpaths (OpenStreetMap), paved or, like the bridle path and the trails of the Ramble, earth.
  // The paths run under the drives where they cross them.
  const cpWays = [
    ...CPG.drives.map((d) => ({ pts: d.pts, width: d.transverse ? Math.max(9, d.w || 10) : d.w || 8.5, y: d.transverse ? CP_TRANSVERSE_TOP : CP_DRIVE_TOP })),
    ...CPG.paths.map(([width, earth, pts]) => ({ pts, width, earth: !!earth, y: earth ? CP_LAWN + 0.022 : 1.228, shoulder: 0.8 }))
  ];
  for (const mesh of buildParkWays(cpWays, { asphalt: roadMat, edge: cpEdgeMat, lawn: CP_LAWN })) {
    group.add(mesh);
    streetGroundSurfaces.addTriangles(mesh.geometry.attributes.position.array, mesh.geometry.index.array,
      mesh.name === 'ParkWays' ? { rough: 0.0035, curb: false } : { grip: 0.66, rough: 0.018, curb: false });
  }
  // Trees keep their trunks off the paths (their crowns meet over them): the path segments by 24 m cell
  const pathCells = new Map();
  for (const [width, , pts] of CPG.paths) {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const seg = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3], width / 2 + 1.7];
      for (let ix = Math.floor((Math.min(seg[0], seg[2]) - seg[4]) / 24); ix <= Math.floor((Math.max(seg[0], seg[2]) + seg[4]) / 24); ix++) {
        for (let iz = Math.floor((Math.min(seg[1], seg[3]) - seg[4]) / 24); iz <= Math.floor((Math.max(seg[1], seg[3]) + seg[4]) / 24); iz++) {
          const key = ix * 4096 + iz;
          if (!pathCells.has(key)) pathCells.set(key, []);
          pathCells.get(key).push(seg);
        }
      }
    }
  }
  const nearPath = (x, z) => {
    for (const [ax, az, bx, bz, clear] of pathCells.get(Math.floor(x / 24) * 4096 + Math.floor(z / 24)) || []) {
      const dx = bx - ax, dz = bz - az;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - ax - dx * u, z - az - dz * u) < clear) return true;
    }
    return false;
  };

  // Stone arch bridges: Gapstow Bridge over the Pond, Bow Bridge across the Lake (spanning their real headings)
  const gapstow = cpSite('Gapstow Bridge');
  if (gapstow) addStoneArchBridge(group, gapstow.x, gapstow.z, -gapstow.ang, 24.0, 5.2, 2.25, cpWallMat, cpPathMat);
  const bow = cpSite('Bow Bridge');
  if (bow) addStoneArchBridge(group, bow.x, bow.z, -bow.ang, 30.0, 4.8, 2.1, marbleArchMat, cpPathMat);

  // The Mall / Literary Walk (66th to 72nd St) up to Bethesda Terrace & the Angel of the Waters fountain: hex asphalt
  // pavers (the park paving's style 0) under the elm allée, not the pale gravel of the walks, which read as a white strip
  const beth = cpSite('Bethesda Fountain') || { x: -380, z: -2434 };
  const MALL_LEN = 390;
  const mallX = beth.x + 6;
  const mallZ0 = beth.z + 46; // Bethesda Terrace's south (upper) terrace
  const mallGeo = new THREE.BoxGeometry(18, 0.16, MALL_LEN);
  setPavingStyle(mallGeo, 0);
  const mallPromenade = new THREE.Mesh(mallGeo, pavingMat);
  mallPromenade.position.set(mallX, 1.18, mallZ0 + MALL_LEN * 0.5);
  mallPromenade.receiveShadow = true;
  group.add(mallPromenade);
  addStreetGround(rectPolygon(mallX - 9, mallX + 9, mallZ0, mallZ0 + MALL_LEN), 1.26);
  const bethesdaTerrace = new THREE.Mesh(new THREE.BoxGeometry(48, 2.2, 16), marbleArchMat);
  bethesdaTerrace.position.set(beth.x + 4, 1.8, beth.z + 20);
  group.add(bethesdaTerrace);
  const bethesdaBasin = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 10.2, 1.1, 20), marbleArchMat);
  bethesdaBasin.position.set(beth.x, 1.5, beth.z);
  group.add(bethesdaBasin);
  const bethesdaStatue = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 1.6, 5.2, 10),
    new THREE.MeshStandardNodeMaterial({ color: 0x5c7a68, metalness: 0.65, roughness: 0.35 })
  );
  bethesdaStatue.position.set(beth.x, 3.8, beth.z);
  group.add(bethesdaStatue);

  const belv = cpSite('Belvedere Castle') || { x: -506, z: -3000 };
  // The park's real outcrops (OpenStreetMap: Umpire Rock, Rat Rock, the Hernshead and a hundred unnamed ones), each a
  // whaleback the glacier left (js/park-plan.js outcrop), as high as it is broad; and Vista Rock, built up under the
  // castle that stands on it
  const rockHash = (i) => { const v = Math.sin(i * 127.1 + 3.7) * 43758.5453; return v - Math.floor(v); };
  const cpRocks = CPG.rocks.map(([x, z, a, b, ang], i) => {
    const big = Math.max(a, b);
    return {
      x, z, rx: a, rz: b, turn: -ang, seed: i + 1,
      height: Math.min(4.4, Math.max(0.5, 0.3 + 0.2 * Math.min(a, b))) * (0.75 + 0.5 * rockHash(i)),
      rings: big > 18 ? 20 : big > 8 ? 14 : 10, segments: big > 18 ? 64 : big > 8 ? 48 : 32
    };
  });
  cpRocks.push({ x: belv.x - 2, z: belv.z + 6, rx: 12.9, rz: 10.4, height: 5.75, turn: belv.x * 0.12, seed: 997 });
  const outcrops = buildOutcrops(cpRocks, { material: schistRockMat, y: CP_LAWN });
  for (const mesh of outcrops.meshes) group.add(mesh);

  // Belvedere Castle overlooking Vista Rock & Turtle Pond (79th St)
  const castleKeep = new THREE.Mesh(new THREE.BoxGeometry(12, 11, 10), cpWallMat);
  castleKeep.position.set(belv.x, 10.5, belv.z);
  group.add(castleKeep);
  const castleTurret = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 16, 12), cpWallMat);
  castleTurret.position.set(belv.x + 6, 13.0, belv.z + 3);
  group.add(castleTurret);

  // Areas the Central Park woodland (street-details.js section 7) must keep clear: meadows, water, the loop
  // drives, the transverses, the Mall elm allée, Bethesda Terrace, Belvedere Castle & the schist outcrops
  const gap = cpSite('Pulitzer Fountain') || { x: -32, z: -1327 };
  centralParkClearings = {
    polygons: [...cpLawnPolys, ...cpWaterPolys],
    water: cpWaterBodies,
    drives: [...cpDrives, ...cpTransverses],
    transverseZ: [],
    rects: [
      { minX: mallX - 19, maxX: mallX + 19, minZ: mallZ0, maxZ: mallZ0 + MALL_LEN }, // The Mall & Literary Walk
      { minX: beth.x - 24, maxX: beth.x + 28, minZ: beth.z - 12, maxZ: beth.z + 30 }, // Bethesda Terrace & fountain
      { minX: belv.x - 10, maxX: belv.x + 12, minZ: belv.z - 8, maxZ: belv.z + 10 } // Belvedere Castle
    ],
    circles: cpRocks.map((r) => ({ x: r.x, z: r.z, r: Math.max(r.rx, r.rz) * 0.9 + 2 })),
    nearPath,
    mall: { x: mallX, z0: mallZ0, z1: mallZ0 + MALL_LEN }
  };

  // 6. Grand Army Plaza (5th Ave & 59th St: the Pulitzer Fountain, Sherman's gilded statue) & Columbus Circle
  const gapPlaza = new THREE.Mesh(new THREE.CylinderGeometry(16, 17, 0.45, 24), marbleArchMat);
  gapPlaza.position.set(gap.x, 0.25, gap.z);
  group.add(gapPlaza);
  addFootprint(gap.x, gap.z, 34, 34);
  const shermanGold = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 4.2, 4.4),
    new THREE.MeshStandardNodeMaterial({ color: 0xffc938, metalness: 0.78, roughness: 0.22 })
  );
  shermanGold.position.set(gap.x, 2.6, gap.z - 28);
  group.add(shermanGold);

  const colC = cpSite('Columbus Circle') || { x: -860, z: -1375 };
  const columbusCircle = new THREE.Mesh(new THREE.CylinderGeometry(15, 16, 0.5, 24), marbleArchMat);
  columbusCircle.position.set(colC.x, 0.25, colC.z);
  group.add(columbusCircle);
  addFootprint(colC.x, colC.z, 32, 32);
  const columbusColumn = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, 18, 12), marbleArchMat);
  columbusColumn.position.set(colC.x, 9.5, colC.z);
  group.add(columbusColumn);

  // 7B. Madison Square Park, Union Square Park, Washington Square Park, Tompkins Square Park & Battery Park
  //     Flush with the sidewalks: hex-paver walks, granite-coped lawn beds with low hoop fences between radial &
  //     diagonal paths, a cast-iron perimeter fence on a granite coping, benches, lampposts & a dense plane canopy
  const PARK_Y = 0.26; // hex-paver walks (sidewalk tops are at 0.22)
  const BED_Y = 0.41; // lawn top inside the granite bed copings
  const parkLawnGeos = [];
  const parkFenceGeos = [];
  const inPolygon = (x, z, pts) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  };
  const prand = (x, z, k = 0) => {
    const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
    return s - Math.floor(s);
  };
  const polygonArea = (pts) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      a += p.x * q.z - q.x * p.z;
    }
    return a * 0.5;
  };

  // Scatters trees on a jittered grid inside polygon `pts` (kept `margin` m from its edges)
  function scatterParkTrees(pts, spacing, y, margin, speciesMix) {
    const inner = offsetConvexPolygon(pts, -margin);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of inner) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    for (let gx = x0; gx <= x1; gx += spacing) {
      for (let gz = z0; gz <= z1; gz += spacing) {
        const tx = gx + (prand(gx, gz) - 0.5) * spacing * 0.7;
        const tz = gz + (prand(gz, gx, 1) - 0.5) * spacing * 0.7;
        if (!inPolygon(tx, tz, inner)) continue;
        const r = prand(tx, tz, 2);
        const species = r < speciesMix[0] ? 0 : (r < speciesMix[0] + speciesMix[1] ? 1 : 2);
        treeSites.push({ x: tx, y, z: tz, scale: 0.95 + prand(tx, tz, 3) * 0.35, species });
      }
    }
  }

  // Benches (backs to the bed coping, facing the walk) & lampposts along the edges of a lawn bed
  function lineBedEdges(bed, benchStep = 7.0) {
    const s = polygonArea(bed) > 0 ? 1 : -1;
    for (let i = 0; i < bed.length; i++) {
      const a = bed[i];
      const b = bed[(i + 1) % bed.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 6) continue;
      const nx = (s * (b.z - a.z)) / len;
      const nz = (-s * (b.x - a.x)) / len;
      const count = Math.floor((len - 3) / benchStep);
      for (let k = 0; k < count; k++) {
        const t = (1.5 + benchStep * (k + 0.5) + (len - 3 - count * benchStep) * 0.5) / len;
        const px = a.x + (b.x - a.x) * t;
        const pz = a.z + (b.z - a.z) * t;
        if (k % 3 === 1) addLamp(px + nx * 0.55, PARK_Y, pz + nz * 0.55);
        else addBench(px + nx * 0.62, PARK_Y, pz + nz * 0.62, Math.atan2(nx, nz));
      }
    }
  }

  // Lawn beds of one park cell: the sectors between path rays radiating from the hub, minus walks & hub plaza. A cell
  // is a rect (minX..maxZ) or a convex polygon `poly` (rays default to its corners, the hub to its centroid)
  function buildParkCell(cell, speciesMix) {
    const { minX, maxX, minZ, maxZ } = cell;
    const corners = cell.poly ?? rectPolygon(minX, maxX, minZ, maxZ);
    const c0 = cell.poly ? polygonCentroid(cell.poly) : { x: (minX + maxX) * 0.5, z: (minZ + maxZ) * 0.5 };
    const hx = cell.hubX ?? c0.x;
    const hz = cell.hubZ ?? c0.z;
    const halfPath = (cell.pathW ?? 3.0) * 0.5;
    const hubR = cell.hubR ?? 4.0;
    const rays = (cell.rays ?? corners.map((p) => Math.atan2(p.z - hz, p.x - hx)))
      .concat(cell.extraRays ?? []).sort((a, b) => a - b);
    cell.rayList = rays;
    for (let i = 0; i < rays.length; i++) {
      const a1 = rays[i];
      const a2 = i + 1 < rays.length ? rays[i + 1] : rays[0] + Math.PI * 2;
      let poly = corners.map((p) => ({ x: p.x - hx, z: p.z - hz }));
      poly = clipPolygonHalfPlane(poly, -Math.sin(a1), Math.cos(a1), halfPath);
      poly = clipPolygonHalfPlane(poly, Math.sin(a2), -Math.cos(a2), halfPath);
      for (const f of [0.25, 0.5, 0.75]) {
        const am = a1 + (a2 - a1) * f;
        poly = clipPolygonHalfPlane(poly, Math.cos(am), Math.sin(am), hubR + halfPath + 0.6);
      }
      if (poly.length < 3 || Math.abs(polygonArea(poly)) < 30) continue;
      const bed = poly.map((p) => ({ x: p.x + hx, z: p.z + hz }));
      group.add(createExtrudedPolygonMesh(bed, 0.2, BED_Y - 0.21, graniteMat, true, false));
      const lawn = offsetConvexPolygon(bed, -0.3);
      parkLawnGeos.push(createExtrudedPolygonMesh(lawn, 0.3, BED_Y - 0.3, cpLawnMat).geometry);
      addStreetGround(bed, BED_Y - 0.01);
      addStreetGround(lawn, BED_Y, { grip: 0.66, rough: 0.018, curb: false });
      const hoop = offsetConvexPolygon(bed, -0.18);
      parkFenceGeos.push(buildFenceStripGeometry(hoop.map((p, k) => {
        const q = hoop[(k + 1) % hoop.length];
        return [p.x, p.z, q.x, q.z];
      }), BED_Y - 0.01, 0.5));
      lineBedEdges(bed);
      scatterParkTrees(bed, cell.treeSpacing ?? 9.0, BED_Y, 2.0, speciesMix);
    }
    // Paved hub plaza (bluestone) with an optional granite-rimmed fountain basin
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR + 0.6, hubR + 0.6, 0.03, 40), pavingMat);
    setPavingStyle(hub.geometry, 2);
    hub.position.set(hx, PARK_Y + 0.005, hz);
    hub.receiveShadow = true;
    group.add(hub);
    if (cell.fountain) {
      const f = cell.fountain;
      const basin = [[f + 0.18, 0], [f, 0.5], [f - 0.4, 0.5], [f - 0.4, 0.26]].map(([r, y]) => new THREE.Vector2(r, y));
      const rim = new THREE.Mesh(new THREE.LatheGeometry(basin, 40), graniteMat);
      rim.position.set(hx, PARK_Y, hz);
      rim.receiveShadow = true;
      group.add(rim);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(f - 0.39, 40).rotateX(-Math.PI / 2), waterMat);
      pool.position.set(hx, PARK_Y + 0.3, hz);
      group.add(pool);
      if (f > 6) {
        addBox(graniteMat, hx, PARK_Y + 0.28, hz, 1.6, 0.5, 1.6, Math.PI / 4);
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 0.6, 0.35, 24), graniteMat);
        bowl.position.set(hx, PARK_Y + 0.95, hz);
        group.add(bowl);
      }
    }
    return { hx, hz, rays };
  }

  // Perimeter of a small park: hex-paver slab flush with the sidewalks, granite coping & iron fence set back from
  // the curb (gates where the walks come out), and a row of big London planes & lampposts along the outer sidewalk.
  // pk.clipToShore: the slab, fence and tree row keep to the island's asphalt deck where the shore cuts a corner off
  function buildSmallPark(pk) {
    const minX = pk.x - pk.w * 0.5;
    const maxX = pk.x + pk.w * 0.5;
    const minZ = pk.z - pk.d * 0.5;
    const maxZ = pk.z + pk.d * 0.5;
    const slab = pk.clipToShore ? clipPolygonToConvex(CITY_RING, rectPolygon(minX, maxX, minZ, maxZ)) : rectPolygon(minX, maxX, minZ, maxZ);
    addPavedPlaza(slab, 0, PARK_Y);
    addFootprint(pk.x, pk.z, pk.w, pk.d);
    const fi = 2.6; // outer sidewalk width
    const fMinX = minX + fi;
    const fMaxX = maxX - fi;
    const fMinZ = minZ + fi;
    const fMaxZ = maxZ - fi;
    const inset = fi + 3.0;
    const gates = [...(pk.gates ?? [])];
    for (const c of pk.cells) {
      const cell = { minX: minX + inset, maxX: maxX - inset, minZ: minZ + inset, maxZ: maxZ - inset - (pk.southPlaza ?? 0), ...c };
      const { hx, hz, rays } = buildParkCell(cell, pk.speciesMix);
      for (const a of rays) {
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        const tx = dx > 1e-6 ? (fMaxX - hx) / dx : (dx < -1e-6 ? (fMinX - hx) / dx : Infinity);
        const tz = dz > 1e-6 ? (fMaxZ - hz) / dz : (dz < -1e-6 ? (fMinZ - hz) / dz : Infinity);
        const t = Math.min(tx, tz);
        gates.push({ x: hx + dx * t, z: hz + dz * t });
      }
    }
    const fenceSegs = polygonFenceSegments(pk.clipToShore ? offsetConvexPolygon(slab, -fi) : rectPolygon(fMinX, fMaxX, fMinZ, fMaxZ), gates, 2.3)
      .filter(([, z1, , z2]) => !(pk.openSouth && z1 > fMaxZ - 0.1 && z2 > fMaxZ - 0.1));
    for (const [x1, z1, x2, z2] of fenceSegs) {
      const len = Math.hypot(x2 - x1, z2 - z1);
      addBox(graniteMat, (x1 + x2) * 0.5, PARK_Y - 0.02, (z1 + z2) * 0.5, 0.42, 0.34, len + 0.2, Math.atan2(x2 - x1, z2 - z1), false);
    }
    parkFenceGeos.push(buildFenceStripGeometry(fenceSegs, PARK_Y + 0.32, 0.95));

    // London planes & lampposts lining the perimeter sidewalk (kept clear of the corners & gates)
    const row = pk.clipToShore ? offsetConvexPolygon(slab, -1.3) : rectPolygon(minX + 1.3, maxX - 1.3, minZ + 1.3, maxZ - 1.3);
    for (let i = 0; i < row.length; i++) {
      const a = row[i];
      const b = row[(i + 1) % row.length];
      if (pk.openSouth && a.z > pk.z && b.z > pk.z) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.floor((len - 8) / 8.5);
      for (let k = 0; k <= n; k++) {
        const t = (4 + k * ((len - 8) / Math.max(1, n))) / len;
        const px = a.x + (b.x - a.x) * t;
        const pz = a.z + (b.z - a.z) * t;
        if (gates.some((g) => Math.hypot(g.x - px, g.z - pz) < 3.6)) continue;
        if (k % 4 === 2) addLamp(px, PARK_Y, pz);
        else treeSites.push({ x: px, y: PARK_Y, z: pz, scale: 1.05 + prand(px, pz, 4) * 0.3, species: 0 });
      }
    }
    return { minX, maxX, minZ, maxZ, fi, inset };
  }

  const blockAtPoint = (x, z) => blockAt(x, z);
  const QUARTER = Math.PI * 0.5;
  // The squares on their real blocks (curb islands tagged by NYC Parks): Madison Square Park (23rd-26th St, 5th to
  // Madison Ave) facing the Flatiron, Union Square (14th-17th St), Washington Square Park at the foot of 5th Ave and
  // Tompkins Square Park (Ave A-B, 7th-10th St)
  const parkBlock = (name) => BLOCKS.filter((b) => b.parkName === name && !b.median).sort((a, b) => b.area - a.area)[0];
  const parkRect = (name, extra) => {
    const b = parkBlock(name);
    return b ? { x: (b.minX + b.maxX) * 0.5, z: (b.minZ + b.maxZ) * 0.5, w: b.maxX - b.minX, d: b.maxZ - b.minZ, block: b, ...extra } : null;
  };
  const smallParks = {};
  const wsq = parkRect('Washington Square Park');
  const x5 = avenueX('5');
  for (const [key, def] of Object.entries({
    // diagonal & N-S walks, oval fountain
    madison: parkRect('Madison Square Park', { speciesMix: [0.7, 0.1], cells: [{ extraRays: [-QUARTER, QUARTER], hubR: 6, fountain: 4.2 }] }),
    // lawns & walks north of the open granite south plaza on 14th St
    union: parkRect('Union Square Park', { speciesMix: [0.75, 0.15], southPlaza: 18, openSouth: true, cells: [{ extraRays: [-QUARTER, 0, Math.PI], hubR: 5 }] }),
    // radial walks to the central fountain, the Arch at the foot of 5th Ave
    washington: wsq && { ...wsq, speciesMix: [0.65, 0.1], gates: [-3, 0, 3].map((dx) => ({ x: x5 + dx, z: wsq.z - wsq.d * 0.5 + 2.6 })), cells: [{ extraRays: [-QUARTER, QUARTER, 0, Math.PI], hubR: 12, fountain: 8.0 }] },
    // radial & cross walks under big elms & planes
    tompkins: parkRect('Tompkins Square Park', { speciesMix: [0.45, 0.1], cells: [{ extraRays: [-QUARTER, QUARTER, 0, Math.PI], hubR: 4.5 }] })
  })) if (def) smallParks[key] = def;
  const parkFrames = {};
  for (const key of Object.keys(smallParks)) parkFrames[key] = buildSmallPark(smallParks[key]);

  // Washington Square Arch (white marble, 1892) at the foot of 5th Ave, over the park's north-east entrance
  const wsArchX = avenueX('5');
  const wsArchZ = parkFrames.washington ? parkFrames.washington.minZ + 4.6 : 2815;
  if (parkFrames.washington) {
    const archShape = new THREE.Shape();
    archShape.moveTo(-8.5, 0);
    archShape.lineTo(-4.4, 0);
    archShape.lineTo(-4.4, 8.6);
    archShape.absarc(0, 8.6, 4.4, Math.PI, 0, true);
    archShape.lineTo(4.4, 0);
    archShape.lineTo(8.5, 0);
    archShape.lineTo(8.5, 17.4);
    archShape.lineTo(-8.5, 17.4);
    archShape.closePath();
    const archGeo = new THREE.ExtrudeGeometry(archShape, { depth: 4.4, bevelEnabled: false, curveSegments: 16 });
    archGeo.translate(0, 0, -2.2);
    const archMat = createMarbleAshlarMaterial();
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.position.set(wsArchX, PARK_Y, wsArchZ);
    arch.castShadow = true;
    arch.receiveShadow = true;
    group.add(arch);
    addBox(archMat, wsArchX, PARK_Y + 16.3, wsArchZ, 17.3, 1.1, 4.62); // frieze
    addBox(archMat, wsArchX, PARK_Y + 17.4, wsArchZ, 18.2, 0.75, 5.0); // cornice
    addBox(archMat, wsArchX, PARK_Y + 18.15, wsArchZ, 17.2, 2.7, 4.6); // attic
    addBox(archMat, wsArchX, PARK_Y + 20.85, wsArchZ, 17.6, 0.35, 4.8); // attic coping
    addBox(archMat, wsArchX, PARK_Y + 7.9, wsArchZ, 17.4, 0.6, 4.7); // impost band
    for (const sx of [-6.45, 6.45]) {
      addBox(archMat, wsArchX + sx, PARK_Y, wsArchZ, 4.5, 1.3, 5.0); // pier plinths
      // "Washington at War" & "Washington at Peace": statue groups on pedestals against the piers' north faces
      const fz = wsArchZ - 2.5 - 0.95;
      addBox(archMat, wsArchX + sx, PARK_Y, fz, 3.4, 2.4, 1.8);
      addBox(archMat, wsArchX + sx, PARK_Y + 2.4, fz, 0.9, 3.3, 0.8); // Washington
      addBox(archMat, wsArchX + sx, PARK_Y + 5.7, fz, 0.45, 0.5, 0.45);
      for (const fx of [-1.05, 1.05]) addBox(archMat, wsArchX + sx + fx, PARK_Y + 2.4, fz + 0.15, 0.75, 2.5, 0.7, fx * 0.3); // allegorical figures
    }
  }
  const nearArch = (x, z) => Math.abs(x - wsArchX) < 11 && z > wsArchZ - 6 && z < wsArchZ + 4.5;
  for (let i = treeSites.length - 1; i >= 0; i--) {
    if (nearArch(treeSites[i].x, treeSites[i].z)) treeSites.splice(i, 1);
  }
  for (let i = lampMatrices.length - 1; i >= 0; i--) {
    if (nearArch(lampMatrices[i].elements[12], lampMatrices[i].elements[14])) lampMatrices.splice(i, 1);
  }

  // Union Square's open granite south plaza on 14th St with the George Washington equestrian statue (facing south)
  if (parkFrames.union) {
    const f = parkFrames.union;
    const pz0 = f.maxZ - f.inset - smallParks.union.southPlaza;
    const plaza = addBox(pavingMat, smallParks.union.x, PARK_Y - 0.03, (pz0 + f.maxZ - 0.3) * 0.5, smallParks.union.w - 0.6, 0.05, f.maxZ - 0.3 - pz0, 0, false);
    setPavingStyle(plaza.geometry, 1);
    const sx = smallParks.union.x;
    const sz = pz0 + 4.0;
    const top = PARK_Y + 3.6;
    addBox(graniteMat, sx, PARK_Y, sz, 4.0, 0.55, 6.0); // stepped granite plinth, die & cornice
    addBox(graniteMat, sx, PARK_Y + 0.55, sz, 2.4, 2.7, 4.4);
    addBox(graniteMat, sx, PARK_Y + 3.25, sz, 2.9, 0.35, 4.9);
    addBox(bronzeMat, sx, top + 1.05, sz, 0.95, 1.15, 2.7); // horse body
    for (const [lx, lz] of [[-0.3, -1.0], [0.3, -1.0], [-0.3, 1.0], [0.3, 1.0]]) addBox(bronzeMat, sx + lx, top, sz + lz, 0.2, 1.1, 0.22);
    const neck = addBox(bronzeMat, sx, top + 1.6, sz + 1.45, 0.5, 1.3, 0.6);
    neck.rotation.x = 0.5;
    addBox(bronzeMat, sx, top + 2.2, sz - 0.1, 0.62, 1.2, 0.5); // rider
    addBox(bronzeMat, sx, top + 3.4, sz - 0.1, 0.3, 0.32, 0.3);
    const arm = addBox(bronzeMat, sx + 0.38, top + 2.9, sz + 0.2, 0.14, 0.9, 0.14);
    arm.rotation.x = 0.9;
  }

  const district = { ground: streetGroundSurfaces, colliders: groundColliders, addTree: site => treeSites.push(site), addBench, addLamp };
  // Keep these surfaces out of the at-grade road cut. The footbridge crosses the reserved highway at a different height.
  const authoredGround = new THREE.Group();
  authoredGround.name = 'ManhattanAuthoredGround';
  scene.add(authoredGround);
  const gardenVisits = [...buildCathedralClose(authoredGround, district), ...buildUrbanPlaces(authoredGround, district, { coreOnly: true }),
    ...buildManhattanGrounds(authoredGround, district, { coreOnly: true })];

  // ---- Every other park block (Riverside, Marcus Garvey, Stuyvesant Square, City Hall Park, the
  //      Battery...): its curb island paved like a park walk, a granite-coped lawn inset from it under scattered trees
  //      (big planes along the walk), lampposts on the perimeter
  const SPECIAL_PARKS = new Set(['Central Park', 'Madison Square Park', 'Union Square Park', 'Washington Square Park', 'Tompkins Square Park', 'Bryant Park']);
  const genericParks = BLOCKS.filter((b) => b.park > 0.6 && !b.median && !SPECIAL_PARKS.has(b.parkName) && b.area > 250);
  for (const b of genericParks) {
    const slab = offsetPolygonInward(b.poly, 0.1) || b.poly;
    group.add(createExtrudedPolygonMesh(b.poly, 0.0, PARK_Y - 0.04, curbMat, true, false));
    const top = createExtrudedPolygonMesh(slab, 0.0, PARK_Y, pavingMat, true, false);
    setPavingStyle(top.geometry, 0);
    group.add(top);
    curbs.push(groundFootprint(b.poly));
    addStreetGround(b.poly, PARK_Y - 0.04);
    addStreetGround(slab, PARK_Y);
    pavedRects.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    if (b.parkName === MORNINGSIDE_PARK) {
      // The curb polygon already bounds traffic. The diagonal park's box would close the sidewalks on Amsterdam.
      gardenVisits.push(buildMorningsidePark(authoredGround, b, district));
      continue;
    }
    addFootprint((b.minX + b.maxX) * 0.5, (b.minZ + b.maxZ) * 0.5, b.maxX - b.minX, b.maxZ - b.minZ);
    const bed = offsetPolygonInward(b.poly, Math.min(5, Math.min(b.maxX - b.minX, b.maxZ - b.minZ) * 0.2));
    if (!bed) continue;
    group.add(createExtrudedPolygonMesh(bed, 0.2, BED_Y - 0.21, graniteMat, true, false));
    const lawnTop = offsetPolygonInward(bed, 0.3);
    if (lawnTop) {
      parkLawnGeos.push(createExtrudedPolygonMesh(lawnTop, 0.3, BED_Y - 0.3, cpLawnMat).geometry);
      addStreetGround(bed, BED_Y - 0.01);
      addStreetGround(lawnTop, BED_Y, { grip: 0.66, rough: 0.018, curb: false });
    }
    // trees on a jittered grid inside the bed
    const SP = 11;
    for (let gx = b.minX + SP * 0.5; gx < b.maxX; gx += SP) {
      for (let gz = b.minZ + SP * 0.5; gz < b.maxZ; gz += SP) {
        const tx = gx + (prand(gx, gz) - 0.5) * SP * 0.7;
        const tz = gz + (prand(gz, gx, 1) - 0.5) * SP * 0.7;
        if (prand(tx, tz, 9) < 0.3) continue; // glades
        const inner = lawnTop || bed;
        if (!inPolygon(tx, tz, inner)) continue;
        const r = prand(tx, tz, 2);
        treeSites.push({ x: tx, y: BED_Y, z: tz, scale: 0.9 + prand(tx, tz, 3) * 0.4, species: r < 0.55 ? 0 : (r < 0.75 ? 1 : 2) });
      }
    }
    // lampposts every ~34 m along the walk
    for (let i = 0; i < slab.length; i++) {
      const a = slab[i];
      const c = slab[(i + 1) % slab.length];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      for (let t = 17; t < len - 8; t += 34) {
        const px = a.x + ((c.x - a.x) * t) / len;
        const pz = a.z + ((c.z - a.z) * t) / len;
        addLamp(px, PARK_Y, pz);
      }
    }
  }

  // Instanced plaza & park furniture: NYC Parks slatted benches (seat facing +z) & cast-iron lampposts with globes
  if (benchMatrices.length) {
    const benchGeo = mergeGeometries([
      new THREE.BoxGeometry(1.9, 0.06, 0.46).translate(0, 0.45, 0.02),
      new THREE.BoxGeometry(1.9, 0.34, 0.05).rotateX(-0.22).translate(0, 0.74, -0.22),
      new THREE.BoxGeometry(0.07, 0.45, 0.52).translate(-0.86, 0.225, 0),
      new THREE.BoxGeometry(0.07, 0.45, 0.52).translate(0.86, 0.225, 0),
      new THREE.BoxGeometry(0.06, 0.06, 0.5).translate(-0.9, 0.62, 0.02),
      new THREE.BoxGeometry(0.06, 0.06, 0.5).translate(0.9, 0.62, 0.02)
    ]);
    const benchMat = new THREE.MeshStandardNodeMaterial({ color: 0x34503a, roughness: 0.66, metalness: 0.15 });
    const benchInst = new THREE.InstancedMesh(benchGeo, benchMat, benchMatrices.length);
    benchMatrices.forEach((m, i) => benchInst.setMatrixAt(i, m));
    benchInst.instanceMatrix.needsUpdate = true;
    benchInst.castShadow = true;
    benchInst.receiveShadow = true;
    benchInst.computeBoundingSphere();
    group.add(benchInst);
  }
  if (lampMatrices.length) {
    const poleGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.15, 0.2, 0.7, 8).translate(0, 0.35, 0),
      new THREE.CylinderGeometry(0.055, 0.085, 3.1, 8).translate(0, 2.25, 0),
      new THREE.CylinderGeometry(0.13, 0.07, 0.2, 8).translate(0, 3.85, 0)
    ]);
    const poleMat = new THREE.MeshStandardNodeMaterial({ color: 0x1c201d, roughness: 0.45, metalness: 0.6 });
    const globeGeo = new THREE.SphereGeometry(0.27, 12, 8).translate(0, 4.17, 0);
    const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, lampMatrices.length);
    const globeInst = new THREE.InstancedMesh(globeGeo, createParkLampGlobeMaterial(), lampMatrices.length);
    lampMatrices.forEach((m, i) => {
      poleInst.setMatrixAt(i, m);
      globeInst.setMatrixAt(i, m);
    });
    poleInst.instanceMatrix.needsUpdate = true;
    globeInst.instanceMatrix.needsUpdate = true;
    poleInst.castShadow = true;
    poleInst.computeBoundingSphere();
    globeInst.computeBoundingSphere();
    group.add(poleInst, globeInst);

    // Warm pools of lamplight on the walks & bed copings after dusk (additive decal, black by day)
    const poolInst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), createParkLampPoolMaterial(), lampMatrices.length);
    const poolM = new THREE.Matrix4();
    lampMatrices.forEach((m, i) => {
      poolInst.setMatrixAt(i, poolM.makeScale(14, 1, 14).setPosition(m.elements[12], m.elements[13] + 0.17, m.elements[14]));
    });
    poolInst.instanceMatrix.needsUpdate = true;
    poolInst.computeBoundingSphere();
    group.add(poolInst);
  }

  // Park & plaza tree and lamp sites, read by street-details.js after the city grid is built
  parkTreeSites = treeSites;
  parkLampSites = lampMatrices.map((m) => ({ x: m.elements[12], y: m.elements[13] + 4.17, z: m.elements[14] }));
  pavedPlazaRects = pavedRects;
  sidewalkBlocks = blockSidewalks; // { cx, cz, w, d } raised sidewalk slabs (cross-street tree rows)

  const roadPaint = createRoadPaintChunkBuilder('RoadMarkings');
  paintParkDrives(CPG.drives, roadPaint, { top: CP_DRIVE_TOP, transverseTop: CP_TRANSVERSE_TOP, white: new THREE.Color(0xe6e2d6), yellow: new THREE.Color(0xe8ad22) });
  batchStaticGroupMeshes(group, new Set([roadMat, cpLawnMat, cpMeadowMat]));
  scene.add(group);

  // Raised sidewalk blocks bound the roads (the planted malls down Park Ave, Broadway & co. are obstacles in the
  // roadway, handed over with the footprints)
  const sidewalks = roadSidewalks;
  // Player colliders of the viaduct, park rocks and retaining walls
  const colliders = [...outcrops.colliders, ...groundColliders];
  return { group, sidewalks, curbs, groundSurfaces: streetGroundSurfaces, footprints, colliders, roadPaint, gardenVisits };
}

export {
  buildCityGrid,
  getStreetGroundHeight,
  batchStaticGroupMeshes,
  centralParkClearings,
  parkTreeSites,
  parkLampSites,
  pavedPlazaRects,
  sidewalkBlocks
};
