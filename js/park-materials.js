import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, attribute, uniform, positionWorld, normalWorldGeometry, normalViewGeometry,
  abs, max, mix, step, smoothstep, dot, length, normalize, pow, sin, fwidth, texture,
  specularColor, specularColorBlended, specularF90
} from 'three/tsl';
import { nature } from './nature-assets.js';
import { ground } from './ground-assets.js';
import { cityUniforms, noise2D, bumpNormal, transparentEffectMRT } from './tsl-materials.js';
import { flatNormal, not } from './ground-materials.js';

// The ground of the parks. The same rule as the streets (js/ground-materials.js): the ground shows what happens on
// it. A lawn is not a carpet: it is lush where it is watered and kept, straw where it is walked on, thin and strewn
// with leaves under the trees, bare earth where the shade or the feet won, mud along the water. Central Park knows
// all of that for every square metre (the park field, js/park-plan.js bakeParkField); the other lawns guess.

// The park field: canopy, wear, shore, kept (see bakeParkField). One texel until the park is surveyed.
const field = { map: new THREE.DataTexture(new Uint8Array(4), 1, 1), frame: uniform(new THREE.Vector4(0, 0, 1, 1)) };
field.map.name = 'Park field';
field.map.magFilter = field.map.minFilter = THREE.LinearFilter;
field.map.generateMipmaps = false;
field.map.needsUpdate = true;

function setParkField(baked) {
  field.map.image = { data: baked.data, width: baked.width, height: baked.height };
  field.map.needsUpdate = true;
  field.frame.value.set(baked.minX, baked.minZ, baked.width * baked.cell, baked.height * baked.cell);
}

// Mean linear colour of the two turf photographs (assets/nature): they are used for their blades, not their green
const LAWN_MEAN = vec3(0.0606, 0.1095, 0.023);
const MEADOW_MEAN = vec3(0.1362, 0.2366, 0.0274);
// Albedos (linear)
const GRASS = vec3(0.066, 0.112, 0.03);
const LUSH = vec3(0.032, 0.086, 0.02);
const STRAW = vec3(0.175, 0.162, 0.078);
const CLOVER = vec3(0.03, 0.076, 0.032);
const EARTH = vec3(0.16, 0.126, 0.09);
const LEAVES = vec3(0.1, 0.07, 0.042);
const MUD = vec3(0.04, 0.034, 0.026);
const SHOULDER = vec3(0.1, 0.086, 0.066); // earth greyed by the grit of the drive
const SCHIST = vec3(0.105, 0.105, 0.11);
const MOSS = vec3(0.05, 0.075, 0.028);
const LICHEN = vec3(0.2, 0.21, 0.18);

const toneOf = (surface, uv) => texture(surface.color, uv).rgb.div(vec3(...surface.mean));

/**
 * What grows at world xz `P`: how much of the ground is bare (`bare`), how much of that is mud (`mud`), the colour of
 * the grass that is left (`green`, without its blades), and the field it comes from. Cheap enough for a vertex:
 * the blades of js/grass.js ask it where to grow and what colour to be.
 */
function lawnLayers(P) {
  const uvF = P.sub(field.frame.xy).div(field.frame.zw);
  const inside = step(0.0, uvF.x).mul(step(uvF.x, 1.0)).mul(step(0.0, uvF.y)).mul(step(uvF.y, 1.0));
  const F = texture(field.map, uvF);
  // Blotches at five scales, two of them on turned axes so no two line up. (Only the blotch channel of masksA: its
  // streak channel is made for roads, and on a lawn it draws rays.)
  const Q = vec2(P.x.mul(0.8).sub(P.y.mul(0.6)), P.x.mul(0.6).add(P.y.mul(0.8)));
  const mMacro = texture(ground.masksA, P.div(211.0)).r;
  const mDry = texture(ground.masksA, Q.div(61.0).add(0.57)).r;
  const mPatch = texture(ground.masksA, P.div(37.0).add(0.13)).r;
  const mVar = texture(ground.masksA, Q.div(13.0).add(0.29)).r;
  const mBlot = texture(ground.masksA, P.div(7.3).add(0.41)).r;
  const mFine = texture(ground.masksB, P.div(2.3)).r;
  // Outside the surveyed park the trees are guessed: shade in patches a tree or two across
  const canopy = mix(smoothstep(0.55, 0.85, not(mDry)).mul(0.3), F.r, inside);
  const wear = F.g.mul(inside), shore = F.b.mul(inside), kept = F.a.mul(inside);
  // Grass gives up where the sum of what wears it passes a threshold: none of an open lawn, most of the ground under a
  // full crown, so every tree stands in its ring of earth and leaves
  const threshold = float(1.02).sub(canopy.mul(0.62)).sub(wear.mul(0.6)).add(kept.mul(0.3));
  const trodden = mBlot.mul(0.5).add(mPatch.mul(0.3)).add(mFine.mul(0.2));
  const mud = smoothstep(0.55, 0.9, shore.add(mBlot.sub(0.5).mul(0.35)));
  const bare = max(smoothstep(threshold.sub(0.1), threshold.add(0.05), trodden), mud);
  const lush = smoothstep(0.3, 0.7, mMacro.mul(0.5).add(mPatch.mul(0.5))).mul(not(wear));
  const dry = smoothstep(0.6, 0.9, mDry.mul(0.6).add(mVar.mul(0.4)).add(wear.mul(0.5)).sub(shore.mul(0.5)).sub(canopy.mul(0.15)).sub(kept.mul(0.15)));
  const clover = smoothstep(0.78, 0.9, mBlot.mul(0.65).add(mVar.mul(0.35))).mul(not(dry));
  const green = mix(mix(mix(GRASS, LUSH, lush), CLOVER, clover.mul(0.55)), STRAW, dry.mul(0.85)).mul(mix(float(1.0), float(0.8), canopy))
    .mul(mVar.mul(0.3).add(0.85));
  return { canopy, wear, shore, kept, bare, mud, green, mVar, mFine };
}

// The lawn's colour at `P`, a pixel being `px` metres: blades, fallen leaves, earth, leaf litter, mud
function lawnAlbedo(P, L, px) {
  const turf = texture(nature.lawn, P.div(2.9)).rgb.div(LAWN_MEAN);
  const far = texture(nature.meadow, P.div(13.7).add(0.37)).rgb.div(MEADOW_MEAN);
  const blades = turf.mul(mix(vec3(1.0), far, 0.45));
  const earth = toneOf(ground.dirt, P.div(ground.dirt.metres)).mul(EARTH);
  const leaves = toneOf(ground.litter, P.div(ground.litter.metres * 0.8)).mul(LEAVES);
  // Under the trees the bare ground is last year's leaves; in the open it is earth
  const litter = smoothstep(0.2, 0.55, L.canopy).mul(smoothstep(0.3, 0.6, L.mVar));
  const soil = mix(mix(earth, leaves, litter), earth.mul(MUD.div(EARTH)), L.mud);
  const fallen = smoothstep(0.9, 0.955, L.mFine).mul(smoothstep(0.15, 0.5, L.canopy)).mul(smoothstep(0.05, 0.015, px));
  // Kept lawns are mown in bands
  const mown = smoothstep(-0.25, 0.25, sin(dot(P, vec2(0.83, 0.56)).mul((Math.PI * 2) / 5.4))).sub(0.5).mul(0.12).mul(L.kept);
  const grass = blades.mul(L.green).mul(mown.add(1.0));
  const wet = smoothstep(0.2, 0.8, cityUniforms.uRoadWetness);
  return mix(mix(grass, leaves.mul(1.3), fallen.mul(0.8)), soil, L.bare).mul(mix(float(1.0), float(0.8), wet));
}

/** A lawn's colour for a material that has other things to draw (the piers' shared ground, the planted malls) */
const lawnColorNode = () => Fn(() => {
  const P = positionWorld.xz;
  const mMacro = texture(ground.masksA, P.div(211.0)).r;
  const mPatch = texture(ground.masksA, P.div(37.0).add(0.13)).r;
  const mDry = texture(ground.masksA, vec2(P.x.mul(0.8).sub(P.y.mul(0.6)), P.x.mul(0.6).add(P.y.mul(0.8))).div(61.0).add(0.57)).r;
  const lush = smoothstep(0.3, 0.7, mMacro.mul(0.5).add(mPatch.mul(0.5)));
  const dry = smoothstep(0.6, 0.9, mDry);
  return texture(nature.lawn, P.div(2.9)).rgb.div(LAWN_MEAN).mul(mix(mix(GRASS, LUSH, lush), STRAW, dry.mul(0.7)));
})();

/**
 * Lawns and the floor of the woods: see lawnLayers and lawnAlbedo. The ground of Central Park is flat; its light is
 * not: a slow swell tilts the shading as rolling ground would.
 */
function createGroundLawnMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.92 });
  mat.name = 'GroundLawn';
  mat.userData.lawn = true; // js/grass.js grows its blades on it
  const P = positionWorld.xz;
  const px = max(length(fwidth(P)), 0.0005);
  const L = lawnLayers(P);
  const wet = smoothstep(0.2, 0.8, cityUniforms.uRoadWetness);

  mat.colorNode = lawnAlbedo(P, L, px);
  mat.roughnessNode = mix(float(0.92), mix(mix(float(0.95), float(0.7), wet), float(0.45), L.mud), L.bare);
  mat.normalNode = Fn(() => {
    const swell = noise2D(P.div(47.0)).sub(0.5).mul(1.9).add(noise2D(P.div(17.0).add(5.3)).sub(0.5).mul(0.55));
    const turf = texture(nature.lawnNormal, P.div(2.9)).xy.mul(2.0).sub(1.0);
    return normalize(bumpNormal(swell).add(flatNormal(turf.mul(not(L.bare.mul(0.6))), 0.8)).sub(normalViewGeometry));
  })();

  // Grass is a canopy of blades that shadow each other, not a flat dielectric: at grazing angles a plain F0 = 0.04 /
  // F90 = 1 Fresnel mirrors the sky and turns lawns teal, so weaken the specular and cap its grazing rise
  mat.setupSpecular = function () {
    specularColor.assign(vec3(0.025));
    specularColorBlended.assign(vec3(0.025));
    specularF90.assign(0.3);
  };
  return mat;
}

/**
 * Where paving or water meets the grass: a see-through band (`coord` = (metres along, 0 at the paving or the water ..
 * 1 out on the lawn, 0 a drive's shoulder / 1 a shore, seed)). Solid earth against the edge, eaten away by the grass
 * further out, so no lawn ends on a ruled line. A shoulder is trodden earth with the grit that washes off the drive;
 * a shore is wet mud and pebbles.
 */
function createParkEdgeMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.95, transparent: true, depthWrite: false });
  mat.name = 'ParkEdge';
  const mrtNode = transparentEffectMRT();
  if (mrtNode) mat.mrtNode = mrtNode;
  const c = attribute('coord', 'vec4');
  const s = c.x, out = c.y, shore = c.z, seed = c.w;
  const P = positionWorld.xz;
  const px = max(length(fwidth(P)), 0.0005);
  const along = texture(ground.masksA, vec2(out.mul(0.3).add(seed.mul(5.0)), s.div(13.0)));
  const patch = texture(ground.masksA, P.div(5.1).add(0.27));
  const bits = texture(ground.masksB, P.div(1.1)).r;
  const earth = toneOf(ground.dirt, P.div(ground.dirt.metres).add(0.5));
  const reach = along.r.mul(0.75).add(patch.r.mul(0.25));
  const wet = smoothstep(0.2, 0.8, cityUniforms.uRoadWetness);
  const grit = smoothstep(0.78, 0.9, bits).mul(not(smoothstep(0.05, 0.55, out))).mul(smoothstep(0.05, 0.015, px));
  const damp = shore.mul(not(smoothstep(0.0, 0.6, out)));

  mat.colorNode = mix(mix(earth.mul(SHOULDER).mul(patch.r.mul(0.3).add(0.85)), earth.mul(MUD), shore), vec3(0.3, 0.29, 0.27).mul(bits), grit)
    .mul(mix(float(1.0), float(0.75), max(wet, damp)));
  mat.opacityNode = smoothstep(out.sub(0.14), out.add(0.14), reach.mul(0.92).add(0.14));
  mat.roughnessNode = mix(mix(float(0.95), float(0.7), wet), float(0.3), damp);
  mat.normalNode = normalViewGeometry;
  return mat;
}

/**
 * Manhattan schist as it shows in Central Park: grey rock with its glitter of mica, lichen and moss on what faces the
 * sky, earth creeping up its foot. The photograph is laid on from three sides, so no face stretches it.
 * @param {number} groundY height of the lawn the outcrops rise from
 */
function createGroundRockMaterial(groundY = 1.2) {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.82 });
  mat.name = 'GroundRock';
  const p = positionWorld;
  const n = normalWorldGeometry;
  const w0 = pow(abs(n), vec3(4.0));
  const w = w0.div(w0.x.add(w0.y).add(w0.z));
  const M = ground.rock.metres * 1.5;
  const photo = texture(ground.rock.color, p.zy.div(M)).mul(w.x).add(texture(ground.rock.color, p.xz.div(M)).mul(w.y)).add(texture(ground.rock.color, p.xy.div(M)).mul(w.z));
  // (the photograph's own lichen is several times brighter than its rock: held back, or the outcrop goes chalk white)
  const tone = photo.rgb.div(vec3(...ground.rock.mean)).clamp(0.35, 1.7);
  const grey = dot(tone, vec3(1 / 3));
  const patch = texture(ground.masksA, p.xz.div(6.1));
  const fine = texture(ground.masksB, p.xz.add(p.y).div(0.9)).r;
  const top = smoothstep(0.55, 0.9, n.y);
  const moss = top.mul(smoothstep(0.55, 0.8, patch.r.mul(0.6).add(not(photo.a).mul(0.5))));
  const lichen = smoothstep(0.7, 0.86, texture(ground.masksA, p.xz.div(2.7).add(0.61)).r).mul(not(moss)).mul(smoothstep(0.2, 0.6, n.y));
  // The joints the frost opened, seen from above
  const joints = texture(ground.masksB, p.xz.div(7.0)).a.mul(top);
  const foot = not(smoothstep(0.0, patch.r.mul(0.5).add(0.25), p.y.sub(groundY)));
  const mica = smoothstep(0.9, 0.97, fine).mul(not(max(moss, foot)));
  const wet = smoothstep(0.2, 0.8, cityUniforms.uRoadWetness);

  mat.colorNode = mix(mix(mix(mix(vec3(grey), tone, 0.45).mul(SCHIST), MOSS.mul(grey.mul(0.5).add(0.6)), moss.mul(0.8)), LICHEN.mul(grey.mul(0.4).add(0.7)), lichen.mul(0.4)),
    toneOf(ground.dirt, p.xz.div(ground.dirt.metres)).mul(EARTH).mul(0.8), foot)
    .mul(mica.mul(0.5).add(1.0)).mul(not(joints.mul(0.6))).mul(mix(float(1.0), float(0.7), wet));
  mat.roughnessNode = mix(mix(float(0.84), float(0.95), max(moss, foot)), float(0.4), mica).mul(mix(float(1.0), float(0.75), wet));
  mat.normalNode = bumpNormal(photo.a.mul(0.06).mul(not(moss.mul(0.5))).sub(joints.mul(0.03)));
  return mat;
}

export { setParkField, lawnLayers, lawnColorNode, createGroundLawnMaterial, createParkEdgeMaterial, createGroundRockMaterial };
