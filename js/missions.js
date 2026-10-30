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
  bounty: { x: 466.5 + 11, z: streetZ(31) + 30, name: 'Lexington & 31e Rue' },
  warehouse: { x: -1905, z: streetZ(27) + 10, name: 'Quais de l’Hudson' }
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
const MARKER_COLORS = { objective: 0xffd54a, destination: 0x5ec8ff, contact: 0xe1f3a0, target: 0xff4d4d, race: 0xff9a3c, shop: 0xc99bff, home: 0x7ee08a, homeSale: 0x3e8a4a };

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
  constructor(scene, count = 24) {
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
  rifle: { color: 0xffd54a, label: 'SENTINEL' },
  grenade: { color: 0x9fd36a, label: 'ÉCLAT' },
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
        it.collected = true;
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
  },
  // ---- ACTE II — MARGIN CALL ------------------------------------------------------------------------------------
  {
    id: 'marge',
    title: 'APPEL DE MARGE',
    act: 'ACTE II — MARGIN CALL',
    contact: 'garage',
    contactLabel: 'Mireille · Garage Okafor',
    *run(m) {
      yield* m.say([
        ['MIREILLE', 'Varga sait que tu travailles pour moi. Ses hommes arrivent pour « saisir » le garage.'],
        ['MIREILLE', 'Il y a un Sentinel sous l’établi. Tiens la rue, Sacha. Personne n’entre.']
      ]);
      m.giveWeapon('rifle', 120);
      const g = m.place('garage');
      m.failIf(() => !m.near(g.x, g.z, 120), 'Vous avez abandonné le garage.');
      const weapons = ['pistol', 'smg', 'pistol', 'shotgun', 'smg'];
      for (let wave = 0; wave < 3; wave++) {
        m.objective(`Défendez le *garage* · vague ${wave + 1}/3`);
        let crew;
        if (wave === 1) {
          // the second wave drives in from up the avenue
          const s = m.roadSpotNear(g.road.x, g.road.z - 230);
          const car = m.spawnNpcCar('suv', s.x, s.z, s.heading, 0x111418, { maxSpeed: 20, hp: 150 });
          m.driveTo(car, g.road.x, g.road.z - 16, { stopAt: 4 });
          const mk = m.markOn(car, 'target');
          m.say1('MIREILLE', 'Un SUV noir remonte la 10e ! Arrête-le !');
          yield* m.waitFor(() => m.arrived(car) || m.disabled(car));
          m.unmark(mk);
          crew = m.unload(car, [
            { look: 'guard', team: 'varga', weapon: 'smg', hp: 90, accuracy: 0.45, behavior: 'combat', alert: true },
            { look: 'guard', team: 'varga', weapon: 'pistol', hp: 90, accuracy: 0.45, behavior: 'combat', alert: true },
            { look: 'suit', team: 'varga', weapon: 'shotgun', hp: 110, accuracy: 0.4, behavior: 'combat', alert: true }
          ]);
        } else {
          const n = wave === 0 ? 4 : 5;
          crew = [];
          for (let i = 0; i < n; i++) {
            const north = i % 2 === 0;
            const s = m.spot(g.road.x + (i % 3) * 3 - 3, g.road.z + (north ? -1 : 1) * (55 + i * 4), 0.5);
            crew.push(m.spawnActor({ x: s.x, z: s.z, look: wave === 2 ? 'guard' : 'crew', team: 'varga', weapon: weapons[(i + wave) % weapons.length],
              hp: 80 + wave * 10, armor: wave * 15, behavior: 'combat', hostile: true, accuracy: 0.38 + wave * 0.06, alert: true }));
          }
        }
        const marks = crew.map((a) => m.markOn(a, 'target'));
        while (crew.some((a) => !a.dead)) {
          crew.forEach((a, i) => { if (a.dead && marks[i]) { m.unmark(marks[i]); marks[i] = null; } });
          yield;
        }
        marks.forEach((k) => k && m.unmark(k));
        if (wave < 2) { m.toast('Vague repoussée', 'Rechargez : ils reviennent.'); yield* m.wait(7); }
      }
      yield* m.say([
        ['MIREILLE', 'Ils ont compris le message. Garde le Sentinel.'],
        ['MIREILLE', 'Et appelle Jules Ambrose. Un ancien trader. Il dit qu’il sait où dort l’argent de Varga.']
      ]);
      m.complete(9000);
    }
  },
  {
    id: 'initie',
    title: 'DÉLIT D’INITIÉ',
    act: 'ACTE II — MARGIN CALL',
    contact: 'garage',
    contactLabel: 'Mireille · Garage Okafor',
    *run(m) {
      m.call('JULES AMBROSE', 'Paul Desrosiers. Le comptable de Varga. Il quitte son bureau de Lexington. Suis-le jusqu’à son rendez-vous.');
      yield* m.wait(3);
      const start = m.roadSpotNear(466, streetZ(48));
      const car = m.spawnNpcCar('sedan', start.x, start.z, start.heading, 0x161a20, { label: 'VALMONT ÉCUME', maxSpeed: 14, hp: 150 });
      const end = m.roadSpotNear(265, 5600);
      m.objective('Rejoignez la voiture de *Desrosiers* (Lexington & 48e Rue).');
      let mk = m.markOn(car, 'target');
      m.gps(start.x, start.z);
      yield* m.waitFor(() => m.distanceTo(car) < 90);
      m.driveTo(car, end.x, end.z, { stopAt: 6 });
      m.call('JULES AMBROSE', 'Pas trop près. S’il te repère, il file et on perd tout.');
      let close = 0, spotted = false, gpsT = 0;
      while (!m.arrived(car)) {
        const d = m.distanceTo(car);
        if (d > 170) { m.fail('Vous avez perdu Desrosiers.'); return; }
        close = d < 24 ? close + m.dt : Math.max(0, close - m.dt * 0.5);
        m.objective(d < 32 ? 'Trop près ! *Reculez*.' : d > 120 ? 'Il s’éloigne : *rapprochez-vous*.' : 'Suivez *Desrosiers* sans vous faire repérer.');
        if ((gpsT -= m.dt) <= 0) { gpsT = 2; m.gps(car.position.x, car.position.z); }
        if (close > 3.5 || m.disabled(car) || car.hp < (car.maxHp - 5)) { spotted = true; break; }
        yield;
      }
      let paul;
      if (spotted) {
        if (!m.disabled(car)) { m.say1('JULES AMBROSE', 'Il t’a vu ! Ne le laisse pas filer !'); m.flee(car, 26); }
        m.objective('Arrêtez la voiture de *Desrosiers*.');
        m.failIf(() => m.distanceTo(car) > 280, 'Desrosiers s’est enfui.');
        yield* m.waitFor(() => m.disabled(car));
        m.clearFails();
        [paul] = m.unload(car, [{ look: 'suit', team: 'varga', weapon: 'pistol', hp: 70, behavior: 'flee', hostile: false, alert: true, name: 'Paul Desrosiers' }]);
      } else {
        // the meeting: two of Varga's men were waiting for him
        [paul] = m.unload(car, [{ look: 'suit', team: 'varga', weapon: 'pistol', hp: 70, behavior: 'guard', hostile: true, alert: false, name: 'Paul Desrosiers' }]);
        for (const side of [-1, 1]) {
          const s = m.spot(car.position.x + side * 4, car.position.z + 5, 0.5);
          m.spawnActor({ x: s.x, z: s.z, look: 'guard', team: 'varga', weapon: 'smg', hp: 90, behavior: 'guard', hostile: true, alert: false, accuracy: 0.45 });
        }
        m.say1('JULES AMBROSE', 'Il a le registre sur lui. Prends-le.');
      }
      m.unmark(mk);
      mk = m.markOn(paul, 'target');
      m.objective('Récupérez le *registre* de Desrosiers.');
      yield* m.waitFor(() => paul.dead);
      m.unmark(mk);
      const ledger = m.pickup('package', paul.x + 0.6, paul.z);
      m.objective('Ramassez le *registre*.');
      mk = m.mark(ledger.x, ledger.z, 'objective', { radius: 1 });
      yield* m.waitFor(() => ledger.collected);
      m.unmark(mk);
      m.call('JULES AMBROSE', 'Tout est là. Varga sort son liquide en fourgon blindé. Une fois par semaine.');
      m.complete(7000);
    }
  },
  {
    id: 'liquidation',
    title: 'LIQUIDATION',
    act: 'ACTE II — MARGIN CALL',
    contact: 'garage',
    contactLabel: 'Mireille · Garage Okafor',
    *run(m) {
      yield* m.say([
        ['MIREILLE', 'Le fourgon de Varga quitte Park Avenue dans deux minutes, cap au sud. Un SUV d’escorte derrière.'],
        ['MIREILLE', 'Immobilise-le. Les grenades, c’est fait pour ça.']
      ]);
      if ((m.game.weapons.grenade?.mag ?? 0) < 3) m.giveWeapon('grenade', 3);
      const s = m.roadSpotNear(311, streetZ(47));
      const end = m.roadSpotNear(400, 5400);
      const van = m.spawnNpcCar('van', s.x, s.z, s.heading, 0x3a3f45, { label: 'FOURGON BLINDÉ', hp: 340, maxSpeed: 13 });
      const es = m.spot(s.x - Math.sin(s.heading) * 16, s.z - Math.cos(s.heading) * 16, 1.2);
      const escort = m.spawnNpcCar('suv', es.x, es.z, s.heading, 0x111418, { hp: 170, maxSpeed: 22 });
      m.driveTo(van, end.x, end.z, { stopAt: 8 });
      m.escort(escort, van, 15);
      let mk = m.markOn(van, 'target');
      m.objective('Interceptez le *fourgon blindé* avant le port.');
      m.failIf(() => m.arrived(van), 'Le fourgon est arrivé à bon port.');
      let gpsT = 0;
      while (!m.disabled(van)) {
        if ((gpsT -= m.dt) <= 0) { gpsT = 2; m.gps(van.position.x, van.position.z); }
        yield;
      }
      m.clearFails();
      m.unmark(mk);
      m.game.wanted.force(3, van.position.x, van.position.z);
      const guards = m.unload(van, [
        { look: 'guard', team: 'varga', weapon: 'smg', hp: 100, armor: 30, accuracy: 0.45, behavior: 'combat', alert: true },
        { look: 'guard', team: 'varga', weapon: 'shotgun', hp: 100, armor: 30, accuracy: 0.4, behavior: 'combat', alert: true }
      ]);
      if (!escort.destroyed) {
        m.stopNpc(escort);
        guards.push(...m.unload(escort, [
          { look: 'guard', team: 'varga', weapon: 'rifle', hp: 90, armor: 20, accuracy: 0.45, behavior: 'combat', alert: true },
          { look: 'guard', team: 'varga', weapon: 'pistol', hp: 90, accuracy: 0.45, behavior: 'combat', alert: true }
        ]));
      }
      m.objective('Éliminez les *convoyeurs*.');
      const marks = guards.map((a) => m.markOn(a, 'target'));
      while (guards.some((a) => !a.dead)) {
        guards.forEach((a, i) => { if (a.dead && marks[i]) { m.unmark(marks[i]); marks[i] = null; } });
        yield;
      }
      marks.forEach((k) => k && m.unmark(k));
      const h = van.heading;
      const bags = [-0.8, 0, 0.8].map((k) => m.pickup('cash', van.position.x - Math.sin(h) * 3.4 + Math.cos(h) * k, van.position.z - Math.cos(h) * 3.4 - Math.sin(h) * k, 8000));
      m.objective('Prenez les *sacs de billets*.');
      const bagMarks = bags.map((b) => m.mark(b.x, b.z, 'objective', { radius: 0.8, blip: false }));
      while (bags.some((b) => !b.collected)) {
        bags.forEach((b, i) => { if (b.collected && bagMarks[i]) { m.unmark(bagMarks[i]); bagMarks[i] = null; } });
        yield;
      }
      bagMarks.forEach((k) => k && m.unmark(k));
      m.objective('Semez la *police*.');
      yield* m.waitFor(() => m.game.wanted.level === 0);
      m.complete(5000, 'Butin : 24 000 $');
    }
  },
  {
    id: 'decouvert',
    title: 'VENTE À DÉCOUVERT',
    act: 'ACTE II — MARGIN CALL',
    contact: 'garage',
    contactLabel: 'Mireille · Garage Okafor',
    *run(m) {
      yield* m.say([
        ['MIREILLE', 'Le registre parle d’un entrepôt sur les quais de l’Hudson. C’est là que Varga garde ce qui lui reste.'],
        ['SACHA', 'Alors on y va.'],
        ['MIREILLE', 'Pas « on ». Toi. Moi, je garde le moteur chaud.']
      ]);
      const w = m.roadSpotNear(m.place('warehouse').x, m.place('warehouse').z);
      m.objective('Allez à l’*entrepôt* de Varga, sur les quais.');
      let mk = m.mark(w.x, w.z, 'objective', { radius: 5 });
      m.gps(w.x, w.z);
      const guards = [];
      const arms = ['pistol', 'smg', 'rifle', 'shotgun'];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const s = m.spot(w.x + Math.cos(a) * (8 + (i % 3) * 5), w.z + Math.sin(a) * (10 + (i % 2) * 6), 0.5);
        guards.push(m.spawnActor({ x: s.x, z: s.z, heading: a, look: i % 3 ? 'guard' : 'crew', team: 'varga', weapon: arms[i % 4], hp: 100, armor: 20,
          behavior: 'guard', hostile: true, accuracy: 0.48, alert: false }));
      }
      const vs = m.spot(w.x + 2, w.z + 2, 0.5);
      const varga = m.spawnActor({ x: vs.x, z: vs.z, look: 'suit', team: 'varga', weapon: 'pistol', hp: 160, armor: 50, behavior: 'guard', hostile: true, alert: false, name: 'Ilya Varga' });
      const cs = m.roadSpotNear(w.x + 40, w.z + 20);
      const vcar = m.spawnNpcCar('sedan', cs.x, cs.z, cs.heading, 0x0d0d10, { label: 'VALMONT ÉCUME', hp: 230, maxSpeed: 31, corner: 10 });
      const vm = m.markOn(varga, 'target');
      yield* m.waitFor(() => m.near(w.x, w.z, 75) || guards.some((g) => g.alert) || varga.alert);
      m.unmark(mk);
      m.game.actors.alertTeam('varga', w.x, w.z, 140);
      m.say1('ILYA VARGA', 'Roux ! Tu viens payer ta dette ?');
      m.objective('Éliminez la garde de *Varga*.');
      const marks = guards.map((a) => m.markOn(a, 'target'));
      while (guards.filter((g) => !g.dead).length > 3 && !varga.dead) {
        guards.forEach((a, i) => { if (a.dead && marks[i]) { m.unmark(marks[i]); marks[i] = null; } });
        yield;
      }
      marks.forEach((k) => k && m.unmark(k));
      m.unmark(vm);
      if (!varga.dead) {
        // he makes a run for his car
        m.say1('ILYA VARGA', 'Tu n’auras rien ! Rien !');
        m.game.actors.remove(varga);
        vcar.locked = true;
        m.flee(vcar, 31);
        mk = m.markOn(vcar, 'target');
        m.objective('Varga s’enfuit : arrêtez sa *voiture*.');
        m.failIf(() => m.distanceTo(vcar) > 340, 'Varga s’est enfui.');
        let gpsT = 0;
        while (!m.disabled(vcar)) {
          if ((gpsT -= m.dt) <= 0) { gpsT = 2; m.gps(vcar.position.x, vcar.position.z); }
          yield;
        }
        m.clearFails();
        m.unmark(mk);
        const [boss] = m.unload(vcar, [{ look: 'suit', team: 'varga', weapon: 'pistol', hp: 120, armor: 40, behavior: 'combat', hostile: true, alert: true, accuracy: 0.55, name: 'Ilya Varga' }]);
        mk = m.markOn(boss, 'target');
        m.objective('Finissez-en avec *Varga*.');
        yield* m.waitFor(() => boss.dead);
        m.unmark(mk);
      }
      m.gps(null);
      yield* m.wait(2);
      yield* m.say([
        ['SACHA', 'C’est fini.'],
        ['MIREILLE', 'Pas tout à fait. Le registre parle d’un « associé ». Quelqu’un, au-dessus de Varga, encaissait les intérêts.'],
        ['MIREILLE', 'Ton frère n’a pas coulé une cargaison, Sacha. Il a coulé avec.']
      ]);
      m.complete(30000, 'FIN DE L’ACTE II');
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
