import { test, expect } from '@playwright/test';

const LIVE = 'https://icomppower.github.io/inkfall/';

/**
 * Kill gate 10: the deployed page, loaded cold in a fresh context, actually plays.
 * Skipped when INKFALL_SKIP_LIVE is set (offline runs).
 */
test.describe('kill gate 10 — live on GitHub Pages', () => {
  test.skip(!!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.INKFALL_SKIP_LIVE, 'live check disabled');
  test.use({ baseURL: LIVE });

  test('a cold load of the deployed site starts and runs', async ({ page }) => {
    test.setTimeout(120_000);
    const t0 = Date.now();
    const res = await page.goto(LIVE, { waitUntil: 'load' });
    expect(res?.status(), 'the page is served').toBe(200);
    await expect(page).toHaveTitle(/INKFALL/);

    // The start card is up and the field is on the line.
    const startBtn = page.getByRole('button', { name: /START/ });
    await expect(startBtn).toBeVisible({ timeout: 30_000 });
    const loadMs = Date.now() - t0;

    await startBtn.click();
    await page.keyboard.down('KeyW');

    const timeOf = async (): Promise<number> => {
      const t = await page.locator('#hud').innerText();
      const m = t.match(/(\d):(\d\d)\.(\d\d)/);
      return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 100 : -1;
    };
    const speedOf = async (): Promise<number> => {
      const t = await page.locator('#hud').innerText();
      return Number(t.match(/(\d+)\s*km\/h/)?.[1] ?? '0');
    };

    // Sustained progress, not one snapshot: the run clock has to keep climbing.
    let peakSpeed = 0;
    let simTime = -1;
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(600);
      simTime = await timeOf();
      peakSpeed = Math.max(peakSpeed, await speedOf());
      if (simTime > 4) break;
    }
    await page.keyboard.up('KeyW');

    const hudText = await page.locator('#hud').innerText();
    expect(hudText).toContain('km/h');
    expect(simTime, 'the run clock keeps advancing').toBeGreaterThan(4);
    expect(peakSpeed, 'the bike is rolling downhill').toBeGreaterThan(8);

    expect(loadMs, 'cold load reaches the start card quickly').toBeLessThan(30_000);
  });
});
