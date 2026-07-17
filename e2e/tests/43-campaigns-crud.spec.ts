import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { PageAuditor } from './lib/audit';
import { dismissModal } from './lib/crawl';

/**
 * Campaigns CRUD e2e (route /campaigns, component campaigns.page.tsx).
 *
 * One sequential test: create → verify in list → edit → verify → delete → verify gone.
 * Every step is wrapped in try/catch with timeouts so the test ALWAYS passes and records
 * findings instead of hard-failing. Missing/dead controls are flagged as gaps; API errors
 * are recorded; a 429 marks the run as contaminated.
 *
 * Output: e2e/results-campaigns.json + console summary.
 */

interface ApiHit {
  method: string;
  url: string;
  status: number;
}

test('campaigns CRUD — create / update / delete', async ({ page }) => {
  test.setTimeout(120_000);

  const auditor = new PageAuditor(page).attach();

  const findings: any = {
    route: '/campaigns',
    formPresent: false,
    created: false,
    createStatus: null as number | null,
    updated: false,
    updateStatus: null as number | null,
    deleted: false,
    deleteStatus: null as number | null,
    uniqueName: '',
    editedName: '',
    gaps: [] as string[],
    notes: [] as string[],
    apiErrors: [] as string[],
    consoleErrors: [] as string[],
    contaminated: false,
  };

  const uniqueName = `E2E-Camp-${Date.now()}`;
  const editedName = `${uniqueName}-edited`;
  findings.uniqueName = uniqueName;
  findings.editedName = editedName;

  // Track the relevant API calls live so we can attribute statuses to each step.
  const apiHits: ApiHit[] = [];
  page.on('response', (res) => {
    const url = res.url();
    if (!url.includes('/api/')) return;
    if (!/\/campaigns(\/|\?|$)/.test(url)) return;
    try {
      const u = new URL(url);
      apiHits.push({
        method: res.request().method(),
        url: u.pathname.replace(/^.*\/api\//, '/api/'),
        status: res.status(),
      });
    } catch {
      /* ignore parse errors */
    }
  });

  const lastStatus = (method: RegExp, urlMatch?: RegExp): number | null => {
    const matched = apiHits.filter(
      (h) => method.test(h.method) && (!urlMatch || urlMatch.test(h.url)),
    );
    return matched.length ? matched[matched.length - 1].status : null;
  };

  // ---- Step 1: load page + confirm the create form is present -------------------------
  try {
    await page.goto('/campaigns', { timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    // Let the /campaigns SWR fetch resolve before probing the (always-rendered) form.
    await page.waitForTimeout(1500);

    if (/\/auth\//.test(page.url())) {
      findings.notes.push('REDIRECTED_TO_AUTH — not authenticated');
    }
  } catch (e: any) {
    findings.notes.push('GOTO_ERROR: ' + String(e.message).slice(0, 100));
  }

  let nameInput = page.getByPlaceholder(/campaign name/i).first();
  try {
    if (!(await nameInput.isVisible({ timeout: 4000 }).catch(() => false))) {
      // Fallback: first textbox on the page.
      nameInput = page.getByRole('textbox').first();
    }
    findings.formPresent = await nameInput.isVisible({ timeout: 3000 }).catch(() => false);
    if (!findings.formPresent) {
      findings.gaps.push('GAP: create form / name input not found on /campaigns');
    }
  } catch (e: any) {
    findings.notes.push('FORM_PROBE_ERROR: ' + String(e.message).slice(0, 100));
  }

  // ---- Step 2: CREATE ------------------------------------------------------------------
  try {
    if (findings.formPresent) {
      await nameInput.fill(uniqueName, { timeout: 5000 });

      // Optional description input.
      const desc = page.getByPlaceholder(/description/i).first();
      if (await desc.isVisible({ timeout: 1500 }).catch(() => false)) {
        await desc.fill('created by e2e').catch(() => {});
      } else {
        findings.notes.push('description input not found (optional)');
      }

      const saveBtn = page
        .getByRole('button', { name: /^create$|^update$/i })
        .first();
      if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await saveBtn.click({ timeout: 5000 }).catch((e) =>
          findings.notes.push('CREATE_CLICK_ERROR: ' + String(e.message).slice(0, 60)),
        );
      } else {
        findings.gaps.push('GAP: Save/Create button not found');
      }

      // Wait for the POST + list refresh.
      await page
        .waitForResponse(
          (r) =>
            /\/campaigns(\?|$)/.test(r.url()) && r.request().method() === 'POST',
          { timeout: 10000 },
        )
        .catch(() => {});
      await page.waitForTimeout(1500);

      findings.createStatus = lastStatus(/POST/, /\/campaigns(\?|$)/);

      // Verify the new campaign appears in the list.
      const created = page.getByText(uniqueName).first();
      findings.created = await created.isVisible({ timeout: 6000 }).catch(() => false);
      if (!findings.created) {
        findings.notes.push(
          `created campaign "${uniqueName}" did not appear in list (status=${findings.createStatus})`,
        );
      }
    } else {
      findings.notes.push('skipped CREATE — no form');
    }
  } catch (e: any) {
    findings.notes.push('CREATE_ERROR: ' + String(e.message).slice(0, 100));
  }

  // ---- Step 3: UPDATE ------------------------------------------------------------------
  try {
    if (findings.created) {
      // Find the row container for the created campaign, then its Edit control.
      const row = page
        .locator('div')
        .filter({ hasText: uniqueName })
        .last();

      let editBtn = row.getByRole('button', { name: /edit/i }).first();
      if (!(await editBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
        // Fallback: any visible Edit button on the page.
        editBtn = page.getByRole('button', { name: /edit/i }).first();
      }

      if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await editBtn.click({ timeout: 5000 }).catch((e) =>
          findings.notes.push('EDIT_CLICK_ERROR: ' + String(e.message).slice(0, 60)),
        );
        await page.waitForTimeout(800);

        // The form is reused for editing — name input is now prefilled.
        const editNameInput = page.getByPlaceholder(/campaign name/i).first();
        const target = (await editNameInput.isVisible({ timeout: 2000 }).catch(() => false))
          ? editNameInput
          : page.getByRole('textbox').first();

        await target.fill(editedName, { timeout: 5000 }).catch((e) =>
          findings.notes.push('EDIT_FILL_ERROR: ' + String(e.message).slice(0, 60)),
        );

        const updateBtn = page
          .getByRole('button', { name: /^create$|^update$/i })
          .first();
        if (await updateBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await updateBtn.click({ timeout: 5000 }).catch((e) =>
            findings.notes.push('UPDATE_CLICK_ERROR: ' + String(e.message).slice(0, 60)),
          );
        } else {
          findings.gaps.push('GAP: Update/Save button not found in edit mode');
        }

        await page
          .waitForResponse(
            (r) => /\/campaigns\//.test(r.url()) && r.request().method() === 'PUT',
            { timeout: 10000 },
          )
          .catch(() => {});
        await page.waitForTimeout(1500);

        findings.updateStatus = lastStatus(/PUT/, /\/campaigns\//);

        const editedVisible = page.getByText(editedName).first();
        findings.updated = await editedVisible.isVisible({ timeout: 6000 }).catch(() => false);
        if (!findings.updated) {
          findings.notes.push(
            `edited name "${editedName}" not shown in list (status=${findings.updateStatus})`,
          );
        }
      } else {
        findings.gaps.push('GAP: no Edit control found for the created campaign');
      }
    } else {
      findings.notes.push('skipped UPDATE — campaign was not created');
    }
  } catch (e: any) {
    findings.notes.push('UPDATE_ERROR: ' + String(e.message).slice(0, 100));
  }

  // ---- Step 4: DELETE ------------------------------------------------------------------
  try {
    // Delete the row matching whichever name is currently present.
    const liveName = findings.updated ? editedName : uniqueName;
    if (findings.created) {
      const row = page.locator('div').filter({ hasText: liveName }).last();

      let deleteBtn = row.getByRole('button', { name: /delete|remove/i }).first();
      if (!(await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
        deleteBtn = page.getByRole('button', { name: /delete|remove/i }).first();
      }

      if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await deleteBtn.click({ timeout: 5000 }).catch((e) =>
          findings.notes.push('DELETE_CLICK_ERROR: ' + String(e.message).slice(0, 60)),
        );

        // Confirm any dialog if one appears (component deletes immediately, but be safe).
        const confirm = page.getByText(/yes|confirm|delete/i).first();
        if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) {
          await confirm.click({ timeout: 3000 }).catch(() => {});
        }
        await dismissModal(page).catch(() => {});

        await page
          .waitForResponse(
            (r) => /\/campaigns\//.test(r.url()) && r.request().method() === 'DELETE',
            { timeout: 10000 },
          )
          .catch(() => {});
        await page.waitForTimeout(1500);

        findings.deleteStatus = lastStatus(/DELETE/, /\/campaigns\//);

        // Verify the campaign disappeared from the list.
        const stillThere = page.getByText(liveName).first();
        const gone = !(await stillThere.isVisible({ timeout: 3000 }).catch(() => false));
        findings.deleted = gone;
        if (!gone) {
          findings.notes.push(
            `campaign "${liveName}" still visible after delete (status=${findings.deleteStatus})`,
          );
        }
      } else {
        findings.gaps.push('GAP: no Delete control found for the campaign');
      }
    } else {
      findings.notes.push('skipped DELETE — campaign was not created');
    }
  } catch (e: any) {
    findings.notes.push('DELETE_ERROR: ' + String(e.message).slice(0, 100));
  }

  // ---- Step 5: Summarize ---------------------------------------------------------------
  const snap = auditor.snapshot();
  findings.contaminated = auditor.hadThrottle();
  if (findings.contaminated) findings.notes.push('THROTTLED_429 — results contaminated');
  findings.apiErrors = snap.apiErrors.map((e) => `${e.status} ${e.method} ${e.url}`);
  findings.consoleErrors = snap.consoleErrors;
  auditor.detach();

  try {
    fs.writeFileSync(
      path.join(__dirname, '../results-campaigns.json'),
      JSON.stringify(findings, null, 2),
    );
  } catch (e: any) {
    findings.notes.push('WRITE_ERROR: ' + String(e.message).slice(0, 80));
  }

  // ---- Console summary -----------------------------------------------------------------
  console.log('\n================ CAMPAIGNS CRUD REPORT ================');
  if (findings.contaminated)
    console.log('⚠️  THROTTLE (429) HIT — results contaminated, re-run after raising API_LIMIT.\n');
  console.log(`formPresent : ${findings.formPresent}`);
  console.log(`created     : ${findings.created} (POST status ${findings.createStatus})`);
  console.log(`updated     : ${findings.updated} (PUT status ${findings.updateStatus})`);
  console.log(`deleted     : ${findings.deleted} (DELETE status ${findings.deleteStatus})`);
  if (findings.gaps.length) {
    console.log('\nGAPS:');
    for (const g of findings.gaps) console.log(`    🔴 ${g}`);
  }
  if (findings.apiErrors.length) {
    console.log('\nAPI ERRORS:');
    for (const a of findings.apiErrors) console.log(`    ${a}`);
  }
  if (findings.consoleErrors.length) {
    console.log('\nCONSOLE ERRORS:');
    for (const c of findings.consoleErrors.slice(0, 10)) console.log(`    ${c}`);
  }
  if (findings.notes.length) {
    console.log('\nNOTES:');
    for (const n of findings.notes) console.log(`    · ${n}`);
  }
  console.log('\nFull data: e2e/results-campaigns.json');
});
