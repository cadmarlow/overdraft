import * as THREE from 'three/webgpu';
import { color, max, mix, positionLocal, positionWorld, sin, time, vec3 } from 'three/tsl';
import { createDistrictBatch, finishGeometry, quad, standard, topGeometry } from './district-geometry.js';
import { groundFootprint } from './ground-surfaces.js';
import { ribbon } from './park-plan.js';
import { createGroundLawnMaterial } from './park-materials.js';
import { cityUniforms, createDressedStoneMaterial, createParkPavingMaterial } from './tsl-materials.js';
import { lincolnPoint, ovalPoint, lincolnPlaza, lincolnGarden, lincolnFountain, ovalGround, ovalLawn, ovalWalks,
  ovalFountain } from './urban-places-plan.js';

const PLAZA_Y = 0.82;
const OVAL_Y = 0.242;
const WALK_Y = 0.274;
const circle = ({ x, z }, radius, sides = 48) => Array.from({ length: sides }, (_, i) => {
  const angle = i * 2 * Math.PI / sides;
  return { x: x + radius * Math.cos(angle), z: z + radius * Math.sin(angle) };
});
const rectangle = (x0, z0, x1, z1) => [[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
const local = (point, points) => points.map(([x, z]) => point(x, z));
const scaled = (points, x, z) => points.map(([px, pz]) => [px * x, pz * z]);

function makeMaterials() {
  const water = standard(0x487274, 0.24, 0.38);
  const phase = positionWorld.x.mul(3.6).add(positionWorld.z.mul(1.8)).add(time.mul(3.8));
  const ripples = sin(phase).mul(0.19).add(sin(positionWorld.z.mul(6.1).sub(time.mul(3))).mul(0.12)).add(0.49);
  water.colorNode = mix(color(0x375961), color(0x80aeb0), ripples);
  water.roughnessNode = ripples.mul(0.3).add(0.17);
  const jets = standard(0xc9e4df, 0.25, 0.2);
  jets.userData.cullDistance = 175;
  const pulse = sin(time.mul(1.25).add(positionLocal.x.mul(0.46)).add(positionLocal.z.mul(0.38)));
  const reach = max(0, positionLocal.y.sub(1.3));
  jets.positionNode = positionLocal.add(vec3(0, pulse.mul(reach).mul(0.24), 0));
  jets.emissiveNode = color(0xe6c995).mul(cityUniforms.uNight).mul(0.28);
  return {
    water, jets, paving: createParkPavingMaterial({ evenGranite: true }), stone: createDressedStoneMaterial(), lawn: createGroundLawnMaterial(),
    dark: standard(0x4a4c46), coping: standard(0xa39987), iron: standard(0x263b33, 0.57, 0.42),
    wood: standard(0x745b40), blue: standard(0x38605e), red: standard(0x905747), paint: standard(0xd0c8b3),
    mulch: standard(0x4c4131), board: standard(0xa18c6d), amber: standard(0xd0a368, 0.47, 0.3),
    grasses: [standard(0x5d6541), standard(0x828455), standard(0xaa895f)]
  };
}

function groundBuilder(scene, name, point, { ground, colliders }, m) {
  const batch = createDistrictBatch(name);
  const flat = (points, y, mat, style = 0) => batch.add(mat, topGeometry(points, y, style), false);
  function floor(points, y, mat, style = 0) {
    flat(points, y, mat, style);
    const turf = mat === m.lawn;
    ground.add(points, y, { curb: false, grip: turf ? 0.66 : 0.92, rough: turf ? 0.018 : 0.006 });
  }
  function box(mat, p, y, w, h, d, yaw = 0) {
    batch.add(mat, new THREE.BoxGeometry(w, h, d).rotateY(yaw).translate(p.x, y + h / 2, p.z));
  }
  function cylinder(mat, p, y, rt, rb, h, sides = 24) {
    batch.add(mat, new THREE.CylinderGeometry(rt, rb, h, sides).translate(p.x, y + h / 2, p.z));
  }
  function tube(mat, points, radius, segments = 8) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    batch.add(mat, new THREE.TubeGeometry(curve, segments, radius, 5, false), false);
  }
  function rail(mat, a, b, y, h, thickness) {
    const dx = b.x - a.x, dz = b.z - a.z;
    box(mat, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, y,
      Math.hypot(dx, dz), h, thickness, Math.atan2(-dz, dx));
  }
  function wall(points, minY, maxY) {
    colliders.push({ ...groundFootprint(points), minY, maxY, obstacle: 'wall' });
  }
  function rect(x0, z0, x1, z1, y, mat, style) {
    floor(local(point, rectangle(x0, z0, x1, z1)), y, mat, style);
  }
  function ramp(x0, x1, z0, z1, y0, y1) {
    const positions = local(point, rectangle(x0, z0, x1, z1)).flatMap((p, i) => [p.x, i === 0 || i === 3 ? y0 : y1, p.z]);
    const indices = [0, 3, 2, 0, 2, 1];
    batch.add(m.paving, finishGeometry(positions, indices, 1), false);
    ground.addTriangles(positions, indices, { curb: false });
  }
  function walk(points, width, y, style) {
    const segments = ribbon(points.flatMap(([x, z]) => {
      const p = point(x, z);
      return [p.x, p.z];
    }), width);
    const positions = [], indices = [];
    for (let i = 0; i < segments.length; i++) {
      const { left, right } = segments[i], k = i * 2;
      positions.push(left.x, y, left.z, right.x, y, right.z);
      if (i > 0) quad(indices, k - 2, k - 1, k + 1, k);
    }
    const geometry = finishGeometry(positions, indices, style);
    // Ribbon's first side is left when looking along the path.
    if (geometry.attributes.normal.getY(0) < 0) {
      for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
    }
    batch.add(m.paving, geometry, false);
    ground.addTriangles(positions, indices, { curb: false });
  }
  return { batch, flat, floor, box, cylinder, tube, rail, wall, rect, ramp, walk, finish: () => batch.finish(scene) };
}

function fountain(g, m, site, radius, floorY, civic) {
  g.flat(circle(site, radius + (civic ? 2.4 : 1.1)), floorY + 0.011, m.paving, 2);
  g.cylinder(m.dark, site, floorY, radius, radius + 0.16, site.y - floorY - 0.06, 56);
  g.flat(circle(site, radius - 0.17), site.y + 0.003, m.water);
  g.batch.add(civic ? m.coping : m.stone, new THREE.TorusGeometry(radius - 0.08, civic ? 0.16 : 0.11, 8, 64)
    .rotateX(-Math.PI / 2).translate(site.x, site.y, site.z));
  g.wall(circle(site, radius + 0.13, 24), floorY, site.y + 0.15);
  g.cylinder(civic ? m.dark : m.stone, site, site.y, civic ? 0.8 : 0.52, civic ? 0.9 : 0.96, civic ? 0.1 : 0.3);
  if (!civic) g.cylinder(m.iron, site, site.y + 0.3, 0.36, 0.28, 0.38);
  const count = civic ? 24 : 10;
  for (let i = 0; i < count; i++) {
    const angle = i * Math.PI * 2 / count, dx = Math.cos(angle), dz = Math.sin(angle);
    const start = civic ? 1.85 : 0.31, end = civic ? 3.22 : 2.2, h = civic ? 1.72 : 0.82;
    g.tube(m.jets, [[site.x + dx * start, site.y + 0.04, site.z + dz * start],
      [site.x + dx * (start + 0.24), site.y + h * 0.72, site.z + dz * (start + 0.24)],
      [site.x + dx * (end - 0.39), site.y + h + (i % 2) * 0.22, site.z + dz * (end - 0.39)],
      [site.x + dx * end, site.y + 0.04, site.z + dz * end]], civic ? 0.035 : 0.028, 12);
  }
  for (let i = 0; i < (civic ? 5 : 1); i++) {
    const a = i * Math.PI * 0.4, x = site.x + Math.cos(a) * 0.18, z = site.z + Math.sin(a) * 0.18;
    const y = site.y + (civic ? 0.05 : 0.65);
    g.tube(m.jets, [[x, y, z], [x, y + 1.4, z], [x + 0.045, y + (civic ? 5.6 : 2.05) - (i % 2) * 0.47, z]], 0.047);
  }
}

function wayfinding(g, m, p, y, lines, palette) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = palette; ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#c6b391'; ctx.lineWidth = 5; ctx.strokeRect(12, 12, 488, 232);
  ctx.textAlign = 'center'; ctx.fillStyle = '#f2ead8';
  ctx.font = 'bold 43px sans-serif'; ctx.fillText(lines[0], 256, 106);
  ctx.font = '28px sans-serif'; ctx.fillText(lines[1], 256, 180);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.74 });
  const facing = lines[2] ?? Math.PI / 2;
  g.box(m.iron, p, y, 0.11, 1.53, 0.11);
  g.box(m.iron, p, y + 1.33, 1.92, 0.93, 0.12, facing);
  g.batch.add(sign, new THREE.PlaneGeometry(1.85, 0.9).rotateY(facing)
    .translate(p.x + Math.sin(facing) * 0.065, y + 1.795, p.z + Math.cos(facing) * 0.065));
}

function plant(addTree, p, y, i, scale) {
  addTree({ ...p, y, species: [0, 0, 1, 0, 2][i % 5], scale, denseCanopy: true });
}
function seat(addBench, point, x, z, y, yaw) {
  const p = point(x, z);
  addBench(p.x, y, p.z, yaw);
  return { ...p, y, yaw, kind: 'garden' };
}
function visit(point, gate, route, seat, sidewalk, entry) {
  return { gate: point(...gate), route: local(point, route), seat, sidewalk: local(point, sidewalk), entry: point(...entry) };
}

function planter(g, m, p, x, z, y, length) {
  g.box(m.stone, p(x,z), y, length, 0.37, 1.55);
  g.box(m.coping, p(x,z), y + 0.37, length + 0.13, 0.095, 1.64);
  g.box(m.mulch, p(x,z), y + 0.465, length - 0.17, 0.032, 1.36);
  g.wall(local(p, rectangle(x - length / 2,z - 0.8,x + length / 2,z + 0.8)), y, y + 0.47);
  for (let i = 0; i < Math.floor(length * 3.4); i++) {
    const px = x - length * 0.46 + i * 0.29, pz = z + Math.sin(i * 2.39) * 0.48;
    const spot = p(px,pz), size = 0.18 + (i % 5) * 0.035;
    const geometry = new THREE.IcosahedronGeometry(1,0).scale(size, size * 1.66, size * 0.75)
      .rotateZ(Math.sin(i * 1.91) * 0.28).translate(spot.x,y + 0.55 + size * 0.62,spot.z);
    g.batch.add(m.grasses[i % m.grasses.length],geometry,false);
  }
}

function watch(point, entry, path, target, look, sidewalk) {
  const stop = point(...target);
  return {
    gate: point(...entry), entry: point(...entry), route: local(point, path),
    stop: { ...stop, yaw: Math.atan2(look.x - stop.x, look.z - stop.z) },
    look, sidewalk: local(point, sidewalk)
  };
}

function buildLincolnPlaza(scene, city, m) {
  const p = lincolnPoint, g = groundBuilder(scene, 'Lincoln Center · Place Josie Robertson', p, city, m);
  const { addTree, addBench, addLamp } = city;
  g.floor(local(p, lincolnPlaza), PLAZA_Y, m.paving, 1);
  for (const z of [-28.8, -21, 10.25, 18.6]) g.rect(68.6, z, 167.7, z + 0.36, PLAZA_Y + 0.008, m.paving, 2);
  for (const x of [85, 104, 145, 163]) g.rect(x, -19.9, x + 0.23, 9.6, PLAZA_Y + 0.009, m.paving, 2);
  // One grade change, expressed both by actual treads and a straight accessible ramp.
  for (let i = 0; i < 4; i++) {
    const left = 172 + i * 0.78, y = PLAZA_Y - (i + 1) * 0.14;
    g.rect(left, -17.9, left + 0.78, 7.2, y, m.paving, 1);
    g.box(m.coping, p(left + 0.77, -5.35), y - 0.14, 0.075, 0.14, 25.1);
  }
  for (const z of [-18.05, 7.34]) {
    g.rail(m.iron, p(172.2, z), p(175.14, z), 1.34, 0.055, 0.05);
    for (const x of [172.25, 173.65, 175.08]) g.box(m.iron, p(x, z), 0.26, 1.4 - (x - 171) * 0.08, 0.06, 0.06);
  }
  g.ramp(172, 180.2, 8, 14.3, PLAZA_Y, 0.24);
  g.ramp(172, 180.2, -24.5, -18.2, PLAZA_Y, 0.24);
  for (const [a, b] of [[-27,-24.5],[-18.2,-17.9],[7.2,8],[14.3,17]]) {
    g.box(m.coping, p(172.05, (a + b) / 2), 0.23, 0.19, 0.59, b - a);
  }
  fountain(g, m, lincolnFountain, 6.65, PLAZA_Y, true);
  for (const [x,z,length] of [[83,-25,7.3],[106,-25,7.3],[146,-25,8.3],[162,-25,7.3],
    [82,16,7.3],[106,16,7.3],[144,16,7.3],[162,16,7.3]]) planter(g,m,p,x,z,PLAZA_Y,length);

  g.floor(local(p, lincolnGarden), 0.255, m.lawn);
  g.walk([[26,-65],[49,-63],[72,-64],[89,-59]], 3.6, 0.282, 2);
  for (const z of [-76.3, -48.5]) {
    for (let i = 0; i < 7; i++) {
      const x = 30 + i * 8.6, tree = p(x, z);
      g.flat(circle(tree, 1.45, 12), 0.264, m.mulch);
      plant(addTree, tree, 0.255, i, 0.74 + (i % 3) * 0.08);
    }
  }
  for (const [x,z,y] of [[89,-23,PLAZA_Y],[151,-23,PLAZA_Y],[88,14,PLAZA_Y],[152,14,PLAZA_Y],[31,-62,0.27],[77,-62,0.27]]) {
    const site = p(x,z); addLamp(site.x, y, site.z);
  }
  const seats = [seat(addBench,p,149,-15,PLAZA_Y,0),seat(addBench,p,151,12,PLAZA_Y,Math.PI),
    seat(addBench,p,88,12,PLAZA_Y,Math.PI),seat(addBench,p,63,-61,0.28,Math.PI),seat(addBench,p,131,7.9,PLAZA_Y,Math.PI),
    seat(addBench,p,137,-16.7,PLAZA_Y,0),seat(addBench,p,116,8.4,PLAZA_Y,Math.PI)];
  wayfinding(g, m, p(171, 15.6), PLAZA_Y, ['LINCOLN CENTER', 'PLACE JOSIE ROBERTSON'], '#383b3d');
  g.finish();
  const sidewalk = [[179,-25],[179,17]];
  return [
    visit(p,[176,-8],[[168,-8],[154,-10],[149,-13]],seats[0],sidewalk,[179,-14]),
    visit(p,[177,11],[[170,11],[162,10],[153,10]],seats[1],sidewalk,[179,16]),
    visit(p,[175,-20],[[162,-21],[143,-21],[112,-21],[98,-18],[92,0],[89,10]],seats[2],sidewalk,[179,-23]),
    visit(p,[26,-65],[[42,-64],[53,-63],[63,-63]],seats[3],[[23,-78],[23,-48]],[23,-72]),
    visit(p,[176,3],[[168,3],[151,6],[138,7]],seats[4],sidewalk,[179,7]),
    visit(p,[176,-14],[[164,-15],[148,-17]],seats[5],sidewalk,[179,-19]),
    visit(p,[175,12],[[165,12],[138,11],[125,10],[118,9]],seats[6],sidewalk,[179,12]),
    watch(p,[148,-12],[[140,-10],[135,-9]],[132.7,-9.2],lincolnFountain,[[153,-14],[139,-10]]),
    watch(p,[147,9],[[139,7],[135,4]],[131.8,1.6],lincolnFountain,[[149,11],[138,7]]),
    watch(p,[111,-15],[[115,-13]],[119,-11.7],lincolnFountain,[[108,-17],[115,-13]])
  ];
}

function ovalCourt(g, m, p) {
  g.rect(1.8, 55, 31.8, 79, WALK_Y, m.paving, 2);
  g.flat(local(p, rectangle(2.5,55.7,31.1,78.3)), WALK_Y + 0.013, m.blue);
  g.flat(local(p, rectangle(2.6,62,8.9,72)), WALK_Y + 0.018, m.red);
  const mark = (a, b) => g.rail(m.paint, p(...a), p(...b), WALK_Y + 0.019, 0.004, 0.078);
  const corners = rectangle(3,56.2,30.5,77.8);
  for (let i = 0; i < corners.length; i++) mark(corners[i], corners[(i + 1) % corners.length]);
  mark([17,56.2],[17,77.8]); mark([3,64.6],[8.9,64.6]); mark([3,69.4],[8.9,69.4]); mark([8.9,64.6],[8.9,69.4]);
  for (let i = 0; i < 18; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 18, b = a + Math.PI / 18;
    mark([8.9 + Math.cos(a) * 2.4,67 + Math.sin(a) * 2.4],[8.9 + Math.cos(b) * 2.4,67 + Math.sin(b) * 2.4]);
  }
  g.box(m.iron, p(2.75,67), WALK_Y, 0.13, 3.72, 0.13);
  g.box(m.iron, p(3.33,67), 3.41, 1.16, 0.095, 0.11);
  g.box(m.paint, p(3.91,67), 3.03, 0.08, 1.01, 1.8);
  const hoop = p(4.28,67);
  g.batch.add(m.red,new THREE.TorusGeometry(0.235,0.013,6,18).rotateX(-Math.PI / 2).translate(hoop.x,3.32,hoop.z));
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5, b = a + Math.PI / 10;
    g.tube(m.paint, [[hoop.x + Math.cos(a)*0.22,3.32,hoop.z + Math.sin(a)*0.22],
      [hoop.x + Math.cos(b)*0.13,3.06,hoop.z + Math.sin(b)*0.13]],0.007,2);
  }
}

function readingCorner(g, m, p, city) {
  const box = p(-81, -10);
  g.box(m.iron, box, WALK_Y, 0.11, 1.56, 0.11);
  g.box(m.wood, box, 1.1, 0.4, 0.64, 0.74);
  g.box(m.red, box, 1.74, 0.5, 0.08, 0.82);
  g.box(m.dark, p(-80.79,-10), 1.21, 0.015, 0.43, 0.61);
  for (let i = 0; i < 7; i++) g.box([m.red,m.blue,m.amber][i % 3], p(-80.77,-10.26 + i * 0.082), 1.24, 0.04, 0.19 + (i % 3) * 0.067, 0.064);
  const seats = [];
  for (const z of [-14.8,-19.4]) {
    const table = p(-83,z);
    g.box(m.iron, table, WALK_Y, 0.14, 0.71, 0.14);
    g.box(m.board, table, 0.94, 0.91, 0.075, 0.91);
    for (let x = 0; x < 8; x++) for (let i = x % 2; i < 8; i += 2) {
      g.box(m.dark, p(-83 + (x - 3.5) * 0.078,z + (i - 3.5) * 0.078), 1.015, 0.078, 0.009, 0.078);
    }
    g.wall(local(p, rectangle(-83.44,z-0.44,-82.56,z+0.44)), WALK_Y, 1.015);
    seats.push(seat(city.addBench,p,-84.1,z,WALK_Y,Math.PI / 2));
  }
  return seats[0];
}

function buildStuyvesantOval(scene, city, m) {
  const p = ovalPoint, g = groundBuilder(scene, 'Stuyvesant Town · L’Oval', p, city, m);
  const { addTree, addBench, addLamp } = city;
  g.floor(local(p, ovalGround), OVAL_Y, m.lawn);
  const ring = scaled(ovalLawn, 1.06, 1.08);
  g.walk([...ring, ...ring.slice(0, 2)], 4.9, WALK_Y, 0);
  for (const { points, width } of ovalWalks) g.walk(points, width, WALK_Y + 0.005, 0);
  g.floor(local(p, ovalLawn), OVAL_Y + 0.008, m.lawn);
  g.floor(circle(ovalFountain, 10.6, 36), WALK_Y + 0.006, m.paving, 1);
  g.walk([[0,-46],[0,-37],[0,-27]], 5, WALK_Y + 0.014, 1);
  fountain(g, m, ovalFountain, 3.52, WALK_Y + 0.015, false);

  for (const [i, [x,z]] of scaled(ovalLawn, 1.13, 1.22).entries()) {
    if (Math.abs(z) < 11 || Math.abs(x) < 13) continue;
    const tree = p(x, z);
    g.flat(circle(tree, 1.35, 12), OVAL_Y + 0.011, m.mulch);
    plant(addTree, tree, OVAL_Y, i, 0.88 + (i % 4) * 0.07);
  }
  const groves = [[-144,-14],[-130,-21],[-112,-8],[-109,11],[-125,21],[-142,24],[-160,-14],[-158,17],
    [113,-9],[127,-9],[142,-13],[158,-12],[124,21],[144,21],[161,20],[172,-13],
    [-18,-59],[-18,-73],[11,-68],[18,-52],[-25,59],[-33,68],[37,52],[43,66],[49,78]];
  groves.forEach(([x,z], i) => plant(addTree, p(x,z), OVAL_Y, i + 4, 0.72 + (i % 5) * 0.083));
  const seats = [[-75,-22,Math.PI / 3],[-56,-38,0],[-25,-46,0],[20,-46,0],[57,-37,-Math.PI / 4],
    [76,-17,-Math.PI / 2],[76,16,-Math.PI / 2],[51,38,Math.PI],[-39,41,Math.PI],[-73,18,Math.PI / 2],
    [-97,3,0],[104,10,Math.PI],[-7,-32,Math.PI / 2],[7,-32,-Math.PI / 2],[16,80,Math.PI]]
    .map(([x,z,yaw]) => seat(addBench,p,x,z,WALK_Y,yaw));
  for (const [x,z] of [[-155,7],[-115,6],[-81,6],[-68,-32],[-25,-48],[13,-48],[58,-39],[80,4],[116,2],[148,2],
    [70,28],[36,48],[-31,47],[-62,29],[-8,-76],[-9,69],[34,69]]) {
    const site = p(x,z); addLamp(site.x,WALK_Y,site.z);
  }
  ovalCourt(g,m,p);
  for (const [x,z,length] of [[-71,-22,3.4],[-28,-42,5.2],[28,-42,5.2],[64,-31,3.4],[-37,44,4.3],[36,42,4.3]]) {
    planter(g,m,p,x,z,OVAL_Y,length);
  }
  const librarySeat = readingCorner(g,m,p,city);
  wayfinding(g,m,p(-90,5.8),WALK_Y,['STUYVESANT OVAL','PROMENADE  ·  JARDINS'], '#294137', -Math.PI / 2);
  g.finish();

  return [
    visit(p,[-158,3],[[-138,1],[-110,0],[-85,0],[-82,-8],[-83,-12]],librarySeat,[[-178,4],[-151,3]],[-168,4]),
    visit(p,[154,6],[[129,7],[105,7],[83,6],[79,11]],seats[6],[[151,6],[179,5]],[171,5]),
    visit(p,[-1,-92],[[-3,-77],[-3,-58],[-3,-44],[-4,-38],[-6,-34]],seats[12],[[-2,-98],[-2,-77]],[-2,-96]),
    visit(p,[-12,87],[[-14,75],[-15,63],[-12,51],[-22,47],[-39,46],[-41,43]],seats[8],[[-12,83],[-12,95]],[-12,91]),
    visit(p,[-108,1],[[-97,0],[-85,1],[-77,9],[-75,15]],seats[9],[[-119,1],[-100,1]],[-116,1]),
    visit(p,[107,7],[[97,7],[86,3],[78,-7]],seats[5],[[103,7],[128,7]],[119,7]),
    visit(p,[-3,-55],[[-3,-44],[2,-41],[6,-38]],seats[13],[[-3,-63],[-3,-50]],[-3,-59]),
    watch(p,[-9,-37],[[-8,-32]],[-5,-29],ovalFountain,[[-13,-39],[-7,-32]])
  ];
}

function buildUrbanPlaces(scene, city) {
  const materials = makeMaterials();
  return [...buildLincolnPlaza(scene, city, materials), ...buildStuyvesantOval(scene, city, materials)];
}

export { buildUrbanPlaces };
