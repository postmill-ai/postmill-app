import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ROUTES, BASE } from './lib/routes';

const PERSONA = () => test.info().project.name || 'admin';
import { PageAuditor } from './lib/audit';
import { inventory, actionableSummary, brokenImages, mainTextLength } from './lib/crawl';

/**
 * Visit EVERY route, auto-discover every actionable element, and diagnose problems:
 * auth redirects, 4xx/5xx API calls, console/page errors, broken images, near-empty pages,
 * pages with too few actionables, and dead (disabled) buttons. Selector-free discovery means
 * no false "not found" from guessed locators.
 *
 * Output: results-crawl.json (machine) + console summary (human). Findings are flagged, not
 * asserted-fatal, so one run catalogs the whole app; a 429 throttle marks the run contaminated.
 */
test('crawl every route and diagnose', async ({ page }) => {
  // Local webpack compiles each route on first visit (~3-8s each) → the full 109-route
  // sweep needs a generous budget on the cold run; subsequent runs reuse compiled routes.
  test.setTimeout(45 * 60_000);
  const auditor = new PageAuditor(page).attach();
  const findings: any[] = [];
  let throttled = false;

  for (const route of ROUTES) {
    auditor.reset();
    const f: any = { name: route.name, path: route.path, flags: [] };

    let httpStatus = 0;
    try {
      const r = await page.goto(route.path, { timeout: 30000 });
      httpStatus = r?.status() ?? 0;
      await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(1500);
    } catch (e: any) {
      f.flags.push('NAV_ERROR: ' + String(e.message).slice(0, 80));
      findings.push(f);
      continue;
    }

    f.httpStatus = httpStatus;
    f.persona = PERSONA();
    f.finalUrl = page.url().replace(BASE, '');
    f.redirectedToAuth = /\/auth\//.test(page.url()) && !route.publicRoute;

    const [items, textLen, broken] = await Promise.all([
      inventory(page),
      mainTextLength(page),
      brokenImages(page),
    ]);
    const summary = actionableSummary(items);
    f.actionables = summary;
    f.textLen = textLen;
    f.brokenImages = broken;

    const snap = auditor.snapshot();
    f.apiErrors = snap.apiErrors.map((e) => `${e.status} ${e.method} ${e.url}`);
    f.consoleErrors = snap.consoleErrors.slice(0, 8);
    f.pageErrors = snap.pageErrors.slice(0, 5);
    f.failedRequests = snap.failedRequests.slice(0, 5);

    // ---- Diagnostic flags ----
    if (auditor.hadThrottle()) { f.flags.push('THROTTLED_429 (results unreliable)'); throttled = true; }
    // A memberGated route redirecting to auth/dashboard for a non-admin persona is EXPECTED
    // RBAC hiding, not a defect — record it informationally instead of flagging.
    if (f.redirectedToAuth && route.memberGated && PERSONA() !== 'admin') {
      f.rbacHidden = true;
    } else if (f.redirectedToAuth) {
      f.flags.push('REDIRECTED_TO_AUTH');
    }
    if (httpStatus >= 400) f.flags.push(`HTTP_${httpStatus}`);
    if (route.expectsContent && textLen < 40 && !f.redirectedToAuth) f.flags.push(`NEAR_EMPTY (textLen=${textLen})`);
    if (route.minActionables && summary.visible < route.minActionables && !f.redirectedToAuth) {
      f.flags.push(`TOO_FEW_ACTIONABLES (${summary.visible} < ${route.minActionables})`);
    }
    if (broken > 0) f.flags.push(`BROKEN_IMAGES (${broken})`);
    const serverErrors = snap.apiErrors.filter((e) => e.status >= 500);
    if (serverErrors.length) f.flags.push(`API_5XX (${serverErrors.map((e) => e.url).join(',')})`);
    const clientErrors = snap.apiErrors.filter((e) => e.status >= 400 && e.status < 500 && e.status !== 429);
    if (clientErrors.length) f.flags.push(`API_4XX (${clientErrors.map((e) => e.status + ' ' + e.url).join(', ')})`);
    if (snap.pageErrors.length) f.flags.push(`PAGE_ERRORS (${snap.pageErrors.length})`);

    const shotDir = path.join(__dirname, '../crawl-shots', PERSONA());
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, `${route.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`) }).catch(() => {});
    findings.push(f);
  }

  auditor.detach();
  fs.writeFileSync(path.join(__dirname, `../results-crawl-${PERSONA()}.json`), JSON.stringify({ persona: PERSONA(), throttled, findings }, null, 2));

  // Human summary
  console.log('\n================ ROUTE CRAWL DIAGNOSTICS ================');
  if (throttled) console.log('⚠️  THROTTLE (429) HIT — findings are UNRELIABLE; raise API_LIMIT / clear throttle and re-run.\n');
  for (const f of findings) {
    const ok = (f.flags || []).length === 0;
    console.log(`\n${ok ? '✓' : '⚠️'} ${f.name.padEnd(18)} ${String(f.path).padEnd(18)} HTTP=${f.httpStatus ?? '?'} text=${f.textLen ?? '?'} actionables=${f.actionables?.visible ?? '?'}`);
    if (f.actionables) console.log(`    btns=${f.actionables.buttons} links=${f.actionables.links} tabs=${f.actionables.tabs} inputs=${f.actionables.inputs}${f.actionables.disabledButtons.length ? ' disabledBtns=[' + f.actionables.disabledButtons.slice(0,5).join(', ') + ']' : ''}`);
    for (const flag of f.flags || []) console.log(`    🚩 ${flag}`);
    if (f.consoleErrors?.length) console.log(`    console: ${f.consoleErrors.slice(0, 2).join(' | ')}`);
  }
  const flagged = findings.filter((f) => (f.flags || []).length).length;
  console.log(`\n${flagged}/${findings.length} routes flagged. Full data: e2e/results-crawl.json`);
});
