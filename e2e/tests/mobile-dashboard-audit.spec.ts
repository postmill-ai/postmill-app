import { test } from '@playwright/test';

test('mobile dashboard audit', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');

  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: 'e2e/test-results/mobile-dashboard-393.png', fullPage: true });

  await page.setViewportSize({ width: 360, height: 800 });
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/test-results/mobile-dashboard-360.png', fullPage: true });
});
