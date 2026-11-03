# Ce que sont les immeubles

`build-styles.mjs` écrit `js/building-styles.bin.gz` : pour chacun des immeubles de `js/building-geodata.js`, dans le même
ordre, ce que la ville et les cartographes en savent. Le jeu en tire le type et la tenue de chaque immeuble
(`js/building-types.js`) et ses gradins (`js/buildings.js`, `js/building-massing.js`).

Sources :

- NYC Department of City Planning, **PLUTO** (NYC Open Data, `64uk-42ks`) : catégorie d'immeuble, nombre d'étages, année
  de construction, quartier historique et statut de monument, au centre de chaque parcelle.
- **OpenStreetMap** (© contributeurs, ODbL) : les volumes des tours en gradins (`building:part` et leurs hauteurs), la
  couleur, le matériau et la forme du toit relevés par les cartographes.

Les téléchargements restent hors du dépôt, dans le dossier donné :

```bash
node tools/buildings/build-styles.mjs <dossier de travail> --fetch   # télécharge puis construit
node tools/buildings/build-styles.mjs <dossier de travail>           # reconstruit depuis les fichiers déjà téléchargés
```

Le fichier porte une empreinte des immeubles pour lesquels il a été fait : si `js/building-geodata.bin.gz` change, il faut
le reconstruire, sinon le jeu refuse de démarrer avec un message clair.
