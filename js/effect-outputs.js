import { mrt, vec4 } from 'three/tsl';

// With reflections on (quality.js: HAUTE), the scene pass also writes each pixel's normal and metalness/roughness for
// the screen-space reflections and the ambient occlusion (main.js sceneMRT). A see-through material blends those like
// its colour, but with an alpha of 1: smoke, a muzzle flash, rain, a mission beacon then stamp the whole of their quad
// into the normals, and the ambient occlusion darkens that square. Every puff of smoke became a black box.
//
// An effect is not a surface. Its material carries this MRT, which leaves the normals and the metalness/roughness of
// whatever is behind it as they were: `sealEffect` for one material where it is made, `sealEffects` for whatever is
// already in the scene.

const EFFECT_MRT = mrt({
  normal: vec4(0.0, 0.0, 0.0, 0.0),
  metalRough: vec4(0.0, 0.0, 0.0, 0.0)
});
let enabled = true;

/** No reflection outputs at this quality level: effects have nothing to keep out of (main.js, before anything is built) */
function disableEffectOutputs() { enabled = false; }

/** The MRT of a see-through effect, or null when there are no reflection outputs */
function transparentEffectMRT() { return enabled ? EFFECT_MRT : null; }

/** Marks `material` as an effect: it draws its colour and nothing else. Returns it. */
function sealEffect(material) {
  if (enabled && material && material.isNodeMaterial && !material.mrtNode) material.mrtNode = EFFECT_MRT;
  return material;
}

// Unlit and see-through: light, smoke, a line in the air. (A lit see-through material is glass, which does reflect.)
const isEffect = (m) => m && m.isNodeMaterial && m.transparent && !m.isMeshStandardNodeMaterial && !m.mrtNode;

function sealObject(o, sealed) {
  const material = o.material;
  if (!material) return;
  for (const m of Array.isArray(material) ? material : [material]) {
    if (!isEffect(m)) continue;
    m.mrtNode = EFFECT_MRT;
    m.needsUpdate = true;
    sealed.push(o.name || m.name || m.type);
  }
}

/**
 * Seals every effect material under `root` that was made without `sealEffect`.
 * @returns {string[]} what it had to seal (the object's name or its material's type), for the caller to report
 */
function sealEffects(root) {
  const sealed = [];
  if (enabled) root.traverse((o) => sealObject(o, sealed));
  return sealed;
}

/**
 * The same sweep spread over the frames of a running game, for what is made after loading (a mission's beacon): a
 * city of 40,000 objects takes milliseconds to walk at once, so each call looks at `perStep` of them and the walk
 * starts again when it ends. Call it once a frame.
 * @returns {() => string[]} step: what this step had to seal, nearly always nothing (the same array every call)
 */
function effectSweeper(root, perStep = 400) {
  const stack = [];
  const sealed = [];
  return () => {
    sealed.length = 0;
    if (!enabled) return sealed;
    if (!stack.length) stack.push(root);
    for (let n = 0; n < perStep && stack.length; n++) {
      const o = stack.pop();
      sealObject(o, sealed);
      const children = o.children;
      for (let i = 0; i < children.length; i++) stack.push(children[i]);
    }
    return sealed;
  };
}

export { disableEffectOutputs, transparentEffectMRT, sealEffect, sealEffects, effectSweeper };
