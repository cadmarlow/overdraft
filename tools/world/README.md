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
