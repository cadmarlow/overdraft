import * as THREE from 'three/webgpu';

// The Architect's own eye. A photo is a frame rendered from where he stands, looking where he chooses (direction,
// framing, field of view), whatever the player's camera is doing: main.js hands the frame over just before the player's
// own render, the eye swaps the camera's pose, renders, reads the picture back and puts the camera back, all in the same
// task (only the last render of a frame reaches the screen). It also answers what is at a point of its last picture
// (a ray through that pixel: the object, its material, the module that builds it), and compares the ground the game
// computes for bodies with the ground actually drawn (a ray straight down onto the streets and sidewalks).

const PITCH = { sol: -0.72, rue: -0.04, facade: 0.1, haut: 0.5, ciel: 0.9 };
const FOV = { large: 80, normal: 55, serre: 25 };
const TURN = { devant: 0, gauche: Math.PI / 2, droite: -Math.PI / 2, derriere: Math.PI };
// Far from the player's camera the city around him is simplified (painted shops, low detail, no traffic): said with the photo
const DETAIL_RADIUS = 220;
// What builds what, from the names the scene gives its groups (js/*: `group.name = ...`), for the workshop's first file
const MODULES = [
  [/Storefronts|storefront|shopfront|awning/i, 'js/storefronts.js (rez-de-chaussée en relief), js/storefront-signs.js (enseignes), js/storefront-plan.js'],
  [/TimesSquareBillboards/, 'js/buildings.js (panneaux de Times Square)'],
  [/ManhattanCityBlocks|SurveyedBuilding/, 'js/buildings.js, js/building-footprints.js, js/tsl-materials.js (façades)'],
  [/ManhattanLandmarks|landmark/i, 'js/landmarks.js'],
  [/waterfrontPier/, 'js/city-grid.js (quais)'],
  [/ManhattanCityGrid|sidewalk|curb|kerb/i, 'js/city-grid.js (rues, trottoirs, bordures)'],
  [/Chunk$/, 'js/road-paint.js (marquages)'],
  [/ManhattanStreetDetails|StreetClusteredLights/, 'js/street-details.js (feux, lampadaires)'],
  [/Clutter_/, 'js/street-clutter.js (mobilier urbain)'],
  [/TreeCell|Trees|leaf|bark/i, 'js/trees.js, js/nature-assets.js'],
  [/grass|lawn/i, 'js/grass.js'],
  [/fire.?escape/i, 'js/fire-escapes.js'],
  [/HighwayTraffic|ManhattanTrafficAndPedestrians/, 'js/traffic.js (trafic, piétons), js/human-crowd.js'],
  [/Player(TaxiCar|Person|Helicopter|Cyclist)/, 'js/controllers.js (véhicules et corps du joueur)'],
  [/Borough|Palisades|RooseveltTram/, 'js/boroughs.js'],
  [/JumpRamps/, 'js/ramps.js'],
  [/GameplayEffects/, 'js/fx.js (effets : explosions, fumée)'],
  [/SkidMarks/, 'js/drive-fx.js'],
  [/MissionMarkers|Pickups/, 'js/missions.js'],
  [/subway/i, 'js/subway-entrances.js']
];

const _dir = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

class ArchitectEye {
  constructor(architect) {
    this.architect = architect;
    this.game = architect.game;
    this.jobs = [];
    this.last = null; // the pose and camera of the last picture, for identify()
    this.raycaster = new THREE.Raycaster();
    this.canvas = null;
  }

  attach({ renderer, scene }) {
    this.renderer = renderer;
    this.scene = scene;
  }

  // Where his eye stands and looks for a request like { direction, cadrage, zoom, x, y, z }
  pose(input = {}) {
    const a = this.architect, g = this.game, f = a.focus();
    const ride = a.ride;
    const heading = ride ? ride.heading : a.actor?.heading ?? g.camera.footYaw;
    const height = ride === a.heli ? 0 : ride ? 2.1 : 1.68;
    const pos = new THREE.Vector3(f.x, f.y + height, f.z);
    let yaw = heading + (TURN[input.direction] ?? 0);
    let pitch = PITCH[input.cadrage] ?? PITCH.rue;
    if (input.direction === 'vers_le_joueur') yaw = Math.atan2(g.player.x - f.x, g.player.z - f.z);
    if (input.direction === 'vers_point' && Number.isFinite(input.x) && Number.isFinite(input.z)) {
      const dx = input.x - f.x, dz = input.z - f.z, ty = Number.isFinite(input.y) ? input.y : pos.y;
      yaw = Math.atan2(dx, dz);
      if (!input.cadrage) pitch = Math.atan2(ty - pos.y, Math.hypot(dx, dz));
      else if (Number.isFinite(input.y)) pitch = Math.atan2(ty - pos.y, Math.hypot(dx, dz));
    }
    // a step forward, out of his own head (and back from the ground when looking down at it)
    const step = input.cadrage === 'sol' ? -0.25 : 0.32;
    pos.x += Math.sin(yaw) * step; pos.z += Math.cos(yaw) * step;
    if (input.cadrage === 'sol') pos.y += 0.25;
    return { x: pos.x, y: pos.y, z: pos.z, yaw, pitch, fov: FOV[input.zoom] ?? FOV.normal };
  }

  // A picture from a pose: resolved with a JPEG data URL (or null if no frame comes: hidden tab without his ticker)
  shoot(pose, { width = 1024, quality = 0.76, signal } = {}) {
    return new Promise((resolve) => {
      if (signal?.aborted) { resolve(null); return; }
      let timer;
      const finish = (image) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        const i = this.jobs.indexOf(job);
        if (i >= 0) this.jobs.splice(i, 1);
        resolve(image);
      };
      const abort = () => finish(null);
      const job = { pose, width, quality, resolve: finish };
      this.jobs.push(job);
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(abort, 3000);
    });
  }

  cancelPending() { for (const job of [...this.jobs]) job.resolve(null); }

  // How far the eye is from the player's camera: beyond the detailed radius, the photo shows a simplified city
  detailNote(pose) {
    const cam = this.game.camera.camera.position;
    const d = Math.hypot(pose.x - cam.x, pose.z - cam.z);
    return d > DETAIL_RADIUS ? `Attention : ton œil est à ${Math.round(d)} m de la caméra du joueur ; à cette distance la ville est simplifiée (vitrines peintes, détails et trafic absents) : ne juge pas ces détails ici.` : '';
  }

  // Called by main.js (through the Architect) just before the player's frame is rendered
  beforeRender(camera, render, canvas) {
    const job = this.jobs.shift();
    if (!job) return;
    const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov };
    const p = job.pose;
    try {
      camera.position.set(p.x, p.y, p.z);
      _dir.set(Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), Math.cos(p.yaw) * Math.cos(p.pitch));
      camera.lookAt(p.x + _dir.x, p.y + _dir.y, p.z + _dir.z);
      camera.fov = p.fov;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      render();
      this.last = { pose: p, camera: camera.clone(), t: performance.now() };
      job.resolve(this.read(canvas, job));
    } catch {
      job.resolve(null);
    } finally {
      camera.position.copy(saved.position);
      camera.quaternion.copy(saved.quaternion);
      camera.fov = saved.fov;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      this.architect.senses.skipFrame();
      this.nextFrame(); // or the player's render would reuse the passes just drawn from his eye
    }
  }

  // three.js draws each pass (the scene, SSR, bloom) once per node frame, and only its own requestAnimationFrame loop
  // moves to the next one: after his picture, and in a hidden tab when an image is wanted, move on by hand (as that loop
  // does), or the next render repeats the last image
  nextFrame() {
    const r = this.renderer, nodes = r?._nodes;
    if (!nodes?.nodeFrame) return;
    if (r.info.autoReset === true) r.info.reset();
    nodes.nodeFrame.update();
    r.info.frame = nodes.nodeFrame.frameId;
  }

  read(canvas, job) {
    const c = (this.canvas ??= document.createElement('canvas'));
    c.width = job.width;
    c.height = Math.round(job.width * canvas.height / canvas.width);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', job.quality);
  }

  // The player's own view, as it is on screen (no pose of his own): also what the last picture's rays use
  rememberPlayerView() {
    this.last = { pose: null, camera: this.game.camera.camera.clone(), t: performance.now() };
  }

  // ---- What is there --------------------------------------------------------------------------------------------------
  // Objects under a point of his last picture (x, y from 0 to 1): name, material, distance, module
  identify(x, y) {
    if (!this.last || !this.scene) return { ok: false, texte: 'Pas encore de photo à analyser : photographie d’abord.' };
    const cam = this.last.camera;
    cam.updateMatrixWorld();
    this.raycaster.layers.mask = cam.layers.mask;
    this.raycaster.setFromCamera(new THREE.Vector2(x * 2 - 1, -(y * 2 - 1)), cam);
    this.raycaster.far = 600;
    const hits = this.cast(this.scene.children).slice(0, 3);
    if (!hits.length) return { ok: true, texte: 'Rien de solide à cet endroit de la photo (le ciel, ou un objet trop loin).' };
    const descriptions = hits.map((h, i) => {
      const chain = [];
      for (let o = h.object; o && o !== this.scene && chain.length < 5; o = o.parent) chain.push(o.name || o.type);
      const m = Array.isArray(h.object.material) ? h.object.material[h.face?.materialIndex ?? 0] : h.object.material;
      const names = `${chain.join(' ')} ${m?.name || ''}`;
      const mod = MODULES.find(([re]) => re.test(names))?.[1] || 'inconnu (chercher le nom de l’objet dans js/)';
      const flags = Object.keys(h.object.userData || {}).filter((k) => !k.startsWith('_')).slice(0, 6);
      return {
        line: `${i + 1}. ${chain.join(' ← ')} · matériau ${m?.name || m?.type || '?'}${flags.length ? ` · userData ${flags.join(', ')}` : ''}${h.instanceId !== undefined ? ` · instance ${h.instanceId}` : ''} · à ${h.distance.toFixed(1)} m (x ${h.point.x.toFixed(1)}, y ${h.point.y.toFixed(2)}, z ${h.point.z.toFixed(1)}) · module probable : ${mod}`,
        hit: {
          name: h.object.name || '', type: h.object.type, uuid: h.object.uuid,
          distance: h.distance, point: { x: h.point.x, y: h.point.y, z: h.point.z }, instance: h.instanceId ?? null,
          material: m ? { name: m.name || '', type: m.type, uuid: m.uuid } : null, module: mod
        }
      };
    });
    // Scene objects and node materials contain cycles and large shader graphs: only small JSON descriptions cross RPC.
    return { ok: true, texte: `Au point (${Math.round(x * 100)} %, ${Math.round(y * 100)} %) de ta dernière photo :\n${descriptions.map((d) => d.line).join('\n')}`, hits: descriptions.map((d) => d.hit) };
  }

  // Visible meshes only, skipping the giant instanced crowds and the Architect himself
  cast(objects) {
    const hits = [];
    const skip = new Set();
    if (this.architect.heli?.mesh) skip.add(this.architect.heli.mesh);
    if (this.architect.actor?.model?.root) skip.add(this.architect.actor.model.root);
    const visit = (o) => {
      if (!o.visible || skip.has(o) || o.userData?.shadowProxy) return;
      if (o.layers.test(this.raycaster.layers) && (o.isMesh || o.isInstancedMesh) && !o.isSkinnedMesh && !(o.isInstancedMesh && o.count > 4000)) {
        const before = hits.length;
        try { o.raycast(this.raycaster, hits); } catch { hits.length = before; }
      }
      for (const c of o.children) visit(c);
    };
    for (const o of objects) visit(o);
    return hits.sort((a, b) => a.distance - b.distance);
  }

  // ---- The ground ---------------------------------------------------------------------------------------------------
  // On a grid around (x, z): the ground the game computes for a body, against the surface drawn there
  probeGround(cx, cz, radius = 6) {
    if (!this.scene) return { ok: false, texte: 'Œil pas encore branché.' };
    const c = this.game.controllers;
    const step = Math.max(1, radius / 3);
    const rows = [];
    let worst = null;
    for (let dx = -radius; dx <= radius + 1e-6; dx += step) for (let dz = -radius; dz <= radius + 1e-6; dz += step) {
      const x = cx + dx, z = cz + dz;
      const computed = c.getGroundHeight(x, z, 'person', 0);
      const drawn = this.drawnGround(x, z, computed + 3);
      if (!drawn) continue;
      const gap = computed - drawn.y; // positive: the body stands above the drawn surface (floats); negative: sinks into it
      const row = { x, z, computed, drawn: drawn.y, gap, what: drawn.name, sidewalk: c.isPointOnSidewalk?.(x, z) };
      rows.push(row);
      if (!worst || Math.abs(gap) > Math.abs(worst.gap)) worst = row;
    }
    if (!rows.length) return { ok: true, texte: 'Aucune surface dessinée trouvée sous ces points.' };
    const bad = rows.filter((r) => Math.abs(r.gap) > 0.04);
    const fmt = (r) => `(x ${r.x.toFixed(1)}, z ${r.z.toFixed(1)}) calculé ${r.computed.toFixed(2)} m, dessiné ${r.drawn.toFixed(2)} m (${r.what}), écart ${(r.gap * 100).toFixed(0)} cm${r.sidewalk ? ', trottoir pour le jeu' : ''}`;
    return {
      ok: true,
      texte: `${rows.length} points sondés sur ${radius} m autour de (x ${cx.toFixed(0)}, z ${cz.toFixed(0)}). ${bad.length ? `${bad.length} écart(s) de plus de 4 cm` : 'Aucun écart de plus de 4 cm'} entre le sol calculé (corps) et le sol dessiné.${worst ? `\nPire point : ${fmt(worst)}.` : ''}${bad.length ? `\nAutres écarts :\n${bad.filter((r) => r !== worst).slice(0, 6).map((r) => `- ${fmt(r)}`).join('\n')}` : ''}\n(écart positif : le corps flotte au-dessus du dessin ; négatif : il s’y enfonce.)`,
      rows, worst
    };
  }

  // The highest roughly horizontal drawn surface under (x, z), below `from`
  drawnGround(x, z, from) {
    this.raycaster.layers.mask = this.game.camera.camera.layers.mask;
    this.raycaster.set(new THREE.Vector3(x, from, z), _down);
    this.raycaster.far = from + 5;
    const hits = this.cast(this.groundObjects());
    for (const h of hits) {
      const n = h.face?.normal;
      if (n) {
        _dir.copy(n).transformDirection(h.object.matrixWorld);
        if (_dir.y < 0.6) continue;
      }
      return { y: h.point.y, name: h.object.name || h.object.parent?.name || h.object.type };
    }
    return null;
  }

  // Static scenery only: no cars, people or the Architect's machines under the ray
  groundObjects() {
    if (this.groundCache && performance.now() - this.groundCache.t < 5000) return this.groundCache.list;
    const moving = /traffic|car|vehicle|ped|crowd|person|people|human|heli|actor|architect/i;
    const list = this.scene.children.filter((o) => o.visible && !moving.test(o.name || ''));
    this.groundCache = { t: performance.now(), list };
    return list;
  }
}

export { ArchitectEye, FOV, PITCH };
