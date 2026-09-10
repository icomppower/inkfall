import { Game } from './game';
import { Hud, type HudModel } from './hud';
import { DEFAULT_SEED, COURSE_LENGTH } from './sim/constants';
import { neutralInput, type RiderInput } from './sim/bike';

const params = new URLSearchParams(location.search);
const seed = params.get('seed') ?? DEFAULT_SEED;
const capture = params.get('capture') === '1';

const app = document.getElementById('app')!;
const game = new Game(app, { seed, capture });
const hud = new Hud(app, seed);

game.paused = true;
hud.onStart = () => { game.audio.start(); game.race.start(); game.paused = false; };
hud.onRestart = () => { game.restart(); hud.reset(); game.race.start(); game.paused = false; };

// Audio can only start from a real gesture. This listener does nothing but unlock the
// context — it never sits in front of the action the key or click was actually for.
for (const ev of ['pointerdown', 'keydown'] as const) {
  addEventListener(ev, () => game.audio.start(), { passive: true });
}

function hudModel(): HudModel {
  const p = game.player;
  return {
    seed,
    speedKmh: p.speed * 3.6,
    place: game.race.placement(p),
    time: game.race.time,
    boost: p.boost,
    crashes: p.crashes,
    style: p.style,
    s: p.s,
    checkpoint: p.checkpoint,
    splits: game.race.splits,
    phase: p.phase,
    trick: p.trick,
    landedTrick: p.lastLanding?.trick ?? 0,
    paused: game.paused,
  };
}

let wasPaused = true;
function frame(now: number): void {
  game.advance(now);
  game.render();
  if (!capture && game.paused !== wasPaused) {
    wasPaused = game.paused;
    hud.showPaused(game.paused);
  }
  hud.update(hudModel(), game.race.summary() as never, now);
  game.input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (capture) {
  game.paused = true;
  const scripted: RiderInput = neutralInput();
  game.input.scripted = scripted;
  (window as unknown as Record<string, unknown>).__INKFALL_GAME = game;
  (window as unknown as Record<string, unknown>).__INKFALL_HUD = hud;
  (window as unknown as Record<string, unknown>).__INKFALL = {
    ready: true,
    seed,
    courseLength: COURSE_LENGTH,
    controlPointCount: game.world.course.controlPoints.length,
    erodedDroplets: game.world.terrain.erodedDroplets,
    start() { game.paused = false; game.race.start(); },
    reset(s?: string) { game.restart(s); hud.reset(); Object.assign(scripted, neutralInput()); },
    seek(progress: number, speed?: number) {
      const target = Math.max(0, Math.min(1, progress)) * COURSE_LENGTH;
      for (const e of game.race.entrants) {
        e.rider.reset(target);
        if (speed !== undefined) e.rider.speed = speed;
        e.rider.phase = 'riding';
        e.rider.checkpointS = target;
      }
      game.director.reset();
      game.stepFrames(1, scripted);
    },
    step(frames: number) { game.stepFrames(frames, scripted); },
    input(partial: Partial<RiderInput>) { Object.assign(scripted, partial); },
    setInput(partial: Partial<RiderInput>) { Object.assign(scripted, partial); },
    weather(mode: 'dry' | 'rain') { game.weather.set(mode); },
    effects(on: boolean) { game.setEffects(on); },
    autopilot(on: boolean) { game.autopilotOn = on; },
    camera(name: string | null) { game.director.forced = (name ?? null) as never; },
    cameraLog() { return game.director.cuts.map((c) => ({ ...c })); },
    minCutGap() { return game.director.minCutGap(); },
    startAudio() { game.audio.start(); return game.audio.started; },
    mute(on: boolean) { game.audio.setMuted(on); },
    audioLevel() { return game.audio.level(); },
    audioDegrees() { return game.audio.lastDegrees.slice(); },
    audioToneHz() { return game.audio.toneHz; },
    riders() { return game.race.summary(); },
    hud() {
      return {
        mode: hud.currentMode,
        board: hud.boardVisible,
        best: hud.best,
        text: (document.getElementById('hud') as HTMLElement).innerText,
      };
    },
    hudStart() { hud.onStart?.(); },
    lockDpr(v: number) {
      game.dprLocked = true;
      game.pipeline.setSize(window.innerWidth, window.innerHeight, v);
    },
    state() { return game.state(); },
    dropTest(h: number, k?: number, c?: number) { return game.dropTest(h, k, c); },
    analyzeFrame() { game.render(); return game.analyzeFrame(); },
    debugCam(px: number, py: number, pz: number, tx: number, ty: number, tz: number) {
      const p = game.director.pose;
      p.px = px; p.py = py; p.pz = pz; p.tx = tx; p.ty = ty; p.tz = tz; p.fov = 55; p.roll = 0;
      game.applyCamera(); game.render();
    },
    terrainPoke() { return game.terrainPoke(); },
    terrainDropped() { return game.terrainDropped; },
    sample(s: number, lateral: number) { return { ...game.world.course.sample(s, lateral, game.world.sample(s, lateral)) }; },
    centre(s: number) {
      const c = game.world.course;
      return { x: c.centreX(s), y: c.centreY(s), z: c.centreZ(s) };
    },
    terrainHeight(x: number, z: number) { return game.world.terrain.heightAt(x, z); },
  };
}
