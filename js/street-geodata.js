// Generated data, built by tools/street/build-street-data.mjs; this module only reads it.
// NYC Open Data and the MTA (Open NY): where Manhattan's real street furniture stands on the detailed island, one
// kind per dataset (hydrant, shelter, busstop, newsstand, bikerack, bench, linknyc, meter, shed, dining).
// STREET.kinds[name] = { stride, count, fields, data }: data holds count points of stride floats each, in game metres
// (x = grid east, z = grid south), then the kind's own fields (bikerack: racks at that spot; shed: length in metres,
// 0 when the filing does not state it). Sheds and outdoor dining stand on the wall of their building facing the street.
// File: uint32 LE header length n, n bytes of JSON header (space-padded to 4 bytes), then the kinds' Float32 LE blocks.
const response = await fetch(new URL('./street-geodata.bin.gz', import.meta.url));
if (!response.ok) throw new Error(`Street furniture data request failed: ${response.status}`);
// Servers that send .gz files as Content-Encoding: gzip hand over bytes the browser has already inflated
const body = new Uint8Array(await response.arrayBuffer());
const data = body[0] === 0x1f && body[1] === 0x8b
  ? new Uint8Array(await new Response(new Response(body).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  : body;
const invalidData = () => new Error('Invalid street furniture data.');
const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
const headerLength = data.length >= 4 ? view.getUint32(0, true) : 0;
const start = 4 + headerLength;
if (headerLength === 0 || start % 4 !== 0 || start > data.length) throw invalidData();
const header = JSON.parse(new TextDecoder().decode(data.subarray(4, start)));
if (header.version !== 1 || header.frame !== 'game metres' || !header.kinds) throw invalidData();

const kinds = {};
let floats = 0;
for (const [name, { offset, stride, count, fields }] of Object.entries(header.kinds)) {
  if (!(stride >= 2) || !(count >= 0) || offset !== floats) throw invalidData();
  const values = new Float32Array(stride * count);
  const base = start + offset * 4;
  if (base + values.length * 4 > data.length) throw invalidData();
  for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(base + i * 4, true);
  kinds[name] = { stride, count, fields, data: values };
  floats += values.length;
}
if (start + floats * 4 !== data.length) throw invalidData();

const STREET = {
  version: header.version,
  frame: header.frame,
  retrieved: header.retrieved,
  sources: header.sources,
  kinds
};

export { STREET };
