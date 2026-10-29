# OVERDRAFT

> Every debt gets paid.

Un jeu d'action en monde ouvert pour navigateur, dans un Manhattan reconstruit à l'échelle 1:1.
Version **0.2.0 — Opening Bell** : combat, poursuites policières avec niveau de recherche à cinq
étoiles, missions de l'Acte I, activités répétables, véhicules destructibles et radio à musique
générée en temps réel.

Vision, niveau de recherche et feuille de route : [GAME_DESIGN.md](GAME_DESIGN.md).
Nouveautés : [CHANGELOG.md](CHANGELOG.md).

## Jouer

Navigateur de bureau récent avec accélération matérielle (Chrome ou Edge recommandés, WebGPU).
Cliquez dans la vue pour verrouiller la souris ; Échap la libère et ouvre le menu.

### À pied

| Touche | Action |
|---|---|
| ZQSD / WASD / flèches | Se déplacer |
| Souris | Regarder |
| Maj | Sprint |
| Espace | Sauter |
| Clic gauche | Frapper / tirer |
| Clic droit (maintenu) | Viser à l'épaule |
| R | Recharger |
| 1 à 4, molette | Choisir une arme |
| F | Voler / monter dans un véhicule |

### En voiture

| Touche | Action |
|---|---|
| ZQSD / WASD | Accélérer, freiner, tourner |
| Espace | Frein à main |
| Clic droit + clic gauche | Tirer par la vitre (pistolet, pistolet-mitrailleur) |
| T / Maj+T | Station de radio suivante / précédente |
| B | Klaxon |
| R | Remettre le véhicule d'aplomb (à l'arrêt) |
| F | Descendre (à l'arrêt) |

### Partout

M : carte (un clic place un point de passage) · V : caméra · Entrée : passer un dialogue ·
H : masquer l'interface · N : couper le son · Échap : pause.

Manette standard prise en charge (sticks, gâchettes, A pour sauter, épaule pour interagir, Y pour la caméra).

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

- `?stats=1` : moteur graphique et images par seconde.
- `?quality=performance` : résolution réduite, sans ombres du soleil.
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
| `js/wanted.js` | Niveau de recherche : étoiles, zone de recherche, IA de poursuite, agents, hélicoptère |
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
