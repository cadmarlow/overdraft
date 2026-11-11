import { combustionBuffers, setControlRate } from './audio-synthesis.js';

// The sound of the aircraft being flown, as its pilot and the chase camera hear it. Not positioned. Two voices that
// share nothing but the air: a nine-cylinder radial swinging a two-blade propeller through singing wires, and a
// turbine that whines, roars and lights a reheat. Everything is read once a frame from the flight model's own state
// (flight.js: power, afterburner, airspeed, Mach, g, buffet, stall, wheels), so every input is heard.
//
// Only the aircraft in hand has a graph (about forty nodes); it is built on boarding and released a moment after
// leaving, so a session spent on the ground pays for four idle nodes. The bus ends in a soft saturation: the flat
// bus it feeds does not go through the city's compressor, and a reheat with a sonic boom on top must not clip.

const RADIAL = { cylinders: 9, seed: 0x52414431, lope: 0.25, idle: 600, full: 2300 };
const WHINE = { idle: 900, full: 5000 };
// The bus bends towards CEILING and never passes it; its curve is drawn for inputs up to ±HEADROOM
const CEILING = 0.8, HEADROOM = 3;
const LEVEL = 1; // the whole voice against the rest of the game: the one number to turn if flying is too loud or too shy
const REST = 2.5; // seconds of silence before the graph is given back
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const unit = (v) => clamp(num(v), 0, 1);
const ease = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// Stop an envelope where it is, without the step back that cancelling a ramp half-way makes
const halt = (param, now) => { if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now); else param.cancelScheduledValues(now); };

function shape(points, f) {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) curve[i] = f(i / (points - 1) * 2 - 1);
  return curve;
}
const softClip = () => shape(4097, (x) => CEILING * Math.tanh(x * HEADROOM / CEILING));
// Harder one way than the other, like pressure in a pipe: even harmonics as well as odd, the bark of open stacks
const growl = (drive, bias) => {
  const zero = Math.tanh(drive * bias), top = Math.max(Math.tanh(drive * (1 + bias)) - zero, zero - Math.tanh(drive * (bias - 1)));
  return shape(1025, (x) => (Math.tanh(drive * (x + bias)) - zero) / top);
};
// Quiet stays quiet and the peaks leap out: the sparse, hard-edged spikes that make a reheat tear instead of hiss
const crackle = () => shape(2049, (x) => Math.sign(x) * Math.min(1, Math.pow(Math.abs(x) / 0.42, 2.6)));

class FlightAudio {
  constructor(context, resources, output) {
    this.context = context;
    this.resources = resources;
    this.nodes = new Set();
    this.sources = new Set();
    this.targets = new WeakMap();
    this.waves = new Map();
    this.curves = new Map();
    this.disposed = false;
    this.rig = null; // the graph of the aircraft in hand
    this.retired = []; // graphs fading out
    this.scope = null; // the graph being built: own() files its nodes there too
    this.craft = null;
    this.restAt = 0;
    this.heardUntil = -Infinity;
    this.state = { power: 0, trend: 0, overrun: 0, lit: 1, reheat: false };
    this.popAt = 0;
    this.beepAt = 0;
    this.beepFlip = false;
    this.lastTouch = this.lastCrunch = this.lastSplash = this.lastBoom = -Infinity;
    this.gearShot = null;
    this.bus = this.gain(0);
    this.bus.connect(output);
    this.limiter = this.own(context.createWaveShaper());
    this.limiter.curve = softClip();
    this.limiter.connect(this.bus);
    // the continuous voice, pulled down for a moment by a sonic boom; one-shots go round it
    this.duck = this.gain(1 / HEADROOM);
    this.duck.connect(this.limiter);
    this.shots = this.gain(1 / HEADROOM);
    this.shots.connect(this.limiter);
    // Eighty milliseconds of synthesis: kept off the first click's frame, done long before anyone reaches an airfield
    this.radial = null;
    this.warm = globalThis.setTimeout?.(() => { this.warm = null; if (!this.disposed) this.radialBuffers(); }, 400);
    this.warm?.unref?.();
  }

  // ---- Plumbing --------------------------------------------------------------------------------------------------

  own(node, source = false) {
    this.nodes.add(node);
    if (source) this.sources.add(node);
    if (this.scope) { this.scope.nodes.push(node); if (source) this.scope.sources.push(node); }
    return node;
  }

  release(...nodes) {
    for (const node of nodes) { node.disconnect(); this.nodes.delete(node); this.sources.delete(node); }
  }

  gain(value = 0) {
    const g = this.own(this.context.createGain());
    g.gain.value = value;
    return g;
  }

  filter(type, frequency, q = 0.7) {
    const f = this.own(this.context.createBiquadFilter());
    setControlRate(f.frequency, f.detune, f.Q, f.gain);
    f.type = type;
    f.frequency.value = Math.min(frequency, this.context.sampleRate * 0.45);
    f.Q.value = q;
    return f;
  }

  // A looping buffer, not started: a graph starts all of its loops on the same instant
  loop(buffer, rate = 1) {
    const s = this.own(this.context.createBufferSource(), true);
    s.buffer = buffer;
    s.loop = true;
    s.playbackRate.value = rate;
    return s;
  }

  oscillator(type, frequency) {
    const o = this.own(this.context.createOscillator(), true);
    if (typeof type === 'string') o.type = type;
    else o.setPeriodicWave(type);
    o.frequency.value = frequency;
    return o;
  }

  // Partials with the peak given, so several oscillators can share one gain at their own levels
  wave(name, partials, peak = 1) {
    if (this.waves.has(name)) return this.waves.get(name);
    let top = 0;
    for (let i = 0; i < 512; i++) {
      let v = 0;
      for (let k = 0; k < partials.length; k++) v += partials[k] * Math.sin((k + 1) * i / 512 * Math.PI * 2);
      top = Math.max(top, Math.abs(v));
    }
    const real = new Float32Array(partials.length + 1), imag = new Float32Array(partials.length + 1);
    for (let k = 0; k < partials.length; k++) imag[k + 1] = partials[k] * peak / (top || 1);
    const wave = this.context.createPeriodicWave(real, imag, { disableNormalization: true });
    this.waves.set(name, wave);
    return wave;
  }

  curve(name, make) {
    if (!this.curves.has(name)) this.curves.set(name, make());
    return this.curves.get(name);
  }

  radialBuffers() {
    return this.radial ??= combustionBuffers(this.context, RADIAL.cylinders, false, RADIAL.seed, RADIAL.lope);
  }

  // Glide to a value. Unchanged targets cost nothing, so a steady cruise does not pile automation up.
  set(param, value, now, time = 0.05) {
    if (!Number.isFinite(value) || this.disposed) return;
    const previous = this.targets.get(param);
    if (previous !== undefined && Math.abs(previous - value) <= 1e-4 + Math.abs(value) * 2e-4) return;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, time);
    this.targets.set(param, value);
  }

  begin(kind) {
    const rig = this.scope = { kind, nodes: [], sources: [] };
    rig.out = this.gain(0);
    rig.out.connect(this.duck);
    // what the pilot's seat does to the engine: a shelf that takes the top off it in the cockpit view
    rig.engine = this.filter('highshelf', kind === 'jet' ? 900 : 500, 0.7);
    rig.engine.connect(rig.out);
    rig.air = this.loop(this.resources.noise, 1);
    rig.low = this.loop(this.resources.noise, 0.3); // the same noise three times slower: all of it under 2 kHz
    return rig;
  }

  finish(rig, now) {
    this.scope = null;
    for (const s of rig.sources) {
      if (s.buffer === this.resources.noise) s.start(now, Math.random() * (s.buffer.duration || 0));
      else s.start(now);
    }
    rig.out.gain.setTargetAtTime(1, now, 0.03);
    return rig;
  }

  drop(rig) {
    for (const s of rig.sources) { try { s.stop(); } catch { /* Already ended. */ } }
    this.release(...rig.nodes);
  }

  // The shaking of the airframe, the wheels on the ground and metal on the ground: both aircraft have them
  bed(rig) {
    const { air, low, out } = rig;
    rig.rumbleLow = this.filter('lowpass', 180, 1);
    rig.rumble = this.gain();
    low.connect(rig.rumbleLow).connect(rig.rumble).connect(out);
    // the shudder: the rumble's level beaten a few times a second
    rig.shudder = this.oscillator('sine', 8);
    rig.shudderDepth = this.gain();
    rig.shudder.connect(rig.shudderDepth).connect(rig.rumble.gain);
    rig.tyreLow = this.filter('lowpass', 140, 0.8);
    rig.tyres = this.gain();
    low.connect(rig.tyreLow).connect(rig.tyres).connect(out);
    rig.scrapeBand = this.filter('bandpass', 2800, 2.2);
    rig.scrape = this.gain();
    air.connect(rig.scrapeBand).connect(rig.scrape).connect(out);
  }

  // ---- The radial biplane ------------------------------------------------------------------------------------------

  buildProp(now) {
    const c = this.context, rig = this.begin('prop'), { air, out, engine } = rig;
    const sound = rig.sound = this.radialBuffers();

    // Exhaust: nine uneven cylinders, recorded at two speeds and crossfaded so the pulses keep their weight
    rig.lowBank = this.loop(sound.exhaust);
    rig.highBank = this.loop(sound.highExhaust);
    rig.lowLevel = this.gain(1);
    rig.highLevel = this.gain();
    rig.tone = this.filter('lowpass', 600, 0.8);
    rig.body = this.filter('peaking', 170, 0.9);
    rig.body.gain.value = 5;
    const shaper = this.own(c.createWaveShaper());
    shaper.curve = this.curve('growl', () => growl(3, 0.12));
    // under the firing rate there is only the shaper's offset and a hum no speaker should carry
    rig.trim = this.filter('highpass', 50, 0.8);
    rig.exhaust = this.gain();
    rig.lowBank.connect(rig.lowLevel).connect(rig.tone);
    rig.highBank.connect(rig.highLevel).connect(rig.tone);
    rig.tone.connect(rig.body).connect(shaper).connect(rig.trim).connect(rig.exhaust).connect(engine);
    // the crack of each firing and the valve gear: what makes it bark instead of hum, and all that is left of the
    // engine when the propeller windmills it
    rig.clatter = this.loop(sound.mechanical);
    rig.clatterBand = this.filter('lowpass', 1500, 0.7);
    rig.clatterLevel = this.gain();
    rig.clatter.connect(rig.clatterBand).connect(rig.clatterLevel).connect(engine);

    // Propeller: a drone on the blade-pass frequency, two of them a hair apart so it beats slowly
    const blades = [1, 0.62, 0.46, 0.3, 0.26, 0.17, 0.15, 0.1, 0.09, 0.06, 0.05, 0.035];
    rig.blade = this.oscillator(this.wave('blade', blades, 1), 20);
    rig.bladeTwin = this.oscillator(this.wave('bladeTwin', blades, 0.45), 20.4);
    rig.propTone = this.filter('lowpass', 300, 0.7);
    rig.prop = this.gain();
    rig.blade.connect(rig.propTone);
    rig.bladeTwin.connect(rig.propTone);
    rig.propTone.connect(rig.prop).connect(engine);
    // and the air each blade throws back: noise chopped at the same beat
    rig.washBand = this.filter('bandpass', 620, 0.6);
    rig.wash = this.gain();
    rig.washDepth = this.gain();
    air.connect(rig.washBand).connect(rig.wash).connect(engine);
    rig.blade.connect(rig.washDepth).connect(rig.wash.gain);

    // The air on an open cockpit, and the bracing wires singing in it: two wires, two notes that climb with the speed
    rig.windBand = this.filter('bandpass', 600, 0.5);
    rig.wind = this.gain();
    air.connect(rig.windBand).connect(rig.wind).connect(out);
    rig.wireA = this.filter('bandpass', 1000, 16);
    rig.wireB = this.filter('bandpass', 1500, 22);
    rig.wires = this.gain();
    air.connect(rig.wireA).connect(rig.wires);
    air.connect(rig.wireB).connect(rig.wires);
    rig.wires.connect(out);

    this.bed(rig);
    return this.finish(rig, now);
  }

  updateProp(rig, a, f, now, dt) {
    const s = this.state, top = num(a.drive?.speed) || 67;
    const { V, power, dead, hurt, lit, pov, stall } = f;
    // A fixed-pitch propeller: held back standing still, let go in a dive; dead, the air turns it
    const unload = 0.86 + 0.14 * clamp(V / 50, 0, 1) + 0.16 * clamp((V - top * 0.8) / top, 0, 0.6);
    let rpm = dead ? clamp(V * 13, 0, 850) : RADIAL.idle + (RADIAL.full - RADIAL.idle) * Math.pow(power, 0.85) * unload;
    // a sick engine hunts and misses
    let miss = 1;
    if (hurt > 0) {
      rpm *= 1 - 0.1 * hurt + 0.035 * hurt * Math.sin(now * 5.1);
      if (Math.sin(now * 37.7) * Math.sin(now * 11.3 + 2) > 1 - hurt * 1.15) miss = 0.3;
    }
    const rev = clamp((rpm - RADIAL.idle) / (RADIAL.full - RADIAL.idle), 0, 1.2);
    const over = clamp(-s.trend / 0.4, 0, 1), surge = clamp(s.trend / 0.4, 0, 1);
    s.overrun = Math.max(over, s.overrun - dt / 0.6);
    // the lever closing takes the load off before the revs fall; opening it, the engine barks
    const load = dead ? 0 : clamp(power * (1 - 0.7 * over) + 0.3 * surge * (1 - power), 0, 1);
    const sound = rig.sound;

    this.set(rig.lowBank.playbackRate, Math.max(0.04, rpm / sound.referenceRPM), now, 0.03);
    this.set(rig.highBank.playbackRate, Math.max(0.02, rpm / sound.highReferenceRPM), now, 0.03);
    this.set(rig.clatter.playbackRate, Math.max(0.04, rpm / sound.referenceRPM), now, 0.03);
    const bank = ease(sound.referenceRPM, sound.highReferenceRPM, rpm);
    this.set(rig.lowLevel.gain, Math.cos(bank * Math.PI / 2), now, 0.04);
    this.set(rig.highLevel.gain, Math.sin(bank * Math.PI / 2), now, 0.04);
    this.set(rig.tone.frequency, 480 + rpm * (0.22 + 0.6 * load), now, 0.04);
    this.set(rig.exhaust.gain, (0.1 + 0.42 * Math.pow(load, 0.8) * (0.6 + 0.4 * rev)) * lit * miss, now, miss < 1 ? 0.012 : 0.03);
    this.set(rig.clatterBand.frequency, 1200 + rpm * 0.5, now, 0.08);
    this.set(rig.clatterLevel.gain, dead ? 0.22 * clamp(rpm / 350, 0, 1) : (0.3 + 0.4 * Math.pow(load, 0.8)) * lit * miss, now, 0.04);

    const pass = Math.max(0.5, rpm / 60 * 2);
    this.set(rig.blade.frequency, pass, now, 0.03);
    this.set(rig.bladeTwin.frequency, pass * 1.004 + 0.31, now, 0.03);
    this.set(rig.propTone.frequency, 140 + 1100 * Math.pow(power, 1.2) + V * 3 + 500 * clamp(rev - 1, 0, 0.2), now, 0.06);
    this.set(rig.prop.gain, dead ? 0.03 * clamp(rpm / 600, 0, 1) : 0.015 + 0.26 * Math.pow(power, 1.5) * (0.75 + 0.25 * rev), now, 0.05);
    const wash = dead ? 0.16 * clamp(rpm / 500, 0, 1) : 0.1 + 0.12 * power;
    this.set(rig.washBand.frequency, 500 + V * 6, now, 0.1);
    this.set(rig.wash.gain, wash, now, 0.06);
    this.set(rig.washDepth.gain, wash * 0.85, now, 0.06);

    // The wind dies away as the wing lets go: the pilot hears the stall coming before the nose drops
    const speed = clamp(V / top, 0, 1.6), dying = 1 - 0.55 * stall, seat = pov ? 1.35 : 1;
    this.set(rig.windBand.frequency, 380 + V * 11, now, 0.1);
    this.set(rig.wind.gain, 0.6 * speed * speed * dying * seat * (1 + 0.6 * f.slip), now, 0.1);
    // Wires whistle at a pitch set by the air's speed over them, a little sharper when the wings are loaded
    const tension = 1 + 0.025 * clamp(f.g - 1, -2, 7), waver = 1 + 0.012 * Math.sin(now * 2.3) * Math.sin(now * 0.71);
    this.set(rig.wireA.frequency, Math.max(60, V * 36 * tension * waver), now, 0.08);
    this.set(rig.wireB.frequency, Math.max(90, V * 52 * tension / waver), now, 0.08);
    this.set(rig.wires.gain, 0.55 * Math.pow(speed, 2.5) * dying * seat, now, 0.1);

    // (a sideslip throws the fuselage's dirty air over the tail)
    this.updateBed(rig, f, now, 0.75 * f.shake + (0.22 + 0.5 * f.slip) * speed * speed, 0.65 * f.shake + 0.3 * f.slip * speed, 5.5 + 3 * f.buffet);

    if (dead || now < this.popAt) return;
    if (s.overrun > 0.25 && rpm > 750) {
      // unburnt mixture lighting in the stacks as the throttle closes
      this.pop(rig, now, (0.25 + Math.random() * 0.4) * (0.45 + 0.55 * rev));
      this.popAt = now + 0.045 + Math.random() * 0.14 / (0.4 + s.overrun);
    } else if (power < 0.12 && V > 22 && !f.grounded) {
      // gliding on a closed throttle the propeller drives the engine, and it burbles and spits
      this.pop(rig, now, 0.1 + Math.random() * 0.18);
      this.popAt = now + 0.2 + Math.random() * 0.55;
    } else if (hurt > 0 && Math.random() < dt * 2.5 * hurt) {
      this.pop(rig, now, 0.3 + Math.random() * 0.4);
      this.popAt = now + 0.12;
    }
  }

  // ---- The jet -------------------------------------------------------------------------------------------------------

  buildJet(now) {
    const c = this.context, rig = this.begin('jet'), { air, low, out, engine } = rig;

    // Compressor: two partials a few hertz apart and a stage above them, climbing with the spool
    rig.whineA = this.oscillator(this.wave('whineA', [1], 1), WHINE.idle);
    rig.whineB = this.oscillator(this.wave('whineB', [1], 0.8), WHINE.idle * 1.006);
    rig.whineC = this.oscillator(this.wave('whineC', [1], 0.35), WHINE.idle * 2.02);
    rig.whine = this.gain();
    for (const o of [rig.whineA, rig.whineB, rig.whineC]) o.connect(rig.whine);
    rig.whine.connect(engine);

    // Jet: noise that opens up with the thrust, on a low body
    rig.hot = this.loop(this.resources.noise, 0.6);
    rig.roarLow = this.filter('lowpass', 300, 0.6);
    rig.roarBody = this.filter('peaking', 125, 0.8);
    rig.roarBody.gain.value = 7;
    rig.roar = this.gain();
    rig.hot.connect(rig.roarLow).connect(rig.roarBody).connect(rig.roar).connect(engine);
    // an unsteady flame: a slow random signal leaning on the levels, lightly dry, hard in reheat
    rig.flame = this.loop(this.resources.noise, 0.012);
    rig.roarDepth = this.gain();
    rig.flame.connect(rig.roarDepth).connect(rig.roar.gain);
    // and on the compressor's pitch, a few cents of it: blades in rough air are not pure tones
    rig.flutter = this.gain(22);
    rig.flame.connect(rig.flutter);
    for (const o of [rig.whineA, rig.whineB, rig.whineC]) rig.flutter.connect(o.detune);

    // Reheat: the low end first, and the tearing on top of it
    rig.burnLow = this.filter('lowpass', 130, 1.1);
    rig.burn = this.gain();
    low.connect(rig.burnLow).connect(rig.burn).connect(engine);
    rig.tearBand = this.filter('bandpass', 520, 0.5);
    const shaper = this.own(c.createWaveShaper());
    shaper.curve = this.curve('crackle', crackle);
    rig.tear = this.gain();
    rig.tearDepth = this.gain();
    rig.hot.connect(rig.tearBand).connect(shaper).connect(rig.tear).connect(engine);
    rig.flame.connect(rig.tearDepth).connect(rig.tear.gain);

    // The air: a thin hiss over the canopy, and the turbulence off the airbrake
    rig.windHigh = this.filter('highpass', 1400, 0.6);
    rig.wind = this.gain();
    air.connect(rig.windHigh).connect(rig.wind).connect(out);
    rig.brakeBand = this.filter('bandpass', 2100, 0.9);
    rig.brake = this.gain();
    air.connect(rig.brakeBand).connect(rig.brake).connect(out);

    // The cockpit's warning tone, straight to the bus: it must stay clean under a reheat
    rig.tone = this.oscillator('triangle', 640);
    rig.warning = this.gain();
    rig.tone.connect(rig.warning).connect(this.bus);

    this.bed(rig);
    return this.finish(rig, now);
  }

  updateJet(rig, a, f, now, dt) {
    const s = this.state, b = a.flight;
    const { V, mach, power, hurt, lit, pov, grounded } = f;
    const ab = unit(b.ab) * lit;
    const sick = hurt * Math.sin(now * 9.3) * Math.sin(now * 2.1);

    // a dead engine winds down through its idle note and out
    const pitch = WHINE.idle * Math.pow(WHINE.full / WHINE.idle, power) * (0.3 + 0.7 * lit) * (1 + 0.03 * sick);
    const ceiling = this.context.sampleRate * 0.45;
    this.set(rig.whineA.frequency, pitch, now, 0.04);
    this.set(rig.whineB.frequency, pitch * 1.006 + 4, now, 0.04);
    this.set(rig.whineC.frequency, Math.min(ceiling, pitch * 2.02 + 9), now, 0.04);
    // loudest in the middle of the range: at full power the jet covers it
    this.set(rig.whine.gain, (0.017 + 0.013 * 4 * power * (1 - power) + (grounded ? 0.008 : 0)) * lit, now, 0.06);

    const thrust = Math.pow(power, 1.4);
    const roar = (0.16 + 0.56 * thrust) * lit * (1 + 0.25 * sick);
    this.set(rig.roarLow.frequency, 300 + 2200 * Math.pow(power, 1.6), now, 0.08);
    this.set(rig.roar.gain, roar, now, 0.06);
    this.set(rig.roarDepth.gain, roar * (0.22 + 0.5 * ab + 0.4 * hurt), now, 0.08);
    this.set(rig.burnLow.frequency, 150 + 60 * ab, now, 0.1);
    this.set(rig.burn.gain, 2.4 * Math.pow(ab, 1.2), now, 0.05);
    const tear = 0.5 * ab;
    this.set(rig.tearBand.frequency, 320 + 160 * ab, now, 0.1);
    this.set(rig.tear.gain, tear, now, 0.05);
    this.set(rig.tearDepth.gain, tear * 0.8, now, 0.05);

    // Reheat lights with a thump and goes out with a sigh
    if (!s.reheat && ab > 0.15) { s.reheat = true; this.lightOff(rig, now); }
    else if (s.reheat && ab < 0.1) { s.reheat = false; this.sigh(rig, now); }

    const m = clamp(mach, 0, 1.3), seat = pov ? 1.25 : 1;
    this.set(rig.windHigh.frequency, 950 + 800 * m, now, 0.15);
    const pull = clamp((Math.abs(f.g) - 2.5) / 5, 0, 1) * clamp(V / 150, 0, 1);
    this.set(rig.wind.gain, (0.36 * m * m + 0.04 * m + 0.1 * pull) * (1 + 0.5 * f.slip) * seat, now, 0.1);
    const brake = unit(b.brake) * (grounded ? 0.4 : 1), q = clamp(V / 250, 0, 1.2);
    this.set(rig.brakeBand.frequency, 1700 + 900 * q, now, 0.1);
    this.set(rig.brake.gain, brake * (0.04 + 0.65 * q * q) * (0.8 + 0.2 * Math.sin(now * 47) * Math.sin(now * 13.3)) * seat, now, 0.05);

    // What shakes it: the stall and the transonic wall, the brake and the wheels in the airstream, hard g
    const gear = num(b.gear) * (grounded ? 0 : 1) * clamp(V / 110, 0, 1.3) ** 2;
    const shake = 1.6 * Math.min(f.shake, 0.8);
    const slip = f.slip * clamp(V / 200, 0, 1);
    this.updateBed(rig, f, now, shake + 0.3 * gear + 0.45 * brake * q * q + 0.8 * pull + 0.6 * slip + 0.1 * m * m,
      0.9 * shake + 0.2 * gear + 0.6 * pull + 0.4 * slip, 11 + 6 * f.buffet);

    // Cockpit warnings: low speed twice a second; the ground coming up, faster and higher
    const airborne = !grounded;
    const sink = -num(a.verticalSpeed, num(b.vy));
    const mode = airborne && num(b.agl, 1e3) < 60 && sink > 6 ? 2 : airborne && f.stall > 0.5 ? 1 : 0;
    // (it rides just above the engine, so it reads at idle and in reheat alike without ever shouting)
    this.warn(rig, now, mode, Math.min(0.18, ((mode === 2 ? 0.045 : 0.035) + 0.05 * power + 0.05 * ab) * (pov ? 1.5 : 1)));

    if (hurt > 0 && now >= this.popAt && Math.random() < dt * 1.2 * hurt) {
      // a damaged compressor surges
      this.pop(rig, now, 0.5 + Math.random() * 0.4, 0.7);
      this.popAt = now + 0.3;
    }
  }

  updateBed(rig, f, now, rumble, shake, beat) {
    this.set(rig.rumbleLow.frequency, 160 + 100 * clamp(shake, 0, 1), now, 0.1);
    this.set(rig.rumble.gain, rumble, now, 0.08);
    this.set(rig.shudder.frequency, beat, now, 0.2);
    this.set(rig.shudderDepth.gain, Math.min(shake, rumble) * 0.8, now, 0.08);
    // tyres: the weight on the wheels times the speed over the ground
    const roll = f.ground * Math.pow(clamp(f.groundSpeed / 30, 0, 1.6), 0.7);
    this.set(rig.tyreLow.frequency, 200 + f.groundSpeed * 9, now, 0.1);
    // a hull point on the ground (the belly, a wing tip, the tail): metal tearing, and the airframe drumming on it
    const metal = f.sliding ? clamp(f.groundSpeed / 25, 0, 1) : 0;
    this.set(rig.tyres.gain, 0.6 * roll + 0.5 * metal, now, 0.06);
    this.set(rig.scrapeBand.frequency, 2500 + 500 * Math.sin(now * 3.1), now, 0.1);
    this.set(rig.scrape.gain, metal * (0.55 + 0.3 * Math.sin(now * 73) ** 2), now, 0.03);
  }

  // One beep at a time, placed on the audio clock so a slow frame cannot stretch it
  warn(rig, now, mode, level) {
    if (!mode || now + 0.1 < this.beepAt) return;
    const at = Math.max(now + 0.005, this.beepAt);
    const pull = mode === 2, length = pull ? 0.085 : 0.17;
    this.beepFlip = !this.beepFlip;
    const g = rig.warning.gain;
    rig.tone.frequency.setValueAtTime(pull ? (this.beepFlip ? 1480 : 1175) : 640, at);
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(level, at + 0.008);
    g.setValueAtTime(level, at + length - 0.014);
    g.linearRampToValueAtTime(0, at + length);
    this.beepAt = at + (pull ? 0.2 : 0.5);
  }

  hush(rig, now) {
    if (!rig?.warning) return;
    halt(rig.warning.gain, now);
    rig.warning.gain.setTargetAtTime(0, now, 0.01);
    this.beepAt = now + 0.05;
  }

  // ---- Every frame -------------------------------------------------------------------------------------------------

  /**
   * `aircraft`: the entity being flown (it has `flight`), or null when nothing is: the voice fades in about 0.3 s.
   * `view`: 'chase' or 'pov'; in the cockpit the engine is duller and the air and the warnings closer.
   */
  update(aircraft, dt = 1 / 60, view = 'chase') {
    if (this.disposed) return;
    const now = this.context.currentTime;
    for (let i = this.retired.length - 1; i >= 0; i--) {
      if (now >= this.retired[i].dropAt) this.drop(this.retired.splice(i, 1)[0]);
    }
    const a = aircraft?.flight && !aircraft.crashed && !aircraft.destroyed ? aircraft : null;
    if (!a) {
      this.set(this.bus.gain, 0, now, 0.06);
      if (this.craft) { this.craft = null; this.restAt = now + REST; this.hush(this.rig, now); }
      if (this.rig && now >= this.restAt) { this.drop(this.rig); this.rig = null; }
      return;
    }
    dt = clamp(num(dt, 1 / 60), 0.001, 0.25);
    const b = a.flight, tune = b.tune ?? {}, kind = tune.engine === 'jet' ? 'jet' : 'prop';
    if (this.rig?.kind !== kind) {
      if (this.rig) {
        this.hush(this.rig, now);
        this.set(this.rig.out.gain, 0, now, 0.04);
        this.rig.dropAt = now + 0.35;
        this.retired.push(this.rig);
      }
      this.rig = kind === 'jet' ? this.buildJet(now) : this.buildProp(now);
    }
    const rig = this.rig, s = this.state;
    const dead = num(b.damage?.engine) >= 1;
    // the jet's spool is the flight model's own, so a dead one is heard winding down; a dead piston engine just stops
    const power = dead && kind === 'prop' ? 0 : unit(b.power);
    if (this.craft !== a) {
      // boarding: start from what the aircraft is doing, without the sounds of getting there
      this.craft = a;
      s.power = power; s.trend = 0; s.overrun = 0; s.lit = dead ? 0 : 1;
      s.reheat = unit(b.ab) > 0.15 && !dead;
      this.popAt = now + 0.3;
    }
    s.trend += ((power - s.power) / dt - s.trend) * (1 - Math.exp(-dt / 0.12));
    s.power = power;
    s.lit += ((dead ? 0 : 1) - s.lit) * (1 - Math.exp(-dt / (kind === 'jet' ? 0.45 : 0.2)));
    let load = 0, sliding = false;
    for (const w of b.wheels ?? []) if (w.load > 0) load += w.load;
    for (const p of b.hull ?? []) if (p.contact) sliding = true;
    const pov = view === 'pov';
    const f = this.frame ??= {};
    f.V = clamp(num(b.airspeed), 0, 700);
    f.mach = num(b.mach, f.V / 340);
    f.power = power; f.dead = dead; f.lit = s.lit; f.pov = pov;
    f.hurt = dead ? 0 : unit(b.damage?.engine);
    f.g = num(b.g, 1);
    f.slip = clamp(Math.abs(num(b.beta)) / 0.25, 0, 1) * (b.onGround ? 0 : 1); // flying sideways: the rudder is heard too
    f.buffet = unit(b.buffet);
    // the transonic wall only reaches a fifth of the scale and must still be felt: the ear gets the square root
    f.shake = Math.sqrt(f.buffet);
    f.stall = unit(b.stall);
    f.grounded = !!b.onGround;
    f.ground = clamp(load / ((tune.mass || 1000) * 9.81), 0, 1.5);
    f.groundSpeed = Math.hypot(num(b.vx), num(b.vz));
    f.sliding = sliding;

    this.heardUntil = now + 1.5;
    this.set(this.bus.gain, LEVEL, now, 0.04);
    this.set(rig.engine.gain, pov ? (kind === 'jet' ? -9 : -6) : 0, now, 0.12);
    if (kind === 'jet') this.updateJet(rig, a, f, now, dt);
    else this.updateProp(rig, a, f, now, dt);
  }

  // ---- One-shots: called by gameplay, heard only while an aircraft is being flown ----------------------------------

  // The audio clock, or -1 when a sound started now would be lost or late: nothing flown, or the context suspended
  ready() {
    if (this.disposed || this.context.state !== 'running') return -1;
    const now = this.context.currentTime;
    return now <= this.heardUntil ? now : -1;
  }

  // A sine with a falling pitch: the weight of a blow
  thud(to, at, level, from, down, length) {
    if (!(level > 0.0005)) return;
    const o = this.own(this.context.createOscillator(), true), g = this.gain();
    o.type = 'sine';
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(down, at + length * 0.7);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    o.connect(g).connect(to);
    o.start(at); o.stop(at + length + 0.02);
    o.onended = () => this.release(o, g);
    return g;
  }

  // Noise through one moving filter, with an attack and an exponential tail
  burst(to, at, { rate = 1, type = 'bandpass', from, down = from, glide = 0.1, q = 0.7, level, attack = 0.004, hold = 0, decay = 0.1 }) {
    if (!(level > 0.0005)) return;
    const s = this.own(this.context.createBufferSource(), true), f = this.filter(type, from, q), g = this.gain();
    s.buffer = this.resources.noise;
    s.loop = true;
    s.playbackRate.value = rate;
    if (down !== from) {
      f.frequency.setValueAtTime(from, at);
      f.frequency.exponentialRampToValueAtTime(down, at + glide);
    }
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + attack);
    if (hold > 0) g.gain.setValueAtTime(level, at + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + decay);
    s.connect(f).connect(g).connect(to);
    s.start(at, Math.random() * (s.buffer.duration || 0));
    s.stop(at + attack + hold + decay + 0.02);
    s.onended = () => this.release(s, f, g);
    return g;
  }

  // The exhaust spits: a short crack with some chest to it
  pop(rig, now, strength, pitch = 1) {
    this.burst(rig.engine, now, { rate: 0.7 + Math.random() * 0.5, from: (320 + Math.random() * 700) * pitch, q: 1.1,
      level: 0.55 * strength, attack: 0.002, decay: 0.045 + Math.random() * 0.06 });
  }

  lightOff(rig, now) {
    this.thud(rig.engine, now, 0.6, 62, 30, 0.42);
    this.burst(rig.engine, now, { rate: 0.5, type: 'lowpass', from: 700, down: 130, glide: 0.35, q: 0.8, level: 0.6, attack: 0.03, decay: 0.45 });
  }

  sigh(rig, now) {
    this.burst(rig.engine, now, { from: 950, down: 220, glide: 0.6, q: 0.7, level: 0.17, attack: 0.05, decay: 0.7 });
  }

  /** Wheels meeting the ground: `sink` in m/s (0.3 gentle, 7 brutal), `speed` over the ground in m/s. */
  touchdown(sink = 1, speed = 0) {
    const now = this.ready();
    if (now < 0 || now - this.lastTouch < 0.05) return false;
    this.lastTouch = now;
    const hit = Math.pow(clamp((num(sink, 1) - 0.1) / 6.5, 0.02, 1), 0.6), run = clamp(num(speed) / 60, 0, 1);
    const weight = Math.pow(hit, 1.2);
    this.thud(this.shots, now, 0.06 + 0.95 * weight, 135 - 30 * hit, 44, 0.16 + 0.22 * hit);
    // struts and airframe taking it
    this.burst(this.shots, now, { rate: 0.5, type: 'lowpass', from: 700 + 1100 * hit, down: 180, glide: 0.14, level: 0.04 + 0.65 * weight, decay: 0.12 + 0.25 * hit });
    // rubber spun up from standing: a chirp, longer and louder the faster the ground goes by
    if (speed > 8) {
      const level = (0.14 + 0.2 * run) * (0.6 + 0.4 * hit);
      this.burst(this.shots, now, { from: 1650, down: 1100, glide: 0.1, q: 3, level: level * 6, attack: 0.006, decay: 0.09 + 0.13 * run });
      const o = this.own(this.context.createOscillator(), true), g = this.gain(), end = now + 0.09 + 0.1 * run;
      o.type = 'triangle';
      o.frequency.setValueAtTime(1280 + Math.random() * 120, now);
      o.frequency.exponentialRampToValueAtTime(860, end);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(level * 0.5, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      o.connect(g).connect(this.shots);
      o.start(now); o.stop(end + 0.02);
      o.onended = () => this.release(o, g);
    }
    return true;
  }

  /** Metal meeting the ground or a wall, `intensity` 0..1: a blow, panels ringing, then the grinding. */
  crunch(intensity = 0.5) {
    const now = this.ready();
    if (now < 0 || now - this.lastCrunch < 0.07) return false;
    this.lastCrunch = now;
    const k = clamp(num(intensity, 0.5), 0.05, 1), c = this.context;
    this.thud(this.shots, now, 0.3 + 0.6 * k, 125, 42, 0.14 + 0.16 * k);
    // one noise through three ringing bands
    const s = this.own(c.createBufferSource(), true), g = this.gain(), ring = 0.16 + 0.34 * k;
    s.buffer = this.resources.noise;
    s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bands = [[310, 4], [1180, 7], [2730, 9]].map(([f, q]) => this.filter('bandpass', f * (0.88 + Math.random() * 0.24), q));
    for (const band of bands) s.connect(band).connect(g);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.5 + 1.1 * k, now + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, now + ring);
    g.connect(this.shots);
    s.start(now, Math.random() * (s.buffer.duration || 0));
    s.stop(now + ring + 0.02);
    s.onended = () => this.release(s, g, ...bands);
    this.burst(this.shots, now, { rate: 1.3, from: 3400, down: 2200, glide: 0.4, q: 1.5, level: 0.12 + 0.3 * k, attack: 0.02, decay: 0.3 + 0.5 * k });
    return true;
  }

  /** Ditching, `intensity` 0..1: the hull's slap, the sheet of water it throws, the spray falling back. */
  splash(intensity = 1) {
    const now = this.ready();
    if (now < 0 || now - this.lastSplash < 0.3) return false;
    this.lastSplash = now;
    const k = clamp(num(intensity, 1), 0.1, 1.5);
    this.thud(this.shots, now, 0.5 * k, 72, 30, 0.34);
    this.burst(this.shots, now, { rate: 0.8, type: 'lowpass', from: 2600, down: 350, glide: 0.9, q: 0.6, level: 0.55 * k, attack: 0.02, decay: 1.1 });
    this.burst(this.shots, now + 0.12, { rate: 1.3, type: 'highpass', from: 2400, down: 3800, glide: 1, q: 0.6, level: 0.16 * k, attack: 0.15, decay: 1.6 });
    return true;
  }

  /** The aircraft's own sonic boom from the chase camera: bow and tail shocks, then the rumble rolling away. */
  boom() {
    const now = this.ready();
    if (now < 0 || now - this.lastBoom < 1) return false;
    this.lastBoom = now;
    // everything else steps back for the bang
    const d = this.duck.gain, rest = 1 / HEADROOM;
    halt(d, now);
    if (!d.cancelAndHoldAtTime) d.setValueAtTime(rest, now);
    d.linearRampToValueAtTime(rest * 0.4, now + 0.02);
    d.setTargetAtTime(rest, now + 0.3, 0.35);
    for (const [after, level] of [[0, 1], [0.105, 0.8]]) {
      const at = now + after;
      this.thud(this.shots, at, 1.3 * level, 124, 38, 0.24);
      this.burst(this.shots, at, { type: 'lowpass', from: 3200, down: 380, glide: 0.07, q: 0.6, level: 1.3 * level, attack: 0.001, decay: 0.09 });
    }
    this.burst(this.shots, now + 0.13, { rate: 0.3, type: 'lowpass', from: 170, down: 58, glide: 2.4, q: 0.9, level: 1.5, attack: 0.1, decay: 2.6 });
    // and again off the city, later and duller
    this.burst(this.shots, now + 0.75, { rate: 0.25, type: 'lowpass', from: 120, down: 50, glide: 1.8, q: 0.9, level: 0.9, attack: 0.3, decay: 2.2 });
    return true;
  }

  /** The undercarriage lever: hydraulics for the length of the travel, then the locks. Calling again reverses it. */
  gear(down = true) {
    const now = this.ready();
    if (now < 0) return false;
    // a lever thrown back mid-travel: the first motion stops where it is
    if (this.gearShot && now < this.gearShot.until) {
      for (const g of this.gearShot.gains) { halt(g.gain, now); g.gain.setTargetAtTime(0, now, 0.015); }
    }
    const c = this.context, travel = clamp(num(this.craft?.flight?.tune?.gearTime) || 2.4, 0.8, 6), end = now + travel;
    const pitch = down ? 172 : 196;
    const o = this.own(c.createOscillator(), true), tone = this.filter('lowpass', 1500, 1.5), g = this.gain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(pitch * 0.55, now);
    o.frequency.exponentialRampToValueAtTime(pitch, now + 0.16);
    o.frequency.linearRampToValueAtTime(pitch * 0.94, end - 0.15);
    o.frequency.exponentialRampToValueAtTime(pitch * 0.6, end);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.15, now + 0.07);
    g.gain.setValueAtTime(0.15, end - 0.12);
    g.gain.linearRampToValueAtTime(0, end);
    o.connect(tone).connect(g).connect(this.shots);
    o.start(now); o.stop(end + 0.02);
    o.onended = () => this.release(o, tone, g);
    const gains = [g];
    const add = (gain) => { if (gain) gains.push(gain); };
    // fluid through the lines, and the doors in the airstream
    add(this.burst(this.shots, now, { rate: 1.2, from: 2600, q: 1.2, level: 0.09, attack: 0.07, hold: travel - 0.2, decay: 0.13 }));
    // the locks
    add(this.thud(this.shots, end, down ? 0.5 : 0.35, 135, 55, 0.1));
    add(this.burst(this.shots, end, { from: 1700, down: 900, glide: 0.05, q: 3, level: 0.5, attack: 0.002, decay: 0.06 }));
    if (down) add(this.burst(this.shots, end + 0.08, { from: 1450, down: 800, glide: 0.05, q: 3, level: 0.35, attack: 0.002, decay: 0.05 }));
    this.gearShot = { gains, until: end + 0.2 };
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.warm) globalThis.clearTimeout?.(this.warm);
    for (const source of this.sources) { source.onended = null; try { source.stop(); } catch { /* Already ended, or never started. */ } }
    for (const node of this.nodes) node.disconnect();
    this.nodes.clear(); this.sources.clear(); this.waves.clear(); this.curves.clear();
    this.retired.length = 0;
    this.rig = this.craft = this.gearShot = this.radial = null;
  }
}

export { FlightAudio };
