import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Capture the EXACT /posts/valid (and /preflight) request the real composer sends, + the 400 body.
test('capture composer valid/preflight request + response', async ({ page }) => {
  const captured: any[] = [];
  page.on('request', req => {
    const u = req.url();
    if (/\/api\/posts\/(valid|preflight)/.test(u)) {
      captured.push({ phase: 'request', url: u.replace('https://postiz.reaatech.com', ''), method: req.method(), postData: req.postData()?.slice(0, 2000) });
    }
  });
  page.on('response', async res => {
    const u = res.url();
    if (/\/api\/posts\/(valid|preflight)/.test(u)) {
      let body = ''; try { body = (await res.text()).slice(0, 1000); } catch {}
      captured.push({ phase: 'response', url: u.replace('https://postiz.reaatech.com', ''), status: res.status(), body });
    }
  });

  await page.goto('/launches');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.getByText('Create Post', { exact: false }).first().click();
  await page.waitForTimeout(2500);
  // Hybrid channel selector: dropdown (>4 channels) or icon row (<=4).
  const dropdown = page.locator('button[aria-haspopup="listbox"]').first();
  if (await dropdown.count()) {
    await dropdown.click().catch(() => {});
    await page.waitForTimeout(400);
    await page.locator('[role="option"]').first().click().catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
  } else {
    await page.locator('div.cursor-pointer.rounded-full:has(img[alt])').first().click().catch(() => {});
  }
  await page.waitForTimeout(2000);
  const ed = page.locator('[contenteditable="true"], .ProseMirror').first();
  await ed.click().catch(() => {});
  await ed.type('Composer valid-check ' + Date.now(), { delay: 10 }).catch(() => {});
  await page.waitForTimeout(800);
  // "Save as Draft" now lives inside the "Save as" dropup — hover to reveal it.
  const saveAs = page.getByRole('button', { name: /^save as$/i }).first();
  if (await saveAs.count()) {
    await saveAs.hover().catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.getByRole('button', { name: /save as draft/i }).first().click().catch(() => {});
  await page.waitForTimeout(4000);

  await page.screenshot({ path: 'ui-valid-capture.png' });
  fs.writeFileSync(path.join(__dirname, '../results-valid-capture.json'), JSON.stringify(captured, null, 2));
  console.log('\n===== /posts/valid + /preflight capture =====');
  for (const c of captured) {
    if (c.phase === 'request') console.log(`\nREQUEST ${c.method} ${c.url}\n  payload: ${c.postData}`);
    else console.log(`RESPONSE ${c.status} ${c.url}\n  body: ${c.body}`);
  }
});
