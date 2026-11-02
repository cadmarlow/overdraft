import * as THREE from 'three/webgpu';
import { castShot, raycastBuildings } from './weapons.js';
import { carSpecs } from './car-assets.js';
import { createWingsuitMesh } from './wingsuit.js';
import { createCanopy, canopyMatrix } from './canopy.js';
import { AirFx } from './air-fx.js';
import { Wind, buildingLift, stepSuit, suitControl, openSuit, suitTouchdown, stepWing, openWing, wingTouchdown, wingControl } from './air-physics.js';

// Manhattan upwards (0.9 « Leverage »): the « Levier » grapple, ledges to climb, walls to hang from, cars' roofs to ride,
// free fall, the wingsuit and (0.9.1) the paraglider ('falling'). Each of these is a state of the protagonist; while one
// is on, gameplay.js hands this module the frame (updatePerson) and the controls that change their meaning (E, Space, F).

const STATES = new Set(['climbing', 'grapple', 'hanging', 'surfing', 'freefall', 'wingsuit', 'falling']);
const RANGE = 95; // m from the hero: the grapple's reach
const PULL_SPEED = 34; // m/s on the rope
const PULL_ACCEL = 70;
const LEDGE_SNAP = 10; // a hook this close under a roof's edge pulls the hero over it
const CLIMB_MIN = 0.6, CLIMB_MAX = 2.7; // ledges a jump climbs onto
const HANG_DROP = 2.05; // m from the hands to the feet, hanging
const FALL_SAFE = 11; // m/s: a landing faster than this hurts
const FREEFALL_HEIGHT = 24; // m of air under the feet before free fall takes over a fall
const AUTO_CHUTE = 30; // m: in free fall (not in the suit), the canopy opens itself this low
const TERMINAL = 54; // m/s, belly to earth
const NEAR = 7.5; // m: a wall or a roof this close to the wingsuit is a « frôlement »
const HIPS = 0.95; // m from the feet to the hips: the pivot of a body lying in the air

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _dir = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _cd = new THREE.Vector3(), _cf = new THREE.Vector3(), _cr = new THREE.Vector3();
const _air = { x: 0, y: 0, z: 0 }, _wind = { x: 0, y: 0, z: 0 };
const _m = new THREE.Matrix4();
const _hands = [new THREE.Vector3(), new THREE.Vector3()];
const _feet = [new THREE.Vector3(), new THREE.Vector3()];

class Vertical {
  constructor(game) {
    this.game = game;
    // flight (air-physics.js): the suit, the wing, the air, where the player looks
    this.suitState = openSuit({}, 0, 0, 0, 0, 0, 0);
    this.suitInput = {}; this.suitKeys = { dive: 0, flare: 0, left: 0, right: 0 };
    this.wing = openWing({}, 0, 0, 0, 0, 0, 0, 0);
    this.wingInput = {}; this.wingKeys = { left: 0, right: 0, brake: 0, bar: 0 }; this.noKeys = { left: 0, right: 0, brake: 0, bar: 0 };
    this.wind = new Wind(7);
    this.lift = 0; this.liftT = 0;
    this.aimYaw = 0; this.aimPitch = 0; this.aimIdle = 9; this.flying = false;
    this.fold = 0; this.flyT = 0;
    this.foldAt = new THREE.Vector3(); this.foldAt.heading = 0;
    this.view = { pos: new THREE.Vector3(), look: new THREE.Vector3(), anchor: new THREE.Vector3(), offset: new THREE.Vector3(), roll: 0, fov: 0, stiff: 10 };
    this.vel = new THREE.Vector3();
    this.pull = this.hang = this.climb = this.surf = null;
    this.flash = null; // a rope shown for a moment (a yank, a miss)
    this.aim = null; // what the reticle is on, refreshed a few times a second
    this.aimT = 0;
    this.held = { up: false, jump: false };
    this.streak = { t: 0, pts: 0, best: NEAR, quiet: 0 };
    this.followT = 0;
    this.lastYaw = null;
    this.ropeAt = new THREE.Vector3(); // the hook's anchor
    const scene = game.scene;
    const steel = new THREE.MeshStandardNodeMaterial({ color: 0x1d1f22, roughness: 0.5, metalness: 0.35 });
    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 6, 1).translate(0, 0.5, 0), steel);
    this.hook = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), new THREE.MeshStandardNodeMaterial({ color: 0xe1f3a0, roughness: 0.35, metalness: 0.7 }));
    for (const m of [this.rope, this.hook]) { m.matrixAutoUpdate = false; m.castShadow = true; m.frustumCulled = false; scene.add(m); }
    this.suit = createWingsuitMesh(scene);
    this.canopy = createCanopy(scene);
    this.airFx = new AirFx(scene);
    this.buildHud();
  }

  owns(state) { return STATES.has(state); }
  get person() { return this.game.person; }
  get keys() { return this.game.controllers.keys; }

  // ---- Interface ---------------------------------------------------------------------------------------------------
  buildHud() {
    const el = (tag, cls, parent, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; parent.append(n); return n; };
    const hud = this.hud = el('div', 'sky-hud', document.body);
    hud.id = 'sky-hud';
    const cell = (label) => { const c = el('div', 'sky-cell', hud); const v = el('strong', null, c, '0'); el('span', null, c, label); return v; };
    this.altText = cell('M SOL');
    this.speedText = cell('KM/H');
    this.varioText = cell('M/S');
    const wind = el('div', 'sky-wind', hud);
    this.windArrow = el('i', null, wind);
    this.windText = el('span', null, wind, 'VENT');
    this.promptEl = el('div', 'sky-prompt', document.body);
    this.promptEl.id = 'sky-prompt';
    this.near = el('div', 'sky-near', hud);
    this.nearText = el('strong', null, this.near, 'FRÔLEMENT');
    this.nearFill = el('i', null, el('div', 'sky-near-track', this.near));
    this.nearPts = el('span', null, this.near, '');
  }

  keybar(k, end) {
    const g = this.game, s = g.state, held = g.weaponId === 'grapple';
    // the grapple fires with a click once it is in hand; E takes it out
    const hook = held ? k(['CLIC'], s === 'grapple' ? 'Nouveau grappin' : 'Grappin') : k(['E'], 'Sortir le grappin');
    if (s === 'freefall') return [k(['ESPACE', 'MAJ'], 'Wingsuit'), k(['F'], 'Parapente'), k(['ZQSD'], 'Se déplacer'), k(['SOURIS'], 'Regarder'), hook, ...end];
    if (s === 'wingsuit') return [k(['SOURIS'], 'Diriger'), k(['Z'], 'Piquer'), k(['S'], 'Cabrer'), k(['Q', 'D'], 'Virer'), k(['F'], 'Parapente'), hook, ...end];
    if (s === 'falling') return [k(['SOURIS'], 'Diriger'), k(['Q', 'D'], 'Freins'), k(['S'], 'Freiner, arrondir'), k(['Z'], 'Accélérer'), k(['F'], 'Larguer'), hook, ...end];
    if (s === 'hanging') return [hook, k(['MAJ'], 'Sauter'), k(['Z'], 'Grimper'), k(['S'], 'Lâcher'), ...end];
    if (s === 'surfing') return [k(['F'], 'Prendre le volant'), k(['MAJ'], 'Sauter'), k(['CLIC D.', 'CLIC'], held ? 'Viser, grappin' : 'Tirer'), held ? '' : hook, ...end];
    if (s === 'grapple') return [k(['MAJ'], 'Lâcher (élan)'), hook, ...end];
    return [hook, ...end];
  }

  // E: the grapple out of the pocket, or back to the weapon that was in hand
  toggleGrapple() {
    const g = this.game;
    if (!g.active || g.state === 'driving' || g.state === 'dead' || g.state === 'busted' || g.state === 'swimming') return;
    if (g.weaponId === 'grapple') { g.selectWeapon(this.lastWeapon && g.weapons[this.lastWeapon] ? this.lastWeapon : 'fists'); return; }
    this.lastWeapon = g.weaponId;
    g.selectWeapon('grapple');
  }

  // Chase camera framing for these states (gameplay.js sets the on-foot one first)
  frame(walker) {
    const s = this.game.state;
    if (!STATES.has(s)) return;
    if (s === 'wingsuit' || s === 'freefall' || s === 'falling') return; // the flight camera places itself
    const fly = false;
    walker.chaseDistance = s === 'wingsuit' ? 6.2 : fly ? 6.5 : s === 'surfing' ? 5.4 : s === 'climbing' ? 4.3 : s === 'hanging' ? 5.6 : 5.2;
    // hanging, the camera drops under the hero and looks up the wall: where the next hook goes
    walker.chaseHeight = fly ? 1.5 : s === 'surfing' ? 2.3 : s === 'hanging' ? 0.2 : 1.9;
    walker.cameraTargetOffset.y = fly ? HIPS + 0.5 : s === 'hanging' ? 4.2 : this.game.footCameraY;
  }

  // ---- The grapple -------------------------------------------------------------------------------------------------
  get canFire() {
    const s = this.game.state;
    return this.game.active && (s === 'onFoot' || s === 'freefall' || s === 'wingsuit' || s === 'hanging' || s === 'surfing' || s === 'grapple' || s === 'falling');
  }

  // What lies under the crosshair within reach: the camera's ray, starting just past the hero
  acquire() {
    const g = this.game, cam = g.camera.camera, p = this.person.position;
    cam.getWorldDirection(_dir);
    const o = cam.position;
    const past = Math.max(0, (p.x - o.x) * _dir.x + (p.y + 1.4 - o.y) * _dir.y + (p.z - o.z) * _dir.z) + 0.8;
    const sx = o.x + _dir.x * past, sy = o.y + _dir.y * past, sz = o.z + _dir.z * past;
    g.world.ignoreCar = this.surf?.car ?? null;
    const hit = castShot(g.world, sx, sy, sz, _dir.x, _dir.y, _dir.z, RANGE, g.player);
    g.world.ignoreCar = null;
    if (hit.kind === 'none' || hit.kind === 'player') return null;
    if (this.surf && hit.target && (hit.target === this.surf.car || hit.target === this.surf.v)) return null;
    if (hit.kind === 'traffic' && hit.target === this.surf?.v) return null;
    return hit;
  }

  fire() {
    const g = this.game;
    if (!this.canFire) return;
    const hit = this.acquire();
    const p = this.person;
    if (!hit) {
      g.audio.ui('deny');
      this.showRope(this.missPoint(), 0.18);
      this.missFlash();
      return;
    }
    g.audio.sfx('throw', p.position.x, p.position.y + 1.5, p.position.z, { rate: 1.6, intensity: 0.8 });
    g.audio.sfx('reload', hit.x, hit.y, hit.z, { rate: 2.2, intensity: 0.5 });
    if (hit.kind === 'ped') return this.yankPed(hit);
    if (hit.kind === 'actor') return this.yankActor(hit);
    if (hit.kind === 'traffic' || hit.kind === 'car') return this.startPull(hit, 'surf');
    if (hit.kind === 'ground') return this.startPull(hit, 'zip');
    const c = hit.target;
    if (hit.ny > 0.5) return this.startPull(hit, c?.roof ? 'roof' : 'zip');
    if (c?.roof) {
      // « Levier »: whatever part of a facade is aimed at, the hook goes for the roof's edge above it when the rope reaches,
      // and as high up the wall as it reaches when it does not
      const top = this.edgeReach(hit, c);
      if (top === c.maxY && this.roofSpot(hit, top)) return this.startPull(hit, 'ledge');
      hit.y = Math.max(hit.y, top - 1);
      return this.startPull(hit, 'wall');
    }
    if ((c?.maxY ?? 0) > 6) return this.startPull(hit, 'wall');
    return this.startPull(hit, 'zip');
  }

  // The highest point straight up a building's wall from `hit` that the rope reaches: its roof's edge when close enough
  edgeReach(hit, c) {
    const p = this.person.position;
    const flat = Math.hypot(hit.x - p.x, hit.z - p.z);
    const reach = p.y + 1.5 + Math.sqrt(Math.max(0, RANGE * RANGE - flat * flat));
    return c.maxY - hit.y <= LEDGE_SNAP || c.maxY <= reach ? c.maxY : Math.max(hit.y, reach);
  }

  // A point straight ahead at full reach, for a hook that finds nothing
  missPoint() {
    const cam = this.game.camera.camera;
    cam.getWorldDirection(_dir);
    return _b.copy(this.person.position).add(_a.set(0, 1.5, 0)).addScaledVector(_dir, RANGE * 0.6);
  }

  // Over a roof's edge, past the parapet: where the hero lands after the vault, or null when nothing up there holds them
  roofSpot(hit, top) {
    const roofs = this.game.controllers;
    // straight in from the hook first, then a little to either side (narrow roofs, parapets, roof structures)
    const sx = -hit.nz, sz = hit.nx;
    for (const side of [0, 1.5, -1.5, 3, -3]) {
      for (const inset of [1.7, 2.6, 1.1, 3.6, 0.7]) {
        const x = hit.x - hit.nx * inset + sx * side, z = hit.z - hit.nz * inset + sz * side;
        const y = roofs.roofHeight(x, z, top + 0.05, 0.2);
        if (Math.abs(y - top) < 0.05 && roofs.roofHeight(x, z, 1e4, 0) <= top + 0.05) return { x, y: top, z };
      }
    }
    return null;
  }

  startPull(hit, mode) {
    const g = this.game, p = this.person;
    this.release(false);
    this.hang = this.surf = this.climb = null;
    const pull = { mode, speed: Math.max(4, this.vel.length() * 0.5), t: 0, stuck: 0, nx: hit.nx, nz: hit.nz, hit: { x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, nz: hit.nz } };
    this.ropeAt.set(hit.x, hit.y, hit.z);
    if (mode === 'ledge') {
      const top = hit.target.maxY;
      this.ropeAt.y = top;
      pull.top = top;
      pull.land = this.roofSpot(hit, top);
      pull.target = new THREE.Vector3(hit.x + hit.nx * 0.45, top - 1.55, hit.z + hit.nz * 0.45);
    } else if (mode === 'wall') {
      pull.target = new THREE.Vector3(hit.x + hit.nx * 0.42, hit.y - HANG_DROP, hit.z + hit.nz * 0.42);
      pull.top = hit.target?.roof ? hit.target.maxY : null;
    } else if (mode === 'surf') {
      pull.car = hit.kind === 'car' ? hit.target : null;
      pull.v = hit.kind === 'traffic' ? hit.target : null;
      const pose = this.vehiclePose(pull);
      // where on its roof the hook bit, kept in the vehicle's frame
      const dx = hit.x - pose.x, dz = hit.z - pose.z, s = Math.sin(pose.yaw), c = Math.cos(pose.yaw);
      pull.lx = clamp(dx * c - dz * s, -pose.halfW * 0.5, pose.halfW * 0.5);
      pull.lz = clamp(dx * s + dz * c, -pose.halfL * 0.45, pose.halfL * 0.45);
      pull.target = new THREE.Vector3();
      this.surfPoint(pull, pose, pull.target);
    } else {
      // roof top, street, a lamp post: feet on the spot (the street: just short of it)
      pull.target = new THREE.Vector3(hit.x + hit.nx * 0.4, hit.y + (hit.ny > 0.5 ? 0 : -0.9), hit.z + hit.nz * 0.4);
    }
    // the rope can't drag the hero through the floor they stand on
    pull.target.y = Math.max(pull.target.y, g.controllers.getGroundHeight(pull.target.x, pull.target.z, 'person', pull.target.y + 0.3));
    this.pull = pull;
    this.setState('grapple');
    p.verticalVel = 0;
    g.hero.setWeapon(null);
  }

  updatePull(dt) {
    const g = this.game, p = this.person, pull = this.pull;
    pull.t += dt;
    if (this.pressed('jump')) { this.release(true); return; }
    if (pull.mode === 'surf') {
      const pose = this.vehiclePose(pull);
      if (!pose.alive) { this.release(true); return; }
      this.surfPoint(pull, pose, pull.target);
      this.ropeAt.copy(pull.target).y += 0.2;
    }
    const to = _a.subVectors(pull.target, p.position);
    const d = to.length();
    pull.speed = Math.min(PULL_SPEED, pull.speed + PULL_ACCEL * dt);
    const step = pull.speed * dt;
    if (d <= step + 0.08) { p.position.copy(pull.target); this.arrive(); return; }
    to.multiplyScalar(1 / d);
    this.vel.copy(to).multiplyScalar(pull.speed);
    const bx = p.position.x + to.x * step, bz = p.position.z + to.z * step;
    p.position.set(bx, p.position.y + to.y * step, bz);
    g.controllers.resolveHorizontalCollision(p.position, 0.34, null, null, 'person');
    const pushed = Math.hypot(p.position.x - bx, p.position.z - bz);
    pull.stuck = pushed > step * 0.5 ? pull.stuck + dt : 0;
    const floor = g.controllers.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y + 0.3);
    if (p.position.y < floor) p.position.y = floor;
    if (Math.hypot(to.x, to.z) > 0.2) p.heading = Math.atan2(to.x, to.z);
    p.speed = pull.speed;
    if (pull.stuck > 0.3 || pull.t > 7) this.release(true);
  }

  arrive() {
    const pull = this.pull, p = this.person;
    this.pull = null;
    if (pull.mode === 'ledge' && pull.land) { this.startClimb(pull.land, 0.55); return; }
    if (pull.mode === 'wall' || pull.mode === 'ledge') { this.startHang(pull.hit, pull.top); return; }
    if (pull.mode === 'surf') { this.startSurf(pull); return; }
    // on the spot: a short hop of momentum, then on foot
    this.toFoot(this.vel.x * 0.15, Math.min(0, this.vel.y) * 0.1, this.vel.z * 0.15);
    p.speed = 0;
  }

  // Off the rope (or anything else) into the air, keeping the speed: the slingshot
  release(keepSpeed = true) {
    if (!this.pull) return;
    this.pull = null;
    if (keepSpeed) this.toFoot(this.vel.x, this.vel.y + 3, this.vel.z);
  }

  // ---- Yanks -------------------------------------------------------------------------------------------------------
  yankPed(hit) {
    const g = this.game, p = this.person.position, ped = hit.target;
    this.showRope(_b.set(ped.x, hit.y, ped.z), 0.32);
    g.killPed(ped, Math.atan2(p.x - ped.x, p.z - ped.z), 8, 'player');
    g.audio.sfx('punch', ped.x, 1, ped.z, { rate: 0.8 });
  }

  yankActor(hit) {
    const g = this.game, p = this.person.position, a = hit.target;
    this.showRope(_b.set(a.x, hit.y, a.z), 0.32);
    const dx = p.x - a.x, dz = p.z - a.z, d = Math.hypot(dx, dz) || 1;
    g.actors.damage(a, 48, dx / d * 9, dz / d * 9, 'vehicle');
    if (!a.dead) { a.vx = dx / d * 6; a.vz = dz / d * 6; }
    g.audio.sfx('punch', a.x, 1, a.z, { rate: 0.8 });
    if (a.team === 'police') g.crime(a.dead ? 'copKilled' : 'copHurt', a.x, a.z);
    g.hud.hit(a.dead);
  }

  showRope(to, seconds) {
    this.ropeAt.copy(to);
    this.flash = seconds;
  }

  // ---- Hanging, climbing -------------------------------------------------------------------------------------------
  startHang(hit, top) {
    const p = this.person;
    this.hang = { x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, nz: hit.nz, top };
    this.ropeAt.set(hit.x, hit.y, hit.z);
    p.position.set(hit.x + hit.nx * 0.42, hit.y - HANG_DROP, hit.z + hit.nz * 0.42);
    p.heading = Math.atan2(-hit.nx, -hit.nz);
    this.vel.set(0, 0, 0);
    this.setState('hanging');
    this.game.audio.sfx('punch', hit.x, hit.y, hit.z, { rate: 1.4, intensity: 0.4 });
  }

  updateHang() {
    const h = this.hang, p = this.person, keys = this.keys;
    p.position.set(h.x + h.nx * 0.42, h.y - HANG_DROP, h.z + h.nz * 0.42);
    p.speed = 0;
    if (this.pressed('jump')) {
      // kick off the wall, up and away
      const yaw = this.game.camera.footYaw;
      this.hang = null;
      this.toFoot(h.nx * 5.5 + Math.sin(yaw) * 2, 6.5, h.nz * 5.5 + Math.cos(yaw) * 2);
      return;
    }
    if (keys.backward) { this.hang = null; this.toFoot(h.nx * 1.2, 0, h.nz * 1.2); return; }
    if (keys.forward && h.top !== null && h.top - h.y < 3.2) {
      const land = this.roofSpot(h, h.top);
      if (land) { this.hang = null; this.startClimb(land, 0.7); }
    }
  }

  // A ledge within reach ahead of someone standing (jumping at it climbs it), or null
  ledgeAhead() {
    const p = this.person.position, c = this.game.controllers, h = this.person.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    for (const reach of [0.55, 0.8]) {
      const x = p.x + fx * reach, z = p.z + fz * reach;
      const top = c.roofHeight(x, z, p.y + CLIMB_MAX, 0);
      if (top < p.y + CLIMB_MIN) continue;
      for (const inset of [0.45, 0.9]) {
        const lx = x + fx * inset, lz = z + fz * inset;
        if (Math.abs(c.roofHeight(lx, lz, top + 0.05, 0.1) - top) < 0.05 && c.roofHeight(lx, lz, 1e4, 0) <= top + 0.05) return { x: lx, y: top, z: lz };
      }
    }
    return null;
  }

  startClimb(to, duration) {
    const p = this.person;
    this.climb = { from: p.position.clone(), to: new THREE.Vector3(to.x, to.y, to.z), t: 0, T: duration };
    this.setState('climbing');
    this.game.audio.sfx('punch', to.x, to.y, to.z, { rate: 1.6, intensity: 0.35 });
  }

  updateClimb(dt) {
    const c = this.climb, p = this.person;
    c.t += dt;
    const u = clamp(c.t / c.T, 0, 1);
    const rise = Math.min(1, u / 0.55), over = clamp((u - 0.45) / 0.55, 0, 1);
    const e = (x) => x * x * (3 - 2 * x);
    p.position.x = c.from.x + (c.to.x - c.from.x) * (0.25 * e(rise) + 0.75 * e(over));
    p.position.z = c.from.z + (c.to.z - c.from.z) * (0.25 * e(rise) + 0.75 * e(over));
    p.position.y = c.from.y + (c.to.y + 0.18 - c.from.y) * e(rise) - 0.18 * e(over);
    p.heading = Math.atan2(c.to.x - c.from.x, c.to.z - c.from.z);
    p.speed = 0;
    if (u >= 1) {
      p.position.copy(c.to);
      this.climb = null;
      this.toFoot(0, 0, 0);
      p.footing = c.to.y;
    }
  }

  // ---- Riding a car's roof -------------------------------------------------------------------------------------------
  vehiclePose(s) {
    const out = this._pose ??= {};
    if (s.car) {
      const c = s.car;
      out.x = c.position.x; out.y = c.position.y || 0; out.z = c.position.z; out.yaw = c.heading;
      out.top = (c.spec?.height ?? 1.45) + 0.02; out.halfW = c.halfW ?? 0.9; out.halfL = c.halfL ?? 2.2;
      out.alive = !c.destroyed && !c.wreck && c.mesh.visible && !(c === this.game.car && this.game.state === 'driving');
    } else {
      const v = s.v;
      out.x = v.x; out.y = 0; out.z = v.z; out.yaw = (v.yaw || 0) + (v.yawOffset || 0);
      out.top = v.bus ? 3.15 : (carSpecs[v.bodyType]?.height ?? 1.5) + 0.02;
      out.halfW = v.halfWidth ?? 0.9; out.halfL = v.halfL ?? v.half ?? 2.2;
      out.alive = !!v.edge && !v.destroyed && !v.wrecked;
    }
    return out;
  }

  surfPoint(s, pose, out) {
    const sn = Math.sin(pose.yaw), cs = Math.cos(pose.yaw);
    return out.set(pose.x + s.lx * cs + s.lz * sn, pose.y + pose.top, pose.z - s.lx * sn + s.lz * cs);
  }

  startSurf(pull) {
    const p = this.person, pose = this.vehiclePose(pull);
    this.surf = { car: pull.car, v: pull.v, lx: pull.lx, lz: pull.lz, rel: wrap(p.heading - pose.yaw), last: null, vx: 0, vz: 0 };
    this.setState('surfing');
    this.game.audio.sfx('punch', p.position.x, p.position.y, p.position.z, { rate: 1.1, intensity: 0.6 });
    this.game.toast('Sur le toit', 'F : prendre le volant · Espace : sauter');
  }

  updateSurf(dt) {
    const s = this.surf, p = this.person, pose = this.vehiclePose(s);
    if (!pose.alive) { this.surf = null; this.toFoot(s.vx, 2, s.vz); return; }
    // the rider turns with the car and leans towards where the camera looks
    s.rel = wrap(s.rel + wrap(this.game.camera.footYaw - pose.yaw - s.rel) * (1 - Math.exp(-dt * 3)));
    this.surfPoint(s, pose, _a);
    if (s.last && dt > 0) { s.vx = (_a.x - s.last.x) / dt; s.vz = (_a.z - s.last.z) / dt; }
    s.last = (s.last ?? new THREE.Vector3()).copy(_a);
    p.position.copy(_a);
    p.heading = pose.yaw + s.rel;
    p.speed = 0;
    if (this.pressed('jump')) { this.surf = null; this.toFoot(s.vx, 5.5, s.vz); }
  }

  // F on a roof: in through the window, at the wheel of a car still moving
  hijack() {
    const g = this.game, s = this.surf;
    const pose = this.vehiclePose(s);
    let car = s.car;
    if (car?.police || car?.mode) { g.toast('Impossible', 'Pas depuis le toit de celui-là.'); return; }
    const speed = Math.hypot(s.vx, s.vz);
    if (!car) {
      const v = s.v;
      const color = new THREE.Color().setRGB(...(v.paint || [0.5, 0.5, 0.5]));
      car = g.makeCar(v.bodyType || 'sedan', color.getHex(), new THREE.Vector3(pose.x, 0, pose.z), pose.yaw);
      car.hp = Math.max(20, v.hp ?? 100);
      g.traffic.removeVehicle(v);
      g.crime('carjack', pose.x, pose.z);
    }
    if (car.ai) car.ai = null;
    this.surf = null;
    const p = this.person;
    car.speed = speed;
    g.controllers.resetInput();
    g.controllers.entities.car = car;
    p.inVehicle = true;
    p.suspended = false;
    car.fallen = false;
    car.ridden = true;
    g.state = 'driving';
    g.onMode(car.mode || 'car');
    if (!car.stolen) { car.stolen = true; g.stolen++; }
    g.announce(car);
    g.camera.resetOrbit();
    g.radio?.setPlaying(true);
    document.body.dataset.gameState = g.state;
    g.updateKeybar();
    g.audio.sfx('punch', pose.x, 1.2, pose.z, { rate: 0.9 });
  }

  // ---- Free fall, the wingsuit and the paraglider (0.9.1) -----------------------------------------------------------
  // A fall from on foot: called every frame while airborne; takes over once there is real height under the hero. A run
  // or a jump off the edge is a base jump: the suit then opens by itself.
  checkFall(ground) {
    const p = this.person;
    if (p.verticalVel < -3 && p.position.y - ground > FREEFALL_HEIGHT) this.startFreefall(p.airVX || 0, p.verticalVel, p.airVZ || 0, Math.hypot(p.speed || 0, p.airVX || 0) > 3);
  }

  startFreefall(vx, vy, vz, baseJump = false) {
    const p = this.person, flat = Math.hypot(vx, vz);
    this.vel.set(vx, vy, vz);
    this.stunT = 0;
    this.fallT = 0;
    this.autoSuit = baseJump || flat > 3.5;
    this.takeAim(flat > 2 ? Math.atan2(vx, vz) : this.game.camera.footYaw, -0.3);
    this.setState('freefall');
    this.game.hero.setWeapon(null);
    if (!this.autoSuit) this.prompt('ESPACE ou MAJ : wingsuit · F : parapente');
  }

  // Where the player looks in the air (yaw, pitch): the body flies there
  takeAim(yaw, pitch) {
    if (STATES.has(this.game.state) && this.flying) return;
    this.aimYaw = yaw;
    this.aimPitch = pitch;
    this.aimIdle = 9;
    this.flying = true;
  }

  updateFreefall(dt) {
    const g = this.game, p = this.person, keys = this.keys, v = this.vel;
    this.steer(dt, 'freefall');
    this.fallT += dt;
    this.stunT = Math.max(0, (this.stunT || 0) - dt);
    // belly to earth: gravity against the drag of a spread body (about 200 km/h at most)
    v.y -= 9.81 * dt;
    if (v.y < 0) v.y += (9.81 / (TERMINAL * TERMINAL)) * v.y * v.y * dt;
    // tracking: leaning, the body slides through the air where the player pushes; the air carries it too
    const x = Number(keys.right) - Number(keys.left), z = Number(keys.forward) - Number(keys.backward);
    const yaw = this.aimYaw, m = Math.hypot(x, z) || 1;
    const lx = -x / m, lz = z / m, push = x || z ? 10 : 0;
    this.wind.at(p.position.x, p.position.y, p.position.z, _air);
    const tx = (Math.cos(yaw) * lx + Math.sin(yaw) * lz) * push + _air.x, tz = (-Math.sin(yaw) * lx + Math.cos(yaw) * lz) * push + _air.z;
    // the body keeps most of its run-up: the air takes it slowly (pushing keys faster)
    const k = 1 - Math.exp(-dt * (x || z ? 0.9 : 0.25));
    v.x += (tx - v.x) * k; v.z += (tz - v.z) * k;
    p.position.addScaledVector(v, dt);
    g.controllers.resolveHorizontalCollision(p.position, 0.34, null, null, 'person');
    p.heading += wrap(yaw - p.heading) * (1 - Math.exp(-dt * 3));
    p.speed = v.length();
    const ground = g.controllers.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y + 0.3);
    const asked = this.pressed('up') | this.pressed('jump');
    if (this.stunT <= 0 && (asked || (this.autoSuit && this.fallT > 0.2))) { this.startWingsuit(); return; }
    if (p.position.y - ground < AUTO_CHUTE && v.y < -14 && this.stunT <= 0) { this.openCanopy(true); return; }
    if (p.position.y <= ground) { p.position.y = ground; this.landHard(-v.y); return; }
    this.flightCamera('freefall', dt);
  }

  startWingsuit() {
    const p = this.person, s = this.suitState;
    openSuit(s, p.position.x, p.position.y + HIPS, p.position.z, this.vel.x, this.vel.y, this.vel.z);
    // the view stays where it was looking, pitched to a dive: a good line for the first seconds
    this.aimPitch = clamp(this.aimPitch, -0.6, -0.28); // the best glide unless the view already looked steeper
    this.streak.t = this.streak.pts = 0; this.streak.best = NEAR; this.streak.quiet = 0;
    this.setState('wingsuit');
    this.game.hud.say('', '', 0.01);
    this.prompt('SOURIS : diriger · Z piquer · S cabrer · F : parapente', 4);
    this.game.audio.sfx('throw', s.x, s.y, s.z, { rate: 0.45, intensity: 1 });
  }

  updateWingsuit(dt) {
    const g = this.game, p = this.person, s = this.suitState, keys = this.keys, c = g.controllers;
    this.steer(dt, 'wingsuit');
    const px = s.x, py = s.y, pz = s.z;
    this.wind.at(s.x, s.y, s.z, _air);
    _air.y = this.updraftAt(s.x, s.y, s.z, dt);
    const k = this.suitKeys;
    k.dive = keys.forward ? 1 : 0; k.flare = keys.backward ? 1 : 0; k.left = keys.left ? 1 : 0; k.right = keys.right ? 1 : 0;
    suitControl(s, { yaw: this.aimYaw, pitch: this.aimPitch }, k, this.suitInput);
    stepSuit(s, this.suitInput, _air, dt);
    // a wall on the way
    const dx = s.x - px, dy = s.y - py, dz = s.z - pz, d = Math.hypot(dx, dy, dz);
    if (d > 1e-4) {
      const t = raycastBuildings(c, px, py, pz, dx / d, dy / d, dz / d, d + 0.45);
      if (t < d + 0.45) {
        const back = Math.max(0, t - 0.5) / d;
        s.x = px + dx * back; s.y = py + dy * back; s.z = pz + dz * back;
        this.placeSuit();
        this.crash(s.speed, true);
        return;
      }
    }
    this.placeSuit();
    p.speed = s.speed;
    // the ground or a roof coming up
    const ground = c.getGroundHeight(s.x, s.z, 'person', s.y - HIPS + 0.4);
    const height = s.y - HIPS - ground;
    if (height <= 0.25) {
      const how = suitTouchdown(s.vx, s.vy, s.vz);
      p.position.y = ground;
      if (how === 'crash') { this.crash(s.speed, false); return; }
      this.payStreak();
      this.toFoot(s.vx * 0.3, 0, s.vz * 0.3);
      if (how === 'roll') g.knockDown(Math.atan2(s.vx, s.vz));
      g.audio.sfx('punch', s.x, ground, s.z, { rate: 0.7, intensity: 0.6 });
      return;
    }
    // a safety: over the street, about to hit it, the canopy fires by itself
    if (s.vy < -4 && height < 70 && height / -s.vy < 1.7 && c.roofHeight(s.x, s.z, 1e4, 0) < 1) { this.openCanopy(true); return; }
    this.proximity(dt, height);
    this.flightCamera('wingsuit', dt);
  }

  placeSuit() {
    const s = this.suitState, p = this.person;
    p.position.set(s.x, s.y - HIPS, s.z);
    p.heading = Math.atan2(s.vx, s.vz);
  }

  // Rising air from the wind against the buildings, sampled a few times a second
  updraftAt(x, y, z, dt) {
    this.liftT -= dt;
    if (this.liftT <= 0) {
      this.liftT = 0.15;
      const c = this.game.controllers;
      this.wind.at(x, y, z, _wind);
      this.lift = buildingLift(x, y, z, _wind, (ox, oy, oz, dx, dz, max) => {
        const hit = {};
        const d = raycastBuildings(c, ox, oy, oz, dx, 0, dz, max, hit);
        return { d, top: hit.collider?.maxY ?? 0 };
      });
    }
    return this.lift;
  }

  // Walls and roofs brushed past at speed: a streak that pays when it ends
  proximity(dt, height) {
    const g = this.game, s = this.suitState, c = g.controllers, st = this.streak;
    const h = Math.atan2(s.vx, s.vz), rx = Math.cos(h), rz = -Math.sin(h);
    const near = Math.min(height,
      raycastBuildings(c, s.x, s.y, s.z, rx, 0, rz, NEAR),
      raycastBuildings(c, s.x, s.y, s.z, -rx, 0, -rz, NEAR));
    this.nearNow = near;
    if (near < NEAR && s.speed > 24) {
      st.t += dt;
      st.pts += dt * s.speed * (1 - near / NEAR) * 2.6;
      st.best = Math.min(st.best, near);
      st.quiet = 0;
      // the whoosh of a wall going by
      this.whooshT = (this.whooshT || 0) - dt;
      if (near < 4 && this.whooshT <= 0) { this.whooshT = 0.9; g.audio.sfx('throw', s.x, s.y, s.z, { rate: 0.55 + s.speed / 160, intensity: 0.9 }); }
    } else if (st.t > 0) {
      st.quiet += dt;
      if (st.quiet > 0.8) this.payStreak();
    }
  }

  payStreak() {
    const s = this.streak;
    if (s.t > 0.5 && s.pts >= 5) this.game.stunts.award('FRÔLEMENT', Math.round(s.pts), `${s.t.toFixed(1)} s · ${s.best.toFixed(1)} m`);
    s.t = s.pts = s.quiet = 0;
    s.best = NEAR;
  }

  // Into a wall or the ground at speed. Off a wall high up, the body tumbles on in free fall: a few seconds to save it
  crash(speed, wall) {
    const g = this.game, p = this.person, s = this.suitState;
    this.streak.t = this.streak.pts = 0;
    g.stunts.crashed();
    g.camera.addShake(1);
    g.audio.sfx('punch', p.position.x, p.position.y + 1, p.position.z, { rate: 0.5, intensity: 1 });
    g.lastHitHeading = Math.atan2(s.vx, s.vz) + Math.PI;
    const height = p.position.y - g.controllers.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y + 0.3);
    if (wall && height > 14) {
      this.flying = true;
      this.startFreefall(-s.vx * 0.12, Math.min(0, s.vy) * 0.3, -s.vz * 0.12);
      this.autoSuit = false;
      this.stunT = 1.1;
      g.damagePlayer(clamp((speed - 16) * 2.2, 15, 200), 'crash');
      return;
    }
    this.toFoot(wall ? -s.vx * 0.05 : s.vx * 0.1, 0, wall ? -s.vz * 0.05 : s.vz * 0.1);
    g.damagePlayer(clamp((speed - 16) * 3.4, 22, 200), 'crash');
    if (g.state === 'onFoot') g.knockDown(Math.atan2(s.vx, s.vz) + Math.PI);
  }

  // F in the air: the paraglider bursts open (from free fall, the wingsuit, or an aircraft left close to the ground)
  openCanopy(auto = false) {
    const g = this.game, p = this.person;
    this.payStreak();
    const v = g.state === 'wingsuit' ? _v.set(this.suitState.vx, this.suitState.vy, this.suitState.vz) : this.vel;
    openWing(this.wing, p.position.x, p.position.y, p.position.z, p.heading, v.x, v.y, v.z);
    this.wing.t = 0;
    this.fold = 0;
    this.snapped = false;
    this.takeAim(this.wing.heading, -0.2);
    this.setState('falling');
    g.audio.sfx('throw', p.position.x, p.position.y + 4, p.position.z, { rate: 0.32, intensity: 1 });
    this.prompt(auto ? 'Ouverture automatique · SOURIS ou Q/D : tourner · S : freiner' : 'SOURIS ou Q/D : tourner · S : freiner, arrondir · Z : accélérer', 4);
  }

  // From an aircraft left low (gameplay.js): straight under a canopy
  startCanopy(vx, vy, vz) {
    this.vel.set(vx, vy, vz);
    this.flying = false;
    this.takeAim(Math.hypot(vx, vz) > 2 ? Math.atan2(vx, vz) : this.game.camera.footYaw, -0.2);
    this.game.state = 'freefall';
    this.openCanopy(false);
  }

  updateCanopy(dt) {
    const g = this.game, p = this.person, w = this.wing, keys = this.keys, c = g.controllers;
    this.steer(dt, 'canopy');
    w.t += dt;
    w.open = Math.min(1, w.open + dt / 1.25);
    if (!this.snapped && w.open > 0.45) {
      // the snap of the wing taking the load
      this.snapped = true;
      g.camera.addShake(0.75);
      g.audio.sfx('punch', w.x, w.y + 6, w.z, { rate: 0.45, intensity: 0.8 });
    }
    // fly where the camera looks, or by hand: Q / D brakes, S both (the flare), Z the speed bar
    const k = this.wingKeys;
    k.left = keys.left ? 1 : 0; k.right = keys.right ? 1 : 0; k.brake = keys.backward ? 1 : 0; k.bar = keys.forward ? 1 : 0;
    const steady = w.open > 0.8;
    wingControl(w, steady ? { yaw: this.aimYaw } : { yaw: w.heading }, steady ? k : this.noKeys, this.wingInput);
    this.wind.at(w.x, w.y, w.z, _air);
    stepWing(w, this.wingInput, _air, this.updraftAt(w.x, w.y + 1.5, w.z, dt), dt);
    // a wall: brushed, the pilot is pushed off it; flown into, the wing collapses
    _v.set(w.x, w.y, w.z);
    c.resolveHorizontalCollision(_v, 0.5, null, null, 'person');
    const pushed = Math.hypot(_v.x - w.x, _v.z - w.z);
    if (pushed > 0.01) {
      const into = (w.vx * (w.x - _v.x) + w.vz * (w.z - _v.z)) / pushed;
      w.x = _v.x; w.z = _v.z;
      if (into > 6) {
        g.damagePlayer(14, 'crash');
        g.audio.sfx('punch', w.x, w.y, w.z, { rate: 0.6 });
        this.cutAway(true);
        return;
      }
      w.airspeed *= 0.92;
    }
    p.position.set(w.x, w.y, w.z);
    p.heading = w.heading;
    p.speed = Math.hypot(w.vx, w.vz);
    const ground = c.getGroundHeight(w.x, w.z, 'person', w.y + 0.3);
    if (w.y <= ground) {
      const how = wingTouchdown(w);
      p.position.y = ground;
      this.fold = 0.001; // the wing comes down behind
      this.foldAt.set(w.x, ground, w.z).heading = w.heading;
      if (how === 'crash') {
        this.toFoot(w.vx * 0.2, 0, w.vz * 0.2);
        g.lastHitHeading = w.heading + Math.PI;
        g.damagePlayer((-w.vy - 7) * 14 + 20, 'crash');
        if (g.state === 'onFoot') g.knockDown(w.heading);
        return;
      }
      this.toFoot(w.vx * 0.3, 0, w.vz * 0.3);
      if (how === 'roll') g.knockDown(w.heading);
      g.audio.sfx('punch', w.x, ground, w.z, { rate: 0.9, intensity: 0.35 });
      g.save();
      return;
    }
    this.flightCamera('canopy', dt);
  }

  // F under the canopy: cut it away and fall again (and the suit is a key away); a collapsed wing does the same
  cutAway(collapsed = false) {
    const w = this.wing, p = this.person;
    const height = p.position.y - this.game.controllers.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y + 0.3);
    if (!collapsed && height < 25) { this.prompt('Trop bas pour larguer la voile', 1.6); return; }
    this.fold = 0.001;
    this.foldAt.set(w.x, w.y, w.z).heading = w.heading;
    this.startFreefall(w.vx, Math.min(-2, w.vy), w.vz);
    this.autoSuit = false;
    if (collapsed) this.stunT = 0.8;
    this.prompt(collapsed ? 'Voile fermée ! ESPACE : wingsuit · F : nouvelle voile' : 'Voile larguée · ESPACE : wingsuit · F : rouvrir');
  }

  // Where the player looks steers the body: the mouse moves the aim; the keys steer the body and the aim follows it
  steer(dt, mode) {
    const g = this.game, keys = this.keys, sens = g.camera.mouseSensitivity * 1.15;
    const dx = g.lookDX || 0, dy = g.lookDY || 0;
    this.aimYaw -= dx * sens;
    this.aimPitch = clamp(this.aimPitch - dy * sens, -1.35, mode === 'wingsuit' ? 0.45 : 0.6);
    this.aimIdle = Math.abs(dx) + Math.abs(dy) > 0.5 ? 0 : this.aimIdle + dt;
    const handsOn = keys.left || keys.right || keys.forward || keys.backward;
    const k = 1 - Math.exp(-dt * 2.6);
    if (mode === 'wingsuit') {
      const s = this.suitState;
      // S and Z take the view with them, up into the pull or down into the dive; Q and D bank the body and the view
      // follows its heading; left alone, a steep dive eases back towards a glide
      if (Math.abs(dy) > 0.5) this.keyPitch = false;
      if (keys.backward) { this.keyPitch = true; this.aimPitch += (0.15 - this.aimPitch) * (1 - Math.exp(-dt * 2.2)); }
      else if (keys.forward) { this.keyPitch = true; this.aimPitch += (-0.95 - this.aimPitch) * (1 - Math.exp(-dt * 2.2)); }
      // let go after a pull or a dive with the keys, the suit settles back into a glide
      else if (this.keyPitch) this.aimPitch += (-0.28 - this.aimPitch) * (1 - Math.exp(-dt * 1.4));
      else if (this.aimIdle > 2 && this.aimPitch < -0.4) this.aimPitch += (-0.3 - this.aimPitch) * (1 - Math.exp(-dt * 0.6));
      if ((keys.left || keys.right) && this.aimIdle > 0.3) this.aimYaw += wrap(Math.atan2(s.vx, s.vz) - this.aimYaw) * k;
    } else if (mode === 'canopy' && handsOn && this.aimIdle > 0.3) this.aimYaw += wrap(this.wing.heading - this.aimYaw) * k;
  }

  // The camera in the air: behind the line of sight, pulled back and widened with speed, rolled with the turn, shaken
  // by the air (cameras.js places it from this)
  flightCamera(mode, dt) {
    const g = this.game, p = this.person, view = this.view;
    const t = (this.flyT += dt);
    // the view follows the aim, but never stares straight down: past about 50° it keeps the horizon in the frame
    const ay = this.aimYaw, ap = clamp(this.aimPitch, -0.62, 0.35);
    const dir = _cd.set(Math.sin(ay) * Math.cos(ap), Math.sin(ap), Math.cos(ay) * Math.cos(ap));
    const flat = _cf.set(Math.sin(ay), 0, Math.cos(ay));
    const right = _cr.set(-flat.z, 0, flat.x).negate(); // the view's right
    let buffet = 0;
    if (mode === 'wingsuit') {
      const s = this.suitState, V = s.speed, near = this.streak.t > 0 ? clamp(1 - (this.nearNow ?? NEAR) / NEAR, 0, 1) : 0;
      view.anchor.set(s.x, s.y, s.z);
      // close behind and a little above: the suit fills the lower middle of the frame, the city and the horizon the rest
      const dist = 3.6 + V * 0.022;
      view.pos.copy(view.anchor).addScaledVector(dir, -dist).y += 0.9 + Math.max(0, -ap) * 0.5;
      // the glide: through a turn the camera swings out wide and lags, the horizon leans with the suit
      view.pos.addScaledVector(right, -s.bank * 1.6 * clamp(V / 50, 0, 1.3));
      view.look.copy(view.anchor).addScaledVector(dir, 30).y += 2.2;
      view.roll = -s.bank * 0.42;
      view.fov = clamp((V - 30) / 50, 0, 1) * 28 + near * 7;
      view.stiff = 11;
      buffet = 0.012 + (V / 95) ** 2 * 0.1 + near * 0.06 + (s.stalled ? 0.08 : 0);
    } else if (mode === 'freefall') {
      view.anchor.set(p.position.x, p.position.y + HIPS, p.position.z);
      view.pos.copy(view.anchor).addScaledVector(flat, -5.4).y += 3.3;
      view.look.copy(view.anchor).addScaledVector(flat, 4).y -= 2.4;
      view.roll = this.stunT > 0 ? Math.sin(t * 9) * 0.25 * this.stunT : 0;
      view.fov = clamp((-this.vel.y - 18) / 36, 0, 1) * 14;
      view.stiff = 8;
      buffet = 0.01 + clamp(-this.vel.y / TERMINAL, 0, 1) * 0.07;
    } else {
      const w = this.wing;
      view.anchor.set(p.position.x, p.position.y + 1.5, p.position.z);
      // far enough back to see the whole wing over the pilot
      view.pos.copy(view.anchor).addScaledVector(flat, -11.5).y += 2.6 + Math.max(0, -ap) * 3;
      view.look.copy(view.anchor).addScaledVector(flat, 4).y += 4.4 + ap * 6;
      view.roll = -w.bank * 0.22;
      view.fov = 4;
      view.stiff = 6;
      buffet = 0.008 + Math.abs(w.bank) * 0.02;
    }
    // the air shakes the camera: two layers of slow and quick swaying, not noise
    view.offset.copy(right).multiplyScalar((Math.sin(t * 6.1) + 0.5 * Math.sin(t * 13.7 + 1.3)) * buffet)
      .addScaledVector(_up, (Math.sin(t * 7.3 + 0.4) * 0.7 + Math.sin(t * 17.9) * 0.35) * buffet);
    g.camera.flightView = view;
  }

  // A line in the middle of the screen, for a few seconds
  prompt(text, seconds = 3) {
    this.promptEl.textContent = text;
    this.promptEl.classList.add('show');
    clearTimeout(this.promptT);
    this.promptT = setTimeout(() => this.promptEl.classList.remove('show'), seconds * 1000);
  }


  // ---- On foot and landing --------------------------------------------------------------------------------------------
  // Back to walking (or flying through the air on foot) with this velocity
  toFoot(vx, vy, vz) {
    const g = this.game, p = this.person;
    // out of the air, the walking camera carries on looking where the flight was
    if (this.flying) { g.camera.footYaw = this.aimYaw; g.camera.orbitPitchOffset = 0.1; }
    this.flying = false;
    this.pull = this.hang = this.climb = this.surf = null;
    p.suspended = false;
    p.rig.overlay = null;
    p.rig.crouch = p.rig.crouchTarget = 0;
    p.airVX = vx; p.airVZ = vz;
    p.verticalVel = vy;
    g.state = 'onFoot';
    document.body.dataset.gameState = g.state;
    g.updateKeybar();
  }

  // Feet on the ground after a fall at `impact` m/s (gameplay.js calls this for every landing on foot)
  landed(impact) {
    const g = this.game;
    if (impact <= FALL_SAFE) return;
    g.lastHitHeading = this.person.heading + Math.PI;
    g.damagePlayer((impact - FALL_SAFE) * 6.5, 'crash');
    g.camera.addShake(Math.min(0.8, impact / 30));
    g.audio.sfx('punch', this.person.position.x, this.person.position.y, this.person.position.z, { rate: 0.6, intensity: Math.min(1, impact / 20) });
    if (impact > 15 && g.state === 'onFoot') g.knockDown(this.person.heading);
  }

  landHard(impact) {
    this.toFoot(this.vel.x * 0.2, 0, this.vel.z * 0.2);
    this.landed(impact);
  }

  // Whatever vertical state is on ends now (death, arrest, a teleport, a mission reset)
  reset() {
    this.pull = this.hang = this.climb = this.surf = null;
    this.flash = null;
    this.flying = false;
    this.fold = 0;
    this.wing.open = 0;
    this.airFx.hide();
    this.promptEl?.classList.remove('show');
    this.vel.set(0, 0, 0);
    const p = this.person;
    p.suspended = false;
    p.airVX = p.airVZ = 0;
    if (p.rig) { p.rig.overlay = null; p.rig.crouch = p.rig.crouchTarget = 0; }
  }

  setState(state) {
    const g = this.game, p = this.person;
    g.state = state;
    p.suspended = true;
    p.airVX = p.airVZ = 0;
    this.syncKeys(); // a key still held from before does not count as a new press
    document.body.dataset.gameState = state;
    g.updateKeybar();
  }

  // An action pressed this frame (not held over from before): 'jump' (Shift) kicks off and lets go, 'up' (Space) opens the suit
  pressed(action) {
    const down = !!this.keys[action];
    const edge = down && !this.held[action];
    this.held[action] = down;
    return edge;
  }

  syncKeys() {
    this.held.up = !!this.keys.up;
    this.held.jump = !!this.keys.jump;
  }

  // gameplay.js: the protagonist's frame while one of these states is on
  updatePerson(dt) {
    switch (this.game.state) {
      case 'grapple': this.updatePull(dt); break;
      case 'hanging': this.updateHang(dt); break;
      case 'climbing': this.updateClimb(dt); break;
      case 'surfing': this.updateSurf(dt); break;
      case 'freefall': this.updateFreefall(dt); break;
      case 'wingsuit': this.updateWingsuit(dt); break;
      case 'falling': this.updateCanopy(dt); break;
    }
    this.syncKeys();
    if (this.game.state === 'onFoot') this.game.jumpHeld = true; // the Shift that ended a state does not also jump
    this.posture();
  }

  // Keys that change meaning up here (gameplay.js asks first): F opens the canopy in the air, takes the wheel on a roof
  interact() {
    const s = this.game.state;
    if (s === 'freefall' || s === 'wingsuit') { this.openCanopy(); return true; }
    if (s === 'falling') { this.cutAway(); return true; }
    if (s === 'surfing') { this.hijack(); return true; }
    return STATES.has(s);
  }

  // ---- Every frame -------------------------------------------------------------------------------------------------
  // The body's posture for the current state (BodyDriver.overlay in person-motion.js)
  posture() {
    const g = this.game, p = this.person, rig = p.rig, s = g.state;
    const o = rig.overlay ??= {};
    o.w = 1; o.legs = 0; o.pitch = 0; o.roll = 0; o.arms = null; o.toward = null; o.sit = 0; o.head = 0; o.lean = 0;
    if (s === 'grapple') { o.arms = 'rope'; o.toward = this.ropeAt; o.legs = 0.12; }
    else if (s === 'hanging') { o.arms = 'up'; o.legs = 0.05; }
    else if (s === 'climbing') { o.arms = 'ledge'; o.pitch = 0.25 * (1 - clamp(this.climb ? this.climb.t / this.climb.T : 1, 0, 1)); }
    else if (s === 'surfing') { o.arms = g.weaponId !== 'fists' ? null : 'balance'; o.legs = 0.2; rig.crouch = rig.crouchTarget = 0.55; }
    else if (s === 'freefall') { o.arms = 'arch'; o.legs = 0.3; o.head = 0.9; o.pitch = Math.PI / 2 - 0.15; o.roll = this.stunT > 0 ? this.stunT * 9 : 0; }
    else if (s === 'wingsuit') {
      // the body lies along its flight path, nose up by the angle of attack, rolled into the bank
      const st = this.suitState, path = Math.asin(clamp(st.vy / Math.max(1, st.speed), -1, 1));
      o.arms = 'spread'; o.legs = 0.26; o.head = 1.05;
      o.pitch = Math.PI / 2 - path - st.alpha * 0.7;
      o.roll = st.bank;
    } else if (s === 'falling') {
      // in the harness: sat back, hands on the brake toggles, swung out with the turn
      const w = this.wing;
      o.arms = 'toggles'; o.brakeL = w.brakeL; o.brakeR = w.brakeR;
      o.sit = 1.15; o.legs = 0.08; o.lean = w.bank * 0.85; o.pitch = -0.08 + (w.surge || 0) * 0.04;
    }
    else { rig.overlay = null; }
  }

  // After the hero is posed (gameplay.js update): the rope, the suit, the reticle, the altimeter
  draw(dt) {
    const g = this.game, s = g.state, p = this.person;
    const hero = g.hero, wp = hero.driver.body.wp, bone = hero.driver.skeleton.bone;
    const warm = g.frames <= 4; // drawn once behind the loading screen so their shaders compile
    // Rope: from the right hand to the hook
    if (this.flash !== null) { this.flash -= dt; if (this.flash <= 0) this.flash = null; }
    const roped = s === 'grapple' || s === 'hanging' || this.flash !== null;
    const held = g.weaponId === 'grapple';
    this.rope.visible = this.hook.visible = roped || warm;
    if (roped || warm) {
      // from the launcher when it is in hand, from the right hand otherwise
      if (hero.weapon && held) hero.muzzle(_a);
      else { const h = bone.hand[1]; _a.set(wp[h * 3], wp[h * 3 + 1], wp[h * 3 + 2]); }
      const to = warm ? _b.copy(_a).add(_up) : this.ropeAt;
      _dir.subVectors(to, _a);
      const len = Math.max(0.01, _dir.length());
      this.rope.position.copy(_a);
      this.rope.quaternion.copy(_q.setFromUnitVectors(_up, _dir.multiplyScalar(1 / len)));
      this.rope.scale.set(1, len, 1);
      this.rope.updateMatrixWorld();
      this.hook.position.copy(to);
      this.hook.updateMatrixWorld();
    }
    this.wind.update(dt, g.atmosphere.weather);
    // Wingsuit fabric over the pose: filled by the airspeed, its trailing edges flapping at speed (and in a stall)
    const suited = s === 'wingsuit', st = this.suitState;
    this.suit.visible = suited || warm;
    if (suited || warm) this.suit.fit(wp, bone, clamp((st.airspeed - 8) / 28, 0.35, 1), clamp((st.speed - 30) / 60, 0, 1) * 0.045 + (st.stalled ? 0.05 : 0), this.flyT);
    // The paraglider over the pilot, and folding away behind once down
    const canopyOn = s === 'falling' || this.fold > 0;
    if (this.fold > 0 && s !== 'falling') this.fold += dt / 2.2;
    if (this.fold >= 1) this.fold = 0;
    this.canopy.visible = canopyOn || warm;
    if (this.canopy.visible) {
      const w = this.wing;
      _hands[0].set(wp[bone.hand[0] * 3], wp[bone.hand[0] * 3 + 1], wp[bone.hand[0] * 3 + 2]);
      _hands[1].set(wp[bone.hand[1] * 3], wp[bone.hand[1] * 3 + 1], wp[bone.hand[1] * 3 + 2]);
      const brake = (w.brakeL + w.brakeR) / 2;
      // flying, the wing rides over the pilot; landed or cut away, it settles where it was left
      const at = s === 'falling' ? p.position : this.foldAt;
      canopyMatrix(_m, at.x, at.y + 1.5, at.z, s === 'falling' ? w.heading : this.foldAt.heading, s === 'falling' ? w.bank : 0, -brake * 0.16 + w.bar * 0.06 - (w.surge || 0) * 0.05);
      this.canopy.shape({ open: warm ? 1 : w.open, fold: s === 'falling' ? 0 : this.fold, brakeL: w.brakeL, brakeR: w.brakeR, t: w.t }, _m, _hands);
    }
    // Air rushing past, and the smoke from the ankles once the suit is really flying
    const cam = g.camera.camera.position;
    if (suited) {
      _v.set(st.vx, st.vy, st.vz);
      const smoke = st.speed > 30;
      if (smoke) for (let k = 0; k < 2; k++) _feet[k].set(wp[bone.foot[k] * 3], wp[bone.foot[k] * 3 + 1], wp[bone.foot[k] * 3 + 2]);
      // wingtip vortices off the wrists above about 140 km/h
      const tips = st.speed > 38;
      if (tips) for (let k = 0; k < 2; k++) _hands[k].set(wp[bone.hand[k] * 3], wp[bone.hand[k] * 3 + 1], wp[bone.hand[k] * 3 + 2]);
      this.airFx.update(cam, _v, clamp((st.speed - 26) / 40, 0, 1), smoke ? _feet : null, dt, tips ? _hands : null);
    } else if (s === 'freefall') {
      this.airFx.update(cam, this.vel, clamp((-this.vel.y - 22) / 40, 0, 1) * 0.6, null, dt);
    } else if (warm || this.airFx.streaks.visible || this.airFx.trails.some((t) => t.mesh.visible)) {
      this.airFx.update(cam, _v.set(0, 0, 0), 0, null, dt);
    }
    // The hook waits on the launcher's muzzle while it is in hand
    if (!roped && !warm && held && hero.weapon) {
      this.hook.visible = true;
      hero.muzzle(this.hook.position);
      this.hook.updateMatrixWorld();
    }
    // With the grapple in hand, the crosshair turns lime when the hook would bite
    this.aimT -= dt;
    const can = held && this.canFire && s !== 'grapple';
    if (can && this.aimT <= 0) { this.aimT = 0.1; this.aim = this.acquire(); }
    if (!can) this.aim = null;
    const cross = g.hud.crosshair;
    cross.classList.toggle('hook', held);
    cross.classList.toggle('bite', !!this.aim);
    // Altimeter, speed, variometer, wind
    const flying = s === 'wingsuit' || s === 'freefall' || s === 'falling';
    this.hud.classList.toggle('show', flying);
    if (flying) {
      const ground = g.controllers.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y + 0.3);
      const w = this.wing;
      const speed = s === 'wingsuit' ? st.speed : s === 'freefall' ? this.vel.length() : Math.hypot(w.vx, w.vz, w.vy);
      const vy = s === 'wingsuit' ? st.vy : s === 'freefall' ? this.vel.y : w.vy;
      this.altText.textContent = Math.max(0, Math.round(p.position.y - ground));
      this.speedText.textContent = Math.round(speed * 3.6);
      this.varioText.textContent = `${vy >= 0 ? '+' : '−'}${Math.abs(vy).toFixed(1)}`;
      this.varioText.parentElement.classList.toggle('up', vy > 0.2);
      this.wind.at(p.position.x, p.position.y, p.position.z, _wind);
      const windSpeed = Math.hypot(_wind.x, _wind.z);
      // the arrow points where the wind blows, relative to where the camera looks
      this.windArrow.style.transform = `rotate(${(-(Math.atan2(_wind.x, _wind.z) - this.aimYaw) * 180 / Math.PI).toFixed(1)}deg)`;
      this.windText.textContent = `VENT ${Math.round(windSpeed * 3.6)} KM/H${this.lift > 0.6 ? ' · ASCENDANCE' : ''}`;
      const run = this.streak;
      this.near.classList.toggle('on', s === 'wingsuit' && run.t > 0);
      if (s === 'wingsuit' && run.t > 0) {
        this.nearFill.style.transform = `scaleX(${clamp(1 - (this.nearNow ?? NEAR) / NEAR, 0, 1).toFixed(3)})`;
        this.nearPts.textContent = `+${Math.round(run.pts)} $`;
      }
    }
    // the wind rush follows the speed through the air
    p.rush = s === 'wingsuit' ? clamp((st.speed - 15) / 60, 0, 1) : s === 'freefall' ? clamp(this.vel.length() / TERMINAL, 0, 1) * 0.8
      : s === 'falling' ? clamp(this.wing.airspeed / 30, 0, 0.45) : s === 'grapple' ? 0.3 : 0;
  }

  // Out of reach: the crosshair flashes red
  missFlash() {
    const cross = this.game.hud.crosshair;
    cross.classList.add('miss');
    clearTimeout(this.missT);
    this.missT = setTimeout(() => cross.classList.remove('miss'), 450);
  }
}

export { Vertical, STATES as VERTICAL_STATES, FREEFALL_HEIGHT, HIPS };
