// The surveyed wall is the reference plane. Offsets run from its first vertex towards its second.
const PROFILES = {
  rowhouse:    { family: 'brownstone', entry: 1.18, spacing: 45, pier: 0.54, glazing: 0.48, sill: 0.92 },
  tenement:    { family: 'walkup',     entry: 1.48, spacing: 38, pier: 0.60, glazing: 0.50, sill: 0.83 },
  prewar:      { family: 'stone',      entry: 1.86, spacing: 46, pier: 0.68, glazing: 0.53, sill: 0.77 },
  deco:        { family: 'deco',       entry: 2.24, spacing: 60, pier: 0.76, glazing: 0.57, sill: 0.59 },
  loft:        { family: 'iron',       entry: 2.03, spacing: 44, pier: 0.58, glazing: 0.77, sill: 0.52 },
  commercial:  { family: 'stone',      entry: 2.21, spacing: 52, pier: 0.76, glazing: 0.67, sill: 0.61 },
  civic:       { family: 'stone',      entry: 2.35, spacing: 65, pier: 0.85, glazing: 0.57, sill: 0.91 },
  postwar:     { family: 'estate',     entry: 1.97, spacing: 39, pier: 0.76, glazing: 0.56, sill: 0.72 },
  midcentury:  { family: 'lobby',      entry: 3.45, spacing: 56, pier: 0.66, glazing: 0.78, sill: 0.32 },
  glass:       { family: 'lobby',      entry: 4.05, spacing: 64, pier: 0.66, glazing: 0.84, sill: 0.24 },
  contemporary:{ family: 'lobby',      entry: 3.02, spacing: 53, pier: 0.65, glazing: 0.76, sill: 0.32 },
  utility:     { family: 'service',    entry: 2.75, spacing: 32, pier: 0.69, glazing: 0.35, sill: 1.25 }
};

function wallPoint(wall, s, depth = 0) {
  return { x: wall.ax + wall.ux * s + wall.nx * depth, z: wall.az + wall.uz * s + wall.nz * depth };
}

function planFrontages(style, walls, isClear, roadDistance) {
  const p = PROFILES[style.type];
  if (!p) return [];
  const open = walls.flatMap(wall => {
    if (wall.width < 2.9 || wall.top < 2.85 || wall.shop) return [];
    const mid = wall.width / 2;
    if (![0.2, 0.5, 0.8].some(f => isClear(wall, f * wall.width, 1.1))) return [];
    const centre = wallPoint(wall, mid), approach = wallPoint(wall, mid, 7);
    const d = wall.court ? 70 : roadDistance(centre), ahead = wall.court ? 70 : roadDistance(approach);
    const facesStreet = d < 43 && d - ahead > 3.0;
    // Long secondary walls on freestanding estates can also have an entrance; narrow houses have one street door.
    const score = (facesStreet ? 44 - d : 0) + Math.min(wall.width, 26) * 0.42 - (wall.court ? 40 : 0);
    return [{ wall, facesStreet, score, d }];
  });
  const primary = open.reduce((a, b) => !b.wall.court && (!a || b.score > a.score) ? b : a, null);
  const residential = ['brownstone', 'walkup', 'estate', 'stone'].includes(p.family);
  return open.map(front => {
    const { wall, facesStreet } = front;
    const { width, top } = wall;
    const bottom = wall.bottom;
    const ceiling = Math.min(top - 0.23, style.floor - 0.14);
    const pier = Math.min(1.2, width * 0.2);
    const inner = width - pier * 2;
    const bays = Math.max(1, Math.min(34, Math.round(inner / Math.max(1.9, style.bay, p.family === 'lobby' ? 3.25 : 0))));
    const bay = inner / bays;
    const seed = (Math.imul(Math.round((wall.ax + wall.bx) * 10), 73856093) ^ Math.imul(Math.round((wall.az + wall.bz) * 10), 19349663)) >>> 0;
    const allowed = front === primary || (!wall.court && width >= (p.family === 'brownstone' ? Infinity : 15) &&
      (facesStreet || p.family === 'estate' || p.family === 'lobby' || width >= 30));
    const entries = new Map();
    const nearCurb = facesStreet && front.d < 10;
    if (allowed && ceiling - bottom >= 2.35) {
      const count = Math.max(1, Math.round(width / p.spacing));
      const span = p.entry + 0.24 > bay && bays > 2 && p.family !== 'brownstone' ? 2 : 1;
      for (let i = 0; i < count; i++) {
        let cell = Math.round((i + 0.5) * bays / count - span / 2);
        if (p.family === 'brownstone' && bays > 1) cell = (seed & 1) ? 0 : bays - 1;
        cell = Math.min(bays - span, Math.max(0, cell));
        const mid = pier + (cell + span / 2) * bay;
        const entryWidth = Math.min(p.entry * (0.94 + ((seed >>> 4) % 9) * 0.015), bay * span - 0.26);
        const lo = mid - entryWidth / 2, hi = mid + entryWidth / 2;
        if (entryWidth < 0.99 || ![lo + 0.1, mid, hi - 0.1].every(s => isClear(wall, s, 1.2))) continue;
        if (Array.from({ length: span }, (_, j) => cell + j).some(k => entries.has(k))) continue;
        const height = Math.min(ceiling, bottom + (p.family === 'lobby' ? 4.35 : p.family === 'service' ? 3.55 : 3.42));
        entries.set(cell, { type: 'entry', lo, hi, y0: bottom, y1: height,
          recess: p.family === 'lobby' ? 0.64 : 0.42 + ((seed >>> 8) % 5) * 0.045,
          arched: p.family === 'brownstone' || (p.family === 'walkup' && (seed & 2) !== 0) ||
            (p.family === 'stone' && height - bottom > 2.7 && seed % 3 === 0) });
        for (let j = 1; j < span; j++) entries.set(cell + j, null);
      }
    }
    const openings = [];
    for (let i = 0; i < bays; i++) {
      if (entries.has(i)) {
        if (entries.get(i)) openings.push(entries.get(i));
        continue;
      }
      if (p.family === 'service' && i % 2 !== seed % 2) continue;
      // Keep a few solid utility bays in long residential blocks instead of a continuous strip of glazing.
      if (p.family === 'estate' && bays > 4 && (i + seed) % 7 === 0) continue;
      const mid = pier + (i + 0.5) * bay;
      if (!isClear(wall, mid, 0.85)) continue;
      const half = Math.min((bay - 0.24) / 2, bay * p.glazing * (wall.court ? 0.42 : 0.5));
      const y0 = bottom + p.sill;
      if (half < 0.28 || ceiling - y0 < 0.72) continue;
      openings.push({ type: 'window', lo: mid - half, hi: mid + half, y0,
        y1: ceiling - (p.family === 'lobby' ? 0.03 : 0.19), recess: p.family === 'lobby' ? 0.21 : 0.19,
        grille: residential && p.family !== 'stone' && (wall.court || (seed + i) % (p.family === 'estate' ? 3 : 2) === 0) });
    }
    return { wall, profile: p, openings, seed, ceiling, facesStreet, nearCurb };
  });
}

// Split only across the ground storey. One large quad above it keeps the upper facade's vertex count independent of bays.
function frontagePanels(width, bottom, top, openings) {
  if (!openings.length) return [[0, width, bottom, top]];
  const cap = Math.max(...openings.map(o => o.y1));
  const panels = [[0, width, cap, top]];
  let cursor = 0;
  for (const { lo, hi, y0, y1 } of openings) {
    panels.push([cursor, lo, bottom, cap], [lo, hi, bottom, y0], [lo, hi, y1, cap]);
    cursor = hi;
  }
  panels.push([cursor, width, bottom, cap]);
  return panels.filter(([lo, hi, y0, y1]) => hi - lo > 0.001 && y1 - y0 > 0.001);
}

export { planFrontages, frontagePanels, wallPoint };
