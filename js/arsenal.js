import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { GUN_ITEMS } from './shops.js';
import { QuickStrip } from './quick-strip.js';

// The weapon selector: every weapon in the game, what is in reserve, and for the ones not owned yet, what they cost and the
// way to the nearest gun shop.

const ICONS = { fists: 'i-fist', pistol: 'i-pistol', smg: 'i-smg', shotgun: 'i-shotgun', rifle: 'i-rifle', grenade: 'i-grenade' };
const money = (n) => `${n.toLocaleString('fr-FR')} $`;

class Arsenal extends QuickStrip {
  constructor(game) {
    super(game, {
      name: 'arsenal', label: 'Choisir une arme', hotkey: 'TAB', closeCode: 'Tab', icon: ICONS.fists,
      tiles: WEAPON_ORDER.map((id) => `${QuickStrip.icon(ICONS[id])}<span>${WEAPONS[id].name}</span><small></small>`)
    });
  }

  get available() {
    const g = this.game;
    return g.active && !g.transition && (g.state === 'onFoot' || g.state === 'driving');
  }

  get currentIndex() { return WEAPON_ORDER.indexOf(this.game.weaponId); }

  update() { this.setButtonIcon(ICONS[this.game.weaponId]); }

  reserve(id) {
    const w = WEAPONS[id], slot = this.game.weapons[id];
    if (!slot) return money(GUN_ITEMS.find((it) => it.id === id).price);
    if (w.melee) return '';
    return w.throwable ? `× ${slot.mag}` : `${slot.mag} / ${slot.ammo}`;
  }

  refresh() {
    this.tiles.forEach((tile, i) => {
      const id = WEAPON_ORDER[i];
      tile.classList.toggle('locked', !this.game.weapons[id]);
      tile.querySelector('small').textContent = this.reserve(id);
    });
  }

  pick(i) {
    const id = WEAPON_ORDER[i];
    this.close();
    if (this.game.weapons[id]) this.game.selectWeapon(id);
    else this.missing(id);
  }

  // Not owned yet: say so, and show the way to the nearest gun shop
  missing(id) {
    const g = this.game;
    const shop = g.shops.nearest('guns');
    if (!g.director.current && shop) g.gps(shop.x, shop.z);
    g.audio.ui('deny');
    g.toast(`${WEAPONS[id].name} : pas encore à vous`, `${money(GUN_ITEMS.find((it) => it.id === id).price)} chez Calibre · TAB : vos armes`);
  }
}

export { Arsenal };
