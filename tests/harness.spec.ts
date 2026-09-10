import { test, expect } from '@playwright/test';

// Step 1 gate: the harness itself boots and serves the app shell.
test('app shell serves', async ({ page }) => {
  const res = await page.goto('./');
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/INKFALL/);
});
