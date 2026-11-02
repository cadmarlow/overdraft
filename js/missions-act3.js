import { streetZ } from './city-config.js';

// Act III, Hostile Takeover: the hand behind Varga, offered as contracts. They can be taken at any time, one after the other,
// and they end on the water.

const ACT = 'ACTE III — HOSTILE TAKEOVER';
const PLACES3 = {
  jules: { x: 1079, z: streetZ(12) + 40, name: 'Planque de la 1re Avenue' },
  nadia: { x: -1670, z: streetZ(34) + 80, name: 'Nadia · 11e Avenue' }
};

// Round a course of points on the water, the boat under you, with a clock if there is one
function* riverLeg(m, boat, points, text) {
  for (let i = 0; i < points.length; i++) {
    const p = points[i], mk = m.mark(p.x, p.z, 'race', { radius: 16, height: 8 });
    m.gps(p.x, p.z);
    m.objective(`${text} (${i + 1}/${points.length})`);
    yield* m.waitFor(() => m.inCar(boat) && m.near(p.x, p.z, 26));
    m.unmark(mk);
    m.sound('checkpoint');
  }
}

const ACT3 = [
  {
    id: 'opa',
    title: 'OFFRE HOSTILE',
    act: ACT,
    place: 'jules',
    contactLabel: 'Jules · Planque de la 1re Avenue',
    *run(m) {
      const g = m.game;
      yield* m.say([
        ['JULES', 'J’ai retourné les comptes de Varga. Il n’était qu’un guichet. Tout remonte à une seule signature : Hélène Cazal, Liberty Trust.'],
        ['SACHA', 'Une banquière.'],
        ['JULES', 'La banquière. Elle a des bateaux qui déchargent de nuit sur l’Hudson. On va lui prendre une cargaison, juste pour qu’elle lève la tête.'],
        ['JULES', 'Le hors-bord t’attend dans le chenal. Fais vite.']
      ]);
      const w = g.waterNear(-2300, streetZ(23));
      const boat = m.spawnBoat(w.x, w.z, -1.57, 0x0c1f33);
      let mk = m.markOn(boat, 'objective');
      m.objective('Montez à bord du *hors-bord*.');
      m.gps(w.x, w.z);
      m.failIf(() => boat.destroyed, 'Le hors-bord a sombré.');
      yield* m.waitFor(() => m.inCar(boat));
      m.unmark(mk);
      const north = [g.waterNear(-2300, streetZ(45)), g.waterNear(-2300, streetZ(60)), g.waterNear(-2300, streetZ(79))].map((p) => ({ x: p.x - 150, z: p.z }));
      yield* riverLeg(m, boat, north.slice(0, 2), 'Remontez l’*Hudson*');
      m.say1('JULES', 'Deux vedettes à toi. Ne t’arrête pas.');
      const hunters = [m.enemyBoat(north[1].x - 120, north[1].z - 160, 0x202226), m.enemyBoat(north[1].x + 90, north[1].z - 220, 0x202226)];
      yield* riverLeg(m, boat, north.slice(2), 'Foncez jusqu’à la *barge*');
      const marks = hunters.map((h) => m.markOn(h, 'target'));
      m.objective('Coulez les *vedettes* du Syndic. (Clic droit et clic : tir par-dessus bord)');
      yield* m.waitFor(() => hunters.every((h) => h.destroyed));
      marks.forEach((k) => m.unmark(k));
      yield* m.say([
        ['JULES', 'Elle a reçu le message. Maintenant, elle sait que tu existes.'],
        ['SACHA', 'Bien.']
      ]);
      m.complete(9000);
    }
  },
  {
    id: 'cazal',
    title: 'DUE DILIGENCE',
    act: ACT,
    place: 'jules',
    contactLabel: 'Jules · Planque de la 1re Avenue',
    *run(m) {
      const g = m.game;
      yield* m.say([
        ['JULES', 'Cazal quitte son club à 18 h, un seul trajet, une seule voiture. Elle y garde le carnet des codes du coffre.'],
        ['JULES', 'Suis-la sans te faire voir. Pas trop près : son chauffeur a fait l’armée.']
      ]);
      const from = m.randomRoadSpot(g.player.x, g.player.z, 120, 240);
      const limo = m.spawnNpcCar('sedan', from.x, from.z, from.heading, 0x0a0a0d, { label: 'VALMONT ÉCUME', hp: 300, maxSpeed: 17, corner: 7 });
      const stop = m.roadSpotNear(265, 5650);
      m.driveTo(limo, stop.x, stop.z, { stopAt: 8 });
      const mk = m.markOn(limo, 'target');
      m.failIf(() => m.disabled(limo) && !limo.spooked, 'La voiture de Cazal est hors d’usage : plus de carnet.');
      m.failIf(() => m.distanceTo(limo) > 360, 'Vous l’avez perdue.');
      let close = 0, gpsT = 0;
      while (!m.arrived(limo)) {
        const d = m.distanceTo(limo);
        close = d < 16 ? close + m.dt : Math.max(0, close - m.dt * 0.5);
        m.objective(d < 28 ? 'Trop *près* : laissez du champ.' : d > 240 ? 'Vous la *perdez* : rapprochez-vous.' : 'Filez la *voiture de Cazal*.');
        if ((gpsT -= m.dt) <= 0) { gpsT = 2; m.gps(limo.position.x, limo.position.z); }
        if (close > 3.5) { limo.spooked = true; break; }
        yield;
      }
      m.clearFails();
      if (limo.spooked) {
        m.say1('HÉLÈNE CAZAL', 'Semez-moi ce guignol.');
        m.flee(limo, 30);
        m.objective('Vous êtes repéré : arrêtez la *voiture*.');
        yield* m.waitFor(() => m.disabled(limo));
      }
      const guards = m.unload(limo, [{ look: 'guard', team: 'syndic', weapon: 'smg', hp: 120, armor: 40, behavior: 'combat', hostile: true, alert: true, accuracy: 0.5 },
        { look: 'suit', team: 'syndic', weapon: 'pistol', hp: 110, armor: 30, behavior: 'combat', hostile: true, alert: true, accuracy: 0.5 }]);
      m.unmark(mk);
      m.objective('Éliminez la *garde rapprochée*.');
      yield* m.waitFor(() => guards.every((a) => !a || a.dead));
      const bag = m.pickup('package', limo.position.x + 2.4, limo.position.z);
      m.objective('Prenez le *carnet* dans la voiture.');
      m.gps(null);
      const bagMark = m.mark(limo.position.x + 2.4, limo.position.z, 'objective', { radius: 1.4 });
      yield* m.waitFor(() => bag.collected);
      m.unmark(bagMark);
      yield* m.say([['NADIA', 'Les codes, l’heure de la ronde et la voie de sortie. Sacha, c’est Nadia Ferro : j’organise la suite. Prépare-toi.']]);
      m.complete(14000);
    }
  },
  {
    id: 'liberty',
    title: 'LE CASSE DE LA LIBERTY TRUST',
    act: ACT,
    place: 'nadia',
    contactLabel: 'Nadia · 11e Avenue',
    *run(m) {
      const g = m.game;
      yield* m.say([
        ['NADIA', 'Trois temps. Tu entres par Wall Street, tu tiens la salle des coffres le temps que la charge perce, tu prends tout.'],
        ['NADIA', 'Sors par l’eau : un hors-bord t’attend au Pier 11. La police ne sait pas nager. Le coffre, lui, a une alarme.']
      ]);
      const vault = m.spot(265, 5720, 0.6);
      m.objective('Rejoignez la *Liberty Trust*, Wall Street.');
      let mk = m.mark(vault.x, vault.z, 'objective', { radius: 6 });
      m.gps(vault.x, vault.z);
      const guards = Array.from({ length: 7 }, (_, i) => {
        const a = i * 0.9, s = m.spot(vault.x + Math.cos(a) * (9 + (i % 3) * 5), vault.z + Math.sin(a) * (9 + (i % 2) * 6), 0.5);
        return m.spawnActor({ x: s.x, z: s.z, heading: a, look: i % 2 ? 'guard' : 'suit', team: 'syndic', weapon: i % 3 ? 'smg' : 'rifle', hp: 110, armor: 30, behavior: 'guard', hostile: true, alert: false, accuracy: 0.5 });
      });
      yield* m.waitFor(() => m.near(vault.x, vault.z, 35) || guards.some((a) => a?.alert));
      g.actors.alertTeam('syndic', vault.x, vault.z, 90);
      g.wanted.alarm(3, vault.x, vault.z);
      m.say1('NADIA', 'L’alarme est partie. Tu as trois minutes, pas une de plus.');
      m.timer(180, 'La police a bouclé Wall Street.');
      m.objective('Tenez la *salle des coffres* pendant que la charge perce.');
      m.unmark(mk);
      mk = m.mark(vault.x, vault.z, 'target', { radius: 7, height: 5 });
      let drilled = 0;
      while (drilled < 28) {
        if (m.near(vault.x, vault.z, 11)) drilled += m.dt;
        m.objective(m.near(vault.x, vault.z, 11) ? `Charge : ${Math.ceil(28 - drilled)} s. Tenez la *salle des coffres*.` : 'Revenez à la *salle des coffres* : la charge s’arrête sans vous.');
        yield;
      }
      m.unmark(mk);
      g.fx.explosion(vault.x, 1, vault.z, 0.8);
      g.audio.sfx('explosion', vault.x, 1, vault.z);
      g.camera.addShake(1);
      m.say1('NADIA', 'C’est ouvert. Ramasse.');
      const bags = [0, 1, 2, 3].map((i) => { const s = m.spot(vault.x + Math.cos(i * 1.57) * 5, vault.z + Math.sin(i * 1.57) * 5, 0.4); return m.pickup('cash', s.x, s.z, 12000); });
      m.objective('Ramassez les *billets*.');
      yield* m.waitFor(() => bags.every((b) => b.collected));
      m.stopTimer();
      g.wanted.alarm(4, vault.x, vault.z);
      const w = g.waterNear(700, 5500);
      const boat = m.spawnBoat(w.x, w.z, 0.4, 0x0c1f33);
      mk = m.markOn(boat, 'destination');
      m.gps(w.x, w.z);
      m.objective('Fuyez jusqu’au *hors-bord* du Pier 11.');
      m.failIf(() => boat.destroyed, 'Votre hors-bord a coulé.');
      yield* m.waitFor(() => m.inCar(boat));
      m.unmark(mk);
      m.say1('NADIA', 'Remonte l’East River, passe les ponts. Ils ont des vedettes.');
      const launch = [m.enemyBoat(w.x + 60, w.z + 220, 0xe8ecf0), m.enemyBoat(w.x + 130, w.z + 120, 0xe8ecf0)];
      const river = [1600, 900, -300].map((z) => { const p = g.waterNear(2200, z); return { x: p.x + 60, z: p.z }; });
      yield* riverLeg(m, boat, river, 'Remontez l’*East River*');
      for (const b of launch) if (!b.destroyed) b.boatAI.gaveUp = true;
      g.wanted.clear();
      yield* m.say([
        ['NADIA', 'Personne derrière toi. Deux cent mille, et les registres de Cazal avec.'],
        ['SACHA', 'Il reste quelqu’un à voir.'],
        ['NADIA', 'Son yacht mouille devant le Pier 86. Elle part à l’aube.']
      ]);
      m.complete(120000);
    }
  },
  {
    id: 'prise',
    title: 'PRISE DE CONTRÔLE',
    act: ACT,
    place: 'nadia',
    contactLabel: 'Nadia · 11e Avenue',
    *run(m) {
      const g = m.game;
      yield* m.say([
        ['NADIA', 'Son yacht, deux vedettes d’escorte. Elle se sauvera sur son canot rapide : c’est lui qu’il te faut.'],
        ['SACHA', 'Ma dette, elle l’a écrite de sa main. Elle va la solder de la même main.']
      ]);
      const w = g.waterNear(-2300, streetZ(34));
      const boat = m.spawnBoat(w.x, w.z, -1.57, 0x0c1f33);
      m.objective('Prenez le *hors-bord*.');
      let mk = m.markOn(boat, 'objective');
      m.gps(w.x, w.z);
      m.failIf(() => boat.destroyed, 'Votre hors-bord a coulé.');
      yield* m.waitFor(() => m.inCar(boat));
      m.unmark(mk);
      const anchor = g.waterNear(-2300, streetZ(46));
      const yacht = m.spawnYacht(anchor.x - 260, anchor.z);
      const at = { x: anchor.x - 260, z: anchor.z };
      mk = m.mark(at.x + 50, at.z, 'target', { radius: 18, height: 10 });
      m.gps(at.x + 50, at.z);
      m.objective('Approchez du *yacht de Cazal*.');
      yield* m.waitFor(() => m.near(at.x, at.z, 240));
      m.unmark(mk);
      m.say1('HÉLÈNE CAZAL', 'Monsieur Roux. Vous auriez dû prendre rendez-vous.');
      const escorts = [m.enemyBoat(at.x + 40, at.z - 60, 0x202226), m.enemyBoat(at.x + 50, at.z + 70, 0x202226), m.enemyBoat(at.x - 40, at.z + 90, 0x202226)];
      const marks = escorts.map((e) => m.markOn(e, 'target'));
      m.objective('Coulez l’*escorte*.');
      yield* m.waitFor(() => escorts.every((e) => e.destroyed));
      marks.forEach((k) => m.unmark(k));
      const cazal = m.enemyBoat(at.x - 30, at.z + 10, 0xd8d4c8, { hp: 320, flee: true, label: 'CANOT DE CAZAL' });
      m.say1('HÉLÈNE CAZAL', 'On ne saisit pas une banque, Roux. Elle se déplace.');
      mk = m.markOn(cazal, 'target');
      m.objective('Rattrapez le *canot de Cazal* et coulez-le.');
      m.failIf(() => m.distanceTo(cazal) > 800, 'Cazal a pris le large.');
      let gpsT = 0;
      while (!cazal.destroyed) {
        if ((gpsT -= m.dt) <= 0) { gpsT = 1.5; m.gps(cazal.position.x, cazal.position.z); }
        yield;
      }
      m.clearFails();
      m.unmark(mk);
      g.debt = 0;
      yield* m.wait(2);
      yield* m.say([
        ['JULES', 'Le conseil de la Liberty Trust vient de te racheter ta dette pour un dollar. Ils préfèrent ne pas savoir.'],
        ['SACHA', 'Et mon frère ?'],
        ['NADIA', 'Le carnet parle d’un navire, le Sterne. Immatriculé à un nom que tu connais. Le tien.']
      ]);
      void yacht;
      m.complete(60000, 'FIN DE L’ACTE III');
    }
  }
];

// A run round the tip of the island against the clock, whenever you feel like it
const REGATTA = {
  id: 'regate',
  title: 'RÉGATE DE LA BATTERIE',
  place: 'pier',
  contactLabel: 'Régate · Quai 76',
  *run(m) {
    const g = m.game;
    const w = g.waterNear(-2300, streetZ(40));
    const boat = m.spawnBoat(w.x, w.z, 2.6, 0x7a1414);
    m.objective('Montez sur le *hors-bord*.');
    const mk = m.markOn(boat, 'objective');
    m.gps(w.x, w.z);
    yield* m.waitFor(() => m.inCar(boat));
    m.unmark(mk);
    yield* m.countdown();
    m.timer(120, 'Temps écoulé.');
    const zs = [1400, 3000, 4600, 6000];
    yield* riverLeg(m, boat, zs.map((z) => { const p = g.waterNear(-2300, z); return { x: p.x - 90, z: p.z }; }), 'Descendez le fleuve');
    m.stopTimer();
    m.complete(5000);
  }
};

export { ACT3, PLACES3, REGATTA };
