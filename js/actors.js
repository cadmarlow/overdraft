import * as THREE from 'three/webgpu';
import { PersonRig } from './pedestrians.js';
import { CharacterModel, LOOKS } from './characters.js';
import { WEAPONS, castShot, lineOfSight, spreadDirection } from './weapons.js';

// Armed characters on foot: police officers, rival crews, mission targets and their guards. Each walks with its own
// PersonRig (planted footsteps, running, aiming arms) and decides several times a second: close in, keep a firing
// distance, shoot with distance- and motion-dependent accuracy, attempt an arrest, flee, or lie where it fell.

const MAX_ACTORS = 16;
const DRAW_DISTANCE = 170;
const ground = (controllers, x, z) => controllers.getGroundHeight(x, z, 'person');
const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

let serial = 0;

class ActorSystem {
  constructor({ scene, controllers, fx, audio }) {
    Object.assign(this, { scene, controllers, fx, audio });
    this.actors = [];
    this.pos = { x: 0, y: 0, z: 0 };
    this.dir = new THREE.Vector3();
    this.muzzle = new THREE.Vector3();
    // callbacks set by the game
    this.onShot = null; // (hit, damage, actor)
    this.onKilled = null; // (actor, cause)
    this.onArrest = null; // (dt)
  }

  get count() { return this.actors.length; }

  spawn({ x, z, heading = 0, look = 'cop', team = 'police', weapon = 'pistol', hp = 100, behavior = 'combat', hostile = true,
    accuracy = 0.5, alert = true, name = '', tag = '', female = false, armor = 0 }) {
    if (this.actors.length >= MAX_ACTORS) {
      // recycle the farthest corpse, else refuse
      const corpse = this.actors.filter((a) => a.dead).sort((a, b) => b.deadAt - a.deadAt).pop();
      if (!corpse) return null;
      this.remove(corpse);
    }
    const seed = 40 + (serial++) * 3.17;
    const rig = new PersonRig({ seed, female, scale: (female ? 0.93 : 0.99) + Math.random() * 0.07, girth: 0.95 + Math.random() * 0.15,
      hair: female ? 0.7 : Math.random() * 0.25, armSwing: 0.9 });
    const model = new CharacterModel(this.scene, rig, LOOKS[look] || LOOKS.cop, `Actor_${look}`);
    const y = ground(this.controllers, x, z);
    const actor = {
      id: serial, x, y, z, heading, rig, model, look, team, weapon, hp, maxHp: hp, armor, behavior, hostile, accuracy, alert,
      name, tag, dead: false, deadAt: 0, deadHeading: 0, kvx: 0, kvz: 0, vx: 0, vz: 0, speed: 0,
      mag: WEAPONS[weapon]?.mag ?? 0, cooldown: 0.6 + Math.random(), reloadT: 0, flinch: 0, sightT: 0, los: false,
      lastX: x, lastZ: z, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0, punchT: 0, born: performance.now()
    };
    rig.reset(x, z, heading, ground, this.controllers);
    model.setWeapon(WEAPONS[weapon]?.melee ? null : weapon);
    this.actors.push(actor);
    return actor;
  }

  remove(actor) {
    const i = this.actors.indexOf(actor);
    if (i >= 0) this.actors.splice(i, 1);
    actor.model.dispose();
  }

  clear(filter = () => true) {
    for (const a of [...this.actors]) if (filter(a)) this.remove(a);
  }

  damage(actor, amount, dirX = 0, dirZ = 0, cause = 'shot') {
    if (actor.dead) return false;
    if (actor.armor > 0) {
      const absorbed = Math.min(actor.armor, amount * 0.7);
      actor.armor -= absorbed;
      amount -= absorbed;
    }
    actor.hp -= amount;
    actor.flinch = 0.25;
    actor.alert = true;
    if (actor.behavior === 'idle' || actor.behavior === 'guard') actor.behavior = actor.hostile ? 'combat' : 'flee';
    if (actor.hp <= 0) {
      actor.dead = true;
      actor.deadAt = this.clock || 0;
      actor.deadHeading = Math.atan2(dirX, dirZ) || actor.heading;
      const push = cause === 'vehicle' ? Math.min(9, Math.hypot(dirX, dirZ)) : cause === 'explosion' ? 6 : 0.6;
      const l = Math.hypot(dirX, dirZ) || 1;
      actor.kvx = dirX / l * push; actor.kvz = dirZ / l * push;
      actor.rig.aim = null;
      actor.rig.punch = 0;
      actor.model.setWeapon(null);
      this.onKilled?.(actor, cause);
    }
    return true;
  }

  // Alert every member of a team (gunfire, a body found, the player attacking one of them)
  alertTeam(team, x, z, radius = 60) {
    for (const a of this.actors) {
      if (a.team !== team || a.dead) continue;
      if (Math.hypot(a.x - x, a.z - z) > radius) continue;
      a.alert = true;
      if (a.behavior === 'guard' || a.behavior === 'idle') a.behavior = a.hostile ? 'combat' : 'flee';
    }
  }

  /**
   * @param {number} dt
   * @param {object} ctx - target {x, y, z, inVehicle, speed, heading, onFoot, alive}, world (castShot world), camera
   */
  update(dt, ctx) {
    this.clock = (this.clock || 0) + dt;
    const { target, camera } = ctx;
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i];
      const camD = Math.hypot(a.x - camera.position.x, a.z - camera.position.z);
      const visible = camD < DRAW_DISTANCE;
      if (a.dead) {
        const t = this.clock - a.deadAt;
        if (a.kvx || a.kvz) {
          a.x += a.kvx * dt; a.z += a.kvz * dt;
          const damp = Math.exp(-4 * dt);
          a.kvx *= damp; a.kvz *= damp;
          this.pos.x = a.x; this.pos.y = a.y; this.pos.z = a.z;
          this.controllers.resolveHorizontalCollision(this.pos, 0.3, null, null, 'person');
          a.x = this.pos.x; a.z = this.pos.z;
        }
        if ((t > 50 && !visible) || t > 120) { this.remove(a); continue; }
        a.rig.update(dt, a.x, a.z, a.deadHeading, ground, this.controllers, 0, visible, Math.min(t * 1.3, 0.95));
        a.model.update(visible);
        continue;
      }
      this.think(a, dt, target, ctx);
      a.rig.update(dt, a.x, a.z, a.heading, ground, this.controllers, 0, visible);
      a.model.update(visible);
    }
  }

  think(a, dt, target, ctx) {
    const weapon = WEAPONS[a.weapon] || WEAPONS.fists;
    a.cooldown -= dt;
    a.flinch = Math.max(0, a.flinch - dt);
    a.strafeT -= dt;
    a.punchT = Math.max(0, a.punchT - dt);
    a.rig.punch = a.punchT > 0 ? Math.sin((1 - a.punchT / 0.35) * Math.PI) : 0;
    const dx = target.x - a.x, dz = target.z - a.z;
    const d = Math.hypot(dx, dz);
    const eyeY = a.y + 1.6;
    // Perception at ~4 Hz
    a.sightT -= dt;
    if (a.sightT <= 0) {
      a.sightT = 0.22 + Math.random() * 0.1;
      a.los = target.alive && d < 120 && lineOfSight(this.controllers, a.x, eyeY, a.z, target.x, target.y + 1.2, target.z);
      if (a.los) { a.lastX = target.x; a.lastZ = target.z; }
      if (!a.alert && a.hostile && a.los && d < (target.threat ? 45 : 18)) a.alert = true;
    }

    let mx = 0, mz = 0, speed = 0, face = a.heading;
    let aiming = false;
    const behavior = !target.alive && a.behavior !== 'flee' ? 'idle' : a.behavior;

    if (behavior === 'flee') {
      const away = Math.atan2(a.x - target.x, a.z - target.z);
      face = away + Math.sin(this.clock * 0.7 + a.id) * 0.5;
      speed = d < 80 ? 4.6 : 1.4;
      mx = Math.sin(face); mz = Math.cos(face);
    } else if (behavior === 'arrest' && a.alert) {
      // Drawing a weapon on an officer turns an arrest into a firefight
      if (target.threat && a.los && d < 30) a.behavior = 'combat';
      face = Math.atan2(dx, dz);
      if (d > 1.4) { speed = d > 4 ? 4.4 : 1.6; mx = dx / d; mz = dz / d; }
      if (d < 1.9 && target.onFoot) this.onArrest?.(dt, a);
      if (a.weapon !== 'fists' && d < 12 && a.los) { aiming = true; }
    } else if (behavior === 'combat' && a.alert) {
      const min = weapon.melee ? 0.9 : a.team === 'police' ? 7 : 5;
      const max = weapon.melee ? 1.4 : a.team === 'police' ? 15 : 12;
      const gx = a.los ? target.x : a.lastX, gz = a.los ? target.z : a.lastZ;
      const gdx = gx - a.x, gdz = gz - a.z, gd = Math.hypot(gdx, gdz) || 1;
      face = Math.atan2(dx, dz);
      if (!a.los || d > max) {
        speed = gd > 3 ? 4.3 : 0;
        mx = gdx / gd; mz = gdz / gd;
        if (!a.los) face = Math.atan2(gdx, gdz);
      } else if (d < min) {
        speed = 1.6; mx = -dx / d; mz = -dz / d;
      } else {
        if (a.strafeT <= 0) { a.strafeT = 1.2 + Math.random() * 2; a.strafe = Math.random() < 0.5 ? 1 : -1; if (Math.random() < 0.3) a.strafe = 0; }
        speed = a.strafe ? 1.3 : 0;
        mx = -dz / d * a.strafe; mz = dx / d * a.strafe;
      }
      aiming = a.los && !weapon.melee && d < weapon.range;
      if (weapon.melee && a.los && d < max + 0.3 && a.cooldown <= 0 && a.flinch <= 0) {
        a.cooldown = weapon.interval + 0.4;
        a.punchT = 0.35;
        this.onShot?.({ kind: 'player', target, t: d, x: target.x, y: target.y + 1.3, z: target.z, nx: -dx / d, ny: 0, nz: -dz / d, melee: true }, 9, a);
      }
    } else if (behavior === 'guard') {
      face = a.heading;
    }

    // Shooting
    a.rig.aim = aiming ? { x: target.x, y: target.y + (target.inVehicle ? 0.9 : 1.25), z: target.z, twoHanded: weapon.hands === 2 } : null;
    if (a.reloadT > 0) {
      a.reloadT -= dt;
      if (a.reloadT <= 0) a.mag = weapon.mag;
    } else if (aiming && behavior === 'combat' && a.cooldown <= 0 && a.flinch <= 0) {
      if (a.mag <= 0) {
        a.reloadT = weapon.reload * 1.3;
        this.audio?.sfx('reload', a.x, a.y + 1.2, a.z);
      } else {
        this.fire(a, weapon, target, ctx, d);
      }
    }

    // Movement with building collision
    a.heading += angleTo(a.heading, face) * Math.min(1, dt * (speed > 3 ? 8 : 10));
    const accel = Math.min(1, dt * 7);
    a.vx += (mx * speed - a.vx) * accel;
    a.vz += (mz * speed - a.vz) * accel;
    a.speed = Math.hypot(a.vx, a.vz);
    if (a.speed > 0.01) {
      this.pos.x = a.x + a.vx * dt; this.pos.y = a.y; this.pos.z = a.z + a.vz * dt;
      this.controllers.resolveHorizontalCollision(this.pos, 0.32, null, null, 'person');
      a.x = this.pos.x; a.z = this.pos.z;
    }
    a.y = ground(this.controllers, a.x, a.z);
  }

  fire(a, weapon, target, ctx, d) {
    const accuracy = a.accuracy;
    a.mag--;
    a.cooldown = weapon.interval * (weapon.auto ? 1 : 1.6) + (1 - accuracy) * 0.6 + Math.random() * 0.35;
    if (weapon.auto && Math.random() < 0.25) a.cooldown += 0.6; // bursts
    a.model.muzzle(this.muzzle);
    const ty = target.y + (target.inVehicle ? 0.8 : 1.2);
    let dx = target.x - this.muzzle.x, dy = ty - this.muzzle.y, dz = target.z - this.muzzle.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const spread = 0.012 + (1 - accuracy) * 0.05 + Math.min(0.06, target.speed * 0.004) + d * 0.0006;
    const pellets = weapon.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      spreadDirection(dx, dy, dz, spread + (pellets > 1 ? weapon.spread : 0), this.dir);
      const hit = castShot(ctx.world, this.muzzle.x, this.muzzle.y, this.muzzle.z, this.dir.x, this.dir.y, this.dir.z, weapon.range, a);
      if (i === 0 || Math.random() < 0.3) this.fx.tracer(this.muzzle, hit);
      this.onShot?.(hit, weapon.damage * (a.team === 'police' ? 0.42 : 0.38), a);
    }
    this.fx.muzzleFlash(this.muzzle, this.dir, weapon.id === 'shotgun');
    this.audio?.sfx(weapon.sound, this.muzzle.x, this.muzzle.y, this.muzzle.z);
  }
}

export { ActorSystem };
