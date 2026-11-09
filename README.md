# OVERDRAFT

> Every debt gets paid.

Un jeu d'action en monde ouvert pour navigateur, dans un Manhattan reconstruit à l'échelle 1:1.
Version **0.9.11 — Short Squeeze**. Les armes sont de vrais modèles, et Sacha sait les porter : pistolet à l'étui sur
la cuisse, fusil d'assaut et fusil à pompe en bandoulière dans le dos, pistolet-mitrailleur sous la veste. Il les dégaine
et les rengaine, les tient à une main quand la rue est calme, à deux quand ça chauffe, et les épaule pour viser.

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
Cliquez dans la vue pour verrouiller la souris ; Échap la libère et ouvre le menu.

### À pied

| Touche | Action |
|---|---|
| ZQSD / WASD / flèches | Se déplacer |
| Tab | Sélecteur d'armes (souris, pavé tactile ou clavier) |
| 1 à 7 | Choisir une arme directement (7 : le grappin) |
| G | Garage rapide : quinze voitures, à pied, moto, vélo, bateau, hélicoptère et avion |
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
| Avion | Z/S piquer ou cabrer, Q/D virer, Espace et C pour les gaz, F sauter |
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

Manette standard prise en charge (sticks, gâchettes, A pour sauter, clic du stick gauche pour courir, X pour tirer le
grappin, épaule pour interagir, Y pour la caméra).

## Dans la ville

- **Marqueurs verts** : missions d'histoire. **Orange** : courses, convoyages, primes.
- Près du départ, sur la 5e Avenue : la **Course des toits** (39e Rue), la **Descente** en wingsuit (42e Rue) et,
  sur la 6e Avenue, le contrat **Effet de levier** de Jules.
- **Violet** : armurerie *Calibre* (armes, munitions, gilets, grenades) et carrosserie *Éclair*
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

```sh
npm test
npm run build
```

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
| `js/shops.js` | Armureries, carrosseries, planques |
| `js/motorbike.js` | Motos (modèle, inclinaison, wheeling) |
| `js/quick-strip.js` | Bouton et bandeau communs au garage et au sélecteur d'armes |
| `js/garage.js`, `js/arsenal.js` | Garage rapide, sélecteur d'armes |
| `tools/world/` | Prépare les textures de la ville et importe les objets de rue dans `assets/world/` |
| `tools/nature/` | Compose l'atlas de feuilles et prépare écorces et herbe dans `assets/nature/` |
| `tools/people/` | Importe les avatars, les armes et la motion capture Rocketbox dans `assets/people/` |
| `tools/build-humans.mjs`, `tools/humans/` | Sculpte les accessoires de la foule dans `assets/humans/` |
| `js/characters.js`, `js/person-body.js`, `js/person-motion.js` | Personnages : squelette, motion capture, tenue des armes |
| `js/mocap.js`, `js/crowd-motion.js` | Lecture de la motion capture, poses de la foule |
| `js/people-assets.js`, `js/people-material.js`, `js/human-crowd.js` | Chargement des modèles, matières, rendu de la foule |
| `js/trees.js`, `js/grass.js`, `js/nature-assets.js` | Arbres, brins d'herbe, textures de la nature |
| `js/world-assets.js`, `js/street-clutter.js` | Surfaces de la ville, objets de rue |
| `js/ragdoll.js` | Chutes physiques des corps |
| `js/airplane.js`, `js/flight.js` | Avion et parachute (modèles), modèle de vol |
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
