import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const ROUTES: [string, string][] = [
  ['Calendar', '/launches'], ['Analytics', '/analytics'], ['Media', '/media'],
  ['Campaigns', '/campaigns'], ['Comments', '/comments'], ['Replies', '/replies'],
  ['Settings', '/settings'], ['Billing', '/billing'],
  ['Agents', '/agents'],
];

test('render every real page + capture errors', async ({ page }) => {
  // 9 routes × (goto + networkidle + settle + screenshot) + the post-detail pass
  // below far exceeds the 30s default — give the crawl room. networkidle expires
  // on most routes (app-wide SWR polling), so keep the per-route settle short.
  test.setTimeout(300_000);
  const t0 = Date.now();
  const findings: any[] = [];
  for (const [name, route] of ROUTES) {
    const consoleErrors: string[] = [];
    const apiErrors: string[] = [];
    const onC = (m: any) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 130)); };
    const onR = (r: any) => { const u = r.url(); if (u.includes('/api/') && r.status() >= 400) apiErrors.push(`${r.status()} ${u.replace('https://app.postmill.ai','').split('?')[0]}`); };
    page.on('console', onC); page.on('response', onR);

    let httpStatus = 0, textLen = 0, toAuth = false;
    try {
      const r = await page.goto(route, { timeout: 25000 });
      httpStatus = r?.status() ?? 0;
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(2000);
      textLen = (await page.locator('main, body').first().innerText()).length;
      toAuth = /\/auth\//.test(page.url());
      await page.screenshot({ path: `ui-page-${name.toLowerCase()}.png` });
    } catch (e: any) { apiErrors.push('NAV-ERR ' + String(e.message).slice(0, 60)); }

    page.off('console', onC); page.off('response', onR);
    findings.push({ name, route, httpStatus, textLen, toAuth, apiErrors: [...new Set(apiErrors)], consoleErrors: [...new Set(consoleErrors)] });
  }

  // ---- Interaction: open a post-detail modal by clicking a card (month view) ----
  console.log(`[23] route crawl done in ${Date.now() - t0}ms`);
  const postDetail = { attempted: false, opened: false, note: '' };
  const pdStart = Date.now();
  const pdLog = (m: string) => console.log(`[post-detail +${Date.now() - pdStart}ms] ${m}`);
  try {
    await page.goto('/launches', { timeout: 25000 });
    pdLog('navigated');
    // networkidle may never settle here (calendar long-polls/SWR) — bound it.
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    pdLog('idle');
    await page.getByText('Month', { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
    pdLog('month clicked');
    await page.waitForTimeout(3500);
    const card = page.getByText(/Published|Draft|FREE AI/i).first();
    pdLog('card probe');
    if (await card.count()) {
      postDetail.attempted = true;
      await card.click({ timeout: 5000 }).catch(e => { postDetail.note = e.message.slice(0, 80); });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: 'ui-post-detail.png' });
      // a modal/preview should appear
      const modal = await page.locator('[class*="popup"], [class*="modal"], [role="dialog"]').count();
      postDetail.opened = modal > 0;
    }
  } catch (e: any) { postDetail.note = String(e.message).slice(0, 80); }

  fs.writeFileSync(path.join(__dirname, '../results-pages.json'), JSON.stringify({ findings, postDetail }, null, 1));
  console.log('\n===== PAGE RENDER + ERRORS =====');
  for (const f of findings) {
    const flag = f.httpStatus >= 400 || f.toAuth || f.apiErrors.length ? '⚠️' : '✓';
    console.log(`${flag} ${f.name.padEnd(12)} ${f.route.padEnd(14)} HTTP=${f.httpStatus} text=${f.textLen}${f.toAuth ? ' →AUTH' : ''}${f.apiErrors.length ? '  API:' + f.apiErrors.join(',') : ''}`);
  }
  console.log('\n===== INTERACTION: post-detail modal =====');
  console.log('  attempted:', postDetail.attempted, '| opened:', postDetail.opened, postDetail.note);
});
