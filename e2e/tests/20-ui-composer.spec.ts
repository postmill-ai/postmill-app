import { test, expect } from '@playwright/test';

// Drive the REAL composer UI like a user: open it, pick a channel, type content,
// and try to save/schedule. Screenshot every step; capture network + console.
test('compose a post through the UI', async ({ page }) => {
  const apiCalls: string[] = [];
  const consoleErrors: string[] = [];
  page.on('response', r => {
    const u = r.url();
    if (u.includes('/api/') && (u.includes('/posts') || u.includes('preflight') || u.includes('valid') || u.includes('media'))) {
      apiCalls.push(`${r.status()} ${r.request().method()} ${u.replace('https://postiz.reaatech.com','').split('?')[0]}`);
    }
  });
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });

  await page.goto('/launches');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // 1) Open the composer
  const createBtn = page.getByText('Create Post', { exact: false }).first();
  await expect(createBtn, 'Create Post button should be visible').toBeVisible({ timeout: 10000 });
  await createBtn.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'ui-01-composer-open.png' });
  console.log('STEP 1 — composer opened. URL:', page.url());

  // 2) Select a channel — the picks.socials avatar wrapper:
  //    div.cursor-pointer.rounded-full containing img[alt=<identifier>]
  const channelPick = page.locator('div.cursor-pointer.rounded-full:has(img[alt])').first();
  const channelCount = await channelPick.count();
  console.log('STEP 2 — channel picks found:', channelCount);
  if (channelCount > 0) {
    await channelPick.click({ timeout: 5000 }).catch(e => console.log('  channel click failed:', e.message));
    await page.waitForTimeout(2000);
  }
  await page.screenshot({ path: 'ui-02-channel-selected.png' });
  // The submit button label flips from "Check the circles above" once a channel is picked
  const submitNow = await page.getByRole('button').allTextContents();
  console.log('STEP 2 — buttons after channel select:', submitNow.filter(Boolean).join(' | '));

  // 3) Type content into the editor
  const editorCandidates = [
    page.locator('[contenteditable="true"]').first(),
    page.locator('.ProseMirror').first(),
    page.locator('textarea').first(),
  ];
  let typed = false;
  for (const ed of editorCandidates) {
    if (await ed.count() && await ed.isVisible().catch(() => false)) {
      await ed.click().catch(() => {});
      await ed.type('E2E UI test post — please ignore. ' + Date.now(), { delay: 10 }).catch(() => {});
      typed = true;
      break;
    }
  }
  console.log('STEP 3 — typed into editor:', typed);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'ui-03-content-typed.png' });

  // 4) Submit via "Save as draft" first (safe — no live publish), exercising preflight/valid/create
  const submitLabels = [/save as draft/i, /add to calendar/i, /schedule/i, /post now/i, /publish/i];
  const buttons = await page.getByRole('button').allTextContents();
  console.log('STEP 4 — buttons available:', buttons.filter(Boolean).join(' | '));

  let clicked = '';
  for (const re of submitLabels) {
    const b = page.getByRole('button', { name: re }).first();
    if (await b.count() && await b.isVisible().catch(() => false) && await b.isEnabled().catch(() => false)) {
      clicked = (await b.textContent())?.trim() || re.source;
      await b.click().catch(e => console.log('  submit click failed:', e.message));
      break;
    }
  }
  console.log('STEP 4 — clicked submit:', clicked || '(none found)');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'ui-04-after-submit.png' });

  // 5) Report what happened
  console.log('\n--- composer network (posts/preflight/valid/media) ---');
  apiCalls.forEach(c => console.log('  ', c));
  console.log('--- console errors ---');
  [...new Set(consoleErrors)].slice(0, 8).forEach(c => console.log('  ', c));

  // Did the composer still show a spinner / stay open / error?
  const stillOpen = await page.locator('[contenteditable="true"], .ProseMirror').count();
  console.log('composer editor still present after submit:', stillOpen > 0);
});
