import { getLocationLabel } from './city-config.js';
import { buildReproLink } from './repro-link.js';

// The Architect's senses: the faults a machine can see without eyes. Script errors, a body stuck or sunk into the
// ground, positions gone NaN, frames that stall and stretches of low frame rate. Every event carries where it happened
// (street corner and coordinates) and a link that puts anyone back there. The same fault in the same spot within a
// minute and a half counts up instead of filling the log. Installed only while the Architect is in the world.

const LOG_SIZE = 200;
const SAME_SPOT = 30; // metres: one event per kind and place
const SAME_TIME = 90; // seconds
const HITCH_MS = 150;
const LOW_FPS = 24;
const LOW_FPS_WINDOW = 4; // seconds of frames averaged
const SINK_DEPTH = 0.12; // metres under the ground the game itself computes
const SINK_TIME = 0.4;

const TITLES = {
  erreur: 'Erreur JavaScript',
  coince: 'Coincé',
  enfonce: 'Enfoncé dans le sol',
  nan: 'Position invalide (NaN)',
  saccade: 'Saccade',
  fps: 'Images par seconde basses',
  'sous-sol': 'Véhicule sous le sol',
  accident: 'Accident',
  retournement: 'Véhicule retourné'
};

class ArchitectSenses {
  /**
   * @param {Game} game
   * @param {Function} focus - () => { x, y, z, yaw }: where an event with no place of its own happened (the body watched)
   */
  constructor(game, focus) {
    this.game = game;
    this.focus = focus;
    this.events = [];
    this.listeners = new Set();
    this.serial = 0;
    this.active = false;
    this.quietUntil = 0;
    this.lastFrame = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.sinkT = new Map();
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.lastFrame = 0;
    this.onError = (e) => this.report('erreur', { detail: describeError(e.error ?? e.message), who: 'jeu' });
    this.onRejection = (e) => this.report('erreur', { detail: describeError(e.reason), who: 'jeu' });
    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onRejection);
    const original = console.error;
    this.consoleError = original;
    console.error = (...args) => {
      original.apply(console, args);
      if (this.reporting) return;
      this.report('erreur', { detail: args.map(describeError).join(' ').slice(0, 300), who: 'console' });
    };
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('error', this.onError);
    window.removeEventListener('unhandledrejection', this.onRejection);
    console.error = this.consoleError;
  }

  // The frame that just read a photo back is slow on purpose: it is not measured
  skipFrame() { this.lastFrame = 0; }

  // A few seconds where stalls are expected (a teleport, the camera cutting to another body)
  quiet(seconds = 3) { this.quietUntil = performance.now() + seconds * 1000; }

  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  /**
   * @param {string} kind - a key of TITLES
   * @param {object} o - x, y, z (defaults to the body being watched), who (joueur / architecte / jeu), detail, yaw
   */
  report(kind, { x, y, z, who = '', detail = '', yaw } = {}) {
    if (!this.active) return null;
    this.reporting = true;
    try {
      const g = this.game;
      const f = this.focus();
      x ??= f.x; y ??= f.y; z ??= f.z;
      const clock = g.clock;
      const same = this.events.find((e) => e.kind === kind && e.who === who && clock - e.last < SAME_TIME && Math.hypot(e.x - x, e.z - z) < SAME_SPOT);
      if (same) {
        same.count++;
        same.last = clock;
        if (detail) same.detail = detail;
        for (const l of this.listeners) l(same, false);
        return same;
      }
      const event = {
        id: ++this.serial, kind, title: TITLES[kind] || kind, who, detail, count: 1,
        x, y, z, t: clock, last: clock, at: new Date().toISOString(),
        address: safeLabel(x, z),
        link: buildReproLink({ x, y, z, yaw: yaw ?? g.camera.footYaw ?? 0, pitch: g.camera.orbitPitchOffset ?? 0, hour: g.atmosphere?.hour, weather: g.atmosphere?.weather }, location.href)
      };
      this.events.push(event);
      if (this.events.length > LOG_SIZE) this.events.shift();
      for (const l of this.listeners) l(event, true);
      return event;
    } finally {
      this.reporting = false;
    }
  }

  // Once a frame while active. `bodies`: [{ who, x, y, z, ground }] the Architect wants watched besides the player
  update(dt, bodies = []) {
    if (!this.active) return;
    const g = this.game;
    const now = performance.now();
    const frameMs = this.lastFrame ? now - this.lastFrame : 0;
    this.lastFrame = now;
    if (frameMs > 0) this.fpsAvg = this.fpsAvg ? this.fpsAvg * 0.97 + (1000 / frameMs) * 0.03 : 1000 / frameMs;
    const watching = g.active && document.visibilityState === 'visible' && now > this.quietUntil;
    if (watching && frameMs > HITCH_MS) this.report('saccade', { who: 'jeu', detail: `Une image a pris ${Math.round(frameMs)} ms.` });
    if (watching && frameMs > 0) {
      this.fpsFrames++;
      this.fpsTime += frameMs / 1000;
      if (this.fpsTime >= LOW_FPS_WINDOW) {
        const fps = this.fpsFrames / this.fpsTime;
        if (fps < LOW_FPS) this.report('fps', { who: 'jeu', detail: `${fps.toFixed(0)} images par seconde en moyenne sur ${LOW_FPS_WINDOW} s.` });
        this.fpsFrames = 0; this.fpsTime = 0;
      }
    } else {
      this.fpsFrames = 0; this.fpsTime = 0;
    }

    // Positions that went NaN: the player, the car they drive, and the Architect's bodies
    const p = g.person.position;
    if (!Number.isFinite(p.x + p.y + p.z)) this.report('nan', { who: 'joueur', detail: 'La position du joueur n’est plus un nombre.', x: 0, y: 0, z: 0 });
    if (g.state === 'driving') {
      const c = g.car.position;
      if (!Number.isFinite(c.x + c.y + c.z)) this.report('nan', { who: 'joueur', detail: 'La position du véhicule du joueur n’est plus un nombre.', x: 0, y: 0, z: 0 });
    }

    // Sunk into the ground: the player on foot, below the floor the game itself computes for them
    if (g.state === 'onFoot' && !g.person.suspended && dt > 0) {
      const floor = g.controllers.getGroundHeight(p.x, p.z, 'person', p.y + 0.6);
      this.sink('joueur', p.y < floor - SINK_DEPTH, dt, p.x, p.y, p.z, floor);
    } else this.sinkT.delete('joueur');
    for (const b of bodies) {
      if (!Number.isFinite(b.x + b.y + b.z)) { this.report('nan', { who: b.who, detail: `La position (${b.who}) n’est plus un nombre.`, x: 0, y: 0, z: 0 }); continue; }
      if (b.ground !== undefined) this.sink(b.who, b.y < b.ground - (b.vehicle ? 0.6 : SINK_DEPTH), dt, b.x, b.y, b.z, b.ground, b.vehicle);
    }
  }

  sink(who, under, dt, x, y, z, floor, vehicle = false) {
    if (!under) { this.sinkT.delete(who); return; }
    const t = (this.sinkT.get(who) || 0) + dt;
    this.sinkT.set(who, t);
    if (t >= SINK_TIME && t - dt < SINK_TIME) {
      this.report(vehicle ? 'sous-sol' : 'enfonce', { who, x, y, z, detail: `${(floor - y).toFixed(2)} m sous le sol calculé par le jeu (${floor.toFixed(2)} m).` });
    }
  }
}

function describeError(e) {
  if (e && typeof e === 'object' && typeof e.message === 'string') return `${e.name}: ${e.message}${e.stack ? ` · ${e.stack.split('\n')[1]?.trim() ?? ''}` : ''}`;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

function safeLabel(x, z) {
  try { return getLocationLabel(x, z) || ''; } catch { return ''; }
}

export { ArchitectSenses, TITLES };
