# Credits

OVERDRAFT is based on Slop New York by Mr.doob (MIT).
Upstream: https://github.com/mrdoob/slop-newyork
Base commit: e35c06c0d896052a80ff117aefe8b99e978913d4.

Three.js and its addons: https://github.com/mrdoob/three.js (MIT).
Pinned commit: b3396270682287470d161658ac01084d25e8dba6.

Geographic data: NYC Open Data, MTA, and © OpenStreetMap contributors (ODbL).
See the upstream README for source datasets and their individual terms.

The original MIT copyright and license are preserved in LICENSE.

The people of the game (avatars, textures), the pistol, submachine gun and shotgun, and all motion capture come from the
Microsoft Rocketbox Avatar Library (MIT): https://github.com/microsoft/Microsoft-Rocketbox
Its license is reproduced in assets/people/LICENSE-Rocketbox.md.

The assault rifle is "M4A1 Assault Rifle" by nisu, public domain (CC0): https://opengameart.org/content/m4a1-assault-rifle

Leaves and turf are from ambientCG (CC0): https://ambientcg.com (LeafSet010, LeafSet013, LeafSet014, LeafSet016, Grass001, Grass005).
Bark is from Poly Haven (CC0): https://polyhaven.com (japanese_zelkova_bark and jolcham_oak_bark_01 by Charlotte Baglioni,
bark_brown_02 by Rob Tuytel, bark_platanus by Dimitrios Savva).

Building and street surfaces are from Poly Haven (CC0): white_sandstone_bricks, red_brick_03, brown_brick_02 and asphalt_02 by
Rob Tuytel, brick_wall_09 by Rob Tuytel and Matterfield, concrete_floor_worn_001 by Dimitrios Savva and Rico Cilliers.
Street props are from Poly Haven (CC0): fire_hydrant by Gonçalo Felício, metal_trash_can by GurJas Studios, trashbag by
Benny Weimer, planter_box_01 and utility_box_01 by James Ray Cock, concrete_road_barrier by Amal Kumar.

Cars, all CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Rescaled, split into body, glass and wheels, retextured on
one atlas with a paint mask, simplified and renamed for the game. Per-model credits are in assets/cars/LICENSE-cars.md.
"Generic passenger car pack" by Comrade1280: https://sketchfab.com/3d-models/20f9af9b8a404d5cb022ac6fe87f21f5
"Fairheaven LT '80", "Shvan '92", "LCT 3000 '95" and "French delivery van" by Daniel Zhabotinsky: https://sketchfab.com/DanielZhabotinsky
"Car Concept" by Eric Chadwick, Darmstadt Graphics Group GmbH: https://github.com/KhronosGroup/glTF-Sample-Assets (logos removed).
Obtained through the catalogue of https://github.com/pedrosoandre/carros.

Objects carried by passers-by are sculpted by `tools/build-humans.mjs`.

Shops: where every storefront stands and what it sells come from NYC Open Data, "Storefronts Reported Vacant or Not"
(Department of Finance, Local Law 157) and "DOHMH New York City Restaurant Inspection Results"; only positions, vacancy,
activity and cuisine are used, never a business name. Every shop name in the game is invented.
Shop sign typefaces are from Google Fonts, under the SIL Open Font License 1.1: Oswald, Anton, Playfair Display, Lobster,
Bebas Neue, Josefin Sans, Bitter, Monoton, Pacifico, Cinzel and Archivo Black; Permanent Marker is under the Apache License 2.0.
Only a distance-field atlas built from them ships (assets/shops/glyphs.png).
Shopfront surfaces are from Poly Haven (CC0): painted_plaster_wall, painted_brick and terrazzo_tiles by Amal Kumar,
distressed_painted_planks, fine_grained_wood, marble_01 and metal_plate by Rob Tuytel, granite_tile and rusty_metal_shutter by
Charlotte Baglioni, long_white_tiles by Jenelle van Heerden and Sergej Majboroda, painted_metal_shutter by Dario Barresi,
Rico Cilliers and Charlotte Baglioni, brushed_concrete by Dario Barresi and Dimitrios Savva.
The rooms behind the shop windows were modelled for the game and path traced offline with three-gpu-pathtracer by Garrett
Johnson (MIT): https://github.com/gkjohnson/three-gpu-pathtracer; it is not part of the published game.

## Outil de développement local

Le serveur de l'Architecte utilise le SDK TypeScript Anthropic (`@anthropic-ai/sdk`), sous licence Apache-2.0 :
https://github.com/anthropics/anthropic-sdk-typescript. Sa licence est fournie avec le paquet installé dans
`tools/architecte/node_modules/@anthropic-ai/sdk/LICENSE`. Le SDK et le serveur sont exclus du build du jeu publié.
