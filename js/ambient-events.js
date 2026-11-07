import * as THREE from 'three/webgpu';
import { PROP } from './pedestrians.js';

// Small stories the street tells on its own, staged near the player every minute or two, never the same one twice in
// a row, built from the systems that already exist (traffic stops, pedestrians' activities, actors, hydrant jets,
// the street's props): a fender-bender with two drivers arguing in the road and the traffic honking behind them;
// a police stop, the officer at the driver's window with the cruiser behind; an open hydrant flooding the gutter
// with a few onlookers; the garbage truck doing its round at night, the crew throwing the bags in; and the crowd
// that turns round, phones out, when the player crashes.

const EVENTS = ['fenderBender', 'policeStop', 'hydrant', 'garbage'];

/**
 * @param {object} o
 * @param {object} o.game - gameplay (Playground): jets, actors, makeCar, removeFleetCar, player
 * @param {object} o.traffic - traffic system (cars, requestStop, clock)
 * @param {object} o.pedestrians - pedestrian system (peds, placeAt)
 * @param {object} o.streetLife - street-life (gather)
 * @param {object} o.streetDetails - obstacles (hydrants, trash bags), removeProp, trashPiles
 * @param {() => number} o.hourOf
 */
function createAmbientEvents({ game, traffic, pedestrians, streetLife, streetDetails, hourOf = () => 12 }) {
  const peds = pedestrians.peds;
  let clock = 0;
  let nextAt = 45; // the first one a little after the player enters the city
  let last = null;
  const active = [];
  const counts = { fenderBender: 0, policeStop: 0, hydrant: 0, garbage: 0, gathered: 0 };
  const hydrants = (streetDetails.obstacles || []).filter((c) => c.obstacle === 'hydrant' && c.breakable);
  const bags = (streetDetails.obstacles || []).filter((c) => c.obstacle === 'trashbag');
  let camera = null;

  const dist = (x, z) => Math.hypot(x - camera.position.x, z - camera.position.z);
  const localPoint = (v, lx, lz) => ({ x: v.x + Math.cos(v.yaw) * lx + Math.sin(v.yaw) * lz, z: v.z - Math.sin(v.yaw) * lx + Math.cos(v.yaw) * lz });
  // A pedestrian from the pool standing at (x, z), held there facing `heading`, looking at `look`, gone afterwards
  function standIn(x, z, heading, duration, { look = null, carry = undefined } = {}) {
    const p = peds.find((q) => !q.placed);
    if (!p || !pedestrians.placeAt(p, x, z, 14)) return null;
    p.activity = { kind: 'event', phase: 'hold', x, z, heading, moveHeading: heading, look, carry, duration, until: clock + duration, leave: 'vanish' };
    return p;
  }
  const release = (p) => { if (p?.activity) { p.activity.release = true; p.activity.leave = 'vanish'; } };

  // A civilian car in view, 40 to 120 m off, on a straight run, with room behind it
  function pickCar(filter = () => true) {
    const candidates = [];
    for (const v of traffic.cars) {
      if (!v.edge || v.conn || v.isPolice || v.stopAt >= 0 || v.speed < 2 || !filter(v)) continue;
      const d = dist(v.x, v.z);
      if (d < 40 || d > 120 || v.edge.len - v.s - v.half < 30 || v.s < 10) continue;
      candidates.push(v);
    }
    return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
  }

  // ---- 1. Fender-bender: the car ahead stops dead, the one behind nudges it; both drivers get out and have it out ----
  function fenderBender() {
    const v = pickCar((c) => !c.bus && c.bodyType !== 'truck');
    if (!v) return false;
    const occ = v.edge.occ?.[v.lane] || [];
    let follower = null;
    for (const o of occ) if (o.v !== v && o.s < v.s && v.s - o.s < 22 && (!follower || o.s > follower.s)) follower = o.v;
    if (!traffic.requestStop(v, 48)) return false;
    const ev = { kind: 'fenderBender', v, follower, serial: v.serial, t: 0, peds: [], phase: 0 };
    if (follower) { follower.stopAt = Math.max(follower.s + 1, v.stopAt - v.half - follower.half - 0.6); follower.dwell = 44; follower.hazard = true; follower.serving = 'crash'; }
    active.push(ev);
    counts.fenderBender++;
    return true;
  }
  function stepFenderBender(ev, dt) {
    ev.t += dt;
    const v = ev.v;
    if (!v.edge || v.serial !== ev.serial || v.stopAt < 0) return false;
    if (ev.phase === 0 && ev.t > 3 && v.speed < 0.3) {
      ev.phase = 1;
      // the drivers meet at the rear bumper of the first car, driver's side
      const a = localPoint(v, 1.6, -v.half - 0.4), b = localPoint(v, 1.6, -v.half - 1.9);
      const pa = standIn(a.x, a.z, Math.atan2(b.x - a.x, b.z - a.z), 40, { look: b });
      const pb = standIn(b.x, b.z, Math.atan2(a.x - b.x, a.z - b.z), 40, { look: a });
      ev.peds = [pa, pb].filter(Boolean);
      if (streetLife?.gather) counts.gathered += streetLife.gather(v.x, v.z, 3, 25, 18);
    }
    if (ev.t > 44) { for (const p of ev.peds) release(p); return false; }
    return true;
  }

  // ---- 2. Police stop: a car pulled over, the cruiser behind with its livery, the officer at the window --------------
  function policeStop() {
    const v = pickCar((c) => !c.bus && c.lane === c.edge.lanes.length - 1);
    if (!v || !game.makeCar || !game.actors?.spawn) return false;
    if (!traffic.requestStop(v, 52)) return false;
    active.push({ kind: 'policeStop', v, serial: v.serial, t: 0, phase: 0, cop: null, cruiser: null });
    counts.policeStop++;
    return true;
  }
  function stepPoliceStop(ev, dt) {
    ev.t += dt;
    const v = ev.v;
    const over = !v.edge || v.serial !== ev.serial || v.stopAt < 0 || ev.t > 50;
    if (!over && ev.phase === 0 && ev.t > 3 && v.speed < 0.3) {
      ev.phase = 1;
      // the cruiser 7 m behind, in the lane
      const back = localPoint(v, 0, -v.half - 6.5);
      const cruiser = game.makeCar('sedan', 0xf4f6f8, new THREE.Vector3(back.x, 0, back.z), v.yaw, false, true);
      if (cruiser) {
        cruiser.police = true;
        cruiser.locked = true;
        cruiser.eventCar = true;
        const state = cruiser.bodyMesh?.geometry?.attributes?.carState;
        if (state) { state.setW(0, 1); state.needsUpdate = true; } // the NYPD livery of the shared material
        ev.cruiser = cruiser;
      }
      const at = localPoint(v, 1.9, 0.6);
      ev.cop = game.actors.spawn({ x: at.x, z: at.z, heading: v.yaw + Math.PI / 2, look: 'cop', team: 'police', behavior: 'idle', hostile: false, alert: false, name: 'patrol' });
      if (ev.cop) ev.cop.rig.lookAt?.(v.x, v.z);
    }
    if (over) {
      if (ev.cop && !ev.cop.dead) game.actors.remove(ev.cop);
      if (ev.cruiser) game.removeFleetCar(ev.cruiser);
      return false;
    }
    return true;
  }

  // ---- 3. An open hydrant in the heat of the day, a few onlookers ------------------------------------------------------
  function hydrant() {
    const hour = hourOf();
    if (hour < 10 || hour > 19) return false;
    const near = hydrants.filter((h) => h.breakable && h.maxY > 0 && dist(h.cx, h.cz) > 25 && dist(h.cx, h.cz) < 70);
    if (!near.length) return false;
    const h = near[Math.floor(Math.random() * near.length)];
    game.jets.push({ x: h.cx, y: 0.3, z: h.cz, life: 75 });
    if (streetLife?.gather) counts.gathered += streetLife.gather(h.cx, h.cz, 3, 30, 14);
    active.push({ kind: 'hydrant', t: 0 });
    counts.hydrant++;
    return true;
  }

  // ---- 4. The garbage truck on its night round: stops by the piles, the crew throws the bags in -----------------------
  function garbage() {
    const hour = hourOf();
    if (!(hour >= 21.5 || hour < 5.5)) return false;
    const v = pickCar((c) => c.bodyType === 'truck' || c.bodyType === 'van');
    if (!v) return false;
    // bags along its curb ahead
    const ahead = bags.filter((b) => b.maxY > 0 && Math.hypot(b.cx - v.x, b.cz - v.z) < 40 && (b.cx - v.x) * v.tx + (b.cz - v.z) * v.tz > 4);
    if (ahead.length < 2) return false;
    const target = ahead[0];
    const s = v.s + (target.cx - v.x) * v.tx + (target.cz - v.z) * v.tz - 2;
    if (s > v.edge.len - v.half - 4) return false;
    v.stopAt = s; v.dwell = 14; v.hazard = true; v.serving = 'garbage';
    active.push({ kind: 'garbage', v, serial: v.serial, t: 0, phase: 0, peds: [], bags: ahead.slice(0, 6) });
    counts.garbage++;
    return true;
  }
  function stepGarbage(ev, dt) {
    ev.t += dt;
    const v = ev.v;
    if (!v.edge || v.serial !== ev.serial || v.stopAt < 0 || ev.t > 20) { for (const p of ev.peds) release(p); return false; }
    if (ev.phase === 0 && v.speed < 0.3 && Math.abs(v.s - v.stopAt) < 2.5) {
      ev.phase = 1;
      for (const side of [-1, 1]) {
        const q = localPoint(v, side * 1.5, -v.half - 1.2);
        const p = standIn(q.x, q.z, v.yaw, 12, { carry: PROP.BAG });
        if (p) ev.peds.push(p);
      }
      ev.bagsAt = ev.t + 4;
    }
    if (ev.phase === 1 && ev.t > ev.bagsAt) {
      ev.phase = 2;
      for (const b of ev.bags) if (b.maxY > 0) streetDetails.removeProp(b);
    }
    return true;
  }

  const runners = { fenderBender: stepFenderBender, policeStop: stepPoliceStop, garbage: stepGarbage, hydrant: (ev, dt) => (ev.t += dt) < 60 };
  const starters = { fenderBender, policeStop, hydrant, garbage };

  function trigger(kind) {
    if (!camera || !starters[kind]) return false;
    const ok = starters[kind]();
    if (ok) last = kind;
    return ok;
  }

  // The player's own crashes draw a crowd
  let gatherAt = -Infinity;
  function onCollision(e) {
    if (!streetLife?.gather || !game.car) return;
    const player = game.car;
    if ((e.a !== player && e.b !== player) || !(e.speed > 9) || clock - gatherAt < 25) return;
    gatherAt = clock;
    setTimeout(() => { counts.gathered += streetLife.gather(e.x, e.z, 5, 20, 18); }, 1200);
  }

  function update(dt, cam) {
    camera = cam;
    clock += dt;
    for (let i = active.length - 1; i >= 0; i--) {
      const ev = active[i];
      if (!runners[ev.kind](ev, dt)) active.splice(i, 1);
    }
    if (clock < nextAt || active.length >= 2) return;
    nextAt = clock + 70 + Math.random() * 80;
    // never the same story twice in a row; a few tries at what the moment allows
    const choices = EVENTS.filter((k) => k !== last);
    for (let i = 0; i < 3; i++) {
      const kind = choices[Math.floor(Math.random() * choices.length)];
      if (trigger(kind)) break;
    }
  }

  return { update, onCollision, trigger, active, counts };
}

export { createAmbientEvents, EVENTS as AMBIENT_EVENTS };
