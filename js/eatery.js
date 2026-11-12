import * as THREE from 'three/webgpu';
import { BRANDS, SNACK_MAX, brandOpenAt } from './eatery-brands.js';
import { SPECS, PLANS, SPOTS, eateryPoint, eateryLocal, eateryHeading, eateryZone } from './eatery-plan.js';
import { getLocationLabel } from './city-config.js';
import { cityUniforms } from './tsl-materials.js';
import { EateryCast, GESTURES, CARRY, drawTray, seatPose, bodyPoint } from './eatery-cast.js';
import { EateryCounter } from './eatery-counter.js';

// The restaurants in play: what the player can do in a branch of BULLION or TRANCHE (order at a till, a kiosk or the
// hatch, wait for the number, carry the tray, sit anywhere, eat, clear the table, pocket a snack for later, hold up
// the till) and what the place does in return. The people are eatery-cast.js's; the rooms eatery-room.js's.

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const money = (n) => `${Math.round(n).toLocaleString('fr-FR')} $`;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const HANDS_FREE = new Set(['fists']);

class EaterySystem {
  /**
   * @param {object} game - gameplay.js
   * @param {object} world - eatery-room.js's createEateryWorld()
   * @param {object} props - eatery-props.js
   * @param {object[]} sites - every branch
   */
  constructor(game, world, props, sites) {
    this.game = game; this.world = world; this.props = props; this.sites = sites;
    this.cast = new EateryCast({ game, world, props });
    this.clock = 0;
    this.inside = null; this.zone = null; this.local = null; this.near = null;
    this.greeted = null; this.saidAt = -100;
    this.order = null;   // the player's order being made or waiting: the cast's order object
    this.held = null;    // what the player carries: a tray (eatery-cast.js's), its menu item in `item`
    this.seated = null;  // { slot, branch, t }
    this.bite = null;    // the gesture under way: { name, t0, ... }
    this.plan = [];      // what is left to eat of what is held or on the table: 'burger' | 'fries' | 'cup' | 'slice'
    this.biteAt = 0; this.snack = null; this.robbery = null; this.loot = null;
    this.view = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 42 };
    this.seatRoot = new THREE.Object3D();
    this.overlay = { arms: 'hands', handL: { x: 0, y: 0, z: 0, w: 0, px: 0.6, py: -1, pz: -0.3 }, handR: { x: 0, y: 0, z: 0, w: 0, px: -0.6, py: -1, pz: -0.3 } };
    this.body = { rig: null, x: 0, y: 0, z: 0, yaw: 0, s: 1, street: false, hand: (i, x, y, z) => { const h = i ? this.overlay.handR : this.overlay.handL; h.x = x; h.y = y; h.z = z; h.w = 1; } };
    this.shops = sites.map((site) => {
      const door = eateryPoint(site, SPECS[site.brand].entry, 1.7);
      const shop = { id: site.id, type: site.brand, brand: site.brand, name: BRANDS[site.brand].name, sub: getLocationLabel(site.x, site.z), x: door.x, z: door.z, counter: true, eatery: true, site };
      site.business = shop; return shop;
    });
    this.counter = new EateryCounter(game, this);
    game.shops.foodShops = this.shops; game.shops.place();
    // the rooms' floors, on top of whatever else has one (CALIBRE)
    const before = game.controllers.interiorFloor;
    game.controllers.interiorFloor = (x, z) => { const site = this.contains(x, z); return site ? SPECS[site.brand].floor : before ? before(x, z) : null; };
    // the pocket's count, by the vitals
    this.chip = document.createElement('div');
    this.chip.className = 'snack-chip'; this.chip.hidden = true;
    this.chip.innerHTML = '<i></i><strong>0</strong><span>U</span>';
    (document.getElementById('game-hud') || document.body).append(this.chip);
    window.addEventListener('keydown', (e) => this.key(e));
  }

  contains(x, z) {
    for (const site of this.sites) {
      if (Math.abs(site.x - x) > 22 || Math.abs(site.z - z) > 22) continue;
      const p = eateryLocal(site, x, z);
      if (eateryZone(site.brand, p.x, p.z)) return site;
    }
    return null;
  }

  // The live branch of a site (its people, its orders), or null
  branchOf(site) { const b = site && this.cast.branches[site.brand]; return b && b.site === site ? b : null; }
  get branch() { return this.branchOf(this.inside || this.near); }
  // The player is standing where a customer orders (the queue notices)
  get atTill() { return !!this.tillAt(); }

  sfx(name, x, y, z, options) { this.game.audio?.eatery?.play?.(name, x, y, z, options); }
  blip() { const p = this.game.person.position; this.sfx('kiosk', p.x, p.y + 1.2, p.z); }

  // A line from whoever serves here, if there is someone to say it
  speak(kind, vars = null, force = true) {
    const b = this.branch;
    if (!b) return;
    const who = this.servant(b);
    if (who) this.cast.say(who, kind, vars, force);
  }
  servant(b) { return b.tills.map((t) => t.cashier).find((c) => c && !c.gone && !c.p.dead) || null; }

  available(shop) {
    const b = this.branchOf(shop?.site), g = this.game;
    return !!b && !b.shut && !b.alarmed && g.wanted.level === 0 && !!this.servant(b) && !this.servant(b).scared;
  }

  // What the menu needs to know of the player's hands and orders
  orderState() { return { pending: !!this.order, holding: !!this.held || !!this.seated }; }

  // ---- Where the player is -------------------------------------------------------------------------------------------------
  // The till the player stands at: its index, or null
  tillAt() {
    const g = this.game, p = this.local, site = this.inside;
    if (!site || !p || this.zone !== 'dining' || g.state !== 'onFoot' || this.seated) return null;
    for (const [i, s] of SPOTS[site.brand].order.entries()) if (Math.hypot(p.x - s.x, p.z - s.z) < 0.75) return { index: i, spot: s };
    return null;
  }
  kioskAt() {
    const p = this.local, site = this.inside;
    if (!site || site.brand !== 'bullion' || !p || this.seated) return null;
    return SPOTS.bullion.kiosks.find((s) => Math.hypot(p.x - s.x, p.z - s.z) < 0.7) || null;
  }
  // On the sidewalk at TRANCHE's hatch
  hatchAt() {
    const g = this.game, site = this.near;
    if (this.inside || !site || site.brand !== 'tranche' || g.state !== 'onFoot') return null;
    const p = eateryLocal(site, g.person.position.x, g.person.position.z), s = SPOTS.tranche.window;
    return Math.hypot(p.x - s.x, p.z - s.z) < 0.9 ? s : null;
  }
  // A free seat within reach
  seatAt() {
    const b = this.branchOf(this.inside), p = this.local;
    if (!b || !p || this.seated) return null;
    let best = null, bd = 1.05;
    for (const slot of b.seats) {
      if (slot.by || (slot.tray && !slot.tray.dirty) || slot.seat.kind === 'stand') continue;
      const d = Math.min(Math.hypot(p.x - slot.seat.x, p.z - slot.seat.z), Math.hypot(p.x - slot.seat.from.x, p.z - slot.seat.from.z) + 0.25);
      if (d < bd) { bd = d; best = slot; }
    }
    return best;
  }
  nearSpot(spot, r = 1.0) { const p = this.local; return !!p && !!spot && Math.hypot(p.x - spot.x, p.z - spot.z) < r; }

  // ---- The prompt and the key ------------------------------------------------------------------------------------------------
  prompt() {
    const g = this.game;
    if (g.state !== 'onFoot' || g.shops.open) return null;
    const site = this.inside || this.near, brand = site && BRANDS[site.brand];
    if (!site) return null;
    const tag = `${brand.name} · `;
    if (this.seated) {
      if (this.bite) return null;
      return this.plan.length ? { text: 'Manger', sub: `${tag}ESPACE : SE LEVER` } : { text: 'Se lever', sub: `${tag}BON APPÉTIT` };
    }
    const b = this.branchOf(site);
    if (!b) return null;
    if (this.loot && this.loot.site === site && this.nearLoot()) return { text: `Prendre la caisse (${money(this.loot.amount)})`, sub: `${tag}BRAQUAGE` };
    if (this.held) {
      const seat = this.seatAt();
      if (seat) return { text: 'S’asseoir', sub: `${tag}${seat.seat.kind === 'booth' ? 'BANQUETTE' : seat.seat.kind === 'stool' ? 'TABOURET' : 'TABLE'}` };
      if (this.nearSpot(SPOTS[site.brand].trash, 1.1)) return { text: this.held.kind === 'plate' ? 'Jeter l’assiette' : 'Vider le plateau', sub: `${tag}MERCI` };
      if (this.held.kind === 'plate' && this.plan.length && !this.bite) return { text: 'Manger', sub: `${tag}DEBOUT, COMME À NEW YORK` };
      return null;
    }
    if (this.order?.state === 'ready' && this.nearOrder()) return { text: this.order.tray.kind === 'plate' ? 'Prendre la part' : 'Prendre le plateau', sub: `${tag}COMMANDE ${this.order.n}` };
    const open = this.available(site.business);
    if (this.tillAt()) return { text: open ? 'Commander' : 'Service interrompu', sub: `${tag}${site.brand === 'bullion' ? 'CAISSE' : 'COMPTOIR'}` };
    if (this.kioskAt()) return { text: open ? 'Commander à la borne' : 'Borne hors service', sub: `${tag}BORNE` };
    if (this.hatchAt()) return { text: open ? 'Commander au guichet' : 'Guichet fermé', sub: `${tag}PART À EMPORTER` };
    return null;
  }

  interact() {
    const g = this.game;
    if (g.state !== 'onFoot') return false;
    const site = this.inside || this.near;
    if (!site) return false;
    if (this.seated) { if (!this.bite) { if (this.plan.length) this.startBite(); else this.standUp(); } return true; }
    const b = this.branchOf(site);
    if (!b) return false;
    if (this.loot && this.loot.site === site && this.nearLoot()) { this.takeLoot(); return true; }
    if (this.held) {
      const seat = this.seatAt();
      if (seat) { this.sitDown(b, seat); return true; }
      if (this.nearSpot(SPOTS[site.brand].trash, 1.1)) { this.dumpHeld(b); return true; }
      if (this.held.kind === 'plate' && this.plan.length) { if (!this.bite) this.startBite(); return true; }
      return false;
    }
    if (this.order?.state === 'ready' && this.nearOrder()) { this.takeOrder(b); return true; }
    const till = this.tillAt(), kiosk = this.kioskAt(), hatch = this.hatchAt();
    if (till || kiosk || hatch) {
      const shop = site.business;
      if (!this.available(shop)) {
        g.toast(`${shop.name} · service interrompu`, g.wanted.level ? 'Semez la police avant de revenir.' : b.shut ? 'C’est fermé. Revenez plus tard.' : 'Le personnel se met à l’abri. Revenez plus tard.');
        if (g.wanted.level) this.speak('police');
        return true;
      }
      // a customer already at this till: wait for them, like everyone
      if (till && b.tills[till.index]?.customer && b.tills[till.index].customer !== 'player') { this.speak('busy'); return true; }
      this.desk = { till, kiosk, hatch };
      g.selectWeapon('fists'); g.cancelWeaponActions(); g.player.threat = false; g.person.speed = 0;
      g.shops.show(shop);
      return true;
    }
    return false;
  }

  // Space (or S) gets up from a seat; U eats what is in the pockets
  key(e) {
    const g = this.game;
    if (!g.active || e.repeat) return;
    if (this.seated && !this.bite && (e.code === 'Space' || e.code === 'KeyS' || e.code === 'ArrowDown')) { e.preventDefault(); this.standUp(); }
    if (e.code === 'KeyU') this.eatSnack();
  }

  // ---- The counter (shops.js opens and closes it) ----------------------------------------------------------------------------
  openCounter(shop) {
    const g = this.game, site = shop.site, b = this.branchOf(site), desk = this.desk || {}, P = PLANS[site.brand], F = SPECS[site.brand].floor;
    this.counter.show(shop, { window: !!desk.hatch, kiosk: !!desk.kiosk });
    const spot = desk.till?.spot || desk.kiosk || desk.hatch, p = g.person;
    const stand = eateryPoint(site, spot.x, spot.z);
    p.heading = eateryHeading(site, spot.face[0], spot.face[1]);
    p.position.set(stand.x, p.position.y, stand.z);
    p.rig.reset(stand.x, stand.z, p.heading, (c, px, pz) => c.personGroundAt(px, pz), g.controllers);
    // the camera over the customer's shoulder: whoever serves, and the boards over them
    let eye, aim, ey = 1.72, ay = 1.75;
    if (desk.kiosk) { eye = { x: spot.x - 0.75, z: spot.z + 0.5 }; aim = { x: spot.x + 0.7, z: spot.z }; ey = 1.55; ay = 1.3; this.view.fov = 40; }
    else if (desk.hatch) { eye = { x: spot.x + 1.3, z: spot.z + 1.5 }; aim = { x: spot.x - 0.2, z: -1.6 }; ay = 1.45; this.view.fov = 44; }
    else if (site.brand === 'bullion') { eye = { x: spot.x + 1.25, z: spot.z + 1.9 }; aim = { x: spot.x - 0.5, z: P.counter.z - 0.6 }; ay = 2.0; this.view.fov = 50; }
    else { eye = { x: spot.x + 1.1, z: spot.z + 1.7 }; aim = { x: -1.3, z: spot.z + 0.9 }; ay = 1.45; this.view.fov = 50; }
    const e = eateryPoint(site, eye.x, eye.z), a = eateryPoint(site, aim.x, aim.z);
    this.view.pos.set(e.x, F + ey, e.z); this.view.look.set(a.x, F + ay, a.z);
    g.camera.still = this.view;
    document.body.classList.add('at-counter');
    if (b && desk.till) { const till = b.tills[desk.till.index]; if (till) { till.customer = 'player'; if (till.cashier) till.cashier.serving = 'player'; } }
    if (!desk.kiosk) this.speak('counter');
    else this.blip();
  }

  closeCounter() {
    if (!this.counter.open) return;
    const b = this.branchOf(this.counter.open.site);
    this.counter.hide();
    this.game.camera.still = null;
    document.body.classList.remove('at-counter');
    if (b) for (const till of b.tills) if (till.customer === 'player') { till.customer = null; if (till.cashier?.serving === 'player') till.cashier.serving = null; }
    if (!this.order && !this.desk?.kiosk) this.speak('bye', null, false);
    this.desk = null;
  }

  // Something was paid for (eatery-counter.js): into the pockets, or an order goes to the kitchen
  bought(shop, line, { window = false } = {}) {
    const g = this.game, b = this.branchOf(shop.site), item = line.item, brand = shop.brand;
    if (!b) return;
    if (!line.here) {
      const kind = item.slice ? 'slice' : item.snack === 'box' ? 'slice' : item.snack || 'burger';
      for (let i = 0; i < line.count && g.snacks.length < SNACK_MAX; i++) g.snacks.push({ brand, id: item.id, name: item.name, heal: item.heal, kind, flavour: item.slice || 'pepperoni', risky: !!item.risky });
      this.speak('bag');
      g.toast(`${item.name} · dans la poche`, `U pour manger, n’importe où. ${g.snacks.length} / ${SNACK_MAX}.`);
      return;
    }
    const what = brand === 'bullion' ? { item, tall: item.tray.includes('burgerTall'), fries: item.tray.includes('fries'), cup: item.tray.includes('cup') } : { item, flavour: item.slice };
    this.order = b.placeOrder('player', window ? 'window' : 'counter', what);
    this.order.site = shop.site;
    this.speak('sold');
    g.toast(brand === 'bullion' ? `Commande ${this.order.n}` : item.name, brand === 'bullion' ? 'Elle s’affiche à l’écran. On vous appelle au retrait.' : 'Le temps de la réchauffer. Elle arrive sur le comptoir.');
  }

  // ---- The order, the tray, the seat ----------------------------------------------------------------------------------------
  nearOrder() {
    const b = this.branchOf(this.order?.site), g = this.game;
    if (!b || !this.order) return false;
    const at = b.orderPlace(this.order), w = eateryPoint(b.site, at.x, at.z);
    return Math.hypot(g.person.position.x - w.x, g.person.position.z - w.z) < 1.5;
  }

  takeOrder(b) {
    const g = this.game, o = this.order;
    o.state = 'taken';
    this.order = null;
    this.held = o.tray; this.held.item = o.item;
    this.plan = o.tray.kind === 'plate' ? ['slice', 'slice', 'slice', 'slice', 'slice'] : this.mealPlan(o.tray);
    this.held.total = this.plan.length;
    g.selectWeapon('fists'); g.cancelWeaponActions();
    const p = g.person.position; this.sfx('trayDown', p.x, p.y + 1, p.z, { intensity: 0.6 });
    if (o.tray.kind === 'plate') g.toast(o.item.name, 'F pour manger debout, ou posez-vous au comptoir ou à une table.');
    else g.toast('À table', 'Asseyez-vous où vous voulez.');
  }

  // The order in which a tray is eaten
  mealPlan(tray) {
    const plan = [];
    const burger = tray.tall ? 6 : 5, fries = tray.fries ? 3 : 0, cup = tray.cup ? 2 : 0;
    for (let i = 0; i < burger; i++) { plan.push('burger'); if (i < fries) plan.push('fries'); if (i === 1 || i === 3) { if (cup > (i === 1 ? 0 : 1)) plan.push('cup'); } }
    return plan;
  }

  sitDown(b, slot) {
    const g = this.game, p = g.person, seat = slot.seat, site = b.site;
    slot.by = 'player';
    if (slot.tray?.dirty) slot.tray = null; // someone else's leftovers are pushed aside
    slot.tray = this.held; slot.tray.dirty = false;
    this.held = null;
    this.seated = { slot, branch: b, t: 0, from: { x: p.position.x, z: p.position.z } };
    const w = eateryPoint(site, seat.x, seat.z), yaw = eateryHeading(site, seat.face[0], seat.face[1]);
    p.position.set(w.x, SPECS[site.brand].floor, w.z); p.heading = yaw; p.speed = 0;
    p.suspended = true;
    this.pose = seatPose(seat, 0.12, 0.1);
    this.biteAt = this.clock + 2.2;
    g.camera.footYaw = yaw + Math.PI * 0.82; // the camera comes round to the face
    const t = eateryPoint(site, seat.tray.x, seat.tray.z);
    this.sfx('trayDown', t.x, SPECS[site.brand].floor + seat.tray.h, t.z);
    if (seat.kind === 'chair') this.sfx('chair', w.x, p.position.y, w.z);
    g.controllers.resetInput();
  }

  standUp() {
    const g = this.game, p = g.person, s = this.seated;
    if (!s) return;
    const slot = s.slot, site = s.branch.site, from = eateryPoint(site, slot.seat.from.x, slot.seat.from.z);
    this.seated = null; this.bite = null;
    p.suspended = false;
    p.rig.overlay = null; p.rig.rideFade = 0;
    p.position.set(from.x, SPECS[site.brand].floor, from.z);
    p.rig.reset(from.x, from.z, p.heading, (c, px, pz) => c.personGroundAt(px, pz), g.controllers);
    slot.by = null;
    // what is left goes with the tray: finished, it stays on the table for the crew; a plate half eaten is taken along
    if (slot.tray) {
      if (this.plan.length && slot.tray.kind === 'plate') { this.held = slot.tray; slot.tray = null; }
      else { slot.tray.dirty = true; this.plan = []; }
    }
  }

  dumpHeld(b) {
    const g = this.game, w = eateryPoint(b.site, SPOTS[b.brand].trash.x, SPOTS[b.brand].trash.z);
    this.sfx('trayDump', w.x, SPECS[b.brand].floor + 0.9, w.z);
    this.held = null; this.plan = []; this.bite = null;
    g.toast(BRANDS[b.brand].name, 'Merci. Vous êtes l’un des rares.');
  }

  // ---- Eating ----------------------------------------------------------------------------------------------------------------
  startBite() {
    const what = this.plan[0], tray = this.seated ? this.seated.slot.tray : this.held;
    if (!what || !tray) return;
    const left = this.plan.filter((k) => k === what).length;
    if (what === 'burger') { tray.lifted = 'burger'; this.bite = { name: 'bite', what, t0: this.clock, time: 1.6, item: left > 2 ? (tray.tall ? 'burgerTall' : 'burger') : 'burgerHalf' }; }
    else if (what === 'fries') this.bite = { name: 'nibble', what, t0: this.clock, time: 1.3, sound: 'chew' };
    else if (what === 'cup') { tray.lifted = 'cup'; this.bite = { name: 'nibble', what, t0: this.clock, time: 1.9, item: 'cup', left: true, hold: 0.9, tall: 0.13, sound: left === 1 ? 'slurp' : 'gulp' }; }
    else { tray.lifted = 'slice'; this.bite = { name: 'nibble', what, t0: this.clock, time: 1.5, slice: true, item: left > 3 ? `slice${cap(tray.flavour)}Hand` : 'sliceBitten', sound: 'crunch' }; }
  }

  // A bite is over: the health it gives, what is left on the tray
  endBite() {
    const g = this.game, what = this.bite.what, tray = this.seated ? this.seated.slot.tray : this.held;
    this.bite = null; this.plan.shift(); this.biteAt = this.clock + 3.4;
    if (!tray) return;
    const item = tray.item, total = tray.total || 1;
    if (item) g.health = Math.min(100, g.health + item.heal / total);
    const left = (kind) => this.plan.filter((k) => k === kind).length;
    tray.lifted = null;
    if (what === 'burger') tray.burger = left('burger') > 2 ? 2 : left('burger') > 0 ? 1 : 0;
    if (what === 'fries') tray.fries = left('fries') > 1 ? 2 : left('fries') > 0 ? 1 : 0;
    if (what === 'slice') { tray.slice = left('slice') > 3 ? 2 : left('slice') > 0 ? 1 : 0; if (tray.slice === 1) tray.lifted = 'slice'; }
    if (!this.plan.length) this.finished(tray);
  }

  finished(tray) {
    const g = this.game, item = tray.item;
    tray.lifted = null;
    if (item?.fed) { g.fed = Math.max(g.fed || 0, item.fed); g.toast('Rassasié', `Vos blessures se referment d’elles-mêmes pendant ${Math.round(item.fed / 60)} minutes.`); }
    else if (item?.risky && Math.random() < 0.35) { g.health = Math.max(15, g.health - 12); this.speak('risky'); g.toast('La Subprime', 'Elle avait un goût d’hier. Vous le sentez passer.'); }
    else if (item) g.toast(item.name, 'Ça va mieux.');
    if (Math.random() < 0.3) { const p = g.person.position; this.sfx('burp', p.x, p.y + 1.5, p.z, { intensity: 0.7 }); }
    g.save();
  }

  // A snack out of the pocket: two bites standing or walking, a gulp at the wheel
  eatSnack() {
    const g = this.game;
    if (this.snack || this.bite || this.seated || this.held || g.shops.open || !g.snacks.length) { if (!g.snacks.length && g.active && (g.state === 'onFoot' || g.state === 'driving')) g.toast('Poches vides', 'Un burger chez BULLION, une part chez TRANCHE : à emporter.'); return; }
    if (g.state !== 'onFoot' && g.state !== 'driving') return;
    if (g.health >= 100) { g.toast('Pas faim', 'Gardez ça pour plus tard.'); return; }
    const s = g.snacks.shift(), p = g.person.position;
    if (g.state === 'driving') {
      g.health = Math.min(100, g.health + s.heal);
      this.sfx(s.kind === 'cup' || s.kind === 'can' ? 'gulp' : 'bite', p.x, p.y + 1.2, p.z);
      g.toast(s.name, `+${s.heal} santé. ${g.snacks.length} en poche.`);
      return;
    }
    g.selectWeapon('fists'); g.cancelWeaponActions();
    const drink = s.kind === 'cup' || s.kind === 'can';
    this.snack = { s, bites: drink ? 2 : 3, done: 0, t0: this.clock, drink,
      item: s.kind === 'slice' ? `slice${cap(s.flavour)}Hand` : s.kind === 'fries' ? 'fries' : s.kind === 'cup' ? 'cup' : s.kind === 'can' ? 'can' : 'burger' };
    this.sfx(drink ? 'canOpen' : 'wrap', p.x, p.y + 1.1, p.z);
  }

  // ---- The hold-up ---------------------------------------------------------------------------------------------------------
  nearLoot() { const g = this.game; return Math.hypot(g.person.position.x - this.loot.x, g.person.position.z - this.loot.z) < 1.7; }

  takeLoot() {
    const g = this.game, loot = this.loot;
    this.loot = null;
    g.addMoney(loot.amount);
    g.audio.ui('cash');
    g.crime('robbery', loot.x, loot.z);
    g.stats.robberies = (g.stats.robberies || 0) + 1;
    g.toast(`+ ${money(loot.amount)}`, `La caisse de ${loot.name}. La police est prévenue.`);
  }

  holdUp(b, dt) {
    const g = this.game, p = g.person.position;
    const armed = !HANDS_FREE.has(g.weaponId) && g.weaponId !== 'grapple' && (g.player.threat || g.fireHeld);
    let r = this.robbery;
    if (!r) {
      if (!armed || this.zone !== 'dining' || b.shut || this.loot) return;
      // whoever stands behind a till, in front of the muzzle
      const fx = Math.sin(g.camera.footYaw), fz = Math.cos(g.camera.footYaw);
      const victim = b.tills.map((t) => t.cashier).find((c) => { if (!c || c.gone || c.p.dead) return false; const dx = c.p.x - p.x, dz = c.p.z - p.z, d = Math.hypot(dx, dz); return d < 8 && (dx * fx + dz * fz) / (d || 1) > 0.82; });
      if (!victim) return;
      r = this.robbery = { b, victim, t: 0, lost: 0, said: false };
      victim.held = true;
      b.alarm(true);
      g.crime('aim', p.x, p.z);
      this.cast.say(victim, 'robbed', null, true);
      g.toast(`${BRANDS[b.brand].name} · braquage`, 'Gardez-le en joue : il vide la caisse.');
      return;
    }
    const c = r.victim;
    if (c.gone || c.p.dead || !this.inside) { this.robbery = null; if (!c.gone) c.held = false; return; }
    if (armed) { r.t += dt; r.lost = 0; } else if ((r.lost += dt) > 2.5) { this.robbery = null; c.held = false; return; }
    // a moment with the hands up, then the till is emptied into a bag
    const filling = r.t > 1.3 && r.t < 6.2;
    c.held = !filling;
    c.p.cowerUntil = filling ? 0 : this.cast.pedestrians.clock + 1.5;
    c.gesture = filling ? { name: 'tidy', t0: c.gesture?.name === 'tidy' ? c.gesture.t0 : this.clock } : null;
    if (filling && this.clock - (r.coins || 0) > 0.9) { r.coins = this.clock; this.sfx('coins', c.p.x, b.floorY + 1.1, c.p.z); }
    if (filling) {
      const P = PLANS[b.brand], l = eateryLocal(b.site, c.p.x, c.p.z), w = b.brand === 'bullion' ? eateryPoint(b.site, l.x, P.counter.z + 0.12) : eateryPoint(b.site, 0.02, l.z);
      this.props.place('cashBag', w.x, b.floorY + P.counter.h, w.z, 0.4, 0, 0, 0.45 + 0.55 * (r.t - 1.3) / 4.9);
    }
    if (r.t >= 6.2) {
      const P = PLANS[b.brand], l = eateryLocal(b.site, c.p.x, c.p.z);
      const at = b.brand === 'bullion' ? { x: l.x, z: P.counter.z + 0.12, h: P.counter.h } : { x: 0.02, z: l.z, h: P.counter.h };
      const w = eateryPoint(b.site, at.x, at.z);
      this.loot = { site: b.site, x: w.x, z: w.z, y: b.floorY + at.h, amount: Math.round((b.brand === 'bullion' ? 180 + Math.random() * 260 : 90 + Math.random() * 170) / 10) * 10, name: BRANDS[b.brand].name, until: this.clock + 90 };
      this.cast.say(c, 'bagged', null, true);
      this.robbery = null;
    }
  }

  // ---- Per frame -------------------------------------------------------------------------------------------------------------
  update(dt) {
    const g = this.game; this.clock += dt;
    const p = g.person.position, onFoot = g.state === 'onFoot', hour = g.atmosphere?.hour ?? 12;
    const inside = p.y < 2.5 && onFoot ? this.contains(p.x, p.z) : null;
    this.local = inside ? eateryLocal(inside, p.x, p.z) : null;
    this.zone = inside ? eateryZone(inside.brand, this.local.x, this.local.z) : null;
    // the nearest branch within earshot, for the hatch and the sound
    let near = null, nd = 70;
    for (const site of this.sites) { const d = Math.hypot(p.x - site.x, p.z - site.z); if (d < nd) { nd = d; near = site; } }
    this.near = near;
    const entered = inside && inside !== this.inside;
    this.inside = inside;
    if (inside && g.atmosphere) g.atmosphere.indoor = 1;

    if (dt > 0) this.cast.update(dt, hour);
    const b = this.branchOf(inside), brand = inside && BRANDS[inside.brand];
    if (dt > 0) {
      // through the door: the brand's few notes, a word from the till
      if (entered && g.playing) {
        this.sfx(inside.brand === 'bullion' ? 'jingleBullion' : 'jingleTranche', p.x, p.y + 1.5, p.z);
        if (b && !b.shut && !b.alarmed && this.greeted !== inside) { this.greeted = inside; this.speak(g.wanted.level ? 'police' : 'greet'); }
        if (b?.shut) g.toast(`${brand.name} · fermé`, brandOpenAt(inside.brand, hour) ? 'Le personnel se remet de ses émotions.' : `Ouvert de ${brand.hours[0]} h à ${brand.hours[1] % 24} h.`);
      }
      if (!inside && this.greeted && nd > 30) this.greeted = null;
      // a sheet open while its place is no longer there to serve
      if (g.shops.open?.eatery && !this.available(g.shops.open)) g.shops.close();
      if (b) this.holdUp(b, dt);
      else if (this.robbery) { this.robbery.victim.held = false; this.robbery = null; }
      if (this.loot && this.clock > this.loot.until) this.loot = null;
      // an order nobody collects, a branch left behind
      if (this.order && (this.order.state === 'void' || !this.branchOf(this.order.site))) {
        if (this.order.item) { g.addMoney(this.order.item.price); g.toast('Commande annulée', 'On vous rembourse.'); }
        this.order = null;
      }
      // a tray does not leave the room: at the door it becomes a snack, the plate goes with its slice
      if (this.held && !inside && !this.seated) {
        if (this.held.kind === 'tray') {
          const item = this.held.item;
          if (item && this.plan.length && g.snacks.length < SNACK_MAX) g.snacks.push({ brand: 'bullion', id: item.id, name: item.name, heal: Math.round(item.heal * this.plan.length / (this.held.total || 1)), kind: 'burger' });
          this.held = null; this.plan = []; this.bite = null;
          g.toast('Le plateau reste ici', 'Votre burger part avec vous, dans la poche.');
        } else if (!this.plan.length) { this.held = null; }
      }
      // weapons out with the hands full: everything goes to the floor
      if (this.held && !HANDS_FREE.has(g.weaponId)) {
        if (b) b.spill(p.x, p.z);
        this.held = null; this.plan = []; this.bite = null;
      }
      if (g.fed > 0) g.fed = Math.max(0, g.fed - dt);
    }
    this.drawPlayer(dt, b);
    if (this.loot) this.props.place('cashBag', this.loot.x, this.loot.y, this.loot.z, 0.4);
    // the rooms: doors, lamps; the sound of the nearest
    for (const room of this.world.rooms) if (room.opened) { room.opened = false; const d = eateryPoint(room.site, SPECS[room.brand].entry, 0); this.sfx(room.brand === 'bullion' ? 'doorSlide' : 'doorBell', d.x, 1.6, d.z); }
    this.world.update(g.camera.camera, g.player, dt, this.cast.people(), cityUniforms.uNight.value);
    this.sound(near, nd, inside);
    const n = g.snacks.length;
    if (this.chipCount !== n) { this.chipCount = n; this.chip.hidden = n === 0; this.chip.querySelector('strong').textContent = String(n); this.chip.dataset.brand = n ? g.snacks[0].brand : ''; }
  }

  // The protagonist's own body: seated, carrying, eating
  drawPlayer(dt, b) {
    const g = this.game, person = g.person, rig = person.rig, B = this.body, o = this.overlay;
    o.handL.w = o.handR.w = 0;
    let posed = false;
    B.rig = rig; B.s = rig.s; B.street = !this.inside;
    if (this.seated) {
      const s = this.seated, slot = s.slot, seat = slot.seat, site = s.branch.site, F = SPECS[site.brand].floor;
      s.t += dt;
      const w = eateryPoint(site, seat.x, seat.z), yaw = eateryHeading(site, seat.face[0], seat.face[1]);
      person.position.set(w.x, F, w.z); person.heading = yaw; person.speed = 0;
      g.controllers.resetInput();
      this.seatRoot.position.set(w.x, F, w.z); this.seatRoot.rotation.y = yaw; this.seatRoot.updateMatrixWorld(true);
      rig.rideFade = 0.22;
      rig.drive(this.seatRoot, this.pose);
      B.x = w.x; B.z = w.z; B.y = F; B.yaw = yaw;
      posed = true;
      // the hero eats at their own pace when left alone
      if (!this.bite && this.plan.length && this.clock > this.biteAt && dt > 0) this.startBite();
      if (this.bite) {
        const t = this.clock - this.bite.t0, what = this.bite.what;
        const lx = what === 'burger' ? 0.09 : what === 'fries' ? -0.08 : what === 'cup' ? -0.13 : 0;
        const tw = eateryPoint(site, seat.tray.x, seat.tray.z);
        this.bite.rest = (this.bite.rest || new THREE.Vector3()).set(tw.x + Math.cos(yaw) * lx, F + seat.tray.h + (what === 'cup' ? 0.14 : 0.03), tw.z - Math.sin(yaw) * lx);
        (this.bite.name === 'bite' ? GESTURES.bite : GESTURES.nibble)(this.cast, B, t, this.biteData());
        if (t >= this.bite.time) this.endBite();
      }
    } else if (g.state === 'onFoot') {
      B.x = person.position.x; B.z = person.position.z; B.y = person.position.y; B.yaw = rig.yaw ?? person.heading;
      if (this.held) {
        posed = true;
        if (this.bite) {
          const t = this.clock - this.bite.t0;
          this.bite.rest = bodyPoint(B, -0.15, 1.1 * B.s, 0.26, this.bite.rest || new THREE.Vector3());
          GESTURES.nibble(this.cast, B, t, this.biteData());
          if (t >= this.bite.time) this.endBite();
        } else if (this.held.kind === 'plate' && this.held.slice === 1 && this.plan.length) CARRY.slice(this.cast, B, 0, { tray: this.held });
        else (this.held.kind === 'plate' ? GESTURES.carryPlate : GESTURES.carryTray)(this.cast, B, 0, { tray: this.held });
      } else if (this.snack) {
        // out of the pocket, to the mouth, two or three times
        posed = true;
        const k = this.snack, t = this.clock - k.t0, beat = 1.5, n = Math.floor(t / beat), u = t - n * beat;
        const rest = bodyPoint(B, k.drink ? 0.15 : -0.14, 1.1 * B.s, 0.26, _v);
        const data = { rest, name: k.item, left: k.drink, slice: k.s.kind === 'slice', hold: k.drink ? 0.8 : 0.4, tall: k.drink ? 0.1 : 0.06, tip: k.s.kind === 'can', bitten: k.done > n };
        GESTURES.nibble(this.cast, B, Math.min(u, 1.45), data);
        if (u > 0.55 && k.done <= n) { k.done = n + 1; g.health = Math.min(100, g.health + k.s.heal / k.bites); this.sfx(k.drink ? 'gulp' : k.s.kind === 'slice' ? 'crunch' : 'bite', B.x, B.y + 1.5, B.z); }
        if (n >= k.bites) {
          this.snack = null;
          if (k.s.risky && Math.random() < 0.35) { g.health = Math.max(15, g.health - 12); g.toast('La Subprime', 'Elle avait un goût d’hier. Vous le sentez passer.'); }
          else g.toast(k.s.name, `${g.snacks.length} en poche.`);
        }
        if (!HANDS_FREE.has(g.weaponId)) this.snack = null;
      }
    } else { this.snack = null; }
    if (posed) rig.overlay = o;
    else if (rig.overlay === o) { rig.overlay = null; rig.rideFade = 0; }
  }

  biteData() {
    const b = this.bite;
    b.data ??= { rest: null, name: b.item, slice: b.slice, left: b.left, hold: b.hold, tall: b.tall, sound: b.sound, bitten: false };
    b.data.rest = b.rest;
    return b.data;
  }

  // What the nearest branch sounds like from where the player stands
  sound(near, distance, inside) {
    const audio = this.game.audio?.eatery;
    if (!audio?.setScene) return;
    const site = inside || near, b = this.branchOf(site);
    if (!site || !b || distance > 60) { if (this.sounding) { this.sounding = false; audio.setScene(null); } return; }
    this.sounding = true;
    const P = PLANS[site.brand], S = SPECS[site.brand];
    const door = eateryPoint(site, S.entry, 0), p = this.game.person.position;
    const kitchen = site.brand === 'bullion' ? eateryPoint(site, -1.2, P.island.z) : eateryPoint(site, -2.3, (P.oven.z0 + P.oven.z1) / 2);
    this.insideMix = (this.insideMix || 0) + ((inside ? 1 : 0) - (this.insideMix || 0)) * 0.08;
    audio.setScene({ brand: site.brand, inside: this.insideMix, distance: Math.hypot(p.x - door.x, p.z - door.z), x: kitchen.x, y: S.floor + 1.1, z: kitchen.z,
      crowd: b.people.filter((c) => !c.staff).length, cooking: b.cooking, music: b.shut || b.alarmed ? 0 : 1 });
  }
}

export { EaterySystem };
