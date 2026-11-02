import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPreferredLanguage,
  savePreferredLanguage,
} from './preferred-language.client';

const changeLanguage = vi.fn().mockResolvedValue(undefined);
vi.mock('i18next', () => ({
  default: { changeLanguage: (...args: unknown[]) => changeLanguage(...args) },
}));

describe('preferred language client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute('dir');
  });

  it('applies the language, cookie, and RTL direction', async () => {
    await applyPreferredLanguage('ar');
    expect(changeLanguage).toHaveBeenCalledWith('ar');
    expect(document.cookie).toContain('i18next=ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });

  it('serializes preference writes so the latest choice is saved last', async () => {
    let finishFirst: ((response: Response) => void) | undefined;
    const calls: string[] = [];
    const fetch = vi.fn((_path: string, options: RequestInit) => {
      const language = JSON.parse(String(options.body)).preferredLanguage;
      calls.push(language);
      if (language === 'en') {
        return new Promise<Response>((resolve) => {
          finishFirst = resolve;
        });
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const first = savePreferredLanguage(fetch, 'en');
    const second = savePreferredLanguage(fetch, 'fr');
    for (let attempt = 0; attempt < 5 && calls.length === 0; attempt++) {
      await Promise.resolve();
    }
    expect(calls).toEqual(['en']);
    finishFirst!(new Response(null, { status: 200 }));
    await Promise.all([first, second]);
    expect(calls).toEqual(['en', 'fr']);
  });
});
