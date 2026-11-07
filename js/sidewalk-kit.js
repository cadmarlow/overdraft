import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, color, mix, smoothstep, step, texture, uv, vec2, vec3 } from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';

// The street furniture of a New York sidewalk, built in code at the real sizes of the real things: parking regulation
// signs, the green wire litter baskets, newspaper honor boxes, muni-meters, bike racks and the bikes locked to them,
// LinkNYC kiosks, bus shelters and stop signs, newsstands, benches, subway ventilation grates, standpipes on the
// building fronts, cellar doors, tree guards, sidewalk sheds (scaffolding) with their bracing and string lights, the
// dumpsters, cones and barriers of a building site, café tables and the roadway dining sheds.
//
// One 1024 px atlas carries every painted surface: solid swatches, the sign plates, the bus flag, a poster, the grate
// bars, a newsstand front; so every opaque part draws with one of two materials (painted metal, matte) and one call
// per part per cell. Tinted parts map onto the white swatch and take their colour from the instance colour.

const ATLAS = 1024, TILE = 256, SWATCH = 64; // 4 x 4 tiles; tile (0, 0) holds 16 swatches of 64 px
const SW = { white: 0, black: 1, orange: 2, dark: 3, brass: 4, green: 5, rust: 6, light: 7, blue: 8, yellow: 9, red: 10, navy: 11, plywood: 12, busblue: 13, concrete: 14, tan: 15 };
const SWATCH_RGB = ['#ffffff', '#1a1a1c', '#f26d1f', '#3a3d40', '#a0783c', '#2f6b3a', '#8c3b25', '#b8bcc0', '#2f5d9a', '#e8b820', '#c8322a', '#1f3a66', '#2c5a37', '#0b4a9c', '#a8a49c', '#c9b48a'];
const TILES = { sign0: [1, 0], sign1: [2, 0], sign2: [3, 0], sign3: [0, 1], busflag: [1, 1], news: [2, 1], meterface: [3, 1], ad: [0, 2], grate: [2, 2], screen: [3, 2], newsstand: [1, 3], plywood: [2, 3] };

// ---- UV mapping into the atlas ---------------------------------------------------------------------------------------
// Puts a geometry's own 0..1 uvs into an atlas rectangle (x0, y0, w, h in tiles; atlas y up = canvas y down)
function mapUV(g, tx, ty, tw = 1, th = 1) {
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, (tx + a.getX(i) * tw) / 4, 1 - (ty + th - a.getY(i) * th) / 4);
  return g;
}
// Every vertex on one swatch (a solid colour)
function swatch(g, index) {
  const a = g.attributes.uv;
  const u = ((index % 4) + 0.5) * SWATCH / ATLAS, v = 1 - (Math.floor(index / 4) + 0.5) * SWATCH / ATLAS;
  for (let i = 0; i < a.count; i++) a.setXY(i, u, v);
  return g;
}
// Vertex colour white: the atlas (and the instance colour) decide
function white(g) {
  const values = new Float32Array(g.attributes.position.count * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(values, 3));
  return g;
}
const box = (w, h, d, x = 0, y = 0, z = 0, sw = SW.white) => white(swatch(new THREE.BoxGeometry(w, h, d).translate(x, y, z), sw));
const cyl = (rt, rb, h, x = 0, y = 0, z = 0, seg = 8, sw = SW.white) => white(swatch(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z), sw));
const tube = (r, ax, ay, az, bx, by, bz, seg = 6, sw = SW.white) => {
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.translate(0, len / 2, 0);
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(ax, ay, az);
  return white(swatch(g, sw));
};
const plane = (w, h, tile, tw = 1, th = 1) => white(mapUV(new THREE.PlaneGeometry(w, h), tile[0], tile[1], tw, th));
function merged(parts) {
  const g = mergeGeometries(parts.filter(Boolean));
  for (const p of parts) if (p) p.dispose();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// ---- The atlas ---------------------------------------------------------------------------------------------------------
function drawAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  // swatches
  SWATCH_RGB.forEach((hex, i) => { ctx.fillStyle = hex; ctx.fillRect((i % 4) * SWATCH, Math.floor(i / 4) * SWATCH, SWATCH, SWATCH); });
  const tile = (name, draw) => {
    const [tx, ty] = TILES[name];
    ctx.save();
    ctx.translate(tx * TILE, ty * TILE);
    draw(ctx);
    ctx.restore();
  };
  const plate = (bg, fg, lines, slash) => (ctx) => {
    ctx.fillStyle = '#4a5750'; ctx.fillRect(0, 0, TILE, TILE); // the strip at the left is the post's grey
    ctx.fillStyle = bg; ctx.fillRect(28, 0, TILE - 28, TILE);
    ctx.strokeStyle = fg; ctx.lineWidth = 5; ctx.strokeRect(34, 6, TILE - 40, TILE - 12);
    ctx.fillStyle = fg; ctx.textAlign = 'center';
    const cx = 28 + (TILE - 28) / 2;
    lines.forEach(([t, size, dy, bold]) => { ctx.font = `${bold ? 'bold ' : ''}${size}px Inter, Arial, sans-serif`; ctx.fillText(t, cx, dy); });
    if (slash) { ctx.strokeStyle = fg; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(cx, 118, 70, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx - 50, 68); ctx.lineTo(cx + 50, 168); ctx.stroke(); }
  };
  tile('sign0', plate('#f5f3ee', '#c8322a', [['NO', 40, 52, true], ['STANDING', 34, 196, true], ['ANYTIME', 22, 232, true]], true));
  tile('sign1', plate('#f5f3ee', '#c8322a', [['NO PARKING', 30, 44, true], ['9:30-11AM', 28, 100, true], ['MON & THURS', 24, 140, true], ['STREET', 20, 190], ['CLEANING', 20, 215]]));
  tile('sign2', plate('#f5f3ee', '#1f6f3a', [['2 HOUR', 40, 70, true], ['PARKING', 34, 120, true], ['8AM-7PM', 24, 170, true], ['EXCEPT SUNDAY', 18, 215]]));
  tile('sign3', plate('#f5f3ee', '#c8322a', [['NO', 40, 52, true], ['STOPPING', 32, 196, true], ['BUS STOP', 24, 232, true]], true));
  tile('busflag', (ctx) => {
    ctx.fillStyle = '#0b4a9c'; ctx.fillRect(0, 0, TILE, TILE * 2);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = 'bold 54px Inter, Arial, sans-serif'; ctx.fillText('BUS', TILE / 2, 90); ctx.fillText('STOP', TILE / 2, 150);
    ctx.fillRect(30, 190, TILE - 60, 4);
    ctx.font = 'bold 40px Inter, Arial, sans-serif'; ctx.fillStyle = '#ffd200'; ctx.fillText('M1 M2 M3', TILE / 2, 260); ctx.fillText('M4 Q32', TILE / 2, 320);
    ctx.fillStyle = '#fff'; ctx.font = '26px Inter, Arial, sans-serif'; ctx.fillText('NO STANDING', TILE / 2, 420); ctx.fillText('BUS STOP', TILE / 2, 460);
  });
  tile('news', (ctx) => {
    ctx.fillStyle = '#e9e4d8'; ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = '#111'; ctx.font = 'italic bold 40px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('The Ledger', TILE / 2, 52);
    ctx.fillStyle = '#333'; for (let i = 0; i < 9; i++) ctx.fillRect(20, 80 + i * 18, TILE - 40 - (i % 3) * 30, 8);
    ctx.fillStyle = '#c8322a'; ctx.font = 'bold 22px Inter, Arial, sans-serif'; ctx.fillText('OVERDRAFT', TILE / 2, TILE - 20);
  });
  tile('meterface', (ctx) => {
    ctx.fillStyle = '#0d1a2a'; ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = '#9fd3ff'; ctx.fillRect(40, 60, TILE - 80, 70);
    ctx.fillStyle = '#1b1b1b'; ctx.font = 'bold 44px monospace'; ctx.textAlign = 'center'; ctx.fillText('PAID', TILE / 2, 112);
    ctx.fillStyle = '#d0d4d8'; for (let i = 0; i < 4; i++) ctx.fillRect(48 + i * 42, 160, 32, 32);
  });
  tile('ad', (ctx) => {
    ctx.fillStyle = '#f4efe6'; ctx.fillRect(0, 0, TILE, TILE * 2);
    ctx.fillStyle = '#d9412f'; ctx.fillRect(0, 0, TILE, 190);
    ctx.fillStyle = '#ffffff'; ctx.font = 'italic bold 52px Inter, Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('VALMONT', TILE / 2, 100); ctx.font = 'bold 24px Inter, Arial, sans-serif'; ctx.fillText('LA NOUVELLE ÉCUME', TILE / 2, 150);
    ctx.fillStyle = '#1b1b1b'; ctx.font = 'bold 34px Inter, Arial, sans-serif'; ctx.fillText('CHAQUE DETTE', TILE / 2, 300); ctx.fillText('SE PAIE.', TILE / 2, 345);
    ctx.fillStyle = '#2d6fb5'; ctx.fillRect(40, 400, TILE - 80, 70); ctx.fillStyle = '#fff'; ctx.font = 'bold 28px Inter, Arial, sans-serif'; ctx.fillText('GRÉVILLE', TILE / 2, 446);
  });
  tile('grate', (ctx) => {
    ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = '#4a4b4d'; for (let i = 0; i < 18; i++) ctx.fillRect(0, i * (TILE / 18), TILE, TILE / 18 * 0.45);
    ctx.fillStyle = '#5a5b5d'; ctx.fillRect(0, 0, 6, TILE); ctx.fillRect(TILE - 6, 0, 6, TILE);
  });
  tile('screen', (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, TILE * 2);
    g.addColorStop(0, '#1b3a6b'); g.addColorStop(0.5, '#2d6fb5'); g.addColorStop(1, '#0d2244');
    ctx.fillStyle = g; ctx.fillRect(0, 0, TILE, TILE * 2);
    ctx.fillStyle = '#e8f1ff'; ctx.font = 'bold 44px Inter, Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('MANHATTAN', TILE / 2, 110); ctx.font = '28px Inter, Arial, sans-serif'; ctx.fillText('WI-FI GRATUIT', TILE / 2, 160);
    ctx.fillStyle = '#ffffff22'; for (let i = 0; i < 6; i++) ctx.fillRect(24, 220 + i * 44, TILE - 48, 26);
    ctx.fillStyle = '#ffd166'; ctx.font = 'bold 36px Inter, Arial, sans-serif'; ctx.fillText('OVERDRAFT', TILE / 2, TILE * 2 - 60);
  });
  tile('newsstand', (ctx) => {
    // racks of magazines: rows of bright covers behind the counter
    ctx.fillStyle = '#1f3a2a'; ctx.fillRect(0, 0, TILE, TILE);
    const hues = ['#d9412f', '#2d6fb5', '#e8b820', '#f0f0f0', '#2f7d4e', '#d98a1f', '#6a3fa0', '#111'];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { ctx.fillStyle = hues[(r * 7 + c * 3) % hues.length]; ctx.fillRect(8 + c * 41, 10 + r * 60, 34, 50); ctx.fillStyle = '#ffffffaa'; ctx.fillRect(12 + c * 41, 14 + r * 60, 26, 8); }
  });
  tile('plywood', (ctx) => {
    ctx.fillStyle = '#2c5a37'; ctx.fillRect(0, 0, TILE, TILE);
    ctx.fillStyle = '#24492d'; for (let i = 0; i < 5; i++) ctx.fillRect(0, i * 52, TILE, 3);
    ctx.fillStyle = '#35683f'; for (let i = 0; i < 40; i++) ctx.fillRect((i * 37) % TILE, (i * 53) % TILE, 14, 2);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function createKitMaterials() {
  const atlas = drawAtlas();
  const painted = new THREE.MeshStandardNodeMaterial({ map: atlas, vertexColors: true, roughness: 0.5, metalness: 0.35 });
  const matte = new THREE.MeshStandardNodeMaterial({ map: atlas, vertexColors: true, roughness: 0.86, metalness: 0.04 });
  // Signs: per instance, the two plates pick their design (instance attribute `tiles`: top x, y, bottom x, y in tiles;
  // the post keeps its grey strip whatever the tile). Vertex attribute `plate`: 0 post, 1 top plate, 2 bottom plate.
  const sign = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25, side: THREE.DoubleSide });
  {
    const tiles = attribute('tiles', 'vec4');
    const plate = attribute('plate', 'float');
    const offset = mix(tiles.xy, tiles.zw, step(1.5, plate)).mul(step(0.5, plate));
    const shifted = vec2(uv().x.add(offset.x.div(4)), uv().y.sub(offset.y.div(4)));
    sign.colorNode = texture(atlas, shifted).rgb;
  }
  const glass = new THREE.MeshPhysicalNodeMaterial({ color: 0x9fb4bd, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  glass.envMapIntensity = 1.6;
  // Screens, lamps and lit windows: pale by day, lit after dusk (instance colour sets the warmth)
  const glow = new THREE.MeshBasicNodeMaterial({ vertexColors: true });
  const night = smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow);
  glow.colorNode = texture(atlas, uv()).rgb.mul(mix(0.45, 1.9, night));
  return { painted, matte, sign, glass, glow, atlas };
}

// ---- Parts ---------------------------------------------------------------------------------------------------------------
// { geometry, material, castShadow, colour (default instance colour), far (drawn from afar: 480 m cells), attr }
function createKitParts() {
  const P = {};
  const tinted = (geometry, colour, extra = {}) => ({ geometry, material: 'painted', castShadow: false, colour, ...extra });
  const fixed = (geometry, extra = {}) => ({ geometry, material: 'painted', castShadow: false, colour: 0xffffff, ...extra });
  const mattePart = (geometry, extra = {}) => ({ geometry, material: 'matte', castShadow: false, colour: 0xffffff, ...extra });

  // Parking regulation sign: post 2.9 m + two 0.3 m plates at 2.45 and 2.1 m; uvs of the post inside each tile's grey strip
  {
    const post = new THREE.BoxGeometry(0.06, 2.9, 0.04).translate(0, 1.45, 0);
    const pa = post.attributes.uv; for (let i = 0; i < pa.count; i++) pa.setXY(i, (1 + 0.04) / 4, 1 - 0.5 / 4);
    const plateGeo = (y) => { const g = new THREE.PlaneGeometry(0.3, 0.3).translate(0, y, 0.03); const a = g.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, (1 + 0.12 + a.getX(i) * 0.86) / 4, 1 - (0 + 1 - a.getY(i)) / 4); return g; };
    const top = plateGeo(2.45), bottom = plateGeo(2.1);
    const tag = (g, v) => g.setAttribute('plate', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1));
    tag(post, 0); tag(top, 1); tag(bottom, 2);
    P.sign = { geometry: merged([white(post), white(top), white(bottom)]), material: 'sign', castShadow: false, colour: 0xffffff, attr: { name: 'tiles', size: 4 } };
  }
  // The green wire litter basket of every corner (0.84 m tall, 0.6 m across)
  P.basket = tinted(merged([cyl(0.3, 0.27, 0.8, 0, 0.42, 0, 12).rotateY(0.2), cyl(0.31, 0.31, 0.03, 0, 0.83, 0, 12), cyl(0.28, 0.28, 0.03, 0, 0.03, 0, 12), box(0.56, 0.02, 0.02, 0, 0.03, 0), box(0.02, 0.02, 0.56, 0, 0.03, 0)]), 0x2f6b3a);
  // Three newspaper honor boxes side by side, each its own colour, a window of news on the front
  {
    const one = (x, sw) => [box(0.45, 0.92, 0.5, x, 0.6, 0, sw), box(0.47, 0.06, 0.52, x, 1.08, 0, SW.dark), cyl(0.02, 0.02, 0.14, x + 0.18, 0.07, 0.2, 6, SW.dark), cyl(0.02, 0.02, 0.14, x - 0.18, 0.07, 0.2, 6, SW.dark), cyl(0.02, 0.02, 0.14, x + 0.18, 0.07, -0.2, 6, SW.dark), cyl(0.02, 0.02, 0.14, x - 0.18, 0.07, -0.2, 6, SW.dark), plane(0.34, 0.42, TILES.news).translate(x, 0.72, 0.252)];
    P.newsCluster = fixed(merged([...one(-0.52, SW.red), ...one(0, SW.blue), ...one(0.52, SW.yellow)]));
  }
  // Muni-meter: grey post 1.55 m, a tilted head with its screen, a solar panel on top
  P.meter = tinted(merged([cyl(0.07, 0.08, 1.2, 0, 0.6, 0, 8), box(0.34, 0.45, 0.22, 0, 1.42, 0), box(0.3, 0.02, 0.26, 0, 1.67, 0.02).rotateX(-0.25), plane(0.22, 0.26, TILES.meterface).translate(0, 1.44, 0.112)]), 0x8c9094);
  // CityRack hoop: an inverted U of steel, 0.9 m high, 0.8 m across
  P.rack = tinted(merged([tube(0.025, -0.4, 0, 0, -0.4, 0.75, 0, 8), tube(0.025, 0.4, 0, 0, 0.4, 0.75, 0, 8), tube(0.025, -0.4, 0.75, 0, 0.4, 0.75, 0, 8), box(0.12, 0.02, 0.12, -0.4, 0.01, 0), box(0.12, 0.02, 0.12, 0.4, 0.01, 0)]), 0x24282c);
  // A bicycle leaning on it: wheels and tyres black, frame in the instance colour
  {
    const wheel = (z) => white(swatch(new THREE.TorusGeometry(0.33, 0.018, 6, 20).translate(0, 0.33, z), SW.black));
    const rim = (z) => white(swatch(new THREE.TorusGeometry(0.3, 0.008, 4, 18).translate(0, 0.33, z), SW.light));
    P.bike = tinted(merged([
      wheel(0.52), wheel(-0.52), rim(0.52), rim(-0.52),
      tube(0.018, 0, 0.33, -0.52, 0, 0.85, -0.2), tube(0.018, 0, 0.85, -0.2, 0, 0.95, 0.46), tube(0.018, 0, 0.42, -0.1, 0, 0.95, 0.46),
      tube(0.018, 0, 0.42, -0.1, 0, 0.33, -0.52), tube(0.018, 0, 0.95, 0.46, 0, 0.33, 0.52), tube(0.014, -0.22, 1.02, 0.46, 0.22, 1.02, 0.46, 6, SW.black),
      box(0.08, 0.05, 0.24, 0, 0.9, -0.22, SW.black), cyl(0.07, 0.07, 0.02, 0, 0.42, -0.1, 10, SW.dark)
    ]), 0x2e5a9c);
  }
  // LinkNYC: 2.9 m slim black monolith; its screens glow
  P.link = fixed(merged([box(0.86, 2.9, 0.28, 0, 1.45, 0, SW.black), box(0.9, 0.08, 0.32, 0, 2.94, 0, SW.dark)]), { castShadow: true, far: true });
  P.linkScreen = { geometry: merged([plane(0.62, 1.4, TILES.screen, 1, 2).translate(0, 1.85, 0.142), plane(0.62, 1.4, TILES.screen, 1, 2).rotateY(Math.PI).translate(0, 1.85, -0.142)]), material: 'glow', castShadow: false, colour: 0xffffff, far: true };
  // Bus shelter: 4.2 m long, 1.6 m deep, 2.6 m high: steel frame and roof, the ad panel, a bench; glass and lamp apart
  P.shelter = fixed(merged([
    box(0.1, 2.55, 0.1, -2.0, 1.275, -0.7, SW.dark), box(0.1, 2.55, 0.1, 2.0, 1.275, -0.7, SW.dark), box(0.1, 2.55, 0.1, -2.0, 1.275, 0.7, SW.dark), box(0.1, 2.55, 0.1, 2.0, 1.275, 0.7, SW.dark),
    box(4.3, 0.12, 1.75, 0, 2.6, 0, SW.dark), box(4.3, 0.05, 0.08, 0, 2.5, -0.74, SW.dark), box(4.3, 0.05, 0.08, 0, 2.5, 0.74, SW.dark),
    box(1.5, 0.05, 0.34, -1.0, 0.45, -0.46, SW.dark), box(0.05, 0.45, 0.3, -1.7, 0.225, -0.46, SW.dark), box(0.05, 0.45, 0.3, -0.3, 0.225, -0.46, SW.dark),
    box(1.3, 2.0, 0.14, 1.3, 1.25, -0.7, SW.black), plane(1.1, 1.8, TILES.ad, 1, 2).translate(1.3, 1.25, -0.625), plane(1.1, 1.8, TILES.ad, 1, 2).rotateY(Math.PI).translate(1.3, 1.25, -0.775)
  ]), { castShadow: true, far: true });
  P.shelterGlass = { geometry: merged([plane(2.2, 2.3, [0, 0]).translate(-0.9, 1.3, -0.72), plane(1.35, 2.3, [0, 0]).rotateY(Math.PI / 2).translate(-2.0, 1.3, 0), plane(1.35, 2.3, [0, 0]).rotateY(Math.PI / 2).translate(2.0, 1.3, 0)]), material: 'glass', castShadow: false, colour: 0xffffff, far: true };
  P.shelterLamp = { geometry: box(1.6, 0.04, 0.2, -0.6, 2.52, 0), material: 'glow', castShadow: false, colour: 0xfff0c8, far: true };
  // Bus stop: the pole and its blue flag
  P.busStop = fixed(merged([cyl(0.04, 0.045, 3.0, 0, 1.5, 0, 8, SW.dark), plane(0.36, 0.72, TILES.busflag, 1, 2).translate(0, 2.55, 0.05), plane(0.36, 0.72, TILES.busflag, 1, 2).rotateY(Math.PI).translate(0, 2.55, -0.05)]), { far: true });
  // Newsstand: green steel kiosk 3.4 x 1.6 x 2.7 m, magazines behind the counter, an awning, a lit window at night
  P.newsstand = fixed(merged([
    box(3.4, 2.6, 1.6, 0, 1.3, 0, SW.green), box(3.6, 0.12, 1.8, 0, 2.66, 0, SW.dark),
    box(3.6, 0.06, 0.9, 0, 2.3, 1.2, SW.green).rotateX(0.15).translate(0, 0, 0), box(3.0, 0.08, 0.5, 0, 1.0, 0.95, SW.dark),
    plane(2.8, 1.2, TILES.newsstand).translate(0, 1.7, 0.81), box(3.42, 0.3, 0.1, 0, 2.45, 0.78, SW.red)
  ]), { castShadow: true, far: true });
  P.newsstandLight = { geometry: box(2.6, 0.05, 0.08, 0, 2.25, 0.84), material: 'glow', castShadow: false, colour: 0xfff0c8, far: true };
  // CityBench: a backed steel bench 1.8 m long on two cast legs
  P.bench = fixed(merged([box(1.8, 0.05, 0.45, 0, 0.45, 0, SW.dark), box(1.8, 0.4, 0.05, 0, 0.72, -0.22, SW.dark), box(0.06, 0.45, 0.45, -0.8, 0.225, 0, SW.black), box(0.06, 0.45, 0.45, 0.8, 0.225, 0, SW.black), box(1.8, 0.03, 0.04, 0, 0.47, 0.18, SW.light), box(1.8, 0.03, 0.04, 0, 0.47, -0.02, SW.light)]));
  // Subway ventilation grate: a flush slab, bars across
  P.grate = fixed(white(mapUV(new THREE.BoxGeometry(1.4, 0.06, 4.2), TILES.grate[0], TILES.grate[1])));
  // Standpipe (Siamese connection) on a building front, brass
  P.standpipe = fixed(merged([cyl(0.07, 0.07, 0.55, 0, 0.275, 0, 10, SW.brass), cyl(0.065, 0.065, 0.22, -0.13, 0.66, 0.02, 10, SW.brass).rotateZ(0.5), cyl(0.065, 0.065, 0.22, 0.13, 0.66, 0.02, 10, SW.brass).rotateZ(-0.5), cyl(0.085, 0.085, 0.05, -0.2, 0.74, 0.04, 10, SW.brass), cyl(0.085, 0.085, 0.05, 0.2, 0.74, 0.04, 10, SW.brass)]));
  // Cellar doors: two steel leaves flush in the sidewalk
  P.cellar = fixed(merged([box(1.3, 0.05, 2.0, 0, 0, 0, SW.dark), box(0.04, 0.07, 2.0, 0, 0, 0, SW.light), box(1.34, 0.02, 0.1, 0, 0.02, 0.95, SW.light), box(1.34, 0.02, 0.1, 0, 0.02, -0.95, SW.light)]));
  // Tree guard: four low iron rails round the tree pit
  {
    const side = (rot) => merged([tube(0.012, -0.65, 0.52, 0.65, 0.65, 0.52, 0.65, 6), tube(0.012, -0.65, 0.3, 0.65, 0.65, 0.3, 0.65, 6), cyl(0.02, 0.02, 0.58, -0.65, 0.29, 0.65, 6), ...[-0.4, -0.15, 0.1, 0.35].map((u) => cyl(0.008, 0.008, 0.52, u, 0.3, 0.65, 4))]).rotateY(rot);
    P.treeGuard = tinted(merged([side(0), side(Math.PI / 2), side(Math.PI), side(-Math.PI / 2)]), 0x1d2a22);
  }
  // Sidewalk shed bay (instanced along the facade): two posts 3.4 m apart across, the beam between, the X brace to the
  // next bay on the curb side, ledgers along; the deck and parapet boards are unit cubes scaled per shed
  // (kept light: thousands of bays stand within view in Midtown)
  P.shedBay = tinted(merged([
    cyl(0.045, 0.045, 3.75, 0, 1.875, 1.7, 6), cyl(0.045, 0.045, 3.75, 0, 1.875, -1.7, 6),
    tube(0.04, 0, 3.7, 1.7, 0, 3.7, -1.7, 5),
    tube(0.03, 0, 0.3, 1.7, 2.4, 3.5, 1.7, 4), tube(0.03, 0, 3.5, 1.7, 2.4, 0.3, 1.7, 4),
    tube(0.04, 0, 3.7, 1.7, 2.4, 3.7, 1.7, 5)
  ]), 0x3a3d3a, { castShadow: true, far: true });
  P.shedBoard = mattePart(box(1, 1, 1, 0, 0.5, 0, SW.plywood), { castShadow: true, far: true });
  P.shedLight = { geometry: white(swatch(new THREE.BoxGeometry(0.09, 0.09, 0.09), SW.white)), material: 'glow', castShadow: false, colour: 0xffe9b8, far: true };
  // The building site: dumpster, cones, Jersey barrier, portable toilet
  P.dumpster = mattePart(merged([box(6.0, 1.5, 2.2, 0, 0.85, 0, SW.rust), box(6.0, 0.1, 0.1, 0, 1.62, 1.05, SW.dark), box(6.0, 0.1, 0.1, 0, 1.62, -1.05, SW.dark), box(0.1, 1.5, 2.2, 2.95, 0.85, 0, SW.rust)]), { castShadow: true, far: true });
  P.cone = mattePart(merged([cyl(0.03, 0.15, 0.7, 0, 0.35, 0, 10, SW.orange), box(0.36, 0.03, 0.36, 0, 0.015, 0, SW.black), cyl(0.085, 0.1, 0.1, 0, 0.42, 0, 10, SW.white)]));
  P.jersey = mattePart(merged([box(2.0, 0.3, 0.6, 0, 0.15, 0, SW.concrete), box(2.0, 0.55, 0.3, 0, 0.575, 0, SW.concrete)]), { far: true });
  P.portaloo = mattePart(merged([box(1.1, 2.2, 1.1, 0, 1.1, 0, SW.blue), box(1.16, 0.12, 1.16, 0, 2.24, 0, SW.navy), box(0.6, 1.9, 0.04, 0, 1.0, 0.56, SW.navy)]), { castShadow: true, far: true });
  // Fire alarm box: red post with a lantern head
  P.alarmBox = fixed(merged([cyl(0.05, 0.06, 1.6, 0, 0.8, 0, 8, SW.red), box(0.28, 0.4, 0.2, 0, 1.8, 0, SW.red), cyl(0.06, 0.08, 0.14, 0, 2.07, 0, 8, SW.dark)]));
  // Sidewalk café: a round table under an umbrella, two chairs
  P.cafeSet = mattePart(merged([
    cyl(0.35, 0.35, 0.03, 0, 0.72, 0, 14, SW.dark), cyl(0.02, 0.03, 0.7, 0, 0.36, 0, 8, SW.dark), cyl(0.2, 0.2, 0.02, 0, 0.01, 0, 10, SW.dark),
    cyl(0.015, 0.015, 2.3, 0, 1.15, 0, 6, SW.dark), white(swatch(new THREE.ConeGeometry(0.95, 0.28, 8, 1, true).translate(0, 2.2, 0), SW.tan)),
    box(0.4, 0.03, 0.4, 0.62, 0.45, 0, SW.dark), box(0.4, 0.42, 0.03, 0.62, 0.66, -0.19, SW.dark), box(0.4, 0.03, 0.4, -0.62, 0.45, 0, SW.dark), box(0.4, 0.42, 0.03, -0.62, 0.66, 0.19, SW.dark)
  ]));
  // Roadway dining shed in the parking lane: a wooden platform 6 x 2.2 m, low walls, planters, a canopy on posts
  P.diningShed = mattePart(merged([
    box(6.0, 0.25, 2.2, 0, 0.125, 0, SW.plywood), box(6.0, 0.9, 0.08, 0, 0.7, 1.06, SW.plywood), box(0.08, 0.9, 2.2, -2.96, 0.7, 0, SW.plywood), box(0.08, 0.9, 2.2, 2.96, 0.7, 0, SW.plywood),
    box(6.0, 0.4, 0.3, 0, 1.3, 1.0, SW.green), box(0.3, 0.4, 2.0, -2.85, 1.3, 0, SW.green), box(0.3, 0.4, 2.0, 2.85, 1.3, 0, SW.green),
    cyl(0.04, 0.04, 2.4, -2.9, 1.45, 1.0, 6, SW.dark), cyl(0.04, 0.04, 2.4, 2.9, 1.45, 1.0, 6, SW.dark), cyl(0.04, 0.04, 2.4, -2.9, 1.45, -1.0, 6, SW.dark), cyl(0.04, 0.04, 2.4, 2.9, 1.45, -1.0, 6, SW.dark),
    box(6.3, 0.06, 2.5, 0, 2.66, 0, SW.tan),
    cyl(0.3, 0.3, 0.03, -1.5, 0.98, 0, 10, SW.dark), cyl(0.3, 0.3, 0.03, 1.5, 0.98, 0, 10, SW.dark), cyl(0.02, 0.02, 0.7, -1.5, 0.6, 0, 6, SW.dark), cyl(0.02, 0.02, 0.7, 1.5, 0.6, 0, 6, SW.dark)
  ]), { castShadow: true, far: true });
  P.barrierFence = fixed(merged([tube(0.02, -1.1, 0.05, 0, -1.1, 1.05, 0, 6, SW.light), tube(0.02, 1.1, 0.05, 0, 1.1, 1.05, 0, 6, SW.light), tube(0.02, -1.1, 1.05, 0, 1.1, 1.05, 0, 6, SW.light), tube(0.02, -1.1, 0.12, 0, 1.1, 0.12, 0, 6, SW.light), ...Array.from({ length: 9 }, (_, i) => tube(0.008, -0.9 + i * 0.225, 0.12, 0, -0.9 + i * 0.225, 1.05, 0, 4, SW.light))]));
  for (const p of Object.values(P)) { p.geometry.computeBoundingSphere(); p.geometry.computeBoundingBox(); }
  return P;
}

export { createKitMaterials, createKitParts, TILES, SW };
