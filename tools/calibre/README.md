# Le kit des boutiques CALIBRE

Tout ce qui se trouve dans `assets/calibre` sort d'ici : les objets des armureries (caisses de munitions, caisse
enregistreuse, étagères, établi, lampes…) et les matières de leurs murs. Rien de ce dossier n'est chargé par le jeu, qui
lit `assets/calibre` par `js/calibre-kit.js`.

Sources : [Poly Haven](https://polyhaven.com), en CC0. L'outil télécharge lui-même ce qu'il lui faut (modèles glTF en 1k,
textures en 2k, environ 210 Mo) et le garde dans le dossier de travail. La liste des auteurs est dans `CREDITS.md`.
`gltf.mjs` est le lecteur de glTF de l'outil.

```bash
cd tools/calibre && npm install        # sharp et meshoptimizer (inutile si tools/world est déjà installé)
cd ../..
node tools/calibre/build-kit.mjs <dossier de travail>               # tout régénérer dans assets/calibre
node tools/calibre/build-kit.mjs <dossier de travail> --no-fetch    # sans réseau, à partir du dossier de travail
node --test tests/calibre-kit.test.mjs
```

Le dossier de travail reste hors du dépôt. Pour essayer un réglage sans toucher au jeu :

```bash
node tools/calibre/build-kit.mjs <travail> --out <autre dossier> --only wrench,wall_clock   # quelques objets
node tools/calibre/build-kit.mjs <travail> --out <autre dossier> --full                     # aucun triangle retiré
```

## Voir une succursale seule

`tools/calibre/room-preview.html` construit une succursale avec les modules du jeu (`js/calibre-room.js`) et la
montre en quelques secondes, sans charger la ville : `http://localhost:5173/tools/calibre/room-preview.html`
(`?cam=x,y,z&look=x,y,z` dans le repère de la succursale, `?sun=1`, `?night=1`). Les formes, les matières et le
placement sont ceux du jeu ; la lumière ne l'est pas (le jeu a ses lampes groupées, son œil et son halo) : l'éclairage
se juge dans le jeu, en qualité HAUTE.

## Ce qui est écrit

| Fichier | Contenu |
| --- | --- |
| `kit.bin` | Tous les objets : un en-tête JSON, puis positions (16 bits, dans la boîte de chaque objet), normales (8 bits), UV (16 bits, dans l'atlas) et indices (16 bits, comptés depuis le premier sommet de l'objet) |
| `kit_c.webp` | Atlas commun, couleur (sRGB), 2048 × 2048 |
| `kit_n.webp` | Atlas des normales |
| `kit_orm.webp` | Occlusion, rugosité, métal dans le rouge, le vert et le bleu |
| `kit_e.webp` | Émission : les ampoules et les tubes des lampes, noir ailleurs |
| `surf_<nom>_c`, `_n`, `_r` | Matières qui se répètent : couleur et normales en 1024, rugosité en 512 |
| `kit.json` | Pour chaque objet : modèle Poly Haven, auteurs, triangles, taille, ancrage, cases de l'atlas, lumières. Pour chaque matière : ce qu'une répétition couvre en mètres |

Chaque objet est aplati en un seul maillage, en mètres, Y en haut, sa face tournée vers +Z :

- `floor` : posé sur y = 0, centré sur son emprise (la lampe de bureau est centrée sur son pied) ;
- `wall` : le dos sur le plan z = 0, l'origine au centre de ce qui touche le mur ;
- `ceiling` : suspendu sous y = 0, l'origine au centre de ce qui touche le plafond.

Les outils à main (batte, hachette, pied-de-biche, marteau, clé, tournevis) sont couchés sur leur côté plat, le long
de X. Tous les objets se dessinent avec les faces avant seules. `lights` donne, dans le repère de l'objet, l'endroit d'où une lampe éclaire (centre et étendue de l'ampoule ou
du tube).

Les matières : `slats` (lattes de bois), `plate` (tôle d'acier usée), `rubber` (dalles de caoutchouc), `plaster`
(enduit peint clair, fait pour être teinté), `ceiling` (bac acier) et `foam`. Poly Haven n'a pas de mousse acoustique :
`foam` est dessinée par l'outil (pyramides de 6 cm, 0,5 m par répétition).

## Le vert des normales

Les textures de Poly Haven sont des normales OpenGL (le vert monte dans l'image). Le jeu charge ses textures sans les
retourner (`flipY = false`) et n'a pas de tangentes : three.js déduit alors la bitangente des UV, et elle descend dans
l'image. Une normale OpenGL utilisée telle quelle est éclairée à l'envers (les pyramides de la mousse le montrent :
`kit-preview.html?ny=-1`). L'outil retourne donc le vert de toutes les normales qu'il écrit ; un matériau les utilise
sans rien régler (`normalMap`, `normalScale` à 1, 1).

## Ajouter ou régler un objet

Tout se passe dans la table `PROPS` de `build-kit.mjs` : une ligne par objet, rien d'autre dans l'outil n'est propre à
un modèle.

| Clé | Rôle |
| --- | --- |
| `name`, `id` | Nom dans le jeu, identifiant Poly Haven |
| `tris` | Budget de triangles (jamais dépassé) |
| `tile` | Côté de sa case dans l'atlas, en pixels. La case prend la forme de la partie de texture que l'objet utilise |
| `anchor` | `floor` (par défaut), `wall` ou `ceiling` ; `stand` centre un objet au sol sur son pied |
| `only`, `drop` | Garder ou retirer des nœuds (un seul tronçon d'un jeu modulaire, un câble, une sangle) |
| `glass` | Garder des matériaux transparents, rendus opaques (les autres sont retirés) |
| `scale`, `orient`, `lay` | Modèle qui n'est pas en mètres ; rotations de l'objet entier ; outil à coucher sur son côté plat |
| `move`, `turn` | Déplacer ou tourner des nœuds : fermer un tiroir, une porte |
| `cut` | Retirer les triangles qui lisent un rectangle de la texture (la peau intérieure d'un abat-jour, qui traverse l'extérieure une fois simplifiée) |
| `inside` | Donner un intérieur aux tôles ouvertes d'au moins tant de mètres : leurs propres triangles retournés, pris sur le budget |
| `erase`, `hue` | Repeindre un marquage ; changer les couleurs d'une étiquette trop proche d'un vrai produit |
| `fine`, `detail`, `weights` | Réglages de la simplification (voir ci-dessous) |

### La simplification

Ces modèles sont découpés en beaucoup d'îlots de texture et faits de beaucoup de petites pièces (vis, lettres en
relief, disjoncteurs). Forcer une réduction à travers une couture de texture étale l'image sur des éclats : c'est ce
qui abîmait la clé, l'horloge et l'alarme. L'outil procède donc ainsi :

1. il réduit dans une erreur qui ne se voit pas (`fine`, 2 % de la taille moyenne de l’objet : la racine cubique de son volume), sans jamais traverser une couture de
   texture (les sommets au même endroit avec des UV différents sont protégés) ;
2. si le budget n'est pas atteint, les petites pièces partent entières (`detail`), les plus coûteuses pour leur taille
   d'abord ;
3. puis l'erreur augmente, coutures toujours protégées ; les traverser est le dernier recours, et la ligne de l'objet le
   dit (`TEXTURE SEAMS CROSSED`) : il faut alors regarder l'objet, ou lui donner plus de triangles.

La sortie de l'outil donne pour chaque objet le nombre de triangles qu'il garderait à 2 % d'erreur : c'est ce nombre
qui dit si un budget est raisonnable.

## Regarder le résultat

`tools/calibre/kit-preview.html` (servi par `npm run dev`) charge le kit par le module du jeu :

- sans paramètre, la salle d'exposition : tous les objets sur une grille d'un mètre, fusionnés en un seul maillage comme
  le fait la boutique, et les matières à leur échelle au fond ;
- `?sheet=1&cols=5&az=35&el=18` : une case par objet, cadrée (`&only=a,b`, `&page=1&per=15`). Le carré montre le plan
  d'ancrage, les points jaunes les lumières ;
- `?flat=1` sans normales, `?white=1` sans couleur, `?ny=-1` avec le vert des normales retourné, `?side=double` avec
  les deux faces. Par défaut la page ne dessine que les faces avant, comme le matériau de la boutique : un objet qui
  montre alors des trous est une tôle ouverte, à régler avec `inside`.

À vérifier après chaque changement, sous plusieurs angles : l'orientation, les pièces déplacées, les éclats, les
textures étalées, les coques minces dont la peau intérieure traverse l'extérieure.
