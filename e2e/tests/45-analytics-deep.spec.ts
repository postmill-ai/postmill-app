import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { PageAuditor } from './lib/audit';
import { brokenImages, mainTextLength } from './lib/crawl';

/**
 * 45 — Analytics v2 deep audit (author-only; do NOT run as part of authoring).
 *
 * Single test, robust + non-fatal: every probe is wrapped in try/catch and the test
 * always PASSES while recording findings. We exercise the six tabs of the
 * /analytics/v2 dashboard, the date-range control, and per-post drill-down, and we
 * flag tabs that are not clickable, return 4xx/5xx, or render silently blank (no
 * charts/tables AND no empty-state message). 429s are recorded as throttle.
 *
 * UI facts sourced from analytics-v2/analytics.dashboard.tsx + filters/date.range.picker.tsx:
 *  - Route /analytics/v2 (/analytics redirects here — we navigate directly).
 *  - Six <button> tabs: Overview, Channels, Posts, Best time, Recommendations, Watchlist.
 *  - Top controls: DateRangePicker (preset buttons "7 days"/"30 days"/"90 days"/...),
 *    a channel multiselect, and an Export button.
 *  - API: GET /api/analytics/v2/{overview,channels,posts,best-time,recommendations,watchlist}
 *    each taking from/to query params.
 */

const TABS = ['Overview', 'Channels', 'Posts', 'Best time', 'Recommendations', 'Watchlist'] as const;

// Map the visible tab label to the analytics endpoint slug it is expected to hit.
const TAB_ENDPOINT: Record<string, string> = {
  Overview: 'overview',
  Channels: 'channels',
  Posts: 'posts',
  'Best time': 'best-time',
  Recommendations: 'recommendations',
  Watchlist: 'watchlist',
};

const EMPTY_RE = /no data|not enough|no analytics|collected yet|nothing/i;
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');

test('analytics v2 deep audit', async ({ page }) => {
  const auditor = new PageAuditor(page).attach();

  const findings: any = {
    route: '/analytics/v2',
    load: {},
    perTab: [],
    dateRange: { found: false, refetched: false, note: '' },
    postDrill: { attempted: false, opened: false, note: '' },
    dateRangeWorks: false,
    postDrillWorks: false,
    apiErrors: [],
    consoleErrors: [],
    throttled: false,
    flags: [],
  };

  // ---- helper: click a tab via role=button, fall back to getByText ----
  const clickTab = async (name: string): Promise<boolean> => {
    // All six tabs are real <button>s always in the DOM with exact labels. Anchor on
    // the exact name first to avoid ambiguous/loose matches (e.g. "Posts" inside other
    // strings), then fall back to an anchored regex, then to text.
    try {
      const exactBtn = page.getByRole('button', { name, exact: true }).first();
      if (await exactBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await exactBtn.click({ timeout: 5000 });
        return true;
      }
    } catch {
      /* fall through */
    }
    const rx = new RegExp(`^${name}$`, 'i');
    try {
      const btn = page.getByRole('button', { name: rx }).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click({ timeout: 5000 });
        return true;
      }
    } catch {
      /* fall through to text fallback */
    }
    try {
      const txt = page.getByText(rx).first();
      if (await txt.isVisible({ timeout: 2000 }).catch(() => false)) {
        await txt.click({ timeout: 5000 });
        return true;
      }
    } catch {
      /* not clickable */
    }
    return false;
  };

  const settle = async () => {
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1500);
  };

  // ---- count chart/table-like elements + whether any number-bearing text exists ----
  const dataHeuristic = async (): Promise<{ charts: number; hasNumbers: boolean }> => {
    let tables = 0;
    let viz = 0;
    try {
      tables = await page.getByRole('table').count();
    } catch {
      /* ignore */
    }
    try {
      // CSS string only — no regex inside locator(). svg + canvas are visual data marks.
      viz = await page.locator('svg, canvas').count();
    } catch {
      /* ignore */
    }
    let hasNumbers = false;
    try {
      const txt = await page.locator('main, body').first().innerText();
      hasNumbers = /\d/.test(txt);
    } catch {
      /* ignore */
    }
    return { charts: tables + viz, hasNumbers };
  };

  // ===== 1. Load the dashboard directly =====
  try {
    const resp = await page.goto('/analytics/v2', { timeout: 25000 });
    findings.load.status = resp?.status() ?? 0;
    await settle();
    findings.load.url = page.url();
    findings.load.redirectedToAuth = /\/auth(\/|$)/.test(page.url());
    findings.load.textLen = await mainTextLength(page);
    findings.load.brokenImages = await brokenImages(page);
    await page.screenshot({ path: 'analytics-deep-load.png' }).catch(() => {});
  } catch (e: any) {
    findings.load.error = String(e?.message || e).slice(0, 150);
  }

  // If we never reached the dashboard, bail early but still PASS + write results.
  if (findings.load.redirectedToAuth || (findings.load.status ?? 0) >= 400) {
    findings.flags.push('dashboard-not-accessible');
    finish(findings, auditor);
    return;
  }

  // ===== 2. Walk each of the six tabs =====
  for (const name of TABS) {
    const tab: any = {
      name,
      clicked: false,
      apiCalls: [],
      apiStatus: null as number | null,
      charts: 0,
      hasNumbers: false,
      emptyState: false,
      brokenImages: 0,
      flags: [] as string[],
    };

    try {
      auditor.reset(); // isolate this tab's traffic
      tab.clicked = await clickTab(name);
      if (tab.clicked) {
        await settle();
      }

      // analytics API call(s) that fired for this tab
      const snap = auditor.snapshot();
      const analyticsCalls = snap.apiCalls.filter((c) => c.url.includes('/analytics/v2/'));
      tab.apiCalls = analyticsCalls.map((c) => ({ url: c.url, status: c.status, query: c.query }));

      // status for *this* tab's own endpoint (best-effort; else any analytics call)
      const slugEp = TAB_ENDPOINT[name];
      const own = analyticsCalls.find((c) => c.url.includes(`/analytics/v2/${slugEp}`));
      tab.apiStatus = own ? own.status : analyticsCalls.length ? analyticsCalls[0].status : null;

      const heur = await dataHeuristic();
      tab.charts = heur.charts;
      tab.hasNumbers = heur.hasNumbers;

      try {
        tab.emptyState = (await page.getByText(EMPTY_RE).count()) > 0;
      } catch {
        tab.emptyState = false;
      }

      tab.brokenImages = await brokenImages(page);

      await page.screenshot({ path: `analytics-tab-${slug(name)}.png` }).catch(() => {});

      // ---- FLAG logic ----
      if (!tab.clicked) tab.flags.push('not-clickable');
      const badApi = analyticsCalls.find((c) => c.status >= 400);
      if (badApi) tab.flags.push(`api-${badApi.status}`);
      if (tab.charts === 0 && !tab.emptyState && tab.clicked) {
        // silently blank — neither data nor an explanatory empty-state message
        tab.flags.push('silently-blank');
      }
    } catch (e: any) {
      tab.error = String(e?.message || e).slice(0, 150);
      tab.flags.push('exception');
    }

    if (tab.flags.length) findings.flags.push(`${name}: ${tab.flags.join(',')}`);
    findings.perTab.push(tab);
  }

  // ===== 3. Date-range control: pick a preset, verify a refetch =====
  // DateRangePicker renders preset <button>s ("7 days", "30 days", "90 days", ...).
  try {
    // Land on a tab that fetches on load so a date change should refetch.
    await clickTab('Overview');
    await settle();

    auditor.reset();
    let interacted = false;
    // Prefer a preset different from the likely-default; try a few labels.
    for (const label of ['90 days', '7 days', '30 days', '365 days']) {
      try {
        const preset = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
        if (await preset.isVisible({ timeout: 2000 }).catch(() => false)) {
          findings.dateRange.found = true;
          await preset.click({ timeout: 4000 });
          interacted = true;
          findings.dateRange.preset = label;
          break;
        }
      } catch {
        /* try next label */
      }
    }

    if (!interacted) {
      // soft flag — control not found / not interactable
      findings.dateRange.note = 'date-range control not found';
      findings.flags.push('date-range: soft-not-found');
    } else {
      await settle();
      const snap = auditor.snapshot();
      const refetch = snap.apiCalls.filter((c) => c.url.includes('/analytics/v2/'));
      findings.dateRange.refetched = refetch.length > 0;
      findings.dateRange.refetchCalls = refetch.map((c) => ({ url: c.url, status: c.status, query: c.query }));
      findings.dateRangeWorks = refetch.length > 0;
      if (!findings.dateRangeWorks) findings.flags.push('date-range: no-refetch');
    }
  } catch (e: any) {
    findings.dateRange.note = String(e?.message || e).slice(0, 150);
    findings.flags.push('date-range: exception');
  }

  // ===== 4. Per-post drill-down on the Posts tab =====
  try {
    findings.postDrill.attempted = true;
    const onPosts = await clickTab('Posts');
    await settle();

    if (!onPosts) {
      findings.postDrill.note = 'Posts tab not clickable';
    } else {
      auditor.reset();

      // Find clickable post rows: prefer table rows, else generic row role.
      let clickedRow = false;
      let rowCount = 0;
      try {
        const rows = page.getByRole('row');
        rowCount = await rows.count();
        findings.postDrill.rowCount = rowCount;
        // Row 0 is usually the header; click the first data row if present.
        const target = rowCount > 1 ? rows.nth(1) : rows.first();
        if (rowCount > 0 && (await target.isVisible({ timeout: 2000 }).catch(() => false))) {
          await target.click({ timeout: 4000 });
          clickedRow = true;
        }
      } catch {
        /* no rows */
      }

      if (!clickedRow) {
        findings.postDrill.note = rowCount === 0 ? 'no post rows present' : 'row not clickable';
      } else {
        await settle();
        const snap = auditor.snapshot();
        // A drill is a /analytics/v2/post/:id call OR a dialog/detail view opening.
        const drillCall = snap.apiCalls.find(
          (c) => c.url.includes('/analytics/v2/post/') || /post/i.test(c.query || '')
        );
        let dialogOpened = false;
        try {
          dialogOpened = (await page.getByRole('dialog').count()) > 0;
        } catch {
          dialogOpened = false;
        }
        findings.postDrill.opened = !!drillCall || dialogOpened;
        findings.postDrill.drillCall = drillCall
          ? { url: drillCall.url, status: drillCall.status }
          : null;
        findings.postDrill.dialogOpened = dialogOpened;
        findings.postDrillWorks = findings.postDrill.opened;
        await page.screenshot({ path: 'analytics-post-drill.png' }).catch(() => {});
        if (!findings.postDrillWorks) findings.flags.push('post-drill: no-view-opened');
      }
    }
  } catch (e: any) {
    findings.postDrill.note = String(e?.message || e).slice(0, 150);
    findings.flags.push('post-drill: exception');
  }

  finish(findings, auditor);
});

// ===== Summarize: write JSON + console, record api/console errors + throttle =====
function finish(findings: any, auditor: PageAuditor) {
  const snap = auditor.snapshot();
  auditor.detach();

  findings.throttled = auditor.hadThrottle();
  if (findings.throttled) findings.flags.push('THROTTLED-429');

  findings.apiErrors = snap.apiErrors.map((c) => ({ url: c.url, status: c.status }));
  findings.consoleErrors = snap.consoleErrors.slice(0, 25);
  findings.pageErrors = snap.pageErrors.slice(0, 25);
  findings.failedRequests = snap.failedRequests.slice(0, 25);

  findings.summary = {
    tabsClickable: findings.perTab.filter((t: any) => t.clicked).length + '/' + findings.perTab.length,
    tabsFlagged: findings.perTab.filter((t: any) => t.flags?.length).map((t: any) => t.name),
    dateRangeWorks: findings.dateRangeWorks,
    postDrillWorks: findings.postDrillWorks,
    apiErrorCount: findings.apiErrors.length,
    consoleErrorCount: findings.consoleErrors.length,
    throttled: findings.throttled,
    totalFlags: findings.flags.length,
  };

  try {
    fs.writeFileSync(
      path.join(__dirname, '../results-analytics-deep.json'),
      JSON.stringify(findings, null, 2)
    );
  } catch (e: any) {
    console.log('Could not write results-analytics-deep.json:', String(e?.message || e));
  }

  console.log('\n===== ANALYTICS V2 DEEP AUDIT =====');
  console.log(`Load: HTTP ${findings.load.status ?? '?'} | textLen ${findings.load.textLen ?? '?'} | auth-redirect ${!!findings.load.redirectedToAuth}`);
  for (const t of findings.perTab) {
    const fl = t.flags?.length ? ` ⚑ ${t.flags.join(',')}` : '';
    console.log(
      `  [${t.clicked ? '✓' : '✗'}] ${t.name}: api=${t.apiStatus ?? '-'} charts=${t.charts} empty=${t.emptyState}${fl}`
    );
  }
  console.log(`Date range works: ${findings.dateRangeWorks} (${findings.dateRange.preset || findings.dateRange.note || '-'})`);
  console.log(`Post drill works: ${findings.postDrillWorks} (${findings.postDrill.note || 'ok'})`);
  console.log(`API errors: ${findings.apiErrors.length} | Console errors: ${findings.consoleErrors.length} | Throttled(429): ${findings.throttled}`);
  console.log(`Flags (${findings.flags.length}): ${findings.flags.length ? findings.flags.join(' | ') : 'none'}`);
}
