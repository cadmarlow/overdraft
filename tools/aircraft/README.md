# Importer les avions

Tout ce qui se trouve dans `assets/aircraft` sort d'ici. Rien de ce dossier n'est chargé par le jeu : il lit les
fichiers produits avec `js/aircraft-assets.js`.

Les sources, leurs auteurs et leurs licences sont dans `assets/aircraft/LICENSE-aircraft.md`. Les fichiers d'origine
(GLB) ne sont pas dans le dépôt : les retélécharger depuis les pages indiquées, dans un dossier dont les sous-dossiers
portent les noms attendus par `aircraft.json` (clé `source`).

```bash
cd tools/people && npm install      # sharp, partagé avec l'import des personnages
cd ../aircraft
node import.mjs <dossier des téléchargements>            # les deux avions
node import.mjs <dossier des téléchargements> jet        # un seul
node import.mjs <dossier des téléchargements> jet --dump # avec la liste de tous les îlots et de la pièce qui les prend
```

Dans un worktree git, `sharp` est emprunté au checkout principal (`tools/people` n'y est pas installé).

| Fichier | Rôle |
| --- | --- |
| `import.mjs` | Le pipeline : repère, découpe en pièces, os, points mesurés, cartes, écriture du `.bin` |
| `aircraft.json` | Tout ce qui est propre à un avion (voir plus bas) |
| `glb.mjs` | Lecteur GLB (deux jeux d'UV, matériaux par nom) |
| `paint.mjs` | Effacement des marquages : tampon de clonage, retouche, sélection par couleur |
| `fabric.mjs` | Carte de normales du biplan : l'entoilage entre les nervures et les lisses |
| `propeller.mjs` | Pales du biplan (bois lamellé, blindage laiton, bouts peints) et leur texture |
| `shots.mjs` | Captures de `tools/aircraft-preview.html` par un Chrome sans fenêtre |

## Ce que le jeu reçoit

**Repère** : mètres, +X à gauche du pilote, +Y vers le haut, +Z vers le nez, sans miroir. **Origine** : le centre de
gravité qu'utilise `js/flight.js`, dit depuis le train principal (`stance`) : pour le biplan, 0,95 m derrière l'essieu
et 1,52 m au-dessus du bas des pneus, fuselage de niveau ; pour le jet, 0,85 m devant l'essieu et 1,95 m au-dessus.

**Un `.bin` par avion** : un en-tête JSON, puis les sommets et les indices.

| Section | Contenu |
| --- | --- |
| `uint32` | longueur de l'en-tête, puis l'en-tête JSON (complété à 4 octets) |
| `position` | `uint16` × 3 par sommet, sur la boîte `bounds` de l'en-tête |
| `normal` | `int8` × 3 par sommet (÷ 127) |
| `uv` | `uint16` × 2 par sommet, sur `uvRange` |
| `uv1` | idem sur `uv1Range`, seulement si l'avion le demande (`"uv1": true` : le biplan y porte son occlusion) |
| `index` | une suite par matériau (`materials[i].index` : `offset`, `count`, `size` 2 ou 4), relative aux sommets de ce matériau (`materials[i].vertices` : premier, nombre) |

L'en-tête :

- `materials` : `id` (`paint`, `pilot`, `glass`, `blade`, `skin`, `mech`), `maps` (`c` couleur, `n` normales, `orm`
  occlusion / rugosité / métal, `ao` occlusion seule ; chacune `{ file, uv }`), et ses sommets et indices ;
- `parts` : `name`, `material`, `start` et `count` dans les indices de son matériau, `bone` si la pièce bouge ;
- `bones` : par nom, `pivot` et `axis` (unitaire) dans le repère de l'avion, `parent` éventuel, et selon l'os `angle`
  (débattement, degrés), `open` / `closed` (portes, aérofreins), `swing` (repli d'une jambe), `twist` et `twistAxis`
  (roue qui se couche), `radius` et `contact` (roue), `shrink` (jambe avant qui se tasse), `group` (pétales de tuyère) ;
- `points` : les points mesurés (bas des pneus et rayons, nez, queue, bouts d'ailes, ventre, dérive, moyeu et rayon
  d'hélice, tuyère, œil et bassin du pilote, feux) ;
- `propeller` : les nombres des pales et leur corde et leur pas le long du rayon (le disque du jeu en est tiré).

Le jeu dessine tout ce qui porte le même matériau en une fois : les pièces mobiles sont attachées à leur os par
skinning (un os par sommet), ce qui fait cinq appels de dessin pour le biplan et trois pour le jet.

**Sens des os** : un angle positif est un manche positif. Profondeur : bords de fuite vers le haut ; ailerons : gauche
vers le haut, droite vers le bas ; direction : bord de fuite à gauche ; roues : en avant ; hélice : sens horaire vue du
poste ; portes : `closed` les ferme, `open` les ouvre ; pétales : positif referme la tuyère.

## `aircraft.json`

Une entrée par avion.

| Clé | Rôle |
| --- | --- |
| `source`, `keep` | Fichier `.glb`, et les nœuds à garder (expression régulière) quand la scène en contient d'autres |
| `nose`, `up` | Axes du nez et du dessus dans la source (`-z`, `+y`...) |
| `fit` | Dimension réelle qui fixe l'échelle : `{ "axis": "x", "size": 9.8 }` (envergure) ou `z` (longueur) |
| `origin`, `stance` | Origine approchée (dans la source mise à l'échelle), puis où doivent tomber l'essieu principal (`axle`, en z) et le bas de ses pneus (`tyre`, en y) : l'import ajuste au millimètre et prévient si `origin` s'éloigne de plus de 2 cm |
| `parts` | Les règles, servies dans l'ordre, qui disent quel îlot (ce qui reste d'un seul tenant dans un nœud) fait quelle pièce. Voir plus bas |
| `bones` | Où tourne chaque pièce mobile. Voir plus bas |
| `points` | Les points mesurés : un triplet, `{ "wheel": os }` (bas du pneu et rayon), ou une sonde `{ "of": pièce ou étiquette ou "*", "at": "max-z" / "min-y" / "centre", "box", "x" / "y" / "z" imposés, "dx" / "dy" / "dz" }` |
| `mirrorPoints` | Points donnés à gauche dont le jumeau de droite est écrit tout seul |
| `propeller` | Pales fabriquées par l'import (rayon, corde, pas, os, matériau) |
| `materials` | Par matériau du jeu : `source` (matériau du GLB), `maps`, `erase`, `set` (valeurs passées au jeu) |

**Règles de `parts`** : `nodes` (expression régulière sur le nom du nœud), `tris` (nombre de triangles de l'îlot,
`[min, max]`), `inside` (l'îlot tient entier dans la boîte `[x0, y0, z0, x1, y1, z1]`), `centre` (son milieu y est),
puis ce qu'on en fait : `part` et `material`, `bone`, `tag` (étiquette pour les sondes), `uv` / `uv1` (une seule
couleur de la texture pour toute la pièce), `drop` (jeté), `sides` (la règle est donnée pour le côté gauche : son
jumeau de droite est écrit tout seul, boîtes retournées, `L` → `R`), `ring` (couronne de pétales : un os par pétale,
compté autour d'un axe). Les boîtes sont dans le repère final.

**Os** : `{ "pivot", "axis" }` donnés (un `null` dans `pivot` prend le milieu de la pièce), ou `"edge": "+z"` (gouverne :
charnière au milieu de sa face avant, relevée station par station le long de l'envergure, orientée comme `axis`), ou
`"wheel": true` (essieu : l'axe mince du pneu ; `round` arrondit une roue ovale), ou `"to"` (jambe qui se replie : le
plus court chemin qui porte `carry` de sa place à `to`). `flat` couche la roue dans sa soute. `sides` comme pour les
règles.

**Cartes** : `{ "from": "base" | "normal" | ... }`, ou trois canaux pris à plusieurs cartes
(`["occlusion.r", "metalRough.g", "metalRough.b"]`), `levels` (occlusion trop sombre), `uv` (jeu d'UV lu), `same`
(fichier déjà écrit par un autre matériau), `make` (`"blade"` : texture des pales ; `"fabric"` : normales d'entoilage,
avec ses `panels`).

## Effacer un marquage

Marques inventées, pas d'insignes réels : chaque entrée de `erase` nomme un morceau de la texture (pixels d'une carte
de 1024 px, y vers le bas) et ce qu'on y pose. Les entrées s'appliquent dans l'ordre : une retouche peut copier ce
qu'une autre vient de nettoyer. Elles valent pour la couleur et pour la carte `orm` (`"maps"` pour en décider
autrement) ; le choix des pixels est toujours lu sur la couleur.

| Clé | Rôle |
| --- | --- |
| `rect` ou `poly` | Le morceau : rectangle `[x0, y0, x1, y1]` ou polygone |
| `feather`, `sharp` | Bord adouci (pixels) ; côtés d'un rectangle qui tombent sur le bord d'un îlot et ne le sont pas (`"lrtb"`) |
| `dark`, `bright`, `match`, `keep` (+ `tol`, `grow`) | Ce qui part : les pixels plus sombres ou plus clairs qu'un seuil, ceux d'une couleur donnée, ou tout sauf la peinture. Sans rien : tout le morceau |
| `from` | Tampon de clonage : la surface propre trouvée à `[dx, dy]` (rivets, lignes de tôle et salissures viennent avec) |
| `heal`, `grain` | Retouche : ce qui entoure les pixels choisis les remplit ; `grain` remet un peu de moucheture |
| `fill` | Aplat : une couleur, ou une valeur par carte (`{ "c": [...], "orm": [...] }`) |

Les bandes obliques se clonent le long de leur pente ; un marquage coupé par le bord d'un îlot s'efface morceau par
morceau (l'étoile du fuselage est en quatre morceaux dans la texture du jet). Vérifier ensuite sur le modèle, de tous
les côtés et par-dessous : des îlots en miroir font qu'une retouche en corrige deux, ou en oublie une.

## Régler et vérifier

```bash
node scripts/dev.mjs --port 5183 &
node tools/aircraft/shots.mjs <dossier de captures> chasse="kind=jet&cam=8:14:20&air=1&gear=0" \
  ventre="kind=jet&cam=20:-70:5&target=0,-1,-0.5&air=1&gear=0.3" os="kind=classic&cam=40:20:13&bones=1"
```

`tools/aircraft-preview.html` dessine un avion avec le module du jeu, sous un jour proche du sien :

- `kind=classic|jet`, `cam=<azimut>:<élévation>:<distance>` (0 = de derrière, 90 = de la gauche du pilote, 180 = de
  face), `target=x,y,z`, `fov` ;
- `gear`, `pitch`, `roll`, `yaw`, `power`, `ab`, `flaps`, `brake`, `spin`, `steer`, `ridden=0`, `crashed=1`,
  `engine=1`, `air=1` (en vol, sans sol), `frames` (pas de 1/60 s avant l'image) ;
- `marks=1` : les points mesurés (jaune) et le pivot et l'axe de chaque os (rouge) ; `bones=1` : chaque pièce à la
  couleur de son os ; `flipn=1` : l'autre convention de normales, pour comparer ; `demo=1` : tout bouge, sans fin.
- `mrt=1` : dessiné comme le jeu en qualité HAUTE, par une passe qui écrit aussi les normales et le métal / rugosité
  (le disque de l'hélice ne doit pas y paraître, les verres si) ; `show=normal|metalRough` montre l'une de ces sorties.

`tests/aircraft-assets.test.mjs` lit les fichiers livrés avec le lecteur du jeu, construit les deux modèles et vérifie
tailles, repère, origine, symétrie, roues rondes, sens des gouvernes, train, tuyère, cartes et licence.

## Ce que le jeu ajoute lui-même

- Le disque de l'hélice : `js/aircraft-assets.js` le dessine à partir de la corde et du pas des pales (la traînée de
  chaque pale sur l'arc qu'elle parcourt pendant une pose) ; les pales pleines ne se voient qu'à l'arrêt et au
  démarrage.
- Les matières : émail sous vernis pour le biplan (le jaune de la source, clair comme du papier, y est foncé), tôle nue
  pour le jet, verres teintés.
