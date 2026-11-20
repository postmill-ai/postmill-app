import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { actionLabelKey, type DesignerAction } from './actions';

const localeRoot = path.resolve(
  __dirname,
  '../../../../../../libraries/react-shared-libraries/src/translation/locales',
);
const readCatalog = (locale: string) => JSON.parse(
  fs.readFileSync(path.join(localeRoot, locale, 'translation.json'), 'utf8'),
) as Record<string, string>;
const placeholders = (value: string) => [...value.matchAll(/{{([^}]+)}}/g)]
  .map((match) => match[1])
  .sort();

const action = { id: 'convert-mode', label: 'Edit as Video' } as DesignerAction;
const menuKey = actionLabelKey(action);
const oldMenuKey = 'designer_action_convert_mode_convert_to_video_mode';
const english = readCatalog('en');
const dialogKeys = Object.keys(english).filter((key) => key.startsWith('edit_as_video_'));

describe('Edit as Video translation catalogs', () => {
  it('uses the generated menu key and localized dialog strings in every locale', () => {
    expect(menuKey).toBe('designer_action_convert_mode_edit_as_video');
    expect(dialogKeys).toHaveLength(16);

    for (const locale of fs.readdirSync(localeRoot)) {
      const catalog = readCatalog(locale);
      expect(catalog[menuKey], `${locale} menu label`).toBeTruthy();
      expect(catalog[oldMenuKey], `${locale} obsolete key`).toBeUndefined();
      for (const key of dialogKeys) {
        expect(catalog[key], `${locale} ${key}`).toBeTruthy();
        expect(placeholders(catalog[key]), `${locale} ${key} placeholders`)
          .toEqual(placeholders(english[key]));
        if (locale !== 'en') {
          expect(catalog[key], `${locale} ${key} is translated`).not.toBe(english[key]);
        }
      }
      if (locale !== 'en') {
        expect(catalog[menuKey], `${locale} menu label is translated`).not.toBe(english[menuKey]);
      }
    }
  });
});
