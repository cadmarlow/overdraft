import { streetZ } from './city-config.js';
import { WEAPONS } from './weapons.js';
import { createLoftedCarMaterial } from './cars.js';

// Places to spend money: gun shops, a body shop that repairs and repaints (and loses the police if they did not see the
// car go in), and safehouses to buy, sleep in (8 hours pass, wounds heal) and save at. Each place is a world marker; its
// menu is a DOM panel that freezes the game while it is open.

const SHOPS = [
  { id: 'calibre-west', type: 'guns', name: 'CALIBRE', sub: 'Armurerie · 9e Avenue', x: -1123, z: streetZ(41) + 30 },
  { id: 'calibre-east', type: 'guns', name: 'CALIBRE', sub: 'Armurerie · 2e Avenue', x: 850, z: streetZ(8) + 30 },
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
    for (const s of SHOPS) {
      if (s.gift && !g.missionsDone.includes(s.gift) && !this.owned.has(s.id)) continue;
      const spot = g.safeSpot(s.x, s.z, s.drive ? 1.5 : 0.5);
      const kind = s.type === 'home' ? (this.owned.has(s.id) ? 'home' : 'homeSale') : 'shop';
      const marker = g.markers.add(spot.x, spot.z, { kind, radius: s.drive ? 3.2 : 1.2, height: s.drive ? 3 : 2.4, label: s.name, blip: true });
      if (marker) this.markers.push({ shop: s, marker, x: spot.x, z: spot.z });
    }
  }

  update(dt) {
    const g = this.game;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.open || this.cooldown > 0 || g.director.current) return;
    for (const m of this.markers) {
      const s = m.shop;
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
        if (it.id === 'armor') return { label: 'GILET PARE-BALLES', detail: `Gilet : ${Math.round(g.armor)} %`, price: it.price, enabled: g.armor < 100, act: () => { g.armor = 100; } };
        const w = WEAPONS[it.id];
        const owned = !!g.weapons[it.id];
        if (!owned) return { label: w.name, detail: w.sub, price: it.price, act: () => g.giveWeapon(it.id, it.ammo) };
        const slot = g.weapons[it.id];
        const ammoText = w.throwable ? `${slot.mag} en stock` : `${slot.mag + slot.ammo} munitions`;
        return { label: `${w.name} · munitions`, detail: `+${it.ammo} · ${ammoText}`, price: it.ammoPrice, act: () => g.giveWeapon(it.id, it.ammo) };
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
    this.open = s;
    this.sel = 0;
    g.modal = true;
    g.controllers.resetInput();
    g.releasePointer();
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
      row.addEventListener('mouseenter', () => { this.sel = i; this.refreshSelection(); });
      row.addEventListener('click', () => { this.sel = i; this.buy(); });
    });
    this.foot.textContent = `↑ ↓ choisir · ENTRÉE valider · ÉCHAP quitter · ${money(g.money)}`;
  }

  refreshSelection() {
    [...this.list.children].forEach((row, i) => row.classList.toggle('sel', i === this.sel));
  }

  buy() {
    const g = this.game;
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
    const k = e.code;
    if (['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'KeyZ', 'Enter', 'NumpadEnter', 'Space', 'Escape'].includes(k)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    } else return;
    const n = this.current?.length || 0;
    if (k === 'ArrowUp' || k === 'KeyW' || k === 'KeyZ') this.sel = (this.sel - 1 + n) % n;
    if (k === 'ArrowDown' || k === 'KeyS') this.sel = (this.sel + 1) % n;
    if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') this.buy();
    if (k === 'Escape') this.close();
    this.refreshSelection();
  }

  close() {
    const g = this.game;
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
      const material = createLoftedCarMaterial(car.spec, paint, 0);
      car.bodyMesh.material = material;
      if (car.door) car.door.children[0].material = material;
      car.carState = material.userData.carState;
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

export { ShopSystem, SHOPS };
