# Le sol de la ville

Tout ce qui se trouve dans `assets/ground` sort d'ici, ainsi que `js/ground-atlas.js`. Rien de ce dossier n'est chargé
par le jeu. `sharp` vient de `tools/world/node_modules` (`cd tools/world && npm install`).

## Photos et masques d'usure

```bash
node tools/ground/build-ground.mjs <dossier de travail>
```

Télécharge depuis [Poly Haven](https://polyhaven.com) (CC0) les cartes 2K de neuf surfaces et d’une photo aérienne, puis
écrit pour chacune deux fichiers de 1024 px :

- `<nom>_c.webp` : couleur, et hauteur dans l'alpha ;
- `<nom>_n.webp` : normale, et rugosité dans l'alpha.

| Nom | Source | Rôle |
|---|---|---|
| `asphalt` | asphalt_pit_lane | la chaussée vieillie, à gros grain |
| `blacktop` | asphalt_track | l'enrobé neuf : tronçons refaits, rustines |
| `chipseal` | tarred_gravel | le vieux liant aux gravillons apparents, la terre des fosses d'arbres |
| `concrete` | granular_concrete | les dalles de trottoir |
| `trowel` | brushed_concrete | les dalles anciennes, la pierre bleue, les bordures en béton |
| `setts` | cobblestone_floor_08 | la bande de pavés de granit le long des bordures |
| `dirt` | park_dirt | la terre battue des parcs : sous les arbres, le long des allées |
| `litter` | forest_leaves_03 | les feuilles mortes, sous le couvert |
| `rock` | lichen_rock | le schiste des affleurements de Central Park |
| `macro` | aerial_asphalt_01 | 30 m de chaussée vus d'en haut, pour les changements de ton |

Les trois dernières ne servent que par leur couleur et leur hauteur : elles sont livrées sans carte de normales
(`"normal": false` dans `ground.json`).

`ground.json` note ce que couvre chaque photo en mètres et sa couleur moyenne : les shaders divisent par cette moyenne
puis fixent eux-mêmes le ton, donc changer de photo ne change pas la clarté d'une rue.

Le même outil calcule les masques d'usure, répétables, que tous les shaders du sol se partagent :

- `masks_a.webp` : taches en nappes (gris) et coulures le long de la route (alpha), égalisées : un seuil `t` couvre
  exactement `1 - t` de la surface ;
- `masks_b.webp` : mouchetis (gris) et réseau de fissures (alpha).

Avec `--no-fetch`, l'outil ne télécharge rien et échoue s'il manque une carte dans le dossier de travail.

## Atlas des objets et des marquages

```bash
node tools/ground/build-atlas.mjs [--preview <dossier>]
```

Aucun téléchargement. Chaque objet est dessiné en carte de hauteur, d'où sortent la normale, la couleur (la crasse se
dépose dans les creux, les reliefs sont polis) et la rugosité. Le résultat est identique d'une exécution à l'autre.

- `objects_c.webp`, `objects_n.webp` : plaques d'égout, plaques de regard, avaloir, grille de métro, trappe de cave,
  bande podotactile, bouches à clé, chambre de tirage, grille d'arbre. Rugosité 1 = le vide entre deux barreaux.
- `marks.webp` : flèches, mots, pictogrammes, taches d'huile, traces de pneus, fissures, marques de bombe.
- `js/ground-atlas.js` : la place et la taille réelle de chaque tuile. Le haut de l'image est le sens de circulation.

`--preview` écrit des planches éclairées par un soleil bas, pour juger le relief sans lancer le jeu.

Les inscriptions ne portent que des mots génériques et les marques inventées du jeu.
