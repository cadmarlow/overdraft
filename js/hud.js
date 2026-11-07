// In-game HUD: vitals, money, wanted stars, weapon & ammo, crosshair and hit markers, objective, subtitles, timers,
// mission banners, radio caption and screen-edge effects. Plain DOM, updated from gameplay.js.

const el = (tag, cls, parent, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.append(node);
  return node;
};

// "Text with *emphasis*" as safe DOM nodes
function richText(node, text) {
  node.replaceChildren();
  String(text).split('*').forEach((part, i) => {
    if (!part) return;
    if (i % 2) el('b', null, node, part);
    else node.append(document.createTextNode(part));
  });
}

const money = (n) => `${Math.round(n).toLocaleString('fr-FR').replace(/ /g, ' ')} $`;

class GameHud {
  constructor() {
    this.stunts = el('div', '', document.body);
    this.stunts.id = 'stunt-feed';
    this.zoneBox = el('div', '', document.body);
    this.zoneBox.id = 'zone-label';
    const root = this.root = el('div', 'gh', document.body);
    root.id = 'game-hud';
    // Top right: wanted stars, money, weapon
    const tr = el('div', 'gh-topright', root);
    const wanted = this.wanted = el('div', 'gh-wanted', tr);
    this.stars = Array.from({ length: 5 }, () => el('i', null, wanted));
    this.wantedName = el('div', 'gh-wanted-name', tr);
    this.wantedEscape = el('div', 'gh-wanted-escape', tr);
    this.wantedEscapeFill = el('i', null, this.wantedEscape);
    this.money = el('div', 'gh-money', tr, '0 $');
    this.moneyDelta = el('div', 'gh-money-delta', tr);
    const weapon = this.weapon = el('div', 'gh-weapon', tr);
    this.weaponName = el('strong', null, weapon, 'POINGS');
    this.weaponAmmo = el('span', null, weapon, '');

    // Vitals under the radar
    const vitals = this.vitals = el('div', 'gh-vitals', root);
    const hp = el('div', 'gh-bar gh-health', vitals);
    this.healthFill = el('i', null, hp);
    const ar = el('div', 'gh-bar gh-armor', vitals);
    this.armorFill = el('i', null, ar);

    // Center
    this.crosshair = el('div', 'gh-crosshair', root);
    for (let i = 0; i < 4; i++) el('i', null, this.crosshair);
    this.hitmarker = el('div', 'gh-hitmarker', root);
    for (let i = 0; i < 4; i++) el('i', null, this.hitmarker);
    this.hitCaption = el('span', 'gh-hit-caption', this.hitmarker);
    this.reloadSight = el('div', 'gh-reload-sight', root);
    this.reloadSightFill = el('i', null, this.reloadSight);
    this.combat = el('div', 'gh-combat', root);
    this.combatMode = el('div', 'gh-combat-mode', this.combat);
    const rounds = el('div', 'gh-rounds', this.combat);
    this.combatMag = el('strong', null, rounds, '12');
    this.combatReserve = el('span', null, rounds, '/ 120');
    this.combatStatus = el('div', 'gh-combat-status', this.combat);
    const reloadTrack = el('div', 'gh-combat-track', this.combat);
    this.combatReload = el('i', null, reloadTrack);

    // Objective, subtitles, timer, banners
    this.objective = el('div', 'gh-objective', root);
    this.subtitle = el('div', 'gh-subtitle', root);
    this.subSpeaker = el('strong', null, this.subtitle);
    this.subText = el('span', null, this.subtitle);
    this.timer = el('div', 'gh-timer', root);
    this.banner = el('div', 'gh-banner', root);
    this.bannerKicker = el('span', 'gh-banner-kicker', this.banner);
    this.bannerTitle = el('strong', 'gh-banner-title', this.banner);
    this.bannerSub = el('span', 'gh-banner-sub', this.banner);
    this.arrest = el('div', 'gh-arrest', root);
    el('span', null, this.arrest, 'ARRESTATION');
    this.arrestFill = el('i', null, el('div', 'gh-arrest-track', this.arrest));
    this.radio = el('div', 'gh-radio', root);
    this.radioName = el('strong', null, this.radio);
    this.radioSong = el('span', null, this.radio);
    this.damage = el('div', 'gh-damage', root);
    this.edge = el('div', 'gh-wanted-edge', root);
    this.mission = el('div', 'gh-mission-title', root);
    this.clock = el('div', 'gh-clock', root);
    this.clockTime = el('strong', null, this.clock, '17:00');
    this.clockWeather = el('span', null, this.clock, '');

    this.shownMoney = 0;
    this.targetMoney = 0;
    this.deltaT = 0;
    this.hitT = 0;
    this.hitDuration = 0.25;
    this.reticleKick = 0;
    this.reticleSpread = 6;
    this.subT = 0;
    this.bannerT = 0;
    this.radioT = 0;
    this.damageLevel = 0;
    this.state = {};
  }

  setMoney(value, instant = false) {
    const delta = value - this.targetMoney;
    this.targetMoney = value;
    if (instant) { this.shownMoney = value; this.money.textContent = money(value); return; }
    if (Math.abs(delta) >= 1) {
      this.moneyDelta.textContent = `${delta > 0 ? '+' : '−'}${money(Math.abs(delta))}`;
      this.moneyDelta.classList.toggle('neg', delta < 0);
      this.moneyDelta.classList.add('show');
      this.deltaT = 2.4;
    }
  }

  // A trick landed: floats up beside the speedometer
  stunt(title, detail, amount, chain) {
    const row = el('div', 'stunt-row', this.stunts);
    el('strong', '', row, title);
    if (detail) el('span', '', row, detail);
    el('b', '', row, `+$${amount}`);
    if (chain > 1) el('i', '', row, `×${Math.min(5, chain)}`);
    while (this.stunts.children.length > 4) this.stunts.firstChild.remove();
    setTimeout(() => row.remove(), 2400);
  }

  // Crossing into someone's neighbourhood
  zone(name, owner, colour) {
    const box = this.zoneBox;
    box.replaceChildren();
    el('strong', '', box, name);
    const who = el('span', '', box, owner);
    who.style.color = colour;
    box.classList.remove('show');
    void box.offsetWidth;
    box.classList.add('show');
  }

  setClock(time, weather, night) {
    if (this.state.clock !== time) { this.state.clock = time; this.clockTime.textContent = time; }
    if (this.state.weather !== weather) { this.state.weather = weather; this.clockWeather.textContent = weather; }
    this.clock.classList.toggle('night', night);
  }

  setVitals(health, armor) {
    this.healthFill.style.transform = `scaleX(${Math.max(0, health) / 100})`;
    this.healthFill.parentElement.classList.toggle('low', health < 30);
    this.armorFill.style.transform = `scaleX(${Math.max(0, armor) / 100})`;
    this.armorFill.parentElement.classList.toggle('empty', armor <= 0);
  }

  setWeapon(name, ammo) {
    if (this.state.weapon !== name) { this.weaponName.textContent = name; this.state.weapon = name; }
    if (this.state.ammo !== ammo) { this.weaponAmmo.textContent = ammo; this.state.ammo = ammo; }
  }

  // Stars fill with the wanted level; they flash while the police search without seeing the player
  setWanted({ level, name, seen, escape }) {
    const key = `${level}|${seen}`;
    const active = level > 0;
    this.wanted.classList.toggle('active', active);
    this.wantedName.classList.toggle('active', active);
    this.edge.classList.toggle('active', active && seen);
    if (this.state.wanted !== key) {
      this.state.wanted = key;
      this.stars.forEach((s, i) => s.classList.toggle('on', i < level));
      this.wanted.classList.toggle('searching', active && !seen);
      this.wantedName.textContent = active ? `${name} · ${seen ? 'EN VUE' : 'HORS DE VUE'}` : '';
      this.wantedName.classList.toggle('seen', !!seen);
    }
    this.wantedEscape.classList.toggle('show', active && !seen);
    this.wantedEscapeFill.style.transform = `scaleX(${Math.min(1, escape)})`;
  }

  setObjective(text) {
    if (this.state.objective === text) return;
    this.state.objective = text;
    if (text) richText(this.objective, text);
    this.objective.classList.toggle('show', !!text);
  }

  say(speaker, text, duration = 4) {
    this.subSpeaker.textContent = speaker;
    this.subText.textContent = text;
    this.subtitle.classList.add('show');
    this.subtitle.classList.toggle('narration', !speaker);
    this.subT = duration;
  }

  setTimer(seconds) {
    if (seconds === null || seconds === undefined) { this.timer.classList.remove('show'); return; }
    const s = Math.max(0, Math.ceil(seconds));
    this.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.timer.classList.add('show');
    this.timer.classList.toggle('urgent', s <= 15);
  }

  showBanner(kicker, title, sub = '', duration = 4.5, tone = 'pass') {
    this.bannerKicker.textContent = kicker;
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.banner.dataset.tone = tone;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerT = duration;
  }

  missionTitle(text) {
    this.mission.textContent = text || '';
    this.mission.classList.toggle('show', !!text);
  }

  setCrosshair(visible, spread = 0, { aiming = false, shotgun = false, blocked = false } = {}) {
    this.crosshair.classList.toggle('show', visible);
    this.crosshair.classList.toggle('aiming', aiming);
    this.crosshair.classList.toggle('shotgun', shotgun);
    this.crosshair.classList.toggle('blocked', blocked);
    this.reticleSpread = Math.min(42, (aiming ? 3 : 6) + Math.max(0, spread) * 260);
    if (visible) this.crosshair.style.setProperty('--spread', `${this.reticleSpread + this.reticleKick}px`);
  }

  setCombat({ visible = false, aiming = false, mag = 0, capacity = 1, reserve = 0, reload = -1, mode = '', shoulder = 1 } = {}) {
    this.combat.classList.toggle('show', visible);
    this.weapon.classList.toggle('combat-active', visible);
    if (!visible) { this.reloadSight.classList.remove('show'); return; }
    const reloading = reload >= 0;
    const low = mag <= Math.max(1, capacity * 0.2);
    this.combat.classList.toggle('low', low && !reloading);
    this.combat.classList.toggle('reloading', reloading);
    const state = `${mag}|${reserve}|${mode}|${shoulder}|${reloading}|${aiming}`;
    if (this.state.combat !== state) {
      this.state.combat = state;
      this.combatMag.textContent = String(mag).padStart(2, '0');
      this.combatReserve.textContent = `/ ${reserve}`;
      this.combatMode.textContent = mode;
      this.combatStatus.textContent = reloading ? 'RECHARGEMENT' : mag === 0 ? (reserve ? 'R · RECHARGER' : 'À SEC')
        : aiming ? `ÉPAULE ${shoulder < 0 ? 'GAUCHE' : 'DROITE'}` : 'TIR À LA HANCHE';
    }
    const progress = Math.max(0, Math.min(1, reload));
    this.combatReload.style.transform = `scaleX(${reloading ? progress : Math.min(1, mag / Math.max(1, capacity))})`;
    this.reloadSight.classList.toggle('show', reloading && aiming);
    this.reloadSightFill.style.transform = `scaleX(${progress})`;
  }

  shot(strength = 1) {
    this.reticleKick = Math.min(18, this.reticleKick + 4 * strength);
  }

  hit(kill = false, headshot = false) {
    this.hitmarker.classList.toggle('kill', kill);
    this.hitmarker.classList.toggle('headshot', headshot);
    this.hitCaption.textContent = headshot ? 'PLEINE TÊTE' : kill ? 'NEUTRALISÉ' : '';
    this.hitmarker.classList.add('show');
    this.hitT = this.hitDuration = kill || headshot ? 0.42 : 0.18;
    this.hitmarker.style.opacity = '1';
    this.hitmarker.style.transform = `scale(${kill ? 1.25 : 1.1})`;
  }

  hurt(amount) {
    this.damageLevel = Math.min(1, this.damageLevel + amount / 40);
  }

  setArrest(progress) {
    this.arrest.classList.toggle('show', progress > 0.02);
    this.arrestFill.style.transform = `scaleX(${Math.min(1, progress)})`;
  }

  showRadio(name, song, color = '#e1f3a0') {
    this.radioName.textContent = name;
    this.radioSong.textContent = song || '';
    this.radio.style.setProperty('--station', color);
    this.radio.classList.add('show');
    this.radioT = 3.5;
  }

  setVisible(visible) {
    this.root.classList.toggle('hidden', !visible);
  }

  update(dt) {
    if (Math.abs(this.targetMoney - this.shownMoney) > 0.5) {
      this.shownMoney += (this.targetMoney - this.shownMoney) * Math.min(1, dt * 6);
      if (Math.abs(this.targetMoney - this.shownMoney) < 1) this.shownMoney = this.targetMoney;
      this.money.textContent = money(this.shownMoney);
    }
    if (this.deltaT > 0 && (this.deltaT -= dt) <= 0) this.moneyDelta.classList.remove('show');
    if (this.subT > 0 && (this.subT -= dt) <= 0) this.subtitle.classList.remove('show');
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.banner.classList.remove('show');
    if (this.radioT > 0 && (this.radioT -= dt) <= 0) this.radio.classList.remove('show');
    if (this.hitT > 0) {
      this.hitT = Math.max(0, this.hitT - dt);
      const t = this.hitT / this.hitDuration;
      this.hitmarker.style.opacity = String(Math.min(1, t * 2.5));
      this.hitmarker.style.transform = `scale(${1 + t * 0.18})`;
      if (!this.hitT) this.hitmarker.classList.remove('show');
    }
    if (this.reticleKick > 0.01) {
      this.reticleKick *= Math.exp(-dt * 19);
      this.crosshair.style.setProperty('--spread', `${this.reticleSpread + this.reticleKick}px`);
    }
    this.damageLevel = Math.max(0, this.damageLevel - dt * 0.9);
    this.damage.style.opacity = this.damageLevel.toFixed(3);
  }
}

export { GameHud, richText };
