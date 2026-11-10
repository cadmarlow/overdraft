// Weld position seams only for connectivity analysis. An accessory may have split normal/UV vertices, but a
// door, pillar or body panel touching it must exclude the complete component from accessory removal.
function interiorComponents(position, index, spec, layout) {
  const parent = Int32Array.from({ length: position.count }, (_, i) => i), seen = new Set(), seams = new Map();
  const find = i => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  for (let at = 0; at < index.count; at++) {
    const i = index.getX(at);
    if (seen.has(i)) continue;
    seen.add(i);
    const key = [position.getX(i), position.getY(i), position.getZ(i)].map(v => Math.round(v * 10000)).join(',');
    if (seams.has(key)) parent[i] = seams.get(key); else seams.set(key, i);
  }
  for (let at = 0; at < index.count; at += 3) {
    const root = find(index.getX(at));
    parent[find(index.getX(at + 1))] = root;
    parent[find(index.getX(at + 2))] = root;
  }
  const bounds = new Map();
  for (const i of seen) {
    const root = find(i), x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (!bounds.has(root)) bounds.set(root, [x, y, z, x, y, z]);
    const b = bounds.get(root);
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.min(b[2], z);
    b[3] = Math.max(b[3], x); b[4] = Math.max(b[4], y); b[5] = Math.max(b[5], z);
  }
  const side = Math.min(spec.halfW - 0.12, layout.width / 0.92 - 0.03);
  const floor = Math.max(spec.sill ?? 0, layout.seat[1] - 0.26), roots = new Set();
  for (const [root, b] of bounds) {
    if (b[0] > -side && b[3] < side && b[1] > floor && b[4] < layout.roof - 0.04
      && b[2] > layout.seat[2] - 0.6 && b[5] < layout.dash[1] - 0.03) roots.add(root);
  }
  return i => roots.has(find(i));
}

// Some exterior-only models close the cabin with a broad sheet at window-sill height; others include crude static
// seats/wheels inside it. Remove proven caps, enclosed accessories and internal dashboard faces, never shared vertices.
function openCabinGeometry(body, spec, layout) {
  const position = body?.attributes?.position, index = body?.index;
  if (!position || !index || !layout || !spec || spec.sourceInterior || layout.sourceInterior) return body;
  const [seatX, hip, seatZ] = layout.seat ?? [], [dashY, front] = layout.dash ?? [];
  const width = layout.width, roof = layout.roof, back = layout.back;
  if (![seatX, hip, seatZ, dashY, front, width, roof, back, spec.halfW].every(Number.isFinite) || width <= 0) return body;

  const lower = hip + 0.22, upper = Math.min(roof - 0.09, dashY + 0.12);
  const side = Math.min(spec.halfW * 0.98, width / 0.92 + 0.015);
  // A cab-over's pane can end ahead of the seat. Rear lamps may also be classed as glass, so a candidate
  // must reach the front-seat area below; a boot lid wholly behind the driver is never a cabin cap.
  const rear = Math.min(back - 0.06, seatZ - 0.25);
  // Classify connectivity before removing caps: cutting a body panel must not manufacture a removable component.
  const accessory = interiorComponents(position, index, spec, layout);
  const kept = [], horizontal = [], removed = new Uint8Array(index.count / 3);
  for (let at = 0; at < index.count; at += 3) {
    const a = index.getX(at), b = index.getX(at + 1), c = index.getX(at + 2);
    if (accessory(a)) { removed[at / 3] = 1; continue; }
    const ax = position.getX(a), ay = position.getY(a), az = position.getZ(a);
    const bx = position.getX(b), by = position.getY(b), bz = position.getZ(b);
    const cx = position.getX(c), cy = position.getY(c), cz = position.getZ(c);
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx);
    const minZ = Math.min(az, bz, cz), maxZ = Math.max(az, bz, cz);
    // All vertices must be inside the glazing footprint: a hood triangle crossing the windscreen boundary stays.
    // Narrow door ledges and the pillars also stay, even if their upper faces happen to be horizontal.
    const minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const twiceArea = Math.hypot(nx, ny, nz);
    const cap = minX >= -side && maxX <= side && Math.abs((ax + bx + cx) / 3) < width * 0.82
      && minZ >= rear && maxZ <= front + 0.025 && maxZ > seatZ + 0.1
      && minY > lower && maxY < upper && maxX - minX > Math.max(0.24, width * 0.35)
      && twiceArea > 0.002 && Math.abs(ny) > twiceArea * 0.92;
    if (cap) {
      const keys = [[ax, ay, az], [bx, by, bz], [cx, cy, cz]].map(p => p.map(v => Math.round(v * 10000)).join(','));
      horizontal.push({ triangle: at / 3, keys });
      if (twiceArea > 0.05 && maxZ - minZ > 0.3) removed[at / 3] = 1;
    }
    // Old dashboards can join the body at their sides. Remove faces only when every vertex is inside
    // the replacement dashboard compartment. Bevels and frames belong to it regardless of their normal;
    // the inset from the glazing, roof and floor keeps pillars, door skins and the firewall protected.
    // Tapered windscreens bring their lower pillars well inside the body's widest point. Keep the fascia cut
    // inside the central dashboard span: a fixed inset from halfW alone can slice those structural pillars.
    const fasciaSide = Math.min(spec.halfW - 0.12, width * 0.82);
    const lateralSkin = Math.abs(nx) > twiceArea * 0.65
      && Math.max(Math.abs(minX), Math.abs(maxX)) > spec.halfW * 0.62;
    const fascia = minX > -fasciaSide && maxX < fasciaSide && minY > hip + 0.15
      && maxY < Math.min(roof - 0.12, dashY + 0.20)
      && minZ > layout.wheel?.[2] - 0.25 && maxZ < front - 0.09 && !lateralSkin;
    if (fascia) removed[at / 3] = 1;
  }
  // Small taper triangles belong to a cap only when they share a complete edge with an already proven cap.
  // This clears thin slivers without lowering the large-surface threshold for isolated trim elsewhere.
  const edges = new Map(), queue = [], neighbors = new Map();
  for (const { triangle, keys } of horizontal) {
    if (removed[triangle]) queue.push(triangle);
    neighbors.set(triangle, []);
    for (let i = 0; i < 3; i++) {
      const edge = [keys[i], keys[(i + 1) % 3]].sort().join('|');
      if (!edges.has(edge)) edges.set(edge, []);
      edges.get(edge).push(triangle);
    }
  }
  for (const group of edges.values()) for (const a of group) for (const b of group) if (a !== b) neighbors.get(a).push(b);
  for (let i = 0; i < queue.length; i++) for (const next of neighbors.get(queue[i])) {
    if (!removed[next]) { removed[next] = 1; queue.push(next); }
  }
  for (let at = 0; at < index.count; at += 3) {
    if (!removed[at / 3]) kept.push(index.getX(at), index.getX(at + 1), index.getX(at + 2));
  }
  if (kept.length === index.count) return body;
  const opened = new body.constructor();
  for (const [name, attribute] of Object.entries(body.attributes)) opened.setAttribute(name, attribute);
  opened.setIndex(new index.constructor(new index.array.constructor(kept), 1));
  opened.name = body.name;
  opened.boundingBox = body.boundingBox?.clone() ?? null;
  opened.boundingSphere = body.boundingSphere?.clone() ?? null;
  return opened;
}

export { openCabinGeometry };
