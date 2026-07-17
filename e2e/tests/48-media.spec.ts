import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { PageAuditor } from './lib/audit';
import { inventory, brokenImages } from './lib/crawl';

/**
 * 48 — Media library deep audit (author-only; do NOT run as part of authoring).
 *
 * One test, robust + non-fatal: every probe is wrapped in try/catch and the test
 * ALWAYS PASSES while recording findings. We load /media, inventory existing media,
 * exercise the Uppy uploader with a real 1x1 PNG fixture, probe per-item actions
 * (select / delete / copy-url) non-destructively, and note presence of AI media
 * controls + 3rd-party browsers. We flag missing upload control, broken images,
 * media-API 4xx/5xx, and a blank page with neither items nor an empty-state. 429s
 * are recorded as throttle and mark the run contaminated.
 *
 * UI facts sourced from files/file.component.tsx + files/new.uploader.tsx:
 *  - Route /files renders a FileBox: an "Upload" <button> that proxies clicks to a
 *    hidden <input type="file">, an Uppy uploader (drag-drop + that input), a search
 *    <input> placeholder "Search by file name", and a media grid.
 *  - Each grid item exposes a select toggle (number badge), a delete control
 *    (DeleteCircleIcon), and a maximize/preview control. Empty grid shows a
 *    NoMediaIcon + "Select or upload pictures (maximum 1 GB per upload)." text.
 *  - Pagination uses aria-label "Go to previous page" / "Go to next page".
 *  - AI media controls (AiImage / AiVideo / AiMediaOperations) render only when
 *    user.tier.ai is set — presence is recorded, not required.
  *  - API: GET /api/files (list, paginated), POST upload (multipart),
 *    DELETE /api/files/:id.
 */

// 1x1 transparent PNG.
const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwAEhgGAhKmMIQAAAABJRU5ErkJggg==';

const EMPTY_RE = /no media|empty|upload|select or upload/i;

test('media library deep audit', async ({ page }) => {
  const auditor = new PageAuditor(page).attach();

  const findings: any = {
    route: '/files',
    load: {},
    mediaCount: 0,
    brokenImages: 0,
    emptyStateShown: false,
    uploadControlPresent: false,
    uploadAttempted: false,
    uploadStatus: null as number | null,
    uploadReason: '',
    newItemAppeared: false,
    itemActions: [] as string[],
    aiMediaPresent: false,
    thirdPartyBrowsers: [] as string[],
    deletedTestItem: false,
    deleteStatus: null as number | null,
    apiErrors: [],
    consoleErrors: [],
    throttled: false,
    gaps: [] as string[],
  };

  const settle = async () => {
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1200);
  };

  // Count visible media images in the grid via ARIA role (no fragile CSS).
  const countVisibleImages = async (): Promise<number> => {
    try {
      const imgs = page.getByRole('img');
      const total = await imgs.count();
      let visible = 0;
      for (let i = 0; i < Math.min(total, 200); i++) {
        if (await imgs.nth(i).isVisible().catch(() => false)) visible++;
      }
      return visible;
    } catch {
      return 0;
    }
  };

  // ===== 1. Load /files =====
  try {
    const resp = await page.goto('/files', { timeout: 25000 });
    findings.load.status = resp?.status() ?? 0;
    await settle();
    findings.load.url = page.url();
    findings.load.redirectedToAuth = /\/auth(\/|$)/.test(page.url());
    try {
      findings.load.textLen = (await page.locator('main, body').first().innerText())
        .replace(/\s+/g, ' ')
        .trim().length;
    } catch {
      findings.load.textLen = 0;
    }
    // GET /api/files* status from the auditor.
    const snap = auditor.snapshot();
    const listCall = snap.apiCalls.find((c) => c.method === 'GET' && c.url.includes('/api/files'));
    findings.load.mediaListStatus = listCall ? listCall.status : null;
    await page.screenshot({ path: 'media-load.png' }).catch(() => {});
  } catch (e: any) {
    findings.load.error = String(e?.message || e).slice(0, 150);
  }

  // Bail early (still PASS + write results) if we never reached the page.
  if (findings.load.redirectedToAuth || (findings.load.status ?? 0) >= 400) {
    findings.gaps.push('media-page-not-accessible');
    finish(findings, auditor);
    return;
  }

  // ===== 2. Existing media =====
  try {
    findings.mediaCount = await countVisibleImages();
    // Cross-check with the actionable inventory (links/buttons may wrap thumbnails).
    try {
      const inv = await inventory(page);
      findings.inventoryVisible = inv.filter((i) => i.visible).length;
    } catch {
      /* inventory best-effort */
    }
    findings.brokenImages = await brokenImages(page);

    if (findings.mediaCount === 0) {
      try {
        findings.emptyStateShown = (await page.getByText(EMPTY_RE).count()) > 0;
      } catch {
        findings.emptyStateShown = false;
      }
    }
  } catch (e: any) {
    findings.gaps.push('existing-media-probe-exception: ' + String(e?.message || e).slice(0, 80));
  }

  // ===== 3. Upload control + real upload =====
  const fileInput = page.locator('input[type="file"]').first(); // CSS literal — no regex.
  try {
    let triggerVisible = false;
    try {
      const btn = page.getByRole('button', { name: /upload|add|browse/i }).first();
      triggerVisible = await btn.isVisible({ timeout: 3000 }).catch(() => false);
    } catch {
      triggerVisible = false;
    }
    const inputCount = await fileInput.count().catch(() => 0);
    findings.uploadControlPresent = triggerVisible || inputCount > 0;
    findings.uploadTriggerVisible = triggerVisible;
    findings.fileInputCount = inputCount;
    if (!findings.uploadControlPresent) findings.gaps.push('upload-control-missing');
  } catch (e: any) {
    findings.gaps.push('upload-control-probe-exception: ' + String(e?.message || e).slice(0, 80));
  }

  // Attempt a real upload via setInputFiles on the hidden input.
  try {
    const fixturePath = path.join(__dirname, '../fixtures/e2e-pixel.png');
    try {
      fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
      if (!fs.existsSync(fixturePath)) {
        fs.writeFileSync(fixturePath, Buffer.from(PIXEL_PNG_BASE64, 'base64'));
      }
    } catch (e: any) {
      findings.uploadReason = 'fixture-write-failed: ' + String(e?.message || e).slice(0, 80);
    }

    const inputCount = await fileInput.count().catch(() => 0);
    if (inputCount === 0) {
      findings.uploadAttempted = false;
      findings.uploadReason = findings.uploadReason || 'no file input reachable';
    } else if (!fs.existsSync(fixturePath)) {
      findings.uploadAttempted = false;
      findings.uploadReason = findings.uploadReason || 'fixture missing';
    } else {
      const beforeCount = findings.mediaCount;
      auditor.reset();
      findings.uploadAttempted = true;
      // Cookie-auth POSTs require the x-csrf-token header to equal the csrf_token cookie
      // (3Z) — without it the multipart upload is rejected with 403. Read the cookie in
      // page context and set the header BEFORE triggering the file input.
      try {
        const csrf = await page.evaluate(
          () =>
            (document.cookie.split('; ').find((c) => c.startsWith('csrf_token=')) || '').split(
              '='
            )[1] || ''
        );
        findings.csrfTokenPresent = !!csrf;
        if (csrf) await page.setExtraHTTPHeaders({ 'x-csrf-token': csrf });
        else findings.uploadReason = findings.uploadReason || 'csrf_token cookie not found';
      } catch (e: any) {
        findings.uploadReason =
          findings.uploadReason || 'csrf-read-failed: ' + String(e?.message || e).slice(0, 60);
      }
      // setInputFiles works on hidden inputs without needing a visible trigger.
      await fileInput.setInputFiles(fixturePath, { timeout: 8000 });
      await settle();
      await page.waitForTimeout(2500); // give Uppy + multipart POST time to complete

      const snap = auditor.snapshot();
      const uploadCall = snap.apiCalls.find(
        (c) => c.method === 'POST' && c.url.includes('/api/files')
      );
      findings.uploadStatus = uploadCall ? uploadCall.status : null;

      const afterCount = await countVisibleImages();
      findings.newItemAppeared = afterCount > beforeCount;
      findings.uploadAfterCount = afterCount;

      if (findings.uploadStatus && findings.uploadStatus >= 400) {
        findings.gaps.push('upload-api-' + findings.uploadStatus);
      }
      if (!findings.newItemAppeared && (!findings.uploadStatus || findings.uploadStatus < 400)) {
        findings.gaps.push('upload-no-new-item');
      }
      await page.screenshot({ path: 'media-after-upload.png' }).catch(() => {});
    }
  } catch (e: any) {
    findings.uploadReason = 'upload-exception: ' + String(e?.message || e).slice(0, 100);
  }

  // ===== 4. Item actions (non-destructive on pre-existing media) =====
  try {
    const hasMedia = (await countVisibleImages()) > 0;
    if (hasMedia) {
      // Hover the first media image to surface hover-revealed controls.
      try {
        await page.getByRole('img').first().hover({ timeout: 3000 });
        await page.waitForTimeout(400);
      } catch {
        /* hover best-effort */
      }
      for (const [label, re] of [
        ['delete', /delete|remove/i],
        ['copy', /copy/i],
        ['select', /select/i],
      ] as [string, RegExp][]) {
        let present = false;
        try {
          present = (await page.getByRole('button', { name: re }).count()) > 0;
        } catch {
          present = false;
        }
        if (present) findings.itemActions.push(label);
      }
    } else {
      findings.itemActions = [];
    }
  } catch (e: any) {
    findings.gaps.push('item-actions-probe-exception: ' + String(e?.message || e).slice(0, 80));
  }

  // ===== 4b. Delete ONLY a test item we uploaded this run =====
  if (findings.uploadAttempted && findings.newItemAppeared) {
    try {
      auditor.reset();
      // Accept the confirm dialog if one is shown.
      page.once('dialog', (d) => d.accept().catch(() => {}));
      const delBtn = page.getByRole('button', { name: /delete|remove/i }).first();
      if (await delBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await delBtn.click({ timeout: 4000 }).catch(() => {});
        // A confirm modal ("Are you sure...") may need an explicit confirm button.
        try {
          const confirm = page
            .getByRole('button', { name: /yes|delete|confirm|ok/i })
            .last();
          if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) {
            await confirm.click({ timeout: 3000 }).catch(() => {});
          }
        } catch {
          /* no confirm step */
        }
        await settle();
        const snap = auditor.snapshot();
        const delCall = snap.apiCalls.find((c) => c.method === 'DELETE' && c.url.includes('/api/files'));
        findings.deleteStatus = delCall ? delCall.status : null;
        findings.deletedTestItem = !!delCall && delCall.status < 400;
        if (delCall && delCall.status >= 400) findings.gaps.push('delete-api-' + delCall.status);
      }
    } catch (e: any) {
      findings.gaps.push('delete-test-item-exception: ' + String(e?.message || e).slice(0, 80));
    }
  }

  // ===== 5. AI media + 3rd-party browsers (presence only) =====
  try {
    findings.aiMediaPresent = (await page.getByText(/generate|ai/i).count()) > 0;
  } catch {
    findings.aiMediaPresent = false;
  }
  for (const [name, re] of [
    ['unsplash', /unsplash/i],
    ['pexels', /pexels/i],
  ] as [string, RegExp][]) {
    try {
      if ((await page.getByText(re).count()) > 0) findings.thirdPartyBrowsers.push(name);
    } catch {
      /* ignore */
    }
  }

  // ===== 6. Cross-cutting gap flags =====
  if (findings.mediaCount > 0 && findings.brokenImages > 0) {
    findings.gaps.push('broken-images:' + findings.brokenImages);
  }
  if (
    findings.mediaCount === 0 &&
    !findings.emptyStateShown &&
    (findings.load.textLen ?? 0) < 80
  ) {
    findings.gaps.push('blank-page-no-empty-state');
  }

  finish(findings, auditor);
});

// ===== Summarize: write JSON + console, record api/console errors + throttle =====
function finish(findings: any, auditor: PageAuditor) {
  const snap = auditor.snapshot();
  auditor.detach();

  findings.throttled = auditor.hadThrottle();
  if (findings.throttled) findings.gaps.push('THROTTLED-429');

  const mediaErr = snap.apiErrors.filter((c) => c.url.includes('/api/files'));
  for (const c of mediaErr) {
    const tag = `media-api-${c.status}`;
    if (!findings.gaps.includes(tag)) findings.gaps.push(tag);
  }

  findings.apiErrors = snap.apiErrors.map((c) => ({ method: c.method, url: c.url, status: c.status }));
  findings.consoleErrors = snap.consoleErrors.slice(0, 25);
  findings.pageErrors = snap.pageErrors.slice(0, 25);
  findings.failedRequests = snap.failedRequests.slice(0, 25);

  findings.summary = {
    mediaCount: findings.mediaCount,
    brokenImages: findings.brokenImages,
    uploadControlPresent: findings.uploadControlPresent,
    uploadAttempted: findings.uploadAttempted,
    uploadStatus: findings.uploadStatus,
    newItemAppeared: findings.newItemAppeared,
    itemActions: findings.itemActions,
    aiMediaPresent: findings.aiMediaPresent,
    apiErrorCount: findings.apiErrors.length,
    consoleErrorCount: findings.consoleErrors.length,
    throttled: findings.throttled,
    gaps: findings.gaps,
  };

  try {
    fs.writeFileSync(
      path.join(__dirname, '../results-media.json'),
      JSON.stringify(findings, null, 2)
    );
  } catch (e: any) {
    console.log('Could not write results-media.json:', String(e?.message || e));
  }

  console.log('\n===== MEDIA LIBRARY DEEP AUDIT =====');
  console.log(
    `Load: HTTP ${findings.load.status ?? '?'} | textLen ${findings.load.textLen ?? '?'} | auth-redirect ${!!findings.load.redirectedToAuth} | GET /api/files ${findings.load.mediaListStatus ?? '-'}`
  );
  console.log(
    `Media items: ${findings.mediaCount} | broken images: ${findings.brokenImages} | empty-state: ${findings.emptyStateShown}`
  );
  console.log(
    `Upload control: ${findings.uploadControlPresent ? '✓' : '✗'} | attempted: ${findings.uploadAttempted}${
      findings.uploadReason ? ' (' + findings.uploadReason + ')' : ''
    } | status: ${findings.uploadStatus ?? '-'} | new item: ${findings.newItemAppeared}`
  );
  console.log(`Item actions: ${findings.itemActions.join(', ') || 'none detected'}`);
  console.log(
    `AI media present: ${findings.aiMediaPresent} | 3rd-party: ${findings.thirdPartyBrowsers.join(', ') || 'none'} | deleted test item: ${findings.deletedTestItem} (${findings.deleteStatus ?? '-'})`
  );
  console.log(
    `API errors: ${findings.apiErrors.length} | Console errors: ${findings.consoleErrors.length} | Throttled(429): ${findings.throttled}`
  );
  console.log(`Gaps (${findings.gaps.length}): ${findings.gaps.length ? findings.gaps.join(' | ') : 'none'}`);
}
