// Generated data, built by tools/buildings/build-styles.mjs; this module only reads it.
// NYC DCP PLUTO and © OpenStreetMap contributors (ODbL). For every building of js/building-geodata.js, in its order:
// its lot's building class, floors, year built, historic district and landmark status, and what mappers recorded of
// its colour, material, roof and parts (outline and heights of each tier of a stepped tower).
import { REAL_BUILDINGS } from './building-geodata.js';

const response = await fetch(new URL('./building-styles.bin.gz', import.meta.url));
if (!response.ok) throw new Error(`Building style data request failed: ${response.status}`);
// Servers that send .gz files as Content-Encoding: gzip hand over bytes the browser has already inflated
const body = new Uint8Array(await response.arrayBuffer());
const data = body[0] === 0x1f && body[1] === 0x8b
  ? new Uint8Array(await new Response(new Response(body).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  : body;
const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
const invalid = () => new Error('Invalid building style data.');
if (data.length < 12 || view.getUint32(0, true) !== 0x3153424e || view.getUint32(4, true) !== REAL_BUILDINGS.length) throw invalid();
// The data was made for these very buildings: the first corner of each, folded together
let check = 0;
for (const b of REAL_BUILDINGS) check = (check * 31 + Math.round(b.polygons[0].outer[0].x * 2) + Math.round(b.polygons[0].outer[0].z * 2) * 7) >>> 0;
if (view.getUint32(8, true) !== check) throw invalid();

let cursor = 12;
function uint() {
  let value = 0, scale = 1, byte;
  do {
    if (cursor >= data.length) throw invalid();
    byte = data[cursor++];
    value += (byte & 127) * scale;
    scale *= 128;
  } while (byte & 128);
  return value;
}
const sint = () => { const v = uint(); return v % 2 ? -(v + 1) / 2 : v / 2; };
const rgb = () => { const v = uint(); return v ? v - 1 : -1; };

const districtCount = uint();
const nameLength = uint();
const nameBytes = data.subarray(cursor, cursor + nameLength);
cursor += nameLength;
const DISTRICTS = JSON.parse(new TextDecoder().decode(nameBytes));
if (DISTRICTS.length !== districtCount) throw invalid();

const MATERIALS = ['', 'brick', 'glass', 'stone', 'limestone', 'concrete', 'metal', 'plaster', 'marble', 'sandstone', 'granite', 'wood', 'masonry'];
const ROOFS = ['', 'flat', 'gabled', 'pyramidal', 'skillion', 'hipped', 'dome', 'mansard', 'round', 'onion', 'cone'];

// PLUTO building class back to its two characters ('D4'), '' when unknown
const className = (code) => (code ? String.fromCharCode(64 + Math.floor((code - 1) / 40)) + ((code - 1) % 40).toString(36).toUpperCase() : '');

const BUILDING_FACTS = REAL_BUILDINGS.map(() => {
  const cls = className(uint()), floors = uint(), year = uint(), hist = uint(), landmark = uint() === 1, units = uint();
  const colour = rgb(), material = MATERIALS[uint()] ?? '', roof = ROOFS[uint()] ?? '', roofColour = rgb();
  const parts = [];
  for (let n = uint(); n > 0; n--) {
    const base = uint() / 10, top = uint() / 10, partColour = rgb(), partRoof = ROOFS[uint()] ?? '', partMaterial = MATERIALS[uint()] ?? '';
    const ring = [];
    let x = 0, z = 0;
    for (let k = uint(); k > 0; k--) { x += sint(); z += sint(); ring.push({ x: x / 2, z: z / 2 }); }
    parts.push({ base, top, colour: partColour, roof: partRoof, material: partMaterial, ring });
  }
  return { cls, floors, year, district: hist ? DISTRICTS[hist - 1] : '', landmark, units, colour, material, roof, roofColour, parts };
});
if (cursor !== data.length) throw invalid();

export { BUILDING_FACTS, DISTRICTS };
