// Read-only workshop progress. Polling deliberately avoids /salle/flux, which enables live game captures.
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_URL = 'http://127.0.0.1:7780';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINISHED = { corrige: 'correction livrée', echec: 'échec', arrete: 'arrêtée', decision: 'décision du Créateur nécessaire' };
const USAGE = 'Usage : node tools/architecte/suivre-session.mjs UUID [--url http://127.0.0.1:7780]';
const clean = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

function normalizeSessionId(value) {
  if (!UUID.test(String(value || ''))) throw new Error('Identifiant de session invalide : un UUID complet est nécessaire.');
  return String(value).toLowerCase();
}

function validateLocalUrl(value = DEFAULT_URL) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Adresse invalide : indique http://localhost:7780 ou une autre adresse de boucle locale.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Adresse refusée : seuls localhost, 127.0.0.1 et [::1], sans identifiants ni chemin, sont autorisés.');
  }
  return url.origin;
}

function parseArgs(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  let sessionId = null, url = DEFAULT_URL, hasUrl = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--url') {
      if (hasUrl || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Option --url incomplète ou répétée.\n${USAGE}`);
      hasUrl = true; url = args[++i];
    } else if (arg.startsWith('-') || sessionId) throw new Error(`Argument inattendu : ${clean(arg)}.\n${USAGE}`);
    else sessionId = arg;
  }
  return { sessionId: normalizeSessionId(sessionId), url: validateLocalUrl(url) };
}

function sessionView(snapshot, sessionId) {
  const id = normalizeSessionId(sessionId);
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Le serveur a renvoyé un état de salle invalide.');
  const tickets = Array.isArray(snapshot.tickets) ? snapshot.tickets : [];
  const current = snapshot.atelier?.enCours?.session?.toLowerCase() === id ? snapshot.atelier.enCours : null;
  const history = (Array.isArray(snapshot.sessions) ? snapshot.sessions : []).find((record) => String(record.id).toLowerCase() === id);
  const ticket = tickets.find((item) => item.id === current?.id || item.id === history?.ticket
    || String(item.session).toLowerCase() === id || item.sessions?.some((record) => String(record.id).toLowerCase() === id));
  const archived = ticket?.sessions?.find((record) => String(record.id).toLowerCase() === id && (Number.isFinite(record.fin) || FINISHED[record.issue]));
  // A temporary absence from enCours does not establish completion. Only a completed history record does.
  const final = current ? null : history || archived || null;
  const start = current?.depuis ?? final?.debut;
  const end = final?.fin;
  const latest = String(ticket?.session).toLowerCase() === id || !!current;
  const logs = (Array.isArray(ticket?.atelierLog) ? ticket.atelierLog : []).filter((entry) => {
    if (entry.session && String(entry.session).toLowerCase() !== id) return false;
    if (!latest && !entry.session && !(Number.isFinite(start) && Number.isFinite(end))) return false;
    if (Number.isFinite(start) && (!Number.isFinite(entry.t) || entry.t < start)) return false;
    return !Number.isFinite(end) || (Number.isFinite(entry.t) && entry.t <= end);
  });
  return { id, ticket: ticket ? { id: ticket.id, titre: ticket.titre || current?.titre || '' } : current ? { id: current.id, titre: current.titre || '' } : null,
    active: !!current, final, phase: current?.phase || '', logs };
}

function updatesForSnapshot(previous = {}, snapshot, sessionId) {
  const view = sessionView(snapshot, sessionId);
  const next = { ...previous, seen: [...(previous.seen || [])] };
  const lines = [];
  if (view.ticket && !next.ticketShown) {
    lines.push(`Ticket #${clean(view.ticket.id)}${view.ticket.titre ? ` · ${clean(view.ticket.titre)}` : ''}`);
    next.ticketShown = true;
  }
  if (!view.active && !view.final && !next.waitingShown) {
    lines.push(`En attente de la session ${view.id}…`); next.waitingShown = true;
  }
  const seen = new Set(next.seen), occurrences = new Map(), fresh = [];
  for (const entry of view.logs) {
    const signature = JSON.stringify([entry.t, entry.phase, entry.texte]);
    const occurrence = (occurrences.get(signature) || 0) + 1;
    occurrences.set(signature, occurrence);
    const key = `${signature}:${occurrence}`;
    if (seen.has(key)) continue;
    seen.add(key); fresh.push(entry);
    const time = Number.isFinite(entry.t) ? new Date(entry.t).toLocaleTimeString('fr-FR', { hour12: false }) : '';
    const text = clean(entry.texte || entry.phase);
    if (text) lines.push(`${time ? `[${time}] ` : ''}${text}`);
  }
  next.seen = [...seen];
  if (view.active && view.phase && view.phase !== next.phase && !fresh.some((entry) => entry.phase === view.phase)) lines.push(`Étape : ${clean(view.phase)}`);
  next.phase = view.phase || next.phase;
  if (view.final && !next.finished) {
    const result = FINISHED[view.final.issue] || clean(view.final.issue) || 'issue non précisée';
    lines.push(`Session terminée : ${result}${view.final.raison ? ` · ${clean(view.final.raison)}` : ''}.`);
    lines.push(`Pour reprendre cette conversation :\nclaude --resume ${view.id}`);
    next.finished = true;
  }
  return { tracker: next, lines, done: !!next.finished, view };
}

function waitFor(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Suivi arrêté.', 'AbortError')); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException('Suivi arrêté.', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function followSession({ sessionId, url = DEFAULT_URL, pollMs = 1000, maxFailures = 12 }, { fetchImpl = globalThis.fetch, wait = waitFor, write = console.log, signal } = {}) {
  const id = normalizeSessionId(sessionId), origin = validateLocalUrl(url);
  const endpoint = `${origin}/salle/etat`;
  let tracker = {}, failures = 0;
  while (!signal?.aborted) {
    try {
      const timeout = AbortSignal.timeout(4000);
      const response = await fetchImpl(endpoint, { method: 'GET', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!response.ok) {
        const error = new Error(`Le serveur répond HTTP ${response.status}.`);
        error.fatal = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
        throw error;
      }
      const update = updatesForSnapshot(tracker, await response.json(), id);
      if (signal?.aborted) break;
      if (failures) write('Connexion au serveur rétablie.');
      failures = 0; tracker = update.tracker;
      for (const line of update.lines) write(line);
      if (update.done) return { stopped: false, final: update.view.final, tracker };
      await wait(pollMs, signal);
    } catch (error) {
      if (signal?.aborted) break;
      if (error.fatal) throw error;
      failures++;
      if (failures >= maxFailures) throw new Error(`Serveur indisponible après ${failures} tentatives. Vérifie qu’il tourne à ${origin}, puis relance le suivi. (${clean(error.message)})`);
      const retry = Math.min(5000, pollMs * 2 ** (failures - 1));
      if (failures === 1 || failures === 6) write(`Serveur indisponible ; nouvelle tentative dans ${retry / 1000} s. Ctrl-C quitte seulement le suivi.`);
      try { await wait(retry, signal); } catch (interrupted) { if (!signal?.aborted) throw interrupted; }
    }
  }
  write('Suivi arrêté. L’atelier n’a reçu aucun ordre et poursuit son travail.');
  return { stopped: true, tracker };
}

async function main(args = process.argv.slice(2)) {
  let options;
  try { options = parseArgs(args); } catch (error) { console.error(error.message); return 1; }
  if (options.help) { console.log(USAGE); return 0; }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    console.log(`Suivi de ${options.sessionId} · ${options.url}\nLecture seule ; Ctrl-C quitte le suivi sans arrêter l’atelier.`);
    await followSession(options, { signal: controller.signal });
    return 0;
  } catch (error) { console.error(`Suivi impossible : ${clean(error.message)}`); return 1; }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}

let invokedUrl = null;
try { if (process.argv[1]) invokedUrl = pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href; } catch { /* imported by another entry point */ }
if (invokedUrl === import.meta.url) process.exitCode = await main();

export { DEFAULT_URL, USAGE, followSession, main, normalizeSessionId, parseArgs, sessionView, updatesForSnapshot, validateLocalUrl, waitFor };
