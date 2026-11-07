const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { Script } = require('node:vm');
const { gunzipSync } = require('node:zlib');

const compressed = readFileSync(join(__dirname, '../js/street-geodata.bin.gz'));
const source = readFileSync(join(__dirname, '../js/street-geodata.js'), 'utf8')
  .replace('import.meta.url', JSON.stringify('https://example.test/city/js/street-geodata.js'))
  .replace(/^export \{ STREET \};$/m, '');
const script = new Script(`(async () => { ${source}\nreturn STREET; })()`);

function loadStreet(bytes = compressed, status = 200) {
  return script.runInNewContext({ URL, Response, DecompressionStream, TextDecoder,
    fetch: async (url) => {
      assert.equal(url.href, 'https://example.test/city/js/street-geodata.bin.gz');
      return new Response(bytes, { status });
    }
  });
}

// The file read on its own, without the game's loader
const raw = gunzipSync(compressed);
const headerLength = raw.readUInt32LE(0);
const header = JSON.parse(raw.subarray(4, 4 + headerLength).toString('utf8'));
const STRIDES = { hydrant: 2, shelter: 2, busstop: 2, newsstand: 2, bikerack: 3, bench: 2, linknyc: 2, meter: 2, shed: 3, dining: 2 };
const FLOORS = { hydrant: 3000, shed: 1500, busstop: 1500 };

test('the header reads and names a source for every kind', () => {
  assert.equal((4 + headerLength) % 4, 0, 'the float blocks start on a 4-byte boundary');
  assert.equal(header.version, 1);
  assert.equal(header.frame, 'game metres');
  assert.match(header.retrieved, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(compressed.length < 512 * 1024, `${compressed.length} bytes`);
  let floats = 0;
  for (const [kind, { offset, stride, count, fields }] of Object.entries(header.kinds)) {
    assert.ok(kind in STRIDES, `unknown kind ${kind}`);
    assert.equal(stride, STRIDES[kind], `${kind} stride`);
    assert.equal(fields.length, stride);
    assert.deepEqual(fields.slice(0, 2), ['x', 'z']);
    assert.equal(offset, floats, `${kind} follows the previous kind`);
    floats += stride * count;
    const credited = header.sources.filter((s) => s.kind === kind);
    assert.ok(credited.length > 0, `${kind} has a source`);
    for (const s of credited) {
      assert.ok(s.name && s.agency && s.licence, `${kind} source is named and licensed`);
      assert.match(s.id, /^[a-z0-9]{4}-[a-z0-9]{4}$/);
      assert.match(s.url, /^https:\/\/data\.(cityofnewyork\.us|ny\.gov)\/d\/[a-z0-9]{4}-[a-z0-9]{4}$/);
      assert.match(s.retrieved, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
  assert.equal(raw.length, 4 + headerLength + floats * 4, 'nothing follows the last kind');
  assert.ok(header.kinds.hydrant && header.kinds.shed && header.kinds.busstop, 'the three main kinds are present');
});

test('every kind holds a plausible number of points, all finite and on the island', async () => {
  const { ISLAND_BOUNDS } = await import(pathToFileURL(join(__dirname, '../js/city-config.js')).href);
  const floats = new Float32Array(raw.buffer.slice(raw.byteOffset + 4 + headerLength, raw.byteOffset + raw.length));
  for (const [kind, { offset, stride, count }] of Object.entries(header.kinds)) {
    assert.ok(count > (FLOORS[kind] ?? 50), `${kind}: ${count} points`);
    const seen = new Set();
    for (let i = 0; i < count; i++) {
      const x = floats[offset + i * stride], z = floats[offset + i * stride + 1];
      assert.ok(Number.isFinite(x) && Number.isFinite(z), `${kind} #${i} is finite`);
      assert.ok(x >= ISLAND_BOUNDS.minX && x <= ISLAND_BOUNDS.maxX && z >= ISLAND_BOUNDS.minZ && z <= ISLAND_BOUNDS.maxZ,
        `${kind} #${i} at ${x}, ${z} is on the island`);
      seen.add(`${x},${z}`);
      if (kind === 'bikerack') {
        const racks = floats[offset + i * stride + 2];
        assert.ok(Number.isInteger(racks) && racks >= 1 && racks < 100, `bike racks ${racks}`);
      }
      if (kind === 'shed') {
        const length = floats[offset + i * stride + 2];
        assert.ok(Number.isFinite(length) && length >= 0 && length < 1000, `shed length ${length}`);
      }
    }
    assert.equal(seen.size, count, `${kind}: one point per spot`);
  }
  // Sheds are the city's most common street structure: thousands of them, spread from the Battery to Harlem
  const shed = header.kinds.shed;
  const zs = Array.from({ length: shed.count }, (_, i) => floats[shed.offset + i * shed.stride + 1]);
  assert.ok(Math.min(...zs) < -4000 && Math.max(...zs) > 4000, 'sheds uptown and downtown');
});

test('the game loader exposes every kind exactly as the file stores it', async () => {
  const STREET = await loadStreet();
  assert.equal(STREET.version, 1);
  assert.equal(STREET.frame, 'game metres');
  assert.equal(STREET.retrieved, header.retrieved);
  assert.equal(STREET.sources.length, header.sources.length);
  assert.deepEqual(Object.keys(STREET.kinds), Object.keys(header.kinds));
  for (const [kind, { offset, stride, count }] of Object.entries(header.kinds)) {
    const loaded = STREET.kinds[kind];
    assert.equal(loaded.stride, stride);
    assert.equal(loaded.count, count);
    assert.equal(loaded.data.length, stride * count);
    const start = 4 + headerLength + offset * 4;
    for (let i = 0; i < loaded.data.length; i += 97) assert.equal(loaded.data[i], raw.readFloatLE(start + i * 4), `${kind}[${i}]`);
    assert.equal(loaded.data.at(-1), raw.readFloatLE(start + (loaded.data.length - 1) * 4));
  }
});

test('the loader accepts bytes the server already inflated and refuses damaged data', async () => {
  const inflated = await loadStreet(raw);
  assert.equal(inflated.kinds.hydrant.count, header.kinds.hydrant.count);
  await assert.rejects(loadStreet(raw.subarray(0, raw.length - 4)), /Invalid street furniture data/);
  await assert.rejects(loadStreet(raw.subarray(0, 2)), /Invalid street furniture data/);
  await assert.rejects(loadStreet(compressed, 404), /request failed: 404/);
});
