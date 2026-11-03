import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The workshop: a ticket the Creator validated goes to a headless Claude Code session (`claude -p`) in the project, one
// at a time, set up like the Creator's own sessions: Claude Opus 5.5 at extra-high effort, auto permission mode, the
// project's CLAUDE.md / AGENTS.md, and the project's lessons from his Claude Code memory. It reads the ticket and its
// photos, fixes the code, runs the tests and answers in the ticket. It never commits (the Creator does), never touches
// the Architect's own files, and is stopped after a while if it hangs. Its session id goes in the ticket: the Creator
// can reopen that conversation (`claude --resume <id>` in the project) and carry on with it.

const TIME_LIMIT = 90 * 60 * 1000;
const MODEL = 'claude-opus-5-5';
const EFFORT = 'xhigh';
// Asked without a prompt (auto mode judges the rest): read and edit the project, run the tests, look at the diff
const ALLOWED = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(npm test:*)', 'Bash(node --check:*)', 'Bash(node --test:*)', 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(ls:*)'];
// Never: the history is the Creator's
const DENIED = ['Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git reset:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)', 'Bash(git branch:*)', 'Bash(git stash:*)', 'Bash(git rebase:*)', 'Bash(git tag:*)', 'Bash(git merge:*)'];
// His Claude Code memory for this project (the lessons of every version), when there is one
const MEMORY = path.join(os.homedir(), '.claude', 'projects', os.homedir().replace(/[/.]/g, '-'), 'memory');

class Atelier {
  /**
   * @param {object} o - root (the project), chantier, notify(kind, data), log(kind, text, data)
   */
  constructor({ root, chantier, notify, log }) {
    Object.assign(this, { root, chantier, notify, log });
    this.queue = [];
    this.current = null;
    this.child = null;
  }

  status() {
    const s = this.chantier.settings;
    return { auto: s.atelier, enCours: this.current ? { id: this.current.id, titre: this.current.titre, depuis: this.startedAt, derniere: this.last || '' } : null, file: this.queue.slice() };
  }

  enqueue(id) {
    if (this.queue.includes(id) || this.current?.id === id) return;
    this.queue.push(id);
    this.notify('atelier', this.status());
    this.next();
  }

  // Validated tickets waiting since the last session go back in the queue
  resume() {
    for (const t of this.chantier.listTickets().reverse()) if (t.statut === 'valide' || t.statut === 'atelier') this.enqueue(t.id);
  }

  next() {
    if (this.current || !this.chantier.settings.atelier) return;
    const id = this.queue.shift();
    if (!id) return;
    const t = this.chantier.tickets.get(id);
    if (!t || (t.statut !== 'valide' && t.statut !== 'atelier')) { this.next(); return; }
    this.run(t);
  }

  prompt(t) {
    const dir = this.chantier.ticketDir(t);
    const photos = [...t.photos, ...t.apres].map((p) => path.join(dir, `${p}.jpg`));
    return `Tu es l’agent dev d’OVERDRAFT. Lis AGENTS.md et respecte ses règles.

Le Créateur a validé ce ticket de l’Architecte (un testeur qui parcourt le jeu). Corrige le problème dans le code ou les ressources du jeu.

${this.chantier.markdown(t)}

Photos du ticket (lis-les, ce sont des images) :
${photos.map((p) => `- ${p}`).join('\n')}
${this.lessons()}
Règles de l’atelier :
- Ne commite rien, ne pousse rien, ne crée pas de branche : le Créateur commite lui-même.
- Ne touche pas aux fichiers de l’Architecte (js/architect*.js, js/repro-link.js, css/architect.css, tools/architecte/, chantier/, ARCHITECTE.md).
- Le jeu tourne peut-être pendant que tu travailles : garde le code valide à chaque modification (node --check sur chaque fichier touché).
- Lance npm test à la fin (un seul échec attendu : tree-geodata, à cause de la licence Xcode).
- Si le ticket demande une décision du Créateur (goût, ressource à acheter, gros chantier), ne modifie rien et explique pourquoi.

Termine par un compte rendu en français, en quelques lignes : ce que tu as changé (fichiers), comment vérifier dans le jeu, ce qui n’est pas vérifié.`;
  }

  // The lessons the Creator's sessions learned on this project, read like they would be
  lessons() {
    const files = ['overdraft-game.md', 'overdraft-main-only.md'].map((n) => path.join(MEMORY, n)).filter((p) => fs.existsSync(p));
    return files.length ? `\nLeçons apprises sur ce projet par les sessions du Créateur (lis-les avant de commencer) :\n${files.map((p) => `- ${p}`).join('\n')}\n` : '';
  }

  run(t) {
    this.current = t;
    this.startedAt = Date.now();
    this.last = '';
    const session = crypto.randomUUID();
    this.chantier.updateTicket(t.id, { statut: 'atelier', session }, { qui: 'atelier', texte: `L’atelier prend le ticket (Claude Opus 5.5, effort xhigh). Session : claude --resume ${session}` });
    this.log('atelier', `L’atelier prend le ticket #${t.id} : ${t.titre}`, { id: t.id });
    this.notify('ticket', this.chantier.tickets.get(t.id));
    this.notify('atelier', this.status());
    let out = '', err = '', final = null;
    // stream-json: every step it takes arrives as it happens, for the ticket's live log
    const args = ['-p', this.prompt(t), '--model', MODEL, '--effort', EFFORT, '--permission-mode', 'auto', '--session-id', session,
      '--allowedTools', ...ALLOWED, '--disallowedTools', ...DENIED, '--output-format', 'stream-json', '--verbose'];
    const child = spawn('claude', args, {
      // the Creator's own Claude Code login, not the Architect's API key
      cwd: this.root, env: withoutKey(process.env), stdio: ['ignore', 'pipe', 'pipe']
    });
    this.child = child;
    const timer = setTimeout(() => { err += '\nTemps dépassé : l’atelier est arrêté.'; child.kill('SIGTERM'); }, TIME_LIMIT);
    child.stdout.on('data', (d) => {
      out += d;
      let nl;
      while ((nl = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, nl);
        out = out.slice(nl + 1);
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'result') final = event;
        else for (const step of this.steps(event)) this.step(t.id, step);
      }
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { err += e.message; });
    child.on('close', (code) => {
      clearTimeout(timer);
      this.child = null;
      let report = '', ok = code === 0;
      if (final) { report = final.result || ''; if (final.is_error) ok = false; } else report = err.trim();
      report = (report || 'Pas de compte rendu.').slice(0, 4000);
      this.chantier.updateTicket(t.id, { statut: ok ? 'corrige' : 'echec' }, { qui: 'atelier', texte: ok ? report : `Échec : ${report}${err ? ` (${err.trim().slice(0, 400)})` : ''}` });
      this.log('atelier', ok ? `Ticket #${t.id} corrigé par l’atelier, à vérifier.` : `L’atelier a échoué sur le ticket #${t.id}.`, { id: t.id, rapport: report });
      this.notify('ticket', this.chantier.tickets.get(t.id));
      this.notify('corrige', { id: t.id, ok });
      this.current = null;
      this.notify('atelier', this.status());
      this.next();
    });
  }

  // What one event of the stream says it did, in a few French words
  steps(event) {
    if (event.type !== 'assistant') return [];
    const rel = (p) => String(p || '').replace(`${this.root}/`, '');
    const out = [];
    for (const c of event.message?.content || []) {
      if (c.type === 'text' && c.text?.trim()) out.push(`« ${c.text.trim().replace(/\s+/g, ' ').slice(0, 280)} »`);
      if (c.type !== 'tool_use') continue;
      const i = c.input || {};
      const said = {
        Read: () => (/\.(jpe?g|png|webp)$/i.test(i.file_path) ? `Regarde la photo ${rel(i.file_path).split('/').pop()}` : `Lit ${rel(i.file_path)}`),
        Edit: () => `Modifie ${rel(i.file_path)}`, MultiEdit: () => `Modifie ${rel(i.file_path)}`, Write: () => `Écrit ${rel(i.file_path)}`,
        Bash: () => `Lance : ${String(i.command || '').replace(/\s+/g, ' ').slice(0, 160)}`,
        Grep: () => `Cherche « ${i.pattern} »`, Glob: () => `Cherche les fichiers ${i.pattern}`,
        TodoWrite: () => 'Organise son travail', Task: () => `Confie une tâche : ${i.description || ''}`, Agent: () => `Confie une tâche : ${i.description || ''}`
      }[c.name];
      out.push(said ? said() : c.name);
    }
    return out;
  }

  // One step in the ticket's live log, and to the control room
  step(id, texte) {
    const t = this.chantier.tickets.get(id);
    if (!t) return;
    const entry = { t: Date.now(), texte };
    t.atelierLog = [...(t.atelierLog || []), entry].slice(-300);
    this.last = texte;
    this.chantier.updateTicket(id, { atelierLog: t.atelierLog });
    this.notify('atelierlog', { id, entry });
    this.notify('atelier', this.status());
  }

  stop() {
    this.child?.kill('SIGTERM');
  }
}

function withoutKey(env) {
  const copy = { ...env };
  delete copy.ANTHROPIC_API_KEY;
  return copy;
}

export { Atelier };
