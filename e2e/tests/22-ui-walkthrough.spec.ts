import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Click through the real left-nav like a user; on each page check it renders content
// and capture console errors + failing API calls. Then exercise a couple of interactions.
const NAV = ['Calendar', 'Agent', 'Comments', 'Analytics', 'Media', 'Plugs', 'Campaigns', 'AI Settings', 'Channels', 'Errors', 'Billing'];

test('navigate the app via sidebar clicks', async ({ page }) => {
  const findings: any[] = [];

  await page.goto('/launches');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  for (const label of NAV) {
    const consoleErrors: string[] = [];
    const apiErrors: string[] = [];
    const onC = (m: any) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 140)); };
    const onR = (r: any) => { const u = r.url(); if (u.includes('/api/') && r.status() >= 400) apiErrors.push(`${r.status()} ${u.replace('https://postiz.reaatech.com','').split('?')[0]}`); };
    page.on('console', onC); page.on('response', onR);

    let clicked = false, urlAfter = '', visibleText = 0;
    try {
      const link = page.getByText(label, { exact: true }).first();
      if (await link.count() && await link.isVisible().catch(() => false)) {
        await link.click({ timeout: 5000 });
        clicked = true;
        await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(2000);
        urlAfter = page.url().replace('https://postiz.reaatech.com', '');
        visibleText = (await page.locator('body').innerText()).length;
        await page.screenshot({ path: `ui-nav-${label.replace(/\s+/g, '-').toLowerCase()}.png` });
      }
    } catch (e: any) { apiErrors.push('CLICK-ERR ' + String(e.message).slice(0, 70)); }

    page.off('console', onC); page.off('response', onR);
    findings.push({ label, clicked, urlAfter, textLen: visibleText, apiErrors: [...new Set(apiErrors)], consoleErrors: [...new Set(consoleErrors)] });
  }

  fs.writeFileSync(path.join(__dirname, '../results-walkthrough.json'), JSON.stringify(findings, null, 1));
  console.log('\n===== SIDEBAR WALKTHROUGH =====');
  for (const f of findings) {
    const flag = !f.clicked ? '✗ not-found' : (f.apiErrors.length || f.consoleErrors.length ? '⚠️' : '✓');
    console.log(`\n${flag} ${f.label} -> ${f.urlAfter} (textLen=${f.textLen})`);
    if (f.apiErrors.length) console.log('   API errors:', f.apiErrors.join(' | '));
    if (f.consoleErrors.length) console.log('   console:', f.consoleErrors.slice(0, 3).join(' | '));
  }
});
