import * as THREE from 'three/webgpu';
import { cameraPosition, cross, float, instanceIndex, int, length, normalize, positionLocal, smoothstep, uniformArray, uv, vec3 } from 'three/tsl';
import { AIDriver } from './ai-driver.js';
import { settleBody } from './car-physics.js';
import { sealEffect } from './effect-outputs.js';
import { cityUniforms } from './tsl-materials.js';
import { saltLandAt, saltLoopAhead, saltLoopNearest, sampleSalt } from './wasteland-plan.js';

// The Rouliers' convoys: a column of four on the Ceinture, two loaded trucks between two escorts, seen from afar by
// the dust it raises. Left alone it drives by. Hit, the escorts turn on the player and the trucks run; a truck that is
// destroyed drops its cargo, worth picking up before the escort comes back.

const COLUMN = [
  { kind: 'offroad', paint: 0x4a4034, role: 'escort', speed: 31 },
  { kind: 'pickup', paint: 0x5a3a26, role: 'cargo', speed: 26 },
  { kind: 'pickup', paint: 0x3b3f36, role: 'cargo', speed: 26 },
  { kind: 'offroad', paint: 0x2f3a3c, role: 'escort', speed: 31 }
];
export const CONVOY = { cruise: 17, gap: 18, spawn: 640, far: 1300, reach: 1500, loot: 2200, grudge: 50, first: 26, pause: 170 };
const PLUMES = 8;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Where the column stands when it comes onto the road: `count` places `gap` metres apart down a polyline that starts
 * at the head and runs back the way the column came from, each with the heading that faces the head's way.
 * @param {Array<{x, z}>} back - the road behind the head, the head's own place first
 */
export function columnPlaces(back, count, gap) {
  const places = [];
  let seg = 0, start = 0; // `start`: distance along the polyline to the beginning of segment `seg`
  for (let n = 0; n < count; n++) {
    const want = n * gap;
    while (seg + 2 < back.length && start + Math.hypot(back[seg + 1].x - back[seg].x, back[seg + 1].z - back[seg].z) < want) {
      start += Math.hypot(back[seg + 1].x - back[seg].x, back[seg + 1].z - back[seg].z);
      seg++;
    }
    const a = back[seg], b = back[seg + 1], length = Math.hypot(b.x - a.x, b.z - a.z) || 1, t = Math.min(1, (want - start) / length);
    places.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: Math.atan2(a.x - b.x, a.z - b.z) });
  }
  return places;
}

// The speed a truck holds to keep its place behind the one ahead: its speed, more if the gap has opened, less if not
export const followSpeed = (leadSpeed, gap, most) => clamp(leadSpeed + (gap - CONVOY.gap) * 0.7, 0, most);

function dress(car, spec, steel, lamp, canvas) {
  const group = new THREE.Group();
  const box = (mat, x, y, z, w, h, l, tilt = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
    m.position.set(x, y, z); m.rotation.x = tilt; m.castShadow = true;
    group.add(m);
  };
  const width = car.spec.halfW;
  box(steel, 0, 0.5, car.spec.zFront + 0.3, width * 2.3, 0.3, 0.18);
  for (const side of [-1, 1]) {
    box(steel, side * width * 0.86, 0.72, car.spec.zFront + 0.24, 0.14, 0.6, 0.2);
    box(lamp, side * 0.52, car.spec.height + 0.12, 0.15, 0.2, 0.16, 0.14);
  }
  box(steel, 0, car.spec.height + 0.02, 0.15, width * 1.7, 0.08, 0.2);
  if (spec.role === 'cargo') {
    // the load under its tarpaulin, lashed down, and what did not fit under it
    box(canvas, 0, 1.32, -1.75, width * 1.72, 0.92, 2.25);
    box(canvas, 0, 1.86, -1.55, width * 1.3, 0.3, 1.5, 0.05);
    for (const z of [-2.45, -1.75, -1.05]) box(steel, 0, 1.4, z, width * 1.78, 0.98, 0.07);
    box(steel, width * 0.55, 1.05, -2.98, 0.5, 0.6, 0.36);
    box(steel, -width * 0.5, 1.02, -2.98, 0.42, 0.52, 0.34);
  }
  car.bodyPivot.add(group);
}

export class WastelandConvoy {
  constructor(game, { steel, lamp }) {
    this.game = game;
    this.state = 'absent';
    this.wait = CONVOY.first;
    this.direction = 1;
    this.alert = 0;
    this.seen = false;
    this.loot = null;
    this.trailT = 0;
    const canvas = new THREE.MeshStandardNodeMaterial({ color: 0x6d5a3c, roughness: 0.95 });
    this.units = COLUMN.map((spec, n) => {
      const car = game.makeCar(spec.kind, spec.paint, new THREE.Vector3(0, -80 - n * 3, 0), 0, false, true, true);
      car.ai = true;
      dress(car, spec, steel, lamp, canvas);
      car.mesh.updateMatrixWorld(true);
      const unit = { car, spec, active: false, hp: 100, goalT: 0, counted: false, driver: null };
      const nav = { route: (x, z) => this.roadAhead(x, z).slice(1) };
      unit.driver = new AIDriver(game.controllers, nav, car, { maxSpeed: spec.speed, corner: 13, avoid: false, repath: 5 });
      return unit;
    });
    // the cargo on the ground: a crate with a lamp on it
    const crate = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.85, 0.9), canvas); body.position.y = 0.42; body.castShadow = true;
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.22), lamp); beacon.position.y = 0.98;
    crate.add(body, beacon);
    crate.name = 'Cargaison des Rouliers'; crate.visible = false;
    game.scene.add(crate);
    this.crate = crate;
    this.buildPlumes(game.scene);
  }

  // Dust, seen from far off: a soft card over each vehicle and four more hanging where the tail has just been
  buildPlumes(scene) {
    const none = new THREE.Vector4(0, -9000, 0, 0);
    this.plumes = Array.from({ length: PLUMES }, () => none.clone()); // x, y, z, strength (negative: how old, hanging)
    const uPlumes = uniformArray(this.plumes);
    const plume = uPlumes.element(int(instanceIndex));
    const strength = plume.w.abs(), hanging = smoothstep(0.0, -0.001, plume.w); // 1 for the cards left behind
    const centre = plume.xyz.add(vec3(0, 7, 0)), away = cameraPosition.sub(centre), d = length(away);
    const right = normalize(cross(vec3(0, 1, 0), away));
    const size = float(19).add(hanging.mul(15));
    const material = sealEffect(new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false }));
    material.positionNode = centre.add(right.mul(positionLocal.x.mul(size).mul(2.6))).add(vec3(0, 1, 0).mul(positionLocal.y.mul(size)));
    const soft = smoothstep(0.5, 0.05, length(uv().sub(0.5)));
    const day = float(1).sub(cityUniforms.uNight.mul(0.82));
    material.colorNode = vec3(0.93, 0.8, 0.62).mul(day); // dust in the sun is paler than the ground it rose from
    // close by, the real dust thrown up by the wheels takes over
    material.opacityNode = soft.mul(strength).mul(0.8).mul(smoothstep(40, 190, d));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.name = 'Poussière du convoi'; mesh.frustumCulled = false; mesh.renderOrder = 983; mesh.count = PLUMES;
    scene.add(mesh);
    mesh.updateMatrixWorld(true);
    this.plumeMesh = mesh;
  }

  // The Ceinture from where (x, z) is, the way this convoy is going
  roadAhead(x, z, reach = 900) {
    return saltLoopAhead(saltLoopNearest(x, z).index + this.direction, this.direction, reach);
  }

  appendCars(cars) {
    for (const unit of this.units) if (unit.active && !unit.car.destroyed) cars.push(unit.car);
  }

  retire(wait = CONVOY.pause) {
    for (const unit of this.units) { unit.active = false; unit.car.mesh.visible = false; }
    for (const plume of this.plumes) plume.set(0, -9000, 0, 0);
    this.state = 'absent';
    this.alert = 0;
    this.wait = wait;
  }

  // Onto the road out of the player's sight, headed for the stretch of the Ceinture nearest to them
  deploy(player, near) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const head = saltLoopAhead(near.index, -dir, CONVOY.spawn).at(-1);
    if (distance(head, player) < CONVOY.spawn * 0.7) return false;
    const places = columnPlaces(saltLoopAhead(head.index, -dir, CONVOY.gap * COLUMN.length + 200), COLUMN.length, CONVOY.gap);
    if (!places.every(p => saltLandAt(p.x, p.z))) return false;
    this.direction = dir;
    this.units.forEach((unit, n) => {
      const { car } = unit, p = places[n], y = sampleSalt(p.x, p.z);
      car.position.set(p.x, y, p.z);
      settleBody(car, p.heading);
      car.prevX = p.x; car.prevZ = p.z;
      car.hp = 100; car.destroyed = false; car.burnT = 0;
      car.mesh.position.copy(car.position);
      car.mesh.rotation.y = p.heading; car.mesh.visible = true; car.mesh.updateMatrixWorld(true);
      unit.driver.reverseT = unit.driver.stuckT = 0; unit.driver.path = null;
      Object.assign(unit, { active: true, hp: 100, goalT: 0, counted: false });
    });
    this.state = 'route';
    this.seen = false;
    this.alert = 0;
    return true;
  }

  drop(car) {
    const g = this.game, x = car.position.x + Math.cos(car.heading) * 3.2, z = car.position.z - Math.sin(car.heading) * 3.2;
    this.loot = { x, y: sampleSalt(x, z) ?? car.position.y, z, t: 150 };
    this.crate.position.set(x, this.loot.y, z);
    this.crate.rotation.y = car.heading + 0.6;
    this.crate.visible = true;
    this.crate.updateMatrixWorld(true);
    g.toast('Cargaison à terre', 'Ramassez la caisse avant le retour de l’escorte.');
    g.audio.ui('checkpoint');
  }

  tickLoot(dt, player) {
    const loot = this.loot;
    if (!loot) return;
    loot.t -= dt;
    if (player.alive && distance(player, loot) < 4.6 && Math.abs(player.y - loot.y) < 4) {
      this.game.addMoney(CONVOY.loot);
      this.game.toast('Cargaison prise', `Pièces, câbles et carburant · ${CONVOY.loot.toLocaleString('fr-FR')} $`);
      this.game.audio.ui('cash');
      loot.t = 0;
    }
    if (loot.t <= 0) { this.loot = null; this.crate.visible = false; }
  }

  plume(dt) {
    const live = this.units.filter(u => u.active && !u.car.destroyed);
    this.units.forEach((unit, n) => {
      const p = unit.car.position, moving = unit.active && !unit.car.destroyed ? clamp(Math.abs(unit.car.speed) / 11, 0, 1) : 0;
      this.plumes[n].set(p.x - Math.sin(unit.car.heading) * 9, p.y, p.z - Math.cos(unit.car.heading) * 9, moving);
    });
    // what hangs in the air behind the last of them, thinning as it ages
    this.trailT -= dt;
    const tail = live.at(-1);
    if (this.trailT <= 0 && tail) {
      this.trailT = 1.4;
      for (let n = PLUMES - 1; n > COLUMN.length; n--) this.plumes[n].copy(this.plumes[n - 1]);
      this.plumes[COLUMN.length].set(tail.car.position.x, tail.car.position.y, tail.car.position.z, -clamp(Math.abs(tail.car.speed) / 11, 0, 1));
    }
    for (let n = COLUMN.length; n < PLUMES; n++) this.plumes[n].w *= Math.exp(-dt * 0.13);
  }

  /**
   * @param {number} dt
   * @param {object} player - the game's player record (x, y, z, vx, vz, heading, speed, inVehicle, alive)
   * @param {boolean} exposed - the player is out on the Wasteland's ground
   */
  update(dt, player, exposed) {
    const g = this.game;
    this.tickLoot(dt, player);
    for (const unit of this.units) if (!unit.active) unit.car.mesh.visible = false;
    if (this.state === 'absent') {
      if (!exposed) return;
      this.wait -= dt;
      if (this.wait > 0) return;
      this.wait = 7;
      const near = saltLoopNearest(player.x, player.z);
      if (near.distance < CONVOY.reach) this.deploy(player, near);
      return;
    }
    const live = this.units.filter(u => u.active && !u.car.destroyed);
    let nearest = Infinity;
    for (const unit of this.units) if (unit.active) nearest = Math.min(nearest, distance(unit.car.position, player));
    if (!live.length || nearest > CONVOY.far || (!exposed && nearest > 520)) { this.retire(live.length ? CONVOY.pause : CONVOY.pause * 1.6); return; }
    if (!this.seen && nearest < 520) {
      this.seen = true;
      g.toast('Convoi de Rouliers', 'Deux camions chargés et leur escorte. Laissez-le passer, ou prenez ce qu’il transporte.');
    }
    for (const unit of this.units) {
      if (!unit.active) continue;
      if (unit.car.hp < unit.hp - 0.5 && nearest < 260 && this.alert <= 0) {
        g.toast('L’escorte se retourne contre vous', 'Les camions filent. Cassez-en un pour faire tomber sa cargaison.');
        g.audio.ui('wantedUp');
      }
      if (unit.car.hp < unit.hp - 0.5 && nearest < 260) this.alert = CONVOY.grudge;
      unit.hp = unit.car.hp;
      if (unit.car.destroyed && !unit.counted) {
        unit.counted = true;
        if (unit.spec.role === 'cargo') this.drop(unit.car);
      }
    }
    this.alert = Math.max(0, this.alert - dt);
    let lead = null;
    for (const unit of live) {
      const { car, driver, spec } = unit;
      if (this.alert > 0 && spec.role === 'escort' && player.alive && distance(car.position, player) < 420) {
        // run the player down, aiming a little ahead of them
        const d = distance(car.position, player), ahead = clamp(d * 0.08, 0, 2.5);
        let x = player.x + player.vx * ahead, z = player.z + player.vz * ahead;
        if (!saltLandAt(x, z)) { x = player.x; z = player.z; }
        driver.aggressive = true;
        driver.setGoal(x, z);
        driver.update(dt, { direct: true, stopAt: 1.3, speedCap: 34 });
        unit.goalT = 0;
      } else {
        driver.aggressive = false;
        unit.goalT -= dt;
        if (unit.goalT <= 0) {
          unit.goalT = 2.5;
          const goal = this.roadAhead(car.position.x, car.position.z).at(-1);
          driver.setGoal(goal.x, goal.z);
        }
        let cap = this.alert > 0 ? spec.speed : CONVOY.cruise;
        if (lead) {
          const dx = lead.car.position.x - car.position.x, dz = lead.car.position.z - car.position.z;
          const inFront = dx * Math.sin(car.heading) + dz * Math.cos(car.heading) > 0, gap = Math.hypot(dx, dz);
          if (inFront && gap < 160) cap = followSpeed(Math.abs(lead.car.speed), gap, spec.speed);
        }
        driver.update(dt, { speedCap: cap });
        lead = unit;
      }
      car.mesh.updateMatrixWorld(true);
    }
    this.plume(dt);
  }
}
