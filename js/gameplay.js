import * as THREE from 'three/webgpu';
import { streetZ, isTypingInField } from './city-config.js';
import { angleDelta, doorPosition, smooth, clamp, canInteract, validPosition } from './interaction-state.js';
import { HeroModel } from './hero.js';

const SAVE_KEY = 'contre-maree:playground:1';
const LABELS = { sedan: 'EXECUTIVE', suv: 'SUMMIT', taxi: 'CITY CAB', pickup: 'RANCH', van: 'CARGO', minivan: 'VOYAGER' };
const PROFILES = {
  sedan: { speed: 47, acceleration: 7, powerSpeed: 21, grip: 10.5, cornering: 11 },
  suv: { speed: 39, acceleration: 5.3, powerSpeed: 19, grip: 8.7, cornering: 8.8 },
  taxi: { speed: 40, acceleration: 5.8, powerSpeed: 18, grip: 9.4, cornering: 10 },
  pickup: { speed: 36, acceleration: 5, powerSpeed: 18, grip: 8.2, cornering: 8 },
  van: { speed: 32, acceleration: 4, powerSpeed: 16, grip: 8, cornering: 7.5 },
  minivan: { speed: 36, acceleration: 4.8, powerSpeed: 17, grip: 8.8, cornering: 9 }
};

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

export class Playground {
  constructor({ controllers, camera, traffic, scene, onMode, onTime, audio, map, touch, gamepad }) {
    Object.assign(this, { controllers, camera, traffic, scene, onMode, onTime, audio, map, touch, gamepad });
    this.state = 'onFoot'; this.playing = false; this.paused = false;
    this.transition = null; this.candidate = null; this.stamina = 100;
    this.distance = 0; this.stolen = 0; this.clock = 0; this.fleet = [];
    this.nextId = 1; this.toasts = []; this.lastSave = 0; this.lastCandidate = null;
    this.firstEntry = true;
    controllers.playground = this;
    // Main character motion is camera-relative, with acceleration and planted-foot animation.
    controllers.updatePerson = dt => this.updatePerson(dt);
    for (const key of ['cyclist', 'helicopter']) {
      const entity = controllers.entities[key];
      entity.position.set(20000, -100, 20000);
      entity.mesh.visible = false;
    }
    const initial = controllers.entities.car;
    initial.mesh.removeFromParent();
    this.spawnFleet();
    this.restore();
    controllers.entities.person.inVehicle = this.state === 'driving';
    this.onMode(this.state === 'driving' ? 'car' : 'person');
    this.buildInterface();
    this.bind();
    this.setupMarker();
    this.hero = new HeroModel(scene, controllers.entities.person);
    if (new URLSearchParams(location.search).has('qa')) window.__playground = this;
  }

  get active() { return this.playing && !this.paused && !this.map.isFullMapOpen; }

  makeCar(kind, paint, position, heading = 0, stolen = false) {
    const car = this.controllers.createCarEntity({ kind, paint });
    car.id = this.nextId++; car.stolen = stolen;
    car.position.copy(position); car.heading = heading; car.prevX = position.x; car.prevZ = position.z;
    car.drive = { reverseSpeed: 10, rolling: 0.18, drag: 0.0012, coast: 0.7, brake: 12, wheelbase: car.spec.wheelZ * 2, ...PROFILES[kind] };
    splitDoor(car);
    car.mesh.position.copy(car.position); car.mesh.rotation.y = heading;
    this.fleet.push(car);
    return car;
  }

  spawnFleet() {
    const z = streetZ(37) + 12;
    this.makeCar('sedan', 0x4b1019, new THREE.Vector3(8.15, 0, z));
    this.makeCar('suv', 0x163c36, new THREE.Vector3(8.15, 0, z + 18));
    this.makeCar('taxi', 0xffbd22, new THREE.Vector3(8.15, 0, z - 18));
    this.controllers.entities.car = this.fleet[0];
    const person = this.controllers.entities.person;
    person.position.set(11.9, this.controllers.getGroundHeight(11.9, z, 'person'), z - 0.4);
    person.heading = 0;
    this.camera.footYaw = 0.18;
  }

  buildInterface() {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="game-vignette" aria-hidden="true"></div>
      <div id="game-brand"><span class="cm-monogram">CM<span>↗</span></span><span>CONTRE-MARÉE<small>PLAYGROUND / 01</small></span></div>
      <div id="session-badge"><i></i><span>MANHATTAN</span><b>LIBRE</b><button id="pause-button" aria-label="Ouvrir le menu pause">Ⅱ</button></div>
      <div id="game-prompt" role="status" aria-live="polite"><kbd>F</kbd><span>Voler la voiture<small>EXECUTIVE · BERLINE</small></span></div>
      <div id="game-toast" role="status" aria-live="polite"></div>
      <div id="stamina-track" aria-label="Endurance"><span id="stamina-fill"></span></div>
      <div id="vehicle-name"><span>ALBANY</span><strong>EXECUTIVE</strong><small>BERLINE / PROPULSION</small></div>
      <div id="drive-gauge"><span id="drive-gear">N</span><strong id="drive-speed">000</strong><span class="gauge-unit">KM/H</span><div><i id="drive-power"></i></div></div>
      <div id="game-keybar"><span><kbd>ZQSD</kbd> / <kbd>WASD</kbd> Se déplacer</span><span><kbd>MAJ</kbd> Sprint</span><span><kbd>ESPACE</kbd> Sauter</span><span><kbd>F</kbd> Véhicule</span><span><kbd>ÉCHAP</kbd> Menu</span></div>
      <div id="game-menu" class="game-menu">
        <div class="menu-top"><span class="edition-label">UNE VILLE. VOTRE TERRAIN DE JEU.</span><span class="build-label">BUILD 0.1.1</span></div>
        <div class="menu-body"><div class="menu-eyebrow"><span></span> NEW YORK / OPEN WORLD</div><h1>CONTRE<span>MARÉE<span class="title-dot">.</span></span></h1>
          <p class="menu-copy">La ville est à vous.<br>Descendez dans la rue. Prenez le volant.</p>
          <button id="play-button" class="primary-play">ENTRER DANS LA VILLE <span>↗</span></button>
          <div class="menu-secondary"><button id="new-session">Recommencer</button><span>CLAVIER + SOURIS / MANETTE</span></div>
        </div>
        <div class="menu-bottom"><span>MANHATTAN, NY<span class="coordinates">40°45′ N — 73°59′ W</span></span><button id="credits-button">CRÉDITS ↗</button><span class="menu-description">EXPLORATION LIBRE<br>PERSONNAGE · VÉHICULES · CONDUITE</span></div>
        <div id="menu-options"><span>AMBIANCE</span><button data-game-time="golden" class="selected">Soleil bas</button><button data-game-time="twilight">Crépuscule</button><button data-game-time="midnight">Nuit</button><button id="sound-toggle">SON ACTIVÉ</button><button id="quality-toggle">QUALITÉ : HAUTE</button></div>
      </div>
      <dialog id="credits-dialog"><button id="close-credits" aria-label="Fermer les crédits">×</button><h2>CONTRE-MARÉE</h2><p>Playground 01 · Version 0.1.1</p><p>Basé sur Slop New York par Mr.doob.<br>Rendu Three.js, WebGPU et TSL.</p><p>Données : NYC Open Data, MTA et © contributeurs OpenStreetMap (ODbL).</p><a href="./CREDITS.md" target="_blank" rel="noopener">Sources et licences ↗</a></dialog>
      <button id="mobile-interact" class="touch-interact" hidden>F <span>VÉHICULE</span></button>
    `);
    this.ui = Object.fromEntries(['game-menu', 'game-prompt', 'game-toast', 'stamina-fill', 'drive-speed', 'drive-gear', 'drive-power', 'vehicle-name', 'game-keybar', 'play-button', 'mobile-interact'].map(id => [id, document.getElementById(id)]));
    document.body.dataset.gameState = this.state;
    document.body.classList.add('in-menu');
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
    document.getElementById('quality-toggle').addEventListener('click', e => {
      this.save();
      const url = new URL(location.href);
      if (url.searchParams.get('quality') === 'performance') url.searchParams.delete('quality');
      else url.searchParams.set('quality', 'performance');
      location.href = url.href;
    });
    if (new URLSearchParams(location.search).get('quality') === 'performance') document.getElementById('quality-toggle').textContent = 'QUALITÉ : FLUIDITÉ';
    document.querySelectorAll('[data-game-time]').forEach(button => button.addEventListener('click', () => {
      this.onTime(button.dataset.gameTime);
      document.querySelectorAll('[data-game-time]').forEach(b => b.classList.toggle('selected', b === button));
    }));
    window.addEventListener('keydown', e => {
      if (isTypingInField(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.code === 'KeyF' && this.active) { e.preventDefault(); this.interact(); }
      if (e.code === 'Escape' && !document.querySelector('dialog[open]')) {
        if (this.map.isFullMapOpen) this.map.toggleFullMap(false);
        else if (this.playing) this.setPaused(!this.paused);
      }
      if (e.code === 'KeyR' && this.active && this.state === 'driving' && Math.abs(this.controllers.entities.car.speed) < 1.5) {
        const car = this.controllers.entities.car;
        car.position.y = this.controllers.getGroundHeight(car.position.x, car.position.z, 'car');
        car.speed = car.vx = car.vz = car.angularVel = 0;
      }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.playing) this.setPaused(true); });
    window.addEventListener('pagehide', () => this.save());
    document.getElementById('mobile-interact').addEventListener('click', () => this.interact());
    if (navigator.maxTouchPoints > 0) this.ui['mobile-interact'].hidden = false;
  }

  start() {
    const first = !this.playing;
    this.playing = true;
    this.setPaused(false);
    this.audio.setEnabled(this.audio.enabled);
    this.ui['play-button'].firstChild.textContent = 'REPRENDRE LA PARTIE ';
    if (first) this.toast('Bienvenue à Manhattan', 'Approchez une voiture et appuyez sur F.');
  }

  setPaused(paused) {
    this.paused = paused;
    this.controllers.resetInput();
    this.gamepad.setEnabled(this.active);
    this.touch.setEnabled(this.active);
    document.body.classList.toggle('in-menu', paused || !this.playing);
    this.ui['game-menu'].classList.toggle('dismissed', !paused && this.playing);
    this.ui['game-menu'].hidden = !paused && this.playing;
    if (paused) { this.save(); document.exitPointerLock?.(); }
    else this.camera.domElement.focus();
  }

  setupMarker() {
    const material = new THREE.MeshBasicNodeMaterial({ color: 0xe3f3a0, transparent: true, opacity: 0.75, depthWrite: false });
    this.marker = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 24), material);
    this.scene.add(this.marker);
  }

  updatePerson(dt) {
    if (dt <= 0 || this.transition) return;
    const p = this.controllers.entities.person, keys = this.controllers.keys;
    const x = Number(keys.right) - Number(keys.left), z = Number(keys.forward) - Number(keys.backward);
    const amount = Math.min(1, Math.hypot(x, z));
    const sprint = keys.sprint && this.stamina > 1 && amount > 0;
    this.stamina = clamp(this.stamina + (sprint ? -13 : 20) * dt, 0, 100);
    const speed = sprint ? 7.8 : 3.9;
    p.speed += (amount * speed - p.speed) * (1 - Math.exp(-dt * (amount ? 9 : 14)));
    if (amount > 0) {
      const desired = this.camera.footYaw + Math.atan2(-x, z);
      p.heading += angleDelta(p.heading, desired) * (1 - Math.exp(-dt * 14));
      const magnitude = Math.hypot(x, z);
      const localX = -x / magnitude, localZ = z / magnitude;
      const yaw = this.camera.footYaw;
      p.position.x += (Math.cos(yaw) * localX + Math.sin(yaw) * localZ) * p.speed * dt;
      p.position.z += (-Math.sin(yaw) * localX + Math.cos(yaw) * localZ) * p.speed * dt;
    }
    this.controllers.resolveHorizontalCollision(p.position, 0.34);
    for (const car of this.fleet) this.resolveParkedCollision(p, car);
    const ground = this.controllers.getGroundHeight(p.position.x, p.position.z, 'person');
    if (keys.up && !this.jumpHeld && p.position.y <= ground + 0.04) p.verticalVel = 5.3;
    this.jumpHeld = Boolean(keys.up);
    p.verticalVel -= 15 * dt;
    p.position.y += p.verticalVel * dt;
    if (p.position.y < ground) { p.position.y = ground; p.verticalVel = 0; }
  }

  resolveParkedCollision(person, car) {
    if (person.position.y > car.position.y + 1.7) return;
    const dx = person.position.x - car.position.x, dz = person.position.z - car.position.z;
    if (Math.abs(dx) > 4 || Math.abs(dz) > 4) return;
    const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
    const x = dx * cos - dz * sin, z = dx * sin + dz * cos;
    const hx = 0.95, hz = Math.max(car.spec.zFront, -car.spec.zRear);
    const qx = x - clamp(x, -hx, hx), qz = z - clamp(z, -hz, hz);
    const distance = Math.hypot(qx, qz);
    if (distance >= 0.34) return;
    let nx = 0, nz = 0, push;
    if (distance > 0.001) { nx = qx / distance; nz = qz / distance; push = 0.34 - distance; }
    else if (hx - Math.abs(x) < hz - Math.abs(z)) { nx = Math.sign(x) || 1; push = hx - Math.abs(x) + 0.34; }
    else { nz = Math.sign(z) || 1; push = hz - Math.abs(z) + 0.34; }
    person.position.x += (cos * nx + sin * nz) * push;
    person.position.z += (-sin * nx + cos * nz) * push;
  }

  findCandidate() {
    const person = this.controllers.entities.person;
    let best = null, nearest = 3.2;
    for (const car of this.fleet) {
      const door = doorPosition(car);
      const d = Math.hypot(door.x - person.position.x, door.z - person.position.z);
      if (d < nearest && Math.abs(car.position.y - person.position.y) < 1) { best = { car, distance: d }; nearest = d; }
    }
    for (const source of this.traffic.cars) {
      if (source.claimed || !source.edge || Math.abs(source.speed) > 1.8 || source.isPolice) continue;
      const dx = source.x - person.position.x, dz = source.z - person.position.z;
      if (Math.hypot(dx, dz) > 5) continue;
      const heading = source.yaw || 0;
      const proxy = { position: { x: source.x, z: source.z }, heading };
      const door = doorPosition(proxy);
      const d = Math.hypot(door.x - person.position.x, door.z - person.position.z);
      if (d < nearest) { best = { source, distance: d }; nearest = d; }
    }
    return best;
  }

  interact() {
    if (!this.active || !canInteract(this.state, this.controllers.entities.car.speed)) {
      if (this.state === 'driving') this.toast('Ralentissez', 'Arrêtez le véhicule pour descendre.');
      return;
    }
    if (this.state === 'driving') { this.beginExit(); return; }
    const candidate = this.findCandidate();
    if (!candidate) return;
    let car = candidate.car;
    if (!car) {
      const source = candidate.source;
      if (this.fleet.length >= 12) { this.toast('Garage complet', 'Reprenez l’un des véhicules déjà utilisés.'); return; }
      const color = new THREE.Color().setRGB(...source.paint);
      car = this.makeCar(source.bodyType, color.getHex(), new THREE.Vector3(source.x, 0, source.z), source.yaw || 0);
      source.claimed = true; source.edge = null;
    }
    const person = this.controllers.entities.person;
    this.controllers.resetInput();
    this.controllers.entities.car = car;
    const door = doorPosition(car);
    this.state = 'entering';
    this.transition = { time: 0, car, start: person.position.clone(), startHeading: person.heading, door, entering: true };
    this.ui['game-prompt'].classList.remove('visible');
    document.body.dataset.gameState = this.state;
  }

  beginExit() {
    const car = this.controllers.entities.car;
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
  }

  updateTransition(dt) {
    const t = this.transition;
    if (!t) return;
    t.time += dt;
    const p = this.controllers.entities.person, car = t.car;
    const duration = t.entering ? 1.55 : 1.15;
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
        this.state = 'driving'; this.onMode('car');
        if (!car.stolen) { car.stolen = true; this.stolen++; this.toast('Véhicule récupéré', `${LABELS[car.kind]} · Il est temps de rouler.`); }
        this.firstEntry = false;
        this.camera.resetOrbit();
      } else {
        p.inVehicle = false; p.position.copy(t.exit);
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

  updateKeybar() {
    this.ui['game-keybar'].innerHTML = this.state === 'driving'
      ? '<span><kbd>ZQSD</kbd> / <kbd>WASD</kbd> Conduire</span><span><kbd>ESPACE</kbd> Frein à main</span><span><kbd>B</kbd> Klaxon</span><span><kbd>F</kbd> Descendre</span><span><kbd>V</kbd> Caméra</span><span><kbd>ÉCHAP</kbd> Menu</span>'
      : '<span><kbd>ZQSD</kbd> / <kbd>WASD</kbd> Se déplacer</span><span><kbd>MAJ</kbd> Sprint</span><span><kbd>ESPACE</kbd> Sauter</span><span><kbd>F</kbd> Véhicule</span><span><kbd>ÉCHAP</kbd> Menu</span>';
  }

  beforeUpdate(dt) {
    if (!this.active) { this.controllers.resetInput(); return; }
    this.clock += dt;
    this.updateTransition(dt);
    if (this.state === 'driving') this.distance += Math.abs(this.controllers.entities.car.speed) * dt;
  }

  update(dt) {
    this.hero.update();
    const car = this.controllers.entities.car;
    for (const vehicle of this.fleet) {
      vehicle.door.rotation.y = -vehicle.doorOpen;
      vehicle.mesh.position.copy(vehicle.position); vehicle.mesh.rotation.y = vehicle.heading;
      vehicle.mesh.updateMatrixWorld();
    }
    if (this.clock - this.lastSave > 5) { this.lastSave = this.clock; this.save(); }
    this.candidate = this.state === 'onFoot' && this.active ? this.findCandidate() : null;
    const prompt = this.ui['game-prompt'];
    const showExit = this.state === 'driving' && this.active && Math.abs(car.speed) < 1.5;
    prompt.classList.toggle('visible', Boolean(this.candidate || showExit));
    if (this.candidate) {
      const kind = this.candidate.car?.kind || this.candidate.source.bodyType;
      prompt.querySelector('span').innerHTML = `${this.candidate.car?.stolen ? 'Monter dans la voiture' : 'Voler la voiture'}<small>${LABELS[kind]} · VÉHICULE</small>`;
    } else if (showExit) prompt.querySelector('span').innerHTML = 'Descendre du véhicule<small>VÉHICULE À L’ARRÊT</small>';
    this.ui['stamina-fill'].style.transform = `scaleX(${this.stamina / 100})`;
    const speed = Math.round(Math.abs(car.speed) * 3.6);
    this.ui['drive-speed'].textContent = String(speed).padStart(3, '0');
    this.ui['drive-gear'].textContent = car.speed < -0.2 ? 'R' : speed < 1 ? 'N' : String(Math.min(6, 1 + Math.floor(speed / 29)));
    this.ui['drive-power'].style.transform = `scaleX(${clamp(Math.abs(car.speed) / car.drive.speed, 0, 1)})`;
    const name = this.ui['vehicle-name'];
    name.querySelector('strong').textContent = LABELS[car.kind];
    name.querySelector('span').textContent = car.kind === 'taxi' || car.kind === 'van' ? 'VAPID' : car.kind === 'suv' ? 'DECLASSE' : 'ALBANY';
    name.querySelector('small').textContent = car.kind === 'suv' ? 'SUV / TRANSMISSION INTÉGRALE' : car.kind === 'taxi' ? 'TAXI / PROPULSION' : 'VÉHICULE / PROPULSION';
    this.marker.visible = this.firstEntry && this.state === 'onFoot' && this.active;
    if (this.marker.visible) {
      this.marker.position.copy(this.fleet[0].position).add(new THREE.Vector3(0, 2.6 + Math.sin(this.clock * 2.3) * 0.1, 0));
      this.marker.lookAt(this.camera.camera.position); this.marker.updateMatrixWorld();
    }
  }

  toast(title, subtitle = '') {
    const element = this.ui['game-toast'];
    element.replaceChildren();
    const h = document.createElement('strong'); h.textContent = title;
    const p = document.createElement('span'); p.textContent = subtitle;
    element.append(h, p); element.classList.add('visible');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => element.classList.remove('visible'), 4200);
  }

  save() {
    if (this.transition) return;
    try {
      const p = this.controllers.entities.person;
      const data = { version: 1, state: this.state, player: { x: p.position.x, y: p.position.y, z: p.position.z, heading: p.heading }, active: this.fleet.indexOf(this.controllers.entities.car), stolen: this.stolen, distance: this.distance, firstEntry: this.firstEntry, fleet: this.fleet.map(car => ({ kind: car.kind, paint: car.paint, position: { x: car.position.x, y: car.position.y, z: car.position.z }, heading: car.heading, stolen: car.stolen })) };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch { /* Private browsing must not prevent playing. */ }
  }

  restore() {
    try {
      const data = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (data?.version !== 1 || !validPosition(data.player) || !Array.isArray(data.fleet) || data.fleet.length < 1 || data.fleet.length > 12) return;
      if (!data.fleet.every(c => PROFILES[c.kind] && validPosition(c.position) && Number.isFinite(c.heading) && Number.isInteger(c.paint))) return;
      for (const car of this.fleet) car.mesh.removeFromParent();
      this.fleet = [];
      for (const c of data.fleet) this.makeCar(c.kind, c.paint, new THREE.Vector3(c.position.x, c.position.y, c.position.z), c.heading, !!c.stolen);
      const p = this.controllers.entities.person;
      p.position.set(data.player.x, data.player.y, data.player.z);
      p.heading = Number.isFinite(data.player.heading) ? data.player.heading : 0;
      this.camera.footYaw = p.heading;
      this.controllers.entities.car = this.fleet[clamp(data.active | 0, 0, this.fleet.length - 1)];
      this.state = data.state === 'driving' ? 'driving' : 'onFoot';
      this.distance = Number.isFinite(data.distance) ? Math.max(0, data.distance) : 0;
      this.stolen = Number.isFinite(data.stolen) ? Math.max(0, data.stolen) : 0;
      this.firstEntry = data.firstEntry !== false;
    } catch { /* An old or corrupted save falls back to a fresh session. */ }
  }

  reset() {
    try { localStorage.removeItem(SAVE_KEY); } catch {}
    location.reload();
  }
}
