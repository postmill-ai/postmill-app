import { test as setup } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const AUTH_DIR = path.join(__dirname, '../.auth');
fs.mkdirSync(AUTH_DIR, { recursive: true });

/**
 * Three personas for full-surface coverage. A large fraction of the UI is RBAC/tier gated
 * and *hidden* (not merely disabled), so one login can't reach every button/menu.
 *
 * - admin  — super-admin (bypasses RBAC): sees everything.
 * - member — plain org member (RBAC-gated): exercises hidden/denied paths.
 * - free   — free/billing-disabled surface. NOTE: Stripe is unconfigured locally, so
 *            `billingEnabled` is already false for every persona and the free-tier paywall
 *            can't be exercised without Stripe test keys. Until then `free` reuses the
 *            member login; the separate state file keeps the config stable for when billing
 *            is enabled. See dev/UI_UX_AUDIT.md.
 *
 * Creds via env, defaulting to the seeded users (scripts/seed-test-data.js).
 */
const PERSONAS = [
  { name: 'admin', email: process.env.E2E_ADMIN_EMAIL || 'test@test.com', password: process.env.E2E_ADMIN_PASSWORD || 'Test123!' },
  { name: 'member', email: process.env.E2E_MEMBER_EMAIL || 'jordan@acme.test', password: process.env.E2E_MEMBER_PASSWORD || 'Test123!' },
  { name: 'free', email: process.env.E2E_FREE_EMAIL || 'jordan@acme.test', password: process.env.E2E_FREE_PASSWORD || 'Test123!' },
];

for (const p of PERSONAS) {
  setup(`authenticate ${p.name}`, async ({ page }) => {
    setup.setTimeout(120_000); // cold webpack compile of /auth + post-login /dashboard is slow
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Email Address').fill(p.email);
    await page.getByPlaceholder('Password').fill(p.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    // The backend replies with reload:true → the client reloads and redirects off /auth/login.
    // On a cold compile this can take a while; wait generously and don't fail the whole sweep.
    await page.waitForURL((u) => !u.toString().includes('/auth/login'), { timeout: 90_000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    console.log(`[auth:${p.name}] ${p.email} → ${page.url()}`);
    await page.context().storageState({ path: path.join(AUTH_DIR, `${p.name}.json`) });
  });
}
