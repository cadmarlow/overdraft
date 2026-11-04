import { hasCreatorApproval } from './ticket-policy.mjs';

// The control room's ticket decisions. Dependencies are explicit so authority can be tested without a live model.
function createTicketActions({ chantier, atelier, brain, memoire, log, broadcast }) {
function decideTicket({ id, action, texte = '' }) {
  const t = chantier.tickets.get(id);
  if (!t) return { ok: false, erreur: 'ticket introuvable' };
  const why = String(texte).trim();
  // A repeated click while the approved session is running must not move it back to "valide" or replace its grant.
  if (action === 'valider' && atelier.current?.id === id && t.statut === 'atelier' && hasCreatorApproval(t)) return { ok: true };
  const words = { valider: 'validé', rejeter: 'rejeté', plus: 'demandé plus sur', atelier: 'renvoyé à l’atelier', rouvrir: 'rouvert' };
  if (action === 'valider') {
    chantier.updateTicket(id, { statut: 'valide' }, { qui: 'createur', texte: why ? `Validé : ${why}` : 'Validé.' });
    if (chantier.settings.atelier) atelier.enqueue(id);
  } else if (action === 'rejeter') {
    chantier.updateTicket(id, { statut: 'rejete' }, { qui: 'createur', texte: why ? `Rejeté : ${why}` : 'Rejeté.' });
    revokeWorkshop(id);
    if (!brain.ready) chantier.addNote(`Le Créateur a rejeté le ticket #${id} « ${t.titre} »${why ? ` : ${why}` : ' sans raison donnée'}.`, 'Créateur');
  } else if (action === 'plus') {
    chantier.updateTicket(id, { statut: 'plus' }, { qui: 'createur', texte: `Demande plus : ${why || 'précise et rephotographie.'}` });
    revokeWorkshop(id);
    brain.push('demande', `Le Créateur veut plus sur ton ticket #${id} (${t.titre}) : « ${why || 'précise et rephotographie'} ». Retourne à l’endroit exact (retourner_au_ticket), photographie, puis complète-le (completer_ticket).`);
  } else if (action === 'atelier') {
    const queued = queueApproved(id);
    if (!queued.ok) return queued;
  } else if (action === 'rouvrir') {
    // a closed ticket (rejected, or verified) back to the Creator's decision
    chantier.updateTicket(id, { statut: 'a_valider', verification: null }, { qui: 'createur', texte: why ? `Rouvert : ${why}` : 'Rouvert.' });
    revokeWorkshop(id);
  } else return { ok: false, erreur: 'action inconnue' };
  if (action !== 'plus') memoire.change('decision', `Le Créateur a ${words[action]} ton ticket #${id} « ${t.titre} »${why ? ` : « ${why} »` : ''}.`, { id, action });
  brain.learnFromDecision(chantier.tickets.get(id), action, why).catch((e) => log('systeme', `Goûts non mis à jour : ${e.message}`));
  log('createur', `Ticket #${id} : ${{ valider: 'validé', rejeter: 'rejeté', plus: 'plus demandé', atelier: 'envoyé à l’atelier', rouvrir: 'rouvert' }[action]}${why ? ` (« ${why} »)` : ''}`, { id });
  broadcast('ticket', chantier.tickets.get(id));
  return { ok: true };
}

function revokeWorkshop(id) {
  atelier.remove(id);
  if (atelier.current?.id === id) atelier.stopCurrent('Validation retirée par le Créateur.');
}

function queueApproved(id) {
  const t = chantier.tickets.get(id);
  if (!hasCreatorApproval(t) || !['valide', 'atelier', 'corrige', 'echec'].includes(t?.statut)) {
    return { ok: false, texte: 'Valide d’abord ce ticket : aucune correction ne part sans ta validation.' };
  }
  if (['corrige', 'echec'].includes(t.statut)) chantier.updateTicket(id, { statut: 'valide', verification: null }, { qui: 'createur', texte: 'Validé pour reprise par l’atelier.' });
  const queued = atelier.enqueue(id);
  return { ok: queued || atelier.current?.id === id || atelier.queue.includes(id) };
}

function workshopCommand({ action, id }) {
  if (action === 'arreter') return { ok: atelier.stopCurrent() };
  if (action === 'retirer') atelier.remove(id);
  else if (action === 'monter') atelier.move(id, -1);
  else if (action === 'descendre') atelier.move(id, 1);
  else if (action === 'lancer') return queueApproved(id);
  else return { ok: false, erreur: 'action inconnue' };
  return { ok: true };
}

  return { decideTicket, workshopCommand, queueApproved };
}

export { createTicketActions };
