import { FRONTIER_CRATE, FRONTIER_SITES, frontierOpen, frontierPoint } from './frontier-districts.js';

const ARRIVAL = 155, LEAVING = 215;
const MARKET = FRONTIER_SITES[0];
const REWARD = 850;
const counter = site => frontierPoint(site, 0.6, site.depth / 2 + 3);
const range = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class FrontierLife {
  constructor(game) {
    this.game = game;
    this.cast = [];
    this.site = null;
    this.onShift = false;
    this.populated = false;
    this.scan = 0;
    this.dialogue = new Map();
    this.closedUntil = new Map();
    this.marker = null;
    this.waypoint = null;
    if (game.frontierDelivery === 'aller' || game.frontierDelivery === 'retour') this.guide();
  }

  get stage() { return this.game.frontierDelivery; }

  unload() {
    const { actors } = this.game;
    for (const { actor, host } of this.cast) {
      if (host && actor.dead) this.closedUntil.set(this.site.id, this.game.clock + 180);
      if (!actor.dead && actors.actors.includes(actor)) actors.remove(actor);
    }
    this.cast.length = 0;
  }

  populate(site, open) {
    const { actors } = this.game, w = site.width / 2, d = site.depth / 2;
    const paths = [
      { host: true, look: site.type === 'garage' ? 'crew' : 'clerk', at: [[0.6, d + 3]], heading: site.yaw },
      { host: false, look: 'crew', at: [[w + 3.1, d + 3.2], [w + 2.5, d - 2.2], [w + 5.2, d - 3.2], [w + 6.2, d + 4.1]], heading: site.yaw },
      { host: false, look: 'clerk', at: [[-w - 2.4, d + 3.8], [-w - 5.4, d + 4.2], [-w - 5.7, d + 9.9]], heading: site.yaw - 1 }
    ];
    const layouts = open ? paths : [paths[2]];
    for (const { host, look, at, heading } of layouts) {
      if (host && (this.closedUntil.get(site.id) ?? 0) > this.game.clock) continue;
      const stations = at.map(([x, z]) => {
        const point = frontierPoint(site, x, z);
        return this.game.safeSpot(point.x, point.z, 0.45);
      });
      const actor = actors.spawn({ ...stations[0], heading, look, team: 'frontier', weapon: 'fists', behavior: 'idle',
        hostile: false, alert: false, female: host && ['lisieres', 'serres', 'balance'].includes(site.id), name: host ? site.resident : '' });
      if (!actor) continue;
      const assignment = { actor, host, heading, stations, next: stations.length > 1 ? 1 : 0, rest: 2.2 + this.cast.length, panic: 0 };
      this.cast.push(assignment);
      actor.pilot = (a, dt, target) => this.moveResident(assignment, a, dt, target);
    }
  }

  moveResident(job, actor, dt, target) {
    const { actors, wanted } = this.game;
    const near = range(actor, target);
    if ((actor.alert || wanted.level >= 3) && near < 28) job.panic = 9;
    if (job.panic > 0) {
      job.panic -= dt;
      const heading = Math.atan2(actor.x - target.x, actor.z - target.z);
      actor.rig.crouchTarget = 0;
      actors.step(actor, dt, Math.sin(heading), Math.cos(heading), 3.1, heading);
      return true;
    }
    actor.alert = false;
    actor.height = 1.8;
    const goal = job.stations[job.next];
    const dist = range(actor, goal);
    const talking = job.host && target.onFoot && near < 4;
    if (job.rest > 0 || dist < 0.45 || talking) {
      job.rest -= dt;
      actor.rig.crouchTarget = !job.host && !talking && job.next === 2 ? 0.42 : 0;
      const heading = talking ? Math.atan2(target.x - actor.x, target.z - actor.z) : job.heading + (job.host ? 0 : job.next * 1.2);
      actors.step(actor, dt, 0, 0, 0, heading);
      if (dist < 0.45 && job.rest <= 0 && job.stations.length > 1) {
        job.next = (job.next + 1) % job.stations.length;
        // Pause at the next station, after walking there.
        job.arrivalPause = 3.5 + job.next * 1.6;
      }
      return true;
    }
    actor.rig.crouchTarget = 0;
    const dx = goal.x - actor.x, dz = goal.z - actor.z;
    actors.step(actor, dt, dx / dist, dz / dist, job.host ? 1.08 : 1.33, Math.atan2(dx, dz));
    if (range(actor, goal) < 0.45) {
      job.rest = job.arrivalPause ?? 4;
      job.arrivalPause = 0;
    }
    return true;
  }

  update(dt, player) {
    this.scan -= dt;
    if (this.scan > 0) return;
    this.scan = 0.4;
    const { atmosphere, director } = this.game;
    const site = this.site && range(this.site, player) < LEAVING
      ? this.site : FRONTIER_SITES.find(p => range(p, player) < ARRIVAL) ?? null;
    const open = !!site && frontierOpen(site, atmosphere.hour);
    const populate = Boolean(site && !director.current);
    if (site === this.site && open === this.onShift && populate === this.populated) return;
    this.unload();
    this.site = site;
    this.onShift = open;
    this.populated = populate;
    if (populate) this.populate(site, open);
  }

  canReach(point, distance) {
    const g = this.game, p = g.player;
    if (range(p, point) > distance) return false;
    return Math.abs(p.y - g.controllers.getGroundHeight(point.x, point.z, 'person')) < 2.4;
  }

  prompt() {
    const g = this.game;
    if (g.state !== 'onFoot' || !g.player.alive || g.director.current || g.player.speed > 2) return null;
    if (this.stage === 'aller' && this.canReach(FRONTIER_CRATE, 3.4)) return { text: 'Ramasser le filtre', sub: FRONTIER_CRATE.name };
    if (this.stage === 'retour' && this.canReach(counter(MARKET), 3.8)) return { text: 'Livrer le filtre', sub: MARKET.name };
    const host = this.cast.find(job => job.host && !job.actor.dead && job.panic <= 0)?.actor;
    if (!host || !this.canReach(host, 3.4)) return null;
    if (this.site === MARKET && !this.stage) return { text: 'Demander du travail à Leïla', sub: MARKET.name };
    return { text: 'Parler à ' + this.site.resident, sub: this.site.name };
  }

  guide() {
    const g = this.game;
    if (this.marker) g.markers.remove(this.marker);
    const out = this.stage === 'aller';
    const point = out ? FRONTIER_CRATE : counter(MARKET);
    this.marker = g.markers.add(point.x, point.z, { kind: 'destination', radius: out ? 0.95 : 1.4, height: out ? 1.25 : 2.2, label: out ? 'Filtre de la pépinière' : MARKET.name });
    this.waypoint = { ...point, name: out ? FRONTIER_CRATE.name : MARKET.name, direct: true };
    g.map.waypoint = this.waypoint;
  }

  interact() {
    const offer = this.prompt();
    if (!offer) return false;
    const g = this.game;
    if (this.stage === 'aller' && this.canReach(FRONTIER_CRATE, 3.4)) {
      g.frontierDelivery = 'retour';
      this.guide();
      g.toast('Filtre récupéré', 'Rapportez-le au Marché des Lisières.');
      g.audio.ui('checkpoint');
      g.save();
      return true;
    }
    if (this.stage === 'retour' && this.canReach(counter(MARKET), 3.8)) {
      g.frontierDelivery = 'livré';
      g.addMoney(REWARD);
      g.markers.remove(this.marker);
      this.marker = null;
      if (g.map.waypoint === this.waypoint) g.map.waypoint = null;
      if (this.cast.some(job => job.host && !job.actor.dead && job.panic <= 0)) {
        g.hud.say('LEÏLA', 'Demain, on pourra arroser avant le lever du soleil. Pose le filtre, je m’occupe du reste.', 5.5);
      }
      g.toast('De l’eau pour les Lisières', 'Filtre livré · 850 $');
      g.audio.ui('pass');
      g.save();
      return true;
    }
    if (this.site === MARKET && !this.stage) {
      g.frontierDelivery = 'aller';
      g.hud.say('LEÏLA', 'La pompe avale du sable. À l’ancienne pépinière, il reste un filtre dans la caisse près du fût bleu. Tu me le rapportes ?', 7);
      this.guide();
      g.save();
      return true;
    }
    const n = this.dialogue.get(this.site.id) ?? 0;
    const { resident, lines } = this.site;
    g.hud.say(resident.toUpperCase(), lines[n % lines.length], 6);
    this.dialogue.set(this.site.id, n + 1);
    return true;
  }
}
