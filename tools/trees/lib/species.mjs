// The trees of Manhattan's streets and parks: eight kinds, each as a grown tree and as a young one.
// Lengths in metres, angles in radians off the parent branch. See grow.mjs for what each number does.
//
// kind: the census class (tools/trees/build-tree-data.mjs), leaf: the foliage atlas row, bark: the bark photograph
// height, radius, shape, crownBase: the crown's outline; lumps: how uneven it is; clearance: nothing grows below it
// leader: the trunk runs to the top (limbs all the way up it) rather than dividing into scaffold limbs at `fork`
// dbh: trunk diameter at breast height; barkColor: the mean colour (sRGB) the bark photograph is brought to
// orders: how limbs leave the trunk, branches the limbs, and so on:
//   n (a fixed number) or spacing (one every so many metres), t: where along the parent, angle: at t[0] .. at t[1],
//   share: length limit as a share of what is left of the parent beyond it, min: shortest worth growing,
//   need: parents shorter than this carry none, lift: how far out of its layer toward the sky,
//   bend: { up, out, droop, wander } per metre
// foliage: spacing of twigs along the fine branches, core: how much of the crown's inside is bare (0..1 of its radius),
//   lift / droop: twigs aim up or hang, scale: size of the sprays, cup / droopCard: how a spray's card curves,
//   cluster: twigs per cluster at level of detail 1, massScale: size of those clusters

const bend = (up, out, droop, wander) => ({ up, out, droop, wander });

export const SPECIES = [
  // ------------------------------------------------------------------------------------------------ London plane
  {
    id: 'plane-a', kind: 0, leaf: 'plane', bark: 'plane', barkColor: [148, 138, 114], height: 19.5, crownBase: 5.2, radius: 7.4, shape: 'dome', lumps: 0.22, clearance: 4.2,
    leader: false, fork: 6.4, dbh: 0.64, trunk: { lean: 0.03, wander: 0.05 },
    orders: [
      { n: 5, nVary: true, t: [0.64, 1], angle: [1.05, 0.32], roll: 'spiral', stop: 0.97, step: 0.35, bend: bend(0.035, 0, 0, 0.09) },
      { spacing: 1.3, t: [0.2, 0.96], angle: [0.85, 0.6], share: 0.8, min: 1.4, lift: 0.3, need: 2.5, bend: bend(0.03, 0.01, 0, 0.11) },
      { spacing: 0.72, t: [0.22, 0.98], angle: [0.9, 0.65], share: 0.6, min: 0.8, lift: 0.2, need: 1.6, bend: bend(0.02, 0, 0.03, 0.14) }
    ],
    foliage: { spacing: 0.46, t: [0.3], core: 0.5, lift: 0.1, droop: 0.05, scale: 1, cup: 0.14, droopCard: 0.18, cluster: 7, massScale: 1 }
  },
  {
    id: 'plane-b', kind: 0, leaf: 'plane', bark: 'plane', barkColor: [148, 138, 114], height: 10.5, crownBase: 3.3, radius: 3.5, shape: 'oval', lumps: 0.18, clearance: 2.8,
    leader: true, dbh: 0.21, trunk: { lean: 0.03, wander: 0.04 },
    orders: [
      { spacing: 0.56, t: [0.3, 0.97], angle: [1.1, 0.42], roll: 'spiral', bend: bend(0.06, 0, 0, 0.08) },
      { spacing: 0.6, t: [0.25, 0.97], angle: [0.85, 0.6], share: 0.6, min: 0.6, lift: 0.25, need: 1.2, bend: bend(0.03, 0, 0.02, 0.12) }
    ],
    foliage: { spacing: 0.4, t: [0.25], core: 0.3, lift: 0.1, droop: 0.05, scale: 0.92, cup: 0.14, droopCard: 0.18, cluster: 6, massScale: 1 }
  },
  // ------------------------------------------------------------------------------------------------ Honey locust
  {
    id: 'locust-a', kind: 1, leaf: 'locust', bark: 'locust', barkColor: [88, 78, 66], height: 15, crownBase: 4.4, radius: 6.3, shape: 'dome', lumps: 0.32, clearance: 3.8,
    leader: false, fork: 5.2, dbh: 0.42, trunk: { lean: 0.06, wander: 0.07 },
    orders: [
      { n: 5, nVary: true, t: [0.6, 1], angle: [1.08, 0.4], roll: 'spiral', stop: 1.0, step: 0.35, bend: bend(0.03, 0, 0, 0.15) },
      { spacing: 1.1, t: [0.2, 0.96], angle: [0.9, 0.6], share: 0.8, min: 1.4, lift: 0.2, need: 2.5, bend: bend(0.02, 0.01, 0, 0.17) },
      { spacing: 0.7, t: [0.22, 0.98], angle: [0.9, 0.65], share: 0.6, min: 0.8, lift: 0.1, need: 1.5, bend: bend(0.01, 0, 0.03, 0.17) }
    ],
    foliage: { spacing: 0.5, t: [0.3], core: 0.42, lift: 0.05, droop: 0.18, scale: 0.86, cup: 0.1, droopCard: 0.3, cluster: 6, massScale: 1 }
  },
  {
    id: 'locust-b', kind: 1, leaf: 'locust', bark: 'locust', barkColor: [88, 78, 66], height: 9, crownBase: 3.1, radius: 3.2, shape: 'round', lumps: 0.3, clearance: 2.7,
    leader: true, dbh: 0.17, trunk: { lean: 0.06, wander: 0.07 },
    orders: [
      { spacing: 0.52, t: [0.32, 0.97], angle: [1.2, 0.5], roll: 'spiral', bend: bend(0.04, 0, 0, 0.14) },
      { spacing: 0.6, t: [0.22, 0.97], angle: [0.9, 0.6], share: 0.6, min: 0.6, lift: 0.15, need: 1.1, bend: bend(0.02, 0, 0.03, 0.16) }
    ],
    foliage: { spacing: 0.44, t: [0.25], core: 0.25, lift: 0.05, droop: 0.18, scale: 0.8, cup: 0.1, droopCard: 0.3, cluster: 5, massScale: 1 }
  },
  // ------------------------------------------------------------------------------------------------ Callery pear
  {
    id: 'pear-a', kind: 2, leaf: 'pear', bark: 'locust', barkColor: [76, 68, 60], height: 11, crownBase: 2.8, radius: 3.3, shape: 'drop', lumps: 0.12, clearance: 2.6,
    leader: true, dbh: 0.3, trunk: { lean: 0.02, wander: 0.03 },
    orders: [
      { spacing: 0.4, t: [0.24, 0.96], angle: [0.8, 0.28], roll: 'spiral', bend: bend(0.09, 0, 0, 0.06) },
      { spacing: 0.55, t: [0.25, 0.97], angle: [0.62, 0.45], share: 0.5, min: 0.6, lift: 0.4, need: 1.2, bend: bend(0.06, 0, 0, 0.09) }
    ],
    foliage: { spacing: 0.32, t: [0.2], core: 0.34, lift: 0.25, droop: 0, scale: 0.86, cup: 0.12, droopCard: 0.1, cluster: 7, massScale: 0.95 }
  },
  {
    id: 'pear-b', kind: 2, leaf: 'pear', bark: 'locust', barkColor: [76, 68, 60], height: 6.6, crownBase: 2.4, radius: 1.9, shape: 'drop', lumps: 0.12, clearance: 2.3,
    leader: true, dbh: 0.13, trunk: { lean: 0.02, wander: 0.03 },
    orders: [
      { spacing: 0.34, t: [0.34, 0.96], angle: [0.8, 0.3], roll: 'spiral', bend: bend(0.1, 0, 0, 0.06) },
      { spacing: 0.5, t: [0.25, 0.97], angle: [0.62, 0.45], share: 0.5, min: 0.45, lift: 0.4, need: 1, bend: bend(0.06, 0, 0, 0.09) }
    ],
    foliage: { spacing: 0.3, t: [0.2], core: 0.2, lift: 0.25, droop: 0, scale: 0.78, cup: 0.12, droopCard: 0.1, cluster: 6, massScale: 0.95 }
  },
  // ------------------------------------------------------------------------------------------------ Ginkgo
  {
    id: 'ginkgo-a', kind: 3, leaf: 'ginkgo', bark: 'oak', barkColor: [122, 112, 98], height: 14.5, crownBase: 3.4, radius: 3.5, shape: 'spire', lumps: 0.38, clearance: 3,
    leader: true, dbh: 0.32, trunk: { lean: 0.02, wander: 0.02 },
    orders: [
      { spacing: 0.72, t: [0.24, 0.96], angle: [1.08, 0.6], roll: 'spiral', bend: bend(0.03, 0, 0, 0.035) },
      { spacing: 0.7, t: [0.2, 0.96], angle: [0.95, 0.7], share: 0.4, min: 0.5, lift: 0.3, need: 1.4, bend: bend(0.03, 0, 0, 0.05) }
    ],
    foliage: { spacing: 0.34, t: [0.12], core: 0.12, reachUp: 1, lift: 0.15, droop: 0, scale: 0.8, cup: 0.1, droopCard: 0.12, cluster: 6, massScale: 0.9 }
  },
  {
    id: 'ginkgo-b', kind: 3, leaf: 'ginkgo', bark: 'oak', barkColor: [122, 112, 98], height: 8, crownBase: 2.6, radius: 1.75, shape: 'spire', lumps: 0.35, clearance: 2.4,
    leader: true, dbh: 0.12, trunk: { lean: 0.02, wander: 0.02 },
    orders: [
      { spacing: 0.55, t: [0.33, 0.96], angle: [1.0, 0.55], roll: 'spiral', bend: bend(0.04, 0, 0, 0.035) },
      { spacing: 0.6, t: [0.2, 0.96], angle: [0.95, 0.7], share: 0.4, min: 0.4, lift: 0.3, need: 1.1, bend: bend(0.03, 0, 0, 0.05) }
    ],
    foliage: { spacing: 0.32, t: [0.12], core: 0.1, reachUp: 1, lift: 0.15, droop: 0, scale: 0.72, cup: 0.1, droopCard: 0.12, cluster: 5, massScale: 0.9 }
  },
  // ------------------------------------------------------------------------------------------------ Pin oak
  {
    id: 'oak-a', kind: 4, leaf: 'oak', bark: 'oak', barkColor: [86, 78, 70], height: 18.5, crownBase: 4.2, radius: 6.3, shape: 'cone', lumps: 0.16, clearance: 3.8,
    leader: true, dbh: 0.56, trunk: { lean: 0.015, wander: 0.025 },
    orders: [
      { spacing: 0.5, t: [0.22, 0.97], angle: [1.78, 0.5], roll: 'spiral', bend: bend(0.012, 0, 0, 0.05) },
      { spacing: 0.75, t: [0.2, 0.97], angle: [0.95, 0.7], share: 0.5, min: 0.8, lift: 0.12, need: 1.6, bend: bend(0.02, 0, 0.01, 0.1) },
      { spacing: 0.65, t: [0.25, 0.97], angle: [0.9, 0.7], share: 0.5, min: 0.5, lift: 0.1, need: 1.5, bend: bend(0.01, 0, 0.02, 0.12) }
    ],
    foliage: { spacing: 0.52, t: [0.25], core: 0.36, lift: 0.08, droop: 0.05, scale: 0.98, cup: 0.14, droopCard: 0.15, cluster: 7, massScale: 1 }
  },
  {
    id: 'oak-b', kind: 4, leaf: 'oak', bark: 'oak', barkColor: [86, 78, 70], height: 10.5, crownBase: 3.2, radius: 3.4, shape: 'cone', lumps: 0.16, clearance: 2.8,
    leader: true, dbh: 0.22, trunk: { lean: 0.015, wander: 0.025 },
    orders: [
      { spacing: 0.46, t: [0.3, 0.97], angle: [1.7, 0.5], roll: 'spiral', bend: bend(0.015, 0, 0, 0.05) },
      { spacing: 0.62, t: [0.22, 0.97], angle: [0.95, 0.7], share: 0.5, min: 0.6, lift: 0.12, need: 1.2, bend: bend(0.02, 0, 0.01, 0.1) }
    ],
    foliage: { spacing: 0.38, t: [0.22], core: 0.25, lift: 0.08, droop: 0.05, scale: 0.88, cup: 0.14, droopCard: 0.15, cluster: 6, massScale: 1 }
  },
  // ------------------------------------------------------------------------------------------------ Elm / zelkova
  {
    id: 'elm-a', kind: 5, leaf: 'elm', bark: 'elm', barkColor: [94, 84, 72], height: 18.5, crownBase: 5.6, radius: 7.6, shape: 'vase', lumps: 0.2, clearance: 4,
    leader: false, fork: 4.8, dbh: 0.56, trunk: { lean: 0.03, wander: 0.04 },
    orders: [
      { n: 6, nVary: true, t: [0.72, 1], angle: [0.62, 0.2], roll: 'spiral', stop: 1.04, step: 0.35, bend: bend(0, 0.03, 0.012, 0.06) },
      { spacing: 1.3, t: [0.3, 0.97], angle: [0.66, 0.48], share: 0.8, min: 1.5, lift: 0.25, need: 3, bend: bend(0, 0.03, 0.03, 0.1) },
      { spacing: 0.85, t: [0.22, 0.98], angle: [0.85, 0.6], share: 0.58, min: 0.8, lift: 0.05, need: 1.5, bend: bend(-0.01, 0.01, 0.08, 0.13) }
    ],
    foliage: { spacing: 0.58, t: [0.28], core: 0.46, lift: 0, droop: 0.28, scale: 0.94, cup: 0.12, droopCard: 0.3, cluster: 7, massScale: 1 }
  },
  {
    id: 'elm-b', kind: 5, leaf: 'elm', bark: 'elm', barkColor: [94, 84, 72], height: 10, crownBase: 3.2, radius: 3.7, shape: 'vase', lumps: 0.18, clearance: 2.8,
    leader: false, fork: 2.9, dbh: 0.2, trunk: { lean: 0.03, wander: 0.04 },
    orders: [
      { n: 6, nVary: true, t: [0.7, 1], angle: [0.66, 0.22], roll: 'spiral', stop: 0.98, bend: bend(0, 0.04, 0.012, 0.06) },
      { spacing: 0.7, t: [0.3, 0.97], angle: [0.62, 0.45], share: 0.7, min: 0.8, lift: 0.25, need: 1.8, bend: bend(0, 0.03, 0.04, 0.1) }
    ],
    foliage: { spacing: 0.36, t: [0.3], core: 0.3, lift: 0, droop: 0.25, scale: 0.86, cup: 0.12, droopCard: 0.3, cluster: 6, massScale: 1 }
  },
  // ------------------------------------------------------------------------------------------------ Linden
  {
    id: 'linden-a', kind: 6, leaf: 'linden', bark: 'oak', barkColor: [98, 90, 80], height: 14, crownBase: 3.2, radius: 4.5, shape: 'cone', lumps: 0.12, clearance: 3,
    leader: true, dbh: 0.38, trunk: { lean: 0.015, wander: 0.025 },
    orders: [
      { spacing: 0.42, t: [0.2, 0.97], angle: [1.3, 0.48], roll: 'spiral', bend: bend(0.05, 0, 0.01, 0.06) },
      { spacing: 0.55, t: [0.22, 0.97], angle: [0.9, 0.65], share: 0.5, min: 0.6, lift: 0.1, need: 1.3, bend: bend(0.02, 0, 0.03, 0.1) }
    ],
    foliage: { spacing: 0.32, t: [0.2], core: 0.38, lift: 0, droop: 0.22, scale: 0.9, cup: 0.14, droopCard: 0.25, cluster: 7, massScale: 1 }
  },
  {
    id: 'linden-b', kind: 6, leaf: 'linden', bark: 'oak', barkColor: [98, 90, 80], height: 8.4, crownBase: 2.7, radius: 2.6, shape: 'cone', lumps: 0.12, clearance: 2.5,
    leader: true, dbh: 0.15, trunk: { lean: 0.015, wander: 0.025 },
    orders: [
      { spacing: 0.38, t: [0.3, 0.97], angle: [1.25, 0.48], roll: 'spiral', bend: bend(0.05, 0, 0.01, 0.06) },
      { spacing: 0.5, t: [0.22, 0.97], angle: [0.9, 0.65], share: 0.5, min: 0.5, lift: 0.1, need: 1.1, bend: bend(0.02, 0, 0.03, 0.1) }
    ],
    foliage: { spacing: 0.3, t: [0.2], core: 0.22, lift: 0, droop: 0.22, scale: 0.82, cup: 0.14, droopCard: 0.25, cluster: 6, massScale: 1 }
  },
  // ------------------------------------------------------------------------------------------------ Cherry & other small flowering trees
  {
    id: 'cherry-a', kind: 7, leaf: 'cherry', bark: 'elm', barkColor: [92, 62, 52], height: 7.2, crownBase: 2.1, radius: 3.8, shape: 'dome', lumps: 0.22, clearance: 2.1,
    leader: false, fork: 2.3, dbh: 0.26, trunk: { lean: 0.05, wander: 0.06 },
    orders: [
      { n: 6, nVary: true, t: [0.72, 1], angle: [1.15, 0.4], roll: 'spiral', stop: 1.04, bend: bend(0.03, 0.02, 0.01, 0.1) },
      { spacing: 0.62, t: [0.22, 0.97], angle: [0.8, 0.55], share: 0.75, min: 0.7, lift: 0.25, need: 1.3, bend: bend(0.02, 0.01, 0.03, 0.13) }
    ],
    foliage: { spacing: 0.36, t: [0.28], core: 0.25, lift: 0.05, droop: 0.15, scale: 0.84, cup: 0.12, droopCard: 0.22, cluster: 6, massScale: 1 }
  },
  {
    id: 'cherry-b', kind: 7, leaf: 'cherry', bark: 'elm', barkColor: [92, 62, 52], height: 4.8, crownBase: 1.9, radius: 2.2, shape: 'round', lumps: 0.22, clearance: 1.9,
    leader: false, fork: 2.0, dbh: 0.1, trunk: { lean: 0.05, wander: 0.06 },
    orders: [
      { n: 5, nVary: true, t: [0.78, 1], angle: [1.1, 0.4], roll: 'spiral', stop: 1.04, bend: bend(0.03, 0.02, 0.01, 0.1) },
      { spacing: 0.6, t: [0.25, 0.97], angle: [0.75, 0.55], share: 0.7, min: 0.5, lift: 0.25, need: 1.1, bend: bend(0.02, 0.01, 0.03, 0.13) }
    ],
    foliage: { spacing: 0.32, t: [0.25], core: 0.15, lift: 0.05, droop: 0.15, scale: 0.76, cup: 0.12, droopCard: 0.22, cluster: 5, massScale: 1 }
  }
];

export const KINDS = ['plane', 'locust', 'pear', 'ginkgo', 'oak', 'elm', 'linden', 'cherry'];
