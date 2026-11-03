// The massing of a building above its footprint: the setbacks the 1916 zoning resolution forced on tall buildings
// (a street wall, then tiers stepping back as they rise, the wedding cakes of Midtown) where the survey has no tiers
// of its own, the crown of an Art Deco tower, and the parapet capping a roof.

// Signed area of a ring of {x, z}
function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j].x * ring[i].z - ring[i].x * ring[j].z;
  return a / 2;
}

// The ring moved d metres inward on every side (mitred corners), or null when it would fold or collapse
function insetRing(ring, d) {
  const n = ring.length;
  if (n < 3) return null;
  const area = signedArea(ring), side = Math.sign(area);
  if (!side) return null;
  // Inward normal of each edge, and the edge's line moved along it
  const lines = ring.map((a, i) => {
    const b = ring[(i + 1) % n];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len * side, nz = dx / len * side;
    return { x: a.x + nx * d, z: a.z + nz * d, dx: dx / len, dz: dz / len, len };
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = lines[(i + n - 1) % n], q = lines[i];
    const cross = p.dx * q.dz - p.dz * q.dx;
    // Nearly straight on: the moved point itself
    if (Math.abs(cross) < 1e-3) { out.push({ x: q.x, z: q.z }); continue; }
    const t = ((q.x - p.x) * q.dz - (q.z - p.z) * q.dx) / cross;
    const x = p.x + p.dx * t, z = p.z + p.dz * t;
    // A spike from a sharp corner folds the ring
    if (Math.hypot(x - q.x, z - q.z) > d * 4) return null;
    out.push({ x, z });
  }
  // Every edge keeps its direction and the ring its turn
  for (let i = 0; i < n; i++) {
    const a = out[i], b = out[(i + 1) % n], l = lines[i];
    if ((b.x - a.x) * l.dx + (b.z - a.z) * l.dz <= 0.5) return null;
  }
  const inner = signedArea(out);
  if (Math.sign(inner) !== side || Math.abs(inner) < Math.abs(area) * 0.12) return null;
  return out;
}

// Narrowest width of a ring, about: twice its area over its perimeter for a long rectangle
function narrowness(ring) {
  let perimeter = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    perimeter += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return (4 * Math.abs(signedArea(ring))) / perimeter;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Setbacks for a tall masonry building put up under the 1916 resolution, and the crown of a Deco tower: the footprint
// rises as a street wall to the podium height, then each tier stands back from the one below. Null when the building
// is not one, its footprint is not a plain outline, or the tiers would come out too thin.
function zoningSetbacks(b, style, year) {
  if (style.glass || !['deco', 'prewar', 'commercial'].includes(style.type)) return null;
  if (b.height < 55 || b.polygons.length !== 1 || b.polygons[0].holes.length || b.polygons[0].outer.length > 14) return null;
  if (!(year >= 1916 && year < 1962) && !(style.type === 'deco' && !year)) return null;
  const ring = b.polygons[0].outer;
  const rand = mulberry32(Math.round(b.cx * 13 + b.cz * 7) ^ 0x2545f491);
  const H = b.height;
  const podium = Math.max(22, Math.min(H * 0.45, 30 + rand() * 18));
  const steps = H > 150 ? 4 : H > 95 ? 3 : 2;
  const tiers = [];
  let base = podium, inset = 0;
  for (let k = 0; k < steps; k++) {
    inset += 2.4 + rand() * 1.8;
    const r = insetRing(ring, inset);
    if (!r || narrowness(r) < 12) break;
    const top = k === steps - 1 ? H : base + (H - base) * (0.38 + rand() * 0.12);
    tiers.push({ ring: r, base, top });
    base = top;
  }
  if (!tiers.length) return null;
  tiers[tiers.length - 1].top = H;
  // A Deco tower ends in a crown: two short stepped stages above its roof
  if (style.type === 'deco' && H > 90) {
    let top = H;
    for (const [extra, rise] of [[3, 5 + rand() * 3], [3.5, 4 + rand() * 3]]) {
      inset += extra;
      const r = insetRing(ring, inset);
      if (!r || narrowness(r) < 7) break;
      tiers.push({ ring: r, base: top, top: top + rise });
      top += rise;
    }
  }
  return { podium, tiers };
}

// Height of the parapet capping a roof: none under a cornice, a low brick one on masonry, a metal one on glass
function parapetHeight(style) {
  if (style.cornice !== 'none') return 0;
  if (style.glass) return 1.2;
  return style.type === 'rowhouse' ? 0.6 : 0.95;
}

export { insetRing, signedArea, narrowness, zoningSetbacks, parapetHeight };
