import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGun, loadPerson } from './people-assets.js';
import { createGunMaterial, createPersonMaterials } from './people-material.js';
import { loadMocap } from './mocap.js';
import { Skeleton } from './person-body.js';
import { BodyDriver, HOLD } from './person-motion.js';

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
const guns = new Map();

// Called once at start-up, behind the loading screen
async function loadCharacters() {
  await loadMocap();
  const ids = new Set(Object.values(LOOKS).map((l) => l.person));
  await Promise.all([...ids].map(async (id) => {
    const person = await loadPerson(id);
    people.set(id, { person, skeleton: new Skeleton(person), materials: createPersonMaterials(person) });
  }));
  await Promise.all(GUNS.map(async (g) => {
    const gun = await loadGun(g);
    guns.set(g, { geometry: gun.geometry, material: createGunMaterial(gun) });
  }));
}

const GUNS = ['pistol', 'smg', 'shotgun', 'rifle'];
const GRENADE_MAT = new THREE.MeshStandardNodeMaterial({ color: 0x2c3126, roughness: 0.6, metalness: 0.2 });
const GRENADE = () => mergeGeometries([new THREE.SphereGeometry(0.045, 10, 8).scale(1, 1.25, 1), new THREE.BoxGeometry(0.02, 0.04, 0.02).translate(0, 0.065, 0)]);
let _grenade = null;
function weaponMesh(kind) {
  if (kind === 'grenade') return new THREE.Mesh((_grenade ??= GRENADE()), GRENADE_MAT);
  const { geometry, material } = guns.get(kind);
  return new THREE.Mesh(geometry, material);
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
    this.visible = true;
  }

  setWeapon(kind) {
    if (kind === this.weaponKind) return;
    this.weaponKind = kind;
    this.rig.holding = !!kind;
    if (this.weapon) { this.weapon.removeFromParent(); this.weapon = null; }
    if (!kind || !(kind === 'grenade' || GUNS.includes(kind))) return;
    this.weapon = weaponMesh(kind);
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
  fired() { this.driver.kick(); }

  update(visible = true, distance = 0, dt = 1 / 60) {
    this.visible = visible;
    this.mesh.visible = visible;
    if (this.weapon) this.weapon.visible = visible;
    if (!visible) return;
    const kind = GUNS.includes(this.weaponKind) || this.weaponKind === 'grenade' ? this.weaponKind : null;
    this.driver.update(dt, this.rig, kind);
    this.driver.body.write(this.bones);
    this.skeleton.update();
    if (this.weapon) {
      this.weapon.matrix.compose(this.driver.gunP, this.driver.gunQ, _one);
      this.weapon.matrixWorld.copy(this.weapon.matrix);
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.weapon?.removeFromParent();
    this.skeleton.dispose?.();
  }
}

export { CharacterModel, LOOKS, SKIN_TONES, loadCharacters };
