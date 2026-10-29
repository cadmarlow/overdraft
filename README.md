# CONTRE-MARÉE

Un playground de monde ouvert pour navigateur, basé sur Slop New York.
Version 0.1.1 : personnage à la troisième personne, marche, sprint, saut,
approche d'un véhicule, portière animée, entrée, conduite et sortie.

Trois véhicules sont disponibles au départ. Les véhicules civils arrêtés dans
la circulation peuvent également être récupérés. La partie et les véhicules
sont sauvegardés localement dans le navigateur.

## Jouer

- WASD / ZQSD ou flèches : déplacement et conduite.
- Souris maintenue : regarder autour de soi.
- Maj : sprint. Espace : saut à pied, frein à main en voiture.
- F : entrer ou sortir d'un véhicule à l'arrêt.
- B : klaxon. V : caméra. M : carte. Échap : pause.

Clavier/souris et manette standard. Navigateur de bureau avec accélération
matérielle recommandé. Un mode Fluidité est disponible dans le menu.

## Développer

Node.js 22 ou plus récent. Les dépendances de rendu sont incluses avec le code :
aucune installation npm n'est nécessaire.

```sh
npm run dev
```

Ouvrir http://localhost:5173. Ajouter `?stats=1` pour afficher le moteur utilisé
et le nombre d'images par seconde. WebGPU est le réglage par défaut d'origine.

```sh
npm test
npm run build
```

Le build statique est généré dans `dist/`. Les détails d'architecture,
de sauvegarde et de vérification se trouvent dans [PLAYGROUND.md](PLAYGROUND.md).

Pour comparer les performances, `?stats=1` affiche le moteur réellement utilisé
et les FPS. `?renderer=webgl&stats=1` force le mode de compatibilité.
La branche `v1-published` conserve la V1 publiée avant le rétablissement de WebGPU.
La validation des interactions dans le navigateur cloud utilise une simulation
à pas fixes ; elle ne mesure pas la fluidité sur un GPU de joueur.

Le scénario, les missions, les comptes et les fonctions multijoueurs sont des
étapes ultérieures. La V1 se concentre sur les déplacements et les véhicules.

## Sources et licences

[CREDITS.md](CREDITS.md), [LICENSE](LICENSE) et [README original](UPSTREAM.md).
Slop New York : https://github.com/mrdoob/slop-newyork
