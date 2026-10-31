import * as THREE from 'three/webgpu';
import { float, vec3, uniform, fract, sin, positionLocal, cameraPosition, time, normalize, smoothstep, length, instanceIndex } from 'three/tsl';
import { TIME_PRESETS } from './lighting.js';
import { GRADE_LOOKS } from './post-processing.js';

// Time of day and weather. The clock runs a 24 h day in about half an hour; the four hand-tuned lighting presets are
// blended through it (morning mirrors the evening sun across the avenues). Weather drifts between clear, cloudy, rain
// and storm, darkening the sky, thickening the haze, wetting the streets (less grip), raining drops round the camera,
// and in storms flashing lightning with thunder after it.

const DAY_SECONDS = 1920; // real seconds per game day (an hour is 80 s)
// [hour, preset, morning?]: the sun comes from the east (mirrored x) before noon
const KEYS = [
  [0, 'midnight'], [4.6, 'midnight'], [5.9, 'twilight', true], [7.4, 'golden', true], [10, 'midday', true],
  [14.5, 'midday'], [17.6, 'golden'], [19.6, 'twilight'], [21.2, 'midnight'], [24, 'midnight']
];
const WEATHER = {
  clear: { cloud: 0.05, rain: 0, storm: 0, label: 'DÉGAGÉ' },
  cloudy: { cloud: 0.6, rain: 0, storm: 0, label: 'NUAGEUX' },
  rain: { cloud: 0.85, rain: 0.75, storm: 0, label: 'PLUIE' },
  storm: { cloud: 1, rain: 1, storm: 1, label: 'ORAGE' }
};
const COLOR_KEYS = ['sunColor', 'hemiSky', 'hemiGround', 'skyTop', 'skyHorizon', 'fogColor'];
const NUMBER_KEYS = ['sunIntensity', 'hemiIntensity', 'fogDensity', 'interiorGlow', 'roadWetness', 'envIntensity', 'canyonBounce',
  'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'cloudCoverage', 'cloudDensity', 'skyExposure', 'nightFactor'];
const LOOK_KEYS = ['exposure', 'contrast', 'saturation', 'bloom', 'threshold'];
const RAIN_DROPS = 5000;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

function presetColors(p) {
  const out = {};
  for (const k of COLOR_KEYS) out[k] = new THREE.Color(p[k]);
  return out;
}

class Atmosphere {
  constructor({ lighting, grade, scene, camera, controllers }) {
    Object.assign(this, { lighting, grade, scene, camera, controllers });
    this.hour = 17.2;
    this.running = true;
    this.weather = 'clear';
    this.cloud = 0.05; this.rain = 0; this.storm = 0; this.wet = 0;
    this.nextWeather = 180;
    this.flash = 0; this.nextFlash = 8; this.thunderQueue = [];
    this.bakeT = 0;
    this.bakedSig = '';
    this.colors = Object.fromEntries(Object.entries(TIME_PRESETS).map(([id, p]) => [id, presetColors(p)]));
    this.params = { id: 'golden', sunDir: new THREE.Vector3() };
    for (const k of COLOR_KEYS) this.params[k] = new THREE.Color();
    this.look = { balance: [1, 1, 1] };
    this.storm2 = new THREE.Color(0x5c6670);
    this.audio = null;
    this.buildRain();
  }

  // ---- Rain: drops wrapped round the camera, drawn as one instanced quad set, animated on the GPU ----------------
  buildRain() {
    this.uCam = uniform(new THREE.Vector3());
    this.uWind = uniform(new THREE.Vector3(1.6, 0, 0.9));
    this.uTint = uniform(new THREE.Color(0xb8c4d0));
    this.uAlpha = uniform(0);
    const box = vec3(56, 24, 56);
    const i = float(instanceIndex);
    const r = (k) => fract(sin(i.mul(12.9898).add(k * 78.233)).mul(43758.5453));
    const speed = float(13).add(r(3).mul(6));
    const base = vec3(r(1), r(2), r(4)).mul(box);
    const fall = vec3(this.uWind.x.mul(time), speed.mul(time).negate(), this.uWind.z.mul(time));
    const rel = fract(base.add(fall).sub(this.uCam).div(box)).sub(0.5).mul(box);
    const center = this.uCam.add(rel);
    const toCam = normalize(vec3(cameraPosition.x.sub(center.x), 0.001, cameraPosition.z.sub(center.z)));
    const right = vec3(toCam.z, 0, toCam.x.negate());
    const along = normalize(vec3(this.uWind.x, speed.negate(), this.uWind.z));
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    material.positionNode = center.add(right.mul(positionLocal.x.mul(0.011))).sub(along.mul(positionLocal.y.mul(0.72)));
    const d = length(center.sub(cameraPosition));
    material.colorNode = this.uTint;
    material.opacityNode = this.uAlpha.mul(smoothstep(1.4, 4.0, d)).mul(smoothstep(28.0, 14.0, d));
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.rainMesh = new THREE.Mesh(geometry, material);
    this.rainMesh.name = 'Rain';
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 990;
    this.rainMesh.count = 1; // one drop drawn until warmed up, so the pipeline compiles with the city
    this.scene.add(this.rainMesh);
  }

  attachAudio(audio, context) {
    this.audio = audio;
    // Rain hiss: looped noise, band-limited, swelling with the downpour
    const length = context.sampleRate * 2;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let y = 0;
    for (let k = 0; k < length; k++) { y += ((Math.random() * 2 - 1) - y) * 0.5; data[k] = y; }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const hp = context.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
    const lp = context.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    this.rainGain = context.createGain();
    this.rainGain.gain.value = 0;
    source.connect(hp).connect(lp).connect(this.rainGain).connect(audio.flat);
    source.start();
    this.rainFilter = lp;
  }

  setHour(h) {
    this.hour = ((h % 24) + 24) % 24;
    this.bakedSig = '';
  }

  setWeather(name, instant = false) {
    if (!WEATHER[name]) return;
    this.weather = name;
    if (instant) { const w = WEATHER[name]; this.cloud = w.cloud; this.rain = w.rain; this.storm = w.storm; this.wet = w.rain; }
    this.bakedSig = '';
  }

  get clockLabel() {
    const m = Math.floor(this.hour * 60);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  get weatherLabel() { return WEATHER[this.weather].label; }
  get night() { return this.params.nightFactor ?? 0; }

  // Blended lighting parameters for this hour, then the weather on top
  compute() {
    const h = this.hour;
    let k = 0;
    while (k < KEYS.length - 2 && h >= KEYS[k + 1][0]) k++;
    const [h0, idA, mA] = KEYS[k], [h1, idB, mB] = KEYS[k + 1];
    const t = smooth(Math.min(1, Math.max(0, (h - h0) / (h1 - h0))));
    const A = TIME_PRESETS[idA], B = TIME_PRESETS[idB];
    const p = this.params;
    p.id = t < 0.5 ? idA : idB;
    for (const key of NUMBER_KEYS) p[key] = lerp(A[key], B[key], t);
    for (const key of COLOR_KEYS) p[key].copy(this.colors[idA][key]).lerp(this.colors[idB][key], t);
    const sa = A.sunDir, sb = B.sunDir;
    p.sunDir.set(lerp(mA ? -sa.x : sa.x, mB ? -sb.x : sb.x, t), lerp(sa.y, sb.y, t), lerp(sa.z, sb.z, t)).normalize();

    // Weather
    const c = this.cloud, r = this.rain;
    p.cloudCoverage = lerp(p.cloudCoverage, 0.92, c);
    p.cloudDensity = lerp(p.cloudDensity, 0.8, c);
    p.sunIntensity *= 1 - 0.7 * c;
    p.hemiIntensity *= 1 - 0.22 * c;
    p.skyExposure *= 1 - 0.5 * c;
    p.envIntensity *= 1 - 0.25 * c;
    p.fogDensity *= 1 + 1.6 * r + 0.4 * c;
    p.roadWetness = Math.max(p.roadWetness, 0.2 + 0.75 * this.wet);
    p.turbidity = lerp(p.turbidity, 10, c);
    for (const key of ['fogColor', 'skyHorizon']) p[key].lerp(this.storm2, 0.55 * c * (1 - p.nightFactor * 0.6));
    p.sunColor.lerp(new THREE.Color(0xc8ccd0), 0.5 * c);
    // Lightning
    if (this.flash > 0) {
      p.hemiIntensity += 7 * this.flash;
      p.skyExposure *= 1 + 5 * this.flash;
      p.nightFactor *= 1 - this.flash;
    }

    // Colour grade blended the same way
    const LA = GRADE_LOOKS[idA], LB = GRADE_LOOKS[idB];
    for (const key of LOOK_KEYS) this.look[key] = lerp(LA[key], LB[key], t);
    for (let i = 0; i < 3; i++) this.look.balance[i] = lerp(LA.balance[i], LB.balance[i], t);
    this.look.saturation *= 1 - 0.18 * c;
    return p;
  }

  update(dt, active) {
    if (active && this.running) this.hour = (this.hour + dt * 24 / DAY_SECONDS) % 24;

    // Weather drifts towards its state; a new state now and then
    if (active) {
      this.nextWeather -= dt;
      if (this.nextWeather <= 0 && !this.lockWeather) {
        const roll = Math.random();
        this.weather = roll < 0.5 ? 'clear' : roll < 0.72 ? 'cloudy' : roll < 0.92 ? 'rain' : 'storm';
        this.nextWeather = 240 + Math.random() * 420;
      }
    }
    const w = WEATHER[this.weather];
    const ease = (v, target, rate) => v + (target - v) * Math.min(1, dt * rate);
    this.cloud = ease(this.cloud, w.cloud, 0.05);
    this.rain = ease(this.rain, w.rain, this.rain < w.rain ? 0.06 : 0.12);
    this.storm = ease(this.storm, w.storm, 0.1);
    // streets dry slowly after the rain
    this.wet = this.rain > this.wet ? ease(this.wet, this.rain, 0.2) : Math.max(this.rain, this.wet - dt / 240);
    this.controllers.gripFactor = 1 - 0.2 * this.wet;

    // Lightning, the thunder after it
    this.flash = Math.max(0, this.flash - dt * 6);
    if (this.storm > 0.5 && active) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.flash = 1;
        this.nextFlash = 5 + Math.random() * 14;
        this.thunderQueue.push(0.4 + Math.random() * 2.2);
      }
    }
    for (let i = this.thunderQueue.length - 1; i >= 0; i--) {
      this.thunderQueue[i] -= dt;
      if (this.thunderQueue[i] <= 0) { this.thunderQueue.splice(i, 1); this.audio?.ui('thunder', 0.6 + Math.random() * 0.4); }
    }

    const p = this.compute();
    // Re-bake the sky environment when it has visibly changed (or during lightning), never every frame
    this.bakeT -= dt;
    const sig = `${p.sunDir.x.toFixed(2)}${p.sunDir.y.toFixed(2)}|${p.skyExposure.toFixed(3)}|${p.cloudCoverage.toFixed(2)}|${p.nightFactor.toFixed(2)}|${p.fogColor.getHexString()}`;
    const bake = (sig !== this.bakedSig && this.bakeT <= 0) || this.bakedSig === '';
    if (bake) { this.bakedSig = sig; this.bakeT = 3; }
    this.lighting.applyParams(p, bake);
    this.grade.applyLook(this.look);

    // Rain drops round the camera
    const cam = this.camera.position;
    this.uCam.value.set(cam.x, cam.y + 4, cam.z);
    const drops = Math.round(RAIN_DROPS * this.rain);
    this.warm = (this.warm || 0) + 1;
    this.rainMesh.count = Math.max(drops, this.warm < 5 ? 1 : 0);
    this.rainMesh.visible = this.rainMesh.count > 0;
    this.uAlpha.value = 0.42 * Math.min(1, this.rain * 1.4) * (this.warm < 5 && !drops ? 0 : 1);
    const lit = 0.35 + 0.65 * (1 - p.nightFactor);
    this.uTint.value.setRGB(0.62 * lit + 0.25 * this.flash, 0.68 * lit + 0.25 * this.flash, 0.76 * lit + 0.25 * this.flash);
    if (this.rainGain) {
      const ctx = this.rainGain.context;
      this.rainGain.gain.setTargetAtTime(this.rain * 0.16, ctx.currentTime, 0.4);
    }
  }

  serialize() { return { hour: this.hour, weather: this.weather }; }
  restore(data) {
    if (!data) return;
    if (Number.isFinite(data.hour)) this.setHour(data.hour);
    if (WEATHER[data.weather]) this.setWeather(data.weather, true);
  }
}

export { Atmosphere, WEATHER };
