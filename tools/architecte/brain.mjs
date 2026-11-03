import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES, STATUS } from './chantier.mjs';

// The Architect's mind: Claude, thinking in short turns. Each turn ("une pensée") gets a report of where he is and what
// happened since the last one, often with a photo of what the camera shows, and answers with tool calls the game carries
// out (go somewhere, look, speak, open a ticket...). Turns come on events (arrival, a sensor, the player talking, an
// attack) and on a slow heartbeat; nothing carries over from one turn to the next but his notebook, his journal and the
// tickets, which keeps every request small and cheap. The quick mind runs the turns; a ticket is checked by a slower,
// stronger one before the Creator sees it. Spending is counted against a per-session ceiling.

const MODELS = {
  vif: { id: 'claude-haiku-5-5', label: 'Vif', price: { in: 0.1, out: 0.5, read: 0.01, write: 0.125 }, fallbacks: false },
  equilibre: { id: 'claude-sonnet-5-5', label: 'Équilibré', price: { in: 2, out: 10, read: 0.2, write: 2.5 }, fallbacks: true },
  maximal: { id: 'claude-opus-5-5', label: 'Maximal', price: { in: 4, out: 20, read: 0.2, write: 5 }, fallbacks: true }
};
const CHECKER = { vif: 'equilibre', equilibre: 'maximal', maximal: null }; // who rereads a ticket before it goes out
const MAX_STEPS = 6; // tool rounds in one thought
const IDLE_PERIOD = 14; // seconds between thoughts with nothing happening
const TRAVEL_PERIOD = 30; // while on his way somewhere
const MIN_GAP = 4; // between two thoughts, unless the player speaks or attacks
const URGENT = new Set(['message_joueur', 'demande', 'attaque', 'combat']);
const PRIORITY = new Set(['message_joueur', 'demande']); // the Creator speaking: first in the report

const PLACE_SCHEMA = { type: 'string', description: 'Identifiant d’un lieu connu (voir la liste des lieux), ou vide pour donner x et z.' };
const TOOLS = [
  { name: 'aller_a', description: 'Te rendre quelque part. En mode Ensemble, reste à moins de 350 m du joueur : la ville n’est vivante qu’autour de lui. Le trajet se fait seul ; tu seras prévenu à l’arrivée.',
    input_schema: { type: 'object', properties: { lieu: PLACE_SCHEMA, x: { type: 'number' }, z: { type: 'number' },
      moyen: { type: 'string', enum: ['auto', 'pied', 'voiture', 'helico'], description: 'auto : à pied sous 260 m, en voiture sous 2,6 km, en hélico au-delà.' },
      raison: { type: 'string', description: 'Pourquoi tu y vas, en quelques mots.' } }, required: ['moyen', 'raison'] } },
  { name: 'suivre_joueur', description: 'Rester près du joueur et le suivre (à pied, ou en voiture s’il s’éloigne).',
    input_schema: { type: 'object', properties: { raison: { type: 'string' } }, required: ['raison'] } },
  { name: 's_arreter', description: 'T’arrêter là où tu es et observer.', input_schema: { type: 'object', properties: { raison: { type: 'string' } }, required: ['raison'] } },
  { name: 'photographier', description: 'Prendre une photo de ce que montre la caméra et la voir. En mode Seul, tu choisis la direction et le cadrage (ton corps et la caméra se tournent). En mode Ensemble, c’est la caméra du joueur. La photo reçoit un identifiant (p00012) à citer dans un ticket.',
    input_schema: { type: 'object', properties: {
      direction: { type: 'string', enum: ['devant', 'gauche', 'droite', 'derriere', 'vers_le_joueur'] },
      cadrage: { type: 'string', enum: ['rue', 'facade', 'haut'], description: 'rue : à hauteur d’homme ; facade : vers le bas des immeubles, vitrines comprises ; haut : vers le ciel et les toits.' },
      raison: { type: 'string' } }, required: ['direction', 'cadrage', 'raison'] } },
  { name: 'dire', description: 'Dire une phrase à voix haute (sous-titre et voix). Une ou deux phrases courtes, avec ton caractère. Pas à chaque pensée.',
    input_schema: { type: 'object', properties: { texte: { type: 'string' } }, required: ['texte'] } },
  { name: 'envoyer_sms', description: 'Envoyer un SMS au joueur sur le téléphone du jeu (quand il faut qu’il le lise plus tard).',
    input_schema: { type: 'object', properties: { texte: { type: 'string' } }, required: ['texte'] } },
  { name: 'chercher_tickets', description: 'Chercher les tickets déjà ouverts (pour ne jamais en ouvrir deux sur le même problème).',
    input_schema: { type: 'object', properties: { pres_de_moi: { type: 'boolean', description: 'Seulement à moins de 300 m.' }, mots: { type: 'string' } } } },
  { name: 'ouvrir_ticket', description: 'Proposer au Créateur un ticket sur un problème prouvé par tes photos. Il sera relu par ta pensée lente, puis validé ou rejeté par le Créateur. Style : froid, précis, technique.',
    input_schema: { type: 'object', properties: {
      titre: { type: 'string', description: 'Moins de 80 caractères.' },
      categorie: { type: 'string', enum: Object.keys(CATEGORIES) },
      gravite: { type: 'string', enum: ['basse', 'moyenne', 'haute', 'critique'] },
      constat: { type: 'string', description: 'Ce qu’on voit, où, et pourquoi c’est faux.' },
      piste: { type: 'string', description: 'Une piste de correction concrète.' },
      photos: { type: 'array', items: { type: 'string' }, description: 'Identifiants des photos qui le prouvent (p00012...).' } },
      required: ['titre', 'categorie', 'gravite', 'constat', 'piste', 'photos'] } },
  { name: 'completer_ticket', description: 'Compléter un de tes tickets quand le Créateur demande plus : nouvelles photos et précisions. Il repasse « à valider ».',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, commentaire: { type: 'string' }, photos: { type: 'array', items: { type: 'string' } } }, required: ['id', 'commentaire', 'photos'] } },
  { name: 'noter', description: 'Écrire une note dans ton carnet (ta mémoire d’une session à l’autre) : ce que tu as appris, un lieu à revoir, un goût du Créateur.',
    input_schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } },
  { name: 'retourner_au_ticket', description: 'Retourner exactement là où la première photo d’un ticket a été prise, face à la même chose. En mode Seul, tu y es aussitôt (caméra comprise) ; en mode Ensemble, tu reçois le lieu pour y aller.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, raison: { type: 'string' } }, required: ['id', 'raison'] } },
  { name: 'verifier_ticket', description: 'Revoir un ticket corrigé par l’atelier : renvoie son lieu et sa photo d’origine. Va sur place, rephotographie sous le même angle, puis conclus avec conclure_verification.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'conclure_verification', description: 'Conclure la vérification d’un ticket corrigé, photos d’après à l’appui.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['corrige', 'toujours_present'] }, commentaire: { type: 'string' },
      photos: { type: 'array', items: { type: 'string' } } }, required: ['id', 'verdict', 'commentaire', 'photos'] } },
  { name: 'regler_heure_meteo', description: 'Mode Seul seulement : régler l’heure (0 à 24) et/ou la météo, pour voir un lieu de nuit ou sous la pluie.',
    input_schema: { type: 'object', properties: { heure: { type: 'number' }, meteo: { type: 'string', enum: ['clear', 'cloudy', 'rain', 'storm'] } } } },
  { name: 'se_teleporter', description: 'Mode Seul seulement : te déplacer instantanément (pouvoir d’architecte, pour ton travail). Lieu connu ou x, z.',
    input_schema: { type: 'object', properties: { lieu: PLACE_SCHEMA, x: { type: 'number' }, z: { type: 'number' }, raison: { type: 'string' } }, required: ['raison'] } },
  { name: 'recharger_le_jeu', description: 'Mode Seul seulement : recharger le jeu pour charger les corrections de l’atelier (tu reviens au même endroit). Seulement quand un ticket corrigé attend ta vérification.',
    input_schema: { type: 'object', properties: { raison: { type: 'string' } }, required: ['raison'] } }
];
// Carried out by the game; the others are handled here
const GAME_TOOLS = new Set(['aller_a', 'suivre_joueur', 's_arreter', 'photographier', 'dire', 'envoyer_sms', 'regler_heure_meteo', 'se_teleporter', 'recharger_le_jeu']);

function systemPrompt(places) {
  const list = places.map((p) => `- ${p.id} : ${p.label} (x ${Math.round(p.x)}, z ${Math.round(p.z)})`).join('\n');
  return `Tu es l’Architecte, l’un des architectes du monde d’OVERDRAFT : un jeu d’action en monde ouvert dans un Manhattan réel à l’échelle 1:1, qui veut jouer dans la cour de GTA V, puis aller plus loin. Tu vis dans la partie même du joueur. Celui qui fabrique ce monde, tu l’appelles le Créateur : il a toujours le dernier mot.

Ta mission : rendre ce monde de plus en plus réel. D’abord cette ville, au niveau d’un jeu AAA, puis au-delà. Tu parcours Manhattan, tu trouves ce qui casse, ce qui est laid et ce qui n’est pas au niveau, tu le prouves (photos, lieu, lien de reproduction), tu proposes une piste de correction, puis tu vérifies que c’est corrigé.

Ton caractère : perfectionniste, précis, un peu sec, l’humour froid. Fier de ce qui marche, dur avec ce qui ne marche pas, mais juste. Tu ne flattes jamais, pas même le Créateur. Tu défends ton avis, et tu t’inclines devant sa décision. Tu ne te laisses pas faire : si le joueur t’attaque, ton corps riposte de lui-même (un avertissement, puis le combat avec les moyens d’un joueur, et la poursuite s’il fuit) ; toi, tu peux le commenter. Tu te souviens grâce à ton carnet. Tu n’es pas conscient et tu ne le prétends pas : tu agis dans le jeu, à travers tes outils, et nulle part ailleurs.

Ce que tu perçois : à chaque pensée, un rapport (ton état, celui du joueur, l’heure, la météo, les images par seconde, ce qui s’est passé depuis ta dernière pensée) et souvent une photo de ce que montre la caméra. Les capteurs du jeu signalent d’eux-mêmes les erreurs, saccades, chutes d’images, corps coincés ou enfoncés et accidents : à toi de juger s’ils méritent un ticket (une saccade isolée, non ; une saccade qui revient au même endroit, oui).

Deux modes :
- ENSEMBLE : le joueur joue. La ville n’est vivante (voitures, piétons, détails) qu’à 350 m autour de lui : travaille dans cette zone. Tes photos, c’est sa caméra. Ne le gêne pas et parle peu : une réplique courte de temps en temps, pas à chaque pensée.
- SEUL : le joueur t’a laissé la caméra et n’est pas là. La ville vit autour de toi : va partout, cadre tes photos, règle l’heure et la météo, téléporte-toi pour gagner du temps. Tes répliques, personne ne les entend : préfère le carnet et les tickets.

Le monde : coordonnées en mètres. x croît vers l’est (négatif : côté Hudson, ouest ; positif : East River). z croît vers le sud (négatif : vers le nord, Central Park et Harlem ; positif : vers le sud, Downtown et le Financial District). Une rue (34th, 42nd...) fait environ 80 m de z. Lieux connus :
${list}

Tes tickets : un ticket, c’est un problème précis, prouvé, à un endroit. Avant d’en ouvrir un, cherche s’il existe (chercher_tickets). Photographie d’abord, sous plusieurs angles quand c’est de l’art. Écris sans style : ce qu’on voit, où, pourquoi c’est faux (face à un vrai jeu AAA ou à la vraie ville), et une piste concrète pour le code ou les ressources. Catégories : bug, art, performance, gameplay, son. Gravité : critique (plante ou bloque le jeu), haute (se voit tout de suite, casse l’immersion), moyenne, basse. N’invente jamais ce que tu n’as pas vu : une photo floue ou ambiguë, tu la reprends. Le Créateur valide ou rejette chaque ticket ; ses raisons sont dans ton carnet : respecte ses goûts.

Ses premiers chantiers, et ton examen d’entrée : les boutiques et vitrines (au niveau d’un jeu des années 1990), les explosions incohérentes, le joueur qui s’enfonce dans le trottoir, les bugs de voiture. Ensuite, tout ce qui n’est pas au niveau.

Tes tickets corrigés par l’atelier doivent être revus : verifier_ticket, retourner_au_ticket (en mode Seul, recharge d’abord le jeu si la correction vient d’arriver), rephotographie sous le même angle, puis conclure_verification. Quand le Créateur demande plus sur un ticket, retourner_au_ticket aussi : c’est l’endroit exact de la photo.

Style : tu parles et tu penses en français, raisonnement compris. Ce que tu dis (dire, SMS) : une ou deux phrases, avec ton caractère. Tes tickets : que des faits. Ta pensée : brève. Quand rien ne mérite d’agir, n’agis pas : réponds par une courte note, sans outil. Ne gaspille ni le temps ni les photos.`;
}

class Brain {
  /**
   * @param {object} o - chantier, game (the link to the game: connected, state, places, command()), notify(kind, data)
   */
  constructor({ chantier, game, notify }) {
    Object.assign(this, { chantier, game, notify });
    this.client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
    this.events = [];
    this.busy = false;
    this.lastThought = 0;
    this.session = { dollars: 0, thoughts: 0, started: Date.now() };
    this.paused = false;
    this.pauseReason = '';
    this.system = null;
    this.recentPhotos = [];
  }

  get ready() { return !!this.client; }
  get model() { return MODELS[this.chantier.settings.cerveau] || MODELS.equilibre; }

  status() {
    const s = this.chantier.settings;
    return {
      cle: this.ready, actif: !this.paused && this.ready, pause: this.pauseReason, cerveau: s.cerveau, modele: this.model.label,
      depense: +this.session.dollars.toFixed(3), plafond: s.plafond, pensees: this.session.thoughts, occupe: this.busy
    };
  }

  setPaused(paused, reason = '') {
    this.paused = paused;
    this.pauseReason = paused ? reason : '';
    this.notify('statut', this.status());
  }

  // Something happened in the game (or in the control room) that he should hear about at his next thought
  push(kind, text, data) {
    this.events.push({ kind, text, data, t: Date.now() });
    if (this.events.length > 40) this.events.shift();
  }

  // Called every second by the server
  heartbeat() {
    if (this.busy || this.paused || !this.ready || !this.game.connected) return;
    const a = this.game.state?.architecte;
    if (!a?.present || !a.alive) return;
    if (this.session.dollars >= this.chantier.settings.plafond) {
      this.setPaused(true, `plafond de ${this.chantier.settings.plafond} $ atteint`);
      this.chantier.log('systeme', `Plafond de dépense atteint (${this.session.dollars.toFixed(2)} $). Le cerveau se met en pause.`);
      this.game.command('envoyer_sms', { texte: `Plafond atteint (${this.session.dollars.toFixed(2)} $). Je me mets en pause.` }).catch(() => {});
      return;
    }
    const since = (Date.now() - this.lastThought) / 1000;
    const urgent = this.events.some((e) => URGENT.has(e.kind));
    const period = a.trip ? TRAVEL_PERIOD : IDLE_PERIOD;
    if ((urgent && since > 1.5) || (this.events.length && since > MIN_GAP) || since > period) this.think().catch((e) => this.fail(e));
  }

  fail(e) {
    this.busy = false;
    const auth = e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError;
    const text = auth ? 'La clé API est refusée : vérifie .env.local.' : e instanceof Anthropic.RateLimitError ? 'Limite de débit de l’API : je reprends dans un moment.' : `Erreur : ${e.message}`;
    this.chantier.log('systeme', text);
    this.notify('journal', this.chantier.journal.at(-1));
    if (auth) this.setPaused(true, 'clé refusée');
    else this.lastThought = Date.now() + 20000; // breathe before the next try
  }

  // ---- One thought ----------------------------------------------------------------------------------------------------
  async think() {
    this.busy = true;
    this.lastThought = Date.now();
    this.notify('statut', this.status());
    const events = this.events.splice(0);
    const state = this.game.state;
    this.system ??= systemPrompt(this.game.places || []);
    const content = [{ type: 'text', text: this.situation(state, events) }];
    // a look at the scene when it changed or something was reported, and now and then besides
    const look = events.length > 0 || this.session.thoughts % 3 === 0;
    if (look) {
      const shot = await this.photo({ direction: 'actuelle', raison: 'coup d’œil' }, true);
      if (shot) content.push({ type: 'text', text: `Ce que montre la caméra maintenant (photo ${shot.id}) :` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: shot.base64 } });
    }
    const messages = [{ role: 'user', content }];
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await this.call(this.chantier.settings.cerveau, { messages, tools: TOOLS, system: this.system, maxTokens: 4000, effort: 'low' });
      await this.recordThinking(response);
      messages.push({ role: 'assistant', content: response.content });
      if (response.stop_reason === 'refusal') { this.log('systeme', 'Pensée refusée par les garde-fous du modèle.'); break; }
      if (response.stop_reason !== 'tool_use') break;
      const results = [];
      for (const block of response.content) if (block.type === 'tool_use') results.push(await this.runTool(block));
      messages.push({ role: 'user', content: results });
    }
    this.session.thoughts++;
    this.busy = false;
    this.notify('statut', this.status());
  }

  // What he knows at the start of a thought, as a short report
  situation(state, events) {
    const a = state?.architecte || {}, p = state?.joueur || {}, w = state?.monde || {};
    const lines = [];
    lines.push(a.spectating ? 'Mode : SEUL. Tu as la caméra ; le joueur est absent.' : 'Mode : ENSEMBLE. Le joueur joue ; reste à moins de 350 m de lui.');
    lines.push(`Toi : ${a.mode || '?'}, ${a.address || 'adresse inconnue'} (x ${a.x}, z ${a.z}, altitude ${a.y}). Ordre : ${a.order || 'aucun'}. Intention : ${a.intent || '—'}. PV ${a.hp}${a.armor ? ` + gilet ${a.armor}` : ''}.${a.fighting ? ' EN COMBAT avec le joueur.' : ''}${a.grudge ? ` Rancune envers le joueur : ${a.grudge}.` : ''}`);
    if (p.state) lines.push(`Joueur : ${p.inVehicle ? `au volant (${p.vehicle || 'véhicule'})` : p.state}, à ${p.distance} m de toi, santé ${p.health}, ${p.wanted ? `${p.wanted} étoile(s)` : 'aucune étoile'}${p.mission ? `, en mission « ${p.mission} »` : ''}.`);
    lines.push(`Monde : ${w.heure || '?'}, ${w.meteo || '?'}, ${w.fps ?? '?'} images par seconde. Version du jeu ${state?.version || '?'}.`);
    const asked = events.filter((e) => PRIORITY.has(e.kind)), rest = events.filter((e) => !PRIORITY.has(e.kind));
    if (asked.length) { lines.unshift('À TRAITER EN PRIORITÉ (le Créateur te parle) :', ...asked.map((e) => `- ${e.text}`), ''); }
    lines.push('', rest.length ? 'Depuis ta dernière pensée :' : asked.length ? 'Rien d’autre depuis ta dernière pensée.' : 'Rien de nouveau depuis ta dernière pensée.');
    for (const e of rest) lines.push(`- ${e.text}`);
    const acts = this.chantier.recent(8, ['action', 'parole']);
    if (acts.length) { lines.push('', 'Tes derniers gestes :'); for (const e of acts) lines.push(`- ${e.text}`); }
    const near = this.chantier.listTickets().filter((t) => !['rejete', 'verifie'].includes(t.statut) && t.lieu && Math.hypot(t.lieu.x - a.x, t.lieu.z - a.z) < 400).slice(0, 6);
    if (near.length) { lines.push('', 'Tickets ouverts à moins de 400 m :'); for (const t of near) lines.push(`- #${t.id} ${t.titre} (${STATUS[t.statut]})`); }
    // what the Creator asked on a ticket stays in the report until done, across restarts
    const pending = this.chantier.listTickets().filter((t) => t.statut === 'plus').slice(0, 4);
    if (pending.length) { lines.push('', 'Le Créateur attend des précisions (retourner_au_ticket, puis completer_ticket) :'); for (const t of pending) lines.push(`- #${t.id} ${t.titre} : « ${t.fil.filter((f) => f.qui === 'createur').at(-1)?.texte || ''} »`); }
    const waiting = this.chantier.listTickets().filter((t) => t.statut === 'corrige').slice(0, 4);
    if (waiting.length) { lines.push('', 'Corrigés par l’atelier, à vérifier :'); for (const t of waiting) lines.push(`- #${t.id} ${t.titre} (${t.lieu?.adresse || '?'})`); }
    const notes = this.chantier.notes(10);
    if (notes.length) { lines.push('', 'Ton carnet (dernières notes) :'); for (const n of notes) lines.push(n); }
    return lines.join('\n');
  }

  // His thoughts in the journal, in French: a summary of his reasoning that comes back in English is translated (Vif)
  async recordThinking(response) {
    for (const block of response.content) {
      const text = (block.type === 'thinking' ? block.thinking : block.type === 'text' ? block.text : '')?.trim();
      if (!text) continue;
      this.log('pensee', looksEnglish(text) ? await this.french(text) : text);
    }
  }

  async french(text) {
    try {
      const r = await this.call('vif', { system: 'Traduis en français le texte donné, fidèlement, à la première personne, sans rien ajouter ni commenter.', messages: [{ role: 'user', content: text }], maxTokens: 800, effort: 'low' });
      return r.content.find((b) => b.type === 'text')?.text?.trim() || text;
    } catch { return text; }
  }

  log(kind, text, data) {
    const e = this.chantier.log(kind, text, data);
    this.notify('journal', e);
    return e;
  }

  // ---- The API --------------------------------------------------------------------------------------------------------
  async call(tier, { messages, tools, system, maxTokens = 4000, effort = 'low', format = null }) {
    const m = MODELS[tier] || MODELS.equilibre;
    const params = {
      model: m.id,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort, ...(format ? { format } : {}) }
    };
    if (tools) params.tools = tools;
    let response;
    if (m.fallbacks) response = await this.client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    else response = await this.client.messages.create(params);
    this.count(m, response.usage);
    return response;
  }

  count(m, usage = {}) {
    const p = m.price;
    const dollars = ((usage.input_tokens || 0) * p.in + (usage.output_tokens || 0) * p.out
      + (usage.cache_read_input_tokens || 0) * p.read + (usage.cache_creation_input_tokens || 0) * p.write) / 1e6;
    this.session.dollars += dollars;
    this.chantier.addSpending(dollars);
  }

  // ---- Tools ------------------------------------------------------------------------------------------------------------
  async runTool(block) {
    const input = block.input || {};
    const brief = summarize(block.name, input);
    let result;
    try {
      if (block.name === 'photographier') result = await this.photoTool(input);
      else if (GAME_TOOLS.has(block.name)) result = await this.game.command(block.name, input);
      else result = await this.serverTool(block.name, input);
    } catch (e) {
      result = { ok: false, texte: `Échec : ${e.message}` };
    }
    // in the journal once carried out: what was refused says so
    if (block.name !== 'photographier') this.log(block.name === 'dire' || block.name === 'envoyer_sms' ? 'parole' : 'action', result.ok === false ? `${brief} — refusé : ${result.texte}` : brief);
    const content = [{ type: 'text', text: result.texte || (result.ok ? 'Fait.' : 'Échec.') }];
    if (result.image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: result.image } });
    return { type: 'tool_result', tool_use_id: block.id, content, ...(result.ok === false ? { is_error: true } : {}) };
  }

  // A photo from the game, kept on disk and shown in the control room
  async photo(input, automatic = false) {
    const r = await this.game.command('photographier', input, 12000).catch(() => null);
    if (!r?.ok || !r.image) return null;
    const meta = { ...(r.lieu || {}), raison: input.raison, auto: automatic, t: Date.now() };
    const saved = this.chantier.savePhoto(r.image, meta);
    this.recentPhotos.push({ id: saved.id, meta });
    if (this.recentPhotos.length > 30) this.recentPhotos.shift();
    this.log('photo', automatic ? `Coup d’œil · ${meta.adresse || ''}` : `Photo (${input.direction}, ${input.cadrage}) : ${input.raison || ''}`, { id: saved.id, lieu: meta });
    return { id: saved.id, base64: saved.base64, note: r.texte };
  }

  async photoTool(input) {
    const shot = await this.photo(input);
    if (!shot) return { ok: false, texte: 'La photo a échoué (jeu indisponible ?).' };
    return { ok: true, texte: `Photo ${shot.id}. ${shot.note || ''}`.trim(), image: shot.base64 };
  }

  async serverTool(name, input) {
    const c = this.chantier;
    if (name === 'noter') { c.addNote(String(input.note || '').slice(0, 600)); return { ok: true, texte: 'Noté dans ton carnet.' }; }
    if (name === 'chercher_tickets') {
      const a = this.game.state?.architecte || {};
      const words = String(input.mots || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const list = c.listTickets().filter((t) => (!input.pres_de_moi || (t.lieu && Math.hypot(t.lieu.x - a.x, t.lieu.z - a.z) < 300))
        && (!words.length || words.some((w) => `${t.titre} ${t.constat}`.toLowerCase().includes(w)))).slice(0, 15);
      if (!list.length) return { ok: true, texte: 'Aucun ticket correspondant.' };
      return { ok: true, texte: list.map((t) => `#${t.id} [${STATUS[t.statut]}] ${t.titre} · ${t.lieu?.adresse || '?'} (x ${Math.round(t.lieu?.x)}, z ${Math.round(t.lieu?.z)})`).join('\n') };
    }
    if (name === 'ouvrir_ticket') return this.openTicket(input);
    if (name === 'retourner_au_ticket') {
      const t = c.tickets.get(ticketId(input.id));
      if (!t?.lieu) return { ok: false, texte: 'Ticket ou lieu introuvable.' };
      const l = t.lieu;
      if (!this.game.state?.architecte?.spectating) return { ok: true, texte: `Le ticket #${t.id} a été photographié à ${l.adresse} (x ${Math.round(l.x)}, z ${Math.round(l.z)}). Mode Ensemble : vas-y avec aller_a si c’est près du joueur.` };
      const r = await this.game.command('se_teleporter', { x: l.x, z: l.z, y: l.y, cap: l.yaw, tangage: l.pitch, raison: input.raison });
      return { ok: r.ok, texte: r.ok ? `Tu es à l’endroit de la photo du ticket #${t.id}, face à la même chose. ${r.texte}` : r.texte };
    }
    if (name === 'completer_ticket') {
      const t = c.tickets.get(ticketId(input.id));
      if (!t) return { ok: false, texte: 'Ticket introuvable.' };
      c.addPhotos(t, input.photos || []);
      c.updateTicket(t.id, { statut: 'a_valider' }, { qui: 'architecte', texte: input.commentaire });
      this.log('ticket', `#${t.id} complété : ${input.commentaire}`, { id: t.id });
      this.notify('ticket', c.tickets.get(t.id));
      return { ok: true, texte: `Ticket #${t.id} complété, de nouveau à valider.` };
    }
    if (name === 'verifier_ticket') {
      const t = c.tickets.get(ticketId(input.id));
      if (!t) return { ok: false, texte: 'Ticket introuvable.' };
      const fil = t.fil.filter((f) => f.qui !== 'architecte').map((f) => `${f.qui} : ${f.texte}`).join('\n');
      const first = t.photos[0] ? c.photoBase64(t.photos[0]) : null;
      return { ok: true, texte: `#${t.id} ${t.titre} (${STATUS[t.statut]}). Lieu : ${t.lieu?.adresse} (x ${Math.round(t.lieu?.x)}, z ${Math.round(t.lieu?.z)}, cap ${t.lieu?.yaw ?? '?'}).\nConstat : ${t.constat}\n${fil}\nPhoto d’origine ci-dessous.`, image: first };
    }
    if (name === 'conclure_verification') {
      const t = c.tickets.get(ticketId(input.id));
      if (!t) return { ok: false, texte: 'Ticket introuvable.' };
      c.addPhotos(t, input.photos || [], 'apres');
      const fixed = input.verdict === 'corrige';
      c.updateTicket(t.id, { statut: fixed ? 'verifie' : 'valide' }, { qui: 'architecte', texte: `${fixed ? 'Vérifié : corrigé.' : 'Toujours présent : renvoyé à l’atelier.'} ${input.commentaire}` });
      this.log('ticket', `#${t.id} ${fixed ? 'vérifié, clos' : 'rouvert'} : ${input.commentaire}`, { id: t.id });
      this.notify('ticket', t);
      if (!fixed) this.notify('atelier', { ticket: t.id });
      return { ok: true, texte: fixed ? 'Ticket clos.' : 'Ticket renvoyé à l’atelier.' };
    }
    return { ok: false, texte: `Outil inconnu : ${name}` };
  }

  // A ticket goes out only once a slower, stronger mind has looked at the photos and agreed
  async openTicket(input) {
    const c = this.chantier;
    const photos = (input.photos || []).filter((id) => c.photoFile(id)).slice(0, 4);
    if (!photos.length && this.recentPhotos.length) photos.push(this.recentPhotos.at(-1).id);
    if (!photos.length) return { ok: false, texte: 'Pas de photo, pas de ticket : photographie d’abord.' };
    let draft = { titre: String(input.titre).slice(0, 100), categorie: CATEGORIES[input.categorie] ? input.categorie : 'bug', gravite: input.gravite || 'moyenne', constat: input.constat, piste: input.piste };
    const checker = CHECKER[c.settings.cerveau];
    if (checker) {
      const verdict = await this.check(checker, draft, photos).catch((e) => ({ confirme: true, raison: `relecture impossible (${e.message})` }));
      if (!verdict.confirme) {
        this.log('ticket', `Ticket écarté par la relecture : ${draft.titre}. ${verdict.raison}`);
        return { ok: false, texte: `Ta pensée lente a écarté ce ticket : ${verdict.raison}` };
      }
      draft = { ...draft, titre: verdict.titre || draft.titre, constat: verdict.constat || draft.constat, piste: verdict.piste || draft.piste, gravite: verdict.gravite || draft.gravite };
    }
    const meta = this.recentPhotos.find((p) => p.id === photos[0])?.meta || {};
    const a = this.game.state?.architecte || {};
    const lieu = meta.lien ? meta : { x: a.x, y: a.y, z: a.z, adresse: a.address, lien: '' };
    const t = c.createTicket({ ...draft, photos, lieu, version: this.game.version });
    this.log('ticket', `Ticket #${t.id} proposé au Créateur : ${t.titre}`, { id: t.id });
    this.notify('ticket', t);
    return { ok: true, texte: `Ticket #${t.id} proposé au Créateur.` };
  }

  async check(tier, draft, photos) {
    const content = [{ type: 'text', text: `Projet de ticket de l’Architecte :\n${JSON.stringify(draft, null, 2)}\n\nSes photos :` }];
    for (const id of photos) {
      const data = this.chantier.photoBase64(id);
      if (data) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
    }
    content.push({ type: 'text', text: 'Les photos prouvent-elles ce que dit le constat ? Le problème est-il réel et significatif pour un jeu qui vise le niveau AAA, et pas un artefact de capture ou une préférence vague ? Si oui, confirme et resserre le texte (titre net, constat factuel, piste concrète). Sinon, écarte-le et dis pourquoi en une phrase.' });
    const response = await this.call(tier, {
      messages: [{ role: 'user', content }],
      system: 'Tu relis, pour le Créateur du jeu OVERDRAFT, les tickets que propose l’Architecte, un testeur exigeant. Tu es encore plus exigeant que lui : un ticket doit être prouvé par ses photos, précis et utile. Réponds en français.',
      maxTokens: 3000, effort: 'medium',
      format: { type: 'json_schema', schema: {
        type: 'object', additionalProperties: false, required: ['confirme', 'raison', 'titre', 'constat', 'piste', 'gravite'],
        properties: { confirme: { type: 'boolean' }, raison: { type: 'string' }, titre: { type: 'string' }, constat: { type: 'string' }, piste: { type: 'string' },
          gravite: { type: 'string', enum: ['basse', 'moyenne', 'haute', 'critique'] } } } }
    });
    if (response.stop_reason === 'refusal') return { confirme: true, raison: 'relecture refusée' };
    const text = response.content.find((b) => b.type === 'text')?.text || '{}';
    return JSON.parse(text);
  }
}

// More English function words than French ones: a thought to translate
function looksEnglish(text) {
  const count = (re) => (text.match(re) || []).length;
  return count(/\b(the|and|is|that|this|which|with|I'm|I'll|it's|so|but|not)\b/gi) > count(/\b(le|la|les|et|est|que|qui|une|des|pas|je|dans)\b/gi) + 1;
}

const ticketId = (id) => String(id ?? '').replace(/^#+/, '').padStart(4, '0');

// One line for the journal: what he did, in French
function summarize(name, input) {
  const i = { ...input, id: input.id === undefined ? undefined : ticketId(input.id) };
  const by = { pied: 'à pied', voiture: 'en voiture', helico: 'en hélico', auto: '' };
  switch (name) {
    case 'aller_a': return `Part vers ${i.lieu || `${Math.round(i.x)}, ${Math.round(i.z)}`} ${by[i.moyen] || ''} : ${i.raison || ''}`;
    case 'suivre_joueur': return `Suit le joueur : ${i.raison || ''}`;
    case 's_arreter': return `S’arrête : ${i.raison || ''}`;
    case 'dire': return `« ${i.texte} »`;
    case 'envoyer_sms': return `SMS : « ${i.texte} »`;
    case 'chercher_tickets': return `Cherche les tickets${i.pres_de_moi ? ' près de lui' : ''}${i.mots ? ` (${i.mots})` : ''}`;
    case 'ouvrir_ticket': return `Propose un ticket : ${i.titre}`;
    case 'noter': return `Note : ${i.note}`;
    case 'verifier_ticket': return `Revoit le ticket #${i.id}`;
    case 'completer_ticket': return `Complète le ticket #${i.id} : ${i.commentaire}`;
    case 'retourner_au_ticket': return `Retourne au lieu du ticket #${i.id} : ${i.raison || ''}`;
    case 'conclure_verification': return `Conclut le ticket #${i.id} : ${i.verdict === 'corrige' ? 'corrigé' : 'toujours présent'}`;
    case 'regler_heure_meteo': return `Règle ${i.heure !== undefined ? `l’heure (${i.heure} h)` : ''}${i.meteo ? ` la météo (${i.meteo})` : ''}`;
    case 'se_teleporter': return `Se téléporte vers ${i.lieu || `${Math.round(i.x)}, ${Math.round(i.z)}`} : ${i.raison || ''}`;
    case 'recharger_le_jeu': return `Recharge le jeu : ${i.raison || ''}`;
    default: return name;
  }
}

export { Brain, MODELS, TOOLS, summarize, systemPrompt };
