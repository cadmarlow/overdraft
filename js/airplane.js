import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The Hauturier Sterne, a light single-engine plane, and the parachute that goes with it. Its flight model is in flight.js.

const part = (geometry, material) => {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  return m;
};

// A flying surface lying flat: `span` along +X from the root, tapering from `root` to `tip` chord
function wingGeometry(span, root, tip, thickness = 0.13, sweep = 0.25) {
  const shape = new THREE.Shape();
  shape.moveTo(0, root / 2);
  shape.lineTo(span * 0.92, tip / 2 - sweep);
  shape.quadraticCurveTo(span, tip * 0.15 - sweep, span * 0.94, -tip / 2 - sweep);
  shape.lineTo(0, -root / 2);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness * 0.5, bevelEnabled: true, bevelThickness: thickness * 0.25, bevelSize: 0.03, bevelSegments: 2, curveSegments: 6 });
  return g.rotateX(Math.PI / 2).translate(0, thickness * 0.25, 0);
}

function createPlane(scene) {
  const root = new THREE.Group();
  root.name = 'PlayerPlane';
  const tilt = new THREE.Group();
  tilt.position.y = 1.3; // the wheels touch at the entity's position
  root.add(tilt);

  const paint = new THREE.MeshStandardNodeMaterial({ color: 0xf1efe8, roughness: 0.3, metalness: 0.15 });
  const accent = new THREE.MeshStandardNodeMaterial({ color: 0xc92a2e, roughness: 0.32, metalness: 0.2 });
  const glass = new THREE.MeshStandardNodeMaterial({ color: 0x10181f, roughness: 0.08, metalness: 0.85 });
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x17191c, roughness: 0.65 });
  const metal = new THREE.MeshStandardNodeMaterial({ color: 0xb9c0c8, roughness: 0.28, metalness: 0.85 });

  // Fuselage: a revolved profile along the body, slightly deeper than wide
  const profile = [[0.02, -4.5], [0.12, -4.3], [0.3, -3.2], [0.48, -1.7], [0.62, -0.2], [0.68, 1.1], [0.66, 2.2], [0.56, 2.95]]
    .map(([r, z]) => new THREE.Vector2(r, z));
  const body = new THREE.LatheGeometry(profile, 24).rotateX(Math.PI / 2).scale(1, 1.12, 1);
  tilt.add(part(body, paint));
  const cowlProfile = [[0.56, 2.95], [0.54, 3.5], [0.42, 3.86], [0.2, 4.02]].map(([r, z]) => new THREE.Vector2(r, z));
  tilt.add(part(new THREE.LatheGeometry(cowlProfile, 24).rotateX(Math.PI / 2).scale(1, 1.12, 1), accent));
  const spinner = new THREE.ConeGeometry(0.19, 0.42, 16).rotateX(Math.PI / 2).translate(0, 0, 4.2);

  // Canopy, belly stripe
  const canopy = part(new THREE.SphereGeometry(0.5, 20, 12).scale(0.92, 0.82, 2.3).translate(0, 0.62, 0.95), glass);
  tilt.add(canopy);
  const stripe = new THREE.BoxGeometry(1.36, 0.1, 5.2).translate(0, -0.12, 0.2);
  tilt.add(part(stripe, accent));

  // Wings with a little dihedral, red tips; tailplane and fin
  const wing = wingGeometry(5.6, 1.9, 1.05);
  const tip = wingGeometry(0.7, 1.05, 0.72, 0.13, 0.12);
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.45, -0.34, 0.9);
    pivot.rotation.z = side * 0.065;
    pivot.scale.x = side;
    pivot.add(part(wing, paint));
    const end = part(tip, accent);
    end.position.set(5.32, 0, -0.26);
    pivot.add(end);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6),
      new THREE.MeshBasicNodeMaterial({ color: side > 0 ? 0xff2a30 : 0x2aff6a }));
    lamp.position.set(5.95, 0.04, -0.32);
    pivot.add(lamp);
    tilt.add(pivot);
    const stab = part(wingGeometry(1.75, 0.95, 0.5, 0.09, 0.12), paint);
    stab.position.set(side * 0.1, 0.12, -3.75);
    stab.scale.x = side;
    tilt.add(stab);
  }
  const fin = new THREE.Shape();
  fin.moveTo(0.55, 0); fin.lineTo(-0.85, 0); fin.lineTo(-1.15, 1.45); fin.lineTo(-0.5, 1.5); fin.closePath();
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 1 })
    .rotateY(-Math.PI / 2).translate(0.035, 0.16, -3.45);
  tilt.add(part(finGeo, accent));

  // Fixed gear in spats
  const wheelGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.13, 18).rotateZ(Math.PI / 2);
  const spatGeo = new THREE.SphereGeometry(0.3, 12, 8).scale(0.55, 0.85, 1.5);
  const gear = (x, y, z) => {
    tilt.add(part(wheelGeo.clone().translate(x, y, z), dark));
    tilt.add(part(spatGeo.clone().translate(x, y + 0.08, z), paint));
  };
  gear(1.05, -1.03, 0.65); gear(-1.05, -1.03, 0.65); gear(0, -1.03, 2.75);
  const struts = mergeGeometries([
    new THREE.CylinderGeometry(0.035, 0.05, 0.9, 8).rotateZ(-0.68).translate(0.74, -0.68, 0.65),
    new THREE.CylinderGeometry(0.035, 0.05, 0.9, 8).rotateZ(0.68).translate(-0.74, -0.68, 0.65),
    new THREE.CylinderGeometry(0.04, 0.05, 0.75, 8).translate(0, -0.62, 2.75)
  ]);
  tilt.add(part(struts, metal));

  // Propeller, a soft disc once it spins fast
  const prop = new THREE.Group();
  prop.position.z = 4.08;
  prop.add(part(spinner.clone().translate(0, 0, -4.08), metal));
  const blade = new THREE.BoxGeometry(0.13, 1.02, 0.035).translate(0, 0.58, 0);
  const blades = mergeGeometries([0, 1, 2].map((i) => blade.clone().rotateZ(i * Math.PI * 2 / 3)));
  prop.add(part(blades, dark));
  tilt.add(prop);
  const blur = new THREE.Mesh(new THREE.CircleGeometry(1.1, 28),
    new THREE.MeshBasicNodeMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
  blur.position.z = 4.1;
  tilt.add(blur);

  scene.add(root);
  return {
    type: 'plane', kind: 'plane', mode: 'plane', air: true, label: 'Hauturier · Sterne', mesh: root, tilt, prop, blur,
    position: new THREE.Vector3(), heading: 0, speed: 0, verticalSpeed: 0, pitch: 0, roll: 0, throttle: 0.6, onGround: false, crashed: false,
    halfW: 1.1, halfL: 4.3, spec: { doors: [1.6, 0.4], zFront: 4.3, zRear: -4.5 },
    cameraTargetOffset: new THREE.Vector3(0, 1.3, 0), chaseDistance: 12.5, chaseHeight: 3.5,
    drive: { speed: 88 }
  };
}

// Attitude, propeller and disc follow the physics
function posePlane(plane, dt) {
  plane.tilt.rotation.set(-plane.pitch, 0, -plane.roll);
  const rpm = plane.onGround && plane.speed < 0.2 && plane.throttle < 0.05 ? 2 : 12 + plane.throttle * 34;
  plane.prop.rotation.z += rpm * dt;
  plane.blur.visible = plane.throttle > 0.12 && !plane.crashed;
}

// A canopy over the jumper, drawn while falling
function createParachute(scene) {
  const canopy = new THREE.SphereGeometry(3.4, 16, 5, 0, Math.PI * 2, 0, Math.PI * 0.42).scale(1, 0.62, 1.15);
  const colors = new Float32Array(canopy.attributes.position.count * 3);
  const lime = new THREE.Color(0xe1f3a0), ink = new THREE.Color(0x1b2614);
  for (let i = 0; i < canopy.attributes.position.count; i++) {
    const angle = Math.atan2(canopy.attributes.position.getZ(i), canopy.attributes.position.getX(i));
    (Math.floor((angle + Math.PI) / (Math.PI * 2) * 8) % 2 ? ink : lime).toArray(colors, i * 3);
  }
  canopy.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const lines = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => {
    const from = new THREE.Vector3(x * 1.9, 0.4, z * 2.2), to = new THREE.Vector3(x * 0.16, -3.2, z * 0.1);
    const g = new THREE.CylinderGeometry(0.012, 0.012, from.distanceTo(to), 4);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), from.clone().sub(to).normalize()));
    return g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  });
  const root = new THREE.Group();
  root.name = 'Parachute';
  const shell = new THREE.Mesh(canopy, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }));
  shell.castShadow = true;
  root.add(shell, new THREE.Mesh(mergeGeometries(lines), new THREE.MeshBasicNodeMaterial({ color: 0x20241e })));
  root.position.set(20000, -100, 20000);
  scene.add(root);
  return root;
}

export { createPlane, posePlane, createParachute };
