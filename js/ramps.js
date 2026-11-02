import * as THREE from 'three/webgpu';

// Steel jump ramps left on the big lawns of Central Park, the one place in the city with room to land. Each is a slope in
// the ground the wheels read (controllers.js carGround) and a wall at its high end for whoever comes from behind.

const SITES = [
  [-800, -2144, 0], [-800, -3344, 0], [-680, -3896, 0], [-608, -2000, 0], [-536, -2552, 0],
  [-824, -1880, 1.5708], [-560, -3272, 1.5708], [-824, -4448, 1.5708], [-536, -4832, 1.5708]
];
const RUN_UP = 48;
const LENGTH = 10;
const HEIGHT = 2.2;
const WIDTH = 5.4;
const BASE = 1.24; // the park's ground
const SLOPE = HEIGHT / LENGTH;
const NORMAL_UP = 1 / Math.hypot(1, SLOPE);

const ramps = SITES.map(([x, z, heading]) => {
  const dx = Math.sin(heading), dz = Math.cos(heading);
  return { x: x + dx * RUN_UP, z: z + dz * RUN_UP, heading, dx, dz };
});

// How far the ramp under (x, z) lifts a wheel above the lawn; the slope's normal goes in hit
function rampRise(x, z, hit) {
  for (const r of ramps) {
    const ox = x - r.x, oz = z - r.z;
    if (Math.abs(ox) > LENGTH + WIDTH || Math.abs(oz) > LENGTH + WIDTH) continue;
    const along = ox * r.dx + oz * r.dz, across = ox * r.dz - oz * r.dx;
    if (along < 0 || along > LENGTH || Math.abs(across) > WIDTH / 2) continue;
    hit.nx = -r.dx * SLOPE * NORMAL_UP; hit.ny = NORMAL_UP; hit.nz = -r.dz * SLOPE * NORMAL_UP;
    return along * SLOPE;
  }
  return 0;
}

function hazardTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a3d41';
  ctx.fillRect(0, 0, 256, 512);
  for (let y = 0; y < 512; y += 6) for (let x = (y % 12) * 2; x < 256; x += 24) {
    ctx.fillStyle = '#4c5055';
    ctx.fillRect(x, y, 12, 2);
  }
  ctx.fillStyle = '#f0b418';
  for (let y = -256; y < 512; y += 96) {
    ctx.beginPath();
    ctx.moveTo(128, y); ctx.lineTo(236, y + 92); ctx.lineTo(236, y + 138); ctx.lineTo(128, y + 46); ctx.lineTo(20, y + 138); ctx.lineTo(20, y + 92);
    ctx.fill();
  }
  ctx.fillStyle = '#16181a';
  ctx.fillRect(0, 0, 14, 512); ctx.fillRect(242, 0, 14, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function wedgeGeometry() {
  const w = WIDTH / 2, L = LENGTH, H = HEIGHT;
  const face = (a, b, c, d, u0 = 0, u1 = 1) => [[a, b, c, d], [u0, u1]];
  const quads = [
    face([-w, 0, 0], [w, 0, 0], [w, H, L], [-w, H, L]),
    face([w, 0, 0], [w, 0, L], [w, H, L], [w, H, L], 0, 0),
    face([-w, 0, L], [-w, 0, 0], [-w, H, L], [-w, H, L], 0, 0),
    face([w, 0, L], [-w, 0, L], [-w, H, L], [w, H, L], 0, 0)
  ];
  const pos = [], uv = [], index = [];
  for (const [[a, b, c, d], [u0, u1]] of quads) {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    uv.push(u0, 0, u1 || 0, 0, u1 || 0, u1 ? 1 : 0.02, u0, u1 ? 1 : 0.02);
    index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function buildRamps(scene) {
  const material = new THREE.MeshStandardNodeMaterial({ map: hazardTexture(), roughness: 0.55, metalness: 0.5, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(wedgeGeometry(), material, ramps.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const colliders = ramps.map((r, i) => {
    q.setFromAxisAngle(up, r.heading);
    m.compose(p.set(r.x, BASE, r.z), q, one);
    mesh.setMatrixAt(i, m);
    const cx = r.x + r.dx * LENGTH, cz = r.z + r.dz * LENGTH, reach = WIDTH / 2 + 0.3;
    return { minX: cx - reach, maxX: cx + reach, minZ: cz - reach, maxZ: cz + reach, minY: 0, maxY: BASE + HEIGHT - 0.6, obstacle: 'ramp',
      obb: { cx, cz, cs: Math.cos(r.heading), sn: Math.sin(r.heading), hx: WIDTH / 2, hz: 0.25 } };
  });
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'JumpRamps';
  scene.add(mesh);
  return { mesh, colliders };
}

export { buildRamps, rampRise, ramps };
