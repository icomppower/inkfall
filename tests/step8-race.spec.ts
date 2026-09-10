import { test, expect, type Page } from '@playwright/test';

interface RiderRow {
  id: string; isPlayer: boolean; phase: string; s: number; speedKmh: number; lateral: number;
  crashes: number; tricks: number; finishTime: number; place: number; lastCrashReason: string;
}
type Api = {
  ready: boolean;
  reset(seed?: string): void;
  seek(p: number, speed?: number): void;
  step(n: number): void;
  start(): void;
  input(p: Record<string, unknown>): void;
  autopilot(on: boolean): void;
  riders(): RiderRow[];
  state(): { race: Record<string, number | string>; physics: Record<string, number | boolean | string> };
};

async function boot(page: Page): Promise<void> {
  await page.goto('./?capture=1&seed=TMS-01');
  await page.waitForFunction(() => (window as unknown as { __INKFALL?: { ready: boolean } }).__INKFALL?.ready === true, undefined, { timeout: 60000 });
}

const RUN_ALL = (seeds: string[]) => {
  const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
  return seeds.map((seed) => {
    api.reset(seed);
    api.autopilot(true);
    api.start();
    for (let i = 0; i < 120 * 420; i++) {
      api.step(1);
      if (api.riders().every((r) => r.phase === 'finished')) break;
    }
    const riders = api.riders();
    const ai = riders.filter((r) => !r.isPlayer);
    const times = ai.filter((r) => r.phase === 'finished').map((r) => r.finishTime);
    return {
      seed,
      riders,
      aiFinished: ai.every((r) => r.phase === 'finished'),
      spread: times.length === ai.length ? (Math.max(...times) - Math.min(...times)) / Math.min(...times) : 99,
      munTricks: riders.find((r) => r.id === 'MUN')!.tricks,
      boCrashes: riders.find((r) => r.id === 'BO')!.crashes,
      maxSpeed: Math.max(...riders.map((r) => r.speedKmh)),
    };
  });
};

test.describe('step 8 — three rivals, contact, placements', () => {
  test('kill gate 4 — five seeded runs', async ({ page }) => {
    test.setTimeout(180_000);
    await boot(page);
    const runs = await page.evaluate(RUN_ALL, ['TMS-01', 'TMS-02', 'TMS-03', 'TMS-04', 'TMS-05']);
    let boCrashTotal = 0;
    for (const r of runs) {
      expect(r.aiFinished, `all three AI finish ${r.seed}`).toBe(true);
      expect(r.munTricks, `小蚊 attempts ≥3 tricks in ${r.seed}`).toBeGreaterThanOrEqual(3);
      expect(r.spread, `AI finish spread ≤ 25% in ${r.seed}`).toBeLessThanOrEqual(0.25);
      boCrashTotal += r.boCrashes;
    }
    expect(boCrashTotal, '肥波 goes down at least once across the five runs').toBeGreaterThanOrEqual(1);
  });

  test('placements are unique and ordered', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.reset('TMS-01');
      api.autopilot(true);
      api.start();
      api.step(120 * 40);
      const rows = api.riders();
      return {
        places: rows.map((x) => x.place).sort(),
        byS: rows.slice().sort((a, b) => b.s - a.s).map((x) => x.id),
        byPlace: rows.slice().sort((a, b) => a.place - b.place).map((x) => x.id),
      };
    });
    expect(r.places).toEqual([1, 2, 3, 4]);
    expect(r.byPlace).toEqual(r.byS);
  });

  test('contact pushes riders apart and scrubs speed', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      const game = (window as unknown as {
        __INKFALL_GAME: { race: { entrants: { rider: { s: number; lateral: number; lateralVel: number; speed: number; phase: string; airborne: boolean; reset(s: number): void } }[]; contacts: number } };
      }).__INKFALL_GAME;
      api.reset('TMS-01');
      api.start();
      const [a, b, c, d] = game.race.entrants.map((e) => e.rider);
      // Park the other two well up the hill so only one pair can touch.
      c.reset(120); d.reset(140);
      a.reset(700); a.lateral = 1.6; a.speed = 12;
      b.reset(700); b.s = 700.2; b.lateral = -1.6; b.speed = 12;
      api.step(6);                     // settle onto the ground, well apart
      a.lateral = 0.06; b.lateral = -0.06;
      a.lateralVel = 0; b.lateralVel = 0;
      const contactsBefore = game.race.contacts;
      const gapBefore = Math.abs(a.lateral - b.lateral);
      const speedBefore = a.speed;
      api.step(2);
      return {
        contacts: game.race.contacts - contactsBefore,
        gapAfter: Math.abs(a.lateral - b.lateral),
        gapBefore,
        speedBefore,
        speedAfter: a.speed,
      };
    });
    expect(r.contacts).toBeGreaterThan(0);
    expect(r.gapAfter, 'shoved apart').toBeGreaterThan(r.gapBefore);
    expect(r.speedAfter, 'contact scrubs speed').toBeLessThan(r.speedBefore);
  });

  test('the race is deterministic and nobody exceeds the speed cap', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    const [a, b] = await page.evaluate(RUN_ALL, ['TMS-03', 'TMS-03']);
    expect(JSON.stringify(b.riders.map((r) => [r.id, r.finishTime, r.crashes])))
      .toBe(JSON.stringify(a.riders.map((r) => [r.id, r.finishTime, r.crashes])));
    expect(a.maxSpeed).toBeLessThanOrEqual(78.001);
  });
});
