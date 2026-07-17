import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const ROUTES: [string, string][] = [
  ['Calendar', '/launches'], ['Analytics', '/analytics'], ['Media', '/media'],
  ['Campaigns', '/campaigns'], ['Comments', '/comments'], ['Plugs', '/plugs'],
  ['Settings', '/settings'], ['Billing', '/billing'],
  ['Agents', '/agents'],
];

test('render every real page + capture errors', async ({ page }) => {
  const findings: any[] = [];
  for (const [name, route] of ROUTES) {
    const consoleErrors: string[] = [];
    const apiErrors: string[] = [];
    const onC = (m: any) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 130)); };
    const onR = (r: any) => { const u = r.url(); if (u.includes('/api/') && r.status() >= 400) apiErrors.push(`${r.status()} ${u.replace('https://postiz.reaatech.com','').split('?')[0]}`); };
    page.on('console', onC); page.on('response', onR);

    let httpStatus = 0, textLen = 0, toAuth = false;
    try {
      const r = await page.goto(route, { timeout: 25000 });
      httpStatus = r?.status() ?? 0;
      await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(2000);
      textLen = (await page.locator('main, body').first().innerText()).length;
      toAuth = /\/auth\//.test(page.url());
      await page.screenshot({ path: `ui-page-${name.toLowerCase()}.png` });
    } catch (e: any) { apiErrors.push('NAV-ERR ' + String(e.message).slice(0, 60)); }

    page.off('console', onC); page.off('response', onR);
    findings.push({ name, route, httpStatus, textLen, toAuth, apiErrors: [...new Set(apiErrors)], consoleErrors: [...new Set(consoleErrors)] });
  }

  // ---- Interaction: open a post-detail modal by clicking a card (month view) ----
  const postDetail = { attempted: false, opened: false, note: '' };
  try {
    await page.goto('/launches');
    await page.waitForLoadState('networkidle');
    await page.getByText('Month', { exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(3500);
    const card = page.getByText(/Published|Draft|FREE AI/i).first();
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
