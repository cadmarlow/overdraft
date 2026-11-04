import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionList, sessionCommands, sessionFileReview } from '../tools/architecte/salle/salle-sessions.js';
const id = 'f83dbe3f-a68c-4dd1-9c09-3db006598a0b';
const current = { id: '0003', session: id, titre: 'Éclairage', depuis: 1000, fichiers: ['js/light.js'], outils: 12, tests: { total: 3, pass: 3, fail: 0 } };
test('the first active coding session is visible even before history exists', () => {
  const list = sessionList([], current, 3500);
  assert.equal(list.length, 1); assert.equal(list[0].id, id); assert.equal(list[0].ticket, '0003');
  assert.equal(list[0].active, true); assert.equal(list[0].issue, 'en_cours'); assert.equal(list[0].duree, 2.5);
  assert.deepEqual(list[0].fichiers, [{ path: 'js/light.js' }]); assert.equal(list[0].tests.pass, 3);
});
test('a final result wins while the live state still mentions the same session', () => {
  const done = { id, ticket: '0003', debut: 1000, duree: 8, issue: 'corrige' };
  const during = sessionList([done], current, 9000), after = sessionList([done], null, 9000);
  assert.equal(during.length, 1); assert.equal(during[0].active, false); assert.deepEqual(during, after);
});
test('active and older sessions remain distinct, latest active first without mutating inputs', () => {
  const completed = [{ id: 'older', ticket: '0003', debut: 2000, issue: 'echec' }];
  const list = sessionList(completed, current, 3000);
  assert.deepEqual(list.map(s => s.id), [id, 'older']); assert.equal(completed[0].active, undefined);
  assert.deepEqual(current.fichiers, ['js/light.js']); assert.equal(sessionList().length, 0);
});
test('terminal commands distinguish read-only following and a later interactive resume', () => {
  const c = sessionCommands(id);
  assert.equal(c.suivre, `node tools/architecte/suivre-session.mjs ${id}`);
  assert.equal(c.reprendre, `claude --resume ${id}`);
  assert.match(sessionCommands(id, '7783').suivre, /--url http:\/\/127\.0\.0\.1:7783$/);
  for (const bad of ['--help', `${id}; touch /tmp/no`, '', null]) assert.equal(sessionCommands(bad), null);
  for (const bad of ['0', '65536', '7780; echo bad', 'localhost']) assert.equal(sessionCommands(id, bad), null);
});

test('an interrupted legacy session with no inventory never claims that no file changed', () => {
  const state = sessionFileReview({ issue: 'arrete', fichiers: [], attribution: { fiable: false, conflits: ['Relevé des changements indisponible.'] } });
  assert.equal(state.state, 'indisponible'); assert.equal(state.known, false);
  assert.match(state.empty, /ne signifie pas/); assert.notEqual(state.empty, 'Aucun fichier modifié.');
});

test('complete, partial and still active inventories have distinct meanings', () => {
  assert.equal(sessionFileReview({ issue: 'corrige', fichiers: [], releve: { etat: 'complet' } }).empty, 'Aucun fichier modifié.');
  assert.equal(sessionFileReview({ issue: 'arrete', fichiers: [{ path: 'js/car.js' }], releve: { etat: 'partiel' } }).state, 'partiel');
  assert.equal(sessionFileReview({ active: true }).state, 'en_cours');
});
