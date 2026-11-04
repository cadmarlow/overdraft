import { S } from './salle-core.js';

// The map of Manhattan from the game's own streets, drawn like an old radar screen: him (violet), the player (lime),
// his tickets in their status colours, the stations of his programme, and what he has photographed (a cyan wash per
// 100 m cell, deeper where he went often; a white corner where he went at night).

const COLORS = { a_valider: '#fcd34d', plus: '#fcd34d', valide: '#7dd3fc', atelier: '#7dd3fc', corrige: '#c4b5fd', verifie: '#86efac', echec: '#fca5a5' };
const FONT = '11px "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';

function bounds() {
  if (S.bounds || !S.carte?.segments?.length) return S.bounds;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [a, b, c, d] of S.carte.segments) { minX = Math.min(minX, a, c); maxX = Math.max(maxX, a, c); minZ = Math.min(minZ, b, d); maxZ = Math.max(maxZ, b, d); }
  S.bounds = { minX, maxX, minZ, maxZ };
  return S.bounds;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} o - zoom ('pres' around him, 'ile' the whole island, 'couverture' where he has been), cover, programme
 */
function drawMap(canvas, { zoom = 'pres', cover = true, programme = true } = {}) {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const a = S.etat?.architecte, p = S.etat?.joueur;
  const b = bounds() || { minX: -2500, maxX: 2500, minZ: -7000, maxZ: 7000 };
  const cells = S.memoire?.couverture || [];
  let cx, cz, k;
  if (zoom === 'couverture' && cells.length) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const c of cells) { x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); z0 = Math.min(z0, c.z); z1 = Math.max(z1, c.z); }
    cx = (x0 + x1) / 2; cz = (z0 + z1) / 2;
    k = Math.max(1500 / Math.min(w, h), (x1 - x0 + 600) / w, (z1 - z0 + 600) / h);
  } else if (zoom !== 'pres' || !(a?.present || p)) {
    cx = (b.minX + b.maxX) / 2; cz = (b.minZ + b.maxZ) / 2;
    k = Math.max((b.maxX - b.minX) / w, (b.maxZ - b.minZ) / h) * 1.04;
  } else {
    const f = a?.present ? a : p;
    cx = f.x; cz = f.z; k = 1000 / Math.min(w, h);
  }
  const X = (x) => (x - cx) / k + w / 2, Z = (z) => (z - cz) / k + h / 2;
  if (cover && cells.length) {
    const size = 100 / k;
    for (const c of cells) {
      ctx.fillStyle = `rgba(217, 249, 157, ${Math.min(0.5, 0.1 + c.n * 0.05)})`;
      ctx.fillRect(X(c.x) - size / 2, Z(c.z) - size / 2, size, size);
      if (c.nuit) { const s = Math.max(2, size / 4); ctx.fillStyle = 'rgba(238, 240, 230, .7)'; ctx.fillRect(X(c.x) + size / 2 - s, Z(c.z) - size / 2, s, s); }
    }
  }
  if (S.carte) {
    ctx.strokeStyle = 'rgba(231, 235, 225, .12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [x0, z0, x1, z1] of S.carte.segments) { ctx.moveTo(X(x0), Z(z0)); ctx.lineTo(X(x1), Z(z1)); }
    ctx.stroke();
  }
  const prog = programme && S.programme?.active ? S.programme.etapes.filter((s) => Number.isFinite(s.x)) : [];
  if (prog.length) {
    ctx.strokeStyle = '#c4b5fd'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    prog.forEach((s, i) => (i ? ctx.lineTo(X(s.x), Z(s.z)) : ctx.moveTo(X(s.x), Z(s.z))));
    ctx.stroke(); ctx.setLineDash([]);
    for (const s of prog) { ctx.fillStyle = s.fait ? '#c4b5fd' : '#070a08'; ctx.strokeStyle = '#c4b5fd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(s.x), Z(s.z), 4, 0, 6.29); ctx.fill(); ctx.stroke(); }
  }
  for (const t of S.tickets.values()) {
    if (!t.lieu || t.statut === 'rejete') continue;
    ctx.fillStyle = COLORS[t.statut] || '#98a592';
    ctx.beginPath(); ctx.arc(X(t.lieu.x), Z(t.lieu.z), 4.5, 0, 6.29); ctx.fill();
  }
  if (p) { ctx.fillStyle = '#d9f99d'; ctx.beginPath(); ctx.arc(X(p.x), Z(p.z), 4.5, 0, 6.29); ctx.fill(); }
  if (a?.present && a.alive) {
    ctx.save();
    ctx.translate(X(a.x), Z(a.z));
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#c4b5fd'; ctx.strokeStyle = '#070a08'; ctx.lineWidth = 2;
    ctx.fillRect(-5.5, -5.5, 11, 11); ctx.strokeRect(-5.5, -5.5, 11, 11);
    ctx.restore();
  }
  ctx.fillStyle = '#67745f'; ctx.font = FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${(Math.min(w, h) * k / 1000).toFixed(1).replace('.', ',')} KM · NORD EN HAUT`, 8, h - 8);
  return { X, Z };
}

// The ticket under a click on the map, if any
function ticketAt(view, event, canvas) {
  if (!view) return null;
  const r = canvas.getBoundingClientRect(), mx = event.clientX - r.left, my = event.clientY - r.top;
  let best = null, bd = 14;
  for (const t of S.tickets.values()) {
    if (!t.lieu) continue;
    const d = Math.hypot(view.X(t.lieu.x) - mx, view.Z(t.lieu.z) - my);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

export { drawMap, ticketAt };
