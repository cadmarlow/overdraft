import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Inside a car. The models come without a cabin, so it is laid out from where each one's glass is: the foot of the
// windscreen is the top of the dashboard, the driver sits about a metre back from it on the left, the steering wheel
// half way between, the pedals under the dash. The bodywork's own inside faces close the cabin (car-assets.js draws them
// as dark trim); this adds the seats, the dashboard and the wheel that turns, and says where the driver's body goes
// (PersonRig.drive).

const TORSO = 0.88; // seat to the top of the head, sitting up (m)

// From the glass of a model (its index into the shared positions): null when no windscreen can be told apart
function cabinLayout(spec, glass, position) {
  const h = spec.height;
  let lowY = Infinity, lowZ = 0, top = -Infinity, back = Infinity, side = 0;
  for (const i of glass.index.array) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    // lamps and grilles flagged as glass sit low on the body
    if (y < h * 0.55) continue;
    top = Math.max(top, y); back = Math.min(back, z); side = Math.max(side, Math.abs(x));
    if (Math.abs(x) < 0.25 && z > 0 && z < spec.wheelZf + 0.6 && y < lowY) { lowY = y; lowZ = z; }
  }
  if (!Number.isFinite(lowY) || top - lowY < 0.25) return null;
  // Anchor the driving position to the front windscreen. The highest glass may be the rear window: using its Z put
  // some drivers over the rear axle and left the steering column metres away from the dashboard.
  const seatZ = lowZ - 1.15, roof = top - 0.1;
  // Under a low roof the seat goes down towards the floor, then reclines until the head clears it
  const hip = Math.max(0.22, Math.min(lowY - 0.47, roof - TORSO * Math.cos(0.42)));
  const recline = Math.acos(Math.max(Math.cos(0.58), Math.min(Math.cos(0.3), (roof - hip) / TORSO)));
  const x = Math.min(0.42, side * 0.48);
  return {
    seat: [x, hip, seatZ], recline,
    wheel: [x, lowY - 0.15, seatZ + 0.52], radius: 0.18, tilt: 0.42,
    pedals: [x, Math.max(0.14, hip - 0.36), seatZ + 0.9],
    dash: [lowY - 0.02, lowZ], width: side * 0.92, roof, back, rear: back < seatZ - 1.05
  };
}

// A cushion: a box whose faces swell a little, so a seat reads as upholstered and not as a crate
function cushion(w, h, d, swell = 0.25) {
  const g = new THREE.BoxGeometry(w, h, d, 4, 3, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (w / 2), y = p.getY(i) / (h / 2), z = p.getZ(i) / (d / 2);
    const k = 1 - swell * 0.5 * (x * x * y * y + y * y * z * z + x * x * z * z);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function paint(g, hex) {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.deleteAttribute('uv');
  return g;
}

const place = (g, x, y, z, rx = 0) => g.rotateX(rx).translate(x, y, z);

// One seat: cushion, back laid back by `recline` from its hinge at the rear of the cushion, headrest
function seat(x, y, z, recline, width = 0.5) {
  const parts = [paint(place(cushion(width, 0.14, 0.52), x, y - 0.05, z + 0.04), 0x2b2724)];
  const back = cushion(width * 0.96, 0.66, 0.13);
  back.translate(0, 0.33, -0.06).rotateX(-recline).translate(x, y + 0.02, z - 0.2);
  parts.push(paint(back, 0x2b2724));
  const head = cushion(width * 0.52, 0.17, 0.11, 0.4);
  head.translate(0, 0.76, -0.08).rotateX(-recline).translate(x, y + 0.02, z - 0.2);
  parts.push(paint(head, 0x24211f));
  return parts;
}

let interiorMaterial = null;
// One material for every cabin, made once: a car built mid-game must not stall on a shader compile
function cabinMaterial() {
  // Shut in under a roof: the sky barely reaches it
  interiorMaterial ??= new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.35 });
  return interiorMaterial;
}

const wheelGeometries = new Map();
// The steering wheel, centred on its hub with its face towards -Z: rim, three spokes, the hub with its pad
function steeringWheel(radius) {
  if (wheelGeometries.has(radius)) return wheelGeometries.get(radius);
  const parts = [paint(new THREE.TorusGeometry(radius, 0.017, 8, 32), 0x151515)];
  for (const a of [Math.PI / 2, Math.PI * 7 / 6, -Math.PI / 6]) {
    const spoke = new THREE.BoxGeometry(0.03, radius * 0.92, 0.012);
    spoke.translate(0, radius * 0.46, 0).rotateZ(a - Math.PI / 2);
    parts.push(paint(spoke, 0x1c1c1c));
  }
  parts.push(paint(new THREE.CylinderGeometry(0.055, 0.06, 0.05, 16).rotateX(Math.PI / 2).translate(0, 0, -0.01), 0x101010));
  const g = mergeGeometries(parts);
  wheelGeometries.set(radius, g);
  return g;
}

// The cabin's meshes under the car's body pivot; returns what poseCabin turns
function buildCabin(layout, parent) {
  const L = layout;
  const [x, hip, z] = L.seat;
  const parts = [...seat(x, hip, z, L.recline), ...seat(-x, hip, z, L.recline)];
  if (L.rear) parts.push(...seat(0, hip + 0.02, z - 0.88, L.recline * 0.8, L.width * 1.7));
  // Dashboard: a shelf under the windscreen's foot, the instrument hood in front of the driver
  const [dashY, dashZ] = L.dash;
  parts.push(paint(place(cushion(L.width * 2, 0.32, 0.5, 0.15), 0, dashY - 0.17, dashZ - 0.32), 0x1d1d1e));
  parts.push(paint(place(cushion(0.42, 0.09, 0.2, 0.3), x, dashY + 0.01, dashZ - 0.5), 0x161617));
  // Steering column down into the dash
  const [wx, wy, wz] = L.wheel;
  const column = new THREE.CylinderGeometry(0.03, 0.04, 0.42, 10);
  column.translate(0, 0.21, 0).rotateX(Math.PI / 2 - L.tilt).translate(wx, wy, wz);
  parts.push(paint(column, 0x121212));
  const mesh = new THREE.Mesh(mergeGeometries(parts), cabinMaterial());
  mesh.name = 'Cabin';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  // The wheel: tilted back with the column, turning about its own axis
  const hub = new THREE.Group();
  hub.position.set(wx, wy, wz);
  hub.rotation.x = L.tilt;
  const rim = new THREE.Mesh(steeringWheel(L.radius), cabinMaterial());
  rim.name = 'SteeringWheel';
  hub.add(rim);
  parent.add(mesh, hub);
  return { layout: L, mesh, rim, turn: 0 };
}

// The wheel turns with the front wheels, geared up so the driver's hands go round with it
const WHEEL_RATIO = 5, WHEEL_MOST = 2.4, HANDS_MOST = 1.15;
function poseCabin(cabin, steer) {
  cabin.turn = Math.max(-WHEEL_MOST, Math.min(WHEEL_MOST, steer * WHEEL_RATIO));
  cabin.rim.rotation.z = -cabin.turn;
}

// What PersonRig.drive needs, in the car's own frame (reused object)
const _pose = { seat: new THREE.Vector3(), wheel: new THREE.Vector3(), pedals: new THREE.Vector3(), radius: 0.18, tilt: 0.42, turn: 0, recline: 0.2, look: 0 };
function driverPose(cabin, look = 0) {
  const L = cabin.layout;
  _pose.seat.fromArray(L.seat); _pose.wheel.fromArray(L.wheel); _pose.pedals.fromArray(L.pedals);
  _pose.radius = L.radius; _pose.tilt = L.tilt; _pose.recline = L.recline;
  _pose.turn = Math.max(-HANDS_MOST, Math.min(HANDS_MOST, cabin.turn));
  _pose.look = look;
  return _pose;
}

export { buildCabin, cabinLayout, driverPose, poseCabin };
