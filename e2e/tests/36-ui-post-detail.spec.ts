import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Post detail and interaction testing:
 * - Click post card to open detail modal
 * - View KPI metrics (views, likes, comments)
 * - View post thread/replies
 * - Comments section rendering
 * - Edit post modal
 * - Delete post
 * - Share/schedule actions
 */
test('post detail modal and interactions', async ({ page }) => {
  const findings: any = {
    navigation: { status: 0, loaded: false },
    cards: { found: 0, clicked: 0 },
    detailModal: {
      opened: false,
      hasKpi: false,
      kpiMetrics: [],
      hasComments: false,
      commentCount: 0,
    },
    editModal: { opened: false, hasFields: 0 },
    interactions: [],
    apiCalls: [],
    errors: [],
  };

  const apiCalls: string[] = [];
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/posts')) {
      apiCalls.push(`${r.status()} ${u.split('?')[0].replace('https://postiz.reaatech.com/api/posts', '')}`);
    }
  });

  try {
    // 1. Navigate to calendar
    findings.navigation.url = '/launches';
    const r = await page.goto('/launches', { timeout: 20000 });
    findings.navigation.status = r?.status() ?? 0;

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);

    findings.navigation.loaded = findings.navigation.status === 200;

    // 2. Look for post cards. NOTE: :has-text(/regex/) is NOT valid inside a CSS locator() string
    //    (throws "Unexpected token /"). Use .filter({ hasText: /regex/ }) instead.
    const cardLocator = page
      .locator('[class*="card"], [class*="post"]')
      .filter({ hasText: /Published|Draft|FREE AI|Scheduled/i });
    const cards = await cardLocator.count();
    findings.cards.found = cards;

    if (cards > 0) {
      findings.interactions.push(`found-${cards}-post-cards`);

      // 3. Click first card to open detail modal
      const firstCard = cardLocator.first();

      if (await firstCard.isVisible({ timeout: 5000 }).catch(() => false)) {
        await firstCard.click({ timeout: 5000 });
        findings.cards.clicked = 1;
        findings.interactions.push('clicked-first-card');

        await page.waitForTimeout(2500);

        // 4. Check for detail modal
        const modalSelector = '[role="dialog"], [class*="modal"], [class*="popup"], [class*="sheet"]';
        const modal = page.locator(modalSelector).first();

        if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
          findings.detailModal.opened = true;
          findings.interactions.push('modal-opened');

          // 5. Look for KPI metrics (views, likes, comments, etc.)
          const kpiArea = modal.locator('[class*="metric"], [class*="stat"], [class*="kpi"]');
          const kpiCount = await kpiArea.count();
          findings.detailModal.hasKpi = kpiCount > 0;

          if (kpiCount > 0) {
            findings.interactions.push(`found-${kpiCount}-kpi-elements`);

            // Extract metric values/labels
            const metrics = await kpiArea.allTextContents();
            findings.detailModal.kpiMetrics = metrics.filter(Boolean).slice(0, 8);
          }

          // 6. Look for comments section
          const commentsSection = modal.locator('[class*="comment"], [role="region"]:has-text("Comment")').first();
          if (await commentsSection.count()) {
            findings.detailModal.hasComments = true;
            findings.interactions.push('comments-section-visible');

            // Count comment items
            const commentItems = commentsSection.locator('[class*="comment"], li').count();
            findings.detailModal.commentCount = await commentItems;
          }

          // 7. Look for action buttons (Edit, Delete, Share, Schedule)
          const actionBtns = await modal.locator('button').allTextContents();
          const actions = actionBtns
            .filter((b) => /edit|delete|share|schedule|update/i.test(b))
            .filter(Boolean);
          findings.interactions = findings.interactions.concat(actions.slice(0, 5));

          // 8. Try clicking Edit button
          const editBtn = modal.getByRole('button', { name: /edit/i }).first();
          if (await editBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await editBtn.click({ timeout: 5000 });
            findings.interactions.push('clicked-edit-button');
            await page.waitForTimeout(1500);

            // Check if edit modal opened or form appeared
            const editModal = page.locator('[class*="edit"], [class*="form"]').first();
            const editFields = await editModal.locator('input, textarea, [contenteditable]').count();
            findings.editModal.hasFields = editFields;
            findings.editModal.opened = editFields > 0;

            if (editFields > 0) {
              findings.interactions.push(`edit-form-has-${editFields}-fields`);
            }

            // Close without saving
            const closeBtn = page.locator('[aria-label*="close"], button:text("×"), button:text("Cancel")').first();
            await closeBtn.click({ timeout: 5000 }).catch(() => {});
          }

          // 9. Screenshot detail view
          await page.screenshot({ path: 'ui-post-detail-modal.png' });

          // Close detail modal
          const closeModal = modal.locator('[aria-label*="close"], button:text("×")').first();
          await closeModal.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1000);
        } else {
          findings.errors.push('DETAIL_MODAL_NOT_OPENED');
        }
      }
    } else {
      findings.errors.push('NO_POST_CARDS_FOUND');
    }

    await page.screenshot({ path: 'ui-post-detail-final.png' });
  } catch (e: any) {
    findings.errors.push(e.message.slice(0, 100));
  }

  findings.apiCalls = apiCalls;
  findings.summary = {
    navigationSuccess: findings.navigation.loaded,
    cardsFound: findings.cards.found > 0,
    modalOpened: findings.detailModal.opened,
    kpiVisible: findings.detailModal.hasKpi,
    commentsVisible: findings.detailModal.hasComments,
    editAvailable: findings.editModal.opened,
  };

  fs.writeFileSync(path.join(__dirname, '../results-post-detail.json'), JSON.stringify(findings, null, 2));

  console.log('\n===== POST DETAIL MODAL TEST =====');
  console.log(`Cards found: ${findings.cards.found} | clicked: ${findings.cards.clicked}`);
  console.log(`Detail modal: ${findings.detailModal.opened ? '✓ opened' : '✗ not-opened'}`);
  if (findings.detailModal.opened) {
    console.log(`  KPIs: ${findings.detailModal.hasKpi ? '✓' : '✗'} ${findings.detailModal.kpiMetrics.slice(0, 3).join(' | ')}`);
    console.log(`  Comments: ${findings.detailModal.hasComments ? '✓' : '✗'} (${findings.detailModal.commentCount} items)`);
  }
  console.log(`Edit modal: ${findings.editModal.opened ? `✓ ${findings.editModal.hasFields} fields` : '✗'}`);
  console.log(`Actions: ${findings.interactions.filter((i) => /edit|delete|share/i.test(i)).join(', ')}`);
  if (findings.errors.length) console.log(`Errors: ${findings.errors.join(', ')}`);
});
