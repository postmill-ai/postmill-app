import { test, expect } from '@playwright/test';
import { ROUTES } from './lib/routes';

/**
 * Regression guard for the document-title a11y fix (root metadata in (app)/layout.tsx).
 * Every non-public app route must render a NON-EMPTY <title>. Public/auth routes are
 * excluded (some render before the app shell). Runs under the audit config as `admin`.
 */
const APP_ROUTES = ROUTES.filter((r) => !r.publicRoute).slice(0, 40);

for (const route of APP_ROUTES) {
  test(`title present: ${route.path}`, async ({ page }) => {
    const res = await page.goto(route.path, { timeout: 30_000 });
    if (res && /\/auth\//.test(page.url())) test.skip(true, 'redirected to auth');
    await page.waitForLoadState('domcontentloaded');
    const title = (await page.title()).trim();
    expect(title, `document.title empty on ${route.path}`).not.toBe('');
  });
}
