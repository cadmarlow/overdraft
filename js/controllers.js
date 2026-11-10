import * as THREE from 'three/webgpu';
import { buildCarDetails, poseCarDetails } from './car-details.js';
import {
  ISLAND_BOUNDS,
  WATERFRONT_PIERS,
  getIslandBoundsAtZ,
  isTypingInField,
  blockAt,
  streetZ
} from './city-config.js';
import { onRoundedBlock } from './ground-plan.js';
import { cityUniforms, createCarPaintMaterial, createContactShadowMaterial, createPersonContactShadowMaterial } from './tsl-materials.js';
import {
  BURNT, carModels, carSpecs, createBodyMaterial, createBurntWheelMaterial, createGlassMaterial, createSourcePartMaterial, createWheelMaterial,
  trafficMaterial
} from './car-assets.js';
import { BUS_BURNT, BUS_SPEC, buildBusWheelGeo, buildLoftedBusBodyGeometry, createLoftedBusMaterial } from './bus.js';
import { createBody, impactBody, makeTune, settleBody, stepCar } from './car-physics.js';
import { buildCabin, poseCabin } from './car-cabin.js';
import {
  buildHelicopterBodyGeometry,
  buildHelicopterMainRotorGeometry,
  buildHelicopterTailRotorGeometry,
  createLoftedHelicopterMaterial
} from './helicopter.js';
import { PersonCrowd, PersonRig } from './pedestrians.js';
import { HEADLIGHTS, createVehicleHeadlight, placeVehicleHeadlight } from './vehicle-lights.js';
import { createPlane, posePlane } from './airplane.js';
import { stepPlane } from './flight.js';
import { polygonContact, roofAt, roofColliderAt } from './building-collision.js';
import { rampRise } from './ramps.js';
import { WATER, stepBoat } from './boat.js';
import { sealEffect } from './effect-outputs.js';

// A burnt-out city bus as the car layer sees one (createCarEntity, burnt): the street bus's own size and axles
const BUS_WRECK_SPEC = (() => {
  const s = BUS_SPEC, x = s.wheelX, r = s.wheelRadius, z = s.wheelZ;
  return {
    name: 'bus', halfW: 1.3, zFront: s.zFront, zRear: s.zRear, height: 3.23, sill: 0.35,
    wheelX: x, wheelXr: x, wheelZf: z, wheelZr: -z, wheelRadius: r, wheelZ: z, wheelMid: 0, roofZ: 0,
    doors: [s.frontDoor[1], s.frontDoor[0]], wheels: [[-x, r, z], [x, r, z], [-x, r, -z], [x, r, -z]]
  };
})();
let busWreckBody = null;
const busWreckWheels = [null, null];

// Player models, animation and movement for walking, driving, cycling and flying.

// Spawn on 5th Ave at 37th St, facing south down the avenue toward the Empire State Building (34th St)
const SPAWN_Z = streetZ(37);
const groundCollider = { type: 'ground' };

const CAR_LABELS = {
  sedan: 'Valmont · Écume', suv: 'Brisant · Récif', taxi: 'Valmont · Cab 7', pickup: 'Gréville · Falaise', van: 'Hauturier · Cargo', minivan: 'Gréville · Escale',
  hatch: 'Valmont · Ressac', compact: 'Gréville · Galet', wagon: 'Valmont · Sillage', offroad: 'Brisant · Marais', muscle: 'Brisant · Tempête', sport: 'Corsaire · Foudre',
  super: 'Corsaire · Zénith', truck: 'Hauturier · Fret', delivery: 'Hauturier · Tournée'
};
const CAR_DRIVE = {
  speed: 36, reverseSpeed: 10.5, acceleration: 4.5,
  powerSpeed: 14.5, // Above 52 km/h, engine power limits acceleration.
  rolling: 0.18, drag: 0.0012, coast: 0.6, brake: 9,
  wheelbase: 2.76, grip: 9.5, cornering: 10.5 // Wheelbase (m), tire and steering acceleration limits (m/s²).
};
const BICYCLE_DRIVE = {
  speed: 19, reverseSpeed: 4.5, acceleration: 9,
  rolling: 0.08, drag: 0.004, coast: 0.2, brake: 7.5 // Backward input is scaled to 0.6, giving 4.5 m/s² braking.
};

function driveSpeed(speed, throttle, dt, drive) {
  // Turning can project tiny sideways motion back into speed after braking to zero.
  // Treat a crawl as stopped when changing direction, so this cannot hold the brakes forever.
  if (speed * throttle < 0 && Math.abs(speed) < 0.05) speed = 0;
  const braking = speed * throttle < 0;
  const magnitude = Math.abs(speed);
  // Extra resistance on release gives a stronger slowdown while coasting.
  const deceleration = drive.rolling + (!throttle ? drive.coast : braking ? Math.abs(throttle) * drive.brake : 0);
  // Constant rolling resistance and quadratic air drag, without crossing zero or large-dt instability.
  const coasting = Math.max(0, magnitude - deceleration * dt) / (1 + drive.drag * magnitude * dt);
  if (!throttle || braking) return Math.sign(speed) * coasting;

  const limit = throttle < 0 ? drive.reverseSpeed : drive.speed;
  let acceleration = drive.acceleration;
  if (drive.powerSpeed) acceleration *= drive.powerSpeed / Math.max(drive.powerSpeed, magnitude);
  // Collision momentum above the powered limit decays naturally instead of being clamped.
  return Math.sign(throttle) * Math.min(Math.max(limit, coasting), coasting + Math.abs(throttle) * acceleration * dt);
}

// Walking surface for the player's pedestrian (its rig samples it around its feet)
const personGround = (controllers, x, z) => controllers.personGroundAt(x, z);

// Static colliders are indexed into square cells of this size (nearColliders, roofHeight)
const COLLIDER_CELL = 48;
const cellKey = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);

// What the eye expects of a car's weight, on top of the physics' own (stiffened) roll: the body leans out of a corner,
// dives under the brakes and squats on the power, on a spring of its own that overshoots a touch and settles. The wheels
// stay where the physics put them.
const LEAN = { hz: 1.5, damping: 0.42 };
function leanBody(c, dt) {
  const b = c.body, t = c.tune, lean = c.lean ??= { roll: 0, rollV: 0, pitch: 0, pitchV: 0, speed: c.speed, accel: 0 };
  if (!(dt > 0)) return;
  const step = Math.min(dt, 0.05);
  const grounded = b.grounded >= 3;
  // Longitudinal acceleration, smoothed: the speed alone is noisy step to step
  lean.accel += ((c.speed - lean.speed) / step - lean.accel) * Math.min(1, step * 12);
  lean.speed = c.speed;
  const g = 9.81, k = (Math.PI * 2 * LEAN.hz) ** 2, d = 2 * LEAN.damping * Math.PI * 2 * LEAN.hz;
  const roll = grounded ? Math.max(-1.3, Math.min(1.3, b.wy * c.speed / g)) * t.leanRoll : 0;
  const pitch = grounded ? Math.max(-1.2, Math.min(1.2, -lean.accel / g * Math.sign(c.speed || 1))) * t.leanPitch : 0;
  for (let i = 0, n = Math.ceil(dt / 0.017); i < n; i++) {
    const h = step / n;
    lean.rollV += ((roll - lean.roll) * k - lean.rollV * d) * h; lean.roll += lean.rollV * h;
    lean.pitchV += ((pitch - lean.pitch) * k - lean.pitchV * d) * h; lean.pitch += lean.pitchV * h;
  }
  c.bodyPivot.rotation.set(lean.pitch, 0, lean.roll);
}

// The planar car state back on its meshes: the chassis in its full attitude under the yaw-only root, each wheel on its spring
const FRAME_SPIN = 0.62;
function poseCar(c, dt) {
  const b = c.body, q = b.q, s = Math.sin(c.heading * 0.5), h = Math.cos(c.heading * 0.5);
  c.chassisPivot.quaternion.set(h * q[0] - s * q[2], h * q[1] - s * q[3], h * q[2] + s * q[0], h * q[3] + s * q[1]);
  if (c.bodyPivot) leanBody(c, dt);
  if (c.cabin) poseCabin(c.cabin, b.steer, b);
  for (let i = 0; i < 4; i++) {
    const w = b.wheels[i], view = c.wheels[i];
    view.steerPivot.position.y = view.restY + w.travel - (w.burst ? 0.1 : 0);
    if (view.isFront) view.steerPivot.rotation.y = w.steer;
    view.spin = (view.spin + Math.max(-FRAME_SPIN, Math.min(FRAME_SPIN, (w.spin || 0) * dt))) % (Math.PI * 2);
    view.tire.rotation.x = view.spin;
  }
  if (c.details) poseCarDetails(c.details, b, dt);
  if (c.shadow) {
    const lift = c.position.y - (b.wheels[0].gy + b.wheels[3].gy) * 0.5;
    c.shadow.visible = lift < 3.5 && b.r[4] > 0.2;
    c.shadow.position.y = 0.02 - lift;
  }
  if (c.carState) {
    c.carState.value.x = b.brake || (b.handbraking && Math.abs(c.speed) > 1) ? 1 : 0;
    c.carState.value.w = b.reversing && b.throttle > 0.05 ? 1 : 0;
  }
}

function collisionBody(mode, radius, heading, margin = 0, halfW = 0.86, halfL = 2.18) {
  const car = mode === 'car';
  const sin = Math.sin(heading), cos = Math.cos(heading);
  const hx = halfW + margin, hz = halfL + margin;
  return {
    car, sin, cos, hx, hz, radius: radius + margin,
    extX: car ? Math.abs(cos) * hx + Math.abs(sin) * hz : radius + margin,
    extZ: car ? Math.abs(sin) * hx + Math.abs(cos) * hz : radius + margin,
    bottom: mode === 'helicopter' ? -0.25 : 0,
    top: mode === 'helicopter' ? 3.2 : car ? 1.8 : 1.9
  };
}

// A trunk or a pole against a walker's circle or a car's rectangle; the normal pushes the body away from it
function roundContact(c, x, z, body, contact) {
  const dx = x - c.cx, dz = z - c.cz;
  if (!body.car) {
    const distance = Math.hypot(dx, dz), reach = c.round + body.radius;
    if (distance >= reach) return false;
    if (contact) {
      contact.nx = distance > 1e-6 ? dx / distance : 1;
      contact.nz = distance > 1e-6 ? dz / distance : 0;
      contact.depth = reach - distance;
    }
    return true;
  }
  // The obstacle in the car's frame: across, then along it
  const { sin, cos, hx, hz } = body;
  const lx = -dx * cos + dz * sin, lz = -dx * sin - dz * cos;
  const ex = lx - Math.max(-hx, Math.min(hx, lx)), ez = lz - Math.max(-hz, Math.min(hz, lz));
  const distance = Math.hypot(ex, ez);
  if (distance >= c.round) return false;
  if (!contact) return true;
  let nx = 0, nz = 0;
  if (distance > 1e-6) {
    nx = -ex / distance; nz = -ez / distance;
    contact.depth = c.round - distance;
  } else if (hx - Math.abs(lx) <= hz - Math.abs(lz)) {
    nx = lx > 0 ? -1 : 1;
    contact.depth = hx - Math.abs(lx) + c.round;
  } else {
    nz = lz > 0 ? -1 : 1;
    contact.depth = hz - Math.abs(lz) + c.round;
  }
  contact.nx = nx * cos + nz * sin;
  contact.nz = -nx * sin + nz * cos;
  return true;
}

// Movement and teleports share exact footprint checks after rejecting distant bounds.
// Walking/cycling/flying use circles; cars use oriented rectangles.
function buildingContact(c, x, y, z, body, contact) {
  if (y + body.bottom >= c.maxY || y + body.top <= (c.minY ?? 0)) return false;
  if (x + body.extX <= c.minX || x - body.extX >= c.maxX || z + body.extZ <= c.minZ || z - body.extZ >= c.maxZ) return false;
  if (c.round) return roundContact(c, x, z, body, contact);
  if (c.polygon) return polygonContact(c.polygon, x, z, body, contact);
  const o = c.obb;
  const cs = o ? o.cs : 1, sn = o ? o.sn : 0;
  const hx = o ? o.hx : (c.maxX - c.minX) * 0.5;
  const hz = o ? o.hz : (c.maxZ - c.minZ) * 0.5;
  const dx = x - (o ? o.cx : (c.minX + c.maxX) * 0.5);
  const dz = z - (o ? o.cz : (c.minZ + c.maxZ) * 0.5);
  const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
  let nx = 0, nz = 0, depth = Infinity;
  if (body.car) {
    const ls = body.sin * cs - body.cos * sn, lc = body.sin * sn + body.cos * cs;
    for (let axis = 0; axis < 4; axis++) {
      const ax = axis === 0 ? 1 : axis === 1 ? 0 : axis === 2 ? lc : ls;
      const az = axis === 0 ? 0 : axis === 1 ? 1 : axis === 2 ? -ls : lc;
      const distance = lx * ax + lz * az;
      const overlap = hx * Math.abs(ax) + hz * Math.abs(az)
        + body.hx * Math.abs(ax * lc - az * ls) + body.hz * Math.abs(ax * ls + az * lc) - Math.abs(distance);
      if (overlap <= 0) return false;
      if (overlap < depth) {
        depth = overlap;
        const sign = distance <= 0 ? -1 : 1;
        nx = ax * sign; nz = az * sign;
      }
    }
  } else {
    const qx = lx - Math.max(-hx, Math.min(hx, lx));
    const qz = lz - Math.max(-hz, Math.min(hz, lz));
    const distance = Math.hypot(qx, qz);
    if (distance >= body.radius) return false;
    if (distance > 0) {
      nx = qx / distance; nz = qz / distance;
      depth = body.radius - distance;
    } else if (hx - Math.abs(lx) <= hz - Math.abs(lz)) {
      nx = lx <= 0 ? -1 : 1;
      depth = hx - Math.abs(lx) + body.radius;
    } else {
      nz = lz <= 0 ? -1 : 1;
      depth = hz - Math.abs(lz) + body.radius;
    }
  }
  if (contact) {
    contact.nx = nx * cs + nz * sn;
    contact.nz = -nx * sn + nz * cs;
    contact.depth = depth;
  }
  return true;
}

class ThirdPersonControllerManager {
  constructor(scene, colliders = []) {
    this.scene = scene;
    this.colliders = colliders;
    this._colliderCells = null; // built on first use, see nearColliders()
    this.activeMode = 'person'; // The playable character is the persistent owner of vehicle interactions.

    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false,
      sprint: false,
      handbrake: false,
      // on foot (gameplay.js): Space runs, Shift jumps; in vehicles Space and Shift keep up/sprint
      run: false,
      jump: false
    };

    this.entities = {
      person: this.createPersonEntity(),
      car: this.createCarEntity(),
      cyclist: this.createCyclistEntity(),
      helicopter: this.createHelicopterEntity(),
      plane: createPlane(scene)
    };

    Object.values(this.entities).forEach((ent) => {
      if (ent.mesh) {
        ent.mesh.traverse((child) => {
          if (
            child.isMesh &&
            !child.material?.isMeshBasicNodeMaterial &&
            child.material?.type !== 'MeshBasicNodeMaterial' &&
            !child.material?.transparent
          ) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
      }
    });

    this.bindKeyboard();
  }

  setCollisionListener(listener) {
    this._collisionListener = typeof listener === 'function' ? listener : null;
    this._collisionEvent ??= { a: null, b: null, kind: '', x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, speed: 0 };
  }

  // Reuse one synchronous event; consumers must copy retained fields. Normal points from b toward a.
  reportCollision(a, b, kind, x, y, z, nx, ny, nz, speed) {
    if (!this._collisionListener || speed <= 0.5) return;
    const event = this._collisionEvent;
    event.a = a; event.b = b; event.kind = kind;
    event.x = x; event.y = y; event.z = z;
    event.nx = nx; event.ny = ny; event.nz = nz; event.speed = speed;
    this._collisionListener(event);
  }

  bindKeyboard() {
    const bindings = {
      forward: ['KeyW', 'ArrowUp'],
      backward: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      up: ['Space'],
      down: ['KeyQ', 'KeyC'],
      sprint: ['ShiftLeft', 'ShiftRight'],
      handbrake: ['ControlLeft', 'ControlRight'],
      run: ['Space'],
      jump: ['ShiftLeft', 'ShiftRight']
    };
    // a key may drive several actions (Space: up in the air and at the wheel, run on foot)
    const actionsByCode = new Map();
    for (const [action, codes] of Object.entries(bindings)) for (const code of codes) actionsByCode.set(code, [...(actionsByCode.get(code) ?? []), action]);
    this._pressedCodes = new Set();
    this._keyboardKeys = {};
    this._touchKeys = {};
    this._gamepadKeys = {};

    const onKey = (e, isDown) => {
      const actions = actionsByCode.get(e.code);
      if (!actions || (isDown && isTypingInField(e))) return;
      if (isDown) this._pressedCodes.add(e.code);
      else this._pressedCodes.delete(e.code);
      for (const action of actions) {
        // Releasing one binding must not cancel another key held for the same action.
        this._keyboardKeys[action] = bindings[action].some((code) => this._pressedCodes.has(code));
        this._blendInput(action);
      }
    };

    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
    window.addEventListener('blur', () => this.resetInput());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.resetInput();
    });
  }

  _blendInput(action) {
    const keyboard = this._keyboardKeys[action] || false;
    const touch = this._touchKeys[action] || false;
    const gamepad = this._gamepadKeys[action] || false;
    const strength = Math.max(keyboard, touch, gamepad);
    // Preserve digital button values while allowing either analog source to be strongest.
    this.keys[action] = keyboard === true || touch === true || gamepad === true ? true : strength || false;
  }

  _setAnalogInput(source, action, value) {
    if (!Object.hasOwn(this.keys, action)) return;
    const strength = Number(value);
    source[action] = typeof value === 'boolean' ? value : Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
    this._blendInput(action);
  }

  setTouchInput(action, value) {
    this._setAnalogInput(this._touchKeys, action, value);
  }

  setGamepadInput(action, value) {
    this._setAnalogInput(this._gamepadKeys, action, value);
  }

  clearTouchInput() {
    this._touchKeys = {};
    for (const action of Object.keys(this.keys)) this._blendInput(action);
  }

  clearGamepadInput() {
    this._gamepadKeys = {};
    for (const action of Object.keys(this.keys)) this._blendInput(action);
  }

  resetInput() {
    this._pressedCodes.clear();
    this._keyboardKeys = {};
    this._touchKeys = {};
    this._gamepadKeys = {};
    for (const action of Object.keys(this.keys)) this.keys[action] = false;
  }

  setMode(mode) {
    if (!this.entities[mode]) return;
    this.activeMode = mode;
    const active = this.entities[mode];
    if (active.mesh) active.mesh.visible = true;
    if (active.helmet && !active.riderless) active.helmet.visible = true;
    if (mode === 'person') active._charHidden = false;
    else if (mode === 'cyclist') {
      active._riderHidden = false;
      active._posedX = NaN;
    }
    const car = this.entities.car;
    if (mode !== 'car' && car?.carState) car.carState.value.x = car.carState.value.w = 0;
  }

  getActiveEntity() {
    return this.entities[this.activeMode];
  }

  teleportActiveTo(x, z, heading = Math.PI, savedAltitude = null) {
    const ent = this.getActiveEntity();
    this.resetInput();
    if (!Number.isFinite(heading)) heading = ent.heading;
    const heli = this.activeMode === 'helicopter';
    const altitude = heli ? Math.max(0.25, Math.min(380, savedAltitude ?? Math.max(92, ent.position.y))) : 0;
    const destination = this.findTeleportPosition(x, z, heading, altitude);
    if (destination) {
      ent.position.x = destination.x;
      ent.position.z = destination.z;
      ent.heading = heading;
      ent.position.y = heli ? altitude : this.getGroundHeight(destination.x, destination.z, this.activeMode);
    }
    ent.speed = 0;
    if (this.activeMode === 'person') {
      ent.verticalVel = 0;
      ent._charHidden = false;
      if (ent.mesh) ent.mesh.visible = true;
      ent.rig.reset(ent.position.x, ent.position.z, ent.heading, personGround, this);
      ent.crowd.begin();
      ent.crowd.add(ent.rig, 0);
      ent.crowd.end();
    } else if (this.activeMode === 'car') {
      ent.prevX = ent.position.x;
      ent.prevZ = ent.position.z;
      ent.vx = ent.vz = ent.angularVel = ent.steerAngle = 0;
      ent.pitchVel = ent.rollVel = ent.heaveY = ent.heaveVel = 0;
      ent.chassisPivot.rotation.x = ent.chassisPivot.rotation.z = 0;
      ent.chassisPivot.position.y = 0;
      ent.lastCollisionSpark = null;
      if (ent.body) settleBody(ent, ent.heading);
      for (const wheel of ent.wheels) if (wheel.isFront) wheel.steerPivot.rotation.y = 0;
      if (ent.carState) ent.carState.value.x = ent.carState.value.w = 0;
    } else if (this.activeMode === 'cyclist') {
      ent.leanAngle = ent.leanPivot.rotation.z = 0;
      ent._riderHidden = false;
      ent._posedX = NaN;
      if (ent.helmet) ent.helmet.visible = true;
    } else if (heli) {
      ent.verticalSpeed = ent.pitchAngle = ent.rollAngle = 0;
      ent.tiltPivot.rotation.x = ent.tiltPivot.rotation.z = 0;
      ent.tiltPivot.position.y = 0;
    }
    ent.mesh.position.copy(ent.position);
    ent.mesh.rotation.y = ent.heading;
    return { x: ent.position.x, z: ent.position.z };
  }

  // Find a fully clear arrival before moving the player. Sequential collision pushes can leave a player trapped
  // between overlapping buildings, so test whole candidate footprints instead; retain the old position if none fits.
  findTeleportPosition(x, z, heading, altitude) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const heli = this.activeMode === 'helicopter';
    const radius = heli ? 4.5 : this.activeMode === 'person' ? 0.48 : 0.65;
    const sinH = Math.sin(heading), cosH = Math.cos(heading);
    const shape = collisionBody(this.activeMode, radius, heading, 0.1);
    const reach = Math.max(shape.extX, shape.extZ);
    const margin = heli ? 6000 : 0;
    const entity = this.getActiveEntity();
    // Conservative body cylinders, including the taxi's corners, bicycle wheels and helicopter tail/rotor.
    const body = { person: [0.48, 1.9], car: [2.4, 1.9], cyclist: [1.0, 1.9], helicopter: [6.2, 3.2] };
    const others = Object.values(this.entities).filter(e => e !== entity).map(e => ({
      x: e.position.x, z: e.position.z, radius: (body[e.type] ?? body.helicopter)[0],
      bottom: e.position.y - (e.type === 'helicopter' ? 0.7 : 0), top: e.position.y + (body[e.type] ?? body.helicopter)[1]
    }));
    const cameraBack = Math.cos(0.09) * entity.chaseDistance;
    const cameraUp = entity.chaseHeight + Math.sin(0.09) * entity.chaseDistance * 0.85;
    const clampPoint = (px, pz) => {
      pz = Math.max(ISLAND_BOUNDS.minZ + (heli ? -6000 : 30), Math.min(ISLAND_BOUNDS.maxZ + margin, pz));
      px = Math.max(ISLAND_BOUNDS.minX - margin, Math.min(ISLAND_BOUNDS.maxX + margin, px));
      if (!heli && getIslandBoundsAtZ) {
        const shore = getIslandBoundsAtZ(pz);
        const west = shore.westX + 8, east = shore.eastX - 8;
        if (west > east) return null;
        px = Math.max(west, Math.min(east, px));
      }
      return { x: px, z: pz };
    };
    const clear = (p) => {
      if (!p) return false;
      const baseY = heli ? altitude : this.getGroundHeight(p.x, p.z, this.activeMode);
      // Keep other player models out of both the arrival and its default chase view. A corridor also prevents a
      // parked car between camera and character from hiding the character even when the camera itself is outside it.
      const viewTop = baseY + Math.max(body[entity.type][1], cameraUp);
      for (const other of others) {
        if (other.bottom > viewTop + 0.3 || other.top < baseY - (heli ? 0.7 : 0) - 0.3) continue;
        const dx = other.x - p.x, dz = other.z - p.z;
        const back = Math.max(0, Math.min(cameraBack, -dx * sinH - dz * cosH));
        if (Math.hypot(dx + sinH * back, dz + cosH * back) < other.radius + Math.max(body[entity.type][0], 0.5) + 0.1) return false;
      }
      for (const c of this.nearColliders(p.x, p.z, reach)) {
        if (buildingContact(c, p.x, baseY, p.z, shape)) return false;
      }
      return true;
    };
    const origin = clampPoint(x, z);
    if (clear(origin)) return origin;
    // Four-metre rings cover nearby streets and courtyards, with bounded work even for a click inside a large block.
    const cx = origin ? origin.x : Math.max(ISLAND_BOUNDS.minX, Math.min(ISLAND_BOUNDS.maxX, x));
    const cz = origin ? origin.z : Math.max(ISLAND_BOUNDS.minZ + 30, Math.min(ISLAND_BOUNDS.maxZ, z));
    for (let distance = 4; distance <= 256; distance += 4) {
      for (let i = 0; i < 32; i++) {
        const angle = i * Math.PI / 16;
        const p = clampPoint(cx + Math.cos(angle) * distance, cz + Math.sin(angle) * distance);
        if (clear(p)) return p;
      }
    }
    return null;
  }

  // =========================================================================
  // 1. PERSON (SKINNED NYC PEDESTRIAN WITH PLANTED-FOOTSTEP IK GAIT, see pedestrians.js)
  // =========================================================================
  createPersonEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerPerson';

    // One skinned person, posed in world space every frame by its rig (walk, run, turn, jump)
    const crowd = new PersonCrowd(1, { farDistance: Infinity });
    crowd.meshes.forEach((m) => this.scene.add(m));
    const rig = new PersonRig({ seed: 9.73, scale: 0.97, girth: 1.03, hair: 0.12, armSwing: 0.85 });

    // Soft Under-Foot Contact Shadow (AO)
    const shadowGeo = new THREE.PlaneGeometry(0.8, 0.8);
    shadowGeo.rotateX(-Math.PI * 0.5);
    const pedShadow = new THREE.Mesh(shadowGeo, createPersonContactShadowMaterial());
    pedShadow.position.y = 0.02;
    pedShadow.renderOrder = 998;
    root.add(pedShadow);

    this.scene.add(root);

    return {
      type: 'person',
      label: 'À pied',
      mesh: root,
      shadow: pedShadow,
      crowd,
      rig,
      // The west sidewalk of 5th Avenue at 37th Street, facing downtown: the avenue, its traffic and the Empire State
      // Building ahead, and no sidewalk shed over the first frame
      position: new THREE.Vector3(-12.2, ISLAND_BOUNDS.sidewalkHeight, SPAWN_Z - 26),
      heading: 0,
      speed: 0,
      verticalVel: 0,
      cameraTargetOffset: new THREE.Vector3(0, 1.55, 0),
      chaseDistance: 4.3,
      chaseHeight: 1.95
    };
  }

  // =========================================================================
  // 2. CAR (3D LOFTED SCULPTED NYC MEDALLION YELLOW TAXI SEDAN)
  // =========================================================================
  // lite: a car knocked out of the traffic mid-game. It draws with the street's own materials, which are already compiled, so
  // that a pile-up never stalls a frame; it gives up dents, lamps and a door that opens.
  // burnt: what a fire left of a vehicle of that kind, a city bus ('bus') included: the same body, drawn the lite way
  // with the street material's burnt state (car-assets.js BURNT, bus.js BUS_BURNT) on charred wheels.
  createCarEntity({ kind = 'taxi', paint = 0xffbe14, livery = 0, handling = kind, lite = false, burnt = false } = {}) {
    if (burnt) lite = true;
    const bus = burnt && kind === 'bus';
    const root = new THREE.Group();
    root.name = 'PlayerTaxiCar';

    const chassisPivot = new THREE.Group();
    root.add(chassisPivot);
    // The bodywork leans on its springs over the wheels (poseCar): everything but the wheels hangs from here
    const bodyPivot = new THREE.Group();
    chassisPivot.add(bodyPivot);

    const id = carModels[kind] ? kind : 'sedan';
    const model = bus ? null : carModels[id], spec = bus ? BUS_WRECK_SPEC : carSpecs[id];
    const paintMaterial = bus ? createLoftedBusMaterial() : lite ? trafficMaterial(id) : createBodyMaterial(model, { paint, livery });
    const mechanismMaterial = !lite && (model.steering || model.calipers?.some(Boolean)) ? createSourcePartMaterial(model) : null;
    let carBodyMesh, glassMaterial = null, cabin = null;
    if (bus) {
      // the street's own bus body (one geometry for every bus wreck), with a state of its own that says it burned
      const source = (busWreckBody ??= buildLoftedBusBodyGeometry());
      const shell = new THREE.BufferGeometry();
      for (const name of Object.keys(source.attributes)) if (name !== 'busState') shell.setAttribute(name, source.attributes[name]);
      shell.setIndex(source.index);
      shell.setAttribute('busState', new THREE.InstancedBufferAttribute(Float32Array.of(BUS_BURNT, 0, 0, 1), 4));
      carBodyMesh = new THREE.InstancedMesh(shell, paintMaterial, 1);
      carBodyMesh.setMatrixAt(0, new THREE.Matrix4());
      carBodyMesh.frustumCulled = false;
      bodyPivot.add(carBodyMesh);
    } else if (lite) {
      const shell = new THREE.BufferGeometry();
      // a car knocked loose is always close by: it keeps the level it had in traffic there
      const level = model.mid ?? model.shell;
      for (const name of ['position', 'normal', 'uv', 'flag']) shell.setAttribute(name, level.attributes[name]);
      shell.setIndex(level.index);
      const colour = new THREE.Color(paint);
      shell.setAttribute('paintColor', new THREE.InstancedBufferAttribute(Float32Array.of(colour.r, colour.g, colour.b), 3));
      shell.setAttribute('carState', new THREE.InstancedBufferAttribute(Float32Array.of(0, 0, 0, burnt ? BURNT : 0), 4));
      shell.setAttribute('carPose', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
      carBodyMesh = new THREE.InstancedMesh(shell, paintMaterial, 1);
      carBodyMesh.setMatrixAt(0, new THREE.Matrix4());
      carBodyMesh.frustumCulled = false;
      bodyPivot.add(carBodyMesh);
    } else {
      carBodyMesh = new THREE.Mesh(model.body, paintMaterial);
      glassMaterial = createGlassMaterial(model, paintMaterial);
      bodyPivot.add(carBodyMesh, new THREE.Mesh(model.glass, glassMaterial));
      if (spec.cabin) cabin = buildCabin(spec.cabin, bodyPivot, id, {
        sourceInterior: model.sourceInterior, steering: model.steering, material: mechanismMaterial
      });
    }
    carBodyMesh.castShadow = true;
    carBodyMesh.receiveShadow = true;
    const carState = lite ? null : paintMaterial.userData.carState;

    // The wheels hang from the chassis: they lean with it and travel on their own springs
    const wheels = [];
    // A car knocked loose keeps its own wheels (at the level it wore in the street). Their material is the model's
    // own, compiled behind the loading screen with the garage's cars: every model has one waiting there.
    const wheelMaterial = burnt ? createBurntWheelMaterial() : createWheelMaterial(model);
    spec.wheels.forEach(([x, y, z], i) => {
      const steerPivot = new THREE.Group();
      steerPivot.position.set(x, y, z);
      const wheelGeometry = bus ? (busWreckWheels[x < 0 ? 0 : 1] ??= buildBusWheelGeo(x < 0 ? -1 : 1))
        : lite ? (model.midWheels ?? model.wheels)[i] : model.wheels[i];
      const tire = new THREE.Mesh(wheelGeometry, wheelMaterial);
      tire.castShadow = true;
      tire.receiveShadow = true;
      steerPivot.add(tire);
      // Source calipers follow the steering knuckle, while the wheel and its brake rotor spin independently.
      if (!lite && model.calipers?.[i]) {
        const caliper = new THREE.Mesh(model.calipers[i], mechanismMaterial);
        caliper.name = 'SourceBrakeCaliper';
        caliper.castShadow = true;
        caliper.receiveShadow = true;
        steerPivot.add(caliper);
      }
      chassisPivot.add(steerPivot);
      wheels.push({ steerPivot, tire, isFront: i < 2, restY: y, spin: 0 });
    });
    const details = lite || model.calipers?.some(Boolean) ? null : buildCarDetails(model, chassisPivot, wheels);
    const tune = makeTune(handling, {
      halfW: spec.halfW, halfL: Math.max(spec.zFront, -spec.zRear), height: spec.height, sill: spec.sill,
      wheelX: (spec.wheelX + spec.wheelXr) / 2, wheelZf: spec.wheelZf, wheelZr: spec.wheelZr, wheelRadius: spec.wheelRadius
    });
    if (bus) tune.mass = 12000;

    // Ground contact shadow and paired headlight spotlights
    const carShadowGeo = new THREE.PlaneGeometry(spec.halfW * 2 + 0.38, spec.zFront - spec.zRear + 0.3);
    carShadowGeo.rotateX(-Math.PI * 0.5);
    const carShadow = new THREE.Mesh(carShadowGeo, createContactShadowMaterial());
    carShadow.position.set(0, 0.02, 0.0);
    carShadow.renderOrder = 998;
    root.add(carShadow);

    const headLights = [];
    for (const side of lite ? [] : [-1, 1]) {
      const spot = createVehicleHeadlight();
      placeVehicleHeadlight(spot, spec, side);
      bodyPivot.add(spot, spot.target);
      headLights.push(spot);
    }

    this.scene.add(root);

    return {
      type: 'car',
      kind,
      spec,
      paint,
      tune,
      body: createBody(tune),
      halfW: tune.halfW,
      halfL: tune.halfL,
      bodyMesh: carBodyMesh,
      paintMaterial,
      shadow: carShadow,
      label: bus ? 'Bus' : CAR_LABELS[kind] || 'Berline',
      mesh: root,
      chassisPivot,
      bodyPivot,
      cabin,
      glassMaterial,
      carState,
      headLights,
      wheels,
      details,
      position: new THREE.Vector3(3.6, 0.0, SPAWN_Z + 12),
      prevX: 3.6,
      prevZ: SPAWN_Z + 12,
      heading: 0,
      speed: 0,
      vx: 0,
      vz: 0,
      angularVel: 0,
      pitchVel: 0,
      rollVel: 0,
      heaveY: 0,
      heaveVel: 0,
      lastCollisionSpark: null,
      steerAngle: 0,
      wheelSpin: 0,
      nitro: 1,
      cameraTargetOffset: new THREE.Vector3(0, Math.max(0.8, spec.height * 0.62), 0),
      chaseDistance: 4.6 + (tune.halfL - 2) * 1.4 + spec.height * 0.55,
      chaseHeight: 1.05 + spec.height * 0.62
    };
  }

  // =========================================================================
  // 3. CYCLIST (3D LOFTED RIDER + ROAD/CITI BICYCLE)
  // =========================================================================
  createCyclistEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerCyclist';

    const leanPivot = new THREE.Group();
    root.add(leanPivot);

    const frameMat = createCarPaintMaterial(0x0078e8);
    const tireMat = new THREE.MeshStandardNodeMaterial({
      color: 0x181a1e,
      roughness: 0.60
    });
    const chromeMat = new THREE.MeshStandardNodeMaterial({
      color: 0xe0e8f0,
      roughness: 0.16,
      metalness: 0.78
    });
    const shortsMat = new THREE.MeshStandardNodeMaterial({
      color: 0x1c2028,
      roughness: 0.55
    });
    const helmetMat = new THREE.MeshStandardNodeMaterial({
      color: 0xf4f7fb,
      emissive: 0x181c22,
      roughness: 0.22,
      metalness: 0.25
    });

    const wheelTorusGeo = new THREE.TorusGeometry(0.35, 0.038, 12, 24);
    wheelTorusGeo.rotateY(Math.PI * 0.5);
    const rimTorusGeo = new THREE.TorusGeometry(0.31, 0.018, 8, 24);
    rimTorusGeo.rotateY(Math.PI * 0.5);

    const frontWheel = new THREE.Mesh(wheelTorusGeo, tireMat);
    frontWheel.add(new THREE.Mesh(rimTorusGeo, chromeMat));
    frontWheel.position.set(0, 0.38, 0.58);
    leanPivot.add(frontWheel);

    const rearWheel = new THREE.Mesh(wheelTorusGeo, tireMat);
    rearWheel.add(new THREE.Mesh(rimTorusGeo, chromeMat));
    rearWheel.position.set(0, 0.38, -0.58);
    leanPivot.add(rearWheel);

    // Rear red LED safety strobe on seatpost
    const tailLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0xff1e26 })
    );
    tailLed.position.set(0, 0.86, -0.32);
    leanPivot.add(tailLed);

    const topTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 10), frameMat);
    topTube.rotation.x = Math.PI * 0.46;
    topTube.position.set(0, 0.78, 0.04);
    leanPivot.add(topTube);

    const downTube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.78, 10), frameMat);
    downTube.rotation.x = Math.PI * 0.28;
    downTube.position.set(0, 0.58, 0.16);
    leanPivot.add(downTube);

    const seatTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.64, 10), frameMat);
    seatTube.rotation.x = -0.22;
    seatTube.position.set(0, 0.66, -0.22);
    leanPivot.add(seatTube);

    const saddle = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 8, 10), shortsMat);
    saddle.rotation.x = Math.PI * 0.5;
    saddle.scale.set(1.15, 1.0, 0.55);
    saddle.position.set(0, 0.96, -0.28);
    leanPivot.add(saddle);

    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.68, 10), chromeMat);
    fork.rotation.x = -0.24;
    fork.position.set(0, 0.68, 0.48);
    leanPivot.add(fork);

    const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.48, 10), chromeMat);
    handlebar.rotation.z = Math.PI * 0.5;
    handlebar.position.set(0, 0.98, 0.40);
    leanPivot.add(handlebar);

    // Pedal cranks at the bottom bracket (they turn with the pedal phase, the pedals stay level)
    const bikeFrame = {
      seat: new THREE.Vector3(0, 0.98, -0.28),
      bars: new THREE.Vector3(0, 0.98, 0.4),
      gripHalf: 0.22,
      bracket: new THREE.Vector3(0, 0.34, -0.145),
      crankLength: 0.17
    };
    const crankPivot = new THREE.Group();
    crankPivot.position.copy(bikeFrame.bracket);
    const crankGeo = new THREE.BoxGeometry(0.016, bikeFrame.crankLength, 0.03).translate(0, -bikeFrame.crankLength / 2, 0);
    const pedalGeo = new THREE.BoxGeometry(0.09, 0.018, 0.07);
    const pedals = [];
    for (const side of [1, -1]) {
      const arm = new THREE.Group();
      arm.rotation.x = side > 0 ? 0 : Math.PI;
      const crank = new THREE.Mesh(crankGeo, chromeMat);
      crank.position.x = side * 0.065;
      const pedal = new THREE.Mesh(pedalGeo, tireMat);
      pedal.position.set(side * 0.1, -bikeFrame.crankLength, 0);
      arm.add(crank, pedal);
      crankPivot.add(arm);
      pedals.push(pedal);
    }
    leanPivot.add(crankPivot);

    // Skinned rider (see pedestrians.js), posed every frame with its hands on the grips and feet on the pedals; the
    // helmet rides on its head
    const riderCrowd = new PersonCrowd(1, { farDistance: Infinity });
    riderCrowd.meshes.forEach((m) => this.scene.add(m));
    const riderRig = new PersonRig({ seed: 12.8, scale: 1.0, girth: 0.97, hair: 0.1 });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 12), helmetMat);
    helmet.scale.set(0.95, 0.68, 1.28);
    this.scene.add(helmet);

    const bikeShadowGeo = new THREE.PlaneGeometry(0.85, 2.25);
    bikeShadowGeo.rotateX(-Math.PI * 0.5);
    const bikeShadow = new THREE.Mesh(bikeShadowGeo, createContactShadowMaterial());
    bikeShadow.position.set(0, 0.02, 0.0);
    bikeShadow.renderOrder = 998;
    root.add(bikeShadow);

    const headLight = new THREE.SpotLight(0xf2f7ff, 0, 20, 0.34, 0.76, 1.25);
    headLight.position.set(0, 1.32, 0.62);
    headLight.target.position.set(0, 0.0, 7.6);
    leanPivot.add(headLight, headLight.target);

    this.scene.add(root);

    return {
      type: 'cyclist',
      label: 'NYC Bike Lane Cyclist',
      mesh: root,
      leanPivot,
      frontWheel,
      rearWheel,
      crankPivot,
      pedals,
      bikeFrame,
      riderCrowd,
      riderRig,
      helmet,
      headLight,
      position: new THREE.Vector3(5.2, 0.0, SPAWN_Z - 8),
      heading: 0,
      speed: 0,
      leanAngle: 0,
      pedalPhase: 0,
      cameraTargetOffset: new THREE.Vector3(0, 1.35, 0),
      chaseDistance: 4.8,
      chaseHeight: 2.05
    };
  }

  // =========================================================================
  // 4. HELICOPTER (3D LOFTED MANHATTAN SIGHTSEEING TWIN-TURBINE CHOPPER)
  // =========================================================================
  createHelicopterEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerHelicopter';

    const tiltPivot = new THREE.Group();
    root.add(tiltPivot);

    const heliLoftMat = createLoftedHelicopterMaterial();
    const blurDiscMat = sealEffect(new THREE.MeshBasicNodeMaterial({
      color: 0xc8d8e8,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false
    }));

    // 1. 3D Lofted Monocoque Fuselage + Tailboom + Twin-Turbine Cowling + Swept Fin + Stabilizers + Tubular Skids
    const heliBodyGeo = buildHelicopterBodyGeometry();
    const heliBodyMesh = new THREE.Mesh(heliBodyGeo, heliLoftMat);
    heliBodyMesh.castShadow = true;
    heliBodyMesh.receiveShadow = true;
    tiltPivot.add(heliBodyMesh);

    // 2. 4-Blade Main Rotor Assembly with Swashplate, Hub Dome & Yellow Safety Blade Tips
    const mainRotorPivot = new THREE.Group();
    mainRotorPivot.position.set(0, 2.66, -0.35);
    const mainRotorGeo = buildHelicopterMainRotorGeometry();
    const mainRotorMesh = new THREE.Mesh(mainRotorGeo, heliLoftMat);
    mainRotorMesh.castShadow = true;
    mainRotorPivot.add(mainRotorMesh);

    const blurDisc = new THREE.Mesh(new THREE.CylinderGeometry(4.85, 4.85, 0.015, 32), blurDiscMat);
    mainRotorPivot.add(blurDisc);
    tiltPivot.add(mainRotorPivot);

    // 3. 4-Blade Tail Rotor Assembly on Swept Vertical Fin
    const tailRotorPivot = new THREE.Group();
    tailRotorPivot.position.set(0.18, 2.02, -5.62);
    const tailRotorGeo = buildHelicopterTailRotorGeometry();
    const tailRotorMesh = new THREE.Mesh(tailRotorGeo, heliLoftMat);
    tailRotorPivot.add(tailRotorMesh);
    tiltPivot.add(tailRotorPivot);

    // 4. FAA Port (Red), Starboard (Green) & Anti-Collision Fin Beacon (Red) Navigation Strobes
    const navRed = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0xff2b2b })
    );
    navRed.position.set(-1.09, 1.54, -4.35);
    const navGreen = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0x22ff66 })
    );
    navGreen.position.set(1.09, 1.54, -4.35);
    const navTail = new THREE.Mesh(
      new THREE.SphereGeometry(0.042, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0xff3b2b })
    );
    navTail.position.set(0, 2.84, -6.04);
    tiltPivot.add(navRed, navGreen, navTail);

    this.scene.add(root);

    return {
      type: 'helicopter',
      label: 'Sightseeing Helicopter',
      mesh: root,
      tiltPivot,
      mainRotorPivot,
      tailRotorPivot,
      position: new THREE.Vector3(-110, 96, SPAWN_Z - 60),
      heading: 0.62,
      speed: 0,
      verticalSpeed: 0,
      pitchAngle: 0,
      rollAngle: 0,
      cameraTargetOffset: new THREE.Vector3(0, 1.55, 0),
      chaseDistance: 11.4,
      chaseHeight: 3.3
    };
  }

  // On a raised curb island (city-config.js BLOCKS: the real blocks, malls & plazas), not in a park
  isPointOnSidewalk(x, z) {
    const b = blockAt(x, z);
    // (the curb turns each corner on a radius: the tip of the block's sharp outline is roadway, js/ground-plan.js)
    return !!b && !(b.park > 0.6 && !b.median) && onRoundedBlock(b, x, z);
  }

  // The building faces nearest (x, z) along the four axes, and how tall they are: the street a car's paint mirrors
  // (car-assets.js). Nothing within reach on a side leaves it open to the sky: a crossing looks down the cross street.
  streetWalls(x, z, street, reach = 90, margin = 3) {
    let xp = x + reach * 3, xn = x - reach * 3, zp = z + reach * 3, zn = z - reach * 3, hxp = 0, hxn = 0, hzp = 0, hzn = 0;
    for (const c of this.nearColliders(x, z, reach)) {
      if (c.round || !(c.maxY > 7) || c.breakable) continue;
      if (z > c.minZ - margin && z < c.maxZ + margin) {
        if (c.minX >= x && c.minX < xp) { xp = c.minX; hxp = c.maxY; }
        if (c.maxX <= x && c.maxX > xn) { xn = c.maxX; hxn = c.maxY; }
      }
      if (x > c.minX - margin && x < c.maxX + margin) {
        if (c.minZ >= z && c.minZ < zp) { zp = c.minZ; hzp = c.maxY; }
        if (c.maxZ <= z && c.maxZ > zn) { zn = c.maxZ; hzn = c.maxY; }
      }
    }
    street.walls.value.set(xp, xn, zp, zn);
    street.heights.value.set(hxp, hxn, hzp, hzn);
    street.absolute.value = 1;
  }

  // What a wheel stands on: the same park surfaces as a walker's feet, and the rounded curbs of ordinary blocks.
  carGround(x, z, hit) {
    hit.nx = 0; hit.ny = 1; hit.nz = 0; hit.grip = 1; hit.rough = 0.0035; hit.y = 0; hit.curb = false;
    // Past the seawall there is nothing under the wheels
    if (this.overWater(x, z)) { hit.y = -40; return; }
    if (this.groundSurfaces?.sample(x, z, hit)) {
      const rise = rampRise(x, z, hit);
      if (rise) { hit.y += rise; hit.grip = 1; hit.rough = 0.002; }
      return;
    }
    const block = blockAt(x, z);
    if (!block) return;
    if (block.park > 0.6 && !block.median) { hit.grip = 0.66; hit.rough = 0.018; return; }
    if (!onRoundedBlock(block, x, z)) return; // past the rounded corner of the curb: still the roadway
    hit.y = ISLAND_BOUNDS.sidewalkHeight; hit.rough = 0.006; hit.curb = true;
  }

  // Open water: off the island's shore and clear of the land the boroughs raster knows
  afloat(x, z) {
    if (!this.overWater(x, z) || this.landAt?.(x, z)) return false;
    // Piers and bridge footings stand in the water
    for (const c of this.nearColliders(x, z, 2)) if ((c.maxY ?? 0) > 0 && x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return false;
    // A pier is solid across its whole width, whatever basins its outline has: its deck covers them
    for (const p of WATERFRONT_PIERS ?? []) {
      const dx = x - p.cx, dz = z - p.cz, ux = Math.cos(p.angle), uz = Math.sin(p.angle);
      if (Math.abs(dx * ux + dz * uz) < p.length / 2 + 4 && Math.abs(dz * ux - dx * uz) < p.width / 2 + 4) return false;
    }
    return true;
  }

  /**
   * Height of the surface under (x, z). Given `y`, the height a walker's feet or a helicopter's skids are at, the roofs
   * at or just above it count too: a body on a roof stands on it, one below a roof stays in the street.
   */
  getGroundHeight(x, z, mode = 'person', y = 0) {
    const interior = y < 2 ? this.interiorFloor?.(x, z) : null;
    if (interior != null) return interior;
    const street = this.streetHeight(x, z, mode);
    if (y < 2 || (mode !== 'person' && mode !== 'helicopter')) return street;
    return Math.max(street, this.roofHeight(x, z, y));
  }

  // The highest building roof under (x, z) that something at height y stands on, stepping up at most `step` (0: none).
  // It reads the one collider cell that holds the point, so it never disturbs a nearColliders() list in use.
  roofHeight(x, z, y, step = 0.6) {
    if (!this._colliderCells) this.nearColliders(x, z, 0);
    const list = this._colliderCells.get(cellKey(Math.floor(x / COLLIDER_CELL), Math.floor(z / COLLIDER_CELL)));
    return list ? roofAt(list, x, z, y, step) : 0;
  }

  // The building whose roof (x, z) is on at height y, or null
  roofCollider(x, z, y, step = 0.6) {
    if (!this._colliderCells) this.nearColliders(x, z, 0);
    const list = this._colliderCells.get(cellKey(Math.floor(x / COLLIDER_CELL), Math.floor(z / COLLIDER_CELL)));
    return list ? roofColliderAt(list, x, z, y, step) : null;
  }

  // Under the protagonist and around their feet. Roofs count from the height the body is at; a foot over a roof's edge
  // stays level with the roof; a body hanging from a rope or flying a wingsuit stands on its own height.
  personGroundAt(x, z) {
    const p = this.entities.person;
    if (p.suspended) return p.position.y;
    const g = this.getGroundHeight(x, z, 'person', p.position.y + 0.05);
    return p.footing > 2 ? Math.max(g, p.footing - 0.4) : g;
  }

  streetHeight(x, z, mode = 'person') {
    if (this.swimming && mode === 'person') return WATER - 1.28;
    const hit = this._streetGroundHit ??= {};
    if (this.groundSurfaces?.sample(x, z, hit)) return hit.y;
    return this.isPointOnSidewalk(x, z) ? ISLAND_BOUNDS.sidewalkHeight : 0.0;
  }

  // Static colliders within `r` of (x, z), kept in their original order and indexed once into 48 m cells.
  // Colliders that come and go during the game (parked cars, parking.js): they live in the collider cells only
  addCollider(c) {
    if (!this._colliderCells) this.nearColliders(c.minX, c.minZ, 0);
    if (c._order === undefined) c._order = 1e6 + (this._dynamicOrder = (this._dynamicOrder || 0) + 1);
    c._cells = [];
    for (let ix = Math.floor(c.minX / COLLIDER_CELL); ix <= Math.floor(c.maxX / COLLIDER_CELL); ix++) {
      for (let iz = Math.floor(c.minZ / COLLIDER_CELL); iz <= Math.floor(c.maxZ / COLLIDER_CELL); iz++) {
        const k = cellKey(ix, iz);
        let list = this._colliderCells.get(k);
        if (!list) this._colliderCells.set(k, (list = []));
        list.push(c);
        c._cells.push(list);
      }
    }
  }

  removeCollider(c) {
    c.maxY = -100; // out of every test at once, whatever list still holds it
    for (const list of c._cells || []) {
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
    }
    c._cells = null;
  }

  nearColliders(x, z, r) {
    const CELL = COLLIDER_CELL;
    const key = cellKey;
    if (!this._colliderCells) {
      this._colliderCells = new Map();
      (this.colliders ?? []).forEach((c, i) => {
        c._order = i;
        for (let ix = Math.floor(c.minX / CELL); ix <= Math.floor(c.maxX / CELL); ix++) {
          for (let iz = Math.floor(c.minZ / CELL); iz <= Math.floor(c.maxZ / CELL); iz++) {
            const k = key(ix, iz);
            let list = this._colliderCells.get(k);
            if (!list) this._colliderCells.set(k, (list = []));
            list.push(c);
          }
        }
      });
      this._nearList = [];
      this._nearStamp = 0;
    }
    const out = this._nearList;
    out.length = 0;
    const stamp = ++this._nearStamp;
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        const list = this._colliderCells.get(key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (c._seen === stamp) continue;
          c._seen = stamp;
          out.push(c);
        }
      }
    }
    if (out.length > 1) out.sort((a, b) => a._order - b._order);
    return out;
  }

  resolveHorizontalCollision(pos, radius, carEntity = null, entity = carEntity, mode = carEntity ? 'car' : this.activeMode) {
    // The detailed island (the helicopter may roam out over the harbour & the boroughs)
    const heli = mode === 'helicopter';
    const m = heli ? 6000 : 0;
    pos.x = Math.max(ISLAND_BOUNDS.minX - m, Math.min(ISLAND_BOUNDS.maxX + m, pos.x));
    pos.z = Math.max(ISLAND_BOUNDS.minZ + (heli ? -6000 : 30), Math.min(ISLAND_BOUNDS.maxZ + m, pos.z));
    if (!heli && !carEntity?.body && getIslandBoundsAtZ) {
      const shore = getIslandBoundsAtZ(pos.z);
      const minShoreX = shore.westX + 8.0;
      const maxShoreX = shore.eastX - 8.0;
      if (pos.x < minShoreX) {
        pos.x = minShoreX;
        if (carEntity?.body) impactBody(carEntity, pos.x, pos.y + 0.55, pos.z, 1, 0, 0);
        else if (carEntity && carEntity.speed) carEntity.speed *= 0.4;
      } else if (pos.x > maxShoreX) {
        pos.x = maxShoreX;
        if (carEntity?.body) impactBody(carEntity, pos.x, pos.y + 0.55, pos.z, -1, 0, 0);
        else if (carEntity && carEntity.speed) carEntity.speed *= 0.4;
      }
    }

    const body = collisionBody(mode, radius, carEntity ? carEntity.heading : 0, 0, carEntity?.halfW ?? 0.86, carEntity?.halfL ?? 2.18);
    const { sin: sinH, cos: cosH, extX, extZ } = body;
    const contact = this._buildingContact ??= { nx: 0, nz: 0, depth: 0 };

    const reach = Math.max(extX, extZ) + 6;
    let gx = pos.x;
    let gz = pos.z;
    let near = this.nearColliders(gx, gz, reach);
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
      if (buildingContact(c, pos.x, pos.y, pos.z, body, contact)) {
        // Hydrants and mailboxes don't stop a car, they go down under it
        if (c.breakable && carEntity && Math.abs(carEntity.speed) > 3 && this.onPropHit) {
          this.onPropHit(c, carEntity);
          carEntity.speed *= c.soft ? 0.985 : 0.9;
          continue;
        }
        // A parked car struck with any speed becomes a car of its own and takes the blow (gameplay.js); a nudge
        // leaves it standing, solid
        if (c.parked !== undefined && carEntity && this.onParkedHit && this.onParkedHit(c, carEntity, contact)) continue;
        const { nx, nz, depth } = contact;
        pos.x += nx * depth;
        pos.z += nz * depth;

        if (carEntity?.body) {
          // The corner or the face that hit, in the car's own frame: head-on is the middle of the bumper, a clip is its corner
          const along = nx * sinH + nz * cosH, across = nx * cosH - nz * sinH;
          const lx = -Math.sign(across) * body.hx * Math.min(1, Math.abs(across) * 2.2);
          const lz = -Math.sign(along) * body.hz * Math.min(1, Math.abs(along) * 2.2);
          const px = pos.x + cosH * lx + sinH * lz, py = pos.y + 0.55, pz = pos.z - sinH * lx + cosH * lz;
          const closing = impactBody(carEntity, px, py, pz, nx, 0, nz);
          if (closing > 0.4) {
            if (this._collisionListener) this.reportCollision(entity, c, 'building', px, py, pz, nx, 0, nz, closing);
            if (closing > 2.2) carEntity.lastCollisionSpark = { x: px, y: py, z: pz, nx, nz, speed: closing };
          }
          const slide = Math.hypot(carEntity.body.vx, carEntity.body.vz);
          if (slide > 3) { carEntity.body.wall = 0.08; carEntity.body.wallX = px; carEntity.body.wallY = py; carEntity.body.wallZ = pz; carEntity.body.wallSpeed = slide; }
        } else if (this._collisionListener && entity && entity.type !== 'person') {
          const sin = carEntity ? sinH : Math.sin(entity.heading);
          const cos = carEntity ? cosH : Math.cos(entity.heading);
          const approachSpeed = -((sin * entity.speed + (entity.vx || 0)) * nx + (cos * entity.speed + (entity.vz || 0)) * nz);
          const support = carEntity ? Math.abs(nx * cos - nz * sin) * 0.86 + Math.abs(nx * sin + nz * cos) * 2.18 : radius;
          this.reportCollision(entity, c, 'building', pos.x - nx * support, pos.y + (heli ? 1.1 : 0.56), pos.z - nz * support,
            nx, 0, nz, approachSpeed);
        }

        if (carEntity && !carEntity.body) {
          const totalVx = sinH * carEntity.speed + (carEntity.vx || 0);
          const totalVz = cosH * carEntity.speed + (carEntity.vz || 0);
          const vn = -(totalVx * nx + totalVz * nz);
          if (vn > 0.5) {
            const headOn = Math.abs(sinH * nx + cosH * nz);
            const sideDot = cosH * nx - sinH * nz;
            carEntity.vx = (carEntity.vx || 0) + nx * vn * 0.42;
            carEntity.vz = (carEntity.vz || 0) + nz * vn * 0.42;
            if (headOn > 0.72) {
              carEntity.speed = -carEntity.speed * 0.25;
            } else {
              carEntity.speed *= (1.0 - 0.62 * headOn);
              carEntity.angularVel = (carEntity.angularVel || 0) + sideDot * (sinH * nx + cosH * nz >= 0 ? -1 : 1) * Math.min(3.2, vn * 0.22);
            }
            carEntity.pitchVel = (carEntity.pitchVel || 0) + (sinH * nx + cosH * nz) * Math.min(14.0, vn) * 0.16;
            carEntity.rollVel = (carEntity.rollVel || 0) - sideDot * Math.min(14.0, vn) * 0.22;
            carEntity.heaveVel = (carEntity.heaveVel || 0) + Math.min(1.4, vn * 0.11);
            if (vn > 2.2) {
              carEntity.lastCollisionSpark = {
                x: pos.x - nx * extX * 0.92,
                y: 0.56,
                z: pos.z - nz * extZ * 0.92,
                nx,
                nz,
                speed: vn
              };
            }
          }
        }

        // A push that carried it far from where the candidates were gathered (dropped inside a building): gather
        // them again around where it is now, carrying on in the same order
        if (Math.abs(pos.x - gx) > 5 || Math.abs(pos.z - gz) > 5) {
          gx = pos.x;
          gz = pos.z;
          const order = c._order;
          near = this.nearColliders(gx, gz, reach);
          i = -1;
          while (i + 1 < near.length && near[i + 1]._order <= order) i++;
        }
      }
    }
  }

  // Pose the skinned characters once every entity has moved: the pedestrian's rig walks (or runs, turns, jumps) it to
  // where it now is, planting its feet on the ground; the cyclist sits on the bike, hands on the grips, feet on the
  // pedals, helmet on its head
  poseCharacters(dt, focusPos = null) {
    const focus = focusPos || this.getActiveEntity()?.position;
    const maxDistSq = 320 * 320;

    const p = this.entities.person;
    if (p) {
      const dx = focus ? p.position.x - focus.x : 0;
      const dz = focus ? p.position.z - focus.z : 0;
      if (!p.inVehicle && (this.activeMode === 'person' || dx * dx + dz * dz <= maxDistSq)) {
        p._charHidden = false;
        if (p.mesh) p.mesh.visible = true;
        const air = p.position.y - this.personGroundAt(p.position.x, p.position.z);
        // diveTime (gameplay.js): knocked down or fallen, the evasive-dive pose instead of walking. Held up by a rope, a
        // wingsuit or a car's roof, the body stands still where it is and vertical.js poses it over that
        if (p.suspended) p.rig.reset(p.position.x, p.position.z, p.heading, personGround, this);
        else p.rig.update(dt, p.position.x, p.position.z, p.heading, personGround, this, air > 0.02 ? air : 0, true, p.diveTime ?? -1);
        p.crowd.begin();
        p.crowd.add(p.rig, 0);
        p.crowd.end();
      } else if (!p._charHidden) {
        p.rig.placed = false;
        p.crowd.begin();
        p.crowd.end();
        if (p.crowd.updates > 2) {
          if (p.mesh) p.mesh.visible = false;
          p._charHidden = true;
        }
      }
    }

    const b = this.entities.cyclist;
    if (b && !b.riderless) {
      const dx = focus ? b.position.x - focus.x : 0;
      const dz = focus ? b.position.z - focus.z : 0;
      if (this.activeMode === 'cyclist' || dx * dx + dz * dz <= maxDistSq) {
        if (b.helmet) b.helmet.visible = true;
        const moved =
          this.activeMode === 'cyclist' ||
          b._riderHidden ||
          b._posedX !== b.position.x ||
          b._posedY !== b.position.y ||
          b._posedZ !== b.position.z ||
          b._posedH !== b.heading ||
          b._posedLean !== b.leanAngle ||
          b._posedPedal !== b.pedalPhase;
        b._riderHidden = false;
        if (moved) {
          b.riderRig.ride(b.leanPivot, b.pedalPhase, b.bikeFrame);
          b.riderCrowd.begin();
          b.riderCrowd.add(b.riderRig, 0);
          b.riderCrowd.end();
          b.helmet.quaternion.copy(b.riderRig.headQuaternion);
          b.helmet.position.set(0, 0.175, -0.012).applyQuaternion(b.helmet.quaternion).add(b.riderRig.headPosition);
          b._posedX = b.position.x;
          b._posedY = b.position.y;
          b._posedZ = b.position.z;
          b._posedH = b.heading;
          b._posedLean = b.leanAngle;
          b._posedPedal = b.pedalPhase;
        }
      } else if (!b._riderHidden) {
        b.riderCrowd.begin();
        b.riderCrowd.end();
        if (b.riderCrowd.updates > 2) {
          if (b.helmet) b.helmet.visible = false;
          b._riderHidden = true;
          b._posedX = NaN;
        }
      }
    }
  }

  update(dt, elapsed, focusPos = null) {
    const heli = this.entities.helicopter;
    // The rotors wind down once the helicopter is left on the ground
    heli.rotorSpin = Math.max(0, Math.min(1, (heli.rotorSpin ?? 1) + dt * (this.activeMode === 'helicopter' || heli.position.y > 1 ? 0.8 : -0.35)));
    heli.mainRotorPivot.rotation.y += dt * 24.0 * heli.rotorSpin;
    heli.tailRotorPivot.rotation.x += dt * 32.0 * heli.rotorSpin;

    if (this.activeMode === 'person') {
      this.updatePerson(dt, elapsed);
    } else {
      // The protagonist remains inside the controlled vehicle.
      const p = this.entities.person;
      p.speed = 0;
      if (p.inVehicle) p.position.copy(this.entities.car.position);
    }

    if (this.activeMode === 'car') {
      this.updateCar(dt, elapsed);
    } else if (this.activeMode === 'cyclist') {
      this.updateCyclist(dt, elapsed);
    } else if (this.activeMode === 'helicopter') {
      this.updateHelicopter(dt, elapsed);
    } else if (this.activeMode === 'plane') {
      this.updatePlane(dt);
    }
    posePlane(this.entities.plane, dt);

    for (const key of Object.keys(this.entities)) {
      const e = this.entities[key];
      e.mesh.position.copy(e.position);
      e.mesh.rotation.y = e.heading;
    }
    // The walker's contact shadow lies on the surface under them, shrinking as they rise, gone from a few metres up
    // (it used to ride under the feet into the air: a dark square under a jump, a parachute, a wingsuit)
    const walker = this.entities.person;
    if (walker.shadow) {
      const lift = walker.position.y - this.personGroundAt(walker.position.x, walker.position.z);
      const ground = walker.suspended ? this.getGroundHeight(walker.position.x, walker.position.z, 'person', walker.position.y + 0.3) : null;
      const height = ground === null ? lift : walker.position.y - ground;
      walker.shadow.visible = height < 2.5;
      walker.shadow.position.y = 0.02 - Math.max(0, height);
      walker.shadow.scale.setScalar(1 - Math.min(1, Math.max(0, height) / 2.5) * 0.6);
    }

    // Modulate clustered vehicle & bike lights by time of day (off during Midday & Golden Hour; fade in at Dusk & Night)
    const glow = cityUniforms && cityUniforms.uInteriorGlow ? cityUniforms.uInteriorGlow.value : 0.48;
    const beamScale = Math.min(1.28, Math.max(0.0, (glow - 0.60) * 1.45));
    const car = this.entities.car;
    if (car.headLights) {
      for (const spot of car.headLights) {
        // Accelerating does not change the headlamp output or range.
        spot.intensity = HEADLIGHTS.intensity * beamScale;
      }
    }
    const bike = this.entities.cyclist;
    if (bike.headLight) {
      const bikeActive = this.activeMode === 'cyclist';
      bike.headLight.intensity = bikeActive ? 115 * beamScale : 0;
    }

    this.poseCharacters(dt, focusPos);
  }

  updatePerson(dt) {
    const p = this.entities.person;
    const maxSpeed = 8.2;
    const turnRate = 2.6;

    let targetSpeed = 0;
    if (this.keys.forward) targetSpeed = maxSpeed * this.keys.forward;
    else if (this.keys.backward) targetSpeed = -maxSpeed * 0.65 * this.keys.backward;

    if (this.keys.left) p.heading += turnRate * dt * this.keys.left;
    if (this.keys.right) p.heading -= turnRate * dt * this.keys.right;

    const accelerating = Math.abs(targetSpeed) > Math.abs(p.speed) && p.speed * targetSpeed >= 0;
    const acceleration = accelerating ? 5.5 * Math.abs(targetSpeed) / maxSpeed : 12;
    p.speed += Math.max(-acceleration * dt, Math.min(acceleration * dt, targetSpeed - p.speed));

    p.position.x += Math.sin(p.heading) * p.speed * dt;
    p.position.z += Math.cos(p.heading) * p.speed * dt;
    this.resolveHorizontalCollision(p.position, 0.48);

    const groundY = this.getGroundHeight(p.position.x, p.position.z, 'person');
    if (this.keys.up && p.position.y <= groundY + 0.02) {
      p.verticalVel = 5.2;
    }
    p.verticalVel -= 14.5 * dt;
    p.position.y += p.verticalVel * dt;
    if (p.position.y < groundY) {
      p.position.y = groundY;
      p.verticalVel = 0;
    }
  }

  updateCar(dt) {
    if (dt <= 0) return;
    let throttle = 0;
    if (this.keys.forward) throttle = this.keys.forward;
    else if (this.keys.backward) throttle = -this.keys.backward;
    let steerInput = 0;
    if (this.keys.left) steerInput = this.keys.left;
    if (this.keys.right) steerInput = -this.keys.right;
    const car = this.entities.car;
    // Nitro drains while it burns and fills back on its own, faster when the driving earns it (gameplay.js)
    const boosting = !!(this.keys.sprint && car.body && car.nitro > 0.02 && throttle > 0);
    if (boosting) car.nitro = Math.max(0, car.nitro - dt / 4.5);
    else if (car.body) car.nitro = Math.min(1, car.nitro + dt / 40);
    this.simulateCar(car, throttle, steerInput, this.keys.handbrake || this.keys.up, dt, boosting);
  }

  // One car's step, for the player and the AI drivers alike (car-physics.js)
  simulateCar(c, throttle, steerInput, handbrakeInput, dt, nitro = false) {
    if (c.boat) {
      const world = this._boatWorld ??= { clock: 0, afloat: (x, z) => this.afloat(x, z) };
      world.clock = performance.now() / 1000;
      const aground = stepBoat(c, throttle, steerInput, dt, world);
      if (aground > 3 && this._collisionListener) this.reportCollision(c, { obstacle: 'shore' }, 'building', c.position.x, 0, c.position.z, 0, 0, 0, aground);
      return;
    }
    if (!c.body) { this.simulateBike(c, throttle, steerInput, handbrakeInput, dt); return; }
    if (dt <= 0) return;
    c.prevX = c.position.x;
    c.prevZ = c.position.z;
    const input = this._carInput ??= { throttle: 0, steer: 0, handbrake: false };
    input.throttle = throttle;
    input.steer = steerInput;
    input.handbrake = !!handbrakeInput;
    c.body.nitro = nitro ? 1 : 0;
    const world = this._carWorld ??= { grip: 1, waterLevel: WATER, ground: (x, z, hit) => this.carGround(x, z, hit), collide: (car) => this.resolveHorizontalCollision(car.position, 1.35, car) };
    world.grip = this.gripFactor ?? 1;
    stepCar(c, input, dt, world);
    poseCar(c, dt);
  }

  // Motorbikes keep the planar model: lean and wheelie are posed on top of it (motorbike.js)
  simulateBike(c, throttle, steerInput, handbrakeInput, dt) {
    if (dt <= 0) return;
    const braking = c.speed * throttle < 0;
    const prevX = c.position.x;
    const prevZ = c.position.z;
    c.prevX = prevX;
    c.prevZ = prevZ;
    // Short steps keep grip, impacts and suspension consistent at different display rates.
    const drive = c.drive || CAR_DRIVE;
    // Wet streets cost grip (gripFactor is set by the weather, atmosphere.js)
    const maxGrip = drive.grip * (this.gripFactor ?? 1);
    const steps = Math.ceil(dt * 120);
    const step = dt / steps;
    const steerResponse = 1 - Math.exp(-10 * step);
    const yawResponse = 1 - Math.exp(-5 * step);
    const tireResponse = 1 - Math.exp(-4 * step);
    for (let i = 0; i < steps; i++) {
      const sin = Math.sin(c.heading), cos = Math.cos(c.heading);
      const vx = sin * c.speed + c.vx, vz = cos * c.speed + c.vz;
      const forward = vx * sin + vz * cos;
      const sideways = vx * cos - vz * sin;
      const speed = driveSpeed(forward, throttle, step, drive);
      const acceleration = (speed - forward) / step;
      // Braking and cornering share tire grip; air resistance does not use it.
      const tireAcceleration = acceleration + drive.drag * forward * Math.abs(forward);
      const grip = Math.sqrt(Math.max(0, maxGrip ** 2 - tireAcceleration ** 2));
      // A handbrake slide preserves steering while reducing lateral grip; fade it out at low speed.
      const handbrake = handbrakeInput ? Math.min(1, Math.abs(forward) / 5) : 0;
      const lateralGrip = grip * (1 - 0.7 * handbrake);
      const steeringGrip = grip + (maxGrip - grip) * handbrake;

      // Full lock at parking speeds, progressively less steering at road speeds.
      const turn = drive.wheelbase * drive.cornering;
      const maxSteer = Math.atan(turn / Math.max(speed * speed, turn / Math.tan(0.60)));
      c.steerAngle += (steerInput * maxSteer - c.steerAngle) * steerResponse;
      const yawLimit = steeringGrip / Math.max(2, Math.abs(speed));
      const targetYaw = Math.max(-yawLimit, Math.min(yawLimit, speed * Math.tan(c.steerAngle) / drive.wheelbase));
      // Collision spin remains part of the yaw velocity; the tires gradually regain control.
      const yawStep = steeringGrip * 0.65 * step;
      c.angularVel += Math.max(-yawStep, Math.min(yawStep, (targetYaw - c.angularVel) * yawResponse));
      c.heading += c.angularVel * step;

      // Turning the chassis must not instantly rotate its momentum. Tires remove sideways slip
      // with a bounded force; longitudinal momentum, including impacts, stays in speed.
      const nextSin = Math.sin(c.heading), nextCos = Math.cos(c.heading);
      const worldX = sin * speed + cos * sideways;
      const worldZ = cos * speed - sin * sideways;
      c.speed = worldX * nextSin + worldZ * nextCos;
      if (handbrake) c.speed *= Math.exp(-1.8 * step);
      const slip = worldX * nextCos - worldZ * nextSin;
      const correction = Math.max(-lateralGrip * step, Math.min(lateralGrip * step, -slip * tireResponse));
      c.vx = nextCos * (slip + correction);
      c.vz = -nextSin * (slip + correction);
      c.position.x += (nextSin * c.speed + c.vx) * step;
      c.position.z += (nextCos * c.speed + c.vz) * step;
      this.resolveHorizontalCollision(c.position, 1.35, c);

      const targetPitch = -Math.max(-1, Math.min(1, acceleration / CAR_DRIVE.acceleration)) * 0.026;
      const targetRoll = Math.max(-0.09, Math.min(0.09, correction / step * 0.012));
      c.pitchVel += ((targetPitch - c.chassisPivot.rotation.x) * 68 - c.pitchVel * 11.2) * step;
      c.rollVel += ((targetRoll - c.chassisPivot.rotation.z) * 68 - c.rollVel * 11.2) * step;
      c.chassisPivot.rotation.x = Math.max(-0.22, Math.min(0.22, c.chassisPivot.rotation.x + c.pitchVel * step));
      c.chassisPivot.rotation.z = Math.max(-0.26, Math.min(0.26, c.chassisPivot.rotation.z + c.rollVel * step));
      c.heaveVel += (-c.heaveY * 85 - c.heaveVel * 12) * step;
      c.heaveY = Math.max(-0.08, Math.min(0.14, c.heaveY + c.heaveVel * step));
    }
    c.position.y = this.getGroundHeight(c.position.x, c.position.z, 'car');
    c.chassisPivot.position.y = c.heaveY;

    if (c.carState) {
      c.carState.value.x = braking ? 1 : 0;
      c.carState.value.w = c.speed < -0.2 ? 1 : 0;
    }

    const forwardDist = (c.position.x - prevX) * Math.sin(c.heading) + (c.position.z - prevZ) * Math.cos(c.heading);
    const rawWheelStep = forwardDist / 0.35;
    const wheelStep = Math.sign(rawWheelStep) * Math.min(Math.abs(rawWheelStep), 0.48);
    c.wheelSpin = (c.wheelSpin + wheelStep) % (Math.PI * 2);
    for (const w of c.wheels) {
      w.tire.rotation.x = c.wheelSpin + (w.isFront ? 0.0 : 0.55);
      if (w.isFront) {
        w.steerPivot.rotation.y = c.steerAngle;
      }
    }
  }

  updateCyclist(dt) {
    const b = this.entities.cyclist;

    let throttle = 0;
    if (this.keys.forward) throttle = this.keys.forward;
    else if (this.keys.backward) throttle = -0.6 * this.keys.backward;

    b.speed = driveSpeed(b.speed, throttle, dt, BICYCLE_DRIVE);

    let turnInput = 0;
    if (this.keys.left) turnInput = this.keys.left;
    if (this.keys.right) turnInput = -this.keys.right;

    if (Math.abs(b.speed) > 0.15) {
      const dirSign = b.speed >= 0 ? 1 : -1;
      b.heading += turnInput * 2.15 * dirSign * dt;
    }

    b.position.x += Math.sin(b.heading) * b.speed * dt;
    b.position.z += Math.cos(b.heading) * b.speed * dt;
    this.resolveHorizontalCollision(b.position, 0.65, null, b);
    b.position.y = this.getGroundHeight(b.position.x, b.position.z, 'cyclist');

    const targetLean = -turnInput * Math.min(1.0, Math.abs(b.speed) / 9.0) * 0.34;
    b.leanAngle += (targetLean - b.leanAngle) * Math.min(1, dt * 9);
    b.leanPivot.rotation.z = b.leanAngle;

    const wheelDelta = (b.speed / 0.35) * dt;
    b.frontWheel.rotation.x += wheelDelta;
    b.rearWheel.rotation.x += wheelDelta;

    // The cranks turn with the rear wheel through the gears while pedalling (~110 rpm at cruising speed) and
    // freewheel otherwise; the rider's feet follow the pedals (see poseCharacters)
    if (throttle > 0 && wheelDelta > 0) b.pedalPhase += wheelDelta / 3.2;
    b.crankPivot.rotation.x = b.pedalPhase;
    for (const pedal of b.pedals) pedal.rotation.x = -b.pedalPhase;
  }

  // The stick for the player's plane, then the shared flight model (airplane.js)
  updatePlane(dt) {
    if (dt <= 0) return;
    const k = this.keys;
    const axis = (plus, minus) => (plus ? Number(plus) : 0) - (minus ? Number(minus) : 0);
    stepPlane(this.entities.plane, { pitch: axis(k.backward, k.forward), roll: axis(k.left, k.right), throttle: axis(k.up, k.down) }, dt, this.planeEnvironment);
  }

  // What a plane can run into; gameplay.js flies abandoned planes through the same checks
  get planeEnvironment() {
    return this._planeEnvironment ??= {
      ground: (x, z) => this.getGroundHeight(x, z, 'car'),
      water: (x, z) => this.overWater(x, z),
      hit: (pos) => {
        const body = collisionBody('helicopter', 3, 0);
        const contact = this._buildingContact ??= { nx: 0, nz: 0, depth: 0 };
        for (const c of this.nearColliders(pos.x, pos.z, 9)) if (buildingContact(c, pos.x, pos.y, pos.z, body, contact)) return true;
        return false;
      }
    };
  }

  overWater(x, z) {
    if (z < ISLAND_BOUNDS.minZ || z > ISLAND_BOUNDS.maxZ) return true;
    const shore = getIslandBoundsAtZ(z);
    return x < shore.westX || x > shore.eastX;
  }

  updateHelicopter(dt, elapsed) {
    const h = this.entities.helicopter;
    const maxHorizSpeed = 52.0;
    const maxVertSpeed = 16.0;

    let fwdInput = 0;
    if (this.keys.forward) fwdInput = this.keys.forward;
    else if (this.keys.backward) fwdInput = -this.keys.backward;

    let yawInput = 0;
    if (this.keys.left) yawInput = this.keys.left;
    if (this.keys.right) yawInput = -this.keys.right;

    let vertInput = 0;
    if (this.keys.up) vertInput = this.keys.up;
    else if (this.keys.down) vertInput = -this.keys.down;

    if (fwdInput !== 0) {
      h.speed += fwdInput * 24.0 * dt;
      h.speed = Math.max(-maxHorizSpeed * 0.6, Math.min(maxHorizSpeed, h.speed));
    } else {
      h.speed *= Math.max(0, 1 - dt * 1.8);
    }

    if (vertInput !== 0) {
      h.verticalSpeed += vertInput * 22.0 * dt;
      h.verticalSpeed = Math.max(-maxVertSpeed, Math.min(maxVertSpeed, h.verticalSpeed));
    } else {
      h.verticalSpeed *= Math.max(0, 1 - dt * 3.5);
    }

    h.heading += yawInput * 1.45 * dt;

    h.position.x += Math.sin(h.heading) * h.speed * dt;
    h.position.z += Math.cos(h.heading) * h.speed * dt;
    // Skids on the street or on whatever roof it comes down onto (judged from before this step, so a fast descent lands)
    const floor = this.roofHeight(h.position.x, h.position.z, h.position.y - 0.25, 0.3) + 0.25;
    h.position.y += h.verticalSpeed * dt;

    if (h.position.y < floor) {
      this.reportCollision(h, groundCollider, 'ground', h.position.x, floor, h.position.z, 0, 1, 0, -h.verticalSpeed);
      // set down: the skids stop the descent (held down, it used to hit the ground again every frame)
      h.verticalSpeed = Math.max(0, h.verticalSpeed);
    }
    h.position.y = Math.max(floor, Math.min(380, h.position.y));
    this.resolveHorizontalCollision(h.position, 4.5, null, h);

    const targetPitch = (h.speed / maxHorizSpeed) * 0.24;
    const targetRoll = -yawInput * 0.28;
    h.pitchAngle += (targetPitch - h.pitchAngle) * Math.min(1, dt * 5);
    h.rollAngle += (targetRoll - h.rollAngle) * Math.min(1, dt * 5);

    h.tiltPivot.rotation.x = h.pitchAngle;
    h.tiltPivot.rotation.z = h.rollAngle;
    h.tiltPivot.position.y = Math.sin(elapsed * 2.6) * 0.18;
  }
}

export { ThirdPersonControllerManager };
