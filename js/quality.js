// Graphics levels, and the frame pacing that keeps the game responsive whatever the machine. A level fixes what takes a
// shader rebuild (reflections, shadows), so changing one reloads the page; the render scale then follows the frame rate
// on its own, within the level's range.

const KEY = 'overdraft:quality';
const LEVELS = {
  high: { label: 'HAUTE', reflections: true, shadows: true, shadowTile: 3072, shadowFar: 300, farPropShadows: true,
    cull: 1, boroughCull: 0, scale: 1, minScale: 0.75 },
  balanced: { label: 'ÉQUILIBRÉE', reflections: false, shadows: true, shadowTile: 2048, shadowFar: 260, farPropShadows: false,
    cull: 0.72, boroughCull: 2200, scale: 1, minScale: 0.7 },
  fluid: { label: 'FLUIDE', reflections: false, shadows: false, shadowTile: 0, shadowFar: 0, farPropShadows: false,
    cull: 0.55, boroughCull: 1500, scale: 0.85, minScale: 0.6 }
};
const ORDER = ['high', 'balanced', 'fluid'];
const DEFAULT_LEVEL = 'balanced';

function storedLevel() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

// The address wins over the saved choice (?quality=high|balanced|fluid, and the old ?quality=performance)
function currentLevel() {
  const asked = new URLSearchParams(location.search).get('quality');
  const id = asked === 'performance' ? 'fluid' : LEVELS[asked] ? asked : LEVELS[storedLevel()] ? storedLevel() : DEFAULT_LEVEL;
  return { id, ...LEVELS[id] };
}

// Remembers the next level; the caller reloads the page
function cycleLevel() {
  const next = ORDER[(ORDER.indexOf(currentLevel().id) + 1) % ORDER.length];
  try { localStorage.setItem(KEY, next); } catch { /* private window: this session only, through the address */ }
  return next;
}

const MAX_IN_FLIGHT = 2; // frames the GPU may still owe us: past this, input lag grows with every queued frame
const STALL_MS = 250; // a lost completion callback (tab hidden, GPU reset) must not freeze the loop
const WINDOW_MS = 1500; // adaptive scale: frame rate is judged over this period
const TARGET_FPS = 57;
const SLOW_FPS = 50;
const SCALE_STEP = 0.1;
const SCALE_UP_AFTER = 8; // good windows before trying a sharper image
const SCALE_UP_BACKOFF = 4; // and how much longer to wait each time that attempt failed

class FramePacer {
  constructor({ renderer, level, isActive }) {
    this.renderer = renderer;
    this.device = renderer.backend.device || null; // none on the WebGL backend
    this.level = level;
    this.isActive = isActive;
    this.scale = level.scale;
    this.inFlight = 0;
    this.lastSubmit = 0;
    this.windowStart = 0;
    this.frames = 0;
    this.skipped = 0;
    this.goodWindows = 0;
    this.upAfter = SCALE_UP_AFTER;
    this.justRaised = false;
    renderer.setPixelRatio(this.scale);
  }

  // Called on every display refresh: true when this one should be skipped so no extra frame joins the GPU's queue
  skip(now) {
    if (this.inFlight >= MAX_IN_FLIGHT) {
      if (now - this.lastSubmit < STALL_MS) {
        this.skipped++;
        return true;
      }
      this.inFlight = 0;
    }
    return false;
  }

  submitted(now) {
    this.lastSubmit = now;
    this.frames++;
    if (this.device) {
      this.inFlight++;
      this.device.queue.onSubmittedWorkDone().then(() => { this.inFlight = Math.max(0, this.inFlight - 1); }, () => {});
    }
    this.adapt(now);
  }

  // Lower the render scale only when the GPU is what holds us back (frames were skipped waiting for it): a busy main
  // thread would not gain anything from a blurrier image
  adapt(now) {
    if (!this.windowStart || !this.isActive() || document.hidden) {
      this.windowStart = now;
      this.frames = 0;
      this.skipped = 0;
      return;
    }
    const elapsed = now - this.windowStart;
    if (elapsed < WINDOW_MS) return;
    const fps = this.frames * 1000 / elapsed;
    const gpuBound = this.skipped > this.frames * 0.1;
    this.windowStart = now;
    this.frames = 0;
    this.skipped = 0;
    if (fps < SLOW_FPS && gpuBound && this.scale > this.level.minScale) {
      if (this.justRaised) this.upAfter *= SCALE_UP_BACKOFF;
      this.setScale(this.scale - SCALE_STEP);
      this.goodWindows = 0;
      this.justRaised = false;
      return;
    }
    this.justRaised = false;
    this.goodWindows = fps >= TARGET_FPS ? this.goodWindows + 1 : 0;
    if (this.goodWindows >= this.upAfter && this.scale < this.level.scale) {
      this.setScale(this.scale + SCALE_STEP);
      this.goodWindows = 0;
      this.justRaised = true;
    }
  }

  setScale(scale) {
    this.scale = Math.round(Math.min(this.level.scale, Math.max(this.level.minScale, scale)) * 100) / 100;
    this.renderer.setPixelRatio(this.scale);
  }
}

export { currentLevel, cycleLevel, FramePacer };
