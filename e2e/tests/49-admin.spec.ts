import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { PageAuditor } from './lib/audit';
import { inventory, safeClickByLabel, dismissModal } from './lib/crawl';

/**
 * 49 — Super-admin surface audit (author-only; do NOT run as part of authoring).
 *
 * The test account is SUPERADMIN. There is no top-level /admin landing page — the real
 * super-admin-gated pages live under explicit routes (source: components/admin/*):
 *   /admin/ai        — ai-settings.component.tsx     (25+ AI providers, governance, spend, audit)
 *   /admin/channels  — channel-config.component.tsx  (28+ platform OAuth configs)
 *   /admin/errors    — admin-errors.component.tsx     (error log + filters + resolve/retry)
 *   /admin/stats     — admin-stats.component.tsx      (platform KPIs + charts)
 *   /admin/dashboard — links to the above
 *
 * Single test, robust + non-fatal: every probe is wrapped in try/catch and the test ALWAYS
 * PASSES while recording findings. For a SUPERADMIN, a redirect to /auth means the super-admin
 * gate failed = BUG. We also flag near-empty pages, zero actionable buttons, and admin API
 * 4xx/5xx. 429 is recorded as throttle (run is contaminated).
 *
 * Output: e2e/results-admin.json + console summary. We never save/change any admin config.
 */

const ROUTES = ['/admin/ai', '/admin/channels', '/admin/errors', '/admin/stats', '/admin/dashboard'] as const;
const slug = (s: string) => s.replace(/^\//, '').replace(/\//g, '-');

const settle = async (page: any) => {
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1200);
};

const mainText = async (page: any): Promise<string> => {
  try {
    return (await page.locator('main, [role="main"], body').first().innerText()).replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
};

// Is a control matching the given accessible-name regex present? (button OR text fallback)
const hasControl = async (page: any, rx: RegExp): Promise<boolean> => {
  try {
    if ((await page.getByRole('button', { name: rx }).count()) > 0) return true;
  } catch {
    /* ignore */
  }
  try {
    if ((await page.getByRole('link', { name: rx }).count()) > 0) return true;
  } catch {
    /* ignore */
  }
  try {
    if ((await page.getByRole('tab', { name: rx }).count()) > 0) return true;
  } catch {
    /* ignore */
  }
  try {
    if ((await page.getByText(rx).count()) > 0) return true;
  } catch {
    /* ignore */
  }
  return false;
};

// Heuristic count of "rows/cards" — number of distinct visible provider/channel names from a list.
const itemCountHeuristic = async (page: any): Promise<number> => {
  let n = 0;
  for (const sel of ['[role="row"]', 'li', '[class*="card" i]', '[class*="provider" i]', '[class*="channel" i]']) {
    try {
      const c = await page.locator(sel).count();
      if (c > n) n = c;
    } catch {
      /* ignore */
    }
  }
  return n;
};

// v3.6.0: Admin pages deleted — skipped to preserve test logic for future reference.
test.skip('super-admin surface audit', async ({ page }) => {
  test.setTimeout(240_000);
  const auditor = new PageAuditor(page).attach();

  const findings: any = {
    account: 'SUPERADMIN',
    routes: [],
    aiDeep: {},
    channelsDeep: {},
    errorsDeep: {},
    statsDeep: {},
    gaps: [],
    apiErrors: [],
    consoleErrors: [],
    throttled: false,
  };

  // ============ 1. Walk all five admin routes (baseline per-route record) ============
  for (const route of ROUTES) {
    const rec: any = {
      route,
      httpStatus: 0,
      finalUrl: '',
      redirectedToAuth: false,
      textLen: 0,
      visibleButtons: [],
      inputs: 0,
      apiErrors: [],
      consoleErrors: [],
      flags: [] as string[],
    };

    try {
      auditor.reset();
      const resp = await page.goto(route, { timeout: 25000 }).catch((e: any) => {
        rec.flags.push('goto-error: ' + String(e?.message || e).slice(0, 60));
        return null;
      });
      rec.httpStatus = resp?.status() ?? 0;
      await settle(page);

      rec.finalUrl = page.url();
      rec.redirectedToAuth = /\/auth(\/|$)/.test(page.url());

      const text = await mainText(page);
      rec.textLen = text.length;

      // Actionable inventory (ARIA-role based, never stale).
      let items: any[] = [];
      try {
        items = await inventory(page);
      } catch {
        items = [];
      }
      const visBtns = items.filter((i) => i.visible && i.role === 'button' && i.label);
      rec.visibleButtons = visBtns.slice(0, 15).map((i) => i.label);
      rec.inputs = items.filter((i) => i.visible && (i.role === 'textbox' || i.role === 'combobox')).length;

      // Snapshot this route's traffic/errors.
      const snap = auditor.snapshot();
      const adminErrs = snap.apiErrors.filter((c) => c.status !== 429);
      rec.apiErrors = adminErrs.map((c) => ({ url: c.url, status: c.status }));
      rec.consoleErrors = snap.consoleErrors.slice(0, 15);

      // ---- FLAG logic ----
      if (rec.redirectedToAuth) rec.flags.push('SUPERADMIN-GATE-FAILED (redirected to auth)');
      if (rec.textLen < 40) rec.flags.push('near-empty (<40 chars)');
      if (visBtns.length === 0) rec.flags.push('zero-actionable-buttons');
      for (const e of adminErrs) {
        if (e.url.includes('/api/admin/') && (e.status >= 400)) rec.flags.push(`admin-api-${e.status} ${e.url}`);
      }
      if (snap.apiErrors.some((c) => c.status === 429)) {
        rec.flags.push('THROTTLED-429');
        findings.throttled = true;
      }

      await page.screenshot({ path: `admin-${slug(route)}.png` }).catch(() => {});
    } catch (e: any) {
      rec.flags.push('exception: ' + String(e?.message || e).slice(0, 80));
    }

    if (rec.flags.length) findings.gaps.push(`${route}: ${rec.flags.join(' ; ')}`);
    findings.routes.push(rec);
  }

  // ============ 2. /admin/ai DEEP ============
  const ai: any = {
    reached: false,
    providerCount: 0,
    keyControlsPresent: {} as Record<string, boolean>,
    configureForm: { attempted: false, opened: false, hasApiKeyInput: false, inputCount: 0, note: '' },
    flags: [] as string[],
  };
  try {
    auditor.reset();
    const resp = await page.goto('/admin/ai', { timeout: 25000 }).catch(() => null);
    await settle(page);
    ai.reached = !/\/auth(\/|$)/.test(page.url()) && (resp?.status() ?? 0) < 400;

    if (ai.reached) {
      ai.providerCount = await itemCountHeuristic(page);

      // Presence of key controls (per spec).
      ai.keyControlsPresent = {
        configureOrEdit: await hasControl(page, /configure|edit/i),
        testConnection: await hasControl(page, /test|connection/i),
        setActive: await hasControl(page, /set active|activate/i),
        governance: await hasControl(page, /governance|budget|guardrail/i),
        spend: await hasControl(page, /spend|cost|usage/i),
        audit: await hasControl(page, /audit|log/i),
      };
      for (const [k, v] of Object.entries(ai.keyControlsPresent)) {
        if (!v) ai.flags.push(`missing-control: ${k}`);
      }

      // Open a Configure/Edit form and check for an API-key textbox (presence only; do NOT save).
      ai.configureForm.attempted = true;
      let clicked = await safeClickByLabel(page, /configure/i, { role: 'button' });
      if (!clicked.clicked) clicked = await safeClickByLabel(page, /edit/i, { role: 'button' });
      ai.configureForm.note = clicked.note;
      if (clicked.clicked) {
        await page.waitForTimeout(1200);
        try {
          ai.configureForm.inputCount = await page.getByRole('textbox').count();
        } catch {
          ai.configureForm.inputCount = 0;
        }
        // API-key textbox heuristic: a textbox labelled/placeheld key/secret/token.
        let keyBox = false;
        for (const rx of [/api[- ]?key/i, /secret/i, /token/i]) {
          try {
            if ((await page.getByRole('textbox', { name: rx }).count()) > 0) { keyBox = true; break; }
          } catch {
            /* ignore */
          }
          try {
            if ((await page.getByPlaceholder(rx).count()) > 0) { keyBox = true; break; }
          } catch {
            /* ignore */
          }
        }
        ai.configureForm.hasApiKeyInput = keyBox;
        ai.configureForm.opened = ai.configureForm.inputCount > 0;
        if (!ai.configureForm.opened) ai.flags.push('configure-form-did-not-open');
        else if (!keyBox) ai.flags.push('configure-form-missing-api-key-input');
        await dismissModal(page);
      } else {
        ai.flags.push('configure-button-not-clickable');
      }
    } else {
      ai.flags.push('ai-page-not-reachable');
    }

    const snap = auditor.snapshot();
    ai.apiErrors = snap.apiErrors.filter((c) => c.status !== 429).map((c) => ({ url: c.url, status: c.status }));
    if (snap.apiErrors.some((c) => c.status === 429)) { ai.flags.push('THROTTLED-429'); findings.throttled = true; }
  } catch (e: any) {
    ai.flags.push('exception: ' + String(e?.message || e).slice(0, 80));
  }
  findings.aiDeep = ai;
  if (ai.flags.length) findings.gaps.push(`/admin/ai DEEP: ${ai.flags.join(' ; ')}`);

  // ============ 3. /admin/channels DEEP ============
  const ch: any = {
    reached: false,
    channelCount: 0,
    editForm: { attempted: false, opened: false, hasClientIdSecret: false, inputCount: 0, note: '' },
    flags: [] as string[],
  };
  try {
    auditor.reset();
    const resp = await page.goto('/admin/channels', { timeout: 25000 }).catch(() => null);
    await settle(page);
    ch.reached = !/\/auth(\/|$)/.test(page.url()) && (resp?.status() ?? 0) < 400;

    if (ch.reached) {
      ch.channelCount = await itemCountHeuristic(page);

      ch.editForm.attempted = true;
      let clicked = await safeClickByLabel(page, /edit/i, { role: 'button' });
      if (!clicked.clicked) clicked = await safeClickByLabel(page, /configure/i, { role: 'button' });
      ch.editForm.note = clicked.note;
      if (clicked.clicked) {
        await page.waitForTimeout(1200);
        try {
          ch.editForm.inputCount = await page.getByRole('textbox').count();
        } catch {
          ch.editForm.inputCount = 0;
        }
        let idBox = false;
        let secretBox = false;
        for (const rx of [/client[- ]?id/i]) {
          try { if ((await page.getByRole('textbox', { name: rx }).count()) > 0) idBox = true; } catch { /* ignore */ }
          try { if ((await page.getByPlaceholder(rx).count()) > 0) idBox = true; } catch { /* ignore */ }
        }
        for (const rx of [/client[- ]?secret/i, /secret/i]) {
          try { if ((await page.getByRole('textbox', { name: rx }).count()) > 0) secretBox = true; } catch { /* ignore */ }
          try { if ((await page.getByPlaceholder(rx).count()) > 0) secretBox = true; } catch { /* ignore */ }
        }
        ch.editForm.hasClientIdSecret = idBox && secretBox;
        ch.editForm.opened = ch.editForm.inputCount > 0;
        if (!ch.editForm.opened) ch.flags.push('edit-form-did-not-open');
        else if (!ch.editForm.hasClientIdSecret) ch.flags.push('edit-form-missing-client-id-or-secret');
        await dismissModal(page);
      } else {
        ch.flags.push('edit-button-not-clickable');
      }
    } else {
      ch.flags.push('channels-page-not-reachable');
    }

    const snap = auditor.snapshot();
    ch.apiErrors = snap.apiErrors.filter((c) => c.status !== 429).map((c) => ({ url: c.url, status: c.status }));
    if (snap.apiErrors.some((c) => c.status === 429)) { ch.flags.push('THROTTLED-429'); findings.throttled = true; }
  } catch (e: any) {
    ch.flags.push('exception: ' + String(e?.message || e).slice(0, 80));
  }
  findings.channelsDeep = ch;
  if (ch.flags.length) findings.gaps.push(`/admin/channels DEEP: ${ch.flags.join(' ; ')}`);

  // ============ 4. /admin/errors DEEP ============
  const er: any = {
    reached: false,
    hasTableOrList: false,
    hasEmptyState: false,
    hasFilters: false,
    hasResolveOrRetry: false,
    flags: [] as string[],
  };
  try {
    auditor.reset();
    const resp = await page.goto('/admin/errors', { timeout: 25000 }).catch(() => null);
    await settle(page);
    er.reached = !/\/auth(\/|$)/.test(page.url()) && (resp?.status() ?? 0) < 400;

    if (er.reached) {
      try { er.hasTableOrList = (await page.getByRole('table').count()) > 0 || (await page.getByRole('list').count()) > 0; } catch { /* ignore */ }
      try { er.hasEmptyState = (await page.getByText(/no errors|no error|nothing|empty|all clear/i).count()) > 0; } catch { /* ignore */ }
      er.hasFilters = await hasControl(page, /filter|status|resolved|severity|all/i);
      er.hasResolveOrRetry = await hasControl(page, /resolve|retry|mark/i);

      if (!er.hasTableOrList && !er.hasEmptyState) er.flags.push('no-table-and-no-empty-state');
      if (!er.hasFilters) er.flags.push('missing-filter-controls');
      if (!er.hasResolveOrRetry) er.flags.push('missing-resolve-retry-controls');
    } else {
      er.flags.push('errors-page-not-reachable');
    }

    const snap = auditor.snapshot();
    er.apiErrors = snap.apiErrors.filter((c) => c.status !== 429).map((c) => ({ url: c.url, status: c.status }));
    if (snap.apiErrors.some((c) => c.status === 429)) { er.flags.push('THROTTLED-429'); findings.throttled = true; }
  } catch (e: any) {
    er.flags.push('exception: ' + String(e?.message || e).slice(0, 80));
  }
  findings.errorsDeep = er;
  if (er.flags.length) findings.gaps.push(`/admin/errors DEEP: ${er.flags.join(' ; ')}`);

  // ============ 5. /admin/stats DEEP ============
  const st: any = { reached: false, tables: 0, charts: 0, hasNumbers: false, rendered: false, flags: [] as string[] };
  try {
    auditor.reset();
    const resp = await page.goto('/admin/stats', { timeout: 25000 }).catch(() => null);
    await settle(page);
    st.reached = !/\/auth(\/|$)/.test(page.url()) && (resp?.status() ?? 0) < 400;

    if (st.reached) {
      try { st.tables = await page.getByRole('table').count(); } catch { /* ignore */ }
      try { st.charts = await page.locator('svg, canvas').count(); } catch { /* ignore */ } // CSS string only
      try { st.hasNumbers = /\d/.test(await mainText(page)); } catch { /* ignore */ }
      st.rendered = st.tables > 0 || st.charts > 0 || st.hasNumbers;
      if (!st.rendered) st.flags.push('stats-blank (no table/chart/numbers)');
    } else {
      st.flags.push('stats-page-not-reachable');
    }

    const snap = auditor.snapshot();
    st.apiErrors = snap.apiErrors.filter((c) => c.status !== 429).map((c) => ({ url: c.url, status: c.status }));
    if (snap.apiErrors.some((c) => c.status === 429)) { st.flags.push('THROTTLED-429'); findings.throttled = true; }
  } catch (e: any) {
    st.flags.push('exception: ' + String(e?.message || e).slice(0, 80));
  }
  findings.statsDeep = st;
  if (st.flags.length) findings.gaps.push(`/admin/stats DEEP: ${st.flags.join(' ; ')}`);

  // ============ 6. Summarize, write JSON + console ============
  const snap = auditor.snapshot();
  auditor.detach();

  if (auditor.hadThrottle()) findings.throttled = true;

  findings.apiErrors = snap.apiErrors
    .filter((c) => c.status !== 429)
    .map((c) => ({ url: c.url, status: c.status }));
  findings.consoleErrors = snap.consoleErrors.slice(0, 30);
  findings.pageErrors = snap.pageErrors.slice(0, 30);

  // Per-route compact summary { route, ok, flags, keyControlsPresent }.
  const keyControlsByRoute: Record<string, any> = {
    '/admin/ai': findings.aiDeep.keyControlsPresent,
    '/admin/channels': { editForm: findings.channelsDeep.editForm?.hasClientIdSecret },
    '/admin/errors': {
      tableOrList: findings.errorsDeep.hasTableOrList,
      emptyState: findings.errorsDeep.hasEmptyState,
      filters: findings.errorsDeep.hasFilters,
      resolveRetry: findings.errorsDeep.hasResolveOrRetry,
    },
    '/admin/stats': { tables: findings.statsDeep.tables, charts: findings.statsDeep.charts, rendered: findings.statsDeep.rendered },
    '/admin/dashboard': {},
  };
  findings.perRoute = findings.routes.map((r: any) => ({
    route: r.route,
    ok: r.flags.length === 0,
    flags: r.flags,
    keyControlsPresent: keyControlsByRoute[r.route] ?? {},
  }));

  findings.summary = {
    routesOk: findings.perRoute.filter((r: any) => r.ok).length + '/' + findings.perRoute.length,
    routesWithGateFailure: findings.routes.filter((r: any) => r.redirectedToAuth).map((r: any) => r.route),
    aiProviderCount: findings.aiDeep.providerCount,
    aiConfigureFormOpened: findings.aiDeep.configureForm?.opened,
    aiHasApiKeyInput: findings.aiDeep.configureForm?.hasApiKeyInput,
    channelCount: findings.channelsDeep.channelCount,
    channelEditFormOpened: findings.channelsDeep.editForm?.opened,
    channelHasClientIdSecret: findings.channelsDeep.editForm?.hasClientIdSecret,
    errorsRendered: findings.errorsDeep.hasTableOrList || findings.errorsDeep.hasEmptyState,
    statsRendered: findings.statsDeep.rendered,
    apiErrorCount: findings.apiErrors.length,
    consoleErrorCount: findings.consoleErrors.length,
    throttled: findings.throttled,
    totalGaps: findings.gaps.length,
  };

  try {
    fs.writeFileSync(path.join(__dirname, '../results-admin.json'), JSON.stringify(findings, null, 2));
  } catch (e: any) {
    console.log('Could not write results-admin.json:', String(e?.message || e));
  }

  console.log('\n===== SUPER-ADMIN SURFACE AUDIT =====');
  if (findings.throttled) console.log('THROTTLE (429) HIT — findings may be unreliable; re-run after raising API_LIMIT.\n');
  for (const r of findings.perRoute) {
    const fl = r.flags.length ? ` FLAGS: ${r.flags.join(' ; ')}` : '';
    console.log(`  [${r.ok ? 'OK' : 'X'}] ${r.route}${fl}`);
  }
  console.log('\n-- /admin/ai DEEP --');
  console.log(`  providers~${findings.aiDeep.providerCount} | controls: ${JSON.stringify(findings.aiDeep.keyControlsPresent)}`);
  console.log(`  configure form opened=${findings.aiDeep.configureForm?.opened} apiKeyInput=${findings.aiDeep.configureForm?.hasApiKeyInput} (${findings.aiDeep.configureForm?.note})`);
  console.log('-- /admin/channels DEEP --');
  console.log(`  channels~${findings.channelsDeep.channelCount} | editForm opened=${findings.channelsDeep.editForm?.opened} clientId+secret=${findings.channelsDeep.editForm?.hasClientIdSecret} (${findings.channelsDeep.editForm?.note})`);
  console.log('-- /admin/errors DEEP --');
  console.log(`  tableOrList=${findings.errorsDeep.hasTableOrList} emptyState=${findings.errorsDeep.hasEmptyState} filters=${findings.errorsDeep.hasFilters} resolve/retry=${findings.errorsDeep.hasResolveOrRetry}`);
  console.log('-- /admin/stats DEEP --');
  console.log(`  tables=${findings.statsDeep.tables} charts=${findings.statsDeep.charts} numbers=${findings.statsDeep.hasNumbers} rendered=${findings.statsDeep.rendered}`);
  console.log(`\nAPI errors: ${findings.apiErrors.length} | Console errors: ${findings.consoleErrors.length} | Throttled(429): ${findings.throttled}`);
  console.log(`Gaps (${findings.gaps.length}): ${findings.gaps.length ? findings.gaps.join('  ||  ') : 'none'}`);
  console.log('Full data: e2e/results-admin.json');
});
