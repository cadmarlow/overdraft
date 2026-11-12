import { ISLAND_BOUNDS, streetZ } from './city-config.js';
import { CITY_NORTH, CITY_SOUTH, cityBoundsAt } from './city-frontier.js';
import { FRONTIER_SITES } from './frontier-districts.js';

// Crossings, roads and landmarks shared by the terrain bake and the game.
// World frame: 1 unit = 1 m, x = Manhattan-grid east, z = grid south.

export const SALT_MIN_X = -14336, SALT_MAX_X = 14336;
export const SALT_MIN_Z = -17408, SALT_MAX_Z = 18432;
// Baked relief every 32 m; the lattice the picture and the wheels share is 8 m, with detail added at run time.
export const MACRO_STEP = 32;
export const SALT_STEP = 8;
export const MACRO_W = (SALT_MAX_X - SALT_MIN_X) / MACRO_STEP + 1;
export const MACRO_H = (SALT_MAX_Z - SALT_MIN_Z) / MACRO_STEP + 1;
export const MASK_STEP = 64;
export const MASK_W = (SALT_MAX_X - SALT_MIN_X) / MASK_STEP + 1;
export const MASK_H = (SALT_MAX_Z - SALT_MIN_Z) / MASK_STEP + 1;
export const SALT_WATER = ISLAND_BOUNDS.waterLevel;
// Heights are stored on 16 bits between these two levels (9 mm steps)
export const HEIGHT_MIN = -48, HEIGHT_RANGE = 600;
// The city deck hides the buried terrain.
export const UNDER_CITY = -8;
export const WALL_Z = CITY_NORTH;
export const FRONTIER_BRIDGES = [];

const westZ = streetZ(34);
const eastZ = streetZ(57);
export const WEST_GATE = { x: cityBoundsAt(westZ).westX, z: westZ };
export const NORTH_GATE = { x: -585, z: WALL_Z };
export const EAST_GATE = { x: cityBoundsAt(eastZ).eastX, z: eastZ };
export const DELANCEY_GATE = { x: cityBoundsAt(3720).eastX, z: 3720 };
export const SOUTH_GATE = { x: 395, z: CITY_SOUTH };

export const CROSSINGS = [
  { id: 'pumps', ...WEST_GATE, dx: -1, dz: 0, name: 'Les Pompes', sign: 'LE LIT DE L’HUDSON' },
  { id: 'nord', ...NORTH_GATE, dx: 0, dz: -1, name: 'La Grande Porte', sign: 'LES OS DE HARLEM' },
  { id: 'deversoir', ...EAST_GATE, dx: 1, dz: 0, name: 'Le Déversoir', sign: 'LA TRAVERSE DU FRET' },
  { id: 'failles', ...DELANCEY_GATE, dx: 1, dz: -0.12, name: 'Les Failles', sign: 'LES SABLES DE BROOKLYN' },
  { id: 'batterie', ...SOUTH_GATE, dx: 0.46, dz: 0.89, name: 'Le Passage de la Batterie', sign: 'LA RADE BLANCHE' }
];

export function spline(points, closed, spacing) {
  const count = closed ? points.length : points.length - 1;
  const point = i => points[closed ? (i + points.length) % points.length : Math.max(0, Math.min(points.length - 1, i))];
  const path = [];
  for (let i = 0; i < count; i++) {
    const [a, b, c, d] = [point(i - 1), point(i), point(i + 1), point(i + 2)];
    const n = Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / spacing);
    const component = (k, t) => b[k] + 0.5 * t * ((c[k] - a[k]) + t * ((2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) + t * (3 * b[k] - a[k] - 3 * c[k] + d[k])));
    for (let j = 0; j < n; j++) path.push({ x: component(0, j / n), z: component(1, j / n) });
  }
  const end = closed ? points[0] : points.at(-1);
  path.push({ x: end[0], z: end[1] });
  return path;
}

// La Ceinture follows the old freight routes across the dry basin.
const LOOP_POINTS = [
  [-3540, 450], [-3500, -1000], [-3440, -3000], [-3440, -5000], [-3520, -6800], [-3500, -7900],
  [-2900, -8250], [-2080, -8150], [-1250, -7880], [-585, -7640], [80, -7480], [330, -7260],
  [760, -7285], [1180, -7310], [1760, -7650], [2330, -7820], [2700, -7600], [3000, -6650],
  [3300, -5700], [3450, -4900], [3250, -3500], [2950, -2100], [2760, -1390], [2760, -700],
  [2650, -180], [2650, 270], [2650, 720], [2780, 1300], [3150, 2250], [3620, 3050],
  [3930, 3900], [3760, 4750], [3050, 5330], [2520, 5560], [2170, 6020], [2030, 6900],
  [1780, 7750], [1050, 8780], [150, 9150], [-750, 9250], [-1500, 9330], [-2230, 8700],
  [-2470, 7600], [-2560, 6400], [-2760, 5000], [-3050, 3500], [-3320, 2100], [-3540, 1150]
];
export const SALT_LOOP = spline(LOOP_POINTS, true, 64);

// Tracks: from each crossing to the circuit, and three ways out into the far country.
// kind 'road' = old asphalt, 'track' = bare earth beaten by wheels.
const ROUTE_POINTS = {
  pumps: { kind: 'road', points: [[WEST_GATE.x + 32, westZ], [WEST_GATE.x - 135, westZ], [-2330, westZ - 6], [-2900, 560], [-3300, 500], [-3540, 450]] },
  nord: { kind: 'road', points: [[NORTH_GATE.x, WALL_Z + 32], [NORTH_GATE.x, WALL_Z - 170], [-640, -6910], [-625, -7300], [-585, -7640]] },
  deversoir: { kind: 'road', points: [[EAST_GATE.x - 50, eastZ], [EAST_GATE.x + 130, eastZ], [1510, -1240], [1810, -1450], [2220, -1600], [2520, -1500], [2760, -1390]] },
  failles: { kind: 'road', points: [[1090, 3727], [1265, 3705], [1465, 3615], [1750, 3530], [2100, 3620], [2460, 3860], [2960, 4070], [3460, 4040], [3930, 3900]] },
  batterie: { kind: 'road', points: [[351, 5971], [425, 6114], [570, 6420], [585, 6770], [470, 7230], [670, 7780], [1050, 8780]] },
  crete: { kind: 'track', points: [[2220, -1600], [2120, -930], [2350, -280], [2180, 540], [2150, 1240], [2350, 2090], [2150, 2840], [2100, 3220], [2460, 3860]] },
  // The climb through the cut of the old tunnel helix to the high plateau, and out west
  hautsel: { kind: 'track', points: [[-3500, -1000], [-3780, -1330], [-4080, -1480], [-4480, -1560], [-5200, -1900], [-6400, -2500], [-7900, -2700], [-9400, -3600]] },
  // Out east past the yards, into the dune country
  levant: { kind: 'track', points: [[3930, 3900], [4500, 3950], [5300, 4350], [6500, 4500], [7900, 5200], [9300, 5300]] },
  // Down the dry harbour to the Narrows
  rade: { kind: 'track', points: [[150, 9150], [300, 10200], [900, 11600], [1700, 13200], [2500, 14800]] },
  // Along the foot of Manhattan's western wall, on the bed of the Hudson
  lit: { kind: 'track', points: [[-2330, westZ - 6], [-2420, -900], [-2460, -3000], [-2500, -5200], [-2520, -7000], [-2900, -8250]] },
  litsud: { kind: 'track', points: [[-2330, westZ - 6], [-2250, 1700], [-1700, 3300], [-1150, 4700], [-560, 5900], [-250, 7300], [150, 9150]] }
};
export const SALT_ROUTES = Object.entries(ROUTE_POINTS).map(([id, { kind, points }]) => ({
  id, kind, gate: CROSSINGS.find(g => g.id === id), path: spline(points, false, kind === 'road' ? 20 : 48)
}));

export const ROAD_HALF = 7.2; // half width of the old asphalt
export const TRACK_HALF = 5.2;

// Named places: the first eight keep the names the first desert gave them, at their new sites
export const SALT_PLACES = [
  { name: 'Cale des Veilleurs', x: 1730, z: 7540 }, // the stranded freighter off Red Hook
  { name: 'Les Pompes', x: -2330, z: westZ - 6 }, // foot of the western ramp
  { name: 'Échangeur des Marées', x: 3800, z: 3350 }, // the fallen interchange behind Williamsburg
  { name: 'Ligne des Pylônes', x: -3440, z: -3000 }, // under the Palisades
  { name: 'Bassin des Balises', x: -750, z: 9250 }, // the harbour pan, between the two islands
  { name: 'Le Haut-Sel', x: -5200, z: -1900 }, // the plateau above the cliffs
  { name: 'Les Terrasses', x: 2330, z: -7820 }, // the Bronx badlands
  { name: 'La Traverse du Fret', x: 2950, z: -2100 }, // the old yards in Queens
  { name: 'La Grande Porte', x: NORTH_GATE.x, z: WALL_Z - 120 },
  { name: 'Le Déversoir', x: 1535, z: -1260 },
  { name: 'Les Failles', x: 1745, z: 3535 },
  { name: 'La Crête du Levant', x: 2150, z: 1240 },
  { name: 'Le Passage de la Batterie', x: 566, z: 6510 },
  { name: 'Les Os de Harlem', x: -1250, z: -7880 },
  { name: 'La Porte d’Enfer', x: 3000, z: -6650 },
  { name: 'Le Lit', x: -2460, z: -3000 },
  { name: 'La Rade', x: 150, z: 9150 },
  { name: 'Le Cimetière des Coques', x: -2700, z: -520 }
];

// Level ground the bake keeps for what will be built: [x, z, radius, feather]
export const PADS = [
  [1730, 7540, 150, 120], [3800, 3350, 170, 120], [-3440, -3000, 90, 90], [-5200, -1900, 110, 120],
  [2330, -7820, 100, 100], [2950, -2100, 110, 100], [-750, 9250, 120, 120], [NORTH_GATE.x, WALL_Z - 150, 120, 90],
  [-2330, westZ - 6, 70, 70], [1535, -1260, 65, 60], [1745, 3535, 64, 85], [566, 6510, 68, 75],
  ...FRONTIER_SITES.map(site => [site.x, site.z, site.width * 0.75 + 12, 24])
];
