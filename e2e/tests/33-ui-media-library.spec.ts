import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Media library testing:
 * - Page loads
 * - Can view media list
 * - Can search/filter
 * - Can upload (or shows upload form)
 * - Can delete/manage media
 */
test('media library page coverage', async ({ page }) => {
  const findings: any = {
    pageLoad: {},
    mediaItems: 0,
    filters: [],
    upload: { available: false, tested: false },
    interactions: [],
    apiCalls: [],
    errors: [],
  };

  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/files')) {
      findings.apiCalls.push(`${r.status()} ${u.split('?')[0].replace('https://postiz.reaatech.com/api/files', '')}`);
    }
  });

  try {
    // Load media page
    const r = await page.goto('/files', { timeout: 20000 });
    findings.pageLoad.status = r?.status() ?? 0;
    findings.pageLoad.url = page.url();

    if (page.url().includes('/auth/')) {
      findings.pageLoad.redirectedToAuth = true;
      findings.errors.push('AUTH_REDIRECT');
    }

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const content = await page.locator('main, body').first().innerText();
    findings.pageLoad.hasContent = content.length > 50;
    findings.pageLoad.textLen = content.length;

    // Count media items in grid/list
    const mediaItems = await page.locator(
      '[class*="media"], [class*="gallery"], img[alt]:not([role="presentation"])'
    ).count();
    findings.mediaItems = mediaItems;

    // Look for search/filter controls
    const searchInput = page.locator('input[placeholder*="search" i], input[placeholder*="filter" i]').first();
    if (await searchInput.count()) {
      findings.filters.push('search');
      findings.interactions.push('found-search-input');
    }

    // Look for sort/view options
    const selectControls = await page.locator('select, [role="listbox"], [role="combobox"]').count();
    findings.filters.push(`${selectControls}-select-controls`);

    // Check for upload button/area
    const uploadBtn = page.getByRole('button', { name: /upload|add/i }).first();
    if (await uploadBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      findings.upload.available = true;
      findings.interactions.push('upload-button-visible');
    }

    // Look for drop zone
    const dropZone = page.locator('[class*="drop"], [class*="drag"]').first();
    if (await dropZone.count()) {
      findings.upload.available = true;
      findings.interactions.push('drag-drop-zone-found');
    }

    // Try clicking on first media item if available
    if (findings.mediaItems > 0) {
      const firstMedia = page.locator('img:visible').first();
      if (await firstMedia.isVisible({ timeout: 5000 }).catch(() => false)) {
        await firstMedia.click().catch(() => {});
        await page.waitForTimeout(1500);
        findings.interactions.push('clicked-first-media');
      }
    }

    // Look for action buttons (delete, download, edit)
    const actionBtns = await page.locator('button:has(svg), [aria-label*="delete" i], [aria-label*="download" i]').count();
    findings.interactions.push(`${actionBtns}-action-buttons-found`);

    await page.screenshot({ path: 'ui-media-library.png' });
  } catch (e: any) {
    findings.errors.push(e.message.slice(0, 100));
  }

  findings.summary = {
    pageLoaded: findings.pageLoad.status === 200,
    hasContent: findings.pageLoad.hasContent,
    mediaItemsFound: findings.mediaItems > 0,
    uploadAvailable: findings.upload.available,
  };

  fs.writeFileSync(path.join(__dirname, '../results-media.json'), JSON.stringify(findings, null, 2));

  console.log('\n===== MEDIA LIBRARY TEST =====');
  console.log(`Page: HTTP ${findings.pageLoad.status} | ${findings.pageLoad.hasContent ? '✓ content' : '✗ empty'}`);
  console.log(`Media items: ${findings.mediaItems}`);
  console.log(`Filters: ${findings.filters.join(', ') || 'none'}`);
  console.log(`Upload: ${findings.upload.available ? '✓ available' : '✗ not found'}`);
  console.log(`Interactions: ${findings.interactions.join(' | ')}`);
  if (findings.errors.length) console.log(`Errors: ${findings.errors.join(', ')}`);
});
