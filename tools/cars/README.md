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

## Banc de dynamique — Capital Gains

Sans dépendance, depuis la racine du jeu :

```sh
node tools/cars/benchmark-dynamics.mjs
node tools/cars/benchmark-dynamics.mjs --json --output /tmp/overdraft-dynamique.json
```

Utilise les dimensions réelles des quinze modèles pour mesurer le 0–100, le freinage 100–3 km/h sur sec/faible adhérence, la marche arrière et les écarts entre 20/30/60/144 Hz. Vérifie aussi pause/reprise, impact répété et récupération après retournement. `--baseline /chemin/car-physics.js` compare le coût CPU à un autre simulateur compatible. Les chiffres de performance CPU varient selon la machine et sa charge.

Les plaques, badges et cadrans sont dessinés par le jeu au chargement (`car-assets.js`, `car-cabin.js`) ; les freins sont des géométries partagées (`car-details.js`). Ils ne nécessitent aucun téléchargement ni régénération des fichiers binaires.

## Essai dans Chrome réel

Lancer un Chrome de test avec un profil séparé, sans toucher à l'onglet de jeu habituel :

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir=/tmp/overdraft-cars-qa-profile --remote-debugging-port=9334 --disable-gpu-vsync --disable-frame-rate-limit --enable-unsafe-webgpu
node tools/cars/qa-browser.mjs --port 9334 --url 'http://localhost:5174/?qa=1&quality=balanced&architecte=0' --output /tmp/overdraft-cars-qa
```

Le serveur du worktree peut être lancé par `npm run dev -- --port 5174`. Le banc ouvre son propre onglet, isole ses sauvegardes en mémoire, instrumente les erreurs JavaScript **et les erreurs de compilation WebGPU dès le chargement**, puis choisit et conduit les quinze automobiles avec des entrées CDP réelles. Il ferme uniquement son onglet. `--output` conserve les captures et `rapport.json` ; la commande échoue si la simulation ou les shaders échouent. L'image reste à juger humainement en caméra de jeu. Remplacer `quality=balanced` par `quality=high` pour tester les reflets par volumes.
