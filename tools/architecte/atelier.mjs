import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasCreatorApproval } from './ticket-policy.mjs';
import { privatePath, inspectWritePath } from './code.mjs';

// The workshop: a ticket the Creator validated goes to a headless Claude Code session (`claude -p`) in the project, one
// at a time, set up like the Creator's own sessions: Claude Opus 5.5 at extra-high effort, auto permission mode, the
// project's CLAUDE.md / AGENTS.md, and the project's lessons from his Claude Code memory. It reads the ticket and its
// photos, fixes the code, runs the tests and ends with a delivery note (structured: what changed, how to check, what is
// not checked). It never commits (the Creator does) and is stopped after a while if it hangs.
//
// Snapshots and observed tool traces record changes without pretending to identify concurrent edits exactly.
// Its steps, phase, files and test results are followed live; the processes it leaves behind (a headless
// Chrome, a server) are stopped when it ends. Its session id goes in the ticket: `claude --resume <id>` reopens it.

const TIME_LIMIT = 90 * 60 * 1000;
const MODEL = 'claude-opus-5-5';
const EFFORT = 'xhigh';
// Asked without a prompt (auto mode judges the rest): read and edit the project, run the tests, look at the diff
const ALLOWED = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(npm test:*)', 'Bash(node --check:*)', 'Bash(node --test:*)', 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(ls:*)'];
// Never: the history is the Creator's
const DENIED = ['Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git reset:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)', 'Bash(git branch:*)', 'Bash(git stash:*)', 'Bash(git rebase:*)', 'Bash(git tag:*)', 'Bash(git merge:*)', 'Bash(git restore:*)', 'Bash(git clean:*)', 'Bash(git worktree:*)'];
// His Claude Code memory for this project (the lessons of every version), when there is one
const MEMORY = path.join(os.homedir(), '.claude', 'projects', os.homedir().replace(/[/.]/g, '-'), 'memory');
const PHASES = { Read: 'lit', Grep: 'cherche', Glob: 'cherche', Edit: 'modifie', MultiEdit: 'modifie', Write: 'modifie', NotebookEdit: 'modifie', Bash: 'lance', TodoWrite: 'organise', Task: 'délègue', Agent: 'délègue' };
// The delivery note every session ends with
const DELIVERY = {
  type: 'object', additionalProperties: false, required: ['compte_rendu', 'resume', 'fichiers', 'verifier', 'non_verifie', 'decision_requise'],
  properties: {
    compte_rendu: { type: 'string', description: 'Le compte rendu complet, en français, en Markdown : la cause, ce qui a changé (fichiers), comment vérifier dans le jeu, ce qui n’est pas vérifié, ce qui reste faible.' },
    resume: { type: 'string', description: 'Une ou deux phrases simples pour le Créateur : ce qui est corrigé, ou pourquoi rien ne l’est.' },
    fichiers: { type: 'array', items: { type: 'string' }, description: 'Les fichiers modifiés, chemins relatifs au projet.' },
    verifier: { type: 'object', additionalProperties: false, required: ['lien', 'etapes', 'attendu'], properties: {
      lien: { type: 'string', description: 'Le lien de reproduction à ouvrir (celui du ticket, ou un meilleur).' },
      etapes: { type: 'string', description: 'Ce que l’Architecte doit refaire dans le jeu pour vérifier.' },
      attendu: { type: 'string', description: 'Ce qu’il doit voir ou mesurer si c’est corrigé.' } } },
    non_verifie: { type: 'string', description: 'Ce que tu n’as pas pu vérifier.' },
    decision_requise: { type: 'boolean', description: 'true si tu n’as rien modifié parce qu’une décision du Créateur est nécessaire.' }
  }
};

class Atelier {
  /**
   * @param {object} o - root (the project), chantier, code (the Git watcher), notify(kind, data), log(kind, text, data)
   */
  constructor({ root, chantier, code, notify, log, processTools = {}, timeLimitMs = TIME_LIMIT, killGraceMs = 2000, auditTimeoutMs = 8000 }) {
    Object.assign(this, { root, chantier, code, notify, log });
    this.queue = [];
    this.current = null;
    this.child = null;
    this.live = null;
    this.running = null;
    this.stopping = false;
    this.processTools = { spawn, list: ps, kill: (pid, signal) => process.kill(pid, signal), ...processTools };
    this.timeLimitMs = timeLimitMs;
    this.killGraceMs = killGraceMs;
    this.auditTimeoutMs = auditTimeoutMs;
    this.dir = path.join(chantier.dir, 'atelier');
    fs.mkdirSync(this.dir, { recursive: true });
    this.historyFile = path.join(this.dir, 'sessions.jsonl');
  }

  status() {
    const s = this.chantier.settings, l = this.live;
    return {
      auto: s.atelier, modele: 'Claude Opus 5.5', effort: EFFORT,
      enCours: this.current && l ? {
        id: this.current.id, titre: this.current.titre, session: l.session, depuis: l.debut, phase: l.phase, derniere: l.derniere,
        fichiers: [...l.fichiers], tests: l.tests, outils: l.outils, cout: l.cout
      } : null,
      file: this.queue.map((id) => ({ id, titre: this.chantier.tickets.get(id)?.titre || '' }))
    };
  }

  history(n = 40) {
    try {
      return fs.readFileSync(this.historyFile, 'utf8').trim().split('\n').filter(Boolean).slice(-n).reverse().map((l) => JSON.parse(l));
    } catch { return []; }
  }

  enqueue(id) {
    const t = this.chantier.tickets.get(id);
    if (this.stopping || !hasCreatorApproval(t) || !['valide', 'atelier'].includes(t.statut)) return false;
    if (this.queue.includes(id)) return false;
    if (this.current?.id === id && !(this.stopReason && t.statut === 'valide')) return false;
    this.queue.push(id);
    this.notify('atelier', this.status());
    this.next();
    return true;
  }

  remove(id) {
    this.queue = this.queue.filter((q) => q !== id);
    this.notify('atelier', this.status());
  }

  move(id, by) {
    const i = this.queue.indexOf(id), j = Math.max(0, Math.min(this.queue.length - 1, i + by));
    if (i < 0 || i === j) return;
    this.queue.splice(i, 1);
    this.queue.splice(j, 0, id);
    this.notify('atelier', this.status());
  }

  // Validated tickets waiting since the last session go back in the queue
  resume() {
    for (const t of this.chantier.listTickets().reverse()) if (t.statut === 'valide' || t.statut === 'atelier') this.enqueue(t.id);
  }

  next() {
    if (this.stopping || this.current || !this.chantier.settings.atelier) return;
    const id = this.queue.shift();
    if (!id) return;
    const t = this.chantier.tickets.get(id);
    if (!hasCreatorApproval(t) || (t.statut !== 'valide' && t.statut !== 'atelier')) { this.next(); return; }
    this.run(t).catch((e) => { this.log('atelier', `L’atelier n’a pas pu démarrer : ${e.message}`); this.current = null; this.next(); });
  }

  childSettings(ticket) {
    const command = [process.execPath, fileURLToPath(new URL('./code.mjs', import.meta.url)), '--guard-write-scope', this.root, ticket.categorie || 'bug'].map(shellQuote).join(' ');
    // Session-only overrides; the Creator's settings and authentication stay untouched.
    return { autoMemoryEnabled: false, env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
      hooks: { PreToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command, timeout: 5 }] }] } };
  }

  prompt(t) {
    const dir = this.chantier.ticketDir(t);
    const photos = [...t.photos, ...t.apres].map((p) => path.join(dir, `${p}.jpg`));
    const exp = t.experience ? this.chantier.experience(t.experience) : null;
    const branch = this.code?.branch;
    const own = t.categorie === 'outil'
      ? '- Ce ticket concerne les outils de l’Architecte lui-même : tu peux modifier js/architect*.js, js/repro-link.js et css/architect.css, mais jamais tools/architecte/ (son serveur), chantier/ ni ARCHITECTE.md.'
      : '- Ne touche pas aux fichiers de l’Architecte (js/architect*.js, js/repro-link.js, css/architect.css, tools/architecte/, chantier/, ARCHITECTE.md).';
    return `Tu es l’agent dev d’OVERDRAFT. Lis AGENTS.md et respecte ses règles.${branch ? ` Tu travailles dans ${this.root}, sur la branche ${branch} : reste-y.` : ''}

Le Créateur a validé ce ticket de l’Architecte (un testeur qui parcourt le jeu). Corrige le problème dans le code ou les ressources du jeu.

${this.chantier.markdown(t)}

Photos du ticket (lis-les, ce sont des images) :
${photos.map((p) => `- ${p}`).join('\n')}
${exp ? `\nL’expérience qui prouve le problème (${exp.id}, ${exp.type}) : réglages ${JSON.stringify(exp.params)}, lieu ${JSON.stringify(exp.lieu)}.\nMesures : ${JSON.stringify(exp.mesures)}\nL’Architecte la rejouera à l’identique pour vérifier ta correction.\n` : ''}${this.lessons()}
Règles de l’atelier :
- Ne commite rien, ne pousse rien, ne crée pas de branche : le Créateur commite lui-même.
${own}
- Les leçons et mémoires extérieures sont en lecture seule. Ne crée, modifie, réorganise ni résume aucun fichier dans ~/.claude/, ~/.codex/ ou un autre dossier extérieur, même pour retenir une découverte. La mémoire automatique est désactivée pour cette session : les enseignements vont uniquement dans la fiche de livraison.
- Le jeu tourne peut-être pendant que tu travailles : garde le code valide à chaque modification (node --check sur chaque fichier touché).
- Si tu lances un Chrome sans fenêtre ou un serveur pour vérifier, arrête-le avant de finir.
- Modifie les sources avec Edit ou Write : leurs traces sont vérifiées. Une écriture non attribuable ou un changement de HEAD bloque la livraison, sans annuler le travail du Créateur.
- Après la dernière modification, fais un appel Bash contenant uniquement npm test depuis la racine, sans filtre, sans echo EXIT, sans || true et sans commande après un point-virgule. Ne regroupe pas les tests avec git status ou d’autres vérifications : leurs appels sont séparés. Un seul échec est attendu : tree-geodata avec le diagnostic de licence Xcode. Garde sa sortie complète.
- Si le ticket demande une décision du Créateur (goût, ressource à acheter, gros chantier), ne modifie rien, explique pourquoi et mets decision_requise à true.

Termine par ta fiche de livraison (sortie structurée) : le compte rendu en français, un résumé simple, les fichiers modifiés, comment l’Architecte vérifie (lien, étapes, ce qu’il doit voir), ce qui n’est pas vérifié.`;
  }

  // The lessons the Creator's sessions learned on this project, read like they would be
  lessons() {
    const files = ['overdraft-game.md', 'overdraft-main-only.md'].map((n) => path.join(MEMORY, n)).filter((p) => fs.existsSync(p));
    return files.length ? `\nLeçons du Créateur : contexte en LECTURE SEULE, sans aucune permission d’écriture extérieure. Lis-les si utile, mais n’y ajoute aucune note et ne touche pas à leur index :\n${files.map((p) => `- ${p}`).join('\n')}\n` : '';
  }

  run(t) {
    if (this.stopping || this.current || !hasCreatorApproval(t) || !['valide', 'atelier'].includes(t.statut)) return Promise.resolve(false);
    this.current = t;
    this.running = this.runSession(t).catch((e) => { this.log('atelier', `Session interrompue : ${e.message}`); return false; }).finally(() => {
      this.current = null; this.live = null; this.child = null; this.running = null;
      this.notify('atelier', this.status());
      this.next();
    });
    return this.running;
  }

  async runSession(t) {
    const session = crypto.randomUUID();
    const sdir = path.join(this.dir, session);
    fs.mkdirSync(sdir, { recursive: true });
    const live = this.live = { session, debut: Date.now(), phase: 'prépare', derniere: '', fichiers: new Set(), tests: null, outils: 0, cout: null, tools: new Map(), pids: new Map(), traces: [], mutation: 0, testRuns: [], evidence: Promise.resolve(), abort: new AbortController() };
    this.chantier.updateTicket(t.id, { statut: 'atelier', session }, { qui: 'atelier', texte: `L’atelier prend le ticket (Claude Opus 5.5, effort ${EFFORT}). Session : claude --resume ${session}` });
    this.log('atelier', `L’atelier prend le ticket #${t.id} : ${t.titre}`, { id: t.id, session });
    this.notify('ticket', this.chantier.tickets.get(t.id));
    this.notify('atelier', this.status());
    this.stopReason = null;
    let snap = null, out = '', err = '', final = null, exitCode = null, child = null, timer, watch, left = [];
    try {
      if (!this.code) throw new Error('Relevé du code indisponible.');
      timer = setTimeout(() => this.stopCurrent('Temps dépassé : l’atelier est arrêté.'), this.timeLimitMs);
      snap = await interruptible(this.code.snapshot(sdir, { signal: live.abort.signal }), live.abort.signal);
      if (this.stopping || this.stopReason || !hasCreatorApproval(this.chantier.tickets.get(t.id))) throw new Error('Validation retirée ou arrêt demandé avant le démarrage.');
      const args = ['-p', this.prompt(t), '--model', MODEL, '--effort', EFFORT, '--permission-mode', 'auto', '--session-id', session,
        '--settings', JSON.stringify(this.childSettings(t)), '--allowedTools', ...ALLOWED, '--disallowedTools', ...DENIED, '--output-format', 'stream-json', '--verbose', '--json-schema', JSON.stringify(DELIVERY)];
      child = this.processTools.spawn('claude', args, { cwd: this.root, env: withoutKey(process.env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      this.child = child;
      live.phase = 'démarre';
      watch = setInterval(() => this.trackProcesses(child.pid).catch(() => {}), 5000);
      child.stdout.on('data', (d) => {
        out += d;
        let nl;
        while ((nl = out.indexOf('\n')) >= 0) {
          const line = out.slice(0, nl); out = out.slice(nl + 1);
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.type === 'result') final = event;
          else this.follow(t.id, event);
        }
      });
      child.stderr.on('data', (d) => { err = (err + d).slice(-16000); });
      exitCode = await new Promise((resolve) => {
        this.finishChild = resolve;
        child.on('error', (e) => { err += e.message; resolve(null); });
        child.on('close', (code) => resolve(code));
      });
      if (out.trim()) { try { const event = JSON.parse(out); if (event.type === 'result') final = event; else this.follow(t.id, event); } catch { /* incomplete stream */ } }
    } catch (e) {
      err += e.message;
    } finally {
      clearTimeout(timer); clearInterval(watch); clearTimeout(this.killTimer); this.killTimer = null;
      this.finishChild = null;
      try { if (child?.pid) left = await this.cleanUp(child.pid); } catch (e) { err += ` Nettoyage impossible : ${e.message}`; this.stopReason ||= 'Le nettoyage des processus n’est pas prouvé.'; }
      this.child = null;
    }
    if (!this.stopReason) await interruptible(live.evidence, live.abort.signal).catch((e) => { this.stopReason ||= e.message; });
    const delivery = validDelivery(final?.structured_output) ? final.structured_output : null;
    const decision = !!delivery?.decision_requise;
    const reasons = [];
    if (exitCode !== 0 || !final || final.is_error) reasons.push('Le processus ne s’est pas terminé avec succès.');
    if (!delivery) reasons.push('Fiche de livraison structurée absente ou invalide.');
    if (decision) reasons.push('Une décision du Créateur est nécessaire.');
    let changes = [], audit = { fiable: false, conflits: ['Relevé des changements indisponible.'] },
      releve = { etat: 'indisponible', source: 'audit', raison: 'Le relevé initial n’a pas pu être conservé.', examines: 0, total: null }, patchText = '', progress = null;
    const auditAbort = new AbortController();
    const auditTimer = setTimeout(() => auditAbort.abort(new Error('Délai du relevé des changements dépassé.')), this.auditTimeoutMs);
    try {
      // This signal is deliberately independent of the stopped model. Even a refused/aborted session must retain its
      // actual partial work; collecting that work can never turn a stopped session into an accepted delivery.
      if (snap) {
        live.phase = 'relève les changements';
        changes = await interruptible(this.code.sessionChanges(sdir, snap, { traces: live.traces, signal: auditAbort.signal, onProgress: (p) => { progress = p; } }), auditAbort.signal);
        audit = changes.audit || audit;
        patchText = changes.patch ?? progress?.patch ?? '';
        releve = changes.releve || { etat: 'complet', source: 'audit', examines: progress?.examines ?? changes.length, total: progress?.total ?? changes.length };
      }
    } catch (e) {
      changes = progress?.fichiers || []; patchText = progress?.patch || '';
      releve = { etat: progress?.examines ? 'partiel' : 'indisponible', source: 'audit', raison: e.message, examines: progress?.examines || 0, total: progress?.total ?? null };
      audit = { fiable: false, conflits: [...(progress?.conflits || []), `Relevé ${releve.etat} : ${e.message}`], attribution: 'releve_incomplet' };
      reasons.push(`Relevé des changements incomplet : ${e.message}`);
    } finally { clearTimeout(auditTimer); }
    fs.writeFileSync(path.join(sdir, 'diff.patch'), patchText);
    fs.writeFileSync(path.join(sdir, 'releve.json'), JSON.stringify(releve, null, 2));
    if (changes.some((c) => forbiddenPath(c.path, t))) reasons.push('Un fichier hors du périmètre autorisé a été modifié.');
    let disk = null;
    try { if (!this.stopReason) disk = await interruptible(this.code?.checkpoint({ signal: live.abort.signal }), live.abort.signal); } catch (e) { reasons.push(e.message); }
    const test = live.testRuns.at(-1);
    if (!test || !test.complete || test.mutation !== live.mutation || !acceptableTests(test) || !disk ||
      test.before?.token !== disk.token || test.after?.token !== disk.token || disk.latestWrite > test.startedAt + 1) {
      reasons.push('npm test complet après la dernière modification du disque n’est pas prouvé.');
    }
    if (!changes.length && !decision && !this.stopReason && releve.etat === 'complet') reasons.push('Aucune variation de fichier n’a été constatée dans le relevé complet.');
    // A stop may arrive during the final asynchronous checkpoint, after the diff has already completed.
    if (this.stopReason) {
      reasons.push(this.stopReason);
      audit = { ...audit, fiable: false, conflits: [...new Set([...audit.conflits, 'Session arrêtée : travail partiel à inspecter, aucune correction validée.'])], attribution: 'variations_apres_arret' };
    }
    fs.writeFileSync(path.join(sdir, 'attribution.json'), JSON.stringify(audit, null, 2));
    if (!audit.fiable) reasons.push(...audit.conflits);
    const current = this.chantier.tickets.get(t.id);
    const approved = hasCreatorApproval(current) && current.statut === 'atelier';
    if (!approved) reasons.push('La validation du Créateur a été retirée.');
    const ok = reasons.length === 0;
    const stopped = this.stopReason || '';
    const report = (delivery?.compte_rendu || final?.result || err.trim() || 'Pas de compte rendu.').slice(0, 12000);
    const record = {
      id: session, ticket: t.id, titre: t.titre, debut: live.debut, fin: Date.now(), duree: Math.round((Date.now() - live.debut) / 1000),
      issue: stopped ? 'arrete' : decision ? 'decision' : ok ? 'corrige' : 'echec', raison: reasons.join(' '),
      cout: final?.total_cost_usd ?? null, tours: final?.num_turns ?? null, tests: live.tests, fichiers: changes, attribution: audit, releve, refus: live.refus || null,
      preuve_tests: { commande: test?.command || live.lastTestCommand || null, suite_complete: !!test, resultat_recevable: !!test && acceptableTests(test),
        disque_stable: !!disk && test?.before?.token === disk.token && test?.after?.token === disk.token,
        apres_derniere_ecriture: !!test && !!disk && disk.latestWrite <= test.startedAt + 1 },
      resume: stopped ? (changes.length ? `Travail interrompu : ${changes.length} fichier(s) présentent des variations à inspecter.` : 'Session interrompue : aucune livraison validée.') : delivery?.resume || '',
      verifier: delivery?.verifier || null, non_verifie: delivery?.non_verifie || '', processus: left
    };
    fs.writeFileSync(path.join(sdir, 'session.json'), JSON.stringify({ ...record, rapport: report }, null, 2));
    fs.appendFileSync(this.historyFile, JSON.stringify(record) + '\n');
    const sessions = [...(current?.sessions || []), record].slice(-10);
    const livraison = ok ? { resume: delivery.resume, fichiers: changes.map((c) => c.path), verifier: delivery.verifier, non_verifie: delivery.non_verifie, session } : null;
    const patch = { sessions };
    if (approved) Object.assign(patch, { statut: ok ? 'corrige' : 'echec', livraison, verification: ok ? { etape: 'retourner', depuis: Date.now() } : null });
    this.chantier.updateTicket(t.id, patch, { qui: 'atelier', texte: `${ok ? '' : `Livraison non acceptée : ${record.raison}\n\n`}${report}` });
    this.log('atelier', ok ? `Ticket #${t.id} corrigé par l’atelier, à vérifier : ${record.resume}` : `L’atelier n’a pas corrigé le ticket #${t.id} (${record.issue}).`, { id: t.id, rapport: report, session });
    this.notify('ticket', this.chantier.tickets.get(t.id));
    this.notify('corrige', { id: t.id, ok, issue: record.issue, livraison, changes });
    this.notify('session', record);
    return ok;
  }

  // One event of the stream: its steps for the live log, the phase, the files touched, the test results
  follow(id, event) {
    const l = this.live;
    if (!l) return;
    if (event.type === 'assistant') {
      for (const c of event.message?.content || []) {
        if (c.type === 'text' && c.text?.trim()) this.step(id, `« ${c.text.trim().replace(/\s+/g, ' ').slice(0, 280)} »`, 'parle');
        if (c.type !== 'tool_use') continue;
        const i = c.input || {};
        l.outils++;
        const tool = { name: c.name, command: i.command || '' };
        l.tools.set(c.id, tool);
        if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(c.name)) {
          l.mutation++;
          const file = i.file_path || i.notebook_path;
          const target = inspectWritePath(this.root, file, this.current?.categorie);
          if (target.motif) {
            l.refus = { outil: c.name, fichier: String(file || '(destination absente)'), motif: target.motif };
            const reason = `${c.name} refusé : ${l.refus.fichier} — ${target.motif}`;
            this.step(id, reason, 'bloqué');
            this.stopCurrent(reason);
            continue;
          }
          l.fichiers.add(target.path);
          tool.trace = { id: c.id, before: target.before };
          l.traces.push(tool.trace);
        }
        if (c.name === 'Bash' && fullTestCommand(tool.command, this.root)) {
          tool.test = { command: tool.command, mutation: l.mutation, startedAt: Date.now(), complete: false, text: '', parsed: null, error: false };
          l.testRuns.push(tool.test);
          l.evidence = l.evidence.then(async () => { try { tool.test.before = await this.code?.checkpoint({ signal: l.abort.signal }); } catch (e) { tool.test.evidenceError = e.message; } });
        }
        const phase = c.name === 'Bash' && /\bnpm test\b|node --test/.test(i.command || '') ? 'teste' : PHASES[c.name] || 'agit';
        if (phase === 'teste') l.lastTestCommand = tool.command;
        this.step(id, describe(this.root, c), phase);
      }
    } else if (event.type === 'user') {
      for (const c of event.message?.content || []) {
        if (c.type !== 'tool_result') continue;
        const tool = l.tools.get(c.tool_use_id);
        if (tool?.trace) tool.trace.after = this.code?.capturePath(tool.trace.before.path) || { error: 'Trace indisponible.' };
        if (tool?.name !== 'Bash' || !/\bnpm test\b|node --test/.test(tool.command)) continue;
        const text = typeof c.content === 'string' ? c.content : (c.content || []).map((x) => x.text || '').join('\n');
        const tests = parseTests(text);
        if (tests) { l.tests = { ...tests, t: Date.now() }; this.step(id, `Tests : ${tests.pass} réussis sur ${tests.total}${tests.fail ? `, ${tests.fail} en échec` : ''}`, 'teste'); }
        if (tool.test) {
          Object.assign(tool.test, { text, parsed: tests, error: !!c.is_error, complete: true });
          l.evidence = l.evidence.then(async () => { try { tool.test.after = await this.code?.checkpoint({ signal: l.abort.signal }); } catch (e) { tool.test.evidenceError = e.message; } });
        }
      }
    }
  }

  // One step in the ticket's live log, and to the control room
  step(id, texte, phase) {
    const t = this.chantier.tickets.get(id);
    if (!t || !this.live) return;
    const entry = { t: Date.now(), texte, phase };
    t.atelierLog = [...(t.atelierLog || []), entry].slice(-400);
    this.live.derniere = texte;
    if (phase && phase !== 'parle') this.live.phase = phase;
    this.chantier.updateTicket(id, { atelierLog: t.atelierLog });
    this.notify('atelierlog', { id, entry });
    this.notify('atelier', this.status());
  }

  // ---- Processes ------------------------------------------------------------------------------------------------------
  // Everything the session started, found while it runs (a process it orphans keeps its command line)
  async trackProcesses(root) {
    const table = await this.processTools.list();
    if (!this.live) return;
    const kids = new Map();
    for (const p of table) (kids.get(p.ppid) || kids.set(p.ppid, []).get(p.ppid)).push(p);
    const stack = [root];
    while (stack.length) {
      const pid = stack.pop();
      for (const k of kids.get(pid) || []) { if (!this.live.pids.has(k.pid)) this.live.pids.set(k.pid, k.command); stack.push(k.pid); }
    }
    for (const p of table) if (p.pgid === root && p.pid !== root && !this.live.pids.has(p.pid)) this.live.pids.set(p.pid, p.command);
  }

  // When it ends: its group, then anything it started that still runs (same pid, same command line)
  async cleanUp(root) {
    await this.trackProcesses(root).catch(() => {});
    try { this.processTools.kill(-root, 'SIGTERM'); } catch { /* the group is gone */ }
    const known = this.live?.pids || new Map();
    const alive = (await this.processTools.list()).filter((p) => known.get(p.pid) === p.command);
    for (const p of alive) { try { this.processTools.kill(p.pid, 'SIGTERM'); } catch { /* gone */ } }
    if (alive.length) {
      await new Promise((r) => setTimeout(r, this.killGraceMs));
      for (const p of (await this.processTools.list()).filter((q) => known.get(q.pid) === q.command)) { try { this.processTools.kill(p.pid, 'SIGKILL'); } catch { /* gone */ } }
      if ((await this.processTools.list()).some((p) => known.get(p.pid) === p.command)) throw new Error('Des processus de la session sont encore actifs après SIGKILL.');
    }
    return alive.map((p) => ({ pid: p.pid, commande: p.command.slice(0, 200) }));
  }

  kill() {
    if (!this.child) return;
    const child = this.child;
    try { this.processTools.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    if (!this.killTimer) this.killTimer = setTimeout(() => {
      try { this.processTools.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
      // Do not wait forever for close if an orphan inherited a stream pipe. Cleanup and a failed delivery still run.
      this.finishChild?.(null);
    }, this.killGraceMs);
  }

  // The Creator stops the session in progress
  stopCurrent(reason = 'Arrêté par le Créateur.') {
    if (!this.current) return false;
    this.stopReason ||= reason;
    this.live?.abort?.abort(new Error(this.stopReason));
    this.kill();
    return true;
  }

  async stop() {
    this.stopping = true;
    this.stopCurrent('Arrêt du serveur demandé par le Créateur.');
    await this.running;
  }
}

function ps() {
  return new Promise((resolve, reject) => execFile('ps', ['-A', '-o', 'pid=,ppid=,pgid=,command='], { maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
    if (err) { reject(err); return; }
    resolve(out.split('\n').map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean).map((m) => ({ pid: +m[1], ppid: +m[2], pgid: +m[3], command: m[4] })));
  }));
}

// `node --test`: TAP ("# pass 397") or the spec reporter ("ℹ pass 397")
function parseTests(text) {
  const get = (name) => { const m = new RegExp(`^(?:#|ℹ)\\s*${name}\\s+(\\d+)`, 'm').exec(text); return m ? Number(m[1]) : null; };
  const total = get('tests'), pass = get('pass'), fail = get('fail');
  return total === null || pass === null ? null : { total, pass, fail: fail ?? total - pass };
}

// Recognize a complete npm test in a conservative shell sequence. Quoted code is not a shell command; pipelines,
// background work and || can hide a failed/skipped test. Filters after `npm test --` are not a full suite.
function fullTestCommand(command, root = null) {
  command = String(command || '').trim();
  const parts = [], separators = [];
  let text = '', quote = '', escaped = false;
  for (let n = 0; n < command.length; n++) {
    const c = command[n], next = command[n + 1];
    if (escaped) { text += c; escaped = false; continue; }
    if (c === '\\' && quote !== "'") { text += c; escaped = true; continue; }
    if (quote) { text += c; if (c === quote) quote = ''; continue; }
    if (['"', "'", '`'].includes(c)) { quote = c; text += c; continue; }
    if ('(){}$'.includes(c)) return false;
    if (c === '|' || c === '&' && next !== '&' && next !== '>' && command[n - 1] !== '>') return false;
    if (c === ';' || c === '\n' || c === '&' && next === '&') {
      parts.push(text.trim()); separators.push(c === '&' ? '&&' : ';'); text = '';
      if (c === '&') n++;
    } else text += c;
  }
  if (quote || escaped) return false;
  parts.push(text.trim());
  while (parts.length > 1 && !parts.at(-1)) { parts.pop(); separators.pop(); }
  return parts.some((part, i) => {
    const m = /^(?:command\s+)?npm\s+(?:run\s+)?test(?:\s+(.*))?$/.exec(part);
    if (!m || separators.slice(i).some((s) => s !== '&&')) return false;
    for (const prefix of parts.slice(0, i)) {
      const bare = prefix.replace(/^command\s+/, '');
      if (/^(?:(?:alias|unalias|function|source|eval|exec|export|set|unset|pushd|popd|shopt)\b|\.(?:\s|$))|^[A-Za-z_][\w]*=/.test(bare)) return false;
      if (/^cd(?:\s|$)/.test(bare)) {
        if (!root) return false;
        const target = bare.replace(/^cd\s+(?:--\s+)?/, '').replace(/^(?:"([^"]*)"|'([^']*)')$/, (_m, a, b) => a ?? b);
        if (!target || /[$`]/.test(target)) return false;
        try { if (fs.realpathSync(path.resolve(root, target)) !== fs.realpathSync(root)) return false; } catch { return false; }
      }
    }
    const rest = (m[1] || '').trim().split(/\s+/).filter(Boolean);
    for (let k = 0; k < rest.length; k++) {
      const redirection = /^(?:[012]|&)?>>?(.*)$/.exec(rest[k]);
      if (!redirection) return false;
      if (!redirection[1] && !rest[++k]) return false;
    }
    return true;
  });
}

function interruptible(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error('Session interrompue.'));
    if (signal.aborted) { Promise.resolve(promise).catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function acceptableTests(run) {
  const p = run.parsed;
  if (!p || !p.total || p.pass + p.fail !== p.total || run.evidenceError) return false;
  if (p.fail === 0) return !run.error;
  return p.fail === 1 && /tests\/tree-geodata\.test\.cjs/.test(run.text) &&
    run.text.includes('tree generator filters and deduplicates locations, and signed deltas round trip') &&
    run.text.includes('You have not agreed to the Xcode license agreements');
}

function validDelivery(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
  if (!['compte_rendu', 'resume'].every((k) => typeof d[k] === 'string' && d[k].trim())) return false;
  if (typeof d.non_verifie !== 'string' || typeof d.decision_requise !== 'boolean' || !Array.isArray(d.fichiers)) return false;
  if (!d.fichiers.every((p) => typeof p === 'string' && p && !path.isAbsolute(p) && !p.split(/[\\/]/).includes('..'))) return false;
  return !!d.verifier && typeof d.verifier === 'object' && !Array.isArray(d.verifier) &&
    ['lien', 'etapes', 'attendu'].every((k) => typeof d.verifier[k] === 'string' && d.verifier[k].trim());
}

function forbiddenPath(file, ticket) {
  if (!file || path.isAbsolute(file) || file.split('/').includes('..')) return true;
  if (privatePath(file)) return true;
  if (/^(?:tools\/architecte\/|chantier\/|ARCHITECTE\.md$|AGENTS\.md$|CLAUDE\.md$|\.(?:git|claude|codex|env)(?:\/|\.|$))/.test(file)) return true;
  return ticket?.categorie !== 'outil' && /^(?:js\/(?:architect[\w-]*|repro-link)\.js|css\/architect\.css)$/.test(file);
}

const rel = (root, p) => {
  const file = String(p || ''), bases = [path.resolve(root)];
  try { bases.push(fs.realpathSync(root)); } catch { /* a label can also name an offline directory */ }
  for (const base of bases) if (file.startsWith(base + path.sep)) return file.slice(base.length + 1);
  return file;
};

// What one tool call does, in a few French words
function describe(root, c) {
  const i = c.input || {};
  const said = {
    Read: () => (/\.(jpe?g|png|webp)$/i.test(i.file_path) ? `Regarde la photo ${rel(root, i.file_path).split('/').pop()}` : `Lit ${rel(root, i.file_path)}`),
    Edit: () => `Modifie ${rel(root, i.file_path)}`, MultiEdit: () => `Modifie ${rel(root, i.file_path)}`, Write: () => `Écrit ${rel(root, i.file_path)}`,
    Bash: () => `Lance : ${String(i.command || '').replace(/\s+/g, ' ').slice(0, 160)}`,
    Grep: () => `Cherche « ${i.pattern} »`, Glob: () => `Cherche les fichiers ${i.pattern}`,
    TodoWrite: () => 'Organise son travail', Task: () => `Confie une tâche : ${i.description || ''}`, Agent: () => `Confie une tâche : ${i.description || ''}`,
    StructuredOutput: () => 'Rédige sa fiche de livraison'
  }[c.name];
  return said ? said() : c.name;
}

function withoutKey(env) {
  const copy = { ...env };
  delete copy.ANTHROPIC_API_KEY;
  copy.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  return copy;
}

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

export { Atelier, DELIVERY, describe, parseTests, validDelivery, acceptableTests, fullTestCommand };
