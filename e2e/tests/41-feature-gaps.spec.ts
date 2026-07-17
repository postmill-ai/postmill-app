import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { FEATURE_EXPECTATIONS, ExpectedControl } from './lib/expectations';
import { PageAuditor } from './lib/audit';

/**
 * Gap detector: for each feature area, assert the controls/data a WORKING version must expose.
 * Catches the "Teams is incomplete and just wrong" class — a page that renders but is missing
 * its invite/CRUD/profile actions. Missing hard control = GAP (product bug). Present-but-disabled
 * = DEAD. Soft expectations are reported but not failed.
 *
 * Output: results-gaps.json + console summary. This complements the generic crawler (40-).
 */

async function findControl(page: any, c: ExpectedControl): Promise<{ present: boolean; enabled: boolean }> {
  const candidates: any[] = [];
  if (c.role && c.name) candidates.push(page.getByRole(c.role, { name: c.name }));
  else if (c.role) candidates.push(page.getByRole(c.role));
  if (c.name) candidates.push(page.getByText(c.name));
  if (c.text) candidates.push(page.getByText(c.text));
  if (c.css) candidates.push(page.locator(c.css));

  for (const loc of candidates) {
    const el = loc.first();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      const enabled = await el.isEnabled().catch(() => true);
      return { present: true, enabled };
    }
  }
  return { present: false, enabled: false };
}

test('detect missing data / missing actions / broken features', async ({ page }) => {
  test.setTimeout(180_000);
  const auditor = new PageAuditor(page).attach();
  const report: any[] = [];
  let throttled = false;

  for (const feat of FEATURE_EXPECTATIONS) {
    auditor.reset();
    const entry: any = { area: feat.area, route: feat.route, gaps: [], dead: [], present: [], notes: [] };

    try {
      await page.goto(feat.route, { timeout: 25000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1200);

      if (/\/auth\//.test(page.url())) { entry.notes.push('REDIRECTED_TO_AUTH'); report.push(entry); continue; }

      // Open a sub-tab/section if specified (e.g. Settings → Teams)
      if (feat.openTab) {
        const tab = page.getByText(feat.openTab).first();
        if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) {
          await tab.click().catch(() => {});
          await page.waitForTimeout(1200);
        } else {
          entry.notes.push(`TAB_NOT_FOUND: ${feat.openTab.source}`);
        }
      }

      for (const c of feat.controls) {
        const { present, enabled } = await findControl(page, c);
        if (!present) {
          (c.soft ? entry.notes : entry.gaps).push(`${c.soft ? 'soft-missing' : 'MISSING'}: ${c.what}`);
        } else if (c.mustBeEnabled && !enabled) {
          entry.dead.push(`DEAD (disabled): ${c.what}`);
        } else {
          entry.present.push(c.what);
        }
      }
    } catch (e: any) {
      entry.notes.push('ERROR: ' + String(e.message).slice(0, 80));
    }

    if (auditor.hadThrottle()) { entry.notes.push('THROTTLED_429'); throttled = true; }
    const snap = auditor.snapshot();
    entry.apiErrors = snap.apiErrors.filter((e) => e.status !== 429).map((e) => `${e.status} ${e.url}`);
    report.push(entry);
  }

  auditor.detach();
  fs.writeFileSync(path.join(__dirname, '../results-gaps.json'), JSON.stringify({ throttled, report }, null, 2));

  console.log('\n================ FEATURE GAP REPORT ================');
  if (throttled) console.log('⚠️  THROTTLE (429) HIT — re-run after raising API_LIMIT for reliable results.\n');
  let totalGaps = 0, totalDead = 0;
  for (const e of report) {
    const bad = e.gaps.length + e.dead.length;
    totalGaps += e.gaps.length; totalDead += e.dead.length;
    console.log(`\n${bad ? '❌' : '✓'} ${e.area}  (${e.route})`);
    for (const g of e.gaps) console.log(`    🔴 ${g}`);
    for (const d of e.dead) console.log(`    🟠 ${d}`);
    for (const n of e.notes) console.log(`    · ${n}`);
    if (e.present.length) console.log(`    ✓ present: ${e.present.join(', ')}`);
    if (e.apiErrors?.length) console.log(`    api-errors: ${e.apiErrors.join(', ')}`);
  }
  console.log(`\nTOTAL: ${totalGaps} missing actions/data, ${totalDead} dead controls. Full data: e2e/results-gaps.json`);
});
