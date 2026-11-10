# Changelog

## 0.9.17 — Stop Loss — 10 novembre 2026

Version de correctifs.

- **Les carrés noirs à chaque tir, chaque choc et chaque dérapage ont disparu.** En qualité HAUTE, la fumée des armes,
  des moteurs abîmés et des pneus sortait en boîtes noires floues qui cachaient l'action. La cause : avec les reflets
  actifs, la scène écrit aussi la direction de chaque surface, et les particules y écrasaient celle du décor sur tout
  leur carré ; l'occlusion ambiante assombrissait ensuite ce carré. La qualité ÉQUILIBRÉE n'était pas touchée.
- Le même défaut est corrigé pour tous les effets : flashs, étincelles, traînées de balles, impacts et trous de balles,
  marques de pneus, pluie, lasers, balises de mission, traînées de vol, disques d'hélice.
- **Une voiture qui explose reste elle-même.** Toute épave devenait la même berline calcinée, même celle d'un bus.
  Un taxi brûle maintenant en taxi, un pick-up en pick-up, un bus en bus : les quinze modèles et le bus de la ville ont
  chacun leur carcasse, à la même place et dans le même sens. Peinture partie en suie et en rouille, vitres noircies,
  feux éteints, pneus en croûte noire, caisse affaissée.
- Jusqu'à six carcasses restent dans la rue (quatre avant) ; la plus ancienne s'en va à la septième. On ne traverse
  plus à pied les extrémités d'une carcasse de bus.
- Les effets déclarent maintenant qu'ils ne sont pas des surfaces (`js/effect-outputs.js`). Un oubli est rattrapé au
  chargement, puis en continu pendant la partie (quelques centaines d'objets par image), et signalé dans la console.

## 0.9.16 — Green Shoots — 10 novembre 2026

Les parcs. Central Park n'était qu'une moquette vert fluo traversée de rubans bleu marine. Il a maintenant ses
sentiers, ses rochers et un sol qui change avec ce qui s'y passe. Les autres pelouses de la ville suivent.

### Central Park

- **70 km de sentiers réels** (OpenStreetMap, 1 167 tronçons) : bitume pour la plupart, terre battue pour la piste
  cavalière et les pistes des bois. Les arbres s'écartent de leur tracé et leurs couronnes se rejoignent au-dessus.
- **110 affleurements de schiste réels**, d'Umpire Rock aux rochers sans nom : chacun est un dos de baleine laissé par
  le glacier, à sa place et à sa taille, avec lichen, mousse et paillettes de mica. Ils remplacent cinq blocs
  anguleux. On ne les traverse plus.
- **Les allées carrossables** sont dans le bitume des rues, avec leurs lignes peintes. Les transversales ont leur
  double ligne jaune.
- **Plus de bord tracé à la règle** : un accotement de terre et de gravillons longe chaque allée, une bande de boue et
  de galets chaque berge. L'herbe les grignote.

### Les pelouses

- **Le parc se connaît** : une carte de 2 m de côté par case dit, pour tout Central Park, où les arbres font de
  l'ombre, où passent les allées, où est l'eau et quelles pelouses sont entretenues. Elle est calculée au chargement,
  à partir des arbres réellement plantés.
- **L'herbe en dépend.** Drue et tondue en bandes sur Sheep Meadow et la Great Lawn. Clairsemée sous les arbres, où
  chaque tronc se tient dans son cercle de terre et de feuilles mortes. En paille le long des allées et autour des
  rochers, là où tout le monde marche. En boue au bord de l'eau.
- **Des verts naturels** à la place du vert fluo : herbe grasse, herbe sèche, trèfle, par plaques de toutes tailles.
- **Un relief dans la lumière** : le sol reste plat, mais son ombrage ondule comme un terrain vallonné.
- **Les brins d'herbe** prennent la couleur et la vigueur de la pelouse où ils poussent : courts sur une pelouse
  tondue, absents sur la terre nue.
- Les squares, Bryant Park, les quais et les terre-pleins prennent la même herbe, sans la carte : ils devinent.

### Sous le capot

- `js/park-plan.js` (carte du parc, rubans, berges, rochers) est pur et testé dans `tests/park-plan.test.cjs`.
  `js/park-ground.js` fabrique les maillages, `js/park-materials.js` les matériaux.
- `tools/build-geodata.mjs` ajoute les sentiers et les rochers à `js/nyc-geodata.js` (+110 Ko). Le reste du
  fichier est régénéré à l'identique.
- Trois photos de plus dans `assets/ground` (terre, feuilles mortes, roche), livrées sans carte de normales ; celle
  de l'ancienne pelouse est retirée. 0,7 Mo de plus au total.
- Coût mesuré dans la page, pelouse contre aplat de couleur sur trois vues : 0,2 ms au plus.

### Limites connues

- Le parc reste plat : les rochers sont des bosses posées sur un sol horizontal, et on bute dessus au lieu d'y grimper.
- La nuit, le parc est noir : ses lampadaires n'éclairent pas encore le sol.
- Pas de bancs ni de lampadaires le long des nouveaux sentiers, et les passants n'y marchent pas.
- Les petits ponts des sentiers ne sont pas construits : le chemin s'arrête au bord de l'eau et reprend en face.
- Hors de Central Park, les pelouses ne savent pas où sont leurs arbres.

## 0.9.15 — After Hours — 10 novembre 2026

- **Écran d’ouverture.** Sacha Roux sur les quais de l’East River, sous la pluie, avec le pont de Brooklyn et Manhattan à l’horizon. L’illustration reste à l’écran pendant le chargement et jusqu’au lancement de la partie ou à l’ouverture du menu principal.
- **« La dette ».** Un thème stéréo original de 55 secondes à 88 BPM, construit autour d’un motif de piano et de cordes sur un rythme hip-hop. Le thème se lit en boucle et s’efface en fondu à la sortie de l’écran titre. Le bouton audio permet de l’écouter quand le navigateur attend une interaction.

## 0.9.14 — Ground Floor — 10 novembre 2026

Le sol. Chaussées, trottoirs et bordures de toute l'île sont refaits autour d'une règle : l'usure suit l'usage. Le sol
n'est plus un aplat de bruit, il sait où sont les voies, les lignes de stop et les bordures. Rue témoin : la 5e Avenue
à la 37e Rue, là où la partie commence. Les parcs et les pelouses ne sont pas dans cette version.

### La chaussée

- **Chaque chaussée connaît ses voies**. Le réseau routier est découpé en bandes (voies, stationnement, piste cyclable,
  carrefours) posées sur le tablier de l'île. Dans chaque voie, les pneus polissent deux traces claires, l'huile
  assombrit le milieu et s'épaissit à l'approche du stop, la gomme marque le freinage.
- **Trois bitumes photographiés** se mélangent selon l'âge du tronçon : enrobé neuf, bitume vieilli à gros grain, vieux
  liant aux gravillons apparents. Une photo aérienne de 30 m casse la répétition.
- **Rustines et tranchées** alignées sur la rue, à bords sciés et scellés au goudron, neuves ou anciennes. Fissures et
  serpents de goudron dans les tronçons usés, joints de reprise entre deux passes de finisseur.
- **Couloirs de bus rouges** sur les 1re, 2e, 3e, 5e Avenues, Madison et Lexington : la peinture s'use là où passent les
  roues, avec « BUS ONLY » au sol.
- **Stationnement** : sol plus sale, gouttes d'huile au rythme des capots.
- **Caniveaux** : la crasse, la poussière et les débris suivent chaque bordure, et l'eau y stagne après la pluie.
- **Peinture routière écaillée** : les lignes ne pâlissent plus, elles partent par plaques.

### Trottoirs et bordures

- **Angles arrondis** sur tous les îlots, rayon de 2,4 m. Le joueur et les voitures suivent la nouvelle bordure.
- **Bordures profilées** : granit taillé ou béton à nez d'acier rouillé selon l'îlot, joints, crasse au pied, traces de
  pneus sur la face.
- **Un trottoir en lots**, comme à New York où chaque propriétaire refait le sien : tous les 8 à 20 m le dallage
  change, séparé du voisin par un joint de dilatation noir. Cinq dallages : dalles grises de 5 pieds, les mêmes en
  vieux (sombres, tachées, fissurées, soulevées), béton neuf et pâle, béton teinté anthracite scié en demi-dalles,
  pierre bleue en grandes dalles à joints décalés.
- **Bande de pavés de granit** le long de la bordure sur la moitié des îlots, là où se tiennent poteaux et bouches
  d’incendie ; bande de béton sombre sur quelques autres.
- **Rustines de trottoir** : rectangles de béton frais ou d’asphalte laissés par les concessionnaires.
- **Chaque dalle** a son ton et son morceau de photo. Taches, coulures et chewing-gums s’épaississent vers la bordure.
- **Jusqu’à la limite de propriété** : le trottoir public va de la bordure au lot (5 à 6 m), le parvis privé au-delà
  garde son propre dallage.
- **Les trappes noires devant les boutiques ont disparu** : c’étaient des plaques qui reflétaient la rue sombre.
- **Fosses d'arbres** : terre battue et entourage de granit, grille en fonte sur les avenues.

### Posé dans le sol

- **Plaques d'égout en relief** dans les voies et les carrefours : quatre modèles, aux noms de fonderies du jeu.
- **Avaloirs** au bout des caniveaux, plaques de regard, bouches à clé, chambres de tirage des feux.
- **Grilles d'aération du métro** et **trappes de cave** en tôle larmée, aux emplacements que la 0.9.6 tirait déjà des
  registres de la ville. Elles remplacent les rectangles sombres.
- **Bandes podotactiles** rouges ou jaunes aux angles, face aux passages piétons.
- **Marquages** : flèches de voie avant les feux des avenues, marques de bombe des concessionnaires, taches d'huile,
  traces de freinage, fissures scellées.

### Lumière

- **Rebond des façades** : au fond d'une rue, le sol à l'ombre n'est plus éclairé par le seul ciel bleu. Il reçoit la
  lumière chaude renvoyée par les immeubles, d'autant plus que le ciel est caché.

### Sous le capot

- `js/ground-plan.js` (contours arrondis, anneaux de bordure et de trottoir, bandes de chaussée) et
  `js/ground-dressing.js` (ce qui est posé dans le sol) sont purs et testés dans `tests/ground-plan.test.cjs`.
  `js/ground.js` fabrique les maillages, `js/ground-materials.js` les matériaux.
- `tools/ground` télécharge et prépare les photos (Poly Haven, CC0), calcule les masques d'usure et dessine les deux
  atlas d'objets et de marquages à partir de cartes de hauteur. 7,4 Mo de textures.
- L'ancien sol est retiré : ses quatre matériaux procéduraux (450 lignes de shader) et les deux photos qu'ils étaient
  seuls à utiliser, soit 1 Mo de moins à télécharger.
- Coût mesuré dans la page, ancien sol et nouveau sol alternés sur trois vues à échelle fixe : 18,7 ms contre 18,9,
  19,0 contre 19,0 et 20,6 contre 20,9. Pas d'écart.

### Limites connues

- Les bordures restent à pleine hauteur aux angles : pas encore de bateau sous les bandes podotactiles.
- Pas de crasse au pied des façades : le sol ne sait pas encore où chaque immeuble commence.
- Les rues à une voie sans stationnement tracé montrent peu d'usure de voie.
- Parcs, pelouses et allées n'ont pas bougé. Les places et les trottoirs des parcs prennent la nouvelle matière, sans
  la crasse de bordure.
- La pluie et la nuit gardent leur rendu d'avant : pas encore de vrais reflets de phares sur le sol mouillé.

## 0.9.13 — Market Order — 10 novembre 2026

- **Manette Xbox de bout en bout**. LT dégaine et vise, RT tire, B recharge. LB ouvre la roue des armes au stick droit
  ou rappelle l’arme précédente. A sprinte, X saute, Y interagit et RB sort le grappin.
- **Au volant**, RT accélère, LT freine et RB déclenche le frein à main. X maintenu passe en visée embarquée et RT
  tire. Le klaxon, la radio, le regard arrière, le nitro et le wheeling ont leurs boutons.
- **Interfaces** utilisables à la manette. Partie, pause, téléphone, garage, boutiques et carte avec repère au centre.
  Les indications en jeu changent avec la dernière source de commande. Un changement de contexte ou une déconnexion
  annule les gâchettes et les actions maintenues.

## 0.9.12 — Blue Chips — 10 novembre 2026

Les voitures. Quatorze carrosseries neuves, et surtout une rue à leur niveau : une voiture garée ou croisée dans la
circulation n'est plus une version dégradée de celle qu'on conduit. Le menu pause est refait.
Cette version réunit sur `main` la branche `codex/automotive-overhaul` (flotte, habitacles, menu pause) et le travail
fait par-dessus sur les voitures de la rue.

### La flotte

- **Quatorze carrosseries remplacées** à partir de douze modèles libres (CC BY 4.0), crédités un par un dans
  `CREDITS.md` et `assets/cars/LICENSE-cars.md` : berline, sportive, muscle, citadine, compacte, break, SUV, 4×4,
  pick-up, monospace, taxi, deux fourgons et camion. La Zénith est restaurée (intérieur d'origine, volant animé,
  étriers séparés des roues). Emblèmes, plaques et inscriptions des sources retirés ; les marques visibles en jeu
  restent Valmont, Brisant, Gréville, Hauturier et Corsaire.
- **La conduite ne change pas** : les quinze châssis, leurs dimensions physiques et leurs réglages sont ceux de la
  0.9.10, vérifiés par un contrat de test.
- **Habitacles** : intérieur d'origine pour Tempête, Marais, Falaise et Zénith ; cabines du jeu recalées sur les
  nouveaux vitrages pour les onze autres. Le plan rapproché de la caméra s'adapte en vue cockpit.
- **Import reproductible** (`tools/cars`) : recettes par famille, adaptation aux châssis verrouillés, registre de
  provenance avec empreintes des fichiers.

### Les voitures de la rue

Le défaut de la branche : chaque voiture n'existait qu'en deux versions, la détaillée (celle qu'on conduit) et une
réduction automatique à 6 000 triangles pour tout le reste, dont les panneaux se déchiraient. Il n'y avait rien entre
les deux, et la circulation prêtait à toutes les voitures les roues de la berline.

- **Un niveau pour les voitures proches.** À moins de 30 m, garée ou en circulation, une voiture est dessinée avec
  jusqu'à 22 000 triangles de carrosserie et de vraies roues : la silhouette, les arêtes, les optiques et les jantes
  du modèle détaillé. Plus loin (jusqu'à 64 m en circulation, 76 m en stationnement), un niveau reconstruit de 7 500
  à 20 000 triangles remplace l'ancienne réduction. Au-delà, la doublure existante.
- **Seulement ce qui se voit.** Ces niveaux ne gardent que la peau visible de l'extérieur, relevée depuis 49 points de
  vue : sièges, tableau de bord, moteur et dessous de caisse ne coûtent rien à une voiture qu'on ne conduit pas. Les
  panneaux modelés à l'envers dans les sources (le toit du pick-up disparaissait) sont retournés.
- **Chaque voiture roule sur ses propres roues**, garée, en circulation ou bousculée. Elles tournent, les roues avant
  braquent, et la caisse plonge au freinage ou penche après un choc sur des roues qui restent au sol. Caisse et roues
  ne font qu'un seul objet par voiture : c'est le matériau qui les anime, sans appel de dessin supplémentaire.
- **Les plaques et les badges** apparaissent enfin sur les voitures de la rue. Ils étaient projetés au mauvais
  endroit (le long de Manhattan au lieu du long de la carrosserie) : aucune voiture garée ou en circulation n'en avait.
- **Des roues rondes.** La berline arrivait sans jantes, avec des roues étirées en œuf (49 cm dans un sens, 26 dans
  l'autre), et c'étaient elles que la circulation montait sur toutes les voitures. L'Écume roule désormais sur les
  jantes du Récif, ramenées à son rayon. Les roues avant du Galet et de la Zénith étaient livrées braquées (12° et
  26°), celles du Cab 7 carrossées de 6° : elles vacillaient à chaque tour, y compris sur la voiture conduite. Toutes
  sont remises d'équerre sur leur essieu.
- **Le taxi a retrouvé ses jantes** : son disque de frein se plaçait devant les rayons et les cachait. Les disques
  se règlent maintenant sur la profondeur des rayons de chaque roue.
- **Le modèle détaillé est plafonné** quand une source est plus lourde que nécessaire (60 000 triangles de caisse,
  3 600 par roue, rien déplacé de plus de 3 mm) : le 4×4 passe de 246 000 à 98 000 triangles, la berline de 150 000
  à 71 000. Les fichiers des voitures passent de 60 à 41 Mo (ils pesaient 7 Mo en 0.9.11, avant la nouvelle flotte).
- **Outil** `tools/cars/build-lods.mjs` : reconstruit tous les niveaux à partir des fichiers livrés, sans les sources.

### Menu pause

- **Quatre onglets** : Partie, Graphismes, Ambiance et Commandes, avec de grandes zones de clic pour le pavé tactile.
- **Qualité graphique** : trois cartes comparent HAUTE, ÉQUILIBRÉE et FLUIDE ; le choix ne s'applique qu'avec
  **Appliquer**, qui sauvegarde puis recharge une seule fois.
- **Ambiance** : son, heure, météo et écoulement du temps en choix directs.
- **Clavier** : Tab et Maj+Tab parcourent, les flèches changent d'onglet, Échap reprend. Une nouvelle partie demande
  confirmation.
- **Commandes** à jour des armes de la 0.9.11 (roue des armes, visée fixe, épaule, visée assistée).

### Aussi

- **Caméra à pied** : une voiture arrêtée contre le dos du joueur ne s'installe plus dans l'image, la caméra passe
  au-dessus de son toit.

### Validation

`npm test` : **861 tests, 859 réussis, 1 ignoré, un échec attendu** (`tree-geodata`, licence Xcode non acceptée sur
cette machine). **Le build de production passe.**

Dans un Chrome à part (WebGPU, sans fenêtre, touches réelles), sans erreur JavaScript ni WebGPU : voitures garées vues
de près (roue, avant, arrière) puis prises ; circulation de jour et de nuit, de face et de dos ; berline, Zénith, taxi,
Galet, monospace, SUV et muscle car conduites, roues en vue ; pose des roues et de la caisse contrôlée image par image.
Le banc du menu pause passe ses **121 contrôles**. Le scénario de tir de la 0.9.11 et la roue des armes au TAB
maintenu repassent sans changement.

**Ce qui n'est pas vérifié ou reste faible :**

- **Performances non mesurées proprement.** La machine était occupée pendant les essais (le jeu tournait dans un autre
  Chrome). Avant le travail sur les roues, à résolution fixée, la version réunie donnait 51 à 58 images par seconde là
  où la branche en donnait 55 à 61 ; depuis, la circulation dessine moins de triangles (ses roues en coûtaient 8 000
  pièce). Les voitures de la rue pèsent environ 1,3 million de triangles par image, dont près de la moitié pour les
  doublures lointaines (1 200 triangles chacune, 450 voitures) : c'est la prochaine économie à faire.
- Les étriers de frein tournent avec la roue sur les voitures de la rue (ils font partie de la roue dans plusieurs
  sources).
- Les phares des voitures garées restent des aplats clairs de jour, sans volume.
- Les conducteurs de la circulation ne sont pas visibles.
- Les ombres des voitures de la rue ne suivent ni le braquage ni l'inclinaison de la caisse.
- Les silhouettes viennent de modèles de voitures réelles : marques et inscriptions sont retirées, mais les lignes
  restent reconnaissables.
- Missions, poursuites longues et manette n'ont pas été rejouées pour cette version.

## 0.9.11 — Short Squeeze — 9 novembre 2026

Le tir à la troisième personne refait autour de quatre choses : de vraies armes, un corps qui sait les porter, une
caméra qui les montre et un viseur qu'on peut tenir au pavé tactile.

### Les armes

- **Quatre modèles réalistes** remplacent les armes en blocs de la 0.9.10 : Calypso 9 (pistolet acier et noyer),
  Hornet (pistolet-mitrailleur compact), Breaker 12 (pompe à garnitures sable), Sentinel (fusil d'assaut à viseur point
  rouge). Textures de couleur, de relief et de métal ; culasse, chargeurs et pompe mobiles. Sources libres (CC0 et
  CC BY 4.0), créditées dans `CREDITS.md` et `assets/weapons/LICENSE-weapons.md` ; marquages de fabricants effacés.
- **Chaîne d'import** `tools/weapons` : orientation automatique d'un modèle posé de travers, mise à l'échelle réelle,
  découpe des pièces mobiles, effacement des marquages, textures recomposées. Planche de mesure au centimètre
  (`tools/gun-preview.html`) et studio des postures (`tools/gun-studio.html`).
- **La grenade ÉCLAT** est une vraie grenade à main, en main comme en vol.
- **Le grappin LEVIER** a son propre lanceur orange : il ne ressemble plus au pistolet.

### Porter, ranger, dégainer

- **Les armes vivent sur le corps.** Le pistolet dans un étui de cuir bas sur la cuisse droite, le fusil d'assaut et le
  fusil à pompe en bandoulière dans le dos, canons au-dessus de l'épaule gauche, le pistolet-mitrailleur sous la veste.
  L'épaule droite reste dégagée : c'est par là que la caméra regarde en visée.
- **L'arme reste en main pendant un saut**, et les armes longues ne traversent plus le siège en voiture.
- **Dégainer et rengainer sont joués.** La main va chercher l'arme là où elle est rangée et l'amène ; changer d'arme
  range la première avant de sortir la seconde ; on ne tire pas tant que l'arme n'est pas en main, et un clic donné trop
  tôt part dès qu'elle y est.
- **Viser les mains vides** (clic droit ou X) dégaine la dernière arme tenue, le pistolet par défaut. Une nouvelle
  partie commence les mains vides, tout l'arsenal sur le dos.
- **Trois tenues.** Portée à une main le long de la jambe quand la rue est calme, canon vers le sol quel que soit le
  balancement du bras ; prête, à deux mains, canon bas, dès qu'il y a du danger (visée, tir récent, rechargement, avis de
  recherche, ennemi éveillé à moins de 55 m) ; en joue, crosse à l'épaule et joue sur la crosse, ou bras tendus au
  pistolet.
- **Les détails.** L'index reste le long de la carcasse tant qu'on ne vise pas, le pouce se referme sur l'arme, la main
  gauche suit la pompe, le canon traîne un instant derrière un coup de caméra, l'arme vit avec la marche et la
  respiration. Le recul passe par un ressort propre à chaque arme et secoue le buste ; il revient toujours sur la visée.
- **Les policiers** gardent le pistolet à l'étui tant qu'ils n'ont rien vu et le sortent en vous voyant.

### Viser et tirer

- **Cadrage de visée refait** : le héros dans le tiers gauche, l'arme et les mains dans l'image, le viseur à hauteur
  d'œil à côté de la tête ; l'objectif se resserre (44°, 40° au fusil d'assaut, 46° à la pompe). Arme simplement portée,
  la caméra reste derrière le marcheur. À pied, elle ne rentre plus dans les véhicules qui s'arrêtent derrière vous.
- **Visée assistée** (touche **Y** pour la couper) : lever l'arme près d'un ennemi amène le viseur sur son torse, le suit
  une seconde et lâche ; baisser et relever passe au suivant. Un mouvement volontaire de la souris ou du pavé reprend la
  main tout de suite. Le réticule rougit sur un ennemi et s'entoure d'un anneau pendant l'accroche.
- **Le réticule n'apparaît qu'en visée ou en tirant.** Tirer sans viser lève l'arme à la ligne de mire, puis elle
  redescend.
- **Une balle en pleine tête tue** quiconque n'a ni casque ni gilet. Le dernier ennemi d'une fusillade tombe au ralenti.

### Le feu

- **Flammes de bouche par arme** : étoile du cache-flamme au fusil d'assaut, boule déchirée et gerbe de poudre à la
  pompe, éclat court au pistolet et au pistolet-mitrailleur. Jamais deux fois la même d'affilée, 42 ms, lisibles en
  plein soleil comme de nuit ; elles éclairent les mains et le mur voisin le temps d'une image.
- **Fumée** : un filet à chaque tir, puis le canon qui fume après une rafale et que la fumée suit quand on bouge.
- **Douilles** : laiton de pistolet, laiton à collet du fusil, étui rouge à culot laiton de la pompe. Elles sortent par
  la fenêtre d'éjection de l'arme (au réarmement pour la pompe), tournent, rebondissent, tintent et restent au sol.
- **Impacts selon la surface** : chaussée, trottoir, mur, tronc, poteau, carrosserie, chair. Poussière qui part dans
  l'axe du tir, éclats, ricochets sur les tirs rasants, trous qui restent (200 au plus, les plus vieux s'effacent).
- **Sang** : une balle laisse une projection sur le mur derrière la victime et une flaque sous un corps.
- **Balles traçantes** plus fines, qui partent de la bouche du canon et s'arrêtent à l'impact.

### La roue des armes

- **TAB maintenu** ouvre une roue : la rue ralentit presque à l'arrêt, la souris ou le pavé désigne une arme, relâcher
  la prend. **TAB bref** revient à l'arme précédente. Le bouton de l'écran ouvre la même roue, qui reste ouverte jusqu'au
  clic. Chaque arme à feu y montre son portrait, rendu depuis son modèle.

## 0.9.10 — Price Action — 8 novembre 2026

Refonte du tir à la troisième personne et de la conduite des quinze voitures.

### Tir à la troisième personne

- **Caméra** : cadrage armé et visée rapprochée, changement d’épaule avec C, réponse directe au regard, collision
  contre les empreintes réelles des bâtiments et dégagement amorti. Dos au mur, la caméra glisse latéralement ;
  dans un coin totalement confiné, le corps et l’arme qui traverseraient l’image sont masqués temporairement, sans
  interrompre la simulation du canon. Recul à ressort, sans dérive aléatoire permanente.
- **Arsenal original** : quatre armes avec métal et polymère distincts, canons creux, organes de visée,
  culasses, chargeurs et pompe mobiles. Prise à deux mains, position de garde et rechargement revisités.
- **Précision** : tir posé plus précis, dispersion accrue en mouvement et en rafale, récupération entre les tirs,
  perte de dégâts à distance propre à chaque arme. Une pression légèrement anticipée sur une arme semi-automatique
  est conservée brièvement ; la cadence automatique conserve les fractions de frame entre les tirs.
- **Cohérence** : première balle depuis la pose actualisée, cibles à bout portant conservées, obstacle entre le
  corps et le canon respecté. Rechargement automatique sur le temps du jeu, annulé proprement au changement d’arme.
- **Retour de tir** : douilles dans une réserve de 72 objets, 96 marques persistantes au maximum, flash bref,
  traceurs courts, réticule réactif, confirmation de tête/élimination, munitions et progression de recharge lisibles.
- **Pavé tactile** : X active/désactive la visée sans tenir le clic droit ; la pause et la perte de focus la libèrent.
- **Son** : signatures des quatre armes, mécanismes de recharge et confirmations synthétiques distincts.

#### Essais du chantier tir avant intégration

- **Validation** : suite complète, 692 tests dont 690 réussis, un ignoré et le seul échec attendu de
  `tree-geodata` (licence Xcode). Build de production réussi. Chrome sans fenêtre séparé, WebGPU,
  qualité ÉQUILIBRÉE, vrais événements CDP : quatre armes, tir simple/rafales, recharges, déplacement latéral,
  changement d’épaule, visée activable, tir au torse puis en pleine tête sur un acteur de test, mouvement de souris
  sous verrouillage, canon obstrué par une façade et caméra dos au mur. Pas d’exception JavaScript ou WebGPU observée dans ces parcours.
- **Mesure de fluidité** : sur secteur, sans plafond de fréquence Chrome, dans la rue de départ dense après une
  session de combat, 35,3 images/s au repos en visée et 33,2 pendant six secondes de tir automatique, rendus effectifs
  comptés via le régulateur GPU. Résolution interne adaptative 1007 × 569 pour une fenêtre de 1440 × 813.
  Ce relevé court ne garantit ni 60 images/s, ni un gain global sur la version précédente.
- **Limites** : les armes et leurs matières restent procédurales et stylisées ; elles ne constituent pas un
  rendu photoréaliste AAA. Le corps masque encore davantage les armes longues côté gauche, même si leur canon
  reste visible. Pas de nouvelle capture de mouvements dédiée au combat, ni de refonte de l’IA tactique/couverture.
  Toute la campagne, les longues sessions sur batterie et une écoute humaine du mixage ne sont pas revalidées.

### Capital Gains — les voitures

- **Quinze personnalités** : traction, propulsion et intégrale ; le fourgon Tournée possède enfin son propre réglage
  diesel/traction. La masse, l'empattement réel, les pneus et la transmission déterminent le comportement.
- **Contact avec la route** : angles de braquage distincts des roues avant, rotation interne/externe différenciée,
  déformation progressive du pneu avant sa force maximale, freinage progressif avec ABS et contre-braquage conservé.
  La marche arrière est régulée entre 32 et 50 km/h selon la catégorie, sans imposer brutalement une vitesse.
- **Transmission** : passages précoces à faible charge, rétrogradage en reprise, montée/descente du régime pendant
  le changement de rapport. Les aides remontent leurs interventions réelles au son et au tableau de bord.
- **Carrosseries** : peinture multicouche et vernis par famille, reflets de façades filtrés pour supprimer le damier
  crénelé, vitres plus lisibles et pneus sculptés sans ajouter de texture externe. Plaques et badges des cinq marques
  projetés sur les panneaux des quinze modèles, y compris la circulation et le stationnement.
- **Mécanique visible** : quatre disques ventilés avec étriers qui suivent la suspension et le braquage, indépendants
  de la rotation des pneus ; chaleur visuelle progressive sur les pistes de freinage. Un seul dessin supplémentaire
  par voiture détaillée. Les voitures de collision simplifiées gardent leurs matériaux partagés.
- **Habitacles** : console, assises et cadrans avec aiguilles de vitesse/régime animées. Les textures sont préparées
  au chargement, pas repeintes pendant la conduite.
- **Sensation** : caméra poursuite/action à ressort stable, anticipation et amplitude du champ de vision maîtrisées ;
  six familles sonores, variations par modèle, son de charge moteur, engagement des rapports et pneus moins aigus.
  Traces à la largeur des pneus et sur la pente du contact ; poussière, fumée et eau distinctes. L'humidité des effets
  vient maintenant de l'état réel de la chaussée, un ancien calcul empêchant le spray de fonctionner.
- **Garage complet** : quinze automobiles, caractéristiques affichées, sélection au clavier/pavé tactile, objets
  préparés au chargement et réutilisés. La préparation du garage ne supprime plus une voiture d'une sauvegarde pleine.
  L'encombrement du modèle est pris en compte pour chercher son point d'apparition.
- **Instrumentation** : vitesse résultante même en glisse, régime, rapport, gaz, frein, ABS, TC, accélérations, nitro
  et état mécanique. Animation locale par transformations ; aucun effet CSS animé sur tout l'écran.

### Mesures reproductibles

Sur piste plane sèche, sans nitro, dimensions réelles des modèles. Le freinage est mesuré de **100 à 3 km/h**.

| Modèle | 0–100 km/h | Freinage |
| --- | ---: | ---: |
| Valmont Écume | 5,18 s | 36,08 m |
| Brisant Tempête | 4,45 s | 37,01 m |
| Corsaire Foudre | 2,72 s | 32,15 m |
| Corsaire Zénith | 2,38 s | 29,84 m |
| Hauturier Fret | 11,20 s | 49,55 m |

Le banc `node tools/cars/benchmark-dynamics.mjs` vérifie les quinze modèles sur sec/faible adhérence, marche arrière,
20/30/60/144 Hz, pauses/reprises, impacts et récupération après retournement. Sur la séquence de 13,5 s, l'écart
maximal entre cadences reste de 0,55 m, 0,051 m/s et 0,16°. Ce banc mesure la simulation, pas le ressenti d'une manette
ni la fluidité du rendu de Manhattan. Le scénario mouillé du banc utilise une adhérence réduite à 0,45 pour tester
les limites ; la pluie de la ville applique actuellement une réduction plus modérée.

Les modèles et textures historiques, le moteur de synthèse et la simulation thermique restent des limites de la flotte.
La cible de 60 images/s soutenues dans Manhattan reste ouverte.

### Vérification de la version intégrée

- Le garage tient compte du rayon complet du véhicule près des façades, et la zone rouge des cadrans suit le réglage moteur.
- Les tirs peuvent endommager une voiture garée. Les devantures orientées arrêtent le tir même quand elles sont minces.
- Avec de vrais événements clavier et souris dans Chrome, les quatre armes tirent et se rechargent. L'essai a aussi
  couvert le changement d'épaule, la visée au pavé tactile, le tir au torse et à la tête, le canon obstrué et la pause.
  La première mission « Clé de contact » a été jouée jusqu'à sa récompense, avec déplacement au marqueur de livraison.
- Le banc de conduite mesure un déplacement et un gain de vitesse sur quatre roues pour chacun des quinze modèles.
  Si le départ en circulation ne réunit pas ces conditions, l'essai est repris sur une voie dégagée en isolant les
  contacts avec le trafic ambiant. Les quinze modèles ont passé l'essai en ÉQUILIBRÉE et en HAUTE, sans erreur WebGPU.
- La suite complète compte 738 réussites et un test ignoré. Le générateur d'arbres a été testé avec le Python fourni
  par Codex. Le build de production réussit.

## 0.9.9 — Break Even — 7 novembre 2026

Correctif après retour de jeu : les améliorations graphiques de 0.9.8 étaient trop modestes au regard de la charge
supplémentaire et ne validaient pas l'expérience réelle. Priorité aux déplacements et à la stabilité.

- **Enfoncement du héros et des piétons** : l'animation enregistrée était ancrée sur un bassin qui avait déjà subi
  les oscillations et contraintes d'une autre marche. En course sur sol plat, ce cumul abaissait le corps jusqu'à
  environ 23 cm dans la reproduction. La capture s'ancre maintenant sur la surface réelle ; les postures de saut,
  chute, conduite et entrée/sortie de véhicule conservent leur squelette procédural.
- **Bordures** : le héros corrige chaque jambe selon le sol sous la semelle, pointe et talon compris, tout en gardant
  l'orientation du pied. La correction ne remplace pas le mouvement enregistré sur sol plat et ne traite pas une
  grande hauteur comme une marche franchissable.
- **Cadence des pas** : choix de l'animation et longueur de foulée tiennent compte de la taille du corps affiché,
  pour le héros comme pour les passants.
- **Reflets et charge GPU** : la recherche dans les volumes réels reste disponible en HAUTE. ÉQUILIBRÉE et FLUIDE
  reprennent les reflets légers et ne chargent plus le champ de hauteurs des reflets. La lumière ambiante locale,
  les matières et les corrections de visibilité restent actives.
- **Résolution adaptative** : retour à une cadence soutenue d'au moins 57 images/s avant de tenter une remontée,
  au lieu de 52. Une rue déjà limitée à 54 images/s n'ajoute plus de pixels à calculer.
- **Tests de mouvement réels** : les fichiers de capture, le squelette et les sommets des chaussures livrés sont
  évalués en marche/course à 20, 30 et 60 images/s, sur sol plat et au franchissement d'une bordure de 22 cm dans
  les deux sens. Tests aussi sur piétons homme/femme, changement de hauteur, téléportation, saut et taille du corps.

- **Validation** : 658 tests, 656 réussis, un ignoré et le seul échec attendu de `tree-geodata` (licence Xcode).
  Build de production réussi. Dans un Chrome séparé en ÉQUILIBRÉE : marche et course sur le trottoir de départ,
  traversée de bordures dans les deux sens, avec de vraies touches CDP et mesures sur les sommets des chaussures.
  Pour isoler les appuis, le dernier parcours rend temporairement le personnage invulnérable aux voitures et aux
  renversements ; les collisions avec le sol et le mobilier restent actives. Les 154 relevés de ce parcours donnent
  une pénétration maximale de semelle inférieure à 1 mm. Cela ne certifie pas toutes les surfaces de Manhattan.
  Vol d'une voiture garée, conduite, freinage, sortie et reprise de la marche également rejoués, sans erreur
  JavaScript ou WebGPU détectée. Ce dernier scénario conserve les interactions normales avec la circulation.
- **Limites** : la fluidité reste variable dans les zones denses, avec encore des passages sous 60 images/s.
  Les comparatifs de reflets sont indicatifs (trafic vivant), pas une garantie de gain sur chaque machine.
  Les animations en combat, toute la campagne et les longues sessions sur batterie ne sont pas revalidées.

## 0.9.8 — Revaluation — 7 novembre 2026

### Matière et profondeur
- **Lumière locale** : visibilité du ciel calculée hors ligne à 2, 16, 48 et 144 mètres à partir des 37 353 empreintes
  d'immeubles. Les rues encaissées, les places ouvertes, les cours et les toits reçoivent un éclairage ambiant distinct.
  Une lecture de texture par fragment ; le soleil, les lampes et leurs ombres restent dynamiques. Ce n'est pas une
  simulation complète d'illumination globale.
- **Reflets des voitures détaillées** : recherche des volumes réels dans un champ de hauteurs, indépendante de ce qui
  est à l'écran. Les ouvertures des rues et les hauteurs de la skyline suivent la ville. Les façades reflétées sont
  simplifiées et éclairées selon l'heure ; trafic et passants ne figurent pas dans ces reflets. Le trafic instancié garde
  ses reflets légers.
- **Façades proches** : jambages en pierre, linteaux plus profonds, doubles moulures aux soubassements et bandeaux.
  Les détails trop hauts, trop loin ou sur la face opposée ne saturent plus les pools.
- **Monuments** : pierre taillée à joints métriques, variation par dalle, pores discrets et pied sali ; halls en vitrage
  avec montants et émission nocturne, au lieu de boîtes blanches lumineuses en plein jour. Pelouse texturée à Bryant Park.
- **Image** : soleil moins écrasant, équilibre ciel/soleil revu, bloom contenu sur les hautes lumières, franges
  chromatiques retirées, vignette et accentuation atténuées.

### Budget de rendu
- La portée explicite des petits lots instanciés est respectée : les bouches d'incendie éloignées ne sont plus toutes
  envoyées au GPU. Les grands lots à portée explicite, notamment les fosses d'arbres, restent divisés spatialement.
- Stationnement : sélection du niveau de détail voiture par voiture, altitude comprise, puis 21 pools persistants
  pour les sept modèles (proche, lointain, ombre de contact). Aucun objet de rendu ni matériau créé pendant leur
  défilement. Occupation, collisions, vol, interdictions et disparition immédiate restent indépendants du rendu.
- En ÉQUILIBRÉE, le rafraîchissement des ombres stables est limité à 30 Hz ; une rotation rapide, un déplacement de plus de 75 cm ou
  une téléportation les rafraîchit immédiatement. HAUTE conserve une mise à jour par image.
- La résolution peut remonter après une cadence stable d'au moins 52 images/s. Un passage qui plafonne côté processeur
  ne condamne plus l'image à rester floue faute d'atteindre 57 ; les essais infructueux gardent leur temporisation.

### Fabrication et contrôle
- Deux ressources dérivées, environ 5,93 Mo compressées, régénérées par `node tools/world/bake-urban-light.mjs`.
  Aucune nouvelle source externe ; provenance et limites dans `CREDITS.md` et le guide de l'outil.
- Tests ajoutés : portée et partitionnement du mobilier, niveaux de détail et vol des voitures, géométrie des
  encadrements, cadence des ombres, récupération de résolution, lumière des cours et rues, format binaire et recherche
  de reflets au-dessus des toits et dans chaque direction.

### Validation du jalon et limites
- `npm test` : 652 tests, 650 réussis, un ignoré et le seul échec attendu de `tree-geodata`, dû à la licence Xcode
  non acceptée sur la machine. `npm run build` réussit ; les deux champs sont livrés et l'Architecte reste exclu.
- Démarrage et marche contrôlés aussi en FLUIDE et HAUTE, sans erreur JavaScript ou WebGPU détectée. Les mesures
  comparatives de cadence ci-dessous concernent ÉQUILIBRÉE ; elles ne sont pas un benchmark de ces deux autres qualités.
- Parcours dans un Chrome séparé, WebGPU, synchronisation verticale et plafond d'images désactivés : Midtown,
  Bryant Park, Times Square, Flatiron et Downtown en caméra de jeu à midi, puis Midtown la nuit. Marche et conduite
  avec de vraies touches CDP ; vol d'une voiture garée et sortie du véhicule contrôlés.
- Première mission « Clé de contact » jouée jusqu'à sa fin : prise du véhicule, recherche policière, livraison,
  disparition des étoiles et récompense de 2 000 $. Le test déplace le joueur sur les marqueurs et le véhicule au
  lieu de livraison ; il ne force ni les étapes ni la récompense. Le trajet routier complet reste à éprouver.
- Aucune erreur JavaScript ou WebGPU pendant ces parcours. La campagne complète, les longues sessions sur batterie
  et l'équilibrage du combat ne sont pas revalidés par cette version.
- Le coût de la scène de départ est passé d'environ 19,7 millions à 8,4 millions de triangles soumis, selon le trafic
  et le passage d'ombres. Le gain ne garantit pas 60 images/s : les séries en ÉQUILIBRÉE varient d'environ 40–55 à
  55–71 images/s selon la zone et la session. Dans le dernier comparatif à résolution native de Midtown, les ombres
  cadencées donnent 40,4 images/s contre 37,9 à cadence complète, avec un 95e centile identique de 35,9 ms.
  La cible de 60 images/s stables reste ouverte ; les chiffres instantanés du compteur ne constituent pas une garantie.
- Les personnages secondaires, les silhouettes de certains monuments, les animations et la mise en scène restent
  en retrait du niveau artistique visé. Cette version améliore le rendu ; elle ne certifie pas un niveau AAA.

## 0.9.7 — Curb Appeal — 7 novembre 2026

L'image. Le jeu avait une ville réelle, des voitures réelles, des gens réels, et une image de 2004 : un éclairage plat
où l'ombre valait le soleil, rien ne touchait le sol, un héros maladroit qui glissait dans sa voiture, un départ sous un
échafaudage. Cette version refait la lumière de bout en bout, la première minute, le héros, l'entrée en voiture et les
accessoires de chantier qu'on voyait en premier.

### La lumière
- **Le soleil contre le ciel** (`js/lighting.js`) : le soleil monte (7,6 à 8,2 au lieu de 5,8 à 6,4), le ciel et le rebond
  redescendent (1,4 à 1,5 au lieu de 2,3 à 2,5). Une rue à l'ombre de ses immeubles est à l'ombre, une façade au soleil
  brûle. Les ombres portées ont un bord filtré plus large.
- **L'œil** (`js/atmosphere.js`, `adapt()`) : trois sondes (la caméra, le joueur, la rue devant) suivent le soleil à travers
  les colliders des immeubles toutes les quatre images ; à l'ombre, l'exposition s'ouvre jusqu'à ×1,6 en une seconde
  (et se referme en une demi-seconde au soleil), comme au cinéma : on expose pour l'ombre et le bout de l'avenue éclate.
  Rien la nuit, peu sous les nuages.
- **Occlusion ambiante** (`GTAONode` de three.js r187, en demi-résolution, débruitée en demi-résolution) sur les qualités
  HAUTE et ÉQUILIBRÉE : le dessous des voitures, le pied des murs, l'entre-deux des voitures garées, les corps posés sur
  le trottoir. L'image cesse de flotter.
- **Rayons du soleil** (`js/post-processing.js`) : le ciel autour du soleil, avec les immeubles découpés dedans par la
  profondeur, étiré vers le soleil au quart de la résolution. En fin de journée la lumière passe entre les tours en
  faisceaux ; rien quand le soleil est dans le dos, sous l'horizon ou derrière les nuages.
- **L'étalonnage** : contraste plus ferme autour du gris moyen, ombres plus froides, hautes lumières plus chaudes, vibrance,
  vignettage ; une frange chromatique latérale aux coins ; un affûtage borné au voisinage (sans halo) après l'étalonnage,
  qui rend ce que l'échelle de rendu dynamique et le multi-échantillonnage adoucissent.

### La première minute
- **Le menu** regarde la 5e Avenue depuis le ciel, dans une lente passe au-dessus du joueur vers l'Empire State Building.
- **Le vol d'ouverture** (`cameras.js` `playCinematic`, `gameplay.js` `playIntro`) : au clic, la caméra plonge du menu
  jusqu'au dos de Sacha en neuf secondes et demie, le long d'une spline par le dessus de l'avenue, bandes noires et carton
  « Midtown · 5e Avenue · heure ». Une touche ou un clic l'écourte. Une fois par nouvelle partie et une fois par nouvelle
  version ; sinon une plongée de quatre secondes à la reprise.
- **Le départ** : le trottoir ouest de la 5e Avenue sous la 37e Rue, face au centre-ville, ses trois voitures le long de
  la bordure ; plus d'échafaudage ni de toilette de chantier dans la première image.

### Le héros
- **Sacha a changé de visage** : avatar Rocketbox `Male_Adult_07` (blazer gris sur henley, jean, cheveux courts), importé
  par `tools/people` en 2048 px, à la place du sweat à capuche.
- **La peau** (`js/person-lighting.js`) : la lumière directe s'enroule au-delà du terminateur et revient rougie, comme
  le sang sous une peau fine ; un visage au soleil a un bord doux là où la pierre en a un dur.

### Les voitures
- Toutes les voitures, trafic et stationnement compris, portent la peinture physique de la voiture du joueur : couleur
  sous vernis (clearcoat), métal réduit. Les reflets de la rue font le reste.

### L'entrée en voiture (`js/vehicle-entry.js`)
- Le héros ne glisse plus dans sa voiture : il marche jusqu'à la portière conducteur, la main droite va à la poignée, la
  portière s'ouvre jusqu'à sa sangle, un pas dans l'ouverture, le corps descend sur le siège en baissant la tête sous le
  toit, une jambe puis l'autre, la main gauche tire la portière, les mains reviennent au volant ; le miroir en sortant.
  Tout est une fonction pure du temps dans le repère de la voiture (testée : continuité des cibles, durées, portière
  fermée au début et à la fin), que `gameplay.js` pose sur le corps par les nouvelles cibles de mains et de pieds de
  `person-motion.js` (`overlay.arms = 'hands'`, `overlay.feet`, fondu `rideFade`). Plus vite quand on est pressé ou
  recherché ; motos, vélos, bateaux et aéronefs gardent leur embarquement.

### Les chantiers de rue (`js/sidewalk-kit.js`, `js/sidewalk-furniture.js`)
- **Un bug de 0.9.6 corrigé** : les planches des échafaudages de trottoir (platelage, garde-corps) et les bennes étaient
  posées à 90° de travers, en dalles vertes de 36 m qui traversaient la 5e Avenue à 4 m de haut et en bennes de 6 m en
  travers des voies. Tout est désormais le long des façades, et la toilette tourne sa porte vers le trottoir.
- **L'atlas du mobilier passe de 1024 à 2048 px** (8 × 8 tuiles) avec des tuiles peintes, déterministes : contreplaqué
  « hunter green » usé (feuilles de 2,44 × 1,22 m, clous, joints, une feuille sur six plus claire, tranches en bois brut),
  tôle de conteneur nervurée en trois couleurs avec coulures de rouille, bandeaux « GRÉVILLE CARTING » et « BRISANT
  CONTAINER » (numéros fictifs), béton de barrière Jersey, cône à deux colliers réfléchissants, plastique nervuré de
  toilette de chantier en deux teintes, gravats.
- **Géométries** : benne à panneaux, rails, galets, portes à charnières et barres de verrouillage, cadre à crochet ;
  toilette à socle, corps nervuré, toit translucide, évent ; Jersey au vrai profil ; terrasse de rue en bois et planches.
  Deux matériaux de plus, créés au chargement ; aucun coût mesurable sur le nombre d'images par seconde.

## 0.9.6 — Footfall — 7 novembre 2026

La ville prend vie. Avant, les trottoirs étaient nus (six objets tirés au hasard sur les avenues seulement), aucune
voiture n'était garée parce que les voies occupaient toute la chaussée, 340 piétons ne faisaient que marcher, rien ne
volait, rien ne se passait. Cette version ajoute les traces de la vie, les gens qui ont une raison d'être là, et les
petites histoires de la rue, en s'appuyant comme toujours sur les registres publics de New York.

### Le stationnement
- **Les chaussées redécoupées** (`js/road-layout.js`) : une file de stationnement de 2,3 m le long de chaque bordure qui a la
  place, le reste en voies de 3,1 à 3,7 m. Une rue transversale de 9 m garde une voie entre deux rangées de voitures
  garées, les grandes avenues (18 m et plus) prennent une piste cyclable protégée le long de leur bordure gauche,
  derrière la rangée de voitures. La largeur réelle des rues transversales est maintenant mesurée sur les trottoirs
  dessinés (le réseau les croyait à deux voies là où il n'y en a qu'une).
- **108 000 places** (`js/parking-plan.js`, `js/parking.js`) pare-chocs contre pare-chocs : rien à 4,5 m d'une bouche
  d'incendie, rien aux angles, aux arrêts de bus, devant les bennes de chantier ni les terrasses. Taux d'occupation par
  quartier et par heure (les quartiers d'affaires se vident la nuit, les rues résidentielles restent pleines) et
  **stationnement alterné** : un côté des rues résidentielles se vide pour le balayage de 9 h 30 à 11 h, un jour sur deux.
  Les bordures changent hors du champ de la caméra.
- Dessinées avec les modèles et le matériau compilé du trafic (aucune saccade), le modèle complet à moins de 76 m, le
  modèle grossier jusqu'à 230 m, phares éteints la nuit, ombres portées de près.
- **Toutes solides, toutes volables** (F), toutes poussables : une voiture garée percutée, poussée ou touchée par une balle
  devient une vraie voiture physique qui encaisse le choc ; son alarme part parfois. Les voitures de jeu posées dans la
  rue (missions, garage, départ) libèrent les places qu'elles occupent.

### Le trottoir new-yorkais
- **D'après les registres** (`tools/street/build-street-data.mjs`, `js/street-geodata.bin.gz`, 160 Ko) : 10 981 bouches
  d'incendie partout, 1 771 arrêts de bus et 613 abris (MTA, DOT), 284 kiosques à journaux, 9 843 arceaux vélo avec
  leurs vélos, 848 bancs, 1 037 bornes Wi-Fi, 3 622 parcmètres, **2 600 chantiers sous échafaudage** (permis en cours du
  DOB) et 1 258 terrasses de restaurant, dont les cabanes de restauration sur la chaussée.
- **Les règles de la rue** là où aucun registre ne dit rien (`js/sidewalk-furniture.js`, `js/sidewalk-kit.js`) : 22 000 panneaux
  de stationnement, les paniers à déchets verts des angles, les boîtes à journaux, les grilles d'aération du métro
  au-dessus des lignes, 21 000 colonnes sèches sur les façades, 7 500 portes de cave, 7 800 grilles d'arbres, des cafés en
  terrasse devant les restaurants, des boîtes d'alarme incendie. Tout est construit en code à la vraie taille, dans un
  seul atlas et deux matériaux ; les paniers, boîtes et cônes tombent sous une voiture.
- **Les échafaudages** : poteaux, croix de Saint-André, platelage à 3,75 m praticable (on peut y monter), bandeau vert,
  guirlande d'ampoules allumée la nuit ; devant certains, la benne à gravats dans la rue avec ses cônes, la cabine de
  chantier.

### Les gens ont une raison d'être là (`js/street-life.js`)
- **Densité par quartier et par heure** : Midtown bondé aux heures de bureau et mort la nuit, les quartiers résidentiels
  plus calmes, le Village et le Lower East Side pleins le soir, pointes du matin et du soir. Les piétons en trop s'en vont
  hors de vue.
- **Des postes** : les passants s'assoient sur les bancs, les chaises des cafés et dans les abris de bus, font la queue aux
  arrêts et aux chariots, s'arrêtent devant les vitrines, au comptoir des kiosques, téléphone ou café à la main.
- **Les portes respirent** : les 25 000 boutiques laissent sortir des clients selon leurs horaires (un café à la main au sortir
  d'un café, un sac au sortir d'une épicerie) et en font entrer ; les bouches de métro lâchent des grappes de voyageurs,
  plus fournies aux heures de pointe. Des joggeurs le long des parcs et des rivières.
- **Des véhicules à intentions** : les bus s'arrêtent aux vrais arrêts, feux de détresse allumés, la queue monte à l'avant
  et des voyageurs descendent à l'arrière ; quelqu'un hèle un taxi et le prochain libre s'arrête ; les camionnettes de
  livraison s'arrêtent en double file pendant que le livreur décharge, et le trafic klaxonne derrière.

### Les bêtes (`js/birds.js`, `js/birds-flock.js`)
- **Pigeons** par bandes de 6 à 18 sur les trottoirs (250 en qualité ÉQUILIBRÉE) : ils picorent, marchent par petits pas,
  s'écartent des passants, s'envolent devant un coureur, une voiture, un coup de feu, une explosion ou un klaxon, tournent en
  bande puis se reposent plus loin ou sur les lampadaires. **Mouettes** au-dessus des rivières. **Rats** la nuit entre les
  sacs poubelle.

### La nappe sonore (`js/audio-ambience.js`, tout synthétisé)
- Murmure de foule selon les piétons visibles, bourdon de la ville, grondement et passages de rames sous les grilles
  de métro, marteau-piqueur sous les échafaudages de jour, musique qui filtre des bars la nuit, roucoulements, cris de
  mouettes au bord de l'eau, sirènes très lointaines, et l'alarme des voitures qu'on bouscule.

### Les petites histoires de la rue (`js/ambient-events.js`)
- Toutes les une à deux minutes près du joueur, jamais deux fois la même d'affilée : un **accrochage** et deux
  conducteurs qui s'expliquent dans la rue pendant que ça klaxonne derrière ; un **contrôle de police**, l'agent à la
  vitre et la voiture de patrouille derrière ; une **bouche d'incendie ouverte** qui inonde le caniveau ; le **camion
  poubelle** de nuit et son équipe qui ramasse les sacs. Et quand le joueur se plante, les passants se retournent,
  téléphone à la main.

### Validation et limites
- Mesuré en Chrome sans fenêtre, à échelle fixe 0,8 : à la 9e Rue Est, 61 images/s avec et sans les ajouts (stationnement
  et mobilier ajoutent environ 160 draws et 1,3 M de triangles) ; le départ, 5e Avenue et 37e Rue, reste limité par le GPU
  à 40-44 images/s avec ou sans eux. Le son n'a été vérifié qu'en simulation : les niveaux sont à régler à l'oreille.
- Joué sans fenêtre : vol d'une voiture garée, choc contre une voiture garée (elle devient libre et part en travers),
  tir sur une voiture garée, nuit sans phares ; piétons assis dans un abri, montées et descentes de bus, sorties de
  boutiques et de métro ; accrochage avec ses deux conducteurs, contrôle de police, bouche ouverte ; pigeons au sol et en
  vol, mouettes sur l'Hudson.
- Non vérifié : les rats (il faut des sacs poubelle à portée, la nuit), le camion poubelle (il faut un camion du trafic
  près de sacs la nuit), les taxis hélés jusqu'au bout (rarement servis en deux minutes), les manettes et le mobile.
- Reste faible : pas de voiture qui se gare ou quitte sa place sous les yeux du joueur (les bordures changent hors
  champ) ; les chaises et bancs sont simples ; pas de promeneurs de chiens ni de musiciens (pas de modèle) ; les
  piétons traversent encore un peu les tables ; les échafaudages n'ont pas de filet en façade.

## 0.9.5 — Due Diligence — 4 novembre 2026

### Jeu publié

- Éclairage de la foule, du joueur et des accessoires : rebond des lumières proches et appoint progressif de la ville
  après le crépuscule. Les corps dos aux lampes gardent leurs couleurs et leur volume, y compris aux niveaux de détail.
- Le nouveau module `person-lighting.js` est préchargé ; le build conserve l'exclusion complète de l'Architecte.

### Architecte 2.2 — outil local

- Prospection déterministe entre les interventions du modèle : lieux et conditions peu couverts, sujets variés,
  déplacement à pied, en voiture et en hélico selon les capacités disponibles. Les tickets en attente ou en échec
  n'empêchent pas de poursuivre une autre observation. Aucun ticket n'est inventé ni automatiquement validé.
- Plus d'appel périodique pour répéter « j'attends » ; un nouveau jugement demande des photos, des mesures ou une
  information à traiter. Les statuts du chantier et l'état réel de l'atelier priment sur ses récits mémorisés.
- Les trajets sans progrès sont repris, puis le point inaccessible est temporairement écarté. Caméra humaine,
  périmètre du mode Ensemble, pause, interrupteur et plafond de dépense restent prioritaires.
- Voix coupée par défaut, bouton visible en permanence dans la salle ; couper annule immédiatement la phrase en cours.
- Mémoire automatique externe désactivée pour l'agent de code ; leçons extérieures en lecture seule et garde avant
  écriture. Un arrêt conserve un relevé borné des variations, distingue résultat partiel et relevé indisponible, et
  n'affiche plus « aucun fichier modifié » faute de preuve.

### Fondations de fiabilité intégrées

- L'Architecte v2 : œil indépendant, rétroviseur, sondes, quatre expériences mesurées, programmes, mémoire en couches,
  conversation séparée et salle de contrôle à cinq pages.
- Validation du Créateur persistante et transitions de tickets contrôlées ; un statut ancien ne vaut pas autorisation.
- Livraisons acceptées seulement avec fiche structurée, tests complets du dernier état du code et attribution vérifiée.
  Les modifications concurrentes et les commits pendant une session sont signalés ; aucun retour arrière automatique.
- Clôture conditionnée aux preuves prises après livraison, au bon endroit, et au rejeu valide d'une expérience compatible.
  Relecture indisponible : constat conservé en attente, aucun ticket automatiquement confirmé.
- Mémoire sauvegardée pendant l'activité, écritures JSON atomiques, budget partagé entre rôles et tâches annexes.
- Réserves API persistées avant envoi, coûts incertains conservés après redémarrage ; preuve liée au chargement du jeu
  et au code observé, aucune ancienne photo rendue valable par un rechargement.
- Interruption entre outils ; annulation des expériences et captures à la reprise de caméra, à l'extinction ou à la mort.
  Nettoyage des objets temporaires et restauration de l'heure et de la météo ; arrêt borné de l'atelier.
- Restauration immédiate de l'adhérence, du soleil, des éclairs et du tonnerre ; sauvegarde joueur suspendue pendant
  une expérience. Caméra et pause cohérentes quand l'onglet est déjà masqué ; rallumage rapide appliqué au corps.
- Mesures FPS indépendantes du buffer, vitesse latérale et verticale incluse, zoom de reproduction restauré,
  identification limitée aux objets visibles et réponses JSON sans référence à la scène Three.js.
- Contrôles automatisés et essais navigateur/atelier isolés dans le guide `tools/architecte/README.md`.
- La liste des sessions de l'atelier inclut la correction en cours dès son démarrage. Commande de suivi Terminal en
  lecture seule, étapes mises à jour dans le détail ; reprise interactive Claude Code proposée après la fin.

## 0.9.4 — Momentum — 4 novembre 2026

Cette version réunit les refontes « Bricks & Mortar » (immeubles) et « Momentum » (conduite), développées en parallèle.
Elle reste destinée aux essais en ligne ; les objectifs de la 1.0 restent à réaliser.

### Intégration et vérification
- Les deux refontes partagent le même numéro, le titre **0.9.4 — Momentum** et une documentation réunie.
- Corrigé avant publication : certaines cabines plaçaient le conducteur près de l'essieu arrière en prenant la lunette
  arrière comme repère ; le siège suit maintenant le pare-brise avant. Test sur les géométries réelles des modèles.
- Un rappel au garage efface aussi le braquage et les aides résiduelles d'un dérapage. La vitre vue depuis l'habitacle
  laisse passer la lumière de la rue. Quatre requêtes vers des textures de cheveux absentes ont été supprimées.
- **423 tests réussis sur 424** : seul l'échec connu `tree-geodata` reste lié à la licence Xcode. Build statique vérifié,
  nouveaux modules préchargés ; aucun fichier de l'Architecte, outil ou secret dans les 406 fichiers publiés (59,2 Mo).
- Build publié essayé dans un Chrome séparé, WebGPU : marche AZERTY, entrée/sortie, conduite, virage, frein à main,
  caméras externe et intérieure, trois lieux de jour et une vue de nuit. Première mission « Clé de contact » terminée
  dans la page en rejoignant ses marqueurs, avec entrée réelle au clavier et livraison de la Valmont.
- Aucun échec réseau ni erreur JavaScript pendant cet essai. Les mesures à 1440 × 900, en qualité ÉQUILIBRÉE et à une
  échelle fixe de 0,8, vont d'environ 50 à 66 images/s selon le lieu ; les 60 images/s constants restent à atteindre.
- Limites relevées : rebords de toit traversables ; certaines fenêtres au pied des gradins peuvent être coupées ou
  décalées par rapport au kit en relief. Les autres missions, tous les modèles en vue intérieure et les mobiles n'ont
  pas été rejoués pendant cette intégration.

### Momentum — la conduite

La conduite refaite pour le clavier, et des voitures qu'on a envie de regarder. Avant, les voitures étaient dures à
tenir : volant tout ou rien, tête-à-queue au moindre coup de gaz, frein qui empêchait de tourner, explosions au bout de
quelques chocs. Chaque réglage a été mesuré sur un banc d'essai (accélération, freinage, virage, frein à main) puis en
ville, avec un pilote automatique qui conduit au clavier, en comparant avec la 0.9.3.

#### Une conduite qui se tient au clavier
- **Volant progressif** : une touche tourne le volant en un dixième de seconde à l'arrêt, en un tiers de seconde à
  pleine vitesse, et le ramène deux fois plus vite. Un appui bref corrige la trajectoire, un appui long braque à fond.
- **Braquage adapté à la vitesse** : à fond, les roues vont jusqu'à la limite d'adhérence des pneus, jamais au-delà.
- **Contrôle de stabilité** : la voiture tourne à la vitesse que demande le volant, autant que ses pneus le
  permettent. Plus aucun tête-à-queue au volant seul, quelle que soit la voiture ou la vitesse. La muscle garde son
  caractère : elle glisse jusqu'à une trentaine de degrés, mais ne part plus en toupie.
- **Freiner en tournant** : l'ABS laisse aux pneus de quoi tourner. En freinant à fond depuis 100 km/h, la voiture tourne
  de 50 à 90° au lieu de 13.
- **Frein à main** : un vrai demi-tour contrôlé. La voiture pivote, puis au relâchement elle garde son nouveau cap et
  repart dans cette direction (avant, le nez revenait vers l'ancienne trajectoire et la voiture tournait sur elle-même).
- **Corrigé** : dans certains cas (après un tête-à-queue, au démarrage d'une petite voiture), la transmission pouvait
  cesser de propulser la voiture, pied au plancher.
- Les utilitaires, SUV et camions ne se retournent plus en braquant à fond sur du plat.

#### Des voitures solides
- Un choc ne compte qu'une fois (il comptait à chaque étape de calcul du contact). Les dégâts suivent la violence du
  choc : quelques points à 50 km/h, un dixième de la santé à 90, un quart à 130, la moitié à 200.
- Le trafic qu'on percute est cabossé mais n'explose plus : le feu vient des balles et des explosions.
- Une explosion voisine ne compte plus deux fois contre la voiture du joueur. Les tirs abîment deux fois moins la
  voiture du joueur.
- Un moteur à bout de souffle tousse à mi-puissance avant de prendre feu, et le joueur a neuf secondes pour sortir.

#### Des voitures qu'on regarde
- **La rue dans la peinture** : la carrosserie et les vitres reflètent les façades autour de la voiture (leurs fenêtres
  glissent sur le capot en roulant, éclairées la nuit), le ciel au-dessus des toits et la route en dessous. Le reflet est
  calculé à partir des immeubles réels autour de la voiture du joueur. Peinture vernie : la couleur dessous, le reflet
  dans le vernis.
- **Le conducteur au volant** : le héros est assis dans la voiture, mains sur le volant qui tourne avec les roues,
  pieds sur les pédales, la tête tournée vers le virage. Les vitres s'éclaircissent pour le montrer.
- **Un habitacle** : sièges, banquette, tableau de bord, colonne et volant, placés pour chaque modèle d'après ses vitres.
  L'intérieur des portières et du pavillon ferme l'habitacle : on ne voit plus la rue à travers la carrosserie.
- **Vue intérieure** : la caméra à la première personne s'assoit à la place du conducteur, derrière le volant et le
  tableau de bord.
- **Le poids** : la caisse penche en virage, plonge au freinage et s'assied à l'accélération sur ses ressorts, plus
  dans un SUV que dans une supercar. Les roues restent posées.

### Bricks & Mortar — les immeubles

Les immeubles refaits. Les 37 353 immeubles de Manhattan étaient des boîtes, l'empreinte au sol montée d'un bloc jusqu'au
toit, dessinées par sept façades tirées au hasard : la même grille de fenêtres partout, du beige partout. Chacun sait
maintenant ce qu'il est, et s'habille en conséquence.

#### Chaque immeuble sait ce qu'il est
- Le registre foncier de la ville (PLUTO) donne à chaque immeuble sa catégorie, son nombre d'étages, son année de
  construction et son quartier historique. 93 % des immeubles ont la leur ; les autres prennent celle de leur voisin.
- Douze types : maison de ville, immeuble ouvrier, immeuble d'avant-guerre, loft à façade de fonte, immeuble de bureaux
  ancien, tour Art déco, immeuble d'après-guerre, bureaux des années 1960, tour de verre, immeuble contemporain,
  bâtiment public, garage et entrepôt. Manhattan redevient d'abord de la brique : 14 862 immeubles ouvriers et 7 696
  maisons de ville, et 1 343 façades de verre au lieu de presque un immeuble récent sur deux.
- Les quartiers comptent : grès brun à Harlem et dans l'Upper West Side, brique Federal à Greenwich Village, fonte peinte
  à SoHo et Tribeca.

#### Des façades qui ne se ressemblent plus
- Chaque immeuble a sa couleur, tirée des vraies teintes de New York (brique rouge, brune, chamois, blanche, grise,
  calcaire, grès brun, fonte peinte) ou de celle que les cartographes ont relevée.
- Son rythme de fenêtres, leurs proportions et leurs petits-bois : guillotines simples ou à six carreaux, fenêtres
  cintrées, jumelées, baies de loft à imposte, bandeaux d'après-guerre, grands vitrages contemporains, et la couleur des
  menuiseries.
- Soubassements en pierre à bossages, chaînes d'angle, bandeaux, fenêtres d'attique plus basses sous le toit, allèges
  sombres des tours Art déco, climatiseurs surtout dans les immeubles ouvriers.
- Tours de verre : couleur du verre et du métal, allèges, fenêtres en bandeau des années 1960, ailettes verticales.

#### Des silhouettes
- 1 650 tours montent en gradins d'après leurs volumes relevés dans OpenStreetMap ; les grands immeubles de la loi de 1916
  qui n'en ont pas montent en retraits successifs, et les tours Art déco finissent en couronne. Les terrasses des retraits
  se parcourent comme les toits.
- Corniches moulurées (frise, denticules, consoles, larmier) en tôle peinte ou en pierre, acrotères sur les toits sans
  corniche, toits en goudron, revêtement argenté, gravier ou membrane.
- Châteaux d'eau et escaliers de secours là où ils vont : immeubles ouvriers, avant-guerre, lofts.

#### Du relief et de l'usure
- Autour du joueur (160 m, 200 m en HAUTE), les fenêtres ont leurs appuis en pierre en saillie, leurs linteaux, les
  frontons en tôle ou en grès brun des immeubles ouvriers et des maisons de ville, des clés au-dessus des arcs, et de
  vrais climatiseurs en 3D qui prennent le soleil et portent leur ombre. Au-delà, la façade les peint comme avant.
- Les vitres d'une rue reflètent surtout la façade d'en face, le ciel seulement au-dessus de sa ligne de toits.
- Usure, plus forte sur certains immeubles : coulures sous chaque appui, taches sous la corniche, éclaboussures au pied
  du mur, plaques de briques refaites.
- Les toits se peuplent : cabanons d'escalier et cheminées dans la brique de l'immeuble, verrières, tuyaux de
  ventilation, paraboles.

#### La lumière
- Soleil plus fort et plus chaud, ombres plus bleues, plus de contraste le jour.
- Le terre-plein de Park Avenue devient une haie taillée au lieu d'un bloc vert lisse.

#### Ombres qui ne tremblent plus
- Le soleil avance par pas de 0,1° au lieu de tourner un peu à chaque image : la carte d'ombre tournait avec lui, et
  toutes les ombres plus fines que ses texels (escaliers de secours, bordures de trottoir, pied des murs) rampaient et
  scintillaient en permanence pendant que l'heure passait.
- Les escaliers de secours ne projettent plus que leurs paliers et leurs marches : leurs barreaux, plus fins qu'un texel
  d'ombre, apparaissaient et disparaissaient de la carte d'ombre à chaque mouvement du soleil.
- L'ombre de contact sous le joueur était celle des voitures (un rectangle sombre, des taches sous les roues) : c'est
  maintenant une ombre ronde, légère, qui ne fait que poser le corps au sol à l'ombre.
- L'occlusion ambiante à l'écran (GTAO) essayée pendant cette version est retirée : calculée à demi-résolution sans
  débruitage, son grain restait fixe à l'écran et tremblait sur les bordures, le pied des murs et autour du joueur.
- Graffitis des rideaux de fer : deux tags tirés au hasard pouvaient se chevaucher à la même profondeur et se disputer
  chaque pixel commun. Chacun a maintenant sa place sur le rideau et sa profondeur ; les bords des lettres et des tags
  sont lissés par l'anticrénelage (alpha to coverage) au lieu d'un découpage net qui crépitait au moindre mouvement.
- Deux empreintes du relevé qui partagent un mur sur rue (un immeuble et un doublon de son contour) y plaçaient chacune
  leurs boutiques, rideau sur rideau : la première les garde.

#### Validation et limites
- 411 tests réussis (10 nouveaux sur les immeubles) ; seul l'échec connu de `tree-geodata` subsiste, lié à la licence
  Xcode. Build statique vérifié.
- Joué dans un Chrome séparé en WebGPU, de jour et de nuit, dans six quartiers, au-dessus de Midtown et dans une rue
  témoin (9e Rue Est) : aucune erreur. À résolution fixe (0,8), 69 à 75 images par seconde en qualité ÉQUILIBRÉE dans un
  Chrome sans écran, contre 49 à 69 pour la 0.9.3 aux mêmes endroits.
- Le scintillement des ombres, mesuré caméra immobile et horloge en marche : sans pas du soleil, deux images à une
  demi-seconde d'écart diffèrent partout sur les ombres des escaliers de secours ; il n'en reste que les pas eux-mêmes.
- Les fenêtres restent ouvertes dans un mur plat (leur embrasure est simulée) ; pas encore de perrons devant les maisons
  de ville ni de balcons. Les données datent de 2014 à 2025 : un immeuble récent peut manquer.

## 0.9.3 — Main Street — 3 novembre 2026

Les rez-de-chaussée de Manhattan refaits de bout en bout. Les boutiques étaient peintes à plat sur les façades, toutes de
la même largeur, avec seize enseignes génériques et une vitre sombre. Elles sont maintenant construites en relief, une par
une, là où la ville en recense une vraie.

### Les vraies boutiques, à leur place
- 25 259 boutiques placées à partir des registres publics de New York : la position de chaque vitrine, la rue de son
  adresse, si elle est vide (registre des vitrines 2025), l'activité de chaque immeuble (registre 2021-2022, les
  catégories des années suivantes étant faussées) et chaque restaurant avec sa cuisine (inspections sanitaires).
- Trente types : épicerie, pizzeria, café, boulangerie, traiteur asiatique, japonais, latino, restaurant, bar, snack,
  bar à jus, laverie, pressing, barbier, onglerie, pharmacie, banque, vêtements, maison de luxe, bijouterie, téléphones,
  quincaillerie, fleuriste, vins, livres, bureau, souvenirs, chaussures, galerie, local vide.
- Le quartier compte : la 47e Rue entre la 5e et la 6e Avenue est le quartier des diamantaires, la 5e Avenue et Madison
  ont leurs maisons de luxe, Chelsea ses galeries, Chinatown ses traiteurs, Harlem ses épiceries et ses boutiques de
  téléphones. Les avenues sont bordées de boutiques d'un bout à l'autre.
- Chaque boutique trouve le mur de son immeuble qui donne sur sa rue, jamais un mur mitoyen. La largeur dépend du type
  (une banque prend plus de place qu'un barbier).

### Des devantures en relief
- Piliers dans la brique ou la pierre de l'immeuble (même teinte que la façade au-dessus), bandeau d'enseigne,
  corniche, soubassement, vitrines à meneaux, imposte, portes simples ou doubles avec poignée et plaque de propreté.
- Entrées en retrait : les vitrines avancent, des vitres de retour mènent à la porte, sol en granito.
- Matières photographiées (Poly Haven, CC0) : bois verni, planches peintes, granit, pierre, carrelage, granito, tôle,
  inox brossé, rideau de fer. Saleté au pied des murs.
- Les piliers et les vitrines sont solides : le joueur et les voitures butent dessus.

### Des enseignes nettes et toutes différentes
- Noms inventés pour chaque boutique (« Lotus Kitchen », « Café Delorme », « Bridge Suds »…), jamais une vraie marque :
  un test le vérifie. Les banques portent les marques du jeu (Hauturier, Gréville, Valmont, Brisant, Corsaire).
- Les lettres sont calculées à l'écran à partir d'un atlas à champ de distance de douze polices libres : nettes de près
  comme de loin, et aucune enseigne n'est une image.
- Caissons lumineux, panneaux peints éclairés par des lampes col-de-cygne, lettres en laiton, néons, lettrage sur la
  vitre, enseignes perpendiculaires (« PIZZA », « BAR », croix de pharmacie), enseigne OPEN en néon, panneau FOR LEASE
  sur les locaux vides.
- Plus aucune vraie marque dans le décor : les anciennes enseignes (dont une chaîne de pharmacies) sont supprimées, le
  panneau de soda de Times Square (qui imitait l'habillage d'une marque célèbre) devient le ginger ale Valmont, et les
  deux enseignes géantes du Queens et de Williamsburg portent les marques du jeu (Corsaire Cola, Gréville Sugars).

### Derrière la vitre, une vraie pièce
- Trente intérieurs meublés, un par type, calculés hors du jeu par lancer de rayons (éclairage indirect, ombres douces) :
  rayons et frigos d'épicerie, comptoir et four à pizza, tables nappées, comptoir de bar et bouteilles rétroéclairées,
  machines de laverie, fauteuils de barbier, vitrines de bijoux, mannequins, rayons de livres, œuvres de galerie…
- La pièce recule quand on bouge, et le mobilier proche de la vitre glisse devant elle (deux couches de parallaxe).
- La vitre reflète les façades d'en face, le ciel et la rue. De jour la pièce est sombre derrière les reflets, la nuit
  elle s'allume.

### La rue
- Auvents rayés ou unis, avec le nom ou le slogan sur le lambrequin.
- Chevalets à la craie, étals de fruits devant les épiceries, seaux de fleurs, tables de bistrot, poteaux de barbier,
  trappes de cave en tôle dans le trottoir.
- La nuit, les rideaux de fer descendent selon les horaires de chaque type (l'épicerie ne ferme jamais, le bar ouvre à
  16 h), avec des tags dessus. Les néons et les caissons s'allument, des spots éclairent les trottoirs devant les
  boutiques ouvertes.
- Au-delà de 250 m (300 m en qualité HAUTE, 170 m en FLUIDE), les façades peignent encore leurs boutiques, comme avant.

### Validation et limites
- 404 tests réussis sur 405 ; seul l'échec connu de `tree-geodata` subsiste, lié à la licence Xcode. Build statique
  vérifié.
- Joué dans un Chrome séparé en WebGPU, de jour et de nuit : 25 259 boutiques dans la ville, environ 200 construites
  autour du joueur, aucune erreur. Entre 43 et 57 images par seconde en qualité ÉQUILIBRÉE dans un Chrome sans écran,
  qui ne remplace pas une mesure sur le vrai écran.
- Les étagères du fond de certains intérieurs entrent encore dans le mur : l'outil est corrigé, l'atlas reste à
  recalculer. L'éclairage de nuit (néons, vitrines) n'est pas encore réglé finement.



Correctif pour les essais en ligne : les chocs entre voitures sont stabilisés. L'Architecte arrive comme outil de
développement local expérimental ; il est exclu du jeu publié.

### Collisions automobiles
- Une secousse de suspension conserve la vitesse et la rotation calculées par la collision, au lieu de rétablir leur
  valeur d'avant le choc.
- Les secousses sont limitées et réservées aux voitures sur leurs roues : pousser contre un véhicule bloqué ne doit
  plus faire cabrer puis décoller la voiture à chaque image.
- Les voitures suffisamment séparées en hauteur ne se heurtent plus dans la couche de collisions planes, en ville et
  entre véhicules de jeu.
- Un véhicule expulsé du trafic apparaît à la position corrigée après le contact, quitte son ancienne voie et reçoit
  une impulsion verticale réduite. Sa copie dans le trafic ne continue plus à le pousser.
- Tests de régression sur les contacts prolongés, les vitesses après choc, les passages au-dessus du trafic et la
  réception des voitures percutées.

### L'Architecte — développement local
- Personnage à pied, en voiture ou en hélicoptère, avec commandes, défense et passage de caméra par L.
- Capteurs, captures, liens de reproduction, journal et tickets avec validation du Créateur.
- Serveur local, cerveau Claude, salle de contrôle et atelier de correction des tickets validés.
- Les modules et styles de l'Architecte sont exclus de `dist/`, sans import statique ni préchargement. Le chargement
  dynamique est réservé aux hôtes locaux ; `?architecte=0` permet un essai local sans lui.
- `.env.local` et `chantier/` sont ignorés par Git ; la clé API est utilisée côté serveur.

### Validation et limites
- Revue locale : 397 tests réussis sur 398 ; seul l'échec connu de `tree-geodata` subsiste, lié à la licence Xcode.
- Build statique vérifié dans un Chrome séparé en WebGPU : marche, entrée en voiture, conduite, collisions et soins
  après une mort ordinaire. Aucun chargement de l'Architecte sous un nom d'hôte public simulé.
- Campagne complète et longues sessions non rejouées ; cerveau et atelier non validés avec de vrais appels lors de
  cette revue. Dans l'outil local, la pause et le plafond de dépense ne coupent pas les appels restants d'une pensée
  déjà en cours.

## 0.9.1 — Leverage, le ciel

Le vol refait de bout en bout : la wingsuit et le parachute ne donnaient aucune sensation, et on avait du mal à se mettre
en l'air.

### Entrer dans les airs
- **Sauter d'un toit en courant ouvre la wingsuit tout seul.** Une chute sans élan passe en chute libre : Espace ou Maj
  ouvrent la wingsuit, F le parapente. Une consigne s'affiche au milieu de l'écran.
- La wingsuit « mord » l'air dès l'ouverture : on vole après une vingtaine de mètres au lieu de tomber comme une pierre.

### La wingsuit
- **Vrai modèle de vol** : portance et traînée selon l'angle d'attaque, virage par l'inclinaison, décrochage, énergie.
  Plané à trois pour un vers 180 km/h, piqué au-delà de 260 km/h, ressource qui remonte, virages serrés.
- **On vole là où l'on regarde** : la souris (ou le stick droit) donne la direction, le corps s'incline et y va. Q/D
  inclinent.
- **Cabrer est simple** : S tire tout le corps vers le haut sur-le-champ, sans jamais décrocher. Après un piqué, une
  ressource remonte à plus de 20 m/s en échangeant la vitesse contre la hauteur. Z pique. Relâchées, les deux touches
  laissent la combinaison revenir d'elle-même au plané, et un piqué oublié se redresse seul.
- **Nouvelle combinaison** : ailes de bras et aile de queue tendues sur le squelette, gonflées par l'air, bords de fuite qui
  battent à grande vitesse, couleurs citron et blanc qui se lisent sur les toits sombres. Tête relevée, corps posé sur sa
  trajectoire et incliné dans les virages.
- **Fumigènes** aux chevilles, comme les vrais pilotes, au-delà de 110 km/h.
- **Sécurité** : au-dessus de la rue, à moins de deux secondes du sol, le parapente s'ouvre seul.

### Les sensations
- **Caméra de vol** : derrière le regard, qui recule et s'élargit avec la vitesse (jusqu'à +28° de champ, avec le flou de
  vitesse), roule dans les virages, tremble avec l'air, plus fort au ras des façades. Elle ne fixe jamais le sol à la
  verticale.
- **Filets d'air** qui défilent autour de la caméra, plus longs avec la vitesse.
- **Rugissement du vent** qui monte avec la vitesse, et un souffle à chaque façade frôlée.
- **La glisse** : dans les virages la caméra s'écarte vers l'extérieur et l'horizon penche avec la combinaison ; au-delà de
  140 km/h, des tourbillons blancs filent des poignets.

### Le parapente (remplace le parachute)
- **Une vraie voile** : onze caissons sur un arc, profil d'aile, bouches d'entrée d'air, coutures, couleurs nettes par
  caisson, suspentes jusqu'aux élévateurs et freins jusqu'aux mains. Elle s'ouvre d'un paquet froissé avec un claquement,
  se creuse du côté du frein, et retombe devant le pilote à l'atterrissage.
- **Pilotage** : la souris dirige ; Q/D tirent un frein (virage, spirale si on insiste), S les deux (ralentir, et arrondir
  juste avant le sol pour se poser en douceur), Z l'accélérateur. F largue la voile pour retomber en chute libre.
- **Pilote en sellette**, assis, mains sur les commandes, balancé dans les virages.
- Atterrissage doux, roulé-boulé ou chute selon la vitesse ; on se pose aussi sur les toits.

### Le vent
- Un vent qui suit la météo (de 13 km/h par beau temps à 43 km/h dans l'orage), plus fort en altitude, en rafales.
- **Ascendances** : le vent qui rencontre une façade monte le long de celle-ci ; sous le vent d'une tour, l'air descend.
  Un parapente peut tenir, voire monter, devant un gratte-ciel.
- Altimètre, vitesse, **variomètre** et **vent** (flèche, force, ascendance) en bas à droite.

### Corrections
- Le corps qui tombe à la verticale n'avait aucune direction de portance : la wingsuit partait au hasard.
- **Le carré noir sous le héros** (là depuis le début) : son ombre de contact restait collée aux pieds en l'air. Elle reste
  maintenant au sol, rétrécit quand on s'élève et disparaît au-dessus de 2,5 m.

## 0.9.0 — Leverage

Manhattan est vertical ; le jeu ne l'était pas. Les immeubles avaient leur vraie hauteur, mais le sol était plat partout.

### Les toits
- **117 000 toits jouables** à leur hauteur réelle : on y marche, on passe d'un immeuble à l'immeuble voisin, on tombe
  de leur bord. Espace face à un rebord à portée (jusqu'à 2,7 m) l'escalade.
- **Chutes** : se réceptionner trop vite fait mal, et au-delà d'un étage on se retrouve au sol.
- **Hélicoptère** : il se pose sur n'importe quel toit, et F en sort à pied au lieu de sauter en parachute.
- **Parachute** : il se pose aussi sur les toits.

### Le grappin « Levier »
- C'est une **arme** à part entière, la septième du sélecteur (7, Tab ou la molette ; E le sort et le range). Clic droit
  pour viser, clic pour tirer ; en l'air ou suspendu, le clic suffit. Le crochet attend au bout du lanceur, et le viseur
  vire au citron quand il mordrait, au rouge quand c'est hors de portée.
- Visée sur une **façade** : il hisse jusqu'au rebord du toit si celui-ci est à portée (95 m), et l'on passe par-dessus.
  Sinon il monte aussi haut que la corde le permet, on reste suspendu, et un nouveau tir repart plus haut. Une tour de
  280 m se gravit en trois coups.
- Sur une **voiture** : on se pose sur son toit et on la surfe, accroupi, arme en main. F entre par la vitre et prend le
  volant sans qu'elle s'arrête.
- Sur **quelqu'un** : on l'arrache du sol.
- En chute libre ou en wingsuit, il rattrape une façade. Maj lâche la corde en gardant l'élan.

### La chute libre et la wingsuit
- Une chute de plus de 24 m devient une **chute libre**, bras en arc. On s'y dirige, et le parachute s'ouvre seul au
  dernier moment si on l'a oublié.
- **Wingsuit** (Espace en chute libre) : elle plane à trois pour un vers 160 km/h, pique au-delà de 250 km/h et cabre
  pour remonter avant de décrocher. La toile est tendue sur le squelette, des poignets aux chevilles.
- **Frôlements** : passer près d'une façade ou d'un toit remplit une jauge qui paie à la fin du passage.
- **Altimètre** : hauteur au-dessus du sol et vitesse, avec la jauge de frôlement. Le vent rugit avec la vitesse.
- Percuter un mur en altitude fait partir en vrille : quelques secondes pour ouvrir le parachute.
- Sauter d'un hélicoptère ou d'un avion en altitude donne une chute libre, donc une wingsuit.

### La police monte aussi
- Des agents prennent l'**escalier** et sortent par la porte du toit.
- À quatre étoiles, une **équipe descend en rappel** de l'hélicoptère sur votre toit.
- À trois étoiles, des **tireurs d'élite** se postent sur les toits voisins, chacun signalé par un **laser rouge**.
- L'hélicoptère vole au-dessus des tours et éclaire le joueur où qu'il soit.
- Personne ne marche dans le vide : agents et gardes restent sur leur toit.

### Contenu
- **Course des toits** (5e Avenue & 39e Rue) : six toits enchaînés, tirés des vrais immeubles, contre la montre.
- **Descente** (5e Avenue & 42e Rue) : le toit d'une tour de 280 m, des anneaux le long de la descente la plus dégagée,
  une zone d'arrivée.
- **Effet de levier** (contrat de Jules, 6e Avenue & 44e Rue) : les registres de Cazal au dernier étage d'une tour gardée.
  On entre par le toit, on en repart en wingsuit, quatre étoiles aux trousses.

### Touches à pied
- **Espace fait courir** (maintenu), **Maj fait sauter** (et escalader un rebord). À la nage, Espace pour le crawl. En
  voiture rien ne change : Espace frein à main, Maj nitro. Manette : A saute, le clic du stick gauche fait courir.

### Pour s'amuser
- **Toutes les armes dès le départ**, chargées, avec dix chargeurs d'avance. Une sauvegarde existante est complétée.

### Corrections
- Un hélicoptère posé, la descente maintenue, se percutait au sol à chaque image jusqu'à exploser.
- La touche E ne sert plus de second saut : elle sort le grappin.

## 0.8.0 — Hostile Takeover

### La police chasse
- **Tactiques** : une voiture vise l'arrière de la vôtre pour la faire partir en tête-à-queue, les autres montent sur les flancs.
- **Barrages** sur la route devant vous dès trois étoiles, avec agents en couverture. **Herses** dès quatre : les pneus crevés roulent sur la
  jante dans les étincelles, jusqu'à la carrosserie.
- **Tirs** depuis les voitures et tireur d'élite dans l'hélicoptère. Les voitures hors de vue comblent leur retard, jusqu'à six en même temps.
- **Saccades supprimées** : l'alarme rouge et bleue de l'écran redessinait toute la page à chaque image et faisait tomber le jeu à 8 images
  par seconde dès que la police vous voyait.

### L'eau
- **Hors-bord** en acajou verni, qui se cabre puis déjauge, gîte en virage, saute sur la houle et retombe dans une gerbe d'eau.
- **Sillage** et embruns, quais et jetées solides, moteur et clapot.
- **Les quais ne sont plus un mur** : une voiture peut tomber à l'eau, elle flotte un instant et coule.
- **Nage** : on sort d'un bateau en pleine eau, on regagne la rive ou on remonte à bord.
- **Garage** : tuile BATEAU, à la rive la plus proche.

### Territoires
- **Six quartiers, trois bandes** visibles sur la carte : les Dockers, la Meute, le Syndic.
- **Hommes de main** aux coins de rue, voiture lancée à vos trousses après trois morts.
- **Prises de contrôle** : vague, renforts en voiture, lieutenant. Le quartier vous rapporte ensuite de l'argent à chaque échéance.

### Téléphone (P)
- **Contacts** : Mireille répare à distance et amène le bateau, Jules efface vos étoiles, Nadia suit le casse.
- **Messages**, **contrats** avec GPS, **banque** avec la dette de la famille Roux à rembourser, **carte des territoires**.

### Acte III
- **Offre hostile** : remontée de l'Hudson et combat contre des vedettes.
- **Due diligence** : filature de la voiture d'Hélène Cazal.
- **Le casse de la Liberty Trust** : salle des coffres à tenir pendant que la charge perce, billets à ramasser, fuite en hors-bord par l'East
  River avec quatre étoiles aux trousses.
- **Prise de contrôle** : le yacht, l'escorte, puis la poursuite de Cazal sur l'eau.
- **Régate de la Batterie** : course chronométrée en hors-bord.

### Conduite
- **Bordures** : une voiture basse n'est plus catapultée par un trottoir à pleine vitesse. Les sauts restent intacts.


## 0.7.0 — Bull Run

La voiture n'est plus un point qui glisse sur un sol plat. Tout ce qui touche à la conduite est refait.

### Conduite
- **Vraie simulation** : quatre roues suspendues, chacune avec son ressort, son amortisseur et son pneu. Le poids se reporte
  au freinage, à l'accélération et en virage, les voitures plongent, s'accroupissent et prennent du roulis.
- **Moteur et boîte** : couple selon le régime, rapports réels, zone rouge, patinage au démarrage, traction avant, propulsion
  ou intégrale.
- **Dérapages** : frein à main, contre-braquage assisté, contrôle de traction et de stabilité propres à chaque voiture.
- **Vol et tonneaux** : sauts, atterrissages, tonneaux, glissade sur le toit dans les étincelles, retour sur les roues.
- **Trottoirs et pelouses** : les bordures secouent la voiture, l'herbe glisse et projette de la terre.
- **Quinze véhicules aux comportements distincts**, de la citadine à la supercar (plus de 340 km/h, 0 à 100 sous 2 secondes).
- **Nitro** (Maj) : flammes bleues, poussée, se recharge seul et plus vite avec les cascades.

### Voitures
- **Vrais modèles 3D** pour toute la circulation et le joueur : berlines, SUV, pick-up, taxis américains, utilitaires, camions.
- **Peinture recolorable** avec vernis, phares et feux de stop allumés, roues indépendantes.
- **Dégâts visibles** : tôle enfoncée, peinture arrachée, pare-brise fissuré.
- **Garage** (G) : berline, muscle car, sportive et supercar au choix.

### Caméra et sensations
- **Caméra de poursuite** refaite : elle traîne derrière la voiture en virage, la voiture se met en travers dans l'image,
  l'objectif s'élargit avec la vitesse, flou de vitesse sur les bords, vibrations de route.
- **C** pour regarder derrière. **Ralenti** sur les gros crashs et au sommet des sauts.

### Son
- **Moteur synthétisé** au régime réel, avec une voix par famille : V8 irrégulier, six à plat, V12, quatre cylindres, diesel.
- **Ratés à l'échappement**, crissement de pneus, vent, roulement, tôle qui racle, nitro, chocs de suspension.

### Dans le monde
- **Traces de pneus** qui restent sur la route, **fumée de gomme**, gerbes d'étincelles, flammes d'échappement.
- **Voitures percutées** : au-delà de 36 km/h d'écart, elles sortent de la circulation et partent en tonneaux.
- **Lampadaires en fonte** arrachés, qui tombent et restent sur la chaussée.
- **Cascades récompensées** : frôlements, dérapages, sauts, avec multiplicateur. Argent et nitro à la clé.
- **Neuf tremplins** dans Central Park, indiqués sur la carte.


## 0.6.0 — Prime Real Estate

Les façades peintes par programme disparaissent : la ville est maintenant bâtie en vrais matériaux.

### Immeubles
- **Vraie brique et vraie pierre** : briques rouge, brune et chamois, pierre de taille, photographiées et à la bonne échelle.
  Chaque immeuble a sa teinte, avec ses taches et ses coulures de suie sous les appuis de fenêtre.
- **Fenêtres dans l'épaisseur du mur** : la vitre recule quand on passe, le tableau de la fenêtre apparaît, et le soleil
  projette son ombre sur le verre.
- **Vitres** : stores et rideaux dans une fenêtre sur deux, reflets de la rue et du ciel, linteaux de pierre sur la brique.

### Rues
- **Goudron** : vrai bitume photographié, avec ses fissures, sans les grosses lignes noires d'avant.
- **Trottoirs** : vrai béton sous les joints, chewing-gums et fissures.
- **Commerces** : seize enseignes en plusieurs polices sur panneaux de couleur, vitrines sombres où l'on voit l'intérieur,
  auvents de toile rayée en pente.
- **Objets réels** : bouches d'incendie, sacs poubelle en tas, poubelles, jardinières, armoires techniques et blocs béton,
  tous renversables en voiture.

### Lumière
- **Ombres naturelles** : dans une rue à l'ombre on voit enfin les couleurs, plus de bleu nuit presque noir.

## 0.5.0 — Hard Assets

La ville devient solide, et ses parcs deviennent vrais.

### Collisions
- **Voie rapide** : les voitures de l'Hudson étaient un décor qu'on traversait. Elles se percutent maintenant comme les
  autres : le conducteur pile, sa voiture est poussée hors de sa file, puis il repart. Elles renversent aussi les piétons.
- **Arbres** : plus de 54 000 troncs arrêtent les voitures et les passants. Le choc fait tomber les feuilles.
- **Mobilier urbain** : lampadaires, feux et poteaux sont solides. Les chariots et barrières aussi.
- **Bouches d'incendie et boîtes aux lettres** : elles cèdent sous la voiture, et l'eau jaillit de la bouche arrachée.
- **Balles** : les troncs les arrêtent.

### Arbres
- **Vraies feuilles** : scannées, posées une à une le long de rameaux dans un nouvel atlas de 4096 pixels.
- **Vraies écorces** : photographiées, avec leur relief, et racines qui s'évasent au pied du tronc.
- **Dix fois plus de détail de près** : jusqu'à 5 000 triangles par arbre, contre 530, sur quatre niveaux de distance.
- **Quatrième espèce** : les vieux chênes des parcs, en plus des platanes, féviers et ormes.
- **Lumière** : le soleil traverse les feuilles, et chaque feuille a son relief.

### Herbe
- **Pelouses photographiées**, avec des zones plus sèches et plus vertes, sans répétition visible.
- **Vrais brins** : des dizaines de milliers de touffes autour de la caméra, qui ondulent au vent.
- Le niveau graphique FLUIDE retire les brins et réduit la portée des arbres détaillés.

## 0.4.1 — Human Capital, de vraies personnes

Les corps sculptés par programme sont remplacés par de vrais modèles humains et de la vraie motion capture.

### Personnages
- **Sacha Roux** : nouveau modèle, visage peint, cheveux, blouson de cuir, baskets ; il cligne des yeux.
- **Police** : quatre tenues réelles, de l’agent en uniforme au SWAT selon les étoiles.
- **Piétons** : 24 personnes différentes, 12 hommes et 12 femmes, avec chacune son visage et ses vêtements.

### Mouvement
- **Motion capture** : marche, course, sprint, attente, accroupissement, enregistrés sur de vrais acteurs.
- **Le pas suit la vitesse** : les pieds ne glissent plus, et on recule ou marche de côté en visant.
- **Piétons** : démarches variées, téléphone, café, parapluie ; pour un coût processeur presque nul.

### Armes
- **Vrais modèles texturés** : pistolet, pistolet-mitrailleur, fusil à pompe, fusil d’assaut.
- **Tenue** : les doigts se referment sur la crosse, la main gauche soutient le garde-main ou la pompe.
- **Sans viser** : pistolet le long de la jambe, arme longue en travers du corps, canon vers le sol.
- **En visant** : pistolet à deux mains, crosse à l’épaule, buste de profil, tête alignée sur la cible, recul à chaque tir.

## 0.4.0 — Human Capital

Les mannequins disparaissent : tout le monde a maintenant un vrai corps.

### Personnages
- **Corps sculptés** : anatomie, visages (nez, lèvres, oreilles, paupières), mains à cinq doigts, vêtements avec
  plis ; générés par `tools/build-humans.mjs`, sans aucun fichier externe.
- **Sacha Roux** : blouson zippé à bords côtelés, jean, baskets, barbe de trois jours, yeux avec iris.
- **Matières** : peau (zones de couleur, sourcils, lèvres, cils), cheveux, toile, denim, coutures.
- **Squelette à 23 os** : taille, cou, clavicules, poignets, doigts.

### Mouvement
- **Chutes physiques** : un corps touché, renversé ou soufflé tombe selon l’impact, puis repose au sol.
- **Tir** : crosse à l’épaule, pistolet à deux mains, buste et tête qui suivent la cible, rechargement.
- **Coups** de poing des deux mains, recul sous les impacts, poings qui se ferment en courant.
- **Sacha** regarde où vous regardez, et s’agenouille mains sur la tête quand il est arrêté.

### Piétons
- **Neuf tenues** (costume, sweat à capuche, t-shirt, manteau, robe, jupe…), huit coiffures, carrures variées.
- **Accessoires** : téléphone, café, sac, sac à dos, parapluie sous la pluie.
- **Réactions** : ils tournent la tête vers vous, se protègent ou fuient, lèvent les mains si vous les braquez.

### Police
- **Uniforme complet** : gilet pare-balles marqué POLICE, ceinturon, holster, radio, casquette, bottes.
- **Tactique** : couvert derrière la voiture, tir accroupi, à genou, rechargement à l’abri, ordres criés.

## 0.3.3 — Margin Call

### Nouveau
- **Sélecteur d’armes** : petit bouton à côté du garage (touche Tab). Il montre les six armes et leurs munitions ;
  une arme que l’on n’a pas encore affiche son prix, et la choisir trace la route vers l’armurerie Calibre la plus proche.
- **Un pistolet dès le début** : le Calypso 9, avec trois chargeurs.

### Corrigé
- Au pavé tactile, un glissement faisait défiler les armes en boucle : un glissement change désormais d’une seule arme.
- Une touche 1 à 6 sur une arme que l’on n’a pas ne restait plus sans réponse : un message le dit.

## 0.3.2 — Margin Call

### Nouveau
- **Garage rapide** : petit bouton à côté du radar (touche G), à tout moment : à pied, voiture, moto, vélo,
  hélicoptère, avion. Le jeu se fige le temps de choisir.
- **Hélicoptère et vélo** de retour, pilotables, avec les dégâts et les collisions du jeu.
- **Avion Hauturier Sterne** : banquer pour tourner, décrochage sous 100 km/h, atterrissage et décollage dans
  les avenues. Choisi depuis le sol, il apparaît en vol, au-dessus des immeubles.
- **Parachute** : F en vol pour sauter, ZQSD pour se diriger ; un crash en altitude éjecte le pilote.

### Modifié
- **Armes conservées** : la mort comme l’arrestation laissent toutes les armes et leurs munitions, chargeurs pleins ;
  une arme vidée revient avec un chargeur.
- L’arme se porte sur le côté, bien visible depuis la caméra.

## 0.3.1 — Margin Call

### Performance
- **Trois niveaux graphiques** (Haute, Équilibrée, Fluide), dans le menu ; Équilibrée devient le niveau par défaut.
- **Résolution adaptative** : l’image s’adoucit un peu si la carte graphique sature, puis remonte d’elle-même.
- **Retard réduit** : deux images au plus attendent la carte graphique, contre quatre ou cinq auparavant.
- **Scène allégée** : les 20 000 éléments de rue sont rangés par zones de 500 m, moins d’appels de dessin,
  la cascade d’ombre lointaine ignore les petits objets, et le niveau Équilibrée retire les reflets écran.
- `?stats=1` détaille le temps par système.

### Corrigé
- La barre de touches annonce bien les armes 1 à 6.

## 0.3.0 — Margin Call

### Nouveau
- **Acte II — Margin Call** : *Appel de marge* (défense du garage en trois vagues), *Délit d’initié*
  (filature discrète, puis poursuite si vous êtes repéré), *Liquidation* (fourgon blindé et escorte
  à immobiliser, convoyeurs, sacs de billets) et *Vente à découvert* (assaut de l’entrepôt de Varga,
  fuite en voiture, face-à-face).
- **Cycle jour/nuit continu** (environ 32 minutes par jour) qui fond les ambiances lumineuses entre elles,
  horloge à l’écran, choix de l’heure dans le menu.
- **Météo** : dégagé, nuageux, pluie, orage ; pluie autour de la caméra, rues mouillées et glissantes,
  éclairs et tonnerre, bruit de pluie.
- **Motos** : Brisant Vandale 650, physique dédiée, inclinaison dans les virages, wheeling (Maj),
  pilote visible, chute et éjection en cas de choc violent.
- **Boutiques** : armurerie *Calibre*, carrosserie *Éclair* (réparation, peinture, semer la police),
  quatre planques à acheter ou à gagner (dormir 8 heures, soins, sauvegarde).
- **Armes** : fusil d’assaut *Sentinel* et grenades *Éclat* (lancer en cloche, rebonds, explosion).
- **Pilote IA** commun à la police et aux missions : suivi d’itinéraire par point de visée glissant,
  vitesse adaptée aux virages, contournement du trafic et des véhicules arrêtés.

### Corrigé
- Les voitures de police ne tournent plus en rond autour d’un carrefour : quatre unités sur quatre
  rejoignent désormais le joueur.
- Les explosions en chaîne sont limitées.
- Les marqueurs de mission ne restent plus affichés après la fin d’une étape.

## 0.2.0 — Opening Bell

Le playground devient un jeu, et prend son nom : **OVERDRAFT**.

### Nouveau
- **Niveau de recherche à cinq étoiles** : la police fouille une zone qui suit le réseau routier
  autour de la dernière observation (visible sur la carte), étoiles clignotantes pendant la recherche,
  jauge de fuite hors de vue, voitures de police guidées par A*, agents à pied, hélicoptère avec
  projecteur, arrestations, trafic qui se range devant les sirènes.
- **Combat** : souris verrouillée, visée à l'épaule, tir à la hanche, poings, tirs à la tête, recul,
  dispersion, rechargement, tir depuis la voiture ; quatre armes originales (Calypso 9, Hornet, Breaker 12).
- **Dégâts et mort** : santé, gilet pare-balles, régénération lente, chute quand on est percuté,
  « FLATLINED » et « CUFFED », réapparition à l'hôpital ou au commissariat.
- **Véhicules destructibles** : fumée, incendie, explosions en chaîne (limitées), épaves calcinées,
  débris, traces de brûlure ; collisions entre véhicules de jeu ; piétons et agents percutés.
- **Ville réactive** : panique et fuite des piétons, conducteurs qui accélèrent sous les tirs.
- **Acte I — La Dette** : quatre missions d'histoire avec dialogues.
- **Activités** : Course de rue (parcours générés), Convoyage, Prime.
- **Radio procédurale** : cinq stations, musique générée en temps réel.
- **Objets** : argent, soins, gilets, armes et munitions dans la ville et sur les adversaires.
- **Interface** : argent, santé/gilet, étoiles, arme et munitions, réticule, marqueurs d'impact,
  objectifs, sous-titres, chronomètre, bandeaux ; GPS qui suit les rues.
- Sons de combat synthétisés (tirs, explosions, ricochets, coups) et jingles d'interface.
- Sauvegarde v2 (argent, armes, progression, statistiques), qui relit les sauvegardes précédentes.

### Modifié
- Nouveau nom : OVERDRAFT (anciennement « Contre-Marée »).
- Marques de véhicules entièrement originales (Valmont, Brisant, Gréville, Hauturier).
- Un clic sur la carte place un point de passage (la téléportation n'existe qu'avec `?debug=1`).
- Le menu présente l'histoire et la progression.

## 0.1.1 — Playground
- Personnage à la troisième personne, conduite, entrée et sortie des véhicules (base Codex sur Slop New York).
