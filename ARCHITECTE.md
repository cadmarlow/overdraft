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

- **Claude, en permanence dès qu'il est allumé.** Le Créateur l'allume et l'éteint quand il veut ; l'Architecte ne peut
  pas l'empêcher et n'agit que dans le jeu.
- Réglage du cerveau : **Vif** (Claude Haiku 5.5), **Équilibré** (Claude Sonnet 5.5), **Maximal** (Claude Opus 5.5).
  Les verdicts d'art passent par le meilleur modèle.
- **Pensée rapide** toutes les 3 à 5 secondes (où aller, qu'est-ce que je vois, est-ce suspect, répondre au joueur) ;
  **pensée lente** quand ça compte (planifier, confirmer sous plusieurs angles, rédiger un ticket).
- Garde-fous : un **compteur de dépense** visible et un **plafond par session**. La clé API vit dans `.env.local`, côté
  serveur, jamais dans le navigateur.
- Le corps est scripté (réflexes à 60 images par seconde : conduire, viser, éviter) ; Claude décide du *quoi*, le corps
  fait le *comment*.

## Une seule partie, celle du joueur

Le jeu ne fait vivre la ville (trafic à 380 m, piétons à 320 m, mobilier dès 300 m) qu'autour de la caméra, comme tous
les mondes ouverts. D'où deux façons de travailler :

- **Ensemble** : le joueur joue, la ville vit autour de lui. L'Architecte travaille dans cette zone (environ 350 m), le
  croise, et se défend s'il est attaqué.
- **Seul** (« Laisse-le travailler », touche **L**) : la caméra passe sur lui, la ville vit autour de lui, il peut aller
  partout. Le personnage du joueur est mis à l'abri (immobile, intouchable). La même touche rend la main. Seulement hors
  poursuite et hors mission. Pour le laisser tourner : onglet du jeu au premier plan, Mac branché.

Quand le joueur quitte l’onglet du jeu (l’Architecte présent, ni poursuite ni mission), il prend la main et la partie
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

Une session Claude Code lancée par le serveur de l'Architecte (`claude -p`), un ticket validé à la fois, sur `main`,
réglée comme les sessions du Créateur : Claude Opus 5.5, effort xhigh, mode de permissions auto, dans le dossier du jeu
(`CLAUDE.md` → `AGENTS.md`), avec les leçons de sa mémoire Claude Code. Il lit le ticket et ses photos, corrige, lance
`npm test`, répond dans le ticket (ce qu'il a changé, comment vérifier). **Il ne commite jamais** (commit, push, branche,
reset lui sont interdits). Son identifiant de session est dans le ticket : `claude --resume <id>` rouvre la conversation.

## Suivre son travail

- **Dans le jeu** : l'étiquette au-dessus de sa tête (ce qu'il fait), ses répliques, ses SMS, un point violet sur la carte.
- **La salle de contrôle** (`architecte.html`, aussi sur iPhone en Wi-Fi) : ce qu'il voit en direct, le fil de ses
  pensées (ce qu'il écrit et un résumé de son raisonnement, jamais le brut), les tickets à valider, la carte, la dépense,
  des boutons (pause, cerveau, donner un ordre, éteindre).
- **L'historique** : un journal par jour et un rapport de session.

## Les étapes

1. **Le corps** (sans Claude). Il apparaît (menu ou panneau de test), se déplace sur ordre à pied, en voiture et en
   hélico, se bat, prend la caméra (**L**), a ses capteurs (erreurs, coincé, enfoncé dans le sol, NaN, chutes d'images),
   les liens de reproduction, et un panneau de test sous `?qa=1`.
2. **Le cerveau.** `npm run architecte` (serveur dans `tools/architecte/`, seule dépendance : le SDK Anthropic), boucle
   Claude, outils, mémoire, personnalité, riposte décidée, SMS, tickets. Il faut la clé API du Créateur.
3. **La salle de contrôle.**
4. **L'atelier** : tickets validés → agent dev → revérification.

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
| `js/architect-link.js` | Le lien avec son serveur : ordres, photos, état, événements, discussion (K), voix |
| `css/architect.css` | Ses styles, chargés par `architect.js` |
| `tools/architecte/server.mjs` | Le serveur (`npm run architecte`) : relie le jeu, le cerveau, l’atelier et la salle |
| `tools/architecte/brain.mjs` | Le cerveau : rapport, outils, appels à Claude, relecture des tickets, dépense |
| `tools/architecte/chantier.mjs` | Le chantier sur le disque : tickets, photos, journal, carnet, réglages |
| `tools/architecte/atelier.mjs` | L’atelier : `claude -p` sur les tickets validés |
| `tools/architecte/salle/` | La salle de contrôle |
| `tools/architecte/README.md` | Le mode d’emploi |

Tout nouveau fichier de l'Architecte reste dans ces noms (`js/architect-*.js`, `css/architect*.css`) pour rester hors du
build, et n'est jamais importé statiquement par le jeu.

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
