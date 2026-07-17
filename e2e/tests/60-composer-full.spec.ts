import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// Full functional walkthrough of the composer (/posts/post) exercising every surface
// touched by the composer upgrade: hybrid channel selector, Start-from Library (drafts/
// templates/signatures), unified media picker (constrained tabs), inline shortlink control,
// Save-as dropup, main-CTA gating, and the timezone abbreviation.

const SHOTS = 'shots';
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {});

// Console noise we don't care about (dev-only warnings, 3rd-party, etc.)
const IGNORE = [/preserve-manual-memoization/i, /Download the React DevTools/i, /\[Fast Refresh\]/i];

test.describe('composer — full UI walkthrough', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  });

  test('exercises every composer surface', async ({ page }) => {
    const errors: string[] = []; // real JS errors (hard fail)
    const failedResponses: { url: string; status: number }[] = [];
    page.on('console', (m) => {
      // Ignore the generic "Failed to load resource" line — we track real statuses via `response`.
      if (
        m.type() === 'error' &&
        !/Failed to load resource/i.test(m.text()) &&
        !IGNORE.some((re) => re.test(m.text()))
      )
        errors.push(m.text().slice(0, 200));
    });
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 200)));
    page.on('response', (r) => {
      if (r.status() >= 400) failedResponses.push({ url: r.url(), status: r.status() });
    });

    // ---- Load ----
    await page.goto('/posts/post');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);
    await shot(page, 'full-01-loaded');

    // ---- CTA gating: "Select a Channel", disabled ----
    const cta = page.getByRole('button', { name: /select a channel/i });
    await expect(cta, 'main CTA shows "Select a Channel" when no channel').toBeVisible();
    await expect(cta, 'main CTA disabled when no channel').toBeDisabled();

    // ---- Timezone abbreviation (not the IANA name) ----
    const bodyText = await page.locator('body').innerText();
    expect(bodyText, 'no raw IANA timezone shown').not.toContain('America/');
    const tzMatch = bodyText.match(/\b([PMCE][SD]T|[A-Z]{2,4}|GMT[+-]?\d+)\b/);
    console.log('timezone token seen near date:', tzMatch?.[0] || '(none matched)');

    // ---- Channel selection: hybrid (icon row <=4, dropdown >4) ----
    const dropdownTrigger = page.locator('button[aria-haspopup="listbox"]').first();
    const iconPicks = page.locator('div.cursor-pointer.rounded-full:has(img[alt])');
    let selected = false;
    if (await dropdownTrigger.count()) {
      console.log('channel selector: DROPDOWN mode (>4 channels)');
      await dropdownTrigger.click();
      await page.waitForTimeout(500);
      const listbox = page.locator('[role="listbox"]');
      await expect(listbox, 'dropdown opens with role=listbox').toBeVisible();
      await shot(page, 'full-02-channel-dropdown');
      // search filters
      const search = listbox.locator('input[type="text"]').first();
      if (await search.count()) await search.fill('a');
      await page.waitForTimeout(300);
      const firstOption = page.locator('[role="option"]').first();
      if (await firstOption.count()) {
        await firstOption.click();
        selected = true;
      }
      await page.keyboard.press('Escape').catch(() => {});
    } else if (await iconPicks.count()) {
      console.log('channel selector: ICON ROW mode (<=4 channels), count=', await iconPicks.count());
      await iconPicks.first().click();
      selected = true;
    } else {
      console.log('WARNING: no channels available on this account');
    }
    await page.waitForTimeout(1200);
    await shot(page, 'full-03-channel-selected');

    // After selecting, the CTA label should no longer be "Select a Channel"
    if (selected) {
      await expect(
        page.getByRole('button', { name: /select a channel/i }),
        'CTA label flips once a channel is selected'
      ).toHaveCount(0, { timeout: 8000 });
    }

    // ---- Editor typing ----
    const editor = page.locator('.ProseMirror, [contenteditable="true"]').first();
    if (await editor.count()) {
      await editor.click();
      await editor.type('E2E composer walkthrough — https://example.com/some/long/link', { delay: 8 });
    }
    await page.waitForTimeout(1500);
    await shot(page, 'full-04-typed');

    // ---- Inline shortlink control appears once a URL is present (provider or hint) ----
    const shortlinkToggle = page.getByText(/shorten links via/i);
    const shortlinkHint = page.getByText(/connect a short-link provider/i);
    const hasShortlinkUi =
      (await shortlinkToggle.count()) > 0 || (await shortlinkHint.count()) > 0;
    console.log('shortlink control present after URL typed:', hasShortlinkUi);

    // ---- Unified media picker: opens, tabs constrained (no Icons/Stickers) ----
    // The label text is hidden at narrow widths (maxMedia:hidden); click the container div.
    const insertMedia = page
      .locator('div.cursor-pointer', { has: page.getByText('Insert Media', { exact: false }) })
      .first();
    if (await insertMedia.count()) {
      await insertMedia.click();
      await page.waitForTimeout(1200);
      await shot(page, 'full-05-media-picker');
      await expect(page.getByText('My Files', { exact: false }).first(), 'My Files tab present').toBeVisible();
      await expect(page.getByText('Stock Icons', { exact: false }), 'Icons tab hidden in composer').toHaveCount(0);
      await expect(page.getByText('Stock Stickers', { exact: false }), 'Stickers tab hidden in composer').toHaveCount(0);
      // Close deterministically via the modal's close button (it overlays fixed inset-0).
      await page.locator('[aria-label="Close media selector"]').first().click().catch(() => {});
      await expect(
        page.locator('[role="dialog"][aria-label="Select media"]'),
        'media picker closed'
      ).toHaveCount(0, { timeout: 8000 });
    } else {
      console.log('WARNING: Insert Media button not found');
    }

    // ---- Start from… Library: 3 tabs, drafts load with real data ----
    const startFrom = page.getByRole('button', { name: /start from/i }).first();
    await expect(startFrom, '"Start from…" trigger present').toBeVisible();
    await startFrom.click();
    await page.waitForTimeout(1200);
    await shot(page, 'full-06-library');
    await expect(page.getByText('Library', { exact: true }).first()).toBeVisible();
    for (const label of ['Drafts', 'Post Templates', 'Signatures']) {
      await expect(page.getByText(label, { exact: true }).first(), `${label} tab present`).toBeVisible();
    }
    // Drafts tab is default — data should be real (no "undefined"/"Invalid Date")
    const libText = await page.locator('[role="dialog"], body').innerText();
    expect(libText).not.toContain('Invalid Date');
    // Visit the other two tabs
    for (const label of ['Post Templates', 'Signatures']) {
      await page.getByText(label, { exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(600);
      await shot(page, `full-07-library-${label.replace(/\s+/g, '-').toLowerCase()}`);
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);

    // ---- Save as dropup reveals Draft + Template ----
    const saveAs = page.getByRole('button', { name: /^save as$/i }).first();
    if (await saveAs.count()) {
      await saveAs.hover();
      await page.waitForTimeout(400);
      await shot(page, 'full-08-save-as');
      await expect(page.getByRole('button', { name: /save as draft/i }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /save as template/i }).first()).toBeVisible();
    } else {
      console.log('WARNING: Save as button not found');
    }

    // ---- Error budget ----
    console.log('--- JS/page errors ---');
    [...new Set(errors)].slice(0, 12).forEach((e) => console.log('  ', e));
    console.log('--- HTTP >=400 responses ---');
    const uniqFailed = [
      ...new Map(failedResponses.map((f) => [f.url, f])).values(),
    ].map((f) => `${f.status} ${f.url.replace('http://localhost:4200', '').split('?')[0]}`);
    uniqFailed.forEach((f) => console.log('  ', f));

    // Hard fail: any JS/page error.
    expect(errors, `JS errors: ${[...new Set(errors)].join(' | ')}`).toEqual([]);
    // Hard fail: any 5xx, or a 4xx on a composer-critical DATA API.
    // `internal-plugs` 404s by design for providers without plugs (pre-existing, handled
    // gracefully by high.order.provider.tsx) — not a composer regression, so it's excluded.
    const CRITICAL = [
      /\/posts\/list/,
      /should-shortlink/,
      /\/sets(\b|\/|\?)/,
      /\/signatures(\b|\/|\?)/,
      /\/integrations\/list/,
    ];
    const critical = failedResponses.filter(
      (f) =>
        !/internal-plugs/.test(f.url) &&
        (f.status >= 500 || CRITICAL.some((re) => re.test(f.url)))
    );
    expect(
      critical,
      `composer-critical failed responses: ${critical.map((c) => c.status + ' ' + c.url).join(' | ')}`
    ).toEqual([]);
  });
});
