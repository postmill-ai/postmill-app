import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@postmill-ai/helpers/translation/languages';

const sourceDirectory = path.resolve(__dirname);
const sourceFiles = ['share-dialog.tsx', 'design-preview-view.tsx'];
const sharingKeys = [...new Set(
  sourceFiles.flatMap((file) => [
    ...fs.readFileSync(path.join(sourceDirectory, file), 'utf8').matchAll(/\bt\('([^']+)'/g),
  ].map((match) => match[1])),
)].sort();
const localeRoot = path.resolve(__dirname, '../../../../../../libraries/react-shared-libraries/src/translation/locales');

describe('design sharing locale catalogs', () => {
  it('extracts the complete sharing key set', () => {
    expect(sharingKeys.length).toBeGreaterThan(45);
    expect(sharingKeys).toContain('designer_team_view_hint');
    expect(sharingKeys).toContain('your_name');
  });

  it.each(SUPPORTED_LANGUAGES)('%s contains every sharing key with a nonempty translation', (locale) => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(localeRoot, locale, 'translation.json'), 'utf8'),
    ) as Record<string, unknown>;
    for (const key of sharingKeys) {
      expect(catalog[key], `${locale}:${key}`).toBeTypeOf('string');
      expect(String(catalog[key]).trim().length, `${locale}:${key}`).toBeGreaterThan(0);
    }
  });
});
