# Voitures

Tout ce qui se trouve dans `assets/cars` sort d'ici. Rien de ce dossier n'est chargé par le jeu.

Sources, sous licence CC BY 4.0 (détail dans `assets/cars/LICENSE-cars.md`) : les modèles génériques de
[pedrosoandre/carros](https://github.com/pedrosoandre/carros) et Car Concept de
[glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets). Les .glb ne sont pas dans le dépôt : les poser dans un dossier
(`CarConcept.glb` dans un dossier `khronos` à côté).

```bash
cd tools/cars
npm install
node import-cars.mjs <dossier des .glb>
```

Pour chaque modèle : orientation d'après les roues, mise à la longueur réelle, roues séparées et centrées sur leur axe, atlas 2048×1024
(`_c` couleur, `_m` : rouge = masque de peinture, vert = rugosité, bleu = métal), version lointaine simplifiée. `models.json` décrit les
plages de triangles et les dimensions. `tools/car-preview.html` affiche la flotte.

`flip` retourne un modèle livré à l'envers : l'avant doit être en +Z.
