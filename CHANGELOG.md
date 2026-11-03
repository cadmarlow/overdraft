# Changelog

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
