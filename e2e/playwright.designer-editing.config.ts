import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE || 'http://localhost:4201';
const skipAuthSetup = process.env.E2E_SKIP_AUTH_SETUP === '1';
const hostname = new URL(baseURL).hostname;
const mockStorageState = skipAuthSetup && ['localhost', '127.0.0.1', '::1'].includes(hostname)
  ? {
      cookies: [{
        name: 'auth',
        value: 'mocked-designer-e2e',
        domain: hostname,
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      }],
      origins: [],
    }
  : undefined;

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/96-designer-editing-ux.spec.ts'],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: '**/auth.setup.ts' },
    {
      name: 'admin',
      use: {
        ...devices['Desktop Chrome'],
        storageState: mockStorageState ??
          (skipAuthSetup ? undefined : process.env.E2E_AUTH_STATE || '.auth/admin.json'),
      },
      dependencies: skipAuthSetup ? [] : ['setup'],
    },
  ],
});
