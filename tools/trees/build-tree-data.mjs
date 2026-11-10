// Generate js/tree-geodata.js and js/tree-geodata.bin.gz: where every living tree of the detailed Manhattan map stands,
// which kind of tree it is and how thick its trunk is, from NYC Parks "Forestry Tree Points" (NYC Open Data, hn5i-inap).
//
// Usage: node tools/trees/build-tree-data.mjs [--fetch] <snapshot.json> [--output js/tree-geodata.js]
//   <snapshot.json>  the rows of the survey, a JSON array. It is about 45 MB and stays OUTSIDE the repository.
//   --fetch          download the snapshot to <snapshot.json> first (about 237,000 rows), then build
//   --output         the module to write; its data goes next to it, with the extension .bin.gz
//
// The source is a public Socrata API that needs no account and no token. The same snapshot by hand, one page at a time
// ($offset 0, 50000, 100000... until a page comes back short), the pages then joined into one JSON array:
//   curl -G -A overdraft-game-dev 'https://data.cityofnewyork.us/resource/hn5i-inap.json' \
//     --data-urlencode '$select=location,dbh,genusspecies,tpstructure,tpcondition' \
//     --data-urlencode '$where=within_box(location, 40.882, -74.03, 40.695, -73.90)' \
//     --data-urlencode '$order=objectid' --data-urlencode '$limit=50000' --data-urlencode '$offset=0'
//
// What is kept: full trees (no stump, no shaft, no retired record) that are not dead, inside the island polygon of
// js/nyc-geodata.js, in the frame of tools/geo-base.mjs. Positions are rounded to 0.5 m; when several trees share a
// cell the one with the thickest trunk stays. Trees are stored in Morton order, so neighbours stay close in the file.
//
// File layout NYT2 (then gzipped, level 9), integers little-endian:
//   u32 'NYT2' (0x3254594e), u32 count, u32 xLength, u32 zLength
//   xLength bytes   X of each tree as the difference from the previous tree, in 0.5 m cells, zigzag varint
//   zLength bytes   Z, same encoding
//   count bytes     species class of each tree, an index into SPECIES
//   count bytes     trunk diameter at breast height in inches, 1 to 60; 0 = unknown
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE = 'https://data.cityofnewyork.us/resource/hn5i-inap.json';
const QUERY = {
  $select: 'location,dbh,genusspecies,tpstructure,tpcondition',
  $where: 'within_box(location, 40.882, -74.03, 40.695, -73.90)',
  $order: 'objectid'
};
const PAGE = 50000;
const USER_AGENT = 'overdraft-game-dev';
const PRECISION = 0.5;
const MAGIC = 0x3254594e;
const MAX_DBH = 60;
const log = (...a) => console.log('[trees]', ...a);
const number = (n) => n.toLocaleString('en-US');
const inRepository = (file) => !/^\.\.(?:[/\\]|$)/.test(path.relative(ROOT, file));
const shown = (file) => (inRepository(file) ? path.relative(ROOT, file) : file);

// ---- Species -----------------------------------------------------------------------------------------------------------
// One class per silhouette the game draws, and the genera that wear it. The last class takes everything else:
// conifers, rare genera, unidentified trees.
export const SPECIES = [
  ['plane', 'Platanus Acer Liquidambar Liriodendron'],
  ['locust', 'Gleditsia Robinia Styphnolobium Sophora Gymnocladus Koelreuteria Fraxinus Ailanthus Juglans Carya Maackia ' +
    'Cladrastis Phellodendron Albizia'],
  ['pear', 'Pyrus Amelanchier Eucommia Nyssa Parrotia Fagus'],
  ['ginkgo', 'Ginkgo'],
  ['oak', 'Quercus Castanea'],
  ['elm', 'Ulmus Zelkova Carpinus Ostrya Celtis Betula Corylus Populus Salix Alnus'],
  ['linden', 'Tilia Cercis Catalpa Paulownia Morus Cercidiphyllum'],
  ['cherry', 'Prunus Malus Crataegus Cornus Magnolia Syringa Lagerstroemia Halesia Chionanthus Styrax'],
  ['other', '']
].map(([name, genera]) => ({ name, genera: genera.split(' ').filter(Boolean) }));
const OTHER = SPECIES.length - 1;
const CLASS_OF_GENUS = new Map(SPECIES.flatMap(({ genera }, index) => genera.map((genus) => [genus.toLowerCase(), index])));

// "Gleditsia triacanthos var. inermis - Thornless honeylocust" -> "gleditsia". The first word is the genus, except the
// "x" that marks a hybrid genus ("x Chitalpa tashkentensis - Chitalpa").
const genusOf = (genusspecies) => /^(?:[x×]\s+)?([a-z]+)/i.exec(String(genusspecies ?? '').trim())?.[1].toLowerCase() ?? '';
export const speciesClass = (genusspecies) => CLASS_OF_GENUS.get(genusOf(genusspecies)) ?? OTHER;

// Whole inches at breast height. The survey holds junk (nothing, 0, 400 and more): 0 stands for unknown, a measured
// trunk is at least 1, and nothing is thicker than the thickest trunks of the city.
function trunkInches(dbh) {
  const inches = Number(dbh);
  return Number.isFinite(inches) && inches > 0 ? Math.min(MAX_DBH, Math.max(1, Math.round(inches))) : 0;
}

// ---- Frame -------------------------------------------------------------------------------------------------------------
// The projection of the roads and buildings, sampled at three points (it is affine), and the island polygon
export async function loadFrame() {
  // The geodata generator narrates its whole run when imported
  const consoleLog = console.log;
  console.log = () => {};
  let toWorld, GEO;
  try {
    ({ toWorld } = await import('../geo-base.mjs'));
    ({ GEO } = await import('../../js/nyc-geodata.js'));
  } finally {
    console.log = consoleLog;
  }
  const lon0 = -73.98185, lat0 = 40.75318;
  const [ox, oz] = toWorld(lon0, lat0);
  const east = toWorld(lon0 + 1, lat0), north = toWorld(lon0, lat0 + 1);
  const ex = east[0] - ox, ez = east[1] - oz, nx = north[0] - ox, nz = north[1] - oz;
  const island = [];
  for (let i = 0; i < GEO.manhattan.length; i += 2) island.push([GEO.manhattan[i], GEO.manhattan[i + 1]]);
  return {
    project(lon, lat) {
      lon -= lon0;
      lat -= lat0;
      return [ox + lon * ex + lat * nx, oz + lon * ez + lat * nz];
    },
    island
  };
}

function inside(x, z, ring) {
  let hit = false;
  let [ax, az] = ring[ring.length - 1];
  for (const [bx, bz] of ring) {
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) hit = !hit;
    ax = bx;
    az = bz;
  }
  return hit;
}

// ---- Rows to trees -----------------------------------------------------------------------------------------------------
// frame: { project(lon, lat) -> [x, z] in metres, island: [[x, z], ...] }, see loadFrame.
// Returns the trees in Morton order: { x, z } in 0.5 m cells, species (class index), dbh (inches, 0 = unknown) and
// genus (lower case, for the report). tally, when given, receives how many rows each rule turned away.
export function prepare(rows, frame, tally = {}) {
  const { project, island } = frame;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of island) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  Object.assign(tally, { rows: rows.length, notFull: 0, dead: 0, unlocated: 0, outside: 0, shared: 0, oversized: 0 });
  const cells = new Map();
  for (const row of rows) {
    if (row.tpstructure !== 'Full') { tally.notFull++; continue; }
    if (row.tpcondition === 'Dead') { tally.dead++; continue; }
    const coordinates = row.location?.coordinates;
    const lon = Number(coordinates?.[0]), lat = Number(coordinates?.[1]);
    if (!Array.isArray(coordinates) || coordinates.length !== 2 || !Number.isFinite(lon) || !Number.isFinite(lat)) {
      tally.unlocated++;
      continue;
    }
    const [x, z] = project(lon, lat);
    if (!(x >= minX && x <= maxX && z >= minZ && z <= maxZ && inside(x, z, island))) { tally.outside++; continue; }
    // + 0: Math.round gives -0 just below zero
    const tree = {
      x: Math.round(x / PRECISION) + 0, z: Math.round(z / PRECISION) + 0,
      species: speciesClass(row.genusspecies), dbh: trunkInches(row.dbh), genus: genusOf(row.genusspecies)
    };
    if (Number(row.dbh) > MAX_DBH) tally.oversized++;
    // One tree per cell: the thickest trunk, and between equal trunks the identified species (lower class) first
    const key = `${tree.x},${tree.z}`;
    const held = cells.get(key);
    if (held) tally.shared++;
    if (!held || tree.dbh > held.dbh || (tree.dbh === held.dbh && tree.species < held.species)) cells.set(key, tree);
  }
  if (!cells.size) throw new Error('No living trees inside the detailed Manhattan map.');
  const trees = [...cells.values()];
  let ox = Infinity, oz = Infinity, span = 0;
  for (const { x, z } of trees) {
    ox = Math.min(ox, x);
    oz = Math.min(oz, z);
  }
  for (const { x, z } of trees) span = Math.max(span, x - ox, z - oz);
  const bits = 32 - Math.clz32(span);
  // Two interleaved coordinates must stay exact in a double
  if (span >= 2 ** 26) throw new RangeError('The trees span too many cells for a Morton order.');
  const morton = ({ x, z }) => {
    let code = 0;
    for (let i = bits - 1; i >= 0; i--) code = code * 4 + (((z - oz) >> i) & 1) * 2 + (((x - ox) >> i) & 1);
    return code;
  };
  return trees.map((tree) => [morton(tree), tree]).sort((a, b) => a[0] - b[0]).map(([, tree]) => tree);
}

// ---- Trees to bytes ----------------------------------------------------------------------------------------------------
export function pack(trees) {
  const xs = [], zs = [];
  function delta(bytes, value) {
    if (!Number.isInteger(value)) throw new RangeError('Tree positions must be whole cells.');
    value = value >= 0 ? value * 2 : -value * 2 - 1;
    // The decoder reads four bytes at most
    if (value >= 2 ** 28) throw new RangeError('Neighbouring trees must be less than 2^27 cells apart.');
    while (value > 127) {
      bytes.push((value & 127) | 128);
      value >>= 7;
    }
    bytes.push(value);
  }
  let x = 0, z = 0;
  for (const tree of trees) {
    if (!(Number.isInteger(tree.species) && tree.species >= 0 && tree.species < SPECIES.length)) throw new RangeError(`Unknown species class: ${tree.species}`);
    if (!(Number.isInteger(tree.dbh) && tree.dbh >= 0 && tree.dbh <= MAX_DBH)) throw new RangeError(`Trunk diameter out of range: ${tree.dbh}`);
    delta(xs, tree.x - x);
    delta(zs, tree.z - z);
    x = tree.x;
    z = tree.z;
  }
  const header = Buffer.alloc(16);
  header.writeUInt32LE(MAGIC, 0);
  header.writeUInt32LE(trees.length, 4);
  header.writeUInt32LE(xs.length, 8);
  header.writeUInt32LE(zs.length, 12);
  return Buffer.concat([header, Buffer.from(xs), Buffer.from(zs),
    Buffer.from(trees.map((tree) => tree.species)), Buffer.from(trees.map((tree) => tree.dbh))]);
}

// The same trees always give the same file: no timestamp (zlib writes none), and no trace of the machine
export function compress(bytes) {
  const compressed = gzipSync(bytes, { level: 9 });
  compressed.writeUInt32LE(0, 4); // MTIME
  compressed[9] = 255; // OS: unknown, where zlib names the platform it was built for
  return compressed;
}

export function moduleSource({ count, asset, digest }) {
  return `// Generated by tools/trees/build-tree-data.mjs; do not edit.
// NYC Parks Forestry Tree Points: ${SOURCE}
// Snapshot SHA-256: ${digest}
// ${number(count)} unique living trees: location quantized to 0.5 m, species class, trunk diameter.
// Species classes: ${SPECIES.map(({ name }, index) => `${index} ${name}`).join(', ')}.
const response = await fetch(new URL('./${asset}', import.meta.url));
if (!response.ok) throw new Error(\`Tree data request failed: \${response.status}\`);
// Servers that send .gz files as Content-Encoding: gzip hand over bytes the browser has already inflated
const body = new Uint8Array(await response.arrayBuffer());
const data = body[0] === 0x1f && body[1] === 0x8b
  ? new Uint8Array(await new Response(new Response(body).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  : body;
const invalidData = () => new Error('Invalid tree data.');
if (data.length < 16) throw invalidData();
const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
const count = header.getUint32(4, true);
const zStart = 16 + header.getUint32(8, true), speciesStart = zStart + header.getUint32(12, true);
// Every delta takes at least one byte, and the two bytes per tree that follow the streams end the file
if (header.getUint32(0, true) !== 0x${MAGIC.toString(16)} || count === 0 || count > zStart - 16 ||
  count > speciesStart - zStart || data.length !== speciesStart + count * 2) throw invalidData();

// NYT2 stores separate X/Z streams of signed coordinate deltas on a 0.5 m grid.
function stream(start, end) {
  let cursor = start;
  return {
    delta() {
      let value = 0, shift = 0, byte;
      do {
        if (cursor >= end || shift >= 28) throw invalidData();
        byte = data[cursor++];
        value |= (byte & 127) << shift;
        shift += 7;
      } while (byte & 128);
      return (value >>> 1) ^ -(value & 1);
    },
    done: () => cursor === end
  };
}
const xs = stream(16, zStart), zs = stream(zStart, speciesStart);
// x, z of each tree in metres
export const REAL_TREES = new Float32Array(count * 2);
let x = 0, z = 0;
for (let i = 0; i < REAL_TREES.length; i += 2) {
  x += xs.delta(); z += zs.delta();
  REAL_TREES[i] = x * 0.5;
  REAL_TREES[i + 1] = z * 0.5;
}
if (!xs.done() || !zs.done()) throw invalidData();

// One byte per tree, tree i being the pair i of REAL_TREES: its species class (see the list above), and the diameter
// of its trunk at breast height in inches (0 = unknown)
export const REAL_TREE_SPECIES = data.slice(speciesStart, speciesStart + count);
export const REAL_TREE_DBH = data.slice(speciesStart + count);
if (REAL_TREE_SPECIES.some((species) => species > ${OTHER}) || REAL_TREE_DBH.some((inches) => inches > ${MAX_DBH})) throw invalidData();
`;
}

// ---- Download ----------------------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Socrata answers 503 now and then under load: retry before giving up
async function getJSON(query) {
  const url = new URL(SOURCE);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(180000) });
      if (response.ok) return await response.json();
      last = new Error(`HTTP ${response.status}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      last = error;
    }
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(`${SOURCE}: ${last.message}`);
}
const countRows = async () => Number((await getJSON({ $select: 'count(*)', $where: QUERY.$where }))[0].count);

async function download(file) {
  if (inRepository(file)) throw new Error('The snapshot must stay outside the repository.');
  const expected = await countRows();
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await getJSON({ ...QUERY, $limit: String(PAGE), $offset: String(offset) });
    for (const row of page) rows.push(JSON.stringify(row));
    log(`downloaded ${number(rows.length)} of ${number(expected)} rows`);
    if (page.length < PAGE) break;
  }
  // Pages cut by $offset only fit together while the survey does not change
  if (rows.length !== expected || await countRows() !== expected) {
    throw new Error(`The survey changed during the download (${rows.length} rows for ${expected} announced): run --fetch again.`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write aside first: an interrupted run must not leave half a snapshot under the name of a whole one
  fs.writeFileSync(`${file}.part`, `[\n${rows.join(',\n')}\n]\n`);
  fs.renameSync(`${file}.part`, file);
  log(`snapshot ${file}`);
}

// ---- Report ------------------------------------------------------------------------------------------------------------
const DBH_BINS = [['0 (unknown)', 0, 0], ['1-3', 1, 3], ['4-6', 4, 6], ['7-12', 7, 12], ['13-18', 13, 18], ['19-24', 19, 24],
  ['25-36', 25, 36], ['37+', 37, MAX_DBH]];
function report(trees, tally) {
  const line = (label, n) => console.log(`  ${label.padEnd(14)}${number(n).padStart(8)}${(100 * n / trees.length).toFixed(1).padStart(7)} %`);
  log(`${number(tally.rows)} rows: ${number(tally.notFull)} not a full tree, ${number(tally.dead)} dead, ` +
    `${number(tally.unlocated)} without a location, ${number(tally.outside)} outside the island, ` +
    `${number(tally.shared)} sharing the cell of another tree`);
  log(`${number(trees.length)} trees kept, by species class:`);
  SPECIES.forEach(({ name }, index) => line(`${index} ${name}`, trees.filter((tree) => tree.species === index).length));
  const others = new Map();
  for (const tree of trees) if (tree.species === OTHER) others.set(tree.genus, (others.get(tree.genus) || 0) + 1);
  log(`the 25 most common genera of "other" (${others.size} in all):`);
  for (const [genus, n] of [...others].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 25)) {
    line(genus ? genus[0].toUpperCase() + genus.slice(1) : '(none)', n);
  }
  log(`trunk diameter in inches (${number(tally.oversized)} above ${MAX_DBH} in the survey, stored as ${MAX_DBH}):`);
  for (const [label, low, high] of DBH_BINS) line(label, trees.filter((tree) => tree.dbh >= low && tree.dbh <= high).length);
}

// ---- Command line ------------------------------------------------------------------------------------------------------
async function main(argv) {
  const usage = 'Usage: node tools/trees/build-tree-data.mjs [--fetch] <snapshot.json> [--output js/tree-geodata.js]';
  let fetchFirst = false, snapshot = null, output = path.join(ROOT, 'js/tree-geodata.js');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fetch') fetchFirst = true;
    else if (argv[i] === '--output' && argv[i + 1]) output = path.resolve(argv[++i]);
    else if (!argv[i].startsWith('--') && !snapshot) snapshot = path.resolve(argv[i]);
    else throw new Error(usage);
  }
  if (!snapshot) throw new Error(usage);
  if (fetchFirst) await download(snapshot);

  const source = fs.readFileSync(snapshot);
  const rows = JSON.parse(source);
  if (!Array.isArray(rows) || !rows.length) throw new Error('Expected a nonempty JSON array of tree locations.');
  const tally = {};
  const trees = prepare(rows, await loadFrame(), tally);
  const asset = output.replace(/\.[^./\\]*$/, '') + '.bin.gz';
  const compressed = compress(pack(trees));
  const text = moduleSource({ count: trees.length, asset: path.basename(asset), digest: createHash('sha256').update(source).digest('hex') });
  fs.writeFileSync(asset, compressed);
  fs.writeFileSync(output, text);
  report(trees, tally);
  log(`${shown(asset)}: ${number(compressed.length)} bytes; ${shown(output)}: ${number(Buffer.byteLength(text))} bytes`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[trees] ${error.message}`);
    process.exit(1);
  });
}
