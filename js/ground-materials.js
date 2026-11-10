import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, attribute, uv, positionWorld, cameraPosition, cameraViewMatrix, normalWorldGeometry, normalViewGeometry,
  abs, floor, fract, mod, min, max, clamp, mix, step, smoothstep, dot, length, normalize, pow, exp, fwidth, dFdx, dFdy, texture,
  transformDirection
} from 'three/tsl';
import { ground } from './ground-assets.js';
import { cityUniforms, hash2D, bumpNormal, canyonSkyAONode, roadPuddleField, roadWetMasks, transparentEffectMRT } from './tsl-materials.js';
import { CURB_HEIGHT, CURB_WIDTH, GUTTER_WIDTH, KIND } from './ground-plan.js';

// The ground of the city (see js/ground-plan.js for the meshes and what their coordinates mean). The rule everywhere:
// wear follows use. Roads know their lanes, stop lines and curbs, sidewalks know how far the curb is, so stains, polish,
// oil and dirt land where traffic and feet put them instead of where a noise happens to peak. Detail comes from
// photographs and the wear masks of tools/ground: a handful of texture fetches instead of dozens of procedural noises.

// Albedos the photographs are brought to (linear): what the eye separates a street by
const ASPHALT = vec3(0.08, 0.079, 0.077);
const BLACKTOP = vec3(0.04, 0.04, 0.042);
const CHIPSEAL = vec3(0.108, 0.105, 0.099);
const CONCRETE = vec3(0.225, 0.218, 0.2);
const CHARCOAL = vec3(0.14, 0.14, 0.146);
const BLUESTONE = vec3(0.15, 0.168, 0.19);
const SETTS = vec3(0.2, 0.195, 0.19);
const GRANITE = vec3(0.3, 0.3, 0.305);
const CURB_CONCRETE = vec3(0.33, 0.32, 0.295);
const RUST = vec3(0.105, 0.06, 0.036);
const DIRT = vec3(0.036, 0.031, 0.026);
const BUS_RED = vec3(0.25, 0.052, 0.036);
const DUST = vec3(0.1, 0.09, 0.075);

function sample(surface, uv, grad = null, contrast = 1) {
  let c = texture(surface.color, uv);
  let n = texture(surface.normal, uv);
  if (grad) {
    c = c.grad(grad[0], grad[1]);
    n = n.grad(grad[0], grad[1]);
  }
  // tone: the photograph relative to its own mean, so its cast never tints the surface; slope: its normal's tilt
  const tone = c.rgb.div(vec3(...surface.mean));
  return { tone: contrast === 1 ? tone : pow(tone, vec3(contrast)), height: c.a, slope: n.xy.mul(2.0).sub(1.0), rough: n.a };
}
// A flat surface's normal from a photograph's tilt (u along world x, v along world z), in view space
const flatNormal = (slope, strength) => transformDirection(normalize(vec3(slope.x.mul(strength), 1.0, slope.y.mul(-strength))), cameraViewMatrix);
const bell = (x, centre, width) => {
  const q = float(x).sub(centre).div(width);
  return exp(q.mul(q).negate());
};
// Coverage of a line `halfWidth` wide whose centre is `dist` metres away, a pixel being `px` metres: it thins out
// instead of breaking up once it is narrower than a pixel
const aaLine = (dist, halfWidth, px) => clamp(float(halfWidth).sub(dist).div(px).add(0.5), 0.0, 1.0).mul(min(float(1.0), float(halfWidth).mul(4.0).div(px)));
const not = (x) => float(1.0).sub(x);
// The direction a surface coordinate grows in, as a unit vector of world x/z, from its screen derivatives
const worldGradient = (value, P) => {
  const dx = dFdx(P), dy = dFdy(P);
  const det = dx.x.mul(dy.y).sub(dx.y.mul(dy.x));
  const safe = det.add(step(abs(det), 1e-9).mul(1e-6));
  const ax = dFdx(value), ay = dFdy(value);
  return normalize(vec2(ax.mul(dy.y).sub(ay.mul(dx.y)), ay.mul(dx.x).sub(ax.mul(dy.x))).div(safe).add(vec2(1e-6, 0.0)));
};
// The light sunlit facades throw back down into a street canyon: warm, and there in proportion to how little sky the
// spot sees (`sky`, the urban light field's visibility). Without it a shaded street floor is lit by the blue sky alone.
const CANYON_WARM = vec3(0.8, 0.36, 0.17);
const canyonFill = (albedo, sky) => albedo.mul(CANYON_WARM).mul(cityUniforms.uCanyonBounce).mul(not(sky)).mul(0.8);

/**
 * Asphalt. `street: true` is for the lane bands of js/ground-plan.js buildRoads (attributes road, band, flow); without it
 * the same asphalt covers whatever no lane band does (the island's deck: plazas, odd junctions), with no traffic wear.
 * Three pours blend by the roadway's age: blacktop (fresh, also the utility cuts), the aged coarse asphalt, and old
 * binder with its stone showing. On top, per lane: tyre polish in the wheel paths, the oil strip between them growing
 * toward the stop line, braking rubber, drips where engines park, the paver's seams, saw-cut utility trenches with
 * their tar seals, cracks and tar snakes in the old stretches. Post-rain wetness as before (roadWetMasks), with the
 * water now preferring the gutters.
 */
function createGroundRoadMaterial({ street = false } = {}) {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.9 });
  mat.name = street ? 'GroundRoad' : 'GroundDeck';
  const P = positionWorld.xz;
  const px = max(length(fwidth(P)), 0.0005);

  let s, o, len, half, v, bandHalf, kind, seed, toStop, stopCode;
  if (street) {
    const road = attribute('road', 'vec4');
    const band = attribute('band', 'vec4');
    const flow = attribute('flow', 'vec4');
    s = road.x; o = road.y; len = road.z; half = road.w;
    v = band.x; bandHalf = band.y; kind = band.z; seed = band.w;
    toStop = flow.x; stopCode = flow.y;
  } else {
    s = P.y; o = P.x; len = float(1e4); half = float(9.0);
    v = float(0.0); bandHalf = float(1.0); kind = float(KIND.other); seed = float(0.37);
    toStop = float(1e3); stopCode = float(0.0);
  }
  const isBus = step(KIND.bus - 0.5, kind);
  const isLane = max(step(KIND.lane - 0.5, kind).mul(step(kind, KIND.lane + 0.5)), isBus);
  const isPark = step(KIND.parking - 0.5, kind).mul(step(kind, KIND.parking + 0.5));
  const isBox = step(KIND.box - 0.5, kind).mul(step(kind, KIND.box + 0.5));
  const hasStop = step(0.5, mod(stopCode, 4.0));

  // Wear masks: world-anchored blotches & cracks, and one lookup stretched along the roadway for everything traffic drags
  const mWorld = texture(ground.masksA, P.div(23.0));
  const mFine = texture(ground.masksB, P.div(4.1));
  const mLane = texture(ground.masksA, vec2(o.div(5.3), s.div(31.0)).add(seed.mul(7.0)));
  const mSnake = texture(ground.masksB, P.div(11.0).add(0.37));
  const macroMean = (ground.macro.mean[0] + ground.macro.mean[1] + ground.macro.mean[2]) / 3;
  const macro = dot(texture(ground.macro.color, P.div(ground.macro.metres)).rgb, vec3(1 / 3)).div(macroMean);

  // How long ago this stretch was paved: by roadway, then by the paver's sections along it
  const section = s.div(43.0).add(seed.mul(17.0));
  let age;
  if (street) {
    age = mix(fract(seed.mul(7.31)), hash2D(vec2(floor(section), seed.mul(91.0))), isBox.oneMinus().mul(0.45)).add(mWorld.r.sub(0.5).mul(0.22));
  } else {
    age = texture(ground.masksA, P.div(190.0)).r.mul(0.7).add(mWorld.r.mul(0.3)).mul(0.6).add(0.25);
  }
  const oldness = smoothstep(0.52, 0.86, age);
  const freshRoad = not(smoothstep(0.07, 0.16, age));
  const inRoad = street ? smoothstep(-2.0, 2.5, s).mul(smoothstep(-2.0, 2.5, len.sub(s))).mul(not(isBox)) : float(0.0);

  // Utility cuts: saw-cut trenches across or along the roadway and squarer patches, some fresh, some long settled
  const cuts = (period, salt) => {
    const shift = seed.mul(13.0 + salt);
    const cell = floor(s.div(period).add(shift));
    const h = (k) => hash2D(vec2(cell.add(k * 7.13 + salt), seed.mul(57.0).add(k * 3.1 + salt)));
    const type = h(2);
    const across = step(type, 0.38);
    const lengthwise = step(0.38, type).mul(step(type, 0.74));
    const square = step(0.74, type);
    const centre = vec2(cell.sub(shift).add(0.5).mul(period).add(h(3).sub(0.5).mul(period * 0.5)), h(4).sub(0.5).mul(half.mul(1.5)));
    const size = vec2(
      across.mul(h(5).mul(0.35).add(0.3)).add(lengthwise.mul(h(5).mul(5.0).add(2.5))).add(square.mul(h(5).mul(1.1).add(0.7))),
      across.mul(half.mul(h(6).mul(0.65).add(0.35))).add(lengthwise.mul(h(6).mul(0.3).add(0.3))).add(square.mul(h(6).mul(0.9).add(0.6)))
    );
    const q = abs(vec2(s, o).sub(centre)).sub(size);
    const d = max(q.x, q.y).add(mFine.r.sub(0.5).mul(0.025));
    const has = step(0.4, h(1));
    return { inside: smoothstep(px, px.negate(), d).mul(has), edge: aaLine(abs(d), 0.016, px).mul(has), fresh: step(0.55, h(7)) };
  };
  const cutA = cuts(19.0, 0.0);
  const cutB = cuts(31.0, 5.7);
  const cutC = cuts(11.0, 2.9);
  const cutFresh = max(max(cutA.inside.mul(cutA.fresh), cutB.inside.mul(cutB.fresh)), cutC.inside.mul(cutC.fresh));
  const cutOld = max(max(cutA.inside.mul(not(cutA.fresh)), cutB.inside.mul(not(cutB.fresh))), cutC.inside.mul(not(cutC.fresh))).mul(not(cutFresh));
  const cutAny = max(max(cutA.inside, cutB.inside), cutC.inside);
  // The tar poured along the saw cut: there on most of the edge, gone in stretches
  const seal = max(max(cutA.edge, cutB.edge), cutC.edge).mul(smoothstep(0.2, 0.45, mLane.a));

  // Where traffic leaves its mark
  const wheel = isLane.mul(bell(abs(v), 0.46, 0.21));
  const polish = wheel.mul(mLane.a.mul(0.4).add(0.6)).mul(inRoad).mul(not(freshRoad.mul(0.7)));
  // Between two lanes nobody drives: grit, a darker seam
  const laneEdge = isLane.mul(smoothstep(0.72, 1.0, abs(v))).mul(inRoad);
  const stopNear = smoothstep(38.0, 3.0, toStop).mul(hasStop);
  const oil = isLane.mul(bell(v, 0.0, 0.3)).mul(inRoad).mul(stopNear.mul(0.45).add(0.55)).mul(mLane.r.mul(0.4).add(0.6)).mul(not(freshRoad.mul(0.6)));
  const rubber = wheel.mul(smoothstep(15.0, 1.5, toStop)).mul(hasStop).mul(inRoad);
  // Parking lanes: the drips of every engine that stood there, about one car length apart, on a grimier surface
  const slot = fract(s.div(6.1).add(seed.mul(3.0)));
  const engine = bell(slot, 0.72, 0.14);
  const dropField = texture(ground.masksB, vec2(o, s).div(1.9)).r;
  const drops = smoothstep(0.9, 0.975, dropField).mul(engine.mul(0.75).add(0.25)).mul(isPark).mul(inRoad);
  const blot = smoothstep(0.55, 0.9, mLane.r).mul(engine).mul(isPark).mul(inRoad);
  const curbDist = half.sub(abs(o));
  const gutterDirt = street ? not(smoothstep(0.0, 1.1, curbDist)).mul(not(isBox)) : float(0.0);
  // The paver's seams: between two lanes laid in separate passes, and across the roadway where a day's work ended
  const laneSeam = isLane.mul(aaLine(not(abs(v)).mul(bandHalf), 0.012, px)).mul(smoothstep(0.35, 0.6, mWorld.a)).mul(inRoad);
  const sectionSeam = street ? aaLine(not(abs(fract(section).sub(0.5)).mul(2.0)).mul(21.5), 0.014, px).mul(inRoad) : float(0.0);

  // Cracks where the roadway is old, tar snakes where the city sealed them; neither in a fresh pour
  const settled = not(max(freshRoad, cutAny));
  const worn = smoothstep(0.45, 0.8, age.add(mWorld.r.sub(0.5).mul(0.5))).mul(settled);
  const crack = mFine.a.mul(worn).mul(smoothstep(0.05, 0.012, px));
  const snake = mSnake.a.mul(smoothstep(0.5, 0.75, mWorld.a.add(age.sub(0.5).mul(0.6)))).mul(settled).mul(smoothstep(0.14, 0.05, px));

  // The three pours
  const A = sample(ground.asphalt, P.div(ground.asphalt.metres), null, 1.35);
  const B = sample(ground.blacktop, P.div(ground.blacktop.metres).add(0.31), null, 1.2);
  const C = sample(ground.chipseal, P.div(ground.chipseal.metres).add(0.63), null, 1.2);
  const wFresh = clamp(max(freshRoad, cutFresh), 0.0, 1.0);
  const wOld = smoothstep(0.3, 0.7, oldness.add(polish.mul(0.3)).add(C.height.sub(0.5).mul(0.35))).mul(not(wFresh));

  // Puddle field & wetness masks shared by every channel below; the gutters and the worn wheel paths hold water first
  const puddleField = roadPuddleField(P.x, P.y).add(gutterDirt.mul(0.14).add(polish.mul(0.03)).mul(smoothstep(0.3, 0.6, cityUniforms.uRoadWetness)));
  const wet = roadWetMasks(puddleField);
  const damp = wet.x;
  const puddle = wet.y;
  const film = wet.z;
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const waterFresnel = pow(not(clamp(viewDir.y, 0.0, 1.0)), 5.0).mul(0.98).add(0.02);

  const sky = canyonSkyAONode();
  mat.aoNode = sky;

  const albedo = Fn(() => {
    const pours = mix(mix(A.tone.mul(ASPHALT), C.tone.mul(CHIPSEAL), wOld), B.tone.mul(BLACKTOP), wFresh);
    // A settled patch: the same asphalt from another batch, a little paler and tighter than the road around it
    const surface = mix(pours, A.tone.mul(ASPHALT).mul(1.12), cutOld);
    const worked = surface
      .mul(mix(float(1.0), macro, 0.6))
      .mul(mWorld.r.sub(0.5).mul(0.2).add(1.0))
      .mul(polish.mul(0.34).add(1.0))
      .mul(not(oil.mul(0.62)))
      .mul(not(laneEdge.mul(0.14)))
      .mul(not(rubber.mul(0.3)))
      .mul(not(drops.mul(0.55)))
      .mul(not(blot.mul(0.28)))
      .mul(not(isPark.mul(0.16)))
      .mul(not(isBox.mul(0.05)))
      .mul(not(gutterDirt.mul(0.2)))
      .mul(not(seal.mul(0.5)))
      .mul(not(crack.mul(0.55)))
      .mul(not(snake.mul(0.6)))
      .mul(not(sectionSeam.mul(0.45)))
      .mul(not(laneSeam.mul(0.3)));
    // A bus lane's red coat, worn through to the asphalt where the wheels run and wherever it has flaked
    const flaked = smoothstep(0.5, 0.78, mLane.r.mul(0.55).add(mFine.r.mul(0.45)));
    const coat = isBus.mul(inRoad).mul(not(clamp(polish.mul(0.85).add(flaked.mul(0.7)).add(crack).add(cutAny), 0.0, 1.0)));
    const coated = mix(worked, BUS_RED.mul(A.tone).mul(mix(float(1.0), macro, 0.4)), coat.mul(0.94));
    // Water filling the pores darkens the surface: damp stains & pools most, the overall wet film a little
    const wetDarkening = mix(mix(float(1.0), float(0.72), damp), float(0.6), puddle).mul(mix(float(1.0), float(0.8), film));
    return coated.mul(wetDarkening);
  })();
  mat.colorNode = albedo;

  mat.roughnessNode = Fn(() => {
    const photo = mix(mix(A.rough, C.rough, wOld), B.rough, wFresh);
    const dry = clamp(photo.mul(0.25).add(0.72)
      .sub(polish.mul(0.22))
      .sub(oil.mul(0.36))
      .sub(drops.mul(0.3))
      .sub(seal.mul(0.38))
      .sub(snake.mul(0.42))
      .sub(rubber.mul(0.08))
      .add(crack.mul(0.05)), 0.3, 1.0);
    // The wet film only takes the edge off the asphalt's mattness; real gloss is kept for damp stains and standing water
    const filmed = mix(dry, float(0.68), film.mul(0.7));
    return mix(mix(filmed, float(0.4), damp.mul(0.85)), float(0.1), puddle);
  })();

  // Water's Fresnel (F0 = 0.02) rides on metalness, as for the rivers: pools reflect at grazing angles, darken from above
  mat.metalnessNode = clamp(waterFresnel.mul(1.6), 0.0, 0.85).mul(max(puddle, max(damp.mul(0.35), film.mul(0.15))));

  mat.normalNode = flatNormal(mix(mix(A.slope, C.slope, wOld), B.slope, wFresh).mul(not(puddle)), 1.6);

  mat.emissiveNode = Fn(() => {
    const roadFresnel = pow(clamp(not(abs(viewDir.y)), 0.0, 1.0), 2.3);
    const skyMirror = mix(cityUniforms.uSkyHorizonColor, cityUniforms.uSkyTopColor, 0.4).mul(0.1);
    // Times Square's signs in the wet roadway
    const tsDist = clamp(not(length(vec2(P.x.add(212.0), P.y.add(45.0))).div(145.0)), 0.0, 1.0);
    const neonCol = mix(vec3(1.0, 0.027, 0.235), vec3(0.027, 0.66, 1.0), mWorld.r).mul(0.32);
    const reflectCol = mix(skyMirror, neonCol, tsDist.mul(0.65));
    return reflectCol.mul(max(puddle, film.mul(0.35))).mul(roadFresnel).mul(cityUniforms.uInteriorGlow).mul(0.07).add(canyonFill(albedo, sky));
  })();

  return mat;
}

/**
 * Sidewalks. With `coords` the mesh carries `coord` = (metres along its side of the island, that side's seed or -1 in
 * the middle of the island, metres in from the curb line, the island's seed) from js/ground-plan.js buildIsland;
 * without, flags follow the world axes and no curb is known (park paths, plazas).
 *
 * A New York sidewalk is a patchwork, because every owner paves his own frontage: each side is cut into lots of 8 to
 * 20 m, and each lot is one of five pavings: grey 5 ft flags, the same decades older (darker, stained, cracked,
 * heaved), a fresh pale pour, charcoal pigmented concrete saw-cut in half flags, or bluestone slabs in running bond.
 * A black expansion joint parts two lots. Along the curb of most islands runs a strip of Belgian block (or a band of
 * dark concrete), where poles and hydrants stand. Utility crews leave rectangles of new concrete or of asphalt. Grime,
 * stains and gum thicken toward the curb. Past the property line (the middle of the island) the paving is the owner's.
 */
function createGroundWalkMaterial({ coords = false } = {}) {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.88, side: THREE.DoubleSide });
  mat.name = 'GroundWalk';
  const P = positionWorld.xz;
  const px = max(length(fwidth(P)), 0.0005);
  const FLAG = 1.524;
  const LOT = FLAG * 18; // lots begin and end on a flag joint
  const STRIP = 0.72;

  let along, depth, seed, sideSeed, interior;
  if (coords) {
    const c = attribute('coord', 'vec4');
    interior = step(c.y, -0.5); // the middle of the island has no side to follow: world axes, plain flags
    along = mix(c.x, P.x, interior);
    depth = c.z;
    sideSeed = max(c.y, 0.0);
    seed = c.w;
  } else {
    interior = float(1.0);
    along = P.x; depth = float(2.6); sideSeed = float(0.31); seed = float(0.5);
  }
  const edged = not(interior);

  // The strip along the curb: Belgian block on some islands, a band of dark concrete on others, nothing on the rest
  const stripPick = fract(seed.mul(3.9));
  const hasStrip = step(0.42, stripPick).mul(edged);
  const stripSetts = hasStrip.mul(step(stripPick, 0.88));
  const inStrip = hasStrip.mul(step(depth, CURB_WIDTH + STRIP));
  const across = mix(depth.sub(hasStrip.mul(STRIP)).sub(CURB_WIDTH), P.y, interior); // rows of flags count from the strip

  // Lots along the side: two to a 27 m stretch, cut on a flag joint somewhere between its first and last third
  const lotCoord = along.div(LOT);
  const lotBase = floor(lotCoord);
  const cut = floor(hash2D(vec2(lotBase, sideSeed.mul(53.0))).mul(9.0)).add(5.0).div(18.0);
  const lotKey = lotBase.mul(2.0).add(step(cut, fract(lotCoord)));
  const lotHash = (k) => hash2D(vec2(lotKey.add(k * 3.7), sideSeed.mul(97.0).add(seed.mul(31.0)).add(k * 1.3)));
  const pick = mix(lotHash(1), float(0.2), interior);
  const between = (a, b) => step(a, pick).mul(step(pick, b));
  const isOld = between(0.4, 0.6);
  const isNew = between(0.6, 0.72);
  const isTint = between(0.72, 0.84);
  const isBlue = step(0.84, pick);
  const lotEdge = min(min(fract(lotCoord), not(fract(lotCoord))), abs(fract(lotCoord).sub(cut))).mul(LOT);
  const lotJoint = aaLine(lotEdge, 0.011, px).mul(edged).mul(not(inStrip));

  // The paving unit of the lot: 5 ft flags, half flags where the concrete is saw-cut, 4 ft x 2.5 ft slabs in running
  // bond for bluestone
  const size = vec2(mix(mix(float(FLAG), float(FLAG / 2), isTint), float(1.219), isBlue), mix(mix(float(FLAG), float(FLAG / 2), isTint), float(0.762), isBlue));
  const row = floor(across.div(size.y));
  const unit = vec2(along.div(size.x).add(mod(row, 2.0).mul(0.5).mul(isBlue)), across.div(size.y));
  const unitId = floor(unit);
  const local = fract(unit).sub(0.5);
  const edge = min(float(0.5).sub(abs(local.x)).mul(size.x), float(0.5).sub(abs(local.y)).mul(size.y)); // metres to the nearest joint
  const h1 = hash2D(unitId.add(lotKey.mul(0.37)).add(seed.mul(71.0)));
  const h2 = hash2D(unitId.add(vec2(17.3, 5.1)).add(lotKey.mul(0.11)).add(seed.mul(13.0)));
  const h3 = hash2D(unitId.add(vec2(3.9, 41.7)).add(seed.mul(29.0)));
  const plain = not(max(max(isOld, isNew), max(isTint, isBlue)));
  const replaced = step(0.9, h2).mul(plain); // a newer, paler flag among the grey ones
  const aged = max(isOld, step(h2, 0.22).mul(plain)); // hand-trowelled, weathered
  const cracked = step(mix(mix(float(0.92), float(0.62), isOld), float(0.97), max(isTint, isNew)), h3).mul(not(replaced));

  // Utility cuts: a rectangle of new concrete, or of asphalt nobody came back to replace
  const cutCell = floor(along.div(11.0).add(sideSeed.mul(5.0)));
  const cutHash = (k) => hash2D(vec2(cutCell.add(k * 5.1), sideSeed.mul(41.0).add(seed.mul(17.0)).add(k)));
  const cutCentre = vec2(cutCell.sub(sideSeed.mul(5.0)).add(0.5).mul(11.0).add(cutHash(2).sub(0.5).mul(6.0)), cutHash(3).mul(2.4).add(1.1));
  const cutSize = vec2(cutHash(4).mul(0.9).add(0.45), cutHash(5).mul(0.5).add(0.4));
  const cutQ = abs(vec2(along, depth).sub(cutCentre)).sub(cutSize);
  const cutD = max(cutQ.x, cutQ.y);
  const hasCut = step(0.68, cutHash(1)).mul(edged).mul(not(inStrip));
  const patch = smoothstep(px, px.negate(), cutD).mul(hasCut);
  const patchSeal = aaLine(abs(cutD), 0.01, px).mul(hasCut);
  const patchAsphalt = patch.mul(step(0.55, cutHash(6)));
  const patchFresh = patch.mul(not(step(0.55, cutHash(6))));

  // Each unit takes its own patch of the photographs; the gradients are those of the unbroken coordinates, or the jump
  // at each joint would pull the smallest mip in along it
  const uvC = P.div(ground.concrete.metres);
  const uvT = P.div(ground.trowel.metres);
  const jump = vec2(h1, h3).mul(3.7);
  const Cc = sample(ground.concrete, uvC.add(jump), [dFdx(uvC), dFdy(uvC)], 1.25);
  const Ct = sample(ground.trowel, uvT.add(jump), [dFdx(uvT), dFdy(uvT)], 1.05);
  // Belgian block: its courses run along the curb
  const uvS = vec2(along, depth).div(ground.setts.metres);
  const Cs = sample(ground.setts, uvS, null, 1.3);
  const rubbed = max(aged.mul(plain), isBlue).mul(not(patch));
  const tone = mix(Cc.tone, Ct.tone, rubbed);
  const flagSlope = mix(Cc.slope, Ct.slope, rubbed);
  const photoRough = mix(Cc.rough, Ct.rough, rubbed);

  const mWorld = texture(ground.masksA, P.div(9.0));
  const mFine = texture(ground.masksB, P.div(1.3));
  const crackUV = local.mul(0.31).add(vec2(h3, h1));
  const crackLine = texture(ground.masksB, crackUV).grad(dFdx(unit.mul(0.31)), dFdy(unit.mul(0.31))).a
    .mul(cracked).mul(smoothstep(0.0, 0.05, edge)).mul(smoothstep(0.06, 0.015, px)).mul(not(patch));

  const curbZone = not(smoothstep(0.25, 2.0, depth)).mul(edged);
  const dirty = mix(mix(float(1.0), float(1.8), isOld), float(0.35), max(isNew, replaced));
  const stain = smoothstep(0.4, 0.9, mWorld.r).mul(curbZone.mul(0.5).add(0.5)).mul(dirty);
  const leak = smoothstep(0.7, 0.98, mWorld.a).mul(curbZone.mul(0.7).add(0.3)).mul(dirty);
  // Trodden gum: black dots a thumb across, thickest along the curb
  const gum = smoothstep(0.94, 0.972, mFine.r).mul(curbZone.mul(0.4).add(0.6)).mul(dirty.min(1.2)).mul(smoothstep(0.03, 0.008, px)).mul(not(inStrip));
  const jointWidth = mix(mix(float(0.0045), float(0.0018), isTint), float(0.006), max(isOld, isBlue));
  const joint = aaLine(edge, jointWidth, px).mul(not(inStrip));
  const jointGrime = not(smoothstep(0.0, 0.045, edge)).mul(smoothstep(0.08, 0.02, px)).mul(not(isTint)).mul(not(inStrip));
  // Where the strip meets the flags: a mortar line
  const stripEdge = aaLine(abs(depth.sub(CURB_WIDTH + STRIP)), 0.009, px).mul(hasStrip);

  // Damp patches & pools, better drained than the roadway
  const swField = roadPuddleField(P.x.add(31.0), P.y.sub(17.0)).mul(0.7).add(mWorld.r.mul(0.3));
  const swWet = roadWetMasks(swField, 0.06);
  const swPuddle = swWet.y;
  const swFresnel = pow(not(clamp(normalize(cameraPosition.sub(positionWorld)).y, 0.0, 1.0)), 5.0).mul(0.98).add(0.02);

  const sky = canyonSkyAONode();
  mat.aoNode = sky;

  const albedo = Fn(() => {
    // Bluestone comes blue-grey, green-grey or rust-brown, slab by slab
    const stoneTint = mix(mix(BLUESTONE, vec3(0.155, 0.168, 0.142), step(0.55, h2)), vec3(0.2, 0.155, 0.118), step(0.86, h2));
    const paving = mix(mix(mix(mix(CONCRETE, CONCRETE.mul(vec3(0.7, 0.68, 0.64)), isOld), CONCRETE.mul(1.3), isNew), CHARCOAL, isTint), stoneTint, isBlue);
    const spread = mix(mix(float(0.22), float(0.34), max(isOld, isBlue)), float(0.1), max(isNew, isTint));
    const unitTone = h1.sub(0.5).mul(spread).add(1.0).mul(mix(float(1.0), float(1.26), replaced)).mul(mix(float(1.0), float(0.9), aged.mul(plain)));
    const flags = tone.mul(paving).mul(unitTone)
      .mul(not(jointGrime.mul(0.16)))
      .mul(not(joint.mul(0.68)))
      .mul(not(crackLine.mul(0.6)));
    // The cuts: fresh concrete, or asphalt with its grit
    const patched = mix(mix(flags, Cc.tone.mul(CONCRETE).mul(1.34), patchFresh), Cc.tone.mul(vec3(0.045, 0.045, 0.047)).mul(mFine.r.mul(0.5).add(0.75)), patchAsphalt)
      .mul(not(patchSeal.mul(0.6)));
    const strip = mix(Cc.tone.mul(CHARCOAL).mul(not(aaLine(float(0.5).sub(abs(fract(along.div(0.762)).sub(0.5))).mul(0.762), 0.002, px).mul(0.6))), Cs.tone.mul(SETTS), stripSetts);
    return mix(patched, strip, inStrip)
      .mul(not(stripEdge.mul(0.55)))
      .mul(not(lotJoint.mul(0.82)))
      .mul(not(stain.mul(0.42)))
      .mul(not(leak.mul(0.28)))
      .mul(not(curbZone.mul(0.14)))
      .mul(not(gum.mul(0.66)))
      .mul(mix(float(1.0), float(0.72), max(swWet.x, swPuddle)))
      .mul(mix(float(1.0), float(0.8), swWet.z));
  })();
  mat.colorNode = albedo;
  mat.emissiveNode = canyonFill(albedo, sky);

  mat.roughnessNode = Fn(() => {
    const finish = mix(mix(photoRough.mul(0.3).add(0.62), float(0.6), isTint), float(0.68), isBlue);
    const dry = clamp(mix(finish, Cs.rough.mul(0.35).add(0.5), inStrip.mul(stripSetts)).sub(gum.mul(0.25)).sub(leak.mul(0.12)).add(patchAsphalt.mul(0.2)), 0.3, 1.0);
    return mix(mix(dry, float(0.55), max(swWet.z, swWet.x.mul(0.7))), float(0.18), swPuddle);
  })();

  mat.metalnessNode = clamp(swFresnel.mul(1.6), 0.0, 0.85).mul(max(swPuddle, swWet.z.mul(0.3)));

  // Tooled joints, flags heaved out of true (old ones most), cracks, the setts' own relief, on top of the grain
  mat.normalNode = Fn(() => {
    const groove = not(smoothstep(jointWidth, max(float(0.016), px.mul(2.0)), edge)).mul(0.007).mul(smoothstep(0.03, 0.008, px)).mul(not(inStrip));
    const tiltAngle = h2.mul(Math.PI * 2);
    const heave = mix(mix(float(0.011), float(0.026), isOld), float(0.003), max(isTint, isNew));
    const tilt = dot(local, vec2(tiltAngle.cos(), tiltAngle.sin())).mul(size.x).mul(h3.mul(heave)).mul(not(replaced))
      .mul(smoothstep(0.0, max(float(0.06), px.mul(3.0)), edge)).mul(not(inStrip));
    const height = tilt.sub(groove).sub(crackLine.mul(0.002)).add(patch.mul(0.002)).sub(lotJoint.mul(0.004)).mul(not(swPuddle));
    // The photographs of the flags are laid on the world axes; the setts lie along their side, whichever way it runs
    const run = worldGradient(along, P), inward = worldGradient(depth, P);
    const settsTilt = run.mul(Cs.slope.x).sub(inward.mul(Cs.slope.y)).mul(1.7);
    const tilt2 = mix(vec2(flagSlope.x, flagSlope.y.negate()), settsTilt, inStrip.mul(stripSetts)).mul(not(swPuddle)).mul(1.15);
    const relief = transformDirection(normalize(vec3(tilt2.x, 1.0, tilt2.y)), cameraViewMatrix);
    return normalize(bumpNormal(height).add(relief).sub(normalViewGeometry));
  })();

  return mat;
}

/**
 * Curbstones. With `coords`, `coord` = (metres along the side, height above the road, metres in from the curb line,
 * seed). Two New York curbs by block: dressed granite, and concrete faced with a steel angle that rusts and scuffs
 * bright. Stones about 2 m long, grime at the foot where the gutter runs, tyre rubber on the face.
 */
function createGroundCurbMaterial({ coords = false } = {}) {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.75 });
  mat.name = 'GroundCurb';
  const P = positionWorld.xz;
  const px = max(length(fwidth(positionWorld)), 0.0005);
  let t, y, depth, seed;
  if (coords) {
    const c = attribute('coord', 'vec4');
    t = c.x; y = c.y; depth = c.z; seed = c.w;
  } else {
    t = P.x.add(P.y); y = positionWorld.y; depth = float(0.08); seed = float(0.2);
  }
  const top = smoothstep(0.45, 0.85, normalWorldGeometry.y);
  const steel = step(0.45, fract(seed.mul(3.3)));
  const STONE = 2.1;
  const along = t.div(STONE).add(seed.mul(3.0));
  const stoneId = floor(along);
  const jointDist = float(0.5).sub(abs(fract(along).sub(0.5))).mul(STONE);
  const joint = aaLine(jointDist, 0.004, px);
  const stoneTone = hash2D(vec2(stoneId, seed.mul(43.0))).sub(0.5).mul(0.22).add(1.0);

  // The stone's grain: crystals a few millimetres across on granite, a trowelled skin on concrete
  const face = vec2(t, depth.add(y));
  const grain = texture(ground.masksB, face.div(0.33)).r;
  const body = sample(ground.trowel, face.div(ground.trowel.metres));
  const streaks = texture(ground.masksA, vec2(y.mul(3.0).add(depth.mul(4.0)), t.div(5.0)));
  // The steel angle caps the nose: the top few centimetres of the face and the first of the top
  const nose = steel.mul(max(smoothstep(CURB_HEIGHT - 0.07, CURB_HEIGHT - 0.055, y).mul(not(top)), top.mul(not(smoothstep(0.045, 0.06, depth)))));
  const scuffed = nose.mul(smoothstep(0.55, 0.85, streaks.a));
  const foot = not(smoothstep(0.0, 0.15, y)).mul(not(top));
  const tyre = smoothstep(0.7, 0.95, streaks.a).mul(not(top)).mul(bell(y, 0.13, 0.05)).mul(not(nose));
  const wetFilm = smoothstep(0.2, 0.8, cityUniforms.uRoadWetness);

  const sky = canyonSkyAONode();
  mat.aoNode = sky;

  const albedo = Fn(() => {
    const granite = GRANITE.mul(grain.mul(0.42).add(0.79));
    const concrete = CURB_CONCRETE.mul(body.tone);
    const stone = mix(granite, concrete, steel).mul(stoneTone)
      .mul(not(joint.mul(0.55)))
      .mul(not(foot.mul(0.5)))
      .mul(not(tyre.mul(0.55)))
      .mul(not(streaks.r.mul(0.14)));
    const metal = mix(RUST.mul(streaks.r.mul(0.6).add(0.7)), vec3(0.36, 0.35, 0.34), scuffed);
    return mix(stone, metal, nose).mul(mix(float(1.0), float(0.78), wetFilm));
  })();
  mat.colorNode = albedo;
  mat.emissiveNode = canyonFill(albedo, sky);

  mat.roughnessNode = mix(mix(float(0.78), mix(float(0.62), float(0.38), scuffed), nose), float(0.5), wetFilm.mul(0.8));
  mat.metalnessNode = nose.mul(mix(float(0.35), float(0.9), scuffed));

  mat.normalNode = Fn(() => {
    const height = grain.mul(0.0012).mul(not(nose)).mul(smoothstep(0.012, 0.004, px)).sub(joint.mul(0.004));
    return bumpNormal(height);
  })();

  return mat;
}

/**
 * What collects along the curb: a see-through strip of grit, leaf litter and scraps in the roadway against every
 * curbstone (`coord` = (metres along the side, 0 at the curb .. 1 out in the roadway, 0, seed)). After rain it is the
 * line of standing water every New York street keeps.
 */
function createGutterMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.95, transparent: true, depthWrite: false });
  const mrtNode = transparentEffectMRT();
  if (mrtNode) mat.mrtNode = mrtNode; // reflections keep seeing the asphalt underneath
  const c = attribute('coord', 'vec4');
  const t = c.x;
  const out = c.y;
  const seed = c.w;
  const px = max(length(fwidth(positionWorld.xz)), 0.0005);
  const mask = texture(ground.masksA, vec2(out.mul(0.3).add(seed.mul(7.0)), t.div(9.0)));
  const bits = texture(ground.masksB, vec2(t, out.mul(GUTTER_WIDTH)).div(0.9).add(seed.mul(3.0))).r;
  const fall = pow(not(out), 1.6);
  const grit = fall.mul(smoothstep(0.2, 0.8, mask.r).mul(0.75).add(0.25));
  // Leaves, wrappers, butts: caught against the stone, where the sweeper's brush does not reach
  const scrap = smoothstep(0.93, 0.965, bits).mul(not(smoothstep(0.35, 0.75, out))).mul(smoothstep(0.35, 0.6, mask.a)).mul(smoothstep(0.04, 0.012, px));
  const scrapTone = fract(bits.mul(37.0));
  const w = cityUniforms.uRoadWetness;
  const standing = smoothstep(0.15, 0.5, w).mul(pow(not(out), 0.8)).mul(smoothstep(0.25, 0.6, mask.r.add(w.mul(0.4))));
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const fresnel = pow(not(clamp(viewDir.y, 0.0, 1.0)), 5.0).mul(0.98).add(0.02);

  mat.aoNode = canyonSkyAONode();
  // Dark damp grime packed against the stone, pale dust drifting out from it
  const soil = mix(DUST, DIRT, smoothstep(0.45, 0.05, out).mul(mask.a.mul(0.5).add(0.5)));
  mat.colorNode = mix(soil.mul(mix(float(1.0), float(0.55), max(standing, smoothstep(0.2, 0.8, w)))), mix(vec3(0.2, 0.14, 0.06), vec3(0.42, 0.4, 0.36), step(0.7, scrapTone)).mul(scrapTone.mul(0.5).add(0.6)), scrap);
  mat.opacityNode = clamp(max(max(grit.mul(0.5), scrap), standing.mul(0.7)), 0.0, 1.0);
  mat.roughnessNode = mix(float(0.95), float(0.07), standing.mul(not(scrap)));
  mat.metalnessNode = clamp(fresnel.mul(1.6), 0.0, 0.85).mul(standing).mul(not(scrap));
  mat.normalNode = normalViewGeometry;
  return mat;
}

/** The bed of a street tree: dark trodden soil with its grit and a few fallen scraps, damp after rain */
function createGroundSoilMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.96 });
  mat.name = 'GroundSoil';
  const P = positionWorld.xz;
  const S = sample(ground.chipseal, P.div(1.1), null, 1.5);
  const clumps = texture(ground.masksA, P.div(2.3)).r;
  const bits = texture(ground.masksB, P.div(0.7)).r;
  const litter = smoothstep(0.93, 0.97, bits);
  const film = smoothstep(0.2, 0.8, cityUniforms.uRoadWetness);
  const sky = canyonSkyAONode();
  const albedo = mix(vec3(0.05, 0.036, 0.024).mul(S.tone).mul(clumps.mul(0.5).add(0.75)), vec3(0.2, 0.15, 0.07).mul(fract(bits.mul(29.0)).mul(0.6).add(0.5)), litter)
    .mul(mix(float(1.0), float(0.6), film));
  mat.aoNode = sky;
  mat.colorNode = albedo;
  mat.emissiveNode = canyonFill(albedo, sky);
  mat.roughnessNode = mix(float(0.96), float(0.6), film);
  // only the bed's top takes the photograph's relief: its sides are a finger high
  mat.normalNode = mix(normalViewGeometry, flatNormal(S.slope, 1.8), step(0.5, normalWorldGeometry.y));
  return mat;
}

// What the decals of js/ground-dressing.js share: see-through, on top of whatever ground they lie on
function decalMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.6, transparent: true, depthWrite: false });
  const mrtNode = transparentEffectMRT();
  if (mrtNode) mat.mrtNode = mrtNode;
  mat.aoNode = canyonSkyAONode();
  return mat;
}

/**
 * Cast iron and steel set in the ground: manhole covers, grates, cellar doors, pads (atlas ground.objects; attributes
 * `tint` = colour & opacity, `frame` = (direction of the tile's top in world x, z, metalness of its bare parts, -)).
 * Their relief is a normal map in the tile's own frame, turned to wherever the cover was dropped.
 */
function createGroundObjectMaterial() {
  const mat = decalMaterial();
  const tint = attribute('tint', 'vec4');
  const frame = attribute('frame', 'vec4');
  const c = texture(ground.objects.color, uv());
  const n = texture(ground.objects.normal, uv());
  const t = n.xyz.mul(2.0).sub(1.0);
  const top = frame.xy; // the tile's +Y; its +X is to the right of it
  const relief = normalize(vec3(top.x.mul(t.y).sub(top.y.mul(t.x)), t.z.mul(0.75), top.y.mul(t.y).add(top.x.mul(t.x))));
  const film = smoothstep(0.2, 0.8, cityUniforms.uRoadWetness);
  // Street iron is mostly oxide: a dark, rough skin that scatters light, with bare metal only where feet and tyres
  // polish it. Treated as pure metal it turned every plate into a black mirror of the shaded street.
  const opening = step(0.985, n.a);
  mat.colorNode = c.rgb.mul(tint.rgb).mul(mix(float(1.0).add(frame.z.mul(0.7)), float(1.0), opening)).mul(mix(float(1.0), float(0.7), film));
  mat.opacityNode = c.a.mul(tint.a);
  mat.roughnessNode = mix(n.a, n.a.mul(0.45), film);
  // Worked metal is smooth; rust, dirt and leaves are rough and not metal. Roughness 1 is kept for the openings of
  // grates: metal again, so nothing lights the void between the bars
  mat.metalnessNode = max(frame.z.mul(not(smoothstep(0.72, 0.95, n.a))).mul(0.4), opening);
  mat.normalNode = transformDirection(relief, cameraViewMatrix);
  return mat;
}

/**
 * Paint and stains (atlas ground.marks, a mask; `tint` = colour & strength, `frame` = (direction x, z, roughness, how
 * much has flaked off)). Road symbols chip the way thermoplastic does, in flakes; oil stays glossy, rubber matt.
 */
function createGroundMarkMaterial() {
  const mat = decalMaterial();
  const tint = attribute('tint', 'vec4');
  const frame = attribute('frame', 'vec4');
  const P = positionWorld.xz;
  const mask = texture(ground.marks, uv()).r;
  const blotch = texture(ground.masksA, P.div(3.3)).r;
  const flakes = texture(ground.masksB, P.div(0.8)).r;
  const level = not(frame.w);
  const chipped = smoothstep(level.sub(0.06), level.add(0.06), blotch.mul(0.6).add(flakes.mul(0.4))).mul(step(0.01, frame.w));
  const film = smoothstep(0.2, 0.8, cityUniforms.uRoadWetness);
  mat.colorNode = tint.rgb.mul(blotch.mul(0.2).add(0.9)).mul(mix(float(1.0), float(0.8), film));
  mat.opacityNode = mask.mul(tint.a).mul(not(chipped));
  mat.roughnessNode = mix(frame.z, frame.z.mul(0.6), film);
  mat.normalNode = normalViewGeometry;
  return mat;
}

export {
  createGroundRoadMaterial, createGroundWalkMaterial, createGroundCurbMaterial, createGutterMaterial, createGroundSoilMaterial,
  createGroundObjectMaterial, createGroundMarkMaterial
};
