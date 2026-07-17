import base from './playwright.local.config';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  ...base,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...base.use,
        storageState: '.auth/state.json',
      },
    },
  ],
});
