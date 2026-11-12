import { streetZ } from './city-config.js';
import { AIDriver } from './ai-driver.js';

// Who holds which part of town. Each neighbourhood belongs to a crew: its people stand on its corners, shoot what comes too
// close and send a car after whoever kills them. Clear a crew out of its hideout and the neighbourhood is yours: it pays you.

const GANGS = {
  dockers: { name: 'Les Dockers', colour: '#ff9a3c', looks: ['crew', 'guard'], arms: ['pistol', 'smg', 'shotgun'], accuracy: 0.42, paint: 0x3b2a18 },
  meute: { name: 'La Meute', colour: '#ff5a5a', looks: ['crew'], arms: ['pistol', 'pistol', 'smg'], accuracy: 0.38, paint: 0x4a0e12 },
  syndic: { name: 'Le Syndic', colour: '#c99bff', looks: ['suit', 'guard'], arms: ['pistol', 'smg', 'rifle'], accuracy: 0.5, paint: 0x101014 }
};

// [west, east, north, south] in world metres
const ZONES = [
  { id: 'quais', name: 'Chelsea Ouest', gang: 'dockers', box: [-1490, -1090, streetZ(45), streetZ(20)], hq: { x: -1393, z: streetZ(32) + 45 }, income: 900 },
  { id: 'kitchen', name: 'Hell’s Kitchen', gang: 'meute', box: [-1330, -600, streetZ(59), streetZ(42)], hq: { x: -1100, z: streetZ(50) + 40 }, income: 1200 },
  { id: 'harlem', name: 'Harlem', gang: 'meute', box: [-900, 570, -6330, streetZ(112)], hq: { x: 12, z: streetZ(118) + 30 }, income: 1000 },
  { id: 'lower', name: 'Lower East Side', gang: 'dockers', box: [300, 1120, 3376, 4300], hq: { x: 900, z: 3800 }, income: 1400 },
  { id: 'chinatown', name: 'Chinatown', gang: 'syndic', box: [-350, 300, 4170, 4850], hq: { x: 0, z: 4500 }, income: 1800 },
  { id: 'finance', name: 'Financial District', gang: 'syndic', box: [-285, 640, 4860, 6025], hq: { x: 265, z: 5450 }, income: 2600 }
];
const inBox = (z, x, y) => x > z.box[0] && x < z.box[1] && y > z.box[2] && y < z.box[3];
const zoneAt = (x, z) => ZONES.find((zone) => inBox(zone, x, z)) ?? null;

const PAY_EVERY = 240; // seconds of play between payouts
const CREW_EVERY = 11;
const MAX_CORNERS = 5;

// What it takes to clear a crew out of its hideout, as a job the director runs
function takeover(zone) {
  const gang = GANGS[zone.gang];
  return {
    id: `prise-${zone.id}`,
    title: `OPA SUR ${zone.name.toUpperCase()}`,
    act: 'TERRITOIRE',
    contactLabel: `Repaire · ${gang.name}`,
    zone,
    *run(m) {
      const g = m.game;
      const hq = m.spot(zone.hq.x, zone.hq.z, 0.6);
      m.objective(`Rejoignez le repaire de *${gang.name}* : ${zone.name}.`);
      let mk = m.mark(hq.x, hq.z, 'target', { radius: 5 });
      m.gps(hq.x, hq.z);
      const arm = (i) => gang.arms[i % gang.arms.length];
      const body = (i, r, opts = {}) => {
        const a = (i * 2.4) % 6.28;
        const s = m.spot(hq.x + Math.cos(a) * r, hq.z + Math.sin(a) * r, 0.5);
        return m.spawnActor({ x: s.x, z: s.z, heading: a, look: gang.looks[i % gang.looks.length], team: zone.gang, weapon: arm(i), hp: 90, armor: 10,
          behavior: 'guard', hostile: true, accuracy: gang.accuracy, alert: false, ...opts });
      };
      const first = Array.from({ length: 6 }, (_, i) => body(i, 10 + (i % 3) * 5));
      yield* m.waitFor(() => m.near(hq.x, hq.z, 55) || first.some((a) => a?.alert));
      m.unmark(mk);
      g.actors.alertTeam(zone.gang, hq.x, hq.z, 120);
      m.say1('JULES', `${gang.name} t’ont repéré. Une OPA, ça se paie comptant.`);
      const clear = (list) => list.every((a) => !a || a.dead);
      m.objective('Éliminez les *hommes de main*.');
      yield* m.waitFor(() => clear(first));
      m.objective('Des *renforts* arrivent.');
      const road = m.randomRoadSpot(hq.x, hq.z, 45, 110);
      const van = m.spawnNpcCar('suv', road.x, road.z, road.heading, gang.paint, { label: gang.name, hp: 160, maxSpeed: 24, corner: 11 });
      const stop = m.roadSpotNear(hq.x, hq.z);
      m.driveTo(van, stop.x, stop.z, { stopAt: 9 });
      let second = [];
      yield* m.waitFor(() => m.arrived(van) || m.disabled(van) || m.near(van.position.x, van.position.z, 18));
      if (!m.disabled(van)) second = m.unload(van, [0, 1, 2].map((i) => ({ look: gang.looks[i % gang.looks.length], team: zone.gang, weapon: arm(i + 1), hp: 100, armor: 20, behavior: 'combat', hostile: true, alert: true, accuracy: gang.accuracy + 0.06 })));
      const late = Array.from({ length: 3 }, (_, i) => body(i + 7, 22, { behavior: 'combat', alert: true }));
      yield* m.waitFor(() => clear(second) && clear(late));
      const boss = body(13, 8, { look: gang.looks[0], weapon: 'rifle', hp: 240, armor: 70, behavior: 'combat', alert: true, accuracy: 0.56, name: 'Lieutenant' });
      mk = m.markOn(boss, 'target');
      m.objective('Abattez le *lieutenant*.');
      yield* m.waitFor(() => clear([boss]));
      m.unmark(mk);
      g.gangs.capture(zone);
      m.complete(3000 + zone.income * 3, `${zone.name} est à vous`);
    }
  };
}

class GangSystem {
  constructor(game) {
    this.game = game;
    this.zones = ZONES;
    this.held = new Set();
    this.zone = null;
    this.corners = [];
    this.crewT = 6;
    this.payT = PAY_EVERY;
    this.anger = 0;
    this.hit = null; // the car a crew sends after you
  }

  get gangs() { return GANGS; }
  get income() { return ZONES.reduce((n, z) => n + (this.held.has(z.id) ? z.income : 0), 0); }

  capture(zone) {
    const g = this.game;
    this.held.add(zone.id);
    for (const a of this.corners) if (a.team === zone.gang && !a.dead) g.actors.remove(a);
    g.phone?.text('JULES', `${zone.name} est à toi. ${zone.income.toLocaleString('fr-FR')} $ tomberont sur ton compte à chaque échéance.`);
    g.save();
  }

  // Jobs on offer: every hideout not yet taken
  takeovers() {
    return ZONES.filter((z) => !this.held.has(z.id)).map((z) => ({ def: takeover(z), place: { ...z.hq, name: z.name }, kind: 'target', label: `Repaire · ${GANGS[z.gang].name}`, story: false }));
  }

  onKilled(actor) {
    if (!GANGS[actor.team]) return;
    this.game.addMoney(40 + Math.floor(Math.random() * 90));
    if (++this.anger >= 3 && !this.hit) this.sendHit(actor.team);
  }

  // A car full of bad intentions, from a block or two away
  sendHit(team) {
    const g = this.game, gang = GANGS[team], pl = g.player;
    const n = g.nav.nearest(pl.x + (Math.random() - 0.5) * 200, pl.z + (Math.random() - 0.5) * 200, 120);
    if (n < 0) return;
    const node = g.nav.nodes[n];
    if (Math.hypot(node.x - pl.x, node.z - pl.z) < 70) return;
    const car = g.makeCar('muscle', gang.paint, { x: node.x, y: 0, z: node.z }, Math.atan2(pl.x - node.x, pl.z - node.z), false, true);
    car.locked = true;
    car.ai = { mode: 'gang' };
    car.hp = 140;
    car.driver = new AIDriver(g.controllers, g.nav, car, { maxSpeed: 44, corner: 13, traffic: g.traffic.vehicles });
    car.driver.others = g.allCars;
    car.driver.aggressive = true;
    this.hit = { car, gang, gunT: 1 };
    this.anger = 0;
    g.toast(gang.name, 'Une voiture vous cherche.');
  }

  updateHit(dt) {
    const { hit, game: g } = this;
    if (!hit) return;
    const car = hit.car, pl = g.player;
    const d = Math.hypot(car.position.x - pl.x, car.position.z - pl.z);
    if (car.destroyed || !g.fleet.includes(car) || d > 340 || !pl.alive) {
      if (!car.destroyed && g.fleet.includes(car)) g.removeFleetCar(car);
      this.hit = null;
      return;
    }
    car.driver.setGoal(pl.x + pl.vx * 0.6, pl.z + pl.vz * 0.6);
    car.driver.update(dt, { direct: d < 30 });
    car.mesh.position.copy(car.position);
    car.mesh.rotation.y = car.heading;
    hit.gunT -= dt;
    if (hit.gunT <= 0 && d < 34) {
      hit.gunT = 0.45 + Math.random() * 0.7;
      g.policeShot(car.position.x, car.position.y + 1.2, car.position.z, 0.26 * (1 - d / 55), 9);
    }
  }

  // Lookouts on the corners of a hostile neighbourhood, out of the camera's sight
  updateCorners(dt, zone) {
    const g = this.game, pl = g.player;
    for (let i = this.corners.length - 1; i >= 0; i--) {
      const a = this.corners[i];
      if (!g.actors.actors.includes(a)) { this.corners.splice(i, 1); continue; }
      if (Math.hypot(a.x - pl.x, a.z - pl.z) > 190) { g.actors.remove(a); this.corners.splice(i, 1); }
    }
    this.crewT -= dt;
    if (this.crewT > 0 || !zone || this.held.has(zone.id) || g.director.current || this.corners.length >= MAX_CORNERS || g.actors.count > 10 || !pl.alive) return;
    this.crewT = CREW_EVERY;
    const gang = GANGS[zone.gang];
    const a = Math.random() * 6.28, r = 55 + Math.random() * 30;
    const base = g.safeSpot(pl.x + Math.cos(a) * r, pl.z + Math.sin(a) * r, 0.5);
    if (!inBox(zone, base.x, base.z)) return;
    for (let i = 0; i < 2 + (Math.random() < 0.5 ? 1 : 0); i++) {
      const s = g.safeSpot(base.x + (i - 1) * 2.2, base.z + i * 1.4, 0.5);
      const actor = g.actors.spawn({ x: s.x, z: s.z, heading: Math.random() * 6.28, look: gang.looks[i % gang.looks.length], team: zone.gang, weapon: gang.arms[i % gang.arms.length],
        hp: 80, behavior: 'guard', hostile: true, accuracy: gang.accuracy, alert: false });
      if (actor) this.corners.push(actor);
    }
  }

  update(dt) {
    const g = this.game, pl = g.player;
    const zone = zoneAt(pl.x, pl.z);
    if (zone !== this.zone) {
      this.zone = zone;
      if (zone && !pl.flying) {
        const held = this.held.has(zone.id);
        g.hud.zone?.(zone.name, held ? 'Votre territoire' : GANGS[zone.gang].name, held ? '#e1f3a0' : GANGS[zone.gang].colour);
      }
    }
    // no lookouts round a player left waiting while the Architect holds the camera
    if (!g.architect?.spectating) this.updateCorners(dt, zone);
    this.updateHit(dt);
    if (this.held.size && (this.payT -= dt) <= 0) {
      this.payT = PAY_EVERY;
      g.addMoney(this.income);
      g.phone?.text('BANQUE', `Échéance encaissée : +${this.income.toLocaleString('fr-FR')} $ de vos territoires.`);
    }
  }

  draw(ctx, toX, toY) {
    for (const z of ZONES) {
      const held = this.held.has(z.id), colour = held ? '#e1f3a0' : GANGS[z.gang].colour;
      const x = toX(z.box[0]), y = toY(z.box[2]), w = toX(z.box[1]) - x, h = toY(z.box[3]) - y;
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
      ctx.globalAlpha = 1;
      if (!held) {
        const hx = toX(z.hq.x), hy = toY(z.hq.z);
        ctx.fillStyle = colour;
        ctx.beginPath(); ctx.arc(hx, hy, 4, 0, 6.28); ctx.fill();
        ctx.fillStyle = '#10140f';
        ctx.fillRect(hx - 1, hy - 2.4, 2, 4.8);
      }
    }
  }
}

export { GANGS, GangSystem, ZONES, takeover, zoneAt };
