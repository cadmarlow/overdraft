import * as THREE from 'three/webgpu';
import { BRDF_Lambert, cameraViewMatrix, diffuseContribution, dot, float, mix, normalView, smoothstep, uniform, vec4 } from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';

// People lit like the street round them. At night a street is lit in pools, by lamps and headlights, and a surface that
// faces none of them gets next to nothing from the dark sky: someone with a lamp or a car behind them became a flat
// black cut-out in the middle of a bright pavement (ticket #0003). The city fills them in two ways:
//  - each lamp or headlight that reaches a person also lights the pavement, walls and cars round them, which light them
//    back: a share of that light on every side, the most on what faces the ground;
//  - after dark, the glow of shop windows, signs and lit storeys: a floor nobody falls under, warm from the street, cool
//    from the sky.
// Uniforms, so the look can be tuned live (`import('/js/person-lighting.js')` under ?qa=1).

const PERSON_LIGHT = {
  // share of a nearby lamp's light (at the person) that comes back from the street round them, onto a surface facing it
  bounce: uniform(0.17),
  // what a surface facing the sky gets of that bounce, against 1 for one facing the pavement
  bounceUp: uniform(0.35),
  // linear irradiance of the city at full night, from the street (shops, pavements) and from the sky: a back to a lamp
  // reads as cloth and skin, still well darker than the lit pavement beside it
  street: uniform(new THREE.Color(0.37, 0.3, 0.23)),
  sky: uniform(new THREE.Color(0.13, 0.16, 0.23)),
  // the floor comes up between dusk and night (nightFactor: 0.28 at dusk, 0.86 at midnight)
  nightFrom: 0.15,
  nightTo: 0.8
};

// Lamps, headlights and shop lights, clustered or shading on their own; never the sun or the moon, whose bounce the
// hemisphere light already carries
const isLocalLight = (node) => node?.isClusteredLightsNode === true || node?.light?.isPointLight === true || node?.light?.isSpotLight === true;

// 1 for a surface facing the pavement, 1/2 for one standing upright, 0 for one facing the sky
const facingDown = () => dot(normalView, cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz).oneMinus().mul(0.5);

class PersonLightingModel extends THREE.PhysicalLightingModel {
  direct(input, builder) {
    super.direct(input, builder);
    const { lightNode, lightColor, reflectedLight } = input;
    if (!isLocalLight(lightNode)) return;
    // the direct sum: the clustered lights loop declares it before its loop, a new variable would live inside it
    const share = PERSON_LIGHT.bounce.mul(mix(PERSON_LIGHT.bounceUp, float(1), facingDown()));
    reflectedLight.directDiffuse.addAssign(lightColor.mul(share).mul(BRDF_Lambert({ diffuseColor: diffuseContribution })));
  }

  indirect(builder) {
    super.indirect(builder);
    const night = smoothstep(PERSON_LIGHT.nightFrom, PERSON_LIGHT.nightTo, cityUniforms.uNight);
    const glow = mix(PERSON_LIGHT.sky, PERSON_LIGHT.street, facingDown()).mul(night);
    builder.context.reflectedLight.indirectDiffuse.addAssign(glow.mul(BRDF_Lambert({ diffuseColor: diffuseContribution })));
  }
}

/** Lights a body, its hair or what it carries as a person in the street: the material's own model, plus the city's fill */
function lightAsPerson(material) {
  const setup = material.setupLightingModel;
  material.setupLightingModel = function (builder) {
    // the material's own model (clearcoat, sheen... flags and all), with the person's light on top
    return Object.assign(new PersonLightingModel(), setup.call(this, builder));
  };
  return material;
}

export { PERSON_LIGHT, PersonLightingModel, lightAsPerson, isLocalLight };
