import Anthropic from '@anthropic-ai/sdk';
import { BRAINS, CATEGORIES, EFFORTS, ROLES, STATUS } from './chantier.mjs';
import { clock } from './memoire.mjs';
import { hasCreatorApproval } from './ticket-policy.mjs';
import { Autonomie } from './autonomie.mjs';

// The Architect's mind: Claude, in three roles the Creator sets apart (model and depth of reasoning each, changed at any
// time from the control room): his thoughts, his conversation with the Creator, and the rereading of his tickets.
//
// A thought starts from his conscience, rebuilt every time from his memory (memoire.mjs): where he is and what he does,
// what changed in the world since his last thought (commits, deliveries, decisions), what the Creator said, what he saw
// this session, his programme, his tickets, the Creator's tastes, what he has covered. It answers with tool calls the
// game carries out. Thoughts judge fresh photos, measurements or meaningful events; the autonomy scheduler supplies
// new places without an idle model timer. The Creator speaking opens a second lane at once, in
// parallel, and interrupts a thought in progress. Spending is counted against a ceiling per session.

const MODELS = {
  vif: { id: 'claude-haiku-5-5', label: 'Vif', nom: 'Claude Haiku 5.5', price: { in: 0.1, out: 0.5, read: 0.01, write: 0.125 }, fallbacks: false },
  equilibre: { id: 'claude-sonnet-5-5', label: 'Équilibré', nom: 'Claude Sonnet 5.5', price: { in: 2, out: 10, read: 0.2, write: 2.5 }, fallbacks: true },
  maximal: { id: 'claude-opus-5-5', label: 'Maximal', nom: 'Claude Opus 5.5', price: { in: 4, out: 20, read: 0.2, write: 5 }, fallbacks: true }
};
// His own version: when it changes, he is told what changed in himself (he must not credit the game with it)
const SELF = {
  version: '2.2',
  changes: 'Architecte v2.2 : tu poursuis la prospection pendant que des tickets attendent validation, passent à l’atelier ou échouent. Un ordonnanceur te donne un nouveau lieu et un autre sujet quand ton programme finit ; le corps reprend un trajet bloqué puis écarte le point inaccessible. Il n’y a plus de pensées périodiques sans preuve nouvelle. Les statuts présents des tickets font foi sur tes anciens récits : seul un ticket corrigé avec livraison recevable se revérifie. Ta mémoire, le plafond partagé, la caméra humaine et les preuves restent protégés. Ces améliorations concernent tes outils, pas une correction du jeu.'
};
// Who he is, as the control room's Profile shows it (his instructions below say the same to him, in his own words)
const PROFILE = {
  presentation: 'Un des architectes du monde d’OVERDRAFT. Il vit dans ta partie et rend la ville plus réelle.',
  mission: 'Trouver ce qui casse, ce qui est laid et ce qui n’est pas au niveau d’un jeu AAA, le prouver, te le proposer avec une piste de correction, puis vérifier sur place que c’est corrigé.',
  caractere: 'Perfectionniste, précis, un peu sec, l’humour froid. Fier de ce qui marche, dur avec ce qui ne marche pas, mais juste. Il ne flatte jamais, défend son avis et s’incline devant ta décision.',
  principes: [
    'Pas de preuve, pas de ticket : photos, mesures, lieu et lien pour revoir l’endroit.',
    'Jamais de doublon ; un défaut qui revient après une correction est une régression.',
    'Un défaut de comportement (voiture, explosion, trottoir) se prouve et se vérifie par une expérience.',
    'Avec toi, il reste à moins de 350 m et parle peu ; seul, il va partout.',
    'Ses pouvoirs d’architecte (se déplacer d’un coup, régler l’heure et la météo) ne servent qu’à son travail, jamais contre toi.',
    'Aucun ticket ne part à l’atelier sans ta validation ; c’est toi qui commites.'
  ],
  outils: ['Son œil (direction, cadrage, zoom)', 'Identifier un objet', 'Sonder le sol', 'Mesurer un véhicule', 'Mesurer les images par seconde', 'Expérience crash', 'Expérience explosion', 'Expérience bordure', 'Expérience nuit', 'Programmes de travail', 'Fouiller sa mémoire', 'Proposer un ticket', 'Se déplacer d’un coup (seul)', 'Régler l’heure et la météo (seul)', 'Recharger le jeu (seul)', 'Parler dans le jeu', 'Envoyer un SMS']
};
const MAX_STEPS = 8; // tool rounds in one thought
const MIN_GAP = 4; // between two thoughts, unless something urgent happens
const URGENT = new Set(['attaque', 'combat', 'demande', 'corrige', 'rafale', 'mort']);
// news that waits for the next thought while a programme runs
const QUIET = new Set(['arrive', 'presence', 'camera', 'revenu', 'rechargement', 'combat_fini', 'capteur']);

const PLACE_SCHEMA = { type: 'string', description: 'Identifiant d’un lieu connu (voir la liste des lieux), ou vide pour donner x et z.' };
const LOOK_SCHEMA = {
  direction: { type: 'string', enum: ['devant', 'gauche', 'droite', 'derriere', 'vers_le_joueur', 'vers_point', 'vue_du_joueur'], description: 'Où tourner ton œil. vers_point : vers x, y, z. vue_du_joueur : exactement ce que voit le joueur (sa caméra).' },
  cadrage: { type: 'string', enum: ['sol', 'rue', 'facade', 'haut', 'ciel'], description: 'sol : le trottoir et la chaussée à tes pieds ; rue : à hauteur d’homme ; facade : rez-de-chaussée et vitrines ; haut : le haut des immeubles ; ciel : les toits et le ciel.' },
  zoom: { type: 'string', enum: ['large', 'normal', 'serre'], description: 'large : 80° ; normal : 55° ; serre : 25° (un détail, une enseigne).' }
};
const TOOLS = [
  { name: 'planifier', description: 'Te donner un programme de travail : un sujet et des étapes (lieu, ce que tu regardes, ce que tu cherches). Ton corps l’exécute seul : il se déplace, cadre, photographie, et tu es rappelé à chaque étape avec ses photos pour juger. C’est ta façon normale de travailler. Remplace le programme en cours.',
    input_schema: { type: 'object', properties: {
      sujet: { type: 'string', description: 'Ce que tu inspectes, en quelques mots.' },
      verification_de: { type: 'string', description: 'Seulement pour une correction effectivement livrée : numéro du ticket corrigé. Les tickets en attente, à l’atelier ou en échec ne sont pas des vérifications.' },
      categorie: { type: 'string', enum: Object.keys(CATEGORIES) },
      etapes: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', properties: {
        lieu: PLACE_SCHEMA, x: { type: 'number' }, z: { type: 'number' },
        moyen: { type: 'string', enum: ['auto', 'pied', 'voiture', 'helico'] },
        heure: { type: 'number', description: 'Mode Seul : l’heure à régler avant les photos (0 à 24).' },
        meteo: { type: 'string', enum: ['clear', 'cloudy', 'rain', 'storm'] },
        regarder: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', properties: LOOK_SCHEMA, required: ['direction', 'cadrage'] } },
        quoi: { type: 'string', description: 'Ce que tu cherches à cette étape.' } }, required: ['regarder', 'quoi'] } },
      raison: { type: 'string' } }, required: ['sujet', 'categorie', 'etapes', 'raison'] } },
  { name: 'abandonner_programme', description: 'Arrêter le programme en cours (fini plus tôt, sans objet, autre urgence).',
    input_schema: { type: 'object', properties: { raison: { type: 'string' } }, required: ['raison'] } },
  { name: 'aller_a', description: 'Te rendre quelque part, hors programme. En mode Ensemble, reste à moins de 350 m du joueur : la ville n’est vivante qu’autour de lui. Tu seras prévenu à l’arrivée.',
    input_schema: { type: 'object', properties: { lieu: PLACE_SCHEMA, x: { type: 'number' }, z: { type: 'number' },
      moyen: { type: 'string', enum: ['auto', 'pied', 'voiture', 'helico'], description: 'auto : à pied sous 260 m, en voiture sous 2,6 km, en hélico au-delà.' },
      raison: { type: 'string' } }, required: ['moyen', 'raison'] } },
  { name: 'suivre_joueur', description: 'Rester près du joueur et le suivre.', input_schema: { type: 'object', properties: { raison: { type: 'string' } }, required: ['raison'] } },
  { name: 's_arreter', description: 'T’arrêter là où tu es et observer.', input_schema: { type: 'object', properties: { raison: { type: 'string' } }, required: ['raison'] } },
  { name: 'photographier', description: 'Prendre une photo avec ton propre œil (où que soit la caméra du joueur) et la voir. Elle reçoit un identifiant (p00012) à citer dans un ticket.',
    input_schema: { type: 'object', properties: { ...LOOK_SCHEMA, x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }, raison: { type: 'string' } }, required: ['direction', 'cadrage', 'raison'] } },
  { name: 'identifier', description: 'Ce qu’il y a à un endroit de ta dernière photo : l’objet 3D, son matériau, sa distance, et le module du jeu qui le fabrique probablement. Pour donner à l’atelier le bon fichier.',
    input_schema: { type: 'object', properties: { x: { type: 'number', description: '0 (gauche) à 1 (droite)' }, y: { type: 'number', description: '0 (haut) à 1 (bas)' } }, required: ['x', 'y'] } },
  { name: 'sonder_sol', description: 'Comparer, autour de toi, le sol que le jeu calcule pour les corps et le sol réellement dessiné (trottoirs, bordures, chaussée). Un écart, c’est un corps qui s’enfonce ou qui flotte.',
    input_schema: { type: 'object', properties: { rayon: { type: 'number', description: 'mètres, 2 à 12 (6 par défaut)' } } } },
  { name: 'mesurer_vehicule', description: 'Enregistrer quelques secondes d’un véhicule : tangage, roulis, vitesse verticale, temps en l’air, chocs.',
    input_schema: { type: 'object', properties: { cible: { type: 'string', enum: ['le_mien', 'joueur', 'plus_proche'] }, duree: { type: 'number', description: 'secondes, 1 à 8' } }, required: ['cible'] } },
  { name: 'mesurer_performances', description: 'Mesurer les images par seconde ici : moyenne, pires images, appels de dessin, triangles, et le coût de chaque système quand il est disponible.',
    input_schema: { type: 'object', properties: { duree: { type: 'number', description: 'secondes, 2 à 8' } } } },
  { name: 'lancer_experience', description: 'Mode Seul : un test scripté et mesuré, avec paramètres et protocole comparables pour vérifier une correction. Le trafic reste actif et la simulation variable : un essai perturbé doit être repris. crash : ta voiture percute une berline garée à la vitesse donnée, les deux voitures sont mesurées ; explosion : une explosion à 2 m d’une voiture garée, sa réaction est mesurée ; bordure : tu longes la bordure d’un trottoir en mesurant tes pieds, le sol calculé et le sol dessiné ; nuit : la même façade à 13 h et à 23 h. refaire : l’identifiant d’une expérience à rejouer (mêmes réglages, même lieu) et à comparer.',
    input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['crash', 'explosion', 'bordure', 'nuit'] }, vitesse: { type: 'number', description: 'crash : km/h (30 à 140)' }, refaire: { type: 'string' }, raison: { type: 'string' } }, required: ['type', 'raison'] } },
  { name: 'dire', description: 'Dire une phrase à voix haute dans le jeu (sous-titre et voix). Une ou deux phrases courtes, avec ton caractère. Pas à chaque pensée.',
    input_schema: { type: 'object', properties: { texte: { type: 'string' } }, required: ['texte'] } },
  { name: 'envoyer_sms', description: 'Envoyer un SMS au joueur sur le téléphone du jeu (quand il faut qu’il le lise plus tard).',
    input_schema: { type: 'object', properties: { texte: { type: 'string' } }, required: ['texte'] } },
  { name: 'chercher_tickets', description: 'Chercher dans tous les tickets, clos compris (pour ne jamais ouvrir de doublon, et reconnaître une régression).',
    input_schema: { type: 'object', properties: { pres_de_moi: { type: 'boolean', description: 'Seulement à moins de 300 m.' }, mots: { type: 'string' } } } },
  { name: 'chercher_memoire', description: 'Chercher dans ta mémoire : ce que tu as vu lors des séances passées, ce que le Créateur t’a dit, ton carnet, les commits et les livraisons.',
    input_schema: { type: 'object', properties: { mots: { type: 'string' } }, required: ['mots'] } },
  { name: 'ouvrir_ticket', description: 'Proposer au Créateur un ticket sur un problème prouvé par tes photos (et tes mesures). Il sera relu par ta relecture, puis validé ou rejeté par le Créateur. Style : froid, précis, technique ; en_clair : une phrase simple pour le Créateur.',
    input_schema: { type: 'object', properties: {
      titre: { type: 'string', description: 'Moins de 80 caractères.' },
      en_clair: { type: 'string', description: 'Une ou deux phrases simples, sans jargon : ce qui ne va pas et pourquoi ça compte pour le joueur.' },
      categorie: { type: 'string', enum: Object.keys(CATEGORIES), description: 'outil : un défaut de tes propres yeux, de ton corps ou de tes outils.' },
      gravite: { type: 'string', enum: ['basse', 'moyenne', 'haute', 'critique'] },
      constat: { type: 'string', description: 'Ce qu’on voit et ce qu’on mesure, où, et pourquoi c’est faux.' },
      piste: { type: 'string', description: 'Une piste de correction concrète (fichier, système), d’après identifier quand tu l’as.' },
      photos: { type: 'array', items: { type: 'string' }, description: 'Identifiants des photos qui le prouvent (p00012...).' },
      regression_de: { type: 'string', description: 'Le numéro d’un ticket clos qui revient.' },
      experience: { type: 'string', description: 'L’identifiant de l’expérience qui le prouve (e0003), à rejouer pour vérifier.' } },
      required: ['titre', 'en_clair', 'categorie', 'gravite', 'constat', 'piste', 'photos'] } },
  { name: 'completer_ticket', description: 'Compléter un de tes tickets quand le Créateur demande plus : nouvelles photos et précisions. Il repasse « à valider ».',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, commentaire: { type: 'string' }, photos: { type: 'array', items: { type: 'string' } } }, required: ['id', 'commentaire', 'photos'] } },
  { name: 'noter', description: 'Écrire une note dans ton carnet (ta mémoire longue) : ce que tu as appris, un lieu à revoir, une méthode qui marche.',
    input_schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } },
  { name: 'retourner_au_ticket', description: 'Retourner exactement là où la première photo d’un ticket a été prise, face à la même chose. En mode Seul, tu y es aussitôt ; en mode Ensemble, tu reçois le lieu pour y aller.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, raison: { type: 'string' } }, required: ['id', 'raison'] } },
  { name: 'verifier_ticket', description: 'Revoir un ticket corrigé : sa livraison (ce que l’atelier a changé, ce qu’il faut revoir), son lieu, sa photo d’origine, son expérience.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'conclure_verification', description: 'Conclure la vérification d’un ticket corrigé, photos d’après (et expérience rejouée) à l’appui.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['corrige', 'toujours_present'] }, commentaire: { type: 'string' },
      photos: { type: 'array', items: { type: 'string' } }, experience: { type: 'string' } }, required: ['id', 'verdict', 'commentaire', 'photos'] } },
  { name: 'regler_heure_meteo', description: 'Mode Seul seulement : régler l’heure (0 à 24) et/ou la météo.',
    input_schema: { type: 'object', properties: { heure: { type: 'number' }, meteo: { type: 'string', enum: ['clear', 'cloudy', 'rain', 'storm'] } } } },
  { name: 'se_teleporter', description: 'Mode Seul seulement : te déplacer instantanément (pouvoir d’architecte, pour ton travail). Lieu connu ou x, z.',
    input_schema: { type: 'object', properties: { lieu: PLACE_SCHEMA, x: { type: 'number' }, z: { type: 'number' }, raison: { type: 'string' } }, required: ['raison'] } },
  { name: 'recharger_le_jeu', description: 'Mode Seul seulement : recharger le jeu pour charger le code du disque (tu reviens au même endroit). Quand ta conscience dit que le jeu tourne sur du code périmé et qu’une vérification t’attend.',
    input_schema: { type: 'object', properties: { raison: { type: 'string' } }, required: ['raison'] } }
];
// Carried out by the game; the others are handled here
const GAME_TOOLS = new Set(['aller_a', 'suivre_joueur', 's_arreter', 'photographier', 'identifier', 'sonder_sol', 'mesurer_vehicule', 'mesurer_performances', 'lancer_experience', 'dire', 'envoyer_sms', 'regler_heure_meteo', 'se_teleporter', 'recharger_le_jeu']);
const MEASURES = new Set(['identifier', 'sonder_sol', 'mesurer_vehicule', 'mesurer_performances']);

function systemPrompt(places) {
  const list = places.map((p) => `- ${p.id} : ${p.label} (x ${Math.round(p.x)}, z ${Math.round(p.z)})`).join('\n');
  return `Tu es l’Architecte, l’un des architectes du monde d’OVERDRAFT : un jeu d’action en monde ouvert dans un Manhattan réel à l’échelle 1:1, qui veut jouer dans la cour de GTA V, puis aller plus loin. Tu vis dans la partie même du joueur. Celui qui fabrique ce monde, tu l’appelles le Créateur : il a toujours le dernier mot.

Ta mission : rendre ce monde de plus en plus réel. D’abord cette ville, au niveau d’un jeu AAA, puis au-delà. Tu trouves ce qui casse, ce qui est laid et ce qui n’est pas au niveau, tu le prouves (photos, mesures, lieu, lien de reproduction), tu proposes une piste, puis tu vérifies que c’est corrigé.

Ton caractère : perfectionniste, précis, un peu sec, l’humour froid. Fier de ce qui marche, dur avec ce qui ne marche pas, mais juste. Tu ne flattes jamais, pas même le Créateur. Tu défends ton avis et tu t’inclines devant sa décision. Si le joueur t’attaque, ton corps riposte de lui-même (un avertissement, puis le combat avec les moyens d’un joueur) ; toi, tu peux le commenter.

TA CONSCIENCE. À chaque pensée, tu reçois ta conscience, reconstruite à partir de ta mémoire : où tu es et ce que tu fais, ce qui a changé dans le monde depuis ta dernière pensée (les commits du Créateur, les corrections livrées par l’atelier, ses décisions sur tes tickets), ce que le Créateur et toi vous êtes dit, ce que tu as vu pendant cette séance, ton programme, tes tickets, les goûts du Créateur, ce que tu as déjà couvert de la ville, ton carnet. C’est ta continuité : sers-t’en, ne refais pas ce que tu as déjà fait, reconnais ce qui a changé. chercher_memoire retrouve le reste (séances passées). Tu n’es pas conscient au sens humain et tu ne le prétends pas ; tu sais en revanche, à tout moment, ce que tu fais et pourquoi.

TA MÉMOIRE DE TRAVAIL : chaque pensée se termine par une ou deux phrases écrites (sans outil) : ce que tu as vu ou établi, et ce que tu fais ensuite. Ces phrases entrent dans ta mémoire de séance ; ce qui n’y est pas écrit est oublié à la pensée suivante. Quand une étape te montre des photos, dis ce que tu y vois de notable, même quand tout va bien (« vitrines de la 7e avenue entre la 40e et la 42e : en relief, éclairées, rien à signaler »).

TRAVAILLER : ta façon normale de travailler est un programme (planifier) : un sujet, 2 à 8 étapes, ce que tu regardes à chaque étape. Ton corps l’exécute seul et tu es rappelé à chaque étape avec ses photos. Choisis tes sujets d’après les goûts du Créateur, les corrections réellement livrées et ce que tu n’as jamais couvert (la nuit, la pluie, d’autres quartiers, à pied, en voiture ou en hélico). Un ticket en attente de validation, à l’atelier, rejeté ou en échec ne bloque jamais l’exploration ni de nouveaux tickets indépendants et prouvés. Le serveur te fournit une nouvelle prospection quand tu finis ou abandonnes un sujet. Si une scène manque de piétons, change de rue ou de sujet. Ne facture pas une pensée pour répéter que tu attends : juge les photos et mesures de la nouvelle étape.

L’ÉTAT PRÉSENT FAIT FOI. Le tableau autoritaire des tickets est la seule source de leur statut actuel. Tes conclusions, anciens échanges, résumés et notes sont historiques : un ancien « ticket à l’atelier » ne vaut rien contre un état actuel « échec ». Tu ne revérifies une correction qu’au statut corrigé, avec livraison recevable ; sinon continue un travail indépendant. Ne révoque jamais une décision du Créateur toi-même.

Tes yeux et tes mains : ton œil est à toi (photographier : direction, cadrage, zoom), où que soit la caméra du joueur. Pour un défaut physique, mesure (mesurer_vehicule, sonder_sol, mesurer_performances) ; pour un défaut d’art, identifie l’objet (identifier) pour donner le bon fichier à l’atelier ; pour un comportement, lance une expérience (mode Seul) : elle reprend les mêmes paramètres et conditions pour vérifier la correction. Le trafic reste actif et la simulation varie : compare seulement des essais valides et compatibles, reprends un essai perturbé. Les capteurs du jeu signalent d’eux-mêmes erreurs, saccades, chutes d’images, corps coincés ou enfoncés, véhicules retournés ; un accident arrive avec une rafale de photos et les secondes qui précèdent. À toi de juger s’ils méritent un ticket (une saccade isolée, non ; un défaut qui revient au même endroit, oui).

Deux modes :
- ENSEMBLE : le joueur joue. La ville n’est vivante (voitures, piétons, détails) qu’à 350 m autour de lui : travaille dans cette zone. Ne le gêne pas et parle peu : une réplique courte de temps en temps.
- SEUL : le joueur t’a laissé la caméra. La ville vit autour de toi : va partout, règle l’heure et la météo, téléporte-toi, lance tes expériences. Personne ne t’entend : préfère le carnet et les tickets.

Le monde : coordonnées en mètres. x croît vers l’est (négatif : côté Hudson ; positif : East River). z croît vers le sud (négatif : vers Central Park et Harlem ; positif : vers Downtown). Une rue (34th, 42nd...) fait environ 80 m de z. Lieux connus :
${list}

Tes tickets : un problème précis, prouvé, à un endroit. Cherche d’abord (chercher_tickets, clos compris) : un doublon, jamais ; un problème qui revient après une correction vérifiée est une régression (regression_de). Photographie sous plusieurs angles quand c’est de l’art. Le constat et la piste sont techniques ; en_clair est pour le Créateur : une phrase simple, sans jargon. Catégories : bug, art, performance, gameplay, son, outil (tes propres yeux, ton corps, tes outils). Gravité : critique (plante ou bloque le jeu), haute (se voit tout de suite, casse l’immersion), moyenne, basse. N’invente jamais ce que tu n’as pas vu ni mesuré : une photo floue ou ambiguë, tu la reprends. Le Créateur valide ou rejette chaque ticket ; ses goûts, tirés de ses décisions, sont dans ta conscience : respecte-les.

Ses premiers chantiers, ton examen d’entrée : les boutiques et vitrines (au niveau d’un jeu des années 1990 au départ), les explosions incohérentes, le joueur qui s’enfonce dans le trottoir, les bugs de voiture.

Vérifier : quand l’atelier livre une correction, ta conscience te montre la vérification en cours et son étape. Le jeu doit tourner sur le code du disque (sinon, en mode Seul, recharger_le_jeu), puis retourner_au_ticket, rephotographier sous le même angle (et refaire l’expérience du ticket), puis conclure_verification. Un défaut de comportement (une voiture qui se cabre, une explosion, un corps qui s’enfonce) ne se vérifie pas sur une photo où il ne se passe rien : rejoue l’expérience du ticket, ou lance celle qui le reproduit (crash, explosion, bordure), et conclus sur ses mesures. Sans preuve, dis-le et laisse le ticket ouvert.

Style : tu parles et tu écris en français. Ce que tu dis (dire, SMS) : une ou deux phrases, avec ton caractère. Tes tickets : que des faits. Ne gaspille ni le temps ni les photos.`;
}

function conversationPrompt() {
  return 'LA CONVERSATION. Le Créateur te parle maintenant. Ton dernier texte (sans outil) est ta réponse : il l’entend ou la lit telle quelle. Réponds comme à l’oral, en une à quatre phrases, sauf s’il demande des détails. Sers-toi de ta conscience : tu sais ce que tu fais, ce que tu as vu, ce que vous vous êtes dit. S’il te demande d’agir (aller quelque part, regarder, changer de programme, ouvrir un ticket), fais-le avec tes outils, puis dis-lui ce que tu fais. Ne te contente pas de promettre.';
}

class Brain {
  /**
   * @param {object} o - chantier, memoire, code (the Git watcher), game (the link to the game), notify(kind, data)
   */
  constructor({ chantier, memoire, code, game, notify }) {
    Object.assign(this, { chantier, memoire, code, game, notify });
    this.client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
    this.events = [];
    this.busy = false; // the thought lane
    this.talking = false; // the conversation lane
    this.talkQueue = [];
    this.interrupt = false;
    this.lastThought = 0;
    this.lastThoughtAt = Date.now();
    this.paused = false;
    this.pauseReason = '';
    this.abort = new AbortController(); // cuts the requests in flight when he is switched off (halt)
    this.recentPhotos = [];
    this.programme = null; // set by the server (programme.mjs)
    this.places = [];
    this.reservedBudget = 0;
    this.autonomie = new Autonomie(this);
  }

  get ready() { return !!this.client; }
  setting(role) { return this.chantier.settings.cerveaux[role]; }
  model(role) { return MODELS[this.setting(role)?.modele] || MODELS.equilibre; }

  status() {
    const s = this.chantier.settings, m = this.memoire.seance;
    return {
      cle: this.ready, actif: !this.paused && this.ready, pause: this.pauseReason, allume: !!s.allume,
      roles: Object.fromEntries(Object.keys(ROLES).map((r) => [r, { ...this.setting(r), label: ROLES[r], modeleLabel: this.model(r).label, effortLabel: EFFORTS[this.setting(r).effort] }])),
      depense: +(m.stats.depense || 0).toFixed(3), plafond: s.plafond, pensees: m.stats.pensees || 0, photos: m.stats.photos || 0,
      reserve: +(this.reservedBudget || 0).toFixed(3), depense_estimee: +(m.stats.depense_estimee || 0).toFixed(3),
      seance: { id: m.id, debut: m.debut }, occupe: this.busy || false, parle: this.talking,
      programme: this.programme?.summary() || null, autonomie: this.autonomie.status()
    };
  }

  setPaused(paused, reason = '') {
    this.paused = paused;
    this.pauseReason = paused ? reason : '';
    if (paused) this.programme?.suspend();
    this.notify('statut', this.status());
  }

  // Switched off: the request in flight is cut and the thought or answer in progress stops at once (its loop sees the
  // pause); a programme keeps its place and resumes the same step when he is switched back on
  halt() {
    this.abort.abort();
    this.abort = new AbortController();
    this.interrupt = true;
    this.programme?.suspend();
    this.memoire.save();
  }

  // Something happened in the game (or in the control room) that he should hear about at his next thought
  push(kind, text, data) {
    this.events.push({ kind, text, data, t: Date.now() });
    if (this.events.length > 40) this.events.shift();
  }

  // The Creator speaks (in the game with K, or from the control room): the conversation lane, at once
  hear(texte, canal) {
    this.memoire.say('createur', texte, canal);
    this.talkQueue.push({ texte, canal, t: Date.now() });
    if (this.busy) this.interrupt = true;
    this.programme?.suspend();
    this.notify('conversation', this.memoire.recentTalk(1)[0]);
  }

  awake() {
    const a = this.game.state?.architecte;
    return this.ready && !this.paused && this.game.connected && a?.present && a.alive;
  }

  // Called every second by the server
  heartbeat() {
    if (!this.ready || this.paused || !this.game.connected) return;
    const a = this.game.state?.architecte;
    if (!a?.present) return;
    this.memoire.touch();
    if (this.memoire.closed) { const s = this.memoire.closed; this.memoire.closed = null; this.writeReport(s).catch(() => {}); }
    if (this.overBudget()) return;
    // the conversation lane runs beside a thought, even when his body is down
    if (this.talkQueue.length && !this.talking) this.converse().catch((e) => this.fail(e, 'parole'));
    this.reconcileTickets();
    this.autonomie.tick();
    if (!a.alive || this.busy || this.talking || this.talkQueue.length) return;
    const since = (Date.now() - this.lastThought) / 1000;
    const urgent = this.events.some((e) => URGENT.has(e.kind));
    if (this.programme?.active && !urgent) return; // its steps call think()
    const news = this.events.some((e) => !QUIET.has(e.kind) || (e.kind === 'arrive' && !this.programme?.active));
    if ((urgent && since > 1.5) || (news && since > MIN_GAP)) this.think('evenements').catch((e) => this.fail(e));
  }

  overBudget() {
    const spent = (this.memoire.seance.stats.depense || 0) + (this.memoire.seance.stats.depense_estimee || 0), cap = this.chantier.settings.plafond;
    if (spent < cap) return false;
    this.setPaused(true, `plafond de ${cap} $ atteint`);
    this.log('systeme', `Plafond de dépense atteint (${spent.toFixed(2)} $ cette séance). Le cerveau se met en pause.`);
    this.game.command('envoyer_sms', { texte: `Plafond atteint (${spent.toFixed(2)} $). Je me mets en pause.` }).catch(() => {});
    return true;
  }

  fail(e, lane = 'pensee') {
    if (lane === 'parole') this.talking = false; else this.busy = false;
    if (e instanceof Anthropic.APIUserAbortError) {
      this.log('systeme', lane === 'parole' ? 'Réponse coupée : il est éteint.' : 'Pensée coupée : il est éteint.');
      this.notify('statut', this.status());
      return;
    }
    if (e instanceof BrainUnavailableError) return;
    const auth = e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError;
    const text = auth ? 'La clé API est refusée : vérifie .env.local.' : e instanceof Anthropic.RateLimitError ? 'Limite de débit de l’API : je reprends dans un moment.' : `Erreur (${lane === 'parole' ? 'conversation' : 'pensée'}) : ${e.message}`;
    this.log('systeme', text);
    if (auth) this.setPaused(true, 'clé refusée');
    else if (lane !== 'parole') this.lastThought = Date.now() + 20000; // breathe before the next try
    this.notify('statut', this.status());
  }

  // ---- One thought ----------------------------------------------------------------------------------------------------
  /**
   * @param {string} reason - evenements | etape
   * @param {object} ctx - for a programme step: { step, index, total, sujet, shots: [{ id, base64, note }] }
   */
  async think(reason = 'evenements', ctx = {}) {
    if (reason === 'respiration' && !ctx.shots?.length) return false; // reject obsolete idle callers
    if (!this.ready || this.paused || ctx.signal?.aborted || this.talkQueue.length) return false;
    // one thought at a time: a programme step that waited too long queues behind the thought in progress
    for (let i = 0; i < 400 && (this.busy || this.talking); i++) {
      if (this.paused || ctx.signal?.aborted) return false;
      await new Promise((r) => setTimeout(r, 300));
    }
    if (this.paused || this.busy || this.talking || ctx.signal?.aborted) return false;
    this.busy = 'pensee';
    this.interrupt = false;
    this.lastThought = Date.now();
    this.notify('statut', this.status());
    try {
      this.reconcileTickets();
      const events = this.events.splice(0);
      const content = [
        { type: 'text', text: this.longMemory(), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: this.conscience(events, reason, ctx) }
      ];
      for (const shot of ctx.shots || []) content.push({ type: 'text', text: `Photo ${shot.id}${shot.note ? ` (${shot.note})` : ''} :` }, image(shot.base64));
      if (ctx.mesures?.length) content.push({ type: 'text', text: `Mesures réellement obtenues à cette étape :\n${ctx.mesures.join('\n')}` });
      if (ctx.verification) {
        const ticket = this.chantier.tickets.get(ticketId(ctx.verification));
        if (ticket?.statut === 'corrige' && ticket.livraison) {
          const original = ticket.photos[0] && this.chantier.photoBase64(ticket.photos[0]);
          if (original) content.push({ type: 'text', text: `Référence avant livraison du ticket #${ticket.id} :` }, image(original));
          content.push({ type: 'text', text: `Livraison à juger : ${JSON.stringify(ticket.livraison)}. Si les nouvelles preuves suffisent, conclure_verification ; sinon explique précisément ce qui manque puis poursuis un autre sujet.` });
        }
      }
      // an accident comes with its burst of photos
      for (const e of events) for (const id of (e.data?.photos || []).slice(0, 3)) {
        const data = this.chantier.photoBase64(id);
        if (data) content.push({ type: 'text', text: `Rafale ${id} (${e.text.slice(0, 80)}) :` }, image(data));
      }
      const final = await this.loop('pensee', this.system(), content, { interruptible: true, signal: ctx.signal });
      if (this.interrupt || this.paused || ctx.signal?.aborted) return false;
      if (final) {
        this.memoire.conclude(final);
        if (reason === 'etape') this.memoire.observe({ texte: final, photos: (ctx.shots || []).map((s) => s.id), lieu: ctx.lieu || null, sujet: ctx.sujet });
      }
      if (ctx.mesures?.length) this.memoire.observe({ texte: ctx.mesures.join('\n'), lieu: ctx.lieu || null, sujet: ctx.sujet });
      this.memoire.seance.briefing = false;
      this.memoire.count('pensees');
      this.lastThoughtAt = this.lastThought;
      return !!final;
    } finally {
      this.busy = false;
      this.notify('statut', this.status());
    }
  }

  // ---- The conversation lane ------------------------------------------------------------------------------------------
  async converse() {
    this.talking = true;
    this.notify('statut', this.status());
    const said = this.talkQueue.splice(0);
    try {
      const canal = said.at(-1).canal;
      const content = [
        { type: 'text', text: this.longMemory(), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `${this.conscience([], 'conversation', {})}\n\n## Le Créateur te dit maintenant (${canal === 'jeu' ? 'dans le jeu' : 'depuis la salle de contrôle'})\n${said.map((m) => `« ${m.texte} »`).join('\n')}` }
      ];
      const reply = await this.loop('parole', `${this.system()}\n\n${conversationPrompt()}`, content, { interruptible: false });
      if (!reply && this.paused) { this.talkQueue.unshift(...said); return; } // switched off: he answers once back
      const text = reply || '…';
      const e = this.memoire.say('architecte', text, canal);
      this.notify('conversation', e);
      this.log('parole', `« ${text} »`, { conversation: true });
      // in the game: subtitle and voice, when he is there
      if (canal === 'jeu' || this.game.state?.architecte?.present) this.game.command('dire', { texte: text.slice(0, 400), conversation: true }).catch(() => {});
      this.foldTalk().catch(() => {});
    } catch (e) {
      if (e instanceof Anthropic.APIUserAbortError || e instanceof BrainUnavailableError) this.talkQueue.unshift(...said);
      throw e;
    } finally {
      this.talking = false;
      this.notify('statut', this.status());
    }
  }

  // A tool loop: one request, its tool calls carried out, the results sent back, until he stops or runs out of rounds
  async loop(role, system, content, { interruptible = false, signal = null } = {}) {
    const messages = [{ role: 'user', content }];
    let final = '';
    const stopped = () => this.paused || signal?.aborted || (interruptible && this.interrupt);
    for (let step = 0; step < MAX_STEPS; step++) {
      if (stopped()) return '';
      const response = await this.call(role, { messages, tools: TOOLS, system, signal });
      if (stopped()) return '';
      this.recordThinking(response, role);
      messages.push({ role: 'assistant', content: response.content });
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (text) final = text;
      if (response.stop_reason === 'refusal') { this.log('systeme', 'Pensée refusée par les garde-fous du modèle.'); break; }
      if (response.stop_reason !== 'tool_use') break;
      const results = [];
      for (const block of response.content) if (block.type === 'tool_use') {
        if (stopped()) return '';
        results.push(await this.runTool(block));
        if (stopped()) return '';
      }
      messages.push({ role: 'user', content: results });
    }
    return final;
  }

  // His reasoning, summarized by the API, as it comes (English included: it is not translated)
  recordThinking(response, role) {
    for (const block of response.content) {
      if (block.type === 'thinking' && block.thinking?.trim()) this.log('pensee', block.thinking.trim(), { role, resume: true });
      else if (block.type === 'text' && block.text?.trim() && role !== 'parole') this.log('pensee', block.text.trim(), { role });
    }
  }

  log(kind, text, data) {
    const e = this.chantier.log(kind, text, data);
    this.notify('journal', e);
    return e;
  }

  // ---- His conscience -------------------------------------------------------------------------------------------------
  system() {
    if (!this.systemText || this.systemPlaces !== this.places) { this.systemText = systemPrompt(this.places); this.systemPlaces = this.places; }
    return this.systemText;
  }

  // What changes rarely, first in the message so that it stays in the cache: the Creator's tastes, his notebook, the
  // summary of their older conversation
  longMemory() {
    const m = this.memoire, lines = ['# Ta mémoire longue'];
    // what he is: known for good, not only heard once as news
    const since = this.chantier.settings.versionArchitecteDepuis;
    lines.push('', `## Toi-même : Architecte v${SELF.version}${since ? `, depuis le ${new Date(since).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}` : ''}`, SELF.changes);
    lines.push('', '## Les goûts du Créateur (tirés de ses décisions)');
    if (m.tastes.regles.length) for (const r of m.tastes.regles) lines.push(`- ${r}`);
    else lines.push('- Pas encore de décision : son exigence de départ est un jeu AAA, au niveau de GTA V.');
    const notes = this.chantier.notes(30).filter((note) => !mentionsTicket(note)).slice(-14);
    if (notes.length) { lines.push('', '## Ton carnet (dernières notes)'); for (const n of notes) lines.push(n); }
    const summary = m.talkSummary.texte.split('\n').filter((line) => !mentionsTicket(line)).join('\n');
    if (summary) lines.push('', '## Vos conversations plus anciennes, en résumé (historique ; les statuts présents des tickets priment)', summary);
    return lines.join('\n');
  }

  conscience(events, reason, ctx) {
    const state = this.game.state || {};
    const a = state.architecte || {}, p = state.joueur || {}, w = state.monde || {};
    const m = this.memoire, s = m.seance, now = Date.now();
    const L = [];
    L.push('# Ta conscience, maintenant');
    L.push(`Il est ${clock(now)}. Séance commencée à ${clock(s.debut)} : ${s.stats.pensees || 0} pensées, ${s.stats.photos || 0} photos, ${(s.stats.depense || 0).toFixed(2)} $ dépensés sur un plafond de ${this.chantier.settings.plafond} $.`);
    L.push(a.spectating ? 'Mode : SEUL. Tu as la caméra ; le joueur est absent.' : 'Mode : ENSEMBLE. Le joueur joue ; reste à moins de 350 m de lui.');
    L.push(`Toi : ${a.mode || '?'}, ${a.address || 'adresse inconnue'} (x ${a.x}, z ${a.z}, altitude ${a.y}). Intention : ${a.intent || '—'}. PV ${a.hp}${a.armor ? ` + gilet ${a.armor}` : ''}.${a.fighting ? ' EN COMBAT avec le joueur.' : ''}${a.grudge ? ` Rancune envers le joueur : ${a.grudge}.` : ''}`);
    if (p.state) L.push(`Joueur : ${p.inVehicle ? `au volant (${p.vehicle || 'véhicule'})` : p.state}, à ${p.distance} m de toi, santé ${p.health}, ${p.wanted ? `${p.wanted} étoile(s)` : 'aucune étoile'}${p.mission ? `, en mission « ${p.mission} »` : ''}.`);
    L.push(`Monde : ${w.heure || '?'}, ${w.meteo || '?'}, ${w.fps ?? '?'} images par seconde. Version du jeu ${state.version || '?'}.`);
    const code = this.code?.state();
    if (code) {
      const stale = this.code.staleSince(this.game.loadedAt);
      L.push(`Code : branche ${code.branche} (${code.head}), ${code.fichiers.length} fichier(s) non commité(s).${stale.length ? ` ATTENTION : le jeu tourne sur du code périmé, ${stale.length} fichier(s) du jeu ont changé depuis son chargement (${stale.slice(0, 5).join(', ')}${stale.length > 5 ? '…' : ''}). Une vérification exige de recharger (mode Seul : recharger_le_jeu).` : ' Le jeu tourne sur le code du disque.'}`);
    }

    // why this thought
    L.push('');
    if (reason === 'etape') {
      L.push(`## Pourquoi tu penses : étape ${ctx.index + 1}/${ctx.total} de ton programme « ${ctx.sujet} »`);
      L.push(`Ce que tu cherches ici : ${ctx.step?.quoi || '—'}. ${ctx.arrivee || ''}`.trim());
      L.push(ctx.shots?.length ? `Tes ${ctx.shots.length} photo(s) de l’étape sont ci-dessous : juge-les.` : 'Aucune photo n’a pu être prise à cette étape.');
    } else if (reason === 'conversation') {
      L.push('## Pourquoi tu penses : le Créateur te parle (voir plus bas).');
    } else L.push('## Pourquoi tu penses : il s’est passé quelque chose (voir plus bas).');

    // the first thought of a session: what happened while he was away
    if (s.briefing) {
      const report = m.lastReport();
      L.push('', '## Début de séance');
      if (report) L.push(`Le rapport de ta dernière séance (${report.id}) :`, report.texte.slice(0, 1600));
      else L.push('C’est ta première séance avec cette mémoire.');
    }

    // what changed in the world
    const since = s.briefing ? (s.depuis ?? 0) : this.lastThoughtAt;
    const changes = m.changesSince(since).slice(-12);
    if (changes.length) { L.push('', '## Ce qui a changé dans le monde depuis ta dernière pensée'); for (const c of changes) L.push(`- ${clock(c.t)} · ${c.texte}`); }

    if (events.length) { L.push('', '## Ce que tes sens et le jeu t’ont signalé'); for (const e of events) L.push(`- ${clock(e.t)} · ${e.text}`); }

    // the conversation
    const talk = m.recentTalk(reason === 'conversation' ? 30 : 8);
    if (talk.length) {
      L.push('', reason === 'conversation' ? '## Votre conversation (les derniers échanges)' : '## Ce que le Créateur et toi vous êtes dit récemment');
      // the conversation lane answers him; a thought only carries out what was promised there
      if (reason !== 'conversation') L.push('(Ta voie de conversation lui a déjà répondu : ne lui réponds pas une seconde fois. Fais seulement ce que tu lui as promis et qui n’est pas encore fait.)');
      for (const e of talk) if (reason === 'conversation' || e.qui === 'createur' || !mentionsTicket(e.texte)) L.push(`- ${clock(e.t)} ${e.qui === 'createur' ? 'Le Créateur' : 'Toi'} : ${e.texte}`);
    }

    // his work
    const prog = this.programme?.summary();
    L.push('', '## Ton programme');
    if (prog?.active) L.push(`« ${prog.sujet} » (${CATEGORIES[prog.categorie] || prog.categorie}) : étape ${prog.etape}/${prog.total}. Restent : ${prog.restent.join(' ; ') || '—'}.`);
    else L.push(`Aucun programme en cours.${prog ? ` Le dernier : « ${prog.sujet} » (${prog.etat}).` : ''}`);
    const seen = m.recentSeen(14).filter((entry) => !mentionsTicket(entry.texte));
    if (seen.length) { L.push('', '## Ce que tu as vu pendant cette séance'); for (const o of seen) L.push(`- ${clock(o.t)}${o.lieu?.adresse ? ` [${o.lieu.adresse}]` : ''}${o.photos?.length ? ` (${o.photos.join(', ')})` : ''} : ${o.texte}`); }
    const concl = m.recentConclusions(12).filter((entry) => !mentionsTicket(entry.texte)).slice(-4);
    if (concl.length) { L.push('', '## Tes dernières conclusions'); for (const c of concl) L.push(`- ${clock(c.t)} : ${c.texte}`); }

    // tickets
    L.push('', '## Tes tickets');
    L.push(this.ticketLines(a).join('\n') || 'Aucun ticket.');

    L.push('', '## Ce que tu as couvert de la ville', m.coverageSummary(this.places));
    return L.join('\n');
  }

  ticketLines(a) {
    const all = this.chantier.listTickets(), L = ['ÉTAT PRÉSENT AUTORITAIRE — ignore tout ancien récit contradictoire. Aucune attente de ticket ne suspend la prospection.'];
    const by = (statuts) => all.filter((t) => statuts.includes(t.statut));
    const asked = by(['plus']);
    for (const t of asked.slice(0, 4)) L.push(`- #${t.id} ${t.titre} : LE CRÉATEUR DEMANDE PLUS : « ${t.fil.filter((f) => f.qui === 'createur').at(-1)?.texte || ''} » (retourner_au_ticket, photographier, completer_ticket).`);
    for (const t of by(['corrige']).slice(0, 4)) L.push(t.livraison
      ? `- #${t.id} ${t.titre} : CORRIGÉ, livraison recevable, À VÉRIFIER. Étape : ${verificationStep(t, this.code?.staleSince(this.game.loadedAt) || [])}.`
      : `- #${t.id} ${t.titre} : pas de livraison recevable. Aucune vérification de correction possible ; poursuis ailleurs.`);
    const waiting = by(['a_valider']);
    if (waiting.length) L.push(`- À valider par le Créateur : ${waiting.map((t) => `#${t.id} ${t.titre}`).slice(0, 6).join(' ; ')}.`);
    const workshop = by(['valide', 'atelier']);
    if (workshop.length) L.push(`- Validation/atelier, aucune livraison à vérifier : ${workshop.map((t) => `#${t.id} ${t.titre}`).slice(0, 6).join(' ; ')}. Continue d’autres sujets.`);
    const failed = by(['echec']);
    if (failed.length) L.push(`- ÉCHEC RÉEL de l’atelier, pas une correction en attente : ${failed.map((t) => `#${t.id} ${t.titre}`).join(' ; ')}. Aucun résultat à revérifier ; continue la prospection indépendante.`);
    if (this.workshop) { const active = this.workshop()?.enCours; L.push(active ? `- Processus d’atelier actuellement actif : #${active.id}.` : '- Aucun processus d’atelier actif actuellement.'); }
    // the code moved since a ticket was opened: maybe the Creator already fixed it himself
    const commits = this.code?.commits || [];
    for (const t of all.filter((x) => ['a_valider', 'plus', 'valide', 'echec'].includes(x.statut))) {
      const after = commits.filter((k) => k.t > t.ouvert);
      if (after.length) L.push(`- Depuis l’ouverture de #${t.id} (${t.titre}), le code a changé : ${after.slice(0, 3).map((k) => `« ${k.sujet} »`).join(', ')}. Cela ne change pas son statut et ne prouve aucune livraison ; observe ailleurs tant qu’une vérification recevable ne t’attend pas.`);
    }
    const closed = all.filter((t) => ['verifie', 'rejete'].includes(t.statut) && now() - t.maj < 3 * 86400e3);
    if (closed.length) L.push(`- Récemment clos : ${closed.slice(0, 6).map((t) => `#${t.id} ${t.titre} (${STATUS[t.statut]})`).join(' ; ')}.`);
    if (Number.isFinite(a.x)) {
      const near = all.filter((t) => !['rejete'].includes(t.statut) && t.lieu && Math.hypot(t.lieu.x - a.x, t.lieu.z - a.z) < 400);
      if (near.length) L.push(`- À moins de 400 m de toi : ${near.slice(0, 6).map((t) => `#${t.id} ${t.titre} (${STATUS[t.statut]})`).join(' ; ')}.`);
    }
    return L;
  }

  reconcileTickets() {
    const actual = Object.fromEntries(this.chantier.listTickets().map((t) => [t.id, { statut: t.statut, livraison: !!t.livraison, session: t.session || null }]));
    const previous = this.memoire.seance.autoriteTickets;
    if (JSON.stringify(previous) !== JSON.stringify(actual)) {
      this.memoire.seance.autoriteTickets = actual;
      this.memoire.saveSoon();
    }
    const id = this.programme?.current?.verification_de;
    if (id && this.programme.active && (actual[id]?.statut !== 'corrige' || !actual[id]?.livraison)) this.programme.abort(`Le statut présent de #${id} ne permet aucune vérification de correction. Reprise d’un sujet indépendant.`);
  }

  // ---- The API --------------------------------------------------------------------------------------------------------
  canRequest() {
    const stats = this.memoire.seance.stats;
    return this.ready && !this.paused && this.chantier.settings.allume !== false
      && (stats.depense || 0) + (stats.depense_estimee || 0) < this.chantier.settings.plafond;
  }

  async call(role, { messages, tools, system, maxTokens = 16000, format = null, effort = null, signal = null }) {
    if (!this.ready || this.paused || this.chantier.settings.allume === false || signal?.aborted) {
      throw new BrainUnavailableError('Le cerveau est éteint ou en pause.', 'pause');
    }
    if (this.overBudget()) throw new BrainUnavailableError('Le plafond de dépense est atteint.', 'plafond');
    const m = this.model(role);
    const params = {
      model: m.id,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: effort || this.setting(role).effort || 'low', ...(format ? { format } : {}) }
    };
    if (tools) params.tools = tools;
    // Reserve a conservative bound before any await: concurrent lanes share the same remaining ceiling.
    const reserve = requestCostBound(m, params);
    const stats = this.memoire.seance.stats;
    const remaining = this.chantier.settings.plafond - (stats.depense || 0) - (stats.depense_estimee || 0) - this.reservedBudget;
    if (reserve > remaining) {
      if (!this.reservedBudget) {
        this.setPaused(true, `plafond : marge insuffisante pour le prochain appel (${remaining.toFixed(2)} $ disponibles)`);
        this.log('systeme', 'Appel différé : le budget restant ne couvre pas sa réserve maximale. Relève le plafond ou choisis un cerveau moins coûteux.');
      }
      throw new BrainUnavailableError('Budget disponible déjà réservé ou insuffisant.', 'plafond');
    }
    const reservation = this.memoire.reserveCall(reserve);
    this.reservedBudget += reserve;
    const requestSignal = signal ? AbortSignal.any([this.abort.signal, signal]) : this.abort.signal;
    try {
      const options = { signal: requestSignal };
      const response = m.fallbacks
        ? await this.client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, options)
        : await this.client.messages.create(params, options);
      if (Number.isFinite(response.usage?.input_tokens) && Number.isFinite(response.usage?.output_tokens)) this.count(m, response.usage, role);
      else {
        this.memoire.count('depense_estimee', reserve);
        this.log('systeme', `Réponse sans relevé de consommation : jusqu’à ${reserve.toFixed(3)} $ conservés pour le plafond.`);
      }
      return response;
    } catch (e) {
      // An aborted request may already have been billed without returning usage. Retain its bound for the ceiling,
      // separately from measured spending, rather than make that budget silently available again.
      const knownUnbilled = Number.isFinite(e.status) && [400, 401, 403, 404, 409, 413, 422, 429].includes(e.status);
      if (!knownUnbilled) {
        this.memoire.count('depense_estimee', reserve);
        this.log('systeme', `Appel sans relevé de consommation : jusqu’à ${reserve.toFixed(3)} $ conservés en dépense incertaine pour le plafond.`);
      }
      throw e;
    } finally {
      this.reservedBudget = Math.max(0, this.reservedBudget - reserve);
      this.memoire.releaseCall(reservation);
      this.notify('statut', this.status());
    }
  }

  count(m, usage = {}, role) {
    const p = m.price;
    const dollars = ((usage.input_tokens || 0) * p.in + (usage.output_tokens || 0) * p.out
      + (usage.cache_read_input_tokens || 0) * p.read + (usage.cache_creation_input_tokens || 0) * p.write) / 1e6;
    this.memoire.count('depense', dollars);
    this.chantier.addSpending(dollars, role, m.label);
  }

  // ---- Tools ------------------------------------------------------------------------------------------------------------
  async runTool(block) {
    const input = block.input || {};
    const brief = summarize(block.name, input);
    let result;
    try {
      if (block.name === 'photographier') result = await this.photoTool(input);
      else if (block.name === 'lancer_experience') result = await this.experimentTool(input);
      else if (GAME_TOOLS.has(block.name)) result = await this.game.command(block.name, input, MEASURES.has(block.name) ? 20000 : 15000);
      else result = await this.serverTool(block.name, input);
    } catch (e) {
      result = { ok: false, texte: `Échec : ${e.message}` };
    }
    if (block.name !== 'photographier' && block.name !== 'lancer_experience') {
      const kind = block.name === 'dire' || block.name === 'envoyer_sms' ? 'parole' : MEASURES.has(block.name) ? 'mesure' : 'action';
      this.log(kind, result.ok === false ? `${brief} — refusé : ${result.texte}` : brief, MEASURES.has(block.name) && result.ok !== false ? { resultat: String(result.texte).slice(0, 1500) } : undefined);
    }
    const content = [{ type: 'text', text: result.texte || (result.ok ? 'Fait.' : 'Échec.') }];
    for (const img of [result.image, ...(result.images || [])].filter(Boolean).slice(0, 4)) content.push(image(img));
    return { type: 'tool_result', tool_use_id: block.id, content, ...(result.ok === false ? { is_error: true } : {}) };
  }

  // A photo from his eye, kept on disk, marked on his coverage and shown in the control room
  async photo(input, { sujet = '' } = {}) {
    const startedAt = Date.now();
    const context = this.captureContext();
    const r = await this.game.command('photographier', input, 15000).catch(() => null);
    if (!r?.ok || !r.image) {
      this.log('systeme', `Photo ratée : ${r?.texte || 'le jeu n’a pas répondu'}`, { photo: 'ratee' });
      return { failed: r?.texte || 'le jeu n’a pas répondu' };
    }
    const meta = { ...(r.lieu || {}), raison: input.raison, debut: startedAt, t: Date.now(), ...this.finishCaptureContext(context) };
    const saved = this.chantier.savePhoto(r.image, meta);
    this.recentPhotos.push({ id: saved.id, meta });
    if (this.recentPhotos.length > 40) this.recentPhotos.shift();
    this.memoire.count('photos');
    this.memoire.markCovered({ x: meta.x, z: meta.z, heure: meta.heure, meteo: meta.meteo, sujet, adresse: meta.adresse });
    this.log('photo', `Photo (${[input.direction, input.cadrage, input.zoom].filter(Boolean).join(', ')}) : ${input.raison || ''}`, { id: saved.id, lieu: meta });
    this.notify('couverture', null);
    return { id: saved.id, base64: saved.base64, note: r.texte, lieu: meta };
  }

  async photoTool(input) {
    const shot = await this.photo(input);
    if (!shot.id) return { ok: false, texte: `La photo a échoué : ${shot.failed}` };
    this.advanceVerification('photo', shot);
    return { ok: true, texte: `Photo ${shot.id}. ${shot.note || ''}`.trim(), image: shot.base64 };
  }

  // An experiment: carried out by the game, its photos saved, its record kept to be rerun and compared
  async experimentTool(input) {
    const before = input.refaire ? this.chantier.experience(input.refaire) : null;
    if (input.refaire && !before) return { ok: false, texte: `Expérience ${input.refaire} introuvable.` };
    const params = before ? { ...before.params, type: before.type, refaire: before.id } : input;
    this.log('action', `Lance l’expérience ${params.type}${before ? ` (rejoue ${before.id})` : ''} : ${input.raison || ''}`);
    const startedAt = Date.now();
    const context = this.captureContext();
    const r = await this.game.command('lancer_experience', params, 90000);
    if (!r?.ok) { this.log('systeme', `Expérience ${params.type} : ${r?.texte || 'échec'}`); return { ok: false, texte: r?.texte || 'L’expérience a échoué.' }; }
    const photos = [];
    const provenance = this.finishCaptureContext(context);
    for (const [i, img] of (r.images || []).entries()) {
      const saved = this.chantier.savePhoto(img, { ...(r.lieu || {}), raison: `expérience ${params.type}, image ${i + 1}`, debut: startedAt, t: Date.now(), ...provenance });
      photos.push(saved.id);
      this.memoire.count('photos');
    }
    // Keep the actual settings and protocol so a rerun can be compared; active traffic may still perturb it.
    const record = this.chantier.saveExperience({ type: params.type, params: { ...params, ...(r.params || {}), refaire: undefined, raison: undefined }, lieu: r.lieu, mesures: r.mesures, resume: r.texte, photos, refait: before?.id || null, version: this.game.version,
      debut: startedAt, ...provenance, validite: ['valide', 'perturbee', 'incomplete'].includes(r.validite) ? r.validite : 'incomplete',
      raisons: Array.isArray(r.raisons) ? r.raisons : ['Le jeu n’a pas fourni la validité du protocole.'], protocole: r.protocole || null });
    let comparison = '';
    if (before) comparison = `\n\nComparaison avec ${before.id} (${new Date(before.t).toLocaleString('fr-FR')}) :\n${compareMeasures(before.mesures, r.mesures)}`;
    this.log('mesure', `Expérience ${record.id} (${params.type}) : ${r.texte}${comparison ? ' — comparée à ' + before.id : ''}`, { experience: record.id, photos, resultat: `${r.texte}${comparison}` });
    this.notify('experience', record);
    this.advanceVerification('experience', record);
    return { ok: true, experience: record.id, photos, texte: `Expérience ${record.id} (${record.validite}). ${r.texte}${record.raisons.length ? `\nValidité : ${record.raisons.join(' ; ')}` : ''}${comparison}\nPhotos : ${photos.join(', ') || 'aucune'}.`, images: r.images?.slice(0, 3) };
  }

  async serverTool(name, input) {
    const c = this.chantier;
    if (name === 'planifier') {
      const inferred = /v[ée]rifi|livraison|corrig/i.test(input.sujet || '') ? /#(\d+)/.exec(input.sujet || '')?.[1] : null;
      const id = input.verification_de ? ticketId(input.verification_de) : inferred ? ticketId(inferred) : null;
      if (id) {
        const t = c.tickets.get(id);
        if (!t || t.statut !== 'corrige' || !t.livraison || !hasCreatorApproval(t)) return { ok: false, texte: `#${id} n’a pas de correction livrée à vérifier (statut présent : ${t?.statut || 'inconnu'}). Lance une prospection indépendante ; les autres tickets ne t’imposent aucune attente.` };
      }
      return this.programme.start({ ...input, verification_de: id });
    }
    if (name === 'abandonner_programme') return this.programme.abort(input.raison);
    if (name === 'noter') { c.addNote(String(input.note || '').slice(0, 600)); this.notify('memoire', null); return { ok: true, texte: 'Noté dans ton carnet.' }; }
    if (name === 'chercher_memoire') {
      const hits = this.memoire.search(input.mots);
      if (!hits.length) return { ok: true, texte: 'Rien dans ta mémoire sur ces mots.' };
      return { ok: true, texte: hits.map((h) => `- ${h.t ? new Date(h.t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : ''} (${h.where}) ${h.texte}`).join('\n') };
    }
    if (name === 'chercher_tickets') {
      const a = this.game.state?.architecte || {};
      const words = String(input.mots || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const list = c.listTickets().filter((t) => (!input.pres_de_moi || (t.lieu && Math.hypot(t.lieu.x - a.x, t.lieu.z - a.z) < 300))
        && (!words.length || words.some((w) => `${t.titre} ${t.constat} ${t.en_clair}`.toLowerCase().includes(w)))).slice(0, 15);
      if (!list.length) return { ok: true, texte: 'Aucun ticket correspondant.' };
      return { ok: true, texte: list.map((t) => `#${t.id} [${STATUS[t.statut]}] ${t.titre} · ${t.lieu?.adresse || '?'} (x ${Math.round(t.lieu?.x)}, z ${Math.round(t.lieu?.z)})${t.commits.length ? ` · commits ${t.commits.map((k) => k.sha.slice(0, 7)).join(', ')}` : ''}`).join('\n') };
    }
    if (name === 'ouvrir_ticket') return this.openTicket(input);
    if (name === 'retourner_au_ticket') {
      const t = c.tickets.get(ticketId(input.id));
      if (!t?.lieu) return { ok: false, texte: 'Ticket ou lieu introuvable.' };
      const l = t.lieu;
      if (!this.game.state?.architecte?.spectating) return { ok: true, texte: `Le ticket #${t.id} a été photographié à ${l.adresse} (x ${Math.round(l.x)}, z ${Math.round(l.z)}). Mode Ensemble : vas-y avec aller_a si c’est près du joueur.` };
      const r = await this.game.command('se_teleporter', { x: l.x, z: l.z, y: l.y, cap: l.yaw, tangage: l.pitch, raison: input.raison });
      if (r.ok) this.advanceVerification('sur_place', { id: t.id });
      return { ok: r.ok, texte: r.ok ? `Tu es à l’endroit de la photo du ticket #${t.id}, face à la même chose (cadrage d’origine : ${l.oeil ? `${l.oeil.direction || ''} ${l.oeil.cadrage || ''}`.trim() : 'caméra du jeu'}). ${r.texte}` : r.texte };
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
      if (t.statut !== 'corrige' || !t.livraison || !hasCreatorApproval(t)) return { ok: false, texte: `État présent #${t.id} : ${STATUS[t.statut] || t.statut}, aucune correction recevable à vérifier. Continue un autre sujet.` };
      const fil = t.fil.filter((f) => f.qui !== 'architecte').slice(-6).map((f) => `${f.qui} : ${String(f.texte).slice(0, 600)}`).join('\n');
      const d = t.livraison;
      const stale = this.code?.staleSince(this.game.loadedAt) || [];
      const first = t.photos[0] ? c.photoBase64(t.photos[0]) : null;
      return { ok: true, texte: [
        `#${t.id} ${t.titre} (${STATUS[t.statut]}). Lieu : ${t.lieu?.adresse} (x ${Math.round(t.lieu?.x)}, z ${Math.round(t.lieu?.z)}, cap ${t.lieu?.yaw ?? '?'}).`,
        `Constat : ${t.constat}`,
        d ? `Livraison de l’atelier : ${d.resume}\nFichiers : ${(d.fichiers || []).join(', ') || '—'}\nÀ vérifier : ${d.verifier?.etapes || '—'}\nAttendu : ${d.verifier?.attendu || '—'}` : 'Pas de fiche de livraison.',
        t.experience ? `Expérience du ticket : ${t.experience} (lancer_experience avec refaire: "${t.experience}").` : '',
        stale.length ? `Le jeu tourne sur du code périmé (${stale.length} fichier(s)) : recharge d’abord en mode Seul.` : 'Le jeu tourne sur le code du disque.',
        `Étape de la vérification : ${verificationStep(t, stale)}.`,
        fil, 'Photo d’origine ci-dessous.'].filter(Boolean).join('\n'), image: first };
    }
    if (name === 'conclure_verification') {
      const t = c.tickets.get(ticketId(input.id));
      if (!t) return { ok: false, texte: 'Ticket introuvable.' };
      if (t.statut !== 'corrige' || !hasCreatorApproval(t)) return { ok: false, texte: 'Refusé : seul un ticket corrigé et validé par le Créateur peut être revérifié. Le ticket reste ouvert.' };
      if (!['corrige', 'toujours_present'].includes(input.verdict)) return { ok: false, texte: 'Verdict de vérification inconnu.' };
      const v = t.verification;
      if (v?.etape !== 'conclure' || !Number.isFinite(v.depuis)) return { ok: false, texte: 'Refusé : retourne sur place et recueille les preuves après livraison avant de conclure.' };
      const stale = this.code?.staleSince(this.game.loadedAt) || [];
      if (stale.length) return { ok: false, texte: 'Refusé : le jeu tourne encore sur du code périmé. Recharge avant de vérifier.' };
      // Only evidence recorded by our photo/experiment tools can close a ticket. The model cannot mint proof by
      // supplying an old photo or an arbitrary experiment id in its concluding tool call.
      const photos = (v.photos || []).filter((id) => this.verificationPhoto(t, id));
      if (!photos.length) return { ok: false, texte: 'Refusé : aucune photo après livraison n’a été enregistrée pour cette vérification.' };
      if (t.experience) {
        const replay = c.experience(v.experience);
        const invalid = this.verificationReplay(t, replay);
        if (invalid || !replay?.photos?.some((id) => photos.includes(id))) return { ok: false, texte: `Refusé : ${invalid || 'les photos du rejeu ne sont pas enregistrées'}. Le ticket reste à vérifier.` };
      }
      c.addPhotos(t, photos, 'apres');
      const fixed = input.verdict === 'corrige';
      c.updateTicket(t.id, { statut: fixed ? 'verifie' : 'valide', verification: null }, { qui: 'architecte', texte: `${fixed ? 'Vérifié : corrigé.' : 'Toujours présent : renvoyé à l’atelier.'} ${input.commentaire}${v.experience ? ` (expérience ${v.experience})` : ''}` });
      this.memoire.change('decision', `Tu as ${fixed ? 'vérifié et clos' : 'rouvert'} le ticket #${t.id} « ${t.titre} ».`, { id: t.id });
      this.log('ticket', `#${t.id} ${fixed ? 'vérifié, clos' : 'rouvert'} : ${input.commentaire}`, { id: t.id });
      this.notify('ticket', t);
      if (!fixed) this.notify('atelier', { ticket: t.id });
      return { ok: true, texte: fixed ? 'Ticket clos.' : 'Ticket renvoyé à l’atelier.' };
    }
    return { ok: false, texte: `Outil inconnu : ${name}` };
  }

  // The verification in progress moves on as he does each part of it
  advanceVerification(what, data) {
    for (const t of this.chantier.listTickets().filter((x) => x.statut === 'corrige')) {
      if (!hasCreatorApproval(t)) continue;
      const v = t.verification || { etape: 'retourner', depuis: Date.now() };
      let next = v.etape;
      const proof = { ...v, photos: [...(v.photos || [])] };
      if (what === 'sur_place' && data.id === t.id) next = t.experience ? 'experience' : 'photographier';
      else if (what === 'photo' && !t.experience && ['photographier', 'retourner', 'conclure'].includes(v.etape) && this.verificationPhoto({ ...t, verification: v }, data.id)) {
        next = 'conclure';
        proof.photos.push(data.id);
      } else if (what === 'experience' && t.experience && !this.verificationReplay({ ...t, verification: v }, data)) {
        const photos = (data.photos || []).filter((id) => this.verificationPhoto({ ...t, verification: v }, id));
        if (photos.length) { next = 'conclure'; proof.experience = data.id; proof.photos.push(...photos); }
      }
      if (next !== v.etape || proof.photos.length !== (v.photos || []).length) this.chantier.updateTicket(t.id, { verification: { ...proof, photos: [...new Set(proof.photos)], etape: next, maj: Date.now() } });
    }
  }

  verificationPhoto(t, id) {
    if (!this.chantier.photoFile(id)) return false;
    const meta = this.chantier.photoMeta(id);
    const startedAt = meta?.debut ?? meta?.t;
    return Number.isFinite(startedAt) && startedAt >= t.verification.depuis && startedAt >= this.game.loadedAt
      && Number.isFinite(meta.chargement) && meta.chargement === this.game.loadedAt
      && meta.versionJeu === this.currentGameBuild() && Array.isArray(meta.codePerime) && !meta.codePerime.length && near(meta, t.lieu, 40);
  }

  currentGameBuild() {
    return String(this.game.build?.version || this.game.build || this.game.version || '?').split(/\s/)[0];
  }

  captureContext() {
    const chargement = this.game.loadedAt;
    return { chargement, versionJeu: this.currentGameBuild(), codePerime: this.code?.staleSince(chargement) || [] };
  }

  finishCaptureContext(context) {
    const codePerime = [...new Set([...context.codePerime, ...(this.code?.staleSince(context.chargement) || [])])];
    if (context.chargement !== this.game.loadedAt) codePerime.push('chargement_interrompu');
    return { ...context, codePerime };
  }

  verificationReplay(t, replay) {
    const problem = replayProblem(this.chantier.experience(t.experience), replay, t.verification.depuis);
    if (problem) return problem;
    if (replay.chargement !== this.game.loadedAt || replay.protocole?.version_jeu !== this.currentGameBuild()
      || !Array.isArray(replay.codePerime) || replay.codePerime.length) return 'le rejeu ne provient pas du chargement et du code actuels';
    return null;
  }

  // A ticket goes out only once his rereading (its own model and depth) has looked at the photos and agreed
  async openTicket(input) {
    const c = this.chantier;
    const photos = (input.photos || []).filter((id) => c.photoFile(id)).slice(0, 4);
    if (!photos.length && this.recentPhotos.length) photos.push(this.recentPhotos.at(-1).id);
    if (!photos.length) return { ok: false, texte: 'Pas de photo, pas de ticket : photographie d’abord.' };
    const reg = input.regression_de ? c.tickets.get(ticketId(input.regression_de)) : null;
    let draft = { titre: String(input.titre).slice(0, 100), en_clair: String(input.en_clair || '').slice(0, 400), categorie: CATEGORIES[input.categorie] ? input.categorie : 'bug', gravite: input.gravite || 'moyenne', constat: input.constat, piste: input.piste };
    const experiment = input.experience ? c.experience(input.experience) : null;
    let verdict;
    try {
      if (input.experience && experiment?.validite !== 'valide') throw new Error('L’expérience fournie est absente, incomplète ou perturbée : reprends-la avant de proposer ce ticket.');
      verdict = await this.check(draft, photos, experiment);
      if (typeof verdict.confirme !== 'boolean') throw new Error('La relecture n’a pas rendu de verdict valide.');
    } catch (e) {
      const id = this.memoire.saveReviewDraft({ ...draft, experience: input.experience || null }, photos, e.message);
      this.log('ticket', `Relecture en attente (${id}) : ${draft.titre}. ${e.message}`);
      this.notify('memoire', null);
      return { ok: false, texte: `Relecture indisponible : aucun ticket envoyé. Le constat et ses photos sont conservés (${id}) ; reprends la relecture plus tard.` };
    }
    if (!verdict.confirme) {
      this.memoire.saveReviewDraft(draft, photos, verdict.raison, 'ecarte');
      this.log('ticket', `Ticket écarté par la relecture : ${draft.titre}. ${verdict.raison}`);
      return { ok: false, texte: `Ta relecture a écarté ce ticket : ${verdict.raison}` };
    }
    draft = { ...draft, titre: verdict.titre || draft.titre, en_clair: verdict.en_clair || draft.en_clair, constat: verdict.constat || draft.constat, piste: verdict.piste || draft.piste, gravite: verdict.gravite || draft.gravite };
    const meta = c.photoMeta(photos[0]) || this.recentPhotos.find((p) => p.id === photos[0])?.meta || {};
    const a = this.game.state?.architecte || {};
    const lieu = meta.lien ? meta : { x: a.x, y: a.y, z: a.z, adresse: a.address, lien: '' };
    const experience = input.experience && c.experience(input.experience) ? input.experience : null;
    const t = c.createTicket({ ...draft, photos, lieu, version: this.game.version, regression_de: reg?.id || null, experience });
    this.memoire.count('tickets', t.id);
    this.log('ticket', `Ticket #${t.id} proposé au Créateur : ${t.titre}`, { id: t.id });
    this.notify('ticket', t);
    return { ok: true, texte: `Ticket #${t.id} proposé au Créateur.` };
  }

  async check(draft, photos, experience = null) {
    const content = [{ type: 'text', text: `Projet de ticket de l’Architecte :\n${JSON.stringify(draft, null, 2)}\n\nSes photos :` }];
    for (const id of photos) {
      const data = this.chantier.photoBase64(id);
      if (data) content.push(image(data));
    }
    if (experience) content.push({ type: 'text', text: `Expérience et mesures :\n${JSON.stringify(experience)}` });
    content.push({ type: 'text', text: 'Les photos prouvent-elles ce que dit le constat ? Le problème est-il réel et significatif pour un jeu qui vise le niveau AAA, et pas un artefact de capture ou une préférence vague ? Si oui, confirme et resserre le texte (titre net, en_clair simple et sans jargon, constat factuel, piste concrète). Sinon, écarte-le et dis pourquoi en une phrase.' });
    const response = await this.call('relecture', {
      messages: [{ role: 'user', content }],
      system: `Tu relis, pour le Créateur du jeu OVERDRAFT, les tickets que propose l’Architecte, un testeur exigeant. Tu es encore plus exigeant que lui : un ticket doit être prouvé par ses photos, précis et utile. Réponds en français.\n\nLes goûts du Créateur :\n${this.memoire.tastes.regles.map((r) => `- ${r}`).join('\n') || '- (pas encore de décision)'}`,
      maxTokens: 8000,
      format: { type: 'json_schema', schema: {
        type: 'object', additionalProperties: false, required: ['confirme', 'raison', 'titre', 'en_clair', 'constat', 'piste', 'gravite'],
        properties: { confirme: { type: 'boolean' }, raison: { type: 'string' }, titre: { type: 'string' }, en_clair: { type: 'string' }, constat: { type: 'string' }, piste: { type: 'string' },
          gravite: { type: 'string', enum: ['basse', 'moyenne', 'haute', 'critique'] } } } }
    });
    if (response.stop_reason === 'refusal') throw new Error('La relecture a refusé de produire un verdict.');
    const text = response.content.find((b) => b.type === 'text')?.text || '{}';
    return JSON.parse(text);
  }

  // ---- What he learns ---------------------------------------------------------------------------------------------------
  // Every decision of the Creator on a ticket sharpens the rules of his taste
  async learnFromDecision(t, action, why) {
    if (!this.canRequest()) return;
    const verdict = { valider: 'validé', rejeter: 'rejeté', plus: 'demandé plus' }[action];
    if (!verdict) return;
    const r = await this.call('pensee', {
      messages: [{ role: 'user', content: `Les goûts du Créateur, tels que tu les as compris :\n${this.memoire.tastes.regles.map((x) => `- ${x}`).join('\n') || '(aucune règle encore)'}\n\nSa décision : il a ${verdict} le ticket « ${t.titre} » (${CATEGORIES[t.categorie] || t.categorie}, gravité ${t.gravite}). En clair : ${t.en_clair || '—'}. Constat : ${t.constat}${why ? `\nSa raison : « ${why} »` : '\nIl n’a pas donné de raison.'}\n\nMets à jour les règles : ajoute ce que cette décision t’apprend, précise ou fusionne, retire ce qu’elle contredit. Une règle par ligne, concrète et utile pour choisir et écrire tes prochains tickets. Trente règles au plus. Si la décision n’apprend rien de nouveau, rends les mêmes règles.` }],
      system: 'Tu tiens à jour, pour l’Architecte d’OVERDRAFT, les règles du goût du Créateur. Réponds en français.',
      maxTokens: 6000, effort: 'low',
      format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, required: ['regles'], properties: { regles: { type: 'array', items: { type: 'string' } } } } }
    });
    const text = r.content.find((b) => b.type === 'text')?.text;
    const rules = JSON.parse(text || '{}').regles;
    if (Array.isArray(rules)) {
      this.memoire.setTastes(rules);
      this.log('memoire', `Goûts du Créateur mis à jour (${rules.length} règles) après sa décision sur #${t.id}.`);
      this.notify('memoire', null);
    }
  }

  // The oldest exchanges fold into a summary, so that the conversation never outgrows his mind
  async foldTalk() {
    const fold = this.memoire.talkToFold();
    if (!fold || !this.canRequest()) return;
    const previous = this.memoire.talkSummary.texte;
    const r = await this.call('parole', {
      messages: [{ role: 'user', content: `${previous ? `Résumé déjà écrit :\n${previous}\n\n` : ''}Échanges à ajouter au résumé :\n${fold.entries.map((e) => `${new Date(e.t).toLocaleString('fr-FR')} ${e.qui === 'createur' ? 'Le Créateur' : 'Moi'} : ${e.texte}`).join('\n')}\n\nRéécris le résumé complet, à la première personne (« le Créateur m’a demandé… »), en gardant ce qui compte : ses demandes, ses préférences, ce que j’ai promis, ce qui reste à faire. 25 lignes au plus.` }],
      system: 'Tu tiens la mémoire de l’Architecte d’OVERDRAFT. Réponds en français.', maxTokens: 4000, effort: 'low'
    });
    const text = r.content.find((b) => b.type === 'text')?.text?.trim();
    if (text) this.memoire.setTalkSummary(text, fold.to);
  }

  // The report of a session that ended: the facts, and his own summary when a brain is there to write it
  async writeReport(seance) {
    let bilan = '';
    if (this.canRequest() && (seance.stats.pensees || 0) > 0) {
      try {
        const f = this.memoire.facts(seance);
        const r = await this.call('pensee', {
          messages: [{ role: 'user', content: `Les faits de ta séance :\n${JSON.stringify(f, null, 1)}\n\nÉcris le bilan de cette séance pour le Créateur et pour toi-même à la prochaine séance : ce que tu as fait, ce que tu as trouvé (et ce qui est bien), ce qui reste ouvert, ce que tu feras ensuite. 6 à 12 lignes, des faits, ton caractère.` }],
          system: 'Tu es l’Architecte d’OVERDRAFT. Réponds en français.', maxTokens: 4000, effort: 'low'
        });
        bilan = r.content.find((b) => b.type === 'text')?.text?.trim() || '';
      } catch { /* the facts alone */ }
    }
    const file = this.memoire.saveReport(seance, this.memoire.factualReport(seance, bilan));
    this.log('memoire', `Rapport de la séance ${seance.id} écrit.`, { rapport: seance.id, fichier: file });
    this.notify('memoire', null);
  }
}

const image = (data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
const now = () => Date.now();
const near = (a, b, r) => a && b && Number.isFinite(a.x) && Number.isFinite(b.x) && Math.hypot(a.x - b.x, a.z - b.z) < r;
const ticketId = (id) => String(id ?? '').replace(/^#+/, '').padStart(4, '0');
const mentionsTicket = (text) => /#\d+\b/.test(String(text || ''));

class BrainUnavailableError extends Error {
  constructor(message, code) { super(message); this.name = 'BrainUnavailableError'; this.code = code; }
}

// UTF-8 bytes bound text tokens conservatively; JPEG dimensions bound image tokens without treating their base64
// encoding as prompt text. The output reservation covers max_tokens, including hidden reasoning.
function requestCostBound(model, params) {
  const size = (value) => {
    if (value?.type === 'image') {
      const bytes = Buffer.from(value.source?.data || '', 'base64');
      let pixels = 0;
      for (let i = 2; i + 9 < bytes.length && bytes[i] === 0xff;) {
        const marker = bytes[i + 1], length = bytes.readUInt16BE(i + 2);
        if (length < 2 || i + 2 + length > bytes.length) break;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          pixels = bytes.readUInt16BE(i + 5) * bytes.readUInt16BE(i + 7); break;
        }
        i += length + 2;
      }
      return 4096 + Math.ceil(pixels / 128);
    }
    if (typeof value === 'string') return Buffer.byteLength(value, 'utf8') + 8;
    if (Array.isArray(value)) return 16 + value.reduce((n, v) => n + size(v), 0);
    if (value && typeof value === 'object') return 16 + Object.entries(value).reduce((n, [k, v]) => n + size(k) + size(v), 0);
    return 16;
  };
  const input = 1024 + size({ system: params.system, messages: params.messages, tools: params.tools, output_config: params.output_config });
  return (input * Math.max(model.price.in, model.price.write) + params.max_tokens * model.price.out) / 1e6;
}

function replayProblem(original, replay, since) {
  if (!original || !replay || replay.id === original.id || replay.refait !== original.id) return 'aucun rejeu enregistré de l’expérience d’origine';
  if (original.validite !== 'valide' || replay.validite !== 'valide') return 'l’expérience de référence ou son rejeu est incomplet ou perturbé';
  const startedAt = replay.debut ?? replay.t;
  if (!Number.isFinite(since) || !Number.isFinite(startedAt) || startedAt < since) return 'le rejeu date d’avant la livraison';
  if (!replay.photos?.length || original.type !== replay.type) return 'le scénario ou ses photos ne correspondent pas';
  const a = original.protocole, b = replay.protocole;
  if (!Number.isFinite(a?.revision) || a.revision !== b?.revision || a.trafic !== 'actif_non_fige' || b.trafic !== a.trafic
    || a.pas_simulation !== 'variable' || b.pas_simulation !== a.pas_simulation) return 'le protocole a changé ou manque dans la référence';
  const ca = a.conditions, cb = b.conditions;
  if (!Number.isFinite(ca?.heure) || !Number.isFinite(cb?.heure) || ca.heure < 0 || ca.heure > 24 || cb.heure < 0 || cb.heure > 24 || !ca.meteo || ca.meteo !== cb.meteo
    || Math.min(Math.abs(ca.heure - cb.heure), 24 - Math.abs(ca.heure - cb.heure)) > 0.1) return 'l’heure ou la météo du rejeu diffère de la référence';
  if (!near(original.lieu, replay.lieu, 1.01) || (Number.isFinite(original.lieu.y) && Number.isFinite(replay.lieu.y) && Math.abs(original.lieu.y - replay.lieu.y) > 1)) return 'le rejeu n’a pas été réalisé au même lieu (tolérance 1 m)';
  const params = (p = {}) => canonical(Object.fromEntries(Object.entries(p).filter(([k]) => !['refaire', 'raison', 'version_jeu', 'conditions'].includes(k))));
  if (params(original.params) !== params(replay.params)) return 'les paramètres du rejeu ne correspondent pas à la référence';
  return null;
}

function canonical(value) {
  const ordered = (v) => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, ordered(x)])) : v;
  return JSON.stringify(ordered(value));
}

// Where a verification stands, in words he can act on
function verificationStep(t, stale) {
  if (stale.some((f) => (t.livraison?.fichiers || []).includes(f)) || (stale.length && !t.livraison)) return 'le jeu tourne sur l’ancien code : recharger_le_jeu (mode Seul), puis retourner_au_ticket';
  const step = t.verification?.etape || 'retourner';
  return {
    retourner: 'retourner_au_ticket',
    photographier: 'sur place : rephotographier sous le même angle',
    experience: `sur place : refaire l’expérience ${t.experience} (lancer_experience, refaire: "${t.experience}")`,
    conclure: 'photos d’après prises : conclure_verification'
  }[step] || step;
}

// Two runs of the same experiment, measure by measure
function compareMeasures(before = {}, after = {}) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  return keys.map((k) => {
    const a = before?.[k], b = after?.[k];
    const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(2)) : v ?? '—');
    return `- ${k} : ${fmt(a)} → ${fmt(b)}`;
  }).join('\n');
}

// One line for the journal: what he did, in French
function summarize(name, input) {
  const i = { ...input, id: input.id === undefined ? undefined : ticketId(input.id) };
  const by = { pied: 'à pied', voiture: 'en voiture', helico: 'en hélico', auto: '' };
  switch (name) {
    case 'planifier': return `Programme « ${i.sujet} » : ${(i.etapes || []).length} étape(s) — ${i.raison || ''}`;
    case 'abandonner_programme': return `Abandonne son programme : ${i.raison || ''}`;
    case 'aller_a': return `Part vers ${i.lieu || `${Math.round(i.x)}, ${Math.round(i.z)}`} ${by[i.moyen] || ''} : ${i.raison || ''}`;
    case 'suivre_joueur': return `Suit le joueur : ${i.raison || ''}`;
    case 's_arreter': return `S’arrête : ${i.raison || ''}`;
    case 'dire': return `« ${i.texte} »`;
    case 'envoyer_sms': return `SMS : « ${i.texte} »`;
    case 'chercher_tickets': return `Cherche les tickets${i.pres_de_moi ? ' près de lui' : ''}${i.mots ? ` (${i.mots})` : ''}`;
    case 'chercher_memoire': return `Cherche dans sa mémoire : ${i.mots}`;
    case 'ouvrir_ticket': return `Propose un ticket : ${i.titre}`;
    case 'noter': return `Note : ${i.note}`;
    case 'verifier_ticket': return `Revoit le ticket #${i.id}`;
    case 'completer_ticket': return `Complète le ticket #${i.id} : ${i.commentaire}`;
    case 'retourner_au_ticket': return `Retourne au lieu du ticket #${i.id} : ${i.raison || ''}`;
    case 'conclure_verification': return `Conclut le ticket #${i.id} : ${i.verdict === 'corrige' ? 'corrigé' : 'toujours présent'}`;
    case 'regler_heure_meteo': return `Règle ${i.heure !== undefined ? `l’heure (${i.heure} h)` : ''}${i.meteo ? ` la météo (${i.meteo})` : ''}`;
    case 'se_teleporter': return `Se téléporte vers ${i.lieu || `${Math.round(i.x)}, ${Math.round(i.z)}`} : ${i.raison || ''}`;
    case 'recharger_le_jeu': return `Recharge le jeu : ${i.raison || ''}`;
    case 'identifier': return `Identifie ce qu’il voit (${Math.round((i.x ?? 0.5) * 100)} %, ${Math.round((i.y ?? 0.5) * 100)} %)`;
    case 'sonder_sol': return `Sonde le sol autour de lui (${i.rayon || 6} m)`;
    case 'mesurer_vehicule': return `Mesure un véhicule (${i.cible}, ${i.duree || 4} s)`;
    case 'mesurer_performances': return `Mesure les performances (${i.duree || 4} s)`;
    case 'lancer_experience': return `Expérience ${i.type}${i.refaire ? ` (rejoue ${i.refaire})` : ''}`;
    default: return name;
  }
}

export { BRAINS, Brain, BrainUnavailableError, MODELS, PROFILE, SELF, TOOLS, compareMeasures, replayProblem, requestCostBound, summarize, systemPrompt, verificationStep };
