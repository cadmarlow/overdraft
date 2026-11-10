# Arbres

Tout ce qui se trouve dans `assets/trees` et `js/tree-geodata.*` sort d'ici. Rien de ce dossier n'est chargé par le jeu.

## Ce que ça fabrique

| Fichier | Contenu |
| --- | --- |
| `assets/trees/foliage_c.webp`, `foliage_n.webp` | L'atlas de feuillage : de vraies feuilles scannées, posées en trois dimensions le long de rameaux, puis photographiées. Une rangée par essence, quatre vignettes : deux rameaux, une brindille, une masse de branche. |
| `assets/trees/bark-*.webp` | Les écorces. |
| `assets/trees/trees.bin.gz` | Les seize arbres (huit essences, adulte et jeune), chacun en deux niveaux de détail. |
| `assets/trees/impostors_c.webp`, `impostors_n.webp` | Chaque arbre photographié sous 29 angles : ce qu'on voit de loin est la photo de l'arbre de près. |
| `js/tree-geodata.js`, `.bin.gz` | Les arbres recensés par la ville : position, essence, diamètre du tronc. |

## Sources

Toutes en CC0, créditées dans `CREDITS.md` :
- feuilles scannées d'[ambientCG](https://ambientcg.com) : LeafSet004 (tilleul), 009 (base du ginkgo), 010 (platane), 014 (orme),
  016 (chêne), 022 (cerisier), 024 (poirier) ;
- frondes du Jacaranda Tree de [Poly Haven](https://polyhaven.com/a/jacaranda_tree), pour le févier ;
- écorces de Poly Haven : bark_platanus, japanese_zelkova_bark, bark_brown_02, jolcham_oak_bark_01 ;
- recensement : NYC Parks, Forestry Tree Points (`hn5i-inap` sur NYC Open Data).

## Tout régénérer

```bash
cd tools/trees
npm install
node fetch.mjs <dossier hors du dépôt>          # télécharge les sources (≈ 130 Mo)
node build-bark.mjs <dossier>                   # écorces
node build-foliage.mjs <dossier>                # atlas de feuillage (≈ 1 min) ; --preview <dossier> pour le regarder
node build-trees.mjs                            # arbres et imposteurs (≈ 1 min)
node build-tree-data.mjs --fetch <fichier.json> # recensement (≈ 46 Mo téléchargés, hors du dépôt)
```

L'ordre compte : `build-trees.mjs` lit l'atlas de feuillage et les écorces dans `assets/trees`.

## Regarder un arbre sans lancer le jeu

```bash
node preview.mjs <dossier de sortie> [--size 520] [--views side,side2,lod1,under,top,close] [plane-a oak-b ...]
```

Une image par arbre : le modèle complet sous deux angles, puis le modèle allégé. Deux secondes par arbre.

## Régler une essence

Tout est dans `lib/species.mjs` : silhouette de la couronne, façon dont chaque ordre de branche quitte le précédent,
densité des rameaux. `lib/grow.mjs` explique chaque nombre. Les feuilles (taille, port, couleur) sont dans
`lib/foliage.mjs`.

Deux choses sont réglées automatiquement par `build-trees.mjs` : la taille des touffes du modèle allégé, jusqu'à ce
qu'il couvre la même silhouette que le modèle complet, et son gain de luminosité.

## Ce que le jeu en attend

- La couleur d'une surface avant lumière est calculée deux fois avec les mêmes formules : dans `lib/draw.mjs` (pour
  les photos) et dans `js/tree-materials.js` (en jeu). `tests/trees.test.mjs` échoue si elles divergent. Après
  avoir changé l'une, changer l'autre et relancer `build-trees.mjs`.
- Les arbres vont par paires dans `lib/species.mjs` : adulte puis jeune, dans l'ordre des classes du recensement.
