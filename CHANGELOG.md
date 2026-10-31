# Changelog

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
