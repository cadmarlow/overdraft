import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Original, metre-scale weapon models. All geometry and both materials are shared and prepared at boot;
// changing weapons only instantiates transforms. Movable parts use the same shaders as the receiver.
const PALETTE = {
  steel: 0x64717a, dark: 0x303b43, bright: 0xaeb9bf, bore: 0x11181c,
  polymer: 0x343b3e, grip: 0x242c2e, tan: 0x797463, brass: 0xb79a66, sight: 0xdadfc7
};
const templates = new Map();
let metal, polymer;

function materials() {
  if (!metal) {
    metal = new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: 0.72, roughness: 0.31 });
    polymer = new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: 0.08, roughness: 0.78 });
    metal.name = 'Machined weapon steel'; polymer.name = 'Moulded weapon polymer';
  }
  return [metal, polymer];
}

// A real bevel catches the light even when the weapon is only fifty pixels wide. Three segments per face
// make flat centres, chamfered edges and rounded corners without a normal-map download.
function bevelBox(w, h, d, radius = 0.003) {
  const g = new THREE.BoxGeometry(1, 1, 1, 3, 3, 3).toNonIndexed();
  const p = g.attributes.position, n = g.attributes.normal;
  const r = Math.min(radius, w * 0.23, h * 0.23, d * 0.23);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = x - Math.max(-1 / 6, Math.min(1 / 6, x));
    const ny = y - Math.max(-1 / 6, Math.min(1 / 6, y));
    const nz = z - Math.max(-1 / 6, Math.min(1 / 6, z));
    const length = Math.hypot(nx, ny, nz) || 1;
    p.setXYZ(i, Math.sign(x) * (w / 2 - r) + nx / length * r,
      Math.sign(y) * (h / 2 - r) + ny / length * r,
      Math.sign(z) * (d / 2 - r) + nz / length * r);
    n.setXYZ(i, nx / length, ny / length, nz / length);
  }
  return g;
}

function finishGeometry(g, color, x, y, z, rx = 0, ry = 0, rz = 0) {
  if (g.index) { const old = g; g = g.toNonIndexed(); old.dispose(); }
  if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  const c = new THREE.Color(PALETTE[color] ?? color), values = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < values.length; i += 3) { values[i] = c.r; values[i + 1] = c.g; values[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(values, 3));
  return g;
}

function builder() {
  const parts = [[], []];
  const add = (g, color, x, y, z, plastic = false, rx = 0, ry = 0, rz = 0) => {
    parts[plastic ? 1 : 0].push(finishGeometry(g, color, x, y, z, rx, ry, rz));
  };
  return {
    box(w, h, d, x, y, z, color = 'dark', plastic = false, rx = 0, rz = 0, radius = 0.003) {
      add(bevelBox(w, h, d, radius), color, x, y, z, plastic, rx, 0, rz);
    },
    tube(radius, length, x, y, z, color = 'steel', radial = 12) {
      add(new THREE.CylinderGeometry(radius, radius, length, radial, 1, true), color, x, y, z, false, Math.PI / 2);
    },
    muzzle(radius, x, y, z) {
      // Open annulus around a deeply recessed bore, not a solid cylinder end cap.
      add(new THREE.TorusGeometry(radius * 0.8, radius * 0.2, 5, 14), 'bright', x, y, z);
      add(new THREE.CircleGeometry(radius * 0.62, 14), 'bore', x, y, z - 0.003);
    },
    screw(x, y, z) {
      add(new THREE.CylinderGeometry(0.004, 0.004, 0.002, 8), 'bright', x, y, z, false, 0, 0, Math.PI / 2);
    },
    build(name) {
      const group = new THREE.Group(); group.name = name;
      const mats = materials();
      for (let i = 0; i < parts.length; i++) if (parts[i].length) {
        const geometry = mergeGeometries(parts[i]);
        for (const g of parts[i]) g.dispose();
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, mats[i]); mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.name = `${name} ${i ? 'polymer' : 'metal'}`;
        group.add(mesh);
      }
      return group;
    }
  };
}

function trigger(b, z, y, width = 0.034) {
  b.box(width, 0.007, 0.055, 0, y - 0.025, z, 'dark');
  b.box(width, 0.044, 0.008, 0, y - 0.007, z + 0.026, 'dark', false, -0.16);
  b.box(0.008, 0.027, 0.007, 0, y - 0.002, z + 0.002, 'bright', false, -0.22);
}

function rail(b, z0, z1, y, width = 0.035) {
  b.box(width, 0.008, z1 - z0, 0, y, (z0 + z1) / 2, 'dark');
  for (let z = z0; z <= z1; z += 0.021) b.box(width + 0.012, 0.006, 0.008, 0, y + 0.006, z, 'steel', false, 0, 0, 0.001);
}

function sights(b, rear, front, y) {
  for (const x of [-0.015, 0.015]) b.box(0.009, 0.024, 0.016, x, y, rear, 'dark');
  b.box(0.006, 0.022, 0.009, 0, y, front, 'dark');
  b.box(0.004, 0.004, 0.003, 0, y + 0.008, front - 0.006, 'sight', true);
}

function pistol() {
  const b = builder(), slide = builder(), mag = builder();
  b.box(0.038, 0.044, 0.19, 0, -0.008, 0.004, 'polymer', true);
  b.box(0.036, 0.105, 0.045, 0, -0.07, -0.052, 'grip', true, -0.17, 0, 0.005);
  b.box(0.039, 0.013, 0.051, 0, -0.116, -0.061, 'polymer', true, -0.17);
  trigger(b, -0.003, -0.035);
  b.tube(0.0105, 0.155, 0, 0.022, 0.035, 'steel');
  b.muzzle(0.0105, 0, 0.022, 0.115);
  b.box(0.044, 0.01, 0.023, 0, -0.016, -0.061, 'steel');
  for (const x of [-0.019, 0.019]) for (let i = 0; i < 7; i++) b.box(0.002, 0.004, 0.028, x, -0.043 - i * 0.009, -0.052 - i * 0.0015, 'polymer', true, -0.17, 0, 0.001);
  slide.box(0.039, 0.033, 0.216, 0, 0.032, -0.001, 'steel', false, 0, 0, 0.004);
  slide.box(0.027, 0.007, 0.033, 0.008, 0.051, 0.014, 'bore');
  slide.box(0.018, 0.005, 0.027, 0.008, 0.051, 0.014, 'bright');
  for (const x of [-0.0204, 0.0204]) for (let i = 0; i < 7; i++) slide.box(0.002, 0.027, 0.003, x, 0.032, -0.085 + i * 0.007, 'dark', false, -0.15, 0, 0.0005);
  sights(slide, -0.093, 0.091, 0.06);
  mag.box(0.029, 0.095, 0.032, 0, -0.073, -0.053, 'dark', false, -0.17);
  mag.box(0.040, 0.012, 0.048, 0, -0.121, -0.062, 'polymer', true, -0.17);
  const root = b.build('Calypso 9');
  root.add(slide.build('action'), mag.build('magazine'));
  return root;
}

function longGun(kind) {
  const b = builder(), mag = builder(), action = builder();
  const smg = kind === 'smg', shotgun = kind === 'shotgun';
  const grip = smg ? -0.118 : shotgun ? -0.243 : -0.076;
  const butt = smg ? -0.37 : shotgun ? -0.45 : -0.295;
  const end = smg ? 0.20 : shotgun ? 0.40 : 0.52;
  const bore = smg ? 0.03 : shotgun ? 0.018 : 0.035;
  const receiverZ = shotgun ? -0.18 : smg ? -0.075 : -0.025;
  const receiverLength = shotgun ? 0.23 : smg ? 0.23 : 0.25;
  b.box(smg ? 0.063 : 0.056, 0.075, receiverLength, 0, 0.012, receiverZ, smg ? 'steel' : 'dark');
  b.box(0.048, 0.12, 0.055, 0, -0.09, grip, shotgun ? 'tan' : 'grip', true, -0.2, 0, 0.006);
  for (let i = 0; i < 5; i++) b.box(0.051, 0.006, 0.04, 0, -0.058 - i * 0.018, grip - i * 0.003, 'polymer', true, -0.2, 0, 0.001);
  trigger(b, grip + 0.055, -0.04, 0.038);
  // Stock: a slim shoulder tube, cheek rest, lower brace, separate rubber butt pad.
  const stockFront = grip - 0.04, stockLength = stockFront - butt;
  b.tube(0.018, stockLength, 0, 0.005, (butt + stockFront) / 2, 'steel');
  b.box(0.052, 0.041, stockLength * 0.83, 0, 0.015, butt + stockLength * 0.39, shotgun ? 'tan' : 'polymer', true, 0, 0, 0.006);
  b.box(0.039, 0.024, stockLength * 0.72, 0, -0.035, butt + stockLength * 0.40, 'polymer', true, -0.17);
  b.box(0.061, 0.12, 0.025, 0, -0.025, butt, 'grip', true, 0.07, 0, 0.007);
  for (let i = 0; i < 5; i++) b.box(0.064, 0.004, 0.005, 0, -0.063 + i * 0.019, butt - 0.013, 'polymer', true, 0, 0, 0.001);
  // Visible barrel and forward furniture, very different silhouettes for each family.
  const forward = smg ? 0.08 : shotgun ? 0.12 : 0.24;
  b.tube(shotgun ? 0.016 : 0.012, end - forward + 0.03, 0, bore, (end + forward) / 2 - 0.015);
  b.tube(shotgun ? 0.022 : 0.019, 0.045, 0, bore, end - 0.022, 'dark');
  b.muzzle(shotgun ? 0.019 : 0.015, 0, bore, end + 0.002);
  if (shotgun) {
    b.tube(0.015, 0.43, 0, -0.018, 0.12, 'steel');
    b.box(0.055, 0.055, 0.105, 0, -0.017, -0.034, 'dark');
    action.box(0.066, 0.062, 0.182, 0, -0.019, 0.145, 'tan', true, 0, 0, 0.008);
    for (let i = 0; i < 9; i++) action.box(0.07, 0.064, 0.007, 0, -0.019, 0.071 + i * 0.018, 'grip', true, 0, 0, 0.002);
    b.box(0.04, 0.013, 0.02, 0, bore + 0.021, end - 0.07, 'dark');
    sights(b, -0.225, end - 0.065, bore + 0.037);
  } else {
    b.box(smg ? 0.061 : 0.066, 0.062, smg ? 0.15 : 0.28, 0, 0.004, smg ? 0.086 : 0.217, smg ? 'polymer' : 'tan', true, 0, 0, 0.007);
    for (const x of [-1, 1]) for (let i = 0; i < (smg ? 4 : 7); i++) {
      b.box(0.002, 0.015, 0.018, x * (smg ? 0.031 : 0.0335), 0.006, (smg ? 0.031 : 0.105) + i * 0.032, 'bore', false, 0, 0, 0.002);
    }
    if (smg) b.box(0.036, 0.085, 0.044, 0, -0.069, 0.108, 'grip', true, -0.06);
    rail(b, grip - 0.06, smg ? 0.125 : 0.32, 0.058, 0.033);
    sights(b, grip - 0.04, smg ? 0.12 : 0.32, 0.085);
    if (!smg) {
      // A compact open optic gives the carbine a readable shoulder-view silhouette. It remains an actual
      // hollow housing, so the rear aperture does not turn into a painted solid disk at close range.
      b.box(0.045, 0.017, 0.074, 0, 0.079, -0.035, 'dark');
      b.tube(0.021, 0.062, 0, 0.107, -0.035, 'dark');
      b.tube(0.024, 0.009, 0, 0.107, -0.066, 'steel');
      b.tube(0.024, 0.009, 0, 0.107, -0.004, 'steel');
      b.box(0.013, 0.016, 0.023, -0.026, 0.104, -0.033, 'dark');
    }
    const magazineZ = smg ? -0.025 : 0.046;
    mag.box(0.039, smg ? 0.19 : 0.15, 0.064, 0, -0.105, magazineZ, 'steel', false, smg ? 0.03 : -0.13, 0, 0.005);
    mag.box(0.044, 0.015, 0.068, 0, smg ? -0.201 : -0.185, magazineZ - (smg ? 0 : 0.012), 'polymer', true);
    for (const x of [-0.0205, 0.0205]) for (let i = 0; i < 3; i++) mag.box(0.002, 0.1, 0.004, x, -0.115, magazineZ - 0.018 + i * 0.018, 'dark', false, smg ? 0.03 : -0.13, 0, 0.001);
  }
  // Ejection window, bolt face, release catch and exposed fasteners.
  b.box(0.003, 0.025, 0.068, -0.030, 0.018, receiverZ + 0.035, 'bore');
  action.box(0.004, 0.017, 0.044, -0.031, 0.019, receiverZ + 0.035, 'bright');
  action.box(0.018, 0.011, 0.012, -0.040, 0.018, receiverZ + 0.004, 'steel');
  for (const x of [-0.031, 0.031]) for (const z of [receiverZ - 0.065, receiverZ + 0.065]) b.screw(x, -0.001, z);
  const root = b.build(smg ? 'Hornet' : shotgun ? 'Breaker 12' : 'Sentinel');
  root.add(action.build('action'));
  if (!shotgun) root.add(mag.build('magazine'));
  return root;
}

function prepareWeaponModels() {
  if (templates.size) return;
  templates.set('pistol', pistol());
  for (const kind of ['smg', 'shotgun', 'rifle']) templates.set(kind, longGun(kind));
}

function createWeaponModel(kind) {
  prepareWeaponModels();
  const model = templates.get(kind)?.clone(true);
  if (!model) return null;
  model.userData.action = model.getObjectByName('action');
  model.userData.magazine = model.getObjectByName('magazine');
  return model;
}

// The magazine leaves its well, disappears at the belt, then seats before the action is worked. The pump
// follows a delayed mechanical stroke, while self-loading actions cycle immediately after each shot.
function animateWeapon(model, kind, shotAge, reload) {
  const action = model.userData.action, mag = model.userData.magazine;
  const reloading = reload >= 0 && reload <= 1;
  let cycle = Math.exp(-shotAge * 38);
  if (kind === 'shotgun') cycle = Math.max(0, 1 - Math.abs(shotAge - 0.26) / 0.16);
  if (reloading && reload > 0.78) cycle = Math.max(cycle, Math.sin(Math.min(1, (reload - 0.78) / 0.18) * Math.PI));
  if (action) { action.position.z = -cycle * (kind === 'shotgun' ? 0.085 : kind === 'pistol' ? 0.032 : 0.038); action.updateMatrix(); }
  if (mag) {
    const extraction = reloading ? Math.max(0, Math.min(1, (reload - 0.13) / 0.13, (0.71 - reload) / 0.13)) : 0;
    mag.position.y = -extraction * 0.16;
    mag.visible = !reloading || reload < 0.29 || reload > 0.51;
    mag.updateMatrix();
  }
}

export { prepareWeaponModels, createWeaponModel, animateWeapon };
