# OVERDRAFT

> Every debt gets paid.

Un jeu d'action en monde ouvert pour navigateur, dans un Manhattan reconstruit à l'échelle 1:1.
Version **0.9.31 — Carry Trade**.

À East Harlem, suivez la 119e Rue jusqu’à la **Halle au Poids**. Les habitants amènent des caisses, trient les pièces
et expédient les chargements. Approchez du comptoir avec **F** ou **Y** à la manette pour vendre vos trouvailles.
La rampe voisine mène au bulletin radio des **Fréquences**.

L’atlas (**M**) situe les six relais. À l’ouest, le Bouillon des Serres sert un repas chaud. À l’Atelier du Levant,
garez votre véhicule dans les pointillés pour le faire réparer. La Balance paie davantage en fin d’après-midi.
À la Cour des Récupérateurs, on peut acheter un lot de pièces. Les miradors donnent sur les cinq passages routiers,
qui ferment pendant les tempêtes. Entre ces relais, de petits abris s’occupent du linge, du courrier et de l’eau.

En local, `?spawn=lisieres` place le joueur au marché à 14 h. Essayez aussi `?spawn=serres`, `?spawn=atelier`,
`?spawn=balance`, `?spawn=vigie` ou `?spawn=cour`. Ces visites n’écrivent pas dans la sauvegarde.

Manhattan occupe désormais **27,7 km²** de terrain urbain, contre **42,8 km²** auparavant. La ville conserve son échelle,
Central Park, Midtown et le cœur du Financial District. Le Wasteland reprend **15 km²** sur les anciens quartiers de
rive. Les canaux extérieurs, îlots décoratifs, ponts, quais, bateaux à flot et voies rapides côtières ont disparu. Les
lacs de Central Park et les fontaines des quartiers conservés sont toujours dans la ville.

Ouvrez l’atlas avec **M**. Ses courbes de niveau montrent le lit de l’Hudson, les reliefs du Levant et la **Rade
Blanche**. Sur la route, partez de la **57e Rue Est** vers les silos du **Déversoir**, ou suivez **Delancey Street**
jusqu’au **Sprint des Failles**. **Broad Street** descend vers les balises de la Batterie. À l’ouest, la **34e Rue**
mène aux Pompes et au Cimetière des Coques. Au nord, la **Grande Porte** ouvre sur les ruines de Harlem.

L’Acte III se joue à terre et conserve la progression existante. La Ceinture reste la route des convois des Rouliers.
On peut toujours entrer sous les carcasses de béton et dans les cales des épaves échouées, dont le cargo bleu du
Cimetière des Coques. Hors des rues, les phares des voitures passent en pleins phares.

En local, `?spawn=deversoir`, `?spawn=failles`, `?spawn=batterie`, `?spawn=pumps` et `?spawn=nord` placent le joueur près
d’un accès. `?spawn=sel` démarre au pied de la descente des Pompes. Ces visites ne modifient pas la sauvegarde.

Depuis la **0.9.25 — Consumer Staples**, deux franchises de restauration ouvrent dans tout Manhattan : **BULLION**
(burgers, « La valeur refuge. », 36 succursales) et **TRANCHE** (pizza à la part, « Prenez votre part. », 54). On y
entre, on commande à la caisse, à la borne ou au guichet sur le trottoir, on attend son numéro, on porte son plateau,
on s'assoit où l'on veut et on mange (F) ; un vrai repas referme toutes les blessures pendant quelques minutes. À
emporter, les en-cas se gardent en poche et se mangent partout (U). Les équipiers cuisinent, encaissent, servent et
nettoient ; les clients viennent de la rue, font la queue, mangent, débarrassent et repartent. On peut aussi braquer
la caisse. Repères sur la carte et dans le téléphone (P → Contacts).

Depuis la 0.9.24, le pilotage est refait de fond en comble : un modèle de vol à corps rigide
(décrochage, effet de sol, facteur de charge, roues suspendues), une caméra de vol, un cockpit, des instruments,
des effets et un son propres aux avions. Deux appareils neufs sortent du garage (G) : la **Hauturier · Bourrasque**,
biplan d'école qui se pose sur une pelouse de Central Park et dessine ses loopings au fumigène, et la
**Corsaire · Tramontane**, chasseur à postcombustion qui passe le mur du son entre les tours. Le clavier suffit :
mains libres l'avion garde sa pente, et le palonnier seul (A / E) fait un virage propre. Les immeubles, le relief
et les plans d’eau du parc sont de vrais obstacles. Les figures (looping, tonneau, rase-mottes, atterrissage)
rapportent de l'argent. Les deux modèles sont sous CC BY 4.0 (voir `CREDITS.md`).

Les paramètres `?spawn=morningside`, `?spawn=lincoln` et `?spawn=columbia` lancent une visite à pied au jardin
de la 111e Rue, à la place Josie Robertson ou à Columbia. Le départ fixe l’heure à 14 h et la visite n’écrit pas
dans la sauvegarde.

La **0.9.23 — Free Float** permet de régler la densité de circulation depuis le menu pause.

La **0.9.22 — Circuit Breaker** a découpé le calcul initial de la circulation en tâches courtes pour
laisser le navigateur répondre pendant le chargement. Les recherches d'obstacles sont allégées et la découpe
côtière conserve les triangles qui ne touchent pas la route. Le plantage signalé au chargement n'a pas été
reproduit ; la préparation graphique reste coûteuse et le ralentissement global n'est pas déclaré résolu.

**Échap → Ambiance → Circulation** permet maintenant de choisir **Aucun, Faible, Moyen ou Dense**.
Le choix est mémorisé et s'applique dès la reprise, sans rechargement. Faible conserve environ un quart du trafic,
Moyen la moitié, Dense la quantité d'origine. Le réglage concerne les voitures et bus des rues et des voies rapides ;
les voitures garées, le véhicule du joueur et ceux des missions et poursuites restent présents.
Réduire la circulation allège réellement la simulation et le rendu. Le gain en images par seconde dépend de la scène ;
ce réglage ne réduit pas le coût des bâtiments, des piétons ou des voitures garées.

La **0.9.21 — Clearing** a repris les routes côtières : elles contournent les bâtiments, dégagent les trottoirs et partagent
leur tracé avec le trafic et le sol physique. Les quais et les rambardes de Battery soutiennent et arrêtent les voitures.

La **0.9.20 — Slippage** conserve ses commandes. À la manette Xbox : **A maintenu = frein à main**, **RB = nitro ou wheeling**,
**LT = frein puis marche arrière**. Un léger sifflement accompagne la marche arrière ; les pneus bloqués au frein
à main deviennent plus audibles et laissent plus tôt de petites traces et de la fumée.

La **0.9.19 — Growth Equity** a réuni les fonctionnalités précédentes. Les arbres sont refaits : huit essences, chacune jeune ou adulte, avec des
branches et un feuillage propres, l'espèce et le diamètre du recensement pour les arbres de rue, et le vent de la
météo dans les cimes. Les pieds et les pneus prennent appui sur les trottoirs et les pelouses à leur vraie hauteur ;
la circulation suit les contours des chaussées, et les murs de soutènement de Central Park et de Bryant Park
arrêtent les véhicules. Cette version réunit ces changements avec les armureries CALIBRE de la version précédente.

Pour essayer : marcher puis conduire sur le trottoir de Central Park, longer son muret, observer les arbres en
s'approchant, puis entrer chez CALIBRE.

La **0.9.18 — Dry Powder** a ouvert **48 armureries où l'on entre** : une vraie boutique dans un vrai
immeuble, un armurier derrière son comptoir, un mur d'armes sous un néon, et un stand de tir au fond. **F** devant le
comptoir : la caméra se pose sur la pièce présentée, avec sa fiche, ses munitions, ses **améliorations** (chargeur
étendu, silencieux, poignée, point rouge ou lunette, étrangleur) et ses **finitions**, visibles sur l'arme avant
d'acheter. Au stand, **F** à un pas de tir lance un parcours de six épreuves : les médailles paient une prime et font
baisser tous les prix. Menacer l'armurier est une mauvaise idée. La première succursale est sur la **5e Avenue, au coin
de la 37e Rue**, près du départ ; **P → Contacts → CALIBRE** guide vers la plus proche.

La **0.9.17 — Stop Loss** était une version de correctifs : les fumées de tir, de moteur et de pneus ne sortent plus en
carrés noirs en qualité HAUTE, et un véhicule qui explose laisse la carcasse de son propre modèle, bus compris.

La **0.9.16 — Green Shoots** a refait les parcs. Central Park a ses 70 km de sentiers réels, ses 110
affleurements de schiste et des pelouses qui savent où elles sont : drues et tondues sur Sheep Meadow, clairsemées et
jonchées de feuilles sous les arbres, en paille le long des allées, en boue au bord de l'eau.

La **0.9.15 — After Hours** a ouvert le jeu sur les quais de l’East River, avec un écran illustré et « La dette », un
thème original qui mêle cordes, cuivres et rythme hip-hop. L’écran reste en place jusqu’à votre choix.

La **0.9.14 — Ground Floor** a refait le sol de la ville : chaque chaussée connaît ses voies et s'use là où l'on
roule, les trottoirs sont des dalles coulées une à une derrière des bordures aux angles arrondis, et tout ce que New York
pose dans son sol y est, en relief : plaques d'égout, avaloirs, grilles du métro, trappes de cave, bandes podotactiles.

La **0.9.13 — Market Order** a apporté la manette Xbox : elle permet de jouer de l’écran titre jusqu’aux missions.
Maintenez **LT** pour viser, appuyez sur **RT** pour tirer, et tenez **LB** pour choisir une arme avec le stick droit.
Le menu **Commandes** donne les raccourcis. Voir aussi la section [Manette Xbox](#manette-xbox).

La **0.9.12 — Blue Chips** a refait les voitures. Quatorze des quinze voitures ont une nouvelle carrosserie, et la rue est enfin à leur
niveau : une voiture garée ou croisée dans la circulation garde la silhouette, les jantes, les plaques et les badges de
celle qu'on conduit. Les roues tournent et braquent, la caisse plonge au freinage sur des roues qui restent au sol.
Le menu pause est refait en quatre onglets (Partie, Graphismes, Ambiance, Commandes).

Pour voir la différence : longer une file de voitures garées, regarder passer la circulation de la 5e Avenue, puis
monter dans une voiture garée (**F**). **Échap** ouvre le nouveau menu.

La **0.9.11 — Short Squeeze** a mis les armes sur le corps : de vrais modèles, que Sacha sait porter. Pistolet à l'étui
sur la cuisse, fusil d'assaut et fusil à pompe en bandoulière dans le dos, pistolet-mitrailleur sous la veste. Il les
dégaine et les rengaine, les tient à une main quand la rue est calme, à deux quand ça chauffe, et les épaule pour viser.

Pour essayer : **clic droit** ou **X** dégaine et vise, **clic** tire. **TAB maintenu** ouvre la roue des armes (la rue
ralentit, on désigne, on relâche), **TAB bref** revient à l'arme précédente. Ensuite **R** pour recharger, **C** pour changer
d'épaule. La visée assistée amène le viseur sur l'ennemi le plus proche de l'axe quand on lève l'arme (**Y** la coupe).

La **0.9.10 — Price Action** avait posé le tir à l'épaule : recul amorti, dispersion qui récupère entre les rafales,
douilles et impacts persistants, canon et réticule qui convergent, pas de tir à travers un mur.

Les quinze voitures ont désormais une direction à géométrie Ackermann, des pneus progressifs, un freinage ABS et
une boîte adaptative. Peintures, freins, habitacles instrumentés, caméra et son ont été revus.

Comparez l’Écume (**G → 2**), la Tempête (**G → 3**) et la Zénith (**G → 5**).
Conduisez avec **ZQSD**, freinez puis reculez avec **S**, serrez le frein à main avec **Espace**.
**V** change de caméra et **C** permet de regarder derrière.
Dans le garage, les flèches parcourent la collection et **Entrée** prend le volant. Comparer aussi une traction Ressac,
un SUV Récif et le camion Fret. Le compteur, les témoins ABS/TC et les pédales montrent les signaux du simulateur.
Le niveau AAA et les 60 images/s stables restent à atteindre.

La **0.9.8 — Revaluation** apportait une ville éclairée selon ses vrais volumes, des façades plus profondes et des matériaux
plus lisibles. La visibilité du ciel est précalculée autour des 37 353 immeubles ; en qualité HAUTE, les voitures détaillées
reflètent leurs volumes, même hors écran. Les fenêtres proches reçoivent jambages et moulures, les monuments une pierre
taillée et des halls vitrés qui s'allument le soir. Le rendu élimine les objets trop loin et choisit le détail de chaque
voiture garée ; en ÉQUILIBRÉE, les ombres stables sont réutilisées entre leurs mises à jour.

Pour voir ce jalon : commencer sur la 5e Avenue de jour, marcher le long des façades, prendre une voiture avec **F**,
puis visiter Bryant Park et Downtown. La première mission a été contrôlée jusqu'à sa récompense. Les performances
restent variables dans les zones denses : les 60 images/s stables et le niveau artistique AAA restent des objectifs,
pas des résultats acquis. Protocole et limites : [CHANGELOG.md](CHANGELOG.md#validation-du-jalon-et-limites).

La **0.9.7 — Curb Appeal** avait refait la lumière, le menu et le vol d'ouverture, Sacha, l'entrée en voiture et les
chantiers de rue.

La **0.9.6 — Footfall** : la ville prend vie. 108 000 voitures garées le long de bordures redécoupées (voie de
stationnement, piste cyclable protégée, stationnement alterné), toutes volables et poussables ; le trottoir new-yorkais
d'après les registres de la ville (bouches d'incendie, arrêts et abris de bus, kiosques, arceaux et vélos, bancs,
bornes, parcmètres, 2 600 échafaudages, terrasses sur chaussée) et d'après les règles de la rue (panneaux, paniers,
boîtes à journaux, grilles de métro, colonnes sèches, portes de cave) ; une foule dont la densité suit le quartier et
l'heure, qui s'assoit, fait la queue, lèche les vitrines, sort des boutiques et des bouches de métro, monte dans les
bus et hèle les taxis ; des pigeons, des mouettes et des rats ; une nappe sonore de la ville ; et les petites histoires
de la rue (accrochage, contrôle de police, bouche d'incendie ouverte, camion poubelle, badauds autour d'un accident).

La **0.9.5 — Due Diligence** avait repris l'éclairage nocturne des personnages et poursuivi l'outil local Architecte 2.2
(prospection continue, trajets repris, voix coupée par défaut), toujours exclu de Vercel.

La **0.9.4 — Momentum** a refait la conduite pour le clavier (volant progressif, contrôle de stabilité, freiner en
tournant, vrai demi-tour au frein à main) et des voitures qu'on regarde : la rue se reflète dans la peinture, le héros est
assis au volant dans un habitacle, la caisse penche sur ses ressorts, vue intérieure à la place du conducteur.

Elle intègre aussi **Bricks & Mortar** : 37 000 immeubles habillés selon leur type réel (maison de ville, immeuble
ouvrier, loft, tour Art déco, tour de verre), leurs couleurs, fenêtres et corniches, leurs volumes en gradins et les
appuis de fenêtre en relief près du joueur.

La 0.9.3 a refait les rez-de-chaussée : 25 000 boutiques en relief, chacune là où New York en recense une vraie, avec son
enseigne, sa vraie pièce derrière la vitre, ses auvents, ses étals et son rideau de fer qui descend la nuit.

Depuis la 0.9 : Manhattan à la verticale, et un ciel qui se vole pour de vrai. Les 117 000 toits se parcourent, le grappin *Levier*
hisse jusqu'au rebord d'un immeuble ou accroche une voiture lancée, la wingsuit descend les avenues entre les
tours, et la police monte aussi (escaliers, équipes en rappel, tireurs d'élite). Toutes les armes dès le départ.
Avec trois actes d'histoire, un contrat sur les toits, cycle jour/nuit, météo, police à cinq étoiles, bateaux,
territoires et radio générée en temps réel.

La 0.9.2 a stabilisé les chocs entre voitures et ajouté l'Architecte, un outil expérimental de test et de correction
réservé au développement local, exclu du jeu publié.

Vision, niveau de recherche et feuille de route : [GAME_DESIGN.md](GAME_DESIGN.md).
Nouveautés : [CHANGELOG.md](CHANGELOG.md).

## Jouer

Navigateur de bureau récent avec accélération matérielle (Chrome ou Edge recommandés, WebGPU).
À l’écran titre, choisissez **Écouter le thème** si le navigateur attend un clic pour autoriser le son.
Une fois la ville prête, **Entrer dans la ville** lance la partie et **Menu principal** donne accès aux réglages.
Cliquez dans la vue pour verrouiller la souris ; Échap la libère et ouvre le menu.

### À pied

| Touche | Action |
|---|---|
| ZQSD / WASD / flèches | Se déplacer |
| Tab | Sélecteur d'armes (souris, pavé tactile ou clavier) |
| 1 à 7 | Choisir une arme directement (7 : le grappin) |
| G | Garage rapide : quinze voitures, à pied, moto, vélo, bateau, hélicoptère, biplan et jet |
| Souris | Regarder |
| Espace (maintenu) | Courir |
| Maj | Sauter ; face à un rebord à portée, l'escalader |
| E | Sortir le grappin *Levier* (ou le ranger) |
| Grappin en main | Clic droit pour viser, clic pour tirer : sur une façade (il hisse vers le toit), une voiture (pour la surfer), quelqu'un (pour l'arracher). Le viseur vire au citron quand le crochet mordrait |
| Clic gauche | Frapper / tirer |
| Clic droit (maintenu) | Viser à l'épaule |
| X | Activer/désactiver la visée sans maintenir le clic droit (pavé tactile) |
| C | Changer d’épaule à pied, arme à feu en main |
| R | Recharger |
| 1 à 7, molette | Choisir une arme (6 : grenades, clic pour lancer ; 7 : grappin) |
| F | Voler / monter dans un véhicule |

Pour essayer le nouveau tir : **2** pistolet, **3** mitraillette, **4** fusil à pompe, **5** fusil d’assaut.
Visez avec le clic droit ou **X**, changez d’épaule avec **C**, tirez puis rechargez avec **R**.
Les rafales courtes sont plus précises ; le réticule devient ambré si un obstacle bouche le canon.

### Dans les airs et sur les toits

| Situation | Touches |
|---|---|
| Chute libre | Espace ou Maj : wingsuit (elle s'ouvre seule si l'on saute en courant), F parapente, ZQSD se déplacer |
| Wingsuit | La souris dirige : le corps vole là où l'on regarde. Z piquer, S cabrer, Q/D virer, F parapente. Frôler les façades rapporte |
| Parapente | La souris dirige aussi. Q/D frein gauche/droit, S les deux (ralentir, arrondir à l'atterrissage), Z accélérateur, F larguer la voile |
| Pendu à une façade | Clic : grappin plus haut, Maj sauter, Z grimper (sous le rebord), S lâcher |
| Sur le toit d'une voiture | F prendre le volant, Maj sauter, clic droit + clic tirer |
| Au bout du grappin | Maj lâcher avec l'élan |

Un hélicoptère se pose sur n'importe quel toit ; F en sort sans sauter.

### En voiture

| Touche | Action |
|---|---|
| ZQSD / WASD | Accélérer, freiner, tourner |
| Hélicoptère | Z/S avancer, Q/D pivoter, Espace monter, C descendre, F sauter |
| Avion | Z/S piquer ou cabrer, Q/D roulis, A/E palonnier (virage facile), Espace et C pour les gaz, Maj postcombustion (jet) ou pleins gaz (biplan), Ctrl freins, X train (jet) ou fumigène (biplan), V caméra et cockpit, F sauter en parachute |
| Espace | Frein à main |
| Clic droit + clic gauche | Tirer par la vitre (pistolet, pistolet-mitrailleur) |
| Maj (moto) | Wheeling |
| T / Maj+T | Station de radio suivante / précédente |
| B | Klaxon |
| R | Remettre le véhicule d'aplomb (à l'arrêt) |
| F | Descendre (à l'arrêt) |

### Partout

M : carte (un clic place un point de passage) · V : caméra · Entrée : passer un dialogue ·
H : masquer l'interface · N : couper le son · Échap : pause.

### Manette Xbox

LS et RS désignent les sticks gauche et droit. L3 et R3 désignent leur clic. La croix et le stick gauche naviguent
dans les menus. **A** valide, **B** revient, **LB / RB** changent d’onglet dans la pause. Le stick droit défile.

| Situation | Commandes |
|---|---|
| À pied | LS déplacement, RS caméra, A tenu sprint, X saut, Y interaction ou véhicule |
| Armes | LT dégainer et viser, RT tirer ou frapper, B recharger, LT + R3 changer d’épaule, L3 régler la visée assistée |
| Arsenal | LB bref arme précédente, LB tenu roue. RS désigne une arme, relâcher LB valide, B annule |
| Grappin et vol libre | RB sortir ou ranger le grappin, RT le tirer. X sauter, ouvrir la wingsuit en chute libre ou lâcher le grappin. Y ouvrir ou larguer le parapente, LS et RS dirigent |
| Au volant | LS direction, RT accélérateur, LT frein puis marche arrière, A frein à main, RB nitro ou wheeling, L3 klaxon, R3 regarder derrière, B remettre le véhicule d’aplomb à l’arrêt, Y descendre |
| Tir embarqué | Tenir X pour viser par la vitre, RT pour tirer, B pour recharger. X sort le pistolet si l’arme en main ne convient pas |
| Avion | LS piquer, cabrer et roulis, RT / LT gaz, LB / RB palonnier, A postcombustion ou pleins gaz, B freins, X train (jet) ou fumigène (biplan), Y sauter ou descendre |
| Hélicoptère | LS piloter, RT / LT monter ou descendre, Y quitter |
| Partout | ↑ téléphone, ↓ carte, View bref caméra, View tenu garage, Menu pause, A passer les séquences de mission |
| Radio (à bord) | ← / → station précédente / suivante |
| Carte | LS déplacer, LT / RT dézoomer / zoomer, A placer un repère au centre, X recentrer, B fermer |

## Dans la ville

- **Marqueurs verts** : missions d'histoire. **Orange** : courses, convoyages, primes.
- Près du départ, sur la 5e Avenue : la **Course des toits** (39e Rue), la **Descente** en wingsuit (42e Rue) et,
  sur la 6e Avenue, le contrat **Effet de levier** de Jules.
- **Pastille au pistolet** (laiton sur vert) : les 48 armureries *Calibre* (munitions, améliorations, finitions,
  grenades, gilets, stand de tir).
  On y entre à pied ; **F** au comptoir, **F** à un pas de tir. **Violet** : carrosserie *Éclair*
  (réparation et peinture ; une nouvelle couleur fait perdre la police si elle ne vous voit pas entrer).
- **Vert** : planques. Achetez-les, dormez-y (8 heures passent, santé complète) et sauvegardez.
- L'heure tourne (une journée dure environ 32 minutes) et la météo change : la pluie mouille les
  rues et réduit l'adhérence. Le menu pause permet de choisir l'heure et de fixer la météo.
- Des motos sont garées près du départ, du garage, de l'East Village, de Harlem et du Village.

## Le niveau de recherche en bref

Les crimes vus par des témoins vous valent des **étoiles** (une à cinq). La police fouille les rues
autour de votre dernière position connue (zone rouge sur la carte) ; les étoiles clignotent tant
qu'elle ne vous voit pas. Sortez de la zone et restez hors de vue pour la semer. Mort : « FLATLINED »,
réveil à l'hôpital. Arrestation : « CUFFED », sortie du commissariat avec une caution et des
munitions confisquées.

## Développer

Node.js 22 ou plus récent. Aucune installation de dépendances pour le jeu : Three.js est inclus dans `vendor/`.

```sh
npm run dev
```

Ouvrir http://localhost:5173. Paramètres utiles :

- `?stats=1` : moteur graphique, images par seconde et millisecondes par système.
- `?quality=high|balanced|fluid` : niveau graphique (`balanced` par défaut, réglable dans le menu Échap).
- `?renderer=webgl` : mode de compatibilité.
- `?debug=1` : un clic sur la carte téléporte le joueur.
- `?qa=1` : expose `window.__game` pour les tests automatisés.
- `?spawn=fdr` (local uniquement) : ancien lien d’essai, redirigé vers l’approche du Déversoir en Ressac, à midi ; la sauvegarde habituelle reste intacte.

Le [contrôle des routes côtières](tools/highways/README.md) fournit aussi un tour reproductible des deux rives,
avec captures, contrôle du sol et des collisions, et essais des rambardes. Les portails de Battery restent fermés
au joueur et certaines grandes portions de parc restent à aménager.

```sh
npm test
npm run build
```

Pour vérifier le réglage de circulation, lancer un Chrome de test sans fenêtre, avec un `--user-data-dir` distinct,
`--remote-debugging-port=9347 --disable-gpu-vsync --disable-frame-rate-limit`, puis
`node tools/qa-traffic.mjs 9347 /tmp/overdraft-traffic-qa high` (ou `balanced`). Le script ouvre son propre onglet,
utilise les vraies entrées clavier/souris CDP, coupe la manette dans cet onglet et laisse les captures et mesures
dans le dossier indiqué. Le profil Chrome doit être réservé aux tests : il mémorise des préférences de test.

Le build statique est généré dans `dist/`. `tools/radio-preview.html` permet d'écouter les stations.

Pour jouer en ligne, importer le dépôt dans Vercel : `vercel.json` fixe le build (`npm run build`, sortie `dist/`, pas
d'installation) et les en-têtes de sécurité. Chaque push sur `main` redéploie la production.

### L'Architecte, en local

L'Architecte parcourt la même partie que le joueur, prend des captures et propose des tickets à valider. Son serveur et
sa salle de contrôle se lancent avec `npm run architecte` ; sa dépendance est installée au premier lancement. Les consignes,
les réglages et le lancement sont décrits dans [ARCHITECTE.md](ARCHITECTE.md) et [le guide du serveur](tools/architecte/README.md).

Ses modules ne sont chargés qu'en local et ne sont pas copiés dans `dist/`. `?architecte=0` permet de jouer en local sans
lui. La clé API reste dans `.env.local` et ses données dans `chantier/`, tous deux ignorés par Git.

L'outil local est en **v2.2** : prospection continue, œil indépendant, expériences mesurées, mémoire durable et contrôle strict des validations,
des preuves de correction et du budget. Les commandes de vérification reproductibles sont dans le guide du serveur.
Le trafic des expériences reste vivant ; les mesures perturbées doivent être reprises. Son aptitude à trouver seul des
défauts inconnus à l'échelle de toute la ville reste à mesurer sur des séances longues.

## Architecture

| Module | Rôle |
|---|---|
| `js/gameplay.js` | Couche de jeu : joueur, armes, dégâts, véhicules, mort, arrestation, sauvegarde |
| `js/wanted.js` | Niveau de recherche : étoiles, zone de recherche, poursuites, agents, hélicoptère |
| `js/vertical.js` | Grappin, rebords, surf sur les voitures, chute libre et wingsuit, frôlements |
| `js/wingsuit.js` | Modèle de vol de la wingsuit et toile tendue sur le squelette |
| `js/roof-police.js` | Police sur les toits : escaliers, rappel depuis l'hélicoptère, tireurs d'élite |
| `js/missions-sky.js` | Course des toits, Descente, contrat Effet de levier, anneaux |
| `js/ai-driver.js` | Pilote IA (itinéraire, poursuite pure, virages, évitement) pour la police et les missions |
| `js/atmosphere.js` | Heure du jour, météo, pluie, éclairs et tonnerre |
| `js/shops.js` | Carrosseries, planques, ouverture du comptoir des armureries |
| `js/calibre-plan.js`, `js/calibre.js` | CALIBRE : implantation des 48 succursales dans les immeubles, plan d'une succursale, personnel, alarme |
| `js/calibre-room.js`, `js/calibre-build.js`, `js/calibre-prints.js`, `js/calibre-kit.js` | La succursale : décor, lampes, affiches et enseignes, objets numérisés (`assets/calibre`) |
| `js/calibre-counter.js`, `js/calibre-range.js` | Le comptoir (fiches, achats) et le stand de tir (épreuves, médailles, remises) |
| `js/weapon-mods.js`, `js/weapon-attachments.js` | Améliorations et finitions des armes : effets, accessoires visibles |
| `js/motorbike.js` | Motos (modèle, inclinaison, wheeling) |
| `js/quick-strip.js` | Bouton et bandeau communs au garage et au sélecteur d'armes |
| `js/garage.js`, `js/arsenal.js` | Garage rapide, sélecteur d'armes |
| `tools/world/` | Prépare les textures de la ville et importe les objets de rue dans `assets/world/` |
| `tools/nature/` | Prépare les textures d'herbe dans `assets/nature/` |
| `tools/trees/` | Prépare les écorces et le feuillage, génère les arbres et leurs vues lointaines dans `assets/trees/`, et les données du recensement dans `js/tree-geodata.*` |
| `tools/people/` | Importe les avatars, les armes et la motion capture Rocketbox dans `assets/people/` |
| `tools/build-humans.mjs`, `tools/humans/` | Sculpte les accessoires de la foule dans `assets/humans/` |
| `js/characters.js`, `js/person-body.js`, `js/person-motion.js` | Personnages : squelette, motion capture, tenue des armes |
| `js/mocap.js`, `js/crowd-motion.js` | Lecture de la motion capture, poses de la foule |
| `js/people-assets.js`, `js/people-material.js`, `js/human-crowd.js` | Chargement des modèles, matières, rendu de la foule |
| `js/trees.js`, `js/tree-assets.js`, `js/tree-materials.js`, `js/tree-levels.js` | Arbres : chargement, plantation, matières et niveaux de détail |
| `js/grass.js`, `js/nature-assets.js` | Brins d'herbe et textures d'herbe |
| `js/world-assets.js`, `js/street-clutter.js` | Surfaces de la ville, objets de rue |
| `js/ragdoll.js` | Chutes physiques des corps |
| `js/flight.js` | Modèle de vol à corps rigide des avions (aucune dépendance) |
| `js/aviation.js`, `js/aircraft.js`, `js/aircraft-assets.js` | Pilotage, dégâts et figures ; les deux appareils ; chargement de leurs modèles (`assets/aircraft`, `tools/aircraft`) |
| `js/flight-fx.js`, `js/flight-instruments.js`, `js/audio-flight.js` | Effets de vol, instruments et viseur tête haute, son des avions |
| `js/quality.js` | Niveaux graphiques, rythme des images, résolution adaptative |
| `js/actors.js` | Personnages armés (police, équipages, cibles) |
| `js/architect*.js`, `js/repro-link.js`, `tools/architecte/` | Testeur, capteurs, tickets et atelier ; développement local uniquement |
| `js/weapons.js` | Catalogue d'armes et balistique (lancer de rayons sur la ville) |
| `js/navigation.js` | A* sur le réseau routier (GPS, IA) |
| `js/missions.js`, `js/mission-director.js` | Scripts de missions (générateurs), marqueurs, objets |
| `js/fx.js` | Particules, traceurs, explosions, débris, lumières dynamiques |
| `js/characters.js` | Personnages skinnés individuels et armes tenues |
| `js/hud.js`, `css/hud.css` | Interface en jeu |
| `js/radio.js` | Radio procédurale (Web Audio) |
| `js/audio-combat.js` | Sons de combat et d'interface synthétisés |

La ville, le trafic, les piétons, l'éclairage et le rendu viennent de Slop New York.

## Sources et licences

[CREDITS.md](CREDITS.md), [LICENSE](LICENSE) et [README original](UPSTREAM.md).
Slop New York : https://github.com/mrdoob/slop-newyork
