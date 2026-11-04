import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Chantier } from '../tools/architecte/chantier.mjs';
import { Atelier } from '../tools/architecte/atelier.mjs';
import { hasCreatorApproval } from '../tools/architecte/ticket-policy.mjs';
import { createTicketActions } from '../tools/architecte/ticket-actions.mjs';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecte-decisions-'));
  const chantier = new Chantier(root);
  chantier.settings.atelier = false;
  const atelier = new Atelier({ root, chantier, code: null, notify() {}, log() {} });
  const brain = { ready: false, push() {}, async learnFromDecision() {} };
  const actions = createTicketActions({ chantier, atelier, brain, memoire: { change() {} }, log() {}, broadcast() {} });
  const ticket = chantier.createTicket({ titre: 'Défaut témoin', categorie: 'bug', photos: [] });
  t.after(async () => { await atelier.stop(); chantier.save(); fs.rmSync(root, { recursive: true, force: true }); });
  return { chantier, atelier, ticket, ...actions };
}

test('both control-room launch routes require approval, including legacy statuses', (t) => {
  const { atelier, ticket, decideTicket, workshopCommand } = setup(t);
  assert.equal(decideTicket({ id: ticket.id, action: 'atelier' }).ok, false);
  ticket.statut = 'valide'; // an old server could set this without a human
  assert.equal(workshopCommand({ id: ticket.id, action: 'lancer' }).ok, false);
  assert.deepEqual(atelier.queue, []);
});

test('a human decision enables manual launch, and rejecting removes the queued work', (t) => {
  const { chantier, atelier, ticket, decideTicket, workshopCommand } = setup(t);
  assert.equal(decideTicket({ id: ticket.id, action: 'valider' }).ok, true);
  assert.equal(hasCreatorApproval(ticket), true);
  assert.equal(workshopCommand({ id: ticket.id, action: 'lancer' }).ok, true);
  assert.deepEqual(atelier.queue, [ticket.id]);
  assert.equal(decideTicket({ id: ticket.id, action: 'rejeter' }).ok, true);
  assert.equal(ticket.statut, 'rejete');
  assert.deepEqual(atelier.queue, []);
  assert.equal(chantier.tickets.get(ticket.id).validation, null);
});

test('withdrawing approval interrupts active work and cannot be undone by a late delivery', (t) => {
  const { chantier, atelier, ticket, decideTicket } = setup(t);
  decideTicket({ id: ticket.id, action: 'valider' });
  chantier.updateTicket(ticket.id, { statut: 'atelier' }, { qui: 'atelier', texte: 'En cours.' });
  let stopped = 0;
  atelier.current = ticket;
  atelier.stopCurrent = () => { stopped++; return true; };
  decideTicket({ id: ticket.id, action: 'plus', texte: 'Il manque une preuve.' });
  assert.equal(stopped, 1);
  assert.equal(ticket.statut, 'plus');
  assert.throws(() => chantier.updateTicket(ticket.id, { statut: 'corrige' }, { qui: 'atelier', texte: 'Trop tard.' }), /Transition refusée/);
  atelier.current = null;
});

test('a human retry of an approved correction re-enters the valid workflow', (t) => {
  const { chantier, atelier, ticket, decideTicket } = setup(t);
  decideTicket({ id: ticket.id, action: 'valider' });
  chantier.updateTicket(ticket.id, { statut: 'atelier' }, { qui: 'atelier', texte: 'En cours.' });
  chantier.updateTicket(ticket.id, { statut: 'corrige' }, { qui: 'atelier', texte: 'À vérifier.' });
  assert.equal(decideTicket({ id: ticket.id, action: 'atelier' }).ok, true);
  assert.equal(ticket.statut, 'valide');
  assert.deepEqual(atelier.queue, [ticket.id]);
});

test('revalidating active approved work preserves its authority and running status', (t) => {
  const { chantier, atelier, ticket, decideTicket } = setup(t);
  decideTicket({ id: ticket.id, action: 'valider' });
  chantier.updateTicket(ticket.id, { statut: 'atelier' }, { qui: 'atelier', texte: 'En cours.' });
  atelier.current = ticket;
  const approval = { ...ticket.validation };
  decideTicket({ id: ticket.id, action: 'valider' });
  assert.equal(ticket.statut, 'atelier');
  assert.deepEqual(ticket.validation, approval);
  atelier.current = null;
});

test('reapproval while rejected work is stopping queues a fresh attempt instead of losing the request', (t) => {
  const { chantier, atelier, ticket, decideTicket } = setup(t);
  decideTicket({ id: ticket.id, action: 'valider' });
  chantier.updateTicket(ticket.id, { statut: 'atelier' }, { qui: 'atelier', texte: 'En cours.' });
  atelier.current = ticket;
  decideTicket({ id: ticket.id, action: 'rejeter' });
  chantier.settings.atelier = true;
  decideTicket({ id: ticket.id, action: 'valider' });
  assert.equal(ticket.statut, 'valide');
  assert.deepEqual(atelier.queue, [ticket.id]);
  chantier.settings.atelier = false;
  atelier.current = null;
});
