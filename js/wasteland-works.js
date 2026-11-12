import * as THREE from 'three/webgpu';
import { abs, attribute, float, frontFacing, mix, normalWorldGeometry, positionWorld, select, smoothstep, texture, varying, vec2, vec3 } from 'three/tsl';
import { ISLAND_BOUNDS, getIslandBoundsAtZ } from './city-config.js';
import { bumpNormal, cityUniforms } from './tsl-materials.js';
import { ground } from './ground-assets.js';
import { FRONTIER_BRIDGES, NORTH_GATE, SALT_LINES, SALT_PLACES, WALL_Z, WEST_GATE, saltLandAt, saltRoadAt, sampleSalt } from './wasteland-plan.js';
import { saltUniforms } from './wasteland-materials.js';
import { fixItem } from './wasteland-scatter.js';
import { buildWastelandWrecks } from './wasteland-wrecks.js';
import { buildWastelandRuins } from './wasteland-ruins.js';

// What people built and what they left: the Wall across the island and its Great Gate, the watch towers of the quays,
// the pump works at the foot of the western ramp, and the bones of the old city outside, sunk in the sand.

const BOX = { L: 12.19, H: 2.59, W: 2.44 }; // a forty-foot container
const PAINTS = [[0.30, 0.085, 0.05], [0.07, 0.16, 0.24], [0.10, 0.20, 0.12], [0.34, 0.22, 0.07], [0.33, 0.31, 0.27], [0.20, 0.10, 0.06], [0.05, 0.11, 0.13], [0.26, 0.24, 0.20]];
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

// Painted corrugated steel, rusting from the bottom up and wherever the paint has gone
function steelMaterial(surfaces, s = surfaces.sheet, hull = false) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.72, metalness: 0.25 });
  mat.name = 'Wasteland · tôle peinte';
  mat.aoNode = float(1);
  const p = positionWorld, n = normalWorldGeometry;
  const local = varying(attribute('position', 'vec3'));
  const along = select(abs(n.x).greaterThan(abs(n.z)), p.z, p.x);
  const uvNode = select(abs(n.y).greaterThan(0.5), p.xz, vec2(along, p.y)).div(s.metres * 1.25);
  const sheet = texture(s.color, uvNode);
  const rel = sheet.rgb.div(vec3(...s.mean));
  const wear = texture(ground.masksA, vec2(along.div(11), p.y.div(7)));
  const rust = smoothstep(0.42, 0.78, wear.r.mul(0.7).add(wear.a.mul(0.5)).add(float(0.5).sub(local.y.div(BOX.H)).mul(0.35)));
  const paint = attribute('paint', 'vec3');
  mat.colorNode = mix(paint.mul(rel.g.mul(0.45).add(0.6)), sheet.rgb.mul(0.8), rust);
  mat.roughnessNode = mix(float(0.55), texture(s.normal, uvNode).a, rust);
  mat.metalnessNode = mix(float(0.35), float(0.1), rust);
  mat.normalNode = bumpNormal(sheet.a.mul(0.05));
  if (hull) {
    // a hull is seen from inside too: bare plating gone to rust, and little of the sky gets in
    mat.side = THREE.DoubleSide;
    const inside = select(frontFacing, float(0), float(1));
    mat.colorNode = mix(mat.colorNode, mix(sheet.rgb, vec3(0.15, 0.085, 0.055), 0.6).mul(0.85), inside);
    mat.aoNode = mix(float(1), float(0.45), inside).mul(saltUniforms.uFill);
  }
  return mat;
}

function lampMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0xffb060, roughness: 0.6 });
  mat.name = 'Wasteland · fanal';
  mat.aoNode = float(1);
  mat.emissiveNode = vec3(1.0, 0.56, 0.2).mul(cityUniforms.uNight.mul(5.5).add(0.5));
  return mat;
}

function sign(parent, x, y, z, heading, title, subtitle, width) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1c1a17'; ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = '#8a6a2c'; ctx.lineWidth = 10; ctx.strokeRect(9, 9, 1006, 238);
  ctx.fillStyle = '#e2c98f'; ctx.textAlign = 'center';
  ctx.font = '900 104px "Arial Narrow", Arial, sans-serif'; ctx.fillText(title, 512, 128, 950);
  ctx.fillStyle = '#a8946a'; ctx.font = '700 44px Arial, sans-serif'; ctx.fillText(subtitle, 512, 200, 940);
  const random = rng(title.length * 977);
  for (let i = 0; i < 260; i++) { ctx.fillStyle = i % 3 ? 'rgba(20,16,12,0.5)' : 'rgba(120,84,40,0.35)'; ctx.fillRect(random() * 1024, random() * 256, 2 + random() * 26, 1 + random() * 3); }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const mat = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.85, side: THREE.DoubleSide });
  mat.aoNode = float(1);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), mat);
  mesh.position.set(x, y, z); mesh.rotation.y = heading; mesh.name = title;
  parent.add(mesh);
}

export function buildWastelandWorks(group, surfaces) {
  const colliders = [];
  const random = rng(20261112);
  const parent = new THREE.Group(); parent.name = 'Ouvrages du Wasteland';
  group.add(parent);

  // ---- Containers ---------------------------------------------------------------------------------------------------
  const boxes = [];
  // A container at (x, z), its base at y, long side along x (turn = 0) or along z (turn = 1), or stood on end
  const container = (x, y, z, turn = 0, onEnd = false, short = false) => boxes.push({ x, y, z, turn, onEnd, short, paint: PAINTS[Math.floor(random() * PAINTS.length)] });
  const block = (minX, maxX, minZ, maxZ, minY, maxY, roof = true) => colliders.push({ minX, maxX, minZ, maxZ, minY, maxY, roof });
  const lamps = [], fires = [], keepOut = [], road = {};
  // A drum with a fire in it, out on the Wasteland's side of a gate
  const fireBarrel = (x, z) => { fixItem({ name: 'fire_barrel', x, z }); fires.push([x, sampleSalt(x, z) + 0.85, z, 0.42]); };

  // The Wall: three courses of containers on the island's northern edge, from the dry Hudson to the moat
  const wallZ = WALL_Z - 7.6, west = -2096, east = 884, gate = NORTH_GATE.x, GAP = 9.5;
  for (let course = 0; course < 3; course++) {
    for (let x = west + (course % 2) * BOX.L / 2; x < east; x += BOX.L + 0.12) {
      if (Math.abs(x - gate) < GAP + BOX.L / 2) continue;
      if (course === 2 && random() < 0.22) continue; // the top course has gaps
      container(x, course * BOX.H, wallZ + (random() - 0.5) * 0.3, 0);
    }
  }
  for (let x = west; x < east; x += 61) {
    const x1 = Math.min(east, x + 61);
    if (x1 < gate - GAP - 6 || x > gate + GAP + 6) block(x - 6, x1 + 6, wallZ - BOX.W / 2, wallZ + BOX.W / 2, 0, 3 * BOX.H);
    else {
      if (x < gate - GAP - 6) block(x - 6, gate - GAP - 6, wallZ - BOX.W / 2, wallZ + BOX.W / 2, 0, 3 * BOX.H);
      if (x1 > gate + GAP + 6) block(gate + GAP + 6, x1 + 6, wallZ - BOX.W / 2, wallZ + BOX.W / 2, 0, 3 * BOX.H);
    }
  }
  // The Great Gate: two towers of containers on end, a deck across, the sign over the road
  for (const side of [-1, 1]) {
    const tx = gate + side * (GAP + 2.4);
    for (const dz of [-1.4, 1.4]) container(tx, 0, wallZ + dz, 0, true);
    container(tx, BOX.L, wallZ, 1, false, true);
    block(tx - 1.6, tx + 1.6, wallZ - 3.2, wallZ + 3.2, 0, BOX.L + BOX.H);
    fireBarrel(tx - side * 3.4, wallZ - 6.5);
    // clear of the roadway: whoever comes through at speed must find it open
    fixItem({ name: 'road_barrier', x: tx + side * 1.5, z: wallZ - 9, yaw: 0.3 * side });
    fixItem({ name: 'concrete_block', x: tx + side * 3.2, z: wallZ - 15, yaw: -0.2 * side });
    fixItem({ name: 'tyre_stack', x: tx - side * 2.6, z: wallZ - 5 });
  }
  container(gate, BOX.L + 0.2, wallZ, 0);
  container(gate - BOX.L * 0.9, BOX.L + 0.2, wallZ, 0, false, true);
  container(gate + BOX.L * 0.9, BOX.L + 0.2, wallZ, 0, false, true);
  sign(parent, gate, BOX.L - 1.6, wallZ + BOX.W / 2 + 0.25, 0, 'LA GRANDE PORTE', 'AU-DELÀ, LA VILLE NE VOUS DOIT PLUS RIEN', 17);
  sign(parent, gate, BOX.L - 1.6, wallZ - BOX.W / 2 - 0.25, Math.PI, 'MANHATTAN', 'VILLE FRANCHE · DÉPOSEZ VOS ARMES OU VOS DETTES', 17);
  // Watch towers: a container on end, a cabin on top, a lamp that looks out
  const tower = (x, z, look) => {
    const y = saltLandAt(x, z) ? sampleSalt(x, z) : 0;
    container(x, y, z, 0, true);
    container(x, y + BOX.L, z, look === 0 ? 0 : 1, false, true);
    lamps.push([x + Math.sin(look) * 3.4, y + BOX.L + 1.4, z + Math.cos(look) * 3.4, look]);
    block(x - 1.4, x + 1.4, z - 1.4, z + 1.4, y, y + BOX.L + BOX.H);
  };
  for (let x = west + 140; x < east - 60; x += 230) if (Math.abs(x - gate) > 60) tower(x, wallZ + 3.6, Math.PI);
  // along the western quays, looking out over the dry river
  for (let z = ISLAND_BOUNDS.minZ + 380; z < 5600; z += 520) {
    const shore = getIslandBoundsAtZ(z);
    if (Math.abs(z - WEST_GATE.z) < 90) continue;
    tower(shore.westX + 1.5, z, -Math.PI / 2);
  }
  // The western gate, where 34th Street runs out onto the ramp
  {
    const gx = WEST_GATE.x + 5, gz = WEST_GATE.z;
    for (const side of [-1, 1]) {
      const tz = gz + side * 11.5;
      container(gx, 0, tz, 1, true);
      container(gx, 0, tz + side * 2.7, 1, true);
      block(gx - 1.5, gx + 1.5, tz - 1.4, tz + side * 4 + 1.4 * side, 0, BOX.L);
      fireBarrel(WEST_GATE.x - 15, tz - side * 1.5);
      fixItem({ name: 'road_barrier', x: gx - 8, z: tz - side * 2.5, yaw: 1.57 });
    }
    container(gx, BOX.L + 0.1, gz, 1);
    container(gx, BOX.L + 0.1, gz - BOX.L * 0.75, 1, false, true);
    container(gx, BOX.L + 0.1, gz + BOX.L * 0.75, 1, false, true);
    sign(parent, gx + BOX.W / 2 + 0.25, BOX.L - 1.5, gz, Math.PI / 2, 'DESCENTE DES POMPES', 'LE LIT DE L’HUDSON · ROULEZ AU PAS', 15);
    sign(parent, gx - BOX.W / 2 - 0.25, BOX.L - 1.5, gz, -Math.PI / 2, 'MANHATTAN', 'PORTE DE L’OUEST', 15);
    lamps.push([gx - 2, BOX.L + 3, gz - 9, -Math.PI / 2], [gx - 2, BOX.L + 3, gz + 9, -Math.PI / 2]);
  }
  // A post where each bridge lands on the far bank
  for (const spec of FRONTIER_BRIDGES) {
    const dx = spec.b.x - spec.a.x, dz = spec.b.z - spec.a.z, length = Math.hypot(dx, dz), ux = dx / length, uz = dz / length;
    const px = spec.b.x + ux * 46, pz = spec.b.z + uz * 46;
    for (const side of [-1, 1]) {
      const x = px - uz * side * 12, z = pz + ux * side * 12;
      if (!saltLandAt(x, z)) continue;
      tower(x, z, Math.atan2(ux, uz));
      fixItem({ name: 'road_barrier', x: x + uz * side * -3.2, z: z - ux * side * -3.2, yaw: Math.atan2(ux, uz) });
      fixItem({ name: 'tyre_stack', x: x + ux * 3, z: z + uz * 3 });
    }
  }
  // ---- Camps: a yard walled with containers, a fire, what a crew needs ---------------------------------------------
  // `open` is the side the yard opens on: 0 = +z, 1 = +x, 2 = -z, 3 = -x
  const turnTo = (open, a, b) => [[a, b], [b, -a], [-a, -b], [-b, a]][open];
  const camp = (cx, cz, open, title, subtitle) => {
    const at = (a, b) => { const [dx, dz] = turnTo(open, a, b); return [cx + dx, cz + dz]; };
    const across = open % 2 === 0 ? 0 : 1; // the turn of a container lying across the yard
    const put = (a, b, turn, lift = 0, onEnd = false, short = false) => {
      const [x, z] = at(a, b), bed = sampleSalt(x, z), long = BOX.L / 2 * (short ? 0.5 : 1);
      container(x, bed - 0.15 + lift, z, turn, onEnd, short);
      const hx = onEnd ? 1.4 : turn ? BOX.W / 2 : long, hz = onEnd ? 1.4 : turn ? long : BOX.W / 2;
      block(x - hx, x + hx, z - hz, z + hz, bed - 0.5 + lift, bed + lift + (onEnd ? BOX.L : BOX.H));
      return [x, bed, z];
    };
    put(0, -8.2, across); put(-8.6, -1, 1 - across); put(8.6, -1, 1 - across);
    put(-3, -8.2, across, BOX.H, false, true);
    const [tx, ty, tz] = put(10.2, -9.4, 0, 0, true);
    const look = [0, Math.PI / 2, Math.PI, -Math.PI / 2][open];
    lamps.push([tx + Math.sin(look) * 1.6, ty + BOX.L + 0.6, tz + Math.cos(look) * 1.6, look]);
    const prop = (name, a, b, yaw = 0) => { const [x, z] = at(a, b); fixItem({ name, x, z, yaw: yaw + look }); return [x, z]; };
    const [px, pz] = prop('fire_pit', 0, 0);
    fires.push([px, sampleSalt(px, pz) + 0.25, pz, 0.8]);
    prop('chair', 2.3, 0.9, 4.1); prop('chair', -2.1, 1.3, 2.2); prop('chair', 0.4, -2.5, 0.2); prop('table', 4.6, -3.6, 0.5);
    prop('crate', -5, -4.6, 0.3); prop('ammo_crate', -5.8, -3.4, 1.1); prop('jerrycan', 6.2, -5, 0.4); prop('jerrycan', 6.8, -4.4, 2);
    prop('barrel_red', -6.5, 2.5); prop('barrel_blue', -6.9, 3.6); prop('tyre_stack', 6.8, 3.2); prop('generator', 5.6, -6.2, 1.2);
    prop('bed_frame', -3.8, -6.2, 1.57); prop('bed_frame', -1.3, -6.3, 1.57); prop('gas_cylinder', 3.2, -6.4); prop('trash_bag', 7, 5.5);
    for (const a of [-7.6, -5.7, 5.7, 7.6]) prop('fence', a, 7);
    const [bx, bz] = prop('fire_barrel', -4.3, 8.4);
    fires.push([bx, sampleSalt(bx, bz) + 0.85, bz, 0.42]);
    prop('road_barrier', 4.6, 8.5); prop('covered_car', 12.5, 9, 0.3); prop('tyre', -9.5, 9.2);
    const [sx, sz] = at(0, -8.2 + BOX.W / 2 + 0.25);
    sign(parent, sx, sampleSalt(cx, cz) + BOX.H * 2 + 1.5, sz, look, title, subtitle, 9);
    keepOut.push({ x: cx, z: cz, r: 22 });
  };
  // A camp settles on the first level, dry ground it finds beside the place it holds, clear of the road, facing it
  const settle = (place, title, subtitle = place.name.toUpperCase()) => {
    for (const [dx, dz] of [[36, 30], [-36, 30], [36, -30], [-36, -30], [56, 0], [-56, 0], [0, 56], [0, -56], [74, 48], [-74, -48]]) {
      const x = place.x + dx, z = place.z + dz, probe = [[0, 0], [13, 13], [-13, 13], [13, -13], [-13, -13]];
      if (!probe.every(([a, b]) => saltLandAt(x + a, z + b))) continue;
      const levels = probe.map(([a, b]) => sampleSalt(x + a, z + b));
      if (Math.max(...levels) - Math.min(...levels) > 1.6) continue;
      if (saltRoadAt(x, z, road) && road.distance < road.half + 21) continue;
      camp(x, z, Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 3 : 1) : (dz > 0 ? 2 : 0), title, subtitle);
      return;
    }
  };
  settle({ x: SALT_PLACES[0].x + 10, z: SALT_PLACES[0].z - 2 }, 'RELAIS DES VEILLEURS', 'UNE BOBINE POUR LE HAUT-SEL');
  for (const place of SALT_PLACES.slice(2)) if (place.name !== 'La Grande Porte') settle(place, 'ROULIERS');

  {
    const steel = steelMaterial(surfaces);
    const geo = new THREE.BoxGeometry(BOX.L, BOX.H, BOX.W).translate(0, BOX.H / 2, 0);
    const geometry = geo.clone();
    const paint = new Float32Array(boxes.length * 3);
    const mesh = new THREE.InstancedMesh(geometry, steel, boxes.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
    boxes.forEach((b, i) => {
      // on end: the long side stands up; turned: the long side runs along z
      e.set(0, b.turn ? Math.PI / 2 : 0, b.onEnd ? Math.PI / 2 : 0, 'YXZ');
      q.setFromEuler(e);
      m.compose(v.set(b.x + (b.onEnd && !b.turn ? BOX.H / 2 : 0), b.y + (b.onEnd ? BOX.L / 2 * (b.short ? 0.5 : 1) : 0), b.z + (b.onEnd && b.turn ? -BOX.H / 2 : 0)), q, s.set(b.short ? 0.5 : 1, 1, 1));
      mesh.setMatrixAt(i, m);
      paint.set(b.paint, i * 3);
    });
    geometry.setAttribute('paint', new THREE.InstancedBufferAttribute(paint, 3));
    mesh.name = 'Le Mur et ses tours'; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    parent.add(mesh);
    const lamp = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.55, 0.9), lampMaterial(), lamps.length);
    lamps.forEach(([x, y, z], i) => lamp.setMatrixAt(i, m.makeTranslation(x, y, z)));
    lamp.name = 'Fanaux du Mur'; lamp.frustumCulled = false;
    parent.add(lamp);
  }

  // ---- The bones of the old city (js/wasteland-ruins.js) ---------------------------------------------------------------
  const ruins = buildWastelandRuins(parent, surfaces, { keepOut, colliders });

  // ---- The pump works: three mains climb the ramp from the bed to the city --------------------------------------------
  {
    const line = SALT_LINES.find(l => l.id === 'pumps').path.filter(p => saltLandAt(p.x, p.z)).slice(0, 14);
    const steel = steelMaterial(surfaces, surfaces.rust);
    const pipe = new THREE.CylinderGeometry(0.62, 0.62, 1, 14, 1, true).rotateZ(Math.PI / 2);
    const segments = [];
    for (let i = 1; i < line.length; i++) for (const off of [12.5, 14.3, 16.1]) {
      const a = line[i - 1], b = line[i];
      const ya = sampleSalt(a.x, a.z + off) + 1.0, yb = sampleSalt(b.x, b.z + off) + 1.0;
      segments.push([a.x, ya, a.z + off, b.x, yb, b.z + off]);
      if (i % 3 === 0 && off === 14.3) {
        // a concrete saddle under the three mains
        const y = sampleSalt(b.x, b.z + off);
        colliders.push({ minX: b.x - 0.7, maxX: b.x + 0.7, minZ: b.z + 11.4, maxZ: b.z + 17.2, minY: y - 1, maxY: yb + 0.7, roof: true });
      }
    }
    const geometry = pipe.clone();
    const paint = new Float32Array(segments.length * 3);
    const mesh = new THREE.InstancedMesh(geometry, steel, segments.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), d = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
    segments.forEach(([ax, ay, az, bx, by, bz], i) => {
      d.set(bx - ax, by - ay, bz - az);
      const length = d.length();
      q.setFromUnitVectors(X, d.divideScalar(length));
      mesh.setMatrixAt(i, m.compose(v.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, s.set(length + 0.05, 1, 1)));
      paint.set([0.13, 0.17, 0.16], i * 3);
    });
    geometry.setAttribute('paint', new THREE.InstancedBufferAttribute(paint, 3));
    mesh.name = 'Conduites des Pompes'; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    parent.add(mesh);
    const foot = line.at(-1);
    for (const [dx, dz, name, yaw] of [[4, 22, 'generator', 0.4], [7, 24, 'gas_cylinder', 0], [8, 25, 'gas_cylinder', 0], [-3, 23, 'barrel_blue', 0], [-4.2, 23.6, 'barrel_red', 0], [1, 27, 'welding_cart', 1.2],
      [-9, 26, 'fire_barrel', 0], [12, 28, 'chair', 2.2], [13.5, 29.5, 'table', 0.5], [-14, 24, 'crate', 0.3], [-15, 25.2, 'ammo_crate', 1.1], [18, 23, 'jerrycan', 0.7]]) fixItem({ name, x: foot.x + dx, z: foot.z + dz, yaw });
  }
  // ---- The ships the water left -------------------------------------------------------------------------------------
  {
    const hull = steelMaterial(surfaces, surfaces.rust, true);
    hull.name = 'Wasteland · coque';
    const fleet = buildWastelandWrecks(parent, hull);
    colliders.push(...fleet.colliders);
    for (const prop of fleet.props) fixItem(prop);
    fires.push(...fleet.fires);
  }
  return { colliders, lamps, fires, ruins };
}
