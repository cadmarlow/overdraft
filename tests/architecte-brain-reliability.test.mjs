import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Chantier } from '../tools/architecte/chantier.mjs';
import { Memoire } from '../tools/architecte/memoire.mjs';
import { Programme } from '../tools/architecte/programme.mjs';

let module = null;
try { module = await import('../tools/architecte/brain.mjs'); } catch { /* The optional server SDK is not a game dependency. */ }
const sdk = { skip: !module && 'SDK Anthropic absent' };
const JPEG = 'data:image/jpeg;base64,/9j/2Q==';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecte-reliability-'));
  const chantier = new Chantier(root), memoire = new Memoire(chantier), events = [];
  chantier.settings.allume = true;
  const game = {
    connected: true, loadedAt: Date.now(), version: '0.9.4',
    state: { architecte: { present: true, alive: true, x: 10, y: 0.22, z: 20, spectating: true }, joueur: { x: 10, z: 20 } },
    command: async (name) => name === 'photographier' ? { ok: true, image: JPEG, lieu: { x: 10, y: 0.22, z: 20, heure: 13, meteo: 'clear' } } : { ok: true }
  };
  chantier.auditGame = game;
  let brain;
  if (module) {
    brain = new module.Brain({ chantier, memoire, game, code: { staleSince: () => [], state: () => null, commits: [] }, notify: (kind, data) => events.push({ kind, data }) });
    const unexpected = async () => { throw new Error('Unexpected model request: this test has no network.'); };
    brain.client = { messages: { create: unexpected }, beta: { messages: { create: unexpected } } };
  }
  t.after(() => { clearTimeout(chantier.saveTimer); clearTimeout(memoire.saveTimer); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, chantier, memoire, game, brain, events };
}

function photo(c, time = Date.now()) {
  return c.savePhoto(JPEG, { x: 10, y: 0.22, z: 20, t: time, chargement: c.auditGame?.loadedAt, versionJeu: String(c.auditGame?.build || c.auditGame?.version || '0.9.4').split(/\s/)[0], codePerime: [], lien: 'http://localhost:5173/?qa=1' }).id;
}

function delivered(c, extra = {}) {
  const t = c.createTicket({ titre: 'Test de fiabilité', categorie: 'bug', constat: 'Fixture locale.', photos: [photo(c, Date.now() - 2000)], lieu: { x: 10, y: 0.22, z: 20 }, ...extra });
  c.updateTicket(t.id, { statut: 'valide' }, { qui: 'createur', texte: 'Validé.' });
  c.updateTicket(t.id, { statut: 'atelier' }, { qui: 'atelier', texte: 'Début.' });
  c.updateTicket(t.id, { statut: 'corrige', verification: { etape: 'retourner', depuis: Date.now() - 100 }, livraison: { fichiers: ['js/car-physics.js'] } }, { qui: 'atelier', texte: 'Livré.' });
  return t;
}

const protocol = () => ({ revision: 1, version_jeu: '0.9.4', conditions: { heure: 13, meteo: 'clear' }, trafic: 'actif_non_fige', pas_simulation: 'variable' });
function experiment(c, extra = {}) {
  return c.saveExperience({
    type: 'crash', params: { type: 'crash', vitesse: 60, trajet: { x0: 10, z0: 20, x1: 10, z1: 200 }, conditions: { heure: 13, meteo: 'clear' }, protocole: 1 },
    protocole: protocol(), validite: 'valide', raisons: [], lieu: { x: 10, y: 0.22, z: 20 }, mesures: { vitesse_impact_kmh: 59 },
    photos: [photo(c)], chargement: c.auditGame?.loadedAt, codePerime: [], ...extra
  });
}

test('continuous touches do not postpone the session write, and saves leave complete JSON', async (t) => {
  const { memoire } = fixture(t);
  memoire.observe({ texte: 'This observation must survive an active heartbeat.' });
  memoire.seance.programme = { sujet: 'Inspection', i: 2 };
  const deadline = memoire.saveTimer;
  memoire.touch();
  assert.equal(memoire.saveTimer, deadline, 'a heartbeat must retain the pending save deadline');
  await wait(800);
  memoire.touch();
  await wait(850);
  const saved = JSON.parse(fs.readFileSync(memoire.files.seance, 'utf8'));
  assert.equal(saved.programme.i, 2);
  assert.equal(saved.observations.length, 1);
  assert.deepEqual(fs.readdirSync(memoire.dir).filter((name) => name.includes('.tmp-')), []);
});

test('two sessions closed within the same minute retain distinct archives and reports', (t) => {
  const { memoire } = fixture(t);
  memoire.count('pensees');
  const first = memoire.closeNow();
  memoire.saveReport(first, 'First report.');
  memoire.count('pensees');
  const second = memoire.closeNow();
  memoire.saveReport(second, 'Second report.');
  assert.notEqual(first.id, second.id);
  assert.equal(memoire.reports().length, 2);
});

test('a model cannot send unapproved, rejected or revoked tickets to the workshop', sdk, async (t) => {
  const { chantier: c, brain: b, events } = fixture(t);
  const ticket = c.createTicket({ titre: 'Never approved', photos: [], lieu: { x: 10, z: 20 } });
  for (const status of ['a_valider', 'rejete', 'plus']) {
    if (status !== ticket.statut) c.updateTicket(ticket.id, { statut: status }, { qui: 'createur', texte: status === 'rejete' ? 'Rejeté.' : 'Demande plus.' });
    const r = await b.serverTool('conclure_verification', { id: ticket.id, verdict: 'toujours_present', commentaire: 'Try to bypass.', photos: [] });
    assert.equal(r.ok, false);
    assert.equal(ticket.statut, status);
  }
  assert.equal(events.some((e) => e.kind === 'atelier' && e.data?.ticket), false);
});

test('an approved delivery cannot be closed without recorded fresh evidence', sdk, async (t) => {
  const { chantier: c, brain: b } = fixture(t), ticket = delivered(c);
  const old = photo(c, ticket.verification.depuis - 1);
  const input = { id: ticket.id, verdict: 'corrige', commentaire: 'Old evidence.', photos: [old] };
  assert.equal((await b.serverTool('conclure_verification', input)).ok, false);
  c.updateTicket(ticket.id, { verification: { ...ticket.verification, etape: 'conclure', photos: [old] } });
  assert.equal((await b.serverTool('conclure_verification', input)).ok, false);
  assert.equal(ticket.statut, 'corrige');
  assert.equal(ticket.apres.length, 0);
  const delayed = c.savePhoto(JPEG, { x: 10, z: 20, t: Date.now(), debut: ticket.verification.depuis - 1 }).id;
  assert.equal(b.verificationPhoto(ticket, delayed), false, 'a late response cannot turn a pre-delivery capture into fresh evidence');
});

test('a visual delivery closes using photos recorded by the photo tool, regardless of invented input ids', sdk, async (t) => {
  const { chantier: c, brain: b } = fixture(t), ticket = delivered(c);
  b.advanceVerification('sur_place', { id: ticket.id });
  await b.photoTool({ direction: 'devant', cadrage: 'facade', raison: 'Après livraison.' });
  assert.equal(ticket.verification.etape, 'conclure');
  const recorded = ticket.verification.photos;
  const r = await b.serverTool('conclure_verification', { id: ticket.id, verdict: 'corrige', commentaire: 'Photographié.', photos: ['p99999'] });
  assert.equal(r.ok, true);
  assert.equal(ticket.statut, 'verifie');
  assert.deepEqual(ticket.apres, recorded);
});

test('a behavioural delivery requires its recorded valid replay and its fresh photos', sdk, async (t) => {
  const { chantier: c, brain: b, game } = fixture(t), original = experiment(c), ticket = delivered(c, { experience: original.id });
  await b.photoTool({ direction: 'devant', cadrage: 'facade', raison: 'A quiet car proves nothing.' });
  assert.notEqual(ticket.verification.etape, 'conclure');
  game.build = '0.9.5';
  const replay = experiment(c, { refait: original.id, protocole: { ...protocol(), version_jeu: '0.9.5' } });
  b.advanceVerification('experience', replay);
  assert.equal(ticket.verification.experience, replay.id);
  const r = await b.serverTool('conclure_verification', { id: ticket.id, verdict: 'corrige', commentaire: 'Mesuré.', photos: [], experience: 'e9999' });
  assert.equal(r.ok, true);
  assert.deepEqual(ticket.apres, replay.photos);
  assert.match(ticket.fil.at(-1).texte, new RegExp(replay.id));
});

test('perturbed, legacy, stale or mismatched experiments cannot establish a correction', sdk, (t) => {
  const { chantier: c } = fixture(t), original = experiment(c), since = Date.now() - 100;
  const replay = experiment(c, { refait: original.id });
  assert.equal(module.replayProblem(original, replay, since), null);
  for (const patch of [
    { validite: 'perturbee' }, { validite: 'incomplete' }, { t: since - 1 }, { debut: since - 1 }, { refait: 'e9999' }, { photos: [] },
    { params: { ...replay.params, vitesse: 100 } }, { lieu: { x: 12, y: 0.22, z: 20 } },
    { protocole: { ...protocol(), revision: 2 } },
    { protocole: { ...protocol(), conditions: { heure: 23, meteo: 'clear' } } },
    { protocole: { ...protocol(), conditions: { heure: 13, meteo: 'rain' } } }
  ]) assert.ok(module.replayProblem(original, { ...replay, ...patch }, since), JSON.stringify(patch));
  assert.ok(module.replayProblem({ ...original, validite: undefined, protocole: undefined }, replay, since));
});

test('an unavailable or refusing reviewer keeps the complete draft without creating a ticket', sdk, async (t) => {
  const { chantier: c, memoire: m, brain: b } = fixture(t);
  const draft = { titre: 'Keep this exact finding', categorie: 'art', gravite: 'haute', en_clair: 'Visible.', constat: 'Full evidence that must not vanish.', piste: 'Check facade.', photos: [photo(c)] };
  b.check = async () => { throw new Error('Simulated outage.'); };
  assert.equal((await b.openTicket(draft)).ok, false);
  assert.equal(c.tickets.size, 0);
  const dir = path.join(m.dir, 'relectures');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8'));
  assert.equal(saved.draft.constat, draft.constat);
  assert.deepEqual(saved.photos, draft.photos);
  assert.equal(saved.etat, 'en_attente');
  delete b.check;
  const refusal = async () => ({ content: [], stop_reason: 'refusal', usage: {} });
  b.client = { beta: { messages: { create: refusal } } };
  assert.equal((await b.openTicket(draft)).ok, false);
  assert.equal(c.tickets.size, 0);
  assert.equal(fs.readdirSync(dir).length, 2);
});

test('all API paths reject calls when off, paused or over the session ceiling', sdk, async (t) => {
  const { chantier: c, brain: b } = fixture(t);
  let requests = 0;
  const create = async () => { requests++; return { content: [], usage: {} }; };
  b.client = { beta: { messages: { create } }, messages: { create } };
  const request = { messages: [], system: 'Local fixture.', maxTokens: 1000 };
  b.paused = true;
  await assert.rejects(b.call('pensee', request), module.BrainUnavailableError);
  b.paused = false; c.settings.allume = false;
  await assert.rejects(b.call('parole', request), module.BrainUnavailableError);
  c.settings.allume = true; c.settings.plafond = 0;
  await assert.rejects(b.call('relecture', request), module.BrainUnavailableError);
  assert.equal(requests, 0);
});

test('background taste learning, conversation folding and reports do not call a switched-off brain', sdk, async (t) => {
  const { chantier: c, memoire: m, brain: b } = fixture(t);
  c.settings.allume = false;
  m.count('pensees');
  m.talkToFold = () => ({ to: 1, entries: [{ qui: 'createur', texte: 'Test.', t: Date.now() }] });
  let calls = 0;
  b.call = async () => { calls++; throw new Error('No requests allowed.'); };
  await b.learnFromDecision({ id: '0001' }, 'valider', 'Test.');
  await b.foldTalk();
  await b.writeReport(m.seance);
  assert.equal(calls, 0);
  assert.equal(m.reports().length, 1, 'a factual report is still saved without inference');
});

test('concurrent model lanes reserve the same budget before starting requests', sdk, async (t) => {
  const { chantier: c, brain: b } = fixture(t);
  let release, requests = 0;
  const create = () => { requests++; return new Promise((resolve) => { release = resolve; }); };
  b.client = { beta: { messages: { create } } };
  const request = { messages: [], system: 'Local fixture.', maxTokens: 1000 };
  const first = b.call('pensee', request);
  assert.ok(b.reservedBudget > 0);
  c.settings.plafond = b.reservedBudget * 1.5;
  await assert.rejects(b.call('parole', request), module.BrainUnavailableError);
  assert.equal(requests, 1);
  assert.equal(b.paused, false, 'a temporary reservation does not shut down the other lane');
  release({ content: [], usage: { input_tokens: 10, output_tokens: 10 } });
  await first;
  assert.equal(b.status().reserve, 0);
  assert.ok(b.status().depense >= 0);
});

test('aborted requests retain an explicit uncertain spending bound for the ceiling', sdk, async (t) => {
  const { chantier: c, memoire: m, brain: b } = fixture(t);
  const create = (params, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted fixture.', 'AbortError')), { once: true }));
  b.client = { beta: { messages: { create } } };
  const pending = b.call('pensee', { messages: [], system: 'Local fixture.', maxTokens: 1000 });
  const reserved = b.reservedBudget;
  b.setPaused(true, 'éteint');
  b.halt();
  await assert.rejects(pending);
  assert.ok(m.seance.stats.depense_estimee >= reserved);
  assert.ok(b.status().depense_estimee > 0);
  assert.equal(b.reservedBudget, 0);
  assert.equal(c.spending[new Date().toISOString().slice(0, 10)] || 0, 0, 'an estimate is not presented as measured API spend');
});

test('interrupting the first tool prevents every following tool and model request', sdk, async (t) => {
  const { brain: b } = fixture(t);
  let requests = 0;
  const tools = [];
  b.call = async () => { requests++; return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'a', name: 'first' }, { type: 'tool_use', id: 'b', name: 'second' }] }; };
  b.runTool = async (block) => { tools.push(block.name); b.interrupt = true; return { type: 'tool_result', tool_use_id: block.id, content: 'Done.' }; };
  assert.equal(await b.loop('pensee', 'Fixture.', [], { interruptible: true }), '');
  assert.equal(requests, 1);
  assert.deepEqual(tools, ['first']);
});

test('a cancelled trip yields immediately so its replacement can run without old photos or judgement', sdk, async (t) => {
  const { memoire: m, brain: b, game } = fixture(t);
  let release, photographs = 0, thoughts = 0;
  game.command = (name) => name === 'aller_a' ? new Promise((resolve) => { release = resolve; }) : Promise.resolve({ ok: true });
  b.photo = async () => { photographs++; return {}; };
  b.think = async () => { thoughts++; return true; };
  const p = b.programme = new Programme({ brain: b, memoire: m, game, notify: () => {}, log: () => {} });
  p.start({ sujet: 'Old', etapes: [{ x: 100, z: 200, quoi: 'Old trip.', regarder: [{}] }] });
  const old = p.tick();
  p.abort('Cancelled.');
  p.start({ sujet: 'Replacement', etapes: [{ quoi: 'New step.', regarder: [{}] }] });
  await Promise.race([old, wait(300).then(() => assert.fail('The cancelled trip still blocks its replacement.'))]);
  assert.equal(p.stepping, false);
  assert.equal(p.current.sujet, 'Replacement');
  assert.equal(p.current.i, 0);
  release({ ok: true });
  await wait(0);
  assert.equal(photographs, 0);
  assert.equal(thoughts, 0);
});

test('an interrupted judgement preserves the programme step for resumption', sdk, async (t) => {
  const { memoire: m, brain: b, game } = fixture(t);
  b.photo = async () => ({ id: 'p00001', base64: '/9j/2Q==', lieu: { x: 10, z: 20 } });
  b.think = async () => false;
  const p = b.programme = new Programme({ brain: b, memoire: m, game, notify: () => {}, log: () => {} });
  p.start({ sujet: 'Keep this step', etapes: [{ quoi: 'Judge.', regarder: [{}] }] });
  await p.tick();
  assert.equal(p.current.i, 0);
  assert.equal(p.current.etat, 'en_cours');
});

test('restart retains the spending bound of an in-flight request and cannot reset its session', sdk, async (t) => {
  const { chantier: c, memoire: m, brain: b } = fixture(t);
  m.count('pensees');
  const session = m.seance.id;
  m.save();
  b.client = { beta: { messages: { create: () => new Promise(() => {}) } } };
  void b.call('pensee', { messages: [], system: 'Local pending request.', maxTokens: 1000 });
  const reserved = b.reservedBudget;
  const restarted = new Memoire(c);
  t.after(() => clearTimeout(restarted.saveTimer));
  assert.ok(restarted.seance.stats.depense_estimee >= reserved && reserved > 0, 'a vanished process cannot make a possibly billed request free again');
  assert.equal(m.closeNow(), null, 'a session with a request in flight cannot be reset');
  assert.equal(m.seance.id, session);
});

test('a completed or aborted request is durably charged before its promise settles', sdk, async (t) => {
  const { chantier: c, memoire: m, brain: b } = fixture(t);
  m.save();
  b.client = { beta: { messages: { create: async () => ({ content: [], usage: { input_tokens: 100, output_tokens: 100 } }) } } };
  await b.call('pensee', { messages: [], system: 'Local successful request.', maxTokens: 1000 });
  let restarted = new Memoire(c);
  assert.ok(restarted.seance.stats.depense > 0, 'success must be durable without waiting for the background save');
  b.client.beta.messages.create = (params, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Local abort.', 'AbortError')), { once: true }));
  const pending = b.call('pensee', { messages: [], system: 'Local cancelled request.', maxTokens: 1000 });
  b.setPaused(true, 'éteint'); b.halt();
  await assert.rejects(pending);
  restarted = new Memoire(c);
  assert.ok(restarted.seance.stats.depense_estimee > 0, 'an abrupt stop immediately after abort must retain the uncertainty');
  t.after(() => clearTimeout(restarted.saveTimer));
});

test('stale captures cannot become current evidence merely by reloading the game', sdk, async (t) => {
  const { chantier: c, brain: b, game } = fixture(t), ticket = delivered(c);
  let stale = ['js/car-physics.js'];
  b.code.staleSince = () => stale;
  await b.photoTool({ direction: 'devant', cadrage: 'facade', raison: 'The old page still runs.' });
  stale = []; game.loadedAt = Date.now();
  const input = { id: ticket.id, verdict: 'corrige', commentaire: 'Reload alone is not proof.', photos: [] };
  assert.equal((await b.serverTool('conclure_verification', input)).ok, false);
  assert.equal(ticket.statut, 'corrige');
  await b.photoTool({ direction: 'devant', cadrage: 'facade', raison: 'Fresh capture from the reloaded page.' });
  assert.equal((await b.serverTool('conclure_verification', input)).ok, true);
  assert.equal(ticket.apres.length, 1, 'only the fresh capture is attached as proof');
});

test('a programme holds distant work when the camera is returned to the player, then resumes alone', sdk, async (t) => {
  const { memoire: m, brain: b, game } = fixture(t);
  let moves = 0, photos = 0;
  b.photo = async () => { photos++; return { id: 'p00001' }; };
  b.think = async () => true;
  const p = b.programme = new Programme({ brain: b, memoire: m, game, notify: () => {}, log: () => {} });
  p.move = async () => { moves++; return { ok: true, texte: 'Arrived.' }; };
  p.start({ sujet: 'Distant work', etapes: [{ x: 1000, z: 20, quoi: 'Look far away.', regarder: [{}] }] });
  game.state.architecte.spectating = false;
  await p.tick();
  assert.equal(moves, 0);
  assert.equal(photos, 0);
  assert.equal(p.current.i, 0);
  game.state.architecte.spectating = true;
  await p.tick();
  assert.equal(moves, 1);
  assert.equal(photos, 1);
  assert.equal(p.current.etat, 'fini');
});

test('returning the camera cancels an in-flight distant trip before any photos or judgement', sdk, async (t) => {
  const { memoire: m, brain: b, game } = fixture(t);
  let release, photos = 0;
  game.command = (name) => name === 'aller_a' ? new Promise((resolve) => { release = resolve; }) : Promise.resolve({ ok: true });
  b.photo = async () => { photos++; return {}; };
  const p = b.programme = new Programme({ brain: b, memoire: m, game, notify: () => {}, log: () => {} });
  p.start({ sujet: 'Distant trip', etapes: [{ x: 1000, z: 20, moyen: 'voiture', quoi: 'Travel.', regarder: [{}] }] });
  const pending = p.tick();
  game.state.architecte.spectating = false;
  await p.tick();
  assert.equal(p.stepAbort?.signal.aborted, true);
  await pending;
  release({ ok: true });
  assert.equal(photos, 0);
  assert.equal(p.current.i, 0);
});

test('a successful response without token usage retains a durable uncertainty bound', sdk, async (t) => {
  const { chantier: c, memoire: m, brain: b } = fixture(t);
  b.client = { beta: { messages: { create: async () => ({ content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' }) } } };
  const response = await b.call('pensee', { messages: [], system: 'Local response with missing usage.', maxTokens: 1000 });
  assert.equal(response.stop_reason, 'end_turn');
  assert.ok(m.seance.stats.depense_estimee > 0);
  const restarted = new Memoire(c);
  assert.equal(restarted.seance.stats.depense_estimee, m.seance.stats.depense_estimee);
  assert.equal(restarted.hasPendingCalls(), false);
  t.after(() => clearTimeout(restarted.saveTimer));
});

test('a capture requested before a reload retains its original page identity on a late reply', sdk, async (t) => {
  const { chantier: c, brain: b, game } = fixture(t), ticket = delivered(c);
  let release;
  game.command = () => new Promise((resolve) => { release = resolve; });
  const oldLoad = game.loadedAt;
  const pending = b.photoTool({ direction: 'devant', cadrage: 'facade', raison: 'Capture before reload.' });
  game.loadedAt = oldLoad + 1;
  release({ ok: true, image: JPEG, lieu: { x: 10, y: 0.22, z: 20 } });
  await pending;
  const shot = b.recentPhotos.at(-1);
  assert.equal(c.photoMeta(shot.id).chargement, oldLoad);
  assert.ok(c.photoMeta(shot.id).codePerime.includes('chargement_interrompu'));
  assert.equal(b.verificationPhoto(ticket, shot.id), false);
  assert.notEqual(ticket.verification.etape, 'conclure');
});

test('a partial protocol or a replay from another game build remains unverified', sdk, (t) => {
  const { chantier: c, brain: b } = fixture(t), original = experiment(c), ticket = delivered(c, { experience: original.id });
  const replay = experiment(c, { refait: original.id });
  assert.equal(b.verificationReplay(ticket, replay), null);
  assert.ok(b.verificationReplay(ticket, { ...replay, protocole: { ...protocol(), version_jeu: '0.9.3' } }));
  for (const key of ['trafic', 'pas_simulation']) {
    const partial = { ...protocol() }; delete partial[key];
    assert.ok(module.replayProblem({ ...original, protocole: partial }, { ...replay, protocole: partial }, ticket.verification.depuis));
  }
  assert.ok(module.replayProblem(original, { ...replay, protocole: { ...protocol(), conditions: { heure: 99, meteo: 'clear' } } }, ticket.verification.depuis));
});
