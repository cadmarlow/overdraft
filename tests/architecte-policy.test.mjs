import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Chantier } from '../tools/architecte/chantier.mjs';
import { hasCreatorApproval, migrateValidation } from '../tools/architecte/ticket-policy.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecte-policy-'));
  const c = new Chantier(root);
  t.after(() => { c.save(); fs.rmSync(root, { recursive: true, force: true }); });
  return { c, root, ticket: c.createTicket({ titre: 'Défaut témoin', categorie: 'bug', photos: [] }) };
}

test('a model cannot grant itself human approval or send an unapproved ticket to the workshop', (test) => {
  const { c, ticket } = fixture(test);
  for (const statut of ['valide', 'atelier', 'corrige', 'verifie']) {
    assert.throws(() => c.updateTicket(ticket.id, { statut }, { qui: 'architecte', texte: 'Je décide.' }), /Transition refusée/);
  }
  assert.throws(() => c.updateTicket(ticket.id, { validation: { par: 'createur', t: Date.now() } }), /validation humaine/);
  assert.equal(ticket.statut, 'a_valider');
  assert.equal(hasCreatorApproval(ticket), false);
});

test('human approval survives a restart, and rejection revokes it before any retry', (test) => {
  const { c, root, ticket } = fixture(test);
  c.updateTicket(ticket.id, { statut: 'valide' }, { qui: 'createur', texte: 'Validé.' });
  assert.equal(hasCreatorApproval(new Chantier(root).tickets.get(ticket.id)), true);
  c.updateTicket(ticket.id, { statut: 'atelier' }, { qui: 'atelier', texte: 'Prise en charge.' });
  c.updateTicket(ticket.id, { statut: 'rejete' }, { qui: 'createur', texte: 'Rejeté : je change d’avis.' });
  assert.equal(hasCreatorApproval(ticket), false);
  assert.throws(() => c.updateTicket(ticket.id, { statut: 'corrige' }, { qui: 'atelier', texte: 'Livraison tardive.' }), /Transition refusée/);
  assert.throws(() => c.updateTicket(ticket.id, { statut: 'valide' }, { qui: 'architecte', texte: 'Toujours présent.' }), /Transition refusée/);
  assert.equal(new Chantier(root).tickets.get(ticket.id).statut, 'rejete');
});

test('legacy tickets need a real human validation in their history, rather than a trusted status', () => {
  assert.equal(migrateValidation({ statut: 'valide', fil: [] }), null);
  assert.equal(migrateValidation({ statut: 'atelier', fil: [{ qui: 'architecte', t: 1, texte: 'Validé.' }] }), null);
  const fil = [{ qui: 'createur', t: 10, texte: 'Validé : utile.' }];
  assert.equal(migrateValidation({ statut: 'corrige', fil }).par, 'createur');
  fil.push({ qui: 'createur', t: 20, texte: 'Rejeté : hors sujet.' });
  assert.equal(migrateValidation({ statut: 'valide', fil }), null);
  assert.equal(migrateValidation({ statut: 'valide', fil: fil.slice(0, 1), validation: null }), null);
});

test('verification requires a corrected, approved ticket with after photos and the final evidence stage', (test) => {
  const { c, ticket } = fixture(test);
  c.updateTicket(ticket.id, { statut: 'valide' }, { qui: 'createur', texte: 'Validé.' });
  c.updateTicket(ticket.id, { statut: 'atelier' }, { qui: 'atelier', texte: 'Correction.' });
  c.updateTicket(ticket.id, { statut: 'corrige', verification: { etape: 'retourner', depuis: Date.now() } }, { qui: 'atelier', texte: 'À vérifier.' });
  const close = () => c.updateTicket(ticket.id, { statut: 'verifie' }, { qui: 'architecte', texte: 'Corrigé.' });
  assert.throws(close, /Transition refusée/);
  ticket.verification.etape = 'conclure';
  assert.throws(close, /Transition refusée/);
  const shot = c.savePhoto('data:image/jpeg;base64,/9j/2Q==');
  c.addPhotos(ticket, [shot.id], 'apres');
  close();
  assert.equal(ticket.statut, 'verifie');
});

test('new photo and experiment identifiers are durable immediately and cannot be supplied by a record', (test) => {
  const { c, root } = fixture(test);
  const photo = c.savePhoto('data:image/jpeg;base64,/9j/2Q==');
  const exp = c.saveExperience({ id: '../wrong', t: 0, type: 'crash' });
  const restarted = new Chantier(root);
  assert.notEqual(restarted.savePhoto('data:image/jpeg;base64,/9j/2Q==').id, photo.id);
  assert.match(exp.id, /^e\d{4}$/);
  assert.ok(exp.t > 0);
  assert.notEqual(restarted.saveExperience({ type: 'crash' }).id, exp.id);
  restarted.save();
});
