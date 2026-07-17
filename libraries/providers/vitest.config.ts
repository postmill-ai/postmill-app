import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: [
      // Keep exact workspace aliases first so non-provider packages resolve to source.
      {
        find: '@gitroom/provider-kernel',
        replacement: path.resolve(__dirname, './kernel/src'),
      },
      {
        find: '@gitroom/provider-kernel/*',
        replacement: path.resolve(__dirname, './kernel/src/*'),
      },
      {
        find: '@gitroom/nestjs-libraries',
        replacement: path.resolve(__dirname, '../nestjs-libraries/src'),
      },
      {
        find: '@gitroom/helpers',
        replacement: path.resolve(__dirname, '../helpers/src'),
      },
      {
        find: '@gitroom/backend',
        replacement: path.resolve(__dirname, '../../apps/backend/src'),
      },
      // Redirect every @gitroom/provider-* workspace package to its src directory so tests
      // use the current source files instead of stale node_modules copies (e.g. missing metadata.ts).
      {
        find: /^@gitroom\/provider-([^/]+)$/,
        replacement: path.resolve(__dirname, './$1/src'),
      },
      {
        find: /^@gitroom\/provider-([^/]+)\/(.*)$/,
        replacement: path.resolve(__dirname, './$1/src/$2'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      '*/src/**/*.spec.ts',
      '*/src/**/*.test.ts',
      '*/src/**/*.int-spec.ts',
    ],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      // Only instrument files actually loaded by tests — without this v8 would report
      // every untested adapter at 0% and sink the floor (70+ adapters still lack tests).
      all: false,
      include: [
        'kernel/src/**',
        // Consolidated base classes the migrated adapters now extend (H5) — coverage-gated.
        'kernel/src/domains/media-helpers.ts',
        'kernel/src/domains/shortlink.ts',
        // Adapters with B4 recorded-fixture integration tests.
        'wan/src/v1/media.adapter.ts',
        'higgsfield/src/v1/media.adapter.ts',
        'ltx/src/v1/media.adapter.ts',
        'reelfarm/src/v1/media.adapter.ts',
        'genviral/src/v1/media.adapter.ts',
        'openai/src/v1/media.adapter.ts',
        'google-ai/src/v1/media.adapter.ts',
        'leonardo/src/v1/media.adapter.ts',
      ],
      exclude: [
        '**/*.spec.ts',
        '**/*.int-spec.ts',
        '**/*.test.ts',
        // Legacy social-provider implementations relocated into the kernel package — these are
        // adapter logic (1000+-line base classes), not kernel framework, and are out of scope for
        // this floor. Tracked in PROVIDERS_INVENTORY.md backlog.
        'kernel/src/domains/social-families/**',
        'kernel/src/domains/social-dtos/**',
        'kernel/src/domains/social-base.ts',
        'kernel/src/domains/social-bridge.ts',
        'kernel/src/domains/social-provider.ts',
        'kernel/src/domains/social-capabilities.ts',
        'kernel/src/domains/social-credentials.ts',
        'kernel/src/domains/social-rules-decorator.ts',
        'kernel/src/domains/social-tool-decorator.ts',
        'kernel/src/domains/social-make-id.ts',
        // Legacy storage base-and-bridge module (storage base) — large relocated helper class the
        // kit adapters do not extend; same backlog rationale. (media-helpers.ts is now coverage-gated
        // since the migrated media adapters extend BearerTokenMediaAdapter — see include above.)
        'kernel/src/domains/storage-helpers.ts',
      ],
      thresholds: {
        statements: 75,
        lines: 70,
      },
    },
  },
});
