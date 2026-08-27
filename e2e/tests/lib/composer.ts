import { Page, expect } from '@playwright/test';

/**
 * Open the post composer the way a user does in the current UI:
 * header "Create new" icon-button (aria-label, no text) → "New Post" menuitem →
 * navigation to /posts/post. The old flat "Create Post" button on /launches is gone
 * (/launches redirects to /posts now), so specs must not look for that text.
 */
export async function openComposer(page: Page) {
  const createBtn = page.locator('button[aria-label="Create new"]').first();
  await expect(createBtn, 'Create new button should be visible').toBeVisible({ timeout: 10000 });
  await createBtn.click();
  await page.getByRole('menuitem', { name: 'New Post' }).click();
  await page.waitForURL('**/posts/post**', { timeout: 15000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}
