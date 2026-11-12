import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Builder, at } from './calibre-build.js';
import { FOOD } from './eatery-food.js';
import { PRINTS } from './eatery-prints.js';

// Everything in a restaurant that changes hands or place: trays, burgers, slices, cups, bags, the crew's tools, their
// caps and aprons. One instanced mesh per kind of thing, filled again every frame by whoever holds or shows one
// (eatery-cast.js, eatery.js), and sent to the GPU once, just before the picture is drawn.
//
// A name ending in `@street` is the same thing lit by the sky (a slice eaten on the sidewalk, a bag carried away).

const BLACK = 0x141210, GOLD = 0xd9a93c, CREAM = 0xf1e8d4, TOMATO = 0xc92f1e, STEEL = 0xb4b8bb, WOOD = 0xb59468;
// What may be seen outside a room
const STREET = ['bag', 'box', 'cup', 'can', 'burger', 'burgerHalf', 'burgerWrapped', 'fries', 'plate', 'sliceMargherita', 'slicePepperoni', 'sliceBianca',
  'sliceMargheritaHand', 'slicePepperoniHand', 'sliceBiancaHand', 'sliceBitten'];
const CAPACITY = { tray: 18, cup: 28, burger: 20, fries: 20, pattyRaw: 10, pattyDone: 14 };

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// A thing drawn with boxes and rods in the builder's 'paint' (vertex colours): its merged geometry
function drawn(build) {
  const B = new Builder({ paint: null });
  build(B);
  const parts = B.batches.get('paint') || [];
  return parts.length ? mergeGeometries(parts) : null;
}

// ---- The crew's uniform, in the body's bind space (a 1.75 m person at the origin, facing +z): it rides a bone ----------
function capGeometry(crown, peak, button) {
  return drawn((B) => {
    // the crown sits on the brow line (the eyes are at 1.65 m on a 1.75 m body), a finger above the ears
    B.push('paint', new THREE.SphereGeometry(1, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), at(0, 1.722, 0.004, 0, -0.08, 0, 0.098, 0.082, 0.116), { color: crown });
    B.push('paint', new THREE.CylinderGeometry(0.098, 0.098, 0.026, 18, 1, true), at(0, 1.712, 0.004, 0, -0.08, 0, 1, 1, 1.18), { color: crown });
    // the peak: half a disc, tipped down a little
    B.push('paint', new THREE.CylinderGeometry(0.086, 0.086, 0.008, 16, 1, false, -Math.PI / 2, Math.PI), at(0, 1.712, 0.104, 0, 0.16, 0, 1, 1, 0.92), { color: peak });
    B.push('paint', new THREE.SphereGeometry(0.012, 8, 6), at(0, 1.806, 0.002), { color: button });
  });
}
function apronGeometry(cloth, strap) {
  return drawn((B) => {
    // the bib, bowed round the chest
    const bib = new THREE.CylinderGeometry(0.16, 0.19, 0.36, 9, 3, true, -0.72, 1.44);
    B.push('paint', bib, at(0, 1.2, -0.03), { color: cloth });
    // the straps to the neck, the tie round the waist
    for (const s of [-1, 1]) B.box('paint', s * 0.085, 1.435, 0.085, 0.022, 0.14, 0.008, { rz: s * 0.35, rx: -0.55, color: strap });
    B.push('paint', new THREE.CylinderGeometry(0.168, 0.168, 0.03, 14, 1, true), at(0, 1.04, -0.012, 0, 0, 0, 1, 1, 0.78), { color: strap });
  });
}
function skirtGeometry(cloth) {
  // from the waist to the middle of the thighs, hanging from the hips
  return drawn((B) => B.push('paint', new THREE.CylinderGeometry(0.192, 0.215, 0.34, 9, 2, true, -0.8, 1.6), at(0, 0.86, -0.045), { color: cloth }));
}

// ---- Tools: origin where the hand holds them -----------------------------------------------------------------------------
const TOOLS = {
  // a griddle turner: handle up the forearm (-z), blade ahead (+z)
  spatula: (B) => { B.rod('paint', 0, 0, -0.05, 0.012, 0.16, 'z', { color: BLACK, segments: 8 }); B.rod('paint', 0, 0, 0.11, 0.004, 0.18, 'z', { color: STEEL, segments: 6 }); B.box('paint', 0, -0.012, 0.25, 0.085, 0.003, 0.12, { rx: 0.12, color: STEEL }); },
  // a mop: the hand high on the handle, the head on the floor 1.2 m below and ahead
  mop: (B) => { B.push('paint', new THREE.CylinderGeometry(0.013, 0.013, 1.45, 8), at(0, -0.54, 0.31, 0, -0.52), { color: WOOD }); B.box('paint', 0, -1.15, 0.66, 0.34, 0.05, 0.2, { color: 0xd8d4c8 }); B.box('paint', 0, -1.12, 0.64, 0.1, 0.05, 0.08, { color: 0x3a6ea5 }); },
  cloth: (B) => { B.box('paint', 0, 0, 0.02, 0.16, 0.014, 0.13, { color: 0xe6e2d6 }); B.box('paint', 0.01, 0.012, 0.03, 0.13, 0.012, 0.1, { ry: 0.3, color: 0x3a6ea5 }); },
  ladle: (B) => { B.rod('paint', 0, 0, 0.12, 0.005, 0.3, 'z', { color: STEEL, segments: 6 }); B.push('paint', new THREE.SphereGeometry(0.04, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), at(0, 0, 0.29), { color: STEEL }); },
  scoop: (B) => { B.rod('paint', 0, 0, -0.03, 0.013, 0.12, 'z', { color: BLACK, segments: 8 }); B.box('paint', 0, -0.01, 0.1, 0.1, 0.045, 0.14, { color: STEEL }); },
  card: (B) => B.box('paint', 0, 0, 0.03, 0.054, 0.002, 0.086, { color: 0x1d5e8a }),
  cash: (B) => { B.box('paint', 0, 0, 0.03, 0.07, 0.006, 0.15, { color: 0x86a57c }); B.box('paint', 0.004, 0.006, 0.03, 0.07, 0.004, 0.15, { ry: 0.12, color: 0x9ab58f }); },
  // the till's takings in a bank bag
  cashBag: (B) => { B.push('paint', new THREE.SphereGeometry(0.13, 12, 8), at(0, 0.11, 0, 0, 0, 0, 1, 0.85, 0.8), { color: 0xb9a57a }); B.push('paint', new THREE.CylinderGeometry(0.035, 0.06, 0.09, 10), at(0, 0.25, 0), { color: 0xb9a57a }); B.push('paint', new THREE.TorusGeometry(0.045, 0.008, 6, 12), at(0, 0.215, 0, 0, Math.PI / 2), { color: 0x6b5a3a }); },
  // the yellow sign that stands where the floor is wet
  wetSign: (B) => { for (const s of [-1, 1]) B.box('paint', 0, 0.3, s * 0.1, 0.28, 0.62, 0.012, { rx: -s * 0.3, color: 0xe2c21c }); },
  // a cup's worth of spilled drink and wrappers on the floor
  spill: (B) => { B.push('paint', new THREE.CylinderGeometry(0.32, 0.32, 0.004, 18), at(0, 0.002, 0, 0, 0, 0, 1, 1, 0.7), { color: 0x5a3a22 }); B.box('paint', 0.12, 0.012, -0.1, 0.16, 0.02, 0.12, { ry: 0.6, color: GOLD }); B.box('paint', -0.16, 0.01, 0.08, 0.1, 0.016, 0.1, { ry: -0.4, color: CREAM }); }
};

class EateryProps {
  /**
   * @param {THREE.Scene} scene
   * @param {object} materials - eatery-room.js's (by brand): the food lit by the rooms' lamps, the brands' prints
   */
  constructor(scene, materials) {
    this.group = new THREE.Group(); this.group.name = 'EateryProps'; scene.add(this.group);
    this.items = new Map();
    const paint = materials.bullion.paint, food = materials.bullion.food;
    if (FOOD.material) {
      for (const [name, geometry] of Object.entries(FOOD.geometry)) {
        this.add(name, geometry, food, CAPACITY[name] ?? 12);
        if (STREET.includes(name)) this.add(`${name}@street`, geometry, FOOD.material, 8);
      }
    }
    for (const [name, build] of Object.entries(TOOLS)) this.add(name, drawn(build), paint, name === 'spill' ? 6 : 4);
    this.add('cap-bullion', capGeometry(BLACK, 0x0c0b0a, GOLD), paint, 8);
    this.add('cap-tranche', capGeometry(TOMATO, 0xa3271a, CREAM), paint, 6);
    this.add('apron-bullion', apronGeometry(0x191614, GOLD), paint, 8);
    this.add('apron-tranche', apronGeometry(0xece8dd, TOMATO), paint, 6);
    this.add('skirt-bullion', skirtGeometry(0x191614), paint, 8);
    this.add('skirt-tranche', skirtGeometry(0xece8dd), paint, 6);
    // the brand's mark on the bib: a print of the sheet, bowed like the cloth
    for (const brand of ['bullion', 'tranche']) {
      const rect = PRINTS[brand]?.apron;
      if (!rect) continue;
      const g = new THREE.CylinderGeometry(0.168, 0.176, 0.2, 6, 1, true, -0.42, 0.84), uv = g.attributes.uv, [u0, v0, u1, v1] = rect;
      // the middle of the print, so that the mark is not stretched round the chest
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (0.2 + uv.getX(i) * 0.6) * (u1 - u0), 1 - (v0 + (0.08 + (1 - uv.getY(i)) * 0.6) * (v1 - v0)));
      g.applyMatrix4(at(0, 1.26, -0.03));
      this.add(`mark-${brand}`, g, materials[brand].print, brand === 'bullion' ? 8 : 6);
    }
  }

  add(name, geometry, material, max = 12) {
    if (!geometry || !material) return;
    const mesh = new THREE.InstancedMesh(geometry, material, max);
    mesh.name = `EateryProp ${name}`;
    mesh.frustumCulled = false;
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    // one hidden instance until the first frame: the pipelines compile behind the loading screen
    mesh.setMatrixAt(0, ZERO); mesh.count = 1;
    this.group.add(mesh);
    this.items.set(name, { mesh, count: 0, max, drawn: 1 });
  }

  has(name) { return this.items.has(name); }

  put(name, matrix) {
    const item = this.items.get(name);
    if (!item || item.count >= item.max) return false;
    item.mesh.setMatrixAt(item.count++, matrix);
    return true;
  }

  // Standing on (x, y, z), turned `yaw` about the vertical, then tipped (pitch: nose down is positive) and rolled
  place(name, x, y, z, yaw = 0, pitch = 0, roll = 0, scale = 1) {
    return this.put(name, _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ')), _s.setScalar(scale)));
  }

  // A piece of uniform on a bone of a crowd body (pedestrians.js: PERSON_BONES)
  wear(name, rig, bone) {
    const a = rig.pose, o = bone * 8;
    return this.put(name, _m.compose(_p.set(a[o + 4], a[o + 5], a[o + 6]), _q.set(a[o], a[o + 1], a[o + 2], a[o + 3]), _s.setScalar(a[o + 7] || rig.s)));
  }

  // Everything placed since the last picture goes to the GPU; the lists start again
  flush() {
    for (const item of this.items.values()) {
      const n = item.count;
      if (n === 0 && item.drawn === 0) continue;
      if (n === 0) item.mesh.setMatrixAt(0, ZERO);
      item.mesh.count = Math.max(1, n);
      item.mesh.instanceMatrix.needsUpdate = true;
      item.drawn = n;
      item.count = 0;
    }
  }
}

export { EateryProps, STREET };
