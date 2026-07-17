import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@gitroom/provider-kernel': path.resolve(__dirname, '../kernel/src'),
      '@gitroom/provider-kernel/*': path.resolve(__dirname, '../kernel/src/*'),
      '@gitroom/nestjs-libraries': path.resolve(__dirname, '../../nestjs-libraries/src'),
      '@gitroom/helpers': path.resolve(__dirname, '../../helpers/src'),
      '@gitroom/backend': path.resolve(__dirname, '../../../apps/backend/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'src/**/*.int-spec.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
