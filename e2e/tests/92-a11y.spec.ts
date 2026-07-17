import { test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import * as fs from 'fs';
import * as path from 'path';
import { ROUTES } from './lib/routes';

/**
 * Runtime accessibility scan (net-new — the repo only had static eslint-plugin-jsx-a11y).
 * Runs axe-core per route per persona and records WCAG A/AA violations. Findings are
 * recorded, not asserted-fatal, so one run catalogs a11y debt across the whole app.
 * Output: results-a11y-<persona>.json.
 */
const PERSONA = () => test.info().project.name || 'admin';

// Theme to scan: `E2E_THEME=light` sets the `mode` cookie so axe runs against the light palette
// (surfaces light-only contrast issues). Defaults to the app default (dark).
const THEME = process.env.E2E_THEME === 'light' ? 'light' : 'dark';

test('axe a11y scan every route', async ({ page, context }) => {
  test.setTimeout(300_000);
  const persona = PERSONA();
  const findings: any[] = [];
  if (THEME === 'light') {
    await context.addCookies([{ name: 'mode', value: 'light', domain: 'localhost', path: '/' }]);
  }

  for (const route of ROUTES) {
    const f: any = { name: route.name, path: route.path, persona, area: route.area };
    try {
      const r = await page.goto(route.path, { timeout: 30_000 });
      f.httpStatus = r?.status() ?? 0;
      await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
      await page.waitForTimeout(800);

      // Skip a11y scan on pages that bounced to auth (nothing meaningful to scan).
      if (/\/auth\//.test(page.url()) && !route.publicRoute) {
        f.skipped = 'redirected-to-auth';
        findings.push(f);
        continue;
      }

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      f.violationCount = results.violations.length;
      f.violations = results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
        sample: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      }));
      f.critical = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').length;
    } catch (e: any) {
      f.error = String(e.message).slice(0, 120);
    }
    findings.push(f);
  }

  fs.writeFileSync(
    path.join(__dirname, `../results-a11y-${persona}-${THEME}.json`),
    JSON.stringify({ persona, theme: THEME, findings }, null, 2)
  );

  const withViol = findings.filter((f) => f.violationCount > 0);
  const totalCritical = findings.reduce((s, f) => s + (f.critical || 0), 0);
  console.log(`\n=== A11Y (${persona}) ===`);
  for (const f of withViol) {
    console.log(`⚠️  ${f.name.padEnd(22)} ${String(f.path).slice(0, 30).padEnd(30)} ${f.violationCount} violations (${f.critical || 0} serious/critical)`);
    for (const v of (f.violations || []).slice(0, 4)) console.log(`      ${v.impact}: ${v.id} × ${v.nodes}`);
  }
  console.log(`\n${withViol.length}/${findings.length} routes have a11y violations; ${totalCritical} serious/critical total. Full: results-a11y-${persona}.json`);
});
