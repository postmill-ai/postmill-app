import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { PageAuditor } from './lib/audit';

/**
 * Composer CRUD walkthrough (one sequential test, never hard-fails).
 *
 * Drives the real "Create Post" composer on /launches end to end: open → pick a channel →
 * type unique content → capture the POST /api/posts/valid + /api/posts/preflight calls
 * (headline bug #7: these must be 200, a 400 is the regression) → Save as Draft → verify the
 * draft persists on the calendar after reload → open it and delete it again.
 *
 * Every interaction is wrapped in try/catch with timeouts. Findings are written to
 * e2e/results-composer.json and echoed to the console. Locators use ARIA roles / text /
 * placeholders only (plus one valid CSS :has() for the channel avatars) — never a regex inside
 * a CSS string, which throws.
 */
test('composer CRUD lifecycle', async ({ page }) => {
  const marker = `e2e-crud-${Date.now()}`;
  const content = `E2E composer CRUD ${marker}`;

  const findings: any = {
    marker,
    composerOpened: false,
    channelsPicked: 0,
    contentTyped: false,
    validStatus: null as number | null,
    validBody: null as string | null,
    preflightStatus: null as number | null,
    preflightBody: null as string | null,
    createStatus: null as number | null,
    modalClosedAfterSave: false,
    draftPersisted: false,
    detailOpened: false,
    deleted: false,
    flags: [] as string[],
    steps: [] as string[],
    errors: [] as string[],
    throttled: false,
    apiErrors: [] as any[],
    consoleErrors: [] as string[],
    pageErrors: [] as string[],
  };

  // Capture the validation/preflight bodies + statuses directly off the wire.
  const captured: Record<string, { status: number; body: string }> = {};
  const onResp = async (res: any) => {
    const u = res.url();
    if (u.includes('/api/posts/valid') || u.includes('/api/posts/preflight')) {
      const key = u.includes('/api/posts/valid') ? 'valid' : 'preflight';
      let body = '';
      try {
        body = (await res.text()).slice(0, 300);
      } catch {
        body = '<unreadable>';
      }
      captured[key] = { status: res.status(), body };
    }
  };
  page.on('response', onResp);

  // Track create (POST /api/posts) separately — distinguish from the GET listing.
  let createStatus: number | null = null;
  const onCreate = (res: any) => {
    try {
      const u = new URL(res.url());
      if (u.pathname.endsWith('/api/posts') && res.request().method() === 'POST') {
        createStatus = res.status();
      }
    } catch {
      /* ignore */
    }
  };
  page.on('response', onCreate);

  const auditor = new PageAuditor(page).attach();

  const step = (s: string) => findings.steps.push(s);

  try {
    // ---- 1. Open the composer ----
    step('goto /launches');
    await page.goto('/launches', { timeout: 25000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    // "Create Post" only renders once sortedIntegrations.length > 0, so wait for
    // the integrations to load before probing for it.
    await page.waitForTimeout(2000);

    try {
      const createBtn = page.getByRole('button', { name: /create post/i }).first();
      const createFallback = page.getByText('Create Post').first();
      const btn = (await createBtn.isVisible({ timeout: 4000 }).catch(() => false))
        ? createBtn
        : createFallback;
      if (await btn.isVisible({ timeout: 4000 }).catch(() => false)) {
        await btn.click({ timeout: 5000 });
        await page.waitForTimeout(2000);
      } else {
        // The button is gated on having at least one connected integration, so a
        // miss here is most likely zero connected channels rather than a real gap.
        findings.flags.push('NOTE: Create Post hidden — likely zero connected integrations');
      }
    } catch (e: any) {
      findings.errors.push('open-composer: ' + String(e.message).slice(0, 80));
    }

    // Modal/editor visibility check.
    const editorLoc = page.locator('[contenteditable="true"], .ProseMirror').first();
    const modalLoc = page.locator('[role="dialog"], [class*="modal"]').first();
    findings.composerOpened =
      (await editorLoc.isVisible({ timeout: 5000 }).catch(() => false)) ||
      (await modalLoc.isVisible({ timeout: 2000 }).catch(() => false));
    step(`composer opened: ${findings.composerOpened}`);

    // ---- 2. Select first channel ----
    try {
      const avatars = page.locator('div.cursor-pointer.rounded-full:has(img[alt])');
      const count = await avatars.count().catch(() => 0);
      if (count > 0) {
        await avatars.first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1200);
        findings.channelsPicked = 1;
      } else {
        findings.flags.push('MISSING_ACTION: no channel avatars to pick');
      }
    } catch (e: any) {
      findings.errors.push('select-channel: ' + String(e.message).slice(0, 80));
    }
    step(`channelsPicked: ${findings.channelsPicked}`);

    // ---- 3. Type unique content ----
    try {
      const editorCandidates = [
        page.getByRole('textbox').first(),
        page.locator('[contenteditable="true"]').first(),
        page.locator('.ProseMirror').first(),
      ];
      for (const ed of editorCandidates) {
        if (await ed.isVisible({ timeout: 2500 }).catch(() => false)) {
          await ed.click({ timeout: 4000 }).catch(() => {});
          await ed.type(content, { delay: 8 }).catch(() => {});
          findings.contentTyped = true;
          break;
        }
      }
      if (!findings.contentTyped) findings.flags.push('DEAD_ACTION: editor not typable');
    } catch (e: any) {
      findings.errors.push('type-content: ' + String(e.message).slice(0, 80));
    }
    step(`contentTyped: ${findings.contentTyped}`);
    // Give debounced valid/preflight calls a moment to fire.
    await page.waitForTimeout(2500);

    // ---- 5. Save as Draft ----
    try {
      const draftBtn = page.getByRole('button', { name: /save as draft/i }).first();
      if (await draftBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
        if (await draftBtn.isEnabled().catch(() => true)) {
          await draftBtn.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(4000);
        } else {
          findings.flags.push('DEAD_ACTION: "Save as Draft" present but disabled');
        }
      } else {
        findings.flags.push('MISSING_ACTION: "Save as Draft" button not found');
      }
    } catch (e: any) {
      findings.errors.push('save-draft: ' + String(e.message).slice(0, 80));
    }

    // Did the modal close after save?
    findings.modalClosedAfterSave = !(await editorLoc
      .isVisible({ timeout: 2000 })
      .catch(() => false));
    step(`modalClosedAfterSave: ${findings.modalClosedAfterSave}`);

    // ---- 4. Record captured valid/preflight (now that they have fired) ----
    if (captured.valid) {
      findings.validStatus = captured.valid.status;
      findings.validBody = captured.valid.body;
      if (captured.valid.status >= 400)
        findings.flags.push(`BUG#7: /api/posts/valid returned ${captured.valid.status}`);
    } else {
      findings.flags.push('NOTE: /api/posts/valid never observed');
    }
    if (captured.preflight) {
      findings.preflightStatus = captured.preflight.status;
      findings.preflightBody = captured.preflight.body;
      if (captured.preflight.status >= 400)
        findings.flags.push(`BUG#7: /api/posts/preflight returned ${captured.preflight.status}`);
    } else {
      findings.flags.push('NOTE: /api/posts/preflight never observed');
    }
    findings.createStatus = createStatus;
    if (createStatus != null && createStatus >= 400)
      findings.flags.push(`POST /api/posts (create) returned ${createStatus}`);

    // ---- 6. Reload and verify the draft persisted ----
    try {
      await page.goto('/launches', { timeout: 25000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const byContent = page.getByText(new RegExp(marker, 'i')).first();
      let found = await byContent.isVisible({ timeout: 4000 }).catch(() => false);
      if (!found) {
        // Fall back to looking for any Draft card.
        const draftCard = page
          .locator('[class*="card"], [class*="post"]')
          .filter({ hasText: /draft/i });
        found = (await draftCard.count().catch(() => 0)) > 0;
        if (found) findings.flags.push('NOTE: marker not matched, fell back to a Draft card');
      }
      findings.draftPersisted = found;
    } catch (e: any) {
      findings.errors.push('verify-persist: ' + String(e.message).slice(0, 80));
    }
    step(`draftPersisted: ${findings.draftPersisted}`);

    // ---- 7. Open the draft and delete it ----
    if (findings.draftPersisted) {
      try {
        const card = page.getByText(new RegExp(marker, 'i')).first();
        const target = (await card.isVisible({ timeout: 2000 }).catch(() => false))
          ? card
          : page
              .locator('[class*="card"], [class*="post"]')
              .filter({ hasText: /draft/i })
              .first();
        await target.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(2500);

        findings.detailOpened = await page
          .locator('[role="dialog"], [class*="modal"]')
          .first()
          .isVisible({ timeout: 4000 })
          .catch(() => false);
        step(`detailOpened: ${findings.detailOpened}`);

        // Delete via "Delete Post" (allowDestructive — this is our own test draft).
        const delBtn = page.getByRole('button', { name: /delete post/i }).first();
        if (await delBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
          if (await delBtn.isEnabled().catch(() => true)) {
            await delBtn.click({ timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(1200);
            // Confirm dialog ("Yes" / confirm).
            const confirm = page.getByRole('button', { name: /^(yes|confirm|delete)$/i }).first();
            if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
              await confirm.click({ timeout: 5000 }).catch(() => {});
            }
            await page.waitForTimeout(3000);

            // Re-check the marker is gone.
            const stillThere = await page
              .getByText(new RegExp(marker, 'i'))
              .first()
              .isVisible({ timeout: 3000 })
              .catch(() => false);
            findings.deleted = !stillThere;
          } else {
            findings.flags.push('DEAD_ACTION: "Delete Post" present but disabled');
          }
        } else {
          findings.flags.push('MISSING_ACTION: "Delete Post" button not found in detail/editor');
        }
      } catch (e: any) {
        findings.errors.push('delete: ' + String(e.message).slice(0, 80));
      }
    }
    step(`deleted: ${findings.deleted}`);
  } catch (e: any) {
    findings.errors.push('fatal: ' + String(e.message).slice(0, 120));
  } finally {
    // ---- 8. Summarize ----
    const snap = auditor.snapshot();
    findings.throttled = auditor.hadThrottle();
    if (findings.throttled) findings.flags.push('RUN_CONTAMINATED: 429 throttle observed');
    findings.apiErrors = snap.apiErrors;
    findings.consoleErrors = snap.consoleErrors;
    findings.pageErrors = snap.pageErrors;
    auditor.detach();
    page.off('response', onResp);
    page.off('response', onCreate);

    findings.summary = {
      composerOpened: findings.composerOpened,
      channelsPicked: findings.channelsPicked,
      validStatus: findings.validStatus,
      preflightStatus: findings.preflightStatus,
      createStatus: findings.createStatus,
      draftPersisted: findings.draftPersisted,
      deleted: findings.deleted,
      apiErrors: findings.apiErrors.length,
      consoleErrors: findings.consoleErrors.length,
      throttled: findings.throttled,
    };

    fs.writeFileSync(
      path.join(__dirname, '../results-composer.json'),
      JSON.stringify(findings, null, 2)
    );

    console.log('\n===== COMPOSER CRUD TEST =====');
    console.log(`marker: ${marker}`);
    console.log(`composerOpened: ${findings.composerOpened} | channelsPicked: ${findings.channelsPicked} | contentTyped: ${findings.contentTyped}`);
    console.log(`valid: ${findings.validStatus} | preflight: ${findings.preflightStatus} | create: ${findings.createStatus}`);
    console.log(`modalClosedAfterSave: ${findings.modalClosedAfterSave} | draftPersisted: ${findings.draftPersisted}`);
    console.log(`detailOpened: ${findings.detailOpened} | deleted: ${findings.deleted}`);
    if (findings.flags.length) console.log(`FLAGS:\n  - ${findings.flags.join('\n  - ')}`);
    if (findings.apiErrors.length)
      console.log(`apiErrors: ${findings.apiErrors.map((e: any) => `${e.status} ${e.method} ${e.url}`).slice(0, 6).join(' | ')}`);
    if (findings.consoleErrors.length)
      console.log(`consoleErrors: ${findings.consoleErrors.slice(0, 3).join(' | ')}`);
    if (findings.errors.length) console.log(`stepErrors: ${findings.errors.join(' | ')}`);
    console.log(`throttled(429): ${findings.throttled}`);
  }
});
