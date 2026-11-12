import { Vector3 } from 'three/webgpu';
import { repairBody } from './drive-fx.js';
import { FRONTIER_SITES, frontierOpen, frontierPoint } from './frontier-districts.js';
import { FRONTIER_PROGRAMS, FRONTIER_SALVAGE, MARKET_DECK, NIGHT_WORKERS, frontierDay, frontierQuote,
  postClosed, readFrontierTrade } from './frontier-activity.js';

const range = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const approach = (value, target, dt) => value + (target - value) * Math.min(1, dt);
const raised = (point, y) => ({ ...point, y });
const arm = () => ({ x: 0, y: 0, z: 0, w: 1, px: 0, py: -1, pz: 0 });
const buying = id => id === 'lisieres' || id === 'balance';
const goods = {
  serres: { title: 'Bouillon du jour', price: 26, limit: 8 },
  atelier: { title: 'Remise en état et pneus', price: 95, limit: 8 },
  cour: { title: 'Lot de pièces récupérées', price: 128, limit: 4 }
};
const reasons = (post, weather) => post.closed ? (weather === 'storm' ? 'Fermé · rafales' : 'Fermé · relève de nuit') : 'Ouvert';
const working = {
  weigh: [0.31, 1.03, 0.42, 0.08, 2.5], write: [0.17, 1.03, 0.43, 0.04, 5],
  repair: [0.25, 0.96, 0.48, 0.13, 9], lift: [0.28, 0.91, 0.43, 0.24, 3.3],
  inspect: [0.29, 1.32, 0.42, 0.12, 2], unload: [0.33, 0.89, 0.48, 0.31, 2.8],
  radio: [0.13, 1.29, 0.43, 0.13, 2.1], water: [0.31, 0.98, 0.47, 0.12, 2.8],
  stir: [0.23, 1.13, 0.47, 0.09, 4.6], watch: [0.12, 1.57, 0.31, 0.025, 1.9],
  warm: [0.23, 1.01, 0.43, 0.045, 1.6], cart: [0.34, 1.03, 0.49, 0.025, 4.5]
};

export class FrontierLife {
  constructor(game, world) {
    this.game = game;
    this.world = world;
    this.trade = game.frontierTrade = readFrontierTrade(game.frontierTrade);
    this.cast = [];
    this.postCast = [];
    this.haltCast = [];
    this.halt = null;
    this.site = null;
    this.post = null;
    this.shift = '';
    this.scan = 0;
    this.view = null;
    this.screen = null;
    this.closedUntil = new Map();
    this.key = '';
    this.openDay = -1;
    this.hubNotice = '';
  }

  control(direction, confirm, back, look = 0) {
    if (!this.view) return;
    if (back) { this.closeView(); return; }
    if (this.view.camera) {
      const step = direction === 'left' ? 0.22 : direction === 'right' ? -0.22 : 0;
      this.pan(step - look * 0.8);
      return;
    }
    const current = document.activeElement;
    if (confirm) {
      if (this.screen.contains(current) && current.tagName === 'BUTTON') current.click();
      else this.screen.querySelector('button[data-command]:not([data-command="close"]):not(:disabled)')?.focus();
    } else if (direction) this.game.pauseMenu.focusNextButton(this.screen, direction);
  }

  get day() { return frontierDay(this.game.atmosphere); }

  ledger(id) {
    const record = this.trade.orders[id];
    return record?.day === this.day ? record : { day: this.day, count: 0, freight: 0 };
  }

  available(id) {
    const { count, freight } = this.ledger(id);
    const supply = goods[id]?.limit ?? 4;
    const stock = buying(id) ? 3 + count - freight : supply + freight - count;
    return Math.max(0, Math.min(supply, stock));
  }

  resetCast(cast, remember) {
    const { actors } = this.game;
    for (const { actor, host } of cast) {
      if (host && actor.dead && remember) this.closedUntil.set(remember, this.game.clock + 180);
      if (!actor.dead && actors.actors.includes(actor)) actors.remove(actor);
    }
    cast.length = 0;
  }

  hire(cast, profile, points, host = false, hub = null, shelter = -1) {
    const actor = this.game.actors.spawn({ ...points[0], heading: points[0].heading, look: profile.look, team: 'frontier',
      weapon: 'fists', behavior: 'idle', hostile: false, alert: false, female: profile.female, name: profile.name });
    if (!actor) return;
    const job = { actor, hub, host, shelter, route: points, next: 0, spent: 0, panic: 0, phase: 0, weight: 0,
      received: false, overlay: { arms: 'hands', w: 0, handL: arm(), handR: arm() } };
    cast.push(job);
    actor.pilot = (a, dt, target) => this.work(job, a, dt, target);
  }

  occupy(site, shift) {
    const hub = this.world.hubs.get(site.id), program = FRONTIER_PROGRAMS[site.id];
    const list = shift === 'night' ? NIGHT_WORKERS : program.workers;
    for (const [i, profile] of list.entries()) {
      if (i === 0 && shift !== 'night' && (this.closedUntil.get(site.id) ?? 0) > this.game.clock) continue;
      const route = profile.route;
      const shelter = route.some(stop => stop.z > 9) ? route.findIndex(stop =>
        stop.z < 6 && ['unload', 'inspect', 'talk'].includes(stop.action)) : -1;
      const stations = route.map(({ x, z, heading, action, hold }) => ({
        ...frontierPoint(site, x, z), heading: site.yaw + heading, action, hold,
        y: profile.name === 'Mina' ? hub.y + MARKET_DECK.rise : undefined
      }));
      this.hire(this.cast, profile, stations, i === 0 && shift !== 'night', site.id, shelter);
    }
  }

  occupyPost(post) {
    const desk = { ...post.desk, heading: post.yaw + Math.PI, action: 'write', hold: 7 };
    const panel = { ...frontierPoint(post, post.side * 9.2, 0.7), heading: post.yaw - post.side * Math.PI / 2, action: 'radio', hold: 8 };
    this.hire(this.postCast, { look: 'crew', name: 'Agent de passage' }, [desk, panel]);
    const watch = post.watchPath.map((point, i) => ({ ...point, heading: post.yaw,
      action: i === 2 ? 'watch' : 'idle', hold: i === 2 ? 19 : 0.4 }));
    // The patrol descends the same ramp it used to climb.
    this.hire(this.postCast, { look: 'clerk', name: 'Vigie', female: true }, [...watch, watch[1]]);
  }

  occupyHalt(halt) {
    const points = (route) => route.map(([x, z, action, hold, heading]) => ({
      ...frontierPoint(halt, x, z), action, hold, heading: halt.yaw + heading
    }));
    this.hire(this.haltCast, { look: 'clerk', name: halt.keeper }, points([
      [-2.5, 0.02, halt.work, 11, Math.PI], [-0.6, 0.5, 'inspect', 5, -0.6], [-1.3, 2.8, 'watch', 6, 0.45]
    ]));
    this.hire(this.haltCast, { look: 'crew', name: 'Passant' }, points([
      [5, 7.1, 'idle', 4, 0], [2.3, 3.7, 'warm', 9, -0.45], [1.55, 0.95, 'talk', 7, -1.35], [4.3, 2.9, 'idle', 1, 1.7]
    ]));
  }

  pose(job, actor, action, dt) {
    const move = working[action], pose = job.overlay;
    pose.w = approach(pose.w, move ? 1 : 0, dt * 8);
    actor.rig.crouchTarget = action === 'lift' || action === 'unload' ? 0.19 : 0;
    if (move) {
      const [width, height, ahead, swing, frequency] = move;
      const sn = Math.sin(actor.heading), cs = Math.cos(actor.heading);
      for (const [i, hand] of [pose.handL, pose.handR].entries()) {
        const side = (i ? -1 : 1) * width, phase = job.phase * frequency + i * 1.7;
        const reach = ahead + Math.cos(phase) * swing * 0.48;
        hand.x = actor.x + cs * side + sn * reach;
        hand.z = actor.z - sn * side + cs * reach;
        hand.y = actor.y + height + Math.sin(phase) * swing;
        hand.px = cs * side;
        hand.pz = -sn * side;
      }
    }
    actor.rig.overlay = pose.w > 0.005 ? pose : null;
  }

  work(job, actor, dt, target) {
    const { actors, wanted, controllers } = this.game;
    job.phase += dt;
    if ((actor.alert || wanted.level >= 3) && range(actor, target) < 28) job.panic = 9;
    actor.alert = false;
    actor.height = 1.8;
    const hub = this.world.hubs.get(job.hub);
    if (job.panic > 0) {
      job.panic -= dt;
      const yaw = Math.atan2(actor.x - target.x, actor.z - target.z);
      this.pose(job, actor, 'idle', dt);
      actors.step(actor, dt, Math.sin(yaw), Math.cos(yaw), 2.9, yaw);
      if (hub && job.hauler) hub.cart.visible = false;
      return true;
    }
    const goal = job.route[job.next];
    const dist = range(actor, goal);
    const workingHere = dist < 0.36;
    const talking = job.host && target.onFoot && range(actor, target) < 2 && Math.abs(target.y - actor.y) < 1.3;
    const heading = talking ? Math.atan2(target.x - actor.x, target.z - actor.z) : workingHere ? goal.heading :
      Math.atan2(goal.x - actor.x, goal.z - actor.z);
    const hauling = !workingHere && (goal.action === 'cart' || goal.action === 'unload');
    const sheltering = this.shift === 'storm' && job.shelter === job.next;
    const action = talking ? 'talk' : hauling ? 'cart' : workingHere ?
      (sheltering && job.spent >= goal.hold ? 'inspect' : goal.action) : 'idle';
    actors.step(actor, dt, workingHere ? 0 : (goal.x - actor.x) / dist,
      workingHere ? 0 : (goal.z - actor.z) / dist, workingHere ? 0 : hauling ? 1.17 : 1.43, heading);
    this.pose(job, actor, action, dt);

    if (hub && (hauling || goal.action === 'unload' || goal.action === 'cart')) {
      job.hauler = true;
      if (action === 'unload' && job.spent > 1.25 && !job.received) {
        job.received = true;
        const record = this.ledger(job.hub);
        const needsFreight = buying(job.hub) ? this.available(job.hub) > 1 : record.freight < record.count;
        if (needsFreight && record.freight < 28) this.trade.orders[job.hub] = { ...record, freight: record.freight + 1 };
        if (hub.dial) hub.impulse = 1;
      }
      const cart = hub.cart;
      if (action === 'cart' || goal.action === 'cart' || (!workingHere && goal.action === 'unload') || !cart.visible) {
        const x = actor.x + Math.sin(actor.heading) * 0.9, z = actor.z + Math.cos(actor.heading) * 0.9;
        const y = controllers.getGroundHeight(x, z, 'person', actor.y + 0.5);
        cart.position.set(x, y, z);
        cart.rotation.y = actor.heading;
        for (const wheel of hub.wheels) wheel.rotation.x += actor.speed * dt / 0.26;
        cart.updateMatrixWorld(true);
      }
      cart.visible = true;
      hub.crate.visible = !job.received;
    }
    if (action === 'lift' && job.hauler && job.spent >= 1) {
      job.received = false;
      if (hub?.cart.visible) hub.cart.visible = false;
    }
    if (workingHere && !talking) {
      job.spent += dt;
      if (job.spent >= goal.hold && !sheltering) { job.next = (job.next + 1) % job.route.length; job.spent = 0; }
    }
    return true;
  }

  // Check the arm's swept lane before enabling its collider. Opening always clears the collider first.
  armClear(post, player) {
    const c = post.barrier.obb;
    const clear = (p, radius) => {
      const x = p.x - c.cx, z = p.z - c.cz;
      return Math.abs(c.cs * x - c.sn * z) > c.hx + radius || Math.abs(c.sn * x + c.cs * z) > radius + 0.9 ||
        (p.y ?? post.barrier.minY) > post.barrier.maxY + 1;
    };
    if (!clear(player, player.inVehicle ? 3.8 : 0.5)) return false;
    return this.game.allCars.every(car => !car.mesh?.visible || clear(car.position, car.halfL ?? 2.4));
  }

  updatePost(post, dt, player) {
    const g = this.game, { hour, weather } = g.atmosphere;
    const closed = !g.director.current && postClosed(post.id, hour, weather);
    const mayClose = closed && (post.inserted || post.progress < 0.47 || this.armClear(post, player));
    const p = Math.max(0, Math.min(1, post.progress + (mayClose ? 1 : -1) * dt * 0.68));
    if (p !== post.progress) {
      post.progress = p;
      post.swing.rotation.z = -post.side * (1 - p) * Math.PI * 0.47;
      post.swing.updateMatrixWorld(true);
    }
    const solid = closed && p >= 0.97;
    if (solid && !post.inserted) {
      // removeCollider invalidates its argument so any outstanding collision query drops it.
      post.inserted = { ...post.barrier };
      g.controllers.addCollider(post.inserted);
    } else if (!solid && post.inserted) {
      g.controllers.removeCollider(post.inserted);
      post.inserted = null;
    }
    if (post.closed !== closed) {
      post.closed = closed;
      post.signal.material = closed ? post.stopMaterial : post.lampMat;
      if (range(player, post) < 30) g.hud.say(post.name.toUpperCase(),
        closed ? (weather === 'storm' ? 'Rafales sur la piste. Gardez vos distances, on abaisse le bras.' : 'On ferme pour la relève. Réouverture à quatre heures.') :
          'Le passage rouvre. La piste est libre.', 4);
    }
  }

  update(dt, player) {
    for (const post of this.world.posts.values()) this.updatePost(post, dt, player);
    const hub = this.site && this.world.hubs.get(this.site.id);
    const glow = this.game.atmosphere.night;
    this.lightPulse = (this.lightPulse ?? 0) - dt;
    if (glow > 0.3 && hub?.light && this.lightPulse <= 0 && range(hub.light, player) < 26) {
      const lamp = hub.light;
      this.lightPulse = 0.12;
      this.game.fx.flash(lamp.x, lamp.y, lamp.z, 0xffc77b, 135 * glow, 0.18, 13);
    }
    if (hub?.dial && hub.impulse > 0) {
      hub.impulse = Math.max(0, hub.impulse - dt * 0.51);
      hub.dial.rotation.z = Math.sin(hub.impulse * 16) * hub.impulse * 0.75;
      hub.dial.updateMatrixWorld();
    }
    if (this.view && (!this.game.active || this.game.state !== 'onFoot' || !player.alive ||
      this.game.director.current || !this.canReach(this.view.point, this.view.radius + 0.9))) this.closeView();
    this.scan -= dt;
    if (this.scan > 0) return;
    this.scan = 0.3;
    const { atmosphere, director } = this.game;
    const site = !director.current && (this.site && range(this.site, player) < 205 ? this.site :
      FRONTIER_SITES.find(candidate => range(candidate, player) < 145)) || null;
    const shift = site && frontierOpen(site, atmosphere.hour) ? (atmosphere.weather === 'storm' ? 'storm' : 'day') : 'night';
    const retry = this.site === site && (this.closedUntil.get(site?.id) ?? Infinity) <= this.game.clock;
    if (site && site === this.site && shift === 'storm' && this.shift === 'day' && range(site, player) < 50) {
      this.game.hud.say(site.resident.toUpperCase(), 'On rentre les caisses. Si vous attendez quelqu’un, mettez-vous sous l’auvent.', 4.8);
    }
    if (site !== this.site || (shift === 'night') !== (this.shift === 'night') || retry) {
      if (retry) this.closedUntil.delete(site.id);
      this.resetCast(this.cast, this.site?.id);
      if (hub) hub.cart.visible = false;
      this.site = site;
      if (site) this.occupy(site, shift);
    }
    this.shift = shift;
    const post = !director.current && (this.post && range(this.post, player) < 175 ? this.post :
      [...this.world.posts.values()].find(candidate => range(candidate, player) < 115)) || null;
    if (post !== this.post) {
      this.resetCast(this.postCast);
      this.post = post;
      if (post) this.occupyPost(post);
    }
    const halt = !site && !director.current && (this.halt && range(this.halt, player) < 128 ? this.halt :
      this.world.halts.find(candidate => range(candidate, player) < 89)) || null;
    if (halt !== this.halt) {
      this.resetCast(this.haltCast);
      this.halt = halt;
      if (halt) this.occupyHalt(halt);
    }
    if (this.openDay !== this.day) {
      this.openDay = this.day;
      for (const [id, box] of this.world.salvage) box.visible = this.trade.claimed[id] !== this.day;
    }
    for (const [id, place] of this.world.hubs) {
      const visible = Math.min(4, this.available(id));
      for (const [i, item] of place.stock.entries()) item.visible = i < visible;
    }
    if (this.view && !this.view.camera) this.renderView();
  }

  canReach(point, radius) {
    const p = this.game.player;
    return range(p, point) <= radius && Math.abs(p.y - (point.y ?? p.y)) < 1.5;
  }

  offer() {
    const g = this.game, { player } = g;
    if (g.state !== 'onFoot' || !player.alive || g.director.current || player.speed > 2) return null;
    if (this.view) return { ...this.view, text: 'Fermer', sub: this.view.title };
    const site = this.site, hub = site && this.world.hubs.get(site.id);
    const near = (id, point, radius, title, text) => this.canReach(point, radius) ? { id, point, radius, title, text, sub: title } : null;
    const market = site?.id === 'lisieres' && near('radio', raised(frontierPoint(site, 22, 5.25), hub.y + MARKET_DECK.rise),
      2.25, 'Les Fréquences', 'Écouter le bulletin');
    const scope = hub?.scope && near('scope', hub.scope, 2.3, 'Vigie de la Batterie', 'Regarder aux jumelles');
    const postScope = this.post && near('scope', this.post.lookout, 1.7, this.post.name, 'Observer le passage');
    const report = this.post && near('radio', this.post.desk, 2.4, this.post.name, 'Consulter le bulletin des vigies');
    if (market || scope || postScope || report) return market || scope || postScope || report;
    for (const salvage of FRONTIER_SALVAGE) {
      if (this.trade.claimed[salvage.id] === this.day) continue;
      const item = this.world.salvage.get(salvage.id);
      const offer = near('salvage', raised(salvage, item.position.y), 2.15, 'Pièces de récupération', 'Fouiller la caisse');
      if (offer) return offer;
    }
    if (!site) {
      const keeper = this.haltCast[0];
      return keeper && !keeper.actor.dead && keeper.panic <= 0 ?
        near('talk', keeper.actor, 2.6, this.halt.name, 'Parler à ' + this.halt.keeper) : null;
    }
    const program = FRONTIER_PROGRAMS[site.id];
    const host = this.cast.find(job => job.host);
    const serving = this.shift !== 'night' && host && !host.actor.dead && host.panic <= 0;
    const point = raised(frontierPoint(site, ...program.counter), hub.y + 0.24);
    return near(serving ? site.id : 'hours', point, 2.35, program.shop, serving ?
      (site.id === 'vigie' ? 'Consulter le bulletin des vigies' : 'Voir le comptoir') : 'Lire les horaires');
  }

  prompt() { return this.offer(); }

  interact() {
    if (this.closeView()) return true;
    const offer = this.offer();
    if (!offer) return false;
    const g = this.game;
    if (offer.id === 'talk') {
      g.hud.say(this.halt.keeper.toUpperCase(), this.halt.line, 5.9);
      return true;
    }
    if (offer.id === 'salvage') {
      const id = offer.point.id;
      if (this.trade.scrap >= 25) { g.toast('Sac plein', 'Échangez des pièces à la Halle ou à la Balance.'); return true; }
      this.trade.claimed[id] = this.day;
      this.trade.scrap += Math.min(2, 25 - this.trade.scrap);
      this.world.salvage.get(id).visible = false;
      g.toast('Pièces récupérées', `${this.trade.scrap} / 25 en stock`);
      g.audio.ui('checkpoint');
      g.save();
      return true;
    }
    this.view = offer;
    this.hubNotice = '';
    this.key = '';
    g.releasePointer();
    g.controllers.resetInput();
    g.fireHeld = g.firePressed = g.aimHeld = g.aimToggle = false;
    if (offer.id === 'scope') this.aimScope(offer);
    else if (offer.id === 'radio' || offer.id === 'vigie') {
      const storm = g.atmosphere.weather === 'storm';
      g.hud.say('FRÉQUENCES DES LISIÈRES', storm ? 'Aux cinq vigies, stoppez les départs. Visibilité réduite sur la piste.' :
        'Bulletin reçu. Les passages ouverts sont affichés au comptoir. Bonne route.', 4.8);
    } else if (FRONTIER_PROGRAMS[offer.id]) {
      const lines = this.site.lines;
      const line = lines[(this.dialogueIndex ?? 0) % lines.length];
      this.dialogueIndex = (this.dialogueIndex ?? 0) + 1;
      g.hud.say(this.site.resident.toUpperCase(), line, 5.3);
    }
    this.renderView();
    this.screen.querySelector('button:not([data-command="close"]):not(:disabled)')?.focus();
    return true;
  }

  aimScope(view) {
    view.yaw = view.point.yaw;
    view.camera = { pos: new Vector3(view.point.x, view.point.y + 1.59, view.point.z), look: new Vector3(), fov: 18 };
    const lens = view.point.lens ?? 1.8;
    view.camera.pos.x += Math.sin(view.yaw) * lens;
    view.camera.pos.z += Math.cos(view.yaw) * lens;
    this.game.camera.still = view.camera;
    document.body.classList.add('frontier-observing');
    this.pan(0);
  }

  pan(delta) {
    const view = this.view;
    view.yaw = Math.max(view.point.yaw - 1.05, Math.min(view.point.yaw + 1.05, view.yaw + delta));
    const { pos, look } = view.camera;
    look.set(pos.x + Math.sin(view.yaw) * 100, pos.y - 5, pos.z + Math.cos(view.yaw) * 100);
  }

  closeView() {
    if (!this.view) return false;
    if (this.game.camera.still === this.view.camera) this.game.camera.still = null;
    if (this.view.camera) document.body.classList.remove('frontier-observing');
    this.view = null;
    if (this.screen) this.screen.hidden = true;
    this.game.camera.domElement.focus();
    return true;
  }

  carToRepair() {
    const site = FRONTIER_SITES.find(site => site.id === 'atelier');
    const spot = frontierPoint(site, 5.2, 12.4);
    const { car, fleet } = this.game;
    return this.game.allCars.find(c => (c === car || fleet.includes(c)) && c.mesh?.visible && c.body && !c.destroyed && c.hp > 0 && !c.police &&
      Math.abs(c.speed || 0) < 0.7 && range(c.position, spot) < 7 &&
      (c.hp < 100 || c.body.wheels.some(wheel => wheel.burst)));
  }

  options(id) {
    const g = this.game, canTrade = this.ledger(id).count < 24, stocked = this.available(id) > 0 && canTrade;
    const { scrap } = this.trade;
    if (buying(id)) {
      const price = frontierQuote(id, g.atmosphere.hour, this.available(id));
      return [{ id: 'sell', title: 'Vendre une pièce', price: `+ ${price} $`, priceValue: price, ok: scrap > 0 && canTrade }];
    }
    if (id === 'atelier') {
      const car = this.carToRepair(), can = stocked && !!car;
      return [{ id: 'cash', title: goods[id].title, price: `${goods[id].price} $`, ok: can && g.money >= goods[id].price, car },
        { id: 'swap', title: 'Payer en pièces', price: '2 pièces', ok: can && scrap >= 2, car }];
    }
    if (id === 'serres' || id === 'cour') {
      const item = goods[id], usable = id === 'serres' ? g.health < 100 || g.fed < 110 : scrap <= 23;
      return [{ id: 'cash', title: item.title, price: `${item.price} $`, ok: stocked && usable && g.money >= item.price }];
    }
    return [];
  }

  transact(action) {
    const view = this.view, g = this.game;
    if (!view || !g.active || g.state !== 'onFoot' || !this.canReach(view.point, view.radius) || g.director.current) return;
    if (this.site?.id !== view.id || !frontierOpen(this.site, g.atmosphere.hour) ||
      !this.cast.some(job => job.host && !job.actor.dead && job.panic <= 0)) return;
    const item = this.options(view.id).find(option => option.id === action);
    if (!item?.ok) return;
    if (action === 'sell') {
      this.trade.scrap--;
      g.addMoney(item.priceValue);
      this.hubNotice = `Pièce pesée · + ${item.priceValue} $`;
      this.world.hubs.get(view.id).impulse = 1;
    } else {
      if (action === 'swap') this.trade.scrap -= 2;
      else g.addMoney(-goods[view.id].price);
      if (view.id === 'atelier') {
        item.car.hp = 100;
        item.car.burnT = 0;
        repairBody(item.car);
        this.hubNotice = 'Véhicule réparé. Les pneus sont neufs.';
      } else if (view.id === 'cour') {
        this.trade.scrap += 2;
        this.hubNotice = 'Deux pièces ajoutées à votre sac.';
      } else {
        g.health = Math.min(100, g.health + 25);
        g.fed = Math.max(g.fed, 120);
        this.hubNotice = 'Servi chaud. Vous avez repris des forces.';
      }
    }
    const record = this.ledger(view.id);
    this.trade.orders[view.id] = { ...record, count: record.count + 1 };
    g.audio.ui('pass');
    g.save();
    this.renderView();
  }

  renderView() {
    if (!this.screen) {
      this.screen = document.createElement('section');
      this.screen.id = 'frontier-counter';
      this.screen.setAttribute('aria-label', 'Comptoir des Lisières');
      this.screen.addEventListener('click', event => {
        const command = event.target.closest('button')?.dataset.command;
        if (command === 'close') this.closeView();
        else if (command === 'left' || command === 'right') this.pan(command === 'left' ? 0.22 : -0.22);
        else if (command) this.transact(command);
      });
      const lens = document.createElement('div');
      lens.id = 'frontier-lens';
      lens.setAttribute('aria-hidden', 'true');
      document.body.append(lens, this.screen);
    }
    const v = this.view, g = this.game, program = FRONTIER_PROGRAMS[v.id];
    const report = v.id === 'radio' || v.id === 'vigie';
    const options = this.options(v.id);
    const rows = report ? [...this.world.posts.values()].map(post => `<li><span>${post.name}</span><strong>${reasons(post, g.atmosphere.weather)}</strong></li>`).join('') : '';
    const info = v.id === 'hours' ? `Service de ${this.site.shift[0]} h à ${this.site.shift[1]} h.` : v.camera ?
      g.gamepad.using ? 'Croix ou stick droit pour balayer · B pour sortir' : 'Balayez la piste depuis le poste.' : report ? `${g.atmosphere.clockLabel} · ${g.atmosphere.weatherLabel}` : program?.purpose ?? '';
    const count = options.length ? `<p class="frontier-stock">${this.trade.scrap} pièces · ${this.available(v.id)} en rayon · ${g.money.toLocaleString('fr-FR')} $</p>` : '';
    const repair = v.id === 'atelier' && !this.carToRepair() ? '<p>Garez un véhicule endommagé dans les pointillés devant l’atelier.</p>' : '';
    const commands = v.camera ? '<button data-command="left">← Balayer</button><button data-command="right">Balayer →</button>' : options.map(item =>
      `<button data-command="${item.id}" ${item.ok ? '' : 'disabled'}><span>${item.title}</span><strong>${item.price}</strong></button>`).join('');
    const markup = `<header><h2>${v.title}</h2><button data-command="close" aria-label="Fermer le comptoir">Échap</button></header>
      <p>${info}</p>${count}${repair}${rows ? `<ul>${rows}</ul>` : ''}${commands}<p class="frontier-notice" role="status">${this.hubNotice}</p>`;
    if (markup !== this.key) {
      const focused = this.screen.contains(document.activeElement) ? document.activeElement.dataset.command : null;
      this.screen.innerHTML = markup;
      this.key = markup;
      if (focused) this.screen.querySelector(`[data-command="${focused}"]:not(:disabled)`)?.focus();
    }
    this.screen.classList.toggle('frontier-scope', Boolean(v.camera));
    this.screen.hidden = false;
  }
}
