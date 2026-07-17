import { defineConfig, devices } from '@playwright/test';

// Local composer run: reuse the saved localhost session (e2e/.auth/state.json) — no auth.setup
// dependency, no password — against the host dev frontend. Covers the composer functional
// walkthrough (60) and the mobile capture/audit (61).
export default defineConfig({
  testDir: './tests',
  testMatch: [
    '**/20-ui-composer.spec.ts',
    '**/21-ui-composer-valid.spec.ts',
    '**/31-ui-composer-flows.spec.ts',
    '**/42-composer-crud.spec.ts',
    '**/60-composer-full.spec.ts',
    '**/61-composer-mobile.spec.ts',
    '**/62-composer-nav-guard.spec.ts',
  ],
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4200',
    ignoreHTTPSErrors: true,
    storageState: '.auth/state.json',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
