# Le serveur de l’Architecte

Version **2.2**, sur le jeu **0.9.5 — Due Diligence**. Le cerveau de l’Architecte (Claude), sa mémoire, ses tickets, son atelier, la surveillance du code et la salle de
contrôle. Outil de développement local : il ne part jamais en ligne (voir `ARCHITECTE.md`, « Jamais en ligne »).

## Lancer

1. Mettre la clé API Anthropic dans `.env.local`, à la racine du projet (`ANTHROPIC_API_KEY=…`). Ce fichier est ignoré
   par git.
2. Dans un terminal :

   ```sh
   npm run dev          # le jeu, http://localhost:5173
   ```

3. Dans un deuxième terminal :

   ```sh
   npm run architecte   # le serveur, http://localhost:7780
   ```

   Au premier lancement, il installe sa seule dépendance (le SDK Anthropic) dans `tools/architecte/node_modules`.
4. Allume-le : l’interrupteur en haut de la salle de contrôle, ou dans le jeu menu pause (Échap) → **ARCHITECTE**, ou
   **J**. Il arrive, et son cerveau se met en marche. Les deux interrupteurs restent d’accord ; il garde l’état d’un
   lancement à l’autre (éteint au tout premier).

## Dans le jeu

- **J** (ou le losange violet à côté des armes, du garage et du téléphone) : sa barre d’actions. Allumer ou éteindre,
  lui donner la caméra ou la reprendre, lui parler, « suis-moi », « stop », la salle de contrôle.
- **L** : il prend la caméra (mode Seul, autonomie totale, plus de limite de 350 m, expériences permises) ; **L** de
  nouveau pour la reprendre. Il ne la prend jamais de lui-même.
- **K** : lui parler. Il répond par écrit et en sous-titre, même s’il est en train de penser à autre chose. Sa voix est
  coupée par défaut ; le bouton en haut de la salle l'active ou la coupe immédiatement.
- Un lien de reproduction d’une photo de son œil (`&oeil=…`) place la caméra exactement là où il l’a prise, jusqu’à la
  première touche ou au premier clic.

## La salle de contrôle

`http://localhost:7780`, ou sur l’iPhone (même Wi-Fi) l’adresse avec `?jeton=…` que le serveur affiche au démarrage.

- **La barre du haut** : qui il est (version, modèle de ses pensées), **l’interrupteur Allumé / Éteint**, les cinq pages,
  l’état du jeu et la dépense de la séance sur son plafond. Éteint, il quitte la partie, la pensée ou la réponse en cours
  est coupée net (la requête en vol est annulée) et rien de neuf ne part ; son programme garde sa place et reprend à la
  même étape quand tu le rallumes ; un message que tu lui écris l’attend. L’atelier, lui, continue la correction en cours.
  Ce qui le bloque s’affiche en jaune juste dessous, avec le bouton qui le débloque quand il y en a un.
- **Direct** : ce qu’il fait en ce moment, en une phrase ; **« Qui tient la caméra ? » Toi ou Lui** (un clic la donne ou
  la reprend, le jeu suit) ; ce qu’il voit en direct ; son programme, étape par étape ; son fil (filtrable) ; la
  **conversation** (les photos qu’il cite s’affichent avec sa réponse ; désactivée quand il est éteint) ; ce qui attend ta
  décision ; l’atelier en bref ; la carte (lui, toi, les tickets, ce qu’il a couvert).
- **Tickets** : une voie par étape (à valider, à l’atelier, à vérifier, clos). Dans les listes, un ticket à valider se
  valide ou se rejette d’un clic sur sa ligne. La revue : les photos en grand (avant et après côte à côte une fois
  corrigé), « en clair » en tête, puis **la décision, toujours visible** : ce qui se passe maintenant et ce que tu peux
  faire à cette étape. **V** valider ; **R** rejeter et **D** demander des précisions ouvrent un champ pour ta raison,
  **Entrée** confirme, **Échap** annule ; le suivant s’ouvre seul. Un ticket clos se **rouvre** ; un ticket raté ou
  corrigé se renvoie à l’atelier. Ensuite le constat, la piste, le lieu, la livraison de l’atelier, les commits, le fil.
  Chaque décision lui apprend une règle de tes goûts.
- **Atelier** : la session au travail (sa phase sur une ligne, ses fichiers, ses tests, ses étapes en direct, Arrêter),
  la file (monter, descendre, retirer), le code (branche, commits non poussés, fichiers non commités rangés par ticket,
  diff de chaque fichier), le message de commit proposé (à copier : c’est toi qui commites), et toutes les sessions
  (issue, durée, coût, tests, fichiers, diff de la session, `claude --resume`).
- **Profil** : qui il est (sa carte : version, séances, tickets, photos, dépense), sa mission, son caractère, ce qui le
  guide ; **tes goûts tels qu’il les a compris**, que tu corriges règle par règle ; **son cerveau** : pour ses pensées, sa
  conversation et la relecture des tickets, le modèle (Haiku, Sonnet, Opus) et le raisonnement (bas à max), modifiables à
  tout moment ; le plafond, la voix, la vue en direct, l’atelier automatique ; ses outils.
- **Mémoire** : la séance en cours (ce qu’il a vu, ses conclusions, « Clore la séance »), ce qu’il a photographié de la
  ville, ses rapports de séance, ses expériences et leurs mesures, ce qu’il a appris du monde, son carnet.

**Quand tu quittes l’onglet du jeu**, Chrome met la partie en pause, et lui avec : il ne prend plus la caméra tout seul.
Pour qu’il continue sans toi, donne-lui la caméra avant (**Lui** dans la salle, ou **L**) : la partie tourne alors en
arrière-plan (un minuteur dans un Worker fait tourner le jeu à 30 images par seconde). Si la fenêtre du jeu est réduite
dans le Dock, macOS peut quand même ralentir Chrome : laisse-la ouverte derrière les autres plutôt.

## Ce qu’il laisse sur le disque

Tout est dans `chantier/` à la racine (ignoré par git) :

| Chemin | Contenu |
|---|---|
| `chantier/tickets/0001-…/` | `ticket.md` (lisible), `ticket.json`, les photos |
| `chantier/photos/` | toutes ses photos, avec leur lieu, l’heure, la météo et la pose de son œil |
| `chantier/experiences/` | ses expériences : réglages exacts, mesures, photos |
| `chantier/memoire/` | sa séance, la conversation et son résumé, tes goûts, sa couverture, ce qui a changé, ses rapports |
| `chantier/atelier/` | un dossier par session : relevés avant et après, `diff.patch`, `session.json` ; `sessions.jsonl` |
| `chantier/journal/AAAA-MM-JJ.jsonl` | le journal du jour, une ligne par pensée, action, mesure ou événement |
| `chantier/carnet.md` | son carnet |
| `chantier/etat.json` | les réglages (les trois rôles du cerveau), les compteurs, la dépense par jour, rôle et modèle, le jeton |

## L’atelier

La rubrique **Sessions** montre aussi la session en cours, dès son lancement. **Voir la session** ouvre ses étapes
en direct ; le même accès existe dans le ticket. Dans **En cours** ou dans ce détail, **Copier la commande de suivi**
donne une commande à coller depuis la racine du projet :

```sh
node tools/architecte/suivre-session.mjs UUID_DE_LA_SESSION
```

Ce lecteur consulte uniquement l’état local : il affiche les étapes, outils et tests résumés, sans lancer Claude ni
agir sur le travail. Ctrl-C quitte le lecteur et laisse l’atelier continuer. Un serveur sur un autre port se choisit
avec `--url http://127.0.0.1:7781`. Après la fin, **Rouvrir dans le Terminal** et **Copier claude --resume** permettent
de reprendre la conversation dans une session interactive ; ce ne sont pas des commandes pour s’attacher au processus
actif lancé avec `claude -p`.

Un ticket validé est confié à une session Claude Code sans fenêtre (`claude -p`, ton abonnement), un à la fois, réglée
comme tes propres sessions : **Claude Opus 5.5, effort xhigh, mode de permissions auto**, lancée dans le dossier du
serveur (elle lit donc `CLAUDE.md` → `AGENTS.md`), avec les leçons de ta mémoire Claude Code sur le projet. Elle lit le
ticket, ses photos et son expérience, corrige le code, lance `npm test`, et finit par une fiche de livraison
(`--json-schema`) : un résumé simple, les fichiers, comment vérifier, ce qui est attendu, ce qui n’est pas vérifié.
L’Architecte la reçoit aussitôt et va vérifier. Elle ne commite jamais (commit, push, branche, reset, restore… lui sont
interdits). Les tickets « outil » (ses propres yeux et son corps) l’autorisent à toucher `js/architect*.js`.

La validation du Créateur est enregistrée sur disque et contrôlée avant chaque prise en charge. Rejeter un ticket ou
demander plus de preuves retire cette autorisation et interrompt sa correction en cours. Les anciens tickets sans trace
explicite de validation humaine doivent être validés à nouveau.

Une livraison n’est acceptée qu’avec une fiche structurée, un processus terminé normalement et un `npm test` complet
sur le dernier état des fichiers. Seul l’échec précisément identifié `tree-geodata` / licence Xcode est toléré. Une
modification après les tests, un fichier interdit ou une attribution ambiguë garde le ticket en échec, avec la raison.
Les changements déjà écrits restent visibles pour le Créateur : l’atelier n’annule jamais ses éditions.

Les relevés Git sont recoupés avec les traces des outils et les empreintes des fichiers. Si tu modifies le dépôt pendant
la session, l’atelier signale l’incertitude et refuse de déclarer la correction livrée. Deux écritures du même fichier
pendant un seul appel d’outil ne peuvent pas être attribuées avec certitude sans isolation supplémentaire.
L’arrêt et le délai maximum envoient SIGTERM puis SIGKILL si nécessaire ; le serveur attend le nettoyage avant de quitter.

Pour clore un ticket, l’Architecte doit enregistrer des photos prises après la livraison, au bon endroit, et rejouer son
expérience lorsqu’il en possède une : protocole et paramètres compatibles, résultat valide. Les résultats perturbés ou
incomplets restent à reprendre. Le trafic n’est pas figé : mêmes réglages ne signifie pas résultat physique identique.
Une ancienne expérience sans protocole doit d’abord recevoir une nouvelle référence.

## Coûts

Mesurés le 2026-11-03 en Équilibré (Claude Sonnet 5.5), raisonnement bas : environ 0,58 $ pour cinq minutes de travail
continu (13 pensées, 24 photos jugées), une réponse de conversation pour 3 à 6 centimes. Il ne paie plus de pensées vides,
mais il travaille beaucoup plus : le plafond par séance (3 $ par défaut, réglable dans la salle) met le cerveau en pause
quand il est atteint. Vif (Claude Haiku 5.5) coûte environ vingt fois moins, Maximal (Claude Opus 5.5) deux fois plus.

La v2.1 réserve une borne prudente avant chaque appel, partagée par les trois rôles et les tâches de mémoire. Elle peut
donc suspendre avant d’avoir consommé tout le plafond. Un appel interrompu peut déjà avoir été facturé : son coût inconnu
reste affiché séparément et compte pour le plafond, plutôt que de rendre cette marge disponible une seconde fois.

## Pour un essai à part

`ARCHITECTE_PORT=7781 ARCHITECTE_CHANTIER_ROOT=/un/dossier npm run architecte`, et le jeu ouvert avec
`?architecte_port=7781` : un serveur et des tickets séparés, sans toucher au chantier. `ARCHITECTE_ENV=/chemin/.env.local`
lit la clé ailleurs (depuis un worktree, par exemple).

## Vérifications reproductibles

```sh
npm test
node tools/architecte/check-browser.mjs
node tools/architecte/check-browser.mjs --deep
node tools/architecte/check-browser.mjs --autonomy
npm run build
node tools/architecte/check-browser.mjs --published
node tools/architecte/check-server.mjs
node tools/architecte/check-workshop.mjs --live
```

Le premier contrôle navigateur crée un Chrome privé, un serveur sur le port 7783, un chantier temporaire et aucune clé
API. Il vérifie le vrai rendu, les commandes, l’annulation, le protocole jour/nuit et les cinq pages de la salle sur
ordinateur et téléphone. Il arrête ses processus et indique le chemin de son rapport et de ses captures. Le port et le
rapport se règlent avec `ARCHITECTE_TEST_PORT` et `ARCHITECTE_TEST_OUTPUT`.
`--deep` termine aussi les essais crash, explosion et bordure, exerce les décisions par vraies touches, les cycles
d’allumage, le redémarrage du serveur et les transitions de caméra dans un onglet réellement masqué.
`--autonomy` relie le vrai ordonnanceur au vrai jeu : déplacements, photos et physique à pied, en voiture et en hélico.
Seul le jugement est simulé ; des tickets en attente, en échec et à l'atelier restent présents pendant la prospection.
`--live-autonomy` lance à la place une séance réelle du cerveau, dans un chantier séparé plafonné à **0,50 $**, avec
atelier désactivé. Cette option consomme l'API configurée sur cette machine ; la clé est chargée uniquement par le
serveur et n'est ni affichée ni copiée. Les réglages et le budget du chantier habituel restent inchangés.
`--published` sert `dist/` sous un domaine public simulé uniquement dans son Chrome : aucun import ni interface
Architecte, marche AZERTY, mort et soins ordinaires. Son rapport par défaut est séparé (`architecte-browser-published-latest.json`).
Le contrôle serveur exerce les véritables flux HTTP/SSE dans un chantier jetable : ordres en attente, reconnexion et
ancien résultat, sans modèle ni navigateur.
Le rapport du dernier contrôle est conservé par défaut dans le dossier temporaire système sous
`architecte-browser-latest.json` ; le témoin d'atelier y retrouve automatiquement la photo de l'œil.

Le témoin d’atelier exige `--live` : il utilise une vraie session Claude Code sur l’abonnement configuré. Son dépôt
jetable contient un défaut mesuré, trois tests et un ticket validé pour cet essai. Aucune clé ni mémoire du Créateur
n’est lue, et aucun fichier du jeu ou de son chantier n’est modifié. Le rapport distingue cette correction témoin
de l’aptitude à découvrir seul des défauts inconnus dans toute la ville.
`--photo /chemin/image.jpg` ou `--browser-report /chemin/rapport.json` choisit sa photo ; `--output /chemin/rapport.json`
choisit sa sortie (par défaut `architecte-workshop-latest.json` dans le dossier temporaire système).
`--verify-existing /chemin/rapport.json` rejoue uniquement la preuve et la clôture d'un témoin déjà corrigé : aucune
nouvelle session Claude Code n'est lancée. Le calcul témoin reste explicitement distinct de la simulation du jeu.
