import * as THREE from 'three/webgpu';
import { buildPersonGeometry } from './pedestrians.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Individually dressed skinned characters (the protagonist, police officers, crews, mission targets), posed from a
// PersonRig like the crowd but drawn as their own SkinnedMesh with fixed clothing colours, headwear and a held weapon.

const PART = { BODY: 0, LEG: 1, SHOE: 2, ARM: 3, HAND: 4, HEAD: 5, HAIR: 6, LONG_HAIR: 7 };
const SKIN_TONES = [0xe2b996, 0xc99572, 0xb47b58, 0x8d5a3b, 0x6b4129, 0x4e2f1e];

// Wardrobes: jacket/top, trousers, shoes, sleeves, collar, sole, hair; optional cap colour
const LOOKS = {
  hero: { body: 0x293b36, legs: 0x26303d, shoes: 0xd4cfbf, arms: 0x293b36, shirt: 0xc7c6bb, sole: 0x8f918b, hair: 0x201b17, skin: 0xb47b58 },
  cop: { body: 0x1c2638, legs: 0x18202e, shoes: 0x0e0f11, arms: 0x1c2638, shirt: 0x2f405c, sole: 0x0e0f11, hair: 0x1d1813, cap: 0x121a28, badge: true },
  crew: { body: 0x0f5b5c, legs: 0x1d1d22, shoes: 0xe8e4da, arms: 0x0f5b5c, shirt: 0x111111, sole: 0xcfcac0, hair: 0x15110e, cap: 0x0a3e40 },
  suit: { body: 0x2a2a2e, legs: 0x26262a, shoes: 0x120f0d, arms: 0x2a2a2e, shirt: 0xe9e6dc, sole: 0x120f0d, hair: 0x6b6259 },
  guard: { body: 0x3a3a34, legs: 0x23231f, shoes: 0x0e0e0c, arms: 0x3a3a34, shirt: 0x5a5a50, sole: 0x0e0e0c, hair: 0x231c16, cap: 0x2b2b26 }
};

const WEAPON_MAT = new THREE.MeshStandardNodeMaterial({ color: 0x15171a, roughness: 0.45, metalness: 0.7 });
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
// Weapon props in the hand's frame: +Z along the barrel, +Y up, origin at the grip
const WEAPON_GEOMETRY = {
  pistol: () => mergeGeometries([box(0.035, 0.05, 0.2, 0, 0.035, 0.06), box(0.03, 0.1, 0.045, 0, -0.02, 0)]),
  smg: () => mergeGeometries([box(0.045, 0.07, 0.36, 0, 0.04, 0.1), box(0.03, 0.12, 0.045, 0, -0.03, 0), box(0.025, 0.14, 0.035, 0, -0.04, 0.14),
    box(0.02, 0.02, 0.12, 0, 0.05, 0.33)]),
  shotgun: () => mergeGeometries([box(0.05, 0.07, 0.62, 0, 0.04, 0.16), box(0.035, 0.035, 0.3, 0, 0.0, 0.32), box(0.04, 0.12, 0.2, 0, -0.03, -0.12)]),
  rifle: () => mergeGeometries([box(0.05, 0.08, 0.5, 0, 0.045, 0.12), box(0.025, 0.025, 0.32, 0, 0.06, 0.52), box(0.035, 0.16, 0.05, 0, -0.04, 0.16),
    box(0.045, 0.1, 0.24, 0, 0.0, -0.2), box(0.03, 0.05, 0.12, 0, 0.115, 0.1)]),
  grenade: () => mergeGeometries([new THREE.SphereGeometry(0.045, 10, 8).scale(1, 1.25, 1), box(0.02, 0.04, 0.02, 0, 0.065, 0)])
};
const _geoCache = new Map();
function weaponGeometry(kind) {
  if (!_geoCache.has(kind)) _geoCache.set(kind, WEAPON_GEOMETRY[kind]());
  return _geoCache.get(kind);
}

const _up = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

class CharacterModel {
  /**
   * @param {THREE.Scene} scene
   * @param {PersonRig} rig - posed by its owner every frame (update / solve)
   * @param {object} look - a LOOKS entry, optionally with `skin`
   */
  constructor(scene, rig, look = LOOKS.hero, name = 'Character') {
    this.rig = rig;
    this.scene = scene;
    const source = buildPersonGeometry(1);
    const geometry = source.clone();
    const position = geometry.attributes.position;
    const skin = source.attributes.skin;
    const extra = source.attributes.extra;
    const female = source.attributes.femaleDelta;
    const hair = source.attributes.hairDelta;
    const indices = new Uint16Array(position.count * 4);
    const weights = new Float32Array(position.count * 4);
    const colors = new Float32Array(position.count * 3);
    const hairLength = rig.pose[(rig.pose.length / 4 - 1) * 4 + 3];
    const skinColor = new THREE.Color(look.skin ?? SKIN_TONES[Math.floor(Math.abs(Math.sin(rig.seed * 91.7)) * SKIN_TONES.length)]);
    const palette = [look.body, look.legs, look.shoes, look.arms, null, null, look.hair, look.hair].map(h => h === null ? skinColor : new THREE.Color(h));
    const shirt = new THREE.Color(look.shirt);
    const sole = new THREE.Color(look.sole);
    const badge = new THREE.Color(0xd8b54a);
    for (let i = 0; i < position.count; i++) {
      const part = Math.round(skin.getW(i));
      const hairAmount = part === PART.LONG_HAIR ? Math.max(0, hairLength * 2 - 1) : Math.min(1, hairLength * 2);
      position.setXYZ(i,
        position.getX(i) + extra.getX(i) * (rig.girth - 1) + female.getX(i) * rig.female + hair.getX(i) * hairAmount,
        position.getY(i) + female.getY(i) * rig.female + hair.getY(i) * hairAmount,
        position.getZ(i) + extra.getY(i) * (rig.girth - 1) + female.getZ(i) * rig.female + hair.getZ(i) * hairAmount);
      indices[i * 4] = skin.getX(i); indices[i * 4 + 1] = skin.getY(i);
      weights[i * 4] = 1 - skin.getZ(i); weights[i * 4 + 1] = skin.getZ(i);
      let color = palette[part] || palette[0];
      const y = position.getY(i), x = position.getX(i), z = position.getZ(i);
      if (part === PART.BODY && y < 0.98) color = palette[1];
      if (part === PART.BODY && y > 1.33 && Math.abs(x) < 0.075 && z > 0) color = shirt;
      if (look.badge && part === PART.BODY && y > 1.22 && y < 1.3 && x > 0.06 && x < 0.12 && z > 0.05) color = badge;
      if (part === PART.SHOE && y < 0.055) color = sole;
      color.toArray(colors, i * 3);
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
    this.mesh = new THREE.SkinnedMesh(geometry, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.bones = Array.from({ length: 15 }, (_, i) => { const bone = new THREE.Bone(); this.mesh.add(bone); return bone; });
    this.skeleton = new THREE.Skeleton(this.bones, this.bones.map(() => new THREE.Matrix4()));
    this.mesh.bind(this.skeleton, new THREE.Matrix4());
    scene.add(this.mesh);

    const eyes = new THREE.MeshStandardNodeMaterial({ color: 0x24201a, roughness: 0.5 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), eyes);
      eye.position.set(side * 0.043, 1.645, 0.111);
      this.bones[2].add(eye);
    }
    if (look.cap) {
      const capMat = new THREE.MeshStandardNodeMaterial({ color: look.cap, roughness: 0.7 });
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.108, 0.075, 14), capMat);
      crown.position.set(0, 1.775, -0.005);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.09), capMat);
      brim.position.set(0, 1.745, 0.11);
      crown.castShadow = brim.castShadow = true;
      this.bones[2].add(crown, brim);
    }
    this.weapon = null;
    this.weaponKind = null;
    this.visible = true;
  }

  setWeapon(kind) {
    if (kind === this.weaponKind) return;
    this.weaponKind = kind;
    if (this.weapon) { this.weapon.removeFromParent(); this.weapon = null; }
    if (!kind || !WEAPON_GEOMETRY[kind]) return;
    this.weapon = new THREE.Mesh(weaponGeometry(kind), WEAPON_MAT);
    this.weapon.castShadow = true;
    this.weapon.matrixAutoUpdate = false;
    this.scene.add(this.weapon);
  }

  // Muzzle position of the held weapon (world), for flashes and tracers
  muzzle(out) {
    const r = this.rig;
    const length = { shotgun: 0.5, smg: 0.36, rifle: 0.68, grenade: 0.05 }[this.weaponKind] ?? 0.18;
    return out.copy(r.hand).addScaledVector(r.handDir, length).add(_up.set(0, 0.05, 0));
  }

  update(visible = true) {
    this.visible = visible;
    this.mesh.visible = visible;
    if (this.weapon) this.weapon.visible = visible;
    if (!visible) return;
    const pose = this.rig.pose;
    for (let i = 0; i < this.bones.length; i++) {
      const bone = this.bones[i], o = i * 8;
      bone.quaternion.set(pose[o], pose[o + 1], pose[o + 2], pose[o + 3]);
      bone.position.set(pose[o + 4], pose[o + 5], pose[o + 6]);
      bone.scale.setScalar(pose[o + 7]);
    }
    this.mesh.updateMatrixWorld(true);
    this.skeleton.update();
    if (this.weapon) {
      const r = this.rig;
      _z.copy(r.handDir).normalize();
      _x.crossVectors(_up.set(0, 1, 0), _z);
      if (_x.lengthSq() < 1e-4) _x.set(1, 0, 0);
      _x.normalize();
      _y.crossVectors(_z, _x);
      _m.makeBasis(_x, _y, _z).setPosition(r.hand.x + _z.x * 0.06, r.hand.y + _z.y * 0.06 - 0.02, r.hand.z + _z.z * 0.06);
      this.weapon.matrix.copy(_m);
      this.weapon.matrixWorld.copy(_m);
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.weapon?.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

export { CharacterModel, LOOKS, SKIN_TONES };
