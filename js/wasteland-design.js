import { CUT_Z, EAST_RIVER_BRIDGES, ISLAND_BOUNDS, getIslandBoundsAtZ, streetZ } from './city-config.js';

// The Wasteland as it is drawn on paper: where the dry rivers, the moat, the dams, the wall, the tracks and the
// places are. Pure data shared by the terrain bake (tools/wasteland/build-terrain.mjs) and the game (wasteland-plan.js).
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
// Under the streets the relief stays out of sight, except where a drift has come over the seawall
export const UNDER_CITY = -8;
export const WALL_Z = CUT_Z; // the island's northern edge: the Wall stands on it

const westZ = streetZ(34);
export const WEST_GATE = { x: getIslandBoundsAtZ(westZ).westX - 2, z: westZ };
export const NORTH_GATE = { x: -585, z: WALL_Z }; // Adam Clayton Powell Jr Boulevard runs into the Wall here

// Earth dams hold the East River and the lower Harlem River as the city's moat. Both ends lie inside dry land.
export const DAMS = [
  { id: 'batterie', name: 'Digue de la Batterie', a: { x: 700, z: 6000 }, b: { x: 2100, z: 6100 }, half: 46, crest: 3.4 },
  { id: 'enfer', name: 'Digue de la Porte d’Enfer', a: { x: 2700, z: -7600 }, b: { x: 3300, z: -5700 }, half: 52, crest: 4.2 },
  { id: 'nord', name: 'Digue du Nord', a: { x: 330, z: -7260 }, b: { x: 1180, z: -7310 }, half: 46, crest: 3.2 },
  { id: 'newtown', name: 'Digue de Newtown', a: { x: 2650, z: -180 }, b: { x: 2650, z: 720 }, half: 44, crest: 3.0 }
];
export const MOAT_SEED = { x: 1650, z: 800 };

// Where the dunes have come over the seawall. `reach` is how far the sand runs into the city, `top` how high it
// stands against the wall (0 = level with the streets), `r` the half length of the breach along the shore.
// A breach is centred on the shore itself: the western ones take their x from the island's edge at their latitude
const onWestShore = (z) => getIslandBoundsAtZ(z).westX - 4;
export const BREACHES = [
  { id: 'harlem', name: 'Brèche de Manhattanville', z: -6600, r: 210, reach: 90, top: 1.5 },
  { id: 'riverside', name: 'Brèche de Riverside', z: -4050, r: 260, reach: 120, top: 2.2 },
  { id: 'bassin', name: 'Brèche du Bassin', z: -2990, r: 180, reach: 80, top: 1.3 },
  { id: 'clinton', name: 'Brèche de Clinton', z: -1750, r: 170, reach: 70, top: 1.2 },
  { id: 'chelsea', name: 'Brèche de Chelsea', z: 1290, r: 150, reach: 70, top: 1.0 },
  { id: 'village', name: 'Brèche du Village', z: 2950, r: 190, reach: 90, top: 1.6 },
  { id: 'tribeca', name: 'Brèche de Tribeca', z: 4300, r: 160, reach: 80, top: 1.2 },
  { id: 'batterie', name: 'Les Dunes de la Batterie', x: 250, z: 6500, r: 330, reach: 230, top: 2.6 }
].map(b => ({ x: onWestShore(b.z), ...b }));

function moveApproach(spec, metres) {
  const dx = spec.b.x - spec.a.x, dz = spec.b.z - spec.a.z, length = Math.hypot(dx, dz);
  const remaining = length - metres;
  return {
    ...spec,
    a: { x: spec.a.x + dx * metres / length, z: spec.a.z + dz * metres / length },
    towers: spec.towers.map(t => (t * length - metres) / remaining)
  };
}
function extendLanding(spec, metres) {
  const dx = spec.b.x - spec.a.x, dz = spec.b.z - spec.a.z, length = Math.hypot(dx, dz);
  return {
    ...spec,
    b: { x: spec.b.x + dx * metres / length, z: spec.b.z + dz * metres / length },
    towers: spec.towers.map(t => t * length / (length + metres))
  };
}
// The four East River bridges, drivable from the city to the far bank
export const FRONTIER_BRIDGES = EAST_RIVER_BRIDGES.map(spec => {
  // The scenic Manhattan Bridge crossed occupied blocks. The new ramp starts on Monroe Street.
  if (spec.id === 'manhattan') return { ...moveApproach(spec, 560), citySideSpan: 91, rampFrac: .66 };
  // Keep the old towers in place and run a long descent inland from the outer anchorage.
  if (spec.id === 'brooklyn') return extendLanding(spec, 420);
  return spec;
});

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

const bridge = id => FRONTIER_BRIDGES.find(b => b.id === id);
const landing = id => [bridge(id).b.x, bridge(id).b.z];
const beyond = (id, metres) => {
  const { a, b } = bridge(id), length = Math.hypot(b.x - a.x, b.z - a.z);
  return [b.x + (b.x - a.x) * metres / length, b.z + (b.z - a.z) * metres / length];
};

// La Ceinture: the old shore highways, a closed circuit around the island on the far banks and over the dams.
// Clockwise from Weehawken: north along the foot of the Palisades, across the dry Hudson above the Wall, through the
// ruins of Harlem, over the three northern and eastern dams, down the Brooklyn bank, across the dry harbour.
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
  pumps: { kind: 'road', points: [[WEST_GATE.x + 12, westZ], [WEST_GATE.x - 70, westZ], [-2330, westZ - 6], [-2900, 560], [-3300, 500], [-3540, 450]] },
  nord: { kind: 'road', points: [[NORTH_GATE.x, WALL_Z + 14], [NORTH_GATE.x, WALL_Z - 120], [NORTH_GATE.x, -7400], [-585, -7640]] },
  queensboro: { kind: 'road', points: [beyond('queensboro', -110), landing('queensboro'), beyond('queensboro', 70), [2760, -1390]] },
  williamsburg: { kind: 'road', points: [beyond('williamsburg', -110), landing('williamsburg'), beyond('williamsburg', 90), [3760, 3300]] },
  manhattan: { kind: 'road', points: [beyond('manhattan', -110), landing('manhattan'), beyond('manhattan', 100), [2520, 5560]] },
  brooklyn: { kind: 'road', points: [beyond('brooklyn', -110), landing('brooklyn'), beyond('brooklyn', 90), [2520, 5560]] },
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
  id, kind, spec: bridge(id) ?? null, path: spline(points, false, id in { queensboro: 1, williamsburg: 1, manhattan: 1, brooklyn: 1, nord: 1, pumps: 1 } ? 24 : 48)
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
  [-2330, westZ - 6, 70, 70]
];
