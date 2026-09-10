import { test, expect, type Page } from '@playwright/test';

type Api = {
  ready: boolean;
  reset(seed?: string): void;
  seek(p: number, speed?: number): void;
  step(n: number): void;
  input(p: Record<string, unknown>): void;
  startAudio(): boolean;
  mute(on: boolean): void;
  audioLevel(): number;
  audioDegrees(): number[];
  audioToneHz(): number;
  weather(mode: 'dry' | 'rain'): void;
  state(): { render: Record<string, number | string | boolean> };
};

async function boot(page: Page): Promise<void> {
  await page.goto('./?capture=1&seed=TMS-01');
  await page.waitForFunction(() => (window as unknown as { __INKFALL?: { ready: boolean } }).__INKFALL?.ready === true, undefined, { timeout: 60000 });
}

/** Let the real graph run for a while and take the loudest reading we see. */
async function peakLevel(page: Page, ms: number): Promise<number> {
  return page.evaluate(async (span) => {
    const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
    let peak = 0;
    const end = performance.now() + span;
    while (performance.now() < end) {
      api.step(8);
      peak = Math.max(peak, api.audioLevel());
      await new Promise((r) => setTimeout(r, 16));
    }
    return peak;
  }, ms);
}

test.describe('step 9 — synthesized audio', () => {
  test('no AudioContext exists until something starts it', async ({ page }) => {
    await boot(page);
    const before = await page.evaluate(() => (window as unknown as { __INKFALL: Api }).__INKFALL.state().render.audioStarted);
    expect(before, 'the context waits for a gesture').toBe(false);
    const started = await page.evaluate(() => (window as unknown as { __INKFALL: Api }).__INKFALL.startAudio());
    expect(started).toBe(true);
  });

  test('the mix actually sounds, and M silences it', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.startAudio();
      api.reset();
      api.seek(0.30, 14);
      api.input({ pedal: 1 });
    });
    const loud = await peakLevel(page, 1400);
    expect(loud, 'the master bus is not silent').toBeGreaterThan(0.0015);

    await page.evaluate(() => (window as unknown as { __INKFALL: Api }).__INKFALL.mute(true));
    const quiet = await peakLevel(page, 700);
    expect(quiet, 'mute silences the master').toBeLessThan(loud * 0.2);
  });

  test('the generative line stays on the 宮商角徵羽 pentatonic', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.startAudio();
      api.reset();
      api.seek(0.55, 16);
      api.input({ pedal: 1 });
    });
    await peakLevel(page, 1600);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      return { degrees: api.audioDegrees(), notes: api.state().render.audioNotes as number };
    });
    expect(r.notes, 'the generator produced notes').toBeGreaterThan(4);
    expect(r.degrees.length).toBeGreaterThan(4);
    for (const d of r.degrees) expect([0, 2, 4, 7, 9]).toContain(d);
  });

  test('rain closes the mix down', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      const settle = async (n: number) => {
        for (let i = 0; i < n; i++) { api.step(8); await new Promise((res) => setTimeout(res, 16)); }
      };
      api.startAudio();
      api.reset();
      api.seek(0.30, 14);
      api.input({ pedal: 1 });
      await settle(30);
      const dryHz = api.audioToneHz();
      api.weather('rain');
      await settle(60);
      return { dryHz, wetHz: api.audioToneHz() };
    });
    expect(r.dryHz, 'dry mix is open').toBeGreaterThan(9000);
    expect(r.wetHz, 'rain low-passes the mix').toBeLessThan(r.dryHz * 0.6);
  });
});
