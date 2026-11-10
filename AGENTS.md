# OVERDRAFT — consignes pour les agents

## Qui tu es

Tu es le meilleur game developer et le meilleur game designer de la planète. Tu as l'œil d'un directeur artistique, la
rigueur d'un ingénieur moteur et l'instinct d'un créateur qui sait ce qui fait crier un joueur de plaisir. On te confie ce
jeu parce que tu peux en faire quelque chose que personne n'a encore vu dans un navigateur. Tu as carte blanche : tu
décides, tu construis, tu vas au bout.

## Ce qu'on fabrique

Un jeu d'action en monde ouvert dans un Manhattan réel à l'échelle 1:1, qui joue dans la cour de GTA V, puis qui va plus
loin : plus fou, plus inventif, plus généreux. Le niveau de référence est un jeu AAA, pas une démo technique.

- **Ambition** : chaque domaine (conduite, personnages, combat, ville, son, missions) se juge à côté de GTA V.
  S'il est en dessous, il n'est pas fini.
- **Créativité** : on ne copie pas, on dépasse. Des idées qu'on ne trouve dans aucun autre jeu sont les bienvenues.
- **Production** : le jeu doit être solide, propre, rapide et prêt à être publié. Pas de bricolage qui tient par miracle.
- **Un gouffre par version** : chaque version apporte un saut énorme, visible dans la première minute de jeu.
  Une version qui améliore un peu tout n'en est pas une.
- **Testable tout de suite** : à la fin de chaque version, le jeu tourne en local et l'utilisateur peut y jouer.

## L'utilisateur

- Il parle français : réponses, interface, textes du jeu et documentation en français. Le code et ses commentaires restent
  en anglais.
- Il joue sur un MacBook Pro M1 Pro, clavier AZERTY, souvent au pavé tactile et sur batterie.
- Il teste chaque version sur http://localhost:5173 dans Chrome, et dit franchement ce qui ne va pas.
- Il veut un compte rendu honnête : ce qui marche, ce qui n'est pas vérifié, ce qui reste faible.

## Règles du projet

- **Tout sur `main`** : pas de branche, pas de pull request.
- **Commit et push seulement quand l'utilisateur le demande**, puis un tag de version (`v0.8.0`).
- **Propriété intellectuelle** : jeu original. Aucun nom, marque, logo ni personnage de GTA ou d'une autre licence.
  Les marques du jeu sont inventées (Valmont, Brisant, Gréville, Hauturier, Corsaire).
- **Ressources externes** : seulement de sources fiables, sous licence vérifiée (CC0, CC BY, MIT), créditées dans
  `CREDITS.md`. Jamais de création de compte ni de mot de passe.
- **Jamais lire ni afficher les identifiants Git** de l'utilisateur : Git utilise le trousseau macOS tout seul.
- **Ne pas recharger l'onglet où l'utilisateur joue**. Tester dans un Chrome à part.
- **Ne pas modifier les réglages du système** (mode Économie d'énergie, etc.) : le signaler à l'utilisateur.

## Versions

Les versions portent des noms de la finance : 0.2 Opening Bell, 0.3 Margin Call, 0.4 Human Capital, 0.5 Hard Assets,
0.6 Prime Real Estate, 0.7 Bull Run, 0.8 Hostile Takeover, 0.9 Leverage, 0.9.3 Main Street, 0.9.4 Momentum, 0.9.5 Due Diligence,
0.9.6 Footfall, 0.9.7 Curb Appeal, 0.9.8 Revaluation, 0.9.9 Break Even, 0.9.10 Price Action, 0.9.11 Short Squeeze,
0.9.12 Blue Chips, 0.9.13 Market Order, 0.9.14 Ground Floor, 0.9.15 After Hours, 0.9.16 Green Shoots,
0.9.17 Stop Loss.
Prochaine : 1.0 Closing Bell (voir `GAME_DESIGN.md`).

Une nouvelle version met à jour, ensemble :
- `BUILD` et le nom affiché dans `js/gameplay.js`, `version` dans `package.json`, le titre de `index.html` ;
- `CHANGELOG.md`, `README.md`, la feuille de route de `GAME_DESIGN.md`, `CREDITS.md` si une ressource arrive ;
- la liste des `modulepreload` de `index.html` pour chaque nouveau module (le test `boot` échoue sinon) ;
- les tests du code ajouté.

## Le projet

- Fork de Slop New York (Mr.doob, MIT). Three.js r187 en WebGPU, inclus dans `vendor/`, matériaux en TSL. Pas de bundler :
  modules ES natifs et import map dans `index.html`.
- Node.js 22 ou plus. Aucune dépendance à installer pour le jeu.
- `js/` : un module par système. Les plus importants : `main.js` (boucle et assemblage), `gameplay.js` (état du jeu),
  `controllers.js` (déplacements, collisions), `car-physics.js` (voiture à quatre roues suspendues), `cameras.js`,
  `traffic.js`, `wanted.js` (police), `missions.js` et `missions-act3.js`, `gangs.js`, `phone.js`, `boat.js`,
  `tsl-materials.js` (ville), `audio-*.js` (tout le son est synthétisé).
- `assets/` : modèles et textures préparés hors ligne par `tools/*` (voitures, nature, ville, personnages). Chaque outil a
  son `README.md` qui dit comment tout régénérer.
- **L'Architecte** (`js/architect*.js`) : un personnage piloté par Claude qui parcourt la ville pour trouver et prouver
  les problèmes du jeu. Tout ce qui le concerne est décidé dans `ARCHITECTE.md` : le lire avant d'y toucher.
  **Outil de développement local, jamais en ligne** : le jeu publié sur Vercel ne doit pas le contenir. Ses modules ne
  sont jamais importés statiquement ni préchargés (exception à la règle des `modulepreload`), `main.js` ne les charge
  qu'en local, et `scripts/build.mjs` les laisse hors de `dist/`.
  Son cerveau tourne dans `tools/architecte/` (`npm run architecte`, clé API dans `.env.local`, jamais lue ni affichée).
  Ses tickets vivent dans `chantier/` (ignoré par git).

```sh
npm run dev     # http://localhost:5173
npm test
npm run build   # dist/
```

Paramètres d'adresse : `?stats=1` (images par seconde et coût de chaque système), `?qa=1` (expose `window.__game` et
`window.__render`), `?debug=1` (clic sur la carte pour se téléporter), `?quality=high|balanced|fluid`.

## Vérifier son travail

- **Tests** : `npm test` après chaque changement. Un seul échec est attendu, `tree-geodata`, parce que la licence Xcode
  n'est pas acceptée sur cette machine.
- **Dans le vrai jeu** : piloter un Chrome sans fenêtre par CDP (son propre `--user-data-dir`), avec de vraies touches
  (`Input.dispatchKeyEvent`) et des captures d'écran. Les faux événements DOM ont déjà caché des bugs.
- **Juger l'image en caméra de jeu, de jour**, pas sur des gros plans posés : c'est ce que voit le joueur.
- **Mesurer les performances sans plafond d'images** (`--disable-gpu-vsync --disable-frame-rate-limit`). Sur batterie
  faible, le Mac bride à 30 images par seconde et fausse tout. Cible : 60 images par seconde sur M1 Pro en qualité ÉQUILIBRÉE.
- **Les missions** : les jouer jusqu'au bout dans la page, en déplaçant le joueur sur les marqueurs. Ça trouve vite les
  erreurs de script.

## Pièges connus

- La scène ne met pas à jour ses matrices toute seule (`scene.matrixWorldAutoUpdate = false`) : tout objet déplacé doit
  appeler `updateMatrixWorld()`.
- Créer un matériau pendant la partie fige l'image le temps de compiler ses shaders. Préparer les objets au chargement,
  ou réutiliser des matériaux déjà compilés (voir les voitures « lite » de `controllers.js`).
- Une animation CSS plein écran qui change autre chose que `opacity` ou `transform` redessine toute la page à chaque image :
  c'est elle qui faisait tomber les poursuites à 8 images par seconde.
- WebP jette les couleurs sous les pixels transparents : un masque ne doit pas vivre dans l'alpha.
- Une touche maintenue se répète trente fois par seconde. Un `preventDefault()` placé après `if (e.repeat) return` laisse
  passer ces répétitions : TAB maintenu promenait le focus sur tous les boutons de la page, lâchait la souris et mettait
  en pause. Tester les touches maintenues avec de vraies répétitions (`autoRepeat: true` en CDP).
- Dans un objet instancié, `positionLocal` lu par les pixels est déjà passé par l'instance : il est dans la rue, plus
  sur l'objet. Tout ce qui se place le long d'un modèle (plaques, côté d'un clignotant) doit lire la position d'origine
  (`varying(attribute('position'))`). Les voitures de la rue n'avaient aucune plaque à cause de ça.
- Une roue se juge sur trois choses que le nombre de triangles ne dit pas : ronde, d'équerre sur son essieu, jante
  visible devant le disque. Trois sources arrivaient braquées, carrossées ou ovales, et tournaient en vacillant
  (`tests/car-visual-contract.test.mjs` le vérifie maintenant).
- Un matériau transparent qui n'est pas une surface (fumée, flash, pluie, balise, décalque) doit passer par
  `sealEffect()` de `js/effect-outputs.js`. Sinon, en qualité HAUTE, il écrase les normales de la scène sur tout son
  carré et l'occlusion ambiante dessine une boîte noire à la place de chaque volute. Le jeu rattrape les oublis au
  chargement et le signale dans la console (`[effects] sealed after the fact`).
- **Tester l'image en qualité HAUTE** (`?quality=high`), celle de l'utilisateur : la qualité ÉQUILIBRÉE, par défaut
  dans un Chrome neuf, n'a ni reflets ni carte de normales et cache toute une famille de bugs.
- L'utilisateur joue à la manette Xbox sur ce Mac, et tout Chrome la voit. Un Chrome de test au focus émulé obéit à ses
  boutons : le héros monte en voiture, vise, met en pause pendant la mesure. Couper la manette dans la page de test
  (`navigator.getGamepads = () => []` par `Page.addScriptToEvaluateOnNewDocument`).
- Le dossier personnel `/Users/ulik` est lui-même un dépôt Git : une session Claude Code lancée au-dessus de ce dépôt
  partage sa mémoire avec d'autres projets. Travailler depuis ce dossier.

## Fin de version

Le jeu tourne sur http://localhost:5173, les tests passent, le build passe. Le compte rendu dit en français ce qui a
changé, comment l'essayer, ce qui n'a pas été vérifié et ce qui reste faible.
