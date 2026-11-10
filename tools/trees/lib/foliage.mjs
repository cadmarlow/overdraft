// The foliage atlas, as both builders know it: one row per kind of leaf, four tiles per row.
//   0, 1  sprays: a twig a metre long with its side shoots and leaves, seen from the side the leaves face
//   2     sprig: a short shoot, for the tips and for filling
//   3     mass: a whole branch end of sprays, what a tree wears from further away
// A tile is a square `size` metres across; the twig's foot sits at its bottom centre.

export const TILE = 512;
export const COLS = 4;
export const GUTTER = 6; // clear pixels round a tile
export const FOOT = 0.03; // how far up the tile the twig starts, as a share of the tile

// sRGB bytes to linear
const lin = (r, g, b) => [r, g, b].map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });

/**
 * Kinds of leaf. Lengths in metres.
 * set: the ambientCG sheet (or 'jacaranda' for the Poly Haven fronds, 'ginkgo' for the fans made from LeafSet009)
 * leaf: length of a leaf with its stalk; vary: how much sizes differ
 * spacing: between leaves along a shoot; habit: how leaves sit ('alternate', 'opposite', 'tuft' at the shoot ends)
 * angle: of a leaf off its shoot (radians, lo..hi); tilt: how far leaves roll out of the spray's plane; droop: of a leaf's tip
 * shoots: side shoots on a spray; color: mean leaf colour (linear); wood: shoot colour
 */
export const LEAF_KINDS = [
  { id: 'plane', set: 'LeafSet010', leaf: 0.19, vary: 0.3, spacing: 0.085, habit: 'alternate', angle: [0.7, 1.2], tilt: 0.5, droop: 0.35, shoots: 7, fold: 0.1, color: lin(84, 112, 50), wood: lin(84, 70, 48) },
  { id: 'locust', set: 'jacaranda', leaf: 0.3, vary: 0.25, spacing: 0.075, habit: 'alternate', angle: [0.75, 1.25], tilt: 0.45, droop: 0.55, shoots: 6, fold: 0.03, color: lin(100, 126, 52), wood: lin(70, 60, 44) },
  { id: 'pear', set: 'LeafSet024', leaf: 0.085, vary: 0.25, spacing: 0.04, habit: 'tuft', angle: [0.5, 1.0], tilt: 0.7, droop: 0.2, shoots: 8, fold: 0.2, color: lin(58, 92, 40), wood: lin(72, 58, 46) },
  { id: 'ginkgo', set: 'ginkgo', leaf: 0.085, vary: 0.25, spacing: 0.05, habit: 'tuft', angle: [0.5, 1.1], tilt: 0.6, droop: 0.3, shoots: 7, fold: 0.05, color: lin(98, 130, 56), wood: lin(98, 90, 76) },
  { id: 'oak', set: 'LeafSet016', leaf: 0.14, vary: 0.3, spacing: 0.055, habit: 'tuft', angle: [0.5, 1.1], tilt: 0.6, droop: 0.25, shoots: 7, fold: 0.12, color: lin(66, 96, 42), wood: lin(78, 66, 50) },
  { id: 'elm', set: 'LeafSet014', leaf: 0.1, vary: 0.3, spacing: 0.042, habit: 'alternate', angle: [0.75, 1.15], tilt: 0.3, droop: 0.3, shoots: 9, fold: 0.16, color: lin(72, 102, 46), wood: lin(66, 54, 44) },
  { id: 'linden', set: 'LeafSet004', leaf: 0.105, vary: 0.3, spacing: 0.05, habit: 'alternate', angle: [0.8, 1.3], tilt: 0.4, droop: 0.45, shoots: 8, fold: 0.1, color: lin(70, 106, 48), wood: lin(70, 58, 46) },
  { id: 'cherry', set: 'LeafSet022', leaf: 0.115, vary: 0.25, spacing: 0.048, habit: 'alternate', angle: [0.6, 1.05], tilt: 0.55, droop: 0.5, shoots: 7, fold: 0.18, color: lin(62, 94, 44), wood: lin(84, 56, 46) }
];

// Tile sizes in metres: sprays, sprig, mass
export const TILE_SIZE = [1.05, 1.05, 0.6, 2.3];
export const ROWS = LEAF_KINDS.length;
export const ATLAS_W = TILE * COLS;
export const ATLAS_H = TILE * ROWS;

// uv rectangle of a tile, inside its gutter: { u0, v0, u1, v1 } with v0 at the tile's top
export function tileUV(row, col) {
  return {
    u0: (col * TILE + GUTTER) / ATLAS_W, u1: ((col + 1) * TILE - GUTTER) / ATLAS_W,
    v0: (row * TILE + GUTTER) / ATLAS_H, v1: ((row + 1) * TILE - GUTTER) / ATLAS_H
  };
}
