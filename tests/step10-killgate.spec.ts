import { test, expect, type Page } from '@playwright/test';

type Api = {
  ready: boolean;
  reset(seed?: string): void;
  seek(p: number, speed?: number): void;
  step(n: number): void;
  input(p: Record<string, unknown>): void;
  autopilot(on: boolean): void;
  hudStart(): void;
  hud(): { mode: string; board: boolean; best: { time: number; splits: number[] } | null; text: string };
  riders(): { phase: string; isPlayer: boolean }[];
  state(): { race: Record<string, number | string>; render: Record<string, number | string | boolean> };
};

const ORIGIN = 'http://127.0.0.1:4173';

async function boot(page: Page, query = ''): Promise<void> {
  await page.goto(`./?capture=1&seed=TMS-01${query}`);
  await page.waitForFunction(() => (window as unknown as { __INKFALL?: { ready: boolean } }).__INKFALL?.ready === true, undefined, { timeout: 60000 });
}

test.describe('step 10 — HUD, persistence and the boot kill gate', () => {
  test('kill gate 2 — nothing but same-origin html/js/css, first frame inside 3 s', async ({ page }) => {
    const offending: string[] = [];
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const sameOrigin = url.origin === ORIGIN;
      const ext = url.pathname.split('/').pop() ?? '';
      const allowed = ext === '' || /\.(html|js|css|mjs)$/.test(ext);
      if (!sameOrigin || !allowed) offending.push(`${route.request().resourceType()} ${url.href}`);
      await route.continue();
    });

    const t0 = Date.now();
    await page.goto('./?capture=1&seed=TMS-01');
    await page.waitForFunction(() => (window as unknown as { __INKFALL?: { ready: boolean } }).__INKFALL?.ready === true, undefined, { timeout: 20000 });
    await page.waitForFunction(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      return (api.state().render.frames as number) > 0;
    }, undefined, { timeout: 20000 });
    const firstFrameMs = Date.now() - t0;

    expect(offending, 'no off-origin or non-html/js/css requests').toEqual([]);
    expect(firstFrameMs, 'first frame within 3 s').toBeLessThan(3000);
  });

  test('the HUD reports speed, place, timer, boost and the section card', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.hudStart();
      api.reset();
      api.seek(0.36, 15);
      api.input({ pedal: 1 });
      api.step(240);
      return { text: api.hud().text };
    });
    expect(r.text).toContain('km/h');
    expect(r.text).toContain('BOOST');
    expect(r.text).toContain('摔車');
    expect(r.text).toMatch(/\d:\d\d\.\d\d/);
  });

  test('a finished run shows results and writes a best time that persists', async ({ page }) => {
    test.setTimeout(180_000);
    await boot(page);
    const first = await page.evaluate(async () => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.hudStart();
      api.reset();
      api.autopilot(true);
      for (let i = 0; i < 120 * 400; i++) {
        api.step(1);
        if (api.state().race.phase === 'finished') break;
      }
      api.step(2);
      // The HUD is driven by the render loop, so let a couple of frames land.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const h = api.hud();
      return { mode: h.mode, board: h.board, best: h.best, text: h.text, time: api.state().race.time as number };
    });
    expect(first.mode, 'results board shown at the finish').toBe('results');
    expect(first.board).toBe(true);
    expect(first.text).toContain('F I N I S H');
    expect(first.text).toContain('STYLE');
    expect(first.best, 'best time written').not.toBeNull();
    expect(first.best!.time).toBeCloseTo(first.time, 1);
    expect(first.best!.splits.length, 'five checkpoint splits stored').toBe(5);

    const stored = await page.evaluate(() => localStorage.getItem('inkfall.best.v1'));
    expect(stored).toContain('TMS-01');

    // Reload: the start card must read the stored best back.
    await boot(page);
    const after = await page.evaluate(() => (window as unknown as { __INKFALL: Api }).__INKFALL.hud());
    expect(after.best, 'best time survives a reload').not.toBeNull();
    expect(after.text).toContain('BEST');
  });

  test('the whole field finishes a cold autopilot run from the start card', async ({ page }) => {
    test.setTimeout(180_000);
    await boot(page);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.reset();
      api.hudStart();
      api.autopilot(true);
      for (let i = 0; i < 120 * 420; i++) {
        api.step(1);
        if (api.riders().every((x) => x.phase === 'finished')) break;
      }
      return {
        all: api.riders().every((x) => x.phase === 'finished'),
        s: api.state().race.s as number,
        cuts: api.state().render.cuts as number,
      };
    });
    expect(r.all).toBe(true);
    expect(r.s).toBeCloseTo(2300, 0);
    expect(r.cuts, 'the director cut a film along the way').toBeGreaterThan(4);
  });
});
