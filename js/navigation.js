// Road-graph routing for the GPS line and AI drivers. Uses the traffic network's intersections (road-network.js) as an
// undirected graph: pursuers ignore one-way streets, the GPS route is advisory. A* with a binary heap, bounded work.

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(id, priority) {
    const a = this.items;
    a.push([priority, id]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
}

const CELL = 80;

class RoadNavigator {
  constructor(network) {
    this.nodes = network.nodes.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.z));
    const index = new Map(this.nodes.map((n, i) => [n, i]));
    this.links = this.nodes.map(() => []);
    for (const e of network.edges) {
      const a = index.get(e.from), b = index.get(e.to);
      if (a === undefined || b === undefined || a === b) continue;
      const cost = Math.hypot(this.nodes[a].x - this.nodes[b].x, this.nodes[a].z - this.nodes[b].z);
      if (!this.links[a].some((l) => l.to === b)) this.links[a].push({ to: b, cost });
      if (!this.links[b].some((l) => l.to === a)) this.links[b].push({ to: a, cost });
    }
    this.grid = new Map();
    this.nodes.forEach((n, i) => {
      if (!this.links[i].length) return;
      const k = this.key(Math.floor(n.x / CELL), Math.floor(n.z / CELL));
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(i);
    });
    this.gScore = new Float64Array(this.nodes.length);
    this.came = new Int32Array(this.nodes.length);
    this.stamp = new Uint32Array(this.nodes.length);
    this.serial = 0;
  }

  key(ix, iz) { return (ix + 2048) * 4096 + iz + 2048; }

  nearest(x, z, maxDistance = 240) {
    let best = -1, bestD = maxDistance * maxDistance;
    const r = Math.ceil(maxDistance / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let ring = 0; ring <= r; ring++) {
      for (let ix = cx - ring; ix <= cx + ring; ix++) {
        for (let iz = cz - ring; iz <= cz + ring; iz++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== ring) continue;
          const list = this.grid.get(this.key(ix, iz));
          if (!list) continue;
          for (const i of list) {
            const n = this.nodes[i];
            const d = (n.x - x) ** 2 + (n.z - z) ** 2;
            if (d < bestD) { bestD = d; best = i; }
          }
        }
      }
      if (best >= 0 && ring * CELL > Math.sqrt(bestD) + CELL) break;
    }
    return best;
  }

  // Node indices within `radius` of (x, z)
  within(x, z, radius, out = []) {
    out.length = 0;
    const r = Math.ceil(radius / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const i of list) {
          const n = this.nodes[i];
          if ((n.x - x) ** 2 + (n.z - z) ** 2 <= radius * radius) out.push(i);
        }
      }
    }
    return out;
  }

  // Route as world points from (ax, az) to (bx, bz), or null; maxExpand bounds the search
  route(ax, az, bx, bz, maxExpand = 9000) {
    const start = this.nearest(ax, az), goal = this.nearest(bx, bz);
    if (start < 0 || goal < 0) return null;
    // Same intersection at both ends: still go by it, the target may be round a corner
    if (start === goal) return [{ x: this.nodes[start].x, z: this.nodes[start].z, node: start }, { x: bx, z: bz }];
    const serial = ++this.serial;
    const { gScore, came, stamp, nodes } = this;
    const heap = new MinHeap();
    const g = nodes[goal];
    stamp[start] = serial; gScore[start] = 0; came[start] = -1;
    heap.push(start, Math.hypot(nodes[start].x - g.x, nodes[start].z - g.z));
    let expanded = 0, found = false;
    while (heap.size && expanded++ < maxExpand) {
      const i = heap.pop();
      if (i === goal) { found = true; break; }
      const base = gScore[i];
      for (const l of this.links[i]) {
        const cost = base + l.cost;
        if (stamp[l.to] === serial && gScore[l.to] <= cost) continue;
        stamp[l.to] = serial;
        gScore[l.to] = cost;
        came[l.to] = i;
        const n = nodes[l.to];
        heap.push(l.to, cost + Math.hypot(n.x - g.x, n.z - g.z));
      }
    }
    if (!found) return null;
    const path = [];
    for (let i = goal; i >= 0; i = came[i]) path.push({ x: nodes[i].x, z: nodes[i].z, node: i });
    path.reverse();
    path.push({ x: bx, z: bz });
    return path;
  }

  // Length of a route's polyline
  static length(path) {
    let d = 0;
    for (let i = 1; i < path.length; i++) d += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    return d;
  }
}

export { RoadNavigator };
