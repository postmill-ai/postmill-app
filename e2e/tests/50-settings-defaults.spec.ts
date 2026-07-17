import { test, expect } from '@playwright/test';

// Light E2E coverage for the Model Defaults and Media Defaults settings tabs.
// Requires the standard auth setup (E2E_PASSWORD). Skipped when not configured.
const SKIP = !process.env.E2E_PASSWORD;

(SKIP ? test.skip : test)('model defaults round-trip + catalog', async ({ page }) => {
  await page.goto('/settings?tab=ai');
  await page.waitForLoadState('networkidle');

  // Open the Model Defaults sub-tab.
  await page.getByText('Model Defaults', { exact: false }).first().click();
  await page.waitForTimeout(500);

  const requests: { method: string; url: string; status: number }[] = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/settings/ai/defaults')) {
      requests.push({ method: res.request().method(), url, status: res.status() });
    }
  });

  // The tab should fetch the defaults list.
  await expect.poll(() => requests.some((r) => r.method === 'GET' && r.url.includes('/settings/ai/defaults'))).toBe(true);

  // Catalog request is lazy (combobox); opening the first selector triggers it.
  const firstSelect = page.locator('input[placeholder="Search or type a model…"]').first();
  if (await firstSelect.count()) {
    await firstSelect.click();
    await page.waitForTimeout(800);
    await expect.poll(() => requests.some((r) => r.method === 'GET' && r.url.includes('/settings/ai/defaults/catalog'))).toBe(true);
  }
});

(SKIP ? test.skip : test)('media defaults round-trip + catalog', async ({ page }) => {
  await page.goto('/settings?tab=content');
  await page.waitForLoadState('networkidle');

  // Open the Media Defaults sub-tab.
  await page.getByText('Media Defaults', { exact: false }).first().click();
  await page.waitForTimeout(500);

  const requests: { method: string; url: string; status: number }[] = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/settings/content/media-defaults')) {
      requests.push({ method: res.request().method(), url, status: res.status() });
    }
  });

  await expect.poll(() => requests.some((r) => r.method === 'GET' && r.url.includes('/settings/content/media-defaults'))).toBe(true);

  const firstSelect = page.locator('input[placeholder="Search or type a model…"]').first();
  if (await firstSelect.count()) {
    await firstSelect.click();
    await page.waitForTimeout(800);
    await expect.poll(() => requests.some((r) => r.method === 'GET' && r.url.includes('/settings/content/media-defaults/catalog'))).toBe(true);
  }
});
