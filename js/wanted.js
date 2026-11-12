import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BODY_SPECS, buildLightbarGeometry, createLightbarMaterial } from './cars.js';
import { carSpecs } from './car-assets.js';
import { lineOfSight } from './weapons.js';
import { AIDriver } from './ai-driver.js';
import { settleBody } from './car-physics.js';
import { policeRoute, roadAhead, roadApproach, routeDistance } from './police-routing.js';

// WANTED LEVEL — the city's police response, one to five stars.
// Witnessed crimes build heat (0..120) that sets the stars. Police don't simply know where the player is: they search
// the street graph around the last sighting, units patrol inside that search area, and every sighting re-centres it on
// the player. Leave the search area unseen long enough (the stars flash) and the police give up.

const LEVELS = [
  { name: '', heat: 0, units: 0, radius: 0, escape: 0 },
  { name: 'SIGNALÉ', heat: 20, units: 1, radius: 95, escape: 7 },
  { name: 'RECHERCHÉ', heat: 35, units: 3, radius: 135, escape: 10 },
  { name: 'TRAQUÉ', heat: 55, units: 5, radius: 175, escape: 13 },
  { name: 'ENNEMI PUBLIC', heat: 75, units: 7, radius: 220, escape: 16 },
  { name: 'CHASSE À L’HOMME', heat: 95, units: 10, radius: 280, escape: 20 }
];
const CRIMES = {
  shots: 7, aim: 2, robbery: 16, pedHit: 9, pedKilled: 14, carjack: 7, copHurt: 16, copKilled: 26, copCarHit: 6, explosion: 18, arrestResist: 10
};
const POOL = LEVELS.at(-1).units;
const STRIP_REACH = 5.5; // half a street
const SIGHT_RANGE = 112;
const SIGHT_ANGLE = 0.88;
const SIGHT_DOT = Math.cos(SIGHT_ANGLE);
const STREET_LEVEL_REACH = 3;
const REPORT_WINDOW = 9;
const SEARCH_ARRIVAL = 17;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
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
    this.phase = 'idle';
    this.incident = null;
    this.sighting = null;
    this.searchAnchor = null;
    this.searchVisits = new Map();
    this.tacticsAt = 0;
    this.radioAt = 0;
    this.nextBlockAt = 0;
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
    this.report(x, z);
    if (this.level !== previous) this.onLevel?.(this.level, previous);
  }

  report(x, z) {
    const point = { x, z };
    const checked = this.searchAnchor && this.units.some((u) => u.active && u.checkedAnchor === this.searchAnchor);
    if (!this.incident || this.clock - this.incident.at > REPORT_WINDOW || distance(point, this.incident) > 18 ||
        (checked && this.clock - this.incident.openedAt >= 5)) {
      this.incident = { ...point, road: roadApproach(this.nav, x, z), openedAt: this.clock };
      this.searchAnchor = null;
      this.searchVisits.clear();
      this.tacticsAt = 0;
    }
    this.incident.at = this.clock;
    this.zone.x = x; this.zone.z = z;
    this.seenT = 0;
    this.escape = 0;
  }

  // Raise to at least `level` (missions)
  force(level, x, z) {
    if (level <= this.level) return;
    const previous = this.level;
    this.heat = LEVELS[level].heat + 1;
    this.level = level;
    this.report(x, z);
    this.onLevel?.(this.level, previous);
  }

  clear(silent = false) {
    const previous = this.level;
    this.heat = 0;
    this.level = 0;
    this.seen = false;
    this.phase = 'idle';
    this.incident = this.sighting = this.searchAnchor = null;
    this.contactLead = null;
    this.searchVisits.clear();
    this.searchNodes.length = 0;
    this.spawnT = 0;
    this.nextBlockAt = 0;
    this.radioAt = 0;
    this.escape = 0;
    this.arrest = 0;
    this.arrestT = 0;
    for (const u of this.units) if (u.active) u.car.siren = false;
    for (const s of this.strips) { s.life = 0; s.mesh.visible = false; }
    for (const a of this.actors.actors) {
      if (a.team === 'police' && a.cover && !a.dead) { a.behavior = 'idle'; a.alert = false; a.hostile = false; }
    }
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
    for (const a of u.crew) if (!a.dead && this.actors.actors.includes(a)) this.actors.remove(a);
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
    const driver = new AIDriver(this.controllers, this.nav, car, { maxSpeed: 40, corner: 14,
      roadGoal: (ax, az, bx, bz) => policeRoute(this.nav, ax, az, bx, bz) });
    driver.aggressive = true;
    return { car, driver, active: false, mode: 'idle', crew: [], deployed: false, losT: 0, los: false, idle: 0 };
  }

  // A cruiser taken by the player leaves the pool for good; a fresh one takes its place
  release(car) {
    const u = this.units.find((unit) => unit.car === car);
    if (!u) return;
    this.units.splice(this.units.indexOf(u), 1);
    car.siren = false;
    car.police = false;
    for (const a of u.crew) if (!a.dead) a.cover = null;
    const fresh = this.makeUnit(car.kind);
    fresh.car.mesh.visible = false;
    this.units.push(fresh);
  }

  spawnUnit(target, active) {
    const u = this.units.find((unit) => !unit.active);
    if (!u) return;
    const center = this.seen ? this.zone : this.searchAnchor ?? this.zone;
    const first = active.length === 0;
    // A patrol car already in the traffic nearby answers the call first
    let patrol = null, patrolScore = Infinity;
    for (const v of this.traffic?.cars || []) {
      if (!v.isPolice || !v.edge) continue;
      const d = distance(v, center);
      if (d > (first ? 115 : 240) || distance(v, target) < 18) continue;
      const heading = v.yaw + v.yawOffset;
      const aligned = (Math.sin(heading) * (center.x - v.x) + Math.cos(heading) * (center.z - v.z)) / Math.max(1, d);
      const score = d + (1 - aligned) * 35;
      if (score < patrolScore) { patrol = v; patrolScore = score; }
    }
    if (patrol) {
      const { x, z, yaw, yawOffset, speed } = patrol;
      this.traffic.removeVehicle(patrol);
      this.activate(u, x, z, yaw + yawOffset, Math.max(6, speed));
      return true;
    }
    const candidates = [];
    const cam = this.camera.position;
    this.camera.getWorldDirection(_camDir);
    for (const id of this.nav.within(center.x, center.z, first ? 275 : 355)) {
      const a = this.nav.nodes[id];
      for (const { to, cost } of this.nav.links[id]) {
        if (cost < 27) continue;
        const b = this.nav.nodes[to], dx = (b.x - a.x) / cost, dz = (b.z - a.z) / cost;
        const along = Math.min(38, cost * 0.5);
        const point = { x: a.x + dx * along + dz * 1.8, z: a.z + dz * along - dx * 1.8, heading: Math.atan2(dx, dz) };
        const d = distance(point, center), playerD = distance(point, target);
        if (d > (first ? 220 : 310) || playerD < (first ? 48 : 72)) continue;
        if (active.some((other) => distance(point, other.car.position) < 24)) continue;
        const view = ((point.x - cam.x) * _camDir.x + (point.z - cam.z) * _camDir.z) / Math.max(1, distance(point, cam));
        const alignment = ((center.x - point.x) * dx + (center.z - point.z) * dz) / Math.max(1, d);
        candidates.push({ ...point, view, score: Math.abs(d - (first ? 82 : 150)) + (1 - alignment) * 30 + Math.max(0, view) * 22 });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    for (const p of candidates.slice(0, 36)) {
      const y = this.controllers.getGroundHeight(p.x, p.z, 'car');
      if (p.view > 0.12 && lineOfSight(this.controllers, cam.x, cam.y, cam.z, p.x, y + 1.1, p.z)) continue;
      if (this.trafficCars?.some((v) => v.edge && distance(p, v) < 7)) continue;
      if (this.controllers.nearColliders(p.x, p.z, 4).some((c) =>
        c.minX - 1 < p.x && c.maxX + 1 > p.x && c.minZ - 1 < p.z && c.maxZ + 1 > p.z &&
        c.maxY > y + 0.35 && (c.minY ?? 0) < y + 1.5)) continue;
      this.activate(u, p.x, p.z, p.heading, 8);
      return true;
    }
  }

  activate(u, x, z, heading, speed) {
    const car = u.car;
    car.position.set(x, this.controllers.getGroundHeight(x, z, 'car'), z);
    settleBody(car, heading);
    car.prevX = x; car.prevZ = z;
    car.speed = speed;
    for (const wheel of car.body.wheels) wheel.burst = false;
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
    u.losT = 0;
    u.gunT = 0.9;
    u.los = false;
    u.order = u.checkedAnchor = u.intercept = u.perimeter = null;
    u.flank = undefined;
  }

  /**
   * @param {object} target - player {x, y, z, inVehicle, onFoot, speed, vx, vz, alive, entity}
   */
  update(dt, target) {
    this.clock += dt;
    this.warm++;
    if (this.warm === 4) for (const u of this.units) if (!u.active) u.car.mesh.visible = false;
    const level = this.level;

    // Cruisers and officers need a clear line, even around a close corner.
    let seen = false;
    if (level > 0 && target.alive) {
      for (const [index, u] of this.units.entries()) {
        if (!u.active || u.car.destroyed) continue;
        const c = u.car.position;
        const dx = target.x - c.x, dz = target.z - c.z;
        const d = Math.hypot(dx, dz);
        const dy = target.y - c.y;
        u.losT -= dt;
        const ahead = dx * Math.sin(u.car.heading) + dz * Math.cos(u.car.heading);
        const canSee = Math.hypot(d, dy) < SIGHT_RANGE && (d < 34 || ahead > d * SIGHT_DOT);
        if (!canSee) u.los = false;
        if (u.losT <= 0) {
          u.losT = 0.15 + index % 4 * 0.036;
          u.los = canSee && lineOfSight(this.controllers, c.x, c.y + 1.6, c.z, target.x, target.y + 1.2, target.z, false);
        }
        if (u.los) seen = true;
      }
      for (const a of this.actors.actors) {
        if (a.team === 'police' && !a.dead && a.los && Math.hypot(a.x - target.x, a.y - target.y, a.z - target.z) < SIGHT_RANGE) {
          seen = true;
          if (!a.hostile) {
            a.hostile = a.alert = true;
            a.behavior = level === 1 ? 'arrest' : 'combat';
          }
        }
      }
    }
    const hadContact = this.seen;
    this.seen = seen;

    if (level > 0 && target.alive) {
      const info = LEVELS[level];
      if (seen) {
        this.seenT = 0;
        this.zone.x = target.x;
        this.zone.z = target.z;
        this.sighting ??= {};
        Object.assign(this.sighting, { x: target.x, z: target.z, vx: target.vx, vz: target.vz, at: this.clock });
        this.escape = Math.max(0, this.escape - dt * 0.5);
      } else {
        this.seenT += dt;
        if (hadContact) {
          this.searchAnchor = null;
          this.searchVisits.clear();
        }
        const latest = this.sighting && this.sighting.at >= (this.incident?.at ?? -Infinity) ? this.sighting : this.incident;
        if (!this.searchAnchor) {
          this.searchAnchor = { ...this.zone, road: latest?.road ?? roadApproach(this.nav, this.zone.x, this.zone.z), source: latest };
        }
      }
      const dispatch = !seen && this.incident && this.searchAnchor.source === this.incident && this.clock - this.incident.at < REPORT_WINDOW &&
        !this.units.some((u) => u.active && u.checkedAnchor === this.searchAnchor);
      const phase = seen ? 'chase' : dispatch ? 'dispatch' : 'search';
      if (this.phase !== phase) {
        this.phase = phase;
        if (this.clock >= this.radioAt) {
          this.radioAt = this.clock + 6;
          this.actors.onBark?.(phase === 'chase' ? 'Contact visuel. Toutes les unités, on le tient !' :
            phase === 'search' ? 'Contact perdu. Vérifiez les rues voisines.' : 'Signalement reçu. Une patrouille se rend sur place.');
        }
      }
      this.zone.radius = info.radius + Math.min(120, this.seenT * 2.2);
      const outside = Math.hypot(target.x - this.zone.x, target.z - this.zone.z) > this.zone.radius;
      if (!seen && !dispatch) {
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
      this.spawnT = this.spawnUnit(target, active) ? 2.2 - this.level * 0.17 : 0.75;
    }
    this.assignTactics(active, target, hadContact !== seen);
    if (target.alive || !this.level) for (const u of active) this.drive(u, dt, target);
    this.updateRoadblocks(dt, target);
    this.updateFlooded();
    this.updateLights();
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
    this.report(x, z);
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
    const d = distance(target, car.position);
    const dy = target.y - car.position.y;
    const nearStreetLevel = Math.abs(dy) < STREET_LEVEL_REACH;
    // Recycle cruisers left far behind, or all of them once the police have given up and they are out of sight
    const camD = car.position.distanceTo(this.camera.position);
    const camSees = this.inView(car.position) && camD < 230;
    if (!camSees && ((d > 460 && !u.los) || (this.level === 0 && (camD > 100 || u.idle > 18)))) {
      this.retire(u);
      return;
    }
    if (this.level === 0) {
      u.mode = 'leave';
      car.siren = false;
    } else if (u.mode === 'leave') {
      u.mode = 'pursue';
      car.siren = true;
      u.idle = 0;
    }
    if (u.mode === 'block') {
      this.controllers.simulateCar(car, 0, 0, true, dt);
      u.idle += dt;
      const p = u.intercept;
      const passed = this.seen && (target.x - p.x) * p.dx + (target.z - p.z) * p.dz > 32;
      if (u.idle > 7 || passed || this.phase === 'dispatch') {
        u.mode = 'pursue';
        u.intercept = null;
        this.tacticsAt = 0;
      }
      return;
    }
    if (u.mode === 'parked') {
      car.speed *= Math.exp(-dt * 3);
      this.controllers.simulateCar(car, 0, 0, true, dt);
      u.idle += dt;
      const crew = u.crew.filter((a) => !a.dead && this.actors.actors.includes(a));
      if (crew.length === 0 || (target.inVehicle && d > 55 && crew.every((a) => distance(a, car.position) < 9))) {
        for (const a of crew) this.actors.remove(a);
        u.crew = [];
        u.deployed = false;
        u.mode = 'pursue';
      } else if (!camSees && d > 130 && u.idle > 5) {
        this.retire(u);
      }
      return;
    }

    // Route to a shared sighting, an assigned interception, or a fixed search order.
    let gx, gz;
    if (u.mode === 'leave') {
      gx = car.position.x + Math.sin(car.heading) * 100; gz = car.position.z + Math.cos(car.heading) * 100;
      u.idle += dt;
    } else if (u.intercept) {
      ({ x: gx, z: gz } = u.intercept);
    } else if (this.seen && u.perimeter) {
      ({ x: gx, z: gz } = u.perimeter);
    } else if (this.seen) {
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
      ({ x: gx, z: gz } = u.order ?? this.searchAnchor.road);
    }

    // Drive: along a road route by pure pursuit, straight at the player when close and in sight
    const driver = u.driver;
    driver.traffic = this.trafficCars;
    driver.others = this.gameCars;
    const fleeing = this.seen ? Math.hypot(target.vx, target.vz) : 0;
    const pursuitSpeed = u.intercept ? 29 : u.perimeter ? 24 : Math.max(20, Math.min(36, fleeing + (d > 45 ? 8 : 3)));
    driver.maxSpeed = u.mode === 'leave' ? 20 : this.seen ? pursuitSpeed : this.phase === 'dispatch' ? 27 : 22;
    // Left behind and out of view, a cruiser finds a little more than its engine has: nobody outruns the radio
    const unseen = !this.inView(car.position) || camD > 120;
    car.body.chase = u.mode === 'pursue' && this.level >= 2 && unseen ? Math.min(2.5, Math.max(0, d - 40) * 0.035) : 0;
    driver.setGoal(gx, gz);
    const gd = Math.hypot(gx - car.position.x, gz - car.position.z);
    const closePursuit = this.seen && u.los && !u.intercept && !u.perimeter;
    const direct = gd < 62 && (closePursuit || gd < 32 &&
      lineOfSight(this.controllers, car.position.x, car.position.y + 1, car.position.z, gx, car.position.y + 1, gz, false));
    // Stop beside a player on foot and send the officers out
    const stopping = u.los && target.onFoot && d < 27 && nearStreetLevel && !u.intercept && !u.perimeter && u.mode === 'pursue';
    const blocking = u.intercept?.block;
    const waiting = u.intercept || u.perimeter || (!this.seen && gd < 12);
    const cordon = closePursuit && u.flank && d < 35 && target.speed < 13;
    const stopAt = stopping ? 9 : waiting ? 5 : cordon ? 15 : 0;
    const speedCap = closePursuit && target.inVehicle && d < 32 ? Math.max(7, fleeing + 3 + d * 0.12) : Infinity;
    driver.update(dt, { direct, stopAt, speedCap });
    if (stopping && Math.abs(car.speed) < 1.2 && !u.deployed &&
        !this.units.some((other) => other.mode === 'parked' && other.crew.some((a) => !a.dead && distance(a, car.position) < 35))) this.deploy(u, target);
    if (blocking && gd < 7 && Math.abs(car.speed) < 3) this.setRoadblock(u);
    // From three stars the passenger shoots out of the window
    if (this.level >= 3 && u.los && Math.hypot(d, dy) < 38 && target.alive &&
        this.units.filter((other) => other.active && other.los && distance(other.car.position, target) < d).length < 2) {
      u.gunT = (u.gunT ?? 1) - dt;
      if (u.gunT <= 0) {
        u.gunT = 0.85 + Math.random() * 0.65;
        const accuracy = (0.22 + this.level * 0.045) * (1 - d / 60) * (target.inVehicle && target.speed > 9 ? 0.75 : 1);
        this.onPoliceShot?.(car.position.x, car.position.y + 1.25, car.position.z, accuracy, this.level >= 4 ? 13 : 9);
      }
    }

    // No progress for a while and out of the camera's sight: put the unit back into play elsewhere
    u.progressT = (u.progressT || 0) + dt;
    if (u.bestD === undefined || gd < u.bestD - 4 || Math.abs(car.speed) > 9) { u.bestD = gd; u.progressT = 0; }
    if (u.progressT > 11 && d > 55 && !camSees && u.mode === 'pursue' && !u.intercept && !u.perimeter) {
      this.retire(u);
      return;
    }
    u.last = { throttle: driver.throttle, steer: driver.steer, target: driver.target, blocked: driver.blocked };
  }

  assignTactics(active, target, changed) {
    const cars = active.filter((u) => u.mode === 'pursue' && !u.car.destroyed);
    if (!this.level || !target.alive) return;
    if (!this.seen) {
      for (const u of cars) u.intercept = u.perimeter = null;
      this.assignSearch(cars);
      return;
    }
    if (!changed && this.clock < this.tacticsAt && cars.every((u) => u.flank !== undefined)) return;
    this.tacticsAt = this.clock + 0.85;
    cars.sort((a, b) => distance(a.car.position, target) - distance(b.car.position, target));
    const speed = Math.hypot(target.vx, target.vz);
    const ahead = this.level >= 2 && target.inVehicle && speed > 8
      ? roadAhead(this.nav, target.x, target.z, target.vx / speed, target.vz / speed, Math.min(400, 135 + speed * 8)) : [];
    const options = ahead.filter((p) => p.distance > Math.max(45, speed * 2.3));
    const reserved = new Set(active.filter((u) => u.mode === 'block' && u.intercept).map((u) => u.intercept.node));
    const hasBlock = reserved.size > 0;
    const chasers = Math.min(this.level >= 4 ? 3 : 1, cars.length);
    if (!changed && cars[0] && this.contactLead && cars.includes(this.contactLead) &&
        distance(this.contactLead.car.position, target) < distance(cars[0].car.position, target) + 16) {
      cars.splice(cars.indexOf(this.contactLead), 1);
      cars.unshift(this.contactLead);
    }
    this.contactLead = cars[0];
    for (const [i, u] of cars.entries()) {
      u.perimeter = null;
      u.flank = i === 0 ? 0 : i % 2 ? 1 : -1;
      u.quarter ??= Math.random() < 0.5 ? 1 : -1;
      const plan = u.intercept;
      if (i >= chasers && plan && !reserved.has(plan.node) && options.some((p) => p.node === plan.node)) {
        if (!plan.block && this.level >= 3 && !hasBlock && this.clock >= (this.nextBlockAt ?? 0) &&
            !cars.some((other) => other !== u && other.intercept?.block)) plan.block = true;
        reserved.add(plan.node);
      } else {
        u.intercept = null;
      }
    }
    let blockAssigned = hasBlock || cars.some((u) => u.intercept?.block);
    let assigned = cars.filter((u) => u.intercept).length;
    const limit = this.level < 4 ? 1 : this.level === 4 ? 2 : 3;
    for (const u of cars.slice(chasers)) {
      if (assigned >= limit) break;
      if (u.intercept) continue;
      const car = u.car;
      let choice = null, best = Infinity;
      for (const p of options) {
        if (reserved.has(p.node) || distance(car.position, p) > p.distance * 1.45) continue;
        const playerETA = p.distance / Math.max(14, speed);
        const route = routeDistance(this.nav, car.position, p);
        const toX = p.x - car.position.x, toZ = p.z - car.position.z;
        const facing = (toX * Math.sin(car.heading) + toZ * Math.cos(car.heading)) / Math.max(1, Math.hypot(toX, toZ));
        const policeETA = route / 25 + (1 - facing) * 0.9;
        if (policeETA > playerETA + 1) continue;
        const score = playerETA + policeETA * 0.5;
        if (score < best) { choice = p; best = score; }
      }
      if (!choice) continue;
      const block = this.level >= 3 && !blockAssigned && this.clock >= (this.nextBlockAt ?? 0);
      u.intercept = { ...choice, block };
      if (block) blockAssigned = true;
      reserved.add(choice.node);
      assigned++;
    }
    // Keep the remaining units on distinct approaches. Only the contact cars close the final metres.
    const perimeter = this.nav.within(target.x, target.z, 190);
    for (const u of cars.slice(chasers)) {
      if (u.intercept) continue;
      let chosen = -1, best = Infinity;
      for (const id of perimeter) {
        if (reserved.has(id)) continue;
        const node = this.nav.nodes[id], d = distance(node, target);
        if (d < 34) continue;
        const score = Math.abs(d - 72) * 1.25 + distance(node, u.car.position) * 0.45;
        if (score < best) { chosen = id; best = score; }
      }
      if (chosen < 0) continue;
      reserved.add(chosen);
      u.perimeter = this.nav.nodes[chosen];
    }
  }

  assignSearch(cars) {
    const anchor = this.searchAnchor;
    if (!anchor) return;
    const visited = this.searchVisits;
    for (const u of cars) {
      const order = u.order;
      if (!order || order.anchor !== anchor || distance(u.car.position, order) >= SEARCH_ARRIVAL) continue;
      if (order.node === undefined) u.checkedAnchor = anchor;
      else visited.set(order.node, this.clock);
      u.order = null;
    }
    const unassigned = cars.filter((u) => !u.order || u.order.anchor !== anchor || u.order.until < this.clock);
    if (unassigned.length === 0) return;
    unassigned.sort((a, b) => distance(a.car.position, anchor.road) - distance(b.car.position, anchor.road));
    const source = anchor.source;
    const speed = Math.hypot(source?.vx ?? 0, source?.vz ?? 0);
    const ahead = speed > 8 ? roadAhead(this.nav, source.x, source.z, source.vx / speed, source.vz / speed, 195) : [];
    const exits = new Set(ahead.slice(0, 2).flatMap((p) => [p.node, ...this.nav.links[p.node].map((l) => l.to)]));
    const nodes = this.nav.within(anchor.x, anchor.z, Math.min(this.zone.radius, 260));
    const reserved = new Set(cars.map((u) => u.order?.anchor === anchor && u.order.until >= this.clock ? u.order.node : undefined));
    let responders = cars.filter((u) => u.order?.anchor === anchor && u.order.node === undefined && u.order.until >= this.clock).length;
    const responseSize = this.phase === 'dispatch' ? Math.min(2, cars.length) : 1;
    for (const u of unassigned) {
      if (u.checkedAnchor !== anchor && responders < responseSize) {
        u.order = { ...anchor.road, anchor, until: this.clock + 14 };
        responders++;
        continue;
      }
      let best = Infinity, chosen = -1;
      for (const id of nodes) {
        if (reserved.has(id)) continue;
        const n = this.nav.nodes[id];
        const fromCar = distance(n, u.car.position), fromAnchor = distance(n, anchor.road);
        if (fromCar < 26 || fromAnchor < 27) continue;
        const recent = Math.max(0, 22 - (this.clock - (visited.get(id) ?? -Infinity)));
        const score = fromCar * 0.63 + fromAnchor * 0.62 + recent * 7 - (exits.has(id) ? 65 : 0);
        if (score < best) { best = score; chosen = id; }
      }
      if (chosen < 0) {
        u.order = { ...anchor.road, anchor, until: this.clock + 4 };
        continue;
      }
      reserved.add(chosen);
      u.order = { ...this.nav.nodes[chosen], node: chosen, anchor, until: this.clock + 14 };
    }
  }

  // A responding car must drive to the crossing. A spike strip covers the approach at higher levels.
  setRoadblock(u) {
    u.mode = 'block';
    u.idle = 0;
    this.nextBlockAt = this.clock + 15;
    if (this.clock >= this.radioAt) {
      this.radioAt = this.clock + 6;
      this.actors.onBark?.('Carrefour verrouillé. Rabattez-le sur nous !');
    }
    if (this.level < 4) return;
    const s = this.strips.find((strip) => strip.life <= 0);
    if (!s) return;
    const p = u.intercept;
    s.x = p.x - p.dx * 9; s.z = p.z - p.dz * 9; s.dx = p.dx; s.dz = p.dz; s.life = 9;
    s.y = this.controllers.getGroundHeight(s.x, s.z, 'car');
    s.mesh.position.set(s.x, s.y + 0.04, s.z);
    s.mesh.rotation.y = Math.atan2(p.dx, p.dz);
    s.mesh.visible = true;
    s.mesh.updateMatrixWorld();
  }

  updateRoadblocks(dt, target) {
    for (const s of this.strips) if (s.life > 0) {
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      if (!target.inVehicle || Math.abs(target.y - s.y) > 1.5) continue;
      const dx = target.x - s.x, dz = target.z - s.z;
      if (Math.abs(dx * s.dx + dz * s.dz) < 1.6 && Math.abs(dx * s.dz - dz * s.dx) < STRIP_REACH) this.onStrip?.(s);
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
        x, y: car.position.y, z, heading: Math.atan2(target.x - x, target.z - z), look: level >= 4 ? 'swat' : level >= 3 && side < 0 ? 'detective' : Math.random() < 0.3 ? 'copB' : 'cop', team: 'police', cover: { car, side },
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

  updateLights() {
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

export { WantedSystem, LEVELS as WANTED_LEVELS, CRIMES, SIGHT_RANGE, SIGHT_ANGLE };
