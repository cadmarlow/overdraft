import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import * as TSL from '../vendor/three/build/three.tsl.js';
import { loadModule } from './helpers/module.cjs';
import * as plan from '../js/urban-places-plan.js';
import * as manhattan from '../js/manhattan-sites-plan.js';
import { highwayCorridor, highwayX } from '../js/highway-layout.js';
import * as groundSurfaces from '../js/ground-surfaces.js';
import * as parkPlan from '../js/park-plan.js';
import { pointInLoop } from '../js/ground-plan.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const { mergeGeometries } = loadModule(read('vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), { imports: { three: THREE } });
const geometry = loadModule(read('js/district-geometry.js'), {
  imports: { 'three/webgpu': THREE, 'three/addons/utils/BufferGeometryUtils.js': { mergeGeometries } }
});
const fetchFile = globalThis.fetch;
const survey = await (async () => {
  try {
    globalThis.fetch = async url => new Response(readFileSync(url));
    return await import('../js/building-geodata.js');
  } finally {
    globalThis.fetch = fetchFile;
  }
})();
const { REAL_BUILDINGS } = survey;

const material = () => new THREE.MeshStandardNodeMaterial();
const imports = {
  'three/webgpu': THREE, 'three/tsl': TSL, './district-geometry.js': geometry, './ground-surfaces.js': groundSurfaces,
  './park-plan.js': parkPlan, './park-materials.js': { createGroundLawnMaterial: material },
  './tsl-materials.js': { cityUniforms: { uNight: TSL.float(0) }, createDressedStoneMaterial: material,
    createLobbyGlassMaterial: material, createParkPavingMaterial: material, createCurtainWallMaterial: material },
  './urban-places-plan.js': plan, './manhattan-sites-plan.js': manhattan
};
const context = { fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, arc() {}, fill() {} };
const modules = { imports, globals: { document: { createElement: () => ({ getContext: () => context }) } } };
const { buildLincolnTheatres } = loadModule(read('js/lincoln-theatres.js'), modules);
const urban = loadModule(read('js/urban-places.js'), modules);
const { buildUrbanPlaces } = urban;
const { buildManhattanArchitecture } = loadModule(read('js/manhattan-monuments.js'), modules);
const civicImports = { ...imports, './urban-places.js': urban };
const civicGrounds = loadModule(read('js/manhattan-grounds.js'), { ...modules, imports: civicImports });
const { buildEastRiverPark } = loadModule(read('js/east-river-park.js'), {
  ...modules, imports: { ...civicImports, './manhattan-grounds.js': civicGrounds }
});

const scene = new THREE.Scene(), colliders = [], ground = groundSurfaces.createGroundSurfaces(), lamps = [], trees = [];
const theatres = plan.lincolnTheatres(REAL_BUILDINGS);
const shells = buildLincolnTheatres(scene, theatres);
const visits = buildUrbanPlaces(scene, { ground, colliders, addTree: p => trees.push(p), addBench() {}, addLamp: (...p) => lamps.push(p) });
const contains = (polygon, x, z) => pointInLoop(polygon.outer, x, z) && !polygon.holes.some(h => pointInLoop(h, x, z));

function eachPoint(points, check) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.6);
    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      check(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    }
  }
}
function sample(point) {
  const hit = {};
  assert.ok(ground.sample(point.x, point.z, hit));
  return hit;
}

test('Lincoln Center matches three surveyed halls and offers physical steps and ramps from Columbus Avenue', () => {
  assert.deepEqual(theatres.map(t => t.site.type), ['opera', 'geffen', 'koch']);
  assert.equal(shells.length, 3);
  assert.deepEqual(Array.from(shells, s => s.maxY), [38, 27, 32]);
  const x = [172.25,173,173.9,174.7];
  const heights = x.map(x => sample(plan.lincolnPoint(x,-6)).y);
  [0.68,0.54,0.4,0.26].forEach((y,i) => assert.ok(Math.abs(heights[i] - y) < 0.001));
  const ramp = x.map(x => sample(plan.lincolnPoint(x,10)).y);
  assert.ok(ramp.every((y,i) => i === 0 || y < ramp[i - 1]));
  assert.ok(Math.abs(sample(plan.lincolnPoint(170,-7)).y - 0.82) < 0.001);
});

test('the Oval preserves the central lawn and its paths keep clear of the red-brick residential towers', () => {
  const residences = REAL_BUILDINGS.filter(plan.isStuyvesantResidence);
  assert.equal(residences.length, 23);
  assert.ok(sample(plan.ovalPoint(0,10)).grip < 0.75);
  assert.ok(sample(plan.ovalPoint(-115,0.5)).grip > 0.85);
  for (const walk of plan.ovalWalks) eachPoint(walk.points.map(p => plan.ovalPoint(...p)), (x,z) => {
    assert.ok(!residences.some(r => r.polygons.some(g => contains(g,x,z))), `path crosses a building at ${x}, ${z}`);
  });
  assert.ok(trees.length > 45 && lamps.length > 20);
});

test('plaza and garden visitors have unobstructed routes from the entrances to their seats', () => {
  assert.equal(visits.length, 18);
  for (const { gate, entry, route, seat, stop = seat } of visits) {
    eachPoint([entry, gate, ...route, stop], (x,z) => {
      assert.ok(![...colliders,...shells].some(c => contains(c.polygon,x,z)), `visitor route crosses an obstacle at ${x}, ${z}`);
    });
  }
});

const civicScene = new THREE.Scene();
const civicCity = { ground: groundSurfaces.createGroundSurfaces(), colliders: [], addTree() {}, addBench() {}, addLamp() {} };
const civicBuildings = manhattan.manhattanSiteBuildings(REAL_BUILDINGS);
const civicShells = buildManhattanArchitecture(civicScene, civicBuildings);
const civicVisits = civicGrounds.buildManhattanGrounds(civicScene, civicCity);
const riverVisits = buildEastRiverPark(civicScene, civicCity);
civicCity.ground.setRoadCorridor(highwayCorridor);

function civicSample(point, reach) {
  const hit = {};
  assert.ok(civicCity.ground.sample(point.x,point.z,hit,reach), `ground at ${point.x},${point.z}`);
  return hit;
}

test('the four new sites retain their surveyed anchors and public access', () => {
  assert.deepEqual(civicBuildings.map(b => b.type), ['lowLibrary','butlerLibrary','murphyCenter','secretariat','assembly']);
  assert.equal(civicShells.length,5);
  for (const [key, p] of Object.entries(manhattan.manhattanArrivals)) {
    assert.ok(civicSample(p,1).y >= 0.23,key+' starts on walkable ground');
  }
  assert.equal(civicSample(manhattan.campusPoint(-6,-72.5)).y,6.5);
  assert.ok(civicSample(manhattan.campusPoint(10,-32)).y > 1);
  for (const p of manhattan.asphaltField.map(p => manhattan.asphaltPoint(...p))) {
    assert.equal(highwayCorridor.contains(p.x,p.z),false);
  }
});

test('the East 10th Street bridge and FDR have independent physical surfaces', () => {
  const { z,y,westLanding,westDeck,eastLanding } = manhattan.riverBridge;
  const lane = { x:highwayX(false,z), z };
  assert.equal(civicSample(lane,1).y,0,'a vehicle in the FDR keeps the road grade');
  assert.equal(civicSample(lane,y+0.6).y,y,'the bridge is solid to someone already at its height');
  assert.ok(civicSample(westLanding,1).y < 0.4);
  assert.equal(civicSample(westDeck,y+0.6).y,y);
  assert.ok(civicSample(eastLanding,1).y < 0.5);
  assert.ok(riverVisits.length > 10);
});

test('the principal civic visitor routes avoid the surveyed landmarks and FDR lanes', () => {
  for (const { gate, entry, route, seat, stop = seat } of civicVisits) {
    eachPoint([entry,gate,...route,stop], (x,z) => {
      assert.ok(!highwayCorridor.contains(x,z),`visitor crosses the FDR at ${x},${z}`);
      assert.ok(!civicShells.some(c => contains(c.polygon,x,z)),`visitor crosses a landmark at ${x},${z}`);
    });
  }
});
