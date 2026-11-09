# Weapons — sources and licences

Everything in this folder was produced by `tools/weapons/import.mjs` from the models below. The game shows them under
invented names (Calypso 9, Hornet, Breaker 12, Sentinel); the makers' markings found on the sources were removed.

| File | Source model | Author | Licence | Page |
| --- | --- | --- | --- | --- |
| `pistol.*`, `icon-pistol.webp` | Service Pistol | Mateusz Sadek, for Poly Haven | CC0 1.0 | https://polyhaven.com/a/service_pistol |
| `smg.*`, `icon-smg.webp` | MP7 | Harry (habbottcapps) | CC BY 4.0 | https://sketchfab.com/3d-models/mp7-efaa5259f1c44261a27de328d508e239 |
| `shotgun.*`, `icon-shotgun.webp` | Remington 870 with Magpul furniture | rwroclav | CC BY 4.0 | https://sketchfab.com/3d-models/remington-870-with-magpul-furniture-7e9700e7ae63461f9cfcdd741dfe1bb4 |
| `rifle.*`, `icon-rifle.webp` | AK-12 | rwroclav | CC BY 4.0 | https://sketchfab.com/3d-models/ak-12-f78ad7ae10ad4335b3ad81be3ec15bb0 |
| `grenade.*` | M67 Fragmentation Grenade | FJH | CC BY 4.0 | https://sketchfab.com/3d-models/m67-fragmentation-grenade-26eda181849f4d188f69105302fd7b65 |

CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ — CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/

The four Sketchfab models were taken from the Objaverse 1.0 mirror of Sketchfab's own GLB conversion (Allen Institute
for AI, https://huggingface.co/datasets/allenai/objaverse), whose textures are 1024 px; their licence was read from
Sketchfab's record of each model on 2026-11-09.

## Changes made for the game

- Re-oriented to the game's weapon space (+Z along the barrel, +Y up), scaled to real length, centred on the mid-plane.
- One copy kept where a file held two; loose rounds posed beside a weapon dropped.
- Cut into moving parts: pistol slide and magazine (already separate in the source), shotgun fore-end, rifle and
  submachine-gun magazines (cut out of one-piece meshes).
- Maps resized to 1024 px (512 px for the grenade) and repacked as WebP: colour, normal, and occlusion / roughness / metalness in one image.
- Markings repainted on the rifle: the maker's logo and country of origin on the receiver, the sight's brand lettering.
- Portraits for the weapon wheel (`icon-*.webp`) rendered from these models.
