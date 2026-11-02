# Arbres et herbe

Tout ce qui se trouve dans `assets/nature` sort d'ici. Rien de ce dossier n'est chargé par le jeu.

Sources, toutes en CC0 : feuilles scannées et herbe d'[ambientCG](https://ambientcg.com) (LeafSet010, 013, 014, 016, Grass001,
Grass005, en 2K-JPG), écorces de [Poly Haven](https://polyhaven.com) (japanese_zelkova_bark, bark_brown_02, bark_platanus,
jolcham_oak_bark_01, en 2k : `diff.jpg`, `nor_gl.jpg`, `rough.jpg` dans un dossier à leur nom).

```bash
cd tools/nature
npm install
node build-foliage.mjs <dossier des téléchargements>
node build-textures.mjs <dossier des téléchargements>
```

`build-foliage.mjs` découpe chaque feuille de sa planche, puis les pose le long de rameaux pour composer l'atlas : une rangée
par espèce, deux rameaux, une touffe, et la masse dense des cimes lointaines. Les tailles sont en mètres, dans `SPECIES`.
