import { Game } from './game';
import { DEFAULT_SEED, COURSE_LENGTH } from './sim/constants';
import { neutralInput, type RiderInput } from './sim/bike';

const params = new URLSearchParams(location.search);
const seed = params.get('seed') ?? DEFAULT_SEED;
const capture = params.get('capture') === '1';

const app = document.getElementById('app')!;
const game = new Game(app, { seed, capture });

if (capture) game.paused = true;

function frame(now: number): void {
  game.advance(now);
  game.render();
  game.input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (capture) {
  const scripted: RiderInput = neutralInput();
  game.input.scripted = scripted;
  (window as unknown as Record<string, unknown>).__INKFALL = {
    ready: true,
    seed,
    courseLength: COURSE_LENGTH,
    controlPointCount: game.world.course.controlPoints.length,
    erodedDroplets: game.world.terrain.erodedDroplets,
    start() { game.paused = false; game.player.phase = 'riding'; },
    reset(s?: string) { game.restart(s); Object.assign(scripted, neutralInput()); },
    seek(progress: number) {
      const target = Math.max(0, Math.min(1, progress)) * COURSE_LENGTH;
      game.player.reset(target);
      game.player.phase = 'riding';
      game.director.reset();
      game.stepFrames(1, scripted);
    },
    step(frames: number) { game.stepFrames(frames, scripted); },
    input(partial: Partial<RiderInput>) { Object.assign(scripted, partial); },
    setInput(partial: Partial<RiderInput>) { Object.assign(scripted, partial); },
    state() { return game.state(); },
    dropTest(h: number, k?: number, c?: number) { return game.dropTest(h, k, c); },
    sample(s: number, lateral: number) { return { ...game.world.course.sample(s, lateral, game.world.sample(s, lateral)) }; },
    centre(s: number) {
      const c = game.world.course;
      return { x: c.centreX(s), y: c.centreY(s), z: c.centreZ(s) };
    },
    terrainHeight(x: number, z: number) { return game.world.terrain.heightAt(x, z); },
  };
}
