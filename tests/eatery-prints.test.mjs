import test from 'node:test';
import assert from 'node:assert/strict';
import { PRINT_SIZE, PRINTS, PRINT_LAYOUT, PRINT_ALPHA, paintPrints, paintPrint } from '../js/eatery-prints.js';
import { BRANDS, BRAND_IDS } from '../js/eatery-brands.js';

// What the rooms map onto their quads: name -> [width, height] in pixels
const REQUIRED = {
  bullion: {
    fascia: [2048, 200], blade: [384, 384], neonRefuge: [900, 240], open: [320, 150],
    menu1: [640, 360], menu2: [640, 360], menu3: [640, 360], ticker: [2048, 64],
    posterBull: [420, 600], posterDividende: [420, 600], posterShake: [420, 600],
    kiosk: [320, 512], orderHere: [512, 96], pickup: [512, 96], quarter: [300, 380], chalk: [420, 300],
    sandwich: [360, 600], mat: [512, 256], apron: [256, 256], cap: [128, 128],
    staff: [256, 96], wc: [256, 96], exit: [256, 96], trash: [256, 128], hours: [420, 160],
    wetFloor: [200, 300], barsPattern: [512, 128], doorBand: [512, 64]
  },
  tranche: {
    fascia: [2048, 200], blade: [384, 384], neonName: [900, 260], neonSlice: [420, 420], open: [360, 150],
    menuBoard: [900, 600], posterPart: [420, 600], posterCall: [420, 600], posterSubprime: [420, 600],
    photos: [900, 300], checker: [256, 256], tiles: [256, 256], fridge: [300, 600],
    special: [420, 300], hours: [420, 160], window: [420, 300], sandwich: [360, 600], tips: [160, 160],
    apron: [256, 256], cap: [128, 128], ovenPlate: [300, 110], bag: [256, 256],
    staff: [256, 96], exit: [256, 96], wetFloor: [200, 300]
  }
};
const ALPHA = { bullion: ['neonRefuge', 'open', 'doorBand'], tranche: ['neonName', 'neonSlice', 'open'] };

// A 2D context that accepts any call and remembers what matters: words, clips, full-bleed fills, save/restore balance
function stubContext() {
  const log = { words: [], stroked: [], clips: [], fills: [], calls: 0, depth: 0, cleared: [] };
  const state = { font: '10px sans-serif', textAlign: 'left' };
  const gradient = { addColorStop() {} };
  let lastRect = null;
  const methods = {
    fillText(str) { log.words.push(String(str)); },
    strokeText(str) { log.stroked.push(String(str)); },
    measureText(str) { return { width: [...String(str)].length * Number(/([\d.]+)px/.exec(state.font)?.[1] || 10) * 0.56 }; },
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    rect(x, y, w, h) { lastRect = [x, y, w, h]; },
    clip() { if (lastRect) log.clips.push(lastRect); lastRect = null; },
    fillRect(x, y, w, h) { log.fills.push([x, y, w, h]); },
    clearRect(x, y, w, h) { log.cleared.push([x, y, w, h]); },
    save() { log.depth++; }, restore() { log.depth--; assert.ok(log.depth >= 0, 'restore without save'); }
  };
  const c = new Proxy(state, {
    get(target, prop) {
      if (prop in methods) return (...args) => { log.calls++; return methods[prop](...args); };
      if (prop in target) return target[prop];
      return () => { log.calls++; };
    },
    set(target, prop, value) { target[prop] = value; return true; }
  });
  return { c, log };
}
// Words as a reader gets them: whole strings on their own lines, letters set one by one run together; spaces dropped
const transcript = (words) => words.reduce((all, w) => all + ([...w].length > 1 ? '\n' : '') + w, '').replace(/[ \u00a0]/g, '');
const names = (str) => str.replace(/[ \u00a0]/g, '');
const priced = (text, price) => new RegExp(`(?<![0-9,.])${price}\\$`).test(text);
function wordsOf(brand, name) {
  const { c, log } = stubContext();
  paintPrint(c, brand, name);
  return transcript(log.words);
}

test('both franchises have every print the rooms ask for, at the size they ask for', () => {
  assert.equal(PRINT_SIZE, 2048);
  assert.deepEqual(Object.keys(PRINT_LAYOUT).sort(), [...BRAND_IDS].sort());
  for (const brand of BRAND_IDS) {
    for (const [name, [w, h]] of Object.entries(REQUIRED[brand])) {
      const rect = PRINT_LAYOUT[brand][name];
      assert.ok(rect, `${brand}.${name} is missing`);
      assert.deepEqual(rect.slice(2), [w, h], `${brand}.${name} size`);
    }
    assert.deepEqual([...PRINT_ALPHA[brand]].sort(), [...ALPHA[brand]].sort(), `${brand}: prints on a transparent ground`);
  }
});

test('rectangles are whole pixels inside the sheet, apart from one another by their gutters', () => {
  for (const brand of BRAND_IDS) {
    const entries = Object.entries(PRINT_LAYOUT[brand]);
    for (const [name, rect] of entries) {
      const [x, y, w, h] = rect;
      assert.ok(rect.every(Number.isInteger), `${brand}.${name} on whole pixels`);
      assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= PRINT_SIZE && y + h <= PRINT_SIZE, `${brand}.${name} inside the sheet`);
      // an alpha print keeps clear of the sheet's own edge too: the texture wraps
      if (PRINT_ALPHA[brand].includes(name)) assert.ok(x >= 6 && y >= 6 && x + w <= PRINT_SIZE - 6 && y + h <= PRINT_SIZE - 6, `${brand}.${name} away from the edge`);
    }
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      const [a, [ax, ay, aw, ah]] = entries[i], [b, [bx, by, bw, bh]] = entries[j];
      // the gap between two rectangles: the larger of their separations along x and y (negative when they overlap)
      const gap = Math.max(Math.max(bx - (ax + aw), ax - (bx + bw)), Math.max(by - (ay + ah), ay - (by + bh)));
      assert.ok(gap >= 0, `${brand}: ${a} overlaps ${b}`);
      const alpha = PRINT_ALPHA[brand].includes(a) || PRINT_ALPHA[brand].includes(b);
      assert.ok(gap >= (alpha ? 6 : 4), `${brand}: ${a} and ${b} are ${gap} px apart`);
    }
  }
});

test('UVs are the layout over the sheet, v down', () => {
  for (const brand of BRAND_IDS) {
    assert.deepEqual(Object.keys(PRINTS[brand]), Object.keys(PRINT_LAYOUT[brand]));
    for (const [name, [x, y, w, h]] of Object.entries(PRINT_LAYOUT[brand])) {
      assert.deepEqual(PRINTS[brand][name], [x / 2048, y / 2048, (x + w) / 2048, (y + h) / 2048], `${brand}.${name}`);
      const [u0, v0, u1, v1] = PRINTS[brand][name];
      assert.ok(0 <= u0 && u0 < u1 && u1 <= 1 && 0 <= v0 && v0 < v1 && v1 <= 1);
    }
  }
});

test('a sheet paints into any 2D context, each print clipped to its own rectangle', () => {
  for (const brand of BRAND_IDS) {
    const { c, log } = stubContext();
    assert.doesNotThrow(() => paintPrints(c, brand));
    assert.equal(log.depth, 0, `${brand}: save and restore balance`);
    assert.deepEqual(log.cleared[0], [0, 0, 2048, 2048], `${brand}: the sheet starts transparent`);
    for (const [name, rect] of Object.entries(PRINT_LAYOUT[brand])) {
      assert.ok(log.clips.some((clip) => clip.every((v, i) => v === rect[i])), `${brand}.${name} is clipped to its rectangle`);
    }
    // one print at a time: something is drawn for each, and it leaves the context as it found it
    for (const name of Object.keys(PRINT_LAYOUT[brand])) {
      const one = stubContext();
      paintPrint(one.c, brand, name);
      assert.ok(one.log.calls > 8, `${brand}.${name} draws something`);
      assert.equal(one.log.depth, 0, `${brand}.${name}: save and restore balance`);
      // a print cut out by alpha never lays a ground over its whole rectangle
      const [, , w, h] = PRINT_LAYOUT[brand][name];
      if (PRINT_ALPHA[brand].includes(name)) assert.ok(!one.log.fills.some(([x, y, fw, fh]) => x <= 0 && y <= 0 && x + fw >= w && y + fh >= h), `${brand}.${name} keeps its ground transparent`);
    }
  }
});

test('every dish is on the sheet with its price, as the menu data has them', () => {
  for (const brand of BRAND_IDS) {
    const { c, log } = stubContext();
    paintPrints(c, brand);
    const all = transcript(log.words);
    // one board at a time: a name and its price are read together
    const boards = Object.keys(PRINT_LAYOUT[brand]).map((name) => wordsOf(brand, name));
    for (const item of BRANDS[brand].menu) {
      assert.ok(all.includes(names(item.name)), `${brand}: ${item.name} is written somewhere`);
      assert.ok(boards.some((words) => words.includes(names(item.name)) && priced(words, item.price)), `${brand}: ${item.name} at ${item.price} $ on one board`);
    }
  }
});

test('BULLION: three boards over the counter share the menu out, the kiosk lists it all', () => {
  const item = (id) => BRANDS.bullion.menu.find((m) => m.id === id);
  const on = (print, ids) => {
    const words = wordsOf('bullion', print);
    for (const id of ids) {
      const { name, price } = item(id);
      // the hero deal is set on two lines, the kiosk drops MENU: the last word is always there
      assert.ok(words.includes(names(name)) || words.includes(name.split(' ').pop()), `${print}: ${name}`);
      assert.ok(priced(words, price), `${print}: ${name} at ${price} $`);
    }
    return words;
  };
  assert.ok(on('menu1', ['bullmarket', 'lingot', 'krach', 'carat']).includes('LESBURGERS'));
  assert.ok(on('menu2', ['dividende']).includes('DIVIDENDE'));
  const sides = on('menu3', ['pepites', 'liquidites']);
  assert.ok(sides.includes('ÀCÔTÉ') && sides.includes('COURSDUJOUR'));
  assert.ok(on('kiosk', BRANDS.bullion.menu.map((m) => m.id)).includes('TOUCHEZ'));
  assert.ok(wordsOf('bullion', 'orderHere').includes('COMMANDEZICI'));
  assert.ok(wordsOf('bullion', 'pickup').includes('RETRAITDESCOMMANDES'));
  for (const [print, id] of [['posterBull', 'bullmarket'], ['posterDividende', 'dividende'], ['posterShake', 'liquidites'], ['sandwich', 'dividende'], ['chalk', 'lingot']]) on(print, [id]);
});

test('TRANCHE: the letter board spells the whole menu and the three sizes', () => {
  const board = wordsOf('tranche', 'menuBoard');
  for (const { name, note, price } of BRANDS.tranche.menu) {
    assert.ok(board.includes(names(name)), name);
    assert.ok(board.includes(names(note.toUpperCase())), note);
    assert.ok(board.includes(`${names(name)}${price}$`), `${name} is followed by its price`);
  }
  assert.ok(board.includes('EQUITY·MEZZANINE·SENIOR'));
  const special = wordsOf('tranche', 'special');
  assert.ok(special.includes('PARTDUJOUR') && BRANDS.tranche.menu.some((m) => special.includes(names(m.name)) && priced(special, m.price)));
  const card = wordsOf('tranche', 'window'), part = BRANDS.tranche.menu.find((m) => m.id === 'margherita');
  assert.ok(card.includes('PART') && card.includes('SERVIECHAUDE') && priced(card, part.price));
  // the pavement board does its sum in public
  const soda = BRANDS.tranche.menu.find((m) => m.id === 'soda');
  assert.ok(priced(wordsOf('tranche', 'sandwich'), part.price * 2 + soda.price));
});

test('opening hours and taglines come from the brand data; the type is French', () => {
  assert.ok(wordsOf('bullion', 'hours').includes('6H–2H') && wordsOf('bullion', 'hours').includes('7J/7'));
  assert.ok(wordsOf('tranche', 'hours').includes('10H–4H'));
  for (const brand of BRAND_IDS) {
    const { c, log } = stubContext();
    paintPrints(c, brand);
    const said = [...log.words, ...log.stroked];
    assert.ok(said.some((w) => w.toLowerCase() === BRANDS[brand].tagline.toLowerCase()), `${brand}: the tagline is on the sheet`);
    for (const w of said) {
      assert.ok(!w.includes("'") && !w.includes('"'), `typographic apostrophe and quotes in « ${w} »`);
      assert.ok(!w.includes('...'), `a real ellipsis in « ${w} »`);
      // French punctuation: a space before : ; ! ? % and before the dollar that follows a figure
      assert.ok(!/[^\s\u00a0][:;!?%]/.test(w), `a space before the high punctuation in « ${w} »`);
      assert.ok(!/\d\$/.test(w), `a space between figure and dollar in « ${w} »`);
    }
  }
  assert.ok(wordsOf('bullion', 'wetFloor').includes('SOL\nGLISSANT') && wordsOf('tranche', 'wetFloor').includes('SOL\nGLISSANT'));
  assert.ok(wordsOf('bullion', 'exit').includes('SORTIE') && wordsOf('tranche', 'exit').includes('SORTIE'));
});
