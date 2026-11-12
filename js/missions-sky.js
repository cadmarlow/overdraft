import * as THREE from 'three/webgpu';
import { streetZ } from './city-config.js';
import { sealEffect } from './effect-outputs.js';

// 0.9 « Leverage »: the city's roofs as a playground. Two activities open from the start (a race across Midtown's roofs and
// a wingsuit descent through rings), and a contract for Jules: Cazal's ledgers, at the top of a tower whose lobby is
// guarded and whose sky is not. Routes are read off the real buildings when a run starts.

const SKY_PLACES = {
  roofs: { x: 11.9, z: streetZ(39) + 22, name: '5e Avenue & 39e Rue' },
  descent: { x: 11.9, z: streetZ(42) + 22, name: '5e Avenue & 42e Rue' },
  leverage: { x: -270, z: streetZ(44) + 30, name: '6e Avenue & 44e Rue' }
};
const ACT = 'CONTRAT — EFFET DE LEVIER';
const RING_RADIUS = 10;
const GLIDE = 0.34; // metres lost per metre flown along a descent's rings

// ---- Reading routes off the buildings -----------------------------------------------------------------------------------
// A standing spot on a building's roof, a step in from its edges, near its middle (or null)
function roofSpot(c, roof, nearX = null, nearZ = null) {
  const cx = nearX ?? (roof.minX + roof.maxX) / 2, cz = nearZ ?? (roof.minZ + roof.maxZ) / 2;
  const ok = (x, z) => c.roofCollider(x, z, roof.maxY + 0.1, 0.2) === roof
    && [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].every(([dx, dz]) => c.roofHeight(x + dx, z + dz, roof.maxY + 0.1, 0.2) >= roof.maxY - 0.05)
    && c.roofHeight(x, z, 1e4, 0) <= roof.maxY + 0.05;
  if (ok(cx, cz)) return { x: cx, y: roof.maxY, z: cz };
  for (let r = 1.5; r < 40; r += 1.5) {
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (ok(x, z)) return { x, y: roof.maxY, z };
    }
  }
  return null;
}

// Roofs from a point, `count` of them, each 20-55 m on from the last in one general direction, never more than 30 m above
// the one before (a grapple's work, not a skyscraper's)
function roofChain(game, x, z, count = 6) {
  const c = game.controllers;
  const candidates = c.colliders.filter((k) => k.roof && k.maxY > 12 && k.maxY < 95 && Math.abs((k.minX + k.maxX) / 2 - x) < 700 && Math.abs((k.minZ + k.maxZ) / 2 - z) < 700);
  let best = [];
  for (let h = 0; h < 8; h++) {
    const heading = h / 8 * Math.PI * 2;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const chain = [], used = new Set();
    let px = x, pz = z, py = 0;
    for (let i = 0; i < count; i++) {
      let pick = null, score = -Infinity;
      for (const k of candidates) {
        if (used.has(k)) continue;
        const kx = (k.minX + k.maxX) / 2, kz = (k.minZ + k.maxZ) / 2, dx = kx - px, dz = kz - pz, d = Math.hypot(dx, dz);
        const min = i ? 14 : 8, max = i ? 70 : 45;
        if (d < min || d > max || k.maxY - py > (i ? 30 : 60) || py - k.maxY > 45) continue;
        const along = (dx * fx + dz * fz) / d;
        if (along < 0.3) continue;
        const s = along * 2 - Math.abs(d - 32) / 30 + Math.random() * 0.4;
        if (s > score) { score = s; pick = k; }
      }
      if (!pick) break;
      const spot = roofSpot(c, pick);
      if (!spot) { used.add(pick); i--; if (used.size > 40) break; continue; }
      used.add(pick);
      chain.push(spot);
      px = spot.x; pz = spot.z; py = spot.y;
    }
    if (chain.length > best.length) best = chain;
    if (best.length === count) break;
  }
  return best;
}

// The tallest roof in [min, max] metres within `radius` of a point, with a spot to stand on it
function tower(game, x, z, min, max, radius = 600) {
  const c = game.controllers;
  const list = c.colliders.filter((k) => k.roof && k.maxY >= min && k.maxY <= max && Math.hypot((k.minX + k.maxX) / 2 - x, (k.minZ + k.maxZ) / 2 - z) < radius)
    .sort((a, b) => b.maxY - a.maxY);
  for (const k of list) {
    const spot = roofSpot(c, k);
    if (spot) return { roof: k, spot };
  }
  return null;
}

// The most open way down from a tower's roof: rings along a glide that keeps clear of every roof, then a landing spot
function descentRoute(game, roof, spot) {
  const c = game.controllers;
  let best = null;
  for (let k = 0; k < 16; k++) {
    const heading = k / 16 * Math.PI * 2, fx = Math.sin(heading), fz = Math.cos(heading);
    // from the edge in that direction
    let ex = spot.x, ez = spot.z;
    for (let s = 0; s < 120 && c.roofCollider(ex + fx, ez + fz, roof.maxY + 0.1, 0.2) === roof; s++) { ex += fx; ez += fz; }
    let clear = 0;
    for (let s = 10; s < 1400; s += 8) {
      const y = roof.maxY - 10 - (s - 10) * GLIDE;
      if (y < 12) break;
      if (c.roofHeight(ex + fx * s, ez + fz * s, 1e4, 0) > y - 14) break;
      clear = s;
    }
    if (!best || clear > best.clear) best = { heading, clear, ex, ez };
  }
  if (!best || best.clear < 150) return null;
  const { heading, ex, ez } = best, fx = Math.sin(heading), fz = Math.cos(heading);
  const rings = [];
  for (let s = 70; s < best.clear - 30; s += 70) {
    const y = roof.maxY - 10 - (s - 10) * GLIDE + 2;
    const side = (rings.length % 2 ? 1 : -1) * (4 + Math.random() * 6);
    const x = ex + fx * s + fz * side, z = ez + fz * s - fx * side;
    if (c.roofHeight(x, z, 1e4, 0) > y - RING_RADIUS - 2) continue;
    rings.push({ x, y, z });
  }
  const s = Math.min(best.clear + 80, best.clear * 1.15);
  const land = game.safeSpot(ex + fx * s, ez + fz * s, 2);
  return { heading, start: { x: ex - fx * 5, y: roof.maxY, z: ez - fz * 5 }, rings, land };
}

// ---- Rings in the air -------------------------------------------------------------------------------------------------
class SkyRings {
  constructor(scene) {
    const geometry = new THREE.TorusGeometry(RING_RADIUS, 0.32, 8, 48);
    const material = new THREE.MeshStandardNodeMaterial({ color: 0xe1f3a0, emissive: 0xe1f3a0, emissiveIntensity: 1.6, roughness: 0.4 });
    // (a see-through marker, not a surface: it leaves the reflections' outputs alone)
    const next = sealEffect(new THREE.MeshStandardNodeMaterial({ color: 0xffb347, emissive: 0xffb347, emissiveIntensity: 1.2, roughness: 0.4, transparent: true, opacity: 0.55 }));
    this.meshes = Array.from({ length: 3 }, (_, i) => {
      const m = new THREE.Mesh(geometry, i ? next : material);
      m.matrixAutoUpdate = false;
      m.visible = true; // drawn once behind the loading screen
      m.position.set(0, -200, 0);
      m.updateMatrix(); m.updateMatrixWorld();
      scene.add(m);
      return m;
    });
    this.frames = 0;
  }

  // Shows rings[i], rings[i+1], rings[i+2], each facing along `heading`
  show(rings, i, heading) {
    this.meshes.forEach((m, k) => {
      const r = rings[i + k];
      m.visible = !!r;
      if (!r) return;
      m.position.set(r.x, r.y, r.z);
      m.rotation.set(0, heading, 0);
      m.updateMatrix(); m.updateMatrixWorld();
    });
  }

  hide() { for (const m of this.meshes) m.visible = false; }
  update() { if (++this.frames === 5 && !this.active) this.hide(); }
}

// ---- Activities ---------------------------------------------------------------------------------------------------------
const ROOF_RACE = {
  id: 'toits',
  title: 'COURSE DES TOITS',
  place: 'roofs',
  contactLabel: 'Course des toits · grappin',
  *run(m) {
    const g = m.game;
    const route = roofChain(g, g.player.x, g.player.z, 6);
    if (route.length < 4) { m.toast('Pas de parcours ici', 'Les toits du coin ne s’enchaînent pas.'); return m.complete(0); }
    m.say1('', 'Six toits, un chrono. Grappin : 7 ou E, clic pour tirer · Maj face à un rebord : l’escalader.');
    yield* m.countdown();
    const limit = 25 + route.length * 13;
    m.timer(limit, 'Trop lent : les toits ont gagné.');
    const t0 = m.clock;
    for (let i = 0; i < route.length; i++) {
      const p = route[i];
      const mk = m.markAt(p.x, p.y, p.z, 'race', { radius: 3.2, height: 5 });
      m.gps(p.x, p.z);
      m.objective(`Toit *${i + 1}/${route.length}* · ${Math.round(p.y)} m`);
      yield* m.waitFor(() => m.nearAt(p.x, p.y, p.z, 4.2, 2.5));
      m.unmark(mk);
      m.sound('checkpoint');
    }
    m.stopTimer();
    const time = m.clock - t0, spare = Math.max(0, limit - time);
    m.complete(1800 + Math.round(spare * 60), `${time.toFixed(1)} s`);
  }
};

const DESCENT = {
  id: 'descente',
  title: 'DESCENTE',
  place: 'descent',
  contactLabel: 'Descente · wingsuit',
  *run(m) {
    const g = m.game;
    const t = tower(g, g.player.x, g.player.z, 140, 330, 700);
    const route = t && descentRoute(g, t.roof, t.spot);
    if (!route || route.rings.length < 3) { m.toast('Pas de descente ici', 'Aucune tour assez dégagée.'); return m.complete(0); }
    yield* m.say([['', 'Le monte-charge vous dépose sur le toit…']]);
    m.toRoof(route.start.x, route.start.y, route.start.z, route.heading);
    const rings = route.rings;
    g.skyRings.active = true;
    m.objective(`Sautez du toit (*${Math.round(route.start.y)} m*). Espace en l’air : wingsuit.`);
    const landMk = m.mark(route.land.x, route.land.z, 'objective', { radius: 14, height: 6 });
    m.gps(route.land.x, route.land.z);
    let i = 0, passed = 0, side = null;
    const fx = Math.sin(route.heading), fz = Math.cos(route.heading);
    g.skyRings.show(rings, 0, route.heading);
    // through the rings, in order: a ring is passed when the flight crosses its plane inside it
    while (i < rings.length) {
      const r = rings[i], p = g.person.position, y = p.y + 0.95;
      const ahead = (p.x - r.x) * fx + (p.z - r.z) * fz;
      if (side !== null && side < 0 && ahead >= 0) {
        const off = Math.hypot((p.x - r.x) - fx * ahead, y - r.y, (p.z - r.z) - fz * ahead);
        if (off < RING_RADIUS) { passed++; m.sound('checkpoint'); g.addMoney(250); g.hud.stunt('ANNEAU', `${passed}/${rings.length}`, 250, 1); }
        else m.sound('fail');
        i++; side = null;
        g.skyRings.show(rings, i, route.heading);
        continue;
      }
      side = ahead;
      if (g.state === 'onFoot' && p.y - (g.person.footing ?? 0) < 0.2 && m.clock > 2 && (g.person.footing ?? 0) < route.start.y - 5) break; // landed early
      m.objective(g.state === 'wingsuit' ? `Anneaux *${passed}/${rings.length}*` : g.state === 'freefall' ? 'Espace : *wingsuit*'
        : g.state === 'falling' ? 'Posez-vous sur la *zone d’arrivée*.' : `Sautez du toit. Anneaux *${passed}/${rings.length}*`);
      yield;
    }
    g.skyRings.hide();
    g.skyRings.active = false;
    m.objective('Posez-vous sur la *zone d’arrivée*. F : parachute.');
    yield* m.waitFor(() => g.state === 'onFoot' && g.person.position.y - (g.person.footing ?? 0) < 0.2 && !g.vertical.owns(g.state));
    m.unmark(landMk);
    const d = Math.hypot(g.player.x - route.land.x, g.player.z - route.land.z);
    const bonus = d < 15 ? 1500 : d < 40 ? 600 : 0;
    m.complete(passed * 300 + bonus, `${passed}/${rings.length} anneaux${bonus ? ' · arrivée dans la zone' : ''}`);
  }
};

// ---- The contract -------------------------------------------------------------------------------------------------------
const LEVERAGE = {
  id: 'levier',
  title: 'EFFET DE LEVIER',
  act: ACT,
  place: 'leverage',
  contactLabel: 'Jules · Effet de levier',
  needsWeapon: true,
  *run(m) {
    const g = m.game;
    const t = tower(g, SKY_PLACES.leverage.x, SKY_PLACES.leverage.z, 150, 330, 700);
    if (!t) { m.toast('Contrat reporté', 'Pas de tour à portée.'); return m.complete(0); }
    const { roof, spot } = t;
    yield* m.say([
      ['JULES', 'Cazal a monté ses registres au dernier étage d’une tour de Midtown. Le hall grouille de gardes, les ascenseurs ont des badges.'],
      ['SACHA', 'Et le toit ?'],
      ['JULES', 'Personne ne garde le ciel. Ton grappin porte à quatre-vingt-quinze mètres : accroche-toi à la façade, puis tire encore plus haut.'],
      ['JULES', `${Math.round(roof.maxY)} mètres. Prends les registres et ne redescends pas par l’escalier.`]
    ]);
    // 1. the foot of the tower
    const base = g.safeSpot(spot.x, spot.z, 1.2);
    let mk = m.mark(base.x, base.z, 'objective', { radius: 6 });
    m.gps(base.x, base.z);
    m.objective('Rejoignez le pied de la *tour de Cazal*.');
    yield* m.waitFor(() => m.near(base.x, base.z, 40) || g.person.position.y > 20);
    m.unmark(mk);
    // 2. up there: guards on the roof, the ledgers at its middle
    const guards = [];
    for (let i = 0; i < 5; i++) {
      const s = roofSpot(g.controllers, roof, spot.x + Math.cos(i * 1.3) * 9, spot.z + Math.sin(i * 1.3) * 9) || spot;
      guards.push(m.spawnActor({ x: s.x, y: roof.maxY, z: s.z, heading: i * 1.3, look: 'guard', team: 'varga', weapon: i % 2 ? 'rifle' : 'smg', hp: 110, armor: 30,
        behavior: 'guard', hostile: true, accuracy: 0.55, alert: false }));
    }
    for (const a of guards) if (!a.dead) a.roof = roof;
    mk = m.markAt(spot.x, roof.maxY, spot.z, 'objective', { radius: 3, height: 6 });
    m.objective(`Montez sur le *toit* (${Math.round(roof.maxY)} m). Grappin (7 ou E) : visez, tirez, et tirez encore depuis la façade.`);
    // on top: standing at the tower's height (its footprint may be several outlines), near its middle
    yield* m.waitFor(() => g.state === 'onFoot' && Math.abs(g.person.position.y - roof.maxY) < 0.6 && m.near(spot.x, spot.z, 90));
    m.unmark(mk);
    m.say1('SACHA', 'Ils m’attendaient pas là-haut.');
    for (const a of guards) if (!a.dead) a.alert = true;
    g.actors.alertTeam('varga', spot.x, spot.z, 200);
    const marks = guards.map((a) => (a.dead ? null : m.markOn(a, 'target')));
    m.objective('Neutralisez la *sécurité* de Cazal.');
    yield* m.waitFor(() => guards.every((a) => a.dead));
    marks.forEach((k) => m.unmark(k));
    // 3. the ledgers
    mk = m.markAt(spot.x, roof.maxY, spot.z, 'objective', { radius: 2, height: 3 });
    m.objective('Prenez les *registres*.');
    yield* m.waitFor(() => m.nearAt(spot.x, roof.maxY, spot.z, 2.6, 3));
    m.unmark(mk);
    m.sound('checkpoint');
    m.toast('Registres de Cazal', 'Tout ce qu’elle doit, à qui, depuis quand.');
    // 4. the way out is down, fast
    g.wanted.alarm(4, g.player.x, g.player.z);
    m.call('JULES', 'La police arrive dans la rue. Saute, Sacha. Espace en l’air pour ouvrir la wingsuit !');
    const route = descentRoute(g, roof, spot);
    const land = route ? route.land : g.safeSpot(spot.x + 500, spot.z, 2);
    mk = m.mark(land.x, land.z, 'objective', { radius: 16, height: 8 });
    m.gps(land.x, land.z);
    m.objective('Sautez et posez-vous au *point de chute*.');
    yield* m.waitFor(() => g.state === 'onFoot' && m.near(land.x, land.z, 30) && g.person.position.y < 3);
    m.unmark(mk);
    g.wanted.clear(true);
    yield* m.say([
      ['JULES', 'Je t’ai effacé des fréquences. Les registres, maintenant : on va voir ce que vaut une banquière à découvert.'],
      ['SACHA', 'Plus cher que la dette de mon frère.']
    ]);
    m.complete(25000);
  }
};

const SKY_ACTIVITIES = [ROOF_RACE, DESCENT];
const SKY_STORY = [LEVERAGE];

export { SKY_PLACES, SKY_ACTIVITIES, SKY_STORY, SkyRings, roofChain, descentRoute, tower, roofSpot };
