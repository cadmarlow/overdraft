import { settleBody } from './car-physics.js';
import { attitude, vehicleSpeed } from './architect-retro.js';

// The Architect's experiments: scripted, measured tests his body runs alone (he holds the camera, so the city lives
// around him), with a repeatable setup and explicit validity: the live traffic and variable frame step are not frozen.
// A run returns its measures, a few photos from his eye
// and its exact settings (place included), which the server keeps (chantier/experiences/).
// - crash: his car drives straight into a parked car at a given speed; both cars are measured for three seconds.
// - explosion: a blast beside a parked car, watched from a safe distance; the car's response is measured.
// - bordure: he walks along the edge of a sidewalk; his feet, the ground the game computes and the ground drawn.
// - nuit: the same facade at 1 pm and 11 pm, same framing.

const deg = (r) => Math.round(r * 180 / Math.PI * 10) / 10;
const round = (v, k = 100) => Math.round(v * k) / k;
const GREY = 0x8a8f96;
const MAX_RUN_MS = 120000;
const WORLD_FIELDS = ['hour', 'weather', 'running', 'lockWeather', 'cloud', 'rain', 'storm', 'wet', 'nextWeather', 'flash', 'nextFlash'];

class ArchitectLab {
  constructor(architect) {
    this.architect = architect;
    this.game = architect.game;
    this.hooks = new Set();
    this.running = null;
  }

  // Every frame while an experiment runs (architect.update)
  frame(dt) {
    const a = this.architect;
    if (this.context && (!a.spectating || !a.alive || a.present === false)) this.cancel('Le mode Seul ou le corps n’est plus disponible.');
    for (const hook of [...this.hooks]) {
      try { hook(dt); } catch (e) { if (this.context?.hooks.has(hook)) this.cancel(e.message); else throw e; }
    }
  }

  every(fn, owned = true) {
    const context = owned ? this.context : null;
    this.hooks.add(fn);
    context?.hooks.add(fn);
    return () => { this.hooks.delete(fn); context?.hooks.delete(fn); };
  }

  check(context = this.context) {
    if (!context || context !== this.context || context.controller.signal.aborted) throw new Error(context?.reason || 'Expérience interrompue.');
  }

  defer(fn) { this.check(); this.context.cleanups.push(fn); }

  cleanup(context) {
    if (context.cleaned) return;
    context.cleaned = true;
    clearTimeout(context.timer);
    for (const fn of context.cleanups.reverse()) { try { fn(); } catch { /* best effort after death or removal */ } }
    for (const fn of context.hooks) this.hooks.delete(fn);
    context.hooks.clear();
    const g = this.game, atmosphere = g.atmosphere;
    if (atmosphere) {
      atmosphere.setHour(context.world.hour);
      atmosphere.setWeather(context.world.weather, true);
      Object.assign(atmosphere, context.world);
      g.weatherMode = context.weatherMode;
      // Restore derived state too: the next physics step and a paused game's last image must not retain the test's
      // wet-road grip, sun, rain shader or colour grade until another animation frame happens to arrive.
      atmosphere.update?.(0, false);
    }
  }

  cancel(reason = 'Expérience interrompue.') {
    const context = this.context;
    if (!context || context.controller.signal.aborted) return;
    context.reason = reason;
    context.controller.abort();
    this.cleanup(context);
  }

  guard(promise, context = this.context) {
    this.check(context);
    const signal = context.controller.signal;
    return new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(new Error(context.reason || 'Expérience interrompue.')); };
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then((value) => {
        signal.removeEventListener('abort', abort);
        try { this.check(context); resolve(value); } catch (e) { reject(e); }
      }, (e) => { signal.removeEventListener('abort', abort); reject(e); });
    });
  }

  shoot(pose, options) {
    this.check();
    return this.guard(this.architect.eye.shoot(pose, { ...options, signal: this.context.controller.signal }));
  }

  // Game seconds (they stop with the game, and run on in a hidden tab with his ticker)
  wait(seconds) {
    return this.guard(new Promise((resolve) => {
      let left = seconds;
      const off = this.every((dt) => { left -= dt; if (left <= 0) { off(); resolve(); } });
    }));
  }

  until(test, timeout) {
    return this.guard(new Promise((resolve) => {
      let left = timeout;
      const off = this.every((dt) => { left -= dt; const r = test(dt); if (r || left <= 0) { off(); resolve(!!r); } });
    }));
  }

  async run(input) {
    const a = this.architect;
    const refuse = (texte) => ({ ok: false, type: input.type, validite: 'incomplete', raisons: [texte], texte });
    if (!a.spectating) return refuse('Refusé : une expérience demande le mode Seul (le joueur doit te laisser la caméra).');
    if (this.running) return refuse(`Une expérience est déjà en cours (${this.running}).`);
    if (!a.alive) return refuse('Tu n’as pas de corps en ce moment.');
    const type = input.type;
    if (!['crash', 'explosion', 'bordure', 'nuit'].includes(type)) return refuse(`Expérience inconnue : ${type}.`);
    if (input.protocole !== undefined && input.protocole !== 1) return refuse('Version du protocole incompatible : le scénario doit être repris avec le protocole actuel.');
    if (input.trajet && (![input.trajet.x0, input.trajet.z0, input.trajet.x1, input.trajet.z1].every(Number.isFinite)
      || Math.hypot(input.trajet.x1 - input.trajet.x0, input.trajet.z1 - input.trajet.z0) < 10)) return refuse('Trajet invalide : deux points finis et au moins dix mètres sont nécessaires.');
    if (input.bord && (![input.bord.x, input.bord.z, input.bord.ux, input.bord.uz, input.bord.nx, input.bord.nz].every(Number.isFinite)
      || Math.abs(Math.hypot(input.bord.ux, input.bord.uz) - 1) > 0.01 || Math.abs(Math.hypot(input.bord.nx, input.bord.nz) - 1) > 0.01
      || Math.abs(input.bord.ux * input.bord.nx + input.bord.uz * input.bord.nz) > 0.01)) return refuse('Bordure invalide : position, direction et normale doivent être définies.');
    if (input.lieu && ![input.lieu.x, input.lieu.z, input.lieu.yaw].every(Number.isFinite)) return refuse('Lieu de comparaison invalide.');
    if (input.conditions && (!Number.isFinite(input.conditions.heure) || !['clear', 'cloudy', 'rain', 'storm'].includes(input.conditions.meteo))) return refuse('Conditions de rejeu invalides : heure et météo sont nécessaires.');
    this.running = type;
    const atmosphere = this.game.atmosphere;
    const world = Object.fromEntries(WORLD_FIELDS.filter((key) => key in atmosphere).map((key) => [key, atmosphere[key]]));
    if (Array.isArray(atmosphere.thunderQueue)) world.thunderQueue = [...atmosphere.thunderQueue];
    const context = this.context = { controller: new AbortController(), hooks: new Set(), cleanups: [], world, weatherMode: this.game.weatherMode };
    context.timer = setTimeout(() => this.cancel('Durée limite de deux minutes atteinte (partie en pause ou expérience bloquée).'), MAX_RUN_MS);
    const protocol = { revision: 1, version_jeu: this.game.buildVersion || 'inconnue', conditions: { heure: atmosphere.hour, meteo: atmosphere.weather }, trafic: 'actif_non_fige', pas_simulation: 'variable', eclairs: 'suspendus_pendant_mesure' };
    try {
      const conditions = input.conditions || { heure: atmosphere.hour, meteo: atmosphere.weather };
      if (Number.isFinite(conditions.heure)) atmosphere.setHour(conditions.heure);
      if (conditions.meteo) atmosphere.setWeather(conditions.meteo, true);
      atmosphere.running = false;
      atmosphere.lockWeather = true;
      // A random lightning flash would defeat the same-facade comparison and could leave delayed thunder behind it.
      atmosphere.flash = 0;
      atmosphere.nextFlash = MAX_RUN_MS / 1000 + 1;
      if (Array.isArray(atmosphere.thunderQueue)) atmosphere.thunderQueue = [];
      atmosphere.update?.(0, false);
      protocol.conditions = { heure: atmosphere.hour, meteo: atmosphere.weather };
      a.order = { kind: 'idle' };
      a.trip = null;
      a.intent = `Expérience : ${type}`;
      a.senses.quiet(3);
      const result = await this.guard(this[type](input), context);
      const expected = type === 'nuit' ? 2 : type === 'bordure' ? 3 : 4;
      const reasons = [...(result.raisons || [])];
      let validity = result.validite || (result.ok ? 'valide' : 'incomplete');
      if (!result.ok || (result.images?.length || 0) < expected) {
        validity = 'incomplete';
        reasons.push(!result.ok ? result.texte : `Preuve visuelle incomplète : ${result.images?.length || 0}/${expected} photos.`);
      }
      return { ...result, validite: validity, raisons: reasons, protocole: protocol, params: { ...result.params, conditions: protocol.conditions, protocole: protocol.revision } };
    } catch (e) {
      return { ok: false, type, validite: 'incomplete', raisons: [e.message], protocole: protocol, texte: `L’expérience est incomplète : ${e.message}` };
    } finally {
      this.cleanup(context);
      if (this.context === context) this.context = null;
      this.running = null;
      if (a.spectating && a.alive) a.intent = 'Observe';
    }
  }

  // A straight run of street near (x, z) at least `length` long, across intersections if need be: its two ends
  straight(x, z, length) {
    const edges = (this.game.traffic?.network?.edges || []).filter((e) => e.from && e.to);
    const from = new Map();
    for (const e of edges) (from.get(e.from) || from.set(e.from, []).get(e.from)).push(e);
    const dir = (e) => Math.atan2(e.to.x - e.from.x, e.to.z - e.from.z);
    let best = null, bd = Infinity;
    for (const e of edges) {
      const d = Math.hypot(e.from.x - x, e.from.z - z);
      if (d > 400 || d > bd) continue;
      // follow the edges that carry on in the same direction
      let end = e, len = Math.hypot(e.to.x - e.from.x, e.to.z - e.from.z);
      const h = dir(e);
      for (let k = 0; k < 8 && len < length; k++) {
        const next = (from.get(end.to) || []).find((n) => Math.abs(Math.atan2(Math.sin(dir(n) - h), Math.cos(dir(n) - h))) < 0.04);
        if (!next) break;
        end = next;
        len += Math.hypot(next.to.x - next.from.x, next.to.z - next.from.z);
      }
      if (len < length) continue;
      bd = d;
      best = { x0: e.from.x, z0: e.from.z, x1: end.to.x, z1: end.to.z, len };
    }
    return best;
  }

  // A pose for his eye looking at a point from beside it
  sidePose(px, py, pz, heading, side = 14, height = 2.4, fov = 55) {
    const rx = Math.cos(heading), rz = -Math.sin(heading);
    const x = px + rx * side, z = pz + rz * side, y = height;
    return { x, y, z, yaw: Math.atan2(px - x, pz - z), pitch: Math.atan2(py + 0.6 - y, side), fov };
  }

  lieu(x, y, z) {
    const a = this.architect;
    return { x: round(x, 10), y: round(y, 10), z: round(z, 10), adresse: a.addressAt(x, z) };
  }

  // A parked car of the street's own materials (no shader to compile mid-game)
  parkedCar(x, z, heading) {
    const g = this.game;
    // Game.makeCar recycles the oldest ordinary car when its fleet is full. A laboratory target must neither evict
    // the player's car nor enter the autosave: register this temporary body directly, using compiled traffic shaders.
    const car = g.controllers.createCarEntity({ kind: 'sedan', paint: GREY, lite: true });
    Object.assign(car, { mission: true, locked: true, hp: 100, burnT: 0, destroyed: false, heading, prevX: x, prevZ: z });
    car.position.set(x, 0, z);
    car.mesh.position.copy(car.position);
    car.mesh.rotation.y = heading;
    g.fleet.push(car);
    if (car.body) settleBody(car, heading);
    car.mesh.updateMatrixWorld();
    this.defer(() => g.removeFleetCar?.(car));
    return car;
  }

  measureCar(car) {
    const g = this.game, c = g.controllers;
    const m = { pitch: 0, roll: 0, tilt: 0, high: 0, speed: 0, x0: car.position.x, z0: car.position.z };
    const off = this.every(() => {
      const att = attitude(car);
      if (att) { m.pitch = Math.max(m.pitch, Math.abs(att.pitch)); m.roll = Math.max(m.roll, Math.abs(att.roll)); m.tilt = Math.max(m.tilt, att.tilt); }
      const ground = c.getGroundHeight(car.position.x, car.position.z, 'car');
      m.high = Math.max(m.high, car.position.y - ground);
      m.speed = Math.max(m.speed, vehicleSpeed(car));
    });
    return { m, stop: () => { off(); const att = attitude(car); m.endTilt = att ? att.tilt : 0; m.moved = Math.hypot(car.position.x - m.x0, car.position.z - m.z0); m.hp = car.hp; m.destroyed = !!car.destroyed; m.burning = car.burnT > 0; return m; } };
  }

  // ---- crash ------------------------------------------------------------------------------------------------------
  async crash(input) {
    const a = this.architect, g = this.game, eye = a.eye;
    const kmh = Math.max(30, Math.min(140, Number(input.vitesse) || 50)), v = kmh / 3.6;
    // the run-up a town car needs to reach the speed (about 3 m/s² from a standstill), with a margin
    const runup = Math.max(50, v * v / 4.5);
    const f = a.focus();
    const road = input.trajet || this.straight(f.x, f.z, runup + 40);
    if (!road) return { ok: false, texte: 'Pas de rue assez droite par ici pour cette vitesse.' };
    const len = Math.hypot(road.x1 - road.x0, road.z1 - road.z0), ux = (road.x1 - road.x0) / len, uz = (road.z1 - road.z0) / len;
    const heading = Math.atan2(ux, uz);
    const sx = road.x0 + ux * 8, sz = road.z0 + uz * 8;
    const tx = sx + ux * runup, tz = sz + uz * runup;
    a.teleportSelf(sx, sz, heading);
    await this.wait(0.6);
    const target = this.parkedCar(tx, tz, heading);
    const parked = { x: tx, z: tz };
    a.bringCar(sx, sz, heading);
    const car = a.car;
    car.position.set(sx, 0, sz); car.prevX = sx; car.prevZ = sz;
    a.board(car);
    this.defer(() => { if (a.ride === car) a.leaveRide(); a.stow(car, true); });
    a.senses.quiet(3);
    await this.wait(0.8);
    const before = await this.shoot(this.sidePose(tx, 0.6, tz, heading), { width: 1024 });
    let impact = null;
    // contact: nose to tail (the two half lengths), or the target set moving while he is upon it
    const reach = (car.tune?.halfL ?? 2.3) + (target.tune?.halfL ?? 2.3) + 0.4;
    const drive = this.every((dt) => {
      if (impact) return;
      const speed = Math.abs(car.speed || 0);
      const desired = Math.atan2(target.position.x - car.position.x, target.position.z - car.position.z);
      const delta = Math.atan2(Math.sin(desired - car.heading), Math.cos(desired - car.heading));
      g.controllers.simulateCar(car, speed < v - 0.4 ? 1 : 0.1, Math.max(-1, Math.min(1, delta * 2.3)), false, dt);
      car.mesh.position.copy(car.position);
      car.mesh.rotation.y = car.heading;
      const d = Math.hypot(target.position.x - car.position.x, target.position.z - car.position.z);
      if (d < reach || (Math.abs(target.speed || 0) > 1 && d < reach + 3)) impact = { speed: speed * 3.6, clock: g.clock, disturbed: Math.hypot(target.position.x - parked.x, target.position.z - parked.z) };
    });
    const hit = await this.until(() => impact, 30);
    drive();
    if (!hit) return { ok: false, texte: 'Pas de choc : la voiture n’a pas atteint la cible en 30 s.', lieu: this.lieu(tx, 0, tz) };
    const mt = this.measureCar(target), mc = this.measureCar(car);
    const brake = this.every((dt) => { g.controllers.simulateCar(car, Math.abs(car.speed || 0) > 0.5 ? -1 : 0, 0, false, dt); car.mesh.position.copy(car.position); car.mesh.rotation.y = car.heading; });
    const pose = this.sidePose(tx, 0.6, tz, heading);
    const shots = [before];
    await this.wait(0.15); shots.push(await this.shoot(pose));
    await this.wait(0.6); shots.push(await this.shoot(pose));
    await this.wait(2.0); shots.push(await this.shoot(pose));
    brake();
    const t = mt.stop(), c = mc.stop();
    a.leaveRide();
    const mesures = {
      vitesse_impact_kmh: round(impact.speed, 10),
      cible_vitesse_max_kmh: round(t.speed * 3.6, 10), cible_projetee_m: round(t.moved, 10), cible_hauteur_max_m: round(t.high), cible_tangage_max_deg: deg(t.pitch), cible_roulis_max_deg: deg(t.roll), cible_inclinaison_finale_deg: deg(t.endTilt),
      voiture_hauteur_max_m: round(c.high), voiture_tangage_max_deg: deg(c.pitch), voiture_roulis_max_deg: deg(c.roll), voiture_inclinaison_finale_deg: deg(c.endTilt), voiture_detruite: c.destroyed
    };
    const flags = [];
    if (impact.speed < kmh * 0.85) flags.push(`vitesse demandée non atteinte (${Math.round(impact.speed)} km/h sur ${kmh})`);
    if (impact.disturbed > 1) flags.push(`la cible avait déjà été déplacée de ${impact.disturbed.toFixed(1)} m (par le trafic ?) avant le choc : mesure à reprendre`);
    if (t.endTilt > Math.PI / 3) flags.push('la voiture percutée finit retournée');
    if (c.endTilt > Math.PI / 3) flags.push('sa voiture finit retournée');
    if (t.high > 1.5) flags.push(`la voiture percutée décolle de ${t.high.toFixed(1)} m`);
    if (c.pitch > 0.8) flags.push(`sa voiture se cabre à ${deg(c.pitch)}°`);
    return {
      ok: true, type: 'crash', validite: impact.speed < kmh * 0.85 || impact.disturbed > 1 ? 'perturbee' : 'valide', raisons: flags.filter((text) => /non atteinte|avant le choc/.test(text)), params: { vitesse: kmh, trajet: road }, lieu: this.lieu(tx, 0, tz), mesures, images: shots.filter(Boolean),
      texte: `Crash à ${Math.round(impact.speed)} km/h contre une berline garée (${a.addressAt(tx, tz)}). Cible : projetée de ${t.moved.toFixed(1)} m, ${Math.round(t.speed * 3.6)} km/h au plus, ${t.high.toFixed(2)} m de haut au plus, tangage ${deg(t.pitch)}°, roulis ${deg(t.roll)}°. Sa voiture : tangage ${deg(c.pitch)}°, roulis ${deg(c.roll)}°, ${c.high.toFixed(2)} m de haut au plus.${flags.length ? ` À noter : ${flags.join(' ; ')}.` : ' Rien d’aberrant dans les mesures.'}`
    };
  }

  // ---- explosion --------------------------------------------------------------------------------------------------
  async explosion(input) {
    const a = this.architect, g = this.game, eye = a.eye;
    const f = a.focus();
    const road = input.trajet || this.straight(f.x, f.z, 50);
    if (!road) return { ok: false, texte: 'Pas de rue par ici.' };
    const len = Math.hypot(road.x1 - road.x0, road.z1 - road.z0), ux = (road.x1 - road.x0) / len, uz = (road.z1 - road.z0) / len;
    const heading = Math.atan2(ux, uz);
    const cx = road.x0 + ux * len * 0.5, cz = road.z0 + uz * len * 0.5;
    // he stands well out of the blast, on the street, looking at the car
    a.teleportSelf(cx - ux * 26, cz - uz * 26, heading);
    await this.wait(0.6);
    const car = this.parkedCar(cx, cz, heading);
    await this.wait(1.2);
    const pose = this.sidePose(cx, 0.6, cz, heading, 18, 2.2);
    const shots = [await this.shoot(pose)];
    const m = this.measureCar(car);
    const hp0 = car.hp;
    const bx = cx + Math.cos(heading) * 2.2, bz = cz - Math.sin(heading) * 2.2;
    const disturbed = Math.hypot(car.position.x - cx, car.position.z - cz);
    const distance = Math.hypot(car.position.x - bx, car.position.z - bz);
    const movingBefore = vehicleSpeed(car);
    g.explode(bx, 0.8, bz, 1, 'npc');
    await this.wait(0.12); shots.push(await this.shoot(pose));
    await this.wait(0.5); shots.push(await this.shoot(pose));
    await this.wait(2.2); shots.push(await this.shoot(pose));
    const r = m.stop();
    const mesures = {
      distance_souffle_m: round(distance), distance_demandee_m: 2.2, degats: round((hp0 ?? 0) - (r.hp ?? 0), 1), detruite: r.destroyed, en_feu: r.burning,
      projetee_m: round(r.moved, 10), hauteur_max_m: round(r.high), vitesse_max_kmh: round(r.speed * 3.6, 10), tangage_max_deg: deg(r.pitch), roulis_max_deg: deg(r.roll), inclinaison_finale_deg: deg(r.endTilt)
    };
    const flags = [];
    const reasons = [];
    if (disturbed > 0.25 || movingBefore > 0.5 || hp0 < 100) reasons.push(`La cible avait été perturbée avant le souffle (déplacée de ${disturbed.toFixed(2)} m, ${Math.round(movingBefore * 3.6)} km/h, santé ${hp0}).`);
    if (r.moved < 0.3 && r.high < 0.1) flags.push('la voiture ne bouge pas du tout sous le souffle');
    if (r.high > 4) flags.push(`la voiture monte à ${r.high.toFixed(1)} m`);
    if (!r.destroyed && !r.burning && (hp0 - r.hp) < 20) flags.push('presque aucun dégât à 2 m d’une explosion');
    return {
      ok: true, type: 'explosion', validite: reasons.length ? 'perturbee' : 'valide', raisons: reasons, params: { trajet: road }, lieu: this.lieu(cx, 0, cz), mesures, images: shots.filter(Boolean),
      texte: `Explosion à ${distance.toFixed(2)} m d’une berline (${a.addressAt(cx, cz)}). Dégâts ${mesures.degats}, ${r.destroyed ? 'détruite' : 'pas détruite'}${r.burning ? ', en feu' : ''}, projetée de ${r.moved.toFixed(1)} m, ${r.high.toFixed(2)} m de haut au plus, tangage ${deg(r.pitch)}°, roulis ${deg(r.roll)}°.${[...reasons, ...flags].length ? ` À noter : ${[...reasons, ...flags].join(' ; ')}.` : ''}`
    };
  }

  // ---- bordure ----------------------------------------------------------------------------------------------------
  // Along a sidewalk's edge, 30 cm inside it: his feet against the ground computed and the ground drawn
  async bordure(input) {
    const a = this.architect, g = this.game, c = g.controllers, eye = a.eye;
    const f = a.focus();
    const edge = input.bord || this.findKerb(f.x, f.z);
    if (!edge) return { ok: false, texte: 'Pas de bordure de trottoir trouvée à moins de 40 m.' };
    const { x, z, ux, uz, nx, nz } = edge;
    const start = { x: x + nx * 0.3, z: z + nz * 0.3 };
    a.teleportSelf(start.x, start.z, Math.atan2(ux, uz));
    await this.wait(0.8);
    a.path = Array.from({ length: 9 }, (_, i) => ({ x: start.x + ux * (i + 1) * 2.5, z: start.z + uz * (i + 1) * 2.5 }));
    a.wp = 0;
    a.pace = 1.4;
    a.trip = a.newTrip({ by: 'foot', x: a.path.at(-1).x, z: a.path.at(-1).z, phase: 'walk' });
    a.order = { kind: 'goto', x: a.trip.x, z: a.trip.z, by: 'foot', label: 'la bordure' };
    const rows = [];
    let probeT = 0;
    const shots = [];
    const watch = this.every((dt) => {
      probeT -= dt;
      if (probeT > 0 || !a.actor) return;
      probeT = 0.25;
      const p = a.actor;
      const computed = c.getGroundHeight(p.x, p.z, 'person', p.y + 0.5);
      const drawn = eye.drawnGround(p.x, p.z, computed + 2.5);
      rows.push({ x: p.x, z: p.z, feet: p.y, computed, drawn: drawn?.y ?? null });
    });
    const side = (t) => this.sidePose(start.x + ux * t, 0, start.z + uz * t, Math.atan2(ux, uz), -4.5, 1.1, 60);
    await this.wait(2); shots.push(await this.shoot({ ...side(4), pitch: -0.12 }));
    await this.wait(3); shots.push(await this.shoot({ ...side(11), pitch: -0.12 }));
    const arrived = await this.until(() => !a.trip, 14);
    shots.push(await this.shoot({ ...side(20), pitch: -0.12 }));
    watch();
    a.trip = null;
    a.order = { kind: 'idle' };
    const withDrawn = rows.filter((r) => r.drawn !== null);
    const sinks = withDrawn.map((r) => r.feet - r.drawn);
    const gaps = withDrawn.map((r) => r.computed - r.drawn);
    const worst = (list) => list.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0);
    const mesures = {
      points: rows.length, pieds_sous_dessin_max_cm: round(Math.min(0, ...sinks) * 100, 1), pieds_au_dessus_max_cm: round(Math.max(0, ...sinks) * 100, 1),
      ecart_calcule_dessine_max_cm: round(worst(gaps) * 100, 1), hauteur_trottoir_calculee_m: round(Math.max(...rows.map((r) => r.computed), 0)), hauteur_trottoir_dessinee_m: round(Math.max(...withDrawn.map((r) => r.drawn), 0))
    };
    return {
      ok: true, type: 'bordure', validite: !arrived || !withDrawn.length ? 'incomplete' : 'valide', raisons: !arrived ? ['La marche de 22 m n’a pas été achevée.'] : !withDrawn.length ? ['Aucune surface dessinée mesurée.'] : [], params: { bord: edge }, lieu: this.lieu(start.x, 0.15, start.z), mesures, images: shots.filter(Boolean),
      texte: `Marche de 22 m le long d’une bordure (${a.addressAt(start.x, start.z)}), à 30 cm du bord, ${rows.length} mesures. Pieds jusqu’à ${Math.abs(mesures.pieds_sous_dessin_max_cm)} cm sous la surface dessinée et ${mesures.pieds_au_dessus_max_cm} cm au-dessus ; écart sol calculé / sol dessiné jusqu’à ${mesures.ecart_calcule_dessine_max_cm} cm (trottoir calculé ${mesures.hauteur_trottoir_calculee_m} m, dessiné ${mesures.hauteur_trottoir_dessinee_m} m).`
    };
  }

  // The nearest place where the game's sidewalk ends, and the kerb's direction there
  findKerb(x, z) {
    const c = this.game.controllers;
    if (!c.isPointOnSidewalk) return null;
    const inside = c.isPointOnSidewalk(x, z);
    let best = null;
    for (let k = 0; k < 16; k++) {
      const ang = k * Math.PI / 8, dx = Math.sin(ang), dz = Math.cos(ang);
      for (let d = 0.5; d < 40; d += 0.5) {
        if (c.isPointOnSidewalk(x + dx * d, z + dz * d) !== inside) {
          if (!best || d < best.d) best = { d, x: x + dx * d, z: z + dz * d, dx, dz };
          break;
        }
      }
    }
    if (!best) return null;
    // the kerb runs across the search direction; its inside is the sidewalk
    const onWalk = c.isPointOnSidewalk(best.x + best.dx * 0.4, best.z + best.dz * 0.4);
    const nx = onWalk ? best.dx : -best.dx, nz = onWalk ? best.dz : -best.dz;
    return { x: best.x, z: best.z, ux: nz, uz: -nx, nx, nz };
  }

  // ---- nuit --------------------------------------------------------------------------------------------------------
  async nuit(input) {
    const a = this.architect, g = this.game, eye = a.eye;
    const f = a.focus();
    const here = input.lieu || { x: f.x, z: f.z, yaw: a.actor?.heading ?? 0 };
    if (input.lieu) { a.teleportSelf(here.x, here.z, here.yaw); await this.wait(0.8); }
    const hour0 = g.atmosphere.hour;
    const pose = { ...eye.pose({ direction: 'devant', cadrage: 'facade' }), yaw: here.yaw };
    const shots = [], light = [];
    for (const hour of [13, 23]) {
      g.atmosphere.setHour(hour);
      await this.wait(1.6);
      const img = await this.shoot(pose);
      shots.push(img);
      light.push(img ? await this.guard(brightness(img)) : null);
    }
    g.atmosphere.setHour(hour0);
    const mesures = { luminosite_13h: light[0], luminosite_23h: light[1], rapport_nuit_jour: light[0] ? round(light[1] / light[0]) : null };
    return {
      ok: true, type: 'nuit', params: { lieu: here }, lieu: this.lieu(here.x, f.y, here.z), mesures, images: shots.filter(Boolean),
      texte: `La même façade à 13 h et à 23 h (${a.addressAt(here.x, here.z)}) : luminosité moyenne ${light[0]} puis ${light[1]} (sur 255). Juge les deux photos : vitrines éclairées, fenêtres, lampadaires, enseignes.`
    };
  }
}

// Mean brightness of a photo (0 to 255)
async function brightness(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 48; c.height = 27;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0, 48, 27);
  const d = x.getImageData(0, 0, 48, 27).data;
  let s = 0;
  for (let k = 0; k < d.length; k += 4) s += (d[k] + d[k + 1] + d[k + 2]) / 3;
  return Math.round(s / (d.length / 4));
}

export { ArchitectLab, brightness };
