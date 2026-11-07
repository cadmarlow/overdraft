import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  uniform,
  float,
  vec2,
  vec3,
  vec4,
  dot,
  mix,
  min,
  max,
  pow,
  smoothstep,
  length,
  select,
  clamp,
  luminance,
  isBackgroundDepth,
  rtt,
  screenUV,
  screenSize
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

// Scene-linear color grading and lens bloom, composed in the existing final render pass.

// Exposure and white balance belong to the camera, independently of the physical lighting presets.
// The look is photographic: a firm contrast curve round middle grey, cool shade against warm sun, bloom kept for what
// really glares (lamps, the sun on glass and chrome). The eye (atmosphere.js) multiplies the exposure on top of these:
// in a building's shadow the camera opens up and the sunlit street beyond it burns a little, in the open it closes.
const LOOKS = {
  golden:   { exposure: 1.00, contrast: 1.28, saturation: 1.15, balance: [1.065, 1.00, 0.935], bloom: 0.27, threshold: 1.12 },
  midday:   { exposure: 0.97, contrast: 1.26, saturation: 1.12, balance: [1.025, 1.00, 0.975], bloom: 0.20, threshold: 1.30 },
  twilight: { exposure: 1.08, contrast: 1.18, saturation: 1.10, balance: [1.02, 0.99, 1.035], bloom: 0.31, threshold: 0.98 },
  midnight: { exposure: 1.14, contrast: 1.10, saturation: 1.06, balance: [0.975, 1.00, 1.045], bloom: 0.33, threshold: 0.92 }
};

// Streaks towards the edges of the frame at speed, off the image itself; sceneTexture samples the rendered scene
const SPEED_TAPS = 6;
const SHAFT_TAPS = 28; // the sun's rays: samples along the line to the sun, at quarter resolution
const _sunV = new THREE.Vector3();

/**
 * @param {THREE.WebGPURenderer} renderer
 * @param {Node} sceneColor - the scene pass output
 * @param {Node} reflections - screen-space reflections to add (vec3(0) without)
 * @param {?TextureNode} sceneTexture - the same scene as a texture to resample (speed blur, lens fringe, sun shafts)
 * @param {?Node} aoNode - ambient occlusion (float, 1 = open) to darken the image with, or null
 * @param {?TextureNode} depthTexture - the scene pass depth: the sky (background) is where the sun's rays come from
 */
function createPostProcessing(renderer, sceneColor, reflections, sceneTexture = null, aoNode = null, depthTexture = null) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Exposure is applied before bloom so its threshold follows the image's exposed brightness.
  // RenderPipeline performs ACES and the output color-space conversion exactly once, after this graph.
  renderer.toneMappingExposure = 1.0;

  const exposure = uniform(1.0);
  const eye = uniform(1.0); // adaptation: the camera opening up in the shade (atmosphere.js)
  const contrast = uniform(1.0);
  const saturation = uniform(1.0);
  const balance = uniform(new THREE.Vector3(1, 1, 1));
  const speedBlur = uniform(0);
  const fringe = uniform(0.0022); // lateral chromatic aberration at the frame's edges, in screen widths at the corner
  const aoStrength = uniform(0.92);
  const vignetteAmount = uniform(0.17);
  const sharpness = uniform(0.42); // unsharp mask, clamped to the neighbourhood so it never rings
  // The sun's rays: where the sun is on screen (0..1, y up), and how much of its rays show (in frame, by day, clear)
  const sunUV = uniform(new THREE.Vector2(0.5, 0.5));
  const sunShafts = uniform(0);
  const shaftTint = uniform(new THREE.Color(1.0, 0.84, 0.62));

  const blurred = Fn(() => {
    if (!sceneTexture) return sceneColor;
    const out = vec4(sceneColor.rgb, 1).toVar();
    const uvs = screenUV.toVar();
    const from = uvs.sub(0.5);
    const r2 = dot(from, from);
    If(speedBlur.greaterThan(0.01), () => {
      const reach = r2.mul(speedBlur).mul(0.24);
      const sum = sceneColor.rgb.toVar();
      for (let i = 1; i < SPEED_TAPS; i++) sum.addAssign(sceneTexture.sample(uvs.sub(from.mul(reach.mul(i / (SPEED_TAPS - 1))))).rgb);
      out.rgb.assign(sum.div(SPEED_TAPS));
    }).Else(() => {
      // A lens pulls red and blue slightly apart towards the corners
      const shift = from.mul(fringe.mul(r2).mul(2.0));
      out.r.assign(sceneTexture.sample(uvs.add(shift)).r);
      out.b.assign(sceneTexture.sample(uvs.sub(shift)).b);
    });
    return out;
  })();

  // Crepuscular rays: the bright sky round the sun, with the buildings cut out of it (depth says what is sky), smeared
  // towards the sun at a quarter of the resolution. Down an avenue at the end of the day the light comes through the
  // gaps between the towers in beams.
  let rays = null;
  if (sceneTexture && depthTexture) {
    const aspect = screenSize.x.div(screenSize.y);
    const skyLight = Fn(() => {
      const uvs = screenUV;
      const sky = select(isBackgroundDepth(depthTexture.sample(uvs).r), float(1), float(0));
      const c = sceneTexture.sample(uvs).rgb;
      const near = smoothstep(0.62, 0.05, length(uvs.sub(sunUV).mul(vec2(aspect, 1))));
      return vec4(c.mul(sky).mul(near).mul(smoothstep(0.5, 1.6, luminance(c))), 1);
    })();
    const lightMap = rtt(skyLight, null, null, { resolutionScale: 0.25 });
    const smear = Fn(() => {
      const uvs = screenUV.toVar();
      const step = uvs.sub(sunUV).mul(0.92 / SHAFT_TAPS);
      const sum = vec3(0).toVar();
      const w = float(1).toVar();
      for (let i = 0; i < SHAFT_TAPS; i++) {
        uvs.subAssign(step);
        sum.addAssign(lightMap.sample(uvs).rgb.mul(w));
        w.mulAssign(0.94);
      }
      return vec4(sum.mul(2.4 / SHAFT_TAPS), 1);
    })();
    rays = rtt(smear, null, null, { resolutionScale: 0.25 });
  }

  const occlusion = aoNode ? mix(float(1), aoNode.r, aoStrength) : float(1);
  const base = blurred.rgb.mul(occlusion).add(reflections.rgb);
  const lit = rays ? base.add(rays.sample(screenUV).rgb.mul(shaftTint).mul(sunShafts)) : base;
  const exposed = max(lit, vec3(0)).mul(exposure.mul(eye)).mul(balance);

  // Limit only bloom's peak radiance, scaling RGB together to retain neon and lamp colors.
  // The original HDR image keeps its full range for the tone mapper's highlight shoulder.
  const peak = max(max(exposed.r, exposed.g), exposed.b);
  const bloomInput = vec4(exposed.mul(float(8.0).div(max(peak, 8.0))), 1.0);
  const bloomPass = bloom(bloomInput, 0.24, 0.40, 1.20);
  bloomPass.smoothWidth.value = 0.30;
  bloomPass.setResolutionScale(0.5);

  const graded = Fn(() => {
    const color = exposed.add(bloomPass.rgb).toVar();
    const luma = dot(color, vec3(0.2126, 0.7152, 0.0722)).toVar();

    // Cool shadow / warm highlight separation; multiply rather than lifting the black level.
    const shadows = mix(vec3(0.955, 0.985, 1.055), vec3(1), smoothstep(0.02, 0.55, luma));
    const highlights = mix(vec3(1), vec3(1.05, 1.005, 0.95), smoothstep(0.55, 3.0, luma));
    color.mulAssign(shadows.mul(highlights));

    // Contrast pivots around middle gray and scales RGB together, avoiding per-channel gamma shifts.
    color.mulAssign(pow(max(luma, 0.0001).div(0.18), contrast.sub(1.0)));
    const gray = dot(color, vec3(0.2126, 0.7152, 0.0722));
    const chroma = max(max(color.r, color.g), color.b).sub(min(min(color.r, color.g), color.b));
    const vibrance = float(0.12).mul(float(1).sub(chroma.div(max(max(max(color.r, color.g), color.b), 0.0001))));
    color.assign(max(mix(vec3(gray), color, saturation.add(vibrance)), vec3(0)));

    // Normalize by the corner radius so the lens falloff remains subtle in portrait and landscape.
    const aspect = screenSize.x.div(screenSize.y);
    const radius = length(screenUV.sub(0.5).mul(vec2(aspect, 1))).div(length(vec2(aspect, 1).mul(0.5)));
    const vignette = float(1).sub(smoothstep(0.32, 1.02, radius).mul(vignetteAmount));
    return vec4(color.mul(vignette), 1.0);
  })();

  // The graded frame once more as a texture, so the last step can look at each pixel's neighbours: a little acutance
  // gives back what the render scale and the multisampling soften (edges of windows, lettering, the far street)
  const gradedTexture = rtt(graded);
  const outputNode = Fn(() => {
    const px = vec2(1).div(screenSize);
    const c = gradedTexture.sample(screenUV).rgb;
    const n = gradedTexture.sample(screenUV.add(vec2(0, px.y))).rgb;
    const s = gradedTexture.sample(screenUV.sub(vec2(0, px.y))).rgb;
    const e = gradedTexture.sample(screenUV.add(vec2(px.x, 0))).rgb;
    const w = gradedTexture.sample(screenUV.sub(vec2(px.x, 0))).rgb;
    const lo = min(min(min(n, s), min(e, w)), c);
    const hi = max(max(max(n, s), max(e, w)), c);
    const blurredLocal = n.add(s).add(e).add(w).mul(0.25);
    return vec4(clamp(c.add(c.sub(blurredLocal).mul(sharpness)), lo, hi), 1.0);
  })();

  function applyPreset(id) {
    applyLook(LOOKS[id] || LOOKS.golden);
  }

  // A look given directly (atmosphere.js blends them through the day)
  function applyLook(look) {
    exposure.value = look.exposure;
    contrast.value = look.contrast;
    saturation.value = look.saturation;
    balance.value.set(...look.balance);
    bloomPass.strength.value = look.bloom;
    bloomPass.threshold.value = look.threshold;
  }

  /**
   * Where the sun is in the frame, for its rays. `strength` (0..1) is how much the day lets them show (clear sky, sun
   * up); they fade as the sun leaves the frame and vanish once it is behind the camera.
   */
  function setSun(sunDir, camera, strength) {
    camera.updateMatrixWorld();
    _sunV.copy(sunDir).multiplyScalar(5000).add(camera.position).project(camera);
    const behind = _sunV.z > 1 || _sunV.z < -1;
    const inFrame = behind ? 0 : Math.max(0, 1 - Math.max(0, (Math.hypot(_sunV.x * 0.7, _sunV.y) - 0.9) / 0.9));
    sunUV.value.set(_sunV.x * 0.5 + 0.5, _sunV.y * 0.5 + 0.5);
    sunShafts.value = strength * inFrame;
  }

  applyPreset('golden');
  return { outputNode, applyPreset, applyLook, setSun, speedBlur, eye, aoStrength, fringe, vignetteAmount, sharpness, sunShafts, shaftTint };
}

export { createPostProcessing, LOOKS as GRADE_LOOKS };
