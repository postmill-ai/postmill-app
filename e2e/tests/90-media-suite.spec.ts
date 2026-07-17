import { test, expect, Page } from '@playwright/test';

// Media remediation e2e: (A) Media Defaults UI — dropdowns populated from the backend catalog
// + collapsed settings form with real fields; (B) crawl every /media/* studio/route and assert
// it renders without an uncaught error / error-boundary fallback. Reuses the saved localhost
// session (see playwright.media.config.ts). Run:
//   npx playwright test -c playwright.media.config.ts

const MEDIA_ROUTES = [
  'designer',
  // descriptor-driven studios (image)
  'black-forest-labs', 'stability-ai', 'recraft', 'ideogram', 'leonardo', 'openai', 'vertex',
  'google-ai', 'replicate',
  // video studios
  'runway', 'luma', 'minimax', 'kling', 'pika', 'sora', 'wan', 'qwen', 'ltx', 'higgsfield',
  // avatar / character
  'heygen', 'did', 'hedra', 'tavus', 'reelfarm', 'genviral',
  // audio
  'elevenlabs', 'suno', 'deepgram',
  // AI hubs
  'gateway', 'bedrock', 'azure', 'xai', 'groq', 'openrouter', 'fireworks', 'deepinfra', 'siliconflow',
  'togetherai',
  // stock
  'stock-photos', 'stock-videos', 'stock-vectors', 'stock-stickers', 'stock-audio', 'stock-icons',
];

// Console noise we don't want to fail on (3rd-party / dev-only).
const IGNORE_CONSOLE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /Sentry/i,
  /Failed to load resource: the server responded with a status of 401/i, // unconfigured provider probes
  /favicon/i,
  /ResizeObserver loop/i,
];

function attachErrorCollectors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (IGNORE_CONSOLE.some((r) => r.test(t))) return;
    consoleErrors.push(t);
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  return { consoleErrors, pageErrors };
}

test.describe('Media remediation e2e', () => {
  test('session is valid (not redirected to login)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url(), 'saved session should not bounce to /auth/login').not.toContain('/auth/login');
  });

  test('Media Defaults: dropdowns populated + settings form renders', async ({ page }) => {
    test.setTimeout(90_000);
    const { pageErrors } = attachErrorCollectors(page);

    await page.goto('/settings?tab=content');
    await page.waitForLoadState('networkidle');

    // Open the Media Defaults sub-tab.
    const mdTab = page.getByRole('button', { name: /^Media Defaults$/ });
    await expect(mdTab).toBeVisible({ timeout: 15_000 });
    await mdTab.click();

    // The "Text to Image" category row should render a populated native <select>.
    await expect(page.getByText('Text to Image', { exact: true })).toBeVisible({ timeout: 15_000 });

    // Find a select whose options include a "<provider>: <model>" entry (the remediation's whole point).
    const selects = page.locator('select');
    const count = await selects.count();
    let populated = 0;
    let sawProviderModel = false;
    for (let i = 0; i < count; i++) {
      const opts = await selects.nth(i).locator('option').allTextContents();
      const modelOpts = opts.filter((o) => /:\s*\S+/.test(o)); // "provider: model"
      if (opts.length > 1) populated++;
      if (modelOpts.length > 0) sawProviderModel = true;
    }
    expect(populated, 'at least one category dropdown is populated').toBeGreaterThan(0);
    expect(sawProviderModel, 'at least one dropdown shows a "provider: model" option').toBe(true);

    // Select a replicate model on the Text-to-Image row and assert the settings form appears.
    // The first select is Text to Image (first category in the Image group).
    const t2iSelect = selects.first();
    const t2iOptions = await t2iSelect.locator('option').allTextContents();
    const fluxOpt = t2iOptions.find((o) => /replicate:\s*flux/i.test(o));
    if (fluxOpt) {
      await t2iSelect.selectOption({ label: fluxOpt });
      // Collapsed settings form expands below: look for the "Default settings" label + a field control.
      await expect(page.getByText(/Default settings/i).first()).toBeVisible({ timeout: 15_000 });
    } else {
      test.info().annotations.push({ type: 'note', description: 'no replicate flux option on T2I row (org provider config dependent)' });
    }

    expect(pageErrors, `no uncaught errors on Media Defaults: ${pageErrors.join('; ')}`).toEqual([]);
  });

  test('crawl all /media/* routes render without crashing', async ({ page }) => {
    test.setTimeout(MEDIA_ROUTES.length * 15_000 + 60_000);
    const failures: string[] = [];
    const noisy: string[] = [];

    for (const route of MEDIA_ROUTES) {
      const { consoleErrors, pageErrors } = attachErrorCollectors(page);
      // The Next webpack dev server periodically auto-restarts on its memory threshold;
      // in-flight navigations then get ECONNREFUSED. Retry a few times (waiting for the
      // server to come back) so a dev-only restart isn't mistaken for a route crash.
      let ok = false;
      let lastErr = '';
      for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        try {
          await page.goto(`/media/${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
          ok = true;
        } catch (e) {
          lastErr = String(e).slice(0, 120);
          if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(lastErr)) {
            await page.waitForTimeout(4000); // dev server restarting — wait and retry
          } else {
            break;
          }
        }
      }
      if (!ok) {
        failures.push(`${route}: navigation failed (${lastErr})`);
        page.removeAllListeners('console');
        page.removeAllListeners('pageerror');
        continue;
      }

      // Error-boundary fallbacks (RouteError / StudioErrorBoundary) indicate a crash.
      const body = (await page.locator('body').innerText().catch(() => '')) || '';
      const crashed =
        /Something went wrong|This studio (crashed|hit an error)|Application error: a client-side exception/i.test(body);

      if (pageErrors.length) failures.push(`${route}: pageerror -> ${pageErrors.slice(0, 2).join(' | ').slice(0, 200)}`);
      if (crashed) failures.push(`${route}: error-boundary fallback rendered`);
      if (consoleErrors.length) noisy.push(`${route}: ${consoleErrors.length} console error(s) e.g. "${consoleErrors[0].slice(0, 120)}"`);

      // Reset listeners for next route (avoid accumulation).
      page.removeAllListeners('console');
      page.removeAllListeners('pageerror');
    }

    // Report console noise as annotations (non-fatal), fail only on crashes/uncaught errors.
    for (const n of noisy) test.info().annotations.push({ type: 'console', description: n });
    console.log(`\n[media-crawl] ${MEDIA_ROUTES.length} routes; ${failures.length} crash/uncaught; ${noisy.length} with console errors`);
    if (noisy.length) console.log('[media-crawl] console-noisy:\n  ' + noisy.join('\n  '));
    expect(failures, `routes that crashed:\n${failures.join('\n')}`).toEqual([]);
  });
});
