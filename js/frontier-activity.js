import { FRONTIER_CRATE, FRONTIER_SITES, frontierPoint } from './frontier-districts.js';
import { CROSSINGS, SALT_ROUTES } from './wasteland-design.js';

const stop = (x, z, action = 'idle', hold = 2, heading = 0) => ({ x, z, action, hold, heading });
const haul = (outside, aisles, drop) => [
  stop(...outside, 'lift', 3, Math.PI),
  ...aisles.map(at => stop(...at, 'cart', 0)),
  stop(...drop, 'unload', 4, Math.PI),
  ...aisles.slice().reverse().map(at => stop(...at))
];
const worker = (name, look, route, female = false) => ({ name, look, route, female });
export const MARKET_DECK = { x: 22, z: 4, width: 8, depth: 10, rise: 3.15, ramp: 12 };
export const FRONTIER_PROGRAMS = {
  lisieres: {
    shop: 'La Halle au Poids', counter: [0.4, 3.9], cargo: [3.8, -3.7], bench: [-7, -1.8], salvage: [23, -14],
    purpose: 'Les pièces arrivent sur des chariots. Le prix monte lorsque les étagères se vident.',
    workers: [
      worker('Leïla', 'clerk', [stop(0.4, 1.35, 'weigh', 6), stop(2.1, 1.35, 'write', 4, -0.6)], true),
      worker('Jo', 'crew', haul([14, 17], [[8, 11.5], [3.4, 9.2], [3.5, 5.6], [3.7, 0.3]], [3.8, -2.3])),
      worker('Maël', 'crew', [stop(-7, -0.97, 'repair', 9, Math.PI), stop(-4.65, -0.85), stop(-4.6, -3.7), stop(-6, -3.8, 'inspect', 5, Math.PI), stop(-4.65, -3.7), stop(-4.65, -0.85, 'lift', 3, Math.PI)]),
      worker('Inès', 'clerk', [stop(-9, 11, 'idle', 1), stop(-3, 8.6), stop(-3.3, 4.9, 'inspect', 4, Math.PI), stop(-7.5, 4.7, 'talk', 6, -0.8), stop(-3.1, 4.8), stop(-3, 8.8)], true),
      worker('Mina', 'clerk', [stop(22, 5, 'radio', 7, Math.PI), stop(24.2, 3, 'water', 6, -1)], true)
    ]
  },
  serres: {
    shop: 'Le Bouillon des Serres', counter: [-3.8, 4.8], cargo: [5.5, -1.8], bench: [-3.8, 1.8], salvage: [17, -9],
    purpose: 'Les marmites suivent la récolte. Une soupe chaude rend de la santé et rassasie.',
    workers: [
      worker('Imani', 'clerk', [stop(-3.8, 2.9, 'stir', 9), stop(-5.8, 2.6, 'lift', 5, -0.4)], true),
      worker('Salomé', 'clerk', [stop(3.55, 5, 'water', 6, Math.PI), stop(3.55, 0, 'water', 5, 1.6), stop(3.55, -4, 'lift', 4, Math.PI)], true),
      worker('Élias', 'crew', haul([11, 14], [[5, 10.8], [1.65, 8.5], [1.65, 5.6]], [2.4, 3.9]))
    ]
  },
  atelier: {
    shop: 'La Rechap’', counter: [-4.8, 5.4], cargo: [7.5, -1], bench: [4.4, -3.1], salvage: [16, -9],
    purpose: 'Saïd remet en état les véhicules déposés devant son atelier.',
    workers: [
      worker('Saïd', 'crew', [stop(-4.8, 3.3, 'write', 6), stop(-4.8, 1.5, 'inspect', 5, Math.PI)]),
      worker('Farah', 'clerk', [stop(4.4, -1.2, 'repair', 10, Math.PI), stop(2.8, 1.2, 'lift', 5, Math.PI), stop(5.2, 4.2, 'inspect', 4)], true),
      worker('Luc', 'crew', haul([13, 11.3], [[7.1, 9.5], [2.7, 8.7]], [2.7, 4.9]))
    ]
  },
  balance: {
    shop: 'La Balance', counter: [0, 5.1], cargo: [5.2, -2.5], bench: [0, 1.8], salvage: [18, -10],
    purpose: 'La balance paie davantage avant le départ du dernier chargement.',
    workers: [
      worker('Marta', 'clerk', [stop(0, 2.8, 'weigh', 9), stop(-2.8, 2.5, 'write', 5)], true),
      worker('Orso', 'crew', haul([11, 12], [[5.5, 10.5], [1.85, 8.65], [1.85, 5.45]], [4.5, 2.0])),
      worker('Nils', 'crew', [stop(-7, 12, 'idle', 1), stop(-1.9, 8.6), stop(-1.9, 5.45), stop(-4.8, 5.2, 'talk', 6, 1), stop(-6.3, 2.3, 'inspect', 5), stop(-1.9, 5.45), stop(-1.9, 8.6)])
    ]
  },
  vigie: {
    shop: 'Vigie de la Batterie', counter: [-1, 4.5], cargo: [5.2, -1.3], bench: [-1, 1.7], salvage: [18, -8],
    purpose: 'Le panneau donne la visibilité sur la Rade et l’état des accès.',
    workers: [
      worker('Noé', 'crew', [stop(-1, 2.8, 'radio', 8), stop(-3, 1.8, 'write', 5)]),
      worker('Naïma', 'clerk', [stop(4, 3.5, 'inspect', 6), stop(6.5, 4, 'talk', 5, 1), stop(6.45, -1, 'watch', 5, Math.PI)], true)
    ]
  },
  cour: {
    shop: 'Le Comptoir des Objets Perdus', counter: [0, 5.2], cargo: [5, -1.3], bench: [0, 1.8], salvage: [17, -9],
    purpose: 'Des objets récupérés dans les ruines changent de propriétaire sur ce comptoir.',
    workers: [
      worker('Yann', 'crew', [stop(0, 3, 'write', 7), stop(1.5, 3, 'inspect', 5)]),
      worker('Éva', 'clerk', haul([12, 13], [[5.2, 10], [1.92, 8.5], [1.92, 5.55]], [4.8, 3.3]), true),
      worker('Célestin', 'crew', [stop(-7.8, 10, 'idle', 2), stop(-1.95, 8.4), stop(-1.95, 5.55), stop(-4.4, 4, 'inspect', 6, Math.PI), stop(-7.5, 3, 'talk', 5), stop(-1.95, 5.55), stop(-1.95, 8.4)])
    ]
  }
};

export const NIGHT_WORKERS = [
  worker('Veilleuse', 'clerk', [stop(-10, 9, 'warm', 18, -0.6), stop(-9, 6, 'watch', 7, Math.PI)], true)
];

const offset = { pumps: 28, nord: 36, deversoir: 30, failles: 32, batterie: 34 };
export const FRONTIER_POSTS = CROSSINGS.map(gate => {
  const path = SALT_ROUTES.find(route => route.id === gate.id).path;
  const d = p => (p.x - gate.x) * gate.dx + (p.z - gate.z) * gate.dz;
  const index = path.findIndex(p => d(p) > offset[gate.id]);
  const a = path[index - 1], b = path[index], t = (offset[gate.id] - d(a)) / (d(b) - d(a));
  return { id: gate.id, name: gate.name, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
    yaw: Math.atan2(b.x - a.x, b.z - a.z), sign: gate.sign };
});
export const FRONTIER_SALVAGE = [
  ...FRONTIER_SITES.map(site => ({ id: site.id, ...frontierPoint(site, ...FRONTIER_PROGRAMS[site.id].salvage) })),
  { id: 'pepiniere', ...FRONTIER_CRATE }
];

export const postClosed = (id, hour, weather) => weather === 'storm' ||
  ((id === 'failles' || id === 'nord') && hour >= 1 && hour < 4);

export function frontierDay(atmosphere) {
  return Math.max(0, Math.floor(atmosphere.day || 0));
}

export function readFrontierTrade(value) {
  const clean = { scrap: Math.max(0, Math.min(25, Math.floor(Number(value?.scrap) || 0))), claimed: {}, orders: {} };
  for (const { id } of FRONTIER_SALVAGE) {
    if (Number.isSafeInteger(value?.claimed?.[id]) && value.claimed[id] >= 0) clean.claimed[id] = value.claimed[id];
  }
  for (const { id } of FRONTIER_SITES) {
    const order = value?.orders?.[id];
    if (Number.isSafeInteger(order?.day) && order.day >= 0 && Number.isInteger(order.count)) {
      clean.orders[id] = { day: order.day, count: Math.max(0, Math.min(24, order.count)),
        freight: Math.max(0, Math.min(28, Math.floor(Number(order.freight) || 0))) };
    }
  }
  return clean;
}

export function frontierQuote(id, hour, available) {
  const late = hour >= 16 && hour < 22;
  return id === 'balance' ? 45 + (late ? 14 : 0) : 39 + (available <= 2 ? 12 : 0);
}

export const FRONTIER_HALTS = [
  { side: 'west', z: -5435, name: 'Les draps de la 153e', keeper: 'Alma', work: 'lift', gear: 'table',
    line: 'Les draps blancs, c’est pour les gens qui rentrent. Ils les voient bien avant de voir nos fenêtres.' },
  { side: 'east', z: -4840, name: 'Le Fil de cuivre', keeper: 'Marin', work: 'repair', gear: 'generator',
    line: 'Les oiseaux se posent sur l’antenne. Le jour où elle cessera de vibrer, on saura que le vent a tourné.' },
  { side: 'west', z: -2670, name: 'L’Auvent cousu', keeper: 'Nora', work: 'inspect', gear: 'crate',
    line: 'Le vert vient d’un vieux store. Le bleu, d’un camion. Le jaune, c’est ma robe du dimanche.' },
  { side: 'east', z: -2070, name: 'La Dernière Lettre', keeper: 'Dario', work: 'write', gear: 'table',
    line: 'Je laisse les enveloppes par ordre de rue. Il y a toujours quelqu’un qui connaît quelqu’un.' },
  { side: 'east', z: 650, name: 'Les Bidons bleus', keeper: 'Mae', work: 'water', gear: 'barrel_blue',
    line: 'Le premier bidon sert aux semis. Le deuxième est pour la route. Le troisième, on fait semblant de l’oublier pour les voisins.' },
  { side: 'west', z: 2385, name: 'Les Veilleurs d’argile', keeper: 'Marius', work: 'lift', gear: 'jerrycan',
    line: 'Avant, l’eau passait sous nos pieds. Maintenant, il faut lever la tête pour l’attendre.' },
  { side: 'west', z: 4600, name: 'La Rue des chaises', keeper: 'Léonie', work: 'warm', gear: 'chair',
    line: 'On en met toujours une de plus. Le jour où quelqu’un revient, il doit trouver sa place.' },
  { side: 'east', z: 4750, name: 'Le Guet des pneus', keeper: 'Ari', work: 'repair', gear: 'tyre_stack',
    line: 'Je récupère ce que le sable recrache. Ce matin, un enjoliveur et des clés. Demain, qui sait ?' }
];
