import { test, expect } from '@playwright/test';
import * as fs from 'fs';

// Mobile audit of the composer (/posts/post) across phone + phablet widths.
// CRITICAL: the composer body (#social-content) uses overflow-x-hidden, which SILENTLY CLIPS
// horizontal overflow — a page-level overflow check misses it. We measure the inner scroll
// container's scrollWidth vs clientWidth directly (the real "content cut off at the edge" bug),
// plus the editor toolbar (.b1) which is the usual overflow culprit when many tools are present.

const SHOTS = 'shots';
const WIDTHS = [390, 594, 768, 1024, 1280];

const measure = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const pick = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return el
        ? { scrollW: el.scrollWidth, clientW: el.clientWidth, over: el.scrollWidth - el.clientWidth }
        : null;
    };
    return {
      doc: {
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      },
      social: pick('#social-content'),
      toolbar: pick('.b1'),
    };
  });

for (const width of WIDTHS) {
  test(`composer mobile audit @${width}px — no horizontal clipping`, async ({ page }) => {
    if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width, height: 860 });
    await page.goto('/posts/post');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);

    await page.screenshot({ path: `${SHOTS}/mobile-${width}-initial.png`, fullPage: true });
    const m = await measure(page);
    console.log(`@${width}px`, JSON.stringify(m));

    // Page must not scroll horizontally.
    expect(m.doc.scrollW, `page overflow @${width}`).toBeLessThanOrEqual(m.doc.clientW + 1);
    // The compose body must not clip content horizontally (overflow-x-hidden hides it visually).
    if (m.social)
      expect(m.social.over, `#social-content clip @${width}: ${JSON.stringify(m.social)}`).toBeLessThanOrEqual(1);
    // The editor toolbar must wrap, not overflow.
    if (m.toolbar)
      expect(m.toolbar.over, `.b1 toolbar clip @${width}: ${JSON.stringify(m.toolbar)}`).toBeLessThanOrEqual(1);
  });
}
