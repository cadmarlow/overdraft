import * as THREE from 'three/webgpu';
import { PLACES, STORY, ACTIVITIES } from './missions.js';
import { RoadNavigator } from './navigation.js';
import { WEAPONS } from './weapons.js';
import { AIDriver } from './ai-driver.js';

// Runs the mission scripts of missions.js: shows contacts, starts a mission when the player walks (or drives) into one,
// steps its generator every frame, enforces fail conditions and timers, and pays out.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

class MissionContext {
  constructor(director, def) {
    this.director = director;
    this.game = director.game;
    this.def = def;
    this.fails = [];
    this.cars = [];
    this.actorsSpawned = [];
    this.pickupsSpawned = [];
    this.npcCars = [];
    this.markersUsed = [];
    this.dt = 0;
    this.clock = 0;
  }

  // -- flow helpers (generators) --
  *wait(seconds) { let t = 0; while (t < seconds) { t += this.dt; yield; } }
  *waitFor(predicate) { while (!predicate()) yield; }
  *say(lines) {
    for (const [speaker, text] of lines) {
      const duration = clamp(text.length * 0.052 + 1.3, 2.6, 7.5);
      this.game.hud.say(speaker, text, duration);
      this.director.skip = false;
      let t = 0;
      while (t < duration && !this.director.skip) { t += this.dt; yield; }
    }
  }
  say1(speaker, text) { this.game.hud.say(speaker, text, clamp(text.length * 0.05 + 1.2, 2.4, 6)); }
  call(speaker, text) { this.game.hud.say(`☏ ${speaker}`, text, clamp(text.length * 0.055 + 1.5, 3, 8)); this.game.audio.ui('checkpoint', 0.5); }
  *countdown() {
    for (const n of ['3', '2', '1']) { this.game.hud.showBanner('', n, '', 0.9, 'pass'); this.game.audio.ui('checkpoint', 0.7); yield* this.wait(1); }
    this.game.hud.showBanner('', 'GO !', '', 0.9, 'pass');
    this.game.audio.ui('start');
  }
  *stopCar(car) {
    while (Math.abs(car.speed) > 0.8 && this.game.car === car && this.game.state === 'driving') {
      car.speed *= Math.exp(-this.dt * 2.5);
      yield;
    }
  }

  // -- world --
  place(name) { return PLACES[name]; }
  spot(x, z, r = 0.6) { return this.game.safeSpot(x, z, r); }
  objective(text) { this.game.hud.setObjective(text); }
  toast(title, sub) { this.game.toast(title, sub); }
  sound(kind) { this.game.audio.ui(kind); }
  gps(x, z) { this.game.gps(x, z); }
  near(x, z, r) { return Math.hypot(this.game.player.x - x, this.game.player.z - z) < r; }
  distanceTo(e) { const p = e.position || e; return Math.hypot(this.game.player.x - p.x, this.game.player.z - p.z); }
  inCar(car) { return this.game.state === 'driving' && this.game.car === car; }
  inAnyCar() { return this.game.state === 'driving' || this.game.state === 'entering' || this.game.state === 'exiting'; }
  onFoot() { return this.game.state === 'onFoot'; }

  mark(x, z, kind = 'objective', opts = {}) {
    const m = this.game.markers.add(x, z, { kind, ...opts });
    if (m) this.markersUsed.push(m);
    return m;
  }
  markOn(entity, kind = 'objective') {
    const m = this.game.markers.add(entity.position ? entity.position.x : entity.x, entity.position ? entity.position.z : entity.z, { kind, follow: entity, radius: 1 });
    if (m) this.markersUsed.push(m);
    return m;
  }
  unmark(m) { if (m) this.game.markers.remove(m); }

  spawnCar(kind, x, z, heading, paint, { label = '' } = {}) {
    const car = this.game.makeCar(kind, paint, new THREE.Vector3(x, 0, z), heading);
    car.mission = true;
    car.label2 = label;
    this.cars.push(car);
    return car;
  }
  removeCar(car, eject = true) {
    const g = this.game;
    if (g.car === car && (g.state === 'driving' || g.state === 'exiting' || g.state === 'entering')) {
      if (!eject) return;
      g.transition = null;
      g.person.inVehicle = false;
      const x = car.position.x + Math.cos(car.heading) * 2, z = car.position.z - Math.sin(car.heading) * 2;
      const s = g.safeSpot(x, z, 0.4);
      g.person.position.set(s.x, g.controllers.getGroundHeight(s.x, s.z, 'person'), s.z);
      g.state = 'onFoot';
      g.camera.footYaw = car.heading;
      g.onMode('person');
      g.radio?.setPlaying(false);
      document.body.dataset.gameState = g.state;
      g.updateKeybar();
    }
    g.removeFleetCar(car);
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
  }
  spawnActor(opts) {
    const a = this.game.actors.spawn(opts);
    if (a) { a.mission = true; this.actorsSpawned.push(a); }
    return a || { dead: true, x: opts.x, z: opts.z, alert: false };
  }
  pickup(kind, x, z, amount = 0) {
    const s = this.spot(x, z, 0.3);
    const item = this.game.pickups.add(kind, s.x, s.z, { amount });
    this.pickupsSpawned.push(item);
    return item;
  }
  giveWeapon(id, ammo) { this.game.giveWeapon(id, ammo); this.game.toast(WEAPONS[id].name, `${WEAPONS[id].sub} · ${ammo} munitions`); }

  // A road segment between two intersections, a lane's width off the centre line, for parked cars and meetings
  randomRoadSpot(x, z, min, max, onFoot = false) {
    const nav = this.game.nav;
    const nodes = nav.within(x, z, max);
    for (let k = 0; k < 60 && nodes.length; k++) {
      const i = nodes[Math.floor(Math.random() * nodes.length)];
      const n = nav.nodes[i];
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < min || !nav.links[i].length) continue;
      if (onFoot) {
        const s = this.spot(n.x + (n.hx || 8) + 3, n.z + (n.hz || 6) + 3, 0.5);
        return { x: s.x, z: s.z, heading: 0 };
      }
      const l = nav.links[i][Math.floor(Math.random() * nav.links[i].length)];
      const m = nav.nodes[l.to];
      const dx = m.x - n.x, dz = m.z - n.z, len = Math.hypot(dx, dz);
      if (len < 40) continue;
      const t = 0.4;
      const heading = Math.atan2(dx, dz);
      // keep right: +x of the heading frame is the driver's left
      const px = n.x + dx * t - Math.cos(heading) * 3.2, pz = n.z + dz * t + Math.sin(heading) * 3.2;
      return { x: px, z: pz, heading };
    }
    return { x: x + min, z, heading: 0 };
  }

  // The road lane nearest to (x, z): a point 40 % along one of its intersection's links, kept right
  roadSpotNear(x, z) {
    const nav = this.game.nav;
    const i = nav.nearest(x, z, 300);
    if (i < 0) return { x, z, heading: 0 };
    const n = nav.nodes[i];
    let best = null;
    for (const l of nav.links[i]) {
      const m = nav.nodes[l.to];
      const dx = m.x - n.x, dz = m.z - n.z, len = Math.hypot(dx, dz);
      if (len < 30) continue;
      const px = n.x + dx * 0.4, pz = n.z + dz * 0.4;
      const d = Math.hypot(px - x, pz - z);
      if (!best || d < best.d) best = { d, px, pz, heading: Math.atan2(dx, dz) };
    }
    if (!best) return { x: n.x, z: n.z, heading: 0 };
    return { x: best.px - Math.cos(best.heading) * 3.2, z: best.pz + Math.sin(best.heading) * 3.2, heading: best.heading };
  }

  raceRoute(x, z, length) {
    const nav = this.game.nav;
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const target = nav.nearest(x + Math.cos(a) * length * 0.55, z + Math.sin(a) * length * 0.55, 300);
      if (target < 0) continue;
      const n = nav.nodes[target];
      const route = nav.route(x, z, n.x, n.z, 15000);
      if (route && RoadNavigator.length(route) > length * 0.5) return route.filter((p, i) => i > 0);
    }
    return null;
  }

  // -- AI-driven cars (couriers, escorts, armoured vans, fleeing targets) --
  spawnNpcCar(kind, x, z, heading, paint, { label = '', hp = 100, maxSpeed = 17, corner = 8 } = {}) {
    const g = this.game;
    const car = this.spawnCar(kind, x, z, heading, paint, { label });
    car.locked = true;
    car.npc = true;
    car.hp = car.maxHp = hp;
    car.driver = new AIDriver(g.controllers, g.nav, car, { maxSpeed, corner, traffic: g.traffic.vehicles });
    car.driver.others = g.allCars;
    car.ai = { mode: 'stop' };
    this.npcCars.push(car);
    return car;
  }
  driveTo(car, x, z, { stopAt = 6, maxSpeed } = {}) { car.ai = { mode: 'goto', x, z, stopAt }; if (maxSpeed) car.driver.maxSpeed = maxSpeed; car.driver.setGoal(x, z, true); }
  escort(car, leader, distance = 14) { car.ai = { mode: 'escort', leader, distance }; }
  flee(car, maxSpeed = 30) { car.ai = { mode: 'flee' }; car.driver.maxSpeed = maxSpeed; }
  stopNpc(car) { car.ai = { mode: 'stop' }; }
  arrived(car) { return car.ai?.mode === 'goto' && Math.hypot(car.position.x - car.ai.x, car.position.z - car.ai.z) < car.ai.stopAt + 4 && Math.abs(car.speed) < 1.2; }
  disabled(car) { return car.destroyed || car.hp < (car.maxHp ?? 100) * 0.3; }
  // The crew climbs out of a stopped car (doors on both sides) and the car is free to take
  unload(car, list) {
    car.locked = false;
    this.stopNpc(car);
    return list.map((opts, i) => {
      const side = i % 2 ? -1 : 1;
      const h = car.heading;
      const s = this.spot(car.position.x + Math.cos(h) * 1.6 * side + Math.sin(h) * (i > 1 ? -1.2 : 0.4), car.position.z - Math.sin(h) * 1.6 * side + Math.cos(h) * (i > 1 ? -1.2 : 0.4), 0.4);
      return this.spawnActor({ heading: h, ...opts, x: s.x, z: s.z });
    });
  }

  // -- outcome --
  failIf(predicate, reason) { this.fails.push({ predicate, reason }); }
  clearFails() { this.fails.length = 0; }
  timer(seconds, reason) { this.director.timerLeft = seconds; this.director.timerReason = reason; }
  stopTimer() { this.director.timerLeft = null; this.game.hud.setTimer(null); }
  complete(reward, subtitle = '') { this.director.complete(reward, subtitle); }
  fail(reason) { this.director.fail(reason); }
}

class MissionDirector {
  constructor(game) {
    this.game = game;
    this.current = null;
    this.ctx = null;
    this.gen = null;
    this.contacts = [];
    this.timerLeft = null;
    this.cooldown = 2;
    this.skip = false;
    window.addEventListener('keydown', (e) => { if ((e.code === 'Enter' || e.code === 'NumpadEnter') && this.current) this.skip = true; });
  }

  get nextStory() { return STORY.find((m) => !this.game.missionsDone.includes(m.id)) || null; }

  available() {
    const list = [];
    const story = this.nextStory;
    if (story) list.push({ def: story, place: PLACES[story.contact], kind: 'contact', label: story.contactLabel, story: true });
    if (this.game.missionsDone.includes('courant')) {
      for (const a of ACTIVITIES) list.push({ def: a, place: PLACES[a.place], kind: 'race', label: a.contactLabel, story: false });
    }
    return list;
  }

  showContacts() {
    this.hideContacts();
    for (const c of this.available()) {
      // the story contact and an activity may share a place: offset activities a few metres
      const offset = c.story ? 0 : 5 + this.contacts.length * 3;
      const p = c.def.needsCar && c.place.road ? c.place.road : c.place;
      const s = this.game.safeSpot(p.x, p.z + offset, 0.5);
      const marker = this.game.markers.add(s.x, s.z, { kind: c.kind, radius: c.def.needsCar ? 4 : 1.6, height: 4, label: c.def.title });
      if (marker) this.contacts.push({ ...c, marker, x: s.x, z: s.z });
    }
  }

  hideContacts() {
    for (const c of this.contacts) this.game.markers.remove(c.marker);
    this.contacts.length = 0;
  }

  start(def) {
    const g = this.game;
    this.hideContacts();
    this.current = def;
    this.ctx = new MissionContext(this, def);
    this.gen = def.run(this.ctx);
    this.timerLeft = null;
    g.hud.missionTitle(def.title);
    g.hud.showBanner(def.act || 'ACTIVITÉ', def.title, '', 3.2, 'pass');
    g.audio.ui('start');
  }

  cleanup(keepCars = false) {
    const ctx = this.ctx;
    const g = this.game;
    if (!ctx) return;
    for (const m of ctx.markersUsed) g.markers.remove(m);
    for (const a of ctx.actorsSpawned) if (!a.dead && g.actors.actors.includes(a)) g.actors.remove(a);
    for (const it of ctx.pickupsSpawned) if (g.pickups.items.includes(it)) g.pickups.remove(it);
    for (const car of [...ctx.cars]) {
      if (g.car === car && g.state !== 'onFoot') { car.mission = false; continue; }
      if (!keepCars && !car.destroyed) g.removeFleetCar(car);
      else car.mission = false;
    }
    g.hud.setObjective('');
    g.hud.setTimer(null);
    g.hud.missionTitle('');
    g.gps(null);
    this.current = null;
    this.ctx = null;
    this.gen = null;
    this.timerLeft = null;
    this.cooldown = 4;
  }

  complete(reward, subtitle = '') {
    const g = this.game;
    const def = this.current;
    if (!def) return;
    g.addMoney(reward);
    if (STORY.includes(def) && !g.missionsDone.includes(def.id)) g.missionsDone.push(def.id);
    g.hud.showBanner(subtitle && subtitle.startsWith('FIN') ? subtitle : 'MISSION RÉUSSIE', def.title, `+${reward.toLocaleString('fr-FR')} $${subtitle && !subtitle.startsWith('FIN') ? ' · ' + subtitle : ''}`, 5, 'pass');
    g.audio.ui('pass');
    this.cleanup(true);
    g.shops?.place();
    g.save();
    if (def.id === 'courant') setTimeout(() => g.toast('Nouvelles activités', 'Courses, convoyages et primes apparaissent en orange sur la carte.'), 5200);
  }

  fail(reason, silent = false) {
    const g = this.game;
    const def = this.current;
    if (!def) return;
    if (!silent) {
      g.hud.showBanner('MISSION ÉCHOUÉE', def.title, reason, 4.5, 'fail');
      g.audio.ui('fail');
    }
    this.cleanup(false);
  }

  onPlayerDown(reason) {
    if (this.current) this.fail(reason, true);
  }

  update(dt) {
    const g = this.game;
    if (!this.current) {
      this.cooldown -= dt;
      if (!this.contacts.length && this.cooldown <= 0) this.showContacts();
      if (g.state === 'dead' || g.state === 'busted') return;
      for (const c of this.contacts) {
        const r = c.def.needsCar ? 5 : 2;
        if (Math.hypot(g.player.x - c.x, g.player.z - c.z) > r) continue;
        if (c.def.needsCar && g.state !== 'driving') { this.hint('Il faut un véhicule pour cette course.'); continue; }
        if (!c.def.needsCar && g.state !== 'onFoot') { this.hint('Descendez du véhicule pour parler au contact.'); continue; }
        if (c.def.needsWeapon && !Object.keys(g.weapons).some((id) => id !== 'fists')) { this.hint('Il vous faut une arme pour ce contrat.'); continue; }
        if (g.wanted.level > 0) { this.hint('Semez la police avant de commencer.'); continue; }
        this.start(c.def);
        break;
      }
      return;
    }
    const ctx = this.ctx;
    ctx.dt = dt;
    ctx.clock += dt;
    if (this.timerLeft !== null) {
      this.timerLeft -= dt;
      g.hud.setTimer(this.timerLeft);
      if (this.timerLeft <= 0) { this.fail(this.timerReason || 'Temps écoulé.'); return; }
    }
    for (const f of ctx.fails) {
      if (f.predicate()) { this.fail(f.reason); return; }
    }
    this.driveNpcs(dt);
    try {
      const r = this.gen.next();
      if (r.done && this.current) this.complete(0);
    } catch (error) {
      console.error('[mission]', error);
      this.fail('Erreur de mission.');
    }
  }

  // Mission cars with an AI driver: go somewhere, keep behind a leader, flee the player, or stop (also when disabled)
  driveNpcs(dt) {
    const g = this.game;
    for (const car of this.ctx.npcCars) {
      if (car.destroyed || !car.ai || (g.car === car && g.state !== 'onFoot')) continue;
      const ai = car.ai;
      const d = car.driver;
      if (car.hp < (car.maxHp ?? 100) * 0.3 && ai.mode !== 'stop') { car.ai = { mode: 'stop' }; car.locked = false; }
      if (ai.mode === 'goto') {
        d.update(dt, { stopAt: ai.stopAt });
      } else if (ai.mode === 'escort') {
        const L = ai.leader;
        if (!L || L.destroyed || L.ai?.mode === 'stop') { car.ai = { mode: 'stop' }; continue; }
        d.setGoal(L.position.x - Math.sin(L.heading) * ai.distance, L.position.z - Math.cos(L.heading) * ai.distance);
        d.maxSpeed = Math.max(6, Math.abs(L.speed) + (Math.hypot(L.position.x - car.position.x, L.position.z - car.position.z) - ai.distance) * 0.5);
        d.update(dt, { stopAt: 3 });
      } else if (ai.mode === 'flee') {
        // a goal far from the player, picked again whenever the player gets close to it or it is reached
        const goal = ai.goal;
        const reached = goal && Math.hypot(goal.x - car.position.x, goal.z - car.position.z) < 40;
        const cut = goal && Math.hypot(goal.x - g.player.x, goal.z - g.player.z) < Math.hypot(goal.x - car.position.x, goal.z - car.position.z) * 0.7;
        if (!goal || reached || cut) {
          const away = Math.atan2(car.position.x - g.player.x, car.position.z - g.player.z) + (Math.random() - 0.5) * 1.4;
          const i = g.nav.nearest(car.position.x + Math.sin(away) * 600, car.position.z + Math.cos(away) * 600, 400);
          ai.goal = i >= 0 ? { x: g.nav.nodes[i].x, z: g.nav.nodes[i].z } : { x: car.position.x, z: car.position.z };
          d.setGoal(ai.goal.x, ai.goal.z, true);
        }
        d.update(dt);
      } else {
        this.game.controllers.simulateCar(car, 0, 0, true, dt);
      }
    }
  }

  hint(text) {
    if (this.lastHint === text && performance.now() - this.hintAt < 6000) return;
    this.lastHint = text;
    this.hintAt = performance.now();
    this.game.toast(text, '');
  }
}

export { MissionDirector, MissionContext };
