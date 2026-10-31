// Quadric edge collapse: fewer triangles, same shape. Flat areas go first; noses, knuckles and fold ridges stay.

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    let i = a.length;
    a.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= item.cost) break;
      a[i] = a[p]; i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.a;
    const top = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      const n = a.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && a[c + 1].cost < a[c].cost) c++;
        if (a[c].cost >= last.cost) break;
        a[i] = a[c]; i = c;
      }
      a[i] = last;
    }
    return top;
  }
}

function decimate({ positions, faces }, target) {
  const n = positions.length / 3;
  const P = Float64Array.from(positions);
  const F = Int32Array.from(faces);
  const faceCount = F.length / 3;
  if (faceCount <= target) return { positions, faces };
  const Q = new Float64Array(n * 10);
  const alive = new Uint8Array(faceCount).fill(1);
  const vertexFaces = Array.from({ length: n }, () => []);
  const stamp = new Int32Array(n);
  const addPlane = (v, a, b, c, d, w) => {
    const o = v * 10;
    Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d;
    Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d;
    Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d;
  };
  for (let f = 0; f < faceCount; f++) {
    const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    const area = l * 0.5;
    if (l > 0) { nx /= l; ny /= l; nz /= l; }
    const d = -(nx * P[a * 3] + ny * P[a * 3 + 1] + nz * P[a * 3 + 2]);
    for (const v of [a, b, c]) { addPlane(v, nx, ny, nz, d, area); vertexFaces[v].push(f); }
  }
  const cost = (x, y, z, q) => q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];
  const q = new Float64Array(10);
  const best = (a, b) => {
    for (let i = 0; i < 10; i++) q[i] = Q[a * 10 + i] + Q[b * 10 + i];
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
    const candidates = [[(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2], [ax, ay, az], [bx, by, bz]];
    let out = candidates[0], low = Infinity;
    for (const c of candidates) { const v = cost(c[0], c[1], c[2], q); if (v < low) { low = v; out = c; } }
    return { cost: low, x: out[0], y: out[1], z: out[2] };
  };
  const heap = new Heap();
  const push = (a, b) => {
    const r = best(a, b);
    heap.push({ cost: r.cost, a, b, sa: stamp[a], sb: stamp[b], x: r.x, y: r.y, z: r.z });
  };
  const seen = new Set();
  for (let f = 0; f < faceCount; f++) {
    for (let e = 0; e < 3; e++) {
      const a = F[f * 3 + e], b = F[f * 3 + (e + 1) % 3];
      const key = a < b ? a * n + b : b * n + a;
      if (seen.has(key)) continue;
      seen.add(key);
      push(a, b);
    }
  }
  seen.clear();
  const flips = (v, other, x, y, z) => {
    for (const f of vertexFaces[v]) {
      if (!alive[f]) continue;
      const i0 = F[f * 3], i1 = F[f * 3 + 1], i2 = F[f * 3 + 2];
      if (i0 === other || i1 === other || i2 === other) continue;
      const pts = [i0, i1, i2].map((i) => (i === v ? [x, y, z] : [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]));
      const old = [i0, i1, i2].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
      const normal = (t) => {
        const ux = t[1][0] - t[0][0], uy = t[1][1] - t[0][1], uz = t[1][2] - t[0][2];
        const vx = t[2][0] - t[0][0], vy = t[2][1] - t[0][1], vz = t[2][2] - t[0][2];
        return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      };
      const a = normal(pts), b = normal(old);
      const la = Math.hypot(...a), lb = Math.hypot(...b);
      if (la < 1e-14) return true;
      if ((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb + 1e-20) < 0.25) return true;
    }
    return false;
  };
  let live = faceCount;
  while (live > target && heap.size) {
    const e = heap.pop();
    const { a, b } = e;
    if (stamp[a] !== e.sa || stamp[b] !== e.sb || stamp[a] < 0 || stamp[b] < 0) continue;
    if (flips(a, b, e.x, e.y, e.z) || flips(b, a, e.x, e.y, e.z)) continue;
    P[a * 3] = e.x; P[a * 3 + 1] = e.y; P[a * 3 + 2] = e.z;
    for (let i = 0; i < 10; i++) Q[a * 10 + i] += Q[b * 10 + i];
    for (const f of vertexFaces[b]) {
      if (!alive[f]) continue;
      const has = F[f * 3] === a || F[f * 3 + 1] === a || F[f * 3 + 2] === a;
      if (has) { alive[f] = 0; live--; continue; }
      for (let i = 0; i < 3; i++) if (F[f * 3 + i] === b) F[f * 3 + i] = a;
      vertexFaces[a].push(f);
    }
    stamp[b] = -1;
    stamp[a]++;
    vertexFaces[a] = vertexFaces[a].filter((f) => alive[f]);
    const around = new Set();
    for (const f of vertexFaces[a]) for (let i = 0; i < 3; i++) if (F[f * 3 + i] !== a) around.add(F[f * 3 + i]);
    for (const v of around) { stamp[v]++; }
    for (const v of around) push(a, v);
    // neighbours' other edges keep their old cost estimate until popped: rebuild them lazily
    for (const v of around) for (const f of vertexFaces[v]) {
      if (!alive[f]) continue;
      for (let i = 0; i < 3; i++) { const w = F[f * 3 + i]; if (w !== v && w !== a && w > v) push(v, w); }
    }
  }
  // Compact
  const map = new Int32Array(n).fill(-1);
  const outP = [], outF = [];
  for (let f = 0; f < faceCount; f++) {
    if (!alive[f]) continue;
    for (let i = 0; i < 3; i++) {
      const v = F[f * 3 + i];
      if (map[v] < 0) { map[v] = outP.length / 3; outP.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); }
      outF.push(map[v]);
    }
  }
  return { positions: outP, faces: outF };
}

// Vertices back on the true surface, with the surface's own normals, so shading keeps the detail the triangles lost
function settle(field, m, h) {
  const e = h * 0.5;
  const normals = [];
  const P = m.positions;
  for (let i = 0; i < P.length; i += 3) {
    let x = P[i], y = P[i + 1], z = P[i + 2];
    let nx = 0, ny = 1, nz = 0;
    for (let s = 0; s < 2; s++) {
      nx = field(x + e, y, z) - field(x - e, y, z);
      ny = field(x, y + e, z) - field(x, y - e, z);
      nz = field(x, y, z + e) - field(x, y, z - e);
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      if (s === 0) {
        const v = Math.max(-h, Math.min(h, field(x, y, z)));
        x -= nx * v; y -= ny * v; z -= nz * v;
      }
    }
    P[i] = x; P[i + 1] = y; P[i + 2] = z;
    normals.push(nx, ny, nz);
  }
  return { positions: P, normals, faces: m.faces };
}

export { decimate, settle };
