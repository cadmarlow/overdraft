import { streetZ } from './city-config.js';
import { WEAPONS } from './weapons.js';
import { repairBody } from './drive-fx.js';

// Places to spend money: gun shops, a body shop that repairs and repaints (and loses the police if they did not see the
// car go in), and safehouses to buy, sleep in (8 hours pass, wounds heal) and save at. The gun shops are CALIBRE's 48
// branches (calibre.js): their counter has its own sheet (calibre-counter.js) and keeps the world running during a
// transaction; this system only opens and closes it. The other services pause the game while their panel is open.

const SHOPS = [
  { id: 'eclair-west', type: 'body', name: 'CARROSSERIE ÉCLAIR', sub: '11e Avenue', x: -1678, z: streetZ(50) + 40, drive: true },
  { id: 'eclair-east', type: 'body', name: 'CARROSSERIE ÉCLAIR', sub: '3e Avenue', x: 616, z: streetZ(22) + 40, drive: true },
  { id: 'loft', type: 'home', name: 'LOFT EAST VILLAGE', sub: 'Planque · 1re Avenue', x: 1079, z: streetZ(12) + 40, price: 0, gift: 'grande' },
  { id: 'studio', type: 'home', name: 'STUDIO HARLEM', sub: 'Planque · 7e Avenue', x: -572, z: streetZ(116) + 30, price: 8000 },
  { id: 'duplex', type: 'home', name: 'DUPLEX MIDTOWN', sub: 'Planque · 5e Avenue', x: 12, z: streetZ(56) + 30, price: 25000 },
  { id: 'penthouse', type: 'home', name: 'PENTHOUSE TRIBECA', sub: 'Planque · Hudson St', x: -620, z: 4300, price: 60000 }
];

// Gun shop catalogue: buy a weapon once, then its ammunition
const GUN_ITEMS = [
  { id: 'pistol', price: 600, ammoPrice: 120, ammo: 24 },
  { id: 'smg', price: 2800, ammoPrice: 300, ammo: 60 },
  { id: 'shotgun', price: 3600, ammoPrice: 260, ammo: 16 },
  { id: 'rifle', price: 6500, ammoPrice: 420, ammo: 60 },
  { id: 'grenade', price: 900, ammoPrice: 900, ammo: 3 },
  { id: 'armor', price: 750 }
];
const PAINTS = [0x8f1a1d, 0x1d3b6c, 0x111418, 0xf2f3f5, 0x28382e, 0xc8d0d8, 0x5a1f24, 0xd17a22, 0x2e6b6b, 0x3a3a40];
const RESPRAY_PRICE = 500;

const el = (tag, cls, parent, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.append(n);
  return n;
};
const money = (n) => `${Math.round(n).toLocaleString('fr-FR')} $`;

class ShopSystem {
  constructor(game) {
    this.game = game;
    this.owned = new Set(['']);
    this.markers = [];
    this.open = null;
    this.cooldown = 0;
    this.sel = 0;
    this.panel = el('div', 'shop-panel', document.body);
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Boutique');
    const close = el('button', 'shop-close', this.panel, '×');
    close.setAttribute('aria-label', 'Quitter la boutique');
    close.addEventListener('click', () => this.close());
    this.head = el('div', 'shop-head', this.panel);
    this.title = el('strong', null, this.head);
    this.sub = el('span', null, this.head);
    this.list = el('div', 'shop-list', this.panel);
    this.foot = el('div', 'shop-foot', this.panel, '↑ ↓ choisir · ENTRÉE acheter · ÉCHAP quitter');
    window.addEventListener('keydown', (e) => this.key(e), true);
  }

  // Shop and safehouse markers (the safehouse given in Act I appears once earned)
  place() {
    const g = this.game;
    for (const m of this.markers) g.markers.remove(m.marker);
    this.markers.length = 0;
    const shops = [...SHOPS, ...(this.gunShops || [])];
    for (const s of shops) {
      if (s.gift && !g.missionsDone.includes(s.gift) && !this.owned.has(s.id)) continue;
      const spot = s.calibre ? s : g.safeSpot(s.x, s.z, s.drive ? 1.5 : 0.5);
      const kind = s.calibre ? 'guns' : s.type === 'home' ? (this.owned.has(s.id) ? 'home' : 'homeSale') : 'shop';
      const marker = g.markers.add(spot.x, spot.z, { kind, radius: s.drive ? 3.2 : 1.2, height: s.drive ? 3 : 2.4, label: s.name, blip: true, mapOnly: !!s.calibre });
      if (marker) this.markers.push({ shop: s, marker, x: spot.x, z: spot.z });
    }
  }

  nearest(type) {
    const g = this.game;
    let best = null, bd = Infinity;
    for (const m of this.markers) {
      if (m.shop.type !== type) continue;
      const d = Math.hypot(m.x - g.player.x, m.z - g.player.z);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  update(dt) {
    const g = this.game;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.open || this.cooldown > 0 || g.director.current) return;
    for (const m of this.markers) {
      const s = m.shop;
      if (s.calibre) continue;
      const r = s.drive ? 4 : 1.6;
      if (Math.hypot(g.player.x - m.x, g.player.z - m.z) > r) continue;
      if (s.drive ? g.state !== 'driving' : g.state !== 'onFoot') continue;
      if (s.drive && Math.abs(g.car.speed) > 3) continue;
      this.show(s);
      return;
    }
  }

  // ---- Menus -----------------------------------------------------------------------------------------------------
  items(s) {
    const g = this.game;
    if (s.type === 'guns') {
      return GUN_ITEMS.map((it) => {
        if (it.id === 'armor') return { id: it.id, label: 'GILET PARE-BALLES', detail: `Gilet : ${Math.round(g.armor)} %`, price: it.price, enabled: g.armor < 100, act: () => { g.armor = 100; } };
        const w = WEAPONS[it.id];
        const owned = !!g.weapons[it.id];
        if (!owned) return { id: it.id, label: w.name, detail: w.sub, price: it.price, act: () => g.giveWeapon(it.id, it.ammo) };
        const slot = g.weapons[it.id];
        const ammoText = w.throwable ? `${slot.mag} en stock` : `${slot.mag + slot.ammo} munitions`;
        return { id: it.id, label: `${w.name} · munitions`, detail: `+${w.throwable ? Math.min(it.ammo, w.mag - slot.mag) : it.ammo} · ${ammoText}`, enabled: !w.throwable || slot.mag < w.mag, price: it.ammoPrice, act: () => g.giveWeapon(it.id, it.ammo) };
      });
    }
    if (s.type === 'body') {
      const car = g.car;
      const police = g.wanted.level > 0;
      return [
        { label: 'RÉPARER ET REPEINDRE', detail: police ? (g.wanted.seen ? 'La police vous voit : ils vous suivront' : 'Nouvelle couleur : la police perd votre trace') : `État : ${Math.round(car.hp)} %`,
          price: RESPRAY_PRICE, enabled: !car.policeLivery, act: () => this.respray(car) },
        { label: 'PARTIR', detail: '', price: 0, act: () => this.close() }
      ];
    }
    // safehouse
    if (!this.owned.has(s.id)) {
      return [
        { label: `ACHETER ${s.name}`, detail: 'Dormir, se soigner, sauvegarder', price: s.price, act: () => { this.owned.add(s.id); g.audio.ui('pass'); g.toast(s.name, 'Planque achetée. Elle vous attend.'); this.place(); this.refresh(s); } },
        { label: 'PARTIR', detail: '', price: 0, act: () => this.close() }
      ];
    }
    return [
      { label: 'DORMIR 8 HEURES', detail: 'Soins complets · sauvegarde', price: 0, enabled: g.wanted.level === 0, act: () => this.sleep(s) },
      { label: 'SAUVEGARDER', detail: '', price: 0, act: () => { g.save(); g.toast('Partie sauvegardée', s.name); this.close(); } },
      { label: 'PARTIR', detail: '', price: 0, act: () => this.close() }
    ];
  }

  show(s) {
    const g = this.game;
    if (s.calibre && !g.calibre.available(s)) return;
    this.open = s;
    this.sel = 0;
    g.modal = true;
    g.controllers.resetInput();
    g.releasePointer();
    if (s.calibre) { g.audio.ui('shop'); g.calibre.openCounter(s); return; }
    this.title.textContent = s.name;
    this.sub.textContent = s.sub;
    this.panel.hidden = false;
    this.panel.dataset.type = s.type;
    g.audio.ui('shop');
    this.refresh(s);
  }

  refresh(s = this.open) {
    if (!s) return;
    const g = this.game;
    this.current = this.items(s);
    this.list.replaceChildren();
    this.current.forEach((it, i) => {
      const affordable = it.price <= g.money;
      const enabled = it.enabled !== false && affordable;
      const row = el('button', `shop-row${i === this.sel ? ' sel' : ''}${enabled ? '' : ' off'}`, this.list);
      el('strong', null, row, it.label);
      el('span', 'shop-detail', row, it.detail || '');
      el('span', 'shop-price', row, it.price ? money(it.price) : '');
      row.addEventListener('pointermove', e => {
        if ((!e.movementX && !e.movementY) || this.sel === i) return;
        this.sel = i; this.refreshSelection();
      });
      row.addEventListener('click', () => { this.sel = i; this.buy(); });
    });
    const keys = g.gamepad?.using ? '↑ ↓ choisir · A valider · B quitter' : '↑ ↓ choisir · ENTRÉE valider · ÉCHAP quitter';
    this.foot.textContent = `${keys} · ${money(g.money)}`;
  }

  refreshSelection() {
    [...this.list.children].forEach((row, i) => row.classList.toggle('sel', i === this.sel));
  }

  navigate(step) {
    if (this.open?.calibre) { this.game.calibre.counter.navigate(step); return; }
    const count = this.current?.length;
    if (!count) return;
    this.sel = (this.sel + step + count) % count;
    this.refreshSelection();
    this.list.children[this.sel]?.scrollIntoView({ block: 'nearest' });
  }

  // Left and right: the counter's tabs (the other services have none)
  turn(step) {
    if (this.open?.calibre) this.game.calibre.counter.turn(step);
  }

  buy() {
    const g = this.game;
    if (this.open?.calibre) { g.calibre.counter.act(); return; }
    const it = this.current?.[this.sel];
    if (!it) return;
    if (it.enabled === false || it.price > g.money) { g.audio.ui('deny'); return; }
    if (it.price) { g.addMoney(-it.price); g.audio.ui('cash'); }
    it.act();
    if (this.open) this.refresh();
    g.save();
  }

  key(e) {
    if (!this.open) return;
    if (this.open.calibre) { this.game.calibre.counter.key(e); return; }
    const k = e.code;
    if (['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'KeyZ', 'Enter', 'NumpadEnter', 'Space', 'Escape', 'Tab'].includes(k)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    } else return;
    if (e.repeat && ['Enter', 'NumpadEnter', 'Space', 'Escape'].includes(k)) return;
    if (k === 'ArrowUp' || k === 'KeyW' || k === 'KeyZ') this.navigate(-1);
    if (k === 'ArrowDown' || k === 'KeyS') this.navigate(1);
    if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') this.buy();
    if (k === 'Escape') this.close();
    this.refreshSelection();
  }

  close() {
    const g = this.game;
    if (this.open?.calibre) g.calibre.closeCounter();
    this.open = null;
    this.panel.hidden = true;
    g.modal = false;
    this.cooldown = 4;
    g.camera.domElement.focus();
  }

  respray(car) {
    const g = this.game;
    let paint = car.paint;
    while (paint === car.paint) paint = PAINTS[Math.floor(Math.random() * PAINTS.length)];
    if (car.moto) car.paintMaterial.color.setHex(paint);
    else {
      car.paintMaterial.userData.paint.value.setHex(paint);
      repairBody(car);
    }
    car.paint = paint;
    car.hp = 100;
    car.burnT = 0;
    if (g.wanted.level > 0 && !g.wanted.seen) {
      g.wanted.clear();
      g.toast('Méconnaissable', 'Nouvelle couleur : la police a perdu votre trace.');
    } else g.toast('Comme neuve', 'Réparée et repeinte.');
    this.close();
  }

  sleep(s) {
    const g = this.game;
    this.close();
    document.body.classList.add('sleeping');
    g.modal = true;
    setTimeout(() => {
      g.atmosphere.setHour(g.atmosphere.hour + 8);
      g.health = 100;
      g.save();
      g.toast(s.name, `Il est ${g.atmosphere.clockLabel}. Partie sauvegardée.`);
      document.body.classList.remove('sleeping');
      g.modal = false;
    }, 1600);
  }

  serialize() { return [...this.owned].filter(Boolean); }
  restore(list) { if (Array.isArray(list)) for (const id of list) if (SHOPS.some((s) => s.id === id)) this.owned.add(id); }
}

export { ShopSystem, SHOPS, GUN_ITEMS };
