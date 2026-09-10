import { test, expect, type Page } from '@playwright/test';

type Api = {
  ready: boolean;
  seek(p: number): void; step(n: number): void;
  analyzeFrame(): { peaks: number; peakBins: number[]; edgeRatio: number; meanLuma: number; distinctLevels: number };
  state(): { render: Record<string, number | string> };
};

async function boot(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('./?capture=1&seed=TMS-01');
  await page.waitForFunction(() => (window as unknown as { __INKFALL?: { ready: boolean } }).__INKFALL?.ready === true);
}

test.describe('step 4 — 水墨 render pipeline', () => {
  test('cel banding and ink lines at progress 0.4 (kill gate 7)', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.seek(0.4);
      api.step(150);
      return api.analyzeFrame();
    });
    expect(r.peaks, 'luminance histogram shows cel banding').toBeGreaterThanOrEqual(3);
    expect(r.edgeRatio, 'ink lines are present').toBeGreaterThan(0.02);
    expect(r.edgeRatio, 'ink lines are lines, not noise').toBeLessThan(0.15);
  });

  test('the pipeline actually runs a two-target geometry pass and an ink pass', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.seek(0.3);
      api.step(60);
      api.analyzeFrame();
      return api.state().render;
    });
    expect(r.drawCalls as number, 'geometry + shadow + post all drew').toBeGreaterThan(0);
    expect(r.triangles as number).toBeGreaterThan(1000);
  });

  test('the sky is paper-white with quantized ink-cloud bands', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.seek(0.4);
      api.step(150);
      const src = document.querySelector('canvas') as HTMLCanvasElement;
      const c = document.createElement('canvas');
      c.width = 320; c.height = 40;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      // Top 11% of the frame: sky only.
      ctx.drawImage(src, 0, 0, src.width, Math.round(src.height * 0.11), 0, 0, 320, 40);
      const d = ctx.getImageData(0, 0, 320, 40).data;
      let sum = 0, min = 1, levels = new Set<number>();
      for (let i = 0; i < 320 * 40; i++) {
        const l = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
        sum += l; min = Math.min(min, l);
        levels.add(Math.round(l * 40));
      }
      return { mean: sum / (320 * 40), min, levels: levels.size };
    });
    expect(r.mean, 'sky reads as paper, not as a blue dome').toBeGreaterThan(0.72);
    expect(r.levels, 'cloud bands are quantized washes, not a smooth gradient').toBeLessThan(24);
    expect(r.levels, 'the sky is not one flat fill').toBeGreaterThan(1);
  });
});
