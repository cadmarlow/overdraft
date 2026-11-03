import * as THREE from 'three/webgpu';
import { AIDriver } from './ai-driver.js';
import { NYC_LANDMARKS, TELEPORT_LOCATIONS, getLocationLabel, isTypingInField } from './city-config.js';
import { settleBody } from './car-physics.js';
import { repairBody } from './drive-fx.js';
import { ArchitectSenses } from './architect-senses.js';
import { ArchitectPanel } from './architect-panel.js';
import { ArchitectLink } from './architect-link.js';
import { ArchitectStrip } from './architect-strip.js';
import { parseRepro } from './repro-link.js';

// The Architect: one of the architects of this world, walking it to make it more real. He lives in the player's own
// game, with the player's arsenal and vehicles: on foot along the sidewalks, in his own car through the traffic, in his
// own helicopter over the roofs. Attacked, he warns once, then fights back by conventional means and chases whoever
// runs; he can die, comes back, and remembers. "Leave him to work" (L) hands him the camera: the city then lives around
// him and he goes anywhere while the player's character waits, out of reach. This module is his body and his reflexes;
// what he decides comes from orders (the QA panel today, Claude tomorrow, see ARCHITECTE.md). Absent, he costs nothing.

const NAME = 'L’ARCHITECTE';
// A city suit: the one free look (detective) wears a police vest. His own model is for later (ARCHITECTE.md); until then
// the label over his head and his violet blip tell him from the Syndic's men, who dress the same
const LOOK = 'suit';
const HP = 120, ARMOR = 60;
const WALK = 1.6, JOG = 3.4, RUN = 5.4; // m/s
const FOOT_MAX = 260; // an "auto" trip longer than this is driven
const CAR_MAX = 2600; // and longer than this, flown
const CAR_PAINT = 0x23262b;
const CRUISE = 17; // m/s, about 60 km/h through town
const RESPAWN_AFTER = 25;
const STOW_DISTANCE = 160; // a vehicle he left this far behind goes back to his garage
const HELI_SPEED = 46, HELI_CLIMB = 14, HELI_FLOOR = 60;
const WARN_LINES = ['Tu vises mal, ou c’est moi que tu vises ?', 'Range ça. Je ne le dirai qu’une fois.', 'J’ai du travail. Ne m’oblige pas à m’occuper de toi.'];
const FIGHT_LINES = ['Très bien. Tu l’auras voulu.', 'Tu viens de faire une erreur.', 'On va régler ça vite.'];
const CHASE_LINES = ['Tu crois pouvoir me semer dans ma propre ville ?', 'Roule. Je connais chaque rue.'];
const WIN_LINES = ['Je t’avais prévenu.', 'Réglé. Je retourne au travail.', 'La prochaine fois, tu me laisses travailler.'];
const CALM_LINES = ['Je retourne travailler.', 'Tu as fini ? Moi, j’ai du travail.'];
const BACK_LINES = ['Tu m’as eu une fois. Ça ne se reproduira pas.', 'Je suis de retour. Et je n’oublie rien.'];
// Where his patrols go, and the QA panel's destinations
const PLACES = [
  ['timessq', 'Times Square'], ['empire', 'l’Empire State Building'], ['bryant', 'Bryant Park'], ['grandcentral', 'Grand Central'],
  ['chrysler', 'le Chrysler Building'], ['flatiron', 'le Flatiron'], ['centralpark', 'Central Park'], ['owtc', 'One World Trade Center']
].filter(([id]) => TELEPORT_LOCATIONS[id]).map(([id, label]) => ({ id, label, x: TELEPORT_LOCATIONS[id].x, z: TELEPORT_LOCATIONS[id].z }));
const BY_LABEL = { foot: 'à pied', car: 'en voiture', heli: 'en hélico' };
// Keys that still reach the game while he holds the camera
const KEYS_WHILE_WATCHING = new Set(['KeyL', 'KeyK', 'KeyJ', 'Escape', 'KeyM', 'KeyH', 'KeyN']);
const RESUME_KEY = 'architecte:reprise'; // where he was when he reloaded the game himself

const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const pick = (lines) => lines[Math.floor(Math.random() * lines.length)];

class ArchitectSystem {
  constructor(game) {
    this.game = game;
    this.present = false;
    this.actor = null;
    this.ride = null; // the vehicle he is in
    this.order = null; // { kind: 'goto' | 'follow' | 'patrol' | 'idle', x, z, by, label }
    this.trip = null; // how the current order is being carried out
    this.intent = '';
    this.move = { mx: 0, mz: 0, speed: 0, face: 0 };
    this.fight = null;
    this.grudge = 0; // how many times the player picked a fight
    this.deadAt = null;
    this.spectating = false;
    this.shots = game.stats.shots;
    this.view = { type: 'person', position: new THREE.Vector3(), heading: 0, speed: 0, chaseDistance: 4.3, chaseHeight: 1.95, cameraTargetOffset: game.person.cameraTargetOffset };
    this.senses = new ArchitectSenses(game, () => this.focus());
    this.edges = null;
    this.reproDone = false;

    // His own car and helicopter, built now so that calling them never stalls a frame (drawn for the first frames,
    // like the garage's, so their shaders compile behind the loading screen)
    const car = game.makeCar('sedan', CAR_PAINT, new THREE.Vector3(), 0, true);
    game.fleet.pop();
    Object.assign(car, { pooled: true, architect: true, locked: true });
    game.park(car);
    this.car = car;
    const heli = game.controllers.createHelicopterEntity();
    Object.assign(heli, { kind: 'helicopter', air: true, architect: true, hp: 100, rotorSpin: 0, verticalSpeed: 0 });
    heli.mesh.name = 'ArchitectHelicopter';
    game.park(heli);
    heli.mesh.updateMatrixWorld();
    car.mesh.updateMatrixWorld();
    this.heli = heli;

    this.landmarks = NYC_LANDMARKS;
    this.captures = [];
    this.buildInterface();
    this.link = new ArchitectLink(this);
    this.strip = new ArchitectStrip(this);
    this.addRoomLink();
    if (new URLSearchParams(location.search).has('qa')) this.panel = new ArchitectPanel(this);
    this.blockInput = (e) => this.filterInput(e);
    window.addEventListener('keydown', (e) => {
      if (!['KeyL', 'KeyK', 'KeyJ'].includes(e.code) || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTypingInField(e)) return;
      if (!game.playing || game.paused) return;
      if (e.code === 'KeyK') { e.preventDefault(); this.link.openChat(); } else if (e.code === 'KeyJ') this.strip.toggle(); else this.toggleSpectate();
    });
  }

  get alive() { return !!this.actor && !this.actor.dead; }
  get places() { return PLACES; }

  // ---- Presence -----------------------------------------------------------------------------------------------------
  summon() {
    if (this.present) return;
    this.present = true;
    this.senses.start();
    this.wantsBody = true;
    this.refreshButton();
  }

  dismiss() {
    if (!this.present) return;
    this.stopTicker();
    if (this.spectating) this.stopSpectating();
    this.leaveRide();
    if (this.actor && this.game.actors.actors.includes(this.actor)) this.game.actors.remove(this.actor);
    this.actor = null;
    this.stow(this.car, true);
    this.stow(this.heli, true);
    this.fight = null;
    this.order = this.trip = null;
    this.present = false;
    this.wantsBody = false;
    this.deadAt = null;
    this.senses.stop();
    this.tag.hidden = true;
    this.refreshButton();
  }

  spawnBody(x, z, heading = 0) {
    const g = this.game;
    const s = g.safeSpot(x, z, 0.6);
    const a = g.actors.spawn({ x: s.x, z: s.z, heading, look: LOOK, team: 'architect', weapon: 'rifle', hp: HP, armor: ARMOR,
      behavior: 'idle', hostile: false, accuracy: 0.42, alert: false, name: 'L’Architecte' });
    if (!a) return null;
    a.architect = true;
    a.pilot = (actor, dt) => this.pilot(actor, dt);
    a.onHurt = (amount, cause) => this.onHurt(amount, cause);
    a.model.setWeapon(null);
    this.actor = a;
    this.deadAt = null;
    return a;
  }

  // Where he turns up: in view, ahead and to one side of the player; or, back from the dead, behind them, out of sight
  // On a sidewalk when there is one in reach, never in the middle of the avenue
  arrivalSpot(distance, inView = true) {
    const g = this.game, pl = g.player;
    const side = Math.random() < 0.5 ? -1 : 1;
    const base = g.camera.footYaw + (inView ? 0 : Math.PI);
    const turns = inView ? [0.55, -0.55, 0.9, -0.9, 0.3, -0.3, 1.3, -1.3] : [0, 0.4, -0.4, 0.8, -0.8];
    let first = null;
    for (const scale of [1, 0.7, 1.4]) for (const turn of turns) {
      const angle = base + side * turn;
      const spot = { x: pl.x + Math.sin(angle) * distance * scale, z: pl.z + Math.cos(angle) * distance * scale, heading: angle + Math.PI };
      first ??= spot;
      if (g.controllers.isPointOnSidewalk?.(spot.x, spot.z)) return spot;
    }
    return first;
  }

  // ---- Orders (the QA panel today, Claude tomorrow) ----------------------------------------------------------------
  goTo(x, z, { by = 'auto', label = '' } = {}) {
    this.order = { kind: 'goto', x, z, by, label: label || getLocationLabel(x, z) || 'sa destination' };
    this.planTrip();
  }

  goToPlace(id, by = 'auto') {
    const p = PLACES.find((q) => q.id === id);
    if (p) this.goTo(p.x, p.z, { by, label: p.label });
  }

  follow() { this.order = { kind: 'follow' }; this.planTrip(); }

  // A fresh trip record: how it goes, and the stuck watch's bookkeeping
  newTrip(fields) { return { stuckT: 0, checkT: 0, lastX: NaN, lastZ: NaN, stuck: 0, ...fields }; }
  patrol() { this.order = { kind: 'patrol', visits: 0 }; this.nextPatrolStop(); }
  stop() { this.order = { kind: 'idle' }; this.planTrip(); }

  nextPatrolStop() {
    const here = this.focus();
    const choices = PLACES.filter((p) => Math.hypot(p.x - here.x, p.z - here.z) > 150);
    const p = pick(choices.length ? choices : PLACES);
    this.order = { kind: 'patrol', x: p.x, z: p.z, by: 'auto', label: p.label, visits: (this.order?.visits ?? 0) + 1 };
    this.planTrip();
  }

  say(text, seconds = 4) {
    this.game.hud.say(NAME, text, seconds);
    this.lastLine = { text, until: this.game.clock + seconds };
  }

  // How to carry out the order from where he is
  planTrip() {
    const o = this.order;
    this.trip = null;
    if (!o || !this.alive) return;
    if (o.kind === 'idle') { this.leaveRide(); this.intent = 'Observe'; return; }
    if (o.kind === 'follow') { this.trip = this.newTrip({ kind: 'follow', replanT: 0 }); this.intent = 'Te suit'; return; }
    const here = this.focus();
    const d = Math.hypot(o.x - here.x, o.z - here.z);
    let by = o.by === 'auto' ? (d < FOOT_MAX ? 'foot' : d < CAR_MAX ? 'car' : 'heli') : o.by;
    // already in a vehicle that suits: keep it (a helicopter in the air always flies on)
    if (this.ride === this.car && by === 'foot' && d > 60) by = 'car';
    if (this.ride === this.heli && this.airborne()) by = 'heli';
    this.startTrip(by, o.x, o.z);
    this.intent = `En route vers ${o.label} ${BY_LABEL[by]}`;
  }

  startTrip(by, x, z, fields = {}) {
    if (by !== 'car' && this.ride === this.car) this.leaveRide();
    if (by !== 'heli' && this.ride === this.heli) this.leaveRide();
    this.trip = this.newTrip({ by, x, z, phase: 'start', ...fields });
    if (by === 'foot' && !this.ride) this.walkTo(x, z);
  }

  airborne() {
    const h = this.heli;
    return h.position.y > this.game.controllers.roofHeight(h.position.x, h.position.z, h.position.y - 0.25, 2) + 2;
  }

  // ---- Every frame ------------------------------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    if (!this.reproDone && g.playing) { this.reproDone = true; this.applyRepro(); }
    this.resumeFrame();
    this.link.frameTick();
    if (g.frames === 6) {
      // the pools have been drawn: back in the garage, out of sight
      if (!this.ride) this.car.mesh.visible = false;
      if (this.ride !== this.heli) this.heli.mesh.visible = false;
    }
    if (!this.present) return;
    if (this.wantsBody && g.playing && dt > 0) {
      const s = this.arrivalSpot(8);
      if (this.spawnBody(s.x, s.z, s.heading)) {
        this.wantsBody = false;
        this.follow();
        this.takeCameraIfAsked();
        this.say(this.grudge ? 'Je suis là. Et je me souviens de toi.' : 'Je suis là. Fais comme si je n’existais pas.');
        this.emit('presence', 'Te voilà dans la partie, près du joueur.');
      }
    }
    if (dt > 0 && this.actor) this.live(dt);
    this.spin(dt);
    this.senses.update(dt, this.bodies());
    this.updateTag();
  }

  live(dt) {
    const g = this.game, a = this.actor;
    if (a.dead) { this.onDeath(); return; }
    // Something swept his living body away (a mission clean-up, a QA script): he comes straight back
    if (!this.ride && !g.actors.actors.includes(a)) {
      this.actor = null;
      if (this.spawnBody(a.x, a.z, a.heading)) this.planTrip();
      else this.respawnAt = g.clock + 1;
      return;
    }
    if (g.invulnerable < 1e8 && this.spectating) g.invulnerable = 1e9;
    if (g.stats.shots !== this.shots) { this.shots = g.stats.shots; this.lastPlayerShot = g.clock; }
    if (this.ride === this.car) {
      // shooting at his car is shooting at him
      if (this.car.hp < (this.rideHp ?? 300) && g.clock - (this.lastPlayerShot ?? -9) < 0.6) this.provoked((this.rideHp ?? 300) - this.car.hp, 'shot');
      this.rideHp = this.car.hp;
      if (this.car.destroyed || this.car.burnT > 0) {
        const c = this.car.position;
        this.senses.report('accident', { who: 'architecte', x: c.x, y: c.y, z: c.z, detail: `Sa voiture est hors d’usage (${Math.round(Math.abs(this.car.speed) * 3.6)} km/h au moment du constat).` });
        this.bailOut();
      }
    }
    if (this.fight) this.fightFrame(dt);
    else if (this.trip) this.tripFrame(dt);
    else this.idleFrame(dt);
    if (this.spectating) this.steerView(dt);
    // vehicles left far behind go back to his garage
    if (this.ride !== this.car) this.stow(this.car);
    if (this.ride !== this.heli) this.stow(this.heli);
  }

  // Called by the actor system in place of its own decisions, unless he is fighting on foot
  pilot(a, dt) {
    if (this.fight && !this.fight.driving) return false;
    const m = this.move;
    a.rig.aim = null;
    a.rig.crouchTarget = 0;
    a.rig.reloading = -1;
    a.height = 1.85;
    this.game.actors.step(a, dt, m.mx, m.mz, m.speed, m.face);
    return true;
  }

  idleFrame(dt) {
    const m = this.move, a = this.actor;
    m.mx = m.mz = m.speed = 0;
    if (this.ride) return;
    // looks around, slowly
    this.lookT = (this.lookT ?? 0) - dt;
    if (this.lookT <= 0) { this.lookT = 3 + Math.random() * 4; this.lookAt = a.heading + (Math.random() - 0.5) * 2.2; }
    m.face = this.lookAt ?? a.heading;
  }

  tripFrame(dt) {
    const t = this.trip;
    if (t.kind === 'follow') { this.followFrame(dt); return; }
    if (t.kind === 'inspect') {
      this.idleFrame(dt);
      t.left -= dt;
      if (t.left <= 0) { if (this.order?.kind === 'patrol') this.nextPatrolStop(); else this.trip = null; }
      return;
    }
    if (t.by === 'foot') {
      if (this.walkFrame(dt)) this.arrive();
      return;
    }
    if (t.by === 'car') { this.carTrip(dt, t); return; }
    if (t.by === 'heli') this.heliTrip(dt, t);
  }

  arrive() {
    const o = this.order;
    this.trip = null;
    this.move.speed = 0;
    if (o?.kind === 'follow') { this.trip = this.newTrip({ kind: 'follow', replanT: 0 }); return; }
    if (!o || o.kind === 'goto') { this.intent = o ? `Inspecte ${o.label}` : 'Observe'; this.order = o ? { kind: 'idle' } : null; if (o) this.emit('arrive', `Arrivé : ${o.label} (${this.addressAt(this.focus().x, this.focus().z)}).`); return; }
    if (o.kind === 'patrol') { this.trip = { kind: 'inspect', left: 7 + Math.random() * 5 }; this.intent = `Inspecte ${o.label}`; this.emit('arrive', `Arrivé : ${o.label}.`); }
  }

  // ---- On foot -------------------------------------------------------------------------------------------------------
  // Along the sidewalks: the street route, set off to one side of each street by its half width and a bit more
  walkTo(x, z, pace = null) {
    const a = this.actor;
    const d = Math.hypot(x - a.x, z - a.z);
    this.path = d < 45 ? [{ x, z }] : this.sidewalkPath(a.x, a.z, x, z);
    this.wp = 0;
    this.pace = pace ?? (d > 120 ? JOG : WALK);
  }

  sidewalkPath(x0, z0, x1, z1) {
    const g = this.game;
    const route = g.nav.route(x0, z0, x1, z1, 6000);
    const nodes = route ? route.filter((r) => r.node !== undefined) : [];
    if (nodes.length < 2) return [{ x: x1, z: z1 }];
    const edges = this.edgeIndex();
    const pts = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      const A = nodes[i], B = nodes[i + 1];
      const len = Math.hypot(B.x - A.x, B.z - A.z);
      if (len < 1) continue;
      const ux = (B.x - A.x) / len, uz = (B.z - A.z) / len;
      const rx = uz, rz = -ux;
      const e = edges.get(A.node < B.node ? `${A.node},${B.node}` : `${B.node},${A.node}`);
      const off = (e?.half ?? 6) + 2.4;
      const into = Math.min(off, len * 0.45);
      pts.push({ x: A.x + rx * off + ux * into, z: A.z + rz * off + uz * into });
      pts.push({ x: B.x + rx * off - ux * into, z: B.z + rz * off - uz * into });
    }
    pts.push({ x: x1, z: z1 });
    // the first sidewalk point may be behind him: start from the nearest one ahead
    let best = 0, bd = Infinity;
    for (let i = 0; i < Math.min(4, pts.length); i++) {
      const d = Math.hypot(pts[i].x - x0, pts[i].z - z0);
      if (d < bd) { bd = d; best = i; }
    }
    return pts.slice(best);
  }

  edgeIndex() {
    if (this.edges) return this.edges;
    const g = this.game;
    const index = new Map(g.nav.nodes.map((n, i) => [n, i]));
    this.edges = new Map();
    for (const e of g.traffic.network.edges) {
      const a = index.get(e.from), b = index.get(e.to);
      if (a === undefined || b === undefined) continue;
      this.edges.set(a < b ? `${a},${b}` : `${b},${a}`, e);
    }
    return this.edges;
  }

  // One step along the path; true once there
  walkFrame(dt) {
    const a = this.actor, m = this.move, p = this.path;
    if (!p?.length) { m.speed = 0; return true; }
    let w = p[this.wp];
    while (this.wp < p.length - 1 && Math.hypot(w.x - a.x, w.z - a.z) < 1.8) w = p[++this.wp];
    const dx = w.x - a.x, dz = w.z - a.z, d = Math.hypot(dx, dz);
    if (this.wp === p.length - 1 && d < 1.2) { m.speed = 0; return true; }
    m.mx = dx / (d || 1); m.mz = dz / (d || 1);
    m.speed = this.wp === p.length - 1 ? Math.min(this.pace, 0.6 + d * 0.8) : this.pace;
    m.face = Math.atan2(m.mx, m.mz);
    this.watchStuck(dt, a.x, a.z, 0.8, () => {
      // round whatever holds him: back to the route from here, then a short hop past it
      const t = this.trip;
      if (t && t.stuck >= 2) {
        const s = this.game.safeSpot(a.x + m.mx * 3, a.z + m.mz * 3, 0.5);
        this.place(s.x, s.z, a.heading);
      } else if (t?.x !== undefined) this.walkTo(t.x, t.z, this.pace);
    }, 'à pied');
    return false;
  }

  // No headway for six seconds: an event for the log and a way out
  watchStuck(dt, x, z, minMove, recover, how) {
    const t = this.trip ?? (this.stuckProbe ??= { stuckT: 0, checkT: 0, lastX: NaN, lastZ: NaN, stuck: 0 });
    t.checkT -= dt;
    if (t.checkT > 0) return;
    t.checkT = 2;
    const moved = Math.hypot(x - t.lastX, z - t.lastZ);
    t.lastX = x; t.lastZ = z;
    if (!(moved < minMove)) { t.stuckT = 0; return; }
    t.stuckT += 2;
    if (t.stuckT < 6) return;
    t.stuckT = 0;
    t.stuck++;
    const y = this.focus().y;
    this.senses.report('coince', { who: 'architecte', x, y, z, detail: `L’Architecte n’avance plus (${how}) depuis 6 s, ${t.stuck}ᵉ fois sur ce trajet.` });
    recover();
  }

  place(x, z, heading) {
    const a = this.actor, g = this.game;
    a.x = x; a.z = z; a.heading = heading;
    a.y = g.controllers.getGroundHeight(x, z, 'person');
    a.vx = a.vz = 0;
    a.rig.reset(x, z, heading, (c, px, pz) => c.getGroundHeight(px, pz, 'person', a.y + 0.5), g.controllers);
  }

  // ---- His car -------------------------------------------------------------------------------------------------------
  carTrip(dt, t) {
    const g = this.game, car = this.car, a = this.actor;
    if (t.phase === 'start') {
      if (this.ride !== car) {
        if (this.ride) this.leaveRide();
        this.bringCar(a.x, a.z, Math.atan2(t.x - a.x, t.z - a.z));
        const door = this.doorOf(car);
        this.walkTo(door.x, door.z, JOG);
        t.phase = 'toCar';
      } else t.phase = 'drive';
    }
    if (t.phase === 'toCar') {
      if (this.walkFrame(dt) || Math.hypot(a.x - car.position.x, a.z - car.position.z) < 2.4) { this.board(car); t.phase = 'drive'; }
      return;
    }
    if (t.phase === 'drive') {
      car.driver.setGoal(t.x, t.z);
      car.driver.update(dt, { stopAt: 9 });
      this.watchStuck(dt, car.position.x, car.position.z, 1.5, () => {
        if (t.stuck >= 3) { this.leaveRide(); t.by = 'foot'; this.walkTo(t.x, t.z, JOG); this.updateIntent('foot'); }
        else car.driver.setGoal(t.x, t.z, true);
      }, 'en voiture');
      if (car.driver.arrived && Math.abs(car.speed) < 1.2) {
        this.leaveRide();
        t.by = 'foot';
        this.walkTo(t.x, t.z);
      }
    }
  }

  // His car, out of the garage onto the street nearest (x, z)
  bringCar(x, z, heading) {
    const g = this.game, car = this.car;
    const n = g.nav.nearest(x, z, 200);
    const node = n >= 0 ? g.nav.nodes[n] : { x, z };
    const spot = g.safeSpot(node.x + Math.cos(heading) * 2, node.z - Math.sin(heading) * 2, 1.4);
    car.destroyed = false; car.crashed = false; car.burnT = 0; car.hp = 300; car.fallen = false;
    car.vx = car.vz = car.angularVel = 0;
    car.position.set(spot.x, 0, spot.z);
    car.prevX = spot.x; car.prevZ = spot.z;
    car.heading = heading;
    if (car.body) { settleBody(car, heading); repairBody(car); }
    car.speed = 0;
    car.mesh.visible = true;
    if (!g.fleet.includes(car)) g.fleet.push(car);
    car.driver ??= new AIDriver(g.controllers, g.nav, car, { maxSpeed: CRUISE, corner: 8, traffic: g.traffic.vehicles });
    car.driver.others = g.allCars;
    car.driver.path = null;
    car.driver.aggressive = false;
    car.driver.maxSpeed = CRUISE;
  }

  doorOf(car) {
    const h = car.heading;
    return { x: car.position.x + Math.cos(h) * 1.7, z: car.position.z - Math.sin(h) * 1.7 };
  }

  board(vehicle) {
    const g = this.game, a = this.actor;
    const i = g.actors.actors.indexOf(a);
    if (i >= 0) g.actors.actors.splice(i, 1);
    a.model.update(false);
    this.ride = vehicle;
    this.rideHp = vehicle.hp;
    if (vehicle === this.car) vehicle.ai = { mode: 'architect' };
    this.senses.quiet(1);
  }

  // Out of whatever he drives or flies, beside it
  leaveRide() {
    const v = this.ride, g = this.game, a = this.actor;
    if (!v) return;
    this.ride = null;
    if (v === this.car) { v.ai = null; v.speed = 0; }
    if (v === this.heli) { v.speed = 0; v.verticalSpeed = 0; }
    if (!a) return;
    const side = v === this.heli ? 3.2 : 1.7;
    const s = g.safeSpot(v.position.x + Math.cos(v.heading) * side, v.position.z - Math.sin(v.heading) * side, 0.5);
    this.place(s.x, s.z, v.heading);
    if (!a.dead && !g.actors.actors.includes(a)) g.actors.actors.push(a);
  }

  bailOut() {
    const a = this.actor, g = this.game, t = this.trip;
    this.leaveRide();
    if (a && !a.dead) g.actors.damage(a, 35, 0, 0, 'explosion');
    if (t?.by !== 'car' || !this.alive) return;
    // the rest of the way on foot, or by air when it is still far
    const far = Math.hypot(t.x - a.x, t.z - a.z) > 500;
    this.startTrip(far ? 'heli' : 'foot', t.x, t.z);
    if (!far) this.pace = RUN;
    this.updateIntent(far ? 'heli' : 'foot');
  }

  updateIntent(by) {
    const o = this.order;
    if (o?.kind === 'goto' || o?.kind === 'patrol') this.intent = `En route vers ${o.label} ${BY_LABEL[by]}`;
  }

  // Back in his garage once he is far from it (or at once)
  stow(vehicle, now = false) {
    const g = this.game;
    const visible = vehicle === this.car ? g.fleet.includes(vehicle) : vehicle.mesh.visible && vehicle.position.y > -50;
    if (!visible) return;
    const f = this.focus();
    const far = Math.hypot(vehicle.position.x - f.x, vehicle.position.z - f.z) > STOW_DISTANCE;
    if (!now && !far) return;
    if (vehicle === this.car) { vehicle.ai = null; g.removeFleetCar(vehicle); }
    else { g.park(vehicle); vehicle.mesh.visible = false; vehicle.mesh.updateMatrixWorld(); }
  }

  // ---- His helicopter ------------------------------------------------------------------------------------------------
  heliTrip(dt, t) {
    const g = this.game, h = this.heli, a = this.actor;
    if (t.phase === 'start') {
      if (this.ride !== h) {
        // his helicopter waits for him overhead, clear of the traffic, and takes him up at once
        if (this.ride) this.leaveRide();
        const above = Math.max(a.y, g.controllers.roofHeight(a.x, a.z, a.y + 0.5, 0.6)) + 14;
        h.position.set(a.x, above, a.z);
        h.heading = Math.atan2(t.x - a.x, t.z - a.z);
        h.speed = 0; h.verticalSpeed = 0; h.pitchAngle = 0; h.rollAngle = 0;
        h.rotorSpin = 1;
        h.mesh.visible = true;
        this.board(h);
      }
      t.phase = 'climb';
      const land = g.safeSpot(t.x, t.z, 7);
      t.landX = land.x; t.landZ = land.z;
      t.cruise = HELI_FLOOR;
    }
    this.fly(dt, t);
    if (t.phase === 'landed') {
      this.leaveRide();
      // it leaves as it came: no cabin in front of his camera or his photos
      this.stow(this.heli, true);
      t.by = 'foot';
      this.walkTo(t.x, t.z);
    }
  }

  // Over the roofs, not above them all: the height he holds is the tallest roof of the next few hundred metres on his
  // course plus a margin, so he climbs for a tower and comes back down after it. Straight up out of the street first,
  // straight down onto the landing spot at the end.
  fly(dt, t) {
    const h = this.heli, c = this.game.controllers;
    const dx = t.landX - h.position.x, dz = t.landZ - h.position.z, d = Math.hypot(dx, dz);
    let wantSpeed = 0, wantVert = 0;
    const floor = c.roofHeight(h.position.x, h.position.z, h.position.y - 0.25, 2) + 0.25;
    t.scanT = (t.scanT ?? 0) - dt;
    if (t.scanT <= 0) {
      t.scanT = 0.4;
      const course = Math.atan2(dx, dz), sin = Math.sin(course), cos = Math.cos(course);
      let near = c.roofHeight(h.position.x, h.position.z, 2000, 12), far = 0;
      for (const ahead of [25, 60, 110, 180, 260]) {
        if (ahead > d + 40) break;
        const top = c.roofHeight(h.position.x + sin * ahead, h.position.z + cos * ahead, 2000, 12);
        if (ahead <= 60) near = Math.max(near, top); else far = Math.max(far, top);
      }
      // up at once for what is ahead, back down gently once past it
      const want = Math.max(HELI_FLOOR, near + 35, far + 35);
      t.cruise = want >= (t.cruise ?? 0) ? want : Math.max(want, t.cruise - 5);
      t.nearTop = near;
    }
    if (t.phase === 'climb') {
      wantVert = HELI_CLIMB;
      if (h.position.y > Math.min(t.cruise, floor + 30) - 3) t.phase = 'cruise';
    } else if (t.phase === 'cruise') {
      const below = t.cruise - h.position.y;
      // a roof right ahead taller than him: nose up and slow down until clear of it
      wantSpeed = h.position.y < (t.nearTop ?? 0) + 15 ? 6 : Math.min(HELI_SPEED, 4 + d * 0.16);
      wantVert = Math.max(-7, Math.min(HELI_CLIMB, below * 0.9));
      if (d < 10 && Math.abs(h.speed) < 5) t.phase = 'descend';
    } else if (t.phase === 'descend') {
      wantSpeed = Math.min(4, d * 0.5);
      wantVert = -Math.min(13, 0.6 + (h.position.y - floor) * 0.6);
      if (h.position.y <= floor + 0.05) t.phase = 'landed';
    }
    if (t.phase !== 'climb') h.heading += angleTo(h.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 1.2);
    h.speed += Math.max(-14 * dt, Math.min(14 * dt, wantSpeed - h.speed));
    h.verticalSpeed += Math.max(-12 * dt, Math.min(12 * dt, wantVert - h.verticalSpeed));
    h.position.x += Math.sin(h.heading) * h.speed * dt;
    h.position.z += Math.cos(h.heading) * h.speed * dt;
    h.position.y = Math.max(floor, h.position.y + h.verticalSpeed * dt);
    if (h.position.y <= floor) h.verticalSpeed = Math.max(0, h.verticalSpeed);
    const pitch = (h.speed / HELI_SPEED) * 0.24, roll = -angleTo(h.heading, Math.atan2(dx, dz)) * 0.3;
    h.pitchAngle += (pitch - h.pitchAngle) * Math.min(1, dt * 4);
    h.rollAngle += (Math.max(-0.3, Math.min(0.3, roll)) - h.rollAngle) * Math.min(1, dt * 4);
    h.tiltPivot.rotation.x = h.pitchAngle;
    h.tiltPivot.rotation.z = h.rollAngle;
    this.watchStuck(dt, h.position.x + h.position.y, h.position.z, 1, () => { t.phase = t.phase === 'descend' ? 'landed' : 'climb'; }, 'en hélico');
  }

  spin(dt) {
    const h = this.heli;
    if (!h.mesh.visible) return;
    const flying = this.ride === h && h.position.y > 0.3 + this.game.controllers.getGroundHeight(h.position.x, h.position.z, 'person');
    h.rotorSpin = Math.max(0, Math.min(1, h.rotorSpin + dt * (this.ride === h || flying ? 0.8 : -0.35)));
    h.mainRotorPivot.rotation.y += dt * 24 * h.rotorSpin;
    h.tailRotorPivot.rotation.x += dt * 32 * h.rotorSpin;
    h.mesh.position.copy(h.position);
    h.mesh.rotation.y = h.heading;
    h.mesh.updateMatrixWorld();
  }

  // ---- Following the player ---------------------------------------------------------------------------------------
  followFrame(dt) {
    const g = this.game, pl = g.player, t = this.trip, a = this.actor, m = this.move;
    const f = this.focus();
    const d = Math.hypot(pl.x - f.x, pl.z - f.z);
    t.replanT -= dt;
    // Far: fly to them (the trip hands back to following once landed); in his car, drive after them
    if (this.ride === this.heli || (!this.ride && d > CAR_MAX)) {
      const s = g.safeSpot(pl.x, pl.z + 14, 7);
      this.startTrip('heli', s.x, s.z);
      return;
    }
    if (this.ride === this.car) {
      const car = this.car;
      if (d < 22 && !pl.inVehicle) { this.leaveRide(); this.path = null; return; }
      if (t.replanT <= 0) { t.replanT = 1; car.driver.setGoal(pl.x, pl.z); }
      car.driver.update(dt, { stopAt: pl.inVehicle ? 14 : 10 });
      return;
    }
    if ((d > 90 || (pl.inVehicle && d > 40)) && t.replanT <= 0) {
      t.replanT = 1;
      this.bringCar(a.x, a.z, Math.atan2(pl.x - a.x, pl.z - a.z));
      this.board(this.car);
      return;
    }
    if (d < 6) { this.idleFrame(dt); m.face = Math.atan2(pl.x - a.x, pl.z - a.z); return; }
    if (t.replanT <= 0 || !this.path) { t.replanT = 2.5; this.walkTo(pl.x, pl.z, d > 25 ? RUN : d > 12 ? JOG : WALK); }
    this.walkFrame(dt);
  }

  // ---- Fighting back ------------------------------------------------------------------------------------------------
  // Hurt: by the player? (their shot this frame, their fists, their car, their grenade)
  onHurt(amount, cause) {
    const g = this.game;
    const playerFired = g.stats.shots !== this.shots || g.clock - (this.lastPlayerShot ?? -9) < 0.6;
    const near = Math.hypot(g.player.x - this.actor.x, g.player.z - this.actor.z);
    const byPlayer = cause === 'melee' || cause === 'vehicle' || (cause === 'shot' && playerFired) || (cause === 'explosion' && near < 60);
    if (byPlayer) this.provoked(amount, cause);
  }

  provoked(amount, cause) {
    const g = this.game;
    if (!this.alive || g.state === 'dead') return;
    this.lastProvoked = g.clock;
    if (this.fight) { this.fight.lastHurt = g.clock; return; }
    if (this.spectating) this.stopSpectating();
    const recentWarning = g.clock - (this.warnedAt ?? -999) < 45;
    if (amount < 30 && !recentWarning && cause !== 'explosion') {
      this.warnedAt = g.clock;
      this.say(pick(WARN_LINES), 3.5);
      // he turns to face them, and holds their eye for a moment
      const a = this.actor;
      this.lookAt = this.move.face = Math.atan2(g.player.x - a.x, g.player.z - a.z);
      this.lookT = 4;
      this.emit('attaque', `Le joueur t’a attaqué (${cause === 'shot' ? 'tir' : cause === 'melee' ? 'coup' : cause === 'vehicle' ? 'voiture' : 'explosion'}). Ton corps l’a averti : « ${this.lastLine.text} »`);
      return;
    }
    this.startFight();
  }

  startFight() {
    const g = this.game, a = this.actor;
    this.grudge++;
    this.fight = { since: g.clock, lastHurt: g.clock, driving: false, gunT: 1, said: false };
    this.say(pick(FIGHT_LINES), 3);
    this.intent = 'Riposte';
    this.emit('combat', `Le joueur insiste : ton corps riposte (rancune ${this.grudge}).`);
    if (this.ride === this.heli) this.leaveRide();
    if (this.ride === this.car) { this.fight.driving = true; this.intent = 'Te prend en chasse'; }
    a.behavior = 'combat';
    a.hostile = true;
    a.alert = true;
    a.accuracy = 0.42;
    a.model.setWeapon('rifle');
  }

  fightFrame(dt) {
    const g = this.game, pl = g.player, f = this.fight, a = this.actor;
    const d = Math.hypot(pl.x - this.focus().x, pl.z - this.focus().z);
    if (g.state === 'dead') {
      if (!f.said) { f.said = true; f.wonAt = g.clock; this.say(pick(WIN_LINES), 4); this.emit('combat', 'Ton corps a abattu le joueur. Il réapparaît à l’hôpital, sans rien perdre.'); }
      if (g.clock - f.wonAt > 3) this.calm(false);
      return;
    }
    if (g.state === 'busted' || (g.clock - f.lastHurt > 20 && (d > 60 || !pl.threat))) { this.calm(true); return; }
    // They run: after them in his car, firing through the window; close and on foot, he gets out and fights
    if (!f.driving && ((pl.inVehicle && d > 40) || d > 75)) {
      this.bringCar(a.x, a.z, Math.atan2(pl.x - a.x, pl.z - a.z));
      this.board(this.car);
      f.driving = true;
      this.intent = 'Te prend en chasse';
      if (!f.chased) { f.chased = true; this.say(pick(CHASE_LINES), 3); }
    }
    if (f.driving) {
      const car = this.car;
      if (this.ride !== car) { f.driving = false; return; }
      if (d < 20 && !pl.inVehicle && Math.abs(car.speed) < 6) { this.leaveRide(); f.driving = false; return; }
      car.driver.aggressive = true;
      car.driver.maxSpeed = 40;
      car.driver.setGoal(pl.x + pl.vx * 0.6, pl.z + pl.vz * 0.6);
      car.driver.update(dt, { direct: d < 30, stopAt: pl.inVehicle ? 0 : 12 });
      f.gunT -= dt;
      if (f.gunT <= 0 && d < 34) {
        f.gunT = 0.5 + Math.random() * 0.6;
        g.lastHitBy = a; g.lastHitAt = g.clock;
        g.policeShot(car.position.x, car.position.y + 1.2, car.position.z, 0.3 * (1 - d / 55), 10);
      }
    }
  }

  calm(speak) {
    const a = this.actor;
    this.fight = null;
    if (this.ride === this.car) { this.car.driver.aggressive = false; this.car.driver.maxSpeed = CRUISE; }
    if (a && !a.dead) {
      a.behavior = 'idle'; a.hostile = false; a.alert = false; a.rig.aim = null;
      a.model.setWeapon(null);
    }
    if (speak) { this.say(pick(CALM_LINES), 3); this.emit('combat_fini', 'Le combat est fini : le joueur a renoncé.'); }
    this.planTrip();
  }

  onDeath() {
    const g = this.game;
    this.deadAt = g.clock;
    this.fight = null;
    this.grudge += 2;
    this.trip = null;
    this.intent = 'Hors service';
    if (this.spectating) this.stopSpectating();
    this.actor = null;
    this.move.speed = 0;
    this.respawnAt = g.clock + RESPAWN_AFTER;
    this.emit('mort', `Le joueur t’a tué. Tu reviens dans ${RESPAWN_AFTER} s (rancune ${this.grudge}).`);
  }

  // ---- "Leave him to work": the camera goes to him -------------------------------------------------------------------
  toggleSpectate() {
    if (this.spectating) { this.stopSpectating(); return; }
    const g = this.game;
    const refuse = (why) => { this.lastRefusal = why; g.toast('Laisse-le travailler', why); };
    if (!this.present) return refuse('Faites d’abord venir l’Architecte (menu pause).');
    if (!this.alive) return refuse('L’Architecte n’est pas encore revenu.');
    if (this.fight) return refuse('Pas pendant qu’il se bat avec vous.');
    if (g.wanted.level > 0) return refuse('Impossible avec la police à vos trousses.');
    if (g.director.current) return refuse('Impossible pendant une mission.');
    const parked = g.state === 'driving' && Math.abs(g.car.speed) < 1 && !g.car.air && !g.car.boat;
    if (g.state !== 'onFoot' && !parked) return refuse('Arrêtez-vous d’abord : à pied, ou véhicule à l’arrêt.');
    this.spectating = true;
    this.savedYaw = g.camera.footYaw;
    g.invulnerable = 1e9;
    g.controllers.resetInput();
    g.fireHeld = g.aimHeld = false;
    g.releasePointer?.();
    g.camera.spectate = () => this.viewEntity();
    g.camera.resetForTeleport?.();
    g.camera.initialized = false;
    for (const type of ['keydown', 'keyup', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'wheel', 'contextmenu']) window.addEventListener(type, this.blockInput, { capture: true });
    this.senses.quiet(4);
    if (!this.order || this.order.kind === 'follow' || this.order.kind === 'idle') this.patrol();
    this.watch.hidden = false;
    this.say('Je prends la main. Va te reposer.', 3);
    this.emit('camera', 'Le joueur te laisse la caméra : mode SEUL. Va où tu veux, la ville vit autour de toi.');
  }

  stopSpectating() {
    const g = this.game;
    if (!this.spectating) return;
    this.spectating = false;
    g.camera.spectate = null;
    g.camera.footYaw = this.savedYaw ?? g.camera.footYaw;
    g.camera.resetForTeleport?.();
    g.camera.initialized = false;
    g.invulnerable = 2;
    for (const type of ['keydown', 'keyup', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'wheel', 'contextmenu']) window.removeEventListener(type, this.blockInput, { capture: true });
    this.watch.hidden = true;
    this.senses.quiet(4);
    this.emit('camera', 'Le joueur reprend la main : mode ENSEMBLE. Reste près de lui.');
    if (this.alive && !this.fight) {
      const f = this.focus();
      if (Math.hypot(f.x - g.player.x, f.z - g.player.z) > 80) this.say('Je te rejoins.', 3);
      this.follow();
    }
  }

  // While he holds the camera, the player's controls stay quiet: only the menu, the map, the HUD, sound and L get through
  filterInput(e) {
    if (!this.spectating) return;
    if (e.type === 'keydown' || e.type === 'keyup') {
      if (isTypingInField(e) || KEYS_WHILE_WATCHING.has(e.code)) return;
      e.stopImmediatePropagation();
      return;
    }
    const target = e.target;
    if (target === this.game.camera.domElement || target === document.body || target === document.documentElement) e.stopImmediatePropagation();
  }

  // What the camera follows: his vehicle, or a stand-in walking with his body
  viewEntity() {
    if (this.ride) return this.ride;
    const v = this.view, a = this.actor;
    if (a) { v.position.set(a.x, a.y, a.z); v.heading = a.heading; v.speed = a.speed ?? 0; }
    return v;
  }

  // On foot, the camera swings round behind him as he walks
  steerView(dt) {
    const g = this.game;
    g.controllers.resetInput();
    if (this.ride || !this.actor) return;
    if ((this.actor.speed ?? 0) > 0.4) g.camera.footYaw += angleTo(g.camera.footYaw, this.actor.heading) * Math.min(1, dt * 1.6);
  }

  // The street corner the HUD names: his, while he holds the camera
  viewFocus() { return this.spectating ? this.focus() : null; }

  // Where he is (his vehicle when he is in one), or the player when he has no body
  focus() {
    const g = this.game;
    if (this.ride) return { x: this.ride.position.x, y: this.ride.position.y, z: this.ride.position.z, yaw: g.camera.footYaw };
    if (this.actor) return { x: this.actor.x, y: this.actor.y, z: this.actor.z, yaw: g.camera.footYaw };
    return { x: g.player.x, y: g.player.y, z: g.player.z, yaw: g.camera.footYaw };
  }

  // Bodies the senses watch besides the player
  bodies() {
    const g = this.game, out = [];
    if (this.actor && !this.ride && !this.actor.dead) {
      const a = this.actor;
      out.push({ who: 'architecte', x: a.x, y: a.y, z: a.z, ground: g.controllers.getGroundHeight(a.x, a.z, 'person', a.y + 0.6) });
    }
    if (this.ride === this.car) {
      const c = this.car.position;
      out.push({ who: 'voiture de l’Architecte', x: c.x, y: c.y, z: c.z, ground: g.controllers.getGroundHeight(c.x, c.z, 'car', c.y + 1), vehicle: true });
    }
    return out;
  }

  // Everything a mind would want to know, in one object (the QA panel, Claude tomorrow)
  state() {
    const f = this.focus();
    const a = this.actor;
    return {
      present: this.present, alive: this.alive, spectating: this.spectating,
      mode: this.ride === this.car ? 'voiture' : this.ride === this.heli ? 'hélico' : a ? 'à pied' : 'absent',
      order: this.order?.kind ?? null, intent: this.intent, fighting: !!this.fight, grudge: this.grudge,
      hp: a ? Math.max(0, Math.round(a.hp)) : 0, armor: a ? Math.round(a.armor) : 0,
      x: Math.round(f.x), y: Math.round(f.y), z: Math.round(f.z), address: getLocationLabel(f.x, f.z),
      respawnIn: this.respawnAt ? Math.max(0, Math.ceil(this.respawnAt - this.game.clock)) : null
    };
  }

  // ---- When the player leaves the game's tab ----------------------------------------------------------------------
  // A hidden tab gets no animation frames and the game pauses itself: with him in the game, he takes the camera instead
  // and a ticker in a worker (whose timers the browser leaves alone) runs the frame loop, so he keeps working.
  keepAlive(frame) {
    this.frame = frame;
    document.addEventListener('visibilitychange', () => (document.hidden ? this.onHidden() : this.onShown()));
  }

  onHidden() {
    if (!this.frame || !this.present) return;
    clearTimeout(this.hideTimer);
    // a quick look at another tab is not leaving
    this.hideTimer = setTimeout(() => {
      const g = this.game;
      if (!document.hidden || !this.present || !g.playing) return;
      if (!this.spectating && this.alive) {
        if (g.state === 'driving' && !g.car.air) { g.car.speed = 0; g.car.vx = g.car.vz = 0; }
        if (g.paused) g.setPaused(false);
        this.toggleSpectate();
        // a chase or a mission: the game stays paused, as it always did
        if (!this.spectating) { g.setPaused(true); return; }
        this.emit('camera', 'Le joueur a quitté l’onglet du jeu : tu prends la main, la partie continue en arrière-plan.');
      } else if (g.paused) g.setPaused(false);
      this.startTicker();
    }, 1500);
  }

  onShown() {
    clearTimeout(this.hideTimer);
    this.stopTicker();
  }

  startTicker() {
    if (!this.ticker) {
      const source = 'let t = null; onmessage = (e) => { clearInterval(t); t = e.data > 0 ? setInterval(() => postMessage(0), e.data) : null; };';
      this.ticker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
      this.ticker.onmessage = () => { if (document.hidden && this.ticking) this.frame(performance.now()); };
    }
    this.ticking = true;
    this.ticker.postMessage(33);
  }

  stopTicker() {
    this.ticking = false;
    this.ticker?.postMessage(0);
  }

  // ---- What his mind needs from the body (architect-link.js) -------------------------------------------------------
  emit(kind, text, data) { this.link?.event(kind, text, data); }

  addressAt(x, z) { return getLocationLabel(x, z) || `${Math.round(x)}, ${Math.round(z)}`; }

  // A picture of the frame about to be drawn: a JPEG data URL, or null if no frame comes (hidden tab)
  capture({ width = 1024, quality = 0.74 } = {}) {
    return new Promise((resolve) => {
      const job = { width, quality, resolve };
      this.captures.push(job);
      setTimeout(() => { const i = this.captures.indexOf(job); if (i >= 0) { this.captures.splice(i, 1); resolve(null); } }, 3000);
    });
  }

  // Called by main.js right after the frame is rendered, while it is still on the canvas
  afterRender(canvas) {
    const job = this.captures.shift();
    if (!job) return;
    try {
      const c = (this.captureCanvas ??= document.createElement('canvas'));
      c.width = job.width;
      c.height = Math.round(job.width * canvas.height / canvas.width);
      c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
      job.resolve(c.toDataURL('image/jpeg', job.quality));
    } catch {
      job.resolve(null);
    }
    this.senses.skipFrame();
  }

  // On foot, he turns to face `yaw` and holds it a while
  lookTowards(yaw) {
    this.lookAt = this.move.face = yaw;
    this.lookT = 6;
    if (this.trip?.kind === 'follow') this.order = { kind: 'idle' };
    if (!this.trip || this.trip.kind === 'follow') { this.trip = null; this.intent = 'Observe'; }
  }

  // An architect's power, for his own work and only while he holds the camera: there in an instant
  teleportSelf(x, z, heading = null, y = null) {
    this.leaveRide();
    this.stow(this.car, true);
    this.stow(this.heli, true);
    const s = this.game.safeSpot(x, z, 0.6);
    this.place(s.x, s.z, heading ?? this.actor.heading);
    // a photo taken on a roof is retaken on that roof
    if (y !== null && y > this.actor.y + 1.5) { this.actor.y = y; this.actor.rig.reset(s.x, s.z, this.actor.heading, (c, px, pz) => c.getGroundHeight(px, pz, 'person', y + 0.5), this.game.controllers); }
    if (heading !== null) this.lookTowards(heading);
    this.trip = null;
    this.order = { kind: 'idle' };
    this.intent = 'Observe';
    this.game.camera.resetForTeleport?.();
    this.game.camera.initialized = false;
    this.senses.quiet(4);
  }

  // He reloads the game (to load what the workshop fixed) and picks up where he was, camera in hand
  reloadSoon() {
    const f = this.focus();
    try { localStorage.setItem(RESUME_KEY, JSON.stringify({ t: Date.now(), x: f.x, z: f.z, heading: this.actor?.heading ?? 0 })); } catch { /* storage off */ }
    this.emit('rechargement', 'Le jeu se recharge.');
    setTimeout(() => location.reload(), 400);
  }

  resumeFrame() {
    const g = this.game;
    if (this.resumeChecked === undefined) {
      this.resumeChecked = true;
      try {
        const r = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null');
        localStorage.removeItem(RESUME_KEY);
        if (r && Date.now() - r.t < 3 * 60 * 1000) this.resume = r;
      } catch { /* storage off */ }
    }
    const r = this.resume;
    if (!r) return;
    if (!g.playing) { g.start(); return; }
    if (!this.present) { this.summon(); return; }
    if (!this.actor) return;
    if (!r.placed) { r.placed = true; this.place(...Object.values(this.game.safeSpot(r.x, r.z, 0.6)), r.heading); this.stop(); }
    this.resume = null;
    this.toggleSpectate();
    this.emit('rechargement', 'Le jeu s’est rechargé avec le code du moment : tu as repris ta place, caméra en main.');
  }

  // ---- Repro links ---------------------------------------------------------------------------------------------------
  applyRepro() {
    const r = parseRepro(location.search);
    if (!r) return;
    const g = this.game;
    g.teleportPlayer(r.x, r.z);
    const p = g.person;
    if (r.y > p.position.y + 1.5) {
      p.position.y = r.y;
      p.footing = r.y;
      p.rig.reset(r.x, r.z, p.heading, (c, x, z) => c.getGroundHeight(x, z, 'person', r.y + 0.5), g.controllers);
    }
    g.camera.footYaw = r.yaw;
    g.camera.orbitPitchOffset = r.pitch;
    if (r.hour !== null) g.atmosphere.setHour(r.hour);
    if (r.weather) {
      g.atmosphere.setWeather(r.weather, true);
      g.atmosphere.lockWeather = true;
      g.weatherMode = r.weather;
    }
    g.toast('Lien de reproduction', getLocationLabel(r.x, r.z) || `${Math.round(r.x)}, ${Math.round(r.z)}`);
  }

  // ---- Interface -----------------------------------------------------------------------------------------------------
  buildInterface() {
    // his own stylesheet: nothing of his reaches the game's CSS
    document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="./css/architect.css">');
    document.body.insertAdjacentHTML('beforeend', `
      <div id="architect-tag" class="architect-tag" hidden><b>L’ARCHITECTE</b><span></span></div>
      <div id="architect-watch" class="architect-watch" hidden><b>L’ARCHITECTE TRAVAILLE</b><span></span><em><kbd>L</kbd> reprendre la main</em></div>`);
    this.tag = document.getElementById('architect-tag');
    this.tagText = this.tag.querySelector('span');
    this.watch = document.getElementById('architect-watch');
    this.watchText = this.watch.querySelector('span');
    const options = document.getElementById('menu-options');
    if (options) {
      options.insertAdjacentHTML('beforeend', '<button id="architect-toggle">ARCHITECTE : ABSENT</button>');
      this.button = document.getElementById('architect-toggle');
      this.button.addEventListener('click', () => (this.present ? this.dismiss() : this.summon()));
    }
  }

  // Asked for the camera while absent or out of action (control room): he takes it as soon as he has a body
  takeCameraIfAsked() {
    if (!this.spectateWhenReady) return;
    this.spectateWhenReady = false;
    if (!this.spectating) this.toggleSpectate();
  }

  // The control room, one click from the pause menu
  addRoomLink() {
    const options = document.getElementById('menu-options');
    if (!options) return;
    options.insertAdjacentHTML('beforeend', `<a id="architect-room" href="${this.link.base}/" target="architecte-salle" rel="noopener">SALLE DE CONTRÔLE ↗</a>`);
  }

  refreshButton() {
    if (this.button) this.button.textContent = `ARCHITECTE : ${this.present ? 'PRÉSENT' : 'ABSENT'}${this.link?.connected ? '' : ' · CERVEAU HORS LIGNE'}`;
  }

  // The label over his head (or his vehicle), placed with a transform only: no layout, no repaint
  updateTag() {
    const g = this.game;
    const show = this.present && (this.actor || this.ride) && !this.actor?.dead;
    let text = this.intent;
    if (this.respawnAt && !this.actor) text = `Revient dans ${Math.max(0, Math.ceil(this.respawnAt - g.clock))} s`;
    if (this.watchText.textContent !== text) this.watchText.textContent = text;
    if (!show) { this.tag.hidden = true; this.respawnCheck(); return; }
    const f = this.focus();
    const lift = this.ride === this.heli ? 4.2 : this.ride ? 2.4 : 2.25;
    const cam = g.camera.camera;
    const v = (this._v ??= new THREE.Vector3()).set(f.x, f.y + lift, f.z);
    const dist = v.distanceTo(cam.position);
    v.project(cam);
    const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && dist < 160;
    this.tag.hidden = !visible;
    if (!visible) return;
    if (this.tagText.textContent !== text) this.tagText.textContent = text;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth, y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.tag.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${Math.max(0.7, Math.min(1, 30 / dist + 0.55)).toFixed(2)})`;
  }

  respawnCheck() {
    const g = this.game;
    if (!this.present || this.actor || this.respawnAt === undefined || this.respawnAt === null || g.clock < this.respawnAt || !g.playing) return;
    const s = this.arrivalSpot(55, false);
    if (this.spawnBody(s.x, s.z, s.heading)) {
      this.respawnAt = null;
      this.say(pick(BACK_LINES), 4);
      this.follow();
      this.takeCameraIfAsked();
      this.emit('revenu', 'Tu es de retour, près du joueur.');
    }
  }

  // His blip on the map, violet, whatever he is in
  drawMap(ctx, toX, toY) {
    if (!this.present || (!this.actor && !this.ride) || this.actor?.dead) return;
    const f = this.focus();
    const x = toX(f.x), y = toY(f.z);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#b48cff';
    ctx.strokeStyle = '#10140f';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-4.5, -4.5, 9, 9);
    ctx.strokeRect(-4.5, -4.5, 9, 9);
    ctx.restore();
  }
}

export { ArchitectSystem, PLACES };
