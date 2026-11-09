import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { GUN_ITEMS } from './shops.js';
import { isTypingInField } from './city-config.js';

// The weapon wheel. Hold TAB: the street slows to a crawl, the wheel opens, the pointer (mouse, trackpad) picks a
// wedge, letting go draws that weapon. A short tap of TAB goes straight back to the weapon held before. The HUD button
// (or a touch) opens the same wheel and leaves it open until a wedge is clicked.
// For what is not owned yet it says what it costs and shows the way to the nearest gun shop.

const ICONS = { fists: 'i-fist', pistol: 'i-pistol', smg: 'i-smg', shotgun: 'i-shotgun', rifle: 'i-rifle', grenade: 'i-grenade', grapple: 'i-grapple' };
// Firearms show their own portrait, rendered from the model the hands hold (tools/weapons); the rest keep a glyph
const PORTRAITS = ['pistol', 'smg', 'shotgun', 'rifle'];
const portrait = (id) => new URL(`../assets/weapons/icon-${id}.webp`, import.meta.url).href;
const money = (n) => `${n.toLocaleString('fr-FR')} $`;
const NS = 'http://www.w3.org/2000/svg';
const R0 = 104, R1 = 232, GAP = 0.022; // inner and outer radius of the wedges (px), half the gap between two (rad)
const HOLD = 0.16; // seconds TAB must stay down for the wheel rather than the quick swap
const svg = (tag, attrs = {}, parent = null) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.append(node);
  return node;
};

// Does this TAB keydown belong to the wheel? Every one does while the game is in play, the keyboard's own repeats
// included: a held key repeats thirty times a second, and each repeat left to the browser moves the focus to the next
// button of the page, which drops the pointer lock, pauses the game and leaves Space pressing whatever got the focus.
// In the menus, in a text field or with a system chord, TAB stays the browser's.
function takesTab(e, { open, held, active, typing }) {
  if (e.code !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || typing) return false;
  return open || held >= 0 || active;
}

// Which wedge a direction points at: wedge 0 is centred straight up, the others follow clockwise
function wedgeAt(x, y, count) {
  const turn = Math.atan2(x, -y); // 0 up, clockwise positive
  return ((Math.round(turn / (Math.PI * 2 / count)) % count) + count) % count;
}

class Arsenal {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.sticky = false; // opened by a click: stays until a wedge is picked
    this.sel = 0;
    this.held = -1; // seconds TAB has been down, -1 when it is up
    this.stick = { x: 0, y: 0 };
    this.previous = null; // the weapon to go back to on a tap
    this.shownIcon = null;
    this.build();
    window.addEventListener('keyup', (e) => { if (e.code === 'Tab') this.release(); });
    window.addEventListener('blur', () => { this.held = -1; if (this.open) this.close(); });
    // The pointer steers the wheel while it is open: the view must not turn under it
    document.addEventListener('mousemove', (e) => {
      if (!this.open) return;
      if (document.pointerLockElement) {
        const s = this.stick, k = 0.011;
        s.x += (e.movementX || 0) * k; s.y += (e.movementY || 0) * k;
        const l = Math.hypot(s.x, s.y);
        if (l > 1) { s.x /= l; s.y /= l; }
        if (l > 0.3) this.select(wedgeAt(s.x, s.y, WEAPON_ORDER.length));
      } else {
        const x = e.clientX - innerWidth / 2, y = e.clientY - innerHeight / 2, l = Math.hypot(x, y);
        this.stick.x = Math.max(-1, Math.min(1, x / R1)); this.stick.y = Math.max(-1, Math.min(1, y / R1));
        if (l > R0 * 0.55 * this.scale) this.select(wedgeAt(x, y, WEAPON_ORDER.length));
      }
      this.dot.setAttribute('transform', `translate(${(this.stick.x * R0 * 0.72).toFixed(1)} ${(this.stick.y * R0 * 0.72).toFixed(1)})`);
    }, true);
    window.addEventListener('keydown', (e) => this.key(e), true);
  }

  build() {
    this.button = document.createElement('button');
    this.button.id = 'arsenal-button';
    this.button.className = 'quick-button';
    this.button.type = 'button';
    this.button.setAttribute('aria-label', 'Choisir une arme');
    this.button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${ICONS.fists}"/></svg><kbd>TAB</kbd>`;
    this.button.addEventListener('click', () => { if (this.open) this.close(); else if (this.available) this.show(true); });
    const root = this.root = document.createElement('div');
    root.id = 'weapon-wheel';
    root.hidden = true;
    const n = WEAPON_ORDER.length, step = Math.PI * 2 / n;
    const art = svg('svg', { viewBox: '-260 -260 520 520', role: 'listbox', 'aria-label': 'Armes' }, root);
    this.wedges = WEAPON_ORDER.map((id, i) => {
      const a0 = i * step - step / 2 + GAP, a1 = i * step + step / 2 - GAP;
      // angles are measured clockwise from straight up
      const at = (r, a) => `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`;
      const g = svg('g', { class: 'wedge', role: 'option' }, art);
      svg('path', { d: `M${at(R1, a0)}A${R1} ${R1} 0 0 1 ${at(R1, a1)}L${at(R0, a1)}A${R0} ${R0} 0 0 0 ${at(R0, a0)}Z` }, g);
      const mid = i * step, r = (R0 + R1) / 2;
      const x = Math.sin(mid) * r, y = -Math.cos(mid) * r;
      if (PORTRAITS.includes(id)) svg('image', { href: portrait(id), x: (x - 58).toFixed(1), y: (y - 44).toFixed(1), width: 116, height: 58 }, g);
      else svg('use', { href: `#${ICONS[id]}`, x: (x - 26).toFixed(1), y: (y - 40).toFixed(1), width: 52, height: 52 }, g);
      const name = svg('text', { x: x.toFixed(1), y: (y + 30).toFixed(1), class: 'name' }, g);
      name.textContent = WEAPONS[id].name;
      const count = svg('text', { x: x.toFixed(1), y: (y + 45).toFixed(1), class: 'count' }, g);
      const key = svg('text', { x: (Math.sin(mid) * (R1 - 14)).toFixed(1), y: (-Math.cos(mid) * (R1 - 14) + 3).toFixed(1), class: 'key' }, g);
      key.textContent = String(i + 1);
      g.addEventListener('mouseenter', () => { if (this.open) this.select(i); });
      g.addEventListener('click', () => { if (this.open) this.pick(i); });
      return { g, count };
    });
    this.dot = svg('circle', { r: 4, class: 'dot' }, art);
    const hub = document.createElement('div');
    hub.className = 'hub';
    hub.innerHTML = '<small></small><strong></strong><span></span><em></em>';
    [this.hubSub, this.hubName, this.hubAmmo, this.hubHint] = hub.children;
    root.append(hub);
    document.body.append(this.button, root);
  }

  get available() {
    const g = this.game;
    return g.active && !g.transition && (g.state === 'onFoot' || g.state === 'driving');
  }

  get scale() { return Math.min(1, Math.min(innerWidth, innerHeight) / 620); }

  // TAB went down (gameplay.js filters repeats)
  press() {
    if (this.open) { this.close(); return; }
    if (this.available) this.held = 0;
  }

  // TAB came up: the wheel's choice if it was open, else straight back to the weapon held before
  release() {
    const held = this.held;
    this.held = -1;
    if (this.open) { if (!this.sticky) this.pick(this.sel); return; }
    if (held < 0 || !this.available) return;
    const g = this.game;
    const back = this.previous && g.weapons[this.previous] && this.previous !== g.weaponId ? this.previous
      : g.weaponId === 'fists' ? WEAPON_ORDER.find((id) => id !== 'fists' && g.weapons[id] && !WEAPONS[id].gadget) : 'fists';
    if (back) g.selectWeapon(back);
  }

  toggle() { if (this.open) this.close(); else if (this.available) this.show(true); }

  show(sticky = false) {
    const g = this.game;
    this.open = true;
    this.sticky = sticky;
    this.held = -1;
    this.stick.x = this.stick.y = 0;
    this.dot.setAttribute('transform', 'translate(0 0)');
    this.refresh();
    this.select(Math.max(0, WEAPON_ORDER.indexOf(g.weaponId)), true);
    // nothing of the page keeps the keyboard while the wheel is up: Space or Enter must not press a HUD button
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused !== g.camera.domElement) focused.blur?.();
    this.root.hidden = false;
    this.root.classList.toggle('sticky', sticky);
    // two frames, so that the opening transition runs from the hidden state
    requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.add('show')));
    g.camera.lookLocked = true;
    g.fireHeld = g.firePressed = false;
    if (sticky) g.releasePointer();
    g.audio.ui('reload', 0.35);
  }

  close() {
    if (!this.open) return;
    const g = this.game;
    this.open = false;
    this.root.classList.remove('show');
    this.root.hidden = true;
    g.camera.lookLocked = false;
    if (this.sticky) {
      g.camera.domElement.focus();
      Promise.resolve(g.camera.domElement.requestPointerLock?.()).catch(() => {});
    }
  }

  reserve(id) {
    const w = WEAPONS[id], slot = this.game.weapons[id];
    if (!slot) return money(GUN_ITEMS.find((it) => it.id === id).price);
    if (w.melee) return '';
    if (w.gadget) return `${w.range} M`;
    return w.throwable ? `× ${slot.mag}` : `${slot.mag} / ${slot.ammo}`;
  }

  refresh() {
    this.wedges.forEach(({ g, count }, i) => {
      const id = WEAPON_ORDER[i];
      g.classList.toggle('locked', !this.game.weapons[id]);
      g.classList.toggle('active', id === this.game.weaponId);
      count.textContent = this.reserve(id);
    });
  }

  select(i, quiet = false) {
    if (i === this.sel && !quiet) return;
    this.sel = i;
    this.wedges.forEach(({ g }, k) => g.classList.toggle('sel', k === i));
    const id = WEAPON_ORDER[i], w = WEAPONS[id], owned = !!this.game.weapons[id];
    this.hubSub.textContent = w.sub;
    this.hubName.textContent = w.name;
    this.hubAmmo.textContent = this.reserve(id);
    this.hubHint.textContent = owned ? (this.sticky ? 'Cliquer pour prendre' : 'Relâcher TAB') : 'Chez Calibre';
    if (!quiet) this.game.audio.ui('dry', 0.35);
  }

  pick(i) {
    const id = WEAPON_ORDER[i], g = this.game;
    this.close();
    if (!g.weapons[id]) this.missing(id);
    else if (id !== g.weaponId) g.selectWeapon(id);
  }

  // Not owned yet: say so, and show the way to the nearest gun shop
  missing(id) {
    const g = this.game;
    const shop = g.shops.nearest('guns');
    if (!g.director.current && shop) g.gps(shop.x, shop.z);
    g.audio.ui('deny');
    g.toast(`${WEAPONS[id].name} : pas encore à vous`, `${money(GUN_ITEMS.find((it) => it.id === id).price)} chez Calibre · TAB : vos armes`);
  }

  key(e) {
    if (e.code === 'Tab') {
      if (!takesTab(e, { open: this.open, held: this.held, active: this.game.active, typing: isTypingInField(e) || e.target?.tagName === 'TEXTAREA' || !!e.target?.isContentEditable })) return;
      e.preventDefault();
      if (!e.repeat) this.press();
      return;
    }
    if (!this.open) return;
    const digit = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'].indexOf(e.code);
    const n = WEAPON_ORDER.length;
    if (digit < 0 && !['ArrowLeft', 'ArrowRight', 'Enter', 'NumpadEnter', 'Escape'].includes(e.code)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (digit >= 0) this.pick(digit);
    else if (e.code === 'ArrowLeft') this.select((this.sel - 1 + n) % n);
    else if (e.code === 'ArrowRight') this.select((this.sel + 1) % n);
    else if (e.code === 'Escape') this.close();
    else this.pick(this.sel);
  }

  // Every frame, in real time: the hold that opens the wheel, the HUD button's icon, a wheel the game closed under
  update() {
    const g = this.game;
    const now = performance.now(), dt = Math.min(0.1, (now - (this.clock ?? now)) / 1000);
    this.clock = now;
    if (g.weaponId !== this.lastWeapon) { if (this.lastWeapon) this.previous = this.lastWeapon; this.lastWeapon = g.weaponId; }
    const icon = ICONS[g.weaponId];
    if (icon !== this.shownIcon) { this.shownIcon = icon; this.button.querySelector('use').setAttribute('href', `#${icon}`); }
    if (this.open && !this.available) this.close();
    if (this.held >= 0 && !this.open) {
      this.held += dt;
      if (this.held >= HOLD) { if (this.available) this.show(false); else this.held = -1; }
    }
  }
}

export { Arsenal, wedgeAt, takesTab };
