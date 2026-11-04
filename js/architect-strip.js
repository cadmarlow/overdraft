import { QuickStrip } from './quick-strip.js';

// The Architect's quick strip (J), beside the arsenal, the garage and the phone: bring him in or send him away, hand
// him the camera or take it back, talk to him, have him follow or stop, open the control room. Like the other strips,
// the game waits while it is open, and it works with the mouse, the trackpad, the keys 1-6 or the arrows.

const ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="ia-architect" viewBox="0 0 24 24"><path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/><path d="M12 7.5 16.5 12 12 16.5 7.5 12z"/></symbol>
  <symbol id="ia-camera" viewBox="0 0 24 24"><path d="M3.5 8.5h3l1.6-2.5h7.8l1.6 2.5h3v10.5h-17z"/><circle cx="12" cy="13.5" r="3.4"/></symbol>
  <symbol id="ia-talk" viewBox="0 0 24 24"><path d="M4 5.5h16v10H11l-4.5 3.5v-3.5H4z"/><path d="M8 9.5h8M8 12.5h5"/></symbol>
  <symbol id="ia-follow" viewBox="0 0 24 24"><circle cx="8" cy="5" r="1.8"/><path d="M8 8.4v5.2l-2 6M8 13.6l2.2 6M8 9.6l3 2"/><circle cx="17" cy="5.6" r="1.6"/><path d="M17 8.6v4.6l-1.8 5.4M17 13.2l2 5.4" opacity=".55"/></symbol>
  <symbol id="ia-stop" viewBox="0 0 24 24"><path d="M8.2 3.5h7.6l5.4 5.4v6.2l-5.4 5.4H8.2l-5.4-5.4V8.9z"/><path d="M9 12h6"/></symbol>
  <symbol id="ia-room" viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16.5V20M6.5 13l3.2-3.4 2.6 2.4 4.6-4.6"/></symbol>
</svg>`;

const TILES = [
  ['ia-architect', 'presence'], ['ia-camera', 'camera'], ['ia-talk', 'talk'], ['ia-follow', 'follow'], ['ia-stop', 'stop'], ['ia-room', 'room']
];

class ArchitectStrip extends QuickStrip {
  constructor(architect) {
    document.body.insertAdjacentHTML('beforeend', ICONS);
    super(architect.game, {
      name: 'architect-strip', label: 'L’Architecte', hotkey: 'J', closeCode: 'KeyJ', icon: 'ia-architect',
      tiles: TILES.map(([icon]) => `${QuickStrip.icon(icon)}<span></span><small></small>`)
    });
    this.architect = architect;
  }

  get available() { return this.game.active && !this.game.transition; }

  // Each tile says what it will do now, and how things stand
  refresh() {
    const a = this.architect, s = a.state();
    const set = (i, label, note) => {
      const tile = this.tiles[i];
      tile.querySelector('span').textContent = label;
      tile.querySelector('small').textContent = note;
    };
    set(0, a.present ? 'ÉTEINDRE' : 'ALLUMER', !a.present ? 'il est éteint' : a.alive ? `allumé, ${s.mode}` : 'hors service');
    set(1, a.spectating ? 'MA CAMÉRA' : 'SA CAMÉRA', a.spectating ? 'il la tient : la reprendre' : 'tu la tiens : la lui donner');
    set(2, 'PARLER', a.link.connected ? 'touche K' : 'cerveau hors ligne');
    set(3, 'SUIS-MOI', a.order?.kind === 'follow' ? 'en cours' : '');
    set(4, 'STOP', 'il observe');
    set(5, 'SALLE ↗', a.link.connected ? 'contrôle' : 'serveur éteint');
    this.tiles[2].classList.toggle('locked', !a.link.connected || !a.present);
    for (const i of [3, 4]) this.tiles[i].classList.toggle('locked', !a.alive);
  }

  async pick(i) {
    const a = this.architect, g = this.game;
    const action = TILES[i][1];
    this.close();
    const tell = (text) => g.toast('L’Architecte', text);
    if (action === 'presence') { if (a.present) { a.dismiss(); tell('Éteint : il quitte la partie.'); } else { a.summon(); tell('Allumé : il arrive.'); } }
    else if (action === 'camera') tell((await a.link.execute('camera-now', {})).texte);
    else if (action === 'talk') a.link.openChat();
    else if (action === 'follow') { if (a.alive) { a.follow(); tell('Il te suit.'); } else tell('Il n’est pas là.'); }
    else if (action === 'stop') { if (a.alive) { a.stop(); tell('Il s’arrête et observe.'); } else tell('Il n’est pas là.'); }
    else if (action === 'room') window.open(`${a.link.base}/`, 'architecte-salle');
  }
}

export { ArchitectStrip };
