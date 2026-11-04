import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// The game's code, as Git sees it, watched every few seconds: the branch, what is not committed, what is not pushed, the
// commits as they land. The Architect hears of each commit (and of the tickets it names: "#0003"), the control room shows
// it. Workshop snapshots show what moved, while tool traces detect changes that cannot safely be attributed to the
// session. Concurrent edits to the same file during a single tool call cannot be distinguished without isolation.

const POLL = 3000;
const GAME_FILES = /^(js|css|assets|vendor)\/|^index\.html$/; // what a game page has loaded (a change means stale code)
const TICKET_REF = /#(\d{1,4})\b/g;

function git(root, args, { input, encoding = 'utf8', signal } = {}) {
  return new Promise((resolve) => {
    const child = execFile('git', args, { cwd: root, encoding, signal, timeout: 20000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, out: stdout, err: stderr }));
    if (input !== undefined) { child.stdin.end(input); }
  });
}

// `git status --porcelain=v1 -z`: "XY path\0", a rename also carries "old\0"
function parseStatus(out) {
  const parts = out.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length < 4) continue;
    const x = p[0], y = p[1], file = p.slice(3);
    const from = x === 'R' || x === 'C' ? parts[++i] : null;
    const statut = x === '?' ? 'nouveau' : (x === 'D' || y === 'D') ? 'supprimé' : (x === 'A') ? 'ajouté' : 'modifié';
    files.push({ path: file, statut, indexe: x !== ' ' && x !== '?', ...(from ? { from, rename: x === 'R' } : {}) });
  }
  return files;
}

function ticketsIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(TICKET_REF)) out.add(m[1].padStart(4, '0'));
  return [...out];
}

class Code {
  /**
   * @param {object} o - root, onCommit(commit), onChange(paths)
   */
  constructor({ root, onCommit = () => {}, onChange = () => {} }) {
    Object.assign(this, { root, onCommit, onChange });
    this.branch = null; this.head = null; this.upstream = null; this.ahead = null; this.behind = null;
    this.files = []; // the uncommitted files
    this.hashes = new Map(); // path -> content hash while uncommitted
    this.changedAt = new Map(); // path -> when its content last changed (as seen by the watcher)
    this.commits = []; // the latest commits, newest first
    this.ready = false;
    this.busy = false;
  }

  start() {
    this.timer = setInterval(() => this.poll().catch(() => {}), POLL);
    return this.poll();
  }

  stop() { clearInterval(this.timer); }

  poll() {
    if (this.polling) return this.polling;
    this.polling = this.pollOnce().finally(() => { this.polling = null; });
    return this.polling;
  }

  async pollOnce() {
    this.busy = true;
    try {
      const [branch, head, status] = await Promise.all([
        git(this.root, ['rev-parse', '--abbrev-ref', 'HEAD']),
        git(this.root, ['rev-parse', 'HEAD']),
        git(this.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
      ]);
      if (!head.ok || !branch.ok || !status.ok) throw new Error('État Git indisponible.');
      this.branch = branch.out.trim();
      const newHead = head.out.trim();
      const counts = await git(this.root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
      if (counts.ok) {
        const [behind, ahead] = counts.out.trim().split(/\s+/).map(Number);
        Object.assign(this, { behind, ahead });
        this.upstream = (await git(this.root, ['rev-parse', '--abbrev-ref', '@{upstream}'])).out.trim() || null;
      } else Object.assign(this, { behind: null, ahead: null, upstream: null });
      const files = statusFiles(status.out).filter((f) => !f.path.startsWith('chantier/'));
      const hashes = await this.hashFiles(files.filter((f) => f.statut !== 'supprimé').map((f) => f.path));
      const prev = this.hashes;
      const changed = [];
      const now = Date.now();
      for (const f of files) {
        const h = hashes.get(f.path) ?? 'deleted';
        if (prev.get(f.path) !== h) {
          changed.push(f.path);
          // first sight of a file already dirty: the time it was last written on disk
          this.changedAt.set(f.path, this.ready ? now : mtime(path.join(this.root, f.path)) ?? now);
        }
      }
      // clean again: committed as it was (nothing moved on disk), or put back (its content changed)
      const leaving = [...prev.keys()].filter((p) => !files.some((f) => f.path === p));
      if (leaving.length) {
        const blobs = await this.blobs(newHead, leaving);
        for (const p of leaving) if ((blobs.get(p) ?? 'deleted') !== prev.get(p)) { changed.push(p); this.changedAt.set(p, now); }
      }
      this.files = files;
      this.hashes = new Map(files.map((f) => [f.path, hashes.get(f.path) ?? 'deleted']));
      if (this.ready && changed.length) this.onChange(changed);
      if (this.head && newHead !== this.head) await this.landed(this.head, newHead, prev);
      if (!this.commits.length) this.commits = await this.log(12);
      this.head = newHead;
      this.ready = true;
    } finally {
      this.busy = false;
    }
  }

  async hashFiles(paths) {
    const map = new Map();
    for (const p of paths) {
      if (privatePath(p)) { map.set(p, 'private'); continue; }
      const observed = this.capturePath(p);
      map.set(p, observed.error ? 'unobservable' : observed.hash);
    }
    return map;
  }

  // The committed content of some paths at a revision (a path missing there is left out)
  async blobs(rev, paths, { signal } = {}) {
    const map = new Map();
    const r = await git(this.root, ['ls-tree', '-r', '-z', rev, '--', ...paths], { signal });
    signal?.throwIfAborted();
    if (!r.ok) throw new Error('Référence Git indisponible pour relever les fichiers.');
    for (const line of r.out.split('\0')) {
      const m = /^\d+ blob ([0-9a-f]+)\t([\s\S]+)$/.exec(line);
      if (m) map.set(m[2], m[1]);
    }
    return map;
  }

  // New commits between two heads (a commit, a pull, a merge): the Architect hears of each one. Files a pull or a merge
  // brought onto the disk (clean before, and not committed from here) count as changed for a page loaded earlier.
  async landed(from, to, prev = new Map()) {
    const range = (await git(this.root, ['merge-base', '--is-ancestor', from, to])).ok ? [`${from}..${to}`] : [to];
    const list = await this.log(range[0].includes('..') ? 30 : 5, range);
    const seenAt = Date.now();
    const brought = [...new Set(list.flatMap((c) => c.fichiers))].filter((p) => !prev.has(p) && !this.hashes.has(p));
    for (const p of brought) this.changedAt.set(p, seenAt);
    for (const c of list.reverse()) { c.seenAt = seenAt; this.onCommit(c); }
    const recent = await this.log(12);
    for (const c of recent) c.seenAt = list.find((l) => l.sha === c.sha)?.seenAt;
    this.commits = recent;
  }

  async log(n = 12, range = []) {
    const [meta, names] = await Promise.all([
      git(this.root, ['log', `-${n}`, '--format=%H%x1f%an%x1f%at%x1f%s%x1f%b%x1e', ...range]),
      git(this.root, ['log', `-${n}`, '--format=%x1e%H', '--name-only', ...range])
    ]);
    if (!meta.ok) return [];
    const files = new Map();
    for (const chunk of names.out.split('\x1e')) {
      const [sha, ...list] = chunk.trim().split('\n');
      if (sha) files.set(sha.trim(), list.map((l) => l.trim()).filter(Boolean));
    }
    return meta.out.split('\x1e').map((chunk) => chunk.replace(/^\n+/, '')).filter((c) => c.trim()).map((chunk) => {
      const [sha, auteur, at, sujet, corps = ''] = chunk.split('\x1f');
      return { sha, auteur, t: Number(at) * 1000, sujet, corps: corps.trim(), fichiers: files.get(sha) || [], tickets: ticketsIn(`${sujet}\n${corps}`) };
    });
  }

  // What a game page loaded at `since` no longer matches: game files whose content changed on disk after it
  staleSince(since) {
    if (!since) return [];
    return [...this.changedAt].filter(([p, t]) => t > since + 500 && GAME_FILES.test(p)).map(([p]) => p).sort();
  }

  state() {
    return {
      branche: this.branch, head: this.head?.slice(0, 7), amont: this.upstream, enAvance: this.ahead, enRetard: this.behind,
      fichiers: this.files.map((f) => ({ ...f, depuis: this.changedAt.get(f.path) || null })),
      commits: this.commits.slice(0, 12).map(({ sha, auteur, t, sujet, fichiers, tickets }) => ({ sha: sha.slice(0, 7), auteur, t, sujet, fichiers: fichiers.length, tickets }))
    };
  }

  // ---- A workshop session, between two snapshots ------------------------------------------------------------------------
  // Before: the head, the hash of every uncommitted file, and a copy of each (its content before the session)
  async snapshot(dir, { signal } = {}) {
    await this.poll();
    signal?.throwIfAborted();
    if (!this.ready) throw new Error('État Git indisponible : l’atelier ne peut pas commencer.');
    const before = path.join(dir, 'avant');
    fs.mkdirSync(before, { recursive: true });
    const hashes = {};
    for (const f of this.files) {
      signal?.throwIfAborted();
      if (privatePath(f.path)) { hashes[f.path] = 'private'; continue; }
      const observed = this.capturePath(f.path);
      if (observed.error) throw new Error(observed.error);
      hashes[f.path] = observed.hash;
      if (observed.hash === 'deleted') continue;
      const to = path.join(before, f.path);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      const data = fs.readFileSync(path.join(this.root, f.path));
      fs.writeFileSync(to, data);
      hashes[f.path] = blobHash(data);
    }
    const snapshot = { version: 1, head: this.head, branch: this.branch, hashes, privateState: this.privateState() };
    fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
    return snapshot;
  }

  // Private configuration is observed through metadata only, including ignored root .env files. It is never copied,
  // hashed, displayed in a diff or sent to a model. A change still invalidates the workshop's ownership claim.
  privateState() {
    const names = new Set([...fs.readdirSync(this.root).filter((p) => privatePath(p) && p !== '.git'),
      ...this.files.filter((f) => privatePath(f.path)).map((f) => f.path)]);
    return [...names].sort().map((p) => {
      try { const s = fs.lstatSync(path.join(this.root, p)); return [p, s.size, s.mtimeMs, s.ctimeMs, s.mode]; }
      catch (e) { if (e.code === 'ENOENT') return [p, 'deleted']; throw e; }
    });
  }

  // A path observed before/after a tool call. Never follow a symlink out of the project or read secret files.
  capturePath(file) {
    const realRoot = fs.realpathSync(this.root);
    let absolute = path.resolve(this.root, file), relative = path.relative(this.root, absolute);
    // macOS exposes temporary directories under both /var and /private/var. Claude may use either spelling.
    if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) absolute = path.join(realRoot, relative);
    relative = path.relative(realRoot, absolute).split(path.sep).join('/');
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative) || privatePath(relative)) {
      return { path: relative, hash: null, error: `Chemin non observable : ${relative || file}` };
    }
    try {
      let cursor = realRoot;
      for (const segment of relative.split('/')) {
        cursor = path.join(cursor, segment);
        try { if (fs.lstatSync(cursor).isSymbolicLink()) return { path: relative, hash: null, error: `Lien symbolique non attribuable : ${relative}` }; }
        catch (e) { if (e.code === 'ENOENT') return { path: relative, hash: 'deleted', mtime: 0 }; throw e; }
      }
      const real = fs.realpathSync(absolute);
      if (real !== path.join(realRoot, relative) || !real.startsWith(realRoot + path.sep)) return { path: relative, hash: null, error: `Lien symbolique non attribuable : ${relative}` };
      const stat = fs.statSync(absolute);
      return { path: relative, hash: blobHash(fs.readFileSync(absolute)), mtime: stat.mtimeMs };
    } catch (e) {
      if (e.code === 'ENOENT') return { path: relative, hash: 'deleted', mtime: 0 };
      return { path: relative, hash: null, error: `Fichier non observable : ${relative}` };
    }
  }

  // Test evidence includes disk metadata for every tracked file, not just Edit notifications. An edit after the test,
  // even in an otherwise clean file or via Bash, changes the token. Ignored runtime outputs do not enter the evidence.
  async checkpoint({ signal } = {}) {
    const [head, tracked, status] = await Promise.all([
      git(this.root, ['rev-parse', 'HEAD'], { signal }), git(this.root, ['ls-files', '-z'], { signal }),
      git(this.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { signal })
    ]);
    signal?.throwIfAborted();
    if (!head.ok || !tracked.ok || !status.ok) throw new Error('Impossible de relever le code testé.');
    const dirty = new Set(statusFiles(status.out).map((f) => f.path));
    const paths = [...new Set([...tracked.out.split('\0').filter(Boolean), ...dirty])].filter((p) => !p.startsWith('chantier/')).sort();
    const rows = paths.map((p) => {
      const file = path.join(this.root, p);
      try {
        const s = fs.lstatSync(file);
        const observed = dirty.has(p) && !privatePath(p) ? this.capturePath(p) : null;
        if (observed?.error) throw new Error(observed.error);
        return [p, s.size, s.mtimeMs, s.ctimeMs, observed?.hash || null];
      } catch (e) { if (e.code === 'ENOENT') return [p, 'deleted']; throw e; }
    });
    const privateState = this.privateState();
    return { head: head.out.trim(), token: crypto.createHash('sha256').update(JSON.stringify([head.out.trim(), rows, privateState])).digest('hex'), latestWrite: rows.reduce((n, r) => typeof r[2] === 'number' ? Math.max(n, r[2]) : n, 0), at: Date.now() };
  }

  // After: every file that moved, with a separate attribution audit. A commit or an untraced edit makes attribution
  // ambiguous; the workshop keeps the diff for review and must not claim a verified delivery.
  async sessionChanges(dir, snap, { traces = null, signal, onProgress = () => {} } = {}) {
    await this.poll();
    signal?.throwIfAborted();
    const touched = new Set();
    for (const [p, h] of this.hashes) if (snap.hashes[p] !== h) touched.add(p);
    for (const p of Object.keys(snap.hashes)) if (!this.hashes.has(p)) touched.add(p); // reverted or committed meanwhile
    const conflicts = [];
    if (snap.privateState && JSON.stringify(snap.privateState) !== JSON.stringify(this.privateState())) conflicts.push('Un fichier privé a changé pendant la session : modification hors périmètre, attribution ambiguë.');
    if (this.head !== snap.head || this.branch !== snap.branch && snap.branch) {
      conflicts.push('HEAD ou branche a changé pendant la session.');
      const committed = await git(this.root, ['diff', '--name-only', '-z', snap.head, 'HEAD', '--'], { signal });
      signal?.throwIfAborted();
      for (const p of committed.out.split('\0').filter(Boolean)) touched.add(p);
    }
    if (traces) for (const trace of traces) if (trace.before?.path) touched.add(trace.before.path);
    const baseline = await this.blobs(snap.head, [...touched], { signal });
    const out = [];
    let patch = '', examined = 0;
    const progress = () => onProgress({ fichiers: out.slice(), patch, conflits: [...new Set(conflicts)], examines: examined, total: touched.size });
    progress();
    for (const p of [...touched].sort()) {
      signal?.throwIfAborted();
      if (p.startsWith('chantier/')) continue;
      const observed = this.capturePath(p);
      if (observed.error) { conflicts.push(observed.error); examined++; progress(); continue; }
      if (traces) {
        let expected = snap.hashes[p] ?? baseline.get(p) ?? 'deleted';
        const writes = traces.filter((t) => t.before?.path === p);
        for (const t of writes) {
          if (t.before.error || t.before.hash !== expected || !t.after || t.after.error) conflicts.push(`${p} : écriture concurrente ou trace incomplète.`);
          expected = t.after?.hash ?? expected;
        }
        if (expected !== observed.hash) conflicts.push(`${p} : modification sans outil suivi, attribution ambiguë.`);
      }
      const beforeFile = await this.contentBefore(dir, snap, p, { signal });
      const afterFile = fs.existsSync(path.join(this.root, p)) ? path.join(this.root, p) : null;
      const d = await this.diffFiles(beforeFile, afterFile, p, { signal });
      if (d.text) {
        patch += d.text;
        out.push({ path: p, statut: !beforeFile ? 'nouveau' : !afterFile ? 'supprimé' : 'modifié', plus: d.plus, moins: d.moins });
      }
      examined++; progress();
    }
    signal?.throwIfAborted();
    fs.writeFileSync(path.join(dir, 'diff.patch'), patch);
    Object.defineProperty(out, 'audit', { value: { fiable: conflicts.length === 0, conflits: [...new Set(conflicts)], attribution: traces ? 'traces_observees' : 'variations_du_depot', limite: 'Une édition concurrente du même fichier pendant un appel outil ne peut pas être isolée.' } });
    Object.defineProperty(out, 'patch', { value: patch });
    Object.defineProperty(out, 'releve', { value: { etat: 'complet', source: 'audit', examines: examined, total: touched.size } });
    fs.writeFileSync(path.join(dir, 'attribution.json'), JSON.stringify(out.audit, null, 2));
    return out;
  }

  // Recovery never updates an old session, its ticket, or the game. The returned diff compares today's files with
  // surviving baseline evidence and is explicitly not attributable without the original tool traces/end snapshot.
  async reconstructSession(dir, { observedPaths = [], head = null, includeCurrentDirty = false, signal } = {}) {
    const files = [], notes = ['Reconstruction après la session : aucune attribution ni correction validée ne peut en être déduite.'];
    const candidates = new Set(observedPaths.filter((p) => typeof p === 'string'));
    const beforeRoot = path.join(dir, 'avant');
    let snap = null;
    try {
      const metadata = path.join(dir, 'snapshot.json'), stat = fs.lstatSync(metadata);
      if (stat.isFile() && !stat.isSymbolicLink()) snap = JSON.parse(fs.readFileSync(metadata, 'utf8'));
    } catch { /* old sessions did not persist their initial HEAD */ }
    const walk = (folder, prefix = '') => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        signal?.throwIfAborted();
        const p = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (privatePath(p) || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) walk(path.join(folder, entry.name), p);
        else if (entry.isFile()) candidates.add(p);
      }
    };
    try { if (!fs.lstatSync(beforeRoot).isSymbolicLink()) walk(beforeRoot); } catch { /* no surviving copies */ }
    for (const p of Object.keys(snap?.hashes || {})) candidates.add(p);
    if (includeCurrentDirty) { await this.poll(); signal?.throwIfAborted(); for (const f of this.files) candidates.add(f.path); notes.push('Les fichiers actuellement non commités sont inclus comme pistes ; ils peuvent provenir du Créateur.'); }
    const revision = snap?.head || head || 'HEAD';
    if (revision !== 'HEAD' && !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(revision)) throw new Error('La reconstruction exige un SHA Git complet ou HEAD.');
    if (!snap?.head) notes.push(head ? 'La référence Git a été fournie pour cette reconstruction, sans relevé de fin.' : 'HEAD actuel est une référence indicative : le HEAD initial n’a pas été conservé.');
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'architecte-recovery-'));
    let patch = '', examined = 0;
    try {
      const seen = new Set();
      for (const candidate of [...candidates].sort()) {
        signal?.throwIfAborted();
        const observed = this.capturePath(candidate);
        if (observed.error) { notes.push(observed.error); continue; }
        const p = observed.path;
        if (seen.has(p)) continue;
        seen.add(p);
        let before = null, baseline = 'absent';
        if (snap?.hashes?.[p] === 'deleted') baseline = 'absence relevée avant la session';
        else {
          let copy = null;
          try {
            if (!fs.lstatSync(beforeRoot).isSymbolicLink()) {
              const check = new Code({ root: beforeRoot }).capturePath(p);
              if (!check.error && check.hash !== 'deleted') copy = fs.readFileSync(path.join(beforeRoot, p));
            }
          } catch { /* no safe copy */ }
          if (copy) { before = copy; baseline = 'copie avant'; }
          else {
            const r = await git(this.root, ['show', `${revision}:${p}`], { encoding: 'buffer', signal });
            signal?.throwIfAborted();
            if (r.ok) { before = r.out; baseline = snap?.head ? 'HEAD initial conservé' : 'référence Git indicative'; }
          }
        }
        const a = before === null ? null : path.join(scratch, 'before'), b = observed.hash === 'deleted' ? null : path.join(scratch, 'after');
        if (a) fs.writeFileSync(a, before);
        if (b) fs.writeFileSync(b, fs.readFileSync(path.join(this.root, p)));
        const d = await this.diffFiles(a, b, p, { signal });
        examined++;
        if (d.text) { patch += d.text; files.push({ path: p, statut: !a ? 'nouveau' : !b ? 'supprimé' : 'modifié', plus: d.plus, moins: d.moins, reference: baseline, attribution: 'non_prouvee' }); }
      }
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
    return { fichiers: files, patch, attribution: { fiable: false, conflits: notes, attribution: 'reconstruction_non_attribuable' },
      releve: { etat: examined ? 'partiel' : 'indisponible', source: 'reconstruction', examines: examined, total: candidates.size,
        raison: examined ? 'Comparaison actuelle seulement ; elle ne reconstitue pas avec certitude les seules écritures de la session.' : 'Aucune référence exploitable ne permet d’affirmer qu’aucun fichier n’a été modifié.' } };
  }

  // The file as it was before the session: the copy taken then, or the committed version, or nothing (a new file)
  async contentBefore(dir, snap, p, { signal } = {}) {
    if (privatePath(p)) throw new Error('Le contenu d’un fichier privé ne doit pas être lu.');
    if (Object.hasOwn(snap.hashes, p)) {
      if (snap.hashes[p] === 'deleted') return null;
      const before = path.join(dir, 'avant'), observed = new Code({ root: before }).capturePath(p);
      if (observed.error || observed.hash === 'deleted' || observed.hash !== snap.hashes[p]) throw new Error(`Copie initiale indisponible ou altérée : ${p}`);
      return path.join(before, p);
    }
    const r = await git(this.root, ['show', `${snap.head}:${p}`], { encoding: 'buffer', signal });
    signal?.throwIfAborted();
    if (!r.ok) return null;
    const file = path.join(dir, 'base', p);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, r.out);
    return file;
  }

  async diffFiles(a, b, label, { signal } = {}) {
    const r = await git(this.root, ['diff', '--no-index', '--no-color', '--', a || '/dev/null', b || '/dev/null'], { signal });
    signal?.throwIfAborted();
    let text = r.out || '';
    if (!r.ok && !text) throw new Error(`Comparaison indisponible : ${label}`);
    if (!text) return { text: '', plus: 0, moins: 0 };
    // the temporary paths become the file's own
    text = text.split('\n').map((line) => {
      if (line.startsWith('diff --git ')) return `diff --git a/${label} b/${label}`;
      if (line.startsWith('--- ') && line !== '--- /dev/null') return `--- a/${label}`;
      if (line.startsWith('+++ ') && line !== '+++ /dev/null') return `+++ b/${label}`;
      return line;
    }).join('\n');
    let plus = 0, moins = 0;
    for (const line of text.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) plus++;
      else if (line.startsWith('-') && !line.startsWith('---')) moins++;
    }
    return { text: text.endsWith('\n') ? text : `${text}\n`, plus, moins };
  }

  // The uncommitted diff of one file, against the last commit
  async diffNow(p) {
    if (!this.files.some((f) => f.path === p)) return '';
    if (privatePath(p) || this.capturePath(p).error) return '';
    const f = this.files.find((x) => x.path === p);
    if (f.statut === 'nouveau') return (await this.diffFiles(null, path.join(this.root, p), p)).text;
    return (await git(this.root, ['diff', 'HEAD', '--no-color', '--', p])).out;
  }
}

function mtime(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return null; }
}

const blobHash = (bytes) => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

function statusFiles(out) {
  return parseStatus(out).flatMap((f) => f.rename ? [f, { path: f.from, statut: 'supprimé', indexe: f.indexe }] : [f]);
}

const privatePath = (p) => /(^|\/)(?:\.git(?:\/|$)|\.env(?:[./]|$)|\.git-credentials$|\.gitconfig$|\.netrc$|\.npmrc$|\.ssh(?:\/|$)|\.aws(?:\/|$))/.test(p);

function inspectWritePath(root, file, category = 'bug') {
  if (typeof file !== 'string' || !file.trim()) return { path: null, motif: 'La destination de l’écriture est absente.' };
  const expanded = file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file;
  let p;
  try {
    const realRoot = fs.realpathSync(root);
    let absolute = path.resolve(root, expanded), relative = path.relative(root, absolute);
    if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) absolute = path.join(realRoot, relative);
    p = path.relative(realRoot, absolute).split(path.sep).join('/');
  } catch { return { path: file, motif: 'La racine du projet est indisponible.' }; }
  if (!p || p.startsWith('../') || path.isAbsolute(p)) {
    const memory = /(?:^|\/)\.claude\/(?:projects\/.*\/memory|agent-memory)(?:\/|$)/.test(expanded);
    return { path: p, motif: memory ? 'Mémoire extérieure en lecture seule : aucune note ne doit être créée ou modifiée hors du projet.' : `Chemin non observable : ${p || file}` };
  }
  // Reject configuration and control files before attempting to read/hash the destination.
  if (privatePath(p) || /^(?:tools\/architecte\/|chantier\/|ARCHITECTE\.md$|AGENTS\.md$|CLAUDE\.md$|\.(?:git|claude|codex|env)(?:\/|\.|$))/.test(p) ||
    category !== 'outil' && /^(?:js\/(?:architect[\w-]*|repro-link)\.js|css\/architect\.css)$/.test(p)) {
    return { path: p, motif: 'Ce fichier est hors du périmètre de correction autorisé pour ce ticket.' };
  }
  const before = new Code({ root }).capturePath(p);
  if (before.error) return { path: p, before, motif: before.error };
  return { path: p, before, motif: null };
}

// A PreToolUse hook can deny an out-of-scope write before Claude executes it. Silence leaves normal permissions in
// force; it never grants permission. This executable mode reads only the tool request, never a memory/config file.
if (process.argv[2] === '--guard-write-scope' && path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    let input = '';
    for await (const chunk of process.stdin) { input += chunk; if (input.length > 2 * 1024 * 1024) throw new Error('Requête d’outil trop grande.'); }
    const call = JSON.parse(input), file = call.tool_input?.file_path || call.tool_input?.notebook_path;
    const target = inspectWritePath(process.argv[3], file, process.argv[4]);
    if (target.motif) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: `${call.tool_name || 'Écriture'} refusé : ${file || '(destination absente)'} — ${target.motif}` } }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Contrôle de périmètre indisponible : ${e.message}` } }));
  }
}

export { Code, parseStatus, ticketsIn, privatePath, inspectWritePath };
