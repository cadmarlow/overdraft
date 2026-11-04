import { buildReproLink } from './repro-link.js';

// The line between the Architect's body (architect.js) and his server (tools/architecte, `npm run architecte`), where
// Claude thinks. The server sends orders over Server-Sent Events; the game posts back what it saw and did: its state
// every second, events (arrival, an attack, a sensor; an accident with a burst of photos and the seconds before it),
// the result of each order (photos and measures included), the player's own words (K), and, while a control room is
// open, a small live picture every second and a half. Local only, like him.

// his server's port, away from the 5173+ range dev servers take (another one for a test server: ?architecte_port=7781)
const PORT = Number(new URLSearchParams(location.search).get('architecte_port')) || 7780;
// the chase camera's pitch for each framing, when the camera turns with his body (alone, on foot)
const PITCH = { sol: 0.4, rue: 0.09, facade: -0.06, haut: -0.3, ciel: -0.32 };
const BY = { pied: 'foot', voiture: 'car', helico: 'heli', auto: 'auto' };
const LOADED = Math.round(performance.timeOrigin); // when this page loaded the game's code
const ZONE = 350; // playing together, he stays within the living part of town around the player
const STATES = { onFoot: 'à pied', driving: 'au volant', dead: 'mort', busted: 'arrêté', falling: 'en chute', swimming: 'à la nage' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

class ArchitectLink {
  constructor(architect) {
    this.architect = architect;
    this.game = architect.game;
    this.base = `${location.protocol}//${location.hostname}:${PORT}`;
    this.connected = false;
    this.retry = 2000;
    this.live = false;
    this.voice = false;
    this.places = null;
    architect.senses.onEvent((e, fresh) => { if (fresh) this.sensed(e).catch(() => {}); });
    this.buildChat();
    this.connect();
    // sent from the frames (frameTick), which keep coming when the tab is hidden and he works; this is the fallback
    this.stateTimer = setInterval(() => { if (performance.now() - (this.lastSent || 0) > 1500) this.sendState(); }, 1000);
    // hidden or shown again: the control room hears it at once
    document.addEventListener('visibilitychange', () => this.sendState());
  }

  // ---- The connection ------------------------------------------------------------------------------------------------
  connect() {
    const source = new EventSource(`${this.base}/jeu/flux`);
    this.source = source;
    source.onopen = () => {
      this.connected = true;
      this.retry = 2000;
      this.architect.refreshButton();
      this.post('/jeu/bonjour', { build: this.game.buildVersion || document.querySelector('.build-label')?.textContent?.replace('BUILD ', ''), lieux: this.placeList(), carte: this.roadMap(), charge: LOADED });
      this.sendState();
    };
    source.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.type === 'cmd') this.run(msg);
      else if (msg.type === 'config') this.configure(msg);
    };
    source.onerror = () => {
      // our own back-off: the server may simply not be running
      source.close();
      if (this.connected) { this.connected = false; this.architect.refreshButton(); }
      this.live = false;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(30000, this.retry * 1.6);
    };
  }

  post(route, body) {
    if (!this.connected && route !== '/jeu/bonjour') return Promise.resolve(null);
    return fetch(`${this.base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  }

  event(kind, text, data, extra = {}) { this.post('/jeu/evenement', { kind, text, data, ...extra }); }

  // A sensor fired: the event, the seconds before it, and for an accident a burst of photos of the spot
  async sensed(e) {
    const a = this.architect;
    const where = e.address || `${Math.round(e.x)}, ${Math.round(e.z)}`;
    let text = `Capteur — ${e.title}${e.who ? ` (${e.who})` : ''} : ${e.detail} À ${where}.`;
    const before = a.retro.window(4);
    if (before) text += `\nLes secondes d’avant :\n${before}`;
    const photos = a.retro.wantsBurst(e.kind) && this.connected ? await a.retro.burst(e).catch(() => []) : [];
    this.event(photos.length ? 'rafale' : 'capteur', text, { lien: e.link, capteur: e.kind }, photos.length ? { photos, lieu: { x: e.x, y: e.y, z: e.z, adresse: e.address, lien: e.link } } : {});
  }

  configure(msg) {
    if (Object.hasOwn(msg, 'voix')) this.setVoice(msg.voix === true);
    if (msg.live && !this.live) { this.live = true; this.liveLoop(msg.every || 1500); }
    if (!msg.live) this.live = false;
  }

  // A small picture for the control room, while one is open
  async liveLoop(every) {
    while (this.live && this.connected) {
      if (this.game.playing && (document.visibilityState === 'visible' || this.architect.ticking)) {
        const jpeg = await this.architect.capture({ width: 640, quality: 0.6 });
        if (jpeg && this.live) await this.post('/jeu/image', { jpeg });
      }
      await wait(every);
    }
  }

  // ---- What he knows of the world -----------------------------------------------------------------------------------
  placeList() {
    if (this.places) return this.places;
    const g = this.game, seen = new Set();
    const out = [];
    const add = (id, label, x, z) => {
      if (seen.has(id) || !Number.isFinite(x) || !Number.isFinite(z)) return;
      seen.add(id);
      out.push({ id, label, x: Math.round(x), z: Math.round(z) });
    };
    for (const p of this.architect.places) add(p.id, p.label, p.x, p.z);
    for (const l of this.architect.landmarks || []) add(l.id, l.name, l.x, l.z);
    for (const z of g.gangs?.zones || []) add(`quartier-${z.id}`, `${z.name} (territoire de gang)`, (z.box[0] + z.box[1]) / 2, (z.box[2] + z.box[3]) / 2);
    this.places = out;
    return out;
  }

  // The streets, for the control room's map: one [x0, z0, x1, z1] per road segment, in whole metres
  roadMap() {
    const edges = this.game.traffic?.network?.edges || [];
    const segments = [];
    for (const e of edges) {
      if (!e.from || !e.to) continue;
      segments.push([Math.round(e.from.x), Math.round(e.from.z), Math.round(e.to.x), Math.round(e.to.z)]);
    }
    return { segments };
  }

  frameTick() {
    if (performance.now() - (this.lastSent || 0) > 1000) this.sendState();
  }

  sendState() {
    if (!this.connected) return;
    this.lastSent = performance.now();
    const g = this.game, a = this.architect, pl = g.player;
    const s = a.state();
    const f = a.focus();
    this.post('/jeu/etat', {
      architecte: { ...s, trip: !!a.trip && a.trip.kind !== 'inspect' && a.trip.kind !== 'follow' },
      joueur: {
        x: Math.round(pl.x), y: Math.round(pl.y), z: Math.round(pl.z), state: STATES[g.state] || g.state, health: Math.round(g.health), wanted: g.wanted?.level || 0,
        mission: g.director?.current?.title || null, inVehicle: pl.inVehicle, vehicle: pl.inVehicle ? document.querySelector('#vehicle-name strong')?.textContent : null,
        distance: Math.round(Math.hypot(pl.x - f.x, pl.z - f.z))
      },
      monde: { heure: g.atmosphere.clockLabel, meteo: g.atmosphere.weatherLabel, weather: g.atmosphere.weather, fps: Math.round(a.senses.fpsAvg || 0) },
      // a hidden tab is paused by the browser: nothing moves, he cannot arrive or think
      onglet: { visible: document.visibilityState === 'visible', lance: !!g.playing, pause: !!g.paused }
    });
  }

  // ---- Orders --------------------------------------------------------------------------------------------------------
  async run({ id, name, input = {} }) {
    let result;
    try {
      result = await this.execute(name, input);
    } catch (e) {
      result = { ok: false, texte: `Erreur dans le jeu : ${e.message}` };
    }
    this.post('/jeu/resultat', { id, ...result });
  }

  target(input) {
    const p = input.lieu && this.placeList().find((q) => q.id === input.lieu);
    if (p) return { x: p.x, z: p.z, label: p.label };
    if (Number.isFinite(input.x) && Number.isFinite(input.z)) return { x: input.x, z: input.z, label: '' };
    return null;
  }

  async execute(name, input) {
    const a = this.architect, g = this.game, pl = g.player;
    const alone = a.spectating;
    const needBody = !['envoyer_sms', 'presence', 'camera', 'camera-now', 'mesurer_performances'].includes(name) && !(name === 'dire' && input.conversation);
    const playerView = name === 'photographier' && input.direction === 'vue_du_joueur';
    if (needBody && !playerView && !a.alive) return { ok: false, texte: 'Tu n’as pas de corps en ce moment (absent ou hors service).' };
    switch (name) {
      case 'aller_a': {
        const t = this.target(input);
        if (!t) return { ok: false, texte: 'Destination inconnue : donne un lieu de la liste ou x et z.' };
        if (!alone && Math.hypot(t.x - pl.x, t.z - pl.z) > ZONE) return { ok: false, texte: `Refusé : le joueur joue, et ce lieu est à ${Math.round(Math.hypot(t.x - pl.x, t.z - pl.z))} m de lui. La ville n’est vivante qu’à ${ZONE} m autour de lui. Travaille près de lui, ou attends qu’il te laisse la caméra.` };
        // the same destination again while on the way: nothing to restart
        const o = a.order, here = a.focus();
        if (!input.reprendre && o?.kind === 'goto' && a.trip && Math.hypot(o.x - t.x, o.z - t.z) < 25) return { ok: true, texte: `Tu es déjà en route vers ${o.label} (encore ${Math.round(Math.hypot(t.x - here.x, t.z - here.z))} m). Tu seras prévenu à l’arrivée.` };
        a.goTo(t.x, t.z, { by: BY[input.moyen] || 'auto', label: t.label || undefined });
        const f = a.focus();
        return { ok: true, texte: `${a.intent} (à ${Math.round(Math.hypot(t.x - f.x, t.z - f.z))} m). Tu seras prévenu à l’arrivée.` };
      }
      case 'suivre_joueur':
        a.follow();
        return { ok: true, texte: alone ? 'Tu suis le joueur, mais il est absent : son personnage attend.' : 'Tu suis le joueur.' };
      case 's_arreter':
        a.stop();
        return { ok: true, texte: 'Tu t’arrêtes et tu observes.' };
      case 'photographier': return this.photo(input);
      case 'dire': {
        // an answer to the Creator is always shown and spoken; a line in the street only reaches whoever is near
        const text = String(input.texte || '').slice(0, input.conversation ? 400 : 220);
        a.say(text, Math.min(input.conversation ? 14 : 9, 2.5 + text.length / 18));
        const f = a.focus();
        const heard = input.conversation || alone || Math.hypot(pl.x - f.x, pl.z - f.z) < 60;
        if (this.voice && heard) this.speak(text);
        return { ok: true, texte: heard ? 'Dit.' : 'Dit, mais le joueur est trop loin pour t’entendre.' };
      }
      case 'identifier': return a.eye.identify(clamp01(input.x ?? 0.5), clamp01(input.y ?? 0.5));
      case 'sonder_sol': {
        const f = a.focus();
        a.senses.quiet(2);
        return a.eye.probeGround(f.x, f.z, Math.max(2, Math.min(12, Number(input.rayon) || 6)));
      }
      case 'mesurer_vehicule': return a.measureVehicle(input.cible || 'le_mien', Number(input.duree) || 4);
      case 'mesurer_performances': return a.measurePerformance(Number(input.duree) || 4);
      case 'lancer_experience': {
        const r = await a.lab.run(input);
        if (r.ok) r.lieu = { ...r.lieu, lien: buildReproLink({ x: r.lieu.x, y: r.lieu.y, z: r.lieu.z, yaw: g.camera.footYaw, pitch: g.camera.orbitPitchOffset, hour: g.atmosphere.hour, weather: g.atmosphere.weather }, location.href) };
        return r;
      }
      case 'envoyer_sms':
        g.phone?.text('L’ARCHITECTE', String(input.texte || '').slice(0, 300));
        return { ok: true, texte: 'SMS envoyé.' };
      case 'regler_heure_meteo': {
        if (!alone) return { ok: false, texte: 'Refusé : le joueur joue, son monde lui appartient (mode Seul seulement).' };
        if (Number.isFinite(input.heure)) g.atmosphere.setHour(input.heure);
        if (input.meteo) { g.atmosphere.setWeather(input.meteo, true); g.atmosphere.lockWeather = true; g.weatherMode = input.meteo; }
        return { ok: true, texte: `Il est ${g.atmosphere.clockLabel}, ${g.atmosphere.weatherLabel.toLowerCase()}.` };
      }
      case 'se_teleporter': {
        if (!alone) return { ok: false, texte: 'Refusé : pas sous les yeux du joueur (mode Seul seulement).' };
        const t = this.target(input);
        if (!t) return { ok: false, texte: 'Destination inconnue.' };
        a.teleportSelf(t.x, t.z, Number.isFinite(input.cap) ? input.cap : null, Number.isFinite(input.y) ? input.y : null);
        if (Number.isFinite(input.cap)) { g.camera.footYaw = input.cap; g.camera.orbitPitchOffset = Number.isFinite(input.tangage) ? input.tangage : PITCH.rue; }
        await wait(1200);
        return { ok: true, texte: `Tu es à ${a.state().address || 'destination'}.` };
      }
      case 'recharger_le_jeu':
        if (!alone) return { ok: false, texte: 'Refusé : le joueur joue (mode Seul seulement).' };
        a.reloadSoon();
        return { ok: true, texte: 'Le jeu se recharge ; tu reprends ici, caméra en main, dans une trentaine de secondes.' };
      case 'presence':
        if (input.on === false) { a.dismiss(); return { ok: true, texte: 'Renvoyé.' }; }
        a.summon();
        if (document.visibilityState !== 'visible') return { ok: true, texte: 'Il arrivera quand l’onglet du jeu sera visible (Chrome met en pause un onglet caché).' };
        return { ok: true, texte: g.playing ? 'Il arrive.' : 'Il arrivera dès que la partie sera lancée (ENTRER DANS LA VILLE).' };
      case 'camera': {
        // from the control room: one click does what it takes (and says so when the tab is hidden, hence paused)
        const hidden = document.visibilityState !== 'visible' ? ' Mais l’onglet du jeu est caché : Chrome le met en pause, rien ne bougera tant qu’il ne sera pas visible.' : '';
        const r = await this.execute('camera-now', input);
        return { ...r, texte: r.texte + hidden };
      }
      // who holds the camera, as the Creator chose it in the control room (set, not toggled)
      case 'camera-set': {
        const him = input.qui === 'lui';
        if (him === a.spectating) return { ok: true, texte: him ? 'Il tient déjà la caméra.' : 'Tu tiens déjà la caméra.' };
        if (!him) { a.toggleSpectate(); return { ok: true, texte: 'Tu as repris la caméra.' }; }
        return this.execute('camera-now', input);
      }
      case 'camera-now': {
        if (a.spectating) { a.toggleSpectate(); return { ok: true, texte: 'Tu as repris la main : mode Ensemble.' }; }
        if (!g.playing) { a.spectateWhenReady = true; if (!a.present) a.summon(); return { ok: true, texte: 'La partie n’est pas lancée : clique ENTRER DANS LA VILLE dans le jeu, il prendra la caméra aussitôt.' }; }
        if (g.paused) g.setPaused(false);
        if (!a.present) { a.summon(); a.spectateWhenReady = true; return { ok: true, texte: 'Il arrive, puis il prend la caméra.' }; }
        if (!a.alive) { a.spectateWhenReady = true; return { ok: true, texte: `Il est hors service : il prendra la caméra à son retour (dans ${a.state().respawnIn ?? '?'} s).` }; }
        a.lastRefusal = null;
        a.toggleSpectate();
        return a.spectating ? { ok: true, texte: 'Il a la caméra : mode Seul.' } : { ok: false, texte: a.lastRefusal || 'Refusé par le jeu.' };
      }
      default:
        return { ok: false, texte: `Ordre inconnu : ${name}` };
    }
  }

  // A photo from his own eye (or, asked for, exactly what the player sees). Alone and on foot his body and the chase
  // camera turn with it too, so that the live view in the control room shows what he looks at.
  async photo(input) {
    const a = this.architect, g = this.game;
    if (!g.playing) return { ok: false, texte: 'Le joueur est dans le menu : rien à voir.' };
    const tab = document.visibilityState !== 'visible' && !a.ticking ? ' (onglet du jeu caché : aucune image ne vient)' : '';
    if (input.direction === 'vue_du_joueur' || !a.actor && !a.ride) {
      const image = await a.capture({ width: 1024, quality: 0.76 });
      if (!image) return { ok: false, texte: `La capture a échoué${tab}.` };
      a.eye.rememberPlayerView();
      const p = g.player;
      return { ok: true, texte: `Ce que voit le joueur, ${a.addressAt(p.x, p.z)}, ${g.atmosphere.clockLabel}, ${g.atmosphere.weatherLabel.toLowerCase()}.`, image, lieu: this.place({ x: p.x, y: p.y, z: p.z }, null) };
    }
    const pose = a.eye.pose(input);
    if (a.spectating && a.actor && !a.ride) {
      a.lookTowards(pose.yaw);
      g.camera.footYaw = pose.yaw;
      g.camera.orbitPitchOffset = PITCH[input.cadrage] ?? PITCH.rue;
      const cancelled = await a.measureFor(0.5, () => {});
      if (cancelled) return { ok: false, texte: `Photo interrompue : ${cancelled}` };
    }
    const image = await a.eye.shoot(pose, { width: 1024, quality: 0.76 });
    if (!image) return { ok: false, texte: `La capture a échoué${tab}.` };
    const f = a.focus();
    const note = a.eye.detailNote(pose);
    const label = [input.direction, input.cadrage, input.zoom].filter(Boolean).join(', ');
    return { ok: true, texte: `${a.addressAt(f.x, f.z)}, ${g.atmosphere.clockLabel}, ${g.atmosphere.weatherLabel.toLowerCase()} (œil : ${label}, ${Math.round(pose.fov)}°).${note ? ` ${note}` : ''}`, image, lieu: this.place(f, pose, input) };
  }

  // Where a photo was taken, with the link that puts anyone back in front of it
  place(f, pose, input = {}) {
    const g = this.game, a = this.architect;
    return {
      x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10, z: Math.round(f.z * 10) / 10,
      yaw: +(pose?.yaw ?? g.camera.footYaw).toFixed(2), pitch: +g.camera.orbitPitchOffset.toFixed(2), adresse: a.addressAt(f.x, f.z),
      heure: g.atmosphere.hour, meteo: g.atmosphere.weather, oeil: pose ? { direction: input.direction, cadrage: input.cadrage, zoom: input.zoom, ...pose } : null,
      lien: buildReproLink({ x: f.x, y: f.y, z: f.z, yaw: pose?.yaw ?? g.camera.footYaw, pitch: g.camera.orbitPitchOffset, hour: g.atmosphere.hour, weather: g.atmosphere.weather, eye: pose }, location.href)
    };
  }

  // ---- His voice and the player's words -------------------------------------------------------------------------------
  setVoice(enabled) {
    this.voice = enabled === true;
    if (!this.voice) this.stopSpeaking();
  }

  stopSpeaking() { window.speechSynthesis?.cancel(); }

  speak(text) {
    const synth = window.speechSynthesis;
    if (!synth || !this.voice || !this.architect.present) return;
    this.voiceChoice ??= synth.getVoices().filter((v) => v.lang?.startsWith('fr')).sort((p, q) => (q.name.includes('Thomas') - p.name.includes('Thomas')) || (q.lang === 'fr-FR') - (p.lang === 'fr-FR'))[0] || null;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    if (this.voiceChoice) u.voice = this.voiceChoice;
    u.rate = 1.04;
    u.pitch = 0.85;
    synth.cancel();
    synth.speak(u);
  }

  buildChat() {
    document.body.insertAdjacentHTML('beforeend', '<form id="architect-chat" class="architect-chat" hidden><b>À L’ARCHITECTE</b><input maxlength="300" autocomplete="off" placeholder="Dis-lui quelque chose… (Entrée pour envoyer, Échap pour fermer)"></form>');
    const form = document.getElementById('architect-chat');
    const input = form.querySelector('input');
    this.chat = form;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text) { this.post('/jeu/message', { texte: text }); this.architect.game.hud.say('VOUS', text, 3); }
      input.value = '';
      this.closeChat();
    });
    input.addEventListener('keydown', (e) => { if (e.code === 'Escape') { e.stopPropagation(); this.closeChat(); } });
    for (const type of ['mousedown', 'pointerdown', 'click', 'keyup']) form.addEventListener(type, (e) => e.stopPropagation());
  }

  openChat() {
    const a = this.architect;
    if (!this.connected) { a.game.toast('L’Architecte', 'Son cerveau est hors ligne : lance npm run architecte.'); return; }
    if (!a.present) { a.game.toast('L’Architecte', 'Faites-le d’abord venir (menu pause).'); return; }
    a.game.releasePointer?.();
    a.game.controllers.resetInput();
    this.chat.hidden = false;
    this.chat.querySelector('input').focus();
  }

  closeChat() {
    this.chat.hidden = true;
    this.chat.querySelector('input').blur();
    this.game.camera.domElement?.focus?.();
  }
}

export { ArchitectLink };
