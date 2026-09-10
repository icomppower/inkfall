import { test, expect, type Page } from '@playwright/test';

type Api = {
  ready: boolean;
  reset(seed?: string): void;
  seek(p: number, speed?: number): void;
  step(n: number): void;
  input(p: Record<string, unknown>): void;
  state(): {
    race: Record<string, number | string>;
    physics: Record<string, number | boolean | string | null | Record<string, unknown>>;
    render: { scenery: Record<string, number> } & Record<string, unknown>;
  };
  terrainPoke(): { worst: number; samples: number; over5cm: number };
  sample(s: number, lateral: number): { surface: string; voidGap: boolean; height: number; width: number };
};

async function boot(page: Page): Promise<void> {
  await page.goto('./?capture=1&seed=TMS-01');
  await page.waitForFunction(() => (window as unknown as { __INKFALL?: { ready: boolean } }).__INKFALL?.ready === true, undefined, { timeout: 60000 });
}

test.describe('step 5 — sections, scenery, jumps, landings', () => {
  test('every prop class is generated and placed', async ({ page }) => {
    await boot(page);
    const s = await page.evaluate(() => (window as unknown as { __INKFALL: Api }).__INKFALL.state().render.scenery);
    expect(s.trees, 'instanced trees').toBeGreaterThan(300);
    expect(s.bamboo, '竹林峽 bamboo').toBeGreaterThan(300);
    expect(s.boulders, '石澗 boulders').toBeGreaterThan(150);
    expect(s.grass, '芒草 tufts').toBeGreaterThan(1000);
    expect(s.signposts, 'three signposts with drawn characters').toBe(3);
    expect(s.gates, 'five checkpoint gates').toBe(5);
    expect(s.walls, 'terrace and village walls').toBeGreaterThan(20);
    expect(s.crowd, 'village crowd silhouettes').toBeGreaterThan(10);
  });

  test('the course mask keeps coarse terrain off the trail apron', async ({ page }) => {
    await boot(page);
    const poke = await page.evaluate(() => (window as unknown as { __INKFALL: Api }).__INKFALL.terrainPoke());
    expect(poke.samples).toBeGreaterThan(4000);
    expect(poke.over5cm, 'no terrain rises through the trail').toBe(0);
    expect(poke.worst).toBeLessThanOrEqual(0.05);
  });

  test('sections carry their own surfaces and features', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      return {
        start: api.sample(60, 0).surface,
        ridge: api.sample(500, 0).surface,
        rock: api.sample(1000, 0).surface,
        terraces: api.sample(1300, 0).surface,
        bridge: api.sample(1985, 0).surface,
        village: api.sample(2200, 0).surface,
        ravine: api.sample(1884, 0).voidGap,
        tabletopRise: api.sample(1408, 0).height - api.sample(1380, 0).height,
      };
    });
    expect(r.start).toBe('tarmac');
    expect(r.ridge).toBe('hardpack');
    expect(r.rock).toBe('rock');
    expect(r.terraces).toBe('dirt');
    expect(r.bridge).toBe('wood');
    expect(r.village).toBe('stone');
    expect(r.ravine).toBe(true);
  });

  test('checkpoints arm, and a crash respawns at the last one', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.reset();
      api.seek(330 / 2300, 12);
      api.input({ pedal: 1 });
      api.step(900);                                    // roll past the 350 m gate
      const cp = api.state().race.checkpoint as number;
      const cpS = api.state().race.s as number;
      // Now go over the cliff on the ridge.
      api.input({ pedal: 0, steer: -1 });
      let crashed = false;
      for (let i = 0; i < 900 && !crashed; i++) { api.step(1); crashed = api.state().race.phase === 'crashed'; }
      const reason = api.state().physics.lastCrashReason as string;
      api.step(260);                                    // 1.6 s of tumble, then respawn
      const after = api.state();
      return { cp, cpS, crashed, reason, respawnS: after.race.s as number, speed: after.physics.speedKmh as number, crashes: after.race.crashes as number };
    });
    expect(r.cp, 'first checkpoint armed').toBeGreaterThanOrEqual(1);
    expect(r.crashed).toBe(true);
    expect(r.reason).toContain('cliff');
    expect(r.crashes).toBe(1);
    expect(r.respawnS, 'respawned at the checkpoint gate').toBeCloseTo(350, 0);
    expect(r.speed).toBeLessThan(1);
  });

  test('kill gate 5 — timed backflip lands clean and pays boost', async ({ page }) => {
    await boot(page);
    const res = await page.evaluate(([v, t]) => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.reset();
      api.seek(1380 / 2300, v);
      api.input({ pedal: 1, preload: true, trick: 0, brake: 0, steer: 0 });
      let released = false, wasAir = false, maxAir = 0;
      let land: Record<string, unknown> | null = null;
      for (let i = 0; i < 900; i++) {
        api.step(1);
        const st = api.state();
        const air = st.physics.airborne as boolean;
        if (!released && (st.race.s as number) > 1411.5) { api.input({ preload: false }); released = true; }
        if (released && air && !wasAir) { wasAir = true; api.input({ trick: t }); }
        if (air) maxAir = Math.max(maxAir, st.physics.airTime as number);
        if (wasAir && !air) { land = st.physics.lastLanding as Record<string, unknown>; break; }
        if (st.race.phase === 'crashed') break;
      }
      const st = api.state();
      return { maxAir, land, boost: st.physics.boost as number, crashes: st.race.crashes as number, reason: st.physics.lastCrashReason as string };
    }, [20, 5]);
    expect(res.maxAir, 'the deck exit actually launches the rider').toBeGreaterThan(1.2);
    expect(res.land, 'a landing was judged').not.toBeNull();
    expect((res.land as Record<string, unknown>).trick).toBe(5);
    expect((res.land as Record<string, unknown>).trickComplete).toBe(true);
    expect((res.land as Record<string, unknown>).clean, 'clean landing').toBe(true);
    expect(res.boost, 'boost paid out').toBeGreaterThan(0);
    expect(res.crashes).toBe(0);
  });

  test('kill gate 5 — under-rotated backflip crashes', async ({ page }) => {
    await boot(page);
    const res = await page.evaluate(([v, t]) => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.reset();
      api.seek(1380 / 2300, v);
      api.input({ pedal: 1, preload: true, trick: 0, brake: 0, steer: 0 });
      let released = false, wasAir = false;
      let land: Record<string, unknown> | null = null;
      for (let i = 0; i < 900; i++) {
        api.step(1);
        const st = api.state();
        const air = st.physics.airborne as boolean;
        if (!released && (st.race.s as number) > 1411.5) { api.input({ preload: false }); released = true; }
        if (released && air && !wasAir) { wasAir = true; api.input({ trick: t }); }
        if (wasAir && !air) { land = st.physics.lastLanding as Record<string, unknown>; break; }
        if (st.race.phase === 'crashed') { land = st.physics.lastLanding as Record<string, unknown>; break; }
      }
      const st = api.state();
      return { land, crashes: st.race.crashes as number, reason: st.physics.lastCrashReason as string, phase: st.race.phase as string };
    }, [11, 5]);
    expect(res.land, 'a landing was judged').not.toBeNull();
    expect((res.land as Record<string, unknown>).trickComplete).toBe(false);
    expect((res.land as Record<string, unknown>).crash).toBe(true);
    expect(res.crashes).toBe(1);
    expect(res.reason).toContain('trick');
  });

  test('coming up short at the 竹林峽 ravine is a crash', async ({ page }) => {
    await boot(page);
    const res = await page.evaluate(() => {
      const api = (window as unknown as { __INKFALL: Api }).__INKFALL;
      api.reset();
      // Drop off the take-off lip with nowhere near enough speed for the 14 m gap.
      api.seek(1878 / 2300, 4);
      api.input({ pedal: 0, brake: 0, preload: false, steer: 0 });
      for (let i = 0; i < 1400; i++) {
        api.step(1);
        if (api.state().race.phase === 'crashed') break;
      }
      const st = api.state();
      return { phase: st.race.phase as string, reason: st.physics.lastCrashReason as string };
    });
    expect(res.phase).toBe('crashed');
    expect(res.reason).toContain('ravine');
  });
});
