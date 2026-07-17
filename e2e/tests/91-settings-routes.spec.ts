import { test, expect, Page } from '@playwright/test';

// Settings nested-routes e2e: legacy ?tab= redirects, every section renders as a real route,
// and the Team page exposes the merged "Manage roles" modal. Reuses the saved localhost
// session (playwright.media.config.ts shares e2e/.auth/state.json). Run:
//   npx playwright test -c playwright.media.config.ts -g "Settings routes"

const SETTINGS_ROUTES = [
  'channels', 'team', 'broadcast', 'shortlinks', 'vpn',
  'ai/llm-providers', 'ai/model-defaults', 'ai/brands', 'ai/prompt-templates', 'ai/prompt-library',
  'content/ai-media', 'content/media-defaults', 'content/content-packs', 'content/sets', 'content/signatures',
  'storage/providers', 'storage/audit', 'storage/usage',
  'webhooks', 'autopost', 'developers', 'approved-apps',
];

const IGNORE_CONSOLE = [/Download the React DevTools/i, /\[Fast Refresh\]/i, /Sentry/i, /401/i, /favicon/i, /ResizeObserver/i];

async function gotoResilient(page: Page, path: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
      return true;
    } catch (e) {
      if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(String(e))) { await page.waitForTimeout(4000); continue; }
      throw e;
    }
  }
  return false;
}

test.describe('Settings routes', () => {
  // The dev `proxy.ts` collapses Next's server redirect() into a 200 that serves the target
  // content at the original URL (the "verify with Playwright not HTTP 307" gotcha), so assert
  // on the rendered target content (post-hydration) rather than the browser URL.
  test('legacy ?tab= serves the new section content', async ({ page }) => {
    test.setTimeout(180_000);
    await gotoResilient(page, '/settings?tab=ai');
    await expect(page.getByText('LLM Providers').first()).toBeVisible({ timeout: 45_000 });
    await gotoResilient(page, '/settings?tab=media_providers');
    await expect(page.getByText('Media Defaults').first()).toBeVisible({ timeout: 45_000 });
    await gotoResilient(page, '/settings?tab=roles');
    await expect(page.getByRole('button', { name: /manage roles/i })).toBeVisible({ timeout: 45_000 });
  });

  test('Team page exposes the merged Manage roles modal', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoResilient(page, '/settings/team');
    const btn = page.getByRole('button', { name: /manage roles/i });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();
    // Modal shows the role-definition surface (Create role / a role card).
    await expect(page.getByText(/create role/i).first()).toBeVisible({ timeout: 15_000 });
    // The standalone Roles rail item must be gone.
    await expect(page.getByRole('link', { name: /^Roles$/ })).toHaveCount(0);
  });

  test('every settings route renders without crashing', async ({ page }) => {
    test.setTimeout(SETTINGS_ROUTES.length * 15_000 + 60_000);
    const failures: string[] = [];
    for (const route of SETTINGS_ROUTES) {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const onConsole = (m: any) => { if (m.type() === 'error' && !IGNORE_CONSOLE.some((r) => r.test(m.text()))) consoleErrors.push(m.text()); };
      const onErr = (e: any) => pageErrors.push(String(e));
      page.on('console', onConsole);
      page.on('pageerror', onErr);
      const ok = await gotoResilient(page, `/settings/${route}`);
      if (!ok) { failures.push(`${route}: navigation failed`); }
      else {
        const body = (await page.locator('body').innerText().catch(() => '')) || '';
        if (/Something went wrong|Application error: a client-side exception/i.test(body)) failures.push(`${route}: error-boundary fallback`);
        if (pageErrors.length) failures.push(`${route}: pageerror -> ${pageErrors[0].slice(0, 160)}`);
      }
      page.off('console', onConsole);
      page.off('pageerror', onErr);
    }
    expect(failures, `routes that crashed:\n${failures.join('\n')}`).toEqual([]);
  });
});
