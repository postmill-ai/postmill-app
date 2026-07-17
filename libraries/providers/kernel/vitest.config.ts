import { defineConfig } from 'vitest/config';
import fs from 'fs';
import path from 'path';

const providersDir = path.resolve(__dirname, '..');
const providerAliases: Record<string, string> = {};
for (const dir of fs.readdirSync(providersDir, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name === 'kernel') continue;
  const pkg = `@gitroom/provider-${dir.name}`;
  const src = path.resolve(providersDir, dir.name, 'src');
  if (!fs.existsSync(src)) continue;
  providerAliases[pkg] = src;
  providerAliases[`${pkg}/*`] = `${src}/*`;
}

export default defineConfig({
  resolve: {
    alias: {
      ...providerAliases,
      '@gitroom/provider-kernel': path.resolve(__dirname, './src'),
      '@gitroom/provider-kernel/*': path.resolve(__dirname, './src/*'),
      '@gitroom/nestjs-libraries': path.resolve(__dirname, '../../nestjs-libraries/src'),
      '@gitroom/helpers': path.resolve(__dirname, '../../helpers/src'),
      '@gitroom/backend': path.resolve(__dirname, '../../../apps/backend/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
