import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Chantier } from '../tools/architecte/chantier.mjs';

// The Architect's server keeps his work on disk; the brain needs the Anthropic SDK, installed on the server's first run
let brain = null;
try { brain = await import('../tools/architecte/brain.mjs'); } catch { /* SDK not installed yet: brain tests skipped */ }

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chantier-'));
const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

test('a fresh workshop has its folders, default settings, and the Creator’s first notes', () => {
  const root = tmp();
  const c = new Chantier(root);
  for (const d of ['tickets', 'photos', 'journal']) assert.ok(fs.existsSync(path.join(root, 'chantier', d)), d);
  assert.equal(c.settings.cerveau, 'equilibre');
  assert.equal(c.settings.plafond, 3);
  assert.ok(c.notes().some((n) => n.includes('boutiques')), 'his entrance exam is in his notebook');
});

test('a ticket keeps its photos, renders as Markdown, and its thread grows', () => {
  const root = tmp();
  const c = new Chantier(root);
  const p = c.savePhoto(JPEG, { x: 1, z: 2 });
  assert.match(p.id, /^p\d{5}$/);
  const t = c.createTicket({ titre: 'Vitrines plates, « années 90 »', categorie: 'art', gravite: 'haute', constat: 'Aplats.', piste: 'Verre.',
    photos: [p.id, 'p99999'], lieu: { x: 10, y: 0, z: 20, adresse: '7th Ave & W 46th St', lien: 'http://localhost:5173/?qa=1&at=10,0,20,0,0' }, version: '0.9.1' });
  assert.equal(t.id, '0001');
  assert.match(t.dir, /^0001-vitrines-plates-annees-90/);
  assert.deepEqual(t.photos, [p.id], 'a photo that does not exist is left out');
  assert.ok(fs.existsSync(path.join(c.ticketDir(t), `${p.id}.jpg`)));
  c.updateTicket(t.id, { statut: 'valide' }, { qui: 'createur', texte: 'Validé.' });
  const md = fs.readFileSync(path.join(c.ticketDir(t), 'ticket.md'), 'utf8');
  assert.match(md, /^# #0001 · Art · Gravité haute · Validé/);
  assert.match(md, /Voir dans le jeu : http:\/\/localhost:5173/);
  assert.match(md, /Créateur : Validé\./);
  // a second workshop on the same folder finds it again
  const again = new Chantier(root);
  assert.equal(again.tickets.get('0001').statut, 'valide');
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

test('photo ids are checked before any file is touched', () => {
  const c = new Chantier(tmp());
  assert.equal(c.photoFile('../etat'), null);
  assert.equal(c.photoFile('p1'), null);
});

test('his instructions list the places and his tools are well formed', { skip: !brain && 'SDK absent' }, () => {
  const prompt = brain.systemPrompt([{ id: 'timessq', label: 'Times Square', x: -581, z: -324 }]);
  assert.match(prompt, /timessq : Times Square \(x -581, z -324\)/);
  assert.match(prompt, /Créateur/);
  const names = new Set();
  for (const t of brain.TOOLS) {
    assert.match(t.name, /^[a-z_]+$/);
    assert.ok(!names.has(t.name), `${t.name} twice`);
    names.add(t.name);
    assert.equal(t.input_schema.type, 'object');
    for (const r of t.input_schema.required || []) assert.ok(t.input_schema.properties[r], `${t.name}.${r}`);
  }
  for (const n of ['aller_a', 'photographier', 'ouvrir_ticket', 'retourner_au_ticket', 'conclure_verification']) assert.ok(names.has(n), n);
});

test('the journal names what he did, with clean ticket numbers', { skip: !brain && 'SDK absent' }, () => {
  assert.equal(brain.summarize('completer_ticket', { id: '#1', commentaire: 'nuit' }), 'Complète le ticket #0001 : nuit');
  assert.equal(brain.summarize('dire', { texte: 'Bonsoir.' }), '« Bonsoir. »');
  assert.match(brain.summarize('aller_a', { lieu: 'timessq', moyen: 'helico', raison: 'voir' }), /^Part vers timessq en hélico : voir$/);
});
