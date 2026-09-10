# INKFALL 墨落大帽山

A 2.3 km point-to-point downhill BMX race from the Tai Mo Shan radar station down to 川龍村,
rendered as moving 水墨 (ink-wash): paper-white sky, brush-stroke hatch shadows, mist that
swallows the valley in flat bands, and Hong Kong monsoon rain that rolls in mid-run.

**Live:** https://icomppower.github.io/inkfall

Three.js + TypeScript + Vite. `three` is the only runtime dependency. Every mesh, texture,
sound and music note is generated in code at boot — the repo and `dist/` contain zero asset
files. No network at runtime.

Design spec lives in Notion; see `DIVERGENCE.md` for any departures from it.

## Controls
W/↑ pedal · A D / ← → line · S/↓ brake (slide while steering) · Space hold/release preload+hop ·
Shift boost · C manual · 1–5 tricks in air · R restart · P/Esc pause · M mute · V weather · F effects.
Gamepad: RT pedal, LT front brake, left stick line, A hop, X boost, B manual, D-pad tricks.

## Dev
```
npm install
npm run dev      # http://localhost:5173/inkfall/
npm run build    # tsc strict + vite build + asset guard
npm test         # Playwright kill-gate suite
npm run perf     # real-GPU frame pacing
```
