// What kind of building each surveyed footprint is, and how it is dressed: the facade grammar the city shaders draw
// (window rhythm, proportions and glazing bars, stone base, belt courses, colours) and the pieces buildings.js adds
// (cornice, water tower, fire escapes). The kind comes from the building's lot in PLUTO (class, floors, year built,
// historic district), its height and what mappers recorded of it; the dress is chosen from the kind's real palette,
// the same for a building every time.

// Average colour (linear) of each wall photograph in assets/world, so a colour asked for becomes a tint over it
const PHOTO_AVERAGE = {
  limestone: [0.249, 0.215, 0.157],
  redbrick: [0.145, 0.088, 0.071],
  brownbrick: [0.353, 0.230, 0.164],
  buffbrick: [0.471, 0.284, 0.140]
};
const SURFACES = Object.keys(PHOTO_AVERAGE);

const linear = (hex) => [hex >> 16, (hex >> 8) & 255, hex & 255].map((c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

// Real New York masonry, by family (sRGB)
const COLOURS = {
  red: [0x8a4636, 0x96523f, 0x7a3c30, 0xa25a44, 0x844a3c, 0x6e3a30, 0x9a4a3a],
  brown: [0x6e4c3a, 0x5e4234, 0x7c5a46, 0x8a6650, 0x664638],
  tan: [0xc0a07a, 0xb4946c, 0xccb08a, 0xa8885e, 0xc6aa7c, 0xd4bc94, 0xbc9a70],
  white: [0xd2cec4, 0xc8c4ba, 0xbab6ac, 0xd8d4ca, 0xc4beb2],
  grey: [0x8a8886, 0x75726e, 0x9c9894, 0x5e5c5a, 0x6c6864],
  lime: [0xcbc2ae, 0xc2b8a0, 0xd2cab7, 0xb6ac90, 0xaea58c],
  brownstone: [0x5c3e30, 0x684636, 0x4c3428, 0x74513e, 0x58402f],
  paint: [0xdcd4c0, 0xb0aea6, 0x5c6a56, 0x8e8270, 0xe8e4da, 0x6a5e52, 0x9aa09a]
};
// Window frames, by index in the shader's palette
const FRAMES = [0x1c1d1e, 0xe6e4de, 0x22362a, 0x4a3428, 0xa4a8ac, 0x3c3026, 0xd6ceb6, 0x5e6062];
const FRAME = { black: 0, white: 1, green: 2, brown: 3, aluminium: 4, bronze: 5, cream: 6, grey: 7 };
// Curtain walls: glass and metal
const GLASS = {
  blue: 0x2a4a66, teal: 0x2a5258, silver: 0x5a6670, green: 0x34504a, bronze: 0x3a3228, dark: 0x1e2226, ice: 0x4a6a84, grey: 0x3e464c
};
const METAL = { silver: 0xb0b8c0, grey: 0x6a7078, black: 0x24262a, bronze: 0x4a3c30, white: 0xd8dade, enamel: 0x9aa4a8 };

// Glazing, as the shader draws it
const WINDOW = { oneOverOne: 0, twoOverTwo: 1, sixOverSix: 2, arched: 3, paired: 4, loft: 5, ribbon: 6, casement: 7 };
// Facade flags (sum): corner quoins, smaller attic windows under the roof, window air conditioners, office lighting,
// dark spandrels between the windows of a column (the vertical lines of Art Deco)
const FLAG = { quoins: 1, attic: 2, ac: 4, office: 8, spandrel: 16 };
// Curtain-wall banding
const BAND = { grid: 0, ribbon: 1, fins: 2 };

const TYPES = [
  { id: 'rowhouse', label: 'Maison de ville' },
  { id: 'tenement', label: 'Immeuble ouvrier' },
  { id: 'prewar', label: "Immeuble d'avant-guerre" },
  { id: 'loft', label: 'Loft à façade de fonte' },
  { id: 'commercial', label: 'Immeuble de bureaux ancien' },
  { id: 'deco', label: 'Tour Art déco' },
  { id: 'postwar', label: "Immeuble d'après-guerre" },
  { id: 'midcentury', label: 'Bureaux des années 1960' },
  { id: 'glass', label: 'Tour de verre' },
  { id: 'contemporary', label: 'Immeuble contemporain' },
  { id: 'civic', label: 'Bâtiment public' },
  { id: 'utility', label: 'Garage et entrepôt' }
];
const TYPE_INDEX = Object.fromEntries(TYPES.map((t, i) => [t.id, i]));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length) % list.length];
// [weight, value] pairs
function weighted(rand, pairs) {
  const total = pairs.reduce((n, [w]) => n + w, 0);
  let r = rand() * total;
  for (const [w, v] of pairs) if ((r -= w) < 0) return v;
  return pairs[pairs.length - 1][1];
}
const range = (rand, a, b) => a + (b - a) * rand();

const LOFT_DISTRICT = /SoHo|Tribeca|NoHo|Ladies' Mile|Madison Square North|Gansevoort|Seaport|Stone Street|West Chelsea/;
const ROWHOUSE_DISTRICT = /Upper West Side|Upper East Side|Harlem|Mount Morris|Hamilton|Carnegie|Treadwell|Riverside|Chelsea|Greenwich|Gramercy|Murray Hill|St\. Mark|Stuyvesant|Sugar Hill|Jumel|St\. Nicholas|Dorrance|West End|West 71st|Central Park West|Manhattan Avenue|Charlton|MacDougal|Sullivan|South Village|Turtle Bay|Henderson|Lamartine|Sniffen|Hardenbergh|East 10th|East 17th/;

// Frontage of a footprint: its area over its longest wall, about the width of a row house's lot
function frontage(b) {
  let area = 0, longest = 1;
  for (const { outer } of b.polygons) {
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], c = outer[(i + 1) % outer.length];
      area += a.x * c.z - c.x * a.z;
      longest = Math.max(longest, Math.hypot(c.x - a.x, c.z - a.z));
    }
  }
  return Math.abs(area) / 2 / longest;
}

function classify(b, f) {
  const L = f.cls[0] || '', d = f.cls[1] || '';
  const year = f.year || b.year || 0;
  const H = b.height;
  const floors = f.floors || Math.max(1, Math.round(H / 3.4));
  if (f.material === 'glass') return year && year < 1985 ? 'midcentury' : 'glass';
  if ('MWIPJNQ'.includes(L) && L) return 'civic';
  if (L === 'Y') return H > 45 && year >= 1950 ? 'midcentury' : 'civic';
  if ('GTUZV'.includes(L) && L) return 'utility';
  if (L === 'E' || L === 'F' || L === 'L') return year && year < 1935 ? 'loft' : 'utility';
  const office = L === 'O' || L === 'H' || (L === 'K' && floors >= 4);
  const residential = 'ABCDRS'.includes(L) && L;
  if (office || (!residential && H > 30)) {
    if (year >= 1985 || (!year && H > 120)) return 'glass';
    if (year >= 1950) return 'midcentury';
    if (H > 70 && year >= 1916) return 'deco';
    if (LOFT_DISTRICT.test(f.district) && year < 1915 && floors <= 12) return 'loft';
    return 'commercial';
  }
  if (L === 'K') return LOFT_DISTRICT.test(f.district) && year && year < 1915 ? 'loft' : year >= 1985 ? 'contemporary' : 'tenement';
  // Homes
  if (year >= 1985) return H > 60 && (L === 'R' || L === 'D') ? (b.cx % 7 > 2.5 ? 'glass' : 'contemporary') : 'contemporary';
  if (year >= 1946) return 'postwar';
  if (LOFT_DISTRICT.test(f.district) && floors <= 9 && year < 1915 && L !== 'A' && L !== 'B') return 'loft';
  const small = floors <= 5 && (L === 'A' || L === 'B' || (L === 'C' && '0135'.includes(d)) || (L === 'S' && '123'.includes(d)));
  if (small && frontage(b) < 11) return 'rowhouse';
  if (floors <= 7 && H < 28) return 'tenement';
  if (H > 90 && year >= 1916) return 'deco';
  return 'prewar';
}

// The dress: everything the facade shaders and the details need, a pure function of the building
function dressBuilding(b, f, estateBrick = false) {
  const type = estateBrick ? 'postwar' : classify(b, f);
  const rand = mulberry32(Math.round(b.cx * 31 + b.cz * 17) ^ 0x5bd1e995);
  const year = f.year || b.year || 0;
  const s = {
    type, typeIndex: TYPE_INDEX[type], glass: false, surface: 'redbrick', wall: 0, trim: 0, frame: FRAME.black,
    window: WINDOW.oneOverOne, bay: 2.4, floor: 3.4, ratioX: 0.5, ratioY: 0.58, baseFloors: 0, belt: 0, flags: 0,
    cornice: 'none', waterTower: 0, fireEscape: false, lit: 0.55, warmth: 0.82, seed: rand() * 997,
    glassColour: 0, metalColour: 0, spandrel: 0.2, reflectivity: 0.9, mullion: 0.07, band: BAND.grid,
    // Flat roofs: tar, silver coating, gravel ballast, brown membrane
    roof: weighted(rand, [[5, 0x2c2c2e], [4, 0x76787c], [2, 0x5c5852], [1, 0x6a5e50]])
  };
  // A brick family on its own photograph
  const brick = (pairs) => {
    const family = weighted(rand, pairs);
    s.surface = family === 'red' ? 'redbrick' : family === 'brown' ? 'brownbrick' : family === 'lime' || family === 'brownstone' || family === 'paint' ? 'limestone' : 'buffbrick';
    s.wall = pick(rand, COLOURS[family]);
    return family;
  };
  switch (type) {
    case 'rowhouse': {
      const brownstone = year && year < 1860 && /Greenwich|Charlton|St\. Mark|MacDougal|Sullivan/.test(f.district) ? 0.15
        : ROWHOUSE_DISTRICT.test(f.district) || (year >= 1860 && year < 1905) ? 0.6 : 0.35;
      const family = brick([[brownstone, 'brownstone'], [0.32, 'red'], [0.08, 'brown'], [0.06, 'lime'], [0.04, 'paint']]);
      const bays = Math.max(2, Math.min(4, Math.round(frontage(b) / 2.3)));
      s.bay = Math.max(1.7, Math.min(2.6, frontage(b) / bays));
      s.floor = 3.5; s.ratioX = 0.5; s.ratioY = 0.64;
      s.window = weighted(rand, [[4, WINDOW.oneOverOne], [3, WINDOW.twoOverTwo], [year && year < 1870 ? 4 : 1, WINDOW.sixOverSix], [1, WINDOW.arched]]);
      s.trim = family === 'brownstone' ? pick(rand, COLOURS.brownstone) : pick(rand, [...COLOURS.lime, ...COLOURS.brownstone]);
      s.baseFloors = family === 'brownstone' ? 0 : rand() < 0.4 ? 1 : 0;
      s.frame = pick(rand, [FRAME.black, FRAME.black, FRAME.white, FRAME.green, FRAME.brown, FRAME.cream]);
      s.cornice = 'metal'; s.lit = 0.62; s.warmth = 0.9;
      break;
    }
    case 'tenement': {
      brick([[0.42, 'red'], [0.26, 'brown'], [0.2, 'tan'], [0.08, 'paint'], [0.04, 'lime']]);
      s.bay = range(rand, 1.9, 2.3); s.floor = 3.15; s.ratioX = 0.46; s.ratioY = 0.6;
      s.window = weighted(rand, [[5, WINDOW.oneOverOne], [2, WINDOW.twoOverTwo], [3, WINDOW.arched]]);
      s.trim = pick(rand, [...COLOURS.lime, ...COLOURS.lime, ...COLOURS.white, 0xe8e4da, 0xdcd6c8, ...COLOURS.brownstone.slice(0, 2)]);
      s.frame = pick(rand, [FRAME.black, FRAME.white, FRAME.white, FRAME.aluminium, FRAME.brown, FRAME.green]);
      s.flags = FLAG.ac | (rand() < 0.15 ? FLAG.quoins : 0);
      s.cornice = rand() < 0.9 ? 'metal' : 'none'; s.fireEscape = true; s.waterTower = b.height > 16 ? 0.35 : 0;
      s.lit = 0.6; s.warmth = 0.88;
      break;
    }
    case 'prewar': {
      brick([[0.34, 'tan'], [0.24, 'red'], [0.22, 'brown'], [0.12, 'lime'], [0.08, 'white']]);
      s.bay = range(rand, 2.3, 2.8); s.floor = 3.3; s.ratioX = 0.5; s.ratioY = 0.58;
      s.window = weighted(rand, [[4, WINDOW.sixOverSix], [3, WINDOW.oneOverOne], [2, WINDOW.paired], [1, WINDOW.arched]]);
      s.trim = pick(rand, COLOURS.lime);
      s.baseFloors = Math.min(3, Math.max(1, Math.round(range(rand, 1, 3.4))));
      s.belt = rand() < 0.4 ? Math.round(range(rand, 4, 8)) : 0;
      s.frame = pick(rand, [FRAME.white, FRAME.black, FRAME.green, FRAME.cream, FRAME.brown]);
      s.flags = (rand() < 0.35 ? FLAG.quoins : 0) | (rand() < 0.6 ? FLAG.attic : 0) | FLAG.ac;
      s.cornice = rand() < 0.72 ? 'stone' : 'none'; s.waterTower = 0.6; s.fireEscape = rand() < 0.5;
      s.lit = 0.58; s.warmth = 0.86;
      break;
    }
    case 'loft': {
      const family = brick([[0.5, 'paint'], [0.22, 'red'], [0.14, 'brown'], [0.14, 'lime']]);
      const iron = family === 'paint';
      s.bay = range(rand, 3.0, 3.8); s.floor = 4.3; s.ratioX = iron ? 0.76 : 0.6; s.ratioY = iron ? 0.7 : 0.64;
      s.window = iron ? WINDOW.loft : weighted(rand, [[3, WINDOW.arched], [2, WINDOW.twoOverTwo], [2, WINDOW.loft]]);
      s.trim = iron ? s.wall : pick(rand, COLOURS.lime);
      s.baseFloors = 1; s.belt = iron ? 1 : 0;
      s.frame = pick(rand, [FRAME.black, FRAME.green, FRAME.white, FRAME.brown]);
      s.cornice = rand() < 0.8 ? 'metal' : 'none'; s.fireEscape = rand() < 0.6; s.waterTower = 0.45;
      s.lit = 0.5; s.warmth = 0.74;
      break;
    }
    case 'commercial': {
      brick([[0.4, 'lime'], [0.3, 'tan'], [0.15, 'red'], [0.15, 'brown']]);
      s.bay = range(rand, 2.2, 2.8); s.floor = 3.8; s.ratioX = 0.54; s.ratioY = 0.6;
      s.window = weighted(rand, [[4, WINDOW.paired], [4, WINDOW.oneOverOne], [2, WINDOW.twoOverTwo], [1, WINDOW.arched]]);
      s.trim = pick(rand, COLOURS.lime);
      s.baseFloors = Math.round(range(rand, 1.6, 3.4));
      s.belt = rand() < 0.3 ? Math.round(range(rand, 5, 9)) : 0;
      s.frame = pick(rand, [FRAME.black, FRAME.bronze, FRAME.white, FRAME.grey]);
      s.flags = FLAG.office | (rand() < 0.5 ? FLAG.attic : 0) | (rand() < 0.25 ? FLAG.quoins : 0);
      s.cornice = rand() < 0.75 ? 'stone' : 'none'; s.waterTower = 0.4;
      s.lit = 0.56; s.warmth = 0.62;
      break;
    }
    case 'deco': {
      brick([[0.55, 'tan'], [0.28, 'lime'], [0.17, 'grey']]);
      s.bay = range(rand, 1.6, 2.0); s.floor = 3.6; s.ratioX = 0.56; s.ratioY = 0.62;
      s.window = rand() < 0.6 ? WINDOW.oneOverOne : WINDOW.twoOverTwo;
      s.trim = pick(rand, COLOURS.lime);
      s.baseFloors = Math.round(range(rand, 2.6, 5.4));
      s.frame = pick(rand, [FRAME.bronze, FRAME.black, FRAME.grey]);
      s.flags = FLAG.office | FLAG.spandrel;
      s.lit = 0.58; s.warmth = 0.6;
      break;
    }
    case 'postwar': {
      const family = brick([[0.48, 'white'], [0.3, 'red'], [0.12, 'tan'], [0.1, 'grey']]);
      s.bay = range(rand, 2.6, 3.3); s.floor = 2.85; s.ratioX = 0.66; s.ratioY = 0.5;
      s.window = rand() < 0.6 ? WINDOW.ribbon : WINDOW.casement;
      s.trim = family === 'white' ? pick(rand, COLOURS.white) : pick(rand, [...COLOURS.lime, ...COLOURS.white]);
      s.baseFloors = rand() < 0.4 ? 1 : 0;
      s.frame = pick(rand, [FRAME.aluminium, FRAME.aluminium, FRAME.white, FRAME.grey]);
      s.flags = FLAG.ac;
      s.lit = 0.6; s.warmth = 0.8;
      break;
    }
    case 'midcentury': {
      s.glass = true;
      s.glassColour = GLASS[pick(rand, ['dark', 'green', 'bronze', 'grey', 'teal', 'blue'])];
      s.metalColour = METAL[pick(rand, ['silver', 'enamel', 'white', 'grey', 'black', 'bronze'])];
      s.bay = range(rand, 1.4, 1.8); s.floor = 3.8; s.spandrel = range(rand, 0.32, 0.46); s.band = BAND.ribbon;
      s.mullion = 0.05; s.reflectivity = range(rand, 0.55, 0.8);
      s.lit = 0.6; s.warmth = 0.5; s.roof = 0x5a5c60;
      break;
    }
    case 'glass': {
      s.glass = true;
      s.glassColour = GLASS[pick(rand, ['blue', 'teal', 'silver', 'green', 'ice', 'grey', 'dark'])];
      s.metalColour = METAL[pick(rand, ['silver', 'silver', 'grey', 'black', 'white'])];
      s.bay = range(rand, 1.5, 3.0); s.floor = range(rand, 3.8, 4.2); s.spandrel = range(rand, 0.1, 0.24);
      s.band = rand() < 0.25 ? BAND.fins : BAND.grid; s.mullion = range(rand, 0.05, 0.09); s.reflectivity = range(rand, 0.85, 0.96);
      s.lit = 0.6; s.warmth = 0.5; s.roof = 0x4a4c50;
      break;
    }
    case 'contemporary': {
      brick([[0.3, 'grey'], [0.25, 'red'], [0.2, 'white'], [0.15, 'brown'], [0.1, 'lime']]);
      s.bay = range(rand, 2.4, 3.4); s.floor = 3.1; s.ratioX = 0.72; s.ratioY = 0.7;
      s.window = WINDOW.casement;
      s.trim = pick(rand, [...COLOURS.grey, ...COLOURS.white]);
      s.baseFloors = rand() < 0.5 ? 1 : 2;
      s.frame = pick(rand, [FRAME.black, FRAME.grey, FRAME.black, FRAME.aluminium]);
      s.lit = 0.55; s.warmth = 0.78;
      break;
    }
    case 'civic': {
      brick([[0.5, 'lime'], [0.3, 'red'], [0.2, 'brown']]);
      s.bay = range(rand, 2.8, 3.6); s.floor = 4.6; s.ratioX = 0.5; s.ratioY = 0.66;
      s.window = rand() < 0.5 ? WINDOW.arched : WINDOW.twoOverTwo;
      s.trim = pick(rand, COLOURS.lime);
      s.baseFloors = 1;
      s.frame = pick(rand, [FRAME.black, FRAME.green, FRAME.white, FRAME.brown]);
      s.flags = FLAG.office | (rand() < 0.3 ? FLAG.quoins : 0);
      s.cornice = rand() < 0.6 ? 'stone' : 'none';
      s.lit = 0.4; s.warmth = 0.66;
      break;
    }
    default: {
      brick([[0.4, 'red'], [0.25, 'brown'], [0.2, 'grey'], [0.15, 'tan']]);
      s.bay = range(rand, 3.2, 4.2); s.floor = 4.0; s.ratioX = 0.6; s.ratioY = 0.42;
      s.window = rand() < 0.5 ? WINDOW.loft : WINDOW.oneOverOne;
      s.trim = pick(rand, [...COLOURS.grey, ...COLOURS.lime]);
      s.frame = pick(rand, [FRAME.grey, FRAME.black, FRAME.green]);
      s.flags = FLAG.office;
      s.cornice = rand() < 0.3 ? 'stone' : 'none';
      s.lit = 0.3; s.warmth = 0.6;
    }
  }
  // Pressed-metal cornices are painted; stone ones are the trim's stone
  s.corniceColour = s.cornice === 'metal' ? pick(rand, [0xd6ceb6, 0xe2ded4, 0xcfc8b8, 0x2e4434, 0x5a4232, 0x7a7c7a, 0xe8e6e0, 0x8a8478]) : s.trim;
  // What mappers saw wins over the palette: the colour of the building, a glass facade
  if (estateBrick) {
    s.surface = 'redbrick';
    s.wall = pick(rand, [0x78483b, 0x805043, 0x8e5746]);
    s.trim = 0x9c806c;
    s.window = WINDOW.twoOverTwo;
    s.bay = 2.62;
    s.ratioX = 0.46;
    s.ratioY = 0.59;
    s.baseFloors = 0;
    s.frame = FRAME.cream;
  } else if (f.colour >= 0 && !s.glass) {
    const [r, g, bl] = [f.colour >> 16, (f.colour >> 8) & 255, f.colour & 255];
    if (Math.max(r, g, bl) > 40) s.wall = f.colour;
  }
  // Short buildings keep their floors whole: the storey height divides the height into the floors PLUTO counts
  if (f.floors >= 2 && !s.glass) {
    const storey = (b.height - 0.5) / f.floors;
    if (storey > 2.7 && storey < 5.2) s.floor = Math.round(storey * 100) / 100;
  }
  return s;
}

// The wall photograph's tint that paints it the colour asked for
function tintFor(surface, hex) {
  const target = linear(hex), avg = PHOTO_AVERAGE[surface];
  return target.map((c, i) => c / avg[i]);
}

// Sixteen floats per wall vertex (four vec4s the facade shaders read as facadeStyle0..3)
function styleAttributes(s) {
  if (s.glass) {
    const g = linear(s.glassColour), m = linear(s.metalColour);
    return [s.typeIndex, s.bay, s.floor, s.seed, g[0], g[1], g[2], s.spandrel, m[0], m[1], m[2], s.reflectivity,
      s.mullion, s.band, s.lit, s.warmth];
  }
  const wall = tintFor(s.surface, s.wall), trim = linear(s.trim);
  return [s.typeIndex, s.bay, s.floor, s.seed, wall[0], wall[1], wall[2], s.window, trim[0], trim[1], trim[2],
    s.flags + 32 * s.frame, s.ratioX, s.ratioY, s.baseFloors, s.belt];
}

// Every window opening of a building's street walls (record.kitWalls, from building-footprints.js), laid out as the
// facade shader lays them (corner piers, evenly spread bays, whole storeys, attic): centre on the wall plane, size,
// outward normal, storey
function windowsOf(record) {
  const s = record.style, out = [];
  if (!s || s.glass || !record.kitWalls) return out;
  const fh = s.floor, hx = (1 - s.ratioX) / 2;
  for (const w of record.kitWalls) {
    // The shader's corner piers and evenly spread bays
    const pier = Math.min(1.2, w.width * 0.2), inner = w.width - 2 * pier;
    if (inner < 0.6) continue;
    const bays = Math.max(Math.floor(inner / s.bay + 0.5), 1), bayW = inner / bays;
    const ux = (w.bx - w.ax) / w.width, uz = (w.bz - w.az) / w.width;
    // Whole storeys only, the ground floor (shops, entrances) excepted
    for (let n = 1; (n + 1) * fh <= w.top + 0.05; n++) {
      const attic = (s.flags & FLAG.attic) && w.top - (n + 1) * fh < fh;
      const hy = attic ? 0.32 : (1 - s.ratioY) / 2;
      const y0 = (n + hy) * fh, y1 = (n + 1 - hy) * fh;
      if (y0 < w.bottom + 0.1) continue;
      for (let k = 0; k < bays; k++) {
        const t = pier + (k + 0.5) * bayW;
        out.push({ x: w.ax + ux * t, z: w.az + uz * t, y0, y1, width: (1 - 2 * hx) * bayW, nx: w.nx, nz: w.nz, n, attic,
          base: n < s.baseFloors });
      }
    }
  }
  return out;
}

export { TYPES, windowsOf, TYPE_INDEX, WINDOW, FLAG, BAND, FRAMES, SURFACES, PHOTO_AVERAGE, classify, dressBuilding, styleAttributes, tintFor, linear };
