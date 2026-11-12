# Les matières et les objets du Wasteland

Tout ce qui se trouve dans `assets/wasteland` sort d'ici : les matières photographiées du désert (sable, roche, rouille,
béton) et le kit d'objets (rochers numérisés, bois mort, restes d'un campement). Rien de ce dossier n'est chargé par le
jeu, qui lit `assets/wasteland` par `js/wasteland-surfaces.js` et `js/wasteland-kit.js`.

Sources : [Poly Haven](https://polyhaven.com), en CC0, et rien d'autre. Les outils téléchargent eux-mêmes ce qu'il leur
faut (textures en 2k, modèles glTF en 1k, environ 230 Mo) et le gardent dans un dossier de travail **hors du dépôt**.
La liste des auteurs est dans `CREDITS.md`.

```bash
cd tools/world && npm install          # sharp et meshoptimizer (une fois ; les outils les trouvent aussi dans le
cd ../..                               # dépôt principal quand on travaille dans un worktree)
node tools/wasteland/build-surfaces.mjs <dossier de travail>             # les matières
node tools/wasteland/build-kit.mjs <dossier de travail>                  # le kit d'objets
node tools/wasteland/build-kit.mjs <dossier de travail> --no-fetch       # sans réseau, à partir du dossier de travail
node --test tests/wasteland-assets.test.mjs
```

Les deux outils acceptent `--out <dossier>` pour écrire ailleurs que dans `assets/wasteland`, et `--no-fetch`.
`build-kit.mjs --only tyre,fence --out <dossier>` ne refait que quelques objets, pour essayer un réglage.
`shared.mjs` porte ce que les deux outils ont en commun (dépendances, téléchargements) ; le lecteur de glTF est celui de
`tools/calibre/gltf.mjs`.

## Les matières (`build-surfaces.mjs`)

Même format que le sol de la ville (`tools/ground`), 1024 px :

- `<nom>_c.webp` : couleur, et hauteur dans l'alpha (jamais 0) ;
- `<nom>_n.webp` : normale OpenGL (le vert monte dans l'image, comme dans `assets/ground`), et rugosité dans l'alpha ;
- `macro_c.webp` : une vue aérienne de 20 m, pour les changements de ton qu'aucune tuile ne peut porter ;
- `surfaces.json` : pour chaque matière, la source, ce qu'une répétition couvre en mètres (`metres`), la couleur
  moyenne en linéaire (`mean`), la rugosité moyenne, les auteurs et les noms de fichiers.

| Nom | Source | Mètres | Ce que c'est |
| --- | --- | --- | --- |
| `dune` | aerial_beach_01 | 10 (photo : 30) | sable fin et pâle, ridé par le vent |
| `sand` | dry_ground_rocks | 4 | sol ocre à gros grain, quelques cailloux clairs |
| `crack` | mud_cracked_dry_03 | 3 (photo : 1,5) | boue séchée, claire et chaude, craquelée en plaques |
| `salt` | dry_ground_01 | 4 | croûte gris pâle à fins polygones : ce que Poly Haven a de plus proche d'un lac salé |
| `gravel` | floor_pebbles_01 | 3 | nappe de petits galets dans le sable |
| `slab` | sandstone_cracks | 2 | dalle de grès orange, lisse, aux joints peu profonds |
| `cliff` | cliff_side | 4 (photo : 1,8) | grès rouge et ocre en strates horizontales |
| `crag` | marble_cliff_03 | 5,7 | paroi fracturée en blocs d'un mètre et plus : la grande échelle d'une falaise |
| `rust` | rusty_metal_04 | 2 | tôle d'acier plane, peinture grise écaillée sur rouille brune |
| `sheet` | rusty_corrugated_iron | 2 | tôle ondulée rouillée, ondes verticales |
| `bunker` | concrete | 4 | béton coulé, joints de coffrage verticaux, piqué et taché |
| `macro` | dirt_aerial_02 | 20 | terre sèche balayée de traînées de sable, vue du ciel |

Trois choses diffèrent de `tools/ground`, et sont réglées dans la table `SURFACES` :

- **`metres`** : trois photos sont dessinées plus grandes que nature (`photographed` garde la vraie taille). Une plage
  photographiée par drone sur 30 m donne des rides de dune une fois ramenée à 10 m ; les strates de `cliff` et les
  plaques de `crack` se lisent mieux, et se répètent moins, agrandies.
- **la hauteur** est le relief propre de la matière (fissures, rides, cailloux) : les grandes ondulations des photos,
  qui prenaient presque toute la plage de valeurs et dessinaient une tache par répétition, sont retirées aux trois
  quarts (`swell`).
- **l'alpha** : WebP ne garde que quelques niveaux d'un canal alpha et les stocke sans perte. Hauteur et rugosité sont
  donc lissées d'environ un texel avant d'être écrites : 16 niveaux de hauteur et 12 de rugosité, pour le poids que le
  sol de la ville met dans 9.

La rugosité de `dune` (une plage est humide) et de `bunker` (un sol ciré) est ramenée à celle d'un sable sec et d'un
mur exposé (`rough`).

## Le kit (`build-kit.mjs`)

| Fichier | Contenu |
| --- | --- |
| `kit.bin` | Tous les objets, chacun en deux niveaux (`full`, `low`) : un en-tête JSON, puis positions (16 bits, dans la boîte de l'objet), normales (8 bits), UV (16 bits, dans l'atlas) et indices (16 bits) |
| `kit_c.webp` | Atlas commun, 4096 × 2048 : couleur (sRGB) ; l'alpha vaut 1 partout sauf dans les trous des objets découpés |
| `kit_n.webp` | Atlas des normales, vert retourné (voir `tools/calibre/README.md`) : `normalMap`, `normalScale` (1, 1) |
| `kit_orm.webp` | Occlusion, rugosité, métal dans le rouge, le vert et le bleu, à la moitié de la taille de l'atlas |
| `kit.json` | Pour chaque objet : modèle Poly Haven, auteurs, taille réelle, triangles par niveau, position de la base, collision conseillée, façon de le dessiner |

Chaque objet est aplati en un seul maillage, en mètres, Y en haut, l'origine au centre de son emprise au sol (le poteau
électrique : sur son mât).

- **`grounded`** : la base est le plan y = 0. Sinon `buried` mètres pendent sous y = 0 : un rocher numérisé garde à
  y = 0 le sol sur lequel il a été photographié, et sa jupe s'enfonce dans le sable.
- **`collider`** : `{ radius, height, centre }` pour ce qui est rond (un cylindre vertical), `{ half, centre }` pour ce
  qui est en boîte, `null` pour ce qu'on traverse (buissons, branche). Le rayon d'un rocher est un peu rentré.
- **`cutout`** : l'objet a des trous découpés par l'alpha de la couleur (grillage, feuilles) : le dessiner avec
  `alphaTest`. **`twoSided`** : il a des tôles ouvertes dont on voit l'envers : le dessiner en `DoubleSide`.
- **`shell`** : `outcrop_a` et `outcrop_b` sont des faces de falaise numérisées, ouvertes derrière. Elles regardent
  vers +Z et s'adossent à un talus ; seules au milieu d'une plaine, on voit dedans.
- **`kind`** : `rock`, `wood`, `plant`, `clutter` ou `big`.

Les objets : six rochers aux silhouettes différentes (`boulder_a` à `boulder_f`), une dalle (`slab`), deux faces de
falaise, un semis de cailloux (`rubble`) ; un tronc couché, une bille, un tronc debout, une branche, deux buissons ;
barils (rouge, bleu, brasero), pneu et pile de pneus, jerrican, bouteille de gaz, deux blocs de béton, sac de ciment,
caisse, caisse militaire, panneau de grillage, échelle, voiture sous bâche, bouée de mer, poteau électrique, groupe
électrogène, chariot de soudure, sac et poubelle, sommier, foyer de pierres, chaise, table de pique-nique.

Poly Haven n'a ni conteneur, ni palette, ni sacs de sable, ni cône, ni tente ou bâche seule, ni parabole, ni épave de
voiture ou de bateau : ces objets restent à construire dans le jeu.

### Ajouter ou régler un objet

Tout se passe dans la table `PROPS` : une ligne par objet. Les clés sont décrites en tête de l'outil ; les plus utiles :

| Clé | Rôle |
| --- | --- |
| `name`, `id`, `kind` | Nom dans le jeu, identifiant Poly Haven, famille |
| `tris`, `low` | Budget de triangles des deux niveaux (`low` : un quart par défaut) |
| `tile` | Côté de sa case dans l'atlas, en pixels d'un atlas de 2048 × 2048 (l'outil la met à l'échelle de l'atlas choisi). Deux objets tirés du même modèle avec la même case la partagent (le pneu et la pile) |
| `scan` | Numérisation : le sol photographié reste à y = 0, les normales sont refaites lisses, les coutures de texture ne sont jamais traversées. `sink` l'enfonce, `shell` dit que c'est une face ouverte, `matte` empêche une pierre polie de briller |
| `round`, `radius`, `collide`, `axis` | Collision en cylindre ; rayon imposé ; pas de collision ; origine sur un nœud plutôt qu'au centre de l'emprise |
| `only`, `drop` | Garder ou retirer des nœuds ou des matériaux |
| `scale`, `orient`, `move`, `turn`, `place`, `copies` | Mettre à l'échelle (trois rochers sont des pierres grosses comme la main, agrandies), tourner, déplacer des nœuds, regrouper les pièces d'un lot, empiler |
| `alpha` | Garder un matériau transparent comme découpe : la carte nommée (un fichier Poly Haven du modèle : `Alpha`, `wire_alpha`) va dans l'alpha de la couleur |
| `cap`, `fine`, `detail`, `weights` | Réglages de la simplification |

### La simplification

C'est celle de `tools/calibre` (réduire dans une erreur qui ne se voit pas, retirer les petites pièces, puis laisser
l'erreur grandir sans traverser les coutures de texture), avec une différence : l'erreur a un plafond (`cap`, par
niveau). Au-delà, un baril se froisse et un pneu devient hexagonal. Un niveau qui ne tient pas son budget sous ce
plafond garde donc plus de triangles qu'on ne lui en demandait, et la sortie de l'outil le dit (`asked for…`). Un objet
fabriqué peut alors traverser ses coutures, dans le même plafond ; une numérisation, jamais : sa texture est tout ce
qu'elle a. C'est pourquoi `boulder_01`, le rocher le plus tourmenté de Poly Haven, n'est pas dans le kit : sa texture
est découpée en 270 îlots et il ne se réduit pas sans bavures.

L'atlas est en 4096 × 2048 parce que les rochers, vus de près à plusieurs mètres de haut, sont flous en 2048 × 2048.
`--atlas 2048x2048` refait le kit dans un atlas carré (les cases rétrécissent d'elles-mêmes).

## Regarder le résultat

`tools/wasteland/kit-preview.html` (servi par `npm run dev`) charge tout par les modules du jeu :

- sans paramètre, la cour : tous les objets sur une grille d'un mètre, le niveau `full` devant, le niveau `low`
  derrière ; le poteau gris fait 1,80 m ;
- `?surfaces=1` : chaque matière sur 20 m de sol avec un mur de 5 m derrière, à son échelle (`&tone=1` divise chaque
  photo par sa moyenne) ;
- `?sheet=1&cols=6` : une case par objet et par niveau, cadrée (`&only=a,b`, `&page=1&per=12`, `&level=low`,
  `&az=35&el=18`). Le carré est le sol ; `&collider=1` dessine la collision conseillée ;
- `?flat=1` sans normales, `?white=1` sans couleur, `?side=front` ou `?side=double` pour forcer les faces.

`tools/wasteland/shots.mjs` prend ces vues en photo avec un Chrome sans fenêtre à lui (son profil, son port, arrêté à
la fin), pour juger sans ouvrir de navigateur :

```bash
node tools/wasteland/shots.mjs <dossier> rochers="sheet=1&only=boulder_a,boulder_b&cols=4" sol="surfaces=1&el=35" --port 5173
```

À vérifier après chaque changement, sous plusieurs angles et aux deux niveaux : les silhouettes, les textures étalées,
les objets enfoncés ou flottants, les envers visibles.

## Le relief (`build-terrain.mjs`)

```bash
node tools/wasteland/build-terrain.mjs                      # écrit js/wasteland-terrain.bin.gz (1,6 Mo), en 8 s
node tools/wasteland/build-terrain.mjs --preview <dossier>  # et trois cartes ombrées, pour juger sans lancer le jeu
```

Aucune ressource externe : l’outil part des rives réelles de `js/city-config.js` et du dessin de
`js/wasteland-design.js` (digues, brèches, routes, lieux, portes). Il trace les rives sur une trame de 16 m, mesure
les distances aux berges, remplit les douves depuis l’East River jusqu’aux digues (et s’arrête si une digue fuit),
pose le relief de chaque rive (lit de l’Hudson, rade, falaises des Palisades relevées, mesas, dunes), creuse les
ravines par érosion, nivelle les routes et les pistes, puis écrit hauteurs (32 m, 16 bits), zones, calme, masques de
matière (64 m) et profils des routes. À relancer après tout changement du dessin ; `tests/wasteland.test.mjs` vérifie
le résultat (lit à sec, douves fermées, routes praticables, débarquements des ponts au niveau du sol).
