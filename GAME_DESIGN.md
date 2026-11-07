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

### Architecte 2.2 — outil local, 4 novembre 2026

Sur la base du jeu 0.9.5 : son œil indépendant, ses programmes et sa mémoire servent une boucle de correction contrôlée.
La validation humaine est persistante ; une livraison exige les tests du dernier état du code ; la clôture exige des
preuves nouvelles et un rejeu valide. Arrêts, budget partagé et sauvegardes restent imposés côté serveur. Les expériences
gardent un protocole comparable et signalent le trafic perturbateur. La prospection enchaîne les lieux et les sujets,
à pied, en voiture ou en hélico selon les capacités du corps ; un ticket en attente ou en échec ne l'arrête pas. Un
trajet bloqué est repris puis écarté, et aucune pensée périodique ne se paie sans observation nouvelle. Les statuts
actuels des tickets priment sur ses anciens récits. Voix coupée par défaut ; mémoire extérieure de l'atelier en lecture
seule et relevé partiel conservé après interruption. L'outil et ses contrôles ne sont pas livrés. Suite : mesurer les
faux positifs et le coût par correction utile sur des séances
longues, puis isoler davantage les écritures de l'atelier si plusieurs auteurs travaillent en même temps.

## 0.9.10 « Price Action » — tir et conduite

### Tir à la troisième personne

Le combat doit se lire dans la caméra du joueur : arme visible, réaction immédiate au clic, recul qui revient,
impact identifiable et recharge compréhensible. Le cadrage armé et la visée sont distincts ; C change d’épaule et
X verrouille/déverrouille la visée pour jouer au pavé tactile. Les modèles originaux partagent leurs matériaux
préparés au chargement ; culasse, chargeur et pompe suivent le tir et la recharge. La précision récompense l’arrêt
et les rafales courtes ; le fusil à pompe perd son efficacité à distance. Le rayon de visée conserve les cibles
proches, le projectile part du canon et un obstacle entre le corps et le canon intercepte le tir.

Références de conception : [options de visée de Rockstar](https://www.rockstargames.com/newswire/article/25o2411812oa29/rockstar-game-tips-playing-with-perspective-in-gtav)
et [commandes et lisibilité chez Naughty Dog](https://blog.playstation.com/2020/06/09/the-last-of-us-part-ii-accessibility-features-detailed/).
Les ressources, noms et modèles du jeu restent originaux. Le changement d’épaule et la visée activable sont repris
comme principes de contrôle ; les nouvelles mécaniques et valeurs sont conçues pour OVERDRAFT.

Cette étape ne certifie pas des animations de combat AAA, une IA tactique aboutie ou toute la campagne. Les prochains
travaux de combat restent les transitions de couverture, les réactions localisées et les animations capturées dédiées.

### Capital Gains — les voitures

Les quinze modèles partagent une chaîne complète : géométrie réelle des roues, pneus à réponse progressive,
Ackermann, différentiel, ABS, boîte adaptative et télémétrie des forces. La propulsion puissante accepte la dérive,
la traction tire sa trajectoire et l'intégrale se relance plus vite. Les aides et la direction restent adaptées
aux commandes numériques d'un clavier AZERTY.

La finition doit se juger en caméra de conduite : vernis et reflets filtrés, vitrage, signatures optiques,
plaques et badges originaux, disques et étriers, cadrans animés, caméra stable et son lié à la charge.
Le garage donne accès aux quinze modèles avec leurs caractéristiques. Aucun nouveau matériau ne doit être créé
lors d'un rappel du garage ; les variantes sont préparées avant l'entrée en jeu.

Le banc de dynamique est livré dans `tools/cars/benchmark-dynamics.mjs`. Les objectifs qui restent ouverts sont une
flotte de géométries/textures réellement AAA, l'usure et la température des pneus, des sons enregistrés sous licence,
et 60 images/s soutenues dans la ville. Une bonne mesure sur piste plane ne clôt pas ces objectifs.

## 0.9.9 « Break Even » — correctif de stabilité

Le retour joueur invalide la présentation de 0.9.8 comme grand saut graphique : le gain perçu était faible, avec
une fluidité insuffisante et des défauts de locomotion visibles. Cette version corrige le cumul de deux animations
verticales, les appuis du héros aux bordures et la cadence selon la taille du corps. Elle réduit les calculs de reflets
en ÉQUILIBRÉE et FLUIDE et rétablit une remontée de résolution prudente. Les prochaines validations doivent inclure
les animations en mouvement et les transitions trottoir/chaussée ; des captures statiques et des tests de démarrage
ne prouvent ni une démarche correcte ni un niveau AAA.

## 0.9.8 « Revaluation » — lumière locale, relief et netteté

L'image doit tenir pendant la marche et la conduite. Les volumes réels de Manhattan servent maintenant à précalculer
la visibilité du ciel à quatre hauteurs, et à chercher les immeubles dans les reflets des voitures détaillées. Les
jambages, linteaux et bandeaux proches deviennent de vrais volumes. La pierre des monuments garde ses joints et ses
pores ; leurs halls ne deviennent plus des blocs lumineux à midi. L'étalonnage conserve davantage de matière dans les
hautes lumières et retire les franges colorées.

Le budget vient d'abord du travail inutile : portée des petits lots de mobilier enfin respectée, grands lots encore
partitionnés, détail du stationnement choisi par voiture et rendu dans des pools persistants. En ÉQUILIBRÉE, l'atlas
solaire stable se rafraîchit jusqu'à 30 Hz, immédiatement lors d'un déplacement ou d'une rotation importants ; HAUTE garde la
cadence complète. La résolution remonte aussi quand le processeur plafonne à une cadence jouable.

Ce jalon ne termine pas la direction artistique. Les personnages secondaires, certaines géométries de monuments et
la variété des silhouettes restent en retrait. Les reflets par champ de hauteurs restent une approximation de la ville
statique, avec façades simplifiées, et ne reflètent pas les voitures ou les passants. Prochain critère de production :
un parcours continu à pied, en voiture et sur les toits, avec des mesures longues à 60 images/s en ÉQUILIBRÉE et une
mise en scène de mission aussi travaillée que l'image. La 1.0 conserve ses exigences.

## 0.9.7 « Curb Appeal » — l'image

Un jeu se juge dans sa première minute, et la première minute, c'est l'image. La règle de cette version : la lumière
d'abord (le rapport soleil/ciel, l'exposition qui s'adapte à l'ombre, l'occlusion ambiante, les rayons), puis ce que la
caméra montre en premier (le menu depuis le ciel, le vol d'ouverture, le point de départ), puis ce qu'on regarde tout le
temps (le héros, l'entrée en voiture, les accessoires de chantier). Chaque choix se vérifie en caméra de jeu, de jour, sur
des captures avant/après.

## 0.9.6 « Footfall » — la vie

Une ville se juge à ce qui s'y passe quand on ne fait rien. La vie a trois couches, et la 0.9.6 les construit sur les deux
armes que GTA V n'a pas : les registres publics de New York, qui donnent déjà les boutiques et les immeubles, et une
journée de 32 minutes qui fait voir au joueur le rythme entier de la ville en une partie.

- **Les traces** : des voitures garées partout où New York en gare (chaussées redécoupées avec leur file de stationnement,
  règles vraies, occupation par quartier et par heure, stationnement alterné), le mobilier du trottoir là où la ville le
  recense (arrêts, abris, kiosques, arceaux, bancs, bornes, parcmètres, échafaudages de chantier, terrasses) et là où les
  règles le mettent (panneaux, paniers, boîtes à journaux, grilles, colonnes sèches, portes de cave), les bêtes, la nappe
  sonore. Tout ce qui peut tomber tombe ; tout ce qui a un volume arrête les voitures et les gens.
- **Les intentions** : une densité de foule qui suit le quartier et l'heure, des postes où les passants s'arrêtent (bancs,
  chaises, comptoirs, vitrines, files d'attente), des portes qui respirent selon les horaires des boutiques, des bus qui
  s'arrêtent, des taxis qui se rangent, des livreurs en double file.
- **Les histoires** : un metteur en scène d'événements ambiants, un toutes les une à deux minutes, branché sur les
  systèmes existants, jamais deux fois le même d'affilée.

Suite prévue : des voitures qui se garent et repartent sous les yeux du joueur, des musiciens de rue (la radio
procédurale a la musique), des promeneurs de chiens, des stands de marché le week-end, des manifestations et des
tournages qui ferment une rue, le son réglé à l'oreille.

## 0.9.5 « Due Diligence » — personnages de nuit et outil de test local

Les corps, cheveux, accessoires et niveaux de détail des personnages reçoivent une part de lumière renvoyée par la rue
et un appoint progressif après le crépuscule. Les silhouettes dos aux lampes restent lisibles sans éclaircir la journée.
L'Architecte 2.2 accompagne cette version comme outil local, avec une prospection qui continue pendant le cycle des tickets.

## 0.9.4 « Momentum » — la conduite et les immeubles

Les deux refontes développées en parallèle partagent une même version de test.

### Momentum — la conduite

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

### Bricks & Mortar — les immeubles

Une ville se reconnaît à ses immeubles avant ses monuments. Chaque immeuble prend son type dans le registre foncier
(PLUTO : catégorie, étages, année, quartier historique) et ses gradins dans OpenStreetMap ; `js/building-types.js` en fait
une tenue (couleur, fenêtres, soubassement, corniche) que les deux shaders de façade lisent par sommet, et
`js/building-massing.js` dessine les retraits de la loi de 1916 là où les données n'en ont pas. Les menuiseries et appuis
en relief près du joueur sont livrés. Suite prévue : perrons des maisons de ville, balcons d'après-guerre,
couronnes éclairées la nuit.

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
| **0.9.4** | **Momentum** | Conduite au clavier refaite (volant progressif, stabilité, frein à main), voitures solides, reflets de la rue, conducteur et habitacle, vue intérieure ; immeubles Bricks & Mortar (types réels, gradins, corniches et fenêtres en relief) |
| **0.9.5** | **Due Diligence** | Personnages lisibles de nuit ; Architecte 2.2 local : prospection continue, trajets repris, statuts réconciliés, suivi des sessions et voix coupée par défaut |
| **0.9.7** | **Curb Appeal** | L'image : lumière refaite (soleil/ciel, œil adaptatif, occlusion ambiante, rayons du soleil, étalonnage, affûtage), menu et vol d'ouverture, nouveau Sacha, entrée en voiture jouée, chantiers de rue |
| **0.9.6** | **Footfall** | La vie : 108 000 voitures garées sur des chaussées redécoupées, le trottoir new-yorkais d'après les registres et les règles de la rue, la foule par quartier et heure avec ses postes et ses portes, bus, taxis et livreurs, pigeons, mouettes et rats, nappe sonore, événements ambiants |
| **0.9.8** | **Revaluation** | Lumière locale calculée sur les volumes réels, reflets des immeubles hors écran sur les voitures détaillées, encadrements et bandeaux en relief, pierre et halls des monuments, mobilier et stationnement optimisés, ombres cadencées et récupération de netteté |
| **0.9.9** | **Break Even** | Correctif : ancrage des animations au sol, appuis du héros aux bordures, foulée selon la taille, reflets coûteux réservés à HAUTE et résolution adaptative prudente |
| **0.9.10** | **Price Action** | Tir TPS : cadrage et changement d’épaule, arsenal original articulé, précision et recul, rechargement, douilles et impacts. Refonte des quinze voitures : pneus, direction, transmission, freins, cockpit, son, caméra et garage |
| 1.0 | Closing Bell | Le jeu fini : fin de l’histoire, coopération en ligne, mode photo, optimisation mobile. Pas avant. |
