// The trees' levels of detail as plain arithmetic (no renderer needed): which model a surveyed tree gets and at what
// size, where each level hands over to the next, and which levels a tree is listed in at a given distance.

// Metres a tree stays listed in a level before and after the material lets it show there: the lists are only redone
// every few metres of camera travel, the material fades every frame
const MARGIN = 8;

/** Where a level hands over to the next (metres), for the graphics level's detail factor (quality.js `trees`) */
function bandsFor(k) {
  return { near: 30 + 14 * k, far: 85 + 40 * k, fade: 6 + 3 * k, reach: k < 0.8 ? 1100 : 1700 };
}

/**
 * The levels a tree `dist` metres away is listed in: bit 1 the full model, bit 2 the light model, bit 4 the impostor.
 * Two bits are set across a handover (the material draws part of each there), none beyond `reach`.
 */
function listing(dist, bands) {
  let bits = 0;
  if (dist < bands.near + MARGIN) bits |= 1;
  if (dist >= bands.near - bands.fade - MARGIN && dist < bands.far + MARGIN) bits |= 2;
  if (dist >= bands.far - bands.fade - MARGIN && dist < bands.reach + MARGIN) bits |= 4;
  return bits;
}

/**
 * Which model a site gets, and at what size. A site is { kind (0..7, the census class), and either dbh (trunk diameter
 * in inches, as surveyed) or scale (1 = a grown park tree) }; `types` lists each kind's grown then young model, each
 * with its own `dbh` in metres. Returns [{ type, scale }] to try in turn: the tree as surveyed first, then smaller,
 * for where the street leaves it less room.
 */
function candidates(site, types) {
  const kind = Math.min(types.length / 2 - 1, Math.max(0, site.kind ?? 0));
  const grown = types[kind * 2], young = types[kind * 2 + 1];
  const diameter = site.dbh > 0 ? site.dbh * 0.0254 : grown.dbh * Math.pow(Math.max(0.3, site.scale ?? 1), 1.5);
  const fit = (type) => Math.min(1.34, Math.max(0.7, Math.pow(diameter / type.dbh, 0.5)));
  const first = Math.abs(Math.log(diameter / grown.dbh)) < Math.abs(Math.log(diameter / young.dbh)) ? grown : young;
  const list = [{ type: first, scale: fit(first) }];
  const smaller = (type, scale) => {
    const last = list[list.length - 1];
    if (type !== last.type || scale < last.scale - 0.03) list.push({ type, scale });
  };
  smaller(first, Math.max(0.7, fit(first) * 0.84));
  if (first === grown) { smaller(young, 1.3); smaller(young, 1.08); }
  smaller(young, 0.88);
  smaller(young, 0.72);
  return list;
}

export { MARGIN, bandsFor, listing, candidates };
