import * as THREE from 'three/webgpu';
import { createFlight, placeAircraft } from './flight.js';
import { buildAircraftModel } from './aircraft-assets.js';

// The aircraft as things in the world: one entity per type, each a rigid body (flight.js) wearing a model
// (aircraft-models.js). An entity's position is its centre of gravity; its mesh takes the body's whole attitude, so a
// loop or a roll is drawn as flown. Gameplay reads the same planar fields as for any vehicle.

const SPECS = {
  classic: {
    label: 'Hauturier · Bourrasque', halfW: 4.9, halfL: 4.2, doors: [1.3, -1.3], zFront: 2.2, zRear: -5.5,
    chase: 12.5, height: 3.1, eye: [0, 0.77, -1.28], top: 67
  },
  jet: {
    label: 'Corsaire · Tramontane', halfW: 3, halfL: 8.4, doors: [1.5, 4.9], zFront: 9.6, zRear: -7.1,
    chase: 15, height: 3.3, eye: [0, 0.1, 5.01], top: 430
  }
};

function createAircraft(scene, kind) {
  const spec = SPECS[kind];
  const model = buildAircraftModel(kind);
  const root = model.root;
  root.name = `Aircraft-${kind}`;
  scene.add(root);
  const flight = createFlight(kind);
  const a = {
    type: 'plane', kind, mode: 'plane', air: true, label: spec.label, mesh: root, model, flight,
    position: new THREE.Vector3(), heading: 0, speed: 0, verticalSpeed: 0, pitch: 0, roll: 0, throttle: 0.7, onGround: false, crashed: false,
    halfW: spec.halfW, halfL: spec.halfL, roadHalfW: 1.3, spec: { doors: spec.doors, zFront: spec.zFront, zRear: spec.zRear },
    cameraTargetOffset: new THREE.Vector3(0, 0.6, 0), chaseDistance: spec.chase, chaseHeight: spec.height, eye: spec.eye,
    drive: { speed: spec.top }
  };
  placeAircraft(a, { x: 0, y: 300, z: 0, heading: 0, speed: flight.tune.vStall * 2 });
  // the pilot's eye point is the model's own once it has loaded, and its navigation lights go where it says
  model.ready?.then(() => {
    if (model.points?.eye) a.eye = model.points.eye.slice(0, 3);
    a.lamps = navigationLights(root, model.points || {});
  });
  return a;
}

// Red on the left tip, green on the right, a white strobe on the tail: small unlit beads, bright enough to bloom at night
const LAMPS = [['lightL', 0xff1a12, 11], ['lightR', 0x14ff3c, 11], ['lightTail', 0xffffff, 16]];
let lampGeometry = null;
function navigationLights(root, points) {
  lampGeometry ??= new THREE.SphereGeometry(0.085, 10, 8);
  const lamps = [];
  for (const [name, color, power] of LAMPS) {
    const at = points[name];
    if (!at) continue;
    const material = new THREE.MeshBasicNodeMaterial({ color });
    material.color.multiplyScalar(power);
    const lamp = new THREE.Mesh(lampGeometry, material);
    lamp.position.set(at[0], at[1], at[2]);
    lamp.name = name;
    root.add(lamp);
    lamps.push(lamp);
  }
  return lamps;
}

// The body's attitude and its moving parts on the model
function poseAircraft(a, dt) {
  const b = a.flight, q = b.q, root = a.mesh;
  root.position.copy(a.position);
  root.quaternion.set(q[0], q[1], q[2], q[3]);
  a.model.pose?.(a, dt);
  // seen from the pilot's own eyes, the pilot is not in the picture
  const pilot = a.model.meshes?.pilot;
  if (pilot && a.inside) pilot.visible = false;
  // lights on while someone is aboard or it is flying; the tail strobe flashes twice every second and a half
  if (a.lamps) {
    const lit = !a.crashed && (a.ridden !== false || !b.onGround);
    a.lampT = ((a.lampT || 0) + dt) % 1.5;
    for (const lamp of a.lamps) lamp.visible = lit && (lamp.name !== 'lightTail' || a.lampT < 0.07 || (a.lampT > 0.2 && a.lampT < 0.27));
  }
  root.updateMatrixWorld(true);
}

// A point of the aircraft (x left, y up, z forward, from its centre of gravity) in the world
function aircraftPoint(a, x, y, z, out) {
  const r = a.flight.r, p = a.position;
  return out.set(p.x + x * r[0] + y * r[3] + z * r[6], p.y + x * r[1] + y * r[4] + z * r[7], p.z + x * r[2] + y * r[5] + z * r[8]);
}

export { SPECS, aircraftPoint, createAircraft, poseAircraft };
