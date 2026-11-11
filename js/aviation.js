import * as THREE from 'three/webgpu';
import { placeAircraft, setGear, stepAircraft } from './flight.js';
import { aircraftPoint } from './aircraft.js';

// Flying, as the game lives it: the player's hands on the aircraft, what an aircraft left to itself does, and what its
// flight does to it and to the city: tyres chirp, a wing tip stays on a cornice, a gentle arrival on the river is a
// ditching, a low pass empties the sidewalk and a sonic boom sets off every car alarm under it.
// The flight model itself is flight.js; the pictures are flight-fx.js; the dials are flight-instruments.js.

const IDLE = { pitch: 0, roll: 0, yaw: 0, throttle: 0, boost: false, brake: false };
const _v = new THREE.Vector3(), _deck = { bottom: 0, top: 0 };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const axis = (plus, minus) => (plus ? Number(plus) : 0) - (minus ? Number(minus) : 0);

class Aviation {
  constructor(game, { fx = null, instruments = null } = {}) {
    this.game = game;
    this.fx = fx;
    this.instruments = instruments;
    this.input = { pitch: 0, roll: 0, yaw: 0, throttle: 0, boost: false, brake: false };
    this.smoke = false; // the classic's display smoke
    this.reactT = 0;
    this.lowPass = 0;
    this.airT = 0; // seconds since the wheels left the ground
    this.loop = { pitch: 0, roll: 0, last: null };
    // what g does to the pilot: sight greying out under a long hard pull, reddening hanging in the straps, and a
    // blackout (the stick let go for a moment) for whoever insists
    this.grey = 0; this.red = 0; this.blackout = 0;
    // what an aircraft can touch is the controllers' (flightWorld); the weather's wind blows through it at half strength
    this.env = game.controllers.flightWorld;
    this.env.wind = (x, y, z, out) => {
      const wind = game.vertical?.wind;
      if (!wind) { out.x = out.y = out.z = 0; return out; }
      wind.at(x, y, z, out);
      // half the weather's wind up high, a sixth of it down among the buildings, which shelter the streets
      const k = 0.16 + 0.34 * Math.min(1, Math.max(0, (y - 15) / 110));
      out.x *= k; out.z *= k;
      return out;
    };
  }

  get craft() { return this.game.controllers.aircraft; }

  // The aircraft the player is flying, or null
  get piloted() {
    const g = this.game;
    return g.state === 'driving' && g.car.flight ? g.car : null;
  }

  airborne(a) { return !!a?.flight && !a.flight.onGround && a.flight.agl > 2.5; }

  // ---- The player's hands (called from the controllers, before the camera) ------------------------------------------
  fly(dt) {
    const g = this.game, a = g.car;
    if (!a?.flight || !(dt > 0)) return;
    const k = g.controllers.keys, i = this.input;
    i.pitch = axis(k.backward, k.forward);
    i.roll = axis(k.left, k.right);
    i.yaw = axis(k.yawLeft, k.yawRight);
    i.throttle = axis(k.up, k.lever);
    i.boost = !!k.sprint;
    i.brake = !!k.handbrake;
    if (this.blackout > 0) { this.blackout -= dt; i.pitch = i.roll = i.yaw = 0; }
    this.step(a, i, dt, true);
  }

  // Left alone, an aircraft flies on with its throttle shut until it lands itself or hits something
  drift(a, dt) {
    const b = a.flight;
    if (a.destroyed) return;
    if (b.onGround && b.airspeed < 0.3 && b.throttle < 0.02) return;
    this.step(a, IDLE, dt, false);
  }

  step(a, input, dt, piloted) {
    const g = this.game, b = a.flight, env = this.env;
    // rough air: the weather's gusts, and what the wind does among the buildings
    const wind = g.vertical?.wind;
    const among = b.agl < 220 && !g.controllers.overWater(a.position.x, a.position.z) ? 0.8 : 0;
    env.gust = wind ? wind.base * wind.gust * 0.45 + among * Math.min(1, wind.base / 5) : 0;
    // a dead engine: out of hit points, the aircraft is a glider on fire
    if (a.hp !== undefined) b.damage.engine = a.hp <= 0 ? 1 : a.hp < 30 ? Math.max(b.damage.engine, 0.5) : b.damage.engine;
    stepAircraft(a, input, dt, env);
    this.events(a, piloted, dt);
  }

  // What the flight model reported this frame
  events(a, piloted, dt) {
    const g = this.game, b = a.flight;
    for (const e of b.events) {
      switch (e.type) {
        case 'touchdown': {
          this.fx?.touchdown(a, e);
          if (piloted && e.sink > 2.5) g.camera.addShake(Math.min(0.9, e.sink * 0.1));
          g.audio.flight?.touchdown(e.sink, e.speed);
          if (e.sink > 4.5) g.damageCar(a, (e.sink - 4.5) * 8, 'crash');
          break;
        }
        case 'gearCollapse': {
          g.damageCar(a, 30, 'crash');
          if (piloted) { g.camera.addShake(1); g.toast('Train arraché', 'Posé trop dur : elle finit sur le ventre.'); }
          g.audio.flight?.crunch(1);
          break;
        }
        case 'scrape': {
          this.fx?.scrape(a, e);
          if (e.first) {
            g.damageCar(a, clamp(e.hit * 3 + e.speed * 0.12, 1, 40), 'crash');
            if (piloted) g.camera.addShake(Math.min(1, 0.25 + e.hit * 0.1));
            g.audio.flight?.crunch(Math.min(1, 0.3 + e.hit * 0.12));
            if (e.kind === 'prop') { b.damage.engine = Math.max(b.damage.engine, 0.6); if (piloted) g.toast('Hélice touchée', 'Le moteur a perdu de sa puissance.'); }
          } else g.damageCar(a, e.speed * (e.dt || 0) * 0.35, 'crash');
          break;
        }
        case 'strike': {
          this.fx?.strike(a, e);
          g.damageCar(a, 45, 'crash');
          g.audio.flight?.crunch(1);
          if (piloted) {
            g.camera.addShake(1.3);
            g.toast('Bout d’aile arraché', 'Elle vole encore, de travers. Posez-vous.');
            g.stunts?.crashed();
          }
          break;
        }
        case 'bump': {
          if (e.closing > 3) { g.damageCar(a, (e.closing - 3) * 5, 'crash'); g.audio.flight?.crunch(Math.min(1, e.closing / 14)); this.fx?.scrape(a, { ...e, first: true }); }
          if (piloted) g.camera.addShake(Math.min(1, 0.2 + e.closing * 0.06));
          break;
        }
        case 'wreck': {
          // run into something at a roll: the aircraft is finished (and will burn), whoever is in it is shaken
          this.fx?.strike(a, e);
          g.damageCar(a, 200, 'crash');
          g.audio.flight?.crunch(1);
          if (piloted) {
            g.camera.addShake(1.4);
            g.damagePlayer(clamp((e.closing - 6) * 2.2, 5, 60), 'crash');
            g.stunts?.crashed();
          }
          break;
        }
        case 'ditch': {
          this.fx?.splash(a, e, 1.6);
          g.audio.flight?.splash(1);
          if (piloted) {
            g.camera.addShake(1.1);
            g.toast('Amerrissage', 'Tout le monde est entier. F pour quitter l’appareil.');
            if (e.speed > 20) g.stunts?.award('MIRACLE SUR L’HUDSON', 2500, 'Amerrissage réussi');
          }
          a.sinkT = 45;
          break;
        }
        case 'wake': this.fx?.wake(a, e); break;
        case 'boom': this.boom(a, piloted); break;
        case 'gearUp': case 'gearDown': g.audio.flight?.gear(e.type === 'gearDown'); break;
        case 'landed': if (piloted) this.landed(a, e); break;
        case 'airborne': if (piloted) { this.airT = 0; this.loop.pitch = this.loop.roll = 0; } break;
        case 'crash': a.crashCause = e.cause; break;
      }
    }
  }

  // Through Mach 1: the bang arrives on the city under it
  boom(a, piloted) {
    const g = this.game, p = a.position;
    this.fx?.boom(a);
    g.audio.flight?.boom();
    if (piloted) {
      g.camera.addShake(0.9);
      g.stunts?.award('MUR DU SON', 1500, 'Mach 1');
    }
    if (a.flight.agl < 900) {
      g.birds?.scatter(p.x, p.z, 400);
      g.traffic.pedestrians.panic(p.x, p.z, 220, 10);
      this.alarms(p.x, p.z, 260, 6);
    }
  }

  landed(a, e) {
    const g = this.game;
    if (this.airT < 8) return;
    const roof = a.flight.groundY > 6;
    const worst = this.worstSink ?? 0;
    const title = roof ? 'POSÉ SUR UN TOIT' : worst < 1.2 ? 'ATTERRISSAGE DE VELOURS' : 'ATTERRISSAGE';
    g.stunts?.award(title, roof ? 3000 : worst < 1.2 ? 1200 : 400, `${Math.round(e.speed * 3.6)} km/h au toucher`);
    this.airT = 0;
  }

  // ---- Every frame, after the physics: pictures, dials, the city's reactions, the pilot's stunts --------------------
  update(dt) {
    const g = this.game, a = this.piloted;
    for (const craft of Object.values(this.craft)) {
      if (craft !== a) craft.inside = false;
      if (craft.sinkT > 0 && craft.flight.ditched) {
        // a ditched aircraft floats for a while, then goes down by the nose
        craft.sinkT -= dt;
        if (craft.sinkT < 12) craft.position.y -= dt * 0.25;
        if (craft.sinkT <= 0 && craft !== a) { craft.flight.ditched = false; g.removeFleetCar(craft); }
      }
    }
    this.fx?.update(dt, this, g);
    this.instruments?.update(a, dt, this);
    this.pilot(a, dt);
    if (!a || !(dt > 0)) { this.lowPass = 0; return; }
    const b = a.flight, p = a.position;
    if (!b.onGround) this.airT += dt;
    for (const e of b.events) if (e.type === 'touchdown') this.worstSink = Math.max(this.airT > 1 ? 0 : this.worstSink ?? 0, e.sink);

    // The city under a low pass
    this.reactT -= dt;
    const low = !b.onGround && b.agl < 75 && b.airspeed > 35;
    if (low && this.reactT <= 0) {
      this.reactT = 0.35;
      const loud = b.tune.engine === 'jet' ? 1 + b.ab : 0.6;
      g.birds?.scatter(p.x, p.z, 60 * loud);
      if (b.agl < 40) g.traffic.pedestrians.panic(p.x, p.z, 22 * loud, 6);
      if (b.ab > 0.5 && b.agl < 60 && Math.random() < 0.5) this.alarms(p.x, p.z, 45, 1);
    }
    // On short final over a street, or rolling fast along one: the drivers ahead see it coming and get out of the way
    this.clearT = (this.clearT ?? 0) - dt;
    if (this.clearT <= 0 && b.agl < 28 && b.airspeed > 14 && !g.controllers.overWater(p.x, p.z)) {
      this.clearT = 0.5;
      const flat = Math.hypot(b.vx, b.vz) || 1, ux = b.vx / flat, uz = b.vz / flat;
      for (const ahead of [50, 120, 200]) g.traffic.flee(p.x + ux * ahead, p.z + uz * ahead, 34, 3);
    }
    this.stunts(a, dt, low);
  }

  // The pilot's eyes under g, drawn by the colour grade (post-processing.js `strain`)
  pilot(a, dt) {
    const g = this.game, strain = g.atmosphere?.grade?.strain;
    const load = a ? a.flight.gSmooth : 1;
    if (dt > 0) {
      this.grey = clamp(this.grey + (load > 5.2 ? (load - 5.2) * 0.1 : load > 4.2 ? -0.12 : -0.5) * dt, 0, 1);
      this.red = clamp(this.red + (load < -1 ? (-load - 1) * 0.4 : -0.9) * dt, 0, 1);
      if (a && this.grey >= 0.98 && this.blackout <= 0) {
        this.blackout = 1.6;
        g.toast('Voile noir', 'Trop de g, trop longtemps : le manche vous échappe un instant.');
      }
    }
    if (!a) this.grey = this.red = this.blackout = 0;
    if (strain) strain.value.set(this.grey ** 1.5, this.red);
  }

  // Aerobatics and nerve, paid like the car's stunts
  stunts(a, dt, low) {
    const g = this.game, b = a.flight, s = this.loop;
    if (b.onGround || !g.stunts) { s.last = null; return; }
    // whole turns about the pitch and roll axes, counted from the body's own rates
    s.pitch += -b.wx * dt; s.roll += b.wz * dt;
    if (Math.abs(b.wx) < 0.25) s.pitch *= Math.exp(-dt * 0.8);
    if (Math.abs(b.wz) < 0.4) s.roll *= Math.exp(-dt * 1.5);
    if (Math.abs(s.pitch) > Math.PI * 1.9) { s.pitch = 0; g.stunts.award('LOOPING', 800, 'Boucle complète'); }
    if (Math.abs(s.roll) > Math.PI * 1.9) { s.roll = 0; g.stunts.award('TONNEAU', 400, 'Tour complet'); }
    // rooftop height or lower, fast, for a while
    if (low && b.agl < 45 && this.streetCanyon(a)) {
      this.lowPass += dt;
      if (this.lowPass > 4) { this.lowPass = 0; g.stunts.award('RASE-MOTTES', 600 + Math.round(b.airspeed * 4), 'Entre les immeubles'); }
    } else this.lowPass = Math.max(0, this.lowPass - dt * 2);
    // under a bridge, a skyway, anything with daylight beneath it: paid on coming out the other side
    const deck = this.overhead(a);
    if (deck) s.under = deck;
    else if (s.under) {
      if (g.clock - (s.underAt ?? -99) > 5) { s.underAt = g.clock; g.stunts.award('SOUS LE PONT', 1500 + Math.round(b.airspeed * 6), `${Math.round(b.airspeed * 3.6)} km/h sous le tablier`); }
      s.under = null;
    }
    // upside down near the ground
    if (b.r[4] < -0.7 && b.agl < 120) {
      s.inverted = (s.inverted || 0) + dt;
      if (s.inverted > 3) { s.inverted = -6; g.stunts.award('VOL DOS', 700, 'Sur le dos, au ras des toits'); }
    } else if (s.inverted > 0) s.inverted = 0;
    else if (s.inverted < 0) s.inverted = Math.min(0, s.inverted + dt);
  }

  // Car alarms set off in the streets around (x, z): the city's own voice answering the noise (audio-ambience.js)
  alarms(x, z, radius, count) {
    const audio = this.game.audio;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * radius;
      audio.ambienceEvent?.('alarm', x + Math.cos(a) * d, 0.8, z + Math.sin(a) * d);
    }
  }

  // Something solid right above the aircraft with air between: a bridge deck, a skyway, an overhang
  overhead(a) {
    const c = this.game.controllers, p = a.position;
    if (c.bridgeDeckAt?.(p.x, p.z, _deck) && _deck.bottom > p.y + 1) return _deck;
    for (const col of c.nearColliders(p.x, p.z, 2)) {
      const floor = col.minY ?? 0;
      if (floor > p.y + 1.5 && floor < p.y + 60 && p.x > col.minX && p.x < col.maxX && p.z > col.minZ && p.z < col.maxZ) return col;
    }
    return null;
  }

  // Walls on both sides, higher than the aircraft: it is flying down a street
  streetCanyon(a) {
    const c = this.game.controllers, p = a.position, r = a.flight.r;
    let left = false, right = false;
    for (const col of c.nearColliders(p.x, p.z, 60)) {
      if (col.round || !(col.maxY > p.y + 4)) continue;
      const dx = (col.minX + col.maxX) / 2 - p.x, dz = (col.minZ + col.maxZ) / 2 - p.z;
      const side = dx * r[0] + dz * r[2];
      if (side > 6) left = true; else if (side < -6) right = true;
      if (left && right) return true;
    }
    return false;
  }

  // ---- Controls that are single presses -----------------------------------------------------------------------------
  toggleGear() {
    const a = this.piloted;
    if (!a) return false;
    const b = a.flight;
    if (!b.tune.gearTime) return this.toggleSmoke();
    if (!setGear(a, b.gearTarget ? 0 : 1)) { if (b.onGround) this.game.toast('Train sorti', 'Il se range tout seul après le décollage.'); return false; }
    this.game.hud?.say?.(b.gearTarget ? 'Train sorti' : 'Train rentré');
    return true;
  }

  toggleSmoke() {
    const a = this.piloted;
    if (!a) return false;
    this.smoke = !this.smoke;
    this.game.audio.ui?.('pass');
    return true;
  }

  // ---- The garage ---------------------------------------------------------------------------------------------------
  // Puts an aircraft in the air at (x, y, z), flying at a comfortable speed, or on its wheels when `ground` is set
  launch(a, { x, y, z, heading, speed = 0, ground = false }) {
    const t = a.flight.tune;
    a.destroyed = false; a.crashed = false; a.sinkT = 0;
    // (on its wheels: on whatever surface is really there, a park lawn stands a good metre above the street)
    if (ground) placeAircraft(a, { x, y: this.env.ground(x, z, (y ?? 0) + 4), z, heading, speed: 0, throttle: 0, onGround: true });
    // whatever the player was doing a moment ago, the aircraft arrives at a speed it flies well at
    else placeAircraft(a, { x, y, z, heading, speed: clamp(speed, t.vStall * (t.engine === 'jet' ? 2.7 : 2.1), a.drive.speed * (t.engine === 'jet' ? 0.6 : 0.85)), throttle: 0.75 });
    this.airT = ground ? 0 : 9;
    this.smoke = false;
    this.loop.pitch = this.loop.roll = 0;
    return a;
  }

  // Where the pilot's seat is, for whoever needs to stand the hero there
  seat(a, out = _v) { return aircraftPoint(a, a.eye[0], a.eye[1] - 0.6, a.eye[2], out); }
}

export { Aviation, IDLE };
