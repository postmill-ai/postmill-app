import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ROUTES } from './lib/routes';
import { PageAuditor } from './lib/audit';
import { inventory, actionableSummary, dismissModal } from './lib/crawl';

/**
 * Actively EXERCISE each route (the crawler only inventories). Per route, non-destructively:
 *  - switch every tab and assert no console/page error,
 *  - open every "opener" control (add/new/create/configure/edit/open/filter/customize/invite/
 *    connect/upload/⋯) and assert the modal/menu MOUNTS without a console/page/API error,
 *  - inside an opened modal, if it has a submit + a required field, submit EMPTY and record
 *    whether it validated, errored uncaught, or silently succeeded (the "/setup Next" class),
 *  - then dismiss to a clean state.
 *
 * Destructive labels (delete/remove/revoke/logout/…) are skipped by safeClick semantics.
 * Findings are flagged, not asserted-fatal. Output: results-exercise-<persona>.json.
 */
const PERSONA = () => test.info().project.name || 'admin';

const OPENER = /add|new|create|configure|connect|edit|open|manage|invite|customize|filter|upload|settings|generate|import|\+/i;
const DESTRUCTIVE = /delete|remove|disconnect|revoke|cancel subscription|log ?out|sign ?out|deactivate|reset|clear|purge|archive|unpublish/i;
const SUBMIT = /save|submit|create|add|confirm|continue|next|send|apply|generate/i;

async function modalOpen(page: any): Promise<boolean> {
  const dialog = page.getByRole('dialog').first();
  if (await dialog.isVisible({ timeout: 300 }).catch(() => false)) return true;
  const bespoke = page.locator('[class*="modal" i], [data-modal], [role="dialog"]').first();
  return bespoke.isVisible({ timeout: 300 }).catch(() => false);
}

test('exercise menus, modals and forms on every route', async ({ page }) => {
  test.setTimeout(600_000);
  const persona = PERSONA();
  const auditor = new PageAuditor(page).attach();
  const findings: any[] = [];

  for (const route of ROUTES) {
    if (route.publicRoute) continue; // auth/share flows exercised separately
    const f: any = { name: route.name, path: route.path, persona, area: route.area, actions: [], flags: [] };

    try {
      await page.goto(route.path, { timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
      await page.waitForTimeout(700);
    } catch (e: any) {
      f.flags.push('NAV_ERROR: ' + String(e.message).slice(0, 60));
      findings.push(f);
      continue;
    }
    if (/\/auth\//.test(page.url())) { f.skipped = 'redirected-to-auth'; findings.push(f); continue; }

    const items = await inventory(page);
    f.summary = actionableSummary(items);

    // ---- Tabs: switching should never throw ----
    const tabLabels = [...new Set(items.filter((i) => i.role === 'tab' && i.visible && i.enabled && i.label).map((i) => i.label))].slice(0, 12);
    for (const label of tabLabels) {
      auditor.reset();
      const tab = page.getByRole('tab', { name: label }).first();
      if (!(await tab.isVisible().catch(() => false))) continue;
      await tab.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(400);
      const s = auditor.snapshot();
      const bad = [...s.pageErrors, ...s.apiErrors.filter((e) => e.status >= 500).map((e) => e.url)];
      if (bad.length) f.flags.push(`TAB_ERROR[${label}]: ${bad.slice(0, 2).join(' | ')}`);
    }

    // ---- Openers: modals/menus should mount cleanly ----
    const openers = [...new Set(
      items.filter((i) => (i.role === 'button' || i.role === 'link') && i.visible && i.enabled && i.label && OPENER.test(i.label) && !DESTRUCTIVE.test(i.label)).map((i) => i.label)
    )].slice(0, 18);

    for (const label of openers) {
      auditor.reset();
      const el = page.getByRole('button', { name: label }).first();
      if (!(await el.isVisible({ timeout: 500 }).catch(() => false))) continue;
      const before = page.url();
      await el.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(600);
      const opened = await modalOpen(page);
      const s = auditor.snapshot();
      const action: any = { label, opened, navigated: page.url() !== before };
      const serverErr = s.apiErrors.filter((e) => e.status >= 500);
      if (s.pageErrors.length) { action.pageError = s.pageErrors[0]; f.flags.push(`OPEN_PAGEERROR[${label}]: ${s.pageErrors[0].slice(0, 60)}`); }
      if (serverErr.length) { action.api5xx = serverErr.map((e) => e.status + ' ' + e.url); f.flags.push(`OPEN_5XX[${label}]: ${serverErr[0].status} ${serverErr[0].url}`); }

      // ---- Invalid submit probe inside an opened modal ----
      if (opened) {
        const submit = page.getByRole('button', { name: SUBMIT }).last();
        const hasReq = await page.locator('[required], [aria-required="true"]').first().isVisible({ timeout: 300 }).catch(() => false);
        if (hasReq && (await submit.isVisible({ timeout: 300 }).catch(() => false)) && (await submit.isEnabled().catch(() => false))) {
          auditor.reset();
          const urlBefore = page.url();
          await submit.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(500);
          const s2 = auditor.snapshot();
          const invalidShown = await page.locator('[aria-invalid="true"], .text-red-500, [class*="error" i]').first().isVisible({ timeout: 300 }).catch(() => false);
          const stillOpen = await modalOpen(page);
          if (s2.pageErrors.length) f.flags.push(`INVALID_SUBMIT_PAGEERROR[${label}]: ${s2.pageErrors[0].slice(0, 50)}`);
          else if (s2.apiErrors.some((e) => e.status >= 500)) f.flags.push(`INVALID_SUBMIT_5XX[${label}]`);
          else if (!invalidShown && !stillOpen && page.url() === urlBefore) f.flags.push(`INVALID_SUBMIT_NO_VALIDATION[${label}] (empty form accepted?)`);
          action.invalidSubmit = { invalidShown, stillOpen };
        }
      }

      f.actions.push(action);
      await dismissModal(page);
      // If the opener navigated away, return to the route for the next probe.
      if (page.url() !== before && !/\/auth\//.test(page.url())) {
        await page.goto(route.path, { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(400);
      }
    }

    findings.push(f);
  }

  auditor.detach();
  fs.writeFileSync(path.join(__dirname, `../results-exercise-${persona}.json`), JSON.stringify({ persona, findings }, null, 2));

  const flagged = findings.filter((f) => f.flags.length);
  console.log(`\n=== EXERCISE (${persona}) ===`);
  for (const f of flagged) {
    console.log(`⚠️  ${f.name.padEnd(22)} ${String(f.path).slice(0, 28).padEnd(28)} ${f.flags.length} flags`);
    for (const flag of f.flags.slice(0, 5)) console.log(`      🚩 ${flag}`);
  }
  console.log(`\n${flagged.length}/${findings.length} routes flagged. Full: results-exercise-${persona}.json`);
});
