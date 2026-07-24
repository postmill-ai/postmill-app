import { describe, it, expect } from 'vitest';
import { LANGUAGE_CODES } from '@postmill-ai/provider-kernel';
import { languages } from '@postmill-ai/react-shared-libraries/translation/i18n.config';

describe('Language code synchronization', () => {
  it('LANGUAGE_CODES matches the UI i18n languages exactly', () => {
    expect(LANGUAGE_CODES).toEqual(languages);
  });
});
