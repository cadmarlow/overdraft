import { WEAPONS } from './weapons.js';
import { FINISHES, modsFor, weaponBars, withMod, effectiveWeapon } from './weapon-mods.js';

// The counter of a CALIBRE branch: what is for sale and the sheet the customer reads while the clerk shows the piece.
// One tab per weapon (its ammunition, its upgrades, its finishes), one for grenades, one for body armour. The world
// keeps running behind it; the camera is on the weapon lying on the mat (calibre.js, calibre-room.js).

const TABS = [
  { id: 'pistol', kind: 'gun', price: 600, pack: 24, packPrice: 120,
    text: 'Neuf millimètres, zéro surprise. L’arme de ceux qui préfèrent rembourser comptant.' },
  { id: 'smg', kind: 'gun', price: 2800, pack: 60, packPrice: 300,
    text: 'Petit, nerveux, bavard. Vide son chargeur avant que la conversation ne tourne mal.' },
  { id: 'shotgun', kind: 'gun', price: 3600, pack: 16, packPrice: 260,
    text: 'Calibre 12 à pompe. Ouvre les portes, clôt les débats.' },
  { id: 'rifle', kind: 'gun', price: 6500, pack: 60, packPrice: 420,
    text: 'Fusil d’assaut 5,56. Précis à deux cents mètres, convaincant à tous les autres.' },
  { id: 'grenade', kind: 'grenade', price: 320,
    text: 'Fragmentation. Quatre secondes pour changer d’avis, aucune pour le regretter.' },
  { id: 'armor', kind: 'armor', name: 'PROTECTION', sub: 'Gilets pare-balles',
    text: 'Niveau IIIA. Arrête ce que la diplomatie n’a pas su arrêter.' }
];
const RESERVE_MAGS = 10; // a full reserve, as the starter kit gives
const BARS = [['damage', 'DÉGÂTS'], ['rate', 'CADENCE'], ['accuracy', 'PRÉCISION'], ['range', 'PORTÉE'], ['control', 'CONTRÔLE'], ['capacity', 'CAPACITÉ']];

const money = (n) => `${Math.round(n).toLocaleString('fr-FR')} $`;
// A list price after the range's medals (calibre-range.js), rounded to ten dollars
const priced = (base, discount) => (base ? Math.max(10, Math.round(base * (1 - discount) / 10) * 10) : 0);

/**
 * The lines of a tab for the game as it stands. Each: { key, label, detail, price, state ('' | 'fitted' | 'stowed' |
 * 'worn' | 'owned'), enabled, preview (the upgrades to show on the counter while it is highlighted), act() }.
 * `act` changes the game and returns what the clerk has to say about it ('buy' | 'fit' | 'stow' | null); the price is
 * debited by the caller.
 */
function counterLines(g, tab, discount = 0) {
  const lines = [];
  const P = (base) => priced(base, discount);
  if (tab.kind === 'gun') {
    const id = tab.id, slot = g.weapons[id], state = g.mods?.[id];
    if (!slot) {
      lines.push({ key: 'weapon', label: `ACHETER ${WEAPONS[id].name}`, detail: `${WEAPONS[id].sub} · ${tab.pack} munitions`, price: P(tab.price), act: () => { g.giveWeapon(id, tab.pack); return 'buy'; } });
      return lines;
    }
    const spec = effectiveWeapon(id, state), cap = spec.mag * RESERVE_MAGS, missing = Math.max(0, cap - slot.ammo);
    lines.push({ key: 'ammo', label: 'MUNITIONS', detail: `+${tab.pack} · ${slot.mag + slot.ammo} sur vous`, price: P(tab.packPrice), act: () => { g.giveWeapon(id, tab.pack); return 'buy'; } });
    lines.push({ key: 'fill', label: 'FAIRE LE PLEIN', detail: missing ? `+${missing} · réserve complète` : 'Réserve complète', enabled: missing > 0,
      price: missing ? P(Math.max(tab.packPrice * 0.5, missing / tab.pack * tab.packPrice * 0.85)) : 0, act: () => { g.giveWeapon(id, missing); return 'buy'; } });
    for (const mod of modsFor(id)) {
      const owned = g.modState(id, mod.id);
      if (owned === 'none') lines.push({ key: `mod:${mod.id}`, group: 'AMÉLIORATIONS', label: mod.name, detail: mod.sub, price: P(mod.price), preview: withMod(state, mod.id), act: () => (g.buyMod(id, mod.id) ? 'buy' : null) });
      else lines.push({ key: `mod:${mod.id}`, group: 'AMÉLIORATIONS', label: mod.name, detail: owned === 'fitted' ? 'Entrée : démonter' : 'Entrée : remonter', price: 0, state: owned,
        preview: withMod(state, mod.id, owned !== 'fitted'), act: () => { g.toggleMod(id, mod.id); return owned === 'fitted' ? 'stow' : 'fit'; } });
    }
    const worn = g.finishOf(id);
    for (const finish of FINISHES) {
      const owned = finish.id === 'stock' || g.ownsFinish(id, finish.id), on = worn === finish.id;
      lines.push({ key: `finish:${finish.id}`, group: 'FINITIONS', label: finish.name, detail: on ? 'Sur l’arme' : owned ? 'Entrée : appliquer' : 'Repeinte à l’atelier, sur-le-champ',
        price: owned ? 0 : P(finish.price), state: on ? 'worn' : owned ? 'owned' : '', enabled: !on, preview: { ...state, finish: finish.id }, act: () => { g.setFinish(id, finish.id); return owned ? 'fit' : 'buy'; } });
    }
  } else if (tab.kind === 'grenade') {
    const w = WEAPONS.grenade, held = g.weapons.grenade?.mag ?? 0, room = w.mag - held;
    for (const n of [1, 3]) lines.push({ key: `grenade:${n}`, label: n === 1 ? 'UNE GRENADE' : 'TROIS GRENADES', detail: `${held} sur ${w.mag} à la ceinture`, enabled: room >= n,
      price: P(n === 1 ? tab.price : tab.price * 3 - 60), act: () => { g.giveWeapon('grenade', n); return 'buy'; } });
    lines.push({ key: 'grenade:fill', label: 'CEINTURE COMPLÈTE', detail: room ? `+${room}` : 'Ceinture pleine', enabled: room > 0, price: room ? P(room * tab.price * 0.85) : 0, act: () => { g.giveWeapon('grenade', room); return 'buy'; } });
  } else {
    const armor = Math.round(g.armor);
    lines.push({ key: 'armor:light', label: 'GILET LÉGER', detail: `+50 % · gilet à ${armor} %`, enabled: armor < 100, price: P(400), act: () => { g.armor = Math.min(100, g.armor + 50); return 'buy'; } });
    lines.push({ key: 'armor:heavy', label: 'GILET LOURD', detail: `Protection complète · gilet à ${armor} %`, enabled: armor < 100, price: P(750), act: () => { g.armor = 100; return 'buy'; } });
  }
  return lines;
}

const el = (tag, cls, parent, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.append(n);
  return n;
};

class CalibreCounter {
  constructor(game) {
    this.game = game;
    this.shop = null; this.tab = 0; this.sel = 0; this.lines = []; this.said = '';
    const root = this.root = el('section', 'calibre-counter', document.body);
    root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Comptoir CALIBRE');
    const head = el('header', 'cc-head', root);
    const brand = el('div', 'cc-brand', head);
    el('strong', null, brand, 'CALIBRE');
    this.place = el('span', null, brand);
    const purse = el('div', 'cc-purse', head);
    this.cash = el('strong', null, purse);
    this.deal = el('span', null, purse);
    this.tabs = el('nav', 'cc-tabs', root);
    this.tabButtons = TABS.map((tab, i) => {
      const b = el('button', null, this.tabs, tab.name || WEAPONS[tab.id].name);
      b.addEventListener('click', () => this.turnTo(i));
      return b;
    });
    const card = el('div', 'cc-card', root);
    this.name = el('h2', null, card);
    this.kind = el('p', 'cc-kind', card);
    this.text = el('p', 'cc-text', card);
    this.bars = el('div', 'cc-bars', card);
    this.barRows = BARS.map(([key, label]) => {
      const row = el('div', 'cc-bar', this.bars);
      el('span', null, row, label);
      const track = el('i', null, row);
      return { key, fill: el('b', null, track), gain: el('u', null, track), value: el('em', null, row) };
    });
    this.list = el('div', 'cc-lines', card);
    this.foot = el('footer', 'cc-foot', root);
    const close = el('button', 'cc-close', root, '×');
    close.setAttribute('aria-label', 'Quitter le comptoir');
    close.addEventListener('click', () => game.shops.close());
  }

  get open() { return !!this.shop; }
  get current() { return TABS[this.tab]; }
  // What lies on the mat: the weapon of the tab, dressed as the highlighted line would leave it
  get presented() {
    if (!this.shop) return null;
    const tab = this.current, line = this.lines[this.sel];
    if (tab.kind === 'armor') return { site: this.shop.site, id: 'armor', state: null };
    return { site: this.shop.site, id: tab.id, state: line?.preview ?? this.game.mods?.[tab.id] ?? null };
  }

  show(shop) {
    this.shop = shop;
    this.place.textContent = shop.sub;
    // open on the weapon in hand last, the pistol otherwise
    const held = TABS.findIndex((t) => t.id === this.game.arsenal?.previous);
    this.tab = held >= 0 ? held : 0; this.sel = 0;
    this.root.hidden = false;
    this.refresh();
  }

  hide() {
    this.shop = null;
    this.root.hidden = true;
  }

  refresh() {
    if (!this.shop) return;
    const g = this.game, tab = this.current, discount = g.calibre.discount();
    this.lines = counterLines(g, tab, discount);
    this.sel = Math.min(this.sel, this.lines.length - 1);
    this.tabButtons.forEach((b, i) => b.classList.toggle('on', i === this.tab));
    const w = WEAPONS[tab.id];
    this.name.textContent = tab.name || w.name;
    this.kind.textContent = tab.sub || w.sub;
    this.text.textContent = tab.text;
    this.cash.textContent = money(g.money);
    this.deal.textContent = discount > 0 ? `Médailles du stand : −${Math.round(discount * 100)} %` : 'Le stand, au fond : chaque médaille fait baisser les prix';
    this.list.replaceChildren();
    let group = '';
    this.rows = this.lines.map((line, i) => {
      if ((line.group || '') !== group) { group = line.group || ''; if (group) el('h3', null, this.list, group); }
      const affordable = line.price <= g.money;
      const row = el('button', `cc-line${line.enabled === false || !affordable ? ' off' : ''}${line.state ? ` ${line.state}` : ''}`, this.list);
      el('strong', null, row, line.label);
      el('span', null, row, line.detail || '');
      el('em', null, row, line.price ? money(line.price) : line.state === 'fitted' ? 'MONTÉ' : line.state === 'stowed' ? 'DÉMONTÉ' : line.state === 'worn' ? 'PORTÉE' : line.state === 'owned' ? 'ACQUISE' : '');
      row.addEventListener('pointermove', (e) => { if ((e.movementX || e.movementY) && this.sel !== i) { this.sel = i; this.highlight(); } });
      row.addEventListener('click', () => { this.sel = i; this.highlight(); this.act(); });
      return row;
    });
    this.foot.textContent = g.gamepad?.using ? 'LB · RB  arme     ↑ ↓  choisir     A  acheter     B  quitter'
      : '← →  arme     ↑ ↓  choisir     ENTRÉE  acheter     ÉCHAP  quitter';
    this.highlight();
  }

  highlight() {
    const g = this.game, tab = this.current, line = this.lines[this.sel];
    this.rows.forEach((row, i) => row.classList.toggle('sel', i === this.sel));
    this.bars.hidden = tab.kind === 'grenade';
    if (tab.kind === 'gun') {
      const now = weaponBars(tab.id, g.mods?.[tab.id]), then = line?.preview ? weaponBars(tab.id, line.preview) : now;
      for (const { key, fill, gain, value } of this.barRows) {
        const a = now[key], b = then[key], lo = Math.min(a, b), hi = Math.max(a, b);
        fill.style.width = `${lo * 100}%`;
        gain.style.left = `${lo * 100}%`; gain.style.width = `${(hi - lo) * 100}%`;
        gain.className = b > a + 0.004 ? 'up' : b < a - 0.004 ? 'down' : '';
        value.textContent = Math.abs(b - a) > 0.004 ? `${b > a ? '+' : '−'}${Math.round(Math.abs(b - a) * 100)}` : '';
      }
      this.barRows.forEach((r) => { r.fill.parentElement.parentElement.hidden = false; });
    } else if (tab.kind === 'armor') {
      this.barRows.forEach((r, i) => { r.fill.parentElement.parentElement.hidden = i > 0; });
      const first = this.barRows[0];
      first.fill.parentElement.previousSibling.textContent = 'GILET';
      first.fill.style.width = `${Math.round(g.armor)}%`; first.gain.style.width = '0'; first.value.textContent = `${Math.round(g.armor)} %`;
    }
    if (tab.kind !== 'armor') this.barRows[0].fill.parentElement.previousSibling.textContent = BARS[0][1];
    this.rows[this.sel]?.scrollIntoView({ block: 'nearest' });
  }

  navigate(step) {
    const n = this.lines.length;
    if (!n) return;
    this.sel = (this.sel + step + n) % n;
    this.game.audio.ui('dry', 0.45);
    this.highlight();
  }

  turn(step) { this.turnTo((this.tab + step + TABS.length) % TABS.length); }
  turnTo(i) {
    if (i === this.tab) return;
    this.tab = i; this.sel = 0;
    this.game.audio.ui('shop');
    this.refresh();
  }

  // Buy, fit or take off the highlighted line
  act() {
    const g = this.game, line = this.lines[this.sel];
    if (!line || !this.shop) return;
    if (!g.calibre.available(this.shop)) { g.shops.close(); return; }
    if (line.enabled === false) { g.audio.ui('deny'); return; }
    if (line.price > g.money) { g.audio.ui('deny'); g.calibre.say('broke'); this.rows[this.sel]?.classList.add('shake'); return; }
    if (line.price) { g.addMoney(-line.price); g.audio.ui('cash'); } else g.audio.ui('shop');
    const key = line.key, said = line.act();
    if (said) g.calibre.say(said === 'buy' ? 'sold' : said);
    g.calibre.presented(said);
    g.save();
    this.refresh();
    // stay on the line just acted on (its state changed, the list may have been rebuilt)
    const again = this.lines.findIndex((l) => l.key === key);
    if (again >= 0) { this.sel = again; this.highlight(); }
  }

  key(e) {
    const k = e.code;
    const used = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyZ', 'KeyQ', 'Enter', 'NumpadEnter', 'Space', 'Escape', 'Tab', 'KeyF'];
    if (!used.includes(k)) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat && !['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'KeyZ'].includes(k)) return true;
    if (k === 'ArrowUp' || k === 'KeyW' || k === 'KeyZ') this.navigate(-1);
    else if (k === 'ArrowDown' || k === 'KeyS') this.navigate(1);
    else if (k === 'ArrowLeft' || k === 'KeyA' || k === 'KeyQ') this.turn(-1);
    else if (k === 'ArrowRight' || k === 'KeyD' || (k === 'Tab' && !e.shiftKey)) this.turn(1);
    else if (k === 'Tab') this.turn(-1);
    else if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') this.act();
    else if (k === 'Escape' || k === 'KeyF') this.game.shops.close();
    return true;
  }
}

export { CalibreCounter, TABS as COUNTER_TABS, counterLines, priced };
