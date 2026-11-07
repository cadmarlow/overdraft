import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeTune } from './car-physics.js';

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
  if (!Number.isFinite(lowY) || top - lowY < 0.25) {
    // Cab-over trucks put the windscreen ahead of the axle; a delivery van's four-corner pane has no centre vertex.
    // Intersect glass triangle edges with the vehicle centre plane instead of inventing a cabin under the cargo roof.
    const indices = glass.index.array;
    const consider = (y, z) => {
      if (y > h * 0.45 && z > 0 && z < spec.zFront - 0.04 && y < lowY) { lowY = y; lowZ = z; }
    };
    for (let at = 0; at < indices.length; at += 3) for (let edge = 0; edge < 3; edge++) {
      const a = indices[at + edge], b = indices[at + (edge + 1) % 3];
      const ax = position.getX(a), bx = position.getX(b);
      if (Math.abs(ax) < 0.025) consider(position.getY(a), position.getZ(a));
      if (ax * bx < 0 && Math.abs(bx - ax) > 1e-6) {
        const t = -ax / (bx - ax);
        consider(position.getY(a) + (position.getY(b) - position.getY(a)) * t,
          position.getZ(a) + (position.getZ(b) - position.getZ(a)) * t);
      }
    }
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
  // Raised bolsters catch the light around the darker centre insert and keep the upholstery from reading as boxes.
  for (const side of [-1, 1]) {
    const bolster = cushion(width * 0.16, 0.55, 0.17, 0.35);
    bolster.translate(side * width * 0.4, 0.31, -0.015).rotateX(-recline).translate(x, y + 0.02, z - 0.2);
    parts.push(paint(bolster, 0x393530));
    parts.push(paint(place(cushion(width * 0.17, 0.13, 0.45, 0.35), x + side * width * 0.4, y + 0.035, z + 0.05), 0x393530));
  }
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

// The dial artwork is authored once in a small shared canvas. No per-frame canvas upload: only two needles turn.
const instrumentFaces = new Map();
let needleMaterial = null;
function instrumentProfile(kind) {
  const { redline } = makeTune(kind);
  if (kind === 'truck' || kind === 'delivery') return { speed: 180, rpm: 5000, redline };
  if (kind === 'super') return { speed: 360, rpm: 10000, redline };
  if (kind === 'sport') return { speed: 320, rpm: 9000, redline };
  return { speed: 280, rpm: 8000, redline };
}
function instrumentAngle(value, maximum) {
  return (Math.PI * 0.75) - Math.max(0, Math.min(1, value / maximum)) * Math.PI * 1.5;
}
function instrumentFace(profile) {
  const key = profile.speed + ':' + profile.rpm + ':' + profile.redline;
  if (instrumentFaces.has(key)) return instrumentFaces.get(key);
  const canvas = document.createElement('canvas');canvas.width = 768;canvas.height = 320;
  const c = canvas.getContext('2d');
  c.fillStyle = '#080b0d';c.fillRect(0, 0, canvas.width, canvas.height);
  const dial = (x, maximum, step, label, redline = Infinity) => {
    const y = 163, r = 133;
    c.lineWidth = 2;c.strokeStyle = '#414a50';c.beginPath();c.arc(x, y, r, 0, Math.PI * 2);c.stroke();
    for (let value = 0; value <= maximum; value += step / 2) {
      const a = Math.PI * 0.75 + (value / maximum) * Math.PI * 1.5;
      const major = value % step === 0, inside = r - (major ? 20 : 11);
      c.strokeStyle = value >= redline ? '#f35b45' : major ? '#eef5ed' : '#7c8a92';
      c.lineWidth = major ? 3 : 1.5;c.beginPath();c.moveTo(x + Math.cos(a) * inside, y + Math.sin(a) * inside);c.lineTo(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4));c.stroke();
      if (major) { c.font = '19px sans-serif';c.textAlign = 'center';c.textBaseline = 'middle';c.fillStyle = '#d3ddd9';c.fillText(String(maximum > 1000 ? value / 1000 : value), x + Math.cos(a) * (r - 39), y + Math.sin(a) * (r - 39)); }
    }
    c.font = '15px sans-serif';c.textAlign = 'center';c.fillStyle = '#a4b6bd';c.fillText(label, x, y + 56);
    c.font = '11px sans-serif';c.fillStyle = '#607179';c.fillText('OVERDRAFT', x, y + 77);
  };
  dial(192, profile.speed, 40, 'km/h');dial(576, profile.rpm, 1000, 'tr/min × 1000', profile.redline);
  const texture = new THREE.CanvasTexture(canvas);texture.colorSpace = THREE.SRGBColorSpace;texture.anisotropy = 4;
  const material = new THREE.MeshBasicNodeMaterial({ map: texture, color: 0xc8d6d6, toneMapped: true });
  material.name = 'CarInstruments';material.userData.shared = true;
  instrumentFaces.set(key, material);
  return material;
}
function buildInstruments(kind) {
  const profile = instrumentProfile(kind), group = new THREE.Group();group.name = 'InstrumentCluster';
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.43, 0.18), instrumentFace(profile));group.add(face);
  needleMaterial ??= new THREE.MeshBasicNodeMaterial({ color: 0xff5138, toneMapped: true });
  needleMaterial.userData.shared = true;
  const needle = (x) => {
    const g = new THREE.BufferGeometry();
    // Points up at rotation zero; the scale starts at the lower left and sweeps clockwise.
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.0025, -0.008, 0, 0.0025, -0.008, 0, 0, 0.059, 0], 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, needleMaterial);mesh.position.set(x, -0.0017, 0.0007);group.add(mesh);return mesh;
  };
  const speed = needle(-0.1075), revs = needle(0.1075);
  speed.rotation.z = revs.rotation.z = instrumentAngle(0, 1);
  return { group, speed, revs, profile };
}

// The cabin's meshes under the car's body pivot; returns what poseCabin turns
function buildCabin(layout, parent, kind = 'sedan') {
  const L = layout;
  const [x, hip, z] = L.seat;
  const parts = [...seat(x, hip, z, L.recline), ...seat(-x, hip, z, L.recline)];
  if (L.rear) parts.push(...seat(0, hip + 0.02, z - 0.88, L.recline * 0.8, L.width * 1.7));
  // Dashboard: a shelf under the windscreen's foot, the instrument hood in front of the driver
  const [dashY, dashZ] = L.dash;
  parts.push(paint(place(cushion(L.width * 2, 0.32, 0.5, 0.15), 0, dashY - 0.17, dashZ - 0.32), 0x1d1d1e));
  parts.push(paint(place(cushion(0.47, 0.21, 0.23, 0.16), x, dashY - 0.02, dashZ - 0.49), 0x111214));
  // A centre tunnel, padded armrest and door cards close the cabin at the driver's eye level.
  parts.push(paint(place(cushion(0.22, Math.max(0.2, hip * 0.8), 0.95, 0.15), 0, hip * 0.5, z + 0.2), 0x1a1b1d));
  parts.push(paint(place(cushion(0.23, 0.09, 0.36, 0.25), 0, hip + 0.04, z + 0.02), 0x393530));
  for (const side of [-1, 1]) {
    parts.push(paint(place(cushion(0.045, 0.32, 1.1, 0.12), side * (L.width - 0.02), hip + 0.2, z + 0.22), 0x292a2c));
    parts.push(paint(place(cushion(0.09, 0.05, 0.45, 0.2), side * (L.width - 0.055), hip + 0.3, z + 0.18), 0x3b3a38));
    // Three slim metal louvers at each edge of the dashboard.
    for (let j = 0; j < 3; j++) parts.push(paint(place(new THREE.BoxGeometry(0.14, 0.009, 0.018), side * L.width * 0.75, dashY - 0.1 + j * 0.025, dashZ - 0.579), 0x666b70));
  }
  parts.push(paint(place(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10), 0, hip + 0.17, z + 0.47), 0x6c7074));
  parts.push(paint(place(cushion(0.07, 0.055, 0.06, 0.35), 0, hip + 0.235, z + 0.47), 0x1b1c1e));
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
  const instruments = buildInstruments(kind);
  instruments.group.position.set(x, dashY - 0.015, dashZ - 0.612);
  instruments.group.rotation.y = Math.PI;
  parent.add(mesh, hub, instruments.group);
  return { layout: L, mesh, rim, turn: 0, instruments };
}

// The wheel turns with the front wheels, geared up so the driver's hands go round with it
const WHEEL_RATIO = 5, WHEEL_MOST = 2.4, HANDS_MOST = 1.15;
function poseCabin(cabin, steer, body = null) {
  cabin.turn = Math.max(-WHEEL_MOST, Math.min(WHEEL_MOST, steer * WHEEL_RATIO));
  cabin.rim.rotation.z = -cabin.turn;
  cabin.rim.updateMatrixWorld?.();
  if (cabin.instruments) {
    const { speed, revs, profile } = cabin.instruments;
    speed.rotation.z = instrumentAngle(Math.abs(body?.speed || 0) * 3.6, profile.speed);
    revs.rotation.z = instrumentAngle(body?.rpm || 0, profile.rpm);
    speed.updateMatrixWorld(); revs.updateMatrixWorld();
  }
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

export { buildCabin, cabinLayout, driverPose, instrumentAngle, instrumentProfile, poseCabin };
