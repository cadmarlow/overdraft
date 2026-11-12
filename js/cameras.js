import * as THREE from 'three/webgpu';
import { bryantParkLawn } from './landmarks.js';
import { polygonBoxOverlaps } from './building-collision.js';

let _flyDir, _flyHit, _flyBox, _flyRay; // made on the first flight
// Scratch vectors of the aircraft camera (updateAircraft)
const _an = new THREE.Vector3(), _au = new THREE.Vector3(), _af = new THREE.Vector3(), _av = new THREE.Vector3(), _at = new THREE.Vector3(), _ax = new THREE.Vector3();
const _ar = new THREE.Vector3(), _ad = new THREE.Vector3(), _aa = new THREE.Vector3(), _ay = new THREE.Vector3(0, 1, 0);

// Chase, action, cockpit, fixed-location and aerial cameras, with mouse/touch orbit and zoom.

const _eye = new THREE.Vector3();
// A point in a car's own frame (its body, leaning on its springs) in the world, from this frame's state: its matrices may
// still hold the last frame's, a car length behind at speed
function carPoint(car, v) {
  v.applyQuaternion(car.bodyPivot.quaternion).applyQuaternion(car.chassisPivot.quaternion);
  const s = Math.sin(car.heading), c = Math.cos(car.heading), x = v.x;
  v.x = x * c + v.z * s; v.z = v.z * c - x * s;
  return v.add(car.position);
}

// Sweep the camera's near plane through solid geometry. Broad bounds alone would collapse the boom beside angled
// towers and inside open courtyards; oriented boxes are exact and polygon outlines are refined at sub-radius steps.
function cameraCollisionDistance(origin, direction, distance, collider, radius = 0.24) {
  let enter = 0, exit = distance;
  const slab = (o, d, lo, hi) => {
    if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
    const a = (lo - o) / d, b = (hi - o) / d;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    return enter <= exit;
  };
  if (!slab(origin.y, direction.y, (collider.minY ?? 0) - radius, collider.maxY + radius)) return distance;
  if (collider.obb && !collider.polygon) {
    const o = collider.obb, x = origin.x - o.cx, z = origin.z - o.cz;
    if (!slab(x * o.cs - z * o.sn, direction.x * o.cs - direction.z * o.sn, -o.hx - radius, o.hx + radius)
      || !slab(x * o.sn + z * o.cs, direction.x * o.sn + direction.z * o.cs, -o.hz - radius, o.hz + radius)) return distance;
  } else if (!slab(origin.x, direction.x, collider.minX - radius, collider.maxX + radius)
    || !slab(origin.z, direction.z, collider.minZ - radius, collider.maxZ + radius)) return distance;
  if (!collider.polygon) return Math.max(0, enter - 0.04);
  const occupied = (t) => polygonBoxOverlaps(collider.polygon,
    origin.x + direction.x * t, origin.z + direction.z * t, radius, radius);
  let previous = enter;
  for (let t = enter; t <= exit + 0.12; t += 0.12) {
    const sample = Math.min(t, exit);
    if (occupied(sample)) {
      let lo = previous, hi = sample;
      for (let i = 0; i < 5; i++) { const mid = (lo + hi) * 0.5; if (occupied(mid)) hi = mid; else lo = mid; }
      return Math.max(0, lo - 0.04);
    }
    if (sample === exit) break;
    previous = sample;
  }
  return distance;
}

const CAMERA_PRESETS = [
  { id: 'chase',       name: '3rd-Person Chase',         category: 'follow', fov: 56 },
  { id: 'action',      name: 'Low-Angle Action',         category: 'follow', fov: 60 },
  { id: 'pov',         name: 'First-Person / Cockpit',   category: 'follow', fov: 68 },
  { id: 'centralPark', name: 'Central Park Oasis',       category: 'scenic', fov: 52 },
  { id: 'fifthAve',    name: '5th Ave & Empire State',   category: 'scenic', fov: 48 },
  { id: 'timesSquare', name: 'Times Square Crossroads',  category: 'scenic', fov: 58 },
  { id: 'chryslerGCT', name: '42nd St · Chrysler & GCT', category: 'scenic', fov: 50 },
  { id: 'observatory', name: 'Empire State 86th Deck',   category: 'scenic', fov: 52 },
  { id: 'bryantPark',  name: 'Bryant Park & NYPL',       category: 'scenic', fov: 52 },
  { id: 'waterfront',  name: 'East River & Skyline',     category: 'scenic', fov: 46 },
  { id: 'drone',       name: 'Auto-Director Aerial',     category: 'scenic', fov: 50 }
];

class CameraSystem {
  constructor(domElement, controllerManager) {
    this.domElement = domElement;
    this.controllerManager = controllerManager;

    this.camera = new THREE.PerspectiveCamera(
      56,
      window.innerWidth / window.innerHeight,
      0.35,
      60000 // at 1:1 the boroughs & harbor run out ~20-40 km to the fogged horizon (reversed float depth keeps precision)
    );

    this.activePresetId = 'chase';
    this.orbitYawOffset = 0.0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1.0;
    this.isDragging = false;
    this.userOrbitTimer = 0;
    this.footYaw = 0;

    this.currentPos = new THREE.Vector3(0, 10, 380);
    this.currentLookAt = new THREE.Vector3(0, 8, 440);
    this.initialized = false;

    // Follow cameras (chase / action) are smoothed relative to the followed entity, see update()
    this.followEntity = null;
    this.spectate = null; // () => the entity to follow instead of the player's (architect.js)
    this.still = null; // { pos, look, fov }: a frame held on something (the counter of a shop, calibre.js)
    this.followOffset = new THREE.Vector3();
    this.followLookOffset = new THREE.Vector3();
    this.followBaseY = 0;
    this.smoothedSpeed = 0;
    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();

    // Shooter controls (gameplay.js): mouse look under pointer lock, an over-the-shoulder aim, impact shake
    this.aimMode = false;
    this.aimFov = 44; // the lens behind the sights (degrees): gameplay sets it per weapon
    this.lookLocked = false; // the pointer is steering something else (the weapon wheel): the view holds still
    this._vehicleLift = 0; // metres the eye is raised to look over a vehicle standing at the player's back
    this.vehicleObstacles = null; // (origin, range) → oriented boxes of the vehicles around a person on foot (gameplay.js)
    this.aimBlend = 0;
    this.combatMode = false;
    this.combatBlend = 0;
    this.shoulderSide = 1;
    this.shoulderBlend = 1;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilPitchVelocity = 0;
    this.recoilYawVelocity = 0;
    this._cameraAnchor = new THREE.Vector3();
    this._cameraDirection = new THREE.Vector3();
    this._cameraCandidate = new THREE.Vector3();
    this._wallCameraOffset = new THREE.Vector3();
    this._wallSlide = 0;
    this._cameraBoom = Infinity;
    this.bodyOccluded = false;
    this.shake = 0;
    this.mouseSensitivity = 0.0022;
    // In flight (vertical.js) the body follows the view: raw look motion piles up here for it, in pixels, and the camera
    // is placed by `flightView` = { pos, look, roll, fov, stiff } instead of the chase framing
    this.lookDX = 0;
    this.lookDY = 0;
    this.flightView = null;
    this._aimPos = new THREE.Vector3();
    this._aimLook = new THREE.Vector3();
    this._shakeOffset = new THREE.Vector3();

    // Chasing a car: a yaw of its own that trails the car through turns, a spring on the distance that takes the
    // acceleration, a wider lens with speed
    this.carYaw = 0;
    this.carPull = 0;
    this.carPullVel = 0;
    this.carSide = 0;
    this.carRoll = 0;
    this.carSpeed = 0;
    this.carAcceleration = 0;
    this.carLift = 0;
    this.carEntity = null;
    this.speedFov = 0;
    this.lookBack = 0;
    this.rumble = 0;
    // A scripted flight (playCinematic): the camera rides a spline, then the follow camera picks up where it lands
    this.cinematic = null;
    this._cinePos = new THREE.Vector3();
    this._cineLook = new THREE.Vector3();

    this.bindPointerControls();
  }

  // ---- Cinematics -----------------------------------------------------------------------------------------------------
  /**
   * The title menu's view: a slow aerial pass from `a` to `b` (and back, over `period` seconds), looking at `look`;
   * the 'drone' preset flies it while set. Cleared by the first cinematic (gameplay.js playIntro).
   */
  setMenuView(a, b, look, period = 70) {
    this.menuDolly = { ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, lx: look.x, ly: look.y, lz: look.z, period, t0: 0 };
    this.setCameraPreset('drone', true);
  }
  /**
   * Flies the camera through `keys` ([{ pos: Vector3, look: Vector3, fov? }], at least two) over `duration` seconds,
   * eased at both ends, along a Catmull-Rom spline through the positions (and the look-at points). When it lands, the
   * follow camera glides on from there. `onDone` is called once, at the end or when skip() cuts it short.
   */
  playCinematic(keys, duration, onDone = null) {
    if (!keys || keys.length < 2) return;
    this.cinematic = { keys, duration: Math.max(0.1, duration), t: 0, onDone };
    this.initialized = true;
  }

  // A frame someone else chose: eased into and held for as long as `still` is set. The follow camera glides back from
  // it once it is cleared.
  updateStill(dt) {
    const view = this.still, k = 1 - Math.exp(-dt * 6.5);
    this.currentPos.lerp(view.pos, k);
    this.currentLookAt.lerp(view.look, k);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
    const fov = this.camera.fov + ((view.fov ?? 40) - this.camera.fov) * k;
    if (Math.abs(this.camera.fov - fov) > 0.02) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.followEntity = null;
    this.aimBlend = this.combatBlend = 0;
    this.bodyOccluded = false;
  }

  // Cuts a cinematic short: the camera jumps to its last key and the follow camera takes over
  skipCinematic() {
    const c = this.cinematic;
    if (!c) return;
    c.t = c.duration;
    this.updateCinematic(0);
  }

  // Catmull-Rom through the keys' `field` at u in [0, 1] (the ends are clamped)
  _spline(keys, field, u, out) {
    const n = keys.length - 1;
    if (u >= 1) return out.copy(keys[n][field]);
    const s = Math.min(n - 1e-6, Math.max(0, u * n));
    const i = Math.floor(s), t = s - i;
    const P = (k) => keys[Math.min(n, Math.max(0, k))][field];
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const t2 = t * t, t3 = t2 * t;
    const w0 = -0.5 * t3 + t2 - 0.5 * t, w1 = 1.5 * t3 - 2.5 * t2 + 1, w2 = -1.5 * t3 + 2 * t2 + 0.5 * t, w3 = 0.5 * t3 - 0.5 * t2;
    return out.set(
      p0.x * w0 + p1.x * w1 + p2.x * w2 + p3.x * w3,
      p0.y * w0 + p1.y * w1 + p2.y * w2 + p3.y * w3,
      p0.z * w0 + p1.z * w1 + p2.z * w2 + p3.z * w3
    );
  }

  updateCinematic(dt) {
    const c = this.cinematic;
    c.t = Math.min(c.duration, c.t + dt);
    const x = c.t / c.duration;
    // slow out of the first key, a long glide, a soft landing
    const u = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    const pos = this._spline(c.keys, 'pos', u, this._cinePos);
    const look = this._spline(c.keys, 'look', u, this._cineLook);
    const first = c.keys[0], last = c.keys[c.keys.length - 1];
    const fov = (first.fov ?? this.camera.fov) * (1 - u) + (last.fov ?? this.camera.fov) * u;
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.currentPos.copy(pos);
    this.currentLookAt.copy(look);
    this.followEntity = null; // the chase framing picks up from here
    this.aimBlend = 0;
    if (c.t >= c.duration) {
      this.cinematic = null;
      c.onDone?.();
    }
  }

  bindPointerControls() {
    const canvas = this.domElement;
    const pointers = new Map();
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (e) => {
      // a locked pointer looks with its own motion: no drag (and pointer capture would throw)
      if (e.button !== 0 || pointers.size >= 2 || document.pointerLockElement === canvas) return;
      // Only two touch pointers may share a gesture; mouse and pen drags stay independent.
      if (pointers.size && (e.pointerType !== 'touch' || pointers.values().next().value.type !== 'touch')) return;
      e.preventDefault();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      // the same click may just have asked for the pointer lock, which refuses a capture
      try { canvas.setPointerCapture(e.pointerId); } catch { /* locking: the lock takes over the look */ }
      this.isDragging = true;
      this.userOrbitTimer = 4.0;
    });

    canvas.addEventListener('pointermove', (e) => {
      const pointer = pointers.get(e.pointerId);
      if (!pointer) return;
      e.preventDefault();
      if (this.lookLocked) { pointer.x = e.clientX; pointer.y = e.clientY; return; }
      const dx = e.clientX - pointer.x;
      const dy = e.clientY - pointer.y;
      const pair = pointers.size === 2 ? [...pointers.values()] : null;
      const previousDistance = pair ? Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) : 0;
      pointer.x = e.clientX;
      pointer.y = e.clientY;

      if (pair) {
        const distance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
        if (previousDistance > 1 && distance > 1) {
          this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier * previousDistance / distance));
        }
      } else {
        const sensitivity = this.aimMode ? 0.0034 : 0.0065;
        if (this.controllerManager.activeMode === 'person') this.footYaw -= dx * sensitivity;
        else this.orbitYawOffset -= dx * sensitivity;
        this.lookDX += dx * 3; this.lookDY += dy * 3;
        const [lo, hi] = this.aimMode ? [-0.95, 1.05] : [-0.32, 0.68];
        this.orbitPitchOffset = Math.max(lo, Math.min(hi, this.orbitPitchOffset + dy * (this.aimMode ? 0.0027 : 0.005)));
      }
      this.userOrbitTimer = 4.0;
    });

    const releasePointer = (id) => {
      if (!pointers.delete(id)) return;
      this.isDragging = pointers.size > 0;
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, (e) => releasePointer(e.pointerId));
    }
    const clearPointers = () => {
      for (const id of pointers.keys()) releasePointer(id);
    };
    this._clearPointers = clearPointers;
    window.addEventListener('blur', clearPointers);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearPointers();
    });

    // Pointer lock: relative mouse motion turns the view (on foot the walking frame, in a car the orbit)
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas || this.lookLocked) return;
      const k = this.mouseSensitivity * (this.aimMode ? 0.6 : 1);
      const dx = Math.max(-200, Math.min(200, e.movementX || 0));
      const dy = Math.max(-200, Math.min(200, e.movementY || 0));
      if (this.controllerManager.activeMode === 'person') this.footYaw -= dx * k;
      else this.orbitYawOffset -= dx * k;
      this.lookDX += dx; this.lookDY += dy;
      const [lo, hi] = this.aimMode ? [-0.95, 1.05] : [-0.32, 0.68];
      this.orbitPitchOffset = Math.max(lo, Math.min(hi, this.orbitPitchOffset + dy * k));
      this.userOrbitTimer = 2.5;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + e.deltaY * 0.001));
    }, { passive: false });
  }

  setCameraPreset(presetId, snapImmediately = false) {
    const preset = CAMERA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.activePresetId = preset.id;
    this.camera.fov = preset.fov;
    this.camera.updateProjectionMatrix();
    if (snapImmediately) {
      this.initialized = false;
    }
  }

  applyGamepadInput(lookX, lookY, zoom, dt) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    if (this.activePresetId !== 'chase' && this.activePresetId !== 'pov') return;
    // POV uses the orbit angles, but only chase renders a zoomed camera distance.
    if (this.activePresetId !== 'chase') zoom = 0;
    if (!lookX && !lookY && !zoom) return;
    const precision = this.aimMode ? 0.6 : 1;
    if (this.controllerManager.activeMode === 'person') this.footYaw -= lookX * 2.0 * dt * precision;
    else this.orbitYawOffset -= lookX * 2.0 * dt * precision;
    this.lookDX += lookX * 900 * dt; this.lookDY += lookY * 560 * dt;
    const [lo, hi] = this.aimMode ? [-0.95, 1.05] : [-0.32, 0.68];
    this.orbitPitchOffset = Math.max(lo, Math.min(hi, this.orbitPitchOffset + lookY * 1.25 * dt * precision));
    this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + zoom * 0.9 * dt));
    this.userOrbitTimer = 4.0;
  }

  resetOrbit() {
    this.orbitYawOffset = 0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1;
    this.userOrbitTimer = 0;
  }

  // The lowest the camera may sit at (x, z) while it follows a body at height `y`: just above the street, or just
  // above the Wasteland's ground, which lies well under the street on the dry beds and well over it on the dunes
  floorY(x, z, margin, y) {
    const hit = this._floorHit ??= {};
    return this.controllerManager.frontier?.sample(x, z, y + 3, hit) && !hit.deck ? hit.y + margin : margin;
  }

  resetForTeleport() {
    // Arrive with a fresh chase view, without carrying a previous drive or gesture into the destination.
    this._clearPointers();
    this.isDragging = false;
    this.resetOrbit();
    this.smoothedSpeed = 0;
    this.carEntity = null;
    this.carPull = this.carPullVel = this.carSide = this.carRoll = this.carAcceleration = 0;
    this.speedFov = this.lookBack = this.rumble = 0;
    this.followEntity = null;
    this.followOffset.set(0, 0, 0);
    this.followLookOffset.set(0, 0, 0);
    this.followBaseY = 0;
    this._cameraBoom = Infinity;
    this._wallSlide = 0;
    this._vehicleLift = 0;
    this.bodyOccluded = false;
    this.recoilPitch = this.recoilYaw = this.recoilPitchVelocity = this.recoilYawVelocity = 0;
    this.setCameraPreset('chase', true);
  }

  getActivePreset() {
    return CAMERA_PRESETS.find((p) => p.id === this.activePresetId) || CAMERA_PRESETS[0];
  }

  onResize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt, elapsed) {
    // Someone else's body when the Architect holds the camera (architect.js), else the player's
    const entity = this.spectate?.() || this.controllerManager.getActiveEntity();
    this.bodyOccluded = false;
    // A real cabin surrounds the eye within centimetres. The exterior near plane cuts its roof and leaves
    // isolated pillar ends; keep that trim intact in cockpit view and restore the usual plane on every exit.
    const carCockpit = !this.cinematic && this.activePresetId === 'pov' && entity.type === 'car'
      && !entity.moto && !entity.boat && !entity.bicycle;
    // (an aircraft's cockpit too: its sills and its panel are a hand's breadth from the pilot's eyes)
    const near = carCockpit || (this.activePresetId === 'pov' && entity.flight) ? 0.06 : entity.type === 'person' ? 0.12 : 0.35;
    if (this.camera.near !== near) { this.camera.near = near; this.camera.updateProjectionMatrix(); }
    if (this.cinematic) { this.updateCinematic(dt); return; }
    if (this.still) { this.updateStill(dt); return; }
    if (entity.flight && this.getActivePreset().category === 'follow') { this.updateAircraft(dt, elapsed, entity); return; }
    if (this.flightView && (this.activePresetId === 'chase' || this.activePresetId === 'action')) { this.updateFlight(dt, entity); return; }
    this.flying = false;
    const desiredPos = this._desiredPos;
    const desiredLook = this._desiredLook;
    const footFollow = entity.type === 'person' && (this.activePresetId === 'chase' || this.activePresetId === 'action');
    this.aimBlend += ((footFollow && this.aimMode ? 1 : 0) - this.aimBlend) * (1 - Math.exp(-dt * 19));
    this.combatBlend += ((footFollow && (this.combatMode || this.aimMode) ? 1 : 0) - this.combatBlend) * (1 - Math.exp(-dt * 12));
    this.shoulderBlend += (this.shoulderSide - this.shoulderBlend) * (1 - Math.exp(-dt * 13));
    this.updateRecoil(dt);

    if (this.userOrbitTimer > 0 && !this.isDragging) {
      this.userOrbitTimer = Math.max(0, this.userOrbitTimer - dt);
    }

    if (!this.isDragging && this.userOrbitTimer <= 0 && Math.abs(entity.speed) > 0.5) {
      this.orbitYawOffset -= Math.round(this.orbitYawOffset / (Math.PI * 2)) * (Math.PI * 2);
      this.orbitYawOffset += (0.0 - this.orbitYawOffset) * (1 - Math.exp(-dt * 2.2));
    }

    // The follow cameras pull back with speed, eased so that they drift back as the entity speeds up (and in as it
    // slows down); speedLag is about how far their former world-space smoothing left them trailing at 60 FPS
    this.smoothedSpeed += (Math.abs(entity.speed) - this.smoothedSpeed) * (1 - Math.exp(-dt * 3.0));
    const speedLag = this.smoothedSpeed * 0.1;

    if (!this.aimMode) this.orbitPitchOffset = Math.max(-0.32, Math.min(0.68, this.orbitPitchOffset));
    const totalYaw = entity.type === 'person' ? this.footYaw : entity.heading + this.orbitYawOffset;

    this._lookBackChanged = false;
    switch (this.activePresetId) {
      case 'chase': {
        if (entity.body) { this.chaseCar(entity, dt, desiredPos, desiredLook); break; }
        this.speedFov += ((entity.boat ? Math.abs(entity.speed) / 31 * 15 : entity.fovBoost || 0) - this.speedFov) * (1 - Math.exp(-dt * 3));
        const dist = entity.chaseDistance * this.zoomMultiplier * (1 + Math.min(0.25, this.smoothedSpeed * 0.01));
        const height = entity.chaseHeight * this.zoomMultiplier + Math.sin(this.orbitPitchOffset) * dist * 0.85;
        const horizDist = Math.cos(this.orbitPitchOffset) * dist + speedLag;

        desiredPos.set(
          entity.position.x - Math.sin(totalYaw) * horizDist,
          entity.position.y + height,
          entity.position.z - Math.cos(totalYaw) * horizDist
        );
        desiredPos.y = Math.max(this.floorY(desiredPos.x, desiredPos.z, 0.65, entity.position.y), desiredPos.y);

        const lookUpBias = entity.type === 'helicopter' ? 0.2 : (entity.type === 'car' ? 0.52 : 0);
        const lookAhead = entity.type === 'person' ? 0.7 : 5.2;
        desiredLook.set(
          entity.position.x + Math.sin(totalYaw) * lookAhead,
          entity.position.y + entity.cameraTargetOffset.y + lookUpBias,
          entity.position.z + Math.cos(totalYaw) * lookAhead
        );
        break;
      }

      case 'action': {
        if (entity.type === 'car' && entity.body) { this.chaseCar(entity, dt, desiredPos, desiredLook, true); break; }
        this.speedFov = 0;
        const sideOffset = entity.type === 'car' ? 2.65 : (entity.type === 'helicopter' ? 4.2 : 0.95);
        const backDist = (entity.type === 'car' ? 3.6 : (entity.type === 'helicopter' ? 8.5 : 2.8)) + speedLag;
        const lowY = entity.type === 'helicopter' ? entity.position.y + 1.2 : entity.position.y + 0.92;

        desiredPos.set(
          entity.position.x - Math.sin(entity.heading) * backDist + Math.cos(entity.heading) * sideOffset,
          Math.max(0.55, lowY),
          entity.position.z - Math.cos(entity.heading) * backDist - Math.sin(entity.heading) * sideOffset
        );
        desiredLook.set(
          entity.position.x + Math.sin(entity.heading) * 3.2,
          entity.position.y + 1.05,
          entity.position.z + Math.cos(entity.heading) * 3.2
        );
        break;
      }

      case 'pov': {
        let fwdOffset = 0.35;
        let eyeY = 1.68;
        if (entity.type === 'car' && entity.cabin) {
          // In the driver's seat, at eye height, looking over the wheel and the dash
          const [x, hip, z] = entity.cabin.layout.seat;
          const eyeH = hip + 0.74 * Math.cos(entity.cabin.layout.recline), turn = totalYaw - entity.heading;
          desiredPos.copy(carPoint(entity, _eye.set(x, eyeH, z - 0.04)));
          desiredLook.copy(carPoint(entity, _eye.set(x + Math.sin(turn) * 20, eyeH - 1.6 + Math.sin(-this.orbitPitchOffset) * 9, z + Math.cos(turn) * 20)));
          break;
        } else if (entity.type === 'car') {
          // On the bonnet, behind the glass: the models have no cabin to sit in
          fwdOffset = (entity.spec?.wheelZf ?? 1.4) * 0.42;
          eyeY = (entity.spec?.height ?? 1.5) * 0.86;
        } else if (entity.type === 'cyclist') {
          fwdOffset = 0.35;
          eyeY = 1.55;
        } else if (entity.type === 'helicopter') {
          fwdOffset = 1.65;
          eyeY = 1.65;
        }

        desiredPos.set(
          entity.position.x + Math.sin(entity.heading) * fwdOffset,
          entity.position.y + eyeY,
          entity.position.z + Math.cos(entity.heading) * fwdOffset
        );
        desiredLook.set(
          entity.position.x + Math.sin(totalYaw) * 40.0,
          entity.position.y + eyeY + Math.sin(-this.orbitPitchOffset) * 18.0 + 1.5,
          entity.position.z + Math.cos(totalYaw) * 40.0
        );
        break;
      }

      case 'centralPark': {
        // Above the southern canopy, looking across The Pond toward the park and skyline.
        const sway = Math.sin(elapsed * 0.22) * 3.5;
        desiredPos.set(-70.0 + sway, 26.0, -1425.0);
        desiredLook.set(-250.0, 6.5, -1690.0);
        break;
      }

      case 'fifthAve': {
        // 5th Avenue & 42nd St looking South down the 5th Ave canyon toward the Empire State Building
        const sway = Math.sin(elapsed * 0.25) * 1.8;
        desiredPos.set(0.0 + sway, 6.5, -20.0);
        desiredLook.set(-60.0, 150.0, 686.0);
        break;
      }

      case 'timesSquare': {
        // Times Square & Broadway looking across Duffy Square red steps and One Times Square billboards
        const sway = Math.sin(elapsed * 0.3) * 3.0;
        desiredPos.set(-603.0 + sway, 5.5, -290.0);
        desiredLook.set(-566.0, 40.0, -40.0);
        break;
      }

      case 'chryslerGCT': {
        // Park Ave & 42nd St intersection looking straight at Grand Central, MetLife, and Chrysler Building Crown
        const sway = Math.cos(elapsed * 0.22) * 2.5;
        desiredPos.set(300.0 + sway, 9.5, 95.0);
        desiredLook.set(470.0, 120.0, -50.0);
        break;
      }

      case 'observatory': {
        // Empire State Building 86th Floor Deck looking North-East across Midtown skyline
        const pan = Math.sin(elapsed * 0.18) * 80.0;
        desiredPos.set(-58.0, 322.0, 660.0);
        desiredLook.set(420.0 + pan, 150.0, -200.0);
        break;
      }

      case 'bryantPark': {
        // Inside Bryant Park Great Lawn looking East toward NYPL portico, One Vanderbilt & Chrysler Building
        const sway = Math.sin(elapsed * 0.25) * 1.5;
        const lawn = bryantParkLawn || { minX: -260, maxX: -150, minZ: 40, maxZ: 120, top: 1.3 };
        const lz = (lawn.minZ + lawn.maxZ) * 0.5;
        desiredPos.set(lawn.minX + 18.0, lawn.top + 1.7, lz + sway);
        desiredLook.set(lawn.maxX + 260.0, 70.0, lz - 60.0);
        break;
      }

      case 'waterfront': {
        // Over the shimmering East River looking across the FDR Drive, Queensboro Bridge & Midtown Skyline
        const drift = Math.sin(elapsed * 0.15) * 40.0;
        desiredPos.set(1640.0, 60.0, 60.0 + drift);
        desiredLook.set(150.0, 150.0, -150.0);
        break;
      }

      case 'drone': {
        const d = this.menuDolly;
        if (d) {
          // The title menu: a slow pass in the air down the avenue towards the landmark the player will see first
          const u = 0.5 - 0.5 * Math.cos((elapsed - d.t0) * Math.PI / d.period);
          desiredPos.set(d.ax + (d.bx - d.ax) * u, d.ay + (d.by - d.ay) * u, d.az + (d.bz - d.az) * u);
          desiredLook.set(d.lx, d.ly, d.lz);
          break;
        }
        const angle = elapsed * 0.07 + 0.65;
        const radius = 720.0 + Math.sin(elapsed * 0.23) * 140.0;
        const alt = 330.0 + Math.cos(elapsed * 0.19) * 90.0;
        desiredPos.set(
          Math.cos(angle) * radius + 60.0,
          alt,
          Math.sin(angle) * radius + 250.0
        );
        desiredLook.set(60.0, 160.0, 250.0);
        break;
      }
    }

    if (footFollow && this.combatBlend > 0.001) {
      this.aimFrame(entity);
      desiredPos.lerp(this._aimPos, this.combatBlend);
      desiredLook.lerp(this._aimLook, this.combatBlend);
    }

    if (!this.initialized || this.activePresetId === 'pov') {
      this.currentPos.copy(desiredPos);
      this.currentLookAt.copy(desiredLook);
      this.initialized = true;
      this.followEntity = null; // the follow cameras re-anchor from here
    } else if (this.activePresetId === 'chase' || this.activePresetId === 'action') {
      // Smoothed in the followed entity's frame rather than in world space. A world-space follower trails a moving
      // target by a distance that depends on the frame time (about speed x dt), so with uneven frame times the camera
      // surged back and forth behind an accelerating or fast car. Relative to the entity a steady drive keeps the
      // camera steady, while turns, orbit drags, zoom & the speed pull-back are still eased. The entity's height is
      // eased in world space (curbs, park lawns, jumps, the helicopter climbing).
      if (this.followEntity !== entity) {
        // preset or mode switch: start from where the camera is and glide over to the new framing
        this.followEntity = entity;
        this.followBaseY = entity.position.y;
        this.followOffset.subVectors(this.currentPos, entity.position);
        this.followLookOffset.subVectors(this.currentLookAt, entity.position);
      }
      const locked = document.pointerLockElement === this.domElement;
      // Aim follows input immediately. Framing, shoulder switches and recoil have their own easing; smoothing the
      // yaw a second time makes the reticle swim behind the mouse and conceals the gun behind the turning body.
      const k = this._lookBackChanged || footFollow && (locked || this.aimMode) ? 1 : 1 - Math.exp(-dt * (entity.body ? 22 : footFollow && this.combatBlend > 0.1 ? 24 : 8.5));
      // Off a ramp the camera does not rise with the car at once: the car climbs out of the frame, and lands back in it
      this.followBaseY += (entity.position.y - this.followBaseY) * (entity.body ? 1 - Math.exp(-dt * (entity.body.grounded ? 9 : 2.6)) : k);
      this.followOffset.lerp(desiredPos.sub(entity.position), k);
      this.followLookOffset.lerp(desiredLook.sub(entity.position), k);
      this.currentPos.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followOffset);
      this.currentLookAt.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followLookOffset);
      this.currentPos.y = Math.max(this.floorY(this.currentPos.x, this.currentPos.z, 0.55, entity.position.y), this.currentPos.y);
    } else {
      this.followEntity = null;
      const k = 1 - Math.exp(-dt * 8.5);
      this.currentPos.lerp(desiredPos, k);
      this.currentLookAt.lerp(desiredLook, k);
    }

    // Keep the third-person camera on the player's side of nearby solid geometry.
    if ((this.activePresetId === 'chase' || this.activePresetId === 'action') && this.controllerManager.nearColliders) {
      const origin = this._cameraAnchor.copy(entity.position);
      origin.y += entity.type === 'person' ? 1.48 : 1.2;
      const direction = this._cameraDirection.subVectors(this.currentPos, origin);
      const length = direction.length();
      if (length > 0.01) {
        direction.divideScalar(length);
        let distance = length;
        const colliders = this.controllerManager.nearColliders(origin.x, origin.z, length + 3);
        for (const collider of colliders) {
          distance = Math.min(distance, cameraCollisionDistance(origin, direction, distance, collider, footFollow ? 0.24 : 0.4));
        }
        // On foot, a van pulling up behind must not swallow the eye: vehicles shorten the boom like walls do, down to
        // arm's length. Closer than that the camera would sit on the back of the head, so it keeps that length and
        // rises over the roof instead: standing in traffic, the player still sees the street.
        let lift = 0;
        if (footFollow && this.vehicleObstacles) {
          for (const collider of this.vehicleObstacles(origin, length + 4)) {
            const hit = cameraCollisionDistance(origin, direction, distance, collider, 0.2);
            if (hit >= distance) continue;
            if (hit >= 1.7) { distance = hit; continue; }
            distance = Math.min(distance, 1.7);
            lift = Math.max(lift, collider.maxY + 0.35 - (origin.y + direction.y * distance));
          }
        }
        this._vehicleLift += (Math.max(0, lift) - this._vehicleLift) * (1 - Math.exp(-dt * 9));
        // Pull in immediately; emerge softly once the wall is gone. The collision distance is never eased outward
        // through solid geometry, and unlike a minimum boom of 55 cm this also works with a wall at one's shoulder.
        if (distance < this._cameraBoom || !Number.isFinite(this._cameraBoom)) this._cameraBoom = distance;
        else this._cameraBoom += (distance - this._cameraBoom) * (1 - Math.exp(-dt * 10));
        this.currentPos.copy(origin).addScaledVector(direction, Math.min(distance, this._cameraBoom));
        // With one's back to a wall, shortening the boom alone puts the eye inside the head and rifle stock. Search
        // along the shoulder instead. Every candidate is swept from the player, so this never grants vision through
        // cover. In a completely closed corner gameplay can hide the obstructing body using bodyOccluded below.
        let slid = false;
        if (footFollow && distance < 0.9) {
          const yaw = this.footYaw, side = this.shoulderBlend >= 0 ? 1 : -1;
          const sx = Math.sin(yaw), cz = Math.cos(yaw);
          search: for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
            const sign = sideIndex ? -side : side;
            for (const back of [0.65, 0.3, 0, -0.2]) {
              const candidate = this._cameraCandidate.set(-sx * back - cz * 0.98 * sign, 0.1, -cz * back + sx * 0.98 * sign);
              const reach = candidate.length();
              candidate.divideScalar(reach);
              let clear = reach;
              for (const collider of colliders) clear = Math.min(clear, cameraCollisionDistance(origin, candidate, clear, collider, 0.24));
              if (clear < 0.85) continue;
              this._wallCameraOffset.set(candidate.x * clear, candidate.y * clear, candidate.z * clear);
              this._wallSlide = 1;
              slid = true;
              break search;
            }
          }
        }
        if (!slid) this._wallSlide *= Math.exp(-dt * 12);
        if (footFollow && this._wallSlide > 0.001) {
          const candidate = this._cameraCandidate.copy(origin).add(this._wallCameraOffset);
          this.currentPos.lerp(candidate, this._wallSlide);
          direction.subVectors(this.currentPos, origin);
          const reach = direction.length();
          if (reach > 1e-6) {
            direction.divideScalar(reach);
            let clear = reach;
            for (const collider of colliders) clear = Math.min(clear, cameraCollisionDistance(origin, direction, clear, collider, 0.24));
            this.currentPos.copy(origin).addScaledVector(direction, clear);
          }
        }
        if (footFollow) this.bodyOccluded = Math.hypot(this.currentPos.x - origin.x, this.currentPos.z - origin.z) < 0.6;
      }
    } else { this._cameraBoom = Infinity; this._wallSlide = 0; this._vehicleLift = 0; }
    this.camera.position.copy(this.currentPos);
    if (this._vehicleLift > 0.001) this.camera.position.y += this._vehicleLift;
    this.camera.lookAt(this.currentLookAt);
    if (this.activePresetId === 'chase' || this.activePresetId === 'action' || this.activePresetId === 'pov') {
      if (Math.abs(this.recoilPitch) > 1e-7) this.camera.rotateX(this.recoilPitch);
      if (Math.abs(this.recoilYaw) > 1e-7) this.camera.rotateY(this.recoilYaw);
    }
    if ((this.activePresetId === 'chase' || this.activePresetId === 'action') && entity.type === 'car' && entity.body) {
      this.camera.rotateZ(this.carRoll);
      // Speed through the seat: a fine shudder that grows on bad surfaces and near the top of the car's range
      const r = this.rumble;
      if (r > 0.0005) {
        const t = elapsed * 41;
        this.camera.position.x += Math.sin(t) * r * 0.6;
        this.camera.position.y += Math.sin(t * 1.37 + 1) * r;
        this.camera.rotateZ(Math.sin(t * 0.73) * r * 0.12);
      }
    }
    if (this.shake > 0.001) {
      const a = this.shake * this.shake;
      this._shakeOffset.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
      this.camera.position.add(this._shakeOffset);
      this.camera.rotation.z += (Math.random() - 0.5) * a * 0.05;
      this.shake *= Math.exp(-dt * 6);
    }
    // A modest lens change keeps the muzzle in frame; magnifying the target must not swallow the player's shoulder.
    if (this.activePresetId === 'chase' || this.activePresetId === 'action') {
      const fov = this.getActivePreset().fov - 3 * this.combatBlend - (this.getActivePreset().fov - 3 - this.aimFov) * this.aimBlend + this.speedFov;
      if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    }
  }

  // A body flying on its own (vertical.js): the camera goes where flightView puts it, eased, kept on the body's side of
  // the buildings, rolled with the turn; the view widens with the speed (and blurs with it, main.js)
  updateFlight(dt, entity) {
    const f = this.flightView;
    if (!_flyRay) { _flyDir = new THREE.Vector3(); _flyHit = new THREE.Vector3(); _flyBox = new THREE.Box3(); _flyRay = new THREE.Ray(); }
    const k = 1 - Math.exp(-dt * (f.stiff ?? 10));
    if (!this.initialized) { this.currentPos.copy(f.pos); this.currentLookAt.copy(f.look); this.initialized = true; }
    this.flying = true;
    this.currentPos.lerp(f.pos, k);
    this.currentLookAt.lerp(f.look, Math.min(1, k * 1.6));
    // nothing solid between the body and the camera
    const anchor = f.anchor ?? entity.position;
    _flyDir.subVectors(this.currentPos, anchor);
    const length = _flyDir.length();
    if (length > 0.05) {
      _flyDir.divideScalar(length);
      _flyRay.origin.copy(anchor);
      _flyRay.direction.copy(_flyDir);
      let distance = length;
      for (const c of this.controllerManager.nearColliders(anchor.x, anchor.z, length + 3)) {
        _flyBox.min.set(c.minX - 0.2, (c.minY ?? 0) - 0.1, c.minZ - 0.2);
        _flyBox.max.set(c.maxX + 0.2, c.maxY + 0.15, c.maxZ + 0.2);
        if (_flyBox.containsPoint(anchor)) continue;
        if (_flyRay.intersectBox(_flyBox, _flyHit)) distance = Math.min(distance, Math.max(0.8, anchor.distanceTo(_flyHit) - 0.25));
      }
      if (distance < length) this.currentPos.copy(anchor).addScaledVector(_flyDir, distance);
    }
    this.camera.position.copy(this.currentPos);
    if (f.offset) this.camera.position.add(f.offset);
    this.camera.lookAt(this.currentLookAt);
    if (f.roll) this.camera.rotateZ(f.roll);
    if (this.shake > 0.001) {
      const a = this.shake * this.shake;
      this._shakeOffset.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
      this.camera.position.add(this._shakeOffset);
      this.shake *= Math.exp(-dt * 6);
    }
    this.speedFov += ((f.fov ?? 0) - this.speedFov) * (1 - Math.exp(-dt * 4));
    const fov = 56 + this.speedFov;
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.followEntity = null; // the chase framing picks up from here once the flight is over
    this.aimBlend = 0;
  }

  // An aircraft: the camera flies formation on it. Its frame follows the flight path with a lag (the nose is seen working
  // against the path, a turn swings the tail out), is carried through a loop without ever flipping, and leans a little
  // with the bank; thrust drops it back, g sinks it under the aircraft, speed widens the lens and shakes it. 'action' is
  // locked to the aircraft's own roll, close in; 'pov' sits at the pilot's eyes.
  updateAircraft(dt, elapsed, a) {
    const b = a.flight, r = b.r;
    const s = this.air ??= { f: new THREE.Vector3(0, 0, 1), u: new THREE.Vector3(0, 1, 0), entity: null, pull: 0, pullVel: 0, speed: 0, acc: 0, sink: 0, fov: 0, t: 0, punch: 0 };
    if (!_flyRay) { _flyDir = new THREE.Vector3(); _flyHit = new THREE.Vector3(); _flyBox = new THREE.Box3(); _flyRay = new THREE.Ray(); }
    const h = Math.max(0, Math.min(dt, 0.1));
    const action = this.activePresetId === 'action', pov = this.activePresetId === 'pov';
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const ease = (lo, hi, x) => { const t = clamp((x - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); };
    this.flying = true;
    this.aimBlend = 0;
    this.followEntity = null; // the chase framing picks up from here once out of the aircraft
    a.inside = pov; // seen from the pilot's eyes, the pilot is not drawn (aircraft.js)
    const V = b.airspeed, speed = Math.hypot(b.vx, b.vy, b.vz);
    const nose = _an.set(r[6], r[7], r[8]), bodyUp = _au.set(r[3], r[4], r[5]);
    // where it is going: between the nose and the flight path
    const F = _af.copy(nose);
    if (speed > 8 && !b.onGround && !pov) F.multiplyScalar(0.4).addScaledVector(_av.set(b.vx, b.vy, b.vz), 0.6 / speed).normalize();
    if (s.entity !== a || !this.initialized) {
      s.entity = a;
      s.f.copy(F);
      s.u.copy(action || pov ? bodyUp : _ay);
      s.u.addScaledVector(s.f, -s.u.dot(s.f));
      if (s.u.lengthSq() < 1e-4) s.u.copy(bodyUp);
      s.u.normalize();
      s.pull = s.pullVel = s.acc = s.sink = s.punch = 0;
      s.speed = a.speed;
      this.initialized = true;
    }
    if (this.userOrbitTimer > 0 && !this.isDragging) this.userOrbitTimer = Math.max(0, this.userOrbitTimer - dt);
    if (!this.isDragging && this.userOrbitTimer <= 0) {
      this.orbitYawOffset -= Math.round(this.orbitYawOffset / (Math.PI * 2)) * (Math.PI * 2);
      this.orbitYawOffset += -this.orbitYawOffset * (1 - Math.exp(-dt * 2.2));
      this.orbitPitchOffset += (0.09 - this.orbitPitchOffset) * (1 - Math.exp(-dt * 2.2));
    }
    this.orbitPitchOffset = clamp(this.orbitPitchOffset, -0.9, 1.1);
    if (h > 0) {
      // forward follows with a lag; up is carried along without twist, then eased to the horizon or to the aircraft's own
      s.f.lerp(F, 1 - Math.exp(-h * (pov ? 40 : action ? 9 : 5.5))).normalize();
      s.u.addScaledVector(s.f, -s.u.dot(s.f));
      if (s.u.lengthSq() < 1e-6) s.u.copy(bodyUp).addScaledVector(s.f, -bodyUp.dot(s.f));
      s.u.normalize();
      // near the vertical the horizon is no guide: there the camera rolls with the aircraft
      const steep = ease(0.6, 0.92, Math.abs(s.f.y));
      const k = pov || action ? 1 : 0.3 + 0.7 * steep;
      const T = _at.copy(_ay).multiplyScalar(1 - k).addScaledVector(bodyUp, k);
      T.addScaledVector(s.f, -T.dot(s.f));
      if (T.lengthSq() > 0.02) {
        T.normalize();
        const angle = Math.atan2(_ax.crossVectors(s.u, T).dot(s.f), s.u.dot(T));
        const rate = pov ? 40 : action ? 8 : 3.2, most = h * (pov ? 30 : action ? 6 : 2.6);
        s.u.applyAxisAngle(s.f, clamp(angle * (1 - Math.exp(-h * rate)), -most, most));
      }
      // thrust and drag move the camera along the path (a spring); g sinks it under the aircraft
      const acc = clamp((a.speed - s.speed) / h, -40, 40);
      s.speed = a.speed;
      s.acc += (acc - s.acc) * (1 - Math.exp(-h * 6));
      const wanted = clamp(s.acc * 0.16, -2.2, 4.5);
      const omega = 5.5, x = s.pull - wanted, j = s.pullVel + omega * x, decay = Math.exp(-omega * h);
      s.pull = wanted + (x + j * h) * decay;
      s.pullVel = (s.pullVel - omega * j * h) * decay;
      s.sink += (clamp((b.gSmooth - 1) * 0.3, -0.9, 2.4) - s.sink) * (1 - Math.exp(-h * 3.5));
      s.punch *= Math.exp(-h * 2.5);
      s.t += h;
    }
    const top = a.drive?.speed || 100, rush = clamp(V / top, 0, 1);
    const right = _ar.crossVectors(s.f, s.u).normalize(); // the view's right
    // free look: the mouse swings the camera round the aircraft, and lets go after a moment
    const yaw = this.orbitYawOffset, pitch = this.orbitPitchOffset - 0.09;
    const d = _ad.copy(s.f).applyAxisAngle(s.u, yaw);
    const looking = clamp(Math.abs(Math.atan2(Math.sin(yaw), Math.cos(yaw))) / 1.2, 0, 1);
    const pos = this.currentPos, look = this.currentLookAt;
    if (pov) {
      const e = a.eye || [0, 0.8, 0];
      pos.set(a.position.x + e[0] * r[0] + e[1] * r[3] + e[2] * r[6], a.position.y + e[0] * r[1] + e[1] * r[4] + e[2] * r[7], a.position.z + e[0] * r[2] + e[1] * r[5] + e[2] * r[8]);
      // the head sinks into the seat under g
      pos.addScaledVector(bodyUp, -clamp((b.gSmooth - 1) * 0.012, -0.03, 0.08));
      d.applyAxisAngle(_ax.crossVectors(d, s.u).normalize(), -pitch);
      look.copy(pos).addScaledVector(d, 60);
    } else {
      const anchor = _aa.copy(a.position).addScaledVector(bodyUp, a.cameraTargetOffset?.y ?? 0.6);
      // the lens widens with speed and the camera closes in as it does (a dolly zoom): the world rushes, the
      // aircraft keeps its size in the picture (at Mach 1 it had shrunk to a tenth of the screen's width)
      const lens = Math.tan(28 * Math.PI / 180) / Math.tan((56 + s.fov) * Math.PI / 360);
      const dist = Math.max(4, a.chaseDistance * this.zoomMultiplier * (action ? 0.7 : 1) * (1 + 0.22 * Math.sqrt(rush)) * (0.45 + 0.55 * lens) + s.pull);
      const height = a.chaseHeight * this.zoomMultiplier * (action ? 0.42 : 1) * (1 - 0.25 * rush) - s.sink;
      pos.copy(anchor).addScaledVector(d, -Math.cos(pitch) * dist).addScaledVector(s.u, height + Math.sin(pitch) * dist * 0.85);
      look.copy(anchor).addScaledVector(d, (10 + V * 0.06) * (1 - looking)).addScaledVector(s.u, 1.2 * (1 - looking));
      // nothing solid between the aircraft and the camera
      _flyDir.subVectors(pos, anchor);
      const length = _flyDir.length();
      if (length > 0.05) {
        _flyDir.divideScalar(length);
        _flyRay.origin.copy(anchor);
        _flyRay.direction.copy(_flyDir);
        let distance = length;
        for (const c of this.controllerManager.nearColliders(anchor.x, anchor.z, length + 3)) {
          if (c.parked !== undefined || c.breakable) continue;
          _flyBox.min.set(c.minX - 0.3, (c.minY ?? 0) - 0.1, c.minZ - 0.3);
          _flyBox.max.set(c.maxX + 0.3, c.maxY + 0.3, c.maxZ + 0.3);
          if (_flyBox.containsPoint(anchor)) continue;
          if (_flyRay.intersectBox(_flyBox, _flyHit)) distance = Math.min(distance, Math.max(2.5, anchor.distanceTo(_flyHit) - 0.4));
        }
        if (distance < length) pos.copy(anchor).addScaledVector(_flyDir, distance);
      }
      pos.y = Math.max(pos.y, b.groundY > -30 ? b.groundY + 0.7 : -1.2);
    }
    this.camera.position.copy(pos);
    // the air shakes the camera: slow and quick swaying, not noise; harder near the stall, in reheat and through Mach 1
    const rumble = b.onGround ? Math.min(1, Math.abs(a.speed) / 60) * 0.02 : 0;
    const buffet = (0.006 + rush * rush * 0.022 + b.buffet * 0.11 + b.ab * 0.035 + rumble) * (pov ? 0.35 : 1) * (this.isDragging ? 0.3 : 1);
    const t = s.t;
    this.camera.position.addScaledVector(right, (Math.sin(t * 6.1) + 0.5 * Math.sin(t * 13.7 + 1.3) + 0.3 * Math.sin(t * 31)) * buffet)
      .addScaledVector(s.u, (Math.sin(t * 7.3 + 0.4) * 0.7 + Math.sin(t * 17.9) * 0.35 + 0.3 * Math.sin(t * 37 + 2)) * buffet);
    this.camera.up.copy(s.u);
    this.camera.lookAt(look);
    this.camera.up.set(0, 1, 0);
    if (this.shake > 0.001) {
      const k = this.shake * this.shake;
      this._shakeOffset.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
      this.camera.position.add(this._shakeOffset);
      this.camera.rotateZ((Math.random() - 0.5) * k * 0.05);
      this.shake *= Math.exp(-dt * 6);
    }
    const wide = pov ? rush * 9 + b.ab * 4 + s.punch : Math.pow(rush, 1.15) * 20 + b.ab * 7 + s.punch;
    s.fov += (wide - s.fov) * (1 - Math.exp(-h * (wide > s.fov ? 2.6 : 4)));
    // the blur of speed (main.js reads speedFov) belongs to things passing close: high up the picture stays sharp
    this.speedFov = s.fov * (0.2 + 0.8 * clamp(1 - (b.agl - 40) / 260, 0, 1));
    const fov = (pov ? 72 : 56) + s.fov;
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  // A kick of the lens (degrees): the afterburner lighting, the sound barrier going by
  punchFov(degrees) {
    if (this.air) this.air.punch = Math.min(14, this.air.punch + degrees);
  }

  // The boom follows the route, while the car remains free to yaw inside the frame. A bounded lens change and a
  // spring driven by longitudinal acceleration give speed and weight without shrinking the car or tipping the horizon.
  chaseCar(car, dt, desiredPos, desiredLook, action = false) {
    const b = car.body, h = Math.max(0, Math.min(dt, 0.25));
    const speed = Math.hypot(b.vx, b.vz), signed = car.speed || 0;
    if (this.carEntity !== car) {
      this.carEntity = car;
      this.carYaw = car.heading;
      this.carPull = this.carPullVel = this.carSide = this.carRoll = this.carAcceleration = 0;
      this.carSpeed = signed;
      this.lookBack = 0;
    }
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const delta = (a, c) => Math.atan2(Math.sin(c - a), Math.cos(c - a));
    const reversing = signed < -1.5;
    const travel = speed > 2.5 ? Math.atan2(b.vx, b.vz) + (reversing ? Math.PI : 0) : car.heading;
    const weight = clamp(speed / 14, 0, 1) * (b.grounded ? 0.72 : 0.9);
    // Limit the contribution of a spin to the travel framing: the camera must never whip across the road.
    const follow = car.heading + clamp(delta(car.heading, travel), -1.05, 1.05) * weight;
    this.carYaw += delta(this.carYaw, follow) * (1 - Math.exp(-h * (reversing ? 3 : 4.4 + Math.min(2, speed * 0.035))));
    const wantBack = this.controllerManager.keys?.down ? 1 : 0;
    this._lookBackChanged = this.lookBack !== wantBack;
    this.lookBack = wantBack;
    const yaw = this.carYaw + this.orbitYawOffset + this.lookBack * Math.PI;

    const acceleration = h > 0 ? clamp((signed - this.carSpeed) / h, -18, 14) : 0;
    this.carSpeed = signed;
    this.carAcceleration += (acceleration - this.carAcceleration) * (1 - Math.exp(-h * 11));
    const longitudinal = Number.isFinite(b.longG) ? b.longG * 9.81 : this.carAcceleration;
    const wanted = clamp(longitudinal * 0.055, -0.62, 0.78);
    // Closed form critical damping is stable on a missed frame and consistent at 30, 60 and 144 Hz.
    const omega = 7.5, displacement = this.carPull - wanted;
    const j = this.carPullVel + omega * displacement, decay = Math.exp(-omega * h);
    this.carPull = wanted + (displacement + j * h) * decay;
    this.carPullVel = (this.carPullVel - omega * j * h) * decay;

    const span = clamp(speed / 70, 0, 1);
    const baseDistance = action ? Math.max(4.8, car.chaseDistance * 0.78) : car.chaseDistance;
    const distance = Math.max(2.2, baseDistance * this.zoomMultiplier * (1 + span * 0.1) + this.carPull);
    const baseHeight = action ? Math.max(1.12, (car.spec?.height ?? 1.5) * 0.72) : car.chaseHeight;
    const lift = baseHeight * this.zoomMultiplier * (1 - span * 0.08)
      + Math.sin(this.orbitPitchOffset - 0.09) * distance * 0.85;
    const shoulder = action ? Math.min(1.6, (car.spec?.halfW ?? 0.9) + 0.55) : 0;
    desiredPos.set(car.position.x - Math.sin(yaw) * distance + Math.cos(yaw) * shoulder,
      car.position.y + lift, car.position.z - Math.cos(yaw) * distance - Math.sin(yaw) * shoulder);
    desiredPos.y = Math.max(this.floorY(desiredPos.x, desiredPos.z, 0.7, car.position.y), desiredPos.y);

    // Anticipate the road modestly; looking far past the nose conceals the car behind the bottom edge of the screen.
    // While orbiting, keep the subject centred rather than fighting the player's inspection of the bodywork.
    const orbit = 1 - clamp(Math.abs(delta(0, this.orbitYawOffset)) / 1.2, 0, 1);
    const ahead = (2.8 + Math.min(4.2, speed * 0.075)) * (0.35 + orbit * 0.65);
    const lateral = clamp((b.wy || 0) * speed / 11, -1, 1);
    this.carSide += (lateral * 1.15 * orbit - this.carSide) * (1 - Math.exp(-h * 5));
    const side = this.carSide * (this.lookBack ? -1 : 1);
    desiredLook.set(car.position.x + Math.sin(yaw) * ahead + Math.cos(yaw) * side,
      car.position.y + car.cameraTargetOffset.y + (action ? 0.18 : 0.12),
      car.position.z + Math.cos(yaw) * ahead - Math.sin(yaw) * side);
    this.carRoll += ((b.grounded ? -lateral * 0.018 * orbit : 0) - this.carRoll) * (1 - Math.exp(-h * 5));

    const top = Math.max(car.tune?.top ?? 58, 50);
    const rush = clamp(speed / top, 0, 1) ** 1.35;
    const wide = rush * 13 + (b.nitro ? 4 : 0);
    this.speedFov += (wide - this.speedFov) * (1 - Math.exp(-h * (wide > this.speedFov ? 2.8 : 4)));
    let road = 0, contacts = 0;
    for (const wheel of b.wheels ?? []) if (wheel.hasGround) { road += wheel.rough || 0; contacts++; }
    road /= Math.max(1, contacts);
    this.rumble = Math.min(0.035, rush * 0.007 + (speed > 4 ? road * Math.min(1, speed / 20) * 0.38 : 0))
      * (b.grounded ? 1 : 0.1) * (this.isDragging ? 0.3 : 1);
  }

  // Over-the-shoulder framing: orbit a pivot at the right shoulder, pitch from the mouse
  aimFrame(entity) {
    const yaw = this.footYaw, pitch = this.orbitPitchOffset;
    const lx = Math.sin(yaw) * Math.cos(pitch), ly = -Math.sin(pitch), lz = Math.cos(yaw) * Math.cos(pitch);
    // Armed, the body stands left of centre and the street ahead is clear; aimed, the lens closes in (see the FOV
    // below) from a little further back than the body is wide, so shoulders, hands and weapon stay in the frame and
    // the sight sits at eye height beside the head
    const side = (0.44 + 0.24 * this.aimBlend) * this.shoulderBlend;
    const distance = 3.2 - 0.95 * this.aimBlend;
    const px = entity.position.x - Math.cos(yaw) * side;
    const py = entity.position.y + 1.56 + 0.06 * this.aimBlend;
    const pz = entity.position.z + Math.sin(yaw) * side;
    this._aimPos.set(px - lx * distance, py - ly * distance, pz - lz * distance);
    this._aimLook.set(px + lx * 60, py + ly * 60, pz + lz * 60);
  }

  swapShoulder() {
    this.shoulderSide *= -1;
    return this.shoulderSide;
  }

  // The impulse is visual aim displacement, not permanently accumulated mouse input. A critically damped spring
  // restores the original sightline after a burst; its closed form behaves identically at 30, 60 or 144 Hz.
  addRecoil(pitch, yaw = 0) {
    if (!Number.isFinite(pitch + yaw)) return;
    this.recoilPitch = Math.min(0.16, this.recoilPitch + Math.max(0, pitch) * 0.55);
    this.recoilPitchVelocity = Math.min(2.8, this.recoilPitchVelocity + Math.max(0, pitch) * 18);
    this.recoilYaw = Math.max(-0.045, Math.min(0.045, this.recoilYaw + yaw * 0.55));
    this.recoilYawVelocity = Math.max(-0.8, Math.min(0.8, this.recoilYawVelocity + yaw * 18));
  }

  updateRecoil(dt) {
    const omega = 22, decay = Math.exp(-omega * Math.max(0, dt));
    const pitchJ = this.recoilPitchVelocity + omega * this.recoilPitch;
    const yawJ = this.recoilYawVelocity + omega * this.recoilYaw;
    this.recoilPitch = (this.recoilPitch + pitchJ * dt) * decay;
    this.recoilPitchVelocity = (this.recoilPitchVelocity - omega * pitchJ * dt) * decay;
    this.recoilYaw = (this.recoilYaw + yawJ * dt) * decay;
    this.recoilYawVelocity = (this.recoilYawVelocity - omega * yawJ * dt) * decay;
  }

  addShake(amount) {
    this.shake = Math.min(1.6, this.shake + amount);
  }
}

export { CAMERA_PRESETS, CameraSystem, cameraCollisionDistance };
