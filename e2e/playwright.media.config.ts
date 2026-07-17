import { defineConfig, devices } from '@playwright/test';

// Local media run: reuse the saved localhost session (e2e/.auth/state.json) — no auth.setup
// dependency, no password needed — and point at the host dev frontend.
export default defineConfig({
  testDir: './tests',
  testMatch: ['**/90-media-suite.spec.ts', '**/91-settings-routes.spec.ts'],
  timeout: 45_000,
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
