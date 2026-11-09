# Importer les personnages

Tout ce qui se trouve dans `assets/people` sort d'ici. Rien de ce dossier n'est chargé par le jeu.

Source : [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) (MIT) pour les personnes et la motion
capture. Les armes ont leur propre outil : `tools/weapons`.

```bash
cd tools/people
npm install
```

| Étape | Commande |
| --- | --- |
| Télécharger des avatars | `node fetch.mjs <dossier> Adults/Male_Adult_07 Professions/Police_Male_03` (`COLOR_ONLY=1` pour la foule) |
| Un personnage complet | `node import-avatar.mjs hero <dossier>/Male_Adult_07/Male_Adult_07.fbx <dossier>/Male_Adult_07 --size 2048 --normal 1024 --hair 0.5` |
| Un piéton | `node import-crowd.mjs m01 <fichier.fbx> <textures> m`, la liste est dans `crowd-list.txt` |
| La motion capture | `node import-clips.mjs <dossier de .fbx>`, liste de clips : `Assets/Animations` du dépôt Rocketbox |
| Ce que les passants tiennent en main | `node import-held.mjs <Male_Adult_08.fbx> <Female_Adult_08.fbx>` |
| Les poses de la foule | `node bake-crowd-motion.mjs <Male_Adult_08.fbx> <Female_Adult_08.fbx>`, à refaire après `import-clips` |

Pour vérifier le résultat : `tools/people-preview.html` (corps, poses), `tools/crowd-preview.html` (foule au repos),
`tools/gun-studio.html` (le héros et ses armes : portées, en joue, dégainées, rangées).
