// The active session belongs in the same list as completed ones. A final record wins while the last live event
// still exists, so receiving `session` before the final `atelier` event never creates a duplicate or a stale row.
function sessionList(completed = [], current = null, now = Date.now()) {
  const sessions = new Map(completed.filter(s => s?.id).map(s => [s.id, { ...s, active: false }]));
  if (current?.session && !sessions.has(current.session)) sessions.set(current.session, {
    id: current.session, ticket: current.id, titre: current.titre, debut: current.depuis,
    duree: Math.max(0, (now - current.depuis) / 1000), issue: 'en_cours', active: true,
    cout: current.cout, tests: current.tests, fichiers: (current.fichiers || []).map(path => ({ path })),
    phase: current.phase, derniere: current.derniere, outils: current.outils
  });
  return [...sessions.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.debut - a.debut);
}

function sessionCommands(id, port = '7780') {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || '')) return null;
  if (!/^\d+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535) return null;
  const suffix = Number(port) === 7780 ? '' : ` --url http://127.0.0.1:${Number(port)}`;
  return { suivre: `node tools/architecte/suivre-session.mjs ${id}${suffix}`, reprendre: `claude --resume ${id}` };
}

// A missing observation is not evidence that no code changed. Older interrupted records did not retain a diff.
function sessionFileReview(session) {
  if (session.active) return { state: 'en_cours', known: true, empty: 'Pas encore de modification observée.' };
  const state = session.releve?.etat || (session.attribution?.conflits?.some(s => /relevé.*indisponible/i.test(s)) || session.issue === 'arrete' && !session.fichiers?.length ? 'indisponible' : 'complet');
  return { state, known: state !== 'indisponible', empty: state === 'complet' ? 'Aucun fichier modifié.' : 'Le relevé des fichiers est indisponible ; cela ne signifie pas qu’aucun fichier n’a changé.' };
}

export { sessionList, sessionCommands, sessionFileReview };
