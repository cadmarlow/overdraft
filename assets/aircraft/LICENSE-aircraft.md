# Aircraft — sources and licences

Everything in this folder was produced by `tools/aircraft/import.mjs` from the models below. The game shows them under
invented names (Hauturier · Bourrasque, Corsaire · Tramontane); the national insignia, service lettering, serials and
squadron badges found on the sources were painted out.

| File | Source model | Author | Licence | Page |
| --- | --- | --- | --- | --- |
| `classic.bin`, `classic_paint_*.webp` | BOEING-STEARMAN MODEL 75 | Stéphane Agullo (sa3d) | CC BY 4.0 | https://sketchfab.com/3d-models/boeing-stearman-model-75-57035fcd89e7496aa712ca1b522700fd |
| `jet.bin`, `jet_skin_*.webp`, `jet_mech_*.webp` | F-104 Starfighter | Mikhail Zelenov (Mikhail_Zelenov) | CC BY 4.0 | https://sketchfab.com/3d-models/f-104-starfighter-96e60f2f463b4b1c8822079f1b2e21eb |

CC BY 4.0: https://creativecommons.org/licenses/by/4.0/

Both models were taken from the Objaverse 1.0 mirror of Sketchfab's own GLB conversion (Allen Institute for AI,
https://huggingface.co/datasets/allenai/objaverse), whose textures are 1024 px; their licence was read from Sketchfab's
record of each model on 2026-11-11.

`classic_blade_c.webp` (the propeller blades' wood, brass and paint) is not from either source: the importer paints it.

## Changes made for the game

- Re-oriented to the game's aircraft frame (metres, +X the pilot's left, +Y up, +Z the nose), scaled to real size
  (span 9.8 m, length 16.7 m), the origin moved to the centre of gravity the flight model uses.
- Biplane: one aircraft kept out of the seven of the source scene (clouds, rain, lights and camera dropped); the front
  pilot removed, the rear one kept as a part that can be hidden; the flat blurred propeller card replaced by blades
  built by the importer; main and tail wheels made round (they were 4 % taller than long) and cut out so that they
  turn; the tail wheel's fork cut out so that it castors.
- Jet: undercarriage legs, wheels and doors cut out of the source's chunks so that the gear retracts; nozzle petals,
  tailplane, rudder, flaps and airbrakes hung on hinges measured on the model.
- Geometry merged per material and quantised (positions 16 bits, normals 8 bits, UVs 16 bits); triangle counts kept.
- Maps repacked as WebP at 1024 px: colour, normal, and occlusion / roughness / metalness in one image (the biplane
  keeps only its colour and its occlusion: its source normal map is not a tangent-space map, and its roughness and
  metalness were constants).
- Markings painted out with clean paint or metal cloned from nearby, on the colour and on the
  occlusion / roughness / metalness maps. Biplane: "U.S. NAVY" and "985" on both sides of the fuselage, the small "985"
  by the nose, "N2S-2" on the fin. Jet: every star and bar (fuselage sides, intake lips, upper wing), "USAF" on the
  wing, "U.S. AIR FORCE" on both sides of the nose, the serial on both sides of the fin, the squadron badges and motto
  by the cockpit. Stencils, panel lines, weathering and the yellow and white bands were kept.
- The biplane's yellow is drawn deeper and warmer than the source's by the game's material.
