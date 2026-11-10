import * as THREE from 'three/webgpu';
import { GEO } from './nyc-geodata.js';
import { bakeParkField, ribbon, shoreBand, outcrop } from './park-plan.js';
import { setParkField } from './park-materials.js';

// The meshes of a park's ground, from the plans of js/park-plan.js: its drives and footpaths as ribbons of asphalt with
// a shoulder of trodden earth each side, its trails as ribbons of earth, the muddy band along its shores, its schist outcrops. Called by city-grid.js while it
// lays Central Park out; the park field is surveyed once the trees are planted.

const SHOULDER = 1.5; // metres of worn ground each side of a drive
const SHORE = 2.4;

function meshOf(name, { position, normal, coord, index }, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  if (normal) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  else {
    const up = new Float32Array(position.length);
    for (let i = 1; i < up.length; i += 3) up[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(up, 3));
  }
  if (coord) geometry.setAttribute('coord', new THREE.Float32BufferAttribute(coord, 4));
  const count = position.length / 3;
  geometry.setIndex(count <= 65535 ? new THREE.Uint16BufferAttribute(index, 1) : new THREE.Uint32BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  return mesh;
}
// Two triangles facing up, whichever way the four corners run
function quadUp(index, position, a, b, c, d) {
  const ax = position[a * 3], az = position[a * 3 + 2];
  const up = (position[b * 3 + 2] - az) * (position[c * 3] - ax) - (position[b * 3] - ax) * (position[c * 3 + 2] - az) > 0;
  if (up) index.push(a, b, c, a, c, d);
  else index.push(a, c, b, a, d, c);
}

/**
 * The ways of a park, drives and footpaths: `ways` = [{ pts: [x, z, ...], width, y (height of its surface), earth }].
 * A paved way is a ribbon of asphalt with a shoulder of trodden earth each side; an earth way (a bridle path, a trail
 * through the woods) is all shoulder, solid along its middle.
 * @param {{ asphalt: THREE.Material, edge: THREE.Material, lawn: number }} options `lawn`: height of the grass beside them
 * @returns {THREE.Mesh[]} the asphalt and the earth
 */
function buildParkWays(ways, { asphalt, edge, lawn }) {
  const road = { position: [], index: [] };
  const side = { position: [], coord: [], index: [] };
  ways.forEach((way, n) => {
    const seed = ((n * 0.618034) % 1 + 1) % 1;
    const y = way.y;
    let before = null;
    if (way.earth) {
      for (const c of ribbon(way.pts, way.width)) {
        const s = side.position.length / 3;
        side.position.push(c.left.x, lawn + 0.014, c.left.z, (c.left.x + c.right.x) / 2, y, (c.left.z + c.right.z) / 2, c.right.x, lawn + 0.014, c.right.z);
        side.coord.push(c.s, 1, 0, seed, c.s, 0, 0, seed, c.s, 1, 0, seed);
        if (before !== null) {
          quadUp(side.index, side.position, before, before + 1, s + 1, s);
          quadUp(side.index, side.position, before + 1, before + 2, s + 2, s + 1);
        }
        before = s;
      }
      return;
    }
    for (const c of ribbon(way.pts, way.width, way.shoulder ?? SHOULDER)) {
      const r = road.position.length / 3;
      road.position.push(c.left.x, y, c.left.z, c.right.x, y, c.right.z);
      const s = side.position.length / 3;
      // each shoulder: against the asphalt, just under its surface, then down to the lawn
      side.position.push(c.left.x, y - 0.004, c.left.z, c.leftOut.x, lawn + 0.014, c.leftOut.z, c.right.x, y - 0.004, c.right.z, c.rightOut.x, lawn + 0.014, c.rightOut.z);
      side.coord.push(c.s, 0, 0, seed, c.s, 1, 0, seed, c.s + 37, 0, 0, seed + 0.31, c.s + 37, 1, 0, seed + 0.31);
      if (before) {
        quadUp(road.index, road.position, before.r, before.r + 1, r + 1, r);
        quadUp(side.index, side.position, before.s, before.s + 1, s + 1, s);
        quadUp(side.index, side.position, before.s + 2, before.s + 3, s + 3, s + 2);
      }
      before = { r, s };
    }
  });
  const shoulders = meshOf('ParkShoulders', side, edge);
  shoulders.renderOrder = -0.6; // a see-through ground layer, under the road paint's own
  return [meshOf('ParkWays', road, asphalt), shoulders];
}

/** The muddy band round each water body: `water` = [{ ring: [x, z, ...] }], `y` the water's height, `lawn` the grass's */
function buildParkShores(water, { edge, y, lawn }) {
  const band = { position: [], coord: [], index: [] };
  water.forEach((w, n) => {
    const seed = ((n * 0.754878) % 1 + 1) % 1;
    let before = -1;
    for (const c of shoreBand(w.ring, SHORE)) {
      const k = band.position.length / 3;
      band.position.push(c.edge.x, y + 0.006, c.edge.z, c.land.x, lawn + 0.016, c.land.z);
      band.coord.push(c.s, 0, 1, seed, c.s, 1, 1, seed);
      if (before >= 0) quadUp(band.index, band.position, before, before + 1, k + 1, k);
      before = k;
    }
  });
  const shores = meshOf('ParkShores', band, edge);
  shores.renderOrder = -0.6;
  return shores;
}

/**
 * Schist outcrops: `rocks` = [{ x, z, rx, rz, height, turn, seed }], rising from the lawn at `y`.
 * @returns {{ meshes: THREE.Mesh[], colliders: object[] }} colliders in the form of js/controllers.js (round)
 */
function buildOutcrops(rocks, { material, y }) {
  const meshes = [], colliders = [];
  for (const rock of rocks) {
    const shape = outcrop(rock);
    const mesh = meshOf('ParkOutcrop', { position: shape.position, normal: shape.normal, index: shape.index }, material);
    mesh.position.set(rock.x, y - 0.03, rock.z);
    mesh.rotation.y = rock.turn || 0;
    mesh.castShadow = true;
    mesh.userData.cullDistance = 900;
    meshes.push(mesh);
    // the body of the rock, not its skirt: what a walker runs into
    const radius = Math.min(rock.rx, rock.rz) * 0.5;
    colliders.push({ round: radius, cx: rock.x, cz: rock.z, minX: rock.x - radius, maxX: rock.x + radius, minZ: rock.z - radius, maxZ: rock.z + radius, minY: y, maxY: y + shape.height, obstacle: 'rock' });
  }
  return { meshes, colliders };
}

/**
 * The lines painted on the drives, through a road paint builder (js/road-paint.js): on the loop drives a solid line
 * that keeps the walkers' lane and a dashed one between the other two; a double yellow line on the transverse roads.
 */
function paintParkDrives(drives, paint, { top, transverseTop, white, yellow }) {
  const line = (pts, width, offset, y, colour, period = 1, duty = 1) => {
    // (ribbon() puts its edges half a width either side of the centreline: an edge of a ribbon 2 x offset wide)
    const sections = ribbon(pts, Math.abs(offset) * 2);
    for (let i = 0; i + 1 < sections.length; i++) {
      const a = offset >= 0 ? sections[i].left : sections[i].right, b = offset >= 0 ? sections[i + 1].left : sections[i + 1].right;
      paint.strip3D(a.x, y, a.z, b.x, y, b.z, width, colour, period, duty, sections[i].s);
    }
  };
  for (const d of drives) {
    if (d.transverse) {
      const y = transverseTop + 0.012;
      line(d.pts, 0.11, 0.12, y, yellow);
      line(d.pts, 0.11, -0.12, y, yellow);
    } else if ((d.w || 8.5) >= 8) {
      const y = top + 0.012, w = d.w || 8.5;
      line(d.pts, 0.13, -w * 0.21, y, white);
      line(d.pts, 0.12, w * 0.13, y, white, 9, 0.33);
    }
  }
}

/**
 * Surveys Central Park once its trees are planted (`trees`: every tree of the city, { x, z, scale }; `rocks`: the
 * colliders of its outcrops)
 */
function surveyCentralPark(trees, rocks = []) {
  const park = GEO.centralPark, b = park.bounds;
  const inPark = [];
  for (const t of trees) if (t.x > b.minX && t.x < b.maxX && t.z > b.minZ && t.z < b.maxZ) inPark.push(t);
  const baked = bakeParkField({
    bounds: b, trees: inPark,
    drives: [...park.drives, ...park.paths.map(([w, , pts]) => ({ pts, w, reach: 3.5, strength: 0.75 }))],
    // the reservoir stands in its stone basin, ringed by its track: no shore
    water: park.water.filter((w) => !/Reservoir/.test(w.name)), lawns: park.lawns,
    rocks: rocks.map((c) => ({ x: c.cx, z: c.cz, radius: c.round * 1.6 }))
  });
  setParkField(baked);
  return baked;
}

export { buildParkWays, buildParkShores, buildOutcrops, paintParkDrives, surveyCentralPark };
