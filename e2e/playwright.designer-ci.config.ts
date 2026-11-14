import { defineConfig, devices } from '@playwright/test';

if (process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('The Designer production-build acceptance config runs only on GitHub Actions runners.');
}

export default defineConfig({
  testDir: './tests',
  testMatch: '**/96-designer-generated-video.spec.ts',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results-designer-ci',
  webServer: {
    command: 'pnpm --filter ./apps/frontend run start',
    cwd: '..',
    url: 'http://127.0.0.1:4200',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4200',
    storageState: {
      cookies: [{
        name: 'auth',
        value: 'designer-ci-mocked-session',
        domain: '127.0.0.1',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      }],
      origins: [],
    },
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
});
