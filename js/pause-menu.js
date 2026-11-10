import { currentLevel, setLevel } from './quality.js';
import { getLocationLabel } from './city-config.js';

const PREFERENCES_KEY = 'overdraft:menu';
const GRAPHICS = {
  fluid: { name: 'Fluide', tag: 'La ville, sans détour.', detail: 'Priorité à la réactivité', description: 'Pour les longues sessions et les machines moins à l’aise. Une ville plus légère, sans ombres dynamiques.', values: ['Simplifiés', 'Désactivées', 'Réduite', '60–85 %'] },
  balanced: { name: 'Équilibrée', tag: 'Le meilleur point de départ.', detail: 'Conseillé sur ce Mac', description: 'Ombres, végétation et relief restent présents. Un compromis entre lisibilité, détail et fluidité.', values: ['Simplifiés', 'Équilibrées', 'Standard', '70–100 %'] },
  high: { name: 'Haute', tag: 'Tous les détails de Manhattan.', detail: 'Priorité à l’image', description: 'Reflets des immeubles sur les voitures, ombres plus fines et végétation plus dense. Plus exigeant pour la machine.', values: ['Immeubles et écran', 'Détaillées', 'Dense', '75–100 %'] }
};
const TABS = [['session', 'Partie'], ['graphics', 'Graphismes'], ['world', 'Ambiance'], ['controls', 'Commandes']];
const HOURS = { golden: 18, midday: 13, twilight: 20, midnight: 0.5 };
const WEATHER = { auto: 'Automatique', clear: 'Dégagé', cloudy: 'Nuageux', rain: 'Pluie', storm: 'Orage' };
const art = (id) => `<svg viewBox="0 0 300 110" aria-hidden="true" focusable="false"><path class="pm-art-road" d="M0 104 300 82M125 110 182 47M220 110 201 47"/><path class="pm-art-buildings" d="M12 89V49h31v38m8-1V22h25v62m9-2V37h38v42m8-2V9h25v66m54-14V30h27v29m9-2V15h23v39m9-3V33h17v16"/><path class="pm-art-reflection" d="m72 101 24-13h61l24 8-13 8H88ZM95 88l13-9h28l16 9M104 103v5m53-7v5"/>${id === 'high' ? '<path class="pm-art-detail" d="M136 16v52m9-52v52M57 31h13m-13 9h13m-13 9h13M251 24h12m-12 9h12M214 38h17m-17 9h17"/>' : ''}</svg>`;
const choices = (attribute, items) => `<div class="pm-choice-group">${items.map(([id, label]) => `<button class="pm-choice" type="button" ${attribute}="${id}" aria-pressed="false">${label}</button>`).join('')}</div>`;
const controls = (name, rows) => `<article class="pm-controls-card"><h3>${name}</h3><dl>${rows.map(([key, action]) => `<div><dt><kbd>${key}</kbd></dt><dd>${action}</dd></div>`).join('')}</dl></article>`;

function pauseMenuMarkup(build) {
  return `<div id="game-menu" class="game-menu pause-menu" role="dialog" aria-modal="true" aria-labelledby="pm-title" inert>
    <div class="pm-shell">
      <header class="pm-header"><div class="pm-wordmark" id="pm-title">OVERDRAFT<span>MANHATTAN · NEW YORK</span></div><div class="pm-status"><span id="pm-mode">MENU PRINCIPAL</span><strong id="pm-location">MANHATTAN</strong><span id="pm-clock"></span></div><button id="pm-resume" class="pm-resume" type="button" hidden>Reprendre <kbd>ÉCHAP</kbd></button></header>
      <nav class="pm-tabs" role="tablist" aria-label="Menu du jeu">${TABS.map(([id, label], i) => `<button type="button" id="pm-tab-${id}" role="tab" data-pause-tab="${id}" aria-controls="pm-panel-${id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><span>0${i + 1}</span>${label}</button>`).join('')}</nav>
      <div class="pm-scroll">
        <section class="pm-panel" id="pm-panel-session" role="tabpanel" aria-labelledby="pm-tab-session"><div class="pm-layout"><div class="pm-main">
          <p class="pm-kicker">UNE VILLE. TOUT À REPRENDRE.</p><h2 class="pm-heading">Manhattan<br><em>vous attend.</em></h2><p class="pm-lead" id="pm-session-copy">Sacha Roux. Une dette de 250 000 $. Et toute une ville pour changer la donne.</p>
          <div class="pm-actions"><button type="button" id="play-button" class="pm-primary">ENTRER DANS LA VILLE <span aria-hidden="true">↗</span></button><button type="button" id="pm-map" class="pm-secondary">Explorer la carte <span aria-hidden="true">↗</span></button></div>
          <div class="pm-session-stats"><div><span>LIQUIDITÉS</span><strong id="pm-money">0 $</strong></div><div><span>MISSIONS TERMINÉES</span><strong id="pm-missions">0</strong></div><div><span>DETTE RESTANTE</span><strong id="pm-debt">250 000 $</strong></div></div>
        </div><aside class="pm-aside"><p class="pm-kicker">LE DOSSIER DE SACHA</p><h3 id="menu-act">ACTE I — LA DETTE</h3><p id="pm-mission">Votre histoire commence dans les rues de Manhattan.</p><div class="pm-progress"><label for="pm-debt-progress">Dette remboursée</label><progress id="pm-debt-progress" max="250000" value="0"></progress><small id="menu-progress"></small></div><p class="pm-setting-note">La progression est enregistrée à chaque pause.</p><button type="button" id="new-session" class="pm-text-button">Nouvelle partie <span aria-hidden="true">↗</span></button></aside></div></section>
        <section class="pm-panel" id="pm-panel-graphics" role="tabpanel" aria-labelledby="pm-tab-graphics" hidden><div class="pm-layout"><div class="pm-main">
          <p class="pm-kicker">LE BON ÉQUILIBRE</p><h2 class="pm-heading">Votre ville.<br><em>Votre rendu.</em></h2><p class="pm-lead">Choisissez un profil, comparez ses effets, puis appliquez-le.</p>
          <div class="pm-quality-grid" role="radiogroup" aria-label="Qualité graphique">${Object.entries(GRAPHICS).map(([id, g], i) => `<button type="button" class="pm-quality-card" data-quality="${id}" role="radio" aria-checked="false" tabindex="-1"><span class="pm-card-top"><span class="pm-number">0${i + 1}</span><span class="pm-applied" hidden>EN COURS</span></span><span class="pm-quality-art">${art(id)}</span><h3>${g.name}</h3><p>${g.tag}</p><span class="pm-card-detail">${g.detail}</span></button>`).join('')}</div>
        </div><aside class="pm-aside"><p class="pm-kicker">LE PROFIL EN DÉTAIL</p><h3 id="pm-quality-title"></h3><p id="pm-quality-description"></p><div class="pm-comparison">${['Reflets', 'Ombres', 'Végétation', 'Résolution adaptative'].map((label, i) => `<div class="pm-comparison-row"><span>${label}</span><strong id="pm-quality-value-${i}"></strong></div>`).join('')}</div><p class="pm-setting-note" id="pm-reload-note">Appliquer enregistre votre progression et recharge la partie. Les véhicules du garage se rappellent avec G.</p><p class="pm-setting-note">La fluidité dépend de la scène et de l’alimentation du Mac.</p></aside></div></section>
        <section class="pm-panel" id="pm-panel-world" role="tabpanel" aria-labelledby="pm-tab-world" hidden><div class="pm-layout"><div class="pm-main">
          <p class="pm-kicker">L’ATMOSPHÈRE DE VOTRE PARTIE</p><h2 class="pm-heading">Changez<br><em>l’ambiance.</em></h2>
          <div class="pm-setting"><div class="pm-setting-heading"><h3>Heure de la journée</h3><p id="pm-hour-label">Choisissez la lumière de Manhattan.</p></div>${choices('data-game-time', [['golden', 'Soleil bas'], ['midday', 'Midi'], ['twilight', 'Crépuscule'], ['midnight', 'Nuit']])}</div>
          <div class="pm-setting"><div class="pm-setting-heading"><h3>Météo</h3><p>Un choix direct, sans faire défiler tous les états.</p></div>${choices('data-weather', Object.entries(WEATHER))}</div>
          <div class="pm-setting"><div class="pm-setting-heading"><h3>Horloge</h3><p>Gardez une lumière précise ou laissez la journée avancer.</p></div>${choices('data-clock', [['run', 'Temps qui passe'], ['hold', 'Heure figée']])}</div>
          <div class="pm-setting"><div class="pm-setting-heading"><h3>Son du jeu</h3><p>Ambiance, véhicules, effets et radio.</p></div>${choices('data-sound', [['on', 'Activé'], ['off', 'Coupé']])}</div>
        </div><aside class="pm-aside"><p class="pm-kicker">À VOTRE RYTHME</p><h3>Les détails font<br>la différence.</h3><p>Une avenue sous la pluie, une virée de nuit ou les carrosseries au soleil : choisissez votre cadre.</p><p class="pm-setting-note">Ces réglages prennent effet immédiatement, sans recharger la partie.</p><div class="pm-display-row"><button id="fullscreen-toggle" class="pm-secondary" type="button" hidden><span>Plein écran</span> <span aria-hidden="true">⛶</span></button><span id="fullscreen-status" role="status"></span></div><p id="pm-world-status" class="pm-setting-note" role="status" aria-live="polite"></p></aside></div></section>
        <section class="pm-panel" id="pm-panel-controls" role="tabpanel" aria-labelledby="pm-tab-controls" hidden><div class="pm-layout"><div class="pm-main">
          <p class="pm-kicker">MANETTE XBOX · CLAVIER AZERTY · SOURIS</p><h2 class="pm-heading">Gardez<br><em>le contrôle.</em></h2>
          <div class="pm-controls-grid pm-xbox-controls">
            ${controls('Xbox · À pied', [['LS / RS', 'Se déplacer / regarder'], ['A / X', 'Sprinter / sauter'], ['Y', 'Interagir ou monter'], ['LT / RT / B', 'Viser / tirer / recharger'], ['LB', 'Tenu : roue au stick droit. Bref : arme précédente'], ['RB', 'Sortir ou ranger le grappin'], ['LT + R3', 'Changer d’épaule'], ['L3', 'Régler la visée assistée']])}
            ${controls('Xbox · Au volant', [['LS', 'Tourner'], ['RT / LT', 'Accélérer / freiner, puis reculer'], ['RB / A', 'Frein à main / nitro ou wheeling'], ['L3 / R3', 'Klaxon / regard arrière'], ['X + RT', 'Tenir X pour viser, RT pour tirer'], ['B', 'Remettre d’aplomb à l’arrêt'], ['← →', 'Changer de station']])}
            ${controls('Xbox · Partout', [['↑ / ↓', 'Téléphone / carte'], ['View', 'Bref : caméra. Tenu : garage'], ['Menu', 'Pause ou reprise'], ['Croix / A / B', 'Choisir / valider / revenir'], ['LB / RB', 'Changer d’onglet dans la pause'], ['RS', 'Défiler dans la pause'], ['A', 'Passer une séquence de mission']])}
          </div>
          <div class="pm-controls-grid">${controls('Dans les rues', [['Z Q S D', 'Se déplacer'], ['ESPACE', 'Courir'], ['MAJ', 'Sauter'], ['F', 'Interagir / monter'], ['E', 'Grappin'], ['G', 'Garage'], ['P', 'Téléphone'], ['M', 'Carte']])}${controls('Au volant', [['Z / S', 'Accélérer / freiner, puis reculer'], ['Q / D', 'Tourner'], ['ESPACE', 'Frein à main'], ['V', 'Changer de caméra'], ['C', 'Regarder derrière'], ['T', 'Changer de radio'], ['F', 'Descendre à l’arrêt']])}${controls('Les armes', [['CLIC', 'Tirer, ou frapper à mains nues'], ['CLIC DROIT', 'Dégainer, puis viser tant qu’il est tenu'], ['X', 'Visée fixe, sans tenir le clic'], ['C', 'Changer d’épaule'], ['Y', 'Visée assistée'], ['R', 'Recharger'], ['TAB', 'Tenu : roue des armes. Bref : arme précédente']])}</div>
        </div><aside class="pm-aside"><p class="pm-kicker">DANS CE MENU</p><h3>Tout à portée<br>de main.</h3><p><kbd>TAB</kbd> parcourt les éléments.<br><kbd>← →</kbd> change d’onglet ou de choix.<br><kbd>ENTRÉE</kbd> valide l’action.<br><kbd>ÉCHAP</kbd> reprend la partie.</p><p class="pm-setting-note">Au pavé tactile, cliquez directement sur les grandes zones de sélection. Le défilement reste disponible dans chaque page.</p></aside></div></section>
      </div>
      <div class="pm-apply-bar"><span id="pm-quality-status" role="status" aria-live="polite"></span><button id="pm-quality-reset" class="pm-text-button" type="button" disabled>Annuler le choix</button><button id="pm-quality-apply" class="pm-primary" type="button" disabled>Appliquer <span aria-hidden="true">↗</span></button></div>
      <footer class="pm-footer"><div class="pm-key-hints"><span><kbd>← →</kbd> Choisir</span><span><kbd>ENTRÉE</kbd> Valider</span><span id="pm-escape-hint"><kbd>ÉCHAP</kbd> Reprendre</span></div><div class="pad-menu-hints"><kbd>LB / RB</kbd> Onglets · <kbd>A</kbd> Valider · <kbd>B</kbd> Retour</div><button id="credits-button" class="pm-text-button" type="button">Crédits</button><small id="pm-build">${build} · OVERDRAFT</small></footer>
    </div>
  </div><dialog id="pm-reset-dialog" class="pm-dialog" aria-labelledby="pm-reset-title"><p class="pm-kicker">NOUVEAU DÉPART</p><h2 id="pm-reset-title">Recommencer l’histoire ?</h2><p>Votre progression actuelle sera effacée : missions, argent et véhicules sauvegardés. Les préférences graphiques et audio sont conservées.</p><div class="pm-dialog-actions"><button id="pm-reset-cancel" class="pm-secondary" type="button" autofocus>Garder ma partie</button><button id="pm-reset-confirm" class="pm-primary" type="button">Recommencer</button></div></dialog>`;
}

class PauseMenu {
  constructor(game, root) {
    this.game = game; this.root = root; this.section = 'session';
    this.applied = currentLevel().id; this.pending = this.applied; this.applying = false; this.mapReturn = false;
    this.preferences = {};
    try { this.preferences = JSON.parse(localStorage.getItem(PREFERENCES_KEY)) || {}; } catch { /* Optional preferences. */ }
    if (Object.hasOwn(WEATHER, this.preferences.weather)) {
      game.weatherMode = this.preferences.weather;
      game.atmosphere.lockWeather = game.weatherMode !== 'auto';
      if (game.atmosphere.lockWeather) game.atmosphere.setWeather(game.weatherMode, true);
    }
    if (typeof this.preferences.clockRunning === 'boolean') game.atmosphere.running = this.preferences.clockRunning;
    root.addEventListener('click', e => this.click(e));
    window.addEventListener('keydown', e => this.key(e), true);
    document.getElementById('pm-reset-cancel').addEventListener('click', () => document.getElementById('pm-reset-dialog').close());
    document.getElementById('pm-reset-confirm').addEventListener('click', () => game.reset());
    document.getElementById('pm-reset-dialog').addEventListener('close', () => this.el('new-session').focus());
    this.sync();
  }
  el(id) { return document.getElementById(id); }
  get visible() { return !this.root.inert && !this.root.hidden && !this.root.classList.contains('dismissed') && !this.game.map.isFullMapOpen; }
  selectTab(id, focus = false) {
    if (!TABS.some(t => t[0] === id)) return;
    this.section = id; this.root.dataset.section = id;
    for (const button of this.root.querySelectorAll('[data-pause-tab]')) {
      const selected = button.dataset.pauseTab === id;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    }
    for (const [tab] of TABS) this.el(`pm-panel-${tab}`).hidden = tab !== id;
    this.root.querySelector('.pm-scroll').scrollTop = 0;
    this.sync();
  }
  selectQuality(id) {
    if (!Object.hasOwn(GRAPHICS, id) || this.applying) return;
    this.pending = id; this.syncQuality();
  }
  syncQuality() {
    const changed = this.pending !== this.applied, profile = GRAPHICS[this.pending];
    for (const button of this.root.querySelectorAll('[data-quality]')) {
      const selected = button.dataset.quality === this.pending, applied = button.dataset.quality === this.applied;
      button.setAttribute('aria-checked', String(selected)); button.tabIndex = selected ? 0 : -1;
      button.dataset.applied = String(applied); button.querySelector('.pm-applied').hidden = !applied;
      button.disabled = this.applying;
    }
    this.el('pm-quality-title').textContent = profile.name;
    this.el('pm-quality-description').textContent = profile.description;
    profile.values.forEach((v, i) => { this.el(`pm-quality-value-${i}`).textContent = v; });
    this.el('pm-quality-apply').disabled = !changed || this.applying;
    this.el('pm-quality-reset').disabled = !changed || this.applying;
    this.el('pm-quality-status').textContent = this.applying ? 'Sauvegarde et rechargement…' : changed ? `${profile.name} sélectionnée · pas encore appliquée` : `${profile.name} est le profil en cours`;
    this.el('pm-reload-note').textContent = this.game.director?.current
      ? 'Appliquer sauvegarde votre progression et recharge la partie. La mission en cours devra être relancée.'
      : 'Appliquer sauvegarde votre progression et recharge la partie. La reprise peut se faire à pied ; G rappelle votre véhicule.';
  }
  applyQuality() {
    if (this.applying || this.pending === this.applied) return;
    if (!this.game.save()) {
      this.el('pm-quality-status').textContent = 'Sauvegarde indisponible. Reprenez la partie puis réessayez : aucun réglage n’a été appliqué.';
      return;
    }
    this.applying = true; this.syncQuality();
    const url = new URL(location.href); url.searchParams.set('quality', setLevel(this.pending));
    location.assign(url.href);
  }
  savePreferences() {
    this.preferences = { weather: this.game.weatherMode || 'auto', clockRunning: this.game.atmosphere.running };
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(this.preferences)); } catch { /* Optional preferences. */ }
  }
  sync() {
    const g = this.game, money = n => `${Math.round(n || 0).toLocaleString('fr-FR')} $`;
    this.root.dataset.playing = String(g.playing);
    this.el('pm-resume').hidden = !g.playing;
    this.el('pm-escape-hint').hidden = !g.playing;
    this.el('pm-mode').textContent = g.playing ? 'PARTIE EN PAUSE' : 'MENU PRINCIPAL';
    this.el('pm-clock').textContent = g.atmosphere.clockLabel;
    this.el('pm-location').textContent = getLocationLabel(g.player.x, g.player.z).replace(' · ', ' / ');
    this.el('pm-money').textContent = money(g.money); this.el('pm-debt').textContent = money(g.debt);
    this.el('pm-missions').textContent = String(g.missionsDone.length);
    this.el('pm-debt-progress').value = Math.max(0, 250000 - g.debt);
    this.el('pm-mission').textContent = g.director?.current ? `En cours : ${g.director.current.title}` : g.missionsDone.length ? 'Retrouvez vos contacts sur la carte pour poursuivre l’histoire, ou explorez librement la ville.' : 'Rejoignez Mireille, au marqueur vert sur la carte, pour commencer l’histoire.';
    this.el('pm-session-copy').textContent = g.playing ? 'Faites une pause. Préparez votre prochaine virée. Manhattan sera là à votre retour.' : 'Sacha Roux. Une dette de 250 000 $. Et toute une ville pour changer la donne.';
    this.el('play-button').firstChild.textContent = g.playing ? 'REPRENDRE LA PARTIE ' : 'ENTRER DANS LA VILLE ';
    this.syncQuality(); this.syncWorld();
  }
  syncWorld() {
    const g = this.game;
    for (const b of this.root.querySelectorAll('[data-weather]')) b.setAttribute('aria-pressed', String(b.dataset.weather === (g.weatherMode || 'auto')));
    for (const b of this.root.querySelectorAll('[data-game-time]')) b.setAttribute('aria-pressed', String(Math.abs(g.atmosphere.hour - HOURS[b.dataset.gameTime]) < 0.1));
    for (const b of this.root.querySelectorAll('[data-sound]')) { b.setAttribute('aria-pressed', String((b.dataset.sound === 'on') === g.audio.enabled)); b.disabled = !g.audio.supported; }
    for (const b of this.root.querySelectorAll('[data-clock]')) b.setAttribute('aria-pressed', String((b.dataset.clock === 'run') === g.atmosphere.running));
    this.el('pm-hour-label').textContent = `À Manhattan, il est ${g.atmosphere.clockLabel}.`;
  }
  onPauseChanged(show) {
    if (show) {
      this.sync();
      if (this.game.playing) this.el(`pm-tab-${this.section}`).focus();
    } else { this.pending = this.applied; this.syncQuality(); }
  }
  onMapToggle(open) {
    if (!open && this.mapReturn) {
      this.mapReturn = false; this.root.hidden = false; this.sync(); this.el('pm-map').focus();
    }
  }
  click(e) {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.pauseTab) this.selectTab(b.dataset.pauseTab, true);
    else if (b.dataset.quality) this.selectQuality(b.dataset.quality);
    else if (b.id === 'pm-quality-apply') this.applyQuality();
    else if (b.id === 'pm-quality-reset') this.selectQuality(this.applied);
    else if (b.id === 'pm-resume') this.game.start();
    else if (b.id === 'pm-map') { this.mapReturn = true; this.root.hidden = true; this.game.releasePointer(); this.game.map.toggleFullMap(true); }
    else if (b.id === 'new-session') this.el('pm-reset-dialog').showModal();
    else if (b.dataset.gameTime) { this.game.atmosphere.setHour(HOURS[b.dataset.gameTime]); this.worldChanged('La lumière a été mise à jour.'); }
    else if (b.dataset.weather) {
      this.game.weatherMode = b.dataset.weather; this.game.atmosphere.lockWeather = b.dataset.weather !== 'auto';
      if (this.game.atmosphere.lockWeather) this.game.atmosphere.setWeather(b.dataset.weather, true);
      this.worldChanged(`Météo : ${WEATHER[b.dataset.weather].toLowerCase()}.`);
    } else if (b.dataset.sound) { this.game.audio.setEnabled(b.dataset.sound === 'on'); this.worldChanged(this.game.audio.enabled ? 'Son activé.' : 'Son coupé.'); }
    else if (b.dataset.clock) { this.game.atmosphere.running = b.dataset.clock === 'run'; this.worldChanged(this.game.atmosphere.running ? 'La journée reprend son cours.' : 'L’heure reste figée.'); }
  }
  worldChanged(message) { this.savePreferences(); this.syncWorld(); this.el('pm-clock').textContent = this.game.atmosphere.clockLabel; this.el('pm-world-status').textContent = message; }

  controlGamepad(direction, tabStep, confirm, back, scroll) {
    if (this.applying) return;
    const active = document.activeElement;
    if (back) {
      if (this.game.playing) this.game.start();
      else if (this.section !== 'session') this.selectTab('session', true);
    } else if (tabStep || (active?.dataset.pauseTab && (direction === 'left' || direction === 'right'))) {
      const i = TABS.findIndex(([id]) => id === this.section);
      const step = tabStep || (direction === 'left' ? -1 : 1);
      this.selectTab(TABS[(i + step + TABS.length) % TABS.length][0], true);
    } else if (confirm) {
      const target = this.root.contains(active) && active.tagName === 'BUTTON' ? active
        : this.section === 'session' ? this.el('play-button') : this.el(`pm-tab-${this.section}`);
      target.click();
    } else if (direction) {
      this.focusNextButton(this.root, direction, this.el(`pm-tab-${this.section}`));
    } else if (scroll) this.root.querySelector('.pm-scroll').scrollTop += scroll * 520;
  }

  controlDialog(dialog, direction, confirm, back) {
    if (back) dialog.close();
    else if (confirm && dialog.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON') document.activeElement.click();
    else if (direction) this.focusNextButton(dialog, direction);
  }

  focusNextButton(root, direction, fallback) {
    const buttons = [...root.querySelectorAll('button:not([disabled])')].filter(el => el.tabIndex >= 0 && el.getClientRects().length);
    const current = buttons.indexOf(document.activeElement);
    const step = direction === 'up' || direction === 'left' ? -1 : 1;
    const next = current < 0 ? (fallback || buttons[0]) : buttons[(current + step + buttons.length) % buttons.length];
    next?.focus();
  }

  key(e) {
    if (!this.visible || this.applying || e.ctrlKey || e.metaKey || e.altKey) return;
    // Menu keys never reach driving, mission skipping or weapon shortcuts underneath the modal.
    e.stopImmediatePropagation();
    // Keep native dialog actions while shielding any gameplay overlay still open underneath.
    if (document.querySelector('dialog[open]')) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (!e.repeat && this.game.playing && performance.now() - (this.game.lockPauseAt || 0) > 250) this.game.start();
      return;
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      const list = [...this.root.querySelectorAll('button:not([disabled]),a[href],[tabindex="0"]')].filter(el => el.tabIndex >= 0 && el.getClientRects().length);
      const current = list.indexOf(document.activeElement), i = current < 0 ? (e.shiftKey ? list.length - 1 : 0) : (current + (e.shiftKey ? -1 : 1) + list.length) % list.length;
      list[i]?.focus(); return;
    }
    const target = document.activeElement;
    const group = target?.closest('[role="tablist"],[role="radiogroup"],.pm-choice-group');
    if (group && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.code)) {
      e.preventDefault(); const list = [...group.querySelectorAll('button:not([disabled])')], current = list.indexOf(target);
      const i = e.code === 'Home' ? 0 : e.code === 'End' ? list.length - 1 : (current + (['ArrowLeft', 'ArrowUp'].includes(e.code) ? -1 : 1) + list.length) % list.length;
      list[i]?.focus(); list[i]?.click(); return;
    }
    if (['Enter', 'NumpadEnter', 'Space'].includes(e.code)) {
      e.preventDefault(); if (!e.repeat && target?.tagName === 'BUTTON') target.click();
    }
  }
}
export { PauseMenu, pauseMenuMarkup, GRAPHICS };
