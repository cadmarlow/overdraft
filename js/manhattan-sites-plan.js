import { blockAt, getIslandBoundsAtZ, surveyedBlockAt } from './city-config.js';
import { highwayScale, highwayX } from './highway-layout.js';

const frame = (x0, z0) => (x, z) => ({ x: x0 + x, z: z0 + z });
const campusPoint = frame(-1542.25, -5992.3);
const asphaltPoint = frame(1296, -3937);
const unPoint = (x, z) => {
  const wz = z - 184;
  return { x: Math.max(1077 + x, highwayX(false, wz) + 9.65 * highwayScale(false, wz)), z: wz };
};
const campusBlock = blockAt(-1542, -5992);
const asphaltBlock = surveyedBlockAt(1370, -3937);
const unBlock = surveyedBlockAt(1100, -184);

const campusWalk = [[-122,-8],[-88,-8],[-45,-8],[0,-8],[45,-8],[89,-8],[119,-8],
  [119,8],[89,8],[45,8],[0,8],[-45,8],[-88,8],[-122,8]];
const campusLowPlaza = [[-33,-79],[33,-79],[33,-15],[-33,-15]];
const campusLawns = [
  [[-81,-63],[-40,-63],[-40,-15],[-76,-15],[-82,-23]],
  [[40,-63],[80,-63],[82,-23],[76,-15],[40,-15]],
  [[-43,20],[-11,20],[-11,72],[-40,72],[-43,65]],
  [[11,20],[43,20],[43,65],[40,72],[11,72]]
];
const asphaltField = [[31,-23],[119,-23],[119,28],[31,28]];
const asphaltLawns = [
  [[28,-33],[128,-33],[132,-23],[153,-5],[166,9],[190,36],[23,36],[27,-10]],
  [[30,-97],[38,-97],[34,-52],[42,-44],[29,-44]]
];
const unGarden = [[22,-179],[31,-192],[96,-192],[119,-178],[124,-121],[29,-121]];
const unPlaza = [[6,-102],[26,-102],[45,-89],[54,-57],[71,-27],[95,-23],[99,134],
  ...Array.from({ length: 41 }, (_, i) => [6, 134 - i * 5.9])];
const unPool = { ...unPoint(81, 93), y: 1.27, audible: 37 };
const riverLimits = [2340, 4190];
function riverSpan(z) {
  const west = highwayX(false, z) + 8.5 * highwayScale(false, z);
  const east = getIslandBoundsAtZ(z).eastX - 5.8;
  return { west, east, width: east - west };
}
function riverPoint(fraction, z) {
  const { west, width } = riverSpan(z);
  return { x: west + width * fraction, z };
}

function riverPromenade(z) {
  const { west, east } = riverSpan(z);
  return [Math.max(west + 2.72, east - 2.8), z];
}

const riverBridge = {
  z: 2557, y: 6.15, width: 4.8,
  westLanding: { x: 2127, z: 2557 }, westDeck: { x: 2195, z: 2557 },
  eastDeck: { x: 2227, z: 2557 }, eastLanding: { x: 2251.4, z: 2628 }
};
const riverStage = { ...riverPoint(0.60, 4050), yaw: 0.15 };

const architecture = [
  ['lowLibrary', -1542.25, -6096, 41],
  ['butlerLibrary', -1542.25, -5861, 37],
  ['murphyCenter', 1361, -4008.75, 21],
  ['secretariat', 1190, -80.75, 156],
  ['assembly', 1181.5, -185.25, 22]
];
function manhattanSiteBuildings(buildings) {
  return architecture.flatMap(([type, x, z, height]) => {
    const record = buildings.find(b => b.cx === x && b.cz === z && b.height === height);
    return record ? [{ type, record }] : [];
  });
}

const riverArrival = riverPoint(0.9, 4000);
const manhattanArrivals = {
  columbia: { ...campusPoint(-6, -9), heading: Math.PI, name: 'Columbia', subtitle: 'College Walk · 116e Rue' },
  asphalt: { ...asphaltPoint(24.7, 0), heading: Math.PI / 2, name: 'Asphalt Green', subtitle: 'York Avenue · 90e Rue' },
  east_river_park: { ...riverArrival, heading: -0.73, name: 'East River Park', subtitle: 'Promenade · East River' },
  passerelle: { ...riverBridge.westLanding, heading: Math.PI / 2, name: 'East River Park', subtitle: 'Passerelle · 10e Rue' },
  onu: { ...unPoint(49, 54), heading: 0.68, name: 'Siège de l’ONU', subtitle: 'Place des visiteurs · Première Avenue' }
};

export { campusPoint, asphaltPoint, unPoint, campusBlock, asphaltBlock, unBlock, campusWalk, campusLowPlaza, campusLawns,
  asphaltField, asphaltLawns, unPlaza, unGarden, unPool, riverLimits, riverPoint, riverSpan, riverPromenade, riverBridge, riverStage,
  manhattanSiteBuildings, manhattanArrivals };
