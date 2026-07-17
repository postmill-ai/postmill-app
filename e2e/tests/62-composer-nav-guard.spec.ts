import { test, expect } from '@playwright/test';

// The composer guards in-app navigation when there are unsaved changes: clicking an internal
// link while composing shows the shared confirm dialog; cancel stays, confirm navigates.
// It must NOT fire on an empty composer (only "once they've started something").

const pathOf = (u: string) => new URL(u).pathname;
const GUARD_TEXT = 'You have unsaved changes. Leave and lose them?';

test.describe('composer — unsaved-changes in-app nav guard', () => {
  test('empty → no guard; dirty → cancel stays, confirm leaves', async ({ page }) => {
    // --- Empty composer: nav is NOT guarded ---
    await page.goto('/posts/post');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const navLink = page.locator('a[href="/analytics"]').first();
    await expect(navLink, 'sidebar Analytics link present').toBeVisible();

    await navLink.click();
    // With nothing composed, the click navigates straight through (guard inactive).
    await page.waitForURL('**/analytics', { timeout: 30000 });
    expect(pathOf(page.url())).toBe('/analytics');

    // --- Dirty composer: nav IS guarded ---
    await page.goto('/posts/post');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const editor = page.locator('.ProseMirror, [contenteditable="true"]').first();
    await editor.click();
    await editor.type('Unsaved composer work — should be guarded', { delay: 8 });
    await page.waitForTimeout(1000);

    const navLink2 = page.locator('a[href="/analytics"]').first();

    // Click nav → guard dialog appears, URL unchanged.
    await navLink2.click();
    await expect(page.getByText(GUARD_TEXT), 'guard dialog on nav while dirty').toBeVisible();
    expect(pathOf(page.url()), 'stayed on composer while dialog open').toBe('/posts/post');

    // Cancel → stay.
    await page.getByRole('button', { name: /no, cancel/i }).first().click();
    await page.waitForTimeout(600);
    expect(pathOf(page.url()), 'cancel keeps us on the composer').toBe('/posts/post');
    await expect(page.getByText(GUARD_TEXT)).toHaveCount(0);

    // Click nav again → confirm → navigate away.
    await navLink2.click();
    await expect(page.getByText(GUARD_TEXT)).toBeVisible();
    await page.getByRole('button', { name: /yes, leave/i }).first().click();
    await page.waitForURL('**/analytics', { timeout: 30000 });
    expect(pathOf(page.url())).toBe('/analytics');
  });
});
