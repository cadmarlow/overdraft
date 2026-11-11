import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sealEffect } from './effect-outputs.js';

// PLACEHOLDER shapes while the real models are imported: enough to see attitude, gear and propeller in the game.

const part = (geometry, material) => { const m = new THREE.Mesh(geometry, material); m.castShadow = true; return m; };

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

function buildAircraftModel(kind) {
  const root = new THREE.Group();
  const jet = kind === 'jet';
  const paint = new THREE.MeshStandardNodeMaterial({ color: jet ? 0x8d949c : 0xe9c23a, roughness: 0.35, metalness: jet ? 0.6 : 0.15 });
  const accent = new THREE.MeshStandardNodeMaterial({ color: jet ? 0x3c4148 : 0x1f3a8a, roughness: 0.32, metalness: 0.2 });
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x17191c, roughness: 0.65 });
  const L = jet ? 15 : 7.4, R = jet ? 0.85 : 0.62;
  const profile = [[0.02, -L * 0.5], [R * 0.45, -L * 0.36], [R * 0.9, -L * 0.1], [R, L * 0.15], [R * 0.85, L * 0.36], [jet ? 0.05 : R * 0.8, L * 0.5]]
    .map(([r, z]) => new THREE.Vector2(r, z));
  root.add(part(new THREE.LatheGeometry(profile, 20).rotateX(Math.PI / 2), paint));
  const wings = (span, chord, y, z, sweep) => {
    for (const side of [1, -1]) {
      const w = part(wingGeometry(span, chord, chord * (jet ? 0.3 : 0.9), jet ? 0.16 : 0.14, sweep), paint);
      w.position.set(side * 0.3, y, z); w.scale.x = side; root.add(w);
    }
  };
  if (jet) wings(4.5, 5.2, -0.1, -1.4, 2.6);
  else { wings(4.6, 1.5, 1.05, 0.35, 0.1); wings(4.3, 1.4, -0.55, 0.75, 0.1); }
  for (const side of [1, -1]) {
    const s = part(wingGeometry(jet ? 2.6 : 1.7, jet ? 2.4 : 1, jet ? 0.9 : 0.6, 0.09, jet ? 1.2 : 0.1), accent);
    s.position.set(side * 0.1, 0.1, -L * 0.44); s.scale.x = side; root.add(s);
  }
  const fin = part(new THREE.BoxGeometry(0.08, jet ? 2.6 : 1.3, jet ? 2.6 : 1.1).translate(0, jet ? 1.6 : 0.8, -L * 0.42), accent);
  root.add(fin);
  // wheels at the physics' gear points
  const gear = new THREE.Group();
  const points = jet ? [[1.2, -1.95, -0.85], [-1.2, -1.95, -0.85], [0, -1.95, 3.6]] : [[1.08, -1.52, 0.95], [-1.08, -1.52, 0.95], [0, -0.62, -4.35]];
  for (const [x, y, z] of points) {
    const r = Math.abs(z) > 3 && !jet ? 0.12 : 0.3;
    gear.add(part(new THREE.CylinderGeometry(r, r, 0.14, 16).rotateZ(Math.PI / 2).translate(x, y + r, z), dark));
    gear.add(part(new THREE.CylinderGeometry(0.04, 0.05, -y - 0.4, 6).translate(x * 0.8, y / 2 + 0.2, z), dark));
  }
  root.add(gear);
  let prop = null, blur = null;
  if (!jet) {
    prop = new THREE.Group();
    prop.position.z = L * 0.5 + 0.05;
    const blade = new THREE.BoxGeometry(0.16, 1.15, 0.04).translate(0, 0.6, 0);
    prop.add(part(mergeGeometries([0, 1].map((i) => blade.clone().rotateZ(i * Math.PI))), dark));
    root.add(prop);
    blur = new THREE.Mesh(new THREE.CircleGeometry(1.2, 28),
      sealEffect(new THREE.MeshBasicNodeMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })));
    blur.position.z = L * 0.5 + 0.08;
    root.add(blur);
  }
  let spin = 0;
  return {
    root,
    pose(a, dt) {
      const b = a.flight;
      gear.visible = b.gear > 0.05;
      gear.scale.y = Math.max(0.05, b.gear);
      if (prop) {
        spin += (6 + b.power * 60) * dt;
        prop.rotation.z = spin;
        blur.visible = b.power > 0.1 && !a.crashed;
      }
    }
  };
}

export { buildAircraftModel };
