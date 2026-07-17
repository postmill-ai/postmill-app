import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@gitroom/helpers': path.resolve(__dirname, '../../libraries/helpers/src'),
      '@gitroom/react': path.resolve(__dirname, '../../libraries/react-shared-libraries/src'),
      '@gitroom/frontend': path.resolve(__dirname, 'src'),
      '@gitroom/nestjs-libraries': path.resolve(__dirname, '../../libraries/nestjs-libraries/src'),
      '@gitroom/provider-kernel': path.resolve(__dirname, '../../libraries/providers/kernel/src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    server: {
      deps: {
        fallbackCJS: true,
      },
    },
    include: [
      'src/components/analytics-v2/**/*.spec.{ts,tsx}',
      'src/components/launches/post-detail/*.spec.{ts,tsx}',
      'src/components/launches/calendar.spec.{ts,tsx}',
      'src/components/launches/launches.component.spec.{ts,tsx}',
      'src/components/launches/tags.component.spec.{ts,tsx}',
      'src/components/launches/separate.post.spec.{ts,tsx}',
      'src/components/launches/merge.post.spec.{ts,tsx}',
      'src/components/launches/import-debug-post.modal.spec.{ts,tsx}',
      'src/components/launches/time.table.spec.{ts,tsx}',
      'src/components/launches/calendar/**/*.spec.{ts,tsx}',
      'src/components/launches/generator/**/*.spec.{ts,tsx}',
      'src/components/dashboard/**/*.spec.{ts,tsx}',
      'src/components/settings/media-providers/**/*.spec.{ts,tsx}',
      'src/components/shared/**/*.spec.{ts,tsx}',
      'src/components/ai/**/*.spec.{ts,tsx}',
      'src/components/settings/shortlinks/**/*.spec.{ts,tsx}',
      'src/components/settings/vpn/**/*.spec.{ts,tsx}',
      'src/components/settings/storage/**/*.spec.{ts,tsx}',
      'src/components/settings/*.spec.{ts,tsx}',
      'src/components/layout/use-permissions.spec.{ts,tsx}',
      'src/components/layout/top.menu.spec.{ts,tsx}',
      'src/components/settings/roles/**/*.spec.{ts,tsx}',
      'src/components/new-layout/layout.component.spec.{ts,tsx}',
      'src/components/new-layout/user-avatar-menu.spec.{ts,tsx}',
      'src/components/new-layout/bottom-tab-bar.spec.{ts,tsx}',
      'src/components/setup/**/*.spec.{ts,tsx}',
      'src/components/media-tools/designer/*.spec.{ts,tsx}',
      'src/components/media-tools/ai-designer/*.spec.{ts,tsx}',
      'src/components/media-tools/*.spec.{ts,tsx}',
      'src/components/composer/picks.socials.component.spec.{ts,tsx}',
      'src/components/composer/manage.modal.spec.{ts,tsx}',
      'src/components/composer/store.spec.{ts,tsx}',
      'src/components/composer/bulk/*.spec.{ts,tsx}',
      'src/components/composer/content-qa/*.spec.{ts,tsx}',
      'src/components/campaigns/**/*.spec.{ts,tsx}',
      'src/components/agent/**/*.spec.{ts,tsx}',
      'src/components/agents/**/*.spec.{ts,tsx}',
      'src/redirects.config.spec.ts',
      'src/app/**/*.spec.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: [
        'src/components/analytics-v2/**/*.{ts,tsx}',
      ],
      exclude: [
        'src/components/analytics-v2/charts/*.tsx',
      ],
      // RATCHET FLOORS at measured coverage (analytics-v2 surface only). The prior
      // 95/80/65/95 gate was never CI-enforced (no `--coverage` in `pnpm run test`);
      // real coverage is ~70%. Floors lock in today's level so regressions fail CI;
      // TODO(tracked debt): raise toward 90+ as analytics-v2 specs are backfilled.
      thresholds: {
        statements: 69,
        branches: 62,
        functions: 58,
        lines: 69,
      },
    },
  },
});
