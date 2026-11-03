// Who each shop is: an invented name, the look of its sign, its colours. Pure functions of a shop's type and seed,
// so the same corner always has the same pizzeria. No name belongs to a real business or brand.
import { GLYPHS } from './storefront-glyphs.js';

// ---- Typefaces (order of GLYPHS.fonts) ----------------------------------------------------------------------------------
const F = { oswald: 0, anton: 1, playfair: 2, lobster: 3, bebas: 4, marker: 5, josefin: 6, bitter: 7, monoton: 8, pacifico: 9,
  cinzel: 10, archivo: 11 };
const SCRIPT = new Set([F.lobster, F.pacifico]);

// ---- Sign styles --------------------------------------------------------------------------------------------------------
// box: backlit plastic box; painted: painted board lit by lamps; letters: individual letters on the fascia;
// neon: tubes on a dark board; vinyl: lettering on the glass, plain fascia
const STYLE = { box: 0, painted: 1, letters: 2, neon: 3, vinyl: 4, tag: 5, blank: 6 };

// ---- Name parts -------------------------------------------------------------------------------------------------------------
const PEOPLE = ['TONY', 'SAL', 'VINNY', 'JOE', 'NICK', 'ROSA', 'MARIA', 'ANGELO', 'GINO', 'CARMEN', 'LUIS', 'JOSÉ', 'ANA', 'KIM',
  'LEE', 'CHEN', 'PARK', 'AHMED', 'OMAR', 'FATIMA', 'DAVID', 'SAM', 'ELI', 'ABE', 'MIKE', 'PAT', 'DANNY', 'GRACE', 'LUCY',
  'IRENE', 'LEO', 'NINA', 'RUDY', 'MILO', 'HECTOR', 'YUSUF', 'DIMITRI', 'STAVROS', 'MEI', 'RAJ', 'PRIYA', 'KOFI', 'AMARA',
  'BORIS', 'OLGA', 'FRANKIE', 'ROCCO', 'ENZO', 'NINO', 'CARLOS', 'TERESA', 'IVAN', 'HANNA', 'MOE', 'LOU', 'MANNY', 'RITA'];
const WORDS = ['GOLDEN', 'LUCKY', 'EMPIRE', 'LIBERTY', 'METRO', 'HUDSON', 'UNION', 'GRAND', 'CENTRAL', 'EAST SIDE', 'WEST SIDE',
  'VILLAGE', 'HARBOR', 'BRIDGE', 'CITY', 'STAR', 'SUNRISE', 'ROYAL', 'CROWN', 'CORNER', 'NEIGHBORHOOD', 'BLUE MOON', 'SILVER',
  'NORTH STAR', 'MANHATTAN', 'KNICKERBOCKER', 'HERALD', 'MERIDIAN', 'ATLAS', 'BEACON', 'ORCHARD', 'ELM', 'MAPLE', 'PARKSIDE',
  'RIVERSIDE', 'SKYLINE', 'NEW AGE', 'PRIME', 'CLASSIC', 'MODERN', 'URBAN', 'PRESIDENT', 'AMERICAN', 'GREEN LEAF', 'TWIN',
  'FIRST AVE', 'BOWERY', 'SECOND CITY', 'MIDTOWN', 'DOWNTOWN', 'UPTOWN', 'FIVE STAR', 'APEX', 'NOBLE', 'TRIBORO'];
const FRENCH = ['DUVAL', 'MARCEAU', 'LEBLANC', 'FONTAINE', 'MOREAU', 'BELLAMY', 'ROUSSEAU', 'LAURENT', 'CLÉMENT', 'VAUCLAIR',
  'DELORME', 'SÉVERIN', 'CASTELLANE', 'MONTVERT', 'BEAUCHAMP', 'ROCHEFORT', 'AUBRY', 'LACROIX'];
const ITALIAN = ['NONNA', 'BELLA', 'ROMA', 'VESUVIO', 'POMODORO', 'BASILICO', 'LIMONE', 'SORRENTO', 'AMALFI', 'TOSCANA', 'CAPRI',
  'PALERMO', 'NAPOLI', 'ORSINI', 'FIORE', 'LUNA ROSSA'];
const SPANISH = ['SOL', 'PALMA', 'ESTRELLA', 'FAMILIA', 'PUEBLO', 'PALOMA', 'CIELO', 'LUNA', 'TORO', 'REY', 'TROPICAL', 'QUISQUEYA',
  'MI TIERRA', 'BORINQUEN', 'AZTECA', 'OAXACA'];
const ASIAN = ['DRAGON', 'LOTUS', 'JADE', 'BAMBOO', 'PEARL', 'PHOENIX', 'GOLDEN WOK', 'ORIENT', 'HUNAN', 'SZECHUAN', 'CANTON',
  'PEKING', 'SHANGHAI', 'GREAT WALL', 'LUCKY STAR', 'HAPPY GARDEN', 'NEW FORTUNE', 'RED LANTERN'];
const JAPANESE = ['KAZE', 'HANA', 'SORA', 'MIZU', 'KAI', 'TORA', 'YUKI', 'NAMI', 'RYU', 'KOI', 'SAKURA', 'TSUKI', 'MOMO'];
const IRISH = ["O'MALLEY", "MCGRATH", "DOYLE", "FLANAGAN", "KEANE", "MURPHY", "QUINN", "BRENNAN", "CASEY", "FINNEGAN"];
const HOUSES = ['HAUTURIER', 'GRÉVILLE', 'VALMONT', 'BRISANT', 'CORSAIRE']; // the game's own brands

// [patterns, taglines]; {P} person, {W} word, {F} french, {I} italian, {S} spanish, {A} asian, {J} japanese, {R} irish, {H} house
const NAMES = {
  vacant: [['FOR LEASE'], ['RETAIL SPACE AVAILABLE', 'AVAILABLE • ALL USES']],
  bodega: [['{W} DELI & GROCERY', '{W} DELI', '{W} MINI MARKET', '{P} GROCERY', '{W} GOURMET DELI', '{W} FOOD MARKET', '{S} DELI GROCERY'],
    ['OPEN 24 HOURS', 'GROCERY • DELI • ATM', 'HOT & COLD SANDWICHES', 'BEER • SODA • LOTTO', 'FRESH COFFEE • BAGELS']],
  pizza: [["{P}'S PIZZA", '{P} PIZZERIA', "FAMOUS {P}'S", "{P}'S SLICE", 'PIZZA {I}', '{I} PIZZA', "{P}'S BRICK OVEN"],
    ['SLICES • HEROS • CALZONES', 'SINCE 1971', 'FREE DELIVERY', 'NY STYLE PIZZA', 'PIZZA BY THE SLICE']],
  cafe: [['{W} COFFEE', '{W} ESPRESSO BAR', 'CAFÉ {F}', '{W} & CO.', '{W} ROASTERS', 'THE DAILY {W}', '{F} CAFÉ'],
    ['COFFEE • PASTRIES', 'ESPRESSO BAR', 'ROASTED IN BROOKLYN', 'BREAKFAST ALL DAY']],
  bakery: [['{P} BAKERY', 'PANADERÍA {S}', 'PÂTISSERIE {F}', '{W} BAGELS', '{W} DONUTS', 'BOULANGERIE {F}', '{W} BAKE SHOP'],
    ['FRESH BREAD DAILY', 'CAKES • COOKIES • PIES', 'BAGELS • LOX • SPREADS', 'SINCE 1952']],
  takeout: [['{A} KITCHEN', 'NEW {A} RESTAURANT', '{A} GARDEN', '{A} EXPRESS', '{A} HOUSE', '{A} NOODLE', '{A} DUMPLING'],
    ['CHINESE FOOD • TAKE OUT', 'FREE DELIVERY', 'LUNCH SPECIAL $8.95', 'DUMPLINGS • NOODLES • RICE']],
  sushi: [['SUSHI {J}', '{J} RAMEN', '{J} IZAKAYA', 'TOKYO {J}', '{J} SUSHI BAR', '{J} NOODLE BAR'],
    ['SUSHI • SASHIMI', 'RAMEN • GYOZA', 'JAPANESE CUISINE']],
  latin: [['{S} TAQUERIA', 'EL {S}', 'LA {S}', 'CASA {S}', '{S} RESTAURANT', 'TACOS {S}', 'COCINA {S}'],
    ['COMIDA LATINA', 'TACOS • BURRITOS', 'ARROZ CON POLLO', 'DESAYUNO • ALMUERZO']],
  restaurant: [['{F} BISTRO', 'TRATTORIA {I}', 'OSTERIA {I}', 'THE {W} ROOM', '{W} KITCHEN', 'BRASSERIE {F}', '{W} GRILL', 'CHEZ {F}'],
    ['DINNER • BRUNCH', 'EST. 1998', 'COCKTAILS', 'OYSTERS • WINE']],
  bar: [["{R}'S PUB", 'THE {W} TAVERN', '{W} BAR', 'THE {W}', "{P}'S", '{W} LOUNGE', "{R}'S"],
    ['COLD BEER', 'COCKTAILS • DRAFTS', 'HAPPY HOUR 4-7', 'LIVE MUSIC']],
  diner: [['{W} DINER', "{P}'S BURGERS", '{W} CHICKEN', '{W} GRILL', 'HALAL {W}', '{W} COFFEE SHOP', "{P}'S LUNCHEONETTE"],
    ['BREAKFAST • LUNCH • DINNER', 'OPEN 24 HOURS', 'BURGERS • SHAKES', 'GYROS • PLATTERS']],
  juice: [['{W} JUICE', 'GREEN {W}', '{W} SMOOTHIE', '{W} FROZEN YOGURT', '{W} ICE CREAM'],
    ['FRESH JUICE • SMOOTHIES', 'ACAI BOWLS', 'SOFT SERVE']],
  laundromat: [['{W} LAUNDROMAT', '{W} WASH & FOLD', '{W} LAUNDRY', 'COIN LAUNDRY', '{W} SUDS'],
    ['WASH • DRY • FOLD', 'SELF SERVICE • DROP OFF', 'OPEN 7 DAYS']],
  cleaners: [['{W} CLEANERS', '{P} DRY CLEANING', '{W} TAILOR & CLEANERS', '{F} CLEANERS', '{W} VALET'],
    ['DRY CLEANING • ALTERATIONS', 'SAME DAY SERVICE', 'SHOE REPAIR']],
  barber: [["{P}'S BARBERSHOP", '{W} BARBERS', 'FRESH CUTZ', 'KINGS CUTS', '{W} BARBER SHOP', '{P} & SONS BARBERS'],
    ['WALK-INS WELCOME', 'CUTS • SHAVES • FADES', 'EST. 1964']],
  salon: [['{W} NAILS', '{W} NAIL SPA', 'NAILS & SPA', '{F} BEAUTY', '{P} HAIR SALON', '{W} LASHES'],
    ['MANICURE • PEDICURE', 'WAXING • FACIALS', 'WALK-INS WELCOME']],
  pharmacy: [['{W} PHARMACY', '{W} DRUGS', '{P} CHEMISTS', '{W} CARE PHARMACY', '{W} RX'],
    ['PRESCRIPTIONS', 'FLU SHOTS • VITAMINS', 'OPEN LATE']],
  bank: [['{H} BANK', '{H} TRUST', '{H} SAVINGS', '{H} FINANCIAL'], ['ATM INSIDE • 24 HOURS', 'MEMBER FDIC']],
  boutique: [['{F}', '{W} SUPPLY CO.', 'MAISON {F}', '{W} VINTAGE', '{W} & {W}', '{P} & {P}', 'STUDIO {F}'],
    ['MEN • WOMEN', 'NEW ARRIVALS', 'VINTAGE • DESIGNER']],
  luxury: [['{F}', 'MAISON {F}', '{F} PARIS', '{I} MILANO', '{H}'], ['', 'PARIS • NEW YORK • TOKYO']],
  jewelry: [['{P} JEWELERS', '{W} DIAMONDS', 'GOLD & {W}', '{P} & SONS', '{W} WATCHES'],
    ['WE BUY GOLD', 'DIAMONDS • WATCHES', 'ENGAGEMENT RINGS']],
  phones: [['{W} WIRELESS', '{W} MOBILE', 'CELL {W}', 'PHONE REPAIR', '{W} ELECTRONICS'],
    ['CELL PHONES • REPAIR', 'UNLOCK • ACCESSORIES', 'FIX CRACKED SCREENS']],
  hardware: [['{W} HARDWARE', '{P} PAINT & HARDWARE', '{W} LOCKSMITH', '{W} HOUSEWARES'],
    ['KEYS MADE', 'PAINT • TOOLS • KEYS', 'SINCE 1948']],
  florist: [['{W} FLOWERS', '{F} FLEURS', '{W} FLORIST', '{P} FLOWER SHOP', 'BLOOM & {W}'],
    ['FLOWERS • PLANTS', 'WEDDINGS • EVENTS']],
  liquor: [['{W} WINE & SPIRITS', '{W} LIQUORS', '{P} WINES', '{W} BOTTLE SHOP'], ['WINE • LIQUOR', 'TASTINGS FRIDAY']],
  books: [['{W} BOOKS', '{W} RECORDS', 'BOOKS & {W}', '{W} COMICS', '{P} BOOKSHOP'], ['USED • RARE', 'VINYL • CDS', 'NEW & USED']],
  office: [['{P} REALTY', '{W} INSURANCE', 'LAW OFFICES', '{W} TRAVEL', '{W} DENTAL', 'TAX SERVICES', '{W} MEDICAL', '{W} PROPERTIES'],
    ['', 'NOTARY PUBLIC', 'BY APPOINTMENT']],
  souvenir: [['NEW YORK SOUVENIRS', 'NYC GIFTS', '{W} GIFTS', 'BIG APPLE GIFTS', 'EMPIRE SOUVENIRS'], ['T-SHIRTS • CAPS • GIFTS', 'LUGGAGE • CAMERAS']],
  shoes: [['{W} SHOES', '{W} SNEAKERS', 'FOOTWEAR {W}', '{W} KICKS', '{P} SHOES'], ['SNEAKERS • BOOTS', 'NEW STYLES']],
  gallery: [['{P} GALLERY', 'GALERIE {F}', '{W} PROJECTS', '{W} CONTEMPORARY', '{F} FINE ART'], ['', 'NOW SHOWING']]
};

// ---- Look per type: style weights, palettes, fonts, extras --------------------------------------------------------------
// Colours as 0xRRGGBB. board: fascia/board, ink: letters
const C = {
  green: 0x1f3b2d, oxblood: 0x5a1a1a, navy: 0x1b2a44, black: 0x151515, charcoal: 0x2b2d30, cream: 0xe8e0cc, white: 0xf2f0ea,
  red: 0xb01e1e, mustard: 0xc49a2c, teal: 0x1f5a5a, burgundy: 0x4a1424, forest: 0x234a2f, brown: 0x4a3a2a, sky: 0x4f7ea8,
  pink: 0xd98ba0, orange: 0xe0721e, yellow: 0xf2c230, gold: 0xd7b25a, brass: 0xc9a45a, blue: 0x1f4fa8, lime: 0x7fbf3a
};
const LOOKS = {
  vacant: { styles: { blank: 1 }, boards: [C.cream, C.white, C.charcoal], inks: [C.black], fonts: [F.oswald], awning: 0, blade: 0 },
  bodega: { styles: { box: 8, painted: 2 }, boards: [C.yellow, C.red, C.white, C.green, C.orange], inks: [C.red, C.black, C.white, C.blue],
    fonts: [F.anton, F.archivo, F.oswald, F.bebas], awning: 0.55, blade: 0.1, awnings: [C.red, C.green, C.yellow, C.orange, C.navy] },
  pizza: { styles: { box: 4, neon: 2.5, painted: 3 }, boards: [C.red, C.white, C.green, C.black], inks: [C.white, C.red, C.green, C.yellow],
    fonts: [F.lobster, F.anton, F.oswald, F.pacifico, F.bitter], awning: 0.5, blade: 0.4, awnings: [C.red, C.green, 'stripe-red'] },
  cafe: { styles: { painted: 5, letters: 2.5, vinyl: 2.5 }, boards: [C.black, C.green, C.navy, C.cream, C.teal], inks: [C.cream, C.gold, C.white, C.black],
    fonts: [F.playfair, F.josefin, F.bitter, F.bebas], awning: 0.4, blade: 0.3, awnings: [C.black, C.green, C.navy, 'stripe-black'] },
  bakery: { styles: { painted: 6, box: 2.5, neon: 1.5 }, boards: [C.cream, C.pink, C.sky, C.brown, C.white], inks: [C.brown, C.red, C.navy, C.white],
    fonts: [F.lobster, F.playfair, F.pacifico, F.bitter], awning: 0.6, blade: 0.25, awnings: ['stripe-red', 'stripe-blue', C.pink, C.brown] },
  takeout: { styles: { box: 8.5, neon: 1.5 }, boards: [C.red, C.yellow, C.white], inks: [C.red, C.yellow, C.white, C.black],
    fonts: [F.anton, F.oswald, F.archivo], awning: 0.35, blade: 0.2, awnings: [C.red, C.yellow] },
  sushi: { styles: { painted: 5, letters: 5 }, boards: [C.black, C.brown, C.cream], inks: [C.cream, C.white, C.red, C.black],
    fonts: [F.josefin, F.cinzel, F.bebas], awning: 0.25, blade: 0.35, awnings: [C.black, C.navy] },
  latin: { styles: { box: 4, painted: 4, neon: 2 }, boards: [C.orange, C.yellow, C.teal, C.red, C.lime], inks: [C.white, C.black, C.red],
    fonts: [F.anton, F.lobster, F.oswald, F.pacifico], awning: 0.55, blade: 0.25, awnings: [C.orange, C.teal, C.red, 'stripe-red'] },
  restaurant: { styles: { painted: 5, letters: 3.5, neon: 1.5 }, boards: [C.black, C.green, C.oxblood, C.navy, C.cream], inks: [C.gold, C.cream, C.white],
    fonts: [F.playfair, F.cinzel, F.josefin, F.bitter, F.lobster], awning: 0.6, blade: 0.3, awnings: [C.green, C.oxblood, C.black, C.navy, 'stripe-black'] },
  bar: { styles: { neon: 5.5, painted: 4.5 }, boards: [C.black, C.green, C.oxblood, C.brown], inks: [C.gold, C.cream, 0xff4060, 0x40c0ff, 0xffb040],
    fonts: [F.monoton, F.lobster, F.pacifico, F.bitter, F.playfair], awning: 0.25, blade: 0.55, awnings: [C.black, C.green] },
  diner: { styles: { box: 5, neon: 5 }, boards: [C.red, C.white, C.sky, C.black], inks: [C.white, C.red, 0xff5070, 0x50d0ff],
    fonts: [F.pacifico, F.lobster, F.anton, F.oswald], awning: 0.45, blade: 0.3, awnings: [C.red, 'stripe-red', C.sky] },
  juice: { styles: { box: 6, painted: 4 }, boards: [C.lime, C.orange, C.white, C.pink], inks: [C.white, C.green, C.black],
    fonts: [F.pacifico, F.anton, F.josefin], awning: 0.4, blade: 0.15, awnings: [C.lime, C.orange, 'stripe-green'] },
  laundromat: { styles: { box: 7, painted: 3 }, boards: [C.blue, C.white, C.sky, C.yellow], inks: [C.white, C.blue, C.red],
    fonts: [F.oswald, F.anton, F.archivo, F.bebas], awning: 0.3, blade: 0.15, awnings: [C.blue, C.sky] },
  cleaners: { styles: { box: 6, painted: 4 }, boards: [C.white, C.navy, C.green, C.red], inks: [C.navy, C.white, C.red],
    fonts: [F.oswald, F.bitter, F.playfair, F.bebas], awning: 0.45, blade: 0.15, awnings: [C.navy, C.green, C.red] },
  barber: { styles: { painted: 5, neon: 3, box: 2 }, boards: [C.black, C.red, C.navy, C.white], inks: [C.white, C.gold, C.red, 0x40c0ff],
    fonts: [F.lobster, F.bitter, F.anton, F.playfair], awning: 0.3, blade: 0.3, awnings: ['stripe-red', C.black] },
  salon: { styles: { box: 5, neon: 3, letters: 2 }, boards: [C.pink, C.white, C.black], inks: [C.white, C.pink, 0xff60c0, C.black],
    fonts: [F.pacifico, F.josefin, F.lobster, F.playfair], awning: 0.3, blade: 0.15, awnings: [C.pink, C.black] },
  pharmacy: { styles: { box: 9, letters: 1 }, boards: [C.white, C.green, C.blue], inks: [C.red, C.blue, C.green, C.white],
    fonts: [F.oswald, F.archivo, F.josefin], awning: 0.1, blade: 0.35, awnings: [C.green, C.blue] },
  bank: { styles: { letters: 8, box: 2 }, boards: [C.charcoal, C.navy, C.black, C.white], inks: [C.white, C.brass, C.cream],
    fonts: [F.cinzel, F.josefin, F.playfair], awning: 0, blade: 0.1 },
  boutique: { styles: { letters: 5, painted: 4, vinyl: 1 }, boards: [C.black, C.white, C.cream, C.charcoal, C.green], inks: [C.white, C.black, C.gold],
    fonts: [F.josefin, F.playfair, F.bebas, F.cinzel, F.bitter], awning: 0.3, blade: 0.2, awnings: [C.black, C.white, C.green] },
  luxury: { styles: { letters: 1 }, boards: [C.black, C.charcoal, C.cream], inks: [C.brass, C.white, C.black],
    fonts: [F.cinzel, F.josefin, F.playfair], awning: 0, blade: 0 },
  jewelry: { styles: { letters: 4, box: 4, neon: 2 }, boards: [C.black, C.navy, C.burgundy, C.white], inks: [C.gold, C.white, C.red],
    fonts: [F.cinzel, F.playfair, F.oswald, F.anton], awning: 0.2, blade: 0.2, awnings: [C.burgundy, C.navy] },
  phones: { styles: { box: 9, neon: 1 }, boards: [C.blue, C.red, C.orange, C.lime, C.white], inks: [C.white, C.yellow, C.black],
    fonts: [F.anton, F.oswald, F.archivo, F.bebas], awning: 0.15, blade: 0.1, awnings: [C.blue, C.red] },
  hardware: { styles: { box: 5, painted: 5 }, boards: [C.red, C.white, C.green, C.yellow], inks: [C.white, C.red, C.black],
    fonts: [F.bitter, F.oswald, F.anton, F.archivo], awning: 0.45, blade: 0.2, awnings: [C.red, C.green, 'stripe-green'] },
  florist: { styles: { painted: 7, letters: 3 }, boards: [C.green, C.cream, C.forest, C.white], inks: [C.cream, C.green, C.gold, C.pink],
    fonts: [F.lobster, F.playfair, F.josefin], awning: 0.6, blade: 0.25, awnings: ['stripe-green', C.forest, C.cream] },
  liquor: { styles: { box: 6, neon: 4 }, boards: [C.red, C.black, C.navy, C.white], inks: [C.white, C.red, 0xff4060, C.gold],
    fonts: [F.anton, F.oswald, F.lobster, F.bitter], awning: 0.2, blade: 0.35, awnings: [C.red, C.black] },
  books: { styles: { painted: 7, letters: 3 }, boards: [C.green, C.oxblood, C.navy, C.black], inks: [C.gold, C.cream, C.white],
    fonts: [F.playfair, F.bitter, F.cinzel, F.josefin], awning: 0.45, blade: 0.4, awnings: [C.green, C.oxblood, C.navy] },
  office: { styles: { vinyl: 6, letters: 4 }, boards: [C.charcoal, C.white, C.navy], inks: [C.gold, C.white, C.black],
    fonts: [F.josefin, F.playfair, F.oswald, F.cinzel], awning: 0.1, blade: 0.05, awnings: [C.navy] },
  souvenir: { styles: { box: 10 }, boards: [C.red, C.yellow, C.blue, C.white], inks: [C.white, C.red, C.yellow, C.blue],
    fonts: [F.anton, F.archivo, F.oswald], awning: 0.2, blade: 0.3, awnings: [C.red, C.blue] },
  shoes: { styles: { box: 5, letters: 5 }, boards: [C.black, C.white, C.red, C.orange], inks: [C.white, C.black, C.red],
    fonts: [F.bebas, F.anton, F.josefin, F.oswald], awning: 0.15, blade: 0.15, awnings: [C.black, C.red] },
  gallery: { styles: { letters: 8, vinyl: 2 }, boards: [C.white, C.charcoal, C.black], inks: [C.black, C.white],
    fonts: [F.josefin, F.bebas, F.cinzel], awning: 0, blade: 0 }
};

// ---- Deterministic randomness ------------------------------------------------------------------------------------------------
function rng(seed) {
  let s = Math.floor(seed * 4294967296) >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickFrom = (list, r) => list[Math.floor(r() * list.length) % list.length];
function pickWeighted(weights, r) {
  const entries = Object.entries(weights);
  let t = r() * entries.reduce((n, [, w]) => n + w, 0);
  for (const [k, w] of entries) { t -= w; if (t <= 0) return k; }
  return entries[entries.length - 1][0];
}

function fillName(pattern, r) {
  return pattern.replace(/\{([PWFISAJRH])\}/g, (_, k) => pickFrom({ P: PEOPLE, W: WORDS, F: FRENCH, I: ITALIAN, S: SPANISH, A: ASIAN,
    J: JAPANESE, R: IRISH, H: HOUSES }[k], r));
}

// Title Case for the script faces ("Tony's Pizza"), capitals elsewhere
function caseFor(text, font) {
  if (!SCRIPT.has(font)) return text;
  return text.toLowerCase().replace(/(^|[\s&.-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

const hex = (c) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const lum = (c) => { const [r, g, b] = hex(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/**
 * A shop's identity: name, tagline, sign style, colours and options, all from its type and seed.
 * @param {string} typeId
 * @param {number} seed - 0..1
 */
function shopIdentity(typeId, seed) {
  const r = rng(seed);
  const look = LOOKS[typeId] || LOOKS.boutique;
  const [patterns, tags] = NAMES[typeId] || NAMES.boutique;
  const style = STYLE[pickWeighted(look.styles, r)];
  const font = pickFrom(look.fonts, r);
  let board = pickFrom(look.boards, r);
  let ink = pickFrom(look.inks, r);
  // Keep the letters readable against their board
  for (let i = 0; i < 6 && Math.abs(lum(board) - lum(ink)) < 0.35; i++) ink = pickFrom(look.inks, r);
  if (Math.abs(lum(board) - lum(ink)) < 0.35) ink = lum(board) > 0.5 ? C.black : C.white;
  // A sign holds 24 letters: draw again until the name fits (the shortest try wins)
  let raw = fillName(pickFrom(patterns, r), r);
  for (let i = 0; i < 8 && raw.length > 22; i++) {
    const next = fillName(pickFrom(patterns, r), r);
    if (next.length < raw.length) raw = next;
  }
  const name = caseFor(raw.slice(0, 24), font);
  const tagline = r() < 0.7 ? pickFrom(tags, r) : '';
  const awningPick = look.awnings ? pickFrom(look.awnings, r) : C.black;
  return {
    name, tagline, style, font, board, ink,
    awning: r() < (look.awning ?? 0) ? awningPick : null,
    blade: r() < (look.blade ?? 0),
    r
  };
}

// ---- Text for the shader: glyph codes two per float, and the width the line takes -----------------------------------
const CODE = new Map([...GLYPHS.chars].map((ch, i) => [ch, i]));
const MAX_CHARS = 24;
/**
 * @returns {{ codes: Float32Array(12), width: number (ems, with tracking), count: number }}
 */
function encodeText(text, font, tracking = 0) {
  const metrics = GLYPHS.fonts[font];
  const chars = [...text].map((ch) => CODE.has(ch) ? ch : CODE.has(ch.toUpperCase()) ? ch.toUpperCase() : ' ').slice(0, MAX_CHARS);
  // Each code is stored plus one, so a 0 ends the string (a space is character 0 of the atlas)
  const codes = new Float32Array(12);
  let width = 0;
  chars.forEach((ch, i) => {
    const code = CODE.get(ch);
    width += metrics.advances[code] + (i < chars.length - 1 ? tracking : 0);
    const slot = Math.floor(i / 2);
    codes[slot] += (code + 1) * (i % 2 ? 128 : 1);
  });
  return { codes, width, count: chars.length };
}

export { shopIdentity, encodeText, STYLE, F as FONTS, hex, MAX_CHARS, LOOKS, NAMES };
