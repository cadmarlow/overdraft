// The control room: what the Architect sees (a live picture), what he thinks and does (the journal), where he is (the
// map), the tickets he proposes (to validate, reject or send back), his brain's settings and spending, and the workshop.
// Everything comes from the server's event stream (/salle/flux); the Creator's decisions go back as small posts.

const params = new URLSearchParams(location.search);
const jeton = params.get('jeton') || '';
const withToken = (url) => (jeton ? `${url}${url.includes('?') ? '&' : '?'}jeton=${encodeURIComponent(jeton)}` : url);
const $ = (id) => document.getElementById(id);
const KINDS = { pensee: 'PENSÉE', action: 'ACTION', parole: 'IL DIT', photo: 'PHOTO', evenement: 'ÉVÉNEMENT', ticket: 'TICKET', createur: 'TOI', atelier: 'ATELIER', systeme: 'SYSTÈME' };
const STATUS = { a_valider: 'À valider', plus: 'Plus demandé', rejete: 'Rejeté', valide: 'Validé', atelier: 'À l’atelier', corrige: 'Corrigé, à vérifier', verifie: 'Vérifié', echec: 'Échec atelier' };
const CATEGORY = { bug: 'Bug', art: 'Art', performance: 'Perf', gameplay: 'Gameplay', son: 'Son' };
const GROUPS = { valider: ['a_valider', 'plus'], cours: ['valide', 'atelier', 'corrige', 'echec'], clos: ['verifie', 'rejete'] };
const STATUS_COLOR = { a_valider: '#ffc46b', plus: '#ffc46b', valide: '#7fd6e8', atelier: '#7fd6e8', corrige: '#b48cff', verifie: '#8fe39b', rejete: '#ff6b6b', echec: '#ff6b6b' };

const S = { settings: {}, modeles: {}, cerveau: {}, jeu: {}, etat: null, tickets: new Map(), atelier: {}, carte: null, filtre: 'valider', zoom: 'pres', lastLive: 0 };
const time = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const money = (v) => `${(v || 0).toFixed(2).replace('.', ',')} $`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function post(path, body) {
  try {
    const r = await fetch(withToken(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json();
  } catch { return { ok: false }; }
}
const command = (body) => post('/salle/commande', body);

// An order to the game, and its answer shown under the controls for a few seconds
async function gameCommand(commande, input = {}) {
  const r = await command({ action: 'jeu', commande, input });
  const n = $('notice');
  n.textContent = r?.texte || (r?.ok ? 'Fait.' : 'Le jeu n’a pas répondu.');
  n.hidden = false;
  clearTimeout(S.noticeT);
  S.noticeT = setTimeout(() => { n.hidden = true; }, 7000);
}

// ---- The stream ---------------------------------------------------------------------------------------------------
function connect() {
  const es = new EventSource(withToken('/salle/flux'));
  const on = (type, fn) => es.addEventListener(type, (e) => fn(JSON.parse(e.data)));
  on('snapshot', (s) => {
    Object.assign(S, { settings: s.settings, modeles: s.modeles, cerveau: s.cerveau, jeu: s.jeu, etat: s.etat, atelier: s.atelier, depenseDuJour: s.depenseDuJour });
    S.tickets = new Map(s.tickets.map((t) => [t.id, t]));
    setMap(s.lieux, s.carte);
    $('journal').replaceChildren();
    for (const e of s.journal) addEntry(e);
    if (s.live) showLive(s.live);
    renderAll();
  });
  on('journal', (e) => { if (e) addEntry(e); if (e?.kind === 'ticket' || e?.kind === 'atelier') renderTickets(); });
  on('statut', (c) => { S.cerveau = c; renderTop(); });
  on('reglages', (s) => { S.settings = s; renderSettings(); renderTop(); });
  on('etat', (etat) => { S.etat = etat; renderState(); drawMap(); });
  on('live', ({ n }) => showLive(n));
  on('ticket', (t) => { S.tickets.set(t.id, t); renderTickets(); drawMap(); if (S.open?.id === t.id) { S.open = t; renderModal(); } });
  on('atelier', (a) => { S.atelier = a; renderAtelier(); });
  on('atelierlog', ({ id, entry }) => {
    const t = S.tickets.get(id);
    if (!t) return;
    t.atelierLog = [...(t.atelierLog || []), entry];
    if (S.open?.id === id) renderWorkshop();
  });
  on('jeu', (j) => { S.jeu = { ...S.jeu, ...j }; if (!j.connected) S.etat = null; renderTop(); renderState(); });
  on('carte', ({ lieux, carte }) => { setMap(lieux, carte); drawMap(); });
  es.onerror = () => { S.jeu.connected = false; $('p-jeu').className = 'pill off'; $('p-jeu').querySelector('strong').textContent = 'serveur injoignable'; };
}

function renderAll() { renderTop(); renderSettings(); renderState(); renderTickets(); renderAtelier(); drawMap(); }

// ---- Top bar, settings, state ---------------------------------------------------------------------------------------
function pill(id, cls, text) { const p = $(id); p.className = `pill ${cls}`; p.querySelector('strong').textContent = text; }

function renderTop() {
  pill('p-jeu', S.jeu.connected ? 'on' : 'off', S.jeu.connected ? `connecté · ${S.jeu.version || ''}` : 'déconnecté');
  const c = S.cerveau;
  if (!c.cle) pill('p-cerveau', 'off', 'clé API absente');
  else if (!c.actif) pill('p-cerveau', 'warn', `${c.modele} · en pause${c.pause ? ` (${c.pause})` : ''}`);
  else pill('p-cerveau', c.occupe ? 'busy' : 'on', `${c.modele} · ${c.occupe ? 'pense…' : 'actif'} · ${c.pensees} pensées`);
  $('p-depense').querySelector('strong').textContent = `${money(c.depense)} / ${money(c.plafond)} cette séance`;
  $('b-pause').textContent = c.actif ? 'Mettre en pause' : 'Reprendre';
  $('b-pause').disabled = !c.cle;
}

function renderSettings() {
  const s = S.settings;
  for (const b of $('seg-cerveau').children) {
    b.classList.toggle('on', b.dataset.cerveau === s.cerveau);
    const m = S.modeles?.[b.dataset.cerveau];
    if (m) b.title = m.id;
  }
  if (document.activeElement !== $('plafond')) $('plafond').value = s.plafond ?? '';
  $('t-voix').checked = !!s.voix;
  $('t-vue').checked = !!s.vue;
  $('t-atelier').checked = !!s.atelier;
}

function renderState() {
  const e = S.etat, a = e?.architecte, p = e?.joueur, w = e?.monde;
  const present = !!a?.present;
  const mode = $('mode');
  mode.textContent = !S.jeu.connected ? 'JEU FERMÉ' : !present ? 'ABSENT' : a.spectating ? 'SEUL' : 'ENSEMBLE';
  mode.className = `mode${a?.spectating ? ' seul' : ''}`;
  $('intent').textContent = present ? (a.alive ? a.intent || '—' : `hors service${a.respawnIn ? ` · revient dans ${a.respawnIn} s` : ''}`) : '—';
  $('where').textContent = present && a.address ? a.address : '';
  $('s-corps').textContent = present ? `${a.mode}${a.fighting ? ' · en combat' : ''}` : 'absent';
  $('s-pv').textContent = present && a.alive ? `${a.hp} PV${a.armor ? ` + ${a.armor}` : ''}${a.grudge ? ` · rancune ${a.grudge}` : ''}` : '—';
  $('s-joueur').textContent = p ? `${p.state} · ${p.distance} m${p.wanted ? ` · ${'★'.repeat(p.wanted)}` : ''}` : '—';
  $('s-monde').textContent = w ? `${w.heure} · ${w.meteo} · ${w.fps} i/s` : '—';
  $('b-presence').textContent = present ? 'Renvoyer' : 'Faire venir';
  $('b-presence').disabled = !S.jeu.connected;
  // the game cannot run: say it loud, above the picture
  const tab = e?.onglet;
  const halt = !S.jeu.connected ? 'Le jeu est fermé ou déconnecté : ouvre http://localhost:5173.'
    : tab && !tab.visible ? 'L’onglet du jeu est caché : Chrome le met en pause, l’Architecte ne peut ni bouger ni penser. Mets la salle dans une autre fenêtre (ou sur ton iPhone) et garde le jeu visible.'
    : tab && !tab.lance ? 'Le jeu est sur l’écran titre : clique ENTRER DANS LA VILLE.'
    : tab && tab.pause ? 'Le jeu est sur le menu pause : tout est arrêté.' : '';
  $('halt').textContent = halt;
  $('halt').hidden = !halt;
  $('b-camera').textContent = a?.spectating ? 'Reprendre la main' : 'Laisse-le travailler';
  $('b-camera').disabled = !S.jeu.connected;
}

// ---- Live picture ---------------------------------------------------------------------------------------------------
function showLive(n) {
  const img = new Image();
  img.onload = () => {
    const live = $('live');
    live.src = img.src;
    live.hidden = false;
    live.style.opacity = 1;
    $('live-empty').hidden = true;
    S.lastLive = Date.now();
  };
  img.src = withToken(`/salle/live.jpg?n=${n}`);
}

setInterval(() => {
  // no new picture for a while: the game tab is probably hidden (the browser then pauses the game)
  const stale = S.jeu.connected && S.lastLive && Date.now() - S.lastLive > 6000;
  $('live').style.opacity = stale ? 0.45 : 1;
  if (stale) $('where').textContent = 'Image figée : l’onglet du jeu doit rester visible (fenêtre à part, ou salle sur un autre écran).';
  else if (S.jeu.connected && !S.lastLive && S.settings.vue) { $('live-empty').hidden = false; $('live-empty').textContent = 'En attente d’une image du jeu… (onglet du jeu visible, partie lancée)'; }
}, 2000);

// ---- Journal --------------------------------------------------------------------------------------------------------
// Newest first: the latest thought is always in view, on a phone too
function addEntry(e) {
  const list = $('journal');
  const li = document.createElement('li');
  li.className = e.kind;
  li.innerHTML = `<time>${time(e.t)}</time><span class="k">${KINDS[e.kind] || e.kind}</span><div class="t"></div>`;
  const t = li.querySelector('.t');
  t.textContent = e.text;
  if (e.kind === 'photo' && e.data?.id) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = withToken(`/photos/${e.data.id}.jpg`);
    img.alt = e.text;
    img.addEventListener('click', () => lightbox(img.src));
    t.append(img);
  }
  if (e.data?.id && (e.kind === 'ticket' || e.kind === 'atelier' || e.kind === 'createur') && /^\d{4}$/.test(e.data.id)) t.addEventListener('click', () => openTicket(e.data.id));
  if (e.kind === 'atelier' && e.data?.rapport) {
    const d = document.createElement('details');
    d.innerHTML = '<summary>Compte rendu</summary><p></p>';
    d.querySelector('p').textContent = e.data.rapport;
    t.append(d);
  }
  list.prepend(li);
  while (list.children.length > 500) list.lastChild.remove();
  // scrolled away from the newest lines: a button brings them back
  if (list.scrollTop > 40) $('fresh').hidden = false;
}

// ---- Tickets --------------------------------------------------------------------------------------------------------
function ticketPhoto(t, p) { return withToken(`/tickets/${encodeURIComponent(t.dir)}/${p}.jpg`); }

function renderTickets() {
  const all = [...S.tickets.values()].sort((a, b) => b.ouvert - a.ouvert);
  $('n-valider').textContent = all.filter((t) => GROUPS.valider.includes(t.statut)).length;
  for (const b of $('seg-tickets').children) b.classList.toggle('on', b.dataset.filtre === S.filtre);
  const list = all.filter((t) => GROUPS[S.filtre].includes(t.statut));
  const ul = $('tickets');
  if (!list.length) { ul.innerHTML = `<li class="empty">${S.filtre === 'valider' ? 'Aucun ticket à valider.' : 'Rien ici.'}</li>`; return; }
  ul.replaceChildren(...list.map((t) => {
    const li = document.createElement('li');
    li.innerHTML = `${t.photos[0] ? `<img src="${ticketPhoto(t, t.photos[0])}" alt="">` : '<img alt="">'}<div><b>#${t.id} · ${esc(t.titre)}</b><span class="tag ${t.statut}">${STATUS[t.statut]}</span><span class="tag ${t.gravite}">${esc(CATEGORY[t.categorie] || t.categorie)} · ${esc(t.gravite)}</span><br><small>${esc(t.lieu?.adresse || '')}</small></div>`;
    li.addEventListener('click', () => openTicket(t.id));
    return li;
  }));
}

function renderAtelier() {
  const a = S.atelier || {};
  const el = $('atelier').querySelector('strong');
  if (a.enCours) el.textContent = `travaille sur #${a.enCours.id} · ${a.enCours.derniere || a.enCours.titre} (${Math.max(1, Math.round((Date.now() - a.enCours.depuis) / 60000))} min)`;
  else el.textContent = a.auto ? (a.file?.length ? `${a.file.length} ticket(s) en attente` : 'au repos') : 'manuel (coché pour lancer)';
}

function openTicket(id) {
  const t = S.tickets.get(id);
  if (!t) return;
  S.open = t;
  S.photo = 0;
  $('m-texte').value = '';
  renderModal();
  $('modal').hidden = false;
}

function closeTicket() { $('modal').hidden = true; S.open = null; }

function renderModal() {
  const t = S.open;
  if (!t) return;
  const shots = [...t.photos.map((p) => ({ p, label: 'avant' })), ...(t.apres || []).map((p) => ({ p, label: 'après' }))];
  S.photo = Math.min(S.photo, Math.max(0, shots.length - 1));
  const shot = shots[S.photo];
  $('m-photo').src = shot ? ticketPhoto(t, shot.p) : '';
  $('m-prev').hidden = $('m-next').hidden = shots.length < 2;
  $('m-thumbs').replaceChildren(...shots.flatMap((s, i) => {
    const parts = [];
    if (i === t.photos.length && t.apres?.length) parts.push(Object.assign(document.createElement('span'), { textContent: 'APRÈS' }));
    const img = document.createElement('img');
    img.src = ticketPhoto(t, s.p);
    img.className = i === S.photo ? 'on' : '';
    img.addEventListener('click', () => { S.photo = i; renderModal(); });
    parts.push(img);
    return parts;
  }));
  $('m-tags').innerHTML = `<span class="tag">#${t.id}</span><span class="tag ${t.statut}">${STATUS[t.statut]}</span><span class="tag">${esc(CATEGORY[t.categorie] || t.categorie)}</span><span class="tag ${t.gravite}">${esc(t.gravite)}</span>`;
  $('m-titre').textContent = t.titre;
  $('m-constat').textContent = t.constat;
  $('m-piste').textContent = t.piste;
  const l = t.lieu || {};
  $('m-lieu').innerHTML = `${esc(l.adresse || '?')} · x ${Math.round(l.x ?? 0)}, z ${Math.round(l.z ?? 0)}${l.lien ? ` · <a href="${esc(l.lien)}" target="_blank" rel="noopener">Voir dans le jeu ↗</a>` : ''}<br><small>Version ${esc(t.version || '?')}</small>`;
  const who = { architecte: 'Architecte', createur: 'Toi', atelier: 'Atelier' };
  $('m-fil').replaceChildren(...t.fil.map((f) => {
    const li = document.createElement('li');
    li.innerHTML = `<b>${time(f.t)} · ${who[f.qui] || f.qui}</b> `;
    li.append(document.createTextNode(f.texte));
    return li;
  }));
  const pending = GROUPS.valider.includes(t.statut);
  for (const b of $('m-decide').querySelectorAll('[data-action]')) {
    if (b.dataset.action === 'atelier') b.hidden = !['echec', 'corrige', 'valide'].includes(t.statut);
    else b.hidden = !pending;
  }
  $('m-texte').hidden = !pending && !['echec', 'corrige', 'valide'].includes(t.statut);
  renderWorkshop();
}

// The workshop's session on this ticket: its steps as they happen, and the way back into its conversation
function renderWorkshop() {
  const t = S.open;
  const box = $('m-workshop');
  box.hidden = !t?.session;
  if (!t?.session) return;
  const running = S.atelier?.enCours?.id === t.id;
  $('m-ws-state').textContent = running ? `en cours depuis ${Math.max(1, Math.round((Date.now() - S.atelier.enCours.depuis) / 60000))} min` : t.statut === 'atelier' ? 'en attente' : 'terminé';
  const list = $('m-steps');
  const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 30;
  list.replaceChildren(...(t.atelierLog || []).map((s) => {
    const li = document.createElement('li');
    li.innerHTML = `<time>${time(s.t)}</time><span></span>`;
    li.querySelector('span').textContent = s.texte;
    return li;
  }));
  if (!t.atelierLog?.length) list.innerHTML = '<li><time></time><span>Pas encore d’étape.</span></li>';
  if (stick) list.scrollTop = list.scrollHeight;
  $('m-cmd').textContent = `claude --resume ${t.session}`;
  $('m-open').disabled = running;
  $('m-open').title = running ? 'Il travaille encore : la session s’ouvrira quand il aura fini.' : '';
}

async function decide(action) {
  const t = S.open;
  if (!t) return;
  const texte = $('m-texte').value.trim();
  if (action === 'plus' && !texte) { $('m-texte').focus(); $('m-texte').placeholder = 'Dis-lui ce qu’il doit préciser ou rephotographier.'; return; }
  await post('/salle/ticket', { id: t.id, action, texte });
  // on to the next one waiting, if any
  const next = [...S.tickets.values()].filter((x) => x.id !== t.id && GROUPS.valider.includes(x.statut)).sort((a, b) => a.ouvert - b.ouvert)[0];
  if (next && action !== 'atelier') openTicket(next.id); else closeTicket();
}

function lightbox(src) { const l = $('lightbox'); l.querySelector('img').src = src; l.hidden = false; }

// ---- Map --------------------------------------------------------------------------------------------------------------
function setMap(lieux, carte) {
  if (lieux) S.lieux = lieux;
  if (!carte?.segments?.length) return;
  S.carte = carte;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [a, b, c, d] of carte.segments) {
    minX = Math.min(minX, a, c); maxX = Math.max(maxX, a, c); minZ = Math.min(minZ, b, d); maxZ = Math.max(maxZ, b, d);
  }
  S.bounds = { minX, maxX, minZ, maxZ };
}

function drawMap() {
  const c = $('carte');
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const a = S.etat?.architecte, p = S.etat?.joueur;
  let cx, cz, span;
  if (S.zoom === 'ile' || !S.bounds || !(a?.present || p)) {
    const b = S.bounds || { minX: -2500, maxX: 2500, minZ: -7000, maxZ: 7000 };
    cx = (b.minX + b.maxX) / 2; cz = (b.minZ + b.maxZ) / 2;
    span = Math.max((b.maxX - b.minX) / w, (b.maxZ - b.minZ) / h) * 1.04;
  } else {
    const f = a?.present ? a : p;
    cx = f.x; cz = f.z; span = 900 / Math.min(w, h);
  }
  const X = (x) => (x - cx) / span + w / 2, Z = (z) => (z - cz) / span + h / 2;
  S.mapView = { X, Z };
  if (S.carte) {
    ctx.strokeStyle = '#ffffff26';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [x0, z0, x1, z1] of S.carte.segments) { ctx.moveTo(X(x0), Z(z0)); ctx.lineTo(X(x1), Z(z1)); }
    ctx.stroke();
  }
  for (const t of S.tickets.values()) {
    if (!t.lieu || t.statut === 'rejete') continue;
    ctx.fillStyle = STATUS_COLOR[t.statut] || '#fff';
    ctx.beginPath(); ctx.arc(X(t.lieu.x), Z(t.lieu.z), 4, 0, 6.29); ctx.fill();
  }
  if (p) {
    ctx.fillStyle = '#e1f3a0';
    ctx.beginPath(); ctx.arc(X(p.x), Z(p.z), 4.5, 0, 6.29); ctx.fill();
  }
  if (a?.present && a.alive) {
    ctx.save();
    ctx.translate(X(a.x), Z(a.z));
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#b48cff'; ctx.strokeStyle = '#0b110d'; ctx.lineWidth = 2;
    ctx.fillRect(-5.5, -5.5, 11, 11); ctx.strokeRect(-5.5, -5.5, 11, 11);
    ctx.restore();
  }
  ctx.fillStyle = '#9aa695'; ctx.font = '10px Arial';
  ctx.fillText(S.zoom === 'ile' ? 'Manhattan · nord en haut' : '900 m · nord en haut', 8, h - 8);
}

// ---- Wiring -----------------------------------------------------------------------------------------------------------
$('seg-cerveau').addEventListener('click', (e) => { const b = e.target.closest('[data-cerveau]'); if (b) command({ action: 'cerveau', cerveau: b.dataset.cerveau }); });
$('plafond').addEventListener('change', (e) => command({ action: 'plafond', plafond: Number(e.target.value) }));
$('b-pause').addEventListener('click', () => command({ action: 'pause', pause: S.cerveau.actif }));
$('b-presence').addEventListener('click', () => gameCommand('presence', { on: !S.etat?.architecte?.present }));
$('b-camera').addEventListener('click', () => gameCommand('camera'));
$('t-voix').addEventListener('change', (e) => command({ action: 'voix', voix: e.target.checked }));
$('t-vue').addEventListener('change', (e) => command({ action: 'vue', vue: e.target.checked }));
$('t-atelier').addEventListener('change', (e) => command({ action: 'atelier', auto: e.target.checked }));
$('f-pensees').addEventListener('change', (e) => $('journal').parentElement.classList.toggle('no-pensees', !e.target.checked));
$('say').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('say-text').value.trim();
  if (text) command({ action: 'message', texte: text });
  $('say-text').value = '';
  $('journal').scrollTop = 0;
});
$('fresh').addEventListener('click', () => { $('journal').scrollTo({ top: 0, behavior: 'smooth' }); $('fresh').hidden = true; });
$('journal').addEventListener('scroll', (e) => { if (e.target.scrollTop < 40) $('fresh').hidden = true; });
$('seg-tickets').addEventListener('click', (e) => { const b = e.target.closest('[data-filtre]'); if (b) { S.filtre = b.dataset.filtre; renderTickets(); } });
$('seg-carte').addEventListener('click', (e) => {
  const b = e.target.closest('[data-zoom]');
  if (!b) return;
  S.zoom = b.dataset.zoom;
  for (const x of $('seg-carte').children) x.classList.toggle('on', x === b);
  drawMap();
});
$('carte').addEventListener('click', (e) => {
  if (!S.mapView) return;
  const r = e.currentTarget.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  let best = null, bd = 14;
  for (const t of S.tickets.values()) {
    if (!t.lieu) continue;
    const d = Math.hypot(S.mapView.X(t.lieu.x) - mx, S.mapView.Z(t.lieu.z) - my);
    if (d < bd) { bd = d; best = t; }
  }
  if (best) openTicket(best.id);
});
$('m-decide').addEventListener('click', (e) => { const b = e.target.closest('[data-action]'); if (b) decide(b.dataset.action); });
$('m-close').addEventListener('click', closeTicket);
$('m-copy').addEventListener('click', () => {
  const text = `cd ~/Desktop/Games/GTA/gta-slop && ${$('m-cmd').textContent}`;
  navigator.clipboard?.writeText(text).then(() => { $('m-copy').textContent = 'Copié'; setTimeout(() => { $('m-copy').textContent = 'Copier'; }, 1500); }, () => window.prompt('Commande', text));
});
$('m-open').addEventListener('click', async () => {
  const r = await post('/salle/session', { id: S.open?.id });
  $('m-ws-state').textContent = r?.texte || '';
});
$('atelier').addEventListener('click', () => { const id = S.atelier?.enCours?.id; if (id) openTicket(id); });
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeTicket(); });
$('m-prev').addEventListener('click', () => { S.photo = Math.max(0, S.photo - 1); renderModal(); });
$('m-next').addEventListener('click', () => { S.photo += 1; renderModal(); });
$('m-photo').addEventListener('click', () => lightbox($('m-photo').src));
$('lightbox').addEventListener('click', () => { $('lightbox').hidden = true; });
document.addEventListener('keydown', (e) => {
  if ($('modal').hidden || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
  const pending = S.open && GROUPS.valider.includes(S.open.statut);
  if (e.key === 'Escape') closeTicket();
  else if (e.key === 'ArrowLeft') { S.photo = Math.max(0, S.photo - 1); renderModal(); }
  else if (e.key === 'ArrowRight') { S.photo += 1; renderModal(); }
  else if (pending && (e.key === 'v' || e.key === 'V')) decide('valider');
  else if (pending && (e.key === 'r' || e.key === 'R')) decide('rejeter');
  else if (pending && (e.key === 'd' || e.key === 'D')) decide('plus');
});
window.addEventListener('resize', drawMap);

connect();
