import { test, expect, type Page } from '@playwright/test';

interface WorldApi {
  ready: boolean;
  controlPointCount: number;
  erodedDroplets: number;
  courseLength: number;
  sample(s: number, lateral: number): {
    height: number; nx: number; ny: number; nz: number;
    surface: string; camber: number; width: number; offTrail: boolean; voidGap: boolean;
  };
  centre(s: number): { x: number; y: number; z: number };
  terrainHeight(x: number, z: number): number;
}
declare global { interface Window { __INKFALL: WorldApi } }

async function boot(page: Page): Promise<void> {
  await page.goto('./?capture=1&seed=TMS-01');
  await page.waitForFunction(() => (window as unknown as { __INKFALL?: { ready: boolean } }).__INKFALL?.ready === true);
}

test.describe('step 2 — sim world', () => {
  test('course spline, erosion, and world.sample are well formed', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const w = window.__INKFALL;
      const samples: ReturnType<WorldApi['sample']>[] = [];
      for (let s = 0; s <= 2300; s += 5) samples.push(w.sample(s, 0));
      const y0 = w.centre(0).y, y1 = w.centre(2300).y;
      // Elevation must fall monotonically along the descent.
      let rises = 0, prev = Infinity;
      for (let s = 0; s <= 2300; s += 1) {
        const y = w.centre(s).y;
        if (y > prev + 1e-6) rises++;
        prev = y;
      }
      // Terrain must never poke above the trail surface wherever a trail exists.
      let pokes = 0, worst = 0;
      for (let s = 5; s < 2295; s += 3) {
        const smp = w.sample(s, 0);
        if (smp.voidGap) continue;
        const c = w.centre(s);
        const th = w.terrainHeight(c.x, c.z);
        if (th > smp.height) { pokes++; worst = Math.max(worst, th - smp.height); }
      }
      // ...and where the trail does not exist, the land must actually be gone.
      const gc = w.centre(1884);
      const gorgeDrop = w.centre(1884).y - w.terrainHeight(gc.x, gc.z);
      const badNormals = samples.filter((v) => {
        const l = Math.hypot(v.nx, v.ny, v.nz);
        return v.ny <= 0.25 || Math.abs(l - 1) > 1e-3;
      }).length;
      const widths = samples.map((v) => v.width);
      return {
        cps: w.controlPointCount,
        droplets: w.erodedDroplets,
        drop: y0 - y1,
        rises,
        pokes, worst, gorgeDrop,
        badNormals,
        minWidth: Math.min(...widths),
        maxWidth: Math.max(...widths),
        surfaces: [...new Set(samples.map((v) => v.surface))].sort(),
        voidAt1884: w.sample(1884, 0).voidGap,
        voidAt1700: w.sample(1700, 0).voidGap,
        tabletopRise: w.sample(1288, 0).height - w.centre(1288).y,
      };
    });

    expect(r.cps, 'roughly 90 Catmull-Rom control points').toBeGreaterThanOrEqual(60);
    expect(r.cps).toBeLessThanOrEqual(140);
    expect(r.droplets, 'at least 10k erosion droplets').toBeGreaterThanOrEqual(10000);
    expect(r.drop, 'total drop ≈ 420 m').toBeGreaterThan(415);
    expect(r.drop).toBeLessThan(425);
    expect(r.rises, 'descent is monotone').toBe(0);
    expect(r.badNormals, 'every surface normal is unit and up-facing').toBe(0);
    expect(r.pokes, 'course mask keeps terrain below the trail apron').toBe(0);
    expect(r.gorgeDrop, '竹林峽 ravine is carved into the terrain, not painted on').toBeGreaterThan(12);
    expect(r.minWidth).toBeGreaterThan(3.5);
    expect(r.maxWidth).toBeLessThan(11);
    expect(r.surfaces).toEqual(expect.arrayContaining(['dirt', 'hardpack', 'rock', 'stone', 'tarmac', 'wood']));
    expect(r.voidAt1884, 'ravine gap is a real hole').toBe(true);
    expect(r.voidAt1700).toBe(false);
    expect(r.tabletopRise, 'tea-terrace tabletop 1 stands proud').toBeGreaterThan(1.4);
  });

  test('seeds produce different courses, one seed reproduces exactly', async ({ page }) => {
    const fingerprint = async (seed: string) => {
      await page.goto(`./?capture=1&seed=${seed}`);
      await page.waitForFunction(() => (window as unknown as { __INKFALL?: { ready: boolean } }).__INKFALL?.ready === true);
      return page.evaluate(() => {
        let acc = 0;
        for (let s = 0; s <= 2300; s += 17) {
          const c = window.__INKFALL.centre(s);
          acc += c.x * 0.001 + c.z * 0.0007 + c.y * 0.01;
        }
        return acc;
      });
    };
    const a1 = await fingerprint('TMS-01');
    const a2 = await fingerprint('TMS-01');
    const b = await fingerprint('TMS-03');
    expect(a1).toBe(a2);
    expect(Math.abs(a1 - b)).toBeGreaterThan(1);
  });
});
