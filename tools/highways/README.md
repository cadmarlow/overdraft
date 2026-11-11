# Tracés côtiers et contrôle des emprises

Les immeubles proviennent des empreintes NYC OTI. L'ancien générateur plaçait les voies rapides dans une bande
calculée depuis le trait de berge et les lots procéduraux, sans consulter ces empreintes. Le problème se répétait
sur les deux rives ; supprimer les tronçons de circulation laissait des routes finissant dans les façades.

`node tools/highways/build.mjs` reconstruit `js/highway-geodata.js`, sans réseau ni dépendance à installer.
Il utilise `js/building-geodata.bin.gz`, `js/nyc-geodata.js` et le relevé CSCL local `tools/data/cscl_manhattan.json`.
Le secteur de FDR entre les 34e et 23e Rues reprend comme référence les chaussées principales du CSCL, y compris
les segments de niveau 17 que l'export des rues de surface omettait. Ailleurs, la préférence initiale reste le
couloir côtier existant. Les bâtiments restent intacts.

La recherche calcule un itinéraire continu sur chaque rive, avec une réserve de 18 m mesurée perpendiculairement
à la route, puis lisse ses changements de direction en contrôlant les polygones bâtis. La réserve est recalculée
jusqu'à convergence pour conserver la largeur dans les courbes. Elle échoue explicitement si aucun passage continu
n'est trouvé. Les quatre voies, les marquages, les séparateurs, le viaduc, la carte et la réservation du sol partagent
ces coordonnées. La circulation adapte sa vitesse aux courbes et prépare son freinage avant leur entrée.
Les anciens trottoirs et pelouses sont découpés géométriquement, avec interpolation de leurs attributs ; les arbres
et le sol physique respectent la même réservation. Ce tracé est une adaptation jouable, pas une reconstruction
exhaustive des niveaux, tunnels et bretelles de toutes les voies rapides réelles.
Le raccord souterrain de Battery reste celui du jeu existant : les véhicules ambiants le parcourent, mais ses
portails sont fermés au joueur. Il faut distinguer ces volumes de fermeture des obstacles involontaires sur les voies.

`node --test tests/highway-layout.test.mjs tests/controllers.test.cjs tests/test-spawn.test.mjs` vérifie notamment :

- continuité du contournement d'un obstacle et échec explicite d'un corridor impossible ;
- passage d'un fourgon sur les quatre voies des deux rives, à chaque mètre, contre toutes les empreintes bâties ;
- découpe des surfaces, préservation de leurs attributs et accord avec le sol physique ;
- appui des roues sur les quais visibles au-delà du trait de berge, sans sol invisible dans l'eau ;
- arrivée locale de la Ressac alignée sur la nouvelle voie.

Essai manuel : `http://localhost:5173/?spawn=fdr&quality=high`. Départ de jour en Ressac sur la voie nord, au sud du
bâtiment signalé. Cette session ne remplace pas la sauvegarde normale. Contrôler en caméra de conduite le passage
devant l'immeuble, puis les deux rives et les rambardes de quai. Ne pas recharger l'onglet de la partie habituelle.

## Tour de contrôle en jeu

Le contrôle `audit.mjs` ouvre **sa propre page** dans un Chrome de test déjà lancé sur un port CDP dédié. Le serveur
local doit tourner. Exemple macOS (ce profil temporaire ne doit jamais être celui de la partie habituelle) :

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir=/tmp/overdraft-coast-qa --remote-debugging-port=9336 --disable-gpu-vsync --disable-frame-rate-limit --no-first-run about:blank
node tools/highways/audit.mjs 9336 /tmp/overdraft-coast-audit
```

Le script utilise la qualité HAUTE, à midi, coupe la manette dans sa page, puis :

- compare le gabarit d'un fourgon aux collisions réelles, tous les 2 m environ sur les voies rapides ;
- contrôle aussi les voies ordinaires situées à moins de 250 m de la côte, tous les 4 m ;
- compare la hauteur de la voie, le sol physique et les triangles du décor au-dessus de la chaussée ;
- photographie 44 points des deux rives après une courte accélération avec de vraies touches CDP ;
- accélère contre huit points de rambarde du sud et consigne la position, la vitesse et le résultat dans `railings.json`.

Les résultats restent dans le répertoire indiqué : `audit.json`, `tour.json`, `railings.json` et captures JPEG.
Les points souterrains sont comptés à part et exclus du contrôle de surface. Les signalements de Battery restent
visibles dans le rapport : le script ne les transforme pas en succès. Ce test ne constitue ni un trajet continu
intégral au volant, ni une mesure de performance, ni une validation de toutes les intersections de Manhattan.

Le tour du 11 novembre a notamment retrouvé et corrigé :

- l'extrémité côté terre des modèles de Pier 59 et Pier 34, dont le rectangle débordait sur la route ; leur extrémité
  côté rivière reste fixe, seuls 10 m et 1,5 m côté terre sont retirés respectivement ;
- les dalles de quai laissées sur la chaussée lorsqu'un même lot de géométrie contenait aussi des bâtiments hauts ;
- le trottoir physique et les petits triangles de raccord sous le début du viaduc FDR ;
- les bennes et cônes de chantier débordant des bandes de stationnement dans les voies ;
- les rambardes purement visuelles de Battery et les tronçons manquants sur ses approches, avec appui des roues
  sur la bordure visible du quai. L'accès au terminal de ferry conserve son ouverture.

Restent distinctement identifiés : les portails factices de Battery, fermés au joueur, et les grands îlots mixtes
parc/bâti dont les portions de parc ne reçoivent pas encore leur aménagement (notamment vers la 10e Rue). Le tour
ne permet donc pas d'affirmer que tout le littoral est fini.
