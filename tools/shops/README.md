# Les boutiques

Tout ce que `js/storefronts.js` affiche sort d'ici. Rien de ce dossier n'est chargé par le jeu, sauf ce qui est écrit dans
`assets/shops` et les modules générés de `js/`.

## Où sont les boutiques

```bash
node tools/shops/build-storefronts.mjs --fetch   # télécharge les registres, puis écrit js/storefront-geodata.bin.gz
node tools/shops/build-storefronts.mjs           # relance à partir des copies de tools/data
```

Sources (NYC Open Data) :
- *Storefronts Reported Vacant or Not* (loi locale 157), année 2025 : la position de chaque vitrine, la rue de son adresse,
  si elle est vide. Les catégories d'activité de 2023 à 2025 sont inutilisables (les « services éducatifs » y deviennent la
  première activité de Manhattan et la restauration disparaît) : celles de chaque immeuble viennent du registre 2021-2022.
- *DOHMH Restaurant Inspection Results* : chaque restaurant à sa place, avec sa cuisine.

Seules les positions, les activités et les cuisines servent. Aucun nom réel : `js/storefront-signs.js` invente tout.
Le type de chaque boutique est listé dans `js/storefront-types.js` (on ajoute à la fin, on ne réordonne jamais).

## Les enseignes

```bash
node tools/shops/fetch-fonts.mjs    # polices Google Fonts (OFL, Permanent Marker en Apache 2.0) dans tools/shops/fonts
npm run dev                         # dans un autre terminal
node tools/shops/build-glyphs.mjs   # assets/shops/glyphs.png et js/storefront-glyphs.js
```

Un atlas de lettres « à champ de distance » : trois polices par pixel (rouge, vert, bleu). Le shader des enseignes compose
le texte lettre par lettre, donc chaque boutique a son propre nom sans texture à elle.

## Les matières

```bash
node tools/shops/build-kit-textures.mjs <dossier de travail>   # assets/shops/kit_c.webp, kit_n.webp, kit.json
```

Seize matières photographiées (Poly Haven, CC0) dans un atlas de 4 × 4 : rideau de fer, granit, pierre, bois, carrelage,
granito… et les quatre briques et pierres des immeubles (`assets/world`), pour que les piliers prolongent le mur. Il faut
`npm install` dans `tools/world` (sharp).

## Les intérieurs

```bash
npm run dev
node tools/shops/build-interiors.mjs 256                  # les 30 pièces, 256 échantillons par image
node tools/shops/build-interiors.mjs 256 only=bodega,bar  # seulement certaines (les autres restent)
```

`interiors.html` construit une pièce meublée par type de boutique (6 × 3,4 × 5 m) et la calcule par lancer de rayons
(three-gpu-pathtracer, MIT, chargé depuis esm.sh par l'outil seulement) depuis un œil fixe à 3 m devant la vitre.
L'image couvre exactement l'ouverture de la pièce : le shader des vitrines reprojette sur elle chaque point de la pièce que
voit la caméra. Le mobilier proche de la vitre est aussi rendu à part, avec sa couverture (`interiors-near.webp`), et glisse
par-dessus pour la parallaxe.
