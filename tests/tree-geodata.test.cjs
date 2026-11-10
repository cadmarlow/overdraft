const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { Script } = require('node:vm');
const { gunzipSync, gzipSync } = require('node:zlib');

const compressed = readFileSync(join(__dirname, '../js/tree-geodata.bin.gz'));
const moduleText = readFileSync(join(__dirname, '../js/tree-geodata.js'), 'utf8');
const source = moduleText
  .replace('import.meta.url', JSON.stringify('https://example.test/city/js/tree-geodata.js'))
  .replaceAll('export const ', 'const ');
const script = new Script(`(async () => { ${source}\nreturn { REAL_TREES, REAL_TREE_SPECIES, REAL_TREE_DBH }; })()`);

function loadTrees(bytes = compressed, status = 200) {
  return script.runInNewContext({ URL, Response, DecompressionStream, Float32Array, Uint8Array,
    fetch: async url => {
      assert.equal(url.href, 'https://example.test/city/js/tree-geodata.bin.gz');
      return new Response(bytes, { status });
    }
  });
}
const trees = loadTrees();
// The tool that writes both files. Importing it must not run it.
const tool = import('../tools/trees/build-tree-data.mjs');

const COUNT = 70645;
// The classes of the game, in the order of their byte, and the genera of each
const CLASSES = [
  ['plane', 'Platanus Acer Liquidambar Liriodendron'],
  ['locust', 'Gleditsia Robinia Styphnolobium Sophora Gymnocladus Koelreuteria Fraxinus Ailanthus Juglans Carya Maackia Cladrastis Phellodendron Albizia'],
  ['pear', 'Pyrus Amelanchier Eucommia Nyssa Parrotia Fagus'],
  ['ginkgo', 'Ginkgo'],
  ['oak', 'Quercus Castanea'],
  ['elm', 'Ulmus Zelkova Carpinus Ostrya Celtis Betula Corylus Populus Salix Alnus'],
  ['linden', 'Tilia Cercis Catalpa Paulownia Morus Cercidiphyllum'],
  ['cherry', 'Prunus Malus Crataegus Cornus Magnolia Syringa Lagerstroemia Halesia Chionanthus Styrax'],
  ['other', 'Pinus Picea Metasequoia Taxodium Thuja Unknown']
];
const OTHER = 8;

// A frame that leaves coordinates alone, around a 100 m square island
const frame = { project: (x, z) => [x, z], island: [[0, 0], [100, 0], [100, 100], [0, 100]] };
const row = (x, z, extra = {}) => ({ location: { coordinates: [x, z] }, tpstructure: 'Full', tpcondition: 'Good', ...extra });

test('survey tree locations are unique, quantized and inside the detailed map', async () => {
  const { REAL_TREES } = await trees;
  assert.ok(REAL_TREES instanceof Float32Array);
  assert.equal(REAL_TREES.length, COUNT * 2);
  const geo = readFileSync(join(__dirname, '../js/nyc-geodata.js'), 'utf8');
  const ring = new Script(`${geo.replace('export const GEO', 'const GEO')}\nGEO.manhattan`).runInNewContext();
  function inside(x, z) {
    let hit = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      if ((ring[i + 1] > z) !== (ring[j + 1] > z) &&
        x < (ring[j] - ring[i]) * (z - ring[i + 1]) / (ring[j + 1] - ring[i + 1]) + ring[i]) hit = !hit;
    }
    return hit;
  }
  const seen = new Set();
  for (let i = 0; i < REAL_TREES.length; i += 2) {
    const x = REAL_TREES[i], z = REAL_TREES[i + 1];
    assert.ok(Number.isInteger(x * 2) && Number.isInteger(z * 2));
    const key = `${x},${z}`;
    assert.ok(!seen.has(key), 'Quantized locations must not create duplicate trees.');
    seen.add(key);
    // Boundary locations may move up to 0.25 m on each axis when rounded.
    assert.ok(inside(x, z) || [-0.25, 0.25].some(dx => [-0.25, 0.25].some(dz => inside(x + dx, z + dz))));
  }
  for (const key of ['-35.5,57.5', '549.5,5512', '459,-4232.5']) {
    assert.ok(seen.has(key), 'Sampled Midtown, Lower Manhattan and Upper East Side trees retain their positions.');
  }
});

test('every tree has a species class and a trunk diameter', async () => {
  const { REAL_TREES, REAL_TREE_SPECIES, REAL_TREE_DBH } = await trees;
  assert.ok(REAL_TREE_SPECIES instanceof Uint8Array && REAL_TREE_DBH instanceof Uint8Array);
  assert.equal(REAL_TREE_SPECIES.length, COUNT);
  assert.equal(REAL_TREE_DBH.length, COUNT);
  const perClass = new Array(CLASSES.length).fill(0);
  let unknown = 0;
  for (let i = 0; i < COUNT; i++) {
    assert.ok(REAL_TREE_SPECIES[i] <= OTHER, 'A species byte names one of the nine classes.');
    assert.ok(REAL_TREE_DBH[i] <= 60, 'A trunk is at most 60 inches across.');
    perClass[REAL_TREE_SPECIES[i]]++;
    if (REAL_TREE_DBH[i] === 0) unknown++;
  }
  assert.ok(perClass.every(n => n > 0), 'Every class stands somewhere in Manhattan.');
  assert.equal(Math.max(...perClass), perClass[1], 'Honeylocusts and their kin are the most common street trees.');
  assert.ok(perClass[OTHER] < COUNT * 0.05, 'Few trees fall outside the eight drawn classes.');
  assert.ok(unknown < COUNT * 0.01, 'Nearly every trunk was measured.');
  // The sampled trees of the first test: a honeylocust, a pagoda tree and a goldenrain tree, all of the locust class
  for (const [x, z] of [[-35.5, 57.5], [549.5, 5512], [459, -4232.5]]) {
    let index = 0;
    while (REAL_TREES[index * 2] !== x || REAL_TREES[index * 2 + 1] !== z) index++;
    assert.equal(REAL_TREE_SPECIES[index], 1);
    assert.ok(REAL_TREE_DBH[index] > 0);
  }
});

test('tree generator filters and deduplicates locations, and signed deltas round trip', async () => {
  const { prepare, pack } = await tool;
  const tally = {};
  const kept = prepare([row(1.1, 2.1), row(1.2, 2.2), row(90, 80), row(3, 4, { tpcondition: 'Dead' }),
    row(5, 6, { tpstructure: 'Stump' }), row(-10, 5), row(NaN, 1), row('7', 'east'),
    { tpstructure: 'Full', tpcondition: 'Good' }, { location: { coordinates: [8, 9, 10] }, tpstructure: 'Full', tpcondition: 'Good' }],
  frame, tally);
  assert.deepEqual(kept.map(({ x, z }) => [x, z]), [[2, 4], [180, 160]]);
  assert.deepEqual(tally, { rows: 10, notFull: 1, dead: 1, unlocated: 4, outside: 1, shared: 1, oversized: 0 });
  assert.throws(() => prepare([row(-10, 5), row(3, 4, { tpcondition: 'Dead' })], frame), /No living trees/);

  // Morton order: X on the even bits, Z on the odd ones, whatever the order of the rows
  const grid = prepare([row(51, 51), row(50, 50.5), row(50.5, 50), row(51.5, 50), row(50, 50), row(50.5, 50.5)], frame);
  assert.deepEqual(grid.map(({ x, z }) => [x, z]), [[100, 100], [101, 100], [100, 101], [101, 101], [103, 100], [102, 102]]);

  const bytes = pack([{ x: -8192, z: 127, species: 3, dbh: 14 }, { x: 16385, z: -16385, species: 8, dbh: 0 },
    { x: 0, z: 0, species: 0, dbh: 60 }, { x: -1, z: 1, species: 7, dbh: 1 }]);
  assert.equal(bytes.toString('latin1', 0, 4), 'NYT2');
  // Gzipped as the file is, then as a server that inflates .gz files itself hands it over
  for (const body of [gzipSync(bytes), bytes]) {
    const { REAL_TREES, REAL_TREE_SPECIES, REAL_TREE_DBH } = await loadTrees(body);
    assert.deepEqual(Array.from(REAL_TREES), [-4096, 63.5, 8192.5, -8192.5, 0, 0, -0.5, 0.5]);
    assert.deepEqual(Array.from(REAL_TREE_SPECIES), [3, 8, 0, 7]);
    assert.deepEqual(Array.from(REAL_TREE_DBH), [14, 0, 60, 1]);
  }
  // What the decoder could not read back is refused when written
  const tree = { x: 0, z: 0, species: 0, dbh: 10 };
  for (const wrong of [{ species: 9 }, { species: -1 }, { species: 1.5 }, { dbh: 61 }, { dbh: -1 }, { dbh: undefined },
    { x: 2 ** 27 }, { z: -(2 ** 27) - 1 }, { x: 0.5 }]) {
    assert.throws(() => pack([{ ...tree, ...wrong }]), RangeError);
  }
});

test('the genus of a tree gives its species class', async () => {
  const { speciesClass } = await tool;
  CLASSES.forEach(([name, genera], index) => {
    for (const genus of genera.split(' ')) {
      assert.equal(speciesClass(`${genus} species - common name`), index, `${genus} is drawn as ${name}`);
    }
  });
  for (const [name, index] of [
    ['Platanus x acerifolia - London planetree', 0],
    ['Gleditsia triacanthos var. inermis - Thornless honeylocust', 1],
    ['Pyrus calleryana - Callery pear', 2],
    ['Ginkgo biloba - maidenhair tree', 3],
    ['Quercus palustris - pin oak', 4],
    ["Ulmus minor 'Atinia' - English elm", 5],
    ['Tilia cordata - littleleaf linden', 6],
    ["Prunus serrulata 'Kwanzan' - 'Kwanzan' Japanese flowering cherry", 7],
    ['Metasequoia glyptostroboides - dawn redwood', OTHER],
    // Case and stray spaces do not matter
    ['QUERCUS RUBRA - NORTHERN RED OAK', 4], ['  acer rubrum - red maple', 0], ['Ginkgo', 3],
    // The whole first word is the genus, not its first letters
    ['Aceraceae - maple family', OTHER], ['Malusdomestica', OTHER], ['Black Quercus', OTHER],
    // A hybrid genus is named by its second word
    ['x Chitalpa tashkentensis - Chitalpa', OTHER], ['x Quercus', 4],
    ['Unknown - Unknown', OTHER], ['', OTHER], [' - ', OTHER], [undefined, OTHER], [null, OTHER], [42, OTHER]
  ]) assert.equal(speciesClass(name), index, String(name));
  // The module names the classes in the order of the byte
  assert.ok(moduleText.includes(`// Species classes: ${CLASSES.map(([name], index) => `${index} ${name}`).join(', ')}.`));
});

test('the thickest trunk wins a shared cell, and junk diameters are tamed', async () => {
  const { prepare } = await tool;
  const sharing = [row(10.1, 10.1, { dbh: '4', genusspecies: 'Ginkgo biloba - maidenhair tree' }),
    row(10.2, 10.2, { dbh: '30', genusspecies: 'Quercus palustris - pin oak' }),
    row(9.9, 9.9, { dbh: '12', genusspecies: 'Acer rubrum - red maple' })];
  // Equal trunks: the identified species first, the lower class between two of them
  const ties = [row(40, 40, { dbh: '9' }), row(40.1, 40.1, { dbh: '9', genusspecies: 'Tilia cordata - littleleaf linden' }),
    row(39.9, 40, { dbh: '9', genusspecies: 'Pyrus calleryana - Callery pear' })];
  for (const rows of [[...sharing, ...ties], [...ties, ...sharing].reverse()]) {
    const tally = {};
    assert.deepEqual(prepare(rows, frame, tally), [{ x: 20, z: 20, species: 4, dbh: 30, genus: 'quercus' },
      { x: 80, z: 80, species: 2, dbh: 9, genus: 'pyrus' }]);
    assert.equal(tally.shared, 4);
  }

  const diameters = [['22', 22], [7, 7], ['12.6', 13], ['0.3', 1], ['60', 60], ['61', 60], ['400', 60], ['2427', 60],
    ['0', 0], [undefined, 0], [null, 0], ['', 0], ['thick', 0], ['-3', 0], [NaN, 0]];
  const tally = {};
  const measured = prepare(diameters.map(([dbh], i) => row(i * 2 + 1, 1, { dbh })), frame, tally);
  assert.deepEqual(measured.map(tree => tree.dbh), diameters.map(([, inches]) => inches));
  assert.equal(tally.oversized, 3);
  assert.ok(measured.every(tree => tree.species === OTHER && tree.genus === ''));
});

test('the tree files are the ones the tool writes', async () => {
  const { pack, compress, moduleSource } = await tool;
  const { REAL_TREES, REAL_TREE_SPECIES, REAL_TREE_DBH } = await trees;
  // The decoded trees pack back into the very bytes of the file
  const decoded = Array.from(REAL_TREE_SPECIES, (species, i) =>
    ({ x: REAL_TREES[i * 2] * 2, z: REAL_TREES[i * 2 + 1] * 2, species, dbh: REAL_TREE_DBH[i] }));
  const packed = pack(decoded);
  assert.ok(packed.equals(gunzipSync(compressed)));
  // No timestamp and no operating system in the gzip header: the same trees always give the same file
  for (const file of [compressed, compress(packed)]) {
    assert.deepEqual(Array.from(file.subarray(0, 10)), [0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 255]);
  }
  assert.ok(compress(packed).equals(compress(packed)));
  assert.ok(gunzipSync(compress(packed)).equals(packed));
  // The module names its tool, its source, its snapshot and its count
  const [, digest] = /^\/\/ Snapshot SHA-256: ([0-9a-f]{64})$/m.exec(moduleText);
  assert.equal(moduleText, moduleSource({ count: COUNT, asset: 'tree-geodata.bin.gz', digest }));
  assert.ok(moduleText.startsWith('// Generated by tools/trees/build-tree-data.mjs; do not edit.\n' +
    '// NYC Parks Forestry Tree Points: https://data.cityofnewyork.us/resource/hn5i-inap.json\n'));
  assert.ok(moduleText.includes(`\n// ${COUNT.toLocaleString('en-US')} unique living trees`));
});

test('tree data reports HTTP and gzip failures', async () => {
  await assert.rejects(loadTrees(compressed, 404), /Tree data request failed: 404/);
  await assert.rejects(loadTrees(Buffer.from('not gzip')));
  await assert.rejects(loadTrees(compressed.subarray(0, compressed.length >> 1)));
});

test('tree data rejects damaged headers, truncated streams, trailing bytes and unknown values', async () => {
  const data = gunzipSync(compressed);
  const count = data.readUInt32LE(4), xLength = data.readUInt32LE(8), zLength = data.readUInt32LE(12);
  assert.equal(data.length, 16 + xLength + zLength + count * 2);
  const damaged = change => {
    const copy = Buffer.from(data);
    change(copy);
    return copy;
  };
  const invalid = {
    'short header': data.subarray(0, 8),
    'header alone': data.subarray(0, 16),
    'other version': damaged(copy => { copy[3]++; }),
    'previous format': damaged(copy => { copy.write('NYT1', 0, 'latin1'); }),
    'X stream past the end': damaged(copy => { copy.writeUInt32LE(data.length, 8); }),
    'Z stream past the end': damaged(copy => { copy.writeUInt32LE(data.length, 12); }),
    'count past the end': damaged(copy => { copy.writeUInt32LE(data.length, 4); }),
    'no tree': damaged(copy => { copy.writeUInt32LE(0, 4); }),
    'one tree too many': damaged(copy => { copy.writeUInt32LE(count + 1, 4); }),
    'one tree too few': damaged(copy => { copy.writeUInt32LE(count - 1, 4); }),
    // The file keeps its length, but the X stream now ends one byte late and the Z stream starts there
    'moved stream boundary': damaged(copy => { copy.writeUInt32LE(xLength + 1, 8); copy.writeUInt32LE(zLength - 1, 12); }),
    'overlong X delta': damaged(copy => { copy.fill(128, 16, 21); }),
    'overlong Z delta': damaged(copy => { copy.fill(128, 16 + xLength, 21 + xLength); }),
    'unfinished last delta': damaged(copy => { copy[16 + xLength + zLength - 1] |= 128; }),
    'truncated': data.subarray(0, data.length - 1),
    'trailing byte': Buffer.concat([data, Buffer.from([0])]),
    'unknown species': damaged(copy => { copy[16 + xLength + zLength + 5] = OTHER + 1; }),
    'impossible trunk': damaged(copy => { copy[data.length - 5] = 61; })
  };
  for (const [damage, bytes] of Object.entries(invalid)) {
    await assert.rejects(loadTrees(gzipSync(bytes)), /Invalid tree data/, damage);
    await assert.rejects(loadTrees(bytes), /Invalid tree data/, `${damage}, already inflated`);
  }
});
