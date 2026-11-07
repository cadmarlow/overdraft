import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadPerson } from './people-assets.js';
import { createPersonMaterials } from './people-material.js';
import { loadMocap } from './mocap.js';
import { Skeleton } from './person-body.js';
import { BodyDriver, HOLD } from './person-motion.js';
import { prepareWeaponModels, createWeaponModel, animateWeapon } from './weapon-models.js';

// Individually drawn people (the protagonist, police officers, crews, mission targets): real avatars wearing captured
// motion, moved around by a PersonRig. Bodies and materials are shared between characters of the same look, so a new
// officer on the street costs no shader work.

const SKIN_TONES = [0xe2b996, 0xc99572, 0xb47b58, 0x8d5a3b, 0x6b4129, 0x4e2f1e];

// Who looks how: an avatar of assets/people
const LOOKS = {
  hero: { person: 'hero' },
  cop: { person: 'cop' },
  copB: { person: 'cop-b' },
  detective: { person: 'detective' },
  swat: { person: 'swat' },
  crew: { person: 'crew' },
  suit: { person: 'suit' },
  guard: { person: 'guard' }
};

const people = new Map();

// Called once at start-up, behind the loading screen
async function loadCharacters() {
  await loadMocap();
  const ids = new Set(Object.values(LOOKS).map((l) => l.person));
  await Promise.all([...ids].map(async (id) => {
    const person = await loadPerson(id);
    people.set(id, { person, skeleton: new Skeleton(person), materials: createPersonMaterials(person) });
  }));
  prepareWeaponModels();
}

const GUNS = ['pistol', 'smg', 'shotgun', 'rifle'];
const GRENADE_MAT = new THREE.MeshStandardNodeMaterial({ color: 0x2c3126, roughness: 0.6, metalness: 0.2 });
const GRENADE = () => mergeGeometries([new THREE.SphereGeometry(0.045, 10, 8).scale(1, 1.25, 1), new THREE.BoxGeometry(0.02, 0.04, 0.02).translate(0, 0.065, 0)]);
let _grenade = null;
function weaponMesh(kind) {
  if (kind === 'grenade') return new THREE.Mesh((_grenade ??= GRENADE()), GRENADE_MAT);
  return createWeaponModel(kind);
}

const _up = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _identity = new THREE.Matrix4();

class CharacterModel {
  /**
   * @param {THREE.Scene} scene
   * @param {PersonRig} rig - moved by its owner every frame
   * @param {object} look - a LOOKS entry
   */
  constructor(scene, rig, look = LOOKS.hero, name = 'Character') {
    this.rig = rig;
    this.scene = scene;
    this.look = look;
    const { person, skeleton, materials } = people.get(look.person);
    this.driver = new BodyDriver(skeleton, false, rig.seed);
    this.mesh = new THREE.SkinnedMesh(person.geometry, materials);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.bones = person.bones.map(() => new THREE.Bone());
    this.skeleton = new THREE.Skeleton(this.bones, skeleton.inverse);
    this.mesh.bind(this.skeleton, _identity);
    this.mesh.updateMatrixWorld(true);
    scene.add(this.mesh);
    this.weapon = null;
    this.weaponKind = null;
    this.weaponCache = new Map();
    this.shotAge = 10;
    this.visible = true;
  }

  setWeapon(kind) {
    if (kind === this.weaponKind) return;
    this.weaponKind = kind;
    this.rig.holding = !!kind;
    if (this.weapon) { this.weapon.removeFromParent(); this.weapon = null; }
    if (!kind || !(kind === 'grenade' || GUNS.includes(kind))) return;
    if (!this.weaponCache.has(kind)) this.weaponCache.set(kind, weaponMesh(kind));
    this.weapon = this.weaponCache.get(kind);
    this.shotAge = 10;
    this.weapon.castShadow = true;
    this.weapon.matrixAutoUpdate = false;
    this.scene.add(this.weapon);
  }

  // Muzzle position of the held weapon (world), for flashes and tracers
  muzzle(out) {
    const hold = HOLD[this.weaponKind];
    if (!hold || !this.driver.hasGun) return out.copy(this.rig.hand).add(_up.set(0, 0.05, 0));
    return this.driver.muzzle(hold, out);
  }

  // The gun kicks back in the hands
  fired() {
    this.shotAge = 0;
    this.driver.kick(this.weaponKind === 'shotgun' ? 1.45 : this.weaponKind === 'pistol' ? 0.72 : this.weaponKind === 'smg' ? 0.38 : 0.5);
  }

  // A first shot must leave this frame's raised barrel, including a turn made on the same input frame.
  // This samples the existing capture at dt=0, so neither locomotion nor reload advances twice.
  prepareShot(target, heading = this.rig.yaw) {
    const rig = this.rig, driver = this.driver;
    rig.yaw = heading;
    rig.aim = { ...rig.aim, x: target.x, y: target.y, z: target.z };
    driver.yaw = driver.lastYaw = heading;
    driver.aimW = 1;
    driver.twist = HOLD[this.weaponKind]?.stance === 'rifle' ? -0.62 : 0;
    driver.pitch = Math.atan2(target.y - rig.groundY - 1.5, Math.hypot(target.x - rig.x, target.z - rig.z));
    this.update(this.visible, 0, 0);
  }

  update(visible = true, distance = 0, dt = 1 / 60) {
    this.visible = visible;
    this.mesh.visible = visible && !this.cameraOccluded;
    if (this.weapon) this.weapon.visible = visible;
    if (!visible) return;
    this.shotAge += dt;
    const kind = GUNS.includes(this.weaponKind) || this.weaponKind === 'grenade' ? this.weaponKind : null;
    this.driver.update(dt, this.rig, kind);
    this.driver.body.write(this.bones);
    this.skeleton.update();
    if (this.weapon) {
      this.weapon.visible = this.driver.hasGun && !this.cameraOccluded;
      animateWeapon(this.weapon, this.weaponKind, this.shotAge, this.rig.reloading);
      this.weapon.matrix.compose(this.driver.gunP, this.driver.gunQ, _one);
      this.weapon.updateMatrixWorld(true);
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.weapon?.removeFromParent();
    this.skeleton.dispose?.();
  }
}

export { CharacterModel, LOOKS, SKIN_TONES, loadCharacters };
