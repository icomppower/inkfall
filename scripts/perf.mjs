#!/usr/bin/env node
/**
 * Kill gate 9: p95 frame time at 1080p, DPR 1, on the real GPU.
 *
 * vsync is disabled explicitly. With it on, every frame lands on the monitor's refresh
 * period and the number you measure is the display, not the renderer.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PORT = 4174;
const URL_BASE = `http://127.0.0.1:${PORT}/inkfall/`;
const HEADLESS = process.argv.includes('--headless');
const FRAMES = Number(process.env.PERF_FRAMES ?? 900);
const BUDGET_MS = 20;

if (!existsSync(`${ROOT}/dist/index.html`)) {
  console.error('dist/ is missing — run `npm run build` first.');
  process.exit(2);
}

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
});
const shutdown = () => { try { server.kill('SIGTERM'); } catch { /* already gone */ } };
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(130); });

async function waitForServer(timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(URL_BASE);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

function pct(sorted, p) {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

const run = async () => {
  await waitForServer();
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1920,1080',
      ...(HEADLESS ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--ignore-gpu-blocklist']),
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`${URL_BASE}?capture=1&seed=TMS-01`);
  await page.waitForFunction(() => window.__INKFALL?.ready === true, undefined, { timeout: 60000 });

  const info = await page.evaluate(async (frames) => {
    const api = window.__INKFALL;
    api.lockDpr(1);
    api.reset();
    api.autopilot(true);
    api.start();
    // Warm-up: let shaders compile and the first buffers upload.
    await new Promise((resolve) => {
      let n = 0;
      const warm = () => (++n < 90 ? requestAnimationFrame(warm) : resolve(null));
      requestAnimationFrame(warm);
    });
    const deltas = [];
    await new Promise((resolve) => {
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        deltas.push(now - last);
        last = now;
        if (deltas.length < frames) requestAnimationFrame(tick);
        else resolve(null);
      };
      requestAnimationFrame(tick);
    });
    const st = api.state();
    return {
      deltas,
      dpr: st.render.dpr,
      triangles: st.render.triangles,
      drawCalls: st.render.drawCalls,
      canvas: [window.innerWidth, window.innerHeight],
      renderer: (() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
        return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
      })(),
    };
  }, FRAMES);

  await browser.close();
  shutdown();

  const sorted = info.deltas.slice().sort((a, b) => a - b);
  const mean = info.deltas.reduce((a, b) => a + b, 0) / info.deltas.length;
  const p50 = pct(sorted, 50), p95 = pct(sorted, 95), p99 = pct(sorted, 99);
  const gating = !HEADLESS;

  console.log('INKFALL perf — kill gate 9');
  console.log(`  gpu         ${info.renderer}`);
  console.log(`  mode        ${HEADLESS ? 'headless SwiftShader (recorded, not gating)' : 'real GPU (gating)'}`);
  console.log(`  canvas      ${info.canvas[0]}x${info.canvas[1]} @ DPR ${info.dpr}`);
  console.log(`  geometry    ${info.triangles} tris, ${info.drawCalls} draw calls`);
  console.log(`  frames      ${info.deltas.length}`);
  console.log(`  mean        ${mean.toFixed(2)} ms  (${(1000 / mean).toFixed(0)} fps)`);
  console.log(`  p50         ${p50.toFixed(2)} ms`);
  console.log(`  p95         ${p95.toFixed(2)} ms   budget ${BUDGET_MS} ms`);
  console.log(`  p99         ${p99.toFixed(2)} ms`);

  if (!gating) {
    console.log('  RESULT      recorded only — headless numbers do not gate.');
    return;
  }
  if (p95 > BUDGET_MS) {
    console.error(`  RESULT      FAIL — p95 ${p95.toFixed(2)} ms exceeds ${BUDGET_MS} ms`);
    process.exit(1);
  }
  console.log('  RESULT      PASS');
};

run().catch((err) => { console.error(err); shutdown(); process.exit(1); });
