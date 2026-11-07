import { combustionBuffers, setControlRate } from './audio-synthesis.js';

// The sound of the car being driven: the engine at the revs the gearbox really has it at, in the voice of its class, tyres,
// road, wind, metal on the ground, nitro and what the exhaust spits on the overrun. Not positioned: this is what the driver
// hears. Everything is driven once a frame from the car's physics state (car-physics.js).

const VOICES = {
  sedan: { cylinders: 6, seed: 0x53454441, lope: 0, cutoff: 1, drive: 1.2 },
  v8: { cylinders: 8, seed: 0x56385631, lope: 0.14, cutoff: 0.82, drive: 2.6 },
  flat6: { cylinders: 6, seed: 0x464c4154, lope: 0.05, cutoff: 1.25, drive: 1.9, turbo: 0.5 },
  v12: { cylinders: 12, seed: 0x56313221, lope: 0, cutoff: 1.5, drive: 1.6, turbo: 1 },
  four: { cylinders: 4, seed: 0x464f5552, lope: 0, cutoff: 1.1, drive: 1.3 },
  diesel: { cylinders: 6, seed: 0x44494553, lope: 0, cutoff: 0.7, drive: 1.4, diesel: true }
};
const VOICE_OF = { boat: 'four', cruiser: 'v8', muscle: 'v8', pickup: 'v8', suv: 'v8', offroad: 'v8', sport: 'flat6', super: 'v12', hatch: 'four', compact: 'four', minivan: 'four', van: 'diesel', truck: 'diesel', delivery: 'diesel' };
// Small differences within a shared engine family avoid maintaining dozens of continuously running graphs.
// Resonance is exhaust length, not a fake RPM multiplier: the firing frequency remains tied to the crankshaft.
const CHARACTER = {
  sedan: [1, 1, 1], taxi: [0.9, 0.87, 0.9], wagon: [1.02, 0.95, 1.03], cruiser: [1.08, 0.94, 1],
  compact: [0.86, 1.08, 0.86], hatch: [1.04, 1.12, 1.15], minivan: [0.86, 0.82, 0.88],
  muscle: [1.2, 0.83, 1.3], sport: [1.08, 1.12, 1.2], super: [1.1, 1.18, 1.25],
  suv: [0.94, 0.85, 0.95], offroad: [1.05, 0.8, 1.1], pickup: [1.09, 0.84, 1.15],
  van: [0.93, 0.85, 0.96], truck: [1.12, 0.68, 1.12], delivery: [1.04, 0.74, 1.04], boat: [1, 0.9, 1]
};
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

class DriveAudio {
  constructor(context, resources, output) {
    this.context = context;
    this.resources = resources;
    this.nodes = new Set();
    this.sources = new Set();
    this.targets = new WeakMap();
    this.disposed = false;
    this.bus = this.own(context.createGain());
    this.bus.gain.value = 0;
    this.bus.connect(output);
    this.voices = new Map();
    this.car = null;
    this.current = null;
    this.popAt = 0;
    this.wasAir = 0;
    this.lastShift = 0;
    this.lastBump = 0;
    this.buildBed();
  }

  own(node, source = false) {
    this.nodes.add(node);
    if (source) this.sources.add(node);
    return node;
  }

  release(...nodes) {
    for (const node of nodes) { node.disconnect(); this.nodes.delete(node); this.sources.delete(node); }
  }

  noiseLoop(rate = 1) {
    const s = this.own(this.context.createBufferSource(), true);
    s.buffer = this.resources.noise;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(this.context.currentTime, Math.random() * s.buffer.duration);
    return s;
  }

  filter(type, frequency, q = 0.7) {
    const f = this.own(this.context.createBiquadFilter());
    setControlRate(f.frequency, f.detune, f.Q, f.gain);
    f.type = type; f.frequency.value = Math.min(frequency, this.context.sampleRate * 0.45); f.Q.value = q;
    return f;
  }

  gain(value = 0) {
    const g = this.own(this.context.createGain());
    g.gain.value = value;
    return g;
  }

  // Everything that does not depend on the engine
  buildBed() {
    const c = this.context, bus = this.bus;
    const layer = (rate, filters) => {
      const out = this.gain();
      let node = this.noiseLoop(rate);
      for (const f of filters) { node.connect(f); node = f; }
      node.connect(out).connect(bus);
      return { out, filters };
    };
    this.road = layer(0.7, [this.filter('lowpass', 260, 0.6)]);
    this.wind = layer(1, [this.filter('bandpass', 800, 0.6)]);
    this.tyreA = layer(1, [this.filter('bandpass', 930, 2.8)]);
    this.tyreB = layer(1.2, [this.filter('bandpass', 1850, 2.5)]);
    this.scrape = layer(1.4, [this.filter('bandpass', 3400, 2.6)]);
    this.nitro = layer(0.9, [this.filter('highpass', 700, 0.5)]);
    this.dirt = layer(0.5, [this.filter('bandpass', 420, 0.8)]);
    // A squeal has a pitch of its own on top of the hiss
    this.whine = this.own(c.createOscillator(), true);
    this.whine.type = 'triangle';
    this.whine.frequency.value = 760;
    this.whineGain = this.gain();
    const band = this.filter('lowpass', 1800, 0.6);
    this.whine.connect(band).connect(this.whineGain).connect(bus);
    this.whine.start();
  }

  // A class's engine: two recordings' worth of firings a few thousand revs apart, crossfaded, through an exhaust
  voice(name) {
    if (this.voices.has(name)) return this.voices.get(name);
    const c = this.context, spec = VOICES[name];
    const sound = combustionBuffers(c, spec.cylinders, !!spec.diesel, spec.seed, spec.lope);
    const out = this.gain();
    const low = this.own(c.createBufferSource(), true), high = this.own(c.createBufferSource(), true), clatter = this.own(c.createBufferSource(), true);
    low.buffer = sound.exhaust; high.buffer = sound.highExhaust; clatter.buffer = sound.mechanical;
    low.loop = high.loop = clatter.loop = true;
    const lowGain = this.gain(1), highGain = this.gain(), clatterGain = this.gain();
    const tone = this.filter('lowpass', 900, 0.8);
    const shaper = this.own(c.createWaveShaper());
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * spec.drive) / Math.tanh(spec.drive); }
    shaper.curve = curve;
    const body = this.filter('peaking', spec.diesel ? 105 : name === 'v8' ? 140 : 195, 0.8); body.gain.value = 4.5;
    const master = this.gain();
    low.connect(lowGain).connect(tone);
    high.connect(highGain).connect(tone);
    tone.connect(body).connect(shaper).connect(master).connect(out);
    const clatterBand = this.filter('bandpass', 1700, 0.5);
    clatter.connect(clatterBand).connect(clatterGain).connect(out);
    const intake = this.gain();
    const intakeBand = this.filter('bandpass', 700, 1.1);
    this.noiseLoop(1.1).connect(intakeBand).connect(intake).connect(out);
    let turbo = null;
    if (spec.turbo) {
      const osc = this.own(c.createOscillator(), true);
      osc.type = 'sine';
      osc.frequency.value = 1600;
      const g = this.gain();
      osc.connect(g).connect(out);
      osc.start();
      turbo = { osc, g };
    }
    out.connect(this.bus);
    const start = c.currentTime;
    low.start(start); high.start(start, 0); clatter.start(start);
    const voice = { body, spec, sound, out, low, high, clatter, lowGain, highGain, clatterGain, tone, master, intake, intakeBand, turbo };
    this.voices.set(name, voice);
    return voice;
  }

  set(param, value, now, time = 0.03) {
    if (!Number.isFinite(value) || this.disposed) return;
    const previous = this.targets.get(param);
    if (previous !== undefined && Math.abs(previous - value) < 0.0001) return;
    // Prevent unbounded automation queues in a long drive, and preserve continuity when a target changes.
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, time);
    this.targets.set(param, value);
  }

  thump(strength) {
    const c = this.context, now = c.currentTime;
    const osc = this.own(c.createOscillator(), true), g = this.gain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(92, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.16);
    g.gain.setValueAtTime(clamp(strength, 0, 1) * 0.9, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(g).connect(this.bus);
    osc.start(now); osc.stop(now + 0.26);
    osc.onended = () => this.release(osc, g);
  }

  // The exhaust spits unburnt fuel: a short hard crack
  pop(strength) {
    const c = this.context, now = c.currentTime;
    const s = this.noiseLoop(0.8 + Math.random() * 0.5), band = this.filter('bandpass', 500 + Math.random() * 900, 0.9), g = this.gain();
    g.gain.setValueAtTime(strength * 0.5, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.05 + Math.random() * 0.05);
    s.connect(band).connect(g).connect(this.bus);
    s.stop(now + 0.14);
    s.onended = () => this.release(s, band, g);
  }

  update(car, active, volume = 1) {
    if (this.disposed) return;
    const now = this.context.currentTime;
    const b = car?.body ?? car?.sound;
    const on = !!(active && b);
    this.set(this.bus.gain, on ? volume : 0, now, on ? 0.05 : 0.12);
    if (!on) {
      for (const v of this.voices.values()) this.set(v.out.gain, 0, now, 0.1);
      this.current = null;
      this.car = null;
      return;
    }
    const t = car.tune ?? car.audioTune;
    const name = VOICE_OF[car.kind] ?? 'sedan';
    const voice = this.voice(name);
    if (this.current !== voice) {
      for (const v of this.voices.values()) if (v !== voice) this.set(v.out.gain, 0, now, 0.05);
      this.set(voice.out.gain, 1, now, 0.03);
      this.current = voice;
    }
    const { sound, spec } = voice;
    const [weight, resonance, induction] = CHARACTER[car.kind] ?? CHARACTER.sedan;
    const rpm = clamp(b.rpm || t.idle || 780, 300, (t.redline || 7000) * 1.08);
    const load = clamp(b.engineLoad ?? b.throttle ?? 0, 0, 1.25), rev = clamp(rpm / (t.redline || 7000), 0, 1.1);
    const changed = this.car !== car;
    if (changed) { this.car = car; this.lastGear = b.gear; this.popAt = now; }
    const shift = b.gear !== this.lastGear && !changed;
    // The gear engages with a single subdued mechanical impulse. It must not retrigger while the clutch is open.
    if (shift && now - this.lastShift > 0.12) { this.thump((0.035 + load * 0.055) * weight); this.lastShift = now; }
    this.lastGear = b.gear;
    this.set(voice.body.frequency, (spec.diesel ? 105 : name === 'v8' ? 140 : 195) * resonance, now, 0.08);
    const rate = rpm / sound.referenceRPM;
    this.set(voice.low.playbackRate, rate, now, 0.012);
    this.set(voice.high.playbackRate, rpm / sound.highReferenceRPM, now, 0.012);
    this.set(voice.clatter.playbackRate, rate, now, 0.012);
    const bank = clamp((rpm - sound.referenceRPM) / (sound.highReferenceRPM * 1.1 - sound.referenceRPM), 0, 1);
    const blend = bank * bank * (3 - 2 * bank);
    this.set(voice.lowGain.gain, Math.cos(blend * Math.PI / 2), now, 0.03);
    this.set(voice.highGain.gain, Math.sin(blend * Math.PI / 2), now, 0.03);
    const cut = b.shift > 0 ? 0.23 : 1;
    const effort = (0.25 + 0.75 * load) * cut;
    this.set(voice.tone.frequency, (300 + rpm * (0.13 + load * 0.4)) * spec.cutoff * resonance, now, 0.03);
    this.set(voice.master.gain, (0.24 + rev * 0.21) * effort * weight * (b.nitro ? 1.15 : 1), now, 0.018);
    this.set(voice.clatterGain.gain, (spec.diesel ? 0.055 : 0.012) * (0.75 + rev * 0.8) * (0.5 + load * 0.5), now, 0.04);
    this.set(voice.intakeBand.frequency, 320 + rpm * 0.14, now, 0.03);
    this.set(voice.intake.gain, 0.085 * load * rev * rev * induction, now, 0.03);
    if (voice.turbo) {
      this.set(voice.turbo.osc.frequency, 1500 + rpm * 0.62, now, 0.05);
      this.set(voice.turbo.g.gain, 0.012 * spec.turbo * load * rev * rev, now, 0.08);
    }

    const speed = Math.hypot(b.vx, b.vz), grounded = b.grounded > 0;
    let rough = 0, hardSlip = 0, looseSlip = 0, contacts = 0, loose = 0;
    for (const wheel of b.wheels ?? []) {
      if (!wheel.hasGround) continue;
      contacts++;
      rough += wheel.rough || 0;
      if (wheel.grip < 0.7 && wheel.rough > 0.012) { loose++; looseSlip = Math.max(looseSlip, wheel.slip || 0); }
      else hardSlip = Math.max(hardSlip, wheel.slip || 0);
    }
    rough /= Math.max(1, contacts);
    this.set(this.road.out.gain, grounded ? clamp(speed / 50, 0, 1) * 0.14 + clamp(rough * 2, 0, 0.25) * clamp(speed / 14, 0, 1) : 0, now, 0.07);
    this.set(this.road.filters[0].frequency, 180 + speed * 5, now, 0.1);
    this.set(this.wind.out.gain, 0.22 * clamp(speed / 80, 0, 1.3) ** 2, now, 0.1);
    this.set(this.wind.filters[0].frequency, 500 + speed * 14, now, 0.1);

    // Contact patches, not global skid state: airborne wheels are silent, mixed surfaces keep both textures.
    const skid = grounded ? clamp((hardSlip - 1.8) / 10, 0, 1) : 0;
    const pitch = 1 + clamp(hardSlip / 35, 0, 0.42);
    this.set(this.tyreA.out.gain, Math.sqrt(skid) * 0.25, now, 0.045);
    this.set(this.tyreA.filters[0].frequency, 780 * pitch, now, 0.06);
    this.set(this.tyreB.out.gain, skid * skid * 0.13, now, 0.05);
    this.set(this.whine.frequency, 590 * pitch + Math.sin(now * 29) * 13 + Math.sin(now * 67) * 7, now, 0.03);
    this.set(this.whineGain.gain, skid * 0.022, now, 0.045);
    this.set(this.dirt.out.gain, loose ? (clamp(speed / 16, 0, 1) * 0.2 + clamp(looseSlip / 10, 0, 1) * 0.2) * loose / Math.max(1, contacts) : 0, now, 0.06);
    const metal = Math.max(clamp((b.scrape || 0) / 16, 0, 1), b.wall > 0 ? clamp((b.wallSpeed || 0) / 22, 0, 1) : 0);
    this.set(this.scrape.out.gain, metal * (0.3 + Math.sin(now * 73) ** 2 * 0.14), now, 0.02);
    this.set(this.nitro.out.gain, b.nitro ? 0.2 : 0, now, b.nitro ? 0.04 : 0.12);

    if (b.backfire > 0.3 && now > this.popAt && ['muscle', 'sport', 'super', 'cruiser'].includes(car.kind)) {
      this.pop((0.25 + Math.random() * 0.25) * weight);
      this.popAt = now + 0.035 + Math.random() * 0.08;
    }
    if (b.landed > 0) {
      this.thump(clamp(b.landed * 1.1, 0.2, 1));
      b.landed = 0;
    }
    // A wheel dropping off a kerb
    const jolt = Math.abs(b.vy) > 0.9 && grounded;
    if (jolt && now - this.lastBump > 0.25) { this.thump(clamp(Math.abs(b.vy) * 0.18, 0.1, 0.5)); this.lastBump = now; }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const source of this.sources) { try { source.stop(); } catch { /* Already ended. */ } }
    for (const node of this.nodes) node.disconnect();
    this.nodes.clear(); this.sources.clear(); this.voices.clear();
    this.current = this.car = null;
  }
}

export { DriveAudio };
