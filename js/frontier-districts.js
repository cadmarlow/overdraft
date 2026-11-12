import { CITY_RING, cityEdgeDistance, insideCity } from './city-frontier.js';

export const FRONTIER_SITES = [
  { id: 'lisieres', name: 'Marché des Lisières', x: 645, z: -6190, yaw: -Math.PI / 2, width: 21, depth: 8, type: 'market', resident: 'Leïla', shift: [6, 23],
    lines: ['Le jour, les caisses arrivent de la ville. Après la cloche, les gens du dehors viennent avec ce qu’ils ont trouvé.', 'Les grands arbres tiennent parce qu’on garde l’eau de vaisselle pour eux. Plus loin, personne n’arrose.'] },
  { id: 'serres', name: 'Les Serres de l’Ouest', x: -1570, z: 755, yaw: Math.PI / 2, width: 12, depth: 9, type: 'garden', resident: 'Imani', shift: [6, 20],
    lines: ['On a récupéré ces cadres dans une pépinière. Les plus jeunes plants passent la nuit sous la toile.', 'Le sol est salé en bas de la pente. Les herbes ici poussent dans les sacs qu’on remonte à la main.'] },
  { id: 'atelier', name: 'Atelier du Levant', x: 1086, z: -1120, yaw: Math.PI, width: 15, depth: 9, type: 'garage', resident: 'Saïd', shift: [7, 20],
    lines: ['Écoute le moteur de la pompe. Tant qu’il tourne, la route reste ouverte.', 'Les Rouliers changent de plaque ici. Ils me laissent leurs pneus lisses. J’en fais des bacs pour les Serres.'] },
  { id: 'balance', name: 'La Balance', x: 1230, z: 3795, yaw: Math.PI, width: 14, depth: 8, type: 'yard', resident: 'Marta', shift: [7, 21],
    lines: ['On pèse les chargements ici. Une caisse annoncée pleine et qui sonne creux, ça finit en dispute.', 'Aux Failles, le vent change de côté dans les virages. Les camions rentrent parfois avec une vitre en moins.'] },
  { id: 'vigie', name: 'Vigie de la Batterie', x: 475, z: 6122, yaw: Math.PI, width: 10, depth: 7, type: 'watch', resident: 'Noé', shift: [0, 24],
    lines: ['Quand on voit les trois balises, la Rade est praticable. Quand on en voit deux, on attend.', 'La nuit, on guette les phares. Les gens du sel roulent au milieu pour éviter les anciennes jetées.'] },
  { id: 'cour', name: 'Cour des Récupérateurs', x: -450, z: -6420, yaw: Math.PI, width: 13, depth: 8, type: 'yard', resident: 'Yann', shift: [8, 22],
    lines: ['Les gars du Mur nous laissent les clous, les câbles et les bâches déchirées. Ça suffit pour refaire un toit.', 'Une fois dans les ruines, suis les étages encore debout. Au sol, le sable a effacé toutes les adresses.'] }
];

export const FRONTIER_CRATE = { x: 1088, z: -6088, name: 'Ancienne pépinière' };
export const FRONTIER_RANGE = 215;
export const FRONTIER_BLEND_IN = 168;
export const FRONTIER_BLEND_OUT = 195;
export const FRONTIER_BOUNDS = { minX: -1990, maxX: 1510, minZ: -6600, maxZ: 6295 };
export const insideFrontierBounds = (x, z) => x >= FRONTIER_BOUNDS.minX && x <= FRONTIER_BOUNDS.maxX && z >= FRONTIER_BOUNDS.minZ && z <= FRONTIER_BOUNDS.maxZ;
export const frontierDistance = (x, z) => cityEdgeDistance(x, z) * (insideCity(x, z) ? -1 : 1);
export const frontierPoint = (site, x, z) => ({
  x: site.x + Math.cos(site.yaw) * x + Math.sin(site.yaw) * z,
  z: site.z - Math.sin(site.yaw) * x + Math.cos(site.yaw) * z
});
export const frontierOpen = (site, hour) => hour >= site.shift[0] && hour < site.shift[1];

export function frontierHash(a, b, seed) {
  let k = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(seed + 1, 1442695041);
  k = Math.imul(k ^ (k >>> 13), 1274126177);
  return ((k ^ (k >>> 16)) >>> 0) / 4294967296;
}

function patch(x, z, size, seed) {
  const ix = Math.floor(x / size), iz = Math.floor(z / size);
  const fx = x / size - ix, fz = z / size - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = frontierHash(ix, iz, seed), b = frontierHash(ix + 1, iz, seed);
  const c = frontierHash(ix, iz + 1, seed), d = frontierHash(ix + 1, iz + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

export function frontierGrowth(x, z, distance) {
  if (distance < -145 || distance > 210) return 0;
  const patchiness = patch(x, z, 120, 15) * 0.62 + patch(x, z, 31, 18) * 0.38;
  const fade = Math.min(1, Math.max(0, (210 - distance) / 130), Math.max(0, (145 + distance) / 110));
  return Math.max(0, (patchiness - 0.31) * 1.6) * fade;
}

export function frontierGroves() {
  const sites = [];
  for (let edge = 0; edge < CITY_RING.length; edge++) {
    const a = CITY_RING[edge], b = CITY_RING[(edge + 1) % CITY_RING.length];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    for (let along = 23, i = 0; along < len - 12; along += 33, i++) {
      for (let side = 0; side < 2; side++) {
        const r = frontierHash(edge, i, side + 30);
        const d = side === 0 ? 9 + r * 45 : 55 + r * 85;
        const x = a.x + (dx * along - dz * d) / len, z = a.z + (dz * along + dx * d) / len;
        if (insideCity(x, z) || frontierGrowth(x, z, d) < (side === 0 ? 0.29 : 0.36)) continue;
        const scale = side === 0 ? 0.68 + r * 0.45 : 0.52 + r * 0.25;
        sites.push({ x, z, scale, kind: [1, 5, 6][Math.floor(r * 3)] });
      }
    }
  }
  return sites;
}
