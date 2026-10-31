// Sparse surface nets: a coarse pass finds where the surface runs, only those cells are meshed finely.

export function mesh(field, bounds, h, { coarse = 6, band = 1.7, project = 2, minTriangles = 24 } = {}) {
  const [x0, y0, z0, x1, y1, z1] = bounds;
  const H = h * coarse;
  const nx = Math.ceil((x1 - x0) / H), ny = Math.ceil((y1 - y0) / H), nz = Math.ceil((z1 - z0) / H);
  const reach = H * 0.87 * band;
  const key = (i, j, k) => i + j * 4096 + k * 16777216;
  const values = new Map();
  const value = (i, j, k) => {
    const id = key(i, j, k);
    let v = values.get(id);
    if (v === undefined) { v = field(x0 + i * h, y0 + j * h, z0 + k * h); values.set(id, v); }
    return v;
  };

  const cells = new Map(); // fine cell -> vertex index
  const positions = [];
  const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const d = new Float64Array(8);
  for (let K = 0; K < nz; K++) for (let J = 0; J < ny; J++) for (let I = 0; I < nx; I++) {
    if (Math.abs(field(x0 + (I + 0.5) * H, y0 + (J + 0.5) * H, z0 + (K + 0.5) * H)) > reach) continue;
    for (let k = K * coarse; k < (K + 1) * coarse; k++) for (let j = J * coarse; j < (J + 1) * coarse; j++) for (let i = I * coarse; i < (I + 1) * coarse; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        d[c] = value(i + CORNERS[c][0], j + CORNERS[c][1], k + CORNERS[c][2]);
        if (d[c] < 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, b] of EDGES) {
        if ((d[a] < 0) === (d[b] < 0)) continue;
        const t = d[a] / (d[a] - d[b]);
        sx += CORNERS[a][0] + (CORNERS[b][0] - CORNERS[a][0]) * t;
        sy += CORNERS[a][1] + (CORNERS[b][1] - CORNERS[a][1]) * t;
        sz += CORNERS[a][2] + (CORNERS[b][2] - CORNERS[a][2]) * t;
        n++;
      }
      cells.set(key(i, j, k), positions.length / 3);
      positions.push(x0 + (i + sx / n) * h, y0 + (j + sy / n) * h, z0 + (k + sz / n) * h);
    }
  }

  // A quad across every grid edge the surface crosses
  const faces = [];
  const addQuad = (a, b, c, e, flip) => {
    if (a === undefined || b === undefined || c === undefined || e === undefined) return;
    if (flip) faces.push(a, c, b, b, c, e); else faces.push(a, b, c, b, e, c);
  };
  for (const [id] of cells) {
    const k = Math.floor(id / 16777216), rest = id - k * 16777216, j = Math.floor(rest / 4096), i = rest - j * 4096;
    const v0 = value(i, j, k);
    const inside = v0 < 0;
    if (inside !== (value(i + 1, j, k) < 0)) addQuad(cells.get(key(i, j - 1, k - 1)), cells.get(key(i, j, k - 1)), cells.get(key(i, j - 1, k)), cells.get(key(i, j, k)), !inside);
    if (inside !== (value(i, j + 1, k) < 0)) addQuad(cells.get(key(i - 1, j, k - 1)), cells.get(key(i - 1, j, k)), cells.get(key(i, j, k - 1)), cells.get(key(i, j, k)), !inside);
    if (inside !== (value(i, j, k + 1) < 0)) addQuad(cells.get(key(i - 1, j - 1, k)), cells.get(key(i, j - 1, k)), cells.get(key(i - 1, j, k)), cells.get(key(i, j, k)), !inside);
  }
  return finish(field, positions, faces, h, project, minTriangles);
}

function finish(field, positions, faces, h, project, minTriangles) {
  // Keep the pieces that matter: stray flecks from where a surface barely grazes the grid go
  const count = positions.length / 3;
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < faces.length; t += 3) {
    const a = find(faces[t]), b = find(faces[t + 1]), c = find(faces[t + 2]);
    parent[b] = a; parent[find(c)] = a;
  }
  const size = new Map();
  for (let t = 0; t < faces.length; t += 3) { const r = find(faces[t]); size.set(r, (size.get(r) || 0) + 1); }
  const map = new Int32Array(count).fill(-1);
  const P = [], N = [], F = [];
  const e = h * 0.5;
  const gradient = (x, y, z) => {
    const gx = field(x + e, y, z) - field(x - e, y, z);
    const gy = field(x, y + e, z) - field(x, y - e, z);
    const gz = field(x, y, z + e) - field(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  };
  const vertex = (i) => {
    if (map[i] >= 0) return map[i];
    let x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    let n = gradient(x, y, z);
    for (let s = 0; s < project; s++) {
      const v = field(x, y, z);
      const step = Math.max(-h, Math.min(h, v));
      x -= n[0] * step; y -= n[1] * step; z -= n[2] * step;
      n = gradient(x, y, z);
    }
    map[i] = P.length / 3;
    P.push(x, y, z); N.push(n[0], n[1], n[2]);
    return map[i];
  };
  for (let t = 0; t < faces.length; t += 3) {
    if (size.get(find(faces[t])) < minTriangles) continue;
    F.push(vertex(faces[t]), vertex(faces[t + 1]), vertex(faces[t + 2]));
  }
  return { positions: P, normals: N, faces: F };
}
