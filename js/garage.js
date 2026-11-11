import { doorPosition } from './interaction-state.js';
import { QuickStrip } from './quick-strip.js';
import { settleBody } from './car-physics.js';
import { WATER } from './boat.js';
import { repairBody } from './drive-fx.js';
import { CAR_CATALOG, GARAGE_KINDS } from './car-catalog.js';

// The quick garage: a small button (G) opens a strip of tiles that freezes the game for a moment. Any tile puts the player
// in that vehicle on the spot. From the ground a plane appears in flight, already above the rooftops; from the air, a car
// or a bike waits on the street below. What the garage summoned goes back to it; a car taken from the street stays there.

const CHOICES = [
  { id: 'foot', label: 'À PIED', icon: 'i-walk' },
  { id: 'car', label: 'BERLINE', icon: 'i-car' },
  { id: 'muscle', label: 'MUSCLE', icon: 'i-car' },
  { id: 'sport', label: 'SPORT', icon: 'i-car' },
  { id: 'super', label: 'SUPERCAR', icon: 'i-car' },
  { id: 'moto', label: 'MOTO', icon: 'i-moto' },
  { id: 'bicycle', label: 'VÉLO', icon: 'i-bike' },
  { id: 'boat', label: 'BATEAU', icon: 'i-boat' },
  { id: 'helicopter', label: 'HÉLICO', icon: 'i-heli' },
  { id: 'classic', label: 'BOURRASQUE', sub: 'BIPLAN', icon: 'i-plane', name: 'HAUTURIER BOURRASQUE', spec: 'MOTEUR EN ÉTOILE 450 CH  ·  240 KM/H  ·  VOLTIGE' },
  { id: 'jet', label: 'TRAMONTANE', sub: 'JET', icon: 'i-plane', name: 'CORSAIRE TRAMONTANE', spec: 'POSTCOMBUSTION  ·  MACH 1,25  ·  8 G' },
  ...CAR_CATALOG.filter(c => !['sedan', 'muscle', 'sport', 'super'].includes(c.kind))
    .map(c => ({ id: c.kind, label: c.type, icon: 'i-car' }))
];
const FLOOR_ALTITUDE = 200; // a plane summoned from the ground starts above this, and above whatever is around
const CLEARANCE = 45;
const JUMP_DISTANCE = 30; // past this the camera cuts to the new vehicle instead of gliding there

class Garage extends QuickStrip {
  constructor(game) {
    super(game, {
      name: 'garage', label: 'Changer de véhicule', hotkey: 'G', closeCode: 'KeyG', icon: 'i-walk',
      tiles: CHOICES.map(c => {
        const car = CAR_CATALOG.find(v => v.kind === (c.id === 'car' ? 'sedan' : c.id));
        return `${QuickStrip.icon(c.icon)}<span>${car?.model || c.label}</span><small>${car ? c.label : c.sub || 'EXPLORATION'}</small>`;
      })
    });
    this.panel.setAttribute('aria-label', 'Garage : choisir un véhicule');
    this.info = document.createElement('div');
    this.info.className = 'garage-spec';
    this.info.innerHTML = '<span>COLLECTION</span><strong></strong><small></small>';
    this.panel.prepend(this.info);
    // The first nine keyboard shortcuts remain unchanged; the entire collection is also reachable by arrows.
    this.tiles.forEach((tile, i) => { if (i > 8) tile.querySelector('kbd').remove(); });
  }

  // What the player is riding right now, as a tile id
  get current() {
    const g = this.game;
    if (g.state !== 'driving') return 'foot';
    const car = g.car;
    return car.flight ? car.kind : car.moto ? 'moto' : car.boat ? 'boat' : car.bicycle ? 'bicycle' : car.mode || (car.kind === 'sedan' ? 'car' : GARAGE_KINDS.has(car.kind) ? car.kind : 'car');
  }

  get currentIndex() { return CHOICES.findIndex((c) => c.id === this.current); }

  get available() {
    const g = this.game;
    return g.active && !g.transition && (g.state === 'onFoot' || g.state === 'driving' || g.state === 'falling');
  }

  // The button shows the current vehicle
  update() { this.setButtonIcon(CHOICES[this.currentIndex].icon); }

  select(i) {
    super.select(i);
    if (!this.info) return;
    const choice = CHOICES[i];
    const entry = CAR_CATALOG.find(c => c.kind === (choice.id === 'car' ? 'sedan' : choice.id));
    const car = entry && this.game.rides.find(c => c.pooled && c.kind === entry.kind);
    this.info.querySelector('strong').textContent = entry ? `${entry.brand} ${entry.model}` : choice.name || choice.label;
    this.info.querySelector('small').textContent = choice.spec ? choice.spec : car
      ? `${entry.drive}  ·  ${car.tune.mass.toLocaleString('fr-FR')} KG  ·  ${car.tune.gears.length} RAPPORTS  ·  ${car.tune.torque} NM`
      : this.game.gamepad?.using ? 'CROIX : CHOISIR · A : PRENDRE LE VOLANT · B : FERMER'
        : 'FLÈCHES : CHOISIR  ·  ENTRÉE : PRENDRE LE VOLANT  ·  G : FERMER';
    if (this.open) this.tiles[i].scrollIntoView({ block: 'nearest' });
  }

  key(e) {
    if (this.open && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      this.navigate(e.code === 'ArrowDown' ? 'down' : 'up');
      return;
    }
    super.key(e);
  }

  navigate(direction) {
    const columns = getComputedStyle(this.panel).gridTemplateColumns.split(' ').length;
    const step = { up: -columns, down: columns, left: -1, right: 1 }[direction];
    this.select((this.sel + step + CHOICES.length) % CHOICES.length);
  }

  pick(i) {
    const id = CHOICES[i].id;
    const change = id !== this.current;
    this.close();
    if (change) this.summon(id);
  }

  // ---- Summoning ---------------------------------------------------------------------------------------------------
  origin() {
    const g = this.game;
    if (g.state === 'driving') {
      const c = g.car;
      return { x: c.position.x, y: c.position.y, z: c.position.z, heading: c.heading, speed: c.speed || 0, driving: true, flying: c.flight ? g.aviation.airborne(c) : !!c.air && c.position.y > 3 };
    }
    const p = g.person;
    return { x: p.position.x, y: p.position.y, z: p.position.z, heading: g.camera.footYaw, speed: 0, driving: false, flying: g.state === 'falling' };
  }

  summon(id) {
    const g = this.game;
    const from = this.origin();
    if (id === 'foot') { this.dismount(from); return; }
    const left = this.release();
    if (id === 'boat') this.board(this.boat(from), from);
    else if (id === 'car' || id === 'moto' || id === 'bicycle' || GARAGE_KINDS.has(id)) this.board(this.groundVehicle(id, from, left), from);
    else if (id === 'helicopter') this.board(this.helicopter(from), from);
    else this.board(this.plane(id, from), from);
    g.state = 'driving';
  }

  // Leaves what the player is in: what came from the garage goes back, anything else stays where it stands
  release() {
    const g = this.game;
    if (g.state === 'falling') { g.vertical.reset(); g.state = 'onFoot'; return { gone: true }; }
    if (g.state !== 'driving') return { gone: false, inStreet: false };
    const old = g.car;
    old.ridden = false;
    g.person.inVehicle = false;
    const gone = !old.mission && (old.summoned || !!old.mode);
    if (gone) g.removeFleetCar(old);
    return { gone, inStreet: !gone };
  }


  // Beside a car that stays, a few steps ahead on foot, right under a flying player, or in place of what just vanished
  groundSpot(from, left, radius) {
    const g = this.game;
    const sin = Math.sin(from.heading), cos = Math.cos(from.heading);
    const ahead = from.flying || left.gone ? 0 : left.inStreet ? 0 : 4;
    const side = left.inStreet ? 3.6 : 0;
    return g.safeSpot(from.x + sin * ahead + cos * side, from.z + cos * ahead - sin * side, radius);
  }

  groundVehicle(id, from, left) {
    const g = this.game;
    const kind = id === 'car' ? 'sedan' : id;
    const pooled = g.rides.find(r => r.pooled && r.kind === kind);
    const clearance = pooled?.body ? Math.hypot(pooled.halfW, pooled.halfL) + 0.2 : 1.4;
    const spot = this.groundSpot(from, left, clearance);
    const carry = from.driving && !from.flying ? from.speed : 0;
    if (id === 'bicycle') {
      const bike = this.prepare(g.controllers.entities.cyclist);
      bike.position.set(spot.x, g.controllers.getGroundHeight(spot.x, spot.z, 'cyclist'), spot.z);
      bike.heading = from.heading;
      bike.speed = Math.min(carry, bike.drive.speed);
      return bike;
    }
    const car = this.prepare(pooled);
    car.summoned = true;
    car.hp = 100;
    car.fallen = false;
    car.position.set(spot.x, 0, spot.z);
    car.prevX = spot.x; car.prevZ = spot.z;
    car.heading = from.heading;
    car.speed = Math.min(carry, car.drive.speed);
    if (car.body) {
      settleBody(car, from.heading);
      car.speed = Math.min(carry, car.drive.speed);
      car.nitro = 1;
      repairBody(car);
    }
    return car;
  }

  // The nearest river: the boat waits a little way off the seawall
  boat(from) {
    const g = this.game;
    const boat = this.prepare(g.rides.find((r) => r.boat));
    boat.summoned = true;
    boat.hp = 100;
    const spot = g.waterNear(from.x, from.z);
    boat.position.set(spot.x, WATER, spot.z);
    boat.prevX = spot.x; boat.prevZ = spot.z;
    // Bow to the open river
    boat.heading = spot.x < 0 ? -Math.PI / 2 : Math.PI / 2;
    boat.speed = 0;
    return boat;
  }

  helicopter(from) {
    const g = this.game;
    const heli = this.prepare(g.controllers.entities.helicopter);
    const spot = from.flying ? from : g.safeSpot(from.x, from.z, 5);
    heli.position.set(spot.x, from.flying ? Math.max(from.y, 12) : 0.25, spot.z);
    heli.heading = from.heading;
    heli.speed = from.flying ? Math.min(from.speed, heli.drive.speed) : 0;
    heli.verticalSpeed = 0;
    return heli;
  }

  // An aircraft appears already flying: where the player was if that was in clear air, else above the rooftops
  plane(id, from) {
    const g = this.game;
    const plane = this.prepare(g.controllers.aircraft[id]);
    const y = from.flying && this.airIsClear(from) ? from.y : this.clearAltitude(from.x, from.z);
    g.aviation.launch(plane, { x: from.x, y, z: from.z, heading: from.heading, speed: from.flying ? from.speed : 0 });
    return plane;
  }

  // High enough, with nothing standing around at that height
  airIsClear({ x, y, z }) {
    if (y < 60) return false;
    return !this.game.controllers.nearColliders(x, z, 120).some((c) => (c.maxY ?? 0) > y - CLEARANCE);
  }

  // Clear of the tallest building within a few seconds of flight
  clearAltitude(x, z) {
    let top = 0;
    for (const c of this.game.controllers.nearColliders(x, z, 400)) top = Math.max(top, c.maxY ?? 0);
    return Math.max(FLOOR_ALTITUDE, top + CLEARANCE);
  }

  // The bicycle, the helicopter and the plane are one of a kind: they join the fleet while in use
  prepare(entity) {
    const g = this.game;
    entity.destroyed = false;
    entity.crashed = false;
    entity.burnT = 0;
    if (entity.air) entity.hp = 100;
    entity.vx = entity.vz = entity.angularVel = 0;
    entity.mesh.visible = true;
    if (!g.fleet.includes(entity)) g.fleet.push(entity);
    return entity;
  }

  board(vehicle, from) {
    const g = this.game;
    const p = g.person;
    g.controllers.resetInput();
    g.controllers.entities.car = vehicle;
    p.inVehicle = true;
    p.speed = 0;
    p.verticalVel = 0;
    vehicle.ridden = true;
    vehicle.fallen = false;
    g.state = 'driving';
    g.onMode(vehicle.mode || 'car');
    document.body.dataset.gameState = g.state;
    const far = Math.hypot(vehicle.position.x - from.x, vehicle.position.y - from.y, vehicle.position.z - from.z) > JUMP_DISTANCE;
    if (far) { g.camera.resetForTeleport(); g.camera.initialized = false; } else g.camera.resetOrbit();
    g.radio?.setPlaying(true);
    g.announce(vehicle);
    g.updateKeybar();
    g.save();
  }

  dismount(from) {
    const g = this.game;
    if (g.state !== 'driving') return;
    if (from.flying) { g.bailOut(); return; }
    const car = g.car;
    const door = doorPosition(car, 1);
    const spot = g.safeSpot(door.x, door.z, 0.5);
    car.speed = car.vx = car.vz = car.angularVel = 0;
    car.ridden = false;
    const p = g.person;
    p.inVehicle = false;
    p.position.set(spot.x, g.controllers.getGroundHeight(spot.x, spot.z, 'person'), spot.z);
    p.verticalVel = 0;
    p.heading = car.heading;
    g.camera.footYaw = car.heading;
    g.state = 'onFoot';
    g.onMode('person');
    g.radio?.setPlaying(false);
    document.body.dataset.gameState = g.state;
    g.updateKeybar();
    g.save();
  }
}

export { Garage, CHOICES };
