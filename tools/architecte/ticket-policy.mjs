// Ticket authority is enforced by the server, independently of the model's instructions.
const REVOKES = /^(?:rejet[ée]|demande plus|rouvert)/i;
const APPROVES = /^valid[ée](?:$|\s|:|\.)/i;

function hasCreatorApproval(ticket) {
  const v = ticket?.validation;
  if (v?.par !== 'createur' || !Number.isFinite(v.t) || v.t <= 0) return false;
  if (['a_valider', 'plus', 'rejete'].includes(ticket.statut)) return false;
  return !(ticket.fil || []).some((entry) => entry.qui === 'createur' && entry.t > v.t && REVOKES.test(String(entry.texte || '')));
}

// Old tickets inherit authority only from an explicit human decision in their durable thread.
// A status alone (which an older model could set) never grants permission to edit the game.
function migrateValidation(ticket) {
  if (Object.hasOwn(ticket, 'validation')) return ticket.validation;
  let validation = null;
  for (const entry of [...(ticket.fil || [])].sort((a, b) => a.t - b.t)) {
    if (entry.qui !== 'createur') continue;
    const text = String(entry.texte || '');
    if (REVOKES.test(text)) validation = null;
    else if (APPROVES.test(text) && Number.isFinite(entry.t) && entry.t > 0) validation = { par: 'createur', t: entry.t, migree: true };
  }
  return ['a_valider', 'plus', 'rejete'].includes(ticket.statut) ? null : validation;
}

function canTransition(ticket, next, who) {
  if (who === 'createur') return ['valide', 'rejete', 'plus', 'a_valider'].includes(next);
  if (who === 'atelier') return hasCreatorApproval(ticket) && (
    (next === 'atelier' && ['valide', 'atelier'].includes(ticket.statut)) ||
    (['corrige', 'echec'].includes(next) && ticket.statut === 'atelier')
  );
  if (who !== 'architecte') return false;
  if (next === 'a_valider') return ['a_valider', 'plus'].includes(ticket.statut);
  if (ticket.statut !== 'corrige' || !hasCreatorApproval(ticket)) return false;
  if (next === 'valide') return true;
  return next === 'verifie' && ticket.verification?.etape === 'conclure' && ticket.apres?.length > 0;
}

export { canTransition, hasCreatorApproval, migrateValidation };
