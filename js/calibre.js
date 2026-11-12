import * as THREE from 'three/webgpu';
import { CALIBRE, PLAN, calibrePoint, calibreLocal, calibreZone } from './calibre-plan.js';
import { getLocationLabel } from './city-config.js';
import { cityUniforms } from './tsl-materials.js';
import { LOOKS } from './characters.js';
import { CalibreCounter } from './calibre-counter.js';
import { CalibreRange } from './calibre-range.js';

// CALIBRE in play: who is in the nearest branch (the gunsmith behind his counter, two customers, a regular on the
// range), what the player can do there (the counter, the range's booths), and what happens when it goes wrong.
// The cast shares the game's actors, damage and ragdolls; only the nearest branch has one.

const CLERK = 'ÉTIENNE';
// What the gunsmith says. One voice, never two lines within a few seconds.
const LINES = {
  greet: ['Bienvenue chez Calibre. On regarde avec les yeux.', 'Entre. Le stand est au fond, les ennuis restent dehors.', 'Calibre, depuis 1978. Qu’est-ce qu’il te faut ?'],
  counter: ['Je t’écoute.', 'Dis-moi ce qui te ferait plaisir.', 'Prends ton temps. Elles ne s’envolent pas.'],
  sold: ['Bon choix.', 'Ça, c’est un placement.', 'Garantie à vie. La sienne, pas la tienne.', 'Elle ne t’a jamais vu, elle t’aime déjà.'],
  fit: ['C’est monté.', 'Voilà. Comme à l’usine, en mieux.'],
  stow: ['Je te le démonte. Il reste à toi.'],
  broke: ['Ici, on ne fait pas de découvert.', 'Le crédit, c’est la banque d’en face.', 'Reviens quand tu seras solvable.'],
  bye: ['Vise bien.', 'Ne reviens pas en ambulance.', 'À la prochaine.'],
  warn: ['Range ça. Tout de suite.', 'Pas de ça chez moi. Baisse ton arme.'],
  fight: ['Mauvaise idée.', 'Tu viens de faire une erreur de calibre.'],
  police: ['Pas avec la police aux fesses. Dehors.'],
  range: ['Pas de tir libre. Les munitions sont pour la maison.', 'Protège tes oreilles. Et vise le papier.'],
  medal: ['Pas mal. Ça te fera une remise.', 'Propre. Le tableau d’honneur s’en souviendra.'],
  gold: ['De l’or. Tu veux ma place ?'],
  nomedal: ['Le papier a gagné. Recommence.']
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Where the customers stroll, local metres: { x, z, look (a local direction to face while stopped), wait (seconds) }
const ROUTES = [
  [{ x: -3.15, z: -2.0, look: [-1, 0], wait: 6 }, { x: -3.15, z: -4.6, look: [-1, 0], wait: 7 }, { x: -3.25, z: -5.75, look: [0, -1], wait: 6 }, { x: -3.15, z: -5.3 }, { x: -1.3, z: -5.3 },
    { x: -1.3, z: -3.7, look: [-1, 0], wait: 5 }, { x: -1.3, z: -1.75 }, { x: -3.15, z: -1.75 }],
  [{ x: 3.2, z: -4.9, look: [1, 0], wait: 6 }, { x: 3.2, z: -5.55 }, { x: 1.3, z: -5.6 }, { x: 1.3, z: -3.7, look: [1, 0], wait: 7 },
    { x: 1.3, z: -1.75, look: [0, 1], wait: 4 }, { x: 3.2, z: -1.75 }, { x: 3.2, z: -2.4, look: [1, 0], wait: 6 }]
];
const CLERK_HOME = { x: -1.72, z: -8.4 };
const REGULAR = { x: PLAN.lanes[0], z: PLAN.line.z + PLAN.line.depth / 2 + 0.42 };
const CLOSED_FOR = 150; // seconds a branch stays shut after trouble
// The mat on the counter (calibre-room.js) and how far the camera stands from each piece laid on it, metres
const MAT = { x: -1.72, z: PLAN.counter.z + 0.04, y: PLAN.counter.h };
const FRAMING = { pistol: 0.92, grenade: 0.7, smg: 1.25, shotgun: 1.8, rifle: 1.8, armor: 2.0 };

class CalibreSystem {
  constructor(game, world, sites) {
    this.game = game; this.world = world; this.sites = sites;
    this.cast = []; this.clerk = null; this.branch = null;
    this.inside = null; this.zone = null; this.local = null;
    this.clock = 0; this.closed = new Map(); this.saidAt = -100; this.warned = 0; this.greeted = null;
    this.shops = sites.map(site => {
      const door = calibrePoint(site, 0, 1.7);
      const shop = { id: site.id, type: 'guns', name: 'CALIBRE', sub: getLocationLabel(site.x, site.z), x: door.x, z: door.z, calibre: true, counter: true, site };
      site.business = shop; return shop;
    });
    this.counter = new CalibreCounter(game);
    this.range = new CalibreRange(game, world);
    this.view = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 36 };
    game.shops.gunShops = this.shops; game.shops.place();
    game.controllers.interiorFloor = (x, z) => this.contains(x, z) ? CALIBRE.floor : null;
  }

  contains(x, z) {
    for (const site of this.sites) {
      if (Math.abs(site.x - x) > 34 || Math.abs(site.z - z) > 34) continue;
      const p = calibreLocal(site, x, z);
      if (calibreZone(p.x, p.z)) return site;
    }
    return null;
  }

  // The medals of the range come off every price
  discount() { return this.range.discount(); }

  // A line from the gunsmith, if he is there to say it
  say(kind, force = false) {
    const clerk = this.clerk;
    if (!clerk || clerk.dead || (!force && this.clock - this.saidAt < 3.5)) return;
    this.saidAt = this.clock;
    this.game.hud.say(CLERK, pick(LINES[kind]), 3.2);
  }

  // The counter's zone: in front of the counter, close to it
  atCounter() {
    const g = this.game, p = this.local;
    if (g.state !== 'onFoot' || this.zone !== 'shop' || !p || g.person.position.y > 1.2) return null;
    const C = PLAN.counter;
    return p.x > C.x0 + 0.3 && p.x < C.x1 - 0.1 && p.z < C.z + C.depth / 2 + 1.45 && p.z > C.z + C.depth / 2 ? this.inside.business : null;
  }

  available(shop) {
    return !!shop && this.branch === shop.site && !!this.clerk && !this.clerk.dead && !this.clerk.hostile &&
      (this.closed.get(shop.id) || 0) <= this.clock && this.game.wanted.level === 0;
  }

  // What F would do here: { text, sub } for the prompt, or null
  prompt() {
    const g = this.game;
    if (!this.inside || g.state !== 'onFoot' || g.shops.open) return null;
    const shop = this.atCounter();
    if (shop) return { text: this.available(shop) ? 'Parler à l’armurier' : 'Service interrompu', sub: 'CALIBRE · COMPTOIR' };
    if (this.zone === 'range' && !this.range.session) {
      const lane = this.range.booth(this.local), id = lane > 0 ? this.range.weaponFor() : null;
      if (lane > 0 && id) return { text: 'Commencer la séance de tir', sub: `PAS DE TIR ${lane + 1} · MUNITIONS OFFERTES` };
    }
    return null;
  }

  interact() {
    const g = this.game, shop = this.atCounter();
    if (shop) {
      if (!this.available(shop)) {
        g.toast('CALIBRE · service interrompu', g.wanted.level ? 'Semez la police avant de revenir.' : 'Le personnel se met à l’abri. Revenez plus tard.');
        if (g.wanted.level) this.say('police');
        return true;
      }
      g.selectWeapon('fists');
      g.cancelWeaponActions();
      g.player.threat = false;
      g.person.speed = 0;
      g.shops.show(shop);
      return true;
    }
    if (this.inside && this.zone === 'range' && g.state === 'onFoot' && !this.range.session) {
      const lane = this.range.booth(this.local);
      if (lane > 0 && g.wanted.level === 0) return this.range.start(lane);
    }
    return false;
  }

  // The counter opens: the customer squares up to it, the clerk comes over, the camera goes to the mat
  openCounter(shop) {
    const g = this.game, site = shop.site, C = PLAN.counter, front = C.z + C.depth / 2;
    this.counter.show(shop);
    // out of the camera's way, to the left of the mat
    const stand = calibrePoint(site, MAT.x - 1.35, front + 0.4), p = g.person;
    p.heading = Math.atan2(-site.nx, -site.nz);
    p.position.set(stand.x, p.position.y, stand.z);
    p.rig.reset(stand.x, stand.z, p.heading, (c, px, pz) => c.personGroundAt(px, pz), g.controllers);
    this.frame(site, this.counter.presented?.id);
    g.camera.still = this.view;
    document.body.classList.add('at-counter');
    this.say('counter', true);
  }

  closeCounter() {
    if (!this.counter.open) return;
    this.counter.hide();
    this.game.camera.still = null;
    document.body.classList.remove('at-counter');
    if (this.clerk && !this.clerk.hostile) this.say('bye');
  }

  // The camera on what lies on the mat: closer to a pistol than to a rifle, the piece a little left of the middle
  // (the sheet is on the right)
  frame(site, id) {
    const d = FRAMING[id] ?? 1.5;
    const eye = calibrePoint(site, MAT.x + 0.1 * d, MAT.z + d), aim = calibrePoint(site, MAT.x + 0.07 * d, MAT.z - 0.05);
    this.view.pos.set(eye.x, CALIBRE.floor + MAT.y + 0.1 + d * 0.27, eye.z);
    this.view.look.set(aim.x, CALIBRE.floor + MAT.y + 0.05 + d * 0.02 + (id === 'armor' ? 0.3 : 0), aim.z);
  }

  // Something was bought or fitted: the clerk slides the piece back across the mat
  presented(said) {
    if (said) this.world.nudge();
  }

  // Are the player's shots those of the range (no panic in the street, no police)?
  get muffled() { return !!this.inside && this.zone === 'range'; }

  // A shot of the player's, for the paper targets: world ray, and how far it flew
  shot(origin, dir, reach) {
    const site = this.inside;
    if (!site || this.zone !== 'range' || site !== this.world.live?.site) return null;
    const o = calibreLocal(site, origin.x, origin.z), d = { x: dir.x * site.nz - dir.z * site.nx, y: dir.y, z: dir.x * site.nx + dir.z * site.nz };
    return this.range.shot({ x: o.x, y: origin.y - CALIBRE.floor, z: o.z }, d, reach);
  }

  // How far along a sight line a paper target is crossed (world ray), or -1
  sight(origin, dir, reach) {
    const site = this.inside;
    if (!site || site !== this.world.live?.site) return -1;
    const o = calibreLocal(site, origin.x, origin.z), d = { x: dir.x * site.nz - dir.z * site.nx, y: dir.y, z: dir.x * site.nx + dir.z * site.nz };
    let best = -1;
    for (const target of this.world.targets) {
      const hit = target.cross({ x: o.x, y: origin.y - CALIBRE.floor, z: o.z }, d, reach);
      if (hit && (best < 0 || hit.t < best)) best = hit.t;
    }
    return best;
  }

  // Trouble in a branch: the gunsmith takes his shotgun from under the counter, the customers run, the branch shuts
  alarm(site, quiet = false) {
    const g = this.game, first = (this.closed.get(site.id) || 0) <= this.clock;
    this.closed.set(site.id, this.clock + CLOSED_FOR);
    if (g.shops.open?.id === site.id) g.shops.close();
    if (this.range.session) this.range.stop(false);
    if (!first || site !== this.branch) return;
    const clerk = this.clerk;
    if (clerk && !clerk.dead) {
      Object.assign(clerk, { hostile: true, alert: true, behavior: 'combat', weapon: 'shotgun', mag: 6, accuracy: 0.45, cooldown: 1.3 });
      clerk.rig.crouchTarget = 0; clerk.rig.handsUpTarget = 0;
      clerk.model.setWeapon('shotgun');
      if (!quiet) this.say('fight', true);
    }
    for (const a of this.cast) if (a !== clerk && !a.dead) { a.panic = true; a.model.setWeapon(null); a.rig.aim = null; }
    g.crime('aim', g.player.x, g.player.z);
    g.toast('CALIBRE', 'L’armurier défend sa boutique. La succursale ferme.');
  }

  populate(site) {
    const g = this.game;
    for (const actor of this.cast) if (g.actors.actors.includes(actor)) g.actors.remove(actor);
    this.cast = []; this.clerk = null; this.branch = site; this.warned = 0;
    if (!site || (this.closed.get(site.id) || 0) > this.clock) return;
    const inward = Math.atan2(-site.nx, -site.nz), outward = Math.atan2(site.nx, site.nz);
    const spawn = (local, heading, options) => {
      const p = calibrePoint(site, local.x, local.z);
      const a = g.actors.spawn({ ...p, y: CALIBRE.floor, heading, team: 'calibre', weapon: 'fists', behavior: 'idle', hostile: false, alert: false, tag: site.id, ...options });
      if (a) { a.onHurt = () => this.alarm(site); this.cast.push(a); }
      return a;
    };
    const turnTo = (actor, heading, dt, rate = 4) => { actor.heading += Math.atan2(Math.sin(heading - actor.heading), Math.cos(heading - actor.heading)) * Math.min(1, dt * rate); };
    const walk = (actor, to, dt, speed) => {
      const dx = to.x - actor.x, dz = to.z - actor.z, distance = Math.hypot(dx, dz);
      if (distance < 0.06) return true;
      const step = Math.min(distance, dt * speed);
      actor.x += dx / distance * step; actor.z += dz / distance * step;
      turnTo(actor, Math.atan2(dx, dz), dt, 7);
      return false;
    };
    const facing = (lx, lz) => Math.atan2(site.nz * lx + site.nx * lz, -site.nx * lx + site.nz * lz);

    // The gunsmith: at his post behind the mat, turning to whoever walks in, sliding along the counter to a customer
    const clerk = this.clerk = spawn(CLERK_HOME, outward, { look: LOOKS.clerk ? 'clerk' : 'guard', name: 'Armurier CALIBRE', hp: 150 });
    if (clerk) clerk.pilot = (actor, dt, target) => {
      if (actor.hostile) return false; // the fight is the actors' own business
      const mine = calibreLocal(site, actor.x, actor.z), p = calibreLocal(site, target.x, target.z);
      const serving = g.shops.open?.site === site;
      const wantX = serving ? CLERK_HOME.x : this.inside === site && this.zone === 'shop' && p.z < -4.4 && p.z > PLAN.counter.z ? Math.max(-3.4, Math.min(1.4, p.x)) : CLERK_HOME.x;
      const to = calibrePoint(site, wantX, CLERK_HOME.z);
      if (Math.abs(wantX - mine.x) > 0.25 && !walk(actor, to, dt, 1.25)) return true;
      const near = Math.hypot(target.x - actor.x, target.z - actor.z) < 11 && this.inside === site;
      turnTo(actor, near && !serving ? Math.atan2(target.x - actor.x, target.z - actor.z) : outward, dt);
      return true;
    };

    // Two customers browsing the shelves, the racks and the cases
    for (let i = 0; i < 2; i++) {
      const route = ROUTES[i], look = ['suit', 'crew'][(i + site.variant) % 2];
      const a = spawn(route[0], inward, { look, name: 'Client CALIBRE' });
      if (!a) continue;
      a.leg = 0; a.pause = 2 + i * 3;
      a.pilot = (actor, dt, target) => {
        if (actor.panic) {
          // out through the door, then away down the street on the actors' own legs
          const local = calibreLocal(site, actor.x, actor.z);
          const steps = [{ x: local.x, z: -1.75 }, { x: 0, z: -1.75 }, { x: 0, z: 2.6 }];
          if (local.z > 2.2 || actor.stage > 2) { actor.pilot = null; actor.behavior = 'flee'; actor.alert = true; return false; }
          actor.stage ??= local.z > -2.2 ? 1 : 0;
          const to = calibrePoint(site, steps[actor.stage].x, steps[actor.stage].z);
          const before = { x: actor.x, z: actor.z };
          if (walk(actor, to, dt, 3.6)) actor.stage++;
          else {
            const position = { x: actor.x, y: actor.y, z: actor.z };
            g.controllers.resolveHorizontalCollision(position, 0.28, null, null, 'person');
            actor.x = position.x; actor.z = position.z;
            if (Math.hypot(actor.x - before.x, actor.z - before.z) < dt * 0.4) actor.stage++; // stuck against something: next step
          }
          return true;
        }
        const stop = route[actor.leg], to = calibrePoint(site, stop.x, stop.z);
        if (actor.pause > 0) {
          actor.pause -= dt;
          if (stop.look) turnTo(actor, facing(stop.look[0], stop.look[1]), dt);
          if (actor.pause <= 0) actor.leg = (actor.leg + 1) % route.length;
          return true;
        }
        // someone in the way: wait
        if (Math.hypot(target.x - actor.x, target.z - actor.z) < 0.95) return true;
        if (walk(actor, to, dt, 0.85)) { actor.pause = stop.wait || 0; if (!stop.wait) actor.leg = (actor.leg + 1) % route.length; }
        return true;
      };
    }

    // A regular at the first booth, emptying magazines into his sheet
    const regular = spawn(REGULAR, inward, { look: site.variant % 2 ? 'crew' : 'suit', name: 'Habitué du stand' });
    if (regular) {
      regular.model.setWeapon('pistol', true);
      regular.next = 3 + Math.random() * 3; regular.burst = 0;
      const muzzle = new THREE.Vector3(), aim = new THREE.Vector3();
      regular.pilot = (actor, dt) => {
        if (actor.panic) { actor.rig.aim = null; actor.rig.crouchTarget = 1; actor.rig.handsUpTarget = 0.7; return true; }
        const target = this.world.targets[0], sheet = calibrePoint(site, PLAN.lanes[0] + target.x, PLAN.line.z + PLAN.line.depth / 2 + 0.35 - target.d);
        aim.set(sheet.x, CALIBRE.floor + 1.42, sheet.z);
        turnTo(actor, inward, dt);
        actor.rig.aim = { x: aim.x, y: aim.y, z: aim.z, twoHanded: true, stance: 'pistol' };
        actor.rig.gunReady = true;
        actor.next -= dt;
        if (actor.next > 0 || !actor.model.armed) return true;
        // a shot: flash, report, a new hole in the paper
        actor.model.muzzle(muzzle); actor.model.fired();
        const dx = aim.x - muzzle.x, dy = aim.y - muzzle.y, dz = aim.z - muzzle.z, l = Math.hypot(dx, dy, dz) || 1;
        g.fx.muzzleFlash(muzzle, { x: dx / l, y: dy / l, z: dz / l }, 'pistol', { id: actor, vx: 0, vy: 0, vz: 0 });
        g.audio.sfx('pistol', muzzle.x, muzzle.y, muzzle.z, { intensity: 0.8 });
        target.hole((Math.random() - 0.5) * 0.24, (Math.random() - 0.5) * 0.3);
        if (++actor.burst >= 12) { actor.burst = 0; actor.next = 5 + Math.random() * 6; target.clear(); }
        else actor.next = actor.burst % 3 ? 0.55 + Math.random() * 0.5 : 1.6 + Math.random() * 2.2;
        return true;
      };
    }
  }

  update(dt) {
    const g = this.game; this.clock += dt;
    const p = g.person.position, onFoot = g.state === 'onFoot';
    const inside = p.y < 2.5 && onFoot ? this.contains(p.x, p.z) : null;
    this.local = inside ? calibreLocal(inside, p.x, p.z) : null;
    const zone = inside ? calibreZone(this.local.x, this.local.z) : null;
    if (inside && inside !== this.inside && g.playing) g.audio.ui('shop');
    if (inside && zone === 'range' && this.zone === 'shop' && this.clerk && !this.clerk.hostile) this.say('range');
    this.inside = inside; this.zone = zone;
    // the eye settles on the lamps indoors, whatever the hour outside
    if (g.atmosphere) g.atmosphere.indoor = inside ? 1 : 0;

    if (dt > 0) {
      let nearest = null, distance = 80;
      for (const site of this.sites) { const d = Math.hypot(p.x - site.x, p.z - site.z); if (d < distance) { distance = d; nearest = site; } }
      const shut = nearest && (this.closed.get(nearest.id) || 0) > this.clock;
      if (nearest !== this.branch) this.populate(nearest);
      else if (nearest && !this.cast.length && !shut) this.populate(nearest);
      // the trouble is over and the customer has left: the branch opens again with its people at their posts
      else if (nearest && !shut && !inside && distance > 22 && this.cast.some((a) => a.hostile || a.panic || a.dead)) this.populate(nearest);

      const clerk = this.clerk, calm = clerk && !clerk.dead && !clerk.hostile;
      if (inside && inside === this.branch && calm) {
        // a welcome once he has seen the customer; a firearm raised in the shop gets one warning, then his shotgun
        if (zone === 'shop' && this.greeted !== inside && this.local.z < -1.2) { this.greeted = inside; this.say(g.wanted.level ? 'police' : 'greet', true); }
        const armed = g.weaponId !== 'fists' && g.weaponId !== 'grapple' && (g.player.threat || g.fireHeld);
        if (zone === 'shop' && armed) {
          if (!this.warned) { this.warned = this.clock; this.say('warn', true); }
          else if (this.clock - this.warned > 1.7 || g.fireHeld) this.alarm(inside);
        } else if (this.warned && this.clock - this.warned > 6) this.warned = 0;
      }
      if (!inside && this.greeted && distance > 40) this.greeted = null;
      if (g.shops.open?.calibre && (!this.atCounterOpen() || !this.available(g.shops.open))) g.shops.close();
      this.range.update(dt, zone === 'range' && inside === this.world.live?.site ? this.local : null);
    }
    const shown = this.counter.presented;
    if (shown) this.frame(shown.site, shown.id);
    this.world.update(g.camera.camera, g.player, dt, shown, this.cast, cityUniforms.uNight.value);
  }

  // While the counter is open the customer stays where openCounter put him
  atCounterOpen() {
    const g = this.game;
    return g.state === 'onFoot' && !!this.inside && this.zone === 'shop';
  }
}

export { CalibreSystem, LINES };
