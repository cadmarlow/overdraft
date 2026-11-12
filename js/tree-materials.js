import * as THREE from 'three/webgpu';
import {
  Fn, float, int, vec2, vec3, vec4, uniform, uniformArray, attribute, varying, positionGeometry, positionWorld, positionView, positionViewDirection,
  normalView, cameraPosition, cameraViewMatrix, frontFacing, screenCoordinate, interleavedGradientNoise, uv, time, texture,
  sin, cos, abs, floor, fract, mix, clamp, saturate, smoothstep, step, max, min, dot, cross, normalize, length, pow, exp2, log2, sqrt,
  dFdx, dFdy, fwidth, select, atan, asin, transformDirection
} from 'three/tsl';
import { urbanSkyVisibility } from './urban-light.js';
import { cityUniforms } from './tsl-materials.js';
import { trees } from './tree-assets.js';
import { DENSE_LOD_STEP } from './tree-levels.js';

// The trees' two materials: the mesh one (bark tubes and leaf-spray cards, levels of detail 0 and 1) and the impostor
// one (a tree far away is a card showing the photograph taken of it from that side, js/tree-assets.js).
//
// Instances are placed by the material itself, not by an instance matrix:
//   aInstA (x, y, z, yaw)   aInstB (scale across, scale up, random 0..1, gain on meshes | tree type on impostors)
// Vertex attributes of the meshes (tools/trees/lib/mesh.mjs):
//   aWind  (limb weight, limb phase, twig weight, twig phase)   aShade (sky occlusion, height / tree height, card random, leaf)
//
// What the surface is before light (the same formulas bake the impostor frames, tools/trees/lib/draw.mjs):
//   leaf = atlas * cardTint(random) * (0.5 + 0.5 occlusion) * (underside seen from below)     bark = photo * tint * (0.55 + 0.45 occlusion)

const treeUniforms = {
  // The player's camera. Levels of detail are judged from it in every pass, the sun's shadow passes included.
  view: uniform(new THREE.Vector3()),
  // (x, z) the way the wind blows, its speed in m/s, how gusty it is
  wind: uniform(new THREE.Vector4(0.86, 0.51, 3.5, 0.25)),
  // metres: where level 0 hands over to level 1, level 1 to the impostor, the width of each handover, where trees end
  bands: uniform(new THREE.Vector4(42, 120, 9, 1600))
};

// Sunlight shining through leaves (Barré-Brisebois & Bouchard's fast translucency approximation): looking against
// the light, a leaf glows with the light it lets through. It takes the direct light's colour, so shadows (the crown's
// own included) dim it like the sunlit side. Materials set `translucencyNode` (vec3, 0 where nothing shines through).
class FoliageLightingModel extends THREE.PhysicalLightingModel {
  direct(lightData, builder) {
    const { lightDirection, lightColor, reflectedLight } = lightData;
    const translucency = builder.material.translucencyNode;
    if (translucency) {
      const scatter = normalize(lightDirection.add(normalView.mul(0.3)));
      const through = pow(clamp(dot(positionViewDirection, scatter.negate()), 0.0, 1.0), 3.0);
      reflectedLight.directDiffuse.addAssign(lightColor.mul(translucency).mul(through));
    }
    super.direct(lightData, builder);
  }
}

class TreeNodeMaterial extends THREE.MeshStandardNodeMaterial {
  static get type() { return 'TreeNodeMaterial'; }
  constructor(parameters) {
    super(parameters);
    this.translucencyNode = null;
  }
  setupLightingModel() { return new FoliageLightingModel(); }
}

const flat = (node, name) => varying(node, name).setInterpolation(THREE.InterpolationSamplingType.FLAT, THREE.InterpolationSamplingMode.EITHER);
const hash21 = (p) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));
const UNDERSIDE = vec3(1.12, 1.14, 0.94);

// A card's own shade and hue from its random number
const cardTint = (rnd) => {
  const b = rnd.mul(0.3).add(0.84);
  const h = fract(rnd.mul(7.31)).sub(0.5);
  return vec3(b.mul(h.mul(0.18).add(1.0)), b, b.mul(h.mul(-0.22).add(1.0)));
};
// A tree's own: no two neighbours the same green
const treeTint = (rnd) => {
  const b = fract(rnd.mul(3.17)).mul(0.26).add(1.02);
  const h = fract(rnd.mul(13.7)).sub(0.5);
  return vec3(b.mul(h.mul(0.16).add(1.0)), b, b.mul(h.mul(-0.2).add(1.0)));
};

/**
 * How hard the wind pushes a tree standing at `origin` right now (about 1 in fair weather, 3 and more in a storm):
 * gusts roll downwind across the city, so a row of trees takes them one after the other.
 */
const windPower = (origin) => {
  const w = treeUniforms.wind;
  const along = dot(origin.xz, w.xy), across = dot(origin.xz, vec2(w.y.negate(), w.x));
  const gust = sin(time.mul(0.42).sub(along.mul(0.035)).add(across.mul(0.011))).mul(0.6)
    .add(sin(time.mul(0.93).sub(along.mul(0.083)).sub(across.mul(0.027)).add(1.7)).mul(0.4)).mul(0.5).add(0.5);
  return w.z.div(3.5).mul(w.w.mul(1.8).mul(gust).add(0.55));
};

// The whole tree: bent like a mast, most at the top, leaning downwind and swaying about that lean at its own pace.
// y: height above the foot (m), h: that height as a share of the tree's
const trunkSway = (y, h, rnd, power) => {
  const w = treeUniforms.wind;
  const dir = vec3(w.x, 0.0, w.y), side = vec3(w.y.negate(), 0.0, w.x);
  const phase = rnd.mul(6.2832);
  const a = sin(time.mul(rnd.mul(0.8).add(1.9)).add(phase));
  const b = sin(time.mul(rnd.mul(0.5).add(1.3)).add(phase.mul(1.7)));
  return dir.mul(a.mul(0.5).add(0.6)).add(side.mul(b.mul(0.35))).mul(power).mul(y.mul(h).mul(0.0048));
};

// Leaf coverage as an alpha for a multisampled pass. Up close the edge of each leaf is drawn sharp at its true place.
// Further away, where one pixel holds many leaves, coverage is kept on average by comparing it with a noise that is
// fixed to the texture: a crown is as full at 300 m as at 3 m, and neither grows nor thins as one walks toward it.
const coverageAlpha = (cover, texels, seed) => {
  const footprint = max(length(dFdx(texels)), length(dFdy(texels)));
  const lod = log2(max(footprint, 1e-4));
  const level = max(floor(lod), 0.0);
  const noiseAt = (l) => hash21(floor(texels.div(exp2(l))).add(seed.mul(61.0)));
  const noise = mix(noiseAt(level), noiseAt(level.add(1.0)), saturate(lod.sub(level)));
  const threshold = mix(float(0.5), noise.mul(0.9).add(0.05), smoothstep(2.0, 4.0, lod));
  return saturate(cover.sub(threshold).div(max(fwidth(cover), 0.002)).add(0.5));
};

// Daylight that reaches leaves through the leaves above them: what makes a crown luminous from underneath. Strongest
// looking up toward the sun through the foliage, least with the sun at one's back (where direct light does the work)
const canopyGlow = (sky) => {
  const sunView = transformDirection(cityUniforms.uSkySunDir, cameraViewMatrix);
  const toward = saturate(dot(positionViewDirection.negate(), sunView));
  return cityUniforms.uSunColor.mul(saturate(cityUniforms.uSkySunDir.y.mul(4.0))).mul(cityUniforms.uNight.oneMinus()).mul(sky)
    .mul(pow(toward, 1.5).mul(0.75).add(0.22));
};

// View-space normal bent by a relief map (x to the texture's right, y to its top), without stored tangents
const reliefNormal = (base, map, amount) => {
  const q0 = dFdx(positionView), q1 = dFdy(positionView);
  const st0 = dFdx(uv()), st1 = dFdy(uv());
  const q1perp = cross(q1, base), q0perp = cross(base, q0);
  const T = q1perp.mul(st0.x).add(q0perp.mul(st1.x));
  const B = q1perp.mul(st0.y).add(q0perp.mul(st1.y));
  const det = max(dot(T, T), dot(B, B));
  const scale = select(det.lessThanEqual(0.0), float(0.0), det.inverseSqrt()).mul(amount);
  // (uv.y runs down the texture, the map's y up it)
  return normalize(base.add(T.mul(map.x.mul(scale))).sub(B.mul(map.y.mul(scale))));
};

// Which of the pixels of a tree a level of detail draws while it hands over to the next: both levels use the same
// pattern, one keeps the pixels the other drops
const handover = (rnd) => fract(interleavedGradientNoise(screenCoordinate.xy).add(rnd.mul(0.73)));

/**
 * The mesh material of one kind of tree at one level of detail.
 * level 0 is drawn up to bands.x, level 1 from there to bands.y.
 */
function createTreeMaterial({ bark, barkNormal, barkTint, level }) {
  const mat = new TreeNodeMaterial({ side: THREE.DoubleSide, alphaToCoverage: true, metalness: 0.0, roughness: 0.8 });
  const iA = attribute('aInstA', 'vec4'), iB = attribute('aInstB', 'vec4');
  const aWind = attribute('aWind', 'vec4'), aShade = attribute('aShade', 'vec4');
  const origin = iA.xyz, rnd = fract(iB.z);
  const lodScale = floor(iB.z).mul(DENSE_LOD_STEP).add(1);
  const cs = cos(iA.w), sn = sin(iA.w);
  const turn = (v) => vec3(v.x.mul(cs).add(v.z.mul(sn)), v.y, v.z.mul(cs).sub(v.x.mul(sn)));
  const bands = treeUniforms.bands;

  // Handover between levels, judged once per tree from the player's camera
  const dist = length(treeUniforms.view.sub(origin.add(vec3(0.0, iB.y.mul(6.0), 0.0)))).mul(lodScale);
  const enter = level === 0 ? float(1.0) : smoothstep(bands.x.sub(bands.z), bands.x, dist);
  const leave = level === 0 ? smoothstep(bands.x.sub(bands.z), bands.x, dist) : smoothstep(bands.y.sub(bands.z), bands.y, dist);
  const vFade = flat(vec2(enter, leave), 'vTreeFade');
  const gone = step(enter, 0.0).add(step(1.0, leave)).min(1.0);

  const local = turn(positionGeometry.mul(vec3(iB.x, iB.y, iB.x)));
  const normalW = normalize(turn(attribute('normal', 'vec3')));

  mat.positionNode = Fn(() => {
    const power = windPower(origin);
    const trunk = trunkSway(local.y, aShade.y, rnd, power);
    // a limb with all it carries: it bobs and swings about where it leaves the trunk, most at its tips
    const limbPhase = aWind.y.mul(6.2832).add(rnd.mul(6.2832));
    const bob = sin(time.mul(aWind.y.mul(2.2).add(3.1)).add(limbPhase));
    const swing = sin(time.mul(aWind.y.mul(1.7).add(2.3)).add(limbPhase.mul(1.3)));
    const w = treeUniforms.wind;
    const limb = vec3(0.0, 1.0, 0.0).mul(bob.mul(0.5)).add(vec3(w.x, 0.0, w.y).mul(swing.mul(0.65).add(0.35)))
      .mul(aWind.x.mul(aWind.x)).mul(power).mul(0.11);
    // a twig's spray rocks on its own, and its far edge flutters
    const twigPhase = aWind.w.mul(6.2832);
    const rock = sin(time.mul(aWind.w.mul(5.0).add(7.0)).add(twigPhase)).mul(0.6)
      .add(sin(time.mul(aWind.w.mul(4.0).add(11.3)).add(twigPhase.mul(2.1))).mul(0.4));
    const flutter = sin(time.mul(23.0).add(twigPhase.mul(3.0)).add(local.x.mul(7.0)).add(local.z.mul(5.0)))
      .mul(aWind.z).mul(aWind.z).mul(0.012).mul(min(power, 2.5));
    const twig = normalW.mul(rock.mul(0.022).mul(aWind.z).mul(pow(power, 0.8)).add(flutter)).add(vec3(0.0, rock.mul(0.012).mul(aWind.z).mul(power), 0.0));
    // a tree this level no longer draws at all folds to a point: nothing to rasterise
    return mix(origin.add(local).add(trunk).add(limb).add(twig), origin, gone);
  })();

  const isLeaf = aShade.w;
  const occlusion = aShade.x;
  const leaf = texture(trees.foliage, uv());
  const relief = texture(trees.foliageRelief, uv());
  const wood = texture(bark, uv());
  const texels = uv().mul(vec2(trees.foliage.image.width, trees.foliage.image.height));
  // A card seen edge on is a smear of its own texture: it bows out as it turns its edge to the eye (the cards across
  // it show their faces then)
  const face = normalize(cross(dFdx(positionView), dFdy(positionView)));
  const edgeOn = smoothstep(0.07, 0.3, abs(dot(face, positionViewDirection)));
  const cover = coverageAlpha(leaf.a.mul(edgeOn), texels, aShade.z);

  const under = select(frontFacing, vec3(1.0), UNDERSIDE);
  const leafColor = leaf.rgb.mul(cardTint(aShade.z)).mul(occlusion.mul(0.5).add(0.5)).mul(under).mul(iB.w);
  const barkColor = wood.rgb.mul(barkTint).mul(occlusion.mul(0.45).add(0.55));
  const tint = treeTint(rnd);
  mat.colorNode = vec4(mix(barkColor, leafColor.mul(tint), isLeaf), mix(float(1.0), cover, isLeaf));

  // Bark shows its outside only; a level draws its share of the pixels during a handover
  const fade = handover(rnd);
  const solid = isLeaf.greaterThan(0.5).or(frontFacing);
  mat.maskNode = solid.and(fade.lessThan(vFade.x)).and(fade.greaterThanEqual(vFade.y));
  // In the sun's passes every level casts whole (no handover pattern): leaves by their coverage against a fixed noise
  const shadowNoise = hash21(floor(texels.div(max(exp2(floor(log2(max(length(dFdx(texels)), 1.0)))), 1.0))).add(aShade.z.mul(61.0)));
  mat.maskShadowNode = solid.and(isLeaf.lessThan(0.5).or(leaf.a.greaterThan(shadowNoise.mul(0.8).add(0.1))));

  mat.roughnessNode = mix(float(0.92), float(0.66), isLeaf);
  const baseNormal = transformDirection(normalW, cameraViewMatrix);
  const leafNormal = reliefNormal(baseNormal, relief.xy.mul(2.0).sub(1.0), 0.8);
  const barkRelief = texture(barkNormal, uv()).xy.mul(2.0).sub(1.0);
  const barkNormalView = reliefNormal(baseNormal, vec2(barkRelief.x, barkRelief.y), 1.1);
  mat.normalNode = mix(barkNormalView, leafNormal, isLeaf);
  const sky = urbanSkyVisibility();
  mat.aoNode = sky.mul(occlusion.mul(0.6).add(0.4));
  // Light through the leaves: yellow-green, where the foliage is thin
  mat.translucencyNode = leafColor.mul(tint).mul(vec3(1.5, 1.7, 0.6)).mul(relief.z).mul(isLeaf);
  // and the glow of a crown from inside: sunlight that came down through the leaves above (no shadow map knows it)
  mat.emissiveNode = leafColor.mul(tint).mul(canopyGlow(sky)).mul(isLeaf);
  return mat;
}

/**
 * The impostor material: one card per tree, turned to whoever looks (the sun, in its shadow passes), showing the
 * frames photographed nearest that side, blended. All kinds of tree share it: aInstB.w says which.
 */
function createImpostorMaterial() {
  const mat = new TreeNodeMaterial({ side: THREE.DoubleSide, alphaToCoverage: true, metalness: 0.0, roughness: 0.78 });
  const iA = attribute('aInstA', 'vec4'), iB = attribute('aInstB', 'vec4');
  const origin = iA.xyz, rnd = fract(iB.z);
  const lodScale = floor(iB.z).mul(DENSE_LOD_STEP).add(1);
  const [aw, ah] = trees.atlas, [cols] = trees.grid;
  const count = trees.types.length;
  // per type: where its frames are in the atlas (x, y, frame width, frame height, all in uv), and its sphere (centre height, radius, tree height)
  const rects = uniformArray(trees.types.map((t) => new THREE.Vector4(t.impostor.x / aw, t.impostor.y / ah, t.impostor.frame / aw, t.impostor.frame / ah)));
  const spheres = uniformArray(trees.types.map((t) => new THREE.Vector4(t.sphere.y, t.impostor.half, t.height, 0)));
  const type = int(clamp(iB.w.add(0.5), 0.0, count - 0.5));
  const rect = rects.element(type), sphere = spheres.element(type);
  const bands = treeUniforms.bands;

  const center = origin.add(vec3(0.0, sphere.x.mul(iB.y), 0.0));
  const toEye = normalize(cameraPosition.sub(center));
  const rightRaw = cross(vec3(0.0, 1.0, 0.0), toEye);
  const right = select(length(rightRaw).lessThan(0.001), vec3(1.0, 0.0, 0.0), normalize(rightRaw));
  const up = cross(toEye, right);

  const dist = length(treeUniforms.view.sub(origin.add(vec3(0.0, iB.y.mul(6.0), 0.0))));
  const enter = smoothstep(bands.y.sub(bands.z), bands.y, dist.mul(lodScale));
  const leave = smoothstep(bands.w.sub(60.0), bands.w, dist);
  const vFade = flat(vec2(enter, leave), 'vImpostorFade');
  const gone = step(enter, 0.0).add(step(1.0, leave)).min(1.0);

  const corner = positionGeometry; // x, y in -1..1
  mat.positionNode = Fn(() => {
    // as tall as the tree was scaled when seen from the side, as wide as it was scaled across
    const tall = mix(iB.y, iB.x, abs(toEye.y));
    const world = center.add(right.mul(corner.x.mul(sphere.y).mul(iB.x))).add(up.mul(corner.y.mul(sphere.y).mul(tall)));
    const y = max(world.y.sub(origin.y), 0.0);
    const sway = trunkSway(y, saturate(y.div(sphere.z.mul(iB.y))), rnd, windPower(origin));
    return mix(world.add(sway), origin, gone);
  })();

  // Which frames: the tree's own bearing and elevation of the eye, between the rings of photographs
  const cs = cos(iA.w), sn = sin(iA.w);
  const lx = toEye.x.mul(cs).sub(toEye.z.mul(sn)), lz = toEye.x.mul(sn).add(toEye.z.mul(cs));
  const bearing = fract(atan(lz, lx).div(6.2832).add(1.0));
  const elevation = asin(clamp(toEye.y, -1.0, 1.0));
  const R = trees.rings;
  const starts = R.map((_, k) => R.slice(0, k).reduce((s, ring) => s + ring.n, 0));
  const pick = (values, shift = 0) => {
    // the value of the ring the eye is above, or of the next one up (`shift` 1)
    let node = float(values[Math.min(R.length - 1, shift)]);
    for (let k = 1; k < R.length - shift; k++) node = select(elevation.greaterThan(R[k].el), float(values[Math.min(R.length - 1, k + shift)]), node);
    return node;
  };
  const lowEl = pick(R.map((r) => r.el)), highEl = pick(R.map((r) => r.el), 1);
  const rise = saturate(elevation.sub(lowEl).div(max(highEl.sub(lowEl), 0.001)));
  const slots = (shift) => {
    const n = pick(R.map((r) => r.n), shift), start = pick(starts, shift);
    const f = bearing.mul(n), i0 = floor(f);
    return { a: start.add(i0.sub(floor(i0.div(n)).mul(n))), b: start.add(i0.add(1.0).sub(floor(i0.add(1.0).div(n)).mul(n))), w: fract(f) };
  };
  const low = slots(0), high = slots(1);
  const vSlots = flat(vec4(low.a, low.b, high.a, high.b), 'vImpostorSlots');
  const vBlend = flat(vec3(low.w, high.w, rise), 'vImpostorBlend');
  const vRight = flat(right, 'vImpostorRight'), vUp = flat(up, 'vImpostorUp'), vEye = flat(toEye, 'vImpostorEye');
  const vRect = flat(rect, 'vImpostorRect');
  const vTint = flat(treeTint(rnd), 'vImpostorTint');
  const vRnd = flat(rnd, 'vImpostorRnd');
  const quad = varying(vec2(corner.x.mul(0.5).add(0.5), corner.y.mul(-0.5).add(0.5)), 'vImpostorQuad');

  const frameUV = (slot) => vRect.xy.add(vec2(slot.sub(floor(slot.div(cols)).mul(cols)), floor(slot.div(cols))).add(quad).mul(vRect.zw));
  const w0 = vBlend.z.oneMinus().mul(vBlend.x.oneMinus()), w1 = vBlend.z.oneMinus().mul(vBlend.x);
  const w2 = vBlend.z.mul(vBlend.y.oneMinus()), w3 = vBlend.z.mul(vBlend.y);
  const sampleAll = (map) => texture(map, frameUV(vSlots.x)).mul(w0).add(texture(map, frameUV(vSlots.y)).mul(w1))
    .add(texture(map, frameUV(vSlots.z)).mul(w2)).add(texture(map, frameUV(vSlots.w)).mul(w3));
  const shot = sampleAll(trees.impostors);
  const aux = sampleAll(trees.impostorRelief);

  const texels = quad.mul(vRect.zw).mul(vec2(aw, ah));
  const cover = coverageAlpha(shot.a, texels, vRnd);
  // colours were stored under their coverage: blending frames keeps them right where one frame is clear
  // A photograph has no shadow map inside it: where the crown hides the sky from its own leaves it hides the sun
  // too, so the picture is darkened there as the model's own shadows darken it
  const raw = shot.rgb.div(max(shot.a, 0.02)).mul(aux.z.mul(0.72).add(0.24));
  // leaves are the green of the picture: they take the tree's tint and pass the sun, wood does neither
  const leafy = saturate(raw.g.sub(max(raw.r, raw.b)).mul(14.0));
  const albedo = raw.mul(mix(vec3(1.0), vTint, leafy));
  mat.colorNode = vec4(albedo, cover);

  const fade = handover(vRnd);
  mat.maskNode = fade.lessThan(vFade.x).and(fade.greaterThanEqual(vFade.y));
  mat.maskShadowNode = shot.a.greaterThan(hash21(floor(texels)).mul(0.6).add(0.2));

  const n = aux.xy.mul(2.0).sub(1.0);
  const nz = sqrt(max(float(1.0).sub(dot(n, n)), 0.04));
  mat.normalNode = transformDirection(normalize(vRight.mul(n.x).add(vUp.mul(n.y)).add(vEye.mul(nz))), cameraViewMatrix);
  const sky = urbanSkyVisibility();
  mat.aoNode = sky.mul(aux.z.mul(0.6).add(0.4));
  mat.translucencyNode = albedo.mul(vec3(1.5, 1.7, 0.6)).mul(leafy).mul(0.45);
  mat.emissiveNode = albedo.mul(canopyGlow(sky)).mul(leafy);
  // The card stands in the middle of the tree, behind the half of its own shadow that faces the sun: shadows are
  // looked up from the sunny side of the crown instead, where only what is not this tree can shade it
  mat.receivedShadowPositionNode = positionWorld.add(cityUniforms.uSkySunDir.mul(flat(sphere.y.mul(iB.x).mul(1.15), 'vImpostorLift')));
  return mat;
}

export { treeUniforms, createTreeMaterial, createImpostorMaterial };
