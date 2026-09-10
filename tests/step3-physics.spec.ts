import { test, expect, type Page } from '@playwright/test';

type Api = {
  ready: boolean;
  start(): void; reset(seed?: string): void; seek(p: number): void; step(n: number): void;
  input(p: Record<string, unknown>): void;
  state(): { race: Record<string, number | string>; physics: Record<string, number | boolean | string> };
  dropTest(h: number): { peakCompression: number };
};

async function boot(page: Page): Promise<void> {
  await page.goto('./?capture=1&seed=TMS-01');
  await page.waitForFunction(() => (window as unknown as { __INKFALL?: { ready: boolean } }).__INKFALL?.ready === true);
}

test.describe('step 3 — bike physics', () => {
  test('a 1 m drop bottoms the suspension out near 60% of travel', async ({ page }) => {
    await boot(page);
    const peak = await page.evaluate(() => (window as unknown as { __INKFALL: Api }).__INKFALL.dropTest(1.0).peakCompression);
    expect(peak).toBeGreaterThanOrEqual(0.55);
    expect(peak).toBeLessThanOrEqual(0.65);
  });

  test('gravity accelerates the bike and drag caps it below 78 km/h', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = () => (window as unknown as { __INKFALL: Api }).__INKFALL;
      const a = api();
      a.seek(0.155);                        // top of 芒草坡, on the ridge
      a.input({ pedal: 1 });
      let maxKmh = 0, minAbove = 1e9;
      for (let i = 0; i < 120; i++) {       // 60 s at 120 Hz
        a.step(60);
        const st = a.state().physics;
        maxKmh = Math.max(maxKmh, st.speedKmh as number);
        minAbove = Math.min(minAbove, st.heightAboveSurface as number);
      }
      return { maxKmh, minAbove, final: a.state().physics.speedKmh as number };
    });
    expect(r.maxKmh, 'speed cap respected').toBeLessThanOrEqual(78.001);
    expect(r.maxKmh, 'gravity actually accelerates the bike').toBeGreaterThan(30);
    expect(r.minAbove, 'never sinks through the surface').toBeGreaterThan(-0.5);
  });

  test('rear brake sheds speed', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = () => (window as unknown as { __INKFALL: Api }).__INKFALL;
      const a = api();
      a.seek(0.22);                        // 芒草坡 sweepers — no jump features here
      a.input({ pedal: 1 });
      a.step(600);
      const before = a.state().physics.speedKmh as number;
      a.input({ pedal: 0, brake: 1 });
      a.step(240);
      return { before, after: a.state().physics.speedKmh as number };
    });
    expect(r.before).toBeGreaterThan(20);
    expect(r.after).toBeLessThan(r.before * 0.75);
  });

  test('steering moves the bike across the trail and stays in bounds', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = () => (window as unknown as { __INKFALL: Api }).__INKFALL;
      const a = api();
      a.seek(0.22);
      a.input({ pedal: 1 });
      a.step(360);
      const start = a.state().physics.lateral as number;
      a.input({ steer: 1 });
      let maxLat = -1e9;
      for (let i = 0; i < 18; i++) { a.step(8); maxLat = Math.max(maxLat, a.state().physics.lateral as number); }
      a.input({ steer: -1 });
      let minLat = 1e9;
      for (let i = 0; i < 40; i++) { a.step(8); minLat = Math.min(minLat, a.state().physics.lateral as number); }
      return { start, maxLat, minLat, phase: a.state().race.phase as string };
    });
    expect(r.maxLat, 'steering right crosses the trail').toBeGreaterThan(r.start + 1.0);
    expect(r.minLat, 'steering left crosses back').toBeLessThan(r.start - 0.8);
    expect(Math.abs(r.maxLat), 'never leaves the corridor').toBeLessThan(7);
    expect(Math.abs(r.minLat)).toBeLessThan(7);
  });

  test('rear-brake lock while steering produces a slide', async ({ page }) => {
    await boot(page);
    const slid = await page.evaluate(() => {
      const api = () => (window as unknown as { __INKFALL: Api }).__INKFALL;
      const a = api();
      a.seek(0.22);
      a.input({ pedal: 1 });
      a.step(600);
      a.input({ pedal: 0, brake: 1, steer: 1 });
      for (let i = 0; i < 60; i++) {
        a.step(4);
        if (a.state().physics.sliding === true) return true;
      }
      return false;
    });
    expect(slid).toBe(true);
  });

  test('identical scripted input reproduces identical state', async ({ page }) => {
    await boot(page);
    const run = () => page.evaluate(() => {
      const api = () => (window as unknown as { __INKFALL: Api }).__INKFALL;
      const a = api();
      a.reset('TMS-01');
      a.seek(0.02);
      a.input({ pedal: 1, steer: 0.3, brake: 0, preload: false });
      a.step(900);
      a.input({ steer: -0.6, brake: 1 });
      a.step(400);
      return JSON.stringify(a.state().physics);
    });
    const first = await run();
    const second = await run();
    expect(second).toBe(first);
  });
});
