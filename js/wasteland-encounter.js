import * as THREE from 'three/webgpu';
import { AIDriver } from './ai-driver.js';
import { settleBody } from './car-physics.js';
import { routeThroughSalt, saltLandAt, sampleSalt, saltRoadAt, SALT_PLACES } from './wasteland-plan.js';
import { WastelandConvoy } from './wasteland-convoy.js';

const FORGE = { x: SALT_PLACES[0].x + 46, z: SALT_PLACES[0].z + 28 };
const RELAY = SALT_PLACES[3];
// The Rouliers hold every place of the Wasteland but the two gates, which the city's watch covers
const STAGING = [FORGE, ...SALT_PLACES.filter(p => p.name !== 'La Grande Porte' && p.name !== 'Les Pompes')];
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function salvageKit(car, heavy, material, lamp) {
  const group = new THREE.Group();
  const box = (mat, x, y, z, w, h, l, tilt = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
    m.position.set(x, y, z); m.rotation.x = tilt; m.castShadow = true;
    group.add(m);
  };
  const width = car.spec.halfW;
  box(material, 0, .46, car.spec.zFront + .32, width * 2.4, .32, .19);
  for (const side of [-1, 1]) {
    box(material, side * width, .66, car.spec.zFront + .22, .16, .65, .25);
    box(material, side * width * .81, 1.35, -.3, .12, .98, .12, -.22);
    box(lamp, side * .56, car.spec.height + .11, -.35, .16, .14, .15);
  }
  box(material, 0, car.spec.height, -.35, width * 1.85, .10, .27);
  if (heavy) {
    box(material, 0, .92, -1.39, 1.42, .38, 1.37);
    box(material, 0, 1.54, -1.63, .34, 1.22, .33);
    box(material, 0, 1.83, -2.03, .23, .18, 2.02, -.32);
    box(material, 0, 1.36, -2.85, .34, .85, .18);
  }
  car.bodyPivot.add(group);
}

function clearSite(game, x, z, radius) {
  if (!saltLandAt(x, z)) return false;
  const y = sampleSalt(x, z);
  return !game.controllers.nearColliders(x, z, radius).some(c =>
    c.minX - radius < x && c.maxX + radius > x && c.minZ - radius < z && c.maxZ + radius > z &&
    (c.minY ?? 0) < y + 2.5 && c.maxY > y);
}

function seenOverSalt(a, b) {
  const length = distance(a, b);
  const steps = Math.min(18, Math.ceil(length / 19));
  for (let i = 1; i < steps; i++) {
    const f = i / steps, x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
    if ((sampleSalt(x, z) ?? 0) > a.y + (b.y - a.y) * f + 1.8) return false;
  }
  return true;
}

export class WastelandEncounter {
  constructor(game) {
    this.game = game;
    this.phase = 'calme';
    this.wait = 8;
    this.scan = 0;
    this.lost = 0;
    this.dust = 0;
    this.tether = 0;
    this.entered = false;
    this.areaBadge = document.querySelector('#session-badge span');
    const steel = new THREE.MeshStandardNodeMaterial({ color: 0x3e3028, roughness: .84, metalness: .42 });
    const lamp = new THREE.MeshStandardNodeMaterial({ color: 0xc39053, emissive: 0xb4681a, emissiveIntensity: 1.7 });
    const nav = { route: (x, z, tx, tz) => routeThroughSalt({ x, z }, { x: tx, z: tz }) };
    this.units = [
      { kind: 'offroad', paint: 0x3d4843, speed: 26, heavy: false },
      { kind: 'pickup', paint: 0x603e2f, speed: 34, heavy: true }
    ].map(spec => {
      const car = game.makeCar(spec.kind, spec.paint, new THREE.Vector3(0, -75, 0), 0, false, true, true);
      car.ai = true;
      salvageKit(car, spec.heavy, steel, lamp);
      car.mesh.updateMatrixWorld(true);
      const driver = new AIDriver(game.controllers, nav, car, { maxSpeed: spec.speed, corner: spec.heavy ? 12 : 15, avoid: false });
      driver.aggressive = spec.heavy;
      return { car, driver, active: false };
    });
    const cable = new THREE.BufferGeometry();
    cable.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.cable = new THREE.Line(cable, new THREE.LineBasicNodeMaterial({ color: 0xbfa885 }));
    this.cable.name = 'Câble des Rouliers'; this.cable.frustumCulled = false;
    // Visible for pipeline warm-up, then hidden until the grapple closes.
    game.scene.add(this.cable);
    this.cable.updateMatrixWorld();
    if (this.contract === 'transport') this.pointToRelay();
    // the columns that run the Ceinture (js/wasteland-convoy.js)
    this.convoy = new WastelandConvoy(game, { steel, lamp });
  }

  get contract() { return this.game.saltContract ?? null; }
  set contract(stage) { this.game.saltContract = stage; }

  pointToRelay() {
    this.game.map.waypoint = { x: RELAY.x, z: RELAY.z, name: RELAY.name };
  }

  appendCars(cars) {
    for (const unit of this.units) if (unit.active && !unit.car.destroyed) cars.push(unit.car);
    this.convoy.appendCars(cars);
  }

  retire() {
    for (const unit of this.units) {
      unit.active = false; unit.car.mesh.visible = false;
    }
    this.phase = 'calme';
    this.scan = this.lost = this.tether = 0;
    this.wait = 35;
    this.cable.visible = false;
  }

  deploy(unit, player, heavy) {
    const origin = this.zone ?? FORGE;
    const bearing = Math.atan2(origin.x - player.x, origin.z - player.z);
    const radius = heavy ? 230 : 154;
    for (let i = 0; i < 11; i++) {
      const a = bearing + (i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * .51);
      const x = player.x + Math.sin(a) * radius, z = player.z + Math.cos(a) * radius;
      const y = sampleSalt(x, z);
      if (y === null || !clearSite(this.game, x, z, 6) || Math.abs(y - player.y) > 50) continue;
      const car = unit.car, heading = Math.atan2(player.x - x, player.z - z);
      car.position.set(x, y, z);
      settleBody(car, heading);
      car.prevX = x; car.prevZ = z;
      car.hp = 100; car.destroyed = false; car.burnT = 0;
      car.mesh.position.copy(car.position);
      car.mesh.rotation.y = heading; car.mesh.visible = true; car.mesh.updateMatrixWorld(true);
      unit.driver.reverseT = unit.driver.stuckT = 0;
      unit.active = true;
      return true;
    }
    return false;
  }

  follow(unit, player, dt, heavy) {
    if (!unit.active || unit.car.destroyed) return;
    const { car, driver } = unit;
    const d = distance(car.position, player);
    const lead = heavy ? clamp(d * .08, 0, 3) : 1.2;
    let x = player.x + player.vx * lead, z = player.z + player.vz * lead;
    if (heavy && d < 45 && player.inVehicle) {
      x -= Math.sin(player.heading) * 4;
      z -= Math.cos(player.heading) * 4;
    }
    if (!saltLandAt(x, z)) { x = player.x; z = player.z; }
    driver.setGoal(x, z);
    driver.update(dt, { direct: seenOverSalt(car.position, player), stopAt: heavy ? 1.3 : 23, speedCap: heavy ? 35 : 23 });
    car.mesh.updateMatrixWorld(true);
  }

  pull(dt, player) {
    const g = this.game, tow = this.units[1].car, target = g.car;
    const dx = tow.position.x - target.position.x, dz = tow.position.z - target.position.z;
    const length = Math.hypot(dx, dz);
    const behind = dx * Math.sin(target.heading) + dz * Math.cos(target.heading) < -1.2;
    const eligible = player.inVehicle && target.body && !target.destroyed && !tow.destroyed && Math.abs(tow.position.y-target.position.y)<2;
    if (this.tether <= 0 && eligible && length > 3.2 && length < 8.4 && behind && Math.abs(tow.speed-target.speed)<14 && this.hookCooldown <= 0) {
      this.tether = 4.2;
      g.toast('Ils ont accroché la voiture', 'Braquez sec ou donnez un coup de nitro pour arracher le câble.');
      g.audio.ui('wantedUp');
    }
    if (this.tether > 0) {
      this.tether -= dt;
      if (!eligible || length > 13 || Math.abs(target.body.steer) > .40 || target.body.nitro > .1) this.tether = 0;
      if (this.tether > 0 && length > 3.2) {
        const tension = clamp((length - 3.2) * 3.5, 0, 9);
        target.body.vx += dx / length * tension * dt; target.body.vz += dz / length * tension * dt;
        tow.body.vx -= dx / length * tension * .55 * dt; tow.body.vz -= dz / length * tension * .55 * dt;
        g.damageCar(target, 1.8 * dt, 'hit');
      } else this.hookCooldown = 7;
    }
    this.cable.visible = this.tether > 0;
    if (this.cable.visible) {
      const p = this.cable.geometry.attributes.position;
      p.setXYZ(0, tow.position.x, tow.position.y + 1.1, tow.position.z);
      p.setXYZ(1, target.position.x - Math.sin(target.heading) * 2.1, target.position.y + .55, target.position.z - Math.cos(target.heading) * 2.1);
      p.needsUpdate = true;
    }
  }

  tickContract(player, dry) {
    const g = this.game;
    if (g.director.current || g.testSpawn && g.testSpawnSite !== 'sel') return;
    if (!player.alive) {
      if (this.contract === 'transport') { this.contract = null; g.map.waypoint = null; }
      return;
    }
    if (this.contract === 'transport' && dry && distance(player, RELAY) < 42 && player.speed < 9 &&
        player.y < sampleSalt(player.x, player.z) + 3) {
      this.contract = 'livré';
      g.addMoney(1450);
      g.map.waypoint = null;
      g.toast('Le relais répond', 'Bobine livrée · 1 450 $');
    }
  }

  prompt() {
    const g = this.game, p = g.player;
    if (!p.alive || this.contract || g.director.current || distance(p, FORGE) > 33 || p.speed > 2 ||
        p.y > (sampleSalt(p.x,p.z) ?? 0) + 3 || !saltLandAt(p.x,p.z)) return null;
    return { text: 'Prendre la bobine', sub: 'RELAIS DES VEILLEURS' };
  }

  interact() {
    const g = this.game;
    if (!this.prompt()) return false;
    this.contract = 'transport';
    this.pointToRelay();
    g.toast('Une bobine pour le relais', 'Suivez la ligne des pylônes et ralentissez devant le relais. Les Rouliers surveillent la piste.');
    this.wait = Math.min(this.wait, 5);
    return true;
  }

  update(dt, player) {
    if (dt <= 0) return;
    const g = this.game;
    this.cable.visible = false;
    for (const unit of this.units) if (!unit.active) unit.car.mesh.visible = false;
    const dry = saltLandAt(player.x, player.z), floor = dry ? sampleSalt(player.x,player.z) : 0;
    const exposed = dry && player.y - floor < 16 && player.alive && !(player.inVehicle && g.car?.flight);
    const area = dry ? 'LE WASTELAND' : 'MANHATTAN';
    if (this.areaBadge && this.areaBadge.textContent !== area) this.areaBadge.textContent = area;
    this.tickContract(player, dry);
    this.convoy.update(dt, player, exposed);
    if (!exposed) {
      if (this.phase !== 'calme') this.retire();
      return;
    }
    if (!this.entered) {
      this.entered = true;
      g.toast('Hors les murs', 'Les Rouliers tiennent les pistes. Surveillez les traînées de poussière, et gardez un pont ou une porte à portée.');
    }
    this.dust -= dt;
    if (this.dust <= 0) {
      this.dust = .085;
      const tracked = { distance: Infinity };
      saltRoadAt(player.x,player.z,tracked);
      const all = [player.inVehicle && tracked.distance > 7 ? g.car : null, ...this.units.filter(u=>u.active).map(u=>u.car), ...this.convoy.units.filter(u=>u.active&&!u.car.destroyed).map(u=>u.car)];
      for (const car of all) {
        if (!car?.body || !car.mesh.visible || Math.abs(car.speed)<6 || distance(player,car.position)>275) continue;
        const x = car.position.x - Math.sin(car.heading)*2.7, z=car.position.z-Math.cos(car.heading)*2.7;
        g.fx.smokeParticle(x,car.position.y+.22,z,Math.sin(car.heading)*car.speed*.18,.42,Math.cos(car.heading)*car.speed*.18,.76,1.65,.81,.18,{grow:2.8,drag:1.5,gravity:0});
      }
    }
    this.hookCooldown = Math.max(0, (this.hookCooldown ?? 0) - dt);
    if (this.phase === 'calme') {
      this.wait -= dt;
      if (this.wait > 0) return;
      this.zone = STAGING.reduce((a,b) => distance(player,a) < distance(player,b) ? a : b);
      if (distance(player,this.zone)>1320 || player.speed<2.5) return;
      if (this.deploy(this.units[0],player,false)) { this.phase = 'observation'; this.scan = 0; this.lost = 0; }
      else this.wait = 5;
      return;
    }
    const scout = this.units[0];
    const contact = this.units.some(u=>u.active&&!u.car.destroyed&&distance(u.car.position,player)<215&&seenOverSalt(u.car.position,player));
    this.lost = contact ? Math.max(0,this.lost-dt*3) : this.lost+dt;
    if (this.lost > 10 || !this.units.some(u=>u.active&&!u.car.destroyed)) {
      this.retire();
      g.toast('Les Rouliers ont perdu votre trace','Leurs moteurs s’éloignent.');
      return;
    }
    this.follow(scout,player,dt,false);
    if (this.phase === 'observation') {
      if (contact && distance(scout.car.position,player)<118) this.scan += dt;
      else this.scan = Math.max(0,this.scan-dt*.4);
      if (this.scan>2.6 && this.deploy(this.units[1],player,true)) {
        this.phase = 'traque';
        g.toast('Les Rouliers vous ont repéré','La dépanneuse vise votre voiture. Un pont ou un repli derrière les crêtes peut couper la poursuite.');
      }
      return;
    }
    this.follow(this.units[1],player,dt,true);
    this.pull(dt,player);
  }
}
