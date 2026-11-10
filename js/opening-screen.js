const THEME_PREFERENCE = 'overdraft:opening-theme';
const THEME_VOLUME = 0.55;
const FADE_MS = 650;

export class OpeningScreen {
  constructor() {
    this.root = document.getElementById('opening-screen');
    this.loader = document.getElementById('loading-overlay');
    this.status = document.getElementById('loading-status');
    this.fill = document.getElementById('loading-progress');
    this.track = this.fill.parentElement;
    this.launch = document.getElementById('opening-launch');
    this.audio = document.getElementById('opening-theme');
    this.sound = document.getElementById('opening-music');
    this.soundLabel = document.getElementById('opening-music-label');
    this.audio.volume = THEME_VOLUME;
    this.wantsMusic = true;
    try {
      this.wantsMusic = localStorage.getItem('nyc-sound') !== 'off' && localStorage.getItem(THEME_PREFERENCE) !== 'off';
    } catch { /* Optional preferences. */ }

    for (const event of ['play', 'pause', 'error']) this.audio.addEventListener(event, () => this.syncSound());
    this.sound.disabled = false;
    this.sound.addEventListener('click', () => {
      this.wantsMusic = this.audio.paused;
      try { localStorage.setItem(THEME_PREFERENCE, this.wantsMusic ? 'on' : 'off'); } catch { /* Optional preferences. */ }
      if (this.wantsMusic) this.playTheme();
      else this.audio.pause();
    });
    document.getElementById('opening-options').addEventListener('click', () => {
      this.dismiss();
      document.getElementById('pm-tab-session').focus();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Tab' || this.root.inert || event.altKey || event.ctrlKey || event.metaKey) return;
      const buttons = [...this.root.querySelectorAll('button:not(:disabled)')].filter(button => button.getClientRects().length);
      if (!buttons.length) return;
      const index = buttons.indexOf(document.activeElement);
      const step = event.shiftKey ? -1 : 1;
      if (index >= 0 && buttons[index + step]) return;
      event.preventDefault();
      buttons[event.shiftKey ? buttons.length - 1 : 0].focus();
    }, true);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio.pause();
      else this.playTheme();
    });
    this.playTheme();
  }

  get ready() { return this.root.dataset.state === 'ready'; }

  playTheme() {
    if (!this.wantsMusic || document.hidden || this.root.dataset.state === 'closed' || this.audio.error) return;
    this.audio.play().catch(() => this.syncSound()); // The button provides a gesture if autoplay is blocked.
  }

  syncSound() {
    const failed = !!this.audio.error;
    const playing = !this.audio.paused && !failed;
    this.sound.disabled = failed;
    this.sound.setAttribute('aria-pressed', String(playing));
    this.soundLabel.textContent = failed ? 'Thème indisponible' : playing ? 'Couper le thème' : 'Écouter le thème';
  }

  setStage(message) {
    this.status.textContent = message;
    this.track.classList.add('is-indeterminate');
  }

  progress(value) {
    this.track.classList.remove('is-indeterminate');
    this.fill.style.transform = `scaleX(${Math.min(1, Math.max(0, value))})`;
  }

  showLaunch(menu) {
    this.menu = menu;
    this.play = document.getElementById('play-button');
    // Share the session's launch action with the title screen and restore it for the pause menu.
    this.playHome = this.play.parentElement;
    this.launch.prepend(this.play);
    this.loader.classList.add('hidden');
    this.launch.hidden = false;
    this.root.dataset.state = 'ready';
    if (document.activeElement === document.body) this.play.focus();
  }

  restorePlayButton() {
    if (this.play?.parentElement === this.launch) this.playHome.prepend(this.play);
    this.launch.hidden = true;
  }

  dismiss() {
    if (!this.ready) return;
    this.restorePlayButton();
    this.menu.inert = false;
    this.root.inert = true;
    this.root.dataset.state = 'closed';
    const started = performance.now();
    const fade = (now) => {
      const remaining = Math.max(0, 1 - (now - started) / FADE_MS);
      if (remaining && !this.audio.paused) {
        this.audio.volume = THEME_VOLUME * remaining;
        requestAnimationFrame(fade);
      } else this.audio.pause();
    };
    if (!this.audio.paused) requestAnimationFrame(fade);
  }

  fail(message, label, recover) {
    if (this.root.dataset.state === 'failed') return;
    this.restorePlayButton();
    if (this.menu) this.menu.inert = true;
    this.root.inert = false;
    this.root.dataset.state = 'failed';
    this.loader.classList.remove('hidden');
    this.status.textContent = message;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'opening-link';
    button.textContent = label;
    button.addEventListener('click', recover);
    document.getElementById('opening-recovery').replaceChildren(button);
    button.focus();
  }
}
