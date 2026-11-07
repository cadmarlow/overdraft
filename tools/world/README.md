# Surfaces et objets de la ville

Tout ce qui se trouve dans `assets/world` sort d'ici. Rien de ce dossier n'est chargé par le jeu.

Sources : [Poly Haven](https://polyhaven.com), en CC0. Les outils téléchargent eux-mêmes ce qu'il leur faut.

```bash
cd tools/world
npm install
node build-textures.mjs <dossier de travail>
node import-prop.mjs <dossier de travail> fire_hydrant hydrant 900
node import-prop.mjs <dossier de travail> metal_trash_can trashcan 500
node import-prop.mjs <dossier de travail> trashbag trashbag 300
node import-prop.mjs <dossier de travail> planter_box_01 planter 400
node import-prop.mjs <dossier de travail> utility_box_01 utilitybox 300
node import-prop.mjs <dossier de travail> concrete_road_barrier barrier 400
```

`build-textures.mjs` écrit aussi `sizes.json` : ce que couvre chaque photo en mètres, qui fixe l'échelle des briques.

## Lumière et volumes de réflexion — Revaluation

Depuis la racine du projet, avec Node.js 22 ou plus, sans installation ni téléchargement :

```bash
node tools/world/bake-urban-light.mjs
```

L'outil lit les empreintes déjà livrées dans `js/building-geodata.bin.gz`, les projette sur une grille de 4 m avec
224 m de marge et conserve les cours intérieures. Huit directions et neuf distances par direction donnent la visibilité
du ciel à 2, 16, 48 et 144 m. Le jeu interpole ces quatre valeurs ; les objets, façades, sol et personnages partagent
ainsi la même lumière ambiante locale. Le calcul ne s'exécute jamais pendant la partie.

- `assets/world/urban-light.bin.gz` : visibilité du ciel, quatre octets par cellule, environ 5,63 Mo compressés.
- `assets/world/urban-reflection.bin.gz` : hauteur du bâtiment, octet bas dans R et haut dans G, environ 0,30 Mo.
  Les voitures détaillées y cherchent les volumes réfléchis ; les matériaux et fenêtres reflétés sont approximés.
- `js/urban-light-field.js` : projection, calcul et format commun au générateur et aux tests.
- `js/urban-light.js` : chargement, interpolation et recherche de volumes en TSL.

Les deux ressources portent le même en-tête ODL1 de 48 octets : version, dimensions, origine X/Z, pas de grille et quatre
hauteurs. Les dimensions, la longueur exacte et les métadonnées sont vérifiées au chargement. Le résultat actuel mesure
1265 × 3513 cellules. Les ressources n'utilisent aucun canal alpha d'image WebP, conversion de couleur ou compression
avec perte. Ce modèle ne reproduit pas tous les surplombs, gradins, vitres, véhicules ni personnages de la scène.
