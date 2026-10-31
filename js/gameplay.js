import * as THREE from 'three/webgpu';
import { streetZ, isTypingInField } from './city-config.js';
import { angleDelta, doorPosition, smooth, clamp, canInteract, validPosition } from './interaction-state.js';
import { CharacterModel, LOOKS } from './characters.js';
import { EffectsSystem } from './fx.js';
import { WEAPONS, WEAPON_ORDER, castShot, spreadDirection } from './weapons.js';
import { ActorSystem } from './actors.js';
import { WantedSystem, WANTED_LEVELS } from './wanted.js';
import { RoadNavigator } from './navigation.js';
import { HOSPITALS, PRECINCTS, MarkerSystem, PickupSystem, PICKUP_STYLE } from './missions.js';
import { MissionDirector } from './mission-director.js';
import { GameHud } from './hud.js';
import { vehicleContact, resolveVehicleContact, sweptVehicleContact } from './vehicle-physics.js';
import { polygonContains } from './building-collision.js';
import { RadioSystem, STATIONS } from './radio.js';
import { Atmosphere } from './atmosphere.js';
import { ShopSystem } from './shops.js';
import { createMotorbike, poseMotorbike } from './motorbike.js';
import { currentLevel, cycleLevel } from './quality.js';
import { createParachute } from './airplane.js';
import { stepPlane } from './flight.js';
import { Garage } from './garage.js';
import { collapse } from './ragdoll.js';
import { Arsenal } from './arsenal.js';

// OVERDRAFT — the game layer over the city simulation: the protagonist on foot and at the wheel, weapons and
// damage, vehicles that smoke, burn and explode, the wanted level (police), missions, money, death and arrest, and saving.

const SAVE_KEY = 'overdraft:save:2';
// Saves from before the rename (0.2 preview, 0.1 playground) are still read
const LEGACY_SAVE_KEYS = ['contre-maree:save:2', 'contre-maree:playground:1'];
const BUILD = '0.4.1';
const CAR_NAMES = {
  sedan: ['VALMONT', 'ÉCUME', 'BERLINE / PROPULSION'], suv: ['BRISANT', 'RÉCIF', 'SUV / TRANSMISSION INTÉGRALE'],
  taxi: ['VALMONT', 'CAB 7', 'TAXI / PROPULSION'], pickup: ['GRÉVILLE', 'FALAISE', 'PICK-UP / PROPULSION'],
  van: ['HAUTURIER', 'CARGO', 'UTILITAIRE / TRACTION'], minivan: ['GRÉVILLE', 'ESCALE', 'MONOSPACE / TRACTION'],
  moto: ['BRISANT', 'VANDALE 650', 'MOTO / SPORTIVE'],
  bicycle: ['COURSIER', 'VÉLO', 'VÉLO / URBAIN'], helicopter: ['GRÉVILLE', 'LIBELLULE', 'HÉLICOPTÈRE / BITURBINE'],
  plane: ['HAUTURIER', 'STERNE', 'AVION / MONOMOTEUR']
};
const PROFILES = {
  sedan: { speed: 47, acceleration: 7, powerSpeed: 21, grip: 10.5, cornering: 11 },
  suv: { speed: 39, acceleration: 5.3, powerSpeed: 19, grip: 8.7, cornering: 8.8 },
  taxi: { speed: 40, acceleration: 5.8, powerSpeed: 18, grip: 9.4, cornering: 10 },
  pickup: { speed: 36, acceleration: 5, powerSpeed: 18, grip: 8.2, cornering: 8 },
  van: { speed: 32, acceleration: 4, powerSpeed: 16, grip: 8, cornering: 7.5 },
  minivan: { speed: 36, acceleration: 4.8, powerSpeed: 17, grip: 8.8, cornering: 9 },
  moto: {} // its own profile (motorbike.js)
};
const FLEET_MAX = 12;
const WHEEL_STEP = 12; // pixels of scrolling to the next weapon
const WHEEL_GESTURE_GAP = 160; // ms without a scroll event that ends a gesture
const PARACHUTE_SPEED = 6.5; // m/s, falling
const PARACHUTE_DRIFT = 8; // m/s, steering
const EJECT_ALTITUDE = 20; // a crash above this throws the pilot clear, under a canopy
const IDLE_STICK = { pitch: 0, roll: 0, throttle: 0 };
const WRECK_POOL = 4;
const DEBUG = new URLSearchParams(location.search).has('debug');

function splitDoor(car) {
  const original = car.bodyMesh.geometry;
  const positions = original.attributes.position;
  const ids = original.index?.array || Uint32Array.from({ length: positions.count }, (_, i) => i);
  const door = [], body = [];
  const front = car.spec.doors[0], rear = car.spec.doors[1];
  for (let i = 0; i < ids.length; i += 3) {
    const vertices = [ids[i], ids[i + 1], ids[i + 2]];
    const x = vertices.reduce((n, id) => n + positions.getX(id), 0) / 3;
    const y = vertices.reduce((n, id) => n + positions.getY(id), 0) / 3;
    const z = vertices.reduce((n, id) => n + positions.getZ(id), 0) / 3;
    (x > 0.45 && z < front && z > rear && y > 0.29 && y < 1.38 ? door : body).push(...vertices);
  }
  const shell = original.clone(); shell.setIndex(body);
  car.bodyMesh.geometry = shell;
  const geometry = original.clone(); geometry.setIndex(door);
  const hinge = new THREE.Group();
  hinge.position.set(0.83, 0, front);
  const mesh = new THREE.Mesh(geometry, car.bodyMesh.material);
  mesh.position.set(-0.83, 0, -front);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.material.side = THREE.DoubleSide;
  hinge.add(mesh); car.chassisPivot.add(hinge);
  car.door = hinge; car.doorOpen = 0;
  const interior = new THREE.MeshStandardNodeMaterial({ color: 0x14181a, roughness: 0.92 });
  for (const side of [-1, 1]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.18, 0.5), interior);
    seat.position.set(side * 0.4, 0.5, -0.15);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.53, 0.12), interior);
    back.position.set(side * 0.4, 0.78, -0.4); back.rotation.x = -0.15;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.13), interior);
    head.position.set(side * 0.4, 1.08, -0.43);
    car.chassisPivot.add(seat, back, head);
  }
}

const _v = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const bodyA = {}, bodyB = {}, hit = {};

export class Game {
  constructor({ controllers, camera, traffic, scene, onMode, onTime, audio, map, touch, gamepad, lighting, grade }) {
    Object.assign(this, { controllers, camera, traffic, scene, onMode, onTime, audio, map, touch, gamepad });
    this.atmosphere = new Atmosphere({ lighting, grade, scene, camera: camera.camera, controllers });
    this.state = 'onFoot'; this.playing = false; this.paused = false;
    this.transition = null; this.candidate = null; this.stamina = 100;
    this.distance = 0; this.stolen = 0; this.clock = 0; this.fleet = [];
    this.nextId = 1; this.lastSave = 0; this.firstEntry = true;
    this.health = 100; this.armor = 0; this.money = 0;
    this.weapons = { fists: { mag: 0, ammo: 0 } };
    this.weaponId = 'fists';
    this.missionsDone = [];
    this.stats = { kills: 0, shots: 0, cops: 0, cars: 0, explosions: 0, deaths: 0, busted: 0 };
    this.fireHeld = false; this.firePressed = false; this.aimHeld = false;
    this.cooldown = 0; this.reloadT = 0; this.punchT = 0; this.punchHit = false;
    this.spread = 0; this.lastCrimeShot = -10; this.stateT = 0; this.invulnerable = 0;
    this.allCars = [];
    this.timeScale = 1;
    this.frames = 0;
    this.player = { x: 0, y: 0, z: 0, heading: 0, speed: 0, vx: 0, vz: 0, inVehicle: false, onFoot: true, alive: true, threat: false };

    controllers.playground = this;
    controllers.updatePerson = (dt) => this.updatePerson(dt);
    // One of a kind, waiting out of sight for the garage; drawn for the first frames so they compile behind the loading screen
    const shared = { burnT: 0, destroyed: false, stolen: true, vx: 0, vz: 0, angularVel: 0, doorOpen: 0 };
    this.rides = [
      Object.assign(controllers.entities.cyclist, shared, { kind: 'bicycle', mode: 'cyclist', bicycle: true, riderless: true, halfW: 0.35, halfL: 0.9,
        spec: { doors: [0.2, -0.2], zFront: 0.9, zRear: -0.9 }, drive: { speed: 19 } }),
      Object.assign(controllers.entities.helicopter, shared, { kind: 'helicopter', mode: 'helicopter', air: true, hp: 100, halfW: 1.3, halfL: 3.6,
        spec: { doors: [1.2, 0], zFront: 3.2, zRear: -6 }, drive: { speed: 52 } }),
      Object.assign(controllers.entities.plane, shared, { hp: 100 })
    ];
    for (const ride of this.rides) this.park(ride);
    controllers.entities.cyclist.helmet.visible = false;
    this.parachute = createParachute(scene);
    this.footCameraY = controllers.entities.person.cameraTargetOffset.y;
    controllers.entities.car.mesh.removeFromParent();

    this.nav = new RoadNavigator(traffic.network);
    this.fx = new EffectsSystem(scene, camera.camera);
    this.actors = new ActorSystem({ scene, controllers, fx: this.fx, audio });
    this.actors.onShot = (h, damage, shooter) => this.applyShot(h, damage, shooter);
    this.actors.onKilled = (actor, cause) => this.onActorKilled(actor, cause);
    this.actors.onBark = (text) => { if (!this.director.current) this.hud.say('POLICE', text, 2.4); };
    this.actors.onArrest = (dt) => { if (this.wanted.level <= 1 && !this.player.threat) this.wanted.arrestProgress(dt); };
    traffic.pedestrians.setGround((x, z) => controllers.getGroundHeight(x, z, 'person'));
    this.wanted = new WantedSystem({ scene, controllers, nav: this.nav, actors: this.actors, audio, camera: camera.camera });
    this.wanted.onLevel = (level, previous) => this.onWantedLevel(level, previous);
    this.wanted.onBusted = () => this.busted();
    this.wanted.trafficCars = traffic.vehicles;
    this.wanted.traffic = traffic;
    this.wanted.gameCars = this.allCars;
    this.markers = new MarkerSystem(scene);
    this.pickups = new PickupSystem(scene);
    this.world = { controllers, traffic, cars: this.allCars, actors: this.actors.actors, player: this.player };
    this.wrecks = Array.from({ length: WRECK_POOL }, (_, i) => {
      const car = controllers.createCarEntity({ kind: 'sedan', paint: 0x1d1a17 });
      car.wreck = true; car.destroyed = true; car.hp = 0; car.burnT = 0;
      car.position.set(-20 - i * 6, -40, -3000);
      car.mesh.position.copy(car.position);
      car.mesh.updateMatrixWorld();
      return car;
    });
    this.wreckCursor = 0;

    this.spawnFleet();
    this.restore();
    if (Object.keys(this.weapons).length === 1) {
      this.weapons.pistol = { mag: WEAPONS.pistol.mag, ammo: WEAPONS.pistol.mag * 3 };
      this.weaponId = 'pistol';
    }
    // The garage's own car and motorbike, built now so that summoning them never stalls a frame
    for (const [kind, paint] of [['sedan', 0x8f1a1d], ['moto', 0xc81e2a]]) {
      const car = this.makeCar(kind, paint, new THREE.Vector3(), 0, true);
      this.fleet.pop();
      car.pooled = true;
      this.rides.push(car);
      this.park(car);
    }
    controllers.entities.person.inVehicle = this.state === 'driving';
    this.onMode(this.state === 'driving' ? 'car' : 'person');
    this.buildInterface();
    this.hud = new GameHud();
    this.hud.setMoney(this.money, true);
    this.bind();
    this.hero = new CharacterModel(scene, controllers.entities.person.rig, LOOKS.hero, 'Protagonist');
    this.director = new MissionDirector(this);
    this.shops = new ShopSystem(this);
    this.arsenal = new Arsenal(this);
    this.garage = new Garage(this);
    this.shops.restore(this.savedShops);
    this.shops.place();
    this.placeWorldPickups();
    this.placeWorldBikes();
    this.setupRadio();
    this.setupMap();
    this.setupCollisions();
    if (new URLSearchParams(location.search).has('qa')) window.__playground = window.__game = this;
  }

  get active() { return this.playing && !this.paused && !this.modal && !this.map.isFullMapOpen; }
  get person() { return this.controllers.entities.person; }
  get car() { return this.controllers.entities.car; }
  get weapon() { return WEAPONS[this.weaponId] || WEAPONS.fists; }

  // ---- Vehicles ---------------------------------------------------------------------------------------------------
  makeCar(kind, paint, position, heading = 0, stolen = false) {
    if (this.fleet.length >= FLEET_MAX) {
      // recycle the oldest ordinary car far from the player
      const old = this.fleet.find((c) => !c.mission && c !== this.car && c.position.distanceTo(this.person.position) > 80);
      if (old) this.removeFleetCar(old);
    }
    const moto = kind === 'moto';
    const car = moto ? createMotorbike(this.scene, { paint }) : this.controllers.createCarEntity({ kind, paint });
    car.id = this.nextId++; car.stolen = stolen;
    car.position.copy(position); car.heading = heading; car.prevX = position.x; car.prevZ = position.z;
    if (!moto) car.drive = { reverseSpeed: 10, rolling: 0.18, drag: 0.0012, coast: 0.7, brake: 12, wheelbase: car.spec.wheelZ * 2, ...PROFILES[kind] };
    car.hp = 100; car.burnT = 0; car.destroyed = false;
    if (!moto) splitDoor(car);
    car.mesh.position.copy(car.position); car.mesh.rotation.y = heading;
    this.fleet.push(car);
    return car;
  }

  park(ride) {
    ride.position.set(20000, -100, 20000);
    ride.speed = 0;
    ride.mesh.position.copy(ride.position);
  }

  removeFleetCar(car) {
    const i = this.fleet.indexOf(car);
    if (i >= 0) this.fleet.splice(i, 1);
    if (car.mode || car.pooled) {
      this.park(car);
      car.mesh.visible = false;
    } else {
      car.mesh.removeFromParent();
      for (const spot of car.headLights || []) { spot.removeFromParent(); spot.target.removeFromParent(); }
    }
    if (this.car === car) {
      const next = this.fleet[0] || this.wrecks[0];
      this.controllers.entities.car = next;
    }
  }

  spawnFleet() {
    const z = streetZ(37) + 12;
    this.makeCar('sedan', 0x4b1019, new THREE.Vector3(8.15, 0, z));
    this.makeCar('suv', 0x163c36, new THREE.Vector3(8.15, 0, z + 18));
    this.makeCar('taxi', 0xffbd22, new THREE.Vector3(8.15, 0, z - 18));
    this.controllers.entities.car = this.fleet[0];
    const person = this.person;
    person.position.set(11.9, this.controllers.getGroundHeight(11.9, z, 'person'), z - 0.4);
    person.heading = 0;
    this.camera.footYaw = 0.18;
  }

  // Every driven body this layer simulates: the fleet, active cruisers, wrecks in the street
  collectCars() {
    const cars = this.allCars;
    cars.length = 0;
    for (const c of this.fleet) cars.push(c);
    for (const c of this.wanted.cars) cars.push(c);
    for (const c of this.wrecks) if (c.mesh.visible) cars.push(c);
    return cars;
  }

  // ---- Interface ---------------------------------------------------------------------------------------------------
  buildInterface() {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="game-vignette" aria-hidden="true"></div>
      <div id="game-brand"><span class="cm-monogram">OD<span>↗</span></span><span>OVERDRAFT<small>v${BUILD} · HUMAN CAPITAL</small></span></div>
      <div id="session-badge"><i></i><span>MANHATTAN</span><b id="session-mode">LIBRE</b><button id="pause-button" aria-label="Ouvrir le menu pause">Ⅱ</button></div>
      <div id="game-prompt" role="status" aria-live="polite"><kbd>F</kbd><span>Voler la voiture<small>VÉHICULE</small></span></div>
      <div id="game-toast" role="status" aria-live="polite"></div>
      <div id="stamina-track" aria-label="Endurance"><span id="stamina-fill"></span></div>
      <div id="vehicle-name"><span>VALMONT</span><strong>ÉCUME</strong><small>BERLINE / PROPULSION</small></div>
      <div id="drive-gauge"><span id="drive-gear">N</span><strong id="drive-speed">000</strong><span class="gauge-unit">KM/H</span><div><i id="drive-power"></i></div><b id="drive-health"></b></div>
      <div id="game-keybar"></div>
      <div id="game-menu" class="game-menu">
        <div class="menu-top"><span class="edition-label">EVERY DEBT GETS PAID.</span><span class="build-label">BUILD ${BUILD}</span></div>
        <div class="menu-body"><div class="menu-eyebrow"><span></span> <b id="menu-act">ACTE I — LA DETTE</b></div><h1>OVER<span>DRAFT<span class="title-dot">.</span></span></h1>
          <p class="menu-copy">Sacha Roux est arrivé à New York avec une dette qui ne lui appartient pas.<br>Deux cent cinquante mille dollars. Une ville entière pour les trouver.</p>
          <button id="play-button" class="primary-play">ENTRER DANS LA VILLE <span>↗</span></button>
          <div class="menu-secondary"><button id="new-session">Nouvelle partie</button><span id="menu-progress">CLAVIER + SOURIS / MANETTE</span></div>
        </div>
        <div class="menu-bottom"><span>MANHATTAN, NY<span class="coordinates">40°45′ N — 73°59′ W</span></span><button id="credits-button">CRÉDITS ↗</button><span class="menu-description">MISSIONS · COURSES · PRIMES<br>COMBAT · POURSUITES · 5 ÉTOILES</span></div>
        <div id="menu-options"><span>HEURE &amp; MÉTÉO</span><button data-game-time="golden">Soleil bas</button><button data-game-time="midday">Midi</button><button data-game-time="twilight">Crépuscule</button><button data-game-time="midnight">Nuit</button><button id="weather-toggle">MÉTÉO : AUTO</button><button id="sound-toggle">SON ACTIVÉ</button><button id="quality-toggle">QUALITÉ : HAUTE</button></div>
      </div>
      <dialog id="credits-dialog"><button id="close-credits" aria-label="Fermer les crédits">×</button><h2>OVERDRAFT</h2><p>Version ${BUILD} · Margin Call</p><p>Basé sur Slop New York par Mr.doob.<br>Rendu Three.js, WebGPU et TSL. Musique et sons générés en temps réel.</p><p>Données : NYC Open Data, MTA et © contributeurs OpenStreetMap (ODbL).</p><a href="./CREDITS.md" target="_blank" rel="noopener">Sources et licences ↗</a></dialog>
      <button id="mobile-interact" class="touch-interact" hidden>F <span>VÉHICULE</span></button>
    `);
    this.ui = Object.fromEntries(['game-menu', 'game-prompt', 'game-toast', 'stamina-fill', 'drive-speed', 'drive-gear', 'drive-power', 'drive-health', 'vehicle-name', 'game-keybar', 'play-button', 'mobile-interact', 'session-mode', 'menu-progress'].map(id => [id, document.getElementById(id)]));
    document.body.dataset.gameState = this.state;
    document.body.classList.add('in-menu');
    this.updateKeybar();
    this.updateMenuProgress();
  }

  updateMenuProgress() {
    const act = document.getElementById('menu-act');
    if (act) act.textContent = this.missionsDone.includes('decouvert') ? 'ACTE III — À SUIVRE' : this.missionsDone.includes('grande') ? 'ACTE II — MARGIN CALL' : 'ACTE I — LA DETTE';
    const done = this.missionsDone.length;
    if (this.ui['menu-progress']) this.ui['menu-progress'].textContent = done || this.money ? `${done} MISSION${done > 1 ? 'S' : ''} · ${Math.round(this.money).toLocaleString('fr-FR')} $` : 'CLAVIER + SOURIS / MANETTE';
  }

  bind() {
    document.getElementById('play-button').addEventListener('click', () => this.start());
    document.getElementById('pause-button').addEventListener('click', () => this.setPaused(true));
    document.getElementById('new-session').addEventListener('click', () => this.reset());
    document.getElementById('credits-button').addEventListener('click', () => document.getElementById('credits-dialog').showModal());
    document.getElementById('close-credits').addEventListener('click', () => document.getElementById('credits-dialog').close());
    document.getElementById('sound-toggle').addEventListener('click', e => {
      this.audio.setEnabled(!this.audio.enabled);
      e.currentTarget.textContent = this.audio.enabled ? 'SON ACTIVÉ' : 'SON COUPÉ';
    });
    document.getElementById('quality-toggle').addEventListener('click', () => {
      this.save();
      const url = new URL(location.href);
      url.searchParams.set('quality', cycleLevel());
      location.href = url.href;
    });
    document.getElementById('quality-toggle').textContent = `QUALITÉ : ${currentLevel().label}`;
    // The day runs on its own; these jump the clock
    const hours = { golden: 18, midday: 13, twilight: 20, midnight: 0.5 };
    document.querySelectorAll('[data-game-time]').forEach(button => button.addEventListener('click', () => {
      this.atmosphere.setHour(hours[button.dataset.gameTime]);
      document.querySelectorAll('[data-game-time]').forEach(b => b.classList.toggle('selected', b === button));
    }));
    const weathers = ['auto', 'clear', 'cloudy', 'rain', 'storm'];
    const weatherNames = { auto: 'AUTO', clear: 'DÉGAGÉ', cloudy: 'NUAGEUX', rain: 'PLUIE', storm: 'ORAGE' };
    document.getElementById('weather-toggle').addEventListener('click', (e) => {
      this.weatherMode = weathers[(weathers.indexOf(this.weatherMode || 'auto') + 1) % weathers.length];
      if (this.weatherMode !== 'auto') this.atmosphere.setWeather(this.weatherMode);
      this.atmosphere.lockWeather = this.weatherMode !== 'auto';
      e.currentTarget.textContent = `MÉTÉO : ${weatherNames[this.weatherMode]}`;
    });
    window.addEventListener('keydown', e => {
      if (e.defaultPrevented || this.modal || isTypingInField(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;
      if (e.code === 'KeyF' && this.active) { e.preventDefault(); this.interact(); }
      if (e.code === 'Escape' && !document.querySelector('dialog[open]')) {
        if (this.map.isFullMapOpen) this.map.toggleFullMap(false);
        // the same Escape may also have released the pointer lock, which already paused the game
        else if (this.playing && performance.now() - (this.lockPauseAt || 0) > 250) this.setPaused(!this.paused);
      }
      if (!this.active) return;
      if (e.code === 'KeyG') this.garage.toggle();
      if (e.code === 'Tab') { e.preventDefault(); this.arsenal.toggle(); }
      if (e.code === 'KeyR') {
        if (this.state === 'driving' && Math.abs(this.car.speed) < 1.5) {
          const car = this.car;
          car.position.y = this.controllers.getGroundHeight(car.position.x, car.position.z, 'car');
          car.speed = car.vx = car.vz = car.angularVel = 0;
        } else if (this.state === 'onFoot') this.reload();
      }
      if (e.code === 'KeyT' && this.radio && this.state === 'driving') {
        if (e.shiftKey) this.radio.prev(); else this.radio.next();
        this.showRadio();
      }
      const digit = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(e.code);
      if (digit >= 0 && (this.state === 'onFoot' || this.state === 'driving')) {
        const id = WEAPON_ORDER[digit];
        if (this.weapons[id]) this.selectWeapon(id);
        else this.arsenal.missing(id);
      }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.playing) this.setPaused(true); });
    window.addEventListener('pagehide', () => this.save());
    document.getElementById('mobile-interact').addEventListener('click', () => this.interact());
    if (navigator.maxTouchPoints > 0) this.ui['mobile-interact'].hidden = false;

    // Mouse: pointer lock look, right button aims, left button fires; the wheel cycles weapons on foot
    const canvas = this.camera.domElement;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      const onCanvas = e.target === canvas || document.pointerLockElement === canvas;
      if (!onCanvas) return;
      if (document.pointerLockElement !== canvas && e.button === 0 && !this.locking) {
        this.locking = true;
        Promise.resolve(canvas.requestPointerLock?.()).catch(() => {}).finally(() => { this.locking = false; });
      }
      if (e.button === 0) { this.fireHeld = true; this.firePressed = true; }
      if (e.button === 2) this.aimHeld = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) this.aimHeld = false;
    });
    window.addEventListener('blur', () => { this.fireHeld = this.aimHeld = false; });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.active && !this.expectUnlock) { this.lockPauseAt = performance.now(); this.setPaused(true); }
      this.expectUnlock = false;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.active || this.state !== 'onFoot') return;
      const owned = WEAPON_ORDER.filter((id) => this.weapons[id]);
      if (owned.length < 2) return;
      e.stopPropagation();
      e.preventDefault();
      // One weapon per gesture: a trackpad keeps sending events long after the fingers have left it
      const now = performance.now();
      const quiet = now - (this.wheelT ?? -Infinity) > WHEEL_GESTURE_GAP;
      this.wheelT = now;
      if (quiet) { this.wheelDone = false; this.wheelSum = 0; }
      if (this.wheelDone) return;
      this.wheelSum += e.deltaY;
      if (Math.abs(this.wheelSum) < WHEEL_STEP) return;
      this.wheelDone = true;
      const i = owned.indexOf(this.weaponId);
      this.selectWeapon(owned[(i + (this.wheelSum > 0 ? 1 : -1) + owned.length) % owned.length]);
    }, { capture: true, passive: false });
  }

  releasePointer() {
    if (document.pointerLockElement) { this.expectUnlock = true; document.exitPointerLock?.(); }
  }

  start() {
    const first = !this.playing;
    this.playing = true;
    this.setPaused(false);
    this.audio.setEnabled(this.audio.enabled);
    this.ui['play-button'].firstChild.textContent = 'REPRENDRE LA PARTIE ';
    if (first) {
      if (!this.missionsDone.length) {
        this.hud.say('', 'New York. Toute dette finit par se payer.', 4);
        this.toast('Bienvenue, Sacha', 'Rejoignez le marqueur vert : Mireille a du travail pour vous.');
      } else this.toast('Retour à Manhattan', `${this.missionsDone.length} mission(s) accomplie(s). Le marqueur vert indique la suite.`);
    }
  }

  setPaused(paused) {
    this.paused = paused;
    this.controllers.resetInput();
    this.fireHeld = this.aimHeld = false;
    this.gamepad.setEnabled(this.active);
    this.touch.setEnabled(this.active);
    document.body.classList.toggle('in-menu', paused || !this.playing);
    this.ui['game-menu'].classList.toggle('dismissed', !paused && this.playing);
    this.ui['game-menu'].hidden = !paused && this.playing;
    this.radio?.setMuffled(paused ? 1 : 0);
    if (paused) { this.save(); this.releasePointer(); this.updateMenuProgress(); }
    else this.camera.domElement.focus();
  }

  toast(title, subtitle = '') {
    const element = this.ui['game-toast'];
    element.replaceChildren();
    const h = document.createElement('strong'); h.textContent = title;
    const p = document.createElement('span'); p.textContent = subtitle;
    element.append(h, p); element.classList.add('visible');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => element.classList.remove('visible'), 4600);
  }

  updateKeybar() {
    const k = (keys, label) => `<span>${keys.map((x) => `<kbd>${x}</kbd>`).join(' ')} ${label}</span>`;
    const armed = this.weaponId !== 'fists';
    const end = [k(['G'], 'Garage'), k(['V'], 'Caméra'), k(['M'], 'Carte'), k(['ÉCHAP'], 'Menu')];
    const air = { helicopter: [k(['Z', 'S'], 'Avancer'), k(['Q', 'D'], 'Pivoter'), k(['ESPACE'], 'Monter'), k(['C'], 'Descendre')],
      plane: [k(['Z', 'S'], 'Piquer / Cabrer'), k(['Q', 'D'], 'Virer'), k(['ESPACE'], 'Gaz +'), k(['C'], 'Gaz −')] };
    const flying = this.state === 'driving' && this.car.air;
    this.ui['game-keybar'].innerHTML = flying ? [...air[this.car.mode], k(['F'], 'Sauter'), k(['T'], 'Radio'), ...end].join('')
      : this.state === 'falling' ? [k(['ZQSD'], 'Se diriger'), ...end].join('')
      : this.state === 'driving' && this.car.bicycle ? [k(['ZQSD'], 'Pédaler'), k(['F'], 'Descendre'), k(['T'], 'Radio'), ...end].join('')
      : this.state === 'driving' ? [k(['ZQSD'], 'Conduire'), k(['ESPACE'], 'Frein à main'), this.car.moto ? k(['MAJ'], 'Wheeling') : '', armed && this.weaponId !== 'shotgun' ? k(['CLIC D.', 'CLIC'], 'Tirer par la vitre') : '', k(['B'], 'Klaxon'), k(['T'], 'Radio'), k(['F'], 'Descendre'), ...end].join('')
      : [k(['ZQSD'], 'Se déplacer'), k(['MAJ'], 'Sprint'), k(['CLIC'], armed ? 'Tirer' : 'Frapper'), armed ? k(['CLIC D.'], 'Viser') : '', armed ? k(['R'], 'Recharger') : '',
        k(['TAB', '1-6'], 'Armes'), k(['F'], 'Véhicule'), k(['G'], 'Garage'), k(['M'], 'Carte'), k(['ÉCHAP'], 'Menu')].join('');
  }

  // ---- Radio ---------------------------------------------------------------------------------------------------------
  setupRadio() {
    this.radio = null;
    this.radioIndex ??= Math.floor(Math.random() * STATIONS.length);
    const attach = (context) => {
      try {
        this.radio = new RadioSystem(context, this.audio.music);
        this.radio.setStation(this.radioIndex);
        this.radio.setVolume(0.7);
        this.radio.onChange = () => this.showRadio();
        this.radio.setPlaying(this.state === 'driving');
      } catch (error) {
        console.warn('[radio]', error);
      }
    };
    const both = (context) => { attach(context); this.atmosphere.attachAudio(this.audio, context); };
    if (this.audio.context && this.audio.music) both(this.audio.context);
    else this.audio.onInitialize = (context) => queueMicrotask(() => both(context));
  }

  showRadio() {
    const now = this.radio?.nowPlaying;
    if (now) this.hud.showRadio(now.name, now.song ? `${now.song}` : now.tagline, now.color);
    else if (this.radio) this.hud.showRadio('RADIO COUPÉE', '', '#9aa39a');
  }

  // ---- Map overlay: flooded streets, police, mission blips, GPS ----------------------------------------------------
  setupMap() {
    if (DEBUG) this.map.onTeleport = (x, z) => this.teleportPlayer(x, z);
    else this.map.onTeleport = null;
    this.map.overlay = (ctx, toX, toY, w, h, scale, mini) => this.drawMapOverlay(ctx, toX, toY, w, h, scale, mini);
    this.gpsPath = null;
    this.gpsT = 0;
  }

  drawMapOverlay(ctx, toX, toY, w, h, scale, mini) {
    const t = performance.now() / 1000;
    const inView = (x, y, m = 0) => !mini || (Math.abs(x) < w * 0.5 + m && Math.abs(y) < h * 0.5 + m);
    // The search area: searched street segments, flashing red and blue while the player is in sight
    if (this.wanted.level > 0 && this.wanted.searchNodes.length) {
      const seen = this.wanted.seen;
      const nav = this.nav;
      const set = new Set(this.wanted.searchNodes);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(mini ? 5 : 4, 12 * scale);
      const pulse = 0.5 + 0.5 * Math.sin(t * (seen ? 9 : 2.2));
      ctx.strokeStyle = seen ? (Math.sin(t * 9) > 0 ? `rgba(255,60,80,${0.45 + pulse * 0.2})` : `rgba(60,120,255,${0.45 + pulse * 0.2})`) : `rgba(255,70,80,${0.18 + pulse * 0.14})`;
      ctx.beginPath();
      for (const i of this.wanted.searchNodes) {
        const a = nav.nodes[i];
        const ax = toX(a.x), ay = toY(a.z);
        if (!inView(ax, ay, 60)) continue;
        for (const l of nav.links[i]) {
          if (l.to < i && set.has(l.to)) continue;
          if (!set.has(l.to)) continue;
          const b = nav.nodes[l.to];
          ctx.moveTo(ax, ay);
          ctx.lineTo(toX(b.x), toY(b.z));
        }
      }
      ctx.stroke();
      // the search perimeter
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -t * 12;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(toX(this.wanted.zone.x), toY(this.wanted.zone.z), this.wanted.zone.radius * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // GPS route along the streets
    if (this.gpsPath && this.gpsPath.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,213,74,0.9)';
      ctx.lineWidth = mini ? 3 : 4;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(toX(this.player.x), toY(this.player.z));
      for (const p of this.gpsPath) ctx.lineTo(toX(p.x), toY(p.z));
      ctx.stroke();
      ctx.restore();
    }
    // Police
    for (const c of this.wanted.cars) {
      const x = toX(c.position.x), y = toY(c.position.z);
      if (!inView(x, y)) continue;
      ctx.fillStyle = Math.sin(t * 10) > 0 ? '#ff3b47' : '#3b7bff';
      ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
    }
    for (const a of this.actors.actors) {
      if (a.dead) continue;
      const x = toX(a.x), y = toY(a.z);
      if (!inView(x, y)) continue;
      ctx.fillStyle = a.team === 'police' ? '#7fb2ff' : a.hostile ? '#ff5a5a' : '#ffd54a';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
    // Markers & contacts
    for (const m of this.markers.markers) {
      if (!m.used || m.blip === false) continue;
      let x = toX(m.x), y = toY(m.z);
      const color = { objective: '#ffd54a', destination: '#5ec8ff', contact: '#e1f3a0', target: '#ff4d4d', race: '#ff9a3c', shop: '#c99bff', home: '#7ee08a', homeSale: '#3e8a4a' }[m.kind] || '#fff';
      const pinned = m.kind !== 'shop' && m.kind !== 'home' && m.kind !== 'homeSale';
      if (mini && !pinned && (Math.abs(x) > w * 0.5 - 6 || Math.abs(y) > h * 0.5 - 6)) continue;
      if (mini) {
        // pin markers to the radar's edge
        const r = Math.min(w, h) * 0.5 - 8;
        const d = Math.hypot(x, y);
        if (Math.abs(x) > w * 0.5 - 8 || Math.abs(y) > h * 0.5 - 8) { x = x / d * r; y = y / d * r; }
      }
      ctx.fillStyle = '#000a';
      ctx.beginPath(); ctx.arc(x, y, 6.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
      if (!mini && m.label) {
        ctx.font = '600 11px Arial';
        ctx.fillStyle = '#fff';
        ctx.fillText(m.label, x + 9, y + 4);
      }
    }
  }

  gps(x, z) {
    this.gpsTarget = x === null ? null : { x, z };
    this.gpsPath = null;
    this.gpsT = 0;
    this.map.waypoint = x === null ? null : { x, z, name: '' };
  }

  updateGps(dt) {
    this.gpsT -= dt;
    if (!this.gpsTarget || this.gpsT > 0) return;
    this.gpsT = 1.5;
    const path = this.nav.route(this.player.x, this.player.z, this.gpsTarget.x, this.gpsTarget.z, 12000);
    this.gpsPath = path;
  }

  // ---- Collisions --------------------------------------------------------------------------------------------------
  setupCollisions() {
    const audioListener = (e) => this.audio.crash(e);
    const listener = (e) => { audioListener(e); this.onCollision(e); };
    this.traffic.setCollisionListener(listener);
    this.controllers.setCollisionListener(listener);
    this.collisionListener = listener;
    this.event = { a: null, b: null, kind: 'vehicle', x: 0, y: 0.6, z: 0, nx: 0, ny: 0, nz: 0, speed: 0 };
  }

  onCollision(e) {
    const { a, b, speed } = e;
    const person = this.person;
    for (const [self, other] of [[a, b], [b, a]]) {
      if (!self) continue;
      if (self === person && other && other.edge !== undefined && speed > 3.5 && this.state === 'onFoot') {
        // struck by traffic while on foot
        this.damagePlayer(speed * 3.2, 'vehicle');
        if (speed > 5) this.knockDown(Math.atan2(e.nx, e.nz));
        continue;
      }
      if (self.bicycle && self === this.car && this.state === 'driving' && speed > 11) { this.bail(self, speed); continue; }
      if ((self.type === 'car' || self.air) && self.hp !== undefined && !self.destroyed && speed > 4.5) {
        this.damageCar(self, (speed - 4.5) * 2.6, self === this.car && this.state === 'driving' ? 'crash' : 'hit');
        if (self === this.car && this.state === 'driving' && self.moto && speed > 8) { this.bail(self, speed); continue; }
        if (self === this.car && this.state === 'driving' && speed > 13) this.damagePlayer((speed - 13) * 1.5, 'crash');
        if (other && other.police && self === this.car && this.state === 'driving') this.crime('copCarHit', e.x, e.z);
      }
      if (self.edge !== undefined && self.hp !== undefined && speed > 6 && other === this.car) {
        self.hp -= (speed - 6) * 2.2;
        if (self.hp <= 0) this.wreckTraffic(self);
      }
    }
  }

  readBody(car, body) {
    const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
    body.x = car.position.x; body.z = car.position.z;
    body.prevX = car.prevX ?? car.position.x; body.prevZ = car.prevZ ?? car.position.z;
    body.sin = sin; body.cos = cos;
    body.halfW = car.halfW ?? 0.92; body.halfL = car.halfL ?? Math.max(car.spec.zFront, -car.spec.zRear);
    body.mass = car.moto || car.bicycle ? 260 : car.wreck ? 1300 : car.police ? 1850 : 1650;
    body.vx = sin * car.speed + (car.vx || 0);
    body.vz = cos * car.speed + (car.vz || 0);
    body.angularVel = car.angularVel || 0;
  }

  writeBody(car, body) {
    const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
    car.speed = body.vx * sin + body.vz * cos;
    car.vx = body.vx - sin * car.speed;
    car.vz = body.vz - cos * car.speed;
    car.angularVel = body.angularVel;
  }

  collideCars(a, b) {
    if (a.air || b.air) return;
    const reach = 6;
    if (Math.abs(a.position.x - b.position.x) > reach + 3 || Math.abs(a.position.z - b.position.z) > reach + 3) return;
    this.readBody(a, bodyA);
    this.readBody(b, bodyB);
    if (!sweptVehicleContact(bodyA, bodyB, hit) && !vehicleContact(bodyA, bodyB, hit)) return;
    const speed = resolveVehicleContact(bodyA, bodyB, hit);
    const share = bodyB.mass / (bodyA.mass + bodyB.mass);
    a.position.x = hit.ax + hit.nx * hit.depth * share;
    a.position.z = hit.az + hit.nz * hit.depth * share;
    b.position.x = hit.bx - hit.nx * hit.depth * (1 - share);
    b.position.z = hit.bz - hit.nz * hit.depth * (1 - share);
    if (speed <= 0) return;
    this.writeBody(a, bodyA);
    this.writeBody(b, bodyB);
    const kick = Math.min(10, hit.impulse / 1600);
    for (const c of [a, b]) {
      if (c.pitchVel === undefined) continue;
      c.rollVel += (Math.random() - 0.5) * kick * 0.3;
      c.heaveVel += Math.min(0.6, kick * 0.05);
    }
    const ev = this.event;
    Object.assign(ev, { a, b, kind: 'vehicle', x: hit.x, y: 0.6, z: hit.z, nx: hit.nx, ny: 0, nz: hit.nz, speed });
    if (speed > 0.5) this.collisionListener(ev);
    if (speed > 2.2) this.traffic.spawnSparks(hit.x, 0.56, hit.z, hit.nx, hit.nz, speed);
  }

  // Bodies the car layer must keep apart from the protagonist on foot
  resolveParkedCollision(person, car) {
    if (person.position.y > car.position.y + 1.7) return;
    const dx = person.position.x - car.position.x, dz = person.position.z - car.position.z;
    if (Math.abs(dx) > 4 || Math.abs(dz) > 4) return;
    const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
    const x = dx * cos - dz * sin, z = dx * sin + dz * cos;
    const hx = (car.halfW ?? 0.92) + 0.03, hz = car.halfL ?? Math.max(car.spec.zFront, -car.spec.zRear);
    const qx = x - clamp(x, -hx, hx), qz = z - clamp(z, -hz, hz);
    const distance = Math.hypot(qx, qz);
    if (distance >= 0.34) return;
    // A moving car runs the player down
    const speed = Math.abs(car.speed) + Math.hypot(car.vx || 0, car.vz || 0);
    if (speed > 5 && this.state === 'onFoot' && car !== this.car) {
      this.damagePlayer(speed * 3, 'vehicle');
      this.knockDown(car.heading);
    }
    let nx = 0, nz = 0, push;
    if (distance > 0.001) { nx = qx / distance; nz = qz / distance; push = 0.34 - distance; }
    else if (hx - Math.abs(x) < hz - Math.abs(z)) { nx = Math.sign(x) || 1; push = hx - Math.abs(x) + 0.34; }
    else { nz = Math.sign(z) || 1; push = hz - Math.abs(z) + 0.34; }
    person.position.x += (cos * nx + sin * nz) * push;
    person.position.z += (-sin * nx + cos * nz) * push;
  }

  // ---- Protagonist on foot ------------------------------------------------------------------------------------------
  updatePerson(dt) {
    if (dt <= 0 || this.transition) return;
    if (this.state === 'falling') { this.updateParachute(dt); return; }
    const p = this.person, keys = this.controllers.keys;
    const grounded = this.state === 'onFoot';
    const x = grounded ? Number(keys.right) - Number(keys.left) : 0;
    const z = grounded ? Number(keys.forward) - Number(keys.backward) : 0;
    const amount = Math.min(1, Math.hypot(x, z));
    const aiming = this.isAiming();
    const sprint = keys.sprint && this.stamina > 1 && amount > 0 && !aiming;
    this.stamina = clamp(this.stamina + (sprint ? -13 : 20) * dt, 0, 100);
    const speed = aiming ? 2.6 : sprint ? 7.8 : 3.9;
    p.speed += (amount * speed - p.speed) * (1 - Math.exp(-dt * (amount ? 9 : 14)));
    const yaw = this.camera.footYaw;
    if (aiming || this.cooldown > this.weapon.interval * 0.5 && this.weaponId !== 'fists') {
      p.heading += angleDelta(p.heading, yaw) * (1 - Math.exp(-dt * 25));
    } else if (amount > 0) {
      const desired = yaw + Math.atan2(-x, z);
      p.heading += angleDelta(p.heading, desired) * (1 - Math.exp(-dt * 14));
    }
    if (amount > 0) {
      const magnitude = Math.hypot(x, z);
      const localX = -x / magnitude, localZ = z / magnitude;
      p.position.x += (Math.cos(yaw) * localX + Math.sin(yaw) * localZ) * p.speed * dt;
      p.position.z += (-Math.sin(yaw) * localX + Math.cos(yaw) * localZ) * p.speed * dt;
    }
    if (this.knock) {
      p.position.x += this.knock.vx * dt;
      p.position.z += this.knock.vz * dt;
      const damp = Math.exp(-5 * dt);
      this.knock.vx *= damp; this.knock.vz *= damp;
    }
    this.controllers.resolveHorizontalCollision(p.position, 0.34, null, null, 'person');
    for (const car of this.allCars) if (car.mesh.visible) this.resolveParkedCollision(p, car);
    const ground = this.controllers.getGroundHeight(p.position.x, p.position.z, 'person');
    if (grounded && keys.up && !this.jumpHeld && p.position.y <= ground + 0.04) p.verticalVel = 5.3;
    this.jumpHeld = Boolean(keys.up);
    p.verticalVel -= 15 * dt;
    p.position.y += p.verticalVel * dt;
    if (p.position.y < ground) { p.position.y = ground; p.verticalVel = 0; }
  }

  updateParachute(dt) {
    const p = this.person, keys = this.controllers.keys;
    const x = Number(keys.right) - Number(keys.left), z = Number(keys.forward) - Number(keys.backward);
    const magnitude = Math.hypot(x, z);
    if (magnitude > 0) {
      const yaw = this.camera.footYaw;
      const localX = -x / magnitude, localZ = z / magnitude;
      p.position.x += (Math.cos(yaw) * localX + Math.sin(yaw) * localZ) * PARACHUTE_DRIFT * dt;
      p.position.z += (-Math.sin(yaw) * localX + Math.cos(yaw) * localZ) * PARACHUTE_DRIFT * dt;
      p.heading += angleDelta(p.heading, yaw + Math.atan2(-x, z)) * (1 - Math.exp(-dt * 5));
    }
    p.verticalVel += (-PARACHUTE_SPEED - p.verticalVel) * (1 - Math.exp(-dt * 2));
    p.position.y += p.verticalVel * dt;
    this.controllers.resolveHorizontalCollision(p.position, 0.34, null, null, 'person');
    const ground = this.controllers.getGroundHeight(p.position.x, p.position.z, 'person');
    if (p.position.y > ground) return;
    p.position.y = ground;
    p.verticalVel = 0;
    this.state = 'onFoot';
    document.body.dataset.gameState = this.state;
    this.updateKeybar();
    this.save();
  }

  // Left alone, a plane glides on until it falls or lands; a helicopter drops
  flyAbandoned(c, dt) {
    if (c.mode === 'plane') {
      if (!c.onGround || c.speed > 0.01) stepPlane(c, IDLE_STICK, dt, this.controllers.planeEnvironment);
    } else if (c.position.y > 0.25) {
      c.verticalSpeed -= 9.81 * dt;
      c.position.x += Math.sin(c.heading) * c.speed * dt;
      c.position.z += Math.cos(c.heading) * c.speed * dt;
      c.position.y += c.verticalSpeed * dt;
      c.speed *= Math.exp(-dt * 0.5);
      if (c.position.y <= 0.25) {
        c.position.y = 0.25;
        c.crashed = c.verticalSpeed < -9;
        c.verticalSpeed = c.speed = 0;
      }
    }
    if (c.crashed) this.destroyCar(c);
  }

  // Thrown off a motorbike by a hard impact: the rider tumbles on, the bike slides and falls
  bail(bike, speed) {
    const p = this.person;
    const h = bike.heading;
    this.transition = null;
    p.inVehicle = false;
    this.state = 'onFoot';
    const x = bike.position.x + Math.sin(h) * 1.3, z = bike.position.z + Math.cos(h) * 1.3;
    p.position.set(x, this.controllers.getGroundHeight(x, z, 'person'), z);
    this.onMode('person');
    this.radio?.setPlaying(false);
    this.camera.footYaw = h;
    bike.fallen = true;
    bike.speed *= 0.4;
    this.invulnerable = 0;
    this.damagePlayer(Math.min(55, speed * 2.2), 'crash');
    if (this.state === 'onFoot') {
      this.knockDown(h);
      this.knock = { vx: Math.sin(h) * Math.min(11, speed * 0.55), vz: Math.cos(h) * Math.min(11, speed * 0.55) };
    }
    this.audio.sfx('punch', x, 0.8, z, { rate: 0.6 });
    this.camera.addShake(0.6);
  }

  // Parked motorbikes around the city (kept once moved, like any car the player has used)
  placeWorldBikes() {
    if (this.worldBikesPlaced) return;
    this.worldBikesPlaced = true;
    const spots = [[8.15, streetZ(37) + 48, 0, 0xc81e2a], [-1403, streetZ(44) + 58, 0, 0x1f5fbf], [1072, streetZ(12) + 58, Math.PI, 0xf2c230],
      [-578, streetZ(116) + 45, Math.PI, 0x161616], [-296, streetZ(14) + 50, 0, 0x2e8b57]];
    for (const [x, z, heading, paint] of spots) {
      if (this.fleet.some((c) => c.moto && Math.hypot(c.position.x - x, c.position.z - z) < 30)) continue;
      const bike = this.makeCar('moto', paint, new THREE.Vector3(x, 0, z), heading);
      bike.lean = 0.12;
    }
  }

  isAiming() {
    return this.state === 'onFoot' && this.aimHeld && this.weaponId !== 'fists';
  }

  knockDown(heading) {
    if (this.state !== 'onFoot' || this.invulnerable > 0) return;
    this.state = 'down';
    this.stateT = 0;
    this.knock = { vx: Math.sin(heading) * 5, vz: Math.cos(heading) * 5 };
    this.invulnerable = 1;
    this.person.heading = heading;
    document.body.dataset.gameState = this.state;
  }

  // ---- Weapons -----------------------------------------------------------------------------------------------------
  giveWeapon(id, ammo = 0) {
    const w = WEAPONS[id];
    if (!w) return;
    const fresh = !this.weapons[id];
    if (fresh) this.weapons[id] = { mag: 0, ammo: 0 };
    const slot = this.weapons[id];
    if (w.throwable) slot.mag = Math.min(w.mag, slot.mag + ammo);
    else slot.ammo += ammo;
    if (!w.throwable && slot.mag < w.mag) {
      const take = Math.min(w.mag - slot.mag, slot.ammo);
      slot.mag += take; slot.ammo -= take;
    }
    if (fresh) this.selectWeapon(id);
    this.updateKeybar();
  }

  selectWeapon(id) {
    if (!this.weapons[id] || id === this.weaponId) return;
    this.weaponId = id;
    this.reloadT = 0;
    this.cooldown = 0.25;
    this.hero?.setWeapon(WEAPONS[id].melee ? null : id);
    this.audio.sfx('reload', this.player.x, this.player.y + 1.2, this.player.z, { intensity: 0.4, rate: 1.4 });
    this.updateKeybar();
  }

  reload() {
    const w = this.weapon, slot = this.weapons[this.weaponId];
    if (w.melee || !slot || this.reloadT > 0 || slot.mag >= w.mag || slot.ammo <= 0) return;
    this.reloadT = w.reload;
    this.audio.sfx('reload', this.player.x, this.player.y + 1.2, this.player.z);
  }

  updateWeapons(dt) {
    const w = this.weapon, slot = this.weapons[this.weaponId];
    this.cooldown = Math.max(0, this.cooldown - dt);
    const person = this.person;
    const rig = person.rig;
    const onFoot = this.state === 'onFoot';
    const aiming = this.isAiming();
    this.camera.aimMode = aiming;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0 && slot) {
        const take = Math.min(w.mag - slot.mag, slot.ammo);
        slot.mag += take; slot.ammo -= take;
      }
    }
    // Punch animation
    if (this.punchT > 0) {
      this.punchT -= dt;
      rig.punch = Math.sin(clamp(1 - this.punchT / 0.38, 0, 1) * Math.PI);
      if (!this.punchHit && this.punchT < 0.24) { this.punchHit = true; this.meleeHit(); }
    } else rig.punch = 0;

    const shooting = onFoot && (w.auto ? this.fireHeld : this.firePressed);
    // Drive-by: aim out of the driver's window with a one-handed or compact weapon
    const driveBy = this.state === 'driving' && !this.car.bicycle && !this.car.air && this.aimHeld && !w.melee && !w.throwable && w.id !== 'shotgun' && w.id !== 'rifle' && !!slot;
    this.world.ignoreCar = this.state === 'driving' ? this.car : null;
    if (driveBy) {
      this.hud.setCrosshair(true, w.spread + 0.02);
      if ((w.auto ? this.fireHeld : this.firePressed) && this.cooldown <= 0 && this.reloadT <= 0) {
        if (slot.mag > 0) this.fire(w, slot, true);
        else if (slot.ammo > 0) this.reload();
      }
    }
    // Arms: raised while aiming or just after a shot
    const raised = onFoot && !w.melee && !w.throwable && (aiming || this.cooldown > 0 || shooting || this.reloadT > 0);
    rig.reloading = this.reloadT > 0 ? 1 - this.reloadT / w.reload : -1;
    // Sacha looks where the player looks
    if (onFoot) rig.lookTarget = clamp(angleDelta(rig.yaw, this.camera.footYaw), -1.1, 1.1);
    if (raised && !w.melee) {
      this.holdUpT = (this.holdUpT ?? 0) - dt;
      if (this.holdUpT <= 0) {
        this.holdUpT = 0.25;
        this.traffic.pedestrians.holdUp(this.player.x, this.player.z, Math.sin(this.camera.footYaw), Math.cos(this.camera.footYaw));
      }
    }
    if (raised) {
      this.aimPoint();
      rig.aim = { x: _aim.x, y: _aim.y, z: _aim.z, twoHanded: true, stance: w.hands === 2 ? 'rifle' : 'pistol' };
    } else rig.aim = null;
    this.player.threat = raised || this.cooldown > 0;

    this.spread += ((aiming ? 0 : 0.6) + Math.min(1, person.speed / 4) * 0.6 - this.spread) * Math.min(1, dt * 6);
    if (!driveBy) this.hud.setCrosshair(onFoot && !w.melee && (aiming || this.fireHeld), w.spread + this.spread * (w.moveSpread || 0.02) * 2);

    if (shooting && this.cooldown <= 0 && this.state === 'onFoot') {
      if (w.melee) {
        this.cooldown = w.interval;
        this.punchT = 0.38;
        this.punchHit = false;
        person.heading = this.camera.footYaw;
        rig.punchSide = 1 - rig.punchSide; // one hand, then the other
      } else if (w.throwable) {
        if (slot.mag > 0) this.throwGrenade(w, slot);
      } else if (this.reloadT <= 0) {
        if (slot.mag > 0) this.fire(w, slot);
        else if (slot.ammo > 0) this.reload();
        else if (this.firePressed) { this.audio.sfx('dry', this.player.x, this.player.y + 1.2, this.player.z); this.cooldown = 0.3; }
      }
    }
    this.firePressed = false;
    this.hud.setWeapon(w.name, w.melee ? w.sub.toUpperCase() : w.throwable ? `× ${slot.mag}` : `${slot.mag} / ${slot.ammo}${this.reloadT > 0 ? ' · RECHARGE' : ''}`);
    this.updateGrenades(dt);
  }

  // Grenades: thrown along the view with an arc, bouncing off the street and walls, exploding when the fuse runs out
  throwGrenade(w, slot) {
    slot.mag--;
    this.cooldown = w.interval;
    const person = this.person;
    person.heading = this.camera.footYaw;
    this.punchT = 0.38;
    this.punchHit = true;
    this.camera.camera.getWorldDirection(_camDir);
    const start = this.hero.muzzle(new THREE.Vector3()).add(_v.set(0, 0.25, 0));
    const pitch = Math.max(-0.2, _camDir.y);
    const flat = Math.hypot(_camDir.x, _camDir.z) || 1;
    const speed = 15;
    const vel = new THREE.Vector3(_camDir.x / flat * speed * Math.cos(pitch), 4.5 + pitch * 12, _camDir.z / flat * speed * Math.cos(pitch));
    if (!this.grenadePool) {
      const geo = new THREE.SphereGeometry(0.06, 10, 8).scale(1, 1.25, 1);
      const mat = new THREE.MeshStandardNodeMaterial({ color: 0x2c3328, roughness: 0.6, metalness: 0.4 });
      this.grenadePool = Array.from({ length: 8 }, () => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.visible = false; this.scene.add(m); return m; });
      this.grenades = [];
    }
    const mesh = this.grenadePool.find((m) => !m.visible) || this.grenadePool[0];
    mesh.visible = true;
    this.grenades.push({ pos: start, vel, fuse: 2.3, mesh });
    this.audio.sfx('throw', start.x, start.y, start.z);
    if (slot.mag === 0) {
      const next = WEAPON_ORDER.filter((id) => this.weapons[id] && id !== 'grenade').pop();
      setTimeout(() => this.selectWeapon(next || 'fists'), 500);
    }
  }

  updateGrenades(dt) {
    if (!this.grenades) return;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.vel.y -= 9.8 * dt;
      g.pos.addScaledVector(g.vel, dt);
      // walls: push out, reflect the velocity off the push direction
      const probe = { x: g.pos.x, y: g.pos.y, z: g.pos.z };
      this.controllers.resolveHorizontalCollision(probe, 0.08, null, null, 'person');
      const nx = probe.x - g.pos.x, nz = probe.z - g.pos.z, nl = Math.hypot(nx, nz);
      if (nl > 1e-4) {
        const dot = (g.vel.x * nx + g.vel.z * nz) / nl;
        if (dot < 0) { g.vel.x -= 1.5 * dot * nx / nl; g.vel.z -= 1.5 * dot * nz / nl; }
        g.pos.x = probe.x; g.pos.z = probe.z;
      }
      const ground = this.controllers.getGroundHeight(g.pos.x, g.pos.z, 'person') + 0.07;
      if (g.pos.y < ground) {
        g.pos.y = ground;
        if (g.vel.y < -1.5) this.audio.sfx('impactMetal', g.pos.x, g.pos.y, g.pos.z, { intensity: 0.4, rate: 1.6 });
        g.vel.y = Math.abs(g.vel.y) * 0.32;
        g.vel.x *= 0.62; g.vel.z *= 0.62;
      }
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += dt * 9;
      g.mesh.updateMatrixWorld();
      if (g.fuse <= 0) {
        g.mesh.visible = false;
        this.grenades.splice(i, 1);
        this.explode(g.pos.x, g.pos.y, g.pos.z, 1.05, 'player');
      }
    }
  }

  // Where the crosshair points in the world (the camera's centre ray), into _aim
  aimPoint() {
    const cam = this.camera.camera;
    cam.getWorldDirection(_camDir);
    const h = castShot(this.world, cam.position.x, cam.position.y, cam.position.z, _camDir.x, _camDir.y, _camDir.z, 220, this.player);
    // never aim at something between the camera and the character
    const along = (h.x - cam.position.x) * _camDir.x + (h.y - cam.position.y) * _camDir.y + (h.z - cam.position.z) * _camDir.z;
    if (along < 3) _aim.copy(cam.position).addScaledVector(_camDir, 30);
    else _aim.set(h.x, h.y, h.z);
    return _aim;
  }

  fire(w, slot, fromCar = false) {
    slot.mag--;
    this.cooldown = w.interval * (fromCar ? 1.25 : 1);
    this.stats.shots++;
    const person = this.person;
    this.aimPoint();
    if (fromCar) {
      // the driver's window (+x of the car frame)
      const c = this.car, h = c.heading;
      _muzzle.set(c.position.x + Math.cos(h) * 1.05 + Math.sin(h) * 0.25, 1.3, c.position.z - Math.sin(h) * 1.05 + Math.cos(h) * 0.25);
    } else {
      person.heading = this.camera.footYaw;
      this.hero.muzzle(_muzzle);
      this.hero.fired();
    }
    _dir.copy(_aim).sub(_muzzle).normalize();
    const spread = fromCar ? w.spread + 0.012 + Math.min(0.03, Math.abs(this.car.speed) * 0.0012) : w.spread + this.spread * (w.moveSpread || 0.02);
    const pellets = w.pellets || 1;
    let landed = false, killed = false;
    for (let i = 0; i < pellets; i++) {
      spreadDirection(_dir.x, _dir.y, _dir.z, spread, _v);
      const h = castShot(this.world, _muzzle.x, _muzzle.y, _muzzle.z, _v.x, _v.y, _v.z, w.range, this.player);
      if (i === 0 || i % 3 === 0) this.fx.tracer(_muzzle, h);
      const r = this.applyShot(h, w.damage, 'player');
      landed ||= r.hit; killed ||= r.kill;
    }
    if (landed) this.hud.hit(killed);
    this.fx.muzzleFlash(_muzzle, _dir, w.id === 'shotgun');
    this.audio.sfx(w.sound, _muzzle.x, _muzzle.y, _muzzle.z);
    this.camera.addShake(w.shake);
    this.camera.orbitPitchOffset -= w.recoil * (0.6 + Math.random() * 0.8);
    this.camera.footYaw += (Math.random() - 0.5) * w.recoil * 0.5;
    // Gunfire empties the street and calls the police if anyone notices
    const panicked = this.traffic.pedestrians.panic(this.player.x, this.player.z, 45, 12);
    this.traffic.flee(this.player.x, this.player.z, 40, 7);
    if (this.clock - this.lastCrimeShot > 1.5) {
      this.lastCrimeShot = this.clock;
      if (panicked > 0 || this.policeNear(90) || this.wanted.level > 0) this.crime('shots', this.player.x, this.player.z);
    }
    if (slot.mag === 0 && slot.ammo > 0) setTimeout(() => this.reload(), 180);
  }

  meleeHit() {
    const p = this.person;
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    let landed = false;
    for (const ped of this.traffic.peds) {
      if (!ped.placed || ped.dead) continue;
      const dx = ped.x - p.position.x, dz = ped.z - p.position.z, d = Math.hypot(dx, dz);
      if (d > 1.9 || (dx * fx + dz * fz) / (d || 1) < 0.5) continue;
      landed = true;
      ped.hp = (ped.hp ?? 100) - 40;
      if (ped.hp <= 0) this.killPed(ped, p.heading, 1.5, 'player');
      else { this.traffic.pedestrians.panic(ped.x, ped.z, 3, 12); this.crime('pedHit', ped.x, ped.z); }
      break;
    }
    for (const a of this.actors.actors) {
      if (a.dead) continue;
      const dx = a.x - p.position.x, dz = a.z - p.position.z, d = Math.hypot(dx, dz);
      if (d > 1.9 || (dx * fx + dz * fz) / (d || 1) < 0.5) continue;
      landed = true;
      this.actors.damage(a, 26, fx, fz, 'melee');
      if (a.team === 'police') this.crime(a.dead ? 'copKilled' : 'copHurt', a.x, a.z);
      break;
    }
    if (landed) {
      this.audio.sfx('punch', p.position.x, p.position.y + 1.3, p.position.z);
      this.camera.addShake(0.15);
      this.hud.hit(false);
    }
  }

  // A projectile's effect on whatever it struck. Returns { hit, kill } for hit markers.
  applyShot(h, damage, shooter) {
    const byPlayer = shooter === 'player';
    const dir = { x: -h.nx, z: -h.nz };
    const head = (y, base) => y - base > 1.52;
    switch (h.kind) {
      case 'ped': {
        const p = h.target;
        const groundY = p.node ? 0.012 : 0.22;
        const mult = head(h.y, groundY) ? 3 : 1;
        p.hp = (p.hp ?? 100) - damage * mult;
        this.fx.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, 'flesh');
        if (p.hp <= 0) {
          this.killPed(p, Math.atan2(dir.x, dir.z), 0.8, byPlayer ? 'player' : 'npc');
          return { hit: true, kill: true };
        }
        this.traffic.pedestrians.panic(p.x, p.z, 20, 12);
        if (byPlayer) this.crime('pedHit', p.x, p.z);
        return { hit: true, kill: false };
      }
      case 'actor': {
        const a = h.target;
        if (shooter && shooter.team && shooter.team === a.team) return { hit: false };
        const mult = head(h.y, a.y) ? 2.6 : 1;
        this.fx.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, 'flesh');
        const wasAlive = !a.dead;
        this.actors.damage(a, damage * mult, dir.x, dir.z, 'shot');
        if (byPlayer) {
          this.actors.alertTeam(a.team, a.x, a.z, 70);
          if (a.team === 'police') this.crime(a.dead ? 'copKilled' : 'copHurt', a.x, a.z);
        }
        return { hit: true, kill: wasAlive && a.dead };
      }
      case 'traffic': {
        const v = h.target;
        this.fx.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, 'metal');
        this.audio.sfx('impactMetal', h.x, h.y, h.z);
        v.hp = (v.hp ?? 100) - damage * 0.45;
        v.panicUntil = 0; this.traffic.flee(v.x, v.z, 4, 6);
        if (v.hp <= 0) this.wreckTraffic(v);
        if (byPlayer && v.isPolice) this.crime('copCarHit', v.x, v.z);
        return { hit: true, kill: false };
      }
      case 'car': {
        const c = h.target;
        this.fx.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, 'metal');
        this.audio.sfx('impactMetal', h.x, h.y, h.z);
        if (!c.destroyed) this.damageCar(c, damage * 0.4, 'shot');
        if (byPlayer && c.police) this.crime('copCarHit', c.position.x, c.position.z);
        return { hit: true, kill: false };
      }
      case 'player': {
        if (h.melee) this.audio.sfx('punch', h.x, h.y, h.z);
        else this.fx.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, this.player.inVehicle ? 'metal' : 'flesh');
        if (this.player.inVehicle && !this.car.moto) {
          this.damageCar(this.car, damage * 0.5, 'shot');
          this.damagePlayer(damage * 0.25, 'shot');
        } else this.damagePlayer(damage, h.melee ? 'melee' : 'shot');
        return { hit: true };
      }
      case 'building':
      case 'ground':
        this.fx.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, 'concrete');
        if (Math.random() < 0.5) this.audio.sfx('impact', h.x, h.y, h.z);
        return { hit: false };
      default:
        return { hit: false };
    }
  }

  killPed(p, heading, push, cause) {
    if (!this.traffic.pedestrians.kill(p, heading, push, cause === 'explosion' ? 'explosion' : push > 2 ? 'vehicle' : 'shot')) return;
    this.traffic.pedestrians.panic(p.x, p.z, 35, 14);
    if (cause === 'player') {
      this.stats.kills++;
      this.crime('pedKilled', p.x, p.z);
      if (Math.random() < 0.45) this.pickups.add('cash', p.x + 0.4, p.z + 0.3, { amount: 5 + Math.floor(Math.random() * 60), life: 40 });
    }
  }

  onActorKilled(actor, cause) {
    if (actor.team !== 'police') this.stats.kills++;
    else this.stats.cops++;
    // dropped weapon & cash
    const w = actor.weapon;
    if (w && !WEAPONS[w].melee && Math.random() < 0.8) this.pickups.add(w, actor.x + 0.5, actor.z - 0.3, { amount: Math.round(WEAPONS[w].mag * (0.6 + Math.random())), life: 60 });
    if (Math.random() < 0.5) this.pickups.add('cash', actor.x - 0.4, actor.z + 0.3, { amount: 20 + Math.floor(Math.random() * 120), life: 60 });
    this.traffic.pedestrians.panic(actor.x, actor.z, 40, 12);
  }

  policeNear(radius) {
    for (const c of this.wanted.cars) if (Math.hypot(c.position.x - this.player.x, c.position.z - this.player.z) < radius) return true;
    for (const a of this.actors.actors) if (a.team === 'police' && !a.dead && Math.hypot(a.x - this.player.x, a.z - this.player.z) < radius) return true;
    for (const v of this.traffic.cars) if (v.isPolice && v.edge && Math.hypot(v.x - this.player.x, v.z - this.player.z) < radius * 0.7) return true;
    return false;
  }

  crime(kind, x, z) {
    if (this.state === 'dead' || this.state === 'busted') return;
    this.wanted.crime(kind, x, z, true);
  }

  onWantedLevel(level, previous) {
    if (level > previous) {
      this.audio.ui('wantedUp');
      if (previous === 0) this.toast(`${'★'.repeat(level)} ${WANTED_LEVELS[level].name}`, 'Sortez de la zone de recherche (carte) et restez hors de vue pour semer la police.');
    } else if (level === 0) {
      this.toast('Police semée', 'Les recherches sont abandonnées.');
    }
  }

  // ---- Damage ------------------------------------------------------------------------------------------------------
  damagePlayer(amount, cause = 'shot') {
    if (this.state === 'dead' || this.state === 'busted' || amount <= 0 || this.invulnerable > 0 && cause !== 'explosion') return;
    if (this.armor > 0 && cause !== 'crash') {
      const absorbed = Math.min(this.armor, amount * 0.7);
      this.armor -= absorbed;
      amount -= absorbed;
    }
    this.health -= amount;
    this.lastHurt = this.clock;
    if (this.state === 'onFoot' && amount > 3 && this.health > 0) this.person.rig.flinch(Math.sin(this.lastHitHeading ?? this.person.heading + Math.PI), Math.cos(this.lastHitHeading ?? this.person.heading + Math.PI), 0.26);
    this.hud.hurt(amount);
    this.camera.addShake(Math.min(0.5, amount / 40));
    if (this.health <= 0) this.die(cause);
  }

  damageCar(car, amount, cause) {
    if (car.destroyed || car.hp === undefined) return;
    car.hp = Math.max(0, car.hp - amount);
    if (car.hp <= 0 && !car.burnT) {
      car.burnT = cause === 'explosion' ? 0.4 : 5 + Math.random() * 2;
      if (car === this.car && this.state === 'driving') this.toast('Le moteur prend feu', 'Sortez du véhicule avant l’explosion ! [F]');
    }
  }

  updateCarDamage(dt) {
    for (const car of this.allCars) {
      if (car.wreck) {
        if (car.burnT > 0) {
          car.burnT -= dt;
          this.fx.fire(car.position.x, 0.9, car.position.z, dt, 0.9);
        } else if (car.smokeT > 0) {
          car.smokeT -= dt;
          this.fx.smokeTrail(car.position.x, 1.2, car.position.z, dt, 0.6, 0.9);
        }
        continue;
      }
      if (car.destroyed) continue;
      const hood = (k) => ({ x: car.position.x + Math.sin(car.heading) * k, z: car.position.z + Math.cos(car.heading) * k });
      if (car.hp < 50 && car.hp > 0) {
        const h = hood(1.5);
        this.fx.smokeTrail(h.x, car.position.y + 1.05, h.z, dt, (50 - car.hp) / 50, car.hp < 25 ? 0.7 : 0.2);
      }
      if (car.burnT > 0) {
        const h = hood(1.3);
        this.fx.fire(h.x, car.position.y + 0.9, h.z, dt, 0.7);
        car.burnT -= dt;
        if (car.burnT <= 0) this.destroyCar(car);
      }
    }
  }

  // Swap a burnt-out car for a pooled wreck, with the blast
  placeWreck(x, z, heading, burn = 22) {
    const w = this.wrecks[this.wreckCursor++ % this.wrecks.length];
    w.position.set(x, 0, z);
    w.heading = heading;
    w.prevX = x; w.prevZ = z;
    w.speed = w.vx = w.vz = w.angularVel = 0;
    w.burnT = burn; w.smokeT = 60;
    w.mesh.visible = true;
    w.mesh.position.copy(w.position);
    w.mesh.rotation.y = heading;
    w.mesh.updateMatrixWorld();
    return w;
  }

  destroyCar(car) {
    car.destroyed = true;
    car.burnT = 0;
    const { x, y, z } = car.position;
    const heading = car.heading;
    const playerInside = car === this.car && (this.state === 'driving' || this.state === 'entering' || this.state === 'exiting');
    const ejected = playerInside && !!car.air && y > EJECT_ALTITUDE;
    if (ejected) this.bailOut();
    if (car.police) {
      this.wanted.retire(this.wanted.units.find((u) => u.car === car));
    } else if (this.fleet.includes(car)) {
      this.removeFleetCar(car);
    }
    car.mesh.visible = false;
    if (!car.moto && !car.mode) this.placeWreck(x, z, heading);
    if (playerInside && !ejected) {
      // thrown clear, fatally
      this.transition = null;
      this.state = 'onFoot';
      this.person.inVehicle = false;
      this.person.position.set(x + Math.cos(heading) * 2.2, this.controllers.getGroundHeight(x, z, 'person'), z - Math.sin(heading) * 2.2);
      this.onMode('person');
    }
    this.explode(x, Math.max(0.8, y), z, car.air ? 1.5 : 1, car === this.car ? 'player' : 'npc');
    if (playerInside && !ejected && this.state !== 'dead') this.damagePlayer(200, 'explosion');
    if (ejected) this.toast('Éjecté !', 'ZQSD pour diriger le parachute.');
  }

  wreckTraffic(v, generation = 0) {
    if (!v.edge) return;
    const x = v.x, z = v.z, heading = v.yaw + v.yawOffset;
    this.traffic.removeVehicle(v);
    this.placeWreck(x, z, heading);
    this.explode(x, 0.8, z, 0.85, generation ? 'chain' : 'player', generation);
    this.stats.cars++;
  }

  // generation: 0 for a blast the player caused, 1+ for the cars it set off in turn (weaker, bounded)
  explode(x, y, z, power = 1, cause = 'npc', generation = 0) {
    // At most a few blasts a second, however the chain reaction spreads
    const now = this.clock;
    this.blastBudget = Math.min(3, (this.blastBudget ?? 3) + (now - (this.blastT ?? now)) * 1.5);
    this.blastT = now;
    if (generation > 0 && this.blastBudget < 1) return;
    this.blastBudget -= 1;
    this.stats.explosions++;
    this.fx.explosion(x, y, z, power);
    this.audio.sfx('explosion', x, y + 1, z, { intensity: Math.min(1, power) });
    const camD = this.camera.camera.position.distanceTo(_v.set(x, y, z));
    this.camera.addShake(Math.max(0, 1.2 - camD / 60) * power);
    const radius = 8 * power;
    // people
    for (const p of this.traffic.peds) {
      if (!p.placed || p.dead) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < radius) this.killPed(p, Math.atan2(p.x - x, p.z - z), 7 * (1 - d / radius) + 2, cause === 'player' ? 'player' : 'npc');
    }
    for (const a of this.actors.actors) {
      if (a.dead) continue;
      const d = Math.hypot(a.x - x, a.z - z);
      if (d < radius * 1.2) this.actors.damage(a, 160 * (1 - d / (radius * 1.2)), a.x - x, a.z - z, 'explosion');
    }
    if (this.state !== 'dead' && this.state !== 'falling') {
      const d = Math.hypot(this.player.x - x, this.player.z - z);
      if (d < radius * 1.3) {
        const amount = 140 * (1 - d / (radius * 1.3));
        if (this.player.inVehicle) { this.damageCar(this.car, amount, 'explosion'); this.damagePlayer(amount * 0.3, 'explosion'); }
        else { this.damagePlayer(amount, 'explosion'); if (amount > 25) this.knockDown(Math.atan2(this.player.x - x, this.player.z - z)); }
      }
    }
    // cars: damage, a push, chain reactions
    for (const c of this.allCars) {
      if (c.wreck) continue;
      const dx = c.position.x - x, dz = c.position.z - z, d = Math.hypot(dx, dz);
      if (d < 0.5 || d > radius * 1.2) continue;
      const k = 1 - d / (radius * 1.2);
      this.damageCar(c, 90 * k * (generation ? 0.5 : 1), 'explosion');
      c.vx = (c.vx || 0) + dx / d * 9 * k;
      c.vz = (c.vz || 0) + dz / d * 9 * k;
      c.angularVel = (c.angularVel || 0) + (Math.random() - 0.5) * 4 * k;
      if (c.heaveVel !== undefined) c.heaveVel += 2 * k;
    }
    for (const v of this.traffic.vehicles) {
      if (!v.edge) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < radius * 0.75) {
        v.hp = (v.hp ?? 100) - 150 * (1 - d / radius) * (generation ? 0.45 : 1);
        if (v.hp <= 0 && generation < 2) setTimeout(() => this.wreckTraffic(v, generation + 1), 350 + Math.random() * 600);
      }
      else if (d < radius * 1.6) { v.vx += (v.x - x) / d * 5; v.vz += (v.z - z) / d * 5; v.impactTime = Math.max(v.impactTime, 0.8); }
    }
    this.traffic.pedestrians.panic(x, z, 70, 16);
    this.traffic.flee(x, z, 60, 8);
    if (cause === 'player') this.crime('explosion', x, z);
  }

  // Cars striking people: the player's (and every other driven gameplay car) at speed
  runOver() {
    for (const car of this.allCars) {
      if (car.wreck || car.destroyed || car.mode) continue;
      const speed = Math.abs(car.speed);
      if (speed < 4.5) continue;
      const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
      const halfL = Math.max(car.spec.zFront, -car.spec.zRear) + 0.25;
      const test = (x, z) => {
        const dx = x - car.position.x, dz = z - car.position.z;
        if (Math.abs(dx) > 4 || Math.abs(dz) > 4) return false;
        const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
        return Math.abs(lx) < (car.halfW ?? 0.9) + 0.25 && Math.abs(lz) < halfL;
      };
      const byPlayer = car === this.car && this.state === 'driving';
      for (const p of this.traffic.peds) {
        if (!p.placed || p.dead || !test(p.x, p.z)) continue;
        this.killPed(p, car.heading + (Math.random() - 0.5) * 0.8, speed * 0.55, byPlayer ? 'player' : 'npc');
        this.audio.sfx('punch', p.x, 0.8, p.z, { rate: 0.7 });
        if (byPlayer) this.camera.addShake(0.12);
      }
      for (const a of this.actors.actors) {
        if (a.dead || !test(a.x, a.z)) continue;
        this.actors.damage(a, speed * 7, sin * speed, cos * speed, 'vehicle');
        this.audio.sfx('punch', a.x, 0.8, a.z, { rate: 0.7 });
        if (byPlayer && a.team === 'police') this.crime(a.dead ? 'copKilled' : 'copHurt', a.x, a.z);
      }
    }
  }

  // ---- Death, arrest, respawn ----------------------------------------------------------------------------------------
  die(cause) {
    if (this.state === 'dead') return;
    this.health = 0;
    this.stats.deaths++;
    const p = this.person;
    if (this.state === 'driving') {
      const car = this.car;
      p.inVehicle = false;
      p.position.set(car.position.x + Math.cos(car.heading) * 1.6, this.controllers.getGroundHeight(car.position.x, car.position.z, 'person'), car.position.z - Math.sin(car.heading) * 1.6);
      this.onMode('person');
      p.rig.reset(p.position.x, p.position.z, p.heading, (c, x, z) => c.getGroundHeight(x, z, 'person'), this.controllers);
    }
    if (!p.rig.limp) {
      collapse(p.rig, { ground: (x, z) => this.controllers.getGroundHeight(x, z, 'person'), vx: p.rig.vx, vz: p.rig.vz,
        dirX: Math.sin(this.lastHitHeading ?? p.heading + Math.PI), dirZ: Math.cos(this.lastHitHeading ?? p.heading + Math.PI), cause: cause === 'explosion' ? 'explosion' : 'shot' });
    }
    this.transition = null;
    this.state = 'dead';
    this.stateT = 0;
    this.person.heading = this.person.heading || 0;
    document.body.classList.add('player-dead');
    document.body.dataset.gameState = this.state;
    this.hud.showBanner('VOUS ÊTES MORT', 'FLATLINED', cause === 'explosion' ? 'Emporté par l’explosion' : '', 5, 'dead');
    this.audio.ui('wasted');
    this.radio?.setPlaying(false);
    this.director.onPlayerDown('Vous êtes mort.');
  }

  busted() {
    if (this.state === 'dead' || this.state === 'busted') return;
    this.state = 'busted';
    this.stateT = 0;
    this.stats.busted++;
    this.person.rig.crouchTarget = 1;
    this.person.rig.handsUpTarget = 1;
    this.person.rig.aim = null;
    document.body.classList.add('player-busted');
    document.body.dataset.gameState = this.state;
    this.hud.showBanner('LA POLICE VOUS A EU', 'CUFFED', 'Arrêté', 5, 'busted');
    this.audio.ui('fail');
    this.director.onPlayerDown('Vous avez été arrêté.');
  }

  respawn() {
    const dead = this.state === 'dead';
    const list = dead ? HOSPITALS : PRECINCTS;
    let best = list[0], bd = Infinity;
    for (const h of list) {
      const d = Math.hypot(h.x - this.player.x, h.z - this.player.z);
      if (d < bd) { bd = d; best = h; }
    }
    const fee = Math.min(Math.round(this.money * 0.08), dead ? 1500 : 2500);
    this.money = Math.max(0, this.money - fee);
    this.hud.setMoney(this.money);
    this.rearm();
    this.wanted.reset();
    this.actors.clear((a) => a.dead || a.team === 'police');
    this.health = 100;
    if (dead) this.armor = 0;
    this.state = 'onFoot';
    this.stateT = 0;
    this.person.diveTime = -1;
    this.person.rig.crouchTarget = this.person.rig.handsUpTarget = 0;
    this.knock = null;
    this.invulnerable = 2;
    document.body.classList.remove('player-dead', 'player-busted');
    document.body.dataset.gameState = this.state;
    const spot = this.safeSpot(best.x, best.z, 0.5);
    this.teleportPlayer(spot.x, spot.z);
    this.toast(best.name, `${dead ? 'Soins' : 'Caution'} : ${fee.toLocaleString('fr-FR')} $ · armes conservées`);
    this.save();
  }

  // Back on the street with every weapon, ready to fire; a gun shot dry comes back with one magazine
  rearm() {
    for (const [id, slot] of Object.entries(this.weapons)) {
      const w = WEAPONS[id];
      if (w.melee || w.throwable) continue;
      if (slot.mag + slot.ammo === 0) slot.mag = w.mag;
      else { const take = Math.min(w.mag - slot.mag, slot.ammo); slot.mag += take; slot.ammo -= take; }
    }
    this.reloadT = 0;
    this.cooldown = 0;
  }

  teleportPlayer(x, z) {
    if (this.state === 'driving') {
      this.person.inVehicle = false;
      this.state = 'onFoot';
      this.onMode('person');
    }
    const p = this.person;
    p.position.set(x, this.controllers.getGroundHeight(x, z, 'person'), z);
    p.verticalVel = 0;
    p.rig.reset(x, z, p.heading, (c, px, pz) => c.getGroundHeight(px, pz, 'person'), this.controllers);
    this.camera.resetForTeleport();
    this.camera.initialized = false;
    document.body.dataset.gameState = this.state;
  }

  // A clear spot near (x, z) outside every building footprint
  safeSpot(x, z, radius = 0.6) {
    const clear = (px, pz) => {
      for (const c of this.controllers.nearColliders(px, pz, radius + 2)) {
        if ((c.minY ?? 0) > 2) continue;
        if (px < c.minX - radius || px > c.maxX + radius || pz < c.minZ - radius || pz > c.maxZ + radius) continue;
        if (c.polygon) { if (polygonContains(c.polygon, px, pz)) return false; continue; }
        if (c.obb) {
          const o = c.obb;
          const lx = (px - o.cx) * o.cs - (pz - o.cz) * o.sn, lz = (px - o.cx) * o.sn + (pz - o.cz) * o.cs;
          if (Math.abs(lx) < o.hx + radius && Math.abs(lz) < o.hz + radius) return false;
          continue;
        }
        return false;
      }
      return true;
    };
    if (clear(x, z)) return { x, z };
    for (let r = 1.5; r < 60; r += 1.5) {
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (clear(px, pz)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  // ---- Pickups -----------------------------------------------------------------------------------------------------
  placeWorldPickups() {
    const add = (kind, x, z, amount, respawn = 120) => {
      const s = this.safeSpot(x, z, 0.5);
      this.pickups.add(kind, s.x, s.z, { amount, respawn });
    };
    for (const h of HOSPITALS) add('health', h.x + 3, h.z, 100, 60);
    add('armor', -1398, streetZ(46) + 40, 100, 180);
    add('armor', 478, streetZ(20) + 30, 100, 180);
    add('pistol', 12, streetZ(41) + 40, 36, 240);
    add('pistol', -836, streetZ(48) + 40, 36, 240);
    add('smg', -1670, streetZ(26) + 30, 60, 300);
    add('shotgun', 1080, streetZ(36) + 40, 18, 300);
    add('shotgun', -296, streetZ(14) + 30, 18, 300);
    add('health', -296, streetZ(52) + 30, 50, 90);
    add('health', 633, streetZ(44) + 30, 50, 90);
    add('cash', 160, streetZ(34) + 20, 250, 600);
  }

  collect(item) {
    if (this.state !== 'onFoot') return false;
    const style = PICKUP_STYLE[item.kind];
    switch (item.kind) {
      case 'cash':
        this.addMoney(item.amount || 20);
        this.audio.ui('cash');
        return true;
      case 'health':
        if (this.health >= 100) return false;
        this.health = Math.min(100, this.health + (item.amount || 50));
        break;
      case 'armor':
        if (this.armor >= 100) return false;
        this.armor = Math.min(100, this.armor + (item.amount || 100));
        break;
      case 'package':
        item.collected = true;
        break;
      default:
        if (WEAPONS[item.kind]) this.giveWeapon(item.kind, item.amount || WEAPONS[item.kind].mag * 2);
    }
    this.audio.ui('checkpoint', 0.6);
    this.toast(style.label, item.kind === 'package' ? 'Récupéré' : WEAPONS[item.kind] ? `+${item.amount} munitions` : '');
    return true;
  }

  addMoney(amount) {
    this.money = Math.max(0, this.money + amount);
    this.hud.setMoney(this.money);
  }

  // ---- Entering & leaving vehicles -----------------------------------------------------------------------------------
  findCandidate() {
    const person = this.person;
    let best = null, nearest = 3.2;
    const consider = (car) => {
      if (car.destroyed || car.wreck || car.locked || !car.mesh.visible) return;
      const door = doorPosition(car);
      const d = Math.hypot(door.x - person.position.x, door.z - person.position.z);
      if (d < nearest && Math.abs(car.position.y - person.position.y) < 1 && Math.abs(car.speed) < 2) { best = { car, distance: d }; nearest = d; }
    };
    for (const car of this.fleet) consider(car);
    for (const u of this.wanted.units) if (u.active && u.mode === 'parked') consider(u.car);
    for (const source of this.traffic.cars) {
      if (!source.edge || Math.abs(source.speed) > 1.8 || source.isPolice) continue;
      const dx = source.x - person.position.x, dz = source.z - person.position.z;
      if (Math.hypot(dx, dz) > 5) continue;
      const proxy = { position: { x: source.x, z: source.z }, heading: source.yaw || 0 };
      const door = doorPosition(proxy);
      const d = Math.hypot(door.x - person.position.x, door.z - person.position.z);
      if (d < nearest) { best = { source, distance: d }; nearest = d; }
    }
    return best;
  }

  interact() {
    if (this.active && this.state === 'driving' && this.car.air && this.car.position.y > 3) { this.bailOut(); return; }
    if (!this.active || !canInteract(this.state, this.car.speed)) {
      if (this.state === 'driving') this.toast('Ralentissez', 'Arrêtez le véhicule pour descendre.');
      return;
    }
    if (this.state === 'driving') { this.beginExit(); return; }
    const candidate = this.findCandidate();
    if (!candidate) return;
    let car = candidate.car;
    if (car?.ai) car.ai = null; // a mission car the player takes over
    if (!car) {
      const source = candidate.source;
      const color = new THREE.Color().setRGB(...source.paint);
      car = this.makeCar(source.bodyType, color.getHex(), new THREE.Vector3(source.x, 0, source.z), source.yaw || 0);
      car.hp = Math.max(20, source.hp ?? 100);
      this.traffic.removeVehicle(source);
      if (this.policeNear(40) || this.wanted.level > 0) this.crime('carjack', source.x, source.z);
    } else if (car.police) {
      this.wanted.release(car);
      splitDoor(car);
      car.id = this.nextId++;
      car.drive = { ...car.drive };
      this.fleet.push(car);
      this.crime('carjack', car.position.x, car.position.z);
    }
    const person = this.person;
    this.controllers.resetInput();
    this.controllers.entities.car = car;
    const door = doorPosition(car);
    this.state = 'entering';
    this.transition = { time: 0, car, start: person.position.clone(), startHeading: person.heading, door, entering: true };
    this.ui['game-prompt'].classList.remove('visible');
    document.body.dataset.gameState = this.state;
    person.rig.aim = null;
    this.camera.aimMode = false;
  }

  // Out of the aircraft, under a canopy; the aircraft flies on by itself
  bailOut() {
    const car = this.car, p = this.person;
    const h = car.heading;
    if (car.mode === 'plane') car.throttle = 0;
    car.ridden = false;
    this.transition = null;
    p.inVehicle = false;
    p.position.set(car.position.x - Math.sin(h) * 1.5, car.position.y - 1.5, car.position.z - Math.cos(h) * 1.5);
    p.heading = h;
    p.speed = 0;
    p.verticalVel = -2;
    this.camera.footYaw = h;
    this.state = 'falling';
    this.onMode('person');
    this.radio?.setPlaying(false);
    document.body.dataset.gameState = this.state;
    this.audio.ui('pass');
    this.updateKeybar();
  }

  beginExit() {
    const car = this.car;
    let exit = null;
    for (const side of [1, -1]) {
      const door = doorPosition(car, side);
      const point = new THREE.Vector3(door.x + Math.cos(car.heading) * 0.35 * side, car.position.y, door.z - Math.sin(car.heading) * 0.35 * side);
      const candidates = this.controllers.nearColliders(point.x, point.z, 2);
      if (candidates.some(c => point.x > c.minX - 0.35 && point.x < c.maxX + 0.35 && point.z > c.minZ - 0.35 && point.z < c.maxZ + 0.35 && (c.minY ?? 0) < point.y + 1.8 && c.maxY > point.y + 0.2)) continue;
      exit = point; break;
    }
    if (!exit) { this.toast('Sortie bloquée', 'Déplacez la voiture pour dégager une portière.'); return; }
    this.controllers.resetInput(); car.speed = car.vx = car.vz = car.angularVel = 0;
    this.state = 'exiting';
    this.transition = { time: 0, car, exit, entering: false };
    document.body.dataset.gameState = this.state;
    this.radio?.setPlaying(false);
  }

  updateTransition(dt) {
    const t = this.transition;
    if (!t) return;
    t.time += dt;
    const p = this.person, car = t.car;
    const duration = t.entering ? 1.45 : 1.1;
    const u = t.time / duration;
    car.doorOpen = Math.sin(Math.PI * smooth(clamp(u, 0, 1))) * 1.05;
    if (t.entering) {
      const a = smooth(u / 0.5);
      p.position.x = THREE.MathUtils.lerp(t.start.x, t.door.x, a);
      p.position.z = THREE.MathUtils.lerp(t.start.z, t.door.z, a);
      p.heading = t.startHeading + angleDelta(t.startHeading, car.heading - Math.PI / 2) * a;
      if (u > 0.52) {
        const b = smooth((u - 0.52) / 0.28);
        p.position.x = THREE.MathUtils.lerp(t.door.x, car.position.x + Math.cos(car.heading) * 0.38, b);
        p.position.z = THREE.MathUtils.lerp(t.door.z, car.position.z, b);
        p.inVehicle = b > 0.55;
      }
    } else if (u > 0.32) {
      p.inVehicle = false;
      const b = smooth((u - 0.32) / 0.48);
      p.position.x = THREE.MathUtils.lerp(car.position.x + Math.cos(car.heading) * 0.8, t.exit.x, b);
      p.position.z = THREE.MathUtils.lerp(car.position.z, t.exit.z, b);
      p.position.y = this.controllers.getGroundHeight(p.position.x, p.position.z, 'person');
      p.heading = car.heading;
    }
    if (u >= 1) {
      car.doorOpen = 0; p.speed = 0; p.verticalVel = 0;
      if (t.entering) {
        p.inVehicle = true;
        car.fallen = false;
        car.ridden = true;
        this.state = 'driving'; this.onMode(car.mode || 'car');
        if (!car.stolen) { car.stolen = true; this.stolen++; }
        this.announce(car);
        this.firstEntry = false;
        this.camera.resetOrbit();
        this.radio?.setPlaying(true);
        this.showRadio();
      } else {
        p.inVehicle = false; p.position.copy(t.exit);
        car.ridden = false;
        p.position.y = this.controllers.getGroundHeight(p.position.x, p.position.z, 'person');
        this.state = 'onFoot'; this.camera.footYaw = car.heading;
        this.onMode('person');
      }
      this.transition = null;
      this.controllers.resetInput();
      document.body.dataset.gameState = this.state;
      this.updateKeybar(); this.save();
    }
  }

  announce(car) {
    const [brand, model] = CAR_NAMES[car.kind] || ['', 'VÉHICULE'];
    const hint = car.police ? 'Véhicule de police : ils ne vous lâcheront pas.' : car.mode === 'plane' ? 'Trop lent, il décroche : gardez de la vitesse.' : 'T : changer de radio';
    this.toast(car.label2 || `${brand} ${model}`, hint);
  }

  // ---- Frame -------------------------------------------------------------------------------------------------------
  beforeUpdate(dt) {
    if (!this.active) { this.controllers.resetInput(); return; }
    this.clock += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    // Wounds close slowly up to half health once out of harm's way
    if (this.state === 'onFoot' || this.state === 'driving') {
      if (this.health < 50 && this.clock - (this.lastHurt ?? -10) > 6) this.health = Math.min(50, this.health + dt * 2.5);
    }
    this.updateTransition(dt);
    if (this.state === 'driving') this.distance += Math.abs(this.car.speed) * dt;
    // Fallen poses for the protagonist's rig (posed by the controllers this frame)
    const p = this.person;
    if (this.state === 'dead' || this.state === 'busted' || this.state === 'down') {
      this.stateT += dt;
      if (this.state === 'dead') p.diveTime = Math.min(this.stateT * 1.3, 0.95);
      else if (this.state === 'down') {
        p.diveTime = this.stateT;
        if (this.stateT >= 2.45) { this.state = 'onFoot'; p.diveTime = -1; this.knock = null; document.body.dataset.gameState = this.state; }
      } else p.diveTime = -1;
      if ((this.state === 'dead' || this.state === 'busted') && this.stateT > 4.5) this.respawn();
    } else p.diveTime = -1;
  }

  update(dt) {
    this.atmosphere.update(dt, dt > 0);
    this.traffic.pedestrians.setRain(this.atmosphere.rain > 0.3);
    this.hud.setClock(this.atmosphere.clockLabel, this.atmosphere.weatherLabel, this.atmosphere.night > 0.5);
    // Pools stay drawn for the first frames so their pipelines compile behind the loading screen
    if (++this.frames === 5) {
      for (const w of this.wrecks) if (!w.burnT && !w.smokeT) w.mesh.visible = false;
      for (const ride of this.rides) if (!this.fleet.includes(ride)) ride.mesh.visible = false;
    }
    const falling = this.state === 'falling';
    if (this.frames >= 5) this.parachute.visible = falling;
    const walker = this.person;
    walker.chaseDistance = falling ? 13 : 4.3;
    walker.chaseHeight = falling ? 1.4 : 1.95;
    walker.cameraTargetOffset.y = falling ? 3.4 : this.footCameraY;
    this.collectCars();
    const person = this.person, car = this.car;
    const inVehicle = this.state === 'driving' || this.state === 'exiting' || (this.state === 'entering' && person.inVehicle);
    const pl = this.player;
    pl.inVehicle = inVehicle && !car.bicycle;
    pl.x = inVehicle ? car.position.x : person.position.x;
    pl.z = inVehicle ? car.position.z : person.position.z;
    pl.y = inVehicle ? car.position.y : person.position.y;
    pl.heading = inVehicle ? car.heading : person.heading;
    pl.speed = Math.abs(inVehicle ? car.speed : person.speed);
    pl.vx = inVehicle ? Math.sin(car.heading) * car.speed + (car.vx || 0) : 0;
    pl.vz = inVehicle ? Math.cos(car.heading) * car.speed + (car.vz || 0) : 0;
    pl.onFoot = this.state === 'onFoot' || this.state === 'down';
    pl.alive = this.state !== 'dead' && this.state !== 'busted';

    this.hero.setWeapon(this.weapon.melee || !pl.onFoot ? null : this.weaponId);
    for (const m of person.crowd.meshes) m.visible = false;
    this.hero.update(!person.inVehicle, 0, dt);

    if (dt > 0) {
      this.updateWeapons(dt);
      if (this.state === 'driving' && car.crashed) this.destroyCar(car);
      // Loose cars (parked, pushed, abandoned) roll to a stop under physics; then every gameplay car pair collides
      for (const c of this.allCars) {
        if (c === car && this.state === 'driving') continue;
        if (c.air) { this.flyAbandoned(c, dt); continue; }
        if (c.mode) continue;
        if (c.police && this.wanted.units.some((u) => u.car === c && u.active)) continue;
        if (c.ai && c !== car) continue; // mission AI drives it (mission-director.js)
        const moving = Math.abs(c.speed) > 0.05 || Math.abs(c.vx || 0) + Math.abs(c.vz || 0) > 0.05 || Math.abs(c.angularVel || 0) > 0.02;
        if (moving && !c.wreck) this.controllers.simulateCar(c, 0, 0, true, dt);
        else if (moving) {
          c.position.x += (c.vx || 0) * dt; c.position.z += (c.vz || 0) * dt;
          c.vx *= Math.exp(-3 * dt); c.vz *= Math.exp(-3 * dt); c.angularVel = 0; c.speed = 0;
          this.controllers.resolveHorizontalCollision(c.position, 1.35, c);
        }
        if (!moving) { c.prevX = c.position.x; c.prevZ = c.position.z; }
      }
      const cars = this.allCars;
      for (let i = 0; i < cars.length; i++) {
        if (!cars[i].mesh.visible) continue;
        for (let j = i + 1; j < cars.length; j++) if (cars[j].mesh.visible) this.collideCars(cars[i], cars[j]);
      }
      this.runOver();
      this.actors.update(dt, { target: pl, world: this.world, camera: this.camera.camera });
      this.wanted.update(dt, pl);
      this.updateCarDamage(dt);
      this.pickups.update(dt, (x, z) => this.controllers.getGroundHeight(x, z, 'person'), person.position.x, person.position.y, person.position.z, (it) => this.collect(it));
      this.director.update(dt);
      this.shops.update(dt);
      this.updateGps(dt);
    }
    this.fx.update(dt, (x, z) => this.controllers.getGroundHeight(x, z, 'person'));
    this.markers.update((x, z) => this.controllers.getGroundHeight(x, z, 'person'));

    // Traffic and audio see the cruisers and the parked fleet as solid, sounding cars
    const extra = this.traffic.extraBodies;
    extra.length = 0;
    for (const c of this.allCars) if ((c !== car || this.state !== 'driving') && c.position.y < 3) extra.push(c);
    const sounding = this.audio.sources?.extraVehicles;
    if (sounding) { sounding.length = 0; for (const c of this.wanted.cars) sounding.push(c); }

    for (const vehicle of this.allCars) {
      if (vehicle.door) vehicle.door.rotation.y = -vehicle.doorOpen;
      vehicle.mesh.position.copy(vehicle.position); vehicle.mesh.rotation.y = vehicle.heading;
      if (vehicle.moto) poseMotorbike(vehicle, dt, vehicle === car && this.state === 'driving' && this.controllers.keys.sprint);
      vehicle.mesh.updateMatrixWorld();
    }
    // On two wheels the protagonist stays in view, posed on the seat
    if (person.inVehicle && car.moto) {
      person.rig.ride(car.chassisPivot, 1.1, { seat: car.seat, bars: car.bars, gripHalf: 0.33, bracket: car.pegs, crankLength: 0.02 });
      this.hero.setWeapon(null);
      this.hero.update(true, 0, dt);
    } else if (person.inVehicle && car.bicycle) {
      person.rig.ride(car.leanPivot, car.pedalPhase, car.bikeFrame);
      this.hero.setWeapon(null);
      this.hero.update(true, 0, dt);
    }
    if (this.state === 'falling') {
      this.parachute.position.set(person.position.x, person.position.y + 5.2, person.position.z);
      this.parachute.rotation.y = person.heading;
      this.parachute.updateMatrixWorld(true);
    }
    this.garage.update();
    this.arsenal.update();
    if (this.clock - this.lastSave > 5) { this.lastSave = this.clock; this.save(); }
    const keybarKey = this.state + this.weaponId + (this.car.moto ? 'm' : '') + (this.car.mode || '');
    if (this.keybarState !== keybarKey) { this.keybarState = keybarKey; this.updateKeybar(); }
    this.updatePrompt();
    this.updateHud(dt);
    this.radio?.update();
  }

  updatePrompt() {
    const car = this.car;
    this.candidate = this.state === 'onFoot' && this.active ? this.findCandidate() : null;
    const prompt = this.ui['game-prompt'];
    const airborne = this.state === 'driving' && car.air && car.position.y > 3;
    const showExit = this.state === 'driving' && this.active && (airborne || Math.abs(car.speed) < 1.5);
    prompt.classList.toggle('visible', Boolean(this.candidate || showExit));
    const span = prompt.querySelector('span');
    if (this.candidate) {
      const target = this.candidate.car;
      const kind = target?.kind || this.candidate.source.bodyType;
      const [brand, model] = CAR_NAMES[kind] || ['', 'VÉHICULE'];
      const owned = target && (target.stolen || target.mission) && !target.police;
      span.replaceChildren(document.createTextNode(owned ? 'Monter dans le véhicule' : target?.police ? 'Voler la voiture de police' : 'Voler la voiture'));
      const small = document.createElement('small'); small.textContent = `${brand} ${model}`;
      span.append(small);
    } else if (showExit) {
      span.replaceChildren(document.createTextNode(airborne ? 'Sauter en parachute' : 'Descendre du véhicule'));
      const small = document.createElement('small'); small.textContent = airborne ? 'EN VOL' : 'VÉHICULE À L’ARRÊT';
      span.append(small);
    }
  }

  updateHud(dt) {
    const car = this.car;
    this.ui['stamina-fill'].style.transform = `scaleX(${this.stamina / 100})`;
    const speed = Math.round(Math.abs(car.speed) * 3.6);
    this.ui['drive-speed'].textContent = String(speed).padStart(3, '0');
    this.ui['drive-gear'].textContent = car.air ? `${Math.round(car.position.y)} M` : car.speed < -0.2 ? 'R' : speed < 1 ? 'N' : String(Math.min(6, 1 + Math.floor(speed / 29)));
    this.ui['drive-power'].style.transform = `scaleX(${clamp(Math.abs(car.speed) / (car.drive?.speed || 40), 0, 1)})`;
    const health = this.ui['drive-health'];
    if (health) { health.style.transform = `scaleX(${(car.hp ?? 100) / 100})`; health.classList.toggle('low', (car.hp ?? 100) < 35); }
    const name = this.ui['vehicle-name'];
    const [brand, model, sub] = CAR_NAMES[car.kind] || ['', 'VÉHICULE', ''];
    name.querySelector('strong').textContent = car.policeLivery ? 'INTERCEPTEUR' : model;
    name.querySelector('span').textContent = car.policeLivery ? 'POLICE' : brand;
    name.querySelector('small').textContent = sub;
    this.ui['session-mode'].textContent = this.director.current ? 'MISSION' : this.wanted.level ? 'RECHERCHÉ' : 'LIBRE';
    this.hud.setVitals(this.health, this.armor);
    const lvl = this.wanted.level;
    this.hud.setWanted({ level: lvl, name: WANTED_LEVELS[lvl].name, seen: this.wanted.seen, escape: this.wanted.escape });
    this.hud.setArrest(this.wanted.arrest / 1.6);
    this.hud.update(dt);
  }

  // ---- Saving ------------------------------------------------------------------------------------------------------
  save() {
    if (this.resetting || this.transition || this.state === 'dead' || this.state === 'busted') return;
    try {
      const p = this.person;
      const fleet = this.fleet.filter((c) => !c.mission && !c.destroyed && !c.mode && !c.pooled);
      // Rides are not saved: the next session starts on foot, under wherever they were
      const spot = this.state === 'falling' || (this.state === 'driving' && (this.car.mode || this.car.pooled)) ? this.safeSpot(p.position.x, p.position.z, 0.5) : p.position;
      const data = {
        version: 2, state: this.state === 'driving' && fleet.includes(this.car) ? 'driving' : 'onFoot',
        player: { x: spot.x, y: spot === p.position ? p.position.y : this.controllers.getGroundHeight(spot.x, spot.z, 'person'), z: spot.z, heading: p.heading },
        active: fleet.indexOf(this.car), stolen: this.stolen, distance: this.distance, firstEntry: this.firstEntry,
        money: this.money, health: this.health, armor: this.armor, weapons: this.weapons, weaponId: this.weaponId,
        missionsDone: this.missionsDone, stats: this.stats, radio: this.radio?.stationIndex ?? this.radioIndex,
        atmosphere: this.atmosphere.serialize(), safehouses: this.shops?.serialize(), worldBikes: !!this.worldBikesPlaced,
        fleet: fleet.map(car => ({ kind: car.kind, paint: car.paint, position: { x: car.position.x, y: car.position.y, z: car.position.z }, heading: car.heading, stolen: car.stolen, hp: car.hp }))
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch { /* Private browsing must not prevent playing. */ }
  }

  restore() {
    try {
      let data = JSON.parse(localStorage.getItem(SAVE_KEY));
      for (const key of LEGACY_SAVE_KEYS) data ??= JSON.parse(localStorage.getItem(key));
      if (!data || (data.version !== 1 && data.version !== 2) || !validPosition(data.player) || !Array.isArray(data.fleet) || data.fleet.length > FLEET_MAX) return;
      if (!data.fleet.every(c => PROFILES[c.kind] && validPosition(c.position) && Number.isFinite(c.heading) && Number.isInteger(c.paint))) return;
      if (data.fleet.length) {
        for (const car of this.fleet) car.mesh.removeFromParent();
        this.fleet = [];
        for (const c of data.fleet) {
          const car = this.makeCar(c.kind, c.paint, new THREE.Vector3(c.position.x, c.position.y, c.position.z), c.heading, !!c.stolen);
          if (Number.isFinite(c.hp)) car.hp = clamp(c.hp, 15, 100);
        }
      }
      const p = this.person;
      p.position.set(data.player.x, data.player.y, data.player.z);
      p.heading = Number.isFinite(data.player.heading) ? data.player.heading : 0;
      this.camera.footYaw = p.heading;
      this.controllers.entities.car = this.fleet[clamp(data.active | 0, 0, this.fleet.length - 1)];
      this.state = data.state === 'driving' && data.active >= 0 ? 'driving' : 'onFoot';
      this.distance = Number.isFinite(data.distance) ? Math.max(0, data.distance) : 0;
      this.stolen = Number.isFinite(data.stolen) ? Math.max(0, data.stolen) : 0;
      this.firstEntry = data.firstEntry !== false;
      if (data.version === 2) {
        this.money = Number.isFinite(data.money) ? Math.max(0, data.money) : 0;
        this.health = Number.isFinite(data.health) ? clamp(data.health, 20, 100) : 100;
        this.armor = Number.isFinite(data.armor) ? clamp(data.armor, 0, 100) : 0;
        if (data.weapons && typeof data.weapons === 'object') {
          for (const [id, slot] of Object.entries(data.weapons)) {
            if (WEAPONS[id] && slot && Number.isFinite(slot.mag) && Number.isFinite(slot.ammo)) {
              this.weapons[id] = { mag: clamp(slot.mag | 0, 0, WEAPONS[id].mag || 0), ammo: clamp(slot.ammo | 0, 0, 9999) };
            }
          }
        }
        if (this.weapons[data.weaponId]) this.weaponId = data.weaponId;
        if (Array.isArray(data.missionsDone)) this.missionsDone = data.missionsDone.filter((id) => typeof id === 'string');
        if (data.stats) for (const k of Object.keys(this.stats)) if (Number.isFinite(data.stats[k])) this.stats[k] = data.stats[k];
        if (Number.isInteger(data.radio)) this.radioIndex = data.radio;
        this.atmosphere.restore(data.atmosphere);
        this.savedShops = data.safehouses;
        this.worldBikesPlaced = !!data.worldBikes;
      }
    } catch { /* An old or corrupted save falls back to a fresh session. */ }
  }

  reset() {
    this.resetting = true; // the unload that follows must not write the old game back
    try { for (const key of [SAVE_KEY, ...LEGACY_SAVE_KEYS]) localStorage.removeItem(key); } catch { /* storage optional */ }
    location.reload();
  }
}

export { Game as Playground };
