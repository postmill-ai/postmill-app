import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import ar from '@postmill-ai/react/translation/locales/ar/translation.json';
import pl from '@postmill-ai/react/translation/locales/pl/translation.json';
import ru from '@postmill-ai/react/translation/locales/ru/translation.json';

const cases = [
  {
    locale: 'ru',
    translation: ru,
    expected: ['0 вариантов', '1 вариант', '2 варианта', '5 вариантов', '21 вариант'],
  },
  {
    locale: 'pl',
    translation: pl,
    expected: ['0 wariantów', '1 wariant', '2 warianty', '5 wariantów', '21 wariantów'],
  },
  {
    locale: 'ar',
    translation: ar,
    expected: ['0 تصميمات', '1 تصميم', '2 تصميمان', '5 تصميمات', '21 تصميمًا'],
  },
];

describe('My Designs variation-count plurals', () => {
  it.each(cases)('uses every $locale plural category without English fallback', async ({
    locale,
    translation,
    expected,
  }) => {
    const instance = i18next.createInstance();
    await instance.init({
      lng: locale,
      fallbackLng: 'en',
      defaultNS: 'translation',
      resources: { [locale]: { translation } },
    });

    [0, 1, 2, 5, 21].forEach((count, index) => {
      expect(instance.t('my_designs_panel_variation_count', { count })).toBe(expected[index]);
    });
  });
});
