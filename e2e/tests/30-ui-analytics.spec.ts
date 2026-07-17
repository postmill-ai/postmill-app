import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Comprehensive analytics page testing:
 * - Page loads and renders
 * - All tabs work (overview, posts, best-time, recommendations)
 * - Date range pickers work
 * - Charts/data render or show errors
 * - API calls are made with correct params
 */
test('analytics page full coverage', async ({ page }) => {
  const findings: any = {
    pageLoad: {},
    tabs: {},
    dateRange: {},
    apiCalls: [],
    consoleErrors: [],
    charts: {},
  };

  const apiErrors: string[] = [];
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/analytics/v2/')) {
      const endpoint = u.replace('https://postiz.reaatech.com/api/analytics/v2/', '').split('?')[0];
      findings.apiCalls.push({
        endpoint,
        status: r.status(),
        method: r.request().method(),
        query: new URL(u).searchParams.toString().slice(0, 200),
      });
      if (r.status() >= 400) {
        apiErrors.push(`${r.status()} ${endpoint}`);
      }
    }
  });

  page.on('console', (m) => {
    if (m.type() === 'error') {
      findings.consoleErrors.push(m.text().slice(0, 150));
    }
  });

  // 1. Load analytics page (/analytics client-redirects to /analytics/v2; go direct to avoid redirect flake)
  let navStatus = 0;
  try {
    const r = await page.goto('/analytics/v2', { timeout: 25000 });
    navStatus = r?.status() ?? 0;
    findings.pageLoad.status = navStatus;
    findings.pageLoad.url = page.url();

    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const pageText = await page.locator('main, body').first().innerText();
    findings.pageLoad.hasContent = pageText.length > 100;
    findings.pageLoad.textLen = pageText.length;

    // Check if redirected to auth
    findings.pageLoad.redirectedToAuth = /\/auth\//.test(page.url());

    await page.screenshot({ path: 'ui-analytics-load.png' });
  } catch (e: any) {
    findings.pageLoad.error = e.message.slice(0, 100);
  }

  if (findings.pageLoad.redirectedToAuth || navStatus >= 400) {
    fs.writeFileSync(
      path.join(__dirname, '../results-analytics.json'),
      JSON.stringify(findings, null, 2)
    );
    console.log('Analytics page NOT accessible (auth or error):', findings.pageLoad);
    return;
  }

  // 2. Test each tab. Real labels from analytics.dashboard.tsx tabLabels:
  //    Overview | Channels | Posts | Best time | Recommendations | Watchlist
  const tabs = ['Overview', 'Channels', 'Posts', 'Best time', 'Recommendations', 'Watchlist'];
  for (const tabName of tabs) {
    findings.tabs[tabName] = {
      clicked: false,
      visible: false,
      chartCount: 0,
      apiErrors: [],
      error: null,
    };

    try {
      const tabBtn = page.getByRole('button', { name: new RegExp(tabName, 'i') });
      if (await tabBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        findings.tabs[tabName].visible = true;
        await tabBtn.click();
        findings.tabs[tabName].clicked = true;
        await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(1500);

        // Look for chart containers, divs with data-viz class, canvas/svg elements
        const chartCount = await page.locator(
          '[class*="chart"], [class*="graph"], canvas, svg:not([role="img"])'
        ).count();
        findings.tabs[tabName].chartCount = chartCount;

        // Take screenshot
        await page.screenshot({ path: `ui-analytics-tab-${tabName.toLowerCase().replace(/ /g, '-')}.png` });
      }
    } catch (e: any) {
      findings.tabs[tabName].error = e.message.slice(0, 100);
    }

    // Collect any 400+ API errors from this tab
    findings.tabs[tabName].apiErrors = apiErrors.filter((e) => !findings.tabs[tabName].apiErrors.includes(e));
  }

  // 3. Test date range picker if available
  try {
    const dateInputs = await page.locator('input[type="date"], [placeholder*="date" i]').count();
    findings.dateRange.dateInputsFound = dateInputs;

    if (dateInputs > 0) {
      const firstDateInput = page.locator('input[type="date"], [placeholder*="date" i]').first();
      if (await firstDateInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Try to set a date
        await firstDateInput.click();
        await page.waitForTimeout(500);

        // If a date picker modal appears, close it
        const closeBtn = page.locator('[aria-label*="close"], button:text("Done"), button:text("OK")').first();
        if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await closeBtn.click();
        }

        await page.waitForTimeout(800);
        findings.dateRange.interacted = true;
      }
    }
  } catch (e: any) {
    findings.dateRange.error = e.message.slice(0, 100);
  }

  // 4. Final screenshot and summary
  await page.screenshot({ path: 'ui-analytics-final.png' });

  findings.summary = {
    pageLoaded: findings.pageLoad.status === 200,
    hasContent: findings.pageLoad.hasContent,
    allTabsAccessible: tabs.every((t) => findings.tabs[t].visible),
    someChartsRendered: Object.values(findings.tabs).some((t: any) => t.chartCount > 0),
    apiErrorsFound: apiErrors.length > 0,
    consoleErrorsFound: findings.consoleErrors.length > 0,
  };

  fs.writeFileSync(
    path.join(__dirname, '../results-analytics.json'),
    JSON.stringify(findings, null, 2)
  );

  console.log('\n===== ANALYTICS PAGE TEST =====');
  console.log(`Page load: HTTP ${findings.pageLoad.status} | ${findings.pageLoad.hasContent ? '✓ content' : '✗ no content'}`);
  console.log(`Tabs accessible: ${tabs.map((t) => (findings.tabs[t].visible ? '✓' : '✗') + ' ' + t).join(' | ')}`);
  console.log(
    `Charts rendered: ${tabs.map((t) => `${findings.tabs[t].chartCount}x ${t}`).join(' | ')}`
  );
  console.log(`API errors: ${apiErrors.length > 0 ? apiErrors.join(', ') : 'none'}`);
  console.log(`Console errors: ${findings.consoleErrors.length}`);
});
