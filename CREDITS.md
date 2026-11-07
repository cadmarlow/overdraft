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

Buildings: what each building is (building class, floors, year built, historic district, landmark status) comes from
NYC Department of City Planning, PLUTO (NYC Open Data, https://data.cityofnewyork.us/d/64uk-42ks); the tiers of stepped
towers and the colours, materials and roof shapes mappers recorded come from © OpenStreetMap contributors (ODbL,
https://www.openstreetmap.org/copyright). Only the facts js/building-styles.bin.gz holds are kept; how each building is
dressed is invented by the game.

Street furniture: where each piece stands in js/street-geodata.bin.gz (built by tools/street/build-street-data.mjs) comes
from these public datasets; only positions (and a shed's stated length) are kept, never a business or owner name.
- "Hydrants", NYC Department of Environmental Protection (NYC Open Data, https://data.cityofnewyork.us/d/5bgh-vtsn).
- "Bus Stop Shelters", NYC Department of Transportation (NYC Open Data, https://data.cityofnewyork.us/d/t4f2-8md7).
- "MTA Bus Stops", Metropolitan Transportation Authority (Open NY, https://data.ny.gov/d/2ucp-7wg5). Data obtained from the
  MTA; the MTA does not endorse this game.
- "Newsstands", NYC Department of Transportation (NYC Open Data, https://data.cityofnewyork.us/d/w9zq-xm8b).
- "Bicycle Parking", NYC Department of Transportation (NYC Open Data, https://data.cityofnewyork.us/d/592z-n7dk).
- "Seating Locations" (CityBench), NYC Department of Transportation (NYC Open Data, https://data.cityofnewyork.us/d/esmy-s8q5).
- "LinkNYC Kiosk Locations", NYC Office of Technology and Innovation (NYC Open Data, https://data.cityofnewyork.us/d/s4kf-3yrf).
- "Parking Meters Locations and Status", NYC Department of Transportation (NYC Open Data, https://data.cityofnewyork.us/d/693u-uax6).
- "DOB NOW: Build – Approved Permits" (sidewalk shed permits), NYC Department of Buildings (NYC Open Data,
  https://data.cityofnewyork.us/d/rbx6-tga4).
- "Dining Out NYC Locations", NYC Department of Transportation (NYC Open Data, https://data.cityofnewyork.us/d/fpeh-f7ci).
- "Building Footprints", NYC Office of Technology and Innovation (NYC Open Data, https://data.cityofnewyork.us/d/5zhs-2jue):
  the walls sheds and outdoor dining are placed on.

Les bases dérivées d'OpenStreetMap sont redistribuées sous [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Elles sont disponibles au format machine dans le jeu publié : [géographie](./js/nyc-geodata.js),
[empreintes des immeubles](./js/building-geodata.bin.gz) et [styles et gradins](./js/building-styles.bin.gz).
Les lecteurs sont fournis avec elles : [immeubles](./js/building-geodata.js)
et [styles](./js/building-styles.js). Cette licence concerne les bases de données ; le code du jeu reste sous MIT.
PLUTO est fourni par NYC Planning via NYC Open Data ; ses [conditions de réutilisation](https://data.cityofnewyork.us/stories/s/Terms-of-Use/k9k7-3cje)
et la [FAQ de NYC Open Data](https://www.nyc.gov/opendata/get-started/FAQs) s'appliquent aux données de la ville.
Elles s'appliquent aussi aux jeux de données du mobilier urbain publiés par la ville ([données](./js/street-geodata.bin.gz),
[lecteur](./js/street-geodata.js)). Les arrêts de bus de la MTA relèvent des
[conditions d'Open NY](https://data.ny.gov/download/77gx-ii52/application%2Fpdf) et des
[conditions de la MTA pour ses données](https://www.mta.info/developers/terms-and-conditions).

## Outil de développement local

La salle de contrôle utilise Geist et Geist Mono, © 2024 The Geist Project Authors, sous SIL Open Font License 1.1 :
https://github.com/vercel/geist-font/blob/main/OFL.txt. Chargées via Google Fonts, elles ne sont pas incluses dans le jeu publié.

Le serveur de l'Architecte utilise le SDK TypeScript Anthropic (`@anthropic-ai/sdk`), sous licence Apache-2.0 :
https://github.com/anthropics/anthropic-sdk-typescript. Sa licence est fournie avec le paquet installé dans
`tools/architecte/node_modules/@anthropic-ai/sdk/LICENSE`. Le SDK et le serveur sont exclus du build du jeu publié.
