import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Code, inspectWritePath } from '../tools/architecte/code.mjs';
import { fileURLToPath } from 'node:url';
import { Atelier, acceptableTests, validDelivery, fullTestCommand } from '../tools/architecte/atelier.mjs';

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architecte-reliability-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Workshop fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  git('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(root, 'js'));
  fs.writeFileSync(path.join(root, '.gitignore'), 'chantier/\n');
  fs.writeFileSync(path.join(root, 'js/car.js'), 'const speed = 1;\n');
  fs.writeFileSync(path.join(root, 'js/creator.js'), 'const taste = 1;\n');
  git('add', '.'); git('commit', '-q', '-m', 'Fixture baseline');
  return { root, git, code: new Code({ root }) };
}

const DELIVERY = {
  compte_rendu: 'La voiture suit le réglage demandé.', resume: 'Vitesse corrigée.', fichiers: ['js/car.js'],
  verifier: { lien: 'http://localhost:5173/?qa=1', etapes: 'Conduire dans la rue témoin.', attendu: 'La voiture reste stable.' },
  non_verifie: '', decision_requise: false
};
const PASS = 'ℹ tests 3\nℹ pass 3\nℹ fail 0\nℹ cancelled 0\n';
const FAIL = 'ℹ tests 3\nℹ pass 0\nℹ fail 3\n';
const XCODE = '✖ tree generator filters and deduplicates locations, and signed deltas round trip\ntest at tests/tree-geodata.test.cjs:54:1\nYou have not agreed to the Xcode license agreements.\nℹ tests 424\nℹ pass 423\nℹ fail 1\n';

function workshop(t, script, options = {}) {
  const repo = repository(t), { root, code } = repo;
  const ticket = { id: '0001', titre: 'Voiture instable', statut: 'valide', categorie: 'bug', photos: [], apres: [], fil: [], sessions: [], validation: { par: 'createur', t: Date.now() } };
  const dir = path.join(root, 'chantier'); fs.mkdirSync(dir);
  const signals = [], emitted = [];
  let child, scriptError = null, spawnCount = 0;
  const chantier = {
    dir, settings: { atelier: false }, tickets: new Map([[ticket.id, ticket]]), ticketDir: () => dir,
    markdown: () => '# Ticket de test', listTickets: () => [ticket],
    updateTicket: (_id, patch, note) => { Object.assign(ticket, patch); if (note) ticket.fil.push({ t: Date.now(), ...note }); return ticket; }
  };
  const processTools = {
    list: async () => [],
    kill: (pid, signal) => { signals.push({ pid, signal }); },
    spawn: () => {
      spawnCount++;
      child = new EventEmitter(); child.pid = 987654;
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = (signal) => signals.push({ pid: child.pid, signal });
      setImmediate(async () => {
        try { await script(api); } catch (e) { scriptError = e; child.emit('close', 1); }
      });
      return child;
    }
  };
  const atelier = new Atelier({ root, chantier, code, notify: (kind, data) => emitted.push({ kind, data }), log() {}, processTools, killGraceMs: 15, timeLimitMs: 1000, ...options });
  let serial = 0;
  const emit = (event) => child.stdout.emit('data', JSON.stringify(event) + '\n');
  const api = {
    ...repo, atelier, ticket,
    write(file = 'js/car.js', text = 'const speed = 2;\n', canonical = false) {
      const id = `w${++serial}`, absolute = canonical ? fs.realpathSync(path.join(root, file)) : path.join(root, file);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Write', input: { file_path: absolute, content: text } }] } });
      fs.writeFileSync(absolute, text);
      emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
    },
    async tests(text = PASS, is_error = false) {
      const id = `t${++serial}`;
      emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'npm test' } }] } });
      await atelier.live.evidence;
      emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error }] } });
      await atelier.live.evidence;
    },
    finish({ delivery = DELIVERY, exit = 0 } = {}) {
      emit({ type: 'result', is_error: false, result: 'Terminé.', ...(delivery ? { structured_output: delivery } : {}) });
      child.emit('close', exit);
    },
    attemptWrite(file, tool = 'Write') {
      emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `blocked${++serial}`, name: tool, input: { file_path: file, content: 'This must never be written.' } }] } });
    }
  };
  return { ...api, signals, emitted, chantier, spawnCount: () => spawnCount, check: () => { if (scriptError) throw scriptError; } };
}

test('an approved, traced correction is accepted only after a complete test of the final disk state', async (t) => {
  const h = workshop(t, async (a) => { a.write(); await a.tests(); a.finish(); });
  assert.equal(await h.atelier.run(h.ticket), true); h.check();
  assert.equal(h.ticket.statut, 'corrige');
  assert.equal(h.ticket.sessions[0].attribution.fiable, true);
  assert.deepEqual(h.ticket.livraison.fichiers, ['js/car.js']);
  assert.equal(h.atelier.current, null);
});

test('a canonical macOS temporary path is the same in-project file as its logical spelling', async (t) => {
  const h = workshop(t, async (a) => { a.write('js/car.js', 'const speed = 2;\n', true); await a.tests(); a.finish(); });
  assert.equal(await h.atelier.run(h.ticket), true); h.check();
  assert.deepEqual(h.ticket.livraison.fichiers, ['js/car.js']);
});

test('a model success with failing tests, a missing delivery, or a failed process is never a correction', async (t) => {
  for (const scenario of ['tests', 'delivery', 'exit']) {
    const h = workshop(t, async (a) => {
      a.write(); await a.tests(scenario === 'tests' ? FAIL : PASS, scenario === 'tests');
      a.finish({ delivery: scenario === 'delivery' ? null : DELIVERY, exit: scenario === 'exit' ? 1 : 0 });
    });
    assert.equal(await h.atelier.run(h.ticket), false, scenario); h.check();
    assert.equal(h.ticket.statut, 'echec', scenario);
    assert.equal(h.ticket.livraison, null, scenario);
  }
});

test('only the precisely identified tree-geodata Xcode failure is tolerated', async (t) => {
  assert.equal(acceptableTests({ parsed: { total: 424, pass: 423, fail: 1 }, text: XCODE, error: true }), true);
  assert.equal(acceptableTests({ parsed: { total: 424, pass: 423, fail: 1 }, text: 'tree-geodata\nXcode', error: true }), false);
  assert.equal(acceptableTests({ parsed: { total: 424, pass: 422, fail: 2 }, text: XCODE, error: true }), false);
  const h = workshop(t, async (a) => { a.write(); await a.tests(XCODE, true); a.finish(); });
  assert.equal(await h.atelier.run(h.ticket), true); h.check();
});

test('a test before the last Edit does not prove the correction', async (t) => {
  const h = workshop(t, async (a) => { await a.tests(); a.write(); a.finish(); });
  assert.equal(await h.atelier.run(h.ticket), false); h.check();
  assert.match(h.ticket.sessions[0].raison, /dernière modification du disque/);
});

test('a delivery without a test result cannot be accepted', async (t) => {
  const h = workshop(t, async (a) => { a.write(); a.finish(); });
  assert.equal(await h.atelier.run(h.ticket), false); h.check();
  assert.match(h.ticket.sessions[0].raison, /npm test complet/);
});

test('a disk edit without an Edit event after the test invalidates both its evidence and attribution', async (t) => {
  const h = workshop(t, async (a) => {
    a.write(); await a.tests();
    fs.writeFileSync(path.join(a.root, 'js/creator.js'), 'const taste = 2;\n');
    a.finish();
  });
  assert.equal(await h.atelier.run(h.ticket), false); h.check();
  assert.equal(h.ticket.sessions[0].attribution.fiable, false);
  assert.match(h.ticket.sessions[0].raison, /js\/creator.js.*ambiguë/);
  assert.match(h.ticket.sessions[0].raison, /dernière modification du disque/);
  assert.equal(fs.readFileSync(path.join(h.root, 'js/creator.js'), 'utf8'), 'const taste = 2;\n', 'the Creator’s work is never reverted');
});

test('a concurrent edit of a traced file between tool calls is detected', async (t) => {
  const h = workshop(t, async (a) => {
    a.write(); fs.writeFileSync(path.join(a.root, 'js/car.js'), 'const creator = true;\n');
    a.write('js/car.js', 'const speed = 3;\n'); await a.tests(); a.finish();
  });
  assert.equal(await h.atelier.run(h.ticket), false); h.check();
  assert.match(h.ticket.sessions[0].raison, /écriture concurrente/);
});

test('a commit during the session remains visible in its diff and blocks attribution', async (t) => {
  const h = workshop(t, async (a) => {
    a.write(); a.git('add', '.'); a.git('commit', '-q', '-m', 'Concurrent human commit');
    await a.tests(); a.finish();
  });
  assert.equal(await h.atelier.run(h.ticket), false); h.check();
  const record = h.ticket.sessions[0];
  assert.match(record.raison, /HEAD ou branche/);
  assert.deepEqual(record.fichiers.map((f) => f.path), ['js/car.js']);
});

test('no validated status alone can authorize enqueue, next, or a direct run', async (t) => {
  const h = workshop(t, async () => { throw new Error('must not spawn'); });
  h.ticket.validation = null;
  assert.equal(h.atelier.enqueue(h.ticket.id), false);
  assert.equal(await h.atelier.run(h.ticket), false);
  h.atelier.queue.push(h.ticket.id); h.chantier.settings.atelier = true; h.atelier.next();
  assert.equal(h.spawnCount(), 0);
  assert.equal(h.ticket.statut, 'valide');
});

test('withdrawing approval while a session finishes preserves the Creator’s rejection and its session record', async (t) => {
  const h = workshop(t, async (a) => {
    a.write(); await a.tests(); a.ticket.statut = 'rejete'; a.ticket.validation = null; a.finish();
  });
  assert.equal(await h.atelier.run(h.ticket), false); h.check();
  assert.equal(h.ticket.statut, 'rejete');
  assert.equal(h.ticket.sessions.length, 1);
  assert.match(h.ticket.sessions[0].raison, /validation du Créateur/);
});

test('a forbidden server edit cannot produce an accepted delivery', async (t) => {
  const h = workshop(t, async (a) => { a.write('tools/architecte/brain.mjs', 'export {};\n'); await a.tests(); a.finish(); });
  assert.equal(await h.atelier.run(h.ticket), false); h.check();
  assert.match(h.ticket.sessions[0].raison, /périmètre autorisé/);
});

test('stop waits for cleanup and escalates independently of a child that never closes', async (t) => {
  const h = workshop(t, async () => {});
  const running = h.atelier.run(h.ticket);
  while (!h.atelier.child) await new Promise((r) => setImmediate(r));
  await h.atelier.stop();
  assert.equal(await running, false);
  assert.ok(h.signals.some((s) => s.signal === 'SIGTERM'));
  assert.ok(h.signals.some((s) => s.signal === 'SIGKILL'));
  assert.equal(h.ticket.sessions[0].issue, 'arrete');
  assert.equal(h.atelier.current, null);
});

test('the deadline also escalates when SIGTERM is ignored', async (t) => {
  const h = workshop(t, async () => {}, { timeLimitMs: 10 });
  // Preparation has its own cancellation test; this case starts the child before testing its ignored SIGTERM.
  const prepared = await h.code.snapshot(path.join(h.root, 'chantier/prepared'));
  h.code.snapshot = async () => prepared;
  assert.equal(await h.atelier.run(h.ticket), false);
  assert.match(h.ticket.sessions[0].raison, /Temps dépassé/);
  assert.ok(h.signals.some((s) => s.signal === 'SIGKILL'));
});

test('stop during preparation waits for its record and prevents the process from spawning', async (t) => {
  const h = workshop(t, async () => { throw new Error('must not spawn'); });
  const snapshot = h.code.snapshot.bind(h.code);
  let release;
  h.code.snapshot = async (...args) => { await new Promise((r) => { release = r; }); return snapshot(...args); };
  const running = h.atelier.run(h.ticket);
  const stopped = h.atelier.stop();
  release(); await stopped;
  assert.equal(await running, false);
  assert.equal(h.spawnCount(), 0);
  assert.equal(h.ticket.sessions[0].issue, 'arrete');
});

test('failure to prove process cleanup blocks an otherwise valid delivery', async (t) => {
  const h = workshop(t, async (a) => { a.write(); await a.tests(); a.finish(); });
  h.atelier.processTools.list = async () => { throw new Error('fixture process table unavailable'); };
  assert.equal(await h.atelier.run(h.ticket), false); h.check();
  assert.match(h.ticket.sessions[0].raison, /nettoyage des processus/);
});

test('snapshot failures leave a durable failure and release the workshop slot', async (t) => {
  const h = workshop(t, async () => { throw new Error('must not spawn'); });
  h.code.snapshot = async () => { throw new Error('fixture snapshot unavailable'); };
  assert.equal(await h.atelier.run(h.ticket), false);
  assert.equal(h.spawnCount(), 0);
  assert.equal(h.ticket.statut, 'echec');
  assert.equal(h.ticket.sessions.length, 1);
  assert.equal(h.atelier.current, null);
});

test('a committed binary baseline is copied byte for byte rather than decoded as UTF-8', async (t) => {
  const { root, git, code } = repository(t);
  const original = Buffer.from([0xff, 0x00, 0x80, 0xc3, 0x28, 0xfe]);
  fs.writeFileSync(path.join(root, 'fixture.bin'), original); git('add', '.'); git('commit', '-q', '-m', 'Binary fixture');
  const dir = path.join(root, 'chantier', 'session');
  const snap = await code.snapshot(dir);
  const file = await code.contentBefore(dir, snap, 'fixture.bin');
  assert.deepEqual(fs.readFileSync(file), original);
});

test('delivery validation rejects a plain answer, incomplete steps and paths outside the project', () => {
  assert.equal(validDelivery(null), false);
  assert.equal(validDelivery({ ...DELIVERY, verifier: { ...DELIVERY.verifier, attendu: '' } }), false);
  assert.equal(validDelivery({ ...DELIVERY, fichiers: ['../other.js'] }), false);
  assert.equal(validDelivery(DELIVERY), true);
});

test('full-suite evidence recognizes safe compound commands without accepting echoed, masked or filtered tests', () => {
  for (const command of ['npm test', 'npm run test', 'node --check js/car.js && npm test', 'node -e "console.log(1)" && npm test', 'ls; npm test', 'npm test && git diff', 'npm test > /tmp/results.log 2>&1']) {
    assert.equal(fullTestCommand(command), true, command);
  }
  for (const command of ['echo npm test', 'echo "npm test"', 'node -e "console.log(\'x; npm test\')"', 'true || npm test', 'npm test || true', 'npm test; true', 'npm test | cat', 'npm test &', 'npm test -- --test-name-pattern=car', 'npm test -- --only', 'npm test -- --pattern=car', 'npm test -- --grep=car', '. /tmp/functions.sh && npm test', 'source /tmp/functions.sh && npm test', 'alias npm="echo false" && npm test', 'PATH=/tmp/fake; npm test', 'cd /tmp && npm test']) {
    assert.equal(fullTestCommand(command), false, command);
  }
});

test('a wrapper may change to the project root but cannot prove tests run in another repository', (t) => {
  const { root } = repository(t);
  assert.equal(fullTestCommand(`cd ${fs.realpathSync(root)} && npm test`, root), true);
  assert.equal(fullTestCommand('cd /tmp && npm test', root), false);
});

test('a shell function cannot impersonate npm and print a false green test report', () => {
  const command = "npm() { printf '# tests 3\\n# pass 3\\n# fail 0\\n'; }; npm test";
  const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' });
  assert.equal(result.status, 0, 'the imitation really exits successfully without running the suite');
  assert.match(result.stdout, /# pass 3/);
  assert.equal(fullTestCommand(command), false);
});

test('private files never enter the code diff exposed to the control room', async (t) => {
  const { root, code } = repository(t);
  fs.writeFileSync(path.join(root, '.env'), 'FIXTURE_KEY=FAKE_ONLY_ENV_SECRET\n');
  await code.poll();
  assert.equal(await code.diffNow('.env'), '');
  assert.equal(code.hashes.get('.env'), 'private', 'the watcher records protection without hashing private contents');
});

test('symlink diffs cannot reveal files outside the project, even when the target is missing', async (t) => {
  const { root, code } = repository(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'architecte-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'fixture.txt'), 'FAKE_ONLY_OUTSIDE_VALUE\n');
  fs.symlinkSync(path.join(outside, 'fixture.txt'), path.join(root, 'js/link.js'));
  fs.symlinkSync(path.join(outside, 'missing.txt'), path.join(root, 'js/dangling.js'));
  fs.symlinkSync(outside, path.join(root, 'linked-directory'));
  await code.poll();
  assert.equal(await code.diffNow('js/link.js'), '');
  assert.ok(code.capturePath('js/dangling.js').error, 'a dangling symlink is not a deleted regular file');
  assert.ok(code.capturePath('linked-directory/new.js').error, 'new files under a linked directory are outside the project');
});

test('a file already deleted before a session has an absent baseline when it is recreated', async (t) => {
  const { root, code } = repository(t);
  fs.unlinkSync(path.join(root, 'js/car.js'));
  const dir = path.join(root, 'chantier/session'), snap = await code.snapshot(dir);
  const trace = { before: code.capturePath('js/car.js') };
  fs.writeFileSync(path.join(root, 'js/car.js'), 'const speed = 1;\n');
  trace.after = code.capturePath('js/car.js');
  const changes = await code.sessionChanges(dir, snap, { traces: [trace] });
  assert.equal(changes.audit.fiable, true);
  assert.deepEqual(changes.map((f) => [f.path, f.statut, f.plus, f.moins]), [['js/car.js', 'nouveau', 1, 0]]);
});

test('an indexed rename retains the deleted source path as well as its destination', async (t) => {
  const { git, code } = repository(t);
  git('mv', 'js/car.js', 'js/renamed.js');
  await code.poll();
  assert.deepEqual(code.files.map((f) => f.path).sort(), ['js/car.js', 'js/renamed.js']);
  assert.equal(code.hashes.get('js/car.js'), 'deleted');
});

test('changing an ignored private configuration invalidates attribution without reading its contents', async (t) => {
  const { root, git, code } = repository(t);
  fs.appendFileSync(path.join(root, '.gitignore'), '.env.local\n');
  git('add', '.'); git('commit', '-q', '-m', 'Ignore private fixture configuration');
  fs.writeFileSync(path.join(root, '.env.local'), 'FAKE_ONLY_KEY=before\n');
  const dir = path.join(root, 'chantier/session'), snap = await code.snapshot(dir);
  fs.writeFileSync(path.join(root, '.env.local'), 'FAKE_ONLY_KEY=after-change\n');
  const changes = await code.sessionChanges(dir, snap, { traces: [] });
  assert.equal(changes.audit.fiable, false);
  assert.match(changes.audit.conflits.join(' '), /fichier privé/);
  assert.equal(fs.readFileSync(path.join(dir, 'diff.patch'), 'utf8'), '');
});

test('stop is bounded even if preparing the code snapshot never settles', async (t) => {
  const h = workshop(t, async () => { throw new Error('must not spawn'); });
  h.code.snapshot = () => new Promise(() => {});
  const running = h.atelier.run(h.ticket);
  const outcome = await Promise.race([h.atelier.stop().then(() => 'stopped'), new Promise((r) => setTimeout(() => r('blocked'), 200))]);
  assert.equal(outcome, 'stopped');
  assert.equal(await running, false);
  assert.equal(h.spawnCount(), 0);
  assert.equal(h.ticket.sessions[0].issue, 'arrete');
});

test('an external memory attempt stops the model but preserves the real code diff and precise refusal', async (t) => {
  const outside = path.join(os.tmpdir(), '.claude/projects/workshop-fixture/memory/night-character-lighting.md');
  const h = workshop(t, async (a) => { a.write(); await a.tests(); a.attemptWrite(outside); a.atelier.stopCurrent('Arrêt secondaire.'); a.finish(); });
  assert.equal(await h.atelier.run(h.ticket), false); h.check();
  const s = h.ticket.sessions[0];
  assert.equal(s.issue, 'arrete');
  assert.equal(s.refus.outil, 'Write');
  assert.equal(s.refus.fichier, outside);
  assert.match(s.refus.motif, /Mémoire extérieure en lecture seule/);
  assert.ok(s.raison.includes(outside));
  assert.equal(s.releve.etat, 'complet', 'the after-stop audit is independent of the aborted model signal');
  assert.equal(s.attribution.fiable, false, 'a stopped session never becomes an accepted correction');
  assert.deepEqual(s.fichiers.map((f) => f.path), ['js/car.js']);
  assert.match(fs.readFileSync(path.join(h.chantier.dir, 'atelier', s.id, 'diff.patch'), 'utf8'), /\+const speed = 2;/);
  assert.doesNotMatch(s.raison, /Aucune correction|Aucune variation/);
  assert.match(s.resume, /Travail interrompu/);
  assert.equal(h.ticket.statut, 'echec');
});

test('a bounded audit preserves progress if collecting the remaining files stalls', async (t) => {
  const h = workshop(t, async (a) => { a.write(); await a.tests(); a.finish(); }, { auditTimeoutMs: 15 });
  h.code.sessionChanges = async (_dir, _snap, { signal, onProgress }) => {
    onProgress({ fichiers: [{ path: 'js/car.js', statut: 'modifié', plus: 1, moins: 1 }], patch: 'diff --git a/js/car.js b/js/car.js\n+const speed = 2;\n', conflits: [], examines: 1, total: 2 });
    await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  assert.equal(await h.atelier.run(h.ticket), false); h.check();
  const s = h.ticket.sessions[0];
  assert.equal(s.releve.etat, 'partiel');
  assert.deepEqual(s.fichiers.map((f) => f.path), ['js/car.js']);
  assert.match(fs.readFileSync(path.join(h.chantier.dir, 'atelier', s.id, 'diff.patch'), 'utf8'), /\+const speed = 2;/);
  assert.equal(s.attribution.fiable, false);
});

test('stopping during the final disk checkpoint also invalidates attribution without losing the diff', async (t) => {
  const h = workshop(t, async (a) => { a.write(); await a.tests(); a.finish(); });
  const checkpoint = h.code.checkpoint.bind(h.code);
  let count = 0;
  h.code.checkpoint = (options) => {
    if (++count === 3) h.atelier.stopCurrent('Arrêt pendant le contrôle final.');
    return checkpoint(options);
  };
  assert.equal(await h.atelier.run(h.ticket), false); h.check();
  const s = h.ticket.sessions[0];
  assert.equal(s.issue, 'arrete');
  assert.equal(s.attribution.fiable, false);
  assert.deepEqual(s.fichiers.map((f) => f.path), ['js/car.js']);
  assert.match(s.raison, /Arrêt pendant le contrôle final/);
});

test('workshop memory is read-only and disabled in child-only settings, with a pre-tool write guard', (t) => {
  const h = workshop(t, async () => {});
  const settings = h.atelier.childSettings(h.ticket);
  assert.equal(settings.autoMemoryEnabled, false);
  assert.equal(settings.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  assert.match(h.atelier.prompt(h.ticket), /mémoires extérieures sont en lecture seule/);
  assert.match(settings.hooks.PreToolUse[0].matcher, /Write/);
  const guard = settings.hooks.PreToolUse[0].hooks[0].command;
  const blocked = spawnSync('/bin/sh', ['-c', guard], { encoding: 'utf8', input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/tmp/.claude/projects/fixture/memory/note.md' } }) });
  assert.equal(blocked.status, 0);
  assert.equal(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const allowed = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/architecte/code.mjs', import.meta.url)), '--guard-write-scope', h.root, 'bug'], {
    encoding: 'utf8', input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(h.root, 'js/car.js') } })
  });
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout, '', 'the hook does not grant additional permission for an ordinary project edit');
});

test('old-session recovery uses surviving before copies without changing the session or claiming authorship', async (t) => {
  const { root, code } = repository(t);
  fs.writeFileSync(path.join(root, 'js/car.js'), 'const speed = 1.5;\n');
  const dir = path.join(root, 'chantier/old-session');
  await code.snapshot(dir);
  fs.unlinkSync(path.join(dir, 'snapshot.json')); // Older sessions kept copies, without their HEAD metadata.
  fs.writeFileSync(path.join(root, 'js/car.js'), 'const speed = 2;\n');
  const names = fs.readdirSync(dir, { recursive: true }).sort();
  const r = await code.reconstructSession(dir, { observedPaths: ['js/car.js'] });
  assert.equal(r.releve.etat, 'partiel');
  assert.equal(r.attribution.fiable, false);
  assert.deepEqual(r.fichiers.map((f) => [f.path, f.reference]), [['js/car.js', 'copie avant']]);
  assert.match(r.patch, /-const speed = 1\.5;/);
  assert.match(r.patch, /\+const speed = 2;/);
  assert.deepEqual(fs.readdirSync(dir, { recursive: true }).sort(), names, 'no recovered record or diff is written into the old session');
  assert.equal(fs.readFileSync(path.join(root, 'js/car.js'), 'utf8'), 'const speed = 2;\n');
  assert.equal(Object.hasOwn(r, 'issue'), false);
  const absolute = await code.reconstructSession(dir, { observedPaths: [path.join(root, 'js/car.js'), 'js/car.js'] });
  assert.deepEqual(absolute.fichiers.map((f) => f.path), ['js/car.js'], 'absolute observed paths are normalized and deduplicated');
  await assert.rejects(code.reconstructSession(dir, { head: '--anything' }), /SHA Git complet/);
});

test('recovery without initial evidence reports unavailable rather than asserting that nothing changed', async (t) => {
  const { root, code } = repository(t);
  const r = await code.reconstructSession(path.join(root, 'chantier/missing-session'));
  assert.equal(r.releve.etat, 'indisponible');
  assert.match(r.releve.raison, /Aucune référence exploitable/);
  assert.equal(r.attribution.fiable, false);
});

test('the write guard rejects private configuration without reading its contents', (t) => {
  const { root } = repository(t);
  const file = path.join(root, '.claude/settings.local.json');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, '{"fixture":"FAKE_ONLY"}\n');
  const read = fs.readFileSync;
  fs.readFileSync = (target, ...args) => { assert.notEqual(String(target), file, 'private configuration must never be read by the guard'); return read(target, ...args); };
  try { assert.ok(inspectWritePath(root, file).motif); } finally { fs.readFileSync = read; }
});

test('a missing initial copy is an unavailable audit, never a false new file or an empty completed diff', async (t) => {
  const { root, code } = repository(t);
  fs.writeFileSync(path.join(root, 'js/car.js'), 'const speed = 1.5;\n');
  const dir = path.join(root, 'chantier/session'), snap = await code.snapshot(dir);
  fs.unlinkSync(path.join(dir, 'avant/js/car.js'));
  fs.writeFileSync(path.join(root, 'js/car.js'), 'const speed = 2;\n');
  await assert.rejects(code.sessionChanges(dir, snap), /Copie initiale indisponible ou altérée/);
  await assert.rejects(code.diffFiles(path.join(dir, 'missing'), path.join(root, 'js/car.js'), 'js/car.js'), /Comparaison indisponible/);
});
