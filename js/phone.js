import { repairBody } from './drive-fx.js';

// The phone (P): contacts who can do things for you, the messages they leave, the jobs on offer, the bank, the map of who
// holds what. The game holds its breath while it is out; arrows, Entrée and Échap work, and so does the mouse.

const CONTACTS = [
  { id: 'calibre', name: 'CALIBRE', role: 'Armurerie · stand de tir', actions: [
    { label: 'Trouver une armurerie', sub: 'Itinéraire vers le comptoir le plus proche', run: (g, p) => {
      const shop = g.shops.nearest('guns');
      if (!shop) return;
      g.gps(shop.x, shop.z); g.toast('CALIBRE · itinéraire', shop.shop.sub); p.close();
    } }
  ] },
  { id: 'mireille', name: 'Mireille Okafor', role: 'Garagiste', actions: [
    { label: 'Réparer le véhicule', sub: '800 $', run: (g, p) => p.repair() },
    { label: 'Amène-moi le hors-bord', sub: 'À la rive la plus proche', run: (g) => g.garage.summon('boat') }
  ] },
  { id: 'jules', name: 'Jules Ambrose', role: 'Ancien trader', actions: [
    { label: 'Fais oublier mes étoiles', sub: '1 500 $ par étoile', run: (g, p) => p.bribe() }
  ] },
  { id: 'nadia', name: 'Nadia Ferro', role: 'Organise les coups', actions: [
    { label: 'Où en est le casse ?', sub: 'La Liberty Trust', run: (g, p) => p.heistNews() }
  ] }
];
const APPS = [['contacts', 'Contacts', '☎'], ['messages', 'Messages', '✉'], ['jobs', 'Contrats', '◎'], ['bank', 'Banque', '$'], ['zones', 'Territoires', '⬡']];
const money = (n) => `${Math.round(n).toLocaleString('fr-FR')} $`;
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

class Phone {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.messages = [];
    this.unread = 0;
    this.stack = [];
    this.sel = 0;
    this.button = document.createElement('button');
    this.button.id = 'phone-button';
    this.button.className = 'quick-button';
    this.button.type = 'button';
    this.button.setAttribute('aria-label', 'Téléphone');
    this.button.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.6" width="10" height="18.8" rx="2"/><path d="M10.6 5.4h2.8M11 18.6h2"/></svg><kbd>P</kbd><i></i>';
    this.badge = this.button.querySelector('i');
    this.button.addEventListener('click', () => this.toggle());
    this.panel = document.createElement('div');
    this.panel.id = 'phone';
    this.panel.hidden = true;
    this.panel.innerHTML = '<div class="phone-top"><span class="phone-clock"></span><span class="phone-bars">●●●○ OD</span></div><h3></h3><div class="phone-body"></div><footer><span class="keyboard-hint">↑↓ choisir · Entrée · Échap retour</span><span class="gamepad-hint">Croix choisir · A valider · B retour</span></footer>';
    this.clock = this.panel.querySelector('.phone-clock');
    this.title = this.panel.querySelector('h3');
    this.body = this.panel.querySelector('.phone-body');
    this.body.addEventListener('click', (e) => { const row = e.target.closest('[data-i]'); if (row) { this.sel = +row.dataset.i; this.activate(); } });
    document.body.append(this.button, this.panel);
    window.addEventListener('keydown', (e) => this.key(e), true);
  }

  get available() { return this.game.active && !this.game.transition; }

  toggle() {
    if (this.open) this.close();
    else if (this.available) this.show();
  }

  show() {
    const g = this.game;
    this.open = true;
    this.relock = !!document.pointerLockElement;
    g.modal = true;
    g.controllers.resetInput();
    g.releasePointer();
    this.stack = [];
    this.go('home');
    this.panel.hidden = false;
    this.panel.classList.remove('up');
    void this.panel.offsetWidth;
    this.panel.classList.add('up');
    g.audio.ui('checkpoint', 0.25);
  }

  close() {
    this.open = false;
    this.panel.hidden = true;
    this.game.modal = false;
    this.game.camera.domElement.focus();
    if (this.relock) Promise.resolve(this.game.camera.domElement.requestPointerLock?.()).catch(() => {});
  }

  go(screen, arg) {
    this.stack.push([screen, arg]);
    this.sel = 0;
    this.render();
  }

  back() {
    if (this.stack.length <= 1) { this.close(); return; }
    this.stack.pop();
    this.sel = 0;
    this.render();
  }

  // Each screen is rows; a row with `run` can be chosen
  rows() {
    const g = this.game, [screen, arg] = this.stack[this.stack.length - 1];
    if (screen === 'home') return { title: 'OVERDRAFT', grid: true, rows: APPS.map(([id, label, glyph]) => ({ glyph, label, badge: id === 'messages' ? this.unread : 0, run: () => this.go(id) })) };
    if (screen === 'contacts') return { title: 'Contacts', rows: CONTACTS.map((c) => ({ label: c.name, sub: c.role, run: () => this.go('contact', c) })) };
    if (screen === 'contact') return { title: arg.name, rows: arg.actions.map((a) => ({ label: a.label, sub: a.sub, run: () => a.run(g, this) })) };
    if (screen === 'messages') {
      this.unread = 0;
      this.updateBadge();
      return { title: 'Messages', rows: this.messages.length ? [...this.messages].reverse().map((m) => ({ label: m.from, sub: m.text, wide: true })) : [{ label: 'Aucun message', sub: 'La ville est calme.' }] };
    }
    if (screen === 'jobs') {
      const jobs = g.director.current ? [] : g.director.available();
      if (g.director.current) return { title: 'Contrats', rows: [{ label: 'Contrat en cours', sub: g.director.current.title }] };
      return { title: 'Contrats', rows: jobs.map((j) => ({ label: j.def.title, sub: `${j.place.name ?? ''}`, tone: j.story ? 'story' : '', run: () => this.mark(j) })) };
    }
    if (screen === 'bank') return { title: 'Banque', rows: [
      { label: 'Compte courant', sub: money(g.money) },
      { label: 'Dette de la famille Roux', sub: money(g.debt) },
      { label: 'Revenus par échéance', sub: money(g.gangs.income) },
      g.debt > 0 ? { label: 'Rembourser 10 000 $', sub: 'Elle a un nom, cette dette.', run: () => this.repay() } : { label: 'Dette réglée', sub: 'Plus rien ne vous lie à Varga.' }
    ] };
    if (screen === 'zones') return { title: 'Territoires', rows: g.gangs.zones.map((z) => {
      const held = g.gangs.held.has(z.id);
      return { label: z.name, sub: held ? `À vous · ${money(z.income)} par échéance` : g.gangs.gangs[z.gang].name, tone: held ? 'held' : '', run: held ? null : () => { g.gps(z.hq.x, z.hq.z); g.toast('GPS réglé', `Repaire : ${z.name}`); this.close(); } };
    }) };
    return { title: '', rows: [] };
  }

  render() {
    const { title, rows, grid } = this.rows();
    this.current = rows;
    this.title.textContent = title;
    this.clock.textContent = this.game.atmosphere.clockLabel;
    this.body.className = `phone-body${grid ? ' grid' : ''}`;
    this.body.innerHTML = rows.map((r, i) => `<div class="phone-row${r.run ? ' live' : ''}${r.tone ? ` ${r.tone}` : ''}${r.wide ? ' wide' : ''}" data-i="${i}">${r.glyph ? `<u>${r.glyph}</u>` : ''}<b>${escape(r.label)}</b>${r.sub ? `<span>${escape(r.sub)}</span>` : ''}${r.badge ? `<em>${r.badge}</em>` : ''}</div>`).join('');
    this.highlight();
  }

  highlight() {
    const items = [...this.body.children];
    items.forEach((el, i) => el.classList.toggle('sel', i === this.sel));
    items[this.sel]?.scrollIntoView({ block: 'nearest' });
  }

  activate() {
    const row = this.current?.[this.sel];
    if (row?.run) { this.game.audio.ui('checkpoint', 0.2); row.run(); }
  }

  navigate(direction) {
    const n = this.current?.length ?? 0, step = this.body.classList.contains('grid') ? 2 : 1;
    const offset = { down: step, up: -step, right: 1, left: -1 }[direction];
    if (!n || !offset) return;
    this.sel = Math.max(0, Math.min(n - 1, this.sel + offset));
    this.highlight();
  }

  key(e) {
    if (this.game.paused || document.querySelector('dialog[open]')) return;
    if (!this.open) {
      if (e.code === 'KeyP' && !e.repeat && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA/.test(e.target?.tagName ?? '')) this.toggle();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'KeyP') this.close();
    else if (e.code === 'Escape' || e.code === 'Backspace') this.back();
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.navigate('down');
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.navigate('up');
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.navigate('right');
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.navigate('left');
    else if (e.code === 'Enter' || e.code === 'Space') this.activate();
  }

  // A job chosen: the GPS takes you to whoever offers it
  mark(job) {
    const g = this.game, p = job.place;
    g.gps(p.road?.x ?? p.x, p.road?.z ?? p.z);
    g.phoneJob = job;
    g.toast('GPS réglé', `${job.def.title} · ${p.name ?? ''}`);
    this.close();
  }

  repair() {
    const g = this.game, car = g.car;
    if (g.state !== 'driving' || !car.body) { g.toast('Mireille', 'Je répare ce qui a des roues, Sacha.'); this.close(); return; }
    if (g.money < 800) { g.toast('Mireille', 'Huit cents, pas moins.'); this.close(); return; }
    g.addMoney(-800);
    car.hp = 100; car.burnT = 0;
    repairBody(car);
    g.toast('Mireille', 'Mon gars arrive, il te remet ça d’aplomb.');
    this.close();
  }

  bribe() {
    const g = this.game, stars = g.wanted.level, price = 1500 * stars;
    if (!stars) { g.toast('Jules', 'Personne ne te cherche. Pour l’instant.'); this.close(); return; }
    if (g.money < price) { g.toast('Jules', `Il me faut ${money(price)}, pas une promesse.`); this.close(); return; }
    g.addMoney(-price);
    g.wanted.clear();
    g.toast('Jules', 'Un mot au bon greffier. Tu n’existes plus.');
    this.close();
  }

  heistNews() {
    const g = this.game, s = g.missionsDone;
    const line = s.includes('liberty') ? 'C’est fait. On n’en parle plus jamais.' : s.includes('cazal') ? 'Tout est prêt. Regarde tes contrats.' : 'Il me faut d’abord les horaires de Cazal. Avance avec Jules.';
    this.text('NADIA', line);
    this.close();
  }

  repay() {
    const g = this.game;
    const amount = Math.min(10000, g.debt);
    if (g.money < amount) { g.toast('Banque', 'Fonds insuffisants.'); return; }
    g.addMoney(-amount);
    g.debt -= amount;
    if (g.debt <= 0) g.phone.text('BANQUE', 'La dette de la famille Roux est soldée.');
    this.render();
  }

  // A message arrives: a chime, a toast, a number on the button
  text(from, text) {
    const g = this.game;
    this.messages.push({ from, text });
    if (this.messages.length > 30) this.messages.shift();
    this.unread++;
    this.updateBadge();
    g.toast(`✉ ${from}`, text);
    g.audio.ui?.('checkpoint', 0.4);
  }

  updateBadge() {
    this.badge.textContent = this.unread || '';
    this.badge.hidden = !this.unread;
  }
}

export { Phone };
