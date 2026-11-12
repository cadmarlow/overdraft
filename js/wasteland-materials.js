import * as THREE from 'three/webgpu';
import {
  Fn, Loop, float, vec2, vec3, attribute, positionWorld, cameraPosition, cameraViewMatrix, normalWorldGeometry,
  abs, max, min, clamp, mix, smoothstep, dot, length, normalize, sin, texture, transformDirection, uniform
} from 'three/tsl';
import { bumpNormal, cityUniforms } from './tsl-materials.js';
import { applyFrontierGround } from './frontier-ground.js';
import { ground } from './ground-assets.js';
import { MASK_H, MASK_STEP, MASK_W, SALT_MIN_X, SALT_MIN_Z } from './wasteland-design.js';

// The Wasteland's surfaces. One ground material for the whole country: photographed sand, cracked mud and rock
// (tools/wasteland, Poly Haven, CC0) laid by the baked masks, by slope and by the old water lines.

// Art direction, in linear albedo: ochre sand, red rock, pale salt
const TINT = {
  sand: [0.30, 0.15, 0.055], dune: [0.42, 0.225, 0.085], mud: [0.215, 0.115, 0.05], salt: [0.44, 0.39, 0.31],
  rockDark: [0.11, 0.04, 0.02], rockRed: [0.30, 0.095, 0.035], rockPale: [0.40, 0.23, 0.11], asphalt: [0.05, 0.047, 0.043]
};
// Each tint is a uniform, so that the palette can be tuned in the running game (window.__render.wasteland.tints)
export const saltTints = Object.fromEntries(Object.entries(TINT).map(([name, rgb]) => [name, uniform(new THREE.Vector3(...rgb))]));
const v3 = a => { for (const [name, rgb] of Object.entries(TINT)) if (rgb === a) return saltTints[name]; return vec3(a[0], a[1], a[2]); };

export const saltUniforms = {
  uWind: uniform(new THREE.Vector2(0.94, 0.34)), // where the sand blows to
  uGust: uniform(0), // 0 calm .. 1 storm: how much sand is in the air just above the ground
  uTime: uniform(0),
  uFarShadow: uniform(1),
  // How much of the sky the ground takes. Seen at a grazing angle, flat ground mirrors the sky: at full strength that
  // sheen washed the sand pale to the horizon and lit the shade as bright as the sun. Dry sand has none of it.
  uAmbient: uniform(0.25),
  // The same for what stands on the ground (walls, slabs, hulls): the fill light of an open sky
  uFill: uniform(0.6)
};

// Texel centres of the baked maps lie on their vertices
const maskUV = (p) => p.xz.sub(vec2(SALT_MIN_X - MASK_STEP / 2, SALT_MIN_Z - MASK_STEP / 2)).div(vec2(MASK_W * MASK_STEP, MASK_H * MASK_STEP));
const spanUV = (p, w, h, step) => p.xz.sub(vec2(SALT_MIN_X - step / 2, SALT_MIN_Z - step / 2)).div(vec2(w * step, h * step));
// A photographed surface relative to its own mean, so that the tint is ours and the grain is the photograph's
const grain = (surface, uvNode) => {
  const t = texture(surface.color, uvNode);
  return { rel: clamp(t.rgb.div(vec3(...surface.mean)), 0.3, 1.75), height: t.a };
};
// An OpenGL normal map laid flat on the ground: red is +x, green is up the image, which is -z
const flatDetail = (surface, uvNode) => {
  const t = texture(surface.normal, uvNode);
  return { tilt: vec3(t.r.mul(2).sub(1), 0, t.g.mul(2).sub(1).negate()), rough: t.a };
};

export function createSaltGroundMaterial(surfaces, maps, { frontier = false } = {}) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  mat.name = frontier ? 'Wasteland · sol des Lisières' : 'Wasteland · sol';
  mat.aoNode = saltUniforms.uAmbient;
  const p = positionWorld, n = normalWorldGeometry;
  const masks = texture(maps.masks, maskUV(p));
  const lines = texture(maps.lines, spanUV(p, maps.lineW, maps.lineH, maps.lineStep)); // R road or track, G asphalt
  const far = smoothstep(90, 420, length(p.sub(cameraPosition)));
  const slope = float(1).sub(n.y);

  // Tone that no tile can hold: an aerial photograph at two scales
  const m = surfaces.macro;
  m.color.wrapS = m.color.wrapT = THREE.MirroredRepeatWrapping; // an aerial photograph has edges: mirrored, they vanish
  const broad = texture(m.color, p.xz.div(2300)).rgb.div(vec3(...m.mean));
  const mid = texture(m.color, p.xz.div(310).add(vec2(0.37, 0.11))).rgb.div(vec3(...m.mean));
  const tone = clamp(mix(vec3(1), broad.mul(mid), 0.55), 0.55, 1.5);
  const lum = dot(mid, vec3(0.3333));

  const sandUV = p.xz.div(surfaces.sand.metres), duneUV = p.xz.div(surfaces.dune.metres), mudUV = p.xz.div(surfaces.crack.metres * 1.5);
  const sand = grain(surfaces.sand, sandUV), dune = grain(surfaces.dune, duneUV), mud = grain(surfaces.crack, mudUV);

  // What lies where: sand drifts sit in the hollows of the stony ground, mud shows where the sand is thin
  const wDune = smoothstep(0.34, 0.62, masks.r.add(dune.height.sub(sand.height).mul(0.22)).add(lum.sub(1).mul(0.12)));
  const wMud = smoothstep(0.30, 0.62, masks.g.add(float(0.55).sub(sand.height).mul(0.25))).mul(wDune.oneMinus());
  const wSalt = smoothstep(0.22, 0.66, masks.b.add(mud.height.mul(0.2)).sub(0.1));
  // Rock: every steep face, and the bare caps the mask marks
  const wFace = smoothstep(0.24, 0.46, slope.add(masks.a.mul(0.08)));
  const wCap = smoothstep(0.42, 0.8, masks.a).mul(wFace.oneMinus()).mul(0.7);

  // Cliffs are painted from the side: the strata run level, and each bed has its own red
  const cliffScale = surfaces.cliff.metres * 3.2;
  const sideX = grain(surfaces.cliff, vec2(p.z, p.y.negate()).div(cliffScale));
  const sideZ = grain(surfaces.cliff, vec2(p.x, p.y.negate()).div(cliffScale));
  const wx = smoothstep(0.25, 0.75, abs(n.x).div(abs(n.x).add(abs(n.z)).add(0.001)));
  const face = { rel: mix(sideZ.rel, sideX.rel, wx), height: mix(sideZ.height, sideX.height, wx) };
  const bed = p.y.mul(0.052).add(lum.mul(1.6)).add(sin(p.x.mul(0.0031).add(p.z.mul(0.0023))).mul(0.9));
  const strata = sin(bed.mul(2.0)).mul(0.5).add(0.5), strata2 = sin(bed.mul(5.3).add(1.7)).mul(0.5).add(0.5);
  const rockTint = mix(mix(v3(TINT.rockDark), v3(TINT.rockRed), strata), v3(TINT.rockPale), smoothstep(0.62, 0.9, strata2).mul(0.75));

  let albedo = sand.rel.mul(v3(TINT.sand));
  albedo = mix(albedo, dune.rel.mul(v3(TINT.dune)), wDune);
  albedo = mix(albedo, mud.rel.mul(v3(TINT.mud)), wMud);
  albedo = mix(albedo, mix(mud.rel, vec3(1), 0.45).mul(v3(TINT.salt)), wSalt);
  albedo = mix(albedo, sand.rel.mul(v3(TINT.rockRed)).mul(0.9), wCap);
  albedo = mix(albedo, face.rel.mul(rockTint), wFace);
  albedo = albedo.mul(tone);
  // Old asphalt and beaten tracks, read from afar (the road ribbons lie over this close up)
  const paved = smoothstep(0.5, 0.72, lines.r.mul(lines.g.mul(0.5).add(0.5))).mul(lines.g);
  const beaten = smoothstep(0.35, 0.8, lines.r).mul(lines.g.oneMinus());
  albedo = mix(albedo, v3(TINT.asphalt).mul(sand.rel.g.mul(0.5).add(0.6)), paved.mul(wDune.mul(0.55).oneMinus()));
  albedo = albedo.mul(mix(float(1), float(0.74), beaten));
  // Sand on the move: pale streaks that run with the wind, an arm's length above the ground
  const windAxis = normalize(saltUniforms.uWind);
  const alongWind = dot(p.xz, windAxis), acrossWind = dot(p.xz, vec2(windAxis.y.negate(), windAxis.x));
  const streak = texture(ground.masksA, vec2(alongWind.div(96).sub(saltUniforms.uTime.mul(0.11)), acrossWind.div(17))).a;
  const sheet = smoothstep(0.55, 0.95, streak).mul(saltUniforms.uGust).mul(wFace.oneMinus()).mul(far.oneMinus().mul(0.75).add(0.25));
  albedo = mix(albedo, v3(TINT.dune).mul(1.15), sheet.mul(0.55));
  mat.colorNode = albedo;

  // The terrain shares one detail normal across its three photographed surfaces.
  const sandN = flatDetail(surfaces.sand, sandUV), duneN = flatDetail(surfaces.sand, duneUV), mudN = flatDetail(surfaces.sand, mudUV);
  mat.roughnessNode = Fn(() => {
    let r = mix(sandN.rough, duneN.rough, wDune);
    r = mix(r, mudN.rough, wMud);
    r = mix(r, mudN.rough.mul(0.62), wSalt); // a crust glints
    r = mix(r, float(0.9), max(wFace, wCap));
    return clamp(mix(r, float(0.9), far.mul(0.7)), 0.22, 1);
  })();
  mat.normalNode = Fn(() => {
    let tilt = mix(sandN.tilt.mul(0.9), duneN.tilt.mul(1.25), wDune);
    tilt = mix(tilt, mudN.tilt.mul(1.1), max(wMud, wSalt));
    tilt = tilt.mul(max(wFace, sheet).oneMinus()).mul(far.mul(0.8).oneMinus());
    const flat = transformDirection(normalize(n.add(tilt)), cameraViewMatrix);
    // rock faces take their relief from the photograph's height
    return normalize(mix(flat, bumpNormal(face.height.mul(0.55)), wFace.mul(far.mul(0.85).oneMinus())));
  })();

  // The relief casts its own long shadows: march the baked heights toward the sun
  if (maps.heights) {
    const reliefShadow = Fn(() => {
      const sun = cityUniforms.uSkySunDir;
      const shade = float(1).toVar();
      const reach = float(22).toVar();
      Loop(9, () => {
        const at = p.add(sun.mul(reach));
        const top = texture(maps.heights, spanUV(at, maps.heightW, maps.heightH, maps.heightStep)).r;
        shade.assign(min(shade, clamp(float(1).sub(top.sub(at.y).sub(1.5).mul(7).div(reach)), 0, 1)));
        reach.mulAssign(1.62);
      });
      return mix(float(1), shade, saltUniforms.uFarShadow.mul(smoothstep(0.0, 0.07, sun.y)));
    });
    mat.receivedShadowNode = Fn(([shadow]) => shadow.mul(reliefShadow()));
  }
  return frontier ? applyFrontierGround(mat, p) : mat;
}

// The old shore roads: cracked asphalt, sand over the edges and in tongues across it, a centre line worn to ghosts
export function createSaltRoadMaterial(surfaces) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  mat.name = 'Wasteland · bitume';
  mat.aoNode = saltUniforms.uAmbient;
  mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -4;
  const road = attribute('roadCoord', 'vec3'); // across -1..1, metres along, sand cover 0..1
  const p = positionWorld.xz;
  const paving = texture(ground.asphalt.color, p.div(ground.asphalt.metres));
  const pavingN = texture(ground.asphalt.normal, p.div(ground.asphalt.metres));
  const wear = texture(ground.masksA, p.div(23)), chips = texture(ground.masksB, p.div(7.5));
  const tone = clamp(paving.g.div(ground.asphalt.mean[1]), 0.4, 1.8);
  let asphalt = v3(TINT.asphalt).mul(1.25).mul(tone).mul(wear.r.mul(0.5).add(0.72));
  // cracks let the ground show through
  asphalt = mix(asphalt, v3(TINT.sand).mul(0.55), smoothstep(0.45, 0.8, chips.a).mul(0.7));
  const dash = smoothstep(0.5, 0.56, sin(road.y.mul(0.262)).mul(0.5).add(0.5));
  const paint = float(1).sub(smoothstep(0.014, 0.03, abs(road.x))).mul(dash).mul(smoothstep(0.35, 0.7, wear.r)).mul(0.8);
  asphalt = mix(asphalt, vec3(0.46, 0.34, 0.11), paint);
  const duneUV = p.div(surfaces.dune.metres);
  const dune = grain(surfaces.dune, duneUV);
  const drift = texture(surfaces.macro.color, p.div(140)).g.div(surfaces.macro.mean[1]);
  const cover = smoothstep(0.62, 0.9, abs(road.x).mul(0.5).add(drift.mul(0.36)).add(road.z.mul(0.12)).add(dune.height.mul(0.12)).sub(paving.a.mul(0.1)));
  mat.colorNode = mix(asphalt, dune.rel.mul(v3(TINT.dune)), cover);
  mat.roughnessNode = mix(pavingN.a, float(0.9), cover);
  const duneN = flatDetail(surfaces.dune, duneUV);
  const tilt = mix(vec3(pavingN.r.mul(2).sub(1), 0, pavingN.g.mul(2).sub(1).negate()).mul(0.8), duneN.tilt, cover);
  mat.normalNode = transformDirection(normalize(normalWorldGeometry.add(tilt)), cameraViewMatrix);
  return applyFrontierGround(mat, positionWorld);
}
