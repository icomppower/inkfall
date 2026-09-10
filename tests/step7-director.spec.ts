import { test, expect, type Page } from '@playwright/test';

type Cut = { t: number; shot: string; s: number };
type Api = {
  ready: boolean;
  reset(seed?: string): void;
  seek(p: number, speed?: number): void;
  step(n: number): void;
  autopilot(on: boolean): void;
  camera(name: string | null): void;
  cameraLog(): Cut[];
  minCutGap(): number;
  state(): { race: Record<string, number | string>; render: Record<string, number | string | boolean> };
};

async function boot(page: Page, seed = 'TMS-01'): Promise<void> {
  await page.goto(`./?capture=1&seed=${seed}`);
  await page.waitForFunction(() => (window as unknown as { __INKFALL?: { ready: boolean } }).__INKFALL?.ready === true, undefined, { timeout: 60000 });
}

/** One full autopilot run, returning the shot log. */
async function fullRun(page: Page, seed: string) {
  return page.evaluate((sd) => {
    const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
    api.reset(sd);
    api.autopilot(true);
    api.seek(0, 0);
    for (let i = 0; i < 120 * 400; i++) {
      api.step(1);
      if (api.state().race.phase === 'finished') break;
    }
    const st = api.state();
    const cuts = api.cameraLog();
    const kinds: Record<string, number> = {};
    for (const c of cuts) kinds[c.shot] = (kinds[c.shot] ?? 0) + 1;
    return {
      phase: st.race.phase as string,
      time: st.race.time as number,
      cuts, kinds,
      minGap: api.minCutGap(),
    };
  }, seed);
}

test.describe('step 7 — cinematic camera director', () => {
  test('kill gate 8 — the shot log carries every shot and no cut is closer than 4 s', async ({ page }) => {
    await boot(page);
    const r = await fullRun(page, 'TMS-01');
    expect(r.phase, 'the run finished').toBe('finished');
    expect(r.kinds['berm'], 'berm low-track').toBeGreaterThanOrEqual(1);
    expect(r.kinds['side'], 'air side-dolly').toBeGreaterThanOrEqual(1);
    expect(r.kinds['wide'], 'drone-wide over 芒草坡').toBeGreaterThanOrEqual(1);
    expect(r.kinds['finish'], 'finish reverse').toBeGreaterThanOrEqual(1);
    expect(r.minGap, 'no two cuts closer than 4 s').toBeGreaterThanOrEqual(4 - 1e-6);
  });

  test('the drone-wide fires exactly once per run', async ({ page }) => {
    await boot(page);
    const r = await fullRun(page, 'TMS-01');
    expect(r.kinds['wide']).toBe(1);
    const wide = r.cuts.find((c) => c.shot === 'wide')!;
    expect(wide.s, 'over 芒草坡').toBeGreaterThan(350);
    expect(wide.s).toBeLessThan(800);
  });

  test('the film is deterministic for a seed', async ({ page }) => {
    await boot(page);
    const a = await fullRun(page, 'TMS-02');
    const b = await fullRun(page, 'TMS-02');
    expect(JSON.stringify(b.cuts)).toBe(JSON.stringify(a.cuts));
    const c = await fullRun(page, 'TMS-04');
    expect(JSON.stringify(c.cuts)).not.toBe(JSON.stringify(a.cuts));
  });

  test('kill gate 3 — the autopilot completes 2300 m without sinking through the trail', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.reset();
      api.autopilot(true);
      api.seek(0, 0);
      let minAbove = 1e9;
      for (let i = 0; i < 120 * 400; i++) {
        api.step(1);
        const st = api.state() as unknown as { race: Record<string, number | string>; physics: Record<string, number> };
        minAbove = Math.min(minAbove, st.physics.heightAboveSurface);
        if (st.race.phase === 'finished') break;
      }
      const st = api.state();
      return { phase: st.race.phase as string, s: st.race.s as number, time: st.race.time as number, minAbove };
    });
    expect(r.phase).toBe('finished');
    expect(r.s).toBeCloseTo(2300, 0);
    expect(r.minAbove, 'never below surface − 0.5 m').toBeGreaterThan(-0.5);
    expect(r.time, 'sim finish time between 150 s and 300 s').toBeGreaterThan(150);
    expect(r.time).toBeLessThan(300);
  });

  test('camera() forces a named shot for capture', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.reset();
      api.seek(0.4, 12);
      const seen: string[] = [];
      for (const name of ['side', 'wide', 'finish', 'chase']) {
        api.camera(name);
        api.step(30);
        seen.push(api.state().render.shot as string);
      }
      api.camera(null);
      return seen;
    });
    expect(r).toEqual(['side', 'wide', 'finish', 'chase']);
  });
});
