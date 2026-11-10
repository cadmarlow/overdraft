# After Hours

`assets/opening/sacha-east-river.jpg` est l’illustration de l’écran d’ouverture, produite avec l’outil ImageGen intégré puis encodée en JPEG progressif.

```text
Create premium original illustrated key art for the FULLSCREEN opening/loading screen of OVERDRAFT, a fictional crime action game about Sacha Roux arriving in New York to repay his brother's debt. Use case stylized-concept, widescreen landscape 16:9. An arresting hand-painted early-2000s urban crime game loading illustration with rich editorial comic-book black brush inking, heavy silhouettes, chiseled planes, graphic cel-shaded poster colors and restrained halftone ink in the shadows. Moody illustrated American crime-thriller cover, exceptionally polished. Original characters and visual identity. Composition designed to leave the LEFTMOST 40% comparatively quiet and dark navy (rain haze and uninterrupted street silhouettes) for a real title rendered separately. CENTER RIGHT dominant portrait from hips up of Sacha, a wary dark-haired French man in his early thirties wearing a weathered tobacco-brown suede bomber over a graphite hoodie and washed black jeans, one hand in pocket, holding a small plain cream debt envelope low in his other hand. Individual original face, a slight scar through one eyebrow, no resemblance to known game characters. Looking sharply back at a threat out of frame. Wind and rain at blue hour on the Lower Manhattan waterfront, recognizable Brooklyn Bridge and Lower Manhattan skyline in the background, copper lit clouds along the horizon. A charcoal late-1990s four-door sedan with twin red taillights skids across the lower right near a stack of timber and a fence. A diagonal band of silver headlight reflections across wet asphalt subtly pulls the eye from the left to the figure. Street-level drama, deeply rooted New York architecture. Copper amber skin and sky against petrol-blue, deep black ink, restrained red taillight accents. Main figure's face around x=67% y=29%, safely inside 4:3 crop. Painterly texture and deliberate dramatic asymmetry. Full bleed, one integrated composition with no panels, no typography, no watermark, no logo, no legible signage or marks. Drawn illustration, never photographic or 3D.
```

« La dette » est une composition à 88 BPM en mi mineur. Le script assemble la partition, les instruments de VSCO 2 Community Edition (CC0), la basse et la grosse caisse synthétisées, puis encode le mix stéréo en AAC. Les échantillons individuels restent dans le cache de travail.

```sh
node tools/opening/render-theme.mjs
```

Le rendu se fait avec Node.js 22 ou plus et `afconvert`, fourni avec macOS. Le script télécharge les échantillons depuis le dépôt de Versilian Studios. Un dossier de cache peut être passé en argument pour les réutiliser. Le jeu lit directement le fichier `assets/opening/la-dette.m4a`.
