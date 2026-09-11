# 墨落 INKFALL — 水墨下坡

A standalone ink-wash edition of the playable Three.js / TypeScript downhill race with a procedural 2,300 m centerline, 485 m elevation loss, 14 sculpted kickers, three AI riders, and a hand-built alpine forest. No downloaded models, textures, music, fonts, or runtime service calls.

This edition is a separate Site; the original INKLINE game is preserved. `app/ink.ts` contains the ink shaders, paper generator, pine mesh and mountain generator.

## Play

- W / Up: pedal. S / Down: brake and slide.
- A / D or Left / Right: steer across the trail.
- Space: bunny hop (press again for another hop).
- Shift: boost; recharges over time and on landings.
- Q / E in the air: frontflip / backflip. Release to level out before landing.
- Escape: pause. R: restart. Touch controls are available on touch devices.

The race starts immediately. Sound begins after the Ride button gesture. Leaving the tab pauses the race. Finishing shows race position, time, and style score. Best experienced with hardware-accelerated WebGL2 and a keyboard.

## Systems

- `app/physics.ts`: fixed 120 Hz integration, independently sampled front and rear contact springs, damping, pitch torque, downhill acceleration, speed-dependent drag, wet grip, brake slides, jumps, flip rotation, landing checks, crash recovery, boost.
- `app/world.ts`: arc-length sampled Catmull–Rom track, terrain ribbons sharing the collision height function, 800 instanced conifers, 400 rocks, mountains, rails, flags, procedural bike/rider geometry, canvas-generated start/finish lettering.
- `app/game.ts`: three route policies (Rook inside line, Ghost smooth line, Jinx aggressive jumps), race ranking, collision nudges, follow camera, Sobel postprocessing, procedural lens-drop refraction, volumetric rain streaks, speed lines and particles.
- `app/audio.ts`: Web Audio oscillators and seeded noise synthesize percussion, bass, arpeggios, wind, tire sounds, impacts, and landing sounds. Boost increases music tempo.
- `app/page.tsx`, `app/globals.css`: responsive game HUD and controls.

Rendering uses world-anchored ink wash density, procedural dry-brush texture, imperfect Sobel contours and feathered edge bleeding. A seeded 512 × 512 paper-fibre texture is synthesized in memory. Asymmetrical karst pillars and jagged pine canopies replace the original alpine silhouette; distant forms fade into pale paper. Vermilion accents identify the player, course flags and boost, with ink tyre trails and spray. The interface uses Traditional Chinese titles, seal typography and system serif fonts. The score uses a synthesized pentatonic motif. Weather changes continuously during a run and affects braking and lateral grip.

This is a compact arcade simulation, not a full rigid-body bicycle simulator: forward progress follows the track coordinate, steering chooses a lateral line, and bicycle pose responds to two-wheel contact dynamics. Scenic trees and rocks stay outside the rideable corridor; leaving that corridor crashes the rider. Motion and physics are timestep-independent; cosmetic particles use the render delta.

## Develop

Use the package manager specified in `package.json`. `pnpm dev` starts the app; `pnpm build` produces the Cloudflare-compatible Site. `pnpm exec tsc --noEmit` checks TypeScript. All game dependencies are bundled; no external CDN is needed during play.


Validation: TypeScript and production build checks are run before publication. The terrain sampling and bicycle physics are unchanged from the original. Browser visual/play testing and live WebMCP validation are unavailable in this run; the optional read-only `read_inkfall_race` tool is feature-detected and does not affect unsupported browsers.
