import * as THREE from 'three/webgpu';
import { uv, smoothstep, sin, time } from 'three/tsl';
import { streetZ } from './city-config.js';
import { RoadNavigator } from './navigation.js';

// Missions, activities, world markers and pickups. Missions are generator scripts: each `yield` waits a frame, so a
// mission reads as a sequence (talk, steal this, drive there, survive) while the director checks failures every frame.

// ---- Places (world metres: +x east, +z south; avenues at fixed x, streets at streetZ(n)) ----------------------------
const PLACES = {
  spawn: { x: 11.9, z: streetZ(37) + 19, name: '5e Avenue' },
  garage: { x: -1398.5, z: streetZ(44) + 38, name: 'Garage Okafor', road: { x: -1404, z: streetZ(44) + 38 } },
  debtor: { x: -846, z: streetZ(29) + 35, name: '8e Avenue & 29e Rue' },
  crew: { x: -1670, z: streetZ(34) + 45, name: '11e Avenue & 34e Rue' },
  pier: { x: -1950, z: streetZ(40) + 2, name: 'Quai 76' },
  meet: { x: 265, z: 5753, name: 'Wall Street', nearRoad: true },
  safehouse: { x: 1079, z: streetZ(12) + 40, name: 'Planque de la 1re Avenue' },
  raceStart: { x: -846, z: streetZ(57) + 30, name: '8e Avenue & 57e Rue', road: { x: -856, z: streetZ(57) + 30 } },
  bounty: { x: 466.5 + 11, z: streetZ(31) + 30, name: 'Lexington & 31e Rue' }
};
const HOSPITALS = [
  { x: 1080, z: streetZ(27) + 30, name: 'Hôpital Sainte-Claire' },
  { x: -1397, z: streetZ(58) + 30, name: 'Clinique de l’Ouest' },
  { x: 300, z: streetZ(1) + 1300, name: 'Hôpital du Port' },
  { x: 12, z: streetZ(96) + 30, name: 'Hôpital du Nord' }
];
const PRECINCTS = [
  { x: -1000, z: streetZ(35) + 20, name: 'Commissariat Midtown-Sud' },
  { x: -296, z: streetZ(1) + 900, name: 'Commissariat du Port' },
  { x: 633, z: streetZ(67) + 30, name: 'Commissariat de l’Est' }
];

// ---- World markers ---------------------------------------------------------------------------------------------
const MARKER_COLORS = { objective: 0xffd54a, destination: 0x5ec8ff, contact: 0xe1f3a0, target: 0xff4d4d, race: 0xff9a3c };

function markerMaterial(hex) {
  const m = new THREE.MeshBasicNodeMaterial({ color: hex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const y = uv().y;
  m.opacityNode = smoothstep(1.0, 0.0, y).pow(1.8).mul(sin(time.mul(3.0)).mul(0.15).add(0.55));
  return m;
}
function ringMaterial(hex) {
  const m = new THREE.MeshBasicNodeMaterial({ color: hex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const r = uv().sub(0.5).length().mul(2.0);
  m.opacityNode = smoothstep(0.7, 0.95, r).mul(smoothstep(1.0, 0.95, r)).mul(0.9).add(smoothstep(1.0, 0.0, r).mul(0.12));
  return m;
}

class MarkerSystem {
  constructor(scene, count = 8) {
    this.root = new THREE.Group();
    this.root.name = 'MissionMarkers';
    scene.add(this.root);
    const column = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0);
    const disc = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
    this.markers = [];
    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();
      const colMat = markerMaterial(0xffffff), ringMat = ringMaterial(0xffffff);
      const col = new THREE.Mesh(column, colMat);
      const ring = new THREE.Mesh(disc, ringMat);
      col.renderOrder = ring.renderOrder = 994;
      group.add(col, ring);
      group.visible = i === 0; // one stays drawn until warm-up
      group.position.set(0, -50, 0);
      this.root.add(group);
      this.markers.push({ group, col, ring, colMat, ringMat, used: false, x: 0, z: 0, radius: 2, height: 3, follow: null, kind: 'objective', label: '' });
    }
    this.frames = 0;
  }

  add(x, z, { kind = 'objective', radius = 2.2, height = 3.2, follow = null, label = '', blip = true } = {}) {
    const m = this.markers.find((k) => !k.used);
    if (!m) return null;
    Object.assign(m, { used: true, x, z, radius, height, follow, kind, label, blip });
    const color = new THREE.Color(MARKER_COLORS[kind] ?? MARKER_COLORS.objective);
    m.colMat.color.copy(color);
    m.ringMat.color.copy(color);
    m.group.visible = true;
    return m;
  }

  remove(m) {
    if (!m) return;
    m.used = false;
    m.follow = null;
    m.group.visible = false;
  }

  clear() { for (const m of this.markers) this.remove(m); }

  update(ground) {
    this.frames++;
    for (const m of this.markers) {
      if (!m.used) { if (this.frames > 4) m.group.visible = false; continue; }
      if (m.follow) { m.x = m.follow.position ? m.follow.position.x : m.follow.x; m.z = m.follow.position ? m.follow.position.z : m.follow.z; }
      const y = ground(m.x, m.z);
      m.group.position.set(m.x, y + 0.04, m.z);
      const followed = !!m.follow;
      m.col.scale.set(followed ? 0.5 : m.radius * 0.55, followed ? 2.2 : m.height, followed ? 0.5 : m.radius * 0.55);
      m.col.position.y = followed ? 2.4 : 0;
      m.ring.scale.set(m.radius, 1, m.radius);
      m.ring.visible = !followed;
      m.group.updateMatrixWorld(true);
    }
  }
}

// ---- Pickups ---------------------------------------------------------------------------------------------------
const PICKUP_STYLE = {
  cash: { color: 0x7ee08a, label: '$' },
  health: { color: 0xff5a5a, label: '+' },
  armor: { color: 0x6aa8ff, label: 'GILET' },
  pistol: { color: 0xffd54a, label: 'CALYPSO 9' },
  smg: { color: 0xffd54a, label: 'HORNET' },
  shotgun: { color: 0xffd54a, label: 'BREAKER 12' },
  package: { color: 0xffb84a, label: 'COLIS' }
};

class PickupSystem {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'Pickups';
    scene.add(this.root);
    this.items = [];
    const glowMat = (hex) => {
      const m = new THREE.MeshBasicNodeMaterial({ color: hex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      m.opacityNode = smoothstep(1.0, 0.0, uv().sub(0.5).length().mul(2.0)).mul(0.6);
      return m;
    };
    this.shapes = {};
    for (const [kind, style] of Object.entries(PICKUP_STYLE)) {
      const body = new THREE.MeshStandardNodeMaterial({ color: style.color, emissive: style.color, emissiveIntensity: 0.8, roughness: 0.4, metalness: 0.2 });
      let geometry;
      if (kind === 'cash') geometry = new THREE.BoxGeometry(0.36, 0.12, 0.2);
      else if (kind === 'health') geometry = new THREE.BoxGeometry(0.42, 0.13, 0.13);
      else if (kind === 'armor') geometry = new THREE.BoxGeometry(0.34, 0.42, 0.1);
      else if (kind === 'package') geometry = new THREE.BoxGeometry(0.3, 0.2, 0.22);
      else geometry = new THREE.BoxGeometry(0.1, 0.12, 0.42);
      this.shapes[kind] = { geometry, body, glow: glowMat(style.color) };
    }
    this.glowGeo = new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2);
    this.time = 0;
    // A warm-up set (one of each) stays below the street for the first frames
    this.warm = Object.keys(PICKUP_STYLE).map((k, i) => this.add(k, i * 2, -3000 + i, { amount: 0, life: 0.2, warm: true }));
  }

  add(kind, x, z, { amount = 0, life = Infinity, respawn = 0, warm = false } = {}) {
    const s = this.shapes[kind];
    if (!s) return null;
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(s.geometry, s.body);
    mesh.castShadow = true;
    const glow = new THREE.Mesh(this.glowGeo, s.glow);
    glow.renderOrder = 993;
    group.add(mesh, glow);
    if (kind === 'health') {
      const bar = new THREE.Mesh(s.geometry, s.body);
      bar.rotation.y = Math.PI / 2;
      mesh.add(bar);
    }
    group.position.set(x, warm ? -40 : 0, z);
    this.root.add(group);
    const item = { kind, x, z, amount, life, respawn, group, mesh, glow, taken: false, respawnAt: 0, warm };
    this.items.push(item);
    return item;
  }

  remove(item) {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    item.group.removeFromParent();
  }

  // Returns items collected by a body at (x, y, z) this frame
  update(dt, ground, px, py, pz, collect) {
    this.time += dt;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      if (it.life <= 0) { this.remove(it); continue; }
      if (it.warm) continue;
      if (it.taken) {
        if (it.respawn && this.time >= it.respawnAt) { it.taken = false; it.group.visible = true; }
        else continue;
      }
      const y = ground(it.x, it.z);
      it.mesh.position.y = 0.7 + Math.sin(this.time * 2.4 + i) * 0.08;
      it.mesh.rotation.y = this.time * 2;
      it.glow.position.y = 0.03;
      it.group.position.set(it.x, y, it.z);
      it.group.updateMatrixWorld(true);
      if (Math.hypot(px - it.x, pz - it.z) < 1.3 && Math.abs(py - y) < 2.5 && collect(it)) {
        if (it.respawn) { it.taken = true; it.respawnAt = this.time + it.respawn; it.group.visible = false; }
        else this.remove(it);
      }
    }
  }
}

// ---- Mission scripts --------------------------------------------------------------------------------------------
// Each story mission starts at its contact; activities repeat. `m` is the MissionContext (gameplay.js).
const STORY = [
  {
    id: 'courant',
    title: 'CLÉ DE CONTACT',
    act: 'ACTE I — LA DETTE',
    contact: 'spawn',
    contactLabel: 'Mireille vous attend',
    *run(m) {
      yield* m.say([
        ['MIREILLE', 'Sacha Roux ? Ton frère m’a parlé de toi. Il me devait une voiture… et toi, tu me dois un service.'],
        ['MIREILLE', 'Une berline Valmont Écume dort sur la 39e Rue. Amène-la à mon garage, 10e Avenue. Propre.'],
        ['SACHA', 'Et si quelqu’un la cherche ?'],
        ['MIREILLE', 'Alors tu sèmes les flics avant d’arriver. Je ne veux pas de sirènes devant ma porte.']
      ]);
      const spot = m.roadSpotNear(-150, streetZ(39));
      const car = m.spawnCar('sedan', spot.x, spot.z, spot.heading, 0x6d1a22, { label: 'VALMONT ÉCUME' });
      m.objective('Volez la *Valmont Écume* garée sur la 39e Rue.');
      let mk = m.markOn(car, 'objective');
      m.gps(spot.x, spot.z);
      m.failIf(() => car.destroyed, 'La Valmont est détruite.');
      yield* m.waitFor(() => m.inCar(car));
      m.unmark(mk);
      m.game.wanted.crime('carjack', car.position.x, car.position.z);
      m.toast('Alarme déclenchée', 'La police arrive : sortez de la zone de recherche et restez hors de vue.');
      const g = m.place('garage');
      mk = m.mark(g.road.x, g.road.z, 'destination', { radius: 3.5 });
      m.gps(g.road.x, g.road.z);
      m.failIf(() => !m.inCar(car) && m.distanceTo(car) > 120, 'Vous avez abandonné la Valmont.');
      for (;;) {
        m.objective(m.game.wanted.level ? 'Semez la *police* avant de rejoindre le garage.' : 'Livrez la Valmont au *garage Okafor* (10e Avenue).');
        if (m.inCar(car) && m.near(g.road.x, g.road.z, 4) && !m.game.wanted.level) break;
        yield;
      }
      m.unmark(mk);
      yield* m.stopCar(car);
      const health = Math.round(car.hp);
      yield* m.say([['MIREILLE', health > 70 ? 'Pas une rayure. Ton frère avait raison.' : 'Elle a vécu, mais elle roule. On s’en contentera.']]);
      m.removeCar(car, true);
      m.complete(1500 + Math.max(0, health - 50) * 10);
    }
  },
  {
    id: 'lest',
    title: 'RECOUVREMENT',
    act: 'ACTE I — LA DETTE',
    contact: 'garage',
    contactLabel: 'Mireille · Garage Okafor',
    *run(m) {
      yield* m.say([
        ['MIREILLE', 'Dorian Vasseur. Un parieur qui me doit huit mille. Il traîne vers la 8e Avenue et la 29e.'],
        ['MIREILLE', 'Récupère l’enveloppe. S’il court, cours plus vite.']
      ]);
      const p = m.spot(m.place('debtor').x, m.place('debtor').z);
      const target = m.spawnActor({ x: p.x, z: p.z, look: 'suit', team: 'target', weapon: 'fists', hp: 90, behavior: 'idle', hostile: false, name: 'Dorian Vasseur' });
      let mk = m.markOn(target, 'target');
      m.objective('Trouvez *Dorian Vasseur*, 8e Avenue & 29e Rue.');
      m.gps(p.x, p.z);
      m.failIf(() => target.escaped, 'Dorian s’est volatilisé.');
      yield* m.waitFor(() => m.near(target.x, target.z, 28) || target.dead || target.alert);
      if (!target.dead) {
        target.behavior = 'flee';
        target.alert = true;
        m.say1('DORIAN', 'Non non non… pas aujourd’hui !');
        m.objective('Rattrapez *Dorian* et mettez-le au sol.');
        m.failIf(() => !target.dead && m.distanceTo(target) > 160, 'Dorian vous a semé.');
      }
      yield* m.waitFor(() => target.dead);
      m.unmark(mk);
      m.clearFails();
      const pack = m.pickup('package', target.x + 0.8, target.z + 0.4);
      m.objective('Ramassez *l’enveloppe*.');
      mk = m.mark(pack.x, pack.z, 'objective', { radius: 1 });
      yield* m.waitFor(() => pack.collected);
      m.unmark(mk);
      const g = m.place('garage');
      m.objective('Rapportez l’enveloppe au *garage Okafor*.');
      mk = m.mark(g.x, g.z, 'destination');
      m.gps(g.x, g.z);
      yield* m.waitFor(() => m.near(g.x, g.z, 2.6) && m.onFoot());
      m.unmark(mk);
      yield* m.say([
        ['MIREILLE', 'Huit mille, pile. Tiens, garde ça. Dans ce quartier, un Calypso 9 vaut mieux qu’un sourire.'],
        ['MIREILLE', 'Clic droit pour viser, clic gauche pour tirer, R pour recharger. Et ne vide pas tout sur un piéton.']
      ]);
      m.giveWeapon('pistol', 60);
      m.complete(2500);
    }
  },
  {
    id: 'contre',
    title: 'PIÈCES DÉTACHÉES',
    act: 'ACTE I — LA DETTE',
    contact: 'garage',
    contactLabel: 'Mireille · Garage Okafor',
    *run(m) {
      yield* m.say([
        ['MIREILLE', 'Les Brisants m’ont volé un fourgon plein de pièces. Ils le gardent sur la 11e Avenue, vers la 34e.'],
        ['MIREILLE', 'Ils sont quatre, armés. Reprends le fourgon et amène-le au quai 76. Mes gars s’occupent du reste.']
      ]);
      const c = m.place('crew');
      const vanSpot = m.spot(c.x - 8, c.z, 1.5);
      const van = m.spawnCar('van', vanSpot.x, vanSpot.z, 0, 0xe8e6e0, { label: 'HAUTURIER CARGO' });
      const crew = [];
      const offsets = [[3, 4], [-3, 5], [2, -5], [-4, -3]];
      offsets.forEach(([ox, oz], i) => {
        const s = m.spot(c.x + ox, c.z + oz);
        crew.push(m.spawnActor({ x: s.x, z: s.z, look: 'crew', team: 'crew', weapon: i === 3 ? 'smg' : 'pistol', hp: 80,
          behavior: 'guard', hostile: true, accuracy: 0.45, alert: false, heading: Math.random() * 6 }));
      });
      const marks = crew.map((a) => m.markOn(a, 'target'));
      m.objective('Éliminez l’équipage des *Brisants* (11e Avenue & 34e Rue).');
      m.gps(c.x, c.z);
      m.failIf(() => van.destroyed, 'Le fourgon est détruit.');
      while (crew.some((a) => !a.dead)) {
        crew.forEach((a, i) => { if (a.dead && marks[i]) { m.unmark(marks[i]); marks[i] = null; } });
        if (crew.some((a) => a.alert)) m.game.actors.alertTeam('crew', c.x, c.z, 80);
        yield;
      }
      marks.forEach((k) => k && m.unmark(k));
      m.objective('Prenez le *fourgon*.');
      let mk = m.markOn(van, 'objective');
      m.gps(van.position.x, van.position.z);
      yield* m.waitFor(() => m.inCar(van));
      m.unmark(mk);
      const pier = m.place('pier');
      m.objective('Livrez le fourgon au *quai 76* avant 3 minutes.');
      mk = m.mark(pier.x, pier.z, 'destination', { radius: 4 });
      m.gps(pier.x, pier.z);
      m.timer(180, 'Trop tard : les gars de Mireille sont partis.');
      m.failIf(() => !m.inCar(van) && m.distanceTo(van) > 100, 'Vous avez abandonné le fourgon.');
      yield* m.waitFor(() => m.inCar(van) && m.near(pier.x, pier.z, 5));
      m.unmark(mk);
      m.stopTimer();
      yield* m.stopCar(van);
      yield* m.say([['MIREILLE', 'Joli. Les Brisants vont s’en souvenir. Prends le Hornet : un cadeau de la maison.']]);
      m.removeCar(van, true);
      m.giveWeapon('smg', 120);
      m.complete(5000);
    }
  },
  {
    id: 'grande',
    title: 'AVIS DE RECHERCHE',
    act: 'ACTE I — LA DETTE',
    contact: 'garage',
    contactLabel: 'Mireille · Garage Okafor',
    *run(m) {
      yield* m.say([
        ['MIREILLE', 'Un certain Ilya Varga veut te voir. L’armateur. Ton frère travaillait pour lui.'],
        ['MIREILLE', 'Rendez-vous à Wall Street. Fais attention, Sacha : ces gens-là n’invitent jamais pour rien.']
      ]);
      const meet = m.roadSpotNear(m.place('meet').x, m.place('meet').z);
      m.objective('Rejoignez *Ilya Varga* à Wall Street.');
      let mk = m.mark(meet.x, meet.z, 'objective', { radius: 3 });
      m.gps(meet.x, meet.z);
      yield* m.waitFor(() => m.near(meet.x, meet.z, 4));
      m.unmark(mk);
      m.call('ILYA VARGA', 'Ton frère a coulé ma cargaison. Deux cent cinquante mille. Tu paieras… si tu passes la nuit.');
      yield* m.wait(1.5);
      m.game.wanted.force(4, m.game.player.x, m.game.player.z);
      m.toast('Varga vous a balancé', 'Quatre étoiles. Toute la police de Manhattan vous cherche.');
      m.objective('Semez la *police* (★★★★).');
      yield* m.waitFor(() => m.game.wanted.level === 0);
      const s = m.place('safehouse');
      m.objective('Rejoignez la *planque* de la 1re Avenue.');
      mk = m.mark(s.x, s.z, 'destination');
      m.gps(s.x, s.z);
      yield* m.waitFor(() => m.near(s.x, s.z, 3) && m.game.wanted.level === 0);
      m.unmark(mk);
      yield* m.say([
        ['MIREILLE', 'Tu es en vie. Varga t’a mis à l’épreuve. Deux cent cinquante mille, Sacha. On va les trouver.'],
        ['SACHA', 'Non. On va les lui reprendre.']
      ]);
      m.complete(8000, 'FIN DE L’ACTE I');
    }
  }
];

// Repeatable jobs
const ACTIVITIES = [
  {
    id: 'course',
    title: 'COURSE DE RUE',
    place: 'raceStart',
    contactLabel: 'Course de rue · véhicule requis',
    needsCar: true,
    *run(m) {
      const start = m.place('raceStart');
      const route = m.raceRoute(start.x, start.z, 2600 + Math.random() * 800);
      if (!route) { m.fail('Pas de parcours possible ici.'); return; }
      const par = Math.round(RoadNavigator.length(route) / 21 + 8);
      const checkpoints = [];
      let acc = 0;
      for (let i = 1; i < route.length; i++) {
        acc += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
        if (acc > 260 || i === route.length - 1) { checkpoints.push(route[i]); acc = 0; }
      }
      m.objective(`Course : ${checkpoints.length} balises, temps de référence ${par} s.`);
      yield* m.countdown();
      m.timer(par + 25, 'Temps écoulé.');
      const t0 = m.clock;
      for (let i = 0; i < checkpoints.length; i++) {
        const cp = checkpoints[i];
        const mk = m.mark(cp.x, cp.z, i === checkpoints.length - 1 ? 'destination' : 'race', { radius: 6, height: 9 });
        m.gps(cp.x, cp.z);
        m.objective(`Balise *${i + 1}/${checkpoints.length}*`);
        m.failIf(() => !m.inAnyCar(), 'Course abandonnée : restez au volant.');
        yield* m.waitFor(() => m.near(cp.x, cp.z, 8));
        m.unmark(mk);
        m.sound('checkpoint');
      }
      m.stopTimer();
      const time = m.clock - t0;
      const reward = Math.round(Math.max(400, 2500 - Math.max(0, time - par) * 60) / 50) * 50;
      m.complete(reward, `${time.toFixed(1)} s — référence ${par} s`);
    }
  },
  {
    id: 'convoyage',
    title: 'CONVOYAGE',
    place: 'garage',
    contactLabel: 'Convoyage · Garage Okafor',
    *run(m) {
      const kinds = [['suv', 0x1d3b2c, 'BRISANT RÉCIF'], ['pickup', 0x8f1a1d, 'GRÉVILLE FALAISE'], ['minivan', 0x26354f, 'GRÉVILLE ESCALE'], ['sedan', 0x111418, 'VALMONT ÉCUME']];
      const [kind, paint, label] = kinds[Math.floor(Math.random() * kinds.length)];
      const g = m.place('garage');
      const spot = m.randomRoadSpot(g.x, g.z, 500, 1100);
      yield* m.say([['MIREILLE', `Un client veut une ${label.split(' ')[1].toLowerCase()}. Il y en a une qui l’attend. Pas de bobo, c’est payé à l’état.`]]);
      const car = m.spawnCar(kind, spot.x, spot.z, spot.heading, paint, { label });
      let mk = m.markOn(car, 'objective');
      m.objective(`Récupérez la *${label}*.`);
      m.gps(spot.x, spot.z);
      m.failIf(() => car.destroyed, 'Le véhicule est détruit.');
      yield* m.waitFor(() => m.inCar(car));
      m.unmark(mk);
      mk = m.mark(g.road.x, g.road.z, 'destination', { radius: 3.5 });
      m.gps(g.road.x, g.road.z);
      m.timer(150, 'Le client est parti.');
      for (;;) {
        m.objective(m.game.wanted.level ? 'Semez la *police* avant le garage.' : 'Livrez au *garage Okafor*.');
        if (m.inCar(car) && m.near(g.road.x, g.road.z, 4) && !m.game.wanted.level) break;
        yield;
      }
      m.unmark(mk);
      m.stopTimer();
      yield* m.stopCar(car);
      const pay = Math.round((800 + car.hp * 14) / 50) * 50;
      m.removeCar(car, true);
      m.complete(pay, `État du véhicule : ${Math.round(car.hp)} %`);
    }
  },
  {
    id: 'prime',
    title: 'PRIME',
    place: 'bounty',
    contactLabel: 'Prime · tableau des contrats',
    needsWeapon: true,
    *run(m) {
      const b = m.place('bounty');
      const spot = m.randomRoadSpot(b.x, b.z, 500, 1300, true);
      const names = ['Cyril Abadie', 'Lena Morvan', 'Victor Lhuillier', 'Inès Carrel', 'Marco Tessier'];
      const name = names[Math.floor(Math.random() * names.length)];
      m.call('CONTRAT', `${name}. Escorté. Prime à l’élimination.`);
      const target = m.spawnActor({ x: spot.x, z: spot.z, look: 'suit', team: 'bounty', weapon: 'pistol', hp: 120, behavior: 'guard', hostile: true, accuracy: 0.4, alert: false, name });
      const guards = [0, 1].map((i) => {
        const s = m.spot(spot.x + (i ? 3 : -3), spot.z + 2);
        return m.spawnActor({ x: s.x, z: s.z, look: 'guard', team: 'bounty', weapon: i ? 'shotgun' : 'smg', hp: 90, behavior: 'guard', hostile: true, accuracy: 0.42, alert: false });
      });
      const mk = m.markOn(target, 'target');
      m.objective(`Éliminez *${name}*.`);
      m.gps(spot.x, spot.z);
      m.timer(240, 'La cible a quitté la ville.');
      while (!target.dead) {
        if (target.alert || guards.some((g) => g.alert)) m.game.actors.alertTeam('bounty', spot.x, spot.z, 80);
        if (target.alert && !target.fled && guards.filter((g) => !g.dead).length === 0) { target.behavior = 'flee'; target.fled = true; }
        yield;
      }
      m.unmark(mk);
      m.stopTimer();
      m.complete(2000 + Math.round(Math.random() * 20) * 100);
    }
  }
];

export { PLACES, HOSPITALS, PRECINCTS, STORY, ACTIVITIES, MarkerSystem, PickupSystem, PICKUP_STYLE };
