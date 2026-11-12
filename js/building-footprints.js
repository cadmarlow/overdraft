import * as THREE from 'three/webgpu';
import { WALL_KINDS } from './tsl-materials.js';
import { polygonContains } from './building-collision.js';
import { wallKey } from './storefront-plan.js';
import { calibreWallPanels } from './calibre-plan.js';

function partyWallHeight(record, a, b, neighbours) {
  const dx = b.x - a.x, dz = b.y - a.y, length = Math.hypot(dx, dz);
  let height = 0;
  // Sample along the wall so a single touching corner does not blank the entire facade.
  for (const t of [0.15, 0.5, 0.85]) {
    const x = a.x + dx * t - dz / length, z = a.y + dz * t + dx / length;
    let roof = 0;
    for (const n of neighbours) {
      if (n.polygons === record.polygons || n.height <= 0 ||
        x < n.x0 || x > n.x1 || z < n.z0 || z > n.z1) continue;
      if (n.polygons.some(p => polygonContains(p, x, z))) roof = Math.max(roof, n.height);
    }
    if (!roof) return 0;
    height = Math.max(height, roof);
  }
  return height;
}

const NO_STYLE = new Array(16).fill(0);

// Two triangles over four vertices laid out as a strip (0 1 / 2 3), wound to face along (nx, ny, nz)
function quad(cell, o, nx, ny, nz) {
  const p = cell.positions, v = (i) => [p[(o + i) * 3], p[(o + i) * 3 + 1], p[(o + i) * 3 + 2]];
  const [a, b, c] = [v(0), v(1), v(2)];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const facing = (u[1] * w[2] - u[2] * w[1]) * nx + (u[2] * w[0] - u[0] * w[2]) * ny + (u[0] * w[1] - u[1] * w[0]) * nz;
  if (facing >= 0) cell.indices.push(o, o + 1, o + 2, o + 2, o + 1, o + 3);
  else cell.indices.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
}

// One merged facade/roof mesh per 1 km cell. Explicit wall coordinates keep window bays metre-sized on any angle.
// A record may carry its building's dress (styleAttr for walls, roofAttr for roofs: four vec4s each, see
// js/building-types.js) and the tiers of a stepped tower standing on its footprint (each its own outline between
// its own heights). wallSink, a Map, receives each record's street walls (ends, outward normal, bottom and top).
function createBuildingFootprints(material, records, getNeighbours, wallSink = null, frontages = null) {
  const cells = new Map();
  records.forEach((record, index) => {
    if (!(record.height > 0)) return;
    const key = Math.floor(record.cx / 1000) + ',' + Math.floor(record.cz / 1000);
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { positions: [], normals: [], indices: [], boxes: [], walls: [], styles: [], shadows: [] }));
    const seed = Math.floor(record.seed ?? index * 29) % 1000 + 0.1 + 0.8 * (record.tone ?? 0.5);
    const neighbours = getNeighbours && (frontages || record.height <= 60) ? getNeighbours(record) : [];
    const wallStyle = record.styleAttr ?? NO_STYLE, roofStyle = record.roofAttr ?? wallStyle;

    const parapet = record.parapet ?? 0;
    // A prism between two heights: its walls (the footprint's may meet neighbours and hold shops), the parapet they
    // carry above the roof (its inner face and coping), and its roof
    const prism = (polygons, bottom, height, footprint) => {
      const top = height + 0.22;
      const outlines = polygons.map(polygon => [polygon.outer, ...(polygon.holes || [])].map((ring, i) => {
        const points = ring.map(p => new THREE.Vector2(p.x, p.z));
        if (points.length > 1 && points[0].equals(points[points.length - 1])) points.pop();
        // Clockwise outer walls face away from the building; courtyard walls face into their holes.
        if (THREE.ShapeUtils.isClockWise(points) !== (i === 0)) points.reverse();
        return points;
      })).filter(rings => rings[0].length >= 3);
      const groundWalls = new Map();
      let frontagePanels;
      if (footprint && frontages) {
        for (const rings of outlines) rings.forEach((ring, i) => {
          groundWalls.set(ring, ring.map((a, j) => {
            const b = ring[(j + 1) % ring.length], dx = b.x - a.x, dz = b.y - a.y;
            const width = Math.hypot(dx, dz);
            if (!width) return null;
            const partyHeight = !i && neighbours.length ? partyWallHeight(record, a, b, neighbours) : 0;
            const adjacentHeight = record.style?.glass || record.height > 60 ? 0 : partyHeight;
            const key = wallKey(a.x, a.y, b.x, b.y);
            const shop = record.shopWalls?.has(key) || record.calibreOpenings?.some(site => site.wall === key);
            return { ax: a.x, az: a.y, bx: b.x, bz: b.y, ux: dx / width, uz: dz / width, nx: -dz / width, nz: dx / width,
              width, bottom, top: top + (!i && !adjacentHeight ? parapet : 0), court: i > 0, shop, adjacentHeight, partyHeight };
          }));
        });
        const walls = [...groundWalls.values()].flat().filter(w => w && !w.partyHeight);
        frontagePanels = frontages.forBuilding(record, walls, neighbours);
      }
      for (const rings of outlines) {
        rings.forEach((ring, i) => {
          for (let j = 0; j < ring.length; j++) {
            const a = ring[j], b = ring[(j + 1) % ring.length];
            const dx = b.x - a.x, dz = b.y - a.y, width = Math.hypot(dx, dz);
            if (width === 0) continue;
            const wall = groundWalls.get(ring)?.[j];
            const adjacentHeight = wall?.adjacentHeight ?? (footprint && !i && neighbours.length ? partyWallHeight(record, a, b, neighbours) : 0);
            // Shop walls are the ones storefront-plan.js gave shops to (the painted shopfronts stand in for them far away)
            const kind = i ? WALL_KINDS.rear : adjacentHeight ? WALL_KINDS.lotLine
              : footprint && record.shopWalls?.has(wallKey(a.x, a.y, b.x, b.y)) ? WALL_KINDS.shop : WALL_KINDS.front;
            // Courtyard walls and walls a taller neighbour hides carry no parapet
            const lip = !i && !adjacentHeight ? parapet : 0;
            const wallTop = top + lip;
            const exposedHeight = adjacentHeight ? Math.max(0, top - adjacentHeight) : wallTop - bottom;
            // Match the positive-world-axis tangent used by the shared interior-map view ray.
            const reverse = (Math.abs(dz) >= Math.abs(dx) ? dz : dx) < 0;
            const recessedPanels = frontagePanels?.get(wall);
            const panels = recessedPanels ?? calibreWallPanels(record, a.x, a.y, b.x, b.y, bottom, wallTop);
            const shadowStart = cell.indices.length;
            let topLeft, topRight, bottomLeft, bottomRight;
            for (const [lo, hi, y0, y1] of panels) {
              const start = cell.positions.length / 3;
              if (recessedPanels) {
                if (lo === 0 && y0 === bottom) bottomLeft = start;
                if (hi === width && y0 === bottom) bottomRight = start + 1;
                if (y1 === wallTop) { topLeft = start + 2; topRight = start + 3; }
              }
              for (let k = 0; k < 4; k++) {
                const u = k % 2 ? hi / width : lo / width, y = k < 2 ? y0 : y1;
                cell.positions.push(a.x + dx * u, y, a.y + dz * u);
                cell.normals.push(-dz / width, 0, dx / width);
                cell.boxes.push(width, height + lip, exposedHeight, seed);
                cell.walls.push(reverse ? 1 - u : u, wallTop - y, kind);
                cell.styles.push(...wallStyle);
              }
              cell.indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
            }
            if (frontages) {
              // The recessed panels are closed doors and windows. Cast their building's silhouette as a single
              // quad per wall in the distant cascades. Shop entrances still use their carved silhouette.
              if (bottomLeft !== undefined && bottomRight !== undefined && topLeft !== undefined) {
                cell.shadows.push(bottomLeft, bottomRight, topLeft, topLeft, bottomRight, topRight);
              } else for (let k = shadowStart; k < cell.indices.length; k++) cell.shadows.push(cell.indices[k]);
            }
            // Street and side walls with windows, for the window dressings built near the camera (facade-kit.js)
            if (wallSink && !i && !adjacentHeight) {
              if (!wallSink.has(record)) wallSink.set(record, []);
              wallSink.get(record).push({ ax: a.x, az: a.y, bx: b.x, bz: b.y, nx: -dz / width, nz: dx / width, width, bottom, top: wallTop });
            }
            if (lip) {
              // The parapet's inner face, 0.3 m in, in common brick, and the coping across its top
              const ix = (dz / width) * 0.3, iz = (-dx / width) * 0.3;
              const inner = cell.positions.length / 3;
              cell.positions.push(b.x + ix, top, b.y + iz, a.x + ix, top, a.y + iz, b.x + ix, wallTop, b.y + iz, a.x + ix, wallTop, a.y + iz);
              cell.positions.push(a.x, wallTop, a.y, b.x, wallTop, b.y, a.x + ix, wallTop, a.y + iz, b.x + ix, wallTop, b.y + iz);
              for (let k = 0; k < 4; k++) {
                cell.normals.push(dz / width, 0, -dx / width);
                cell.boxes.push(width, lip, lip, seed);
                cell.walls.push(reverse ? k % 2 : 1 - k % 2, k < 2 ? lip : 0, WALL_KINDS.rear);
                cell.styles.push(...wallStyle);
              }
              for (let k = 0; k < 4; k++) {
                cell.normals.push(0, 1, 0);
                cell.boxes.push(1, height, height, seed);
                cell.walls.push(0, 0, WALL_KINDS.front);
                cell.styles.push(...roofStyle);
              }
              const innerStart = cell.indices.length;
              quad(cell, inner, dz / width, 0, -dx / width);
              quad(cell, inner + 4, 0, 1, 0);
              if (frontages) for (let k = innerStart; k < cell.indices.length; k++) cell.shadows.push(cell.indices[k]);
            }
          }
        });
        const triangles = THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1));
        const points = rings.flat(), offset = cell.positions.length / 3;
        for (const p of points) {
          cell.positions.push(p.x, top, p.y);
          cell.normals.push(0, 1, 0);
          cell.boxes.push(1, height, height, seed);
          cell.walls.push(0, 0, WALL_KINDS.front);
          cell.styles.push(...roofStyle);
        }
        for (const [a, b, c] of triangles) {
          cell.indices.push(offset + a, offset + c, offset + b);
          if (frontages) cell.shadows.push(offset + a, offset + c, offset + b);
        }
      }
    };
    prism(record.polygons, 0.22, record.height, true);
    for (const tier of record.tiers || []) prism([{ outer: tier.ring, holes: [] }], tier.base + 0.22, tier.top, false);
  });

  const group = new THREE.Group();
  group.name = 'SurveyedBuildings';
  let first;
  for (const cell of cells.values()) {
    if (cell.indices.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(cell.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(cell.normals, 3));
    geometry.setAttribute('box', new THREE.Float32BufferAttribute(cell.boxes, 4));
    geometry.setAttribute('facadeWall', new THREE.Float32BufferAttribute(cell.walls, 3));
    // The dress shares one vertex buffer (WebGPU allows eight)
    const styles = new THREE.InterleavedBuffer(new Float32Array(cell.styles), 16);
    for (let i = 0; i < 4; i++) geometry.setAttribute(`facadeStyle${i}`, new THREE.InterleavedBufferAttribute(styles, 4, i * 4));
    geometry.setIndex(cell.indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SurveyedBuildingChunk';
    mesh.castShadow = mesh.receiveShadow = true;
    // Most cells are too small for scene-culling.js to pick them as big casters on its own: opt in to its stand-ins.
    if (frontages) {
      const shadow = new THREE.BufferGeometry();
      shadow.setAttribute('position', geometry.attributes.position);
      shadow.setIndex(cell.shadows);
      mesh.userData.shadowStandIn = shadow;
    } else mesh.userData.shadowStandIn = true;
    if (first) mesh.userData.sharesPipelineWith = first;
    else first = mesh;
    group.add(mesh);
  }
  return group;
}

export { createBuildingFootprints };
