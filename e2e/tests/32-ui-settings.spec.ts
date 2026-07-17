import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Settings pages comprehensive testing:
 * - Account settings
 * - Workspace/team settings
 * - Channel integrations
 * - Billing
 * - AI settings
 * - Notification preferences
 */
test('settings pages full coverage', async ({ page }) => {
  const findings: any = {
    pages: {},
    navigation: [],
    apiErrors: [],
    consoleErrors: [],
  };

  // Real route paths (verified against apps/frontend/src/app). There is NO top-level
  // /channels, /ai-settings, or /admin landing page — admin surfaces live under /admin/*.
  const settingsPages = [
    { label: 'Settings', path: '/settings' },
    { label: 'Billing', path: '/billing' },
  ];

  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/') && r.status() >= 400) {
      findings.apiErrors.push(`${r.status()} ${u.split('?')[0].replace('https://postiz.reaatech.com/api/', '')}`);
    }
  });

  page.on('console', (m) => {
    if (m.type() === 'error') findings.consoleErrors.push(m.text().slice(0, 120));
  });

  for (const page_config of settingsPages) {
    findings.pages[page_config.label] = {
      path: page_config.path,
      status: 0,
      loaded: false,
      hasContent: false,
      textLen: 0,
      forms: 0,
      buttons: [],
      error: null,
    };

    try {
      const r = await page.goto(page_config.path, { timeout: 20000 });
      findings.pages[page_config.label].status = r?.status() ?? 0;

      // Check if redirected
      if (page.url().includes('/auth/')) {
        findings.pages[page_config.label].error = 'REDIRECT_TO_AUTH';
        continue;
      }

      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1500);

      const content = await page.locator('main, [role="main"], body').first().innerText();
      findings.pages[page_config.label].hasContent = content.length > 50;
      findings.pages[page_config.label].textLen = content.length;
      findings.pages[page_config.label].loaded = true;

      // Count forms and buttons
      const formCount = await page.locator('form').count();
      findings.pages[page_config.label].forms = formCount;

      const buttons = await page.getByRole('button').allTextContents();
      findings.pages[page_config.label].buttons = buttons
        .filter(Boolean)
        .slice(0, 8)
        .map((b) => b.slice(0, 30));

      // Look for save/submit patterns
      const hasSaveBtn = buttons.some((b) => /save|submit|update|apply/i.test(b));
      findings.pages[page_config.label].hasSaveButton = hasSaveBtn;

      await page.screenshot({ path: `ui-settings-${page_config.label.toLowerCase().replace(/ /g, '-')}.png` });
    } catch (e: any) {
      findings.pages[page_config.label].error = e.message.slice(0, 100);
    }
  }

  // Test basic navigation from settings page
  try {
    await page.goto('/settings', { timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    // Look for nav links
    const navLinks = await page.locator('nav a, aside a, [role="navigation"] a').allTextContents();
    findings.navigation = navLinks.filter(Boolean).slice(0, 20);
  } catch (e: any) {
    findings.navigation = ['error: ' + e.message.slice(0, 60)];
  }

  findings.summary = {
    allLoaded: Object.values(findings.pages).every((p: any) => p.loaded),
    allHaveContent: Object.values(findings.pages).every((p: any) => p.hasContent),
    apiErrorsFound: findings.apiErrors.length > 0,
    consoleErrorsFound: findings.consoleErrors.length > 0,
  };

  fs.writeFileSync(path.join(__dirname, '../results-settings.json'), JSON.stringify(findings, null, 2));

  console.log('\n===== SETTINGS PAGES TEST =====');
  for (const [label, pageData] of Object.entries(findings.pages)) {
    const flag = (pageData as any).loaded ? '✓' : '✗';
    console.log(
      `${flag} ${String(label).padEnd(16)} HTTP=${(pageData as any).status} text=${(pageData as any).textLen} forms=${(pageData as any).forms}`
    );
    if ((pageData as any).buttons.length) {
      console.log(`   buttons: ${(pageData as any).buttons.join(', ')}`);
    }
  }
  console.log(`\nAPI errors: ${findings.apiErrors.length > 0 ? findings.apiErrors.slice(0, 3).join(' | ') : 'none'}`);
});
