import * as THREE from 'three/webgpu';
import { bryantParkLawn } from './landmarks.js';

let _flyDir, _flyHit, _flyBox, _flyRay; // made on the first flight

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
    this.followOffset = new THREE.Vector3();
    this.followLookOffset = new THREE.Vector3();
    this.followBaseY = 0;
    this.smoothedSpeed = 0;
    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();

    // Shooter controls (gameplay.js): mouse look under pointer lock, an over-the-shoulder aim, impact shake
    this.aimMode = false;
    this.aimBlend = 0;
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
        if (this.controllerManager.activeMode === 'person') this.footYaw -= dx * 0.0065;
        else this.orbitYawOffset -= dx * 0.0065;
        this.lookDX += dx * 3; this.lookDY += dy * 3;
        this.orbitPitchOffset = Math.max(-0.32, Math.min(0.68, this.orbitPitchOffset + dy * 0.005));
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
      if (document.pointerLockElement !== canvas) return;
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
    if (this.controllerManager.activeMode === 'person') this.footYaw -= lookX * 2.0 * dt;
    else this.orbitYawOffset -= lookX * 2.0 * dt;
    this.lookDX += lookX * 900 * dt; this.lookDY += lookY * 560 * dt;
    this.orbitPitchOffset = Math.max(-0.32, Math.min(0.68, this.orbitPitchOffset + lookY * 1.25 * dt));
    this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + zoom * 0.9 * dt));
    this.userOrbitTimer = 4.0;
  }

  resetOrbit() {
    this.orbitYawOffset = 0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1;
    this.userOrbitTimer = 0;
  }

  resetForTeleport() {
    // Arrive with a fresh chase view, without carrying a previous drive or gesture into the destination.
    this._clearPointers();
    this.isDragging = false;
    this.resetOrbit();
    this.smoothedSpeed = 0;
    this.followEntity = null;
    this.followOffset.set(0, 0, 0);
    this.followLookOffset.set(0, 0, 0);
    this.followBaseY = 0;
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
    if (this.cinematic) { this.updateCinematic(dt); return; }
    if (this.flightView && (this.activePresetId === 'chase' || this.activePresetId === 'action')) { this.updateFlight(dt, entity); return; }
    this.flying = false;
    const desiredPos = this._desiredPos;
    const desiredLook = this._desiredLook;

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

    switch (this.activePresetId) {
      case 'chase': {
        if (entity.body) { this.chaseCar(entity, dt, desiredPos, desiredLook); break; }
        this.speedFov += ((entity.boat ? Math.abs(entity.speed) / 31 * 15 : entity.fovBoost || 0) - this.speedFov) * (1 - Math.exp(-dt * 3));
        if (entity.type === 'person' && this.aimBlend > 0.001) this.aimFrame(entity);
        const dist = entity.chaseDistance * this.zoomMultiplier * (1 + Math.min(0.25, this.smoothedSpeed * 0.01));
        const height = entity.chaseHeight * this.zoomMultiplier + Math.sin(this.orbitPitchOffset) * dist * 0.85;
        const horizDist = Math.cos(this.orbitPitchOffset) * dist + speedLag;

        desiredPos.set(
          entity.position.x - Math.sin(totalYaw) * horizDist,
          Math.max(0.65, entity.position.y + height),
          entity.position.z - Math.cos(totalYaw) * horizDist
        );

        const lookUpBias = entity.type === 'helicopter' ? 0.2 : (entity.type === 'car' ? 0.52 : 0);
        const lookAhead = entity.type === 'person' ? 0.7 : 5.2;
        desiredLook.set(
          entity.position.x + Math.sin(totalYaw) * lookAhead,
          entity.position.y + entity.cameraTargetOffset.y + lookUpBias,
          entity.position.z + Math.cos(totalYaw) * lookAhead
        );
        if (entity.type === 'person' && this.aimBlend > 0.001) {
          desiredPos.lerp(this._aimPos, this.aimBlend);
          desiredLook.lerp(this._aimLook, this.aimBlend);
        }
        break;
      }

      case 'action': {
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
      const k = 1 - Math.exp(-dt * (entity.body ? 22 : entity.type === 'person' && (locked || this.aimBlend > 0.5) ? 24 : 8.5));
      // Off a ramp the camera does not rise with the car at once: the car climbs out of the frame, and lands back in it
      this.followBaseY += (entity.position.y - this.followBaseY) * (entity.body ? 1 - Math.exp(-dt * (entity.body.grounded ? 9 : 2.6)) : k);
      this.followOffset.lerp(desiredPos.sub(entity.position), k);
      this.followLookOffset.lerp(desiredLook.sub(entity.position), k);
      this.currentPos.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followOffset);
      this.currentLookAt.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followLookOffset);
      this.currentPos.y = Math.max(0.55, this.currentPos.y);
    } else {
      this.followEntity = null;
      const k = 1 - Math.exp(-dt * 8.5);
      this.currentPos.lerp(desiredPos, k);
      this.currentLookAt.lerp(desiredLook, k);
    }

    // Keep the third-person camera on the player's side of nearby solid geometry.
    if ((this.activePresetId === 'chase' || this.activePresetId === 'action') && this.controllerManager.playground) {
      const origin = entity.position.clone().add(new THREE.Vector3(0, entity.type === 'person' ? 1.5 : 1.2, 0));
      const direction = this.currentPos.clone().sub(origin);
      const length = direction.length();
      if (length > 0.01) {
        direction.divideScalar(length);
        let distance = length;
        for (const collider of this.controllerManager.nearColliders(origin.x, origin.z, length + 3)) {
          const box = new THREE.Box3(
            new THREE.Vector3(collider.minX - 0.15, (collider.minY ?? 0) - 0.1, collider.minZ - 0.15),
            new THREE.Vector3(collider.maxX + 0.15, collider.maxY + 0.1, collider.maxZ + 0.15)
          );
          if (box.containsPoint(origin)) continue;
          const hit = new THREE.Ray(origin, direction).intersectBox(box, new THREE.Vector3());
          if (hit) distance = Math.min(distance, Math.max(0.55, origin.distanceTo(hit) - 0.2));
        }
        if (distance < length) this.currentPos.copy(origin).addScaledVector(direction, distance);
      }
    }
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
    if (this.activePresetId === 'chase' && entity.body) {
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
    // Aiming narrows the view
    if (this.activePresetId === 'chase') {
      this.aimBlend += ((this.aimMode && entity.type === 'person' ? 1 : 0) - this.aimBlend) * (1 - Math.exp(-dt * 12));
      const fov = 56 - 12 * this.aimBlend + this.speedFov;
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

  // Behind a car. The camera holds its own heading, which trails the direction of travel: through a turn the car swings in
  // the frame, and in a slide it hangs sideways across the view while the camera keeps looking where it is going.
  chaseCar(car, dt, desiredPos, desiredLook) {
    const b = car.body;
    const vx = b.vx, vz = b.vz, speed = Math.hypot(vx, vz);
    if (this.carEntity !== car) {
      this.carEntity = car;
      this.carYaw = car.heading;
      this.carPull = this.carPullVel = this.carSide = this.carRoll = 0;
      this.carSpeed = speed;
    }
    const delta = (a, c) => Math.atan2(Math.sin(c - a), Math.cos(c - a));
    const reversing = car.speed < -2;
    const travel = speed > 3 ? Math.atan2(vx, vz) + (reversing ? Math.PI : 0) : car.heading;
    const weight = Math.min(1, speed / 16) * (b.grounded ? 0.78 : 0.95);
    const follow = car.heading + delta(car.heading, travel) * weight;
    const lag = 1 - Math.exp(-dt * (reversing ? 2.2 : 3.4 + Math.min(2.6, speed * 0.04)));
    this.carYaw += delta(this.carYaw, follow) * lag;
    const wantBack = this.controllerManager.keys.down ? 1 : 0;
    this.lookBack += (wantBack - this.lookBack) * (1 - Math.exp(-dt * 16));
    const yaw = this.carYaw + this.orbitYawOffset + (this.lookBack > 0.5 ? Math.PI : 0);

    // The distance is a spring: it stretches as the car pulls away and closes under braking
    const acceleration = dt > 0 ? (speed - this.carSpeed) / dt : 0;
    this.carSpeed = speed;
    const wanted = Math.max(-0.9, Math.min(1.5, acceleration * 0.11));
    this.carPullVel += ((wanted - this.carPull) * 34 - this.carPullVel * 9) * dt;
    this.carPull += this.carPullVel * dt;

    const span = Math.min(1, speed / 75);
    const distance = car.chaseDistance * this.zoomMultiplier * (1 + span * 0.2) + this.carPull;
    const lift = car.chaseHeight * this.zoomMultiplier * (1 - span * 0.14) + Math.sin(this.orbitPitchOffset - 0.09) * distance * 0.85;
    desiredPos.set(car.position.x - Math.sin(yaw) * distance, Math.max(0.7, car.position.y + lift), car.position.z - Math.cos(yaw) * distance);

    // Ahead of the car, and leaning into the corner it is taking
    const ahead = 6 + speed * 0.22;
    const lateral = Math.max(-1, Math.min(1, b.wy * speed / 12));
    this.carSide += (lateral * 1.5 - this.carSide) * (1 - Math.exp(-dt * 4));
    const side = this.carSide * (this.lookBack > 0.5 ? -1 : 1);
    desiredLook.set(
      car.position.x + Math.sin(yaw) * ahead + Math.cos(yaw) * side,
      car.position.y + car.cameraTargetOffset.y + 0.34,
      car.position.z + Math.cos(yaw) * ahead - Math.sin(yaw) * side
    );
    this.carRoll += ((b.grounded ? -lateral * 0.028 : 0) - this.carRoll) * (1 - Math.exp(-dt * 5));

    const top = Math.max(car.tune.top, 50);
    const rush = Math.min(1.2, speed / top) ** 1.5;
    const wide = rush * 25 + (b.nitro ? 9 : 0);
    this.speedFov += (wide - this.speedFov) * (1 - Math.exp(-dt * (wide > this.speedFov ? 2.6 : 3.6)));
    const road = b.wheels[0].rough ?? 0;
    this.rumble = (rush * 0.016 + (speed > 4 ? road * Math.min(1, speed / 20) * 0.7 : 0)) * (b.grounded ? 1 : 0.2) * (b.nitro ? 1.8 : 1);
  }

  // Over-the-shoulder framing: orbit a pivot at the right shoulder, pitch from the mouse
  aimFrame(entity) {
    const yaw = this.footYaw, pitch = this.orbitPitchOffset;
    const lx = Math.sin(yaw) * Math.cos(pitch), ly = -Math.sin(pitch), lz = Math.cos(yaw) * Math.cos(pitch);
    const px = entity.position.x - Math.cos(yaw) * 0.55, py = entity.position.y + 1.58, pz = entity.position.z + Math.sin(yaw) * 0.55;
    this._aimPos.set(px - lx * 2.35, py - ly * 2.35, pz - lz * 2.35);
    this._aimLook.set(px + lx * 30, py + ly * 30, pz + lz * 30);
  }

  addShake(amount) {
    this.shake = Math.min(1.6, this.shake + amount);
  }
}

export { CAMERA_PRESETS, CameraSystem };
