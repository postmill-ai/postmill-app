/**
 * Single source of truth for the supported UI languages.
 *
 * Keep this list in sync with `libraries/react-shared-libraries/src/translation/i18n.config.ts`.
 * A cross-package test enforces equality so the two cannot drift.
 */
export const LANGUAGE_CODES = [
  'en',
  'ru',
  'zh',
  'fr',
  'es',
  'pt',
  'de',
  'it',
  'ja',
  'ko',
  'ar',
  'tr',
  'vi',
] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];
