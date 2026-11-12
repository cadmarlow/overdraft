import { streetZ } from './city-config.js';
import { SALT_ROUTES, routeThroughSalt } from './wasteland-plan.js';

// Act III follows the same contacts and progression across the dry frontier.
const ACT = 'ACTE III — HOSTILE TAKEOVER';
const PLACES3 = {
  jules: { x: 1079, z: streetZ(12) + 40, name: 'Planque de la 1re Avenue' },
  nadia: { x: -1394, z: streetZ(34) + 80, name: 'Nadia · 10e Avenue' }
};
const branch = id => SALT_ROUTES.find(line => line.id === id).path;
const checkpoints = (id, fractions) => {
  const path = branch(id);
  return fractions.map(f => path[Math.round(f * (path.length - 1))]);
};

function* landLeg(m, car, points, text) {
  for (let i = 0; i < points.length; i++) {
    const { x, z } = points[i], mk = m.mark(x, z, 'race', { radius: 15, height: 7 });
    m.gps(x, z);
    m.objective(`${text} (${i + 1}/${points.length})`);
    yield* m.waitFor(() => m.inCar(car) && m.near(x, z, 23));
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
      yield* m.say([
        ['JULES', 'J’ai retourné les comptes de Varga. Tout remonte à une seule signature : Hélène Cazal, Liberty Trust.'],
        ['SACHA', 'Une banquière.'],
        ['JULES', 'Ses camions passent par les silos du Déversoir. Prends celui qui attend au bord de la piste.']
      ]);
      const [at] = checkpoints('deversoir', [0.29]);
      const truck = m.spawnCar('pickup', at.x, at.z + 3, Math.PI / 2, 0x634a38, { label: 'CARGAISON DE LA LIBERTY TRUST' });
      const guards = [[-12, 18], [9, 23], [16, -20]].map(([dx, dz]) => {
        const p = m.spot(at.x + dx, at.z + dz);
        return m.spawnActor({ x: p.x, z: p.z, look: 'guard', team: 'syndic', weapon: 'smg', hp: 90, behavior: 'guard', hostile: true });
      });
      const mk = m.markOn(truck, 'objective');
      m.gps(at.x, at.z);
      m.objective('Prenez le *pick-up* du Déversoir.');
      m.failIf(() => truck.destroyed, 'La cargaison est perdue.');
      yield* m.waitFor(() => m.inCar(truck));
      m.unmark(mk);
      m.game.actors.alertTeam('syndic', at.x, at.z, 95);
      m.say1('JULES', 'Remonte la piste vers le fret. Nos gens t’attendent à la Ceinture.');
      yield* landLeg(m, truck, checkpoints('deversoir', [0.51, 0.76, 0.98]), 'Livrez la cargaison');
      for (const guard of guards) if (guard && !guard.dead) guard.alert = false;
      yield* m.say([['JULES', 'Cargaison reçue. Maintenant, elle sait que tu existes.'], ['SACHA', 'Bien.']]);
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
    contactLabel: 'Nadia · 10e Avenue',
    *run(m) {
      const g = m.game;
      yield* m.say([
        ['NADIA', 'Trois temps. Tu entres par Wall Street, tu tiens la salle des coffres le temps que la charge perce, tu prends tout.'],
        ['NADIA', 'Un tout-terrain t’attend près de Broad Street. Sors par la Batterie. Le coffre a une alarme.']
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
      const escape = m.roadSpotNear(350, 5940);
      const car = m.spawnCar('suv', escape.x, escape.z, escape.heading, 0x383b34, { label: 'VÉHICULE D’EXTRACTION' });
      mk = m.markOn(car, 'destination');
      m.gps(escape.x, escape.z);
      m.objective('Rejoignez le *tout-terrain* de Nadia.');
      m.failIf(() => car.destroyed, 'Le véhicule d’extraction est détruit.');
      yield* m.waitFor(() => m.inCar(car));
      m.unmark(mk);
      m.say1('NADIA', 'Sors par Broad Street. Après les balises de la Batterie, file sur la Rade Blanche.');
      yield* landLeg(m, car, checkpoints('batterie', [0.18, 0.39, 0.64, 0.82]), 'Sortez par la Rade Blanche');
      g.wanted.clear();
      yield* m.say([
        ['NADIA', 'Personne derrière toi. Deux cent mille, et les registres de Cazal avec.'],
        ['SACHA', 'Il reste quelqu’un à voir.'],
        ['NADIA', 'Cazal quitte le Déversoir par la route du fret. Son escorte ouvre la voie.']
      ]);
      m.complete(120000);
    }
  },
  {
    id: 'prise',
    title: 'PRISE DE CONTRÔLE',
    act: ACT,
    place: 'nadia',
    contactLabel: 'Nadia · 10e Avenue',
    *run(m) {
      const g = m.game;
      yield* m.say([
        ['NADIA', 'Cazal prépare son départ au Déversoir. Si elle rejoint la Ceinture, elle disparaît.'],
        ['SACHA', 'Ma dette, elle l’a écrite de sa main. Elle va la solder de la même main.']
      ]);
      const [at, end] = checkpoints('deversoir', [0.31, 0.96]);
      const heading = Math.PI / 2;
      const cazal = m.spawnNpcCar('suv', at.x, at.z, heading, 0x262324, { label: 'CAZAL', hp: 310, maxSpeed: 26 });
      const escorts = [m.spawnNpcCar('suv', at.x + 15, at.z + 5, heading, 0x504138, { label: 'ESCORTE', hp: 160 }),
        m.spawnNpcCar('sedan', at.x - 18, at.z - 4, heading, 0x312b28, { label: 'ESCORTE', hp: 130 })];
      const guards = [[-12, 17], [20, -20], [23, 18]].map(([dx, dz]) => {
        const p = m.spot(at.x + dx, at.z + dz);
        return m.spawnActor({ ...p, look: 'guard', team: 'syndic', weapon: 'smg', hp: 100, behavior: 'guard', hostile: true });
      });
      const mark = m.markOn(cazal, 'target');
      m.gps(at.x, at.z);
      m.objective('Approchez du *convoi de Cazal*.');
      yield* m.waitFor(() => m.near(at.x, at.z, 105) || m.disabled(cazal));
      g.actors.alertTeam('syndic', at.x, at.z, 110);
      m.say1('HÉLÈNE CAZAL', 'Monsieur Roux. Vous auriez dû prendre rendez-vous.');
      for (const car of [cazal, ...escorts]) car.driver.nav = { route: (x, z, tx, tz) => routeThroughSalt({ x, z }, { x: tx, z: tz })?.slice(1) };
      m.driveTo(cazal, end.x, end.z, { stopAt: 10 });
      for (const car of escorts) m.driveTo(car, end.x, end.z, { stopAt: 18 });
      m.failIf(() => !m.disabled(cazal) && m.arrived(cazal), 'Cazal a rejoint la Ceinture.');
      let gpsT = 0;
      while (!m.disabled(cazal)) {
        m.objective('Immobilisez le *tout-terrain de Cazal*.');
        if ((gpsT -= m.dt) <= 0) { gpsT = 1.5; m.gps(cazal.position.x, cazal.position.z); }
        yield;
      }
      m.clearFails();
      m.unmark(mark);
      for (const car of escorts) m.stopNpc(car);
      for (const guard of guards) if (guard && !guard.dead) guard.alert = false;
      const dossier = m.pickup('package', cazal.position.x + 3, cazal.position.z);
      const mk = m.mark(dossier.x, dossier.z, 'objective', { radius: 1.5 });
      m.gps(dossier.x, dossier.z);
      m.objective('Récupérez le *dossier* de Cazal.');
      yield* m.waitFor(() => dossier.collected);
      m.unmark(mk);
      g.debt = 0;
      yield* m.say([
        ['JULES', 'Le conseil de la Liberty Trust vient de te racheter ta dette pour un dollar. Ils préfèrent ne pas savoir.'],
        ['SACHA', 'Et mon frère ?'],
        ['NADIA', 'Le carnet parle d’un navire échoué, le Sterne. Immatriculé à un nom que tu connais. Le tien.']
      ]);
      m.complete(60000, 'FIN DE L’ACTE III');
    }
  }
];

const SALT_SPRINT = {
  id: 'sprint-sel',
  title: 'SPRINT DES FAILLES',
  place: { ...checkpoints('failles', [0.13])[0], name: 'Les Failles' },
  contactLabel: 'Sprint · Les Failles',
  *run(m) {
    const { x, z } = SALT_SPRINT.place;
    const car = m.spawnCar('offroad', x, z, 1.9, 0x8c4227, { label: 'SPRINT DES FAILLES' });
    const mk = m.markOn(car, 'objective');
    m.gps(x, z);
    m.objective('Montez dans la voiture du *sprint*.');
    m.failIf(() => car.destroyed, 'Votre voiture est hors service.');
    yield* m.waitFor(() => m.inCar(car));
    m.unmark(mk);
    yield* m.countdown();
    m.timer(145, 'Temps écoulé.');
    yield* landLeg(m, car, checkpoints('failles', [0.24, 0.36, 0.48, 0.60, 0.72, 0.84, 0.98]), 'Suivez la piste des Failles');
    m.stopTimer();
    m.complete(5000);
  }
};

export { ACT3, PLACES3, SALT_SPRINT };
