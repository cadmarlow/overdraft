# Importer les armes

Tout ce qui se trouve dans `assets/weapons` sort d'ici. Rien de ce dossier n'est chargé par le jeu.

Les sources, leurs auteurs et leurs licences sont dans `assets/weapons/LICENSE-weapons.md`. Les fichiers d'origine
(GLB et glTF) ne sont pas dans le dépôt : les retélécharger depuis les pages indiquées, dans un dossier dont les
sous-dossiers portent les noms attendus par `weapons.json` (clé `source`).

```bash
cd tools/people && npm install      # sharp, partagé avec l'import des personnages
cd ../weapons
node import.mjs <dossier des téléchargements>            # toutes les armes
node import.mjs <dossier des téléchargements> rifle      # une seule
```

## `weapons.json`

Une entrée par arme. Rien dans `import.mjs` n'est propre à un modèle.

| Clé | Rôle |
| --- | --- |
| `source` | Fichier `.gltf` ou `.glb`, relatif au dossier des téléchargements |
| `barrel`, `up` | Axes du canon et du dessus dans la source (`+x`, `-z`...), quand le modèle est droit |
| `orient: "pca"` | Modèle posé de travers : ses axes propres servent d'axes (long = canon, haut, mince) |
| `flip` | Avec `pca` : retourner `"y"` ou `"z"` quand l'arme sort à l'envers |
| `pitch` | Degrés pour remettre le canon de niveau, lus sur la grille de `gun-preview.html` |
| `length` | Longueur réelle en mètres : fixe l'échelle |
| `shift` | Décalage de l'origine quand un accessoire d'un seul côté fausse le centrage |
| `parts` | Quels nœuds font quelle pièce (`body`, `action`, `magazine`). Une pièce peut porter `move` (replacer un chargeur posé à côté) ou `box` (ne prendre que les triangles d'une boîte : découper une pompe ou un chargeur dans un modèle d'un seul bloc). Les pièces sont servies dans l'ordre |
| `drop` | Boîtes dont les triangles sont jetés (cartouche posée à côté de l'arme) |
| `travel` | Course des pièces mobiles, en mètres |
| `erase` | Marquages à repeindre, en coordonnées de texture : `[u0, v0, u1, v1]`, plus `du, dv` pour copier le métal propre d'à côté |
| `unmark` | Les mêmes, désignés sur le modèle : une boîte en espace arme, `side: true` pour ne prendre que les flancs |
| `texture` | Taille des textures écrites |

Le fichier `.bin` contient un en-tête JSON (pièces, matériaux, courses), puis positions, normales, UV et indices.
Chaque matériau a trois images WebP : couleur `_c`, normales `_n`, occlusion/rugosité/métal `_orm`.

## Régler une arme

1. Première passe sans `pitch` ni `box`, puis `tools/gun-preview.html?names=rifle&span=1.1` : l'arme sur une grille au
   centimètre (`view=side|other|top`, `parts=1` écarte les pièces mobiles).
2. Lire sur la grille le niveau du canon, les boîtes des pièces à découper et les points de prise.
3. Reporter les points de prise (`grip`, `fore`, `butt`, `muzzle`, `port`, `magazine`, `sight`, `stow`) dans `HOLD` de
   `js/person-motion.js`. Le test `person-motion` vérifie qu'ils sont bien sur le modèle livré.
4. `tools/gun-studio.html` montre le héros avec l'arme : portée, prête, en joue, dégainée, rangée, sous plusieurs angles
   (`?set=rifle:carry:3.9,rifle:aim&cams=180:8:2.8,290:5:2.8`, `focus=gun` pour les mains).

Les portraits de la roue (`icon-*.webp`) sont des rendus de `gun-preview.html?beauty=1` sur fond noir puis blanc, dont
la différence donne la transparence.
