import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Chantier, migrateBrains } from '../tools/architecte/chantier.mjs';
import { Memoire, SESSION_GAP } from '../tools/architecte/memoire.mjs';
import { Code, parseStatus, ticketsIn } from '../tools/architecte/code.mjs';
import { parseTests, describe as describeStep } from '../tools/architecte/atelier.mjs';
import { Programme } from '../tools/architecte/programme.mjs';

// The Architect's server keeps his work on disk; the brain needs the Anthropic SDK, installed on the server's first run
let brain = null;
try { brain = await import('../tools/architecte/brain.mjs'); } catch { /* SDK not installed yet: brain tests skipped */ }

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-'));
const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

test('a fresh workshop has its folders, default brains, and the Creator’s first notes', () => {
  const root = tmp();
  const c = new Chantier(root);
  for (const d of ['tickets', 'photos', 'journal', 'experiences']) assert.ok(fs.existsSync(path.join(root, 'chantier', d)), d);
  assert.deepEqual(c.settings.cerveaux.pensee, { modele: 'equilibre', effort: 'low' });
  assert.equal(c.settings.cerveaux.relecture.modele, 'maximal');
  assert.equal(c.settings.plafond, 3);
  assert.ok(c.notes().some((n) => n.includes('boutiques')), 'his entrance exam is in his notebook');
});

test('settings from the one-brain version become three roles; a bad value falls back', () => {
  assert.deepEqual(migrateBrains({ cerveau: 'vif' }), { pensee: { modele: 'vif', effort: 'low' }, parole: { modele: 'vif', effort: 'low' }, relecture: { modele: 'equilibre', effort: 'medium' } });
  const kept = migrateBrains({ cerveaux: { pensee: { modele: 'maximal', effort: 'xhigh' }, parole: { modele: 'nope', effort: 'max' } } });
  assert.deepEqual(kept.pensee, { modele: 'maximal', effort: 'xhigh' });
  assert.deepEqual(kept.parole, { modele: 'equilibre', effort: 'max' });
  const root = tmp();
  fs.mkdirSync(path.join(root, 'chantier'), { recursive: true });
  fs.writeFileSync(path.join(root, 'chantier', 'etat.json'), JSON.stringify({ settings: { cerveau: 'maximal', plafond: 5 } }));
  const c = new Chantier(root);
  assert.equal(c.settings.cerveau, undefined, 'the old field is gone');
  assert.equal(c.settings.cerveaux.pensee.modele, 'maximal');
  assert.equal(c.settings.plafond, 5);
});

test('a ticket keeps its photos, renders as Markdown, and its thread grows', () => {
  const root = tmp();
  const c = new Chantier(root);
  const p = c.savePhoto(JPEG, { x: 1, z: 2 });
  assert.match(p.id, /^p\d{5}$/);
  const t = c.createTicket({ titre: 'Vitrines plates, « années 90 »', en_clair: 'Les boutiques ont l’air peintes.', categorie: 'art', gravite: 'haute', constat: 'Aplats.', piste: 'Verre.',
    photos: [p.id, 'p99999'], lieu: { x: 10, y: 0, z: 20, adresse: '7th Ave & W 46th St', lien: 'http://localhost:5173/?qa=1&at=10,0,20,0,0' }, version: '0.9.1' });
  assert.equal(t.id, '0001');
  assert.match(t.dir, /^0001-vitrines-plates-annees-90/);
  assert.deepEqual(t.photos, [p.id], 'a photo that does not exist is left out');
  assert.ok(fs.existsSync(path.join(c.ticketDir(t), `${p.id}.jpg`)));
  c.updateTicket(t.id, { statut: 'valide' }, { qui: 'createur', texte: 'Validé.' });
  const md = fs.readFileSync(path.join(c.ticketDir(t), 'ticket.md'), 'utf8');
  assert.match(md, /^# #0001 · Art · Gravité haute · Validé/);
  assert.match(md, /> En clair : Les boutiques ont l’air peintes\./);
  assert.match(md, /Voir dans le jeu : http:\/\/localhost:5173/);
  assert.match(md, /Créateur : Validé\./);
  // a second workshop on the same folder finds it again, with the fields of this version
  const again = new Chantier(root);
  assert.equal(again.tickets.get('0001').statut, 'valide');
  assert.deepEqual(again.tickets.get('0001').commits, []);
  assert.equal(again.createTicket({ titre: 'Deuxième', photos: [] }).id, '0002');
});

test('the journal is written a line a time and read back by the next session', () => {
  const root = tmp();
  const c = new Chantier(root);
  c.log('pensee', 'Rien à signaler.');
  c.log('action', 'Part vers Times Square.', { id: 'x' });
  const again = new Chantier(root);
  assert.deepEqual(again.recent(5).map((e) => e.kind), ['pensee', 'action']);
  assert.equal(again.recent(5, ['action'])[0].data.id, 'x');
});

test('photo ids are checked before any file is touched; experiments keep their settings', () => {
  const c = new Chantier(tmp());
  assert.equal(c.photoFile('../etat'), null);
  assert.equal(c.photoFile('p1'), null);
  const e = c.saveExperience({ type: 'crash', params: { vitesse: 50, trajet: { x0: 0, z0: 0, x1: 0, z1: 200 } }, mesures: { vitesse_impact_kmh: 49.5 } });
  assert.equal(e.id, 'e0001');
  assert.equal(c.experience('e0001').params.vitesse, 50);
  assert.equal(c.experience('../x'), null);
  assert.equal(c.listExperiences()[0].id, 'e0001');
});

test('spending is counted per day, per role and per model', () => {
  const c = new Chantier(tmp());
  c.addSpending(0.02, 'pensee', 'Équilibré');
  c.addSpending(0.01, 'parole', 'Vif');
  c.addSpending(0.03, 'pensee', 'Équilibré');
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(+c.spending[day].toFixed(2), 0.06);
  assert.equal(+c.spendingDetail[day].roles.pensee.toFixed(2), 0.05);
  assert.equal(+c.spendingDetail[day].modeles.Vif.toFixed(2), 0.01);
});

// ---- His memory -------------------------------------------------------------------------------------------------------
test('his memory keeps the session, the conversation, the Creator’s tastes and his coverage across a restart', () => {
  const root = tmp();
  const c = new Chantier(root);
  const m = new Memoire(c);
  m.observe({ texte: 'Vitrines de la 7e : en relief, éclairées.', photos: ['p00001'], lieu: { x: -581, z: -324, adresse: '7th Ave & W 46th St' }, sujet: 'art' });
  m.conclude('Rien à signaler, je passe à Bryant Park.');
  m.say('createur', 'Regarde les vitrines de nuit.', 'jeu');
  m.say('architecte', 'J’y vais à 23 h.', 'jeu');
  m.setTastes(['Le Créateur veut des tickets en clair.', '']);
  m.markCovered({ x: -581, z: -324, heure: 23, meteo: 'rain', sujet: 'art', adresse: 'Times Square' });
  m.markCovered({ x: -560, z: -310, heure: 13, meteo: 'clear', sujet: 'art' });
  m.change('commit', 'Le Créateur a commité abc1234 « Vitrines ».');
  m.save();
  const again = new Memoire(c);
  assert.equal(again.recentSeen()[0].texte, 'Vitrines de la 7e : en relief, éclairées.');
  assert.equal(again.recentConclusions()[0].texte, 'Rien à signaler, je passe à Bryant Park.');
  assert.deepEqual(again.recentTalk().map((e) => e.qui), ['createur', 'architecte']);
  assert.deepEqual(again.tastes.regles, ['Le Créateur veut des tickets en clair.']);
  const near = again.coveredNear(-570, -320);
  assert.deepEqual([near.n, near.nuit, near.pluie, near.sujets.art], [2, 1, 1, 2]);
  const summary = again.coverageSummary([{ id: 'timessq', label: 'Times Square', x: -581, z: -324 }, { id: 'owtc', label: 'One World Trade Center', x: 300, z: 6000 }]);
  assert.match(summary, /Times Square \(2 photos, dont 1 de nuit, 1 sous la pluie ; sujets : art\)/);
  assert.match(summary, /Jamais vus : One World Trade Center/);
  assert.equal(again.changesSince(0).length, 1);
  assert.match(again.search('vitrines nuit').map((h) => h.texte).join(' '), /Vitrines de la 7e/);
});

test('a long silence closes the session: the old one waits for its report, the new one brings a briefing', () => {
  const c = new Chantier(tmp());
  const m = new Memoire(c);
  m.observe({ texte: 'Vu quelque chose.' });
  m.count('pensees');
  const first = m.seance.id;
  const end = m.seance.derniere;
  m.touch(end + 60_000);
  assert.equal(m.closed, null, 'a minute is not a pause');
  m.touch(end + 60_000 + SESSION_GAP + 1);
  assert.equal(m.closed.id, first);
  assert.equal(m.seance.briefing, true);
  assert.equal(m.seance.depuis, end + 60_000, 'what changed since he left goes in the briefing');
  assert.equal(m.seance.observations.length, 0);
  const report = m.factualReport(m.closed, 'Une bonne séance.');
  assert.match(report, /## Bilan\n\nUne bonne séance\./);
  assert.match(report, /1 pensées, 0 photos/);
});

test('old exchanges fold into a summary only when enough have piled up', () => {
  const m = new Memoire(new Chantier(tmp()));
  for (let i = 0; i < 50; i++) m.say(i % 2 ? 'architecte' : 'createur', `message ${i}`);
  assert.equal(m.talkToFold(), null, '50 exchanges: the 30 latest stay, 20 is not enough to fold');
  for (let i = 0; i < 20; i++) m.say('createur', `encore ${i}`);
  const fold = m.talkToFold();
  assert.deepEqual([fold.from, fold.to, fold.entries.length], [0, 40, 40]);
  m.setTalkSummary('Il m’a demandé les vitrines.', fold.to);
  assert.equal(m.talkToFold(), null);
});

// ---- The code ---------------------------------------------------------------------------------------------------------
test('git status and ticket references are read', () => {
  assert.deepEqual(parseStatus(' M js/a.js\0?? css/new.css\0R  js/b.js\0js/old.js\0 D js/c.js\0').map((f) => [f.path, f.statut]),
    [['js/a.js', 'modifié'], ['css/new.css', 'nouveau'], ['js/b.js', 'modifié'], ['js/c.js', 'supprimé']]);
  assert.deepEqual(ticketsIn('Corrige #1 et #0012, pas #abc'), ['0001', '0012']);
});

test('the code watch sees commits land, knows stale files, and brackets a workshop session with its own diff', async () => {
  const root = tmp();
  const git = (...args) => execFileSync('git', args, { cwd: root }).toString();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
  fs.mkdirSync(path.join(root, 'js'));
  fs.writeFileSync(path.join(root, 'js/car.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(root, 'js/other.js'), 'const o = 1;\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'chantier/\n'); // as in the project
  git('add', '.'); git('commit', '-q', '-m', 'Départ');
  const commits = [];
  const code = new Code({ root, onCommit: (c) => commits.push(c) });
  await code.poll();
  assert.equal(code.branch, 'main');
  assert.equal(code.files.length, 0);
  // the Creator edits a file before the session: it is not the workshop's
  fs.writeFileSync(path.join(root, 'js/other.js'), 'const o = 2;\n');
  const sdir = path.join(root, 'chantier', 'atelier', 's1');
  fs.mkdirSync(sdir, { recursive: true });
  const snap = await code.snapshot(sdir);
  const loaded = Date.now();
  await new Promise((r) => setTimeout(r, 700));
  fs.writeFileSync(path.join(root, 'js/car.js'), 'const a = 2;\nconst b = 3;\n');
  fs.writeFileSync(path.join(root, 'js/new.js'), 'export {};\n');
  const changes = await code.sessionChanges(sdir, snap);
  assert.deepEqual(changes.map((c) => [c.path, c.statut, c.plus, c.moins]), [['js/car.js', 'modifié', 2, 1], ['js/new.js', 'nouveau', 1, 0]]);
  const patch = fs.readFileSync(path.join(sdir, 'diff.patch'), 'utf8');
  assert.match(patch, /^diff --git a\/js\/car\.js b\/js\/car\.js/m);
  assert.doesNotMatch(patch, /other\.js/, 'the Creator’s own edit is not in the session');
  assert.deepEqual(code.staleSince(loaded), ['js/car.js', 'js/new.js'], 'a page loaded before these edits runs stale code');
  git('add', '.'); git('commit', '-q', '-m', 'Corrige #3 : la voiture');
  await code.poll();
  assert.equal(commits.length, 1);
  assert.equal(commits[0].sujet, 'Corrige #3 : la voiture');
  assert.deepEqual(commits[0].tickets, ['0003']);
  assert.deepEqual(commits[0].fichiers.sort(), ['js/car.js', 'js/new.js', 'js/other.js']);
  assert.equal(code.files.length, 0);
  assert.deepEqual(code.staleSince(Date.now()), [], 'committing what was on disk changes nothing a fresh page loaded');
});

// ---- The workshop ---------------------------------------------------------------------------------------------------
test('the workshop reads test results in both reporters and names its steps', () => {
  assert.deepEqual(parseTests('ok 1\n# tests 398\n# suites 0\n# pass 397\n# fail 1\n'), { total: 398, pass: 397, fail: 1 });
  assert.deepEqual(parseTests('ℹ tests 13\nℹ suites 0\nℹ pass 13\nℹ fail 0\n'), { total: 13, pass: 13, fail: 0 });
  assert.equal(parseTests('nothing here'), null);
  assert.equal(describeStep('/repo', { name: 'Edit', input: { file_path: '/repo/js/car-physics.js' } }), 'Modifie js/car-physics.js');
  assert.equal(describeStep('/repo', { name: 'Read', input: { file_path: '/repo/chantier/tickets/0001/p00007.jpg' } }), 'Regarde la photo p00007.jpg');
  assert.equal(describeStep('/repo', { name: 'StructuredOutput', input: {} }), 'Rédige sa fiche de livraison');
});

// ---- His programme ------------------------------------------------------------------------------------------------------
function fakeProgramme(spectating) {
  const c = new Chantier(tmp());
  const memoire = new Memoire(c);
  const game = { connected: true, state: { architecte: { spectating, present: true, alive: true, x: 0, z: 0 }, joueur: { x: 0, z: 0 } } };
  const brain = { places: [{ id: 'timessq', label: 'Times Square', x: -581, z: -324 }], busy: false };
  const notes = [];
  return { p: new Programme({ brain, game, memoire, log: () => {}, notify: (k, d) => notes.push(k) }), memoire };
}

test('a programme near the player is accepted in Ensemble; a far one waits for the camera', () => {
  const together = fakeProgramme(false).p;
  const far = together.start({ sujet: 'Vitrines', categorie: 'art', etapes: [{ lieu: 'timessq', regarder: [{ direction: 'devant', cadrage: 'facade' }], quoi: 'vitrines' }], raison: 'examen' });
  assert.equal(far.ok, false);
  assert.match(far.texte, /350 m du joueur \(Times Square\)/);
  const near = together.start({ sujet: 'Trottoir', categorie: 'bug', etapes: [{ x: 40, z: 10, regarder: [{ direction: 'devant', cadrage: 'sol' }], quoi: 'bordure' }], raison: 'examen' });
  assert.equal(near.ok, true);
  const { p, memoire } = fakeProgramme(true);
  assert.equal(p.start({ sujet: 'Vitrines', categorie: 'art', etapes: [{ lieu: 'timessq', regarder: [{ direction: 'devant', cadrage: 'facade' }], quoi: 'vitrines' }, { x: 1, z: 2, regarder: [{ direction: 'gauche', cadrage: 'rue' }], quoi: 'rue' }], raison: 'examen' }).ok, true);
  const s = p.summary();
  assert.deepEqual([s.active, s.etape, s.total, s.etapes[0].x], [true, 1, 2, -581]);
  assert.equal(p.abort('autre chose').ok, true);
  assert.equal(p.active, false);
  assert.equal(memoire.seance.programmes.at(-1).etat, 'abandonné');
});

// ---- His mind ---------------------------------------------------------------------------------------------------------
test('his instructions list the places and his tools are well formed', { skip: !brain && 'SDK absent' }, () => {
  const prompt = brain.systemPrompt([{ id: 'timessq', label: 'Times Square', x: -581, z: -324 }]);
  assert.match(prompt, /timessq : Times Square \(x -581, z -324\)/);
  assert.match(prompt, /TA CONSCIENCE/);
  const names = new Set();
  for (const t of brain.TOOLS) {
    assert.match(t.name, /^[a-z_]+$/);
    assert.ok(!names.has(t.name), `${t.name} twice`);
    names.add(t.name);
    assert.equal(t.input_schema.type, 'object');
    for (const r of t.input_schema.required || []) assert.ok(t.input_schema.properties[r], `${t.name}.${r}`);
  }
  for (const n of ['planifier', 'photographier', 'identifier', 'sonder_sol', 'lancer_experience', 'ouvrir_ticket', 'chercher_memoire', 'conclure_verification']) assert.ok(names.has(n), n);
});

test('the journal names what he did, with clean ticket numbers', { skip: !brain && 'SDK absent' }, () => {
  assert.equal(brain.summarize('completer_ticket', { id: '#1', commentaire: 'nuit' }), 'Complète le ticket #0001 : nuit');
  assert.equal(brain.summarize('dire', { texte: 'Bonsoir.' }), '« Bonsoir. »');
  assert.match(brain.summarize('aller_a', { lieu: 'timessq', moyen: 'helico', raison: 'voir' }), /^Part vers timessq en hélico : voir$/);
  assert.equal(brain.summarize('planifier', { sujet: 'Vitrines', etapes: [{}, {}], raison: 'examen' }), 'Programme « Vitrines » : 2 étape(s) — examen');
});

test('a verification says what to do next, stale code first; two runs compare measure by measure', { skip: !brain && 'SDK absent' }, () => {
  const t = { livraison: { fichiers: ['js/car-physics.js'] }, verification: { etape: 'retourner' }, experience: 'e0002' };
  assert.match(brain.verificationStep(t, ['js/car-physics.js']), /recharger_le_jeu/);
  assert.equal(brain.verificationStep(t, []), 'retourner_au_ticket');
  assert.match(brain.verificationStep({ ...t, verification: { etape: 'experience' } }, []), /refaire l’expérience e0002/);
  assert.equal(brain.compareMeasures({ tangage: 77.4, retournee: true }, { tangage: 1.3, retournee: false }), '- tangage : 77.4 → 1.3\n- retournee : true → false');
});

test('his conscience says where he is, what changed, what was said, and which tickets wait', { skip: !brain && 'SDK absent' }, () => {
  const c = new Chantier(tmp());
  const memoire = new Memoire(c);
  memoire.say('createur', 'Va voir les vitrines.', 'jeu');
  memoire.change('commit', 'Le Créateur a commité 0479117 « Main Street : de vraies boutiques en relief ».');
  const p = c.savePhoto(JPEG, {});
  const t = c.createTicket({ titre: 'Vitrines plates', categorie: 'art', gravite: 'haute', constat: 'Aplats.', piste: 'Relief.', photos: [p.id], lieu: { x: -581, z: -324, adresse: 'Times Square' } });
  c.updateTicket(t.id, { ouvert: Date.now() - 86400e3 });
  const game = { connected: true, loadedAt: Date.now(), state: { architecte: { present: true, alive: true, spectating: false, mode: 'à pied', address: '7th Ave', x: -570, z: -320, y: 0, hp: 120 }, joueur: { state: 'à pied', distance: 8, health: 100 }, monde: { heure: '13:00', meteo: 'Dégagé', fps: 60 } } };
  const code = { state: () => ({ branche: 'main', head: '0479117', fichiers: [] }), staleSince: () => [], commits: [{ sha: '0479117', sujet: 'Main Street : de vraies boutiques en relief', t: Date.now() - 3600e3 }] };
  const b = new brain.Brain({ chantier: c, memoire, code, game, notify: () => {} });
  b.lastThoughtAt = 0;
  const text = b.conscience([{ kind: 'capteur', text: 'Capteur — Saccade', t: Date.now() }], 'evenements', {});
  assert.match(text, /Mode : ENSEMBLE/);
  assert.match(text, /branche main \(0479117\).*Le jeu tourne sur le code du disque/);
  assert.match(text, /Ce qui a changé dans le monde[\s\S]*0479117/);
  assert.match(text, /Le Créateur : Va voir les vitrines\./);
  assert.match(text, /Depuis l’ouverture de #0001 \(Vitrines plates\), le code a changé : « Main Street/);
  assert.match(text, /Capteur — Saccade/);
  assert.match(b.longMemory(), /Pas encore de décision/);
  const roles = b.status().roles;
  assert.deepEqual([roles.pensee.modeleLabel, roles.pensee.effortLabel, roles.relecture.modeleLabel], ['Équilibré', 'Bas', 'Maximal']);
});

test('switched off, he stops at once: the answer in flight is cut and kept for later, nothing new starts', { skip: !brain && 'SDK absent' }, async () => {
  const { default: Anthropic } = await import('../tools/architecte/node_modules/@anthropic-ai/sdk/index.mjs');
  const c = new Chantier(tmp());
  c.settings.allume = true;
  const memoire = new Memoire(c);
  const game = { connected: true, loadedAt: Date.now(), command: async () => ({ ok: true }), state: { architecte: { present: true, alive: true, spectating: false, mode: 'à pied', address: '7th Ave', x: 0, z: 0, y: 0, hp: 120 }, joueur: { state: 'à pied', distance: 8, health: 100 }, monde: { heure: '13:00', meteo: 'Dégagé', fps: 60 } } };
  const code = { state: () => ({ branche: 'main', head: '0479117', fichiers: [] }), staleSince: () => [], commits: [] };
  const b = new brain.Brain({ chantier: c, memoire, code, game, notify: () => {} });
  // the real SDK over a network that never answers until the request is aborted
  let requests = 0;
  const hang = (url, init) => { requests++; return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))); };
  b.client = new Anthropic({ apiKey: 'test', fetch: hang, maxRetries: 0 });
  b.hear('Tu fais quoi ?', 'salle');
  const answer = b.converse().catch((e) => b.fail(e, 'parole'));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(requests, 1);
  assert.equal(b.talking, true);
  b.setPaused(true, 'éteint');
  b.halt();
  await answer;
  assert.equal(b.talking, false);
  assert.equal(b.talkQueue.length, 1, 'the message waits for him');
  assert.match(c.recent(5).map((e) => e.text).join('\n'), /Réponse coupée : il est éteint/);
  await b.think('evenements');
  b.heartbeat();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(requests, 1, 'no thought and no answer while he is off');
});
