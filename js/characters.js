import * as THREE from 'three/webgpu';
import { loadPerson } from './people-assets.js';
import { createPersonMaterials } from './people-material.js';
import { loadMocap } from './mocap.js';
import { Skeleton } from './person-body.js';
import { BodyDriver, HOLD, SLOTS } from './person-motion.js';
import { loadWeaponModels, createWeaponModel, animateWeapon } from './weapon-models.js';

// Individually drawn people (the protagonist, police officers, crews, mission targets): real avatars wearing captured
// motion, moved around by a PersonRig. Bodies and materials are shared between characters of the same look, so a new
// officer on the street costs no shader work. What they carry is drawn on them: in the hands, or stowed on the body.

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

// How far the clothes stand off the bones where weapons are stowed (bind space, the avatar's own units): the outside of
// the right thigh below the hip, and the back between the shoulder blades. A holster floating off a thin leg or sunk
// into a thick jacket is the first thing the camera behind the hero shows.
function bodySurface(person, skeleton) {
  const position = person.geometry.attributes.position, index = person.geometry.attributes.skinIndex, weight = person.geometry.attributes.skinWeight;
  const { bone, bindP } = skeleton;
  const hipX = bindP[bone.thigh[1] * 3], hipY = bindP[bone.thigh[1] * 3 + 1];
  const chestY = bindP[bone.spine2 * 3 + 1], chestZ = bindP[bone.spine2 * 3 + 2];
  const torso = new Set([bone.spine, bone.spine1, bone.spine2, bone.neck, bone.clavicle[0], bone.clavicle[1]]);
  let thigh = 0, back = 0;
  for (let i = 0; i < position.count; i++) {
    let lead = 0;
    for (let j = 1; j < 4; j++) if (weight.getComponent(i, j) > weight.getComponent(i, lead)) lead = j;
    const b = index.getComponent(i, lead);
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (b === bone.thigh[1] && y < hipY - 0.03 && y > hipY - 0.17 && Math.abs(z - bindP[bone.thigh[1] * 3 + 2]) < 0.05) thigh = Math.max(thigh, hipX - x);
    if (torso.has(b) && Math.abs(x) < 0.12 && y < chestY + 0.06 && y > chestY - 0.22) back = Math.max(back, chestZ - z);
  }
  return { thigh: thigh || 0.1, back: back || 0.13 };
}

// Called once at start-up, behind the loading screen
async function loadCharacters() {
  await loadMocap();
  const ids = new Set(Object.values(LOOKS).map((l) => l.person));
  await Promise.all([...ids].map(async (id) => {
    const person = await loadPerson(id);
    const skeleton = new Skeleton(person);
    skeleton.surface = bodySurface(person, skeleton);
    people.set(id, { person, skeleton, materials: createPersonMaterials(person) });
  }));
  await loadWeaponModels();
}

const _up = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _identity = new THREE.Matrix4();
// Stands in for a part of an avatar that must not be drawn for one character (never compiled: nothing draws with it)
const HIDDEN = new THREE.MeshBasicNodeMaterial({ visible: false });

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
    // Officers wear a pistol in a holster as part of their uniform: it leaves the holster when they draw
    this.sidearm = person.parts.findIndex((part) => part.name === 'pistol');
    this.materials = this.sidearm >= 0 ? materials.slice() : materials;
    this.sidearmMaterial = this.sidearm >= 0 ? materials[this.sidearm] : null;
    this.mesh = new THREE.SkinnedMesh(person.geometry, this.materials);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.bones = person.bones.map(() => new THREE.Bone());
    this.skeleton = new THREE.Skeleton(this.bones, skeleton.inverse);
    this.mesh.bind(this.skeleton, _identity);
    this.mesh.updateMatrixWorld(true);
    scene.add(this.mesh);
    this.weaponKind = null; // what the hands are asked to hold
    this.guns = new Map(); // kind → its object, for everything this body has on it
    this.carried = []; // kinds stowed on the body when not in hand, each in its slot
    this.holster = null;
    this.showCarried = true; // false where stowed weapons cannot be worn (a car seat)
    this.visible = true;
  }

  gun(kind) {
    let gun = this.guns.get(kind);
    if (!gun) {
      gun = createWeaponModel(kind);
      if (!gun) return null;
      gun.visible = false;
      this.scene.add(gun);
      this.guns.set(kind, gun);
    }
    return gun;
  }

  // What this body wears stowed when the hands are empty: a pistol on the thigh, long guns across the back
  setLoadout(kinds) {
    this.carried = kinds.filter((k) => HOLD[k]);
    for (const kind of this.carried) this.gun(kind);
    const holstered = this.carried.includes('pistol');
    if (holstered && !this.holster) { this.holster = createWeaponModel('holster'); this.scene.add(this.holster); }
    if (this.holster) this.holster.visible = holstered && this.visible;
  }

  // Everything a body can show, drawn once out of sight: the shaders compile behind the loading screen (actors.js)
  warm(kinds) {
    this.setLoadout(kinds);
    for (const object of [...kinds.map((kind) => this.gun(kind)), this.holster]) {
      if (!object) continue;
      object.visible = true;
      object.matrix.makeTranslation(this.rig.x, this.rig.groundY, this.rig.z);
      object.updateMatrixWorld(true);
    }
  }

  /**
   * What the hands should hold; the body draws it, putting away what it held first.
   * @param {?string} kind
   * @param {boolean} instant - already in hand, no gesture (a spawn, a cutscene)
   */
  setWeapon(kind, instant = false) {
    if (kind && !HOLD[kind]) kind = null;
    if (kind) this.gun(kind);
    if (instant) this.driver.snapWeapon(kind);
    this.weaponKind = kind;
    this.rig.holding = !!kind;
  }

  // The object in the hands right now (drawn, or on its way)
  get weapon() { return this.driver.gunKind && this.driver.gunOut ? this.guns.get(this.driver.gunKind) ?? null : null; }

  // In the hands and steady: it can fire
  get armed() { return this.driver.armed && this.driver.gunKind === this.weaponKind; }

  // Muzzle position of the held weapon (world), for flashes and tracers
  muzzle(out) {
    const hold = HOLD[this.driver.gunKind];
    if (!hold || !this.driver.hasGun) return out.copy(this.rig.hand).add(_up.set(0, 0.05, 0));
    return this.driver.muzzle(hold, out);
  }

  // Where the brass leaves the held weapon (world), with the weapon's own right and up for the throw
  ejection(port, right, up) {
    const hold = HOLD[this.driver.gunKind];
    if (!hold?.port) return null;
    this.driver.gunPoint(hold.port, port);
    right.set(-1, 0, 0).applyQuaternion(this.driver.gunQ);
    up.set(0, 1, 0).applyQuaternion(this.driver.gunQ);
    return port;
  }

  // The way the barrel points (world, unit)
  barrel(out) { return out.set(0, 0, 1).applyQuaternion(this.driver.gunQ); }

  // The gun kicks back in the hands
  fired(amount = 1) { this.driver.kick(amount); }

  // A first shot must leave this frame's raised barrel, including a turn made on the same input frame.
  // This samples the existing capture at dt=0, so neither locomotion nor reload advances twice.
  prepareShot(target, heading = this.rig.yaw) {
    const rig = this.rig, driver = this.driver;
    rig.yaw = heading;
    rig.aim = { ...rig.aim, x: target.x, y: target.y, z: target.z };
    driver.yaw = driver.lastYaw = heading;
    driver.aimW = driver.ready = 1;
    driver.lag = 0;
    driver.twist = HOLD[driver.gunKind]?.stance === 'rifle' ? -0.62 : 0;
    driver.pitch = Math.atan2(target.y - rig.groundY - 1.5, Math.hypot(target.x - rig.x, target.z - rig.z));
    this.update(this.visible, 0, 0);
  }

  update(visible = true, distance = 0, dt = 1 / 60) {
    this.visible = visible;
    this.mesh.visible = visible && !this.cameraOccluded;
    const shown = visible && !this.cameraOccluded;
    if (!visible) {
      for (const gun of this.guns.values()) gun.visible = false;
      if (this.holster) this.holster.visible = false;
      return;
    }
    const driver = this.driver;
    driver.update(dt, this.rig, this.weaponKind);
    driver.body.write(this.bones);
    this.skeleton.update();
    if (this.sidearm >= 0) this.materials[this.sidearm] = driver.gunKind === 'pistol' && driver.swap > 0.3 ? HIDDEN : this.sidearmMaterial;
    for (const [kind, gun] of this.guns) {
      if (kind === driver.gunKind && driver.hasGun && (driver.swap >= 1 || this.carried.includes(kind) || driver.gunOut && driver.swap > 0.3)) {
        // in the hands, or between the body and the hands
        gun.visible = shown && driver.gunOut;
        if (!gun.visible) continue;
        animateWeapon(gun, kind, driver.shotAge, this.rig.reloading);
        gun.matrix.compose(driver.gunP, driver.gunQ, _one);
      } else if (this.carried.includes(kind) && !SLOTS[HOLD[kind].slot].hidden) {
        gun.visible = shown && (this.showCarried || HOLD[kind].slot === 'thigh');
        if (!gun.visible) continue;
        driver.slotPose(kind, _p, _q);
        gun.matrix.compose(_p, _q, _one);
      } else { gun.visible = false; continue; }
      gun.updateMatrixWorld(true);
    }
    if (this.holster) {
      this.holster.visible = shown && this.carried.includes('pistol');
      if (this.holster.visible) {
        driver.slotPose('pistol', _p, _q);
        this.holster.matrix.compose(_p, _q, _one);
        this.holster.updateMatrixWorld(true);
      }
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    for (const gun of this.guns.values()) gun.removeFromParent();
    this.holster?.removeFromParent();
    this.skeleton.dispose?.();
  }
}

export { CharacterModel, LOOKS, SKIN_TONES, loadCharacters };
