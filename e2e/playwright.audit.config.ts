import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * Full-surface audit config: runs the crawl / exercise / a11y specs against the LOCAL
 * host dev servers (frontend :4200, backend :3000) as three personas.
 *
 * Usage:
 *   npx playwright test --config playwright.audit.config.ts                 # all personas
 *   npx playwright test --config playwright.audit.config.ts --project=admin # one persona
 *
 * workers:1 (inherited) avoids the 429 throttle the crawler flags. Each persona reuses the
 * storageState saved by auth.setup.ts. Only the audit specs run here (40/46/92); the older
 * numbered specs are left to their own configs.
 */
const AUDIT_SPECS = [
  '**/40-crawl-all-routes.spec.ts',
  '**/46-exercise-interactions.spec.ts',
  '**/92-a11y.spec.ts',
  '**/93-metadata-titles.spec.ts',
  '**/94-setup-rbac.spec.ts',
  '**/95-contrast.spec.ts',
];

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    baseURL: process.env.E2E_BASE || 'http://localhost:4200',
    launchOptions: {
      // CI (GitHub Actions) resolves `localhost` to ::1 (IPv6) first, but the backend
      // (`app.listen(port)`) binds IPv4 only — so Chromium's login fetch to
      // http://localhost:3000 gets net::ERR_CONNECTION_REFUSED and auth.setup times out.
      // Pin localhost → 127.0.0.1 in the browser's resolver so it reaches the backend.
      // URLs and cookies stay `localhost` (cookie Domain derives from FRONTEND_URL), so
      // nothing else changes. Harmless locally (localhost is already IPv4-reachable).
      args: ['--host-resolver-rules=MAP localhost 127.0.0.1'],
    },
  },
  projects: [
    { name: 'setup', testMatch: '**/auth.setup.ts' },
    {
      name: 'admin',
      testMatch: AUDIT_SPECS,
      use: { ...devices['Desktop Chrome'], storageState: '.auth/admin.json' },
    },
    {
      name: 'member',
      testMatch: AUDIT_SPECS,
      use: { ...devices['Desktop Chrome'], storageState: '.auth/member.json' },
    },
    {
      name: 'free',
      testMatch: AUDIT_SPECS,
      use: { ...devices['Desktop Chrome'], storageState: '.auth/free.json' },
    },
  ],
});
