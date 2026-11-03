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

## Contenu de la version 0.8 « Hostile Takeover »

- **Acte III** : *Offre hostile*, *Due diligence*, *Le casse de la Liberty Trust*, *Prise de contrôle*. Ces contrats se prennent à tout
  moment, sans attendre la fin de l’acte II. Derrière Varga, Hélène Cazal, banquière, tient la dette de la famille Roux.
- **La police chasse** : flancs et queue de poisson sur la voiture, barrages sur la route devant vous dès trois étoiles, herses dès
  quatre, tireurs aux fenêtres, tireur d’élite dans l’hélicoptère. Les voitures hors de vue comblent leur retard.
- **Territoires** : six quartiers tenus par trois bandes. Leurs hommes tiennent les coins de rue, envoient une voiture après trois morts.
  Vider un repaire donne le quartier, et le quartier paie à chaque échéance.
- **L’eau** : hors-bord à vernis et acajou, sillage, voitures qui coulent, nage. Vedettes ennemies armées.
- **Téléphone** (P) : contacts qui rendent service, messages, contrats avec GPS, banque et dette, carte des territoires.

## Contenu de la version 0.9 « Leverage »

Manhattan est vertical ; le jeu ne l'était pas. Les immeubles avaient leur vraie hauteur, mais le sol était plat partout.

- **Les toits** : les 117 000 bâtiments se parcourent à leur hauteur réelle. On y marche, on saute d'un toit à l'autre,
  on escalade un rebord à portée, on y pose l'hélicoptère et le parachute.
- **Le grappin « Levier »** (arme n° 7, E pour le sortir ; clic droit pour viser, clic pour tirer) : visée sur une façade, il hisse jusqu'au rebord du toit s'il est à portée (95 m), sinon
  aussi haut que la corde le permet, et l'on recommence. Sur une voiture : on la surfe, puis on prend le volant par la
  vitre sans qu'elle s'arrête. Sur quelqu'un : on l'arrache du sol. En plein vol, il rattrape une façade.
- **La chute libre et la wingsuit** : une chute de plus de 24 m devient une chute libre ; Espace ouvre la wingsuit, qui
  plane à trois pour un vers 160 km/h, pique au-delà de 250 km/h, cabre pour remonter. Frôler les façades et les toits
  paie comme une cascade. Le parachute (F) s'ouvre à la main, ou tout seul en dernier recours.
- **La police monte** : des agents sortent par la porte du toit, à quatre étoiles une équipe descend en rappel de
  l'hélicoptère, à trois étoiles des tireurs d'élite prennent les toits voisins, chacun signalé par un laser rouge.
  L'hélicoptère vole au-dessus des tours.
- **Contenu** : *Course des toits*, *Descente* (anneaux depuis le toit d'une tour de 280 m), contrat *Effet de levier*.
- **Pour s'amuser** : toutes les armes sont dans les poches dès le départ.

## Contenu de la version 0.9.1 « Leverage », le ciel

Le vol refait de bout en bout, jugé à côté d'un AAA :

- **Un vrai modèle de vol** : la wingsuit est un petit planeur traîné (portance et traînée selon l'incidence, virage par
  l'inclinaison, décrochage), la voile un parapente de vitesse (freins, accélérateur, arrondi, spirale). Les deux volent
  dans un vent qui souffle plus fort en altitude, en rafales, et qui monte le long des façades qu'il rencontre.
- **On vole là où l'on regarde** : la souris (ou le stick droit) donne la direction, le corps s'incline et y va. Les
  touches restent pour piquer, cabrer, freiner.
- **Entrer dans les airs sans y penser** : sauter d'un toit en courant ouvre la wingsuit tout seul ; sinon Espace ou Maj.
- **Des sensations** : caméra de vol qui recule et s'élargit avec la vitesse, flou de vitesse, roulis dans les virages,
  tremblement de l'air, filets d'air qui défilent, fumigènes aux chevilles, rugissement du vent.
- **Le parapente** : une voile en caissons, à profil d'aile, avec bouches d'entrée d'air et suspentes, qui s'ouvre d'un
  paquet froissé, se creuse sous les freins, et retombe devant le pilote à l'atterrissage.

## Correctif 0.9.2 « Leverage » — collisions et Architecte local

- **Conduite** : les impulsions de collision sont conservées, les secousses de suspension sont limitées et les voitures
  expulsées du trafic quittent leur ancienne voie. Les contacts entre voitures tiennent compte de leur séparation en
  hauteur, en ville et entre véhicules de jeu.
- **Outil de développement** : l'Architecte partage la partie locale pour repérer des problèmes, les photographier et
  proposer des tickets au Créateur. Un serveur relie son cerveau Claude, sa salle de contrôle et l'atelier de correction.
  Son fonctionnement reste expérimental ; les décisions sont consignées dans [ARCHITECTE.md](ARCHITECTE.md).
- **Essais en ligne** : l'Architecte, son serveur et ses styles restent hors du build publié. Ce correctif poursuit la
  phase de test ; les objectifs de la 1.0 restent à réaliser.

## 0.9.4 « Momentum » — la conduite

La conduite se juge au clavier, comme la joue l'utilisateur, et à côté de GTA V : une voiture doit se tenir sans effort,
glisser quand on le lui demande, et se rattraper.

- **Les aides de conduite** : volant progressif selon la vitesse, braquage limité à l'adhérence, contrôle de stabilité
  qui suit le volant, ABS qui laisse tourner en freinant, frein à main qui pivote puis repart dans le nouveau cap. Chaque
  classe garde son caractère (la muscle glisse, la supercar colle, l'utilitaire penche).
- **Mesurer avant de régler** : un banc d'essai chronomètre chaque classe (0-100, 100-0, virage, frein à main) et les
  tests verrouillent les comportements ; un pilote automatique au clavier compare les versions en ville.
- **Séparer la physique du spectacle** : la physique reste stable, le poids se montre par une suspension visuelle, la
  caméra et le son.
- **Les voitures à regarder** : reflet de la rue dans la peinture (calculé à partir des immeubles réels), habitacle et
  conducteur visibles, vue intérieure.
- **À venir** : le son moteur (enregistrements hors ligne d'un simulateur physique de moteur), les pièces de carrosserie
  qui se détachent, la casse du mobilier urbain.

## 0.9.3 « Main Street » — la rue

Les rez-de-chaussée sont ce que le joueur regarde le plus souvent : ils passaient avant tout le reste.

- **La vraie ville** : chaque boutique est là où New York en recense une (registres publics des vitrines et des
  restaurants), avec son type, ses horaires, et le caractère de son quartier. Les noms sont tous inventés.
- **Le relief** : piliers dans la pierre de l'immeuble, bandeaux, vitrines à meneaux, entrées en retrait, auvents,
  enseignes perpendiculaires, rideaux de fer. Tout est solide.
- **Les enseignes** : lettres calculées à l'écran (champ de distance), donc une enseigne différente par boutique, nette
  à toute distance ; caissons, peinture, laiton, néon, lettrage sur vitre.
- **Les intérieurs** : trente pièces meublées et éclairées par lancer de rayons hors du jeu, reprojetées derrière chaque
  vitre avec deux couches de parallaxe, et des reflets de la rue d'en face.
- **La nuit** : les rideaux descendent selon les horaires, les néons s'allument, les trottoirs s'éclairent devant ce qui
  reste ouvert.
- **Ensuite** : des halls d'immeubles soignés entre les boutiques, des intérieurs en plusieurs variantes par type, et les
  lieux emblématiques retravaillés à la main (Times Square, Grand Central, Wall Street).

## Le garage rapide

Le joueur doit pouvoir changer de monture sans jamais chercher un véhicule : le garage (touche G) fige le jeu et propose
à pied, voiture, moto, vélo, hélicoptère ou avion. Ce que le garage fournit y retourne ; une voiture volée reste dans la
rue. Le ciel de Manhattan devient ainsi un terrain de jeu : un saut en parachute depuis l’avion est toujours possible.

## Les corps

Les personnes viennent de la bibliothèque Microsoft Rocketbox : de vrais modèles d’artistes, peints à la main, avec leurs
doigts, leurs paupières et leur mâchoire. Le mouvement est de la motion capture, calée sur la vitesse réelle pour que les
pieds ne glissent pas ; les armes se tiennent par cinématique inverse sur des points de prise propres à chacune. La foule
porte les mêmes corps, ramenés à un squelette de 23 os instancié : une rue pleine coûte à peine plus qu’un seul passant.

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
| 0.3 | Margin Call | Acte II, planques, armurerie, carrosserie, motos, cycle jour/nuit continu, météo, IA de conduite |
| **0.4** | **Human Capital** | Vrais personnages, motion capture, foule vivante, police tactique, chutes physiques |
| **0.5** | **Hard Assets** | Monde solide (trafic, troncs, mobilier), vrais arbres, vraie herbe |
| **0.6** | **Prime Real Estate** | Façades en vraie brique et pierre, fenêtres en relief, rues et commerces refaits, objets réels |
| **0.7** | **Bull Run** | Conduite refaite : suspension, pneus et moteur simulés, vrais modèles de voitures, son moteur, nitro, cascades |
| **0.8** | **Hostile Takeover** | Acte III, gangs et territoires, casse en plusieurs temps, bateaux et nage, téléphone, police offensive |
| **0.9** | **Leverage** | Toits jouables, grappin, wingsuit, surf sur les voitures, police verticale, toutes les armes au départ |
| **0.9.1** | **Leverage** | Le ciel refait : vrai modèle de vol, vol au regard, sensations, parapente en caissons |
| **0.9.2** | **Leverage** | Correctif des collisions automobiles ; Architecte expérimental réservé au développement local |
| **0.9.3** | **Main Street** | Rez-de-chaussée refaits : 25 000 boutiques réelles en relief, enseignes uniques, vrais intérieurs, la rue de nuit |
| **0.9.4** | **Momentum** | Conduite au clavier refaite (volant progressif, stabilité, frein à main), voitures solides, reflets de la rue, conducteur et habitacle, vue intérieure |
| 1.0 | Closing Bell | Le jeu fini : fin de l’histoire, coopération en ligne, mode photo, optimisation mobile. Pas avant. |
