import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Autonomie, prospectionPlan } from '../tools/architecte/autonomie.mjs';
import { Programme } from '../tools/architecte/programme.mjs';
import { Chantier } from '../tools/architecte/chantier.mjs';
import { Memoire } from '../tools/architecte/memoire.mjs';

let Brain;
try { ({ Brain } = await import('../tools/architecte/brain.mjs')); } catch { /* Optional SDK. */ }
const sdk = { skip: !Brain && 'SDK Anthropic absent' };
const JPEG = 'data:image/jpeg;base64,/9j/2Q==';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecte-autonomie-'));
  const c = new Chantier(root), m = new Memoire(c), commands = [], requests = [], time = { t: Date.now() };
  c.settings.allume = true; c.settings.atelier = false;
  const game = { connected: true, loadedAt: Date.now() - 10_000, build: '0.9.4', version: '0.9.4',
    state: { architecte: { present: true, alive: true, spectating: true, x: 0, y: 0.22, z: 0, trip: false, capacites: { deplacements: ['pied', 'voiture', 'helico'] } }, joueur: { x: 0, z: 0 }, onglet: { visible: false, lance: true, pause: false } } };
  game.command = async (name, input = {}) => {
    commands.push({ name, input });
    const a = game.state.architecte;
    if (['aller_a', 'se_teleporter'].includes(name) && !game.stuck) { a.x = input.x; a.z = input.z; a.trip = false; }
    if (name === 'suivre_joueur') { a.x = game.state.joueur.x + 5; a.z = game.state.joueur.z; }
    if (name === 'photographier') return game.noPhotos ? { ok: false, texte: 'Capture indisponible.' } : { ok: true, image: JPEG, lieu: { x: a.x, y: a.y, z: a.z, heure: 13, meteo: 'clear' } };
    return { ok: true, texte: `Mesure réelle du témoin : ${name}.` };
  };
  const b = new Brain({ chantier: c, memoire: m, game, code: { state: () => null, staleSince: () => [], commits: [] }, notify: () => {} });
  // The regression deliberately returns the same unproductive conclusion as the incident. Only fixture requests run.
  const create = async (params) => { requests.push(params); return { usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn', content: [{ type: 'text', text: 'Je reste ici. #0003 est toujours chez l’atelier et je n’agis pas.' }] }; };
  b.client = { messages: { create }, beta: { messages: { create } } };
  b.places = [100, 500, 1200, 2200, 3500, 5000].map((x, i) => ({ id: `place${i}`, label: `Quartier ${i}`, x, z: i * 70 }));
  b.workshop = () => ({ enCours: null, file: [] });
  const p = b.programme = new Programme({ brain: b, game, memoire: m, log: () => {}, notify: () => {}, clock: () => time.t, sleep: async (ms, signal) => { if (signal?.aborted) throw new DOMException('Aborted fixture.', 'AbortError'); time.t += ms; } });
  t.after(() => { clearTimeout(c.saveTimer); clearTimeout(m.saveTimer); fs.rmSync(root, { recursive: true, force: true }); });
  return { c, m, b, p, game, commands, requests, time };
}

function failedTicket(c) {
  for (let i = 0; i < 2; i++) { const old = c.createTicket({ titre: `Ancien constat ${i}`, photos: [] }); c.updateTicket(old.id, { statut: 'rejete' }, { qui: 'createur', texte: 'Rejeté.' }); }
  const ticket = c.createTicket({ titre: 'PNJ de nuit', categorie: 'art', photos: [], lieu: { x: 0, z: 0 } });
  c.updateTicket(ticket.id, { statut: 'valide' }, { qui: 'createur', texte: 'Validé.' });
  c.updateTicket(ticket.id, { statut: 'atelier' }, { qui: 'atelier', texte: 'Démarrage.' });
  c.updateTicket(ticket.id, { statut: 'echec', livraison: null }, { qui: 'atelier', texte: 'Livraison non acceptée.' });
  return ticket;
}

test('prospection stays near the player in Ensemble and only uses available body modes', () => {
  const state = { architecte: { x: 0, z: 0, spectating: false, capacites: { deplacements: ['pied', 'voiture', 'helico'] } }, joueur: { x: 0, z: 0 } };
  for (let round = 0; round < 12; round++) {
    const plan = prospectionPlan({ state, places: [{ x: 5000, z: 0, label: 'Far away' }], round });
    assert.ok(plan);
    assert.ok(Math.hypot(plan.etapes[0].x, plan.etapes[0].z) <= 330);
    assert.ok(['pied', 'voiture'].includes(plan.etapes[0].moyen));
    assert.equal(plan.etapes[0].heure, undefined);
    assert.equal(plan.etapes[0].meteo, undefined);
  }
});

test('an old failed ticket and repeated idle model answers cannot stop continuous body exploration', sdk, async (t) => {
  const { c, m, b, p, commands, requests, time } = fixture(t), ticket = failedTicket(c);
  m.conclude('Je reste ici, #0003 est toujours chez l’atelier.');
  m.talkSummary.texte = '#0003 est toujours à l’atelier, donc j’attends.';
  const modes = new Set(), points = new Set();
  for (let i = 0; i < 12; i++) {
    b.heartbeat();
    assert.equal(p.active, true);
    assert.equal(p.current.origine, 'prospection');
    const step = p.current.etapes[0]; modes.add(step.moyen); points.add(`${Math.round(step.x)},${Math.round(step.z)}`);
    await p.tick();
    assert.equal(p.current.etat, 'fini');
    time.t += 225_000; // Forty-five minutes of wall time, with movement and fresh observations each round.
  }
  assert.equal(ticket.statut, 'echec');
  assert.equal(c.tickets.size, 3, 'no ticket is invented by the scheduler');
  assert.equal(requests.length, 12, 'one model judgement per new observation, no idle or end-of-programme calls');
  assert.ok(m.seance.stats.photos >= 24);
  assert.deepEqual([...modes].sort(), ['helico', 'pied', 'voiture']);
  assert.ok(points.size >= 6);
  assert.ok(commands.filter((command) => command.name === 'aller_a').length >= 10);
  assert.equal(commands.some((command) => /camera/.test(command.name)), false);
  assert.equal(m.seance.autoriteTickets['0003'].statut, 'echec');
  const context = b.conscience([], 'evenements', {});
  assert.match(context, /ÉCHEC RÉEL/);
  assert.equal(context.includes('Je reste ici, #0003 est toujours chez l’atelier.'), false);
  assert.equal(b.longMemory().includes('#0003 est toujours à l’atelier'), false);
});

test('forty-five minutes without new events never trigger paid idle thoughts', sdk, async (t) => {
  const { b, requests } = fixture(t);
  b.programme = null;
  b.lastThought = Date.now() - 45 * 60_000;
  for (let i = 0; i < 100; i++) b.heartbeat();
  await Promise.resolve();
  assert.equal(requests.length, 0);
  assert.equal(await b.think('respiration'), false);
  assert.equal(requests.length, 0);
});

test('verification tools and programmes refuse a failed workshop status regardless of old memory', sdk, async (t) => {
  const { c, b, p } = fixture(t), ticket = failedTicket(c);
  assert.equal((await b.serverTool('verifier_ticket', { id: ticket.id })).ok, false);
  assert.equal((await b.serverTool('planifier', { sujet: 'Vérification #0003', categorie: 'art', etapes: [{ regarder: [], quoi: 'Old task.' }] })).ok, false);
  p.start({ verification_de: ticket.id, sujet: 'Persisted old verification', etapes: [{ x: 0, z: 0, regarder: [], quoi: 'Stale work.' }] });
  b.heartbeat();
  assert.equal(p.current.origine, 'prospection');
  assert.equal(ticket.statut, 'echec');
});

test('a blocked body is really replanned once, then its inaccessible point is excluded without a model call', sdk, async (t) => {
  const { b, p, game, commands, requests, time } = fixture(t);
  game.stuck = true;
  p.start({ sujet: 'Blocked route', etapes: [{ x: 220, z: 0, moyen: 'voiture', regarder: [{}], quoi: 'Reach this place.' }] });
  await p.tick();
  const moves = commands.filter((command) => command.name === 'aller_a');
  assert.equal(moves.length, 2);
  assert.equal(moves[1].input.reprendre, true);
  assert.equal(moves[1].input.moyen, 'pied');
  assert.equal(p.current.etat, 'fini');
  assert.equal(requests.length, 0, 'an inaccessible target is not an invented bug or an empty judgement');
  assert.ok(b.autonomie.status().relances >= 1);
  assert.ok(b.autonomie.status().pointsEcartes >= 1);
  b.autonomie.tick(time.t);
  assert.notEqual(`${p.current.etapes[0].x},${p.current.etapes[0].z}`, '220,0');
});

test('failed photos are retried a bounded number of times, then another target replaces them for free', sdk, async (t) => {
  const { b, p, game, requests, time } = fixture(t);
  game.noPhotos = true;
  p.start({ sujet: 'Unavailable eye', etapes: [{ x: 0, z: 0, regarder: [{}], quoi: 'Capture.' }] });
  await p.tick(); assert.equal(p.current.i, 0);
  await p.tick(); assert.equal(p.current.etat, 'fini');
  assert.equal(requests.length, 0);
  b.autonomie.tick(time.t);
  assert.equal(p.current.origine, 'prospection');
});

test('off, pause, exhausted budget and a hidden Ensemble tab stop both exploration and thoughts', sdk, async (t) => {
  const { b, game, commands, requests, c } = fixture(t);
  b.paused = true; b.heartbeat();
  b.paused = false; c.settings.allume = false; b.heartbeat();
  c.settings.allume = true; game.state.architecte.alive = false; b.heartbeat();
  game.state.architecte.alive = true; game.state.architecte.spectating = false; b.heartbeat();
  assert.equal(commands.length, 0); assert.equal(requests.length, 0);
  game.state.architecte.spectating = true; c.settings.plafond = 0; b.heartbeat();
  assert.equal(commands.some((command) => ['aller_a', 'se_teleporter', 'suivre_joueur'].includes(command.name)), false);
});

test('several independent proven proposals remain possible while previous tickets await human decisions', sdk, async (t) => {
  const { b, c } = fixture(t);
  failedTicket(c);
  b.check = async () => ({ confirme: true });
  for (let i = 0; i < 2; i++) {
    const shot = await b.photo({ direction: 'devant', cadrage: 'rue', raison: `Independent proof ${i}.` });
    const result = await b.openTicket({ titre: `Défaut indépendant ${i}`, categorie: 'art', gravite: 'moyenne', constat: `Observed fixture ${i}.`, piste: 'Inspect.', photos: [shot.id] });
    assert.equal(result.ok, true);
  }
  assert.equal(c.listTickets().filter((ticket) => ticket.statut === 'a_valider').length, 2);
});

test('a delivered correction gets priority, but an active workshop does not force exploration to wait on stale code', sdk, (t) => {
  const { c, b, p } = fixture(t), ticket = failedTicket(c);
  c.updateTicket(ticket.id, { statut: 'valide' }, { qui: 'createur', texte: 'Validé pour reprise.' });
  c.updateTicket(ticket.id, { statut: 'atelier' }, { qui: 'atelier', texte: 'Reprise.' });
  c.updateTicket(ticket.id, { statut: 'corrige', livraison: { resume: 'Livraison.', fichiers: ['js/person.js'] }, verification: { etape: 'retourner', depuis: Date.now() } }, { qui: 'atelier', texte: 'Livré.' });
  assert.equal(b.autonomie.tick(Date.now()), true);
  assert.equal(p.current.verification_de, ticket.id);
  p.abort('Other work while code loads.');
  b.code.staleSince = () => ['js/person.js'];
  b.workshop = () => ({ enCours: { id: '0009' } });
  assert.equal(b.autonomie.tick(Date.now() + 6 * 60_000), true);
  assert.equal(p.current.origine, 'prospection');
});

test('returning to the player does not reset a helicopter ascent that is making progress', sdk, async (t) => {
  const { b, game, commands, time } = fixture(t);
  const a = game.state.architecte;
  a.spectating = false; a.x = 5000;
  game.state.onglet.visible = true;
  game.command = async (name, input) => { commands.push({ name, input }); return { ok: true }; };
  b.autonomie.tick(time.t);
  await Promise.resolve(); await Promise.resolve();
  for (let i = 1; i <= 4; i++) {
    a.y += 10;
    time.t += 20_000;
    b.autonomie.tick(time.t);
  }
  assert.equal(commands.filter((command) => command.name === 'suivre_joueur').length, 1);
  time.t += 35_000;
  b.autonomie.tick(time.t);
  assert.equal(commands.filter((command) => command.name === 'suivre_joueur').length, 2, 'a true stall gets a real new return order');
});
