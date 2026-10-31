# OVERDRAFT

> Every debt gets paid.

Un jeu d'action en monde ouvert pour navigateur, dans un Manhattan reconstruit à l'échelle 1:1.
Version **0.4.1 — Human Capital** : deux actes d'histoire (8 missions), cycle jour/nuit continu et
météo (pluie, orages), motos, boutiques et planques, grenades et fusil d'assaut, police à cinq
étoiles pilotée par une IA de conduite, véhicules destructibles et radio générée en temps réel.

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
| 1 à 6 | Choisir une arme directement |
| G | Garage rapide : à pied, voiture, moto, vélo, hélicoptère, avion |
| Souris | Regarder |
| Maj | Sprint |
| Espace | Sauter |
| Clic gauche | Frapper / tirer |
| Clic droit (maintenu) | Viser à l'épaule |
| R | Recharger |
| 1 à 6, molette | Choisir une arme (6 : grenades, clic pour lancer) |
| F | Voler / monter dans un véhicule |

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

Manette standard prise en charge (sticks, gâchettes, A pour sauter, épaule pour interagir, Y pour la caméra).

## Dans la ville

- **Marqueurs verts** : missions d'histoire. **Orange** : courses, convoyages, primes.
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

Node.js 22 ou plus récent. Aucune installation de dépendances : Three.js est inclus dans `vendor/`.

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

## Architecture

| Module | Rôle |
|---|---|
| `js/gameplay.js` | Couche de jeu : joueur, armes, dégâts, véhicules, mort, arrestation, sauvegarde |
| `js/wanted.js` | Niveau de recherche : étoiles, zone de recherche, poursuites, agents, hélicoptère |
| `js/ai-driver.js` | Pilote IA (itinéraire, poursuite pure, virages, évitement) pour la police et les missions |
| `js/atmosphere.js` | Heure du jour, météo, pluie, éclairs et tonnerre |
| `js/shops.js` | Armureries, carrosseries, planques |
| `js/motorbike.js` | Motos (modèle, inclinaison, wheeling) |
| `js/quick-strip.js` | Bouton et bandeau communs au garage et au sélecteur d'armes |
| `js/garage.js`, `js/arsenal.js` | Garage rapide, sélecteur d'armes |
| `tools/people/` | Importe les avatars, les armes et la motion capture Rocketbox dans `assets/people/` |
| `tools/build-humans.mjs`, `tools/humans/` | Sculpte les accessoires de la foule dans `assets/humans/` |
| `js/characters.js`, `js/person-body.js`, `js/person-motion.js` | Personnages : squelette, motion capture, tenue des armes |
| `js/mocap.js`, `js/crowd-motion.js` | Lecture de la motion capture, poses de la foule |
| `js/people-assets.js`, `js/people-material.js`, `js/human-crowd.js` | Chargement des modèles, matières, rendu de la foule |
| `js/ragdoll.js` | Chutes physiques des corps |
| `js/airplane.js`, `js/flight.js` | Avion et parachute (modèles), modèle de vol |
| `js/quality.js` | Niveaux graphiques, rythme des images, résolution adaptative |
| `js/actors.js` | Personnages armés (police, équipages, cibles) |
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
