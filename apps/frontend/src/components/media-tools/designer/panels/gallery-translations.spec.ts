import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const localeRoot = path.resolve(
  __dirname,
  '../../../../../../../libraries/react-shared-libraries/src/translation/locales',
);
const keys = [
  'gallery_sort_newest',
  'gallery_sort_name',
  'gallery_sort_recently_opened',
  'gallery_card_size',
  'gallery_size',
  'gallery_size_value',
  'gallery_no_preview',
  'gallery_refresh_failed',
  'gallery_design_preview',
  'gallery_template_preview',
  'my_designs_panel_search',
  'my_designs_panel_search_placeholder',
  'my_designs_panel_no_search_results',
  'my_designs_panel_open_design',
  'my_designs_panel_delete_design',
  'templates_panel_search',
  'templates_panel_search_placeholder',
  'templates_panel_no_search_results',
  'templates_panel_custom_category',
  'templates_panel_ig_post_category',
  'templates_panel_preview_template',
  'template_folder_unfiled',
];
const placeholders = (value: string) => [...value.matchAll(/{{([^}]+)}}/g)].map((match) => match[1]).sort();
const readCatalog = (locale: string) => JSON.parse(
  fs.readFileSync(path.join(localeRoot, locale, 'translation.json'), 'utf8'),
) as Record<string, string>;

describe('Designer gallery translation catalogs', () => {
  it('has nonempty localized values and matching placeholders in every locale', () => {
    const english = readCatalog('en');
    for (const locale of fs.readdirSync(localeRoot)) {
      const catalog = readCatalog(locale);
      for (const key of keys) {
        expect(catalog[key], `${locale} ${key}`).toBeTruthy();
        expect(placeholders(catalog[key]), `${locale} ${key} placeholders`).toEqual(placeholders(english[key]));
      }
      expect(catalog.template_folder_unfiled.toLowerCase(), locale).not.toContain('unfiled');
    }
  });
});
