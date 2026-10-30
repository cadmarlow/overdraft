# OVERDRAFT — Document de conception

> Every debt gets paid.

## Le pitch

Sacha Roux débarque à New York pour régler une dette qui n'est pas la sienne : son frère, passeur pour
l'armateur Ilya Varga, a disparu en mer avec une cargaison. Varga réclame 250 000 $. Pour survivre,
Sacha travaille pour Mireille Okafor, garagiste de la 10e Avenue, et s'enfonce dans la ville.
Le titre, *Overdraft* (« découvert bancaire »), dit tout : Sacha commence la partie à découvert,
et chaque dollar se gagne au volant ou une arme à la main.

OVERDRAFT est un jeu d'action en monde ouvert dans le navigateur : conduite, combat, missions,
poursuites, dans un Manhattan reconstruit à l'échelle 1:1 à partir de données géographiques réelles
(117 000 bâtiments, 54 000 arbres, le vrai réseau routier, trafic et piétons simulés).

## Le niveau de recherche

Un système à **cinq étoiles**, dans la tradition du genre, avec une police qui ne triche pas :

- Chaque crime **vu par un témoin** fait monter la pression policière et vous vaut des étoiles :
  ★ *Signalé*, ★★ *Recherché*, ★★★ *Traqué*, ★★★★ *Ennemi public*, ★★★★★ *Chasse à l'homme*.
- La police ne sait pas où vous êtes : elle **fouille les rues** autour de la dernière observation.
  La zone de recherche suit le **vrai réseau routier** et s'affiche sur la carte.
- Les unités patrouillent dans la zone. Chaque observation (voiture, agent à pied, hélicoptère)
  la recentre sur vous ; les étoiles sont pleines quand on vous voit, elles **clignotent** pendant la recherche.
- Pour vous en sortir : **quittez la zone et restez hors de vue** jusqu'à ce que la jauge de fuite
  se remplisse. Se cacher à l'intérieur de la zone est possible, mais trois fois plus long.
- Plus il y a d'étoiles : plus de voitures, des agents mieux armés et protégés, des tireurs plus
  précis, un hélicoptère avec projecteur à partir de quatre étoiles.
- À une étoile, les agents tentent d'abord de vous **arrêter** (« CUFFED »). Ensuite, ils tirent.
- Le trafic se range devant les sirènes et les patrouilles déjà en ville rejoignent la poursuite.

## Boucle de jeu

1. Missions d'histoire chez les contacts (marqueurs verts).
2. Activités répétables (marqueurs orange) : **Course de rue**, **Convoyage**, **Prime**.
3. L'argent gagné finance la survie (soins, caution) et, à venir, les planques, armes et véhicules.
4. La ville réagit : piétons qui paniquent et fuient, conducteurs qui accélèrent ou se rangent devant
   les sirènes, voitures qui fument, prennent feu et explosent en chaîne.

## Contenu de la version 0.2 « Opening Bell »

- **Acte I — La Dette** : *Clé de contact*, *Recouvrement*, *Pièces détachées*, *Avis de recherche*.
- **Combat** : visée à l'épaule (souris verrouillée), tir à la hanche, coups de poing, tirs à la tête,
  recul, dispersion selon le mouvement, rechargement, tir depuis la voiture.
- **Armes** : Poings, *Calypso 9* (pistolet), *Hornet* (pistolet-mitrailleur), *Breaker 12* (fusil à pompe).
- **Dégâts** : santé et gilet, chute au sol percuté par une voiture, mort (« FLATLINED ») et arrestation
  (« CUFFED ») avec réapparition à l'hôpital ou au commissariat.
- **Véhicules** : santé, fumée, incendie, explosion, épaves calcinées, collisions entre véhicules de jeu,
  piétons percutés, vol de voitures de police.
- **IA** : agents et équipages armés (portée de tir, déplacements latéraux, rechargement, rafales,
  arrestations, fuite), voitures de police guidées par A* sur le réseau routier, évitement du trafic.
- **Radio** : cinq stations dont la musique est **générée en temps réel**, chaque morceau unique.
- **Interface** : santé/gilet, argent animé, étoiles de recherche, arme et munitions, réticule et
  marqueurs d'impact, objectifs, sous-titres, chronomètre, bandeaux de fin de mission, GPS qui suit les rues.

## Contenu de la version 0.3 « Margin Call »

- **Acte II — Margin Call** : *Appel de marge*, *Délit d’initié*, *Liquidation*, *Vente à découvert*.
  Sacha prend l’offensive contre Varga, aidé de Jules Ambrose, ancien trader.
- **Le temps** : journée continue d’environ 32 minutes, météo changeante (pluie, orage), rues glissantes.
- **Motos**, **armurerie**, **carrosserie** (semer la police en changeant de couleur), **planques**.
- **Armes** : fusil d’assaut *Sentinel*, grenades *Éclat*.
- **IA de conduite** partagée : la police et les véhicules de mission suivent la ville comme des conducteurs.

## Direction artistique

- Manhattan réel, ambiances lumineuses (soleil bas, midi, crépuscule, nuit), reflets en temps réel.
- Interface sobre, typographie italique grasse, accent citron (`#e1f3a0`), rouge et bleu de gyrophare.
- Tout le son est synthétisé (moteurs, sirènes, tirs, explosions, musique) : aucun fichier audio.

## Propriété intellectuelle

Le jeu est original : titre, personnages, marques (Valmont, Brisant, Gréville, Hauturier), armes,
stations de radio, missions et musique. Aucune référence à une licence existante. La ville est un
lieu réel ; les données géographiques gardent leurs licences (voir `CREDITS.md`).

## Feuille de route

Les versions portent des noms de la finance, comme la dette de Sacha.

| Version | Nom | Grands axes |
|---|---|---|
| 0.1 | Playground | Marche, conduite, entrée et sortie des véhicules (base Codex) |
| 0.2 | Opening Bell | Combat, niveau de recherche, Acte I, activités, radio procédurale, dégâts et explosions |
| **0.3** | **Margin Call** | Acte II, planques, armurerie, carrosserie, motos, cycle jour/nuit continu, météo, IA de conduite |
| 0.4 | Hostile Takeover | Acte III, gangs et territoires, braquages en plusieurs étapes, bateaux, téléphone et contacts, hélicoptère pilotable |
| 0.5 | Closing Bell | Acte III et fin, coopération en ligne, mode photo, optimisation mobile |
