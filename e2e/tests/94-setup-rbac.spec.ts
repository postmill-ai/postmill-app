import { test, expect } from '@playwright/test';

/**
 * Regression guard for the setup dead-end fix: a member (or any non-owner/admin) can't complete
 * the required LLM step, so they must never be trapped on /setup. The SetupWizard redirects
 * non-admins to /dashboard; the layout gate doesn't force them there. Owners/admins keep access.
 *
 * Persona-aware (runs under the audit config's admin/member/free projects).
 */
test('setup route is gated to owners/admins', async ({ page }) => {
  const persona = test.info().project.name;
  await page.goto('/setup');
  // Give the client-side permission-gated redirect time to resolve.
  await page.waitForTimeout(4000);
  const path = new URL(page.url()).pathname;

  if (persona === 'admin') {
    // Owner/super-admin can complete setup → stays on /setup (not bounced to /dashboard).
    expect(path, 'admin should be able to open /setup').toBe('/setup');
  } else {
    // member / free (non-admin) → redirected off the un-completable wizard.
    expect(path, `${persona} should be redirected off /setup`).not.toBe('/setup');
  }
});
