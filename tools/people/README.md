# Importer les personnages

Tout ce qui se trouve dans `assets/people` sort d'ici. Rien de ce dossier n'est chargé par le jeu.

Sources : [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) (MIT) pour les personnes, les armes et la
motion capture, [M4A1 de nisu](https://opengameart.org/content/m4a1-assault-rifle) (CC0) pour le fusil d'assaut.

```bash
cd tools/people
npm install
```

| Étape | Commande |
| --- | --- |
| Télécharger des avatars | `node fetch.mjs <dossier> Adults/Male_Adult_04 Professions/Police_Male_03` (`COLOR_ONLY=1` pour la foule) |
| Un personnage complet | `node import-avatar.mjs hero <dossier>/Male_Adult_04/Male_Adult_04.fbx <dossier>/Male_Adult_04 --size 2048 --normal 1024 --hair 0.3` |
| Un piéton | `node import-crowd.mjs m01 <fichier.fbx> <textures> m`, la liste est dans `crowd-list.txt` |
| Une arme portée par un avatar | `node import-weapon.mjs pistol <avatar.bin> pistol <préfixe des textures> -1 1 -0.30` |
| Le fusil | `node import-rifle.mjs <dossier M4A1> 2,-1,1,1,0.86,0.045,-0.106` |
| La motion capture | `node import-clips.mjs <dossier de .fbx>`, liste de clips : `Assets/Animations` du dépôt Rocketbox |
| Ce que les passants tiennent en main | `node import-held.mjs <Male_Adult_08.fbx> <Female_Adult_08.fbx>` |
| Les poses de la foule | `node bake-crowd-motion.mjs <Male_Adult_08.fbx> <Female_Adult_08.fbx>`, à refaire après `import-clips` |

Pour vérifier le résultat : `tools/people-preview.html` (corps, poses, armes), `tools/crowd-preview.html` (foule au repos),
`tools/gun-preview.html` (armes sur une grille de 10 cm).
