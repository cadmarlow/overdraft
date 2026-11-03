# Le serveur de l’Architecte

Le cerveau de l’Architecte (Claude), ses tickets, son atelier et la salle de contrôle. Outil de développement local :
il ne part jamais en ligne (voir `ARCHITECTE.md`, « Jamais en ligne »).

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
4. Dans le jeu : menu pause (Échap) → **ARCHITECTE**. Il arrive, et son cerveau se met en marche.

## Dans le jeu

- **J** (ou le losange violet à côté des armes, du garage et du téléphone) : sa barre d’actions. Faire venir ou
  renvoyer, lui laisser la caméra ou la reprendre, lui parler, « suis-moi », « stop », la salle de contrôle. Touches
  1 à 6, flèches, souris ou pavé tactile, comme les autres barres.
- **L** : il prend la caméra (mode Seul, autonomie totale, plus de limite de 350 m) et va où il veut ; **L** de nouveau
  pour reprendre la main.
- **K** : lui parler (une ligne de texte, Entrée pour envoyer).
- Menu pause : **ARCHITECTE** (le faire venir ou le renvoyer) et **SALLE DE CONTRÔLE ↗**.
- Le menu pause indique **CERVEAU HORS LIGNE** quand le serveur ne tourne pas.

## La salle de contrôle

`http://localhost:7780`, ou sur l’iPhone (même Wi-Fi) l’adresse avec `?jeton=…` que le serveur affiche au démarrage.

- **En direct** : ce que montre la caméra du jeu, une image toutes les secondes et demie.
- **Fil de pensée** : ses pensées (un résumé), ses actions, ses paroles, ses photos, les événements du jeu, tes messages.
- **Carte** : lui (losange violet), toi (point vert), ses tickets.
- **Tickets** : à valider (V), rejeter (R) avec une raison, ou demander plus (D). Les tickets validés partent à
  l’atelier ; tes rejets entrent dans son carnet.
- **Réglages** : cerveau (Vif, Équilibré, Maximal), plafond de dépense par séance, pause, voix, vue en direct, atelier.

**Quand tu quittes l’onglet du jeu** alors que l’Architecte est là, il prend la main au bout d’une seconde et demie et la
partie continue en arrière-plan (un minuteur dans un Worker fait tourner le jeu à 30 images par seconde, puisque le
navigateur n’anime plus un onglet caché). Exceptions : poursuite policière ou mission en cours, le jeu se met en pause
comme avant. À ton retour il garde la caméra : **L** (ou J puis 2) pour la reprendre. Sans lui, le jeu se met en pause
comme toujours. Si la fenêtre du jeu est réduite dans le Dock, macOS peut quand même ralentir Chrome : laisse-la ouverte
derrière les autres plutôt.

## Ce qu’il laisse sur le disque

Tout est dans `chantier/` à la racine (ignoré par git) :

| Chemin | Contenu |
|---|---|
| `chantier/tickets/0001-…/` | `ticket.md` (lisible), `ticket.json`, les photos |
| `chantier/photos/` | toutes ses photos, avec leur lieu |
| `chantier/journal/AAAA-MM-JJ.jsonl` | le journal du jour, une ligne par pensée, action ou événement |
| `chantier/carnet.md` | sa mémoire : ce qu’il a appris, tes goûts |
| `chantier/etat.json` | les réglages, les compteurs, la dépense par jour, le jeton |

## L’atelier

Un ticket validé est confié à une session Claude Code sans fenêtre (`claude -p`, ton abonnement), un à la fois, réglée
comme tes propres sessions : **Claude Opus 5.5, effort xhigh, mode de permissions auto**, lancée dans le dossier du jeu
(elle lit donc `CLAUDE.md` → `AGENTS.md`), avec en plus les leçons de ta mémoire Claude Code sur le projet. Elle lit le
ticket et ses photos, corrige le code, lance `npm test` et répond dans le ticket. Elle ne commite jamais (commit, push,
branche, reset… lui sont interdits) et ne touche pas aux fichiers de l’Architecte.

**Suivre l’atelier** : dans la salle, ouvre le ticket (ou clique le bandeau « Atelier » en bas à droite). La section
**Atelier** montre ses étapes en direct (photos regardées, fichiers lus et modifiés, commandes lancées, ce qu’il dit),
la commande de sa session (bouton **Copier**) et **Ouvrir dans le Terminal**, qui rouvre sa conversation
(`claude --resume <identifiant>`) une fois qu’il a fini. Le ticket passe « corrigé, à vérifier » : l’Architecte retourne sur place (en mode
Seul, il recharge d’abord le jeu) et le clôt ou le rouvre, photos d’après à l’appui.

## Coûts

Chaque pensée est une requête courte : un rapport, souvent une photo, quelques outils. Ordres de grandeur mesurés
le 2026-11-03 : environ 1,4 centime par pensée avec Équilibré (Claude Sonnet 5.5), une pensée toutes les 15 à 30
secondes. Un ticket est relu par le cerveau du dessus (Vif → Équilibré, Équilibré → Maximal). Le plafond par séance met
le cerveau en pause quand il est atteint.

## Pour un essai à part

`ARCHITECTE_PORT=7781 ARCHITECTE_CHANTIER_ROOT=/un/dossier npm run architecte`, et le jeu ouvert avec
`?architecte_port=7781` : un serveur et des tickets séparés, sans toucher au chantier.
