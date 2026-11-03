import * as THREE from 'three/webgpu';
import {
  Fn, If, attribute, texture, textureLoad, vec2, vec3, vec4, ivec2, int, float, floor, fract, mix, step, smoothstep, clamp,
  abs, max, min, dot, normalize, length, pow, exp, fwidth, dFdx, dFdy, cross, sqrt, log2, mod, select, sin, atan,
  positionGeometry, normalGeometry, positionWorld, positionView, normalViewGeometry, cameraPosition, normalWorld
} from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';
import { SHOP_TYPES, shopOpenAt } from './storefront-types.js';
import { GLYPHS } from './storefront-glyphs.js';
import { shopIdentity, encodeText, STYLE, FONTS } from './storefront-signs.js';
import { shopLayout, shopColliders } from './storefront-plan.js';
import { tintFor } from './building-types.js';

// The ground floors of Manhattan, shop by shop (js/storefront-plan.js decides where): piers, fascias, signs, display
// windows with a room behind them, doors, awnings, blade signs and the roll-down gates that close them at night. Every
// part is an instance of one of four meshes (a box, a pane of glass, a sign, an awning), streamed around the camera;
// beyond that range the facade shader still paints its flat shopfronts (tsl-materials.js, uShopKit).

// ---- Assets (tools/shops) -----------------------------------------------------------------------------------------------
const base = new URL('../assets/shops/', import.meta.url);
const assets = {};
const KIT_ATLAS = 2048, KIT_TILE = 512, KIT_BORDER = 16, KIT_INNER = KIT_TILE - 2 * KIT_BORDER;
const KIND = { paint: 0, planks: 1, wood: 2, granite: 3, stone: 4, tread: 5, tiles: 6, terrazzo: 7, shutter: 8, rustShutter: 9,
  paintedBrick: 10, concrete: 11, limestone: 12, redbrick: 13, brownbrick: 14, buffbrick: 15,
  metal: 16, enamel: 17, lamp: 18, chrome: 19, produce: 20, barberPole: 21 };
// The piers of a shop are its building's own stone or brick, in the shade the facade shader gives that building (its
// dress's tint over the wall photograph, times a slight shade picked by the building's tone)
const SURFACE_KIND = { limestone: KIND.limestone, redbrick: KIND.redbrick, brownbrick: KIND.brownbrick, buffbrick: KIND.buffbrick };
const masonryKind = (rec) => (rec.style && !rec.style.glass ? SURFACE_KIND[rec.style.surface] : null);
function masonryShade(rec) {
  if (!masonryKind(rec)) return [1, 1, 1];
  const f = (((rec.tone ?? 0.5) * 4.73) % 1 + 1) % 1;
  return tintFor(rec.style.surface, rec.style.wall).map((t) => t * (0.93 + 0.14 * f));
}

async function loadStorefronts() {
  const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const load = async (name, color) => {
    const t = new THREE.Texture(await loader.loadAsync(new URL(name, base).href));
    t.name = name;
    t.flipY = false;
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  const [meta, colour, normal, glyphs, rooms, roomsNear, roomMeta] = await Promise.all([
    fetch(new URL('kit.json', base)).then((r) => r.json()), load('kit_c.webp', true), load('kit_n.webp', false), load('glyphs.png', false),
    load('interiors.webp', true), load('interiors-near.webp', true), fetch(new URL('interiors.json', base)).then((r) => r.json())
  ]);
  Object.assign(assets, { rooms, roomsNear, roomMeta });
  // Per tile: average colour + roughness (row 0), metres per repeat and tint mode (row 1)
  const kitTable = new Float32Array(16 * 2 * 4);
  meta.tiles.forEach((t, i) => {
    kitTable.set(t.average, i * 4);
    kitTable.set([t.metres, t.use === 'tint' ? 1 : 0, 0, 0], (16 + i) * 4);
  });
  assets.kitTable = dataTexture(kitTable, 16, 2);
  // Glyph advances per typeface (rows 0..11) and each face's size, baseline, origin and atlas slot (row 12)
  const cols = 128, rows = GLYPHS.fonts.length + 1;
  const glyphTable = new Float32Array(cols * rows * 4);
  GLYPHS.fonts.forEach((f, row) => {
    f.advances.forEach((a, i) => { glyphTable[(row * cols + i) * 4] = a; });
    glyphTable.set([f.size, f.baseline, f.originX, f.group * 3 + f.channel], ((rows - 1) * cols + row) * 4);
    glyphTable[((rows - 1) * cols + row) * 4 + 0] = f.size;
  });
  GLYPHS.fonts.forEach((f, row) => { glyphTable[((rows - 1) * cols + 64 + row) * 4] = f.cap; });
  assets.glyphTable = dataTexture(glyphTable, cols, rows);
  Object.assign(assets, { meta, colour, normal, glyphs });
}

function dataTexture(data, w, h) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// ---- Shared shader pieces -------------------------------------------------------------------------------------------------
const night = () => smoothstep(0.55, 1.2, cityUniforms.uInteriorGlow);
const hash21 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
const vnoise = (p) => {
  const i = floor(p), f = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = hash21(i), b = hash21(i.add(vec2(1, 0))), c = hash21(i.add(vec2(0, 1))), d = hash21(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
};

// One tile of the kit atlas, tiled over `coord` (repeats), its mip level chosen from the unwrapped coordinate so the
// repeat seams never spike to the smallest mip, and capped before the tile's border runs out
function kitSample(map, tile, coord) {
  const origin = vec2(mod(tile, 4), floor(tile.div(4))).mul(KIT_TILE).add(KIT_BORDER);
  const st = origin.add(fract(coord).mul(KIT_INNER)).div(KIT_ATLAS);
  const footprint = max(length(dFdx(coord)), length(dFdy(coord))).mul(KIT_INNER);
  const lod = log2(max(footprint, 1e-4));
  return { texel: texture(map, st).level(clamp(lod, 0, 4.3)), lod };
}

// ---- Materials -------------------------------------------------------------------------------------------------------------
function createFrameMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const aFrame = attribute('aFrame', 'vec4'); // linear rgb (paint or tint), kind
  const aSize = attribute('aSize', 'vec3');
  const kind = aFrame.w;
  const p = positionGeometry.mul(aSize);
  const an = abs(normalGeometry);
  // Faces across the wall use (along, height); returns use (depth, height); tops use (along, depth). Height is the
  // world's, so brick courses carry on from the wall above
  const horizontal = select(an.x.greaterThan(0.5), p.z, p.x).add(hash21(vec2(aSize.x, aSize.z)).mul(7));
  const isTop = an.y.greaterThan(0.5);
  const flat = vec2(horizontal, select(isTop, p.z, positionWorld.y));
  const tile = min(kind, 15);
  const info = textureLoad(assets.kitTable, ivec2(int(tile), int(1)));
  const avg = textureLoad(assets.kitTable, ivec2(int(tile), int(0)));
  const coord = flat.div(info.x);
  const albedo = kitSample(assets.colour, tile, coord);
  const nrm = kitSample(assets.normal, tile, coord);
  const detail = float(1).sub(smoothstep(3.6, 5.6, albedo.lod));
  const photo = mix(avg.xyz, albedo.texel.xyz, detail);
  // Tint tiles are detail maps under a paint colour; natural tiles keep their colour, shaded by the tint
  const lumen = dot(photo, vec3(0.2126, 0.7152, 0.0722));
  const tinted = aFrame.xyz.mul(lumen.div(max(dot(avg.xyz, vec3(0.2126, 0.7152, 0.0722)), 0.02)).clamp(0.55, 1.45));
  const natural = photo.mul(aFrame.xyz);
  const textured = mix(natural, tinted, info.y);
  // Procedural finishes: brushed metal, enamel panels, lamps, chrome
  const brushed = aFrame.xyz.mul(float(0.86).add(hash21(vec2(floor(horizontal.mul(160)), floor(p.y.mul(3)))).mul(0.14)));
  const proc = kind.greaterThan(15.5);
  // Produce on a stand (fruit, or flowers when the tint's red is above 0.5): a heap of round things in shop colours
  const heap = select(isTop, p.xz, vec2(horizontal, p.y)).mul(11);
  const fruitId = hash21(floor(heap));
  const roundness = float(1).sub(length(fract(heap).sub(0.5)).mul(1.5)).clamp(0.25, 1);
  const pickC = (a, b, c, d, e) => select(fruitId.lessThan(0.2), a, select(fruitId.lessThan(0.4), b, select(fruitId.lessThan(0.6), c, select(fruitId.lessThan(0.8), d, e))));
  const fruit = pickC(vec3(0.55, 0.04, 0.03), vec3(0.85, 0.3, 0.02), vec3(0.8, 0.62, 0.04), vec3(0.18, 0.42, 0.04), vec3(0.22, 0.03, 0.16));
  const flower = pickC(vec3(0.85, 0.3, 0.45), vec3(0.85, 0.84, 0.8), vec3(0.65, 0.04, 0.08), vec3(0.9, 0.72, 0.15), vec3(0.4, 0.15, 0.6));
  const produce = select(aFrame.x.greaterThan(0.5), mix(flower, vec3(0.08, 0.3, 0.06), step(0.82, hash21(floor(heap).add(9.1)))), fruit).mul(roundness);
  // Barber pole: red, white and blue spiralling round it
  const spiral = fract(atan(normalGeometry.z, normalGeometry.x).div(Math.PI * 2).add(p.y.mul(1.6)));
  const pole = select(spiral.lessThan(0.33), vec3(0.62, 0.03, 0.03), select(spiral.lessThan(0.5), vec3(0.85, 0.85, 0.85), select(spiral.lessThan(0.83), vec3(0.03, 0.08, 0.5), vec3(0.85, 0.85, 0.85))));
  const special = select(kind.greaterThan(20.5), pole, produce);
  const base = select(proc, select(kind.lessThan(16.5), brushed, select(kind.greaterThan(19.5), special, aFrame.xyz)), textured);
  // Grime: darker at the foot of everything, streaky under sills
  const footY = positionWorld.y.sub(0.22);
  const streak = vnoise(vec2(horizontal.mul(3.1), positionWorld.y.mul(0.35)));
  const grime = float(1).sub(float(1).sub(smoothstep(0, 0.75, footY)).mul(0.32).mul(streak.mul(0.6).add(0.4)))
    .mul(float(1).sub(streak.mul(0.08)));
  m.colorNode = base.mul(grime);
  const rough = mix(avg.w, nrm.texel.z, detail);
  m.roughnessNode = select(proc, select(kind.lessThan(16.5), 0.38, select(kind.lessThan(17.5), 0.14, select(kind.lessThan(18.5), 0.5,
    select(kind.lessThan(19.5), 0.12, select(kind.lessThan(20.5), 0.55, 0.2))))),
    rough.add(float(1).sub(smoothstep(0, 0.6, footY)).mul(0.1)).clamp(0.08, 1));
  m.metalnessNode = select(proc, select(kind.lessThan(16.5), 0.85, select(kind.lessThan(17.5), 0.2, select(kind.lessThan(18.5), 0, select(kind.lessThan(19.5), 1, 0)))),
    select(kind.equal(KIND.tread).or(kind.greaterThan(7.5).and(kind.lessThan(9.5))), 0.55, 0));
  // Normal map, tangents from the unwrapped coordinate
  const nTs = nrm.texel.xy.mul(2).sub(1).mul(detail).mul(select(proc, 0, 0.9));
  m.normalNode = Fn(() => {
    const N = normalViewGeometry;
    const dp1 = dFdx(positionView), dp2 = dFdy(positionView);
    const duv1 = dFdx(coord), duv2 = dFdy(coord);
    const p2 = cross(dp2, N), p1 = cross(N, dp1);
    const T = p2.mul(duv1.x).add(p1.mul(duv2.x));
    const B = p2.mul(duv1.y).add(p1.mul(duv2.y));
    const s = float(1).div(sqrt(max(max(dot(T, T), dot(B, B)), 1e-12)));
    const z = sqrt(max(float(1).sub(dot(nTs, nTs)), 0.05));
    return normalize(T.mul(s).mul(nTs.x).add(B.mul(s).mul(nTs.y)).add(N.mul(z)));
  })();
  // Lamps glow after dark
  m.emissiveNode = select(kind.greaterThan(17.5).and(kind.lessThan(18.5)), aFrame.xyz.mul(night().mul(5).add(0.4)), vec3(0));
  return m;
}

// Display windows: the glass reflects the street and the sky, and behind it a room recedes as the camera moves
// (interior mapping), furnished for the kind of shop. aGlass: type, seed, lit, mode; aRoom: floor below the glass,
// room height, room depth. Modes: 0 window, 1 door, 2 transom, 3 papered over, 4 side return
const INTERIOR = {
  // wall rgb, floor rgb, light rgb (sRGB hex), layout
  // layouts: 0 shelves, 1 counter & menus, 2 tables, 3 racks, 4 machines, 5 chairs & mirrors, 6 desks, 7 gallery, 8 empty
  vacant: [0xb8b2a6, 0x6a6258, 0xe8f0ff, 8], bodega: [0xe8e4da, 0x8a8a84, 0xf4fbff, 0], pizza: [0xc87a52, 0x7a5040, 0xffd6a0, 1],
  cafe: [0x6b5444, 0x4a3a2c, 0xffd59a, 1], bakery: [0xf0e2c8, 0x9a8264, 0xffe2b0, 1], takeout: [0xe6dcc4, 0xa09078, 0xf6fbff, 1],
  sushi: [0x8a6a48, 0x4a3a2a, 0xffd8a8, 2], latin: [0xd89a4a, 0x7a4a30, 0xffd090, 2], restaurant: [0x7a4a3a, 0x3e2a22, 0xffc888, 2],
  bar: [0x3a2a24, 0x2a1e18, 0xffb070, 2], diner: [0xe0d8c8, 0xb04040, 0xf8fbff, 1], juice: [0xf4f0e0, 0x8ac060, 0xffffff, 1],
  laundromat: [0xd8dde0, 0x9aa2a8, 0xf0f8ff, 4], cleaners: [0xd8d4c8, 0x8a8478, 0xf0f6ff, 3], barber: [0xe8e2d6, 0x404040, 0xfff2e0, 5],
  salon: [0xf2d8dc, 0xd0c0c4, 0xfff4f8, 5], pharmacy: [0xf4f6f8, 0xc8ccd0, 0xffffff, 0], bank: [0xc8c0b0, 0x6a6460, 0xfff0d8, 6],
  boutique: [0xece8e2, 0x8a7a68, 0xfff0dc, 3], luxury: [0xe8e0d0, 0xd8d0c4, 0xfff0d6, 3], jewelry: [0x2a2430, 0x3a3236, 0xfff4e0, 3],
  phones: [0xf4f4f6, 0xb8bcc0, 0xffffff, 0], hardware: [0xd8d0b8, 0x8a8070, 0xfff8e8, 0], florist: [0xdfe6d8, 0x7a7a6a, 0xfff6e0, 3],
  liquor: [0xd8ccb8, 0x6a5a48, 0xfff0d8, 0], books: [0x8a6a4a, 0x5a4232, 0xffd8a0, 0], office: [0xe0e0dc, 0x8a8a88, 0xf4f8ff, 6],
  souvenir: [0xf4f0e8, 0xb0a898, 0xffffff, 0], shoes: [0xf0ece6, 0x9a9088, 0xfff6ec, 3], gallery: [0xfafafa, 0xb8b4ae, 0xffffff, 7]
};
function interiorTable() {
  const data = new Float32Array(32 * 4 * 4);
  const lin = (h) => { const c = new THREE.Color().setHex(h); return [c.r, c.g, c.b]; };
  SHOP_TYPES.forEach((t, i) => {
    const [wall, floorC, light, layout] = INTERIOR[t.id];
    data.set([...lin(wall), layout], i * 4);
    data.set([...lin(floorC), 0], (32 + i) * 4);
    data.set([...lin(light), 0], (64 + i) * 4);
  });
  return dataTexture(data, 32, 4);
}

function createGlassMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const aGlass = attribute('aGlass', 'vec4');
  const aRoom = attribute('aRoom', 'vec4');
  const aSize = attribute('aSize', 'vec3');
  const table = interiorTable();
  const type = aGlass.x, seed = aGlass.y, lit = aGlass.z, mode = aGlass.w;
  const W = aSize.x, H = aSize.y;
  const u = positionGeometry.x.add(0.5).mul(W), v = positionGeometry.y.add(0.5).mul(H);
  const t0 = textureLoad(table, ivec2(int(type), int(0)));
  const wallC = t0.xyz, layout = t0.w;
  const floorC = textureLoad(table, ivec2(int(type), int(1))).xyz;
  const lightC = textureLoad(table, ivec2(int(type), int(2))).xyz;
  const N = normalWorld;
  const X = normalize(cross(vec3(0, 1, 0), N));
  const view = positionWorld.sub(cameraPosition);
  // The room behind the glass: where the view ray meets its walls, floor or ceiling, projected back onto the picture
  // taken from tools/shops/interiors.html's eye; the furniture near the glass slides over it from its own layer
  const RM = assets.roomMeta;
  const [CW, CH, CD] = RM.room, E = RM.eye.z, EY = RM.eye.y, NEAR = RM.near;
  const [TW, TH] = RM.tile, AW = TW * RM.cols, AH = TH * RM.rows;
  const tileOrigin = vec2(mod(type, RM.cols), floor(type.div(RM.cols))).mul(vec2(TW, TH));
  const mirrored = step(0.5, fract(seed.mul(13.7)));
  const picture = (x, y, z) => {
    // x, y in metres in this room, z its canonical depth: onto the canonical picture plane
    const xc = mix(x.div(W).mul(CW), float(CW).sub(x.div(W).mul(CW)), mirrored);
    const yc = y.div(aRoom.y).mul(CH);
    const k = float(E).div(z.add(E));
    const iu = float(CW / 2).add(xc.sub(CW / 2).mul(k)).div(CW);
    const iv = float(CH).sub(float(EY).add(yc.sub(EY).mul(k))).div(CH);
    const px = vec2(iu.clamp(0.002, 0.998).mul(TW), iv.clamp(0.002, 0.998).mul(TH));
    const lod = log2(max(max(length(dFdx(px)), length(dFdy(px))), 1e-3)).clamp(0, 3);
    return { st: tileOrigin.add(px).div(vec2(AW, AH)), lod };
  };
  const room = Fn(() => {
    const inward = max(dot(view, N).negate(), 0.02);
    const dx = dot(view, X).div(inward), dy = view.y.div(inward);
    const RW = W, RH = aRoom.y, RD = aRoom.z;
    const px0 = u, py0 = v.add(aRoom.x);
    const tx = select(dx.greaterThan(0), RW.sub(px0), px0).div(max(abs(dx), 1e-3));
    const ty = select(dy.greaterThan(0), RH.sub(py0), py0).div(max(abs(dy), 1e-3));
    const depth = min(min(tx, ty), RD);
    const hx = px0.add(dx.mul(depth)), hy = py0.add(dy.mul(depth));
    const far = picture(hx, hy, depth.div(RD).mul(CD));
    const back = texture(assets.rooms, far.st).level(far.lod).xyz;
    // The near layer's plane, NEAR canonical metres in
    const dm = float(NEAR / CD).mul(RD);
    const mx = px0.add(dx.mul(dm)), my = py0.add(dy.mul(dm));
    const near = picture(mx, my, float(NEAR));
    const front = texture(assets.roomsNear, near.st).level(near.lod);
    const seen = step(dm, depth).mul(step(0, mx)).mul(step(mx, RW)).mul(step(0, my)).mul(step(my, RH));
    const a = front.w.mul(seen);
    return vec4(front.xyz.mul(seen).add(back.mul(float(1).sub(a))), depth);
  })();
  const n = night();
  // Day: the room is dim behind bright glass; night: it glows. Closed shops keep a night light
  const roomLight = mix(float(0.3), float(1.3), n).mul(mix(float(0.1), float(1), lit));
  const interiorColour = room.xyz.mul(roomLight);
  // Papered-over windows (vacant), and the side returns that only show the room's average
  const paper = mix(vec3(0.62, 0.55, 0.42), vec3(0.85, 0.84, 0.8), step(0.5, hash21(vec2(floor(seed.mul(13)), 1))))
    .mul(float(0.85).add(vnoise(vec2(u.mul(3), v.mul(3))).mul(0.15)));
  const isPaper = mode.greaterThan(2.5).and(mode.lessThan(3.5));
  const isSide = mode.greaterThan(3.5);
  const behind = select(isPaper, paper.mul(mix(0.55, 0.25, n)), select(isSide, wallC.mul(roomLight).mul(0.5), interiorColour));
  // Reflection: the facades across the street (a wall of windows some 22 m away), the sky over them, the street below
  const toEye = normalize(cameraPosition.sub(positionWorld));
  const cosI = abs(dot(toEye, N));
  const fresnel = pow(clamp(float(1).sub(cosI), 0, 1), 5).mul(0.8).add(0.06);
  const vd = view.normalize();
  const r = vd.sub(N.mul(dot(vd, N).mul(2)));
  const reach = float(22).div(max(dot(r, N), 0.05));
  const hit = positionWorld.add(r.mul(reach));
  const across = dot(hit, X);
  const facadeTop = float(18).add(hash21(vec2(floor(across.div(14)), 3.3)).mul(40));
  const winCell = vec2(fract(across.div(2.6)), fract(hit.y.div(3.4)));
  const win = step(0.22, winCell.x).mul(step(winCell.x, 0.78)).mul(step(0.25, winCell.y)).mul(step(winCell.y, 0.82)).mul(step(3.6, hit.y));
  const winLit = step(0.62, hash21(floor(vec2(across.div(2.6), hit.y.div(3.4))))).mul(n);
  const masonryTone = mix(vec3(0.2, 0.15, 0.12), vec3(0.34, 0.31, 0.27), hash21(vec2(floor(across.div(14)), 1.7)));
  const facadeC = mix(masonryTone.mul(mix(1, 0.06, n)), mix(vec3(0.08, 0.1, 0.12).mul(mix(1, 0.3, n)), vec3(1, 0.78, 0.5).mul(0.8), winLit), win)
    .mul(float(0.85).add(cityUniforms.uSunColor.x.mul(0.15)));
  const sky = mix(cityUniforms.uSkyHorizonColor, cityUniforms.uSkyTopColor, clamp(r.y.mul(1.6), 0, 1)).mul(mix(1, 0.1, n));
  const aboveRoofs = step(facadeTop, hit.y).mul(step(0, r.y));
  const street = vec3(0.045, 0.045, 0.05).mul(mix(1, 0.4, n));
  const reflected = select(r.y.lessThan(0).and(hit.y.lessThan(0.2)), street, mix(facadeC, sky, aboveRoofs));
  const dust = smoothstep(0.9, 0, v).mul(0.04).add(vnoise(vec2(u.mul(5), v.mul(5))).mul(0.02));
  const glassy = select(isPaper, 0.04, fresnel.add(dust).clamp(0, 1));
  m.colorNode = vec3(0.02);
  m.roughnessNode = select(isPaper, 0.9, 0.05);
  m.metalnessNode = float(0);
  // Float glass is faintly green
  m.emissiveNode = mix(behind.mul(vec3(0.93, 0.98, 0.96)), reflected, glassy);
  return m;
}

// Signs: signed-distance letters from assets/shops/glyphs.png, laid out in the shader from up to 24 glyph codes.
// aText0..2: codes (+1) two per float; aSignA: ink rgb, typeface; aSignB: board rgb, style; aSignC: line width (ems),
// letter height / sign height, tracking, flags (1 vertical); aSize: width, height, lit
function createSignMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.FrontSide });
  const t = [attribute('aText0', 'vec4'), attribute('aText1', 'vec4'), attribute('aText2', 'vec4')];
  const aA = attribute('aSignA', 'vec4'), aB = attribute('aSignB', 'vec4'), aC = attribute('aSignC', 'vec4');
  const aSize = attribute('aSize', 'vec3');
  const font = aA.w, style = aB.w;
  const W = aSize.x, H = aSize.y, lit = aSize.z;
  const fontRow = GLYPHS.fonts.length;
  const fm = textureLoad(assets.glyphTable, ivec2(int(font), int(fontRow)));
  const cap = textureLoad(assets.glyphTable, ivec2(int(font).add(64), int(fontRow))).x;
  const size = fm.x, baseline = fm.y, originX = fm.z, slot = fm.w;
  const vertical = aC.w.greaterThan(0.5);
  const u = positionGeometry.x.add(0.5).mul(W), v = positionGeometry.y.add(0.5).mul(H);
  const codes = [];
  for (let i = 0; i < 12; i++) {
    const f = t[Math.floor(i / 4)][['x', 'y', 'z', 'w'][i % 4]];
    codes.push(mod(f, 128), floor(f.div(128)));
  }
  const nChars = GLYPHS.chars.length;
  const sample = Fn(() => {
    const glyph = float(-1).toVar();
    const localX = float(0).toVar();
    const yEm = float(0).toVar();
    const em = float(0).toVar();
    If(vertical, () => {
      // One letter per line, centred, top to bottom
      const lines = max(aC.x, 1);
      em.assign(min(H.mul(0.92).div(lines.mul(1.18)), W.mul(0.8)));
      const line = floor(H.sub(v).sub(H.sub(lines.mul(em).mul(1.18)).mul(0.5)).div(em.mul(1.18)));
      const inLine = H.sub(v).sub(H.sub(lines.mul(em).mul(1.18)).mul(0.5)).sub(line.mul(em.mul(1.18))).div(em);
      yEm.assign(float(1.18).sub(inLine).sub(float(1.18).sub(cap).mul(0.5)));
      for (let i = 0; i < 24; i++) {
        If(line.equal(i).and(codes[i].greaterThan(0.5)), () => {
          glyph.assign(codes[i].sub(1));
          const adv = textureLoad(assets.glyphTable, ivec2(int(codes[i].sub(1)), int(font))).x;
          localX.assign(u.div(em).sub(W.div(em).sub(adv).mul(0.5)));
        });
      }
    }).Else(() => {
      em.assign(min(aC.y.mul(H), W.mul(0.9).div(max(aC.x, 0.1))));
      const xEm = u.sub(W.sub(aC.x.mul(em)).mul(0.5)).div(em);
      yEm.assign(v.sub(H.mul(0.5)).div(em).add(cap.mul(0.5)));
      const pen = float(0).toVar();
      const done = float(0).toVar();
      If(xEm.lessThan(0), () => { done.assign(1); });
      for (let i = 0; i < 24; i++) {
        If(done.lessThan(0.5), () => {
          If(codes[i].lessThan(0.5), () => { done.assign(1); }).Else(() => {
            const adv = textureLoad(assets.glyphTable, ivec2(int(codes[i].sub(1)), int(font))).x;
            If(xEm.lessThan(pen.add(adv)), () => {
              glyph.assign(codes[i].sub(1));
              localX.assign(xEm.sub(pen));
              done.assign(1);
            }).Else(() => { pen.addAssign(adv.add(aC.z)); });
          });
        });
      }
    });
    // Distance to the letter's edge, in ems (positive inside)
    const d = float(-1).toVar();
    If(glyph.greaterThan(-0.5), () => {
      const group = floor(slot.div(3)), channel = mod(slot, 3);
      const cell = group.mul(nChars).add(glyph);
      const cx = mod(cell, GLYPHS.cols).mul(GLYPHS.cell), cy = floor(cell.div(GLYPHS.cols)).mul(GLYPHS.cell);
      const px = cx.add(originX).add(localX.mul(size));
      const py = cy.add(baseline).sub(yEm.mul(size));
      const inside = step(cx, px).mul(step(px, cx.add(GLYPHS.cell))).mul(step(cy, py)).mul(step(py, cy.add(GLYPHS.cell)));
      const st = vec2(px.div(GLYPHS.cols * GLYPHS.cell), py.div(GLYPHS.rows * GLYPHS.cell));
      const g = texture(assets.glyphs, st).level(0);
      const s = select(channel.lessThan(0.5), g.x, select(channel.lessThan(1.5), g.y, g.z));
      d.assign(mix(float(-1), s.sub(0.5).mul(2 * GLYPHS.spread).div(size), inside));
    });
    return vec2(d, em);
  });
  const res = sample();
  const d = res.x, em = res.y;
  const aa = max(fwidth(u.div(em)), fwidth(v.div(em))).mul(0.75).max(0.004);
  const cov = smoothstep(aa.negate(), aa, d);
  const n = night();
  const ink = aA.xyz, board = aB.xyz;
  const isBox = style.lessThan(0.5);
  const isPainted = style.greaterThan(0.5).and(style.lessThan(1.5));
  const isLetters = style.greaterThan(1.5).and(style.lessThan(2.5));
  const isNeon = style.greaterThan(2.5).and(style.lessThan(3.5));
  const isVinyl = style.greaterThan(3.5).and(style.lessThan(4.5));
  const isTag = style.greaterThan(4.5).and(style.lessThan(5.5));
  // Boards: a frame line round the backlit box, a grain on painted wood
  const edge = min(min(u, W.sub(u)), min(v, H.sub(v)));
  const frameLine = smoothstep(0.035, 0.03, edge);
  const grain = float(0.9).add(vnoise(vec2(u.mul(1.5), v.mul(26))).mul(0.12));
  const boardC = select(isPainted, board.mul(grain), mix(board, board.mul(0.55), frameLine));
  const outline = smoothstep(aa.negate(), aa, d.add(0.07));
  const tagC = mix(vec3(0.02), ink, cov);
  const colour = select(isTag, tagC, mix(boardC, ink, cov));
  const transparent = isLetters.or(isVinyl).or(isTag);
  m.opacityNode = select(transparent, select(isTag, outline, cov), 1);
  m.alphaTest = 0.5;
  // Cut-out letters and tags would otherwise end in a hard, stair-stepped edge that crawls under the slightest move:
  // with multisampling the edge becomes a pixel-wide coverage ramp
  m.alphaToCoverage = true;
  // Neon: tubes and their halo, on a dark board
  const halo = exp(d.min(0).mul(14)).mul(0.9);
  const neonC = select(isNeon, ink.mul(cov.mul(2.2).add(halo.mul(float(1).sub(cov)))), vec3(0));
  m.colorNode = select(isNeon, mix(board.mul(0.3), ink.mul(0.5), cov), colour);
  m.roughnessNode = select(isLetters, 0.35, select(isVinyl, 0.2, select(isBox, 0.3, 0.7)));
  m.metalnessNode = select(isLetters.and(dot(ink, vec3(0.33)).greaterThan(0.25)), 0.6, 0);
  const backlit = select(isBox, colour.mul(n.mul(1.6).add(0.12)), vec3(0));
  const lettersGlow = select(isLetters, ink.mul(cov).mul(n.mul(0.8)), vec3(0));
  const paintedLamp = select(isPainted, colour.mul(n.mul(0.35)), vec3(0));
  m.emissiveNode = backlit.add(neonC.mul(n.mul(1.6).add(0.35))).add(lettersGlow).add(paintedLamp).mul(lit);
  return m;
}

// Awnings: canvas on a frame, sloping out from under the sign; plain or striped, dirtier at the hem
function createAwningGeometry() {
  // Unit awning: attached along y = 0 at the wall (z = 0), slope out to z = 1 at y = -0.72, valance down to y = -1
  const positions = [], normals = [];
  const quad = (a, b, c, d, n) => { positions.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) normals.push(...n); };
  const sl = new THREE.Vector3(0, 1, 0.72).normalize();
  quad([-0.5, 0, 0], [-0.5, -0.72, 1], [0.5, -0.72, 1], [0.5, 0, 0], [sl.x, sl.y, sl.z]);
  quad([-0.5, -0.72, 1], [-0.5, -1, 1], [0.5, -1, 1], [0.5, -0.72, 1], [0, 0, 1]);
  for (const x of [-0.5, 0.5]) {
    const n = [Math.sign(x), 0, 0];
    positions.push(x, 0, 0, x, -0.72, 1, x, -1, 1);
    for (let i = 0; i < 3; i++) normals.push(...n);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return g;
}
function createAwningMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const aAwning = attribute('aAwning', 'vec4');
  const aSize = attribute('aSize', 'vec3');
  const x = positionGeometry.x.mul(aSize.x);
  const stripe = step(0.5, fract(x.div(0.34)));
  const striped = mix(aAwning.xyz, vec3(0.85, 0.83, 0.78), stripe.mul(step(0.5, aAwning.w)));
  const weave = float(0.92).add(hash21(floor(vec2(x.mul(90), positionGeometry.y.mul(aSize.y).mul(90)))).mul(0.08));
  const hem = smoothstep(-0.55, -1.0, positionGeometry.y).mul(0.25);
  m.colorNode = striped.mul(weave).mul(float(1).sub(hem));
  m.roughnessNode = float(0.88);
  m.metalnessNode = float(0);
  return m;
}

// ---- Pools of instances -----------------------------------------------------------------------------------------------------
// Each pool interleaves its per-instance attributes in one buffer: WebGPU allows only 8 vertex buffers per pipeline
class Pool {
  constructor(group, name, geometry, material, capacity, attrs, castShadow) {
    const geo = new THREE.BufferGeometry();
    if (geometry.index) geo.setIndex(geometry.index);
    for (const k of ['position', 'normal']) geo.setAttribute(k, geometry.attributes[k]);
    this.layout = layoutOf(attrs);
    this.stride = this.layout.stride;
    this.buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * this.stride), this.stride);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    for (const [k, { size, offset }] of Object.entries(this.layout.fields)) {
      geo.setAttribute(k, new THREE.InterleavedBufferAttribute(this.buffer, size, offset));
    }
    this.data = this.buffer.array;
    this.mesh = new THREE.InstancedMesh(geo, material, capacity);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.capacity = capacity;
    this.count = 0;
    group.add(this.mesh);
  }
  flag() {
    const n = this.count;
    this.mesh.count = n;
    for (const [a, size] of [[this.mesh.instanceMatrix, 16], [this.buffer, this.stride]]) {
      a.clearUpdateRanges();
      if (n) a.addUpdateRange(0, n * size);
      a.needsUpdate = true;
    }
  }
}
function layoutOf(attrs) {
  const fields = {};
  let stride = 0;
  for (const [k, size] of Object.entries(attrs)) { fields[k] = { size, offset: stride }; stride += size; }
  return { fields, stride };
}

// One shop's parts, per pool: matrices and interleaved attributes, built once and copied into the pools while it is near
class Parts {
  constructor() { this.lists = {}; }
  add(pool, matrix, values) {
    let l = this.lists[pool];
    if (!l) this.lists[pool] = (l = { matrices: [], values: [] });
    l.matrices.push(matrix);
    l.values.push(values);
    return l.matrices.length - 1;
  }
  freeze(attrs) {
    for (const [pool, l] of Object.entries(this.lists)) {
      const { fields, stride } = layoutOf(attrs[pool]);
      const n = l.matrices.length;
      const mat = new Float32Array(n * 16);
      l.matrices.forEach((m, i) => mat.set(m, i * 16));
      const data = new Float32Array(n * stride);
      l.values.forEach((v, i) => { for (const [k, { offset }] of Object.entries(fields)) data.set(v[k], i * stride + offset); });
      this.lists[pool] = { n, mat, data };
    }
    return this;
  }
}

// ---- The kit: one shopfront ---------------------------------------------------------------------------------------------------
const linear = (hexColour) => { const c = new THREE.Color().setHex(hexColour); return [c.r, c.g, c.b]; };
const PAINTS = [0x1f3b2d, 0x151515, 0x5a1a1a, 0x1b2a44, 0x2b2d30, 0xe8e0cc, 0x6b1f1f, 0x23403a, 0x3a2e24, 0xf2f0ea, 0x7a1c1c, 0x2a3f5c];
const METALS = { silver: [0.52, 0.53, 0.55], bronze: [0.16, 0.1, 0.06], black: [0.025, 0.025, 0.028], brass: [0.55, 0.4, 0.16] };
const TAGS = ['KAZE', 'REMO', 'SKOR', 'BLAST', 'ZOOM', 'DUSTY', 'MOTH', 'ECHO', 'SHOK', 'OVR', 'KRAZY', 'FAME', 'NOVA', 'ZEKE', 'RIOT',
  'SAGE', 'PEZ', 'LOKI', 'DEMO', 'TROY', 'WOLF', 'KIDD', 'JOKR', 'MIST'];
const BLADE_WORDS = { pizza: 'PIZZA', bar: 'BAR', bodega: 'DELI', cafe: 'CAFÉ', books: 'BOOKS', pharmacy: '+', barber: 'BARBER',
  restaurant: 'OPEN', diner: 'EAT', liquor: 'LIQUOR', hardware: 'KEYS', laundromat: 'LAUNDRY', takeout: 'FOOD', bakery: 'BAKERY',
  jewelry: 'GOLD', cleaners: 'CLEAN', florist: 'FLOWERS', latin: 'TACOS', sushi: 'SUSHI', juice: 'JUICE', souvenir: 'NYC', phones: 'CELL' };
const SCHEME = {
  stone: ['luxury', 'bank', 'jewelry'],
  metal: ['bodega', 'phones', 'takeout', 'laundromat', 'pharmacy', 'souvenir', 'diner', 'juice', 'salon', 'cleaners', 'shoes', 'office', 'vacant'],
  wood: ['restaurant', 'bar', 'cafe', 'books', 'bakery', 'florist', 'barber', 'sushi', 'latin', 'pizza', 'liquor', 'hardware']
};

// The chalk line on a sandwich board
const BOARD_LINES = {
  cafe: ['ICED LATTE $4', 'COFFEE & CROISSANT', 'FREE WIFI', 'PUMPKIN SPICE IS BACK'], bakery: ['FRESH BREAD', 'CINNAMON ROLLS', 'BAGELS 2 FOR $3'],
  restaurant: ['BRUNCH SAT & SUN', 'HAPPY HOUR 4-7', "TONIGHT: CHEF'S SPECIAL"], bar: ['HAPPY HOUR 4-7', 'LIVE MUSIC TONIGHT', '$5 DRAFTS', 'TRIVIA TUESDAY'],
  pizza: ['$1.50 SLICE', 'PIZZA BY THE SLICE', '2 SLICES + SODA $6'], salon: ['WALK-INS WELCOME', 'MANI PEDI $35'], barber: ['WALK-INS WELCOME', 'CUTS $25'],
  juice: ['ACAI BOWLS', 'FRESH JUICE'], florist: ['ROSES $12', 'FRESH FLOWERS'], phones: ['WE FIX SCREENS', 'UNLOCK ANY PHONE'],
  diner: ['BREAKFAST ALL DAY', 'SOUP OF THE DAY'], latin: ['TACOS $3', 'MENU DEL DIA'], sushi: ['LUNCH SPECIAL', 'RAMEN $14']
};
const pickBoard = (id, r) => { const l = BOARD_LINES[id] || ['OPEN']; return l[Math.floor(r() * l.length)]; };

function buildShop(shop) {
  const type = SHOP_TYPES[shop.type];
  const id = shopIdentity(type.id, shop.seed);
  const r = id.r;
  const parts = new Parts();
  const W = shop.width;
  const rec = shop.record;
  const top = (rec.floorHeight || 3.6) - 0.06;
  const ground = 0.22;
  const A = top - ground;
  // Axes: X runs to the right of someone facing the shop, N out of the wall
  const Xx = shop.nz, Xz = -shop.nx, Nx = shop.nx, Nz = shop.nz;
  const forward = Xx * shop.ux + Xz * shop.uz > 0;
  const Lx = forward ? shop.x : shop.x + shop.ux * W, Lz = forward ? shop.z : shop.z + shop.uz * W;
  const at = (u, n) => [Lx + Xx * u + Nx * n, Lz + Xz * u + Nz * n];
  const matrix = (u, y, n, sx, sy, sz, axes = 0) => {
    const [x, z] = at(u, n);
    // axes 0: (X, up, N); 1: plane facing +X (-N, up, X); 2: plane facing -X (N, up, -X)
    const a = axes === 0 ? [Xx, Xz, Nx, Nz] : axes === 1 ? [-Nx, -Nz, Xx, Xz] : [Nx, Nz, -Xx, -Xz];
    return [a[0] * sx, 0, a[1] * sx, 0, 0, sy, 0, 0, a[2] * sz, 0, a[3] * sz, 0, x, y, z, 1];
  };
  const box = (u0, u1, y0, y1, n0, n1, kind, colour) => {
    const sx = u1 - u0, sy = y1 - y0, sz = n1 - n0;
    if (sx <= 0.001 || sy <= 0.001 || sz <= 0.001) return -1;
    return parts.add('frame', matrix((u0 + u1) / 2, (y0 + y1) / 2, (n0 + n1) / 2, sx, sy, sz), { aFrame: [...colour, kind], aSize: [sx, sy, sz] });
  };
  // One room behind all of this shop's glass
  const roomDepth = 3.2 + r() * 3.5;
  const glass = (u0, u1, y0, y1, n, mode, roomFloor, axes = 0) => {
    const sx = u1 - u0, sy = y1 - y0;
    if (sx <= 0.05 || sy <= 0.05) return;
    parts.add('glass', matrix((u0 + u1) / 2, (y0 + y1) / 2, n, sx, sy, 1, axes),
      { aGlass: [shop.type, shop.seed, 1, mode], aRoom: [roomFloor, A + 0.1, roomDepth, 0], aSize: [sx, sy, 1] });
  };
  const sign = (uc, yc, n, w, h, text, opts, axes = 0) => {
    if (!text || w <= 0.05 || h <= 0.05) return -1;
    const font = opts.font ?? id.font;
    const vertical = opts.vertical ? 1 : 0;
    const enc = encodeText(text, font, opts.tracking ?? (vertical ? 0 : 0.02));
    const codes = enc.codes;
    return parts.add('sign', matrix(uc, yc, n, w, h, 1, axes), {
      aText0: codes.subarray(0, 4), aText1: codes.subarray(4, 8), aText2: codes.subarray(8, 12),
      aSignA: [...linear(opts.ink ?? id.ink), font], aSignB: [...linear(opts.board ?? id.board), opts.style],
      aSignC: [vertical ? enc.count : enc.width, opts.letter ?? 0.62, opts.tracking ?? (vertical ? 0 : 0.02), vertical], aSize: [w, h, 1]
    });
  };

  // Materials of this front
  const scheme = SCHEME.stone.includes(type.id) ? 'stone' : SCHEME.wood.includes(type.id) ? (r() < 0.5 ? 'wood' : 'painted')
    : SCHEME.metal.includes(type.id) ? (r() < 0.72 ? 'metal' : 'painted') : (r() < 0.5 ? 'metal' : r() < 0.6 ? 'stone' : 'painted');
  const paint = linear(PAINTS[Math.floor(r() * PAINTS.length)]);
  const masonry = masonryKind(rec);
  const white = [1, 1, 1];
  const metalC = scheme === 'stone' ? (r() < 0.5 ? METALS.bronze : METALS.black) : r() < 0.55 ? METALS.silver : METALS.black;
  const pierKind = scheme === 'stone' ? (r() < 0.5 ? KIND.granite : KIND.stone) : masonry ?? (r() < 0.5 ? KIND.granite : KIND.concrete);
  const paintedPiers = scheme === 'painted' && r() < 0.5;
  const pierPaint = paintedPiers ? KIND.paintedBrick : pierKind;
  const pierColour = paintedPiers ? paint : pierKind === masonry ? masonryShade(rec) : white;
  const frameKind = scheme === 'wood' ? KIND.wood : scheme === 'painted' ? KIND.planks : KIND.metal;
  const frameColour = scheme === 'wood' ? [0.85, 0.75, 0.65] : scheme === 'painted' ? paint : metalC;
  const bulkKind = scheme === 'stone' ? KIND.granite : scheme === 'wood' ? KIND.wood : scheme === 'painted' ? KIND.planks
    : [KIND.tiles, KIND.metal, KIND.granite, KIND.terrazzo][Math.floor(r() * 4)];
  const bulkColour = bulkKind === KIND.metal ? metalC : bulkKind === KIND.planks ? paint : white;

  // Proportions
  const { pw, pd, alcove, a, gz, front } = shopLayout(shop, SHOP_TYPES);
  const ys = Math.min(top - 0.5, ground + A * (0.72 + r() * 0.05));
  const yt = ground + Math.min(2.35, A * 0.68);
  const yb = ground + 0.36 + r() * 0.26;
  const capH = 0.1;
  const opening0 = pw, opening1 = W - pw, Wo = opening1 - opening0;

  // Piers and cap
  box(0, pw, ground, top, 0, Math.max(pd, front + 0.04), pierPaint, pierColour);
  box(W - pw, W, ground, top, 0, Math.max(pd, front + 0.04), pierPaint, pierColour);
  const fasciaN = Math.max(pd - 0.02, front + 0.02);
  box(0, W, top - capH, top, 0, fasciaN + 0.07, paintedPiers ? KIND.paint : pierKind, paintedPiers ? paint : pierColour);

  // Fascia and its sign
  const signStyle = id.style;
  const boardHex = id.board;
  const fasciaKind = signStyle === STYLE.letters ? (scheme === 'stone' ? pierKind : KIND.enamel) : signStyle === STYLE.neon ? KIND.enamel
    : signStyle === STYLE.painted ? KIND.planks : KIND.paint;
  const fasciaColour = signStyle === STYLE.letters ? (scheme === 'stone' ? white : linear(boardHex)) : signStyle === STYLE.neon ? [0.02, 0.02, 0.022]
    : signStyle === STYLE.painted ? linear(boardHex) : signStyle === STYLE.box ? metalC : paint;
  box(opening0, opening1, ys, top - capH, 0, fasciaN, fasciaKind, fasciaColour);
  const bandH = top - capH - ys;
  const signW = Wo - 0.16;
  const yc = ys + bandH / 2;
  if (signStyle === STYLE.box) {
    const depth = 0.16 + r() * 0.08;
    box(opening0 + 0.06, opening1 - 0.06, ys + 0.05, top - capH - 0.04, fasciaN, fasciaN + depth, KIND.metal, METALS.black);
    sign(W / 2, yc, fasciaN + depth + 0.004, signW - 0.06, bandH - 0.12, id.name, { style: STYLE.box, letter: 0.6 });
  } else if (signStyle === STYLE.painted) {
    sign(W / 2, yc, fasciaN + 0.004, signW, bandH - 0.06, id.name, { style: STYLE.painted, letter: 0.58 });
    // Gooseneck lamps over the board
    const lamps = Math.max(2, Math.round(Wo / 2.2));
    for (let i = 0; i < lamps; i++) {
      const u = opening0 + Wo * (i + 0.5) / lamps;
      box(u - 0.012, u + 0.012, top - capH - 0.02, top - 0.02, fasciaN, fasciaN + 0.3, KIND.metal, METALS.black);
      box(u - 0.07, u + 0.07, top - capH - 0.07, top - capH, fasciaN + 0.22, fasciaN + 0.36, KIND.lamp, [1, 0.8, 0.55]);
    }
  } else if (signStyle === STYLE.letters) {
    sign(W / 2, yc, fasciaN + 0.03, signW * 0.86, bandH * 0.62, id.name, { style: STYLE.letters, letter: 0.8, tracking: 0.08 });
  } else if (signStyle === STYLE.neon) {
    sign(W / 2, yc, fasciaN + 0.03, signW, bandH - 0.08, id.name, { style: STYLE.neon, letter: 0.6, board: 0x111111 });
  } else if (signStyle === STYLE.vinyl) {
    // The name goes on the glass below; a small plaque on the fascia
    sign(W / 2, yc, fasciaN + 0.004, Math.min(signW, 2.4), bandH * 0.5, id.name, { style: STYLE.painted, letter: 0.55 });
  }

  // Door
  const double = Wo > 7.5 && (r() < 0.5 || ['bank', 'pharmacy', 'restaurant', 'luxury'].includes(type.id));
  const dw = Math.min(double ? 1.8 : 1.0, Wo * 0.45);
  const where = r();
  const d0 = Wo < 3.2 || where > 0.8 || type.id === 'bank' || type.id === 'luxury' ? opening0 + (Wo - dw) / 2
    : where < 0.4 ? opening0 + 0.12 : opening1 - 0.12 - dw;
  const d1 = d0 + dw;
  const doorN = alcove ? 0.05 : gz;
  const jamb = 0.07;
  box(d0 - jamb, d0, ground, yt + 0.1, 0, doorN + 0.07, frameKind, frameColour);
  box(d1, d1 + jamb, ground, yt + 0.1, 0, doorN + 0.07, frameKind, frameColour);
  const leaves = double ? 2 : 1;
  const lw = dw / leaves;
  for (let k = 0; k < leaves; k++) {
    const l0 = d0 + k * lw, l1 = l0 + lw;
    box(l0, l0 + 0.08, ground, yt, doorN - 0.02, doorN + 0.03, frameKind, frameColour);
    box(l1 - 0.08, l1, ground, yt, doorN - 0.02, doorN + 0.03, frameKind, frameColour);
    box(l0 + 0.08, l1 - 0.08, ground, ground + 0.24, doorN - 0.02, doorN + 0.03, KIND.metal, METALS.silver);
    box(l0 + 0.08, l1 - 0.08, yt - 0.08, yt, doorN - 0.02, doorN + 0.03, frameKind, frameColour);
    glass(l0 + 0.08, l1 - 0.08, ground + 0.24, yt - 0.08, doorN, 1, 0.24);
    box(l0 + lw * 0.2, l1 - lw * 0.2, ground + 0.98, ground + 1.03, doorN + 0.03, doorN + 0.07, KIND.chrome, [0.8, 0.8, 0.8]);
  }
  // Alcove: the windows stand forward, glass returns run back to the door, a floor and a soffit close the recess
  if (alcove) {
    box(d0 - jamb - 0.04, d0 - jamb, ground, yb, doorN, a, bulkKind, bulkColour);
    box(d1 + jamb, d1 + jamb + 0.04, ground, yb, doorN, a, bulkKind, bulkColour);
    // Returns face into the alcove: a pane on the left side looks right (+X), on the right side left (-X)
    for (const [u, axes] of [[d0 - jamb - 0.02, 1], [d1 + jamb + 0.02, 2]]) {
      const depth = a - doorN - 0.04;
      parts.add('glass', matrix(u, (yb + yt) / 2, doorN + 0.02 + depth / 2, depth, yt - yb, 1, axes),
        { aGlass: [shop.type, shop.seed, 1, 4], aRoom: [yb - ground, A, 3, 0], aSize: [depth, yt - yb, 1] });
    }
    box(d0 - jamb, d1 + jamb, ground, ground + 0.015, 0, a + 0.02, KIND.terrazzo, white);
  }

  // Display windows either side of the door
  const spans = [[opening0, d0 - jamb], [d1 + jamb, opening1]].filter(([s0, s1]) => s1 - s0 > 0.35);
  for (const [s0, s1] of spans) {
    box(s0, s1, ground, yb, 0, gz + 0.06, bulkKind, bulkColour);
    box(s0, s1, yb, yb + 0.05, 0, gz + 0.09, frameKind === KIND.metal ? KIND.metal : KIND.stone, frameKind === KIND.metal ? metalC : white);
    glass(s0, s1, yb + 0.05, yt, gz, type.id === 'vacant' && r() < 0.7 ? 3 : 0, yb + 0.05 - ground);
    const bays = Math.max(1, Math.round((s1 - s0) / (1.5 + r() * 1.1)));
    for (let i = 0; i <= bays; i++) {
      const u = s0 + (s1 - s0) * i / bays;
      const u0 = Math.max(s0, u - 0.035), u1 = Math.min(s1, u + 0.035);
      box(u0, u1, yb + 0.05, yt, gz - 0.03, gz + 0.05, frameKind, frameColour);
    }
  }
  // Head over windows and door, then the transom up to the sign
  box(opening0, opening1, yt, yt + 0.1, 0, front, frameKind, frameColour);
  if (ys - yt - 0.1 > 0.16) {
    if (r() < 0.65) {
      glass(opening0, opening1, yt + 0.1, ys, gz, 2, yt + 0.1 - ground);
      const bays = Math.max(1, Math.round(Wo / 1.2));
      for (let i = 1; i < bays; i++) {
        const u = opening0 + Wo * i / bays;
        box(u - 0.025, u + 0.025, yt + 0.1, ys, gz - 0.02, gz + 0.04, frameKind, frameColour);
      }
    } else {
      box(opening0, opening1, yt + 0.1, ys, 0, gz + 0.02, fasciaKind === KIND.enamel ? KIND.enamel : frameKind, frameColour);
    }
  }

  // Lettering on the glass: the name (vinyl style), an OPEN sign, a vacant shop's FOR LEASE
  const mainSpan = spans.reduce((best, s) => (!best || s[1] - s[0] > best[1] - best[0] ? s : best), null);
  if (mainSpan) {
    const [s0, s1] = mainSpan, sw = s1 - s0, mid = (s0 + s1) / 2;
    if (signStyle === STYLE.vinyl) {
      sign(mid, yb + (yt - yb) * 0.66, gz + 0.006, sw * 0.8, 0.42, id.name, { style: STYLE.vinyl, letter: 0.75, font: id.font });
      if (id.tagline) sign(mid, yb + (yt - yb) * 0.5, gz + 0.006, sw * 0.7, 0.16, id.tagline, { style: STYLE.vinyl, letter: 0.8, font: FONTS.josefin });
    }
    if (type.id === 'vacant') {
      sign(mid, yb + (yt - yb) * 0.55, gz + 0.008, Math.min(sw * 0.8, 1.2), 0.5, 'FOR LEASE', { style: STYLE.box, board: 0xf2f0ea, ink: 0xb01e1e, font: FONTS.anton, letter: 0.62 });
      sign(mid, yb + (yt - yb) * 0.55 - 0.32, gz + 0.008, Math.min(sw * 0.8, 1.2), 0.16, '212-555-01' + Math.floor(10 + r() * 89), { style: STYLE.box, board: 0xf2f0ea, ink: 0x151515, font: FONTS.oswald, letter: 0.7 });
    } else if (r() < 0.45 && !['bank', 'luxury', 'gallery', 'office'].includes(type.id)) {
      const u = r() < 0.5 ? s0 + 0.5 : s1 - 0.5;
      sign(u, yb + (yt - yb) * 0.62, gz + 0.008, 0.62, 0.26, 'OPEN', { style: STYLE.neon, ink: r() < 0.6 ? 0xff3040 : 0x40a0ff, board: 0x050505, font: FONTS.bebas, letter: 0.8 });
    }
  }

  // Awning under the sign
  let shade = null;
  if (id.awning !== null) {
    const top = ys - 0.03;
    const drop = Math.min(0.75 + r() * 0.3, top - ground - 2.15);
    if (drop > 0.35) {
      const depth = 1.0 + r() * 0.6;
      const striped = typeof id.awning === 'string';
      const awningHex = striped ? { 'stripe-red': 0xa01818, 'stripe-blue': 0x1f4f8a, 'stripe-green': 0x1f5a32, 'stripe-black': 0x161616 }[id.awning] : id.awning;
      const n0 = front + 0.02;
      parts.add('awning', matrix(W / 2, top, n0, Wo - 0.06, drop, depth),
        { aAwning: [...linear(awningHex), striped ? 1 : 0], aSize: [Wo - 0.06, drop, depth] });
      // Valance lettering (the unit awning slopes down 0.72 of its drop, the valance hangs the rest)
      const valance = drop * 0.28;
      const light = (awningHex >> 16 & 255) * 0.3 + (awningHex >> 8 & 255) * 0.59 + (awningHex & 255) * 0.11 > 140;
      sign(W / 2, top - drop - valance * 0.5, n0 + depth + 0.006, (Wo - 0.06) * 0.92, valance * 0.82, id.tagline || id.name,
        { style: STYLE.letters, ink: light ? 0x151515 : 0xf2f0ea, font: id.font, letter: 0.7 });
      shade = { drop, depth };
    }
  }

  // Blade sign on a pier
  if (id.blade) {
    const word = BLADE_WORDS[type.id];
    const vertical = !!word && word.length <= 7;
    const text = word || id.name;
    const bw = vertical ? 0.62 : 0.9;
    const bh = vertical ? Math.min(0.45 + text.length * 0.3, 2.2) : 0.62;
    const uc = r() < 0.5 ? pw * 0.5 : W - pw * 0.5;
    const ycB = Math.min(top - 0.2, ys + 0.2) + bh / 2 - 0.2;
    const n0 = Math.max(pd, front) + 0.08;
    box(uc - 0.06, uc + 0.06, ycB - bh / 2, ycB + bh / 2, n0, n0 + bw, KIND.enamel, linear(id.board));
    box(uc - 0.015, uc + 0.015, ycB + bh / 2, ycB + bh / 2 + 0.04, 0, n0 + bw, KIND.metal, METALS.black);
    for (const [du, axes] of [[0.061, 1], [-0.061, 2]]) {
      sign(uc + du, ycB, n0 + bw / 2, bw * 0.9, bh * 0.92, text,
        { style: id.style === STYLE.neon ? STYLE.neon : STYLE.box, vertical, letter: 0.7, font: vertical ? FONTS.oswald : id.font }, axes);
    }
  }

  // What spills out onto the sidewalk
  const tilt = (u, y, n, sx, sy, sz, angle) => {
    // A box tilted about the shop's X axis (its top leaning out towards +N for a positive angle)
    const [x, z] = at(u, n);
    const c = Math.cos(angle), sn = Math.sin(angle);
    const upx = Nx * sn, upy = c, upz = Nz * sn;
    const nx = Nx * c, ny = -sn, nz = Nz * c;
    return [Xx * sx, 0, Xz * sx, 0, upx * sy, upy * sy, upz * sy, 0, nx * sz, ny * sz, nz * sz, 0, x, y, z, 1];
  };
  const doorMid = (d0 + d1) / 2;
  const sidewalk = front + 0.25;
  const free = (u0, u1) => u0 >= 0.1 && u1 <= W - 0.1;
  // Sandwich board on the pavement: two leaning panels with the day's line chalked on
  const boardTypes = ['cafe', 'bakery', 'restaurant', 'bar', 'pizza', 'salon', 'barber', 'juice', 'florist', 'phones', 'diner', 'latin', 'sushi'];
  if (boardTypes.includes(type.id) && r() < 0.4) {
    const u = Math.min(W - 0.5, Math.max(0.5, doorMid + (r() < 0.5 ? -1.3 : 1.3)));
    const n = sidewalk + 0.75;
    const lean = 0.2, h = 0.95, w = 0.62;
    const chalk = [0.025, 0.04, 0.035];
    for (const side of [1, -1]) {
      // Each panel leans in, its top meeting the other's
      const m = tilt(u, 0.22 + h * Math.cos(lean) / 2, n + side * h * Math.sin(lean) / 2, w, h, 0.03, -side * lean);
      parts.add('frame', m, { aFrame: [...chalk, KIND.enamel], aSize: [w, h, 0.03] });
    }
    const line = pickBoard(type.id, r);
    for (const side of [1, -1]) {
      const yc = 0.22 + h * 0.55;
      const off = h * 0.55 * Math.sin(lean) + 0.02;
      const [x, z] = at(u, n + side * off);
      const c = Math.cos(lean), sn = Math.sin(lean);
      // Text plane facing out of each panel
      const fx = Nx * side, fz = Nz * side;
      const rx = side > 0 ? Xx : -Xx, rz = side > 0 ? Xz : -Xz;
      const upx = -fx * sn, upz = -fz * sn;
      const nnx = fx * c, nny = sn, nnz = fz * c;
      const enc = encodeText(line, FONTS.marker, 0.01);
      parts.add('sign', [rx * w * 0.86, 0, rz * w * 0.86, 0, upx * 0.42, c * 0.42, upz * 0.42, 0, nnx, nny, nnz, 0, x, yc, z, 1], {
        aText0: enc.codes.subarray(0, 4), aText1: enc.codes.subarray(4, 8), aText2: enc.codes.subarray(8, 12),
        aSignA: [...linear(0xf2f0ea), FONTS.marker], aSignB: [...chalk, STYLE.tag], aSignC: [enc.width, 0.55, 0.01, 0], aSize: [w * 0.86, 0.42, 1]
      });
    }
  }
  // Fruit or flower stand across part of the front
  if ((type.id === 'bodega' && r() < 0.45) || (type.id === 'florist' && r() < 0.75)) {
    const len = Math.min(Wo * 0.55, 1.6 + r() * 1.2);
    const u0 = d0 > W / 2 ? opening0 + 0.1 : opening1 - 0.1 - len;
    if (free(u0, u0 + len)) {
      const flowersStand = type.id === 'florist' ? 1 : 0;
      for (let k = 0; k < 3; k++) {
        const n0 = sidewalk + k * 0.32, y1 = 0.22 + 0.95 - k * 0.22;
        box(u0, u0 + len, 0.22, y1 - 0.12, n0, n0 + 0.32, KIND.wood, [0.9, 0.8, 0.7]);
        box(u0 + 0.02, u0 + len - 0.02, y1 - 0.12, y1, n0 + 0.02, n0 + 0.3, KIND.produce, [flowersStand, 0, 0]);
      }
    }
  }
  // Bistro tables
  if ((type.id === 'cafe' && r() < 0.5) || (['restaurant', 'bakery', 'juice'].includes(type.id) && r() < 0.22)) {
    const tables = Wo > 6 ? 2 : 1;
    for (let k = 0; k < tables; k++) {
      const u = opening0 + Wo * (k + 0.5) / tables + (k ? 0.4 : -0.4);
      if (Math.abs(u - doorMid) < 1.0) continue;
      const n = sidewalk + 0.55;
      parts.add('pole', matrix(u, 0.22 + 0.37, n, 0.06, 0.74, 0.06), { aFrame: [...METALS.black, KIND.metal], aSize: [0.06, 0.74, 0.06] });
      parts.add('pole', matrix(u, 0.22 + 0.745, n, 0.6, 0.03, 0.6), { aFrame: [0.85, 0.82, 0.78, KIND.stone], aSize: [0.6, 0.03, 0.6] });
      for (const du of [-0.5, 0.5]) {
        const cu = u + du;
        box(cu - 0.2, cu + 0.2, 0.22 + 0.44, 0.22 + 0.48, n - 0.2, n + 0.2, KIND.metal, METALS.black);
        box(cu + (du > 0 ? 0.17 : -0.2), cu + (du > 0 ? 0.2 : -0.17), 0.22 + 0.48, 0.22 + 0.88, n - 0.2, n + 0.2, KIND.metal, METALS.black);
        for (const [a2, b2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(cu + a2 * 0.17 - 0.012, cu + a2 * 0.17 + 0.012, 0.22, 0.22 + 0.44, n + b2 * 0.17 - 0.012, n + b2 * 0.17 + 0.012, KIND.metal, METALS.black);
      }
    }
  }
  // Barber pole on the pier
  if (type.id === 'barber' && r() < 0.9) {
    const u = r() < 0.5 ? pw * 0.5 : W - pw * 0.5;
    parts.add('pole', matrix(u, 2.1, pd + 0.16, 0.18, 0.75, 0.18), { aFrame: [1, 1, 1, KIND.barberPole], aSize: [0.18, 0.75, 0.18] });
    box(u - 0.1, u + 0.1, 2.46, 2.52, pd, pd + 0.26, KIND.chrome, [0.8, 0.8, 0.8]);
    box(u - 0.1, u + 0.1, 1.68, 1.74, pd, pd + 0.26, KIND.chrome, [0.8, 0.8, 0.8]);
  }
  // A steel cellar hatch in the pavement
  if (r() < 0.22) {
    const len = 1.3 + r() * 0.5;
    const u0 = (d0 > W / 2 ? opening0 + 0.2 : opening1 - 0.2 - len);
    if (free(u0, u0 + len)) box(u0, u0 + len, 0.21, 0.235, sidewalk + 0.1, sidewalk + 1.1, KIND.tread, [0.9, 0.9, 0.9]);
  }

  // Roll-down gate (shown when the shop is shut) and the tags sprayed on it
  const gateN = front + 0.05;
  const gate = box(opening0, opening1, ground, ys - 0.02, gateN, gateN + 0.03, r() < 0.65 ? KIND.shutter : KIND.rustShutter, r() < 0.7 ? white : paint);
  const tags = [];
  const nTags = Math.floor(r() * 3);
  // Each tag in its own slot across the gate and a few millimetres proud of the one before: two tags at one depth that
  // overlap fight over every pixel they share
  const slot = Wo / Math.max(nTags, 1);
  for (let i = 0; i < nTags; i++) {
    const w = Math.min(slot * 0.92, Wo * 0.45, 1.2 + r() * 1.4);
    const uc = opening0 + slot * i + w / 2 + r() * Math.max(0, slot - w);
    tags.push(sign(uc, ground + 0.5 + r() * 0.9, gateN + 0.035 + i * 0.006, w, w * 0.4, TAGS[Math.floor(r() * TAGS.length)],
      { style: STYLE.tag, font: FONTS.marker, ink: [0xff3b6b, 0x3bd1ff, 0xffd23b, 0x7cff5a, 0xffffff, 0xb05cff][Math.floor(r() * 6)], letter: 0.8 }));
  }

  parts.freeze(POOL_ATTRS);
  return {
    parts, gate, tags, open: true, roll: undefined,
    gateBase: { y0: ground, y1: ys - 0.02, matrix: parts.lists.frame.mat.slice(gate * 16, gate * 16 + 16) },
    light: { x: at(W / 2, front + 0.5)[0], z: at(W / 2, front + 0.5)[1], y: ys - 0.12, tx: at(W / 2, front + 2.2)[0], tz: at(W / 2, front + 2.2)[1] },
    lightColour: new THREE.Color().setRGB(...linear(INTERIOR[type.id][2])),
    shade
  };
}

const POOL_ATTRS = {
  frame: { aFrame: 4, aSize: 3 },
  glass: { aGlass: 4, aRoom: 4, aSize: 3 },
  sign: { aText0: 4, aText1: 4, aText2: 4, aSignA: 4, aSignB: 4, aSignC: 4, aSize: 3 },
  awning: { aAwning: 4, aSize: 3 },
  pole: { aFrame: 4, aSize: 3 }
};

/**
 * @param {THREE.Scene} scene
 * @param {object[]} shops - from planStorefronts
 * @param {{ radius: number }} options - streaming radius (metres)
 */
function createStorefronts(scene, shops, { radius = 240 } = {}) {
  const group = new THREE.Group();
  group.name = 'Storefronts';
  scene.add(group);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const frameMaterial = createFrameMaterial();
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  const pools = {
    frame: new Pool(group, 'StorefrontFrames', unitBox, frameMaterial, 36000, POOL_ATTRS.frame, true),
    glass: new Pool(group, 'StorefrontGlass', unitPlane, createGlassMaterial(), 9000, POOL_ATTRS.glass, false),
    sign: new Pool(group, 'StorefrontSigns', unitPlane, createSignMaterial(), 9000, POOL_ATTRS.sign, false),
    awning: new Pool(group, 'StorefrontAwnings', createAwningGeometry(), createAwningMaterial(), 3000, POOL_ATTRS.awning, true),
    pole: new Pool(group, 'StorefrontPoles', new THREE.CylinderGeometry(0.5, 0.5, 1, 14), frameMaterial, 3000, POOL_ATTRS.pole, true)
  };

  // Shops by 64 m cell
  const CELL = 64;
  const cells = new Map();
  shops.forEach((s, i) => {
    const k = Math.floor(s.x / CELL) * 100003 + Math.floor(s.z / CELL);
    let list = cells.get(k);
    if (!list) cells.set(k, (list = []));
    list.push(i);
  });
  const built = new Map(); // shop index -> built parts (kept once built: a few kilobytes each)
  const active = [];
  let lastX = Infinity, lastY = Infinity, lastZ = Infinity, lastHourBucket = -1;
  // Painted shopfronts fade in where the kit ends
  cityUniforms.uShopKit.value.set(radius - 55, radius - 20);

  function stream(cx, cy, cz, hour) {
    const candidates = [];
    // Seen from the air the shops shrink to nothing: distance counts the camera's height too
    const lift = Math.max(0, cy - 2);
    const reach = Math.ceil(radius / CELL);
    const ci = Math.floor(cx / CELL), cj = Math.floor(cz / CELL);
    for (let i = ci - reach; i <= ci + reach; i++) for (let j = cj - reach; j <= cj + reach; j++) {
      for (const s of cells.get(i * 100003 + j) || []) {
        const shop = shops[s];
        const d = Math.hypot(shop.x + shop.ux * shop.width / 2 - cx, shop.z + shop.uz * shop.width / 2 - cz, lift);
        if (d < radius) candidates.push([d, s]);
      }
    }
    candidates.sort((a, b) => a[0] - b[0]);
    for (const p of Object.values(pools)) p.count = 0;
    active.length = 0;
    for (const [, s] of candidates) {
      let b = built.get(s);
      if (!b) built.set(s, (b = buildShop(shops[s])));
      const lists = b.parts.lists;
      if (Object.entries(lists).some(([k, l]) => pools[k].count + l.n > pools[k].capacity)) break;
      const type = SHOP_TYPES[shops[s].type];
      // Half the empty shops sit behind their shutters, the rest show papered windows
      b.open = type.id === 'vacant' ? shops[s].seed < 0.5 : shopOpenAt(type, hour);
      if (b.roll === undefined) b.roll = b.open ? 0 : 1;
      b.offsets = {};
      for (const [k, l] of Object.entries(lists)) {
        const pool = pools[k];
        const o = pool.count;
        b.offsets[k] = o;
        pool.mesh.instanceMatrix.array.set(l.mat, o * 16);
        pool.data.set(l.data, o * pool.stride);
        pool.count += l.n;
      }
      // Lights inside and on the signs follow opening hours (a third of the signs stay lit all night)
      const vacant = type.id === 'vacant';
      const lit = vacant ? 0 : b.open ? 1 : (shops[s].seed * 7.3) % 1 < 0.33 ? 0.7 : 0;
      const g = pools.glass, sg = pools.sign;
      const litGlass = g.layout.fields.aGlass.offset + 2, litSign = sg.layout.fields.aSize.offset + 2;
      if (lists.glass) for (let i = 0; i < lists.glass.n; i++) g.data[(b.offsets.glass + i) * g.stride + litGlass] = b.open && !vacant ? 1 : 0;
      if (lists.sign) for (let i = 0; i < lists.sign.n; i++) sg.data[(b.offsets.sign + i) * sg.stride + litSign] = lit;
      b.index = s;
      active.push(b);
      writeGate(b);
    }
    for (const p of Object.values(pools)) p.flag();
    // Forget the parts of shops left far behind (a long drive would otherwise keep every shop of the island)
    if (built.size > 4000) {
      const keep = new Set(active.map((b) => b.index));
      for (const k of built.keys()) {
        if (built.size <= 2500) break;
        if (!keep.has(k)) built.delete(k);
      }
    }
  }

  // The gate rolls down from under the sign: `roll` 0 is open (hidden), 1 is shut
  function writeGate(b) {
    const m = pools.frame.mesh.instanceMatrix.array;
    const o = (b.offsets.frame + b.gate) * 16;
    const { y0, y1, matrix } = b.gateBase;
    const h = (y1 - y0) * b.roll;
    m.set(matrix, o);
    m[o + 4] = 0; m[o + 5] = Math.max(h, 1e-4); m[o + 6] = 0;
    m[o + 13] = y1 - h / 2;
    const s = pools.sign.mesh.instanceMatrix.array;
    for (const t of b.tags) {
      if (t < 0) continue;
      const so = (b.offsets.sign + t) * 16;
      const full = b.parts.lists.sign.mat;
      for (let k = 0; k < 16; k++) s[so + k] = full[t * 16 + k] * (b.roll > 0.97 || k >= 12 ? 1 : 0);
      if (b.roll <= 0.97) s[so + 15] = 1;
    }
  }

  // Store lights: a few spotlights on the nearest open shopfronts, warm pools on the sidewalk after dark
  const spots = [];
  const SPOTS = 24;
  for (let i = 0; i < SPOTS; i++) {
    const spot = new THREE.SpotLight(0xffd8a0, 0, 11, 0.9, 0.85, 1.4);
    spot.castShadow = false;
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    group.add(spot, spot.target);
    spots.push(spot);
  }
  const SPOT_INTENSITY = 30;

  let hourNow = 12;
  function update(camera, hour, dt) {
    hourNow = hour;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const bucket = Math.floor(hour * 4);
    if ((cx - lastX) ** 2 + (cz - lastZ) ** 2 + (cy - lastY) ** 2 > 14 * 14 || bucket !== lastHourBucket) {
      lastX = cx; lastY = cy; lastZ = cz; lastHourBucket = bucket;
      stream(cx, cy, cz, hour);
    }
    // Gates roll towards their state over a couple of seconds
    let moved = false;
    for (const b of active) {
      const target = b.open ? 0 : 1;
      if (b.roll !== target) {
        b.roll = target > b.roll ? Math.min(target, b.roll + dt * 0.45) : Math.max(target, b.roll - dt * 0.45);
        writeGate(b);
        moved = true;
      }
    }
    if (moved) { pools.frame.flag(); pools.sign.flag(); }
    // Spotlights
    const n = Math.min(1, Math.max(0, (cityUniforms.uInteriorGlow.value - 0.55) / 0.65));
    const e = camera.matrixWorld.elements;
    const fl = Math.hypot(e[8], e[10]) || 1, fx = -e[8] / fl, fz = -e[10] / fl;
    const picks = [];
    if (n > 0.01) {
      for (const b of active) {
        if (!b.open || SHOP_TYPES[shops[b.index].type].id === 'vacant') continue;
        const dx = b.light.x - cx, dz = b.light.z - cz, d = Math.hypot(dx, dz);
        if (d > 90) continue;
        picks.push([d + Math.max(0, 6 - (dx * fx + dz * fz)) * 2.5, b]);
      }
      picks.sort((p, q) => p[0] - q[0]);
    }
    for (let i = 0; i < SPOTS; i++) {
      const spot = spots[i];
      const p = picks[i];
      if (!p || p[0] > 90) { spot.intensity = 0; spot.position.set(0, -1000, 0); continue; }
      const b = p[1];
      const fade = Math.min(1, (90 - p[0]) / 25);
      spot.position.set(b.light.x, b.light.y, b.light.z);
      spot.target.position.set(b.light.tx, 0, b.light.tz);
      spot.target.updateMatrixWorld();
      spot.color.copy(b.lightColour);
      spot.intensity = SPOT_INTENSITY * n * fade;
    }
  }

  return { group, update, stream: (x, z) => stream(x, 1.7, z, hourNow), pools, active, shops, colliders: shopColliders(shops, SHOP_TYPES) };
}

export { loadStorefronts, createStorefronts, buildShop };
