import * as THREE from 'three/webgpu';
import { cameraPosition, float, fract, instanceIndex, length, normalize, positionLocal, sin, smoothstep, time, uniform, vec3 } from 'three/tsl';
import { CITY_NORTH, CITY_SOUTH, cityBoundsAt } from './city-frontier.js';
import { sealEffect } from './effect-outputs.js';
import { cityUniforms } from './tsl-materials.js';
import { saltLandAt, saltLocation } from './wasteland-plan.js';
import { saltTints, saltUniforms } from './wasteland-materials.js';

// The air of the Wasteland: how deep in it the camera stands, and what that does to the sky, the haze, the light
// and the grade. Crossing the limit is felt in the picture before anything is read.

const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const SAND_GRAINS = 1500;
const OCHRE = { r: 0.86, g: 0.66, b: 0.42 }, DUSTY_BLUE = { r: 0.36, g: 0.47, b: 0.56 };

export class SaltAir {
  constructor({ lighting, atmosphere, scene }) {
    this.lighting = lighting;
    if (scene) this.buildSand(scene);
    this.buildCard();
    this.atmosphere = atmosphere;
    this.depth = 0; // 0 in the city .. 1 out in the Wasteland
    this.gust = 0.35;
    this.entered = 0; // seconds spent outside since the last crossing
    this.onCross = null; // called once each time the limit is crossed outward
    // The island's shores, for the haze: what lies beyond them is seen through dust even from a roof in Midtown
    const rows = lighting.uShore.array, z0 = CITY_NORTH, z1 = CITY_SOUTH;
    for (let i = 0; i < rows.length; i++) {
      const shore = cityBoundsAt(z0 + (z1 - z0) * i / (rows.length - 1));
      rows[i].set(shore.westX, shore.eastX);
    }
    lighting.uShoreZ.value.set(z0, z1);
    atmosphere.biome = (p, look) => this.tint(p, look);
  }

  // Metres beyond Manhattan's shores (0 on the island)
  beyond(x, z) {
    const zc = Math.max(CITY_NORTH, Math.min(CITY_SOUTH, z)), shore = cityBoundsAt(zc);
    return Math.hypot(Math.max(shore.westX - x, 0, x - shore.eastX), z - zc);
  }

  update(dt, camera) {
    const { x, z } = camera;
    const target = saltLandAt(x, z) ? sm(16, 255, this.beyond(x, z)) : 0;
    const was = this.depth;
    this.depth += (target - this.depth) * Math.min(1, dt * (target > this.depth ? 0.85 : 0.6));
    // Crossing the limit, either way, is announced once: not again for someone who walks the line
    if (this.depth > 0.5) {
      if (was <= 0.5 && this.away > 12) { this.card('LE WASTELAND', saltLocation(x, z) ?? 'Hors les murs'); this.onCross?.(true); }
      this.away = 0;
      this.entered += dt;
    } else {
      if (was > 0.5 && this.entered > 12) { this.card('MANHATTAN', 'Ville franche'); this.onCross?.(false); }
      this.away = (this.away ?? 60) + dt; this.entered = 0;
    }
    this.lighting.uDust.value = this.depth;
    // The wind: a slow swell, harder under a storm sky
    const t = performance.now() / 1000, storm = this.atmosphere.storm ?? 0;
    this.gust += (Math.min(1, 0.3 + 0.25 * Math.sin(t * 0.11) + 0.2 * Math.sin(t * 0.37 + 1.7) + 0.8 * storm) - this.gust) * Math.min(1, dt * 0.5);
    saltUniforms.uGust.value = this.gust;
    // By night the sky is all the light there is away from the moon's own: the ground takes more of it
    saltUniforms.uAmbient.value = 0.25 + 0.22 * cityUniforms.uNight.value;
    if (this.sand) {
      this.uCam.value.set(x, camera.y, z);
      const grains = Math.round(SAND_GRAINS * this.depth * (0.2 + 0.8 * this.gust) * (camera.y < 400 ? 1 : 0));
      this.warm = (this.warm ?? 0) + 1;
      this.sand.count = Math.max(grains, this.warm < 5 ? 1 : 0); // one grain until the pipeline is compiled with the city's
      this.sand.visible = this.sand.count > 0;
      this.uAlpha.value = grains ? 0.2 + 0.3 * this.gust : 0;
    }
  }

  // Sand in the air: streaks carried round the camera on the wind, one instanced quad set animated on the GPU
  buildSand(scene) {
    this.uCam = uniform(new THREE.Vector3());
    this.uAlpha = uniform(0);
    const box = vec3(64, 11, 64);
    const i = float(instanceIndex);
    const r = (k) => fract(sin(i.mul(12.9898).add(k * 78.233)).mul(43758.5453));
    const wind = normalize(vec3(saltUniforms.uWind.x, 0, saltUniforms.uWind.y));
    const speed = float(7).add(r(3).mul(9)).mul(saltUniforms.uGust.mul(0.9).add(0.55));
    const drift = wind.mul(speed.mul(time)).add(vec3(0, sin(time.mul(r(5).add(0.4)).add(r(6).mul(6.28))).mul(0.7), 0));
    const rel = fract(vec3(r(1), r(2), r(4)).mul(box).add(drift).sub(this.uCam).div(box)).sub(0.5).mul(box);
    const centre = this.uCam.add(rel).add(vec3(0, 3.2, 0));
    const side = vec3(wind.z.negate(), 0.35, wind.x);
    const material = sealEffect(new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false }));
    material.positionNode = centre.add(side.mul(positionLocal.x.mul(0.035))).add(wind.mul(positionLocal.y.mul(r(7).mul(1.6).add(0.9))));
    const d = length(centre.sub(cameraPosition));
    material.colorNode = saltTints.dune.mul(1.9).mul(cityUniforms.uNight.mul(-0.9).add(1)); // at night the grains are felt more than seen
    material.opacityNode = this.uAlpha.mul(smoothstep(1.2, 5.0, d)).mul(smoothstep(32.0, 16.0, d));
    this.sand = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.sand.name = 'Sable au vent';
    this.sand.frustumCulled = false;
    this.sand.renderOrder = 989;
    this.sand.count = 1;
    scene.add(this.sand);
  }

  // The card that names the country one has just come into
  buildCard() {
    if (typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = `#salt-card{position:fixed;left:0;right:0;top:21%;text-align:center;pointer-events:none;opacity:0;transform:translateY(10px);transition:opacity 1.2s ease,transform 1.8s ease;z-index:40;color:#f1dcae;text-shadow:0 2px 22px rgba(0,0,0,.6)}
#salt-card.on{opacity:1;transform:none}
#salt-card b{display:block;font-weight:800;font-size:clamp(30px,5vw,74px);line-height:1;letter-spacing:.3em;margin-right:-.3em}
#salt-card hr{width:130px;border:0;border-top:1px solid currentColor;opacity:.55;margin:20px auto 0}
#salt-card span{display:block;margin-top:14px;font-weight:600;font-size:clamp(12px,1.25vw,18px);letter-spacing:.34em;margin-right:-.34em;text-transform:uppercase;opacity:.88}`;
    document.head.append(style);
    this.cardEl = document.createElement('div');
    this.cardEl.id = 'salt-card';
    this.cardEl.append(document.createElement('b'), document.createElement('hr'), document.createElement('span'));
    document.body.append(this.cardEl);
  }

  card(title, subtitle) {
    if (!this.cardEl) return;
    this.cardEl.children[0].textContent = title;
    this.cardEl.children[2].textContent = subtitle;
    this.cardEl.classList.add('on');
    clearTimeout(this.cardTimer);
    this.cardTimer = setTimeout(() => this.cardEl.classList.remove('on'), 4200);
  }

  // Called by the atmosphere with this frame's lighting parameters and look, before it applies them
  tint(p, look) {
    const w = this.depth;
    if (w < 0.002) return;
    const day = 1 - p.nightFactor, toward = (colour, target, k) => { colour.r += (target.r - colour.r) * k; colour.g += (target.g - colour.g) * k; colour.b += (target.b - colour.b) * k; };
    p.turbidity += 4 * w; p.mieCoefficient *= 1 + 2.2 * w;
    p.fogDensity *= 1 + 0.3 * w;
    toward(p.fogColor, OCHRE, 0.5 * w * day); toward(p.skyHorizon, OCHRE, 0.5 * w * day); toward(p.skyTop, DUSTY_BLUE, 0.5 * w * day);
    look.exposure *= 1 - 0.08 * w * day;
    look.contrast *= 1 + 0.05 * w;
    look.saturation *= 1 + 0.06 * w;
    look.balance[0] *= 1 + 0.05 * w * day; look.balance[2] *= 1 - 0.09 * w * day;
    // By night the open desert is a moonlit country: brighter than the city's canyons, and blue
    const night = p.nightFactor;
    p.sunIntensity *= 1 + 1.5 * w * night; p.hemiIntensity *= 1 + 0.9 * w * night;
    look.exposure *= 1 + 0.25 * w * night;
    look.balance[0] *= 1 - 0.06 * w * night; look.balance[2] *= 1 + 0.1 * w * night;
    look.bloom += 0.05 * w;
  }
}
