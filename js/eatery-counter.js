import { BRANDS, SNACK_MAX } from './eatery-brands.js';

// The menu a customer reads at a till, a kiosk or TRANCHE's hatch: what there is, what it costs, what it does, and
// whether it is eaten here (a tray, a plate) or taken away (in the pockets, for later). The world keeps running
// behind it; the camera is on whoever serves (eatery.js).

const money = (n) => `${Math.round(n).toLocaleString('fr-FR')} $`;

/**
 * The lines of a brand's menu for the game as it stands.
 * @param {object} g - the game ({ money, snacks, health })
 * @param {string} brand
 * @param {boolean} takeaway - the customer's choice; a meal on a tray and a slice on a plate can also be taken away
 * @param {object} state - { pending: an order of the player's is already being made, holding: hands full, seats: can sit }
 */
function menuLines(g, brand, takeaway, state = {}) {
  const room = SNACK_MAX - (g.snacks?.length || 0);
  return BRANDS[brand].menu.map((item) => {
    const here = !takeaway && !!(item.meal || item.slice);
    const count = item.count || 1;
    let enabled = true, why = '';
    if (here) {
      if (state.pending) { enabled = false; why = 'Une commande est déjà en route'; }
      else if (state.holding) { enabled = false; why = 'Vous avez les mains pleines'; }
    } else if (room < count) { enabled = false; why = 'Vos poches sont pleines'; }
    const effect = item.fed ? `+${item.heal} santé · rassasié ${Math.round(item.fed / 60)} min` : `+${item.heal} santé${item.risky ? ' · à vos risques' : ''}`;
    return { item, here, count, enabled, why, label: item.name, detail: item.note, effect: here ? effect : `${effect}${count > 1 ? ` × ${count}` : ''} · dans la poche`, price: item.price };
  });
}

class EateryCounter {
  constructor(game, system) {
    this.game = game; this.system = system;
    this.open = null; this.sel = 0; this.takeaway = false; this.lines = [];
    const el = (tag, cls, parent, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; parent?.append(n); return n; };
    this.el = el;
    const root = this.root = el('div', 'eatery-counter', document.body);
    root.hidden = true;
    const head = el('div', 'ec-head', root);
    this.brandName = el('strong', null, head);
    this.tagline = el('span', null, head);
    const card = this.card = el('div', 'ec-card', root);
    const top = el('div', 'ec-top', card);
    this.title = el('h2', null, top);
    this.purse = el('em', null, top);
    this.modes = el('div', 'ec-modes', card);
    this.here = el('button', null, this.modes, 'SUR PLACE');
    this.away = el('button', null, this.modes, 'À EMPORTER');
    this.here.addEventListener('click', () => this.setMode(false));
    this.away.addEventListener('click', () => this.setMode(true));
    this.list = el('div', 'ec-lines', card);
    this.note = el('p', 'ec-note', card);
    this.foot = el('div', 'ec-foot', root);
  }

  show(shop, { window = false, kiosk = false } = {}) {
    const brand = BRANDS[shop.brand];
    this.open = shop; this.window = window; this.kiosk = kiosk; this.sel = 0;
    this.takeaway = false;
    this.root.hidden = false;
    this.root.dataset.brand = shop.brand;
    this.brandName.textContent = brand.name;
    this.tagline.textContent = brand.tagline;
    this.title.textContent = kiosk ? 'BORNE DE COMMANDE' : window ? 'AU GUICHET' : 'LA CARTE';
    this.modes.hidden = window;
    this.refresh();
  }

  hide() { this.open = null; this.root.hidden = true; }

  setMode(takeaway) {
    if (this.window || this.takeaway === takeaway) return;
    this.takeaway = takeaway;
    this.system.blip();
    this.refresh();
  }

  refresh() {
    const g = this.game, shop = this.open;
    if (!shop) return;
    this.lines = menuLines(g, shop.brand, this.takeaway, { ...this.system.orderState(), window: this.window });
    this.sel = Math.min(this.sel, this.lines.length - 1);
    this.here.classList.toggle('on', !this.takeaway); this.away.classList.toggle('on', this.takeaway);
    this.purse.textContent = money(g.money);
    this.list.replaceChildren();
    this.lines.forEach((line, i) => {
      const able = line.enabled && line.price <= g.money;
      const row = this.el('button', `ec-line${i === this.sel ? ' sel' : ''}${able ? '' : ' off'}`, this.list);
      this.el('strong', null, row, line.label);
      this.el('span', null, row, line.detail);
      this.el('small', null, row, line.why || line.effect);
      this.el('em', null, row, money(line.price));
      row.addEventListener('pointermove', (e) => { if ((e.movementX || e.movementY) && this.sel !== i) { this.sel = i; this.highlight(); } });
      row.addEventListener('click', () => { this.sel = i; this.act(); });
    });
    const pockets = `${g.snacks?.length || 0} / ${SNACK_MAX} en poche`;
    this.note.textContent = this.window ? 'Au guichet : la part vous est tendue chaude, vous la mangez en marchant.' : this.takeaway ? `À emporter : ça se mange plus tard, n’importe où (touche U). ${pockets}.` : 'Sur place : on vous appelle, vous prenez votre plateau et vous vous asseyez où vous voulez.';
    const keys = g.gamepad?.using ? '↑ ↓ choisir · ← → sur place / à emporter · A commander · B partir' : '↑ ↓ choisir · ← → sur place / à emporter · ENTRÉE commander · ÉCHAP partir';
    this.foot.textContent = this.window ? keys.replace(' · ← → sur place / à emporter', '') : keys;
  }

  highlight() { [...this.list.children].forEach((row, i) => row.classList.toggle('sel', i === this.sel)); }

  navigate(step) {
    const n = this.lines.length;
    if (!n) return;
    this.sel = (this.sel + step + n) % n;
    this.highlight();
    this.list.children[this.sel]?.scrollIntoView({ block: 'nearest' });
  }

  turn(step) { this.setMode(step > 0); }

  // Buy the highlighted line
  act() {
    const g = this.game, line = this.lines[this.sel], row = this.list.children[this.sel];
    if (!line) return;
    const refuse = (kind) => {
      g.audio.ui('deny');
      if (row) { row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake'); }
      this.system.speak(kind);
    };
    if (!this.system.available(this.open)) { g.shops.close(); return; }
    if (!line.enabled) return refuse(line.why.includes('poches') ? 'full' : 'busy');
    if (line.price > g.money) return refuse('broke');
    g.addMoney(-line.price);
    g.audio.ui('cash');
    this.system.bought(this.open, line, { window: this.window, kiosk: this.kiosk });
    g.save();
    if (line.here) g.shops.close(); // the order is in: off to wait for it
    else this.refresh();
  }

  key(e) {
    const k = e.code;
    const used = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyZ', 'KeyQ', 'Enter', 'NumpadEnter', 'Space', 'Escape', 'Tab', 'KeyF'];
    if (!used.includes(k)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat && ['Enter', 'NumpadEnter', 'Space', 'Escape', 'KeyF', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'KeyQ'].includes(k)) return;
    if (k === 'ArrowUp' || k === 'KeyW' || k === 'KeyZ') this.navigate(-1);
    else if (k === 'ArrowDown' || k === 'KeyS') this.navigate(1);
    else if (k === 'ArrowLeft' || k === 'KeyA' || k === 'KeyQ') this.turn(-1);
    else if (k === 'ArrowRight' || k === 'KeyD') this.turn(1);
    else if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') this.act();
    else if (k === 'Escape') this.game.shops.close();
  }
}

export { EateryCounter, menuLines };
