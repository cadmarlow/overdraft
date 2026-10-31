// A small HUD button and the strip of tiles it opens, shared by the garage and the arsenal. The game freezes while a strip
// is open and the cursor comes back, so it can be used with the mouse, the trackpad, the keyboard or a finger.

class QuickStrip {
  constructor(game, { name, label, hotkey, closeCode, icon, tiles }) {
    this.game = game;
    this.closeCode = closeCode;
    this.open = false;
    this.sel = 0;
    this.button = document.createElement('button');
    this.button.id = `${name}-button`;
    this.button.className = 'quick-button';
    this.button.type = 'button';
    this.button.setAttribute('aria-label', label);
    this.button.innerHTML = `${QuickStrip.icon(icon)}<kbd>${hotkey}</kbd>`;
    this.button.addEventListener('click', () => this.toggle());
    this.panel = document.createElement('div');
    this.panel.id = `${name}-panel`;
    this.panel.className = 'quick-panel';
    this.panel.hidden = true;
    this.panel.innerHTML = tiles.map((html, i) => `<button type="button">${html}<kbd>${i + 1}</kbd></button>`).join('');
    this.tiles = [...this.panel.children];
    this.tiles.forEach((tile, i) => {
      tile.addEventListener('mouseenter', () => this.select(i));
      tile.addEventListener('click', () => this.pick(i));
    });
    document.body.append(this.button, this.panel);
    window.addEventListener('keydown', (e) => this.key(e), true);
  }

  static icon(id) { return `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`; }

  setButtonIcon(id) {
    if (id === this.shownIcon) return;
    this.shownIcon = id;
    this.button.querySelector('use').setAttribute('href', `#${id}`);
  }

  // Overridden: can it open now, which tile is current, what a tile does, what to refresh on opening
  get available() { return this.game.active; }
  get currentIndex() { return 0; }
  pick() {}
  refresh() {}

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
    this.refresh();
    this.select(this.currentIndex);
    this.tiles.forEach((tile, i) => tile.classList.toggle('active', i === this.currentIndex));
    this.panel.hidden = false;
  }

  close() {
    this.open = false;
    this.panel.hidden = true;
    this.game.modal = false;
    this.game.camera.domElement.focus();
    if (this.relock) Promise.resolve(this.game.camera.domElement.requestPointerLock?.()).catch(() => {});
  }

  select(i) {
    this.sel = i;
    this.tiles.forEach((tile, k) => tile.classList.toggle('sel', k === i));
  }

  key(e) {
    if (!this.open) return;
    const digit = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(e.code);
    const handled = digit >= 0 || ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Enter', 'NumpadEnter', 'Space', 'Escape', this.closeCode].includes(e.code);
    if (!handled) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    const n = this.tiles.length;
    if (digit >= 0 && digit < n) this.pick(digit);
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.select((this.sel - 1 + n) % n);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.select((this.sel + 1) % n);
    else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') this.pick(this.sel);
    else if (digit < 0) this.close();
  }
}

export { QuickStrip };
