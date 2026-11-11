import * as THREE from 'three/webgpu';
import { createFlight, placeAircraft } from './flight.js';
import { buildAircraftModel } from './aircraft-models.js';

// The aircraft as things in the world: one entity per type, each a rigid body (flight.js) wearing a model
// (aircraft-models.js). An entity's position is its centre of gravity; its mesh takes the body's whole attitude, so a
// loop or a roll is drawn as flown. Gameplay reads the same planar fields as for any vehicle.

const SPECS = {
  classic: {
    label: 'Hauturier · Bourrasque', halfW: 4.9, halfL: 3.9, doors: [1.5, -0.6], zFront: 2.9, zRear: -4.8,
    chase: 13.5, height: 3.4, eye: [0, 0.78, -1.0], top: 67
  },
  jet: {
    label: 'Corsaire · Tramontane', halfW: 4.8, halfL: 7.6, doors: [1.6, 3.2], zFront: 7.6, zRear: -7.3,
    chase: 21, height: 4.6, eye: [0, 0.95, 3.75], top: 430
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
  return a;
}

// The body's attitude and its moving parts on the model
function poseAircraft(a, dt) {
  const b = a.flight, q = b.q, root = a.mesh;
  root.position.copy(a.position);
  root.quaternion.set(q[0], q[1], q[2], q[3]);
  a.model.pose?.(a, dt);
  root.updateMatrixWorld(true);
}

// A point of the aircraft (x left, y up, z forward, from its centre of gravity) in the world
function aircraftPoint(a, x, y, z, out) {
  const r = a.flight.r, p = a.position;
  return out.set(p.x + x * r[0] + y * r[3] + z * r[6], p.y + x * r[1] + y * r[4] + z * r[7], p.z + x * r[2] + y * r[5] + z * r[8]);
}

export { SPECS, aircraftPoint, createAircraft, poseAircraft };
