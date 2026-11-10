import { WEAPONS, HANDLING } from './weapons.js';

// What CALIBRE sells on top of the four firearms the player owns from the first second: upgrades (a magazine, a
// suppressor, a foregrip, a sight, a choke) and finishes. Pure data and arithmetic: the game reads a weapon through
// effectiveWeapon(), the counter reads prices, names and bars, the models read which attachments to show.
//
// What the player owns for one weapon, as saved: { mag: 1, suppressor: 0, finish: 'or', finishes: ['or', 'noir'] }
// (1 fitted, 0 owned but stowed, absent: not owned; `finish` is the one worn, `finishes` those paid for).

const GUNS = ['pistol', 'smg', 'shotgun', 'rifle'];

// How far a shot carries (metres): pedestrians who panic, traffic that flees, the officer who hears it, the birds that
// scatter, the crew alerted when one of theirs is hit. `witnesses`: a panicking street calls the police
const LOUD = Object.freeze({ panic: 45, flee: 40, police: 90, birds: 45, alert: 70, witnesses: true });
const QUIET = Object.freeze({ panic: 10, flee: 8, police: 25, birds: 12, alert: 25, witnesses: false });

const AIM_FOV = { rifle: 40, shotgun: 46 }; // the lens behind the sights (degrees), 44 for everything else

const MODS = {
  mag: {
    id: 'mag', slot: 'magazine',
    names: { pistol: 'CHARGEUR ÉTENDU', smg: 'CHARGEUR ÉTENDU', shotgun: 'TUBE RALLONGÉ', rifle: 'CHARGEUR ÉTENDU' },
    sub: { pistol: '18 coups au lieu de 12', smg: '45 coups au lieu de 30', shotgun: '8 cartouches au lieu de 6', rifle: '45 coups au lieu de 30' },
    price: { pistol: 450, smg: 700, shotgun: 800, rifle: 950 },
    capacity: { pistol: 18, smg: 45, shotgun: 8, rifle: 45 }
  },
  suppressor: {
    id: 'suppressor', slot: 'muzzle',
    names: { pistol: 'SILENCIEUX', smg: 'SILENCIEUX', rifle: 'SILENCIEUX' },
    sub: { pistol: 'La rue n’entend plus rien · dégâts et portée en baisse', smg: 'La rue n’entend plus rien · dégâts et portée en baisse',
      rifle: 'La rue n’entend plus rien · dégâts et portée en baisse' },
    price: { pistol: 1200, smg: 1600, rifle: 2400 },
    damage: 0.92, range: 0.85, flash: 0.15
  },
  grip: {
    id: 'grip', slot: 'underbarrel',
    names: { smg: 'POIGNÉE AVANT', shotgun: 'POIGNÉE AVANT', rifle: 'POIGNÉE AVANT' },
    sub: { smg: 'Recul maîtrisé, rafales plus serrées', shotgun: 'Recul maîtrisé, tir à la hanche plus serré', rifle: 'Recul maîtrisé, rafales plus serrées' },
    price: { smg: 900, shotgun: 1000, rifle: 1200 },
    recoil: 0.65, bloom: 0.7, hip: 0.85
  },
  sight: {
    id: 'sight', slot: 'optic',
    names: { pistol: 'POINT ROUGE', smg: 'POINT ROUGE', rifle: 'LUNETTE ×3' },
    sub: { pistol: 'Visée plus précise, plus vite retrouvée', smg: 'Visée plus précise, plus vite retrouvée', rifle: 'Grossissement ×3, visée bien plus précise' },
    price: { pistol: 800, smg: 1100, rifle: 2600 },
    aimed: 0.6, recovery: 1.25, driveBy: 0.8, aimFov: { pistol: 41, smg: 41, rifle: 27 }
  },
  choke: {
    id: 'choke', slot: 'muzzle',
    names: { shotgun: 'ÉTRANGLEUR' },
    sub: { shotgun: 'Gerbe resserrée, porte plus loin' },
    price: { shotgun: 900 },
    spread: 0.7, reach: 1.25
  }
};
const MOD_ORDER = ['mag', 'suppressor', 'grip', 'sight', 'choke'];

// `paint` covers metal and polymer alike (cerakote); `plating` is real metal laid on the steel. Colours are linear RGB,
// set for the game's daylight (a sunlit street is bright: what reads as sand there is a dark sand on paper);
// `metal` and `rough` are what the finished surface becomes, `keep` how much of the texture's wear shows through.
const FINISHES = [
  { id: 'stock', name: 'D’ORIGINE', price: 0, kind: 'stock', color: [1, 1, 1], metal: 0, rough: 1, keep: 1 },
  { id: 'noir', name: 'NOIR MAT', price: 300, kind: 'paint', color: [0.012, 0.013, 0.015], metal: 0.1, rough: 0.74, keep: 0.55 },
  { id: 'sable', name: 'SABLE', price: 400, kind: 'paint', color: [0.215, 0.158, 0.088], metal: 0.05, rough: 0.7, keep: 0.6 },
  { id: 'olive', name: 'OLIVE', price: 400, kind: 'paint', color: [0.062, 0.071, 0.034], metal: 0.05, rough: 0.72, keep: 0.6 },
  { id: 'nickel', name: 'NICKEL', price: 900, kind: 'plating', color: [0.5, 0.48, 0.45], metal: 1, rough: 0.26, keep: 0.4 },
  { id: 'cuivre', name: 'CUIVRE', price: 1500, kind: 'plating', color: [0.72, 0.29, 0.16], metal: 1, rough: 0.3, keep: 0.45 },
  { id: 'or', name: 'OR', price: 5000, kind: 'plating', color: [0.86, 0.49, 0.1], metal: 1, rough: 0.24, keep: 0.35 }
];
const FINISH_BY_ID = Object.fromEntries(FINISHES.map((f) => [f.id, f]));

const fits = (weaponId, modId) => !!MODS[modId] && Object.hasOwn(MODS[modId].price, weaponId);
const finishById = (id) => FINISH_BY_ID[id] ?? FINISH_BY_ID.stock;

// The upgrades a weapon takes, in the order the counter lists them ([] for fists, grenades, the grapple)
function modsFor(weaponId) {
  return MOD_ORDER.filter((id) => fits(weaponId, id)).map((id) => {
    const m = MODS[id];
    return { id, slot: m.slot, name: m.names[weaponId], sub: m.sub[weaponId], price: m.price[weaponId] };
  });
}

// The upgrades on the weapon right now (owned and not stowed), in catalogue order
function fitted(state) {
  return state ? MOD_ORDER.filter((id) => state[id] === 1) : [];
}

const round = (v, digits = 5) => +v.toFixed(digits);
const cache = new Map();

/**
 * A weapon as it fires with what is fitted on it: WEAPONS[id] with the upgrades applied, plus `handling` (the player's
 * HANDLING entry, upgraded), `suppressed`, `flash` (0..1 strength of the muzzle flash), `aimFov`, `noise` and `fitted`
 * (the ids of the upgrades counted).
 * One object per weapon and set of upgrades: nothing is allocated while playing.
 */
function effectiveWeapon(weaponId, state) {
  const base = WEAPONS[weaponId] ?? WEAPONS.fists;
  const on = fitted(state).filter((id) => fits(base.id, id));
  const key = `${base.id}|${on.join('+')}`;
  let spec = cache.get(key);
  if (spec) return spec;
  const stock = HANDLING[base.id] ?? null;
  spec = { ...base, handling: stock, suppressed: false, flash: 1, aimFov: AIM_FOV[base.id] ?? 44, noise: LOUD, fitted: on };
  if (on.length) {
    const h = spec.handling = { ...stock };
    for (const id of on) {
      const m = MODS[id];
      if (id === 'mag') spec.mag = m.capacity[base.id];
      else if (id === 'suppressor') {
        spec.suppressed = true;
        spec.sound = `${base.sound}Suppressed`;
        spec.flash = m.flash;
        spec.noise = QUIET;
        spec.damage = round(base.damage * m.damage, 2);
        spec.range = round(spec.range * m.range, 1);
        h.falloff = round(h.falloff * m.range, 2);
      } else if (id === 'grip') {
        spec.recoil = round(base.recoil * m.recoil);
        h.bloom = round(h.bloom * m.bloom);
        h.hip = round(h.hip * m.hip);
      } else if (id === 'sight') {
        h.aimed = round(h.aimed * m.aimed);
        h.recovery = round(h.recovery * m.recovery);
        spec.spread = round(base.spread * m.driveBy);
        spec.aimFov = m.aimFov[base.id];
      } else if (id === 'choke') {
        h.aimed = round(h.aimed * m.spread);
        h.hip = round(h.hip * m.spread);
        spec.spread = round(base.spread * m.spread);
        h.falloff = round(h.falloff * m.reach, 2);
        spec.range = round(spec.range * m.reach, 1);
      }
    }
    Object.freeze(h);
  }
  Object.freeze(on);
  cache.set(key, Object.freeze(spec));
  return spec;
}

// The player's handling of a weapon with what is fitted on it (null for what has none: fists, grenades, the grapple)
function effectiveHandling(weaponId, state) {
  return effectiveWeapon(weaponId, state).handling;
}

const unit = (v) => Math.min(1, Math.max(0, v));

/**
 * What the counter draws: six bars in 0..1 on scales shared by every weapon, so a pistol compares with a rifle and an
 * upgrade shows as the difference between two calls (weaponBars(id, state) against weaponBars(id, withMod(state, mod))).
 */
function weaponBars(weaponId, state) {
  const w = effectiveWeapon(weaponId, state), h = w.handling;
  if (!h) return { damage: 0, rate: 0, accuracy: 0, range: 0, control: 0, capacity: 0 };
  const aimed = 1 - Math.log(h.aimed / 0.001) / Math.log(60);
  const hip = 1 - Math.log(h.hip / 0.01) / Math.log(8);
  return {
    damage: unit(Math.sqrt(w.damage * (w.pellets || 1) / 150)),
    rate: unit(1 / w.interval / 13),
    accuracy: unit(0.7 * aimed + 0.3 * hip),
    range: unit((h.falloff + w.range) / 400),
    control: unit(1 - 0.75 * Math.sqrt(w.recoil / 0.08) - 0.25 * Math.sqrt(h.bloom / 0.01) + 0.04 * (h.recovery / 5 - 1)),
    capacity: unit(w.mag / 45)
  };
}

// The same ownership with one upgrade fitted (or taken off): a new object, for previews and for the game alike.
// Taking off what is not owned changes nothing.
function withMod(state, modId, on = true) {
  const next = { ...state };
  if (!MODS[modId]) return next;
  if (on) next[modId] = 1;
  else if (modId in next) next[modId] = 0;
  return next;
}

// A saved `mods` table read back: unknown weapons, upgrades that do not fit and unknown finishes are dropped
function sanitizeMods(data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  for (const id of GUNS) {
    const saved = data[id];
    if (!saved || typeof saved !== 'object') continue;
    const state = {};
    for (const mod of MOD_ORDER) if (fits(id, mod) && (saved[mod] === 0 || saved[mod] === 1)) state[mod] = saved[mod];
    const owned = Array.isArray(saved.finishes) ? [...new Set(saved.finishes)].filter((f) => f !== 'stock' && FINISH_BY_ID[f]) : [];
    if (owned.length) state.finishes = owned;
    if (owned.includes(saved.finish)) state.finish = saved.finish;
    if (Object.keys(state).length) out[id] = state;
  }
  return out;
}

export { MODS, MOD_ORDER, FINISHES, GUNS as MOD_GUNS, fits, finishById, modsFor, fitted, effectiveWeapon, effectiveHandling, weaponBars, withMod, sanitizeMods };
