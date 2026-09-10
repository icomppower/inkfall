import { test, expect, type Page } from '@playwright/test';

type Api = {
  ready: boolean;
  reset(seed?: string): void;
  seek(p: number, speed?: number): void;
  step(n: number): void;
  input(p: Record<string, unknown>): void;
  weather(mode: 'dry' | 'rain'): void;
  effects(on: boolean): void;
  state(): {
    race: Record<string, number | string>;
    physics: Record<string, number | boolean | string | null>;
    render: Record<string, number | string | boolean>;
  };
};

async function boot(page: Page): Promise<void> {
  await page.goto('./?capture=1&seed=TMS-01');
  await page.waitForFunction(() => (window as unknown as { __INKFALL?: { ready: boolean } }).__INKFALL?.ready === true, undefined, { timeout: 60000 });
}

test.describe('step 6 — weather and screen effects', () => {
  test('kill gate 6 — rain cuts grip within 20 s, beads the visor in 3 s, and drains inside 30 s', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.reset();
      api.seek(0.22, 12);
      api.input({ pedal: 1 });
      api.step(60);
      const dryGrip = api.state().physics.grip as number;

      api.weather('rain');
      api.step(360);                                   // 3 s
      const dropletsAt3s = api.state().physics.droplets as number;
      api.step(2040);                                  // total 20 s
      const wetGrip = api.state().physics.grip as number;
      const wetness = api.state().physics.wetness as number;

      api.weather('dry');
      let dropletsAt30s = -1;
      api.step(3600);                                  // 30 s
      dropletsAt30s = api.state().physics.droplets as number;
      return { dryGrip, dropletsAt3s, wetGrip, wetness, dropletsAt30s };
    });
    expect(r.wetGrip, 'effective μ drops in the wet').toBeLessThan(r.dryGrip);
    expect(r.wetness, 'fully wet after the 20 s ramp').toBeGreaterThan(0.95);
    expect(r.dropletsAt3s, 'visor beads up within 3 s').toBeGreaterThan(0);
    expect(r.dropletsAt30s, 'visor clears within 30 s of the rain stopping').toBe(0);
  });

  test('rain arrives on its own, seeded, somewhere in sections 2–4', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.reset();
      const onset = api.state().physics.onsetS as number;
      api.seek((onset - 30) / 2300, 14);
      api.input({ pedal: 1 });
      const before = api.state().physics.weather as string;
      api.step(900);
      return { onset, before, after: api.state().physics.weather as string };
    });
    expect(r.onset).toBeGreaterThanOrEqual(800);
    expect(r.onset).toBeLessThanOrEqual(1650);
    expect(r.before).toBe('dry');
    expect(r.after).toBe('rain');
  });

  test('speed strokes appear above 45 km/h and particles fire on a slide', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.reset();
      api.seek(0.22, 6);
      api.input({ pedal: 1 });
      api.step(30);
      const slowStroke = api.state().render.speedStroke as number;
      api.step(900);
      const fastKmh = api.state().physics.speedKmh as number;
      const fastStroke = api.state().render.speedStroke as number;
      api.input({ brake: 1, steer: 1 });
      let particles = 0;
      for (let i = 0; i < 60; i++) { api.step(4); particles = Math.max(particles, api.state().render.particles as number); }
      return { slowStroke, fastKmh, fastStroke, particles };
    });
    expect(r.slowStroke).toBe(0);
    expect(r.fastKmh).toBeGreaterThan(45);
    expect(r.fastStroke).toBeGreaterThan(0);
    expect(r.particles, 'the slide throws dust').toBeGreaterThan(5);
  });

  test('F drops the effects layer and adaptive DPR stays inside 0.6–1.0', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.reset();
      api.seek(0.22, 16);
      api.input({ pedal: 1, brake: 1, steer: 1 });
      api.step(300);
      const withEffects = api.state().render.particles as number;
      api.effects(false);
      api.step(120);
      const without = api.state().render.particles as number;
      api.effects(true);
      const dpr = api.state().render.dpr as number;
      return { withEffects, without, dpr };
    });
    expect(r.withEffects).toBeGreaterThan(0);
    expect(r.without).toBe(0);
    expect(r.dpr).toBeGreaterThanOrEqual(0.6);
    expect(r.dpr).toBeLessThanOrEqual(1.0);
  });
});
