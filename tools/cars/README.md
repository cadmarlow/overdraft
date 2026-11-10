# Voitures — Blue Chips

Ce dossier prépare hors ligne les ressources de `assets/cars`. Aucun outil d'import n'est chargé par le jeu.
La flotte Blue Chips remplace quatorze modèles à partir de douze sources CC BY 4.0 et conserve la Zénith de Fair Value.
Les attributions sont dans [LICENSE-cars.md](../../assets/cars/LICENSE-cars.md) et [CREDITS.md](../../CREDITS.md).
Le [registre des sources](source-license-ledger.json) donne pour chaque GLB son auteur, sa page primaire, sa licence,
son téléchargement public, sa date de vérification et son empreinte SHA-256.

## Régénérer la flotte actuelle

Node.js 22 ou plus. Les dépendances de ce dossier servent uniquement à la préparation hors ligne ; le jeu et les
tests autonomes de l'importeur n'en ont pas besoin.

```sh
cd tools/cars
npm install
cd ../..
node tools/cars/import-fleet.mjs /chemin/vers/les-glb --out /tmp/overdraft-blue-chips --lock-manifest assets/cars/models.json
```

Placer les douze fichiers du registre directement dans le dossier source, sous le nom `<id>.glb` :
`audi-a7`, `audi-q7`, `land-rover-defender-110`, `citroen-picasso`, `fiat-147`, `mini-cooper`, `audi-a4`,
`ford-mustang`, `honda-nsx`, `bmw-e34`, `fiat-ducato` et `mazda-titan-92`.
Le catalogue [pedrosoandre/carros](https://github.com/pedrosoandre/carros) relaie les fichiers ; les pages primaires
et les auteurs crédités restent la référence de provenance. Aucun compte ni achat n'est requis pour ces sources.

`import-fleet.mjs` commence par copier les ressources jouables dans le dossier de sortie, puis régénère la sélection.
Le manifeste de sortie conserve ainsi les quinze entrées, la Zénith et les véhicules non sélectionnés. `--only
muscle,sedan` limite l'opération ; sans sélection, les quatorze remplacements sont préparés. Exemple :

```sh
node tools/cars/import-fleet.mjs /chemin/vers/les-glb --out /tmp/overdraft-blue-chips --only muscle,sedan --lock-manifest assets/cars/models.json
```

Le dossier temporaire permet d'inspecter les binaires, atlas, niveaux de détail et vues de jeu avant de remplacer
les ressources jouables. Conserver le manifeste de référence utilisé pour rendre la comparaison reproductible.

`import-cars.mjs` reste le moteur d'import et l'entrée des anciennes recettes. Son CLI historique ne remplace pas
`import-fleet.mjs` pour Blue Chips. Il permet notamment de régénérer séparément Zénith avec `--only super` : dans ce
cas, la structure attendue est `sources/cars/` et `sources/khronos/CarConcept.glb`, et le premier argument désigne
`sources/cars`. Les recettes de la flotte sont regroupées dans `fleet-models.mjs`, avec les familles de
`fleet-large.mjs` et `fleet-small.mjs`.

## Géométrie visuelle et contrat physique

Les quinze `spec` sont recopiés intégralement depuis `--lock-manifest` : dimensions, garde au sol, rayons et positions
des roues, emplacements des feux. La génération vérifie leur égalité stricte ; le simulateur et ses réglages ne sont
pas modifiés. `flip` corrige le sens d'un modèle pour placer l'avant en +Z après orientation par les essieux.

`fit-car.mjs` adapte la géométrie visible aux empattements, voies et dimensions de ce contrat. Les normales suivent
l'inverse transposée de la même déformation. Les roues sont traitées autour de leur pivot propre ; leurs variantes
proches et de circulation conservent ce repère pour le braquage, la suspension et la rotation. `split-parts.mjs`
sépare les composantes quand un matériau regroupe les quatre roues dans une seule primitive, sans perdre les
coutures UV ni les normales distinctes.

Les recettes identifient peinture, vitrages, optiques et pièces mobiles à partir des matériaux et des nœuds.
Les filtres de marque sont appliqués avant orientation et adaptation : les chevrons d'Escale et les emblèmes de
Récif/Cargo/Tournée partagent parfois une primitive avec des réflecteurs ou des joncs utiles, qui sont conservés.
La suppression porte aussi sur la couleur, le relief et les autres canaux où une inscription est encodée.
Les plaques et badges fictifs OVERDRAFT sont ensuite ajoutés par le jeu.

Falaise dérive de la base utilisée pour Marais : la partie arrière devient une benne ouverte avec un dos de cabine
et une lunette créés pour le projet. Cargo et Tournée emploient la même source Ducato, adaptée à deux gabarits
physiques. Cette parenté est conservée dans les crédits et le registre.

## Matières et précision

Chaque matériau dispose d'une région d'atlas, même sans texture de couleur. Les facteurs de couleur, rugosité et métal
de la source glTF sont appliqués, puis les adaptations explicites de la recette. Les UV répétés, les modes d'adressage
et `KHR_texture_transform` sont pris en compte ; `normalTexture.scale` est intégré au résultat. Les textures très
répétées sont filtrées avant réduction. Les coordonnées UV secondaires d'occlusion ne sont pas transférées.

Les fichiers produits sont :

- `_c.webp` : couleur sRGB ;
- `_m.webp` : données sans perte, rouge = masque de peinture, vert = rugosité, bleu = métal ;
- `_n.webp`, si la source fournit des normales : normales tangentes RGB sans perte, sans conversion sRGB.

Les couches partagent leurs UV et des marges de quatre pixels. Les recettes Blue Chips utilisent des atlas de
2048×2048. `normalTexture` dans `models.json` indique la présence effective de la couche normale ; une source
sans carte de normales n'en reçoit pas une artificiellement dans le manifeste.

Les normales géométriques sont normalisées et stockées en quatre composantes `Int16` normalisées
(`normalFormat: "snorm16"`, dernière composante nulle). Les sources sans normales en reçoivent depuis leurs triangles ;
les transformations miroir inversent l'ordre des faces. Les tests couvrent la précision de quantification et les
transformations non uniformes.

La Zénith conserve le traitement de Fair Value : le micrograin de peinture Car Concept, trop fin pour l'atlas, est
intégré à la rugosité des microfacettes. `paintRoughness` transmet cette valeur au pigment tandis que le vernis reste
lisse. Le cuir, les pneus et les disques gardent leurs reliefs disponibles ; les marques des pneus sont effacées
dans la couleur et les normales.

## Binaire, pièces et niveaux de détail

Le `.bin` contient les positions `Float32×3`, les normales `Int16×4`, les UV `Uint16×2`, les indicateurs `Uint8`,
un bourrage au multiple de quatre octets puis les indices `Uint32`. Le début des indices est
`vertices * 25 + (4 - vertices % 4) % 4`. Le lecteur accepte encore l'ancien format à normales `Int8×4`, coefficient 21.

Les quatorze valeurs de `ranges` décrivent sept couples `[début, longueur]` : carrosserie, vitres, coque lointaine,
puis quatre roues. Les groupes facultatifs suivent :

- `calipers` : quatre plages d'étriers sur les pivots des roues, suivant braquage et suspension sans tourner avec
  les pneus ; les disques restent attachés aux roues ;
- `steering` : plage du volant, position de son moyeu, axe normalisé et rayon ;
- `trafficShell` et `trafficWheels` : coque extérieure et roues simplifiées pour circulation et stationnement ;
- `midShell` et `midWheels` : le niveau des voitures proches (voir « Niveaux de détail de la rue »).

La simplification de circulation est indépendante du modèle proche. Les chiffres réellement produits sont dans
`sourceGeometry`, `trafficShell` et `trafficWheels` du manifeste. La fidélité d'une roue ne se vérifie pas seulement
par son nombre de triangles : comparer aussi son pivot, son orientation, son braquage et sa suspension entre les
niveaux de détail. La Zénith détaillée de Fair Value et ses variantes existantes sont recopiées par l'import de flotte.

Les remplacements utilisent `simplifyWithAttributes` avec normales, UV et indicateurs de surfaces. Une
simplification spatiale seule pouvait fusionner des sommets de chrome et de peinture puis interpoler entre leurs
cases d'atlas : les voitures de circulation semblaient alors froissées. Le test `car-surface-lod` reproduit cette
frontière sur un panneau dense. Il utilise la dépendance hors ligne `meshoptimizer` lorsqu'elle est installée.

## Niveaux de détail de la rue (`build-lods.mjs`)

L'import produit le modèle détaillé. `build-lods.mjs` en tire ce que la rue dessine, à partir des seuls `.bin`
(aucun GLB n'est nécessaire) :

| Niveau | Où on le voit | Budget |
| --- | --- | --- |
| `near` | la voiture conduite | 60 000 triangles de caisse et de vitres, 3 600 par roue |
| `mid` (`midShell`, `midWheels`) | toute voiture à moins de 30 m, garée ou en circulation | 22 000 + 4 × 1 400 |
| `traffic` (`trafficShell`, `trafficWheels`) | jusqu'à 64 m en circulation, 76 m en stationnement | 7 000 + 4 × 420 |
| `far` | au-delà | doublure de l'import, inchangée |

```sh
node tools/cars/build-lods.mjs                 # en place, sur assets/cars
node tools/cars/build-lods.mjs --in /tmp/overdraft-blue-chips --out assets/cars --only sedan,suv
```

Ce que fait l'outil, dans l'ordre :

1. **Les roues.** Une roue livrée braquée ou carrossée est remise d'équerre sur son essieu (l'essieu est la direction
   où la roue est la plus étroite) : sinon elle vacille à chaque tour. `WHEELS_FROM` fait rouler un modèle sur les
   jantes d'un autre, ramenées à son rayon, avec la correspondance des cases de nuancier (la source de l'Écume
   n'apportait pas de jantes : elle prend celles du Récif).
2. **Le niveau détaillé** est plafonné (`--no-cap` pour le garder entier), sans rien déplacer de plus de 3 mm sur
   la caisse et 6 mm sur une roue.
3. **La peau visible.** Caisse et vitres sont dessinées dans des tampons de profondeur depuis 49 points de vue
   autour et au-dessus de la voiture, vitres opaques. Un triangle qui ne gagne aucun pixel (siège, tableau de bord,
   moteur, dessous) est écarté. Un triangle vu de dos est retourné, un triangle vu des deux côtés est doublé : le
   matériau de la rue ne dessine qu'une face, et un toit modelé à l'envers disparaissait.
4. **La réduction** (`simplifyWithAttributes` de meshoptimizer) se fait à erreur absolue plafonnée : 12 mm pour
   `mid`, 60 mm pour `traffic`. Un niveau s'arrête au-dessus de son budget plutôt que de plier la carrosserie ; les
   modèles à facettes dépassent donc un peu. Les roues ont leurs propres poids : à ceux de la caisse, leurs arêtes
   vives interdisaient presque toute réduction.
5. Le `.bin` est réécrit sur les seuls sommets utilisés, et le manifeste reçoit `midShell`, `midWheels` et `lod`
   (triangles réellement produits par niveau).

À lancer une fois après un import. Relancé sur sa propre sortie (reconnue à `lod`), l'outil laisse le niveau
détaillé tel quel et reconstruit les niveaux de la rue.

Côté jeu, `withWheels()` (`js/car-assets.js`) assemble caisse et roues en un seul maillage par niveau ; les sommets
de chaque roue portent `FLAG.WHEEL + i`, et le matériau instancié les fait tourner et braquer à partir de l'attribut
`carPose` (rotation, braquage, tangage, roulis). `tests/car-visual-contract.test.mjs` vérifie les budgets, la
rondeur et l'équerrage des roues.

## Habitacles

`sourceInterior: true` indique que la cabine source se trouve déjà dans la carrosserie. C'est le cas de Tempête,
Marais et Falaise, ainsi que de Zénith. `cabinLayout` place le conducteur, le volant, les pédales et les instruments
fonctionnels ; dans les cabines source, le siège conducteur est aligné sur l'axe du volant. Zénith garde sa place centrale.
Les recettes peuvent fournir `sourceSeat` et `sourceRoof`, mesurés dans les coordonnées source avant miroir et
adaptation : ces points fixent l'assise et le vrai plafond intérieur, sans réutiliser les anciennes métadonnées génériques.

Les onze autres voitures utilisent les cabines génériques du jeu, recalées sur leurs nouveaux vitrages.
Les intérieurs source incompatibles sont retirés pour éviter deux volants ou deux tableaux de bord superposés.
Ces métadonnées sont visuelles et ne modifient aucun réglage de conduite. La visibilité de la route et des cadrans
reste à juger dans la vue cockpit réelle ; la présence d'un intérieur source ne suffit pas à garantir sa qualité.

## Vérifications hors ligne

Depuis la racine du projet :

```sh
node --test tests/car-import.test.mjs tests/car-fit.test.mjs tests/car-split-parts.test.mjs tests/car-visual-contract.test.mjs
```

Ces tests protègent notamment les normales transformées, les UV, le filtrage, la séparation des roues et l'égalité
des quinze châssis/réglages avec le contrat de référence. Les tests autonomes fonctionnent sans GLB source ni
bibliothèques de préparation. Après intégration de la flotte, compléter avec `npm test`, `npm run build` et le banc
Chrome ci-dessous. Aucun résultat d'une ancienne flotte ne remplace la validation des nouveaux fichiers.

## Banc de dynamique — Capital Gains

Sans dépendance, depuis la racine du jeu :

```sh
node tools/cars/benchmark-dynamics.mjs
node tools/cars/benchmark-dynamics.mjs --json --output /tmp/overdraft-dynamique.json
```

Utilise les dimensions réelles des quinze modèles pour mesurer le 0–100, le freinage 100–3 km/h sur sec/faible adhérence, la marche arrière et les écarts entre 20/30/60/144 Hz. Vérifie aussi pause/reprise, impact répété et récupération après retournement. `--baseline /chemin/car-physics.js` compare le coût CPU à un autre simulateur compatible. Les chiffres de performance CPU varient selon la machine et sa charge.

Les plaques, badges et cadrans originaux sont dessinés par le jeu au chargement (`car-assets.js`, `car-cabin.js`). Les voitures sans
freins source utilisent les géométries partagées de `car-details.js` ; la supercar conserve ses disques et étriers importés.

## Essai dans Chrome réel

Lancer un Chrome de test avec un profil séparé, sans toucher à l'onglet de jeu habituel :

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir=/tmp/overdraft-cars-qa-profile --remote-debugging-port=9334 --disable-gpu-vsync --disable-frame-rate-limit --enable-unsafe-webgpu
node tools/cars/qa-browser.mjs --visual-review --port 9334 --url 'http://localhost:5174/?qa=1&quality=balanced&architecte=0' --output /tmp/overdraft-cars-qa
```

Le serveur du worktree peut être lancé par `npm run dev -- --port 5174`. Le banc ouvre son propre onglet, isole ses sauvegardes en mémoire, instrumente les erreurs JavaScript **et les erreurs de compilation WebGPU dès le chargement**, puis choisit et conduit les quinze automobiles avec des entrées CDP réelles. Il ferme uniquement son onglet. `--output` conserve les captures et `rapport.json` ; la commande échoue si la simulation ou les shaders échouent. L'image reste à juger humainement en caméra de jeu. Remplacer `quality=balanced` par `quality=high` pour tester les reflets par volumes.

Avec `--visual-review`, le banc conserve les trois vues de jour de chacun des quinze véhicules : poursuite, avant
par C maintenu, puis vraie vue cockpit. Il rétablit la caméra poursuite après chaque modèle. Les erreurs de
compilation WebGPU sont surveillées dès le chargement, avant toute entrée en ville ; les captures doivent ensuite
être inspectées humainement. Le rapport ne constitue pas une analyse automatique de qualité de l’image.
