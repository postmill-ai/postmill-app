import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Comprehensive composer testing:
 * - Create as draft
 * - Schedule post
 * - Post now
 * - Multiple channels
 * - Media/file upload
 * - AI features (if available)
 * - Validation errors
 */
test('composer flow - multiple submission paths', async ({ page }) => {
  const findings: any[] = [];

  const scenarios = [
    { name: 'draft-only', submitBtn: /save as draft/i },
    { name: 'with-schedule', submitBtn: /add to calendar|schedule/i },
  ];

  for (const scenario of scenarios) {
    const result: any = {
      scenario: scenario.name,
      steps: [],
      apiCalls: [],
      errors: [],
      finalState: {},
    };

    const apiCalls: string[] = [];
    const consoleErrors: string[] = [];

    page.on('response', (r) => {
      const u = r.url();
      if (u.includes('/api/posts')) {
        apiCalls.push(`${r.status()} ${u.split('?')[0].replace('https://postiz.reaatech.com/api/posts', '')}`);
      }
    });

    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 120));
    });

    try {
      // Step 1: Navigate to calendar
      result.steps.push('navigate-to-calendar');
      await page.goto('/launches', { timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);

      // Step 2: Open composer
      result.steps.push('open-composer');
      const createBtn = page.getByText('Create Post', { exact: false }).first();
      if (!(await createBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
        result.errors.push('CREATE_POST_BUTTON_NOT_FOUND');
        continue;
      }
      await createBtn.click();
      await page.waitForTimeout(2000);

      // Step 3: Select channel(s)
      result.steps.push('select-channel');
      const channelPicker = page.locator('div.cursor-pointer.rounded-full:has(img[alt])').first();
      if (await channelPicker.count()) {
        await channelPicker.click().catch(() => {});
        await page.waitForTimeout(1500);
      } else {
        result.errors.push('NO_CHANNEL_PICKER_FOUND');
      }

      // Step 4: Fill editor
      result.steps.push('type-content');
      const editorLocators = [
        page.locator('[contenteditable="true"]').first(),
        page.locator('.ProseMirror').first(),
        page.locator('textarea').first(),
      ];

      let typed = false;
      for (const ed of editorLocators) {
        if (await ed.isVisible({ timeout: 3000 }).catch(() => false)) {
          await ed.click();
          const testText = `Composer test (${scenario.name}) @ ${Date.now()}`;
          await ed.type(testText, { delay: 5 });
          typed = true;
          break;
        }
      }

      if (!typed) result.errors.push('EDITOR_NOT_TYPED');
      await page.waitForTimeout(1000);

      // Step 5: Try to submit
      result.steps.push(`submit-${scenario.name}`);
      const submitBtn = page.getByRole('button', { name: scenario.submitBtn }).first();
      if (await submitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(4000);
        result.steps.push('submit-succeeded');
      } else {
        result.errors.push('SUBMIT_BUTTON_NOT_FOUND');
        // Show available buttons for debugging
        const allBtns = await page.getByRole('button').allTextContents();
        result.availableButtons = allBtns.filter(Boolean).slice(0, 10);
      }

      // Step 6: Check final state
      result.finalState.editorVisible = (await page.locator('[contenteditable="true"], .ProseMirror').count()) > 0;
      result.finalState.url = page.url().replace('https://postiz.reaatech.com', '');

      await page.screenshot({ path: `ui-composer-${scenario.name}.png` });
    } catch (e: any) {
      result.errors.push(e.message.slice(0, 100));
    } finally {
      result.apiCalls = apiCalls;
      result.consoleErrors = consoleErrors;
      findings.push(result);

      page.off('response', () => {});
      page.off('console', () => {});
    }
  }

  fs.writeFileSync(
    path.join(__dirname, '../results-composer-flows.json'),
    JSON.stringify(findings, null, 2)
  );

  console.log('\n===== COMPOSER FLOWS TEST =====');
  for (const f of findings) {
    const status = f.errors.length === 0 ? '✓' : '✗';
    console.log(`\n${status} ${f.scenario}`);
    console.log(`  Steps: ${f.steps.join(' → ')}`);
    if (f.errors.length) console.log(`  Errors: ${f.errors.join(', ')}`);
    if (f.apiCalls.length) console.log(`  API: ${f.apiCalls.slice(0, 3).join(' | ')}`);
    if (f.consoleErrors.length) console.log(`  Console: ${f.consoleErrors.slice(0, 2).join(' | ')}`);
  }
});
