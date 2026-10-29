# CONTRE-MARÉE — Playground 01

Version 0.1.1, based on Slop New York at e35c06c0d896052a80ff117aefe8b99e978913d4.

## Play

Desktop browser with hardware acceleration recommended. Start from the main menu.
Move with WASD / physical ZQSD or arrows; hold Shift to sprint, Space to jump.
Drag the mouse to orbit the camera. Approach the driver's door and press F to enter.
F also exits a stationary vehicle; Space is the handbrake while driving.
B sounds the horn, V changes the driving camera, M opens the map, Escape pauses.
Standard gamepad support: left stick to move/steer, right stick to look, triggers
to accelerate/brake, A to jump, shoulder button to interact, Y to change camera.

Three parked cars are available at spawn. Stopped civilian traffic can also be
claimed from its driver's side. Vehicles remain where left; local browser storage
preserves the protagonist, the fleet and the selected vehicle. Reset is available
in the menu. No accounts, missions, multiplayer or live events in this release.

WebGPU is the default renderer, matching the upstream project.
`?renderer=webgl` explicitly selects compatibility rendering without screen-space reflections.
`?stats=1` displays the actual renderer and measured frame rate.
`?quality=performance` selects lower resolution and disables expensive sun shadows.

## Development

No runtime CDN, package installation or application server is required. Three.js
and its imported addons are vendored at the exact upstream commit. Serve the
checkout over HTTP with `npm run dev`. Run `npm test`, then `npm run build` to prepare
the static production directory `dist/`.

`scripts/browser-check.cjs` is an environment-specific browser QA runner. It
requires Playwright Core and Chromium. The `qa` query flag exposes the playground
state for that runner; it is absent in ordinary sessions.

Gameplay states are onFoot, entering, driving and exiting. The persistent player
owns vehicle changes; camera, crowd and traffic remain independent systems. The
save schema is validated and versioned. Geographic asset generation tools and
their original tests are preserved from upstream.

## Attribution

See CREDITS.md and LICENSE. Geographic data has its own source terms; the MIT
code license does not replace those terms.
