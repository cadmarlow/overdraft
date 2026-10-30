import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createVehicleHeadlight } from './vehicle-lights.js';

// Motorcycles: a sport bike built from simple solids (tank, fairing, fork, swingarm, wheels), driven by the shared car
// physics with a narrow footprint, leaning into turns, lifting its front wheel on demand. The rider is the protagonist's
// own rig (PersonRig.ride) posed on its seat; a hard enough impact throws the rider off (gameplay.js).

const SPEC = {
  name: 'moto', zFront: 1.08, zRear: -1.02, wheelZ: 0.72, wheelX: 0, wheelRadius: 0.32, doors: [0.15, -0.25],
  headlight: [0, 0.95]
};
const DRIVE = { speed: 54, reverseSpeed: 3.5, acceleration: 11.5, powerSpeed: 27, rolling: 0.14, drag: 0.0013, coast: 0.45, brake: 14,
  wheelbase: 1.44, grip: 11.5, cornering: 14 };
// Rider anchor points in the bike's frame (+Z forward)
const SEAT = { y: 0.9, z: -0.24 };
const BARS = { y: 1.02, z: 0.42 };
const PEGS = { y: 0.46, z: -0.02 };

const tube = (r0, r1, from, to, segments = 10) => {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, segments);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  return g.translate(a.x, a.y, a.z);
};
const box = (w, h, d, x, y, z, rx = 0) => new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z);

let _shared = null;
function sharedParts() {
  if (_shared) return _shared;
  const tire = new THREE.TorusGeometry(SPEC.wheelRadius - 0.07, 0.07, 12, 28).rotateY(Math.PI / 2);
  const rim = mergeGeometries([
    new THREE.CylinderGeometry(0.2, 0.2, 0.05, 20).rotateZ(Math.PI / 2),
    ...[0, 1, 2, 3, 4].map((i) => new THREE.BoxGeometry(0.03, 0.38, 0.03).rotateX(i * Math.PI / 5))
  ]);
  const frame = mergeGeometries([
    box(0.28, 0.3, 0.46, 0, 0.47, 0.02), // engine block
    box(0.22, 0.14, 0.34, 0, 0.36, -0.18),
    tube(0.035, 0.03, [0.09, 0.4, -0.12], [0.09, 0.33, -0.72]), // swingarm
    tube(0.035, 0.03, [-0.09, 0.4, -0.12], [-0.09, 0.33, -0.72]),
    tube(0.045, 0.04, [0, 0.6, -0.15], [0, 0.98, 0.42]), // spine to the steering head
    box(0.24, 0.05, 0.62, 0, 0.86, -0.36, -0.1) // seat base
  ]);
  const seat = box(0.27, 0.07, 0.5, 0, 0.92, -0.3, -0.1);
  const exhaust = mergeGeometries([tube(0.045, 0.05, [0.17, 0.3, 0.05], [0.2, 0.42, -0.62]), tube(0.06, 0.06, [0.2, 0.42, -0.62], [0.2, 0.47, -0.82])]);
  const fork = mergeGeometries([tube(0.028, 0.028, [0.1, 0, 0], [0.1, 0.72, -0.22]), tube(0.028, 0.028, [-0.1, 0, 0], [-0.1, 0.72, -0.22]),
    tube(0.016, 0.016, [-0.34, 0.74, -0.24], [0.34, 0.74, -0.24]), // handlebar
    box(0.06, 0.06, 0.1, 0.34, 0.74, -0.25), box(0.06, 0.06, 0.1, -0.34, 0.74, -0.25)]); // grips
  const lamp = new THREE.CylinderGeometry(0.085, 0.07, 0.08, 16).rotateX(Math.PI / 2);
  _shared = { tire, rim, frame, seat, exhaust, fork, lamp,
    rubber: new THREE.MeshStandardNodeMaterial({ color: 0x141517, roughness: 0.85 }),
    metal: new THREE.MeshStandardNodeMaterial({ color: 0x2a2c30, roughness: 0.45, metalness: 0.7 }),
    chrome: new THREE.MeshStandardNodeMaterial({ color: 0xd8dde3, roughness: 0.15, metalness: 0.9 }),
    leather: new THREE.MeshStandardNodeMaterial({ color: 0x1b1714, roughness: 0.7 }),
    glow: new THREE.MeshBasicNodeMaterial({ color: 0xfff4dc })
  };
  return _shared;
}

// Paint-dependent body panels: tank, tail and front fairing
function bodyGeometry() {
  const tank = new THREE.SphereGeometry(0.2, 18, 12).scale(0.95, 0.62, 1.45).translate(0, 0.96, 0.14);
  const tail = mergeGeometries([box(0.2, 0.12, 0.42, 0, 0.98, -0.66, -0.25), box(0.12, 0.06, 0.12, 0, 0.92, -0.9)]);
  const fairing = new THREE.SphereGeometry(0.22, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 1.1, 0.75).rotateX(1.25).translate(0, 0.92, 0.58);
  const fender = box(0.16, 0.03, 0.4, 0, 0.67, 0.74, 0.2);
  return mergeGeometries([tank, tail, fairing, fender]);
}

function createMotorbike(scene, { paint = 0xc81e2a } = {}) {
  const p = sharedParts();
  const root = new THREE.Group();
  root.name = 'Motorbike';
  const lean = new THREE.Group();
  root.add(lean);
  const paintMat = new THREE.MeshStandardNodeMaterial({ color: paint, roughness: 0.32, metalness: 0.45 });
  const parts = [
    new THREE.Mesh(p.frame, p.metal), new THREE.Mesh(p.seat, p.leather), new THREE.Mesh(p.exhaust, p.chrome),
    new THREE.Mesh(bodyGeometry(), paintMat)
  ];
  for (const m of parts) { m.castShadow = true; m.receiveShadow = true; lean.add(m); }

  // Front: fork and bars turn with the steering; both wheels spin
  const wheels = [];
  for (const front of [true, false]) {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(0, SPEC.wheelRadius, front ? SPEC.wheelZ : -SPEC.wheelZ);
    const tire = new THREE.Mesh(p.tire, p.rubber);
    tire.add(new THREE.Mesh(p.rim, p.chrome));
    tire.castShadow = true;
    steerPivot.add(tire);
    if (front) {
      const fork = new THREE.Mesh(p.fork, p.chrome);
      fork.castShadow = true;
      steerPivot.add(fork);
      const lamp = new THREE.Mesh(p.lamp, p.glow);
      lamp.position.set(0, 0.6, -0.04);
      steerPivot.add(lamp);
    }
    lean.add(steerPivot);
    wheels.push({ steerPivot, tire, isFront: front });
  }
  const spot = createVehicleHeadlight();
  spot.position.set(0, 0.95, 1.0);
  spot.target.position.set(0, 0.2, 12);
  lean.add(spot, spot.target);
  scene.add(root);

  return {
    type: 'car', kind: 'moto', moto: true, spec: SPEC, paint, mesh: root, chassisPivot: lean, carState: null, headLights: [spot], wheels,
    bodyMesh: parts[3], paintMaterial: paintMat,
    halfW: 0.42, halfL: 1.06,
    position: new THREE.Vector3(), prevX: 0, prevZ: 0, heading: 0, speed: 0, vx: 0, vz: 0, angularVel: 0,
    pitchVel: 0, rollVel: 0, heaveY: 0, heaveVel: 0, lastCollisionSpark: null, steerAngle: 0, wheelSpin: 0,
    lean: 0, wheelie: 0,
    drive: { ...DRIVE },
    seat: SEAT, bars: BARS, pegs: PEGS,
    cameraTargetOffset: new THREE.Vector3(0, 1.05, 0), chaseDistance: 4.4, chaseHeight: 1.75
  };
}

// Lean into the turn the tyres are making, lift the front wheel on demand; called after the physics step
function poseMotorbike(bike, dt, wheelieInput) {
  const speed = Math.abs(bike.speed);
  // fallen after a crash: on its side; parked: resting on the side stand
  const riding = speed > 0.5 || bike.ridden;
  const target = bike.fallen ? 1.42 : !riding ? 0.12 : -Math.max(-0.75, Math.min(0.75, bike.steerAngle * Math.min(1, speed / 10) * 2.6));
  bike.lean += (target - bike.lean) * Math.min(1, dt * 7);
  const wantWheelie = wheelieInput && !bike.fallen && bike.speed > 3 && bike.speed < 30 ? 0.42 : 0;
  bike.wheelie += (wantWheelie - bike.wheelie) * Math.min(1, dt * (wantWheelie ? 3 : 5));
  bike.chassisPivot.rotation.z = bike.lean;
  // pivot the wheelie about the rear contact patch
  bike.chassisPivot.rotation.x = -bike.wheelie;
  bike.chassisPivot.position.z = -SPEC.wheelZ * (1 - Math.cos(bike.wheelie));
  bike.chassisPivot.position.y = Math.sin(bike.wheelie) * SPEC.wheelZ * 0.98 + (bike.fallen ? -0.05 : 0);
}

export { createMotorbike, poseMotorbike, SPEC as MOTO_SPEC };
