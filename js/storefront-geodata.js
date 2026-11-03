// Generated data, built by tools/shops/build-storefronts.mjs; this module only reads it.
// NYC Open Data: Storefronts Reported Vacant or Not (DOF, Local Law 157) and DOHMH Restaurant Inspection Results.
// Every Manhattan storefront on the detailed island: the property's position, the nearest point of the street its
// address faces, and a kind of shop (js/storefront-types.js). Positions in 0.5 m steps.
const response = await fetch(new URL('./storefront-geodata.bin.gz', import.meta.url));
if (!response.ok) throw new Error(`Storefront data request failed: ${response.status}`);
// Servers that send .gz files as Content-Encoding: gzip hand over bytes the browser has already inflated
const body = new Uint8Array(await response.arrayBuffer());
const data = body[0] === 0x1f && body[1] === 0x8b
  ? new Uint8Array(await new Response(new Response(body).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  : body;
const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
const count = data.length >= 8 ? view.getUint32(4, true) : 0;
if (data.length < 8 || view.getUint32(0, true) !== 0x3153594e || data.length !== 8 + count * 9) {
  throw new Error('Invalid storefront data.');
}
const column = (k) => {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(8 + k * count * 2 + i * 2, true) / 2;
  return out;
};

const STOREFRONTS = {
  count,
  x: column(0),
  z: column(1),
  streetX: column(2),
  streetZ: column(3),
  type: data.slice(8 + count * 8, 8 + count * 9)
};

export { STOREFRONTS };
