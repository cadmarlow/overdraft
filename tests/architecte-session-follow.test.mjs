import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { followSession, normalizeSessionId, parseArgs, sessionView, updatesForSnapshot, validateLocalUrl, waitFor } from '../tools/architecte/suivre-session.mjs';

const ID = '4f9b0e22-b36c-4fe1-9ae5-4faf0be13421';
const OTHER = '35bd0763-c1d3-4ef6-b83f-38e2cc8162fb';
const since = 1730700000000;
const entry = (n, texte = `Étape ${n}`) => ({ t: since + n, texte, phase: 'corrige' });
function active(logs = [], phase = 'corrige') {
  return { atelier: { enCours: { id: '0003', titre: 'Le défaut du témoin', session: ID, depuis: since, phase } }, tickets: [{ id: '0003', titre: 'Le défaut du témoin', session: ID, atelierLog: logs, sessions: [] }], sessions: [] };
}
function finished(logs = [], issue = 'corrige') {
  return { ...active(logs), atelier: { enCours: null }, sessions: [{ id: ID, ticket: '0003', issue, debut: since, fin: since + 100 }] };
}
const response = (snapshot) => ({ ok: true, status: 200, json: async () => snapshot });

test('arguments accept complete UUIDs and loopback hosts only', () => {
  assert.equal(normalizeSessionId(ID.toUpperCase()), ID);
  assert.deepEqual(parseArgs([ID]), { sessionId: ID, url: 'http://127.0.0.1:7780' });
  assert.deepEqual(parseArgs([ID, '--url', 'http://localhost:7786/']), { sessionId: ID, url: 'http://localhost:7786' });
  assert.equal(validateLocalUrl('http://[::1]:7786'), 'http://[::1]:7786');
  assert.equal(parseArgs(['--help']).help, true);
  for (const value of ['', '1234', `${ID};touch /tmp/no`, `\n${ID}`, `${ID}\n`]) assert.throws(() => normalizeSessionId(value), /UUID/);
  for (const value of ['https://example.com', 'http://192.168.1.1:7780', 'file:///tmp/a', 'ftp://localhost', 'http://user@localhost:7780', 'http://localhost:7780/path', 'http://localhost:7780?x=1', 'http://localhost:7780/#x']) {
    assert.throws(() => validateLocalUrl(value), /refusée|invalide/);
  }
  for (const args of [[ID, '--bad'], [ID, '--url'], [ID, '--url', 'http://localhost', '--url', 'http://localhost'], [ID, OTHER]]) assert.throws(() => parseArgs(args));
});

test('an absent active session never establishes completion or prints a resume command', () => {
  const snapshot = { ...active([entry(1)]), atelier: { enCours: null } };
  const update = updatesForSnapshot({}, snapshot, ID);
  assert.equal(update.done, false);
  assert.equal(update.view.final, null);
  assert.equal(update.lines.some((line) => line.includes('claude --resume')), false);
});

test('repeated snapshots print each real log entry once and expose resume only at the end', () => {
  const one = updatesForSnapshot({}, active([entry(1)]), ID);
  const snapshotBefore = structuredClone(one.tracker);
  const repeat = updatesForSnapshot(one.tracker, active([entry(1)]), ID);
  assert.deepEqual(repeat.lines, []);
  assert.deepEqual(one.tracker, snapshotBefore, 'the previous tracking state stays immutable');
  const two = updatesForSnapshot(repeat.tracker, active([entry(1), entry(2)]), ID);
  assert.equal(two.lines.length, 1);
  assert.match(two.lines[0], /Étape 2/);
  assert.equal(two.lines.some((line) => line.includes('claude --resume')), false);
  const end = updatesForSnapshot(two.tracker, finished([entry(1), entry(2), entry(3)]), ID);
  assert.equal(end.done, true);
  assert.match(end.lines.join('\n'), /Session terminée : correction livrée/);
  assert.match(end.lines.join('\n'), new RegExp(`claude --resume ${ID}`));
  assert.deepEqual(updatesForSnapshot(end.tracker, finished([entry(1), entry(2), entry(3)]), ID).lines, []);
});

test('identical legitimate log entries retain their occurrence count across snapshots', () => {
  const duplicate = entry(1, 'Même étape répétée');
  const first = updatesForSnapshot({}, active([duplicate, duplicate]), ID);
  assert.equal(first.lines.filter((line) => line.includes('Même étape')).length, 2);
  assert.deepEqual(updatesForSnapshot(first.tracker, active([duplicate, duplicate]), ID).lines, []);
  const third = updatesForSnapshot(first.tracker, active([duplicate, duplicate, duplicate]), ID);
  assert.equal(third.lines.length, 1);
});

test('historical tracking excludes logs from a newer workshop session on the same ticket', () => {
  const snapshot = finished([{ ...entry(2), t: since + 2 }, { ...entry(3), t: since + 101 }]);
  snapshot.tickets[0].session = OTHER;
  snapshot.atelier.enCours = { id: '0003', session: OTHER, depuis: since + 101 };
  const view = sessionView(snapshot, ID);
  assert.equal(view.active, false);
  assert.equal(view.final.issue, 'corrige');
  assert.deepEqual(view.logs.map((item) => item.texte), ['Étape 2']);
});

test('ticket session history covers completed work absent from the short global history', () => {
  const snapshot = active([entry(1)]);
  snapshot.atelier.enCours = null;
  snapshot.tickets[0].sessions = [{ id: ID, ticket: '0003', issue: 'decision', fin: since + 10 }];
  const update = updatesForSnapshot({}, snapshot, ID);
  assert.equal(update.done, true);
  assert.match(update.lines.join('\n'), /décision du Créateur nécessaire/);
});

test('the poller reads only GET salle/etat and does not duplicate unchanged progress', async () => {
  const snapshots = [active([entry(1)]), active([entry(1)]), active([entry(1), entry(2)]), finished([entry(1), entry(2)])];
  const calls = [], delays = [], lines = [];
  const result = await followSession({ sessionId: ID }, {
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response(snapshots.shift()); },
    wait: async (ms) => { delays.push(ms); }, write: (line) => lines.push(line)
  });
  assert.equal(result.stopped, false);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(({ url, options }) => url === 'http://127.0.0.1:7780/salle/etat' && options.method === 'GET' && options.redirect === 'error'));
  assert.deepEqual(delays, [1000, 1000, 1000]);
  assert.equal(lines.filter((line) => line.includes('Étape 1')).length, 1);
  assert.equal(lines.filter((line) => line.includes('Étape 2')).length, 1);
  assert.equal(lines.filter((line) => line.includes('claude --resume')).length, 1);
});

test('a restarting server is retried with bounded backoff and its restored connection is reported', async () => {
  const events = [new Error('Local server restarting.'), new Error('Local server still restarting.'), active([entry(1)]), finished([entry(1)])];
  const lines = [], delays = [];
  const result = await followSession({ sessionId: ID }, {
    fetchImpl: async () => { const event = events.shift(); if (event instanceof Error) throw event; return response(event); },
    wait: async (ms) => delays.push(ms), write: (line) => lines.push(line)
  });
  assert.equal(result.stopped, false);
  assert.deepEqual(delays, [1000, 2000, 1000]);
  assert.equal(lines.filter((line) => line === 'Connexion au serveur rétablie.').length, 1);
  assert.equal(lines.filter((line) => line.includes('Étape 1')).length, 1);
});

test('persistent failures and missing routes produce readable errors instead of infinite retries', async () => {
  let calls = 0;
  await assert.rejects(followSession({ sessionId: ID, maxFailures: 3 }, {
    fetchImpl: async () => { calls++; throw new Error('Local restart.'); }, wait: async () => {}, write: () => {}
  }), /après 3 tentatives/);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(followSession({ sessionId: ID }, {
    fetchImpl: async () => { calls++; return { ok: false, status: 404 }; }, wait: async () => assert.fail('A missing route is not a transient restart.'), write: () => {}
  }), /HTTP 404/);
  assert.equal(calls, 1);
});

test('Ctrl-C semantics stop only the poller without posting or showing a premature resume command', async () => {
  const controller = new AbortController(), lines = [], calls = [];
  const result = await followSession({ sessionId: ID }, {
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response(active([entry(1)])); },
    wait: async () => { controller.abort(); throw new DOMException('Interrupted fixture.', 'AbortError'); },
    write: (line) => lines.push(line), signal: controller.signal
  });
  assert.equal(result.stopped, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(lines.some((line) => line.includes('claude --resume')), false);
  assert.match(lines.at(-1), /n’a reçu aucun ordre/);
});

test('the local wait is aborted promptly and importing the module performs no polling', async () => {
  const controller = new AbortController();
  const pending = waitFor(30_000, controller.signal); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  const moduleUrl = new URL('../tools/architecte/suivre-session.mjs', import.meta.url).href;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `globalThis.fetch=()=>{throw new Error('Unexpected network');};await import(${JSON.stringify(moduleUrl)});console.log('import sans suivi');`], { encoding: 'utf8' });
  assert.equal(output.trim(), 'import sans suivi');
});

test('the CLI works through its /tmp path, with help and invalid UUIDs making no requests', () => {
  const file = fileURLToPath(new URL('../tools/architecte/suivre-session.mjs', import.meta.url)).replace(/^\/private\/tmp\//, '/tmp/');
  const help = spawnSync(process.execPath, [file, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /Usage/);
  const invalid = spawnSync(process.execPath, [file, 'not-a-session'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /UUID complet/);
});

test('the real CLI handles SIGINT while polling a disposable HTTP server', { skip: process.env.ARCHITECTE_FOLLOW_HTTP_TEST !== '1' && 'Essai HTTP isolé désactivé' }, async (t) => {
  const requests = [];
  let firstRead;
  const read = new Promise((resolve) => { firstRead = resolve; });
  const server = http.createServer((request, reply) => {
    requests.push({ method: request.method, url: request.url });
    reply.writeHead(200, { 'Content-Type': 'application/json' }); reply.end(JSON.stringify(active([entry(1)])));
    firstRead();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const file = fileURLToPath(new URL('../tools/architecte/suivre-session.mjs', import.meta.url));
  child = spawn(process.execPath, [file, ID, '--url', `http://127.0.0.1:${server.address().port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { errors += chunk; });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  let timer;
  try {
    await Promise.race([read, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('The disposable CLI made no request.')), 2000); })]);
    clearTimeout(timer);
    child.kill('SIGINT');
    const result = await Promise.race([closed, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('SIGINT did not stop the follower.')), 2000); })]);
    assert.deepEqual(result, { code: 0, signal: null });
    assert.equal(errors, '');
    assert.match(output, /Suivi arrêté/);
    assert.equal(output.includes('claude --resume'), false);
    assert.ok(requests.length >= 1);
    assert.ok(requests.every((request) => request.method === 'GET' && request.url === '/salle/etat'));
    assert.equal(server.listening, true, 'Ctrl-C did not send a stop command to the service');
  } finally { clearTimeout(timer); }
});
