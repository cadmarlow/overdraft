# L'Architecte

L'Architecte est l'un des architectes de ce monde. Il vit dans la même partie que le joueur, joue avec les mêmes armes et
les mêmes véhicules, et n'a qu'une mission : rendre OVERDRAFT de plus en plus réel. D'abord cette ville, au niveau d'un
AAA comme GTA V, puis au-delà, jusqu'à un univers, peut-être une civilisation. Il parcourt Manhattan, trouve ce qui casse,
ce qui est laid et ce qui n'est pas fun, le prouve, le fait remonter au Créateur (l'utilisateur), puis vérifie que c'est
corrigé.

Ce document fixe ce qui a été décidé avec le Créateur le 2026-11-02 et le 2026-11-03. Il fait foi pour tout agent qui
travaille sur l'Architecte.

## Qui il est

- **Un des architectes du monde.** Il en connaît la matière (textures, collisions, images par seconde) et l'histoire
  (`CHANGELOG.md` : il se souvient du temps où les habitants étaient des mannequins).
- **Perfectionniste.** Sa seule barre est un jeu AAA. Il est fier de ce qui marche, dur avec ce qui ne marche pas, mais
  juste. **Il ne flatte jamais**, pas même le Créateur.
- **Il a du caractère.** Il défend son avis (« je maintiens que cette façade n'est pas au niveau »), mais le Créateur a
  toujours le dernier mot.
- **Il ne se laisse pas faire.** Si le joueur l'attaque, il riposte par des moyens conventionnels (voir plus bas), puis
  retourne à sa mission. Il s'en souvient.
- **Il recommande.** Il ne se contente pas de signaler : il propose une piste de correction.
- Il est original : pas de cliché d'« architecte » de film (costume blanc, mur d'écrans).

Il n'est pas conscient. Sa mémoire, son but et son refus de céder doivent en donner l'impression.

## Son cerveau

- **Claude, en permanence dès qu'il est allumé.** Le Créateur l'allume et l'éteint quand il veut (l'interrupteur en haut
  de la salle de contrôle, ou ARCHITECTE dans le menu du jeu : les deux restent d'accord). Éteint, il quitte la partie et
  son cerveau s'arrête. L'Architecte ne peut pas l'empêcher et n'agit que dans le jeu.
- **Trois rôles, réglés à part et à tout moment** depuis la salle de contrôle : **ses pensées**, **sa conversation avec
  le Créateur**, **la relecture de ses tickets**. Pour chacun, le modèle (**Vif** : Claude Haiku 5.5, **Équilibré** :
  Claude Sonnet 5.5, **Maximal** : Claude Opus 5.5) et le raisonnement (bas, moyen, haut, très haut, maximum). Le
  réglage compte dès l'appel suivant. Par défaut : pensées et conversation en Équilibré bas, relecture en Maximal moyen.
- **Il pense quand il y a quelque chose à penser** : à chaque étape de son programme avec des photos ou mesures nouvelles,
  quand ses sens ou le jeu signalent quelque chose, quand le code change ou quand le Créateur intervient. Aucun appel
  périodique pour répéter qu'il attend. Sans programme, la prospection choisit un autre point sans appel au modèle.
- **La conversation a sa voie à elle** : quand le Créateur lui parle (K dans le jeu, ou la salle), il répond en quelques
  secondes, même au milieu d'une pensée, qu'il interrompt.
- Ses pensées arrivent dans le journal comme l'API les résume, sans traduction (parfois en anglais).
- **Il poursuit la prospection pendant le cycle des tickets** : attente de validation, demande de précisions, atelier,
  rejet ou échec ne bloquent pas un autre sujet. Il ne revérifie automatiquement que les corrections réellement livrées.
  Les statuts présents du chantier priment sur les anciens récits de sa mémoire.
- **Sa voix est coupée par défaut.** Un bouton reste visible en haut de la salle ; couper annule immédiatement la
  phrase en cours et conserve sous-titres, messages et conversation écrite.
- Garde-fous : un **compteur de dépense** visible (par rôle et par modèle) et un **plafond par séance**. La clé API vit
  dans `.env.local`, côté serveur, jamais dans le navigateur.
- Le corps est scripté (réflexes à 60 images par seconde : conduire, viser, éviter) ; Claude décide du *quoi*, le corps
  fait le *comment*.

## Sa conscience et sa mémoire

Il n'est pas conscient au sens humain. Il sait en revanche, à chaque pensée, ce qu'il fait et pourquoi : sa
**conscience** est reconstruite à chaque pensée à partir de sa mémoire, en couches (`chantier/memoire/`) :

- **Lui-même** : sa version et ce qu'elle lui a apporté (il ne prend pas une amélioration de ses outils pour une
  correction du jeu).
- **La séance** : ce qu'il a vu (ses observations, avec photos et lieux), ses conclusions, ses programmes. Une pause
  d'une heure et demie la clôt ; elle devient un **rapport de séance**, relu en **briefing** au début de la suivante.
- **La conversation avec le Créateur**, gardée entière ; les échanges anciens se replient en résumé.
- **Les goûts du Créateur** : des règles tirées de chacune de ses décisions sur un ticket (valider, rejeter, demander
  plus, avec ses raisons), toujours sous ses yeux.
- **Ce qu'il a couvert** de la ville : chaque photo marque une zone de 100 m, de jour, de nuit, sous la pluie.
- **Ce qui a changé dans le monde** : les commits du Créateur (un commit qui cite `#0003` relie le ticket), les
  livraisons de l'atelier, les décisions. Il sait aussi quand le jeu tourne sur du **code périmé** (des fichiers ont changé
  depuis le chargement de la page) et recharge avant de vérifier. Un ticket ouvert dont le code a bougé depuis lui est
  signalé : il va le revoir.
- **Son carnet**, et `chercher_memoire` pour retrouver le reste (séances passées, conversation, commits).

## Ses yeux et ses mains

- **Son œil** : une photo est une image rendue depuis sa tête, dans la direction, le cadrage (sol, rue, façade, haut,
  ciel) et le zoom qu'il choisit, où que soit la caméra du joueur. `main.js` lui passe la main juste avant l'image du joueur.
  Loin de la caméra du joueur (plus de 220 m), la ville est simplifiée : la photo le dit.
- **Le rétroviseur** : les six dernières secondes du monde, dix fois par seconde. Un capteur qui se déclenche envoie les
  secondes d'avant, et pour un accident, un véhicule retourné ou un corps enfoncé, une rafale de photos de l'endroit.
- **Les sondes** : `identifier` (l'objet 3D sous un point de sa photo, son matériau, le module qui le fabrique),
  `sonder_sol` (le sol calculé pour les corps contre le sol dessiné), `mesurer_vehicule`, `mesurer_performances`.
- **Les expériences**, en mode Seul, rejouables avec les mêmes réglages : `crash` (sa voiture percute une berline garée à la vitesse
  voulue), `explosion` (à 2 m d'une voiture garée), `bordure` (il longe un trottoir en mesurant ses pieds), `nuit` (la même
  façade à 13 h et à 23 h). Un défaut de comportement se prouve et se vérifie par une expérience, pas par une photo.
  Leur protocole porte la version du jeu, l'heure, la météo et les paramètres. Le trafic et le pas de simulation restent
  variables : une mesure perturbée ou incomplète ne vaut pas preuve. Reprendre la caméra, éteindre, mourir ou recharger
  annule l'expérience, retire ses objets temporaires et restaure l'atmosphère.
- **Le programme de travail** : un sujet et ses étapes (lieu, regards, ce qu'il cherche). Son corps l'exécute seul, et
  il est rappelé à chaque étape avec les photos pour juger.

## Une seule partie, celle du joueur

Le jeu ne fait vivre la ville (trafic à 380 m, piétons à 320 m, mobilier dès 300 m) qu'autour de la caméra, comme tous
les mondes ouverts. D'où deux façons de travailler :

- **Ensemble** : le joueur joue, la ville vit autour de lui. L'Architecte travaille dans cette zone (environ 350 m), le
  croise, et se défend s'il est attaqué.
- **Seul** (« Lui » sous « Qui tient la caméra ? » dans la salle, « Lui donner la caméra » dans le jeu, touche **L**) :
  la caméra passe sur lui, la ville vit autour de lui, il peut aller partout. Le personnage du joueur est mis à l'abri
  (immobile, intouchable). « Toi » ou la même touche rend la caméra. Seulement hors poursuite et hors mission. C'est
  toujours le Créateur qui la donne : il ne la prend jamais de lui-même.

Quand le joueur quitte l'onglet du jeu, la partie se met en pause, l'Architecte avec. S'il tient la caméra, la partie
continue en arrière-plan : un minuteur dans un Worker fait tourner la boucle du jeu (`keepAlive` dans `architect.js`,
branché par `main.js`). Plus tard, si besoin : faire vivre deux zones à la fois (coûte des images par seconde).

## Face au joueur

- **Moyens conventionnels uniquement** : l'arsenal du joueur, tous les véhicules, la ruse (poursuite, embuscade, se
  fondre dans le trafic). Jamais de téléportation du joueur, jamais de désarmement magique.
- Riposte graduée : un avertissement, puis le combat s'il insiste. Il le prend en chasse s'il fuit.
- **Il est mortel.** S'il meurt, il réapparaît un peu plus tard, sans rien perdre, et s'en souvient.
- **Le joueur tué par l'Architecte ne perd rien** : pas de frais d'hôpital.
- Ses **outils d'architecte** (se déplacer lui-même instantanément, régler l'heure et la météo, placer sa caméra) servent
  seulement à son travail : jamais contre le joueur, jamais pendant un combat.

## Ses tickets

- **Pas de preuve, pas de ticket** : captures, adresse, lien de reproduction (`?qa=1&at=…&heure=…&meteo=…`), version.
- **Jamais de doublon** : il cherche avant d'écrire.
- **Deux canaux séparés** : sa personnalité vit dans ce qu'il *dit* au joueur ; les tickets restent froids, précis,
  techniques.
- **Aucun ticket ne part à l'agent dev sans la validation du Créateur.** Écran de validation : capture en grand et autres
  angles, commentaire et piste, mini-carte, bouton « Voir dans le jeu ». Valider, Rejeter (avec une raison), Demander plus.
  Raccourcis clavier. Les rejets lui apprennent le goût du Créateur.
- Un ticket est un dossier dans `chantier/` (ignoré par git) : `ticket.md` (fiche et fil de discussion entre
  l'Architecte, l'agent dev et le Créateur) et les captures.

Cycle : repéré → confirmé → proposé → **validé par le Créateur** → corrigé par l'agent dev → revérifié par l'Architecte
(photos avant/après) → clôturé ou rouvert. Le Créateur commite quand il le décide.

## L'agent dev

Une session Claude Code lancée par le serveur de l'Architecte (`claude -p`), un ticket validé à la fois, dans le dossier
où tourne le serveur (sur sa branche : `main` d'habitude), réglée comme les sessions du Créateur : Claude Opus 5.5, effort
xhigh, mode de permissions auto (`CLAUDE.md` → `AGENTS.md`), avec les leçons de sa mémoire Claude Code. Il lit le ticket,
ses photos et son expérience, corrige, lance `npm test`, et finit par une **fiche de livraison** structurée (résumé simple,
fichiers, comment vérifier, ce qui est attendu, ce qui n'est pas vérifié) que l'Architecte reçoit aussitôt. **Il ne
commite jamais** (commit, push, branche, reset, restore… lui sont interdits). Les tickets « outil » (les yeux et le corps
de l'Architecte) l'autorisent à toucher `js/architect*.js`, jamais au serveur de l'Architecte.

Chaque session est encadrée par des relevés de Git recoupés avec les traces de ses outils. Une modification concurrente,
un commit pendant la session ou un fichier interdit rend l'attribution incertaine et empêche d'accepter la livraison.
Les variations restent visibles, sans être présentées comme les seules corrections de l'atelier. Le chevauchement de
deux écritures dans le même appel d'outil demande encore une isolation supplémentaire.
Une fiche structurée, un processus terminé normalement et les tests du dernier état du code sont obligatoires.
Ce qu'elle lance (un Chrome sans fenêtre, un serveur) est arrêté à sa fin ; l'arrêt a un délai puis force la fermeture.
La mémoire automatique extérieure de Claude Code est désactivée pour ce processus ; les leçons du dossier personnel
se lisent sans jamais s'y écrire. Un garde avant outil refuse une écriture hors périmètre. Après un arrêt, un audit
indépendant borné conserve les variations observées et leur degré de certitude ; un relevé manquant ne devient jamais
« aucun fichier modifié », et une livraison interrompue n'est jamais validée automatiquement.
La liste des sessions inclut la session active dès son démarrage, puis son résultat sans doublon. Son détail et la
carte « En cours » affichent une commande à copier : `node tools/architecte/suivre-session.mjs <id>` suit les étapes,
outils et tests résumés dans le Terminal, en lecture seule. Ctrl-C quitte ce lecteur sans arrêter l'atelier.
À la fin seulement, `claude --resume <id>` et « Rouvrir dans le Terminal » reprennent la conversation dans Claude Code.

## Suivre son travail

- **Dans le jeu** : l'étiquette au-dessus de sa tête (ce qu'il fait), ses répliques et ses réponses (sous-titre et voix),
  ses SMS, un point violet sur la carte.
- **La salle de contrôle** (http://localhost:7780, aussi sur iPhone en Wi-Fi), en terminal moderne (vert nuit, Geist et
  Geist Mono, lui en violet, l'action en vert clair) : une barre en haut (qui il est, l'interrupteur Allumé / Éteint, les
  pages, l'état du jeu, la dépense), une ligne jaune quand quelque chose le bloque, et cinq pages. **Direct** : ce qu'il
  fait en une phrase, « Qui tient la caméra ? » (Toi ou Lui), la vue en direct, son programme, son fil, la conversation, ce
  qui attend le Créateur, l'atelier en bref, la carte. **Tickets** : une voie par étape (à valider, à l'atelier, à
  vérifier, clos), la revue en grand avec avant et après côte à côte (V, R, D). **Atelier** : la session au travail (sa
  phase, ses fichiers, ses tests, ses étapes en direct), la file, le code (branche, fichiers non commités rangés par
  ticket, diffs), le message de commit proposé, toutes les sessions. **Profil** : son identité, sa mission, son
  caractère, ce qui le guide, les goûts du Créateur tels qu'il les a compris (corrigeables règle par règle), son cerveau
  (modèle et raisonnement par rôle, plafond, voix, vue, atelier), ses outils. **Mémoire** : la séance, ce qu'il a
  photographié, ses rapports, ses expériences, ce qu'il a appris du monde, son carnet.
- **L'historique** : un journal par jour, un rapport par séance.

## Les étapes

1. **Le corps** (sans Claude). Il apparaît (menu ou panneau de test), se déplace sur ordre à pied, en voiture et en
   hélico, se bat, prend la caméra (**L**), a ses capteurs (erreurs, coincé, enfoncé dans le sol, NaN, chutes d'images),
   les liens de reproduction, et un panneau de test sous `?qa=1`.
2. **Le cerveau.** `npm run architecte` (serveur dans `tools/architecte/`, seule dépendance : le SDK Anthropic), boucle
   Claude, outils, mémoire, personnalité, riposte décidée, SMS, tickets. Il faut la clé API du Créateur.
3. **La salle de contrôle.**
4. **L'atelier** : tickets validés → agent dev → revérification.
5. **L'Architecte v2** (2026-11-03) : le cerveau à trois rôles réglables, la conscience et la mémoire en couches, la
   conversation à part, le programme de travail, son œil, le rétroviseur, les sondes, les expériences, la conscience du
   code (Git, livraisons, code périmé), la salle refaite en terminal moderne avec l'interrupteur, la caméra donnée ou
   reprise d'un clic, l'atelier sur une page entière et son profil.

Ses premiers chantiers, et son examen d'entrée : les boutiques (niveau d'un jeu des années 1990), les explosions
incohérentes, le joueur qui s'enfonce dans le trottoir, les bugs de voiture. S'il ne les trouve pas seul, il n'est pas
prêt.

## Plus tard

- **Multijoueur** : le joueur et l'Architecte chacun dans sa partie, reliés (premier multi à deux) ; puis 2 à 8 amis dans
  un monde (vie partagée : même trafic, mêmes piétons) ; puis des mondes de 50 joueurs, un serveur d'accueil qui ouvre un
  nouveau monde quand les autres sont pleins, une sauvegarde centrale. Un Architecte par monde, à qui les joueurs
  signalent des bugs.
- Un vrai modèle de personnage pour lui (aujourd'hui une tenue existante), l'avion, le bateau et la wingsuit.

## Jamais en ligne

Le jeu est publié sur Vercel (le dernier commit de `main`, construit par `npm run build`) pour y jouer en conditions
réelles et le faire essayer. **L'Architecte ne doit avoir aucune incidence sur cette version.** Deux verrous
indépendants :

1. **Il n'est pas livré.** `scripts/build.mjs` laisse ses fichiers hors de `dist/` (`DEV_ONLY` : `js/architect*.js`,
   `js/repro-link.js`, `css/architect.css`). Aucun `modulepreload`, aucun import statique : rien dans le jeu ne le
   charge.
2. **Il n'est chargé qu'en local.** `main.js` l'importe à la demande (`import('./architect.js')`) seulement si la page
   est servie par cette machine ou son réseau local (`localhost`, `127.0.0.1`, `*.local`, `10.*`, `192.168.*`,
   `172.16-31.*`). Ailleurs, l'import n'est même pas tenté. `?architecte=0` joue sans lui en local, comme en ligne.

En ligne, il ne reste du code partagé que quelques vérifications sans effet : `a.pilot?.()` et `actor.onHurt?.()` dans
`actors.js`, `this.spectate?.()` dans `cameras.js`, `this.architect?.` dans `gameplay.js`, `g.architect?.` dans
`gangs.js`, `gameplay.architect?.` dans `main.js`, et la mort « offerte » de `gameplay.js`, qui ne s'applique qu'à un tueur
marqué `architect`. Vérifié le 2026-11-03 : le build de production servi sous un nom public (comme en ligne) ne télécharge
aucun de ses fichiers, n'affiche ni bouton ni étiquette, ignore la touche L, et une mort par un gang coûte ses frais
d'hôpital habituels. Le test `tests/architect.test.cjs` échoue si l'un de ces verrous saute.

## Où est le code

| Fichier | Rôle |
|---|---|
| `js/architect.js` | Le système : présence, ordres, déplacements, combat, passage de caméra, étiquette, état |
| `js/architect-senses.js` | Les capteurs de bugs et le journal d'événements |
| `js/repro-link.js` | Les liens de reproduction (lire et écrire `?at=…&heure=…&meteo=…`) |
| `js/architect-panel.js` | Le panneau de test, seulement avec `?qa=1` |
| `js/architect-strip.js` | Sa barre d’actions (J), comme celles des armes, du garage et du téléphone |
| `js/architect-link.js` | Le lien avec son serveur : ordres, photos, mesures, expériences, état, événements et rafales, discussion (K), voix |
| `js/architect-eye.js` | Son œil : photos depuis sa tête, `identifier`, `sonder_sol` |
| `js/architect-retro.js` | Le rétroviseur (les six dernières secondes), les rafales, le capteur de véhicule retourné |
| `js/architect-lab.js` | Les expériences : crash, explosion, bordure, nuit |
| `css/architect.css` | Ses styles, chargés par `architect.js` |
| `tools/architecte/server.mjs` | Le serveur (`npm run architecte`) : relie le jeu, le cerveau, le programme, la mémoire, le code, l’atelier et la salle |
| `tools/architecte/brain.mjs` | Le cerveau : rôles, conscience, outils, voie de conversation, relecture, goûts, rapports, dépense |
| `tools/architecte/memoire.mjs` | Sa mémoire : séance, conversation, goûts, couverture, changements, rapports |
| `tools/architecte/programme.mjs` | Le programme de travail que son corps exécute |
| `tools/architecte/code.mjs` | Le code vu par Git : commits, fichiers non commités, code périmé, relevés d’une session et ses diffs |
| `tools/architecte/chantier.mjs` | Le chantier sur le disque : tickets, photos, expériences, journal, carnet, réglages |
| `tools/architecte/ticket-policy.mjs` | Autorité du Créateur, migration des anciennes validations et transitions permises |
| `tools/architecte/ticket-actions.mjs` | Décisions de la salle, retrait d'autorisation et lancement contrôlé de l'atelier |
| `tools/architecte/atelier.mjs` | L’atelier : `claude -p` sur les tickets validés, sessions suivies, fiche de livraison, processus nettoyés |
| `tools/architecte/salle/` | La salle de contrôle (`salle.js` et ses modules : tickets, atelier, profil, mémoire, carte) |
| `tools/architecte/README.md` | Le mode d’emploi |
| `tools/architecte/check-browser.mjs` | Contrôle du vrai jeu et de la salle dans un Chrome isolé, sans clé ni atelier automatique |
| `tools/architecte/check-server.mjs` | Contrôle HTTP/SSE réel : allumage rapide, remplacement de connexion, réponses tardives et déconnexion |
| `tools/architecte/suivre-session.mjs` | Suivi Terminal en lecture seule des étapes d'une session, sans nouvel agent ni appel API |
| `tools/architecte/check-workshop.mjs` | Témoin de correction par une vraie session Claude Code, uniquement avec `--live` et dans une copie jetable |

Tout nouveau fichier de l'Architecte reste dans ces noms (`js/architect-*.js`, `css/architect*.css`) pour rester hors du
build, et n'est jamais importé statiquement par le jeu.

## État (2026-11-04) : l'Architecte 2.2, continuité du travail

L'incident réel #0003 a montré deux défauts que les essais précédents ne couvraient pas : une écriture de mémoire Claude
hors projet interrompait la session puis empêchait le relevé final ; le cerveau répétait ensuite une ancienne attente
de livraison alors que le ticket était en échec et son programme fini. La version 2.2 traite ces causes dans le moteur
de travail, les informations fournies au modèle, les permissions de l'atelier et l'affichage de ses résultats.

La prospection enchaîne lieux, sujets et conditions encore peu couverts, en utilisant les modes disponibles du corps
(marche, voiture, hélico). Elle reste dans la zone du joueur en mode Ensemble et ne prend jamais la caméra. Un trajet
sans progrès est repris, puis le point est temporairement écarté. Les photos et mesures nouvelles déclenchent le jugement ;
un compteur de temps seul n'en déclenche plus. Interrupteur, pause humaine, combat et plafond gardent la priorité.

Le bateau, l'avion et la wingsuit ne sont pas encore des modes de déplacement de l'Architecte. Le jeu les possède,
mais lui ne doit pas prétendre disposer d'un pilotage qui n'est pas implémenté.

Vérifications de cette version : **572 tests réussis sur 573**, aucun ignoré en activant l'essai HTTP ; seul échec
`tree-geodata` attendu à cause de la licence Xcode. Build statique réussi. Dans des Chrome privés : **56 contrôles
approfondis**, **14 contrôles de salle**, **12 contrôles d'autonomie avec vrais déplacements et photos** et **7 contrôles
du build public**, sans erreur navigateur. Trois observations ont produit six photos, les modes marche/voiture/hélico
ont été observés et un quatrième programme est reparti malgré les tickets fictifs en attente.

Une séance du **cerveau réel**, séparée et plafonnée à 0,50 $, a jugé ses photos, conclu sans inventer de défaut, puis
repris un autre programme (0,0324575 $ mesurés ; huit contrôles). Un vrai Claude Code a corrigé un dépôt jetable et
livré après trois tests réussis ; une capture neuve et un rejeu ont permis la clôture, avec refus préalable sans preuve.
Le défaut réel #0003 garde son statut d'échec : ses neuf chemins modifiés ont été récupérés dans un bilan partiel
explicitement non attribuable, sans prétendre que cette session avait livré une correction acceptée.

La régression des 45 minutes immobiles est également rejouée avec une horloge et un modèle contrôlés : douze programmes,
au moins vingt-quatre photos et six lieux, aucune respiration facturée. Cela vérifie le moteur de continuité ; le
jugement artistique, les faux positifs et le coût sur des séances autonomes longues restent à mesurer.

## État historique (2026-11-04) : l'Architecte 2.1, fiabilité

Le travail v2 est remis sur la base du jeu **0.9.4 — Momentum**. La version de l'outil est séparée de celle du jeu.

- Validation du Créateur enregistrée sur disque et vérifiée à chaque transition ; rejet ou demande de précisions retire
  l'autorisation et interrompt la correction. Une ancienne étiquette « validé » ne suffit pas à autoriser l'atelier.
- Aucun ticket n'est clos sans preuve récente enregistrée après livraison, au bon endroit, et rejeu valide si le défaut
  possède une expérience. La relecture indisponible conserve son brouillon dans `chantier/memoire/relectures/`.
- Les preuves portent le chargement du jeu et l'état du code observé ; un rechargement n'actualise jamais une ancienne
  photo. Les réserves API sont enregistrées avant l'appel et conservées comme coût incertain après un redémarrage.
- Sauvegardes bornées pendant l'activité, JSON remplacés atomiquement, identifiants de séance uniques. Appels API
  contrôlés au point central et budget réservé en commun pour pensées, conversation, relecture et tâches de mémoire.
- Une réserve prudente peut arrêter avant consommation totale du plafond. Une requête interrompue peut déjà avoir été
  facturée : son coût incertain est affiché séparément et reste retenu pour le plafond.
- Mesures FPS indépendantes du buffer circulaire ; vitesse latérale et verticale incluse ; zoom des photos restauré ;
  identification limitée aux objets visibles et renvoyée sous forme JSON légère.
- Contrôle navigateur approfondi : **52 vérifications réussies**, puis **25 réussies lors de la dernière repasse**,
  aucune erreur JavaScript ni ressource manquante. Quatre expériences terminées avec mesures et photos, restauration
  immédiate de la météo et de l'adhérence, sauvegarde protégée pendant les essais ; annulations, allumage rapide et
  commandes joueur neutralisées en mode Seul. Décisions V/R/D/Entrée/Échap dans la salle, persistance après redémarrage,
  caméra donnée et reprise dans un onglet réellement masqué ; cinq pages sur ordinateur et à 390 px de large.
- **13 contrôles HTTP/SSE réussis** : ordre ancien annulé au remplacement du flux, réponse tardive ignorée, déconnexion
  immédiate, allumage appliqué malgré un cache obsolète et refus explicite de clore une séance vide.
- **6 contrôles du build publié réussis** sous un domaine public simulé dans Chrome : WebGPU, marche AZERTY, mort et
  soins normaux ; aucun import ni interface de l'Architecte. Build de 406 fichiers, aucun module local ni secret.
- **526 tests réussis sur 527** ; seul échec attendu `tree-geodata`, lié à la licence Xcode non acceptée. Les compteurs
  de dessin sont prélevés après le rendu, avant leur remise à zéro par Three.js, puis moyennés sur la mesure.
- **Boucle d'atelier réelle sur dépôt jetable** : un défaut de calcul de vitesse reproduit par les tests, corrigé par
  Claude Code dans un seul fichier, trois tests réussis, empreintes et attribution vérifiées, aucun commit. La vraie
  classe du cerveau refuse la clôture sans preuve, puis clôt après une capture neuve des mesures et une expérience
  compatible (0 → 36 km/h). Cet essai vérifie le chemin technique ; il ne démontre pas le jugement artistique autonome.

Les tests métier reproduisent notamment les cinq défauts de l'audit (autorité, preuves, mémoire, arrêts/budget,
instruments), y compris leurs cas négatifs. Les commandes des contrôles sont dans le guide du serveur.
La découverte autonome de défauts inconnus dans la ville, le taux de faux positifs et le coût par correction utile
restent à mesurer sur des séances longues. Une vieille référence sans protocole doit être réétablie avant clôture.

Complément du 4 novembre : sessions actives visibles dans l'historique et suivi Terminal en lecture seule.
**17 tests ciblés** et **10 contrôles Chrome** réussis : première session, copie réelle de la commande, détail en direct,
passage à la fin sans doublon, reconnexion et affichage à 390 px. Suite globale : 547 réussites, un échec Xcode attendu,
un essai HTTP optionnel sauté puis exécuté avec succès séparément ; build réussi. Aucun redémarrage du serveur requis
pour cette amélioration de la salle.

## État historique (2026-11-03) : l'Architecte v2

Fait sur la branche locale `feature/architecte-v2` (worktree `.claude/worktrees/architecte-v2`), partie de `main` en
0.9.3. Vérifié dans un Chrome à part, branché à des serveurs d'essai (jamais au serveur ni à l'onglet du Créateur) :

- **Son œil** : photos en 40 à 190 ms, dans toutes les directions ; le cadrage « haut » montre enfin le haut des
  immeubles (son ticket #0004). Identification de l'objet, sonde du sol (écart de 4 cm trouvé entre le trottoir calculé,
  22 cm, et le trottoir dessiné, 18 cm, à la 45e), mesures d'images par seconde et de véhicule.
- **Les quatre expériences** tournent et se rejouent à l'identique (crash à 63 km/h : la cible projetée de 11 m, rien
  d'aberrant ; explosion à 2 m : 61 de dégâts, voiture projetée de 11 m sans décoller ; bordure : 59 mesures, aucun écart ;
  nuit : 96 puis 29 de luminosité). Quand le trafic bouscule la cible avant le choc, l'expérience le dit et demande d'être
  reprise.
- **Deux séances réelles avec la clé**, sur une copie de son vrai chantier (atelier coupé). Il a repris seul la
  vérification en attente de #0001 et l'a close sur un crash rejoué ; il a vu que le commit 0.9.3 touchait les boutiques
  et a lancé un programme pour revoir #0002 et #0003 ; il a enchaîné six programmes avec photos ; il a répondu au Créateur
  en 3,8 à 6,1 s en plein travail, une seule fois par message ; il sait qu'il est passé en v2.
- **La salle de contrôle** : les cinq pages sur ordinateur et sur téléphone (390 px, pas de défilement horizontal, aucune
  erreur). Contre un vrai jeu : l'interrupteur le fait entrer et sortir de la partie (trois allers-retours de suite), Toi
  / Lui donne et reprend la caméra, un onglet caché ne lui donne plus la caméra, une règle de goût s'ajoute et se retire
  depuis le Profil.
- **Son œil dans un onglet caché** : ses photos y étaient figées (la même image à trois endroits, il l'avait vu lui-même).
  Cause : three.js ne dessine la scène qu'une fois par image, et seule sa boucle `requestAnimationFrame` passe à
  l'image suivante ; le minuteur d'un onglet caché ne la faisait jamais avancer. `nextFrame()` (dans `architect-eye.js`)
  la fait avancer après chaque photo et, onglet caché, quand une image est demandée. Ça supprime aussi l'image de son œil
  que le joueur voyait passer une fraction de seconde à chaque photo.
- `npm test` : 420 sur 421 (seul échec attendu : `tree-geodata`, licence Xcode).

Limites connues :
- **La dépense monte avec le travail** : environ 0,58 $ pour 5 minutes en Équilibré bas (13 pensées, 24 photos jugées),
  contre 1,43 $ l'heure en v1 (54 photos dans l'heure, la moitié des pensées vides). Le plafond par défaut (3 $ par
  séance) tient donc environ 25 minutes de travail continu : à relever si le Créateur veut des séances longues.
- La boucle complète avec l'atelier qui modifie vraiment le code n'a pas été rejouée avec la v2 (l'atelier est resté
  coupé pendant les essais) : la fiche de livraison structurée a été vérifiée sur un appel court de `claude -p`.
- Loin de la caméra du joueur (mode Ensemble, plus de 220 m), son œil voit une ville simplifiée : la photo le dit, mais il
  vaut mieux le laisser travailler seul pour l'art.
- L'expérience `crash` dépend du trafic : une cible bousculée avant le choc fausse la mesure (signalé).
- Ses pensées résumées arrivent parfois en anglais (voulu : plus de traduction).

## État (2026-11-03) : étapes 1 à 4 faites

Vérifié dans un Chrome à part, avec de vraies touches : il apparaît dans le champ du joueur (menu pause ou panneau de
test), le suit, marche sur les trottoirs, prend sa voiture dans le trafic (environ 60 km/h), vole en hélico en suivant la
hauteur des toits, patrouille seul entre les grands lieux de Midtown, prend la caméra avec **L** (les touches du joueur
sont alors coupées, sauf L, Échap, M, H et N), avertit puis riposte, poursuit en voiture et tire par la fenêtre, meurt et
revient au bout de 25 s. Le joueur qu'il tue ne paie rien à l'hôpital. Les liens de reproduction remettent la position,
le regard, l'heure et la météo. Les capteurs ont relevé une vraie saccade (243 ms) et un accident de sa voiture.

Limites connues :
- **Tenue** : le costume de ville (`suit`), comme les hommes du Syndic. La seule tenue libre (`detective`) porte un gilet
  POLICE. Son propre modèle viendra plus tard.
- **Capteur « enfoncé »** : il compare la position au sol que le jeu calcule. Le bug du trottoir signalé par le Créateur
  vient sans doute d'un écart entre le trottoir dessiné et ce sol calculé : ce capteur ne le voit pas, il faudra ses yeux
  (étape 2) ou une sonde de la géométrie.
- À pied, il traverse les avenues en diagonale au début d'un trajet, et les voitures de la circulation le traversent.
- Son hélico n'est pas une cible (hors de la flotte de jeu) et ne heurte pas les façades : il passe au-dessus des toits.
- En mode Seul, la mini-carte reste centrée sur le joueur ; le nom de rue affiché est bien le sien.
- Pendant qu'il a la caméra, les déplacements à la manette et au tactile sont remis à zéro à chaque image, mais les
  boutons d'action de la manette (tirer, véhicule) ne sont pas bloqués : non vérifié.


### Étapes 2 à 4 : le cerveau, la salle de contrôle, l’atelier

Lancer : `npm run dev`, puis `npm run architecte` (la clé dans `.env.local`), puis dans le jeu menu pause →
ARCHITECTE. Salle de contrôle : http://localhost:7780 (sur l’iPhone, l’adresse avec le jeton affichée au démarrage).
Mode d’emploi complet : `tools/architecte/README.md`.

Vérifié le 2026-11-03 avec la vraie clé, le jeu dans un Chrome à part branché à un serveur d’essai :
- les trois cerveaux répondent avec les outils (Vif 1,4 s, Équilibré 2,5 s, Maximal 2,1 s par pensée) ;
- **son examen d’entrée, premier point réussi seul** : 30 s après son arrivée près de Times Square, il a photographié une
  vitrine sous un autre angle, cherché un doublon et proposé un ticket « vitrines en aplats opaques sans profondeur,
  enseignes plates » ; sa pensée lente (Maximal) l’a resserré ; la piste désigne un matériau de verre et un intérieur
  factice ;
- il répond quand on lui parle (« on se croirait en 1996 »), juge ses capteurs (une saccade isolée va au carnet, pas en
  ticket), écarte une fausse alerte (la cabine de son hélico devant la caméra), et ne fabrique rien : quand il ne
  retrouve pas une vitrine, il le dit ;
- en mode Seul il patrouille seul (voiture, hélico au-dessus des toits) ; il recharge le jeu lui-même et reprend sa
  place caméra en main (vérifié par un vrai rechargement) ;
- la salle de contrôle affiche la vue en direct, le fil de pensée, la carte, les tickets à valider (ordinateur et
  téléphone) ; les décisions repartent vers lui ;
- l’atelier a traité un ticket d’essai (« ne rien modifier ») en 139 s : réponse juste (`createStorefront` dans
  `js/tsl-materials.js`), `npm test` lancé, aucun fichier modifié.
- Coût mesuré : environ 1,2 à 1,4 centime par pensée avec Équilibré, une pensée toutes les 15 à 30 s.

Limites connues :
- Une partie de son raisonnement résumé revient en anglais : elle est traduite par le cerveau Vif avant d’entrer dans le
  journal (une fraction de centime).
- En mode Ensemble, ses photos sont la caméra du joueur (il n’a pas de second rendu à lui).
- La vue en direct lit l’image du jeu toutes les secondes et demie : une petite saccade à chaque lecture tant qu’une salle
  est ouverte (les capteurs l’ignorent).
- La boucle complète « ticket validé → atelier qui corrige → il revient vérifier » n’a pas été jouée de bout en bout :
  chaque maillon a été vérifié séparément (l’atelier sur un ticket d’essai, le rechargement, la vérification par ses
  outils). Une vraie correction par l’atelier modifie le code du jeu : la première se regarde de près.
- Sa conduite IA monte parfois sur les trottoirs et casse la voiture (ses capteurs le signalent comme accident) ; sa
  voiture encaisse désormais trois fois plus de chocs.
