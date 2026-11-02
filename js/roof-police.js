import * as THREE from 'three/webgpu';
import { lineOfSight } from './weapons.js';

// The police go up too (0.9 « Leverage »). A wanted player on a roof is not safe there: officers in the street below take
// the stairs and come out of the roof door, from four stars the helicopter drops a team down ropes onto the roof, and from
// three stars marksmen take the roofs around, each with a red laser that says where the shot will come from.

const STAIRS_EVERY = 6; // s between two officers coming out on the player's roof
const ROOF_CREW = 4; // at most this many officers up on the player's roof
const SNIPERS = 2;
const RAPPEL_EVERY = 14;
const RAPPEL_SPEED = 7; // m/s down the rope

class RoofPolice {
  constructor(game) {
    this.game = game;
    this.stairsT = STAIRS_EVERY;
    this.rappelT = 4;
    this.sniperT = 3;
    this.snipers = [];
    this.roped = [];
    const scene = game.scene;
    const red = new THREE.MeshBasicNodeMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.55, depthWrite: false });
    const beam = new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1).translate(0, 0.5, 0);
    this.lasers = Array.from({ length: SNIPERS }, () => this.line(scene, beam, red));
    const rope = new THREE.MeshStandardNodeMaterial({ color: 0x23211d, roughness: 0.8 });
    const thick = new THREE.CylinderGeometry(0.02, 0.02, 1, 5, 1).translate(0, 0.5, 0);
    this.ropes = Array.from({ length: 2 }, () => this.line(scene, thick, rope));
  }

  line(scene, geometry, material) {
    const m = new THREE.Mesh(geometry, material);
    m.matrixAutoUpdate = false;
    m.frustumCulled = false;
    m.visible = false;
    scene.add(m);
    return m;
  }

  // The roof the player stands on (the building), or null in the street
  playerRoof() {
    const g = this.game, p = g.person.position;
    if (g.state !== 'onFoot' && g.state !== 'hanging' && g.state !== 'down') return null;
    if ((g.person.footing ?? 0) < 5) return null;
    return g.controllers.roofCollider(p.x, p.z, p.y + 0.5);
  }

  // A point on this roof `near`..`far` m from (x, z), or null
  spotOn(roof, x, z, near, far) {
    const c = this.game.controllers;
    for (let i = 0; i < 24; i++) {
      const sx = roof.minX + Math.random() * (roof.maxX - roof.minX), sz = roof.minZ + Math.random() * (roof.maxZ - roof.minZ);
      const d = Math.hypot(sx - x, sz - z);
      if (d < near || d > far) continue;
      if (c.roofCollider(sx, sz, roof.maxY + 0.1, 0.2) !== roof) continue;
      // a step in from the edge
      if (c.roofHeight(sx + 1, sz, roof.maxY + 0.1, 0.2) < roof.maxY - 0.1 || c.roofHeight(sx - 1, sz, roof.maxY + 0.1, 0.2) < roof.maxY - 0.1) continue;
      if (c.roofHeight(sx, sz + 1, roof.maxY + 0.1, 0.2) < roof.maxY - 0.1 || c.roofHeight(sx, sz - 1, roof.maxY + 0.1, 0.2) < roof.maxY - 0.1) continue;
      return { x: sx, z: sz };
    }
    return null;
  }

  officer(x, y, z, extra = {}) {
    const g = this.game, level = g.wanted.level;
    const p = g.person.position;
    return g.actors.spawn({
      x, y, z, heading: Math.atan2(p.x - x, p.z - z), team: 'police', look: level >= 4 ? 'swat' : Math.random() < 0.5 ? 'cop' : 'copB',
      weapon: level >= 4 ? 'smg' : level >= 3 ? 'shotgun' : 'pistol', hp: 70 + level * 10, armor: level >= 3 ? 30 : 0,
      behavior: level <= 1 ? 'arrest' : 'combat', hostile: true, accuracy: 0.35 + level * 0.08, alert: true, ...extra
    });
  }

  update(dt) {
    const g = this.game, level = g.wanted.level;
    const roof = level > 0 && g.player.alive ? this.playerRoof() : null;
    const p = g.person.position;
    const crew = g.actors.actors.filter((a) => a.team === 'police' && !a.dead && a.roof);
    const onMine = roof ? crew.filter((a) => Math.abs(a.y - roof.maxY) < 1.5 && Math.hypot(a.x - p.x, a.z - p.z) < 90).length : 0;

    // The stairs: officers come out of the roof door
    this.stairsT -= dt;
    if (roof && this.stairsT <= 0 && onMine < Math.min(ROOF_CREW, level + 1)) {
      this.stairsT = STAIRS_EVERY * (0.7 + Math.random() * 0.6) / Math.max(1, level * 0.6);
      const spot = this.spotOn(roof, p.x, p.z, 9, 30);
      if (spot) {
        const a = this.officer(spot.x, roof.maxY, spot.z);
        if (a) {
          a.roof = roof;
          g.audio.sfx('punch', spot.x, roof.maxY + 1, spot.z, { rate: 0.7, intensity: 0.5 }); // the roof door slammed open
          g.actors.onBark?.(onMine ? 'Renfort sur le toit !' : 'Il est sur le toit ! On monte !');
        }
      }
    }

    // Down the ropes from the helicopter
    const w = g.wanted;
    this.rappelT -= dt;
    if (roof && w.heliActive && level >= 4 && this.rappelT <= 0 && onMine < ROOF_CREW) {
      this.rappelT = RAPPEL_EVERY;
      const h = w.heli.position;
      for (let i = 0; i < 2; i++) {
        const spot = this.spotOn(roof, p.x, p.z, 7, 24);
        if (!spot) continue;
        const a = this.officer(spot.x, roof.maxY, spot.z, { look: 'swat', weapon: i ? 'rifle' : 'smg', armor: 50 });
        if (!a) continue;
        a.roof = roof;
        a.rappel = { y: Math.max(roof.maxY + 8, h.y - 2), floor: roof.maxY, speed: RAPPEL_SPEED * (0.85 + i * 0.3), air: 0 };
        a.y = a.rappel.y;
        this.roped.push(a);
      }
      g.actors.onBark?.('Équipe en descente !');
    }

    // Marksmen on the roofs around from three stars
    this.snipers = this.snipers.filter((a) => !a.dead && g.actors.actors.includes(a));
    this.sniperT -= dt;
    if (level >= 3 && g.player.alive && this.snipers.length < SNIPERS && this.sniperT <= 0) {
      this.sniperT = 7;
      const s = this.sniperSpot();
      if (s) {
        const a = this.officer(s.x, s.y, s.z, { look: 'swat', weapon: 'rifle', behavior: 'sniper', accuracy: 0.72, hp: 90, armor: 40 });
        if (a) { a.roof = s.roof; this.snipers.push(a); g.actors.onBark?.('Tireurs en position sur les toits.'); }
      }
    }
    if (level < 3) for (const a of this.snipers) if (Math.hypot(a.x - p.x, a.z - p.z) > 60) g.actors.remove(a);
    if (level < 3) this.snipers = this.snipers.filter((a) => g.actors.actors.includes(a));
    this.draw();
  }

  // A roof 15+ m up, 45-110 m from the player, with a clear line to them
  sniperSpot() {
    const g = this.game, c = g.controllers, p = g.player;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, d = 45 + Math.random() * 65;
      const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
      const roof = c.roofCollider(x, z, 1e4, 0);
      if (!roof || roof.maxY < 15 || roof.maxY > p.y + 120) continue;
      // near the edge facing the player: walk the spot towards them while it stays on this roof
      let sx = x, sz = z;
      const ux = (p.x - x) / d, uz = (p.z - z) / d;
      for (let k = 0; k < 40; k++) {
        if (c.roofCollider(sx + ux * 2.5, sz + uz * 2.5, roof.maxY + 0.1, 0.2) !== roof) break;
        sx += ux; sz += uz;
      }
      if (!lineOfSight(c, sx, roof.maxY + 1.5, sz, p.x, p.y + 1.2, p.z)) continue;
      return { x: sx, y: roof.maxY, z: sz, roof };
    }
    return null;
  }

  draw() {
    const g = this.game, p = g.player;
    if (g.frames <= 4) {
      // drawn once behind the loading screen so their shaders compile
      for (const m of [...this.lasers, ...this.ropes]) { m.visible = true; this.stretch(m, new THREE.Vector3(p.x, p.y + 1, p.z), new THREE.Vector3(p.x, p.y + 2, p.z)); }
      return;
    }
    // a laser per marksman who has the player in sight
    this.lasers.forEach((laser, i) => {
      const a = this.snipers[i];
      laser.visible = !!(a && !a.dead && a.los && a.rig.aim);
      if (!laser.visible) return;
      const from = new THREE.Vector3(a.x, a.y + 1.45, a.z), to = new THREE.Vector3(p.x, p.y + 1.2, p.z);
      this.stretch(laser, from, to);
    });
    this.roped = this.roped.filter((a) => a.rappel && !a.dead);
    const h = g.wanted.heli.position;
    this.ropes.forEach((rope, i) => {
      const a = this.roped[i];
      rope.visible = !!a;
      if (a) this.stretch(rope, new THREE.Vector3(a.x, a.rappel.y + 1.8, a.z), new THREE.Vector3(a.x, Math.max(a.rappel.y + 2, h.y - 1), a.z));
    });
  }

  stretch(mesh, from, to) {
    const d = to.clone().sub(from);
    const len = Math.max(0.01, d.length());
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.multiplyScalar(1 / len));
    mesh.scale.set(1, len, 1);
    mesh.updateMatrixWorld();
  }

  reset() {
    this.snipers = [];
    this.roped = [];
    for (const m of [...this.lasers, ...this.ropes]) m.visible = false;
  }
}

export { RoofPolice };
