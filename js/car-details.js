import * as THREE from 'three/webgpu';
import { attribute, float, fract, mix, positionLocal, smoothstep, varying, vec3, vertexColor } from 'three/tsl';

// One instanced draw for four brake assemblies. The calipers follow steering and suspension, never tyre rotation.
// Geometry and material are cached; all initial cars build them before the game's shader warm-up.
const geometryCache = new Map();
let sharedMaterial = null;
const dummy = new THREE.Object3D();
const TAU = Math.PI * 2;
const performanceCars = new Set(['sport', 'super', 'muscle', 'hatch']);

// How far out the faces of a wheel's spokes stand, over the area a brake disc of this radius shows through: the
// wheel's outermost point above each cell of that area, then a depth most cells reach (the gaps between spokes look
// down the barrel, a centre cap stands proud: neither is the spokes).
function spokeDepth(geometry, side, radius) {
  const p = geometry.attributes.position, index = geometry.index.array, G = 20, front = new Float32Array(G * G).fill(-Infinity);
  const mark = (x, y, z) => {
    const r = Math.hypot(y, z);
    if (r > radius || r < radius * 0.45) return;
    const cell = Math.min(G - 1, Math.floor((y / radius + 1) * G / 2)) * G + Math.min(G - 1, Math.floor((z / radius + 1) * G / 2));
    if (x * side > front[cell]) front[cell] = x * side;
  };
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a), bx = p.getX(b), by = p.getY(b), bz = p.getZ(b), cx = p.getX(c), cy = p.getY(c), cz = p.getZ(c);
    mark(ax, ay, az); mark(bx, by, bz); mark(cx, cy, cz);
    mark((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); mark((bx + cx) / 2, (by + cy) / 2, (bz + cz) / 2); mark((cx + ax) / 2, (cy + ay) / 2, (cz + az) / 2);
    mark((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);
  }
  const cells = Array.from(front).filter((v) => v > -Infinity).sort((u, v) => u - v);
  return cells.length ? cells[Math.floor(cells.length * 0.7)] : Infinity;
}

function brakeLayout(model, index) {
  const wheel = model.spec.wheels[index], geometry = model.wheels[index];
  const p = geometry.attributes.position;
  const side = index % 2 ? -1 : 1;
  let outer = 0;
  for (const i of geometry.index.array) outer = Math.max(outer, p.getX(i) * side);
  const rotor = performanceCars.has(model.id) ? 0.65 : 0.57;
  // Behind the spokes, whatever the wheel: a deep-dish rim keeps them well inside its face, and a disc placed by the
  // width of the tyre alone stood in front of them (the taxi and the muscle car showed a bare disc for a wheel).
  const behindSpokes = spokeDepth(geometry, side, rotor * wheel[3]) - 0.012 - 0.039 * wheel[3];
  return { side, radius: wheel[3], offset: Math.max(0.018, Math.min(outer * 0.44, behindSpokes)), rotor };
}

function brakeGeometry(kind, rotor) {
  const key = `${kind}:${rotor}`;
  if (geometryCache.has(key)) return geometryCache.get(key);
  const parts = [];
  const add = (geometry, hex, disc = 0) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.attributes.position, c = new THREE.Color(hex), colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('detailPart', new THREE.BufferAttribute(new Float32Array(p.count).fill(disc), 1));
    parts.push(g);
  };
  // Two friction faces enclose a darker, ventilated edge. All dimensions are relative to the tyre radius.
  add(new THREE.CylinderGeometry(rotor, rotor, 0.07, 48).rotateZ(Math.PI / 2), 0x505257);
  for (const side of [-1, 1]) {
    add(new THREE.RingGeometry(0.22, rotor, 48).rotateY(side * Math.PI / 2).translate(side * 0.039, 0, 0), 0x9da1a6, 1);
  }
  add(new THREE.CylinderGeometry(0.22, 0.25, 0.14, 24).rotateZ(Math.PI / 2), 0x43464a);
  for (let i = 0; i < 18; i++) {
    const a = i * TAU / 18;
    add(new THREE.BoxGeometry(0.071, 0.025, 0.058).rotateX(-a).translate(0, Math.cos(a) * (rotor - 0.012), Math.sin(a) * (rotor - 0.012)), 0x15191c);
  }
  // A sculpted opposed-piston caliper, its bridge over the outer edge of the rotor.
  const caliper = performanceCars.has(kind) ? (kind === 'super' ? 0xc89a33 : 0xad3024) : 0x656b70;
  const a = -0.55, y = Math.cos(a) * rotor * 0.82, z = Math.sin(a) * rotor * 0.82;
  add(new THREE.BoxGeometry(0.19, rotor * 0.48, rotor * 0.56).rotateX(a).translate(0.025, y, z), caliper);
  add(new THREE.BoxGeometry(0.205, rotor * 0.2, rotor * 0.32).rotateX(a).translate(0.022, y + 0.02, z), caliper);
  for (const t of [-0.12, 0.12]) add(new THREE.CylinderGeometry(0.032, 0.032, 0.015, 8).rotateZ(Math.PI / 2).translate(0.13, y + t * Math.sin(a), z + t * Math.cos(a)), 0xc3c7cb);
  const attributes = {};
  for (const name of ['position', 'normal', 'color', 'detailPart']) {
    const itemSize = name === 'detailPart' ? 1 : 3;
    const length = parts.reduce((n, g) => n + g.attributes[name].array.length, 0), values = new Float32Array(length);
    let offset = 0;
    for (const g of parts) { values.set(g.attributes[name].array, offset); offset += g.attributes[name].array.length; }
    attributes[name] = new THREE.BufferAttribute(values, itemSize);
  }
  const g = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(attributes)) g.setAttribute(name, attribute);
  g.computeBoundingSphere();
  parts.forEach((p) => p.dispose());
  geometryCache.set(key, g);
  return g;
}

function brakeMaterial() {
  if (sharedMaterial) return sharedMaterial;
  const m = sharedMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, metalness: 0.62, roughness: 0.4, envMapIntensity: 0.75 });
  const disc = varying(attribute('detailPart', 'float'));
  const radius = positionLocal.yz.length();
  const machining = smoothstep(0.2, 0.8, fract(radius.mul(110))).mul(0.055);
  m.colorNode = vertexColor().rgb.mul(float(1).sub(machining.mul(disc)));
  // Thermal incandescence is restricted to the friction faces; a caliper never turns into a glowing wheel.
  m.emissiveNode = vec3(1, 0.075, 0.008).mul(varying(attribute('brakeHeat', 'float'))).mul(disc).mul(1.8);
  m.roughnessNode = mix(float(0.48), float(0.33), disc);
  m.name = 'VentilatedBrakes';
  m.userData.shared = true;
  return m;
}

function buildCarDetails(model, chassis, wheels) {
  const layouts = model.spec.wheels.map((_, i) => brakeLayout(model, i));
  const source = brakeGeometry(model.id, layouts[0].rotor);
  // Static buffers are shared, while temperatures belong to this car's four instances.
  const geometry = new THREE.BufferGeometry();
  for (const name of Object.keys(source.attributes)) geometry.setAttribute(name, source.attributes[name]);
  const heat = new THREE.InstancedBufferAttribute(new Float32Array(4), 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('brakeHeat', heat);
  const mesh = new THREE.InstancedMesh(geometry, brakeMaterial(), 4);
  mesh.name = 'BrakeAssemblies';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  chassis.add(mesh);
  const details = { mesh, wheels, layouts, heat, temperatures: new Float32Array(4).fill(20) };
  poseCarDetails(details, null, 0);
  return details;
}

function brakeTemperature(current, speed, brake, dt, front = true) {
  const h = Math.min(0.1, Math.max(0, dt));
  const velocity = Math.abs(speed || 0), pedal = Math.max(0, Math.min(1, brake || 0));
  // Roughly 40 degrees per second under a hard stop at 100 km/h, with front-biased energy and ram-air cooling.
  const heating = pedal * velocity * (front ? 1.5 : 0.85);
  const cooling = (current - 20) * (0.014 + velocity * 0.0011);
  return Math.max(20, Math.min(900, current + (heating - cooling) * h));
}

function poseCarDetails(details, body, dt) {
  if (!details) return;
  let changed = false;
  for (let i = 0; i < 4; i++) {
    const wheel = details.wheels[i], layout = details.layouts[i];
    dummy.position.copy(wheel.steerPivot.position);
    dummy.rotation.set(0, wheel.steerPivot.rotation.y, 0);
    dummy.translateX(layout.side * layout.offset);
    if (layout.side < 0) dummy.rotateY(Math.PI);
    dummy.scale.setScalar(layout.radius);
    dummy.updateMatrix();
    details.mesh.setMatrixAt(i, dummy.matrix);
    const temperature = brakeTemperature(details.temperatures[i], body?.speed || 0, body?.brake || 0, dt, wheel.isFront);
    details.temperatures[i] = temperature;
    const x = Math.max(0, Math.min(1, (temperature - 480) / 340)), heat = x * x * (3 - 2 * x);
    if (Math.abs(details.heat.array[i] - heat) > 0.002) { details.heat.array[i] = heat; changed = true; }
  }
  details.mesh.instanceMatrix.needsUpdate = true;
  if (changed) details.heat.needsUpdate = true;
  details.mesh.updateMatrixWorld();
}

export { brakeLayout, brakeTemperature, buildCarDetails, poseCarDetails };
