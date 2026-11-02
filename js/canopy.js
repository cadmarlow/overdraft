import * as THREE from 'three/webgpu';

// The paraglider (its flight lives in air-physics.js): a ram-air wing of 11 cells on an arc over the pilot, each cell an
// airfoil with an open mouth on the leading edge, the upper skin puffed out between the ribs. Lines run from the wing's
// underside to the risers on the pilot's shoulders, and the brake lines from the trailing edge to the pilot's hands:
// pulling a brake drags that side's trailing edge down. It bursts open from a bundle, and folds away on landing.
//
// Local frame of the group: origin at the risers (between the pilot's shoulders), x to the pilot's left (three.js's
// frame once turned to a heading), y up, z forward.

const CELLS = 11;
const SUB = 3; // spanwise segments per cell, so the skin can puff out between ribs
const CHORD_N = 12;
const ARC = 1.0; // half the arc the wing spans, in radians
const LINES = 7.4; // m from the risers up to the wing
const CHORD = 2.9;
const THICK = 0.17;

// Airfoil half thickness at x in [0, 1] from the leading edge (a NACA-like curve)
const foil = (x) => 5 * THICK * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
const camber = (x) => 0.06 * Math.sin(Math.PI * Math.min(1, x * 1.1));

const COLORS = { lime: new THREE.Color(0xd7ee7e), graphite: new THREE.Color(0x24292e), white: new THREE.Color(0xeef0f2), orange: new THREE.Color(0xff8a2a) };
const CELL_COLORS = ['lime', 'graphite', 'white', 'graphite', 'lime', 'orange', 'lime', 'graphite', 'white', 'graphite', 'lime'];

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4();

function createCanopy(scene) {
  const stations = CELLS * SUB + 1;
  // each cell has its own columns of vertices (the ribs are doubled), so its colour stops sharp at the seam
  const cols = CELLS * (SUB + 1);
  const station = (c) => Math.floor(c / (SUB + 1)) * SUB + (c % (SUB + 1));
  const n = cols * (CHORD_N + 1);
  // upper skin, lower skin (whose first chord rows are left open: the cells' mouths)
  const positions = new Float32Array(n * 2 * 3), colors = new Float32Array(n * 2 * 3);
  const index = [];
  const at = (skin, i, j) => skin * n + i * (CHORD_N + 1) + j;
  for (let i = 0; i < cols - 1; i++) {
    if (i % (SUB + 1) === SUB) continue; // the seam between two cells
    for (let j = 0; j < CHORD_N; j++) {
      const a = at(0, i, j), b = at(0, i + 1, j), c = at(0, i, j + 1), d = at(0, i + 1, j + 1);
      index.push(a, c, b, b, c, d);
      if (j >= 1) { // the lower skin starts behind the mouth
        const e = at(1, i, j), f = at(1, i + 1, j), g = at(1, i, j + 1), h = at(1, i + 1, j + 1);
        index.push(e, f, g, f, h, g);
      }
    }
  }
  // the two wingtips, closed: the outermost rib's profile
  for (const i of [0, cols - 1]) {
    for (let j = 0; j < CHORD_N; j++) {
      const a = at(0, i, j), b = at(0, i, j + 1), c = at(1, i, j), d = at(1, i, j + 1);
      index.push(a, c, b, b, c, d);
    }
  }
  for (let i = 0; i < cols; i++) {
    const cell = Math.floor(i / (SUB + 1)), k = i % (SUB + 1);
    const base = COLORS[CELL_COLORS[cell]];
    for (let j = 0; j <= CHORD_N; j++) {
      // a darker line along each rib seam, the underside in its own shade
      const seam = k === 0 || k === SUB ? 0.84 : 1;
      colors.set([base.r * seam, base.g * seam, base.b * seam], at(0, i, j) * 3);
      colors.set([base.r * 0.62, base.g * 0.62, base.b * 0.62], at(1, i, j) * 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(index);
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
  const wing = new THREE.Mesh(geometry, material);
  wing.castShadow = true;
  wing.frustumCulled = false;

  // lines: A, B, C rows on every rib to the riser on its side; brake lines from the trailing edge to the hand
  const rows = [0.08, 0.32, 0.58];
  const ribs = Array.from({ length: CELLS + 1 }, (_, k) => (k < CELLS ? k * (SUB + 1) : cols - 1));
  const lineCount = ribs.length * rows.length + ribs.length;
  const linePos = new Float32Array(lineCount * 2 * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicNodeMaterial({ color: 0x3a3f45, transparent: true, opacity: 0.85 }));
  lines.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'Paraglider';
  group.add(wing, lines);
  group.matrixAutoUpdate = false;
  scene.add(group);

  const hands = [new THREE.Vector3(), new THREE.Vector3()];
  /**
   * Shape and place the wing. state = { open: 0..1 inflation, fold: 0..1 (landing), brakeL, brakeR, t };
   * placement: matrix of the risers' frame (position at the risers, heading and bank applied); handsWorld: [left, right].
   */
  group.shape = (state, matrix, handsWorld) => {
    const open = Math.min(1, state.open), fold = state.fold || 0;
    const inflate = 1 - (1 - open) ** 2;
    // landing, the wing loses its pressure and settles in a heap behind the pilot
    const settle = 1 - (1 - fold) ** 3; // the pressure goes at once, the fabric takes its time to lie down
    const span = (0.1 + 0.9 * inflate) * (1 - settle * 0.55), chordScale = (0.35 + 0.65 * inflate) * (1 - settle * 0.4);
    const radius = (1.6 + (LINES - 1.6) * Math.min(1, open * 1.4)) * (1 - settle * 0.6);
    const t = state.t || 0;
    let p = 0;
    for (let skin = 0; skin < 2; skin++) {
      for (let col = 0; col < cols; col++) {
        const i = station(col);
        const s = i / (stations - 1) * 2 - 1; // -1 left tip .. 1 right tip
        const theta = s * ARC * span;
        const tip = Math.abs(s);
        const chord = CHORD * chordScale * (1 - 0.42 * tip * tip);
        const sweep = 0.35 * tip * tip; // tips trail back
        const between = (i % SUB) / SUB; // 0 on a rib .. between ribs
        const puff = Math.sin(Math.PI * between) * 0.09 * inflate;
        const brake = s < 0 ? state.brakeL : state.brakeR;
        // radial (wing "up") and forward directions at this station
        const rx = Math.sin(theta), ry = Math.cos(theta);
        for (let j = 0; j <= CHORD_N; j++) {
          const x = j / CHORD_N;
          const zc = chord * (0.32 - x) - sweep;
          const half = foil(x) * chord + camber(x) * chord * 0.3;
          // the brake pulls the back third of that side down, the outer cells most
          const pull = brake * Math.max(0, (x - 0.62) / 0.38) ** 1.5 * (0.35 + 0.65 * tip) * 0.75;
          // a crumple while it inflates, and the slow ripple of a wing in moving air
          const crumple = (1 - inflate) * 0.7 * Math.sin(i * 1.7 + j * 2.3 + t * 23) + 0.025 * Math.sin(t * 3.1 + i * 0.6 + j * 0.4);
          const off = (skin === 0 ? half + puff : -half * 0.55 + puff * 0.3) - pull + crumple;
          const r = radius + off;
          // a settling wing overflies the stopped pilot and comes down in front of them, never below the ground (1.5 m
          // under the risers)
          const over = settle * (ry * r + 1.2), crumple2 = settle * 0.35 * Math.sin(i * 2.1 + j * 1.3);
          positions[p++] = -rx * r * (1 - settle * 0.3);
          positions[p++] = Math.max(-1.42 + crumple2 * 0.5, ry * r - over * 1.15 + crumple2);
          positions[p++] = zc + over * 0.75;
        }
      }
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    // lines down to the risers (±0.22 m) and the brake lines to the hands
    group.matrix.copy(matrix);
    group.matrixWorld.copy(matrix);
    _m.copy(matrix).invert();
    for (let k = 0; k < 2; k++) hands[k].copy(handsWorld[k]).applyMatrix4(_m);
    let q = 0;
    const vertex = (skin, i, j) => { const o = at(skin, i, j) * 3; return _v.set(positions[o], positions[o + 1], positions[o + 2]); };
    for (const i of ribs) {
      const left = station(i) < (stations - 1) / 2;
      for (const x of rows) {
        const a = vertex(1, i, Math.round(x * CHORD_N));
        linePos[q++] = a.x; linePos[q++] = a.y; linePos[q++] = a.z;
        linePos[q++] = left ? 0.22 : -0.22; linePos[q++] = 0; linePos[q++] = 0;
      }
      const e = vertex(1, i, CHORD_N), h = hands[left ? 0 : 1];
      linePos[q++] = e.x; linePos[q++] = e.y; linePos[q++] = e.z;
      linePos[q++] = h.x; linePos[q++] = h.y; linePos[q++] = h.z;
    }
    lineGeo.attributes.position.needsUpdate = true;
    lines.visible = fold < 0.15;
    wing.updateMatrixWorld();
    lines.updateMatrixWorld();
  };
  group.lineLength = LINES;
  return group;
}

// The risers' frame: at the pilot's shoulders, turned to the heading, banked into the turn, pitched by the brakes
function canopyMatrix(out, x, y, z, heading, bank, pitch) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, heading, bank, 'YXZ'));
  return out.compose(_w.set(x, y, z), q, new THREE.Vector3(1, 1, 1));
}

export { createCanopy, canopyMatrix };
