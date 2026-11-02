import { describe, expect, it } from 'vitest';
import {
  normalizeSupportedLanguage,
  SUPPORTED_LANGUAGES,
} from './languages';

describe('supported languages', () => {
  it('contains the 16 existing UI locales', () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(16);
    expect(SUPPORTED_LANGUAGES).toContain('en');
    expect(SUPPORTED_LANGUAGES).toContain('ar');
  });

  it.each([
    ['en', 'en'],
    [' en-US ', 'en'],
    ['pt-BR', 'pt'],
    ['ZH-cn', 'zh'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeSupportedLanguage(input)).toBe(expected);
  });

  it.each([null, undefined, '', 'xx', 'en-US-extra', 42])(
    'rejects unsupported value %s',
    (value) => {
      expect(normalizeSupportedLanguage(value)).toBeNull();
    }
  );
});
