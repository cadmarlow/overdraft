# Modèles de voitures — Blue Chips (0.9.13)

Les modèles dérivés ci-dessous sont distribués sous [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
Les auteurs restent titulaires de leurs œuvres. Les titres d'origine identifient les ressources créditées ;
les noms de véhicules, badges et plaques utilisés dans OVERDRAFT sont fictifs. Aucun soutien ou accord des auteurs
pour le jeu n'est suggéré.

## Flotte actuelle

Douze sources remplacent les quatorze modèles autres que Zénith. La licence de chaque source a été vérifiée sur sa
page primaire le **9 novembre 2026**. Le [registre de provenance](../../tools/cars/source-license-ledger.json)
contient également l'URL de l'API primaire, celle du téléchargement, la date et l'empreinte SHA-256 du GLB.

| Véhicule dans OVERDRAFT | Œuvre source | Auteur |
|---|---|---|
| Valmont Écume | [Audi A7 Sportback 2018](https://sketchfab.com/3d-models/audi-a7-sportback-2018-95700e5a98904b3591c6a03a4b67787b) | [KiW](https://sketchfab.com/QlER5) |
| Brisant Récif | [2015 Audi Q7](https://sketchfab.com/3d-models/2015-audi-q7-65917c52e0b24f1289126128600ed7aa) | [razor24](https://sketchfab.com/razor24) |
| Gréville Falaise, Brisant Marais | [Land Rover Defender 110](https://sketchfab.com/3d-models/land-rover-defender-110-5773ec04488b46148816b5f7a9f3f44f) | [meeww](https://sketchfab.com/meeww) |
| Gréville Escale | [Citroen PICASSO  3D model](https://sketchfab.com/3d-models/citroen-picasso-3d-model-2fbf653e4e6c438b95a290928137cf9d) | [ziedarchi](https://sketchfab.com/ziedjemai83) |
| Valmont Ressac | [Fiat_147](https://sketchfab.com/3d-models/fiat-147-6c643d284d144dcb8db46ab11285ec0b) | [lael.eugenio](https://sketchfab.com/lael.eugenio) |
| Gréville Galet | [Mini Cooper S](https://sketchfab.com/3d-models/mini-cooper-s-b262744901a04cda823f17289d1a4847) | [cenobyte](https://sketchfab.com/cenobyte) |
| Valmont Sillage | [Audi A4 B5.5 Avant](https://sketchfab.com/3d-models/audi-a4-b55-avant-2f6aea1435bd4ad093146c019c8e0fb6) | [Tomaso](https://sketchfab.com/Tomasoo) |
| Brisant Tempête | [Ford Mustang Shelby GT500](https://sketchfab.com/3d-models/ford-mustang-shelby-gt500-0eaa7a16796540f29461ddae05ecdeb3) | [Jiaxing](https://sketchfab.com/saitoyang) |
| Corsaire Foudre | [Honda NSX 1990](https://sketchfab.com/3d-models/honda-nsx-1990-1cc15628a00a4739a6b6c01128927c8d) | [Lexyc16](https://sketchfab.com/Lexyc16) |
| Valmont Cab 7 | [BMW E34 [stance style]](https://sketchfab.com/3d-models/bmw-e34-stance-style-ffe1a3a1bcb34e0bb80f1aa41c9edb46) | [Myedsu](https://sketchfab.com/myedsu) |
| Hauturier Cargo, Hauturier Tournée | [2014 Fiat Ducato](https://sketchfab.com/3d-models/2014-fiat-ducato-8a651ad182414bb0a8b6c6d8d5bd7c01) | [razor24](https://sketchfab.com/razor24) |
| Hauturier Fret | [Mazda Titan 92 Lowpoly](https://sketchfab.com/3d-models/mazda-titan-92-lowpoly-d1496fb911e749f89f07ec1e9e7e2445) | [kekomag](https://sketchfab.com/kekomag) |
| Corsaire Zénith | [Car Concept](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept) | Eric Chadwick, Darmstadt Graphics Group GmbH |

Les quatre jantes de la source utilisée pour **Valmont Cab 7** réutilisent [BBS LM](https://sketchfab.com/3d-models/bbs-lm-93fbcf56ebab4be99f00b8b1246b6010), par
[Lexyc16](https://sketchfab.com/Lexyc16), sous la même licence CC BY 4.0. Cette attribution reste nécessaire après
suppression des inscriptions BBS visibles.

Les douze GLB de remplacement proviennent du catalogue public [pedrosoandre/carros](https://github.com/pedrosoandre/carros),
qui relaie ces œuvres ; les pages d'origine et leurs auteurs sont liés ci-dessus. Car Concept provient de
[glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept).

## Modifications apportées

- Orientation, mise à l'échelle et déformation des carrosseries pour suivre les quinze châssis physiques du jeu ;
  normales transformées avec la géométrie, dimensions et réglages de conduite conservés.
- Séparation des vitres, roues et pièces mobiles ; matériaux repris et textures regroupées sur des atlas couleur,
  rugosité/métal et normales ; géométries simplifiées distinctes pour le trafic et la distance.
- Suppression des emblèmes, plaques et inscriptions de marque des sources, y compris dans le relief des textures
  concernées. Les détails utiles de carrosserie, d'optique et de roue sont conservés autour des éléments retirés.
- Intérieurs source conservés pour Tempête, Marais et Falaise ; autres modèles remplacés équipés des cabines et
  instruments originaux du jeu. La Zénith conserve son intérieur central, son volant animé et ses freins source.
- **Falaise** : conversion de la base Defender 110 en pick-up avec benne ouverte, dos de cabine et lunette créés
  pour OVERDRAFT. **Cargo / Tournée** : deux gabarits visuels à partir de la source Ducato.
- **Zénith**, adaptation conservée de Fair Value : emblèmes Khronos et inscriptions Khronos/3DCommerce des pneus
  retirés dans la couleur et le relief ; essuie-glaces simplifiés ; variantes de circulation séparées.

Les créations ajoutées par le projet comprennent les plaques fictives, badges Valmont/Brisant/Gréville/Hauturier/Corsaire,
les cadrans fonctionnels et les cabines génériques. Le code de préparation est décrit dans
[tools/cars/README.md](../../tools/cars/README.md).

Depuis la préparation des niveaux de détail de la rue (`tools/cars/build-lods.mjs`) : le niveau détaillé est plafonné
(60 000 triangles de carrosserie, 3 600 par roue), deux niveaux intermédiaires sont reconstruits à partir de ce que
l'on voit de chaque voiture depuis l'extérieur, et les roues livrées braquées (Galet, Zénith) ou carrossées (Cab 7)
sont remises sur leur essieu. Les roues de la Valmont Écume sont celles de l'œuvre « 2015 Audi Q7 » de razor24
(CC BY 4.0, même attribution que le Brisant Récif), ramenées au rayon de l'Écume : la source Audi A7 n'apportait
qu'un disque sombre et les pavés d'une bande de roulement.

## Sources des versions précédentes

Ces modèles sous CC BY 4.0 ont fourni les véhicules jusqu'à Fair Value ; ils sont remplacés dans la flotte Blue Chips.
Leurs attributions sont conservées pour les versions et ressources historiques.

| Anciens fichiers | Œuvre | Auteur et source |
|---|---|---|
| sedan, suv, pickup, minivan, hatch, compact, wagon, offroad, muscle, sport | Generic passenger car pack | [Comrade1280](https://sketchfab.com/3d-models/20f9af9b8a404d5cb022ac6fe87f21f5) |
| taxi | Fairheaven LT '80 - Low poly model | [Daniel Zhabotinsky](https://sketchfab.com/DanielZhabotinsky) |
| van | Shvan '92 - Low poly model | [Daniel Zhabotinsky](https://sketchfab.com/DanielZhabotinsky) |
| truck | LCT 3000 '95 - Low poly model | [Daniel Zhabotinsky](https://sketchfab.com/3d-models/663a0953c038434a918cb85725c88ffa) |
| delivery | French delivery van - Low poly model | [Daniel Zhabotinsky](https://sketchfab.com/DanielZhabotinsky) |
