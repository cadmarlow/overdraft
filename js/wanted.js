import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BODY_SPECS, buildLightbarGeometry, createLightbarMaterial } from './cars.js';
import { carSpecs } from './car-assets.js';
import { lineOfSight } from './weapons.js';
import { AIDriver } from './ai-driver.js';
import { settleBody } from './car-physics.js';

// WANTED LEVEL — the city's police response, one to five stars.
// Witnessed crimes build heat (0..120) that sets the stars. Police don't simply know where the player is: they search
// the street graph around the last sighting, units patrol inside that search area, and every sighting re-centres it on
// the player. Leave the search area unseen long enough (the stars flash) and the police give up.

const LEVELS = [
  { name: '', heat: 0, units: 0, radius: 0, escape: 0 },
  { name: 'SIGNALÉ', heat: 20, units: 1, radius: 95, escape: 7 },
  { name: 'RECHERCHÉ', heat: 35, units: 2, radius: 135, escape: 10 },
  { name: 'TRAQUÉ', heat: 55, units: 4, radius: 175, escape: 13 },
  { name: 'ENNEMI PUBLIC', heat: 75, units: 5, radius: 220, escape: 16 },
  { name: 'CHASSE À L’HOMME', heat: 95, units: 6, radius: 280, escape: 20 }
];
const CRIMES = {
  shots: 5, aim: 2, robbery: 16, pedHit: 9, pedKilled: 14, carjack: 7, copHurt: 16, copKilled: 26, copCarHit: 6, explosion: 18, arrestResist: 10
};
const POOL = 8;
const BLOCK_EVERY = 16; // seconds between roadblocks
const STRIP_REACH = 5.5; // half a street
const SIGHT_RANGE = 75;
const STREET_LEVEL_REACH = 3;
const levelOf = (heat) => heat <= 0 ? 0 : heat < 35 ? 1 : heat < 55 ? 2 : heat < 75 ? 3 : heat < 95 ? 4 : 5;
const _camDir = new THREE.Vector3();

// A folding strip of steel teeth laid across the road
function createStrips(scene) {
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0x2c2e31, roughness: 0.4, metalness: 0.8 });
  const teeth = [];
  for (let i = -5; i <= 5; i += 0.32) teeth.push(new THREE.ConeGeometry(0.035, 0.12, 4).translate(i, 0.09, (Math.abs(i * 7) % 2) * 0.12 - 0.12));
  teeth.push(new THREE.BoxGeometry(10.6, 0.04, 0.3));
  const geometry = mergeGeometries(teeth.map((g) => g.index ? g.toNonIndexed() : g));
  return [0, 1].map(() => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.visible = false;
    mesh.castShadow = true;
    scene.add(mesh);
    return { mesh, life: 0, x: 0, z: 0, dx: 0, dz: 1 };
  });
}

class WantedSystem {
  constructor({ scene, controllers, nav, actors, audio, camera }) {
    Object.assign(this, { scene, controllers, nav, actors, audio, camera });
    this.heat = 0;
    this.level = 0;
    this.zone = { x: 0, z: 0, radius: 0 };
    this.seen = false;
    this.seenT = 0; // seconds since last sighting
    this.escape = 0; // 0..1 progress towards losing the police
    this.spawnT = 0;
    this.clock = 0;
    this.searchNodes = [];
    this.onLevel = null; // (level, previous)
    this.onBusted = null;
    this.arrest = 0;
    this.arrestT = 0;

    // Pre-built cruiser pool (white body with the police livery, roof light bar), parked below the street until used.
    // They stay drawn for the first frames so their pipelines compile with the city's.
    this.barGeo = { sedan: buildLightbarGeometry(BODY_SPECS.sedan, carSpecs.sedan), suv: buildLightbarGeometry(BODY_SPECS.suv, carSpecs.suv) };
    this.units = [];
    for (let i = 0; i < POOL; i++) this.units.push(this.makeUnit(i % 3 === 2 ? 'suv' : 'sedan', i));
    // Flashing roof lights: a small pool of point lights follows the nearest active cruisers
    this.flashers = [0xff2030, 0x2a6cff].map((hex) => {
      const light = new THREE.PointLight(hex, 0, 16, 2);
      light.position.set(0, -1000, 0);
      scene.add(light);
      return light;
    });
    this.warm = 0;
    this.blockT = 8;
    this.onPoliceShot = null; // (x, y, z, accuracy, damage)
    this.onStrip = null; // (strip)
    this.strips = createStrips(scene);
  }

  get cars() { return this.units.filter((u) => u.active).map((u) => u.car); }

  // Roughly inside the camera's view cone
  inView(p) {
    const cam = this.camera;
    cam.getWorldDirection(_camDir);
    const dx = p.x - cam.position.x, dz = p.z - cam.position.z, d = Math.hypot(dx, dz) || 1;
    return d < 260 && (dx * _camDir.x + dz * _camDir.z) / d > 0.35;
  }
  get levelInfo() { return LEVELS[this.level]; }

  // A crime of `kind` at (x, z). Witnessed crimes raise the heat and bring the search to the scene.
  crime(kind, x, z, witnessed = true) {
    if (!witnessed) return;
    const amount = CRIMES[kind] ?? 5;
    const previous = this.level;
    this.heat = Math.min(120, Math.max(this.heat, 18) + amount);
    this.level = Math.max(this.level, levelOf(this.heat));
    this.zone.x = x; this.zone.z = z;
    this.seen = true;
    this.seenT = 0;
    this.escape = 0;
    if (this.level !== previous) this.onLevel?.(this.level, previous);
  }

  // Raise to at least `level` (missions)
  force(level, x, z) {
    if (level <= this.level) return;
    const previous = this.level;
    this.heat = LEVELS[level].heat + 1;
    this.level = level;
    this.zone.x = x; this.zone.z = z;
    this.seen = true; this.seenT = 0; this.escape = 0;
    this.onLevel?.(this.level, previous);
  }

  clear(silent = false) {
    const previous = this.level;
    this.heat = 0;
    this.level = 0;
    this.escape = 0;
    this.arrest = 0;
    if (!silent && previous) this.onLevel?.(0, previous);
  }

  // Remove everything (respawn, mission restart)
  reset() {
    this.clear(true);
    for (const u of this.units) this.retire(u);
    this.actors.clear((a) => a.team === 'police');
  }

  retire(u) {
    u.active = false;
    u.mode = 'idle';
    u.car.siren = false;
    u.car.mesh.visible = false;
    u.car.position.set(0, -40, -3000);
    u.car.speed = u.car.vx = u.car.vz = u.car.angularVel = 0;
    u.car.mesh.position.copy(u.car.position);
    u.crew = [];
    u.deployed = false;
  }

  makeUnit(kind, i = 0) {
    const car = this.controllers.createCarEntity({ kind, paint: 0xf4f6f8, livery: 1, handling: 'cruiser' });
    const bar = new THREE.Mesh(this.barGeo[kind], createLightbarMaterial());
    bar.castShadow = true;
    car.bodyPivot.add(bar);
    car.police = true;
    car.policeLivery = true;
    car.siren = false;
    car.ai = true;
    car.drive = { speed: car.tune.top * 0.92, reverseSpeed: 11 };
    car.hp = 100;
    car.burnT = 0;
    car.position.set(i * 8, -40, -3000);
    car.mesh.position.copy(car.position);
    const driver = new AIDriver(this.controllers, this.nav, car, { maxSpeed: 40, corner: 14 });
    driver.aggressive = true;
    return { car, driver, active: false, mode: 'idle', crew: [], deployed: false,
      searchX: 0, searchZ: 0, losT: 0, los: false, idle: 0 };
  }

  // A cruiser taken by the player leaves the pool for good; a fresh one takes its place
  release(car) {
    const u = this.units.find((unit) => unit.car === car);
    if (!u) return;
    this.units.splice(this.units.indexOf(u), 1);
    car.siren = false;
    car.police = false;
    const fresh = this.makeUnit(car.kind);
    fresh.car.mesh.visible = false;
    this.units.push(fresh);
  }

  spawnUnit(target) {
    const u = this.units.find((unit) => !unit.active);
    if (!u) return;
    // A patrol car already in the traffic nearby answers the call first
    for (const v of this.traffic?.cars || []) {
      if (!v.isPolice || !v.edge) continue;
      const d = Math.hypot(v.x - target.x, v.z - target.z);
      if (d < 40 || d > 220) continue;
      this.traffic.removeVehicle(v);
      this.activate(u, v.x, v.z, v.yaw + v.yawOffset, Math.max(4, v.speed));
      return;
    }
    const cam = this.camera.position;
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const cx = this.seen ? target.x : this.zone.x, cz = this.seen ? target.z : this.zone.z;
    const candidates = this.nav.within(cx, cz, 260);
    let best = -1, bestScore = -Infinity;
    for (let k = 0; k < 40 && candidates.length; k++) {
      const i = candidates[Math.floor(Math.random() * candidates.length)];
      const n = this.nav.nodes[i];
      const d = Math.hypot(n.x - target.x, n.z - target.z);
      if (d < 110 || d > 260) continue;
      const vx = n.x - cam.x, vz = n.z - cam.z, vd = Math.hypot(vx, vz) || 1;
      const inView = (vx * camDir.x + vz * camDir.z) / vd > 0.45 && vd < 220;
      const score = -Math.abs(d - 160) - (inView ? 200 : 0) + Math.random() * 30;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return;
    const n = this.nav.nodes[best];
    this.activate(u, n.x, n.z, Math.atan2(target.x - n.x, target.z - n.z), 6);
  }

  activate(u, x, z, heading, speed) {
    const car = u.car;
    car.position.set(x, 0, z);
    car.heading = heading;
    car.prevX = x; car.prevZ = z;
    car.speed = speed; car.vx = car.vz = car.angularVel = car.steerAngle = 0;
    car.hp = 100;
    car.burnT = 0;
    car.destroyed = false;
    car.mesh.visible = true;
    car.siren = true;
    u.active = true;
    u.mode = 'pursue';
    u.driver.path = null;
    u.driver.repathT = 0;
    u.driver.stuckT = u.driver.reverseT = 0;
    u.deployed = false;
    u.crew = [];
    u.idle = 0;
    u.bestD = undefined;
    u.progressT = 0;
  }

  /**
   * @param {object} target - player {x, y, z, inVehicle, onFoot, speed, vx, vz, alive, entity}
   */
  update(dt, target) {
    this.clock += dt;
    this.warm++;
    if (this.warm === 4) for (const u of this.units) if (!u.active) u.car.mesh.visible = false;
    const level = this.level;

    // Cruisers and officers need a clear line. Very close cruisers can also spot a player at street level.
    let seen = false;
    if (level > 0 && target.alive) {
      for (const u of this.units) {
        if (!u.active) continue;
        const c = u.car.position;
        const d = Math.hypot(c.x - target.x, c.z - target.z);
        const dy = target.y - c.y;
        u.losT -= dt;
        if (u.losT <= 0) {
          u.losT = 0.35;
          u.los = Math.hypot(d, dy) < SIGHT_RANGE && lineOfSight(this.controllers, c.x, c.y + 1.4, c.z, target.x, target.y + 1.2, target.z);
        }
        if (u.los || (d < 14 && Math.abs(dy) < STREET_LEVEL_REACH)) seen = true;
      }
      for (const a of this.actors.actors) {
        if (a.team === 'police' && !a.dead && a.los && Math.hypot(a.x - target.x, a.y - target.y, a.z - target.z) < SIGHT_RANGE) seen = true;
      }
    }
    this.seen = seen;

    if (level > 0) {
      const info = LEVELS[level];
      if (seen) {
        this.seenT = 0;
        this.zone.x += (target.x - this.zone.x) * Math.min(1, dt * 4);
        this.zone.z += (target.z - this.zone.z) * Math.min(1, dt * 4);
        this.escape = Math.max(0, this.escape - dt * 0.5);
      } else {
        this.seenT += dt;
      }
      this.zone.radius = info.radius + Math.min(120, this.seenT * 2.2);
      const outside = Math.hypot(target.x - this.zone.x, target.z - this.zone.z) > this.zone.radius;
      if (!seen) {
        // Out of the search area the police give up quickly; hiding inside it takes much longer
        this.escape += dt / (outside ? info.escape : info.escape * 3.2);
        if (this.escape >= 1) {
          this.clear();
          this.audio?.ui('wantedDown');
        }
      }
    }

    // Keep the right number of cruisers in play
    const wanted = LEVELS[this.level].units;
    const active = this.units.filter((u) => u.active);
    this.spawnT -= dt;
    if (active.length < wanted && this.spawnT <= 0 && target.alive) {
      this.spawnT = 2.5;
      this.spawnUnit(target);
    }
    this.assignTactics(active, target);
    for (const u of active) this.drive(u, dt, target);
    this.updateRoadblocks(dt, target);
    this.updateFlooded();
    this.updateLights(target);
    // The scene does not update world matrices by itself (main.js): finalize everything moved here
    for (const u of this.units) if (u.active || this.warm < 6) { u.car.mesh.position.copy(u.car.position); u.car.mesh.rotation.y = u.car.heading; u.car.mesh.updateMatrixWorld(); }
    for (const l of this.flashers) l.updateMatrixWorld();

    // Arrest: an officer within reach of a player on foot, not fighting back, for long enough
    if (this.arrestT > 0) this.arrestT -= dt;
    else this.arrest = Math.max(0, this.arrest - dt * 0.8);
  }

  // A silent alarm: the city knows, at once, at this level, right here
  alarm(level, x, z) {
    this.heat = Math.max(this.heat, LEVELS[level].heat + 1);
    this.zone.x = x; this.zone.z = z;
    this.seenT = 0;
    this.escape = 0;
    const previous = this.level;
    this.level = Math.max(this.level, level);
    if (this.level !== previous) this.onLevel?.(this.level, previous);
  }

  // Called by officers in reach (actors.js onArrest)
  arrestProgress(dt) {
    this.arrestT = 0.15;
    this.arrest += dt;
    if (this.arrest >= 1.6) {
      this.arrest = 0;
      this.onBusted?.();
    }
  }

  drive(u, dt, target) {
    const car = u.car;
    if (car.destroyed) {
      // wrecks stay where they burned until out of sight
      if (Math.hypot(car.position.x - target.x, car.position.z - target.z) > 220) this.retire(u);
      return;
    }
    const dx = target.x - car.position.x, dz = target.z - car.position.z;
    const d = Math.hypot(dx, dz);
    const dy = target.y - car.position.y;
    const nearStreetLevel = Math.abs(dy) < STREET_LEVEL_REACH;
    // Recycle cruisers left far behind, or all of them once the police have given up and they are out of sight
    const camD = car.position.distanceTo(this.camera.position);
    if ((d > 420 && !u.los) || (this.level === 0 && (camD > 160 || u.idle > 25))) {
      if (!u.crew.some((a) => !a.dead && Math.hypot(a.x - target.x, a.z - target.z) < 60)) {
        for (const a of u.crew) if (!a.dead) a.behavior = 'idle';
        this.retire(u);
        return;
      }
    }
    if (this.level === 0) {
      u.mode = 'leave';
      car.siren = false;
    }
    if (u.mode === 'block') {
      // Waits across the road until the player has gone past or gone elsewhere
      this.controllers.simulateCar(car, 0, 0, true, dt);
      u.idle += dt;
      // Seen from here the player has gone by once the way to them runs along their own heading
      const passed = dx * Math.sin(target.heading ?? 0) + dz * Math.cos(target.heading ?? 0) > 0;
      if (u.idle > 20 || (d > 60 && passed)) { for (const a of u.crew) if (!a.dead) a.behavior = 'combat'; u.mode = 'pursue'; u.deployed = false; }
      return;
    }
    if (u.mode === 'parked') {
      car.speed *= Math.exp(-dt * 3);
      this.controllers.simulateCar(car, 0, 0, true, dt);
      // crew back in when the player has driven off and nobody was hurt; otherwise keep the scene
      u.idle += dt;
      if (target.inVehicle && d > 60 && u.crew.every((a) => a.dead || Math.hypot(a.x - car.position.x, a.z - car.position.z) < 6)) {
        for (const a of u.crew) if (!a.dead) this.actors.remove(a);
        u.crew = [];
        u.deployed = false;
        u.mode = 'pursue';
      }
      return;
    }

    // Where to: the player when seen (leading a moving car), else the last sighting, then patrol points in the zone
    let gx, gz;
    if (u.mode === 'leave') {
      gx = car.position.x + Math.sin(car.heading) * 100; gz = car.position.z + Math.cos(car.heading) * 100;
      u.idle += dt;
    } else if (this.seen || (d < 30 && nearStreetLevel)) {
      const lead = target.inVehicle ? Math.min(1.2, d / 30) : 0;
      gx = target.x + target.vx * lead; gz = target.z + target.vz * lead;
      // Close in on the car: the first one goes for the rear quarter to spin it, the others come up its flanks
      if (target.inVehicle && d < 70 && u.flank !== undefined) {
        const sp = Math.hypot(target.vx, target.vz) || 1;
        const fx = sp > 2 ? target.vx / sp : Math.sin(target.heading ?? 0), fz = sp > 2 ? target.vz / sp : Math.cos(target.heading ?? 0);
        const along = u.flank === 0 ? -1.4 : d > 16 ? 3 : 0.5;
        const beside = u.flank === 0 ? u.quarter * 1.1 : u.flank * (d > 12 ? 3.2 : 1.3);
        gx += fx * along + fz * beside;
        gz += fz * along - fx * beside;
      }
    } else {
      if (!u.searchT || u.searchT < this.clock || Math.hypot(u.searchX - car.position.x, u.searchZ - car.position.z) < 15) {
        const nodes = this.nav.within(this.zone.x, this.zone.z, this.zone.radius);
        const n = nodes.length ? this.nav.nodes[nodes[Math.floor(Math.random() * nodes.length)]] : { x: this.zone.x, z: this.zone.z };
        u.searchX = n.x; u.searchZ = n.z; u.searchT = this.clock + 20;
      }
      gx = u.searchX; gz = u.searchZ;
    }

    // Drive: along a road route by pure pursuit, straight at the player when close and in sight
    const driver = u.driver;
    driver.traffic = this.trafficCars;
    driver.others = this.gameCars;
    const fleeing = Math.hypot(target.vx, target.vz);
    driver.maxSpeed = u.mode === 'leave' ? car.drive.speed * 0.5 : this.level <= 1 ? car.drive.speed * 0.75 : Math.max(car.drive.speed, fleeing + 10);
    // Left behind and out of view, a cruiser finds a little more than its engine has: nobody outruns the radio
    const unseen = !this.inView(car.position) || camD > 120;
    car.body.chase = u.mode === 'pursue' && this.level >= 2 && unseen ? Math.min(6, Math.max(0, d - 35) * 0.08 + 1) : u.mode === 'pursue' && this.level >= 3 && d > 25 ? 1.4 : 0;
    driver.setGoal(gx, gz);
    const gd = Math.hypot(gx - car.position.x, gz - car.position.z);
    const direct = gd < 40 && (u.los || (gd < 16 && nearStreetLevel));
    // Stop beside a player on foot and send the officers out
    const stopping = target.onFoot && d < 24 && nearStreetLevel && u.mode === 'pursue';
    driver.update(dt, { direct, stopAt: stopping ? 9 : 0 });
    if (stopping && Math.abs(car.speed) < 1.2 && !u.deployed) this.deploy(u, target);
    // From three stars the passenger shoots out of the window
    if (this.level >= 3 && u.los && Math.hypot(d, dy) < 38 && target.alive) {
      u.gunT = (u.gunT ?? 1) - dt;
      if (u.gunT <= 0) {
        u.gunT = 0.5 + Math.random() * (1.1 - this.level * 0.12);
        this.onPoliceShot?.(car.position.x, car.position.y + 1.25, car.position.z, (0.2 + this.level * 0.07) * (1 - d / 60), this.level >= 4 ? 13 : 9);
      }
    }

    // No progress for a while and out of the camera's sight: put the unit back into play elsewhere
    const camSees = this.inView(car.position) && camD < 200;
    u.progressT = (u.progressT || 0) + dt;
    if (u.bestD === undefined || d < u.bestD - 4) { u.bestD = d; u.progressT = 0; }
    if (u.progressT > 10 && d > 40 && !camSees && u.mode === 'pursue') {
      this.retire(u);
      return;
    }
    // Wedged out of sight: hop on along the route, as if it had found its way round
    if ((driver.stuckT > 0.8 || driver.reverseT > 0) && camD > 70 && !camSees) {
      const next = driver.nextPoint();
      if (next) {
        car.position.set(next.p.x, 0, next.p.z);
        car.heading = Math.atan2(next.q.x - next.p.x, next.q.z - next.p.z) || car.heading;
        car.prevX = next.p.x; car.prevZ = next.p.z;
        car.speed = 8; car.vx = car.vz = car.angularVel = 0;
        driver.reverseT = driver.stuckT = 0;
        driver.repathT = 0;
      }
    }
    u.last = { throttle: driver.throttle, steer: driver.steer, target: driver.target, blocked: driver.blocked };
  }

  // Who does what around the player's car: nearest on the rear quarter, the rest up each flank
  assignTactics(active, target) {
    const near = active.filter((u) => u.mode === 'pursue').sort((a, b) => a.car.position.distanceToSquared(this.controllers.entities.person.position) - b.car.position.distanceToSquared(this.controllers.entities.person.position));
    near.forEach((u, i) => {
      u.flank = i === 0 ? 0 : i % 2 ? 1 : -1;
      u.quarter = u.quarter ?? (Math.random() < 0.5 ? 1 : -1);
    });
  }

  // Ahead on the road the player is taking: cruisers across it, officers behind them, a strip of spikes in front from four stars
  updateRoadblocks(dt, target) {
    this.blockT -= dt;
    for (const s of this.strips) if (s.life > 0) {
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      if (!target.inVehicle) continue;
      const dx = target.x - s.x, dz = target.z - s.z;
      if (Math.abs(dx * s.dx + dz * s.dz) < 1.6 && Math.abs(dx * s.dz - dz * s.dx) < STRIP_REACH) this.onStrip?.(s);
    }
    if (this.level < 3 || this.blockT > 0 || this.seenT > 8 || !target.inVehicle) return;
    const speed = Math.hypot(target.vx, target.vz);
    if (speed < 14) return;
    const free = this.units.filter((u) => !u.active);
    if (free.length < 2) return;
    const dx = target.vx / speed, dz = target.vz / speed;
    const reach = 170 + speed * 2.6;
    const node = this.nav.nearest(target.x + dx * reach, target.z + dz * reach, 70);
    if (node === null || node === undefined || node < 0) return;
    const n = this.nav.nodes[node];
    const toX = n.x - target.x, toZ = n.z - target.z;
    if (toX * dx + toZ * dz < 110) return;
    this.blockT = BLOCK_EVERY;
    // Across the street, nose to tail, leaving no room but the pavement
    const across = Math.atan2(dz, -dx);
    [-1, 1].forEach((side, i) => {
      const u = free[i];
      const x = n.x + dz * side * 2.7, z = n.z - dx * side * 2.7;
      this.activate(u, x, z, across + (side > 0 ? 0.15 : -0.15), 0);
      settleBody(u.car, u.car.heading);
      u.mode = 'block';
      u.idle = 0;
      this.deploy(u, target);
      u.mode = 'block';
    });
    if (this.level >= 4) {
      const s = this.strips.find((k) => k.life <= 0);
      if (s) {
        s.x = n.x - dx * 26; s.z = n.z - dz * 26; s.dx = dx; s.dz = dz; s.life = 26;
        s.mesh.position.set(s.x, 0.04, s.z);
        s.mesh.rotation.y = Math.atan2(dx, dz);
        s.mesh.visible = true;
        s.mesh.updateMatrixWorld();
      }
    }
  }

  deploy(u, target) {
    u.deployed = true;
    u.mode = 'parked';
    u.idle = 0;
    const car = u.car;
    const level = this.level;
    for (const side of [1, -1]) {
      const x = car.position.x + Math.cos(car.heading) * 1.5 * side;
      const z = car.position.z - Math.sin(car.heading) * 1.5 * side;
      const a = this.actors.spawn({
        x, z, heading: Math.atan2(target.x - x, target.z - z), look: level >= 4 ? 'swat' : level >= 3 && side < 0 ? 'detective' : Math.random() < 0.3 ? 'copB' : 'cop', team: 'police', cover: { car, side },
        weapon: level >= 5 && side < 0 ? 'rifle' : level >= 4 && side < 0 ? 'smg' : level >= 3 && side < 0 ? 'shotgun' : 'pistol',
        hp: 70 + level * 10, armor: level >= 3 ? 30 : 0, behavior: level <= 1 ? 'arrest' : 'combat', hostile: true,
        accuracy: 0.35 + level * 0.09, alert: true
      });
      if (a) u.crew.push(a);
    }
  }

  // Intersections inside the search area: the searched street graph drawn on the maps
  updateFlooded() {
    if (!this.level) { this.searchNodes.length = 0; return; }
    if (this.clock - (this.areaT || 0) < 0.4) return;
    this.areaT = this.clock;
    this.nav.within(this.zone.x, this.zone.z, this.zone.radius, this.searchNodes);
  }

  updateLights(target) {
    const active = this.units.filter((u) => u.active && !u.car.destroyed && u.car.siren)
      .sort((a, b) => a.car.position.distanceToSquared(this.camera.position) - b.car.position.distanceToSquared(this.camera.position));
    const phase = Math.sin(this.clock * Math.PI * 6) >= 0;
    for (let i = 0; i < this.flashers.length; i++) {
      const light = this.flashers[i];
      const u = active[0];
      if (!u || u.car.position.distanceTo(this.camera.position) > 120) { light.intensity = 0; light.position.y = -1000; continue; }
      const side = i ? 0.4 : -0.4;
      const c = u.car;
      light.position.set(c.position.x + Math.cos(c.heading) * side, 2.1, c.position.z - Math.sin(c.heading) * side);
      light.intensity = (i === 0) === phase ? 70 : 6;
    }
  }
}

export { WantedSystem, LEVELS as WANTED_LEVELS, CRIMES };
