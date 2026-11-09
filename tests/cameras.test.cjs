const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/cameras.js'), 'utf8');
const collisions = loadModule(readFileSync(join(__dirname, '../js/building-collision.js'), 'utf8'));

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v) { return this.set(this.x - v.x, this.y - v.y, this.z - v.z); }
  subVectors(a, b) { return this.copy(a).sub(b); }
  lerp(v, t) { return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  divideScalar(s) { return this.set(this.x / s, this.y / s, this.z / s); }
  addScaledVector(v, s) { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
}

class PerspectiveCamera {
  constructor(fov, aspect) {
    this.fov = fov;
    this.aspect = aspect;
    this.position = new Vector3();
    this.target = new Vector3();
    this.rotation = { x: 0, y: 0, z: 0 };
  }
  updateProjectionMatrix() {}
  lookAt(v) { this.target.copy(v); }
  rotateX(angle) { this.rotation.x = angle; }
  rotateY(angle) { this.rotation.y = angle; }
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  };
}

function cameraHarness(entity = {
  position: new Vector3(0, 0, 100), heading: 0, speed: 0, type: 'car',
  chaseDistance: 6.9, chaseHeight: 2.12, cameraTargetOffset: new Vector3(0, 1, 0)
}) {
  const window = eventTarget();
  const document = { ...eventTarget(), hidden: false };
  const canvas = { ...eventTarget(), style: {} };
  const controls = eventTarget();
  const captured = new Set();
  canvas.setPointerCapture = (id) => captured.add(id);
  canvas.hasPointerCapture = (id) => captured.has(id);
  canvas.releasePointerCapture = (id) => {
    captured.delete(id);
    canvas.dispatch('lostpointercapture', { pointerId: id });
  };
  window.innerWidth = 1600;
  window.innerHeight = 900;
  const { CameraSystem, cameraCollisionDistance } = loadModule(source, {
    globals: { window, document },
    imports: { 'three/webgpu': { Vector3, PerspectiveCamera }, './landmarks.js': {}, './building-collision.js': collisions }
  });
  const camera = new CameraSystem(canvas, { getActiveEntity: () => entity });
  return {
    camera, canvas, controls, window, document, captured, entity, cameraCollisionDistance,
    pointer(target, type, id, x, y = 0, pointerType = 'touch', button = 0) {
      const event = {
        pointerId: id, clientX: x, clientY: y, pointerType, button,
        prevented: false, preventDefault() { this.prevented = true; }
      };
      // Captured pointers keep reaching the canvas after moving over the controls.
      (captured.has(id) ? canvas : target).dispatch(type, event);
      window.dispatch(type, event);
      return event;
    }
  };
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
}

test('UI touches neither move nor release an active canvas orbit', () => {
  const h = cameraHarness();
  assert.equal(h.canvas.style.touchAction, 'none');
  h.pointer(h.controls, 'pointerdown', 1, 20);
  h.pointer(h.canvas, 'pointerdown', 2, 100);
  assert.equal(h.captured.has(1), false);
  assert.equal(h.captured.has(2), true);

  h.pointer(h.controls, 'pointermove', 1, 300);
  close(h.camera.orbitYawOffset, 0);
  h.pointer(h.controls, 'pointerup', 1, 300);
  assert.equal(h.camera.isDragging, true);
  h.pointer(h.controls, 'pointermove', 2, 110);
  close(h.camera.orbitYawOffset, -0.065);
  h.pointer(h.controls, 'pointerup', 2, 110);
  assert.equal(h.camera.isDragging, false);
});

test('two canvas touches pinch without orbiting and one remaining touch resumes smoothly', () => {
  const h = cameraHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 0);
  h.pointer(h.canvas, 'pointerdown', 2, 100);
  h.pointer(h.canvas, 'pointermove', 2, 200);
  close(h.camera.zoomMultiplier, 0.5);
  close(h.camera.orbitYawOffset, 0);
  close(h.camera.orbitPitchOffset, 0.09);
  h.pointer(h.canvas, 'pointermove', 1, 100);
  close(h.camera.zoomMultiplier, 1);
  h.pointer(h.canvas, 'pointerup', 2, 200);
  h.pointer(h.canvas, 'pointermove', 1, 110);
  close(h.camera.orbitYawOffset, -0.065);
  close(h.camera.zoomMultiplier, 1);
});

test('extra fingers are ignored and coincident pinch points keep zoom finite', () => {
  const h = cameraHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 0);
  h.pointer(h.canvas, 'pointerdown', 2, 100);
  h.pointer(h.canvas, 'pointerdown', 3, 300);
  h.pointer(h.canvas, 'pointermove', 3, 500);
  close(h.camera.zoomMultiplier, 1);
  h.pointer(h.canvas, 'pointermove', 2, 0);
  h.pointer(h.canvas, 'pointermove', 2, 10);
  assert.equal(Number.isFinite(h.camera.zoomMultiplier), true);
  h.pointer(h.canvas, 'pointerup', 3, 500);
  assert.equal(h.camera.isDragging, true);
});

for (const interruption of ['pointercancel', 'lostpointercapture', 'blur', 'hidden']) {
  test(`${interruption} ends capture without a stuck drag or jump on the next gesture`, () => {
    const h = cameraHarness();
    h.pointer(h.canvas, 'pointerdown', 1, 0);
    h.pointer(h.canvas, 'pointermove', 1, 10);
    if (interruption === 'blur' || interruption === 'hidden') h.pointer(h.canvas, 'pointerdown', 3, 100);
    if (interruption === 'blur') h.window.dispatch('blur');
    else if (interruption === 'hidden') {
      h.document.hidden = true;
      h.document.dispatch('visibilitychange');
    } else if (interruption === 'lostpointercapture') h.canvas.releasePointerCapture(1);
    else h.pointer(h.canvas, interruption, 1, 10);
    assert.equal(h.camera.isDragging, false);
    assert.equal(h.captured.size, 0);
    h.pointer(h.canvas, 'pointermove', 1, 500);
    close(h.camera.orbitYawOffset, -0.065);
    h.pointer(h.canvas, 'pointerdown', 2, 600);
    h.pointer(h.canvas, 'pointermove', 2, 610);
    close(h.camera.orbitYawOffset, -0.13);
  });
}

test('cancelling one pinch pointer leaves the other ready for orbit', () => {
  const h = cameraHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 0);
  h.pointer(h.canvas, 'pointerdown', 2, 100);
  h.pointer(h.canvas, 'pointermove', 1, 20);
  h.pointer(h.canvas, 'pointercancel', 2, 100);
  assert.equal(h.camera.isDragging, true);
  h.pointer(h.canvas, 'pointermove', 1, 30);
  close(h.camera.orbitYawOffset, -0.065);
});

test('mouse orbit and wheel zoom retain their behavior and bounds', () => {
  const h = cameraHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 0, 0, 'mouse', 2);
  assert.equal(h.camera.isDragging, false);
  h.pointer(h.canvas, 'pointerdown', 1, 0, 0, 'mouse');
  h.pointer(h.canvas, 'pointermove', 1, 10, 20, 'mouse');
  close(h.camera.orbitYawOffset, -0.065);
  close(h.camera.orbitPitchOffset, 0.19);
  h.pointer(h.canvas, 'pointerup', 1, 10, 20, 'mouse');
  let prevented = false;
  h.canvas.dispatch('wheel', { deltaY: 100, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  close(h.camera.zoomMultiplier, 1.1);
  h.canvas.dispatch('wheel', { deltaY: -10000, preventDefault() {} });
  close(h.camera.zoomMultiplier, 0.45);
  h.canvas.dispatch('wheel', { deltaY: 10000, preventDefault() {} });
  close(h.camera.zoomMultiplier, 2.4);
});

for (const preset of ['chase', 'observatory', 'drone']) {
  test(`teleport after driving, orbiting and ${preset} snaps to a fresh chase view`, () => {
    const h = cameraHarness();
    h.entity.speed = 45;
    for (let i = 0; i < 180; i++) h.camera.update(1 / 60, i / 60);
    assert.ok(h.camera.smoothedSpeed > 44);
    h.pointer(h.canvas, 'pointerdown', 1, 0);
    h.pointer(h.canvas, 'pointermove', 1, 200, 80);
    h.pointer(h.canvas, 'pointerup', 1, 200, 80);
    h.canvas.dispatch('wheel', { deltaY: 1000, preventDefault() {} });
    h.camera.setCameraPreset(preset, true);
    h.camera.update(1 / 60, 4);

    h.entity.position.set(-200, 20, 5300);
    h.entity.heading = -Math.PI / 2;
    h.entity.speed = 0;
    h.camera.resetForTeleport();
    const fresh = cameraHarness(h.entity).camera;
    assert.equal(h.camera.activePresetId, 'chase');
    assert.equal(h.camera.camera.fov, fresh.camera.fov);
    // Compare arrival, follow re-anchoring, and movement after arrival, including a change in height.
    for (let i = 0; i < 3; i++) {
      if (i === 2) h.entity.position.set(-205, 23, 5304);
      h.camera.update(1 / 60, 5 + i / 60);
      fresh.update(1 / 60, 5 + i / 60);
      for (const field of ['currentPos', 'currentLookAt']) {
        for (const axis of ['x', 'y', 'z']) close(h.camera[field][axis], fresh[field][axis]);
      }
      for (const axis of ['x', 'y', 'z']) {
        close(h.camera.camera.position[axis], fresh.camera.position[axis]);
        close(h.camera.camera.target[axis], fresh.camera.target[axis]);
      }
    }
  });
}

test('teleport releases every camera pointer and ignores old gestures before accepting a new drag', () => {
  const h = cameraHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 0);
  h.pointer(h.canvas, 'pointermove', 1, 20, 40);
  h.pointer(h.canvas, 'pointerdown', 2, 100);
  h.pointer(h.canvas, 'pointermove', 2, 200);
  assert.equal(h.captured.size, 2);
  h.camera.resetForTeleport();
  assert.equal(h.captured.size, 0);
  assert.equal(h.camera.isDragging, false);
  assert.equal(h.camera.userOrbitTimer, 0);
  for (const id of [1, 2]) {
    h.pointer(h.canvas, 'pointermove', id, 500, 500);
    h.pointer(h.canvas, 'pointerup', id, 500, 500);
  }
  close(h.camera.orbitYawOffset, 0);
  close(h.camera.orbitPitchOffset, 0.09);
  close(h.camera.zoomMultiplier, 1);
  h.pointer(h.canvas, 'pointerdown', 3, 600);
  h.pointer(h.canvas, 'pointermove', 3, 610);
  close(h.camera.orbitYawOffset, -0.065);
  assert.equal(h.camera.isDragging, true);
});

test('a cinematic flies the camera through its keys, then hands over to the follow camera', () => {
  const h = cameraHarness();
  const key = (x, y, z, lx, ly, lz) => ({ pos: new Vector3(x, y, z), look: new Vector3(lx, ly, lz) });
  let done = 0;
  h.camera.playCinematic([key(0, 100, 0, 0, 0, 50), key(0, 40, 60, 0, 0, 100), key(0, 2, 96, 0, 1.5, 100)], 2, () => done++);
  assert.ok(h.camera.cinematic);
  const heights = [];
  for (let i = 0; i < 40; i++) {
    h.camera.update(0.05, i * 0.05);
    heights.push(h.camera.camera.position.y);
  }
  // it descends the whole way, lands on the last key, and the follow camera has somewhere to glide from
  for (let i = 1; i < heights.length; i++) assert.ok(heights[i] <= heights[i - 1] + 1e-6, `descending at step ${i}`);
  close(h.camera.camera.position.y, 2);
  close(h.camera.camera.position.z, 96);
  assert.equal(h.camera.cinematic, null);
  assert.equal(done, 1);
  assert.equal(h.camera.followEntity, null);
  // easing: little distance covered in the first tenth, most of it in the middle
  assert.ok(heights[3] > 95, `slow start: ${heights[3]}`);
  assert.ok(heights[20] < 60 && heights[20] > 10, `mid flight: ${heights[20]}`);
});

test('skipping a cinematic jumps to its end once', () => {
  const h = cameraHarness();
  let done = 0;
  h.camera.playCinematic([{ pos: new Vector3(0, 50, 0), look: new Vector3(0, 0, 10) }, { pos: new Vector3(5, 2, 20), look: new Vector3(5, 1, 30) }], 6, () => done++);
  h.camera.update(0.5, 0.5);
  assert.ok(h.camera.camera.position.y > 40);
  h.camera.skipCinematic();
  close(h.camera.camera.position.x, 5);
  close(h.camera.camera.position.y, 2);
  assert.equal(done, 1);
  h.camera.skipCinematic(); // nothing left to skip
  assert.equal(done, 1);
});

test('the menu view flies a slow aerial pass on the drone preset', () => {
  const h = cameraHarness();
  h.camera.setMenuView(new Vector3(0, 100, -300), new Vector3(0, 90, -100), new Vector3(0, 60, 200), 40);
  assert.equal(h.camera.activePresetId, 'drone');
  h.camera.update(0.1, 0);
  const start = { ...h.camera.camera.position };
  for (let t = 0.1; t < 20; t += 0.1) h.camera.update(0.1, t);
  const mid = { ...h.camera.camera.position };
  assert.ok(mid.z > start.z + 80, `the pass advances: ${start.z} -> ${mid.z}`);
  assert.ok(mid.y < start.y, 'and comes down a little');
});

function footHarness() {
  const h = cameraHarness({
    position: new Vector3(), heading: 0, speed: 0, type: 'person',
    chaseDistance: 4.3, chaseHeight: 1.95, cameraTargetOffset: new Vector3(0, 1.2, 0)
  });
  h.camera.controllerManager.activeMode = 'person';
  h.camera.orbitPitchOffset = 0;
  return h;
}

function settle(camera, seconds = 1) {
  for (let i = 0; i < seconds * 60; i++) camera.update(1 / 60, i / 60);
}

test('combat framing brings the weapon-side shoulder into view and aiming closes the boom', () => {
  const { camera } = footHarness();
  camera.combatMode = true;
  settle(camera);
  assert.ok(camera.camera.position.x < -0.43);
  assert.ok(camera.camera.position.z > -3.25 && camera.camera.position.z < -3.15);
  const readyDistance = -camera.camera.position.z;
  camera.aimMode = true;
  settle(camera);
  // Aimed, the body stands in the left third: far enough aside to clear the sight, far enough back to keep the hands
  assert.ok(camera.camera.position.x < -0.67 && camera.camera.position.x > -0.72);
  assert.ok(-camera.camera.position.z < readyDistance - 0.9);
  assert.ok(Math.abs(camera.camera.position.z + 2.25) < 0.01);
  assert.ok(Math.abs(camera.camera.fov - 44) < 0.06);
  // a rifle closes the lens further without moving the boom
  camera.aimFov = 40;
  settle(camera, 0.5);
  assert.ok(Math.abs(camera.camera.fov - 40) < 0.06);
  assert.ok(Math.abs(camera.camera.position.z + 2.25) < 0.01);
  close(camera.camera.near, 0.12);
  // The centre ray stays parallel to the intended aim, rather than converging on the character's head.
  assert.ok(Math.abs(camera.camera.target.x - camera.camera.position.x) < 1e-4);
  assert.ok(Math.abs(camera.camera.target.y - camera.camera.position.y) < 1e-4);
});

test('shoulder switching crosses smoothly and restores exactly the same aiming direction', () => {
  const { camera } = footHarness();
  camera.aimMode = true;
  settle(camera);
  const start = camera.camera.position.x;
  assert.equal(camera.swapShoulder(), -1);
  camera.update(1 / 60, 1);
  assert.ok(camera.camera.position.x > start && camera.camera.position.x < 0);
  settle(camera);
  assert.ok(camera.camera.position.x > 0.67);
  assert.ok(Math.abs(camera.camera.target.x - camera.camera.position.x) < 1e-4);
  assert.equal(camera.swapShoulder(), 1);
  settle(camera);
  assert.ok(Math.abs(camera.camera.position.x - start) < 1e-4);
});

test('locked aiming follows the mouse angle on the same camera update', () => {
  const h = footHarness();
  h.camera.aimMode = true;
  h.document.pointerLockElement = h.canvas;
  settle(h.camera, 2);
  h.document.dispatch('mousemove', { movementX: 100, movementY: 0 });
  h.camera.update(1 / 60, 2);
  const direction = new Vector3().subVectors(h.camera.camera.target, h.camera.camera.position);
  const yaw = Math.atan2(direction.x, direction.z);
  assert.ok(Math.abs(yaw - h.camera.footYaw) < 1e-6, 'the rendered aim does not trail the input');
});

test('recoil returns to the original sightline without changing mouse input at any frame rate', () => {
  const states = [];
  for (const fps of [30, 60, 144]) {
    const { camera } = footHarness();
    camera.footYaw = 0.71;
    camera.orbitPitchOffset = -0.17;
    camera.addRecoil(0.06, 0.008);
    for (let i = 0; i < fps / 2; i++) camera.updateRecoil(1 / fps);
    states.push([camera.recoilPitch, camera.recoilYaw]);
    assert.ok(Math.abs(camera.recoilPitch) < 0.00002);
    close(camera.footYaw, 0.71);
    close(camera.orbitPitchOffset, -0.17);
  }
  for (const state of states) { close(state[0], states[0][0]); close(state[1], states[0][1]); }
});

test('sustained recoil stays bounded and teleport clears the spring', () => {
  const { camera } = footHarness();
  for (let i = 0; i < 1000; i++) { camera.addRecoil(0.06, 0.008); camera.updateRecoil(1 / 60); }
  assert.ok(camera.recoilPitch < 0.2 && camera.recoilYaw < 0.05);
  camera.resetForTeleport();
  close(camera.recoilPitch, 0);
  close(camera.recoilYaw, 0);
  close(camera.recoilPitchVelocity, 0);
});

test('camera collision respects near walls, elevated structures and rotated footprints', () => {
  const { cameraCollisionDistance: sweep } = footHarness();
  const origin = new Vector3(0, 1.5, 0), direction = new Vector3(0, 0, -1);
  const wall = { minX: -3, maxX: 3, minY: 0, maxY: 5, minZ: -2, maxZ: -0.5 };
  const distance = sweep(origin, direction, 3, wall);
  assert.ok(distance > 0.15 && distance < 0.25, 'a close wall must not be crossed by a minimum camera distance');
  close(sweep(origin, direction, 3, { ...wall, minY: 4 }), 3);
  const cs = Math.SQRT1_2;
  const rotated = { minX: -2, maxX: 2, minZ: -2, maxZ: 2, maxY: 5, obb: { cx: 0, cz: 0, hx: 2, hz: 0.5, cs, sn: cs } };
  close(sweep(new Vector3(1.4, 1.5, 1.4), direction, 0.3, rotated), 0.3);
});

test('camera sweeps keep open courtyards clear while catching their actual walls', () => {
  const { cameraCollisionDistance: sweep } = footHarness();
  const ring = (r) => [{ x: -r, z: -r }, { x: r, z: -r }, { x: r, z: r }, { x: -r, z: r }];
  const collider = { minX: -4, maxX: 4, minZ: -4, maxZ: 4, maxY: 5, polygon: { outer: ring(4), holes: [ring(2)] } };
  const origin = new Vector3(0, 1.5, 0), direction = new Vector3(0, 0, -1);
  close(sweep(origin, direction, 1.5, collider), 1.5);
  const distance = sweep(origin, direction, 4, collider);
  assert.ok(distance > 1.7 && distance < 1.75);
});

test('the live camera compresses at walls and eases back out without requiring a gameplay flag', () => {
  const { camera } = footHarness();
  camera.aimMode = true;
  settle(camera);
  let walls = [{ minX: -5, maxX: 5, minZ: -3, maxZ: -0.9, maxY: 5 }];
  camera.controllerManager.nearColliders = () => walls;
  camera.update(1 / 60, 1);
  assert.ok(camera.camera.position.z > -0.66);
  const compressed = camera.camera.position.z;
  walls = [];
  camera.update(1 / 60, 1.01);
  assert.ok(camera.camera.position.z < compressed && camera.camera.position.z > -1);
  settle(camera);
  assert.ok(Math.abs(camera.camera.position.z + 2.25) < 0.01);
});

test('a van pulling up behind someone on foot shortens the boom instead of swallowing the eye', () => {
  const { camera } = footHarness();
  camera.combatMode = true;
  camera.controllerManager.nearColliders = () => [];
  settle(camera);
  assert.ok(camera.camera.position.z < -3.1);
  // an oriented box across the street two metres behind the player, as gameplay reports moving vehicles
  camera.vehicleObstacles = () => [{ minY: 0.1, maxY: 1.9, obb: { cx: 0, cz: -3, cs: 1, sn: 0, hx: 3, hz: 1 } }];
  camera.update(1 / 60, 2);
  assert.ok(camera.camera.position.z > -2, 'the camera stays on this side of the van');
  assert.ok(camera.camera.position.z < -0.6, 'and is never pulled into the head');
  camera.vehicleObstacles = null;
  settle(camera);
  assert.ok(camera.camera.position.z < -3.1);
});

test('the view holds still while the pointer steers the weapon wheel', () => {
  const { camera } = footHarness();
  assert.equal(camera.lookLocked, false);
});

test('a wall against the back slides the camera along the shoulder instead of inside the body', () => {
  const { camera } = footHarness();
  camera.aimMode = true;
  camera.footYaw = Math.PI / 2;
  camera.controllerManager.nearColliders = () => [{ minX: -5, maxX: -0.34, minZ: -5, maxZ: 5, maxY: 5 }];
  settle(camera);
  const p = camera.camera.position;
  assert.ok(p.x > -0.1, 'the near plane stays on the open side of the wall');
  assert.ok(Math.hypot(p.x, p.z) >= 0.85, 'the camera stays out of the head and rifle stock');
  assert.equal(camera.bodyOccluded, false);
  assert.ok(p.z > 0.8, 'the selected shoulder remains preferred');
});

test('a blocked shoulder uses the other side and an enclosed camera exposes the body occlusion flag', () => {
  const { camera } = footHarness();
  camera.aimMode = true;
  camera.footYaw = Math.PI / 2;
  const back = { minX: -5, maxX: -0.34, minZ: -5, maxZ: 5, maxY: 5 };
  const right = { minX: -5, maxX: 5, minZ: 0.35, maxZ: 5, maxY: 5 };
  let walls = [back, right];
  camera.controllerManager.nearColliders = () => walls;
  settle(camera);
  assert.ok(camera.camera.position.z < -0.8);
  assert.equal(camera.bodyOccluded, false);
  walls = [back, right, { minX: -5, maxX: 5, minZ: -5, maxZ: -0.35, maxY: 5 }];
  settle(camera);
  assert.equal(camera.bodyOccluded, true);
  assert.ok(camera.camera.position.x > -0.1);
  camera.setCameraPreset('drone');
  camera.update(1 / 60, 3);
  assert.equal(camera.bodyOccluded, false, 'render masking cannot leak into a cinematic or vehicle camera');
});

function drivingHarness() {
  const h = cameraHarness();
  h.entity.body = { vx: 0, vz: 0, wy: 0, grounded: 4, longG: 0,
    wheels: Array.from({ length: 4 }, () => ({ rough: 0.0035, hasGround: true })) };
  h.entity.tune = { top: 75 };
  h.entity.spec = { height: 1.45, halfW: 0.9 };
  h.camera.controllerManager.keys = {};
  h.camera.camera.rotateZ = function (angle) { this.rotation.z = angle; };
  return h;
}

test('driving lens keeps the car readable at maximum speed and caps nitro expansion', () => {
  const { camera, entity } = drivingHarness();
  entity.speed = entity.body.vz = 100;
  settle(camera, 3);
  assert.ok(camera.camera.fov < 70 && camera.camera.fov > 68);
  entity.body.nitro = 1;
  settle(camera, 3);
  assert.ok(camera.camera.fov <= 73.05, `FOV ${camera.camera.fov}`);
  assert.ok(camera.currentPos.z < entity.position.z - 6);
  assert.ok(camera.currentLookAt.z < entity.position.z + 8, 'the car remains the framing subject');
});

test('car acceleration spring is frame-rate independent and a stalled frame cannot explode it', () => {
  const results = [];
  for (const fps of [30, 60, 144]) {
    const { camera, entity } = drivingHarness();
    entity.body.longG = 0.8;
    for (let frame = 0; frame < fps; frame++) camera.chaseCar(entity, 1 / fps, new Vector3(), new Vector3());
    results.push(camera.carPull);
    assert.ok(camera.carPull > 0.41 && camera.carPull < 0.44);
    entity.body.longG = -1;
    camera.chaseCar(entity, 1.5, new Vector3(), new Vector3());
    assert.ok(Number.isFinite(camera.carPull) && Math.abs(camera.carPull) < 0.62);
    for (let frame = 0; frame < fps; frame++) camera.chaseCar(entity, 1 / fps, new Vector3(), new Vector3());
    assert.ok(camera.carPull < -0.5, 'the boom closes under braking');
  }
  for (const value of results) assert.ok(Math.abs(value - results[0]) < 1e-9);
});

test('looking behind cuts to the rear view without sweeping the boom through the driver', () => {
  const { camera, entity } = drivingHarness();
  settle(camera);
  assert.ok(camera.currentPos.z < entity.position.z - 6);
  camera.controllerManager.keys.down = true;
  camera.update(1 / 60, 2);
  assert.ok(camera.currentPos.z > entity.position.z + 6);
  assert.ok(camera.currentLookAt.z < entity.position.z);
  camera.controllerManager.keys.down = false;
  camera.update(1 / 60, 3);
  assert.ok(camera.currentPos.z < entity.position.z - 6);
});

test('driving teleport discards speed, roll, spring and old yaw immediately', () => {
  const { camera, entity } = drivingHarness();
  entity.speed = entity.body.vz = 55;
  entity.body.wy = 0.4; entity.body.longG = 0.7;
  settle(camera, 2);
  entity.position.set(-500, 0, 2500); entity.heading = 2;
  entity.speed = entity.body.vz = entity.body.wy = entity.body.longG = 0;
  camera.resetForTeleport();
  camera.update(1 / 60, 3);
  close(camera.carYaw, 2);
  close(camera.carPull, 0);
  close(camera.carRoll, 0);
  close(camera.camera.fov, 56);
  assert.ok(Math.hypot(camera.currentPos.x - entity.position.x, camera.currentPos.z - entity.position.z) < 7);
});

test('action driving view shares progressive corner anticipation with a restrained horizon', () => {
  const { camera, entity } = drivingHarness();
  camera.setCameraPreset('action', true);
  entity.speed = entity.body.vz = 30;
  entity.body.wy = 0.6;
  settle(camera, 3);
  assert.ok(camera.carSide > 1);
  assert.ok(Math.abs(camera.carRoll) <= 0.0181);
  assert.ok(camera.camera.fov > 61 && camera.camera.fov < 70);
  assert.ok(camera.currentPos.y > 1 && camera.currentPos.y < 1.5);
});
