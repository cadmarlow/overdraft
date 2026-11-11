import * as THREE from 'three/webgpu';
import { highwayX, highwayScale } from './highway-layout.js';
import { ISLAND_BOUNDS, getIslandBoundsAtZ, streetZ, isTypingInField, districtAt, getLocationLabel } from './city-config.js';
import { angleDelta, doorPosition, smooth, clamp, canInteract, validPosition } from './interaction-state.js';
import { CharacterModel, LOOKS } from './characters.js';
import { EffectsSystem } from './fx.js';
import { WEAPONS, WEAPON_ORDER, HANDLING, gunSpread, gunDamage, sightOrigin, muzzleObstruction, stockArsenal, castShot, spreadDirection, lineOfSight, raycastBuildings } from './weapons.js';
import { MOD_GUNS, effectiveWeapon, withMod, fits, finishById, sanitizeMods } from './weapon-mods.js';
import { AimAssist } from './aim-assist.js';
import { createWeaponModel } from './weapon-models.js';
import { Vertical } from './vertical.js';
import { RoofPolice } from './roof-police.js';
import { SkyRings } from './missions-sky.js';
import { ActorSystem } from './actors.js';
import { WantedSystem, WANTED_LEVELS } from './wanted.js';
import { RoadNavigator } from './navigation.js';
import { HOSPITALS, PRECINCTS, MarkerSystem, PickupSystem, PICKUP_STYLE } from './missions.js';
import { MissionDirector } from './mission-director.js';
import { GameHud } from './hud.js';
import { DriveInstruments } from './drive-instruments.js';
import { STACKED, vehicleContact, resolveVehicleContact, sweptVehicleContact } from './vehicle-physics.js';
import { polygonContact } from './building-collision.js';
import { RadioSystem, STATIONS } from './radio.js';
import { Atmosphere } from './atmosphere.js';
import { ShopSystem } from './shops.js';
import { createMotorbike, poseMotorbike } from './motorbike.js';
import { PauseMenu, pauseMenuMarkup } from './pause-menu.js';
import { stepPlane } from './flight.js';
import { Garage } from './garage.js';
import { collapse } from './ragdoll.js';
import { Arsenal } from './arsenal.js';
import { carSpecs } from './car-assets.js';
import { CAR_CATALOG, CAR_NAMES as FLEET_NAMES } from './car-catalog.js';
import { popBody, settleBody, shuntBody } from './car-physics.js';
import { driverPose } from './car-cabin.js';
import { carFrame, planEntry, planExit, sampleEntry, sampleExit, createSample, stations as entryStations, REST_WHEEL, restPedals, lerp, FAST as ENTRY_FAST } from './vehicle-entry.js';
import { DriveEffects, FallingLamps } from './drive-fx.js';
import { StuntScore } from './stunts.js';
import { GangSystem } from './gangs.js';
import { Phone } from './phone.js';
import { ramps } from './ramps.js';
import { WATER, createBoat, driveBoatAI } from './boat.js';

// OVERDRAFT — the game layer over the city simulation: the protagonist on foot and at the wheel, weapons and
// damage, vehicles that smoke, burn and explode, the wanted level (police), missions, money, death and arrest, and saving.

const SAVE_KEY = 'overdraft:save:2';
// Saves from before the rename (0.2 preview, 0.1 playground) are still read
const LEGACY_SAVE_KEYS = ['contre-maree:save:2', 'contre-maree:playground:1'];
const BUILD = '0.9.21';
const BUILD_NAME = 'Clearing';
const INTRO_KEY = 'overdraft:intro'; // the build whose opening flight has been seen
// The neighbourhoods as the opening card names them (city-config.js districtAt)
const DISTRICT_NAMES = {
  central_park: 'Central Park', morningside: 'Morningside Heights', east_harlem: 'East Harlem', harlem: 'Harlem', uws: 'Upper West Side',
  ues: 'Upper East Side', hudson_yards: 'Hudson Yards', hells_kitchen: 'Hell’s Kitchen', turtle_bay: 'Turtle Bay', billionaires_row: 'Billionaires’ Row',
  garment: 'Garment District', times_square: 'Times Square', theater_district: 'Theater District', koreatown: 'Koreatown', plaza_district: 'Plaza District',
  murray_hill: 'Murray Hill', kips_bay: 'Kips Bay', midtown: 'Midtown', chelsea: 'Chelsea', west_chelsea: 'West Chelsea', flatiron: 'Flatiron',
  gramercy: 'Gramercy', stuytown: 'Stuyvesant Town', meatpacking: 'Meatpacking District', west_village: 'West Village', greenwich_village: 'Greenwich Village',
  east_village: 'East Village', alphabet_city: 'Alphabet City', noho: 'NoHo', soho: 'SoHo', hudson_square: 'Hudson Square', nolita: 'Nolita',
  lower_east_side: 'Lower East Side', chinatown: 'Chinatown', little_italy: 'Little Italy', tribeca: 'Tribeca', civic_center: 'Civic Center',
  two_bridges: 'Two Bridges', financial_district: 'Financial District', fidi: 'Financial District', battery_park_city: 'Battery Park City', seaport: 'South Street Seaport',
  stuy_town: 'Stuyvesant Town', village: 'Greenwich Village'
};
const districtName = (id) => DISTRICT_NAMES[id] || (id ? id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Manhattan');
const CAR_NAMES = {
  ...FLEET_NAMES,
  moto: ['BRISANT', 'VANDALE 650', 'MOTO / SPORTIVE'], boat: ['HAUTURIER', 'MOUETTE', 'HORS-BORD / BIMOTEUR'],
  bicycle: ['COURSIER', 'VÉLO', 'VÉLO / URBAIN'], helicopter: ['GRÉVILLE', 'LIBELLULE', 'HÉLICOPTÈRE / BITURBINE'],
  plane: ['HAUTURIER', 'STERNE', 'AVION / MONOMOTEUR']
};
const FLEET_MAX = 12;
const WHEEL_STEP = 12; // pixels of scrolling to the next weapon
const WHEEL_GESTURE_GAP = 160; // ms without a scroll event that ends a gesture
const EJECT_ALTITUDE = 20; // a crash above this throws the pilot clear, under a canopy
// Health a car loses to a crash at this closing speed (m/s): nothing at a parking knock, a few points at 50 km/h, about a
// tenth at 90, a quarter at 130, half at 200. A car survives a good chase; it is bullets and blasts that set it alight.
const crashDamage = (speed) => 0.17 * Math.max(0, speed - 9) ** 1.5;
const IDLE_STICK = { pitch: 0, roll: 0, throttle: 0 };
const WRECK_MAX = 6; // burnt-out vehicles left standing at once: the oldest goes when a seventh burns
const WRECKS_PER_KIND = 2; // of one model
const DEBUG = new URLSearchParams(location.search).has('debug');

function splitDoor(car) {
  const original = car.bodyMesh.geometry;
  const positions = original.attributes.position;
  const ids = original.index?.array || Uint32Array.from({ length: positions.count }, (_, i) => i);
  const door = [], body = [];
  const front = car.spec.doors[0], rear = car.spec.doors[1], hingeX = car.spec.halfW * 0.92, top = car.spec.height * 0.92;
  for (let i = 0; i < ids.length; i += 3) {
    const vertices = [ids[i], ids[i + 1], ids[i + 2]];
    const x = vertices.reduce((n, id) => n + positions.getX(id), 0) / 3;
    const y = vertices.reduce((n, id) => n + positions.getY(id), 0) / 3;
    const z = vertices.reduce((n, id) => n + positions.getZ(id), 0) / 3;
    (x > car.spec.halfW * 0.5 && z < front && z > rear && y > 0.29 && y < top ? door : body).push(...vertices);
  }
  const shell = original.clone(); shell.setIndex(body);
  car.bodyMesh.geometry = shell;
  const geometry = original.clone(); geometry.setIndex(door);
  const hinge = new THREE.Group();
  hinge.position.set(hingeX, 0, front);
  const mesh = new THREE.Mesh(geometry, car.bodyMesh.material);
  mesh.position.set(-hingeX, 0, -front);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.material.side = THREE.DoubleSide;
  hinge.add(mesh); (car.bodyPivot ?? car.chassisPivot).add(hinge);
  car.door = hinge; car.doorOpen = 0;
  // A cabin laid out from the glass has its own seats (car-cabin.js)
  if (car.cabin) return;
  const interior = new THREE.MeshStandardNodeMaterial({ color: 0x14181a, roughness: 0.92 });
  for (const side of [-1, 1]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.18, 0.5), interior);
    seat.position.set(side * 0.4, 0.5, -0.15);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.53, 0.12), interior);
    back.position.set(side * 0.4, 0.78, -0.4); back.rotation.x = -0.15;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.13), interior);
    head.position.set(side * 0.4, 1.08, -0.43);
    (car.bodyPivot ?? car.chassisPivot).add(seat, back, head);
  }
}

const _v = new THREE.Vector3();
// Getting into a car (vehicle-entry.js): the seat point the body is posed on, under the car's body, and the pose it is
// given there (PersonRig.drive); a point in the car's frame
const _entryRoot = new THREE.Object3D();
const _entryPose = { seat: new THREE.Vector3(), wheel: new THREE.Vector3(), pedals: new THREE.Vector3(), radius: 0.18, tilt: 0.42, turn: 0, recline: 0, look: 0 };
const _lp = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _camDir = new THREE.Vector3();
// what a shot hands to the effects, reused from one shot to the next
const _port = new THREE.Vector3();
const _gunRight = new THREE.Vector3();
const _gunUp = new THREE.Vector3();
const _barrel = new THREE.Vector3();
const _flashOpts = { id: 'player', vx: 0, vy: 0, vz: 0 };
// CALIBRE on the maps: a pistol seen from the side, in a 24-unit box (the trigger guard is cut out by the even-odd rule)
const GUN_BLIP = typeof Path2D === 'function' ? new Path2D('M2 6h18.5v1H22v2.6h-1.5v1h-6.8a3 3 0 0 1-3 3H9.1L7.9 19H2.3l1.1-6.4L2 10.6zM10.3 11v1.4h1.1a1.5 1.5 0 0 0 1.5-1.4z') : null;
const _casingOpts = { port: _port, right: _gunRight, up: _gunUp };
const _hitOpts = { dir: { x: 0, y: 0, z: 0 } };
const _wallHit = {};
const _noDecal = { decal: false }; // an impact on something that moves or falls leaves no mark hanging in the air
const bodyA = {}, bodyB = {}, hit = {};

export class Game {
  constructor({ controllers, camera, traffic, highway, streets, scene, onMode, onTime, audio, map, touch, gamepad, lighting, grade, parking = null }) {
    this.parking = parking;
    this.buildVersion = BUILD;
    Object.assign(this, { controllers, camera, traffic, streets, scene, onMode, onTime, audio, map, touch, gamepad });
    this.atmosphere = new Atmosphere({ lighting, grade, scene, camera: camera.camera, controllers });
    this.state = 'onFoot'; this.playing = false; this.paused = false;
    this.transition = null; this.candidate = null; this.stamina = 100;
    this.distance = 0; this.stolen = 0; this.clock = 0; this.fleet = [];
    this.nextId = 1; this.lastSave = 0; this.firstEntry = true;
    this.health = 100; this.armor = 0; this.money = 0;
    this.weapons = { fists: { mag: 0, ammo: 0 } };
    this.weaponId = 'fists';
    this.mods = {}; // upgrades and finishes bought at CALIBRE, per weapon (weapon-mods.js)
    this.range = { medals: {}, best: {} }; // CALIBRE's shooting range, per weapon: medals 0..3, best score (calibre-range.js)
    this.missionsDone = [];
    this.stats = { kills: 0, shots: 0, cops: 0, cars: 0, explosions: 0, deaths: 0, busted: 0 };
    this.fireHeld = false; this.firePressed = false; this.aimHeld = false;
    this.aimToggle = false; this.triggerBuffer = 0; this.bloom = 0; this.combatReadyT = 0; this.hipT = 0; this.strafeT = 0; this.threatT = 0; this.threatNear = false;
    this.autoReloadT = 0; this.shotsInBurst = 0; this.lastGunShot = -10;
    this.cooldown = 0; this.reloadT = 0; this.punchT = 0; this.punchHit = false;
    this.spread = 0; this.lastCrimeShot = -10; this.stateT = 0; this.invulnerable = 0;
    this.allCars = [];
    this.timeScale = 1;
    this.slowMo = 0;
    this.wheelSlow = 0;
    this.slowAgain = 0;
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
    this.footCameraY = controllers.entities.person.cameraTargetOffset.y;
    controllers.entities.car.mesh.removeFromParent();

    this.nav = new RoadNavigator(traffic.network);
    this.fx = new EffectsSystem(scene, camera.camera);
    this.driveFx = new DriveEffects(scene, this.fx);
    this._shotFrom = new THREE.Vector3(); this._shotTo = new THREE.Vector3(); this._shotDir = new THREE.Vector3();
    this.fallingLamps = new FallingLamps(scene, streets.lampParts);
    this.stunts = new StuntScore(this);
    this.gangs = new GangSystem(this);
    this.phone = new Phone(this);
    this.debt = 250000;
    this.highway = highway;
    this.boatWorld = {
      afloat: (x, z) => controllers.afloat(x, z),
      simulate: (c, throttle, steer, dt) => controllers.simulateCar(c, throttle, steer, false, dt),
      shoot: (x, y, z, accuracy, damage) => this.policeShot(x, y, z, accuracy, damage)
    };
    traffic.setTakedownListener((v, kind, colour, body, hit) => this.takedown(v, kind, colour, body, hit));
    this.actors = new ActorSystem({ scene, controllers, fx: this.fx, audio });
    this.actors.onShot = (h, damage, shooter) => this.applyShot(h, damage, shooter);
    this.actors.onKilled = (actor, cause) => this.onActorKilled(actor, cause);
    this.actors.onBark = (text) => { if (!this.director.current) this.hud.say('POLICE', text, 2.4); };
    this.actors.onArrest = (dt) => { if (this.wanted.level <= 1 && !this.player.threat) this.wanted.arrestProgress(dt); };
    traffic.pedestrians.setGround((x, z) => controllers.getGroundHeight(x, z, 'person'));
    this.wanted = new WantedSystem({ scene, controllers, nav: this.nav, actors: this.actors, audio, camera: camera.camera });
    this.wanted.onLevel = (level, previous) => this.onWantedLevel(level, previous);
    this.wanted.onBusted = () => this.busted();
    this.wanted.onPoliceShot = (x, y, z, accuracy, damage) => this.policeShot(x, y, z, accuracy, damage);
    this.wanted.onStrip = () => this.burstTyres();
    this.wanted.trafficCars = traffic.vehicles;
    this.wanted.traffic = traffic;
    this.wanted.gameCars = this.allCars;
    this.markers = new MarkerSystem(scene);
    this.pickups = new PickupSystem(scene);
    this.world = { controllers, traffic, cars: this.allCars, actors: this.actors.actors, player: this.player, parking };
    // A parked car driven into: it becomes a car of its own and takes the blow through the car-to-car collisions
    controllers.onParkedHit = (c, car) => this.hitParked(c, car);
    // What a fire leaves of a vehicle is that vehicle: a taxi burns down to a taxi, a bus to a bus. One wreck of every
    // model waits out of sight from the start, so its pipelines compile behind the loading screen (see update()).
    this.wrecks = [];
    this.wreckKinds = [...CAR_CATALOG.map((c) => c.kind), 'bus']; // every model that can burn: the fifteen cars and the city bus
    for (const kind of this.wreckKinds) this.makeWreck(kind);

    this.spawnFleet();
    // Keep the sandbox starter kit, but a saved inventory replaces it without refilling purchased ammunition.
    stockArsenal(this.weapons);
    this.restore();
    // The garage's own car and motorbike, built now so that summoning them never stalls a frame
    for (const [kind, paint] of [...CAR_CATALOG.map(c => [c.kind, c.paint]), ['moto', 0xc81e2a], ['boat', 0x0c1f33]]) {
      const car = this.makeCar(kind, paint, new THREE.Vector3(), 0, true, false, true);
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
    this.syncLoadout();
    // Vehicles as the on-foot camera sees them: boxes it must stay out of
    const pool = [], boxes = [];
    this.camera.vehicleObstacles = (origin, range) => {
      boxes.length = 0;
      const box = (x, z, yaw, hw, hl, y0, y1) => {
        if (Math.hypot(x - origin.x, z - origin.z) > range + hl) return;
        const b = pool[boxes.length] ??= { obb: {} };
        boxes.push(b);
        b.minY = y0; b.maxY = y1;
        const o = b.obb; o.cx = x; o.cz = z; o.cs = Math.cos(yaw); o.sn = Math.sin(yaw); o.hx = hw; o.hz = hl;
      };
      for (const v of this.traffic.vehicles) if (v.edge) box(v.x, v.z, v.yaw + v.yawOffset, v.halfWidth, v.halfL ?? v.half, 0.1, v.bus ? 3.1 : 1.6);
      for (const c of this.allCars) if (c.mesh.visible && !c.bicycle && !c.moto) box(c.position.x, c.position.z, c.heading, c.halfW ?? 0.9, c.halfL ?? 2.2, (c.position.y || 0) + 0.1, (c.position.y || 0) + 1.6);
      return boxes;
    };
    // smoke and dust are lit by the sun where it reaches them
    this.fx.sunlit = (x, y, z) => this.atmosphere.sunReaches(x, y, z, this.atmosphere.params.sunDir);
    // brass on the pavement: the first bounces of each case are heard
    this.fx.onCasingBounce = (x, y, z, kind, speed) => {
      if (speed > 0.7) this.audio.sfx('impactMetal', x, y, z, { intensity: Math.min(0.22, speed * 0.07), rate: (kind === 'shotgun' ? 1.5 : 2.5) + Math.random() * 0.7 });
    };
    this.aimAssist = new AimAssist();
    try { this.aimAssist.enabled = localStorage.getItem('overdraft:aimAssist') !== '0'; } catch { /* storage optional */ }
    this.assistTargets = [];
    this.vertical = new Vertical(this);
    this.roofPolice = new RoofPolice(this);
    this.skyRings = new SkyRings(scene);
    this.director = new MissionDirector(this);
    this.shops = new ShopSystem(this);
    this.arsenal = new Arsenal(this);
    this.garage = new Garage(this);
    this.architect = null; // local development only, attached by main.js (ARCHITECTE.md)
    this.shops.restore(this.savedShops);
    this.shops.place();
    this.placeWorldPickups();
    this.placeWorldBikes();
    this.setupRadio();
    this.setupMap();
    this.setupCollisions();
    this.jets = []; // broken hydrants
    controllers.onPropHit = (prop, car) => this.knockProp(prop, car);
    this.applyTestSpawn();
    if (new URLSearchParams(location.search).has('qa')) window.__playground = window.__game = this;
    // The title menu looks down the avenue from the air, over the player; the opening flight lands from there
    this.intro = false;
    if (!this.playing) {
      const p = this.person.position, s = Math.sin(this.person.heading), c = Math.cos(this.person.heading);
      this.camera.setMenuView(
        new THREE.Vector3(p.x - s * 330 - c * 40, 118, p.z - c * 330 + s * 40),
        new THREE.Vector3(p.x - s * 150 + c * 30, 96, p.z - c * 150 - s * 30),
        new THREE.Vector3(p.x + s * 230, 90, p.z + c * 230)
      );
    }
  }

  // An explicit local test link starts at the reported FDR facade after restoring the player's progression.
  // The garage uses an already compiled car; this practice session never writes over the regular save.
  applyTestSpawn() {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ||
      new URLSearchParams(location.search).get('spawn') !== 'fdr') return;
    this.testSpawn = true;
    const z = 1020, x = highwayX(false, z) + 5.55 * highwayScale(false, z);
    const heading = Math.atan2(highwayX(false, z - 3) - highwayX(false, z + 3), -6);
    this.teleportPlayer(x - 12, z + 12);
    this.person.heading = this.camera.footYaw = heading;
    this.garage.summon('hatch');
    this.controllers.teleportActiveTo(x, z, heading);
    this.person.position.copy(this.car.position);
    this.camera.resetForTeleport();
    this.camera.initialized = false;
    this.atmosphere.setHour(12);
    this.atmosphere.setWeather('clear', true);
    this.atmosphere.running = false;
    this.atmosphere.lockWeather = true;
  }

  // ---- The opening ------------------------------------------------------------------------------------------------------
  // From the menu's aerial view down to Sacha in one flight: the long one for a new game (over the avenue, then a low
  // pass down the street to his back), a short dive when coming back to a game
  playIntro(long) {
    const p = this.person, cam = this.camera;
    const yaw = p.heading, s = Math.sin(yaw), c = Math.cos(yaw);
    const head = new THREE.Vector3(p.position.x, p.position.y + 1.5, p.position.z);
    const keys = [{ pos: cam.currentPos.clone(), look: cam.currentLookAt.clone(), fov: cam.camera.fov }];
    // the approach comes down over the roadway (to the right of a sidewalk on the left of its street), clear of the
    // sheds and tree crowns along the curb
    const road = Math.sign(-p.position.x * c) || 1;
    if (long) {
      keys.push({ pos: new THREE.Vector3(p.position.x - s * 110 + c * road * 12, p.position.y + 74, p.position.z - c * 110 - s * road * 12), look: head.clone() });
      keys.push({ pos: new THREE.Vector3(p.position.x - s * 26 + c * road * 7, p.position.y + 11.5, p.position.z - c * 26 - s * road * 7), look: head.clone() });
    } else keys.push({ pos: new THREE.Vector3(p.position.x - s * 14 + c * road * 4, p.position.y + 26, p.position.z - c * 14 - s * road * 4), look: head.clone() });
    keys.push({ pos: new THREE.Vector3(p.position.x - s * 4.3, p.position.y + 2.2, p.position.z - c * 4.3), look: new THREE.Vector3(p.position.x + s * 0.7, p.position.y + 1.55, p.position.z + c * 0.7), fov: 56 });
    cam.menuDolly = null;
    cam.setCameraPreset('chase', false);
    cam.footYaw = yaw;
    cam.resetOrbit();
    this.intro = true;
    document.body.classList.add('in-intro');
    cam.playCinematic(keys, long ? 9.5 : 4.2, () => this.endIntro());
    if (long) this.showIntroCard();
  }

  showIntroCard() {
    const card = this.ui['intro-card'];
    if (!card) return;
    const p = this.person.position;
    card.querySelector('strong').textContent = districtName(districtAt(p.x, p.z));
    card.querySelector('em').textContent = `${getLocationLabel(p.x, p.z).replace(' · ', ' — ')} · ${this.atmosphere.clockLabel}`;
    clearTimeout(this.cardShow); clearTimeout(this.cardHide);
    this.cardShow = setTimeout(() => card.classList.add('visible'), 1800);
    this.cardHide = setTimeout(() => card.classList.remove('visible'), 7200);
  }

  endIntro() {
    if (!this.intro) return;
    this.intro = false;
    document.body.classList.remove('in-intro');
    clearTimeout(this.cardShow); clearTimeout(this.cardHide);
    this.ui['intro-card']?.classList.remove('visible');
    this.camera.skipCinematic();
    if (!this.missionsDone.length) {
      this.hud.say('', 'New York. Toute dette finit par se payer.', 4);
      this.toast('Bienvenue, Sacha', 'Rejoignez le marqueur vert : Mireille a du travail pour vous.');
    } else this.toast('Retour à Manhattan', `${this.missionsDone.length} mission(s) accomplie(s). Le marqueur vert indique la suite.`);
  }

  get active() { return this.playing && !this.paused && !this.modal && !this.map.isFullMapOpen; }
  get person() { return this.controllers.entities.person; }
  get car() { return this.controllers.entities.car; }
  // The weapon in hand as it fires with what is fitted on it (weapon-mods.js)
  get weapon() { return effectiveWeapon(this.weaponId, this.mods[this.weaponId]); }

  // ---- Vehicles ---------------------------------------------------------------------------------------------------
  makeCar(kind, paint, position, heading = 0, stolen = false, lite = false, pooled = false) {
    if (!pooled && this.fleet.length >= FLEET_MAX) {
      // recycle the oldest ordinary car far from the player
      const old = this.fleet.find((c) => !c.mission && c !== this.car && c.position.distanceTo(this.person.position) > 80);
      if (old) this.removeFleetCar(old);
    }
    const moto = kind === 'moto';
    const boat = kind === 'boat';
    const car = boat ? createBoat(this.scene, { paint }) : moto ? createMotorbike(this.scene, { paint }) : this.controllers.createCarEntity({ kind, paint, lite });
    car.id = this.nextId++; car.stolen = stolen;
    car.position.copy(position); car.heading = heading; car.prevX = position.x; car.prevZ = position.z;
    // whatever was parked where this car now stands is gone
    if (!pooled) this.parking?.vacateNear(position.x, position.z, moto ? 2.5 : 4.5);
    if (!moto && !boat) car.drive = { speed: car.tune.top, reverseSpeed: 14, wheelbase: car.spec.wheelZ * 2 };
    car.hp = 100; car.burnT = 0; car.destroyed = false;
    if (!moto && !lite && !boat) splitDoor(car);
    car.mesh.position.copy(car.position); car.mesh.rotation.y = heading;
    if (!pooled) this.fleet.push(car);
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
    // The west curb of 5th Avenue just below 37th Street: Sacha on the sidewalk beside his cars, facing downtown, the
    // avenue and the Empire State Building ahead of him and no sidewalk shed over the first frame
    const z = streetZ(37) - 26;
    this.makeCar('muscle', 0x12305c, new THREE.Vector3(-8.15, 0, z + 6));
    this.makeCar('suv', 0x163c36, new THREE.Vector3(-8.15, 0, z + 24));
    this.makeCar('taxi', 0xffbd22, new THREE.Vector3(-8.15, 0, z - 12));
    this.controllers.entities.car = this.fleet[0];
    const person = this.person;
    person.position.set(-12.2, this.controllers.getGroundHeight(-12.2, z, 'person'), z);
    person.heading = 0;
    this.camera.footYaw = -0.18;
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
      <div id="game-brand"><span class="cm-monogram">OD<span>↗</span></span><span>OVERDRAFT<small>v${BUILD} · ${BUILD_NAME.toUpperCase()}</small></span></div>
      <div id="session-badge"><i></i><span>MANHATTAN</span><b id="session-mode">LIBRE</b><button id="pause-button" aria-label="Ouvrir le menu pause">Ⅱ</button></div>
      <div id="game-prompt" role="status" aria-live="polite"><kbd>F</kbd><span>Voler la voiture<small>VÉHICULE</small></span></div>
      <div id="game-toast" role="status" aria-live="polite"></div>
      <div id="stamina-track" aria-label="Endurance"><span id="stamina-fill"></span></div>
      <div id="vehicle-name"><span>VALMONT</span><strong>ÉCUME</strong><small>BERLINE / PROPULSION</small></div>
      <div id="drive-gauge"></div>
      <div id="game-keybar"></div>
      <div id="intro-bars" aria-hidden="true"><i></i><i></i></div>
      <div id="intro-card" aria-hidden="true"><span>MANHATTAN · NEW YORK</span><strong>Midtown</strong><em>5e Avenue</em></div>
      ${pauseMenuMarkup(BUILD)}
      <dialog id="credits-dialog"><button id="close-credits" aria-label="Fermer les crédits">×</button><h2>OVERDRAFT</h2><p>Version ${BUILD} · ${BUILD_NAME}</p><p>Basé sur Slop New York par Mr.doob.<br>Rendu Three.js, WebGPU et TSL. Thème d’ouverture « La dette » composé pour OVERDRAFT, avec des instruments de Versilian Studios (CC0). La radio et les effets sont générés en temps réel.</p><p>Données : NYC Open Data, MTA et © contributeurs OpenStreetMap (ODbL). Boutiques : registres publics des vitrines et des restaurants de New York, noms inventés. Immeubles : registre foncier PLUTO de la ville (NYC Planning) et volumes OpenStreetMap. Mobilier urbain : registres publics de la ville et de la MTA (bouches d’incendie, arrêts et abris de bus, kiosques, arceaux, bancs, bornes, parcmètres, échafaudages, terrasses).</p><p>Enseignes : polices Google Fonts (SIL OFL, Apache 2.0).</p><p>Voitures : KiW, razor24, meeww, ziedarchi, lael.eugenio, cenobyte, Tomaso, Jiaxing, Lexyc16, Myedsu, kekomag et Eric Chadwick / DGG. Modèles sous CC BY 4.0, modifiés pour OVERDRAFT.</p><p>Armes : « Service Pistol » de Mateusz Sadek (Poly Haven, CC0) ; « AK-12 » et « Remington 870 with Magpul furniture » de rwroclav, « MP7 » de Harry / habbottcapps, « M67 Fragmentation Grenade » de FJH (Sketchfab, CC BY 4.0). Réorientées, découpées en pièces mobiles et débarrassées de leurs marquages pour le jeu.</p><a href="./CREDITS.md" target="_blank" rel="noopener">Sources et licences ↗</a></dialog>
      <button id="mobile-interact" class="touch-interact" hidden>F <span>VÉHICULE</span></button>
    `);
    this.driveInstruments = new DriveInstruments(document.getElementById('drive-gauge'));
    this.ui = Object.fromEntries(['game-menu', 'game-prompt', 'game-toast', 'stamina-fill', 'vehicle-name', 'game-keybar', 'play-button', 'mobile-interact', 'session-mode', 'menu-progress', 'intro-card'].map(id => [id, document.getElementById(id)]));
    this.pauseMenu = new PauseMenu(this, this.ui['game-menu']);
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
    this.bindFullscreen();
    document.getElementById('credits-button').addEventListener('click', () => document.getElementById('credits-dialog').showModal());
    document.getElementById('close-credits').addEventListener('click', () => document.getElementById('credits-dialog').close());
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
      if (e.code === 'KeyE') this.vertical.toggleGrapple();
      if (e.code === 'KeyX' && this.state === 'onFoot' && (HANDLING[this.weaponId] || this.drawForAim())) {
        this.aimToggle = !this.aimToggle;
      }
      if (e.code === 'KeyC' && this.state === 'onFoot' && HANDLING[this.weaponId]) this.camera.swapShoulder();
      if (e.code === 'KeyY' && this.state === 'onFoot') this.toggleAimAssist();
      if (e.code === 'KeyR') {
        if (this.state === 'driving') this.resetStoppedVehicle();
        else if (this.state === 'onFoot') this.reload();
      }
      if (e.code === 'KeyT') this.changeRadio(e.shiftKey ? -1 : 1);
      const digit = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'].indexOf(e.code);
      if (digit >= 0 && (this.state === 'onFoot' || this.state === 'driving' || this.vertical.owns(this.state) || this.state === 'falling')) {
        if (this.state !== 'onFoot' && this.state !== 'driving' && WEAPON_ORDER[digit] !== 'grapple') return; // in the air, only the grapple comes out
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
    // Buttons are read from the pointer events' button mask: the camera's drag cancels a lone left pointerdown, and a
    // cancelled pointerdown swallows the matching mousedown, so a plain left click never reached a mousedown listener
    // (only a click made while aiming did). The mask sees every press and release, chorded or not.
    let mask = 0;
    const buttons = (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const now = e.buttons ?? 0;
      if (now === mask) return;
      const pressed = now & ~mask, released = mask & ~now;
      mask = now;
      if (released & 1) this.fireHeld = false;
      if (released & 2) this.aimHeld = false;
      if (!pressed || !this.active) return;
      const onCanvas = e.target === canvas || document.pointerLockElement === canvas;
      if (!onCanvas) return;
      if (document.pointerLockElement !== canvas && (pressed & 1) && !this.locking) {
        this.locking = true;
        Promise.resolve(canvas.requestPointerLock?.()).catch(() => {}).finally(() => { this.locking = false; });
      }
      if (pressed & 1) { this.fireHeld = true; this.firePressed = true; }
      if (pressed & 2) { this.aimHeld = true; this.aimToggle = false; this.drawForAim(); }
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) window.addEventListener(type, buttons, true);
    window.addEventListener('blur', () => { mask = 0; this.fireHeld = this.firePressed = this.aimHeld = this.aimToggle = false; this.triggerBuffer = 0; });
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

  bindFullscreen() {
    if (!document.fullscreenEnabled) return;
    const button = document.getElementById('fullscreen-toggle');
    const label = button.querySelector('span');
    const status = document.getElementById('fullscreen-status');
    const updateLabel = () => {
      label.textContent = document.fullscreenElement ? 'Quitter le plein écran' : 'Plein écran';
      status.textContent = '';
    };
    button.hidden = false;
    updateLabel();
    document.addEventListener('fullscreenchange', updateLabel);
    button.addEventListener('click', async () => {
      status.textContent = '';
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        status.textContent = 'Le changement de mode d’affichage a échoué.';
      }
    });
  }

  releasePointer() {
    if (document.pointerLockElement) { this.expectUnlock = true; document.exitPointerLock?.(); }
  }

  start() {
    this.openingScreen?.dismiss();
    const first = !this.playing;
    this.playing = true;
    this.setPaused(false);
    this.audio.setEnabled(this.audio.enabled);
    this.ui['play-button'].firstChild.textContent = 'REPRENDRE LA PARTIE ';
    if (first && this.testSpawn) {
      this.camera.menuDolly = null;
      this.camera.resetForTeleport();
      this.camera.initialized = false;
      this.toast('Test FDR · 30e Rue', 'Voie nord · Z / RT pour passer devant l’immeuble · Essai sans sauvegarde');
      return;
    }
    if (first) {
      // the long opening for a new game, and once for each new build of the game; a short dive otherwise
      let seen = null;
      try { seen = localStorage.getItem(INTRO_KEY); localStorage.setItem(INTRO_KEY, BUILD); } catch { /* private window */ }
      this.playIntro((!this.missionsDone.length && this.distance < 50) || seen !== BUILD);
    }
  }

  setPaused(paused) {
    this.paused = paused;
    this.controllers.resetInput();
    this.fireHeld = this.firePressed = this.aimHeld = this.aimToggle = false;
    this.triggerBuffer = 0;
    this.gamepad.setEnabled(this.active);
    this.touch.setEnabled(this.active);
    document.body.classList.toggle('in-menu', paused || !this.playing);
    this.ui['game-menu'].classList.toggle('dismissed', !paused && this.playing);
    this.ui['game-menu'].hidden = !paused && this.playing;
    this.radio?.setMuffled(paused ? 1 : 0);
    if (paused) { this.save(); this.releasePointer(); this.updateMenuProgress(); }
    else this.camera.domElement.focus();
    this.pauseMenu?.onPauseChanged(paused || !this.playing);
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
    if (this.gamepad?.using) {
      const end = [k(['View'], 'Caméra / garage (tenu)'), k(['↑'], 'Téléphone'), k(['↓'], 'Carte'), k(['Menu'], 'Pause')];
      const wheel = k(['LB'], 'Armes'), interact = k(['Y'], 'Interagir');
      const aim = k(['LT', 'RT'], this.weaponId === 'grapple' ? 'Viser / grappin' : 'Viser / tirer');
      const grapple = k(['RB'], 'Sortir / ranger le grappin');
      let hints;
      if (this.state === 'driving') {
        const car = this.car;
        hints = car.air ? [k(['LS'], 'Piloter'), k(['RT', 'LT'], car.mode === 'plane' ? 'Gaz + / −' : 'Monter / descendre'), k(['Y'], 'Quitter'), k(['←', '→'], 'Radio')]
          : [k(['LS'], 'Diriger'), k(['RT', 'LT'], 'Gaz / frein'), k(['Y'], 'Descendre'),
            ...(!car.boat ? [k(['A'], 'Frein à main'), ...(!car.bicycle ? [k(['RB'], car.moto ? 'Wheeling' : 'Nitro')] : [])] : []),
            ...(!car.bicycle ? [k(['X', 'RT'], 'Tir embarqué'), wheel] : []), k(['←', '→'], 'Radio')];
      } else if (this.state === 'swimming') hints = [k(['LS'], 'Nager'), k(['A'], 'Crawl'), k(['Y'], 'Monter à bord')];
      else if (this.state === 'surfing') hints = [aim, k(['X'], 'Sauter'), interact, grapple];
      else if (this.vertical?.owns(this.state) || this.state === 'falling') hints = [k(['LS', 'RS'], 'Diriger'), k(['X'], 'Sauter / wingsuit'), k(['Y'], 'Parapente / larguer'), grapple, k(['RT'], 'Tirer le grappin')];
      else hints = [k(['A'], 'Courir'), k(['X'], 'Sauter'), interact, aim, k(['B'], 'Recharger'), wheel, grapple];
      this.ui['game-keybar'].innerHTML = [...hints, ...end].join('');
      this.ui['game-prompt'].querySelector('kbd').textContent = 'Y';
      return;
    }
    this.ui['game-prompt'].querySelector('kbd').textContent = 'F';
    const armed = this.weaponId !== 'fists';
    const end = [k(['G'], 'Garage'), k(['V'], 'Caméra'), k(['M'], 'Carte'), k(['ÉCHAP'], 'Menu')];
    const air = { helicopter: [k(['Z', 'S'], 'Avancer'), k(['Q', 'D'], 'Pivoter'), k(['ESPACE'], 'Monter'), k(['C'], 'Descendre')],
      plane: [k(['Z', 'S'], 'Piquer / Cabrer'), k(['Q', 'D'], 'Virer'), k(['ESPACE'], 'Gaz +'), k(['C'], 'Gaz −')] };
    const flying = this.state === 'driving' && this.car.air;
    this.ui['game-keybar'].innerHTML = flying ? [...air[this.car.mode], k(['F'], 'Sauter'), k(['T'], 'Radio'), ...end].join('')
      : this.vertical?.owns(this.state) ? this.vertical.keybar(k, end).join('')
      : this.state === 'falling' ? [k(['ZQSD'], 'Se diriger'), this.weaponId === 'grapple' ? k(['CLIC'], 'Grappin') : k(['E'], 'Grappin'), ...end].join('')
      : this.state === 'swimming' ? [k(['ZQSD'], 'Nager'), k(['ESPACE'], 'Crawl'), k(['F'], 'Monter à bord'), ...end].join('')
      : this.state === 'driving' && this.car.boat ? [k(['ZQSD'], 'Piloter'), k(['F'], 'Quitter le bord'), k(['T'], 'Radio'), ...end].join('')
      : this.state === 'driving' && this.car.bicycle ? [k(['ZQSD'], 'Pédaler'), k(['F'], 'Descendre'), k(['T'], 'Radio'), ...end].join('')
      : this.state === 'driving' ? [k(['ZQSD'], 'Conduire'), k(['ESPACE'], 'Frein à main'), k(['MAJ'], this.car.moto ? 'Wheeling' : 'Nitro'), this.car.moto ? '' : k(['C'], 'Regarder derrière'), armed && this.weaponId !== 'shotgun' ? k(['CLIC D.', 'CLIC'], 'Tirer par la vitre') : '', k(['B'], 'Klaxon'), k(['T'], 'Radio'), k(['F'], 'Descendre'), ...end].join('')
      : [k(['ZQSD'], 'Se déplacer'), k(['ESPACE'], 'Courir'), k(['MAJ'], 'Sauter'), k(['CLIC'], this.weaponId === 'grapple' ? 'Grappin' : armed ? 'Tirer' : 'Frapper'), k(['CLIC D.'], armed ? 'Viser' : 'Dégainer'), HANDLING[this.weaponId] ? k(['X'], 'Visée fixe') + k(['C'], 'Épaule') + k(['Y'], 'Visée assistée') : '',
        armed && this.weaponId !== 'grapple' ? k(['R'], 'Recharger') : '', k(['E'], this.weaponId === 'grapple' ? 'Ranger le grappin' : 'Grappin'), k(['TAB'], 'Roue des armes'), k(['F'], 'Véhicule'), k(['G'], 'Garage'), k(['P'], 'Téléphone'), k(['M'], 'Carte'), k(['ÉCHAP'], 'Menu')].join('');
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

  changeRadio(step) {
    if (!this.radio || this.state !== 'driving') return;
    if (step < 0) this.radio.prev(); else this.radio.next();
    this.showRadio();
  }

  resetStoppedVehicle() {
    const car = this.car;
    if (this.state !== 'driving' || Math.abs(car.speed) >= 1.5) return;
    car.position.y = this.controllers.getGroundHeight(car.position.x, car.position.z, 'car');
    car.speed = car.vx = car.vz = car.angularVel = 0;
    if (car.body) settleBody(car);
  }

  // ---- Map overlay: flooded streets, police, mission blips, GPS ----------------------------------------------------
  setupMap() {
    if (DEBUG) this.map.onTeleport = (x, z) => this.teleportPlayer(x, z);
    else this.map.onTeleport = null;
    this.map.overlay = (ctx, toX, toY, w, h, scale, mini) => this.drawMapOverlay(ctx, toX, toY, w, h, scale, mini);
    this.gpsPath = null;
    this.gpsT = 0;
  }

  // The first text messages, once the player has had a moment
  tips(dt) {
    // 0.9: the way up, once per browser
    if ((this.skyTipT = (this.skyTipT ?? 7) - dt) <= 0 && !this.skyTipped) {
      this.skyTipped = true;
      let seen = false;
      try { seen = localStorage.getItem('overdraft:tip:grapple') === '1'; localStorage.setItem('overdraft:tip:grapple', '1'); } catch { /* storage optional */ }
      if (!seen && this.state === 'onFoot' && !this.director.current) this.toast('Nouveau : le grappin LEVIER (7 ou E)', 'Clic droit pour viser une façade, clic pour tirer : il vous hisse jusqu’au toit. En l’air, Espace : wingsuit.');
    }
    // 0.9.11: the weapons he wears, once per browser, as soon as the opening flight has landed
    if ((this.wheelTipT = (this.wheelTipT ?? 2.5) - dt) <= 0 && !this.wheelTipped && !this.intro) {
      this.wheelTipped = true;
      let seen = false;
      try { seen = localStorage.getItem('overdraft:tip:wheel') === '1'; localStorage.setItem('overdraft:tip:wheel', '1'); } catch { /* storage optional */ }
      if (!seen && this.state === 'onFoot') this.toast('Vos armes sont sur vous', 'Clic droit ou X : dégainer et viser · TAB maintenu : la roue des armes · TAB bref : arme précédente');
    }
    // 0.9.18: the gun shops, once per browser, a little after the others
    if ((this.shopTipT = (this.shopTipT ?? 15) - dt) <= 0 && !this.shopTipped) {
      this.shopTipped = true;
      let seen = false;
      try { seen = localStorage.getItem('overdraft:tip:calibre') === '1'; localStorage.setItem('overdraft:tip:calibre', '1'); } catch { /* storage optional */ }
      if (!seen && this.state === 'onFoot' && !this.director.current && !this.calibre?.inside) this.toast('Nouveau : les armureries CALIBRE', 'On y entre : améliorations d’armes au comptoir, stand de tir au fond. Repères laiton sur la carte, ou P → Contacts → CALIBRE.');
    }
    if ((this.tipT = (this.tipT ?? 26) - dt) > 0 || this.tipped) return;
    this.tipped = true;
    this.phone.text('NADIA', 'On m’a parlé de toi. J’ai du travail pour quelqu’un qui sait conduire. Regarde tes contrats (P).');
  }

  drawMapOverlay(ctx, toX, toY, w, h, scale, mini) {
    this.gangs.draw(ctx, toX, toY);
    this.architect?.drawMap(ctx, toX, toY);
    if (!mini || scale > 0.1) {
      ctx.fillStyle = '#ffb347';
      for (const r of ramps) {
        const x = toX(r.x), y = toY(r.z);
        ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y + 3); ctx.lineTo(x - 4, y + 3); ctx.fill();
      }
    }
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
      if (a.dead || a.architect) continue;
      const x = toX(a.x), y = toY(a.z);
      if (!inView(x, y)) continue;
      ctx.fillStyle = a.team === 'police' ? '#7fb2ff' : a.hostile ? '#ff5a5a' : '#ffd54a';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
    // Markers & contacts. The gun shops go down first: missions and their names are read over them
    for (let pass = 0; pass < 2; pass++) for (const m of this.markers.markers) {
      if (!m.used || m.blip === false || (m.kind === 'guns') !== (pass === 0)) continue;
      let x = toX(m.x), y = toY(m.z);
      const color = { objective: '#ffd54a', destination: '#5ec8ff', contact: '#e1f3a0', target: '#ff4d4d', race: '#ff9a3c', guns: '#e1c492', shop: '#c99bff', home: '#7ee08a', homeSale: '#3e8a4a' }[m.kind] || '#fff';
      const pinned = m.kind !== 'guns' && m.kind !== 'shop' && m.kind !== 'home' && m.kind !== 'homeSale';
      if (mini && !pinned && (Math.abs(x) > w * 0.5 - 6 || Math.abs(y) > h * 0.5 - 6)) continue;
      if (mini) {
        // pin markers to the radar's edge
        const r = Math.min(w, h) * 0.5 - 8;
        const d = Math.hypot(x, y);
        if (Math.abs(x) > w * 0.5 - 8 || Math.abs(y) > h * 0.5 - 8) { x = x / d * r; y = y / d * r; }
      }
      if (m.kind === 'guns') {
        // A gun shop: a brass pistol on a bottle-green badge, twice the size of a dot so it reads at a glance; on the
        // full map it shrinks with the zoom, and is named once the map is close enough for names not to pile up
        const r = mini ? 10.5 : Math.max(8, Math.min(11.5, 6.5 + 22 * scale));
        // a mission's marker on the same doorstep: the badge steps aside, so that both are read
        for (const o of this.markers.markers) {
          if (!o.used || o.blip === false || o.kind === 'guns') continue;
          const dx = x - toX(o.x), dy = y - toY(o.z), d = Math.hypot(dx, dy);
          if (d > r + 7) continue;
          const ux = d > 0.5 ? dx / d : 1, uy = d > 0.5 ? dy / d : 0;
          x += ux * (r + 8 - d); y += uy * (r + 8 - d);
          break;
        }
        ctx.fillStyle = '#000b';
        ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#16261f';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
        if (GUN_BLIP) {
          const k = r * 1.46 / 24;
          ctx.save();
          ctx.translate(x - 12 * k, y - 12.4 * k); ctx.scale(k, k);
          ctx.fillStyle = '#f3dda6';
          ctx.fill(GUN_BLIP, 'evenodd');
          ctx.restore();
        }
        if (!mini && m.label && 100 * scale > 20) {
          // under the badge, out of the way of the names written to the right of the other markers
          ctx.font = '700 10px Arial';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#000b'; ctx.fillText(m.label, x + 1, y + r + 13);
          ctx.fillStyle = '#f3dda6'; ctx.fillText(m.label, x, y + r + 12);
          ctx.textAlign = 'start';
        }
        continue;
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
    this.ambient?.onCollision(e);
    const { a, b, speed } = e;
    const person = this.person;
    if (speed > 3) {
      if (a?.body) this.driveFx.crash(a, e.x, e.y, e.z, e.nx, e.nz, speed);
      if (b?.body) this.driveFx.crash(b, e.x, e.y, e.z, -e.nx, -e.nz, speed);
      if ((a === this.car || b === this.car) && this.state === 'driving') {
        this.camera.addShake(Math.min(1.5, speed * 0.05));
        // The worst crashes are worth seeing go by
        if (speed > 22 && !this.slowMo && this.clock > this.slowAgain) { this.slowMo = 0.8; this.slowAgain = this.clock + 7; }
        this.stunts.crashed();
      }
    }
    // A car against a trunk shakes the leaves out of the crown
    if (b?.obstacle === 'tree' && speed > 4) this.fx.leaves(b.cx, b.minY + b.maxY * 0.55, b.cz, 3.2, Math.min(90, 18 + speed * 3));
    for (const [self, other] of [[a, b], [b, a]]) {
      if (!self) continue;
      if (self === person && other && other.edge !== undefined && speed > 3.5 && this.state === 'onFoot') {
        // struck by traffic while on foot
        this.damagePlayer(speed * 3.2, 'vehicle');
        if (speed > 5) this.knockDown(Math.atan2(e.nx, e.nz));
        continue;
      }
      if (self.bicycle && self === this.car && this.state === 'driving' && speed > 11) { this.bail(self, speed); continue; }
      if (self.boat) { if (self === this.car) this.camera.addShake(Math.min(1.2, speed * 0.06)); continue; }
      if ((self.type === 'car' || self.air) && self.hp !== undefined && !self.destroyed && speed > 4.5) {
        const before = this.crashPeak(self, speed);
        if (speed > before) this.damageCar(self, crashDamage(speed) - crashDamage(before), self === this.car && this.state === 'driving' ? 'crash' : 'hit');
        if (self === this.car && this.state === 'driving' && self.moto && speed > 8) { this.bail(self, speed); continue; }
        if (self === this.car && this.state === 'driving' && speed > 22 && speed > before) this.damagePlayer((speed - Math.max(22, before)) * 1.2, 'crash');
        if (other && other.police && self === this.car && this.state === 'driving') this.crime('copCarHit', e.x, e.z);
      }
      // Traffic takes the blow and is left battered, never blown up by a bumper: fire is for bullets and blasts
      if (self.edge !== undefined && self.hp !== undefined && speed > 6 && other === this.car) {
        const before = this.crashPeak(self, speed);
        if (speed > before) self.hp = Math.max(Math.min(self.hp, 8), self.hp - crashDamage(speed) + crashDamage(before));
      }
    }
  }

  // Rammed out of the traffic: from here on it is a loose car like any other, sent where the blow sends it
  takedown(v, kind, colour, body, hit) {
    if (!carSpecs[kind]) return;
    const heading = Math.atan2(body.sin, body.cos);
    const paint = new THREE.Color().setRGB(colour[0], colour[1], colour[2]).getHex();
    if (this.fleet.length >= FLEET_MAX + 6) return;
    // Where the contact left it, clear of the car that hit it (body is where the two met, earlier in the frame)
    const x = v.x ?? body.x, z = v.z ?? body.z;
    const car = this.makeCar(kind, paint, new THREE.Vector3(x, 0, z), heading, false, true);
    settleBody(car, heading);
    car.speed = body.vx * body.sin + body.vz * body.cos;
    car.vx = body.vx - body.sin * car.speed;
    car.vz = body.vz - body.cos * car.speed;
    car.angularVel = body.angularVel;
    // The blow pops its struck end up: it bucks and comes down on its wheels
    popBody(car, hit.x, hit.z, hit.impulse);
    // It leaves the road model, or the street would keep a copy of it in its lane, overlapping the loose car and shoving
    // it on every frame (the parkway hides its own car until it comes round again, traffic.js)
    if (v.edge !== 'highway') this.traffic.removeVehicle(v);
    this.stats.cars++;
  }

  // A car that went off the quay: a splash, then it fills and goes down, and whoever is in it comes up without it
  sinking(c) {
    const y = c.position.y;
    if (y > WATER + 0.3) { c.splashed = false; return; }
    if (!c.splashed) {
      c.splashed = true;
      this.driveFx.splash(c.position.x, c.position.z, Math.min(1.6, 0.6 + Math.hypot(c.body.vx, c.body.vz) * 0.04));
      this.audio.sfx('explosion', c.position.x, 0, c.position.z, { intensity: 0.35, rate: 0.6 });
      if (c === this.car && this.state === 'driving') this.toast('À l’eau', 'Le véhicule coule : nagez jusqu’au quai.');
    }
    if (y > WATER - 2.6) return;
    if (c === this.car && this.state === 'driving') this.enterWater(c.position.x, c.position.z);
    if (c.police) this.wanted.retire(this.wanted.units.find((u) => u.car === c));
    else if (this.fleet.includes(c)) this.removeFleetCar(c);
    else c.mesh.visible = false;
  }

  // A shot from a moving cruiser or the helicopter: a tracer to wherever it went, a hit if the odds say so
  policeShot(x, y, z, accuracy, damage) {
    const pl = this.player, hit = Math.random() < accuracy;
    const miss = hit ? 0 : 1.4 + Math.random() * 2.6, a = Math.random() * 6.28;
    const to = this._shotTo.set(pl.x + Math.cos(a) * miss, pl.y + 0.9 + (hit ? 0 : Math.random() * 1.4 - 0.7), pl.z + Math.sin(a) * miss);
    this.fx.tracer(this._shotFrom.set(x, y, z), to);
    this.fx.muzzleFlash(this._shotFrom, this._shotDir.subVectors(to, this._shotFrom).normalize());
    this.audio.sfx(damage > 15 ? 'rifle' : 'pistol', x, y, z);
    if (hit) this.applyShot({ kind: 'player', target: pl, t: 1, x: to.x, y: to.y, z: to.z, nx: -this._shotDir.x, ny: -this._shotDir.y, nz: -this._shotDir.z }, damage, null);
    else this.fx.impact(to.x, Math.max(0.05, to.y), to.z, 0, 1, 0, 'concrete');
  }

  burstTyres() {
    const car = this.car;
    if (this.state !== 'driving' || !car.body || car.body.wheels.every((w) => w.burst)) return;
    for (const w of car.body.wheels) w.burst = true;
    this.audio.sfx?.('impactMetal', car.position.x, 0.4, car.position.z);
    this.camera.addShake(0.5);
    this.toast('Pneus crevés', 'La herse a eu vos quatre roues : tenez la route jusqu’à une carrosserie.');
  }

  knockProp(prop, car) {
    if (prop.lamp !== undefined) {
      const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
      this.fallingLamps.knock(prop.cx, prop.cz, sin * car.speed + car.vx, cos * car.speed + car.vz);
    }
    this.streets.removeProp(prop);
    const speed = Math.abs(car.speed);
    const y = prop.obstacle === 'hydrant' ? 0.5 : 0.9;
    const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
    this.fx.impact(prop.cx, y, prop.cz, sin, 0.4, cos, prop.soft ? 'concrete' : 'metal', _noDecal);
    if (!prop.soft) this.audio.crash({ a: car, b: prop, kind: 'building', x: prop.cx, y, z: prop.cz, nx: sin, ny: 0, nz: cos, speed: Math.min(9, speed * 0.5) });
    if (prop.obstacle === 'hydrant') this.jets.push({ x: prop.cx, y: 0.3, z: prop.cz, life: 40 });
  }

  readBody(car, body) {
    const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
    body.x = car.position.x; body.z = car.position.z;
    body.prevX = car.prevX ?? car.position.x; body.prevZ = car.prevZ ?? car.position.z;
    body.sin = sin; body.cos = cos;
    body.halfW = car.halfW ?? 0.92; body.halfL = car.halfL ?? Math.max(car.spec.zFront, -car.spec.zRear);
    body.mass = car.moto || car.bicycle ? 260 : car.tune?.mass ?? 1300;
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
    if (Math.abs(a.position.y - b.position.y) > STACKED) return; // one passing over the other
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
    // A shunt jolts both off their springs, the lighter one more
    if (a.body) shuntBody(a, hit.x, hit.z, hit.impulse);
    if (b.body) shuntBody(b, hit.x, hit.z, hit.impulse);
  }

  // Bodies the car layer must keep apart from the protagonist on foot
  resolveParkedCollision(person, car) {
    if (person.position.y > car.position.y + 1.7) return;
    const dx = person.position.x - car.position.x, dz = person.position.z - car.position.z;
    const reach = Math.max(4, (car.halfL ?? 2.2) + 1.5); // a bus's wreck is twelve metres long
    if (Math.abs(dx) > reach || Math.abs(dz) > reach) return;
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
    if (this.state === 'swimming') { this.updateSwim(dt); return; }
    if (this.vertical.owns(this.state)) { this.vertical.updatePerson(dt); return; }
    const p = this.person, keys = this.controllers.keys, c = this.controllers;
    const grounded = this.state === 'onFoot';
    const standing = p.position.y <= c.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y + 0.05) + 0.04;
    const x = grounded ? Number(keys.right) - Number(keys.left) : 0;
    const z = grounded ? Number(keys.forward) - Number(keys.backward) : 0;
    const amount = Math.min(1, Math.hypot(x, z));
    const aiming = this.isAiming();
    const sprint = keys.run && this.stamina > 1 && amount > 0 && !aiming;
    this.stamina = clamp(this.stamina + (sprint ? -13 : 20) * dt, 0, 100);
    const speed = aiming ? 2.6 : sprint ? 7.8 : 3.9;
    p.speed += (amount * speed - p.speed) * (1 - Math.exp(-dt * (amount ? 9 : 14)));
    const yaw = this.camera.footYaw;
    if (aiming || this.strafeT > 0 && !sprint || this.cooldown > this.weapon.interval * 0.5 && this.weaponId !== 'fists') {
      p.heading += angleDelta(p.heading, yaw) * (1 - Math.exp(-dt * 25));
    } else if (amount > 0) {
      const desired = yaw + Math.atan2(-x, z);
      p.heading += angleDelta(p.heading, desired) * (1 - Math.exp(-dt * 14));
    }
    let mx = 0, mz = 0;
    if (amount > 0) {
      const magnitude = Math.hypot(x, z);
      const localX = -x / magnitude, localZ = z / magnitude;
      mx = Math.cos(yaw) * localX + Math.sin(yaw) * localZ;
      mz = -Math.sin(yaw) * localX + Math.cos(yaw) * localZ;
      p.position.x += mx * p.speed * dt;
      p.position.z += mz * p.speed * dt;
    }
    if (this.knock) {
      p.position.x += this.knock.vx * dt;
      p.position.z += this.knock.vz * dt;
      const damp = Math.exp(-5 * dt);
      this.knock.vx *= damp; this.knock.vz *= damp;
    }
    // Momentum from a rope, a car's roof, a wingsuit landing: carried through the air, scrubbed off by the ground
    if (p.airVX || p.airVZ) {
      p.position.x += p.airVX * dt;
      p.position.z += p.airVZ * dt;
      const damp = Math.exp(-(standing ? 7 : 0.15) * dt);
      p.airVX *= damp; p.airVZ *= damp;
      if (Math.abs(p.airVX) + Math.abs(p.airVZ) < 0.05) p.airVX = p.airVZ = 0;
    }
    // Onto a roof a step higher, before its wall gets a say
    if (standing && amount > 0) {
      const step = c.roofHeight(p.position.x + mx * 0.5, p.position.z + mz * 0.5, p.position.y, 0.62);
      if (step > p.position.y + 0.02 && Math.abs(c.roofHeight(p.position.x, p.position.z, step + 0.05, 0.1) - step) < 0.05) p.position.y = step;
    }
    c.resolveHorizontalCollision(p.position, 0.34, null, null, 'person');
    for (const car of this.allCars) if (car.mesh.visible) this.resolveParkedCollision(p, car);
    const ground = c.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y + 0.05);
    if (grounded && keys.jump && !this.jumpHeld && p.position.y <= ground + 0.04) {
      // A ledge within reach is climbed, anything else is jumped at
      const ledge = this.vertical.ledgeAhead();
      if (ledge) { this.jumpHeld = true; this.vertical.startClimb(ledge, 0.62); return; }
      p.verticalVel = 5.3;
    }
    this.jumpHeld = Boolean(keys.jump);
    p.verticalVel -= 15 * dt;
    p.position.y += p.verticalVel * dt;
    if (p.position.y < ground) {
      const impact = -p.verticalVel;
      p.position.y = ground; p.verticalVel = 0;
      if (this.state === 'onFoot' || this.state === 'down') this.vertical.landed(impact);
    } else if (this.state === 'onFoot') this.vertical.checkFall(ground);
    p.footing = ground;
  }

  // ---- In the water ---------------------------------------------------------------------------------------------------
  // The open water nearest (x, z), a little way off the seawall
  waterNear(x, z) {
    const zone = Math.max(ISLAND_BOUNDS.minZ + 60, Math.min(ISLAND_BOUNDS.maxZ - 60, z));
    const shore = getIslandBoundsAtZ(zone);
    const west = Math.abs(x - shore.westX) < Math.abs(x - shore.eastX);
    const open = (sx, sz) => [[0, 0], [0, -11], [0, 11], [-5, 0], [5, 0]].every(([a, b]) => this.controllers.afloat(sx + a, sz + b));
    for (let off = 16; off < 420; off += 16) {
      const sx = west ? shore.westX - off : shore.eastX + off;
      if (open(sx, zone)) return { x: sx, z: zone };
    }
    return { x: west ? shore.westX - 40 : shore.eastX + 40, z: zone };
  }

  // Dry land nearest a point in the water, if there is any within reach
  landNear(x, z, reach) {
    const shore = getIslandBoundsAtZ(Math.max(ISLAND_BOUNDS.minZ + 40, Math.min(ISLAND_BOUNDS.maxZ - 40, z)));
    const sx = x < shore.westX ? shore.westX + 3 : x > shore.eastX ? shore.eastX - 3 : x;
    if (Math.abs(sx - x) > reach) return null;
    return this.safeSpot(sx, z, 0.5);
  }

  enterWater(x, z) {
    const p = this.person;
    this.transition = null;
    p.inVehicle = false;
    p.position.set(x, WATER - 1.28, z);
    p.speed = 0; p.verticalVel = 0;
    this.controllers.swimming = true;
    this.state = 'swimming';
    this.onMode('person');
    this.radio?.setPlaying(false);
    document.body.dataset.gameState = this.state;
    this.driveFx.splash(x, z, 0.7);
    this.updateKeybar();
  }

  leaveWater(spot) {
    const p = this.person;
    this.controllers.swimming = false;
    p.position.set(spot.x, this.controllers.getGroundHeight(spot.x, spot.z, 'person'), spot.z);
    this.state = 'onFoot';
    document.body.dataset.gameState = this.state;
    this.updateKeybar();
  }

  updateSwim(dt) {
    const p = this.person, keys = this.controllers.keys;
    const x = Number(keys.right) - Number(keys.left), z = Number(keys.forward) - Number(keys.backward);
    const amount = Math.min(1, Math.hypot(x, z));
    const fast = keys.run && this.stamina > 1 && amount > 0;
    this.stamina = clamp(this.stamina + (fast ? -9 : 14) * dt, 0, 100);
    p.speed += (amount * (fast ? 4 : 2.6) - p.speed) * (1 - Math.exp(-dt * 3));
    if (amount > 0) p.heading += angleDelta(p.heading, this.camera.footYaw + Math.atan2(-x, z)) * (1 - Math.exp(-dt * 8));
    p.position.x += Math.sin(p.heading) * p.speed * dt;
    p.position.z += Math.cos(p.heading) * p.speed * dt;
    p.position.y = WATER - 1.28 + Math.sin(this.clock * 2.2) * 0.05;
    if (Math.random() < dt * (2 + p.speed * 3)) this.fx.smokeParticle(p.position.x, WATER + 0.1, p.position.z, 0, 0.4, 0, 0.3, 0.7, 0.9 * this.driveFx.light, 0.18, { grow: 0.8 });
    if (!this.controllers.afloat(p.position.x + Math.sin(p.heading) * 1.5, p.position.z + Math.cos(p.heading) * 1.5)) {
      const spot = this.landNear(p.position.x, p.position.z, 30);
      if (spot) this.leaveWater(spot);
    }
  }

  // Left alone, a plane glides on until it falls or lands; a helicopter drops
  flyAbandoned(c, dt) {
    if (c.mode === 'plane') {
      if (!c.onGround || c.speed > 0.01) stepPlane(c, IDLE_STICK, dt, this.controllers.planeEnvironment);
    } else {
      // a helicopter left on a roof stays there
      const floor = this.controllers.roofHeight(c.position.x, c.position.z, c.position.y - 0.25, 0.3) + 0.25;
      if (c.position.y <= floor + 0.001) return;
      c.verticalSpeed -= 9.81 * dt;
      c.position.x += Math.sin(c.heading) * c.speed * dt;
      c.position.z += Math.cos(c.heading) * c.speed * dt;
      c.position.y += c.verticalSpeed * dt;
      c.speed *= Math.exp(-dt * 0.5);
      if (c.position.y <= floor) {
        c.position.y = floor;
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
    return (this.state === 'onFoot' || this.state === 'surfing') && Boolean(this.aimHeld || this.aimToggle || this.gamepad?.aim) && this.weaponId !== 'fists';
  }

  toggleAimAssist() {
    const on = this.aimAssist.enabled = !this.aimAssist.enabled;
    try { localStorage.setItem('overdraft:aimAssist', on ? '1' : '0'); } catch { /* storage optional */ }
    this.audio.ui(on ? 'shop' : 'deny');
    this.toast(on ? 'Visée assistée : activée' : 'Visée assistée : coupée', on ? 'Viser près d’un ennemi amène le viseur sur lui'
      : `Visée libre · ${this.gamepad?.using ? 'L3' : 'Y'} pour la remettre`);
  }

  get canDriveBy() {
    const w = this.weapon;
    return this.state === 'driving' && !this.car.bicycle && !this.car.air && (w.id === 'pistol' || w.id === 'smg') && !!this.weapons[w.id];
  }

  cancelWeaponActions() {
    this.fireHeld = this.firePressed = this.aimHeld = this.aimToggle = false;
    this.reloadT = this.autoReloadT = this.triggerBuffer = this.combatReadyT = this.hipT = this.strafeT = this.bloom = this.cooldown = 0;
    this.camera.aimMode = this.camera.combatMode = false;
    this.person.rig.aim = null;
    this.person.rig.reloading = -1;
    this.person.rig.gunReady = false;
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
    if (!WEAPONS[id]) return;
    const w = effectiveWeapon(id, this.mods[id]);
    const fresh = !this.weapons[id];
    if (fresh) this.weapons[id] = { mag: 0, ammo: 0 };
    const slot = this.weapons[id];
    if (w.throwable) slot.mag = Math.min(w.mag, slot.mag + ammo);
    else slot.ammo += ammo;
    if (!w.throwable && slot.mag < w.mag) {
      const take = Math.min(w.mag - slot.mag, slot.ammo);
      slot.mag += take; slot.ammo -= take;
    }
    if (fresh) { this.syncLoadout(); this.selectWeapon(id); }
    this.updateKeybar();
  }

  // What Sacha wears on him: every firearm he owns, each in its place (thigh, back, under the jacket)
  syncLoadout() {
    this.hero?.setMods(this.mods);
    this.hero?.setLoadout(['pistol', 'smg', 'shotgun', 'rifle'].filter((id) => this.weapons[id]));
  }

  // ---- Upgrades and finishes (weapon-mods.js): CALIBRE sells them; the counter debits and saves ---------------------
  // 'none' (not owned), 'fitted', or 'stowed' (owned, taken off)
  modState(weaponId, modId) {
    const value = this.mods[weaponId]?.[modId];
    return value === 1 ? 'fitted' : value === 0 ? 'stowed' : 'none';
  }

  // Bought: owned from now on and fitted at once. False when it does not fit that weapon or is already owned
  buyMod(weaponId, modId) {
    if (!fits(weaponId, modId) || this.modState(weaponId, modId) !== 'none') return false;
    this.mods[weaponId] = withMod(this.mods[weaponId], modId, true);
    this.refitWeapon(weaponId, modId === 'mag');
    return true;
  }

  // An owned upgrade comes off or goes back on, free, as often as wanted. False when it is not owned
  toggleMod(weaponId, modId) {
    const state = this.modState(weaponId, modId);
    if (state === 'none') return false;
    this.mods[weaponId] = withMod(this.mods[weaponId], modId, state !== 'fitted');
    this.refitWeapon(weaponId, modId === 'mag');
    return true;
  }

  // The finish a weapon wears ('stock' when none was ever chosen)
  finishOf(weaponId) {
    const id = this.mods[weaponId]?.finish;
    return id && finishById(id).id === id ? id : 'stock';
  }

  ownsFinish(weaponId, finishId) {
    if (finishId === 'stock') return true;
    return !!this.mods[weaponId]?.finishes?.includes(finishId);
  }

  // Wear a finish; one never worn before is owned from now on. False for an unknown finish or what takes none
  setFinish(weaponId, finishId) {
    if (!MOD_GUNS.includes(weaponId) || finishById(finishId).id !== finishId) return false;
    const state = { ...this.mods[weaponId] };
    if (finishId === 'stock') delete state.finish;
    else {
      state.finish = finishId;
      if (!state.finishes?.includes(finishId)) state.finishes = [...(state.finishes ?? []), finishId];
    }
    this.mods[weaponId] = state;
    this.refitWeapon(weaponId);
    return true;
  }

  // What changed on a weapon counts and shows at once: its magazine holds no more than the weapon now takes (the
  // surplus returns to the reserve; a longer magazine just fitted, `fill`, is loaded from it) and the gun Sacha
  // carries is dressed again
  refitWeapon(weaponId, fill = false) {
    const slot = this.weapons[weaponId], w = effectiveWeapon(weaponId, this.mods[weaponId]);
    if (slot && w.handling && (fill || slot.mag > w.mag)) {
      const move = Math.min(w.mag - slot.mag, slot.ammo);
      slot.mag += move; slot.ammo -= move;
    }
    this.hero?.setMods(this.mods);
    this.updateKeybar();
  }

  // Raising empty hands to aim takes out the firearm held last, the pistol if there was none
  drawForAim() {
    if (this.state !== 'onFoot' || this.weaponId !== 'fists') return false;
    const last = this.arsenal.previous;
    const id = last && HANDLING[last] && this.weapons[last] ? last : this.weapons.pistol ? 'pistol' : null;
    if (id) this.selectWeapon(id);
    return !!id;
  }

  // The object the hands hold for a weapon id: the grapple has its own launcher, fists nothing
  heldKind(id = this.weaponId) {
    const w = WEAPONS[id];
    return !w || w.melee ? null : w.gadget ? 'grapple' : id;
  }

  selectWeapon(id) {
    if (!this.weapons[id] || id === this.weaponId) return;
    this.weaponId = id;
    this.reloadT = 0;
    this.autoReloadT = this.triggerBuffer = this.bloom = this.shotsInBurst = this.hipT = 0;
    if (!HANDLING[id]) this.aimToggle = false;
    // drawn into both hands, then lowered if nothing happens; firing waits for the hands (hero.armed)
    this.combatReadyT = HANDLING[id] ? 1.8 : 0;
    this.cooldown = 0;
    this.hero?.setWeapon(this.heldKind(id));
    this.audio.sfx('reload', this.player.x, this.player.y + 1.2, this.player.z, { intensity: 0.4, rate: 1.4 });
    this.updateKeybar();
  }

  reload() {
    const w = this.weapon, slot = this.weapons[this.weaponId];
    if (w.melee || w.gadget || w.throwable || !slot || this.reloadT > 0 || slot.mag >= w.mag || slot.ammo <= 0) return;
    this.reloadT = w.reload;
    this.autoReloadT = this.triggerBuffer = 0;
    this.audio.sfx('reload', this.player.x, this.player.y + 1.2, this.player.z);
  }

  updateWeapons(dt) {
    const w = this.weapon, slot = this.weapons[this.weaponId];
    const handling = w.handling;
    const fireHeld = this.fireHeld || Boolean(this.gamepad?.fire);
    const firePressed = this.firePressed || Boolean(this.gamepad?.firePressed);
    if (firePressed && this.gamepad) this.gamepad.bufferedShot = !this.firePressed && !!handling;
    // Carry fractional cadence forward while an automatic trigger is held, without accumulating paused shots.
    this.cooldown = Math.max(w.auto && fireHeld ? -Math.min(dt, 0.05) : 0, this.cooldown - dt);
    this.triggerBuffer = firePressed && handling ? 0.14 : Math.max(0, this.triggerBuffer - dt);
    this.combatReadyT = Math.max(0, this.combatReadyT - dt);
    this.hipT = Math.max(0, this.hipT - dt);
    this.strafeT = Math.max(0, this.strafeT - dt);
    if (this.pumpEjectT > 0 && (this.pumpEjectT -= dt) <= 0) this.ejectBrass('shotgun', false);
    this.bloom *= Math.exp(-dt * (handling?.recovery || 8));
    const person = this.person;
    const rig = person.rig;
    const onFoot = this.state === 'onFoot' || this.state === 'surfing';
    const aiming = this.isAiming();
    // Someone awake and hostile close by keeps both hands on the weapon
    this.threatT -= dt;
    if (this.threatT <= 0) {
      this.threatT = 0.4;
      this.threatNear = this.wanted.level > 0 || this.actors.actors.some((a) => !a.dead && a.hostile && a.alert && Math.hypot(a.x - this.player.x, a.z - this.player.z) < 55);
    }
    const sprinting = this.controllers.keys.run && person.speed > 4.6;
    // In the hands and steady. A weapon still on its way out of the holster cannot fire; the press is kept for it.
    const drawn = w.melee || this.hero.armed;
    rig.gunReady = onFoot && !!handling && !sprinting && (aiming || this.combatReadyT > 0 || this.reloadT > 0 || this.threatNear);
    this.assistAim(dt, aiming && onFoot && !!handling);
    this.camera.aimMode = aiming;
    this.camera.aimFov = w.aimFov;
    this.camera.combatMode = onFoot && !!handling && (rig.gunReady || this.hipT > 0);
    if (!onFoot) this.aimToggle = false;
    if (this.autoReloadT > 0) {
      this.autoReloadT = Math.max(0, this.autoReloadT - dt);
      if (!this.autoReloadT && (onFoot || this.state === 'driving')) this.reload();
    }
    if (this.reloadT > 0) {
      const previous = 1 - this.reloadT / w.reload;
      this.reloadT -= dt;
      const progress = 1 - this.reloadT / w.reload;
      if (previous < 0.58 && progress >= 0.58) this.audio.sfx('reloadInsert', this.player.x, this.player.y + 1.3, this.player.z);
      if (previous < 0.85 && progress >= 0.85) this.audio.sfx('reloadRack', this.player.x, this.player.y + 1.3, this.player.z);
      if (this.reloadT <= 0 && slot) {
        this.reloadT = 0;
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

    if (firePressed && !drawn && handling) this.triggerBuffer = 0.5;
    const shooting = onFoot && !this.arsenal.open && (w.auto ? fireHeld : handling ? this.triggerBuffer > 0 : firePressed);
    // Drive-by: aim out of the driver's window with a one-handed or compact weapon
    const driveBy = Boolean(this.canDriveBy && !this.arsenal.open && (this.aimHeld || this.gamepad?.aim));
    this.world.ignoreCar = this.state === 'driving' ? this.car : null;
    if (driveBy) {
      this.hud.setCrosshair(true, w.spread + 0.02);
      if ((w.auto ? fireHeld : firePressed) && this.cooldown <= 0 && this.reloadT <= 0) {
        if (slot.mag > 0) this.fire(w, slot, true);
        else if (slot.ammo > 0) this.reload();
      }
    }
    // Arms: raised while aiming or just after a shot
    const raised = onFoot && !w.melee && !w.throwable && (aiming || this.hipT > 0 || shooting && !!handling);
    rig.reloading = this.reloadT > 0 ? 1 - this.reloadT / w.reload : -1;
    // Sacha looks where the player looks
    if (onFoot) rig.lookTarget = clamp(angleDelta(rig.yaw, this.camera.footYaw), -1.1, 1.1);
    if (raised && !w.melee && !w.gadget) {
      this.holdUpT = (this.holdUpT ?? 0) - dt;
      if (this.holdUpT <= 0) {
        this.holdUpT = 0.25;
        this.traffic.pedestrians.holdUp(this.player.x, this.player.z, Math.sin(this.camera.footYaw), Math.cos(this.camera.footYaw));
      }
    }
    if (raised) {
      this.aimPoint();
      const aim = rig.aim ??= {};
      Object.assign(aim, { x: _aim.x, y: _aim.y, z: _aim.z, twoHanded: true, stance: w.hands === 2 ? 'rifle' : 'pistol', shoulder: this.camera.shoulderSide });
    } else rig.aim = null;
    this.player.threat = !w.gadget && (raised || this.cooldown > 0);

    this.spread += ((aiming ? 0 : 0.6) + Math.min(1, person.speed / 4) * 0.6 - this.spread) * Math.min(1, dt * 6);
    // the grapple's sight shows while aiming, and all the time in the air where it is the only thing in hand
    const hookSight = w.gadget && (aiming || this.state === 'falling' || (this.vertical.owns(this.state) && this.state !== 'climbing' && this.state !== 'surfing'));
    this.muzzleBlocked = false;
    // smoke stays on a hot muzzle as it moves
    if (onFoot && handling && drawn) this.fx.trackMuzzle('player', this.hero.muzzle(_muzzle), this.hero.barrel(_dir));
    if (onFoot && handling && drawn && (aiming || this.hipT > 0)) {
      this.hero.muzzle(_muzzle);
      this.muzzleBlocked = !!muzzleObstruction(this.world, this.player, _muzzle);
    }
    if (!driveBy) this.hud.setCrosshair(hookSight || (onFoot && !w.melee && !w.gadget && (aiming || this.hipT > 0 || fireHeld)),
      w.gadget ? 0.01 : gunSpread(w, aiming, person.speed, this.bloom), { aiming, shotgun: w.id === 'shotgun', blocked: this.muzzleBlocked,
        hostile: raised && this.sightHit?.kind === 'actor' && !!this.sightHit.target?.hostile, locked: this.locked });

    if (shooting && drawn && this.cooldown <= 0 && (this.state === 'onFoot' || this.state === 'surfing')) {
      if (w.melee) {
        this.cooldown = w.interval;
        this.punchT = 0.38;
        this.punchHit = false;
        person.heading = this.camera.footYaw;
        rig.punchSide = 1 - rig.punchSide; // one hand, then the other
      } else if (w.throwable) {
        if (slot.mag > 0) this.throwGrenade(w, slot);
      } else if (w.gadget) {
        if (firePressed) { this.cooldown = w.interval; person.heading = this.camera.footYaw; this.vertical.fire(); }
      } else if (this.reloadT <= 0) {
        if (slot.mag > 0) this.fire(w, slot);
        else if (slot.ammo > 0) this.reload();
        else if (firePressed) { this.audio.sfx('dry', this.player.x, this.player.y + 1.2, this.player.z); this.cooldown = 0.3; }
      }
    }
    // In the air or on a rope the grapple fires along the view, no aiming needed
    if (w.gadget && firePressed && this.cooldown <= 0 && (this.state === 'falling' || (this.vertical.owns(this.state) && this.state !== 'surfing'))) {
      this.cooldown = w.interval;
      this.vertical.fire();
    }
    this.firePressed = false;
    if (this.gamepad && !this.triggerBuffer) this.gamepad.bufferedShot = false;
    this.hud.setWeapon(w.name, w.melee || w.gadget ? w.sub.toUpperCase() : w.throwable ? `× ${slot.mag}` : `${slot.mag} / ${slot.ammo}${this.reloadT > 0 ? ' · RECHARGE' : ''}`);
    this.hud.setCombat({ visible: !!handling && (onFoot || driveBy), aiming, mag: slot?.mag, capacity: w.mag, reserve: slot?.ammo,
      reload: this.reloadT > 0 ? 1 - this.reloadT / w.reload : -1, mode: w.auto ? 'AUTOMATIQUE' : w.id === 'shotgun' ? 'POMPE' : 'SEMI-AUTO', shoulder: this.camera.shoulderSide });
    this.updateGrenades(dt);
  }

  // Assisted aim: raising the sights near someone hostile brings them onto his chest, follows a moment and lets go
  assistAim(dt, aiming) {
    const cam = this.camera, eye = cam.camera.position, list = this.assistTargets;
    list.length = 0;
    if (aiming && this.aimAssist.enabled) {
      for (const a of this.actors.actors) {
        if (a.dead || !a.hostile || Math.hypot(a.x - eye.x, a.z - eye.z) > 80) continue;
        list.push({ ref: a, x: a.x, y: a.y + (a.height ?? 1.85) * 0.72, z: a.z, dead: a.dead });
      }
    }
    const to = this.aimAssist.update(dt, aiming, eye, cam.footYaw, cam.orbitPitchOffset, list,
      (c) => lineOfSight(this.controllers, eye.x, eye.y, eye.z, c.x, c.y, c.z));
    if (to) { cam.footYaw = to.yaw; cam.orbitPitchOffset = clamp(to.pitch, -0.95, 1.05); }
    this.locked = !!to;
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
      // the grenade that was in the hand, tumbling: same model, shaders already compiled behind the loading screen
      this.grenadePool = Array.from({ length: 8 }, () => { const m = createWeaponModel('grenade'); m.matrixAutoUpdate = true; m.visible = false; this.scene.add(m); return m; });
      this.grenades = [];
    }
    const mesh = this.grenadePool.find((m) => !m.visible) || this.grenadePool[0];
    mesh.visible = true;
    this.grenades.push({ pos: start, vel, fuse: 2.3, mesh });
    this.audio.sfx('throw', start.x, start.y, start.z);
    if (slot.mag === 0) {
      const next = WEAPON_ORDER.filter((id) => this.weapons[id] && id !== 'grenade' && !WEAPONS[id].gadget).pop();
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
    sightOrigin(cam.position, _camDir, this.player, _aim);
    const h = castShot(this.world, _aim.x, _aim.y, _aim.z, _camDir.x, _camDir.y, _camDir.z, this.weapon.range || 220, this.player);
    this.sightHit = h;
    // a paper target of CALIBRE's range under the sights: the bullet is sent to the sheet, not to the wall behind it
    const paper = this.calibre?.muffled ? this.calibre.sight(_aim, _camDir, Number.isFinite(h.t) ? h.t : 220) : -1;
    if (paper > 0) _aim.addScaledVector(_camDir, paper);
    else _aim.set(h.x, h.y, h.z);
    return _aim;
  }

  fire(w, slot, fromCar = false) {
    slot.mag--;
    this.cooldown = Math.max(-0.05, this.cooldown) + w.interval * (fromCar ? 1.25 : 1);
    this.triggerBuffer = 0;
    this.combatReadyT = 3.4; this.hipT = 0.55; this.strafeT = 1.3;
    if (this.clock - this.lastGunShot > Math.max(0.28, w.interval * 1.7)) this.shotsInBurst = 0;
    this.lastGunShot = this.clock;
    this.stats.shots++;
    const person = this.person;
    this.aimPoint();
    if (fromCar) {
      // the driver's window (+x of the car frame)
      const c = this.car, h = c.heading;
      _muzzle.set(c.position.x + Math.cos(h) * 1.05 + Math.sin(h) * 0.25, 1.3, c.position.z - Math.sin(h) * 1.05 + Math.cos(h) * 0.25);
    } else {
      person.heading = this.camera.footYaw;
      this.hero.prepareShot(_aim, person.heading);
      this.hero.muzzle(_muzzle);
      this.hero.fired();
    }
    _dir.copy(_aim).sub(_muzzle).normalize();
    const spread = fromCar ? w.spread + 0.012 + Math.min(0.03, Math.abs(this.car.speed) * 0.0012) : gunSpread(w, this.isAiming(), person.speed, this.bloom);
    const obstruction = fromCar ? null : muzzleObstruction(this.world, this.player, _muzzle);
    // Flash and tracer start on this side of cover when the visual barrel extends through it.
    if (obstruction) _muzzle.set(obstruction.x + obstruction.nx * 0.025, obstruction.y + obstruction.ny * 0.025, obstruction.z + obstruction.nz * 0.025);
    const pellets = w.pellets || 1;
    // On CALIBRE's range the walls keep the noise in: the paper is shot at, nobody runs, nobody calls the police
    const ranged = !fromCar && !!this.calibre?.muffled;
    let landed = false, killed = false, headshot = false;
    for (let i = 0; i < pellets; i++) {
      spreadDirection(_dir.x, _dir.y, _dir.z, spread, _v);
      const h = obstruction || castShot(this.world, _muzzle.x, _muzzle.y, _muzzle.z, _v.x, _v.y, _v.z, w.range, this.player);
      // through a paper target of CALIBRE's range on its way (calibre.js)
      if (ranged) this.calibre.shot(_muzzle, _v, Number.isFinite(h.t) ? h.t : w.range);
      if (i === 0 || i % 3 === 0) this.fx.tracer(_muzzle, h, pellets > 1 ? 'shotgun' : undefined);
      const r = this.applyShot(h, gunDamage(w, h.t), 'player');
      landed ||= r.hit; killed ||= r.kill;
      headshot ||= r.headshot;
    }
    if (ranged) this.calibre.range.fired();
    if (landed) {
      this.hud.hit(killed, headshot);
      this.audio.ui(killed ? 'killConfirm' : headshot ? 'headshot' : 'hitConfirm');
    }
    // The last man of a fight falls in slow motion: the street holds its breath, then the noise comes back
    if (killed && !fromCar && this.clock > (this.slowAgain ?? 0) && !this.slowMo
      && !this.actors.actors.some((a) => !a.dead && a.hostile && a.alert && Math.hypot(a.x - this.player.x, a.z - this.player.z) < 70)) {
      this.slowMo = 0.7;
      this.slowAgain = this.clock + 8;
    }
    this.hud.shot(w.id === 'shotgun' ? 1.6 : w.id === 'pistol' ? 1 : 0.65);
    // the smoke of a shot from a moving car is left behind it
    _flashOpts.vx = fromCar ? Math.sin(this.car.heading) * this.car.speed : 0;
    _flashOpts.vz = fromCar ? Math.cos(this.car.heading) * this.car.speed : 0;
    _flashOpts.scale = w.flash; // a suppressor leaves a spark where there was a flame
    this.fx.muzzleFlash(_muzzle, _dir, w.id, _flashOpts);
    // A pump keeps its hull until the fore-end comes back; self-loaders throw theirs at once
    if (w.id === 'shotgun' && !fromCar) this.pumpEjectT = 0.3;
    else this.ejectBrass(w.id, fromCar);
    this.audio.sfx(w.sound, _muzzle.x, _muzzle.y, _muzzle.z);
    if (!ranged) this.birds?.scatter(_muzzle.x, _muzzle.z, w.noise.birds);
    const handling = w.handling;
    this.bloom = Math.min(handling.maxBloom, this.bloom + handling.bloom);
    const side = Math.sin(++this.shotsInBurst * 2.4) * w.recoil * 0.2;
    this.camera.addRecoil(w.recoil * (this.isAiming() ? 0.9 : 1.15), side);
    // Gunfire empties the street and calls the police if anyone notices. A suppressed shot carries a few metres:
    // those who run from it saw the gun, nobody further heard it, and only an officer close by makes it a crime
    const noise = w.noise;
    const panicked = ranged ? 0 : this.traffic.pedestrians.panic(this.player.x, this.player.z, noise.panic, 12);
    if (!ranged) this.traffic.flee(this.player.x, this.player.z, noise.flee, 7);
    if (!ranged && this.clock - this.lastCrimeShot > 1.5) {
      this.lastCrimeShot = this.clock;
      if ((noise.witnesses && panicked > 0) || this.policeNear(noise.police) || this.wanted.level > 0) this.crime('shots', this.player.x, this.player.z);
    }
    if (slot.mag === 0 && slot.ammo > 0) this.autoReloadT = 0.18;
  }

  // A spent case leaves the weapon in hand by its own port (the driver's window from a car)
  ejectBrass(kind, fromCar) {
    const person = this.person;
    if (fromCar || !this.hero.ejection(_port, _gunRight, _gunUp)) { this.fx.ejectCasing(_muzzle, _dir, kind, fromCar ? 0 : person.position.y); return; }
    this.fx.ejectCasing(this.hero.muzzle(_v), this.hero.barrel(_barrel), kind, person.position.y, _casingOpts);
  }

  // Blood leaves a body the way the bullet was going: on the wall behind if there is one within reach
  bleed(h, groundY, killed) {
    _hitOpts.dir.x = h.dx ?? -h.nx; _hitOpts.dir.y = h.dy ?? -h.ny; _hitOpts.dir.z = h.dz ?? -h.nz;
    _hitOpts.decal = undefined;
    this.fx.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, 'flesh', _hitOpts);
    const d = _hitOpts.dir;
    const t = raycastBuildings(this.controllers, h.x, h.y, h.z, d.x, d.y, d.z, 2.4, _wallHit, false);
    if (t < 2.4 && Math.abs(_wallHit.ny) < 0.5) this.fx.bloodSplatter(h.x + d.x * t + _wallHit.nx * 0.01, h.y + d.y * t, h.z + d.z * t + _wallHit.nz * 0.01, _wallHit.nx, _wallHit.ny, _wallHit.nz, 0.35 + Math.random() * 0.3);
    if (killed) this.fx.bloodStain(h.x + d.x * 0.5, groundY, h.z + d.z * 0.5, 0.5 + Math.random() * 0.35);
  }

  // What a bullet finds when it strikes the city: the roadway, the sidewalk, a trunk, a pole, a wall
  surfaceOf(h) {
    if (h.kind === 'ground') return h.y > 0.12 ? 'concrete' : 'asphalt';
    const c = h.target;
    if (c?.obstacle === 'tree') return 'wood';
    if (c?.obstacle === 'rock') return 'concrete';
    if (c?.round) return c.obstacle === 'table' ? 'wood' : 'metal';
    return 'concrete';
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
      else if (a.team === 'calibre') this.crime(a.dead ? 'pedKilled' : 'pedHit', a.x, a.z);
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
        this.bleed(h, groundY, p.hp <= 0);
        if (p.hp <= 0) {
          this.killPed(p, Math.atan2(dir.x, dir.z), 0.8, byPlayer ? 'player' : 'npc');
          return { hit: true, kill: true, headshot: mult > 1 };
        }
        this.traffic.pedestrians.panic(p.x, p.z, 20, 12);
        if (byPlayer) this.crime('pedHit', p.x, p.z);
        return { hit: true, kill: false, headshot: mult > 1 };
      }
      case 'actor': {
        const a = h.target;
        if (shooter && shooter.team && shooter.team === a.team) return { hit: false };
        // a bare head does not take a bullet; a helmet or a vest (armour) still turns one
        const mult = head(h.y, a.y) ? (a.armor > 0 ? 2.6 : 4) : 1;
        const wasAlive = !a.dead;
        this.actors.damage(a, damage * mult, dir.x, dir.z, 'shot');
        this.bleed(h, a.y, wasAlive && a.dead);
        if (byPlayer) {
          this.actors.alertTeam(a.team, a.x, a.z, this.weapon.noise.alert);
          if (a.team === 'police') this.crime(a.dead ? 'copKilled' : 'copHurt', a.x, a.z);
          else if (a.team === 'calibre') this.crime(a.dead ? 'pedKilled' : 'pedHit', a.x, a.z);
        }
        return { hit: true, kill: wasAlive && a.dead, headshot: mult > 1 };
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
      case 'parked': {
        // the first bullet turns the parked car loose; it takes the damage as any gameplay car
        this.fx.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, 'metal');
        this.audio.sfx('impactMetal', h.x, h.y, h.z);
        const c = this.takeParked(h.target, true);
        if (c && !c.destroyed) this.damageCar(c, damage * 0.4, 'shot');
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
        if (shooter) { this.lastHitBy = shooter; this.lastHitAt = this.clock; }
        if (h.melee) this.audio.sfx('punch', h.x, h.y, h.z);
        else this.fx.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, this.player.inVehicle ? 'metal' : 'flesh');
        if (this.player.inVehicle && !this.car.moto) {
          this.damageCar(this.car, damage * 0.3, 'shot');
          this.damagePlayer(damage * 0.25, 'shot');
        } else this.damagePlayer(damage, h.melee ? 'melee' : 'shot');
        return { hit: true };
      }
      case 'building':
      case 'ground':
        _hitOpts.dir.x = h.dx ?? -h.nx; _hitOpts.dir.y = h.dy ?? -h.ny; _hitOpts.dir.z = h.dz ?? -h.nz;
        // a pole is metal that stays where it is: it keeps its holes, unlike a car
        _hitOpts.decal = h.kind === 'building' && this.surfaceOf(h) === 'metal' && !h.target?.breakable ? true : undefined;
        this.fx.impact(h.x, h.y, h.z, h.nx, h.ny, h.nz, this.surfaceOf(h), _hitOpts);
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
    this.gangs.onKilled(actor);
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

  // One crash reaches the collision listener many times, every physics step of the contact and from both cars: only its
  // hardest moment counts. Returns the closing speed already counted for this crash (0 for a new one).
  crashPeak(target, speed) {
    const fresh = !(this.clock - (target.hitAt ?? -9) < 0.4);
    const before = fresh ? 0 : target.hitPeak ?? 0;
    target.hitAt = this.clock;
    if (speed > before) target.hitPeak = speed;
    return before;
  }

  damageCar(car, amount, cause) {
    if (car.destroyed || car.hp === undefined || !(amount > 0)) return;
    car.hp = Math.max(0, car.hp - amount);
    if (car.hp <= 0 && !car.burnT) {
      // The player gets the time to bail out of a burning car
      car.burnT = cause === 'explosion' ? 0.4 : car === this.car ? 9 + Math.random() * 2 : 5 + Math.random() * 2;
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
      // A badly hurt engine coughs along at half power: the car is telling you it has had enough
      if (car.body) car.body.power = car.hp < 30 ? 0.5 + car.hp / 60 : 1;
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

  // A burnt-out vehicle of the given model, waiting out of sight (createCarEntity, burnt)
  makeWreck(kind) {
    const car = this.controllers.createCarEntity({ kind, burnt: true });
    car.wreck = true; car.destroyed = true; car.hp = 0; car.burnT = 0; car.smokeT = 0; car.standing = false;
    car.body.q[1] = 0; car.body.q[3] = 1; car.body.r[0] = car.body.r[4] = car.body.r[8] = 1;
    // down on its burst tyres, a little askew
    const n = this.wrecks.length;
    car.bodyPivot.position.y = -0.05;
    car.bodyPivot.rotation.z = (n % 2 ? 1 : -1) * 0.022;
    car.bodyPivot.rotation.x = ((n % 3) - 1) * 0.012;
    car.position.set(-20 - n * 7, -40, -3000);
    car.mesh.position.copy(car.position);
    car.mesh.updateMatrixWorld();
    this.wrecks.push(car);
    return car;
  }

  // The burnt-out body that takes the place of a vehicle of model `kind` where it blew up. One of that model lying
  // idle, else a second one (its materials are the street's, already compiled), else the oldest of that model again.
  placeWreck(x, z, heading, kind = 'sedan', burn = 22) {
    if (!this.wreckKinds.includes(kind)) kind = 'sedan';
    const same = this.wrecks.filter((c) => c.kind === kind);
    const w = same.find((c) => !c.standing) || (same.length < WRECKS_PER_KIND ? this.makeWreck(kind) : same.reduce((a, b) => (a.placedAt < b.placedAt ? a : b)));
    w.position.set(x, 0, z);
    w.heading = heading;
    w.prevX = x; w.prevZ = z;
    w.speed = w.vx = w.vz = w.angularVel = 0;
    w.burnT = burn; w.smokeT = 60;
    w.standing = true; w.placedAt = this.clock;
    w.mesh.visible = true;
    w.mesh.position.copy(w.position);
    w.mesh.rotation.y = heading;
    w.mesh.updateMatrixWorld();
    // too many in the street: the oldest is cleared away
    const standing = this.wrecks.filter((c) => c.standing);
    if (standing.length > WRECK_MAX) {
      const old = standing.reduce((a, b) => (a.placedAt < b.placedAt ? a : b));
      old.standing = false; old.burnT = old.smokeT = 0;
      old.mesh.visible = false;
      old.position.set(old.position.x, -40, old.position.z);
      old.mesh.position.copy(old.position);
      old.mesh.updateMatrixWorld();
    }
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
    if (!car.moto && !car.mode && !car.boat) this.placeWreck(x, z, heading, car.kind);
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
    this.placeWreck(x, z, heading, v.bus ? 'bus' : v.bodyType);
    this.explode(x, 0.8, z, 0.85, generation ? 'chain' : 'player', generation);
    this.stats.cars++;
  }

  // generation: 0 for a blast the player caused, 1+ for the cars it set off in turn (weaker, bounded)
  explode(x, y, z, power = 1, cause = 'npc', generation = 0) {
    this.birds?.scatter(x, z, 70);
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
      // the player's own car took its share of the blast above, with the player in it
      const hurt = !(c === this.car && this.player.inVehicle);
      if (d < 0.5 || d > radius * 1.2) continue;
      const k = 1 - d / (radius * 1.2);
      if (hurt) this.damageCar(c, 90 * k * (generation ? 0.5 : 1), 'explosion');
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
    // a death the Architect dealt costs nothing at the hospital (ARCHITECTE.md)
    this.spared = !!this.lastHitBy?.architect && this.clock - (this.lastHitAt ?? -9) < 2;
    const p = this.person;
    this.vertical.reset();
    const floorY = p.position.y + 0.3; // a body on a roof falls on the roof (or off its edge)
    if (this.state === 'driving') {
      const car = this.car;
      p.inVehicle = false;
      p.position.set(car.position.x + Math.cos(car.heading) * 1.6, this.controllers.getGroundHeight(car.position.x, car.position.z, 'person'), car.position.z - Math.sin(car.heading) * 1.6);
      this.onMode('person');
      p.rig.reset(p.position.x, p.position.z, p.heading, (c, x, z) => c.getGroundHeight(x, z, 'person'), this.controllers);
    }
    if (!p.rig.limp) {
      collapse(p.rig, { ground: (x, z) => this.controllers.getGroundHeight(x, z, 'person', floorY), vx: p.rig.vx, vz: p.rig.vz,
        dirX: Math.sin(this.lastHitHeading ?? p.heading + Math.PI), dirZ: Math.cos(this.lastHitHeading ?? p.heading + Math.PI), cause: cause === 'explosion' ? 'explosion' : 'shot' });
    }
    this.transition = null;
    this.state = 'dead';
    this.cancelWeaponActions();
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
    this.vertical.reset();
    this.state = 'busted';
    this.cancelWeaponActions();
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
    // Killed by the Architect: it costs nothing (ARCHITECTE.md)
    const spared = dead && this.spared;
    const fee = spared ? 0 : Math.min(Math.round(this.money * 0.08), dead ? 1500 : 2500);
    this.money = Math.max(0, this.money - fee);
    this.hud.setMoney(this.money);
    this.rearm();
    this.wanted.reset();
    this.actors.clear((a) => a.dead || a.team === 'police');
    this.roofPolice.reset();
    this.health = 100;
    if (dead && !spared) this.armor = 0;
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
    this.toast(best.name, spared ? 'Soins offerts : l’Architecte ne fait pas payer ses leçons' : `${dead ? 'Soins' : 'Caution'} : ${fee.toLocaleString('fr-FR')} $ · armes conservées`);
    this.save();
  }

  // Back on the street with every weapon, ready to fire; a gun shot dry comes back with one magazine
  rearm() {
    for (const [id, slot] of Object.entries(this.weapons)) {
      const w = effectiveWeapon(id, this.mods[id]);
      if (w.melee || w.throwable || w.gadget) continue;
      if (slot.mag + slot.ammo === 0) slot.mag = w.mag;
      else { const take = Math.min(w.mag - slot.mag, slot.ammo); slot.mag += take; slot.ammo -= take; }
    }
    this.cancelWeaponActions();
  }

  teleportPlayer(x, z) {
    if (this.state === 'driving') {
      this.person.inVehicle = false;
      this.state = 'onFoot';
      this.onMode('person');
    }
    if (this.vertical.owns(this.state)) this.state = 'onFoot';
    this.vertical.reset();
    const p = this.person;
    p.position.set(x, this.controllers.getGroundHeight(x, z, 'person'), z);
    p.verticalVel = 0;
    p.footing = p.position.y;
    p.rig.reset(x, z, p.heading, (c, px, pz) => c.personGroundAt(px, pz), this.controllers);
    this.camera.resetForTeleport();
    this.camera.initialized = false;
    document.body.dataset.gameState = this.state;
  }

  // A clear spot near (x, z) outside every building footprint
  safeSpot(x, z, radius = 0.6) {
    const footprint = { radius };
    const clear = (px, pz) => {
      for (const c of this.controllers.nearColliders(px, pz, radius + 2)) {
        if ((c.minY ?? 0) > 2) continue;
        if (px < c.minX - radius || px > c.maxX + radius || pz < c.minZ - radius || pz > c.maxZ + radius) continue;
        if (c.polygon) { if (polygonContact(c.polygon, px, pz, footprint)) return false; continue; }
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
      if (d < (car.boat ? 7 : nearest) && Math.abs(car.position.y - person.position.y) < (car.boat ? 3 : 1) && Math.abs(car.speed) < 2) { best = { car, distance: d }; nearest = d; }
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
    // Cars parked along the curb (parking.js)
    this.parking?.forEachNear(person.position.x, person.position.z, 5.5, (i) => {
      const s = this.parking.info(i);
      const door = doorPosition({ position: { x: s.x, z: s.z }, heading: s.yaw });
      const d = Math.hypot(door.x - person.position.x, door.z - person.position.z);
      if (d < nearest) { best = { parked: i, distance: d }; nearest = d; }
    });
    return best;
  }

  // The parked car in slot i leaves the curb as a gameplay car (lite: drawn with the street's compiled materials, so a
  // pile-up never stalls a frame; the player's own ride gets the full car when stolen, see interact())
  takeParked(i, lite = true) {
    const s = this.parking?.release(i);
    if (!s) return null;
    const car = this.makeCar(s.kind, s.paint, new THREE.Vector3(s.x, 0, s.z), s.yaw, false, lite);
    car.hp = 100;
    // a knocked or broken-into car's alarm goes off, some of the time
    if (Math.random() < (lite ? 0.3 : 0.5)) this.audio.ambienceEvent?.('alarm', s.x, 0.8, s.z);
    return car;
  }

  // controllers.onParkedHit: a car (the player's, a cruiser, a mission car) drove into a parked one. Returns true when
  // the parked car has been turned loose and the collider must be ignored this frame.
  hitParked(c, car) {
    const speed = Math.abs(car.speed || 0) + Math.hypot(car.vx || 0, car.vz || 0) + Math.hypot(car.body?.vx || 0, car.body?.vz || 0);
    if (speed < 1.1) return false;
    const pl = this.player;
    // far from the player (an AI car cutting a corner across town) the parked car simply stands firm
    if (Math.hypot(c.obb.cx - pl.x, c.obb.cz - pl.z) > 140) return false;
    const loose = this.takeParked(c.parked, true);
    if (!loose) return false;
    if (car === this.car && this.state === 'driving' && speed > 6) this.camera.addShake(Math.min(0.5, speed * 0.03));
    return true;
  }

  interact() {
    // a jump only when there is air under the aircraft: set down on a roof, it is an ordinary exit
    const air = this.car.position;
    if (this.active && this.state === 'driving' && this.car.air && air.y - this.controllers.getGroundHeight(air.x, air.z, 'helicopter', air.y) > 3) { this.bailOut(); return; }
    if (this.active && this.calibre?.interact()) return;
    if (this.active && this.vertical.interact()) return;
    if (!this.active || !canInteract(this.state, this.car.speed)) {
      if (this.state === 'driving') this.toast('Ralentissez', 'Arrêtez le véhicule pour descendre.');
      return;
    }
    if (this.state === 'driving' && this.car.boat) { this.leaveBoat(); return; }
    if (this.state === 'driving') { this.beginExit(); return; }
    const candidate = this.findCandidate();
    if (!candidate) return;
    let car = candidate.car;
    if (car?.ai) car.ai = null; // a mission car the player takes over
    if (!car && candidate.parked !== undefined) {
      car = this.takeParked(candidate.parked, false);
      if (!car) return;
      car.stolen = true;
      if (this.policeNear(40) || this.wanted.level > 0) this.crime('carjack', car.position.x, car.position.z);
    } else if (!car) {
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
    // in a hurry (still pushing forward, or wanted) the whole thing goes at 0.7 x the time
    const hurry = Boolean(this.controllers.keys.forward || this.controllers.keys.run) || this.wanted.level > 0;
    this.controllers.resetInput();
    this.controllers.entities.car = car;
    const door = doorPosition(car);
    this.state = 'entering';
    this.transition = { time: 0, car, start: person.position.clone(), startHeading: person.heading, door, entering: true };
    this.planTransition(this.transition, hurry);
    this.ui['game-prompt'].classList.remove('visible');
    document.body.dataset.gameState = this.state;
    person.rig.aim = null;
    this.camera.aimMode = false;
  }

  // Out of the aircraft, under a canopy; the aircraft flies on by itself
  // Ashore if a quay is close, over the side if not
  leaveBoat() {
    const boat = this.car, p = this.person;
    boat.ridden = false;
    const land = this.landNear(boat.position.x, boat.position.z, 22);
    if (land) {
      p.inVehicle = false;
      p.position.set(land.x, this.controllers.getGroundHeight(land.x, land.z, 'person'), land.z);
      this.state = 'onFoot';
      this.onMode('person');
      this.radio?.setPlaying(false);
      document.body.dataset.gameState = this.state;
      this.updateKeybar();
    } else {
      const s = Math.sin(boat.heading), c = Math.cos(boat.heading);
      this.enterWater(boat.position.x + c * 2.4, boat.position.z - s * 2.4);
    }
  }

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
    this.onMode('person');
    this.radio?.setPlaying(false);
    this.audio.ui('pass');
    // High enough, the jump is a free fall (and the wingsuit is a key away); low, the canopy opens at once
    const height = p.position.y - this.controllers.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y);
    const speed = car.mode === 'plane' ? car.speed ?? 0 : (car.speed ?? 0) * 0.6;
    if (height > 60) {
      this.vertical.startFreefall(Math.sin(h) * speed, Math.min(0, car.verticalSpeed ?? 0) - 2, Math.cos(h) * speed);
      return;
    }
    this.vertical.startCanopy(Math.sin(h) * speed, Math.min(0, car.verticalSpeed ?? 0) - 2, Math.cos(h) * speed);
  }

  beginExit() {
    const car = this.car;
    let exit = null, scripted = false;
    const blocked = (point) => this.controllers.nearColliders(point.x, point.z, 2)
      .some(c => point.x > c.minX - 0.35 && point.x < c.maxX + 0.35 && point.z > c.minZ - 0.35 && point.z < c.maxZ + 0.35 && (c.minY ?? 0) < point.y + 1.8 && c.maxY > point.y + 0.2);
    // The driver's door, climbed out of (vehicle-entry.js): the step clear of the door must be free
    if (this.choreographed(car)) {
      const c = entryStations(carFrame(car.spec, car.cabin.layout, this.person.rig.s)).clear;
      this.carWorld(car, c.x, 0, c.z, _v);
      const point = new THREE.Vector3(_v.x, car.position.y, _v.z);
      if (!blocked(point)) { exit = point; scripted = true; }
    }
    // Otherwise a slide out of whichever side is clear
    if (!exit) for (const side of [1, -1]) {
      const door = doorPosition(car, side);
      const point = new THREE.Vector3(door.x + Math.cos(car.heading) * 0.35 * side, car.position.y, door.z - Math.sin(car.heading) * 0.35 * side);
      if (blocked(point)) continue;
      exit = point; break;
    }
    if (!exit) { this.toast('Sortie bloquée', 'Déplacez la voiture pour dégager une portière.'); return; }
    const hurry = Boolean(this.controllers.keys.forward) || this.wanted.level > 0;
    this.controllers.resetInput(); car.speed = car.vx = car.vz = car.angularVel = 0;
    this.state = 'exiting';
    this.transition = { time: 0, car, exit, entering: false };
    if (scripted) {
      this.planTransition(this.transition, hurry);
      // the car's chase framing eases to the walker's while the body climbs out, then it is given back
      this.transition.camera = { distance: car.chaseDistance, height: car.chaseHeight, offsetY: car.cameraTargetOffset.y };
    }
    document.body.dataset.gameState = this.state;
    this.radio?.setPlaying(false);
  }

  updateTransition(dt) {
    const t = this.transition;
    if (!t) return;
    t.time += dt;
    if (t.plan) { this.updateChoreography(t); return; }
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
      p.position.y = this.controllers.getGroundHeight(p.position.x, p.position.z, 'person', car.position.y + 0.5);
      p.heading = car.heading;
    }
    if (u >= 1) this.endTransition(t);
  }

  // The last frame of the way in or out: at the wheel, or back on the pavement
  endTransition(t) {
    const p = this.person, car = t.car;
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
      p.position.y = this.controllers.getGroundHeight(p.position.x, p.position.z, 'person', car.position.y + 0.5);
      p.footing = p.position.y;
      this.state = 'onFoot'; this.camera.footYaw = car.heading;
      this.onMode('person');
    }
    if (t.plan) this.releaseChoreography(t);
    this.transition = null;
    this.controllers.resetInput();
    document.body.dataset.gameState = this.state;
    this.updateKeybar(); this.save();
  }

  // ---- The way in and out of a car, as a person does it (vehicle-entry.js) ----------------------------------------------
  // Only a car with a laid-out cabin and a hinged driver's door gets the choreography; bikes, boats, aircraft and the
  // lite street cars keep the slide
  choreographed(car) {
    return Boolean(car?.cabin && car.door && car.bodyPivot && !car.moto && !car.boat && !car.air && !car.bicycle);
  }

  planTransition(t, hurry) {
    const car = t.car, p = this.person;
    if (!this.choreographed(car)) return false;
    const frame = carFrame(car.spec, car.cabin.layout, p.rig.s);
    const pace = hurry ? ENTRY_FAST : 1;
    // the ground beside the door, in the car's frame
    const at = t.entering ? t.door : t.exit;
    const groundY = this.controllers.getGroundHeight(at.x, at.z, 'person', car.position.y + 0.5) - car.position.y;
    if (t.entering) {
      this.carLocal(car, p.position.x, p.position.z, _lp);
      t.plan = planEntry(frame, { x: _lp.x, z: _lp.z }, { groundY, pace });
    } else t.plan = planExit(frame, { groundY, pace });
    t.frame = frame;
    t.sample = this.entrySample ??= createSample();
    this.entryOverlay ??= {
      arms: 'hands', w: 1, head: 0,
      handL: { x: 0, y: 0, z: 0, w: 0, px: 0, py: -1, pz: 0 }, handR: { x: 0, y: 0, z: 0, w: 0, px: 0, py: -1, pz: 0 },
      feet: [{ x: 0, y: 0, z: 0, yaw: 0, w: 0, flat: 1 }, { x: 0, y: 0, z: 0, yaw: 0, w: 0, flat: 1 }]
    };
    return true;
  }

  // The car's frame: +X the driver's side, +Z forward, from its position and heading
  carLocal(car, wx, wz, out) {
    const h = car.heading, dx = wx - car.position.x, dz = wz - car.position.z, c = Math.cos(h), s = Math.sin(h);
    return out.set(dx * c - dz * s, 0, dx * s + dz * c);
  }

  carWorld(car, lx, ly, lz, out) {
    const h = car.heading, c = Math.cos(h), s = Math.sin(h);
    return out.set(car.position.x + lx * c + lz * s, car.position.y + ly, car.position.z - lx * s + lz * c);
  }

  // Every frame of the choreography (before the controllers move anything): this instant's sample, the door's angle,
  // where the person stands (walked there by their rig, or the ground under the scripted body), the hands and feet
  // the body is asked to reach (BodyDriver.overlay, person-motion.js)
  updateChoreography(t) {
    const p = this.person, car = t.car, S = t.sample, rig = p.rig, o = this.entryOverlay, pivot = car.bodyPivot;
    (t.entering ? sampleEntry : sampleExit)(t.plan, t.time, S);
    car.doorOpen = S.door;
    this.carWorld(car, S.x, 0, S.z, _v);
    p.position.x = _v.x; p.position.z = _v.z;
    p.position.y = this.controllers.getGroundHeight(_v.x, _v.z, 'person', car.position.y + 0.5);
    p.footing = p.position.y; p.speed = 0; p.verticalVel = 0;
    p.heading = car.heading + S.yaw;
    // scripted, the walker is no longer the controllers' to pose: drawChoreography sits it on its seat point
    p.inVehicle = S.pose;
    rig.rideFade = t.entering ? 0.15 : 0;
    rig.overlay = o;
    for (let i = 0; i < 2; i++) {
      const h = S.hands[i], oh = i === 0 ? o.handL : o.handR;
      pivot.localToWorld(_v.set(h.x, h.y, h.z)); oh.x = _v.x; oh.y = _v.y; oh.z = _v.z; oh.w = h.w;
      _v.set(h.px, h.py, h.pz).transformDirection(pivot.matrixWorld); oh.px = _v.x; oh.py = _v.y; oh.pz = _v.z;
      const f = S.feet[i], of = o.feet[i];
      pivot.localToWorld(_v.set(f.x, f.y, f.z)); of.x = _v.x; of.y = _v.y; of.z = _v.z;
      of.yaw = car.heading + f.yaw; of.w = S.pose ? f.w : 0; of.flat = f.flat;
    }
    o.head = -S.duck;
    if (S.done) this.endTransition(t);
  }

  // Once the car's matrices are current (update): the walker's chase framing eased into the car's on the way in, the
  // car's into the walker's on the way out; the scripted body sat on its seat point under the car's body, the real
  // wheel and pedals blended in from where hanging hands and standing feet would be as it sits down
  drawChoreography(dt) {
    const t = this.transition, S = t.sample, car = t.car, p = this.person, rig = p.rig, s = rig.s, f = t.frame, k = S.camera;
    if (t.entering) {
      p.chaseDistance = lerp(4.3, car.chaseDistance / Math.cos(0.09), k);
      p.chaseHeight = lerp(1.95, car.chaseHeight - Math.sin(0.09) * car.chaseDistance * 0.85, k);
      p.cameraTargetOffset.y = lerp(this.footCameraY, car.cameraTargetOffset.y + 0.34, k);
      this.camera.footYaw += angleDelta(this.camera.footYaw, car.heading) * (1 - Math.exp(-dt * 3));
    } else if (t.camera) {
      car.chaseDistance = lerp(4.3 * Math.cos(0.09), t.camera.distance, k);
      car.chaseHeight = lerp(1.95 + Math.sin(0.09) * 4.3 * 0.85, t.camera.height, k);
      car.cameraTargetOffset.y = lerp(this.footCameraY - 0.34, t.camera.offsetY, k);
    }
    if (!S.pose || this.camera.activePresetId === 'pov') return;
    const root = _entryRoot, pivot = car.bodyPivot;
    if (root.parent !== pivot) pivot.add(root);
    root.position.set(S.pelvis.x, S.pelvis.y, S.pelvis.z);
    root.rotation.set(0, S.bodyYaw, 0);
    const pose = _entryPose, seated = S.seated;
    pose.seat.set(0, 0, 0);
    pose.wheel.set(0, REST_WHEEL.y * s, REST_WHEEL.z * s + REST_WHEEL.zFixed).lerp(this.toSeat(S, f.wheel[0], f.wheel[1], f.wheel[2], _v), seated);
    restPedals(s, pose.pedals).lerp(this.toSeat(S, f.pedals[0], f.pedals[1], f.pedals[2], _v), seated);
    pose.radius = lerp(REST_WHEEL.radius * s, f.radius, seated);
    pose.tilt = f.tilt;
    pose.turn = clamp(car.cabin.turn, -1.15, 1.15) * seated;
    pose.recline = S.recline; pose.look = S.look;
    rig.drive(root, pose);
    this.hero.setWeapon(null);
    this.hero.update(true, 0, dt);
  }

  // A point of the car's frame in the seat point's frame (at S.pelvis, turned by S.bodyYaw)
  toSeat(S, x, y, z, out) {
    const dx = x - S.pelvis.x, dy = y - S.pelvis.y, dz = z - S.pelvis.z, c = Math.cos(S.bodyYaw), sn = Math.sin(S.bodyYaw);
    return out.set(dx * c - dz * sn, dy, dx * sn + dz * c);
  }

  // The rig is the controllers' again, the car's framing its own
  releaseChoreography(t) {
    const rig = this.person.rig, car = t.car;
    if (rig.overlay === this.entryOverlay) rig.overlay = null;
    rig.rideFade = 0;
    _entryRoot.removeFromParent();
    if (t.camera) { car.chaseDistance = t.camera.distance; car.chaseHeight = t.camera.height; car.cameraTargetOffset.y = t.camera.offsetY; }
  }

  announce(car) {
    const [brand, model] = CAR_NAMES[car.kind] || ['', 'VÉHICULE'];
    const pad = this.gamepad?.using;
    const radio = pad ? '← → : radio' : 'T : radio';
    const drive = pad ? 'A : frein à main · RB : nitro' : 'Maj : nitro · Espace : frein à main';
    const hint = car.police ? 'Véhicule de police : ils ne vous lâcheront pas.' : car.mode === 'plane' ? 'Trop lent, il décroche : gardez de la vitesse.' : car.body ? `${drive} · ${radio}` : radio;
    this.toast(car.label2 || `${brand} ${model}`, hint);
  }

  // ---- Frame -------------------------------------------------------------------------------------------------------
  beforeUpdate(dt) {
    // the camera's look motion this frame, for flight (vertical.js), which also sets its own camera when flying
    this.lookDX = this.camera.lookDX; this.lookDY = this.camera.lookDY;
    this.camera.lookDX = this.camera.lookDY = 0;
    this.camera.flightView = null;
    if (!this.active) {
      this.controllers.resetInput(); this.lookDX = this.lookDY = 0;
      if (!(dt > 0 && this.shops?.open?.calibre)) return;
    }
    if (this.intro) {
      // the opening flight: no control yet; any key or click cuts it short
      if (this.controllers._pressedCodes?.size || this.fireHeld || this.aimHeld) this.endIntro();
      this.controllers.resetInput();
      this.fireHeld = this.firePressed = this.aimHeld = false;
      this.lookDX = this.lookDY = 0;
    }
    // Slow motion breathes in and out on real time, not on its own
    if (this.slowMo > 0) {
      this.slowMo = Math.max(0, this.slowMo - dt / Math.max(this.timeScale, 0.05));
      this.timeScale = this.slowMo > 0.5 ? 0.3 : 1 - 0.7 * this.slowMo / 0.5;
    } else this.timeScale = 1;
    // The weapon wheel holds the street almost still while a weapon is chosen
    this.wheelSlow += ((this.arsenal.open ? 1 : 0) - this.wheelSlow) * Math.min(1, dt / Math.max(this.timeScale, 0.05) * 14);
    if (this.wheelSlow > 0.01) this.timeScale = Math.min(this.timeScale, 1 - 0.88 * this.wheelSlow);
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
      for (const w of this.wrecks) if (!w.standing) w.mesh.visible = false;
      for (const ride of this.rides) if (!this.fleet.includes(ride)) ride.mesh.visible = false;
    }
    const falling = this.state === 'falling';
    const walker = this.person;
    walker.chaseDistance = falling ? 13 : this.calibre?.inside ? 2.4 : 4.3;
    walker.chaseHeight = falling ? 1.4 : 1.95;
    walker.cameraTargetOffset.y = falling ? 3.4 : this.footCameraY;
    this.vertical.frame(walker);
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
    pl.onFoot = this.state === 'onFoot' || this.state === 'down' || this.state === 'surfing';
    this.calibre?.update(dt);
    pl.alive = this.state !== 'dead' && this.state !== 'busted';

    // the grapple's launcher is held like the pistol
    this.hero.setWeapon(pl.onFoot ? this.heldKind() : null);
    // Slung long guns have no room between a back and a car seat: they are out of sight in a closed cabin
    this.hero.showCarried = !(person.inVehicle && this.car?.cabin && !this.car.moto && !this.car.bicycle);
    // In a fully confined corner, hide intersecting geometry while continuing the pose and muzzle simulation.
    this.hero.cameraOccluded = !!this.camera.bodyOccluded;
    for (const m of person.crowd.meshes) m.visible = false;
    if (dt <= 0) this.hero.update(!person.inVehicle, 0, 0);

    if (dt > 0) {
      for (let i = this.jets.length - 1; i >= 0; i--) {
        const jet = this.jets[i];
        jet.life -= dt;
        if (jet.life <= 0) this.jets.splice(i, 1);
        else if (Math.hypot(jet.x - pl.x, jet.z - pl.z) < 120) this.fx.jet(jet.x, jet.y, jet.z, dt);
      }
      if (!this.shops.open?.calibre) this.updateWeapons(dt);
      this.hero.update(!person.inVehicle, 0, dt);
      if (this.state === 'driving' && car.crashed) this.destroyCar(car);
      // Loose cars (parked, pushed, abandoned) roll to a stop under physics; then every gameplay car pair collides
      for (const c of this.allCars) {
        if (c === car && this.state === 'driving') continue;
        if (c.air) { this.flyAbandoned(c, dt); continue; }
        if (c.mode) continue;
        if (c.police && this.wanted.units.some((u) => u.car === c && u.active)) continue;
        if (c.ai && c !== car) continue; // mission AI drives it (mission-director.js)
        const moving = Math.abs(c.speed) > 0.05 || Math.abs(c.vx || 0) + Math.abs(c.vz || 0) > 0.05 || Math.abs(c.angularVel || 0) > 0.02
          || (c.body && !c.wreck && (c.body.grounded < 4 || c.body.r[4] < 0.97));
        if (c.boat) {
          if (c.boatAI) driveBoatAI(c, dt, this.player, this.boatWorld);
          else this.controllers.simulateCar(c, 0, 0, false, dt);
          continue;
        }
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
      this.roofPolice.update(dt);
      this.updateCarDamage(dt);
      this.pickups.update(dt, (x, z) => this.controllers.getGroundHeight(x, z, 'person'), person.position.x, person.position.y, person.position.z, (it) => this.collect(it));
      this.director.update(dt);
      this.shops.update(dt);
      this.updateGps(dt);
    }
    if (dt > 0) {
      this.driveFx.light = 1 - 0.7 * this.atmosphere.night;
      this.driveFx.wet = clamp(this.atmosphere.wet, 0, 1);
      const cam = this.camera.camera.position;
      for (const c of this.allCars) {
        if (!c.mesh.visible) continue;
        const near = Math.hypot(c.position.x - cam.x, c.position.z - cam.z) < 130;
        if (c.boat) { this.driveFx.boat(c, dt, near, this.clock); continue; }
        if (!c.body) continue;
        this.driveFx.car(c, dt, near);
        this.sinking(c);
      }
      this.driveFx.flush();
    }
    if (dt > 0) { this.stunts.update(dt); this.fallingLamps.update(dt); this.gangs.update(dt); this.tips(dt); }
    this.architect?.update(dt);
    this.fx.update(dt, (x, z) => this.controllers.getGroundHeight(x, z, 'person', this.person.position.y + 0.5));
    this.markers.update((x, z) => this.controllers.getGroundHeight(x, z, 'person'));

    // Traffic and audio see the cruisers and the parked fleet as solid, sounding cars
    const extra = this.traffic.extraBodies;
    extra.length = 0;
    for (const c of this.allCars) if ((c !== car || this.state !== 'driving') && c.position.y < 3) extra.push(c);
    const sounding = this.audio.sources?.extraVehicles;
    if (sounding) { sounding.length = 0; for (const c of this.wanted.cars) sounding.push(c); }

    // The player's car mirrors the street it is in (car-assets.js); a few times a second is plenty
    const street = car?.paintMaterial?.userData?.street;
    if (street && !car.paintMaterial.userData.shared && this.clock - (this.streetAt ?? -9) > 0.2) {
      this.streetAt = this.clock;
      this.controllers.streetWalls(car.position.x, car.position.z, street);
    }
    for (const vehicle of this.allCars) {
      if (vehicle.door) vehicle.door.rotation.y = -vehicle.doorOpen;
      vehicle.mesh.position.copy(vehicle.position); vehicle.mesh.rotation.y = vehicle.heading;
      if (vehicle.moto) poseMotorbike(vehicle, dt, vehicle === car && this.state === 'driving' && this.controllers.keys.sprint);
      vehicle.mesh.updateMatrixWorld();
    }
    // Getting in or out of a car the scripted way (vehicle-entry.js): the body on its seat point, the camera eased over
    const choreography = this.transition?.plan ? this.transition : null;
    if (choreography) this.drawChoreography(dt);
    else if (person.rig.overlay && person.rig.overlay === this.entryOverlay) this.releaseChoreography({ car }); // cut short (death, arrest)
    // On two wheels the protagonist stays in view, posed on the seat
    if (choreography) { /* posed above */ }
    else if (person.inVehicle && (car.moto || car.boat)) {
      person.rig.ride(car.chassisPivot, 1.1, { seat: car.seat, bars: car.bars, gripHalf: 0.33, bracket: car.pegs, crankLength: 0.02 });
      this.hero.setWeapon(null);
      this.hero.update(true, 0, dt);
    } else if (person.inVehicle && car.bicycle) {
      person.rig.ride(car.leanPivot, car.pedalPhase, car.bikeFrame);
      this.hero.setWeapon(null);
      this.hero.update(true, 0, dt);
    } else if (person.inVehicle && car.cabin && this.camera.activePresetId !== 'pov') {
      // At the wheel, seen through the glass; the head turns into the corner the car is taking
      person.rig.drive(car.bodyPivot, driverPose(car.cabin, Math.max(-0.5, Math.min(0.5, car.body.wy * 0.35 + car.body.steer * 0.4))));
      this.hero.setWeapon(null);
      this.hero.update(true, 0, dt);
    }
    // The glass of the car the player drives clears to show them; every other car keeps its tint
    for (const vehicle of this.allCars) {
      const clear = vehicle.glassMaterial?.userData.clear;
      if (clear) clear.value = vehicle === car && person.inVehicle && this.camera.activePresetId !== 'pov' ? (choreography ? choreography.sample.glass : 1) : 0;
    }
    this.vertical.draw(dt);
    this.skyRings.update();
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
    const offer = this.active && this.calibre?.prompt();
    if (offer) {
      prompt.classList.add('visible');
      const span = prompt.querySelector('span');
      span.textContent = offer.text;
      const small = document.createElement('small'); small.textContent = offer.sub; span.append(small);
      return;
    }
    const airborne = this.state === 'driving' && car.air && car.position.y > 3;
    const showExit = this.state === 'driving' && this.active && (airborne || Math.abs(car.speed) < 1.5);
    prompt.classList.toggle('visible', Boolean(this.candidate || showExit));
    const span = prompt.querySelector('span');
    if (this.candidate) {
      const target = this.candidate.car;
      const kind = target?.kind || this.candidate.source?.bodyType || (this.candidate.parked !== undefined ? this.parking.info(this.candidate.parked).kind : null);
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
    this.driveInstruments.update(car);
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
    if (this.testSpawn || this.resetting || this.transition || this.state === 'dead' || this.state === 'busted' || this.architect?.lab?.running) return false;
    try {
      const p = this.person;
      const fleet = this.fleet.filter((c) => !c.mission && !c.destroyed && !c.mode && !c.pooled);
      // Rides are not saved: the next session starts on foot, under wherever they were
      const aloft = this.state === 'falling' || (this.vertical.owns(this.state) && this.state !== 'surfing' && this.state !== 'climbing');
      const spot = aloft || this.state === 'surfing' || (this.state === 'driving' && (this.car.mode || this.car.pooled)) ? this.safeSpot(p.position.x, p.position.z, 0.5) : p.position;
      const data = {
        version: 2, state: this.state === 'driving' && fleet.includes(this.car) ? 'driving' : 'onFoot',
        player: { x: spot.x, y: spot === p.position ? p.position.y : this.controllers.getGroundHeight(spot.x, spot.z, 'person'), z: spot.z, heading: p.heading },
        active: fleet.indexOf(this.car), stolen: this.stolen, distance: this.distance, firstEntry: this.firstEntry,
        money: this.money, debt: this.debt, held: [...this.gangs.held], health: this.health, armor: this.armor, weapons: this.weapons, weaponId: this.weaponId, mods: this.mods, range: this.range,
        missionsDone: this.missionsDone, stats: this.stats, radio: this.radio?.stationIndex ?? this.radioIndex,
        atmosphere: this.atmosphere.serialize(), safehouses: this.shops?.serialize(), worldBikes: !!this.worldBikesPlaced,
        fleet: fleet.map(car => ({ kind: car.kind, paint: car.paint, position: { x: car.position.x, y: car.position.y, z: car.position.z }, heading: car.heading, stolen: car.stolen, hp: car.hp }))
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch { return false; /* Private browsing must not prevent playing. */ }
  }

  restore() {
    try {
      let data = JSON.parse(localStorage.getItem(SAVE_KEY));
      for (const key of LEGACY_SAVE_KEYS) data ??= JSON.parse(localStorage.getItem(key));
      if (!data || (data.version !== 1 && data.version !== 2) || !validPosition(data.player) || !Array.isArray(data.fleet) || data.fleet.length > FLEET_MAX) return;
      if (!data.fleet.every(c => (carSpecs[c.kind] || c.kind === 'moto') && validPosition(c.position) && Number.isFinite(c.heading) && Number.isInteger(c.paint))) return;
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
        if (Number.isFinite(data.debt)) this.debt = data.debt;
        if (Array.isArray(data.held)) this.gangs.held = new Set(data.held.filter((id) => typeof id === 'string'));
        this.health = Number.isFinite(data.health) ? clamp(data.health, 20, 100) : 100;
        this.armor = Number.isFinite(data.armor) ? clamp(data.armor, 0, 100) : 0;
        this.mods = sanitizeMods(data.mods);
        for (const id of MOD_GUNS) {
          const medal = data.range?.medals?.[id], best = data.range?.best?.[id];
          if (Number.isInteger(medal) && medal > 0 && medal <= 3) this.range.medals[id] = medal;
          if (Number.isFinite(best) && best > 0) this.range.best[id] = Math.round(best);
        }
        if (data.weapons && typeof data.weapons === 'object') {
          this.weapons = { fists: { mag: 0, ammo: 0 } };
          for (const [id, slot] of Object.entries(data.weapons)) {
            if (WEAPONS[id] && slot && Number.isFinite(slot.mag) && Number.isFinite(slot.ammo)) {
              // a magazine holds what the weapon takes with what is fitted on it
              this.weapons[id] = { mag: clamp(slot.mag | 0, 0, effectiveWeapon(id, this.mods[id]).mag || 0), ammo: clamp(slot.ammo | 0, 0, 9999) };
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
