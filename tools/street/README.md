# Le mobilier urbain

`js/street-geodata.bin.gz` dit où se trouve, pour de vrai, le mobilier urbain de Manhattan : bouches d'incendie, abris
et arrêts de bus, kiosques à journaux, arceaux vélo, bancs, bornes LinkNYC, parcmètres, échafaudages de trottoir actifs
et terrasses de restaurant. Rien n'est affiché pour l'instant : c'est une donnée, que `js/street-geodata.js` décode.

```bash
node tools/street/build-street-data.mjs --fetch              # télécharge tout, puis écrit js/street-geodata.bin.gz
node tools/street/build-street-data.mjs                      # reconstruit à partir des copies de tools/data
node tools/street/build-street-data.mjs --fetch <dossier>    # si un cache dépasse 3 Mo, il va dans <dossier>
```

Toutes les sources sont des API Socrata publiques, sans compte ni clé. Un jeu de données qui ne répond pas (l'API renvoie
souvent des 503 : le script réessaie six fois), ou dont la taille sort de la plage attendue, garde son ancien cache ; s'il
n'en a pas, son type est simplement absent du fichier, et le script le dit à la fin.

## Les sources

| Type | Jeu de données | Organisme | Identifiant | Ce qui est gardé |
|---|---|---|---|---|
| `hydrant` | *Hydrants* | DEP | `5bgh-vtsn` | `boro=1` (Manhattan) |
| `shelter` | *Bus Stop Shelters* | DOT | `t4f2-8md7` | arrondissement Manhattan |
| `busstop` | *MTA Bus Stops* (data.ny.gov) | MTA | `2ucp-7wg5` | arrêts commerciaux des horaires en vigueur, un point par arrêt |
| `newsstand` | *Newsstands* | DOT | `w9zq-xm8b` | arrondissement Manhattan |
| `bikerack` | *Bicycle Parking* | DOT | `592z-n7dk` | un enregistrement par arceau (un « corral » liste chacun des siens) |
| `bench` | *Seating Locations* (CityBench) | DOT | `esmy-s8q5` | bancs seulement : les barres d'appui sont écartées |
| `linknyc` | *LinkNYC Kiosk Locations* | OTI | `s4kf-3yrf` | bornes en service (`Live`), sans les vieilles cabines |
| `meter` | *Parking Meters Locations and Status* | DOT | `693u-uax6` | horodateurs actifs sur rue, sans les parkings municipaux |
| `shed` | *DOB NOW: Build – Approved Permits* | DOB | `rbx6-tga4` | `work_type = Sidewalk Shed`, permis délivré, pas encore expiré |
| `dining` | *Dining Out NYC Locations* | DOT | `fpeh-f7ci` | licences délivrées, sur trottoir et sur chaussée |
| (murs) | *Building Footprints* | OTI | `5zhs-2jue` | les empreintes des immeubles nommés par les permis `shed` et `dining` |

Les identifiants se consultent sur `https://data.cityofnewyork.us/d/<id>` (ou `https://data.ny.gov/d/2ucp-7wg5`).

Seules les positions servent (et la longueur déclarée d'un échafaudage) : aucun nom de commerce, de propriétaire ni
d'entreprise n'est gardé, ni dans le binaire ni dans les caches.

## Ce que le script en fait

- **Repère** : `toWorld(lon, lat)` de `tools/geo-base.mjs`, en mètres (x vers l'est de la grille, z vers le sud). On prend
  la géométrie du jeu de données (`the_geom`) plutôt que ses colonnes latitude/longitude quand il a les deux : elles
  diffèrent d'environ 1 m, et la géométrie est dans le même repère que les rues et les immeubles du jeu.
- **Sur l'île détaillée seulement**, comme les boutiques et le métro : dans le contour `GEO.manhattan` et au sud de sa
  coupe (`GEO.frame.cutZ`, vers la 129e Rue). Le nord de Manhattan, Roosevelt Island et les îles sont écartés ; le script
  compte, pour chaque type, ce qu'il laisse au nord et ce qui tombe hors du contour.
- **Échafaudages et terrasses** : la ville les situe par l'adresse, géocodée *sur la rue* (un ou deux mètres de l'axe de
  la chaussée, quelque part le long du pâté). Le script pose chacun sur le mur de son propre immeuble (empreinte trouvée
  par son BIN), au point le plus proche de ce géocodage, donc sur la façade qui donne sur la rue de l'adresse. Les permis
  dont l'immeuble n'a pas d'empreinte (ou est à plus de 100 m) restent où la ville les met, au milieu de la rue.
- **Longueur des échafaudages** : le jeu de données n'a pas de colonne de longueur. Quand la description du permis la donne
  (« +/- 122 LINEAR FEET OF TEMPORARY SIDEWALK SHED », « 60LF NEW SIDEWALK SHED »), elle est lue et convertie en mètres ;
  sinon elle vaut 0. C'est rare (16 échafaudages sur 2 600 en novembre 2026).
- **Doublons** : plusieurs enregistrements au même endroit (à 25 cm près) deviennent un seul point ; pour les arceaux,
  le troisième champ compte combien il y en a ; pour les échafaudages, il garde la plus grande longueur connue.
- Les positions sont arrondies au seizième de mètre (exact en Float32, et le fichier se compresse mieux), triées par z
  puis x.

## Le format

Le fichier décompressé :

1. `uint32` petit-boutiste `n` : la longueur en octets de l'en-tête JSON ;
2. `n` octets d'UTF-8 : `{ version: 1, frame: 'game metres', retrieved, kinds, sources }`, complété d'espaces pour que
   `4 + n` soit un multiple de 4 ;
3. les blocs Float32 petit-boutistes des types, dans l'ordre de `kinds`.

`kinds[nom] = { offset, stride, count, fields }` : le type commence au flottant numéro `offset` de la section des blocs
(octet `4 + n + 4 × offset`) et compte `count × stride` flottants.

| Type | `stride` | Champs |
|---|---|---|
| `hydrant`, `shelter`, `busstop`, `newsstand`, `bench`, `linknyc`, `meter`, `dining` | 2 | `x, z` |
| `bikerack` | 3 | `x, z`, nombre d'arceaux à cet endroit |
| `shed` | 3 | `x, z` (sur le mur), longueur en mètres (0 si inconnue) |

`sources` donne, pour chaque type, le nom du jeu de données, l'organisme, l'identifiant, l'adresse, la date de
téléchargement et les conditions d'utilisation.

Dans le jeu : `import { STREET } from './street-geodata.js'`, puis `STREET.kinds.hydrant.data` (un `Float32Array`),
`STREET.kinds.hydrant.count`, `STREET.kinds.hydrant.stride`. Le module attend son fichier au chargement (top-level await),
comme `js/storefront-geodata.js`.

## Les caches

`tools/data/street_<type>.json` : `{ source, name, retrieved, where, columns, rows }`, une ligne par enregistrement avec
seulement les colonnes utiles (identifiant, longitude, latitude, et pour certains types le BIN, la longueur, le type de
terrasse). Les caches `shed` et `dining` gardent aussi les empreintes des immeubles concernés (`footprints`, anneaux
extérieurs en longitude, latitude au millionième de degré). Le plus gros, `street_shed.json`, fait environ 1,5 Mo ; si
l'un d'eux dépassait 3 Mo, il serait écrit dans le dossier passé en argument au lieu de `tools/data` (et ne serait donc
pas dans le dépôt).

## À savoir

- **Abris de bus** : la ville arrondit leurs coordonnées au dix-millième de degré, soit à 5 m près environ. Le script ne
  les recale pas sur l'arrêt MTA du même numéro : l'abri est à 9 m environ de son poteau (médiane), le recaler le déplacerait
  plus qu'il ne le corrige.
- **Échafaudages** : le jeu de données « Active Sheds » de la carte du DOB (nyc.gov) refuse les téléchargements
  automatiques ; on part donc des permis d'échafaudage de DOB NOW publiés sur NYC Open Data. Les permis BIS d'avant
  2021 (`ipu4-2q9a`) ne sont pas repris : il n'en reste qu'une poignée en cours. La colonne `borough` des permis s'écrit tantôt `MANHATTAN`,
  tantôt `Manhattan` depuis mi-2026 : le filtre compare en majuscules.
- **Terrasses** : la position est celle du restaurant, posée sur sa façade ; une terrasse sur chaussée est en réalité
  quelques mètres plus loin, dans la file de stationnement. Le cache sait laquelle est laquelle (`type` : `S` trottoir,
  `R` chaussée), le binaire pas encore.
- **Arrêts de bus** : un arrêt n'apparaît que si un horaire en vigueur (`in_effect`) le dessert ; le jeu de données
  change à chaque nouvel horaire de la MTA.
