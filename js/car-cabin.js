import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, varying } from 'three/tsl';

// Detailed generated cabins follow the glazing footprint: dashboard under the windscreen, driver behind it and
// controls within reach. A model with a complete source interior supplies its measured anchors instead, keeping
// its architecture while gaining the same animated steering and instruments. The layout also places PersonRig.drive.

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

// A small set of authored interiors: shared shaders, different architecture and trim instead of one black box.
const CABIN_FAMILIES = {
  touring: { family: 'touring', top: 0x293039, lower: 0x73716b, leather: 0x706454, insert: 0x494b4b, accent: 0xafb8be, metal: 0.8, sporty: false, screen: true, light: '#c5d5d3' },
  sport: { family: 'sport', top: 0x272d32, lower: 0x333d43, leather: 0x48454b, insert: 0x252c31, accent: 0xa9b4bf, metal: 0.82, sporty: true, screen: true, light: '#b8e1ed' },
  classic: { family: 'classic', top: 0x343532, lower: 0x6b5d4d, leather: 0x776553, insert: 0x504b43, accent: 0xc2bbb0, metal: 0.85, sporty: false, screen: false, light: '#ece1bd' },
  utility: { family: 'utility', top: 0x343b40, lower: 0x727b7b, leather: 0x586068, insert: 0x414b52, accent: 0x99a4aa, metal: 0.62, sporty: false, screen: false, light: '#d8e0d4' },
  compact: { family: 'compact', top: 0x333b40, lower: 0x9b9c93, leather: 0x697276, insert: 0x48575c, accent: 0x83a7ad, metal: 0.45, sporty: false, screen: true, light: '#b5e4dc' }
};
function cabinPalette(kind) {
  if (['sport', 'super', 'hatch'].includes(kind)) return CABIN_FAMILIES.sport;
  if (['muscle', 'taxi', 'offroad'].includes(kind)) return CABIN_FAMILIES.classic;
  if (['truck', 'delivery', 'van', 'pickup'].includes(kind)) return CABIN_FAMILIES.utility;
  if (['compact', 'minivan'].includes(kind)) return CABIN_FAMILIES.compact;
  return CABIN_FAMILIES.touring;
}

// Rounded rectangles have actual bevel rings with smooth normals, including at the edge facing the driver.
function rounded(w, h, d, radius = 0.025, bevel = 0.008) {
  const b = Math.min(bevel, d * 0.3, h * 0.1, w * 0.1), hw = w / 2 - b, hh = h / 2 - b;
  const r = Math.max(0.001, Math.min(radius - b, hw, hh));
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hh); shape.lineTo(hw - r, -hh); shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r); shape.quadraticCurveTo(hw, hh, hw - r, hh); shape.lineTo(-hw + r, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r); shape.lineTo(-hw, -hh + r); shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d - 2 * b, bevelEnabled: b > 0, bevelThickness: b,
    bevelSize: b, bevelSegments: 3, curveSegments: 5, steps: 1 });
  g.translate(0, 0, -(d - 2 * b) / 2);
  return g;
}

// Every static part uses the same material. Surface properties live beside colour in geometry, so leather,
// moulded plastic and satin metal keep distinct highlights without introducing separate material draw calls.
function paint(geometry, hex, roughness = 0.75, metalness = 0) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const n = g.attributes.position.count, c = new THREE.Color(hex), colors = new Float32Array(n * 3), surface = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    surface[i * 2] = roughness; surface[i * 2 + 1] = metalness;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('cabinSurface', new THREE.BufferAttribute(surface, 2));
  g.deleteAttribute('uv');
  return g;
}
const place = (g, x, y, z, rx = 0) => g.rotateX(rx).translate(x, y, z);
function mergeParts(parts) {
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

function seat(x, y, z, recline, palette, width = 0.5) {
  const parts = [], add = (g, color, roughness = 0.75) => parts.push(paint(g, color, roughness));
  add(place(rounded(width, 0.14, 0.52, 0.06, 0.023), x, y - 0.05, z + 0.04), palette.leather, 0.6);
  add(place(rounded(width * 0.63, 0.025, 0.42, 0.035, 0.005), x, y + 0.029, z + 0.045), palette.insert, 0.88);
  const back = (g) => g.translate(0, 0.33, -0.065).rotateX(-recline).translate(x, y + 0.02, z - 0.2);
  add(back(rounded(width * 0.96, 0.65, 0.14, 0.075, 0.018)), palette.leather, 0.62);
  add(back(rounded(width * 0.64, 0.51, 0.02, 0.055, 0.004).translate(0, -0.025, 0.08)), palette.insert, 0.88);
  for (const side of [-1, 1]) {
    const bolster = rounded(width * 0.17, 0.53, palette.sporty ? 0.23 : 0.17, 0.045, 0.022);
    bolster.translate(side * width * 0.4, 0.31, -0.015).rotateX(-recline).translate(x, y + 0.02, z - 0.2);
    add(bolster, palette.leather, 0.58);
    add(place(rounded(width * 0.16, 0.13, 0.45, 0.036, 0.018), x + side * width * 0.4, y + 0.035, z + 0.05), palette.leather, 0.6);
  }
  // Separate metal posts keep the headrest visually attached to its seat without a solid rectangular neck.
  for (const side of [-1, 1]) {
    const post = new THREE.CylinderGeometry(0.008, 0.008, 0.15, 10);
    post.translate(side * width * 0.17, 0.67, -0.065).rotateX(-recline).translate(x, y + 0.02, z - 0.2);
    parts.push(paint(post, 0x969fa7, 0.3, 0.85));
  }
  const head = rounded(width * 0.54, 0.18, 0.14, 0.044, 0.022);
  head.translate(0, 0.77, -0.075).rotateX(-recline).translate(x, y + 0.02, z - 0.2);
  add(head, palette.leather, 0.62);
  return parts;
}

function rearBench(L, kind, palette) {
  if (!L.rear) return [];
  const hip = L.seat[1] + 0.02, compact = kind === 'compact';
  // The short hatch has a steep rear window. The full-height touring bench extended through that glass by
  // almost half a metre. Its shorter, more upright rear backrest fits inside the measured glazing footprint.
  const z = compact ? Math.max(L.seat[2] - 0.88, L.back + 0.665) : L.seat[2] - 0.88;
  const recline = compact ? Math.min(L.recline * 0.8, 0.2) : L.recline * 0.8;
  const parts = seat(0, hip, z, recline, palette, L.width * 1.7);
  if (compact) for (const geometry of parts) geometry.translate(0, -hip, 0).scale(1, 0.84, 1).translate(0, hip, 0);
  return parts;
}

let interiorMaterial = null;
function cabinMaterial() {
  if (interiorMaterial) return interiorMaterial;
  const m = interiorMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, envMapIntensity: 0.62 });
  const surface = varying(attribute('cabinSurface', 'vec2'));
  m.roughnessNode = surface.x;
  m.metalnessNode = surface.y;
  m.name = 'AutomotiveInterior';m.userData.shared = true;
  return m;
}

// Swept padded dash: the broad crown and the curved front face provide continuous daylight highlights.
function dashboard(width, sporty = false) {
  const contour = [[-0.02, -0.34], [0.008, -0.25], [-0.015, -0.09], [-0.055, -0.055],
    [-0.22, -0.13], [-0.285, -0.2], [-0.19, -0.34]].map(([y, z]) => new THREE.Vector3(0, y, z));
  const curve = new THREE.CatmullRomCurve3(contour, true, 'centripetal');
  const columns = 16, ring = 32, positions = [], indices = [];
  for (let i = 0; i <= columns; i++) {
    const t = i / columns, x = (t * 2 - 1) * width, sweep = (x / width) ** 2 * (sporty ? 0.075 : 0.025);
    for (let j = 0; j < ring; j++) {
      const p = curve.getPoint(j / ring);
      positions.push(x, p.y + 0.012 * (1 - (x / width) ** 2), p.z - sweep);
    }
  }
  for (let i = 0; i < columns; i++) for (let j = 0; j < ring; j++) {
    const a = i * ring + j, b = i * ring + (j + 1) % ring, c = a + ring, d = b + ring;
    indices.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));g.setIndex(indices);g.computeVertexNormals();
  return g;
}

const wheelGeometries = new Map();
function steeringWheel(radius, palette) {
  const key = radius + ':' + palette.family;
  if (wheelGeometries.has(key)) return wheelGeometries.get(key);
  const parts = [], ring = new THREE.TorusGeometry(radius, palette.sporty ? 0.022 : 0.024, 12, 72);
  if (palette.sporty) {
    const p = ring.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < -radius * 0.78) p.setY(i, -radius * 0.78 + (p.getY(i) + radius * 0.78) * 0.28);
    ring.computeVertexNormals();
  }
  parts.push(paint(ring, 0x272b2d, 0.55));
  // Broad shaped spokes and a padded centre, all modelled with bevels rather than thin black rectangles.
  for (const side of [-1, 1]) {
    const spoke = rounded(radius * 0.75, 0.047, 0.025, 0.014, 0.006);
    spoke.rotateZ(side * 0.13).translate(side * radius * 0.56, 0.005, -0.008);
    parts.push(paint(spoke, palette.accent, 0.3, palette.metal));
    const control = rounded(0.044, 0.029, 0.008, 0.007, 0.002).rotateZ(side * 0.13).translate(side * radius * 0.57, 0.005, -0.024);
    parts.push(paint(control, 0x20292d, 0.57));
    for (const dy of [-0.006, 0.006]) parts.push(paint(place(new THREE.BoxGeometry(0.013, 0.002, 0.001), side * radius * 0.57, dy + 0.005, -0.029), 0x9ca9ad, 0.55));
  }
  const lower = rounded(0.036, radius * 0.72, 0.02, 0.01, 0.004).translate(0, -radius * 0.48, -0.006);
  parts.push(paint(lower, palette.sporty ? palette.accent : 0x444b4f, 0.36, palette.sporty ? 0.7 : 0.15));
  parts.push(paint(rounded(0.145, 0.112, 0.065, 0.036, 0.016).translate(0, -0.012, -0.019), 0x343a3b, 0.68));
  // The original lozenge is intentionally unbranded, small enough to read as an embossed hub insert.
  parts.push(paint(rounded(0.025, 0.018, 0.004, 0.005, 0.001).rotateZ(Math.PI / 4).translate(0, -0.008, -0.055), palette.accent, 0.24, 0.85));
  if (palette.sporty) parts.push(paint(new THREE.BoxGeometry(0.008, 0.024, 0.012).translate(0, radius - 0.001, -0.022), 0xa4bfc9, 0.55));
  const g = mergeParts(parts);wheelGeometries.set(key, g);return g;
}

const instrumentFaces = new Map();
let needleMaterial = null;
function instrumentProfile(kind) {
  if (kind === 'truck' || kind === 'delivery') return { speed: 180, rpm: 5000, redline: 3800 };
  if (kind === 'super') return { speed: 360, rpm: 10000, redline: 9000 };
  if (kind === 'sport') return { speed: 320, rpm: 9000, redline: 8200 };
  return { speed: 280, rpm: 8000, redline: kind === 'muscle' ? 6200 : 6600 };
}
function instrumentAngle(value, maximum) {
  return Math.PI * 0.75 - Math.max(0, Math.min(1, value / maximum)) * Math.PI * 1.5;
}
function instrumentFace(profile, palette) {
  const key = profile.speed + ':' + profile.rpm + ':' + profile.redline + ':' + palette.family;
  if (instrumentFaces.has(key)) return instrumentFaces.get(key);
  const canvas = document.createElement('canvas');canvas.width = 1024;canvas.height = 512;
  const c = canvas.getContext('2d');
  c.fillStyle = '#10171b';c.fillRect(0, 0, 1024, 512);
  const dial = (x, maximum, step, label, redline = Infinity) => {
    const y = 163, r = 133;
    const gradient = c.createRadialGradient(x - 22, y - 40, 0, x, y, r);
    gradient.addColorStop(0, '#253139');gradient.addColorStop(0.64, '#111b20');gradient.addColorStop(1, '#080e12');
    c.fillStyle = gradient;c.beginPath();c.arc(x, y, r, 0, Math.PI * 2);c.fill();
    c.lineWidth = 3;c.strokeStyle = '#8b9c9d';c.stroke();
    c.lineWidth = 1;c.strokeStyle = '#41515a';c.beginPath();c.arc(x, y, r - 7, 0, Math.PI * 2);c.stroke();
    for (let value = 0; value <= maximum; value += step / 2) {
      const a = Math.PI * 0.75 + value / maximum * Math.PI * 1.5, major = value % step === 0, inside = r - (major ? 23 : 12);
      c.strokeStyle = value >= redline ? '#f1795f' : major ? palette.light : '#7c8a92';c.lineWidth = major ? 3 : 1.3;
      c.beginPath();c.moveTo(x + Math.cos(a) * inside, y + Math.sin(a) * inside);c.lineTo(x + Math.cos(a) * (r - 11), y + Math.sin(a) * (r - 11));c.stroke();
      if (major) { c.font = '20px sans-serif';c.textAlign = 'center';c.textBaseline = 'middle';c.fillStyle = palette.light;
        c.fillText(String(maximum > 1000 ? value / 1000 : value), x + Math.cos(a) * (r - 44), y + Math.sin(a) * (r - 44)); }
    }
    c.font = '13px sans-serif';c.textAlign = 'center';c.fillStyle = '#b4c5ca';c.fillText(label, x, y + 53);
    c.font = '10px sans-serif';c.fillStyle = '#879aa0';c.fillText('OVERDRAFT', x, y + 75);
    c.fillStyle = '#6e7a81';c.beginPath();c.arc(x, y, 10, 0, Math.PI * 2);c.fill();
  };
  dial(192, profile.speed, 40, 'km/h');dial(576, profile.rpm, 1000, 'tr/min × 1000', profile.redline);
  // A secondary dashboard face shares the same atlas and draw call as the instruments.
  c.fillStyle = '#101c24';c.fillRect(768, 0, 256, 160);c.fillStyle = palette.light;
  c.textAlign = 'left';c.font = 'bold 16px sans-serif';c.fillText(palette.screen ? 'OD  RADIO' : 'RADIO', 790, 26);
  c.strokeStyle = '#48616c';c.lineWidth = 1;c.beginPath();c.moveTo(790, 40);c.lineTo(1000, 40);c.stroke();
  c.font = palette.screen ? '36px sans-serif' : '32px monospace';c.fillText('88.7', 790, 88);
  c.font = '12px sans-serif';c.fillText('FM', 889, 88);c.fillStyle = '#8aabb8';c.font = '12px sans-serif';c.fillText('MANHATTAN', 790, 125);
  c.fillStyle = '#a4bdc2';for (let i = 0; i < 6; i++) c.fillRect(934 + i * 10, 110 - i * 5, 4, 7 + i * 5);
  const texture = new THREE.CanvasTexture(canvas);texture.colorSpace = THREE.SRGBColorSpace;texture.anisotropy = 8;
  const material = new THREE.MeshBasicNodeMaterial({ map: texture, color: 0xadbfc3, toneMapped: true });
  material.name = 'CarInstruments';material.userData.shared = true;instrumentFaces.set(key, material);return material;
}
function displayPlane(w, h, x, y, rw, rh) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * rw) / 1024, 1 - (y + (1 - uv.getY(i)) * rh) / 512);
  return g;
}
function buildInstruments(kind, layout, screenY, screenZ) {
  const profile = instrumentProfile(kind), palette = cabinPalette(kind), group = new THREE.Group();group.name = 'InstrumentCluster';
  const faces = [displayPlane(0.43, 0.18, 0, 0, 768, 320)];
  if (Number.isFinite(screenY) && Number.isFinite(screenZ)) {
    const screen = displayPlane(0.226, 0.141, 768, 0, 256, 160);
    // The cluster group faces -Z; convert the centre-stack point back into that local frame.
    screen.translate(layout.seat[0], screenY - (layout.dash[0] - 0.08), -(screenZ - (layout.dash[1] - 0.446)));
    faces.push(screen);
  }
  group.add(new THREE.Mesh(mergeParts(faces), instrumentFace(profile, palette)));
  needleMaterial ??= new THREE.MeshBasicNodeMaterial({ color: 0xff7654, toneMapped: true });needleMaterial.userData.shared = true;
  const needle = (x) => {
    const g = new THREE.BufferGeometry();g.setAttribute('position', new THREE.Float32BufferAttribute([-0.002, -0.008, 0, 0.002, -0.008, 0, 0.0007, 0.058, 0, -0.0007, 0.058, 0], 3));g.setIndex([0, 1, 2, 0, 2, 3]);g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, needleMaterial);mesh.position.set(x, -0.0017, 0.0012);group.add(mesh);return mesh;
  };
  const speed = needle(-0.1075), revs = needle(0.1075);speed.rotation.z = revs.rotation.z = instrumentAngle(0, 1);
  return { group, speed, revs, profile };
}

function buildCabin(layout, parent, kind = 'sedan', options = {}) {
  const L = layout;
  if (options.sourceInterior) {
    // Keep the supplied cabin architecture; its extracted wheel and instruments remain fully functional.
    const mesh = new THREE.Group();mesh.name = 'SourceCabin';
    let rim = new THREE.Group(), steeringAxis = null;
    if (options.steering?.geometry && options.material) {
      rim = new THREE.Mesh(options.steering.geometry, options.material);rim.name = 'SourceSteeringWheel';
      rim.position.fromArray(options.steering.position);
      steeringAxis = new THREE.Vector3().fromArray(options.steering.axis ?? [0, -Math.sin(L.tilt), Math.cos(L.tilt)]).normalize();
      // Imported plane normals may point either way; the driver's hand pose uses the forward column axis.
      if (steeringAxis.z < 0) steeringAxis.negate();
      mesh.add(rim);
    }
    let instruments = null;
    if (L.instruments) {
      instruments = buildInstruments(kind, L);
      const panel = L.instruments, scale = Math.min(panel.width / 0.43, panel.height / 0.18);
      instruments.group.scale.setScalar(scale);
      instruments.group.position.fromArray(panel.position);
      instruments.group.rotation.fromArray(panel.rotation ?? [0, Math.PI, 0]);
      mesh.add(instruments.group);
    }
    parent.add(mesh);mesh.updateMatrixWorld();
    return { layout: L, mesh, rim, turn: 0, instruments, steeringAxis, sourceInterior: true, family: 'source' };
  }
  const P = cabinPalette(kind), [x, hip, z] = L.seat, [dashY, windshieldZ] = L.dash;
  // Keep the instrument face ahead of the wheel rim. The old deep fascia overlapped the wheel plane.
  const dashZ = windshieldZ + 0.2;
  const parts = [...seat(x, hip, z, L.recline, P), ...seat(-x, hip, z, L.recline, P)];
  parts.push(...rearBench(L, kind, P));
  const add = (g, hex = P.top, rough = 0.75, metal = 0) => parts.push(paint(g, hex, rough, metal));
  add(dashboard(L.width, P.sporty).translate(0, dashY, windshieldZ), P.top, 0.79);
  add(place(rounded(L.width * 1.91, 0.17, 0.075, 0.047, 0.016), 0, dashY - 0.205, dashZ - 0.535), P.lower, 0.67);
  add(place(rounded(L.width * 1.87, 0.012, 0.018, 0.005, 0.002), 0, dashY - 0.103, dashZ - 0.576), P.accent, 0.28, P.metal);
  // A separate padded eyebrow surrounds a recessed instrument face, rather than a floating rectangular card.
  add(place(rounded(0.49, 0.235, 0.215, 0.057, 0.013), x, dashY - 0.08, dashZ - 0.52), P.top, 0.74);
  add(place(rounded(0.448, 0.195, 0.013, 0.031, 0.003), x, dashY - 0.08, dashZ - 0.632), 0x20272b, 0.58);
  for (const sign of [-1, 1]) {
    const bezel = new THREE.TorusGeometry(0.075, 0.0024, 6, 48);
    add(bezel.translate(x + sign * 0.1075, dashY - 0.0817, dashZ - 0.649), P.accent, 0.3, P.metal);
  }
  const screenY = dashY - 0.145, screenZ = dashZ - 0.638;
  add(place(rounded(0.276, 0.183, 0.065, 0.026, 0.008), 0, screenY, dashZ - 0.59), 0x252f34, 0.55);
  add(place(rounded(0.242, 0.154, 0.012, 0.014, 0.002), 0, screenY, screenZ + 0.009), P.accent, 0.32, P.metal);
  // Vent pockets and slats have real thickness; their light edges make the dashboard scale legible in daylight.
  for (const sign of [-1, 1]) {
    const vx = sign * L.width * 0.79, vy = dashY - 0.055, vz = dashZ - 0.59;
    add(place(rounded(0.168, 0.089, 0.035, 0.018, 0.004), vx, vy, vz), P.accent, 0.34, P.metal);
    add(place(rounded(0.149, 0.069, 0.012, 0.012, 0.002), vx, vy, vz - 0.02), 0x131d22, 0.83);
    for (let i = 0; i < 4; i++) add(place(rounded(0.134, 0.006, 0.016, 0.002, 0.001), vx, vy - 0.023 + i * 0.015, vz - 0.028), 0x8a9395, 0.48, 0.23);
  }
  for (const sx of [-0.085, 0, 0.085]) {
    add(place(new THREE.CylinderGeometry(0.024, 0.027, 0.027, 24), sx, dashY - 0.278, dashZ - 0.61, Math.PI / 2), P.accent, 0.3, P.metal);
    add(place(new THREE.CylinderGeometry(0.019, 0.019, 0.008, 24), sx, dashY - 0.278, dashZ - 0.628, Math.PI / 2), 0x1b252b, 0.65);
    add(place(new THREE.BoxGeometry(0.0025, 0.009, 0.0015), sx, dashY - 0.266, dashZ - 0.634), 0xc9dadb, 0.5);
  }
  // Centre tunnel with a real selector boot, a metallic gate and a padded armrest.
  add(place(rounded(0.24, Math.max(0.19, hip * 0.75), 0.96, 0.055, 0.02), 0, hip * 0.5, z + 0.2), 0x30383a, 0.83);
  add(place(rounded(0.25, 0.09, 0.35, 0.04, 0.014), 0, hip + 0.04, z + 0.005), P.leather, 0.57);
  add(place(rounded(0.14, 0.018, 0.22, 0.034, 0.004), 0, hip + 0.1, z + 0.39), P.accent, 0.3, P.metal);
  add(place(rounded(0.1, 0.045, 0.14, 0.024, 0.008), 0, hip + 0.12, z + 0.39), 0x252d30, 0.86);
  add(place(new THREE.CylinderGeometry(0.014, 0.019, 0.105, 12), 0, hip + 0.19, z + 0.4), P.accent, 0.26, P.metal);
  add(place(rounded(0.065, 0.05, 0.075, 0.023, 0.009), 0, hip + 0.245, z + 0.4), 0x343d40, 0.58);
  for (const sign of [-1, 1]) {
    const dx = sign * (L.width - 0.025);
    add(rounded(0.96, 0.37, 0.045, 0.055, 0.013).rotateY(Math.PI / 2).translate(dx, hip + 0.22, z + 0.19), P.lower, 0.76);
    add(rounded(0.55, 0.13, 0.025, 0.045, 0.007).rotateY(Math.PI / 2).translate(dx - sign * 0.032, hip + 0.27, z + 0.19), P.leather, 0.62);
    add(place(rounded(0.09, 0.05, 0.46, 0.018, 0.009), dx - sign * 0.05, hip + 0.3, z + 0.16), P.leather, 0.56);
    add(place(rounded(0.02, 0.032, 0.14, 0.009, 0.004), dx - sign * 0.057, hip + 0.36, z + 0.38), P.accent, 0.25, P.metal);
  }
  const [wx, wy, wz] = L.wheel;
  // Follow the wheel's forward/down column axis into the lower dashboard, never up through the instrument hood.
  add(new THREE.CylinderGeometry(0.032, 0.042, 0.42, 16).translate(0, 0.21, 0).rotateX(Math.PI / 2 + L.tilt).translate(wx, wy, wz), 0x252c30, 0.72);
  const mesh = new THREE.Mesh(mergeParts(parts), cabinMaterial());mesh.name = 'Cabin';mesh.castShadow = false;mesh.receiveShadow = true;
  const hub = new THREE.Group();hub.position.set(wx, wy, wz);hub.rotation.x = L.tilt;
  const rim = new THREE.Mesh(steeringWheel(L.radius, P), cabinMaterial());rim.name = 'SteeringWheel';rim.receiveShadow = true;hub.add(rim);
  const instruments = buildInstruments(kind, L, screenY, screenZ);
  instruments.group.position.set(x, dashY - 0.08, dashZ - 0.646);instruments.group.rotation.y = Math.PI;
  parent.add(mesh, hub, instruments.group);parent.updateMatrixWorld();
  return { layout: L, mesh, rim, turn: 0, instruments, family: P.family };
}

// The wheel turns with the front wheels, geared up so the driver's hands go round with it
const WHEEL_RATIO = 5, WHEEL_MOST = 2.4, HANDS_MOST = 1.15;
function poseCabin(cabin, steer, body = null) {
  cabin.turn = Math.max(-WHEEL_MOST, Math.min(WHEEL_MOST, steer * WHEEL_RATIO));
  if (cabin.steeringAxis) cabin.rim.quaternion.setFromAxisAngle(cabin.steeringAxis, -cabin.turn);
  else cabin.rim.rotation.z = -cabin.turn;
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

export { buildCabin, cabinLayout, cabinPalette, driverPose, instrumentAngle, instrumentProfile, poseCabin, rearBench };
